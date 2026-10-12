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

export const PET_SPRITES: Record<string, { anims: Record<string, PetStrip> }> = {
  crow: {
    anims: {
      attack: {
        fps: 14,
        h: 1.0281,
        n: 12,
        w: 1.0937,
        x: -0.0667,
        y: -0.0141,
      },
      happy: {
        fps: 14,
        h: 1.1077,
        n: 16,
        w: 1.1522,
        x: -0.0902,
        y: -0.1148,
      },
      idle: {
        fps: 6,
        h: 0.918,
        n: 18,
        w: 0.5691,
        x: 0.2026,
        y: 0.0749,
      },
      sleep: {
        fps: 6,
        h: 1.0351,
        n: 18,
        w: 0.6276,
        x: 0.1932,
        y: -0.0117,
      },
      walk: {
        fps: 12,
        h: 0.9227,
        n: 12,
        w: 0.6206,
        x: 0.1745,
        y: 0.0703,
      },
      work: {
        fps: 8,
        h: 0.993,
        n: 16,
        w: 0.8197,
        x: 0.1581,
        y: 0.0023,
      },
    },
  },
  pigeon: {
    anims: {
      attack: {
        fps: 14,
        h: 1.0213,
        n: 12,
        w: 1.0615,
        x: -0.0544,
        y: 0.0071,
      },
      happy: {
        fps: 14,
        h: 1.1182,
        n: 16,
        w: 1.1206,
        x: -0.078,
        y: -0.1111,
      },
      idle: {
        fps: 6,
        h: 0.8983,
        n: 18,
        w: 0.5674,
        x: 0.1986,
        y: 0.1087,
      },
      sleep: {
        fps: 6,
        h: 1.0378,
        n: 18,
        w: 0.6359,
        x: 0.1891,
        y: -0.0118,
      },
      walk: {
        fps: 12,
        h: 0.9031,
        n: 12,
        w: 0.617,
        x: 0.1726,
        y: 0.104,
      },
      work: {
        fps: 8,
        h: 1.1182,
        n: 16,
        w: 1.0993,
        x: -0.0473,
        y: -0.1111,
      },
    },
  },
};
