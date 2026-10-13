import type { Translation } from '../types';
import type { campData as ru } from '../ru/campData';

export const campData: Translation<typeof ru> = {
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
    druzhba: 'Tronçonneuse « Copain »',
    ural: 'Tronçonneuse « Oural »',
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
      per: "+4 % de chance d'une bûche en plus",
    },
    resin: {
      name: 'Résine',
      per: '+20 % de jetons sur les bûches',
    },
    sense: {
      name: 'Flair',
      per: "+8 % d'esquive des nœuds, le nœud dangereux brille",
    },
    swing: {
      name: 'Élan',
      per: "+2 % de couper deux bûches d'un coup",
    },
    fell: {
      name: 'Abattage',
      per: "+0,4 % d'abattre un arbre d'un coup",
    },
    storm: {
      name: 'Chablis',
      per: "+2 % qu'un arbre qui tombe abatte son voisin",
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
