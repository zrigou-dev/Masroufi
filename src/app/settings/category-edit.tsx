import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';

import { deleteCategory, listCategories, saveCategory, setCategoryArchived } from '@/data/categories';
import type { CategoryKind, CategoryNature } from '@/domain/types';
import { useApp, useQuery } from '@/state/app';
import { Button, Icon, type IconName, Loading, Screen, Stacked } from '@/ui/components/core';
import { useErrorMessage, useFeedback } from '@/ui/components/feedback';
import { useCategoryName } from '@/ui/components/finance';
import { Chip, ChipRow, DateField, Field, FieldError, Label, Picker, Segmented, SwitchRow } from '@/ui/components/forms';
import { radius, space } from '@/ui/theme';

const ICONS: IconName[] = [
  'pricetag-outline', 'home-outline', 'cart-outline', 'restaurant-outline', 'car-outline', 'bus-outline', 'medkit-outline', 'school-outline',
  'shirt-outline', 'gift-outline', 'airplane-outline', 'film-outline', 'game-controller-outline', 'paw-outline', 'barbell-outline', 'cafe-outline',
  'book-outline', 'build-outline', 'heart-outline', 'cash-outline', 'briefcase-outline', 'laptop-outline', 'phone-portrait-outline', 'leaf-outline',
];
const COLORS = ['#3B7EA1', '#2E7D5B', '#5E9A4B', '#C9A227', '#C77D2E', '#C2573F', '#C2453F', '#B0668F', '#9A5FB0', '#6B6BB0', '#2F8F9D', '#7A8691'];

export default function CategoryEdit() {
  const params = useLocalSearchParams<{ id?: string; kind?: CategoryKind; parentId?: string }>();
  const { confirm, toast } = useFeedback();
  const { t, db, colors } = useApp();
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const nameOf = useCategoryName();
  const { id } = params;

  const [name, setName] = useState('');
  const [kind, setKind] = useState<CategoryKind>(params.kind ?? 'expense');
  const [icon, setIcon] = useState<IconName>(ICONS[0]);
  const [color, setColor] = useState(COLORS[0]);
  const [nature, setNature] = useState<CategoryNature | null>(null);
  const [parentId, setParentId] = useState<string | null>(params.parentId ?? null);
  const [temporary, setTemporary] = useState(false);
  const [expiresOn, setExpiresOn] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: all } = useQuery((conn) => listCategories(conn, { includeArchived: true }), []);
  const data = id ? (all?.find((c) => c.id === id) ?? null) : null;
  const loaded = useRef(false);

  useEffect(() => {
    if (!data || loaded.current) return;
    loaded.current = true;
    setName(nameOf(data));
    setKind(data.kind);
    setIcon(data.icon as IconName);
    setColor(data.color);
    setNature(data.nature);
    setParentId(data.parentId);
    setExpiresOn(data.expiresOn);
    setTemporary(data.expiresOn !== null);
  }, [data, nameOf]);

  if (!all || (id && !data)) {
    return (
      <Screen scroll={false}>
        <Loading />
      </Screen>
    );
  }

  const save = async () => {
    try {
      // A seeded category keeps following translations until its displayed name is changed.
      const unchanged = data?.key && name === nameOf(data);
      await saveCategory(db, id ?? null, { name: unchanged ? data.name : name, kind, icon, color, nature, parentId, expiresOn: temporary ? expiresOn : null });
      router.back();
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  const archive = async () => {
    if (!id) return;
    await setCategoryArchived(db, id, true);
    router.back();
  };

  const remove = async () => {
    if (!id || !(await confirm({ title: t('categories.deleteTitle'), destructive: true, confirmLabel: t('common.delete') }))) return;
    try {
      await deleteCategory(db, id);
      router.back();
    } catch (failure) {
      toast({ message: errorMessage(failure) });
    }
  };

  const hasChildren = all.some((c) => c.parentId === id);
  const parents = all.filter((c) => !c.parentId && !c.archivedAt && c.kind === kind && c.id !== id);

  return (
    <Screen title={id ? t('categories.edit') : t('categories.add')} footer={<Button label={t('common.save')} onPress={() => void save()} />}>
      <Field label={t('categories.name')} value={name} onChangeText={setName} />
      {!id ? (
        <Segmented
          value={kind}
          onChange={setKind}
          options={[
            { value: 'expense', label: t('txType.expense') },
            { value: 'income', label: t('txType.income') },
          ]}
        />
      ) : null}
      {!hasChildren ? (
        <Picker label={t('categories.parent')} value={parentId} allowClear placeholder={t('categories.noParent')} options={parents.map((c) => ({ value: c.id, label: nameOf(c), color: c.color }))} onChange={setParentId} />
      ) : null}
      <SwitchRow label={t('categories.temporary')} hint={t('categories.temporaryHint')} value={temporary} onChange={setTemporary} />
      {temporary ? <DateField label={t('categories.expiresOn')} value={expiresOn} onChange={setExpiresOn} /> : null}
      <Stacked gap={space.xs}>
        <Label>{t('categories.icon')}</Label>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {ICONS.map((value) => (
            <Pressable
              key={value}
              accessibilityRole="radio"
              accessibilityLabel={value}
              accessibilityState={{ checked: icon === value }}
              onPress={() => setIcon(value)}
              style={{ width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: icon === value ? color : colors.border }}>
              <Icon name={value} color={color} />
            </Pressable>
          ))}
        </View>
      </Stacked>
      <Stacked gap={space.xs}>
        <Label>{t('categories.color')}</Label>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {COLORS.map((value) => (
            <Pressable
              key={value}
              accessibilityRole="radio"
              accessibilityLabel={value}
              accessibilityState={{ checked: color === value }}
              onPress={() => setColor(value)}
              style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: value, borderWidth: 3, borderColor: color === value ? colors.text : 'transparent' }}
            />
          ))}
        </View>
      </Stacked>
      {kind === 'expense' ? (
        <Stacked gap={space.xs}>
          <Label>{t('categories.nature')}</Label>
          <ChipRow>
            <Chip label={t('planning.essential')} selected={nature === 'essential'} onPress={() => setNature('essential')} />
            <Chip label={t('planning.discretionary')} selected={nature === 'discretionary'} onPress={() => setNature('discretionary')} />
            <Chip label={t('planning.unclassified')} selected={nature === null} onPress={() => setNature(null)} />
          </ChipRow>
        </Stacked>
      ) : null}
      <FieldError message={error} />
      {id ? <Button label={t('categories.archive')} kind="ghost" icon="archive-outline" onPress={() => void archive()} /> : null}
      {id ? <Button label={t('common.delete')} kind="danger" icon="trash-outline" onPress={() => void remove()} /> : null}
    </Screen>
  );
}
