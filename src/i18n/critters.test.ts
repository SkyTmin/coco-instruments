import { describe, expect, it } from 'vitest';
import { ru } from './ru';
import { offerText } from './data-critters';
import { offerLabel, RANK_NAMES } from '@/lib/critters';
import type { Reward } from '@/lib/prison';

// Change the card letters or a treasure label in src/lib/critters.ts — change ru/critters.ts and the six translations with it.
describe('ru.critters equals src/lib', () => {
  it('card letters past ten', () => {
    expect(ru.critters.rank).toEqual(
      Object.fromEntries(RANK_NAMES.map((r, i) => [String(i), r]).filter(([i]) => +i >= 9)),
    );
  });
  it('treasure cards read as offerLabel', () => {
    const rewards: Reward[] = [
      { kind: 'coins', amount: 12_345 },
      { kind: 'tokens', amount: 40 },
      { kind: 'keys', amount: 1 },
      { kind: 'keys', amount: 3 },
      { kind: 'item', id: 'bomb3', amount: 2 },
      { kind: 'rune', rune: { kind: 'sell', tier: 2, power: 1 } },
    ] as Reward[];
    for (const r of rewards) expect(offerText(r)).toEqual(offerLabel(r));
  });
});
