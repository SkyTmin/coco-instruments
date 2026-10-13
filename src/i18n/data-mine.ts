/**
 * Mine text by id (agent T1, wave 2): finds, achievements (miles), guide steps,
 * book titles, pick titles. The lib keeps its Russian for logic and tests
 * (`mine-data.test.ts` checks ru equals the lib); the UI shows these.
 */
import { getLang, lower, t } from './core';
import type { Key } from './core';
import { enchantName, pickName } from './data';
import { BOOK_LEVELS, ROMAN } from '@/lib/books';

const k = (s: string) => s as Key;

export const findName = (id: string) => t(k(`finds.${id}.name`));
export const findText = (id: string) => t(k(`finds.${id}.text`));
export const mileTitle = (id: string) => t(k(`miles.${id}.title`));
export const mileText = (id: string) => t(k(`miles.${id}.text`));
export const guideTitle = (id: string) => t(k(`guide.${id}.title`));
export const guideHint = (id: string) => t(k(`guide.${id}.hint`));

/** «Эффективность III» — the enchant's name and the book's Roman level (as `bookTitle`). */
export const bookName = (b: { id: string; lvl: number }) =>
  `${enchantName(b.id)} ${ROMAN[Math.max(0, Math.min(BOOK_LEVELS, b.lvl) - 1)]}`;

/** «Ржавая кирка», «Rusty pickaxe», «Spitzhacke Rostig». */
export const pickTitle = (i: number) => t('forge.pick', { name: pickName(i) });

/**
 * A standalone name (rock, pick, item, rarity…) inside a sentence: lower case,
 * except in German, where nouns keep their capital («der Sandstein»).
 */
export const nameIn = (s: string) => (getLang() === 'de' ? s : lower(s));
