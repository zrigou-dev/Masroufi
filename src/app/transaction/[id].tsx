import { useLocalSearchParams, useRouter } from 'expo-router';

import { deleteTransaction, getTransaction, restoreTransaction, reverseTransaction } from '@/data/transactions';
import { dateOf, formatDate, nowLocal } from '@/domain/dates';
import { useApp, useQuery } from '@/state/app';
import { Badge, Button, Card, Divider, EmptyState, ErrorState, Loading, Row, Screen, Stacked, T } from '@/ui/components/core';
import { useErrorMessage, useFeedback } from '@/ui/components/feedback';
import { Money, useCategoryName, useMoney } from '@/ui/components/finance';

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <Row between gap={16} style={{ alignItems: 'flex-start' }}>
      <T tone="muted">{label}</T>
      <T weight="medium" style={{ flexShrink: 1, textAlign: 'right' }}>
        {value}
      </T>
    </Row>
  );
}

const MANAGED = ['opening_balance', 'debt_borrowed', 'debt_lent'];

export default function TransactionDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, settings, db } = useApp();
  const router = useRouter();
  const { confirm, toast } = useFeedback();
  const errorMessage = useErrorMessage();
  const nameOf = useCategoryName();
  const money = useMoney();
  const { data: tx, error, loading, reload } = useQuery((conn) => getTransaction(conn, id), [id]);

  if (error) return <ErrorState onRetry={reload} />;
  if (loading) {
    return (
      <Screen title={t('transaction.detail')} scroll={false}>
        <Loading />
      </Screen>
    );
  }
  if (!tx || tx.deletedAt) {
    return (
      <Screen title={t('transaction.detail')}>
        <EmptyState icon="receipt-outline" title={t('transaction.gone')} />
      </Screen>
    );
  }

  const isManaged = MANAGED.includes(tx.type);
  const canEdit = !isManaged && !tx.isReversed && tx.type !== 'reversal' && tx.type !== 'adjustment';
  const canReverse = !isManaged && !tx.isReversed && tx.type !== 'reversal';
  const canDelete = !isManaged && !tx.isReversed;

  const remove = async () => {
    const ok = await confirm({ title: t('transaction.deleteTitle'), message: t('transaction.deleteBody'), confirmLabel: t('common.delete'), destructive: true });
    if (!ok) return;
    try {
      await deleteTransaction(db, tx.id);
      if (router.canGoBack()) router.back();
      toast({
        message: t('transaction.deleted'),
        actionLabel: t('common.undo'),
        onAction: () => void restoreTransaction(db, tx.id).catch((failure: unknown) => toast({ message: errorMessage(failure) })),
      });
    } catch (failure) {
      toast({ message: errorMessage(failure) });
    }
  };

  const reverse = async () => {
    const ok = await confirm({ title: t('transaction.reverseTitle'), message: t('transaction.reverseBody'), confirmLabel: t('transaction.reverse') });
    if (!ok) return;
    try {
      await reverseTransaction(db, tx.id, nowLocal());
      toast({ message: t('transaction.reversed') });
    } catch (failure) {
      toast({ message: errorMessage(failure) });
    }
  };

  const edit = () => {
    if (tx.debtId) router.push({ pathname: '/debt/pay', params: { id: tx.debtId, transactionId: tx.id } });
    else router.push({ pathname: '/transaction/new', params: { id: tx.id } });
  };

  return (
    <Screen title={t('transaction.detail')}>
      <Card>
        <Row between>
          <Badge label={t(`txType.${tx.type}`)} tone="primary" />
          {tx.isReversed ? <Badge label={t('transaction.isReversed')} tone="warning" /> : null}
        </Row>
        <Money minor={tx.amountMinor} currency={tx.currency} variant="display" weight="bold" />
        {tx.toAmountMinor !== null && tx.toCurrency && tx.toCurrency !== tx.currency ? (
          <T tone="muted">{t('transaction.receivedValue', { amount: money(tx.toAmountMinor, tx.toCurrency) })}</T>
        ) : null}
        <Divider />
        <Detail label={t('transaction.date')} value={`${formatDate(dateOf(tx.occurredAt), settings.language, 'long')} ${tx.occurredAt.slice(11)}`} />
        <Detail label={tx.type === 'transfer' ? t('transaction.fromAccount') : t('transaction.account')} value={tx.accountName} />
        {tx.toAccountName ? <Detail label={t('transaction.toAccount')} value={tx.toAccountName} /> : null}
        {tx.categoryId ? <Detail label={t('transaction.category')} value={nameOf({ key: tx.categoryKey, name: tx.categoryName })} /> : null}
        {tx.debtCounterparty ? <Detail label={t('transaction.debt')} value={tx.debtCounterparty} /> : null}
        {tx.description ? <Detail label={t('transaction.description')} value={tx.description} /> : null}
        {tx.counterparty ? <Detail label={t('transaction.payee')} value={tx.counterparty} /> : null}
        {tx.notes ? <Detail label={t('transaction.notes')} value={tx.notes} /> : null}
        {tx.tags.length > 0 ? <Detail label={t('transaction.tags')} value={tx.tags.join('، ')} /> : null}
      </Card>

      {isManaged ? <T tone="muted">{t('transaction.managedHint')}</T> : null}

      <Stacked>
        {tx.debtId && isManaged ? <Button label={t('transaction.openDebt')} kind="secondary" onPress={() => router.push({ pathname: '/debt/[id]', params: { id: tx.debtId as string } })} /> : null}
        {canEdit ? <Button label={t('common.edit')} kind="secondary" icon="create-outline" onPress={edit} /> : null}
        {tx.type === 'expense' && !tx.isReversed ? (
          <Button label={t('transaction.recordRefund')} kind="secondary" icon="refresh-circle-outline" onPress={() => router.push({ pathname: '/transaction/new', params: { relatedId: tx.id } })} />
        ) : null}
        {canReverse ? <Button label={t('transaction.reverse')} kind="secondary" icon="arrow-undo-outline" onPress={() => void reverse()} /> : null}
        {canDelete ? <Button label={t('common.delete')} kind="danger" icon="trash-outline" onPress={() => void remove()} /> : null}
      </Stacked>
    </Screen>
  );
}
