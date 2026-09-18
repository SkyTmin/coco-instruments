// «Каскад» — вторая игра, собранная по образцу Gates of Olympus.
//
// Поле 6×5, выплата за восемь одинаковых символов ГДЕ УГОДНО (scatter pays),
// без линий. Сыгравшие символы исчезают, верхние падают на их места, поле
// считается заново — и так, пока выпадают выигрыши (tumble).
//
// Поверх этого работают четыре механики Олимпа:
//   • сферы-множители — падают случайно, складываются и умножают выплату;
//   • скаттер («Зевс» темы) — 4/5/6 штук платят и запускают фриспины;
//   • фриспины — общий множитель копится всю сессию и не сбрасывается;
//   • ставка Ante — +25% к ставке за удвоенный шанс скаттеров.
//
// Честность: всё случайное берётся одним взвешенным ГСЧ, множители сфер
// написаны на них самих, ничего не подкручивается. Отдача сведена к ~92%
// таблицей выплат — см. scatter.test.ts.

import type { SlotSymbolId } from '@/types';
import { roundWin } from './slots';

export const SCATTER_COLS = 6;
export const SCATTER_ROWS = 5;
/** Сколько одинаковых символов нужно, чтобы поле сыграло. */
export const CLUSTER_MIN = 8;

type Rng = () => number;

/** Клетка поля: обычный символ или скаттер (он не собирается в восьмёрки). */
export type ScatterCell = SlotSymbolId | 'scatter';
export type ScatterGrid = ScatterCell[][];

/**
 * Веса символов. Ровнее, чем у классических слотов: на 30 клетках
 * перекошенные веса давали бы вишню почти каждый спин.
 */
export const SCATTER_WEIGHTS: Record<SlotSymbolId, number> = {
  cherry: 20,
  lemon: 18,
  grape: 16,
  bell: 14,
  star: 12,
  diamond: 11,
  seven: 9,
};

/** Выплаты — множители ВСЕЙ ставки. Ступени: 8–9, 10–11, 12+. */
export interface ScatterPay {
  id: SlotSymbolId;
  tiers: [number, number, number];
}

export const SCATTER_PAYS: ScatterPay[] = [
  { id: 'cherry', tiers: [0.058, 0.145, 0.37] },
  { id: 'lemon', tiers: [0.077, 0.19, 0.49] },
  { id: 'grape', tiers: [0.135, 0.27, 0.68] },
  { id: 'bell', tiers: [0.19, 0.42, 1.1] },
  { id: 'star', tiers: [0.32, 0.74, 2.2] },
  { id: 'diamond', tiers: [0.55, 1.35, 4.2] },
  { id: 'seven', tiers: [1.1, 2.9, 9.7] },
];

const PAY_BY_ID = new Map(SCATTER_PAYS.map((p) => [p.id, p]));
const IDS = Object.keys(SCATTER_WEIGHTS) as SlotSymbolId[];
const TOTAL_WEIGHT = IDS.reduce((sum, id) => sum + SCATTER_WEIGHTS[id], 0);

// ---------------------------------------------------------------------------
// Скаттер и фриспины
// ---------------------------------------------------------------------------

/** Шанс, что клетка окажется скаттером (со ставкой Ante — вдвое выше). */
export const SCATTER_CHANCE = 0.026;
/**
 * Ante: ставка дороже на четверть за более частый бонус. Шанс клетки поднимаем
 * лишь в 1,095 раза: бонусу нужно ЧЕТЫРЕ скаттера, и хвост биномиального
 * распределения растёт примерно как четвёртая степень шанса. Удвоение шанса
 * дало бы бонус в девять раз чаще и отдачу выше 300%; такой коэффициент
 * подобран так, чтобы Ante был честным выбором стиля, а не бесплатным плюсом.
 */
export const ANTE_COST = 1.25;
export const ANTE_SCATTER_FACTOR = 1.095;
/** Сколько скаттеров нужно для бонуса. */
export const SCATTER_TRIGGER = 4;
/** Выплата за скаттеры (множители ставки) по их количеству: 4, 5, 6. */
export const SCATTER_PAYOUTS: Record<number, number> = { 4: 3, 5: 5, 6: 100 };
/** Сколько фриспинов даёт бонус и сколько добавляют 3+ скаттера внутри него. */
export const FREE_SPINS = 15;
export const FREE_SPINS_RETRIGGER = 5;
export const RETRIGGER_MIN = 3;
/** Покупка бонуса: сразу фриспины за сто ставок. */
export const BUY_BONUS_COST = 100;

// ---------------------------------------------------------------------------
// Сферы-множители
// ---------------------------------------------------------------------------

export interface Orb {
  col: number;
  row: number;
  value: number;
}

