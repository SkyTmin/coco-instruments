import type { Translation } from '../types';
import type { ctabs as ru } from '../ru/ctabs';

export const ctabs: Translation<typeof ru> = {
  shop: {
    title: 'Malzemeler',
    hint: 'Aldıkların madende hemen yanında',
    /** Tapped a price you can't pay: how many tokens are missing. */
    short: '{v} ✦ eksik',
  },
  runes: {
    amulet: 'Muska',
    amuletHint: 'Rünleri yuvalara yerleştir',
    pouch: 'Kese',
    pouchHint: 'bir rün seç',
    pick: 'Ne verdiğini görmek için bir rün seç',
    shatter: 'Jeton için kır',
    /** Short roll line under the rune name in the inspect panel. */
    roll: 'güç {n}/100',
    /** The fuse button (half a panel wide: German «Verschmelzen» did not fit). */
    fuse: 'Birleştir',
  },
  finds: {
    title: 'Buluntular',
    hint: 'Satış +%{pct} · her yeni buluntu +%1',
    unknown: 'Henüz bulunmadı',
    copies: 'Bulunan: {n}',
  },
  miles: {
    hint: 'Tamamla — ödülünü al',
  },
  perks: {
    hint: 'Puanları prestij verir — harca',
    /** Word under the big number of free points. */
    points: { one: 'puan', other: 'puan' },
    prestige: 'prestij {n}',
    per: 'seviye başına',
    now: 'Şimdi',
    next: 'Sonra',
    learn: 'Öğren',
    noPoints: 'Boş puan yok — prestij verir',
    /** The reset ↶ on the points plate is armed by a first tap; this says what the second does. */
    resetArm: 'Sıfırlamak için tekrar dokun',
  },
  /** Amulet bonus chips (2×2): one short noun after «+7,5%»; the full camp.bonus.* is the tip. */
  bonus: {
    sell: 'satış',
    dmg: 'kazma',
    rate: 'vuruş',
    loot: 'ganimet',
    token: 'jeton',
    proc: 'büyü',
    luck: 'anahtar',
  },
};
