import { reloadAppAsync } from 'expo';
import { createContext, type ReactNode, use, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { I18nManager, Platform, useColorScheme } from 'react-native';

import { DEFAULT_SETTINGS, loadSettings, saveSetting, type AppSettings } from '../data/settings';
import type { Db, DbWithEvents } from '../data/sql';
import { translate, type TKey } from '../i18n';
import { dark, light, type Palette } from '../ui/theme';

type AppContextValue = {
  db: DbWithEvents;
  settings: AppSettings;
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>;
  reloadSettings: () => Promise<void>;
  t: (key: TKey, params?: Record<string, string | number>) => string;
  colors: Palette;
  isDark: boolean;
  rtl: boolean;
};

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const value = use(AppContext);
  if (!value) throw new Error('useApp must be used inside AppProvider');
  return value;
}

/** Fields draw their own focus state, so the browser's default box would only double it. */
function removeBrowserFocusBox(): void {
  const id = 'masroufi-input-focus';
  if (document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = 'input:focus, textarea:focus { outline: none; }';
  document.head.appendChild(style);
}

/**
 * Native layout direction is fixed at startup, so changing it takes one reload. The attempt is
 * remembered, because a device that ignores forceRTL would otherwise reload forever.
 */
async function applyDirection(db: DbWithEvents, language: AppSettings['language'], attempted: boolean | null): Promise<void> {
  const wanted = language === 'ar';
  if (Platform.OS === 'web') {
    document.documentElement.dir = wanted ? 'rtl' : 'ltr';
    document.documentElement.lang = language;
    removeBrowserFocusBox();
    return;
  }
  if (I18nManager.isRTL === wanted) return;
  I18nManager.allowRTL(wanted);
  I18nManager.forceRTL(wanted);
  if (attempted === wanted) return;
  await saveSetting(db, 'rtlAttempt', wanted);
  await reloadAppAsync();
}

export function AppProvider({ db, initialSettings, children }: { db: DbWithEvents; initialSettings: AppSettings; children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(initialSettings);
  const scheme = useColorScheme();

  useEffect(() => {
    void applyDirection(db, settings.language, settings.rtlAttempt);
  }, [db, settings.language, settings.rtlAttempt]);

  const updateSetting = useCallback<AppContextValue['updateSetting']>(
    async (key, value) => {
      await saveSetting(db, key, value);
      setSettings((current) => ({ ...current, [key]: value }));
    },
    [db],
  );

  const reloadSettings = useCallback(async () => {
    setSettings(await loadSettings(db));
  }, [db]);

  const value = useMemo<AppContextValue>(() => {
    const isDark = settings.theme === 'system' ? scheme === 'dark' : settings.theme === 'dark';
    return {
      db,
      settings,
      updateSetting,
      reloadSettings,
      t: (key, params) => translate(settings.language, key, params),
      colors: isDark ? dark : light,
      isDark,
      rtl: settings.language === 'ar',
    };
  }, [db, settings, scheme, updateSetting, reloadSettings]);

  return <AppContext value={value}>{children}</AppContext>;
}

export const fallbackSettings = DEFAULT_SETTINGS;

export type QueryState<T> = { data: T | undefined; error: unknown; loading: boolean; reload: () => void };

/**
 * Reads from SQLite and re-reads whenever the database changes, so every open screen stays
 * correct after any write. This is the app's only data-fetching mechanism.
 */
export function useQuery<T>(load: (db: Db) => Promise<T>, deps: readonly unknown[]): QueryState<T> {
  const { db } = useApp();
  const version = useDbVersion(db);
  const [state, setState] = useState<{ data: T | undefined; error: unknown; loading: boolean }>({ data: undefined, error: null, loading: true });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let current = true;
    load(db).then(
      (data) => current && setState({ data, error: null, loading: false }),
      (error: unknown) => current && setState({ data: undefined, error, loading: false }),
    );
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- callers list what `load` closes over in deps
  }, [db, version, nonce, ...deps]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}

const versions = new WeakMap<DbWithEvents, { value: number; subscribe: (fn: () => void) => () => void }>();

function useDbVersion(db: DbWithEvents): number {
  let entry = versions.get(db);
  if (!entry) {
    const created = {
      value: 0,
      subscribe: (fn: () => void) =>
        db.onChange(() => {
          created.value += 1;
          fn();
        }),
    };
    versions.set(db, created);
    entry = created;
  }
  const { subscribe } = entry;
  const current = entry;
  return useSyncExternalStore(subscribe, () => current.value);
}
