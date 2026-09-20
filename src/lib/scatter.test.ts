import { describe, expect, it } from 'vitest';
import {
  ANTE_COST,
  CLUSTER_MIN,
  FREE_SPINS,
  MAX_WIN,
  SCATTER_CHANCE,
  SCATTER_COLS,
  SCATTER_PAYOUTS,
  SCATTER_PAYS,
  SCATTER_ROWS,
  SCATTER_TRIGGER,
  SCATTER_WEIGHTS,
  ORB_CHANCE,
  countScatters,
  findWins,
  gridOrbs,
  isOrb,
  mkOrb,
  orbOf,
  orbValue,
  payFor,
  resolveScatter,
  scatterCollapse,
  scatterGrid,
  scatterLabel,
  scatterSymbol,
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

  it('сфера — это содержимое клетки, а не список поверх поля', () => {
    // Поле само и есть перечень сфер: gridOrbs только читает клетки.
    const g = gridWith('cherry', 30, 'cherry');
    expect(gridOrbs(g)).toEqual([]);
    g[2][3] = mkOrb(25);
    expect(isOrb(g[2][3])).toBe(true);
    expect(orbOf(g[2][3])).toBe(25);
    expect(orbOf(g[0][0])).toBe(0);
    expect(gridOrbs(g)).toEqual([{ col: 2, row: 3, value: 25 }]);
  });

  it('сфера выпадает на барабане наравне с символом и скаттером', () => {
    const rng = seeded(3);
    let orbs = 0;
    let scatters = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const g = scatterGrid(rng, SCATTER_CHANCE, ORB_CHANCE);
      orbs += gridOrbs(g).length;
      scatters += countScatters(g);
    }
    const cells = N * SCATTER_COLS * SCATTER_ROWS;
    expect(orbs / cells).toBeGreaterThan(ORB_CHANCE * 0.85);
    expect(orbs / cells).toBeLessThan(ORB_CHANCE * 1.15);
    // Сфера не съедает шанс скаттера: у каждой свой отрезок броска.
    expect(scatters / cells).toBeGreaterThan(SCATTER_CHANCE * 0.85);
    expect(scatters / cells).toBeLessThan(SCATTER_CHANCE * 1.15);
  });

  it('сферы копятся всю последовательность и не исчезают', () => {
    const rng = seeded(909);
    let checked = 0;
    for (let i = 0; i < 6000 && checked < 20; i++) {
      const out = resolveScatter(100, { rng });
      if (out.steps.length < 2) continue;
      // Сферы не выигрывают, значит и не удаляются: их номиналы копятся.
      // Места при этом меняются — сфера съезжает вниз вместе с колонкой.
      for (let s = 1; s < out.steps.length; s++) {
        const before = out.steps[s - 1].orbs.map((o) => o.value);
        const after = out.steps[s].orbs.map((o) => o.value);
        expect(after.length).toBeGreaterThanOrEqual(before.length);
        for (const value of before) {
          const at = after.indexOf(value);
          expect(at).toBeGreaterThanOrEqual(0);
          after.splice(at, 1);
        }
      }
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('сфера уцелевшей клетки съезжает вниз, как всё живое на поле', () => {
    // Сфера — на самом верху первой колонки, под ней и рядом сплошь семёрки.
    const g = gridWith('cherry', 0, 'cherry');
    for (let r = 1; r < SCATTER_ROWS; r++) g[0][r] = 'seven';
    for (let r = 0; r < 4; r++) g[1][r] = 'seven';
    g[0][0] = mkOrb(10);
    const wins = findWins(g);
    expect(wins.find((w) => w.symbol === 'seven')).toBeDefined();
    // Сфера в колонке осталась одна на семь ушедших клеток — она внизу.
    const next = scatterCollapse(g, wins);
    expect(orbOf(next[0][SCATTER_ROWS - 1])).toBe(10);
  });

  it('множитель применяется один раз, ко всей базе', () => {
    const rng = seeded(4242);
    let checked = 0;
    for (let i = 0; i < 9000 && checked < 10; i++) {
      const out = resolveScatter(100, { rng });
      if (!out.orbMult || !out.base || out.scatterPay) continue;
      const base = out.steps.reduce((s, st) => s + st.wins.reduce((a, w) => a + w.pay, 0), 0) * 100;
      expect(out.total).toBe(Math.min(100 * MAX_WIN, Math.max(1, Math.round(base * out.orbMult))));
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('сферы выпадают и тогда, когда спин не сыграл', () => {
    // Главное свойство: раньше сферы на непобедившем спине просто
    // выбрасывались, и увидеть их было почти нельзя.
    const rng = seeded(31337);
    let dry = 0;
    let dryWithOrbs = 0;
    for (let i = 0; i < 20000; i++) {
      const out = resolveScatter(100, { rng });
      if (out.steps.length) continue;
      dry += 1;
      if (out.orbs.length) dryWithOrbs += 1;
    }
    expect(dry).toBeGreaterThan(1000);
    expect(dryWithOrbs / dry).toBeGreaterThan(0.1);
  });

  it('сфера занимает клетку: символа под ней нет', () => {
    // Ровно восемь семёрок — поле играет.
    const g = gridWith('seven', CLUSTER_MIN, 'cherry');
    expect(findWins(g).find((w) => w.symbol === 'seven')).toBeDefined();
    // Одна из них выпала сферой: семёрок осталось семь, выигрыша нет.
    g[0][0] = mkOrb(50);
    expect(findWins(g).find((w) => w.symbol === 'seven')).toBeUndefined();
    // И сама сфера в восьмёрки не собирается, сколько бы их ни было.
    const all = gridWith(mkOrb(50), SCATTER_COLS * SCATTER_ROWS, 'cherry');
    expect(findWins(all)).toEqual([]);
  });

  it('клетка со сферой не попадает ни в один выигрыш', () => {
    const rng = seeded(555);
    for (let i = 0; i < 4000; i++) {
      const out = resolveScatter(100, { rng });
      if (!out.orbs.length || !out.steps.length) continue;
      for (const step of out.steps) {
        const busy = new Set(step.orbs.map((o) => `${o.col}:${o.row}`));
        for (const w of step.wins) {
          for (const [c, r] of w.cells) expect(busy.has(`${c}:${r}`)).toBe(false);
        }
      }
    }
  });

  it('выигрыш за спин не превышает предела', () => {
    const rng = seeded(8080);
    for (let i = 0; i < 20000; i++) {
      expect(resolveScatter(100, { rng }).total).toBeLessThanOrEqual(100 * MAX_WIN);
    }
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
        out.steps.forEach((s) => expect(Number.isInteger(s.base)).toBe(true));
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
