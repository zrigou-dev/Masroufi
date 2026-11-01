import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { TextInput, View } from 'react-native';

import { listAccounts } from '@/data/accounts';
import { listCategories } from '@/data/categories';
import { createSplitExpense, createTransferWithFee } from '@/data/compound';
import { newId } from '@/data/ids';
import { getEntryHints, saveTemplate } from '@/data/templates';
import { createTransaction, deleteTransaction, findPossibleDuplicates, getTransaction, updateTransaction, type TransactionInput, type UserTransactionType } from '@/data/transactions';
import { addDays, dateOf, formatDate, nowLocal, today } from '@/domain/dates';
import { parseAmount, toDecimalString } from '@/domain/money';
import { rankSuggestions, type Suggestion } from '@/domain/suggestions';
import type { Category } from '@/domain/types';
import { useApp, useQuery } from '@/state/app';
import { Button, EmptyState, IconButton, type IconName, Loading, Row, Screen, Stacked, T } from '@/ui/components/core';
import { useErrorMessage, useFeedback } from '@/ui/components/feedback';
import { useCategoryName, useMoney } from '@/ui/components/finance';
import { AmountInput, Chip, ChipRow, DateField, Field, FieldError, Label, Segmented, SwitchRow } from '@/ui/components/forms';
import { space } from '@/ui/theme';

type Mode = 'expense' | 'income' | 'transfer' | 'refund';

const TOP_CATEGORIES = 8;

function AccountChips({ label, value, accounts, onChange, error }: { label: string; value: string | null; accounts: { id: string; name: string; type: string }[]; onChange: (id: string) => void; error?: string }) {
  const icon = (type: string): IconName => (type === 'cash' ? 'cash-outline' : type === 'savings' ? 'shield-checkmark-outline' : 'business-outline');
  return (
    <View style={{ gap: space.xs }}>
      <Label>{label}</Label>
      <ChipRow>
        {accounts.map((account) => (
          <Chip key={account.id} label={account.name} icon={icon(account.type)} selected={account.id === value} onPress={() => onChange(account.id)} />
        ))}
      </ChipRow>
      <FieldError message={error} />
    </View>
  );
}

