// Текстуры каторги рисуются кодом: 26 пород × картинка — самая медленная
// часть такой игры, если рисовать руками. Каждая порода — квадрат 16×16
// пикселей из своей палитры и своего узора, растянутый без сглаживания
// (`image-rendering: pixelated`). Рисуется один раз за сессию и лежит в
// кеше как data-URL: на поле это обычная картинка, её не перерисовывают.
//
// Зерно у каждой породы своё и постоянное, поэтому гранит одинаков на любом
// телефоне и в любой заход — порода узнаётся по рисунку, а не только по
// цвету. Это важно: на поле рядом лежат пять пород, и различать их нужно
// с первого взгляда.

import { rng32, ROCKS } from './prison';
import type { Rock } from './prison';

const N = 16;

type RGB = [number, number, number];

function hex(h: string): RGB {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function mix(a: RGB, b: RGB, k: number): RGB {
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

const BLACK: RGB = [0, 0, 0];
const WHITE: RGB = [255, 255, 255];

class Pixels {
  data = new Uint8ClampedArray(N * N * 4);
  set(x: number, y: number, c: RGB, a = 255): void {
    if (x < 0 || y < 0 || x >= N || y >= N) return;
    const i = (y * N + x) * 4;
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
    this.data[i + 3] = a;
  }
  get(x: number, y: number): RGB {
    const i = (y * N + x) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2]];
  }
  toUrl(): string {
    if (typeof document === 'undefined') return '';
    const c = document.createElement('canvas');
    c.width = N;
    c.height = N;
    const g = c.getContext('2d');
    if (!g) return '';
    const img = g.createImageData(N, N);
    img.data.set(this.data);
    g.putImageData(img, 0, 0);
    return c.toDataURL();
  }
}

/** Каменная основа: крупные пятна плюс мелкое зерно. */
function ground(px: Pixels, r: Rock, rnd: () => number): void {
  const base = hex(r.base);
  const dark = hex(r.dark);
  const light = mix(base, hex(r.shine), 0.28);
  // Крупные пятна: сетка 4×4, у каждой клетки своя яркость.
  const blot: number[] = Array.from({ length: 16 }, () => rnd() * 0.16 - 0.08);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const t = rnd();
      let c = t < 0.2 ? dark : t < 0.82 ? base : light;
      const b = blot[Math.floor(y / 4) * 4 + Math.floor(x / 4)];
      c = b > 0 ? mix(c, WHITE, b) : mix(c, BLACK, -b);
      px.set(x, y, c);
    }
  }
}

/** Самоцвет в оправе породы: светлая грань сверху-слева, тень снизу-справа. */
function gem(px: Pixels, cx: number, cy: number, size: number, r: Rock): void {
  const fleck = hex(r.fleck);
  const shine = hex(r.shine);
  const deep = mix(fleck, BLACK, 0.45);
  for (let dy = -size; dy <= size; dy++) {
    for (let dx = -size; dx <= size; dx++) {
      if (Math.abs(dx) + Math.abs(dy) > size) continue;
      const edge = Math.abs(dx) + Math.abs(dy) === size;
      let c = fleck;
      if (edge && (dx < 0 || dy < 0)) c = shine;
      else if (edge) c = deep;
      else if (dx + dy < 0) c = mix(fleck, shine, 0.3);
      px.set(cx + dx, cy + dy, c);
    }
  }
}

