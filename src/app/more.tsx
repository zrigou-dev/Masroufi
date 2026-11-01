import { useRouter, type Href } from 'expo-router';

import type { TKey } from '@/i18n';
import { useApp } from '@/state/app';
import { Card, type IconName, ListRow, Screen, Section } from '@/ui/components/core';

const GROUPS: { title: TKey; items: { icon: IconName; title: TKey; href: Href }[] }[] = [
  {
    title: 'more.plan',
    items: [
      { icon: 'pie-chart-outline', title: 'budgets.title', href: '/budgets' },
      { icon: 'flag-outline', title: 'goals.title', href: '/goals' },
      { icon: 'compass-outline', title: 'planning.title', href: '/planning' },
      { icon: 'bulb-outline', title: 'insight.title', href: '/insights' },
    ],
  },
  {
    title: 'more.obligations',
    items: [
      { icon: 'repeat-outline', title: 'recurring.title', href: '/recurring' },
      { icon: 'calendar-outline', title: 'calendar.title', href: '/calendar' },
    ],
  },
  {
    title: 'more.data',
    items: [
      { icon: 'list-outline', title: 'transactions.title', href: '/transactions' },
      { icon: 'flash-outline', title: 'templates.title', href: '/templates' },
      { icon: 'pricetags-outline', title: 'categories.title', href: '/settings/categories' },
      { icon: 'cloud-download-outline', title: 'backup.title', href: '/settings/backup' },
    ],
  },
  {
    title: 'more.app',
    items: [
      { icon: 'settings-outline', title: 'settings.title', href: '/settings' },
      { icon: 'lock-closed-outline', title: 'security.title', href: '/settings/security' },
    ],
  },
];

export default function More() {
  const { t } = useApp();
  const router = useRouter();
  return (
    <Screen title={t('more.title')}>
      {GROUPS.map((group) => (
        <Section key={group.title} title={t(group.title)}>
          <Card>
            {group.items.map((item) => (
              <ListRow key={item.title} icon={item.icon} title={t(item.title)} onPress={() => router.push(item.href)} />
            ))}
          </Card>
        </Section>
      ))}
    </Screen>
  );
}
