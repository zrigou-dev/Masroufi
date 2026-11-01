import { useState } from 'react';

import { getInsights } from '@/data/insights';
import { useApp, useQuery } from '@/state/app';
import { EmptyState, ErrorState, Loading, Screen, Stacked, T } from '@/ui/components/core';
import { PeriodSwitcher, useCategoryName, usePeriod } from '@/ui/components/finance';
import { InsightCard } from '@/ui/components/insight';

export default function Insights() {
  const { t, settings } = useApp();
  const period = usePeriod();
  const nameOf = useCategoryName();
  const [currency] = useState(settings.baseCurrency);
  const { data, error, reload } = useQuery((db) => getInsights(db, period.range, currency, nameOf), [period.range.from, period.range.to, currency, settings.language]);

  if (error) return <ErrorState onRetry={reload} />;

  return (
    <Screen title={t('insight.title')}>
      <T tone="muted">{t('insight.hint')}</T>
      <PeriodSwitcher period={period} />
      {!data ? <Loading /> : null}
      {data?.length === 0 ? <EmptyState icon="analytics-outline" title={t('insight.emptyTitle')} body={t('insight.emptyBody')} /> : null}
      <Stacked>
        {data?.map((insight, index) => (
          <InsightCard key={`${insight.kind}${index}`} insight={insight} />
        ))}
      </Stacked>
    </Screen>
  );
}
