import { describe, expect, it } from 'vitest';
import {
  bagValue,
  blockRate,
  buildMine,
  enchantCost,
  enchantRefund,
  ENCHANTS,
  modsOf,
  NO_ENCHANTS,
  rollDrops,
  sellMult,
  stash,
  veinCells,
  blastCells,
  BASE_MODS,
  caseCoinShare,
  crewCost,
  crewYield,
  FINDS,
  findsMult,
  normalizePrison as norm,
  perkPointsFree,
  PRISON_START,
  rollCase,
  rollFind,
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
import type { EnchantId, Enchants } from './prison';
import { MAX_BET } from './slots';

/**
 * Игрок, который держит палец на клетке и тратит деньги разумно: кирку
 * берёт, когда она не дороже двух с половиной рангов, заточку — когда она
 * не дороже трети ранга. Токены тратит на зачарование, которое сильнее
 * всего поднимает доход за токен. 8% времени уходит на продажу и переходы.
 */
function run(opts: { buyPicks?: boolean; until?: number; enchants?: boolean } = {}) {
  const until = opts.until ?? LAST_RANK;
  let money = 0;
  let tokens = 0;
  let rank = 0;
  let pick = 0;
  let sharp = 0;
  const ench: Enchants = { ...NO_ENCHANTS };
  let t = 0;
  let last = 0;
  const took: number[] = [];
  const income = (e: Enchants) => incomeRate(rank, pick, sharp, modsOf({ ench: e, prestige: 0 }));
  while (rank < until && t < 30 * 3600) {
    const m = modsOf({ ench, prestige: 0 });
    money += income(ench) * 0.92;
    tokens += blockRate(rank, pick, sharp, m) * 0.92 * m.tokenChance * 2;
    t += 1;
    if (opts.enchants !== false && t % 20 === 0) {
      // Лучшее зачарование за токен из тех, что двигают доход; Токенист —
      // пока дешёвый, он окупается токенами.
      let best: EnchantId | null = null;
      let bestGain = 0;
      const now = income(ench);
      for (const e of ENCHANTS) {
        if (ench[e.id] >= e.max) continue;
        const cost = enchantCost(e.id, ench[e.id]);
        if (cost > tokens) continue;
        const next = { ...ench, [e.id]: ench[e.id] + 1 };
        let gain = (income(next) - now) / cost;
        if (e.id === 'token' && ench.token < 5) gain = Infinity;
        if (gain > bestGain) {
          bestGain = gain;
          best = e.id;
        }
      }
      if (best) {
        tokens -= enchantCost(best, ench[best]);
        ench[best] += 1;
      }
    }
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
  return { t, took, pick, rank, ench };
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
    const good = incomeRate(20, 3, 10, BASE_MODS);
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
    expect(bagValue(bag, sellMult(2))).toBe(Math.round(base * 1.5));
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

describe('зачарования и добыча', () => {
  it('цена уровня растёт, сброс возвращает ровно половину', () => {
    for (const e of ENCHANTS) {
      expect(enchantCost(e.id, 1)).toBeGreaterThan(enchantCost(e.id, 0));
      let spent = 0;
      for (let i = 0; i < 5; i++) spent += enchantCost(e.id, i);
      expect(enchantRefund(e.id, 5)).toBe(Math.floor(spent / 2));
    }
  });

  it('Удача даёт лишние блоки в среднем ровно столько, сколько обещает', () => {
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const m = modsOf({ ench: { ...NO_ENCHANTS, fortune: 10 }, prestige: 0 });
    const n = 20000;
    const d = rollDrops(new Array<number>(n).fill(3), m, rnd);
    expect(d.units.length / n).toBeGreaterThan(1 + m.fortune - 0.03);
    expect(d.units.length / n).toBeLessThan(1 + m.fortune + 0.03);
    // Токены — около 5% блоков по 1–3.
    expect(d.tokens / n).toBeGreaterThan(0.08);
    expect(d.tokens / n).toBeLessThan(0.12);
  });

  it('Кураж удваивает добычу', () => {
    const rnd = () => 0.99;
    const d = rollDrops([1, 2], BASE_MODS, rnd, { frenzy: true });
    expect(d.units).toEqual([1, 1, 2, 2]);
  });

  it('рюкзак: без вагонетки лишнее пропадает, с вагонеткой продаётся', () => {
    const lost = stash({ 0: 9 }, [0, 0, 0], 10, false, 1);
    expect(lost.taken).toBe(1);
    expect(lost.lost).toBe(2);
    const cart = stash({ 0: 9 }, [0, 0, 0], 10, true, 1);
    expect(cart.sold).toBe(10 * ROCKS[0].value);
    expect(cart.bag).toEqual({ 0: 2 });
    expect(cart.lost).toBe(0);
  });

  it('жила идёт только по той же породе сверху и не больше предела', () => {
    const rocks = new Array<number>(MINE_CELLS * DEPTH).fill(1);
    // Верхний ярус: ряд из пяти «пятёрок» в середине поля.
    for (let x = 1; x <= 5; x++) rocks[4 * 7 + x] = 5;
    const dug = new Array<number>(MINE_CELLS).fill(0);
    const v = veinCells(rocks, dug, 4 * 7 + 1, 5, 10);
    expect(v.sort((a, b) => a - b)).toEqual([30, 31, 32, 33]);
    expect(veinCells(rocks, dug, 4 * 7 + 1, 5, 2).length).toBe(2);
  });

  it('взрыв у края не выходит за поле', () => {
    expect(blastCells(0, 1).sort((a, b) => a - b)).toEqual([0, 1, 7, 8]);
    expect(blastCells(31, 2).length).toBe(25);
  });
});

describe('сундуки, находки, бригада, перки', () => {
  const lcg = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

  it('сундук в среднем платит монетами несколько процентов цены ранга', () => {
    // Ключей ~8 в час: сундуки — приятная добавка, а не второй доход.
    const ev = caseCoinShare();
    expect(ev).toBeGreaterThan(0.02);
    expect(ev).toBeLessThan(0.07);
  });

  it('находка из сундука — только недостающая и доступная по шахте', () => {
    const rnd = lcg(7);
    const finds = { coin: 1 } as const;
    for (let i = 0; i < 3000; i++) {
      const r = rollCase({ rank: 5, prestige: 0, finds }, rnd);
      if (r.reward.kind === 'find') {
        expect(r.reward.id).not.toBe('coin');
        expect(
          FINDS.find((f) => f.id === (r.reward as { id: string }).id)!.from,
        ).toBeLessThanOrEqual(5);
      }
      if (r.reward.kind === 'coins') expect(r.reward.amount).toBeGreaterThan(0);
    }
  });

  it('в шахте A не найти лампу забойщика', () => {
    const rnd = lcg(3);
    for (let i = 0; i < 2000; i++) expect(rollFind(0, rnd)).toBe('coin');
  });

  it('полная коллекция даёт +22% к продаже', () => {
    const all = Object.fromEntries(FINDS.map((f) => [f.id, 1]));
    expect(findsMult(all)).toBeCloseTo(1.22, 9);
    expect(findsMult({})).toBe(1);
  });

  it('бригада упирается в потолок смены и отдаёт долю', () => {
    const p = norm({ ...PRISON_START, rank: 10, crew: 2, crewFrom: 1_000_000 });
    const h = 3600_000;
    const at4 = crewYield(p, 1_000_000 + 4 * h);
    const at20 = crewYield(p, 1_000_000 + 20 * h);
    expect(at4.capped).toBe(false);
    expect(at20.capped).toBe(true);
    expect(at20.minutes).toBe(8 * 60);
    expect(at20.blocks).toBeGreaterThan(at4.blocks);
    const perk = norm({ ...p, prestige: 2, perks: { ...p.perks, shift: 4 } });
    expect(crewYield(perk, 1_000_000 + 20 * h).minutes).toBe(12 * 60);
    expect(crewCost(1)).toBeGreaterThan(crewCost(0));
  });

  it('очки перков: два за престиж', () => {
    const p = norm({ ...PRISON_START, prestige: 3 });
    expect(perkPointsFree(p)).toBe(6);
    expect(perkPointsFree({ ...p, perks: { ...p.perks, dealer: 2, blat: 1 } })).toBe(3);
  });
});
