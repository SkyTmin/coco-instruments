import { describe, expect, it } from 'vitest';
import {
  BAT_COINS,
  BAT_GAP_MS,
  BAT_PER_BLOCK,
  BAT_RARE,
  BAT_RARE_MULT,
  batTokens,
} from './critters';
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
  pickOpen,
  rankCost,
  rankLetter,
  ROCKS,
  sharpCost,
  SHARP_MAX,
  TOKEN_CHANCE,
} from './prison';
import type { CaseTier, EnchantId, Enchants, Parcel, PetId, Pets, Rune } from './prison';
import {
  applyReward,
  bonusOf,
  BONUS_CAP,
  fusePlan,
  MILES,
  mileReady,
  PARCEL_NEED,
  PARCEL_SLOTS,
  PETS,
  petLevelOf,
  PET_LEVEL_MAX,
  rollParcel,
  rollRune,
  rollTier,
  RUNE_BAG,
  RUNE_SHATTER,
  RUNE_TIERS,
  RUNES,
  runePower,
  seidPerBlock,
  seidReward,
  seidsOf,
  seidTop,
  SEID_HITS,
  socketsOpen,
} from './prison';
import {
  decayStreak,
  enchantCap,
  pickLevelOf,
  rankWork,
  rankBlocks,
  rankNeeds,
  blocksOf,
  feedForge,
  forgeFromBag,
  forgeReady,
  rockShare,
  STREAK_GRACE_MS,
  STREAK_DECAY_MS,
  STREAK_TIERS,
  streakLoot,
  streakTier,
} from './prison';
import { BLOCK_PRICE, blocksPerField, RANK_PRICE, RANK_WORK } from './economy';

/** Средняя прибавка запала за смену в 8 минут при `bps` блоков в секунду. */
function sessionStreak(bps: number, sec = 480): number {
  let sum = 0;
  for (let t = 0; t < sec; t++) sum += streakLoot(bps * t);
  return sum / sec;
}

/** Детерминированный ГСЧ для симуляции: темп не должен зависеть от удачи прогона. */
const lcg = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

/**
 * Игрок, который держит палец на клетке и тратит деньги разумно: кирку
 * заказывает, как только кузня её откроет и монеты на неё есть (руду
 * заказа добирает в той шахте, где её больше всего), заточку берёт, когда
 * она не дороже трети ранга. Токены тратит на зачарование, которое сильнее
 * всего поднимает доход за токен, — из тех, что уже открыл уровень кирки.
 * Копает сменами по 8 минут (запал), 8% времени уходит на продажу и
 * переходы. Породу НЕ выбирает — копает вслепую, поэтому норму добирает в
 * среднем по доле породы в шахте.
 *
 * С v2.49 он ещё вскрывает посылки, носит лучшие руны (сплавляя тройки)
 * и водит самого выгодного питомца — всё, что множит доход, обязано
 * пройти через этот прогон, иначе темп в тесте врёт.
 */
