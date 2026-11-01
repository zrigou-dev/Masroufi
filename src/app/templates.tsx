import { useRouter } from 'expo-router';

import { listAccounts } from '@/data/accounts';
import { listCategories } from '@/data/categories';
import { deleteTemplate, getQuickItems, listTemplates, saveTemplate, type QuickItem } from '@/data/templates';
import { useApp, useQuery } from '@/state/app';
import { Card, EmptyState, ErrorState, IconButton, ListRow, Loading, Screen, Section, T } from '@/ui/components/core';
import { useErrorMessage, useFeedback } from '@/ui/components/feedback';
import { useCategoryName, useMoney } from '@/ui/components/finance';

/** Learned buttons appear by themselves; pinning keeps one for good, and removing a pin is one tap. */
export default function Templates() {
  const { t, db } = useApp();
  const router = useRouter();
  const money = useMoney();
  const nameOf = useCategoryName();
  const { confirm, toast } = useFeedback();
  const errorMessage = useErrorMessage();
  const { data, error, reload } = useQuery(
    async (conn) => ({
      templates: await listTemplates(conn),
      learned: (await getQuickItems(conn, 12)).filter((item) => !item.pinned),
      categories: await listCategories(conn, { includeArchived: true }),
      accounts: await listAccounts(conn, { includeArchived: true }),
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

  const categoryName = (id: string) => {
    const category = data.categories.find((c) => c.id === id);
    return category ? nameOf(category) : '';
  };

  const pin = async (item: QuickItem) => {
    try {
      await saveTemplate(db, null, {
        name: item.label ?? categoryName(item.categoryId),
        kind: item.kind,
        amountMinor: item.oneTap ? item.amountMinor : null,
        accountId: item.accountId,
        categoryId: item.categoryId,
        description: item.description,
      });
    } catch (failure) {
      toast({ message: errorMessage(failure) });
    }
  };

  const remove = async (id: string, name: string) => {
    if (await confirm({ title: t('templates.removeTitle', { name }), destructive: true, confirmLabel: t('common.delete') })) await deleteTemplate(db, id);
  };

  return (
    <Screen title={t('templates.title')}>
      <T tone="muted">{t('templates.hint')}</T>
      <Section title={t('templates.saved')}>
        {data.templates.length === 0 ? (
          <EmptyState icon="flash-outline" title={t('templates.emptyTitle')} body={t('templates.emptyBody')} action={t('transaction.add')} onAction={() => router.push('/transaction/new')} />
        ) : (
          <Card>
            {data.templates.map((template) => (
              <ListRow
                key={template.id}
                icon="flash-outline"
                title={template.name}
                subtitle={[categoryName(template.categoryId), template.amountMinor !== null ? money(template.amountMinor, data.accounts.find((a) => a.id === template.accountId)?.currency ?? 'MAD') : t('templates.askAmount')].join(' · ')}
                actions={<IconButton name="trash-outline" tone="faint" label={t('common.delete')} onPress={() => void remove(template.id, template.name)} />}
              />
            ))}
          </Card>
        )}
      </Section>
      {data.learned.length > 0 ? (
        <Section title={t('templates.learned')}>
          <Card>
            {data.learned.map((item) => (
              <ListRow
                key={item.key}
                icon="sparkles-outline"
                title={item.label ?? categoryName(item.categoryId)}
                subtitle={[categoryName(item.categoryId), item.amountMinor !== null ? money(item.amountMinor, item.currency) : ''].join(' · ')}
                actions={<IconButton name="pin-outline" label={t('templates.pin')} onPress={() => void pin(item)} />}
              />
            ))}
          </Card>
        </Section>
      ) : null}
    </Screen>
  );
}
