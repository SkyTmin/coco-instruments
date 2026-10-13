import { describe, expect, it } from 'vitest';
import { ru } from './ru';
import { FISH, RODS, SPOTS } from '@/lib/fishing';

// Change a name in src/lib — change ru/fishingData.ts and the six translations with it.
describe('ru.fishingData equals src/lib', () => {
  it('spots, fish, rods', () => {
    expect(ru.fishingData).toEqual({
      spot: Object.fromEntries(SPOTS.map((s) => [s.id, s.name])),
      fish: Object.fromEntries(FISH.map((f) => [f.id, f.name])),
      rod: Object.fromEntries(RODS.map((r, i) => [String(i), r.name])),
    });
  });
});