function paintRock(r: Rock, index: number, variant: number): string {
  const rnd = rng32(0x5eed + index * 977 + variant * 104729);
  const px = new Pixels();
  ground(px, r, rnd);
  const fleck = hex(r.fleck);
  const shine = hex(r.shine);
  const dark = hex(r.dark);
  const ri = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));

  switch (r.pattern) {
    case 'grain': {
      for (let i = 0; i < 26; i++) px.set(ri(0, 15), ri(0, 15), rnd() < 0.7 ? fleck : shine);
      // В земле попадаются камешки: без них глина — однотонный шум.
      if (r.kind === 'soil') {
        const pebble: RGB = [128, 118, 108];
        for (let i = 0; i < variant; i++) {
          const x = ri(2, 12);
          const y = ri(2, 12);
          px.set(x, y, mix(pebble, WHITE, 0.3));
          px.set(x + 1, y, pebble);
          px.set(x, y + 1, pebble);
          px.set(x + 1, y + 1, mix(pebble, BLACK, 0.35));
          px.set(x + 2, y + 1, dark);
        }
      }
      break;
    }
    case 'bands': {
      const phase = rnd() * 6;
      const colors = [hex(r.base), fleck, mix(hex(r.base), dark, 0.6), shine];
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const band = Math.floor((y + 2.2 * Math.sin(x / 3 + phase) + 16) / 3) % colors.length;
          const c = mix(px.get(x, y), colors[band], 0.62);
          px.set(x, y, c);
        }
      }
      break;
    }
    case 'specks': {
      const n = ri(5, 7);
      for (let i = 0; i < n; i++) {
        const x = ri(1, 13);
        const y = ri(1, 13);
        px.set(x, y, fleck);
        px.set(x + 1, y, fleck);
        px.set(x, y + 1, fleck);
        if (rnd() < 0.6) px.set(x + 1, y + 1, mix(fleck, BLACK, 0.3));
        px.set(x, y, shine);
        if (rnd() < 0.5) px.set(x + 2, y + 1, dark);
      }
      break;
    }
    case 'veins': {
      for (let v = 0; v < 2; v++) {
        let y = ri(2, 13);
        for (let x = 0; x < N; x++) {
          px.set(x, y, fleck);
          if (rnd() < 0.35) px.set(x, y - 1, shine);
          if (rnd() < 0.3) px.set(x, y + 1, mix(fleck, BLACK, 0.35));
          y += rnd() < 0.33 ? -1 : rnd() < 0.5 ? 1 : 0;
          y = Math.max(1, Math.min(14, y));
        }
      }
      break;
    }
    case 'crystal': {
      const spots: [number, number][] = [
        [ri(3, 6), ri(3, 6)],
        [ri(9, 12), ri(8, 12)],
        [ri(3, 7), ri(10, 13)],
      ];
      spots.forEach(([x, y], i) => gem(px, x, y, i === 0 ? 3 : 2, r));
      break;
    }
    case 'flakes': {
      for (let i = 0; i < 12; i++) {
        const x = ri(0, 13);
        const y = ri(0, 15);
        px.set(x, y, fleck);
        px.set(x + 1, y, fleck);
        if (rnd() < 0.5) px.set(x + 2, y, shine);
        else px.set(x + 1, y, shine);
      }
      break;
    }
    case 'stars': {
      // Туманность: мягкое пятно цвета искр, потом сами звёзды.
      const cx = ri(4, 11);
      const cy = ri(4, 11);
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const d = Math.hypot(x - cx, y - cy) / 8;
          if (d < 1) px.set(x, y, mix(px.get(x, y), fleck, 0.32 * (1 - d)));
        }
      }
      for (let i = 0; i < 7; i++) {
        const x = ri(1, 14);
        const y = ri(1, 14);
        px.set(x, y, shine);
        if (i < 3) {
          px.set(x - 1, y, fleck);
          px.set(x + 1, y, fleck);
          px.set(x, y - 1, fleck);
          px.set(x, y + 1, fleck);
        }
      }
      break;
    }
  }

  // Фаска: блок — это торец столба, свет сверху-слева.
  for (let i = 0; i < N; i++) {
    px.set(i, 0, mix(px.get(i, 0), WHITE, 0.22));
    px.set(0, i, mix(px.get(0, i), WHITE, 0.16));
    px.set(i, N - 1, mix(px.get(i, N - 1), BLACK, 0.32));
    px.set(N - 1, i, mix(px.get(N - 1, i), BLACK, 0.26));
  }
  return px.toUrl();
}

/**
 * Рисунков у породы несколько: одна и та же картинка во всех клетках
 * складывается в кафель, и поле читается как плитка, а не как порода.
 */
export const ROCK_VARIANTS = 4;

const rockCache = new Map<number, string>();

/** Картинка породы (data-URL, 16×16). `variant` — какой из рисунков. */
export function rockTexture(rock: number, variant = 0): string {
  const key = rock * ROCK_VARIANTS + (variant % ROCK_VARIANTS);
  let url = rockCache.get(key);
  if (url === undefined) {
    const r = ROCKS[rock];
    url = r ? paintRock(r, rock, variant % ROCK_VARIANTS) : '';
    rockCache.set(key, url);
  }
  return url;
}

