import type { Translation } from '../types';
import type { yardData as ru } from '../ru/yardData';

export const yardData: Translation<typeof ru> = {
  event: {
    meteor: {
      name: 'Meteorite',
      lead: 'It fell into the mine. Smash it before it cools — contraband inside',
    },
    kuiva: {
      name: 'Kuiva',
      lead: 'A stone giant stepped out of the rock. Hit him before he goes back',
    },
    convoy: {
      name: 'Convoy',
      lead: 'The convoy needs a load of rock. Deliver before it leaves',
    },
    gold: {
      name: 'Gold Vein',
      lead: 'Every block counts triple',
    },
    payday: {
      name: 'Payday',
      lead: 'The buyer pays double for rock',
    },
    magpie: {
      name: 'Thieving Magpie',
      lead: 'She drops stolen loot into the mine. Grab it while it lies there',
    },
    blizzard: {
      name: 'Storm',
      lead: 'The wind fells the forest: every fallen tree drags its neighbor down',
    },
    bear: {
      name: 'Lord of the Taiga',
      lead: 'A bear is heading for the woodpile. Keep chopping to scare it off',
    },
  },
  map: {
    square: 'Square',
    forge: 'Forge',
    mine: 'Mine',
    zone: 'Special Mine',
    lift: 'Dungeon Lift',
    tower: 'Enchanter’s Tower',
    kennel: 'Nursery',
    store: 'Storeroom',
    kiosk: 'Kiosk',
    trader: 'Trader',
    hq: 'HQ',
    club: 'Club',
    barrack1: 'Barracks 1',
  },
  npc: {
    smith: 'Smith',
    mage: 'Enchanter',
    foreman: 'Foreman',
    guard: 'Guard',
    liftman: 'Liftman',
    keeper: 'Keeper',
    clerk: 'Quartermaster',
    trader: 'Trader',
    seller: 'Shopkeeper',
    chief: 'Warden',
    orderly: 'Orderly',
    croupier: 'Croupier',
  },
  door: {
    forge: 'Forge',
    mine: 'Mine',
    zone: 'Special Mine',
    hq: 'HQ',
    kiosk: 'Kiosk',
    tower: 'Tower',
    lift: 'Lift',
    store: 'Storeroom',
    kennel: 'Nursery',
    trader: 'Trader',
    barrack1: 'Barracks 1',
    club: 'Club',
    square: 'Go out',
  },
  act: {
    board: 'Board',
    back: 'Exit',
    prison: 'Go down',
    zone: 'Enter',
    dungeon: 'Go down',
    bunk: 'My chest',
  },
};
