import { describe, expect, it } from 'vitest';
import {
  CLUSTER_MIN,
  SCATTER_COLS,
  SCATTER_LADDER,
  SCATTER_MAX_CASCADES,
  SCATTER_PAYS,
  SCATTER_ROWS,
  SCATTER_WEIGHTS,
  findWins,
  payFor,
  resolveScatter,
  scatterCollapse,
  scatterGrid,
  scatterLabel,
  scatterMultiplier,
  scatterSymbol,
} from './scatter';
import { BETS, MIN_BET } from './slots';
import type { ScatterGrid } from './scatter';
import type { SlotSymbolId } from './slots';

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** Поле, заполненное `fill`, с `n` клетками символа `id` в начале. */
function gridWith(id: SlotSymbolId, n: number, fill: SlotSymbolId): ScatterGrid {
  const flat: SlotSymbolId[] = Array.from({ length: SCATTER_COLS * SCATTER_ROWS }, (_, i) =>
    i < n ? id : fill,
  );
  return Array.from({ length: SCATTER_COLS }, (_, c) =>
    Array.from({ length: SCATTER_ROWS }, (_, r) => flat[c * SCATTER_ROWS + r]),
  );
}

describe('большое поле', () => {
  it('поле 6×5', () => {
    const g = scatterGrid(seeded(1));
    expect(g).toHaveLength(SCATTER_COLS);
    expect(g.every((col) => col.length === SCATTER_ROWS)).toBe(true);
  });

  it('семь символов меньше восьми не платят', () => {
    const wins = findWins(gridWith('seven', CLUSTER_MIN - 1, 'cherry'));
    expect(wins.find((w) => w.symbol === 'seven')).toBeUndefined();
  });

  it('восемь одинаковых где угодно — уже выигрыш', () => {
    const wins = findWins(gridWith('seven', CLUSTER_MIN, 'cherry'));
    const win = wins.find((w) => w.symbol === 'seven')!;
    expect(win.count).toBe(CLUSTER_MIN);
    expect(win.cells).toHaveLength(CLUSTER_MIN);
    expect(win.pay).toBeGreaterThan(0);
  });

  it('ступени выплат растут с количеством символов', () => {
    for (const p of SCATTER_PAYS) {
      expect(payFor(p.id, 8)).toBe(p.tiers[0]);
      expect(payFor(p.id, 10)).toBe(p.tiers[1]);
      expect(payFor(p.id, 12)).toBe(p.tiers[2]);
      expect(payFor(p.id, 7)).toBe(0);
      expect(p.tiers[1]).toBeGreaterThan(p.tiers[0]);
      expect(p.tiers[2]).toBeGreaterThan(p.tiers[1]);
    }
  });

  it('редкие символы платят больше частых', () => {
    for (let i = 1; i < SCATTER_PAYS.length; i++) {
      const cur = SCATTER_PAYS[i];
      const prev = SCATTER_PAYS[i - 1];
      expect(SCATTER_WEIGHTS[cur.id]).toBeLessThan(SCATTER_WEIGHTS[prev.id]);
      expect(cur.tiers[0]).toBeGreaterThan(prev.tiers[0]);
    }
  });

  it('схлопывание убирает сыгравшие клетки и досыпает сверху', () => {
    const g = gridWith('seven', CLUSTER_MIN, 'cherry');
    const wins = findWins(g).filter((w) => w.symbol === 'seven');
    const next = scatterCollapse(g, wins, seeded(5));
    expect(next.flat()).toHaveLength(SCATTER_COLS * SCATTER_ROWS);
    // Вишни на месте не тронуты — их столько же или больше.
    const cherries = next.flat().filter((id) => id === 'cherry').length;
    expect(cherries).toBeGreaterThanOrEqual(SCATTER_COLS * SCATTER_ROWS - CLUSTER_MIN);
  });

  it('лестница множителей растёт и упирается в потолок', () => {
    expect(scatterMultiplier(0)).toBe(1);
    for (let i = 1; i < SCATTER_LADDER.length; i++) {
      expect(scatterMultiplier(i)).toBeGreaterThan(scatterMultiplier(i - 1));
    }
    expect(scatterMultiplier(99)).toBe(SCATTER_LADDER[SCATTER_LADDER.length - 1]);
  });

  it('цепочка заканчивается полем без выигрышей и не бесконечна', () => {
    const rng = seeded(4242);
    for (let i = 0; i < 400; i++) {
      const out = resolveScatter(100, rng);
      expect(out.steps.length).toBeLessThanOrEqual(SCATTER_MAX_CASCADES);
      if (out.steps.length && out.steps.length < SCATTER_MAX_CASCADES) {
        expect(findWins(out.steps[out.steps.length - 1].next)).toHaveLength(0);
      }
    }
  });

  it('сумма спина — это сумма звеньев, и она целая на любой ставке', () => {
    const rng = seeded(77);
    for (const bet of [MIN_BET, ...BETS, 35, 185]) {
      for (let i = 0; i < 200; i++) {
        const out = resolveScatter(bet, rng);
        expect(Number.isInteger(out.total)).toBe(true);
        expect(out.total).toBe(out.steps.reduce((sum, s) => sum + s.payout, 0));
        out.steps.forEach((step, k) => expect(step.combo).toBe(scatterMultiplier(k)));
      }
    }
  });

  it('отдача держится около 92%', () => {
    const rng = seeded(2026);
    const bet = 100;
    let wagered = 0;
    let returned = 0;
    for (let i = 0; i < 60000; i++) {
      wagered += bet;
      returned += resolveScatter(bet, rng).total;
    }
    const rtp = returned / wagered;
    expect(rtp).toBeGreaterThan(0.85);
    expect(rtp).toBeLessThan(0.97);
  });

  it('цепочки случаются часто, длинные — редко', () => {
    const rng = seeded(9);
    const hist = new Map<number, number>();
    const N = 30000;
    for (let i = 0; i < N; i++) {
      const n = resolveScatter(100, rng).combo;
      hist.set(n, (hist.get(n) ?? 0) + 1);
    }
    const share = (n: number) => (hist.get(n) ?? 0) / N;
    expect(share(0)).toBeGreaterThan(0.3);
    expect(share(2)).toBeGreaterThan(0.05);
    expect(share(6)).toBeLessThan(0.05);
  });

  it('символы не выходят за известный набор', () => {
    const rng = seeded(3);
    const ids = Object.keys(SCATTER_WEIGHTS);
    for (let i = 0; i < 5000; i++) expect(ids).toContain(scatterSymbol(rng));
  });

  it('подпись результата говорит о цепочке', () => {
    const rng = seeded(31);
    let checked = 0;
    for (let i = 0; i < 4000 && checked < 2; i++) {
      const out = resolveScatter(100, rng);
      if (out.combo >= 2) {
        expect(scatterLabel(out).text).toContain('цепочка');
        checked += 1;
      }
    }
    expect(checked).toBe(2);
    expect(scatterLabel({ ...resolveScatter(100, rng), kind: 'none' }).text).toContain('Мимо');
  });
});
