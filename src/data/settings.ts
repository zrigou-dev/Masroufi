import type { Db } from './sql';

export type ThemePreference = 'system' | 'light' | 'dark';
export type Language = 'ar' | 'en' | 'fr';

export type AppSettings = {
  language: Language;
  theme: ThemePreference;
  hideAmounts: boolean;
  baseCurrency: string;
  horizonDays: number;
  remindersEnabled: boolean;
  lockEnabled: boolean;
  onboarded: boolean;
  lastBackupAt: string | null;
  lastAutoBackupOn: string | null;
  /** An evening nudge to record the day, for days when logging slips. */
  dailyNudge: boolean;
  /** Home's getting-started list, once dismissed. */
  setupDismissed: boolean;
  /** The direction a reload last tried to apply; stops a reload loop if the OS refuses it. */
  rtlAttempt: boolean | null;
};

export const DEFAULT_SETTINGS: AppSettings = {
  language: 'ar',
  theme: 'system',
  hideAmounts: false,
  baseCurrency: 'MAD',
  horizonDays: 30,
  remindersEnabled: false,
  lockEnabled: false,
  onboarded: false,
  lastBackupAt: null,
  lastAutoBackupOn: null,
  dailyNudge: false,
  setupDismissed: false,
  rtlAttempt: null,
};

export async function loadSettings(db: Db): Promise<AppSettings> {
  const rows = await db.all<{ key: string; value: string }>('SELECT key, value FROM settings');
  const stored = Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value) as unknown]));
  return { ...DEFAULT_SETTINGS, ...(stored as Partial<AppSettings>) };
}

export async function saveSetting<K extends keyof AppSettings>(db: Db, key: K, value: AppSettings[K]): Promise<void> {
  await db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, JSON.stringify(value)]);
}
