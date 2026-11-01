import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { listAccounts } from '@/data/accounts';
import { createDebt, getDebt, updateDebt } from '@/data/debts';
import { newId } from '@/data/ids';
import { knownCounterparties } from '@/data/templates';
import { today } from '@/domain/dates';
import { CURRENCIES, DEFAULT_CURRENCY, parseAmount, toDecimalString } from '@/domain/money';
import type { DebtDirection } from '@/domain/types';
import { useApp, useQuery } from '@/state/app';
import { Button, Loading, Screen, Stacked } from '@/ui/components/core';
import { useErrorMessage } from '@/ui/components/feedback';
import { AmountInput, Chip, ChipRow, DateField, Field, FieldError, Picker, Segmented, SwitchRow } from '@/ui/components/forms';

const NO_ACCOUNT = '__none__';

export default function DebtEdit() {
  const params = useLocalSearchParams<{ id?: string; direction?: DebtDirection }>();
  const { t, db } = useApp();
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const { id } = params;
  const idempotencyKey = useRef(newId());

  const [direction, setDirection] = useState<DebtDirection>(params.direction ?? 'i_owe');
  const [counterparty, setCounterparty] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState(today());
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');
  const [priority, setPriority] = useState('0');
  const [extras, setExtras] = useState(false);
  const [fees, setFees] = useState('');
  const [rate, setRate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data } = useQuery(async (conn) => ({ debt: id ? await getDebt(conn, id) : null, accounts: await listAccounts(conn), people: await knownCounterparties(conn) }), [id]);
  const loaded = useRef(false);

  useEffect(() => {
    if (!data || loaded.current) return;
    loaded.current = true;
    if (!data.debt) {
      // One-shot hydration of an editable form from an async load; the ref keeps it from re-running.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAccountId(data.accounts[0]?.id ?? NO_ACCOUNT);
      return;
    }
    const { debt } = data;
    setDirection(debt.direction);
    setCounterparty(debt.counterparty);
    setAmount(toDecimalString(debt.principalMinor, debt.currency));
    setCurrency(debt.currency);
    setStartDate(debt.startDate);
    setDueDate(debt.dueDate);
    setDescription(debt.description ?? '');
    setReference(debt.referenceNotes ?? '');
    setPriority(String(debt.priority));
    if (debt.feesMinor > 0 || debt.interestRateBps !== null) {
      setExtras(true);
      setFees(debt.feesMinor ? toDecimalString(debt.feesMinor, debt.currency) : '');
      setRate(debt.interestRateBps !== null ? String(debt.interestRateBps / 100) : '');
    }
  }, [data]);

  if (!data) {
    return (
      <Screen scroll={false}>
        <Loading />
      </Screen>
    );
  }

  const save = async () => {
    const principalMinor = parseAmount(amount, currency);
    if (!principalMinor) return setError(t('errors.invalid_amount'));
    const feesMinor = extras && fees.trim() ? parseAmount(fees, currency) : 0;
    if (feesMinor === null) return setError(t('errors.invalid_amount'));
    const interestRateBps = extras && rate.trim() ? Math.round(Number(rate.replace(',', '.')) * 100) : null;
    if (interestRateBps !== null && (!Number.isFinite(interestRateBps) || interestRateBps < 0)) return setError(t('errors.invalid_input'));
    const priorityValue = Number.parseInt(priority, 10) || 0;

    setBusy(true);
    setError(null);
    try {
      if (id) {
        await updateDebt(db, id, { counterparty, principalMinor, feesMinor, interestRateBps, startDate, dueDate, description, referenceNotes: reference, priority: priorityValue });
      } else {
        await createDebt(db, {
          direction, counterparty, principalMinor, currency, startDate, dueDate, feesMinor, interestRateBps, description,
          referenceNotes: reference, priority: priorityValue,
          accountId: accountId === NO_ACCOUNT ? null : accountId,
          idempotencyKey: idempotencyKey.current,
        });
      }
      router.back();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  const accountOptions = [
    ...data.accounts.filter((a) => a.currency === currency).map((a) => ({ value: a.id, label: a.name })),
    { value: NO_ACCOUNT, label: t('debts.noAccount'), subtitle: t('debts.noAccountHint') },
  ];

  return (
    <Screen title={id ? t('debts.edit') : t('debts.add')} footer={<Button label={t('common.save')} onPress={() => void save()} loading={busy} />}>
      {!id ? (
        <Segmented
          value={direction}
          onChange={setDirection}
          options={[
            { value: 'i_owe', label: t('debts.iBorrowed') },
            { value: 'owed_to_me', label: t('debts.iLent') },
          ]}
        />
      ) : null}
      <AmountInput label={t('debts.amount')} value={amount} onChangeText={setAmount} currency={currency} autoFocus={!id} />
      <Field label={t('debts.person')} value={counterparty} onChangeText={setCounterparty} />
      {!id && data.people.length > 0 ? (
        <ChipRow>
          {data.people.map((person) => (
            <Chip key={person} label={person} selected={person === counterparty} onPress={() => setCounterparty(person)} />
          ))}
        </ChipRow>
      ) : null}
      {!id ? (
        <Stacked>
          <Picker label={direction === 'i_owe' ? t('debts.receivedInto') : t('debts.paidFrom')} value={accountId} options={accountOptions} onChange={(value) => setAccountId(value ?? NO_ACCOUNT)} />
          <Picker
            label={t('accounts.currency')}
            value={currency}
            options={Object.keys(CURRENCIES).map((code) => ({ value: code, label: code }))}
            onChange={(code) => {
              if (!code) return;
              setCurrency(code);
              setAccountId(data.accounts.find((a) => a.currency === code)?.id ?? NO_ACCOUNT);
            }}
          />
        </Stacked>
      ) : null}
      <DateField label={t('debts.started')} value={startDate} onChange={(value) => value && setStartDate(value)} />
      <DateField label={t('debts.dueDate')} value={dueDate} allowClear onChange={setDueDate} />
      <Field label={t('debts.description')} value={description} onChangeText={setDescription} />
      <Field label={t('debts.reference')} value={reference} onChangeText={setReference} multiline hint={t('debts.referenceHint')} />
      <Field label={t('debts.priority')} value={priority} onChangeText={setPriority} keyboardType="number-pad" hint={t('debts.priorityHint')} />
      <SwitchRow label={t('debts.extras')} hint={t('debts.extrasHint')} value={extras} onChange={setExtras} />
      {extras ? (
        <Stacked>
          <Field label={t('debts.fees')} value={fees} onChangeText={setFees} keyboardType="decimal-pad" />
          <Field label={t('debts.rate')} value={rate} onChangeText={setRate} keyboardType="decimal-pad" hint={t('debts.rateHint')} />
        </Stacked>
      ) : null}
      <FieldError message={error} />
    </Screen>
  );
}
