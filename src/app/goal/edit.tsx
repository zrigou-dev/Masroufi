import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { listAccounts } from '@/data/accounts';
import { getGoal, saveGoal } from '@/data/goals';
import { CURRENCIES, DEFAULT_CURRENCY, parseAmount, toDecimalString } from '@/domain/money';
import type { GoalMode } from '@/domain/types';
import { useApp, useQuery } from '@/state/app';
import { Button, Loading, Screen, T } from '@/ui/components/core';
import { useErrorMessage } from '@/ui/components/feedback';
import { AmountInput, DateField, Field, FieldError, Picker, Segmented } from '@/ui/components/forms';

export default function GoalEdit() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { t, db } = useApp();
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY);
  const [targetDate, setTargetDate] = useState<string | null>(null);
  const [priority, setPriority] = useState('0');
  const [notes, setNotes] = useState('');
  const [mode, setMode] = useState<GoalMode>('manual');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data } = useQuery(async (conn) => ({ found: id ? await getGoal(conn, id) : null, accounts: await listAccounts(conn) }), [id]);
  const loaded = useRef(false);

  useEffect(() => {
    if (!data?.found || loaded.current) return;
    loaded.current = true;
    const { goal } = data.found;
    setName(goal.name);
    setAmount(toDecimalString(goal.targetMinor, goal.currency));
    setCurrency(goal.currency);
    setTargetDate(goal.targetDate);
    setPriority(String(goal.priority));
    setNotes(goal.notes ?? '');
    setMode(goal.mode);
    setAccountId(goal.linkedAccountId);
  }, [data]);

  if (!data) {
    return (
      <Screen scroll={false}>
        <Loading />
      </Screen>
    );
  }

  const save = async () => {
    const targetMinor = parseAmount(amount, currency);
    if (!targetMinor) return setError(t('errors.invalid_amount'));
    try {
      await saveGoal(db, id ?? null, { name, targetMinor, currency, targetDate, priority: Number.parseInt(priority, 10) || 0, notes, mode, linkedAccountId: accountId });
      router.back();
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  return (
    <Screen title={id ? t('goals.edit') : t('goals.add')} footer={<Button label={t('common.save')} onPress={() => void save()} />}>
      <AmountInput label={t('goals.target')} value={amount} onChangeText={setAmount} currency={currency} />
      <Field label={t('goals.name')} value={name} onChangeText={setName} />
      <Picker label={t('accounts.currency')} value={currency} options={Object.keys(CURRENCIES).map((code) => ({ value: code, label: code }))} onChange={(code) => code && setCurrency(code)} />
      <DateField label={t('goals.targetDate')} value={targetDate} allowClear onChange={setTargetDate} />
      <Segmented
        value={mode}
        onChange={setMode}
        options={[
          { value: 'manual', label: t('goals.modeManual') },
          { value: 'account', label: t('goals.modeAccount') },
        ]}
      />
      <T variant="small" tone="muted">
        {mode === 'manual' ? t('goals.modeManualHint') : t('goals.modeAccountHint')}
      </T>
      {mode === 'account' ? (
        <Picker label={t('transaction.account')} value={accountId} options={data.accounts.filter((a) => a.currency === currency).map((a) => ({ value: a.id, label: a.name }))} onChange={setAccountId} />
      ) : null}
      <Field label={t('debts.priority')} value={priority} onChangeText={setPriority} keyboardType="number-pad" hint={t('debts.priorityHint')} />
      <Field label={t('transaction.notes')} value={notes} onChangeText={setNotes} multiline />
      <FieldError message={error} />
    </Screen>
  );
}
