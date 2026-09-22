import { describe, expect, it } from 'vitest';
import {
  bagValue,
  buildMine,
  DEPTH,
  incomeRate,
  LAST_RANK,
  MINE_CELLS,
  mineMix,
  minedShare,
  nice,
  normalizePrison,
  PICKS,
  rankCost,
  ROCKS,
  sharpCost,
  SHARP_MAX,
} from './prison';
import { MAX_BET } from './slots';

/**
 * Игрок, который держит палец на клетке и тратит деньги разумно: кирку
 * берёт, когда она не дороже двух с половиной рангов, заточку — когда она
 * не дороже трети ранга. 8% времени уходит на продажу и переходы.
 */
function run(opts: { buyPicks?: boolean; until?: number } = {}) {
  const until = opts.until ?? LAST_RANK;
  let money = 0;
  let rank = 0;
  let pick = 0;
  let sharp = 0;
  let t = 0;
  let last = 0;
  const took: number[] = [];
  while (rank < until && t < 30 * 3600) {
    money += incomeRate(rank, pick, sharp) * 0.92;
    t += 1;
    const cost = rankCost(rank);
    const next = PICKS[pick + 1];
    if (opts.buyPicks !== false && next && money >= next.price && next.price <= cost * 2.5) {
      money -= next.price;
      pick += 1;
      continue;
    }
    if (sharp < SHARP_MAX && money >= sharpCost(sharp) && sharpCost(sharp) <= cost * 0.35) {
      money -= sharpCost(sharp);
      sharp += 1;
      continue;
    }
    if (money >= cost) {
      money -= cost;
      rank += 1;
      took.push(t - last);
      last = t;
    }
  }
  return { t, took, pick, rank };
}

describe('темп каторги', () => {
  it('первый ранг — за минуту-две', () => {
    const { took } = run({ until: 1 });
    expect(took[0]).toBeGreaterThan(30);
    expect(took[0]).toBeLessThanOrEqual(120);
  });

  it('A→Z — вечер-другой, а не неделя и не полчаса', () => {
    const { t, rank } = run();
    expect(rank).toBe(LAST_RANK);
    expect(t / 3600).toBeGreaterThan(2);
    expect(t / 3600).toBeLessThan(5);
  });

  it('ни один ранг не тянется дольше получаса', () => {
    const { took } = run();
    expect(Math.max(...took) / 60).toBeLessThan(30);
  });

  it('без кузницы глубокие шахты не потянуть', () => {
    // Честная кирка обязана быть выгоднее, чем «докопаться ржавой».
    const rusty = incomeRate(20, 0, 0);
    const good = incomeRate(20, 3, 10);
    expect(good / rusty).toBeGreaterThan(10);
  });

  it('ранг Z соразмерен мега-выигрышу на максимальной ставке', () => {
    // Деньги общие с автоматами: крупный занос должен ощущаться рывком в
    // шахте, а не мелочью и не всем её прохождением.
    const z = rankCost(LAST_RANK - 1);
    expect(z).toBeGreaterThanOrEqual(MAX_BET * 200);
    expect(z).toBeLessThanOrEqual(MAX_BET * 1000);
  });
});

describe('состав шахты', () => {
  it('доли складываются в единицу, пород не больше пяти, новая — редкая', () => {
    for (let m = 0; m <= LAST_RANK; m++) {
      const mix = mineMix(m);
      expect(mix.length).toBeLessThanOrEqual(5);
      expect(mix.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1, 9);
      if (m >= 4) expect(mix.find((x) => x.rock === m)?.share).toBeCloseTo(0.05, 9);
    }
  });

  it('поле собирается из зерна одинаково', () => {
    expect(buildMine(7, 12345)).toEqual(buildMine(7, 12345));
    expect(buildMine(7, 12345)).not.toEqual(buildMine(7, 12346));
  });

  it('в шахте только её породы; порода следующей — только на дне', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const m = 10;
      const rocks = buildMine(m, seed);
      expect(rocks.length).toBe(MINE_CELLS * DEPTH);
      rocks.forEach((r, i) => {
        expect(r).toBeGreaterThanOrEqual(m - 4);
        expect(r).toBeLessThanOrEqual(m + 1);
        if (r === m + 1) expect(Math.floor(i / MINE_CELLS)).toBe(DEPTH - 1);
      });
    }
  });

  it('глубже — богаче', () => {
    let top = 0;
    let bottom = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const rocks = buildMine(12, seed);
      for (let c = 0; c < MINE_CELLS; c++) {
        top += ROCKS[rocks[c]].value;
        bottom += ROCKS[rocks[(DEPTH - 1) * MINE_CELLS + c]].value;
      }
    }
    expect(bottom / top).toBeGreaterThan(1.12);
  });

  it('выработка считается по ярусам', () => {
    const dug = new Array<number>(MINE_CELLS).fill(0);
    expect(minedShare(dug)).toBe(0);
    dug.fill(DEPTH);
    expect(minedShare(dug)).toBe(1);
  });
});

describe('цены и сохранение', () => {
  it('ранги дорожают монотонно и круглыми числами', () => {
    for (let r = 1; r < LAST_RANK; r++) expect(rankCost(r)).toBeGreaterThan(rankCost(r - 1));
    expect(nice(1793)).toBe(1800);
    expect(nice(254)).toBe(250);
    expect(nice(42)).toBe(42);
  });

  it('престиж прибавляет к продаже', () => {
    const bag = { 0: 10, 5: 2 };
    const base = ROCKS[0].value * 10 + ROCKS[5].value * 2;
    expect(bagValue(bag)).toBe(base);
    expect(bagValue(bag, 2)).toBe(Math.round(base * 1.5));
  });

  it('битое сохранение чинится по полям', () => {
    const s = normalizePrison({
      rank: 99,
      pick: -3,
      sharp: 1.6,
      bag: { 0: 5, 99: 3, x: 1 } as never,
      mine: { id: 50, seed: 7, dug: [1, 2] },
    });
    expect(s.rank).toBe(LAST_RANK);
    expect(s.pick).toBe(0);
    expect(s.sharp).toBe(2);
    expect(s.bag).toEqual({ 0: 5 });
    // Шахта выше ранга не открыта; поле неверной длины — новое.
    expect(s.mine.id).toBeLessThanOrEqual(s.rank);
    expect(s.mine.dug.length).toBe(MINE_CELLS);
    expect(normalizePrison(null).rank).toBe(0);
  });
});
