import { describe, expect, it } from 'vitest';
import { DUNGEON_START, heroOf, SLOTS } from '../dungeon';
import type { DungeonState, Gear } from '../dungeon';
import { buildWorld, liftOf } from '../dungeon-world';
import { createSim, NO_INPUT, stepSim } from '../dungeon-sim';
import type { Sim } from '../dungeon-sim';
import { f15Events } from './f15-brains';

const world = buildWorld(15);
const DT = 1 / 60;

function dungeon(tier: number, plus: number): DungeonState {
  const gear = {} as Gear;
  for (const s of SLOTS) gear[s] = { tier, plus };
  return { ...DUNGEON_START, gear, reached: 15 };
}

function sim(x: number, y: number, seed = 7): Sim {
  const d = dungeon(8, 5);
  return createSim({ world, dungeon: d, stats: heroOf(d), x, y, seed, now: () => 1e12 });
}

describe('этаж 15: дым', () => {
  it('минута у лифта и прогулка по Трахее — без падений', () => {
    const lift = liftOf(world, 'f15')!;
    const s = sim(lift.x + 0.5, lift.y + 1.5);
    for (let t = 0; t < 60 * 60; t++) {
      const k = Math.floor(t / 120);
      stepSim(s, DT, { ...NO_INPUT, mx: Math.sin(k) * 0.6, my: -0.8, attack: t % 20 === 0 });
    }
    expect(f15Events(s)).not.toBeNull();
    expect(s.hero.hp).toBeGreaterThan(-1);
  });
});
