// Пиксельные предметы: какой полосой и в каком размере рисовать рамку.
// Тот же расчёт, что `pxFit` питомцев (`lib/pet-pixel-fit.ts`): целое число
// точек экрана на пиксель рисунка, иначе пиксели размываются или выходят
// разной ширины.

export interface PropFit {
  /** Сторона рамки в CSS-пикселях. */
  s: number;
  /** Без сглаживания (`image-rendering: pixelated`). */
  crisp: boolean;
  /** Крупная полоса (`<name>-l.webp`, рамка `large`). */
  large: boolean;
}

/**
 * Крупная полоса — если она есть и на её пиксель приходится от двух точек и до
 * целого не дальше 15%. Иначе малая: мельче полутора точек — как есть и со
 * сглаживанием; дальше 15% до целого — размер прежний, без сглаживания.
 */
export function propFit(
  size: number,
  box: number | undefined,
  large: number | undefined,
  dpr: number,
): PropFit {
  if (large) {
    const k = (size * dpr) / large;
    const kr = Math.round(k);
    if ((kr >= 2 || !box) && kr >= 1 && Math.abs(kr / k - 1) <= 0.15)
      return { s: (kr * large) / dpr, crisp: true, large: true };
  }
  // Полоса только крупная (её не пекли малой) — она и при неровном масштабе.
  const b = box ?? large ?? 1;
  const lg = !box;
  const k = (size * dpr) / b;
  if (k < 1.5) return { s: size, crisp: false, large: lg };
  const kr = Math.round(k);
  if (Math.abs(kr / k - 1) > 0.15) return { s: size, crisp: true, large: lg };
  return { s: (kr * b) / dpr, crisp: true, large: lg };
}
