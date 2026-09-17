import { describe, expect, it } from 'vitest';
import {
  evaluateGrid,
  hasAnticipation,
  lineBet,
  outcomeLabel,
  PAYLINES,
  randomSymbol,
  SLOT_SYMBOLS,
  spinGrid,
  theoreticalRtp,
} from './slots';
import type { SlotGrid, SlotSymbolId } from './slots';

/** Детерминированный генератор — чтобы тесты не были «плавающими». */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** Поле из строк: ['🍒🍒🍒', '…'] по рядам → grid[колонка][ряд]. */
function grid(rows: [SlotSymbolId[], SlotSymbolId[], SlotSymbolId[]]): SlotGrid {
  return [0, 1, 2].map((col) => rows.map((r) => r[col]));
}

const C: SlotSymbolId = 'cherry';
const L: SlotSymbolId = 'lemon';
const B: SlotSymbolId = 'bell';
const S: SlotSymbolId = 'seven';
const D: SlotSymbolId = 'diamond';

describe('slot machine', () => {
  it('splits the bet evenly between paylines', () => {
    expect(PAYLINES).toHaveLength(5);
    expect(lineBet(50)).toBe(10);
  });

  it('pays three of a kind on the centre line', () => {
    const res = evaluateGrid(grid([[C, L, B], [B, B, B], [L, C, C]]), 50);
    const win = res.wins.find((w) => w.line === 0)!;
    expect(win.count).toBe(3);
    expect(win.symbol).toBe('bell');
    expect(win.payout).toBe(400); // 10 на линию × 40
    expect(win.cells).toEqual([
      [0, 1],
      [1, 1],
      [2, 1],
    ]);
  });

  it('pays the diagonals too', () => {
    // ↘ диагональ: [0,0], [1,1], [2,2]
    const res = evaluateGrid(grid([[S, C, L], [C, S, B], [L, B, S]]), 50);
    const win = res.wins.find((w) => w.line === 3)!;
    expect(win.symbol).toBe('seven');
    expect(res.kind).toBe('jackpot');
    expect(win.payout).toBe(8000); // 10 × 800
    expect(outcomeLabel(res).text).toContain('ДЖЕКПОТ');
  });

  it('pays two matching symbols from the left, but not from the right', () => {
    const left = evaluateGrid(grid([[C, C, L], [L, L, C], [B, B, B]]), 50);
    expect(left.wins.find((w) => w.line === 1)).toMatchObject({ count: 2, payout: 10 });
    // Пара справа (колонки 2 и 3) не считается.
    const right = evaluateGrid(grid([[L, C, C], [C, L, L], [B, B, B]]), 50);
    expect(right.wins.find((w) => w.line === 1 && w.symbol === 'cherry')).toBeUndefined();
  });

  it('adds up several winning lines', () => {
    const res = evaluateGrid(grid([[B, B, B], [B, B, B], [B, B, B]]), 50);
    // Все пять линий — тройки колоколов: 5 × (10 × 40).
    expect(res.wins).toHaveLength(5);
    expect(res.total).toBe(2000);
    expect(res.multiplier).toBe(40);
    expect(res.kind).toBe('big');
  });

  it('reports nothing when no line matches', () => {
    // Первая колонка — вишни, вторая — лимоны: ни одна линия не совпадает слева.
    const res = evaluateGrid(grid([[C, L, B], [C, L, B], [C, L, B]]), 50);
    expect(res.total).toBe(0);
    expect(res.kind).toBe('none');
    expect(outcomeLabel(res).text).toContain('Мимо');
  });

  it('detects a near miss on premium symbols', () => {
    // Две семёрки на центральной линии, третий барабан — мимо.
    expect(hasAnticipation(grid([[C, L, B], [S, S, C], [L, B, D]]))).toBe(true);
    // Два алмаза по диагонали — тоже повод затаить дыхание.
    expect(hasAnticipation(grid([[D, C, L], [C, D, B], [B, L, C]]))).toBe(true);
    // Две вишни — обычное дело, драмы нет.
    expect(hasAnticipation(grid([[C, C, L], [C, C, B], [B, L, C]]))).toBe(false);
  });

  it('keeps the payout table honest (RTP in a sane range)', () => {
    const rtp = theoreticalRtp();
    // Ниже 0.85 играть обидно, выше 0.97 — баланс не тает и бонус теряет смысл.
    expect(rtp).toBeGreaterThan(0.85);
    expect(rtp).toBeLessThan(0.97);
  });

  it('never returns an unknown symbol and respects the weights', () => {
    const rng = seeded(42);
    const ids = SLOT_SYMBOLS.map((s) => s.id);
    const counts = new Map<SlotSymbolId, number>();
    for (let i = 0; i < 20000; i++) {
      const id = randomSymbol(rng);
      expect(ids).toContain(id);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    expect(counts.get('cherry')!).toBeGreaterThan(counts.get('seven')!);
  });

  it('spins a full 3×3 grid', () => {
    const g = spinGrid(seeded(7));
    expect(g).toHaveLength(3);
    expect(g.every((col) => col.length === 3)).toBe(true);
  });

  it('simulated return stays close to the theoretical one', () => {
    const rng = seeded(2026);
    const bet = 50;
    let wagered = 0;
    let returned = 0;
    for (let i = 0; i < 40000; i++) {
      wagered += bet;
      returned += evaluateGrid(spinGrid(rng), bet).total;
    }
    expect(returned / wagered).toBeCloseTo(theoreticalRtp(), 1);
  });
});