/** Номиналы сфер и их веса: мелкие часто, ×500 — событие на всю жизнь. */
const ORB_TABLE: [value: number, weight: number][] = [
  [2, 300],
  [3, 220],
  [4, 140],
  [5, 100],
  [6, 70],
  [8, 50],
  [10, 40],
  [12, 30],
  [15, 20],
  [20, 14],
  [25, 8],
  [50, 4],
  [100, 2],
  [250, 1],
  [500, 1],
];
const ORB_TOTAL = ORB_TABLE.reduce((s, [, w]) => s + w, 0);

/** Сколько сфер падает за одно звено: чаще всего ни одной. */
const ORB_COUNT: [count: number, weight: number][] = [
  [0, 820],
  [1, 130],
  [2, 40],
  [3, 10],
];
const ORB_COUNT_TOTAL = ORB_COUNT.reduce((s, [, w]) => s + w, 0);

function pickWeighted(table: [number, number][], total: number, rng: Rng): number {
  let roll = rng() * total;
  for (const [value, weight] of table) {
    roll -= weight;
    if (roll < 0) return value;
  }
  return table[table.length - 1][0];
}

export function orbValue(rng: Rng = Math.random): number {
  return pickWeighted(ORB_TABLE, ORB_TOTAL, rng);
}

/** Сферы на свободных клетках поля. Скаттеры они не перекрывают. */
export function spawnOrbs(grid: ScatterGrid, rng: Rng = Math.random): Orb[] {
  const count = pickWeighted(ORB_COUNT, ORB_COUNT_TOTAL, rng);
  if (!count) return [];
  const free: [number, number][] = [];
  grid.forEach((col, c) =>
    col.forEach((id, r) => {
      if (id !== 'scatter') free.push([c, r]);
    }),
  );
  const orbs: Orb[] = [];
  for (let i = 0; i < count && free.length; i++) {
    const idx = Math.floor(rng() * free.length);
    const [col, row] = free.splice(idx, 1)[0];
    orbs.push({ col, row, value: orbValue(rng) });
  }
  return orbs;
}

// ---------------------------------------------------------------------------
// Поле
// ---------------------------------------------------------------------------

/** Множитель ставки за `count` символов данного вида. */
export function payFor(id: SlotSymbolId, count: number): number {
  if (count < CLUSTER_MIN) return 0;
  const pay = PAY_BY_ID.get(id);
  if (!pay) return 0;
  const tier = count >= 12 ? 2 : count >= 10 ? 1 : 0;
  return pay.tiers[tier];
}

/** Страховка от бесконечной цепочки. */
export const SCATTER_MAX_CASCADES = 14;

export function scatterSymbol(rng: Rng = Math.random): SlotSymbolId {
  let roll = rng() * TOTAL_WEIGHT;
  for (const id of IDS) {
    roll -= SCATTER_WEIGHTS[id];
    if (roll < 0) return id;
  }
  return IDS[IDS.length - 1];
}

/** Одна клетка: обычно символ, иногда скаттер. */
function cell(rng: Rng, scatterChance: number): ScatterCell {
  return rng() < scatterChance ? 'scatter' : scatterSymbol(rng);
}

export function scatterGrid(rng: Rng = Math.random, scatterChance = 0): ScatterGrid {
  return Array.from({ length: SCATTER_COLS }, () =>
    Array.from({ length: SCATTER_ROWS }, () => cell(rng, scatterChance)),
  );
}

export function countScatters(grid: ScatterGrid): number {
  return grid.flat().filter((id) => id === 'scatter').length;
}

export interface ScatterWin {
  symbol: SlotSymbolId;
  count: number;
  /** Множитель ставки до применения множителя сфер. */
  pay: number;
  cells: [number, number][];
}

/** Что сыграло на поле прямо сейчас. Скаттеры в счёт не идут. */
export function findWins(grid: ScatterGrid): ScatterWin[] {
  const cells = new Map<ScatterCell, [number, number][]>();
  grid.forEach((col, c) =>
    col.forEach((id, r) => {
      const list = cells.get(id);
      if (list) list.push([c, r]);
      else cells.set(id, [[c, r]]);
    }),
  );
  const wins: ScatterWin[] = [];
  for (const [symbol, list] of cells) {
    if (symbol === 'scatter') continue;
    const pay = payFor(symbol, list.length);
    if (pay > 0) wins.push({ symbol, count: list.length, pay, cells: list });
  }
  return wins.sort((a, b) => b.pay - a.pay);
}

/**
 * Схлопывание: сыгравшие клетки исчезают, верхние падают, сверху новые.
 * Скаттеры остаются на месте — они не участвуют в каскаде.
 */
export function scatterCollapse(
  grid: ScatterGrid,
  wins: ScatterWin[],
  rng: Rng = Math.random,
  scatterChance = 0,
): ScatterGrid {
  const dead = new Set(wins.flatMap((w) => w.cells.map(([c, r]) => `${c}:${r}`)));
  return grid.map((column, col) => {
    const kept = column.filter((_, row) => !dead.has(`${col}:${row}`));
    const fresh = Array.from({ length: SCATTER_ROWS - kept.length }, () => cell(rng, scatterChance));
    return [...fresh, ...kept];
  });
}

