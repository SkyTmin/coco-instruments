import type { Translation } from '../types';
import type { ctabs as ru } from '../ru/ctabs';

export const ctabs: Translation<typeof ru> = {
  shop: {
    title: 'Malzemeler',
    hint: 'Aldıkların madende hemen yanında',
    /** Tapped a price you can't pay: how many tokens are missing. */
    short: '{v} ✦ eksik',
    /** Phones: one effect chip per good instead of the sentence (the sentence is its tip). */
    fx: {
      bomb3: '3×3 patlatır',
      bomb5: '5×5 patlatır',
      charge: 'Tüm kat',
      energy: 'Kazma ×2 · 1 dk',
      lens: 'Alt kat · 90 sn',
      prop: 'Üst kaya · 10 dk',
    },
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
    /** Short phone: the fuse condition / plan in two lines of a 134-px panel. */
    fuseNeedShort: 'Birleştirme: 2 boş {tier} daha',
    fuseGoShort: 'Birleştirme: 2× {tier} → {rune}',
    /** Shatter of a tier III+ rune is armed by a first tap (the button shows what it gives). */
    shatterArm: 'Tekrar dokun: kır',
    wornNoShatter: 'Önce muskadan çıkar',
    /** Short phone (no socket captions): a locked socket tapped — its condition. */
    lockedShort: 'Yuva: {cond}',
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
    /** One line of the skill panel: the value now → after «Learn». */
    step: 'Şimdi {now} → {next}',
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
