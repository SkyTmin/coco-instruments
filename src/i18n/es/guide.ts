import type { Translation } from '../types';
import type { guide as ru } from '../ru/guide';

export const guide: Translation<typeof ru> = {
  mine: {
    title: 'Rompe 20 bloques',
    hint: 'Toca un bloque o mantén el dedo — el pico golpea solo',
  },
  sell: { title: 'Vende el botín', hint: 'El botón de la mochila, bajo el campo' },
  rankB: { title: 'Consigue el rango B', hint: 'Junta monedas y toca la barra de rango' },
  case: { title: 'Abre un cofre', hint: 'Botón «Cofres» abajo. El rango te dio una llave' },
  steel: {
    title: 'Forja el pico de piedra',
    hint: 'En el piso C, en la forja: caliza, arenisca y monedas',
  },
  enchant: {
    title: 'Aplica tu primer libro',
    hint: 'Botón «Libros» abajo: el Encantador vende libros por fichas',
  },
  streak: {
    title: 'Lleva la racha a «A tope»',
    hint: '150 bloques sin parar — la barra sobre el campo',
  },
  bomb: {
    title: 'Haz estallar una bomba',
    hint: 'El botón de la bomba bajo el campo y luego toca una casilla',
  },
  level: { title: 'Sube el pico al nivel 5', hint: 'Cada bloque roto da experiencia al pico' },
  rankE: {
    title: 'Consigue el rango E',
    hint: 'Para el rango hace falta un pico que rompa el mineral del piso siguiente',
  },
  bag: { title: 'Mejora la mochila', hint: 'En la forja, debajo del pico' },
  rankH: {
    title: 'Consigue el rango H',
    hint: 'Desde aquí, tú solo: rangos hasta la Z y luego el prestigio',
  },
  parcel: {
    title: 'Abre un paquete',
    hint: 'Los paquetes caen de los bloques y maduran junto al campo mientras cavas',
  },
  rune: {
    title: 'Engarza una runa en el amuleto',
    hint: '«{camp}» → {runes}. La primera ranura se abre con el pico a nivel 5',
  },
  pet: {
    title: 'Sube una mascota al nivel 3',
    hint: 'El huevo se calienta mientras cavas; al nacer, crece con el trabajo',
  },
};
