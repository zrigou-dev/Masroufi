import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';

import { listDebts } from '@/data/debts';
import { averageMonthlyNet, getAvailableToSpend, getCashFlow, getSpendingSplit } from '@/data/finance';
import { listGoals } from '@/data/goals';
import { listRules } from '@/data/recurring';
import { periodRange, today } from '@/domain/dates';
import { simulateRepayment, type PlanDebt, type RepaymentStrategy } from '@/domain/debts';
import { parseAmount } from '@/domain/money';
import { monthlyFactor } from '@/domain/recurrence';
import { useApp, useQuery } from '@/state/app';
import { Badge, Card, Divider, EmptyState, ErrorState, Loading, ProgressBar, Row, Screen, Section, Stacked, T } from '@/ui/components/core';
import { Money, ObligationRow, StatLine, useMoney } from '@/ui/components/finance';
import { Field, Segmented } from '@/ui/components/forms';
import { space } from '@/ui/theme';

const STRATEGIES: RepaymentStrategy[] = ['avalanche', 'snowball', 'due_date', 'priority'];

export default function Planning() {
  const { t, settings, updateSetting, rtl } = useApp();
  const router = useRouter();
  const money = useMoney();
  const currency = settings.baseCurrency;
  const [budgetText, setBudgetText] = useState('');
  const month = periodRange('month', today());

  const { data, error, reload } = useQuery(
    async (db) => ({
      available: await getAvailableToSpend(db, currency, settings.horizonDays),
      averageNet: await averageMonthlyNet(db, currency),
      flow: (await getCashFlow(db, month)).find((f) => f.currency === currency),
      split: await getSpendingSplit(db, month, currency),
      debts: (await listDebts(db, { direction: 'i_owe' })).filter((d) => d.currency === currency && d.state.remainingMinor > 0),
      goals: await listGoals(db),
      rules: (await listRules(db, { activeOnly: true })).filter((r) => r.currency === currency && r.kind === 'expense'),
    }),
    [currency, settings.horizonDays, month.from],
  );

  const plans = useMemo(() => {
    const budget = parseAmount(budgetText, currency);
    if (!data || !budget || data.debts.length === 0) return null;
    const debts: PlanDebt[] = data.debts.map((d) => ({
      id: d.id,
      remainingMinor: d.state.remainingMinor,
      monthlyRateBps: Math.round((d.interestRateBps ?? 0) / 12),
      minimumMinor: 0,
      dueDate: d.state.nextDueDate,
      priority: d.priority,
    }));
    return STRATEGIES.map((strategy) => simulateRepayment(debts, budget, strategy));
  }, [budgetText, currency, data]);

  if (error) return <ErrorState onRetry={reload} />;
  if (!data) {
    return (
      <Screen scroll={false}>
        <Loading />
      </Screen>
    );
  }

  const { available, split } = data;
  const flow = data.flow ?? { incomeMinor: 0, expenseMinor: 0, netMinor: 0 };
  const splitTotal = split.essentialMinor + split.discretionaryMinor + split.unclassifiedMinor;
  const recurring = Math.round(data.rules.reduce((sum, r) => sum + r.amountMinor * monthlyFactor(r.frequency, r.intervalCount), 0));
  const nameOfDebt = (debtId: string) => data.debts.find((d) => d.id === debtId)?.counterparty ?? '';
  const emergency = data.goals.find((g) => g.goal.priority === Math.max(...data.goals.map((x) => x.goal.priority)));

  return (
    <Screen title={t('planning.title')}>
      <Card>
        <T tone="muted">{t('planning.available')}</T>
        <Money minor={available.availableMinor} currency={currency} variant="display" weight="bold" tone={available.availableMinor < 0 ? 'negative' : 'positive'} />
        <Divider />
        <StatLine label={t('planning.liquid')} minor={available.liquidMinor} currency={currency} />
        <StatLine label={t('planning.obligations', { days: available.horizonDays })} minor={-available.obligationsMinor} currency={currency} />
        <StatLine label={t('planning.allocations')} minor={-available.goalAllocationsMinor} currency={currency} />
        <T variant="small" tone="muted">
          {t('planning.explain')}
        </T>
        <Badge label={t('insight.basisEstimate')} tone="warning" />
      </Card>

      <Segmented
        value={String(settings.horizonDays)}
        onChange={(value) => void updateSetting('horizonDays', Number(value))}
        options={[
          { value: '14', label: t('planning.days', { days: 14 }) },
          { value: '30', label: t('planning.days', { days: 30 }) },
          { value: '60', label: t('planning.days', { days: 60 }) },
        ]}
      />

      {available.obligations.length > 0 ? (
        <Section title={t('planning.included')}>
          <Card>
            {available.obligations.map((item) => (
              <ObligationRow key={item.key} item={item} />
            ))}
          </Card>
        </Section>
      ) : null}

      {data.averageNet !== null ? (
        <Card>
          <StatLine label={t('planning.canSave')} minor={data.averageNet} currency={currency} tone={data.averageNet < 0 ? 'negative' : 'positive'} />
          <T variant="caption" tone="faint">
            {t('planning.canSaveHint')}
          </T>
        </Card>
      ) : null}

      <Section title={t('planning.overview')}>
        <Card>
          <StatLine label={t('home.income')} minor={flow.incomeMinor} currency={currency} tone="positive" />
          <StatLine label={t('home.expenses')} minor={flow.expenseMinor} currency={currency} tone="negative" />
          <StatLine label={t('home.netFlow')} minor={flow.netMinor} currency={currency} signed tone={flow.netMinor < 0 ? 'negative' : 'positive'} />
          {recurring > 0 ? <StatLine label={t('reports.recurringMonthly')} minor={recurring} currency={currency} /> : null}
        </Card>
      </Section>

      {splitTotal > 0 ? (
        <Section title={t('planning.split')}>
          <Card>
            <StatLine label={t('planning.essential')} minor={split.essentialMinor} currency={currency} />
            <ProgressBar value={split.essentialMinor / splitTotal} />
            <StatLine label={t('planning.discretionary')} minor={split.discretionaryMinor} currency={currency} />
            <ProgressBar value={split.discretionaryMinor / splitTotal} tone="warning" />
            {split.unclassifiedMinor !== 0 ? <StatLine label={t('planning.unclassified')} minor={split.unclassifiedMinor} currency={currency} tone="muted" /> : null}
          </Card>
        </Section>
      ) : null}

      {emergency ? (
        <Section title={t('planning.topGoal')} action={t('common.seeAll')} onAction={() => router.push('/goals')}>
          <Card>
            <Row between>
              <T weight="medium">{emergency.goal.name}</T>
              <T variant="small" tone="muted">
                {Math.round(emergency.status.percent)}%
              </T>
            </Row>
            <ProgressBar value={emergency.status.percent / 100} tone="positive" />
            <T variant="small" tone="muted">
              {money(emergency.status.currentMinor, emergency.goal.currency)} / {money(emergency.goal.targetMinor, emergency.goal.currency)}
            </T>
          </Card>
        </Section>
      ) : null}

      <Section title={t('planning.compare')}>
        {data.debts.length === 0 ? (
          <EmptyState icon="happy-outline" title={t('planning.noDebts')} />
        ) : (
          <Stacked>
            <T variant="small" tone="muted">
              {t('planning.compareHint')}
            </T>
            <Field label={t('planning.monthlyBudget')} value={budgetText} onChangeText={setBudgetText} keyboardType="decimal-pad" />
            {plans?.map((plan) => (
              <Card key={plan.strategy}>
                <T weight="semibold">{t(`strategy.${plan.strategy}`)}</T>
                <T variant="small" tone="muted">
                  {t(`strategy.${plan.strategy}Hint`)}
                </T>
                {plan.completes ? (
                  <>
                    <Row between style={{ marginTop: space.xs }}>
                      <T tone="muted">{t('planning.duration')}</T>
                      <T weight="medium">{t('planning.months', { months: plan.months })}</T>
                    </Row>
                    <StatLine label={t('planning.interest')} minor={plan.interestMinor} currency={currency} />
                    <T variant="small" tone="muted">
                      {plan.order.map(nameOfDebt).join(rtl ? ' ← ' : ' → ')}
                    </T>
                  </>
                ) : (
                  <T tone="warning">{t('planning.neverEnds')}</T>
                )}
              </Card>
            ))}
            {plans ? (
              <T variant="caption" tone="faint">
                {t('planning.notAdvice')}
              </T>
            ) : null}
          </Stacked>
        )}
      </Section>
    </Screen>
  );
}
