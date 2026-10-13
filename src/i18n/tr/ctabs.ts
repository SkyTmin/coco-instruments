import type { Translation } from '../types';
import type { ctabs as ru } from '../ru/ctabs';

export const ctabs: Translation<typeof ru> = {
  shop: {
    title: 'Jetonla malzeme',
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
  },
};
