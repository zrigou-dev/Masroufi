import { useState } from 'react';

import { clearPin, lockSupported, savePin } from '@/platform/security';
import { useApp } from '@/state/app';
import { Button, Card, Screen, Section, T } from '@/ui/components/core';
import { useErrorMessage } from '@/ui/components/feedback';
import { Field, FieldError, SwitchRow } from '@/ui/components/forms';

export default function Security() {
  const { t, settings, updateSetting } = useApp();
  const errorMessage = useErrorMessage();
  const [pin, setPin] = useState('');
  const [repeat, setRepeat] = useState('');
  const [setting, setSetting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enable = async () => {
    if (!/^\d{4,12}$/.test(pin) || pin !== repeat) return setError(t('security.pinRule'));
    try {
      await savePin(pin);
      await updateSetting('lockEnabled', true);
      setPin('');
      setRepeat('');
      setSetting(false);
      setError(null);
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  const disable = async () => {
    await clearPin();
    await updateSetting('lockEnabled', false);
  };

  return (
    <Screen title={t('security.title')}>
      <Card>
        <SwitchRow
          label={t('security.lock')}
          hint={lockSupported ? t('security.lockHint') : t('security.unsupported')}
          disabled={!lockSupported}
          value={settings.lockEnabled || setting}
          onChange={(value) => (value ? setSetting(true) : settings.lockEnabled ? void disable() : setSetting(false))}
        />
      </Card>
      {setting && !settings.lockEnabled ? (
        <Section title={t('security.setPin')}>
          <Field label={t('lock.pin')} value={pin} onChangeText={setPin} secureTextEntry keyboardType="number-pad" />
          <Field label={t('security.repeatPin')} value={repeat} onChangeText={setRepeat} secureTextEntry keyboardType="number-pad" />
          <FieldError message={error} />
          <Button label={t('common.save')} onPress={() => void enable()} />
        </Section>
      ) : null}
      <Section title={t('security.limitsTitle')}>
        <Card>
          <T variant="small">{t('security.limit1')}</T>
          <T variant="small">{t('security.limit2')}</T>
          <T variant="small">{t('security.limit3')}</T>
          <T variant="small">{t('security.limit4')}</T>
        </Card>
      </Section>
    </Screen>
  );
}
