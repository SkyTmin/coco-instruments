import type { Translation } from '../types';
import type { yardData as ru } from '../ru/yardData';

export const yardData: Translation<typeof ru> = {
  event: {
    meteor: {
      name: 'Göktaşı',
      lead: 'Madene düştü. Soğumadan kır — içinde kaçak mal var',
    },
    kuiva: {
      name: 'Kuiva',
      lead: 'Taş dev kayadan çıktı. Geri dönmeden vur',
    },
    convoy: {
      name: 'Konvoy',
      lead: 'Konvoy kaya yükü bekliyor. Gitmeden yetiştir',
    },
    gold: {
      name: 'Altın Damarı',
      lead: 'Her blok üç kat sayılır',
    },
    payday: {
      name: 'Maaş Günü',
      lead: 'Alıcı kayaya iki kat para veriyor',
    },
    magpie: {
      name: 'Hırsız Saksağan',
      lead: 'Çaldıklarını madene düşürüyor. Yerdeyken topla',
    },
    blizzard: {
      name: 'Fırtına',
      lead: 'Rüzgâr ormanı deviriyor: düşen her ağaç yanındakini de yıkıyor',
    },
    bear: {
      name: 'Tayganın Efendisi',
      lead: 'Ayı odun yığınına geliyor. Durmadan kes, kaçar',
    },
  },
  map: {
    square: 'Meydan',
    forge: 'Demirhane',
    mine: 'Maden',
    zone: 'Özel Maden',
    lift: 'Zindan Asansörü',
    tower: 'Büyücü Kulesi',
    kennel: 'Kuluçka',
    store: 'Depo',
    kiosk: 'Büfe',
    trader: 'Tüccar',
    hq: 'Karargâh',
    club: 'Kulüp',
    barrack1: 'Koğuş 1',
  },
  npc: {
    smith: 'Demirci',
    mage: 'Büyücü',
    foreman: 'Ustabaşı',
    guard: 'Gardiyan',
    liftman: 'Asansörcü',
    keeper: 'Bakıcı',
    clerk: 'Depocu',
    trader: 'Tüccar',
    seller: 'Satıcı',
    chief: 'Müdür',
    orderly: 'Nöbetçi',
    croupier: 'Krupiye',
  },
  door: {
    forge: 'Demirhane',
    mine: 'Maden',
    zone: 'Özel Maden',
    hq: 'Karargâh',
    kiosk: 'Büfe',
    tower: 'Kule',
    lift: 'Asansör',
    store: 'Depo',
    kennel: 'Kuluçka',
    trader: 'Tüccar',
    barrack1: 'Koğuş 1',
    club: 'Kulüp',
    square: 'Çık',
  },
  act: {
    board: 'Pano',
    back: 'Çıkış',
    prison: 'İn',
    zone: 'Gir',
    dungeon: 'İn',
    bunk: 'Sandığım',
  },
};
