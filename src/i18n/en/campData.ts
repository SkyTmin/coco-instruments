import type { Translation } from '../types';
import type { campData as ru } from '../ru/campData';

export const campData: Translation<typeof ru> = {
  handle: {
    birch: 'Birch Handle',
    larch: 'Larch Handle',
    karelian: 'Karelian Birch Handle',
  },
  axe: {
    rusty: 'Rusty Axe',
    carpenter: "Carpenter's Axe",
    feller: 'Felling Axe',
    cleaver: 'Splitting Maul',
    bowsaw: 'Bow Saw',
    druzhba: '“Buddy” Chainsaw',
    ural: '“Ural” Chainsaw',
  },
  species: {
    willow: {
      name: 'Willow',
      gen: 'willow',
    },
    alder: {
      name: 'Alder',
      gen: 'alder',
    },
    aspen: {
      name: 'Aspen',
      gen: 'aspen',
    },
    birch: {
      name: 'Birch',
      gen: 'birch',
    },
    rowan: {
      name: 'Rowan',
      gen: 'rowan',
    },
    pine: {
      name: 'Pine',
      gen: 'pine',
    },
    spruce: {
      name: 'Spruce',
      gen: 'spruce',
    },
    larch: {
      name: 'Larch',
      gen: 'larch',
    },
    juniper: {
      name: 'Juniper',
      gen: 'juniper',
    },
    karelian: {
      name: 'Karelian Birch',
      gen: 'Karelian birch',
    },
  },
  axeEnch: {
    chips: {
      name: 'Wood Chips',
      per: '+4% chance of an extra log',
    },
    resin: {
      name: 'Resin',
      per: '+20% tokens from logs',
    },
    sense: {
      name: 'Instinct',
      per: '+8% to dodge a branch, dangerous branches glow',
    },
    swing: {
      name: 'Big Swing',
      per: '+2% to chop two logs at once',
    },
    fell: {
      name: 'Felling',
      per: '+0.4% to fell a tree in one hit',
    },
    storm: {
      name: 'Windfall',
      per: '+2% a falling tree knocks down the next',
    },
  },
  bench: {
    box: {
      name: 'Crate',
      who: 'for the fish plant',
    },
    stool: {
      name: 'Stool',
      who: 'for the barracks',
    },
    skis: {
      name: 'Skis',
      who: 'for a trapper',
    },
    barrel: {
      name: 'Barrel',
      who: 'for salting cod',
    },
    frame: {
      name: 'Window Frame',
      who: 'for a new house',
    },
    sled: {
      name: 'Drag Sled',
      who: 'for a reindeer herder',
    },
    boat: {
      name: 'Fishing Boat',
      who: 'for White Sea fishermen',
    },
  },
};
