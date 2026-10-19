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
    /** Phone landscape: the title over the bonus box under the stone. */
    gives: 'Muska verir',
    /** A bonus chip at the cap (runes + pets share BONUS_CAP): the reason, in its tip. */
    capTip: 'Rün ve evcil hayvanlar birlikte en fazla {cap}: rünler {raw} verir, {eff} sayılır',
    /** …the sell chip when all sell bonuses together hit SELL_BONUS_CAP. */
    capSellTip: 'Tüm satış bonusları birlikte en fazla +%100: rünler {raw} verir, {eff} sayılır',
  },
  finds: {
    title: 'Buluntular',
    hint: 'Satış +%{pct} · her yeni buluntu +%1',
    unknown: 'Henüz bulunmadı',
    copies: 'Bulunan: {n}',
  },
  miles: {
    hint: 'Tamamla — ödülünü al',
    /** Phone reward chip «+ гнездо» (the full «четвёртое гнездо» is its tip). */
    socket: 'yuva',
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
    /** Short phone: the ‹ › page buttons of the skills strip (aria-label + mouse tip). */
    prev: 'Önceki yetenekler',
    next: 'Diğer yetenekler',
    /** «Blat»: the rank a prestige starts from now → after «Learn» (rank letters). */
    blatStep: 'Başlangıç: rütbe {now} → {next}',
    blatNow: 'Başlangıç: rütbe {now}',
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
