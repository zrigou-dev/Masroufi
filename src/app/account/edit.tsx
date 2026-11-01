import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { createAccount, getAccount, getOpeningBalance, setOpeningBalance, updateAccount } from '@/data/accounts';
import { today } from '@/domain/dates';
import { CURRENCIES, DEFAULT_CURRENCY, normalizeDigits, parseAmount, toDecimalString } from '@/domain/money';
import type { AccountType } from '@/domain/types';
import { useApp, useQuery } from '@/state/app';
import { Button, Loading, Screen, Stacked } from '@/ui/components/core';
import { useErrorMessage } from '@/ui/components/feedback';
import { Chip, ChipRow, DateField, Field, FieldError, Label, Picker, SwitchRow } from '@/ui/components/forms';

const TYPES: AccountType[] = ['bank', 'cash', 'savings', 'other'];

function parseOpening(text: string, currency: string): number | null {
  const clean = normalizeDigits(text).trim();
  if (!clean) return 0;
  const negative = clean.startsWith('-');
  const value = parseAmount(negative ? clean.slice(1) : clean, currency);
  return value === null ? null : negative ? -value : value;
}

export default function AccountEdit() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { t, db } = useApp();
  const router = useRouter();
  const errorMessage = useErrorMessage();

  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('bank');
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY);
  const [opening, setOpening] = useState('');
  const [description, setDescription] = useState('');
  const [createdOn, setCreatedOn] = useState(today());
  const [isLiquid, setIsLiquid] = useState(true);
  const [liquidTouched, setLiquidTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data } = useQuery(async (conn) => (id ? { account: await getAccount(conn, id), opening: await getOpeningBalance(conn, id) } : null), [id]);
  const loaded = useRef(false);

  useEffect(() => {
    if (!data?.account || loaded.current) return;
    loaded.current = true;
    const { account } = data;
    setName(account.name);
    setType(account.type);
    setCurrency(account.currency);
    setDescription(account.description ?? '');
    setCreatedOn(account.createdOn);
    setIsLiquid(account.isLiquid);
    setLiquidTouched(true);
    setOpening(data.opening ? toDecimalString(data.opening, account.currency) : '');
  }, [data]);

  if (id && !data) {
    return (
      <Screen scroll={false}>
        <Loading />
      </Screen>
    );
  }

  const save = async () => {
    const openingMinor = parseOpening(opening, currency);
    if (openingMinor === null) return setError(t('errors.invalid_amount'));
    setBusy(true);
    setError(null);
    try {
      if (id) {
        await updateAccount(db, id, { name, type, description, isLiquid });
        if (openingMinor !== data?.opening) await setOpeningBalance(db, id, openingMinor);
      } else {
        await createAccount(db, { name, type, currency, description, isLiquid, createdOn, openingBalanceMinor: openingMinor });
      }
      if (router.canGoBack()) router.back();
      else router.replace('/');
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title={id ? t('accounts.edit') : t('accounts.add')} footer={<Button label={t('common.save')} onPress={() => void save()} loading={busy} />}>
      <Field label={t('accounts.name')} value={name} onChangeText={setName} autoFocus={!id} />
      <Stacked gap={4}>
        <Label>{t('accounts.type')}</Label>
        <ChipRow>
          {TYPES.map((value) => (
            <Chip
              key={value}
              label={t(`accountType.${value}`)}
              selected={type === value}
              onPress={() => {
                setType(value);
                if (!liquidTouched) setIsLiquid(value !== 'savings');
              }}
            />
          ))}
        </ChipRow>
      </Stacked>
      {id ? null : (
        <Picker label={t('accounts.currency')} value={currency} options={Object.keys(CURRENCIES).map((code) => ({ value: code, label: code }))} onChange={(code) => code && setCurrency(code)} />
      )}
      <Field label={t('accounts.opening')} value={opening} onChangeText={setOpening} keyboardType="numbers-and-punctuation" placeholder="0" hint={id ? t('accounts.openingEditHint') : t('accounts.openingHint')} />
      {id ? null : <DateField label={t('accounts.createdOn')} value={createdOn} max={today()} onChange={(value) => value && setCreatedOn(value)} />}
      <Field label={t('accounts.description')} value={description} onChangeText={setDescription} />
      <SwitchRow
        label={t('accounts.liquid')}
        hint={t('accounts.liquidHint')}
        value={isLiquid}
        onChange={(value) => {
          setIsLiquid(value);
          setLiquidTouched(true);
        }}
      />
      <FieldError message={error} />
    </Screen>
  );
}
