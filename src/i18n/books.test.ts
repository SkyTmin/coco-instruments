import { describe, expect, it } from 'vitest';
import { ru } from './ru';
import { bookName, enchantEffect } from './data-books';
import { BOOK_LEVELS, BOOK_TIERS, MAGE_LINES } from '@/lib/books';
import { bookTitle, ENCHANTS, enchUnits, PICK_STARS_MAX, PICKS } from '@/lib/prison';
import { RARITIES } from '@/lib/rarity';
import { EGGS } from '@/lib/pets';

const ix = (a: string[]) => Object.fromEntries(a.map((v, i) => [String(i), v]));
const by = <T extends { id: string }>(a: T[], f: (x: T) => unknown) =>
  Object.fromEntries(a.map((x) => [x.id, f(x)]));

describe('ru.books equals lib', () => {
  it('book tiers, Enchanter lines, picks', () => {
    expect(ru.books.tier).toEqual(by(BOOK_TIERS, (b) => b.name));
    expect(ru.books.tierBook).toEqual(by(BOOK_TIERS, (b) => `${b.name} книга`));
    expect(ru.books.mage).toEqual(ix(MAGE_LINES));
    expect(ru.books.pick).toEqual(ix(PICKS.map((p) => `${p.name} кирка`)));
    expect(ru.books.rarityPick).toEqual(by(RARITIES, (r) => `${r.name} кирка`));
  });

  it('enchant effects and book names, every level and star', () => {
    expect(Object.keys(ru.books.fx).sort()).toEqual(ENCHANTS.map((e) => e.id).sort());
    for (const e of ENCHANTS)
      for (let lvl = 1; lvl <= BOOK_LEVELS; lvl++) {
        expect(bookName({ id: e.id, lvl })).toBe(bookTitle({ id: e.id, lvl }));
        for (let stars = 0; stars <= PICK_STARS_MAX; stars++) {
          const u = enchUnits(e.id, lvl, stars);
          expect(enchantEffect(e.id, u), `${e.id} ${lvl} ★${stars}`).toBe(e.fx(u));
        }
      }
  });

  it('egg names', () => {
    expect(ru.eggs.name).toEqual(by(EGGS, (e) => e.name));
  });
});
