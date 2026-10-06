// Пиксельные питомцы — список рисовальщиков для запекания.
// Игра этот модуль НЕ импортирует: она играет готовые полосы WebP по
// манифесту `lib/pet-pixel-sprites.ts`. Запекание — `scripts/pets-pixel/bake.ts`.
//
// Новый пиксельный питомец: файл `<id>.ts` с рисовальщиком кадра на холсте
// `cw×ch` (рамка тела `box` в точке `bx, by`) и строка здесь. Полос две:
// малая `s` (шахта, списки) и крупная `l` (карточка, вылупление, Питомник) —
// у каждой свой холст и свой рисунок. Запекание само внесёт питомца в
// `scripts/pets-pixel/pets.json`, и тушь перестанет его выгружать.

import type { Px } from '../dungeon-art';
import { FPS, FRAMES, phoenixFrame, RES } from './phoenix';
import type { Anim, Canvas, Res } from './phoenix';

export type { Anim, Canvas, Res };

export interface PixelPet {
  /** Холст и рамка тела у каждой полосы: малая обязательна, крупная — если есть. */
  res: { s: Canvas; l?: Canvas };
  anims: Record<Anim, { n: number; fps: number }>;
  frame: (a: Anim, i: number, res: Res) => Px;
}

const at24 = (f: Record<Anim, number>, fps: number) =>
  Object.fromEntries(Object.entries(f).map(([a, n]) => [a, { n, fps }])) as PixelPet['anims'];

export const PIXEL_PETS: Record<string, PixelPet> = {
  phoenix: {
    res: RES,
    anims: at24(FRAMES, FPS),
    frame: phoenixFrame,
  },
};
