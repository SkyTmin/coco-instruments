import type { Translation } from '../types';
import type { hall as ru } from '../ru/hall';

export const hall: Translation<typeof ru> = {
  title: 'Casino',
  cascade: 'Cascada',
  prison: 'Presidio',
  wallet: 'Monedero común',
  play: 'Jugar',
  reels: {
    one: '{n} rodillo',
    many: '{n} de rodillos',
    other: '{n} rodillos',
  },
  lines: {
    one: '{n} línea',
    many: '{n} de líneas',
    other: '{n} líneas',
  },
  grid: 'Tablero {cols}×{rows}',
  orbsUpTo: 'Esferas hasta ×{x}',
  stat: {
    one: '{n} tirada · récord {best}',
    many: '{n} de tiradas · récord {best}',
    other: '{n} tiradas · récord {best}',
  },
  note: 'Las mismas monedas que en la mina. No se compran: se ganan',
};
