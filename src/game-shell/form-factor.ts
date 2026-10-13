// Форматы экрана игры. Решает место, а не устройство: окно браузера 600×900
// на ноутбуке получает раскладку планшета, и это правильно.

export type FormFactor = 'phone-portrait' | 'phone-landscape' | 'tablet' | 'desktop';

export const FORM_FACTORS: readonly FormFactor[] = [
  'phone-portrait',
  'phone-landscape',
  'tablet',
  'desktop',
];

/** Короче этого (CSS px) — телефон. 430 — самый широкий телефон стоя,
 *  а самый узкий планшет (iPad mini) — 744. */
export const PHONE_MAX_SHORT = 560;
/** С этой ширины и высоты — компьютер (три колонки). */
export const DESKTOP_MIN_W = 1280;
export const DESKTOP_MIN_H = 640;

export function classifyFormFactor(w: number, h: number): FormFactor {
  const short = Math.min(w, h);
  if (short < PHONE_MAX_SHORT) return h >= w ? 'phone-portrait' : 'phone-landscape';
  if (w >= DESKTOP_MIN_W && h >= DESKTOP_MIN_H) return 'desktop';
  return 'tablet';
}

/** Масштаб пиксель-арта, сколько CSS px в одной точке рисунка. */
export type UiScalePref = 'auto' | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Целый масштаб для пиксельной графики: точка рисунка = `--ui-scale` CSS px,
 * то есть целое число точек экрана при целом DPR. По короткой стороне:
 * телефон 2, планшет и ноутбук 3, 1080p — 4, 1440p и больше — 5.
 * Ручной выбор игрока (`pref`) не даёт уйти за край: не больше того, при
 * котором в короткую сторону влезает 160 точек рисунка.
 */
export function uiScaleFor(w: number, h: number, pref: UiScalePref = 'auto'): number {
  const short = Math.min(w, h);
  const cap = Math.max(1, Math.floor(short / 160));
  if (pref !== 'auto') return Math.max(1, Math.min(pref, cap));
  let s: number;
  if (short < PHONE_MAX_SHORT) s = 2;
  else if (short < 1000) s = 3;
  else if (short < 1300) s = 4;
  else s = 5;
  return Math.max(1, Math.min(s, cap));
}

/** Маршруты игры: здесь работают форматы, `data-ff` и навигация фокусом.
 *  Инструменты (финансы, заметки…) каркас не трогает. */
export const GAME_ROUTES = [
  '/games',
  '/prison',
  '/slots',
  '/scatter',
  '/yard',
  '/dungeon',
  '/forest',
  '/fishing',
] as const;

export function isGameRoute(pathname: string): boolean {
  return GAME_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`));
}
