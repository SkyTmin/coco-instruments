/**
 * Critter texts by data (`src/lib/critters.ts`) in the current language: card
 * letters of the risk game and the treasure cards' labels (`offerLabel`
 * translated; the lib keeps its Russian for tests).
 */
import { fmtNum, hasKey, t } from './core';
import { itemName, runeName, runeText } from './data';
import { RANK_NAMES } from '@/lib/critters';
import { RUNE_ROMAN } from '@/lib/prison';
import type { Reward } from '@/lib/prison';

/** Card rank 0…12 (two…ace) as the deck of this language writes it. */
export const rankName = (i: number) => {
  const key = `critters.rank.${i}`;
  return hasKey(key) ? t(key) : RANK_NAMES[i];
};

/** A treasure card: what it is and how much (`offerLabel` of the lib). */
export function offerText(r: Reward): { title: string; amount: string } {
  switch (r.kind) {
    case 'coins':
      return { title: t('critters.offer.coins'), amount: fmtNum(r.amount) };
    case 'tokens':
      return { title: t('critters.offer.tokens'), amount: fmtNum(r.amount) };
    case 'keys':
      return {
        title: r.amount > 1 ? t('critters.offer.keys') : t('critters.offer.key'),
        amount: `×${r.amount}`,
      };
    case 'item':
      return { title: itemName(r.id), amount: `×${r.amount}` };
    case 'rune':
      return {
        title: t('critters.offer.rune', { text: runeText(r.rune.kind) }),
        amount: `${runeName(r.rune.kind)} ${RUNE_ROMAN[r.rune.tier - 1]}`,
      };
    default:
      return { title: '', amount: '' };
  }
}
