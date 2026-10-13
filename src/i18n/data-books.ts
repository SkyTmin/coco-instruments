/**
 * Books, enchant effects, chests and eggs in the current language (areas `books`, `chests`,
 * `eggs`). The lib keeps its Russian text for logic and tests; `books.test.ts` checks that
 * the Russian catalog says exactly what the lib says.
 */
import { fmtDec, t } from './core';
import type { Key } from './core';
import { BOOK_LEVELS, ROMAN } from '@/lib/books';
import type { BookTier } from '@/lib/books';
import type { EnchantId } from '@/lib/prison';
import type { EggId } from '@/lib/pets';
import { enchantName } from './data';

const k = (s: string) => s as Key;

/**
 * Effect of an enchant at `units` (what `ENCHANTS[i].fx(units)` says in Russian):
 * share per unit and decimals of the percent, as in `lib/prison.ts`.
 */
const FX: Record<EnchantId, [per: number, digits: number]> = {
  power: [0.1, 0],
  fortune: [0.06, 0],
  vein: [0.025, 1],
  blast: [0.01, 1],
  hammer: [0.002, 2],
  token: [0.15, 0],
  key: [0.0005, 2],
  frenzy: [0.0008, 2],
  beam: [0.006, 1],
  reforge: [0.015, 1],
};

/** «+30% к скорости копки» — enchant `id` at `units` (`enchUnits(id, lvl, stars)`). */
export function enchantEffect(id: EnchantId, units: number): string {
  const [per, d] = FX[id];
  return t(k(`books.fx.${id}`), { v: fmtDec(per * units * 100, d) });
}

/** «Эффективность III» — the book's enchant and level (`bookTitle` in the lib). */
export const bookName = (b: { id: EnchantId; lvl: number }) =>
  `${enchantName(b.id)} ${ROMAN[Math.max(0, Math.min(BOOK_LEVELS, b.lvl) - 1)]}`;

export const bookTierName = (tier: BookTier) => t(k(`books.tier.${tier}`));
/** «Редкая книга». */
export const bookTierBook = (tier: BookTier) => t(k(`books.tierBook.${tier}`));
/** The Enchanter's line `i` (`MAGE_LINES`). */
export const mageLine = (i: number) => t(k(`books.mage.${i}`));
/** «Ржавая кирка» — pick `i` of `PICKS` with the word «pickaxe». */
export const pickFull = (i: number) => t(k(`books.pick.${i}`));
/** «Редкая кирка» — a pick of rarity `id`. */
export const rarityPick = (id: string) => t(k(`books.rarityPick.${id}`));

/** «Мшистое яйцо» (`EGGS[i].name`). */
export const eggName = (id: EggId) => t(k(`eggs.name.${id}`));
