import { describe, expect, it } from 'vitest';
import { suggestOutfit } from './clothing';
import type { ClothingCategory, WardrobeItem } from '@/types';

const mk = (id: string, category: ClothingCategory): WardrobeItem => ({
  id,
  name: id,
  category,
  createdAt: 0,
  updatedAt: 0,
});

describe('suggestOutfit', () => {
  it('picks one item per core slot, ordered top→shoes', () => {
    const items = [mk('t1', 'top'), mk('t2', 'top'), mk('b1', 'bottom'), mk('s1', 'shoes')];
    const out = suggestOutfit(items, () => 0); // always first; extras gated by rng()>0.45/0.5 → off
    expect(out.map((i) => i.category)).toEqual(['top', 'bottom', 'shoes']);
    expect(out.map((i) => i.id)).toEqual(['t1', 'b1', 's1']);
  });

  it('adds outerwear and accessory when rng is high', () => {
    const items = [
      mk('t', 'top'),
      mk('b', 'bottom'),
      mk('s', 'shoes'),
      mk('o', 'outerwear'),
      mk('a', 'accessory'),
    ];
    const out = suggestOutfit(items, () => 0.9);
    expect(out.map((i) => i.category)).toEqual(['outerwear', 'top', 'bottom', 'shoes', 'accessory']);
  });

  it('falls back to a few random items when none are categorised into core slots', () => {
    const items = [mk('x', 'other'), mk('y', 'other')];
    const out = suggestOutfit(items, () => 0.1);
    expect(out.length).toBeGreaterThan(0);
    out.forEach((i) => expect(items).toContain(i));
  });

  it('skips slots with no items', () => {
    const out = suggestOutfit([mk('t', 'top')], () => 0);
    expect(out.map((i) => i.id)).toEqual(['t']);
  });
});
