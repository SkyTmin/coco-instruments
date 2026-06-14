// English → Russian translation for the deck, tuned for *reliability*: try the
// best source first and fall through on any failure (offline / CORS / down), so
// quality degrades gracefully but is never worse than before.
//
//   1. Google (gtx) — best quality; its dictionary block gives several Russian
//      senses + part of speech in one call.
//   2. Lingva — a CORS-friendly Google proxy (covers the case gtx is blocked).
//   3. MyMemory — always reachable, mediocre — the safety net.
//
// All calls run in the user's browser / Telegram webview.

import { fetchJson } from '@/lib/fetch-json';

export interface TranslateResult {
  /** Russian translation — possibly several comma-separated senses. */
  translation: string;
  /** Part of speech, already abbreviated in Russian (сущ./глаг./…). */
  pos?: string;
}

const POS_RU: Record<string, string> = {
  noun: 'сущ.',
  verb: 'глаг.',
  adjective: 'прил.',
  adverb: 'нареч.',
  pronoun: 'мест.',
  preposition: 'предл.',
  conjunction: 'союз',
  interjection: 'межд.',
  exclamation: 'межд.',
  numeral: 'числ.',
  article: 'арт.',
  determiner: 'опред.',
  particle: 'част.',
  abbreviation: 'сокр.',
  'auxiliary verb': 'глаг.',
  phrase: 'выраж.',
};

/** A translation is only kept if it actually has Cyrillic and isn't an echo or
 *  a provider warning. */
export function usableTranslation(text: string, word: string): boolean {
  const s = (text ?? '').trim();
  if (!s) return false;
  if (/PLEASE SELECT|INVALID|NO QUERY|MYMEMORY WARNING|QUERY LENGTH/i.test(s)) return false;
  if (s.toLowerCase() === word.toLowerCase()) return false;
  return /[Ѐ-ӿ]/.test(s); // must contain Cyrillic
}

/** Parse Google's gtx response (`dt=t&dt=bd`): prefer the dictionary block (a
 *  few Russian senses + POS); else the plain translation. Pure — unit-tested. */
export function parseGoogle(data: unknown, word: string): TranslateResult | null {
  if (!Array.isArray(data)) return null;
  const segs = Array.isArray(data[0]) ? (data[0] as unknown[]) : [];
  const primary = segs
    .map((s) => (Array.isArray(s) && typeof s[0] === 'string' ? s[0] : ''))
    .join('')
    .trim();

  const dict = Array.isArray(data[1]) ? (data[1] as unknown[]) : null;
  if (dict) {
    for (const grp of dict) {
      if (!Array.isArray(grp)) continue;
      const terms = Array.isArray(grp[1])
        ? (grp[1] as unknown[]).filter((t): t is string => typeof t === 'string')
        : [];
      if (terms.length) {
        const posKey = typeof grp[0] === 'string' ? grp[0].toLowerCase() : '';
        return { translation: terms.slice(0, 4).join(', '), pos: POS_RU[posKey] };
      }
    }
  }
  return usableTranslation(primary, word) ? { translation: primary } : null;
}

async function viaGoogle(word: string): Promise<TranslateResult | null> {
  const data = await fetchJson(
    `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ru&dt=t&dt=bd&q=${encodeURIComponent(word)}`,
  );
  const r = parseGoogle(data, word);
  return r && usableTranslation(r.translation, word) ? r : null;
}

async function viaLingva(word: string): Promise<TranslateResult | null> {
  const data = (await fetchJson(`https://lingva.ml/api/v1/en/ru/${encodeURIComponent(word)}`)) as {
    translation?: string;
  } | null;
  const t = (data?.translation ?? '').trim();
  return usableTranslation(t, word) ? { translation: t } : null;
}

async function viaMyMemory(word: string): Promise<TranslateResult | null> {
  const data = (await fetchJson(
    `https://api.mymemory.translated.net/get?q=${encodeURIComponent(word)}&langpair=en|ru`,
  )) as { responseData?: { translatedText?: string } } | null;
  let t = (data?.responseData?.translatedText ?? '').trim();
  if (!usableTranslation(t, word)) return null;
  t = t
    .replace(/\s*;\s*/g, ' / ')
    .split(' / ')
    .slice(0, 3)
    .join(' / ');
  return { translation: t };
}

/** Best available Russian translation for an English word, or null. */
export async function translateToRu(word: string): Promise<TranslateResult | null> {
  return (await viaGoogle(word)) ?? (await viaLingva(word)) ?? (await viaMyMemory(word));
}
