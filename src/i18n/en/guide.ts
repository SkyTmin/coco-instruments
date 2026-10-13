import type { Translation } from '../types';
import type { guide as ru } from '../ru/guide';

export const guide: Translation<typeof ru> = {
  mine: {
    title: 'Break 20 blocks',
    hint: 'Tap a block or hold your finger — the pickaxe swings by itself',
  },
  sell: { title: 'Sell your haul', hint: 'The backpack button below the field' },
  rankB: { title: 'Get rank B', hint: 'Save up coins and tap the rank bar' },
  case: { title: 'Open a chest', hint: 'The “Chests” button below. The rank gave you a key' },
  steel: {
    title: 'Forge the stone pickaxe',
    hint: 'On floor C, in the forge: limestone, sandstone and coins',
  },
  enchant: {
    title: 'Apply your first book',
    hint: 'The “Books” button below: the Enchanter sells books for tokens',
  },
  streak: {
    title: 'Push a streak to “Fired Up”',
    hint: '150 blocks non-stop — the bar above the field',
  },
  bomb: { title: 'Set off a bomb', hint: 'The bomb button below the field, then tap a cell' },
  level: { title: 'Get your pickaxe to level 5', hint: 'Every broken block is pickaxe XP' },
  rankE: {
    title: 'Get rank E',
    hint: "A rank needs a pickaxe that can break the next floor's ore",
  },
  bag: { title: 'Upgrade your backpack', hint: 'In the forge, under the pickaxe' },
  rankH: {
    title: 'Get rank H',
    hint: "From here you're on your own: ranks up to Z, then prestige",
  },
  parcel: {
    title: 'Open a parcel',
    hint: 'Parcels drop from blocks and ripen below the field while you dig',
  },
  rune: {
    title: 'Put a rune in your amulet',
    hint: '“More” → Runes. The first socket opens at pickaxe level 5',
  },
  pet: {
    title: 'Raise a pet to level 3',
    hint: 'The egg warms up while you dig; once hatched, it grows as you work',
  },
};
