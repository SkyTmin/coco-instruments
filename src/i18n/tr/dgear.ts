import type { Translation } from '../types';
import type { dgear as ru } from '../ru/dgear';

export const dgear: Translation<typeof ru> = {
  slot: {
    weapon: "Silah",
    helm: "Kask",
    robe: "Ceket",
    boots: "Çizme",
  },
  set: {
    "1": {
      name: "Sade",
      bonus: "+%10 can",
      item: {
        weapon: "Yaydan Pala",
        helm: "Kulaklı Şapka",
        robe: "Kapitone Mont",
        boots: "Postal",
      },
    },
    "2": {
      name: "Madenci",
      bonus: "+1 kare ışık",
      item: {
        weapon: "Ocakçı Palası",
        helm: "Fenerli Kask",
        robe: "Branda Ceket",
        boots: "Lastik Çizme",
      },
    },
    "3": {
      name: "Dövme",
      bonus: "+%15 zırh",
      item: {
        weapon: "Dövme Kılıç",
        helm: "Dövme Miğfer",
        robe: "Zincir Zırh",
        boots: "Dövme Çizme",
      },
    },
    "4": {
      name: "Usta Madenci",
      bonus: "+%10 hasar",
      item: {
        weapon: "Usta Kılıcı",
        helm: "Usta Miğferi",
        robe: "Bronz Göğüslük",
        boots: "Usta Çizmesi",
      },
    },
    "5": {
      name: "Nefelin",
      bonus: "savaş dışı can",
      item: {
        weapon: "Nefelin Kılıç",
        helm: "Nefelin Miğfer",
        robe: "Nefelin Zırh",
        boots: "Nefelin Çizme",
      },
    },
    "6": {
      name: "Loparit",
      bonus: "+%20 atılma",
      item: {
        weapon: "Loparit Kılıç",
        helm: "Loparit Miğfer",
        robe: "Loparit Zırh",
        boots: "Loparit Çizme",
      },
    },
    "7": {
      name: "Astrofilit",
      bonus: "+%15 kritik",
      item: {
        weapon: "Yıldız Kılıcı",
        helm: "Yıldız Miğferi",
        robe: "Yıldız Zırhı",
        boots: "Yıldız Çizmesi",
      },
    },
    "8": {
      name: "Kutup Işığı",
      bonus: "her şeyden biraz",
      item: {
        weapon: "Kutup Işığı",
        helm: "Kutup Işığı Tacı",
        robe: "Kutup Işığı Zırhı",
        boots: "Kutup Işığı Çizmesi",
      },
    },
  },
  affix: {
    fast: "Kuduz",
    tough: "Dayanıklı",
    leader: "Elebaşı",
    regen: "İyileşir",
    boom: "Patlayıcı",
  },
  beast: {
    "0": "onlara +%10 hasar",
    "1": "onlardan +%10 ganimet",
    "2": "onlardan −%15 hasar",
    "3": "onlara +%25 hasar, altın çerçeve",
  },
  rock: {
    wallrock: "Boş Kaya",
    pyrite: "Pirit",
  },
};
