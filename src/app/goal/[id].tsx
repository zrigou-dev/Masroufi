import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';

import { getAccount } from '@/data/accounts';
import { addAllocation, deleteGoal, getGoal, listAllocations } from '@/data/goals';
import { formatDate } from '@/domain/dates';
import { parseAmount } from '@/domain/money';
import { useApp, useQuery } from '@/state/app';
import { Badge, Button, Card, EmptyState, ErrorState, IconButton, ListRow, Loading, ProgressBar, Row, Screen, Section, T } from '@/ui/components/core';
import { useErrorMessage, useFeedback } from '@/ui/components/feedback';
import { Money, StatLine } from '@/ui/components/finance';
import { Field, FieldError } from '@/ui/components/forms';
import { space } from '@/ui/theme';

export default function GoalDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, settings, db } = useApp();
  const router = useRouter();
  const { confirm } = useFeedback();
  const errorMessage = useErrorMessage();
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data, error: loadError, reload } = useQuery(
    async (conn) => {
      const found = await getGoal(conn, id);
      return {
        found,
        allocations: await listAllocations(conn, id),
        account: found?.goal.linkedAccountId ? await getAccount(conn, found.goal.linkedAccountId) : null,
      };
    },
    [id],
  );

  if (loadError) return <ErrorState onRetry={reload} />;
  if (!data) {
    return (
      <Screen scroll={false}>
        <Loading />
      </Screen>
    );
  }
  if (!data.found) {
    return (
      <Screen>
        <EmptyState icon="flag-outline" title={t('goals.gone')} />
      </Screen>
    );
  }

  const { goal, status } = data.found;

  const allocate = async (sign: 1 | -1) => {
    const minor = parseAmount(amount, goal.currency);
    if (!minor) return setError(t('errors.invalid_amount'));
    try {
      await addAllocation(db, id, sign * minor);
      setAmount('');
      setError(null);
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  const remove = async () => {
    if (!(await confirm({ title: t('goals.deleteTitle'), message: t('goals.deleteBody'), destructive: true, confirmLabel: t('common.delete') }))) return;
    await deleteGoal(db, id);
    router.back();
  };

  const realismTone = status.realism === 'stretch' || status.realism === 'past_due' ? 'warning' : status.realism === 'unknown' ? 'muted' : 'positive';

  return (
    <Screen title={goal.name} headerRight={<IconButton name="create-outline" label={t('common.edit')} onPress={() => router.push({ pathname: '/goal/edit', params: { id } })} />}>
      <Card>
        <T tone="muted">{t('goals.progress')}</T>
        <Money minor={status.currentMinor} currency={goal.currency} variant="display" weight="bold" />
        <ProgressBar value={status.percent / 100} tone="positive" />
        <StatLine label={t('goals.target')} minor={goal.targetMinor} currency={goal.currency} />
        <StatLine label={t('goals.remaining')} minor={status.remainingMinor} currency={goal.currency} />
        {status.suggestedMonthlyMinor ? <StatLine label={t('goals.suggested')} minor={status.suggestedMonthlyMinor} currency={goal.currency} /> : null}
        {goal.targetDate ? (
          <Row between>
            <T tone="muted">{t('goals.targetDate')}</T>
            <T weight="medium">{formatDate(goal.targetDate, settings.language)}</T>
          </Row>
        ) : null}
        <Badge label={t(`goals.realism_${status.realism}`)} tone={realismTone} />
        {goal.notes ? <T variant="small">{goal.notes}</T> : null}
      </Card>

      {goal.mode === 'account' ? (
        <T tone="muted">{t('goals.linkedHint', { account: data.account?.name ?? '' })}</T>
      ) : (
        <Section title={t('goals.allocate')}>
          <T variant="small" tone="muted">
            {t('goals.allocateHint')}
          </T>
          <Field label={t('transaction.amount')} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
          <Row gap={space.sm}>
            <Button label={t('goals.addAllocation')} compact onPress={() => void allocate(1)} />
            <Button label={t('goals.removeAllocation')} compact kind="secondary" onPress={() => void allocate(-1)} />
          </Row>
          <FieldError message={error} />
          {data.allocations.length > 0 ? (
            <Card>
              {data.allocations.map((item) => (
                <ListRow key={item.id} title={formatDate(item.allocatedOn, settings.language)} subtitle={item.note ?? undefined} trailing={<Money minor={item.amountMinor} currency={goal.currency} signed tone={item.amountMinor > 0 ? 'positive' : 'negative'} />} />
              ))}
            </Card>
          ) : null}
        </Section>
      )}
      <Button label={t('common.delete')} kind="danger" icon="trash-outline" onPress={() => void remove()} />
    </Screen>
  );
}
