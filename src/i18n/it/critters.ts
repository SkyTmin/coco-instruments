import type { Translation } from '../types';
import type { critters as ru } from '../ru/critters';

export const critters: Translation<typeof ru> = {
  bat: 'Pipistrello: prendilo',
  shiny: 'Luccichio: raccoglilo',
  from: {
    bat: 'Forziere del pipistrello',
    batRare: 'Forziere del pipistrello blu',
    magpie: 'Sacchetto della gazza',
    box: 'Scrigno dal fondo',
  },
  offer: {
    coins: 'Monete',
    tokens: 'Gettoni',
    key: 'Chiave',
    keys: 'Chiavi',
    rune: 'runa {text}',
  },
  risk: 'Rischio',
  win: 'Indovinato! Doppio',
  draw: 'Pari: stessa puntata',
  take: 'Incassa',
  double: 'Rischia',
  rule: 'Più alta di quella del banco: doppio; più bassa: bruciato',
  dealer: 'Banco · {rank}',
  card: 'Carta {n}',
  higher: 'Più alta! {v}',
  lower: 'Più bassa: bruciato',
  equal: 'Uguale: di nuovo',
  pick: 'Scegli una carta più alta',
  rank: {
    '9': 'J',
    '10': 'Q',
    '11': 'K',
    '12': 'A',
  },
};
