import type { Translation } from '../types';
import type { chests as ru } from '../ru/chests';

export const chests: Translation<typeof ru> = {
  tier: { common: 'Common', rare: 'Rare', epic: 'Epic', legend: 'Legendary' },
  full: {
    common: 'Common Chest',
    rare: 'Rare Chest',
    epic: 'Epic Chest',
    legend: 'Legendary Chest',
  },
  key: 'Key',
  keys: { one: '{n} key', other: '{n} keys' },
  treat: 'Pet treat',
  treats: 'Pet treat ×{n}',
  sub: {
    book: 'book · {v}% chance',
    rune: 'rune · to the pouch',
    find: 'find · to the collection',
    pet: 'new pet',
    egg: 'egg · to the nest',
    keys: 'one more chest',
    item: 'to your consumables',
  },
  openAria: 'Open a chest',
  open: 'Open',
  all: 'All · {n}',
  hint: 'Keys drop from blocks; you get one per rank and a bunch per prestige',
  recent: 'Latest from chests',
  shattered: 'Rune pouch is full — the rune was smashed into {n} ✦',
  shatteredMany: 'Rune pouch is full — the extras were smashed into {n} ✦',
  again: 'Again · {key} {n}',
  skipOpen: 'tap to open now',
  skipSum: 'tap to see the total',
  opened: { one: 'Opened {n} chest', other: 'Opened {n} chests' },
  total: 'Total',
  newPets: 'New pet: {names}',
  takeAll: 'Take it all',
};
