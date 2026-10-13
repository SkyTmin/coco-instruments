import type { Translation } from '../types';
import type { field as ru } from '../ru/field';

export const field: Translation<typeof ru> = {
  beam: 'RAYO',
  vein: 'VETA ×{n}',
  crit: 'CRÍTICO',
  hammer: 'MARTILLO',
  blast: 'BUM',
  ore: '+{n} mineral',
  petDmg: '¡Refuerzos!',
  petRate: '¡A tope!',
  petSense: '¡Lo huelo!',
  petSenseBelow: '¡Lo huelo! ↓{n}',
  pets: 'Mascotas',
  petXp: '+XP',
};
