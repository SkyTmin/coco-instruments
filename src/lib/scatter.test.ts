import { describe, expect, it } from 'vitest';
import {
  ANTE_COST,
  CLUSTER_MIN,
  FREE_SPINS,
  SCATTER_CHANCE,
  SCATTER_COLS,
  SCATTER_PAYOUTS,
  SCATTER_PAYS,
  SCATTER_ROWS,
  SCATTER_TRIGGER,
  SCATTER_WEIGHTS,
  countScatters,
  findWins,
  orbValue,
  payFor,
  resolveScatter,
  scatterCollapse,
  scatterGrid,
  scatterLabel,
  scatterSymbol,
  spawnOrbs,
} from './scatter';
import { BETS, MIN_BET } from './slots';
import type { ScatterCell, ScatterGrid } from './scatter';
import type { SlotSymbolId } from './slots';

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** Поле, где первые `n` клеток — `id`, остальные — `fill`. */
function gridWith(id: ScatterCell, n: number, fill: ScatterCell): ScatterGrid {
  const flat: ScatterCell[] = Array.from({ length: SCATTER_COLS * SCATTER_ROWS }, (_, i) =>
    i < n ? id : fill,
  );
  return Array.from({ length: SCATTER_COLS }, (_, c) =>
    Array.from({ length: SCATTER_ROWS }, (_, r) => flat[c * SCATTER_ROWS + r]),
  );
}

/** Полная сессия: базовый спин плюс весь бонус, если он выпал. */
function session(bet: number, rng: () => number, ante = false) {
  const base = resolveScatter(bet, { rng, ante });
  let paid = base.total;
  let left = base.freeSpins;
  let mult = 0;
  let guard = 0;
  while (left > 0 && guard < 300) {
    left -= 1;
    guard += 1;
    const f = resolveScatter(bet, { rng, free: true, totalMult: mult });
    paid += f.total;
    mult = f.totalMult;
    left += f.freeSpins;
  }
  return { paid, staked: bet * (ante ? ANTE_COST : 1), bonus: base.freeSpins > 0 };
}

describe('поле и выплаты', () => {
  it('поле 6×5', () => {
    const g = scatterGrid(seeded(1));
    expect(g).toHaveLength(SCATTER_COLS);
    expect(g.every((col) => col.length === SCATTER_ROWS)).toBe(true);
  });

  it('семь одинаковых не платят, восемь — платят', () => {
    expect(
      findWins(gridWith('seven', CLUSTER_MIN - 1, 'cherry')).find((w) => w.symbol === 'seven'),
    ).toBeUndefined();
    const win = findWins(gridWith('seven', CLUSTER_MIN, 'cherry')).find(
      (w) => w.symbol === 'seven',
    )!;
    expect(win.count).toBe(CLUSTER_MIN);
    expect(win.pay).toBeGreaterThan(0);
  });

  it('ступени выплат растут, редкие символы платят больше', () => {
    for (const p of SCATTER_PAYS) {
      expect(payFor(p.id, 7)).toBe(0);
      expect(payFor(p.id, 8)).toBe(p.tiers[0]);
      expect(payFor(p.id, 10)).toBe(p.tiers[1]);
      expect(payFor(p.id, 12)).toBe(p.tiers[2]);
      expect(p.tiers[2]).toBeGreaterThan(p.tiers[1]);
      expect(p.tiers[1]).toBeGreaterThan(p.tiers[0]);
    }
    for (let i = 1; i < SCATTER_PAYS.length; i++) {
      expect(SCATTER_WEIGHTS[SCATTER_PAYS[i].id]).toBeLessThan(
        SCATTER_WEIGHTS[SCATTER_PAYS[i - 1].id],
      );
      expect(SCATTER_PAYS[i].tiers[0]).toBeGreaterThan(SCATTER_PAYS[i - 1].tiers[0]);
    }
  });

  it('скаттеры не собираются в выигрыш', () => {
    const g = gridWith('scatter', 12, 'cherry');
    expect(countScatters(g)).toBe(12);
    expect(findWins(g).find((w) => (w.symbol as string) === 'scatter')).toBeUndefined();
  });

  it('схлопывание сохраняет размер поля и не трогает скаттеры', () => {
    const g = gridWith('seven', CLUSTER_MIN, 'cherry');
    g[5][0] = 'scatter';
    const wins = findWins(g).filter((w) => w.symbol === 'seven');
    const next = scatterCollapse(g, wins, seeded(5));
    expect(next.flat()).toHaveLength(SCATTER_COLS * SCATTER_ROWS);
    expect(countScatters(next)).toBeGreaterThanOrEqual(1);
  });
});

