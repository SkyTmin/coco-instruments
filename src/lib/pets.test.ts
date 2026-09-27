import { describe, expect, it } from 'vitest';
import {
  addPet,
  canMerge,
  eggChances,
  eggOf,
  EGGS,
  EGG_BASKET,
  hatchNowCost,
  EGG_PITY,
  hatchRoll,
  MERGE_NEED,
  mergePet,
  NEST_SLOTS,
  normalizePets,
  normalizeSquad,
  NO_EGGS,
  petsVerOf,
  PETS_V,
  V2_PET,
  petBonus,
  PETS,
  petScore,
  placeEgg,
  pullEgg,
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

describe('питомцы (v2.72–v2.73)', () => {
  it('состав: 18 видов, у каждой редкости свои, мифический один', () => {
    expect(PETS.length).toBe(18);
    expect(new Set(PETS.map((p) => p.id)).size).toBe(18);
    const by = [0, 1, 2, 3, 4, 5].map((r) => PETS.filter((p) => p.rarity === r).length);
    expect(by).toEqual([4, 4, 3, 3, 3, 1]);
    // У легендарных две роли, у феникса — все шесть.
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

  it('феникс — только из драконьего яйца', () => {
    const rnd = lcg(3);
    for (const id of ['moss', 'stone', 'crystal'] as EggId[])
      for (let i = 0; i < 20_000; i++) expect(hatchRoll(id, 0, rnd).id).not.toBe('phoenix');
    let found = 0;
    for (let i = 0; i < 40_000; i++) if (hatchRoll('dragon', 0, rnd).id === 'phoenix') found += 1;
    expect(found).toBeGreaterThan(100);
    expect(found).toBeLessThan(320);
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
    expect(Object.keys(petBonus('dragon', { xp: 0, v: 0 })).sort()).toEqual(['loot', 'sell']);
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

  it('выбор яйца (v2.76): вынутое в корзину, прогрев не сгорает и не множится', () => {
    const need = eggOf('moss').need;
    let nest = [
      { egg: 'moss' as EggId, left: need - 1000 },
      { egg: 'stone' as EggId, left: 500 },
    ];
    let eggs = { ...NO_EGGS, dragon: 1 };
    // Вынули недогретое мшистое — тысяча блоков работы осталась за видом.
    const pulled = pullEgg(nest, eggs, NO_EGGS, 0)!;
    expect(pulled.nest.map((x) => x.egg)).toEqual(['stone']);
    expect(pulled.eggs).toMatchObject({ moss: 1, dragon: 1 });
    expect(pulled.heat.moss).toBe(1000);
    // Положили драконье — оно холодное, прогрев мшистого ему не достаётся.
    const withDragon = placeEgg(pulled.nest, pulled.eggs, pulled.heat, 'dragon')!;
    expect(withDragon.nest.at(-1)).toEqual({ egg: 'dragon', left: eggOf('dragon').need });
    expect(withDragon.heat.moss).toBe(1000);
    // Мшистое обратно (обменом на драконье) — с той же тысячей.
    const back = placeEgg(withDragon.nest, withDragon.eggs, withDragon.heat, 'moss', 1)!;
    expect(back.nest[1]).toEqual({ egg: 'moss', left: need - 1000 });
    expect(back.heat.moss).toBe(0);
    expect(back.eggs).toMatchObject({ moss: 0, dragon: 1 });
    // Обмен занимает то же гнездо: порядок гнёзд не прыгает.
    expect(back.nest[0].egg).toBe('stone');
    nest = back.nest;
    eggs = back.eggs;
    // Нельзя: пустая корзина, полная корзина при вынимании, занятые гнёзда без обмена.
    expect(placeEgg(nest, eggs, NO_EGGS, 'crystal')).toBeNull();
    expect(placeEgg(nest, eggs, NO_EGGS, 'dragon')).toBeNull();
    expect(pullEgg(nest, { ...NO_EGGS, moss: EGG_BASKET }, NO_EGGS, 0)).toBeNull();
    // А обмен при полной корзине можно: одно уходит, одно приходит.
    expect(placeEgg(nest, { ...NO_EGGS, moss: EGG_BASKET }, NO_EGGS, 'moss', 0)).not.toBeNull();
  });

  it('сбережённого тепла больше, чем нужно яйцу, — оно ложится готовым, остаток ждёт', () => {
    const need = eggOf('moss').need;
    const r = placeEgg([], { ...NO_EGGS, moss: 2 }, { ...NO_EGGS, moss: need + 300 }, 'moss')!;
    expect(r.nest[0].left).toBe(0);
    expect(r.heat.moss).toBe(300);
    const r2 = placeEgg(r.nest, r.eggs, r.heat, 'moss')!;
    expect(r2.nest[1].left).toBe(need - 300);
  });

  it('вылупить сразу — за цену яйца: драконье за токены, остальные за монеты', () => {
    expect(eggOf('dragon').tokens).toBe(30_000);
    expect(eggOf('dragon').price).toBe(0);
    expect(hatchNowCost('dragon')).toEqual({ coins: 0, tokens: 30_000 });
    // v2.79: остальные — за свою цену в Питомнике, монетами.
    for (const id of ['moss', 'stone', 'crystal'] as EggId[])
      expect(hatchNowCost(id)).toEqual({ coins: eggOf(id).price, tokens: 0 });
  });

  it('коллекция: +1% за вид, весь зоопарк — ещё +10%', () => {
    expect(zooMult({})).toBe(1);
    const all: Pets = Object.fromEntries(PETS.map((p) => [p.id, { xp: 0, dup: 0, v: 0, pat: 0 }]));
    expect(zooMult(all)).toBeCloseTo(1 + ZOO_EACH * PETS.length + ZOO_ALL);
  });

  it('старые сохранения: кольская фауна (v1) переезжает через v2.72 в жителей лагеря', () => {
    const pets = normalizePets({ lemming: 900, owl: 30, calf: 5, junk: 3 }, 1);
    // лемминг → кротёнок → крот; сова → совёнок → бульдог; оленёнок → щенок → хорёк
    expect(pets).toEqual({
      mole: { xp: 900, dup: 0, v: 0, pat: 0 },
      bulldog: { xp: 30, dup: 0, v: 0, pat: 0 },
      ferret: { xp: 5, dup: 0, v: 0, pat: 0 },
    });
    expect(normalizeSquad(undefined, 'owl', pets, 1, 1)).toEqual(['bulldog']);
    // Новое сохранение читается как есть; повторы и чужие выкидываются.
    expect(normalizePets(pets)).toEqual(pets);
    expect(normalizeSquad(['mole', 'mole', 'dragon', 'ferret'], null, pets, 3)).toEqual([
      'mole',
      'ferret',
    ]);
    expect(normalizeSquad(['mole', 'ferret'], null, pets, 1)).toEqual(['mole']);
  });

  it('v2.72 → v2.73: каждый вид переезжает в вид той же редкости, один в один', () => {
    const olds = Object.keys(V2_PET);
    expect(olds.length).toBe(18);
    expect(new Set(Object.values(V2_PET)).size).toBe(18);
    const rarity72 = [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5];
    const order72 = [
      'mole',
      'hamster',
      'hedgehog',
      'mouse',
      'corgi',
      'kitten',
      'owlet',
      'raccoon',
      'panda',
      'penguin',
      'otter',
      'crystalhog',
      'snowcat',
      'firefox',
      'dragon',
      'phoenix',
      'kitsune',
      'whale',
    ];
    order72.forEach((id, i) =>
      expect(PETS.find((p) => p.id === V2_PET[id])!.rarity).toBe(rarity72[i]),
    );
    const rec = { xp: 1234, dup: 3, v: 1, pat: 7 };
    const got = normalizePets({ whale: rec, raccoon: rec, panda: { ...rec, xp: 5 } }, 2);
    expect(got).toEqual({ phoenix: rec, cat: rec, raccoon: { ...rec, xp: 5 } });
    expect(normalizeSquad(['raccoon', 'panda'], null, got, 3, 2)).toEqual(['cat', 'raccoon']);
  });

  it('версия схемы: старый песец не становится эпическим лисом', () => {
    // v1: `fox` — песец (обычный), v3: `fox` — лис-картёжник (эпический)
    expect(petsVerOf({ pets: { fox: 100 } })).toBe(1);
    expect(normalizePets({ fox: 100 }, petsVerOf({ pets: { fox: 100 } }))).toEqual({
      mouse: { xp: 100, dup: 0, v: 0, pat: 0 },
    });
    expect(petsVerOf({ pets: { hamster: { xp: 1 } } })).toBe(2);
    expect(petsVerOf({ petsV: PETS_V, pets: { fox: { xp: 1 } } })).toBe(PETS_V);
    expect(Object.keys(normalizePets({ fox: { xp: 1 } }, PETS_V))).toEqual(['fox']);
    // и повторное чтение ничего не меняет
    const once = normalizePets({ owl: 30, fox: 7 }, 1);
    expect(normalizePets(once, PETS_V)).toEqual(once);
  });
});
