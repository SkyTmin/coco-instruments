/**
 * Camp data names in the current language (area `campData`, generated from
 * `src/lib/prison.ts`, `pets.ts`, `forest.ts`). The lib keeps its Russian names
 * for the logic and tests; `campData.test.ts` checks the Russian catalog
 * equals them.
 */
import { getLang, lower, t } from './core';
import type { Key } from './core';
import { enchantName } from './data';
import { ROMAN, BOOK_LEVELS } from '@/lib/books';
import { AXES, SPECIES } from '@/lib/forest';
import type { AxeEnchId } from '@/lib/forest';

const k = (s: string) => s as Key;

export const findName = (id: string) => t(k(`campData.find.${id}.name`));
export const findText = (id: string) => t(k(`campData.find.${id}.text`));
export const mileTitle = (id: string) => t(k(`campData.mile.${id}.title`));
export const mileText = (id: string) => t(k(`campData.mile.${id}.text`));
export const eggName = (id: string) => t(k(`campData.egg.${id}`));
export const handleName = (id: string) => t(k(`campData.handle.${id}`));
/** Axe by its index in `AXES` (the save keeps the index). */
export const axeName = (i: number) => t(k(`campData.axe.${AXES[i]?.id}`));
/** Tree species by index in `SPECIES`. */
export const speciesName = (i: number) => t(k(`campData.species.${SPECIES[i]?.id}.name`));
/** The wood form that goes after «boards» in this language (ru «берёзы», en «birch», de «aus Birke»). */
export const woodOf = (i: number) => t(k(`campData.species.${SPECIES[i]?.id}.gen`));
export const axeEnchName = (id: AxeEnchId) => t(k(`campData.axeEnch.${id}.name`));
export const axeEnchPer = (id: AxeEnchId) => t(k(`campData.axeEnch.${id}.per`));
export const benchName = (id: string) => t(k(`campData.bench.${id}.name`));
export const benchWho = (id: string) => t(k(`campData.bench.${id}.who`));

/** «Удача III» — the book's enchant and level (`bookTitle` of lib/prison, translated). */
export const bookName = (b: { id: string; lvl: number }) =>
  `${enchantName(b.id)} ${ROMAN[Math.max(0, Math.min(BOOK_LEVELS, b.lvl) - 1)]}`;

/**
 * A data name inside a sentence: lower-cased like the Russian text does
 * («посылка «редкая»»), except German, where nouns keep their capital.
 */
export const inText = (s: string) => (getLang() === 'de' ? s : lower(s));
