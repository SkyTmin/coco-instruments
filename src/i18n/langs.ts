import type { Lang } from './types';

/** Locale tag for `Intl` (numbers, dates, plurals, casing). */
export const LOCALE: Record<Lang, string> = {
  ru: 'ru-RU',
  en: 'en-US',
  fr: 'fr-FR',
  tr: 'tr-TR',
  de: 'de-DE',
  es: 'es-ES',
  it: 'it-IT',
};

/**
 * Language names in themselves — the language menu shows these, never
 * translated (a German player looks for «Deutsch», not «Немецкий»).
 * The order is the menu order.
 */
export const NATIVE_NAME: Record<Lang, string> = {
  ru: 'Русский',
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
  it: 'Italiano',
  tr: 'Türkçe',
};

/**
 * Browser/Telegram language code → our language. Codes not listed fall back
 * by their two-letter prefix, then to English.
 */
export const LANG_ALIASES: Record<string, Lang> = {
  // Russian is the lingua franca for these Telegram audiences.
  be: 'ru',
  kk: 'ru',
  ky: 'ru',
  tg: 'ru',
  // Azerbaijani readers understand Turkish far better than English.
  az: 'tr',
  // Catalan, Galician, Basque speakers all read Spanish.
  ca: 'es',
  gl: 'es',
  eu: 'es',
};
