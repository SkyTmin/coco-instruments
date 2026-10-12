import type { Translation } from '../types';
import type { field as ru } from '../ru/field';

export const field: Translation<typeof ru> = {
  beam: 'STRAHL',
  vein: 'ADER ×{n}',
  crit: 'KRIT',
  hammer: 'HAMMER',
  blast: 'BUMM',
  ore: '+{n} Erz',
  petDmg: 'Verstärkung!',
  petRate: 'Vollgas!',
  petSense: 'Riech was!',
  petSenseBelow: 'Riech was! ↓{n}',
  pets: 'Haustiere',
  petXp: '+EP',
};
