// Инвентарь и личный сундук (v2.81, первый вариант).
//
// Владелец: «хочу, чтобы всё было в инвентаре, всё складывалось в
// инвентаре: руды, яйца, ключи, в общем все расходники… прикол инвентаря,
// который я хочу, — это ограниченность места. Яиц можно хоть весь
// инвентарь, но эти яйца просто остаются в питомнике».
//
// Первый вариант — ОДИН экран со всем, что у игрока есть, по разделам и с
// ПРЕЖНИМИ лимитами: рюкзак шахты (по уровню), корзина яиц 12, полка книг
// 30, мешочек рун 40, склад подземелья без края. Вещи лежат там же, где
// лежали; модуль — переходник поверх нынешних полей, он ничего не меняет в
// правилах (тест темпа `prison.test.ts` его не видит). Второй вариант (на
// потом) — общие ячейки, как в Майнкрафте, где всё делит одно место.
//
// Личный сундук — у койки в Бараке 1. Ячейки со стопками, как сундук
// Майнкрафта: 27, двойной — 54. Туда откладывают лишнее и забирают назад,
// только если в родном хранилище есть место: вещь всегда возвращается
// ТУДА, откуда пришла (яйцо — в корзину, книга — на полку, материал — на
// склад). Перенос без потерь и без размножения — это держит тест.
//
// Руда РЮКЗАКА ШАХТЫ в сундук не кладётся — нарочно. Рюкзак — единственное,
// что держит, сколько руды можно продать разом; сундук на 54 ячейки по 64
// превратил бы «Получку» (продажа ×2 на пять минут) в копилку на три с
// половиной тысячи блоков — это сдвиг экономики, а не хранение. Руда и
// цельные блоки из шахт подземелья (склад) не продаются — им в сундук можно.
//
// Модуль чистый: стор передаёт состояние, получает новое.

import {
  isMeat,
  itemRock,
  matDef,
  MEAT_NAMES,
  sackSlots,
  sackStacks,
  slotsUsed,
  stackOf as deepStack,
} from './dungeon';
import type { DungeonState, MatId } from './dungeon';
import { normalizeBook, ROMAN, SHELF_MAX, tierOfLevel } from './books';
import type { Book } from './books';
import { EGG_BASKET, EGG_IDS, eggCount, eggOf, isEggId, NEST_SLOTS } from './pets';
import type { EggId } from './pets';
import {
  bagCapacity,
  bagCount,
  CASE_TIERS,
  enchantOf,
  ENCHANTS,
  FINDS,
  ITEMS,
  itemOf,
  PARCEL_NEED,
  ROCKS,
  RUNE_BAG,
  RUNE_ROMAN,
  RUNE_TIERS,
  runeOf,
  runePower,
  RUNES,
} from './prison';
import type { CaseTier, FindId, ItemId, PrisonState, Rune, RuneKind } from './prison';

// ---------------------------------------------------------------------------
// Сундук у койки.
// ---------------------------------------------------------------------------

/** Ключ сохранения сундука — своё, как у леса и рыбалки. */
export const BUNK_KEY = 'bunk.state';
/** Сундук — 27 ячеек (три ряда по девять), двойной — 54. */
export const BUNK_ROW = 9;
export const BUNK_SLOTS = 27;
export const BUNK_BIG_SLOTS = 54;
/**
 * Двойной сундук — одна покупка за монеты, одно число навсегда (правило
 * `lib/economy.ts`). 25 000 — это ранг J→K: к середине круга у игрока
 * копятся книги, руны и яйца сверх полки, мешочка и корзины, и тогда же
 * вторая половина сундука по карману. Раньше она не нужна, позже — не
 * заметна. Для масштаба: рюкзак шахты 8-го уровня стоит 17 000.
 */
export const BUNK_BIG_PRICE = 25_000;

/** Что лежит в ячейке сундука. Книга и руна — сами вещи, они не одинаковые. */
export type BunkThing =
  | { t: 'mat'; id: MatId }
  | { t: 'item'; id: ItemId }
  | { t: 'egg'; egg: EggId }
  | { t: 'book'; book: Book }
  | { t: 'rune'; rune: Rune };

export interface BunkStack {
  thing: BunkThing;
  n: number;
}

export interface BunkState {
  big: boolean;
  /** Ячейки по порядку; длина — размер сундука, пустая — null. */
  slots: (BunkStack | null)[];
}

export const bunkSize = (b: Pick<BunkState, 'big'>): number =>
  b.big ? BUNK_BIG_SLOTS : BUNK_SLOTS;

