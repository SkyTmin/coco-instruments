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
import { FPS as RAVEN_FPS, FRAMES as RAVEN_FRAMES, RES as RAVEN_RES, ravenFrame } from './raven';
import { FPS as WOLF_FPS, FRAMES as WOLF_FRAMES, RES as WOLF_RES, wolfFrame } from './wolf';

export type { Anim, Canvas, Res };

export interface PixelPet {
  /** Холст и рамка тела у каждой полосы: малая обязательна, крупная — если есть. */
  res: { s: Canvas; l?: Canvas };
  anims: Record<Anim, { n: number; fps: number }>;
  /** Кадр; `v` — золотой (1), если рисовальщик рисует его сам. */
  frame: (a: Anim, i: number, res: Res, v?: number) => Px;
  /**
   * Рисует ли золотой (`[1]`) сам рисовальщик; иначе post.py делает его матрицей
   * фильтра. Радужного (2) нет с v2.111.
   */
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
    variants: [1],
  },
  // Волк: свой золотой; радужного уровня больше нет — его не рисуем.
  wolf: {
    res: WOLF_RES,
    anims: at24(WOLF_FRAMES, WOLF_FPS),
    frame: wolfFrame,
    variants: [1],
  },
  // Ворон-ключник: свой золотой.
  raven: {
    res: RAVEN_RES,
    anims: at24(RAVEN_FRAMES, RAVEN_FPS),
    frame: ravenFrame,
    variants: [1],
  },
};
