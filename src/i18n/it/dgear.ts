import type { Translation } from '../types';
import type { dgear as ru } from '../ru/dgear';

export const dgear: Translation<typeof ru> = {
  slot: {
    weapon: "Arma",
    helm: "Elmo",
    robe: "Giacca",
    boots: "Stivali",
  },
  set: {
    "1": {
      name: "Semplice",
      bonus: "+10% salute",
      item: {
        weapon: "Machete di balestra",
        helm: "Colbacco",
        robe: "Giaccone imbottito",
        boots: "Anfibi",
      },
    },
    "2": {
      name: "Minatore",
      bonus: "+1 casella di luce",
      item: {
        weapon: "Spadone del picconiere",
        helm: "Elmetto con lampada",
        robe: "Giacca di tela",
        boots: "Stivali di gomma",
      },
    },
    "3": {
      name: "Forgiato",
      bonus: "+15% armatura",
      item: {
        weapon: "Spada forgiata",
        helm: "Elmo forgiato",
        robe: "Cotta di maglia",
        boots: "Stivali forgiati",
      },
    },
    "4": {
      name: "Mastro minatore",
      bonus: "+10% danno",
      item: {
        weapon: "Spada del mastro",
        helm: "Elmo del mastro",
        robe: "Pettorale di bronzo",
        boots: "Stivali del mastro",
      },
    },
    "5": {
      name: "Nefelina",
      bonus: "salute fuori combattimento",
      item: {
        weapon: "Lama di nefelina",
        helm: "Elmo di nefelina",
        robe: "Corazza di nefelina",
        boots: "Stivali di nefelina",
      },
    },
    "6": {
      name: "Loparite",
      bonus: "+20% scatto",
      item: {
        weapon: "Lama di loparite",
        helm: "Elmo di loparite",
        robe: "Corazza di loparite",
        boots: "Stivali di loparite",
      },
    },
    "7": {
      name: "Astrofillite",
      bonus: "+15% critico",
      item: {
        weapon: "Lama stellare",
        helm: "Elmo stellare",
        robe: "Corazza stellare",
        boots: "Stivali stellari",
      },
    },
    "8": {
      name: "Aurora",
      bonus: "un po' di tutto",
      item: {
        weapon: "Aurora",
        helm: "Corona d'aurora",
        robe: "Corazza d'aurora",
        boots: "Stivali d'aurora",
      },
    },
  },
  affix: {
    fast: "Rabbioso",
    tough: "Tenace",
    leader: "Capobranco",
    regen: "Si rigenera",
    boom: "Esplosivo",
  },
  beast: {
    "0": "+10% danni contro di loro",
    "1": "+10% bottino da loro",
    "2": "−15% danni da loro",
    "3": "+25% danni contro di loro, cornice dorata",
  },
  rock: {
    wallrock: "Roccia sterile",
    pyrite: "Pirite",
  },
};
