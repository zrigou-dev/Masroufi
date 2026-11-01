import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { type ReactNode, useState } from 'react';
import { Text } from 'react-native';

import { createAccount } from '../../src/data/accounts';
import { getPositions } from '../../src/data/finance';
import { loadSettings } from '../../src/data/settings';
import type { DbWithEvents } from '../../src/data/sql';
import { createTransaction } from '../../src/data/transactions';
import { FinanceError } from '../../src/domain/errors';
import { AppProvider, useApp, useQuery } from '../../src/state/app';
import { FeedbackProvider, useErrorMessage, useFeedback } from '../../src/ui/components/feedback';
import { Money, useMoney } from '../../src/ui/components/finance';
import { AmountInput, Chip, Picker, Segmented } from '../../src/ui/components/forms';
import { Button } from '../../src/ui/components/core';
import { settings } from '../helpers/uiDb';
import { openTestDb } from '../helpers/testDb';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: { children: ReactNode }) => children,
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

jest.mock('expo', () => ({ ...jest.requireActual('expo'), reloadAppAsync: jest.fn() }));

const today = new Date().toISOString().slice(0, 10);
const at = `${today.slice(0, 7)}-01T00:00`;

let db: DbWithEvents;

beforeEach(async () => {
  db = await openTestDb();
});

function wrap(children: ReactNode, over = {}) {
  return (
    <AppProvider db={db} initialSettings={settings(over)}>
      <FeedbackProvider>{children}</FeedbackProvider>
    </AppProvider>
  );
}

describe('Money', () => {
  test('formats for the language', async () => {
    await render(wrap(<Money minor={125_050} currency="MAD" />));
    expect(screen.getByText(/1,250\.50/)).toBeTruthy();
  });

  test('hides amounts in privacy mode', async () => {
    await render(wrap(<Money minor={125_050} currency="MAD" />, { hideAmounts: true }));
    expect(screen.queryByText(/1,250/)).toBeNull();
    expect(screen.getByText(/••••/)).toBeTruthy();
  });
});

describe('useQuery', () => {
  function Balance() {
    const money = useMoney();
    const { data } = useQuery(async (conn) => (await getPositions(conn))[0]?.ownedMinor ?? 0, []);
    return <Text testID="balance">{data === undefined ? 'loading' : money(data, 'MAD')}</Text>;
  }

  test('an open screen updates by itself after any write', async () => {
    const bank = await createAccount(db, { name: 'Bank', type: 'bank', currency: 'MAD', openingBalanceMinor: 10_000 });
    await render(wrap(<Balance />));
    await waitFor(() => expect(screen.getByTestId('balance').props.children).toMatch(/100\.00/));

    await act(async () => {
      await createTransaction(db, { type: 'expense', amountMinor: 2_500, accountId: bank, categoryId: 'cat_food', occurredAt: at });
    });
    await waitFor(() => expect(screen.getByTestId('balance').props.children).toMatch(/75\.00/));
  });
});

describe('dialogs', () => {
  function Harness() {
    const { confirm } = useFeedback();
    const [result, setResult] = useState('none');
    return (
      <>
        <Button label="ask" onPress={() => void confirm({ title: 'Sure?', confirmLabel: 'Yes' }).then((ok) => setResult(String(ok)))} />
        <Text testID="result">{result}</Text>
      </>
    );
  }

  test('confirm resolves true', async () => {
    await render(wrap(<Harness />));
    await fireEvent.press(screen.getByRole('button', { name: 'ask' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Yes' }));
    await waitFor(() => expect(screen.getByTestId('result').props.children).toBe('true'));
  });

  test('cancel resolves false, and the action does not run', async () => {
    await render(wrap(<Harness />));
    await fireEvent.press(screen.getByRole('button', { name: 'ask' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.getByTestId('result').props.children).toBe('false'));
  });
});

describe('error messages', () => {
  function Show({ error }: { error: unknown }) {
    const message = useErrorMessage();
    return <Text>{message(error)}</Text>;
  }

  test('a domain error becomes a sentence', async () => {
    await render(wrap(<Show error={new FinanceError('payment_exceeds_debt')} />));
    expect(screen.getByText('This is more than the remaining balance.')).toBeTruthy();
  });

  test('anything else never leaks internals', async () => {
    await render(wrap(<Show error={new Error('SQLITE_ERROR near "SELECT": balance 1234')} />));
    expect(screen.getByText('Something went wrong. Nothing was changed.')).toBeTruthy();
  });
});

describe('controls', () => {
  test('amount field normalises Arabic digits as they are typed', async () => {
    const onChange = jest.fn();
    await render(wrap(<AmountInput label="Amount" value="" onChangeText={onChange} currency="MAD" />));
    await fireEvent.changeText(screen.getByLabelText('Amount'), '١٢٣٫٥');
    expect(onChange).toHaveBeenCalledWith('123.5');
  });

  test('segmented exposes its selection to assistive technology', async () => {
    const onChange = jest.fn();
    await render(wrap(<Segmented value="a" onChange={onChange} options={[{ value: 'a', label: 'First' }, { value: 'b', label: 'Second' }]} />));
    expect(screen.getByRole('tab', { name: 'First', selected: true })).toBeTruthy();
    await fireEvent.press(screen.getByRole('tab', { name: 'Second' }));
    expect(onChange).toHaveBeenCalledWith('b');
  });

  test('chip reports its checked state', async () => {
    await render(wrap(<Chip label="Food" selected onPress={jest.fn()} />));
    expect(screen.getByRole('radio', { name: 'Food', checked: true })).toBeTruthy();
  });

  test('picker lists options and returns the choice', async () => {
    const onChange = jest.fn();
    await render(wrap(<Picker label="Account" value={null} onChange={onChange} options={[{ value: 'bank', label: 'Bank' }, { value: 'cash', label: 'Cash' }]} />));
    await fireEvent.press(screen.getByRole('button', { name: /^Account:/ }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Cash' }));
    expect(onChange).toHaveBeenCalledWith('cash');
  });

  test('a loading button cannot be pressed twice', async () => {
    const onPress = jest.fn();
    await render(wrap(<Button label="Save" loading onPress={onPress} />));
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('app state', () => {
  function Toggle() {
    const { settings: current, updateSetting, t } = useApp();
    return <Button label={`${t('common.save')}:${current.language}`} onPress={() => void updateSetting('language', 'fr')} />;
  }

  test('changing language translates immediately and persists', async () => {
    await render(wrap(<Toggle />));
    await fireEvent.press(screen.getByRole('button', { name: 'Save:en' }));
    expect(await screen.findByRole('button', { name: 'Enregistrer:fr' })).toBeTruthy();
    expect((await loadSettings(db)).language).toBe('fr');
  });
});
