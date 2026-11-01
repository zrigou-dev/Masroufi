import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, View } from 'react-native';

import { listAccounts } from '@/data/accounts';
import { listCategories } from '@/data/categories';
import { listTransactions, type TransactionFilter } from '@/data/transactions';
import type { DateRange } from '@/domain/dates';
import type { TransactionType } from '@/domain/types';
import { useApp, useQuery } from '@/state/app';
import { Button, EmptyState, ErrorState, Loading, Row, Screen, Stacked } from '@/ui/components/core';
import { TransactionRow, useCategoryName } from '@/ui/components/finance';
import { DateField, Field, Picker } from '@/ui/components/forms';
import { space } from '@/ui/theme';

const PAGE = 60;
const TYPES: TransactionType[] = ['expense', 'income', 'transfer', 'refund', 'debt_repayment', 'debt_collection', 'debt_borrowed', 'debt_lent', 'adjustment', 'reversal'];

export default function Transactions() {
  const { t } = useApp();
  const nameOf = useCategoryName();
  const params = useLocalSearchParams<{ categoryId?: string; from?: string; to?: string }>();
  const [search, setSearch] = useState('');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(params.categoryId ?? null);
  const [type, setType] = useState<TransactionType | null>(null);
  const [range, setRange] = useState<Partial<DateRange>>({ from: params.from, to: params.to });
  const [limit, setLimit] = useState(PAGE);
  const [filtersOpen, setFiltersOpen] = useState(Boolean(params.categoryId));

  const filter = useMemo<TransactionFilter>(
    () => ({ search, accountId: accountId ?? undefined, categoryId: categoryId ?? undefined, types: type ? [type] : undefined, from: range.from, to: range.to, limit }),
    [search, accountId, categoryId, type, range, limit],
  );

  const { data, error, reload } = useQuery(
    async (db) => ({
      rows: await listTransactions(db, filter),
      accounts: await listAccounts(db, { includeArchived: true }),
      categories: await listCategories(db, { includeArchived: true }),
    }),
    [filter],
  );

  if (error) return <ErrorState onRetry={reload} />;

  const header = (
    <View style={{ padding: space.lg, gap: space.md }}>
      <Field label={t('transactions.search')} value={search} onChangeText={setSearch} placeholder={t('transactions.searchHint')} />
      <Button label={filtersOpen ? t('transactions.hideFilters') : t('transactions.filters')} kind="secondary" compact icon="filter-outline" onPress={() => setFiltersOpen(!filtersOpen)} />
      {filtersOpen && data ? (
        <Stacked>
          <Picker label={t('transaction.account')} value={accountId} allowClear placeholder={t('common.all')} options={data.accounts.map((a) => ({ value: a.id, label: a.name }))} onChange={setAccountId} />
          <Picker label={t('transaction.category')} value={categoryId} allowClear placeholder={t('common.all')} options={data.categories.map((c) => ({ value: c.id, label: nameOf(c) }))} onChange={setCategoryId} />
          <Picker label={t('transactions.type')} value={type} allowClear placeholder={t('common.all')} options={TYPES.map((v) => ({ value: v, label: t(`txType.${v}`) }))} onChange={setType} />
          <Row gap={space.sm}>
            <View style={{ flex: 1 }}>
              <DateField label={t('period.from')} value={range.from ?? null} allowClear onChange={(from) => setRange({ ...range, from: from ?? undefined })} />
            </View>
            <View style={{ flex: 1 }}>
              <DateField label={t('period.to')} value={range.to ?? null} allowClear onChange={(to) => setRange({ ...range, to: to ?? undefined })} />
            </View>
          </Row>
        </Stacked>
      ) : null}
    </View>
  );

  return (
    <Screen title={t('transactions.title')} scroll={false}>
      <FlatList
        data={data?.rows ?? []}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={header}
        ListEmptyComponent={data ? <EmptyState icon="search-outline" title={t('transactions.noResults')} /> : <Loading />}
        contentContainerStyle={{ paddingBottom: space.xxxl }}
        renderItem={({ item }) => (
          <View style={{ paddingHorizontal: space.lg }}>
            <TransactionRow tx={item} />
          </View>
        )}
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (data && data.rows.length >= limit) setLimit(limit + PAGE);
        }}
      />
    </Screen>
  );
}
