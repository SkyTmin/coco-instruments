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
  badgerFrame,
  FPS as BADGER_FPS,
  FRAMES as BADGER_FRAMES,
  RES as BADGER_RES,
} from './badger';
import {
  bulldogFrame,
  FPS as BULLDOG_FPS,
  FRAMES as BULLDOG_FRAMES,
  RES as BULLDOG_RES,
} from './bulldog';
import {
  dragonFrame,
  FPS as DRAGON_FPS,
  FRAMES as DRAGON_FRAMES,
  RES as DRAGON_RES,
} from './dragon';
import { FPS as FOX_FPS, FRAMES as FOX_FRAMES, foxFrame, RES as FOX_RES } from './fox';
import { FPS as OWL_FPS, FRAMES as OWL_FRAMES, owlFrame, RES as OWL_RES } from './owl';
import { FPS, FRAMES, phoenixFrame, RES } from './phoenix';
import type { Anim, Canvas, Res } from './phoenix';
import {
  FPS as RACCOON_FPS,
  FRAMES as RACCOON_FRAMES,
  raccoonFrame,
  RES as RACCOON_RES,
} from './raccoon';
import { FPS as RAVEN_FPS, FRAMES as RAVEN_FRAMES, RES as RAVEN_RES, ravenFrame } from './raven';
import {
  FPS as SHEPHERD_FPS,
  FRAMES as SHEPHERD_FRAMES,
  RES as SHEPHERD_RES,
  shepherdFrame,
} from './shepherd';
import {
  FPS as SPIDER_FPS,
  FRAMES as SPIDER_FRAMES,
  RES as SPIDER_RES,
  spiderFrame,
} from './spider';
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
  // Лис-картёжник: свой золотой.
  fox: {
    res: FOX_RES,
    anims: at24(FOX_FRAMES, FOX_FPS),
    frame: foxFrame,
    variants: [1],
  },
  // Овчарка Верная: свой золотой.
  shepherd: {
    res: SHEPHERD_RES,
    anims: at24(SHEPHERD_FRAMES, SHEPHERD_FPS),
    frame: shepherdFrame,
    variants: [1],
  },
  // Паук-отмычка: свой золотой.
  spider: {
    res: SPIDER_RES,
    anims: at24(SPIDER_FRAMES, SPIDER_FPS),
    frame: spiderFrame,
    variants: [1],
  },
  // Барсук-проходчик: свой золотой.
  badger: {
    res: BADGER_RES,
    anims: at24(BADGER_FRAMES, BADGER_FPS),
    frame: badgerFrame,
    variants: [1],
  },
  // Енот-медвежатник: свой золотой.
  raccoon: {
    res: RACCOON_RES,
    anims: at24(RACCOON_FRAMES, RACCOON_FPS),
    frame: raccoonFrame,
    variants: [1],
  },
  // Сова-фонарщица: свой золотой.
  owl: {
    res: OWL_RES,
    anims: at24(OWL_FRAMES, OWL_FPS),
    frame: owlFrame,
    variants: [1],
  },
  // Бульдог Кастет: свой золотой.
  bulldog: {
    res: BULLDOG_RES,
    anims: at24(BULLDOG_FRAMES, BULLDOG_FPS),
    frame: bulldogFrame,
    variants: [1],
  },
};