export default function TransactionForm() {
  const params = useLocalSearchParams<{
    id?: string;
    type?: Mode;
    preset?: 'withdrawal' | 'deposit';
    relatedId?: string;
    categoryId?: string;
    accountId?: string;
    description?: string;
    amount?: string;
  }>();
  const { t, db, settings } = useApp();
  const router = useRouter();
  const { toast, confirm } = useFeedback();
  const errorMessage = useErrorMessage();
  const nameOf = useCategoryName();
  const money = useMoney();
  const editingId = params.id;

  // One key per opened form: however many times Save fires, only one transaction can result.
  const idempotencyKey = useRef(newId());
  const saving = useRef(false);
  const accountChosen = useRef(false);

  const [mode, setMode] = useState<Mode>(params.type ?? (params.preset ? 'transfer' : 'expense'));
  const [amount, setAmount] = useState(params.amount ?? '');
  const [toAmount, setToAmount] = useState('');
  const [accountId, setAccountId] = useState<string | null>(params.accountId ?? null);
  const [toAccountId, setToAccountId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(params.categoryId ?? null);
  const [date, setDate] = useState(today());
  const [time, setTime] = useState(nowLocal().slice(11));
  const [pickDate, setPickDate] = useState(false);
  const [description, setDescription] = useState(params.description ?? '');
  const [notes, setNotes] = useState('');
  const [counterparty, setCounterparty] = useState('');
  const [tags, setTags] = useState('');
  const [occasional, setOccasional] = useState(false);
  const [fee, setFee] = useState('');
  const [splitOn, setSplitOn] = useState(false);
  const [splitPerson, setSplitPerson] = useState('');
  const [splitShare, setSplitShare] = useState('');
  const [keep, setKeep] = useState(false);
  const [allCategories, setAllCategories] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ amount?: string; account?: string; toAccount?: string; category?: string; form?: string }>({});

  const { data } = useQuery(
    async (conn) => ({
      accounts: await listAccounts(conn),
      income: await listCategories(conn, { kind: 'income', pickable: true }),
      expense: await listCategories(conn, { kind: 'expense', pickable: true }),
      existing: editingId ? await getTransaction(conn, editingId) : null,
      related: params.relatedId ? await getTransaction(conn, params.relatedId) : null,
      hints: await getEntryHints(conn),
    }),
    [editingId, params.relatedId],
  );

  const loaded = useRef(false);
  useEffect(() => {
    if (!data || loaded.current) return;
    loaded.current = true;
    const { accounts, existing, related } = data;
    const bank = accounts.find((a) => a.type === 'bank');
    const cash = accounts.find((a) => a.type === 'cash');

    if (existing) {
      // One-shot hydration of an editable form from an async load; the ref keeps it from re-running.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMode(existing.type as Mode);
      setAmount(toDecimalString(existing.amountMinor, existing.currency));
      setAccountId(existing.accountId);
      setToAccountId(existing.toAccountId);
      if (existing.toAmountMinor && existing.toCurrency) setToAmount(toDecimalString(existing.toAmountMinor, existing.toCurrency));
      setCategoryId(existing.categoryId);
      setDate(dateOf(existing.occurredAt));
      setPickDate(true);
      setTime(existing.occurredAt.slice(11));
      setDescription(existing.description ?? '');
      setNotes(existing.notes ?? '');
      setCounterparty(existing.counterparty ?? '');
      setTags(existing.tags.join(', '));
      setOccasional(existing.occasional);
      setShowMore(Boolean(existing.notes || existing.counterparty || existing.tags.length || existing.occasional));
      accountChosen.current = true;
      return;
    }
    if (related) {
      setMode('refund');
      setAccountId(related.accountId);
      setCategoryId(related.categoryId);
      setDescription(related.description ?? '');
      return;
    }
    if (params.preset === 'deposit') {
      setAccountId(cash?.id ?? null);
      setToAccountId(bank?.id ?? null);
    } else {
      // Most transfers are cash withdrawals, so that is what the transfer tab starts on.
      setToAccountId(cash?.id ?? null);
      if (params.preset === 'withdrawal') setAccountId(bank?.id ?? null);
    }
    if (params.accountId) accountChosen.current = true;
    else if (!params.preset) setAccountId((cash ?? accounts[0])?.id ?? null);
  }, [data, params.preset, params.accountId]);

  const [now] = useState(nowLocal);
  const kind = mode === 'income' ? 'income' : 'expense';

  const categories = useMemo(() => (mode === 'income' ? data?.income : data?.expense) ?? [], [mode, data]);
  const topLevel = useMemo(() => {
    const scores = data?.hints.categoryScores[kind];
    const parents = categories.filter((c) => !c.parentId);
    const scoreOf = (c: Category) => {
      const own = scores?.get(c.id) ?? 0;
      return categories.filter((child) => child.parentId === c.id).reduce((sum, child) => sum + (scores?.get(child.id) ?? 0), own);
    };
    // Stable sort: categories with no history keep the person's own order.
    return [...parents].sort((a, b) => scoreOf(b) - scoreOf(a));
  }, [categories, data, kind]);
  const selected = categories.find((c) => c.id === categoryId);
  const parentId = selected?.parentId ?? selected?.id ?? null;
  const children = parentId ? categories.filter((c) => c.parentId === parentId) : [];

  const suggestions = useMemo(() => {
    if (!data || mode === 'transfer' || editingId) return [];
    const text = description.trim();
    return rankSuggestions(data.hints.history, now, { kind, categoryId: text ? undefined : categoryId, text: text || undefined, limit: 5 }).filter(
      (s) => s.description && s.description !== description,
    );
  }, [data, mode, editingId, description, kind, categoryId, now]);

  if (!data) {
    return (
      <Screen title={t('transaction.add')} scroll={false}>
        <Loading />
      </Screen>
    );
  }

  if (data.accounts.length === 0) {
    return (
      <Screen title={t('transaction.add')}>
        <EmptyState icon="wallet-outline" title={t('transaction.needAccount')} action={t('accounts.add')} onAction={() => router.replace('/account/edit')} />
      </Screen>
    );
  }

  const from = data.accounts.find((a) => a.id === accountId);
  const to = data.accounts.find((a) => a.id === toAccountId);
  const currency = from?.currency ?? settings.baseCurrency;
  const crossCurrency = mode === 'transfer' && from && to && from.currency !== to.currency;
  const isToday = date === today();
  const isYesterday = date === addDays(today(), -1);

  const chooseCategory = (category: Category) => {
    setCategoryId(category.id);
    setErrors({ ...errors, category: undefined });
    const usual = data.hints.accountByCategory.get(category.id);
    if (usual && !accountChosen.current && data.accounts.some((a) => a.id === usual)) setAccountId(usual);
  };

  const applySuggestion = (suggestion: Suggestion) => {
    setDescription(suggestion.description ?? '');
    setCategoryId(suggestion.categoryId);
    if (!amount) setAmount(toDecimalString(suggestion.amountMinor, suggestion.currency));
    if (!accountChosen.current && data.accounts.some((a) => a.id === suggestion.accountId)) setAccountId(suggestion.accountId);
    setErrors({});
  };

  const chooseAccount = (id: string) => {
    accountChosen.current = true;
    setAccountId(id);
    setErrors({ ...errors, account: undefined });
  };

  const applyPreset = (preset: 'withdrawal' | 'deposit') => {
    const bank = data.accounts.find((a) => a.type === 'bank');
    const cash = data.accounts.find((a) => a.type === 'cash');
    setAccountId((preset === 'withdrawal' ? bank : cash)?.id ?? null);
    setToAccountId((preset === 'withdrawal' ? cash : bank)?.id ?? null);
  };

  const buildInput = (): TransactionInput | null => {
    const problems: typeof errors = {};
    const amountMinor = parseAmount(amount, currency);
    if (!amountMinor) problems.amount = t('errors.invalid_amount');
    if (!accountId) problems.account = t('transaction.chooseAccount');
    if (mode === 'transfer' && !toAccountId) problems.toAccount = t('transaction.chooseAccount');
    if (mode !== 'transfer' && !categoryId) problems.category = t('errors.category_required');
    const toAmountMinor = crossCurrency ? parseAmount(toAmount, to.currency) : null;
    if (crossCurrency && !toAmountMinor) problems.toAccount = t('transaction.enterReceived');
    setErrors(problems);
    if (Object.keys(problems).length > 0 || !amountMinor || !accountId) return null;

    return {
      type: mode as UserTransactionType,
      amountMinor,
      accountId,
      toAccountId: mode === 'transfer' ? toAccountId : null,
      toAmountMinor,
      categoryId: mode === 'transfer' ? null : categoryId,
      occurredAt: `${date}T${time}`,
      description,
      notes,
      counterparty,
      tags: tags.split(/[,،]/),
      occasional,
      relatedTransactionId: mode === 'refund' ? (params.relatedId ?? data.existing?.relatedTransactionId ?? null) : null,
      idempotencyKey: editingId ? null : idempotencyKey.current,
    };
  };

  /** Plain entries can be undone with one tap; compound ones are corrected from their parts. */
  const record = async (input: TransactionInput): Promise<string | null> => {
    const feeMinor = mode === 'transfer' && fee.trim() ? parseAmount(fee, currency) : null;
    if (mode === 'transfer' && feeMinor) {
      await createTransferWithFee(db, input, feeMinor, 'cat_fees');
      return null;
    }
    const shareMinor = splitOn ? parseAmount(splitShare, currency) : null;
    if (splitOn) {
      await createSplitExpense(db, input, { person: splitPerson, shareMinor: shareMinor ?? 0 });
      return null;
    }
    return createTransaction(db, input);
  };

  const save = async () => {
    if (saving.current) return;
    const input = buildInput();
    if (!input) return;
    saving.current = true;
    setBusy(true);
    try {
      if (editingId) {
        await updateTransaction(db, editingId, input);
        toast({ message: t('transaction.saved') });
      } else {
        const duplicates = await findPossibleDuplicates(db, input);
        if (duplicates.length > 0) {
          const proceed = await confirm({ title: t('transaction.duplicateTitle'), message: t('transaction.duplicateBody'), confirmLabel: t('transaction.saveAnyway') });
          if (!proceed) return;
        }
        const id = await record(input);
        if (keep && categoryId && (mode === 'expense' || mode === 'income')) {
          const category = categories.find((c) => c.id === categoryId);
          await saveTemplate(db, null, {
            name: description.trim() || (category ? nameOf(category) : ''),
            kind,
            amountMinor: input.amountMinor,
            accountId: input.accountId,
            categoryId,
            description: description.trim() || null,
          });
        }
        toast({
          message: t('transaction.savedAmount', { amount: money(input.amountMinor, currency) }),
          actionLabel: id ? t('common.undo') : undefined,
          onAction: id ? () => void deleteTransaction(db, id).catch((failure: unknown) => toast({ message: errorMessage(failure) })) : undefined,
        });
      }
      if (router.canGoBack()) router.back();
      else router.replace('/');
    } catch (error) {
      setErrors({ form: errorMessage(error) });
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  const shownCategories = allCategories ? topLevel : topLevel.slice(0, TOP_CATEGORIES);
  const selectedHidden = parentId && !shownCategories.some((c) => c.id === parentId) ? topLevel.find((c) => c.id === parentId) : undefined;
  const labelFor = (s: Suggestion) => `${s.description} · ${money(s.amountMinor, s.currency)}`;

  return (
    <Screen title={editingId ? t('transaction.edit') : t('transaction.add')} footer={<Button label={t('common.save')} onPress={() => void save()} loading={busy} />}>
      {!editingId && !params.relatedId ? (
        <Segmented<Mode>
          value={mode}
          onChange={(next) => {
            setMode(next);
            setCategoryId(null);
            setErrors({});
            if (next === 'transfer' && !toAccountId) applyPreset('withdrawal');
          }}
          options={[
            { value: 'expense', label: t('txType.expense') },
            { value: 'income', label: t('txType.income') },
            { value: 'transfer', label: t('txType.transfer') },
          ]}
        />
      ) : (
        <T center tone="muted">
          {t(`txType.${mode}`)}
        </T>
      )}

      <AmountInput
        label={t('transaction.amount')}
        value={amount}
        onChangeText={setAmount}
        currency={currency}
        error={errors.amount}
        autoFocus={!editingId}
        onSubmitEditing={() => void save()}
        tone={mode === 'expense' ? 'negative' : mode === 'transfer' ? undefined : 'positive'}
      />

      {mode === 'transfer' ? (
        <Stacked>
          {!editingId ? (
            <ChipRow>
              <Chip label={t('transaction.withdrawal')} selected={from?.type === 'bank' && to?.type === 'cash'} icon="arrow-down-outline" onPress={() => applyPreset('withdrawal')} />
              <Chip label={t('transaction.deposit')} selected={from?.type === 'cash' && to?.type === 'bank'} icon="arrow-up-outline" onPress={() => applyPreset('deposit')} />
            </ChipRow>
          ) : null}
          <AccountChips label={t('transaction.fromAccount')} value={accountId} accounts={data.accounts} onChange={setAccountId} error={errors.account} />
          <Row gap={0} style={{ justifyContent: 'center' }}>
            <IconButton
              name="swap-vertical-outline"
              label={t('transaction.swap')}
              onPress={() => {
                setAccountId(toAccountId);
                setToAccountId(accountId);
              }}
            />
          </Row>
          <AccountChips label={t('transaction.toAccount')} value={toAccountId} accounts={data.accounts.filter((a) => a.id !== accountId)} onChange={setToAccountId} error={errors.toAccount} />
          <T variant="small" tone="muted">
            {t('transaction.transferHint')}
          </T>
          {crossCurrency ? (
            <Field label={t('transaction.received', { currency: to.currency })} value={toAmount} onChangeText={setToAmount} keyboardType="decimal-pad" hint={t('transaction.receivedHint')} />
          ) : null}
        </Stacked>
      ) : (
        <Stacked>
          {suggestions.length > 0 ? (
            <View style={{ gap: space.xs }}>
              <Label>{t('transaction.suggested')}</Label>
              <ChipRow>
                {suggestions.map((suggestion) => (
                  <Chip key={suggestion.key} label={labelFor(suggestion)} icon="sparkles-outline" selected={false} onPress={() => applySuggestion(suggestion)} />
                ))}
              </ChipRow>
            </View>
          ) : null}
          <View style={{ gap: space.xs }}>
            <Label>{t('transaction.category')}</Label>
            <ChipRow>
              {[...shownCategories, ...(selectedHidden ? [selectedHidden] : [])].map((category) => (
                <Chip key={category.id} label={nameOf(category)} selected={category.id === parentId} icon={category.icon as IconName} color={category.color} onPress={() => chooseCategory(category)} />
              ))}
              {topLevel.length > TOP_CATEGORIES ? (
                <Chip label={allCategories ? t('transaction.fewerCategories') : t('transaction.moreCategories')} selected={false} icon={allCategories ? 'chevron-up' : 'chevron-down'} onPress={() => setAllCategories(!allCategories)} />
              ) : null}
            </ChipRow>
            <FieldError message={errors.category} />
          </View>
          {children.length > 0 ? (
            <ChipRow>
              {children.map((child) => (
                <Chip key={child.id} label={nameOf(child)} selected={child.id === categoryId} color={child.color} onPress={() => chooseCategory(child)} />
              ))}
            </ChipRow>
          ) : null}
          <AccountChips label={t('transaction.paidWith')} value={accountId} accounts={data.accounts} onChange={chooseAccount} error={errors.account} />
        </Stacked>
      )}

      <Field label={t('transaction.description')} value={description} onChangeText={setDescription} />

      <View style={{ gap: space.xs }}>
        <ChipRow>
          <Chip
            label={t('transaction.today')}
            selected={isToday && !pickDate}
            onPress={() => {
              setDate(today());
              setPickDate(false);
            }}
          />
          <Chip
            label={t('transaction.yesterday')}
            selected={isYesterday && !pickDate}
            onPress={() => {
              setDate(addDays(today(), -1));
              setPickDate(false);
            }}
          />
          <Chip label={pickDate && !isToday && !isYesterday ? formatDate(date, settings.language) : t('transaction.otherDate')} selected={pickDate} icon="calendar-outline" onPress={() => setPickDate(true)} />
        </ChipRow>
        {pickDate ? <DateField label={t('transaction.date')} value={date} max={today()} onChange={(value) => value && setDate(value)} /> : null}
      </View>

      {showMore ? (
        <Stacked>
          <TimeField label={t('transaction.time')} value={time} onChange={setTime} />
          {mode === 'transfer' ? (
            <Field label={t('transaction.fee')} value={fee} onChangeText={setFee} keyboardType="decimal-pad" hint={t('transaction.feeHint')} />
          ) : (
            <>
              <Field label={mode === 'income' ? t('transaction.payer') : t('transaction.payee')} value={counterparty} onChangeText={setCounterparty} />
              {mode === 'expense' ? <SwitchRow label={t('transaction.occasional')} hint={t('transaction.occasionalHint')} value={occasional} onChange={setOccasional} /> : null}
              {mode === 'expense' && !editingId ? <SwitchRow label={t('transaction.split')} hint={t('transaction.splitHint')} value={splitOn} onChange={setSplitOn} /> : null}
              {splitOn ? (
                <Stacked>
                  <Field label={t('debts.person')} value={splitPerson} onChangeText={setSplitPerson} />
                  <Field label={t('transaction.splitShare')} value={splitShare} onChangeText={setSplitShare} keyboardType="decimal-pad" />
                </Stacked>
              ) : null}
              {!editingId ? <SwitchRow label={t('transaction.keep')} hint={t('transaction.keepHint')} value={keep} onChange={setKeep} /> : null}
            </>
          )}
          <Field label={t('transaction.tags')} value={tags} onChangeText={setTags} hint={t('transaction.tagsHint')} />
          <Field label={t('transaction.notes')} value={notes} onChangeText={setNotes} multiline />
        </Stacked>
      ) : (
        <Button label={t('transaction.more')} kind="ghost" compact onPress={() => setShowMore(true)} />
      )}
      <FieldError message={errors.form} />
    </Screen>
  );
}

function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (time: string) => void }) {
  const { colors } = useApp();
  const [text, setText] = useState(value);
  return (
    <View style={{ gap: space.xs }}>
      <Label>{label}</Label>
      <TextInput
        accessibilityLabel={label}
        value={text}
        keyboardType="numbers-and-punctuation"
        maxLength={5}
        onChangeText={(next) => {
          setText(next);
          if (/^([01]\d|2[0-3]):[0-5]\d$/.test(next)) onChange(next);
        }}
        onBlur={() => setText(value)}
        style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, minHeight: 48, paddingHorizontal: 12, color: colors.text, backgroundColor: colors.surface, writingDirection: 'ltr' }}
      />
    </View>
  );
}
