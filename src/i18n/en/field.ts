import type { Translation } from '../types';
import type { field as ru } from '../ru/field';

export const field: Translation<typeof ru> = {
  beam: 'BEAM',
  vein: 'VEIN ×{n}',
  crit: 'CRIT',
  hammer: 'JACKHAMMER',
  blast: 'BLAST',
  ore: '+{n} ore',
  petDmg: 'Backup!',
  petRate: 'Full speed!',
  petSense: 'I smell it!',
  petSenseBelow: 'I smell it! ↓{n}',
  pets: 'Pets',
  petXp: '+XP',
};