function run(
  opts: {
    buyPicks?: boolean;
    until?: number;
    enchants?: boolean;
    loot?: boolean;
    seed?: number;
  } = {},
) {
  const until = opts.until ?? LAST_RANK;
  const loot = opts.loot !== false;
  const rnd = lcg(opts.seed ?? 20260922);
  let money = 0;
  let tokens = 0;
  let rank = 0;
  let pick = 0;
  let sharp = 0;
  let xp = 0;
  let inRank = 0;
  const ench: Enchants = { ...NO_ENCHANTS };
  let runes: Rune[] = [];
  let seq = 0;
  let sockets = [0, 0, 0, 0];
  const pets: Pets = {};
  let pet = null as PetId | null;
  const parcels: Parcel[] = [];
  let parcelAcc = 0;
  let t = 0;
  let last = 0;
  const took: number[] = [];
  /**
   * Во сколько раз набрать выработку дольше, чем накопить на ранг с нуля
   * (мерится в момент входа в ранг, без переноса денег с прошлого).
   */
  const quotaLag: number[] = [];
  let work = 0;
  let oreBlocks = 0;
  let order: { pick: number; have: Record<number, number> } | null = null;
  let oldMineSec = 0;
  const pickAt: string[] = [];
  /** Сколько секунд от входа в ранг до денег и до выработки. */
  const tCoin: number[] = [];
  const tWork: number[] = [];
  /** Сколько монет пришло за ранг (без трат) — средний доход ранга. */
  const gained: number[] = [];
  const workBy: number[] = [];
  /** Заказ кирки: когда оплачен и когда готов (секунды). */
  const orderAt: number[] = [];
  const readyAt: number[] = [];
  let measured = -1;
  const src = (e: Enchants) => ({
    ench: e,
    prestige: 0,
    pickXp: xp,
    runes,
    sockets,
    pets,
    pet,
  });
  const mods = (e: Enchants) => modsOf(src(e));
  const income = (e: Enchants, mine = rank) => incomeRate(mine, pick, sharp, mods(e));
  /** Руны в гнёзда: жадно, по приросту дохода; питомец — самый выгодный. */
  const equip = () => {
    const open = socketsOpen({ pickXp: xp });
    const chosen: number[] = [];
    for (let s = 0; s < open; s++) {
      let best = 0;
      let bestInc = -1;
      for (const r of runes) {
        if (chosen.includes(r.id)) continue;
        sockets = [...chosen, r.id, 0, 0, 0].slice(0, 4);
        const inc = income(ench);
        if (inc > bestInc) {
          bestInc = inc;
          best = r.id;
        }
      }
      if (best) chosen.push(best);
    }
    sockets = [...chosen, 0, 0, 0, 0].slice(0, 4);
    let bestPet: PetId | null = pet;
    let bestInc = income(ench);
    for (const id of Object.keys(pets) as PetId[]) {
      pet = id;
      const inc = income(ench);
      if (inc > bestInc) {
        bestInc = inc;
        bestPet = id;
      }
    }
    pet = bestPet;
  };
  /** Сплавить тройки: самую сильную руну ступени — с двумя слабейшими. */
  const fuse = () => {
    for (let tier = 1; tier < RUNE_TIERS; tier++) {
      for (;;) {
        const same = runes
          .filter((r) => r.tier === tier)
          .sort((a, b) => runePower(b) - runePower(a));
        if (same.length < 3) break;
        const [base, ,] = same;
        const weak = same.slice(-2);
        const floor = (base.roll + weak[0].roll + weak[1].roll) / 3;
        runes = runes.filter((r) => r.id !== base.id && !weak.some((w) => w.id === r.id));
        runes.push({
          id: ++seq,
          kind: base.kind,
          tier: tier + 1,
          roll: Math.max(floor, rnd() * 100),
        });
      }
    }
  };
  let opened = 0;
  const open = (tier: CaseTier) => {
    opened += 1;
    const r = rollParcel({ rank, prestige: 0, pets }, tier, rnd);
    if (r.kind === 'coins') money += r.amount;
    else if (r.kind === 'tokens') tokens += r.amount;
    else if (r.kind === 'rune') runes.push({ ...r.rune, id: ++seq });
    else if (r.kind === 'pet') pets[r.id] = 0;
    else if (r.kind === 'treat' && pet) pets[pet] = (pets[pet] ?? 0) + r.amount;
  };
  while (rank < until && t < 30 * 3600) {
    const m = mods(ench);
    // Заказ кузнице просит руду, которой на этом этаже нет, — идём за ней
    // на её этаж (там её больше всего), доход и выработка идут и там.
    let mine = rank;
    let want = -1;
    if (order) {
      const left = PICKS[order.pick].ore.filter(([r, n]) => (order!.have[r] ?? 0) < n);
      const here = left.find(([r]) => rockShare(rank, r) >= 0.5);
      want = (here ?? left[0])?.[0] ?? -1;
      // Своя руда этажа — копаем здесь; руда прошлых этажей — на её этаже,
      // где её больше всего и порода мягче.
      if (want >= 0 && rockShare(rank, want) < 0.5) mine = want;
    }
    if (mine !== rank) oldMineSec += 1;
    const bps = blockRate(mine, pick, sharp, m) * 0.92;
    let perSec = income(ench, mine) * 0.92 * (1 + sessionStreak(bps));
    if (order && want >= 0) {
      // Руда заказа идёт мимо рюкзака — её цена выпадает из дохода.
      const need = PICKS[order.pick].ore.find(([r]) => r === want)![1];
      const units = bps * (1 + m.fortune) * rockShare(mine, want);
      const take = Math.min(units, need - (order.have[want] ?? 0));
      order.have[want] = (order.have[want] ?? 0) + take;
      perSec -= take * ROCKS[want].value * m.sell;
      if (PICKS[order.pick].ore.every(([r, n]) => (order!.have[r] ?? 0) >= n - 1e-9)) {
        pick = order.pick;
        sharp = 0;
        order = null;
        pickAt.push(`${pick}@${rank}`);
        readyAt[pick] = t;
      }
    }
    if (measured !== rank) {
      measured = rank;
      const coinTime = rankCost(rank) / perSec;
      quotaLag.push(rankWork(rank) / bps / coinTime);
    }
    money += perSec;
    gained[rank] = (gained[rank] ?? 0) + perSec;
    work += bps;
    workBy[rank] = (workBy[rank] ?? 0) + bps;
    // Блоки этажа: платят сразу; в условие ранга — только своего этажа.
    const fb = (bps * blocksPerField(mine)) / MINE_CELLS / DEPTH;
    money += fb * BLOCK_PRICE[mine] * m.sell;
    gained[rank] += fb * BLOCK_PRICE[mine] * m.sell;
    if (mine === rank) oreBlocks += fb;
    tokens += bps * m.tokenChance * 2;
    // Сейд-камни: в среднем меньше одного на шахту, но токенами платят щедро.
    if (loot) {
      const seid = seidReward(mine, 0);
      money += bps * seidPerBlock() * seid.coins;
      tokens += bps * seidPerBlock() * seid.tokens;
      // Летучая мышь (v2.64): ловит четыре из пяти, берёт монеты или токены
      // поровну. Синяя щедрее — это в среднем множителе.
      const bats = 1 / (BAT_GAP_MS / 1000 + 1 / (bps * BAT_PER_BLOCK));
      const k = process.env.NOBAT ? 0 : bats * 0.8 * 0.5 * (1 + BAT_RARE * (BAT_RARE_MULT - 1));
      money += k * rankCost(rank) * BAT_COINS;
      tokens += k * batTokens(rank);
    }
    xp += bps;
    inRank += bps;
    t += 1;
    if (loot) {
      parcelAcc += bps * m.parcelChance;
      while (parcelAcc >= 1) {
        parcelAcc -= 1;
        if (parcels.length < PARCEL_SLOTS) {
          const tier = rollTier(rnd);
          parcels.push({ tier, left: PARCEL_NEED[tier] });
        }
      }
      for (let i = parcels.length - 1; i >= 0; i--) {
        parcels[i].left -= bps;
        if (parcels[i].left <= 0) {
          open(parcels[i].tier);
          parcels.splice(i, 1);
        }
      }
      if (pet) pets[pet] = (pets[pet] ?? 0) + bps;
      if (t % 60 === 0) {
        fuse();
        equip();
      }
    }
    const level = pickLevelOf(xp).level;
    if (opts.enchants !== false && t % 20 === 0) {
      // Лучшее зачарование за токен из тех, что двигают доход; Токенист —
      // пока дешёвый, он окупается токенами.
      let best: EnchantId | null = null;
      let bestGain = 0;
      const now = income(ench);
      for (const e of ENCHANTS) {
        if (ench[e.id] >= enchantCap(e.id, level)) continue;
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
    if (tCoin[rank] === undefined && money >= cost) tCoin[rank] = t - last;
    if (tWork[rank] === undefined && work >= rankWork(rank)) tWork[rank] = t - last;
    const next = PICKS[pick + 1];
    if (
      opts.buyPicks !== false &&
      !order &&
      next &&
      pickOpen(pick + 1, rank, 0) &&
      money >= next.coins
    ) {
      money -= next.coins;
      order = { pick: pick + 1, have: {} };
      orderAt[pick + 1] = t;
      continue;
    }
    if (
      sharp < SHARP_MAX &&
      money >= sharpCost(pick, sharp) &&
      sharpCost(pick, sharp) <= cost * 0.35
    ) {
      money -= sharpCost(pick, sharp);
      sharp += 1;
      continue;
    }
    if (money >= cost && work >= rankWork(rank)) {
      // Недостающий блок этажа докупается по двойной цене — так делает и
      // живой игрок, когда блок не попался.
      const missing = Math.max(0, rankBlocks(rank) - Math.floor(oreBlocks + 1e-9));
      const extra = missing * BLOCK_PRICE[rank] * 2;
      if (money >= cost + extra) {
        money -= cost + extra;
        rank += 1;
        took.push(t - last);
        last = t;
        inRank = 0;
        work = 0;
        oreBlocks = 0;
      }
    }
  }
  const bonus = bonusOf({ runes, sockets, pet, pets });
  return {
    t,
    took,
    pick,
    rank,
    ench,
    quotaLag,
    xp,
    runes,
    pets,
    pet,
    bonus,
    opened,
    oldMineSec,
    pickAt,
    tCoin,
    tWork,
    gained,
    orderAt,
    readyAt,
    work: workBy,
  };
}

describe('темп каторги', () => {
  // Подгонка таблиц economy.ts под нужный темп: TUNE=1 npx vitest run
  // src/lib/prison.test.ts -t подгонка. Печатает новые RANK_PRICE,
  // RANK_WORK и руду кирок; вставьте их в economy.ts и перезапустите тест.
  it.runIf(!!process.env.DUMP)('разбивка', () => {
    const r = run();
    const rows = r.took.map((d, k) =>
      [
        rankLetter(k),
        (d / 60).toFixed(1) + 'м',
        'цена ' + rankCost(k),
        'доход/мин ' + Math.round((r.gained[k] / d) * 60),
        'цена/доход ' + (rankCost(k) / ((r.gained[k] / d) * 60)).toFixed(1) + 'м',
        'выработка ' + rankWork(k),
        'блоков/мин ' + Math.round((r.work[k] / d) * 60),
      ].join(' '),
    );
    console.log('DUMP\n' + rows.join('\n'));
  });

  it.runIf(!!process.env.TUNE)('подгонка таблиц', () => {
    const W0 = Number(process.env.W0 ?? 3.2);
    const W1 = Number(process.env.W1 ?? 5.2);
    const LAG = Number(process.env.LAG ?? 1.15);
    const ORE = Number(process.env.ORE ?? 0.8);
    for (let it = 0; it < 10; it++) {
      const r = run();
      const dur = r.took;
      for (let k = 4; k < LAST_RANK; k++) {
        const w = (W0 + ((W1 - W0) * (k - 4)) / (LAST_RANK - 5)) * 60;
        const tw = r.tWork[k] ?? dur[k];
        RANK_WORK[k] = RANK_WORK[k] * Math.pow(w / Math.max(1, tw), 0.8);
        const income = r.gained[k] / Math.max(1, dur[k]);
        const want = income * (w / LAG);
        RANK_PRICE[k] = RANK_PRICE[k] * Math.pow(want / RANK_PRICE[k], 0.5);
      }
      for (let i = 1; i < PICKS.length; i++) {
        if (PICKS[i].prestige || r.readyAt[i] === undefined) continue;
        const took = r.readyAt[i] - r.orderAt[i];
        const rankLen = dur[PICKS[i].floor] ?? 240;
        const k = Math.pow((ORE * rankLen) / Math.max(1, took), 0.6);
        for (const o of PICKS[i].ore) o[1] = o[1] * k;
      }
    }
    const r = run();
    console.log(
      'TUNE',
      (r.t / 3600).toFixed(2),
      'ч\nRANK_PRICE',
      RANK_PRICE.map((x) => nice(x)).join(', '),
      '\nRANK_WORK',
      RANK_WORK.map((x) => nice(x)).join(', '),
      '\nORE',
      PICKS.map((p) => JSON.stringify(p.ore.map(([a, n]) => [a, nice(n)]))).join(' '),
      '\nранги',
      r.took.map((x) => (x / 60).toFixed(1)).join(' '),
      '\nденьги/выработка',
      r.tCoin
        .map((x, i) => `${(x / 60).toFixed(1)}/${((r.tWork[i] ?? 0) / 60).toFixed(1)}`)
        .join(' '),
      '\nкирки',
      r.pickAt.join(' '),
    );
  });

  it('первый ранг — за минуту-две', () => {
    const { took } = run({ until: 1 });
    expect(took[0]).toBeGreaterThan(30);
    expect(took[0]).toBeLessThanOrEqual(120);
  });

  it('A→Z — вечер-другой, а не неделя и не полчаса', () => {
    // v2.66: цены постоянные, с E ранг просит выработку и блок этажа —
    // владелец хотел круг длиннее на 10–15%: было ≈1,47 ч, стало ≈1,7 ч в
    // среднем по зёрнам (1,5–1,85). Раньше: граница была 1,8 часа; сейд-камень владелец
    // заказал ровно ради токенов («токены у нас сложно добиваются»), и круг
    // идеального игрока стал ≈1,5 часа. Это решение, а не утечка: НЕ
    // возвращайте его ценами чар. Следующая добавка силы (двор, события)
    // обязана окупаться сама, а не опускать границу снова. Летучая мышь
    // (v2.64) стоит ≈4% круга (1,53 → 1,47 ч, худшее зерно 1,42): её
    // сундучок урезан до этого нарочно — сделаете щедрее, граница упадёт.
    const r = run();
    const { t, rank } = r;
    if (process.env.PACE)
      console.log(
        'PACE',
        (t / 3600).toFixed(2),
        'ч; кирка',
        pickLevelOf(r.xp).level,
        'посылок',
        r.opened,
        'руны',
        JSON.stringify(r.runes.map((x) => x.kind + x.tier)),
        'питомцы',
        Object.keys(r.pets).join(','),
        'бонус',
        JSON.stringify(r.bonus),
        'чары',
        JSON.stringify(r.ench),
        'без добычи',
        (run({ loot: false }).t / 3600).toFixed(2),
        'ранги, мин',
        r.took.map((x) => (x / 60).toFixed(1)).join(' '),
        'выработка/деньги',
        r.quotaLag.map((x) => x.toFixed(2)).join(' '),
        'деньги/выработка, мин',
        r.tCoin
          .map((x, i) => `${(x / 60).toFixed(1)}/${((r.tWork[i] ?? 0) / 60).toFixed(1)}`)
          .join(' '),
        'в старых шахтах, мин',
        (r.oldMineSec / 60).toFixed(0),
        'кирки',
        r.pickAt.join(' '),
        'заказ, мин',
        r.readyAt
          .map((x, i) => (x === undefined ? '' : `${i}:${((x - r.orderAt[i]) / 60).toFixed(1)}`))
          .filter(Boolean)
          .join(' '),
        'зёрна',
        [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => (run({ seed }).t / 3600).toFixed(2)).join(' '),
      );
    expect(rank).toBe(LAST_RANK);
    expect(t / 3600).toBeGreaterThan(1.5);
    expect(t / 3600).toBeLessThan(5);
  });

  it('выработка ощутима, но не стена', () => {
    const { quotaLag } = run();
    // С E выработка правда держит ранг: хотя бы в трети рангов её
    // добирают ПОСЛЕ денег — «сначала поработай», как просил владелец.
    const lag = quotaLag.slice(4);
    const felt = lag.filter((x) => x > 1).length;
    expect(felt).toBeGreaterThanOrEqual(Math.floor(lag.length / 3));
    // Но нигде не тянет ранг больше чем вдвое против денег.
    expect(Math.max(...lag)).toBeLessThan(2);
    // A–D — только деньги.
    expect(quotaLag.slice(0, 4).every((x) => x === 0)).toBe(true);
  });

  it('ни один ранг не тянется дольше получаса', () => {
    const { took } = run();
    expect(Math.max(...took) / 60).toBeLessThan(30);
  });

  it('без кузницы глубокие шахты не потянуть', () => {
    // Честная кирка обязана быть выгоднее, чем «докопаться ржавой».
    const rusty = incomeRate(20, 0, 0);
    const good = incomeRate(20, 10, 10, BASE_MODS);
    expect(good / rusty).toBeGreaterThan(10);
  });

  it('цены постоянные и без миллионов', () => {
    // Владелец: «все фиксированным, чтобы не было миллиардов». Престиж цену
    // ранга не меняет, и ни одна цена шахты не доходит до миллиона.
    for (let r = 0; r < LAST_RANK; r++) expect(rankCost(r, 7)).toBe(rankCost(r, 0));
    for (let r = 0; r < LAST_RANK; r++) expect(rankCost(r)).toBeLessThan(1_000_000);
    for (const p of PICKS) expect(p.coins).toBeLessThan(1_000_000);
    for (const r of ROCKS) expect(r.block).toBeLessThan(1_000_000);
    // Цена руды растёт по этажам, блок стоит заметно дороже руды.
    for (let i = 1; i < ROCKS.length; i++)
      expect(ROCKS[i].value).toBeGreaterThan(ROCKS[i - 1].value);
    for (const r of ROCKS) expect(r.block).toBeGreaterThanOrEqual(r.value * 30);
  });

  it('кирки идут лестницей и все куются', () => {
    for (let i = 1; i < PICKS.length; i++) {
      expect(PICKS[i].dmg).toBeGreaterThan(PICKS[i - 1].dmg);
      expect(PICKS[i].ore.length).toBeGreaterThan(0);
      for (const [rock] of PICKS[i].ore) expect(ROCKS[rock]).toBeDefined();
    }
    // Порода заказа — с этажа, который уже открыт к моменту заказа.
    for (const p of PICKS.slice(1))
      if (!p.prestige) for (const [rock] of p.ore) expect(rock).toBeLessThanOrEqual(p.floor);
    // Лестница проходится: к Z идеальный игрок держит звёздную кирку.
    expect(run().pick).toBeGreaterThanOrEqual(12);
  });
});

describe('состав шахты', () => {
  it('на этаже своя руда и прошлая, своя — главная', () => {
    // Владелец: «на каждом этаже только один или два вида руд». Третья —
    // порода следующего этажа, изредка на дне, как подсказка.
    for (let m = 1; m <= LAST_RANK; m++) {
      const mix = mineMix(m);
      expect(mix.length).toBeLessThanOrEqual(3);
      expect(mix.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1, 9);
      expect(rockShare(m, m)).toBeGreaterThan(0.6);
      expect(rockShare(m, m - 1)).toBeGreaterThan(0.25);
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
    // Глубже своей руды больше: 50% сверху, 85% на дне.
    expect(bottom / top).toBeGreaterThan(1.03);
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
    expect(bagValue(bag, sellMult(2))).toBe(Math.round(base * 1.1));
    // Не больше +50%, сколько престижей ни бери.
    expect(sellMult(40)).toBe(1.5);
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

describe('запал, уровень кирки, норма', () => {
  it('запал держится паузу и гаснет по ступени', () => {
    const s = STREAK_TIERS[3].at + 50;
    expect(streakTier(s)).toBe(3);
    expect(decayStreak(s, STREAK_GRACE_MS)).toBe(s);
    expect(decayStreak(s, STREAK_GRACE_MS + 1)).toBe(STREAK_TIERS[2].at);
    expect(decayStreak(s, STREAK_GRACE_MS + STREAK_DECAY_MS + 1)).toBe(STREAK_TIERS[1].at);
    expect(decayStreak(s, 60_000)).toBe(0);
    expect(streakLoot(0)).toBe(0);
  });

  it('запал множит добычу вместе с Удачей', () => {
    let seed = 3;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const m = modsOf({ ench: { ...NO_ENCHANTS, fortune: 5 }, prestige: 0 });
    const n = 20000;
    const d = rollDrops(new Array<number>(n).fill(2), m, rnd, { streak: 0.28 });
    const expect_ = (1 + m.fortune) * 1.28;
    expect(d.units.length / n).toBeGreaterThan(expect_ - 0.04);
    expect(d.units.length / n).toBeLessThan(expect_ + 0.04);
  });

  it('уровень кирки растёт от блоков и открывает чары ветками', () => {
    expect(pickLevelOf(0).level).toBe(1);
    expect(pickLevelOf(100).level).toBe(2);
    expect(enchantCap('hammer', 17)).toBe(0);
    expect(enchantCap('hammer', 18)).toBeGreaterThan(0);
    for (const e of ENCHANTS) expect(enchantCap(e.id, 40)).toBe(e.max);
    // Первый круг A→Z доводит кирку примерно до середины лестницы.
    const { xp } = run();
    const lvl = pickLevelOf(xp).level;
    expect(lvl).toBeGreaterThan(20);
    expect(lvl).toBeLessThan(40);
  });

  it('A–D — только деньги, с E — выработка и блоки этажа', () => {
    for (let r = 0; r < 4; r++) {
      const n = rankNeeds({ rank: r, norm: {}, oreBlocks: 0 });
      expect(n.workNeed).toBe(0);
      expect(n.blocksNeed).toBe(0);
      expect(n.buyout).toBe(0);
    }
    for (let r = 4; r < LAST_RANK; r++) {
      const n = rankNeeds({ rank: r, norm: {}, oreBlocks: 0 });
      expect(n.workNeed).toBeGreaterThan(0);
      expect(n.blocksNeed).toBeGreaterThan(0);
    }
  });

  it('выработка считает блоки любых шахт, докупается только блок этажа', () => {
    const n = rankNeeds({ rank: 10, norm: { 10: 300, 3: 400 }, oreBlocks: 0 });
    expect(n.work).toBe(Math.min(700, n.workNeed));
    // Недостающий блок — по двойной цене блока этажа.
    expect(n.buyout).toBe(n.blocksNeed * BLOCK_PRICE[10] * 2);
    expect(rankNeeds({ rank: 10, norm: {}, oreBlocks: n.blocksNeed }).buyout).toBe(0);
    expect(rockShare(8, 8)).toBeGreaterThan(0.4);
  });

  it('блоки этажа лежат в поле из зерна, не под сейдом и не в спецзоне', () => {
    let total = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const b = blocksOf(12, seed);
      expect(blocksOf(12, seed)).toEqual(b);
      const sd = seidsOf(12, seed);
      for (const x of b)
        expect(sd.some((q) => q.cell === x.cell && q.depth === x.depth)).toBe(false);
      total += b.length;
    }
    expect(total / 200).toBeCloseTo(blocksPerField(12), 0);
    expect(blocksOf(LAST_RANK + 1, 5)).toEqual([]);
  });

  it('заказ кузнице берёт только нужную руду и не больше нужного', () => {
    const pick = PICKS.findIndex((p) => p.ore.length === 2);
    const [[a, na], [b]] = PICKS[pick].ore;
    const units = [...Array(na + 5).fill(a), b, 0, 0];
    const fed = feedForge({ pick, have: {} }, units);
    expect(fed.order!.have[a]).toBe(na);
    expect(fed.order!.have[b]).toBe(1);
    expect(fed.rest.filter((r) => r === a).length).toBe(5);
    expect(fed.rest.filter((r) => r === 0).length).toBe(2);
    expect(forgeReady(fed.order!)).toBe(false);
    const fromBag = forgeFromBag({ pick, have: {} }, { [a]: na + 3, [b]: 10_000 });
    expect(forgeReady(fromBag.order)).toBe(true);
    expect(fromBag.bag[a]).toBe(3);
  });
});

describe('добыча: посылки, руны, питомцы, вехи', () => {
  it('руна ступенью выше никогда не слабее нижней', () => {
    for (const d of RUNES) {
      for (let t = 1; t < RUNE_TIERS; t++) {
        const topLow = runePower({ kind: d.id, tier: t, roll: 100 });
        const nextHigh = runePower({ kind: d.id, tier: t + 1, roll: 0 });
        expect(nextHigh).toBeGreaterThanOrEqual(topLow - 1e-12);
      }
      // Внутри ступени сила разная: есть что искать.
      expect(runePower({ kind: d.id, tier: 3, roll: 100 })).toBeGreaterThan(
        runePower({ kind: d.id, tier: 3, roll: 0 }),
      );
    }
  });

  it('сплав берёт двух слабейших свободных той же ступени и не трогает гнёзда', () => {
    const runes = [
      { id: 1, kind: 'sell' as const, tier: 2, roll: 90 },
      { id: 2, kind: 'dmg' as const, tier: 2, roll: 10 },
      { id: 3, kind: 'rate' as const, tier: 2, roll: 50 },
      { id: 4, kind: 'loot' as const, tier: 2, roll: 5 },
      { id: 5, kind: 'loot' as const, tier: 1, roll: 0 },
    ];
    const plan = fusePlan(runes, [4, 0, 0, 0], 1)!;
    expect(plan.base.id).toBe(1);
    expect(plan.with.map((r) => r.id).sort()).toEqual([2, 3]);
    // Двух свободных той же ступени нет — сплава нет.
    expect(fusePlan(runes, [2, 3, 0, 0], 1)).toBeNull();
    expect(fusePlan(runes, [0, 0, 0, 0], 5)).toBeNull();
  });

  it('новая руна не слабее «пола» — сплав хороших рун не проваливается', () => {
    const rnd = lcg(5);
    for (let i = 0; i < 500; i++)
      expect(rollRune(3, rnd, 'sell', 70).roll).toBeGreaterThanOrEqual(70);
  });

  it('прибавки рун и питомца упираются в потолок', () => {
    const runes = [1, 2, 3, 4].map((id) => ({ id, kind: 'token' as const, tier: 5, roll: 100 }));
    const b = bonusOf({ runes, sockets: [1, 2, 3, 4], pet: 'raven', pets: { raven: 1e9 } });
    expect(b.token).toBe(BONUS_CAP.token);
    // Продажу даже полный набор не выводит за +100%: её потолок — край.
    const sell = [1, 2, 3, 4].map((id) => ({ id, kind: 'sell' as const, tier: 5, roll: 100 }));
    const s = bonusOf({ runes: sell, sockets: [1, 2, 3, 4], pet: 'fox', pets: { fox: 1e9 } });
    expect(s.sell).toBeLessThanOrEqual(BONUS_CAP.sell);
    // Без питомца и рун — ноль, а не NaN.
    expect(bonusOf({}).sell).toBe(0);
  });

  it('гнёзда открываются уровнем кирки, четвёртое — только вехой «Престиж 10»', () => {
    expect(socketsOpen({ pickXp: 0 })).toBe(0);
    expect(socketsOpen({ pickXp: 1e9 })).toBe(3);
    expect(socketsOpen({ pickXp: 1e9, miles: ['p10'] })).toBe(4);
  });

  it('питомец из посылки — только тот, кого ещё нет; все есть — лакомство', () => {
    const rnd = lcg(11);
    const have = { lemming: 0, fox: 0, wolverine: 0, raven: 0, owl: 0 };
    let pets = 0;
    for (let i = 0; i < 3000; i++) {
      const r = rollParcel({ rank: 5, prestige: 0, pets: have }, 'legend', rnd);
      if (r.kind === 'pet') {
        expect(r.id).toBe('calf');
        pets += 1;
      }
    }
    expect(pets).toBeGreaterThan(0);
    const all = Object.fromEntries(PETS.map((x) => [x.id, 0]));
    for (let i = 0; i < 2000; i++) {
      const r = rollParcel({ rank: 5, prestige: 0, pets: all }, 'legend', rnd);
      expect(r.kind).not.toBe('pet');
    }
  });

  it('награда ложится в состояние: руна в полный мешочек разбивается, первый питомец идёт с собой', () => {
    const base = norm({ ...PRISON_START });
    const full = {
      ...base,
      runes: Array.from({ length: RUNE_BAG }, (_, i) => ({
        id: i + 1,
        kind: 'sell' as const,
        tier: 1,
        roll: 0,
      })),
      runeSeq: RUNE_BAG,
    };
    const a = applyReward(full, { kind: 'rune', rune: { kind: 'dmg', tier: 3, roll: 50 } });
    expect(a.p.runes.length).toBe(RUNE_BAG);
    expect(a.shattered).toBe(RUNE_SHATTER[2]);
    expect(a.p.tokens).toBe(full.tokens + RUNE_SHATTER[2]);
    const b = applyReward(base, { kind: 'pet', id: 'raven' });
    expect(b.newPet).toBe('raven');
    expect(b.p.pet).toBe('raven');
    // Второй такой же — не новый питомец, а опыт текущему.
    const c = applyReward(b.p, { kind: 'pet', id: 'raven' });
    expect(c.newPet).toBeNull();
    expect(c.p.pets.raven).toBeGreaterThan(0);
    expect(applyReward(base, { kind: 'coins', amount: 70 }).coins).toBe(70);
  });

  it('питомец растёт до потолка уровня', () => {
    expect(petLevelOf(0).level).toBe(1);
    expect(petLevelOf(1e12).level).toBe(PET_LEVEL_MAX);
  });

  it('перековка поднимает долю блоков на породу выше и не выходит за Z', () => {
    const rnd = lcg(21);
    const m = modsOf({ ench: { ...NO_ENCHANTS, reforge: 20 }, prestige: 0 });
    const n = 20000;
    const d = rollDrops(new Array<number>(n).fill(4), m, rnd);
    expect(d.reforged.length / n).toBeGreaterThan(m.reforge - 0.02);
    expect(d.reforged.length / n).toBeLessThan(m.reforge + 0.02);
    expect(d.rocks.every((r) => r === 4 || r === 5)).toBe(true);
    const top = rollDrops([LAST_RANK], m, () => 0);
    expect(top.rocks).toEqual([LAST_RANK]);
  });

  it('Эхо множит шансы чар поля, но не перековку', () => {
    const e = { ...NO_ENCHANTS, blast: 10, reforge: 10 };
    const a = modsOf({ ench: e, prestige: 0 });
    const b = modsOf({ ench: { ...e, echo: 20 }, prestige: 0 });
    expect(b.blast / a.blast).toBeCloseTo(2, 9);
    expect(b.reforge).toBe(a.reforge);
  });

  it('посылка ждёт тем дольше, чем реже; мест три', () => {
    expect(PARCEL_NEED.legend).toBeGreaterThan(PARCEL_NEED.epic);
    expect(PARCEL_NEED.epic).toBeGreaterThan(PARCEL_NEED.rare);
    expect(PARCEL_NEED.rare).toBeGreaterThan(PARCEL_NEED.common);
    expect(PARCEL_SLOTS).toBe(3);
    const rnd = lcg(9);
    const n = { common: 0, rare: 0, epic: 0, legend: 0 };
    for (let i = 0; i < 10000; i++) n[rollTier(rnd)] += 1;
    expect(n.common).toBeGreaterThan(n.rare);
    expect(n.legend).toBeGreaterThan(0);
  });

  it('первый круг даёт десятки посылок и хотя бы пару рун', () => {
    const r = run();
    expect(r.opened).toBeGreaterThan(15);
    expect(r.runes.length).toBeGreaterThanOrEqual(2);
  });

  it('веха забирается один раз и только выполненная', () => {
    const p = norm({ ...PRISON_START, mined: 1500 });
    const k = MILES.find((m) => m.id === 'b1k')!;
    const big = MILES.find((m) => m.id === 'b10k')!;
    expect(mileReady(p, k)).toBe(true);
    expect(mileReady(p, big)).toBe(false);
    expect(mileReady({ ...p, miles: ['b1k'] }, k)).toBe(false);
  });

  it('битые руны, гнёзда и питомцы чинятся при загрузке', () => {
    const s = norm({
      runes: [
        { id: 3, kind: 'sell', tier: 9, roll: 400 },
        { id: 3, kind: 'dmg', tier: 1, roll: 1 },
        { id: 7, kind: 'nope' as never, tier: 1, roll: 1 },
      ],
      sockets: [3, 3, 42, 0],
      pets: { owl: 120, dragon: 5 } as never,
      pet: 'fox',
      parcels: [
        { tier: 'epic', left: 99999 },
        { tier: 'junk' as never, left: 1 },
      ],
      miles: ['b1k', 'zzz'],
    });
    expect(s.runes).toEqual([{ id: 3, kind: 'sell', tier: RUNE_TIERS, roll: 100 }]);
    expect(s.sockets).toEqual([3, 0, 0, 0]);
    expect(s.pets).toEqual({ owl: 120 });
    // Питомца, которого нет, с собой не водят.
    expect(s.pet).toBeNull();
    expect(s.parcels).toEqual([{ tier: 'epic', left: PARCEL_NEED.epic }]);
    expect(s.miles).toEqual(['b1k']);
    expect(s.runeSeq).toBeGreaterThanOrEqual(3);
  });
});

describe('сейд-камень', () => {
  it('на поле 0, 1 или 2, только в глубине, в разных клетках', () => {
    const counts = [0, 0, 0];
    for (let seed = 1; seed <= 3000; seed++) {
      const list = seidsOf(7, seed);
      expect(list.length).toBeLessThanOrEqual(2);
      counts[list.length] += 1;
      for (const x of list) {
        expect(x.depth).toBeGreaterThanOrEqual(1);
        expect(x.depth).toBeLessThan(DEPTH);
      }
      if (list.length === 2) expect(list[0].cell).not.toBe(list[1].cell);
    }
    // Чаще всего сейда нет вовсе — он редкий всегда.
    expect(counts[0]).toBeGreaterThan(counts[1]);
    expect(counts[1]).toBeGreaterThan(counts[2]);
    expect(counts[2]).toBeGreaterThan(0);
    // Одно зерно — одни и те же места.
    expect(seidsOf(3, 42)).toEqual(seidsOf(3, 42));
  });

  it('сверху он только на своём ярусе', () => {
    const s = [{ cell: 10, depth: 2 }];
    expect(seidTop(s, 10, 2)).toBe(true);
    expect(seidTop(s, 10, 1)).toBe(false);
    expect(seidTop(s, 11, 2)).toBe(false);
  });

  it('платит токенами больше, чем шахта даёт за сотню блоков', () => {
    for (const rank of [0, 10, 24]) {
      const r = seidReward(rank, 0);
      expect(r.tokens).toBeGreaterThan(100 * TOKEN_CHANCE * 2);
      expect(r.coins).toBeGreaterThan(0);
      expect(r.coins).toBeLessThan(rankCost(rank));
    }
    expect(SEID_HITS).toBeGreaterThan(1);
  });
});
