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
      let c = v > 0.7 ? mixc(WATER[1], WATER[2], 0.6) : v < 0.24 ? mixc(WATER[0], WATER[1], 0.5) : WATER[1];
      // Рябь поперёк течения: короткие светлые штрихи, редко.
      const r = vnoise(X * 0.5, Y, 3, 102);
      if (r > 0.78 && ((Y + Math.floor(v * 4)) % 6 === 0)) c = mixc(WATER[2], WATER[3], 0.6);
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
  const vert = (skyW || skyE) && !(skyN || skyS) ? true : (skyN || skyS) && !(skyW || skyE) ? false : true;
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
      const v = voronoi(X, Y, 6, 151);
      if (v.edge < 0.9) {
        p.set(x, y, COBBLE[0]);
        continue;
      }
      const toLight = v.ox * LX + v.oy * LY;
      const r = hash(v.id, 7);
      p.set(x, y, v.edge < 1.8 && toLight > 0.6 ? COBBLE[3] : v.edge < 1.8 && toLight < -0.6 ? COBBLE[0] : COBBLE[r < 0.35 ? 1 : 2]);
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

/** Плиты: ровный тон камня, фаска светом сверху-слева, шов. */
function flagPx(p: Px, X0: number, Y0: number, size: number, seed: number, pal: Tones, grout: RGBA, jit = 0.6): void {
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
      for (let k = 0; k < 5; k++) g.fillRect(Math.round(x - lx * k * 0.3), Math.round(y - k * 1.6), 1, 1);
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
    const k = arenaGust ? (st.arena.gust === 1 ? Math.min(1, 1 - st.arena.gustT) : 1) : warn > 0 ? warn : 1;
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
        for (let s = 0; s < 7; s++) g.fillRect(Math.round(bx - ux * s * 1.5), Math.round(by - uy * s * 1.5), 1, 1);
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
function swirl(g: CanvasRenderingContext2D, px: number, py: number, k: number, r: number, col: string): void {
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
    g.fillRect(Math.round(px + Math.cos(a) * r), Math.round(py - H * 0.3 + Math.sin(a) * r * 0.5), 1, 1);
  }
  g.globalAlpha = 1;
  return true;
});

