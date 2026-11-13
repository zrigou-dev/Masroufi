import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { listAccounts } from '@/data/accounts';
import { listBudgetStatuses, summarizeBudgets } from '@/data/budgets';
import { getAvailableToSpend, getCashFlow, getComparison, getObligations, getPositions, getSaved, spendingByCategory } from '@/data/finance';
import { listGoals } from '@/data/goals';
import { getInsights } from '@/data/insights';
import { listRules } from '@/data/recurring';
import { getQuickItems, recordQuickItem, type QuickItem } from '@/data/templates';
import { deleteTransaction, listTransactions } from '@/data/transactions';
import { daysBetween, today } from '@/domain/dates';
import { toDecimalString } from '@/domain/money';
import { monthlyFactor } from '@/domain/recurrence';
import { useApp, useQuery } from '@/state/app';
import { Button, Card, Columns, Divider, EmptyState, ErrorState, Icon, IconButton, type IconName, Loading, ProgressBar, Row, Screen, Section, Stacked, T } from '@/ui/components/core';
import { useErrorMessage, useFeedback } from '@/ui/components/feedback';
import { Breakdown, ChangePill, Hero, HeroStat, Metric, topSlices } from '@/ui/components/dashboard';
import { InsightCard } from '@/ui/components/insight';
import { ObligationRow, PeriodSwitcher, StatLine, TransactionRow, useCategoryName, useMoney, usePeriod } from '@/ui/components/finance';
import { radius, space } from '@/ui/theme';

const BACKUP_NUDGE_DAYS = 30;
const BACKUP_NUDGE_MIN_TRANSACTIONS = 15;

function Tile({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const { colors } = useApp();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.tile, { backgroundColor: colors.surface, borderColor: colors.border }, pressed && { opacity: 0.7 }]}>
      <View style={[styles.tileIcon, { backgroundColor: colors.primarySoft }]}>
        <Icon name={icon} size={20} tone="primary" />
      </View>
      <T variant="caption" weight="medium" center numberOfLines={2}>
        {label}
      </T>
    </Pressable>
  );
}

function QuickButton({ item, onRecord, onOpen }: { item: QuickItem; onRecord: () => void; onOpen: () => void }) {
  const { colors } = useApp();
  const money = useMoney();
  const nameOf = useCategoryName();
  const { data: name } = useQuery(
    async (conn) => {
      const row = await conn.get<{ key: string | null; name: string }>('SELECT key, name FROM categories WHERE id = ?', [item.categoryId]);
      return row ? nameOf(row) : '';
    },
    [item.categoryId],
  );
  const label = item.label ?? name ?? '';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={item.amountMinor !== null ? `${label}, ${money(item.amountMinor, item.currency)}` : label}
      onPress={item.oneTap ? onRecord : onOpen}
      onLongPress={onOpen}
      style={({ pressed }) => [styles.quick, { backgroundColor: colors.surface, borderColor: item.pinned ? colors.primary : colors.border }, pressed && { opacity: 0.7 }]}>
      <T variant="small" weight="medium" numberOfLines={1}>
        {label}
      </T>
      {item.amountMinor !== null ? (
        <T variant="caption" tone="muted" numberOfLines={1}>
          {money(item.amountMinor, item.currency)}
        </T>
      ) : null}
    </Pressable>
  );
}

function SetupStep({ done, label, onPress }: { done: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ checked: done }} disabled={done} onPress={onPress} style={styles.step}>
      <Icon name={done ? 'checkmark-circle' : 'ellipse-outline'} tone={done ? 'positive' : 'faint'} />
      <T tone={done ? 'muted' : 'default'} style={{ flex: 1 }}>
        {label}
      </T>
    </Pressable>
  );
}

