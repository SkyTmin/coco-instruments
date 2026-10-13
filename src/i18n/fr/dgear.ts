import type { Translation } from '../types';
import type { dgear as ru } from '../ru/dgear';

export const dgear: Translation<typeof ru> = {
  slot: {
    weapon: "Arme",
    helm: "Casque",
    robe: "Veste",
    boots: "Bottes",
  },
  set: {
    "1": {
      name: "Simple",
      bonus: "+10 % de santé",
      item: {
        weapon: "Machette en lame de ressort",
        helm: "Chapka",
        robe: "Veste matelassée",
        boots: "Godillots",
      },
    },
    "2": {
      name: "Mineur",
      bonus: "+1 case de lumière",
      item: {
        weapon: "Sabre du piqueur",
        helm: "Casque à lampe",
        robe: "Veste en toile",
        boots: "Bottes en caoutchouc",
      },
    },
    "3": {
      name: "Forgé",
      bonus: "+15 % d'armure",
      item: {
        weapon: "Épée forgée",
        helm: "Heaume forgé",
        robe: "Cotte de mailles",
        boots: "Bottes forgées",
      },
    },
    "4": {
      name: "Maître mineur",
      bonus: "+10 % de dégâts",
      item: {
        weapon: "Épée du maître",
        helm: "Heaume du maître",
        robe: "Plastron de bronze",
        boots: "Bottes du maître",
      },
    },
    "5": {
      name: "Néphéline",
      bonus: "santé hors combat",
      item: {
        weapon: "Lame de néphéline",
        helm: "Heaume de néphéline",
        robe: "Armure de néphéline",
        boots: "Bottes de néphéline",
      },
    },
    "6": {
      name: "Loparite",
      bonus: "+20 % de ruée",
      item: {
        weapon: "Lame de loparite",
        helm: "Heaume de loparite",
        robe: "Armure de loparite",
        boots: "Bottes de loparite",
      },
    },
    "7": {
      name: "Astrophyllite",
      bonus: "+15 % de critique",
      item: {
        weapon: "Lame stellaire",
        helm: "Heaume stellaire",
        robe: "Armure stellaire",
        boots: "Bottes stellaires",
      },
    },
    "8": {
      name: "Aurore",
      bonus: "un peu de tout",
      item: {
        weapon: "Aurore",
        helm: "Couronne d'aurore",
        robe: "Armure d'aurore",
        boots: "Bottes d'aurore",
      },
    },
  },
  affix: {
    fast: "Enragé",
    tough: "Coriace",
    leader: "Meneur",
    regen: "Se régénère",
    boom: "Explosif",
  },
  beast: {
    "0": "+10 % de dégâts contre eux",
    "1": "+10 % de butin sur eux",
    "2": "−15 % de dégâts reçus d'eux",
    "3": "+25 % de dégâts contre eux, cadre doré",
  },
  rock: {
    wallrock: "Roche stérile",
    pyrite: "Pyrite",
  },
};
