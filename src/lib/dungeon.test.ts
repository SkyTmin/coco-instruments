import { describe, expect, it } from 'vitest';
import {
  applyDelta,
  AREAS,
  deepHp,
  deepMineNow,
  dieRun,
  extractRun,
  liftCost,
  payMats,
  sackCost,
  beastBonus,
  canPay,
  conditionsMet,
  deepField,
  DEEP_BASE,
  DEEP_MINES,
  DEEP_ROCKS,
  DUNGEON_START,
  econOf,
  EMPTY_SACK,
  heroOf,
  levelOf,
  MARKET_FULL,
  meatValue,
  mobStats,
  nextStep,
  normalizeDungeon,
  pieceStats,
  plusCost,
  PRISON_ROCKS,
  reforgeConditions,
  SETS,
  canTake,
  sackSlots,
  sackStacks,
  slotsUsed,
  smellOf,
  SLOTS,
  xpFor,
  MAP_VERSION,
  minusMats,
  payFromBoth,
} from './dungeon';
import type { DungeonState, Gear, Sack } from './dungeon';
import { PRISON_START } from './prison';

const withGear = (tier: number, plus: number): DungeonState => {
  const gear = {} as Gear;
  for (const s of SLOTS) gear[s] = { tier, plus };
  return { ...DUNGEON_START, gear };
};

