import type { Translation } from '../types';
import type { dgear as ru } from '../ru/dgear';

export const dgear: Translation<typeof ru> = {
  slot: {
    weapon: "Waffe",
    helm: "Helm",
    robe: "Jacke",
    boots: "Stiefel",
  },
  set: {
    "1": {
      name: "Schlicht",
      bonus: "+10 % Gesundheit",
      item: {
        weapon: "Federstahl-Machete",
        helm: "Fellmütze",
        robe: "Wattejacke",
        boots: "Armeestiefel",
      },
    },
    "2": {
      name: "Bergmann",
      bonus: "+1 Feld Licht",
      item: {
        weapon: "Hauerschwert",
        helm: "Grubenhelm",
        robe: "Segeltuchjacke",
        boots: "Gummistiefel",
      },
    },
    "3": {
      name: "Geschmiedet",
      bonus: "+15 % Rüstung",
      item: {
        weapon: "Geschmiedetes Schwert",
        helm: "Geschmiedeter Helm",
        robe: "Kettenhemd",
        boots: "Geschmiedete Stiefel",
      },
    },
    "4": {
      name: "Bergmeister",
      bonus: "+10 % Schaden",
      item: {
        weapon: "Meisterschwert",
        helm: "Meisterhelm",
        robe: "Bronzener Brustpanzer",
        boots: "Meisterstiefel",
      },
    },
    "5": {
      name: "Nephelin",
      bonus: "Gesundheit außerhalb des Kampfes",
      item: {
        weapon: "Nephelinklinge",
        helm: "Nephelinhelm",
        robe: "Nephelinpanzer",
        boots: "Nephelinstiefel",
      },
    },
    "6": {
      name: "Loparit",
      bonus: "+20 % Sprint",
      item: {
        weapon: "Loparitklinge",
        helm: "Loparithelm",
        robe: "Loparitpanzer",
        boots: "Loparitstiefel",
      },
    },
    "7": {
      name: "Astrophyllit",
      bonus: "+15 % Krit",
      item: {
        weapon: "Sternklinge",
        helm: "Sternhelm",
        robe: "Sternpanzer",
        boots: "Sternstiefel",
      },
    },
    "8": {
      name: "Polarlicht",
      bonus: "von allem etwas",
      item: {
        weapon: "Polarlicht",
        helm: "Polarlichtkrone",
        robe: "Polarlichtpanzer",
        boots: "Polarlichtstiefel",
      },
    },
  },
  affix: {
    fast: "Tollwütig",
    tough: "Zäh",
    leader: "Anführer",
    regen: "Heilt sich",
    boom: "Explosiv",
  },
  beast: {
    "0": "+10 % Schaden gegen sie",
    "1": "+10 % Beute von ihnen",
    "2": "−15 % Schaden von ihnen",
    "3": "+25 % Schaden gegen sie, goldener Rahmen",
  },
  rock: {
    wallrock: "Taubes Gestein",
    pyrite: "Pyrit",
  },
};
