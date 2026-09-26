// Редкость (v2.67) — одна лестница на кирки, а потом и на книги, топоры,
// удочки. Цвета — язык, который понимают все, кто играл во что-нибудь с
// добычей (WoW, Diablo, Genshin): серый, зелёный, синий, фиолетовый,
// золотой. Сверху две ступени только для кирок после престижа: розовая и
// бирюзовая.
//
// Чем выше ступень, тем больше у вещи эффектов — но только из тех, что не
// грузят телефон: прозрачность и поворот (см. «Бюджет кадра» в CLAUDE.md).

export interface Rarity {
  id: string;
  name: string;
  /** Основной цвет: рамка, имя, искры. */
  color: string;
  /** Светлый тон — середина свечения и блик. */
  light: string;
  /** Тёмный тон — плита под вещью. */
  dark: string;
}

export const RARITIES: Rarity[] = [
  { id: 'common', name: 'Обычная', color: '#c4c0b8', light: '#f2efe8', dark: '#3a3834' },
  { id: 'uncommon', name: 'Необычная', color: '#5fd35a', light: '#c8ffb8', dark: '#173d18' },
  { id: 'rare', name: 'Редкая', color: '#4aa0ff', light: '#c4e2ff', dark: '#10284a' },
  { id: 'epic', name: 'Эпическая', color: '#b86bff', light: '#ecd4ff', dark: '#2e1250' },
  { id: 'legend', name: 'Легендарная', color: '#ffb52e', light: '#fff0b8', dark: '#4a2c06' },
  { id: 'mythic', name: 'Мифическая', color: '#ff5fa8', light: '#ffd4ea', dark: '#4a0f2c' },
  { id: 'divine', name: 'Божественная', color: '#4ff0dc', light: '#dcfffa', dark: '#0a3a36' },
];

export const rarityOf = (i: number): Rarity =>
  RARITIES[Math.max(0, Math.min(RARITIES.length - 1, Math.round(i)))];

/** С какой ступени у вещи блик, искры, лучи, аура и столб света. */
export const FX_SHINE = 2;
export const FX_SPARKS = 3;
export const FX_RAYS = 4;
export const FX_AURA = 5;
export const FX_PILLAR = 6;
