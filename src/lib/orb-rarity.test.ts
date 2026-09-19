import { describe, expect, it } from 'vitest';
import { ORB_TABLE } from './scatter';
import { loudestTier, multRarity, ORB_TIERS, orbRarity } from './orb-rarity';
import type { OrbRarity } from './orb-rarity';

/** Доля номиналов тира среди всех сфер, в процентах, по настоящей таблице. */
function realChance(id: OrbRarity): number {
  const total = ORB_TABLE.reduce((s, [, w]) => s + w, 0);
  const mine = ORB_TABLE.filter(([v]) => orbRarity(v) === id).reduce((s, [, w]) => s + w, 0);
  return (mine / total) * 100;
}

describe('лестница редкости сфер', () => {
  it('заявленные проценты совпадают с таблицей весов', () => {
    for (const tier of ORB_TIERS) {
      // Допуск на округление в подписи: 66 % против 66.0 %.
      expect(realChance(tier.id)).toBeCloseTo(tier.chance, 1);
    }
  });

  it('проценты всех тиров складываются в сто', () => {
    const sum = ORB_TIERS.reduce((s, t) => s + t.chance, 0);
    expect(sum).toBeCloseTo(100, 6);
  });

  it('каждый номинал из таблицы попадает ровно в один тир', () => {
    for (const [value] of ORB_TABLE) {
      const matches = ORB_TIERS.filter((t) => t.id === orbRarity(value));
      expect(matches).toHaveLength(1);
    }
  });

  it('чем реже тир, тем он выше по лестнице', () => {
    for (let i = 1; i < ORB_TIERS.length; i++) {
      expect(ORB_TIERS[i].chance).toBeLessThan(ORB_TIERS[i - 1].chance);
      expect(ORB_TIERS[i].min).toBeGreaterThan(ORB_TIERS[i - 1].min);
      expect(ORB_TIERS[i].beats).toBeGreaterThanOrEqual(ORB_TIERS[i - 1].beats);
    }
  });

  it('границы тиров', () => {
    expect(orbRarity(2)).toBe('common');
    expect(orbRarity(4)).toBe('common');
    expect(orbRarity(5)).toBe('uncommon');
    expect(orbRarity(8)).toBe('uncommon');
    expect(orbRarity(10)).toBe('rare');
    expect(orbRarity(15)).toBe('rare');
    expect(orbRarity(20)).toBe('epic');
    expect(orbRarity(25)).toBe('epic');
    expect(orbRarity(50)).toBe('legendary');
    expect(orbRarity(100)).toBe('legendary');
    expect(orbRarity(250)).toBe('mythic');
    expect(orbRarity(500)).toBe('mythic');
  });

  it('сумма множителей оценивается по той же лестнице', () => {
    // Три обычные сферы дают редкий по силе момент — и празднуется он как редкий.
    expect(multRarity(4 + 4 + 4)).toBe('rare');
    expect(multRarity(2)).toBe('common');
    expect(multRarity(300)).toBe('mythic');
  });

  it('громкость звена — по самой редкой сфере, а не по их числу', () => {
    expect(loudestTier([2, 3, 2]).id).toBe('common');
    expect(loudestTier([2, 250]).id).toBe('mythic');
    // Порядок не важен.
    expect(loudestTier([250, 2]).id).toBe('mythic');
  });

  it('пустое звено не празднуется', () => {
    expect(loudestTier([]).beats).toBe(0);
  });
});
