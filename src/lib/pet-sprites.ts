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
  mole: {
    anims: {
      attack: {
        fps: 14,
        h: 1.0462,
        n: 12,
        w: 0.871,
        x: 0.0791,
        y: -0.0097,
      },
      happy: {
        fps: 14,
        h: 1.146,
        n: 16,
        w: 0.9124,
        x: 0.045,
        y: -0.1363,
      },
      idle: {
        fps: 6,
        h: 0.9148,
        n: 18,
        w: 0.7275,
        x: 0.135,
        y: 0.0949,
      },
      sleep: {
        fps: 6,
        h: 1.0219,
        n: 18,
        w: 0.7275,
        x: 0.1448,
        y: -0.0097,
      },
      walk: {
        fps: 12,
        h: 0.9197,
        n: 12,
        w: 0.764,
        x: 0.118,
        y: 0.09,
      },
      work: {
        fps: 8,
        h: 1.1192,
        n: 16,
        w: 0.9197,
        x: 0.0401,
        y: -0.0949,
      },
    },
  },
  mouse: {
    anims: {
      attack: {
        fps: 14,
        h: 1.1766,
        n: 12,
        w: 0.8657,
        x: 0.0398,
        y: -0.1468,
      },
      happy: {
        fps: 14,
        h: 1.1716,
        n: 16,
        w: 0.8433,
        x: 0.0348,
        y: -0.1617,
      },
      idle: {
        fps: 6,
        h: 1.0348,
        n: 18,
        w: 0.7189,
        x: 0.1294,
        y: -0.0249,
      },
      sleep: {
        fps: 6,
        h: 1.0323,
        n: 18,
        w: 0.7612,
        x: 0.1194,
        y: -0.01,
      },
      walk: {
        fps: 12,
        h: 1.0323,
        n: 12,
        w: 0.7488,
        x: 0.1194,
        y: -0.0224,
      },
      work: {
        fps: 8,
        h: 1.0423,
        n: 16,
        w: 0.7985,
        x: 0.1144,
        y: -0.0323,
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
  roach: {
    anims: {
      attack: {
        fps: 14,
        h: 1.0689,
        n: 12,
        w: 0.8333,
        x: 0.0311,
        y: -0.04,
      },
      happy: {
        fps: 14,
        h: 1.0511,
        n: 16,
        w: 0.7822,
        x: 0.0533,
        y: -0.04,
      },
      idle: {
        fps: 6,
        h: 1.0333,
        n: 18,
        w: 0.7711,
        x: 0.0733,
        y: -0.0222,
      },
      sleep: {
        fps: 6,
        h: 0.9289,
        n: 18,
        w: 0.8444,
        x: 0.08,
        y: 0.0911,
      },
      walk: {
        fps: 12,
        h: 1.0311,
        n: 12,
        w: 0.7933,
        x: 0.0711,
        y: -0.02,
      },
      work: {
        fps: 8,
        h: 1.0778,
        n: 16,
        w: 1.24,
        x: -0.18,
        y: -0.02,
      },
    },
  },
};
