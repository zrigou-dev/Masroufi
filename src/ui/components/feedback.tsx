import { createContext, type ReactNode, use, useCallback, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FinanceError, type ErrorCode } from '../../domain/errors';
import type { TKey } from '../../i18n';
import { useApp } from '../../state/app';
import { fontFamily, radius, space, type as typeScale } from '../theme';
import { Button, T } from './core';

type ConfirmOptions = { title: string; message?: string; confirmLabel?: string; destructive?: boolean; prompt?: { placeholder: string; secure?: boolean } };
type ToastOptions = { message: string; actionLabel?: string; onAction?: () => void };

type FeedbackValue = {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  /** Like confirm, but collects text. Resolves null when dismissed. */
  ask: (options: ConfirmOptions) => Promise<string | null>;
  toast: (options: ToastOptions) => void;
};

const FeedbackContext = createContext<FeedbackValue | null>(null);

export function useFeedback(): FeedbackValue {
  const value = use(FeedbackContext);
  if (!value) throw new Error('useFeedback must be used inside FeedbackProvider');
  return value;
}

const TOAST_MS = 2500;
/** An undo needs time to be noticed and reached. */
const ACTION_TOAST_MS = 6000;

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const { colors, t } = useApp();
  const insets = useSafeAreaInsets();
  const [dialog, setDialog] = useState<(ConfirmOptions & { resolve: (value: string | null) => void }) | null>(null);
  const [text, setText] = useState('');
  const [toastState, setToast] = useState<ToastOptions | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ask = useCallback((options: ConfirmOptions) => {
    setText('');
    return new Promise<string | null>((resolve) => setDialog({ ...options, resolve }));
  }, []);

  const value = useMemo<FeedbackValue>(
    () => ({
      ask,
      confirm: async (options) => (await ask(options)) !== null,
      toast: (options) => {
        if (timer.current) clearTimeout(timer.current);
        setToast(options);
        timer.current = setTimeout(() => setToast(null), options.actionLabel ? ACTION_TOAST_MS : TOAST_MS);
      },
    }),
    [ask],
  );

  const close = (result: string | null) => {
    dialog?.resolve(result);
    setDialog(null);
  };

  return (
    <FeedbackContext value={value}>
      {children}
      <Modal visible={dialog !== null} transparent animationType="fade" onRequestClose={() => close(null)}>
        <View style={[styles.overlay, { backgroundColor: colors.overlay }]}>
          {dialog ? (
            <View accessibilityViewIsModal style={[styles.dialog, { backgroundColor: colors.surfaceRaised }]}>
              <T variant="title" weight="semibold">
                {dialog.title}
              </T>
              {dialog.message ? <T tone="muted">{dialog.message}</T> : null}
              {dialog.prompt ? (
                <TextInput
                  autoFocus
                  value={text}
                  onChangeText={setText}
                  secureTextEntry={dialog.prompt.secure}
                  placeholder={dialog.prompt.placeholder}
                  placeholderTextColor={colors.textFaint}
                  style={[styles.input, typeScale.body, { fontFamily: fontFamily.regular, color: colors.text, borderColor: colors.border }]}
                />
              ) : null}
              <View style={styles.actions}>
                <View style={{ flex: 1 }}>
                  <Button label={t('common.cancel')} kind="secondary" compact onPress={() => close(null)} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    label={dialog.confirmLabel ?? t('common.confirm')}
                    kind={dialog.destructive ? 'danger' : 'primary'}
                    compact
                    disabled={Boolean(dialog.prompt) && !text}
                    onPress={() => close(text)}
                  />
                </View>
              </View>
            </View>
          ) : null}
        </View>
      </Modal>
      {toastState ? (
        <View pointerEvents="box-none" style={[styles.toastWrap, { bottom: insets.bottom + 72 }]}>
          <View accessibilityLiveRegion="polite" style={[styles.toast, { backgroundColor: colors.text }]}>
            <T variant="small" style={{ color: colors.background, flex: 1 }}>
              {toastState.message}
            </T>
            {toastState.actionLabel ? (
              <Pressable
                accessibilityRole="button"
                hitSlop={10}
                onPress={() => {
                  setToast(null);
                  toastState.onAction?.();
                }}>
                <T variant="small" weight="semibold" style={{ color: colors.primarySoft }}>
                  {toastState.actionLabel}
                </T>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}
    </FeedbackContext>
  );
}

/** Turns anything thrown by the data layer into a sentence, never exposing internals. */
export function useErrorMessage() {
  const { t, settings } = useApp();
  return useCallback(
    (error: unknown): string => {
      if (error instanceof FinanceError) return t(`errors.${error.code as ErrorCode}` as TKey, error.params);
      if (error instanceof Error && /UNIQUE/.test(error.message)) return t('errors.occurrence_resolved');
      return t('errors.unexpected');
    },
    // settings.language is what `t` changes with
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings.language],
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  dialog: { width: '100%', maxWidth: 420, borderRadius: radius.xl, padding: space.xl, gap: space.md },
  input: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, minHeight: 48 },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  toastWrap: { position: 'absolute', left: space.lg, right: space.lg, alignItems: 'center' },
  toast: { flexDirection: 'row', alignItems: 'center', gap: space.md, width: '100%', maxWidth: 480, borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: space.md },
});
