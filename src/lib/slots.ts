// Мини слот-машина: чистая логика (символы, барабаны, линии выплат), без DOM —
// правила игры проверяемы юнит-тестами, страница отвечает только за подачу.
//
// Поле 3×3, пять линий выплат (три горизонтали + две диагонали). Линия платит
// слева направо, как в настоящих автоматах: три одинаковых — главный выигрыш,
// два первых одинаковых — небольшой возврат.
//
// Экономика: веса символов в сумме дают 100 (вероятность = weight/100), ставка
// делится поровну между пятью линиями, поэтому общий RTP ≈ RTP одной линии
// ≈ 93% (см. slots.test.ts): играть приятно, но банк тает — иначе ежедневный
// бонус не имел бы смысла.

import type { SlotSymbolId } from '@/types';

export type { SlotSymbolId };

export interface SlotSymbol {
  id: SlotSymbolId;
  emoji: string;
  /** Вес на барабане; сумма весов всех символов = 100. */
  weight: number;
  /** Множитель линейной ставки за три одинаковых. */
  three: number;
  /** Множитель линейной ставки за два одинаковых слева. */
  pair: number;
  /** Подпись в таблице выплат. */
  label: string;
}

export const SLOT_SYMBOLS: SlotSymbol[] = [
  { id: 'cherry', emoji: '🍒', weight: 28, three: 10, pair: 1, label: 'Вишня' },
  { id: 'lemon', emoji: '🍋', weight: 24, three: 15, pair: 1, label: 'Лимон' },
  { id: 'grape', emoji: '🍇', weight: 18, three: 25, pair: 1, label: 'Виноград' },
  { id: 'bell', emoji: '🔔', weight: 14, three: 40, pair: 1, label: 'Колокол' },
  { id: 'star', emoji: '⭐', weight: 9, three: 80, pair: 2, label: 'Звезда' },
  { id: 'diamond', emoji: '💎', weight: 5, three: 200, pair: 2, label: 'Алмаз' },
  { id: 'seven', emoji: '7️⃣', weight: 2, three: 800, pair: 2, label: 'Семёрка' },
];

const TOTAL_WEIGHT = SLOT_SYMBOLS.reduce((sum, s) => sum + s.weight, 0);
const BY_ID = new Map(SLOT_SYMBOLS.map((s) => [s.id, s]));

export function symbolOf(id: SlotSymbolId): SlotSymbol {
  return BY_ID.get(id)!;
}

export function emojiOf(id: SlotSymbolId): string {
  return symbolOf(id).emoji;
}

/** Символы, ради которых стоит затаить дыхание (драма «почти выиграл»). */
export const PREMIUM: SlotSymbolId[] = ['seven', 'diamond'];

export const REELS = 3;
export const ROWS = 3;

/**
 * Линии выплат: для каждой из трёх колонок указан ряд (0 — верх, 2 — низ).
 * Порядок важен: центральная линия первая — она же «главная».
 */
export const PAYLINES: { id: number; rows: number[]; name: string }[] = [
  { id: 0, rows: [1, 1, 1], name: 'Центр' },
  { id: 1, rows: [0, 0, 0], name: 'Верх' },
  { id: 2, rows: [2, 2, 2], name: 'Низ' },
  { id: 3, rows: [0, 1, 2], name: 'Диагональ ↘' },
  { id: 4, rows: [2, 1, 0], name: 'Диагональ ↗' },
];

export const BETS = [10, 25, 50, 100, 250];

/** Стартовый банк нового игрока и размеры бонусов. */
export const START_BALANCE = 1000;
export const DAILY_BONUS = 500;
export const RESCUE_BONUS = 200;
export const BONUS_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/**
 * Накопительный джекпот: к базе прибавляется доля каждой ставки, и весь банк
 * достаётся тому, кто соберёт три семёрки. Число на табло растёт на глазах —
 * это и есть главный «крючок» автомата.
 */
export const JACKPOT_BASE = 5000;
export const JACKPOT_RATE = 0.05;

/** Ставка делится поровну между линиями — выигрыши считаются от неё. */
export function lineBet(bet: number): number {
  return bet / PAYLINES.length;
}

type Rng = () => number;

/** Один случайный символ с учётом весов. */
export function randomSymbol(rng: Rng = Math.random): SlotSymbolId {
  let roll = rng() * TOTAL_WEIGHT;
  for (const s of SLOT_SYMBOLS) {
    roll -= s.weight;
    if (roll < 0) return s.id;
  }
  return SLOT_SYMBOLS[SLOT_SYMBOLS.length - 1].id;
}

