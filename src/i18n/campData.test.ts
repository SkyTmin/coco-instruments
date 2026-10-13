import { describe, expect, it } from 'vitest';
import { ru } from './ru';
import { HANDLES } from '@/lib/prison';
import { EGGS } from '@/lib/pets';
import { AXES, AXE_ENCHANTS, BENCH_ITEMS, SPECIES } from '@/lib/forest';

// Change a name in src/lib — change ru/campData.ts and the six translations with it.
describe('ru.campData equals src/lib', () => {
  it('eggs, handles, axes, species, axe enchants, bench orders', () => {
    const by = <T extends { id: string }>(a: T[], f: (x: T) => unknown) =>
      Object.fromEntries(a.map((x) => [x.id, f(x)]));
    expect(ru.campData).toEqual({
      egg: by(EGGS, (x) => x.name),
      handle: by(HANDLES, (x) => x.name),
      axe: by(AXES, (x) => x.name),
      species: by(SPECIES, (x) => ({ name: x.name, gen: x.gen })),
      axeEnch: by(AXE_ENCHANTS, (x) => ({ name: x.name, per: x.per })),
      bench: by(BENCH_ITEMS, (x) => ({ name: x.name, who: x.who })),
    });
  });
});
