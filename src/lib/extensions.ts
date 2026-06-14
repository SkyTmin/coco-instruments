// Note "extensions" — small helpers reached from the composer "+" menu that
// drop a ready-made message into the current note. The first one is a spaced
// English vocabulary deck. The shape is deliberately a registry so user-defined
// extensions can be added later (that part is planned, not built yet).

import type { MessageExtra } from '@/lib/notes-messages';
import type { EnglishWord } from '@/lib/english-words';
import { ENGLISH_WORDS } from '@/lib/english-words';

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
  /** The next item to add, skipping `present`; null when nothing is left. */
  next(present: ReadonlySet<string>): ExtensionPick | null;
  /** How many items are still not in the note (for the progress line). */
  remaining(present: ReadonlySet<string>): number;
}

/** Flip-card for one English word: front = #tag, back = translation + the
 *  Russian-phonetic reading on its own line ("Читается — …"). */
function englishCard(w: EnglishWord): MessageExtra {
  return {
    card: {
      front: { text: `#${w.word}` },
      back: { text: `${w.translation}\nЧитается — ${w.pronunciation}` },
    },
  };
}

export const englishExtension: NoteExtension = {
  id: 'english',
  name: 'Английский язык',
  emoji: '🇬🇧',
  description: 'Карточка-слово: тег, перевод и произношение. Каждое нажатие — новое слово.',
  total: ENGLISH_WORDS.length,
  next(present) {
    const w = ENGLISH_WORDS.find((item) => !present.has(item.word));
    return w ? { extra: englishCard(w), label: w.word, key: w.word } : null;
  },
  remaining(present) {
    return ENGLISH_WORDS.reduce((n, item) => (present.has(item.word) ? n : n + 1), 0);
  },
};

/** Every extension available in the composer "+" menu. */
export const NOTE_EXTENSIONS: NoteExtension[] = [englishExtension];
