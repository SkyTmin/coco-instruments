import type { Translation } from '../types';
import type { campData as ru } from '../ru/campData';

export const campData: Translation<typeof ru> = {
  egg: {
    moss: 'Moosei',
    stone: 'Steinei',
    crystal: 'Kristallei',
    dragon: 'Drachenei',
  },
  handle: {
    birch: 'Birkengriff',
    larch: 'Lärchengriff',
    karelian: 'Griff aus Maserbirke',
  },
  axe: {
    rusty: 'Rostige Axt',
    carpenter: 'Zimmermannsaxt',
    feller: 'Fällaxt',
    cleaver: 'Spaltaxt',
    bowsaw: 'Bügelsäge',
    druzhba: 'Kettensäge „Freundschaft“',
    ural: 'Kettensäge „Ural“',
  },
  species: {
    willow: {
      name: 'Weide',
      gen: 'aus Weide',
    },
    alder: {
      name: 'Erle',
      gen: 'aus Erle',
    },
    aspen: {
      name: 'Espe',
      gen: 'aus Espe',
    },
    birch: {
      name: 'Birke',
      gen: 'aus Birke',
    },
    rowan: {
      name: 'Eberesche',
      gen: 'aus Eberesche',
    },
    pine: {
      name: 'Kiefer',
      gen: 'aus Kiefer',
    },
    spruce: {
      name: 'Fichte',
      gen: 'aus Fichte',
    },
    larch: {
      name: 'Lärche',
      gen: 'aus Lärche',
    },
    juniper: {
      name: 'Wacholder',
      gen: 'aus Wacholder',
    },
    karelian: {
      name: 'Maserbirke',
      gen: 'aus Maserbirke',
    },
  },
  axeEnch: {
    chips: {
      name: 'Späne',
      per: '+4 % Chance auf einen Extrastamm',
    },
    resin: {
      name: 'Harz',
      per: '+20 % Tokens aus Stämmen',
    },
    sense: {
      name: 'Gespür',
      per: '+8 % Ausweichen vor Ästen, gefährliche Äste leuchten',
    },
    swing: {
      name: 'Ausholen',
      per: '+2 % zwei Stämme auf einmal',
    },
    fell: {
      name: 'Fällen',
      per: '+0,4 % Baum mit einem Schlag fällen',
    },
    storm: {
      name: 'Windbruch',
      per: '+2 % ein fallender Baum reißt den nächsten um',
    },
  },
  bench: {
    box: {
      name: 'Kiste',
      who: 'für die Fischfabrik',
    },
    stool: {
      name: 'Hocker',
      who: 'für die Baracke',
    },
    skis: {
      name: 'Skier',
      who: 'für einen Fallensteller',
    },
    barrel: {
      name: 'Fass',
      who: 'zum Einsalzen von Dorsch',
    },
    frame: {
      name: 'Fensterrahmen',
      who: 'für ein neues Haus',
    },
    sled: {
      name: 'Schleppschlitten',
      who: 'für einen Rentierhirten',
    },
    boat: {
      name: 'Fischerboot',
      who: 'für Fischer am Weißen Meer',
    },
  },
};
