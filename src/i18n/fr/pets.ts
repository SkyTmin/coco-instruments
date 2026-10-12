import type { Translation } from '../types';
import type { pets as ru } from '../ru/pets';

export const pets: Translation<typeof ru> = {
  mole: {
    name: 'Taupe Mineuse',
    lore: 'Première dans la galerie, dernière à en sortir',
  },
  roach: {
    name: 'Cafard Coureur',
    lore: 'Champion des courses de cafards, dossard sept',
  },
  mouse: {
    name: 'Souris Chapardeuse',
    lore: 'Ce qui traîne est à elle',
  },
  pigeon: {
    name: 'Pigeon Facteur',
    lore: 'Apporte des nouvelles du dehors, parfois bonnes',
  },
  cat: {
    name: 'Chat Balafré',
    lore: 'Marchande jusqu’à la dernière arête',
  },
  bulldog: {
    name: 'Bouledogue Cogneur',
    lore: 'Fend la roche d’un coup de tête',
  },
  ferret: {
    name: 'Furet Larbin',
    lore: 'Jamais une seconde en place',
  },
  scarab: {
    name: 'Scarabée',
    lore: 'Roule en boule tout ce qui brille',
  },
  badger: {
    name: 'Blaireau Foreur',
    lore: 'Creuse une galerie droite comme une règle',
  },
  owl: {
    name: 'Chouette Lanterne',
    lore: 'Éclaire là où c’est caché',
  },
  raccoon: {
    name: 'Raton Casseur',
    lore: 'Ouvre le minerai comme un coffre-fort',
  },
  shepherd: {
    name: 'Bergère Fidèle',
    lore: 'Ancienne chienne d’escorte, désormais des nôtres',
  },
  fox: {
    name: 'Renard Flambeur',
    lore: 'Toujours un as derrière l’oreille',
  },
  spider: {
    name: 'Araignée Crocheteuse',
    lore: 'Huit pattes, huit crochets',
  },
  dragon: {
    name: 'Dragon de Charbon',
    lore: 'Fait fondre la pierre en or',
  },
  wolf: {
    name: 'Loup Caïd',
    lore: 'A brisé sa chaîne, a rassemblé la meute',
  },
  raven: {
    name: 'Corbeau Porte-Clés',
    lore: 'Les clés de toutes les portes du camp',
  },
  phoenix: {
    name: 'Phénix de la Liberté',
    lore: 'Brûle et renaît, chaque fois plus libre',
  },
};
