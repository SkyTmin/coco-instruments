import type { Translation } from '../types';
import type { campData as ru } from '../ru/campData';

export const campData: Translation<typeof ru> = {
  handle: {
    birch: 'Huş sapı',
    larch: 'Melez sapı',
    karelian: 'Karelya huşu sapı',
  },
  axe: {
    rusty: 'Paslı balta',
    carpenter: 'Marangoz baltası',
    feller: 'Oduncu baltası',
    cleaver: 'Yarma baltası',
    bowsaw: 'Yay testere',
    druzhba: '“Dostluk” motorlu testere',
    ural: '“Ural” motorlu testere',
  },
  species: {
    willow: {
      name: 'Söğüt',
      gen: 'söğüt',
    },
    alder: {
      name: 'Kızılağaç',
      gen: 'kızılağaç',
    },
    aspen: {
      name: 'Titrek kavak',
      gen: 'titrek kavak',
    },
    birch: {
      name: 'Huş',
      gen: 'huş',
    },
    rowan: {
      name: 'Üvez',
      gen: 'üvez',
    },
    pine: {
      name: 'Çam',
      gen: 'çam',
    },
    spruce: {
      name: 'Ladin',
      gen: 'ladin',
    },
    larch: {
      name: 'Melez',
      gen: 'melez',
    },
    juniper: {
      name: 'Ardıç',
      gen: 'ardıç',
    },
    karelian: {
      name: 'Karelya huşu',
      gen: 'Karelya huşu',
    },
  },
  axeEnch: {
    chips: {
      name: 'Talaş',
      per: 'ekstra kütük şansına +%4',
    },
    resin: {
      name: 'Reçine',
      per: 'kütüklerden jetona +%20',
    },
    sense: {
      name: 'Sezgi',
      per: 'budaktan kaçmaya +%8, tehlikeli budak parlar',
    },
    swing: {
      name: 'Savuruş',
      per: 'iki kütüğü birden kesmeye +%2',
    },
    fell: {
      name: 'Devirme',
      per: 'ağacı tek vuruşta devirmeye +%0,4',
    },
    storm: {
      name: 'Domino',
      per: 'devrilen ağacın yanındakini devirmesine +%2',
    },
  },
  bench: {
    box: {
      name: 'Kasa',
      who: 'balık fabrikasına',
    },
    stool: {
      name: 'Tabure',
      who: 'koğuşa',
    },
    skis: {
      name: 'Kayak',
      who: 'bir avcıya',
    },
    barrel: {
      name: 'Fıçı',
      who: 'morina tuzlamaya',
    },
    frame: {
      name: 'Pencere çerçevesi',
      who: 'yeni bir eve',
    },
    sled: {
      name: 'Kızak',
      who: 'bir ren geyiği çobanına',
    },
    boat: {
      name: 'Tekne',
      who: 'Beyaz Deniz balıkçılarına',
    },
  },
};
