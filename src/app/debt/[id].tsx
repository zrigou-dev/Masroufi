import { useLocalSearchParams, useRouter } from 'expo-router';
import { View } from 'react-native';

import { closeDebt, deleteDebt, getDebt, listDebtEvents, reopenDebt } from '@/data/debts';
import { listTransactions } from '@/data/transactions';
import { formatDate } from '@/domain/dates';
import { formatMoney } from '@/domain/money';
import { buildPrintableHtml, shareAsPdf } from '@/platform/print';
import { useApp, useQuery } from '@/state/app';
import { Badge, Button, Card, Divider, EmptyState, ErrorState, IconButton, ListRow, Loading, ProgressBar, Row, Screen, Section, T } from '@/ui/components/core';
import { useErrorMessage, useFeedback } from '@/ui/components/feedback';
import { DebtStatusBadge, Money, StatLine, TransactionRow, useMoney } from '@/ui/components/finance';
import { space } from '@/ui/theme';

export default function DebtDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, settings, db, rtl } = useApp();
  const router = useRouter();
  const { confirm, toast, ask } = useFeedback();
  const errorMessage = useErrorMessage();
  const money = useMoney();

  const { data, error, reload } = useQuery(
    async (conn) => ({
      debt: await getDebt(conn, id),
      payments: await listTransactions(conn, { debtId: id }),
      events: await listDebtEvents(conn, id),
    }),
    [id],
  );

  if (error) return <ErrorState onRetry={reload} />;
  if (!data) {
    return (
      <Screen scroll={false}>
        <Loading />
      </Screen>
    );
  }
  const { debt, payments, events } = data;
  if (!debt) {
    return (
      <Screen>
        <EmptyState icon="people-outline" title={t('debts.gone')} />
      </Screen>
    );
  }

  const { state } = debt;
  const active = debt.closure === 'active';
  const iOwe = debt.direction === 'i_owe';

  const run = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (failure) {
      toast({ message: errorMessage(failure) });
    }
  };

  const close = async (closure: 'cancelled' | 'written_off') => {
    const note = await ask({
      title: closure === 'cancelled' ? t('debts.cancelTitle') : t('debts.writeOffTitle'),
      message: t('debts.closeBody', { amount: money(state.remainingMinor, debt.currency) }),
      prompt: { placeholder: t('debts.closeReason') },
      destructive: true,
    });
    if (note !== null) await run(() => closeDebt(db, id, closure, note));
  };

  const remove = async () => {
    if (!(await confirm({ title: t('debts.deleteTitle'), message: t('debts.deleteBody'), destructive: true, confirmLabel: t('common.delete') }))) return;
    await run(async () => {
      await deleteDebt(db, id);
      router.back();
    });
  };

  const print = () =>
    run(() => {
      const plain = (minor: number) => formatMoney(minor, debt.currency, settings.language).replace(/[⁦⁩]/g, '');
      return shareAsPdf(
        buildPrintableHtml(debt.counterparty, t(`debtStatus.${state.status}`), [
          {
            title: t('debts.summary'),
            rows: [
              [t('debts.original'), plain(state.totalDueMinor)],
              [iOwe ? t('debts.repaid') : t('debts.collected'), plain(state.paidMinor)],
              [t('debts.remaining'), plain(state.remainingMinor)],
              [t('debts.started'), formatDate(debt.startDate, settings.language)],
            ],
          },
          {
            title: t('debts.history'),
            rows: payments.map((p) => [`${formatDate(p.occurredAt.slice(0, 10), settings.language)} · ${t(`txType.${p.type}`)}`, plain(p.amountMinor)]),
          },
        ], rtl),
      );
    });

  return (
    <Screen
      title={debt.counterparty}
      headerRight={<IconButton name="create-outline" label={t('common.edit')} onPress={() => router.push({ pathname: '/debt/edit', params: { id } })} />}>
      <Card>
        <Row between>
          <T tone="muted">{iOwe ? t('debts.youOwe') : t('debts.owesYou')}</T>
          <DebtStatusBadge status={state.status} />
        </Row>
        <Money minor={state.remainingMinor} currency={debt.currency} variant="display" weight="bold" tone={iOwe ? 'negative' : 'positive'} />
        <ProgressBar value={state.progress} tone="positive" />
        <StatLine label={t('debts.original')} minor={debt.principalMinor} currency={debt.currency} />
        {debt.feesMinor > 0 ? <StatLine label={t('debts.fees')} minor={debt.feesMinor} currency={debt.currency} /> : null}
        <StatLine label={iOwe ? t('debts.repaid') : t('debts.collected')} minor={state.paidMinor} currency={debt.currency} tone="positive" />
        {state.overdueMinor > 0 ? <StatLine label={t('debts.overdueAmount')} minor={state.overdueMinor} currency={debt.currency} tone="negative" /> : null}
        {state.overpaidMinor > 0 ? <StatLine label={t('debts.overpaid')} minor={state.overpaidMinor} currency={debt.currency} tone="warning" /> : null}
        {state.nextDueDate ? (
          <Row between>
            <T tone="muted">{t('debts.nextPayment')}</T>
            <T weight="medium">
              {formatDate(state.nextDueDate, settings.language)} · {money(state.nextDueMinor, debt.currency)}
            </T>
          </Row>
        ) : null}
        <Divider />
        <T variant="small" tone="muted">
          {t('debts.startedOn', { date: formatDate(debt.startDate, settings.language) })}
        </T>
        {debt.description ? <T variant="small">{debt.description}</T> : null}
        {debt.referenceNotes ? <T variant="small" tone="muted">{debt.referenceNotes}</T> : null}
      </Card>

      {active && state.remainingMinor > 0 ? (
        <Button label={iOwe ? t('debts.recordRepayment') : t('debts.recordCollection')} icon="cash-outline" onPress={() => router.push({ pathname: '/debt/pay', params: { id } })} />
      ) : null}

      {active && state.remainingMinor > 0 ? (
        <Section title={t('debts.schedule')} action={state.installments.length ? t('common.edit') : t('debts.addSchedule')} onAction={() => router.push({ pathname: '/debt/schedule', params: { id } })}>
          {state.installments.length > 0 ? (
            <Card>
              {state.installments.map((item) => (
                <Row key={item.id} between style={{ minHeight: 34 }}>
                  <T variant="small">{formatDate(item.dueDate, settings.language)}</T>
                  <Row>
                    <T variant="small" weight="medium">
                      {money(item.amountMinor, debt.currency)}
                    </T>
                    <Badge
                      label={t(`installment.${item.state}`)}
                      tone={item.state === 'paid' ? 'positive' : item.state === 'overdue' ? 'negative' : item.state === 'partial' ? 'warning' : 'muted'}
                    />
                  </Row>
                </Row>
              ))}
            </Card>
          ) : null}
        </Section>
      ) : null}

      <Section title={t('debts.history')}>
        {payments.length === 0 ? (
          <T tone="muted">{t('debts.noPayments')}</T>
        ) : (
          <Card>
            {payments.map((tx) => (
              <TransactionRow key={tx.id} tx={tx} />
            ))}
          </Card>
        )}
      </Section>

      {events.length > 1 ? (
        <Section title={t('debts.changes')}>
          <Card>
            {events.map((event) => (
              <ListRow
                key={event.id}
                title={t(`debtEvent.${event.kind}`)}
                subtitle={[formatDate(event.at.slice(0, 10), settings.language), event.kind !== 'schedule_changed' ? event.note : null].filter(Boolean).join(' · ')}
              />
            ))}
          </Card>
        </Section>
      ) : null}

      <View style={{ gap: space.sm }}>
        <Button label={t('debts.print')} kind="secondary" icon="print-outline" onPress={() => void print()} />
        {active && state.remainingMinor > 0 ? (
          <>
            <Button label={t('debts.writeOff')} kind="secondary" onPress={() => void close('written_off')} />
            <Button label={t('debts.cancel')} kind="secondary" onPress={() => void close('cancelled')} />
          </>
        ) : null}
        {!active ? <Button label={t('debts.reopen')} kind="secondary" onPress={() => void run(() => reopenDebt(db, id))} /> : null}
        {state.paidMinor === 0 ? <Button label={t('common.delete')} kind="danger" icon="trash-outline" onPress={() => void remove()} /> : null}
      </View>
    </Screen>
  );
}
