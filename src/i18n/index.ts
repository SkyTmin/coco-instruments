/**
 * Game translations — public API. How to add a string: `.claude/rules/i18n.md`.
 *
 *   const t = useT();            // in components (re-renders on switch)
 *   t('settings.title')          // → 'Settings'
 *   t('common.coins', { n: 5 })  // plural by n → '5 coins'
 *   fmtNum(12345)                // → '12,345' / '12 345' / '12.345'
 */
export {
  t,
  tIn,
  rich,
  useT,
  useLang,
  getLang,
  setLang,
  resetLang,
  savedLang,
  detectLang,
  autoLang,
  matchLang,
  loadLang,
  subscribeLang,
  hasKey,
  fmtNum,
  fmtDec,
  fmtDate,
  upper,
  lower,
  i18nReady,
} from './core';
export type { Catalog, Key } from './core';
export { LANGS } from './types';
export type { Lang, Params, Plural, Translation } from './types';
export { LOCALE, NATIVE_NAME } from './langs';
export * from './data';
