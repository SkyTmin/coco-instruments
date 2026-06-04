import type { ClothingCategory, Season, WishStatus } from '@/types';

export const CATEGORIES: { id: ClothingCategory; label: string; emoji: string }[] = [
  { id: 'top', label: 'Верх', emoji: '👕' },
  { id: 'bottom', label: 'Низ', emoji: '👖' },
  { id: 'outerwear', label: 'Верхняя', emoji: '🧥' },
  { id: 'shoes', label: 'Обувь', emoji: '👟' },
  { id: 'accessory', label: 'Аксессуары', emoji: '👜' },
  { id: 'other', label: 'Другое', emoji: '🧦' },
];

export const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label])) as Record<
  ClothingCategory,
  string
>;
export const CATEGORY_EMOJI = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.emoji])) as Record<
  ClothingCategory,
  string
>;

export const SEASONS: { id: Season; label: string }[] = [
  { id: 'all', label: 'Всесезон' },
  { id: 'winter', label: 'Зима' },
  { id: 'spring', label: 'Весна' },
  { id: 'summer', label: 'Лето' },
  { id: 'autumn', label: 'Осень' },
];

export const SEASON_LABEL = Object.fromEntries(SEASONS.map((s) => [s.id, s.label])) as Record<
  Season,
  string
>;

export const WISH_STATUSES: { id: WishStatus; label: string; emoji: string }[] = [
  { id: 'want', label: 'Хочу', emoji: '💭' },
  { id: 'searching', label: 'Ищу', emoji: '🔎' },
  { id: 'bought', label: 'Куплено', emoji: '✅' },
];

export const WISH_STATUS_LABEL = Object.fromEntries(WISH_STATUSES.map((s) => [s.id, s.label])) as Record<
  WishStatus,
  string
>;
export const WISH_STATUS_EMOJI = Object.fromEntries(WISH_STATUSES.map((s) => [s.id, s.emoji])) as Record<
  WishStatus,
  string
>;
