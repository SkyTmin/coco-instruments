// «Каскад» — вторая игра: большое поле 6×5 и выплата за восемь одинаковых
// символов ГДЕ УГОДНО на поле (pay anywhere), а не по линиям. Так устроены
// современные автоматы вроде Gates of Olympus и Sweet Bonanza: линий нет,
// считается просто количество символов на всём поле.
//
// Выигравшие символы исчезают, верхние падают на их места, поле считается
// заново — и общий множитель растёт с каждым звеном цепочки. Логика чистая,
// без DOM: страница только проигрывает готовую цепочку.
//
// Честность: символы берутся тем же взвешенным ГСЧ, множитель известен заранее
// и написан в таблице выплат. Отдача сведена к ~92% таблицей выплат, а не
// подкрученными исходами — см. scatter.test.ts.

import type { SlotSymbolId } from '@/types';
import { roundWin } from './slots';

export const SCATTER_COLS = 6;
export const SCATTER_ROWS = 5;
/** Сколько одинаковых символов нужно, чтобы поле сыграло. */
export const CLUSTER_MIN = 8;

type Rng = () => number;

/**
 * Веса символов для большого поля. Они заметно ровнее, чем у классических
 * слотов: на 30 клетках перекошенные веса давали бы вишню почти каждый спин.
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

/**
 * Выплаты — множители ВСЕЙ ставки (не доли, как в линиях). Три ступени:
 * 8–9 символов, 10–11 и 12 и больше.
 */
export interface ScatterPay {
  id: SlotSymbolId;
  /** [8–9, 10–11, 12+] */
  tiers: [number, number, number];
}

export const SCATTER_PAYS: ScatterPay[] = [
  { id: 'cherry', tiers: [0.04, 0.09, 0.23] },
  { id: 'lemon', tiers: [0.05, 0.12, 0.31] },
  { id: 'grape', tiers: [0.08, 0.17, 0.43] },
  { id: 'bell', tiers: [0.12, 0.27, 0.7] },
  { id: 'star', tiers: [0.2, 0.47, 1.4] },
  { id: 'diamond', tiers: [0.35, 0.85, 2.7] },
  { id: 'seven', tiers: [0.7, 1.9, 6.2] },
];

const PAY_BY_ID = new Map(SCATTER_PAYS.map((p) => [p.id, p]));
const IDS = Object.keys(SCATTER_WEIGHTS) as SlotSymbolId[];
const TOTAL_WEIGHT = IDS.reduce((sum, id) => sum + SCATTER_WEIGHTS[id], 0);

/** Множитель ставки за `count` символов данного вида. */
export function payFor(id: SlotSymbolId, count: number): number {
  if (count < CLUSTER_MIN) return 0;
  const pay = PAY_BY_ID.get(id);
  if (!pay) return 0;
  const tier = count >= 12 ? 2 : count >= 10 ? 1 : 0;
  return pay.tiers[tier];
}

/**
 * Лестница общего множителя: первое попадание ×1, дальше каждое звено цепочки
 * платит всё крупнее. Это и есть «комбо» большого поля.
 */
export const SCATTER_LADDER = [1, 2, 3, 5, 10, 15, 25];

export function scatterMultiplier(step: number): number {
  return SCATTER_LADDER[Math.min(Math.max(step, 0), SCATTER_LADDER.length - 1)];
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

/** Поле: grid[колонка][ряд], ряд 0 — верх. */
export type ScatterGrid = SlotSymbolId[][];

export function scatterGrid(rng: Rng = Math.random): ScatterGrid {
  return Array.from({ length: SCATTER_COLS }, () =>
    Array.from({ length: SCATTER_ROWS }, () => scatterSymbol(rng)),
  );
}

/** Один сыгравший символ: сколько его на поле и какие клетки уходят. */
export interface ScatterWin {
  symbol: SlotSymbolId;
  count: number;
  /** Множитель ставки до применения общего множителя цепочки. */
  pay: number;
  cells: [number, number][];
}

/** Что сыграло на поле прямо сейчас. */
export function findWins(grid: ScatterGrid): ScatterWin[] {
  const cells = new Map<SlotSymbolId, [number, number][]>();
  grid.forEach((col, c) =>
    col.forEach((id, r) => {
      const list = cells.get(id);
      if (list) list.push([c, r]);
      else cells.set(id, [[c, r]]);
    }),
  );
  const wins: ScatterWin[] = [];
  for (const [symbol, list] of cells) {
    const pay = payFor(symbol, list.length);
    if (pay > 0) wins.push({ symbol, count: list.length, pay, cells: list });
  }
  // Крупные выплаты первыми — так удобнее подписывать результат.
  return wins.sort((a, b) => b.pay - a.pay);
}

/** Схлопывание: сыгравшие клетки исчезают, верхние падают, сверху новые. */
export function scatterCollapse(
  grid: ScatterGrid,
  wins: ScatterWin[],
  rng: Rng = Math.random,
): ScatterGrid {
  const dead = new Set(wins.flatMap((w) => w.cells.map(([c, r]) => `${c}:${r}`)));
  return grid.map((column, col) => {
    const kept = column.filter((_, row) => !dead.has(`${col}:${row}`));
    const fresh = Array.from({ length: SCATTER_ROWS - kept.length }, () => scatterSymbol(rng));
    return [...fresh, ...kept];
  });
}

export interface ScatterStep {
  grid: ScatterGrid;
  wins: ScatterWin[];
  /** Общий множитель цепочки на этом звене. */
  combo: number;
  /** Выплата звена в монетах, уже с множителем и округлением. */
  payout: number;
  next: ScatterGrid;
}

export interface ScatterOutcome {
  /** Поле, на котором остановились барабаны. */
  grid: ScatterGrid;
  steps: ScatterStep[];
  total: number;
  /** Длина цепочки. */
  combo: number;
  /** Во сколько раз выигрыш больше ставки. */
  multiplier: number;
  kind: 'none' | 'small' | 'big' | 'mega';
}

/** Полный спин: крутим поле, платим, схлопываем и повторяем. */
export function resolveScatter(bet: number, rng: Rng = Math.random): ScatterOutcome {
  const steps: ScatterStep[] = [];
  let grid = scatterGrid(rng);
  const first = grid;
  let total = 0;

  for (let i = 0; i < SCATTER_MAX_CASCADES; i++) {
    const wins = findWins(grid);
    if (!wins.length) break;
    const combo = scatterMultiplier(i);
    const raw = wins.reduce((sum, w) => sum + w.pay, 0) * bet * combo;
    const payout = roundWin(raw);
    total += payout;
    const next = scatterCollapse(grid, wins, rng);
    steps.push({ grid, wins, combo, payout, next });
    grid = next;
  }

  const multiplier = bet > 0 ? total / bet : 0;
  return {
    grid: first,
    steps,
    total,
    combo: steps.length,
    multiplier,
    kind: multiplier >= 25 ? 'mega' : multiplier >= 5 ? 'big' : total > 0 ? 'small' : 'none',
  };
}

/** Подпись результата для строки статуса. */
export function scatterLabel(out: ScatterOutcome): { text: string; symbol?: SlotSymbolId } {
  if (out.kind === 'none') return { text: 'Мимо. Ещё разок?' };
  const best = out.steps.flatMap((s) => s.wins).sort((a, b) => b.pay - a.pay)[0];
  if (out.combo >= 2) return { text: `цепочка из ${out.combo} звеньев!`, symbol: best?.symbol };
  return { text: `${best.count} символов подряд!`, symbol: best.symbol };
}
