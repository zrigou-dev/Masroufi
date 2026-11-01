import { useRouter } from 'expo-router';
import { useState } from 'react';

import { listBudgetStatuses } from '@/data/budgets';
import { getComparison, getDailySpending, getMoneyFlow, getMonthlyTrend, getPositions, getCashFlow, getMovements, incomeByCategory, spendingByAccount, spendingByCategory } from '@/data/finance';
import { listGoals } from '@/data/goals';
import { listRules } from '@/data/recurring';
import { formatDate } from '@/domain/dates';
import { formatMoney } from '@/domain/money';
import { monthlyFactor } from '@/domain/recurrence';
import { buildPrintableHtml, shareAsPdf } from '@/platform/print';
import { useApp, useQuery } from '@/state/app';
import { Button, Card, Divider, EmptyState, ErrorState, Loading, ProgressBar, Row, Screen, Section, Stacked, T } from '@/ui/components/core';
import { useErrorMessage, useFeedback } from '@/ui/components/feedback';
import { DailyBars, MonthBars, PeriodSwitcher, ShareBars, StackedShare, StatLine, TrendColumns, useCategoryName, useMoney, usePeriod } from '@/ui/components/finance';
import { Chip, ChipRow } from '@/ui/components/forms';
import { space } from '@/ui/theme';

/** A flow row earns its place only when money actually moved there. */
function FlowLine({ label, minor, currency }: { label: string; minor: number; currency: string }) {
  return minor === 0 ? null : <StatLine label={label} minor={minor} currency={currency} />;
}

