import type { Translation } from '../types';
import type { dgear as ru } from '../ru/dgear';

export const dgear: Translation<typeof ru> = {
  slot: {
    weapon: "Arma",
    helm: "Casco",
    robe: "Chaqueta",
    boots: "Botas",
  },
  set: {
    "1": {
      name: "Sencillo",
      bonus: "+10 % de salud",
      item: {
        weapon: "Machete de ballesta",
        helm: "Gorro de orejeras",
        robe: "Chaquetón acolchado",
        boots: "Botas militares",
      },
    },
    "2": {
      name: "Minero",
      bonus: "+1 casilla de luz",
      item: {
        weapon: "Sable de picador",
        helm: "Casco con linterna",
        robe: "Chaqueta de lona",
        boots: "Botas de goma",
      },
    },
    "3": {
      name: "Forjado",
      bonus: "+15 % de armadura",
      item: {
        weapon: "Espada forjada",
        helm: "Yelmo forjado",
        robe: "Cota de malla",
        boots: "Botas forjadas",
      },
    },
    "4": {
      name: "Maestro minero",
      bonus: "+10 % de daño",
      item: {
        weapon: "Espada del maestro",
        helm: "Yelmo del maestro",
        robe: "Peto de bronce",
        boots: "Botas del maestro",
      },
    },
    "5": {
      name: "Nefelina",
      bonus: "salud fuera de combate",
      item: {
        weapon: "Hoja de nefelina",
        helm: "Yelmo de nefelina",
        robe: "Armadura de nefelina",
        boots: "Botas de nefelina",
      },
    },
    "6": {
      name: "Loparita",
      bonus: "+20 % de embestida",
      item: {
        weapon: "Hoja de loparita",
        helm: "Yelmo de loparita",
        robe: "Armadura de loparita",
        boots: "Botas de loparita",
      },
    },
    "7": {
      name: "Astrofilita",
      bonus: "+15 % de crítico",
      item: {
        weapon: "Hoja estelar",
        helm: "Yelmo estelar",
        robe: "Armadura estelar",
        boots: "Botas estelares",
      },
    },
    "8": {
      name: "Aurora",
      bonus: "un poco de todo",
      item: {
        weapon: "Aurora",
        helm: "Corona de aurora",
        robe: "Armadura de aurora",
        boots: "Botas de aurora",
      },
    },
  },
  affix: {
    fast: "Rabioso",
    tough: "Duro",
    leader: "Cabecilla",
    regen: "Se regenera",
    boom: "Explosivo",
  },
  beast: {
    "0": "+10 % de daño contra ellos",
    "1": "+10 % de botín de ellos",
    "2": "−15 % de daño de ellos",
    "3": "+25 % de daño contra ellos, marco dorado",
  },
  rock: {
    wallrock: "Roca estéril",
    pyrite: "Pirita",
  },
};
