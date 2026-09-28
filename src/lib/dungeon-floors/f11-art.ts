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
  paintSim,
  registerCellPainter,
  registerItemArt,
  registerMobPainter,
  registerPropPainter,
  registerShotPainter,
  registerZonePainter,
} from '../dungeon-paint';
import type { CellCtx, MobFrame, MobPose, Sprite } from '../dungeon-paint';
import type { Mob, Sim, Strike, Zone } from '../dungeon-sim';
import type { WorldObj } from '../dungeon-world';
import { F11_AQUA, F11_CASTLE, F11_GARDEN, F11_MARK } from './f11';
import {
  expoAt,
  f11State,
  gustBlow,
  gustWarn,
  millDir,
  stormOn,
  towerTurn,
  windAt,
} from './f11-brains';
import type { F11State } from './f11-brains';

type RGBA = [number, number, number, number];

const hx = (h: string, a = 255): RGBA => {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255, a];
};
const mixc = (a: RGBA, b: RGBA, k: number): RGBA => [
  Math.round(a[0] + (b[0] - a[0]) * k),
  Math.round(a[1] + (b[1] - a[1]) * k),
  Math.round(a[2] + (b[2] - a[2]) * k),
  Math.round(a[3] + (b[3] - a[3]) * k),
];
const alpha = (c: RGBA, a: number): RGBA => [c[0], c[1], c[2], Math.round(Math.max(0, Math.min(1, a)) * 255)];
const css = (c: RGBA, a = c[3] / 255) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

const TAU = Math.PI * 2;
const PI = Math.PI;
const MK = F11_MARK;
const TS = 16;

/** Контур этажа: тёмный сине-серый — дневной свет, а не подземная тьма. */
const INK = hx('#1d2130');
const WHITE = hx('#ffffff');

// ---------------------------------------------------------------------------
// Шум и хеши — в мировых пикселях, чтобы клетки стыковались.
// ---------------------------------------------------------------------------

