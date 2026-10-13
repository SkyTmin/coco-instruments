import type { Translation } from '../types';
import type { campData as ru } from '../ru/campData';

export const campData: Translation<typeof ru> = {
  handle: {
    birch: 'Manico di betulla',
    larch: 'Manico di larice',
    karelian: 'Manico di betulla di Carelia',
  },
  axe: {
    rusty: 'Ascia arrugginita',
    carpenter: 'Ascia da carpentiere',
    feller: 'Ascia da boscaiolo',
    cleaver: 'Spaccalegna',
    bowsaw: 'Sega ad arco',
    druzhba: 'Motosega «Amicizia»',
    ural: 'Motosega «Ural»',
  },
  species: {
    willow: {
      name: 'Salice',
      gen: 'di salice',
    },
    alder: {
      name: 'Ontano',
      gen: 'di ontano',
    },
    aspen: {
      name: 'Pioppo tremulo',
      gen: 'di pioppo',
    },
    birch: {
      name: 'Betulla',
      gen: 'di betulla',
    },
    rowan: {
      name: 'Sorbo',
      gen: 'di sorbo',
    },
    pine: {
      name: 'Pino',
      gen: 'di pino',
    },
    spruce: {
      name: 'Abete rosso',
      gen: "d'abete",
    },
    larch: {
      name: 'Larice',
      gen: 'di larice',
    },
    juniper: {
      name: 'Ginepro',
      gen: 'di ginepro',
    },
    karelian: {
      name: 'Betulla di Carelia',
      gen: 'di betulla di Carelia',
    },
  },
  axeEnch: {
    chips: {
      name: 'Trucioli',
      per: '+4% di probabilità di un tronco in più',
    },
    resin: {
      name: 'Resina',
      per: '+20% gettoni dai tronchi',
    },
    sense: {
      name: 'Fiuto',
      per: '+8% di schivare i rami, quello pericoloso si illumina',
    },
    swing: {
      name: 'Slancio',
      per: '+2% di tagliare due tronchi insieme',
    },
    fell: {
      name: 'Abbattimento',
      per: '+0,4% di abbattere un albero in un colpo',
    },
    storm: {
      name: 'Schianto',
      per: "+2% che l'albero che cade abbatta il vicino",
    },
  },
  bench: {
    box: {
      name: 'Cassetta',
      who: 'per il conservificio',
    },
    stool: {
      name: 'Sgabello',
      who: 'per la baracca',
    },
    skis: {
      name: 'Sci',
      who: 'per un cacciatore',
    },
    barrel: {
      name: 'Botte',
      who: 'per salare il merluzzo',
    },
    frame: {
      name: 'Telaio di finestra',
      who: 'per una casa nuova',
    },
    sled: {
      name: 'Slitta',
      who: 'per un allevatore di renne',
    },
    boat: {
      name: 'Barca',
      who: 'per i pescatori del Mar Bianco',
    },
  },
};
