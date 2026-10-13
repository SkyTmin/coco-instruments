import type { Translation } from '../types';
import type { dgear as ru } from '../ru/dgear';

export const dgear: Translation<typeof ru> = {
  slot: {
    weapon: "Weapon",
    helm: "Helmet",
    robe: "Jacket",
    boots: "Boots",
  },
  set: {
    "1": {
      name: "Plain",
      bonus: "+10% health",
      item: {
        weapon: "Leaf-Spring Machete",
        helm: "Earflap Hat",
        robe: "Quilted Jacket",
        boots: "Army Boots",
      },
    },
    "2": {
      name: "Miner",
      bonus: "+1 tile of light",
      item: {
        weapon: "Hewer's Broadsword",
        helm: "Lamp Helmet",
        robe: "Canvas Jacket",
        boots: "Rubber Boots",
      },
    },
    "3": {
      name: "Forged",
      bonus: "+15% armor",
      item: {
        weapon: "Forged Sword",
        helm: "Forged Helm",
        robe: "Chainmail",
        boots: "Forged Boots",
      },
    },
    "4": {
      name: "Mine Master",
      bonus: "+10% damage",
      item: {
        weapon: "Master's Sword",
        helm: "Master's Helm",
        robe: "Bronze Breastplate",
        boots: "Master's Boots",
      },
    },
    "5": {
      name: "Nepheline",
      bonus: "health out of combat",
      item: {
        weapon: "Nepheline Blade",
        helm: "Nepheline Helm",
        robe: "Nepheline Plate",
        boots: "Nepheline Boots",
      },
    },
    "6": {
      name: "Loparite",
      bonus: "+20% dash",
      item: {
        weapon: "Loparite Blade",
        helm: "Loparite Helm",
        robe: "Loparite Plate",
        boots: "Loparite Boots",
      },
    },
    "7": {
      name: "Astrophyllite",
      bonus: "+15% crit",
      item: {
        weapon: "Star Blade",
        helm: "Star Helm",
        robe: "Star Plate",
        boots: "Star Boots",
      },
    },
    "8": {
      name: "Aurora",
      bonus: "a bit of everything",
      item: {
        weapon: "Aurora",
        helm: "Aurora Crown",
        robe: "Aurora Plate",
        boots: "Aurora Boots",
      },
    },
  },
  affix: {
    fast: "Rabid",
    tough: "Tough",
    leader: "Leader",
    regen: "Regenerates",
    boom: "Explosive",
  },
  beast: {
    "0": "+10% damage to them",
    "1": "+10% loot from them",
    "2": "−15% damage from them",
    "3": "+25% damage to them, gold frame",
  },
  rock: {
    wallrock: "Waste Rock",
    pyrite: "Pyrite",
  },
};
