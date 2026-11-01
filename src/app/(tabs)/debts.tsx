import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { listDebts, type DebtSummary } from '@/data/debts';
import { getPositions } from '@/data/finance';
import { formatDate } from '@/domain/dates';
import type { DebtDirection } from '@/domain/types';
import { useApp, useQuery } from '@/state/app';
import { Button, Card, EmptyState, ErrorState, Loading, ProgressBar, Row, Screen, Stacked, T } from '@/ui/components/core';
import { DebtStatusBadge, Money, StatLine, useMoney } from '@/ui/components/finance';
import { Segmented, SwitchRow } from '@/ui/components/forms';
import { space } from '@/ui/theme';

function DebtCard({ debt }: { debt: DebtSummary }) {
  const { t, settings } = useApp();
  const router = useRouter();
  const money = useMoney();
  const { state } = debt;
  return (
    <Card onPress={() => router.push({ pathname: '/debt/[id]', params: { id: debt.id } })} accessibilityLabel={debt.counterparty}>
      <Row between>
        <T weight="semibold" numberOfLines={1} style={{ flexShrink: 1 }}>
          {debt.counterparty}
        </T>
        <DebtStatusBadge status={state.status} />
      </Row>
      <Row between>
        <T variant="small" tone="muted">
          {t('debts.remaining')}
        </T>
        <Money minor={state.remainingMinor} currency={debt.currency} variant="title" tone={debt.direction === 'i_owe' ? 'negative' : 'positive'} />
      </Row>
      <ProgressBar value={state.progress} tone="positive" />
      <Row between>
        <T variant="caption" tone="faint">
          {t('debts.paidOf', { paid: money(state.paidMinor, debt.currency), total: money(state.totalDueMinor, debt.currency) })}
        </T>
        {state.nextDueDate ? (
          <T variant="caption" tone={state.overdueMinor > 0 ? 'negative' : 'faint'}>
            {formatDate(state.nextDueDate, settings.language)}
          </T>
        ) : null}
      </Row>
    </Card>
  );
}

export default function Debts() {
  const { t, settings } = useApp();
  const router = useRouter();
  const [direction, setDirection] = useState<DebtDirection>('i_owe');
  const [showClosed, setShowClosed] = useState(false);
  const currency = settings.baseCurrency;
  const { data, error, reload } = useQuery(
    async (db) => ({ debts: await listDebts(db, { direction }), position: (await getPositions(db)).find((p) => p.currency === currency) }),
    [direction, currency],
  );

  if (error) return <ErrorState onRetry={reload} />;
  if (!data) {
    return (
      <Screen hideHeader scroll={false}>
        <Loading />
      </Screen>
    );
  }

  const open = data.debts
    .filter((d) => d.state.remainingMinor > 0 || d.state.overpaidMinor > 0)
    .sort((a, b) => b.state.overdueMinor - a.state.overdueMinor || (a.state.nextDueDate ?? '9').localeCompare(b.state.nextDueDate ?? '9'));
  const closed = data.debts.filter((d) => !open.includes(d));
  const newDebt = () => router.push({ pathname: '/debt/edit', params: { direction } });

  return (
    <Screen hideHeader>
      <Row between>
        <T variant="heading" weight="bold">
          {t('tabs.debts')}
        </T>
        <Button label={t('debts.add')} icon="add" compact kind="secondary" onPress={newDebt} />
      </Row>
      <Card>
        <StatLine label={t('home.iOwe')} minor={data.position?.liabilityMinor ?? 0} currency={currency} tone="negative" />
        <StatLine label={t('home.owedToMe')} minor={data.position?.receivableMinor ?? 0} currency={currency} tone="positive" />
      </Card>
      <Segmented
        value={direction}
        onChange={setDirection}
        options={[
          { value: 'i_owe', label: t('debts.iOwe') },
          { value: 'owed_to_me', label: t('debts.owedToMe') },
        ]}
      />
      {open.length === 0 ? (
        <EmptyState
          icon="people-outline"
          title={direction === 'i_owe' ? t('debts.emptyOwe') : t('debts.emptyOwed')}
          body={t('debts.emptyBody')}
          action={t('debts.add')}
          onAction={newDebt}
        />
      ) : (
        <Stacked>
          {open.map((debt) => (
            <DebtCard key={debt.id} debt={debt} />
          ))}
        </Stacked>
      )}
      {closed.length > 0 ? (
        <View style={{ gap: space.md }}>
          <SwitchRow label={t('debts.showClosed', { count: closed.length })} value={showClosed} onChange={setShowClosed} />
          {showClosed ? closed.map((debt) => <DebtCard key={debt.id} debt={debt} />) : null}
        </View>
      ) : null}
      <Button label={t('planning.compare')} kind="ghost" icon="git-compare-outline" onPress={() => router.push('/planning')} />
    </Screen>
  );
}