export const BUNK_START: BunkState = {
  big: false,
  slots: Array.from({ length: BUNK_SLOTS }, () => null),
};

/** Сколько расходников в одной ячейке — как эндер-жемчуг и снежки в Майнкрафте. */
export const ITEM_STACK = 16;

/**
 * Сколько штук вида в одной ячейке сундука. Материалы подземелья — как в
 * рюкзаке вылазки (`stackOf`: руда 64, цельный блок 16, трофей 1, прочее
 * 32). Расходник — 16. Яйцо, книга, руна — по одной: яйцо большое и
 * хрупкое, а книги и руны все разные (у каждой свой уровень и шанс, своя
 * сила), в стопку их не сложишь. И это та самая «ограниченность места».
 */
export function stackMax(t: BunkThing): number {
  switch (t.t) {
    case 'mat':
      return Math.max(1, deepStack(t.id));
    case 'item':
      return ITEM_STACK;
    default:
      return 1;
  }
}

/** Вид вещи для стопок: одинаковые складываются в одну ячейку. */
export function thingKey(t: BunkThing): string {
  switch (t.t) {
    case 'mat':
      return `mat:${t.id}`;
    case 'item':
      return `item:${t.id}`;
    case 'egg':
      return `egg:${t.egg}`;
    case 'book':
      return `book:${t.book.id}:${t.book.lvl}:${t.book.chance}`;
    case 'rune':
      return `rune:${t.rune.id}`;
  }
}

/** Ссылка на вещь в родном хранилище: что именно переложить в сундук. */
export type InvRef =
  | { t: 'mat'; id: MatId }
  | { t: 'item'; id: ItemId }
  | { t: 'egg'; egg: EggId }
  /** Книга на полке — по номеру. */
  | { t: 'book'; index: number }
  /** Руна в мешочке — по её id. */
  | { t: 'rune'; id: number };

type Homes = { p: PrisonState; d: Pick<DungeonState, 'stash'> };

/** Сколько такой вещи лежит дома и можно взять. Руну из оберега — нельзя. */
function homeHave(h: Homes, ref: InvRef): { thing: BunkThing; have: number } | null {
  const { p, d } = h;
  switch (ref.t) {
    case 'mat': {
      const have = Math.floor(d.stash[ref.id] ?? 0);
      return have > 0 ? { thing: { t: 'mat', id: ref.id }, have } : null;
    }
    case 'item': {
      const have = Math.floor(p.items[ref.id] ?? 0);
      return have > 0 ? { thing: { t: 'item', id: ref.id }, have } : null;
    }
    case 'egg': {
      const have = Math.floor(p.eggs[ref.egg] ?? 0);
      return have > 0 ? { thing: { t: 'egg', egg: ref.egg }, have } : null;
    }
    case 'book': {
      const b = p.books[ref.index];
      return b ? { thing: { t: 'book', book: { ...b } }, have: 1 } : null;
    }
    case 'rune': {
      if (p.sockets.includes(ref.id)) return null;
      const r = p.runes.find((x) => x.id === ref.id);
      return r ? { thing: { t: 'rune', rune: { ...r } }, have: 1 } : null;
    }
  }
}

/** Какая вещь ляжет в сундук по ссылке (null — нечего класть). */
export function thingOfRef(h: Homes, ref: InvRef): BunkThing | null {
  return homeHave(h, ref)?.thing ?? null;
}

/** Сколько такой вещи влезет обратно в родное хранилище. */
export function homeRoom(h: Homes, t: BunkThing): number {
  const { p } = h;
  switch (t.t) {
    case 'mat':
    case 'item':
      // Склад подземелья и запас расходников без края.
      return Number.POSITIVE_INFINITY;
    case 'egg':
      return Math.max(0, EGG_BASKET - eggCount(p.eggs));
    case 'book':
      return Math.max(0, SHELF_MAX - p.books.length);
    case 'rune':
      return Math.max(0, RUNE_BAG - p.runes.length);
  }
}

/** Сколько такой вещи ещё влезет в сундук: в неполные стопки и пустые ячейки. */
export function bunkRoom(b: BunkState, t: BunkThing): number {
  const key = thingKey(t);
  const max = stackMax(t);
  let room = 0;
  for (const s of b.slots) {
    if (!s) room += max;
    else if (thingKey(s.thing) === key) room += Math.max(0, max - s.n);
  }
  return room;
}

export const bunkUsed = (b: BunkState): number => b.slots.filter(Boolean).length;

/** Сколько штук вида лежит в сундуке (по всем ячейкам). */
export function bunkCount(b: BunkState, key: string): number {
  let n = 0;
  for (const s of b.slots) if (s && thingKey(s.thing) === key) n += s.n;
  return n;
}

