import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { AppState, View } from 'react-native';

import { authenticateWithDevice, checkPin, deviceAuthAvailable } from '../../platform/security';
import { useApp } from '../../state/app';
import { space } from '../theme';
import { Button, Icon, T } from './core';
import { Field } from './forms';

/** Locks after this long in the background, so a quick app switch does not ask again. */
const RELOCK_MS = 60_000;

export function LockGate({ children }: { children: ReactNode }) {
  const { settings, t, colors } = useApp();
  const [locked, setLocked] = useState(settings.lockEnabled);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [canUseDevice, setCanUseDevice] = useState(false);
  const leftAt = useRef<number | null>(null);

  const unlockWithDevice = useCallback(async () => {
    if (await authenticateWithDevice(t('lock.prompt'))) setLocked(false);
  }, [t]);

  useEffect(() => {
    if (!settings.lockEnabled) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background') leftAt.current = Date.now();
      if (state === 'active' && leftAt.current && Date.now() - leftAt.current > RELOCK_MS) setLocked(true);
    });
    return () => subscription.remove();
  }, [settings.lockEnabled]);

  useEffect(() => {
    if (!locked) return;
    void deviceAuthAvailable().then((available) => {
      setCanUseDevice(available);
      if (available) void unlockWithDevice();
    });
  }, [locked, unlockWithDevice]);

  if (!locked) return children;

  const submit = async () => {
    const result = await checkPin(pin);
    setPin('');
    if (result.ok) {
      setError(null);
      setLocked(false);
    } else {
      setError(result.waitSeconds > 0 ? t('lock.wait', { seconds: result.waitSeconds }) : t('lock.wrong'));
    }
  };

  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: space.xl, gap: space.lg, backgroundColor: colors.background }}>
      <View style={{ alignItems: 'center', gap: space.sm }}>
        <Icon name="lock-closed-outline" size={36} tone="primary" />
        <T variant="heading" weight="semibold" center>
          {t('lock.title')}
        </T>
      </View>
      <Field label={t('lock.pin')} value={pin} onChangeText={setPin} secureTextEntry keyboardType="number-pad" error={error} onSubmitEditing={() => void submit()} />
      <Button label={t('lock.unlock')} onPress={() => void submit()} disabled={pin.length === 0} />
      {canUseDevice ? <Button label={t('lock.useDevice')} kind="ghost" onPress={() => void unlockWithDevice()} /> : null}
    </View>
  );
}
