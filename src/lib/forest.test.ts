import { describe, expect, it } from 'vitest';
import {
  AXE_ENCHANTS,
  axeEnchCap,
  axeEnchCost,
  axeLevelOf,
  AXES,
  axeSharpCost,
  AXE_SHARP_MAX,
  avgLogValue,
  BOARD_MULT,
  buildTree,
  dropHit,
  fellBonus,
  forestMods,
  forestPlan,
  forestRankCost,
  LAST_PLOT,
  logRate,
  boardsForSale,
  boardsReserve,
  FOREST_START,
  freshForest,
  millCost,
  millLoad,
  MILL_MAX,
  millQueueCap,
  millRate,
  millTick,
  planCut,
  sumRow,
  takeBoards,
  NO_AXE_ENCH,
  normalizeForest,
  planBuyout,
  PLOT_OWN,
  rollChop,
  SPECIES,
  standHit,
} from './forest';
import type { AxeEnchants, AxeEnchId } from './forest';
import {
  HANDLES,
  modsOf,
  normalizePrison,
  PRISON_START,
  PROP_BOARDS,
  rankCost,
  streakLoot,
} from './prison';

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
 * дерева; Чутьё возвращает часть), топор покупает, когда он не дороже двух
 * с половиной разрядов, заточку — когда не дороже трети. Токены леса тратит
 * на чары топора с лучшей отдачей за токен, пилораму берёт, когда она не
 * дороже разряда с небольшим. План сдаёт вслепую: какая порода выросла, ту
 * и рубит.
 */
function runForest(opts: { until?: number; enchants?: boolean; mill?: boolean } = {}) {
  const until = opts.until ?? LAST_PLOT;
  const useEnch = opts.enchants ?? true;
  const useMill = opts.mill ?? true;
  const prison = normalizePrison({ ...PRISON_START });
  const ench: AxeEnchants = { ...NO_AXE_ENCH };
  let money = 0;
  let tokens = 0;
  let rank = 0;
  let axe = 0;
  let sharp = 0;
  let mill = 0;
  let plan = 0;
  let logs = 0;
  let t = 0;
  let last = 0;
  const took: number[] = [];
  const planLag: number[] = [];
  let measured = -1;

  const rates = (e: AxeEnchants) => {
    const fm = forestMods(prison, { ench: e });
    const n = 10 + rank * 0.7;
    // Замах и валка — лишние брёвна с удара, бурелом — лишние деревья.
    const perCut = (1 + fm.swing + fm.fell * (n / 2 - 1)) * (1 + fm.storm);
    const busy = 0.85 + 0.05 * (fm.dodge / 0.8);
    const lps = logRate(rank, axe, sharp, fm) * busy * perCut;
    const fell = (lps / n) * fellBonus(buildTree(rank, 1), rank).value;
    const sawn = useMill ? Math.min(lps, millRate(mill) / 60) : 0;
    const boards = sawn * avgLogValue(rank) * (BOARD_MULT - 1);
    // Щепа и руны добычи — лишние брёвна того же сорта.
    const perSec =
      (lps * avgLogValue(rank) * (1 + fm.loot) + fell + boards) *
      fm.sell *
      (1 + sessionStreak(lps));
    const own = lps * (rank > 0 ? PLOT_OWN : 1);
    // Токены: 5% брёвен по 1–3, сейд-сосна раз в тридцать деревьев.
    const tps = lps * fm.tokenChance * 2 + (lps / n / 30) * (40 + 8 * rank + 3 * n * 1.6);
    return { perSec, own, tps, lps };
  };

  while (rank < until && t < 10 * 3600) {
    const r = rates(ench);
    if (measured !== rank) {
      measured = rank;
      planLag.push(forestPlan(rank) / r.own / (forestRankCost(rank) / r.perSec));
    }
    money += r.perSec;
    tokens += r.tps;
    plan += r.own;
    logs += r.lps;
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
    if (useMill && mill < MILL_MAX && money >= millCost(mill) && millCost(mill) <= cost * 1.2) {
      money -= millCost(mill);
      mill += 1;
      continue;
    }
    if (useEnch) {
      const lvl = axeLevelOf(logs).level;
      let best: AxeEnchId | null = null;
      let bestGain = 0;
      for (const e of AXE_ENCHANTS) {
        const l = ench[e.id];
        if (l >= axeEnchCap(e.id, lvl)) continue;
        const c = axeEnchCost(e.id, l);
        if (c > tokens) continue;
        const up = rates({ ...ench, [e.id]: l + 1 });
        // Токены сами по себе — тоже отдача: Живица окупает остальные чары.
        const gain = (up.perSec / r.perSec - 1 + (up.tps / r.tps - 1) * 0.5) / c;
        if (gain > bestGain) {
          bestGain = gain;
          best = e.id;
        }
      }
      if (best) {
        tokens -= axeEnchCost(best, ench[best]);
        ench[best] += 1;
        continue;
      }
    }
    if (money >= cost && plan >= forestPlan(rank)) {
      money -= cost;
      rank += 1;
      plan = 0;
      took.push(t - last);
      last = t;
    }
  }
  return { t, took, rank, axe, sharp, mill, planLag, ench, logs, level: axeLevelOf(logs).level };
}

