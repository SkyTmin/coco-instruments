import type { Translation } from '../types';
import type { hall as ru } from '../ru/hall';

export const hall: Translation<typeof ru> = {
  title: 'Casinò',
  cascade: 'Cascata',
  reels: {
    one: '{n} rullo',
    many: '{n} di rulli',
    other: '{n} rulli',
  },
  lines: {
    one: '{n} linea',
    many: '{n} di linee',
    other: '{n} linee',
  },
  grid: 'Griglia {cols}×{rows}',
  orbsUpTo: 'Sfere fino a ×{x}',
  stat: {
    one: '{n} giro · record {best}',
    many: '{n} di giri · record {best}',
    other: '{n} giri · record {best}',
  },
  note: 'Le stesse monete della miniera. Non si comprano: si guadagnano',
};