/** Поле 3×3: grid[колонка][ряд]. */
export type SlotGrid = SlotSymbolId[][];

export function spinGrid(rng: Rng = Math.random): SlotGrid {
  return Array.from({ length: REELS }, () =>
    Array.from({ length: ROWS }, () => randomSymbol(rng)),
  );
}

export interface LineWin {
  line: number;
  symbol: SlotSymbolId;
  /** 2 или 3 совпавших символа слева. */
  count: number;
  payout: number;
  /** Координаты выигрышных ячеек: [колонка, ряд]. */
  cells: [number, number][];
}

export interface SpinResult {
  grid: SlotGrid;
  wins: LineWin[];
  total: number;
  /** Лучший множитель к общей ставке — для оценки «насколько крупно». */
  multiplier: number;
  kind: 'none' | 'small' | 'big' | 'jackpot';
}

/** Оценка поля: пробегаем все линии слева направо. */
export function evaluateGrid(grid: SlotGrid, bet: number): SpinResult {
  const unit = lineBet(bet);
  const wins: LineWin[] = [];

  for (const line of PAYLINES) {
    const symbols = line.rows.map((row, col) => grid[col][row]);
    const [a, b, c] = symbols;
    if (a === b && b === c) {
      wins.push({
        line: line.id,
        symbol: a,
        count: 3,
        payout: unit * symbolOf(a).three,
        cells: line.rows.map((row, col) => [col, row] as [number, number]),
      });
    } else if (a === b) {
      wins.push({
        line: line.id,
        symbol: a,
        count: 2,
        payout: unit * symbolOf(a).pair,
        cells: line.rows.slice(0, 2).map((row, col) => [col, row] as [number, number]),
      });
    }
  }

  const total = wins.reduce((sum, w) => sum + w.payout, 0);
  const multiplier = bet > 0 ? total / bet : 0;
  const jackpot = wins.some((w) => w.symbol === 'seven' && w.count === 3);
  return {
    grid,
    wins,
    total,
    multiplier,
    kind: jackpot ? 'jackpot' : multiplier >= 5 ? 'big' : total > 0 ? 'small' : 'none',
  };
}

/**
 * «Почти выиграл»: на первых двух барабанах уже стоят два премиальных символа
 * на одной линии. Страница тормозит последний барабан — тот самый момент
 * ожидания, ради которого в слоты и играют.
 */
export function hasAnticipation(grid: SlotGrid): boolean {
  return PAYLINES.some((line) => {
    const a = grid[0][line.rows[0]];
    const b = grid[1][line.rows[1]];
    return a === b && PREMIUM.includes(a);
  });
}

/** Подпись результата: текст и символ, который рисуется рядом. */
export interface OutcomeLabel {
  text: string;
  symbol?: SlotSymbolId;
}

export function outcomeLabel(result: SpinResult): OutcomeLabel {
  if (result.kind === 'none') return { text: 'Мимо. Ещё разок?' };
  if (result.kind === 'jackpot') return { text: 'ДЖЕКПОТ! ТРИ СЕМЁРКИ!' };
  const best = [...result.wins].sort((x, y) => y.payout - x.payout)[0];
  const line = PAYLINES[best.line];
  if (result.wins.length > 1) {
    return { text: `${result.wins.length} линии сыграли`, symbol: best.symbol };
  }
  if (best.count === 3) {
    return { text: `три в ряд — ${line.name.toLowerCase()}!`, symbol: best.symbol };
  }
  return { text: `пара — ${line.name.toLowerCase()}`, symbol: best.symbol };
}

/**
 * Теоретическая отдача (RTP): доля ставки, возвращаемая игроку в среднем.
 * Считается аналитически по весам — страховка от правки выплат, которая
 * превратит игру в «вечный банкомат» или в обдираловку.
 */
export function theoreticalRtp(): number {
  let perLine = 0;
  for (const s of SLOT_SYMBOLS) {
    const p = s.weight / TOTAL_WEIGHT;
    perLine += p ** 3 * s.three; // три одинаковых
    perLine += p ** 2 * (1 - p) * s.pair; // ровно два слева
  }
  // Каждая из линий получает bet/5, линий — пять: общий RTP равен линейному.
  return perLine;
}