export default function Reports() {
  const { t, settings, rtl } = useApp();
  const router = useRouter();
  const period = usePeriod();
  const nameOf = useCategoryName();
  const money = useMoney();
  const { toast } = useFeedback();
  const errorMessage = useErrorMessage();
  const [chosen, setChosen] = useState<string | null>(null);
  const currency = chosen ?? settings.baseCurrency;
  const { range } = period;

  const { data, error, reload } = useQuery(
    async (db) => ({
      flow: (await getCashFlow(db, range)).find((f) => f.currency === currency),
      currencies: (await getPositions(db)).map((p) => p.currency),
      categories: await spendingByCategory(db, range, currency),
      income: await incomeByCategory(db, range, currency),
      byAccount: await spendingByAccount(db, range, currency),
      movements: await getMovements(db, range, currency),
      moneyFlow: await getMoneyFlow(db, range, currency),
      comparison: await getComparison(db, range, currency),
      daily: await getDailySpending(db, range, currency),
      trend: await getMonthlyTrend(db, currency, 6),
      position: (await getPositions(db)).find((p) => p.currency === currency),
      budgets: (await listBudgetStatuses(db)).filter((b) => b.budget.currency === currency),
      goals: (await listGoals(db)).filter((g) => g.goal.currency === currency),
      rules: (await listRules(db, { activeOnly: true })).filter((r) => r.currency === currency),
    }),
    [range.from, range.to, currency],
  );

  if (error) return <ErrorState onRetry={reload} />;
  if (!data) {
    return (
      <Screen hideHeader scroll={false}>
        <Loading />
      </Screen>
    );
  }

  const flow = data.flow ?? { incomeMinor: 0, expenseMinor: 0, netMinor: 0 };
  const months = data.trend.map((p) => ({ ...p, label: formatDate(`${p.month}-01`, settings.language, 'month').split(' ')[0].slice(0, 6) }));
  const recurringOut = Math.round(data.rules.filter((r) => r.kind === 'expense').reduce((sum, r) => sum + r.amountMinor * monthlyFactor(r.frequency, r.intervalCount), 0));
  const hasActivity = data.flow !== undefined || data.movements.transferCount !== 0;
  const drill = (categoryId: string | null) => (categoryId ? () => router.push({ pathname: '/transactions', params: { categoryId, from: range.from, to: range.to } }) : undefined);
  const { moneyFlow, comparison } = data;
  const reducible = data.categories.filter((c) => c.nature === 'discretionary').slice(0, 3);
  const spentChange = comparison.spentNowMinor - comparison.spentBeforeMinor;
  const printable = (minor: number) => formatMoney(minor, currency, settings.language).replace(/[⁦⁩]/g, '');

  const exportPdf = async () => {
    try {
      await shareAsPdf(
        buildPrintableHtml(t('reports.title'), `${formatDate(range.from, settings.language)} – ${formatDate(range.to, settings.language)}`, [
          {
            title: t('reports.cashFlow'),
            rows: [[t('home.income'), printable(flow.incomeMinor)], [t('home.expenses'), printable(flow.expenseMinor)], [t('home.netFlow'), printable(flow.netMinor)]],
          },
          { title: t('reports.byCategory'), rows: data.categories.map((c) => [nameOf(c), printable(c.minor)]) },
          {
            title: t('reports.movements'),
            rows: [[t('reports.transfers'), printable(data.movements.transfersMinor)], [t('reports.repaid'), printable(data.movements.repaidMinor)], [t('reports.collected'), printable(data.movements.collectedMinor)]],
          },
        ], rtl),
      );
    } catch (failure) {
      toast({ message: errorMessage(failure) });
    }
  };

  return (
    <Screen hideHeader wide>
      <Row between>
        <T variant="heading" weight="bold">
          {t('tabs.reports')}
        </T>
        <Button label={t('reports.pdf')} icon="document-text-outline" compact kind="secondary" onPress={() => void exportPdf()} />
      </Row>
      <PeriodSwitcher period={period} />
      {data.currencies.length > 1 ? (
        <ChipRow>
          {data.currencies.map((code) => (
            <Chip key={code} label={code} selected={code === currency} onPress={() => setChosen(code)} />
          ))}
        </ChipRow>
      ) : null}

      <Card>
        <T weight="semibold">{t('reports.cashFlow')}</T>
        <StatLine label={t('home.income')} minor={flow.incomeMinor} currency={currency} tone="positive" />
        <StatLine label={t('home.expenses')} minor={flow.expenseMinor} currency={currency} tone="negative" />
        <Divider />
        <StatLine label={t('home.netFlow')} minor={flow.netMinor} currency={currency} signed tone={flow.netMinor < 0 ? 'negative' : 'positive'} />
      </Card>

      {!hasActivity ? <EmptyState icon="bar-chart-outline" title={t('reports.emptyTitle')} body={t('reports.emptyBody')} /> : null}

      {hasActivity ? (
        <Section title={t('reports.flowTitle')}>
          <Card>
            <T variant="small" weight="semibold" tone="positive">
              {t('reports.cameFrom')}
            </T>
            <FlowLine label={t('reports.regularIncome')} minor={moneyFlow.regularIncomeMinor} currency={currency} />
            <FlowLine label={t('reports.extraIncome')} minor={moneyFlow.extraIncomeMinor} currency={currency} />
            <FlowLine label={t('reports.collected')} minor={moneyFlow.collectedMinor} currency={currency} />
            <FlowLine label={t('reports.borrowed')} minor={moneyFlow.borrowedMinor} currency={currency} />
            <Divider />
            <T variant="small" weight="semibold" tone="negative">
              {t('reports.wentTo')}
            </T>
            <FlowLine label={t('reports.recurringSpend')} minor={moneyFlow.recurringMinor} currency={currency} />
            <FlowLine label={t('reports.everydaySpend')} minor={moneyFlow.everydayMinor} currency={currency} />
            <FlowLine label={t('reports.occasionalSpend')} minor={moneyFlow.occasionalMinor} currency={currency} />
            <FlowLine label={t('reports.repaid')} minor={moneyFlow.repaidMinor} currency={currency} />
            <FlowLine label={t('reports.lent')} minor={moneyFlow.lentMinor} currency={currency} />
          </Card>
        </Section>
      ) : null}

      {comparison.hasPrevious && comparison.spentNowMinor !== 0 ? (
        <Section title={t('reports.compareTitle')}>
          <Card>
            <StatLine label={t('reports.compareNow')} minor={comparison.spentNowMinor} currency={currency} />
            <StatLine label={t('reports.compareBefore')} minor={comparison.spentBeforeMinor} currency={currency} tone="muted" />
            <T variant="small" tone={spentChange > 0 ? 'negative' : 'positive'}>
              {spentChange > 0 ? t('reports.compareMore', { amount: money(spentChange, currency) }) : t('reports.compareLess', { amount: money(-spentChange, currency) })}
            </T>
            <Divider />
            {comparison.changes.slice(0, 4).map((change) => (
              <StatLine key={change.categoryId ?? 'none'} label={nameOf(change)} minor={change.nowMinor - change.beforeMinor} currency={currency} signed tone={change.nowMinor > change.beforeMinor ? 'negative' : 'positive'} />
            ))}
            <T variant="caption" tone="faint">
              {t('reports.compareHint')}
            </T>
          </Card>
        </Section>
      ) : null}

      {data.categories.length > 0 ? (
        <Section title={t('reports.byCategory')}>
          <Card>
            <StackedShare items={data.categories.map((c) => ({ key: c.categoryId ?? 'none', minor: c.minor, color: c.color ?? undefined }))} />
            <ShareBars
              currency={currency}
              totalMinor={flow.expenseMinor}
              items={data.categories.map((c) => ({ key: c.categoryId ?? 'none', label: nameOf(c), minor: c.minor, color: c.color ?? undefined, onPress: drill(c.categoryId) }))}
            />
            {flow.incomeMinor > 0 ? (
              <T variant="caption" tone="faint">
                {t('reports.ofIncome', { percent: Math.round((flow.expenseMinor / flow.incomeMinor) * 100) })}
              </T>
            ) : null}
          </Card>
        </Section>
      ) : null}

      {reducible.length > 0 ? (
        <Section title={t('reports.reduceTitle')}>
          <Card>
            <T variant="small" tone="muted">
              {t('reports.reduceHint')}
            </T>
            {reducible.map((c) => (
              <StatLine key={c.categoryId ?? 'none'} label={nameOf(c)} minor={c.minor} currency={currency} />
            ))}
          </Card>
        </Section>
      ) : null}

      {data.daily.length > 1 ? (
        <Section title={t('reports.daily')}>
          <Card>
            <DailyBars days={data.daily} range={range} currency={currency} />
          </Card>
        </Section>
      ) : null}

      {data.income.length > 0 ? (
        <Section title={t('reports.incomeByCategory')}>
          <Card>
            <ShareBars currency={currency} items={data.income.map((c) => ({ key: c.categoryId ?? 'none', label: nameOf(c), minor: c.minor, color: c.color ?? undefined }))} />
          </Card>
        </Section>
      ) : null}

      {data.byAccount.length > 0 ? (
        <Section title={t('reports.byAccount')}>
          <Card>
            <ShareBars currency={currency} items={data.byAccount.map((a) => ({ key: a.accountId, label: a.name, minor: a.minor }))} />
          </Card>
        </Section>
      ) : null}

      <Section title={t('reports.movements')}>
        <Card>
          <StatLine label={t('reports.transfers')} minor={data.movements.transfersMinor} currency={currency} />
          <StatLine label={t('reports.repaid')} minor={data.movements.repaidMinor} currency={currency} />
          <StatLine label={t('reports.collected')} minor={data.movements.collectedMinor} currency={currency} />
          <StatLine label={t('reports.borrowed')} minor={data.movements.borrowedMinor} currency={currency} />
          <StatLine label={t('reports.lent')} minor={data.movements.lentMinor} currency={currency} />
          <T variant="caption" tone="faint">
            {t('reports.movementsHint')}
          </T>
        </Card>
      </Section>

      <Section title={t('reports.incomeVsExpense')}>
        <Card>
          <MonthBars currency={currency} points={months.map((m) => ({ label: m.label, a: m.incomeMinor, b: m.expenseMinor }))} />
          <Row gap={space.lg}>
            <T variant="caption" tone="positive">
              ■ {t('home.income')}
            </T>
            <T variant="caption" tone="negative">
              ■ {t('home.expenses')}
            </T>
          </Row>
        </Card>
      </Section>

      <Section title={t('reports.balanceTrend')}>
        <Card>
          <TrendColumns currency={currency} points={months.map((m) => ({ label: m.label, value: m.closingMinor }))} />
        </Card>
      </Section>

      <Section title={t('reports.outstanding')} action={t('common.seeAll')} onAction={() => router.push('/debts')}>
        <Card>
          <StatLine label={t('home.iOwe')} minor={data.position?.liabilityMinor ?? 0} currency={currency} tone="negative" />
          <StatLine label={t('home.owedToMe')} minor={data.position?.receivableMinor ?? 0} currency={currency} tone="positive" />
        </Card>
      </Section>

      {data.budgets.length > 0 ? (
        <Section title={t('reports.budgets')} action={t('common.seeAll')} onAction={() => router.push('/budgets')}>
          <Card>
            <Stacked>
              {data.budgets.map(({ budget, status }) => (
                <Stacked key={budget.id} gap={space.xs}>
                  <Row between>
                    <T variant="small" numberOfLines={1} style={{ flexShrink: 1 }}>
                      {budget.name}
                    </T>
                    <T variant="small" tone={status.remainingMinor < 0 ? 'negative' : 'muted'}>
                      {money(status.spentMinor, budget.currency)} / {money(budget.amountMinor, budget.currency)}
                    </T>
                  </Row>
                  <ProgressBar value={status.percentUsed / 100} tone={status.remainingMinor < 0 ? 'negative' : 'primary'} />
                </Stacked>
              ))}
            </Stacked>
          </Card>
        </Section>
      ) : null}

      {data.goals.length > 0 ? (
        <Section title={t('reports.goals')} action={t('common.seeAll')} onAction={() => router.push('/goals')}>
          <Card>
            <Stacked>
              {data.goals.map(({ goal, status }) => (
                <Stacked key={goal.id} gap={space.xs}>
                  <Row between>
                    <T variant="small" numberOfLines={1} style={{ flexShrink: 1 }}>
                      {goal.name}
                    </T>
                    <T variant="small" tone="muted">
                      {money(status.currentMinor, goal.currency)} / {money(goal.targetMinor, goal.currency)}
                    </T>
                  </Row>
                  <ProgressBar value={status.percent / 100} tone="positive" />
                </Stacked>
              ))}
            </Stacked>
          </Card>
        </Section>
      ) : null}

      {recurringOut > 0 ? (
        <Section title={t('reports.recurring')} action={t('common.seeAll')} onAction={() => router.push('/recurring')}>
          <Card>
            <StatLine label={t('reports.recurringMonthly')} minor={recurringOut} currency={currency} />
            <T variant="caption" tone="faint">
              {t('insight.basisEstimate')}
            </T>
          </Card>
        </Section>
      ) : null}
    </Screen>
  );
}
