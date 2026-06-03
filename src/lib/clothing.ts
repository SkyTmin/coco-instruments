import type { ClothingCategory, Season, WardrobeItem } from '@/types';

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

const SLOT_ORDER: ClothingCategory[] = ['outerwear', 'top', 'bottom', 'shoes', 'accessory'];

/**
 * Suggest a random outfit from the wardrobe — one item per core slot
 * (top/bottom/shoes), sometimes topped with outerwear and an accessory.
 * `rng` is injectable for tests. Falls back to a few random items when the
 * wardrobe isn't categorised.
 */
export function suggestOutfit(items: WardrobeItem[], rng: () => number = Math.random): WardrobeItem[] {
  const pickFrom = (cat: ClothingCategory): WardrobeItem | undefined => {
    const pool = items.filter((i) => i.category === cat);
    return pool.length ? pool[Math.floor(rng() * pool.length)] : undefined;
  };

  const chosen: WardrobeItem[] = [];
  for (const cat of ['top', 'bottom', 'shoes'] as ClothingCategory[]) {
    const it = pickFrom(cat);
    if (it) chosen.push(it);
  }
  const outer = pickFrom('outerwear');
  if (outer && rng() > 0.45) chosen.push(outer);
  const acc = pickFrom('accessory');
  if (acc && rng() > 0.5) chosen.push(acc);

  if (chosen.length === 0) {
    return [...items].sort(() => rng() - 0.5).slice(0, 3);
  }
  return chosen.sort((a, b) => SLOT_ORDER.indexOf(a.category) - SLOT_ORDER.indexOf(b.category));
}