export interface Moved {
  p: PrisonState;
  d: DungeonState;
  b: BunkState;
  /** Сколько переложено. */
  n: number;
}

/** Взять `n` из родного хранилища. Книга и руна — сама вещь, по одной. */
function takeHome(p: PrisonState, d: DungeonState, ref: InvRef, n: number) {
  switch (ref.t) {
    case 'mat': {
      const stash = { ...d.stash };
      const left = (stash[ref.id] ?? 0) - n;
      if (left > 0) stash[ref.id] = left;
      else delete stash[ref.id];
      return { p, d: { ...d, stash } };
    }
    case 'item':
      return { p: { ...p, items: { ...p.items, [ref.id]: p.items[ref.id] - n } }, d };
    case 'egg':
      return { p: { ...p, eggs: { ...p.eggs, [ref.egg]: p.eggs[ref.egg] - n } }, d };
    case 'book':
      return { p: { ...p, books: p.books.filter((_, i) => i !== ref.index) }, d };
    case 'rune':
      return { p: { ...p, runes: p.runes.filter((r) => r.id !== ref.id) }, d };
  }
}

/** Положить `n` вещи в родное хранилище (место уже проверено). */
function giveHome(p: PrisonState, d: DungeonState, t: BunkThing, n: number) {
  switch (t.t) {
    case 'mat':
      return { p, d: { ...d, stash: { ...d.stash, [t.id]: (d.stash[t.id] ?? 0) + n } } };
    case 'item':
      return { p: { ...p, items: { ...p.items, [t.id]: (p.items[t.id] ?? 0) + n } }, d };
    case 'egg':
      return { p: { ...p, eggs: { ...p.eggs, [t.egg]: (p.eggs[t.egg] ?? 0) + n } }, d };
    case 'book':
      return { p: { ...p, books: [...p.books, { ...t.book }] }, d };
    case 'rune': {
      // Номер руны живёт с ней. Занят (две копии сохранения, битый номер) —
      // руна получает новый, как свежая из посылки: гнёзда держат номера.
      let id = t.rune.id;
      let seq = p.runeSeq;
      if (!(id > 0) || p.runes.some((r) => r.id === id)) id = seq + 1;
      seq = Math.max(seq, id);
      return { p: { ...p, runeSeq: seq, runes: [...p.runes, { ...t.rune, id }] }, d };
    }
  }
}

/**
 * Отложить в сундук до `want` штук: сперва в неполные стопки того же вида,
 * потом в пустые ячейки по порядку. Кладётся сколько влезло; ничего — null.
 */
export function bunkPut(
  p: PrisonState,
  d: DungeonState,
  b: BunkState,
  ref: InvRef,
  want: number,
): Moved | null {
  const src = homeHave({ p, d }, ref);
  if (!src) return null;
  const n = Math.min(Math.floor(want), src.have, bunkRoom(b, src.thing));
  if (!(n > 0)) return null;
  const key = thingKey(src.thing);
  const max = stackMax(src.thing);
  const slots = b.slots.map((s) => (s ? { thing: s.thing, n: s.n } : null));
  let left = n;
  for (const s of slots) {
    if (left <= 0) break;
    if (!s || thingKey(s.thing) !== key || s.n >= max) continue;
    const k = Math.min(left, max - s.n);
    s.n += k;
    left -= k;
  }
  for (let i = 0; i < slots.length && left > 0; i++) {
    if (slots[i]) continue;
    const k = Math.min(left, max);
    slots[i] = { thing: src.thing, n: k };
    left -= k;
  }
  const home = takeHome(p, d, ref, n);
  return { p: home.p, d: home.d, b: { ...b, slots }, n };
}

/**
 * Забрать из ячейки `slot` до `want` штук — только туда, откуда вещь
 * пришла, и только сколько там есть места. Ничего не влезло — null.
 */
export function bunkTake(
  p: PrisonState,
  d: DungeonState,
  b: BunkState,
  slot: number,
  want: number,
): Moved | null {
  const s = b.slots[slot];
  if (!s) return null;
  const n = Math.min(Math.floor(want), s.n, homeRoom({ p, d }, s.thing));
  if (!(n > 0)) return null;
  const slots = b.slots.slice();
  slots[slot] = s.n - n > 0 ? { thing: s.thing, n: s.n - n } : null;
  const home = giveHome(p, d, s.thing, n);
  return { p: home.p, d: home.d, b: { ...b, slots }, n };
}

