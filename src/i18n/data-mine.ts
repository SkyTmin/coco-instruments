/**
 * Mine text by id (agent T1, wave 2): finds, achievements (miles), guide steps,
 * book titles, pick titles. The lib keeps its Russian for logic and tests
 * (`mine-data.test.ts` checks ru equals the lib); the UI shows these.
 */
import { getLang, lower, t } from './core';
import type { Key } from './core';
import { enchantName } from './data';
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

/**
 * «Ржавая кирка», «Rusty Pickaxe», «Eisenspitzhacke», «Pioche en opale» — the full names of
 * the books tab (`books.pick`), so the forge and the books say the same.
 */
export const pickTitle = (i: number) => t(k(`books.pick.${i}`));

/**
 * The pick as the object of the forge button `forge.forgeIt` («Выковать {name}»): ru the short
 * name in the accusative («Каменную» — every pick name is a feminine adjective in «-ая»), tr the
 * title in the accusative («Taş Kazmayı»), fr/es/it the title in sentence case after the
 * article of the template, en/de the title as it stands.
 */
export function pickToForge(i: number): string {
  const lang = getLang();
  if (lang === 'ru') return t(k(`mine.pick.${i}`)).replace(/ая$/, 'ую');
  if (lang === 'tr') return pickTitle(i).replace(/Kazma$/, 'Kazmayı');
  if (lang === 'fr' || lang === 'es' || lang === 'it') return lower(pickTitle(i));
  return pickTitle(i);
}

/**
 * A standalone name (rock, pick, item, rarity…) inside a sentence: lower case,
 * except in German, where nouns keep their capital («der Sandstein»).
 */
export const nameIn = (s: string) => (getLang() === 'de' ? s : lower(s));