/** Лента-луч: вода, лазер, взгляд стража (`ang` — в зоне). */
function beamFx(g: CanvasRenderingContext2D, z: Zone, px: number, py: number, w: number, core: string, glow: string): void {
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
registerZonePainter('f11_beamfx', (g, z, px, py) => {
  beamFx(g, z as Zone, px, py, 5, 'rgba(255,255,245,1)', 'rgba(255,70,40,0.75)');
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

/** Пар из решётки: метка — дрожание, потом столб пара. */
registerZonePainter('f11_steam', (g, z, px, py, _s, time) => {
  const zz = z as Zone;
  const warn = zz.warn ?? 0;
  if (zz.t < warn) {
    const k = zz.t / warn;
    g.strokeStyle = `rgba(255,140,90,${0.4 + 0.5 * k})`;
    g.lineWidth = 1;
    g.beginPath();
    g.arc(px, py, zz.r * TS, 0, TAU);
    g.stroke();
    g.fillStyle = 'rgba(255,220,200,0.7)';
    for (let i = 0; i < 3; i++) g.fillRect(Math.round(px - 4 + i * 4), Math.round(py - 2 - ((time * 20 + i * 3) % 6)), 1, 1);
    return true;
  }
  const k = (zz.t - warn) / zz.life;
  g.globalAlpha = 0.7 * (1 - k * 0.8);
  g.fillStyle = '#f4f0ee';
  for (let i = 0; i < 8; i++) {
    const t = (time * 1.4 + i * 0.13) % 1;
    const r = 3 + t * 7;
    g.beginPath();
    g.arc(px + Math.sin(time * 3 + i) * 3, py - t * 30, r, 0, TAU);
    g.fill();
  }
  g.globalAlpha = 1;
  return true;
});

/** Лужа огня от ракеты. */
registerZonePainter('f11_scorch', (g, z, px, py, _s, time) => {
  const zz = z as Zone;
  const k = Math.min(1, zz.t / zz.life);
  g.fillStyle = `rgba(40,30,30,${0.4 * (1 - k)})`;
  g.beginPath();
  g.ellipse(px, py, zz.r * TS, zz.r * TS * 0.6, 0, 0, TAU);
  g.fill();
  g.fillStyle = `rgba(255,140,50,${0.8 * (1 - k)})`;
  for (let i = 0; i < 6; i++) {
    const a = i + time * 2;
    const r = zz.r * TS * 0.6 * hash(i, 3, 441);
    g.fillRect(Math.round(px + Math.cos(a) * r), Math.round(py + Math.sin(a) * r * 0.6 - ((time * 12 + i * 4) % 5)), 1, 2);
  }
  return true;
});

/** Лучи пилонов к стражу — купол держится ими. */
registerZonePainter('f11_pylonbeam', (g, z, px, py, _s, time) => {
  const sim = paintSim();
  if (!sim) return true;
  const zz = z as Zone & { pylon?: number };
  const pylon = sim.mobs.find((m) => m.id === zz.pylon && m.mode !== 'dying');
  const boss = sim.mobs.find((m) => m.kind === 'f11boss' && m.mode !== 'dying');
  if (!pylon || !boss) return true;
  const sx = px + (pylon.x - z.x) * TS;
  const sy = py + (pylon.y - z.y) * TS - 14;
  const ex = px + (boss.x - z.x) * TS;
  const ey = py + (boss.y - z.y) * TS - 22;
  const n = Math.ceil(Math.hypot(ex - sx, ey - sy));
  for (let i = 0; i < n; i += 1) {
    const t = i / n;
    const wob = Math.sin(t * 20 - time * 14) * 1.2;
    const x = sx + (ex - sx) * t - ((ey - sy) / n) * wob;
    const y = sy + (ey - sy) * t + ((ex - sx) / n) * wob;
    g.fillStyle = (i + Math.floor(time * 40)) % 5 === 0 ? 'rgba(255,255,255,0.95)' : 'rgba(120,220,255,0.7)';
    g.fillRect(Math.round(x), Math.round(y), 1, 1);
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

function canopy(p: Px, cx: number, cy: number, r: number, t: Tones, seed: number, blossom?: RGBA): void {
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

function treePx(kind: 'tree' | 'sakura' | 'cypress', sway: number): { p: Px; ax: number; ay: number } {
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
  canopy(p, cx + sway, H - 22, 9.5, leaves, kind === 'sakura' ? 7 : 3, kind === 'sakura' ? undefined : hx('#b4dc78'));
  if (kind === 'sakura')
    for (let i = 0; i < 5; i++) p.set(4 + Math.floor(hash(i, 9, 521) * 22), H - 3 + Math.floor(hash(i, 8, 522) * 2), hx('#f4b4c8'));
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
    polyShade(p, [[cx, cy], [ax, ay], [bx, by]], [mixc(cols[k], INK, 0.3), cols[k], mixc(cols[k], WHITE, 0.3), mixc(cols[k], WHITE, 0.6)]);
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
  polyShade(p, [[cx - 8, H - 3], [cx + 8, H - 3], [cx + 5.5, H - 22], [cx - 5.5, H - 22]], ROCK);
  for (let y = H - 20; y < H - 3; y += 4)
    for (let x = cx - 8; x <= cx + 8; x++) if (p.solid(x, y)) p.set(x, y, ROCK[0]);
  polyShade(p, [[cx - 6, H - 22], [cx + 6, H - 22], [cx + 4, H - 30], [cx - 4, H - 30]], PLANK);
  // Дверь.
  p.rect(cx - 2, H - 10, cx + 1, H - 4, hx('#3a2616'));
  p.set(cx - 2, H - 11, PLANK[3]);
  p.set(cx + 1, H - 11, PLANK[3]);
  // Крыша.
  polyShade(p, [[cx - 6, H - 30], [cx + 6, H - 30], [cx, H - 36]], tn('#6a2a26', '#9a3e34', '#c05a48', '#e08068'));
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
  const q = Math.round(((dir % TAU) + TAU) % TAU / (PI / 4)) % 8;
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
    polyShade(p, [[3, 20], [9, 20], [8, 17], [4, 17]], ROCK);
    limb(p, 6, 17, 6, 12, 1.4, 1.4, ROCK);
    polyShade(p, [[2, 12], [10, 12], [9, 7], [3, 7]], ROCK);
    p.rect(4, 8, 7, 11, [255, 200 + f * 12, 110, 255]);
    p.set(5, 9, WHITE);
    polyShade(p, [[0, 7], [12, 7], [8, 3], [4, 3]], tn('#5a5a60', '#7c7c84', '#9c9ca4', '#bcbcc4'));
    p.set(6, 2, ROCK[3]);
    return { p: ink(p), ax: 6, ay: 21 };
  });
});

// --- Мелочь, которая бьётся -----------------------------------------------------

registerPropPainter('f11_urn', (o, _t, _alive, flash) =>
  sprite(`urn|${o.area}|${flash ? 1 : 0}`, () => {
    const p = new Px(12, 14);
    dropShadow(p, 6, 12, 5, 2);
    const t = o.area === F11_CASTLE ? tn('#4a5a8a', '#6a82b8', '#8ea6d8', '#c0d2f0') : tn('#8a4a2a', '#b8683a', '#d88a52', '#f0b078');
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
      stroke(p, x, y, x + Math.cos(a + 1.6) * 2.5, y + Math.sin(a + 1.6) * 1, i % 3 ? PLANK[1] : PLANK[3]);
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
  const stone = area === F11_CASTLE ? tn('#7c7c88', '#a2a2ae', '#c4c4ce', '#e2e2ea') : tn('#76705e', '#9a927c', '#bab29a', '#d6cfb8');
  dropShadow(p, 14, 31, 11, 3);
  // Постамент.
  polyShade(p, [[4, 32], [22, 32], [21, 28], [5, 28]], stone);
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
    polyShade(p, [[1, 26], [13, 26], [12, 23], [2, 23]], t);
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
    if (!broken) polyShade(p, [[1, top], [13, top], [12, top - 3], [2, top - 3]], t);
    if (o.area !== F11_CASTLE)
      for (let i = 0; i < 6; i++) p.set(3 + Math.floor(hash(i, broken, 552) * 8), 12 + Math.floor(hash(i, 5, 553) * 10), MOSS[2]);
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
    polyShade(p, [[1, 5], [17, 5], [17, 8], [1, 8]], PATH);
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
      for (let x = 0; x < 26; x++) if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) < 9.5) clearPx(p, x, y);
    for (let k = 0; k < 8; k++) {
      const a = (k * PI) / 4 + (f * PI) / 24;
      stroke(p, cx, cy, cx + Math.cos(a) * 11, cy + Math.sin(a) * 11, PLANK[1], 1);
      const bx = cx + Math.cos(a) * 11;
      const by = cy + Math.sin(a) * 11;
      p.rect(Math.round(bx) - 1, Math.round(by) - 1, Math.round(bx) + 1, Math.round(by) + 1, PLANK[2]);
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
    for (let y = 6; y < 13; y++) for (let x = 4; x < 14; x++) p.set(x, y, tone(PLANK, (9.5 - y) / 4));
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
    for (let y = 5; y < 14; y++) for (let x = 3; x < 12; x++) if (Math.hypot(x + 0.5 - 7, y + 0.5 - 9) < 3.5) clearPx(p, x, y);
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
    polyShade(p, [[2, 20], [14, 20], [12, 9], [4, 9]], tn('#6a6a58', '#8e8c76', '#aeab92', '#cac7b0'));
    // Скрижаль с рунами.
    polyShade(p, [[3, 9], [13, 9], [12, 3], [4, 3]], tn('#3a4a5a', '#4e6478', '#66809a', '#8aa4bc'));
    const c = s === 'on' ? hx('#ff6a4a') : s === 'done' ? hx('#8a9aa8') : hx('#7af0c8');
    for (let i = 0; i < 4; i++) p.set(5 + i * 2, 5 + ((i + f) % 2), c);
    p.set(8, 7, c);
    for (let i = 0; i < 8; i++) p.set(3 + Math.floor(hash(i, 1, 571) * 10), 12 + Math.floor(hash(i, 2, 572) * 7), MOSS[2]);
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
      polyShade(p, [[bx - 2, by], [bx + 2, by], [tx + 1, ty], [tx - 1, ty]], CRYSTAL);
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
    for (let x = 0; x < W; x++) for (let y = H - 5; y < H; y++) if (p.solid(x, y)) p.set(x, y, alpha(pal.cloud[0], 0.9));
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
        p.set(10 + x, y, k < 0.35 ? tone(pal.earth, l * 0.5 + 0.4) : tone(pal.rock, l * 0.6 + 0.2 - k * 0.3));
      }
    }
    shadeEll(p, 10, 6, 8.5, 3, area === F11_CASTLE ? MARBLE : GRASS);
    if (v) polyShade(p, [[9, 24], [12, 24], [11, 20], [9, 20]], CRYSTAL);
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
    polyShade(p, [[2, 8], [7, 8], [6, 2], [3, 2]], CRYSTAL, f * 0.15);
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
        const l = -u * 0.55 + 0.35 + (y > 60 ? -0.3 : 0);
        let c = tone(RUIN, l);
        // Кладка рядами.
        const row = Math.floor((y - 34) / 4);
        const off = row % 2 ? 3 : 0;
        if ((y - 34) % 4 === 0 || (Math.round((x + off) / 6) * 6 === x + off && Math.abs(u) < 0.85)) c = mixc(c, RUIN[0], 0.55);
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
    for (let k = 0; k < 5; k++) stroke(p, cx, 13, cx - 13 + k * 6.5, 35, mixc(roof[0], roof[1], 0.5));
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
        out.set(Math.round(cx + Math.cos(aa) * 13), Math.round(8 + Math.sin(aa) * 5), alpha(hx('#ffe060'), 0.55));
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
  polyShade(p, [[1, 6], [13, 1], [25, 6], [13, 4]], sail);
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

function finishMob(key: string, b: Built, look: MobPose['look'], flash: boolean, left: boolean): MobFrame {
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
    if (fy < -1 && !dead) for (const [x, y] of lead.slice(2)) p.set(Math.floor(x), Math.floor(y) + 1, RAY_E[2]);
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
  if (pose.mode === 'dying' || pose.anim === 'dead') return mobFrame('ray', pose, 'dead', () => rayPx(2, 'dead', 0));
  if (pose.mode === 'aim') {
    const f = Math.floor(pose.t * 10) % 2;
    return mobFrame('ray', pose, `aim${f}`, () => rayPx(-5 + f, 'aim', 0));
  }
  if (pose.mode === 'f11_swoop') {
    const f = Math.floor(pose.t * 14) % 2;
    return mobFrame('ray', pose, `swoop${f}`, () => rayPx(0, 'swoop', f * 3));
  }
  if (pose.anim === 'hurt') return mobFrame('ray', pose, 'hurt', () => rayPx(2, 'hurt', 1));
  const f = (((Math.floor((paintSim()?.time ?? 0) * 9 + m.id * 1.7) % 8) + 8) % 8);
  return mobFrame('ray', pose, `glide${f}`, () => rayPx(Math.round(Math.sin((f / 8) * TAU) * 4.5), 'glide', f));
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
  if (pose.mode === 'dying' || pose.anim === 'dead') return mobFrame('gard', pose, 'dead', gardenerDead);
  const f4 = ((pose.frame % 4) + 4) % 4;
  switch (pose.mode) {
    case 'f11_tend': {
      const f = Math.floor(pose.t * 1.6 + m.id) % 2;
      return mobFrame('gard', pose, `tend${f}`, () =>
        gardenerPx({ ...base, lean: 1, headDy: 1 + f * 0.5, armF: [18, 13, 22, 20, 23, 26 - f], tool: 'flower' }, 0),
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
          gardenerPx({ ...base, lean: -1, eyeBright: true, armF: [18, 13, 20, 7, 16, 3], tool: 'shears-open' }, 0),
        );
      return mobFrame('gard', pose, `snips${tag}`, () =>
        gardenerPx({ ...base, lean: 2, legF: 2, legB: -1, armF: [19, 13, 22, 14, 25, 15], tool: 'shears' }, 0),
      );
    }
    case 'f11_hose': {
      const f = Math.floor(pose.t * 12) % 2;
      return mobFrame('gard', pose, `hose${f}${tag}`, () =>
        gardenerPx({ ...base, lean: 1, eyeBright: true, armF: [18, 13, 21, 15, 24, 14 + f], tool: 'hose' }, 0),
      );
    }
  }
  if (pose.anim === 'hurt')
    return mobFrame('gard', pose, `hurt${tag}`, () => gardenerPx({ ...base, lean: -1, headDy: -1, eye: WHITE }, 0));
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
    gardenerPx({ ...base, headDy: b, armB: [8, 13, 6, 19 + b, 5, 24 + b], armF: [18, 13, 20, 19 + b, 20, 24 + b] }, 0),
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
  if (pose.mode === 'dying' || pose.anim === 'dead') return mobFrame('guard', pose, 'dead', guardDead);
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
      return mobFrame('guard', pose, `post${f}`, () => guardPx({ ...base, eye: f ? hx('#ffb040') : hx('#c87a30') }, 0));
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
        guardPx({ ...base, lean: 1, headDy: 0.5, eyeBright: true, armF: [21, 14, 24, 18, 24, 23] }, f),
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
        guardPx({ ...base, lean: 2, legF: 3, legB: -2, eyeBright: true, armF: [21, 14, 25, 17, 27, 23] }, 0),
      );
    }
  }
  if (pose.anim === 'hurt')
    return mobFrame('guard', pose, 'hurt', () => guardPx({ ...base, lean: -1, headDy: -1, eye: WHITE }, 0));
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
  return mobFrame('guard', pose, `idle${f4 >> 1}`, () => guardPx({ ...base, headDy: f4 >> 1 ? 0.5 : 0 }, 0));
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
function wing(p: Px, sx: number, sy: number, s: number, a: number, len: number, spread: number, bias: number): void {
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
  for (let i = 0; i < 3; i++) limb(p, cx - 1, cy + 5, cx - 5 + i * 2, cy + 11 - Math.abs(i - 1), 1.3, 0.6, FEATH, -0.1);
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
    for (let i = 0; i < 4; i++) for (let x = 0; x < 6; x++) out.set(x + i, 6 + i * 4, alpha(WHITE, 0.2 + x * 0.06));
  return { p: out, ax: 17, ay: H - 2, eye: [hx0 + 2, hy0] };
}

registerMobPainter('f11_harpy', (m: Mob, pose: MobPose) => {
  const base: HarpyPose = { a: 0.4, len: 12, spread: 0.2, claw: 0, tilt: 0, eye: hx('#f6c83a') };
  if (pose.mode === 'dying' || pose.anim === 'dead')
    return mobFrame('harpy', pose, 'dead', () => harpyPx({ ...base, a: -1, len: 10, spread: 0.1, hurt: true, eye: INK }));
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
      return mobFrame('harpy', pose, 'claw', () => harpyPx({ ...base, a: 1.25, len: 13, claw: 1, tilt: -1, eye: hx('#ff6a3a') }));
    case 'f11_lunge':
      return mobFrame('harpy', pose, 'lunge', () =>
        harpyPx({ ...base, a: 1.45, len: 11, spread: 0.12, claw: 1, tilt: 1, eye: hx('#ff6a3a'), speed: true }),
      );
  }
  if (pose.anim === 'hurt') return mobFrame('harpy', pose, 'hurt', () => harpyPx({ ...base, a: -0.3, hurt: true, eye: WHITE }));
  const f = (((Math.floor((paintSim()?.time ?? 0) * 8 + m.id * 1.3) % 4) + 4) % 4);
  const A = [1.05, 0.45, -0.35, 0.3][f];
  return mobFrame('harpy', pose, `fly${f}`, () => harpyPx({ ...base, a: A, len: 12 + (f === 2 ? 1 : 0) }));
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
  if (pose.mode === 'dying' || pose.anim === 'dead') return mobFrame('jelly', pose, 'dead', () => jellyPx(1, 0, true));
  if (pose.mode === 'f11_zap') {
    const on = pose.t > JELLY.zap - 0.25;
    const f = Math.floor(pose.t * (on ? 20 : 10)) % 2;
    return mobFrame('jelly', pose, `zap${on ? 1 : 0}${f}`, () => jellyPx(f + (on ? 2 : 0), on ? 1 : f, false));
  }
  if (pose.mode === 'recover') return mobFrame('jelly', pose, 'rest', () => jellyPx(1, 0, true));
  if (pose.anim === 'hurt') return mobFrame('jelly', pose, 'hurt', () => jellyPx(0, 0, true));
  const f = (((Math.floor((paintSim()?.time ?? 0) * 4 + m.id) % 6) + 6) % 6);
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
      boarderPx({ ...base, lean: -2, legF: 4, legB: 3, armF: [16, 12, 20, 14, 23, 13], hook: null, scarf: 2 }),
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
        boarderPx({ ...base, lean: 2, legF: 2, legB: -2, armF: [16, 12, 20, 12, 24, 11], hook: null, scarf: 1 }),
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
          ? boarderPx({ ...base, lean: 2, legF: 3, legB: -2, armF: [16, 12, 20, 14, 22, 15], hook: null, blade: 'down', scarf: 1 })
          : boarderPx({ ...base, lean: -1, armF: [16, 12, 17, 7, 15, 4], hook: null, blade: 'up', scarf: 0 }),
      );
    }
  }
  if (pose.anim === 'hurt') return mobFrame('board', pose, 'hurt', () => boarderPx({ ...base, lean: -2, scarf: 3 }));
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
  const f = (((Math.floor(t * 3 + m.id) % 4) + 4) % 4);
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
  if (pose.mode === 'dying' || pose.anim === 'dead') return mobFrame('moss', pose, 'dead', () => springPx(1, 0, 1.5, 'closed', 1));
  switch (pose.mode) {
    case 'f11_hide':
      return mobFrame('moss', pose, `hide${Math.floor(pose.t * 0.7 + m.id) % 3 === 0 ? 1 : 0}`, () =>
        springPx(0, 0, 0, Math.floor(pose.t * 0.7 + m.id) % 3 === 0 ? 'closed' : 'peek', 0, true),
      );
    case 'f11_pop': {
      const f = Math.min(3, Math.floor(pose.t * 10));
      return mobFrame('moss', pose, `pop${f}`, () => springPx([1, 6, 5, 3][f], [0, 3, 1, 0][f], [1, -1, -0.5, 0][f], 'angry'));
    }
    case 'f11_crouch': {
      const f = pose.t < MOSS_AI.crouch * 0.5 ? 0 : 1;
      return mobFrame('moss', pose, `crouch${f}`, () => springPx(f ? 0.8 : 1.6, 0, f ? 1.6 : 1, 'angry'));
    }
    case 'f11_jump': {
      const k = Math.min(1, pose.t / MOSS_AI.air);
      const f = Math.min(5, Math.floor(k * 6));
      const h = Math.round(Math.sin(((f + 0.5) / 6) * PI) * 9);
      return mobFrame('moss', pose, `jump${f}`, () => springPx(f < 3 ? 6 : 4, h, f < 2 ? -1 : 0, 'angry'));
    }
    case 'f11_tired': {
      const f = Math.floor(pose.t * 2) % 2;
      return mobFrame('moss', pose, `tired${f}`, () => springPx(2, 0, 1 + f * 0.3, 'closed', 1));
    }
  }
  if (pose.anim === 'hurt') return mobFrame('moss', pose, 'hurt', () => springPx(2, 0, 1.2, 'closed'));
  const f4 = ((pose.frame % 4) + 4) % 4;
  return mobFrame('moss', pose, `idle${f4}`, () => springPx([3, 4, 3, 2][f4], 0, [0, -0.5, 0, 0.6][f4], 'open'));
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
      p.set(x, y, alpha(e > 0.75 ? hx('#3a8aa8') : hx('#9ad8ec'), (e > 0.75 ? 0.55 : 0.28) * (dim ? 0.6 : 1)));
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
  if (pose.mode === 'dying' || pose.anim === 'dead') return mobFrame('spirit', pose, 'dead', () => spiritPx(0, false, true));
  if (pose.mode === 'cast') {
    const f = (Math.floor(pose.t * (pose.t > SPIRIT.cast - 0.3 ? 18 : 10)) % 6) + 6;
    return mobFrame('spirit', pose, `cast${f % 6}`, () => spiritPx(f % 6, true, false));
  }
  const f = (((Math.floor(t * 7 + m.id) % 6) + 6) % 6);
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
  const f = (((Math.floor(t * 24 + m.id) % 6) + 6) % 6);
  if (pose.mode === 'dying' || pose.anim === 'dead') return mobFrame('drone', pose, 'dead', () => dronePx(0, EYE_OFF, false));
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
    for (const s of [-1, 1]) p.ell(cx + s * 5, cy - 4 - (f % 2), 4, 2.4, alpha(hx('#e8f4ff'), 0.55));
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
  const f = (((Math.floor(t * (run ? 16 : 4) + m.id) % 4) + 4) % 4);
  if (pose.mode === 'dying' || pose.anim === 'dead') return mobFrame('beetle', pose, 'dead', () => beetlePx(0, false));
  if (pose.mode === 'escape') return mobFrame('beetle', pose, `fly${f}`, () => beetlePx(f, true));
  return mobFrame('beetle', pose, `walk${f}`, () => beetlePx(f, false));
});

