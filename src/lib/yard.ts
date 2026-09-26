// «Двор» каторги (v2.54): события и Барыга. Правила здесь, страницы только
// показывают. Состояние события живёт в `PrisonState.event` (тип — в
// `prison.ts`, чтобы модули не замыкались друг на друга).
//
// События приходят от РАБОТЫ, а не по часам: раз в 4–7 минут копания или
// рубки. По часам они случались бы, пока телефон в кармане, и игрок видел бы
// только «пропущено». Одно событие за раз, на той странице, где началось.

import {
  buildMine,
  DEPTH,
  hitDamage,
  LAST_RANK,
  MINE_CELLS,
  MINE_COLS,
  MINE_ROWS,
  modsOf,
  nice,
  PET_TREAT_XP,
  rankCost,
  rng32,
  rockAt,
  rollRune,
  ROCKS,
} from './prison';
import type { CaseTier, EventId, ItemId, PrisonState, Reward, YardEvent } from './prison';

export interface EventDef {
  id: EventId;
  name: string;
  /** Одна строка на объявлении. */
  lead: string;
  place: 'mine' | 'forest' | 'both';
  ms: number;
  weight: number;
  glyph: string;
  /** Цвет объявления. */
  color: string;
}

export const EVENTS: EventDef[] = [
  {
    id: 'meteor',
    name: 'Метеорит',
    lead: 'Упал в шахту. Разбей, пока не остыл, — внутри контрабанда',
    place: 'mine',
    ms: 90_000,
    weight: 3,
    glyph: '☄',
    color: '#ff8a3a',
  },
  {
    id: 'kuiva',
    name: 'Куйва',
    lead: 'Каменный великан вышел из скалы. Бей, пока не ушёл обратно',
    place: 'mine',
    ms: 60_000,
    weight: 2,
    glyph: '☗',
    color: '#9fb4c8',
  },
  {
    id: 'convoy',
    name: 'Конвой',
    lead: 'Конвою нужен груз породы. Успей, пока не уехал',
    place: 'mine',
    ms: 180_000,
    weight: 3,
    glyph: '⛟',
    color: '#c8a46a',
  },
  {
    id: 'gold',
    name: 'Золотая жила',
    lead: 'Каждый блок — втрое',
    place: 'mine',
    ms: 45_000,
    weight: 2,
    glyph: '✧',
    color: '#ffd35a',
  },
  {
    id: 'payday',
    name: 'Получка',
    lead: 'Скупщик платит вдвое: за породу, лес и доски',
    place: 'both',
    ms: 300_000,
    weight: 2,
    glyph: '₽',
    color: '#9be38a',
  },
  {
    id: 'magpie',
    name: 'Сорока-воровка',
    lead: 'Несёт краденое и роняет в шахту. Подбирай, пока лежит',
    place: 'mine',
    ms: 24_000,
    weight: 3,
    glyph: '✦',
    color: '#b7d4ff',
  },
  {
    id: 'blizzard',
    name: 'Буря',
    lead: 'Ветер валит лес: каждое поваленное дерево тянет соседнее',
    place: 'forest',
    ms: 45_000,
    weight: 3,
    glyph: '❄',
    color: '#bfe4ff',
  },
  {
    id: 'bear',
    name: 'Хозяин тайги',
    lead: 'Медведь идёт к штабелю. Руби без остановки — отгонишь',
    place: 'forest',
    ms: 30_000,
    weight: 3,
    glyph: '🐻',
    color: '#c88a52',
  },
];

export const eventOf = (id: EventId): EventDef => EVENTS.find((e) => e.id === id)!;

/** Пауза между событиями — от конца прошлого. Первое — через первую паузу. */
export const EVENT_GAP: [number, number] = [240_000, 420_000];
/** С какого ранга шахты во дворе начинается жизнь: сначала — освоиться. */
export const EVENTS_FROM_RANK = 1;

export const METEOR_HITS = 6;
/** Куйва держит столько ударов кирки игрока (крит — втрое). */
export const KUIVA_HITS = 45;
/** Медведь: брёвен, чтобы отогнать. */
export const BEAR_NEED = 15;
/** Медведь, которого не отогнали, уносит такую долю штабеля. */
export const BEAR_TAKES = 0.5;

export function eventGap(rnd: () => number): number {
  const [lo, hi] = EVENT_GAP;
  return lo + Math.floor(rnd() * (hi - lo));
}

/** Пора ли начинать событие. */
export function eventDue(p: PrisonState, now: number): boolean {
  if (p.rank < EVENTS_FROM_RANK && !p.prestige) return false;
  if (p.event && p.event.until > now) return false;
  return p.eventNext > 0 && now >= p.eventNext;
}

