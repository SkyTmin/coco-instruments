import type { Translation } from '../types';
import type { yardData as ru } from '../ru/yardData';

export const yardData: Translation<typeof ru> = {
  event: {
    meteor: {
      name: 'Meteorito',
      lead: 'Cayó en la mina. Rómpelo antes de que se enfríe: dentro hay contrabando',
    },
    kuiva: {
      name: 'Kuiva',
      lead: 'Un gigante de piedra salió de la roca. Golpéalo antes de que vuelva',
    },
    convoy: {
      name: 'Convoy',
      lead: 'El convoy necesita una carga de roca. Date prisa antes de que se vaya',
    },
    gold: {
      name: 'Veta de oro',
      lead: 'Cada bloque vale el triple',
    },
    payday: {
      name: 'Día de paga',
      lead: 'El comprador paga el doble por la roca',
    },
    magpie: {
      name: 'Urraca ladrona',
      lead: 'Suelta lo robado en la mina. Recógelo mientras esté ahí',
    },
    blizzard: {
      name: 'Tormenta',
      lead: 'El viento tumba el bosque: cada árbol caído arrastra al de al lado',
    },
    bear: {
      name: 'Señor de la taiga',
      lead: 'Un oso va a por la leña. Tala sin parar y lo espantarás',
    },
  },
  map: {
    square: 'Plaza',
    forge: 'Forja',
    mine: 'Mina',
    zone: 'Mina especial',
    lift: 'Ascensor a la mazmorra',
    tower: 'Torre del Encantador',
    kennel: 'Criadero',
    store: 'Almacén',
    kiosk: 'Quiosco',
    trader: 'Mercader',
    hq: 'Cuartel',
    club: 'Club',
    barrack1: 'Barracón 1',
  },
  npc: {
    smith: 'Herrero',
    mage: 'Encantador',
    foreman: 'Capataz',
    guard: 'Guardia',
    liftman: 'Ascensorista',
    keeper: 'Cuidadora',
    clerk: 'Almacenero',
    trader: 'Mercader',
    seller: 'Dependienta',
    chief: 'Alcaide',
    orderly: 'Celador',
    croupier: 'Crupier',
  },
  door: {
    forge: 'Forja',
    mine: 'Mina',
    zone: 'Mina especial',
    hq: 'Cuartel',
    kiosk: 'Quiosco',
    tower: 'Torre',
    lift: 'Ascensor',
    store: 'Almacén',
    kennel: 'Criadero',
    trader: 'Mercader',
    barrack1: 'Barracón 1',
    club: 'Club',
    square: 'Salir',
  },
  act: {
    board: 'Tablón',
    back: 'Salida',
    prison: 'Bajar',
    zone: 'Entrar',
    dungeon: 'Bajar',
    bunk: 'Mi cofre',
  },
};
