import type { Translation } from '../types';
import type { skins as ru } from '../ru/skins';

export const skins: Translation<typeof ru> = {
  classic: {
    name: 'Klasik',
    hint: 'Meyveler ve yediler — tam Vegas usulü',
    title: 'Slot',
    subtitle: 'Küçük bir şans oyunu',
  },
  asia: {
    name: 'Ejderha',
    hint: 'Kırmızı fenerler, altın ve ejderhalar',
    title: 'Ejderha Kapısı',
    subtitle: 'Fenerler, altın ve şans',
  },
  space: {
    name: 'Uzay',
    hint: 'Gezegenler, roketler ve uzaylılar',
    title: 'Derin Uzay',
    subtitle: 'Galaksinin ucunda bahisler',
  },
  pirate: {
    name: 'Korsanlar',
    hint: 'Çapalar, kılıçlar ve altın sandığı',
    title: 'Kara Bayrak',
    subtitle: 'Sandık cesurları bekler',
  },
  egypt: {
    name: 'Mısır',
    hint: 'Skarabeler, kediler ve firavun tacı',
    title: 'Nil’in Altını',
    subtitle: 'Firavunların hazineleri',
  },
  candy: {
    name: 'Şekerleme',
    hint: 'Lolipoplar, donutlar ve pastalar',
    title: 'Şekerci Dükkânı',
    subtitle: 'Lolipop için çevir',
  },
  pumpkin: {
    name: 'Balkabağı Gecesi',
    hint: 'Örümcek ağları, hayaletler ve balkabağı fener',
    title: 'Balkabağı Gecesi',
    subtitle: 'Şeker mi şaka mı',
  },
  abyss: {
    name: 'Derinlerden',
    hint: 'Mercanlar, denizanaları ve dipte bir balina',
    title: 'Derinlerden',
    subtitle: 'Işığın hiç ulaşmadığı yer',
  },
  neon: {
    name: 'Neon',
    hint: 'Gece atari salonu — 5. seviyede açılır',
    title: 'Neon Salon',
    subtitle: 'Hiç kapanmayan atari',
  },
  winter: {
    name: 'Kış',
    hint: 'Kar, hediyeler ve sıcak kakao — 9. seviyede açılır',
    title: 'Ayaz Gecesi',
    subtitle: 'Kar, ışıklar ve hediyeler',
  },
  olympus: {
    name: 'Olimpos',
    hint: 'Tanrıların altını ve Zeus’un şimşekleri — 12. seviyede açılır',
    title: 'Olimpos Kapıları',
    subtitle: 'Tanrıların altını ve Zeus’un şimşekleri',
  },
  kupala: {
    name: 'Gündönümü Gecesi',
    hint: 'Ateş böcekleri ve eğrelti çiçeği — 15. seviyede açılır',
    title: 'Eğrelti Çiçeği',
    subtitle: 'Hazineyi bulmak için yılda bir gece',
  },
  relic: {
    name: 'Kalıntı',
    hint: 'Ömürde bir kez bulunan altın',
    title: 'Kalıntı',
    subtitle: 'Sadece bir kez alınır',
  },
};
