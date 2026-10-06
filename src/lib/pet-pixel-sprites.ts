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
};
