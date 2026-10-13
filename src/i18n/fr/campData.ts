import type { Translation } from '../types';
import type { campData as ru } from '../ru/campData';

export const campData: Translation<typeof ru> = {
  find: {
    coin: {
      name: 'Vieille pièce',
      text: 'Un kopeck de 1799',
    },
    key: {
      name: 'Clé de cellule',
      text: 'Rouillée, mais elle tourne encore',
    },
    fern: {
      name: 'Empreinte de fougère',
      text: 'Période carbonifère',
    },
    ammonite: {
      name: 'Ammonite',
      text: 'Une coquille enroulée en spirale',
    },
    trilobite: {
      name: 'Trilobite',
      text: "Il a un demi-milliard d'années",
    },
    nugget: {
      name: 'Pépite',
      text: 'De l’or pur, sans mélange',
    },
    tooth: {
      name: 'Dent de mammouth',
      text: 'Conservée par le permafrost',
    },
    geode: {
      name: 'Géode',
      text: 'Pierre dehors, améthyste dedans',
    },
    amber: {
      name: 'Ambre à mouche',
      text: "Une mouche figée il y a quarante millions d'années",
    },
    medal: {
      name: 'Médaille impériale',
      text: '« Pour le zèle »',
    },
    core: {
      name: 'Carotte du forage de Kola',
      text: 'De douze kilomètres de profondeur',
    },
    lamp: {
      name: 'Lampe du premier mineur',
      text: 'Elle brûle encore',
    },
  },
  mile: {
    b1k: {
      title: 'Mille blocs',
      text: 'À casser de tes mains',
    },
    b10k: {
      title: 'Dix mille',
      text: 'À casser de tes mains',
    },
    b100k: {
      title: 'Cent mille',
      text: 'À casser de tes mains',
    },
    b1m: {
      title: 'Un million',
      text: 'À casser de tes mains',
    },
    z: {
      title: 'Premier Z',
      text: 'Atteindre le dernier rang',
    },
    p1: {
      title: 'Prestige 1',
      text: 'Commencer ta deuxième peine',
    },
    p5: {
      title: 'Prestige 5',
      text: 'Cinquième peine',
    },
    p10: {
      title: 'Prestige 10',
      text: 'Quatrième emplacement de rune',
    },
    p20: {
      title: 'Prestige 20',
      text: 'Vingt peines',
    },
    legend: {
      title: 'Légende de la mine',
      text: 'Pousser ta série jusqu’à « Légende de la mine »',
    },
    pets6: {
      title: 'Six espèces',
      text: 'Faire éclore six animaux différents',
    },
    hatch50: {
      title: 'Mère poule',
      text: 'Couver cinquante œufs',
    },
    golden: {
      title: 'Animal doré',
      text: 'Réunir cinq identiques',
    },
    zoo: {
      title: 'Tout le zoo',
      text: 'Réunir les 18',
    },
    cases: {
      title: 'Cent coffres',
      text: 'À ouvrir avec des clés',
    },
    seid: {
      title: 'Gardien des seids',
      text: 'Briser dix pierres seid',
    },
    bats: {
      title: 'Chasseur de chauves-souris',
      text: 'Attraper trente chauves-souris',
    },
    parcels: {
      title: 'Cent colis',
      text: 'À ouvrir',
    },
  },
  egg: {
    moss: 'Œuf de mousse',
    stone: 'Œuf de pierre',
    crystal: 'Œuf de cristal',
    dragon: 'Œuf de dragon',
  },
  handle: {
    birch: 'Manche en bouleau',
    larch: 'Manche en mélèze',
    karelian: 'Manche en bouleau de Carélie',
  },
  axe: {
    rusty: 'Hache rouillée',
    carpenter: 'Hache de charpentier',
    feller: 'Hache de bûcheron',
    cleaver: 'Merlin',
    bowsaw: 'Scie à archet',
    druzhba: 'Tronçonneuse « Copain »',
    ural: 'Tronçonneuse « Oural »',
  },
  species: {
    willow: {
      name: 'Saule',
      gen: 'de saule',
    },
    alder: {
      name: 'Aulne',
      gen: "d'aulne",
    },
    aspen: {
      name: 'Tremble',
      gen: 'de tremble',
    },
    birch: {
      name: 'Bouleau',
      gen: 'de bouleau',
    },
    rowan: {
      name: 'Sorbier',
      gen: 'de sorbier',
    },
    pine: {
      name: 'Pin',
      gen: 'de pin',
    },
    spruce: {
      name: 'Épicéa',
      gen: "d'épicéa",
    },
    larch: {
      name: 'Mélèze',
      gen: 'de mélèze',
    },
    juniper: {
      name: 'Genévrier',
      gen: 'de genévrier',
    },
    karelian: {
      name: 'Bouleau de Carélie',
      gen: 'de bouleau de Carélie',
    },
  },
  axeEnch: {
    chips: {
      name: 'Copeaux',
      per: "+4 % de chance d'une bûche en plus",
    },
    resin: {
      name: 'Résine',
      per: '+20 % de jetons sur les bûches',
    },
    sense: {
      name: 'Flair',
      per: "+8 % d'esquive des nœuds, le nœud dangereux brille",
    },
    swing: {
      name: 'Élan',
      per: "+2 % de couper deux bûches d'un coup",
    },
    fell: {
      name: 'Abattage',
      per: "+0,4 % d'abattre un arbre d'un coup",
    },
    storm: {
      name: 'Chablis',
      per: "+2 % qu'un arbre qui tombe abatte son voisin",
    },
  },
  bench: {
    box: {
      name: 'Caisse',
      who: 'pour la conserverie',
    },
    stool: {
      name: 'Tabouret',
      who: 'pour la baraque',
    },
    skis: {
      name: 'Skis',
      who: 'pour un trappeur',
    },
    barrel: {
      name: 'Tonneau',
      who: 'pour saler la morue',
    },
    frame: {
      name: 'Châssis de fenêtre',
      who: 'pour une maison neuve',
    },
    sled: {
      name: 'Traîneau',
      who: 'pour un éleveur de rennes',
    },
    boat: {
      name: 'Barque',
      who: 'pour les pêcheurs de la mer Blanche',
    },
  },
};
