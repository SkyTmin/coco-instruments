import type { Translation } from '../types';
import type { settings as ru } from '../ru/settings';

export const settings: Translation<typeof ru> = {
  title: 'Impostazioni',
  section: {
    language: 'Lingua',
    sound: 'Audio',
    vibration: 'Vibrazione',
    display: 'Schermo',
    controls: 'Comandi',
    progress: 'Progressi',
  },
  language: {
    auto: 'Come su Telegram',
    autoHint: 'Ora: {name}',
  },
  sound: {
    sound: 'Audio',
    music: 'Musica',
    master: 'Generale',
    musicVolume: 'Musica',
    sfxVolume: 'Effetti',
  },
  vibration: {
    on: 'Vibrazione',
  },
  display: {
    scale: 'Scala',
    text: 'Testo',
    textS: 'Piccolo',
    textM: 'Normale',
    textL: 'Grande',
    motion: 'Meno animazioni',
    motionAuto: 'Come il sistema',
  },
  controls: {
    soon: 'Qui arriveranno tasti e controller',
  },
  progress: {
    wipePrison: 'Ricomincia la miniera',
    wipePrisonSure: 'Sicuro? Tocca di nuovo',
    wipePrisonNote: 'Monete e livello restano: sono in comune con le slot.',
    wipeAll: 'Azzera tutti i giochi',
    wipeAllSure: 'Proprio tutto? Tocca di nuovo',
    wipeAllNote: 'Miniera, bosco e slot da zero, di nuovo mille monete. Non si può annullare.',
    wipedAll: 'Tutti i giochi ricominciano',
    wipedPrison: 'La Galera ricomincia',
  },
};
