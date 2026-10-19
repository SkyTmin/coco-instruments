import type { Translation } from '../types';
import type { ctabs as ru } from '../ru/ctabs';

export const ctabs: Translation<typeof ru> = {
  shop: {
    title: 'Vorräte',
    hint: 'Was du kaufst, hast du gleich in der Mine',
    /** Tapped a price you can't pay: how many tokens are missing. */
    short: 'Es fehlen {v} ✦',
    /** Phones: one effect chip per good instead of the sentence (the sentence is its tip). */
    fx: {
      bomb3: 'Sprengt 3×3',
      bomb5: 'Sprengt 5×5',
      charge: 'Ganze Schicht',
      energy: 'Spitzhacke ×2 · 1 Min.',
      lens: 'Schicht darunter · 90 s',
      prop: 'Gestein höher · 10 Min.',
    },
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
    /** Short phone: the fuse condition / plan in two lines of a 134-px panel. */
    fuseNeedShort: 'Verschmelzen: noch 2 freie {tier}',
    fuseGoShort: 'Verschmelzen: 2× {tier} → {rune}',
    /** Shatter of a tier III+ rune is armed by a first tap (the button shows what it gives). */
    shatterArm: 'Nochmal: zerbrechen',
    wornNoShatter: 'Erst aus dem Amulett',
    /** Short phone (no socket captions): a locked socket tapped — its condition. */
    lockedShort: 'Sockel: {cond}',
  },
  finds: {
    title: 'Funde',
    hint: 'Verkauf +{pct} % · jeder neue Fund +1 %',
    unknown: 'Noch nicht gefunden',
    copies: 'Gefunden: {n}',
  },
  miles: {
    hint: 'Schaff es – hol dir die Belohnung',
    /** Phone reward chip «+ гнездо» (the full «четвёртое гнездо» is its tip). */
    socket: 'Sockel',
  },
  perks: {
    hint: 'Punkte gibt es fürs Prestige – setz sie ein',
    /** Word under the big number of free points. */
    points: { one: 'Punkt', other: 'Punkte' },
    prestige: 'Prestige {n}',
    per: 'pro Stufe',
    now: 'Jetzt',
    /** One line of the skill panel: the value now → after «Learn». */
    step: 'Jetzt {now} → {next}',
    learn: 'Lernen',
    noPoints: 'Keine freien Punkte – die gibt es fürs Prestige',
    /** The reset ↶ on the points plate is armed by a first tap; this says what the second does. */
    resetArm: 'Nochmal tippen zum Zurücksetzen',
  },
  /** Amulet bonus chips (2×2): one short noun after «+7,5%»; the full camp.bonus.* is the tip. */
  bonus: {
    sell: 'Verkauf',
    dmg: 'Abbau',
    rate: 'Schläge',
    loot: 'Beute',
    token: 'Tokens',
    proc: 'Zauber',
    luck: 'Schlüssel',
  },
};
