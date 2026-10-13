import type { Translation } from '../types';
import type { campData as ru } from '../ru/campData';

export const campData: Translation<typeof ru> = {
  find: {
    coin: {
      name: 'Moneta antica',
      text: 'Un copeco del 1799',
    },
    key: {
      name: 'Chiave della cella',
      text: 'Arrugginita, ma gira ancora',
    },
    fern: {
      name: 'Impronta di felce',
      text: 'Periodo Carbonifero',
    },
    ammonite: {
      name: 'Ammonite',
      text: 'Una conchiglia avvolta a spirale',
    },
    trilobite: {
      name: 'Trilobite',
      text: 'Ha mezzo miliardo di anni',
    },
    nugget: {
      name: "Pepita d'oro",
      text: 'Oro puro, senza impurità',
    },
    tooth: {
      name: 'Dente di mammut',
      text: 'Conservato dal permafrost',
    },
    geode: {
      name: 'Geode',
      text: 'Fuori pietra, dentro ametista',
    },
    amber: {
      name: 'Ambra con moscerino',
      text: 'Un moscerino fermo da quaranta milioni di anni',
    },
    medal: {
      name: 'Medaglia imperiale',
      text: '«Per lo zelo»',
    },
    core: {
      name: 'Carota del pozzo di Kola',
      text: 'Da dodici chilometri di profondità',
    },
    lamp: {
      name: 'Lampada del primo minatore',
      text: 'È ancora accesa',
    },
  },
  mile: {
    b1k: {
      title: 'Mille blocchi',
      text: 'Rompili con le tue mani',
    },
    b10k: {
      title: 'Diecimila',
      text: 'Rompili con le tue mani',
    },
    b100k: {
      title: 'Centomila',
      text: 'Rompili con le tue mani',
    },
    b1m: {
      title: 'Un milione',
      text: 'Rompili con le tue mani',
    },
    z: {
      title: 'Prima Z',
      text: "Raggiungi l'ultimo grado",
    },
    p1: {
      title: 'Prestigio 1',
      text: 'Inizia la seconda condanna',
    },
    p5: {
      title: 'Prestigio 5',
      text: 'Quinta condanna',
    },
    p10: {
      title: 'Prestigio 10',
      text: 'Quarto incastro per rune',
    },
    p20: {
      title: 'Prestigio 20',
      text: 'Venti condanne',
    },
    legend: {
      title: 'Leggenda della miniera',
      text: 'Porta la serie fino a «Leggenda della miniera»',
    },
    pets6: {
      title: 'Sei specie',
      text: 'Fai nascere sei animali diversi dalle uova',
    },
    hatch50: {
      title: 'Chioccia',
      text: 'Cova cinquanta uova',
    },
    golden: {
      title: "Animale d'oro",
      text: 'Raccogline cinque uguali',
    },
    zoo: {
      title: 'Tutto lo zoo',
      text: 'Raccoglili tutti e 18',
    },
    cases: {
      title: 'Cento forzieri',
      text: 'Aprili con le chiavi',
    },
    seid: {
      title: 'Custode dei seid',
      text: 'Rompi dieci pietre seid',
    },
    bats: {
      title: 'Acchiappapipistrelli',
      text: 'Cattura trenta pipistrelli',
    },
    parcels: {
      title: 'Cento pacchi',
      text: 'Aprili',
    },
  },
  egg: {
    moss: 'Uovo di muschio',
    stone: 'Uovo di pietra',
    crystal: 'Uovo di cristallo',
    dragon: 'Uovo di drago',
  },
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
      per: '+8% di schivare i nodi, quello pericoloso si illumina',
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
