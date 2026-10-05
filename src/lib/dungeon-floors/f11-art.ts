// Этаж 11 «Небесный архипелаг» — рисовальщики: небо под островами (два
// слоя облаков, дальний — в клетках, ближний плывёт с параллаксом), обрывы
// островов, трава, дорожки, грядки, акведук, мрамор замка; ленты ветра на
// полу и порывы; вещи этажа (ветряки, вертушки, флаги, фонтаны, водопады в
// небо); монстры и Древний страж; метки ударов; иконки вещей.
//
// Всё нарисовано кодом: пиксели 16 на клетку, свет сверху-слева, контур
// тёмный сине-серый (дневной свет, а не подземная тьма), палитра — светлая:
// первый дневной этаж подземелья. Шум, камни и облака считаются в МИРОВЫХ
// пикселях — клетки стыкуются без швов.
//
// Кадры собираются один раз и лежат в кеше: рисовать кадр в кадре нельзя.
// Живое (облака, ленты ветра, воздух) — зоны этажа: их рисовальщик
// получает камеру и рисует готовые кусочки, а не пиксели.

import { Px } from '../dungeon-art';
import {
  frameLRU,
  paintSim,
  registerCellPainter,
  registerItemArt,
  registerMobPainter,
  registerMobWarm,
  registerPropPainter,
  registerShotPainter,
  registerZonePainter,
} from '../dungeon-paint';
import type { CellCtx, MobFrame, MobPose, Sprite } from '../dungeon-paint';
import type { Mob, Sim, Strike, Zone } from '../dungeon-sim';
import type { WorldObj } from '../dungeon-world';
import { F11_AQUA, F11_CASTLE, F11_GARDEN, F11_MARK } from './f11';
import {
  BOSS,
  expoAt,
  f11State,
  GARDENER,
  GUARD,
  gustBlow,
  gustWarn,
  HARPY,
  JELLY,
  millDir,
  MOSS as MOSS_AI,
  SPIRIT,
  stormOn,
  towerTurn,
  valveShown,
  windAt,
} from './f11-brains';
import type { F11State } from './f11-brains';

type RGBA = [number, number, number, number];

export const hx = (h: string, a = 255): RGBA => {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255, a];
};
const mixc = (a: RGBA, b: RGBA, k: number): RGBA => [
  Math.round(a[0] + (b[0] - a[0]) * k),
  Math.round(a[1] + (b[1] - a[1]) * k),
  Math.round(a[2] + (b[2] - a[2]) * k),
  Math.round(a[3] + (b[3] - a[3]) * k),
];
export const alpha = (c: RGBA, a: number): RGBA => [
  c[0],
  c[1],
  c[2],
  Math.round(Math.max(0, Math.min(1, a)) * 255),
];
const css = (c: RGBA, a = c[3] / 255) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

export const TAU = Math.PI * 2;
const PI = Math.PI;
const MK = F11_MARK;
export const TS = 16;

/** Контур этажа: тёмный сине-серый — дневной свет, а не подземная тьма. */
const INK = hx('#1d2130');
const WHITE = hx('#ffffff');

// ---------------------------------------------------------------------------
// Шум и хеши — в мировых пикселях, чтобы клетки стыковались.
// ---------------------------------------------------------------------------

export const hash = (a: number, b: number, c = 0) => {
  let h = (a * 374761393 + b * 668265263 + c * 1274126177) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Гладкий шум 0…1 с шагом `s`. */
function vnoise(x: number, y: number, s: number, seed = 0): number {
  const fx = x / s;
  const fy = y / s;
  const xi = Math.floor(fx);
  const yi = Math.floor(fy);
  const u = smooth(fx - xi);
  const v = smooth(fy - yi);
  const a = hash(xi, yi, seed) * (1 - u) + hash(xi + 1, yi, seed) * u;
  const b = hash(xi, yi + 1, seed) * (1 - u) + hash(xi + 1, yi + 1, seed) * u;
  return a * (1 - v) + b * v;
}

/** Периодический гладкий шум (для текстур неба): период `p` клеток шума. */
function pnoise(x: number, y: number, s: number, p: number, seed = 0): number {
  const fx = x / s;
  const fy = y / s;
  const xi = Math.floor(fx);
  const yi = Math.floor(fy);
  const u = smooth(fx - xi);
  const v = smooth(fy - yi);
  const w = (i: number) => ((i % p) + p) % p;
  const a = hash(w(xi), w(yi), seed) * (1 - u) + hash(w(xi + 1), w(yi), seed) * u;
  const b = hash(w(xi), w(yi + 1), seed) * (1 - u) + hash(w(xi + 1), w(yi + 1), seed) * u;
  return a * (1 - v) + b * v;
}

/**
 * Камни по Вороному в мировых пикселях: ближняя точка сетки с шагом `s`.
 * Возвращает номер камня, расстояние до края (разница двух ближних) и
 * смещение от центра камня — для светотени.
 */
function voronoi(
  X: number,
  Y: number,
  s: number,
  seed: number,
  jit = 0.8,
): { id: number; edge: number; ox: number; oy: number } {
  const gx = Math.floor(X / s);
  const gy = Math.floor(Y / s);
  let d1 = 1e9;
  let d2 = 1e9;
  let id = 0;
  let ox = 0;
  let oy = 0;
  for (let j = -1; j <= 1; j++)
    for (let i = -1; i <= 1; i++) {
      const cx = gx + i;
      const cy = gy + j;
      const px = (cx + 0.5 + (hash(cx, cy, seed) - 0.5) * jit) * s;
      const py = (cy + 0.5 + (hash(cx, cy, seed + 7) - 0.5) * jit) * s;
      const d = Math.hypot(X - px, Y - py);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        id = cx * 7919 + cy;
        ox = X - px;
        oy = Y - py;
      } else if (d < d2) d2 = d;
    }
  return { id, edge: d2 - d1, ox, oy };
}

// ---------------------------------------------------------------------------
// Рисование: формы со светом сверху-слева.
// ---------------------------------------------------------------------------

/** Четыре тона формы: тень, основа, свет, блик. */
type Tones = [RGBA, RGBA, RGBA, RGBA];
export const tn = (a: string, b: string, c: string, d: string): Tones => [
  hx(a),
  hx(b),
  hx(c),
  hx(d),
];

const LX = -0.45;
const LY = -0.72;
const LZ = 0.52;

function tone(t: Tones, l: number): RGBA {
  return l > 0.78 ? t[3] : l > 0.42 ? t[2] : l > 0.02 ? t[1] : t[0];
}

/** Овал с объёмом: цвет по нормали. */
function shadeEll(p: Px, cx: number, cy: number, rx: number, ry: number, t: Tones, bias = 0): void {
  if (rx <= 0 || ry <= 0) return;
  p.ell(cx, cy, rx, ry, (x, y) => {
    const dx = (x + 0.5 - cx) / rx;
    const dy = (y + 0.5 - cy) / ry;
    const nz = Math.sqrt(Math.max(0, 1 - dx * dx - dy * dy));
    return tone(t, dx * LX + dy * LY + nz * LZ + bias);
  });
}

/** Капсула от (x0, y0) до (x1, y1) со светом по нормали — руки, ноги, стебли. */
export function limb(
  p: Px,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  r0: number,
  r1: number,
  t: Tones,
  bias = 0,
): void {
  const minX = Math.floor(Math.min(x0 - r0, x1 - r1)) - 1;
  const maxX = Math.ceil(Math.max(x0 + r0, x1 + r1)) + 1;
  const minY = Math.floor(Math.min(y0 - r0, y1 - r1)) - 1;
  const maxY = Math.ceil(Math.max(y0 + r0, y1 + r1)) + 1;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const L2 = dx * dx + dy * dy || 1e-6;
  for (let y = minY; y <= maxY; y++)
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const k = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / L2));
      const cx = x0 + dx * k;
      const cy = y0 + dy * k;
      const r = r0 + (r1 - r0) * k;
      const ex = px - cx;
      const ey = py - cy;
      const d = Math.hypot(ex, ey);
      if (d > r) continue;
      const nx = ex / (r || 1);
      const ny = ey / (r || 1);
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      p.set(x, y, tone(t, nx * LX + ny * LY + nz * LZ + bias));
    }
}

/** Многоугольник заливкой. */
function poly(p: Px, pts: [number, number][], c: RGBA | ((x: number, y: number) => RGBA)): void {
  let minX = 1e9;
  let maxX = -1e9;
  let minY = 1e9;
  let maxY = -1e9;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++)
    for (let x = Math.floor(minX); x <= Math.ceil(maxX); x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i];
        const [xj, yj] = pts[j];
        if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) p.set(x, y, typeof c === 'function' ? c(x, y) : c);
    }
}

/** Многоугольник со светом (плоская грань, ярче к верху-слева). */
function polyShade(p: Px, pts: [number, number][], t: Tones, bias = 0): void {
  let cx = 0;
  let cy = 0;
  let r = 1;
  for (const [x, y] of pts) {
    cx += x;
    cy += y;
  }
  cx /= pts.length;
  cy /= pts.length;
  for (const [x, y] of pts) r = Math.max(r, Math.hypot(x - cx, y - cy));
  poly(p, pts, (x, y) => tone(t, ((x + 0.5 - cx) * LX + (y + 0.5 - cy) * LY) / r + 0.45 + bias));
}

/** Толстая линия. */
export function stroke(
  p: Px,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  c: RGBA,
  w = 1,
): void {
  const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2) + 1;
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    const y = y0 + ((y1 - y0) * i) / n;
    if (w <= 1) p.set(Math.floor(x), Math.floor(y), c);
    else p.ell(x, y, w / 2, w / 2, c);
  }
}

/** Кривая Катмулла — Рома через точки. */
function spline(pts: [number, number][], n = 6): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 *
        (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Контур снаружи фигуры (со светлой стороны — светлее: мягче на светлом полу). */
export function ink(p: Px, c: RGBA = INK, diag = false): Px {
  p.outline(c, diag);
  // Тени на полу кладутся ПОСЛЕ контура и только под фигурой: иначе контур
  // обвёл бы и тень.
  const sh = pendingShadow.get(p);
  if (sh) {
    pendingShadow.delete(p);
    for (const [cx, by, rx, ry] of sh)
      for (let y = -ry; y <= ry; y++)
        for (let x = -rx; x <= rx; x++) {
          if ((x * x) / (rx * rx) + (y * y) / (ry * ry) > 1) continue;
          const X = Math.round(cx + x);
          const Y = Math.round(by + y);
          if (!p.solid(X, Y)) p.set(X, Y, [18, 36, 58, 64]);
        }
  }
  return p;
}
const pendingShadow = new WeakMap<Px, [number, number, number, number][]>();

/** Сделать пиксель прозрачным (дыра в колесе, слом колонны). */
function clearPx(p: Px, x: number, y: number): void {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || y < 0 || x >= p.w || y >= p.h) return;
  p.data[(y * p.w + x) * 4 + 3] = 0;
}

/** Холст из пикселей — с кешем. */
const canvasCache = new Map<string, HTMLCanvasElement>();
function cv(key: string, make: () => Px): HTMLCanvasElement {
  let c = canvasCache.get(key);
  if (!c) {
    c = make().canvas();
    canvasCache.set(key, c);
  }
  return c;
}

/** Спрайт из пикселей — с кешем. */
const spriteCache = new Map<string, Sprite>();
export function sprite(key: string, make: () => { p: Px; ax: number; ay: number }): Sprite {
  let s = spriteCache.get(key);
  if (!s) {
    const r = make();
    s = { img: r.p.canvas(), ax: r.ax, ay: r.ay };
    spriteCache.set(key, s);
  }
  return s;
}

/** Затемнить/осветлить пиксель клетки на `k` (−1…1). */
function shadePx(p: Px, x: number, y: number, k: number): void {
  if (x < 0 || y < 0 || x >= p.w || y >= p.h) return;
  const i = (y * p.w + x) * 4;
  const d = p.data;
  if (k < 0) {
    d[i] = d[i] * (1 + k);
    d[i + 1] = d[i + 1] * (1 + k);
    d[i + 2] = d[i + 2] * (1 + k * 0.8);
  } else {
    d[i] += (255 - d[i]) * k;
    d[i + 1] += (255 - d[i + 1]) * k;
    d[i + 2] += (255 - d[i + 2]) * k;
  }
}

/** Смешать пиксель с цветом (для оттенка и тени на облаках). */
function tintPx(p: Px, x: number, y: number, c: RGBA, k: number): void {
  if (x < 0 || y < 0 || x >= p.w || y >= p.h) return;
  const i = (y * p.w + x) * 4;
  const d = p.data;
  d[i] += (c[0] - d[i]) * k;
  d[i + 1] += (c[1] - d[i + 1]) * k;
  d[i + 2] += (c[2] - d[i + 2]) * k;
}

// ---------------------------------------------------------------------------
// Палитры районов.
// ---------------------------------------------------------------------------

interface SkyPal {
  /** Небо между облаками — глубина. */
  deep: RGBA;
  deep2: RGBA;
  /** Облачное море: тень, основа, свет, блик. */
  cloud: Tones;
  /** Тень острова на облаках. */
  shadow: RGBA;
  /** Обрыв острова: земля, порода, темнота низа. */
  earth: Tones;
  rock: Tones;
  under: RGBA;
}

const SKY: Record<string, SkyPal> = {
  [F11_GARDEN]: {
    deep: hx('#5d9fdc'),
    deep2: hx('#6fb0e6'),
    cloud: tn('#8db8e2', '#b9d7f2', '#e2eefa', '#fbfdff'),
    shadow: hx('#5b86bc'),
    earth: tn('#5a3e2c', '#7c583a', '#9a7148', '#b58a58'),
    rock: tn('#6b6660', '#8a847b', '#a8a196', '#c4bdb0'),
    under: hx('#3b3a44'),
  },
  [F11_AQUA]: {
    deep: hx('#d88e62'),
    deep2: hx('#e8a472'),
    cloud: tn('#d98f76', '#f0b894', '#fcd9b4', '#fff0dc'),
    shadow: hx('#b56e5c'),
    earth: tn('#6a4430', '#8e6040', '#b07e52', '#c99a64'),
    rock: tn('#7a6450', '#9c8266', '#bea27c', '#d8be94'),
    under: hx('#4a3434'),
  },
  [F11_CASTLE]: {
    deep: hx('#39425a'),
    deep2: hx('#434d66'),
    cloud: tn('#2c3448', '#4a5470', '#6e7894', '#98a2ba'),
    shadow: hx('#262c3e'),
    earth: tn('#3e3430', '#584a40', '#6e5e50', '#86745e'),
    rock: tn('#5a5c66', '#767884', '#9496a2', '#b4b6c0'),
    under: hx('#1e2230'),
  },
};

const skyOf = (area: string) => SKY[area] ?? SKY[F11_GARDEN];

// Трава: тень, основа, свет, блик и сухая.
const GRASS = tn('#2e6a36', '#468d43', '#62a84d', '#8cc75f');
const GRASS_HI = hx('#b4dc78');
const GRASS_DARK = hx('#244f2c');
// Дорожка: светлый тёплый камень.
const PATH = tn('#948a76', '#b1a791', '#c3baa3', '#d9d1bc');
const GROUT = hx('#7a715e');
// Мох.
const MOSS = tn('#26492a', '#36633a', '#4f8446', '#76ad58');
// Грядка.
const SOIL = tn('#40291c', '#5c3e29', '#7a5536', '#946a44');
const EDGING = tn('#5a3a22', '#86603a', '#a87c4c', '#c89a62');
// Песчаник акведука.
const SAND = tn('#a88458', '#c8a472', '#dcbd8c', '#eed6aa');
const SAND_GROUT = hx('#8a6a48');
// Земля.
const DIRT = tn('#80603e', '#9c7a52', '#b49468', '#c8ab7e');
// Вода канала.
const WATER = tn('#2a5f98', '#3d7fbf', '#5aa0da', '#9ccff2');
// Мрамор и мозаика.
const MARBLE = tn('#b2b1c0', '#d2d1dc', '#e6e5ee', '#f8f8fc');
const MOSAIC_BLUE = tn('#24406c', '#32568c', '#4670a8', '#7094c4');
const GOLD = tn('#8a6420', '#c29434', '#e4bb52', '#fbe39a');
// Кора корней.
const BARK = tn('#3e2718', '#5c3a24', '#7c5232', '#9e7048');
// Доски моста.
const PLANK = tn('#5e3e22', '#8a6038', '#aa7c4a', '#c89a62');
const ROPE = tn('#7a6440', '#a8905c', '#cdb57a', '#e6d29a');
// Камень моста.
const COBBLE = tn('#827c72', '#a29b8e', '#bdb6a8', '#d4cebf');
// Железо решёток.
const IRON = tn('#26282e', '#3c4048', '#585e6a', '#7c8290');
// Летучий камень плит — светится бирюзой.
const LEVI = tn('#5e7088', '#8298b0', '#a8bccf', '#cfdcea');
const RUNE = hx('#6ff4e6');
// Стены.
const HEDGE = tn('#1d4526', '#2d6334', '#447f44', '#66a454');
const ROCK = tn('#7e776a', '#9e9788', '#bcb5a5', '#d6d0c2');
const RUIN = tn('#9c7a52', '#bf9a68', '#d8b682', '#ecd2a2');
const CASTLE = tn('#8e8ea0', '#b8b8c8', '#d8d8e4', '#f0f0f6');
const SLATE = tn('#223458', '#2f4a7a', '#44659c', '#6388c0');
const CRYSTAL = tn('#1f6c74', '#2fa0a4', '#5fd6cc', '#bff8ee');

// ---------------------------------------------------------------------------
// Небо: две периодические текстуры облачного моря (дальнее — в клетках,
// ближнее плывёт зоной с параллаксом).
// ---------------------------------------------------------------------------

const SKY_TEX = 128;
const skyTex = new Map<string, Px>();

/** Облачное море: пухлые облака, свет сверху-слева, между ними — глубина. */
function farSky(area: string): Px {
  let p = skyTex.get(area);
  if (p) return p;
  const pal = skyOf(area);
  p = new Px(SKY_TEX, SKY_TEX);
  const N = SKY_TEX;
  const hgt = new Float32Array(N * N);
  // Высота облаков: крупные пуфы + средняя рябь, периодически.
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const a = pnoise(x, y, 32, 4, 11);
      const b = pnoise(x, y, 16, 8, 12);
      const c = pnoise(x, y, 8, 16, 13);
      hgt[y * N + x] = a * 0.58 + b * 0.3 + c * 0.12;
    }
  const at = (x: number, y: number) => hgt[(((y % N) + N) % N) * N + (((x % N) + N) % N)];
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const h = at(x, y);
      if (h < 0.47) {
        // Просвет: глубокое небо, чуть светлее у края облака.
        const k = Math.max(0, (h - 0.38) / 0.09);
        const base = (x + y * 3) % 7 === 0 && h < 0.42 ? pal.deep2 : pal.deep;
        p.set(x, y, mixc(base, pal.cloud[0], k * 0.5));
        continue;
      }
      // Свет: наклон высоты к свету сверху-слева.
      const gx = at(x + 1, y) - at(x - 1, y);
      const gy = at(x, y + 1) - at(x, y - 1);
      const l = -(gx * LX + gy * LY) * 9 + (h - 0.47) * 2.2;
      p.set(x, y, tone(pal.cloud, l + 0.05));
    }
  // Кромка облака — тенью снизу-справа (объём).
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      if (at(x, y) >= 0.47 || at(x - 1, y - 1) < 0.47) continue;
      p.set(x, y, mixc(pal.deep, pal.cloud[0], 0.75));
    }
  skyTex.set(area, p);
  return p;
}

/** Ближние облака (зона): редкие светлые клочья с прозрачным краем. */
const nearTex = new Map<string, HTMLCanvasElement>();
function nearSky(area: string): HTMLCanvasElement {
  let c = nearTex.get(area);
  if (c) return c;
  const pal = skyOf(area);
  const N = 256;
  const p = new Px(N, N);
  const hgt = new Float32Array(N * N);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const a = pnoise(x, y, 48, 5.333, 21);
      const b = pnoise(x, y, 20, 12.8, 22);
      const cc = pnoise(x, y, 9, 28.44, 23);
      hgt[y * N + x] = a * 0.6 + b * 0.28 + cc * 0.12;
    }
  const at = (x: number, y: number) => hgt[(((y % N) + N) % N) * N + (((x % N) + N) % N)];
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const h = at(x, y);
      if (h < 0.6) continue;
      const gx = at(x + 1, y) - at(x - 1, y);
      const gy = at(x, y + 1) - at(x, y - 1);
      const l = -(gx * LX + gy * LY) * 10 + (h - 0.6) * 3;
      const col = tone(pal.cloud, l + 0.5);
      // Край клочка полупрозрачный: облако, а не наклейка.
      const a = Math.min(1, (h - 0.6) / 0.05);
      p.set(x, y, alpha(col, 0.35 + 0.5 * a));
    }
  c = p.canvas();
  nearTex.set(area, c);
  return c;
}

/** Цвет дальнего неба в мировом пикселе. */
function skyAt(area: string, X: number, Y: number): RGBA {
  const t = farSky(area);
  const x = ((X % SKY_TEX) + SKY_TEX) % SKY_TEX;
  const y = ((Y % SKY_TEX) + SKY_TEX) % SKY_TEX;
  const i = (y * SKY_TEX + x) * 4;
  return [t.data[i], t.data[i + 1], t.data[i + 2], 255];
}

// ---------------------------------------------------------------------------
// Клетки районов.
// ---------------------------------------------------------------------------

const SKY_MARKS = new Set<number>([MK.sky, MK.fallen, MK.rising, MK.border]);
const T_DEEP = 11;

/** Пол по умолчанию района (для букв движка: K, T, $, E…). */
const FLOOR_OF: Record<string, number> = {
  [F11_GARDEN]: MK.grass,
  [F11_AQUA]: MK.sand,
  [F11_CASTLE]: MK.marble,
};
/** Стена по умолчанию района (норы, шахта, трещина). */
const WALL_OF: Record<string, number> = {
  [F11_GARDEN]: MK.rock,
  [F11_AQUA]: MK.ruin,
  [F11_CASTLE]: MK.castle,
};

const FLOOR_MARKS = new Set<number>([
  MK.grass,
  MK.path,
  MK.moss,
  MK.bed,
  MK.sand,
  MK.marble,
  MK.mosaic,
  MK.roots,
  MK.plank,
  MK.stone,
  MK.arena,
  MK.vent,
  MK.plate,
  MK.dirt,
  MK.water,
  MK.cracking,
]);

/** Пост — пол того вида, на котором стоит. */
const POST_FLOOR: Record<number, number> = {
  [MK.guardPost]: MK.mosaic,
  [MK.gardenerPost]: MK.bed,
  [MK.mossPost]: MK.moss,
  [MK.sentryPost]: MK.mosaic,
  [MK.harpyPost]: MK.sand,
};

type Near = 'sky' | 'wall' | 'floor';

/** Что за соседом: небо, стена или пол. */
function nearOf(c: CellCtx, dx: number, dy: number): Near {
  const mk = c.markAt(dx, dy);
  if (SKY_MARKS.has(mk)) return 'sky';
  if (!c.open(dx, dy)) return 'wall';
  return 'floor';
}

/** Вид пола соседа (для «пола под вещью» и стыков). */
function floorMarkAt(c: CellCtx, area: string, dx: number, dy: number): number {
  const mk = c.markAt(dx, dy);
  if (FLOOR_MARKS.has(mk)) return mk;
  if (POST_FLOOR[mk]) return POST_FLOOR[mk];
  return FLOOR_OF[area];
}

/** Пол под вещью: вид большинства соседей-полов. */
function underFloor(c: CellCtx, area: string): number {
  const count = new Map<number, number>();
  for (const [dx, dy] of [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ]) {
    const mk = c.markAt(dx, dy);
    const f = FLOOR_MARKS.has(mk) ? mk : POST_FLOOR[mk];
    if (!f || f === MK.plank || f === MK.water || f === MK.plate || f === MK.cracking) continue;
    count.set(f, (count.get(f) ?? 0) + (dx && dy ? 1 : 2));
  }
  let best = FLOOR_OF[area];
  let bn = 0;
  for (const [k, n] of count)
    if (n > bn) {
      bn = n;
      best = k;
    }
  return best;
}

// --- Полы -------------------------------------------------------------------

function grassPx(p: Px, X0: number, Y0: number, lush = 1): void {
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const Y = Y0 + y;
      // Спокойнее: крупные мягкие пятна света, мелкий шум — только оттенком.
      const v = vnoise(X, Y, 11, 1) * 0.75 + vnoise(X, Y, 3.5, 2) * 0.25;
      let c = GRASS[1];
      if (v > 0.62) c = GRASS[2];
      if (v > 0.8 * lush) c = mixc(GRASS[2], GRASS[3], 0.6);
      if (v < 0.26) c = mixc(GRASS[0], GRASS[1], 0.6);
      p.set(x, y, c);
    }
  // Травинки: тёмный низ, светлый верх.
  for (let y = 1; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const Y = Y0 + y;
      const h = hash(X, Y, 5);
      if (h < 0.04) {
        p.set(x, y, mixc(GRASS[0], GRASS[1], 0.4));
        p.set(x, y - 1, h < 0.012 ? GRASS_HI : GRASS[3]);
      }
    }
}

/** Цветы в траве: редкие кустики трёх цветов. */
function flowersPx(p: Px, wx: number, wy: number): void {
  const r = hash(wx, wy, 31);
  if (r > 0.34) return;
  const n = r < 0.08 ? 3 : r < 0.18 ? 2 : 1;
  const cols = [hx('#f4f1e4'), hx('#f2cc4a'), hx('#e98aa8'), hx('#b89ae8')];
  for (let i = 0; i < n; i++) {
    const x = 2 + Math.floor(hash(wx, wy, 40 + i) * 12);
    const y = 2 + Math.floor(hash(wx, wy, 50 + i) * 11);
    const col = cols[Math.floor(hash(wx, wy, 60 + i) * cols.length)];
    p.set(x, y + 1, GRASS[0]);
    p.set(x - 1, y, col);
    p.set(x + 1, y, col);
    p.set(x, y - 1, col);
    p.set(x, y, hx('#f6d65a'));
    p.set(x + 1, y - 1, mixc(col, WHITE, 0.4));
  }
}

function pathPx(p: Px, X0: number, Y0: number): void {
  // Крупные плиты дорожки: спокойный тон, фаска светом сверху-слева, в швах
  // — трава. Мелкая брусчатка на экране телефона рябила и спорила со всем.
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const Y = Y0 + y;
      const v = voronoi(X, Y, 11, 3, 0.7);
      if (v.edge < 1.2) {
        p.set(x, y, hash(X, Y, 8) < 0.22 ? GRASS[1] : GROUT);
        continue;
      }
      const tint = hash(v.id, 1);
      let c = tint < 0.33 ? PATH[1] : PATH[2];
      if (v.edge < 2.2) {
        // Фаска: сторона плиты к свету — светлая, от света — тёмная.
        const toLight = v.ox * LX + v.oy * LY;
        c = toLight > 0.6 ? PATH[3] : toLight < -0.6 ? PATH[0] : c;
      } else if (hash(X, Y, 9) < 0.04) c = tint < 0.33 ? PATH[0] : PATH[1];
      p.set(x, y, c);
    }
}

function mossPx(p: Px, X0: number, Y0: number): void {
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const Y = Y0 + y;
      const v = voronoi(X, Y, 4.5, 17, 0.9);
      if (v.edge < 0.7) {
        p.set(x, y, MOSS[0]);
        continue;
      }
      const l = -(v.ox * LX + v.oy * LY) / 3 + 0.3;
      p.set(x, y, tone(MOSS, l + (hash(v.id, 3) - 0.5) * 0.3));
      if (hash(X, Y, 19) < 0.015) p.set(x, y, hx('#c8e878'));
    }
}

function bedPx(p: Px, X0: number, Y0: number, wx: number, wy: number): void {
  const cols = [hx('#e0564a'), hx('#f2c843'), hx('#9a6ad0'), hx('#f2eee4'), hx('#ef8ab0')];
  const col = cols[Math.floor(hash(Math.floor(wx / 2), Math.floor(wy / 2), 71) * cols.length)];
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const Y = Y0 + y;
      const row = ((Y % 5) + 5) % 5;
      const c = row === 0 ? SOIL[2] : row === 1 ? SOIL[1] : row === 4 ? SOIL[0] : SOIL[1];
      p.set(x, y, hash(X0 + x, Y, 72) < 0.05 ? SOIL[3] : c);
    }
  // Ряды посадок: росток и цветок на гребне борозды.
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const Y = Y0 + y;
      if (((Y % 5) + 5) % 5 !== 2 || ((X % 4) + 4) % 4 !== 1) continue;
      p.set(x, y, hx('#3f7e36'));
      p.set(x - 1, y, hx('#5ea048'));
      p.set(x + 1, y, hx('#4f9040'));
      p.set(x, y - 1, col);
      p.set(x, y - 2, mixc(col, WHITE, 0.35));
      p.set(x + 1, y - 1, mixc(col, INK, 0.25));
    }
}

function sandPx(p: Px, X0: number, Y0: number): void {
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const Y = Y0 + y;
      const row = Math.floor(Y / 8);
      const off = ((row % 2) + 2) % 2 ? 8 : 0;
      const u = (((X + off) % 16) + 16) % 16;
      const v = ((Y % 8) + 8) % 8;
      const bid = Math.floor((X + off) / 16) * 131 + row;
      if (u === 0 || v === 0) {
        p.set(x, y, hash(X, Y, 81) < 0.25 ? hx('#7c8a4a') : SAND_GROUT);
        continue;
      }
      let c = SAND[hash(bid, 2) < 0.5 ? 1 : 2];
      // Кромка светом сверху, тень снизу — не у каждого камня: кладка
      // стёрта ногами и ветром.
      if (v === 1 && hash(bid, 3) < 0.7) c = SAND[3];
      else if (v === 7 && hash(bid, 4) < 0.5) c = mixc(c, SAND[0], 0.6);
      const w = vnoise(X, Y, 3, 83);
      if (w < 0.16) c = mixc(c, SAND[0], 0.4);
      // Песок, нанесённый ветром, — большими языками поверх кладки.
      const drift = vnoise(X, Y, 14, 85);
      if (drift > 0.66) c = mixc(c, hx('#e8d4a4'), Math.min(1, (drift - 0.66) * 4));
      if (hash(X, Y, 84) < 0.015) c = SAND[0];
      p.set(x, y, c);
    }
}

function dirtPx(p: Px, X0: number, Y0: number): void {
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const Y = Y0 + y;
      const v = vnoise(X, Y, 5, 91) * 0.7 + vnoise(X, Y, 2, 92) * 0.3;
      let c = v > 0.62 ? DIRT[2] : v < 0.35 ? DIRT[0] : DIRT[1];
      if (hash(X, Y, 93) < 0.04) c = DIRT[3];
      p.set(x, y, c);
    }
}

function waterPx(p: Px, X0: number, Y0: number): void {
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const Y = Y0 + y;
      const v = vnoise(X, Y * 0.5, 10, 101);
      let c =
        v > 0.7
          ? mixc(WATER[1], WATER[2], 0.6)
          : v < 0.24
            ? mixc(WATER[0], WATER[1], 0.5)
            : WATER[1];
      // Рябь поперёк течения: короткие светлые штрихи, редко.
      const r = vnoise(X * 0.5, Y, 3, 102);
      if (r > 0.78 && (Y + Math.floor(v * 4)) % 6 === 0) c = mixc(WATER[2], WATER[3], 0.6);
      p.set(x, y, c);
    }
}

function marblePx(p: Px, X0: number, Y0: number): void {
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const Y = Y0 + y;
      // Плиты 16×12 вразбежку: мелкая сетка 8×8 читалась кафелем ванной.
      const row = Math.floor(Y / 12);
      const off = row % 2 ? 8 : 0;
      const u = (((X + off) % 16) + 16) % 16;
      const v = ((Y % 12) + 12) % 12;
      const slab = Math.floor((X + off) / 16) * 977 + row;
      if (u === 0 || v === 0) {
        p.set(x, y, mixc(MARBLE[0], MARBLE[1], 0.35));
        continue;
      }
      let c = MARBLE[hash(slab, 111) < 0.35 ? 1 : 2];
      if (v === 1) c = MARBLE[3];
      else if (v === 11) c = mixc(c, MARBLE[0], 0.5);
      // Прожилки: две разной толщины, по мировым пикселям — через швы.
      const vein = Math.abs(vnoise(X, Y, 13, 112) - 0.5);
      const vein2 = Math.abs(vnoise(X + 40, Y * 1.3, 7, 113) - 0.5);
      if (vein < 0.03) c = mixc(c, hx('#8e8ca6'), 0.65);
      else if (vein2 < 0.018) c = mixc(c, hx('#a6a4bc'), 0.45);
      p.set(x, y, c);
    }
}

function mosaicPx(p: Px, X0: number, Y0: number): void {
  // Мозаика двора: медальон на три клетки — тонкое золотое кольцо-ромб,
  // белая звезда посередине, остальное — синяя смальта кусочками 3×3 с
  // лёгким разбросом тона. Раньше ромб стоял в каждой второй клетке и двор
  // читался ковром.
  const P = 48;
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const Y = Y0 + y;
      const u = (((X % P) + P) % P) - (P / 2 - 0.5);
      const v = (((Y % P) + P) % P) - (P / 2 - 0.5);
      const d = Math.abs(u) + Math.abs(v);
      const bx = Math.floor(X / 3);
      const by = Math.floor(Y / 3);
      const tess = ((X % 3) + 3) % 3 === 0 || ((Y % 3) + 3) % 3 === 0;
      let c: RGBA;
      if (d > 15 && d < 17.2) c = GOLD[hash(bx, by, 122) < 0.5 ? 2 : 1];
      else if (d < 4.5) c = d < 2.5 ? WHITE : hx('#dfe8f6');
      else if ((Math.abs(u) < 0.8 || Math.abs(v) < 0.8) && d < 14) c = MOSAIC_BLUE[3];
      else if (Math.max(Math.abs(u), Math.abs(v)) > P / 2 - 1) c = GOLD[1];
      else {
        const r = hash(bx, by, 123);
        c = MOSAIC_BLUE[r < 0.2 ? 0 : r < 0.75 ? 1 : 2];
      }
      if (tess) c = mixc(c, hx('#16264a'), 0.28);
      p.set(x, y, c);
    }
}

/** Корни: переплетённые жгуты коры, между ними — земля и мох. */
function rootsPx(p: Px, X0: number, Y0: number, base: 'marble' | 'earth'): void {
  if (base === 'marble') marblePx(p, X0, Y0);
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const Y = Y0 + y;
      const a = vnoise(X, Y, 40, 131) * PI * 1.4;
      const s = Math.sin((X * Math.cos(a) + Y * Math.sin(a)) * 0.42 + vnoise(X, Y, 9, 132) * 7);
      if (s > 0.15) {
        const l = s > 0.75 ? 3 : s > 0.45 ? 2 : 1;
        let c = BARK[l];
        if (hash(X, Y, 133) < 0.08) c = BARK[0];
        p.set(x, y, c);
      } else if (base === 'earth') {
        const m = vnoise(X, Y, 3, 134);
        p.set(x, y, m > 0.55 ? MOSS[1] : s > -0.1 ? BARK[0] : hx('#3a2c20'));
      } else if (s > -0.05) p.set(x, y, BARK[0]);
    }
}

function plankPx(p: Px, X0: number, Y0: number, c: CellCtx): void {
  const skyW = nearOf(c, -1, 0) === 'sky';
  const skyE = nearOf(c, 1, 0) === 'sky';
  const skyN = nearOf(c, 0, -1) === 'sky';
  const skyS = nearOf(c, 0, 1) === 'sky';
  const vert =
    (skyW || skyE) && !(skyN || skyS) ? true : (skyN || skyS) && !(skyW || skyE) ? false : true;
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const Y = Y0 + y;
      const along = vert ? Y : X;
      const across = vert ? X : Y;
      const k = ((along % 5) + 5) % 5;
      const plank = Math.floor(along / 5);
      if (k === 4) {
        p.set(x, y, hx('#3e2a18'));
        continue;
      }
      // Доски разной длины: шов поперёк — в своём месте у каждой.
      const acr = ((across % 16) + 16) % 16;
      const seam = 3 + Math.floor(hash(plank, 6) * 10);
      if (acr === seam && hash(plank, 7) < 0.55) {
        p.set(x, y, hx('#4a321c'));
        continue;
      }
      const tone0 = hash(plank, 4) < 0.5 ? 1 : 2;
      let col = PLANK[tone0];
      if (k === 0) col = PLANK[Math.min(3, tone0 + 1)];
      if (k === 3) col = mixc(col, PLANK[0], 0.45);
      // Волокна — редко; гвозди — только у перил.
      if (hash(across, plank, 141) < 0.025) col = mixc(col, PLANK[0], 0.6);
      if ((acr === 2 || acr === 13) && k === 1 && hash(plank, 5) < 0.45) col = hx('#55555e');
      p.set(x, y, col);
    }
  // Верёвочные перила над небом, столбики через клетку.
  const rail = (edge: 'W' | 'E' | 'N' | 'S') => {
    for (let i = 0; i < TS; i++) {
      const [x, y] =
        edge === 'W' ? [1, i] : edge === 'E' ? [14, i] : edge === 'N' ? [i, 1] : [i, 14];
      const sag = edge === 'W' || edge === 'E' ? 0 : 0;
      p.set(x, y + sag, ROPE[2]);
      p.set(
        edge === 'W' ? 0 : edge === 'E' ? 15 : x,
        edge === 'N' ? 0 : edge === 'S' ? 15 : y,
        ROPE[0],
      );
    }
    const post = (((vert ? Y0 / TS : X0 / TS) % 3) + 3) % 3 === 0;
    if (post) {
      const [px, py] =
        edge === 'W' ? [0, 6] : edge === 'E' ? [13, 6] : edge === 'N' ? [6, 0] : [6, 13];
      for (let dy = 0; dy < 3; dy++)
        for (let dx = 0; dx < 3; dx++)
          p.set(px + dx, py + dy, dx === 0 || dy === 0 ? PLANK[2] : PLANK[0]);
    }
  };
  if (skyW) rail('W');
  if (skyE) rail('E');
  if (skyN && !vert) rail('N');
  if (skyS && !vert) rail('S');
}

function cobblePx(p: Px, X0: number, Y0: number, c: CellCtx): void {
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const Y = Y0 + y;
      const v = voronoi(X, Y, 6, 151);
      if (v.edge < 0.9) {
        p.set(x, y, COBBLE[0]);
        continue;
      }
      const toLight = v.ox * LX + v.oy * LY;
      const r = hash(v.id, 7);
      p.set(
        x,
        y,
        v.edge < 1.8 && toLight > 0.6
          ? COBBLE[3]
          : v.edge < 1.8 && toLight < -0.6
            ? COBBLE[0]
            : COBBLE[r < 0.35 ? 1 : 2],
      );
    }
  // Парапет над небом: светлый камень, тёмный наружный край.
  const edges: [number, number, (i: number) => [number, number][]][] = [
    [
      -1,
      0,
      (i) => [
        [0, i],
        [1, i],
      ],
    ],
    [
      1,
      0,
      (i) => [
        [15, i],
        [14, i],
      ],
    ],
    [
      0,
      -1,
      (i) => [
        [i, 0],
        [i, 1],
      ],
    ],
    [
      0,
      1,
      (i) => [
        [i, 15],
        [i, 14],
      ],
    ],
  ];
  for (const [dx, dy, f] of edges) {
    if (nearOf(c, dx, dy) !== 'sky') continue;
    for (let i = 0; i < TS; i++) {
      const [[ax, ay], [bx, by]] = f(i);
      p.set(ax, ay, COBBLE[0]);
      p.set(bx, by, (i + (dx ? Y0 : X0) / 2) % 6 < 5 ? COBBLE[3] : COBBLE[1]);
    }
  }
}

/** Плиты: ровный тон камня, фаска светом сверху-слева, шов. */
function flagPx(
  p: Px,
  X0: number,
  Y0: number,
  size: number,
  seed: number,
  pal: Tones,
  grout: RGBA,
  jit = 0.6,
): void {
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const Y = Y0 + y;
      const v = voronoi(X, Y, size, seed, jit);
      if (v.edge < 1.1) {
        p.set(x, y, grout);
        continue;
      }
      const r = hash(v.id, seed + 9);
      let c = r < 0.3 ? pal[1] : pal[2];
      if (v.edge < 2.1) {
        const toLight = v.ox * LX + v.oy * LY;
        if (toLight > 0.7) c = pal[3];
        else if (toLight < -0.7) c = pal[0];
      } else if (hash(X, Y, seed + 3) < 0.035) c = pal[r < 0.3 ? 0 : 1];
      p.set(x, y, c);
    }
}

function arenaPx(p: Px, X0: number, Y0: number): void {
  flagPx(p, X0, Y0, 12, 161, tn('#8e8c9c', '#aeacbc', '#c2c0ce', '#dcdae6'), hx('#7c7a8c'));
}

function ventPx(p: Px, wx: number, wy: number): void {
  // Решётка: рама, прутья, темнота под ними, ржавые пятна.
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const frame = x < 2 || y < 2 || x > 13 || y > 13;
      let c: RGBA;
      if (frame) c = x < 1 || y < 1 ? IRON[3] : x > 14 || y > 14 ? IRON[0] : IRON[2];
      else if ((x - 2) % 3 === 0) c = IRON[2];
      else if ((x - 2) % 3 === 1) c = IRON[1];
      else c = hx('#121318');
      if (!frame && hash(wx * 16 + x, wy * 16 + y, 171) < 0.05) c = hx('#7a4a2a');
      p.set(x, y, c);
    }
}

function platePx(p: Px, c: CellCtx, cracked: boolean): void {
  const same = (dx: number, dy: number) => {
    const mk = c.markAt(dx, dy);
    return mk === MK.plate || mk === MK.cracking;
  };
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      let col = LEVI[hash(c.wx * 16 + x, c.wy * 16 + y, 181) < 0.2 ? 2 : 1];
      if (vnoise(c.wx * 16 + x, c.wy * 16 + y, 4, 182) > 0.66) col = LEVI[2];
      p.set(x, y, col);
    }
  // Скос по краю плиты: свет сверху-слева.
  for (let i = 0; i < TS; i++) {
    if (!same(0, -1)) {
      p.set(i, 0, LEVI[3]);
      p.set(i, 1, LEVI[2]);
    }
    if (!same(-1, 0)) {
      p.set(0, i, LEVI[3]);
      p.set(1, i, mixc(LEVI[2], LEVI[3], 0.5));
    }
    if (!same(0, 1)) {
      p.set(i, 15, LEVI[0]);
      p.set(i, 14, mixc(LEVI[0], LEVI[1], 0.5));
    }
    if (!same(1, 0)) {
      p.set(15, i, LEVI[0]);
      p.set(14, i, mixc(LEVI[0], LEVI[1], 0.5));
    }
  }
  // Руна левитации — светящаяся вязь.
  const rx = ((c.wx % 2) + 2) % 2;
  const ry = ((c.wy % 3) + 3) % 3;
  if (rx === 0 && ry === 1) {
    for (let a = 0; a < 24; a++) {
      const t = (a / 24) * TAU;
      p.set(Math.round(8 + Math.cos(t) * 4), Math.round(8 + Math.sin(t) * 3), RUNE);
    }
    p.set(8, 8, RUNE);
    p.set(7, 8, mixc(RUNE, WHITE, 0.5));
  } else {
    p.set(4 + (c.wx & 7), 6 + (c.wy & 3), mixc(RUNE, LEVI[1], 0.5));
  }
  if (cracked) crackPx(p, c.wx, c.wy, 1);
}

/** Трещины (край, который вот-вот уйдёт в небо). */
function crackPx(p: Px, wx: number, wy: number, k: number): void {
  const seed = Math.floor(hash(wx, wy, 191) * 1000);
  let x = 2 + (seed % 12);
  let y = 1;
  for (let i = 0; i < 26 * k; i++) {
    p.set(x, y, hx('#26202a'));
    if (hash(seed, i, 1) < 0.3) p.set(x + 1, y, hx('#5a4a50'));
    x += hash(seed, i, 2) < 0.5 ? -1 : 1;
    y += hash(seed, i, 3) < 0.7 ? 1 : 0;
    x = Math.max(1, Math.min(14, x));
    if (y > 14) {
      y = 1 + Math.floor(hash(seed, i, 4) * 6);
      x = 2 + Math.floor(hash(seed, i, 5) * 12);
    }
  }
  // Пыль и красный отсвет — «сейчас уйдёт».
  for (let i = 0; i < 6; i++)
    p.set(
      1 + Math.floor(hash(seed, i, 6) * 14),
      1 + Math.floor(hash(seed, i, 7) * 14),
      hx('#e86a4a'),
    );
}

/** Нарисовать пол вида `mark` в клетку. */
function floorPx(p: Px, area: string, mark: number, c: CellCtx): void {
  const X0 = c.wx * TS;
  const Y0 = c.wy * TS;
  switch (mark) {
    case MK.grass:
      grassPx(p, X0, Y0);
      flowersPx(p, c.wx, c.wy);
      return;
    case MK.path:
      pathPx(p, X0, Y0);
      return;
    case MK.moss:
      mossPx(p, X0, Y0);
      return;
    case MK.bed:
      bedPx(p, X0, Y0, c.wx, c.wy);
      return;
    case MK.sand:
      sandPx(p, X0, Y0);
      return;
    case MK.dirt:
      dirtPx(p, X0, Y0);
      return;
    case MK.water:
      waterPx(p, X0, Y0);
      return;
    case MK.marble:
      marblePx(p, X0, Y0);
      return;
    case MK.mosaic:
      mosaicPx(p, X0, Y0);
      return;
    case MK.roots:
      rootsPx(p, X0, Y0, area === F11_CASTLE && c.markAt(0, 0) !== MK.roots ? 'marble' : 'earth');
      return;
    case MK.plank:
      plankPx(p, X0, Y0, c);
      return;
    case MK.stone:
      cobblePx(p, X0, Y0, c);
      return;
    case MK.arena:
      arenaPx(p, X0, Y0);
      return;
    case MK.vent:
      ventPx(p, c.wx, c.wy);
      return;
    case MK.plate:
      platePx(p, c, false);
      return;
    case MK.cracking:
      if (area === F11_AQUA) platePx(p, c, true);
      else {
        arenaPx(p, X0, Y0);
        crackPx(p, c.wx, c.wy, 1);
      }
      return;
    default:
      if (area === F11_AQUA) sandPx(p, X0, Y0);
      else if (area === F11_CASTLE) marblePx(p, X0, Y0);
      else grassPx(p, X0, Y0);
  }
}

/** Стыки пола: край над небом, тень стен, кайма грядок и воды. */
function floorEdges(p: Px, area: string, mark: number, c: CellCtx): void {
  const n = nearOf(c, 0, -1);
  const s = nearOf(c, 0, 1);
  const w = nearOf(c, -1, 0);
  const e = nearOf(c, 1, 0);
  const grassy = mark === MK.grass || mark === MK.moss || mark === MK.bed;
  // Над небом: освещённая кромка сверху и слева, тёмная — снизу и справа.
  if (mark !== MK.plank && mark !== MK.stone && mark !== MK.plate && mark !== MK.cracking) {
    for (let i = 0; i < TS; i++) {
      if (n === 'sky') {
        shadePx(p, i, 0, 0.35);
        if (grassy && hash(c.wx * 16 + i, c.wy, 201) < 0.3) p.set(i, 0, GRASS_HI);
      }
      if (w === 'sky') shadePx(p, 0, i, 0.28);
      if (e === 'sky') shadePx(p, 15, i, -0.3);
      if (s === 'sky') {
        shadePx(p, i, 15, -0.35);
        shadePx(p, i, 14, -0.12);
      }
    }
  }
  // Тень стены на полу: сверху — полоса, слева — кромка.
  if (n === 'wall') {
    for (let i = 0; i < TS; i++) {
      shadePx(p, i, 0, -0.42);
      shadePx(p, i, 1, -0.3);
      shadePx(p, i, 2, -0.14);
    }
  }
  if (w === 'wall') for (let i = 0; i < TS; i++) shadePx(p, 0, i, -0.28);
  // Кайма грядки: деревянный бортик по краю.
  if (mark === MK.bed) {
    const bed = (dx: number, dy: number) => {
      const mk = c.markAt(dx, dy);
      return (
        mk === MK.bed ||
        mk === MK.gardenerPost ||
        (mk === MK.under && underFloor(c, area) === MK.bed)
      );
    };
    for (let i = 0; i < TS; i++) {
      if (!bed(0, -1)) {
        p.set(i, 0, EDGING[3]);
        p.set(i, 1, EDGING[1]);
      }
      if (!bed(0, 1)) {
        p.set(i, 15, EDGING[0]);
        p.set(i, 14, EDGING[2]);
      }
      if (!bed(-1, 0)) {
        p.set(0, i, EDGING[3]);
        p.set(1, i, EDGING[1]);
      }
      if (!bed(1, 0)) {
        p.set(15, i, EDGING[0]);
        p.set(14, i, EDGING[2]);
      }
    }
  }
  // Кайма канала: каменный бортик.
  if (mark === MK.water) {
    const wet = (dx: number, dy: number) =>
      c.markAt(dx, dy) === MK.water || nearOf(c, dx, dy) === 'sky';
    for (let i = 0; i < TS; i++) {
      if (!wet(0, -1)) {
        p.set(i, 0, SAND[0]);
        p.set(i, 1, WATER[0]);
      }
      if (!wet(-1, 0)) {
        p.set(0, i, SAND[2]);
        p.set(1, i, WATER[0]);
      }
      if (!wet(1, 0)) {
        p.set(15, i, SAND[0]);
        p.set(14, i, mixc(WATER[0], WATER[1], 0.5));
      }
      if (!wet(0, 1)) p.set(i, 15, SAND[2]);
    }
  }
  // Трава заходит на дорожку клочками.
  if (mark === MK.path)
    for (const [dx, dy] of [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ]) {
      const mk = c.markAt(dx, dy);
      if (mk !== MK.grass && mk !== MK.moss) continue;
      for (let i = 0; i < TS; i++) {
        const d = Math.floor(vnoise(c.wx * 16 + i, c.wy * 16 + i, 3, 211) * 3);
        for (let k = 0; k < d; k++) {
          const [x, y] = dx < 0 ? [k, i] : dx > 0 ? [15 - k, i] : dy < 0 ? [i, k] : [i, 15 - k];
          p.set(x, y, k === d - 1 ? GRASS[2] : GRASS[1]);
        }
      }
    }
}

// --- Небо и обрывы ------------------------------------------------------------

/** Остров над клеткой в столбце `dx`: на скольких клетках вверх (1…4), 0 — нет. */
function islandAbove(c: CellCtx, dx: number): number {
  for (let k = 1; k <= 4; k++) {
    const mk = c.markAt(dx, -k);
    if (SKY_MARKS.has(mk)) continue;
    // Мосты и плиты — без обрыва: под ними своё.
    if (mk === MK.plank || mk === MK.stone || mk === MK.plate || mk === MK.cracking) return -k;
    return k;
  }
  return 0;
}

/** Есть ли остров (не небо) в клетке (dx, dy) — для тени на облаках. */
function solidAt(c: CellCtx, dx: number, dy: number): number {
  const mk = c.markAt(dx, dy);
  if (SKY_MARKS.has(mk)) return 0;
  if (mk === MK.plank) return 0.35;
  return 1;
}

function skyCellPx(area: string, c: CellCtx): Px {
  const pal = skyOf(area);
  const p = new Px(TS, TS);
  const X0 = c.wx * TS;
  const Y0 = c.wy * TS;
  // Тень островов на облаках: остров смещён вниз-вправо на 1,5×2,5 клетки.
  const sh: number[] = [];
  for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) sh.push(solidAt(c, i - 3, j - 4));
  const shadowAt = (x: number, y: number) => {
    // Точка тени в долях клеток относительно клетки (−3, −4).
    const fx = (x - 24 + 0.5) / TS + 3 - 0.5;
    const fy = (y - 40 + 0.5) / TS + 4 - 0.5;
    const ix = Math.max(0, Math.min(3, Math.floor(fx)));
    const iy = Math.max(0, Math.min(3, Math.floor(fy)));
    const u = smooth(Math.max(0, Math.min(1, fx - ix)));
    const v = smooth(Math.max(0, Math.min(1, fy - iy)));
    const a = sh[iy * 5 + ix] * (1 - u) + sh[iy * 5 + ix + 1] * u;
    const b = sh[(iy + 1) * 5 + ix] * (1 - u) + sh[(iy + 1) * 5 + ix + 1] * u;
    return a * (1 - v) + b * v;
  };
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      let col = skyAt(area, X0 + x, Y0 + y);
      const s = shadowAt(x, y);
      if (s > 0.05) col = mixc(col, pal.shadow, Math.min(0.62, s * 0.62));
      p.set(x, y, col);
    }
  // Обрывы островов: земля, корни, порода, тёмный низ.
  const up = [
    islandAbove(c, -2),
    islandAbove(c, -1),
    islandAbove(c, 0),
    islandAbove(c, 1),
    islandAbove(c, 2),
  ];
  const has = (k: number) => (k > 0 ? 1 : 0);
  const grassTop = (() => {
    const k = up[2];
    if (k <= 0) return false;
    const mk = c.markAt(0, -k);
    return (
      mk === MK.grass ||
      mk === MK.moss ||
      mk === MK.bed ||
      mk === MK.under ||
      mk === MK.hedge ||
      mk === 0
    );
  })();
  for (let x = 0; x < TS; x++) {
    const k = up[2];
    if (k <= 0) continue;
    const X = X0 + x;
    // Толщина острова: сколько земли вокруг сверху — сужается к краям.
    const fl = (x + 0.5) / TS;
    const frac =
      ((has(up[1]) * (1 - fl) + has(up[2]) + has(up[3]) * fl) / 2) * 0.7 +
      ((has(up[0]) + has(up[4])) / 2) * 0.3;
    const Hc = (7 + 38 * Math.pow(frac, 1.4)) * (0.82 + 0.36 * vnoise(X, 0, 6, 221));
    for (let y = 0; y < TS; y++) {
      const D = (k - 1) * TS + y + 1;
      if (D > Hc + 4) break;
      if (D > Hc) {
        // Под кончиком — тень на облаках.
        shadePx(p, x, y, -0.12);
        continue;
      }
      const r = D / Hc;
      let col: RGBA;
      if (r < 0.1 && grassTop) col = hash(X, D, 222) < 0.5 ? GRASS[0] : GRASS[1];
      else if (r < 0.52) {
        const strata = vnoise(X * 0.4, D, 3, 223);
        col = pal.earth[strata > 0.62 ? 3 : strata > 0.4 ? 2 : 1];
        if (r > 0.42) col = mixc(col, pal.earth[0], 0.5);
      } else if (r < 0.86) {
        const n = vnoise(X, D * 0.6, 4, 224);
        col = pal.rock[n > 0.6 ? 2 : n > 0.35 ? 1 : 0];
      } else col = mixc(pal.rock[0], pal.under, (r - 0.86) / 0.14);
      // Свет слева, тень справа — по наклону нижнего края.
      const lfrac = (has(up[1]) - has(up[3])) * (fl - 0.5);
      if (lfrac < -0.25 && r > 0.1) col = mixc(col, pal.under, 0.3);
      if (x === 0 && !has(up[1])) col = mixc(col, WHITE, 0.15);
      p.set(x, y, col);
    }
    // Свисающие корни — тонкие нити под землёй.
    if (hash(X, 0, 225) < 0.16) {
      const len = 3 + Math.floor(hash(X, 1, 226) * 8);
      const top = Math.floor(Hc * 0.35);
      for (let d = top; d < top + len; d++) {
        const y = d - (k - 1) * TS - 1;
        if (y >= 0 && y < TS) p.set(x, y, mixc(pal.earth[0], INK, 0.3));
      }
    }
  }
  // Под мостом — тень досок и провисшая верёвка; под плитой — ребро.
  if (up[2] === -1) {
    const mk = c.markAt(0, -1);
    const deck = mk === MK.plank ? PLANK : mk === MK.stone ? COBBLE : LEVI;
    for (let x = 0; x < TS; x++) {
      p.set(x, 0, deck[0]);
      if (mk !== MK.plank) p.set(x, 1, deck[mk === MK.stone ? 1 : 2]);
      shadePx(p, x, mk === MK.plank ? 1 : 2, -0.25);
      shadePx(p, x, mk === MK.plank ? 2 : 3, -0.12);
    }
    if (mk === MK.stone) {
      // Каменная арка моста — полукругом под настилом.
      for (let x = 0; x < TS; x++) {
        const d = Math.abs(x - 7.5) / 7.5;
        const h = Math.round(7 - 5 * Math.sqrt(Math.max(0, 1 - d * d)));
        for (let y = 2; y < h + 2; y++) p.set(x, y, y === h + 1 ? COBBLE[0] : COBBLE[1]);
      }
    }
    if (mk === MK.plank) {
      for (let x = 0; x < TS; x++) {
        const sag = Math.round(2 + Math.sin((x / 15) * PI) * 2);
        p.set(x, sag, ROPE[1]);
      }
    }
    if (mk === MK.plate)
      for (let x = 2; x < 14; x++) if (hash(X0 + x, 3, 227) < 0.4) p.set(x, 3, alpha(RUNE, 0.6));
  }
  // Плита внизу: встаёт (ближе и светлее) или ушла (далеко и тёмная).
  const self = c.mark;
  if (self === MK.rising || self === MK.fallen) {
    const near = self === MK.rising;
    const w = near ? 13 : 8;
    const h2 = near ? 9 : 5;
    const x0 = Math.round(8 - w / 2);
    const y0 = near ? 4 : 7;
    for (let y = 0; y < h2; y++)
      for (let x = 0; x < w; x++) {
        const col = y === 0 ? LEVI[near ? 3 : 1] : y === h2 - 1 ? LEVI[0] : LEVI[near ? 2 : 1];
        p.set(x0 + x, y0 + y, near ? col : mixc(col, pal.deep, 0.55));
      }
    if (near) p.set(8, y0 + 4, RUNE);
  }
  return p;
}

// --- Стены -------------------------------------------------------------------

function hedgePx(p: Px, c: CellCtx, face: boolean, area: string): void {
  const X0 = c.wx * TS;
  const Y0 = c.wy * TS;
  const same = (dx: number, dy: number) => c.markAt(dx, dy) === MK.hedge;
  // Под краем куста — пол соседа.
  floorPx(p, area, floorMarkAt(c, area, 0, 1), c);
  const top = face ? 5 : 0;
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const Y = Y0 + y;
      // Скруглить силуэт там, где изгороди дальше нет.
      const rn = !same(0, -1) ? 2.2 : -9;
      const rw = !same(-1, 0) ? 2 : -9;
      const re = !same(1, 0) ? 2 : -9;
      const wob = vnoise(X, Y, 3, 231) * 2;
      if (y < rn - wob || x < rw - wob || x > 15 - re + wob) continue;
      const v = voronoi(X, Y, 3.6, 232, 0.9);
      const l = -(v.ox * LX + v.oy * LY) / 2.6 + 0.3;
      let col = tone(HEDGE, l + (hash(v.id, 11) - 0.5) * 0.4);
      if (v.edge < 0.55) col = HEDGE[0];
      if (face && y > top) {
        // Передняя стенка: темнее книзу, у земли почти чёрная.
        const k = (y - top) / (TS - top);
        col = mixc(col, HEDGE[0], k * 0.7);
        if (y > 13) col = mixc(col, INK, 0.35);
      }
      if (face && y === top && hash(X, 1, 233) < 0.5) col = HEDGE[3];
      p.set(x, y, col);
    }
  // Ягоды и цветы в изгороди.
  if (hash(c.wx, c.wy, 234) < 0.35) {
    const x = 3 + Math.floor(hash(c.wx, c.wy, 235) * 10);
    const y = (face ? 6 : 3) + Math.floor(hash(c.wx, c.wy, 236) * 6);
    p.set(x, y, hx('#f4f0ea'));
    p.set(x + 1, y + 1, hx('#e86a7a'));
  }
}

function rockPx(p: Px, c: CellCtx, face: boolean, area: string, pal: Tones = ROCK): void {
  const X0 = c.wx * TS;
  const Y0 = c.wy * TS;
  const same = (dx: number, dy: number) => !c.open(dx, dy) && !SKY_MARKS.has(c.markAt(dx, dy));
  floorPx(p, area, floorMarkAt(c, area, 0, 1), c);
  const capH = face ? 5 : 16;
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const Y = Y0 + y;
      const wob = vnoise(X, Y, 3, 241) * 2.4;
      if (!same(0, -1) && y < 2.4 - wob) continue;
      if (!same(-1, 0) && x < 2 - wob) continue;
      if (!same(1, 0) && x > 13 + wob) continue;
      let col: RGBA;
      if (y < capH) {
        // Верх скалы: плиты камня, трава шапкой.
        const v = voronoi(X, Y, 6, 242);
        const l = -(v.ox * LX + v.oy * LY) / 4 + 0.45;
        col = v.edge < 0.9 ? pal[0] : tone(pal, l);
        if (area !== F11_CASTLE && vnoise(X, Y, 5, 243) > 0.62)
          col = GRASS[vnoise(X, Y, 2, 244) > 0.5 ? 2 : 1];
      } else {
        // Лицо: пласты и трещины, свет слева.
        const strata = vnoise(X * 0.35, Y, 3, 245);
        col = pal[strata > 0.6 ? 2 : strata > 0.38 ? 1 : 0];
        if (x < 2) col = pal[3];
        if (vnoise(X, Y * 0.3, 2, 246) > 0.8) col = pal[0];
        if (y > 13) col = mixc(col, INK, 0.3);
        if (y === capH) col = pal[3];
      }
      p.set(x, y, col);
    }
  if (face && area !== F11_CASTLE)
    for (let x = 0; x < TS; x++) if (hash(X0 + x, Y0, 247) < 0.25) p.set(x, capH - 1, GRASS[2]);
}

function masonryPx(
  p: Px,
  c: CellCtx,
  face: boolean,
  area: string,
  pal: Tones,
  trim: Tones | null,
): void {
  const X0 = c.wx * TS;
  const Y0 = c.wy * TS;
  const capH = face ? 4 : 16;
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const Y = Y0 + y;
      let col: RGBA;
      if (y < capH) {
        // Верх стены. У замка — парапет из светлого камня вдоль края и
        // сланцевая кровля внутри толщи; у руин — крупные блоки вразбежку.
        const edge =
          (!c.open(0, -1) ? 99 : y) > 3 &&
          (!c.open(-1, 0) ? 99 : x) > 3 &&
          (!c.open(1, 0) ? 99 : 15 - x) > 3 &&
          (!c.open(0, 1) ? 99 : 15 - y) > 3
            ? 0
            : 1;
        if (pal === CASTLE && !edge) {
          const row = Math.floor(Y / 4);
          const off = row % 2 ? 3 : 0;
          const u = (((X + off) % 6) + 6) % 6;
          const v = ((Y % 4) + 4) % 4;
          col = SLATE[hash(Math.floor((X + off) / 6), row, 254) < 0.4 ? 1 : 2];
          if (v === 3) col = SLATE[0];
          else if (v === 0) col = mixc(col, SLATE[3], 0.35);
          if (u === 0) col = mixc(col, SLATE[0], 0.6);
        } else {
          const row = Math.floor(Y / 8);
          const off = row % 2 ? 6 : 0;
          const u = (((X + off) % 12) + 12) % 12;
          const v = ((Y % 8) + 8) % 8;
          col = pal[hash(Math.floor((X + off) / 12), row, 255) < 0.4 ? 1 : 2];
          if (u === 0 || v === 0) col = mixc(pal[0], pal[1], 0.4);
          else if (v === 1) col = pal[3];
          // Зубцы парапета: через четыре точки — тёмная щель.
          if (pal === CASTLE && edge && (((X + Y) % 8) + 8) % 8 < 2 && (u === 3 || u === 9))
            col = pal[0];
        }
        if (area === F11_AQUA && vnoise(X, Y, 4, 251) > 0.66) col = MOSS[2];
      } else {
        // Лицо: кладка вперевязку.
        const row = Math.floor((y - capH) / 4);
        const off = row % 2 ? 4 : 0;
        const u = (((X + off) % 8) + 8) % 8;
        const v = (y - capH) % 4;
        col = pal[hash(Math.floor((X + off) / 8), row + c.wy * 4, 252) < 0.5 ? 1 : 2];
        if (v === 0) col = pal[3];
        if (v === 3 || u === 0) col = pal[0];
        if (trim && y >= capH && y < capH + 3)
          col = y === capH + 2 ? GOLD[2] : trim[y === capH ? 3 : 1];
        if (y > 13) col = mixc(col, INK, 0.25);
        if (area === F11_AQUA && y > 12 && hash(X, Y, 253) < 0.4) col = MOSS[1];
      }
      p.set(x, y, col);
    }
  if (face)
    for (let x = 0; x < TS; x++) {
      p.set(x, capH - 1, pal[3]);
      p.set(x, capH, pal[0]);
    }
}

function rootWallPx(p: Px, c: CellCtx, face: boolean): void {
  const X0 = c.wx * TS;
  const Y0 = c.wy * TS;
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const Y = Y0 + y;
      const a = face ? PI / 2 + (vnoise(X, Y, 14, 261) - 0.5) : vnoise(X, Y, 20, 262) * PI;
      const s = Math.sin((X * Math.cos(a) + Y * Math.sin(a)) * 0.55 + vnoise(X, Y, 7, 263) * 6);
      let col = s > 0.55 ? BARK[3] : s > 0.1 ? BARK[2] : s > -0.4 ? BARK[1] : BARK[0];
      if (face && y > 12) col = mixc(col, INK, 0.3);
      if (vnoise(X, Y, 4, 264) > 0.74) col = MOSS[2];
      p.set(x, y, col);
    }
}

function crystalWallPx(p: Px, c: CellCtx): void {
  const X0 = c.wx * TS;
  const Y0 = c.wy * TS;
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const v = voronoi(X0 + x, Y0 + y, 5, 271);
      const l = -(v.ox * LX + v.oy * LY) / 3 + 0.4;
      p.set(x, y, v.edge < 0.8 ? CRYSTAL[0] : tone(CRYSTAL, l));
    }
}

function wallPx(area: string, mark: number, c: CellCtx): Px {
  const p = new Px(TS, TS);
  const face = c.open(0, 1);
  switch (mark) {
    case MK.hedge:
      hedgePx(p, c, face, area);
      break;
    case MK.ruin:
    case MK.arch:
      masonryPx(p, c, face, area, RUIN, null);
      break;
    case MK.castle:
    case MK.banner:
    case MK.sconce:
    case MK.window:
      masonryPx(p, c, face, area, CASTLE, SLATE);
      break;
    case MK.rootwall:
      rootWallPx(p, c, face);
      break;
    case MK.crystal:
      crystalWallPx(p, c);
      break;
    case MK.rock:
    default:
      rockPx(p, c, face, area);
  }
  return p;
}

/** Клетка района целиком (paintAll): небо, стена или пол. */
function cellPainter(area: string) {
  return (c: CellCtx): Px | null => {
    const mk = c.mark;
    if (c.tile === T_DEEP || mk === MK.border) return skyCellPx(area, c);
    if (!c.open(0, 0)) return wallPx(area, mk || WALL_OF[area], c);
    const p = new Px(TS, TS);
    let fm = mk;
    if (mk === MK.under) fm = underFloor(c, area);
    else if (POST_FLOOR[mk]) fm = POST_FLOOR[mk];
    else if (!FLOOR_MARKS.has(mk)) fm = FLOOR_OF[area];
    // Пост мха — в мху; пост садовника — на грядке.
    floorPx(p, area, fm, c);
    floorEdges(p, area, fm, c);
    return p;
  };
}

registerCellPainter(F11_GARDEN, cellPainter(F11_GARDEN));
registerCellPainter(F11_AQUA, cellPainter(F11_AQUA));
registerCellPainter(F11_CASTLE, cellPainter(F11_CASTLE));

// ---------------------------------------------------------------------------
// Живые слои: небо с параллаксом, ленты ветра, воздух. Это зоны этажа —
// они идут за героем; рисовальщик получает камеру и рисует готовое.
// ---------------------------------------------------------------------------

/** Кадр: левый верх в мировых пикселях и размер в игровых пикселях. */
function view(g: CanvasRenderingContext2D, z: Zone | Strike, px: number, py: number) {
  const m = g.getTransform();
  const s = m.a || 1;
  const gw = g.canvas.width / s;
  const gh = g.canvas.height / s;
  return { left: z.x * TS - px, top: z.y * TS - py, gw, gh };
}

const areaAtY = (sim: Sim, y: number) =>
  sim.world.rowArea[Math.max(0, Math.min(sim.world.h - 1, Math.floor(y)))];

/** Чистое небо: клетка неба и три над ней — тоже небо (не под обрывом). */
function openSky(sim: Sim, x: number, y: number): boolean {
  const w = sim.world;
  if (x < 0 || x >= w.w || y < 0 || y >= w.h) return true;
  for (let k = 0; k <= 3; k++) {
    const yy = y - k;
    if (yy < 0) break;
    if (sim.tiles[yy * w.w + x] !== T_DEEP) return false;
  }
  return true;
}

registerZonePainter('f11_sky', (g, z, px, py, _s, time) => {
  const sim = paintSim();
  if (!sim) return true;
  const { left, top, gw, gh } = view(g, z, px, py);
  const area = areaAtY(sim, z.y);
  const tex = nearSky(area);
  const x0 = Math.floor(left / TS) - 1;
  const y0 = Math.floor(top / TS) - 1;
  const x1 = Math.ceil((left + gw) / TS) + 1;
  const y1 = Math.ceil((top + gh) / TS) + 1;
  g.save();
  g.beginPath();
  let any = false;
  for (let y = y0; y <= y1; y++) {
    let run = -1;
    for (let x = x0; x <= x1 + 1; x++) {
      const ok = x <= x1 && openSky(sim, x, y);
      if (ok && run < 0) run = x;
      if (!ok && run >= 0) {
        g.rect(run * TS - left, y * TS - top, (x - run) * TS, TS);
        run = -1;
        any = true;
      }
    }
  }
  if (any) {
    g.clip();
    // Ближние облака плывут медленнее острова: глубина.
    const drift = time * (area === F11_CASTLE ? 9 : 4);
    const ox = -((((left * 0.55 + drift) % 256) + 256) % 256);
    const oy = -((((top * 0.55) % 256) + 256) % 256);
    g.globalAlpha = area === F11_CASTLE ? 0.8 : 0.7;
    for (let yy = oy; yy < gh; yy += 256)
      for (let xx = ox; xx < gw; xx += 256) g.drawImage(tex, Math.round(xx), Math.round(yy));
    g.globalAlpha = 1;
  }
  g.restore();
  return true;
});

/** Ветер, прижатие к краю — под героем. */
registerZonePainter('f11_wind', (g, z, px, py, _s, time) => {
  const sim = paintSim();
  const st = f11State(sim);
  if (!sim || !st) return true;
  const { left, top, gw, gh } = view(g, z, px, py);
  const x0 = Math.max(0, Math.floor(left / TS));
  const y0 = Math.max(0, Math.floor(top / TS));
  const x1 = Math.min(st.w - 1, Math.ceil((left + gw) / TS));
  const y1 = Math.min(st.h - 1, Math.ceil((top + gh) / TS));
  const blow = gustBlow(st);
  const w2: [number, number] = [0, 0];
  const head = new Path2D();
  const tail = new Path2D();
  const strong = new Path2D();
  const shade = new Path2D();
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const i = y * st.w + x;
      const t = sim.tiles[i];
      if (t === T_DEEP) continue;
      const [wx, wy] = windAt(st, x + 0.5, y + 0.5, w2);
      const w = Math.hypot(wx, wy);
      if (w < 0.9) continue;
      const ux = wx / w;
      const uy = wy / w;
      // Реже и длиннее: две ленты на клетку в сильном потоке, одна — в
      // обычном. Густые короткие штрихи читались дождём и царапинами.
      const n = w > 4.5 ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const h1 = hash(x, y, 300 + k);
        // Лента бежит по ветру со скоростью ветра, петля — 28 пикселей.
        const L = 28;
        const ph = ((((time * w * 7 + h1 * L) % L) + L) % L) - L / 2;
        const off = (hash(x, y, 310 + k) - 0.5) * 13;
        const cx = x * TS + 8 + ux * ph - uy * off - left;
        const cy = y * TS + 8 + uy * ph + ux * off - top;
        const len = Math.min(14, 6 + w * 1.3);
        const fade = 1 - Math.abs(ph) / (L / 2);
        if (fade < 0.18) continue;
        const target = w > 4.5 || blow > 0.3 ? strong : fade > 0.5 ? head : tail;
        // Лёгкая волна: лента чуть изгибается поперёк хода.
        const wave = Math.sin(time * 5 + h1 * 9) * 0.8;
        for (let s = 0; s < len; s++) {
          const bend = Math.sin((s / len) * PI) * wave;
          const qx = Math.round(cx - ux * s - uy * bend);
          const qy = Math.round(cy - uy * s + ux * bend);
          (s < len * 0.55 ? target : tail).rect(qx, qy, 1, 1);
          if (s > 0 && s < len - 1) shade.rect(qx, qy + 1, 1, 1);
        }
      }
    }
  // Тень под лентой: ветер читается и на светлом камне, и на траве.
  g.fillStyle = 'rgba(20,40,70,0.16)';
  g.fill(shade);
  g.fillStyle = 'rgba(255,255,255,0.32)';
  g.fill(tail);
  g.fillStyle = 'rgba(255,255,255,0.72)';
  g.fill(head);
  g.fillStyle = 'rgba(255,255,255,0.95)';
  g.fill(strong);
  // Прижало к краю: круг под ногами наливается.
  if (st.slip > 0.02) {
    const hx0 = sim.hero.x * TS - left;
    const hy0 = sim.hero.y * TS - top + 2;
    g.lineWidth = 1.5;
    g.strokeStyle = 'rgba(40,20,20,0.35)';
    g.beginPath();
    g.ellipse(hx0, hy0, 7, 3.5, 0, 0, TAU);
    g.stroke();
    g.strokeStyle = st.slip > 0.66 ? 'rgba(255,70,50,0.95)' : 'rgba(255,190,60,0.9)';
    g.beginPath();
    g.ellipse(hx0, hy0, 7, 3.5, 0, -PI / 2, -PI / 2 + TAU * Math.min(1, st.slip));
    g.stroke();
  }
  return true;
});

/** Воздух поверх всего: лепестки и песок по ветру, дождь в бурю, фронт порыва. */
registerZonePainter('f11_air', (g, z, px, py, _s, time) => {
  const sim = paintSim();
  const st = f11State(sim);
  if (!sim || !st) return true;
  const { left, top, gw, gh } = view(g, z, px, py);
  const area = areaAtY(sim, z.y);
  const h = sim.hero;
  const [wx0, wy0] = windAt(st, h.x, h.y, [0, 0]);
  // Общий ветер кадра: поток у героя, а если тихо — лёгкий бриз района.
  let wx = wx0;
  let wy = wy0;
  if (Math.hypot(wx, wy) < 0.6) {
    wx = area === F11_CASTLE ? 1.4 : 0.8;
    wy = 0.2;
  }
  const storm = stormOn(st);
  const N = storm ? 60 : area === F11_CASTLE ? 26 : 22;
  const cols =
    area === F11_GARDEN
      ? ['#fbe4ee', '#f4b8cc', '#fffaf0', '#a8d870']
      : area === F11_AQUA
        ? ['#fff0d0', '#f6d6a0', '#ffffff', '#e8b880']
        : ['#dfe8ff', '#b8c8e8', '#ffffff', '#8cf0e4'];
  const W = gw + 40;
  const H = gh + 40;
  for (let i = 0; i < N; i++) {
    const s1 = hash(i, 1, 401);
    const s2 = hash(i, 2, 402);
    const sp = 0.6 + hash(i, 3, 403) * 0.8;
    // Позиция: зерно + ветер·время, свёрнутая в окно кадра с запасом.
    let x = s1 * W + wx * time * 16 * sp - left * 0.2;
    let y = s2 * H + wy * time * 16 * sp - top * 0.2 + (storm ? time * 140 * sp : 0);
    x = (((x % W) + W) % W) - 20;
    y = (((y % H) + H) % H) - 20;
    const flutter = Math.sin(time * 6 * sp + i) * 1.5;
    g.fillStyle = cols[i % cols.length];
    if (storm && i % 2 === 0) {
      // Дождь — косые штрихи по ветру.
      g.globalAlpha = 0.35;
      const lx = wx * 0.9;
      for (let k = 0; k < 5; k++)
        g.fillRect(Math.round(x - lx * k * 0.3), Math.round(y - k * 1.6), 1, 1);
      g.globalAlpha = 1;
      continue;
    }
    g.globalAlpha = 0.85;
    g.fillRect(Math.round(x), Math.round(y + flutter), i % 3 === 0 ? 2 : 1, 1);
    if (i % 4 === 0) g.fillRect(Math.round(x + 1), Math.round(y + flutter + 1), 1, 1);
    g.globalAlpha = 1;
  }
  // Порыв: фронт идёт с наветренной стороны и приходит к герою в миг удара.
  const warn = gustWarn(st);
  const blow = gustBlow(st);
  const arenaGust = st.arena.mode === 4 && (st.arena.gust === 1 || st.arena.gust === 2);
  if (warn > 0 || blow > 0.05 || arenaGust) {
    const dir = arenaGust ? Math.atan2(h.y - st.arena.cy, h.x - st.arena.cx) : st.gust.dir;
    const ux = Math.cos(dir);
    const uy = Math.sin(dir);
    const hx0 = h.x * TS - left;
    const hy0 = h.y * TS - top - 6;
    const k = arenaGust
      ? st.arena.gust === 1
        ? Math.min(1, 1 - st.arena.gustT)
        : 1
      : warn > 0
        ? warn
        : 1;
    if (warn > 0 || (arenaGust && st.arena.gust === 1)) {
      // Стена штрихов, идущая поперёк ветра.
      const dist = (1 - k) * 110;
      const fx = hx0 - ux * dist;
      const fy = hy0 - uy * dist;
      g.fillStyle = 'rgba(255,255,255,0.55)';
      for (let j = -24; j <= 24; j++) {
        const jit = hash(j, Math.floor(time * 20), 411) * 8;
        const bx = fx - uy * j * 5 - ux * jit;
        const by = fy + ux * j * 5 - uy * jit;
        for (let s = 0; s < 7; s++)
          g.fillRect(Math.round(bx - ux * s * 1.5), Math.round(by - uy * s * 1.5), 1, 1);
      }
    }
    // Стрелки вокруг героя — куда дунет.
    const hot = blow > 0.05 || (arenaGust && st.arena.gust === 2);
    g.fillStyle = hot ? 'rgba(255,255,255,0.9)' : `rgba(255,236,160,${0.35 + 0.6 * k})`;
    for (let a = 0; a < 3; a++) {
      const r = 13 + a * 5 + ((time * 30) % 5);
      const cx = hx0 + ux * r;
      const cy = hy0 + uy * r;
      for (let s = -3; s <= 3; s++) {
        const bx = cx - ux * Math.abs(s) * 1.2 - uy * s;
        const by = cy - uy * Math.abs(s) * 1.2 + ux * s;
        g.fillRect(Math.round(bx), Math.round(by), 1, 1);
      }
    }
  }
  return true;
});

// --- Разовые вспышки ветра и ударов --------------------------------------------

/** Кольцо-вихрь: сдуло (откуда) и поставило на землю (куда). */
function swirl(
  g: CanvasRenderingContext2D,
  px: number,
  py: number,
  k: number,
  r: number,
  col: string,
): void {
  g.strokeStyle = col;
  g.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    const a0 = k * 7 + (i * TAU) / 3;
    g.beginPath();
    g.ellipse(px, py - 4, r * (0.4 + 0.6 * k), r * 0.45 * (0.4 + 0.6 * k), 0, a0, a0 + 1.6);
    g.stroke();
  }
}

registerZonePainter('f11_whisk', (g, z, px, py) => {
  const k = Math.min(1, z.t / (z as Zone).life);
  g.globalAlpha = 1 - k;
  swirl(g, px, py - k * 18, k, 16, 'rgba(255,255,255,0.9)');
  g.globalAlpha = 1;
  return true;
});

registerZonePainter('f11_landing', (g, z, px, py) => {
  const k = Math.min(1, z.t / (z as Zone).life);
  g.globalAlpha = 1 - k;
  swirl(g, px, py, 1 - k, 14, 'rgba(210,240,255,0.95)');
  g.globalAlpha = 1;
  return true;
});

/** Форсунка сада: метка — брызги по кругу; потом столб (`f11_spray`). */
registerZonePainter('f11_geyser', (g, z, px, py, _s, time) => {
  const st = z as Strike;
  const k = Math.min(1, st.t / st.warn);
  const R = st.r * TS;
  g.strokeStyle = `rgba(120,200,255,${0.45 + 0.45 * k})`;
  g.lineWidth = 1;
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.stroke();
  g.fillStyle = `rgba(140,210,255,${0.12 + 0.25 * k})`;
  g.beginPath();
  g.arc(px, py, R * k, 0, TAU);
  g.fill();
  g.fillStyle = 'rgba(230,248,255,0.9)';
  for (let i = 0; i < 6; i++) {
    const a = time * 5 + i;
    const r = R * (0.3 + 0.5 * ((i * 0.37 + time) % 1));
    g.fillRect(Math.round(px + Math.cos(a) * r), Math.round(py + Math.sin(a) * r * 0.6), 1, 1);
  }
  return true;
});

registerZonePainter('f11_spray', (g, z, px, py) => {
  const k = Math.min(1, z.t / (z as Zone).life);
  g.globalAlpha = 1 - k;
  const H = 30 * (1 - (1 - k) * (1 - k));
  g.fillStyle = 'rgba(200,236,255,0.8)';
  g.fillRect(Math.round(px - 3), Math.round(py - H), 6, Math.round(H));
  g.fillStyle = 'rgba(255,255,255,0.95)';
  g.fillRect(Math.round(px - 1), Math.round(py - H), 2, Math.round(H));
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU;
    const r = 4 + k * 16;
    g.fillRect(
      Math.round(px + Math.cos(a) * r),
      Math.round(py - H * 0.3 + Math.sin(a) * r * 0.5),
      1,
      1,
    );
  }
  g.globalAlpha = 1;
  return true;
});

/** Лента-луч: вода, лазер, взгляд стража (`ang` — в зоне). */
export function beamFx(
  g: CanvasRenderingContext2D,
  z: Zone,
  px: number,
  py: number,
  w: number,
  core: string,
  glow: string,
): void {
  const k = Math.min(1, z.t / z.life);
  const ang = (z as Zone & { ang?: number }).ang ?? 0;
  const L = z.r * TS;
  g.save();
  g.translate(px, py - 8);
  g.rotate(ang);
  g.globalAlpha = 1 - k * k;
  g.fillStyle = glow;
  g.fillRect(0, -w, L, w * 2);
  g.fillStyle = core;
  g.fillRect(0, -Math.max(1, w * 0.4), L, Math.max(2, w * 0.8));
  g.restore();
  g.globalAlpha = 1;
}

registerZonePainter('f11_jetfx', (g, z, px, py) => {
  beamFx(g, z as Zone, px, py, 4, 'rgba(240,252,255,0.95)', 'rgba(110,190,255,0.55)');
  return true;
});
registerZonePainter('f11_laserfx', (g, z, px, py) => {
  beamFx(g, z as Zone, px, py, 3, 'rgba(255,250,240,1)', 'rgba(255,60,40,0.7)');
  return true;
});

/** Взмах гарпии: дуги ветра расходятся конусом. */
registerZonePainter('f11_flapfx', (g, z, px, py) => {
  const zz = z as Zone & { ang?: number };
  const k = Math.min(1, z.t / zz.life);
  const ang = zz.ang ?? 0;
  g.strokeStyle = `rgba(255,255,255,${0.85 * (1 - k)})`;
  g.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    const r = (z.r * TS * (k + i * 0.18)) % (z.r * TS);
    g.beginPath();
    g.arc(px, py - 6, Math.max(2, r), ang - 0.5, ang + 0.5);
    g.stroke();
  }
  return true;
});

/** Облачко лопнувшей медузы. */
registerZonePainter('f11_puff', (g, z, px, py, _s, time) => {
  const k = Math.min(1, z.t / (z as Zone).life);
  g.globalAlpha = 0.55 * (1 - k);
  g.fillStyle = '#e8f4ff';
  for (let i = 0; i < 7; i++) {
    const a = i * 0.9 + time * 0.6;
    const r = z.r * TS * 0.55;
    g.beginPath();
    g.arc(px + Math.cos(a) * r * 0.6, py - 4 + Math.sin(a) * r * 0.35, r * 0.55, 0, TAU);
    g.fill();
  }
  g.globalAlpha = 1;
  return true;
});

registerZonePainter('f11_mossland', (g, z, px, py) => {
  const k = Math.min(1, z.t / (z as Zone).life);
  g.strokeStyle = `rgba(200,240,120,${0.9 * (1 - k)})`;
  g.lineWidth = 1;
  g.beginPath();
  g.ellipse(px, py, z.r * TS * (0.4 + 0.8 * k), z.r * TS * 0.5 * (0.4 + 0.8 * k), 0, 0, TAU);
  g.stroke();
  return true;
});

/** Смерч духа: закрученные витки, мусор по спирали. */
registerZonePainter('f11_tornado', (g, _z, px, py, _s, time) => {
  const H = 26;
  for (let i = 0; i < 9; i++) {
    const t = i / 8;
    const r = 3 + t * 8;
    const a = time * 9 + i * 0.7;
    g.strokeStyle = `rgba(230,245,255,${0.35 + 0.35 * (1 - t)})`;
    g.lineWidth = 1;
    g.beginPath();
    g.ellipse(px, py - t * H, r, r * 0.35, 0, a, a + 3.6);
    g.stroke();
  }
  g.fillStyle = 'rgba(140,110,80,0.9)';
  for (let i = 0; i < 5; i++) {
    const a = time * 7 + i * 1.3;
    const t = (time * 0.6 + i * 0.21) % 1;
    g.fillRect(Math.round(px + Math.cos(a) * (3 + t * 7)), Math.round(py - t * H), 1, 1);
  }
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.beginPath();
  g.ellipse(px, py + 1, 8, 3, 0, 0, TAU);
  g.fill();
  return true;
});

/** Крюк абордажника: цепь от хозяина, крюк на конце. */
registerZonePainter('f11_hook', (g, z, px, py) => {
  const zz = z as Zone & { mx?: number; my?: number };
  if (zz.mx === undefined || zz.my === undefined) return true;
  const sx = px + (zz.mx - z.x) * TS;
  const sy = py + (zz.my - z.y) * TS;
  const n = Math.ceil(Math.hypot(px - sx, py - sy) / 2);
  g.fillStyle = '#9aa0a8';
  for (let i = 0; i <= n; i++) {
    const t = i / (n || 1);
    g.fillRect(Math.round(sx + (px - sx) * t), Math.round(sy - 6 + (py - sy) * t), 1, 1);
  }
  g.fillStyle = '#d8dce4';
  g.fillRect(Math.round(px - 2), Math.round(py - 8), 4, 1);
  g.fillRect(Math.round(px - 2), Math.round(py - 9), 1, 2);
  g.fillRect(Math.round(px + 1), Math.round(py - 9), 1, 2);
  g.fillStyle = '#26282e';
  g.fillRect(Math.round(px - 1), Math.round(py - 7), 2, 2);
  return true;
});

/** Молния бури: метка с искрами, к удару — ствол молнии сверху. */
registerZonePainter('f11_bolt', (g, z, px, py, _s, time) => {
  const st = z as Strike;
  const k = Math.min(1, st.t / st.warn);
  const R = st.r * TS;
  g.strokeStyle = `rgba(190,215,255,${0.45 + 0.5 * k})`;
  g.lineWidth = 1;
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.stroke();
  g.fillStyle = `rgba(160,190,255,${0.1 + 0.3 * k})`;
  g.beginPath();
  g.arc(px, py, R * k, 0, TAU);
  g.fill();
  g.fillStyle = 'rgba(240,248,255,0.95)';
  for (let i = 0; i < 4 + k * 6; i++) {
    const a = hash(i, Math.floor(time * 24), 431) * TAU;
    const r = R * hash(i, Math.floor(time * 24), 432);
    g.fillRect(Math.round(px + Math.cos(a) * r), Math.round(py + Math.sin(a) * r * 0.6), 1, 1);
  }
  if (k > 0.85) {
    g.strokeStyle = `rgba(245,250,255,${(k - 0.85) / 0.15})`;
    g.lineWidth = 1;
    g.beginPath();
    let x = px + (hash(Math.floor(time * 30), 1, 433) - 0.5) * 20;
    let y = py - 90;
    g.moveTo(x, y);
    while (y < py) {
      y += 6;
      x += (hash(Math.floor(y), Math.floor(time * 30), 434) - 0.5) * 8;
      x += (px - x) * 0.2;
      g.lineTo(Math.round(x), Math.round(y));
    }
    g.stroke();
  }
  return true;
});

/** Кольцо пыли (удар кулаком, топот, приземление). */
registerZonePainter('f11_dust', (g, z, px, py) => {
  const k = Math.min(1, z.t / (z as Zone).life);
  g.strokeStyle = `rgba(230,220,200,${0.9 * (1 - k)})`;
  g.lineWidth = 2;
  g.beginPath();
  g.ellipse(px, py, z.r * TS * (0.5 + 0.7 * k), z.r * TS * 0.5 * (0.5 + 0.7 * k), 0, 0, TAU);
  g.stroke();
  return true;
});

// ---------------------------------------------------------------------------
// Вещи этажа. Ветер читается и по ним: трава клонится, вертушки крутятся,
// флаги рвутся по ветру, перед порывом всё это ложится сильнее.
// ---------------------------------------------------------------------------

/** Ветер у вещи (−1…1 по x — крен) и сила; перед порывом — сильнее. */
function windHere(o: WorldObj): { lean: number; k: number; dir: number } {
  const sim = paintSim();
  const st = f11State(sim);
  if (!st) return { lean: 0.25, k: 0.8, dir: 0 };
  const [wx, wy] = windAt(st, o.x + 0.5, o.y + 0.5, [0, 0]);
  let x = wx;
  let y = wy;
  // Фронт порыва: вещи на открытом месте ложатся заранее.
  const warn = gustWarn(st);
  const e = expoAt(st, o.x + 0.5, o.y + 0.5);
  if (warn > 0 && e > 0.15) {
    x += Math.cos(st.gust.dir) * st.gust.k * warn * e;
    y += Math.sin(st.gust.dir) * st.gust.k * warn * e;
  }
  // В безветрии — лёгкий бриз.
  if (Math.hypot(x, y) < 0.5) x = 0.6;
  const k = Math.hypot(x, y);
  return { lean: Math.max(-1, Math.min(1, x / 5)), k, dir: Math.atan2(y, x) };
}

/** Тень предмета на полу: мягкий эллипс. */
function dropShadow(p: Px, cx: number, by: number, rx: number, ry = 2): void {
  const l = pendingShadow.get(p) ?? [];
  l.push([cx, by, rx, ry]);
  pendingShadow.set(p, l);
}

// --- Деревья ---------------------------------------------------------------

function canopy(
  p: Px,
  cx: number,
  cy: number,
  r: number,
  t: Tones,
  seed: number,
  blossom?: RGBA,
): void {
  // Шапка из пяти-шести пухлых комков со светом сверху-слева.
  const lobes: [number, number, number][] = [
    [0, 0, r],
    [-r * 0.62, r * 0.18, r * 0.7],
    [r * 0.62, r * 0.2, r * 0.68],
    [-r * 0.3, -r * 0.45, r * 0.62],
    [r * 0.34, -r * 0.4, r * 0.6],
    [0, r * 0.42, r * 0.66],
  ];
  for (const [dx, dy, rr] of lobes) shadeEll(p, cx + dx, cy + dy, rr, rr * 0.92, t);
  // Листва: пятнышки света и тени.
  for (let i = 0; i < r * 6; i++) {
    const a = hash(i, seed, 501) * TAU;
    const d = Math.sqrt(hash(i, seed, 502)) * r * 1.2;
    const x = Math.round(cx + Math.cos(a) * d);
    const y = Math.round(cy + Math.sin(a) * d * 0.85);
    if (!p.solid(x, y)) continue;
    const up = y < cy - r * 0.2 && x < cx + r * 0.3;
    p.set(x, y, up ? t[3] : t[0]);
    if (blossom && hash(i, seed, 503) < 0.4) p.set(x, y, up ? mixc(blossom, WHITE, 0.4) : blossom);
  }
}

function treePx(
  kind: 'tree' | 'sakura' | 'cypress',
  sway: number,
): { p: Px; ax: number; ay: number } {
  const W = kind === 'cypress' ? 16 : 30;
  const H = kind === 'cypress' ? 38 : 36;
  const p = new Px(W, H);
  const cx = W / 2;
  dropShadow(p, cx + 2, H - 2, kind === 'cypress' ? 6 : 11, 3);
  if (kind === 'cypress') {
    limb(p, cx, H - 2, cx, H - 8, 1.6, 1.4, BARK);
    const t = tn('#1c4028', '#2a5a34', '#3c7a42', '#5a9a52');
    for (let y = 0; y < 30; y++) {
      const k = y / 30;
      const rr = Math.sin(Math.min(1, k * 1.25) * PI * 0.5) * 6 * (1 - Math.max(0, k - 0.8) * 2);
      const xo = Math.round(sway * k * k * 2);
      for (let x = -Math.ceil(rr); x <= Math.ceil(rr); x++) {
        if (Math.abs(x) > rr) continue;
        const l = (-x / (rr || 1)) * 0.5 + (1 - k) * 0.2 + (hash(x, y, 511) - 0.5) * 0.4;
        p.set(cx + x + xo, H - 36 + y, tone(t, l + 0.2));
      }
    }
    return { p: ink(p), ax: W / 2, ay: H };
  }
  // Ствол с корнями.
  limb(p, cx, H - 3, cx - 0.5, H - 14, 2.4, 1.8, BARK);
  limb(p, cx, H - 3, cx - 3.5, H - 1.5, 1.2, 0.6, BARK);
  limb(p, cx, H - 3, cx + 3.5, H - 1.5, 1.2, 0.6, BARK);
  limb(p, cx - 0.5, H - 12, cx - 5, H - 17, 1, 0.7, BARK);
  const leaves = kind === 'sakura' ? tn('#b0567a', '#e088a8', '#f4b4c8', '#fde2ea') : GRASS;
  canopy(
    p,
    cx + sway,
    H - 22,
    9.5,
    leaves,
    kind === 'sakura' ? 7 : 3,
    kind === 'sakura' ? undefined : hx('#b4dc78'),
  );
  if (kind === 'sakura')
    for (let i = 0; i < 5; i++)
      p.set(
        4 + Math.floor(hash(i, 9, 521) * 22),
        H - 3 + Math.floor(hash(i, 8, 522) * 2),
        hx('#f4b4c8'),
      );
  return { p: ink(p), ax: W / 2, ay: H };
}

function treePainter(kind: 'tree' | 'sakura') {
  return (o: WorldObj, time: number): Sprite => {
    const wv = windHere(o);
    const kind2 = kind === 'sakura' && o.area === F11_AQUA ? 'cypress' : kind;
    const sway = Math.round(wv.lean * 1.5 + Math.sin(time * 1.6 + o.x) * (0.4 + wv.k * 0.12));
    const s = Math.max(-2, Math.min(2, sway));
    return sprite(`tree|${kind2}|${s}`, () => treePx(kind2, s));
  };
}
registerPropPainter('f11_tree', treePainter('tree'));
registerPropPainter('f11_sakura', treePainter('sakura'));

// --- Высокая трава: клонится по ветру ------------------------------------------

function grassTuftPx(bend: number, sway: number, area: string): { p: Px; ax: number; ay: number } {
  const p = new Px(16, 16);
  const t = area === F11_AQUA ? tn('#7a6a34', '#a89048', '#c8b060', '#e4d088') : GRASS;
  const blades = [
    [3, 9, 0.2],
    [5, 13, 0.5],
    [7, 11, 0.8],
    [9, 14, 0.35],
    [11, 10, 0.65],
    [13, 8, 0.1],
  ];
  for (const [bx, len, ph] of blades) {
    const lean = bend * 0.9 + Math.sin(sway * 1.57 + ph * 6) * 0.25;
    let x = bx;
    for (let i = 0; i < len; i++) {
      const k = i / len;
      x = bx + lean * k * k * 5;
      const y = 15 - i;
      const col = k > 0.75 ? t[3] : k > 0.4 ? t[2] : k > 0.15 ? t[1] : t[0];
      p.set(Math.round(x), y, col);
      if (i < len * 0.4) p.set(Math.round(x) + 1, y, t[0]);
    }
    // Колосок на верхушке.
    if (ph > 0.4) {
      p.set(Math.round(x), 15 - len, hx('#f0e6b0'));
      p.set(Math.round(x + lean * 0.5), 14 - len, hx('#fff6d0'));
    }
  }
  return { p, ax: 8, ay: 16 };
}

registerPropPainter('f11_grass', (o, time) => {
  const wv = windHere(o);
  const bend = Math.max(-3, Math.min(3, Math.round(wv.lean * 3)));
  const f = Math.floor(time * (2 + wv.k * 0.8) + o.x * 0.7) % 4;
  return sprite(`grass|${bend}|${f}|${o.area}`, () => grassTuftPx(bend / 3, f, o.area));
});

// --- Вертушка: крутится со скоростью ветра ---------------------------------------

const PINCOL: RGBA[][] = [
  [hx('#e8504a'), hx('#f6d24a'), hx('#4a8ae8'), hx('#f4f0e8')],
  [hx('#f4f0e8'), hx('#6ac0e0'), hx('#f4f0e8'), hx('#e888a8')],
];

function pinwheelPx(f: number, set: number): { p: Px; ax: number; ay: number } {
  const p = new Px(14, 22);
  dropShadow(p, 7, 20, 3, 1);
  // Палочка.
  for (let y = 9; y < 21; y++) {
    p.set(7, y, PLANK[2]);
    p.set(8, y, PLANK[0]);
  }
  const cx = 7.5;
  const cy = 7;
  const cols = PINCOL[set];
  for (let k = 0; k < 4; k++) {
    const a = (k * PI) / 2 + (f * PI) / 8;
    // Лопасть — треугольник-парус.
    const ax = cx + Math.cos(a) * 6;
    const ay = cy + Math.sin(a) * 6;
    const bx = cx + Math.cos(a + 0.9) * 4.2;
    const by = cy + Math.sin(a + 0.9) * 4.2;
    polyShade(
      p,
      [
        [cx, cy],
        [ax, ay],
        [bx, by],
      ],
      [mixc(cols[k], INK, 0.3), cols[k], mixc(cols[k], WHITE, 0.3), mixc(cols[k], WHITE, 0.6)],
    );
  }
  p.set(7, 7, hx('#f6d24a'));
  p.set(8, 7, hx('#b08a2a'));
  return { p: ink(p), ax: 7, ay: 21 };
}

registerPropPainter('f11_pinwheel', (o, time) => {
  const wv = windHere(o);
  const speed = 2 + wv.k * 5;
  const f = Math.floor(time * speed + o.y) % 4;
  return sprite(`pin|${f}|${(o.x + o.y) % 2}`, () => pinwheelPx(f, (o.x + o.y) % 2));
});

// --- Ветряк: башенка, четыре крыла, флюгер показывает поток --------------------

function windmillPx(f: number, dir: number, hot: boolean): { p: Px; ax: number; ay: number } {
  const W = 34;
  const H = 44;
  const p = new Px(W, H);
  const cx = 17;
  dropShadow(p, cx + 2, H - 3, 10, 3);
  // Башня: камень снизу, дерево сверху.
  polyShade(
    p,
    [
      [cx - 8, H - 3],
      [cx + 8, H - 3],
      [cx + 5.5, H - 22],
      [cx - 5.5, H - 22],
    ],
    ROCK,
  );
  for (let y = H - 20; y < H - 3; y += 4)
    for (let x = cx - 8; x <= cx + 8; x++) if (p.solid(x, y)) p.set(x, y, ROCK[0]);
  polyShade(
    p,
    [
      [cx - 6, H - 22],
      [cx + 6, H - 22],
      [cx + 4, H - 30],
      [cx - 4, H - 30],
    ],
    PLANK,
  );
  // Дверь.
  p.rect(cx - 2, H - 10, cx + 1, H - 4, hx('#3a2616'));
  p.set(cx - 2, H - 11, PLANK[3]);
  p.set(cx + 1, H - 11, PLANK[3]);
  // Крыша.
  polyShade(
    p,
    [
      [cx - 6, H - 30],
      [cx + 6, H - 30],
      [cx, H - 36],
    ],
    tn('#6a2a26', '#9a3e34', '#c05a48', '#e08068'),
  );
  // Флюгер: стрелка по ветру поверх крыши.
  const vx = Math.cos(dir);
  const vy = Math.sin(dir) * 0.5;
  stroke(p, cx - vx * 5, H - 37 - vy * 5, cx + vx * 5, H - 37 + vy * 5, hx('#3a3a44'));
  p.set(Math.round(cx + vx * 5), Math.round(H - 37 + vy * 5), hot ? hx('#ffe060') : hx('#e8504a'));
  p.set(Math.round(cx + vx * 4), Math.round(H - 38 + vy * 4), hot ? hx('#ffe060') : hx('#e8504a'));
  // Крылья: ось на лбу башни.
  const hx0 = cx;
  const hy0 = H - 26;
  for (let k = 0; k < 4; k++) {
    const a = (k * PI) / 2 + (f * PI) / 16 + 0.3;
    const ex = hx0 + Math.cos(a) * 15;
    const ey = hy0 + Math.sin(a) * 15;
    stroke(p, hx0, hy0, ex, ey, PLANK[0], 1);
    // Парус — решётка с полотном.
    const nx = -Math.sin(a);
    const ny = Math.cos(a);
    const s0x = hx0 + Math.cos(a) * 4;
    const s0y = hy0 + Math.sin(a) * 4;
    polyShade(
      p,
      [
        [s0x, s0y],
        [ex, ey],
        [ex + nx * 4, ey + ny * 4],
        [s0x + nx * 3, s0y + ny * 3],
      ],
      tn('#b8a888', '#e0d4b8', '#f4ecd8', '#fffaf0'),
    );
    for (let s = 5; s < 15; s += 3) {
      const x = hx0 + Math.cos(a) * s;
      const y = hy0 + Math.sin(a) * s;
      stroke(p, x, y, x + nx * 3.5, y + ny * 3.5, PLANK[1]);
    }
  }
  p.ell(hx0, hy0, 1.8, 1.8, hot ? hx('#ffe060') : IRON[2]);
  p.set(hx0 - 1, hy0 - 1, WHITE);
  return { p: ink(p), ax: cx, ay: H - 1 };
}

registerPropPainter('f11_windmill', (o, time) => {
  const st = f11State(paintSim());
  const md = st ? millDir(st, o) : null;
  const dir = md ? md.dir : 0;
  const since = md ? (paintSim()?.time ?? 0) - md.at : 9;
  const hot = since >= 0 && since < 0.6;
  const spin = 7 + (hot ? 18 : 0);
  const f = Math.floor(time * spin + o.x) % 8;
  const q = Math.round((((dir % TAU) + TAU) % TAU) / (PI / 4)) % 8;
  return sprite(`mill|${f}|${q}|${hot ? 1 : 0}`, () => windmillPx(f, (q * PI) / 4, hot));
});

// --- Фонтан ------------------------------------------------------------------

function fountainPx(f: number, area: string): { p: Px; ax: number; ay: number } {
  const p = new Px(30, 30);
  const cx = 15;
  const stone = area === F11_CASTLE ? MARBLE : area === F11_AQUA ? SAND : PATH;
  dropShadow(p, cx + 1, 27, 13, 3);
  // Чаша: борт, вода внутри.
  shadeEll(p, cx, 22, 13, 6.5, stone);
  p.ell(cx, 21.5, 10.5, 4.5, WATER[1]);
  for (let x = -9; x <= 9; x++) {
    const y = Math.round(21.5 + Math.sin((x + f) * 0.9) * 0.6);
    if ((x + f * 2) % 4 === 0) p.set(cx + x, y, WATER[3]);
  }
  // Столб и верхняя чаша.
  limb(p, cx, 21, cx, 12, 1.6, 1.3, stone);
  shadeEll(p, cx, 12, 5, 2.2, stone);
  p.ell(cx, 11.6, 3.4, 1.2, WATER[2]);
  // Струя: вверх, потом каплями вниз по бокам.
  for (let y = 2; y < 11; y++) p.set(cx, y, (y + f) % 3 === 0 ? WHITE : WATER[3]);
  for (let s = -1; s <= 1; s += 2)
    for (let i = 0; i < 7; i++) {
      const t = (i + f * 0.5) / 7;
      const x = cx + s * (1 + t * 6);
      const y = 3 + t * t * 16;
      p.set(Math.round(x), Math.round(y), (i + f) % 2 ? WATER[3] : WHITE);
    }
  return { p: ink(p), ax: cx, ay: 29 };
}

registerPropPainter('f11_fountain', (o, time) => {
  const f = Math.floor(time * 8) % 4;
  return sprite(`fountain|${f}|${o.area}`, () => fountainPx(f, o.area));
});

// --- Каменный фонарь ------------------------------------------------------------

registerPropPainter('f11_lantern', (o, time) => {
  const f = Math.floor(time * 5 + o.x) % 3;
  return sprite(`lantern|${f}`, () => {
    const p = new Px(12, 22);
    dropShadow(p, 6, 20, 5, 2);
    polyShade(
      p,
      [
        [3, 20],
        [9, 20],
        [8, 17],
        [4, 17],
      ],
      ROCK,
    );
    limb(p, 6, 17, 6, 12, 1.4, 1.4, ROCK);
    polyShade(
      p,
      [
        [2, 12],
        [10, 12],
        [9, 7],
        [3, 7],
      ],
      ROCK,
    );
    p.rect(4, 8, 7, 11, [255, 200 + f * 12, 110, 255]);
    p.set(5, 9, WHITE);
    polyShade(
      p,
      [
        [0, 7],
        [12, 7],
        [8, 3],
        [4, 3],
      ],
      tn('#5a5a60', '#7c7c84', '#9c9ca4', '#bcbcc4'),
    );
    p.set(6, 2, ROCK[3]);
    return { p: ink(p), ax: 6, ay: 21 };
  });
});

// --- Мелочь, которая бьётся -----------------------------------------------------

registerPropPainter('f11_urn', (o, _t, _alive, flash) =>
  sprite(`urn|${o.area}|${flash ? 1 : 0}`, () => {
    const p = new Px(12, 14);
    dropShadow(p, 6, 12, 5, 2);
    const t =
      o.area === F11_CASTLE
        ? tn('#4a5a8a', '#6a82b8', '#8ea6d8', '#c0d2f0')
        : tn('#8a4a2a', '#b8683a', '#d88a52', '#f0b078');
    shadeEll(p, 6, 8, 4.5, 4.2, t);
    limb(p, 6, 4, 6, 2, 1.8, 2.2, t);
    p.set(4, 8, t[3]);
    for (let x = 2; x < 11; x++) if (p.solid(x, 8)) p.set(x, 9, t[0]);
    const q = ink(p);
    return { p: flash ? q.tint(WHITE, 0.7) : q, ax: 6, ay: 13 };
  }),
);

registerPropPainter('f11_crate', (_o, _t, _alive, flash) =>
  sprite(`crate|${flash ? 1 : 0}`, () => {
    const p = new Px(16, 16);
    dropShadow(p, 8, 14, 7, 2);
    // Ящик: доски, внутри — облачные плоды (голубые, в пушку).
    p.rect(1, 6, 14, 13, PLANK[1]);
    p.rect(1, 6, 14, 6, PLANK[3]);
    p.rect(1, 13, 14, 13, PLANK[0]);
    for (let x = 1; x <= 14; x += 4) p.rect(x, 7, x, 13, PLANK[0]);
    for (let i = 0; i < 4; i++) {
      const x = 3 + i * 3.2;
      shadeEll(p, x, 5, 2.2, 2, tn('#6a8ac8', '#98b8ec', '#c8dcfa', '#f4f8ff'));
    }
    p.set(4, 3, hx('#4a8a3a'));
    p.set(10, 3, hx('#4a8a3a'));
    const q = ink(p);
    return { p: flash ? q.tint(WHITE, 0.7) : q, ax: 8, ay: 15 };
  }),
);

registerPropPainter('f11_barrel', (_o, _t, _alive, flash) =>
  sprite(`barrel|${flash ? 1 : 0}`, () => {
    const p = new Px(12, 15);
    dropShadow(p, 6, 13, 5, 2);
    for (let y = 2; y < 13; y++) {
      const w = 4.2 + Math.sin(((y - 2) / 11) * PI) * 1.2;
      for (let x = -Math.round(w); x <= Math.round(w); x++) {
        const l = -x / w;
        p.set(6 + x, y, tone(PLANK, l * 0.6 + 0.35));
      }
    }
    for (const y of [4, 10]) for (let x = 1; x < 11; x++) if (p.solid(x, y)) p.set(x, y, IRON[2]);
    p.ell(6, 2.5, 4, 1.4, WATER[2]);
    p.set(5, 2, WATER[3]);
    const q = ink(p);
    return { p: flash ? q.tint(WHITE, 0.7) : q, ax: 6, ay: 14 };
  }),
);

registerPropPainter('f11_nest', (_o, time, _alive, flash) =>
  sprite(`nest|${flash ? 1 : 0}|${Math.floor(time * 2) % 2}`, () => {
    const p = new Px(18, 12);
    dropShadow(p, 9, 10, 8, 2);
    // Гнездо из прутьев, в нём яйца и перо.
    for (let i = 0; i < 70; i++) {
      const a = hash(i, 1, 531) * TAU;
      const r = 5 + hash(i, 2, 532) * 3;
      const x = 9 + Math.cos(a) * r;
      const y = 7 + Math.sin(a) * r * 0.45;
      stroke(
        p,
        x,
        y,
        x + Math.cos(a + 1.6) * 2.5,
        y + Math.sin(a + 1.6) * 1,
        i % 3 ? PLANK[1] : PLANK[3],
      );
    }
    p.ell(9, 6.5, 4.5, 1.8, hx('#3a2616'));
    shadeEll(p, 7.5, 5.5, 1.8, 2.2, tn('#b0a890', '#e8e0c8', '#f8f4e8', '#ffffff'));
    shadeEll(p, 10.5, 5.8, 1.8, 2.2, tn('#b0a890', '#e8e0c8', '#f8f4e8', '#ffffff'));
    stroke(p, 12, 4, 16, 1, hx('#c89868'));
    stroke(p, 12, 5, 16, 2, hx('#6a4a3a'));
    const q = ink(p);
    return { p: flash ? q.tint(WHITE, 0.7) : q, ax: 9, ay: 11 };
  }),
);

// --- Камень и сад ----------------------------------------------------------------

/** Статуя древнего стража: круглая голова, длинные руки, мох и цветы. */
function statuePx(area: string): { p: Px; ax: number; ay: number } {
  const p = new Px(26, 34);
  const stone =
    area === F11_CASTLE
      ? tn('#7c7c88', '#a2a2ae', '#c4c4ce', '#e2e2ea')
      : tn('#76705e', '#9a927c', '#bab29a', '#d6cfb8');
  dropShadow(p, 14, 31, 11, 3);
  // Постамент.
  polyShade(
    p,
    [
      [4, 32],
      [22, 32],
      [21, 28],
      [5, 28],
    ],
    stone,
  );
  // Тело-цилиндр.
  shadeEll(p, 13, 20, 6.5, 7.5, stone);
  // Руки до земли.
  limb(p, 7, 16, 4, 27, 1.8, 1.4, stone);
  limb(p, 19, 16, 22, 27, 1.8, 1.4, stone);
  // Голова и глаз.
  shadeEll(p, 13, 9, 5, 4.5, stone);
  p.ell(13, 9.5, 1.8, 1.8, hx('#2a2a30'));
  p.set(13, 9, hx('#5ab8a8'));
  // Мох и цветы — остров давно зарос.
  for (let i = 0; i < 40; i++) {
    const x = Math.floor(hash(i, 1, 541) * 26);
    const y = Math.floor(hash(i, 2, 542) * 30);
    if (!p.solid(x, y)) continue;
    const top = !p.solid(x, y - 1);
    if (top || hash(i, 3, 543) < 0.3) p.set(x, y, hash(i, 4, 544) < 0.5 ? MOSS[2] : MOSS[3]);
  }
  p.set(9, 5, hx('#f4f0ea'));
  p.set(18, 13, hx('#e888a8'));
  p.set(6, 20, hx('#f6d24a'));
  return { p: ink(p), ax: 13, ay: 33 };
}

registerPropPainter('f11_statue', (o) => sprite(`statue|${o.area}`, () => statuePx(o.area)));

registerPropPainter('f11_column', (o) =>
  sprite(`column|${o.area}|${(o.x * 7 + o.y) % 3}`, () => {
    const p = new Px(14, 28);
    const t = o.area === F11_CASTLE ? MARBLE : o.area === F11_AQUA ? SAND : PATH;
    const broken = (o.x * 7 + o.y) % 3;
    const top = 4 + broken * 3;
    dropShadow(p, 7, 26, 6, 2);
    polyShade(
      p,
      [
        [1, 26],
        [13, 26],
        [12, 23],
        [2, 23],
      ],
      t,
    );
    for (let y = top; y < 23; y++)
      for (let x = 3; x <= 10; x++) {
        const fl = (x - 3) % 2 === 0 ? -0.15 : 0.1;
        p.set(x, y, tone(t, ((6.5 - x) / 4) * 0.6 + 0.35 + fl));
      }
    // Слом наверху — рваный край.
    for (let x = 3; x <= 10; x++) {
      const d = Math.floor(hash(x, broken, 551) * (broken ? 4 : 1));
      for (let y = top; y < top + d; y++) clearPx(p, x, y);
      p.set(x, top + d, t[3]);
    }
    if (!broken)
      polyShade(
        p,
        [
          [1, top],
          [13, top],
          [12, top - 3],
          [2, top - 3],
        ],
        t,
      );
    if (o.area !== F11_CASTLE)
      for (let i = 0; i < 6; i++)
        p.set(
          3 + Math.floor(hash(i, broken, 552) * 8),
          12 + Math.floor(hash(i, 5, 553) * 10),
          MOSS[2],
        );
    return { p: ink(p), ax: 7, ay: 27 };
  }),
);

registerPropPainter('f11_topiary', (o) =>
  sprite(`topiary|${(o.x + o.y) % 2}`, () => {
    const p = new Px(16, 18);
    dropShadow(p, 8, 16, 7, 2);
    shadeEll(p, 8, 9, 6.5, 6.5, HEDGE);
    for (let i = 0; i < 26; i++) {
      const x = Math.floor(hash(i, 1, 561 + ((o.x + o.y) % 2)) * 16);
      const y = Math.floor(hash(i, 2, 562) * 16);
      if (p.solid(x, y)) p.set(x, y, y < 8 && x < 9 ? HEDGE[3] : HEDGE[0]);
    }
    if ((o.x + o.y) % 2) {
      p.set(5, 5, hx('#f4f0ea'));
      p.set(11, 9, hx('#e86a7a'));
    }
    return { p: ink(p), ax: 8, ay: 17 };
  }),
);

registerPropPainter('f11_bench', () =>
  sprite('bench', () => {
    const p = new Px(18, 12);
    dropShadow(p, 9, 10, 8, 2);
    polyShade(
      p,
      [
        [1, 5],
        [17, 5],
        [17, 8],
        [1, 8],
      ],
      PATH,
    );
    p.rect(3, 8, 4, 10, PATH[0]);
    p.rect(13, 8, 14, 10, PATH[0]);
    for (let x = 1; x < 17; x++) p.set(x, 5, PATH[3]);
    return { p: ink(p), ax: 9, ay: 11 };
  }),
);

registerPropPainter('f11_flag', (o, time) => {
  const wv = windHere(o);
  const f = Math.floor(time * (4 + wv.k * 1.5) + o.x) % 4;
  const side = Math.cos(wv.dir) >= 0 ? 1 : -1;
  const len = Math.max(4, Math.min(10, Math.round(3 + wv.k * 1.2)));
  const col = o.area === F11_CASTLE ? 1 : o.area === F11_AQUA ? 2 : 0;
  return sprite(`flag|${f}|${side}|${len}|${col}`, () => {
    const p = new Px(24, 28);
    const cx = 12;
    dropShadow(p, cx, 26, 3, 1);
    for (let y = 3; y < 27; y++) {
      p.set(cx, y, IRON[2]);
      p.set(cx + 1, y, IRON[0]);
    }
    p.set(cx, 2, GOLD[3]);
    const cloth: Tones[] = [
      tn('#a0302a', '#d84a3a', '#f0705a', '#ff9c84'),
      tn('#1e3e74', '#2c5596', '#4a78c0', '#7aa4e0'),
      tn('#b07020', '#e0a038', '#f4c460', '#ffe098'),
    ];
    const t = cloth[col];
    for (let i = 0; i < len; i++) {
      const wave = Math.round(Math.sin(i * 0.9 - f * 1.57) * 1.2);
      const h = 6 - Math.floor((i / len) * 3);
      for (let y = 0; y < h; y++) {
        const x = cx + side * (1 + i);
        p.set(x, 4 + y + wave, tone(t, 0.6 - y * 0.12 + (wave > 0 ? -0.2 : 0.2)));
      }
    }
    return { p: ink(p), ax: cx, ay: 27 };
  });
});

// --- Механизмы: колесо, лебёдка, заслонка, пульт ---------------------------------

registerPropPainter('f11_wheel', (_o, time) => {
  const f = Math.floor(time * 6) % 6;
  return sprite(`wheel|${f}`, () => {
    const p = new Px(26, 28);
    const cx = 13;
    const cy = 13;
    dropShadow(p, cx, 26, 11, 2);
    p.ell(cx, cy, 11.5, 11.5, PLANK[0]);
    for (let y = 0; y < 26; y++)
      for (let x = 0; x < 26; x++)
        if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) < 9.5) clearPx(p, x, y);
    for (let k = 0; k < 8; k++) {
      const a = (k * PI) / 4 + (f * PI) / 24;
      stroke(p, cx, cy, cx + Math.cos(a) * 11, cy + Math.sin(a) * 11, PLANK[1], 1);
      const bx = cx + Math.cos(a) * 11;
      const by = cy + Math.sin(a) * 11;
      p.rect(
        Math.round(bx) - 1,
        Math.round(by) - 1,
        Math.round(bx) + 1,
        Math.round(by) + 1,
        PLANK[2],
      );
      // Вода стекает с лопаток.
      if (Math.sin(a) > 0.3) p.set(Math.round(bx), Math.round(by) + 2, WATER[3]);
    }
    p.ell(cx, cy, 2.5, 2.5, IRON[2]);
    p.set(cx - 1, cy - 1, IRON[3]);
    return { p: ink(p), ax: cx, ay: 27 };
  });
});

registerPropPainter('f11_winch', (o) => {
  const st = f11State(paintSim());
  const up = st ? st.winch.state === 'up' : false;
  return sprite(`winch|${up ? 1 : 0}`, () => {
    const p = new Px(18, 18);
    dropShadow(p, 9, 16, 8, 2);
    p.rect(2, 8, 3, 15, PLANK[1]);
    p.rect(14, 8, 15, 15, PLANK[1]);
    for (let y = 6; y < 13; y++)
      for (let x = 4; x < 14; x++) p.set(x, y, tone(PLANK, (9.5 - y) / 4));
    for (let x = 4; x < 14; x += 2) p.set(x, 9, IRON[up ? 3 : 1]);
    // Рукоять.
    stroke(p, 15, 9, 17, up ? 5 : 13, IRON[2]);
    // Цепь к причалу.
    for (let i = 0; i < 6; i++) p.set(9 + (i % 2), 12 + i / 2, up ? IRON[3] : IRON[1]);
    void o;
    return { p: ink(p), ax: 9, ay: 17 };
  });
});

registerPropPainter('f11_valve', (o, time) => {
  const sim = paintSim();
  const vs = sim ? valveShown(sim, o) : 0;
  const open = vs > 0;
  const f = open ? Math.floor(time * (vs === 1 ? 8 : 16)) % 4 : 0;
  return sprite(`valve|${open ? 1 : 0}|${f}`, () => {
    const p = new Px(16, 20);
    dropShadow(p, 8, 18, 6, 2);
    // Труба из стены и вентиль-колесо.
    p.rect(9, 6, 15, 11, IRON[1]);
    p.rect(9, 6, 15, 6, IRON[3]);
    p.ell(7, 9, 5.5, 5.5, IRON[2]);
    for (let y = 5; y < 14; y++)
      for (let x = 3; x < 12; x++) if (Math.hypot(x + 0.5 - 7, y + 0.5 - 9) < 3.5) clearPx(p, x, y);
    for (let s = 0; s < 4; s++) {
      const a = (s * PI) / 2 + f * 0.4;
      stroke(p, 7, 9, 7 + Math.cos(a) * 5, 9 + Math.sin(a) * 5, IRON[3]);
    }
    p.ell(7, 9, 1.4, 1.4, open ? hx('#8af0ff') : hx('#e84a3a'));
    p.rect(5, 14, 9, 18, IRON[0]);
    return { p: ink(p), ax: 8, ay: 19 };
  });
});

registerPropPainter('f11_console', (_o, time) => {
  const st = f11State(paintSim());
  const s = st?.garden.state ?? 'idle';
  const f = Math.floor(time * 3) % 3;
  return sprite(`console|${s}|${f}`, () => {
    const p = new Px(16, 22);
    dropShadow(p, 8, 20, 7, 2);
    polyShade(
      p,
      [
        [2, 20],
        [14, 20],
        [12, 9],
        [4, 9],
      ],
      tn('#6a6a58', '#8e8c76', '#aeab92', '#cac7b0'),
    );
    // Скрижаль с рунами.
    polyShade(
      p,
      [
        [3, 9],
        [13, 9],
        [12, 3],
        [4, 3],
      ],
      tn('#3a4a5a', '#4e6478', '#66809a', '#8aa4bc'),
    );
    const c = s === 'on' ? hx('#ff6a4a') : s === 'done' ? hx('#8a9aa8') : hx('#7af0c8');
    for (let i = 0; i < 4; i++) p.set(5 + i * 2, 5 + ((i + f) % 2), c);
    p.set(8, 7, c);
    for (let i = 0; i < 8; i++)
      p.set(3 + Math.floor(hash(i, 1, 571) * 10), 12 + Math.floor(hash(i, 2, 572) * 7), MOSS[2]);
    return { p: ink(p), ax: 8, ay: 21 };
  });
});

registerPropPainter('f11_crystal', (o, time) => {
  const f = Math.floor(time * 2.5 + o.x) % 4;
  return sprite(`crystal|${f}`, () => {
    const p = new Px(14, 18);
    dropShadow(p, 7, 16, 5, 2);
    const shards: [number, number, number, number][] = [
      [7, 16, 7, 2],
      [4, 16, 2, 7],
      [10, 16, 12, 8],
      [5, 16, 3, 11],
    ];
    for (const [bx, by, tx, ty] of shards) {
      polyShade(
        p,
        [
          [bx - 2, by],
          [bx + 2, by],
          [tx + 1, ty],
          [tx - 1, ty],
        ],
        CRYSTAL,
      );
    }
    const glow = [hx('#bff8ee'), hx('#8af0e0'), hx('#ffffff'), hx('#8af0e0')][f];
    p.set(7, 5, glow);
    p.set(6, 7, glow);
    p.set(11, 10, glow);
    return { p: ink(p, hx('#1a3a44')), ax: 7, ay: 17 };
  });
});

registerPropPainter('f11_wreck', () =>
  sprite('wreck', () => {
    const p = new Px(24, 16);
    const stone = tn('#76705e', '#9a927c', '#bab29a', '#d6cfb8');
    dropShadow(p, 12, 14, 11, 2);
    // Павший садовник: бочонок-тело на боку, голова откатилась, рука.
    shadeEll(p, 10, 9, 7, 4.5, stone);
    shadeEll(p, 19, 10, 3.5, 3.2, stone);
    p.ell(19, 10, 1.2, 1.2, hx('#2a2a30'));
    limb(p, 5, 11, 1, 13, 1.3, 1, stone);
    for (let i = 0; i < 30; i++) {
      const x = Math.floor(hash(i, 1, 581) * 24);
      const y = Math.floor(hash(i, 2, 582) * 14);
      if (p.solid(x, y) && !p.solid(x, y - 1)) p.set(x, y, MOSS[hash(i, 3, 583) < 0.5 ? 2 : 3]);
    }
    p.set(8, 5, hx('#f4f0ea'));
    p.set(13, 5, hx('#f6d24a'));
    p.set(11, 4, hx('#e888a8'));
    return { p: ink(p), ax: 12, ay: 15 };
  }),
);

// --- Небо: облака, летучие камни, водопады --------------------------------------

registerPropPainter('f11_cloud', (o, time) => {
  const area = o.area;
  const pal = skyOf(area);
  const v = (o.x * 13 + o.y * 7) % 3;
  const s = sprite(`cloud|${area}|${v}`, () => {
    const W = 44 + v * 8;
    const H = 20 + v * 2;
    const p = new Px(W, H);
    for (let i = 0; i < 7; i++) {
      const cx = 8 + (i / 6) * (W - 16);
      const cy = H * 0.62 - Math.sin((i / 6) * PI) * H * 0.3 + (hash(i, v, 591) - 0.5) * 3;
      const r = 5 + Math.sin((i / 6) * PI) * (H * 0.28) + hash(i, v, 592) * 2;
      shadeEll(p, cx, cy, r, r * 0.8, pal.cloud, 0.25);
    }
    // Плоское дно облака.
    for (let x = 0; x < W; x++)
      for (let y = H - 5; y < H; y++) if (p.solid(x, y)) p.set(x, y, alpha(pal.cloud[0], 0.9));
    return { p, ax: W / 2, ay: H - 2 };
  });
  // Облако плывёт туда-сюда вдоль своей клетки.
  const drift = Math.sin(time * 0.12 + o.x) * 22 + Math.sin(time * 0.05 + o.y) * 10;
  return { img: s.img, ax: s.ax - drift, ay: s.ay - Math.sin(time * 0.3 + o.x) * 1.5 };
});

registerPropPainter('f11_floatrock', (o, time) => {
  const area = o.area;
  const v = (o.x + o.y) % 2;
  const s = sprite(`frock|${area}|${v}`, () => {
    const pal = skyOf(area);
    const p = new Px(20, 26);
    // Верх — трава или мрамор, низ — сужающийся камень с кристаллом.
    for (let y = 6; y < 24; y++) {
      const k = (y - 6) / 18;
      const w = 8 * (1 - k * k) + 1;
      for (let x = -Math.round(w); x <= Math.round(w); x++) {
        const l = -x / w;
        p.set(
          10 + x,
          y,
          k < 0.35 ? tone(pal.earth, l * 0.5 + 0.4) : tone(pal.rock, l * 0.6 + 0.2 - k * 0.3),
        );
      }
    }
    shadeEll(p, 10, 6, 8.5, 3, area === F11_CASTLE ? MARBLE : GRASS);
    if (v)
      polyShade(
        p,
        [
          [9, 24],
          [12, 24],
          [11, 20],
          [9, 20],
        ],
        CRYSTAL,
      );
    else for (let i = 0; i < 3; i++) p.set(6 + i * 3, 23 - i, hx('#3a2a20'));
    if (area !== F11_CASTLE) {
      p.set(7, 3, GRASS[3]);
      p.set(8, 2, GRASS[2]);
      p.set(13, 4, hx('#f4f0ea'));
    }
    return { p: ink(p), ax: 10, ay: 22 };
  });
  const bob = Math.round(Math.sin(time * 1.1 + o.x * 1.7) * 2);
  return { img: s.img, ax: s.ax, ay: s.ay + bob + 8 };
});

registerPropPainter('f11_waterfall', (o, time) => {
  const f = Math.floor(time * 12) % 4;
  return sprite(`fall|${f}`, () => {
    const p = new Px(16, 52);
    for (let y = 0; y < 44; y++) {
      const w = 6 + y * 0.12;
      for (let x = -Math.round(w); x <= Math.round(w); x++) {
        const band = (y - f * 3 + Math.abs(x) * 2 + 40) % 6;
        let c = band < 2 ? WATER[3] : band < 4 ? WATER[2] : WATER[1];
        const edge = Math.abs(x) / w;
        const a = (1 - Math.max(0, (y - 30) / 14)) * (edge > 0.8 ? 0.6 : 0.9);
        if (x === -Math.round(w)) c = WATER[0];
        p.set(8 + x, y, alpha(c, a));
      }
    }
    // Туман внизу — вода рассыпается в небо.
    for (let i = 0; i < 26; i++) {
      const x = Math.floor(hash(i, f, 601) * 16);
      const y = 36 + Math.floor(hash(i, f, 602) * 14);
      p.set(x, y, alpha(WHITE, 0.6));
    }
    return { p, ax: 8, ay: 16 };
  });
});

// --- Настенное: знамя, кристальный светильник, окно ------------------------------

registerPropPainter('f11_banner', (o, time) => {
  const f = Math.floor(time * 3 + o.x) % 3;
  return sprite(`banner|${f}`, () => {
    const p = new Px(12, 16);
    for (let x = 0; x < 12; x++) p.set(x, 0, GOLD[2]);
    for (let y = 1; y < 13; y++)
      for (let x = 2; x < 10; x++) {
        const wave = Math.round(Math.sin(y * 0.6 + f * 2) * 0.6);
        p.set(x + wave, y, tone(SLATE, (6 - x) / 5 + 0.3));
      }
    // Знак — кристалл острова.
    p.set(6, 5, RUNE);
    p.set(5, 6, RUNE);
    p.set(7, 6, RUNE);
    p.set(6, 7, RUNE);
    p.set(6, 6, WHITE);
    for (let x = 2; x < 10; x += 2) p.set(x, 13, GOLD[2]);
    p.set(3, 14, GOLD[1]);
    p.set(7, 14, GOLD[1]);
    return { p: ink(p), ax: 6, ay: 14 };
  });
});

registerPropPainter('f11_sconce', (o, time) => {
  const f = Math.floor(time * 3 + o.x) % 3;
  return sprite(`sconce|${f}`, () => {
    const p = new Px(10, 12);
    p.rect(3, 8, 6, 9, GOLD[1]);
    polyShade(
      p,
      [
        [2, 8],
        [7, 8],
        [6, 2],
        [3, 2],
      ],
      CRYSTAL,
      f * 0.15,
    );
    p.set(4, 3 + f, WHITE);
    return { p: ink(p, hx('#1a3a44')), ax: 5, ay: 13 };
  });
});

registerPropPainter('f11_window', (o) =>
  sprite(`window|${o.area}`, () => {
    const p = new Px(12, 12);
    const pal = skyOf(o.area);
    for (let y = 0; y < 11; y++)
      for (let x = 0; x < 10; x++) {
        const d = y < 4 ? Math.hypot(x - 4.5, y - 4) : Math.abs(x - 4.5);
        if (d > 4.6) continue;
        p.set(x + 1, y, d > 3.6 ? CASTLE[0] : mixc(pal.deep2, pal.cloud[2], y / 12));
      }
    p.rect(1, 10, 10, 11, CASTLE[3]);
    return { p, ax: 6, ay: 14 };
  }),
);

/** Верх Ветряной башни: круглая кладка, медная крыша и флюгер, который
 * показывает, куда башня гонит ветер; перед поворотом он дрожит и светится. */
registerPropPainter('f11_vane', (_o, time) => {
  const st = f11State(paintSim());
  const dir = st ? st.groups[3].dir : 0;
  const warn = st ? towerTurn(st) : 0;
  const q = ((Math.round(dir / (PI / 4)) % 8) + 8) % 8;
  const shake = warn > 0 ? Math.floor(time * 16) % 2 : 0;
  return sprite(`vane|${q}|${warn > 0 ? 1 : 0}|${shake}`, () => {
    const W = 40;
    const H = 66;
    const p = new Px(W, H);
    const cx = 20;
    // Барабан башни.
    for (let y = 34; y < 64; y++)
      for (let x = cx - 13; x <= cx + 13; x++) {
        const u = (x + 0.5 - cx) / 13;
        if (Math.abs(u) > 1) continue;
        // Цилиндр: свет слева, тень справа — четыре полосы тона.
        let c = u < -0.6 ? RUIN[3] : u < 0.05 ? RUIN[2] : u < 0.62 ? RUIN[1] : RUIN[0];
        if (y > 60) c = mixc(c, RUIN[0], 0.5);
        // Кладка: ряды по дуге (середина ниже краёв), швы вразбежку.
        const yy = y - 34 - Math.round((1 - u * u) * 1.5);
        const row = Math.floor(yy / 5);
        const off = row % 2 ? 4 : 0;
        const joint = (((x + off) % 8) + 8) % 8 === 0 && Math.abs(u) < 0.8;
        if (((yy % 5) + 5) % 5 === 0 || joint) c = mixc(c, RUIN[0], 0.45);
        p.set(x, y, c);
      }
    shadeEll(p, cx, 34, 13, 3.5, RUIN, 0.2);
    // Окно-бойница и мох по низу.
    p.rect(cx - 2, 42, cx + 1, 49, hx('#2a1e14'));
    p.set(cx - 2, 41, RUIN[0]);
    p.set(cx + 1, 41, RUIN[0]);
    for (let i = 0; i < 26; i++) {
      const x = cx - 12 + Math.floor(hash(i, 1, 851) * 24);
      const y = 50 + Math.floor(hash(i, 2, 852) * 13);
      if (p.solid(x, y)) p.set(x, y, MOSS[hash(i, 3, 853) < 0.5 ? 2 : 3]);
    }
    // Медная крыша с патиной.
    const roof = tn('#1f5a52', '#2f7d70', '#4aa08e', '#7cc8b0');
    polyShade(
      p,
      [
        [cx - 15, 35],
        [cx + 15, 35],
        [cx, 12],
      ],
      roof,
    );
    for (let k = 0; k < 5; k++)
      stroke(p, cx, 13, cx - 13 + k * 6.5, 35, mixc(roof[0], roof[1], 0.5));
    for (let x = cx - 15; x <= cx + 15; x++) if (p.solid(x, 35)) p.set(x, 35, GOLD[1]);
    // Мачта и флюгер-стрела по ветру (в перспективе: вбок — длинно, вглубь — коротко).
    p.rect(cx, 4, cx, 12, IRON[2]);
    p.set(cx, 3, GOLD[3]);
    const a = (q * PI) / 4 + (shake ? 0.25 : 0);
    const dx = Math.cos(a);
    const dy = Math.sin(a) * 0.45;
    const hot = warn > 0;
    const c1 = hot ? hx('#ffe060') : GOLD[2];
    const c0 = hot ? hx('#ff9a3a') : GOLD[0];
    stroke(p, cx - dx * 8, 8 - dy * 8, cx + dx * 8, 8 + dy * 8, c1);
    // Наконечник и оперение.
    const tx = cx + dx * 8;
    const ty = 8 + dy * 8;
    const nx = -dy;
    const ny = dx;
    poly(
      p,
      [
        [tx + dx * 3, ty + dy * 3],
        [tx + nx * 2.2, ty + ny * 2.2],
        [tx - nx * 2.2, ty - ny * 2.2],
      ],
      c1,
    );
    poly(
      p,
      [
        [cx - dx * 8, 8 - dy * 8],
        [cx - dx * 11 + nx * 3, 8 - dy * 11 + ny * 3],
        [cx - dx * 11 - nx * 3, 8 - dy * 11 - ny * 3],
      ],
      c0,
    );
    const out = ink(p);
    if (hot)
      for (let k = 0; k < 10; k++) {
        const aa = (k / 10) * TAU;
        out.set(
          Math.round(cx + Math.cos(aa) * 13),
          Math.round(8 + Math.sin(aa) * 5),
          alpha(hx('#ffe060'), 0.55),
        );
      }
    return { p: out, ax: cx, ay: H - 2 };
  });
});

/** Планер абордажника — для зоны прилёта. */
let gliderImg: HTMLCanvasElement | null = null;
function gliderSprite(): HTMLCanvasElement {
  if (gliderImg) return gliderImg;
  const p = new Px(26, 14);
  const sail = tn('#8a3a2a', '#c05a3a', '#e08a5a', '#f4b888');
  polyShade(
    p,
    [
      [1, 6],
      [13, 1],
      [25, 6],
      [13, 4],
    ],
    sail,
  );
  for (let x = 2; x < 25; x += 4) stroke(p, 13, 2, x, 6, PLANK[0]);
  // Человечек под крылом.
  limb(p, 13, 6, 13, 10, 1.4, 1.2, tn('#3a2a22', '#5a4030', '#7a5a40', '#9a7a58'));
  shadeEll(p, 13, 6, 1.8, 1.6, tn('#8a5a3a', '#c08a5a', '#e0b080', '#f4d0a0'));
  gliderImg = ink(p).canvas();
  return gliderImg;
}

registerZonePainter('f11_glider', (g, z, px, py) => {
  const zz = z as Zone & { ang?: number };
  const k = Math.min(1, z.t / 0.95);
  if (k >= 1) return true;
  const a = zz.ang ?? 0;
  const d = (1 - k) * 70;
  const x = px + Math.cos(a) * d;
  const y = py + Math.sin(a) * d - 14 * (1 - k) - 6;
  // Тень на земле — куда сядет.
  g.fillStyle = `rgba(0,0,0,${0.15 + 0.2 * k})`;
  g.beginPath();
  g.ellipse(px, py + 1, 5 + 4 * k, 2, 0, 0, TAU);
  g.fill();
  const img = gliderSprite();
  g.drawImage(img, Math.round(x - img.width / 2), Math.round(y - img.height / 2));
  return true;
});

// ---------------------------------------------------------------------------
// Монстры. Кадр собирается один раз на позу, сторону, вспышку и вид (элита,
// альбинос) и лежит в кеше. Все смотрят вправо; влево — отражение.
// ---------------------------------------------------------------------------

interface Built {
  p: Px;
  ax: number;
  ay: number;
  eye?: [number, number] | null;
}
const mobFrames = new Map<string, MobFrame>();
const GOLDK = hx('#ffd24a');
const CYAN = hx('#7af6ff');
const LENS_RIM = hx('#20242c');

function finishMob(
  key: string,
  b: Built,
  look: MobPose['look'],
  flash: boolean,
  left: boolean,
): MobFrame {
  let p = b.p;
  if (look === 'albino') {
    const pale = hx('#f6f0ea');
    const q = new Px(p.w, p.h);
    for (let i = 0; i < p.data.length; i += 4) {
      if (!p.data[i + 3]) continue;
      const l = (p.data[i] + p.data[i + 1] + p.data[i + 2]) / 3;
      const c = mixc([l, l, l, 255], pale, 0.5);
      q.data[i] = c[0];
      q.data[i + 1] = c[1];
      q.data[i + 2] = c[2];
      q.data[i + 3] = p.data[i + 3];
    }
    p = q;
  }
  if (look === 'elite') p.outline(GOLDK);
  if (flash) p = p.tint(WHITE, 0.85);
  if (left) p = p.flipX();
  const eye = b.eye ? ([left ? p.w - 1 - b.eye[0] : b.eye[0], b.eye[1]] as [number, number]) : null;
  const out: MobFrame = { img: p.canvas(), ax: left ? p.w - b.ax : b.ax, ay: b.ay, eye };
  mobFrames.set(key, out);
  return out;
}

function mobFrame(kind: string, pose: MobPose, anim: string, build: () => Built): MobFrame {
  const key = `${kind}|${anim}|${pose.left ? 1 : 0}|${pose.flash ? 1 : 0}|${pose.look}`;
  return mobFrames.get(key) ?? finishMob(key, build(), pose.look, pose.flash, pose.left);
}

/** Линза-глаз робота: оправа, стекло, блик. */
function lens(p: Px, x: number, y: number, r: number, c: RGBA, bright = false): void {
  p.ell(x, y, r + 1, r + 1, LENS_RIM);
  p.ell(x, y, r, r, mixc(c, INK, 0.45));
  p.ell(x + 0.2, y + 0.2, r * 0.7, r * 0.7, c);
  p.set(Math.floor(x - r * 0.35), Math.floor(y - r * 0.45), bright ? WHITE : mixc(c, WHITE, 0.65));
}

/** Пар клубами — поверх контура, полупрозрачный. */
function puffs(p: Px, x: number, y: number, f: number, n = 3, spread = 3): void {
  for (let i = 0; i < n; i++) {
    const k = (((f * 0.37 + i / n) % 1) + 1) % 1;
    const px = x + Math.sin(i * 2.1 + f) * spread * k;
    const py = y - k * 6;
    const r = 1 + k * 1.6;
    for (let yy = -2; yy <= 2; yy++)
      for (let xx = -2; xx <= 2; xx++)
        if (xx * xx + yy * yy <= r * r)
          p.set(Math.round(px + xx), Math.round(py + yy), alpha(WHITE, 0.55 * (1 - k * 0.6)));
  }
}

/** Оглушение — звёздочки кругом над головой. */
function dizzy(p: Px, cx: number, cy: number, rx: number, f: number): void {
  for (let i = 0; i < 3; i++) {
    const a = (f / 4) * TAU + (i / 3) * TAU;
    const x = Math.round(cx + Math.cos(a) * rx);
    const y = Math.round(cy + Math.sin(a) * rx * 0.35);
    p.set(x, y, WHITE);
    p.set(x - 1, y, GOLD[3]);
    p.set(x + 1, y, GOLD[3]);
    p.set(x, y - 1, GOLD[3]);
    p.set(x, y + 1, GOLD[3]);
  }
}

// --- Небесный скат ------------------------------------------------------------

const RAY_T = tn('#1c3c66', '#2b5b92', '#4583be', '#7ab4e2');
const RAY_E = tn('#9ab0c8', '#c8d8e8', '#e8f0f8', '#ffffff');

function rayPx(fy: number, kind: 'glide' | 'aim' | 'swoop' | 'hurt' | 'dead', f: number): Built {
  // Манта сверху: голова к зрителю, крылья в стороны, хвост-хлыст назад.
  const W = 38;
  const H = 28;
  const p = new Px(W, H);
  const cx = 19;
  const cy = 13;
  const swoop = kind === 'swoop';
  const dead = kind === 'dead';
  const body = dead ? RAY_E : RAY_T;
  // Хвост — прямо назад, лёгкой волной.
  const wig = Math.sin(f * 0.9) * 1.2;
  for (let k = 0; k < 11; k++) {
    const x = cx + Math.sin(k * 0.5 + f * 0.9) * (k / 11) * 1.4 + wig * (k / 11);
    p.set(Math.round(x), cy - 4 - k, k > 8 ? RAY_E[1] : RAY_T[0]);
  }
  // Крылья: выпуклая передняя кромка (к зрителю), срезанная задняя.
  const span = swoop ? 10 : 17 - Math.abs(fy) * 0.55;
  const tipY = swoop ? cy - 5 : cy - 1 + fy;
  for (const s of [-1, 1]) {
    const lead = spline(
      [
        [cx + s * 2, cy + 4],
        [cx + s * span * 0.45, cy + 4 + fy * 0.25],
        [cx + s * span * 0.8, cy + 1.5 + fy * 0.7],
        [cx + s * span, tipY],
      ],
      4,
    );
    const trail: [number, number][] = [
      [cx + s * (span - 2), tipY - 1],
      [cx + s * span * 0.55, cy - 2 + fy * 0.35],
      [cx + s * 3, cy - 4],
    ];
    polyShade(p, [...lead, ...trail], body, s < 0 ? 0.12 : -0.04);
    // Светлая кромка — брюхо, видное снизу.
    for (const [x, y] of lead) p.set(Math.floor(x), Math.floor(y), RAY_E[dead ? 3 : 1]);
    if (fy < -1 && !dead)
      for (const [x, y] of lead.slice(2)) p.set(Math.floor(x), Math.floor(y) + 1, RAY_E[2]);
  }
  // Тело — бугор на спине.
  shadeEll(p, cx, cy, 4.6, 5.2, body, 0.15);
  // Узор: светлые горошины по спине.
  if (!dead)
    for (let i = 0; i < 18; i++) {
      const x = Math.round(cx - 14 + hash(i, 3, 701) * 28);
      const y = Math.round(cy - 3 + hash(i, 4, 702) * 6);
      if (p.solid(x, y) && Math.abs(x - cx) > 2) p.set(x, y, alpha(RAY_E[2], 0.55));
    }
  // Головные плавники-«рога», между ними рот.
  limb(p, cx - 2.5, cy + 4, cx - 3.5, cy + 8.5, 1.3, 0.7, body, 0.1);
  limb(p, cx + 2.5, cy + 4, cx + 3.5, cy + 8.5, 1.3, 0.7, body);
  p.rect(cx - 1, cy + 5, cx + 1, cy + 5, RAY_T[0]);
  // Глаза по бокам головы.
  const ec = kind === 'aim' ? WHITE : dead ? RAY_T[1] : CYAN;
  p.set(cx - 4, cy + 3, ec);
  p.set(cx + 4, cy + 3, ec);
  const q = ink(p);
  if (kind === 'aim')
    for (let x = 0; x < W; x++)
      for (let y = 0; y < H; y++)
        if (q.get(x, y)[3] && Math.hypot(x - cx, (y - cy) * 1.3) < 6) q.set(x, y, alpha(CYAN, 0.3));
  if (swoop)
    for (let i = 0; i < 4; i++) {
      const x = cx - 7 + i * 4.5;
      for (let k = 0; k < 5; k++) q.set(Math.round(x), 1 + k, alpha(WHITE, 0.2 + k * 0.08));
    }
  return { p: q, ax: cx, ay: H - 2, eye: [cx + 4, cy + 3] };
}

registerMobPainter('f11_ray', (m: Mob, pose: MobPose) => {
  if (pose.mode === 'dying' || pose.anim === 'dead')
    return mobFrame('ray', pose, 'dead', () => rayPx(2, 'dead', 0));
  if (pose.mode === 'aim') {
    const f = Math.floor(pose.t * 10) % 2;
    return mobFrame('ray', pose, `aim${f}`, () => rayPx(-5 + f, 'aim', 0));
  }
  if (pose.mode === 'f11_swoop') {
    const f = Math.floor(pose.t * 14) % 2;
    return mobFrame('ray', pose, `swoop${f}`, () => rayPx(0, 'swoop', f * 3));
  }
  if (pose.anim === 'hurt') return mobFrame('ray', pose, 'hurt', () => rayPx(2, 'hurt', 1));
  const f = ((Math.floor((paintSim()?.time ?? 0) * 9 + m.id * 1.7) % 8) + 8) % 8;
  return mobFrame('ray', pose, `glide${f}`, () =>
    rayPx(Math.round(Math.sin((f / 8) * TAU) * 4.5), 'glide', f),
  );
});

// --- Роботы: садовник и страж ----------------------------------------------------

const BOT = tn('#4a3a2a', '#6e583e', '#957856', '#b99c74');
const BOT_SEAM = hx('#34281c');
const GUARD_T = tn('#353c48', '#56606e', '#7a8594', '#a6b0bc');
const GUARD_RUST = tn('#5a2c18', '#8a4424', '#b0643a', '#cc8656');
const EYE_CALM = hx('#6ff4e6');
const EYE_ANGRY = hx('#ff5a3a');
const EYE_OFF = hx('#3a4048');

type Arm = [number, number, number, number, number, number];

interface BotPose {
  /** Сдвиг корпуса вперёд (+) или назад. */
  lean: number;
  /** Корпус ниже на столько (присел). */
  sink: number;
  legF: number;
  legB: number;
  /** Плечо, локоть, кисть: дальняя и ближняя рука. */
  armB: Arm;
  armF: Arm;
  headDy: number;
  eye: RGBA;
  eyeBright?: boolean;
  tool?: 'shears-open' | 'shears' | 'hose' | 'flower' | 'blade' | null;
  steam?: number;
  /** Сидит на земле (страж спит). */
  seated?: boolean;
  /** Грудь открыта — ядро видно (страж остывает). */
  open?: boolean;
}

function claw(p: Px, x: number, y: number, t: Tones, dir = 1): void {
  p.set(x, y + 1, t[1]);
  p.set(x + dir, y + 1, t[2]);
  p.set(x - dir, y + 1, t[0]);
  p.set(x + dir, y + 2, t[0]);
  p.set(x - dir, y + 2, t[0]);
}

function armPx(p: Px, a: Arm, r: number, t: Tones, bias: number): void {
  limb(p, a[0], a[1], a[2], a[3], r * 1.15, r, t, bias);
  limb(p, a[2], a[3], a[4], a[5], r, r * 0.85, t, bias);
  shadeEll(p, a[2], a[3], r * 1.05, r * 1.05, t, bias + 0.1);
}

const STEEL = tn('#5c6470', '#9aa4b0', '#cfd6de', '#ffffff');

function tool(p: Px, kind: BotPose['tool'], x: number, y: number): void {
  if (!kind) return;
  if (kind === 'shears-open') {
    stroke(p, x, y, x + 5, y - 3, STEEL[2]);
    stroke(p, x, y + 1, x + 5, y + 3, STEEL[1]);
    p.set(x, y, GOLD[2]);
  } else if (kind === 'shears') {
    stroke(p, x, y, x + 6, y, STEEL[2]);
    stroke(p, x, y + 1, x + 5, y + 1, STEEL[1]);
    p.set(x, y, GOLD[2]);
  } else if (kind === 'hose') {
    p.rect(x, y - 1, x + 3, y + 1, GOLD[1]);
    p.rect(x, y - 1, x + 3, y - 1, GOLD[3]);
    p.set(x + 4, y, IRON[1]);
  } else if (kind === 'flower') {
    p.set(x + 1, y + 1, hx('#3c7a3a'));
    p.set(x + 1, y, hx('#f4f0ea'));
    p.set(x, y - 1, hx('#f4f0ea'));
    p.set(x + 2, y - 1, hx('#f4f0ea'));
    p.set(x + 1, y - 2, hx('#f4f0ea'));
    p.set(x + 1, y - 1, hx('#f6d24a'));
  } else if (kind === 'blade') {
    stroke(p, x, y, x + 4, y + 3, STEEL[3]);
    stroke(p, x + 1, y, x + 5, y + 2, STEEL[2]);
  }
}

/** Садовник: круглый корпус в мху, маленькая голова с одной линзой, длинные руки. */
function gardenerPx(q: BotPose, f: number): Built {
  const W = 28;
  const H = 32;
  const p = new Px(W, H);
  const gy = 30;
  const cx = 13 + q.lean;
  const cy = 17 + q.sink;
  // Дальняя рука — за корпусом.
  armPx(p, q.armB, 1.1, BOT, -0.25);
  claw(p, Math.round(q.armB[4]), Math.round(q.armB[5]), BOT, -1);
  // Ноги.
  limb(p, cx - 3, cy + 5, cx - 3 + q.legB, gy - 1, 2, 1.7, BOT, -0.15);
  limb(p, cx + 2, cy + 5, cx + 2 + q.legF, gy - 1, 2, 1.7, BOT, 0);
  shadeEll(p, cx - 3 + q.legB, gy - 0.5, 2.4, 1.3, BOT, -0.1);
  shadeEll(p, cx + 2.5 + q.legF, gy - 0.5, 2.4, 1.3, BOT);
  // Корпус: бочонок с поясом заклёпок и решёткой.
  shadeEll(p, cx, cy, 6.8, 7.6, BOT);
  for (let x = cx - 7; x <= cx + 7; x++) if (p.solid(x, cy + 1)) p.set(x, cy + 1, BOT_SEAM);
  for (let x = cx - 5; x <= cx + 5; x += 3) p.set(x, cy + 2, BOT[3]);
  for (let i = 0; i < 3; i++) p.rect(cx + 1, cy - 4 + i * 2, cx + 4, cy - 4 + i * 2, BOT_SEAM);
  // Мох на плечах и макушке корпуса, цветок.
  for (let i = 0; i < 26; i++) {
    const x = Math.round(cx - 6 + hash(i, 1, 711) * 12);
    const y = Math.round(cy - 8 + hash(i, 2, 712) * 4);
    if (p.solid(x, y) && !p.solid(x, y - 2)) p.set(x, y, MOSS[hash(i, 3, 713) < 0.5 ? 2 : 3]);
    else if (p.solid(x, y) && hash(i, 4, 714) < 0.4) p.set(x, y, MOSS[1]);
  }
  p.set(cx - 4, cy - 8, hx('#f4f0ea'));
  p.set(cx - 5, cy - 7, hx('#f4f0ea'));
  p.set(cx - 3, cy - 7, hx('#f4f0ea'));
  p.set(cx - 4, cy - 7, hx('#f6d24a'));
  // Голова — вперёд и чуть вниз от макушки.
  const hx0 = cx + 2.5;
  const hy0 = cy - 8.5 + q.headDy;
  shadeEll(p, hx0, hy0, 4.2, 3.3, BOT, 0.05);
  for (let x = Math.floor(hx0 - 4); x <= hx0 + 4; x++)
    if (p.solid(x, Math.round(hy0 + 2))) p.set(x, Math.round(hy0 + 2), BOT_SEAM);
  lens(p, hx0 + 1.8, hy0 - 0.2, 1.4, q.eye, q.eyeBright);
  // Ближняя рука и инструмент.
  armPx(p, q.armF, 1.15, BOT, 0.05);
  claw(p, Math.round(q.armF[4]), Math.round(q.armF[5]), BOT);
  tool(p, q.tool, Math.round(q.armF[4]), Math.round(q.armF[5]));
  const out = ink(p);
  if (q.steam) {
    puffs(out, hx0 - 3, hy0 - 3, f, 2, 2);
    puffs(out, hx0 + 3, hy0 - 3, f + 1.3, 2, 2);
  }
  return { p: out, ax: 13, ay: gy, eye: [Math.round(hx0 + 1.8), Math.round(hy0)] };
}

function gardenerDead(): Built {
  const p = new Px(30, 18);
  shadeEll(p, 13, 11, 7.5, 5, BOT);
  for (let x = 6; x < 21; x++) if (p.solid(x, 12)) p.set(x, 12, BOT_SEAM);
  shadeEll(p, 23, 12, 3.6, 3, BOT);
  lens(p, 24, 12, 1.2, EYE_OFF);
  limb(p, 8, 13, 3, 15, 1.1, 1, BOT);
  limb(p, 16, 14, 19, 16, 1.1, 1, BOT);
  for (let i = 0; i < 20; i++) {
    const x = Math.floor(hash(i, 1, 721) * 30);
    const y = Math.floor(hash(i, 2, 722) * 16);
    if (p.solid(x, y) && !p.solid(x, y - 1)) p.set(x, y, MOSS[2]);
  }
  return { p: ink(p), ax: 14, ay: 16, eye: null };
}

registerMobPainter('f11_gardener', (m: Mob, pose: MobPose) => {
  const angry = !!m.data.angry;
  const eye = angry ? EYE_ANGRY : EYE_CALM;
  const tag = angry ? 'a' : 'c';
  const base: BotPose = {
    lean: 0,
    sink: 0,
    legF: 0,
    legB: 0,
    armB: [8, 13, 6, 19, 5, 24],
    armF: [18, 13, 20, 19, 20, 24],
    headDy: 0,
    eye,
  };
  if (pose.mode === 'dying' || pose.anim === 'dead')
    return mobFrame('gard', pose, 'dead', gardenerDead);
  const f4 = ((pose.frame % 4) + 4) % 4;
  switch (pose.mode) {
    case 'f11_tend': {
      const f = Math.floor(pose.t * 1.6 + m.id) % 2;
      return mobFrame('gard', pose, `tend${f}`, () =>
        gardenerPx(
          {
            ...base,
            lean: 1,
            headDy: 1 + f * 0.5,
            armF: [18, 13, 22, 20, 23, 26 - f],
            tool: 'flower',
          },
          0,
        ),
      );
    }
    case 'f11_rage': {
      const f = Math.floor(pose.t * 8) % 2;
      return mobFrame('gard', pose, `rage${f}`, () =>
        gardenerPx(
          {
            ...base,
            eye: EYE_ANGRY,
            eyeBright: true,
            armB: [8, 13, 5, 8, 4 + f, 4],
            armF: [18, 13, 21, 8, 22 - f, 4],
            steam: 1,
          },
          f * 2,
        ),
      );
    }
    case 'f11_snip': {
      const strike = pose.t > GARDENER.snip - 0.18;
      if (!strike)
        return mobFrame('gard', pose, `snipw${tag}`, () =>
          gardenerPx(
            {
              ...base,
              lean: -1,
              eyeBright: true,
              armF: [18, 13, 20, 7, 16, 3],
              tool: 'shears-open',
            },
            0,
          ),
        );
      return mobFrame('gard', pose, `snips${tag}`, () =>
        gardenerPx(
          { ...base, lean: 2, legF: 2, legB: -1, armF: [19, 13, 22, 14, 25, 15], tool: 'shears' },
          0,
        ),
      );
    }
    case 'f11_hose': {
      const f = Math.floor(pose.t * 12) % 2;
      return mobFrame('gard', pose, `hose${f}${tag}`, () =>
        gardenerPx(
          { ...base, lean: 1, eyeBright: true, armF: [18, 13, 21, 15, 24, 14 + f], tool: 'hose' },
          0,
        ),
      );
    }
  }
  if (pose.anim === 'hurt')
    return mobFrame('gard', pose, `hurt${tag}`, () =>
      gardenerPx({ ...base, lean: -1, headDy: -1, eye: WHITE }, 0),
    );
  if (pose.anim === 'run') {
    const sw = [-2, 0, 2, 0][f4];
    return mobFrame('gard', pose, `run${f4}${tag}`, () =>
      gardenerPx(
        {
          ...base,
          sink: f4 % 2 ? -0.5 : 0,
          legF: sw,
          legB: -sw,
          armB: [8, 13, 6 - sw * 0.5, 19, 5 - sw, 24],
          armF: [18, 13, 20 + sw * 0.5, 19, 20 + sw, 24],
        },
        0,
      ),
    );
  }
  const b = f4 === 1 || f4 === 2 ? 0.5 : 0;
  return mobFrame('gard', pose, `idle${f4}${tag}`, () =>
    gardenerPx(
      {
        ...base,
        headDy: b,
        armB: [8, 13, 6, 19 + b, 5, 24 + b],
        armF: [18, 13, 20, 19 + b, 20, 24 + b],
      },
      0,
    ),
  );
});

/** Страж: шире, в латах и ржавчине, голова-шлем со щелью и красной линзой. */
function guardPx(q: BotPose, f: number): Built {
  const W = 30;
  const H = 34;
  const p = new Px(W, H);
  const gy = 32;
  const cx = 14 + q.lean;
  const cy = (q.seated ? 22 : 18) + q.sink;
  armPx(p, q.armB, 1.5, GUARD_T, -0.25);
  shadeEll(p, q.armB[4], q.armB[5], 1.8, 1.6, GUARD_T, -0.2);
  // Ноги: сидя — колени вперёд.
  if (q.seated) {
    limb(p, cx - 3, cy + 4, cx + 3, cy + 4, 2.2, 2, GUARD_T, -0.1);
    limb(p, cx + 3, cy + 4, cx + 5, gy - 1, 2, 1.8, GUARD_T, -0.05);
    limb(p, cx + 1, cy + 5, cx + 7, cy + 6, 2.2, 2, GUARD_T, 0.05);
    limb(p, cx + 7, cy + 6, cx + 8, gy - 1, 2, 1.8, GUARD_T, 0.05);
    shadeEll(p, cx + 6, gy - 0.5, 2.6, 1.3, GUARD_T);
    shadeEll(p, cx + 9, gy - 0.5, 2.6, 1.3, GUARD_T);
  } else {
    limb(p, cx - 3, cy + 6, cx - 3 + q.legB, gy - 1, 2.4, 2, GUARD_T, -0.15);
    limb(p, cx + 3, cy + 6, cx + 3 + q.legF, gy - 1, 2.4, 2, GUARD_T, 0);
    shadeEll(p, cx - 3 + q.legB, gy - 0.5, 2.8, 1.4, GUARD_T, -0.1);
    shadeEll(p, cx + 3.5 + q.legF, gy - 0.5, 2.8, 1.4, GUARD_T);
  }
  // Корпус: широкая кираса.
  shadeEll(p, cx, cy, 8, 8.4, GUARD_T);
  for (let x = cx - 8; x <= cx + 8; x++) if (p.solid(x, cy + 2)) p.set(x, cy + 2, IRON[0]);
  for (let x = cx - 6; x <= cx + 6; x += 3) p.set(x, cy + 3, GUARD_T[3]);
  // Нагрудник: пластина, под которой ядро.
  if (q.open) {
    p.ell(cx + 2, cy - 2, 3.4, 3, IRON[0]);
    p.ell(cx + 2, cy - 2, 2.4, 2.1, hx('#ff9a3a'));
    p.ell(cx + 1.6, cy - 2.4, 1.2, 1, hx('#fff0b0'));
    p.rect(cx - 3, cy - 6, cx - 1, cy + 1, GUARD_T[1]);
    p.rect(cx + 5, cy - 6, cx + 7, cy + 1, GUARD_T[1]);
  } else {
    polyShade(
      p,
      [
        [cx - 2, cy - 6],
        [cx + 6, cy - 6],
        [cx + 6, cy + 1],
        [cx + 2, cy + 3],
        [cx - 2, cy + 1],
      ],
      GUARD_T,
      0.15,
    );
    p.set(cx + 2, cy - 2, hx('#c83a2a'));
  }
  // Ржавчина — тремя подтёками от швов вниз, а не сыпью.
  for (const [rx0, ry0] of [
    [cx - 6, cy + 3],
    [cx + 4, cy + 3],
    [cx - 3, cy - 5],
  ])
    for (let k = 0; k < 4; k++) {
      if (p.solid(rx0, ry0 + k)) p.set(rx0, ry0 + k, GUARD_RUST[k < 2 ? 1 : 0]);
      if (k < 2 && p.solid(rx0 + 1, ry0 + k)) p.set(rx0 + 1, ry0 + k, GUARD_RUST[0]);
    }
  // Наплечники.
  shadeEll(p, cx - 7, cy - 5, 3.2, 2.4, GUARD_T, 0.1);
  shadeEll(p, cx + 7, cy - 5, 3.2, 2.4, GUARD_T, 0.1);
  // Шлем со щелью.
  const hx0 = cx + 2;
  const hy0 = cy - 9.5 + q.headDy;
  shadeEll(p, hx0, hy0, 4.6, 3.8, GUARD_T, 0.1);
  p.rect(Math.round(hx0 - 3), Math.round(hy0), Math.round(hx0 + 4), Math.round(hy0), IRON[0]);
  p.set(Math.round(hx0), Math.round(hy0 - 4), GUARD_T[3]);
  p.set(Math.round(hx0), Math.round(hy0 - 5), hx('#c83a2a'));
  lens(p, hx0 + 2, hy0, 1.5, q.eye, q.eyeBright);
  // Ближняя рука — с клинком.
  armPx(p, q.armF, 1.6, GUARD_T, 0.05);
  shadeEll(p, q.armF[4], q.armF[5], 2, 1.8, GUARD_T, 0.1);
  tool(p, q.tool, Math.round(q.armF[4]) + 1, Math.round(q.armF[5]));
  // Мох на спящем.
  if (q.seated && !q.eyeBright)
    for (let i = 0; i < 30; i++) {
      const x = Math.floor(hash(i, 1, 741) * W);
      const y = Math.floor(hash(i, 2, 742) * H);
      if (p.solid(x, y) && !p.solid(x, y - 1)) p.set(x, y, MOSS[hash(i, 3, 743) < 0.5 ? 2 : 3]);
    }
  const out = ink(p);
  // Прицел: блик линзы крестом.
  if (q.eyeBright && q.eye === EYE_ANGRY && f > 0) {
    const ex = Math.round(hx0 + 2);
    const ey = Math.round(hy0);
    const flare = hx('#ffb0a0');
    for (let k = 2; k <= 3 + f; k++) {
      out.set(ex + k, ey, alpha(flare, 0.8 - k * 0.1));
      out.set(ex - k, ey, alpha(flare, 0.8 - k * 0.1));
      out.set(ex, ey - k, alpha(flare, 0.7 - k * 0.1));
      out.set(ex, ey + k, alpha(flare, 0.7 - k * 0.1));
    }
  }
  if (q.steam) {
    puffs(out, cx - 6, cy - 8, f, 3, 3);
    puffs(out, cx + 7, cy - 8, f + 0.6, 3, 3);
  }
  return { p: out, ax: 14, ay: gy, eye: [Math.round(hx0 + 2), Math.round(hy0)] };
}

function guardDead(): Built {
  const p = new Px(34, 20);
  shadeEll(p, 14, 12, 9, 6, GUARD_T);
  for (let i = 0; i < 16; i++) {
    const x = Math.round(6 + hash(i, 1, 751) * 16);
    const y = Math.round(7 + hash(i, 2, 752) * 10);
    if (p.solid(x, y)) p.set(x, y, GUARD_RUST[1]);
  }
  shadeEll(p, 26, 13, 4.2, 3.4, GUARD_T);
  lens(p, 27, 13, 1.3, EYE_OFF);
  limb(p, 8, 14, 2, 17, 1.6, 1.4, GUARD_T);
  limb(p, 18, 15, 22, 18, 1.6, 1.4, GUARD_T);
  const out = ink(p);
  puffs(out, 14, 7, 1.2, 2, 2);
  return { p: out, ax: 15, ay: 18, eye: null };
}

registerMobPainter('f11_guard', (_m: Mob, pose: MobPose) => {
  const base: BotPose = {
    lean: 0,
    sink: 0,
    legF: 0,
    legB: 0,
    armB: [7, 14, 5, 20, 5, 26],
    armF: [21, 14, 23, 20, 23, 26],
    headDy: 0,
    eye: EYE_ANGRY,
    tool: 'blade',
  };
  if (pose.mode === 'dying' || pose.anim === 'dead')
    return mobFrame('guard', pose, 'dead', guardDead);
  const f4 = ((pose.frame % 4) + 4) % 4;
  switch (pose.mode) {
    case 'f11_dormant':
      return mobFrame('guard', pose, 'dormant', () =>
        guardPx(
          {
            ...base,
            seated: true,
            headDy: 2,
            eye: EYE_OFF,
            armB: [7, 18, 6, 24, 8, 29],
            armF: [21, 18, 22, 24, 20, 29],
            tool: null,
          },
          0,
        ),
      );
    case 'f11_post': {
      const f = Math.floor(pose.t * 1.2) % 2;
      return mobFrame('guard', pose, `post${f}`, () =>
        guardPx({ ...base, eye: f ? hx('#ffb040') : hx('#c87a30') }, 0),
      );
    }
    case 'f11_rise': {
      const f = pose.t < 0.4 ? 0 : 1;
      return mobFrame('guard', pose, `rise${f}`, () =>
        f === 0
          ? guardPx(
              {
                ...base,
                seated: true,
                eyeBright: true,
                armB: [7, 18, 5, 23, 6, 28],
                armF: [21, 18, 24, 22, 25, 27],
              },
              0,
            )
          : guardPx({ ...base, sink: 3, legF: 2, legB: -2, eyeBright: true, steam: 1 }, 1),
      );
    }
    case 'f11_aim': {
      const k = Math.min(1, pose.t / (GUARD.track + GUARD.lock));
      const f = 1 + Math.min(3, Math.floor(k * 4));
      return mobFrame('guard', pose, `aim${f}`, () =>
        guardPx(
          { ...base, lean: 1, headDy: 0.5, eyeBright: true, armF: [21, 14, 24, 18, 24, 23] },
          f,
        ),
      );
    }
    case 'f11_vent': {
      const f = Math.floor(pose.t * 6) % 4;
      return mobFrame('guard', pose, `vent${f}`, () =>
        guardPx(
          {
            ...base,
            sink: 1.5,
            headDy: 2,
            eye: EYE_OFF,
            open: true,
            steam: 1,
            armB: [7, 14, 4, 20, 4, 27],
            armF: [21, 14, 24, 20, 24, 27],
          },
          f,
        ),
      );
    }
    case 'f11_bash': {
      const strike = pose.t > GUARD.bash - 0.2;
      if (!strike)
        return mobFrame('guard', pose, 'bashw', () =>
          guardPx({ ...base, lean: -1, eyeBright: true, armF: [21, 14, 22, 7, 17, 3] }, 0),
        );
      return mobFrame('guard', pose, 'bashs', () =>
        guardPx(
          { ...base, lean: 2, legF: 3, legB: -2, eyeBright: true, armF: [21, 14, 25, 17, 27, 23] },
          0,
        ),
      );
    }
  }
  if (pose.anim === 'hurt')
    return mobFrame('guard', pose, 'hurt', () =>
      guardPx({ ...base, lean: -1, headDy: -1, eye: WHITE }, 0),
    );
  if (pose.anim === 'run') {
    const sw = [-2, 0, 2, 0][f4];
    return mobFrame('guard', pose, `run${f4}`, () =>
      guardPx(
        {
          ...base,
          sink: f4 % 2 ? -0.5 : 0,
          legF: sw,
          legB: -sw,
          armB: [7, 14, 5 - sw * 0.5, 20, 5 - sw, 26],
          armF: [21, 14, 23 + sw * 0.5, 20, 23 + sw, 26],
        },
        0,
      ),
    );
  }
  return mobFrame('guard', pose, `idle${f4 >> 1}`, () =>
    guardPx({ ...base, headDy: f4 >> 1 ? 0.5 : 0 }, 0),
  );
});

/** Наложить готовый (уже обведённый) рисунок поверх. */
function over(dst: Px, src: Px, ox = 0, oy = 0): void {
  for (let y = 0; y < src.h; y++)
    for (let x = 0; x < src.w; x++) {
      const c = src.get(x, y);
      if (c[3]) dst.set(x + ox, y + oy, c);
    }
}

// --- Гарпия --------------------------------------------------------------------

const FEATH = tn('#4a2e22', '#7a4a30', '#a8703f', '#d49c62');
const FEATH_TIP = tn('#1e5a5e', '#2c8088', '#48a8ac', '#7cd0cc');
const SKIN = tn('#9a6248', '#c8866a', '#e8ae8e', '#f8d2b4');
const HAIR = tn('#1a3c40', '#28585c', '#3a787a', '#5a9c98');
const TALON = tn('#6a5a20', '#a88c30', '#d8b848', '#f4dc80');

/** Крыло: кость от плеча, веер маховых от запястья, кроющие по кости. */
function wing(
  p: Px,
  sx: number,
  sy: number,
  s: number,
  a: number,
  len: number,
  spread: number,
  bias: number,
): void {
  const wx = sx + s * Math.cos(a) * len * 0.5;
  const wy = sy - Math.sin(a) * len * 0.5;
  // Маховые — веером, длиннее к краю.
  for (let i = 0; i < 5; i++) {
    const fa = a - 0.35 - i * spread;
    const fl = len * (0.62 + 0.1 * (4 - i) * 0.5);
    const ex = wx + s * Math.cos(fa) * fl;
    const ey = wy - Math.sin(fa) * fl;
    limb(p, wx, wy, ex, ey, 1.3, 0.5, i % 2 ? FEATH : FEATH, bias - i * 0.05);
    p.set(Math.round(ex), Math.round(ey), FEATH_TIP[2]);
    p.set(Math.round(ex - s * Math.cos(fa)), Math.round(ey + Math.sin(fa)), FEATH_TIP[1]);
  }
  // Кость и кроющие.
  limb(p, sx, sy, wx, wy, 1.8, 1.4, FEATH, bias + 0.15);
  for (let k = 0; k < 3; k++) {
    const t = 0.25 + k * 0.3;
    const x = sx + (wx - sx) * t;
    const y = sy + (wy - sy) * t;
    shadeEll(p, x, y + 1.2, 1.6, 1.3, FEATH, bias + 0.1);
  }
}

interface HarpyPose {
  a: number;
  len: number;
  spread: number;
  /** Ноги: 0 — висят, 1 — когти вперёд. */
  claw: number;
  tilt: number;
  eye: RGBA;
  hurt?: boolean;
  perch?: boolean;
  speed?: boolean;
}

function harpyPx(q: HarpyPose): Built {
  const W = 34;
  const H = 30;
  const p = new Px(W, H);
  const cx = 17 + q.tilt;
  const cy = 14;
  // Дальнее крыло.
  if (!q.perch) wing(p, cx - 2, cy - 2, -1, q.a, q.len, q.spread, -0.2);
  // Хвост.
  for (let i = 0; i < 3; i++)
    limb(p, cx - 1, cy + 5, cx - 5 + i * 2, cy + 11 - Math.abs(i - 1), 1.3, 0.6, FEATH, -0.1);
  // Ноги.
  const lx = q.claw ? cx + 5 : cx + 1;
  const ly = q.claw ? cy + 7 : cy + 11;
  limb(p, cx, cy + 5, lx - 1, ly, 1.4, 0.8, TALON, -0.1);
  limb(p, cx + 2, cy + 5, lx + 2, ly - (q.claw ? 1 : 0), 1.4, 0.8, TALON);
  for (const x of [lx - 1, lx + 2]) {
    p.set(Math.round(x) - 1, ly + 1, INK);
    p.set(Math.round(x) + 1, ly + 1, INK);
    p.set(Math.round(x), ly + 1, INK);
  }
  // Тело: пёрышки снизу, кожа сверху.
  shadeEll(p, cx + 1, cy + 3, 3.8, 3.6, FEATH, 0.05);
  shadeEll(p, cx + 1, cy - 1, 3, 3.2, SKIN, 0.05);
  for (let i = 0; i < 6; i++) p.set(cx - 2 + i, cy + 1 + (i % 2), FEATH[3]);
  // Голова и волосы-перья, откинутые назад.
  const hx0 = cx + 2 + (q.hurt ? -1 : 0);
  const hy0 = cy - 6 + (q.hurt ? -1 : 0);
  polyShade(
    p,
    [
      [hx0 - 1, hy0 - 4],
      [hx0 + 3, hy0 - 3.5],
      [hx0 + 1, hy0 - 1],
      [hx0 - 4, hy0 + 2],
      [hx0 - 8, hy0 + 5],
      [hx0 - 5, hy0 + 1],
      [hx0 - 3, hy0 - 2],
    ],
    HAIR,
  );
  shadeEll(p, hx0 + 0.5, hy0, 2.8, 2.9, SKIN, 0.1);
  polyShade(
    p,
    [
      [hx0 - 2.5, hy0 - 2.8],
      [hx0 + 3, hy0 - 3],
      [hx0 + 2.5, hy0 - 1.5],
      [hx0 - 1, hy0 - 1],
    ],
    HAIR,
    0.1,
  );
  p.set(hx0 - 7, hy0 + 5, FEATH_TIP[2]);
  p.set(hx0 - 5, hy0 + 3, FEATH_TIP[2]);
  // Глаз хищной птицы и рот.
  p.set(hx0 + 2, hy0, q.eye);
  p.set(hx0 + 1, hy0, INK);
  p.set(hx0 + 2, hy0 + 2, SKIN[0]);
  // Ближнее крыло (или сложенные — плащом).
  if (q.perch) {
    polyShade(
      p,
      [
        [cx - 3, cy - 3],
        [cx + 5, cy - 3],
        [cx + 5, cy + 6],
        [cx + 1, cy + 9],
        [cx - 4, cy + 7],
      ],
      FEATH,
    );
    for (let y = cy - 1; y <= cy + 7; y += 2) p.set(cx + 4, y, FEATH_TIP[2]);
  } else wing(p, cx + 3, cy - 2, 1, q.a, q.len, q.spread, 0.05);
  const out = ink(p);
  if (q.speed)
    for (let i = 0; i < 4; i++)
      for (let x = 0; x < 6; x++) out.set(x + i, 6 + i * 4, alpha(WHITE, 0.2 + x * 0.06));
  return { p: out, ax: 17, ay: H - 2, eye: [hx0 + 2, hy0] };
}

registerMobPainter('f11_harpy', (m: Mob, pose: MobPose) => {
  const base: HarpyPose = { a: 0.4, len: 12, spread: 0.2, claw: 0, tilt: 0, eye: hx('#f6c83a') };
  if (pose.mode === 'dying' || pose.anim === 'dead')
    return mobFrame('harpy', pose, 'dead', () =>
      harpyPx({ ...base, a: -1, len: 10, spread: 0.1, hurt: true, eye: INK }),
    );
  switch (pose.mode) {
    case 'f11_perch':
      return mobFrame('harpy', pose, `perch${Math.floor(pose.t * 0.8 + m.id) % 2}`, () =>
        harpyPx({ ...base, perch: true, claw: 0, tilt: Math.floor(pose.t * 0.8 + m.id) % 2 }),
      );
    case 'f11_flap': {
      const f = Math.floor(pose.t * 10) % 2;
      return mobFrame('harpy', pose, `flap${f}`, () =>
        harpyPx({ ...base, a: f ? 0.7 : -0.2, len: 14, spread: 0.27, eye: hx('#ffe060') }),
      );
    }
    case 'f11_claw':
      return mobFrame('harpy', pose, 'claw', () =>
        harpyPx({ ...base, a: 1.25, len: 13, claw: 1, tilt: -1, eye: hx('#ff6a3a') }),
      );
    case 'f11_lunge':
      return mobFrame('harpy', pose, 'lunge', () =>
        harpyPx({
          ...base,
          a: 1.45,
          len: 11,
          spread: 0.12,
          claw: 1,
          tilt: 1,
          eye: hx('#ff6a3a'),
          speed: true,
        }),
      );
  }
  if (pose.anim === 'hurt')
    return mobFrame('harpy', pose, 'hurt', () =>
      harpyPx({ ...base, a: -0.3, hurt: true, eye: WHITE }),
    );
  const f = ((Math.floor((paintSim()?.time ?? 0) * 8 + m.id * 1.3) % 4) + 4) % 4;
  const A = [1.05, 0.45, -0.35, 0.3][f];
  return mobFrame('harpy', pose, `fly${f}`, () =>
    harpyPx({ ...base, a: A, len: 12 + (f === 2 ? 1 : 0) }),
  );
});

// --- Облачная медуза -------------------------------------------------------------

const JELLY_T = tn('#7a90b8', '#b4c6e6', '#dce6f6', '#ffffff');
const ZAP = hx('#fff27a');

function jellyPx(f: number, zap: number, dim: boolean): Built {
  const W = 26;
  const H = 32;
  const p = new Px(W, H);
  const cx = 13;
  const cy = 11;
  const a = dim ? 0.55 : 0.82;
  // Купол: верх полукругом, край фестонами.
  const rx = 8.5 + (f % 2) * 0.4;
  const ry = 7.5 - (f % 2) * 0.4;
  for (let y = Math.floor(cy - ry - 1); y <= cy + 5; y++)
    for (let x = Math.floor(cx - rx - 1); x <= cx + rx + 1; x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      const rim = cy + 2.5 + Math.abs(Math.sin((x - cx) * 0.9)) * 1.6;
      if (dx * dx + (dy < 0 ? dy * dy : 0) > 1 || y > rim) continue;
      const nz = Math.sqrt(Math.max(0, 1 - dx * dx - Math.min(1, dy * dy)));
      const l = dx * LX + dy * LY + nz * LZ + 0.15;
      const c = zap ? mixc(tone(JELLY_T, l), ZAP, 0.35) : tone(JELLY_T, l);
      p.set(x, y, alpha(c, a));
    }
  // Облачка внутри купола.
  for (const [ox, oy, r] of [
    [-3, -1, 2.2],
    [1, -3, 2.6],
    [3.5, 0, 2],
  ] as const)
    p.ell(cx + ox, cy + oy, r, r * 0.8, alpha(WHITE, dim ? 0.35 : 0.6));
  // Молния внутри — при разряде.
  if (zap) {
    let x = cx - 4;
    let y = cy - 2 + (f % 2);
    for (let k = 0; k < 8; k++) {
      p.set(x, y, ZAP);
      x += 1;
      y += k % 2 ? -1 : 1;
    }
  }
  // Глазки.
  p.set(cx - 2, cy + 1, alpha(INK, 0.8));
  p.set(cx + 2, cy + 1, alpha(INK, 0.8));
  const out = ink(p, hx('#44557a'));
  // Щупальца — после контура: тонкие и полупрозрачные, тёмная и светлая
  // нить через одну, чтобы читались и на светлой траве, и на небе.
  for (let i = 0; i < 5; i++) {
    const x0 = cx + (i - 2) * 2.8;
    let px = x0;
    let py = cy + 4;
    const long = 13 + ((i * 7) % 3);
    for (let k = 0; k < long; k++) {
      const t = k / long;
      px = x0 + Math.sin(k * 0.55 + f * 1.3 + i * 1.7) * 1.4 * t + (i - 2) * t * 0.9;
      py = cy + 4 + k;
      const c = zap && (k + f + i) % 3 === 0 ? ZAP : i % 2 ? hx('#7c9ccc') : hx('#9ab8e4');
      out.set(Math.round(px), Math.round(py), alpha(c, a * (1 - t * 0.45)));
    }
    out.set(Math.round(px), Math.round(py) + 1, alpha(zap ? ZAP : CYAN, 0.9));
  }
  return { p: out, ax: cx, ay: H - 2, eye: [cx + 2, cy + 1] };
}

registerMobPainter('f11_jelly', (m: Mob, pose: MobPose) => {
  if (pose.mode === 'dying' || pose.anim === 'dead')
    return mobFrame('jelly', pose, 'dead', () => jellyPx(1, 0, true));
  if (pose.mode === 'f11_zap') {
    const on = pose.t > JELLY.zap - 0.25;
    const f = Math.floor(pose.t * (on ? 20 : 10)) % 2;
    return mobFrame('jelly', pose, `zap${on ? 1 : 0}${f}`, () =>
      jellyPx(f + (on ? 2 : 0), on ? 1 : f, false),
    );
  }
  if (pose.mode === 'recover') return mobFrame('jelly', pose, 'rest', () => jellyPx(1, 0, true));
  if (pose.anim === 'hurt') return mobFrame('jelly', pose, 'hurt', () => jellyPx(0, 0, true));
  const f = ((Math.floor((paintSim()?.time ?? 0) * 4 + m.id) % 6) + 6) % 6;
  return mobFrame('jelly', pose, `idle${f}`, () => jellyPx(f, 0, false));
});

// --- Абордажник с крюком ----------------------------------------------------------

const COAT = tn('#4a1e1e', '#7a2e28', '#a8443a', '#c8664e');
const PANTS = tn('#2e2a26', '#4a4238', '#6a5e4e', '#8a7c66');
const SCARF = tn('#a86a10', '#e0a020', '#f4c84a', '#ffe890');
const LEATHER = tn('#3a2616', '#5a3a22', '#7a5230', '#9a6e44');

interface BoarderPose {
  legF: number;
  legB: number;
  lean: number;
  armB: Arm;
  armF: Arm;
  hook: [number, number] | null;
  /** Верёвка от руки к крюку / за край кадра. */
  rope?: boolean;
  blade?: 'up' | 'down' | null;
  scarf: number;
}

function boarderPx(q: BoarderPose): Built {
  const W = 30;
  const H = 30;
  const p = new Px(W, H);
  const gy = 28;
  const cx = 13 + q.lean;
  // Шарф — за спиной, треплется по ветру.
  for (let i = 0; i < 7; i++) {
    const x = cx - 2 - i;
    const y = 10 + Math.round(Math.sin(i * 0.9 + q.scarf) * 1.2) + i * 0.3;
    p.set(x, y, SCARF[i < 3 ? 2 : 1]);
    p.set(x, y + 1, SCARF[0]);
  }
  // Сложенный планер за спиной.
  polyShade(
    p,
    [
      [cx - 5, 9],
      [cx - 2, 8],
      [cx - 1, 17],
      [cx - 4, 18],
    ],
    tn('#6a2a20', '#9a4430', '#c06a48', '#e09a70'),
  );
  armPx(p, q.armB, 1.1, COAT, -0.25);
  // Ноги в сапогах.
  limb(p, cx - 1, 19, cx - 1 + q.legB, gy - 2, 1.6, 1.3, PANTS, -0.15);
  limb(p, cx + 2, 19, cx + 2 + q.legF, gy - 2, 1.6, 1.3, PANTS);
  shadeEll(p, cx - 1 + q.legB, gy - 1, 2, 1.4, LEATHER, -0.1);
  shadeEll(p, cx + 2.5 + q.legF, gy - 1, 2, 1.4, LEATHER);
  // Куртка с полами, ремень.
  polyShade(
    p,
    [
      [cx - 3, 11],
      [cx + 4, 11],
      [cx + 5, 21],
      [cx + 1, 20],
      [cx - 4, 21],
    ],
    COAT,
  );
  p.rect(cx - 3, 17, cx + 4, 17, LEATHER[0]);
  p.set(cx + 1, 17, GOLD[2]);
  // Моток верёвки на поясе.
  p.ell(cx - 2, 18.5, 1.6, 1.2, ROPE[2]);
  p.set(cx - 2, 18, ROPE[0]);
  // Голова: кожаный шлем и очки.
  const hx0 = cx + 1.5;
  const hy0 = 7;
  shadeEll(p, hx0, hy0, 3.2, 3.2, SKIN, 0.05);
  polyShade(
    p,
    [
      [hx0 - 3.5, hy0],
      [hx0 - 3, hy0 - 3.5],
      [hx0 + 2, hy0 - 4],
      [hx0 + 3.6, hy0 - 1.5],
      [hx0 + 3.6, hy0 - 1],
      [hx0 - 1, hy0 - 1],
      [hx0 - 2, hy0 + 3],
      [hx0 - 3.5, hy0 + 3],
    ],
    LEATHER,
    0.1,
  );
  p.set(Math.round(hx0 + 2), Math.round(hy0 - 1), GOLD[2]);
  p.set(Math.round(hx0 + 3), Math.round(hy0 - 1), CYAN);
  p.set(Math.round(hx0 + 1), Math.round(hy0 - 1), CYAN);
  p.set(Math.round(hx0 + 2), Math.round(hy0 + 1), INK);
  p.set(Math.round(hx0 + 1), Math.round(hy0 + 2), SKIN[0]);
  // Шарф на шее.
  p.rect(Math.round(hx0 - 2), 10, Math.round(hx0 + 2), 11, SCARF[2]);
  // Ближняя рука, сабля или крюк.
  armPx(p, q.armF, 1.15, COAT, 0.05);
  const hx1 = Math.round(q.armF[4]);
  const hy1 = Math.round(q.armF[5]);
  p.set(hx1, hy1, SKIN[2]);
  if (q.blade === 'up') {
    stroke(p, hx1, hy1, hx1 - 2, hy1 - 7, STEEL[3]);
    stroke(p, hx1 + 1, hy1, hx1 - 1, hy1 - 7, STEEL[1]);
    p.set(hx1, hy1 + 1, GOLD[2]);
  } else if (q.blade === 'down') {
    stroke(p, hx1, hy1, hx1 + 7, hy1 + 2, STEEL[3]);
    stroke(p, hx1, hy1 + 1, hx1 + 6, hy1 + 3, STEEL[1]);
    p.set(hx1 - 1, hy1, GOLD[2]);
  }
  if (q.hook) {
    const [kx, ky] = q.hook;
    if (q.rope) stroke(p, hx1, hy1, kx, ky, ROPE[1]);
    p.set(kx, ky, IRON[3]);
    p.set(kx + 1, ky, IRON[2]);
    p.set(kx + 1, ky + 1, IRON[2]);
    p.set(kx, ky + 2, IRON[2]);
    p.set(kx - 1, ky + 1, IRON[1]);
  }
  return { p: ink(p), ax: 13, ay: gy, eye: [Math.round(hx0 + 2), Math.round(hy0 - 1)] };
}

const BLANK: Built = { p: new Px(1, 1), ax: 0, ay: 0, eye: null };

registerMobPainter('f11_boarder', (m: Mob, pose: MobPose) => {
  const base: BoarderPose = {
    legF: 0,
    legB: 0,
    lean: 0,
    armB: [11, 12, 10, 16, 10, 20],
    armF: [16, 12, 18, 16, 18, 20],
    hook: [18, 22],
    scarf: 0,
  };
  // Подлёт рисует зона планера; сам он появляется, приземлившись.
  if (pose.mode === 'f11_land') return mobFrame('board', pose, 'land', () => BLANK);
  if (pose.mode === 'dying' || pose.anim === 'dead')
    return mobFrame('board', pose, 'dead', () =>
      boarderPx({
        ...base,
        lean: -2,
        legF: 4,
        legB: 3,
        armF: [16, 12, 20, 14, 23, 13],
        hook: null,
        scarf: 2,
      }),
    );
  const f4 = ((pose.frame % 4) + 4) % 4;
  switch (pose.mode) {
    case 'f11_aimhook': {
      const f = Math.floor(pose.t * 14) % 4;
      const a = (f / 4) * TAU;
      return mobFrame('board', pose, `aimhook${f}`, () =>
        boarderPx({
          ...base,
          lean: -1,
          armF: [16, 12, 18, 7, 17, 3],
          hook: [Math.round(17 + Math.cos(a) * 5), Math.round(2 + Math.sin(a) * 2)],
          rope: true,
          scarf: f,
        }),
      );
    }
    case 'f11_throw':
      return mobFrame('board', pose, 'throw', () =>
        boarderPx({
          ...base,
          lean: 2,
          legF: 2,
          legB: -2,
          armF: [16, 12, 20, 12, 24, 11],
          hook: null,
          scarf: 1,
        }),
      );
    case 'f11_reel': {
      const f = Math.floor(pose.t * 10) % 2;
      return mobFrame('board', pose, `reel${f}`, () =>
        boarderPx({
          ...base,
          lean: -2,
          legF: 3,
          legB: -1,
          armB: [11, 12, 14, 14, 16 - f, 15],
          armF: [16, 12, 19, 14, 21 - f * 2, 14],
          hook: [29, 14],
          rope: true,
          scarf: f + 2,
        }),
      );
    }
    case 'f11_slash': {
      const strike = pose.t > 0.35;
      return mobFrame('board', pose, strike ? 'slashs' : 'slashw', () =>
        strike
          ? boarderPx({
              ...base,
              lean: 2,
              legF: 3,
              legB: -2,
              armF: [16, 12, 20, 14, 22, 15],
              hook: null,
              blade: 'down',
              scarf: 1,
            })
          : boarderPx({
              ...base,
              lean: -1,
              armF: [16, 12, 17, 7, 15, 4],
              hook: null,
              blade: 'up',
              scarf: 0,
            }),
      );
    }
  }
  if (pose.anim === 'hurt')
    return mobFrame('board', pose, 'hurt', () => boarderPx({ ...base, lean: -2, scarf: 3 }));
  if (pose.anim === 'run') {
    const sw = [-2, 0, 2, 0][f4];
    return mobFrame('board', pose, `run${f4}`, () =>
      boarderPx({
        ...base,
        legF: sw,
        legB: -sw,
        lean: 1,
        armB: [11, 12, 10 + sw * 0.5, 16, 10 + sw, 20],
        armF: [16, 12, 18 - sw * 0.5, 16, 18 - sw, 20],
        hook: [Math.round(18 - sw), 22],
        scarf: f4,
      }),
    );
  }
  const t = paintSim()?.time ?? 0;
  const f = ((Math.floor(t * 3 + m.id) % 4) + 4) % 4;
  return mobFrame('board', pose, `idle${f}`, () => boarderPx({ ...base, scarf: f }));
});

// --- Мох-пружина -----------------------------------------------------------------

const BRASS = tn('#6a4a1a', '#a07a30', '#d0a84a', '#f4d884');

function springPx(
  len: number,
  h: number,
  sq: number,
  eyes: 'open' | 'angry' | 'closed' | 'peek',
  bend = 0,
  mound = false,
): Built {
  const W = 22;
  const H = 34;
  const p = new Px(W, H);
  const gy = 32;
  const cx = 11;
  const top = gy - 2 - h - len;
  // Пружина — после контура: кольца через два пикселя, у каждого своя
  // тёмная кромка снизу, иначе контур сливает витки в сплошной брусок.
  const coil = (out: Px): void => {
    if (len <= 0.5 || mound) return;
    const n = Math.max(2, Math.floor(len / 2) + 1);
    for (let k = 0; k < n; k++) {
      const t = n > 1 ? k / (n - 1) : 0;
      const x = Math.round(cx + bend * t * 3);
      const y = Math.round(gy - 2 - h - t * len);
      for (let dx = -3; dx <= 3; dx++) {
        if (out.get(x + dx, y)[3]) continue;
        out.set(x + dx, y, Math.abs(dx) === 3 ? BRASS[1] : dx < 0 ? BRASS[3] : BRASS[2]);
        out.set(x + dx, y + 1, BRASS[0]);
      }
      out.set(x - 4, y, INK);
      out.set(x + 4, y + 1, INK);
    }
  };
  // Шар мха (или плоская кочка, когда затаился).
  const bx = cx + bend * 3;
  const rx = 6.5 + sq;
  const ry = 5.2 - sq;
  const by = mound ? gy - 2 : top - ry + 1.5;
  if (mound) shadeEll(p, cx, gy - 2, 8, 3, MOSS, 0.1);
  else shadeEll(p, bx, by, rx, ry, MOSS, 0.05);
  // Кочки и травинки (только по мху, не по латуни).
  for (let i = 0; i < 36; i++) {
    const x = Math.floor(hash(i, 1, 761) * W);
    const y = Math.floor(hash(i, 2, 762) * H);
    if (!p.solid(x, y) || p.get(x, y)[0] > 120) continue;
    const up = !p.solid(x, y - 1);
    p.set(x, y, up ? MOSS[3] : hash(i, 3, 763) < 0.4 ? MOSS[0] : MOSS[2]);
    if (up && hash(i, 4, 764) < 0.35) p.set(x, y - 1, MOSS[3]);
  }
  const top0 = mound ? gy - 5 : Math.round(by - ry);
  p.set(Math.round(bx - 2), top0, hx('#f4f0ea'));
  p.set(Math.round(bx - 3), top0 + 1, hx('#f4f0ea'));
  p.set(Math.round(bx - 1), top0 + 1, hx('#f4f0ea'));
  p.set(Math.round(bx - 2), top0 + 1, hx('#e888a8'));
  // Глаза 2×2 со зрачком, рот.
  const ey = mound ? gy - 3 : Math.round(by);
  const ex = mound ? cx + 1 : Math.round(bx + 1);
  for (const dx of [0, 3]) {
    if (eyes === 'closed') {
      p.set(ex + dx, ey + 1, INK);
      p.set(ex + dx + 1, ey + 1, INK);
      continue;
    }
    p.rect(ex + dx, ey, ex + dx + 1, ey + 1, WHITE);
    p.set(ex + dx + 1, ey + (eyes === 'angry' ? 1 : 0), INK);
    if (eyes === 'angry') {
      p.set(ex + dx, ey - 1, INK);
      p.set(ex + dx + 1, ey - 1, INK);
    }
  }
  if (!mound) {
    p.set(ex + 2, ey + 3, eyes === 'angry' ? INK : MOSS[0]);
    p.set(ex + 3, ey + 3, eyes === 'angry' ? INK : MOSS[0]);
  }
  const out = ink(p);
  coil(out);
  return { p: out, ax: cx, ay: gy, eye: [ex + 1, ey] };
}

registerMobPainter('f11_moss', (m: Mob, pose: MobPose) => {
  if (pose.mode === 'dying' || pose.anim === 'dead')
    return mobFrame('moss', pose, 'dead', () => springPx(1, 0, 1.5, 'closed', 1));
  switch (pose.mode) {
    case 'f11_hide':
      return mobFrame(
        'moss',
        pose,
        `hide${Math.floor(pose.t * 0.7 + m.id) % 3 === 0 ? 1 : 0}`,
        () =>
          springPx(0, 0, 0, Math.floor(pose.t * 0.7 + m.id) % 3 === 0 ? 'closed' : 'peek', 0, true),
      );
    case 'f11_pop': {
      const f = Math.min(3, Math.floor(pose.t * 10));
      return mobFrame('moss', pose, `pop${f}`, () =>
        springPx([1, 6, 5, 3][f], [0, 3, 1, 0][f], [1, -1, -0.5, 0][f], 'angry'),
      );
    }
    case 'f11_crouch': {
      const f = pose.t < MOSS_AI.crouch * 0.5 ? 0 : 1;
      return mobFrame('moss', pose, `crouch${f}`, () =>
        springPx(f ? 0.8 : 1.6, 0, f ? 1.6 : 1, 'angry'),
      );
    }
    case 'f11_jump': {
      const k = Math.min(1, pose.t / MOSS_AI.air);
      const f = Math.min(5, Math.floor(k * 6));
      const h = Math.round(Math.sin(((f + 0.5) / 6) * PI) * 9);
      return mobFrame('moss', pose, `jump${f}`, () =>
        springPx(f < 3 ? 6 : 4, h, f < 2 ? -1 : 0, 'angry'),
      );
    }
    case 'f11_tired': {
      const f = Math.floor(pose.t * 2) % 2;
      return mobFrame('moss', pose, `tired${f}`, () => springPx(2, 0, 1 + f * 0.3, 'closed', 1));
    }
  }
  if (pose.anim === 'hurt')
    return mobFrame('moss', pose, 'hurt', () => springPx(2, 0, 1.2, 'closed'));
  const f4 = ((pose.frame % 4) + 4) % 4;
  return mobFrame('moss', pose, `idle${f4}`, () =>
    springPx([3, 4, 3, 2][f4], 0, [0, -0.5, 0, 0.6][f4], 'open'),
  );
});

// --- Ветряной дух ----------------------------------------------------------------

function spiritPx(f: number, cast: boolean, dim: boolean): Built {
  const W = 30;
  const H = 32;
  const p = new Px(W, H);
  const cx = 15;
  const a = dim ? 0.45 : 0.85;
  // Тело — прозрачная воронка: сверху шире (капюшон над маской), книзу —
  // в нитку. Даёт духу вес на светлой траве, где белые ленты пропадают.
  for (let y = 4; y < 29; y++) {
    const k = (y - 4) / 25;
    const w = (cast ? 8 : 6.2) * (1 - k * 0.85) + 0.6;
    const sway = Math.sin(k * 5 + f * 0.9) * 2 * k;
    for (let x = Math.floor(cx - w + sway); x <= cx + w + sway; x++) {
      const e = Math.abs(x - cx - sway) / w;
      p.set(
        x,
        y,
        alpha(e > 0.75 ? hx('#3a8aa8') : hx('#9ad8ec'), (e > 0.75 ? 0.55 : 0.28) * (dim ? 0.6 : 1)),
      );
    }
  }
  // Вихрь: три ленты кругами вверх, в два пикселя у основания.
  for (let r = 0; r < 3; r++)
    for (let k = 0; k < 48; k++) {
      const th = (k / 48) * 2.6 * PI;
      const R = (cast ? 9 : 6.8) - th * (cast ? 0.9 : 0.72);
      if (R < 0.6) continue;
      const x = cx + Math.cos(th + f * 0.9 + (r * TAU) / 3) * R;
      const y = 26 - th * 2.1 + Math.sin(th + f * 0.9 + (r * TAU) / 3) * R * 0.3;
      const c = r === 0 ? hx('#2a86a8') : r === 1 ? WHITE : hx('#b8e8f4');
      const al = a * (0.55 + 0.45 * (k / 48));
      p.set(Math.round(x), Math.round(y), alpha(c, al));
      if (k < 20) p.set(Math.round(x), Math.round(y) + 1, alpha(c, al * 0.7));
    }
  // Руки-ленты при заклинании.
  if (cast)
    for (const s of [-1, 1])
      for (let k = 0; k < 10; k++) {
        const x = cx + s * (4 + k);
        const y = 13 + Math.sin(k * 0.8 + f) * 1.2;
        p.set(Math.round(x), Math.round(y), alpha(WHITE, 0.8 - k * 0.05));
      }
  // Маска.
  const m = new Px(W, H);
  const my = 10 + Math.round(Math.sin(f * 0.8) * 0.6);
  shadeEll(m, cx + 1, my, 3.6, 4.4, tn('#b8b4a8', '#e0dcd0', '#f4f2ea', '#ffffff'), 0.2);
  const eye = cast ? CYAN : INK;
  m.set(cx - 1, my - 1, eye);
  m.set(cx, my - 1, eye);
  m.set(cx + 2, my - 1, eye);
  m.set(cx + 3, my - 1, eye);
  m.set(cx + 1, my + 2, hx('#c83a4a'));
  m.set(cx + 1, my - 3, hx('#2c8088'));
  over(p, ink(m, hx('#3a5a78')));
  return { p, ax: cx, ay: H - 2, eye: [cx + 3, my - 1] };
}

registerMobPainter('f11_spirit', (m: Mob, pose: MobPose) => {
  const t = paintSim()?.time ?? 0;
  if (pose.mode === 'dying' || pose.anim === 'dead')
    return mobFrame('spirit', pose, 'dead', () => spiritPx(0, false, true));
  if (pose.mode === 'cast') {
    const f = (Math.floor(pose.t * (pose.t > SPIRIT.cast - 0.3 ? 18 : 10)) % 6) + 6;
    return mobFrame('spirit', pose, `cast${f % 6}`, () => spiritPx(f % 6, true, false));
  }
  const f = ((Math.floor(t * 7 + m.id) % 6) + 6) % 6;
  const dim = pose.mode === 'recover' || pose.anim === 'hurt';
  return mobFrame('spirit', pose, `idle${f}${dim ? 'd' : ''}`, () => spiritPx(f, false, dim));
});

// --- Дрон-разведчик --------------------------------------------------------------

const DRONE_T = tn('#5a4a2e', '#8a7244', '#b8985c', '#e0c486');

function dronePx(f: number, lensC: RGBA, fire: boolean): Built {
  const W = 20;
  const H = 22;
  const p = new Px(W, H);
  const cx = 10;
  const cy = 12;
  // Плавники снизу.
  limb(p, cx - 3, cy + 3, cx - 5, cy + 6, 1, 0.6, DRONE_T, -0.1);
  limb(p, cx + 3, cy + 3, cx + 5, cy + 6, 1, 0.6, DRONE_T);
  // Корпус-шар с поясом.
  shadeEll(p, cx, cy, 5, 4.6, DRONE_T);
  for (let x = cx - 5; x <= cx + 5; x++) if (p.solid(x, cy + 1)) p.set(x, cy + 1, IRON[1]);
  // Мачта.
  p.rect(cx, cy - 7, cx, cy - 4, IRON[2]);
  // Ствол и линза.
  p.rect(cx + 3, cy + 2, cx + 6, cy + 2, IRON[1]);
  lens(p, cx + 2.5, cy - 1, 1.5, lensC, true);
  const out = ink(p);
  // Винт: мутный диск и одна лопасть.
  for (let x = -7; x <= 7; x++)
    for (let y = -2; y <= 2; y++)
      if ((x * x) / 49 + (y * y) / 3 <= 1) out.set(cx + x, cy - 7 + y, alpha(WHITE, 0.18));
  const a = (f / 6) * PI;
  const bx = Math.cos(a) * 7;
  const by = Math.sin(a) * 1.6;
  stroke(out, cx - bx, cy - 7 - by, cx + bx, cy - 7 + by, alpha(IRON[3], 0.9));
  if (fire) {
    const fx = cx + 7;
    const fy = cy + 2;
    out.set(fx, fy, WHITE);
    out.set(fx + 1, fy, ZAP);
    out.set(fx, fy - 1, ZAP);
    out.set(fx, fy + 1, ZAP);
    out.set(fx + 2, fy, alpha(ZAP, 0.6));
  }
  return { p: out, ax: cx, ay: H - 2, eye: [cx + 3, cy - 1] };
}

registerMobPainter('f11_drone', (m: Mob, pose: MobPose) => {
  const t = paintSim()?.time ?? 0;
  const f = ((Math.floor(t * 24 + m.id) % 6) + 6) % 6;
  if (pose.mode === 'dying' || pose.anim === 'dead')
    return mobFrame('drone', pose, 'dead', () => dronePx(0, EYE_OFF, false));
  if (pose.mode === 'aim') {
    const b = Math.floor(pose.t * 12) % 2;
    return mobFrame('drone', pose, `aim${f}${b}`, () => dronePx(f, b ? WHITE : EYE_ANGRY, false));
  }
  if (pose.mode === 'f11_burst') {
    const b = Math.floor(pose.t * 16) % 2;
    return mobFrame('drone', pose, `burst${f}${b}`, () => dronePx(f, EYE_ANGRY, !!b));
  }
  return mobFrame('drone', pose, `idle${f}${pose.anim === 'hurt' ? 'h' : ''}`, () =>
    dronePx(f, pose.anim === 'hurt' ? WHITE : EYE_CALM, false),
  );
});

// --- Жук-копилка -----------------------------------------------------------------

function beetlePx(f: number, fly: boolean): Built {
  const W = 20;
  const H = 18;
  const p = new Px(W, H);
  const cx = 9;
  const cy = 10;
  // Лапки.
  for (let i = 0; i < 3; i++) {
    const x = cx - 3 + i * 3;
    const d = (i + f) % 2 ? 1 : -1;
    stroke(p, x, cy + 2, x + d, cy + 5, IRON[0]);
  }
  // Крылья — при побеге.
  if (fly)
    for (const s of [-1, 1])
      p.ell(cx + s * 5, cy - 4 - (f % 2), 4, 2.4, alpha(hx('#e8f4ff'), 0.55));
  // Панцирь-копилка.
  shadeEll(p, cx, cy, 6.2, 4.6, GOLD, 0.05);
  stroke(p, cx - 3, cy - 2, cx + 2, cy - 2, GOLD[0]);
  // Монета в щели.
  p.ell(cx - 0.5, cy - 3.5, 1.8, 1.1, GOLD[3]);
  p.set(cx - 1, cy - 4, WHITE);
  // Голова, усы, глаз.
  shadeEll(p, cx + 6, cy + 1, 2.2, 2, IRON, 0.1);
  stroke(p, cx + 7, cy - 1, cx + 10, cy - 4, IRON[1]);
  stroke(p, cx + 6, cy - 1, cx + 8, cy - 5, IRON[1]);
  p.set(cx + 7, cy + 1, WHITE);
  const out = ink(p);
  // Блеск золота.
  const sx = [cx - 4, cx + 2, cx - 1, cx + 4][f % 4];
  out.set(sx, cy - 1, WHITE);
  return { p: out, ax: cx, ay: H - 3, eye: [cx + 7, cy + 1] };
}

registerMobPainter('f11_beetle', (m: Mob, pose: MobPose) => {
  const t = paintSim()?.time ?? 0;
  const run = pose.mode === 'flee' || pose.anim === 'run';
  const f = ((Math.floor(t * (run ? 16 : 4) + m.id) % 4) + 4) % 4;
  if (pose.mode === 'dying' || pose.anim === 'dead')
    return mobFrame('beetle', pose, 'dead', () => beetlePx(0, false));
  if (pose.mode === 'escape') return mobFrame('beetle', pose, `fly${f}`, () => beetlePx(f, true));
  return mobFrame('beetle', pose, `walk${f}`, () => beetlePx(f, false));
});

// --- Щитовой пилон и Древний страж (v2.87) -----------------------------------------
//
// Великан-садовник, которого поставили охранять остров, когда тот ещё был
// крепостью: круглый корпус из древнего камня-бронзы, маленькая голова с
// одним глазом, руки до земли. На плечах за века вырос сад — мох, цветы и
// деревце. По телу бегут руны; в груди — ядро под плитой. Фазы видно:
// купол (2), плита ядра раздвинута и ядро пылает (3), трещины и красный глаз (4).
//
// v2.87 — тело заново, облик прежний. Страж собирается не из плоских поз, а
// маленьким трёхмерным ригом: шар корпуса, голова, руки и ноги на обратной
// кинематике (кисть и стопа — цели, локоть и колено находятся сами), сад,
// руны, плита ядра, люки и трещины лежат НА поверхности шара в осях тела.
// Поэтому страж честно поворачивается к герою (спереди, сбоку, со спины — в
// «Перегреве» видно, где ядро), вращение третьей фазы — настоящий поворот
// корпуса, а кулаки, ушедшие в пол, срезает земля. Рисует растр с z-буфером:
// части перекрывают друг друга по глубине, на стыке частей — тёмная линия.
//
// Каждая техника — ключевые позы рига с кривыми (подготовка → удар → проводка
// → возврат), кадр — 24 к/с от `pose.t`. Кадр контакта — ПЕРВЫЙ кадр
// `recover`: мозг бьёт и переводит стража в `recover` в одном шаге, так что
// поза удара встаёт ровно в миг урона. Кадры — в `frameLRU`, прогрев — первая
// фаза спереди и все стороны покоя.

const ANC = tn('#48443a', '#6a6856', '#928e76', '#b8b49a');
const ANC_SEAM = hx('#2c2a22');
const CORE_HOT = tn('#b04010', '#f08030', '#ffc060', '#fff4c0');
const AMBER = hx('#ffb040');
const FLOWER: RGBA[] = [hx('#f4f0ea'), hx('#e888a8'), hx('#f6d24a')];
const HOLE = hx('#140e0c');

type V3 = [number, number, number];
const vadd = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const vsub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vmul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const vdot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vlen = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const vnorm = (a: V3): V3 => {
  const l = vlen(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const vcross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const vlerp = (a: V3, b: V3, k: number): V3 => [
  a[0] + (b[0] - a[0]) * k,
  a[1] + (b[1] - a[1]) * k,
  a[2] + (b[2] - a[2]) * k,
];
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const clampR = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);

/** Поворот вокруг вертикали: «вперёд» (+Z) уходит к +X. */
function rotYv(v: V3, a: number): V3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
}
/** Наклон вперёд: верх (+Y) уходит к +Z. */
function rotXv(v: V3, a: number): V3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c];
}
/** Крен: верх уходит к +X. */
function rotZv(v: V3, a: number): V3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [v[0] * c + v[1] * s, -v[0] * s + v[1] * c, v[2]];
}

// Холст рига: точка земли под центром тела — (GOX, GOY). Камера смотрит
// спереди-сверху: наклон φ (sin 0,34). Модель — в пикселях игры: X вправо
// (спереди), Y вверх, Z — куда смотрит страж.
const GFPS = 24;
const GW = 116;
const GH = 104;
const GOX = 58;
const GOY = 94;
const SPH = 0.34;
const CPH = 0.94;
/** Центр корпуса над землёй и радиус шара. */
const HB = 27.6;
const BR = 15.5;
/** Голова — сплюснутый шар. */
const HRX = 7.4;
const HRY = 6.1;
/** Плечо и предплечье, бедро и голень. */
const LU = 15;
const LF = 13.2;
const LT = 8.6;
const LS = 8.4;

interface GCam {
  c: number;
  s: number;
}
const gcam = (yaw: number): GCam => ({ c: Math.cos(yaw), s: Math.sin(yaw) });

/** Точка корня (до поворота) → экран холста и глубина (больше — ближе к нам). */
function gproj(cam: GCam, p: V3): [number, number, number] {
  const xw = p[0] * cam.c + p[2] * cam.s;
  const zw = -p[0] * cam.s + p[2] * cam.c;
  return [GOX + xw, GOY - (p[1] * CPH - zw * SPH), p[1] * SPH + zw * CPH];
}
/** Нормаль экрана (ny — вниз) → оси корня. */
function gunproj(cam: GCam, nx: number, ny: number, nz: number): V3 {
  const up = -ny;
  const Y = up * CPH + nz * SPH;
  const zw = -up * SPH + nz * CPH;
  return [nx * cam.c - zw * cam.s, Y, nx * cam.s + zw * cam.c];
}

/** Буфер рига: цвет, свечение, глубина, номер части. */
interface GBuf {
  p: Px;
  lit: Px;
  z: Float32Array;
  id: Uint8Array;
  cam: GCam;
  /** Рамка нарисованного телом — проходы шва, контура и мха только в ней. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
const G_BODY = 1;
const G_HEAD = 2;
const G_ARML = 3;
const G_ARMR = 4;
const G_LEGL = 5;
const G_LEGR = 6;
const G_TREE = 7;
const G_TUBE = 8;
const G_LID = 9;

/** Буферы кадра — одни на все кадры: кадр копируется в свой холст сразу. */
const G_POOL = {
  p: new Px(GW, GH),
  lit: new Px(GW, GH),
  z: new Float32Array(GW * GH),
  id: new Uint8Array(GW * GH),
};
function gbuf(yaw: number): GBuf {
  G_POOL.z.fill(-1e9);
  G_POOL.id.fill(0);
  G_POOL.p.data.fill(0);
  G_POOL.lit.data.fill(0);
  return { ...G_POOL, cam: gcam(yaw), x0: GW, y0: GH, x1: -1, y1: -1 };
}

function gput(
  b: GBuf,
  x: number,
  y: number,
  d: number,
  c: RGBA,
  id: number,
  lc: RGBA | null,
): void {
  if (x < 0 || y < 0 || x >= GW || y >= GH) return;
  const i = y * GW + x;
  if (d <= b.z[i]) return;
  b.z[i] = d;
  b.id[i] = id;
  if (x < b.x0) b.x0 = x;
  if (x > b.x1) b.x1 = x;
  if (y < b.y0) b.y0 = y;
  if (y > b.y1) b.y1 = y;
  const o = i * 4;
  const D = b.p.data;
  D[o] = c[0];
  D[o + 1] = c[1];
  D[o + 2] = c[2];
  D[o + 3] = 255;
  const L = b.lit.data;
  if (lc && lc[3] > 0) {
    L[o] = lc[0];
    L[o + 1] = lc[1];
    L[o + 2] = lc[2];
    L[o + 3] = lc[3];
  } else L[o + 3] = 0;
}

/** Пиксель шара: нормаль экрана (ny — вниз) → цвет и свечение; null — дыра. */
type GShade = (
  nx: number,
  ny: number,
  nz: number,
  x: number,
  y: number,
) => [RGBA, RGBA | null] | null;

/** Шар (эллипсоид в экранных радиусах). Всё, что ниже `clip` над полом, срезано. */
function gBall(
  b: GBuf,
  c: V3,
  rx: number,
  ry: number,
  id: number,
  shade: GShade,
  clip = -0.6,
): void {
  const [sx, sy, d] = gproj(b.cam, c);
  const x0 = Math.floor(sx - rx - 1);
  const x1 = Math.ceil(sx + rx + 1);
  const y0 = Math.floor(sy - ry - 1);
  const y1 = Math.ceil(sy + ry + 1);
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const dx = (x + 0.5 - sx) / rx;
      const dy = (y + 0.5 - sy) / ry;
      const q = dx * dx + dy * dy;
      if (q > 1) continue;
      const nz = Math.sqrt(1 - q);
      if (c[1] - dy * ry * CPH + nz * rx * SPH < clip) continue;
      const r = shade(dx, dy, nz, x, y);
      if (r) gput(b, x, y, d + nz * rx, r[0], id, r[1]);
    }
}

/** Камень с объёмом: свет сверху-слева, как у всего этажа. */
const gStone = (t: Tones, bias = 0, lc: RGBA | null = null): GShade => {
  const out: [RGBA, RGBA | null] = [t[0], lc];
  return (nx, ny, nz) => {
    out[0] = tone(t, nx * LX + ny * LY + nz * LZ + bias);
    return out;
  };
};

/** Капсула от a до e (радиусы ra → re), со светом по нормали. */
function gLimb(
  b: GBuf,
  a: V3,
  e: V3,
  ra: number,
  re: number,
  id: number,
  t: Tones,
  bias = 0,
  lc: RGBA | null = null,
  clip = -0.6,
): void {
  const [ax, ay, ad] = gproj(b.cam, a);
  const [ex, ey, ed] = gproj(b.cam, e);
  const dx = ex - ax;
  const dy = ey - ay;
  const L2 = dx * dx + dy * dy || 1e-6;
  const R = Math.max(ra, re);
  const x0 = Math.floor(Math.min(ax, ex) - R - 1);
  const x1 = Math.ceil(Math.max(ax, ex) + R + 1);
  const y0 = Math.floor(Math.min(ay, ey) - R - 1);
  const y1 = Math.ceil(Math.max(ay, ey) + R + 1);
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const k = clamp01(((px - ax) * dx + (py - ay) * dy) / L2);
      const cx = ax + dx * k;
      const cy = ay + dy * k;
      const r = ra + (re - ra) * k;
      const ox = px - cx;
      const oy = py - cy;
      const dd = Math.hypot(ox, oy);
      if (dd > r) continue;
      const nx = ox / r;
      const ny = oy / r;
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      if (a[1] + (e[1] - a[1]) * k - oy * CPH + nz * r * SPH < clip) continue;
      gput(
        b,
        x,
        y,
        ad + (ed - ad) * k + nz * r,
        tone(t, nx * LX + ny * LY + nz * LZ + bias),
        id,
        lc,
      );
    }
}

/** Треугольник в экранных точках с глубиной — крышки люков, осколки. */
function gTri(
  b: GBuf,
  p0: [number, number, number],
  p1: [number, number, number],
  p2: [number, number, number],
  c: RGBA,
  id: number,
  lc: RGBA | null = null,
): void {
  const x0 = Math.floor(Math.min(p0[0], p1[0], p2[0]));
  const x1 = Math.ceil(Math.max(p0[0], p1[0], p2[0]));
  const y0 = Math.floor(Math.min(p0[1], p1[1], p2[1]));
  const y1 = Math.ceil(Math.max(p0[1], p1[1], p2[1]));
  const den = (p1[1] - p2[1]) * (p0[0] - p2[0]) + (p2[0] - p1[0]) * (p0[1] - p2[1]);
  if (Math.abs(den) < 1e-6) return;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const w0 = ((p1[1] - p2[1]) * (px - p2[0]) + (p2[0] - p1[0]) * (py - p2[1])) / den;
      const w1 = ((p2[1] - p0[1]) * (px - p2[0]) + (p0[0] - p2[0]) * (py - p2[1])) / den;
      const w2 = 1 - w0 - w1;
      if (w0 < -0.01 || w1 < -0.01 || w2 < -0.01) continue;
      gput(b, x, y, p0[2] * w0 + p1[2] * w1 + p2[2] * w2 + 0.3, c, id, lc);
    }
}

/** Две кости: от плеча `s` к цели `t`; локоть — в сторону `pole`. */
function gIK(s: V3, t: V3, a: number, bl: number, pole: V3): [V3, V3] {
  let d = vsub(t, s);
  let L = vlen(d);
  const max = a + bl - 0.05;
  const min = Math.abs(a - bl) + 0.5;
  if (L < 1e-4) {
    d = [0, -1, 0];
    L = 1;
  }
  if (L > max) {
    d = vmul(d, max / L);
    L = max;
  } else if (L < min) {
    d = vmul(d, min / L);
    L = min;
  }
  const dir = vmul(d, 1 / L);
  const cosA = clampR((a * a + L * L - bl * bl) / (2 * a * L), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  let pp = vsub(pole, vmul(dir, vdot(pole, dir)));
  if (vlen(pp) < 1e-4) pp = vcross(dir, [1, 0, 0]);
  pp = vnorm(pp);
  const e = vadd(s, vadd(vmul(dir, a * cosA), vmul(pp, a * sinA)));
  return [e, vadd(s, d)];
}

/** Дешёвый трёхмерный шум 0…1 (мох, пятна) — в осях тела, едет вместе с ним. */
function gnoise(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const u = smooth(x - xi);
  const v = smooth(y - yi);
  const w = smooth(z - zi);
  const z0 = 97 * zi;
  const z1 = 97 * (zi + 1);
  const a = hash(xi + z0, yi, seed) * (1 - u) + hash(xi + 1 + z0, yi, seed) * u;
  const bb = hash(xi + z0, yi + 1, seed) * (1 - u) + hash(xi + 1 + z0, yi + 1, seed) * u;
  const c = hash(xi + z1, yi, seed) * (1 - u) + hash(xi + 1 + z1, yi, seed) * u;
  const d = hash(xi + z1, yi + 1, seed) * (1 - u) + hash(xi + 1 + z1, yi + 1, seed) * u;
  return (a * (1 - v) + bb * v) * (1 - w) + (c * (1 - v) + d * v) * w;
}

/** Шестигранник «остриём вверх»: расстояние до центра по граням. */
const hexD = (u: number, v: number) =>
  Math.max(Math.abs(u), Math.abs(0.5 * u + 0.866 * v), Math.abs(-0.5 * u + 0.866 * v));

// ---- Риг: каналы, ключи, кривые ----
//
// Корпус: bx/by/bz — сдвиг центра (by вверх, bz вперёд), pit/rol/tw — наклон
// вперёд, крен, поворот верха над ногами. Голова: ht/hn — поворот и кивок,
// hf/hu — выдвинуть вперёд и поднять. Кисти (lx…rz) — цели в осях верха от
// центра корпуса; fist — кулак. Стопы (fL…, fR…) — на земле, y — подъём.
// Свет: iris — зрачок, lsz — линза, lon — глаз горит, lfl — вспышка;
// run/swp — руны и сколько их зажглось по кругу; cor — плита ядра
// раздвинута, glo — ядро раскаляется; hat/tub — люки и трубы ракет;
// mos — мох (больше 1 — сонная шуба, меньше — осыпался), tre — деревце
// клонится, trx — ветер в кроне, crk — трещины, stm — пар, dom — купол.
// q* — трансформ кадра для движка (вес, удар), alp — прозрачность.
const GCH = [
  'bx',
  'by',
  'bz',
  'pit',
  'rol',
  'tw',
  'ht',
  'hn',
  'hf',
  'hu',
  'lx',
  'ly',
  'lz',
  'rx',
  'ry',
  'rz',
  'lfi',
  'rfi',
  'fLx',
  'fLy',
  'fLz',
  'fRx',
  'fRy',
  'fRz',
  'iris',
  'lsz',
  'lon',
  'lfl',
  'run',
  'swp',
  'glo',
  'cor',
  'hat',
  'tub',
  'mos',
  'tre',
  'trx',
  'crk',
  'stm',
  'dom',
  'heat',
  'qsx',
  'qsy',
  'qdx',
  'qdy',
  'qrot',
  'alp',
] as const;
type GCh = (typeof GCH)[number];
type GRig = Record<GCh, number>;

type GEase = (x: number) => number;
const gLin: GEase = (x) => x;
const gIn: GEase = (x) => x * x;
const gIn3: GEase = (x) => x * x * x;
const gOut: GEase = (x) => 1 - (1 - x) * (1 - x);
const gOut3: GEase = (x) => 1 - (1 - x) * (1 - x) * (1 - x);
const gIO: GEase = (x) => (x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) * (1 - x));
/** С перелётом за цель и возвратом (подъём, удар о землю). */
const gBack: GEase = (x) => 1 + 2.4 * Math.pow(x - 1, 3) + 1.4 * Math.pow(x - 1, 2);

type GKey = [number, Partial<GRig>, GEase?];

/**
 * Ключевые позы: ключ меняет только названные каналы, остальные ДЕРЖАТ
 * прошлое значение. Между ключами — кривая следующего ключа. `lag` —
 * запаздывание частей: они смотрят позу чуть в прошлом.
 */
function gTrack(keys: GKey[], t: number, base: GRig, lag?: Partial<Record<GCh, number>>): GRig {
  const out = { ...base };
  if (!keys.length) return out;
  for (const ch of GCH) {
    const tt = lag?.[ch] ? Math.max(0, t - lag[ch]!) : t;
    let pt = keys[0][0];
    let pv = keys[0][1][ch] ?? base[ch];
    let v = pv;
    if (tt > pt)
      for (let i = 1; i < keys.length; i++) {
        const [kt, kv, ke] = keys[i];
        const cv = kv[ch] ?? pv;
        if (tt < kt) {
          v = pv + (cv - pv) * (ke ?? gIO)(clamp01((tt - pt) / (kt - pt || 1)));
          break;
        }
        pt = kt;
        pv = cv;
        v = cv;
      }
    out[ch] = v;
  }
  return out;
}

/** Покой фазы: руны, ядро, трещины и пар — по фазе боя. */
function gBase(ph: number, sh: boolean): GRig {
  return {
    bx: 0,
    by: 0,
    bz: 0,
    pit: 0.03,
    rol: 0,
    tw: 0,
    ht: 0,
    hn: 0,
    hf: 0,
    hu: 0,
    lx: -21,
    ly: -18,
    lz: 1.5,
    rx: 21,
    ry: -18,
    rz: 1.5,
    lfi: 0.2,
    rfi: 0.2,
    fLx: -7.6,
    fLy: 0,
    fLz: 0.8,
    fRx: 7.6,
    fRy: 0,
    fRz: -0.8,
    iris: 0.7,
    lsz: 1,
    lon: 1,
    lfl: 0,
    run: ph === 2 ? 1 : ph === 3 ? 0.85 : ph === 4 ? 0.95 : 0.55,
    swp: 1,
    glo: 0,
    cor: ph >= 3 ? 1 : 0,
    hat: 0,
    tub: 0,
    // После «Падения острова» мох наполовину осыпался, деревце покосилось.
    mos: ph >= 4 ? 0.82 : 1,
    tre: ph >= 4 ? 0.12 : 0,
    trx: 0,
    crk: ph >= 4 ? 1 : 0,
    stm: ph >= 3 ? 1 : 0,
    dom: sh ? 1 : 0,
    heat: 1,
    qsx: 1,
    qsy: 1,
    qdx: 0,
    qdy: 0,
    qrot: 0,
    alp: 1,
  };
}

// ---- Скелет ----

/** Где что у стража в осях корня (до поворота камерой). */
interface GSkel {
  r: GRig;
  /** Центр корпуса. */
  C: V3;
  /** Поворот «тело → корень» и обратно. */
  rot: (v: V3) => V3;
  inv: (v: V3) => V3;
  head: V3;
  hrot: (v: V3) => V3;
  hinv: (v: V3) => V3;
  sh: [V3, V3];
  el: [V3, V3];
  hand: [V3, V3];
  hip: [V3, V3];
  knee: [V3, V3];
  foot: [V3, V3];
  /** Деревце: корень ствола на плече, вершина, середина кроны. */
  tree0: V3;
  tree1: V3;
  crown: V3;
}

const SHOULDER: V3 = [14.6, 7.6, -0.4];
const TREE_AT = vmul(vnorm([-9.6, 11.6, -3]), BR - 0.6);

function gSkel(r: GRig): GSkel {
  const C: V3 = [r.bx, HB + r.by, r.bz];
  const rot = (v: V3) => rotYv(rotXv(rotZv(v, r.rol), r.pit), r.tw);
  const inv = (v: V3) => rotZv(rotXv(rotYv(v, -r.tw), -r.pit), -r.rol);
  const head = vadd(C, rot([0, 18.4 + r.hu, 2.6 + r.hf]));
  const hrot = (v: V3) => rot(rotYv(rotXv(v, r.hn), r.ht));
  const hinv = (v: V3) => rotXv(rotYv(inv(v), -r.ht), -r.hn);
  const sh: [V3, V3] = [
    vadd(C, rot([-SHOULDER[0], SHOULDER[1], SHOULDER[2]])),
    vadd(C, rot(SHOULDER)),
  ];
  const tgt = (x: number, y: number, z: number): V3 => vadd(C, rotYv([x, y, z], r.tw));
  const poleL = rotYv([-0.75, -0.1, -0.65], r.tw);
  const poleR = rotYv([0.75, -0.1, -0.65], r.tw);
  const [eL, hL] = gIK(sh[0], tgt(r.lx, r.ly, r.lz), LU, LF, poleL);
  const [eR, hR] = gIK(sh[1], tgt(r.rx, r.ry, r.rz), LU, LF, poleR);
  // Бёдра — в осях ног: верх может крутиться над ними (вращение), ноги нет.
  const hip: [V3, V3] = [vadd(C, [-6.4, -10.6, 0]), vadd(C, [6.4, -10.6, 0])];
  const fL: V3 = [r.fLx, 2.5 + r.fLy, r.fLz];
  const fR: V3 = [r.fRx, 2.5 + r.fRy, r.fRz];
  const [kL] = gIK(hip[0], fL, LT, LS, [-0.25, 0, 1]);
  const [kR] = gIK(hip[1], fR, LT, LS, [0.25, 0, 1]);
  const [, aL] = gIK(hip[0], fL, LT, LS, [-0.25, 0, 1]);
  const [, aR] = gIK(hip[1], fR, LT, LS, [0.25, 0, 1]);
  const tree0 = vadd(C, rot(TREE_AT));
  const tdir = rot(vnorm(vlerp([-0.16, 1, -0.12], [-0.75, -0.35, 0.55], clamp01(r.tre))));
  const tree1 = vadd(tree0, vmul(tdir, 7.5));
  const crown = vadd(tree1, vmul(tdir, 2.6));
  return {
    r,
    C,
    rot,
    inv,
    head,
    hrot,
    hinv,
    sh,
    el: [eL, eR],
    hand: [hL, hR],
    hip,
    knee: [kL, kR],
    foot: [aL, aR],
    tree0,
    tree1,
    crown,
  };
}

// ---- Поверхность корпуса: всё лежит на шаре в осях тела ----

const C0 = vnorm([0, 0.14, 1]);
const CE1: V3 = [1, 0, 0];
const CE2 = vnorm(vcross(C0, CE1));
const BV = vnorm([0, 0.12, -1]);
const BE2 = vnorm(vsub([0, 1, 0], vmul(BV, BV[1])));
const BE1 = vcross(BE2, BV);
/** Люки ракет на плечах: левый (три трубы) и правый (две). */
const HATCH: V3[] = [vnorm([-0.6, 0.76, 0.06]), vnorm([0.6, 0.76, 0])];
const HE1 = HATCH.map((h) => vnorm([h[2], 0, -h[0]]));
const HE2 = HATCH.map((h, i) => vcross(h, HE1[i]));
const TUBES: number[][] = [
  [-1.7, 0, 1.7],
  [-0.95, 0.95],
];
/** Цветы на плечах: направление и цвет. */
const FLOWERS: [V3, number][] = [
  [vnorm([-0.5, 0.82, 0.25]), 0],
  [vnorm([-0.28, 0.9, 0.3]), 1],
  [vnorm([0.42, 0.84, 0.3]), 2],
  [vnorm([0.62, 0.72, -0.2]), 0],
  [vnorm([-0.7, 0.66, -0.1]), 2],
  [vnorm([0.1, 0.92, -0.35]), 1],
  [vnorm([0.3, 0.86, 0.38]), 0],
];

/** Трещины последней фазы — ломаные по шару от ядра наружу (и по спине). */
const CRACKS: V3[][] = (() => {
  const onFront = (x: number, y: number, back = false): V3 => {
    const u = x / BR;
    const v = y / BR;
    const z = Math.sqrt(Math.max(0, 1 - u * u - v * v)) * (back ? -1 : 1);
    return vnorm([u, v, z]);
  };
  return [
    [onFront(-4.5, 3.5), onFront(-8, 5.5), onFront(-12, 6.5), onFront(-13.5, 2)],
    [onFront(4.5, -3), onFront(8, -6), onFront(10.5, -10)],
    [onFront(-3, -4.5), onFront(-5.5, -9), onFront(-4.5, -13)],
    [onFront(5, 4.5), onFront(9.5, 8), onFront(12.5, 6.5)],
    [onFront(-6, 8, true), onFront(0, 3, true), onFront(5, -4, true), onFront(3, -10, true)],
    [onFront(9, 9, true), onFront(12, 2, true)],
  ];
})();

/** Отрезки трещин заранее: начало, вектор, длина, путь от начала ломаной. */
const CRACK_SEG: { a: V3; d: V3; l: number; l2: number; at: number; total: number }[][] =
  CRACKS.map((line) => {
    let total = 0;
    for (let i = 1; i < line.length; i++) total += vlen(vsub(line[i], line[i - 1]));
    let at = 0;
    const out: { a: V3; d: V3; l: number; l2: number; at: number; total: number }[] = [];
    for (let i = 1; i < line.length; i++) {
      const d = vsub(line[i], line[i - 1]);
      const l = vlen(d);
      out.push({ a: line[i - 1], d, l, l2: l * l, at, total });
      at += l;
    }
    return out;
  });

/** Расстояние (в пикселях по шару) до видимой части трещин: рост `crk` 0…1. */
function crackHit(n0: number, n1: number, n2: number, crk: number): number {
  let best = 9;
  for (const segs of CRACK_SEG) {
    const reach = segs[0].total * crk;
    for (const sg of segs) {
      if (sg.at >= reach) break;
      const use = Math.min(1, (reach - sg.at) / sg.l);
      const px = n0 - sg.a[0];
      const py = n1 - sg.a[1];
      const pz = n2 - sg.a[2];
      let k = (px * sg.d[0] + py * sg.d[1] + pz * sg.d[2]) / sg.l2;
      k = k < 0 ? 0 : k > use ? use : k;
      const dx = px - sg.d[0] * k;
      const dy = py - sg.d[1] * k;
      const dz = pz - sg.d[2] * k;
      const dd = dx * dx + dy * dy + dz * dz;
      if (dd < best) best = dd;
    }
  }
  return Math.sqrt(best) * BR;
}

/** Нормаль экрана → оси тела (или головы): три столбца линейного отображения. */
function gNormMap(b: GBuf, inv: (v: V3) => V3): number[] {
  const c0 = inv(gunproj(b.cam, 1, 0, 0));
  const c1 = inv(gunproj(b.cam, 0, 1, 0));
  const c2 = inv(gunproj(b.cam, 0, 0, 1));
  return [c0[0], c0[1], c0[2], c1[0], c1[1], c1[2], c2[0], c2[1], c2[2]];
}

/** Что рисует корпус в этом кадре (кроме самого рига). */
interface GLook {
  ph: number;
  eye: RGBA;
  runeC: RGBA;
  /** Бег рун по кругу в покое (0…1) или −1. */
  rph: number;
  /** Номер кадра — мерцание, искры. */
  f: number;
  /** Ход цикла 0…1 (покой, колено) или время одиночной техники — пар, купол. */
  cyc: number;
  /** Сколько ракет уже ушло (пустые трубы) и чья вспышка в этом кадре. */
  fired: number;
  flash: number;
}

function runeOf(ph: number): RGBA {
  return ph === 3 ? hx('#ffb45a') : ph === 4 ? hx('#ff6a4a') : ph === 2 ? hx('#9af8ff') : RUNE;
}
function eyeOf(ph: number): RGBA {
  return ph >= 4 ? EYE_ANGRY : ph === 3 ? AMBER : CYAN;
}

function bodyShade(b: GBuf, s: GSkel, lk: GLook, mossMask: Uint8Array): GShade {
  const r = s.r;
  const glow = clamp01(r.glo);
  const heat = clamp01(r.heat);
  const M = gNormMap(b, s.inv);
  const n: V3 = [0, 0, 0];
  // Пара «цвет, свечение» — одна на кадр: без нового массива на пиксель.
  const R2: [RGBA, RGBA | null] = [WHITE, null];
  const ret = (c: RGBA, l: RGBA | null): [RGBA, RGBA | null] => {
    R2[0] = c;
    R2[1] = l;
    return R2;
  };
  return (nx, ny, nz, x, y) => {
    const l = nx * LX + ny * LY + nz * LZ;
    n[0] = M[0] * nx + M[3] * ny + M[6] * nz;
    n[1] = M[1] * nx + M[4] * ny + M[7] * nz;
    n[2] = M[2] * nx + M[5] * ny + M[8] * nz;
    // --- Ядро и руны (спереди).
    const cc = vdot(n, C0);
    if (cc > 0.55) {
      const u = BR * vdot(n, CE1);
      const v = BR * vdot(n, CE2);
      const a = Math.acos(clampR(cc, -1, 1));
      // Плита ядра: целая или две половины, разъехавшиеся по бокам.
      const gap = r.cor * 4.1;
      const hd = hexD(u, v);
      let plate = -1;
      if (r.cor <= 0.02) {
        if (hd <= 4.85) plate = hd;
      } else {
        const hl = hexD(u + gap, v);
        const hr = hexD(u - gap, v);
        if (u + gap <= 0.4 && hl <= 4.85) plate = hl;
        else if (u - gap >= -0.4 && hr <= 4.85) plate = hr;
      }
      if (plate >= 0) {
        // Фаска: светлая сверху-слева, тёмная снизу-справа.
        if (plate > 4.0) {
          const up = -u * 0.5 + v * 0.85 > 0;
          return ret(up ? ANC[3] : ANC[0], null);
        }
        if (r.cor <= 0.02 && plate < 2.1) {
          const b2 = clamp01(r.run * (0.4 + 0.6 * clamp01(r.swp * 1.2)) + glow * 0.6);
          if (plate < 0.6 && b2 > 0.6) return ret(WHITE, alpha(WHITE, 0.9));
          return ret(mixc(ANC[1], lk.runeC, 0.3 + 0.7 * b2), alpha(lk.runeC, 0.25 + 0.6 * b2));
        }
        return ret(tone(ANC, l + 0.2), null);
      }
      if (r.cor > 0.02 && hd <= 5.5) {
        const rr = Math.hypot(u, v);
        const R = 4.3 * Math.min(1, r.cor * 1.3);
        if (rr <= R) {
          // Ядро: раскалённый шар, к середине — белее; стробит с кадром.
          const k = 1 - rr / Math.max(1, R);
          const hot = clamp01(0.35 + k * 0.6 + glow * 0.5 + (lk.f % 4 < 2 ? 0.06 : 0));
          const c0 =
            hot > 0.92
              ? CORE_HOT[3]
              : hot > 0.7
                ? CORE_HOT[2]
                : hot > 0.45
                  ? CORE_HOT[1]
                  : CORE_HOT[0];
          // Остывает (смерть): к тёмному железу, свет гаснет.
          const c = heat < 1 ? mixc(IRON[k > 0.6 ? 1 : 0], c0, heat) : c0;
          if (rr < 1.2 && u < 0 && v > 0 && heat > 0.5) return ret(WHITE, alpha(WHITE, heat));
          return ret(c, alpha(c0, (0.75 + 0.25 * hot) * heat));
        }
        return ret(
          hd > 4.9 ? IRON[2] : IRON[0],
          hd > 4.9 ? null : alpha(CORE_HOT[0], 0.25 * r.cor),
        );
      }
      // Кольцо рун вокруг ядра и четыре луча от него.
      const psi = Math.atan2(v, u);
      const ring = a > 0.535 && a < 0.6;
      const spoke =
        a > 0.62 &&
        a < 0.8 &&
        [0.785, 2.356, -0.785, -2.356].some(
          (q) => Math.abs(Math.atan2(Math.sin(psi - q), Math.cos(psi - q))) < 0.11,
        );
      if (ring || spoke) {
        const seg = ((((Math.PI / 2 - psi) / TAU) % 1) + 1) % 1;
        const on = clamp01((r.swp * 8 - Math.floor(seg * 8)) * 1);
        const fresh = on > 0 && on < 1;
        let br = r.run * (spoke ? 0.85 : 1) * on;
        if (lk.rph >= 0) {
          const d = Math.abs(((seg - lk.rph + 1.5) % 1) - 0.5);
          br += Math.max(0, 1 - d * 9) * 0.45;
        }
        if (fresh) br = 1.4;
        // Погасшая руна — просто высеченный жёлоб.
        if (br < 0.05) return ret(mixc(tone(ANC, l), ANC_SEAM, 0.45), null);
        const c =
          br > 1.15
            ? mixc(lk.runeC, WHITE, 0.6)
            : mixc(ANC[1], lk.runeC, 0.25 + 0.75 * clamp01(br));
        return ret(c, alpha(br > 1.15 ? WHITE : lk.runeC, 0.25 + 0.7 * clamp01(br)));
      }
    }
    // --- Решётка на спине: в «Перегреве» и вращении светится.
    const bc = vdot(n, BV);
    if (bc > 0.86) {
      const u = BR * vdot(n, BE1);
      const v = BR * vdot(n, BE2);
      const rr = Math.hypot(u, v);
      if (rr < 4.6) {
        if (rr > 3.7) return ret(ANC_SEAM, null);
        const slat = ((Math.floor(v + 10) % 2) + 2) % 2 === 0;
        const hot = (r.cor * 0.5 + glow) * heat;
        if (slat) return ret(IRON[1], null);
        return hot > 0.1
          ? [mixc(IRON[0], CORE_HOT[1], clamp01(hot)), alpha(CORE_HOT[1], clamp01(hot))]
          : [IRON[0], null];
      }
    }
    // --- Люки ракет.
    for (let i = 0; i < 2; i++) {
      const hc = vdot(n, HATCH[i]);
      if (hc < 0.9) continue;
      const u = BR * vdot(n, HE1[i]);
      const v = BR * vdot(n, HE2[i]);
      if (Math.abs(u) > 3.1 || Math.abs(v) > 2.3) continue;
      if (r.hat > 0.05) {
        const rim = Math.abs(u) > 2.4 || Math.abs(v) > 1.6;
        if (rim) return ret(IRON[0], alpha(hx('#ff6a3a'), 0.35 * r.hat));
        return ret(HOLE, null);
      }
      const rim = Math.abs(u) > 2.5 || Math.abs(v) > 1.7;
      if (rim) return ret(ANC_SEAM, null);
      if (Math.abs(u) < 0.6 && Math.abs(v) < 0.6 && lk.ph % 2 === 0)
        return ret(hx('#e84a3a'), alpha(hx('#ff5a3a'), 0.8));
      return ret(tone(IRON, l + 0.25), null);
    }
    // --- Трещины.
    if (r.crk > 0.01) {
      const d = crackHit(n[0], n[1], n[2], r.crk);
      if (d < 0.62) return ret(hx('#1c1210'), heat > 0.05 ? alpha(CORE_HOT[1], 0.85 * heat) : null);
      if (d < 1.2)
        return ret(
          mixc(tone(ANC, l), CORE_HOT[0], 0.35 * heat),
          heat > 0.05 ? alpha(CORE_HOT[0], 0.35 * heat) : null,
        );
    }
    // --- Сад: мох на макушке и цветы.
    if (n[1] > 0.38) {
      // Сад — на плечах и на спине, а не на «лице»: спереди порог выше; пятнами.
      let th =
        0.7 +
        0.3 * (gnoise(n[0] * 4 + 3, n[1] * 4, n[2] * 4, 811) - 0.5) +
        0.14 * Math.max(0, n[2]);
      if (r.mos > 1) th -= (r.mos - 1) * 0.9;
      let moss = n[1] > th;
      // Осыпается клочьями: крупные клетки по поверхности.
      if (
        moss &&
        r.mos < 1 &&
        hash(Math.floor(n[0] * 3.5 + 9), Math.floor(n[2] * 3.5 + 9), 815) > r.mos
      )
        moss = false;
      for (const [fd, k] of FLOWERS)
        if (vdot(n, fd) > 0.9965 && (r.mos >= 1 || hash(k, 7, 816) < r.mos)) {
          mossMask[y * GW + x] = 2;
          return ret(FLOWER[k], null);
        }
      if (moss) {
        mossMask[y * GW + x] = 1;
        const sp = hash(Math.floor(n[0] * 14 + 30), Math.floor(n[2] * 14 + 30), 813);
        return ret(sp < 0.15 ? MOSS[3] : tone(MOSS, l + 0.12), null);
      }
    }
    // --- Шов, заклёпки, сколы.
    if (n[1] > -0.31 && n[1] < -0.22) return ret(ANC_SEAM, null);
    if (n[1] > -0.4 && n[1] < -0.32) {
      const lon = Math.atan2(n[0], n[2]);
      const q = (((lon / (TAU / 18)) % 1) + 1) % 1;
      if (q < 0.16) return ret(l > 0 ? ANC[3] : ANC[2], null);
    }
    let c = tone(ANC, l);
    const sp = hash(
      Math.floor(n[0] * 13 + 40),
      Math.floor(n[1] * 13 + 40),
      Math.floor(n[2] * 13 + 40) + 801,
    );
    if (sp < 0.09) c = ANC[0];
    else if (sp < 0.16) c = ANC[1];
    // Свет ядра на камне вокруг (третья фаза, вращение).
    const warm = r.cor > 0.3 ? clamp01((cc - 0.55) / 0.45) * (0.25 + glow * 0.4) * heat : 0;
    if (warm > 0.05) c = mixc(c, CORE_HOT[1], warm);
    return ret(c, null);
  };
}

function headShade(b: GBuf, s: GSkel, lk: GLook, mossMask: Uint8Array): GShade {
  const r = s.r;
  const lensR = 0.46 * r.lsz;
  const fwd = vnorm([0, -0.06, 1]);
  const on = clamp01(r.lon);
  const M = gNormMap(b, s.hinv);
  const n: V3 = [0, 0, 0];
  // Пара «цвет, свечение» — одна на кадр: без нового массива на пиксель.
  const R2: [RGBA, RGBA | null] = [WHITE, null];
  const ret = (c: RGBA, l: RGBA | null): [RGBA, RGBA | null] => {
    R2[0] = c;
    R2[1] = l;
    return R2;
  };
  return (nx, ny, nz, x, y) => {
    const l = nx * LX + ny * LY + nz * LZ + 0.1;
    n[0] = M[0] * nx + M[3] * ny + M[6] * nz;
    n[1] = M[1] * nx + M[4] * ny + M[7] * nz;
    n[2] = M[2] * nx + M[5] * ny + M[8] * nz;
    // Нормаль уже единичная: камера и поворот — вращения.
    const a = Math.acos(clampR(vdot(n, fwd), -1, 1));
    if (a < lensR) {
      const k = a / lensR;
      if (on < 0.05) return ret(k < 0.55 ? EYE_OFF : mixc(EYE_OFF, INK, 0.4), null);
      const eye = lk.eye;
      const ap = r.iris * 0.62;
      const fl = clamp01(r.lfl);
      if (nx * -0.6 + ny * -0.8 > 0.5 && k > 0.35) return ret(WHITE, alpha(WHITE, 0.9 * on));
      if (k < ap) {
        const c = mixc(mixc(eye, WHITE, 0.55), WHITE, fl);
        return ret(c, alpha(c, on));
      }
      if (k < 0.74) {
        const c = mixc(eye, WHITE, fl * 0.5);
        return ret(c, alpha(c, 0.75 * on));
      }
      const c = mixc(eye, INK, 0.45 - fl * 0.3);
      return ret(c, alpha(eye, 0.4 * on));
    }
    if (a < lensR + 0.17) return ret(LENS_RIM, null);
    if (a < lensR + 0.3 && n[1] > 0.1) return ret(tone(ANC, l + 0.25), null);
    const nn = n;
    if (nn[1] > -0.56 && nn[1] < -0.42) return ret(ANC_SEAM, null);
    // На голове — шапочка мха на темени, лоб над линзой чистый.
    if (
      nn[1] >
      0.7 +
        0.3 * (gnoise(nn[0] * 4 + 5, 0, nn[2] * 4, 821) - 0.5) +
        0.15 * Math.max(0, nn[2]) -
        (r.mos > 1 ? (r.mos - 1) * 0.8 : 0)
    ) {
      if (r.mos >= 1 || hash(Math.floor(nn[0] * 3 + 9), Math.floor(nn[2] * 3 + 9), 822) < r.mos) {
        mossMask[y * GW + x] = 1;
        return ret(tone(MOSS, l + 0.1), null);
      }
    }
    return ret(tone(ANC, l), null);
  };
}

// ---- Кадр стража ----

/** Эффекты кадра, которые не в риге (их считает техника). */
interface GFx {
  /** Смаз кулаков/стопы: экранные точки прошлых положений (новые — первыми). */
  smear?: { x: number; y: number; r: number }[][];
  /** Цвет смаза поверх темноты. */
  smearLit?: RGBA;
  /** Отставание кроны (в осях корня). */
  crown?: V3;
  /** Искры в суставах (0…1). */
  sparks?: number;
  /** Звёзды над головой — фаза кружения или −1. */
  dizzy?: number;
  /** Осколки купола: возраст, с. */
  shards?: number;
  /** Частицы заряда, летящие в линзу (0…1). */
  charge?: number;
  /** Дуги лопастей на вращении: угол поворота за кадр. */
  spin?: number;
  /** Осыпь мха и цветов: [время, начало, конец, сколько]. */
  bits?: [number, number, number, number];
  /** Дым из труб: возраст после пуска по каждой ракете (−1 — не было). */
  smoke?: number[];
  /** Купол: строится снизу (0…1) и вспышка удара по нему. */
  domeK?: number;
  domeHit?: boolean;
  /** Блик и лучи линзы (0…1) — выстрел взгляда. */
  flare?: number;
  /** Свечение рук на вращении. */
  bladeGlow?: number;
  /** Свет бежит по рукам к кулакам (0…1) — замах кулаков. */
  armCharge?: number;
  /** Контакт: вспышка на кулаках или стопе (номер стопы), ход 0…1. */
  impact?: { at: 'hands' | number; k: number };
}

interface GOut {
  p: Px;
  lit: Px;
  lens: [number, number] | null;
  core: [number, number] | null;
  /** Излучатели головы для лучей вращения: линза спереди и затылок. */
  emit: GEmit;
  hands: [number, number][];
}

/** Точки головы на экране кадра и видна ли точка (не за головой). */
interface GEmit {
  head: [number, number];
  front: [number, number];
  rear: [number, number];
  frontVis: boolean;
  rearVis: boolean;
}

/** Тёмная линия по краю ближней части на дальней: части читаются. */
function gSeams(b: GBuf): void {
  const mark: number[] = [];
  for (let y = Math.max(1, b.y0); y <= Math.min(GH - 2, b.y1); y++)
    for (let x = Math.max(1, b.x0); x <= Math.min(GW - 2, b.x1); x++) {
      const i = y * GW + x;
      const id = b.id[i];
      if (!id) continue;
      const z = b.z[i];
      for (const j of [i - 1, i + 1, i - GW, i + GW]) {
        const jd = b.id[j];
        if (jd && jd !== id && b.z[j] > z + 2.4) {
          mark.push(i);
          break;
        }
      }
    }
  const D = b.p.data;
  for (const i of mark) {
    const o = i * 4;
    D[o] = Math.round(D[o] * 0.42 + INK[0] * 0.58);
    D[o + 1] = Math.round(D[o + 1] * 0.42 + INK[1] * 0.58);
    D[o + 2] = Math.round(D[o + 2] * 0.42 + INK[2] * 0.58);
  }
}

/** Смешать цвет поверх пикселя (как `Px.set` с прозрачностью), без нового массива. */
function gblend(p: Px, x: number, y: number, c: RGBA | Uint8ClampedArray, a: number, o = 0): void {
  x = Math.round(x);
  y = Math.round(y);
  if (a <= 0.004 || x < 0 || y < 0 || x >= p.w || y >= p.h) return;
  const i = (y * p.w + x) * 4;
  const D = p.data;
  if (a >= 1) {
    D[i] = c[o];
    D[i + 1] = c[o + 1];
    D[i + 2] = c[o + 2];
    D[i + 3] = 255;
    return;
  }
  const da = D[i + 3] / 255;
  const oa = a + da * (1 - a);
  const k = da * (1 - a);
  D[i] = (c[o] * a + D[i] * k) / oa;
  D[i + 1] = (c[o + 1] * a + D[i + 1] * k) / oa;
  D[i + 2] = (c[o + 2] * a + D[i + 2] * k) / oa;
  D[i + 3] = oa * 255;
}

/** Полупрозрачная точка поверх кадра (вспышки, дым, искры). */
function gdot(p: Px, x: number, y: number, c: RGBA, a: number): void {
  if (a <= 0.01) return;
  gblend(p, x, y, c, a);
}
function gdisc(p: Px, x: number, y: number, r: number, c: RGBA, a: number): void {
  if (a <= 0.01 || r <= 0) return;
  for (let yy = Math.floor(y - r); yy <= Math.ceil(y + r); yy++)
    for (let xx = Math.floor(x - r); xx <= Math.ceil(x + r); xx++) {
      const d = Math.hypot(xx + 0.5 - x, yy + 0.5 - y);
      if (d <= r) gblend(p, xx, yy, c, a * (r < 1.6 ? 1 : 1 - (d / r) * 0.35));
    }
}

function gPaint(yaw: number, s: GSkel, lk: GLook, fx: GFx): GOut {
  const b = gbuf(yaw);
  const r = s.r;
  const mossMask = new Uint8Array(GW * GH);
  const dC = gproj(b.cam, s.C)[2];
  const depthBias = (p: V3) => clampR((gproj(b.cam, p)[2] - dC) * 0.014, -0.28, 0.1);

  // Ноги: бедро, колено, голень, тяжёлая стопа-подушка.
  for (let i = 0; i < 2; i++) {
    const id = i ? G_LEGR : G_LEGL;
    const bias = depthBias(s.knee[i]) - 0.06;
    gLimb(b, s.hip[i], s.knee[i], 4.5, 4.1, id, ANC, bias);
    gBall(b, s.knee[i], 4, 4, id, gStone(ANC, bias + 0.05));
    gLimb(b, s.knee[i], s.foot[i], 4.1, 3.6, id, ANC, bias);
    const toe = vadd(s.foot[i], rotYv([0, -0.6, 1.2], 0));
    gBall(b, toe, 5.5, 2.8, id, gStone(ANC, bias - 0.04));
  }

  // Корпус и голова.
  gBall(b, s.C, BR, BR, G_BODY, bodyShade(b, s, lk, mossMask));
  gBall(b, s.head, HRX, HRY, G_HEAD, headShade(b, s, lk, mossMask));

  // Руки: плечо, локоть, предплечье, кисть; по плечу — руны.
  const handsScr: [number, number][] = [];
  for (let i = 0; i < 2; i++) {
    const id = i ? G_ARMR : G_ARML;
    const bias = depthBias(s.el[i]);
    const fist = clamp01(i ? r.rfi : r.lfi);
    const blade = fx.bladeGlow ? alpha(lk.runeC, 0.35 * fx.bladeGlow) : null;
    gBall(b, s.sh[i], 3.9, 3.9, id, gStone(ANC, bias + 0.08));
    gLimb(b, s.sh[i], s.el[i], 3.8, 3.2, id, ANC, bias + 0.02, blade);
    gBall(b, s.el[i], 3.5, 3.5, id, gStone(ANC, bias + 0.06));
    gLimb(b, s.el[i], s.hand[i], 3.3, 2.9, id, ANC, bias, blade);
    const dir = vnorm(vsub(s.hand[i], s.el[i]));
    const hc = vadd(s.hand[i], vmul(dir, 1.2));
    const hr = 3.8 + fist * 0.6;
    gBall(b, hc, hr, hr * 0.86, id, gStone(ANC, bias + 0.1, blade), -1.6);
    // Пальцы — веером поперёк руки; кулак их поджимает.
    const side: V3 = i ? [1, 0, 0] : [-1, 0, 0];
    let spread = vcross(dir, rotYv(side, r.tw));
    if (vlen(spread) < 0.2) spread = rotYv([0, 0, 1], r.tw);
    spread = vnorm(vadd(vnorm(spread), vmul(rotYv(side, r.tw), 0.55)));
    const fl = 4.2 * (1 - fist * 0.75);
    if (fl > 0.6)
      for (let k = -1; k <= 1; k++) {
        const f0 = vadd(hc, vadd(vmul(dir, 1.6), vmul(spread, k * 2.3)));
        const f1 = vadd(f0, vadd(vmul(dir, fl), vmul(spread, k * 0.9)));
        gLimb(b, f0, f1, 1.3, 1.0, id, ANC, bias - 0.02, blade);
      }
    const [hx0, hy0] = gproj(b.cam, hc);
    handsScr.push([hx0, hy0]);
    // Руны вдоль руки — точки по оси плеча и предплечья, если рука там видна.
    // Заряд (`armCharge`) гонит свет от плеча к кулаку, кулак разгорается.
    const ch = fx.armCharge ?? 0;
    for (let k = 0; k < 7; k++) {
      const pt =
        k < 4
          ? vlerp(s.sh[i], s.el[i], 0.2 + k * 0.2)
          : vlerp(s.el[i], s.hand[i], 0.25 + (k - 4) * 0.25);
      const [px, py] = gproj(b.cam, pt);
      const X = Math.floor(px);
      const Y = Math.floor(py);
      if (X < 0 || Y < 0 || X >= GW || Y >= GH) continue;
      const j = Y * GW + X;
      if (b.id[j] !== id) continue;
      let br = (k < 4 ? clamp01(r.run * clamp01(r.swp * 1.4 - 0.2)) : 0) + (fx.bladeGlow ?? 0);
      const front = ch * 8 - k;
      if (ch > 0 && front > 0) br = Math.max(br, front < 1 ? 1.4 : 1);
      if (br < 0.08) continue;
      const o = j * 4;
      const c =
        br > 1.2 ? mixc(lk.runeC, WHITE, 0.6) : mixc(ANC[1], lk.runeC, 0.3 + 0.7 * clamp01(br));
      b.p.data[o] = c[0];
      b.p.data[o + 1] = c[1];
      b.p.data[o + 2] = c[2];
      b.lit.set(X, Y, alpha(br > 1.2 ? WHITE : lk.runeC, 0.3 + 0.6 * clamp01(br)));
    }
    if (ch > 0.85)
      gdisc(b.lit, hx0, hy0, 3.2 + (ch - 0.85) * 8, lk.runeC, 0.35 * clamp01((ch - 0.85) / 0.15));
  }

  // Деревце на левом плече: ствол и крона, крона отстаёт от тела.
  {
    const lag = fx.crown ?? [0, 0, 0];
    const breeze: V3 = [b.cam.c * r.trx, 0, b.cam.s * r.trx];
    const top = vadd(s.tree1, vmul(vadd(lag, breeze), 0.55));
    const crown = vadd(s.crown, vadd(lag, breeze));
    gLimb(b, s.tree0, top, 1.2, 0.85, G_TREE, BARK);
    gLimb(b, top, crown, 0.85, 0.7, G_TREE, BARK);
    const [kx, ky] = gproj(b.cam, crown);
    const R = 4;
    const lobes: [number, number, number][] = [
      [0, 0, R],
      [-R * 0.62, R * 0.18, R * 0.7],
      [R * 0.62, R * 0.2, R * 0.68],
      [-R * 0.3, -R * 0.45, R * 0.62],
      [R * 0.34, -R * 0.4, R * 0.6],
      [0, R * 0.42, R * 0.66],
    ];
    const leaf: GShade = (nx, ny, nz, x, y) => {
      let c = tone(GRASS, nx * LX + ny * LY + nz * LZ);
      const h = hash(x - Math.round(kx) + 50, y - Math.round(ky) + 50, 517);
      const up = y < ky - 1 && x < kx + 1;
      if (h < 0.16) c = up ? GRASS[3] : GRASS[0];
      else if (h < 0.24) c = up ? mixc(GRASS_HI, WHITE, 0.3) : GRASS_HI;
      return [c, null];
    };
    for (const [dx, dy, rr] of lobes) {
      const p3: V3 = vadd(crown, [b.cam.c * dx, -dy / CPH, b.cam.s * dx]);
      gBall(b, p3, rr, rr * 0.92, G_TREE, leaf);
    }
  }

  // Люки, крышки и трубы ракет.
  if (r.hat > 0.04) {
    for (let i = 0; i < 2; i++) {
      const H = s.rot(HATCH[i]);
      const e1 = s.rot(HE1[i]);
      const e2 = s.rot(HE2[i]);
      const Hc = vadd(s.C, vmul(H, BR - 0.2));
      // Крышка на петле у заднего края: откидывается вверх-назад.
      const al = clamp01(r.hat) * 1.95;
      const hinge = vadd(Hc, vmul(e1, -3.1));
      const free = vadd(hinge, vmul(vadd(vmul(e1, Math.cos(al)), vmul(H, Math.sin(al))), 6.2));
      const P = [
        gproj(b.cam, vadd(hinge, vmul(e2, -2.3))),
        gproj(b.cam, vadd(hinge, vmul(e2, 2.3))),
        gproj(b.cam, vadd(free, vmul(e2, 2.3))),
        gproj(b.cam, vadd(free, vmul(e2, -2.3))),
      ];
      const ln = vadd(vmul(e1, -Math.sin(al)), vmul(H, Math.cos(al)));
      const face = gproj(b.cam, vadd(s.C, ln))[2] - dC > 0;
      const lc = face ? IRON[2] : IRON[0];
      gTri(b, P[0], P[1], P[2], lc, G_LID);
      gTri(b, P[0], P[2], P[3], lc, G_LID);
      if (r.tub > 0.02) {
        const dir = vnorm(vadd(vadd(H, [0, 0.9, 0]), vmul(e1, 0.2)));
        TUBES[i].forEach((off, j) => {
          const k = i + j * 2;
          const base = vadd(vadd(Hc, vmul(e1, off)), vmul(H, -1));
          const tip = vadd(base, vmul(dir, 1 + 7 * clamp01(r.tub)));
          gLimb(b, base, tip, 1.6, 1.4, G_TUBE, IRON, 0.1);
          const empty = k < lk.fired;
          gBall(b, vadd(tip, vmul(dir, 0.5)), 1.6, 1.4, G_TUBE, (nx, ny, nz) =>
            empty
              ? [HOLE, null]
              : [
                  tone(tn('#8a2018', '#c83a2a', '#ee6a4a', '#ffb090'), nx * LX + ny * LY + nz * LZ),
                  null,
                ],
          );
        });
      }
    }
  }

  gSeams(b);
  const p = b.p;
  {
    // Контур снаружи силуэта — только в рамке тела, прямо по массиву.
    const D = p.data;
    const add: number[] = [];
    const xa = Math.max(0, b.x0 - 1);
    const xb = Math.min(GW - 1, b.x1 + 1);
    const ya = Math.max(0, b.y0 - 1);
    const yb = Math.min(GH - 1, b.y1 + 1);
    const on = (x: number, y: number) =>
      x >= 0 && y >= 0 && x < GW && y < GH && D[(y * GW + x) * 4 + 3] > 0;
    for (let y = ya; y <= yb; y++)
      for (let x = xa; x <= xb; x++) {
        if (D[(y * GW + x) * 4 + 3]) continue;
        if (on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1)) add.push(y * GW + x);
      }
    for (const i of add) {
      D[i * 4] = INK[0];
      D[i * 4 + 1] = INK[1];
      D[i * 4 + 2] = INK[2];
      D[i * 4 + 3] = 255;
    }
  }
  // Мох и цветы через край силуэта — пушистая кромка, а не ровный контур.
  for (let y = Math.max(1, b.y0); y <= b.y1; y++)
    for (let x = b.x0; x <= b.x1; x++) {
      const m = mossMask[y * GW + x];
      if (!m) continue;
      const above = (y - 1) * GW + x;
      if (b.id[above]) continue;
      const h = hash(x + 3, y + 7, 827);
      if (h < 0.42) p.set(x, y - 1, m === 2 ? MOSS[2] : h < 0.16 ? MOSS[3] : MOSS[2]);
    }
  const lit = b.lit;

  // Точки, нужные эффектам: линза, ядро.
  const lensDir = s.hrot(vnorm([0, -0.06, 1]));
  const lensP = vadd(s.head, vmul(lensDir, HRX * 0.92));
  const [lsx, lsy, lsd] = gproj(b.cam, lensP);
  const lensVis = lsd > gproj(b.cam, s.head)[2] - 1.5;
  const coreN = s.rot(C0);
  const coreP = vadd(s.C, vmul(coreN, BR));
  const [csx, csy, csd] = gproj(b.cam, coreP);
  const coreVis = csd > dC + 3;
  // Излучатели лучей вращения: линза и такая же точка на затылке — оба луча
  // выходят из головы, каждый со своей стороны (v2.88).
  const rearP = vadd(s.head, vmul(s.hrot(vnorm([0, -0.06, -1])), HRX * 0.92));
  const [rsx, rsy, rsd] = gproj(b.cam, rearP);
  const [hsx, hsy, hsd] = gproj(b.cam, s.head);
  const emit: GEmit = {
    head: [hsx, hsy],
    front: [lsx, lsy],
    rear: [rsx, rsy],
    frontVis: lensVis,
    rearVis: rsd > hsd - 1.5,
  };

  // Смаз: сплошная лента по прошлым положениям кулака/стопы — сужается и
  // тает к хвосту, как смаз-кадр в пиксельной анимации. Прозрачность пикселя
  // — наибольшая из ленты (диски не копятся пятнами). Короткий след — нет.
  if (fx.smear)
    for (const trail of fx.smear) {
      let len = 0;
      for (let k = 1; k < trail.length; k++)
        len += Math.hypot(trail[k].x - trail[k - 1].x, trail[k].y - trail[k - 1].y);
      if (len < 5) continue;
      let bx0 = GW;
      let by0 = GH;
      let bx1 = 0;
      let by1 = 0;
      for (const q of trail) {
        bx0 = Math.min(bx0, Math.floor(q.x - q.r - 1));
        by0 = Math.min(by0, Math.floor(q.y - q.r - 1));
        bx1 = Math.max(bx1, Math.ceil(q.x + q.r + 1));
        by1 = Math.max(by1, Math.ceil(q.y + q.r + 1));
      }
      bx0 = Math.max(0, bx0);
      by0 = Math.max(0, by0);
      bx1 = Math.min(GW - 1, bx1);
      by1 = Math.min(GH - 1, by1);
      const bw = bx1 - bx0 + 1;
      const bh = by1 - by0 + 1;
      if (bw <= 0 || bh <= 0) continue;
      const acc = new Float32Array(bw * bh);
      const edge = new Float32Array(bw * bh);
      const n = trail.length;
      for (let k = 0; k < n - 1; k++) {
        const a = trail[k];
        const e = trail[k + 1];
        const steps = Math.max(1, Math.ceil(Math.hypot(e.x - a.x, e.y - a.y) * 2));
        for (let st = 0; st <= steps; st++) {
          const u = (k + st / steps) / (n - 1);
          const x = a.x + ((e.x - a.x) * st) / steps;
          const y = a.y + ((e.y - a.y) * st) / steps;
          const rr = a.r * (1 - u * 0.75);
          const al = 0.85 * (1 - u) * (1 - u * 0.3);
          for (
            let yy = Math.max(by0, Math.floor(y - rr));
            yy <= Math.min(by1, Math.ceil(y + rr));
            yy++
          )
            for (
              let xx = Math.max(bx0, Math.floor(x - rr));
              xx <= Math.min(bx1, Math.ceil(x + rr));
              xx++
            ) {
              const d = Math.hypot(xx + 0.5 - x, yy + 0.5 - y);
              if (d > rr) continue;
              const j = (yy - by0) * bw + (xx - bx0);
              if (al > acc[j]) acc[j] = al;
              if (u < 0.35 && d > rr - 1.1 && al > edge[j]) edge[j] = al;
            }
        }
      }
      for (let j = 0; j < bw * bh; j++) {
        if (acc[j] <= 0.02) continue;
        const x = bx0 + (j % bw);
        const y = by0 + ((j / bw) | 0);
        const id = b.id[y * GW + x];
        const a = id ? acc[j] * 0.4 : acc[j];
        gblend(p, x, y, acc[j] > 0.55 ? ANC[3] : ANC[2], a);
        if (fx.smearLit && edge[j] > 0.3 && !id) gblend(lit, x, y, fx.smearLit, 0.55 * edge[j]);
      }
    }

  // Пар из решёток: на макушке у плеч и из спины.
  if (r.stm > 0.05) {
    const vents = [s.rot(vnorm([-0.45, 0.85, -0.3])), s.rot(vnorm([0.45, 0.85, -0.3]))];
    vents.forEach((v, i) => {
      const [vx, vy] = gproj(b.cam, vadd(s.C, vmul(v, BR)));
      for (let k = 0; k < 3; k++) {
        const ph = (((lk.cyc * 2 + k / 3 + i * 0.37) % 1) + 1) % 1;
        const rr = 1 + ph * 2.2 * r.stm;
        gdisc(
          p,
          vx + Math.sin(k * 2.1 + lk.f * 0.3 + i) * 2 * ph,
          vy - 2 - ph * 9 * r.stm,
          rr,
          WHITE,
          0.5 * r.stm * (1 - ph),
        );
      }
    });
  }

  // Дым из труб после пуска.
  if (fx.smoke)
    fx.smoke.forEach((age, k) => {
      if (age < 0 || age > 0.7) return;
      const i = k % 2;
      const j = Math.floor(k / 2);
      const H = s.rot(HATCH[i]);
      const e1 = s.rot(HE1[i]);
      const dir = vnorm(vadd(vadd(H, [0, 0.9, 0]), vmul(e1, 0.2)));
      const tip = vadd(vadd(vadd(s.C, vmul(H, BR - 1.2)), vmul(e1, TUBES[i][j])), vmul(dir, 8));
      const [tx, ty] = gproj(b.cam, tip);
      const k2 = age / 0.7;
      for (let q = 0; q < 3; q++)
        gdisc(
          p,
          tx + (q - 1) * 1.5 * k2,
          ty - 3 - k2 * 10 - q * 2,
          1.4 + k2 * 2.4,
          hx('#d8d4cc'),
          0.6 * (1 - k2),
        );
    });

  // Вспышка пуска, блик выстрела взгляда, заряд, дуги лопастей — свет.
  if (lk.flash >= 0) {
    const i = lk.flash % 2;
    const j = Math.floor(lk.flash / 2);
    const H = s.rot(HATCH[i]);
    const e1 = s.rot(HE1[i]);
    const dir = vnorm(vadd(vadd(H, [0, 0.9, 0]), vmul(e1, 0.2)));
    const tip = vadd(vadd(vadd(s.C, vmul(H, BR - 1.2)), vmul(e1, TUBES[i][j])), vmul(dir, 9));
    const [tx, ty] = gproj(b.cam, tip);
    gdisc(lit, tx, ty, 4.2, hx('#ffd080'), 0.85);
    gdisc(lit, tx, ty, 2.2, WHITE, 1);
    for (let k = 3; k <= 7; k++) {
      lit.set(Math.round(tx), Math.round(ty - k), alpha(WHITE, 1 - k * 0.12));
      lit.set(
        Math.round(tx - k * 0.7),
        Math.round(ty + k * 0.2),
        alpha(hx('#ffb060'), 0.8 - k * 0.1),
      );
      lit.set(
        Math.round(tx + k * 0.7),
        Math.round(ty + k * 0.2),
        alpha(hx('#ffb060'), 0.8 - k * 0.1),
      );
    }
  }
  if (r.lon > 0.05 && lensVis) {
    // Ореол линзы — всегда; на выстреле — крест лучей.
    const eye = lk.eye;
    gdisc(lit, lsx, lsy, 4 * r.lsz, eye, 0.22 * r.lon);
    const fl = Math.max(fx.flare ?? 0, clamp01(r.lfl));
    if (fl > 0.05) {
      const L = Math.round(3 + fl * 9);
      const c = mixc(eye, WHITE, 0.6);
      for (let k = 2; k <= L; k++) {
        const a = fl * (1 - k / (L + 1));
        lit.set(Math.round(lsx + k), Math.round(lsy), alpha(c, a));
        lit.set(Math.round(lsx - k), Math.round(lsy), alpha(c, a));
        if (k <= L * 0.6) {
          lit.set(Math.round(lsx), Math.round(lsy + k), alpha(c, a * 0.8));
          lit.set(Math.round(lsx), Math.round(lsy - k), alpha(c, a * 0.8));
        }
      }
      gdisc(lit, lsx, lsy, 1.5 + fl * 2.5, WHITE, 0.5 + 0.5 * fl);
    }
  } else if (r.lon > 0.05 && !lensVis) {
    // Смотрит от нас: свет линзы обнимает край головы.
    const [hx2, hy2] = gproj(b.cam, s.head);
    gdisc(
      lit,
      hx2 + (lsx - hx2) * 0.6,
      hy2 + (lsy - hy2) * 0.6,
      6,
      lk.eye,
      0.12 * r.lon + 0.25 * clamp01(r.lfl),
    );
  }
  if (fx.impact) {
    // Контакт: белая вспышка там, где камень встретил землю, кольцо рун и лучи.
    const k = clamp01(fx.impact.k);
    const pts: [number, number][] =
      fx.impact.at === 'hands'
        ? handsScr
        : [gproj(b.cam, s.foot[fx.impact.at]).slice(0, 2) as [number, number]];
    for (const [ix, iy] of pts) {
      gdisc(lit, ix, iy + 2, 5.5 * (1 - k) + 1.5, WHITE, 0.95 * (1 - k));
      const R = 3 + 7 * k;
      for (let a = 0; a < TAU; a += 0.35)
        gdot(lit, ix + Math.cos(a) * R, iy + 2 + Math.sin(a) * R * 0.45, lk.runeC, 0.7 * (1 - k));
      for (let q = 0; q < 5; q++) {
        const a = Math.PI + (q / 4) * Math.PI;
        for (let r = 3; r < 3 + 6 * (1 - k * 0.5); r++)
          gdot(
            lit,
            ix + Math.cos(a) * r * (1 + k),
            iy + 2 + Math.sin(a) * r * 0.8,
            WHITE,
            0.8 * (1 - k) * (1 - r / 10),
          );
      }
    }
  }
  if (fx.charge && fx.charge > 0 && lensVis) {
    // Частицы света стягиваются в линзу по спирали.
    for (let i = 0; i < 6; i++) {
      const ph = (((fx.charge * 2.2 + i / 6) % 1) + 1) % 1;
      const ang = i * 1.7 + ph * 3;
      const d = (1 - ph) * 13;
      gdot(
        lit,
        lsx + Math.cos(ang) * d,
        lsy + Math.sin(ang) * d * 0.7,
        mixc(lk.eye, WHITE, 0.5),
        0.9 * ph,
      );
    }
  }
  if (fx.spin) {
    // Дуги кистей: где кисти были долю оборота назад.
    for (let i = 0; i < 2; i++) {
      const rel = vsub(s.hand[i], s.C);
      for (let k = 1; k <= 7; k++) {
        const q = vadd(s.C, rotYv(rel, -fx.spin * k));
        const [qx, qy] = gproj(b.cam, q);
        const a = 0.75 * (1 - k / 8);
        gdisc(lit, qx, qy, 1.6 - k * 0.12, mixc(lk.runeC, WHITE, 0.3), a);
        if (!b.id[Math.round(qy) * GW + Math.round(qx)]) gdot(p, qx, qy, ANC[3], a * 0.6);
      }
    }
  }
  if (fx.sparks && fx.sparks > 0) {
    // Искры из суставов: короткие росчерки, каждый кадр — свои.
    const pts = [s.sh[0], s.sh[1], s.el[0], s.el[1], s.knee[0], s.knee[1]];
    for (let i = 0; i < pts.length; i++) {
      if (hash(lk.f, i, 931) > fx.sparks * 0.55) continue;
      const [x0, y0] = gproj(b.cam, pts[i]);
      const ang = hash(lk.f, i, 932) * TAU;
      const len = 2 + hash(lk.f, i, 933) * 4;
      for (let k = 0; k < len; k++) {
        const x = x0 + Math.cos(ang) * k;
        const y = y0 + Math.sin(ang) * k + k * k * 0.12;
        gdot(lit, x, y, k < 1 ? WHITE : hx('#ffd060'), 1 - k / (len + 1));
      }
    }
  }
  if (fx.dizzy !== undefined && fx.dizzy >= 0) {
    const [hx2, hy2] = gproj(b.cam, s.head);
    for (let i = 0; i < 3; i++) {
      const a = fx.dizzy * TAU + (i / 3) * TAU;
      const x = Math.round(hx2 + Math.cos(a) * 8);
      const y = Math.round(hy2 - 9 + Math.sin(a) * 2.6);
      const front = Math.sin(a) > 0;
      const c = front ? WHITE : GOLD[2];
      lit.set(x, y, c);
      lit.set(x - 1, y, GOLD[3]);
      lit.set(x + 1, y, GOLD[3]);
      lit.set(x, y - 1, GOLD[3]);
      lit.set(x, y + 1, GOLD[3]);
    }
  }
  if (fx.bits) {
    // Осыпь: клочья мха и лепестки срываются с плеч и падают к ногам.
    const [t, t0, t1, n] = fx.bits;
    for (let i = 0; i < n; i++) {
      const st = t0 + (t1 - t0) * hash(i, 1, 941);
      const age = t - st;
      if (age < 0) continue;
      const dir = s.rot(vnorm([(hash(i, 2, 942) - 0.5) * 1.6, 0.8, (hash(i, 3, 943) - 0.5) * 1.2]));
      const start = vadd(s.C, vmul(dir, BR));
      const [x0, y0] = gproj(b.cam, start);
      const out = (hash(i, 4, 944) - 0.5) * 14;
      const fall = Math.min(GOY - 1 - y0, 60 * age * age + 6 * age);
      const land = y0 + fall >= GOY - 1.5;
      const x = x0 + out * Math.min(1, age * 2.2);
      const y = y0 + fall;
      const life = land ? 1 - clamp01((age - Math.sqrt((GOY - y0) / 60)) / 0.5) : 1;
      if (life <= 0) continue;
      const c = i % 5 === 0 ? FLOWER[i % 3] : MOSS[hash(i, 5, 945) < 0.5 ? 2 : 3];
      p.set(Math.round(x), Math.round(y), alpha(c, life));
      if (i % 3 === 0) p.set(Math.round(x) + 1, Math.round(y), alpha(MOSS[1], life));
    }
  }

  // Купол защитного протокола: полусфера на земле, соты, кромка светится.
  const dk = fx.domeK ?? r.dom;
  if (dk > 0.01) gDome(p, lit, b, s, dk, lk, !!fx.domeHit);
  if (fx.shards !== undefined && fx.shards >= 0 && fx.shards < 0.75)
    gShards(p, lit, s, b, fx.shards);

  return {
    p,
    lit,
    lens: lensVis || r.lon > 0 ? [lsx, lsy] : null,
    core: coreVis ? [csx, csy] : null,
    emit,
    hands: handsScr,
  };
}

const DOME_R = 33;
/** Центр купола — на высоте груди: сфера обнимает стража целиком, пол её срезает. */
const DOME_CY = HB - 4;

/**
 * Слой купола: передняя и задняя оболочки и свечение — относительно центра
 * купола на экране. От поворота стража не зависит (соты стоят в мире), так
 * что лежит в кеше: строится (k), вспыхивает от удара (hit), блик бежит (sh).
 */
interface DomeLayer {
  w: number;
  h: number;
  ox: number;
  oy: number;
  front: Uint8ClampedArray;
  back: Uint8ClampedArray;
  glow: Uint8ClampedArray;
}
const domeCache = new Map<string, DomeLayer>();

/** Геометрия купола — один раз: высота точки оболочки, соты, кромка, блик. */
interface DomeGeo {
  w: number;
  h: number;
  /** На пиксель и оболочку (0 — передняя, 1 — задняя): высота (NaN — нет), флаги. */
  Y: Float32Array;
  lat: Float32Array;
  fres: Float32Array;
  line: Uint8Array;
  rim: Uint8Array;
}
let domeGeo: DomeGeo | null = null;
function gDomeGeo(): DomeGeo {
  if (domeGeo) return domeGeo;
  const R = DOME_R;
  const w = R * 2 + 4;
  const h = R * 2 + 4;
  const n = w * h * 2;
  const g: DomeGeo = {
    w,
    h,
    Y: new Float32Array(n).fill(NaN),
    lat: new Float32Array(n),
    fres: new Float32Array(n),
    line: new Uint8Array(n),
    rim: new Uint8Array(n),
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = (x + 0.5 - (R + 2)) / R;
      const dy = (y + 0.5 - (R + 2)) / R;
      const q = dx * dx + dy * dy;
      if (q > 1) continue;
      const nz = Math.sqrt(1 - q);
      for (let sh = 0; sh < 2; sh++) {
        const z = sh ? -nz : nz;
        const Y = DOME_CY + R * (-dy * CPH + z * SPH);
        if (Y < 0) continue;
        const i = (y * w + x) * 2 + sh;
        const lat = Math.asin(clampR((Y - DOME_CY) / R, -1, 1));
        const u = Math.atan2(dx, z) * 3.6;
        const v = lat * 4.4 + (Math.floor(u) % 2 ? 0.5 : 0);
        g.Y[i] = Y;
        g.lat[i] = lat;
        g.fres[i] = 1 - nz;
        g.line[i] = u - Math.floor(u) < 0.1 || v - Math.floor(v) < 0.12 ? 1 : 0;
        g.rim[i] = q > 0.93 ? 1 : 0;
      }
    }
  return (domeGeo = g);
}

function gDomeLayer(k: number, hit: boolean, sh: number): DomeLayer {
  const key = `${k}|${hit ? 1 : 0}|${sh}`;
  const got = domeCache.get(key);
  if (got) return got;
  const G = gDomeGeo();
  const { w, h } = G;
  const front = new Uint8ClampedArray(w * h * 4);
  const back = new Uint8ClampedArray(w * h * 4);
  const glow = new Uint8ClampedArray(w * h * 4);
  const hTop = (DOME_CY + DOME_R) * clamp01(k);
  const shim = (sh / 12) * 1.3 - 0.15;
  const LINE = mixc(CYAN, WHITE, 0.4);
  const put = (arr: Uint8ClampedArray, i: number, c: RGBA, a: number) => {
    arr[i * 4] = c[0];
    arr[i * 4 + 1] = c[1];
    arr[i * 4 + 2] = c[2];
    arr[i * 4 + 3] = Math.round(clamp01(a) * 255);
  };
  for (let i = 0; i < w * h; i++)
    for (let shl = 0; shl < 2; shl++) {
      const j = i * 2 + shl;
      const Y = G.Y[j];
      if (!(Y <= hTop)) continue;
      const fres = G.fres[j];
      const line = G.line[j] === 1;
      const rim = G.rim[j] === 1;
      const ground = Y < 0.9;
      const band = Math.abs(G.lat[j] / Math.PI + 0.5 - shim) < 0.05;
      const edge = Math.abs(Y - hTop) < 1.3 && k < 0.99;
      // Середина почти прозрачна — страж под куполом читается; к краю плотнее.
      let a =
        (shl ? 0.015 : 0.025) +
        0.22 * fres * fres +
        (line ? 0.08 + 0.22 * fres * fres : 0) +
        (band ? 0.1 : 0);
      if (rim || ground) a += 0.45;
      if (edge) a = 0.95;
      if (hit) a = Math.min(1, a * 1.7 + 0.1);
      const c = edge || rim || ground ? WHITE : line || band ? LINE : CYAN;
      put(shl ? back : front, i, c, Math.min(0.85, a));
      if (!shl && (rim || edge || ground || (line && fres > 0.3) || hit))
        put(glow, i, c, Math.min(1, a * (hit ? 1 : 0.7)));
    }
  const L: DomeLayer = { w, h, ox: DOME_R + 2, oy: DOME_R + 2, front, back, glow };
  // Ступени роста купола (смена протокола) — не копить: они бывают раз в бой.
  if (k >= 0.99) domeCache.set(key, L);
  return L;
}

function gDome(p: Px, lit: Px, b: GBuf, s: GSkel, k: number, lk: GLook, hit: boolean): void {
  const [sx, sy] = gproj(b.cam, [s.C[0], DOME_CY, s.C[2]]);
  const kq = k >= 0.99 ? 1 : Math.round(k * 24) / 24;
  const L = gDomeLayer(kq, hit, Math.round((((lk.cyc % 1) + 1) % 1) * 12) % 12);
  const X0 = Math.round(sx) - L.ox;
  const Y0 = Math.round(sy) - L.oy;
  for (let y = 0; y < L.h; y++)
    for (let x = 0; x < L.w; x++) {
      const X = X0 + x;
      const Y = Y0 + y;
      if (X < 0 || Y < 0 || X >= GW || Y >= GH) continue;
      const i = (y * L.w + x) * 4;
      if (L.back[i + 3] && !b.id[Y * GW + X]) gblend(p, X, Y, L.back, L.back[i + 3] / 255, i);
      if (L.front[i + 3]) gblend(p, X, Y, L.front, L.front[i + 3] / 255, i);
      if (L.glow[i + 3]) gblend(lit, X, Y, L.glow, L.glow[i + 3] / 255, i);
    }
}

/** Осколки упавшего купола: летят от него и падают, гаснут к 0,75 с. */
function gShards(p: Px, lit: Px, s: GSkel, b: GBuf, age: number): void {
  const [sx, sy] = gproj(b.cam, [s.C[0], DOME_CY, s.C[2]]);
  const ground = gproj(b.cam, [s.C[0], 0, s.C[2]])[1];
  for (let i = 0; i < 30; i++) {
    const a = hash(i, 1, 951) * TAU;
    const el = -0.35 + hash(i, 2, 952) * 1.6;
    const x0 = sx + Math.cos(a) * DOME_R * Math.cos(el);
    const y0 = sy - Math.sin(el) * DOME_R * CPH + Math.sin(a) * DOME_R * SPH * Math.cos(el);
    const v = 18 + hash(i, 3, 953) * 24;
    const x = x0 + Math.cos(a) * v * age;
    const y = Math.min(ground + 3, y0 + Math.sin(a) * v * age * 0.4 + 70 * age * age);
    const life = 1 - age / 0.75;
    const c = i % 3 ? CYAN : WHITE;
    p.set(Math.round(x), Math.round(y), alpha(c, 0.9 * life));
    if (i % 2) p.set(Math.round(x) + 1, Math.round(y) + 1, alpha(c, 0.6 * life));
    lit.set(Math.round(x), Math.round(y), alpha(c, life));
  }
}

// ---- Техники: тайминги мозга (метроном) ----

const T_GAZE = BOSS.gazeTrack + BOSS.gazeLock;
const T_SLAM = BOSS.slamWarn;
const T_STOMP = BOSS.stompWarn;
/** Пуски через 0,13 с — как в мозге (`f11_rockets`). */
const ROCKET_GAP = 0.13;
const rocketAt = (k: number) => BOSS.rocketWind + k * ROCKET_GAP;
/** Мозг ждёт 0,3 с после времени «следующего» пуска за последним. */
const T_ROCK = rocketAt(BOSS.rockets) + 0.3;
const T_SPIN = BOSS.spinCharge + BOSS.spinDur;
const T_REC = 0.55;
const T_DIE = 1.6;
/** Первый кадр, на котором событие с временем T уже случилось. */
const fAt = (T: number) => Math.ceil(T * GFPS - 1e-6);
const rocketF = (k: number) => fAt(rocketAt(k));

const IDLE_N = 12;
const IDLE_T = 1.5;
const WALK_N = 12;
const WALK_T = 0.94;
/** Путь за цикл шага (две стопы), пиксели игры. */
const WALK_STRIDE = 24;

/** Покой: корпус «выдыхает» на целый пиксель, кисти — кадром позже. */
function gIdle(t: number, base: GRig): GRig {
  const a = ((t / IDLE_T) % 1) * TAU;
  const r = { ...base };
  const s = Math.round(0.5 - 0.5 * Math.cos(a));
  const s2 = Math.round(0.5 - 0.5 * Math.cos(a - 0.9));
  r.by = base.by - s;
  r.ly = base.ly + (s - s2);
  r.ry = base.ry + (s - s2);
  r.iris = base.iris + 0.07 * Math.sin(a);
  r.trx = 0.8 * Math.sin(a + 0.6);
  if (base.cor > 0.5) r.glo = 0.12 + 0.12 * Math.sin(a * 2);
  return r;
}

/**
 * Шаг великана: опорная стопа едет назад по земле, переносимая — дугой
 * вперёд; корпус садится сразу после постановки, переваливается на опору,
 * плечи крутятся против бёдер, руки маятником.
 */
function gWalk(t: number, base: GRig): GRig {
  const c = (((t / WALK_T) % 1) + 1) % 1;
  const a = c * TAU;
  const r = { ...base };
  const S = 6.2;
  const foot = (p: number): [number, number] => {
    const q = ((p % 1) + 1) % 1;
    if (q < 0.5) return [S - q * 4 * S, 0];
    const k = (q - 0.5) * 2;
    return [-S + k * k * (3 - 2 * k) * 2 * S, Math.sin(k * Math.PI) * 4.4];
  };
  [r.fRz, r.fRy] = foot(c);
  [r.fLz, r.fLy] = foot(c + 0.5);
  r.by = -0.8 - 1.2 * Math.cos(2 * a - 0.75);
  r.bx = 1.7 * Math.sin(a);
  r.rol = 0.06 * Math.sin(a);
  r.tw = -0.09 * Math.cos(a);
  r.pit = 0.08 + 0.025 * Math.cos(2 * a - 0.75);
  r.lz = 1.5 + 5 * Math.cos(a - 0.35);
  r.rz = 1.5 - 5 * Math.cos(a - 0.35);
  r.ly = base.ly + 1.2 * Math.max(0, Math.cos(a - 0.35));
  r.ry = base.ry + 1.2 * Math.max(0, -Math.cos(a - 0.35));
  r.hu = 0.4 * Math.cos(2 * a - 0.75);
  const hitK = Math.pow(Math.max(0, Math.cos(2 * a - 0.35)), 8);
  r.qsy = 1 - 0.03 * hitK;
  r.qsx = 1 + 0.022 * hitK;
  return r;
}

/**
 * Пробуждение (2,4 с, камера на страже): спит, уронив голову, кулаки на
 * полу, весь в мху → по кругу одна за другой загораются руны, страж
 * поднимается рывками сервоприводов, мох осыпается → линза включается
 * рывками и вспыхивает → встаёт во весь рост, руки вверх — рёв → покой.
 */
function gWake(t: number, base: GRig): GRig {
  const dorm: Partial<GRig> = {
    by: -11,
    pit: 0.26,
    hn: 0.42,
    hu: -1.8,
    lon: 0,
    run: 0,
    swp: 0,
    mos: 1.32,
    iris: 0.2,
    glo: 0,
    stm: 0,
    lx: -11,
    ly: -13.5,
    lz: 12,
    rx: 11,
    ry: -13.5,
    rz: 12,
    lfi: 0.3,
    rfi: 0.3,
    fLx: -9.5,
    fRx: 9.5,
    fLz: 6,
    fRz: 6,
  };
  const keys: GKey[] = [
    [0, dorm],
    [0.36, {}],
    [
      0.48,
      {
        by: -9.4,
        pit: 0.22,
        swp: 0.14,
        run: 0.7,
        mos: 1.25,
        ly: -15,
        ry: -15,
        lx: -13,
        rx: 13,
        fLz: 5,
        fRz: 5,
      },
      gOut3,
    ],
    [0.62, { swp: 0.3 }, gLin],
    [
      0.72,
      {
        by: -7.6,
        pit: 0.19,
        swp: 0.45,
        mos: 1.18,
        ly: -16.5,
        ry: -16.5,
        lx: -15,
        rx: 15,
        lz: 10,
        rz: 10,
        fLz: 3.5,
        fRz: 3.5,
      },
      gOut3,
    ],
    [0.86, { swp: 0.62 }, gLin],
    [
      0.96,
      {
        by: -5.6,
        pit: 0.16,
        swp: 0.8,
        mos: 1.11,
        hn: 0.34,
        ly: -18.5,
        ry: -18.5,
        lx: -17,
        rx: 17,
        lz: 8,
        rz: 8,
        fLz: 2,
        fRz: 2,
      },
      gOut3,
    ],
    [1.1, { swp: 1, run: 1 }, gLin],
    [1.3, { hn: 0.3 }],
    [1.48, { hn: -0.12, hu: 0, iris: 0.8 }, gOut3],
    [
      1.64,
      {
        by: -1.6,
        pit: 0.03,
        lx: -24,
        ly: -9,
        lz: 3,
        rx: 24,
        ry: -9,
        rz: 3,
        lfi: 0.6,
        rfi: 0.6,
        mos: 1,
        fLz: 0.8,
        fRz: -0.8,
      },
      gIO,
    ],
    [
      1.9,
      {
        by: 1.8,
        pit: -0.17,
        lx: -16,
        ly: 27,
        lz: -1,
        rx: 16,
        ry: 27,
        rz: -1,
        lfi: 1,
        rfi: 1,
        run: 1.3,
        hn: -0.2,
      },
      gOut3,
    ],
    [2.12, { by: 1.3, pit: -0.15, ly: 28.5, ry: 28.5, lx: -17, rx: 17 }, gIO],
    [BOSS.wake, { ...base }, gIO],
  ];
  const r = gTrack(keys, t, base, { lx: 0.03, rx: 0.03, ly: 0.03, ry: 0.03 });
  const f = Math.floor(t * GFPS + 1e-6);
  const seq: Record<number, number> = { 27: 0.6, 28: 0, 29: 0.9, 30: 0.2 };
  r.lon = f < 27 ? 0 : f in seq ? seq[f] : 1;
  if (f >= 31) r.lfl = Math.max(0, 1 - (t - 31 / GFPS) / 0.4) * 0.9;
  if (f === 31) r.iris = 1;
  if (f >= 5 && f <= 8) r.qdx = f % 2 ? 0.5 : -0.5;
  if (t > 1.92 && t < 2.14) {
    r.qdx = f % 2 ? 0.6 : -0.6;
    r.lfl = Math.max(r.lfl, 0.55);
  }
  return r;
}

/**
 * Взгляд: голова рывком к цели, линза раскрывается → прицел (присел,
 * упёрся ногами, голова вперёд, свет стягивается в линзу) → замер: зрачок
 * сжимается в точку → кадр урона: вспышка, отдача — голова назад, корпус
 * отброшен → луч держится, линза остывает → покой.
 */
function gGaze(t: number, base: GRig): GRig {
  const T = T_GAZE;
  const aim: Partial<GRig> = {
    by: -1.7,
    pit: 0.06,
    hf: 2,
    hn: 0.02,
    lsz: 1.28,
    iris: 0.9,
    lfl: 0.12,
    lx: -20,
    ly: -19.5,
    lz: 5.5,
    rx: 20,
    ry: -19.5,
    rz: 5.5,
    fLx: -9.2,
    fRx: 9.2,
    fLz: 2,
    fRz: -2.2,
    lfi: 0.7,
    rfi: 0.7,
  };
  const keys: GKey[] = [
    [0, {}],
    [
      0.13,
      {
        by: -0.5,
        pit: -0.06,
        hf: 1.4,
        hn: -0.08,
        iris: 1,
        lsz: 1.22,
        lfl: 0.35,
        lz: 4,
        rz: 4,
        ly: -20,
        ry: -20,
        fLx: -8.6,
        fRx: 8.6,
      },
      gOut3,
    ],
    [0.34, aim, gIO],
    [BOSS.gazeTrack, { ...aim, iris: 0.82, lsz: 1.32, lfl: 0.2 }, gLin],
    [BOSS.gazeTrack + 0.08, { by: -2.3, hf: 2.6, iris: 0.2, lsz: 1.2, lfl: 0.5, pit: 0.08 }, gOut3],
    [T - 0.004, { by: -2.6, hf: 2.9, iris: 0.12, lfl: 0.95, pit: 0.09, lsz: 1.16 }, gIn],
    [
      T,
      {
        by: -1.2,
        bz: -2.6,
        pit: -0.13,
        hf: -1.1,
        hn: -0.15,
        iris: 0.06,
        lfl: 1,
        lsz: 1.3,
        lz: -2.5,
        rz: -2.5,
        ly: -16,
        ry: -16,
        qsx: 0.97,
        qsy: 1.035,
      },
      gLin,
    ],
    [
      T + 0.09,
      { bz: -3.6, pit: -0.17, hn: -0.18, hf: -1.5, lfl: 0.92, qsx: 1, qsy: 1, lz: -3.5, rz: -3.5 },
      gOut,
    ],
    [
      T + 0.33,
      {
        bz: -1.4,
        by: -0.5,
        pit: -0.03,
        hf: 0,
        hn: -0.04,
        lfl: 0.3,
        iris: 0.5,
        lsz: 1.08,
        lz: 2,
        rz: 2,
        ly: -18,
        ry: -18,
        lfi: 0.4,
        rfi: 0.4,
      },
      gIO,
    ],
    [T + T_REC, { ...base }, gIO],
  ];
  const r = gTrack(keys, t, base, { lx: 0.05, rx: 0.05, lz: 0.05, rz: 0.05 });
  // Последние кадры замирания — мелкая дрожь от напряжения.
  const f = Math.floor(t * GFPS + 1e-6);
  if (t > T - 0.2 && t < T) r.qdx = f % 2 ? 0.35 : -0.35;
  return r;
}

/**
 * Кулаки сверху: замах назад-вниз → руки дугой ПЕРЕД лицом над головой, страж
 * встаёт на носки → держит, руны бегут к кулакам → дугой вниз с разгоном,
 * выпад и глубокий присед → кадр урона: кулаки в земле, корпус сжат →
 * держит, вздрагивает → выдёргивает → покой.
 */
function gSlam(t: number, base: GRig): GRig {
  const T = T_SLAM;
  const top: Partial<GRig> = {
    by: 2.4,
    pit: -0.2,
    bz: -0.6,
    hn: -0.18,
    lx: -6,
    ly: 31,
    lz: -3,
    rx: 6,
    ry: 31,
    rz: -3,
    lfi: 1,
    rfi: 1,
    fLx: -9.5,
    fRx: 9.5,
    fLz: 2.4,
    fRz: -0.6,
    run: base.run + 0.3,
  };
  const keys: GKey[] = [
    [0, {}],
    [
      0.14,
      {
        by: -2.6,
        pit: 0.12,
        hn: 0.12,
        lx: -19,
        ly: -20,
        lz: -4.5,
        rx: 19,
        ry: -20,
        rz: -4.5,
        lfi: 0.7,
        rfi: 0.7,
        qsx: 1.035,
        qsy: 0.965,
      },
      gOut,
    ],
    [
      0.32,
      {
        by: 0.4,
        pit: -0.05,
        lx: -12,
        ly: 6,
        lz: 16,
        rx: 12,
        ry: 6,
        rz: 16,
        qsx: 1,
        qsy: 1,
        hn: -0.05,
      },
      gIn,
    ],
    [0.5, { ...top, qsx: 0.98, qsy: 1.03 }, gOut3],
    [
      0.76,
      {
        ...top,
        by: 3.1,
        pit: -0.25,
        ly: 33,
        ry: 33,
        lz: -5.5,
        rz: -5.5,
        hn: -0.22,
        qsx: 0.975,
        qsy: 1.035,
        lfl: 0.25,
      },
      gIO,
    ],
    [
      0.835,
      {
        by: 1.2,
        pit: -0.02,
        bz: 1,
        lx: -6,
        ly: 24,
        lz: 14,
        rx: 6,
        ry: 24,
        rz: 14,
        qsx: 1,
        qsy: 1,
        hn: -0.05,
      },
      gIn,
    ],
    [
      0.876,
      { by: -3.8, pit: 0.18, bz: 3.4, lx: -5.5, ly: 4, lz: 23, rx: 5.5, ry: 4, rz: 23, hn: 0.08 },
      gLin,
    ],
    [
      T - 0.003,
      { by: -6, pit: 0.27, bz: 4.8, lx: -5, ly: -13, lz: 21, rx: 5, ry: -13, rz: 21, hn: 0.12 },
      gLin,
    ],
    [
      T,
      {
        by: -7.4,
        pit: 0.33,
        bz: 5.6,
        hn: 0.15,
        lx: -5.5,
        ly: -22.5,
        lz: 20.5,
        rx: 5.5,
        ry: -22.5,
        rz: 20.5,
        qsx: 1.075,
        qsy: 0.9,
        lfl: 0,
        fLz: 4.2,
        fRz: 0.8,
      },
      gLin,
    ],
    [T + 0.07, { by: -6.6, qsx: 1.02, qsy: 0.985, pit: 0.31 }, gOut],
    [T + 0.25, { by: -6.9, pit: 0.32 }, gIO],
    [
      T + 0.36,
      {
        by: -2.8,
        pit: 0.15,
        bz: 2.8,
        ly: -12,
        lz: 13,
        ry: -12,
        rz: 13,
        lfi: 0.6,
        rfi: 0.6,
        run: base.run,
      },
      gOut3,
    ],
    [T + T_REC, { ...base }, gIO],
  ];
  return gTrack(keys, t, base);
}

/** Зеркало рига: левое ↔ правое (топает та нога, что ближе к нам). */
function gMirror(r: GRig): GRig {
  const o = { ...r };
  o.lx = -r.rx;
  o.rx = -r.lx;
  o.ly = r.ry;
  o.ry = r.ly;
  o.lz = r.rz;
  o.rz = r.lz;
  o.lfi = r.rfi;
  o.rfi = r.lfi;
  o.fLx = -r.fRx;
  o.fRx = -r.fLx;
  o.fLy = r.fRy;
  o.fRy = r.fLy;
  o.fLz = r.fRz;
  o.fRz = r.fLz;
  o.bx = -r.bx;
  o.rol = -r.rol;
  o.tw = -r.tw;
  o.ht = -r.ht;
  return o;
}

/**
 * Топот (фазы 3–4): вес на левую → правое колено высоко, руки в стороны для
 * равновесия, взгляд в пол → держит → стопа вниз с разгоном → кадр урона:
 * корпус проседает, руки хлёстом вниз → качнулся обратно → покой.
 */
function gStomp(t: number, base: GRig): GRig {
  const T = T_STOMP;
  const keys: GKey[] = [
    [0, {}],
    [0.1, { bx: -2.4, rol: -0.08, by: -1.2, lx: -24, ly: -14, rx: 24, ry: -14, fLx: -7.2 }, gOut],
    [
      0.4,
      {
        bx: -3.2,
        rol: -0.11,
        by: 2.2,
        pit: -0.1,
        fRx: 8.2,
        fRy: 15,
        fRz: 6,
        lx: -25,
        ly: -8,
        lz: 3,
        rx: 26,
        ry: -6,
        rz: -2,
        hn: 0.22,
        lfi: 0.8,
        rfi: 0.8,
      },
      gOut3,
    ],
    [0.58, { bx: -3.4, rol: -0.12, by: 3, fRy: 17, fRz: 6.5, ly: -6, ry: -4, pit: -0.13 }, gIO],
    [
      T - 0.003,
      { bx: -1.6, rol: -0.03, by: -2.4, fRy: 2.2, fRz: 3.4, ly: -12, ry: -11, pit: 0.04 },
      gIn,
    ],
    [
      T,
      {
        bx: -0.8,
        rol: 0.03,
        by: -4.2,
        fRy: 0,
        fRz: 3.4,
        pit: 0.09,
        lx: -22,
        ly: -19,
        rx: 23,
        ry: -19,
        qsx: 1.075,
        qsy: 0.9,
        hn: 0.15,
      },
      gLin,
    ],
    [T + 0.07, { by: -3.2, qsx: 1.02, qsy: 0.985 }, gOut],
    [T + 0.24, { by: -2.8, rol: 0.01 }, gIO],
    [T + T_REC, { ...base }, gIO],
  ];
  return gTrack(keys, t, base, { lx: 0.04, rx: 0.04, ly: 0.04, ry: 0.04 });
}

/**
 * Ракеты (фазы 2 и 4): щелчок замков → люки распахиваются с перелётом,
 * страж приседает и задирает голову → трубы выдвигаются → пять пусков по
 * очереди с плеч: каждый — вспышка на своей трубе и отдача в то плечо →
 * трубы уходят, люки хлопают → покой.
 */
function gRock(t: number, base: GRig): GRig {
  const keys: GKey[] = [
    [0, {}],
    [0.07, { hat: 0.12, by: -0.8 }, gOut],
    [0.14, { hat: 0.1 }],
    [
      0.32,
      {
        hat: 1,
        by: -2.6,
        pit: -0.1,
        hn: -0.28,
        lx: -25,
        ly: -19,
        lz: -2,
        rx: 25,
        ry: -19,
        rz: -2,
        fLx: -9.6,
        fRx: 9.6,
        fLz: 1.6,
        fRz: -1.6,
        lfi: 1,
        rfi: 1,
      },
      gBack,
    ],
    [0.56, { tub: 1 }, gOut3],
    [rocketAt(BOSS.rockets - 1) + 0.12, { tub: 1, hn: -0.3 }],
    [1.38, { tub: 0, hn: -0.1, by: -1.8 }, gIO],
    [1.52, { hat: 0, by: -1 }, gIn],
    [T_ROCK, { by: -0.6, pit: 0, hn: 0 }, gOut],
    [T_ROCK + T_REC, { ...base }, gIO],
  ];
  const r = gTrack(keys, t, base, { lx: 0.04, rx: 0.04 });
  for (let k = 0; k < BOSS.rockets; k++) {
    const tk = rocketF(k) / GFPS;
    if (t < tk - 1e-6) continue;
    const e = Math.exp(-(t - tk) / 0.07);
    const side = k % 2 ? 1 : -1;
    r.rol += side * 0.065 * e;
    r.by -= 1.3 * e;
    r.hn -= 0.05 * e;
    if (side < 0) r.ly -= 2 * e;
    else r.ry -= 2 * e;
  }
  return r;
}

/**
 * Вращение (фаза 3): заряд 0,95 с — широкая стойка, руки в стороны, голова
 * уходит в плечи, ядро раскаляется добела, мелкая дрожь → верх стража
 * крутится над ногами (поворот задаёт рисовальщик по `sa`), руки —
 * лопасти, качаются, как у волчка → руки падают, корпус шатает.
 */
function gSpin(t: number, base: GRig): GRig {
  const C = BOSS.spinCharge;
  const keys: GKey[] = [
    [0, {}],
    [
      0.24,
      {
        by: -2.6,
        fLx: -10.5,
        fRx: 10.5,
        fLz: 0.5,
        fRz: -0.5,
        lx: -32,
        ly: -4,
        lz: 0,
        rx: 32,
        ry: -4,
        rz: 0,
        hu: -1.6,
        lsz: 0.9,
        glo: 0.25,
        lfi: 0,
        rfi: 0,
        stm: 1,
      },
      gOut3,
    ],
    [C - 0.003, { by: -3.2, lx: -40, ly: 1.5, rx: 40, ry: 1.5, glo: 1, run: 1.3 }, gIn],
    [C + 0.12, { glo: 1.25, by: -2.6 }, gOut],
    [T_SPIN, { glo: 1.1 }, gLin],
    [
      T_SPIN + 0.18,
      { lx: -24, ly: -10, lz: 2, rx: 24, ry: -10, rz: 2, glo: 0.5, by: -2, hu: -0.6 },
      gOut,
    ],
    [T_SPIN + T_REC, { ...base }, gIO],
  ];
  const r = gTrack(keys, t, base);
  const f = Math.floor(t * GFPS + 1e-6);
  if (t > C - 0.32 && t < C) r.qdx = (f % 2 ? 0.45 : -0.45) * clamp01((t - (C - 0.32)) / 0.32);
  if (t >= C && t < T_SPIN) {
    const w = Math.sin((t - C) * 9);
    r.ly += w * 1.4;
    r.ry -= w * 1.4;
    r.by += Math.sin((t - C) * 18) * 0.35;
  }
  if (t >= T_SPIN) {
    const k = clamp01((t - T_SPIN) / T_REC);
    r.rol += Math.sin(k * 14) * 0.07 * (1 - k);
    r.stm = 1;
    // Переступает, разворачивая ноги за корпусом.
    const st = Math.sin(k * Math.PI * 3);
    r.fLy = Math.max(0, st) * 2.5 * (1 - k);
    r.fRy = Math.max(0, -st) * 2.5 * (1 - k);
  }
  return r;
}

/**
 * Смена протокола (1,3 с, неуязвим): удар-толчок, глаз гаснет и включается,
 * руны заново по кругу — и своя сцена на фазу: «Защитный протокол» —
 * руки крестом, купол растёт от земли; «Перегрев» — плита ядра рвётся в
 * стороны, страж выгибается, пар; «Падение острова» — трещины бегут от ядра,
 * мох осыпается, страж валится вперёд и встаёт злее.
 */
function gShift(t: number, base: GRig, ph: number): GRig {
  const jolt: GKey[] = [
    [0.1, { by: -2.2, pit: 0.12, hn: 0.15, qsx: 1.04, qsy: 0.96 }, gOut3],
    [0.2, { qsx: 1, qsy: 1 }, gOut],
  ];
  let keys: GKey[];
  if (ph === 2)
    keys = [
      [0, { dom: 0 }],
      ...jolt,
      [
        0.42,
        {
          by: -2.8,
          lx: 6,
          ly: 4,
          lz: 18.5,
          rx: -6,
          ry: 6.5,
          rz: 19.5,
          lfi: 1,
          rfi: 1,
          hu: -2,
          hn: 0.2,
          pit: 0.1,
          swp: 0.1,
        },
        gOut3,
      ],
      [0.62, { swp: 0.4 }, gLin],
      [0.98, { swp: 1, run: 1.35 }, gLin],
      [
        1.08,
        {
          by: -1.5,
          lx: -27,
          ly: -6,
          lz: 3,
          rx: 27,
          ry: -6,
          rz: 3,
          hu: 0,
          hn: -0.08,
          pit: -0.06,
          qsx: 0.97,
          qsy: 1.03,
        },
        gOut3,
      ],
      [BOSS.shift, { ...base }, gIO],
    ];
  else if (ph === 3)
    keys = [
      [0, { cor: 0, glo: 0, stm: 0 }],
      ...jolt,
      [
        0.44,
        {
          by: -3,
          pit: 0.16,
          hn: 0.22,
          lx: -14,
          ly: -6,
          lz: 9,
          rx: 14,
          ry: -6,
          rz: 9,
          lfi: 1,
          rfi: 1,
          glo: 0.6,
        },
        gIO,
      ],
      [0.5, { cor: 0.15 }, gLin],
      [
        0.6,
        {
          cor: 1,
          glo: 1.2,
          by: 0.8,
          pit: -0.24,
          hn: -0.22,
          lx: -27,
          ly: -8,
          lz: -7,
          rx: 27,
          ry: -8,
          rz: -7,
          qsx: 0.96,
          qsy: 1.05,
          stm: 1,
        },
        gOut3,
      ],
      [0.95, { glo: 0.9, by: 0.4, pit: -0.2, qsx: 1, qsy: 1 }, gIO],
      [BOSS.shift, { ...base }, gIO],
    ];
  else
    keys = [
      [0, { mos: 1, tre: 0, crk: 0 }],
      ...jolt,
      [0.48, { crk: 1, by: -2.6, hn: 0.18 }, gIn],
      [
        0.62,
        {
          by: -4,
          pit: 0.22,
          bz: 2.2,
          fRz: 4.5,
          fRx: 8.4,
          hn: 0.25,
          lx: -23,
          ly: -15,
          lz: 8,
          rx: 22,
          ry: -20,
          rz: 6,
          mos: base.mos,
          tre: 0.25,
        },
        gIn,
      ],
      [0.72, { qsx: 1.05, qsy: 0.94 }, gLin],
      [0.84, { qsx: 1, qsy: 1, by: -3.2 }, gOut],
      [
        1.12,
        {
          by: 0.9,
          pit: 0.04,
          bz: 0.5,
          hn: -0.1,
          lsz: 1.2,
          lfi: 1,
          rfi: 1,
          lx: -23,
          ly: -16,
          rx: 23,
          ry: -16,
          tre: base.tre,
        },
        gOut3,
      ],
      [BOSS.shift, { ...base }, gIO],
    ];
  const r = gTrack(keys, t, base);
  const f = Math.floor(t * GFPS + 1e-6);
  if (f >= 1 && f <= 6) r.lon = [0, 0.4, 0, 0, 0.7, 0][f - 1];
  if (f === 7) r.lfl = 0.8;
  if (ph !== 2) r.swp = f < 3 ? 1 : clamp01((t - 0.15) / 0.7);
  if (f < 4) r.qdx = f % 2 ? 0.9 : -0.9;
  if (ph === 4 && t > 0.2 && t < 0.62) r.rol = f % 4 < 2 ? 0.05 : -0.05;
  return r;
}

/**
 * Переступ (0,3 с): страж разворачивается на месте — корпус уже на новой
 * стороне, ноги догоняют (это делает рисовальщик поворотом корня), стопа со
 * стороны поворота поднимается и ставится с приседом, руки качнулись.
 */
const TURN_T = 0.3;
function gTurn(t: number, base: GRig, dir: number): GRig {
  const k = clamp01(t / TURN_T);
  const r = gIdle(0, base);
  const lift = Math.sin(k * Math.PI);
  if (dir > 0) {
    r.fRy = 3.2 * lift;
    r.fRz = base.fRz - 1.6 * (1 - k);
  } else {
    r.fLy = 3.2 * lift;
    r.fLz = base.fLz - 1.6 * (1 - k);
  }
  r.rol = -dir * 0.05 * lift;
  r.bx = -dir * 1.2 * lift;
  const plant = k > 0.65 ? Math.sin(((k - 0.65) / 0.35) * Math.PI) : 0;
  r.by = base.by - 0.9 * plant;
  r.qsy = 1 - 0.025 * plant;
  r.qsx = 1 + 0.02 * plant;
  r.lz = base.lz - dir * 2 * lift;
  r.rz = base.rz + dir * 2 * lift;
  r.trx = -dir * 1.5 * lift;
  return r;
}

const STAG_IN = 0.7;
const STAG_TRY = 2.45;
const STAG_TRY_END = 3.32;
const STAG_RISE = 4.6;
const STAG_LOOP_N = 12;
const STAG_LOOP_FPS = 8;

/**
 * На колене (купол пал, 5,5 с): купол лопается → колени подламываются,
 * страж падает на колено, правой рукой упирается в пол, голова повисла →
 * тяжело дышит, искрит, дымит, глаз мигает, звёзды → пытается встать — и
 * оседает обратно → глаз вспыхивает, толкается рукой и встаёт.
 */
function gStag(t: number, base: GRig): GRig {
  const kneel: Partial<GRig> = {
    by: -8.2,
    bz: 2,
    pit: 0.2,
    rol: -0.05,
    hn: 0.38,
    hu: -1.8,
    fLx: -8.5,
    fLz: 5.5,
    fLy: 0,
    fRx: 8,
    fRz: -7.5,
    fRy: 0,
    rx: 15,
    ry: -19.5,
    rz: 9,
    rfi: 0,
    lx: -19,
    ly: -14,
    lz: 5,
    lfi: 0.3,
    lon: 0.35,
    iris: 0.3,
    run: base.run * 0.4,
    dom: 0,
  };
  const keys: GKey[] = [
    [0, { dom: 0 }],
    [0.12, { by: 1, pit: -0.1, hn: -0.15, lfl: 0.6 }, gOut],
    [0.5, kneel, gIn],
    [0.56, { qsx: 1.06, qsy: 0.93 }, gLin],
    [STAG_IN, { qsx: 1, qsy: 1 }, gOut],
    [STAG_TRY, {}],
    [2.85, { by: -5.2, pit: 0.12, hn: 0.2, ry: -21, rz: 10, lon: 0.6 }, gIO],
    [3.0, { by: -5 }],
    [3.18, { by: -8.6, pit: 0.22, hn: 0.42, lon: 0.25, qsx: 1.04, qsy: 0.95 }, gIn],
    [STAG_TRY_END, { by: -8.2, qsx: 1, qsy: 1 }, gOut],
    [STAG_RISE, {}],
    [4.75, { lon: 1, lfl: 0.9, iris: 1, hn: 0.1 }, gOut],
    [5.1, { by: -3, pit: 0.08, bz: 1, fRz: 2, ry: -12, rz: 5, hn: -0.05, hu: 0, lfl: 0.3 }, gIO],
    [
      5.36,
      {
        by: 0.8,
        pit: -0.02,
        bz: 0,
        rol: 0,
        fLx: base.fLx,
        fLz: base.fLz,
        fRx: base.fRx,
        fRz: base.fRz,
        lfl: 0.1,
        run: base.run,
      },
      gOut3,
    ],
    [BOSS.stagger, { ...base, dom: 0 }, gIO],
  ];
  const r = gTrack(keys, t, base, { lx: 0.06, ly: 0.06 });
  if (t > STAG_IN && t < STAG_RISE && !(t > STAG_TRY && t < STAG_TRY_END)) {
    const ph = ((t - STAG_IN) / 1.5) % 1;
    r.by += Math.round(0.5 - 0.5 * Math.cos(ph * TAU)) * -0.7;
    r.lon = [0.35, 0.3, 0.55, 0.3, 0.25, 0.6, 0.35, 0.2][Math.floor(t * STAG_LOOP_FPS) % 8];
    r.stm = 1;
  }
  return r;
}

/**
 * Смерть (1,6 с): последний рывок и вспышка линзы → глаз гаснет рывками,
 * руны — обратным кругом → колени подламываются, страж садится на землю,
 * руки падают, голова повисла → мох и цветы осыпаются, деревце клонится и
 * пружинит → статуя тает.
 */
function gDie(t: number, base: GRig): GRig {
  const keys: GKey[] = [
    [0, {}],
    [0.1, { by: 1, pit: -0.12, hn: -0.2, iris: 1 }, gOut],
    [0.32, { by: 0, pit: -0.05, hn: 0.05 }, gIO],
    [
      0.95,
      {
        by: -11.4,
        pit: 0.3,
        bz: 1.5,
        hn: 0.48,
        hu: -2.2,
        lx: -23,
        ly: -12,
        lz: 6,
        rx: 23,
        ry: -12,
        rz: 6,
        lfi: 0,
        rfi: 0,
        fLx: -9,
        fLz: 5,
        fRx: 9,
        fRz: 5,
      },
      gIn,
    ],
    [1.02, { qsx: 1.06, qsy: 0.93, by: -11.8 }, gLin],
    [1.14, { qsx: 1, qsy: 1, by: -11.2 }, gOut],
    [T_DIE, { by: -11.4 }],
  ];
  const r = gTrack(keys, t, base, { lx: 0.08, rx: 0.06, ly: 0.08, ry: 0.06 });
  const seq: [number, number][] = [
    [0, 1],
    [0.16, 0.3],
    [0.2, 0.9],
    [0.27, 0.15],
    [0.33, 0.55],
    [0.4, 0.1],
    [0.46, 0],
  ];
  r.lon = 1;
  for (const [at, v] of seq) if (t >= at) r.lon = v;
  r.lfl = t < 0.14 ? 1 : Math.max(0, 0.7 - (t - 0.14) * 3);
  r.swp = 1 - clamp01((t - 0.15) / 0.5);
  r.glo = 0;
  r.heat = 1 - clamp01((t - 0.45) / 0.75);
  r.stm = t < 0.5 ? base.stm : 0;
  r.mos = base.mos * (1 - 0.8 * clamp01((t - 0.55) / 0.8));
  const k = clamp01((t - 0.6) / 0.55);
  const bounce =
    t > 1.15 ? Math.sin((t - 1.15) * 18) * 0.12 * Math.max(0, 1 - (t - 1.15) / 0.3) : 0;
  r.tre = base.tre + gIn(k) * (1.05 - base.tre) - bounce;
  r.alp = 1 - clamp01((t - 1.25) / 0.35);
  return r;
}

// ---- Кадр по запросу: техника, кадр, сторона, фаза ----

type GTech =
  | 'idle'
  | 'walk'
  | 'turn'
  | 'wake'
  | 'gaze'
  | 'slam'
  | 'stomp'
  | 'rock'
  | 'spin'
  | 'shift'
  | 'stag'
  | 'die';

/** Откуда пришёл `recover` (подсказка листу кадров — `m.data.vFrom`). */
const G_FROM: Record<number, GTech> = { 1: 'gaze', 2: 'slam', 3: 'stomp', 4: 'rock', 5: 'spin' };
const G_FROM_MODE: Record<string, GTech> = {
  f11_gaze: 'gaze',
  f11_slam: 'slam',
  f11_stomp: 'stomp',
  f11_rockets: 'rock',
  f11_spin: 'spin',
};
/** Время удара (граница с `recover`) и число кадров с возвратом. */
const G_HIT: Partial<Record<GTech, number>> = {
  gaze: T_GAZE,
  slam: T_SLAM,
  stomp: T_STOMP,
  rock: T_ROCK,
  spin: T_SPIN,
};
function gSpan(tech: GTech): number {
  const T = G_HIT[tech];
  if (T !== undefined) return fAt(T) + Math.ceil(T_REC * GFPS);
  if (tech === 'wake') return Math.ceil(BOSS.wake * GFPS);
  if (tech === 'shift') return Math.ceil(BOSS.shift * GFPS);
  if (tech === 'die') return Math.ceil(T_DIE * GFPS);
  if (tech === 'turn') return Math.ceil(TURN_T * GFPS);
  return IDLE_N;
}

/** Время техники по номеру кадра. До удара — f/24; с удара — от его времени. */
function gTimeOf(tech: GTech, f: number): number {
  if (tech === 'idle') return (f / IDLE_N) * IDLE_T;
  if (tech === 'walk') return (f / WALK_N) * WALK_T;
  if (tech === 'stag') {
    if (f >= 300) return STAG_RISE + (f - 300) / GFPS;
    if (f >= 200) return STAG_TRY + (f - 200) / GFPS;
    if (f >= 100) return STAG_IN + (f - 100) / STAG_LOOP_FPS;
    return f / GFPS;
  }
  const T = G_HIT[tech];
  if (T === undefined) return f / GFPS;
  const fT = fAt(T);
  return f < fT ? f / GFPS : T + (f - fT) / GFPS;
}

/** Кадр колена по времени режима: вход, круг дыхания, попытка встать, подъём. */
function gStagF(t: number): number {
  if (t < STAG_IN) return Math.floor(t * GFPS);
  if (t < STAG_TRY || (t >= STAG_TRY_END && t < STAG_RISE)) {
    const from = t < STAG_TRY ? STAG_IN : STAG_TRY_END;
    return 100 + (Math.floor((t - from) * STAG_LOOP_FPS) % STAG_LOOP_N);
  }
  if (t < STAG_TRY_END) return 200 + Math.floor((t - STAG_TRY) * GFPS);
  return (
    300 +
    Math.min(Math.ceil((BOSS.stagger - STAG_RISE) * GFPS) - 1, Math.floor((t - STAG_RISE) * GFPS))
  );
}

function gRigAt(tech: GTech, t: number, base: GRig, ph: number, mir = false, sd = 0): GRig {
  switch (tech) {
    case 'turn':
      return gTurn(Math.max(0, t), base, sd || 1);
    case 'idle':
      return gIdle(((t % IDLE_T) + IDLE_T) % IDLE_T, base);
    case 'walk':
      return gWalk(t, base);
    case 'wake':
      return gWake(Math.max(0, t), base);
    case 'gaze':
      return gGaze(Math.max(0, t), base);
    case 'slam':
      return gSlam(Math.max(0, t), base);
    case 'stomp':
      return mir ? gMirror(gStomp(Math.max(0, t), base)) : gStomp(Math.max(0, t), base);
    case 'rock':
      return gRock(Math.max(0, t), base);
    case 'spin':
      return gSpin(Math.max(0, t), base);
    case 'shift':
      return gShift(Math.max(0, t), base, ph);
    case 'stag':
      return gStag(Math.max(0, t), base);
    case 'die':
      return gDie(Math.max(0, t), base);
  }
}

/** Что просит рисовальщик: всё, что входит в ключ кеша. */
interface GReq {
  tech: GTech;
  f: number;
  /** Ноги и корпус: сторона в 1/64 оборота. */
  yb: number;
  /** Верх (вращение): сторона в 1/64 оборота, иначе = yb. */
  ub: number;
  /** Доворот головы к цели, шаги по 0,1 рад. */
  hd: number;
  /** Куда крутится верх на вращении: знак изменения поворота (0 — не крутится). */
  sd: number;
  ph: number;
  sh: number;
  look: MobPose['look'];
  flash: boolean;
  /** Удар героя по куполу — купол вспыхивает вместо тела. */
  dh: boolean;
}

const YAW_N = 64;
const YAW_STEP = TAU / YAW_N;
const angWrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/**
 * Куда смотрит страж (угол мира) → поворот корпуса. Камера сверху: «вправо»
 * читается три четверти к нам, а не чистым профилем, — так линза видна.
 */
const gYawOf = (face: number) => Math.atan2(Math.cos(face), Math.sin(face) + 0.85);

/** Эффекты кадра по технике. */
function gFxOf(q: GReq, t: number, base: GRig, s: GSkel, at: (tt: number) => GSkel): GFx {
  const fx: GFx = {};
  // Крона отстаёт от плеча: где оно было долю секунды назад.
  const a1 = at(t - 0.07).tree0;
  const a2 = at(t - 0.14).tree0;
  let lag = vadd(vmul(vsub(a1, s.tree0), 0.95), vmul(vsub(a2, a1), 0.4));
  const ll = vlen(lag);
  if (ll > 4.5) lag = vmul(lag, 4.5 / ll);
  fx.crown = lag;
  const cam = gcam(q.yb * YAW_STEP);
  const trail = (pick: (sk: GSkel) => V3, r: number, n: number, dt: number) => {
    const pts: { x: number; y: number; r: number }[] = [];
    for (let k = 0; k < n; k++) {
      const [x, y] = gproj(cam, pick(k ? at(t - k * dt) : s));
      pts.push({ x, y, r });
    }
    return pts;
  };
  switch (q.tech) {
    case 'wake':
      fx.bits = [t, 0.4, 1.95, 16];
      break;
    case 'gaze':
      if (t > 0.18 && t < T_GAZE) fx.charge = (t - 0.18) * 1.1;
      break;
    case 'slam':
      if (t > 0.79 && t < T_SLAM + 0.05) {
        fx.smear = [0, 1].map((i) =>
          trail(
            (sk) => vadd(sk.hand[i], vmul(vnorm(vsub(sk.hand[i], sk.el[i])), 1.2)),
            4.2,
            7,
            1 / 110,
          ),
        );
        fx.smearLit = mixc(runeOf(q.ph), WHITE, 0.3);
      }
      if (t > 0.42 && t < T_SLAM) fx.armCharge = clamp01((t - 0.42) / 0.4);
      if (t >= T_SLAM - 1e-6 && t < T_SLAM + 0.1)
        fx.impact = { at: 'hands', k: (t - T_SLAM) / 0.1 };
      break;
    case 'stomp':
      if (t > 0.58 && t < T_STOMP + 0.04) {
        const i = Math.sin(q.yb * YAW_STEP) > 0 ? 0 : 1;
        fx.smear = [trail((sk) => sk.foot[i], 4, 6, 1 / 100)];
      }
      if (t >= T_STOMP - 1e-6 && t < T_STOMP + 0.1)
        fx.impact = { at: Math.sin(q.yb * YAW_STEP) > 0 ? 0 : 1, k: (t - T_STOMP) / 0.1 };
      break;
    case 'rock': {
      fx.smoke = [];
      for (let k = 0; k < BOSS.rockets; k++) {
        const tk = rocketF(k) / GFPS;
        fx.smoke.push(t >= tk - 1e-6 ? t - tk : -1);
      }
      break;
    }
    case 'spin':
      if (t > BOSS.spinCharge && t < T_SPIN + 0.12) {
        // Поворот корпуса идёт против знака `sdir`: угол мира растёт — поворот убывает.
        fx.spin = 0.11 * (q.sd || -1);
        fx.bladeGlow = t < T_SPIN ? 0.7 : 0.3;
      }
      break;
    case 'shift':
      if (q.ph === 2) fx.domeK = gOut3(clamp01((t - 0.42) / 0.62));
      if (q.ph === 4) {
        fx.bits = [t, 0.3, 1.1, 12];
        if (t > 0.18 && t < 0.7) fx.sparks = 0.6;
      }
      if (q.ph === 3 && t > 0.55 && t < 0.9) fx.sparks = 0.5;
      break;
    case 'stag':
      fx.shards = t < 0.75 ? t : -1;
      if (t > 0.45 && t < STAG_RISE) fx.sparks = t > STAG_TRY && t < STAG_TRY_END ? 0.9 : 0.55;
      if (t > STAG_IN && t < 4.85) fx.dizzy = ((t - STAG_IN) / 1.5) % 1;
      break;
    case 'die':
      fx.bits = [t, 0.55, 1.35, 22];
      if (t > 0.08 && t < 0.6) fx.sparks = 0.8;
      break;
    default:
      break;
  }
  return fx;
}

const GFR = frameLRU<MobFrame>(420);
/** Где линза и ядро в кадре (для «Техник»: луч из линзы, лучи из ядра). */
const gPts = new WeakMap<
  MobFrame,
  { lens: [number, number] | null; core: [number, number] | null; emit: GEmit }
>();

function gCanvas(p: Px, x0: number, y0: number, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (g) {
    const img = g.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      const o = ((y0 + y) * p.w + x0) * 4;
      img.data.set(p.data.subarray(o, o + w * 4), y * w * 4);
    }
    g.putImageData(img, 0, 0);
  }
  return c;
}

/** Последний кадр рендера — сколько мс он рисовался (замер для отчёта). */
export const f11GuardStat = { frames: 0, ms: 0, max: 0 };

function gBuild(q: GReq): MobFrame {
  const key = `b|${q.tech}|${q.f}|${q.yb}|${q.ub}|${q.sd}|${q.hd}|${q.ph}|${q.sh}|${q.look}|${q.dh ? 1 : 0}`;
  const got = GFR.get(key);
  if (got) return got;
  const t0 = performance.now();
  const t = gTimeOf(q.tech, q.f);
  const base = gBase(q.ph, q.sh > 0);
  const twist = angWrap((q.ub - q.yb) * YAW_STEP);
  // Топает ближняя к нам нога: смотрит вправо — левая.
  const mir = q.tech === 'stomp' && Math.sin(q.yb * YAW_STEP) > 0;
  const rigAt = (tt: number) => {
    const r = gRigAt(q.tech, tt, base, q.ph, mir, q.sd);
    r.ht += q.hd * 0.1;
    r.tw += twist;
    return r;
  };
  const r = rigAt(t);
  const s = gSkel(r);
  const fx = gFxOf(q, t, base, s, (tt) => gSkel(rigAt(tt)));
  if (q.dh) fx.domeHit = true;
  let fired = 0;
  let flash = -1;
  if (q.tech === 'rock')
    for (let k = 0; k < BOSS.rockets; k++) {
      const fk = rocketF(k);
      if (q.f >= fk) fired = k + 1;
      if (q.f === fk || q.f === fk + 1) flash = k;
    }
  const loop =
    q.tech === 'idle' || q.tech === 'walk' || (q.tech === 'stag' && q.f >= 100 && q.f < 200);
  const lk: GLook = {
    ph: q.ph,
    eye: eyeOf(q.ph),
    runeC: runeOf(q.ph),
    rph: q.tech === 'idle' ? q.f / IDLE_N : -1,
    f: loop ? q.f % 100 : q.f,
    cyc: loop ? (q.f % 100) / (q.tech === 'stag' ? STAG_LOOP_N : IDLE_N) : t * 1.3,
    fired,
    flash,
  };
  const out = gPaint(q.yb * YAW_STEP, s, lk, fx);
  const p = out.p;
  if (q.look === 'elite') p.outline(GOLDK);
  // Холст — по рамке нарисованного.
  let x0 = GW;
  let y0 = GH;
  let x1 = -1;
  let y1 = -1;
  for (const src of [p, out.lit]) {
    const u = new Uint32Array(src.data.buffer, src.data.byteOffset, GW * GH);
    for (let y = 0; y < GH; y++) {
      const row = y * GW;
      for (let x = 0; x < GW; x++)
        if (u[row + x] >>> 24) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
    }
  }
  if (x1 < 0) {
    x0 = GOX;
    y0 = GOY - 1;
    x1 = GOX;
    y1 = GOY;
  }
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const fr: MobFrame = {
    img: gCanvas(p, x0, y0, w, h),
    lit: gCanvas(out.lit, x0, y0, w, h),
    ax: GOX - x0,
    ay: GOY - y0,
    eye: null,
    dx: r.qdx,
    dy: r.qdy,
    sx: r.qsx,
    sy: r.qsy,
    rot: r.qrot,
    still: true,
    shadow: q.tech === 'die' ? 21 : 19,
    alpha: r.alp,
  };
  const e = out.emit;
  gPts.set(fr, {
    lens: out.lens ? [out.lens[0] - x0, out.lens[1] - y0] : null,
    core: out.core ? [out.core[0] - x0, out.core[1] - y0] : null,
    emit: {
      head: [e.head[0] - x0, e.head[1] - y0],
      front: [e.front[0] - x0, e.front[1] - y0],
      rear: [e.rear[0] - x0, e.rear[1] - y0],
      frontVis: e.frontVis,
      rearVis: e.rearVis,
    },
  });
  const ms = performance.now() - t0;
  f11GuardStat.frames += 1;
  f11GuardStat.ms += ms;
  f11GuardStat.max = Math.max(f11GuardStat.max, ms);
  return GFR.set(key, fr);
}

function gFlashCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const g = c.getContext('2d');
  if (g) {
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.fillRect(0, 0, c.width, c.height);
  }
  return c;
}

function gFrame(q: GReq): MobFrame {
  if (!q.flash) return gBuild(q);
  const key = `w|${q.tech}|${q.f}|${q.yb}|${q.ub}|${q.sd}|${q.hd}|${q.ph}|${q.sh}|${q.look}`;
  const got = GFR.get(key);
  if (got) return got;
  const src = gBuild({ ...q, flash: false });
  const fr = { ...src, img: gFlashCanvas(src.img) };
  const pts = gPts.get(src);
  if (pts) gPts.set(fr, pts);
  return GFR.set(key, fr);
}

// ---- Рисовальщик: режим мозга → техника и кадр; память о прошлом режиме ----

interface GMem {
  yb: number;
  mode: string;
  prev: string;
  walk: number;
  now: number;
  ph: number;
  /** Последний кадр — для точек линзы и ядра. */
  fr: MobFrame | null;
  /** Переступ: откуда развернулся (1/64), когда и куда. */
  turnFrom: number;
  turnAt: number;
  turnDir: number;
  dx: number;
  dy: number;
}
const gMem = new WeakMap<Mob, GMem>();

function gMemOf(m: Mob, pose: MobPose): { s: GMem; fresh: boolean } {
  let s = gMem.get(m);
  const fresh = !s;
  if (!s) {
    s = {
      yb: -1,
      mode: pose.mode,
      prev: '',
      walk: 0,
      now: pose.now,
      ph: 1,
      fr: null,
      dx: 0,
      dy: 0,
      turnFrom: 0,
      turnAt: -9,
      turnDir: 0,
    };
    gMem.set(m, s);
  }
  if (pose.mode !== s.mode) {
    s.prev = s.mode;
    s.mode = pose.mode;
  }
  const dt = clampR(pose.now - s.now, 0, 0.1);
  s.now = pose.now;
  s.walk += Math.hypot(m.vx ?? 0, m.vy ?? 0) * TS * dt;
  return { s, fresh };
}

/** Сторона корпуса: 16 сторон с запасом — по диагонали не мигает. */
function gFacing(s: GMem, th: number, now: number, record: boolean): number {
  const q16 = Math.round(th / (TAU / 16));
  const tgt = (((q16 * 4) % YAW_N) + YAW_N) % YAW_N;
  if (s.yb < 0) return (s.yb = tgt);
  const d = angWrap(th - s.yb * YAW_STEP);
  if (Math.abs(d) > TAU / 32 + 0.08) {
    // Переступ — только когда стоит и доворачивается к герою (`chase`).
    if (record) {
      s.turnFrom = s.yb;
      s.turnAt = now;
      s.turnDir = d > 0 ? 1 : -1;
    }
    s.yb = tgt;
  }
  return s.yb;
}

function guardReq(m: Mob, pose: MobPose): { q: GReq; s: GMem } {
  const { s, fresh } = gMemOf(m, pose);
  const psim = paintSim();
  const live = f11State(psim)?.arena.phase ?? 0;
  const hint = m.data?.vPhase;
  if (live > 0) s.ph = live;
  const ph = hint ? hint : live > 0 ? live : s.ph;
  const sh = m.data?.vShield ?? (psim?.boss?.data.shield && psim.boss.state === 'fight' ? 1 : 0);
  const t = Math.max(0, pose.t);
  const th = m.data?.vYaw ?? gYawOf(m.face ?? 0);
  const q: GReq = {
    tech: 'idle',
    f: 0,
    yb: 0,
    ub: 0,
    hd: 0,
    sd: 0,
    ph,
    sh: sh ? 1 : 0,
    look: pose.look,
    // Смерть белым не мигает: копия убранного моба держит последнюю вспышку.
    flash: pose.flash && !(sh && pose.mode !== 'dying') && (pose.mode !== 'dying' || pose.t < 0.08),
    dh: false,
  };
  if (sh && pose.flash && pose.mode !== 'dying') q.dh = true;
  const at = (tech: GTech, f: number) => {
    q.tech = tech;
    q.f = Math.min(gSpan(tech) - 1, Math.max(0, f));
  };
  const rec = (tech: GTech) => at(tech, fAt(G_HIT[tech] ?? 0) + Math.floor(t * GFPS + 1e-6));
  let yb =
    m.data?.vYaw !== undefined
      ? ((Math.round(th / YAW_STEP) % YAW_N) + YAW_N) % YAW_N
      : gFacing(s, th, pose.now, pose.mode === 'chase' && pose.anim !== 'run');
  let ub = yb;
  switch (pose.mode) {
    case 'roar':
    case 'f11_wake':
      at('wake', Math.floor(t * GFPS + 1e-6));
      break;
    case 'f11_gaze': {
      at('gaze', Math.floor(t * GFPS + 1e-6));
      // Голова ведёт цель раньше корпуса.
      q.hd = clampR(Math.round(angWrap(th - yb * YAW_STEP) / 0.1), -4, 4);
      break;
    }
    case 'f11_slam':
      at('slam', Math.floor(t * GFPS + 1e-6));
      break;
    case 'f11_stomp':
      at('stomp', Math.floor(t * GFPS + 1e-6));
      break;
    case 'f11_rockets':
      at('rock', Math.floor(t * GFPS + 1e-6));
      break;
    case 'f11_spin': {
      at('spin', Math.floor(t * GFPS + 1e-6));
      const sdir = m.data?.sdir ?? 1;
      // Лист кадров: угол растёт от времени, как в мозге (`vSa0` — угол на старте).
      const sa0h = m.data?.vSa0;
      const sa =
        sa0h !== undefined
          ? sa0h + sdir * BOSS.spinW * Math.max(0, t - BOSS.spinCharge)
          : (m.data?.sa ?? m.face ?? 0);
      const sa0 = sa - sdir * BOSS.spinW * Math.max(0, t - BOSS.spinCharge);
      yb = (((Math.round(gYawOf(sa0) / (TAU / 16)) * 4) % YAW_N) + YAW_N) % YAW_N;
      ub = ((Math.round(gYawOf(sa) / YAW_STEP) % YAW_N) + YAW_N) % YAW_N;
      q.sd = sdir > 0 ? -1 : 1;
      s.yb = yb;
      break;
    }
    case 'f11_shift':
      at('shift', Math.floor(t * GFPS + 1e-6));
      break;
    case 'f11_stagger':
      q.tech = 'stag';
      q.f = gStagF(t);
      break;
    case 'dying':
      at('die', Math.floor(t * GFPS + 1e-6));
      break;
    case 'recover': {
      const hintF = m.data?.vFrom;
      const from = hintF ? G_FROM[hintF] : G_FROM_MODE[s.prev];
      if (!from) {
        q.tech = 'idle';
        q.f = Math.floor(pose.now * (IDLE_N / IDLE_T) + (m.id ?? 0) * 0.37) % IDLE_N;
        break;
      }
      rec(from);
      if (from === 'spin') {
        // Ноги догоняют корпус, развернувшийся за вращение.
        const sdir = m.data?.sdir ?? 1;
        const sa0h = m.data?.vSa0;
        const sa =
          sa0h !== undefined
            ? sa0h + sdir * BOSS.spinW * BOSS.spinDur
            : (m.data?.sa ?? m.face ?? 0);
        const legs = gYawOf(sa - sdir * BOSS.spinW * BOSS.spinDur);
        const end = Math.round(gYawOf(sa) / (TAU / 16)) * (TAU / 16);
        const k = gIO(clamp01(t / T_REC));
        const root = legs + angWrap(end - legs) * k;
        const up = gYawOf(sa) + angWrap(end - gYawOf(sa)) * k;
        yb = ((Math.round(root / YAW_STEP) % YAW_N) + YAW_N) % YAW_N;
        ub = ((Math.round(up / YAW_STEP) % YAW_N) + YAW_N) % YAW_N;
        q.sd = sdir > 0 ? -1 : 1;
        s.yb = (((Math.round(end / (TAU / 16)) * 4) % YAW_N) + YAW_N) % YAW_N;
      }
      break;
    }
    default: {
      if (pose.anim === 'run') {
        q.tech = 'walk';
        const d = fresh ? pose.now * Math.hypot(m.vx ?? 0, m.vy ?? 0) * TS : s.walk;
        q.f = Math.floor(((d / WALK_STRIDE) % 1) * WALK_N) % WALK_N;
      } else if (pose.now - s.turnAt >= 0 && pose.now - s.turnAt < TURN_T) {
        // Развернулся на месте — переступает: ноги догоняют корпус.
        const age = pose.now - s.turnAt;
        q.tech = 'turn';
        q.f = Math.min(gSpan('turn') - 1, Math.floor(age * GFPS));
        q.sd = s.turnDir;
        const diff = ((((yb - s.turnFrom + YAW_N * 1.5) % YAW_N) + YAW_N) % YAW_N) - YAW_N / 2;
        const k = gIO(clamp01((q.f + 1) / gSpan('turn')));
        ub = yb;
        yb = ((Math.round(s.turnFrom + diff * k) % YAW_N) + YAW_N) % YAW_N;
      } else {
        q.tech = 'idle';
        q.f = Math.floor(pose.now * (IDLE_N / IDLE_T) + (m.id ?? 0) * 0.37) % IDLE_N;
      }
    }
  }
  q.yb = yb;
  q.ub = ub;
  return { q, s };
}

registerMobPainter('f11boss', (m: Mob, pose: MobPose) => {
  const { q, s } = guardReq(m, pose);
  const fr = gFrame(q);
  const out: MobFrame = { ...fr };
  if (q.tech === 'die') out.linger = T_DIE;
  // Шлейф на быстром: кулаки вниз, стопа вниз, вращение.
  const t = gTimeOf(q.tech, q.f);
  if (
    (q.tech === 'slam' && t > 0.8 && t < T_SLAM + 0.08) ||
    (q.tech === 'stomp' && t > 0.58 && t < T_STOMP + 0.06)
  )
    out.ghost = { every: 0.03, life: 0.14, tint: '#e8e2c8', alpha: 0.3 };
  if (q.tech === 'spin' && t > BOSS.spinCharge && t < T_SPIN)
    out.ghost = { every: 0.035, life: 0.17, tint: '#ffa860', alpha: 0.24 };
  // Отдача от удара героя: от него, с возвратом; на колене — сильнее.
  const fl = m.flash ?? 0;
  if (fl > 0 && pose.mode !== 'dying' && !q.dh) {
    const sim = paintSim();
    const age = clampR(0.12 - fl, 0, 0.12);
    let ux = pose.left ? 1 : -1;
    let uy = 0;
    if (sim) {
      const dx = m.x - sim.hero.x;
      const dy = m.y - sim.hero.y;
      const d = Math.hypot(dx, dy) || 1;
      ux = dx / d;
      uy = dy / d;
    }
    const amp = q.tech === 'stag' ? 2.6 : q.tech === 'idle' || q.tech === 'walk' ? 1.5 : 0.7;
    const k = Math.sin((age / 0.12) * Math.PI);
    out.dx = (out.dx ?? 0) + ux * k * amp;
    out.dy = (out.dy ?? 0) + uy * k * amp * 0.6;
    out.rot = (out.rot ?? 0) + ux * k * 0.025 * amp;
  }
  s.fr = fr;
  s.dx = out.dx ?? 0;
  s.dy = out.dy ?? 0;
  return out;
});

/**
 * Где сейчас линза и ядро стража — смещение в пикселях игры от точки моба
 * (m.x·16, m.y·16). Для «Техник»: луч взгляда — из линзы, лучи вращения —
 * из ядра. null — ещё не рисовался или линза не видна (смотрит от нас).
 */
export function f11GuardPoints(m: Mob): {
  lens: [number, number] | null;
  core: [number, number] | null;
  /** Голова, линза и затылок — излучатели лучей вращения (всегда есть). */
  head: [number, number];
  front: [number, number];
  rear: [number, number];
  frontVis: boolean;
  rearVis: boolean;
} | null {
  const s = gMem.get(m);
  if (!s?.fr) return null;
  const pts = gPts.get(s.fr);
  if (!pts) return null;
  const fr = s.fr;
  const at = (p: [number, number]): [number, number] => [
    p[0] - fr.ax + s.dx,
    p[1] - fr.ay + 2 + s.dy,
  ];
  const e = pts.emit;
  return {
    lens: pts.lens ? at(pts.lens) : null,
    core: pts.core ? at(pts.core) : null,
    head: at(e.head),
    front: at(e.front),
    rear: at(e.rear),
    frontVis: e.frontVis,
    rearVis: e.rearVis,
  };
}

// Прогрев: пробуждение (вход камерой), покой со всех сторон, шаг и первая
// фаза спереди — всё, что игрок увидит в первые секунды боя.
registerMobWarm('f11boss', function* () {
  const base: Omit<GReq, 'tech' | 'f' | 'yb' | 'ub'> = {
    hd: 0,
    sd: 0,
    ph: 1,
    sh: 0,
    look: 'normal',
    flash: false,
    dh: false,
  };
  const front = 0;
  for (let f = 0; f < gSpan('wake'); f++) {
    gBuild({ ...base, tech: 'wake', f, yb: front, ub: front });
    yield f;
  }
  const near = [0, 4, 60, 8, 56];
  for (const yb of near)
    for (let f = 0; f < IDLE_N; f++) {
      gBuild({ ...base, tech: 'idle', f, yb, ub: yb });
      yield f;
    }
  for (const yb of near.slice(0, 3))
    for (let f = 0; f < WALK_N; f++) {
      gBuild({ ...base, tech: 'walk', f, yb, ub: yb });
      yield f;
    }
  for (const tech of ['gaze', 'slam'] as GTech[])
    for (let f = 0; f < gSpan(tech); f++) {
      gBuild({ ...base, tech, f, yb: front, ub: front });
      yield f;
    }
});
registerMobWarm('f11boss', function* () {
  const base: Omit<GReq, 'tech' | 'f' | 'yb' | 'ub'> = {
    hd: 0,
    sd: 0,
    ph: 1,
    sh: 0,
    look: 'normal',
    flash: false,
    dh: false,
  };
  for (let yb = 12; yb <= 52; yb += 4)
    for (let f = 0; f < IDLE_N; f++) {
      gBuild({ ...base, tech: 'idle', f, yb, ub: yb });
      yield f;
    }
});

// --- Щитовой пилон: встаёт из пола, гудит, рушится ---------------------------------

const PYW = 46;
const PYH = 56;
const PYX = 18;
const PYG = 50;
const PY_DEAD = tn('#2a3a40', '#3a5058', '#50707a', '#7a98a0');
const PYF = frameLRU<MobFrame>(120);
const PY_RISE = 0.55;
const PY_DIE = 0.8;
const PY_SINK = 0.4;

/** Сам пилон в холст `p` со сдвигом вниз `dy` (уходит в пол — срезается землёй). */
function pyDraw(
  p: Px,
  lit: Px,
  dy: number,
  glow: number,
  f: number,
  crack: number,
  top: boolean,
  bottom: boolean,
): void {
  const cx = PYX;
  const gy = PYG + dy;
  const q = new Px(PYW, PYH + 40);
  const crys = glow > 0.05 ? CRYSTAL : PY_DEAD;
  if (bottom) {
    polyShade(
      q,
      [
        [cx - 7, gy],
        [cx + 7, gy],
        [cx + 5, gy - 6],
        [cx - 5, gy - 6],
      ],
      ROCK,
    );
    for (let x = cx - 5; x <= cx + 5; x += 2) q.set(x, gy - 3, glow > 0.05 ? RUNE : ROCK[0]);
    polyShade(
      q,
      [
        [cx - 3.5, gy - 6],
        [cx + 3.5, gy - 6],
        [cx + 2.6, gy - 20],
        [cx - 2.6, gy - 20],
      ],
      crys,
    );
    stroke(q, cx, gy - 20, cx, gy - 7, glow > 0.05 ? CRYSTAL[3] : PY_DEAD[2]);
    q.rect(cx - 3, gy - 12, cx + 3, gy - 11, GOLD[1]);
    q.rect(cx - 3, gy - 12, cx + 3, gy - 12, GOLD[3]);
  }
  if (top) {
    polyShade(
      q,
      [
        [cx - 2.6, gy - 20],
        [cx + 2.6, gy - 20],
        [cx + 2, gy - 30],
        [cx, gy - 34],
        [cx - 2, gy - 30],
      ],
      crys,
    );
    stroke(q, cx, gy - 33, cx, gy - 20, glow > 0.05 ? CRYSTAL[3] : PY_DEAD[2]);
    q.rect(cx - 3, gy - 22, cx + 3, gy - 21, GOLD[1]);
    q.rect(cx - 3, gy - 22, cx + 3, gy - 22, GOLD[3]);
  }
  if (crack > 0) {
    // Трещина рисуется только по тому, что стоит: над сломом её нет.
    if (top) stroke(q, cx - 2, gy - 25, cx + 1, gy - 19, INK);
    if (crack > 0.5 && bottom) stroke(q, cx + 1, gy - 19, cx - 1, gy - 10, INK);
  }
  q.outline(hx('#1a3a44'));
  // Срез землёй: всё ниже пола — в полу.
  for (let y = 0; y <= Math.min(PYG, q.h - 1); y++)
    for (let x = 0; x < PYW; x++) {
      const c = q.get(x, y);
      if (c[3]) p.set(x, y, c);
    }
  if (glow <= 0.05) return;
  // Свечение: кристалл, бегущий вверх импульс, искра на острие, руны цоколя.
  for (let y = 0; y <= PYG; y++)
    for (let x = 0; x < PYW; x++) {
      const c = q.get(x, y);
      if (!c[3] || y > gy - 6 || y < gy - 34) continue;
      if (Math.abs(x - cx) > 3) continue;
      lit.set(x, y, alpha(CRYSTAL[2], 0.28 * glow));
    }
  const py = gy - 7 - (f / 12) * 27;
  for (let x = cx - 3; x <= cx + 3; x++)
    for (const yy of [Math.round(py), Math.round(py) + 1])
      if (yy <= PYG && q.get(x, yy)[3])
        lit.set(x, yy, alpha(WHITE, (yy === Math.round(py) ? 0.9 : 0.5) * glow));
  if (top) {
    const tw = f % 4 < 2 ? 1 : 0.6;
    lit.set(cx, gy - 35, alpha(WHITE, glow * tw));
    lit.set(cx - 1, gy - 35, alpha(CYAN, 0.6 * glow * tw));
    lit.set(cx + 1, gy - 35, alpha(CYAN, 0.6 * glow * tw));
    lit.set(cx, gy - 36, alpha(CYAN, 0.7 * glow * tw));
  }
  for (let x = cx - 5; x <= cx + 5; x += 2)
    if (gy - 3 <= PYG) lit.set(x, gy - 3, alpha(RUNE, 0.8 * glow));
}

/** Кольцо рун на орбите вокруг кристалла: задние за ним, передние перед. */
function pyOrbit(p: Px, lit: Px, dy: number, glow: number, f: number, front: boolean): void {
  if (glow <= 0.05) return;
  const cy = PYG + dy - 19 + Math.sin((f / 12) * TAU) * 1.5;
  for (let i = 0; i < 3; i++) {
    const a = (f / 12) * TAU + (i * TAU) / 3;
    const fr = Math.sin(a) > 0;
    if (fr !== front) continue;
    const x = Math.round(PYX + Math.cos(a) * 7);
    const y = Math.round(cy + Math.sin(a) * 2.2);
    if (y > PYG) continue;
    if (!front && p.get(x, y)[3]) continue;
    p.set(x, y, mixc(RUNE, WHITE, 0.3));
    lit.set(x, y, alpha(RUNE, glow));
    lit.set(x - 1, y, alpha(RUNE, 0.4 * glow));
    lit.set(x + 1, y, alpha(RUNE, 0.4 * glow));
  }
}

function pyFrame(stage: 'rise' | 'hum' | 'die' | 'sink', f: number, flash: boolean): MobFrame {
  const key = `${stage}|${f}|${flash ? 1 : 0}`;
  const got = PYF.get(key);
  if (got) return got;
  if (flash) {
    const src = pyFrame(stage, f, false);
    return PYF.set(key, { ...src, img: gFlashCanvas(src.img) });
  }
  const p = new Px(PYW, PYH);
  const lit = new Px(PYW, PYH);
  let al = 1;
  if (stage === 'hum') {
    pyOrbit(p, lit, 0, 1, f, false);
    pyDraw(p, lit, 0, 1, f, 0, true, true);
    pyOrbit(p, lit, 0, 1, f, true);
  } else if (stage === 'rise') {
    // Пол трескается, пилон выезжает с перелётом, кристалл загорается к концу.
    const k = clamp01(f / (PY_RISE * GFPS));
    const dy = Math.round((1 - gBack(k)) * 38);
    const glow = clamp01((k - 0.7) / 0.3);
    pyDraw(p, lit, dy, glow, f % 12, 0, true, true);
    if (glow > 0.05) pyOrbit(p, lit, dy, glow, f % 12, true);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + 0.4;
      const L = 3 + 6 * Math.min(1, k * 2);
      for (let r = 2; r < L; r++) {
        const x = Math.round(PYX + Math.cos(a) * (6 + r));
        const y = Math.round(PYG + Math.sin(a) * (2 + r * 0.3));
        if (!p.get(x, y)[3]) p.set(x, y, alpha(INK, 0.55 * (1 - k * 0.5)));
      }
    }
    for (let i = 0; i < 5; i++) {
      const tt = k * 0.55 - i * 0.03;
      if (tt <= 0) continue;
      const vx = (hash(i, 1, 961) - 0.5) * 30;
      const vy = -40 - hash(i, 2, 962) * 30;
      const x = PYX + vx * tt;
      const y = PYG - 2 + vy * tt + 200 * tt * tt;
      if (y < PYG + 1) {
        p.set(Math.round(x), Math.round(y), ROCK[1]);
        p.set(Math.round(x) + 1, Math.round(y), ROCK[0]);
      }
    }
  } else if (stage === 'sink') {
    // Купол снят: свет гаснет, пилон уходит в пол.
    const k = clamp01(f / (PY_SINK * GFPS));
    const glow = 1 - clamp01(k / 0.35);
    const dy = Math.round(gIn(k) * 36);
    pyDraw(p, lit, dy, glow, f % 12, 0, true, true);
  } else {
    // Разбит: трещина, верх ломается и падает набок, осколки, свет гаснет.
    const k = clamp01(f / (PY_DIE * GFPS));
    const glow = Math.max(0, 1 - k * 4);
    pyDraw(p, lit, 0, glow, 0, 1, false, true);
    const q = new Px(PYW, PYH);
    const ql = new Px(PYW, PYH);
    pyDraw(q, ql, 0, glow, 0, 1, true, false);
    // Верх клонится от трещины и падает плашмя на землю, чуть подпрыгнув.
    const kf = clamp01((k - 0.08) / 0.5);
    const ang = gIn(kf) * 1.5;
    const land = k > 0.58 ? Math.sin(Math.min(1, (k - 0.58) / 0.14) * Math.PI) * 2 : 0;
    const fall = gIn(kf) * 17 - land;
    const px0 = PYX + 2;
    const py0 = PYG - 20;
    for (let y = 0; y < PYH; y++)
      for (let x = 0; x < PYW; x++) {
        const c = q.get(x, y);
        if (!c[3] || y > PYG - 19) continue;
        const ox = x - px0;
        const oy = y - py0;
        const X = px0 + ox * Math.cos(ang) - oy * Math.sin(ang);
        const Y = py0 + ox * Math.sin(ang) + oy * Math.cos(ang) + fall;
        if (Y <= PYG) p.set(X, Y, c);
      }
    // Осколки на приземлении верха.
    if (k > 0.58)
      for (let i = 0; i < 7; i++) {
        const tt = (k - 0.58) * PY_DIE;
        const x = PYX + 9 + (hash(i, 5, 965) - 0.5) * 30 * tt * 3;
        const y = PYG - 2 - 30 * tt + 120 * tt * tt;
        if (y > PYG) continue;
        p.set(Math.round(x), Math.round(y), alpha(CRYSTAL[3], 1 - k));
        lit.set(Math.round(x), Math.round(y), alpha(CYAN, 0.8 * (1 - k)));
      }
    for (let i = 0; i < 9; i++) {
      const vx = (hash(i, 3, 963) - 0.5) * 50;
      const vy = -20 - hash(i, 4, 964) * 40;
      const tt = k * PY_DIE;
      const x = PYX + vx * tt;
      const y = PYG - 22 + vy * tt + 110 * tt * tt;
      if (y > PYG) continue;
      p.set(Math.round(x), Math.round(y), alpha(i % 3 ? CRYSTAL[2] : WHITE, 1 - k));
      lit.set(Math.round(x), Math.round(y), alpha(CRYSTAL[3], 1 - k));
    }
    al = 1 - clamp01((k - 0.7) / 0.3);
  }
  const fr: MobFrame = {
    img: p.canvas(),
    lit: lit.canvas(),
    ax: PYX,
    ay: PYG,
    eye: null,
    still: true,
    shadow: stage === 'hum' ? 7 : 6,
    alpha: al,
  };
  return PYF.set(key, fr);
}

registerMobPainter('f11_pylon', (m: Mob, pose: MobPose) => {
  const t = Math.max(0, pose.t);
  let fr: MobFrame;
  if (pose.mode === 'dying') {
    fr = pyFrame(
      'die',
      Math.min(Math.ceil(PY_DIE * GFPS) - 1, Math.floor(t * GFPS)),
      pose.flash && t < 0.06,
    );
    return { ...fr, linger: PY_DIE };
  }
  if (pose.mode === 'escape')
    return pyFrame('sink', Math.min(Math.ceil(PY_SINK * GFPS) - 1, Math.floor(t * GFPS)), false);
  if (t < PY_RISE) return pyFrame('rise', Math.floor(t * GFPS), pose.flash);
  return pyFrame('hum', ((Math.floor(pose.now * 12 + (m.id ?? 0) * 3) % 12) + 12) % 12, pose.flash);
});

// --- Снаряды ----------------------------------------------------------------------

registerShotPainter('f11_dart', (s, time) => {
  const a = Math.atan2(s.vy, s.vx);
  const q = ((Math.round((a / TAU) * 8) % 8) + 8) % 8;
  const f = Math.floor(time * 20) % 2;
  return sprite(`dart|${q}|${f}`, () => {
    const p = new Px(12, 12);
    const dx = Math.cos((q * TAU) / 8);
    const dy = Math.sin((q * TAU) / 8);
    for (let k = -4; k <= 2; k++) {
      const c = k > 0 ? WHITE : k > -2 ? hx('#ffe080') : alpha(hx('#ffb040'), 0.5 + (k + 4) * 0.1);
      p.set(Math.round(6 + dx * k), Math.round(6 + dy * k), c);
    }
    if (f) p.set(Math.round(6 + dx * 3), Math.round(6 + dy * 3), alpha(WHITE, 0.6));
    return { p, ax: 6, ay: 6 };
  });
});

// --- Иконки вещей этажа (10×10) ---------------------------------------------------

registerItemArt('f11mat', () => {
  // Летучий кварц: кристалл, парящий над своей тенью, с кольцом ветра.
  const p = new Px(10, 10);
  polyShade(
    p,
    [
      [5, 0.5],
      [7.5, 3.5],
      [5, 7.5],
      [2.5, 3.5],
    ],
    CRYSTAL,
    0.1,
  );
  stroke(p, 5, 1, 5, 7, CRYSTAL[3]);
  p.outline(hx('#1a3a44'));
  p.set(4, 2, WHITE);
  p.set(1, 9, alpha(INK, 0.35));
  p.set(2, 9, alpha(INK, 0.35));
  p.set(7, 9, alpha(INK, 0.35));
  p.set(8, 9, alpha(INK, 0.35));
  return p;
});

registerItemArt('f11_gear', () => {
  const p = new Px(10, 10);
  for (let k = 0; k < 8; k++) {
    const a = (k * TAU) / 8;
    p.rect(
      Math.round(5 + Math.cos(a) * 3.6) - 0,
      Math.round(5 + Math.sin(a) * 3.6) - 0,
      Math.round(5 + Math.cos(a) * 3.6),
      Math.round(5 + Math.sin(a) * 3.6),
      BRASS[1],
    );
  }
  shadeEll(p, 5, 5, 3.2, 3.2, BRASS, 0.1);
  p.ell(5, 5, 1.2, 1.2, BRASS[0]);
  p.outline(INK);
  p.set(4, 3, WHITE);
  return p;
});

registerItemArt('f11_feather', () => {
  const p = new Px(10, 10);
  const pts = spline(
    [
      [1.5, 9],
      [3.5, 6],
      [6, 3.5],
      [8.5, 1],
    ],
    4,
  );
  for (const [x, y] of pts) {
    p.set(Math.round(x) - 1, Math.round(y), FEATH[2]);
    p.set(Math.round(x), Math.round(y) - 1, FEATH[3]);
  }
  for (const [x, y] of pts.slice(-6)) p.set(Math.round(x), Math.round(y) - 1, FEATH_TIP[2]);
  stroke(p, 1.5, 9, 8.5, 1, hx('#f4ecd8'));
  p.outline(INK);
  return p;
});

registerItemArt('f11_silk', () => {
  // Облачный шёлк — моток бело-голубой ткани.
  const p = new Px(10, 10);
  shadeEll(p, 5, 5.5, 3.8, 3.2, JELLY_T, 0.15);
  for (let x = 2; x <= 8; x += 2) stroke(p, x, 3, x + 1, 8, JELLY_T[1]);
  p.outline(hx('#44557a'));
  p.set(4, 3, WHITE);
  return p;
});

registerItemArt('f11_core', () => {
  // Ядро стража: шестигранник с горящей серединой в каменной оправе.
  const p = new Px(10, 10);
  poly(
    p,
    [0, 1, 2, 3, 4, 5].map((k) => [
      5 + Math.cos((k * PI) / 3 + PI / 6) * 4.6,
      5 + Math.sin((k * PI) / 3 + PI / 6) * 4.6,
    ]),
    ANC[1],
  );
  shadeEll(p, 5, 5, 2.6, 2.6, CORE_HOT, 0.25);
  p.outline(INK);
  p.set(4, 4, WHITE);
  return p;
});

registerItemArt('f11_fruit', () => {
  // Облачный плод: голубой, в пушку, с листком.
  const p = new Px(10, 10);
  shadeEll(p, 5, 5.8, 3.6, 3.4, tn('#5a7ab8', '#88a8e0', '#b8d0f4', '#eef4ff'), 0.1);
  p.set(5, 2, hx('#3c6a2a'));
  p.set(6, 1, hx('#5a9a3a'));
  p.set(7, 1, hx('#5a9a3a'));
  p.outline(INK);
  p.set(3, 4, WHITE);
  return p;
});

registerItemArt('f11_fillet', () => {
  // Филе ската: светлый ломоть с голубой кромкой.
  const p = new Px(10, 10);
  poly(
    p,
    [
      [1, 6],
      [4, 2],
      [9, 3],
      [8, 7],
      [3, 8.5],
    ],
    (x, y) => tone(tn('#c07a70', '#e0a098', '#f4c8c0', '#fff0ec'), 0.9 - (x + y) * 0.05),
  );
  stroke(p, 4, 2, 9, 3, RAY_T[2]);
  stroke(p, 2, 6, 7, 6, hx('#f4d8d0'));
  p.outline(INK);
  return p;
});
