import type { Translation } from '../types';
import type { guide as ru } from '../ru/guide';

export const guide: Translation<typeof ru> = {
  mine: {
    title: 'Casse 20 blocs',
    hint: 'Tape sur un bloc ou laisse le doigt appuyé — la pioche frappe toute seule',
  },
  sell: { title: 'Vends ton butin', hint: 'Le bouton « {sell} » près du sac' },
  rankB: { title: 'Passe au rang B', hint: 'Amasse des pièces et appuie sur la barre de rang' },
  case: { title: 'Ouvre un coffre', hint: 'Bouton « {chests} ». Le rang t’a donné une clé' },
  steel: {
    title: 'Forge la pioche de pierre',
    hint: 'À l’étage C, à la forge : calcaire, grès et pièces',
  },
  enchant: {
    title: 'Applique ton premier livre',
    hint: 'Bouton « {books} » : l’Enchanteur vend des livres contre des jetons',
  },
  streak: {
    title: 'Monte la série à « En feu »',
    hint: '150 blocs sans pause — la barre « {streak} »',
  },
  bomb: {
    title: 'Fais sauter une bombe',
    hint: 'Tape sur la bombe, puis sur une case',
  },
  level: {
    title: 'Monte ta pioche au niveau 5',
    hint: 'Chaque bloc cassé donne de l’XP à la pioche',
  },
  rankE: {
    title: 'Passe au rang E',
    hint: 'Pour ce rang, il faut une pioche qui casse le minerai de l’étage suivant',
  },
  bag: { title: 'Améliore ton sac', hint: 'À la forge, ligne « {bag} »' },
  rankH: {
    title: 'Passe au rang H',
    hint: 'Ensuite, à toi de jouer : les rangs jusqu’à Z, puis le prestige',
  },
  parcel: {
    title: 'Ouvre un colis',
    hint: 'Les colis tombent des blocs et mûrissent près du terrain pendant que tu creuses',
  },
  rune: {
    title: 'Sertis une rune dans l’amulette',
    hint: '« {camp} » → {runes}. Le premier emplacement s’ouvre au niveau 5 de la pioche',
  },
  pet: {
    title: 'Monte un familier au niveau 3',
    hint: 'L’œuf couve pendant que tu creuses ; une fois éclos, il grandit en travaillant',
  },
};