// --- Пилон щита --------------------------------------------------------------------

function pylonPx(f: number, dead: boolean): Built {
  const W = 18;
  const H = 38;
  const p = new Px(W, H);
  const cx = 9;
  const gy = 36;
  polyShade(
    p,
    [
      [cx - 7, gy],
      [cx + 7, gy],
      [cx + 5, gy - 6],
      [cx - 5, gy - 6],
    ],
    ROCK,
  );
  for (let x = cx - 5; x <= cx + 5; x += 2) p.set(x, gy - 3, dead ? ROCK[0] : RUNE);
  polyShade(
    p,
    [
      [cx - 3.5, gy - 6],
      [cx + 3.5, gy - 6],
      [cx + 2, gy - 30],
      [cx, gy - 34],
      [cx - 2, gy - 30],
    ],
    dead ? tn('#2a3a40', '#3a5058', '#50707a', '#7a98a0') : CRYSTAL,
  );
  stroke(p, cx, gy - 33, cx, gy - 7, dead ? hx('#2a3a40') : CRYSTAL[3]);
  for (const y of [gy - 12, gy - 22]) {
    p.rect(cx - 3, y, cx + 3, y + 1, GOLD[1]);
    p.rect(cx - 3, y, cx + 3, y, GOLD[3]);
  }
  if (dead) {
    stroke(p, cx - 2, gy - 25, cx + 1, gy - 18, INK);
    stroke(p, cx + 1, gy - 18, cx - 1, gy - 10, INK);
  }
  const out = ink(p, hx('#1a3a44'));
  if (!dead) {
    const y = gy - 8 - ((f * 6) % 24);
    for (let x = cx - 2; x <= cx + 2; x++) if (out.get(x, y)[3]) out.set(x, y, alpha(WHITE, 0.8));
    out.set(cx, gy - 34, WHITE);
    out.set(cx, gy - 35, alpha(CYAN, 0.7));
  }
  return { p: out, ax: cx, ay: gy, eye: null };
}

