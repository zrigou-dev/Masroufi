import { fail } from './errors';

/** Amounts are integers in the currency's minor unit (centimes for MAD). */
export type MoneyByCurrency = Record<string, number>;

export const DEFAULT_CURRENCY = 'MAD';

export const CURRENCIES: Record<string, { decimals: number }> = {
  MAD: { decimals: 2 },
  EUR: { decimals: 2 },
  USD: { decimals: 2 },
  GBP: { decimals: 2 },
  CAD: { decimals: 2 },
  CHF: { decimals: 2 },
  SAR: { decimals: 2 },
  AED: { decimals: 2 },
  TND: { decimals: 3 },
  JPY: { decimals: 0 },
};

/** 100 billion units: far beyond personal finance, far below Number.MAX_SAFE_INTEGER. */
export const MAX_AMOUNT_MINOR = 10_000_000_000_000;

const SYMBOLS: Record<string, Record<string, string>> = {
  // The written word, not the abbreviation "د.م.", whose final dot collides with sentence punctuation.
  MAD: { ar: 'درهم', fr: 'DH', en: 'MAD' },
};

const SEPARATORS: Record<string, { group: string; decimal: string }> = {
  ar: { group: ',', decimal: '.' },
  en: { group: ',', decimal: '.' },
  fr: { group: ' ', decimal: ',' },
};

export function isSupportedCurrency(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(CURRENCIES, code);
}

export function currencyDecimals(code: string): number {
  if (!isSupportedCurrency(code)) fail('invalid_currency', { currency: code });
  return CURRENCIES[code].decimals;
}

export function isValidAmount(minor: number): boolean {
  return Number.isSafeInteger(minor) && minor > 0 && minor <= MAX_AMOUNT_MINOR;
}

export function assertValidAmount(minor: number): void {
  if (!isValidAmount(minor)) fail('invalid_amount');
}

/** Sums without leaving the safe-integer range, so a corrupt value cannot silently round. */
export function addMinor(a: number, b: number): number {
  const sum = a + b;
  if (!Number.isSafeInteger(sum)) fail('invalid_amount');
  return sum;
}

export function normalizeDigits(text: string): string {
  return text
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, '.')
    .replace(/٬/g, ',');
}

/**
 * Parses what a person types into a minor-unit integer, using string arithmetic so that
 * no binary floating point is involved. Returns null for anything that cannot be read
 * exactly; extra decimals are rejected rather than rounded away.
 */
export function parseAmount(input: string, currency: string): number | null {
  const decimals = currencyDecimals(currency);
  const text = normalizeDigits(input).replace(/[\s  ]/g, '');
  if (!/^[0-9.,]+$/.test(text) || !/[0-9]/.test(text)) return null;

  const lastDot = text.lastIndexOf('.');
  const lastComma = text.lastIndexOf(',');
  let integerPart = text;
  let fraction = '';

  if (lastDot >= 0 && lastComma >= 0) {
    const decimalAt = Math.max(lastDot, lastComma);
    const groupChar = decimalAt === lastDot ? ',' : '.';
    const head = text.slice(0, decimalAt);
    if (head.includes(text[decimalAt])) return null;
    integerPart = head.split(groupChar).join('');
    fraction = text.slice(decimalAt + 1);
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? '.' : ',';
    const parts = text.split(sep);
    const groupsOfThree = parts.length > 1 && parts.slice(1).every((p) => p.length === 3);
    // "1,250" is how this app prints thousands. A lone "1.250" could mean either reading, and
    // guessing wrong is a thousandfold error, so it falls through to be rejected as too precise.
    const isGrouping = parts.length > 2 || (sep === ',' && decimals < 3);
    if (groupsOfThree && isGrouping && parts[0].length > 0 && parts[0].length <= 3) {
      integerPart = parts.join('');
    } else if (parts.length === 2) {
      integerPart = parts[0];
      fraction = parts[1];
    } else {
      return null;
    }
  }

  if (!/^[0-9]*$/.test(integerPart) || !/^[0-9]*$/.test(fraction)) return null;
  if (fraction.length > decimals) return null;

  const digits = (integerPart || '0') + fraction.padEnd(decimals, '0');
  const minor = Number(digits);
  if (!Number.isSafeInteger(minor) || minor > MAX_AMOUNT_MINOR) return null;
  return minor;
}

/** Plain machine-readable decimal, used by forms and CSV: 1234.5 MAD -> "1234.50". */
export function toDecimalString(minor: number, currency: string): string {
  const decimals = currencyDecimals(currency);
  const sign = minor < 0 ? '-' : '';
  const digits = String(Math.abs(minor)).padStart(decimals + 1, '0');
  if (decimals === 0) return sign + digits;
  const cut = digits.length - decimals;
  return `${sign}${digits.slice(0, cut)}.${digits.slice(cut)}`;
}

export type FormatOptions = {
  hidden?: boolean;
  /** Show + on positive values, for signed activity lists. */
  signed?: boolean;
};

export function currencySymbol(currency: string, language: string): string {
  return SYMBOLS[currency]?.[language] ?? currency;
}

export function formatMoney(
  minor: number,
  currency: string,
  language: string,
  options: FormatOptions = {},
): string {
  const lang = SEPARATORS[language] ? language : 'en';
  const { group, decimal } = SEPARATORS[lang];
  const symbol = SYMBOLS[currency]?.[lang] ?? currency;
  // LRI/PDI isolate the number so that bidi reordering keeps "1,250.00" and its sign intact.
  const isolate = (s: string) => `⁦${s}⁩`;
  if (options.hidden) return `${isolate('••••')} ${symbol}`;

  const [whole, fraction] = toDecimalString(Math.abs(minor), currency).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, group);
  const number = fraction ? `${grouped}${decimal}${fraction}` : grouped;
  const sign = minor < 0 ? '-' : options.signed && minor > 0 ? '+' : '';
  return `${isolate(sign + number)} ${symbol}`;
}

export function addTo(totals: MoneyByCurrency, currency: string, minor: number): void {
  totals[currency] = addMinor(totals[currency] ?? 0, minor);
}

/** Largest-remainder split: parts always sum exactly to the total. */
export function splitEvenly(totalMinor: number, parts: number): number[] {
  if (!Number.isInteger(parts) || parts <= 0) return [];
  const base = Math.floor(totalMinor / parts);
  const extra = totalMinor - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < extra ? 1 : 0));
}