function pick(place: 'mine' | 'forest', rnd: () => number): EventDef {
  const pool = EVENTS.filter((e) => e.place === place || e.place === 'both');
  const sum = pool.reduce((a, e) => a + e.weight, 0);
  let x = rnd() * sum;
  for (const e of pool) {
    x -= e.weight;
    if (x < 0) return e;
  }
  return pool[pool.length - 1];
}

/**
 * Начать событие. Метеорит падает в клетку, где есть что ломать; Куйва
 * встаёт квадратом 3×3; конвой просит породу, которой в шахте хватает.
 */
export function spawnEvent(
  place: 'mine' | 'forest',
  p: PrisonState,
  now: number,
  rnd: () => number,
): YardEvent {
  const def = pick(place, rnd);
  const ev: YardEvent = {
    id: def.id,
    place,
    from: now,
    until: now + def.ms,
    cell: 0,
    hp: 0,
    rock: -1,
    need: 0,
    have: 0,
  };
  if (def.id === 'meteor') {
    const open = p.mine.dug.map((d, c) => (d < DEPTH ? c : -1)).filter((c) => c >= 0);
    ev.cell = open.length ? open[Math.floor(rnd() * open.length)] : Math.floor(MINE_CELLS / 2);
  } else if (def.id === 'kuiva') {
    const x = Math.floor(rnd() * (MINE_COLS - 2));
    const y = Math.floor(rnd() * (MINE_ROWS - 2));
    ev.cell = y * MINE_COLS + x;
    ev.hp = kuivaHp(p);
  } else if (def.id === 'convoy') {
    const c = convoyAsk(p);
    ev.rock = c.rock;
    ev.need = c.need;
  } else if (def.id === 'bear') {
    ev.need = BEAR_NEED;
  }
  return ev;
}

/** Здоровье Куйвы — от кирки игрока: великан одинаково крепок на любом ранге. */
export function kuivaHp(p: PrisonState): number {
  return KUIVA_HITS * hitDamage(p.pick) * modsOf(p).dmg;
}

/** Клетки, которые занимает Куйва. */
export function kuivaCells(corner: number): number[] {
  const x = corner % MINE_COLS;
  const y = Math.floor(corner / MINE_COLS);
  const out: number[] = [];
  for (let dy = 0; dy < 3; dy++)
    for (let dx = 0; dx < 3; dx++) out.push((y + dy) * MINE_COLS + x + dx);
  return out;
}

/**
 * Что просит конвой: самую дорогую породу, которой в шахте осталось хотя бы
 * двадцать блоков, — и половину того, что есть. Меньше 15 не просит.
 */
export function convoyAsk(p: PrisonState): { rock: number; need: number } {
  const rocks = buildMine(p.mine.id, p.mine.seed);
  const have = new Map<number, number>();
  for (let c = 0; c < MINE_CELLS; c++)
    for (let d = p.mine.dug[c]; d < DEPTH; d++) {
      const r = rockAt(rocks, c, d);
      if (r >= 0) have.set(r, (have.get(r) ?? 0) + 1);
    }
  const rich = [...have.entries()].filter(([, n]) => n >= 20).sort((a, b) => b[0] - a[0]);
  const [rock, n] = rich[0] ?? [...have.entries()].sort((a, b) => b[1] - a[1])[0] ?? [0, 40];
  return { rock, need: Math.max(15, Math.min(80, Math.round(n * 0.5))) };
}

// ---------------------------------------------------------------------------
// Награды событий — от цены ранга: весомы на любом этапе.
// ---------------------------------------------------------------------------

export interface YardPrize {
  id: EventId;
  coins: number;
  tokens: number;
  keys: number;
  /** Контрабанда метеорита. */
  item: { id: ItemId; n: number } | null;
  parcel: CaseTier | null;
}

const priceBase = (p: PrisonState) => rankCost(Math.min(p.rank, LAST_RANK - 1), p.prestige);

const CONTRABAND: { id: ItemId; n: number }[] = [
  { id: 'bomb3', n: 3 },
  { id: 'bomb5', n: 2 },
  { id: 'charge', n: 1 },
  { id: 'energy', n: 2 },
  { id: 'lens', n: 3 },
];

export function eventPrize(id: EventId, p: PrisonState, rnd: () => number): YardPrize {
  const base = priceBase(p);
  const r = p.rank + p.prestige;
  const out: YardPrize = { id, coins: 0, tokens: 0, keys: 0, item: null, parcel: null };
  if (id === 'meteor') {
    out.coins = nice(base * 0.12);
    out.tokens = 25 + 5 * r;
    out.keys = rnd() < 0.5 ? 1 : 0;
    out.item = CONTRABAND[Math.floor(rnd() * CONTRABAND.length)];
  } else if (id === 'kuiva') {
    out.coins = nice(base * 0.25);
    out.tokens = 60 + 10 * r;
    out.keys = 2;
    out.parcel = rnd() < 0.15 ? 'epic' : 'rare';
  } else if (id === 'convoy') {
    out.coins = nice(base * 0.15);
    out.tokens = 30 + 6 * r;
    out.keys = 1;
  } else if (id === 'bear') {
    // Мёд из дупла, у которого стоял медведь.
    out.tokens = 40 + 8 * r;
    out.keys = rnd() < 0.5 ? 1 : 0;
  }
  return out;
}