describe('темп лесоповала', () => {
  it('сравнение: чары и пилорама', () => {
    if (!process.env.PACE) return;
    for (const o of [
      { enchants: false, mill: false },
      { enchants: true, mill: false },
      { enchants: false, mill: true },
      { enchants: true, mill: true },
    ]) {
      const r = runForest(o);
      console.log(
        'LES-VAR',
        JSON.stringify(o),
        (r.t / 3600).toFixed(2),
        'ч',
        JSON.stringify(r.ench),
      );
    }
  });

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
        'пилорама',
        r.mill,
        'ур.',
        r.level,
        'чары',
        JSON.stringify(r.ench),
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

  it('чары топора и пилорама ускоряют лестницу, но не отменяют её', () => {
    const bare = runForest({ enchants: false, mill: false });
    const full = runForest();
    expect(full.t).toBeLessThan(bare.t);
    expect(full.t).toBeGreaterThan(bare.t * 0.7);
    // Пилорама окупается и без офлайна — иначе она ловушка для денег.
    expect(runForest({ enchants: false }).t).toBeLessThan(bare.t);
    expect(runForest({ mill: false }).t).toBeLessThan(bare.t);
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
      pile: { n: -5, value: 3, sp: [] },
      tree: { seed: 7, cut: 999 },
    });
    expect(s.rank).toBe(LAST_PLOT);
    expect(s.axe).toBe(0);
    expect(s.pile.n).toBe(0);
    expect(s.tree.cut).toBeLessThan(buildTree(LAST_PLOT, 7).logs.length);
    expect(normalizeForest(null).rank).toBe(0);
  });
});

