// Пиксельные предметы (яйца, сундуки, книги, кирки) — общие типы.
// Набор (`<set>.ts`) рисует кадры кодом (риг питомцев `pets-pixel/rig.ts`),
// `scripts/props-pixel/bake.ts` запекает их в полосы `public/ui/px/<set>/`,
// `post.py` пишет манифест `sprites-<set>.ts`; игра читает только манифест и
// полосы (`components/PxStrip.tsx`). Подробности — `.claude/rules/props-pixel.md`.

import type { Px } from '../dungeon-art';

/** Полоса: `s` — малая (значки), `l` — крупная (сцены). */
export type Res = 's' | 'l';

/** Холст кадра одной полосы: рамка предмета `box` в точке `bx, by`, вокруг — место для частиц. */
export interface Canvas {
  /** Сторона рамки предмета в пикселях рисунка: по ней игра ставит предмет (`size` = рамка). */
  box: number;
  cw: number;
  ch: number;
  bx: number;
  by: number;
}

/** Анимация набора (как её объявляет рисовальщик). */
export interface StripDef {
  frames: number;
  fps: number;
  /** Петля (покой) или разовая (открытие, вылупление). */
  loop: boolean;
  /** Именованные кадры: сцена вешает на них звук, дрожь, фазы (`onMark`). */
  marks?: Record<string, number>;
  /** Именованные точки в долях рамки (0…1, можно за её краем): замок, руна… */
  anchors?: Record<string, [number, number]>;
  /** Какие полосы печь (по умолчанию все, что есть в `RES`). */
  res?: Res[];
}

/** Модуль набора `src/lib/props-pixel/<set>.ts`: его импортирует только запекание и тесты. */
export interface PropSetModule {
  RES: { s: Canvas; l?: Canvas };
  STRIPS: Record<string, StripDef>;
  /** Кадр `i` анимации `name` на холсте `RES[res]`; детерминирован. */
  frame: (name: string, i: number, res: Res, v?: number) => Px;
}

// --- Манифест (пишет post.py) ------------------------------------------------

/** Прямоугольник полосы в пикселях рисунка от левого верхнего угла рамки; `cols` кадров в ряд. */
export interface PxRect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Кадров в ряду: длинная полоса уложена сеткой (WebP не шире 16383 пикселей). */
  cols: number;
}

export interface PxStripMeta {
  n: number;
  fps: number;
  loop: boolean;
  /** Метка содержимого (обеих полос) — `?v=` в адресе: перерисованная не отдастся из кеша. */
  rev: string;
  marks?: Record<string, number>;
  /** Точки в процентах рамки. */
  anchors?: Record<string, [number, number]>;
  /** Малая полоса (`<name>.webp`), в пикселях рамки `box`. */
  s?: PxRect;
  /** Крупная полоса (`<name>-l.webp`), в пикселях рамки `large`. */
  l?: PxRect;
}

export interface PxManifest {
  set: string;
  /** Рамка малой полосы. */
  box: number;
  /** Рамка крупной полосы (если в наборе есть крупные). */
  large?: number;
  strips: Record<string, PxStripMeta>;
}
