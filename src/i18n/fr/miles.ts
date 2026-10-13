import type { Translation } from '../types';
import type { miles as ru } from '../ru/miles';

export const miles: Translation<typeof ru> = {
  b1k: { title: 'Mille blocs', text: 'Casser de tes propres mains' },
  b10k: { title: 'Dix mille', text: 'Casser de tes propres mains' },
  b100k: { title: 'Cent mille', text: 'Casser de tes propres mains' },
  b1m: { title: 'Un million', text: 'Casser de tes propres mains' },
  z: { title: 'Premier Z', text: 'Atteindre le dernier rang' },
  p1: { title: 'Prestige 1', text: 'Commencer ta deuxième peine' },
  p5: { title: 'Prestige 5', text: 'Cinquième peine' },
  p10: { title: 'Prestige 10', text: 'Quatrième emplacement de rune' },
  p20: { title: 'Prestige 20', text: 'Vingt peines' },
  legend: { title: 'Légende de la mine', text: 'Pousser la série jusqu’à « Légende de la mine »' },
  pets6: { title: 'Six espèces', text: 'Faire éclore six familiers différents' },
  hatch50: { title: 'Mère poule', text: 'Faire éclore cinquante œufs' },
  golden: { title: 'Familier doré', text: 'Réunir cinq identiques' },
  zoo: { title: 'Tout le zoo', text: 'Les réunir tous les 18' },
  cases: { title: 'Cent coffres', text: 'Les ouvrir avec des clés' },
  seid: { title: 'Gardien des seids', text: 'Briser dix pierres seid' },
  bats: { title: 'Chasseur de chauves-souris', text: 'Attraper trente chauves-souris' },
  parcels: { title: 'Cent colis', text: 'Les ouvrir' },
};
