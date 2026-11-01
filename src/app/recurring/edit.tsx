import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { listAccounts } from '@/data/accounts';
import { listCategories } from '@/data/categories';
import { deleteRule, getRule, saveRule } from '@/data/recurring';
import { today } from '@/domain/dates';
import { CURRENCIES, DEFAULT_CURRENCY, parseAmount, toDecimalString } from '@/domain/money';
import type { Frequency, RecurringKind } from '@/domain/types';
import { useApp, useQuery } from '@/state/app';
import { Button, Loading, Screen, T } from '@/ui/components/core';
import { useErrorMessage, useFeedback } from '@/ui/components/feedback';
import { useCategoryName } from '@/ui/components/finance';
import { AmountInput, Chip, ChipRow, DateField, Field, FieldError, Label, Picker, Segmented, SwitchRow } from '@/ui/components/forms';

const FREQUENCIES: Frequency[] = ['daily', 'weekly', 'monthly', 'yearly'];

export default function RecurringEdit() {
  const { id, kind: initialKind } = useLocalSearchParams<{ id?: string; kind?: RecurringKind }>();
  const { t, db } = useApp();
  const router = useRouter();
  const { confirm } = useFeedback();
  const errorMessage = useErrorMessage();
  const nameOf = useCategoryName();

  const [kind, setKind] = useState<RecurringKind>(initialKind ?? 'expense');
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [frequency, setFrequency] = useState<Frequency>('monthly');
  const [interval, setIntervalCount] = useState('1');
  const [startDate, setStartDate] = useState<string | null>(today());
  const [endDate, setEndDate] = useState<string | null>(null);
  const [reminder, setReminder] = useState('1');
  const [active, setActive] = useState(true);
  const [autoPost, setAutoPost] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { data } = useQuery(
    async (conn) => ({ rule: id ? await getRule(conn, id) : null, accounts: await listAccounts(conn), categories: await listCategories(conn, { pickable: true }) }),
    [id],
  );
  const loaded = useRef(false);

  useEffect(() => {
    if (!data?.rule || loaded.current) return;
    loaded.current = true;
    const { rule } = data;
    setKind(rule.kind);
    setName(rule.name);
    setAmount(toDecimalString(rule.amountMinor, rule.currency));
    setCurrency(rule.currency);
    setAccountId(rule.accountId);
    setCategoryId(rule.categoryId);
    setFrequency(rule.frequency);
    setIntervalCount(String(rule.intervalCount));
    setStartDate(rule.startDate);
    setEndDate(rule.endDate);
    setReminder(rule.reminderDaysBefore === null ? '' : String(rule.reminderDaysBefore));
    setActive(rule.active);
    setAutoPost(rule.autoPost);
  }, [data]);

  if (!data) {
    return (
      <Screen scroll={false}>
        <Loading />
      </Screen>
    );
  }

  const save = async () => {
    const amountMinor = parseAmount(amount, currency);
    if (!amountMinor) return setError(t('errors.invalid_amount'));
    if (!startDate) return setError(t('errors.invalid_date'));
    try {
      await saveRule(db, id ?? null, {
        name, kind, amountMinor, currency, accountId, categoryId, frequency,
        intervalCount: Number.parseInt(interval, 10) || 1,
        startDate, endDate,
        reminderDaysBefore: reminder.trim() === '' ? null : Number.parseInt(reminder, 10) || 0,
        active,
        autoPost,
      });
      router.back();
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  const remove = async () => {
    if (!id || !(await confirm({ title: t('recurring.deleteTitle'), message: t('recurring.deleteBody'), destructive: true, confirmLabel: t('common.delete') }))) return;
    await deleteRule(db, id);
    router.back();
  };

  return (
    <Screen title={id ? t('recurring.edit') : t('recurring.add')} footer={<Button label={t('common.save')} onPress={() => void save()} />}>
      <Segmented
        value={kind}
        onChange={(next) => {
          setKind(next);
          setCategoryId(null);
        }}
        options={[
          { value: 'expense', label: t('txType.expense') },
          { value: 'income', label: t('txType.income') },
        ]}
      />
      <AmountInput label={t('transaction.amount')} value={amount} onChangeText={setAmount} currency={currency} />
      <Field label={t('recurring.name')} value={name} onChangeText={setName} />
      <Label>{t('recurring.frequency')}</Label>
      <ChipRow>
        {FREQUENCIES.map((value) => (
          <Chip key={value} label={t(`frequency.${value}`)} selected={frequency === value} onPress={() => setFrequency(value)} />
        ))}
      </ChipRow>
      <Field label={t('recurring.interval')} value={interval} onChangeText={setIntervalCount} keyboardType="number-pad" hint={t('recurring.intervalHint')} />
      <DateField label={t('recurring.start')} value={startDate} onChange={setStartDate} />
      <T variant="caption" tone="faint">
        {t('recurring.startHint')}
      </T>
      <DateField label={t('recurring.end')} value={endDate} allowClear onChange={setEndDate} />
      <Picker label={t('transaction.account')} value={accountId} allowClear options={data.accounts.filter((a) => a.currency === currency).map((a) => ({ value: a.id, label: a.name }))} onChange={setAccountId} />
      <Picker
        label={t('transaction.category')}
        value={categoryId}
        allowClear
        options={data.categories.filter((c) => c.kind === kind).map((c) => ({ value: c.id, label: nameOf(c), color: c.color }))}
        onChange={setCategoryId}
      />
      <Picker label={t('accounts.currency')} value={currency} options={Object.keys(CURRENCIES).map((code) => ({ value: code, label: code }))} onChange={(code) => code && setCurrency(code)} />
      <Field label={t('recurring.reminder')} value={reminder} onChangeText={setReminder} keyboardType="number-pad" hint={t('recurring.reminderHint')} />
      <SwitchRow label={t('recurring.auto')} hint={t('recurring.autoHint')} value={autoPost} onChange={setAutoPost} />
      <SwitchRow label={t('recurring.active')} value={active} onChange={setActive} />
      <FieldError message={error} />
      {id ? <Button label={t('common.delete')} kind="danger" icon="trash-outline" onPress={() => void remove()} /> : null}
    </Screen>
  );
}