/** Двойной сундук: ещё 27 ячеек, вещи остаются на местах. */
export function bunkBuyBig(b: BunkState, coins: number): { b: BunkState; cost: number } | null {
  if (b.big || coins < BUNK_BIG_PRICE) return null;
  const slots = b.slots.slice(0, BUNK_SLOTS);
  while (slots.length < BUNK_BIG_SLOTS) slots.push(null);
  return { b: { big: true, slots }, cost: BUNK_BIG_PRICE };
}

// ---------------------------------------------------------------------------
// Чтение сохранения: всё, что не похоже на вещь, выбрасывается.
// ---------------------------------------------------------------------------

const int = (v: unknown, lo: number, hi: number, d: number) => {
  const x = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : d;
  return Math.max(lo, Math.min(hi, x));
};

const ENCH_IDS = ENCHANTS.map((e) => e.id as string);
const ITEM_IDS = ITEMS.map((i) => i.id as string);

function normThing(v: unknown): BunkThing | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  switch (o.t) {
    case 'mat':
      return typeof o.id === 'string' && o.id.length > 0 && o.id.length < 64
        ? { t: 'mat', id: o.id }
        : null;
    case 'item':
      return typeof o.id === 'string' && ITEM_IDS.includes(o.id)
        ? { t: 'item', id: o.id as ItemId }
        : null;
    case 'egg':
      return isEggId(o.egg) ? { t: 'egg', egg: o.egg } : null;
    case 'book': {
      const book = normalizeBook(o.book, ENCH_IDS);
      return book ? { t: 'book', book } : null;
    }
    case 'rune': {
      const r = (o.rune ?? null) as Partial<Rune> | null;
      if (!r || !RUNES.some((x) => x.id === r.kind)) return null;
      return {
        t: 'rune',
        rune: {
          id: int(r.id, 0, 1e9, 0),
          kind: r.kind as RuneKind,
          tier: int(r.tier, 1, RUNE_TIERS, 1),
          roll: int(r.roll, 0, 100, 0),
        },
      };
    }
    default:
      return null;
  }
}

/**
 * Сундук из сохранения. Длина — строго размер сундука; вещи из ячеек за его
 * краем (битое сохранение) переезжают в пустые ячейки, лишние стопки больше
 * положенного урезаются до стопки.
 */
export function normalizeBunk(raw: unknown): BunkState {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<BunkState>;
  const big = o.big === true;
  const size = bunkSize({ big });
  const list = Array.isArray(o.slots) ? o.slots.slice(0, BUNK_BIG_SLOTS * 2) : [];
  const slots: (BunkStack | null)[] = Array.from({ length: size }, () => null);
  const extra: BunkStack[] = [];
  list.forEach((v, i) => {
    const s = (v ?? null) as Partial<BunkStack> | null;
    const thing = s ? normThing(s.thing) : null;
    if (!thing) return;
    const n = int(s!.n, 0, stackMax(thing), 0);
    if (n <= 0) return;
    if (i < size) slots[i] = { thing, n };
    else extra.push({ thing, n });
  });
  for (const s of extra) {
    const at = slots.indexOf(null);
    if (at < 0) break;
    slots[at] = s;
  }
  return { big, slots };
}

// ---------------------------------------------------------------------------
// Единый список вещей по разделам.
// ---------------------------------------------------------------------------

export type InvSection =
  | 'ore'
  | 'deep'
  | 'sack'
  | 'items'
  | 'keys'
  | 'eggs'
  | 'books'
  | 'runes'
  | 'finds'
  | 'bunk';

/** Как нарисовать вещь — страница выбирает картинку по роду. */
export type InvIcon =
  | { k: 'ore'; rock: number }
  | { k: 'block'; rock: number }
  | { k: 'mat'; id: MatId }
  | { k: 'item'; id: ItemId }
  | { k: 'key' }
  | { k: 'dust' }
  | { k: 'pearl' }
  | { k: 'coin' }
  | { k: 'token' }
  | { k: 'parcel'; tier: CaseTier }
  | { k: 'egg'; egg: EggId }
  | { k: 'book'; book: Book }
  | { k: 'rune'; kind: RuneKind; tier: number }
  | { k: 'find'; id: FindId; ghost: boolean };

/** Где вещь лежит — подпись под ней в карточке. */
export type InvWhere =
  | 'bag'
  | 'box'
  | 'stash'
  | 'sack'
  | 'items'
  | 'purse'
  | 'nest'
  | 'basket'
  | 'shelf'
  | 'pouch'
  | 'socket'
  | 'parcels'
  | 'finds'
  | 'bunk';

