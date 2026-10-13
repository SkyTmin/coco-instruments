import type { Translation } from '../types';
import type { pets as ru } from '../ru/pets';

export const pets: Translation<typeof ru> = {
  mole: {
    name: 'Miner Mole',
    lore: 'First into the tunnel, last one out',
  },
  roach: {
    name: 'Racer Roach',
    lore: 'Roach-race champion, lucky number seven',
  },
  mouse: {
    name: 'Pickpocket Mouse',
    lore: 'Finders keepers',
  },
  pigeon: {
    name: 'Postman Pigeon',
    lore: 'Brings news from outside — sometimes good',
  },
  cat: {
    name: 'Scar the Cat',
    lore: 'Haggles down to the last fishbone',
  },
  bulldog: {
    name: 'Knuckles the Bulldog',
    lore: 'Breaks rock with his forehead',
  },
  ferret: {
    name: 'Gofer Ferret',
    lore: 'Never sits still for a second',
  },
  scarab: {
    name: 'Scarab Beetle',
    lore: 'Rolls anything shiny into a ball',
  },
  badger: {
    name: 'Tunneler Badger',
    lore: 'Digs a tunnel straight as a ruler',
  },
  owl: {
    name: 'Lamplighter Owl',
    lore: 'Shines where things are hidden',
  },
  raccoon: {
    name: 'Safecracker Raccoon',
    lore: 'Cracks ore like a safe',
  },
  shepherd: {
    name: 'Loyal the Shepherd',
    lore: 'Used to guard the convoy, now one of us',
  },
  fox: {
    name: 'Card Shark Fox',
    lore: 'Always an ace behind the ear',
  },
  spider: {
    name: 'Lockpick Spider',
    lore: 'Eight legs, eight lockpicks',
  },
  dragon: {
    name: 'Coal Dragon',
    lore: 'Melts stone into gold',
  },
  wolf: {
    name: 'Alpha Wolf',
    lore: 'Broke the chain, gathered the pack',
  },
  raven: {
    name: 'Keymaster Raven',
    lore: 'Holds the keys to every door in the camp',
  },
  phoenix: {
    name: 'Freedom Phoenix',
    lore: 'Burns and rises — freer every time',
  },
};
