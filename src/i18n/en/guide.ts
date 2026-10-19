import type { Translation } from '../types';
import type { guide as ru } from '../ru/guide';

export const guide: Translation<typeof ru> = {
  mine: {
    title: 'Break 20 blocks',
    hint: 'Tap a block or hold your finger — the pickaxe swings by itself',
  },
  sell: { title: 'Sell your haul', hint: 'The “{sell}” button by the backpack' },
  rankB: { title: 'Get rank B', hint: 'Save up coins and tap the rank bar' },
  case: { title: 'Open a chest', hint: 'The “{chests}” button. The rank gave you a key' },
  steel: {
    title: 'Forge the stone pickaxe',
    hint: 'On floor C, in the forge: limestone, sandstone and coins',
  },
  enchant: {
    title: 'Apply your first book',
    hint: 'The “{books}” button: the Enchanter sells books for tokens',
  },
  streak: {
    title: 'Push a streak to “Fired Up”',
    hint: '150 blocks non-stop — the “{streak}” bar',
  },
  bomb: { title: 'Set off a bomb', hint: 'Tap the bomb, then a cell of the field' },
  level: { title: 'Get your pickaxe to level 5', hint: 'Every broken block is pickaxe XP' },
  rankE: {
    title: 'Get rank E',
    hint: "A rank needs a pickaxe that can break the next floor's ore",
  },
  bag: { title: 'Upgrade your backpack', hint: 'In the forge, the “{bag}” row' },
  rankH: {
    title: 'Get rank H',
    hint: "From here you're on your own: ranks up to Z, then prestige",
  },
  parcel: {
    title: 'Open a parcel',
    hint: 'Parcels drop from blocks and ripen by the field while you dig',
  },
  rune: {
    title: 'Put a rune in your amulet',
    hint: '“{camp}” → {runes}. The first socket opens at pickaxe level 5',
  },
  pet: {
    title: 'Raise a pet to level 3',
    hint: 'The egg warms up while you dig; once hatched, it grows as you work',
  },
};
