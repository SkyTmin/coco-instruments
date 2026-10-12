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
import {
  dragonFrame,
  FPS as DRAGON_FPS,
  FRAMES as DRAGON_FRAMES,
  RES as DRAGON_RES,
} from './dragon';
import { FPS, FRAMES, phoenixFrame, RES } from './phoenix';
import type { Anim, Canvas, Res } from './phoenix';
import { FPS as WOLF_FPS, FRAMES as WOLF_FRAMES, RES as WOLF_RES, wolfFrame } from './wolf';

export type { Anim, Canvas, Res };

export interface PixelPet {
  /** Холст и рамка тела у каждой полосы: малая обязательна, крупная — если есть. */
  res: { s: Canvas; l?: Canvas };
  anims: Record<Anim, { n: number; fps: number }>;
  /** Кадр; `v` — золотой (1) или радужный (2), если рисовальщик рисует их сам. */
  frame: (a: Anim, i: number, res: Res, v?: number) => Px;
  /** Какие варианты рисует сам рисовальщик; остальные post.py делает матрицами фильтров. */
  variants?: number[];
}

const at24 = (f: Record<Anim, number>, fps: number) =>
  Object.fromEntries(Object.entries(f).map(([a, n]) => [a, { n, fps }])) as PixelPet['anims'];

export const PIXEL_PETS: Record<string, PixelPet> = {
  phoenix: {
    res: RES,
    anims: at24(FRAMES, FPS),
    frame: phoenixFrame,
  },
  dragon: {
    res: DRAGON_RES,
    anims: at24(DRAGON_FRAMES, DRAGON_FPS),
    frame: dragonFrame,
    variants: [1, 2],
  },
  // Волк: свой золотой; радужного уровня больше нет — его не рисуем.
  wolf: {
    res: WOLF_RES,
    anims: at24(WOLF_FRAMES, WOLF_FPS),
    frame: wolfFrame,
    variants: [1],
  },
};
