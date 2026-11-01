import { type ReactNode, useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, TextInput, type TextInputProps, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { addMonths, daysInMonth, formatDate, isValidDate, today, type LocalDate } from '../../domain/dates';
import { currencySymbol, normalizeDigits } from '../../domain/money';
import { useApp } from '../../state/app';
import { fontFamily, radius, space, touch, type as typeScale } from '../theme';
import { Button, Icon, IconButton, type IconName, ListRow, Row, T } from './core';

export function Label({ children }: { children: string }) {
  return (
    <T variant="small" weight="medium" tone="muted">
      {children}
    </T>
  );
}

export function FieldError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <Row gap={space.xs}>
      <Icon name="alert-circle" size={15} tone="negative" />
      <T accessibilityLiveRegion="polite" variant="small" tone="negative" style={{ flex: 1 }}>
        {message}
      </T>
    </Row>
  );
}

type FieldProps = TextInputProps & { label: string; error?: string | null; hint?: string };

export function Field({ label, error, hint, style, ...input }: FieldProps) {
  const { colors } = useApp();
  const [focused, setFocused] = useState(false);
  const borderColor = error ? colors.negative : focused ? colors.primary : colors.border;
  return (
    <View style={styles.field}>
      <Label>{label}</Label>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.textFaint}
        {...input}
        onFocus={(event) => {
          setFocused(true);
          input.onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          input.onBlur?.(event);
        }}
        style={[
          styles.input,
          typeScale.body,
          { fontFamily: fontFamily.regular, color: colors.text, backgroundColor: colors.surface, borderColor },
          input.multiline && styles.multiline,
          style,
        ]}
      />
      {hint ? (
        <T variant="caption" tone="faint">
          {hint}
        </T>
      ) : null}
      <FieldError message={error} />
    </View>
  );
}

/** Large, centred amount entry. Digits always run left to right, even in an Arabic layout. */
export function AmountInput({ label, value, onChangeText, currency, error, autoFocus, tone, onSubmitEditing }: { label: string; value: string; onChangeText: (text: string) => void; currency: string; error?: string | null; autoFocus?: boolean; tone?: 'negative' | 'positive'; onSubmitEditing?: () => void }) {
  const { colors, rtl, settings } = useApp();
  const color = tone === 'negative' ? colors.negative : tone === 'positive' ? colors.positive : colors.text;
  return (
    <View style={[styles.field, { alignItems: 'center' }]}>
      <Label>{label}</Label>
      {/* Digits read left to right, so the number stays first and the currency follows it, even in RTL. */}
      <View style={[styles.amountRow, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
        <TextInput
          accessibilityLabel={label}
          autoFocus={autoFocus}
          onSubmitEditing={onSubmitEditing}
          value={value}
          onChangeText={(text) => onChangeText(normalizeDigits(text))}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor={colors.textFaint}
          style={[typeScale.display, styles.amount, { fontFamily: fontFamily.semibold, color }]}
        />
        <T tone="muted" weight="medium">
          {currencySymbol(currency, settings.language)}
        </T>
      </View>
      <FieldError message={error} />
    </View>
  );
}

export function Segmented<V extends string>({ value, options, onChange }: { value: V; options: { value: V; label: string }[]; onChange: (value: V) => void }) {
  const { colors } = useApp();
  return (
    <View accessibilityRole="tablist" style={[styles.segmented, { backgroundColor: colors.border }]}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={[styles.segment, selected && { backgroundColor: colors.surface }]}>
            <T variant="small" weight={selected ? 'semibold' : 'medium'} tone={selected ? 'default' : 'muted'} numberOfLines={1}>
              {option.label}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Chip({ label, selected, onPress, icon, color }: { label: string; selected: boolean; onPress: () => void; icon?: IconName; color?: string }) {
  const { colors } = useApp();
  const accent = color ?? colors.primary;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.chip, { borderColor: selected ? accent : colors.border, backgroundColor: selected ? `${accent}1F` : colors.surface }]}>
      {icon ? <Icon name={icon} size={16} color={accent} /> : null}
      <T variant="small" weight={selected ? 'semibold' : 'regular'}>
        {label}
      </T>
    </Pressable>
  );
}

export function ChipRow({ children }: { children: ReactNode }) {
  return <View style={styles.chipRow}>{children}</View>;
}

/** Drawn here rather than with Switch, whose web version puts the thumb outside the track in RTL. */
export function Toggle({ label, value, onChange, disabled }: { label: string; value: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  const { colors } = useApp();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled: Boolean(disabled) }}
      disabled={disabled}
      hitSlop={8}
      onPress={() => onChange(!value)}
      style={[styles.toggle, { backgroundColor: value ? colors.primary : colors.border, alignItems: value ? 'flex-end' : 'flex-start' }, disabled && { opacity: 0.5 }]}>
      <View style={[styles.toggleThumb, { backgroundColor: colors.surface }]} />
    </Pressable>
  );
}

