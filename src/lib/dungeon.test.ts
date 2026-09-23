import { describe, expect, it } from 'vitest';
import {
  AREAS,
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
  sackCap,
  smellOf,
  SLOTS,
  xpFor,
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
    expect(sackCap(1)).toBeGreaterThan(sackCap(0));
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
});
