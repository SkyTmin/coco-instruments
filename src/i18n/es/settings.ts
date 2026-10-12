import type { Translation } from '../types';
import type { settings as ru } from '../ru/settings';

export const settings: Translation<typeof ru> = {
  title: 'Ajustes',
  section: {
    language: 'Idioma',
    sound: 'Sonido',
    vibration: 'Vibración',
    display: 'Pantalla',
    controls: 'Controles',
    progress: 'Progreso',
  },
  language: {
    auto: 'Como en Telegram',
    autoHint: 'Ahora: {name}',
  },
  sound: {
    sound: 'Sonido',
    music: 'Música',
    master: 'General',
    musicVolume: 'Música',
    sfxVolume: 'Efectos',
  },
  vibration: {
    on: 'Vibración',
  },
  display: {
    scale: 'Escala',
    text: 'Texto',
    textS: 'Pequeño',
    textM: 'Normal',
    textL: 'Grande',
    motion: 'Menos animaciones',
    motionAuto: 'Como el sistema',
  },
  controls: {
    soon: 'Aquí irán las teclas y el mando',
  },
  progress: {
    wipePrison: 'Empezar la mina de nuevo',
    wipePrisonSure: '¿Seguro? Toca otra vez',
    wipePrisonNote: 'Las monedas y el nivel se quedan: se comparten con las tragaperras.',
    wipeAll: 'Reiniciar todos los juegos',
    wipeAllSure: '¿Todo? Toca otra vez',
    wipeAllNote:
      'Mina, bosque y tragaperras desde cero, otra vez mil monedas. No se puede deshacer.',
    wipedAll: 'Todos los juegos empiezan de nuevo',
    wipedPrison: 'El Presidio empieza de nuevo',
  },
};
