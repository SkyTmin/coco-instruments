// Пиксельные книги — покачивание покоя. Одна формула на двоих: запекание
// (`books.ts` поднимает книгу в кадре) и игра (`BookArt` поднимает знак чары
// поверх обложки в том же кадре полосы `idle-<tier>`), чтобы знак ехал с книгой.

export type BookTier = 'simple' | 'rare' | 'epic' | 'legend';

/** Размах покачивания в пикселях малой полосы (рамка 48). */
const BOB_AMP: Record<BookTier, number> = { simple: 2, rare: 2, epic: 2, legend: 3 };

/**
 * На сколько пикселей рисунка книга поднята в кадре `i` из `n` (вверх — минус).
 * `scale` — рамка полосы / 48 (у крупной 112 / 48).
 */
export function bookIdleBob(tier: BookTier, i: number, n: number, scale: number): number {
  const u = ((((i % n) + n) % n) / n) * Math.PI * 2;
  return -Math.round(((BOB_AMP[tier] * (1 - Math.cos(u))) / 2) * scale);
}