export const WHERE_NAME: Record<InvWhere, string> = {
  bag: 'Рюкзак шахты',
  box: 'Ящик кузнеца',
  stash: 'Склад подземелья',
  sack: 'Рюкзак вылазки — внизу, пропадёт при смерти',
  items: 'Запас расходников',
  purse: 'Кошелёк',
  nest: 'Гнездо в Питомнике',
  basket: 'Корзина яиц',
  shelf: 'Полка книг',
  pouch: 'Мешочек рун',
  socket: 'Оберег',
  parcels: 'Посылки под полем шахты',
  finds: 'Коллекция',
  bunk: 'Сундук у койки',
};

/**
 * Действия с вещью. Модуль говорит, что позволяют ПРАВИЛА; где кнопка
 * видна, решает место (`actsOf`): у сундука — перекладывать, в шахте —
 * пить энергетик и бросать бомбу.
 */
export type InvAct =
  /** Выпить/включить сразу: энергетик, лупа, крепь (в шахте). */
  | 'use'
  /** Бросить на поле: бомба, динамит, заряд (в шахте). */
  | 'throw'
  /** Яйцо из корзины — в свободное гнездо. */
  | 'nest'
  /** В сундук у койки. */
  | 'toBunk'
  /** Из сундука назад, туда, откуда пришло. */
  | 'fromBunk';

export interface InvItem {
  /** Уникален в списке. */
  key: string;
  /** Вид вещи: одинаковые в сундуке складываются (`thingKey`). */
  kind: string;
  name: string;
  /** Короткая строка под именем: уровень, сила, шанс. */
  sub?: string;
  icon: InvIcon;
  n: number;
  /** Сколько в одной ячейке сундука (0 — в сундук не кладётся). */
  stack: number;
  section: InvSection;
  where: InvWhere;
  /** Цена штуки монетами, если игра её знает (руда — продажа). */
  price?: number;
  /** Что переложить в сундук; нет — не перекладывается. */
  ref?: InvRef;
  /** Ячейка сундука — для вещей раздела «Сундук». */
  slot?: number;
  /** Доля готовности: яйцо в гнезде, посылка под полем. */
  progress?: number;
  acts: InvAct[];
}

export interface InvLimit {
  used: number;
  max: number;
  label: string;
}

export interface InvSectionView {
  id: InvSection;
  name: string;
  /** Иконка раздела — имя из game-icons (`GxIconName`). */
  icon: string;
  items: InvItem[];
  /** Лимиты хранилищ раздела — полоской. */
  limits: InvLimit[];
}

export const SECTIONS: { id: InvSection; name: string; icon: string }[] = [
  { id: 'ore', name: 'Руда', icon: 'ore' },
  { id: 'deep', name: 'Подземелье', icon: 'cave' },
  { id: 'sack', name: 'Вылазка', icon: 'skull' },
  { id: 'items', name: 'Расходники', icon: 'bomb' },
  { id: 'keys', name: 'Ключи', icon: 'key' },
  { id: 'eggs', name: 'Яйца', icon: 'egg' },
  { id: 'books', name: 'Книги', icon: 'book' },
  { id: 'runes', name: 'Руны', icon: 'rune' },
  { id: 'finds', name: 'Находки', icon: 'medal' },
  { id: 'bunk', name: 'Сундук', icon: 'chest' },
];

const pct = (x: number) =>
  `+${(Math.round(x * 1000) / 10).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`;

/** Вещь раздела «Сундук» или «Склад» в общем виде: имя, картинка, подпись. */
export function thingView(t: BunkThing): Pick<InvItem, 'name' | 'sub' | 'icon'> & {
  section: InvSection;
  price?: number;
} {
  switch (t.t) {
    case 'mat': {
      const m = matDef(t.id);
      const r = itemRock(t.id);
      return {
        name: m.name,
        icon: r ? { k: r.kind, rock: r.rock } : { k: 'mat', id: t.id },
        section: 'deep',
        sub: r ? (r.kind === 'block' ? 'цельный блок' : 'руда подземелья') : undefined,
      };
    }
    case 'item':
      return { name: itemOf(t.id).name, icon: { k: 'item', id: t.id }, section: 'items' };
    case 'egg':
      return { name: eggOf(t.egg).name, icon: { k: 'egg', egg: t.egg }, section: 'eggs' };
    case 'book':
      return {
        name: `${enchantOf(t.book.id).name} ${ROMAN[t.book.lvl - 1] ?? t.book.lvl}`,
        sub: `шанс ${t.book.chance}% · ${bookTierName(t.book.lvl)}`,
        icon: { k: 'book', book: t.book },
        section: 'books',
      };
    case 'rune': {
      const def = runeOf(t.rune.kind);
      return {
        name: `${def.name} ${RUNE_ROMAN[t.rune.tier - 1] ?? t.rune.tier}`,
        sub: `${pct(runePower(t.rune))} ${def.text}`,
        icon: { k: 'rune', kind: t.rune.kind, tier: t.rune.tier },
        section: 'runes',
      };
    }
  }
}

