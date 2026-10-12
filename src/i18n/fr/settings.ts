import type { Translation } from '../types';
import type { settings as ru } from '../ru/settings';

export const settings: Translation<typeof ru> = {
  title: 'Paramètres',
  section: {
    language: 'Langue',
    sound: 'Son',
    vibration: 'Vibrations',
    display: 'Affichage',
    controls: 'Commandes',
    progress: 'Progression',
  },
  language: {
    auto: 'Comme Telegram',
    autoHint: 'Actuelle : {name}',
  },
  sound: {
    sound: 'Son',
    music: 'Musique',
    master: 'Général',
    musicVolume: 'Musique',
    sfxVolume: 'Effets',
  },
  vibration: {
    on: 'Vibrations',
  },
  display: {
    scale: 'Échelle',
    text: 'Texte',
    textS: 'Petit',
    textM: 'Normal',
    textL: 'Grand',
    motion: 'Moins d’animations',
    motionAuto: 'Comme le système',
  },
  controls: {
    soon: 'Touches et manette : bientôt ici',
  },
  progress: {
    wipePrison: 'Recommencer la mine',
    wipePrisonSure: 'Sûr ? Touche encore',
    wipePrisonNote: 'Pièces et niveau restent : ils sont partagés avec les machines à sous.',
    wipeAll: 'Réinitialiser tous les jeux',
    wipeAllSure: 'Vraiment tout ? Touche encore',
    wipeAllNote: 'Mine, forêt et machines à sous à zéro, mille pièces pour repartir. Irréversible.',
    wipedAll: 'Tous les jeux recommencent',
    wipedPrison: 'Le Bagne recommence',
  },
};
