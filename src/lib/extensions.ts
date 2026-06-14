// Note "extensions" — small helpers reached from the composer "+" menu that
// drop a ready-made message into the current note. The first one is an endless
// English vocabulary deck. The shape is a registry so user-defined extensions
// can be added later (planned, not built yet).

import type { MessageExtra } from '@/lib/notes-messages';
import { cardBack, deckRemaining, deckTotal, nextWord, resolveWord } from '@/lib/english-deck';

/** One thing an extension wants to add to the note. */
export interface ExtensionPick {
  /** The message payload (a flip-card, here). */
  extra: MessageExtra;
  /** Short label for the confirmation toast (e.g. the word added). */
  label: string;
  /** Dedup key once the message lands — the #tag it introduces, lowercased. */
  key: string;
}

/** A helper shown in the "Расширения" sheet. `present` is the set of #tags
 *  already in the note (lowercased), so each extension can skip duplicates. */
export interface NoteExtension {
  id: string;
  name: string;
  /** Emoji shown beside the name in the list. */
  emoji: string;
  description: string;
  /** How many items it can add in total (for the progress line). */
  total: number;
  /** How many items are still not in the note. When this is 0 and next()
   *  returns null the deck is truly exhausted (vs. a failed fetch). */
  remaining(present: ReadonlySet<string>): number;
  /** The next item to add, skipping `present`. Async because a new word may
   *  need its translation/reading fetched. Null = exhausted or unresolved. */
  next(present: ReadonlySet<string>): Promise<ExtensionPick | null>;
}

export const englishExtension: NoteExtension = {
  id: 'english',
  name: 'Английский язык',
  emoji: '🇬🇧',
  description: 'Карточка-слово: тег, перевод и произношение. Каждое нажатие — новое слово.',
  total: deckTotal,
  remaining: deckRemaining,
  async next(present) {
    // Try a few candidates so one un-resolvable word (offline / no translation)
    // doesn't dead-end the whole deck.
    const pool = new Set(present);
    for (let attempt = 0; attempt < 5; attempt++) {
      const word = nextWord(pool);
      if (!word) return null; // exhausted
      const data = await resolveWord(word);
      if (data) {
        return {
          extra: {
            card: {
              front: { text: `#${word}` },
              back: { text: cardBack(data.translation, data.pronunciation) },
            },
          },
          label: word,
          key: word,
        };
      }
      pool.add(word); // couldn't resolve — skip it and try the next word
    }
    return null;
  },
};

/** Every extension available in the composer "+" menu. */
export const NOTE_EXTENSIONS: NoteExtension[] = [englishExtension];
