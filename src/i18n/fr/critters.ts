import type { Translation } from '../types';
import type { critters as ru } from '../ru/critters';

export const critters: Translation<typeof ru> = {
  bat: 'Chauve-souris — attrape-la',
  shiny: 'Brillant — ramasse-le',
  from: {
    bat: 'Coffret de la chauve-souris',
    batRare: 'Coffret de la chauve-souris bleue',
    magpie: 'Bourse de la pie',
    box: 'Coffret du fond',
  },
  offer: {
    coins: 'Pièces',
    tokens: 'Jetons',
    key: 'Clé',
    keys: 'Clés',
    rune: 'rune {text}',
  },
  risk: 'Risque',
  win: 'Gagné ! Doublé',
  draw: 'Égalité — même mise',
  take: 'Prendre',
  double: 'Risquer',
  rule: 'Plus haute que celle du croupier — double ; plus basse — perdu',
  dealer: 'Croupier · {rank}',
  card: 'Carte {n}',
  higher: 'Plus haute ! {v}',
  lower: 'Plus basse — perdu',
  equal: 'Égale — on rejoue',
  pick: 'Choisis une carte plus haute',
  rank: {
    '9': 'V',
    '10': 'D',
    '11': 'R',
    '12': 'A',
  },
};
