import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import { type ComponentProps, type ReactNode } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, type StyleProp, StyleSheet, Text, type TextProps, View, useWindowDimensions, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useApp } from '../../state/app';
import { fontFamily, type FontWeightName, radius, space, touch, type as typeScale, type TypeName, type Palette } from '../theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];
export type Tone = 'default' | 'muted' | 'faint' | 'positive' | 'negative' | 'warning' | 'primary' | 'onPrimary';

const toneColor = (colors: Palette, tone: Tone): string =>
  ({
    default: colors.text,
    muted: colors.textMuted,
    faint: colors.textFaint,
    positive: colors.positive,
    negative: colors.negative,
    warning: colors.warning,
    primary: colors.primary,
    onPrimary: colors.onPrimary,
  })[tone];

type TProps = TextProps & { variant?: TypeName; weight?: FontWeightName; tone?: Tone; center?: boolean };

export function T({ variant = 'body', weight = 'regular', tone = 'default', center, style, ...rest }: TProps) {
  const { colors } = useApp();
  return (
    <Text
      {...rest}
      style={[typeScale[variant], { fontFamily: fontFamily[weight], color: toneColor(colors, tone) }, center && { textAlign: 'center' }, style]}
    />
  );
}

export function Icon({ name, size = 20, tone = 'default', color }: { name: IconName; size?: number; tone?: Tone; color?: string }) {
  const { colors } = useApp();
  return <Ionicons name={name} size={size} color={color ?? toneColor(colors, tone)} />;
}

/** A chevron that points the way the reading direction continues. */
export function Chevron({ size = 18 }: { size?: number }) {
  const { rtl } = useApp();
  return <Icon name={rtl ? 'chevron-back' : 'chevron-forward'} size={size} tone="faint" />;
}

export function Card({ children, style, onPress, accessibilityLabel }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; accessibilityLabel?: string }) {
  const { colors } = useApp();
  const base = { backgroundColor: colors.surface, borderColor: colors.border };
  if (onPress) {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} style={({ pressed }) => [styles.card, base, pressed && styles.pressed, style]}>
        {children}
      </Pressable>
    );
  }
  return <View style={[styles.card, base, style]}>{children}</View>;
}

export function Row({ children, gap = space.sm, style, between }: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle>; between?: boolean }) {
  return <View style={[styles.row, { gap }, between && styles.between, style]}>{children}</View>;
}

export function Stacked({ children, gap = space.md, style }: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ gap }, style]}>{children}</View>;
}

export function Divider() {
  const { colors } = useApp();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />;
}

type ButtonProps = {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'danger' | 'ghost';
  icon?: IconName;
  disabled?: boolean;
  loading?: boolean;
  compact?: boolean;
};

export function Button({ label, onPress, kind = 'primary', icon, disabled, loading, compact }: ButtonProps) {
  const { colors } = useApp();
  const look = {
    primary: { bg: colors.primary, fg: colors.onPrimary, border: colors.primary },
    secondary: { bg: colors.surface, fg: colors.text, border: colors.border },
    danger: { bg: colors.negativeSoft, fg: colors.negative, border: colors.negativeSoft },
    ghost: { bg: 'transparent', fg: colors.primary, border: 'transparent' },
  }[kind];
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(inactive), busy: Boolean(loading) }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        compact && styles.buttonCompact,
        { backgroundColor: look.bg, borderColor: look.border },
        pressed && styles.pressed,
        inactive && styles.disabled,
      ]}>
      {loading ? <ActivityIndicator size="small" color={look.fg} /> : icon ? <Icon name={icon} size={18} color={look.fg} /> : null}
      <T weight="semibold" variant={compact ? 'small' : 'body'} style={{ color: look.fg }}>
        {label}
      </T>
    </Pressable>
  );
}

export function IconButton({ name, onPress, label, tone = 'default' }: { name: IconName; onPress: () => void; label: string; tone?: Tone }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={6} onPress={onPress} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
      <Icon name={name} size={22} tone={tone} />
    </Pressable>
  );
}

