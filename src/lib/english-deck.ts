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
import { fetchJson } from '@/lib/fetch-json';
import { translateToRu } from '@/lib/english-translate';
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
// v2: richer entries (multi-sense translation + part of speech + IPA), so the
// bump re-fetches anything cached by the older MyMemory-only pipeline.
const CACHE_KEY = 'coco-english-cache-v2';
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

/** Raw IPA string for a word (e.g. "ˈdʒɜːni"), from the free dictionary API. */
async function fetchIpaRaw(word: string): Promise<string> {
  const data = (await fetchJson(
    `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
  )) as Array<{ phonetic?: string; phonetics?: Array<{ text?: string }> }> | null;
  if (Array.isArray(data)) {
    for (const entry of data) {
      if (entry?.phonetic?.trim()) return entry.phonetic.trim();
      const p = (entry?.phonetics ?? []).find((x) => x?.text?.trim());
      if (p?.text) return p.text.trim();
    }
  }
  return '';
}

/** Resolve a word to its card data: instant for the curated core and anything
 *  cached; otherwise fetch a good translation (+ part of speech) and the
 *  reading (Russian transcription + IPA), then cache. Null = couldn't resolve
 *  (offline, or no translation found). */
export async function resolveWord(word: string): Promise<WordData | null> {
  const core = ENGLISH_BY_WORD.get(word);
  if (core) {
    return { word, translation: core.translation, pronunciation: core.pronunciation };
  }
  await hydrateCache();
  const cached = memCache.get(word);
  if (cached) return { word, ...cached };

  const [tr, ipaRaw] = await Promise.all([translateToRu(word), fetchIpaRaw(word)]);
  if (!tr) return null;

  const translation = tr.pos ? `${tr.translation} · ${tr.pos}` : tr.translation;
  const reading = ipaToRussian(ipaRaw);
  const ipaText = ipaRaw.replace(/[/[\]]/g, '').trim();
  const pronunciation = [reading, ipaText ? `[${ipaText}]` : ''].filter(Boolean).join(' · ');

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
