import { daysBetween, dateOf, type LocalDateTime } from './dates';

/**
 * Learning from habits, with no store of its own: everything here is derived on demand from the
 * transactions already on the device, so it can never drift from them, it travels with every
 * backup, and correcting a transaction corrects what the app has learned.
 */

export type HistoryItem = {
  kind: 'income' | 'expense';
  description: string | null;
  categoryId: string;
  accountId: string;
  amountMinor: number;
  currency: string;
  occurredAt: LocalDateTime;
};

export type Suggestion = {
  key: string;
  kind: 'income' | 'expense';
  description: string | null;
  categoryId: string;
  accountId: string;
  /** The most usual amount. */
  amountMinor: number;
  /** True when the amount rarely varies, so one tap can record it. */
  stableAmount: boolean;
  currency: string;
  count: number;
  score: number;
};

const HALF_LIFE_DAYS = 45;
const NEAR_HOURS = 2;
const NEAR_HOUR_BOOST = 1.5;
const STABLE_SHARE = 0.6;
const MIN_REPEATS = 2;

/** Folds the spelling variation of everyday Arabic, plus case, so قهوه finds قهوة. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[ً-ٰٟ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Recent habits count for more, and today's habit at this hour counts for more still. */
function weight(item: HistoryItem, now: LocalDateTime): number {
  const age = Math.max(0, daysBetween(dateOf(item.occurredAt), dateOf(now)));
  const hour = Number(item.occurredAt.slice(11, 13));
  const nowHour = Number(now.slice(11, 13));
  const near = Math.abs(hour - nowHour) <= NEAR_HOURS;
  return 0.5 ** (age / HALF_LIFE_DAYS) * (near ? NEAR_HOUR_BOOST : 1);
}

function mostCommon<T>(values: T[]): { value: T; share: number } {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  // History arrives newest first, so a tie goes to what was used most recently.
  let best = values[0];
  for (const [value, count] of counts) {
    if (count > (counts.get(best) ?? 0)) best = value;
  }
  return { value: best, share: (counts.get(best) ?? 0) / values.length };
}

export type SuggestionQuery = {
  kind?: 'income' | 'expense';
  categoryId?: string | null;
  /** What has been typed so far. Matching on text also finds things done only once. */
  text?: string;
  limit?: number;
};

export function rankSuggestions(history: HistoryItem[], now: LocalDateTime, query: SuggestionQuery = {}): Suggestion[] {
  const groups = new Map<string, HistoryItem[]>();
  for (const item of history) {
    if (query.kind && item.kind !== query.kind) continue;
    if (query.categoryId && item.categoryId !== query.categoryId) continue;
    const label = item.description ? normalizeText(item.description) : '';
    const key = `${item.kind}|${item.categoryId}|${label}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }

  const typed = query.text ? normalizeText(query.text) : '';
  const results: Suggestion[] = [];
  for (const [key, items] of groups) {
    if (typed) {
      if (!items[0].description || !normalizeText(items[0].description).includes(typed)) continue;
    } else if (items.length < MIN_REPEATS) {
      continue;
    }
    const amount = mostCommon(items.map((i) => i.amountMinor));
    results.push({
      key,
      kind: items[0].kind,
      description: items[0].description,
      categoryId: items[0].categoryId,
      accountId: mostCommon(items.map((i) => i.accountId)).value,
      amountMinor: amount.value,
      stableAmount: amount.share >= STABLE_SHARE,
      currency: items[0].currency,
      count: items.length,
      score: items.reduce((sum, item) => sum + weight(item, now), 0),
    });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, query.limit ?? 8);
}

/** How strongly each category is part of current habits, for putting the likely ones first. */
export function categoryScores(history: HistoryItem[], now: LocalDateTime, kind: 'income' | 'expense'): Map<string, number> {
  const scores = new Map<string, number>();
  for (const item of history) {
    if (item.kind === kind) scores.set(item.categoryId, (scores.get(item.categoryId) ?? 0) + weight(item, now));
  }
  return scores;
}

/** The account usually paid from for each category: "food is cash, rent is bank". */
export function preferredAccounts(history: HistoryItem[]): Map<string, string> {
  const byCategory = new Map<string, string[]>();
  for (const item of history) {
    byCategory.set(item.categoryId, [...(byCategory.get(item.categoryId) ?? []), item.accountId]);
  }
  return new Map([...byCategory].map(([category, accounts]) => [category, mostCommon(accounts).value]));
}
