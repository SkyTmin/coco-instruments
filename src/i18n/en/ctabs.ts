import type { Translation } from '../types';
import type { ctabs as ru } from '../ru/ctabs';

export const ctabs: Translation<typeof ru> = {
  shop: {
    title: 'Supplies',
    hint: 'What you buy goes down the mine with you',
    /** Tapped a price you can't pay: how many tokens are missing. */
    short: '{v} ✦ short',
    /** Phones: one effect chip per good instead of the sentence (the sentence is its tip). */
    fx: {
      bomb3: 'Blast 3×3',
      bomb5: 'Blast 5×5',
      charge: 'Whole layer',
      energy: 'Pickaxe ×2 · 1 min',
      lens: 'Layer below · 90 s',
      prop: 'Rock up · 10 min',
    },
  },
  runes: {
    amulet: 'Amulet',
    amuletHint: 'Put runes in the sockets',
    pouch: 'Pouch',
    pouchHint: 'pick a rune',
    pick: 'Pick a rune to see what it gives',
    shatter: 'Shatter for tokens',
    /** Short roll line under the rune name in the inspect panel. */
    roll: 'power {n}/100',
    /** Short phone: the fuse condition / plan in two lines of a 134-px panel. */
    fuseNeedShort: 'Fuse: need 2 more free {tier}',
    fuseGoShort: 'Fuse: 2× {tier} → {rune}',
    /** Shatter of a tier III+ rune is armed by a first tap (the button shows what it gives). */
    shatterArm: 'Tap again: shatter',
    wornNoShatter: 'Worn — take it out first',
    /** Short phone (no socket captions): a locked socket tapped — its condition. */
    lockedShort: 'Socket: {cond}',
  },
  finds: {
    title: 'Finds',
    hint: 'Sell price +{pct}% · each new find +1%',
    unknown: 'Not found yet',
    copies: 'Found: {n}',
  },
  miles: {
    hint: 'Complete it — claim the reward',
    /** Phone reward chip «+ гнездо» (the full «четвёртое гнездо» is its tip). */
    socket: 'socket',
  },
  perks: {
    hint: 'Prestige gives points — spend them',
    /** Word under the big number of free points. */
    points: { one: 'point', other: 'points' },
    prestige: 'prestige {n}',
    per: 'per level',
    now: 'Now',
    /** One line of the skill panel: the value now → after «Learn». */
    step: 'Now {now} → {next}',
    learn: 'Learn',
    noPoints: 'No free points — prestige gives them',
    /** The reset ↶ on the points plate is armed by a first tap; this says what the second does. */
    resetArm: 'Tap again to reset skills',
  },
  /** Amulet bonus chips (2×2): one short noun after «+7,5%»; the full camp.bonus.* is the tip. */
  bonus: {
    sell: 'sales',
    dmg: 'mining',
    rate: 'hits',
    loot: 'loot',
    token: 'tokens',
    proc: 'enchants',
    luck: 'keys',
  },
};