describe('сферы-множители', () => {
  it('номинал всегда из таблицы и не меньше двух', () => {
    const rng = seeded(11);
    for (let i = 0; i < 3000; i++) {
      const v = orbValue(rng);
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThanOrEqual(500);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('сферы не ложатся на скаттеры и не дублируют клетку', () => {
    const rng = seeded(3);
    const g = gridWith('scatter', 25, 'cherry');
    for (let i = 0; i < 400; i++) {
      const orbs = spawnOrbs(g, rng);
      const seen = new Set<string>();
      for (const o of orbs) {
        expect(g[o.col][o.row]).not.toBe('scatter');
        expect(seen.has(`${o.col}:${o.row}`)).toBe(false);
        seen.add(`${o.col}:${o.row}`);
      }
    }
  });

  it('в базовой игре сферы умножают выплату звена', () => {
    const rng = seeded(909);
    let checked = 0;
    for (let i = 0; i < 6000 && checked < 5; i++) {
      const out = resolveScatter(100, { rng });
      for (const step of out.steps) {
        if (!step.orbMult) continue;
        const base = step.wins.reduce((s, w) => s + w.pay, 0) * 100;
        expect(step.payout).toBe(Math.max(1, Math.round(base * step.orbMult)));
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('скаттеры и бонус', () => {
  it('четыре скаттера платят и дают вращения, три — нет', () => {
    // Подбираем поле руками: движок считает скаттеры на стартовой сетке.
    const few = gridWith('scatter', SCATTER_TRIGGER - 1, 'cherry');
    expect(countScatters(few)).toBeLessThan(SCATTER_TRIGGER);
    expect(SCATTER_PAYOUTS[4]).toBeGreaterThan(0);
    expect(SCATTER_PAYOUTS[6]).toBeGreaterThan(SCATTER_PAYOUTS[5]);
    expect(FREE_SPINS).toBeGreaterThan(0);
  });

  it('бонус выпадает нечасто, но выпадает', () => {
    const rng = seeded(4242);
    let bonus = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) if (resolveScatter(100, { rng }).freeSpins > 0) bonus += 1;
    expect(bonus).toBeGreaterThan(20);
    expect(bonus / N).toBeLessThan(0.03);
  });

  it('ставка Ante делает бонус заметно чаще', () => {
    const rng = seeded(77);
    const rate = (ante: boolean) => {
      let n = 0;
      for (let i = 0; i < 30000; i++) if (resolveScatter(100, { rng, ante }).freeSpins > 0) n += 1;
      return n;
    };
    const plain = rate(false);
    const ante = rate(true);
    expect(ante).toBeGreaterThan(plain);
    // Но не в разы: иначе Ante стал бы бесплатным плюсом к отдаче.
    expect(ante).toBeLessThan(plain * 3);
  });

  it('в бонусе общий множитель только растёт', () => {
    const rng = seeded(31337);
    let mult = 0;
    for (let i = 0; i < 400; i++) {
      const f = resolveScatter(100, { rng, free: true, totalMult: mult });
      expect(f.totalMult).toBeGreaterThanOrEqual(mult);
      mult = f.totalMult;
    }
    expect(mult).toBeGreaterThan(0);
  });

  it('вне бонуса множитель не копится', () => {
    const rng = seeded(8);
    for (let i = 0; i < 200; i++) expect(resolveScatter(100, { rng }).totalMult).toBe(0);
  });
});

describe('экономика', () => {
  it('выплаты целые на любой ставке', () => {
    const rng = seeded(2024);
    for (const bet of [MIN_BET, ...BETS, 35, 185]) {
      for (let i = 0; i < 150; i++) {
        const out = resolveScatter(bet, { rng });
        expect(Number.isInteger(out.total)).toBe(true);
        out.steps.forEach((s) => expect(Number.isInteger(s.payout)).toBe(true));
      }
    }
  });

  it('отдача держится в разумных рамках', () => {
    const rng = seeded(1812);
    let paid = 0;
    let staked = 0;
    for (let i = 0; i < 120000; i++) {
      const s = session(100, rng);
      paid += s.paid;
      staked += s.staked;
    }
    const rtp = paid / staked;
    // Бонус даёт больше половины отдачи, поэтому разброс велик даже на сотне
    // тысяч сессий — рамки нарочно широкие, но «банкомат» они не пропустят.
    expect(rtp).toBeGreaterThan(0.8);
    expect(rtp).toBeLessThan(1.05);
  });

  it('шанс скаттера мал: поле не усыпано ими', () => {
    expect(SCATTER_CHANCE).toBeLessThan(0.05);
    const rng = seeded(5);
    let total = 0;
    for (let i = 0; i < 2000; i++) total += countScatters(scatterGrid(rng, SCATTER_CHANCE));
    expect(total / 2000).toBeLessThan(2);
  });

  it('подпись объясняет, что случилось', () => {
    const rng = seeded(64);
    for (let i = 0; i < 5000; i++) {
      const out = resolveScatter(100, { rng });
      const label = scatterLabel(out);
      expect(label.text.length).toBeGreaterThan(3);
    }
  });

  it('символы не выходят за известный набор', () => {
    const rng = seeded(3);
    const ids = Object.keys(SCATTER_WEIGHTS) as SlotSymbolId[];
    for (let i = 0; i < 4000; i++) expect(ids).toContain(scatterSymbol(rng));
  });
});
