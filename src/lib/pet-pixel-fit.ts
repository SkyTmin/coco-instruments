// Пиксельные питомцы: какой полосой и в каком размере рисовать рамку тела.
// Целое число точек экрана на пиксель рисунка — иначе пиксели размываются
// или выходят разной ширины. Подробности — `.claude/rules/pets.md`.

import type { PetPx } from './pet-pixel-sprites';

export interface PxFit {
  /** Сторона рамки в CSS-пикселях. */
  s: number;
  /** Без сглаживания (`image-rendering: pixelated`). */
  crisp: boolean;
  /** Крупная полоса (`<anim>-l.webp`, рамка `large.box`). */
  large: boolean;
}

/**
 * Крупная полоса — если на её пиксель приходится от двух точек и до целого
 * не дальше 15% (карточка 150 и вылупление 190 при DPR 2–3, Питомник 74 при
 * DPR 3). Иначе малая: мельче полутора точек — как есть и со сглаживанием
 * (пиксели всё равно не различить); если до целого дальше 15% — размер
 * прежний, без сглаживания (мелочь неровной ширины лучше мыла).
 */
export function pxFit(size: number, px: PetPx, dpr: number): PxFit {
  if (px.large) {
    const k = (size * dpr) / px.large.box;
    const kr = Math.round(k);
    if (kr >= 2 && Math.abs(kr / k - 1) <= 0.15)
      return { s: (kr * px.large.box) / dpr, crisp: true, large: true };
  }
  const k = (size * dpr) / px.box;
  if (k < 1.5) return { s: size, crisp: false, large: false };
  const kr = Math.round(k);
  if (Math.abs(kr / k - 1) > 0.15) return { s: size, crisp: true, large: false };
  return { s: (kr * px.box) / dpr, crisp: true, large: false };
}
