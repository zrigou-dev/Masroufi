import { useRouter } from 'expo-router';

import type { Insight } from '../../domain/insights';
import type { TKey } from '../../i18n';
import { useApp } from '../../state/app';
import { Badge, Card, Icon, type IconName, Row, T } from './core';
import { useMoney } from './finance';

const TONE_ICON: Record<Insight['tone'], IconName> = {
  neutral: 'information-circle-outline',
  positive: 'trending-up-outline',
  attention: 'alert-circle-outline',
};

export function useInsightText() {
  const { t } = useApp();
  const money = useMoney();
  return (insight: Insight): string => {
    const params: Record<string, string | number> = { ...insight.labels };
    for (const [key, value] of Object.entries(insight.amounts)) {
      params[key] = key === 'count' || key.startsWith('percent') ? value : money(value, insight.currency);
    }
    return t(`insight.${insight.kind}` as TKey, params);
  };
}

export function InsightCard({ insight }: { insight: Insight }) {
  const { t } = useApp();
  const router = useRouter();
  const text = useInsightText();
  const tone = insight.tone === 'attention' ? 'warning' : insight.tone === 'positive' ? 'positive' : 'muted';
  const open = insight.transactionId
    ? () => router.push({ pathname: '/transaction/[id]', params: { id: insight.transactionId as string } })
    : undefined;
  return (
    <Card onPress={open}>
      <Row gap={10} style={{ alignItems: 'flex-start' }}>
        <Icon name={TONE_ICON[insight.tone]} tone={tone} />
        <T style={{ flex: 1 }}>{text(insight)}</T>
      </Row>
      <Badge label={insight.basis === 'fact' ? t('insight.basisFact') : t('insight.basisEstimate')} tone={insight.basis === 'fact' ? 'muted' : 'warning'} />
    </Card>
  );
}
