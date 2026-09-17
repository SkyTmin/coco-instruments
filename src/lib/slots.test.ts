import { describe, expect, it } from 'vitest';
import {
  evaluateSpin,
  outcomeLabel,
  randomSymbol,
  SLOT_SYMBOLS,
  spinReels,
  theoreticalRtp,
} from './slots';
import type { SlotSymbolId } from './slots';

/** Детерминированный генератор — чтобы тесты не были «плавающими». */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe('slot machine', () => {
  it('pays for three of a kind', () => {
    const out = evaluateSpin(['bell', 'bell', 'bell'], 10);
    expect(out.kind).toBe('triple');
    expect(out.payout).toBe(250); // 10 × 25
    expect(out.matched).toEqual([0, 1, 2]);
  });

  it('treats three sevens as a jackpot', () => {
    const out = evaluateSpin(['seven', 'seven', 'seven'], 10);
    expect(out.kind).toBe('jackpot');
    expect(out.payout).toBe(5000); // 10 × 500
    expect(outcomeLabel(out)).toContain('ДЖЕКПОТ');
  });

  it('pays for exactly two of a kind and reports their positions', () => {
    expect(evaluateSpin(['cherry', 'cherry', 'lemon'], 50)).toMatchObject({
      kind: 'pair',
      payout: 50,
      matched: [0, 1],
    });
    expect(evaluateSpin(['cherry', 'lemon', 'cherry'], 50).matched).toEqual([0, 2]);
    expect(evaluateSpin(['lemon', 'cherry', 'cherry'], 50).matched).toEqual([1, 2]);
    // Старшие символы платят за пару вдвое.
    expect(evaluateSpin(['diamond', 'diamond', 'lemon'], 50).payout).toBe(100);
  });

  it('pays nothing when all three differ', () => {
    const out = evaluateSpin(['cherry', 'lemon', 'grape'], 100);
    expect(out).toMatchObject({ kind: 'none', payout: 0, matched: [] });
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
    // Вишня (вес 28) должна встречаться заметно чаще семёрки (вес 2).
    expect(counts.get('cherry')!).toBeGreaterThan(counts.get('seven')!);
  });

  it('spins three reels', () => {
    expect(spinReels(seeded(7))).toHaveLength(3);
  });

  it('simulated return stays close to the theoretical one', () => {
    const rng = seeded(2026);
    const bet = 10;
    let wagered = 0;
    let returned = 0;
    for (let i = 0; i < 60000; i++) {
      wagered += bet;
      returned += evaluateSpin(spinReels(rng), bet).payout;
    }
    expect(returned / wagered).toBeCloseTo(theoreticalRtp(), 1);
  });
});
