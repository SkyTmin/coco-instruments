import type { Translation } from '../types';
import type { settings as ru } from '../ru/settings';

export const settings: Translation<typeof ru> = {
  title: 'Settings',
  section: {
    language: 'Language',
    sound: 'Sound',
    vibration: 'Vibration',
    display: 'Display',
    controls: 'Controls',
    progress: 'Progress',
  },
  language: {
    auto: 'Same as Telegram',
    autoHint: 'Now: {name}',
  },
  sound: {
    sound: 'Sound',
    music: 'Music',
    master: 'Master',
    musicVolume: 'Music',
    sfxVolume: 'Effects',
  },
  vibration: {
    on: 'Vibration',
  },
  display: {
    scale: 'UI scale',
    text: 'Text',
    textS: 'Small',
    textM: 'Normal',
    textL: 'Large',
    motion: 'Reduce motion',
    motionAuto: 'System default',
  },
  controls: {
    soon: 'Keys and gamepad setup will live here',
  },
  progress: {
    wipePrison: 'Restart the mine',
    wipePrisonSure: 'Sure? Tap again',
    wipePrisonNote: 'Coins and level stay — they’re shared with the slots.',
    wipeAll: 'Reset all games',
    wipeAllSure: 'Everything? Tap again',
    wipeAllNote: 'Mine, forest and slots from scratch, coins back to a thousand. No undo.',
    wipedAll: 'All games restarted',
    wipedPrison: 'Hard Labor restarted',
  },
};
