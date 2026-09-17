// Мини слот-машина: чистая логика (символы, вращение, выплаты), без DOM —
// чтобы правила игры были проверяемы юнит-тестами, а страница отвечала только
// за анимацию и ввод.
//
// Экономика: веса символов в сумме дают 100, так что вероятность символа на
// барабане = weight/100. Выплаты подобраны под RTP ≈ 93% (см. slots.test.ts):
// играть приятно, но баланс постепенно тает — иначе ежедневный бонус не нужен.

import type { SlotSymbolId } from '@/types';

export type { SlotSymbolId };

export interface SlotSymbol {
  id: SlotSymbolId;
  emoji: string;
  /** Вес на барабане; сумма весов всех символов = 100. */
  weight: number;
  /** Множитель ставки за три одинаковых. */
  three: number;
  /** Множитель ставки за ровно два одинаковых. */
  pair: number;
}

export const SLOT_SYMBOLS: SlotSymbol[] = [
  { id: 'cherry', emoji: '🍒', weight: 28, three: 5, pair: 1 },
  { id: 'lemon', emoji: '🍋', weight: 24, three: 8, pair: 1 },
  { id: 'grape', emoji: '🍇', weight: 18, three: 16, pair: 1 },
  { id: 'bell', emoji: '🔔', weight: 14, three: 25, pair: 1 },
  { id: 'star', emoji: '⭐', weight: 9, three: 50, pair: 2 },
  { id: 'diamond', emoji: '💎', weight: 5, three: 120, pair: 2 },
  { id: 'seven', emoji: '7️⃣', weight: 2, three: 500, pair: 2 },
];

const TOTAL_WEIGHT = SLOT_SYMBOLS.reduce((sum, s) => sum + s.weight, 0);

const BY_ID = new Map(SLOT_SYMBOLS.map((s) => [s.id, s]));

export function symbolOf(id: SlotSymbolId): SlotSymbol {
  return BY_ID.get(id)!;
}

export function emojiOf(id: SlotSymbolId): string {
  return symbolOf(id).emoji;
}

export const BETS = [10, 25, 50, 100, 250];

/** Стартовый банк нового игрока и размеры бонусов. */
export const START_BALANCE = 1000;
export const DAILY_BONUS = 500;
export const RESCUE_BONUS = 200;
export const BONUS_COOLDOWN_MS = 24 * 60 * 60 * 1000;

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

/** Результат вращения — три символа на линии. */
export function spinReels(rng: Rng = Math.random): SlotSymbolId[] {
  return [randomSymbol(rng), randomSymbol(rng), randomSymbol(rng)];
}

export type SpinKind = 'none' | 'pair' | 'triple' | 'jackpot';

export interface SpinOutcome {
  kind: SpinKind;
  /** Выигрыш в монетах (0, если не повезло). */
  payout: number;
  /** Символ комбинации — для подписи «Три вишни!». */
  symbol?: SlotSymbolId;
  /** Индексы барабанов, вошедших в комбинацию (для подсветки). */
  matched: number[];
}

/** Оценка линии: три одинаковых (у 7️⃣ — джекпот), ровно два одинаковых, мимо. */
export function evaluateSpin(reels: SlotSymbolId[], bet: number): SpinOutcome {
  const [a, b, c] = reels;
  if (a === b && b === c) {
    const s = symbolOf(a);
    return {
      kind: a === 'seven' ? 'jackpot' : 'triple',
      payout: bet * s.three,
      symbol: a,
      matched: [0, 1, 2],
    };
  }
  // Ровно два одинаковых: находим повторяющийся символ и его позиции.
  const pairs: [SlotSymbolId, number[]][] = [
    [a, [0, 1]],
    [a, [0, 2]],
    [b, [1, 2]],
  ];
  const hit = pairs.find(([, [i, j]]) => reels[i] === reels[j]);
  if (hit) {
    const s = symbolOf(hit[0]);
    return { kind: 'pair', payout: bet * s.pair, symbol: hit[0], matched: hit[1] };
  }
  return { kind: 'none', payout: 0, matched: [] };
}

/** Человеческая подпись результата для строки статуса. */
export function outcomeLabel(outcome: SpinOutcome): string {
  if (outcome.kind === 'jackpot') return 'ДЖЕКПОТ! 7️⃣7️⃣7️⃣';
  if (outcome.kind === 'triple') return `Три ${emojiOf(outcome.symbol!)} подряд!`;
  if (outcome.kind === 'pair') return `Пара ${emojiOf(outcome.symbol!)} — ставка возвращается`;
  return 'Мимо. Крутим ещё?';
}

/**
 * Теоретическая отдача (RTP): доля ставки, возвращаемая игроку в среднем.
 * Считается аналитически по весам — используется в тестах как страховка от
 * случайной правки выплат, которая сделает игру «вечным банкоматом».
 */
export function theoreticalRtp(): number {
  let rtp = 0;
  for (const s of SLOT_SYMBOLS) {
    const p = s.weight / TOTAL_WEIGHT;
    rtp += p ** 3 * s.three; // три одинаковых
    rtp += 3 * p ** 2 * (1 - p) * s.pair; // ровно два одинаковых
  }
  return rtp;
}
