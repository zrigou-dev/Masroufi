import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { listBudgetStatuses, listBudgets } from '@/data/budgets';
import { listCategories } from '@/data/categories';
import { spendingByCategory } from '@/data/finance';
import { formatDate, periodRange, today } from '@/domain/dates';
import { useApp, useQuery } from '@/state/app';
import { Badge, Button, Card, EmptyState, ErrorState, Loading, ProgressBar, Row, Screen, Section, Stacked, T } from '@/ui/components/core';
import { ShareBars, StatLine, useCategoryName, useMoney } from '@/ui/components/finance';

export default function Budgets() {
  const { t, settings } = useApp();
  const router = useRouter();
  const money = useMoney();
  const nameOf = useCategoryName();
  const currency = settings.baseCurrency;
  const { data, error, reload } = useQuery(
    async (db) => ({
      statuses: await listBudgetStatuses(db),
      all: await listBudgets(db),
      top: (await spendingByCategory(db, periodRange('month', today()), currency)).slice(0, 5),
      categories: await listCategories(db, { includeArchived: true }),
    }),
    [currency],
  );

  if (error) return <ErrorState onRetry={reload} />;
  if (!data) {
    return (
      <Screen scroll={false}>
        <Loading />
      </Screen>
    );
  }

  const paused = data.all.filter((b) => !b.active);
  const add = () => router.push('/budget/edit');

  return (
    <Screen title={t('budgets.title')} footer={<Button label={t('budgets.add')} icon="add" onPress={add} />}>
      {data.statuses.length === 0 ? <EmptyState icon="pie-chart-outline" title={t('budgets.emptyTitle')} body={t('budgets.emptyBody')} /> : null}
      <Stacked>
        {data.statuses.map(({ budget, status }) => {
          const category = data.categories.find((c) => c.id === budget.categoryId);
          const tone = status.pace === 'over' ? 'negative' : status.pace === 'ahead' ? 'warning' : 'primary';
          return (
            <Card key={budget.id} onPress={() => router.push({ pathname: '/budget/edit', params: { id: budget.id } })} accessibilityLabel={budget.name}>
              <Row between>
                <T weight="semibold" numberOfLines={1} style={{ flexShrink: 1 }}>
                  {budget.name}
                </T>
                <Badge label={t(`budgets.pace_${status.pace}`)} tone={status.pace === 'over' ? 'negative' : status.pace === 'ahead' ? 'warning' : 'positive'} />
              </Row>
              <T variant="caption" tone="faint">
                {[category ? nameOf(category) : t('budgets.allSpending'), `${formatDate(status.range.from, settings.language)} – ${formatDate(status.range.to, settings.language)}`].join(' · ')}
              </T>
              <ProgressBar value={status.percentUsed / 100} tone={tone} />
              <Row between>
                <T variant="small">
                  {money(status.spentMinor, budget.currency)} / {money(budget.amountMinor, budget.currency)}
                </T>
                <T variant="small" tone="muted">
                  {Math.round(status.percentUsed)}%
                </T>
              </Row>
              <StatLine label={status.remainingMinor < 0 ? t('budgets.over') : t('budgets.remaining')} minor={Math.abs(status.remainingMinor)} currency={budget.currency} tone={status.remainingMinor < 0 ? 'negative' : 'positive'} />
              <StatLine label={t('budgets.expected')} minor={status.expectedMinor} currency={budget.currency} tone="muted" />
            </Card>
          );
        })}
      </Stacked>
      {paused.length > 0 ? (
        <Section title={t('budgets.paused')}>
          {paused.map((budget) => (
            <Card key={budget.id} onPress={() => router.push({ pathname: '/budget/edit', params: { id: budget.id } })}>
              <T tone="muted">{budget.name}</T>
            </Card>
          ))}
        </Section>
      ) : null}
      {data.top.length > 0 ? (
        <Section title={t('budgets.topCategories')}>
          <Card>
            <View>
              <ShareBars currency={currency} items={data.top.map((c) => ({ key: c.categoryId ?? 'none', label: nameOf(c), minor: c.minor, color: c.color ?? undefined }))} />
            </View>
          </Card>
        </Section>
      ) : null}
    </Screen>
  );
}
