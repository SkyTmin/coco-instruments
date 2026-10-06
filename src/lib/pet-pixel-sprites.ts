// Сгенерировано scripts/pets-pixel/post.py — руками не править.
// Пиксельные питомцы: полосы кадров в пикселях рисунка от левого верхнего угла рамки
// тела (`box` × `box`), своя метка `rev` в адресе у каждого питомца.
export interface PetPxStrip {
  n: number;
  fps: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PetPx {
  box: number;
  rev: string;
  anims: Record<string, PetPxStrip>;
}

export const PET_PX: Record<string, PetPx> = {
  phoenix: {
    box: 48,
    rev: 'dff6b00cd0',
    anims: {
      idle: { n: 72, fps: 24, x: -2, y: -3, w: 52, h: 52 },
      walk: { n: 24, fps: 24, x: -4, y: -4, w: 57, h: 53 },
      happy: { n: 26, fps: 24, x: -4, y: -11, w: 56, h: 60 },
      work: { n: 48, fps: 24, x: -4, y: -6, w: 56, h: 57 },
      attack: { n: 22, fps: 24, x: -3, y: -2, w: 54, h: 55 },
      sleep: { n: 72, fps: 24, x: 3, y: 1, w: 42, h: 48 },
    },
  },
};
