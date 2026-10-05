import { describe, expect, it } from 'vitest';
import {
  actsOf,
  BUNK_BIG_PRICE,
  BUNK_BIG_SLOTS,
  BUNK_SLOTS,
  BUNK_START,
  bunkBuyBig,
  bunkCount,
  bunkPut,
  bunkRoom,
  bunkSize,
  bunkTake,
  bunkUsed,
  inventoryOf,
  ITEM_STACK,
  normalizeBunk,
  stackMax,
  thingKey,
} from './inventory';
import { BUNK_MATS_VER } from './inventory';
import type { BunkState, InvRef } from './inventory';
import { DUNGEON_START } from './dungeon';
import type { DungeonState } from './dungeon';
import { bagCapacity, PRISON_START, ROCKS, RUNE_BAG } from './prison';
import type { PrisonState, Rune } from './prison';
import { EGG_BASKET, NO_EGGS } from './pets';
import { SHELF_MAX } from './books';
import type { Book } from './books';

const book = (lvl: number, chance = 50, id: Book['id'] = 'power'): Book => ({ id, lvl, chance });
const rune = (id: number, tier = 1): Rune => ({ id, kind: 'sell', tier, roll: 40 });

function world(over: Partial<PrisonState> = {}, stash: DungeonState['stash'] = {}) {
  const p: PrisonState = { ...PRISON_START, ...over };
  const d: DungeonState = { ...DUNGEON_START, stash };
  return { p, d, b: BUNK_START as BunkState };
}

/** Всё добро по видам: дома плюс в сундуке — сумма не меняется от переноса. */
function totals(p: PrisonState, d: DungeonState, b: BunkState): Record<string, number> {
  const t: Record<string, number> = {};
  const add = (k: string, n: number) => {
    if (n) t[k] = (t[k] ?? 0) + n;
  };
  for (const [id, n] of Object.entries(d.stash)) add(`mat:${id}`, n ?? 0);
  for (const [id, n] of Object.entries(p.items)) add(`item:${id}`, n);
  for (const [id, n] of Object.entries(p.eggs)) add(`egg:${id}`, n);
  for (const x of p.books) add(`book:${x.id}:${x.lvl}:${x.chance}`, 1);
  for (const r of p.runes) add(`rune:${r.kind}:${r.tier}:${r.roll}`, 1);
  for (const s of b.slots) {
    if (!s) continue;
    if (s.thing.t === 'rune')
      add(`rune:${s.thing.rune.kind}:${s.thing.rune.tier}:${s.thing.rune.roll}`, s.n);
    else add(thingKey(s.thing), s.n);
  }
  return t;
}

