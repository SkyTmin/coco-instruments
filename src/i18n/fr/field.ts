import type { Translation } from '../types';
import type { field as ru } from '../ru/field';

export const field: Translation<typeof ru> = {
  beam: 'RAYON',
  vein: 'FILON ×{n}',
  crit: 'CRITIQUE',
  hammer: 'MARTEAU',
  blast: 'BOUM',
  ore: '+{n} minerai',
  petDmg: 'Renfort !',
  petRate: 'À fond !',
  petSense: 'Je le sens !',
  petSenseBelow: 'Je le sens ! ↓{n}',
  pets: 'Animaux',
  petXp: '+XP',
};
