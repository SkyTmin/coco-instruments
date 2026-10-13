import type { Translation } from '../types';
import type { settings as ru } from '../ru/settings';

export const settings: Translation<typeof ru> = {
  title: 'Einstellungen',
  section: {
    language: 'Sprache',
    sound: 'Sound',
    vibration: 'Vibration',
    display: 'Anzeige',
    controls: 'Steuerung',
    progress: 'Fortschritt',
  },
  language: {
    auto: 'Wie in Telegram',
    autoHint: 'Aktuell: {name}',
  },
  sound: {
    sound: 'Sound',
    music: 'Musik',
    master: 'Gesamt',
    musicVolume: 'Musik',
    sfxVolume: 'Effekte',
  },
  vibration: {
    on: 'Vibration',
  },
  display: {
    scale: 'Skalierung',
    text: 'Text',
    textS: 'Klein',
    textM: 'Normal',
    textL: 'Groß',
    motion: 'Weniger Animation',
    motionAuto: 'Wie im System',
  },
  controls: {
    soon: 'Tasten und Gamepad kommen hierher',
  },
  progress: {
    wipePrison: 'Mine neu starten',
    wipePrisonSure: 'Sicher? Nochmal tippen',
    wipePrisonNote: 'Münzen und Level bleiben – sie gehören auch den Automaten.',
    wipeAll: 'Alle Spiele zurücksetzen',
    wipeAllSure: 'Wirklich alles? Nochmal tippen',
    wipeAllNote: 'Mine, Wald und Automaten auf null, wieder tausend Münzen. Endgültig.',
    wipedAll: 'Alle Spiele neu gestartet',
    wipedPrison: 'Knast neu gestartet',
  },
};
