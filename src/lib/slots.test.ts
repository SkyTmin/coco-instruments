import { describe, expect, it } from 'vitest';
import {
  BETS,
  clampBet,
  COMBO_LADDER,
  collapse,
  comboMultiplier,
  evaluateGrid,
  hasAnticipation,
  lineBet,
  MAX_BET,
  MAX_CASCADES,
  MIN_BET,
  outcomeLabel,
  PAYLINES,
  randomSymbol,
  resolveSpin,
  roundWin,
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
  it('keeps the payline unit tied to the bet', () => {
    expect(PAYLINES).toHaveLength(5);
    expect(lineBet(50)).toBe(2);
    expect(lineBet(25)).toBe(1);
  });

  it('clamps a custom bet to the allowed range and step', () => {
    expect(clampBet(1)).toBe(MIN_BET);
    expect(clampBet(0)).toBe(MIN_BET);
    expect(clampBet(99999)).toBe(MAX_BET);
    expect(clampBet(37)).toBe(35);
    expect(clampBet(Number.NaN)).toBe(BETS[0]);
    for (const bet of BETS) expect(clampBet(bet)).toBe(bet);
  });

  it('never turns a win into zero coins', () => {
    expect(roundWin(0)).toBe(0);
    expect(roundWin(0.2)).toBe(1); // пара вишен на ставке 5
    expect(roundWin(2.4)).toBe(2);
  });

  it('pays three of a kind on the centre line', () => {
    const res = evaluateGrid(grid([[C, L, B], [B, B, B], [L, C, C]]), 50);
    const win = res.wins.find((w) => w.line === 0)!;
    expect(win.count).toBe(3);
    expect(win.symbol).toBe('bell');
    expect(win.payout).toBe(80); // 2 на линию × 40
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
    expect(win.payout).toBe(1600); // 2 × 800
    expect(outcomeLabel(res).text).toContain('ДЖЕКПОТ');
  });

  it('pays two matching symbols from the left, but not from the right', () => {
    const left = evaluateGrid(grid([[C, C, L], [L, L, C], [B, B, B]]), 50);
    expect(left.wins.find((w) => w.line === 1)).toMatchObject({ count: 2, payout: 2 });
    // Пара справа (колонки 2 и 3) не считается.
    const right = evaluateGrid(grid([[L, C, C], [C, L, L], [B, B, B]]), 50);
    expect(right.wins.find((w) => w.line === 1 && w.symbol === 'cherry')).toBeUndefined();
  });

  it('adds up several winning lines', () => {
    const res = evaluateGrid(grid([[B, B, B], [B, B, B], [B, B, B]]), 50);
    // Все пять линий — тройки колоколов: 5 × (2 × 40).
    expect(res.wins).toHaveLength(5);
    expect(res.total).toBe(400);
    expect(res.multiplier).toBe(8);
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

  it('one evaluation returns only a fraction — остальное добирают каскады', () => {
    const rtp = theoreticalRtp();
    expect(rtp).toBeGreaterThan(0.15);
    expect(rtp).toBeLessThan(0.25);
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

  it('simulated single-evaluation return matches the analytic one', () => {
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

describe('каскады и комбо', () => {
  it('схлопывание убирает выигрышные ячейки и досыпает сверху', () => {
    const g = grid([
      [C, C, L],
      [B, B, B],
      [L, D, S],
    ]);
    // Центральная линия: три колокола — уходят все три средних ряда.
    const wins = evaluateGrid(g, 50).wins.filter((w) => w.line === 0);
    const next = collapse(g, wins, seeded(3));
    for (let col = 0; col < 3; col++) {
      expect(next[col]).toHaveLength(3);
      // Верхний и нижний символы столбца сохранились и съехали вниз.
      expect(next[col][1]).toBe(g[col][0]);
      expect(next[col][2]).toBe(g[col][2]);
    }
  });

  it('несыгравшие символы не исчезают', () => {
    const g = grid([
      [C, C, L],
      [C, L, B],
      [D, S, B],
    ]);
    const wins = evaluateGrid(g, 50).wins;
    const next = collapse(g, wins, seeded(11));
    expect(next.flat()).toHaveLength(9);
  });

  it('лестница множителей растёт и упирается в потолок', () => {
    expect(comboMultiplier(0)).toBe(1);
    for (let i = 1; i < COMBO_LADDER.length; i++) {
      expect(comboMultiplier(i)).toBeGreaterThan(comboMultiplier(i - 1));
    }
    expect(comboMultiplier(99)).toBe(COMBO_LADDER[COMBO_LADDER.length - 1]);
  });

  it('цепочка заканчивается полем без выигрышей', () => {
    const rng = seeded(5150);
    for (let i = 0; i < 400; i++) {
      const out = resolveSpin(50, rng);
      if (!out.steps.length) continue;
      const last = out.steps[out.steps.length - 1];
      if (out.steps.length < MAX_CASCADES) {
        expect(evaluateGrid(last.next, 50).wins).toHaveLength(0);
      }
    }
  });

  it('выплата звена — это сумма линий, умноженная на комбо', () => {
    const rng = seeded(777);
    let checked = 0;
    for (let i = 0; i < 500 && checked < 60; i++) {
      const out = resolveSpin(100, rng);
      out.steps.forEach((step, k) => {
        const lines = step.wins.reduce((sum, w) => sum + w.payout, 0);
        expect(step.combo).toBe(comboMultiplier(k));
        expect(step.payout).toBeCloseTo(lines * step.combo, 6);
        checked += 1;
      });
      expect(out.total).toBeCloseTo(
        out.steps.reduce((sum, s) => sum + s.payout, 0),
        6,
      );
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('первое поле спина — это то, на чём встали барабаны', () => {
    const out = resolveSpin(50, seeded(9));
    expect(out.grid).toHaveLength(3);
    if (out.steps.length) expect(out.steps[0].grid).toEqual(out.grid);
  });

  it('цепочка не бесконечна', () => {
    const rng = seeded(31337);
    for (let i = 0; i < 2000; i++) {
      expect(resolveSpin(50, rng).steps.length).toBeLessThanOrEqual(MAX_CASCADES);
    }
  });

  it('выплаты остаются целыми на любой ставке, включая произвольную', () => {
    const rng = seeded(4242);
    for (const bet of [...BETS, MIN_BET, 15, 35, 185, MAX_BET]) {
      for (let i = 0; i < 300; i++) {
        const out = resolveSpin(bet, rng);
        expect(Number.isInteger(out.total)).toBe(true);
        out.steps.forEach((step) => expect(Number.isInteger(step.payout)).toBe(true));
      }
    }
  });

  it('на минимальной ставке выигрыш никогда не равен нулю', () => {
    const rng = seeded(88);
    for (let i = 0; i < 2000; i++) {
      const out = resolveSpin(MIN_BET, rng);
      if (out.steps.length) expect(out.total).toBeGreaterThan(0);
    }
  });

  it('полная отдача с каскадами держится около 91%', () => {
    const rng = seeded(1812);
    const bet = 100;
    let wagered = 0;
    let returned = 0;
    for (let i = 0; i < 60000; i++) {
      wagered += bet;
      returned += resolveSpin(bet, rng).total;
    }
    const rtp = returned / wagered;
    // Ниже 0.85 играть обидно, выше 0.97 — банк не тает и бонусы теряют смысл.
    expect(rtp).toBeGreaterThan(0.85);
    expect(rtp).toBeLessThan(0.97);
  });

  it('комбо случаются часто, но длинные цепочки редки', () => {
    const rng = seeded(24);
    const hist = new Map<number, number>();
    const N = 30000;
    for (let i = 0; i < N; i++) {
      const n = resolveSpin(100, rng).combo;
      hist.set(n, (hist.get(n) ?? 0) + 1);
    }
    const share = (n: number) => (hist.get(n) ?? 0) / N;
    expect(share(0)).toBeGreaterThan(0.2); // без выигрыша — обычное дело
    expect(share(2)).toBeGreaterThan(0.05); // комбо из двух звеньев — регулярно
    expect(share(5)).toBeLessThan(0.05); // пять звеньев — редкость
  });
});