export default function Home() {
  const { t, settings, updateSetting, db } = useApp();
  const router = useRouter();
  const period = usePeriod();
  const nameOf = useCategoryName();
  const money = useMoney();
  const { toast } = useFeedback();
  const errorMessage = useErrorMessage();
  const currency = settings.baseCurrency;

  const { data, error, reload } = useQuery(
    async (conn) => {
      const budgets = await listBudgetStatuses(conn);
      const rules = await listRules(conn, { activeOnly: true });
      const count = await conn.get<{ n: number }>(`SELECT COUNT(*) AS n FROM transactions WHERE type IN ('income','expense') AND deleted_at IS NULL`);
      return {
        positions: await getPositions(conn),
        flows: await getCashFlow(conn, period.range),
        obligations: await getObligations(conn, 14),
        budgets,
        budget: summarizeBudgets(budgets, currency),
        goals: await listGoals(conn),
        recent: await listTransactions(conn, { limit: 5 }),
        accounts: await listAccounts(conn),
        available: await getAvailableToSpend(conn, currency, settings.horizonDays),
        saved: await getSaved(conn, currency),
        quick: await getQuickItems(conn, 8),
        rules,
        transactionCount: count?.n ?? 0,
        insights: await getInsights(conn, period.range, currency, nameOf),
        categories: await spendingByCategory(conn, period.range, currency),
        comparison: await getComparison(conn, period.range, currency),
      };
    },
    [period.range.from, period.range.to, currency, settings.horizonDays, settings.language],
  );

  const header = (
    <Row between>
      <T variant="heading" weight="bold">
        {t('app.name')}
      </T>
      <Row gap={0}>
        <IconButton
          name={settings.hideAmounts ? 'eye-off-outline' : 'eye-outline'}
          label={settings.hideAmounts ? t('home.showAmounts') : t('home.hideAmounts')}
          onPress={() => void updateSetting('hideAmounts', !settings.hideAmounts)}
        />
        <IconButton name="search-outline" label={t('transactions.search')} onPress={() => router.push('/transactions')} />
        <IconButton name="menu-outline" label={t('more.title')} onPress={() => router.push('/more')} />
      </Row>
    </Row>
  );

  if (error) return <ErrorState onRetry={reload} />;
  if (!data) {
    return (
      <Screen hideHeader scroll={false}>
        <Loading />
      </Screen>
    );
  }

  if (data.accounts.length === 0) {
    return (
      <Screen hideHeader>
        {header}
        <EmptyState icon="wallet-outline" title={t('home.emptyTitle')} body={t('home.emptyBody')} action={t('accounts.add')} onAction={() => router.push('/account/edit')} />
      </Screen>
    );
  }

  const position = data.positions.find((p) => p.currency === currency);
  const others = data.positions.filter((p) => p.currency !== currency);
  const flow = data.flows.find((f) => f.currency === currency) ?? { incomeMinor: 0, expenseMinor: 0, netMinor: 0 };
  const overdue = data.obligations.filter((o) => o.overdue);
  const upcoming = data.obligations.filter((o) => !o.overdue).slice(0, 4);
  const recurringOut = Math.round(data.rules.filter((r) => r.kind === 'expense' && r.currency === currency).reduce((sum, r) => sum + r.amountMinor * monthlyFactor(r.frequency, r.intervalCount), 0));

  const hasIncome = data.rules.some((r) => r.kind === 'income');
  const hasBill = data.rules.some((r) => r.kind === 'expense');
  const hasBudget = data.budgets.length > 0;
  const setupDone = hasIncome && hasBill && hasBudget;

  const backupAge = settings.lastBackupAt ? daysBetween(settings.lastBackupAt.slice(0, 10), today()) : null;
  const needsBackup = data.transactionCount >= BACKUP_NUDGE_MIN_TRANSACTIONS && (backupAge === null || backupAge >= BACKUP_NUDGE_DAYS);

  const recordQuick = async (item: QuickItem) => {
    try {
      const id = await recordQuickItem(db, item);
      toast({
        message: t('transaction.savedAmount', { amount: money(item.amountMinor ?? 0, item.currency) }),
        actionLabel: t('common.undo'),
        onAction: () => void deleteTransaction(db, id).catch((failure: unknown) => toast({ message: errorMessage(failure) })),
      });
    } catch (failure) {
      toast({ message: errorMessage(failure) });
    }
  };

  const openQuick = (item: QuickItem) =>
    router.push({
      pathname: '/transaction/new',
      params: {
        type: item.kind,
        categoryId: item.categoryId,
        accountId: item.accountId,
        description: item.description ?? '',
        amount: item.amountMinor !== null ? toDecimalString(item.amountMinor, item.currency) : '',
      },
    });

  const spendSlices = topSlices(
    data.categories.map((c) => ({ key: c.categoryId ?? 'none', label: nameOf(c), minor: c.minor, color: c.color ?? undefined, onPress: c.categoryId ? () => router.push({ pathname: '/transactions', params: { categoryId: c.categoryId as string, from: period.range.from, to: period.range.to } }) : undefined })),
    5,
    t('home.otherCategories'),
  );
  const keptPercent = flow.incomeMinor > 0 ? Math.round(((flow.incomeMinor - flow.expenseMinor) / flow.incomeMinor) * 100) : null;
  const attention = [...overdue.slice(0, 4), ...upcoming];

  const left = (
    <>
      <Hero label={t('home.totalAvailable')} minor={position?.ownedMinor ?? 0} currency={currency}>
        <Row gap={space.sm} style={{ marginTop: space.md }}>
          <HeroStat label={t('planning.available')} minor={data.available.availableMinor} currency={currency} onPress={() => router.push('/planning')} />
          <HeroStat label={t('home.saved')} minor={data.saved.totalMinor} currency={currency} onPress={() => router.push('/goals')} />
        </Row>
      </Hero>

      <View style={styles.tiles}>
        <Tile icon="remove-circle-outline" label={t('txType.expense')} onPress={() => router.push('/transaction/new')} />
        <Tile icon="add-circle-outline" label={t('txType.income')} onPress={() => router.push({ pathname: '/transaction/new', params: { type: 'income' } })} />
        <Tile icon="cash-outline" label={t('transaction.withdrawal')} onPress={() => router.push({ pathname: '/transaction/new', params: { preset: 'withdrawal' } })} />
        <Tile icon="swap-horizontal-outline" label={t('txType.transfer')} onPress={() => router.push({ pathname: '/transaction/new', params: { type: 'transfer' } })} />
      </View>

      {needsBackup ? (
        <Card onPress={() => router.push('/settings/backup')} accessibilityLabel={t('backup.title')}>
          <Row gap={space.md}>
            <Icon name="cloud-download-outline" tone="warning" />
            <T variant="small" style={{ flex: 1 }}>
              {backupAge === null ? t('home.backupNever') : t('home.backupOld', { days: backupAge })}
            </T>
          </Row>
        </Card>
      ) : null}

      {!setupDone && !settings.setupDismissed ? (
        <Card>
          <Row between>
            <T weight="semibold">{t('setup.title')}</T>
            <IconButton name="close" label={t('common.close')} tone="faint" onPress={() => void updateSetting('setupDismissed', true)} />
          </Row>
          <T variant="small" tone="muted">
            {t('setup.body')}
          </T>
          <SetupStep done={hasIncome} label={t('setup.income')} onPress={() => router.push({ pathname: '/recurring/edit', params: { kind: 'income' } })} />
          <SetupStep done={hasBill} label={t('setup.bills')} onPress={() => router.push('/recurring/edit')} />
          <SetupStep done={hasBudget} label={t('setup.budget')} onPress={() => router.push('/budget/edit')} />
        </Card>
      ) : null}

      {data.quick.length > 0 ? (
        <Section title={t('home.quick')} action={t('home.quickManage')} onAction={() => router.push('/templates')}>
          <View style={styles.quickWrap}>
            {data.quick.map((item) => (
              <QuickButton key={item.key} item={item} onRecord={() => void recordQuick(item)} onOpen={() => openQuick(item)} />
            ))}
          </View>
        </Section>
      ) : (
        <T variant="small" tone="muted">
          {t('home.quickHint')}
        </T>
      )}

      <Section title={t('home.accounts')} action={t('common.seeAll')} onAction={() => router.push('/accounts')}>
        <Card style={{ gap: 0 }}>
          {data.accounts
            .filter((a) => a.currency === currency)
            .map((account, index) => (
              <View key={account.id}>
                {index > 0 ? <Divider /> : null}
                <Pressable accessibilityRole="button" accessibilityLabel={account.name} onPress={() => router.push({ pathname: '/account/[id]', params: { id: account.id } })} style={({ pressed }) => [styles.accountRow, pressed && { opacity: 0.7 }]}>
                  <StatLine label={account.name} minor={account.balanceMinor} currency={account.currency} tone={account.balanceMinor < 0 ? 'negative' : undefined} />
                </Pressable>
              </View>
            ))}
          {others.map((p) => (
            <StatLine key={p.currency} label={t('home.otherCurrency', { currency: p.currency })} minor={p.ownedMinor} currency={p.currency} />
          ))}
        </Card>
      </Section>

      <Section title={t('home.position2')}>
        <Card>
          <Row gap={space.md}>
            <Metric icon="arrow-up-circle-outline" label={t('home.iOwe')} minor={position?.liabilityMinor ?? 0} currency={currency} tone="negative" />
            <Metric icon="arrow-down-circle-outline" label={t('home.owedToMe')} minor={position?.receivableMinor ?? 0} currency={currency} tone="positive" />
          </Row>
          <Divider />
          <StatLine label={t('home.net')} minor={position?.netMinor ?? 0} currency={currency} />
          <T variant="caption" tone="faint">
            {t('home.netHint')}
          </T>
          <Button label={t('debts.recordPayment')} kind="ghost" compact icon="people-outline" onPress={() => router.push('/debts')} />
        </Card>
      </Section>
    </>
  );

  const right = (
    <>
      <Section title={t('home.activity')}>
        <PeriodSwitcher period={period} />
        <Card>
          <Row gap={space.md} style={{ alignItems: 'flex-start' }}>
            <Metric icon="arrow-down" label={t('home.income')} minor={flow.incomeMinor} currency={currency} tone="positive" />
            <Metric icon="arrow-up" label={t('home.expenses')} minor={flow.expenseMinor} currency={currency} tone="negative" />
            <Metric icon="swap-vertical" label={t('home.netFlow')} minor={flow.netMinor} currency={currency} tone={flow.netMinor < 0 ? 'negative' : 'primary'} signed />
          </Row>
          {keptPercent !== null || (data.comparison.hasPrevious && data.comparison.spentBeforeMinor > 0) ? (
            <>
              <Divider />
              <Row between>
                {keptPercent !== null ? (
                  <T variant="small" tone={keptPercent < 0 ? 'negative' : 'muted'}>
                    {t('home.keptPercent', { percent: keptPercent })}
                  </T>
                ) : (
                  <View />
                )}
                <Row gap={space.xs}>
                  <ChangePill now={data.comparison.spentNowMinor} before={data.comparison.spentBeforeMinor} />
                  <T variant="caption" tone="faint">
                    {t('home.vsBefore')}
                  </T>
                </Row>
              </Row>
            </>
          ) : null}
          {data.budget ? (
            <Pressable accessibilityRole="button" accessibilityLabel={t('home.budgetLeft')} onPress={() => router.push('/budgets')} style={{ gap: space.xs, marginTop: space.xs }}>
              <StatLine label={t('home.budgetLeft')} minor={data.budget.remainingMinor} currency={currency} tone={data.budget.remainingMinor < 0 ? 'negative' : 'positive'} />
              <ProgressBar value={data.budget.spentMinor / data.budget.limitMinor} tone={data.budget.remainingMinor < 0 ? 'negative' : 'primary'} />
            </Pressable>
          ) : null}
        </Card>
      </Section>

      <Section title={t('home.spendingTitle')} action={t('home.fullReport')} onAction={() => router.push('/reports')}>
        <Card>
          {spendSlices.length === 0 ? (
            <T tone="muted">{t('home.spendingEmpty')}</T>
          ) : (
            <Breakdown slices={spendSlices} currency={currency} totalMinor={flow.expenseMinor} />
          )}
        </Card>
      </Section>

      {attention.length > 0 || recurringOut > 0 ? (
        <Section title={overdue.length > 0 ? t('home.attention') : t('home.upcoming')} action={t('common.seeAll')} onAction={() => router.push('/calendar')}>
          <Card>
            {attention.map((item) => (
              <ObligationRow key={item.key} item={item} />
            ))}
            {recurringOut > 0 ? <StatLine label={t('reports.recurringMonthly')} minor={recurringOut} currency={currency} /> : null}
          </Card>
        </Section>
      ) : null}

      {data.insights.length > 0 ? (
        <Section title={t('home.summary')} action={t('common.seeAll')} onAction={() => router.push('/insights')}>
          <Stacked gap={space.sm}>
            {data.insights.slice(0, 2).map((insight, index) => (
              <InsightCard key={`${insight.kind}${index}`} insight={insight} />
            ))}
          </Stacked>
        </Section>
      ) : null}

      {data.goals.length > 0 ? (
        <Section title={t('home.goals')} action={t('common.seeAll')} onAction={() => router.push('/goals')}>
          <Card>
            <Stacked>
              {data.goals.slice(0, 3).map(({ goal, status }) => (
                <View key={goal.id} style={{ gap: space.xs }}>
                  <Row between>
                    <T variant="small" weight="medium" style={{ flexShrink: 1 }} numberOfLines={1}>
                      {goal.name}
                    </T>
                    <T variant="small" tone="muted">
                      {Math.round(status.percent)}%
                    </T>
                  </Row>
                  <ProgressBar value={status.percent / 100} tone="positive" />
                </View>
              ))}
            </Stacked>
          </Card>
        </Section>
      ) : null}

      <Section title={t('home.recent')} action={t('common.seeAll')} onAction={() => router.push('/transactions')}>
        {data.recent.length === 0 ? (
          <Card>
            <EmptyState icon="receipt-outline" title={t('transactions.emptyTitle')} body={t('transactions.emptyBody')} />
          </Card>
        ) : (
          <Card style={{ paddingVertical: space.sm }}>
            {data.recent.map((tx) => (
              <TransactionRow key={tx.id} tx={tx} />
            ))}
          </Card>
        )}
      </Section>
    </>
  );

  return (
    <Screen hideHeader wide>
      {header}
      <Columns left={left} right={right} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', gap: space.sm },
  tile: { flex: 1, alignItems: 'center', gap: space.xs, paddingVertical: space.md, paddingHorizontal: space.xs, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, minHeight: 88 },
  tileIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  quickWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  quick: { minWidth: 92, maxWidth: 170, minHeight: 52, justifyContent: 'center', paddingHorizontal: space.md, paddingVertical: space.xs, borderRadius: radius.md, borderWidth: 1 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  stat: { flexGrow: 1, flexBasis: '45%', gap: 2, padding: space.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  accountRow: { paddingVertical: 2 },
  step: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44 },
});