describe('лесопилка', () => {
  const tree = buildTree(2, 17);
  const fm0 = forestMods(normalizePrison({ ...PRISON_START }));

  it('валка берёт всё дерево, замах — два бревна, бурелом — только когда дерево упало', () => {
    const always = () => 0;
    expect(planCut(tree, 0, { ...fm0, fell: 1 }, always)).toMatchObject({
      take: tree.logs.length,
      how: 'fell',
    });
    expect(planCut(tree, 0, { ...fm0, swing: 1 }, always)).toMatchObject({ take: 2, how: 'swing' });
    expect(planCut(tree, 0, { ...fm0, storm: 1 }, always).storm).toBe(false);
    const lastLog = tree.logs.length - 1;
    expect(planCut(tree, lastLog, { ...fm0, storm: 1, fell: 1, swing: 1 }, always)).toEqual({
      take: 1,
      how: 'one',
      storm: true,
    });
  });

  it('чары топора открываются уровнем топора, а он — брёвнами', () => {
    expect(axeLevelOf(0).level).toBe(1);
    expect(axeLevelOf(2000).level).toBeGreaterThan(axeLevelOf(200).level);
    for (const e of AXE_ENCHANTS) {
      expect(axeEnchCap(e.id, e.unlock - 1)).toBe(0);
      expect(axeEnchCap(e.id, e.unlock)).toBeGreaterThan(0);
      expect(axeEnchCap(e.id, 50)).toBe(e.max);
    }
  });

  it('пилорама пилит по часам, дорогие породы вперёд, остаток не теряется', () => {
    const mill = {
      level: 1,
      queue: [100, 0, 0, 5, 0, 0, 0, 0, 0, 0],
      boards: new Array(10).fill(0),
      at: 1_000,
      part: 0,
    };
    const perMin = millRate(1);
    // Полминуты: распилено perMin/2 брёвен, берёза (3) — первой.
    const half = millTick(mill, 1_000 + 30_000);
    expect(half.boards[3]).toBe(5);
    expect(half.boards[0]).toBe(Math.floor(perMin / 2) - 5);
    // Два шага по 7,5 с дают столько же, сколько один в 15 с.
    const a = millTick(millTick(mill, 8_500), 16_000);
    const b = millTick(mill, 16_000);
    expect(a.boards).toEqual(b.boards);
    // Очередь кончилась — дробь не копится впрок.
    const done = millTick(mill, 1_000 + 3_600_000);
    expect(sumRow(done.queue)).toBe(0);
    expect(done.part).toBe(0);
  });

  it('в пилораму уходит голая цена пород, надбавка за особые брёвна — сразу', () => {
    const pile = { n: 10, value: 10 * SPECIES[2].value + 500, sp: [0, 0, 10, 0, 0, 0, 0, 0, 0, 0] };
    const mill = {
      level: 1,
      queue: new Array(10).fill(0),
      boards: new Array(10).fill(0),
      at: 1,
      part: 0,
    };
    const r = millLoad(pile, mill);
    expect(r.loaded).toBe(10);
    expect(r.premium).toBe(500);
    expect(r.pile.n).toBe(0);
    expect(r.mill.queue[2]).toBe(10);
    // Очередь почти полна — берётся сколько влезет, остальное ждёт в штабеле.
    const full = { ...mill, queue: [millQueueCap(1) - 4, 0, 0, 0, 0, 0, 0, 0, 0, 0] };
    const r2 = millLoad(pile, full);
    expect(r2.loaded).toBe(4);
    expect(r2.pile.n).toBe(6);
    expect(r2.pile.value).toBe(6 * SPECIES[2].value);
  });

  it('крепь и продажа не трогают доски, отложенные на рукоять', () => {
    const boards = [30, 0, 0, 40, 0, 0, 0, 0, 0, 0];
    const reserve = boardsReserve(0);
    expect(reserve[HANDLES[0].species]).toBe(HANDLES[0].boards);
    expect(boardsForSale(boards, reserve)).toEqual([30, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(takeBoards(boards, PROP_BOARDS, reserve)).toEqual([10, 0, 0, 40, 0, 0, 0, 0, 0, 0]);
    // Не хватает свободных — берёт из запаса, а не отказывает.
    expect(takeBoards([5, 0, 0, 40, 0, 0, 0, 0, 0, 0], PROP_BOARDS, reserve)).toEqual([
      0, 0, 0, 25, 0, 0, 0, 0, 0, 0,
    ]);
    expect(takeBoards([5, 0, 0, 0, 0, 0, 0, 0, 0, 0], PROP_BOARDS, reserve)).toBeNull();
  });

  it('штабель из прошлой версии получает породы, пилорама — нули', () => {
    const s = normalizeForest({ rank: 4, pile: { n: 12, value: 300 } as never });
    expect(s.pile.sp[4]).toBe(12);
    expect(sumRow(s.pile.sp)).toBe(12);
    expect(s.mill.level).toBe(0);
    expect(s.ench.swing).toBe(0);
    const fresh = freshForest();
    expect(fresh.pile.sp).not.toBe(FOREST_START.pile.sp);
  });

  it('рукоять ускоряет и кирку, и топор', () => {
    const p = normalizePrison({ ...PRISON_START });
    const withHandle = { ...p, handle: 3 };
    expect(forestMods(withHandle).rate).toBeCloseTo(forestMods(p).rate * (1 + HANDLES[2].rate));
    expect(modsOf(withHandle).rate).toBeCloseTo(modsOf(p).rate * (1 + HANDLES[2].rate));
  });
});