const BOOK_TIER_NAME = {
  simple: 'простая',
  rare: 'редкая',
  epic: 'эпическая',
  legend: 'легендарная',
} as const;
const bookTierName = (lvl: number) => BOOK_TIER_NAME[tierOfLevel(lvl)];

/** Что можно сделать с вещью здесь и сейчас. */
export type InvPlace = 'yard' | 'mine' | 'bunk' | 'view';

export function actsOf(item: InvItem, place: InvPlace): InvAct[] {
  if (place === 'view') return [];
  return item.acts.filter((a) => {
    if (a === 'toBunk' || a === 'fromBunk') return place === 'bunk';
    if (a === 'use' || a === 'throw') return place === 'mine';
    return true;
  });
}

const USE_NOW: ItemId[] = ['energy', 'lens', 'prop'];
const THROW: ItemId[] = ['bomb3', 'bomb5', 'charge'];

/**
 * Всё, что у игрока есть, по разделам. Пустые разделы тоже есть — у них
 * видны лимиты (пустая корзина — тоже знание). Находки — вся коллекция,
 * ненайденные силуэтом: их ищут.
 */
export function inventoryOf(
  p: PrisonState,
  d: Pick<DungeonState, 'stash'> & Partial<Pick<DungeonState, 'run' | 'sackLevel'>>,
  b: BunkState = BUNK_START,
): InvSectionView[] {
  const out: Record<InvSection, InvSectionView> = Object.fromEntries(
    SECTIONS.map((s) => [s.id, { ...s, items: [], limits: [] }]),
  ) as unknown as Record<InvSection, InvSectionView>;
  const add = (it: Omit<InvItem, 'acts'> & { acts?: InvAct[] }) =>
    out[it.section].items.push({ ...it, acts: it.acts ?? [] });

  // Руда: рюкзак шахты (какая именно лежит — раньше нигде не было видно) и
  // ящик кузнеца. Ни то ни другое в сундук не идёт (см. шапку модуля).
  const cap = bagCapacity(p.bagLevel);
  for (const [k, n] of Object.entries(p.bag).sort((a, b) => Number(b[0]) - Number(a[0]))) {
    const rock = Number(k);
    if (!(n > 0) || !ROCKS[rock]) continue;
    add({
      key: `bag:${rock}`,
      kind: `ore:${rock}`,
      name: ROCKS[rock].name,
      icon: { k: 'ore', rock },
      n,
      stack: 0,
      section: 'ore',
      where: 'bag',
      price: ROCKS[rock].value,
    });
  }
  for (const [k, n] of Object.entries(p.forgeBox).sort((a, b) => Number(b[0]) - Number(a[0]))) {
    const rock = Number(k);
    if (!(n > 0) || !ROCKS[rock]) continue;
    add({
      key: `box:${rock}`,
      kind: `ore:${rock}`,
      name: ROCKS[rock].name,
      sub: 'для кирки',
      icon: { k: 'ore', rock },
      n,
      stack: 0,
      section: 'ore',
      where: 'box',
    });
  }
  out.ore.limits.push({ used: bagCount(p.bag), max: cap, label: 'Рюкзак' });

  // Склад подземелья: материалы, руда и цельные блоки из шахт этажей.
  const stashIds = Object.keys(d.stash)
    .filter((id) => (d.stash[id] ?? 0) > 0)
    .sort((a, b) => stashRank(a) - stashRank(b) || a.localeCompare(b));
  for (const id of stashIds) {
    const t: BunkThing = { t: 'mat', id };
    const v = thingView(t);
    add({
      key: `stash:${id}`,
      kind: thingKey(t),
      name: v.name,
      sub: v.sub,
      icon: v.icon,
      n: Math.floor(d.stash[id] ?? 0),
      stack: stackMax(t),
      section: 'deep',
      where: 'stash',
      price: matDef(id).price || undefined,
      ref: { t: 'mat', id },
      acts: ['toBunk'],
    });
  }

  // Рюкзак вылазки, которая ждёт внизу: его ещё не вынесли — только
  // посмотреть, и видно, что смерть его заберёт (`WHERE_NAME.sack`).
  const run = d.run;
  if (run) {
    const sack = run.sack;
    const seen = new Set<string>();
    for (const s of sackStacks(sack)) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      const meat = isMeat(s.id);
      const n = Math.floor((meat ? sack.meat[s.id] : sack.mats[s.id]) ?? 0);
      const r = meat ? null : itemRock(s.id);
      add({
        key: `sack:${s.id}`,
        kind: `sack:${s.id}`,
        name: meat ? (MEAT_NAMES[s.id] ?? s.id) : matDef(s.id).name,
        icon: r ? { k: r.kind, rock: r.rock } : { k: 'mat', id: s.id },
        n,
        stack: 0,
        section: 'sack',
        where: 'sack',
      });
    }
    const purse: [string, string, number, InvIcon][] = [
      ['coins', 'Монеты', sack.coins, { k: 'coin' }],
      ['tokens', 'Токены', sack.tokens, { k: 'token' }],
      ['keys', 'Ключ от сундука', sack.keys, { k: 'key' }],
    ];
    for (const [id, name, n, icon] of purse)
      if (n > 0)
        add({
          key: `sack:${id}`,
          kind: `sack:${id}`,
          name,
          icon,
          n,
          stack: 0,
          section: 'sack',
          where: 'sack',
        });
    out.sack.limits.push({
      used: slotsUsed(sack),
      max: sackSlots(d.sackLevel ?? 0),
      label: 'Ячейки',
    });
  }

  // Расходники.
  for (const it of ITEMS) {
    const n = Math.floor(p.items[it.id] ?? 0);
    if (n <= 0) continue;
    const t: BunkThing = { t: 'item', id: it.id };
    add({
      key: `item:${it.id}`,
      kind: thingKey(t),
      name: it.name,
      sub: it.text,
      icon: { k: 'item', id: it.id },
      n,
      stack: ITEM_STACK,
      section: 'items',
      where: 'items',
      ref: { t: 'item', id: it.id },
      acts: [
        ...(USE_NOW.includes(it.id) ? (['use'] as InvAct[]) : []),
        ...(THROW.includes(it.id) ? (['throw'] as InvAct[]) : []),
        'toBunk',
      ],
    });
  }

  // Ключи, пыль, жемчуг, посылки: кошелёк на поясе, места не занимают.
  if (p.keys > 0)
    add({
      key: 'keys',
      kind: 'keys',
      name: 'Ключ от сундука',
      icon: { k: 'key' },
      n: p.keys,
      stack: 0,
      section: 'keys',
      where: 'purse',
    });
  if (p.dust > 0)
    add({
      key: 'dust',
      kind: 'dust',
      name: 'Пыль чар',
      sub: '+1% к шансу книги',
      icon: { k: 'dust' },
      n: p.dust,
      stack: 0,
      section: 'keys',
      where: 'purse',
    });
  if ((p.pearls ?? 0) > 0)
    add({
      key: 'pearls',
      kind: 'pearls',
      name: 'Жемчуг',
      sub: '+0,5% к продаже',
      icon: { k: 'pearl' },
      n: p.pearls,
      stack: 0,
      section: 'keys',
      where: 'purse',
    });
  p.parcels.forEach((x, i) => {
    const tier = CASE_TIERS.find((c) => c.id === x.tier)!;
    const need = PARCEL_NEED[x.tier];
    add({
      key: `parcel:${i}`,
      kind: `parcel:${x.tier}`,
      name: `Посылка · ${tier.name.toLowerCase()}`,
      sub: x.left > 0 ? `ещё ${x.left} блоков` : 'готова',
      icon: { k: 'parcel', tier: x.tier },
      n: 1,
      stack: 0,
      section: 'keys',
      where: 'parcels',
      progress: need > 0 ? 1 - x.left / need : 1,
    });
  });

  // Яйца: гнёзда остаются в Питомнике — видны, но не перекладываются.
  p.nest.forEach((x, i) => {
    const need = eggOf(x.egg).need;
    add({
      key: `nest:${i}`,
      kind: `egg:${x.egg}`,
      name: eggOf(x.egg).name,
      sub: x.left > 0 ? `греется · ещё ${x.left} блоков` : 'готово вылупиться',
      icon: { k: 'egg', egg: x.egg },
      n: 1,
      stack: 0,
      section: 'eggs',
      where: 'nest',
      progress: need > 0 ? 1 - x.left / need : 1,
    });
  });
  const nestFree = p.nest.length < NEST_SLOTS;
  for (const egg of [...EGG_IDS].reverse()) {
    const n = Math.floor(p.eggs[egg] ?? 0);
    if (n <= 0) continue;
    add({
      key: `basket:${egg}`,
      kind: `egg:${egg}`,
      name: eggOf(egg).name,
      icon: { k: 'egg', egg },
      n,
      stack: 1,
      section: 'eggs',
      where: 'basket',
      ref: { t: 'egg', egg },
      acts: [...(nestFree ? (['nest'] as InvAct[]) : []), 'toBunk'],
    });
  }
  out.eggs.limits.push({ used: eggCount(p.eggs), max: EGG_BASKET, label: 'Корзина' });
  out.eggs.limits.push({ used: p.nest.length, max: NEST_SLOTS, label: 'Гнёзда' });

  // Книги: полка, старшие первыми (номер — место на полке).
  p.books
    .map((book, index) => ({ book, index }))
    .sort((a, b) => b.book.lvl - a.book.lvl || b.book.chance - a.book.chance || a.index - b.index)
    .forEach(({ book, index }) => {
      const t: BunkThing = { t: 'book', book };
      const v = thingView(t);
      add({
        key: `book:${index}`,
        kind: thingKey(t),
        name: v.name,
        sub: v.sub,
        icon: v.icon,
        n: 1,
        stack: 1,
        section: 'books',
        where: 'shelf',
        ref: { t: 'book', index },
        acts: ['toBunk'],
      });
    });
  out.books.limits.push({ used: p.books.length, max: SHELF_MAX, label: 'Полка' });

  // Руны: из оберега — первыми и только посмотреть (сперва вынуть из гнезда).
  const socketed = (r: Rune) => (p.sockets.includes(r.id) ? 1 : 0);
  [...p.runes]
    .sort((a, b) => socketed(b) - socketed(a) || b.tier - a.tier || b.roll - a.roll || a.id - b.id)
    .forEach((rune) => {
      const t: BunkThing = { t: 'rune', rune };
      const v = thingView(t);
      const inSocket = p.sockets.includes(rune.id);
      add({
        key: `rune:${rune.id}`,
        kind: thingKey(t),
        name: v.name,
        sub: v.sub,
        icon: v.icon,
        n: 1,
        stack: inSocket ? 0 : 1,
        section: 'runes',
        where: inSocket ? 'socket' : 'pouch',
        ref: inSocket ? undefined : { t: 'rune', id: rune.id },
        acts: inSocket ? [] : ['toBunk'],
      });
    });
  out.runes.limits.push({ used: p.runes.length, max: RUNE_BAG, label: 'Мешочек' });

  // Находки: вся коллекция, ненайденные — силуэтом.
  for (const f of FINDS) {
    const n = Math.floor(p.finds[f.id] ?? 0);
    add({
      key: `find:${f.id}`,
      kind: `find:${f.id}`,
      name: n > 0 ? f.name : '???',
      sub: n > 0 ? f.text : `попадается с этажа ${String.fromCharCode(65 + f.from)}`,
      icon: { k: 'find', id: f.id, ghost: n <= 0 },
      n,
      stack: 0,
      section: 'finds',
      where: 'finds',
    });
  }
  out.finds.limits.push({
    used: FINDS.filter((f) => (p.finds[f.id] ?? 0) > 0).length,
    max: FINDS.length,
    label: 'Коллекция',
  });

  // Сундук у койки — ячейками, как лежит.
  b.slots.forEach((s, slot) => {
    if (!s) return;
    const v = thingView(s.thing);
    add({
      key: `bunk:${slot}`,
      kind: thingKey(s.thing),
      name: v.name,
      sub: v.sub,
      icon: v.icon,
      n: s.n,
      stack: stackMax(s.thing),
      section: 'bunk',
      where: 'bunk',
      slot,
      acts: ['fromBunk'],
    });
  });
  out.bunk.limits.push({ used: bunkUsed(b), max: bunkSize(b), label: 'Ячейки' });

  return SECTIONS.map((s) => out[s.id]);
}

/** Порядок склада: материалы этажей, руда, блоки, трофеи последними. */
function stashRank(id: MatId): number {
  const r = itemRock(id);
  if (r) return (r.kind === 'ore' ? 2 : 3) * 1000 + r.rock;
  return deepStack(id) === 1 ? 9000 : 1000;
}

/** Сколько вещей всего (для «!» и заголовков): ключи и пыль — числом. */
export function sectionCount(s: InvSectionView): number {
  if (s.id === 'finds') return s.items.filter((i) => i.n > 0).length;
  return s.items.reduce((a, i) => a + (i.stack === 0 && s.id !== 'eggs' ? 1 : i.n), 0);
}

/** Хранилище упёрлось в край: новая вещь разобьётся или рассыплется. */
export function limitFull(l: InvLimit): boolean {
  return l.max > 0 && l.used >= l.max;
}