describe('инвентарь: всё по разделам', () => {
  it('руда рюкзака видна по видам, лимит рюкзака — по его уровню', () => {
    const { p, d, b } = world({ bag: { 0: 12, 3: 5 }, bagLevel: 2, forgeBox: { 2: 7 } });
    const inv = inventoryOf(p, d, b);
    const ore = inv.find((s) => s.id === 'ore')!;
    expect(ore.items.filter((i) => i.where === 'bag').map((i) => [i.name, i.n])).toEqual([
      [ROCKS[3].name, 5],
      [ROCKS[0].name, 12],
    ]);
    expect(ore.items.find((i) => i.where === 'box')?.n).toBe(7);
    expect(ore.limits[0]).toMatchObject({ used: 17, max: bagCapacity(2) });
    // Руда рюкзака шахты в сундук не идёт (копилка под «Получку»).
    expect(ore.items.every((i) => !i.ref && i.stack === 0)).toBe(true);
  });

  it('лимиты — прежние: корзина 12, полка 30, мешочек 40', () => {
    const { p, d, b } = world();
    const inv = inventoryOf(p, d, b);
    const lim = (id: string) => inv.find((s) => s.id === id)!.limits[0].max;
    expect(lim('eggs')).toBe(EGG_BASKET);
    expect(lim('books')).toBe(SHELF_MAX);
    expect(lim('runes')).toBe(RUNE_BAG);
    expect(lim('bunk')).toBe(BUNK_SLOTS);
  });

  it('руна из оберега и яйцо в гнезде — только посмотреть', () => {
    const { p, d, b } = world({
      runes: [rune(1), rune(2)],
      runeSeq: 2,
      sockets: [2, 0, 0, 0],
      nest: [{ egg: 'moss', left: 10 }],
      eggs: { ...NO_EGGS, stone: 2 },
    });
    const inv = inventoryOf(p, d, b);
    const runes = inv.find((s) => s.id === 'runes')!.items;
    expect(runes.find((r) => r.key === 'rune:2')).toMatchObject({ where: 'socket', acts: [] });
    expect(runes.find((r) => r.key === 'rune:1')?.acts).toContain('toBunk');
    const eggs = inv.find((s) => s.id === 'eggs')!.items;
    expect(eggs.find((e) => e.where === 'nest')?.acts).toEqual([]);
    const basket = eggs.find((e) => e.where === 'basket')!;
    expect(basket.acts).toEqual(['nest', 'toBunk']);
    // Кнопки по месту: у сундука — перекладывать, во дворе — только в гнездо.
    expect(actsOf(basket, 'bunk')).toEqual(['nest', 'toBunk']);
    expect(actsOf(basket, 'yard')).toEqual(['nest']);
    expect(actsOf(basket, 'view')).toEqual([]);
  });

  it('энергетик пьют в шахте, бомбу бросают в шахте', () => {
    const { p, d, b } = world({ items: { ...PRISON_START.items, energy: 2, bomb3: 1 } });
    const items = inventoryOf(p, d, b).find((s) => s.id === 'items')!.items;
    const energy = items.find((i) => i.key === 'item:energy')!;
    const bomb = items.find((i) => i.key === 'item:bomb3')!;
    expect(actsOf(energy, 'mine')).toEqual(['use']);
    expect(actsOf(bomb, 'mine')).toEqual(['throw']);
    expect(actsOf(energy, 'yard')).toEqual([]);
  });

  it('находки — вся коллекция, ненайденные силуэтом', () => {
    const { p, d, b } = world({ finds: { coin: 2 } });
    const finds = inventoryOf(p, d, b).find((s) => s.id === 'finds')!;
    expect(finds.items.length).toBeGreaterThan(5);
    expect(finds.items[0]).toMatchObject({ n: 2, name: 'Старая монета' });
    expect(finds.items[1].icon).toMatchObject({ ghost: true });
    expect(finds.limits[0].used).toBe(1);
  });

  it('рюкзак вылазки, ждущей внизу, виден — только посмотреть', () => {
    const { p } = world();
    const sack = {
      meat: { meat: 40 },
      mats: { skin: 3, 'ore:2': 70 },
      tokens: 5,
      keys: 1,
      coins: 0,
      meatBy: {},
    };
    const d = {
      ...DUNGEON_START,
      run: {
        lift: 'mouth',
        floor: 1,
        area: 'mouth',
        x: 1,
        y: 1,
        hp: 50,
        sack,
        started: 0,
        killed: 0,
      },
    };
    const s = inventoryOf(p, d).find((x) => x.id === 'sack')!;
    expect(s.items.map((i) => [i.kind, i.n])).toEqual([
      ['sack:meat', 40],
      ['sack:skin', 3],
      ['sack:ore:2', 70],
      ['sack:tokens', 5],
      ['sack:keys', 1],
    ]);
    expect(s.items.every((i) => i.acts.length === 0 && !i.ref)).toBe(true);
    expect(s.limits[0]).toMatchObject({ used: 5, max: 9 });
    // Нет вылазки — раздел пуст.
    expect(inventoryOf(p, DUNGEON_START).find((x) => x.id === 'sack')!.items).toEqual([]);
  });

  it('модуль ничего не меняет в состоянии, которое читает', () => {
    const { p, d } = world({ bag: { 1: 3 }, books: [book(2)], eggs: { ...NO_EGGS, moss: 1 } });
    const snap = JSON.stringify({ p, d });
    inventoryOf(p, d);
    expect(JSON.stringify({ p, d })).toBe(snap);
  });
});

