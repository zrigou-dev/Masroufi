import { ar } from '../../src/i18n/ar';
import { en } from '../../src/i18n/en';
import { fr } from '../../src/i18n/fr';
import { translate } from '../../src/i18n';

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const keys = Object.keys(en) as (keyof typeof en)[];

describe('translations', () => {
  test.each(['ar', 'fr'] as const)('%s has exactly the same keys as en', (language) => {
    const messages = language === 'ar' ? ar : fr;
    expect(Object.keys(messages).sort()).toEqual([...keys].sort());
  });

  test('no message is empty', () => {
    for (const messages of [ar, en, fr]) {
      for (const value of Object.values(messages)) expect(value.trim()).not.toBe('');
    }
  });

  test.each(['ar', 'fr'] as const)('%s uses the same placeholders as en', (language) => {
    const messages = language === 'ar' ? ar : fr;
    const mismatched = keys.filter((key) => placeholders(messages[key]).join() !== placeholders(en[key]).join());
    expect(mismatched).toEqual([]);
  });

  test('Arabic strings actually contain Arabic, apart from names and format labels', () => {
    const latinOnly = keys.filter((key) => !/[؀-ۿ]/.test(ar[key]));
    expect(latinOnly).toEqual(['reports.pdf']);
  });

  test('interpolation', () => {
    expect(translate('en', 'accounts.since', { date: '1 Jan' })).toBe('since 1 Jan');
    expect(translate('ar', 'accounts.since', { date: 'x' })).toBe('منذ x');
  });

  test('an unknown language falls back to Arabic, the primary language', () => {
    expect(translate('de', 'common.save')).toBe('حفظ');
  });

  test('the reset confirmation word appears in the instruction, so it can be typed', () => {
    for (const messages of [ar, en, fr]) {
      expect(messages['settings.resetBody']).toContain(messages['settings.resetWord']);
    }
  });
});