const hash = (a: number, b: number, c = 0) => {
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
const tn = (a: string, b: string, c: string, d: string): Tones => [hx(a), hx(b), hx(c), hx(d)];

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
function limb(
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
function stroke(p: Px, x0: number, y0: number, x1: number, y1: number, c: RGBA, w = 1): void {
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
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Контур снаружи фигуры (со светлой стороны — светлее: мягче на светлом полу). */
function ink(p: Px, c: RGBA = INK, diag = false): Px {
  p.outline(c, diag);
  return p;
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
function sprite(key: string, make: () => { p: Px; ax: number; ay: number }): Sprite {
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
const PATH = tn('#9e9480', '#bfb49c', '#d8cfb8', '#ece6d4');
const GROUT = hx('#7d7462');
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
const MOSAIC_BLUE = tn('#1e3e74', '#2c5596', '#3f6fb4', '#6792cf');
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
      const v = vnoise(X, Y, 7, 1) * 0.65 + vnoise(X, Y, 2.6, 2) * 0.35;
      let c = GRASS[1];
      if (v > 0.6) c = GRASS[2];
      if (v > 0.74 * lush) c = GRASS[3];
      if (v < 0.3) c = mixc(GRASS[0], GRASS[1], 0.55);
      p.set(x, y, c);
    }
  // Травинки: тёмный низ, светлый верх.
  for (let y = 1; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const Y = Y0 + y;
      const h = hash(X, Y, 5);
      if (h < 0.06) {
        p.set(x, y, GRASS[0]);
        p.set(x, y - 1, h < 0.02 ? GRASS_HI : GRASS[3]);
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
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const Y = Y0 + y;
      const v = voronoi(X, Y, 7, 3);
      if (v.edge < 1.15) {
        p.set(x, y, hash(X, Y, 8) < 0.18 ? GRASS[1] : GROUT);
        continue;
      }
      const base = hash(v.id, 1) < 0.5 ? 1 : 2;
      const l = -(v.ox * LX + v.oy * LY) / 5;
      let c = PATH[base];
      if (v.edge < 2.1) c = l > 0 ? PATH[3] : PATH[0];
      else if (l > 0.35) c = PATH[Math.min(3, base + 1)];
      if (hash(X, Y, 9) < 0.03) c = PATH[0];
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
      if (v === 1 || u === 1) c = SAND[3];
      else if (v === 7 || u === 15) c = SAND[0];
      const w = vnoise(X, Y, 3, 83);
      if (w < 0.18) c = mixc(c, SAND[0], 0.5);
      if (hash(X, Y, 84) < 0.02) c = SAND[0];
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
      const v = vnoise(X, Y * 0.5, 6, 101);
      let c = v > 0.58 ? WATER[2] : v < 0.32 ? WATER[0] : WATER[1];
      // Рябь поперёк течения: короткие светлые дуги.
      const r = vnoise(X * 0.5, Y, 3, 102);
      if (r > 0.72 && ((Y + Math.floor(v * 4)) % 5 === 0)) c = WATER[3];
      p.set(x, y, c);
    }
}

function marblePx(p: Px, X0: number, Y0: number): void {
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const Y = Y0 + y;
      const u = ((X % 8) + 8) % 8;
      const v = ((Y % 8) + 8) % 8;
      if (u === 0 || v === 0) {
        p.set(x, y, MARBLE[0]);
        continue;
      }
      let c = MARBLE[hash(Math.floor(X / 8), Math.floor(Y / 8), 111) < 0.4 ? 1 : 2];
      if (u === 1 || v === 1) c = MARBLE[3];
      const vein = Math.abs(vnoise(X, Y, 11, 112) - 0.5);
      if (vein < 0.025) c = mixc(c, hx('#9a98ae'), 0.6);
      p.set(x, y, c);
    }
}

function mosaicPx(p: Px, X0: number, Y0: number): void {
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const Y = Y0 + y;
      const u = (((X % 32) + 32) % 32) - 15.5;
      const v = (((Y % 32) + 32) % 32) - 15.5;
      const d = Math.abs(u) + Math.abs(v);
      const tess = (((X % 3) + 3) % 3 === 0 || ((Y % 3) + 3) % 3 === 0) && hash(X, Y, 121) < 0.6;
      let c: RGBA;
      if (d > 7 && d < 10.5) c = GOLD[hash(Math.floor(X / 3), Math.floor(Y / 3), 122) < 0.5 ? 2 : 1];
      else if (d < 3.5) c = hx('#e8eef8');
      else if (Math.max(Math.abs(u), Math.abs(v)) > 14.5) c = GOLD[1];
      else c = MOSAIC_BLUE[hash(Math.floor(X / 3), Math.floor(Y / 3), 123) < 0.3 ? 2 : 1];
      if (tess) c = mixc(c, hx('#10224a'), 0.35);
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
  const vert = (skyW || skyE) && !(skyN || skyS) ? true : (skyN || skyS) && !(skyW || skyE) ? false : true;
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const Y = Y0 + y;
      const along = vert ? Y : X;
      const across = vert ? X : Y;
      const k = ((along % 4) + 4) % 4;
      const plank = Math.floor(along / 4);
      if (k === 3) {
        p.set(x, y, hx('#3e2a18'));
        continue;
      }
      let col = PLANK[hash(plank, 4) < 0.5 ? 1 : 2];
      if (k === 0) col = PLANK[3];
      if (k === 2) col = mixc(col, PLANK[0], 0.4);
      // Волокна и гвозди.
      if (hash(across, plank, 141) < 0.06) col = PLANK[0];
      if ((((across % 8) + 8) % 8 === 1 || ((across % 8) + 8) % 8 === 6) && k === 1 && hash(plank, 5) < 0.6)
        col = hx('#4a4a52');
      p.set(x, y, col);
    }
  // Верёвочные перила над небом, столбики через клетку.
  const rail = (edge: 'W' | 'E' | 'N' | 'S') => {
    for (let i = 0; i < TS; i++) {
      const [x, y] =
        edge === 'W' ? [1, i] : edge === 'E' ? [14, i] : edge === 'N' ? [i, 1] : [i, 14];
      const sag = edge === 'W' || edge === 'E' ? 0 : 0;
      p.set(x, y + sag, ROPE[2]);
      p.set(edge === 'W' ? 0 : edge === 'E' ? 15 : x, edge === 'N' ? 0 : edge === 'S' ? 15 : y, ROPE[0]);
    }
    const post = ((vert ? Y0 / TS : X0 / TS) % 3 + 3) % 3 === 0;
    if (post) {
      const [px, py] = edge === 'W' ? [0, 6] : edge === 'E' ? [13, 6] : edge === 'N' ? [6, 0] : [6, 13];
      for (let dy = 0; dy < 3; dy++)
        for (let dx = 0; dx < 3; dx++) p.set(px + dx, py + dy, dx === 0 || dy === 0 ? PLANK[2] : PLANK[0]);
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
      const v = voronoi(X, Y, 5, 151);
      if (v.edge < 0.9) {
        p.set(x, y, COBBLE[0]);
        continue;
      }
      const l = -(v.ox * LX + v.oy * LY) / 3.2 + 0.35;
      p.set(x, y, tone(COBBLE, l + (hash(v.id, 7) - 0.5) * 0.3));
    }
  // Парапет над небом: светлый камень, тёмный наружный край.
  const edges: [number, number, (i: number) => [number, number][]][] = [
    [-1, 0, (i) => [[0, i], [1, i]]],
    [1, 0, (i) => [[15, i], [14, i]]],
    [0, -1, (i) => [[i, 0], [i, 1]]],
    [0, 1, (i) => [[i, 15], [i, 14]]],
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

function arenaPx(p: Px, X0: number, Y0: number): void {
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const Y = Y0 + y;
      const v = voronoi(X, Y, 9, 161, 0.5);
      if (v.edge < 0.9) {
        p.set(x, y, hx('#9a98a8'));
        continue;
      }
      const l = -(v.ox * LX + v.oy * LY) / 6 + 0.4;
      let c = tone(MARBLE, l + (hash(v.id, 9) - 0.5) * 0.25);
      if (hash(X, Y, 162) < 0.02) c = MARBLE[0];
      p.set(x, y, c);
    }
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
  for (let i = 0; i < 6; i++) p.set(1 + Math.floor(hash(seed, i, 6) * 14), 1 + Math.floor(hash(seed, i, 7) * 14), hx('#e86a4a'));
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
      return mk === MK.bed || mk === MK.gardenerPost || (mk === MK.under && underFloor(c, area) === MK.bed);
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
    const wet = (dx: number, dy: number) => c.markAt(dx, dy) === MK.water || nearOf(c, dx, dy) === 'sky';
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
  const up = [islandAbove(c, -2), islandAbove(c, -1), islandAbove(c, 0), islandAbove(c, 1), islandAbove(c, 2)];
  const has = (k: number) => (k > 0 ? 1 : 0);
  const grassTop = (() => {
    const k = up[2];
    if (k <= 0) return false;
    const mk = c.markAt(0, -k);
    return mk === MK.grass || mk === MK.moss || mk === MK.bed || mk === MK.under || mk === MK.hedge || mk === 0;
  })();
  for (let x = 0; x < TS; x++) {
    const k = up[2];
    if (k <= 0) continue;
    const X = X0 + x;
    // Толщина острова: сколько земли вокруг сверху — сужается к краям.
    const fl = (x + 0.5) / TS;
    const frac =
      (has(up[1]) * (1 - fl) + has(up[2]) + has(up[3]) * fl) / 2 * 0.7 +
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
        if (area !== F11_CASTLE && vnoise(X, Y, 5, 243) > 0.62) col = GRASS[vnoise(X, Y, 2, 244) > 0.5 ? 2 : 1];
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

function masonryPx(p: Px, c: CellCtx, face: boolean, area: string, pal: Tones, trim: Tones | null): void {
  const X0 = c.wx * TS;
  const Y0 = c.wy * TS;
  const capH = face ? 4 : 16;
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const Y = Y0 + y;
      let col: RGBA;
      if (y < capH) {
        // Верх стены: крупные плиты.
        const u = ((X % 8) + 8) % 8;
        const v = ((Y % 8) + 8) % 8;
        col = u === 0 || v === 0 ? pal[0] : u === 1 || v === 1 ? pal[3] : pal[2];
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
        if (trim && y >= capH && y < capH + 3) col = y === capH + 2 ? GOLD[2] : trim[y === capH ? 3 : 1];
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
