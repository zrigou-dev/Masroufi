import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { clearSchedule, equalSchedule, getDebt, replaceSchedule, type ScheduleItem } from '@/data/debts';
import { addMonths, today } from '@/domain/dates';
import { parseAmount, toDecimalString } from '@/domain/money';
import { useApp, useQuery } from '@/state/app';
import { Button, Card, IconButton, Loading, Row, Screen, Stacked, T } from '@/ui/components/core';
import { useErrorMessage, useFeedback } from '@/ui/components/feedback';
import { StatLine, useMoney } from '@/ui/components/finance';
import { DateField, Field, FieldError } from '@/ui/components/forms';
import { space } from '@/ui/theme';

type Draft = { key: number; dueDate: string; amount: string };

export default function DebtSchedule() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, db } = useApp();
  const router = useRouter();
  const { confirm } = useFeedback();
  const errorMessage = useErrorMessage();
  const money = useMoney();
  const [count, setCount] = useState('3');
  const [first, setFirst] = useState(addMonths(today(), 1));
  const [items, setItems] = useState<Draft[] | null>(null);
  const [nextKey, setNextKey] = useState(1000);
  const [error, setError] = useState<string | null>(null);

  const { data: debt } = useQuery((conn) => getDebt(conn, id), [id]);
  if (!debt) {
    return (
      <Screen scroll={false}>
        <Loading />
      </Screen>
    );
  }

  const remaining = debt.state.remainingMinor;
  const openItems = debt.state.installments.filter((i) => i.remainingMinor > 0);
  const toDraft = (item: ScheduleItem, key: number): Draft => ({ key, dueDate: item.dueDate, amount: toDecimalString(item.amountMinor, debt.currency) });
  const drafts = items ?? openItems.map((i, index) => toDraft({ dueDate: i.dueDate, amountMinor: i.remainingMinor }, index));

  const parsed = drafts.map((d) => parseAmount(d.amount, debt.currency));
  const total = parsed.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const update = (key: number, patch: Partial<Draft>) => setItems(drafts.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  const generate = () => {
    const parts = Number.parseInt(count, 10);
    if (!Number.isInteger(parts) || parts < 1 || parts > 240) return setError(t('errors.invalid_input'));
    setError(null);
    setItems(equalSchedule(remaining, parts, first).map(toDraft));
  };

  const save = async () => {
    if (parsed.some((value) => !value)) return setError(t('errors.invalid_amount'));
    try {
      await replaceSchedule(db, id, drafts.map((d, i) => ({ dueDate: d.dueDate, amountMinor: parsed[i] as number })));
      router.back();
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  const clear = async () => {
    if (!(await confirm({ title: t('debts.clearScheduleTitle'), message: t('debts.clearScheduleBody'), destructive: true, confirmLabel: t('common.delete') }))) return;
    await clearSchedule(db, id);
    router.back();
  };

  return (
    <Screen title={t('debts.schedule')} footer={<Button label={t('common.save')} onPress={() => void save()} disabled={drafts.length === 0} />}>
      <T tone="muted">{t('debts.scheduleHint')}</T>
      <Card>
        <StatLine label={t('debts.remaining')} minor={remaining} currency={debt.currency} />
        <StatLine label={t('debts.scheduled')} minor={total} currency={debt.currency} tone={total === remaining ? 'positive' : 'negative'} />
      </Card>

      <Card>
        <T weight="semibold">{t('debts.generate')}</T>
        <Row gap={space.sm} style={{ alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <Field label={t('debts.installmentCount')} value={count} onChangeText={setCount} keyboardType="number-pad" />
          </View>
          <View style={{ flex: 1 }}>
            <DateField label={t('debts.firstDate')} value={first} onChange={(value) => value && setFirst(value)} />
          </View>
        </Row>
        <Button label={t('debts.generateEqual')} kind="secondary" compact onPress={generate} />
      </Card>

      <Stacked>
        {drafts.map((draft) => (
          <Row key={draft.key} gap={space.sm} style={{ alignItems: 'flex-end' }}>
            <View style={{ flex: 1 }}>
              <DateField label={t('debts.dueDate')} value={draft.dueDate} onChange={(value) => value && update(draft.key, { dueDate: value })} />
            </View>
            <View style={{ flex: 1 }}>
              <Field label={t('transaction.amount')} value={draft.amount} onChangeText={(amount) => update(draft.key, { amount })} keyboardType="decimal-pad" />
            </View>
            <IconButton name="close-circle-outline" tone="faint" label={t('common.delete')} onPress={() => setItems(drafts.filter((d) => d.key !== draft.key))} />
          </Row>
        ))}
        <Button
          label={t('debts.addInstallment')}
          kind="ghost"
          compact
          icon="add"
          onPress={() => {
            const rest = remaining - total;
            setItems([...drafts, { key: nextKey, dueDate: first, amount: rest > 0 ? toDecimalString(rest, debt.currency) : '' }]);
            setNextKey(nextKey + 1);
          }}
        />
      </Stacked>
      {total !== remaining ? <T variant="small" tone="negative">{t('debts.scheduleOff', { difference: money(remaining - total, debt.currency) })}</T> : null}
      <FieldError message={error} />
      {debt.state.installments.length > 0 ? <Button label={t('debts.clearSchedule')} kind="ghost" onPress={() => void clear()} /> : null}
    </Screen>
  );
}
