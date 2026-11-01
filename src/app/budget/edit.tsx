import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { listAccounts } from '@/data/accounts';
import { deleteBudget, getBudget, saveBudget } from '@/data/budgets';
import { listCategories } from '@/data/categories';
import { endOfMonth, startOfMonth, today } from '@/domain/dates';
import { DEFAULT_CURRENCY, parseAmount, toDecimalString, CURRENCIES } from '@/domain/money';
import type { BudgetPeriod } from '@/domain/types';
import { useApp, useQuery } from '@/state/app';
import { Button, Loading, Screen, Stacked } from '@/ui/components/core';
import { useErrorMessage, useFeedback } from '@/ui/components/feedback';
import { useCategoryName } from '@/ui/components/finance';
import { AmountInput, DateField, Field, FieldError, Picker, Segmented, SwitchRow } from '@/ui/components/forms';

export default function BudgetEdit() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { t, db } = useApp();
  const router = useRouter();
  const { confirm } = useFeedback();
  const errorMessage = useErrorMessage();
  const nameOf = useCategoryName();

  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY);
  const [period, setPeriod] = useState<BudgetPeriod>('monthly');
  const [startDate, setStartDate] = useState<string | null>(startOfMonth(today()));
  const [endDate, setEndDate] = useState<string | null>(endOfMonth(today()));
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [thresholds, setThresholds] = useState('70, 85, 100');
  const [active, setActive] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { data } = useQuery(
    async (conn) => ({
      budget: id ? await getBudget(conn, id) : null,
      categories: await listCategories(conn, { kind: 'expense' }),
      accounts: await listAccounts(conn),
    }),
    [id],
  );
  const loaded = useRef(false);

  useEffect(() => {
    if (!data?.budget || loaded.current) return;
    loaded.current = true;
    const { budget } = data;
    setName(budget.name);
    setAmount(toDecimalString(budget.amountMinor, budget.currency));
    setCurrency(budget.currency);
    setPeriod(budget.period);
    setStartDate(budget.startDate ?? startOfMonth(today()));
    setEndDate(budget.endDate ?? endOfMonth(today()));
    setCategoryId(budget.categoryId);
    setAccountId(budget.accountId);
    setThresholds(budget.thresholds.join(', '));
    setActive(budget.active);
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
    const levels = thresholds.split(/[,،\s]+/).filter(Boolean).map(Number);
    try {
      await saveBudget(db, id ?? null, { name, period, startDate, endDate, amountMinor, currency, categoryId, accountId, thresholds: levels, active });
      router.back();
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  const remove = async () => {
    if (!id || !(await confirm({ title: t('budgets.deleteTitle'), message: t('budgets.deleteBody'), destructive: true, confirmLabel: t('common.delete') }))) return;
    await deleteBudget(db, id);
    router.back();
  };

  return (
    <Screen title={id ? t('budgets.edit') : t('budgets.add')} footer={<Button label={t('common.save')} onPress={() => void save()} />}>
      <AmountInput label={t('budgets.amount')} value={amount} onChangeText={setAmount} currency={currency} />
      <Field label={t('budgets.name')} value={name} onChangeText={setName} />
      <Segmented
        value={period}
        onChange={setPeriod}
        options={[
          { value: 'monthly', label: t('budgets.monthly') },
          { value: 'custom', label: t('period.custom') },
        ]}
      />
      {period === 'custom' ? (
        <Stacked>
          <DateField label={t('period.from')} value={startDate} onChange={setStartDate} />
          <DateField label={t('period.to')} value={endDate} onChange={setEndDate} />
        </Stacked>
      ) : null}
      <Picker
        label={t('transaction.category')}
        value={categoryId}
        allowClear
        placeholder={t('budgets.allSpending')}
        options={data.categories.map((c) => ({ value: c.id, label: nameOf(c), color: c.color }))}
        onChange={setCategoryId}
      />
      <Picker label={t('budgets.account')} value={accountId} allowClear placeholder={t('common.all')} options={data.accounts.filter((a) => a.currency === currency).map((a) => ({ value: a.id, label: a.name }))} onChange={setAccountId} />
      <Picker label={t('accounts.currency')} value={currency} options={Object.keys(CURRENCIES).map((code) => ({ value: code, label: code }))} onChange={(code) => code && setCurrency(code)} />
      <Field label={t('budgets.thresholds')} value={thresholds} onChangeText={setThresholds} hint={t('budgets.thresholdsHint')} keyboardType="numbers-and-punctuation" />
      <SwitchRow label={t('budgets.active')} value={active} onChange={setActive} />
      <FieldError message={error} />
      {id ? <Button label={t('common.delete')} kind="danger" icon="trash-outline" onPress={() => void remove()} /> : null}
    </Screen>
  );
}
