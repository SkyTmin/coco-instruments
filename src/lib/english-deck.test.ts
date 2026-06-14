import { describe, expect, it, vi } from 'vitest';

// Isolate the deck's pure queue logic from the storage/Telegram-SDK chain.
vi.mock('@/lib/storage', () => ({
  getStorage: () => ({
    get: async () => null,
    set: async () => {},
    remove: async () => {},
    keys: async () => [],
  }),
}));

import { ENGLISH_WORDS } from '@/lib/english-words';
import { ENGLISH_FREQUENCY } from '@/lib/english-frequency';
import { cardBack, deckRemaining, deckTotal, nextWord } from '@/lib/english-deck';

describe('english deck queue', () => {
  it('serves the curated core first, in order', () => {
    expect(nextWord(new Set())).toBe(ENGLISH_WORDS[0].word);
  });

  it('after the whole core, serves a frequency word not in the core', () => {
    const present = new Set(ENGLISH_WORDS.map((w) => w.word));
    const word = nextWord(present);
    expect(word).toBe(ENGLISH_FREQUENCY[0]);
    expect(present.has(word!)).toBe(false);
  });

  it('skips words already present', () => {
    const present = new Set([ENGLISH_WORDS[0].word, ENGLISH_WORDS[1].word]);
    expect(nextWord(present)).toBe(ENGLISH_WORDS[2].word);
  });

  it('total = core + frequency, and remaining tracks what is present', () => {
    expect(deckTotal).toBe(ENGLISH_WORDS.length + ENGLISH_FREQUENCY.length);
    expect(deckRemaining(new Set())).toBe(deckTotal);
    expect(deckRemaining(new Set([ENGLISH_WORDS[0].word]))).toBe(deckTotal - 1);
  });

  it('cardBack drops the reading line when the reading is empty', () => {
    expect(cardBack('перевод', '')).toBe('перевод');
    expect(cardBack('перевод', 'пэр')).toBe('перевод\nЧитается — пэр');
  });
});
