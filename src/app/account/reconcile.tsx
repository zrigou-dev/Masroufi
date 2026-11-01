import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';

import { getAccount, reconcileAccount } from '@/data/accounts';
import { parseAmount } from '@/domain/money';
import { useApp, useQuery } from '@/state/app';
import { Button, Card, Loading, Screen, T } from '@/ui/components/core';
import { useErrorMessage, useFeedback } from '@/ui/components/feedback';
import { StatLine } from '@/ui/components/finance';
import { Field, FieldError, SwitchRow } from '@/ui/components/forms';

export default function Reconcile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, db } = useApp();
  const router = useRouter();
  const { toast } = useFeedback();
  const errorMessage = useErrorMessage();
  const [actual, setActual] = useState('');
  const [note, setNote] = useState('');
  const [asSpending, setAsSpending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { data: account } = useQuery((conn) => getAccount(conn, id), [id]);

  if (!account) {
    return (
      <Screen scroll={false}>
        <Loading />
      </Screen>
    );
  }

  const clean = actual.trim();
  const negative = clean.startsWith('-');
  const parsed = parseAmount(negative ? clean.slice(1) : clean, account.currency);
  const actualMinor = parsed === null ? null : negative ? -parsed : parsed;
  const difference = actualMinor === null ? null : actualMinor - account.balanceMinor;

  const save = async () => {
    if (actualMinor === null) return setError(t('errors.invalid_amount'));
    try {
      const result = await reconcileAccount(db, id, actualMinor, { note, expenseCategoryId: asSpending ? 'cat_other_expense' : null });
      toast({ message: result ? t('accounts.reconciled') : t('accounts.alreadyMatches') });
      router.back();
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  return (
    <Screen title={t('accounts.reconcile')} footer={<Button label={t('accounts.reconcileSave')} onPress={() => void save()} />}>
      <T tone="muted">{t('accounts.reconcileHint')}</T>
      <Card>
        <StatLine label={t('accounts.calculated')} minor={account.balanceMinor} currency={account.currency} />
        {difference !== null ? <StatLine label={t('accounts.difference')} minor={difference} currency={account.currency} signed tone={difference === 0 ? 'muted' : difference > 0 ? 'positive' : 'negative'} /> : null}
      </Card>
      <Field label={t('accounts.actual')} value={actual} onChangeText={setActual} keyboardType="numbers-and-punctuation" autoFocus />
      {difference !== null && difference < 0 ? <SwitchRow label={t('accounts.asSpending')} hint={t('accounts.asSpendingHint')} value={asSpending} onChange={setAsSpending} /> : null}
      <Field label={t('transaction.notes')} value={note} onChangeText={setNote} />
      <FieldError message={error} />
    </Screen>
  );
}
