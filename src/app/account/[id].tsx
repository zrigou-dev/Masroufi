import { useLocalSearchParams, useRouter } from 'expo-router';

import { getAccount, setAccountArchived } from '@/data/accounts';
import { listTransactions } from '@/data/transactions';
import { formatDate } from '@/domain/dates';
import { useApp, useQuery } from '@/state/app';
import { Badge, Button, Card, EmptyState, ErrorState, IconButton, Loading, Row, Screen, Section, Stacked, T } from '@/ui/components/core';
import { useErrorMessage, useFeedback } from '@/ui/components/feedback';
import { Money, TransactionRow, useMoney } from '@/ui/components/finance';

export default function AccountDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, settings, db } = useApp();
  const router = useRouter();
  const { confirm, toast } = useFeedback();
  const errorMessage = useErrorMessage();
  const money = useMoney();
  const { data, error, reload } = useQuery(
    async (conn) => ({ account: await getAccount(conn, id), history: await listTransactions(conn, { accountId: id, limit: 100 }) }),
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
  const { account, history } = data;
  if (!account) {
    return (
      <Screen>
        <EmptyState icon="wallet-outline" title={t('accounts.gone')} />
      </Screen>
    );
  }

  const toggleArchive = async () => {
    const archiving = !account.archivedAt;
    if (archiving) {
      const message = account.balanceMinor !== 0 ? t('accounts.archiveBalanceBody', { balance: money(account.balanceMinor, account.currency) }) : t('accounts.archiveBody');
      if (!(await confirm({ title: t('accounts.archiveTitle'), message, confirmLabel: t('accounts.archive') }))) return;
    }
    try {
      await setAccountArchived(db, id, archiving);
    } catch (failure) {
      toast({ message: errorMessage(failure) });
    }
  };

  return (
    <Screen
      title={account.name}
      headerRight={<IconButton name="create-outline" label={t('common.edit')} onPress={() => router.push({ pathname: '/account/edit', params: { id } })} />}>
      <Card>
        <Row between>
          <T tone="muted">{t('accounts.balance')}</T>
          {account.archivedAt ? <Badge label={t('accounts.archived')} tone="warning" /> : null}
        </Row>
        <Money minor={account.balanceMinor} currency={account.currency} variant="display" weight="bold" tone={account.balanceMinor < 0 ? 'negative' : 'default'} />
        <T variant="small" tone="muted">
          {t(`accountType.${account.type}`)} · {t('accounts.since', { date: formatDate(account.createdOn, settings.language) })}
        </T>
        {account.description ? <T variant="small">{account.description}</T> : null}
      </Card>

      <Stacked>
        {!account.archivedAt ? (
          <Button label={t('accounts.reconcile')} kind="secondary" icon="checkmark-done-outline" onPress={() => router.push({ pathname: '/account/reconcile', params: { id } })} />
        ) : null}
        <Button label={account.archivedAt ? t('accounts.unarchive') : t('accounts.archive')} kind="ghost" icon="archive-outline" onPress={() => void toggleArchive()} />
      </Stacked>

      <Section title={t('accounts.history')}>
        {history.length === 0 ? (
          <EmptyState icon="receipt-outline" title={t('transactions.emptyTitle')} />
        ) : (
          <Card>
            {history.map((tx) => (
              <TransactionRow key={tx.id} tx={tx} showAccount={false} />
            ))}
          </Card>
        )}
      </Section>
    </Screen>
  );
}
