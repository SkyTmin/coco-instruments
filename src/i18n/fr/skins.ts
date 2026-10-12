import type { Translation } from '../types';
import type { skins as ru } from '../ru/skins';

export const skins: Translation<typeof ru> = {
  classic: {
    name: 'Classique',
    hint: 'Fruits et sept — comme à Las Vegas',
    title: 'Machines à sous',
    subtitle: 'Un petit jeu de chance',
  },
  asia: {
    name: 'Dragon',
    hint: 'Lanternes rouges, or et dragons',
    title: 'Porte du Dragon',
    subtitle: 'Lanternes, or et chance',
  },
  space: {
    name: 'Espace',
    hint: 'Planètes, fusées et extraterrestres',
    title: 'Espace lointain',
    subtitle: 'Des mises au bout de la galaxie',
  },
  pirate: {
    name: 'Pirates',
    hint: 'Ancres, sabres et coffre au trésor',
    title: 'Pavillon noir',
    subtitle: 'Le coffre attend les audacieux',
  },
  egypt: {
    name: 'Égypte',
    hint: 'Scarabées, chats et couronne du pharaon',
    title: 'L’Or du Nil',
    subtitle: 'Les trésors des pharaons',
  },
  candy: {
    name: 'Bonbons',
    hint: 'Sucettes, beignets et gâteaux',
    title: 'La Confiserie',
    subtitle: 'Faites tourner pour des sucettes',
  },
  pumpkin: {
    name: 'Nuit des citrouilles',
    hint: 'Toiles d’araignée, fantômes et citrouille-lanterne',
    title: 'Nuit des citrouilles',
    subtitle: 'Des bonbons ou un sort',
  },
  abyss: {
    name: 'Les Abysses',
    hint: 'Coraux, méduses et baleine tout au fond',
    title: 'Les Abysses',
    subtitle: 'Là où la lumière n’arrive pas',
  },
  neon: {
    name: 'Néon',
    hint: 'Une salle d’arcade la nuit — dès le niveau 5',
    title: 'Salle Néon',
    subtitle: 'L’arcade qui ne ferme jamais',
  },
  winter: {
    name: 'Hiver',
    hint: 'Neige, cadeaux et chocolat chaud — dès le niveau 9',
    title: 'Nuit glacée',
    subtitle: 'Neige, lumières et cadeaux',
  },
  olympus: {
    name: 'Olympe',
    hint: 'L’or des dieux et la foudre de Zeus — dès le niveau 12',
    title: 'Portes de l’Olympe',
    subtitle: 'L’or des dieux et la foudre de Zeus',
  },
  kupala: {
    name: 'Nuit du solstice',
    hint: 'Lucioles et fleur de fougère — dès le niveau 15',
    title: 'Fleur de fougère',
    subtitle: 'Une nuit par an pour trouver le trésor',
  },
  relic: {
    name: 'Relique',
    hint: 'L’or qu’on trouve une fois dans sa vie',
    title: 'Relique',
    subtitle: 'Ça ne se prend qu’une fois',
  },
};