registerMobPainter('f11_pylon', (m: Mob, pose: MobPose) => {
  const t = paintSim()?.time ?? 0;
  if (pose.mode === 'dying' || pose.anim === 'dead') return mobFrame('pylon', pose, 'dead', () => pylonPx(0, true));
  const f = (((Math.floor(t * 6 + m.id) % 4) + 4) % 4);
  return mobFrame('pylon', pose, `on${f}`, () => pylonPx(f, false));
});

// --- Древний страж ---------------------------------------------------------------
//
// Великан-садовник, которого поставили охранять остров, когда тот ещё был
// крепостью: круглый корпус из древнего камня-бронзы, маленькая голова с
// одним глазом, руки до земли. На плечах за века вырос сад — мох, цветы и
// деревце. По телу бегут руны; в груди — ядро под плитой. Фазы видно:
// купол (2), плита ядра раздвинута и ядро пылает (3), трещины и красный глаз (4).

const ANC = tn('#48443a', '#6a6856', '#928e76', '#b8b49a');
const ANC_SEAM = hx('#2c2a22');
const CORE_HOT = tn('#b04010', '#f08030', '#ffc060', '#fff4c0');

interface BossPose {
  lean: number;
  sink: number;
  legF: number;
  legB: number;
  /** Нога поднята (топот): на столько выше. */
  lift: number;
  armB: Arm;
  armF: Arm;
  headDy: number;
  eye: RGBA;
  eyeR: number;
  bright: boolean;
  /** 0 — плита, 1 — раздвинута, ядро пылает. */
  core: number;
  hatches: boolean;
  cracks: boolean;
  steam: boolean;
  kneel: boolean;
  shield: boolean;
  runes: number;
  f: number;
}

