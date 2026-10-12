import type { Translation } from '../types';
import type { hall as ru } from '../ru/hall';

export const hall: Translation<typeof ru> = {
  title: 'Casino',
  cascade: 'Cascade',
  reels: {
    one: '{n} rouleau',
    many: '{n} de rouleaux',
    other: '{n} rouleaux',
  },
  lines: {
    one: '{n} ligne',
    many: '{n} de lignes',
    other: '{n} lignes',
  },
  grid: 'Grille {cols}×{rows}',
  orbsUpTo: 'Orbes jusqu’à ×{x}',
  stat: {
    one: '{n} tour · record {best}',
    many: '{n} de tours · record {best}',
    other: '{n} tours · record {best}',
  },
  note: 'Les mêmes pièces qu’à la mine. Impossible de les acheter : on les gagne',
};