describe('сундук у койки: стопки', () => {
  it('стопки по виду: руда подземелья 64, блок 16, трофей 1, расходник 16, яйцо/книга/руна 1', () => {
    expect(stackMax({ t: 'mat', id: 'ore:3' })).toBe(64);
    expect(stackMax({ t: 'mat', id: 'block:3' })).toBe(16);
    expect(stackMax({ t: 'mat', id: 'crown' })).toBe(1);
    expect(stackMax({ t: 'mat', id: 'skin' })).toBe(32);
    expect(stackMax({ t: 'item', id: 'bomb3' })).toBe(ITEM_STACK);
    expect(stackMax({ t: 'egg', egg: 'moss' })).toBe(1);
    expect(stackMax({ t: 'book', book: book(3) })).toBe(1);
    expect(stackMax({ t: 'rune', rune: rune(1) })).toBe(1);
  });

  it('руда подземелья ложится стопками по 64, сперва в неполную', () => {
    let { p, d, b } = world({}, { 'ore:4': 150 });
    const ref: InvRef = { t: 'mat', id: 'ore:4' };
    const a = bunkPut(p, d, b, ref, 10)!;
    expect(a.n).toBe(10);
    ({ p, d, b } = a);
    const c = bunkPut(p, d, b, ref, 140)!;
    expect(c.n).toBe(140);
    expect(c.b.slots.slice(0, 3).map((s) => s?.n)).toEqual([64, 64, 22]);
    expect(c.d.stash['ore:4']).toBeUndefined();
  });

  it('яйца — по одному в ячейку: сундук забит — остаток дома', () => {
    const { p, d } = world({ eggs: { ...NO_EGGS, moss: 12 } });
    // Сундук, где свободно пять ячеек.
    const b: BunkState = {
      big: false,
      slots: BUNK_START.slots.map((_, i) =>
        i < 22 ? { thing: { t: 'mat', id: 'crown' }, n: 1 } : null,
      ),
    };
    const r = bunkPut(p, d, b, { t: 'egg', egg: 'moss' }, 12)!;
    expect(r.n).toBe(5);
    expect(r.p.eggs.moss).toBe(7);
    expect(bunkUsed(r.b)).toBe(27);
    expect(bunkPut(r.p, r.d, r.b, { t: 'egg', egg: 'moss' }, 1)).toBeNull();
  });

  it('назад — только в своё хранилище и сколько влезет', () => {
    let { p, d, b } = world({ eggs: { ...NO_EGGS, stone: 3 } });
    ({ p, d, b } = bunkPut(p, d, b, { t: 'egg', egg: 'stone' }, 3)!);
    // Корзина тем временем наполнилась доверху.
    p = { ...p, eggs: { ...NO_EGGS, moss: EGG_BASKET } };
    expect(bunkTake(p, d, b, 0, 1)).toBeNull();
    p = { ...p, eggs: { ...NO_EGGS, moss: EGG_BASKET - 1 } };
    const r = bunkTake(p, d, b, 0, 1)!;
    expect(r.n).toBe(1);
    expect(r.p.eggs.stone).toBe(1);
    expect(r.b.slots[0]).toBeNull();
  });

  it('книга уходит и возвращается та же самая; полная полка не принимает', () => {
    const shelf = [book(1), book(7, 35, 'hammer'), book(3)];
    let { p, d, b } = world({ books: shelf });
    const put = bunkPut(p, d, b, { t: 'book', index: 1 }, 1)!;
    expect(put.p.books).toEqual([book(1), book(3)]);
    expect(put.b.slots[0]).toEqual({ thing: { t: 'book', book: book(7, 35, 'hammer') }, n: 1 });
    ({ p, d, b } = put);
    const full = { ...p, books: Array.from({ length: SHELF_MAX }, () => book(1)) };
    expect(bunkTake(full, d, b, 0, 1)).toBeNull();
    const back = bunkTake(p, d, b, 0, 5)!;
    expect(back.n).toBe(1);
    expect(back.p.books).toContainEqual(book(7, 35, 'hammer'));
  });

  it('руну из оберега не положить; номер руны живёт с ней', () => {
    let { p, d, b } = world({ runes: [rune(5), rune(6, 3)], runeSeq: 6, sockets: [5, 0, 0, 0] });
    expect(bunkPut(p, d, b, { t: 'rune', id: 5 }, 1)).toBeNull();
    ({ p, d, b } = bunkPut(p, d, b, { t: 'rune', id: 6 }, 1)!);
    expect(p.runes.map((r) => r.id)).toEqual([5]);
    const back = bunkTake(p, d, b, 0, 1)!;
    expect(back.p.runes.find((r) => r.tier === 3)?.id).toBe(6);
    expect(back.p.runeSeq).toBe(6);
  });

  it('занятый номер руны — руна получает новый, гнёзда не путаются', () => {
    const { p, d } = world({ runes: [rune(3)], runeSeq: 9, sockets: [3, 0, 0, 0] });
    const b: BunkState = {
      big: false,
      slots: [{ thing: { t: 'rune', rune: rune(3, 4) }, n: 1 }, ...BUNK_START.slots.slice(1)],
    };
    const r = bunkTake(p, d, b, 0, 1)!;
    expect(r.p.runes.map((x) => x.id).sort()).toEqual([10, 3]);
    expect(r.p.runeSeq).toBe(10);
    expect(r.p.sockets[0]).toBe(3);
  });

  it('полный мешочек рун не принимает руну назад', () => {
    const { d } = world();
    const p = {
      ...PRISON_START,
      runes: Array.from({ length: RUNE_BAG }, (_, i) => rune(i + 1)),
      runeSeq: RUNE_BAG,
    };
    const b: BunkState = {
      big: false,
      slots: [{ thing: { t: 'rune', rune: rune(99) }, n: 1 }, ...BUNK_START.slots.slice(1)],
    };
    expect(bunkTake(p, d, b, 0, 1)).toBeNull();
  });

  it('расходники и материалы склада возвращаются всегда — у них нет края', () => {
    let { p, d, b } = world({ items: { ...PRISON_START.items, lens: 40 } }, { skin: 70 });
    ({ p, d, b } = bunkPut(p, d, b, { t: 'item', id: 'lens' }, 40)!);
    ({ p, d, b } = bunkPut(p, d, b, { t: 'mat', id: 'skin' }, 70)!);
    expect(bunkCount(b, 'item:lens')).toBe(40);
    expect(bunkCount(b, 'mat:skin')).toBe(70);
    expect(bunkUsed(b)).toBe(3 + 3);
    for (let i = 0; i < b.slots.length; i++) {
      if (!b.slots[i]) continue;
      const r = bunkTake(p, d, b, i, 999)!;
      ({ p, d, b } = r);
    }
    expect(p.items.lens).toBe(40);
    expect(d.stash.skin).toBe(70);
    expect(bunkUsed(b)).toBe(0);
  });

  it('ничего не теряется и не множится — тысячи случайных переносов', () => {
    let seed = 7;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    let p: PrisonState = {
      ...PRISON_START,
      items: { ...PRISON_START.items, bomb3: 37, energy: 5, charge: 20 },
      eggs: { ...NO_EGGS, moss: 8, dragon: 3 },
      books: Array.from({ length: 25 }, (_, i) => book(1 + (i % 10), 5 + (i % 20) * 5)),
      runes: Array.from({ length: 30 }, (_, i) => ({ ...rune(i + 1, 1 + (i % 5)), roll: i })),
      runeSeq: 30,
      sockets: [4, 9, 0, 0],
    };
    let d: DungeonState = {
      ...DUNGEON_START,
      stash: { skin: 300, 'ore:5': 500, 'block:5': 40, crown: 2 },
    };
    let b: BunkState = { big: false, slots: BUNK_START.slots.slice() };
    const start = totals(p, d, b);
    const refs = (): InvRef[] => [
      { t: 'mat', id: 'skin' },
      { t: 'mat', id: 'ore:5' },
      { t: 'mat', id: 'block:5' },
      { t: 'mat', id: 'crown' },
      { t: 'item', id: 'bomb3' },
      { t: 'item', id: 'energy' },
      { t: 'item', id: 'charge' },
      { t: 'egg', egg: 'moss' },
      { t: 'egg', egg: 'dragon' },
      { t: 'book', index: Math.floor(rnd() * Math.max(1, p.books.length)) },
      { t: 'rune', id: p.runes[Math.floor(rnd() * Math.max(1, p.runes.length))]?.id ?? 0 },
    ];
    for (let k = 0; k < 4000; k++) {
      if (k === 2000) {
        const big = bunkBuyBig(b, BUNK_BIG_PRICE)!;
        b = big.b;
      }
      const want = 1 + Math.floor(rnd() * 80);
      const r =
        rnd() < 0.55
          ? bunkPut(p, d, b, refs()[Math.floor(rnd() * 11)], want)
          : bunkTake(p, d, b, Math.floor(rnd() * bunkSize(b)), want);
      if (r) ({ p, d, b } = r);
      // Инварианты на каждом шаге.
      const ok =
        b.slots.length === bunkSize(b) &&
        b.slots.every((s) => !s || (s.n > 0 && s.n <= stackMax(s.thing))) &&
        p.books.length <= SHELF_MAX &&
        p.runes.length <= RUNE_BAG &&
        new Set(p.runes.map((x) => x.id)).size === p.runes.length;
      if (!ok) expect.fail(`инвариант нарушен на шаге ${k}`);
    }
    expect(totals(p, d, b)).toEqual(start);
    // Гнёзда оберега держат те же руны.
    expect(p.sockets.slice(0, 2)).toEqual([4, 9]);
    expect(p.runes.some((r) => r.id === 4) && p.runes.some((r) => r.id === 9)).toBe(true);
  });
});

