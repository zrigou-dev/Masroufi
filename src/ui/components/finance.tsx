import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { addDays, daysBetween, formatDate, periodRange, today, type DateRange, type PeriodKind } from '../../domain/dates';
import { formatMoney } from '../../domain/money';
import type { Obligation } from '../../domain/planning';
import type { DebtStatus, TransactionType } from '../../domain/types';
import type { TransactionView } from '../../data/transactions';
import type { TKey } from '../../i18n';
import { useApp } from '../../state/app';
import { radius, space, type TypeName, type FontWeightName } from '../theme';
import { Badge, ListRow, Row, T, type IconName, type Tone } from './core';
import { DateField, Segmented } from './forms';

export function useMoney() {
  const { settings } = useApp();
  return (minor: number, currency: string, options?: { signed?: boolean }) =>
    formatMoney(minor, currency, settings.language, { hidden: settings.hideAmounts, signed: options?.signed });
}

export function Money({ minor, currency, signed, tone, variant = 'body', weight = 'semibold' }: { minor: number; currency: string; signed?: boolean; tone?: Tone; variant?: TypeName; weight?: FontWeightName }) {
  const money = useMoney();
  return (
    <T variant={variant} weight={weight} tone={tone} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
      {money(minor, currency, { signed })}
    </T>
  );
}

export function useCategoryName() {
  const { t } = useApp();
  return (category: { key: string | null; name: string | null }): string => {
    if (category.key) return t(`category.${category.key}` as TKey);
    return category.name ?? t('category.uncategorized');
  };
}

const TYPE_ICON: Record<TransactionType, IconName> = {
  opening_balance: 'flag-outline',
  income: 'arrow-down-circle-outline',
  expense: 'arrow-up-circle-outline',
  transfer: 'swap-horizontal-outline',
  debt_borrowed: 'download-outline',
  debt_lent: 'share-outline',
  debt_repayment: 'return-up-back-outline',
  debt_collection: 'return-down-back-outline',
  refund: 'refresh-circle-outline',
  adjustment: 'options-outline',
  reversal: 'arrow-undo-outline',
};

export function TransactionRow({ tx, showAccount = true }: { tx: TransactionView; showAccount?: boolean }) {
  const { t, settings, rtl } = useApp();
  const router = useRouter();
  const categoryName = useCategoryName();
  const hasCategory = tx.categoryId !== null;
  const typeLabel = t(`txType.${tx.type}` as TKey);
  const title = tx.description || tx.debtCounterparty || (hasCategory ? categoryName({ key: tx.categoryKey, name: tx.categoryName }) : typeLabel);
  const where = tx.type === 'transfer' ? `${tx.accountName} ${rtl ? '←' : '→'} ${tx.toAccountName ?? ''}` : showAccount ? tx.accountName : typeLabel;
  const neutral = tx.type === 'transfer' && tx.netMinor === 0;
  const shown = neutral ? tx.amountMinor : tx.netMinor;
  return (
    <ListRow
      icon={tx.categoryIcon ? (tx.categoryIcon as IconName) : TYPE_ICON[tx.type]}
      iconColor={tx.categoryColor ?? undefined}
      title={title}
      subtitle={`${where} · ${formatDate(tx.occurredAt.slice(0, 10), settings.language)}`}
      chevron={false}
      onPress={() => router.push({ pathname: '/transaction/[id]', params: { id: tx.id } })}
      trailing={
        <Money minor={shown} currency={tx.netCurrency} signed={!neutral} tone={neutral ? 'muted' : shown > 0 ? 'positive' : 'negative'} weight="medium" />
      }
    />
  );
}

export const typeIcon = (type: TransactionType): IconName => TYPE_ICON[type];

const STATUS_TONE: Record<DebtStatus, 'muted' | 'positive' | 'negative' | 'warning' | 'primary'> = {
  open: 'primary',
  partial: 'warning',
  settled: 'positive',
  overdue: 'negative',
  cancelled: 'muted',
  written_off: 'muted',
};

export function DebtStatusBadge({ status }: { status: DebtStatus }) {
  const { t } = useApp();
  return <Badge label={t(`debtStatus.${status}` as TKey)} tone={STATUS_TONE[status]} />;
}

