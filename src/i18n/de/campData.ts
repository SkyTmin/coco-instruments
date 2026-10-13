import type { Translation } from '../types';
import type { campData as ru } from '../ru/campData';

export const campData: Translation<typeof ru> = {
  find: {
    coin: {
      name: 'Alte Münze',
      text: 'Eine Kopeke von 1799',
    },
    key: {
      name: 'Zellenschlüssel',
      text: 'Rostig, aber er dreht sich noch',
    },
    fern: {
      name: 'Farnabdruck',
      text: 'Karbonzeit',
    },
    ammonite: {
      name: 'Ammonit',
      text: 'Spiralförmig gedrehte Schale',
    },
    trilobite: {
      name: 'Trilobit',
      text: 'Eine halbe Milliarde Jahre alt',
    },
    nugget: {
      name: 'Goldnugget',
      text: 'Reines Gold ohne Beimischung',
    },
    tooth: {
      name: 'Mammutzahn',
      text: 'Vom Permafrost bewahrt',
    },
    geode: {
      name: 'Geode',
      text: 'Außen Stein, innen Amethyst',
    },
    amber: {
      name: 'Bernstein mit Fliege',
      text: 'Vor vierzig Millionen Jahren erstarrt',
    },
    medal: {
      name: 'Kaiserliche Medaille',
      text: '„Für Fleiß“',
    },
    core: {
      name: 'Bohrkern der Kola-Bohrung',
      text: 'Aus zwölf Kilometern Tiefe',
    },
    lamp: {
      name: 'Lampe des ersten Kumpels',
      text: 'Brennt noch immer',
    },
  },
  mile: {
    b1k: {
      title: 'Tausend Blöcke',
      text: 'Mit eigenen Händen abbauen',
    },
    b10k: {
      title: 'Zehntausend',
      text: 'Mit eigenen Händen abbauen',
    },
    b100k: {
      title: 'Hunderttausend',
      text: 'Mit eigenen Händen abbauen',
    },
    b1m: {
      title: 'Eine Million',
      text: 'Mit eigenen Händen abbauen',
    },
    z: {
      title: 'Erstes Z',
      text: 'Den letzten Rang erreichen',
    },
    p1: {
      title: 'Prestige 1',
      text: 'Die zweite Strafe antreten',
    },
    p5: {
      title: 'Prestige 5',
      text: 'Fünfte Strafe',
    },
    p10: {
      title: 'Prestige 10',
      text: 'Vierter Runensockel',
    },
    p20: {
      title: 'Prestige 20',
      text: 'Zwanzig Strafen',
    },
    legend: {
      title: 'Stollenlegende',
      text: 'Serie bis „Stollenlegende“ steigern',
    },
    pets6: {
      title: 'Sechs Arten',
      text: 'Sechs verschiedene Tiere ausbrüten',
    },
    hatch50: {
      title: 'Glucke',
      text: 'Fünfzig Eier ausbrüten',
    },
    golden: {
      title: 'Goldenes Tier',
      text: 'Fünf gleiche sammeln',
    },
    zoo: {
      title: 'Der ganze Zoo',
      text: 'Alle 18 sammeln',
    },
    cases: {
      title: 'Hundert Truhen',
      text: 'Mit Schlüsseln öffnen',
    },
    seid: {
      title: 'Seid-Hüter',
      text: 'Zehn Seid-Steine zerschlagen',
    },
    bats: {
      title: 'Fledermausfänger',
      text: 'Dreißig Fledermäuse fangen',
    },
    parcels: {
      title: 'Hundert Pakete',
      text: 'Öffnen',
    },
  },
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
