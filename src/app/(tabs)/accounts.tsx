import { useRouter } from 'expo-router';
import { useState } from 'react';

import { listAccounts } from '@/data/accounts';
import type { TKey } from '@/i18n';
import { useApp, useQuery } from '@/state/app';
import { Button, Card, EmptyState, ErrorState, type IconName, ListRow, Loading, Row, Screen, T } from '@/ui/components/core';
import { Money } from '@/ui/components/finance';
import { Field, SwitchRow } from '@/ui/components/forms';
import type { AccountType } from '@/domain/types';

const ACCOUNT_ICON: Record<AccountType, IconName> = {
  bank: 'business-outline',
  cash: 'cash-outline',
  savings: 'shield-checkmark-outline',
  other: 'albums-outline',
};

export default function Accounts() {
  const { t } = useApp();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const { data: accounts, error, reload } = useQuery((db) => listAccounts(db, { includeArchived: showArchived }), [showArchived]);

  if (error) return <ErrorState onRetry={reload} />;
  if (!accounts) {
    return (
      <Screen hideHeader scroll={false}>
        <Loading />
      </Screen>
    );
  }

  const term = search.trim().toLowerCase();
  const shown = term ? accounts.filter((a) => a.name.toLowerCase().includes(term)) : accounts;

  return (
    <Screen hideHeader>
      <Row between>
        <T variant="heading" weight="bold">
          {t('tabs.accounts')}
        </T>
        <Button label={t('accounts.add')} icon="add" compact kind="secondary" onPress={() => router.push('/account/edit')} />
      </Row>
      {accounts.length > 3 ? <Field label={t('common.search')} value={search} onChangeText={setSearch} /> : null}
      {shown.length === 0 ? (
        <EmptyState icon="wallet-outline" title={t('accounts.emptyTitle')} body={t('accounts.emptyBody')} action={t('accounts.add')} onAction={() => router.push('/account/edit')} />
      ) : (
        <Card>
          {shown.map((account) => (
            <ListRow
              key={account.id}
              icon={ACCOUNT_ICON[account.type]}
              title={account.name}
              subtitle={account.archivedAt ? t('accounts.archived') : t(`accountType.${account.type}` as TKey)}
              trailing={<Money minor={account.balanceMinor} currency={account.currency} tone={account.balanceMinor < 0 ? 'negative' : 'default'} />}
              onPress={() => router.push({ pathname: '/account/[id]', params: { id: account.id } })}
            />
          ))}
        </Card>
      )}
      <SwitchRow label={t('accounts.showArchived')} value={showArchived} onChange={setShowArchived} />
    </Screen>
  );
}
