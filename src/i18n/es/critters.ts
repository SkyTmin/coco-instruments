import type { Translation } from '../types';
import type { critters as ru } from '../ru/critters';

export const critters: Translation<typeof ru> = {
  bat: 'Murciélago: atrápalo',
  shiny: 'Brillo: recógelo',
  from: {
    bat: 'Cofrecito del murciélago',
    batRare: 'Cofrecito del murciélago azul',
    magpie: 'Bolsa de la urraca',
    box: 'Cajita del fondo',
  },
  offer: {
    coins: 'Monedas',
    tokens: 'Fichas',
    key: 'Llave',
    keys: 'Llaves',
    rune: 'runa {text}',
  },
  risk: 'Riesgo',
  win: '¡Acertaste! Doble',
  draw: 'Empate: misma apuesta',
  take: 'Cobrar',
  double: 'Arriesgar',
  rule: 'Más alta que la del crupier: doble; más baja: se quema',
  dealer: 'Crupier · {rank}',
  card: 'Carta {n}',
  higher: '¡Más alta! {v}',
  lower: 'Más baja: se quemó',
  equal: 'Igual: otra vez',
  pick: 'Elige una carta más alta',
  rank: {
    '9': 'J',
    '10': 'Q',
    '11': 'K',
    '12': 'A',
  },
};
