import { describe, expect, it } from 'vitest';
import {
  addPet,
  canMerge,
  eggChances,
  EGGS,
  EGG_PITY,
  hatchRoll,
  MERGE_NEED,
  mergePet,
  NEST_SLOTS,
  normalizePets,
  normalizeSquad,
  NO_EGGS,
  petBonus,
  PETS,
  petScore,
  putEgg,
  refillNest,
  squadSlots,
  warmNest,
  zooMult,
  ZOO_ALL,
  ZOO_EACH,
} from './pets';
import type { EggId, Pets } from './pets';

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('питомцы (v2.72)', () => {
  it('состав: 18 видов, у каждой редкости свои, мифический один', () => {
    expect(PETS.length).toBe(18);
    expect(new Set(PETS.map((p) => p.id)).size).toBe(18);
    const by = [0, 1, 2, 3, 4, 5].map((r) => PETS.filter((p) => p.rarity === r).length);
    expect(by).toEqual([4, 4, 3, 3, 3, 1]);
    // У легендарных две роли, у кита — все шесть.
    for (const p of PETS.filter((x) => x.rarity === 4)) expect(p.stats.length).toBe(2);
    expect(PETS.find((p) => p.rarity === 5)!.stats.length).toBe(6);
  });

  it('вылупление сходится с таблицей яйца', () => {
    const rnd = lcg(7);
    for (const e of EGGS) {
      const want = eggChances(e.id);
      const got = [0, 0, 0, 0, 0, 0];
      const N = 40_000;
      // Гарантию выключаем: меряем чистую таблицу.
      for (let i = 0; i < N; i++) got[hatchRoll(e.id, 0, rnd).rarity] += 1;
      want.forEach((w, r) => expect(Math.abs(got[r] / N - w)).toBeLessThan(0.01));
    }
  });

  it('кит — только из драконьего яйца', () => {
    const rnd = lcg(3);
    for (const id of ['moss', 'stone', 'crystal'] as EggId[])
      for (let i = 0; i < 20_000; i++) expect(hatchRoll(id, 0, rnd).id).not.toBe('whale');
    let whales = 0;
    for (let i = 0; i < 40_000; i++) if (hatchRoll('dragon', 0, rnd).id === 'whale') whales += 1;
    expect(whales).toBeGreaterThan(100);
    expect(whales).toBeLessThan(320);
  });

  it(`гарантия: ${EGG_PITY}-е яйцо без эпического — эпический или выше`, () => {
    const rnd = lcg(11);
    let pity = 0;
    let worst = 0;
    let since = 0;
    for (let i = 0; i < 5_000; i++) {
      const h = hatchRoll('moss', pity, rnd);
      pity = h.pity;
      since = h.rarity >= 3 ? 0 : since + 1;
      worst = Math.max(worst, since);
    }
    expect(worst).toBeLessThan(EGG_PITY);
  });

  it('копии: пять одинаковых — золотой, пять золотых — радужный, дальше лакомство', () => {
    let pets: Pets = {};
    expect(addPet(pets, 'mole').kind).toBe('new');
    pets = addPet(pets, 'mole').pets;
    for (let i = 0; i < MERGE_NEED[0]; i++) pets = addPet(pets, 'mole').pets;
    expect(canMerge(pets.mole)).toBe(true);
    pets = mergePet(pets, 'mole')!;
    expect(pets.mole).toMatchObject({ v: 1, dup: 0 });
    expect(mergePet(pets, 'mole')).toBeNull();
    for (let i = 0; i < MERGE_NEED[1]; i++) pets = addPet(pets, 'mole').pets;
    pets = mergePet(pets, 'mole')!;
    expect(pets.mole!.v).toBe(2);
    const xp = pets.mole!.xp;
    const t = addPet(pets, 'mole');
    expect(t.kind).toBe('treat');
    expect(t.pets.mole!.xp).toBeGreaterThan(xp);
    // Золотой сильнее обычного, радужный — золотого.
    const rec = { xp: 5000 };
    expect(petScore('mole', { ...rec, v: 1 })).toBeGreaterThan(petScore('mole', { ...rec, v: 0 }));
    expect(petScore('mole', { ...rec, v: 2 })).toBeGreaterThan(petScore('mole', { ...rec, v: 1 }));
  });

  it('чем реже, тем сильнее на том же уровне', () => {
    const avg = (r: number) => {
      const list = PETS.filter((p) => p.rarity === r);
      return list.reduce((s, p) => s + petScore(p.id, { xp: 9000, v: 0 }), 0) / list.length;
    };
    for (let r = 1; r <= 5; r++) expect(avg(r)).toBeGreaterThan(avg(r - 1));
    // Прибавки только своих ролей.
    expect(Object.keys(petBonus('dragon', { xp: 0, v: 0 })).sort()).toEqual(['dmg', 'loot']);
  });

  it('отряд: одно место, второе с ранга J, третье после престижа', () => {
    expect(squadSlots(0, 0)).toBe(1);
    expect(squadSlots(8, 0)).toBe(1);
    expect(squadSlots(9, 0)).toBe(2);
    expect(squadSlots(0, 1)).toBe(3);
  });

  it('гнёзда: яйцо в свободное, лишнее в корзину, созревает от работы', () => {
    let nest = putEgg([], NO_EGGS, 'moss').nest;
    let a = putEgg(nest, NO_EGGS, 'stone');
    nest = a.nest;
    expect(nest.length).toBe(NEST_SLOTS);
    a = putEgg(nest, NO_EGGS, 'dragon');
    expect(a.where).toBe('basket');
    const w = warmNest(nest, 4000);
    expect(w.ready).toBe(1);
    // Освободили гнездо — старшее яйцо из корзины ложится первым.
    const re = refillNest(
      w.nest.filter((x) => x.left > 0),
      { ...NO_EGGS, moss: 2, dragon: 1 },
    );
    expect(re.nest.map((x) => x.egg)).toEqual(['stone', 'dragon']);
    expect(re.eggs).toMatchObject({ moss: 2, dragon: 0 });
    // Тёплое яйцо (подарок заданий) почти готово.
    expect(putEgg([], NO_EGGS, 'moss', 150).nest[0].left).toBe(150);
  });

  it('коллекция: +1% за вид, весь зоопарк — ещё +10%', () => {
    expect(zooMult({})).toBe(1);
    const all: Pets = Object.fromEntries(PETS.map((p) => [p.id, { xp: 0, dup: 0, v: 0, pat: 0 }]));
    expect(zooMult(all)).toBeCloseTo(1 + ZOO_EACH * PETS.length + ZOO_ALL);
  });

  it('старые сохранения: кольская фауна переезжает с опытом, питомец — в отряд', () => {
    const pets = normalizePets({ lemming: 900, owl: 30, calf: 5, junk: 3 });
    expect(pets).toEqual({
      mole: { xp: 900, dup: 0, v: 0, pat: 0 },
      owlet: { xp: 30, dup: 0, v: 0, pat: 0 },
      corgi: { xp: 5, dup: 0, v: 0, pat: 0 },
    });
    expect(normalizeSquad(undefined, 'owl', pets, 1)).toEqual(['owlet']);
    // Новое сохранение читается как есть; повторы и чужие выкидываются.
    expect(normalizePets(pets)).toEqual(pets);
    expect(normalizeSquad(['mole', 'mole', 'dragon', 'corgi'], null, pets, 3)).toEqual([
      'mole',
      'corgi',
    ]);
    expect(normalizeSquad(['mole', 'corgi'], null, pets, 1)).toEqual(['mole']);
  });
});
