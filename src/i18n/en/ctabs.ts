import type { Translation } from '../types';
import type { ctabs as ru } from '../ru/ctabs';

export const ctabs: Translation<typeof ru> = {
  shop: {
    title: 'Supplies for tokens',
    hint: 'What you buy goes down the mine with you',
    /** Tapped a price you can't pay: how many tokens are missing. */
    short: '{v} ✦ short',
  },
  runes: {
    amulet: 'Amulet',
    amuletHint: 'Put runes in the sockets',
    pouch: 'Pouch',
    pouchHint: 'pick a rune',
    pick: 'Pick a rune to see what it gives',
    shatter: 'Shatter for tokens',
  },
  finds: {
    title: 'Finds',
    hint: 'Sell price +{pct}% · each new find +1%',
    unknown: 'Not found yet',
    copies: 'Found: {n}',
  },
  miles: {
    hint: 'Complete it — claim the reward',
  },
  perks: {
    hint: 'Prestige gives points — spend them',
    /** Word under the big number of free points. */
    points: { one: 'point', other: 'points' },
    prestige: 'prestige {n}',
    per: 'per level',
    now: 'Now',
    next: 'Next',
    learn: 'Learn',
    noPoints: 'No free points — prestige gives them',
  },
};
