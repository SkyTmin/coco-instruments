// Креатив владельца: песочница пишется в свои ключи и не ломает сохранение.

import { afterEach, describe, expect, it } from 'vitest';
import {
  CREATIVE_KEYS,
  CREATIVE_TOKENS,
  creativeDungeon,
  creativePrison,
  gameKey,
  normalizeCreative,
  setCreativeActive,
} from './creative';
import { AREAS, DUNGEON_START, normalizeDungeon, PLUS_SAFE, SETS, SLOTS } from './dungeon';
import { FLOORS } from './dungeon-floors';
import { PICKS } from './economy';
import { EGG_BASKET, eggCount } from './pets';
import { LAST_RANK, minPickFor, normalizePrison, PRISON_START } from './prison';
import { STORAGE_KEYS } from './storage';

afterEach(() => setCreativeActive(false));

describe('креатив: ключи', () => {
  it('в креативе игровые ключи с приставкой, прочие — как есть', () => {
    expect(gameKey(STORAGE_KEYS.prison)).toBe(STORAGE_KEYS.prison);
    setCreativeActive(true);
    for (const k of ['slots', 'prison', 'forest', 'dungeon', 'fishing'] as const)
      expect(gameKey(STORAGE_KEYS[k])).toBe(`creative.${STORAGE_KEYS[k]}`);
    expect(gameKey('bunk.state')).toBe('creative.bunk.state');
    // Заметки, финансы, одежда в песочницу не уходят.
    expect(gameKey(STORAGE_KEYS.notes)).toBe(STORAGE_KEYS.notes);
    expect(gameKey(STORAGE_KEYS.expenses)).toBe(STORAGE_KEYS.expenses);
  });

  it('флаг: по умолчанию выключен, бессмертие включено', () => {
    expect(normalizeCreative(null)).toEqual({ on: false, god: true, since: 0 });
    expect(normalizeCreative({ on: true, god: false, since: 5 })).toEqual({
      on: true,
      god: false,
      since: 5,
    });
  });
});

describe('креатив: каторга', () => {
  it('ранг — со свежей шахтой его этажа и киркой не ниже нужной', () => {
    const p = creativePrison(PRISON_START, { rank: 20 });
    expect(p.rank).toBe(20);
    expect(p.mine.id).toBe(20);
    expect(p.pickMax).toBeGreaterThanOrEqual(minPickFor(20));
    // Переживает чтение сохранения без поправок.
    const n = normalizePrison(p);
    expect(n.rank).toBe(20);
    expect(n.pickMax).toBe(p.pickMax);
  });

  it('границы: ранг, престиж, кирка не выходят за таблицы', () => {
    const p = creativePrison(PRISON_START, { rank: 99, prestige: -3, pick: 999 });
    expect(p.rank).toBe(LAST_RANK);
    expect(p.prestige).toBe(0);
    expect(p.pick).toBe(PICKS.length - 1);
  });

  it('слабая кирка в руке остаётся в руке, лучшая — не ниже этажа', () => {
    const p = creativePrison(creativePrison(PRISON_START, { rank: 15 }), { pick: 0 });
    expect(p.pick).toBe(0);
    expect(p.pickMax).toBe(minPickFor(15));
  });

  it('запасы: токены, ключи и корзина яиц до верха', () => {
    const p = creativePrison(PRISON_START, { fill: true });
    expect(p.tokens).toBe(CREATIVE_TOKENS);
    expect(p.keys).toBe(CREATIVE_KEYS);
    expect(eggCount(p.eggs)).toBeLessThanOrEqual(EGG_BASKET);
    expect(eggCount(p.eggs)).toBeGreaterThan(0);
  });
});

describe('креатив: подземелье', () => {
  it('все этажи и лифты открыты, боссы готовы, всё переживает чтение', () => {
    const d0 = {
      ...DUNGEON_START,
      bosses: { king: { at: Date.now(), kills: 2 } },
    };
    const d = creativeDungeon(d0, { open: true, bosses: true, stash: true });
    expect(d.reached).toBe(FLOORS.length);
    for (const a of AREAS) expect(d.lifts).toContain(a.id);
    expect(d.bosses.king).toEqual({ at: 0, kills: 2 });
    const n = normalizeDungeon(d);
    expect(n.reached).toBe(FLOORS.length);
    expect(n.lifts.length).toBe(d.lifts.length);
    for (const f of FLOORS) for (const m of f.mats) expect(n.stash[m.id]).toBeGreaterThan(0);
  });

  it('снаряжение: ступень и заточка в пределах', () => {
    const d = creativeDungeon(DUNGEON_START, { tier: 99, plus: 99 });
    for (const s of SLOTS) expect(d.gear[s]).toEqual({ tier: SETS.length, plus: PLUS_SAFE });
    const e = creativeDungeon(d, { tier: 3 });
    for (const s of SLOTS) expect(e.gear[s]).toEqual({ tier: 3, plus: PLUS_SAFE });
  });
});
