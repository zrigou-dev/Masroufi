import { ar } from './ar';
import { en } from './en';
import { fr } from './fr';

export type TKey = keyof typeof en;

/** Typed against en.ts, so a key missing from any language is a compile error. */
export type Messages = Record<TKey, string>;

const MESSAGES: Record<string, Messages> = { ar, en, fr };

export function translate(language: string, key: TKey, params?: Record<string, string | number>): string {
  const template = (MESSAGES[language] ?? ar)[key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}