export function ObligationRow({ item }: { item: Obligation }) {
  const { t, settings } = useApp();
  const router = useRouter();
  const incoming = item.direction === 'in';
  return (
    <ListRow
      icon={item.source === 'recurring' ? 'repeat-outline' : 'people-outline'}
      title={item.label}
      subtitle={`${t(`obligation.${item.source}` as TKey)} · ${formatDate(item.dueDate, settings.language)}`}
      chevron={false}
      onPress={() => (item.debtId ? router.push({ pathname: '/debt/[id]', params: { id: item.debtId } }) : router.push('/recurring'))}
      trailing={
        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          <Money minor={item.amountMinor} currency={item.currency} tone={incoming ? 'positive' : 'default'} weight="medium" />
          {item.overdue ? <Badge label={t('debtStatus.overdue')} tone="negative" /> : null}
        </View>
      }
    />
  );
}

export function StatLine({ label, minor, currency, tone, signed }: { label: string; minor: number; currency: string; tone?: Tone; signed?: boolean }) {
  return (
    <Row between style={{ minHeight: 30 }}>
      <T tone="muted" style={{ flexShrink: 1 }}>
        {label}
      </T>
      <Money minor={minor} currency={currency} tone={tone} signed={signed} weight="medium" />
    </Row>
  );
}

export type PeriodChoice = PeriodKind | 'custom';

export function usePeriod(initial: PeriodChoice = 'month') {
  const date = today();
  const [kind, setKind] = useState<PeriodChoice>(initial);
  const [custom, setCustom] = useState<DateRange>(periodRange('month', date));
  const range: DateRange = kind === 'custom' ? custom : periodRange(kind, date);
  return { kind, setKind, custom, setCustom, range };
}

export function PeriodSwitcher({ period }: { period: ReturnType<typeof usePeriod> }) {
  const { t } = useApp();
  return (
    <View style={{ gap: space.sm }}>
      <Segmented
        value={period.kind}
        onChange={period.setKind}
        options={[
          { value: 'day', label: t('period.day') },
          { value: 'week', label: t('period.week') },
          { value: 'month', label: t('period.month') },
          { value: 'year', label: t('period.year') },
          { value: 'custom', label: t('period.custom') },
        ]}
      />
      {period.kind === 'custom' ? (
        <Row gap={space.sm}>
          <View style={{ flex: 1 }}>
            <DateField label={t('period.from')} value={period.custom.from} onChange={(from) => from && period.setCustom({ from, to: from > period.custom.to ? from : period.custom.to })} />
          </View>
          <View style={{ flex: 1 }}>
            <DateField label={t('period.to')} value={period.custom.to} onChange={(to) => to && period.setCustom({ from: to < period.custom.from ? to : period.custom.from, to })} />
          </View>
        </Row>
      ) : null}
    </View>
  );
}

/** Horizontal share bars: plain views, so they mirror in RTL and need no chart library. */
export function ShareBars({ items, currency, totalMinor }: { items: { key: string; label: string; minor: number; color?: string; onPress?: () => void }[]; currency: string; totalMinor?: number }) {
  const { colors } = useApp();
  const money = useMoney();
  const max = Math.max(1, ...items.map((i) => Math.abs(i.minor)));
  return (
    <View style={{ gap: space.md }}>
      {items.map((item) => {
        const percent = totalMinor ? Math.round((item.minor / totalMinor) * 100) : null;
        const body = (
          <>
            <Row between>
              <T variant="small" numberOfLines={1} style={{ flexShrink: 1 }}>
                {item.label}
                {percent !== null ? `  ·  ${percent}%` : ''}
              </T>
              <T variant="small" weight="medium">
                {money(item.minor, currency)}
              </T>
            </Row>
            <View style={[barStyles.track, { backgroundColor: colors.border }]}>
              <View style={{ width: `${(Math.abs(item.minor) / max) * 100}%`, height: '100%', borderRadius: radius.pill, backgroundColor: item.color ?? colors.primary }} />
            </View>
          </>
        );
        const label = `${item.label}: ${money(item.minor, currency)}`;
        return item.onPress ? (
          <Pressable key={item.key} accessibilityRole="button" accessibilityLabel={label} onPress={item.onPress} style={{ gap: 4 }}>
            {body}
          </Pressable>
        ) : (
          <View key={item.key} accessible accessibilityLabel={label} style={{ gap: 4 }}>
            {body}
          </View>
        );
      })}
    </View>
  );
}

