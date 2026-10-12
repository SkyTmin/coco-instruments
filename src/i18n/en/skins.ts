import type { Translation } from '../types';
import type { skins as ru } from '../ru/skins';

export const skins: Translation<typeof ru> = {
  classic: {
    name: 'Classic',
    hint: 'Fruit and sevens — straight out of Vegas',
    title: 'Slots',
    subtitle: 'A little game of luck',
  },
  asia: {
    name: 'Dragon',
    hint: 'Red lanterns, gold and dragons',
    title: 'Dragon Gate',
    subtitle: 'Lanterns, gold and luck',
  },
  space: {
    name: 'Space',
    hint: 'Planets, rockets and aliens',
    title: 'Deep Space',
    subtitle: 'Bets at the edge of the galaxy',
  },
  pirate: {
    name: 'Pirates',
    hint: 'Anchors, sabres and a chest of gold',
    title: 'Black Flag',
    subtitle: 'The chest awaits the bold',
  },
  egypt: {
    name: 'Egypt',
    hint: 'Scarabs, cats and the pharaoh’s crown',
    title: 'Gold of the Nile',
    subtitle: 'Treasures of the pharaohs',
  },
  candy: {
    name: 'Sweets',
    hint: 'Lollipops, donuts and cakes',
    title: 'Candy Shop',
    subtitle: 'Spin for lollipops',
  },
  pumpkin: {
    name: 'Pumpkin Night',
    hint: 'Cobwebs, ghosts and a jack-o’-lantern',
    title: 'Pumpkin Night',
    subtitle: 'Trick or treat',
  },
  abyss: {
    name: 'The Abyss',
    hint: 'Corals, jellyfish and a whale far below',
    title: 'The Abyss',
    subtitle: 'Where the light never reaches',
  },
  neon: {
    name: 'Neon',
    hint: 'A late-night arcade — unlocks at level 5',
    title: 'Neon Arcade',
    subtitle: 'The arcade that never closes',
  },
  winter: {
    name: 'Winter',
    hint: 'Snow, presents and cocoa — unlocks at level 9',
    title: 'Frosty Night',
    subtitle: 'Snow, lights and presents',
  },
  olympus: {
    name: 'Olympus',
    hint: 'Gold of the gods and Zeus’s lightning — unlocks at level 12',
    title: 'Gates of Olympus',
    subtitle: 'Gold of the gods and Zeus’s lightning',
  },
  kupala: {
    name: 'Midsummer Night',
    hint: 'Fireflies and the fern flower — unlocks at level 15',
    title: 'Fern Flower',
    subtitle: 'One night a year to find the treasure',
  },
  relic: {
    name: 'Relic',
    hint: 'Gold you find once in a lifetime',
    title: 'Relic',
    subtitle: 'Taken only once',
  },
};
