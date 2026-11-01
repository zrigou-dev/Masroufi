import { csvCell, toCsv } from '../domain/csv';
import type { DateRange } from '../domain/dates';
import { toDecimalString } from '../domain/money';
import type { TransactionType } from '../domain/types';
import { listDebts } from './debts';
import { listAccounts } from './accounts';
import type { Db } from './sql';
import { listTransactions, type TransactionView } from './transactions';

export type ExportLabels = {
  type: (type: TransactionType) => string;
  category: (tx: TransactionView) => string;
};

const PAGE = 1000;

export async function exportTransactionsCsv(db: Db, labels: ExportLabels, range?: DateRange): Promise<string> {
  const rows: string[][] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await listTransactions(db, { from: range?.from, to: range?.to, limit: PAGE, offset });
    for (const t of page) {
      rows.push([
        csvCell(t.occurredAt.slice(0, 10)),
        csvCell(t.occurredAt.slice(11)),
        csvCell(labels.type(t.type)),
        csvCell(toDecimalString(t.amountMinor, t.currency), true),
        csvCell(t.currency),
        csvCell(toDecimalString(t.netMinor, t.currency), true),
        csvCell(t.accountName),
        csvCell(t.toAccountName),
        csvCell(t.toAmountMinor !== null && t.toCurrency ? toDecimalString(t.toAmountMinor, t.toCurrency) : '', true),
        csvCell(t.toCurrency),
        csvCell(labels.category(t)),
        csvCell(t.counterparty ?? t.debtCounterparty),
        csvCell(t.description),
        csvCell(t.notes),
        csvCell(t.tags.join(';')),
        csvCell(t.id),
      ]);
    }
    if (page.length < PAGE) break;
  }
  return toCsv(
    ['date', 'time', 'type', 'amount', 'currency', 'net_effect', 'account', 'to_account', 'to_amount', 'to_currency', 'category', 'counterparty', 'description', 'notes', 'tags', 'id'],
    rows,
  );
}

export async function exportDebtsCsv(db: Db): Promise<string> {
  const debts = await listDebts(db);
  const money = (minor: number, currency: string) => csvCell(toDecimalString(minor, currency), true);
  const rows = debts.map((d) => [
    csvCell(d.direction),
    csvCell(d.counterparty),
    csvCell(d.currency),
    money(d.principalMinor, d.currency),
    money(d.feesMinor, d.currency),
    money(d.state.paidMinor, d.currency),
    money(d.state.remainingMinor, d.currency),
    csvCell(d.state.status),
    csvCell(d.startDate),
    csvCell(d.dueDate),
    csvCell(d.description),
  ]);
  return toCsv(['direction', 'counterparty', 'currency', 'principal', 'fees', 'paid', 'remaining', 'status', 'start_date', 'due_date', 'description'], rows);
}

export async function exportAccountsCsv(db: Db): Promise<string> {
  const accounts = await listAccounts(db, { includeArchived: true });
  const rows = accounts.map((a) => [
    csvCell(a.name),
    csvCell(a.type),
    csvCell(a.currency),
    csvCell(toDecimalString(a.balanceMinor, a.currency), true),
    csvCell(a.archivedAt ? 'archived' : 'active'),
  ]);
  return toCsv(['name', 'type', 'currency', 'balance', 'status'], rows);
}
