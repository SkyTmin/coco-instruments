import type { Translation } from '../types';
import type { hall as ru } from '../ru/hall';

export const hall: Translation<typeof ru> = {
  title: 'Casino',
  cascade: 'Kaskade',
  reels: {
    one: '{n} Walze',
    other: '{n} Walzen',
  },
  lines: {
    one: '{n} Linie',
    other: '{n} Linien',
  },
  grid: 'Feld {cols}×{rows}',
  orbsUpTo: 'Kugeln bis ×{x}',
  stat: {
    one: '{n} Spin · Rekord {best}',
    other: '{n} Spins · Rekord {best}',
  },
  note: 'Dieselben Münzen wie in der Mine. Kaufen geht nicht – nur verdienen',
};
