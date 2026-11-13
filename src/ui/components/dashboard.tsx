import { type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useApp } from '../../state/app';
import { radius, space } from '../theme';
import { Chevron, Icon, Row, T, type IconName } from './core';
import { Money, useMoney } from './finance';

const FALLBACK_COLORS = ['#0F8B7A', '#E0872B', '#4C6FD6', '#C2527E', '#7B5FC7', '#3E9B4F', '#C9A227', '#D2604A'];
export const colorAt = (index: number) => FALLBACK_COLORS[index % FALLBACK_COLORS.length];

/** The headline number of a screen, on a solid brand surface so it is the first thing seen. */
export function Hero({ label, minor, currency, children }: { label: string; minor: number; currency: string; children?: ReactNode }) {
  const { colors } = useApp();
  return (
    <View style={[styles.hero, { backgroundColor: colors.primary }]}>
      <View style={[styles.heroBlob, { backgroundColor: colors.onPrimary }]} />
      <T tone="onPrimary" style={{ opacity: 0.85 }}>
        {label}
      </T>
      <Money minor={minor} currency={currency} variant="display" weight="bold" tone="onPrimary" />
      {children}
    </View>
  );
}

/** A figure that sits on the hero surface. */
export function HeroStat({ label, minor, currency, onPress }: { label: string; minor: number; currency: string; onPress?: () => void }) {
  const { colors } = useApp();
  const body = (
    <View style={[styles.heroStat, { backgroundColor: `${colors.onPrimary}22` }]}>
      <T variant="caption" tone="onPrimary" numberOfLines={1} style={{ opacity: 0.85 }}>
        {label}
      </T>
      <Money minor={minor} currency={currency} tone="onPrimary" />
    </View>
  );
  return onPress ? (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [{ flex: 1 }, pressed && { opacity: 0.75 }]}>
      {body}
    </Pressable>
  ) : (
    <View style={{ flex: 1 }}>{body}</View>
  );
}

/** A labelled figure with an icon bubble: income, expenses, net. */
export function Metric({ icon, label, minor, currency, tone, signed }: { icon: IconName; label: string; minor: number; currency: string; tone: 'positive' | 'negative' | 'primary'; signed?: boolean }) {
  const { colors } = useApp();
  const soft = { positive: colors.positiveSoft, negative: colors.negativeSoft, primary: colors.primarySoft }[tone];
  return (
    <View style={styles.metric}>
      <View style={[styles.bubble, { backgroundColor: soft }]}>
        <Icon name={icon} size={16} tone={tone} />
      </View>
      <T variant="caption" tone="muted" numberOfLines={1}>
        {label}
      </T>
      <Money minor={minor} currency={currency} tone={tone === 'primary' ? undefined : tone} signed={signed} variant="small" />
    </View>
  );
}

/** Up or down against the previous period. For spending, rising is bad. */
export function ChangePill({ now, before, upIsBad = true }: { now: number; before: number; upIsBad?: boolean }) {
  const { colors } = useApp();
  if (before <= 0 || now === before) return null;
  const percent = Math.round(((now - before) / before) * 100);
  const bad = percent > 0 === upIsBad;
  const fg = bad ? colors.negative : colors.positive;
  return (
    <View style={[styles.pill, { backgroundColor: bad ? colors.negativeSoft : colors.positiveSoft }]}>
      <Icon name={percent > 0 ? 'arrow-up' : 'arrow-down'} size={12} color={fg} />
      <T variant="caption" weight="semibold" style={{ color: fg }}>
        {Math.abs(percent)}%
      </T>
    </View>
  );
}

export type Slice = { key: string; label: string; minor: number; color?: string; onPress?: () => void };

/** Largest slices first, the long tail folded into one "other" slice so the legend stays readable. */
export function topSlices(items: Slice[], max: number, otherLabel: string): Slice[] {
  const sorted = [...items].filter((i) => i.minor > 0).sort((a, b) => b.minor - a.minor);
  const colored = sorted.map((item, index) => ({ ...item, color: item.color ?? colorAt(index) }));
  if (colored.length <= max) return colored;
  const head = colored.slice(0, max - 1);
  const rest = colored.slice(max - 1);
  return [...head, { key: 'other', label: otherLabel, minor: rest.reduce((sum, i) => sum + i.minor, 0), color: '#8A978F' }];
}

/** One bar for the whole period, then a legend with share and amount: "where did it go?" in a glance. */
export function Breakdown({ slices, currency, totalMinor }: { slices: Slice[]; currency: string; totalMinor: number }) {
  const { colors } = useApp();
  const money = useMoney();
  const total = totalMinor > 0 ? totalMinor : slices.reduce((sum, s) => sum + s.minor, 0);
  return (
    <View style={{ gap: space.md }}>
      <View style={[styles.stack, { backgroundColor: colors.border }]}>
        {slices.map((s) => (
          <View key={s.key} style={{ flex: s.minor, height: '100%', backgroundColor: s.color }} />
        ))}
      </View>
      <View style={{ gap: space.xs }}>
        {slices.map((s) => {
          const percent = total > 0 ? Math.round((s.minor / total) * 100) : 0;
          const label = `${s.label}: ${money(s.minor, currency)}`;
          const body = (
            <>
              <View style={[styles.dot, { backgroundColor: s.color }]} />
              <T numberOfLines={1} style={{ flex: 1 }}>
                {s.label}
              </T>
              <T variant="small" tone="muted">
                {percent}%
              </T>
              <View style={{ minWidth: 92, alignItems: 'flex-end' }}>
                <T variant="small" weight="semibold">
                  {money(s.minor, currency)}
                </T>
              </View>
              {s.onPress ? <Chevron size={14} /> : null}
            </>
          );
          return s.onPress ? (
            <Pressable key={s.key} accessibilityRole="button" accessibilityLabel={label} onPress={s.onPress} style={({ pressed }) => [styles.legendRow, pressed && { opacity: 0.7 }]}>
              {body}
            </Pressable>
          ) : (
            <View key={s.key} accessible accessibilityLabel={label} style={styles.legendRow}>
              {body}
            </View>
          );
        })}
      </View>
    </View>
  );
}

/** Titled group of related content. Gives each block of a dashboard one clear purpose. */
export function Group({ title, caption, children }: { title: string; caption?: string; children: ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      <View>
        <T variant="title" weight="bold" accessibilityRole="header">
          {title}
        </T>
        {caption ? (
          <T variant="small" tone="muted">
            {caption}
          </T>
        ) : null}
      </View>
      {children}
    </View>
  );
}

export function LegendKey({ color, label }: { color: string; label: string }) {
  return (
    <Row gap={space.xs}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <T variant="caption" tone="muted">
        {label}
      </T>
    </Row>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: radius.xl, padding: space.xl, gap: space.xs, overflow: 'hidden' },
  heroBlob: { position: 'absolute', width: 180, height: 180, borderRadius: 90, opacity: 0.07, top: -60, end: -50 },
  heroStat: { borderRadius: radius.md, paddingVertical: space.sm, paddingHorizontal: space.md, gap: 2 },
  metric: { flex: 1, gap: 2, minWidth: 0 },
  bubble: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginBottom: space.xs },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.pill, alignSelf: 'flex-start' },
  stack: { height: 16, borderRadius: radius.pill, overflow: 'hidden', flexDirection: 'row', gap: 2 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 40 },
});
