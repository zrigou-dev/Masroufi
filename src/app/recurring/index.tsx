import { useRouter } from 'expo-router';
import { useState } from 'react';

import { confirmOccurrence, listRules, pendingOccurrences, setRuleActive, skipOccurrence } from '@/data/recurring';
import { listTransactions } from '@/data/transactions';
import { addDays, formatDate, today } from '@/domain/dates';
import { monthlyFactor, occurrencesBetween } from '@/domain/recurrence';
import type { RecurringKind } from '@/domain/types';
import { useApp, useQuery } from '@/state/app';
import { Badge, Button, Card, EmptyState, ErrorState, ListRow, Loading, Row, Screen, Section, Stacked, T } from '@/ui/components/core';
import { useErrorMessage, useFeedback } from '@/ui/components/feedback';
import { Money, StatLine, TransactionRow, useMoney } from '@/ui/components/finance';
import { Segmented, Toggle } from '@/ui/components/forms';
import { space } from '@/ui/theme';

export default function Recurring() {
  const { t, settings, db } = useApp();
  const router = useRouter();
  const { confirm, toast } = useFeedback();
  const errorMessage = useErrorMessage();
  const money = useMoney();
  const [kind, setKind] = useState<RecurringKind>('income');
  const { data, error, reload } = useQuery(
    async (conn) => ({
      rules: await listRules(conn),
      due: await pendingOccurrences(conn, addDays(today(), 7)),
      recorded: await listTransactions(conn, { recurring: true, limit: 5 }),
    }),
    [],
  );

  if (error) return <ErrorState onRetry={reload} />;
  if (!data) {
    return (
      <Screen scroll={false}>
        <Loading />
      </Screen>
    );
  }

  const rules = data.rules.filter((r) => r.kind === kind);
  const monthlyTotal = Math.round(rules.filter((r) => r.active).reduce((sum, r) => sum + r.amountMinor * monthlyFactor(r.frequency, r.intervalCount), 0));
  // Automatic ones record themselves on the date, so only what truly needs a decision is shown.
  const awaiting = data.due.filter((o) => !o.rule.autoPost || o.overdue);

  const markPaid = async (occurrence: (typeof data.due)[number]) => {
    const { rule, dueDate } = occurrence;
    if (!rule.accountId) {
      toast({ message: t('recurring.needAccount') });
      router.push({ pathname: '/recurring/edit', params: { id: rule.id } });
      return;
    }
    const ok = await confirm({
      title: t('recurring.confirmTitle'),
      message: t('recurring.confirmBody', { name: rule.name, amount: money(rule.amountMinor, rule.currency) }),
    });
    if (!ok) return;
    try {
      await confirmOccurrence(db, rule.id, dueDate);
      toast({ message: t('recurring.recorded') });
    } catch (failure) {
      toast({ message: errorMessage(failure) });
    }
  };

  return (
    <Screen title={t('recurring.title')} footer={<Button label={kind === 'income' ? t('recurring.addIncome') : t('recurring.addExpense')} icon="add" onPress={() => router.push({ pathname: '/recurring/edit', params: { kind } })} />}>
      <T tone="muted">{t('recurring.hint')}</T>

      {awaiting.length > 0 ? (
        <Section title={t('recurring.awaiting')}>
          <Stacked gap={space.sm}>
            {awaiting.map((occurrence) => (
              <Card key={`${occurrence.rule.id}${occurrence.dueDate}`}>
                <Row between>
                  <T weight="medium" numberOfLines={1} style={{ flexShrink: 1 }}>
                    {occurrence.rule.name}
                  </T>
                  <Money minor={occurrence.rule.amountMinor} currency={occurrence.rule.currency} />
                </Row>
                <Row between>
                  <T variant="small" tone="muted">
                    {formatDate(occurrence.dueDate, settings.language)}
                  </T>
                  {occurrence.overdue ? <Badge label={t('debtStatus.overdue')} tone="negative" /> : <Badge label={t('recurring.planned')} />}
                </Row>
                <Row gap={space.sm}>
                  <Button label={occurrence.rule.kind === 'income' ? t('recurring.received') : t('recurring.paid')} compact onPress={() => void markPaid(occurrence)} />
                  <Button label={t('recurring.skip')} compact kind="secondary" onPress={() => void skipOccurrence(db, occurrence.rule.id, occurrence.dueDate)} />
                </Row>
              </Card>
            ))}
          </Stacked>
        </Section>
      ) : null}

      <Segmented
        value={kind}
        onChange={setKind}
        options={[
          { value: 'income', label: t('recurring.tabIncome') },
          { value: 'expense', label: t('recurring.tabExpense') },
        ]}
      />

      {rules.length === 0 ? (
        <EmptyState icon="repeat-outline" title={kind === 'income' ? t('recurring.emptyIncome') : t('recurring.emptyTitle')} body={kind === 'income' ? t('recurring.emptyIncomeBody') : t('recurring.emptyBody')} />
      ) : (
        <Card>
          {rules.map((rule) => {
            const next = occurrencesBetween(rule, today(), addDays(today(), 800))[0];
            const when = !rule.active ? t('recurring.pausedLabel') : next ? t('recurring.next', { date: formatDate(next, settings.language) }) : t('recurring.ended');
            return (
              <ListRow
                key={rule.id}
                icon={rule.autoPost ? 'flash-outline' : 'hand-left-outline'}
                title={rule.name}
                subtitle={`${money(rule.amountMinor, rule.currency)} · ${when}`}
                chevron={false}
                onPress={() => router.push({ pathname: '/recurring/edit', params: { id: rule.id } })}
                actions={<Toggle label={`${t('recurring.active')}: ${rule.name}`} value={rule.active} onChange={(value) => void setRuleActive(db, rule.id, value)} />}
              />
            );
          })}
          {monthlyTotal > 0 ? <StatLine label={kind === 'income' ? t('recurring.monthlyIncome') : t('reports.recurringMonthly')} minor={monthlyTotal} currency={settings.baseCurrency} /> : null}
        </Card>
      )}

      {data.recorded.length > 0 ? (
        <Section title={t('recurring.recentlyRecorded')}>
          <Card>
            {data.recorded.map((tx) => (
              <TransactionRow key={tx.id} tx={tx} />
            ))}
          </Card>
        </Section>
      ) : null}
    </Screen>
  );
}
