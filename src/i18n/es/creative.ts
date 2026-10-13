import type { Translation } from '../types';
import type { creative as ru } from '../ru/creative';

export const creative: Translation<typeof ru> = {
  lead1:
    'Modo libre: todos los pisos, ascensores y jefes abiertos, monedas, fichas y llaves sin límite; rango, pico y equipo los eliges tú.',
  lead2:
    'Tu partida real no se toca: el creativo guarda aparte. Al salir todo vuelve a estar como antes, y lo que hiciste en creativo se queda en creativo.',
  enter: 'Activar creativo',
  where: 'Ir a',
  yard: 'Patio',
  mine: 'Mina',
  dungeon: 'Mazmorra',
  hall: 'Casino',
  wallet: 'Monedero',
  money: '{coins} monedas · {tokens} fichas · {keys} llaves',
  addCoins: '+100 M de monedas',
  addStuff: 'Fichas, llaves, huevos',
  rank: 'Rango',
  prestige: 'Prestigio',
  pick: 'Pico',
  floors: 'Pisos abiertos: {n} de {total}',
  tier: 'Nivel',
  plus: 'Afilado',
  god: 'Inmortalidad (desde la próxima incursión)',
  bosses: 'Jefes listos',
  stash: 'Almacén a 99',
  leaveSure: '¿Seguro? Lo hecho en creativo se perderá',
  leave: 'Salir del creativo',
  badge: 'CREATIVO',
  title: 'Creativo',
  rowOn: 'Creativo activado: ajustar',
  row: 'Modo creativo',
};