function bossHand(p: Px, x: number, y: number, down: boolean, bias: number): void {
  shadeEll(p, x, y, 3.8, 3.2, ANC, bias + 0.1);
  for (let k = -1; k <= 1; k++) {
    const fx = x + k * 2.4;
    limb(p, fx, y + 1, fx + k * 0.8, y + (down ? 5 : 4), 1.2, 0.9, ANC, bias);
  }
}

function bossPx(q: BossPose): Built {
  const W = 72;
  const H = 70;
  const p = new Px(W, H);
  const gy = 64;
  const cx = 36 + q.lean;
  const cy = 38 + q.sink;
  // Дальняя рука.
  limb(p, q.armB[0], q.armB[1], q.armB[2], q.armB[3], 3.4, 3, ANC, -0.25);
  limb(p, q.armB[2], q.armB[3], q.armB[4], q.armB[5], 3, 2.6, ANC, -0.25);
  shadeEll(p, q.armB[2], q.armB[3], 3.3, 3.3, ANC, -0.15);
  bossHand(p, q.armB[4], q.armB[5], true, -0.25);
  // Ноги.
  if (q.kneel) {
    limb(p, cx - 6, cy + 10, cx - 9, gy - 2, 4.4, 3.8, ANC, -0.15);
    limb(p, cx + 5, cy + 10, cx + 12, cy + 12, 4.4, 4, ANC, 0);
    limb(p, cx + 12, cy + 12, cx + 12, gy - 2, 4, 3.6, ANC, 0);
    shadeEll(p, cx - 9, gy - 1, 5.5, 2.6, ANC, -0.1);
    shadeEll(p, cx + 13, gy - 1, 5.5, 2.6, ANC);
  } else {
    limb(p, cx - 6, cy + 10, cx - 6 + q.legB, gy - 2, 4.4, 3.8, ANC, -0.15);
    limb(p, cx + 5, cy + 10, cx + 5 + q.legF, gy - 2 - q.lift, 4.4, 3.8, ANC, 0);
    shadeEll(p, cx - 6 + q.legB, gy - 1, 5.5, 2.6, ANC, -0.1);
    shadeEll(p, cx + 6 + q.legF, gy - 1 - q.lift, 5.5, 2.6, ANC);
  }
  // Корпус.
  shadeEll(p, cx, cy, 15.5, 15, ANC);
  for (let x = cx - 16; x <= cx + 16; x++) if (p.solid(x, cy + 4)) p.set(x, cy + 4, ANC_SEAM);
  for (let x = cx - 13; x <= cx + 13; x += 4) p.set(x, cy + 5, ANC[3]);
  // Пятна времени: сколы и прожилки.
  for (let i = 0; i < 40; i++) {
    const x = Math.round(cx - 14 + hash(i, 1, 801) * 28);
    const y = Math.round(cy - 13 + hash(i, 2, 802) * 26);
    if (p.solid(x, y) && hash(i, 3, 803) < 0.6) p.set(x, y, ANC[hash(i, 4, 804) < 0.5 ? 0 : 1]);
  }
  // Руны: кольцо вокруг ядра и лучи от него.
  const rc = mixc(ANC[1], RUNE, 0.2 + 0.8 * q.runes);
  const kx = cx + 3;
  const ky = cy - 2;
  for (let a = 0; a < TAU; a += 0.06) {
    const x = Math.round(kx + Math.cos(a) * 8.5);
    const y = Math.round(ky + Math.sin(a) * 8);
    if (p.solid(x, y)) p.set(x, y, rc);
  }
  for (const a of [-2.36, -0.79, 0.79, 2.36]) {
    for (let r = 9.5; r < 12.5; r++) {
      const x = Math.round(kx + Math.cos(a) * r);
      const y = Math.round(ky + Math.sin(a) * r * 0.95);
      if (p.solid(x, y)) p.set(x, y, rc);
    }
  }
  // Ядро: шестигранная плита или раздвинутые створки.
  const hexPts = (r: number): [number, number][] =>
    [0, 1, 2, 3, 4, 5].map((k) => [kx + Math.cos((k * PI) / 3 + PI / 6) * r, ky + Math.sin((k * PI) / 3 + PI / 6) * r]);
  if (q.core) {
    poly(p, hexPts(6.2), IRON[0]);
    shadeEll(p, kx, ky, 4.4, 4.4, CORE_HOT, 0.2 + (q.f % 2) * 0.15);
    p.set(kx - 1, ky - 2, WHITE);
    p.set(kx - 2, ky - 1, WHITE);
    // Створки — по бокам.
    polyShade(p, [[kx - 10, ky - 5], [kx - 6, ky - 6], [kx - 6, ky + 5], [kx - 10, ky + 4]], ANC, 0.1);
    polyShade(p, [[kx + 6, ky - 6], [kx + 10, ky - 5], [kx + 10, ky + 4], [kx + 6, ky + 5]], ANC, -0.05);
  } else {
    polyShade(p, hexPts(5.6), ANC, 0.2);
    poly(p, hexPts(2.4), mixc(ANC[1], RUNE, 0.3 + 0.7 * q.runes));
    p.set(kx, ky, q.runes > 0.6 ? WHITE : RUNE);
  }
  // Трещины последней фазы.
  if (q.cracks) {
    const lines: [number, number, number, number][] = [
      [cx - 12, cy - 6, cx - 5, cy + 2],
      [cx - 5, cy + 2, cx - 7, cy + 10],
      [cx + 10, cy - 10, cx + 13, cy - 1],
      [cx + 13, cy - 1, cx + 9, cy + 8],
    ];
    for (const [x0, y0, x1, y1] of lines) stroke(p, x0, y0, x1, y1, CORE_HOT[q.f % 2 ? 2 : 1]);
  }
  // Сад на плечах: мох, цветы, деревце на дальнем плече.
  for (let i = 0; i < 60; i++) {
    const x = Math.round(cx - 15 + hash(i, 1, 811) * 30);
    const y = Math.round(cy - 16 + hash(i, 2, 812) * 8);
    if (!p.solid(x, y)) continue;
    const top = !p.solid(x, y - 1);
    p.set(x, y, top ? MOSS[3] : MOSS[hash(i, 3, 813) < 0.5 ? 1 : 2]);
    if (top && hash(i, 4, 814) < 0.3) p.set(x, y - 1, MOSS[2]);
  }
  for (let i = 0; i < 6; i++) {
    const x = Math.round(cx - 12 + hash(i, 5, 815) * 24);
    const y = Math.round(cy - 14 + hash(i, 6, 816) * 4);
    if (p.solid(x, y)) p.set(x, y, [hx('#f4f0ea'), hx('#e888a8'), hx('#f6d24a')][i % 3]);
  }
  limb(p, cx - 10, cy - 13, cx - 11, cy - 20, 1, 0.8, BARK);
  canopy(p, cx - 11, cy - 23, 4, GRASS, 21, hx('#b4dc78'));
  // Люки ракет на плечах.
  if (q.hatches)
    for (const sx of [cx - 11, cx + 9]) {
      p.rect(sx - 2, cy - 12, sx + 2, cy - 10, IRON[0]);
      for (let k = -1; k <= 1; k++) p.set(sx + k * 1.6, cy - 12 - (q.f % 2), hx('#e84a3a'));
    }
  // Голова.
  const hx0 = cx + 5;
  const hy0 = cy - 17 + q.headDy;
  shadeEll(p, hx0, hy0, 7.5, 6, ANC, 0.1);
  for (let x = hx0 - 7; x <= hx0 + 7; x++) if (p.solid(x, hy0 + 3)) p.set(x, hy0 + 3, ANC_SEAM);
  for (let i = 0; i < 14; i++) {
    const x = Math.round(hx0 - 6 + hash(i, 7, 821) * 12);
    const y = Math.round(hy0 - 6 + hash(i, 8, 822) * 3);
    if (p.solid(x, y) && !p.solid(x, y - 1)) p.set(x, y, MOSS[3]);
  }
  lens(p, hx0 + 3, hy0, q.eyeR, q.eye, q.bright);
  // Ближняя рука.
  limb(p, q.armF[0], q.armF[1], q.armF[2], q.armF[3], 3.6, 3.2, ANC, 0.05);
  limb(p, q.armF[2], q.armF[3], q.armF[4], q.armF[5], 3.2, 2.8, ANC, 0.05);
  shadeEll(p, q.armF[2], q.armF[3], 3.5, 3.5, ANC, 0.15);
  for (let k = 0; k < 4; k++) {
    const t = (k + 0.5) / 4;
    const x = Math.round(q.armF[0] + (q.armF[2] - q.armF[0]) * t);
    const y = Math.round(q.armF[1] + (q.armF[3] - q.armF[1]) * t);
    if (p.solid(x, y)) p.set(x, y, rc);
  }
  bossHand(p, q.armF[4], q.armF[5], true, 0.05);
  const out = ink(p);
  // Блик взгляда.
  if (q.bright && q.eyeR > 3) {
    const ex = hx0 + 3;
    const flare = mixc(q.eye, WHITE, 0.5);
    for (let k = 4; k <= 9; k++) {
      out.set(ex + k, hy0, alpha(flare, 1 - k * 0.09));
      out.set(ex - k, hy0, alpha(flare, 0.9 - k * 0.09));
    }
    for (let k = 4; k <= 6; k++) {
      out.set(ex, hy0 - k, alpha(flare, 0.8 - k * 0.1));
      out.set(ex, hy0 + k, alpha(flare, 0.8 - k * 0.1));
    }
  }
  if (q.steam) {
    puffs(out, cx - 14, cy - 8, q.f, 3, 3);
    puffs(out, cx + 15, cy - 6, q.f + 0.5, 3, 3);
  }
  if (q.kneel) dizzy(out, hx0, hy0 - 9, 7, q.f);
  // Купол защитного протокола — сотами поверх всего.
  if (q.shield) {
    const scx = cx;
    const scy = cy - 4;
    const R = 34;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const d = Math.hypot(x + 0.5 - scx, (y + 0.5 - scy) * 1.02);
        if (d > R) continue;
        const edge = d > R - 1.5;
        // Соты: шестиугольная сетка по мировым пикселям кадра.
        const u = x / 7;
        const v = y / 6 + (Math.floor(u) % 2) * 0.5;
        const fu = u - Math.floor(u);
        const fv = v - Math.floor(v);
        const line = fu < 0.14 || fv < 0.16;
        const k = d / R;
        const a = edge ? 0.85 : line ? 0.18 + 0.35 * k * k : 0.05 + 0.1 * k * k;
        out.set(x, y, alpha(edge ? WHITE : CYAN, a));
      }
  }
  return { p: out, ax: 36, ay: gy, eye: [hx0 + 3, hy0] };
}

