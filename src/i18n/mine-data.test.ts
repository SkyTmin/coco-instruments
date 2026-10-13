/**
 * Mine data areas (wave 2, T1): the Russian catalogs equal the Russian text in
 * `src/lib/prison.ts`. Change a find, an achievement or a guide step in the lib —
 * change `ru/<area>.ts` and the six translations in the same commit.
 */
import { describe, expect, it } from 'vitest';
import { bookTitle, ENCHANTS, FINDS, GUIDE, MILES } from '@/lib/prison';
import { ru } from './ru';
import { tIn } from './core';
import { bookName, nameIn } from './data-mine';

describe('mine data areas match src/lib', () => {
  it('finds', () => {
    expect(ru.finds).toEqual(
      Object.fromEntries(FINDS.map((f) => [f.id, { name: f.name, text: f.text }])),
    );
  });

  it('miles', () => {
    expect(ru.miles).toEqual(
      Object.fromEntries(MILES.map((m) => [m.id, { title: m.title, text: m.text }])),
    );
  });

  it('guide', () => {
    expect(ru.guide).toEqual(
      Object.fromEntries(GUIDE.map((g) => [g.id, { title: g.title, hint: g.hint }])),
    );
  });

  it('book titles read like the lib in Russian', () => {
    for (const e of ENCHANTS)
      for (const lvl of [1, 3, 5])
        expect(bookName({ id: e.id, lvl })).toBe(bookTitle({ id: e.id, lvl }));
  });

  it('Russian text keeps its old shape', () => {
    expect(tIn('ru', 'mineHud.say.parcelLeft', { n: 21 })).toBe('Вскроется через 21 блок');
    expect(tIn('ru', 'mineHud.say.parcelLeft', { n: 3 })).toBe('Вскроется через 3 блока');
    expect(tIn('ru', 'mineHud.card.shiftKeys', { n: 1 })).toBe(' · +1 ключ');
    expect(tIn('ru', 'mineHud.card.shiftKeys', { n: 3 })).toBe(' · +3 ключа');
    expect(tIn('ru', 'mineHud.card.shiftKeys', { n: 5 })).toBe(' · +5 ключей');
    expect(tIn('ru', 'mineHud.card.crewDug', { n: 1 })).toBe('Рабочие накопали 1 блок');
    expect(tIn('ru', 'mineHud.card.crewDug', { n: 22 })).toBe('Рабочие накопали 22 блока');
    expect(tIn('ru', 'forge.listAnd', { a: 'глина, песчаник', b: 'гранит' })).toBe(
      'глина, песчаник и гранит',
    );
    expect(nameIn('Песчаник')).toBe('песчаник');
  });
});
