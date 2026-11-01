import { DEFAULT_SETTINGS, type AppSettings } from '../../src/data/settings';

export const settings = (over: Partial<AppSettings> = {}): AppSettings => ({ ...DEFAULT_SETTINGS, onboarded: true, language: 'en', ...over });
