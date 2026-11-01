import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { listAccounts } from '@/data/accounts';
import { getDebt } from '@/data/debts';
import { newId } from '@/data/ids';
import { createTransaction, getTransaction, updateTransaction, type TransactionInput } from '@/data/transactions';
import { dateOf, nowLocal, today } from '@/domain/dates';
import { parseAmount, toDecimalString } from '@/domain/money';
import { useApp, useQuery } from '@/state/app';
import { Button, Card, Loading, Row, Screen, T } from '@/ui/components/core';
import { useErrorMessage, useFeedback } from '@/ui/components/feedback';
import { StatLine } from '@/ui/components/finance';
import { AmountInput, Chip, ChipRow, DateField, Field, FieldError, Picker, SwitchRow } from '@/ui/components/forms';

export default function DebtPayment() {
  const { id, transactionId } = useLocalSearchParams<{ id: string; transactionId?: string }>();
  const { t, db } = useApp();
  const router = useRouter();
  const { toast } = useFeedback();
  const errorMessage = useErrorMessage();
  const idempotencyKey = useRef(newId());

  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState('');
  const [overpay, setOverpay] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data } = useQuery(
    async (conn) => ({
      debt: await getDebt(conn, id),
      accounts: await listAccounts(conn),
      existing: transactionId ? await getTransaction(conn, transactionId) : null,
    }),
    [id, transactionId],
  );
  const loaded = useRef(false);

  useEffect(() => {
    if (!data?.debt || loaded.current) return;
    loaded.current = true;
    const { debt, accounts, existing } = data;
    if (existing) {
      // One-shot hydration of an editable form from an async load; the ref keeps it from re-running.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAmount(toDecimalString(existing.amountMinor, existing.currency));
      setAccountId(existing.accountId);
      setDate(dateOf(existing.occurredAt));
      setNotes(existing.notes ?? '');
      setOverpay(existing.isOverpayment);
      return;
    }
    setAccountId(accounts.find((a) => a.currency === debt.currency)?.id ?? null);
    if (debt.state.nextDueMinor > 0) setAmount(toDecimalString(debt.state.nextDueMinor, debt.currency));
  }, [data]);

  if (!data?.debt) {
    return (
      <Screen scroll={false}>
        <Loading />
      </Screen>
    );
  }

  const { debt, accounts, existing } = data;
  const iOwe = debt.direction === 'i_owe';
  const remaining = debt.state.remainingMinor + (existing?.amountMinor ?? 0);
  const options = accounts.filter((a) => a.currency === debt.currency).map((a) => ({ value: a.id, label: a.name }));
  const parsed = parseAmount(amount, debt.currency);

  const save = async () => {
    if (!parsed) return setError(t('errors.invalid_amount'));
    if (!accountId) return setError(t('transaction.chooseAccount'));
    const input: TransactionInput = {
      type: iOwe ? 'debt_repayment' : 'debt_collection',
      debtId: id,
      amountMinor: parsed,
      accountId,
      occurredAt: existing ? `${date}T${existing.occurredAt.slice(11)}` : date === today() ? nowLocal() : `${date}T12:00`,
      notes,
      allowOverpayment: overpay,
      idempotencyKey: existing ? null : idempotencyKey.current,
    };
    setBusy(true);
    setError(null);
    try {
      if (existing) await updateTransaction(db, existing.id, input);
      else await createTransaction(db, input);
      toast({ message: t('debts.paymentSaved') });
      router.back();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  const exceeds = parsed !== null && parsed > remaining;

  return (
    <Screen
      title={iOwe ? t('debts.recordRepayment') : t('debts.recordCollection')}
      footer={<Button label={t('common.save')} onPress={() => void save()} loading={busy} />}>
      <Card>
        <Row between>
          <T weight="semibold">{debt.counterparty}</T>
        </Row>
        <StatLine label={t('debts.remaining')} minor={remaining} currency={debt.currency} tone={iOwe ? 'negative' : 'positive'} />
      </Card>
      <AmountInput label={t('transaction.amount')} value={amount} onChangeText={setAmount} currency={debt.currency} autoFocus />
      <ChipRow>
        <Chip label={t('debts.payFull')} selected={parsed === remaining} onPress={() => setAmount(toDecimalString(remaining, debt.currency))} />
        {debt.state.nextDueMinor > 0 && debt.state.nextDueMinor !== remaining ? (
          <Chip label={t('debts.payNext')} selected={parsed === debt.state.nextDueMinor} onPress={() => setAmount(toDecimalString(debt.state.nextDueMinor, debt.currency))} />
        ) : null}
      </ChipRow>
      {exceeds ? <SwitchRow label={t('debts.overpayConfirm')} hint={t('debts.overpayHint')} value={overpay} onChange={setOverpay} /> : null}
      <Picker label={iOwe ? t('debts.paidFrom') : t('debts.receivedInto')} value={accountId} options={options} onChange={setAccountId} />
      <DateField label={t('transaction.date')} value={date} max={today()} onChange={(value) => value && setDate(value)} />
      <Field label={t('transaction.notes')} value={notes} onChangeText={setNotes} />
      <FieldError message={error} />
    </Screen>
  );
}
