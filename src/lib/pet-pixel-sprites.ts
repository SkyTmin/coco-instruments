// Сгенерировано scripts/pets-pixel/post.py — руками не править.
// Пиксельные питомцы: полосы кадров в пикселях рисунка от левого верхнего угла рамки
// тела (`box` × `box`), своя метка `rev` в адресе у каждого питомца. `large` — крупная
// полоса своего рисунка (`<anim>-l.webp`) для карточки, вылупления и Питомника.
export interface PetPxStrip {
  n: number;
  fps: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PetPxSet {
  box: number;
  anims: Record<string, PetPxStrip>;
}

export interface PetPx extends PetPxSet {
  rev: string;
  large?: PetPxSet;
}

export const PET_PX: Record<string, PetPx> = {
  badger: {
    box: 48,
    rev: '767d02a95a',
    anims: {
      idle: { n: 72, fps: 24, x: 5, y: -2, w: 37, h: 51 },
      walk: { n: 24, fps: 24, x: 3, y: -2, w: 42, h: 51 },
      happy: { n: 26, fps: 24, x: 5, y: -8, w: 38, h: 57 },
      work: { n: 48, fps: 24, x: 5, y: -4, w: 43, h: 56 },
      attack: { n: 22, fps: 24, x: -6, y: -9, w: 61, h: 59 },
      sleep: { n: 72, fps: 24, x: 7, y: 2, w: 37, h: 48 },
    },
    large: {
      box: 112,
      anims: {
        idle: { n: 72, fps: 24, x: 18, y: 2, w: 76, h: 107 },
        walk: { n: 24, fps: 24, x: 14, y: 3, w: 84, h: 106 },
        happy: { n: 26, fps: 24, x: 17, y: -11, w: 79, h: 120 },
        work: { n: 48, fps: 24, x: 17, y: -2, w: 89, h: 117 },
        attack: { n: 22, fps: 24, x: -10, y: -13, w: 133, h: 125 },
        sleep: { n: 72, fps: 24, x: 24, y: 9, w: 72, h: 103 },
      },
    },
  },
  bulldog: {
    box: 48,
    rev: 'b05bc96551',
    anims: {
      idle: { n: 72, fps: 24, x: 5, y: 0, w: 38, h: 51 },
      walk: { n: 24, fps: 24, x: 2, y: 4, w: 44, h: 46 },
      happy: { n: 26, fps: 24, x: 3, y: -4, w: 42, h: 55 },
      work: { n: 48, fps: 24, x: -1, y: 0, w: 60, h: 51 },
      attack: { n: 22, fps: 24, x: 2, y: -4, w: 49, h: 57 },
      sleep: { n: 72, fps: 24, x: 3, y: 20, w: 42, h: 33 },
    },
    large: {
      box: 112,
      anims: {
        idle: { n: 72, fps: 24, x: 15, y: 6, w: 82, h: 107 },
        walk: { n: 24, fps: 24, x: 10, y: 15, w: 92, h: 96 },
        happy: { n: 26, fps: 24, x: 14, y: -3, w: 83, h: 116 },
        work: { n: 48, fps: 24, x: 3, y: 6, w: 129, h: 108 },
        attack: { n: 22, fps: 24, x: 10, y: -4, w: 102, h: 124 },
        sleep: { n: 72, fps: 24, x: 13, y: 54, w: 86, h: 63 },
      },
    },
  },
  dragon: {
    box: 48,
    rev: 'fc3b9fa1e8',
    anims: {
      idle: { n: 72, fps: 24, x: 1, y: -1, w: 46, h: 52 },
      walk: { n: 24, fps: 24, x: -2, y: -2, w: 52, h: 53 },
      happy: { n: 26, fps: 24, x: -1, y: -9, w: 50, h: 60 },
      work: { n: 48, fps: 24, x: 1, y: -3, w: 46, h: 54 },
      attack: { n: 22, fps: 24, x: -2, y: -5, w: 52, h: 56 },
      sleep: { n: 72, fps: 24, x: 7, y: 8, w: 35, h: 43 },
    },
    large: {
      box: 112,
      anims: {
        idle: { n: 72, fps: 24, x: 7, y: 5, w: 98, h: 108 },
        walk: { n: 24, fps: 24, x: 0, y: 3, w: 112, h: 110 },
        happy: { n: 26, fps: 24, x: 2, y: -12, w: 108, h: 125 },
        work: { n: 48, fps: 24, x: 7, y: 2, w: 98, h: 111 },
        attack: { n: 22, fps: 24, x: 1, y: -3, w: 110, h: 117 },
        sleep: { n: 72, fps: 24, x: 22, y: 27, w: 71, h: 86 },
      },
    },
  },
  fox: {
    box: 48,
    rev: '951b93dd6e',
    anims: {
      idle: { n: 72, fps: 24, x: 7, y: 0, w: 33, h: 51 },
      walk: { n: 24, fps: 24, x: 6, y: 3, w: 35, h: 46 },
      happy: { n: 26, fps: 24, x: 7, y: -5, w: 34, h: 56 },
      work: { n: 48, fps: 24, x: 7, y: 0, w: 34, h: 52 },
      attack: { n: 22, fps: 24, x: 5, y: -6, w: 37, h: 59 },
      sleep: { n: 72, fps: 24, x: 8, y: 16, w: 34, h: 36 },
    },
    large: {
      box: 112,
      anims: {
        idle: { n: 72, fps: 24, x: 21, y: 9, w: 64, h: 105 },
        walk: { n: 24, fps: 24, x: 19, y: 16, w: 68, h: 94 },
        happy: { n: 26, fps: 24, x: 21, y: -2, w: 65, h: 116 },
        work: { n: 48, fps: 24, x: 21, y: 9, w: 70, h: 107 },
        attack: { n: 22, fps: 24, x: 16, y: -5, w: 72, h: 123 },
        sleep: { n: 72, fps: 24, x: 25, y: 49, w: 66, h: 68 },
      },
    },
  },
  owl: {
    box: 48,
    rev: 'dedf57f446',
    anims: {
      idle: { n: 72, fps: 24, x: 8, y: -3, w: 33, h: 54 },
      walk: { n: 24, fps: 24, x: 3, y: -5, w: 42, h: 56 },
      happy: { n: 26, fps: 24, x: -6, y: -11, w: 60, h: 62 },
      work: { n: 48, fps: 24, x: 2, y: -8, w: 51, h: 63 },
      attack: { n: 22, fps: 24, x: -14, y: -3, w: 76, h: 59 },
      sleep: { n: 72, fps: 24, x: 7, y: 3, w: 35, h: 48 },
    },
    large: {
      box: 112,
      anims: {
        idle: { n: 72, fps: 24, x: 24, y: 1, w: 64, h: 113 },
        walk: { n: 24, fps: 24, x: 13, y: -3, w: 86, h: 117 },
        happy: { n: 26, fps: 24, x: -8, y: -17, w: 128, h: 131 },
        work: { n: 48, fps: 24, x: 10, y: -11, w: 109, h: 134 },
        attack: { n: 22, fps: 24, x: -27, y: 1, w: 166, h: 125 },
        sleep: { n: 72, fps: 24, x: 23, y: 11, w: 67, h: 103 },
      },
    },
  },
  phoenix: {
    box: 48,
    rev: '2349d493db',
    anims: {
      idle: { n: 72, fps: 24, x: -2, y: -3, w: 53, h: 54 },
      walk: { n: 24, fps: 24, x: -4, y: -4, w: 56, h: 55 },
      happy: { n: 26, fps: 24, x: -4, y: -12, w: 56, h: 64 },
      work: { n: 48, fps: 24, x: -2, y: -9, w: 52, h: 66 },
      attack: { n: 22, fps: 24, x: -4, y: -5, w: 56, h: 56 },
      sleep: { n: 72, fps: 24, x: 4, y: 2, w: 39, h: 50 },
    },
    large: {
      box: 112,
      anims: {
        idle: { n: 72, fps: 24, x: 0, y: -1, w: 112, h: 114 },
        walk: { n: 24, fps: 24, x: -5, y: -4, w: 121, h: 118 },
        happy: { n: 26, fps: 24, x: -3, y: -19, w: 120, h: 134 },
        work: { n: 48, fps: 24, x: 1, y: -13, w: 111, h: 140 },
        attack: { n: 22, fps: 24, x: -4, y: -3, w: 120, h: 116 },
        sleep: { n: 72, fps: 24, x: 15, y: 9, w: 81, h: 108 },
      },
    },
  },
  raccoon: {
    box: 48,
    rev: 'f61c6de466',
    anims: {
      idle: { n: 72, fps: 24, x: 8, y: 4, w: 38, h: 46 },
      walk: { n: 24, fps: 24, x: 7, y: 7, w: 41, h: 43 },
      happy: { n: 26, fps: 24, x: 8, y: -1, w: 38, h: 51 },
      work: { n: 48, fps: 24, x: 8, y: 5, w: 38, h: 48 },
      attack: { n: 22, fps: 24, x: 5, y: -2, w: 44, h: 52 },
      sleep: { n: 72, fps: 24, x: 9, y: 17, w: 33, h: 32 },
    },
    large: {
      box: 112,
      anims: {
        idle: { n: 72, fps: 24, x: 24, y: 16, w: 80, h: 95 },
        walk: { n: 24, fps: 24, x: 24, y: 22, w: 85, h: 89 },
        happy: { n: 26, fps: 24, x: 25, y: 4, w: 81, h: 107 },
        work: { n: 48, fps: 24, x: 23, y: 18, w: 82, h: 101 },
        attack: { n: 22, fps: 24, x: 18, y: 1, w: 92, h: 111 },
        sleep: { n: 72, fps: 24, x: 27, y: 41, w: 67, h: 69 },
      },
    },
  },
  raven: {
    box: 48,
    rev: 'dde083d6b0',
    anims: {
      idle: { n: 72, fps: 24, x: 8, y: 1, w: 32, h: 50 },
      walk: { n: 24, fps: 24, x: 6, y: -1, w: 36, h: 52 },
      happy: { n: 26, fps: 24, x: -7, y: -6, w: 62, h: 57 },
      work: { n: 48, fps: 24, x: 3, y: -4, w: 63, h: 55 },
      attack: { n: 22, fps: 24, x: -14, y: -5, w: 76, h: 56 },
      sleep: { n: 72, fps: 24, x: 8, y: 5, w: 36, h: 46 },
    },
    large: {
      box: 112,
      anims: {
        idle: { n: 72, fps: 24, x: 25, y: 10, w: 64, h: 104 },
        walk: { n: 24, fps: 24, x: 19, y: 6, w: 77, h: 108 },
        happy: { n: 26, fps: 24, x: -12, y: -7, w: 136, h: 121 },
        work: { n: 48, fps: 24, x: 13, y: -3, w: 137, h: 117 },
        attack: { n: 22, fps: 24, x: -27, y: -6, w: 166, h: 120 },
        sleep: { n: 72, fps: 24, x: 25, y: 19, w: 67, h: 95 },
      },
    },
  },
  shepherd: {
    box: 48,
    rev: '648f06fd6e',
    anims: {
      idle: { n: 72, fps: 24, x: 4, y: 0, w: 44, h: 51 },
      walk: { n: 24, fps: 24, x: 4, y: 3, w: 34, h: 48 },
      happy: { n: 26, fps: 24, x: 4, y: -4, w: 45, h: 55 },
      work: { n: 48, fps: 24, x: -5, y: 1, w: 57, h: 53 },
      attack: { n: 22, fps: 24, x: 3, y: 1, w: 47, h: 50 },
      sleep: { n: 72, fps: 24, x: 2, y: 21, w: 41, h: 30 },
    },
    large: {
      box: 112,
      anims: {
        idle: { n: 72, fps: 24, x: 14, y: 10, w: 92, h: 105 },
        walk: { n: 24, fps: 24, x: 15, y: 17, w: 66, h: 97 },
        happy: { n: 26, fps: 24, x: 14, y: 0, w: 94, h: 115 },
        work: { n: 48, fps: 24, x: -9, y: 13, w: 127, h: 108 },
        attack: { n: 22, fps: 24, x: 13, y: 10, w: 98, h: 105 },
        sleep: { n: 72, fps: 24, x: 10, y: 55, w: 85, h: 60 },
      },
    },
  },
  spider: {
    box: 48,
    rev: '39dc6e9219',
    anims: {
      idle: { n: 72, fps: 24, x: -3, y: 8, w: 54, h: 43 },
      walk: { n: 24, fps: 24, x: -3, y: 8, w: 54, h: 44 },
      happy: { n: 26, fps: 24, x: -6, y: -1, w: 60, h: 52 },
      work: { n: 48, fps: 24, x: -6, y: 3, w: 65, h: 48 },
      attack: { n: 22, fps: 24, x: -7, y: 0, w: 62, h: 58 },
      sleep: { n: 72, fps: 24, x: 2, y: 12, w: 44, h: 41 },
    },
    large: {
      box: 112,
      anims: {
        idle: { n: 72, fps: 24, x: -2, y: 23, w: 116, h: 92 },
        walk: { n: 24, fps: 24, x: -2, y: 23, w: 116, h: 93 },
        happy: { n: 26, fps: 24, x: -10, y: 2, w: 132, h: 113 },
        work: { n: 48, fps: 24, x: -8, y: 11, w: 141, h: 104 },
        attack: { n: 22, fps: 24, x: -11, y: 4, w: 134, h: 121 },
        sleep: { n: 72, fps: 24, x: 10, y: 32, w: 92, h: 85 },
      },
    },
  },
  wolf: {
    box: 48,
    rev: '2cfe8196e1',
    anims: {
      idle: { n: 72, fps: 24, x: 8, y: -2, w: 36, h: 52 },
      walk: { n: 24, fps: 24, x: 8, y: 5, w: 32, h: 45 },
      happy: { n: 26, fps: 24, x: 8, y: -7, w: 36, h: 57 },
      work: { n: 48, fps: 24, x: 7, y: -21, w: 41, h: 71 },
      attack: { n: 22, fps: 24, x: 6, y: -2, w: 40, h: 54 },
      sleep: { n: 72, fps: 24, x: 7, y: 20, w: 35, h: 32 },
    },
    large: {
      box: 112,
      anims: {
        idle: { n: 72, fps: 24, x: 24, y: 3, w: 73, h: 110 },
        walk: { n: 24, fps: 24, x: 23, y: 20, w: 66, h: 91 },
        happy: { n: 26, fps: 24, x: 24, y: -8, w: 74, h: 121 },
        work: { n: 48, fps: 24, x: 24, y: -43, w: 82, h: 156 },
        attack: { n: 22, fps: 24, x: 20, y: 3, w: 82, h: 113 },
        sleep: { n: 72, fps: 24, x: 22, y: 57, w: 72, h: 62 },
      },
    },
  },
};
