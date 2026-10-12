import type { Translation } from '../types';
import type { settings as ru } from '../ru/settings';

export const settings: Translation<typeof ru> = {
  title: 'Ayarlar',
  section: {
    language: 'Dil',
    sound: 'Ses',
    vibration: 'Titreşim',
    display: 'Ekran',
    controls: 'Kontroller',
    progress: 'İlerleme',
  },
  language: {
    auto: 'Telegram’daki gibi',
    autoHint: 'Şu an: {name}',
  },
  sound: {
    sound: 'Ses',
    music: 'Müzik',
    master: 'Genel',
    musicVolume: 'Müzik',
    sfxVolume: 'Efektler',
  },
  vibration: {
    on: 'Titreşim',
  },
  display: {
    scale: 'Ölçek',
    text: 'Yazı',
    textS: 'Küçük',
    textM: 'Normal',
    textL: 'Büyük',
    motion: 'Daha az animasyon',
    motionAuto: 'Sistemdeki gibi',
  },
  controls: {
    soon: 'Tuşlar ve oyun kolu yakında burada',
  },
  progress: {
    wipePrison: 'Madeni baştan başlat',
    wipePrisonSure: 'Emin misin? Bir daha dokun',
    wipePrisonNote: 'Altın ve seviye kalır — slotlarla ortak.',
    wipeAll: 'Tüm oyunları sıfırla',
    wipeAllSure: 'Her şey mi? Bir daha dokun',
    wipeAllNote: 'Maden, orman ve slotlar sıfırdan, yine bin altın. Geri alınamaz.',
    wipedAll: 'Tüm oyunlar baştan başladı',
    wipedPrison: 'Kürek baştan başladı',
  },
};
