import { describe, expect, it } from 'vitest';
import {
  buildMine,
  enchantCap,
  enchantMax,
  ENCHANTS,
  freshMine,
  LAST_RANK,
  MINES,
  modsOf,
  normalizePrison,
  PICK_LEVEL_MAX,
  PRISON_START,
  ROCKS,
  STAR_DMG,
  ZONE_MS,
  zoneDay,
  zoneLeft,
  zoneMineId,
  zoneTier,
  zoneToday,
  zoneTokens,
} from './prison';
import type { Zone } from './prison';

const zone = (patch: Partial<Zone> = {}): Zone => ({
  day: zoneDay(Date.now()),
  used: 0,
  bonus: 0,
  have: 0,
  on: false,
  tick: 0,
  back: null,
  ...patch,
});

describe('престижные породы', () => {
  it('рангов по-прежнему 26, пород больше — пять престижных сверху', () => {
    expect(MINES).toBe(26);
    expect(LAST_RANK).toBe(25);
    expect(ROCKS.length).toBe(31);
    for (let j = MINES; j < ROCKS.length; j++) {
      expect(ROCKS[j].value).toBeGreaterThan(ROCKS[j - 1].value);
      expect(ROCKS[j].hp).toBeGreaterThanOrEqual(ROCKS[j - 1].hp);
    }
  });

  it('шахта спецзоны собирается и держит породы в пределах списка', () => {
    for (const prestige of [1, 3, 6, 10, 15, 40]) {
      const id = zoneMineId(prestige);
      expect(id).toBeGreaterThan(LAST_RANK);
      expect(id).toBeLessThan(ROCKS.length);
      const rocks = buildMine(id, 7);
      for (const r of rocks) {
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThan(ROCKS.length);
      }
      expect(rocks.some((r) => r === id)).toBe(true);
    }
  });
});

describe('спецзона', () => {
  it('открывается первым престижем, ступени — новой породой', () => {
    expect(zoneTier(0)).toBe(0);
    expect(zoneTier(1)).toBe(1);
    expect(zoneTier(3)).toBe(2);
    expect(zoneTier(15)).toBe(5);
    expect(zoneMineId(1)).toBe(26);
    expect(zoneMineId(99)).toBe(30);
  });

  it('десять минут в день плюс заработанные нормой, новый день — заново', () => {
    const now = Date.now();
    expect(zoneLeft(zone(), now)).toBe(ZONE_MS);
    expect(zoneLeft(zone({ used: 4 * 60_000 }), now)).toBe(6 * 60_000);
    expect(zoneLeft(zone({ used: ZONE_MS, bonus: 60_000 }), now)).toBe(60_000);
    const old = zone({ day: 'вчера', used: ZONE_MS, have: 350, on: true });
    const today = zoneToday(old, now);
    expect(today.used).toBe(0);
    expect(today.have).toBe(0);
    // Новый день не выкидывает из зоны.
    expect(today.on).toBe(true);
  });

  it('престижная порода платит токенами щедрее обычной и растёт по лестнице', () => {
    expect(zoneTokens(LAST_RANK)).toBeLessThan(zoneTokens(MINES));
    for (let j = MINES + 1; j < ROCKS.length; j++)
      expect(zoneTokens(j)).toBeGreaterThan(zoneTokens(j - 1));
  });

  it('сохранение: номер шахты в зоне выше ранга живёт, вне зоны — срезается', () => {
    const inZone = normalizePrison({
      ...PRISON_START,
      rank: 3,
      prestige: 1,
      mine: freshMine(26, 5),
      zone: zone({ on: true, back: freshMine(3, 9) }),
    });
    expect(inZone.mine.id).toBe(26);
    expect(inZone.zone.back?.id).toBe(3);
    const outZone = normalizePrison({ ...PRISON_START, rank: 3, mine: freshMine(26, 5) });
    expect(outZone.mine.id).toBe(3);
  });
});

describe('престиж кирки', () => {
  it('звезда поднимает потолок каждой чары и урон', () => {
    for (const e of ENCHANTS) {
      expect(enchantMax(e.id, 0)).toBe(e.max);
      expect(enchantMax(e.id, 5)).toBe(e.max * 2);
      expect(enchantCap(e.id, PICK_LEVEL_MAX, 2)).toBe(enchantMax(e.id, 2));
    }
    const p = normalizePrison({ ...PRISON_START });
    expect(modsOf({ ...p, pickStars: 3 }).dmg).toBeCloseTo(modsOf(p).dmg * (1 + 3 * STAR_DMG));
  });

  it('уровни чар выше обычного предела не срезаются при загрузке, если есть звёзды', () => {
    const e = ENCHANTS[0];
    const kept = normalizePrison({
      ...PRISON_START,
      pickStars: 2,
      ench: { ...PRISON_START.ench, [e.id]: e.max + 5 },
    });
    expect(kept.ench[e.id]).toBe(e.max + 5);
    const cut = normalizePrison({
      ...PRISON_START,
      ench: { ...PRISON_START.ench, [e.id]: e.max + 5 },
    });
    expect(cut.ench[e.id]).toBe(e.max);
  });
});
