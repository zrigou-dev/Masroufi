import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { createAccount } from '@/data/accounts';
import { loadDemoData } from '@/data/demo';
import type { Language } from '@/data/settings';
import { saveRule } from '@/data/recurring';
import { addMonths, daysInMonth, today } from '@/domain/dates';
import { normalizeDigits, parseAmount } from '@/domain/money';
import { useApp } from '@/state/app';
import { Button, Card, Icon, Screen, Stacked, T } from '@/ui/components/core';
import { useErrorMessage } from '@/ui/components/feedback';
import { Field, FieldError, Segmented } from '@/ui/components/forms';
import { space } from '@/ui/theme';

/** The next time this day of the month comes around, clamped to the length of that month. */
function nextDayOfMonth(day: number): string {
  const date = today();
  const dayIn = (monthStart: string) => {
    const [year, month] = monthStart.split('-').map(Number);
    return `${monthStart.slice(0, 8)}${String(Math.min(day, daysInMonth(year, month))).padStart(2, '0')}`;
  };
  const thisMonth = dayIn(`${date.slice(0, 7)}-01`);
  return thisMonth >= date ? thisMonth : dayIn(addMonths(`${date.slice(0, 7)}-01`, 1, 1));
}

export default function Onboarding() {
  const { t, settings, updateSetting, db } = useApp();
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [bank, setBank] = useState('');
  const [cash, setCash] = useState('');
  const [salary, setSalary] = useState('');
  const [salaryDay, setSalaryDay] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const finish = async () => {
    await updateSetting('onboarded', true);
    router.replace('/');
  };

  const start = async () => {
    const bankMinor = bank.trim() ? parseAmount(bank, 'MAD') : 0;
    const cashMinor = cash.trim() ? parseAmount(cash, 'MAD') : 0;
    const salaryMinor = salary.trim() ? parseAmount(salary, 'MAD') : null;
    const day = Number.parseInt(normalizeDigits(salaryDay), 10);
    if (bankMinor === null || cashMinor === null || (salary.trim() && !salaryMinor)) return setError(t('errors.invalid_amount'));
    if (salaryMinor && !(day >= 1 && day <= 31)) return setError(t('onboarding.salaryDayRule'));
    setBusy(true);
    try {
      await db.transaction(async (tx) => {
        const bankId = await createAccount(tx, { name: t('onboarding.bankName'), type: 'bank', currency: 'MAD', openingBalanceMinor: bankMinor });
        if (salaryMinor) {
          await saveRule(tx, null, {
            name: t('category.salary'), kind: 'income', amountMinor: salaryMinor, currency: 'MAD', accountId: bankId, categoryId: 'cat_salary',
            frequency: 'monthly', intervalCount: 1, startDate: nextDayOfMonth(day), endDate: null, reminderDaysBefore: null, active: true, autoPost: true,
          });
        }
        await createAccount(tx, { name: t('onboarding.cashName'), type: 'cash', currency: 'MAD', openingBalanceMinor: cashMinor });
      });
      await finish();
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  };

  const demo = async () => {
    setBusy(true);
    try {
      await loadDemoData(db);
      await finish();
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  };

  return (
    <Screen hideHeader>
      <View style={{ alignItems: 'center', gap: space.sm, paddingTop: space.xl }}>
        <Icon name="wallet" size={44} tone="primary" />
        <T variant="heading" weight="bold" center>
          {t('app.name')}
        </T>
        <T tone="muted" center>
          {t('onboarding.tagline')}
        </T>
      </View>

      <Segmented<Language>
        value={settings.language}
        onChange={(value) => void updateSetting('language', value)}
        options={[
          { value: 'ar', label: 'العربية' },
          { value: 'fr', label: 'Français' },
          { value: 'en', label: 'English' },
        ]}
      />

      <Card>
        <Stacked>
          <T weight="semibold">{t('onboarding.startTitle')}</T>
          <T variant="small" tone="muted">
            {t('onboarding.startBody')}
          </T>
          <Field label={t('onboarding.bank')} value={bank} onChangeText={setBank} keyboardType="decimal-pad" placeholder="0" />
          <Field label={t('onboarding.cash')} value={cash} onChangeText={setCash} keyboardType="decimal-pad" placeholder="0" />
          <Field label={t('onboarding.salary')} value={salary} onChangeText={setSalary} keyboardType="decimal-pad" placeholder="0" hint={t('onboarding.salaryHint')} />
          {salary.trim() ? <Field label={t('onboarding.salaryDay')} value={salaryDay} onChangeText={setSalaryDay} keyboardType="number-pad" placeholder="1" /> : null}
          <FieldError message={error} />
          <Button label={t('onboarding.start')} onPress={() => void start()} loading={busy} />
        </Stacked>
      </Card>

      <T variant="small" tone="muted" center>
        {t('onboarding.privacy')}
      </T>
      <Button label={t('onboarding.demo')} kind="ghost" compact onPress={() => void demo()} disabled={busy} />
    </Screen>
  );
}
