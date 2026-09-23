import { describe, expect, it } from 'vitest';
import {
  AXES,
  axeSharpCost,
  AXE_SHARP_MAX,
  avgLogValue,
  buildTree,
  dropHit,
  fellBonus,
  forestMods,
  forestPlan,
  forestRankCost,
  LAST_PLOT,
  logRate,
  normalizeForest,
  planBuyout,
  PLOT_OWN,
  rollChop,
  SPECIES,
  standHit,
} from './forest';
import { normalizePrison, PRISON_START, rankCost, streakLoot } from './prison';

const lcg = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

/** Средняя прибавка запала за смену в 8 минут при `lps` брёвен в секунду. */
function sessionStreak(lps: number, sec = 480): number {
  let sum = 0;
  for (let t = 0; t < sec; t++) sum += streakLoot(lps * t);
  return sum / sec;
}

/**
 * Лесоруб, который зарабатывает ТОЛЬКО лесом: рубит на удержании, сучья
 * ловит изредка (15% времени уходит на них, на сдачу штабеля и смену
 * дерева), топор покупает, когда он не дороже двух с половиной разрядов,
 * заточку — когда не дороже трети. План сдаёт вслепую: какая порода
 * выросла, ту и рубит.
 */
function runForest(opts: { until?: number } = {}) {
  const until = opts.until ?? LAST_PLOT;
  const fm = forestMods(normalizePrison({ ...PRISON_START }));
  let money = 0;
  let rank = 0;
  let axe = 0;
  let sharp = 0;
  let plan = 0;
  let t = 0;
  let last = 0;
  const took: number[] = [];
  const planLag: number[] = [];
  let measured = -1;
  while (rank < until && t < 10 * 3600) {
    const lps = logRate(rank, axe, sharp, fm) * 0.85;
    const logsPerTree = 10 + rank * 0.7;
    const fell = (lps / logsPerTree) * fellBonus(buildTree(rank, 1), rank).value;
    const perSec = (lps * avgLogValue(rank) + fell) * fm.sell * (1 + sessionStreak(lps));
    const ownPerSec = lps * (rank > 0 ? PLOT_OWN : 1);
    if (measured !== rank) {
      measured = rank;
      planLag.push(forestPlan(rank) / ownPerSec / (forestRankCost(rank) / perSec));
    }
    money += perSec;
    plan += ownPerSec;
    t += 1;
    const cost = forestRankCost(rank);
    const next = AXES[axe + 1];
    if (next && money >= next.price && next.price <= cost * 2.5) {
      money -= next.price;
      axe += 1;
      continue;
    }
    if (
      sharp < AXE_SHARP_MAX &&
      money >= axeSharpCost(sharp) &&
      axeSharpCost(sharp) <= cost * 0.35
    ) {
      money -= axeSharpCost(sharp);
      sharp += 1;
      continue;
    }
    if (money >= cost && plan >= forestPlan(rank)) {
      money -= cost;
      rank += 1;
      plan = 0;
      took.push(t - last);
      last = t;
    }
  }
  return { t, took, rank, axe, sharp, planLag };
}

describe('темп лесоповала', () => {
  it('первый разряд — за минуту-две', () => {
    const { took } = runForest({ until: 1 });
    if (process.env.PACE) console.log('LES first', took[0]);
    expect(took[0]).toBeGreaterThan(30);
    expect(took[0]).toBeLessThanOrEqual(150);
  });

  it('вся лестница — примерно час на одном лесе, не пять минут и не вечер', () => {
    const r = runForest();
    if (process.env.PACE)
      console.log(
        'LES',
        (r.t / 3600).toFixed(2),
        'ч; топор',
        r.axe,
        'заточка',
        r.sharp,
        'по разрядам',
        r.took.map((x) => Math.round(x / 60)).join(' '),
        'план',
        r.planLag.map((x) => x.toFixed(2)).join(' '),
      );
    expect(r.rank).toBe(LAST_PLOT);
    expect(r.t / 3600).toBeGreaterThan(0.6);
    expect(r.t / 3600).toBeLessThan(2);
    expect(Math.max(...r.took) / 60).toBeLessThan(20);
  });

  it('план ощутим, но не стена', () => {
    const { planLag } = runForest();
    const felt = planLag.filter((x) => x > 1).length;
    expect(felt).toBeGreaterThanOrEqual(Math.floor(planLag.length / 3));
    expect(Math.max(...planLag)).toBeLessThan(2);
    expect(Math.min(...planLag)).toBeGreaterThan(0.4);
  });

  it('последний разряд соразмерен концу шахты, а не копейкам и не миллиардам', () => {
    const top = forestRankCost(LAST_PLOT - 1);
    expect(top).toBeGreaterThan(rankCost(15));
    expect(top).toBeLessThan(rankCost(24) * 1.5);
  });
});

