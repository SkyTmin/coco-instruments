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
  phoenix: {
    box: 48,
    rev: 'bc51abe8d6',
    anims: {
      idle: { n: 72, fps: 24, x: -2, y: -2, w: 52, h: 54 },
      walk: { n: 24, fps: 24, x: -4, y: -3, w: 55, h: 55 },
      happy: { n: 26, fps: 24, x: -4, y: -11, w: 55, h: 63 },
      work: { n: 48, fps: 24, x: -2, y: -8, w: 52, h: 66 },
      attack: { n: 22, fps: 24, x: -4, y: -4, w: 55, h: 56 },
      sleep: { n: 72, fps: 24, x: 4, y: 3, w: 39, h: 50 },
    },
    large: {
      box: 112,
      anims: {
        idle: { n: 72, fps: 24, x: 1, y: 1, w: 110, h: 114 },
        walk: { n: 24, fps: 24, x: -4, y: -2, w: 119, h: 118 },
        happy: { n: 26, fps: 24, x: -2, y: -14, w: 117, h: 131 },
        work: { n: 48, fps: 24, x: 1, y: -9, w: 110, h: 139 },
        attack: { n: 22, fps: 24, x: -3, y: 2, w: 118, h: 113 },
        sleep: { n: 72, fps: 24, x: 15, y: 11, w: 81, h: 107 },
      },
    },
  },
};