export function SwitchRow({ label, hint, value, onChange, disabled }: { label: string; hint?: string; value: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return (
    <Row between style={{ minHeight: touch.min }} gap={space.md}>
      <View style={{ flex: 1 }}>
        <T weight="medium">{label}</T>
        {hint ? (
          <T variant="small" tone="muted">
            {hint}
          </T>
        ) : null}
      </View>
      <Toggle label={label} value={value} disabled={disabled} onChange={onChange} />
    </Row>
  );
}

function BottomSheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const { colors, t } = useApp();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable accessibilityLabel={t('common.close')} style={[styles.sheetBackdrop, { backgroundColor: colors.overlay }]} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: colors.surfaceRaised, paddingBottom: insets.bottom + space.md }]}>
        <Row between>
          <T variant="title" weight="semibold">
            {title}
          </T>
          <IconButton name="close" label={t('common.close')} onPress={onClose} />
        </Row>
        {children}
      </View>
    </Modal>
  );
}

export type PickerOption<V extends string> = { value: V; label: string; subtitle?: string; icon?: IconName; color?: string };

/** A field that opens a searchable list. Selecting an option closes it immediately. */
export function Picker<V extends string>({ label, value, options, onChange, placeholder, error, allowClear }: { label: string; value: V | null; options: PickerOption<V>[]; onChange: (value: V | null) => void; placeholder?: string; error?: string | null; allowClear?: boolean }) {
  const { colors, t } = useApp();
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  return (
    <View style={styles.field}>
      <Label>{label}</Label>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${selected?.label ?? placeholder ?? ''}`}
        onPress={() => setOpen(true)}
        style={[styles.select, { backgroundColor: colors.surface, borderColor: error ? colors.negative : colors.border }]}>
        {selected?.icon ? <Icon name={selected.icon} size={18} color={selected.color ?? colors.primary} /> : null}
        <T numberOfLines={1} tone={selected ? 'default' : 'faint'} style={{ flex: 1 }}>
          {selected?.label ?? placeholder ?? t('common.choose')}
        </T>
        <Icon name="chevron-down" size={16} tone="faint" />
      </Pressable>
      <FieldError message={error} />
      <BottomSheet visible={open} title={label} onClose={() => setOpen(false)}>
        <FlatList
          data={options}
          keyExtractor={(item) => item.value}
          keyboardShouldPersistTaps="handled"
          style={{ maxHeight: 420 }}
          ListHeaderComponent={
            allowClear ? (
              <ListRow
                icon="remove-circle-outline"
                title={t('common.none')}
                chevron={false}
                onPress={() => {
                  onChange(null);
                  setOpen(false);
                }}
              />
            ) : undefined
          }
          renderItem={({ item }) => (
            <ListRow
              icon={item.icon}
              iconColor={item.color}
              title={item.label}
              subtitle={item.subtitle}
              chevron={false}
              trailing={item.value === value ? <Icon name="checkmark" tone="primary" /> : undefined}
              onPress={() => {
                onChange(item.value);
                setOpen(false);
              }}
            />
          )}
        />
      </BottomSheet>
    </View>
  );
}

function Calendar({ value, onSelect, max }: { value: LocalDate; onSelect: (date: LocalDate) => void; max?: LocalDate }) {
  const { settings, t, rtl, colors } = useApp();
  const [month, setMonth] = useState(`${value.slice(0, 7)}-01`);
  const cells = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    const offset = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
    const days = Array.from({ length: daysInMonth(y, m) }, (_, i) => `${month.slice(0, 8)}${String(i + 1).padStart(2, '0')}`);
    return [...Array<null>(offset).fill(null), ...days];
  }, [month]);
  const weekdays = useMemo(() => {
    const format = new Intl.DateTimeFormat(settings.language === 'ar' ? 'ar-MA' : settings.language, { weekday: 'narrow', timeZone: 'UTC' });
    return Array.from({ length: 7 }, (_, i) => format.format(new Date(Date.UTC(2024, 0, 1 + i))));
  }, [settings.language]);
  const current = today();

  return (
    <View style={{ gap: space.sm }}>
      <Row between>
        <IconButton name={rtl ? 'chevron-forward' : 'chevron-back'} label={t('common.previous')} onPress={() => setMonth(addMonths(month, -1, 1))} />
        <T weight="semibold">{formatDate(month, settings.language, 'month')}</T>
        <IconButton name={rtl ? 'chevron-back' : 'chevron-forward'} label={t('common.next')} onPress={() => setMonth(addMonths(month, 1, 1))} />
      </Row>
      <View style={styles.grid}>
        {weekdays.map((day, i) => (
          <View key={`${day}${i}`} style={styles.cell}>
            <T variant="caption" tone="faint">
              {day}
            </T>
          </View>
        ))}
        {cells.map((date, i) => {
          if (!date) return <View key={`blank${i}`} style={styles.cell} />;
          const selected = date === value;
          const disabled = Boolean(max && date > max);
          return (
            <Pressable
              key={date}
              accessibilityRole="button"
              accessibilityLabel={formatDate(date, settings.language, 'long')}
              accessibilityState={{ selected, disabled }}
              disabled={disabled}
              onPress={() => onSelect(date)}
              style={[styles.cell, selected && { backgroundColor: colors.primary, borderRadius: radius.pill }]}>
              <T variant="small" weight={date === current ? 'bold' : 'regular'} tone={selected ? 'onPrimary' : disabled ? 'faint' : 'default'}>
                {Number(date.slice(8))}
              </T>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function DateField({ label, value, onChange, max, error, allowClear }: { label: string; value: LocalDate | null; onChange: (date: LocalDate | null) => void; max?: LocalDate; error?: string | null; allowClear?: boolean }) {
  const { colors, settings, t } = useApp();
  const [open, setOpen] = useState(false);
  const shown = value && isValidDate(value) ? value : null;
  return (
    <View style={styles.field}>
      <Label>{label}</Label>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${shown ? formatDate(shown, settings.language, 'long') : t('common.none')}`}
        onPress={() => setOpen(true)}
        style={[styles.select, { backgroundColor: colors.surface, borderColor: error ? colors.negative : colors.border }]}>
        <Icon name="calendar-outline" size={18} tone="muted" />
        <T tone={shown ? 'default' : 'faint'} style={{ flex: 1 }}>
          {shown ? formatDate(shown, settings.language) : t('common.choose')}
        </T>
      </Pressable>
      <FieldError message={error} />
      <BottomSheet visible={open} title={label} onClose={() => setOpen(false)}>
        <Calendar
          value={shown ?? today()}
          max={max}
          onSelect={(date) => {
            onChange(date);
            setOpen(false);
          }}
        />
        {allowClear && shown ? (
          <Button
            label={t('common.clear')}
            kind="ghost"
            compact
            onPress={() => {
              onChange(null);
              setOpen(false);
            }}
          />
        ) : null}
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: space.xs },
  input: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm, minHeight: 48, textAlign: 'auto' },
  multiline: { minHeight: 88, textAlignVertical: 'top' },
  amountRow: { alignItems: 'center', justifyContent: 'center', gap: space.sm, width: '100%' },
  amount: { flex: 1, maxWidth: 240, textAlign: 'center', paddingVertical: space.xs },
  segmented: { flexDirection: 'row', borderRadius: radius.md, padding: 3 },
  segment: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, paddingHorizontal: space.xs },
  chip: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: touch.min - 4, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  toggle: { width: 48, height: 28, borderRadius: 14, padding: 3, justifyContent: 'center' },
  toggleThumb: { width: 22, height: 22, borderRadius: 11 },
  select: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, minHeight: 48 },
  sheetBackdrop: { flex: 1 },
  sheet: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingHorizontal: space.lg, paddingTop: space.sm, gap: space.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, aspectRatio: 1.15, alignItems: 'center', justifyContent: 'center' },
});
