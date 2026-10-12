// Сгенерировано scripts/pets-ink/tools/sprites-post.py — руками не править.
// Полосы кадров питомцев: число рисунков и прямоугольник полосы в долях рамки тела.
// Крупные полосы (`<anim>-l.webp`) — у анимаций из PET_LARGE.
export interface PetStrip {
  n: number;
  fps: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export const PET_LARGE = ['idle', 'happy', 'work'] as const;

export const PET_REV = '6f34e6e036';

export const PET_SPRITES: Record<string, { anims: Record<string, PetStrip> }> = {};
