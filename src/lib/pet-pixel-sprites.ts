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
