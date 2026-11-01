import { getObligations } from '@/data/finance';
import { formatDate } from '@/domain/dates';
import type { Obligation } from '@/domain/planning';
import { useApp, useQuery } from '@/state/app';
import { Card, EmptyState, ErrorState, Loading, Screen, Section, T } from '@/ui/components/core';
import { ObligationRow } from '@/ui/components/finance';

const HORIZON_DAYS = 90;

export default function CalendarScreen() {
  const { t, settings } = useApp();
  const { data, error, reload } = useQuery((db) => getObligations(db, HORIZON_DAYS), []);

  if (error) return <ErrorState onRetry={reload} />;
  if (!data) {
    return (
      <Screen scroll={false}>
        <Loading />
      </Screen>
    );
  }

  const months = new Map<string, Obligation[]>();
  for (const item of data) {
    const key = item.overdue ? 'overdue' : item.dueDate.slice(0, 7);
    months.set(key, [...(months.get(key) ?? []), item]);
  }

  return (
    <Screen title={t('calendar.title')}>
      <T tone="muted">{t('calendar.hint')}</T>
      {data.length === 0 ? <EmptyState icon="calendar-outline" title={t('calendar.emptyTitle')} body={t('calendar.emptyBody')} /> : null}
      {[...months.entries()].map(([key, items]) => (
        <Section key={key} title={key === 'overdue' ? t('home.overdue') : formatDate(`${key}-01`, settings.language, 'month')}>
          <Card>
            {items.map((item) => (
              <ObligationRow key={item.key} item={item} />
            ))}
          </Card>
        </Section>
      ))}
    </Screen>
  );
}