describe('подземелье: правила', () => {
  it('деньги считаются от шахты игрока и растут с рангом', () => {
    const low = econOf({ ...PRISON_START, rank: 5, pick: 1 });
    const high = econOf({ ...PRISON_START, rank: 20, pick: 4, sharp: 10 });
    expect(low).toBeGreaterThanOrEqual(120);
    expect(high).toBeGreaterThan(low * 10);
  });

  it('мясо дороже из глубины, рынок насыщается', () => {
    const shallow: Sack = { ...EMPTY_SACK, meat: { meat: 10 }, meatBy: { mouth: 10 } };
    const deep: Sack = { ...EMPTY_SACK, meat: { meat: 10 }, meatBy: { haul: 10 } };
    const a = meatValue(shallow, 1000, 0).value;
    const b = meatValue(deep, 1000, 0).value;
    expect(b).toBeGreaterThan(a);
    const tired = meatValue(shallow, 1000, MARKET_FULL).value;
    expect(tired).toBeCloseTo(a / 2, 0);
  });

  it('следующая ступень заметно сильнее предыдущей, заточка — шаг внутри', () => {
    for (let t = 1; t < SETS.length; t++) {
      const a = pieceStats('weapon', { tier: t, plus: 5 }).dmg;
      const b = pieceStats('weapon', { tier: t + 1, plus: 0 }).dmg;
      expect(b).toBeGreaterThan(a);
    }
    const h1 = heroOf(withGear(1, 0));
    const h2 = heroOf(withGear(2, 0));
    expect(h2.dmg).toBeGreaterThan(h1.dmg * 1.5);
    expect(h2.maxHp).toBeGreaterThan(h1.maxHp);
  });

  it('заточка дорожает, перековка ждёт условий', () => {
    const e = 1000;
    for (let p = 1; p < 5; p++) {
      const a = plusCost('weapon', 1, p, e);
      const b = plusCost('weapon', 1, p + 1, e);
      expect(b.coins).toBeGreaterThan(a.coins);
      expect(b.mats.skin!).toBeGreaterThan(a.mats.skin!);
    }
    const d = withGear(1, 5);
    expect(nextStep(d, 'weapon', e).kind).toBe('reforge');
    expect(conditionsMet(d, 'weapon', 1)).toBe(false);
    const done = { ...d, kills: { rat: 300 } };
    expect(conditionsMet(done, 'weapon', 1)).toBe(true);
    // У каждого слота свои условия.
    const labels = SLOTS.map((s) => reforgeConditions(s, 1)[0].label);
    expect(new Set(labels).size).toBe(4);
    // Прокачку дают убийства и добыча, а не удачный подъём (просьба владельца).
    for (const t of [1, 2])
      for (const s of SLOTS)
        for (const c of reforgeConditions(s, t)) expect(c.label).not.toMatch(/Выйти|выход/i);
    const miner = { ...d, stats: { ore: 60 } };
    expect(conditionsMet(miner, 'helm', 1)).toBe(true);
  });

  it('монеты не открывают ступень: нужны материалы со склада', () => {
    const d = withGear(1, 0);
    expect(canPay(d, plusCost('weapon', 1, 1, 1000), 1e12)).toBe(false);
    const rich = { ...d, stash: { skin: 999 } };
    expect(canPay(rich, plusCost('weapon', 1, 1, 1000), 1e12)).toBe(true);
  });

  it('уровень героя долгий: сотый — это сотни тысяч опыта', () => {
    let total = 0;
    for (let l = 1; l < 100; l++) total += xpFor(l);
    expect(total).toBeGreaterThan(1_500_000);
    expect(levelOf(0).level).toBe(1);
    expect(levelOf(xpFor(1)).level).toBe(2);
  });

  it('бестиарий даёт прибавку против вида ступенями', () => {
    expect(beastBonus(10).dmg).toBe(0);
    expect(beastBonus(60).dmg).toBeCloseTo(0.1);
    expect(beastBonus(300).loot).toBeCloseTo(0.1);
    expect(beastBonus(1200).guard).toBeCloseTo(0.15);
    expect(beastBonus(6000).dmg).toBeCloseTo(0.35);
  });

  it('мобы глубже крепче ровно на шаг района', () => {
    const a = mobStats('rat', 0);
    const b = mobStats('rat', 1);
    expect(b.hp / a.hp).toBeCloseTo(1.8);
    const e = mobStats('rat', 0, { elite: true });
    expect(e.hp).toBeGreaterThan(a.hp * 3);
  });

  it('запах мяса растёт десятками кусков и упирается в потолок', () => {
    expect(smellOf({ ...EMPTY_SACK, meat: { meat: 9 } })).toBe(0);
    expect(smellOf({ ...EMPTY_SACK, meat: { meat: 25 } })).toBeCloseTo(0.2);
    expect(smellOf({ ...EMPTY_SACK, meat: { meat: 500 } })).toBe(1);
  });

  it('сидор — ячейки со стопками, как в Майнкрафте', () => {
    expect(sackSlots(0)).toBe(9);
    expect(sackSlots(3)).toBe(36);
    expect(sackSlots(99)).toBe(36);
    // Девять полных стопок мяса — сидор без карманов полон.
    const full: Sack = { ...EMPTY_SACK, meat: { meat: 32 * 9 } };
    expect(slotsUsed(full)).toBe(9);
    expect(canTake(full, 'meat', 1, 0)).toBe(false);
    expect(canTake(full, 'skin', 1, 0)).toBe(false);
    expect(canTake(full, 'skin', 1, 1)).toBe(true);
    // Неполная стопка добирается, пока не кончились ячейки.
    const part: Sack = { ...EMPTY_SACK, meat: { meat: 32 * 8 + 5 } };
    expect(canTake(part, 'meat', 27, 0)).toBe(true);
    expect(canTake(part, 'meat', 28, 0)).toBe(false);
    // Порядок ячеек: мясо, материалы; корона — по одной.
    const mixed: Sack = { ...EMPTY_SACK, meat: { meat: 40 }, mats: { skin: 3, crown: 2 } };
    expect(sackStacks(mixed)).toEqual([
      { id: 'meat', n: 32 },
      { id: 'meat', n: 8 },
      { id: 'skin', n: 3 },
      { id: 'crown', n: 1 },
      { id: 'crown', n: 1 },
    ]);
  });

  it('подземная шахта одинакова в одном окне и меняется в следующем', () => {
    const a = deepField('pyrite1', 100, 63, 5);
    const b = deepField('pyrite1', 100, 63, 5);
    const c = deepField('pyrite1', 101, 63, 5);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    const ore = a.filter((r) => r === DEEP_MINES.pyrite1.ore).length;
    expect(ore).toBeGreaterThan(20);
    // Подземные номера не пересекаются с породами каторги.
    expect(DEEP_BASE).toBeGreaterThan(PRISON_ROCKS);
    expect(DEEP_ROCKS.length).toBeGreaterThan(1);
  });

  it('битое сохранение не роняет игру', () => {
    const d = normalizeDungeon({
      gear: { weapon: { tier: 99, plus: -3 } },
      kills: { rat: 'x' },
      run: { area: 'nope' },
    });
    expect(d.gear.weapon).toEqual({ tier: SETS.length, plus: 0 });
    expect(d.gear.helm).toEqual({ tier: 1, plus: 0 });
    expect(d.kills.rat).toBeUndefined();
    expect(d.run?.area).toBe('mouth');
    expect(d.lifts).toContain('mouth');
    expect(normalizeDungeon(null)).toEqual(DUNGEON_START);
  });

  it('районы по порядку глубже и опаснее', () => {
    for (let i = 1; i < AREAS.length; i++) {
      expect(AREAS[i].level).toBeGreaterThanOrEqual(AREAS[i - 1].level);
    }
  });

  it('дельта вылазки складывается, босс считает убийства', () => {
    const d = applyDelta(
      { ...DUNGEON_START, kills: { rat: 5 }, lamps: ['a'] },
      {
        kills: { rat: 3, fatrat: 1 },
        stats: { meters: 40 },
        xp: 120,
        lamps: ['a', 'b'],
        opened: ['g'],
        secrets: [],
        bosses: [{ id: 'king', at: 1000 }],
      },
      { mouth: 'AAAA' },
    );
    expect(d.kills).toEqual({ rat: 8, fatrat: 1 });
    expect(d.stats.meters).toBe(40);
    expect(d.xp).toBe(120);
    expect(d.lamps).toEqual(['a', 'b']);
    expect(d.bosses.king).toEqual({ at: 1000, kills: 1 });
    expect(d.fog.mouth).toBe('AAAA');
  });

  it('выход клетью: мясо в кошелёк, материалы на склад, рынок помнит час', () => {
    const now = 5 * 3_600_000 + 10;
    const sack: Sack = {
      ...EMPTY_SACK,
      meat: { meat: 20 },
      meatBy: { mouth: 20 },
      mats: { skin: 7 },
      coins: 300,
      tokens: 4,
    };
    const run = {
      lift: 'mouth',
      area: 'mouth' as const,
      x: 1,
      y: 1,
      hp: 50,
      sack,
      started: now - 60_000,
      killed: 9,
    };
    const r = extractRun({ ...DUNGEON_START, run, stash: { skin: 3 } }, sack, 1000, now, 9);
    expect(r.d.run).toBeNull();
    expect(r.d.stash.skin).toBe(10);
    expect(r.d.market).toEqual({ hour: 5, sold: 20 });
    expect(r.d.stats.extracts).toBe(1);
    expect(r.haul.meat).toBe(20);
    expect(r.pay).toBe(r.haul.meatValue + 300);
    expect(r.haul.ms).toBe(60_000);
    // Новый час — рынок снова берёт по полной.
    const again = extractRun(r.d, sack, 1000, now + 3_600_000, 0);
    expect(again.d.market.sold).toBe(20);
  });

  it('смерть забирает сидор, но не прогресс', () => {
    const sack: Sack = {
      ...EMPTY_SACK,
      meat: { meat: 5 },
      meatBy: { haul: 5 },
      mats: { pyrite: 4 },
    };
    const d = { ...DUNGEON_START, kills: { rat: 40 }, xp: 500, stash: { pyrite: 1 } };
    const r = dieRun(d, sack, 1000, 1e9, 3);
    expect(r.d.stash.pyrite).toBe(1);
    expect(r.d.kills.rat).toBe(40);
    expect(r.d.xp).toBe(500);
    expect(r.d.stats.deaths).toBe(1);
    expect(r.lost.mats.pyrite).toBe(4);
    expect(r.lost.meat).toBe(5);
  });

  it('сидор и клеть стоят шкурки со склада и дорожают', () => {
    expect(sackCost(3, 1000).coins).toBeGreaterThan(sackCost(2, 1000).coins);
    expect(sackCost(3, 1000).mats.skin!).toBeGreaterThan(sackCost(0, 1000).mats.skin!);
    expect(liftCost('haul', 1000).coins).toBeGreaterThan(liftCost('mouth', 1000).coins);
    const d = payMats(
      { ...DUNGEON_START, stash: { skin: 12, pyrite: 2 } },
      { coins: 0, mats: { skin: 12 } },
    );
    expect(d.stash).toEqual({ pyrite: 2 });
  });

  it('руда подземелья крепче с рангом, окно шахты сбрасывает раскоп', () => {
    expect(deepHp(DEEP_BASE + 1, { rank: 20 })).toBeGreaterThan(deepHp(DEEP_BASE + 1, { rank: 5 }));
    expect(deepHp(DEEP_BASE + 1, { rank: 5 })).toBeGreaterThan(deepHp(DEEP_BASE, { rank: 5 }));
    const hour = 3_600_000;
    const d = { ...DUNGEON_START, mines: { pyrite1: { window: 7, dug: new Array(63).fill(2) } } };
    expect(deepMineNow(d, 'pyrite1', 7 * hour + 5, 63).dug[0]).toBe(2);
    expect(deepMineNow(d, 'pyrite1', 8 * hour + 5, 63).dug[0]).toBe(0);
  });

  it('платёж внизу: сперва склад, недостающее — из сидора, не хватает — отказ', () => {
    const d = { ...DUNGEON_START, stash: { skin: 5, pyrite: 4 } };
    const cost = { coins: 100, mats: { skin: 8, pyrite: 2 } };
    const r = payFromBoth(d, cost, { skin: 10 })!;
    // Шкурок на складе 5 — все ушли, ещё 3 из сидора; пирит только со склада.
    expect(r.d.stash).toEqual({ pyrite: 2 });
    expect(r.fromSack).toEqual({ skin: 3 });
    expect(minusMats({ skin: 10, tail: 1 }, r.fromSack)).toEqual({ skin: 7, tail: 1 });
    expect(minusMats({ skin: 3 }, { skin: 3 })).toEqual({});
    // Вместе не хватает — ничего не списывается.
    expect(payFromBoth(d, cost, { skin: 2 })).toBeNull();
    expect(payFromBoth(d, { coins: 0, mats: { crown: 1 } }, {})).toBeNull();
    expect(payFromBoth(d, { coins: 0, mats: { crown: 1 } }, { crown: 1 })!.fromSack).toEqual({
      crown: 1,
    });
  });

  it('другая планировка карты: разведка и фонари с нуля, вылазка — у клети, сидор цел', () => {
    const old = {
      ...DUNGEON_START,
      mapVer: 1,
      fog: { mouth: 'AAAA' },
      lamps: ['mouth:3:4'],
      opened: ['mouth:35:59'],
      secrets: ['mouth:4:59'],
      run: {
        lift: 'mouth',
        area: 'haul' as const,
        x: 20,
        y: 40,
        hp: 50,
        sack: { ...EMPTY_SACK, coins: 77 },
        started: 1,
        killed: 3,
      },
    };
    const d = normalizeDungeon(old);
    expect(d.mapVer).toBe(MAP_VERSION);
    expect(d.fog).toEqual({});
    expect(d.lamps).toEqual([]);
    expect(d.opened).toEqual([]);
    expect(d.run!.x).toBeLessThan(0);
    expect(d.run!.area).toBe('mouth');
    expect(d.run!.sack.coins).toBe(77);
    // Та же планировка — ничего не трогаем.
    const same = normalizeDungeon({ ...old, mapVer: MAP_VERSION });
    expect(same.lamps).toEqual(['mouth:3:4']);
    expect(same.run!.x).toBe(20);
  });
});