function bossDead(): Built {
  const W = 72;
  const H = 56;
  const p = new Px(W, H);
  shadeEll(p, 32, 34, 17, 13, ANC, -0.05);
  for (let x = 15; x <= 49; x++) if (p.solid(x, 36)) p.set(x, 36, ANC_SEAM);
  shadeEll(p, 50, 42, 7, 5.5, ANC, -0.05);
  lens(p, 52, 43, 2.6, EYE_OFF);
  limb(p, 18, 38, 8, 48, 3.2, 2.8, ANC, -0.1);
  bossHand(p, 8, 48, true, -0.1);
  limb(p, 44, 40, 58, 50, 3.2, 2.8, ANC);
  bossHand(p, 58, 50, true, 0);
  for (let i = 0; i < 90; i++) {
    const x = Math.floor(hash(i, 1, 831) * W);
    const y = Math.floor(hash(i, 2, 832) * H);
    if (p.solid(x, y) && !p.solid(x, y - 1)) p.set(x, y, MOSS[hash(i, 3, 833) < 0.5 ? 2 : 3]);
  }
  for (let i = 0; i < 8; i++) {
    const x = Math.round(20 + hash(i, 5, 834) * 26);
    const y = Math.round(22 + hash(i, 6, 835) * 6);
    if (p.solid(x, y)) p.set(x, y, [hx('#f4f0ea'), hx('#e888a8'), hx('#f6d24a')][i % 3]);
  }
  limb(p, 24, 24, 23, 16, 1, 0.8, BARK);
  canopy(p, 23, 13, 4.5, GRASS, 21, hx('#b4dc78'));
  return { p: ink(p), ax: 36, ay: 50, eye: null };
}

