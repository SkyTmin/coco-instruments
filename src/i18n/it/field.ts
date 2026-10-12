import type { Translation } from '../types';
import type { field as ru } from '../ru/field';

export const field: Translation<typeof ru> = {
  beam: 'RAGGIO',
  vein: 'VENA ×{n}',
  crit: 'CRITICO',
  hammer: 'MARTELLO',
  blast: 'BUM',
  ore: '+{n} minerale',
  petDmg: 'Rinforzi!',
  petRate: 'A tutto gas!',
  petSense: 'Lo fiuto!',
  petSenseBelow: 'Lo fiuto! ↓{n}',
  pets: 'Animali',
  petXp: '+XP',
};