export function Badge({ label, tone = 'muted' }: { label: string; tone?: 'muted' | 'positive' | 'negative' | 'warning' | 'primary' }) {
  const { colors } = useApp();
  const background = { muted: colors.border, positive: colors.positiveSoft, negative: colors.negativeSoft, warning: colors.warningSoft, primary: colors.primarySoft }[tone];
  return (
    <View style={[styles.badge, { backgroundColor: background }]}>
      <T variant="caption" weight="medium" tone={tone}>
        {label}
      </T>
    </View>
  );
}

export function ProgressBar({ value, tone = 'primary' }: { value: number; tone?: 'primary' | 'positive' | 'negative' | 'warning' }) {
  const { colors } = useApp();
  const clamped = Math.max(0, Math.min(1, value));
  const fill = { primary: colors.primary, positive: colors.positive, negative: colors.negative, warning: colors.warning }[tone];
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      style={[styles.track, { backgroundColor: colors.border }]}>
      <View style={{ width: `${clamped * 100}%`, height: '100%', borderRadius: radius.pill, backgroundColor: fill }} />
    </View>
  );
}

export function Section({ title, action, onAction, children }: { title: string; action?: string; onAction?: () => void; children: ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      <Row between>
        <T variant="title" weight="semibold" accessibilityRole="header">
          {title}
        </T>
        {action && onAction ? (
          <Pressable accessibilityRole="button" onPress={onAction} hitSlop={8} style={styles.sectionAction}>
            <T variant="small" weight="medium" tone="primary">
              {action}
            </T>
          </Pressable>
        ) : null}
      </Row>
      {children}
    </View>
  );
}

export function EmptyState({ icon, title, body, action, onAction }: { icon: IconName; title: string; body?: string; action?: string; onAction?: () => void }) {
  const { colors } = useApp();
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.primarySoft }]}>
        <Icon name={icon} size={26} tone="primary" />
      </View>
      <T variant="title" weight="semibold" center>
        {title}
      </T>
      {body ? (
        <T tone="muted" center>
          {body}
        </T>
      ) : null}
      {action && onAction ? <Button label={action} onPress={onAction} compact /> : null}
    </View>
  );
}

export function Loading() {
  const { colors } = useApp();
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}

export function ErrorState({ onRetry }: { onRetry?: () => void }) {
  const { t } = useApp();
  return (
    <View style={styles.center}>
      <EmptyState icon="alert-circle-outline" title={t('common.loadError')} action={onRetry ? t('common.retry') : undefined} onAction={onRetry} />
    </View>
  );
}

const IOS_HEADER_HEIGHT = 44;

type ScreenProps = {
  title?: string;
  children: ReactNode;
  headerRight?: ReactNode;
  scroll?: boolean;
  footer?: ReactNode;
  /** Screens living in the tab bar have no back stack and draw their own title. */
  hideHeader?: boolean;
  /** Lets a dashboard use the extra width of a large screen. */
  wide?: boolean;
};

const WIDE_FROM = 960;
const CONTENT_WIDTH = 720;
const WIDE_CONTENT_WIDTH = 1160;

export function useIsWide(): boolean {
  return useWindowDimensions().width >= WIDE_FROM;
}

/** Two columns on a large screen, one stack on a phone. */
export function Columns({ left, right }: { left: ReactNode; right: ReactNode }) {
  const wide = useIsWide();
  if (!wide) {
    return (
      <>
        {left}
        {right}
      </>
    );
  }
  return (
    <View style={{ flexDirection: 'row', gap: space.xl, alignItems: 'flex-start' }}>
      <View style={{ flex: 1, gap: space.lg }}>{left}</View>
      <View style={{ flex: 1, gap: space.lg }}>{right}</View>
    </View>
  );
}