/** The whole period as one bar: the quickest possible answer to "where did it go?". */
export function StackedShare({ items }: { items: { key: string; minor: number; color?: string }[] }) {
  const { colors } = useApp();
  const shown = items.filter((i) => i.minor > 0);
  return (
    <View style={[barStyles.stack, { backgroundColor: colors.border }]}>
      {shown.map((item) => (
        <View key={item.key} style={{ flex: item.minor, height: '100%', backgroundColor: item.color ?? colors.primary }} />
      ))}
    </View>
  );
}

export function DailyBars({ days, range, currency }: { days: { day: string; minor: number }[]; range: DateRange; currency: string }) {
  const { colors, settings } = useApp();
  const money = useMoney();
  const span = daysBetween(range.from, range.to) + 1;
  // Past about two months, single days are too fine to read, so the chart stops there.
  const shown = Array.from({ length: Math.min(span, 62) }, (_, i) => addDays(range.from, i));
  const max = Math.max(1, ...days.map((d) => d.minor));
  const peak = days.reduce((best, d) => (d.minor > best.minor ? d : best), days[0]);
  return (
    <View style={{ gap: space.sm }}>
      <View style={barStyles.daily}>
        {shown.map((day) => {
          const minor = days.find((d) => d.day === day)?.minor ?? 0;
          return <View key={day} style={{ flex: 1, height: `${Math.max(2, (Math.max(0, minor) / max) * 100)}%`, borderRadius: 2, backgroundColor: minor > 0 ? colors.primary : colors.border }} />;
        })}
      </View>
      <T variant="caption" tone="muted">
        {formatDate(peak.day, settings.language)} · {money(peak.minor, currency)}
      </T>
    </View>
  );
}

/** Grouped monthly columns with a text alternative for screen readers. */
export function MonthBars({ points, currency }: { points: { label: string; a: number; b: number }[]; currency: string }) {
  const { colors } = useApp();
  const money = useMoney();
  const max = Math.max(1, ...points.flatMap((p) => [Math.abs(p.a), Math.abs(p.b)]));
  return (
    <View style={barStyles.chart}>
      {points.map((point) => (
        <View key={point.label} accessible accessibilityLabel={`${point.label}: ${money(point.a, currency)}, ${money(point.b, currency)}`} style={barStyles.group}>
          <View style={barStyles.columns}>
            <View style={[barStyles.column, { height: `${(Math.abs(point.a) / max) * 100}%`, backgroundColor: colors.positive }]} />
            <View style={[barStyles.column, { height: `${(Math.abs(point.b) / max) * 100}%`, backgroundColor: colors.negative }]} />
          </View>
          <T variant="caption" tone="muted" numberOfLines={1}>
            {point.label}
          </T>
        </View>
      ))}
    </View>
  );
}

export function TrendColumns({ points, currency }: { points: { label: string; value: number }[]; currency: string }) {
  const { colors } = useApp();
  const money = useMoney();
  const values = points.map((p) => p.value);
  const max = Math.max(1, ...values.map(Math.abs));
  return (
    <View style={barStyles.chart}>
      {points.map((point) => (
        <View key={point.label} accessible accessibilityLabel={`${point.label}: ${money(point.value, currency)}`} style={barStyles.group}>
          <View style={barStyles.columns}>
            <View style={[barStyles.column, { flex: 1, height: `${Math.max(2, (Math.abs(point.value) / max) * 100)}%`, backgroundColor: point.value < 0 ? colors.negative : colors.primary }]} />
          </View>
          <T variant="caption" tone="muted" numberOfLines={1}>
            {point.label}
          </T>
        </View>
      ))}
    </View>
  );
}

const barStyles = StyleSheet.create({
  track: { height: 8, borderRadius: radius.pill, overflow: 'hidden' },
  stack: { height: 14, borderRadius: radius.pill, overflow: 'hidden', flexDirection: 'row', gap: 2, marginBottom: space.xs },
  daily: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 90 },
  chart: { flexDirection: 'row', gap: space.sm, height: 150, alignItems: 'stretch' },
  group: { flex: 1, gap: space.xs, alignItems: 'center' },
  columns: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 3, width: '100%' },
  column: { width: 10, borderTopLeftRadius: 4, borderTopRightRadius: 4, minHeight: 2 },
});
