import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { listCategories, moveCategory, setCategoryArchived } from '@/data/categories';
import { formatDate, today } from '@/domain/dates';
import type { Category, CategoryKind } from '@/domain/types';
import { useApp, useQuery } from '@/state/app';
import { Badge, Button, Card, ErrorState, IconButton, type IconName, ListRow, Loading, Row, Screen, Section, T } from '@/ui/components/core';
import { useCategoryName } from '@/ui/components/finance';
import { Segmented } from '@/ui/components/forms';
import { space } from '@/ui/theme';

export default function Categories() {
  const { t, db, settings } = useApp();
  const router = useRouter();
  const nameOf = useCategoryName();
  const [kind, setKind] = useState<CategoryKind>('expense');
  const { data, error, reload } = useQuery((conn) => listCategories(conn, { kind, includeArchived: true }), [kind]);

  if (error) return <ErrorState onRetry={reload} />;
  if (!data) {
    return (
      <Screen scroll={false}>
        <Loading />
      </Screen>
    );
  }

  const edit = (id: string) => router.push({ pathname: '/settings/category-edit', params: { id } });
  const live = data.filter((c) => !c.archivedAt);
  const archived = data.filter((c) => c.archivedAt);
  const parents = live.filter((c) => !c.parentId);

  const subtitle = (category: Category) => {
    if (category.expiresOn) return t(category.expiresOn < today() ? 'categories.expired' : 'categories.until', { date: formatDate(category.expiresOn, settings.language) });
    return category.nature ? t(`planning.${category.nature}`) : undefined;
  };

  return (
    <Screen title={t('categories.title')} footer={<Button label={t('categories.add')} icon="add" onPress={() => router.push({ pathname: '/settings/category-edit', params: { kind } })} />}>
      <Segmented
        value={kind}
        onChange={setKind}
        options={[
          { value: 'expense', label: t('txType.expense') },
          { value: 'income', label: t('txType.income') },
        ]}
      />
      <T variant="small" tone="muted">
        {t('categories.hint')}
      </T>
      <Card>
        {parents.map((category) => (
          <View key={category.id}>
            <ListRow
              icon={category.icon as IconName}
              iconColor={category.color}
              title={nameOf(category)}
              subtitle={subtitle(category)}
              chevron={false}
              onPress={() => edit(category.id)}
              actions={
                <Row gap={0}>
                  <IconButton name="chevron-up" tone="faint" label={t('categories.moveUp')} onPress={() => void moveCategory(db, category.id, 'up')} />
                  <IconButton name="chevron-down" tone="faint" label={t('categories.moveDown')} onPress={() => void moveCategory(db, category.id, 'down')} />
                </Row>
              }
            />
            {live
              .filter((child) => child.parentId === category.id)
              .map((child) => (
                <View key={child.id} style={{ paddingStart: space.xxl }}>
                  <ListRow icon={child.icon as IconName} iconColor={child.color} title={nameOf(child)} subtitle={subtitle(child)} chevron={false} onPress={() => edit(child.id)} />
                </View>
              ))}
          </View>
        ))}
      </Card>
      {archived.length > 0 ? (
        <Section title={t('categories.archived')}>
          <Card>
            {archived.map((category) => (
              <ListRow
                key={category.id}
                icon={category.icon as IconName}
                iconColor={category.color}
                title={nameOf(category)}
                chevron={false}
                trailing={<Badge label={t('categories.restore')} tone="primary" />}
                onPress={() => void setCategoryArchived(db, category.id, false)}
              />
            ))}
          </Card>
        </Section>
      ) : null}
    </Screen>
  );
}