export function Screen({ title, children, headerRight, scroll = true, footer, hideHeader, wide }: ScreenProps) {
  const { colors } = useApp();
  const insets = useSafeAreaInsets();
  // Screens without a header are tabs or full-page routes whose layout owns their options;
  // setting a title here would blank the active tab's label.
  const header = hideHeader ? null : <Stack.Screen options={{ title: title ?? ' ', headerRight: headerRight ? () => headerRight : undefined }} />;
  const top = hideHeader ? insets.top + space.md : space.lg;

  // Keeps a form's Save button above the keyboard. Only iOS needs the header in the offset.
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' && !hideHeader ? insets.top + IOS_HEADER_HEIGHT : 0}
      style={{ flex: 1, backgroundColor: colors.background }}>
      {header}
      {scroll ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.content, { maxWidth: wide ? WIDE_CONTENT_WIDTH : CONTENT_WIDTH, paddingTop: top, paddingBottom: footer ? space.lg : insets.bottom + space.xxxl }]}>
          {children}
        </ScrollView>
      ) : (
        <View style={{ flex: 1, paddingTop: hideHeader ? insets.top : 0 }}>{children}</View>
      )}
      {footer ? (
        <View style={[styles.footer, { paddingBottom: insets.bottom + space.md, backgroundColor: colors.surface, borderTopColor: colors.border }]}>
          <View style={{ width: '100%', maxWidth: CONTENT_WIDTH, alignSelf: 'center' }}>{footer}</View>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

/** `actions` are controls of their own (a switch, a button), so they sit beside the row's press area, not inside it. */
export function ListRow({ icon, iconColor, title, subtitle, trailing, actions, onPress, chevron = true }: { icon?: IconName; iconColor?: string; title: string; subtitle?: string; trailing?: ReactNode; actions?: ReactNode; onPress?: () => void; chevron?: boolean }) {
  const { colors } = useApp();
  const body = (
    <>
      {icon ? (
        <View style={[styles.rowIcon, { backgroundColor: iconColor ? `${iconColor}22` : colors.primarySoft }]}>
          <Icon name={icon} size={20} color={iconColor ?? colors.primary} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <T weight="medium" numberOfLines={1}>
          {title}
        </T>
        {subtitle ? (
          <T variant="small" tone="muted" numberOfLines={2}>
            {subtitle}
          </T>
        ) : null}
      </View>
      {trailing}
      {onPress && chevron ? <Chevron /> : null}
    </>
  );
  if (!onPress) {
    return (
      <View style={styles.listRow}>
        {body}
        {actions}
      </View>
    );
  }
  const row = (
    <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={({ pressed }) => [styles.listRow, actions ? { flex: 1 } : null, pressed && styles.pressed]}>
      {body}
    </Pressable>
  );
  if (!actions) return row;
  return (
    <View style={styles.rowWithActions}>
      {row}
      {actions}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.xl, padding: space.lg, gap: space.sm, shadowColor: '#0A1A14', shadowOpacity: 0.06, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  between: { justifyContent: 'space-between' },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.5 },
  button: { flexDirection: 'row', gap: space.sm, alignItems: 'center', justifyContent: 'center', minHeight: 50, paddingHorizontal: space.xl, borderRadius: radius.md, borderWidth: 1 },
  buttonCompact: { minHeight: touch.min, paddingHorizontal: space.lg },
  iconButton: { width: touch.min, height: touch.min, alignItems: 'center', justifyContent: 'center' },
  badge: { paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.pill, alignSelf: 'flex-start' },
  track: { height: 8, borderRadius: radius.pill, overflow: 'hidden' },
  sectionAction: { minHeight: touch.min, justifyContent: 'center' },
  empty: { alignItems: 'center', gap: space.sm, paddingVertical: space.xl, paddingHorizontal: space.lg },
  emptyIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  content: { width: '100%', alignSelf: 'center', paddingHorizontal: space.lg, gap: space.lg },
  footer: { paddingHorizontal: space.lg, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56, paddingVertical: space.sm },
  rowWithActions: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  rowIcon: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
