import { en, type TranslationDict } from './en';
import { tr } from './tr';
import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  isLocale,
  type Locale,
} from './types';

export type { TranslationDict } from './en';
export type { Locale } from './types';
export { DEFAULT_LOCALE, LOCALE_STORAGE_KEY, isLocale } from './types';

export const dictionaries: Record<Locale, TranslationDict> = {
  en,
  tr,
};

/** Read the persisted UI locale from localStorage (for non-React callers). */
export function getUiLocale(): Locale {
  try {
    const saved = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isLocale(saved)) return saved;
  } catch {
    /* ignore */
  }
  return DEFAULT_LOCALE;
}

export type TranslateParams = Record<string, string | number>;

type DictValue = string | { [key: string]: DictValue };

function lookup(dict: TranslationDict, key: string): string | undefined {
  const parts = key.split('.');
  let cur: DictValue = dict as unknown as DictValue;
  for (const part of parts) {
    if (cur == null || typeof cur === 'string') return undefined;
    cur = cur[part];
  }
  return typeof cur === 'string' ? cur : undefined;
}

/** Resolve a translation key for the given locale; falls back to English, then the key. */
export function translate(
  locale: Locale,
  key: string,
  params?: TranslateParams,
): string {
  const raw =
    lookup(dictionaries[locale], key) ??
    lookup(dictionaries[DEFAULT_LOCALE], key) ??
    key;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, name: string) =>
    params[name] !== undefined ? String(params[name]) : `{${name}}`,
  );
}

export type TFunction = (key: string, params?: TranslateParams) => string;

/** Display label for built-in categories; custom menus keep their stored label. */
export function categoryDisplayLabel(
  category: { id: string; label: string },
  t: TFunction,
): string {
  if (category.id === 'movie' || category.id === 'series' || category.id === 'music') {
    return t(`categories.${category.id}`);
  }
  return category.label;
}