// ---------------------------------------------------------------------------
// Спин
// ---------------------------------------------------------------------------

export interface ScatterStep {
  grid: ScatterGrid;
  wins: ScatterWin[];
  /** Сферы, лежащие на поле в этом звене. */
  orbs: Orb[];
  /** Сумма сфер, применённая к выплате (0 — сфер не было). */
  orbMult: number;
  /** Общий множитель фриспинов после этого звена (вне бонуса — 0). */
  totalMult: number;
  /** Выплата звена в монетах, уже с множителем и округлением. */
  payout: number;
  next: ScatterGrid;
}

export interface ScatterRound {
  /** Поле, на котором остановились барабаны. */
  grid: ScatterGrid;
  steps: ScatterStep[];
  /** Сколько скаттеров на стартовом поле. */
  scatters: number;
  /** Выплата за скаттеры в монетах. */
  scatterPay: number;
  /** Сколько фриспинов начислено этим спином. */
  freeSpins: number;
  /** Выигрыш звеньев + скаттеры. */
  total: number;
  combo: number;
  /** Общий множитель бонуса после спина (вне бонуса — 0). */
  totalMult: number;
  multiplier: number;
  kind: 'none' | 'small' | 'big' | 'mega';
}

export interface RoundOptions {
  rng?: Rng;
  /** Ставка Ante: скаттеры выпадают вдвое чаще. */
  ante?: boolean;
  /** Спин внутри бонуса: множитель копится и не сбрасывается. */
  free?: boolean;
  /** Накопленный множитель бонуса на входе. */
  totalMult?: number;
}

/** Полный спин: поле, скаттеры, каскады со сферами. */
export function resolveScatter(bet: number, opts: RoundOptions | Rng = {}): ScatterRound {
  const o: RoundOptions = typeof opts === 'function' ? { rng: opts } : opts;
  const rng = o.rng ?? Math.random;
  const free = !!o.free;
  // В бонусе скаттеры тоже падают — они добавляют вращения.
  const chance = SCATTER_CHANCE * (o.ante ? ANTE_SCATTER_FACTOR : 1);

  let grid = scatterGrid(rng, chance);
  const first = grid;
  const scatters = countScatters(grid);

  let scatterPay = 0;
  let freeSpins = 0;
  if (free) {
    if (scatters >= RETRIGGER_MIN) freeSpins = FREE_SPINS_RETRIGGER;
  } else if (scatters >= SCATTER_TRIGGER) {
    scatterPay = roundWin(bet * (SCATTER_PAYOUTS[Math.min(scatters, 6)] ?? 0));
    freeSpins = FREE_SPINS;
  }

  const steps: ScatterStep[] = [];
  let total = scatterPay;
  let totalMult = free ? (o.totalMult ?? 0) : 0;

  for (let i = 0; i < SCATTER_MAX_CASCADES; i++) {
    const wins = findWins(grid);
    // Сферы падают на каждое звено — даже если оно не сыграет.
    const orbs = spawnOrbs(grid, rng);
    if (!wins.length) break;

    const orbSum = orbs.reduce((s, orb) => s + orb.value, 0);
    // В бонусе сферы копятся в общий множитель, в базовой игре работают разово.
    if (free && orbSum) totalMult += orbSum;
    const applied = free ? Math.max(1, totalMult) : Math.max(1, orbSum);
    const base = wins.reduce((sum, w) => sum + w.pay, 0) * bet;
    const payout = roundWin(base * applied);
    total += payout;

    const next = scatterCollapse(grid, wins, rng, chance);
    steps.push({
      grid,
      wins,
      orbs,
      orbMult: orbSum,
      totalMult: free ? totalMult : 0,
      payout,
      next,
    });
    grid = next;
  }

  const multiplier = bet > 0 ? total / bet : 0;
  return {
    grid: first,
    steps,
    scatters,
    scatterPay,
    freeSpins,
    total,
    combo: steps.length,
    totalMult,
    multiplier,
    kind: multiplier >= 25 ? 'mega' : multiplier >= 5 ? 'big' : total > 0 ? 'small' : 'none',
  };
}

/** Подпись результата для строки статуса. */
export function scatterLabel(out: ScatterRound): { text: string; symbol?: SlotSymbolId } {
  if (out.freeSpins && !out.steps.length) return { text: `${out.scatters} скаттера — бонус!` };
  if (out.kind === 'none') return { text: 'Мимо. Ещё разок?' };
  const best = out.steps.flatMap((s) => s.wins).sort((a, b) => b.pay - a.pay)[0];
  if (!best) return { text: 'Скаттеры сыграли!' };
  if (out.combo >= 2) return { text: `цепочка из ${out.combo} звеньев!`, symbol: best.symbol };
  return { text: `${best.count} символов!`, symbol: best.symbol };
}
