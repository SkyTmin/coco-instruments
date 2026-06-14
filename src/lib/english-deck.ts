// The "Английский язык" deck brain: an endless, frequency-ordered queue of
// words and the on-device resolution of each word's translation + reading.
//
//   1. curated core (english-words.ts) — hand-tuned, perfect, works OFFLINE;
//   2. then the frequency list (english-frequency.ts) — thousands of words whose
//      translation + Russian reading are fetched once from free public APIs
//      (MyMemory for the translation, dictionaryapi.dev for IPA → ipa-ru), then
//      cached in the app's storage so they're instant and offline ever after.
//
// The fetch runs in the user's browser / Telegram webview (never the VPS), so
// the server's network restrictions don't apply.

import { ENGLISH_BY_WORD, ENGLISH_WORDS } from '@/lib/english-words';
import { ENGLISH_FREQUENCY } from '@/lib/english-frequency';
import { ipaToRussian } from '@/lib/ipa-ru';
import { getStorage } from '@/lib/storage';

export interface WordData {
  word: string;
  translation: string;
  pronunciation: string;
}

// The full queue: curated core first, then the frequency list (already free of
// core words and function words). Unique by construction.
const QUEUE: readonly string[] = [...ENGLISH_WORDS.map((w) => w.word), ...ENGLISH_FREQUENCY];

export const deckTotal = QUEUE.length;

/** The next queued word not already in the note, or null when the deck is done. */
export function nextWord(present: ReadonlySet<string>): string | null {
  for (const word of QUEUE) if (!present.has(word)) return word;
  return null;
}

/** How many queued words are still not in the note. */
export function deckRemaining(present: ReadonlySet<string>): number {
  let n = 0;
  for (const word of QUEUE) if (!present.has(word)) n++;
  return n;
}

/** Card back text: translation, with the reading on its own line when known. */
export function cardBack(translation: string, pronunciation: string): string {
  return pronunciation ? `${translation}\nЧитается — ${pronunciation}` : translation;
}

// ---- cache of fetched (non-core) words -----------------------------------
const CACHE_KEY = 'coco-english-cache';
const memCache = new Map<string, { translation: string; pronunciation: string }>();
let hydrated = false;
let hydrating: Promise<void> | null = null;

/** Load the fetched-word cache from storage once (so readings survive reloads
 *  and show up in graph tooltips). Safe to call repeatedly. */
export function hydrateCache(): Promise<void> {
  if (hydrated) return Promise.resolve();
  if (hydrating) return hydrating;
  hydrating = getStorage()
    .get<Record<string, { translation: string; pronunciation: string }>>(CACHE_KEY)
    .then((obj) => {
      if (obj) for (const [word, v] of Object.entries(obj)) memCache.set(word, v);
      hydrated = true;
    })
    .catch(() => {
      hydrated = true;
    });
  return hydrating;
}

let saveTimer = 0;
function persistCache() {
  if (typeof window === 'undefined') return;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    const obj: Record<string, { translation: string; pronunciation: string }> = {};
    for (const [word, v] of memCache) obj[word] = v;
    void getStorage().set(CACHE_KEY, obj);
  }, 400);
}

async function fetchJson(url: string, ms = 8000): Promise<unknown | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchTranslation(word: string): Promise<string | null> {
  const data = (await fetchJson(
    `https://api.mymemory.translated.net/get?q=${encodeURIComponent(word)}&langpair=en|ru`,
  )) as { responseData?: { translatedText?: string } } | null;
  let t = (data?.responseData?.translatedText ?? '').trim();
  if (!t) return null;
  // MyMemory returns ALL-CAPS warnings when something is off — reject those.
  if (/PLEASE SELECT|INVALID|NO QUERY|MYMEMORY WARNING|QUERY LENGTH/i.test(t)) return null;
  // No real translation found → it echoes the source word back.
  if (t.toLowerCase() === word.toLowerCase()) return null;
  // Trim to a couple of variants to keep the card tidy.
  t = t
    .replace(/\s*;\s*/g, ' / ')
    .split(' / ')
    .slice(0, 3)
    .join(' / ');
  return t;
}

async function fetchPronunciation(word: string): Promise<string> {
  const data = (await fetchJson(
    `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
  )) as Array<{ phonetic?: string; phonetics?: Array<{ text?: string }> }> | null;
  let ipa = '';
  if (Array.isArray(data)) {
    for (const entry of data) {
      if (entry?.phonetic) {
        ipa = entry.phonetic;
        break;
      }
      const p = (entry?.phonetics ?? []).find((x) => x?.text);
      if (p?.text) {
        ipa = p.text;
        break;
      }
    }
  }
  return ipaToRussian(ipa);
}

/** Resolve a word to its card data: instant for the curated core and anything
 *  cached; otherwise fetch translation + reading and cache. Null = couldn't
 *  resolve (e.g. offline, or no translation found). */
export async function resolveWord(word: string): Promise<WordData | null> {
  const core = ENGLISH_BY_WORD.get(word);
  if (core) {
    return { word, translation: core.translation, pronunciation: core.pronunciation };
  }
  await hydrateCache();
  const cached = memCache.get(word);
  if (cached) return { word, ...cached };

  const [translation, pronunciation] = await Promise.all([
    fetchTranslation(word),
    fetchPronunciation(word),
  ]);
  if (!translation) return null;
  const entry = { translation, pronunciation };
  memCache.set(word, entry);
  persistCache();
  return { word, ...entry };
}

/** Graph tooltip for a tag that's a deck word (core or already-fetched). Sync —
 *  reads the in-memory cache, so call hydrateCache() once on mount for the
 *  fetched words to appear. */
export function tooltipForTag(tag: string): string | null {
  const key = tag.toLowerCase();
  const core = ENGLISH_BY_WORD.get(key);
  if (core) return `${core.translation} · ${core.pronunciation}`;
  const cached = memCache.get(key);
  if (!cached) return null;
  return cached.pronunciation
    ? `${cached.translation} · ${cached.pronunciation}`
    : cached.translation;
}