describe('дерево и рубка', () => {
  it('дерево собирается из зерна одинаково, первые два бревна без сучьев', () => {
    expect(buildTree(4, 99)).toEqual(buildTree(4, 99));
    for (let seed = 1; seed < 300; seed++) {
      const t = buildTree(3, seed);
      expect(t.logs[0].branch).toBeNull();
      expect(t.logs[1].branch).toBeNull();
      expect(t.logs.length).toBeGreaterThanOrEqual(8);
      // Капокорень — только комель.
      t.logs.forEach((l, i) => i > 0 && expect(l.kind).not.toBe('burl'));
    }
  });

  it('на делянке растёт своя порода, прошлая и изредка следующая', () => {
    const seen = new Map<number, number>();
    for (let seed = 1; seed < 3000; seed++) {
      const s = buildTree(5, seed).species;
      seen.set(s, (seen.get(s) ?? 0) + 1);
    }
    expect([...seen.keys()].sort()).toEqual([4, 5, 6]);
    expect(seen.get(5)!).toBeGreaterThan(seen.get(4)!);
    expect(seen.get(6)!).toBeLessThan(seen.get(4)! / 5);
  });

  it('сучок бьёт только того, кто на его стороне', () => {
    const tree = {
      species: 0,
      seid: false,
      logs: [
        { kind: 'plain' as const, branch: null },
        { kind: 'plain' as const, branch: 'L' as const },
        { kind: 'plain' as const, branch: null },
      ],
    };
    expect(dropHit(tree, 0, 'L')).toBe(true);
    expect(dropHit(tree, 0, 'R')).toBe(false);
    expect(standHit(tree, 1, 'L')).toBe(true);
    expect(standHit(tree, 1, 'R')).toBe(false);
  });

  it('дерево всегда можно срубить чисто: у каждого бревна есть безопасная сторона', () => {
    for (let plot = 0; plot <= LAST_PLOT; plot++) {
      for (let seed = 1; seed < 400; seed++) {
        const t = buildTree(plot, seed);
        for (let cut = 0; cut < t.logs.length; cut++) {
          // Сторона, на которой не налетишь на сучок нижнего и на которую не
          // упадёт сучок следующего.
          const safe = (['L', 'R'] as const).some(
            (s) => !standHit(t, cut, s) && !dropHit(t, cut, s),
          );
          expect(safe).toBe(true);
        }
      }
    }
  });

  it('дупло — всегда награда, чага — только на берёзах', () => {
    const rnd = lcg(4);
    const fm = forestMods(normalizePrison({ ...PRISON_START }));
    const tree = { species: 3, seid: false, logs: [{ kind: 'hollow' as const, branch: null }] };
    for (let i = 0; i < 200; i++) expect(rollChop(tree, 0, fm, rnd).hollow).not.toBeNull();
    for (let seed = 1; seed < 2000; seed++) {
      const t = buildTree(6, seed);
      if (t.species !== 3 && t.species !== 9)
        for (const l of t.logs) expect(l.kind).not.toBe('chaga');
    }
  });

  it('породы дорожают по делянкам, план и откуп считаются', () => {
    for (let i = 1; i < SPECIES.length; i++) {
      expect(SPECIES[i].value).toBeGreaterThan(SPECIES[i - 1].value);
      expect(SPECIES[i].hp).toBeGreaterThanOrEqual(SPECIES[i - 1].hp);
    }
    const need = forestPlan(3);
    expect(planBuyout(3, need)).toBe(0);
    expect(planBuyout(3, Math.floor(need / 2))).toBeLessThan(planBuyout(3, 0));
  });

  it('битое сохранение леса чинится', () => {
    const s = normalizeForest({
      rank: 99,
      axe: -1,
      pile: { n: -5, value: 3 },
      tree: { seed: 7, cut: 999 },
    });
    expect(s.rank).toBe(LAST_PLOT);
    expect(s.axe).toBe(0);
    expect(s.pile.n).toBe(0);
    expect(s.tree.cut).toBeLessThan(buildTree(LAST_PLOT, 7).logs.length);
    expect(normalizeForest(null).rank).toBe(0);
  });
});