export function prizeText(x: YardPrize): string {
  const parts: string[] = [];
  if (x.coins) parts.push(`+${x.coins.toLocaleString('ru-RU')} монет`);
  if (x.tokens) parts.push(`+${x.tokens} ✦`);
  if (x.keys) parts.push(x.keys > 1 ? `+${x.keys} ключа` : '+ключ');
  if (x.parcel) parts.push('посылка');
  return parts.join(' · ');
}

// ---------------------------------------------------------------------------
// Торговец (Барыга) — чёрный рынок двора. Раз в шесть часов новый товар, у
// каждого лота свой запас; один лот «горячий» — со скидкой −40%, и старая
// цена видна зачёркнутой. Берёт МОНЕТЫ: главный сток общего кошелька и
// единственный обмен денег на токены. Цены постоянные (v2.66): лот стоит
// одинаково на любом ранге — так просил владелец.
// ---------------------------------------------------------------------------

export const BARYGA_MS = 6 * 3_600_000;
export const BARYGA_LOTS = 4;
export const BARYGA_HOT = 0.4;

export interface Lot {
  reward: Reward;
  price: number;
  /** Цена без скидки — у горячего лота она видна зачёркнутой. */
  was: number;
  stock: number;
  hot: boolean;
}

export const barygaWindow = (now: number): number => Math.floor(now / BARYGA_MS);

type LotMaker = (rnd: () => number) => Omit<Lot, 'hot' | 'was'>;

/** Постоянные цены лотов. */
export const LOT_PRICE = {
  tokens100: 12_000,
  key: 6_000,
  treat: 4_000,
  rune1: 8_000,
  rune2: 20_000,
} as const;
/** Контрабанда: пачка и её цена. */
const LOT_ITEMS: { id: ItemId; n: number; price: number }[] = [
  { id: 'bomb3', n: 3, price: 6_000 },
  { id: 'bomb5', n: 2, price: 9_000 },
  { id: 'charge', n: 1, price: 8_000 },
  { id: 'energy', n: 2, price: 5_000 },
  { id: 'lens', n: 3, price: 4_000 },
];

const LOT_POOL: LotMaker[] = [
  (rnd) => ({
    reward: { kind: 'tokens', amount: 100 },
    price: LOT_PRICE.tokens100,
    stock: 1 + Math.floor(rnd() * 2),
  }),
  (rnd) => ({
    reward: { kind: 'keys', amount: 1 },
    price: LOT_PRICE.key,
    stock: 1 + Math.floor(rnd() * 2),
  }),
  (rnd) => {
    const c = LOT_ITEMS[Math.floor(rnd() * LOT_ITEMS.length)];
    return { reward: { kind: 'item', id: c.id, amount: c.n }, price: c.price, stock: 2 };
  },
  () => ({
    reward: { kind: 'treat', amount: PET_TREAT_XP },
    price: LOT_PRICE.treat,
    stock: 2,
  }),
  (rnd) => {
    const tier = rnd() < 0.7 ? 1 : 2;
    return {
      reward: { kind: 'rune', rune: rollRune(tier, rnd) },
      price: tier === 1 ? LOT_PRICE.rune1 : LOT_PRICE.rune2,
      stock: 1,
    };
  },
];

/** Товар окна `window`. Одинаков при каждом открытии и у всех игроков. */
export function barygaLots(window: number, _p?: PrisonState): Lot[] {
  const rnd = rng32(window * 7 + 3);
  // Перемешать пул честно (Фишер — Йейтс), а не сортировкой со случайным
  // сравнением: та тянет лоты к своим местам.
  const order = LOT_POOL.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const hot = Math.floor(rnd() * BARYGA_LOTS);
  return order.slice(0, BARYGA_LOTS).map((k, i) => {
    const lot = LOT_POOL[k](rnd);
    return {
      ...lot,
      was: lot.price,
      hot: i === hot,
      price: i === hot ? nice(lot.price * (1 - BARYGA_HOT)) : lot.price,
    };
  });
}

/** Сколько взято каждого лота в текущем окне (новое окно — всё заново). */
export function barygaBought(p: PrisonState, window: number): number[] {
  return p.baryga.window === window ? p.baryga.bought : [];
}

export { ROCKS };
