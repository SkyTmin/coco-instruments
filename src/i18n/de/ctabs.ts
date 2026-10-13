import type { Translation } from '../types';
import type { ctabs as ru } from '../ru/ctabs';

export const ctabs: Translation<typeof ru> = {
  shop: {
    title: 'Vorräte',
    hint: 'Was du kaufst, hast du gleich in der Mine',
    /** Tapped a price you can't pay: how many tokens are missing. */
    short: 'Es fehlen {v} ✦',
  },
  runes: {
    amulet: 'Amulett',
    amuletHint: 'Setz Runen in die Sockel',
    pouch: 'Beutel',
    pouchHint: 'wähl eine Rune',
    pick: 'Wähl eine Rune – hier steht, was sie bringt',
    shatter: 'Für Tokens zerschlagen',
    /** Short roll line under the rune name in the inspect panel. */
    roll: 'Kraft {n}/100',
  },
  finds: {
    title: 'Funde',
    hint: 'Verkauf +{pct} % · jeder neue Fund +1 %',
    unknown: 'Noch nicht gefunden',
    copies: 'Gefunden: {n}',
  },
  miles: {
    hint: 'Schaff es – hol dir die Belohnung',
  },
  perks: {
    hint: 'Punkte gibt es fürs Prestige – setz sie ein',
    /** Word under the big number of free points. */
    points: { one: 'Punkt', other: 'Punkte' },
    prestige: 'Prestige {n}',
    per: 'pro Stufe',
    now: 'Jetzt',
    next: 'Danach',
    learn: 'Lernen',
    noPoints: 'Keine freien Punkte – die gibt es fürs Prestige',
    /** Secondary reset button (full wording stays in camp.perks.reset as its tooltip). */
    reset: 'Zurücksetzen',
    free: 'kostenlos',
  },
};
