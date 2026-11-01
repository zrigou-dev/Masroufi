import { useRouter } from 'expo-router';

import { listGoals } from '@/data/goals';
import { useApp, useQuery } from '@/state/app';
import { Button, Card, EmptyState, ErrorState, Loading, ProgressBar, Row, Screen, Stacked, T } from '@/ui/components/core';
import { StatLine, useMoney } from '@/ui/components/finance';

export default function Goals() {
  const { t } = useApp();
  const router = useRouter();
  const money = useMoney();
  const { data, error, reload } = useQuery((db) => listGoals(db), []);

  if (error) return <ErrorState onRetry={reload} />;
  if (!data) {
    return (
      <Screen scroll={false}>
        <Loading />
      </Screen>
    );
  }

  return (
    <Screen title={t('goals.title')} footer={<Button label={t('goals.add')} icon="add" onPress={() => router.push('/goal/edit')} />}>
      {data.length === 0 ? <EmptyState icon="flag-outline" title={t('goals.emptyTitle')} body={t('goals.emptyBody')} /> : null}
      <Stacked>
        {data.map(({ goal, status }) => (
          <Card key={goal.id} onPress={() => router.push({ pathname: '/goal/[id]', params: { id: goal.id } })} accessibilityLabel={goal.name}>
            <Row between>
              <T weight="semibold" numberOfLines={1} style={{ flexShrink: 1 }}>
                {goal.name}
              </T>
              <T variant="small" tone="muted">
                {Math.round(status.percent)}%
              </T>
            </Row>
            <ProgressBar value={status.percent / 100} tone="positive" />
            <T variant="small" tone="muted">
              {money(status.currentMinor, goal.currency)} / {money(goal.targetMinor, goal.currency)}
            </T>
            {status.suggestedMonthlyMinor ? <StatLine label={t('goals.suggested')} minor={status.suggestedMonthlyMinor} currency={goal.currency} /> : null}
          </Card>
        ))}
      </Stacked>
    </Screen>
  );
}
