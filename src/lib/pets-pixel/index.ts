// Пиксельные питомцы — список рисовальщиков для запекания.
// Игра этот модуль НЕ импортирует: она играет готовые полосы WebP по
// манифесту `lib/pet-pixel-sprites.ts`. Запекание — `scripts/pets-pixel/bake.ts`.
//
// Новый пиксельный питомец: файл `<id>.ts` с рисовальщиком кадра на холсте
// `cw×ch` (рамка тела `box` в точке `bx, by`) и строка здесь. Запекание само
// внесёт его в `scripts/pets-pixel/pets.json`, и тушь перестанет его выгружать.

import type { Px } from '../dungeon-art';
import { BOX, BX, BY, CH, CW, FPS, FRAMES, phoenixFrame } from './phoenix';
import type { Anim } from './phoenix';

export type { Anim };

export interface PixelPet {
  /** Сторона рамки тела в пикселях рисунка. */
  box: number;
  /** Холст кадра и левый верхний угол рамки тела на нём. */
  cw: number;
  ch: number;
  bx: number;
  by: number;
  anims: Record<Anim, { n: number; fps: number }>;
  frame: (a: Anim, i: number) => Px;
}

const at24 = (f: Record<Anim, number>, fps: number) =>
  Object.fromEntries(Object.entries(f).map(([a, n]) => [a, { n, fps }])) as PixelPet['anims'];

export const PIXEL_PETS: Record<string, PixelPet> = {
  phoenix: {
    box: BOX,
    cw: CW,
    ch: CH,
    bx: BX,
    by: BY,
    anims: at24(FRAMES, FPS),
    frame: phoenixFrame,
  },
};
