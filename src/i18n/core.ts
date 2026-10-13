import { createElement, Fragment, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { retrieveLaunchParams } from '@tma.js/sdk-react';
import { ru } from './ru';
import { LANG_ALIASES, LOCALE } from './langs';
import { LANGS } from './types';
import type { Lang, Leaf, Params, Paths, Plural, Translation, Tree } from './types';

/** The full catalog shape (Russian source). */
export type Catalog = typeof ru;
/** Every translatable key: `t('settings.title')`. */
export type Key = Paths<Catalog>;

const SAVED_KEY = 'coco.lang';

type Flat = Map<string, Leaf>;

function isPlural(v: Leaf | Tree): v is Plural {
  return typeof v === 'object' && typeof (v as Plural).other === 'string';
}

/** Catalog tree → dotted keys. Exported for the completeness test. */
export function flatten(
  tree: Tree | Translation<Catalog>,
  prefix = '',
  out: Flat = new Map(),
): Flat {
  for (const [k, v] of Object.entries(tree as Tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string' || isPlural(v)) out.set(key, v);
    else flatten(v, key, out);
  }
  return out;
}

const flat: Partial<Record<Lang, Flat>> = { ru: flatten(ru) };

/**
 * Non-Russian catalogs load lazily: each is its own chunk, fetched when the
 * language is chosen (or detected), never all seven at once.
 */
const LOADERS: Record<Exclude<Lang, 'ru'>, () => Promise<{ default: Translation<Catalog> }>> = {
  en: () => import('./en'),
  fr: () => import('./fr'),
  tr: () => import('./tr'),
  de: () => import('./de'),
  es: () => import('./es'),
  it: () => import('./it'),
};

let lang: Lang = 'ru';
let version = 0;
const listeners = new Set<() => void>();

function emit(): void {
  version++;
  for (const fn of listeners) fn();
}

export function isLang(v: unknown): v is Lang {
  return typeof v === 'string' && (LANGS as readonly string[]).includes(v);
}

/** A raw language code (`en-GB`, `pt`, `kk`) → one of ours. */
export function matchLang(code: string | null | undefined): Lang | null {
  if (!code) return null;
  const c = code.toLowerCase().replace('_', '-');
  const two = c.slice(0, 2);
  if (isLang(c)) return c;
  if (LANG_ALIASES[c]) return LANG_ALIASES[c];
  if (isLang(two)) return two;
  return LANG_ALIASES[two] ?? null;
}

function telegramCode(): string | undefined {
  try {
    const w = (
      window as unknown as {
        Telegram?: { WebApp?: { initDataUnsafe?: { user?: { language_code?: string } } } };
      }
    ).Telegram?.WebApp;
    const code = w?.initDataUnsafe?.user?.language_code;
    if (code) return code;
  } catch {
    /* not in Telegram */
  }
  try {
    return retrieveLaunchParams().tgWebAppData?.user?.language_code;
  } catch {
    return undefined;
  }
}

export function savedLang(): Lang | null {
  try {
    const v = window.localStorage.getItem(SAVED_KEY);
    return isLang(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Auto-detect stays OFF while part of the game is still Russian-only
 * (`NOT_YET_TRANSLATED` in `i18n.test.ts`, lib data): a player with an English
 * Telegram would get a mixed game. Until then everyone starts in Russian and
 * picks a language in ⚙ → Язык; the test turns this on when the list is empty.
 */
export const AUTO_DETECT = false;

/**
 * Saved choice → (with `AUTO_DETECT`) Telegram `language_code` → browser
 * languages → English; without it → Russian.
 */
export function detectLang(): Lang {
  return savedLang() ?? (AUTO_DETECT ? autoLang() : 'ru');
}

/** What auto-detect picks, ignoring the saved choice (Telegram → browser → en). */
export function autoLang(): Lang {
  const tg = matchLang(telegramCode());
  if (tg) return tg;
  try {
    for (const code of navigator.languages ?? [navigator.language]) {
      const m = matchLang(code);
      if (m) return m;
    }
  } catch {
    /* no navigator */
  }
  return 'en';
}

export function getLang(): Lang {
  return lang;
}

/** Load a catalog chunk (no-op for ru and for already loaded ones). */
export async function loadLang(l: Lang): Promise<void> {
  if (flat[l]) return;
  if (l === 'ru') return;
  const mod = await LOADERS[l]();
  flat[l] = flatten(mod.default);
}

function applyDom(l: Lang): void {
  try {
    // `lang` drives CSS text-transform casing (Turkish İ/ı) and hyphenation.
    document.documentElement.lang = l;
  } catch {
    /* no document (tests) */
  }
}

/**
 * Switch language. The UI keeps the old language until the chunk arrives,
 * then every `useT()` re-renders at once. `persist` saves the choice.
 */
export async function setLang(l: Lang, persist = true): Promise<void> {
  if (persist) {
    try {
      window.localStorage.setItem(SAVED_KEY, l);
    } catch {
      /* private mode */
    }
  }
  await loadLang(l).catch(() => undefined);
  if (!flat[l]) return;
  lang = l;
  applyDom(l);
  emit();
}

/** Forget the saved choice: back to auto-detect. */
export async function resetLang(): Promise<void> {
  try {
    window.localStorage.removeItem(SAVED_KEY);
  } catch {
    /* private mode */
  }
  await setLang(detectLang(), false);
}

export function subscribeLang(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---------------------------------------------------------------------------
// Formatting

const numCache = new Map<string, Intl.NumberFormat>();
function nf(l: Lang, digits: number): Intl.NumberFormat {
  const id = `${l}:${digits}`;
  let f = numCache.get(id);
  if (!f) {
    f = new Intl.NumberFormat(LOCALE[l], { maximumFractionDigits: digits });
    numCache.set(id, f);
  }
  return f;
}

/**
 * French groups digits with a narrow no-break space (U+202F); the game font draws it
 * almost zero-wide («54 321» reads «54321»), so it becomes a normal no-break space.
 */
const wide = (s: string) => s.replace(/\u202f/g, '\u00a0');

/** Whole number with the language's grouping: ru «1 234», en «1,234», de «1.234». */
export function fmtNum(n: number, l: Lang = lang): string {
  if (!Number.isFinite(n)) return '—';
  return wide(nf(l, 0).format(Math.round(n)));
}

/**
 * Short money like the old `shortMoney`: below 10 000 in full, above — the
 * language's compact form (ru «12,3 тыс.», «1,2 млн»; en «12.3K»; de «1,2 Mio.»).
 */
export function fmtShort(n: number, l: Lang = lang): string {
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) < 1e4) return fmtNum(n, l);
  return wide(
    new Intl.NumberFormat(LOCALE[l], { notation: 'compact', maximumFractionDigits: 1 }).format(n),
  );
}

/** Number with up to `digits` decimals in the language's style («1,5» / «1.5»). */
export function fmtDec(n: number, digits = 1, l: Lang = lang): string {
  if (!Number.isFinite(n)) return '—';
  return wide(nf(l, digits).format(n));
}

/** Date/time in the language's style. */
export function fmtDate(
  d: Date | number,
  opts: Intl.DateTimeFormatOptions,
  l: Lang = lang,
): string {
  return new Intl.DateTimeFormat(LOCALE[l], opts).format(d);
}

/** Locale-aware casing: Turkish «i» → «İ», «I» → «ı». */
export function upper(s: string, l: Lang = lang): string {
  return s.toLocaleUpperCase(LOCALE[l]);
}
export function lower(s: string, l: Lang = lang): string {
  return s.toLocaleLowerCase(LOCALE[l]);
}

const pluralCache = new Map<Lang, Intl.PluralRules>();
export function pluralRules(l: Lang): Intl.PluralRules {
  let r = pluralCache.get(l);
  if (!r) {
    r = new Intl.PluralRules(LOCALE[l]);
    pluralCache.set(l, r);
  }
  return r;
}

// ---------------------------------------------------------------------------
// Lookup

function pick(leaf: Leaf, l: Lang, params?: Params): string {
  if (typeof leaf === 'string') return leaf;
  const n = Number(params?.n ?? 0);
  const cat = pluralRules(l).select(n) as keyof Plural;
  return leaf[cat] ?? leaf.other;
}

function fill(s: string, l: Lang, params?: Params): string {
  if (!params || !s.includes('{')) return s;
  return s.replace(/\{(\w+)\}/g, (m, name: string) => {
    const v = params[name];
    if (v === undefined) return m;
    return typeof v === 'number' ? fmtDec(v, 2, l) : v;
  });
}

function leafOf(key: string, l: Lang): { leaf: Leaf; l: Lang } | null {
  const own = flat[l]?.get(key);
  if (own !== undefined) return { leaf: own, l };
  const ruLeaf = flat.ru?.get(key);
  if (ruLeaf !== undefined) return { leaf: ruLeaf, l: 'ru' };
  return null;
}

/** Translate in a given language (tests, previews of the language menu). */
export function tIn(l: Lang, key: Key, params?: Params): string {
  const hit = leafOf(key, l);
  if (!hit) {
    if (import.meta.env?.DEV) console.warn(`[i18n] no key ${key}`);
    return key;
  }
  return fill(pick(hit.leaf, hit.l, params), hit.l, params);
}

/**
 * Translate into the current language. `{name}` placeholders take `params`;
 * a plural leaf picks its form by `params.n`. Numbers are locale-formatted.
 * In components prefer `const t = useT()` so a language switch re-renders.
 */
export function t(key: Key, params?: Params): string {
  return tIn(lang, key, params);
}

/** Does the catalog have this key? (for keys built from data ids). */
export function hasKey(key: string): key is Key {
  return flat.ru?.has(key) ?? false;
}

/**
 * Translate with React nodes in placeholders:
 * `rich('shop.price', { coin: <CoinIcon /> , n: 5 })` → ['Цена: ', <CoinIcon/>, ' 5'].
 */
export function rich(key: Key, params: Record<string, ReactNode | string | number>): ReactNode {
  const textParams: Params = {};
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === 'string' || typeof v === 'number') textParams[k] = v;
  }
  const hit = leafOf(key, lang);
  if (!hit) return key;
  const s = pick(hit.leaf, hit.l, textParams);
  const parts = s.split(/(\{\w+\})/g);
  return createElement(
    Fragment,
    null,
    ...parts.map((p, i) => {
      const m = /^\{(\w+)\}$/.exec(p);
      if (!m) return p;
      const v = params[m[1]];
      if (v === undefined) return p;
      if (typeof v === 'number') return fmtDec(v, 2, hit.l);
      if (typeof v === 'string') return v;
      return createElement(Fragment, { key: i }, v);
    }),
  );
}

// ---------------------------------------------------------------------------
// React

/** Current language; re-renders on switch. */
export function useLang(): Lang {
  return useSyncExternalStore(subscribeLang, getLang, getLang);
}

/**
 * `const t = useT()` — the translator, re-rendering the component when the
 * language changes (or its chunk finishes loading).
 */
export function useT(): typeof t {
  useSyncExternalStore(
    subscribeLang,
    () => version,
    () => version,
  );
  return t;
}

// ---------------------------------------------------------------------------
// Boot: pick the language now and start loading its chunk in parallel with
// the rest of the app. Until it arrives the UI falls back to Russian.

/** Resolves when the detected language is ready (or failed to load). */
export const i18nReady: Promise<void> = (() => {
  if (typeof window === 'undefined') return Promise.resolve();
  const l = detectLang();
  return setLang(l, false);
})();