registerMobPainter('f11boss', (m: Mob, pose: MobPose) => {
  const psim = paintSim();
  const st = f11State(psim);
  const phase = st?.arena.phase || 1;
  const shield = !!psim?.boss?.data.shield && psim.boss.state === 'fight';
  const eye = phase >= 4 ? EYE_ANGRY : phase === 3 ? hx('#ffb040') : CYAN;
  const tag = `${phase}${shield ? 's' : ''}`;
  const base: BossPose = {
    lean: 0,
    sink: 0,
    legF: 0,
    legB: 0,
    lift: 0,
    armB: [22, 30, 15, 44, 14, 56],
    armF: [50, 30, 57, 44, 58, 56],
    headDy: 0,
    eye,
    eyeR: 2.6,
    bright: false,
    core: phase >= 3 ? 1 : 0,
    hatches: false,
    cracks: phase >= 4,
    steam: phase >= 3,
    kneel: false,
    shield,
    runes: phase === 2 ? 1 : 0.5,
    f: 0,
  };
  if (pose.mode === 'dying' || pose.anim === 'dead') return mobFrame('boss', pose, 'dead', bossDead);
  const t = paintSim()?.time ?? 0;
  const f2 = Math.floor(t * 6) % 2;
  switch (pose.mode) {
    case 'roar':
    case 'f11_wake': {
      const k = Math.min(1, pose.t / BOSS.wake);
      const s = Math.min(3, Math.floor(k * 4));
      return mobFrame('boss', pose, `wake${s}${tag}`, () =>
        bossPx({
          ...base,
          sink: [5, 3, 1, 0][s],
          headDy: [3, 2, 0, -1][s],
          eye: s === 0 ? EYE_OFF : eye,
          eyeR: s === 3 ? 3.4 : 2.6,
          bright: s >= 2,
          runes: s / 3,
          armB: s === 3 ? [22, 30, 14, 20, 10, 12] : base.armB,
          armF: s === 3 ? [50, 30, 58, 20, 62, 12] : base.armF,
          steam: s >= 1,
          f: s,
        }),
      );
    }
    case 'f11_shift': {
      const s = Math.floor(pose.t * 5) % 2;
      return mobFrame('boss', pose, `shift${s}${tag}`, () =>
        bossPx({
          ...base,
          sink: 2,
          headDy: 1,
          bright: !!s,
          runes: 1,
          steam: true,
          armB: [22, 30, 26, 40, 34, 40],
          armF: [50, 30, 46, 40, 40, 40],
          f: s,
        }),
      );
    }
    case 'f11_stagger':
      return mobFrame('boss', pose, `stag${f2}${tag}`, () =>
        bossPx({ ...base, kneel: true, sink: 6, headDy: 4, core: 1, eyeR: 2.2, eye: f2 ? eye : EYE_OFF, steam: true, f: f2 }),
      );
    case 'f11_gaze': {
      const lock = pose.t > BOSS.gazeTrack;
      return mobFrame('boss', pose, `gaze${lock ? 1 : 0}${f2}${tag}`, () =>
        bossPx({ ...base, lean: 2, headDy: 1, eyeR: lock ? 4.2 : 3.6, bright: true, eye: lock ? WHITE : eye, f: f2 }),
      );
    }
    case 'f11_slam': {
      const strike = pose.t > BOSS.slamWarn - 0.18;
      return mobFrame('boss', pose, `slam${strike ? 1 : 0}${tag}`, () =>
        strike
          ? bossPx({ ...base, lean: 3, sink: 4, headDy: 2, bright: true, armB: [22, 32, 20, 48, 24, 62], armF: [50, 32, 56, 48, 56, 62] })
          : bossPx({ ...base, lean: -2, sink: -1, bright: true, armB: [22, 30, 20, 16, 28, 6], armF: [50, 30, 52, 16, 46, 6] }),
      );
    }
    case 'f11_stomp': {
      const strike = pose.t > BOSS.stompWarn - 0.15;
      return mobFrame('boss', pose, `stomp${strike ? 1 : 0}${tag}`, () =>
        strike
          ? bossPx({ ...base, sink: 2, legF: 3, bright: true, f: 1 })
          : bossPx({ ...base, lean: -2, lift: 9, legF: 4, bright: true, armB: [22, 30, 12, 36, 8, 44], armF: [50, 30, 60, 36, 64, 44] }),
      );
    }
    case 'f11_rockets':
      return mobFrame('boss', pose, `rock${f2}${tag}`, () =>
        bossPx({ ...base, hatches: true, lean: -1, headDy: -1, bright: true, armB: [22, 30, 12, 38, 8, 48], armF: [50, 30, 60, 38, 64, 48], f: f2 }),
      );
    case 'f11_spin':
      return mobFrame('boss', pose, `spin${f2}${tag}`, () =>
        bossPx({
          ...base,
          eyeR: 3.8,
          bright: true,
          armB: [22, 30, 11, 30, 2, 30],
          armF: [50, 30, 61, 30, 68, 30],
          steam: true,
          f: f2,
        }),
      );
  }
  if (pose.anim === 'hurt') return mobFrame('boss', pose, `hurt${tag}`, () => bossPx({ ...base, lean: -1, headDy: -1, eye: WHITE }));
  const f4 = ((pose.frame % 4) + 4) % 4;
  if (pose.anim === 'run') {
    const sw = [-3, 0, 3, 0][f4];
    return mobFrame('boss', pose, `run${f4}${tag}`, () =>
      bossPx({
        ...base,
        sink: f4 % 2 ? -1 : 0,
        legF: sw,
        legB: -sw,
        armB: [22, 30, 15 - sw * 0.5, 44, 14 - sw, 56],
        armF: [50, 30, 57 + sw * 0.5, 44, 58 + sw, 56],
        f: f4,
      }),
    );
  }
  const b = f4 === 1 || f4 === 2 ? 1 : 0;
  return mobFrame('boss', pose, `idle${f4}${tag}`, () =>
    bossPx({ ...base, sink: b * 0.6, runes: base.runes + b * 0.2, armB: [22, 30, 15, 44 + b, 14, 56 + b], armF: [50, 30, 57, 44 + b, 58, 56 + b], f: f4 }),
  );
});