describe('двойной сундук', () => {
  it('одна покупка, вещи остаются на местах, второй раз не продаётся', () => {
    const b: BunkState = {
      big: false,
      slots: BUNK_START.slots.map((_, i) =>
        i === 26 ? { thing: { t: 'egg', egg: 'moss' }, n: 1 } : null,
      ),
    };
    expect(bunkBuyBig(b, BUNK_BIG_PRICE - 1)).toBeNull();
    const r = bunkBuyBig(b, BUNK_BIG_PRICE)!;
    expect(r.cost).toBe(BUNK_BIG_PRICE);
    expect(r.b.slots.length).toBe(BUNK_BIG_SLOTS);
    expect(r.b.slots[26]).toEqual(b.slots[26]);
    expect(bunkRoom(r.b, { t: 'egg', egg: 'moss' })).toBe(BUNK_BIG_SLOTS - 1);
    expect(bunkBuyBig(r.b, 1e9)).toBeNull();
  });

  it('цена — одно число в масштабе экономики, без миллионов', () => {
    expect(BUNK_BIG_PRICE).toBeGreaterThanOrEqual(10_000);
    expect(BUNK_BIG_PRICE).toBeLessThan(1_000_000);
  });
});

describe('сундук из сохранения', () => {
  it('мусор — пустой сундук', () => {
    for (const raw of [null, undefined, 5, 'x', [], { slots: 'no' }]) {
      const b = normalizeBunk(raw);
      expect(b.big).toBe(false);
      expect(b.slots.length).toBe(BUNK_SLOTS);
      expect(bunkUsed(b)).toBe(0);
    }
  });

  it('непонятные вещи выбрасываются, лишнее в стопке урезается', () => {
    const b = normalizeBunk({
      big: false,
      matsVer: BUNK_MATS_VER,
      slots: [
        { thing: { t: 'mat', id: 'ore:2' }, n: 500 },
        { thing: { t: 'item', id: 'nuke' }, n: 3 },
        { thing: { t: 'egg', egg: 'unicorn' }, n: 1 },
        { thing: { t: 'egg', egg: 'moss' }, n: 4 },
        { thing: { t: 'book', book: { id: 'power', lvl: 99, chance: 3 } }, n: 1 },
        { thing: { t: 'book', book: { id: 'nope', lvl: 1, chance: 50 } }, n: 1 },
        { thing: { t: 'rune', rune: { id: -3, kind: 'sell', tier: 9, roll: 500 } }, n: 1 },
        { thing: { t: 'mat', id: 'skin' }, n: 0 },
        { thing: { t: 'mat', id: 'gone_mat' }, n: 3 },
        null,
        'garbage',
      ],
    });
    expect(b.slots[0]).toEqual({ thing: { t: 'mat', id: 'ore:2' }, n: 64 });
    expect(b.slots[1]).toBeNull();
    expect(b.slots[2]).toBeNull();
    expect(b.slots[3]).toEqual({ thing: { t: 'egg', egg: 'moss' }, n: 1 });
    expect(b.slots[4]).toEqual({
      thing: { t: 'book', book: { id: 'power', lvl: 10, chance: 5 } },
      n: 1,
    });
    expect(b.slots[5]).toBeNull();
    expect(b.slots[6]).toEqual({
      thing: { t: 'rune', rune: { id: 0, kind: 'sell', tier: 5, roll: 100 } },
      n: 1,
    });
    expect(b.slots[7]).toBeNull();
    expect(b.slots[8]).toBeNull();
    expect(b.slots.length).toBe(BUNK_SLOTS);
  });

  it('сундук до сброса подземелья теряет его материалы, остальное на месте', () => {
    const raw = {
      big: false,
      slots: [
        { thing: { t: 'mat', id: 'skin' }, n: 5 },
        { thing: { t: 'mat', id: 'block:9' }, n: 2 },
        { thing: { t: 'egg', egg: 'moss' }, n: 1 },
        { thing: { t: 'item', id: 'lens' }, n: 4 },
      ],
    };
    for (const matsVer of [undefined, 1]) {
      const b = normalizeBunk({ ...raw, matsVer });
      expect(b.slots.slice(0, 4)).toEqual([
        null,
        null,
        { thing: { t: 'egg', egg: 'moss' }, n: 1 },
        { thing: { t: 'item', id: 'lens' }, n: 4 },
      ]);
      expect(b.matsVer).toBe(BUNK_MATS_VER);
    }
    const now = normalizeBunk({ ...raw, matsVer: BUNK_MATS_VER });
    expect(now.slots[0]).toEqual({ thing: { t: 'mat', id: 'skin' }, n: 5 });
    expect(now.slots[1]).toEqual({ thing: { t: 'mat', id: 'block:9' }, n: 2 });
  });

  it('вещи за краем малого сундука переезжают в пустые ячейки', () => {
    const slots: unknown[] = Array.from({ length: 40 }, () => null);
    slots[1] = { thing: { t: 'egg', egg: 'moss' }, n: 1 };
    slots[35] = { thing: { t: 'egg', egg: 'dragon' }, n: 1 };
    const b = normalizeBunk({ big: false, slots });
    expect(b.slots.length).toBe(BUNK_SLOTS);
    expect(b.slots[0]).toEqual({ thing: { t: 'egg', egg: 'dragon' }, n: 1 });
    expect(b.slots[1]).toEqual({ thing: { t: 'egg', egg: 'moss' }, n: 1 });
  });

  it('повторное чтение ничего не меняет', () => {
    const once = normalizeBunk({
      big: true,
      matsVer: BUNK_MATS_VER,
      slots: [
        { thing: { t: 'mat', id: 'block:9' }, n: 16 },
        null,
        { thing: { t: 'item', id: 'lens' }, n: 9 },
      ],
    });
    expect(once.slots.length).toBe(BUNK_BIG_SLOTS);
    expect(normalizeBunk(JSON.parse(JSON.stringify(once)))).toEqual(once);
  });
});
