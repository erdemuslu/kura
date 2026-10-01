export type Locale = 'en' | 'tr';

export const LOCALE_STORAGE_KEY = 'kura-locale';
export const DEFAULT_LOCALE: Locale = 'en';

export function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'tr';
}