// --- Снаряды ----------------------------------------------------------------------

registerShotPainter('f11_rocket', (s, time) => {
  const a = Math.atan2(s.vy - (s.lob ? 1 : 0), s.vx);
  const q = ((Math.round((a / TAU) * 8) % 8) + 8) % 8;
  const f = Math.floor(time * 16) % 2;
  return sprite(`rocket|${q}|${f}`, () => {
    const p = new Px(14, 14);
    const dx = Math.cos((q * TAU) / 8);
    const dy = Math.sin((q * TAU) / 8);
    // Пламя сзади.
    for (let k = 2; k < 6 + f; k++) {
      const x = 7 - dx * k;
      const y = 7 - dy * k;
      p.set(Math.round(x), Math.round(y), k < 4 ? hx('#fff0a0') : alpha(hx('#ff8a3a'), 1 - (k - 3) * 0.2));
    }
    limb(p, 7 - dx * 2, 7 - dy * 2, 7 + dx * 3, 7 + dy * 3, 1.5, 1.2, tn('#4a4a50', '#7a7a84', '#aaaab4', '#dcdce4'));
    p.set(Math.round(7 + dx * 3.5), Math.round(7 + dy * 3.5), hx('#e84a3a'));
    return { p: ink(p), ax: 7, ay: 7 };
  });
});

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
    p.rect(Math.round(5 + Math.cos(a) * 3.6) - 0, Math.round(5 + Math.sin(a) * 3.6) - 0, Math.round(5 + Math.cos(a) * 3.6), Math.round(5 + Math.sin(a) * 3.6), BRASS[1]);
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
    [0, 1, 2, 3, 4, 5].map((k) => [5 + Math.cos((k * PI) / 3 + PI / 6) * 4.6, 5 + Math.sin((k * PI) / 3 + PI / 6) * 4.6]),
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
