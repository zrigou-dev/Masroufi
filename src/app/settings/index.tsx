import { useRouter } from 'expo-router';
import { useState } from 'react';

import { resetAllData } from '@/data/backup';
import type { Language, ThemePreference } from '@/data/settings';
import { CURRENCIES } from '@/domain/money';
import { remindersSupported, requestReminderPermission } from '@/platform/notifications';
import { useApp } from '@/state/app';
import { Button, Card, Screen, Section, Stacked, T } from '@/ui/components/core';
import { useFeedback } from '@/ui/components/feedback';
import { Picker, Segmented, SwitchRow } from '@/ui/components/forms';

export default function Settings() {
  const { t, settings, updateSetting, reloadSettings, db } = useApp();
  const router = useRouter();
  const { confirm, ask, toast } = useFeedback();
  const [denied, setDenied] = useState(false);

  const toggleReminders = async (enabled: boolean) => {
    if (enabled && !(await requestReminderPermission())) {
      setDenied(true);
      return;
    }
    setDenied(false);
    await updateSetting('remindersEnabled', enabled);
  };

  const reset = async () => {
    const typed = await ask({ title: t('settings.resetTitle'), message: t('settings.resetBody'), destructive: true, confirmLabel: t('settings.resetConfirm'), prompt: { placeholder: t('settings.resetWord') } });
    if (typed === null) return;
    if (typed.trim() !== t('settings.resetWord')) {
      toast({ message: t('settings.resetMismatch') });
      return;
    }
    if (!(await confirm({ title: t('settings.resetTitle'), message: t('settings.resetFinal'), destructive: true, confirmLabel: t('settings.resetConfirm') }))) return;
    await resetAllData(db);
    await reloadSettings();
    router.replace('/onboarding');
  };

  return (
    <Screen title={t('settings.title')}>
      <Section title={t('settings.language')}>
        <Segmented<Language>
          value={settings.language}
          onChange={(value) => void updateSetting('language', value)}
          options={[
            { value: 'ar', label: 'العربية' },
            { value: 'fr', label: 'Français' },
            { value: 'en', label: 'English' },
          ]}
        />
      </Section>
      <Section title={t('settings.theme')}>
        <Segmented<ThemePreference>
          value={settings.theme}
          onChange={(value) => void updateSetting('theme', value)}
          options={[
            { value: 'system', label: t('settings.themeSystem') },
            { value: 'light', label: t('settings.themeLight') },
            { value: 'dark', label: t('settings.themeDark') },
          ]}
        />
      </Section>
      <Section title={t('settings.preferences')}>
        <Card>
          <Stacked>
            <Picker
              label={t('settings.baseCurrency')}
              value={settings.baseCurrency}
              options={Object.keys(CURRENCIES).map((code) => ({ value: code, label: code }))}
              onChange={(code) => code && void updateSetting('baseCurrency', code)}
            />
            <T variant="caption" tone="faint">
              {t('settings.baseCurrencyHint')}
            </T>
            <SwitchRow label={t('settings.hideAmounts')} value={settings.hideAmounts} onChange={(value) => void updateSetting('hideAmounts', value)} />
            <SwitchRow
              label={t('settings.reminders')}
              hint={remindersSupported ? t('settings.remindersHint') : t('settings.remindersUnsupported')}
              disabled={!remindersSupported}
              value={settings.remindersEnabled}
              onChange={(value) => void toggleReminders(value)}
            />
            {settings.remindersEnabled ? (
              <SwitchRow label={t('settings.dailyNudge')} hint={t('settings.dailyNudgeHint')} value={settings.dailyNudge} onChange={(value) => void updateSetting('dailyNudge', value)} />
            ) : null}
            {denied ? (
              <T variant="small" tone="negative">
                {t('settings.remindersDenied')}
              </T>
            ) : null}
          </Stacked>
        </Card>
      </Section>
      <Section title={t('settings.danger')}>
        <Button label={t('settings.resetTitle')} kind="danger" icon="warning-outline" onPress={() => void reset()} />
      </Section>
      <T variant="caption" tone="faint" center>
        {t('settings.privacy')}
      </T>
    </Screen>
  );
}