/** Какой рисунок у блока: постоянен для клетки и яруса в этой шахте. */
export function rockVariant(seed: number, cell: number, depth: number): number {
  let h = (seed ^ (cell * 374761393) ^ (depth * 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) % ROCK_VARIANTS;
}

let bedrock = '';

/** Дно шахты: коренная порода, её не берёт ни одна кирка. */
export function bedrockTexture(): string {
  if (bedrock) return bedrock;
  const rnd = rng32(0xbed);
  const px = new Pixels();
  const a: RGB = [38, 34, 34];
  const b: RGB = [24, 21, 22];
  const c: RGB = [58, 52, 50];
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const t = rnd();
      px.set(x, y, t < 0.3 ? b : t < 0.86 ? a : c);
    }
  bedrock = px.toUrl();
  return bedrock;
}

const crackCache: string[] = [];

/** Отрезок по пикселям без дыр (Брезенхэм). */
function line(px: Pixels, x0: number, y0: number, x1: number, y1: number, c: RGB, a: number) {
  let x = Math.round(x0);
  let y = Math.round(y0);
  const tx = Math.round(x1);
  const ty = Math.round(y1);
  const dx = Math.abs(tx - x);
  const dy = -Math.abs(ty - y);
  const sx = x < tx ? 1 : -1;
  const sy = y < ty ? 1 : -1;
  let err = dx + dy;
  for (let guard = 0; guard < 64; guard++) {
    px.set(x, y, c, a);
    if (x === tx && y === ty) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/** Ломаная из (x, y) по направлению `ang`: `n` звеньев по полтора пикселя. */
function walk(rnd: () => number, x: number, y: number, ang: number, n: number): [number, number][] {
  const pts: [number, number][] = [[x, y]];
  for (let i = 0; i < n; i++) {
    ang += rnd() * 0.9 - 0.45;
    x += Math.cos(ang) * 1.6;
    y += Math.sin(ang) * 1.6;
    pts.push([x, y]);
  }
  return pts;
}

/**
 * Трещина стадии 1…3. Ветви одни и те же для всех стадий, растёт только
 * длина: трещина на глазах РАСТЁТ, а не подменяется другой картинкой. На
 * последней стадии она доходит до края и у блока откалываются углы.
 */
export function crackTexture(stage: number): string {
  if (stage <= 0) return '';
  const k = Math.min(3, stage);
  if (crackCache[k]) return crackCache[k];
  const rnd = rng32(0xc4ac);
  const px = new Pixels();
  const ink: RGB = [14, 10, 8];
  const lip: RGB = [255, 244, 225];
  const a0 = rnd() * Math.PI * 2;
  const main = [walk(rnd, 7.5, 7.5, a0, 9), walk(rnd, 7.5, 7.5, a0 + Math.PI, 9)];
  const branches = [0, 1, 2].map((i) => {
    const from = main[i % 2][3 + i * 2] ?? main[0][3];
    return walk(
      rnd,
      from[0],
      from[1],
      a0 + (i % 2 ? Math.PI : 0) + (rnd() < 0.5 ? 1 : -1) * (0.7 + rnd() * 0.5),
      4,
    );
  });
  const reach = [0, 3, 6, 9][k];
  const draw = (pts: [number, number][], n: number) => {
    for (let i = 0; i < Math.min(n, pts.length - 1); i++) {
      // Светлая кромка на пиксель ниже: без неё тёмная линия на тёмной
      // породе теряется.
      line(px, pts[i][0] + 0.6, pts[i][1] + 0.9, pts[i + 1][0] + 0.6, pts[i + 1][1] + 0.9, lip, 60);
    }
    for (let i = 0; i < Math.min(n, pts.length - 1); i++) {
      line(px, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], ink, 225);
    }
  };
  main.forEach((m) => draw(m, reach));
  if (k >= 2) draw(branches[0], 3);
  if (k >= 3) branches.forEach((b) => draw(b, 4));
  if (k >= 3) {
    // Отколотые углы: пиксели дыры открывают тёмную яму под блоком.
    const hole: RGB = [10, 7, 6];
    for (const [x, y] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [15, 15],
      [14, 15],
      [15, 14],
      [15, 0],
    ])
      px.set(x, y, hole, 235);
  }
  crackCache[k] = px.toUrl();
  return crackCache[k];
}

/** Цвета крошки породы — для частиц. */
export function rockColors(rock: number): string[] {
  const r = ROCKS[rock];
  if (!r) return ['#444', '#222'];
  return [r.base, r.dark, r.fleck, r.base, r.shine];
}
