import type { Translation } from '../types';
import type { campData as ru } from '../ru/campData';

export const campData: Translation<typeof ru> = {
  egg: {
    moss: 'Huevo de musgo',
    stone: 'Huevo de piedra',
    crystal: 'Huevo de cristal',
    dragon: 'Huevo de dragón',
  },
  handle: {
    birch: 'Mango de abedul',
    larch: 'Mango de alerce',
    karelian: 'Mango de abedul de Carelia',
  },
  axe: {
    rusty: 'Hacha oxidada',
    carpenter: 'Hacha de carpintero',
    feller: 'Hacha de leñador',
    cleaver: 'Hacha de partir',
    bowsaw: 'Sierra de arco',
    druzhba: 'Motosierra «Amistad»',
    ural: 'Motosierra «Ural»',
  },
  species: {
    willow: {
      name: 'Sauce',
      gen: 'de sauce',
    },
    alder: {
      name: 'Aliso',
      gen: 'de aliso',
    },
    aspen: {
      name: 'Álamo temblón',
      gen: 'de álamo',
    },
    birch: {
      name: 'Abedul',
      gen: 'de abedul',
    },
    rowan: {
      name: 'Serbal',
      gen: 'de serbal',
    },
    pine: {
      name: 'Pino',
      gen: 'de pino',
    },
    spruce: {
      name: 'Abeto',
      gen: 'de abeto',
    },
    larch: {
      name: 'Alerce',
      gen: 'de alerce',
    },
    juniper: {
      name: 'Enebro',
      gen: 'de enebro',
    },
    karelian: {
      name: 'Abedul de Carelia',
      gen: 'de abedul de Carelia',
    },
  },
  axeEnch: {
    chips: {
      name: 'Astillas',
      per: '+4 % de probabilidad de un tronco extra',
    },
    resin: {
      name: 'Resina',
      per: '+20 % de fichas de los troncos',
    },
    sense: {
      name: 'Olfato',
      per: '+8 % de esquivar nudos, el nudo peligroso brilla',
    },
    swing: {
      name: 'Impulso',
      per: '+2 % de cortar dos troncos a la vez',
    },
    fell: {
      name: 'Tala',
      per: '+0,4 % de talar un árbol de un golpe',
    },
    storm: {
      name: 'Vendaval',
      per: '+2 % de que el árbol que cae tumbe al vecino',
    },
  },
  bench: {
    box: {
      name: 'Caja',
      who: 'para la conservera',
    },
    stool: {
      name: 'Taburete',
      who: 'para el barracón',
    },
    skis: {
      name: 'Esquís',
      who: 'para un trampero',
    },
    barrel: {
      name: 'Barril',
      who: 'para salar bacalao',
    },
    frame: {
      name: 'Marco de ventana',
      who: 'para una casa nueva',
    },
    sled: {
      name: 'Trineo',
      who: 'para un pastor de renos',
    },
    boat: {
      name: 'Barca',
      who: 'para pescadores del mar Blanco',
    },
  },
};
