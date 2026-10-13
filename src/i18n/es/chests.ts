import type { Translation } from '../types';
import type { chests as ru } from '../ru/chests';

export const chests: Translation<typeof ru> = {
  tier: { common: 'Común', rare: 'Raro', epic: 'Épico', legend: 'Legendario' },
  full: {
    common: 'Cofre común',
    rare: 'Cofre raro',
    epic: 'Cofre épico',
    legend: 'Cofre legendario',
  },
  key: 'Llave',
  keys: { one: '{n} llave', many: '{n} de llaves', other: '{n} llaves' },
  treat: 'Chuche para mascota',
  treats: 'Chuche para mascota ×{n}',
  sub: {
    book: 'libro · {v} % de probabilidad',
    rune: 'runa · a la bolsa',
    find: 'hallazgo · a la colección',
    pet: 'mascota nueva',
    egg: 'huevo · al nido',
    keys: 'un cofre más',
    item: 'a tus consumibles',
  },
  openAria: 'Abrir un cofre',
  open: 'Abrir',
  all: 'Todos · {n}',
  hint: 'Las llaves caen de los bloques; te dan una por rango y un puñado por prestigio',
  recent: 'Lo último de los cofres',
  shattered: 'La bolsa de runas está llena: la runa se rompe en {n} ✦',
  shatteredMany: 'La bolsa de runas está llena: las sobrantes se rompen en {n} ✦',
  again: 'Otra · {key} {n}',
  skipOpen: 'toca para abrir ya',
  skipSum: 'toca para ver el total',
  opened: {
    one: '{n} cofre abierto',
    many: '{n} de cofres abiertos',
    other: '{n} cofres abiertos',
  },
  total: 'Total',
  newPets: 'Mascota nueva: {names}',
  takeAll: 'Llevármelo todo',
};
