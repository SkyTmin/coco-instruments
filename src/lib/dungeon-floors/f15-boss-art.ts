// Этаж 15, район «Сердце» — рисовальщики: Хозяин подземелья (химера —
// крылатый лев из плоти и камня), истинное сердце, кокон, отголоски пяти
// прошлых боссов (их же рисовальщики, перекрашенные в призрак), кровяной
// сгусток; живые клетки камеры (плоть с тканью клеток, вены, корни,
// знаки памяти, лава, бездна, зеркала, круги гидры, вспухшие стены);
// реквизит (рёбра, сухожилия, пузыри, капель, глаза в стенах, реликвии в
// нишах); метки ударов, снаряды, иконки вещей.
//
// Всё рисует код: пиксели 16 на клетку, свет сверху-слева, контур тёмный,
// палитра — ступени плоти и камня плюс два акцента: кровавое свечение
// вен и золото глаз Хозяина. Кадры собираются один раз и лежат в кеше.
// Состояние боя (кокон, фаза, пульс) — `paintSim()` + `f15bView()`; ключ
// кеша кадра покрывает всё прочитанное.

import { Px } from '../dungeon-art';
import {
  MOB_PAINTERS,
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
import { F15_HEART, F15B_MARK } from './f15-boss';
import { beatK, f15bView, HEART, LION } from './f15-boss-brains';

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

const INK = hx('#150a0b');
const WHITE = hx('#ffffff');
const TAU = Math.PI * 2;
const MK = F15B_MARK;

/** Четыре тона формы: тень, основа, свет, блик. */
type Tones = [RGBA, RGBA, RGBA, RGBA];
const tn = (a: string, b: string, c: string, d: string): Tones => [hx(a), hx(b), hx(c), hx(d)];

/** Свет сверху-слева-спереди. */
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

/** Сужающаяся «капсула» от (x0, y0) до (x1, y1) со светом по нормали. */
function limb(p: Px, x0: number, y0: number, x1: number, y1: number, r0: number, r1: number, t: Tones, bias = 0): void {
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

/** Многоугольник с плоской гранью: свет по её наклону. */
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

/** Детерминированный шум по числам, 0…1. */
const hash = (a: number, b: number, c = 0) => {
  let h = (a * 374761393 + b * 668265263 + c * 1274126177) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** Сглаженный шум 0…1. */
function vnoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi, seed) * (1 - u) + hash(xi + 1, yi, seed) * u;
  const b = hash(xi, yi + 1, seed) * (1 - u) + hash(xi + 1, yi + 1, seed) * u;
  return a * (1 - v) + b * v;
}

/** Скопировать пиксели в новый холст со сдвигом. */
function copyAt(src: Px, w: number, h: number, ox: number, oy: number): Px {
  const o = new Px(w, h);
  for (let y = 0; y < src.h; y++)
    for (let x = 0; x < src.w; x++) {
      const i = (y * src.w + x) * 4;
      if (!src.data[i + 3]) continue;
      const tx = x + ox;
      const ty = y + oy;
      if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
      const j = (ty * w + tx) * 4;
      o.data[j] = src.data[i];
      o.data[j + 1] = src.data[i + 1];
      o.data[j + 2] = src.data[i + 2];
      o.data[j + 3] = src.data[i + 3];
    }
  return o;
}

/** Смешать цвет пикселя с цветом (для свечения по готовому рисунку). */
function glowPx(p: Px, x: number, y: number, c: RGBA, k: number): void {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || y < 0 || x >= p.w || y >= p.h) return;
  const i = (y * p.w + x) * 4;
  if (!p.data[i + 3]) {
    p.set(x, y, alpha(c, k));
    return;
  }
  p.data[i] = p.data[i] + (c[0] - p.data[i]) * k;
  p.data[i + 1] = p.data[i + 1] + (c[1] - p.data[i + 1]) * k;
  p.data[i + 2] = p.data[i + 2] + (c[2] - p.data[i + 2]) * k;
}

// ---------------------------------------------------------------------------
// Палитра: плоть, мышца, сухожилие, камень, кость, свет вен, призрак.
// ---------------------------------------------------------------------------

const FLESH = tn('#24060b', '#431018', '#65202a', '#8e3a42');
const MUSCLE = tn('#2c070d', '#5a1520', '#8c2632', '#c4505a');
const SINEW = tn('#5a2830', '#8a4650', '#c07880', '#f0b8b8');
const STONE = tn('#1c1715', '#3a312c', '#5e524a', '#8e7f72');
const STONE_HI = hx('#b8a898');
const BONE = tn('#4a3e30', '#8a7a62', '#c4b494', '#efe4c8');
const VEIN_D = hx('#5a0a12');
const VEIN = hx('#b0182a');
const VEIN_HOT = hx('#ff4a3a');
const VEIN_CORE = hx('#ffb08a');
const EMBER = hx('#ff6a2a');
const EMBER_HI = hx('#ffd080');
const GOLD = hx('#ffd040');
const GOLD_HI = hx('#fff4b0');
const WET = hx('#ffb0b0');
const DARK = hx('#0e0305');

// ---------------------------------------------------------------------------
// Ткань. Всё — одна функция мировых пикселей: складки плоти (скатки, как
// у кишки или мозга), капилляры, корни у кокона, веер вен от сердца и два
// ствола вниз по горловине. Клетки не видят друг друга, но картинка
// сшита: каждая точка считается от мира, а не от клетки.
// ---------------------------------------------------------------------------

/** Решётка шума 256×256: быстрее хеша на каждую точку. */
const LAT = (() => {
  const a = new Float32Array(65536);
  for (let i = 0; i < 65536; i++) a[i] = hash(i & 255, i >> 8, 777);
  return a;
})();

/** Сглаженный шум по решётке, 0…1. */
function vn(x: number, y: number, s = 0): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const x0 = (xi + s * 57) & 255;
  const x1 = (x0 + 1) & 255;
  const y0 = ((yi + s * 131) & 255) << 8;
  const y1 = ((yi + 1 + s * 131) & 255) << 8;
  const a = LAT[y0 + x0] + (LAT[y0 + x1] - LAT[y0 + x0]) * u;
  const b = LAT[y1 + x0] + (LAT[y1 + x1] - LAT[y1 + x0]) * u;
  return a + (b - a) * v;
}

/** Порядок Байера 4×4 — ступени тона без полос. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const ramp = (r: RGBA[], f: number, X: number, Y: number): RGBA => {
  const k = Math.max(0, Math.min(r.length - 1.001, f));
  const i = Math.floor(k);
  return k - i > BAYER[(Y & 3) * 4 + (X & 3)] ? r[i + 1] : r[i];
};
const rampOf = (...h: string[]): RGBA[] => h.map((x) => hx(x));

/** Плоть пола: от щели до влажного верха скатки. */
const FR = rampOf('#130408', '#1f070c', '#2e0b12', '#3e1119', '#501822', '#65212b', '#7d2e35', '#984444');
/** Мышца стены — насыщенней и светлей. */
const MR = rampOf('#12030a', '#26060e', '#3e0a16', '#5a1220', '#781c2a', '#982c36', '#ba4646', '#dc7466');
/** Порода за стеной — плоть в темноте. */
const DR = rampOf('#080104', '#0f0207', '#17040b', '#210710', '#2d0b16');
/** Корни кокона — почти чёрные жгуты. */
const RR = rampOf('#0a0205', '#1a050b', '#2e0a12', '#48121c', '#6a2230');
/** Вена: тень, стенка, кровь, свет, блик. */
const VR = rampOf('#1c0206', '#3e0710', '#640c18', '#8c1622', '#b03434', '#d86a5c');
const SPEC = hx('#f0b0a8');
const CAP = hx('#6e0e1a');

/** Высота скатки 0…1 в мировой точке. */
function foldH(X: number, Y: number): number {
  const n = vn(X / 38, Y / 32, 1) * 0.72 + vn(X / 15, Y / 13, 2) * 0.28;
  const t = n * 4.2 + vn(X / 8, Y / 8, 3) * 0.22;
  const b = t - Math.floor(t);
  return Math.pow(Math.sin(b * Math.PI), 0.55);
}

/** Где верх района «Сердце» в мире (он верхний, но не полагаемся). */
let topCache: { w: unknown; top: number } | null = null;
function heartTop(): number {
  const s = paintSim();
  if (!s) return topCache?.top ?? 0;
  if (topCache?.w === s.world) return topCache.top;
  const band = s.world.bands.find((b) => b.def.id === F15_HEART);
  topCache = { w: s.world, top: band?.top ?? 0 };
  return topCache.top;
}

// Геометрия вен — та же, что у генератора карты (`scripts/dungeon/f15_boss.py`):
// сердце K (31, 32), десять вен веером, у каждой своя волна.
const KCX = 31.5;
const KCY = 32.5;
const VEINS = Array.from({ length: 10 }, (_, i) => ({
  ang: -Math.PI / 2 + (i + 0.5) * ((2 * Math.PI) / 10) + 0.12 * Math.sin(i * 2.7),
  wob: 0.35 + 0.1 * (i % 3),
  i,
  // Ветка: где отходит, в какую сторону.
  db: 7.2 + hash(i, 1, 5) * 3.2,
  side: hash(i, 2, 5) < 0.5 ? -1 : 1,
}));
const veinAng = (v: (typeof VEINS)[number], d: number) => v.ang + v.wob * Math.sin(d * 0.55 + v.i) * 0.18;
const angDelta = (a: number, b: number) => {
  let d = a - b;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
};
/** Толщина вены в точках по расстоянию от сердца. */
const veinW = (d: number) => Math.max(2.4, 5.4 - (d - 4) * 0.22);

/** Точка вены номер i на расстоянии d (клетки района). */
export function veinPoint(i: number, d: number, branch = false): [number, number] {
  const v = VEINS[i];
  let a = veinAng(v, d);
  if (branch) a += v.side * (d - v.db) * 0.05;
  return [KCX + Math.cos(a) * d, KCY + Math.sin(a) * d * 0.95];
}
/** Где кончается вена i (как у генератора: до стены или 17). */
const veinEnd = new Map<string, number>();

/** Ствол горловины: смещение от оси по ряду (клетки района). */
function trunkOff(y: number): number {
  const w = 0.3 * Math.sin(y * 0.45);
  if (y < 43) return 1.2 + (43 - y) * 0.62 + w;
  if (y < 47) return 1.2 + w;
  const k = Math.min(1, (y - 47) / 5);
  return 1.2 + 1.3 * k * k * (3 - 2 * k) + w;
}
export const TRUNK = { y0: 40.2, y1: 78 } as const;
export const trunkX = (y: number, side: -1 | 1) => KCX + side * trunkOff(y);

type Tube = { s: number; w: number; nx: number; ny: number; kind: 0 | 1 | 2 };

/**
 * Трубка под точкой: s — поперёк (−1…1), w — толщина, (nx, ny) — нормаль
 * поперёк; kind 0 — вена, 1 — корень, 2 — ствол.
 */
function tubeAt(x: number, y: number): Tube | null {
  const u = x - KCX;
  const v = (y - KCY) / 0.95;
  const d = Math.hypot(u, v);
  let best: Tube | null = null;
  const take = (lat: number, w: number, a: number, kind: 0 | 1 | 2) => {
    const s = (lat * 16) / (w / 2);
    if (Math.abs(s) > 1.35) return;
    if (best && Math.abs(best.s) <= Math.abs(s)) return;
    best = { s, w, nx: -Math.sin(a), ny: Math.cos(a), kind };
  };
  if (d < 4.6 && d > 0.6) {
    // Корни: восемнадцать жгутов, закрученных вокруг кокона.
    const phi = Math.atan2(v, u);
    for (let k = 0; k < 18; k++) {
      const a = (k / 18) * TAU + 0.2 * Math.sin(k * 1.7) + (4.6 - d) * 0.3;
      take(angDelta(phi, a) * d, Math.max(1.8, 4.4 - (d - 1.1) * 0.7), a, 1);
    }
  }
  if (d > 3.7 && d < 17.2 && y < 44.5) {
    const phi = Math.atan2(v, u);
    for (const vv of VEINS) {
      const a = veinAng(vv, d);
      take(angDelta(phi, a) * d, veinW(d), a, 0);
      if (d > vv.db && d < vv.db + 4.6) {
        const ab = a + vv.side * (d - vv.db) * 0.05;
        take(angDelta(phi, ab) * d, Math.max(1.4, veinW(d) * 0.62 * (1 - ((d - vv.db) / 4.6) * 0.8)), ab, 0);
      }
    }
  }
  if (y > TRUNK.y0 && y < TRUNK.y1) {
    for (const side of [-1, 1] as const) {
      const cx = trunkX(y, side);
      take(x - cx, 5, Math.PI / 2, 2);
    }
  }
  return best;
}

/** Свет по трубке: выпуклость и сторона к свету. */
function tubeShade(t: Tube): number {
  const s = Math.max(-1, Math.min(1, t.s));
  const nz = Math.sqrt(Math.max(0, 1 - s * s));
  return nz * 0.7 + s * (t.nx * LX + t.ny * LY) * 0.75;
}

/**
 * Цвет точки пола: `dim` притемняет, `bare` — без вен и корней (под
 * пятнами памяти). Возвращает цвет и тон (для бликов).
 */
function floorPx(X: number, Y: number, dim: number, bare: boolean, top: number): RGBA {
  const h = foldH(X, Y);
  const h2 = foldH(X - 1, Y - 1);
  const lit = Math.max(-1, Math.min(1, (h - h2) * 4));
  const micro = vn(X / 3, Y / 3, 4) - 0.5;
  let f = 1.4 + h * 3.3 + lit * 1.2 + micro * 0.7 - dim;
  // Капилляры — тонкие извилистые нити, пятнами.
  const cn = vn(X / 15, Y / 15, 5);
  const cap = Math.abs(cn - 0.5) < 0.018 && vn(X / 46, Y / 46, 6) > 0.52;
  if (!bare) {
    const t = tubeAt(X / 16, Y / 16 - top);
    if (t) {
      const as = Math.abs(t.s);
      if (as <= 1) {
        const l = tubeShade(t);
        if (t.kind === 1) return ramp(RR, 0.6 + l * 3.4, X, Y);
        return ramp(VR, 0.9 + l * 4.2, X, Y);
      }
      // Кромка: ложбинка вдоль трубки, тень с нижней стороны.
      f -= (1.35 - as) * 5;
    }
  }
  if (cap && f > 2) return mixc(CAP, ramp(FR, f, X, Y), 0.25);
  if (lit > 0.65 && h > 0.8 && LAT[((Y & 255) << 8) | (X & 255)] < 0.035) return SPEC;
  if (LAT[(((Y + 91) & 255) << 8) | ((X + 37) & 255)] < 0.006) return FR[1];
  return ramp(FR, f, X, Y);
}

function fleshCell(c: CellCtx, dim = 0, bare = false): Px {
  const p = new Px(16, 16);
  const ox = c.wx * 16;
  const oy = c.wy * 16;
  const top = heartTop();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, floorPx(ox + x, oy + y, dim, bare, top));
  footShade(p, c);
  return p;
}

/** Тень у подножия стены и по бокам — как у плиток движка. */
function footShade(p: Px, c: CellCtx): void {
  const dark = (a: number): RGBA => [8, 2, 4, Math.round(a * 255)];
  if (!c.open(0, -1))
    for (let x = 0; x < 16; x++) {
      p.set(x, 0, dark(0.62));
      p.set(x, 1, dark(0.45));
      p.set(x, 2, dark(0.28));
      p.set(x, 3, dark(0.12));
    }
  if (!c.open(-1, 0))
    for (let y = 0; y < 16; y++) {
      p.set(0, y, dark(0.4));
      p.set(1, y, dark(0.18));
    }
  if (!c.open(1, 0))
    for (let y = 0; y < 16; y++) {
      p.set(15, y, dark(0.4));
      p.set(14, y, dark(0.18));
    }
}

/** Лужа крови: капли-сгустки от центров соседних лужиц, край неровный. */
function bloodCell(c: CellCtx): Px {
  const p = fleshCell(c);
  const ox = c.wx * 16;
  const oy = c.wy * 16;
  const BL = rampOf('#160206', '#2c040c', '#4a0812', '#72101c', '#a8243a', '#e07878');
  const pools: [number, number, number][] = [];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++)
      if (c.markAt(dx, dy) === MK.blood) {
        const wx = c.wx + dx;
        const wy = c.wy + dy;
        pools.push([(wx + 0.5 + (hash(wx, wy, 1) - 0.5) * 0.3) * 16, (wy + 0.5 + (hash(wx, wy, 2) - 0.5) * 0.3) * 16, 6.2 + hash(wx, wy, 3) * 1.6]);
      }
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const X = ox + x;
      const Y = oy + y;
      let f = 0;
      for (const [cx, cy, r] of pools) f += Math.exp(-((X + 0.5 - cx) ** 2 + ((Y + 0.5 - cy) * 1.25) ** 2) / (r * r));
      f += (vn(X / 3, Y / 3, 8) - 0.5) * 0.35;
      if (f < 0.55) continue;
      // Глубже к середине — темней; сверху-слева — блик по краю.
      const edge = f < 0.66;
      const l = edge ? 1 : 1.6 + vn(X / 6, Y / 6, 9) * 1.2;
      p.set(x, y, ramp(BL, l, X, Y));
    }
  // Блик — пара точек в верхней-левой части пятна.
  const [cx, cy] = pools.length ? pools[0] : [ox + 8, oy + 8];
  const bx = Math.round(cx - ox - 2);
  const by = Math.round(cy - oy - 2);
  if (bx >= 0 && bx < 15 && by >= 0 && by < 16) {
    p.set(bx, by, BL[5]);
    p.set(bx + 1, by, alpha(BL[5], 0.6));
  }
  return p;
}

/** Кость в плоти: ребро или позвонок. */
function boneCell(c: CellCtx): Px {
  const p = fleshCell(c);
  const kind = Math.floor(hash(c.wx, c.wy, 11) * 3);
  if (kind === 0) {
    // Ребро дугой.
    const pts = spline([
      [2, 12],
      [6, 7],
      [11, 5],
      [14, 6],
    ], 5);
    for (let i = 0; i < pts.length - 1; i++) {
      stroke(p, pts[i][0], pts[i][1] + 1, pts[i + 1][0], pts[i + 1][1] + 1, alpha(DARK, 0.7), 2.4);
      stroke(p, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], BONE[2], 2);
      p.set(Math.round(pts[i][0]), Math.round(pts[i][1] - 0.6), BONE[3]);
    }
  } else if (kind === 1) {
    // Позвонок: тело и отростки.
    shadeEll(p, 8, 8, 3, 2.4, BONE);
    limb(p, 8, 8, 3, 5, 1, 0.6, BONE);
    limb(p, 8, 8, 13, 5, 1, 0.6, BONE);
    limb(p, 8, 8, 8, 13, 1, 0.6, BONE);
    p.set(8, 8, BONE[0]);
  } else {
    // Длинная кость с шишками на концах.
    limb(p, 3, 11, 12, 5, 1.1, 1.1, BONE);
    shadeEll(p, 3, 11, 1.8, 1.6, BONE);
    shadeEll(p, 12.5, 4.6, 1.8, 1.6, BONE);
  }
  return p;
}

/** Знак памяти: круг 3×3 клетки, резьба с тусклым светом своей стихии. */
const SIGIL_TINT: Record<number, RGBA> = {
  [MK.sigLava]: hx('#ff7a2a'),
  [MK.sigAbyss]: hx('#40d8d0'),
  [MK.sigMirror]: hx('#c8e0ff'),
  [MK.sigHydra]: hx('#70f070'),
};

function sigilCell(c: CellCtx): Px {
  const p = fleshCell(c, 0.3, true);
  const m = c.mark;
  // Где клетка в блоке 3×3: по соседям с той же меткой.
  const sx = c.markAt(-1, 0) === m ? (c.markAt(1, 0) === m ? 0 : 1) : -1;
  const sy = c.markAt(0, -1) === m ? (c.markAt(0, 1) === m ? 0 : 1) : -1;
  const tint = SIGIL_TINT[m] ?? VEIN_HOT;
  const groove = mixc(DARK, FLESH[0], 0.3);
  const lit = alpha(tint, 0.85);
  const cxg = 24 - (sx + 1) * 16;
  const cyg = 24 - (sy + 1) * 16;
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const gx = x + 0.5 - cxg - 8;
      const gy = y + 0.5 - cyg - 8;
      const r = Math.hypot(gx, gy);
      const a = Math.atan2(gy, gx);
      let on = false;
      if (Math.abs(r - 21) < 1 || Math.abs(r - 16.5) < 0.8) on = true;
      // Засечки между кругами.
      if (r > 16.5 && r < 21 && Math.abs(((a / TAU) * 16 + 16) % 1 - 0.5) < 0.09) on = true;
      // Знак внутри.
      const u = gx / 12;
      const v = gy / 12;
      if (m === MK.sigLava) {
        // Язык пламени.
        const hw = 0.55 * (1 - (v + 1) / 2.1) ** 0.8 * (1 + 0.25 * Math.sin(v * 6));
        if (v > -1 && v < 0.95 && Math.abs(u + Math.sin(v * 3) * 0.12) < hw && Math.abs(Math.abs(u) - hw) < 0.16) on = true;
      } else if (m === MK.sigAbyss) {
        // Спираль-омут.
        const rr = Math.hypot(u, v);
        const aa = Math.atan2(v, u);
        if (rr < 1 && Math.abs(((rr * 3.2 - aa / TAU + 10) % 1) - 0.5) < 0.1) on = true;
      } else if (m === MK.sigMirror) {
        // Ромб с трещиной.
        if (Math.abs(Math.abs(u) + Math.abs(v) - 0.8) < 0.1) on = true;
        if (Math.abs(u - v * 0.3) < 0.07 && Math.abs(v) < 0.8) on = true;
      } else if (m === MK.sigHydra) {
        // Три сплетённых круга.
        for (let k = 0; k < 3; k++) {
          const ka = (k / 3) * TAU - Math.PI / 2;
          const d = Math.hypot(u - Math.cos(ka) * 0.35, v - Math.sin(ka) * 0.35);
          if (Math.abs(d - 0.42) < 0.08) on = true;
        }
      }
      if (!on) continue;
      p.set(x, y, groove);
      p.set(x, y + 1, alpha(lit, 0.35));
      glowPx(p, x, y, tint, 0.45);
    }
  return p;
}

// --- Клетки памяти (ставит сценарий на ходу). Пятно лежит по клеткам, но
// край у него живой: граница с соседом «не своего» вида гуляет внутрь
// клетки шумом мира (±3 точки), углы скругляются. Наружу пятно не
// выходит — клетку соседа рисует сосед, и после отката арены не остаётся
// чужих краёв.

/** Сколько точек от (x, y) до ближайшей клетки-соседа не из пятна (99 — нет). */
function regionS(c: CellCtx, x: number, y: number, member: (m: number) => boolean): number {
  let s = 99;
  const px = x + 0.5;
  const py = y + 0.5;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      if (member(c.markAt(dx, dy))) continue;
      const ex = dx < 0 ? px : dx > 0 ? 16 - px : 0;
      const ey = dy < 0 ? py : dy > 0 ? 16 - py : 0;
      s = Math.min(s, dx && dy ? Math.hypot(ex, ey) : dx ? ex : ey);
    }
  return s;
}
const wob = (X: number, Y: number, seed: number, amp = 6) => (vn(X / 5, Y / 5, seed) - 0.5) * amp;

const LAVA_R = rampOf('#5a0e04', '#a02606', '#d8480a', '#ff7a14', '#ffb030', '#ffe070', '#fff6c0');
const CRUST_R = rampOf('#0e0a0a', '#1c1614', '#2c2420', '#40342c', '#564636');
const isLava = (m: number) => m === MK.lava;
const isHot = (m: number) => m === MK.lava || m === MK.crust;

/** Корка в точке: тёмный камень, по трещинам — жар. */
function crustPx(X: number, Y: number, heat: number): RGBA {
  const n = vn(X / 3.5, Y / 3.5, 31);
  const crack = Math.abs(n - 0.5) < 0.05 + heat * 0.03;
  if (crack) return heat > 0.5 ? LAVA_R[4] : LAVA_R[3];
  return ramp(CRUST_R, 0.6 + vn(X / 6, Y / 6, 36) * 3.2, X, Y);
}

function lavaCell(c: CellCtx): Px {
  const p = new Px(16, 16);
  const ox = c.wx * 16;
  const oy = c.wy * 16;
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const X = ox + x;
      const Y = oy + y;
      const s = regionS(c, x, y, isLava) + wob(X, Y, 71);
      if (s < 2.5) {
        p.set(x, y, crustPx(X, Y, 1));
        continue;
      }
      // Раскалённая кромка, дальше — жидкий огонь с жилами течения.
      const flow = vn(X / 9 + vn(X / 20, Y / 20, 23) * 2, Y / 5, 21) * 0.6 + vn(X / 3, Y / 3, 22) * 0.4;
      let f = 1.4 + flow * 3.6;
      if (s < 4) f += 1.6;
      if (Math.abs(vn(X / 7, Y / 11, 24) - 0.5) < 0.03) f += 1.5;
      p.set(x, y, ramp(LAVA_R, f, X, Y));
    }
  return p;
}

function crustCell(c: CellCtx): Px {
  const p = fleshCell(c, 0.6, true);
  const ox = c.wx * 16;
  const oy = c.wy * 16;
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const X = ox + x;
      const Y = oy + y;
      const s = regionS(c, x, y, isHot) + wob(X, Y, 72);
      if (s < 1.5) continue;
      // Ближе к лаве — горячей.
      const toLava = regionS(c, x, y, (m) => !isLava(m));
      const heat = toLava < 99 ? Math.max(0, 1 - toLava / 10) : 0;
      if (s < 3) {
        // Обгорелая плоть по краю.
        glowPx(p, x, y, hx('#1a0c0a'), 0.7);
        if (LAT[((Y & 255) << 8) | (X & 255)] < 0.06) p.set(x, y, EMBER);
        continue;
      }
      p.set(x, y, crustPx(X, Y, heat));
    }
  return p;
}

const ABYSS_R = rampOf('#010507', '#03121a', '#072430', '#0c3a48', '#16586a');

function abyssCell(c: CellCtx): Px {
  const p = new Px(16, 16);
  const ox = c.wx * 16;
  const oy = c.wy * 16;
  const isAb = (m: number) => m === MK.abyss;
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const X = ox + x;
      const Y = oy + y;
      const s = regionS(c, x, y, isAb) + wob(X, Y, 73, 5);
      if (s < 1.2) {
        p.set(x, y, hx('#1e4a52'));
        continue;
      }
      if (s < 2.4) {
        // Пена у края.
        p.set(x, y, LAT[((Y & 255) << 8) | (X & 255)] < 0.55 ? hx('#8ad8dc') : hx('#3a8a94'));
        continue;
      }
      // Глубина: к середине темнее, мягкие волны, искры.
      const depth = Math.min(1, (s - 2.4) / 12);
      const wave = Math.sin(X * 0.18 + vn(X / 12, Y / 12, 41) * 5 + Y * 0.07);
      let f = 2.6 - depth * 2 + wave * 0.35 + (vn(X / 6, Y / 6, 42) - 0.5) * 0.8;
      if (wave > 0.93) f += 1;
      p.set(x, y, ramp(ABYSS_R, f, X, Y));
      if (LAT[(((Y * 3) & 255) << 8) | ((X * 5) & 255)] < 0.008) p.set(x, y, hx('#8af4f8'));
    }
  return p;
}

function shallowCell(c: CellCtx): Px {
  const p = fleshCell(c, 0.4, true);
  const ox = c.wx * 16;
  const oy = c.wy * 16;
  const isWet = (m: number) => m === MK.shallow || m === MK.abyss;
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const X = ox + x;
      const Y = oy + y;
      const s = regionS(c, x, y, isWet) + wob(X, Y, 74);
      if (s < 1.5) continue;
      // Вода над плотью: чем дальше от края, тем гуще.
      const k = Math.min(0.72, 0.3 + (s - 1.5) * 0.06);
      glowPx(p, x, y, hx('#0a3440'), k);
      const r = Math.sin(X * 0.35 + Y * 0.8 + vn(X / 4, Y / 4, 44) * 3);
      if (r > 0.92) p.set(x, y, hx('#6ac0c8', 190));
      else if (s < 2.6) p.set(x, y, hx('#4a9aa4', 170));
    }
  return p;
}

function bogCell(c: CellCtx): Px {
  const p = fleshCell(c, 0.4, true);
  const ox = c.wx * 16;
  const oy = c.wy * 16;
  const BG = rampOf('#0a1206', '#14200a', '#223410', '#344c18', '#4c6a22', '#6e8e30');
  const isBog = (m: number) => m === MK.bog;
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const X = ox + x;
      const Y = oy + y;
      const s = regionS(c, x, y, isBog) + wob(X, Y, 75);
      if (s < 1.5) continue;
      const n = vn(X / 4, Y / 4, 51);
      p.set(x, y, ramp(BG, 0.8 + n * 3.2 + (s < 3 ? -0.8 : 0), X, Y));
      // Пузыри яда.
      if (LAT[(((Y + 13) & 255) << 8) | ((X * 7) & 255)] < 0.02) {
        p.set(x, y, hx('#b8e860'));
        if (x < 15) p.set(x + 1, y, hx('#6a8a20'));
      }
    }
  return p;
}

function mirrorFloorCell(c: CellCtx): Px {
  const p = fleshCell(c, 0.6);
  const ox = c.wx * 16;
  const oy = c.wy * 16;
  // Осколки стекла, отражающие свет: светлые клинья.
  for (let k = 0; k < 3; k++) {
    const x = 2 + hash(ox, oy, 60 + k) * 11;
    const y = 2 + hash(ox, oy, 70 + k) * 11;
    const a = hash(ox, oy, 80 + k) * TAU;
    poly(p, [
      [x, y],
      [x + Math.cos(a) * 3.5, y + Math.sin(a) * 3.5],
      [x + Math.cos(a + 1.9) * 2, y + Math.sin(a + 1.9) * 2],
    ], (px, py) => ((px + py) % 3 === 0 ? hx('#f4f8ff') : hx('#8aa0c0')));
  }
  return p;
}

/**
 * Зеркало-столб (стена): куст стеклянных осколков из плоти. Грань к свету —
 * светлая, в тени — синяя; снизу в стекле отражается красный пол.
 */
const GLASS = rampOf('#10182a', '#1e2c46', '#34476a', '#5a7298', '#94aed0', '#d4e2f4', '#ffffff');
function mirrorCell(c: CellCtx): Px {
  const p = fleshCell(c, 0.9, true);
  const ox = c.wx * 16;
  const oy = c.wy * 16;
  const flip = hash(c.wx, c.wy, 5) < 0.5;
  const shards: [number, number][][] = [
    [[1.5, 15.5], [3, 6], [6.5, 9], [6.5, 15.5]],
    [[10, 15.5], [12.5, 4.5], [14.8, 8], [14.5, 15.5]],
    [[4.5, 15.5], [7.5, 0.5], [11, 3], [11.5, 15.5]],
  ];
  for (const sh of shards) {
    const pts = sh.map(([x, y]) => [flip ? 16 - x : x, y] as [number, number]);
    const [bx] = pts[0];
    const tipX = pts[1][0];
    poly(p, pts, (x, y) => {
      // Ребро осколка: слева от ребра — на свету.
      const ridge = tipX + ((bx + pts[3][0]) / 2 - tipX) * ((y - pts[1][1]) / (15.5 - pts[1][1]));
      const lit = x < ridge;
      let f = lit ? 3.6 : 1.8;
      f += (15 - y) * 0.06;
      // Косой блик.
      const band = (x + y * 0.6 + (flip ? 3 : 0)) % 9;
      if (lit && band < 1.2) f += 2.2;
      let col = ramp(GLASS, f, ox + x, oy + y);
      // Внизу — отражение красного пола.
      if (y > 10) col = mixc(col, hx('#7a2030'), (y - 10) * 0.09);
      return col;
    });
  }
  // Контур осколков.
  const q = new Px(16, 16);
  for (let i = 0; i < p.data.length; i++) q.data[i] = p.data[i];
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const i = (y * 16 + x) * 4;
      const isGlass = (xx: number, yy: number) => {
        if (xx < 0 || yy < 0 || xx > 15 || yy > 15) return false;
        const j = (yy * 16 + xx) * 4;
        return q.data[j + 2] > q.data[j] + 12;
      };
      if (isGlass(x, y)) continue;
      if (isGlass(x + 1, y) || isGlass(x - 1, y) || isGlass(x, y + 1) || isGlass(x, y - 1)) {
        p.data[i] = 8;
        p.data[i + 1] = 10;
        p.data[i + 2] = 22;
        p.data[i + 3] = 255;
      }
    }
  return p;
}

function circleCell(c: CellCtx): Px {
  const p = fleshCell(c, 0.6, true);
  const col = c.mark === MK.circleA ? hx('#70f090') : hx('#c080ff');
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const r = Math.hypot(x + 0.5 - 8, y + 0.5 - 8);
      const a = Math.atan2(y + 0.5 - 8, x + 0.5 - 8);
      if (Math.abs(r - 6.6) < 0.8) p.set(x, y, col);
      else if (Math.abs(r - 4.4) < 0.5 && Math.abs(((a / TAU) * 6 + 6) % 1 - 0.5) < 0.25) p.set(x, y, alpha(col, 0.8));
      else if (r < 3.2) glowPx(p, x, y, col, 0.35 * (1 - r / 3.2));
    }
  return p;
}

function scorchCell(c: CellCtx): Px {
  const p = fleshCell(c, 0.8, true);
  const ox = c.wx * 16;
  const oy = c.wy * 16;
  const CH = hx('#1a0c0a');
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) glowPx(p, x, y, CH, 0.55 + vn((ox + x) / 5, (oy + y) / 5, 13) * 0.3);
  for (let k = 0; k < 4; k++)
    if (hash(ox, oy, 100 + k) < 0.5) p.set(Math.floor(hash(ox, oy, 110 + k) * 16), Math.floor(hash(ox, oy, 120 + k) * 16), EMBER);
  return p;
}

// --- Стены.

/** Мышечный пучок лица стены: высота 0…1 в мировой точке. */
function bundleH(X: number, Y: number): number {
  const u = X / 6.5 + Math.sin(Y / 10 + X * 0.05) * 0.45 + vn(X / 20, Y / 30, 11) * 0.8;
  return Math.pow(Math.sin((u - Math.floor(u)) * Math.PI), 0.6);
}

/**
 * Стена плоти. Лицо (над полом) — пучки мышц сверху вниз со свесом-губой
 * по верху и тенью к полу; порода за лицом — плоть во тьме с жилами;
 * кромки у пола — светлый валик.
 */
function wallCell(c: CellCtx): Px {
  const p = new Px(16, 16);
  const ox = c.wx * 16;
  const oy = c.wy * 16;
  const face = c.open(0, 1);
  if (face) {
    const LIP = [2.6, 1.9, 0.6, -1.2, -0.5];
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const X = ox + x;
        const Y = oy + y;
        const h = bundleH(X, Y);
        const lit = Math.max(-1, Math.min(1, (h - bundleH(X - 1, Y)) * 3));
        let f = 1.3 + h * 3 + lit * 1.3 + (vn(X / 2.2, Y / 8, 12) - 0.5) * 1.3;
        if (y < LIP.length) f += LIP[y];
        f -= Math.max(0, y - 8) * 0.42;
        p.set(x, y, ramp(MR, f, X, Y));
        // Влажный блик на верху пучка.
        if (y > 4 && y < 9 && h > 0.9 && lit > 0.2 && LAT[((Y & 255) << 8) | (X & 255)] < 0.12) p.set(x, y, SPEC);
      }
    // Сухожильные тяжи — светлые нити по пучку.
    for (let k = 0; k < 2; k++) {
      if (hash(c.wx, c.wy, 130 + k) < 0.45) continue;
      const x0 = 2 + hash(c.wx, c.wy, 131 + k) * 12;
      for (let y = 5; y < 13; y++) p.set(Math.round(x0 + Math.sin(y * 0.55 + k) * 0.7), y, alpha(SINEW[2], 0.55));
    }
    for (let x = 0; x < 16; x++) {
      p.set(x, 14, mixc(MR[1], DARK, 0.4));
      p.set(x, 15, DARK);
    }
    return p;
  }
  // Порода: тёмная плоть, крупные сосуды в глубине.
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const X = ox + x;
      const Y = oy + y;
      const h = foldH(X * 0.7, Y * 0.7);
      let f = 0.6 + h * 2.2 + (vn(X / 4, Y / 4, 14) - 0.5) * 0.8;
      const vv = vn(X / 26, Y / 26, 15);
      if (Math.abs(vv - 0.5) < 0.03) f += 1.4;
      p.set(x, y, ramp(DR, f, X, Y));
    }
  // Кромки у пола: сверху — валик на свету, по бокам — тонкий кант.
  if (c.open(0, -1))
    for (let x = 0; x < 16; x++) {
      const X = ox + x;
      p.set(x, 0, ramp(MR, 5.2, X, oy));
      p.set(x, 1, ramp(MR, 4.2, X, oy + 1));
      p.set(x, 2, ramp(MR, 2.6, X, oy + 2));
      p.set(x, 3, ramp(MR, 1.2, X, oy + 3));
    }
  if (c.open(-1, 0)) for (let y = 0; y < 16; y++) {
    p.set(0, y, ramp(MR, 3.6, ox, oy + y));
    p.set(1, y, ramp(MR, 1.8, ox + 1, oy + y));
  }
  if (c.open(1, 0)) for (let y = 0; y < 16; y++) {
    p.set(15, y, ramp(MR, 2.4, ox + 15, oy + y));
    p.set(14, y, ramp(MR, 1.2, ox + 14, oy + y));
  }
  return p;
}

function wallVeinCell(c: CellCtx): Px {
  const p = wallCell(c);
  if (!c.open(0, 1)) return p;
  // Толстая вена поперёк лица, вспухшая, с горячей серединой.
  const y0 = 6 + Math.floor(hash(c.wx, c.wy, 140) * 4);
  const pts = spline([
    [-1, y0 + 2],
    [5, y0 - 1],
    [11, y0 + 1.5],
    [17, y0 - 0.5],
  ], 5);
  for (let i = 0; i < pts.length - 1; i++) {
    stroke(p, pts[i][0], pts[i][1] + 1, pts[i + 1][0], pts[i + 1][1] + 1, VEIN_D, 3.4);
    stroke(p, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], VEIN, 2.6);
    stroke(p, pts[i][0], pts[i][1] - 0.6, pts[i + 1][0], pts[i + 1][1] - 0.6, VEIN_HOT, 1);
  }
  return p;
}

function wallRibCell(c: CellCtx): Px {
  const p = wallCell(c);
  if (!c.open(0, 1)) return p;
  // Два ребра выходят из мышцы наружу.
  for (const y of [5, 10]) {
    limb(p, -1, y + 1, 16, y - 1, 1.3, 1.1, BONE);
    for (let x = 0; x < 16; x++) if (p.solid(x, y + 2)) p.set(x, y + 2, alpha(DARK, 0.5));
  }
  return p;
}

/** Вспухшая стена (сжатие в фазе «СЕРДЦЕ»): бугры мышц, жилы. */
function swellCell(c: CellCtx): Px {
  const p = new Px(16, 16);
  const ox = c.wx * 16;
  const oy = c.wy * 16;
  const face = c.open(0, 1);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const n = vnoise((ox + x) / 4, (oy + y) / 4, 81);
      const bulge = Math.sin((ox + x) * 0.5) * Math.sin((oy + y) * 0.5);
      p.set(x, y, tone(MUSCLE, 0.3 + n * 0.4 + bulge * 0.25 - (face ? y * 0.02 : 0.1)));
    }
  for (let k = 0; k < 2; k++) {
    const x0 = hash(c.wx, c.wy, 150 + k) * 16;
    stroke(p, x0, 0, x0 + (hash(c.wx, c.wy, 160 + k) - 0.5) * 8, 16, VEIN, 1.4);
  }
  if (face) for (let x = 0; x < 16; x++) p.set(x, 15, DARK);
  return p;
}

registerCellPainter(F15_HEART, (c) => {
  const m = c.mark;
  const T = c.tile;
  // Глубина и опасное — по метке.
  if (m === MK.lava) return lavaCell(c);
  if (m === MK.abyss) return abyssCell(c);
  if (m === MK.crust) return crustCell(c);
  if (m === MK.shallow) return shallowCell(c);
  if (m === MK.bog) return bogCell(c);
  if (m === MK.mirror) return mirrorCell(c);
  if (m === MK.mirrorFloor) return mirrorFloorCell(c);
  if (m === MK.circleA || m === MK.circleB) return circleCell(c);
  if (m === MK.swell) return swellCell(c);
  if (m === MK.scorch) return scorchCell(c);
  // Стены (и порода без метки) — плоть.
  const wall = T === 1 || T === 6 || T === 9 || T === 0;
  if (wall) {
    if (m === MK.wallVein) return wallVeinCell(c);
    if (m === MK.wallRib) return wallRibCell(c);
    return wallCell(c);
  }
  if (T === 11) return abyssCell(c);
  switch (m) {
    case MK.blood:
      return bloodCell(c);
    case MK.bone:
      return boneCell(c);
    case MK.sigLava:
    case MK.sigAbyss:
    case MK.sigMirror:
    case MK.sigHydra:
      return sigilCell(c);
    default:
      return fleshCell(c);
  }
});

// ---------------------------------------------------------------------------
// Реквизит. Живое (кокон, пузыри, капель, пар, узлы, полипы, глаза,
// блики реликвий) перещёлкивает кадры по времени; кадр собирается один раз.
// ---------------------------------------------------------------------------

const props = new Map<string, Sprite>();

function sprite(key: string, make: () => { p: Px; ax: number; ay: number } | null): Sprite | null {
  const hit = props.get(key);
  if (hit) return hit;
  const m = make();
  if (!m) return null;
  const s: Sprite = { img: m.p.canvas(), ax: m.ax, ay: m.ay };
  props.set(key, s);
  return s;
}

/** Номер кадра по времени: `fps` в секунду, `n` кадров, сдвиг по месту. */
const frameAt = (time: number, fps: number, n: number, o = 0) => ((Math.floor(time * fps + o) % n) + n) % n;

/** Ребро-арка: кость из пола, изгибается внутрь камеры. */
registerPropPainter('f15b_rib', (o) =>
  sprite(`rib|${o.x < 32 ? 1 : 0}`, () => {
    const p = new Px(24, 44);
    const flip = o.x < 32;
    const pts = spline([
      [12, 42],
      [11, 30],
      [13, 16],
      [18, 7],
      [21, 4],
    ], 6);
    for (let i = 0; i < pts.length - 1; i++) {
      const k = i / pts.length;
      const r = 2.6 - k * 1.6;
      limb(p, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], r, r - 0.1, BONE, 0.05);
    }
    // Хрящ у основания и жилы, приросшие к кости.
    shadeEll(p, 12, 41, 4, 2.2, SINEW);
    stroke(p, 10, 40, 11, 31, alpha(MUSCLE[2], 0.8), 1);
    stroke(p, 14, 40, 13, 27, alpha(VEIN, 0.8), 1);
    p.outline(INK);
    return { p: flip ? p.flipX() : p, ax: 12, ay: 43 };
  }),
);

/** Сухожилие-столб: жгут от пола к своду, натянут, дышит. */
registerPropPainter('f15b_tendon', (o, time) => {
  const f = frameAt(time + o.x * 0.13, 1.8, 4);
  return sprite(`tendon|${f}`, () => {
    const p = new Px(20, 48);
    const w = [0, 0.6, 1, 0.6][f];
    for (let y = 0; y < 44; y++) {
      const k = y / 44;
      const r = 3.2 + Math.abs(k - 0.5) * 4 + w * (1 - Math.abs(k - 0.5) * 2) * 0.8;
      for (let x = -Math.ceil(r); x <= Math.ceil(r); x++) {
        if (Math.abs(x) > r) continue;
        const nx = x / r;
        const fib = Math.sin(x * 1.9 + y * 0.18) * 0.12;
        p.set(10 + x, y + 2, tone(SINEW, 0.55 - nx * 0.5 + fib - (k > 0.9 ? 0.2 : 0)));
      }
    }
    // Жила вдоль.
    for (let y = 4; y < 44; y++) p.set(10 + Math.round(Math.sin(y * 0.25) * 1.5) + 1, y, VEIN);
    p.outline(INK);
    return { p, ax: 10, ay: 47 };
  });
});

/** Пузырь-нарыв: плёнка, внутри светится жижа (бьётся — в нём ихор). */
registerPropPainter('f15b_pustule', (o, time, _alive, flash) => {
  const f = frameAt(time + o.x * 0.37 + o.y * 0.11, 2.2, 4);
  return sprite(`pus|${f}|${flash ? 1 : 0}`, () => {
    let p = new Px(18, 18);
    const s = [0, 0.4, 0.8, 0.4][f];
    const cx = 9;
    const cy = 10 - s * 0.5;
    const rx = 5.5 + s * 0.4;
    const ry = 5 + s * 0.6;
    shadeEll(p, cx, cy + 1, rx + 1, ry * 0.6, FLESH);
    p.ell(cx, cy, rx, ry, (x, y) => {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      const l = 0.5 - dx * 0.3 - dy * 0.35;
      return mixc(hx('#7a1a14'), hx('#ff9a5a'), Math.max(0, Math.min(1, l + 0.1)));
    });
    // Жилки по плёнке и блик.
    stroke(p, cx - 3, cy + 3, cx - 1, cy - 3, alpha(VEIN_D, 0.8), 1);
    stroke(p, cx + 2, cy + 3, cx + 3, cy - 2, alpha(VEIN_D, 0.8), 1);
    p.set(cx - 2, cy - 3, WHITE);
    p.set(cx - 3, cy - 2, alpha(WHITE, 0.7));
    p.outline(INK);
    if (flash) p = p.tint(WHITE, 0.8);
    return { p, ax: 9, ay: 17 };
  });
});

/** Капель: со свода падает капля крови, в лужице — круги. */
registerPropPainter('f15b_drip', (o, time) => {
  const f = frameAt(time + o.x * 0.29, 8, 16);
  return sprite(`drip|${f}`, () => {
    const p = new Px(16, 40);
    const BL = tn('#2a040a', '#5a0a14', '#8a1624', '#d0404a');
    // Лужица.
    p.ell(8, 36, 5.5, 2.2, BL[1]);
    p.ell(7, 35.6, 3, 1, BL[2]);
    // Капля падает кадры 0…7, потом круги.
    if (f < 8) {
      const y = 4 + (f / 8) ** 2 * 30;
      p.set(8, Math.round(y), BL[3]);
      p.set(8, Math.round(y) + 1, BL[2]);
      p.set(8, Math.round(y) - 1, alpha(BL[2], 0.6));
    } else {
      const r = (f - 8) * 0.9 + 1;
      for (let a = 0; a < TAU; a += 0.35) p.set(Math.round(8 + Math.cos(a) * r), Math.round(36 + Math.sin(a) * r * 0.4), alpha(BL[3], 1 - (f - 8) / 8));
    }
    return { p, ax: 8, ay: 38 };
  });
});

/** Жерло пара: складка плоти выдыхает горячий пар. */
registerPropPainter('f15b_vent', (o, time) => {
  const f = frameAt(time + o.x * 0.21, 6, 12);
  return sprite(`vent|${f}`, () => {
    const p = new Px(20, 34);
    shadeEll(p, 10, 29, 6, 3, MUSCLE);
    p.ell(10, 28.6, 3, 1.3, DARK);
    p.ell(10, 28.4, 1.6, 0.6, EMBER);
    // Клубы пара вверх.
    for (let k = 0; k < 4; k++) {
      const t = ((f + k * 3) % 12) / 12;
      const y = 27 - t * 24;
      const r = 1.5 + t * 3.2;
      const x = 10 + Math.sin(t * 5 + k) * 2;
      p.ell(x, y, r, r * 0.8, alpha(mixc(hx('#ffb080'), hx('#8a5a5a'), t), 0.55 * (1 - t)));
    }
    return { p, ax: 10, ay: 31 };
  });
});

/** Зубы из пола: частокол клыков. */
registerPropPainter('f15b_teeth', (o) =>
  sprite(`teeth|${(o.x + o.y) % 2}`, () => {
    const p = new Px(22, 22);
    shadeEll(p, 11, 18, 8, 3, MUSCLE);
    const n = 5;
    for (let i = 0; i < n; i++) {
      const x = 4 + i * 3.5;
      const h = 8 + ((i * 7 + o.x) % 5);
      const lean = (i - 2) * 0.6;
      poly(p, [
        [x - 1.6, 18],
        [x + 1.6, 18],
        [x + lean + 0.3, 18 - h],
      ], (px) => tone(BONE, px < x + lean * 0.5 ? 0.9 : 0.4));
    }
    p.outline(INK);
    return { p, ax: 11, ay: 20 };
  }),
);

/** Кости: груда старых костей (череп, рёбра). */
registerPropPainter('f15b_bones', () =>
  sprite('bones', () => {
    const p = new Px(22, 16);
    limb(p, 3, 12, 17, 9, 1.1, 1.1, BONE);
    shadeEll(p, 3, 12, 1.6, 1.5, BONE);
    shadeEll(p, 17.5, 8.6, 1.6, 1.5, BONE);
    limb(p, 6, 8, 14, 13, 1, 1, BONE, -0.1);
    // Череп.
    shadeEll(p, 11, 8, 4, 3.4, BONE);
    p.rect(9, 8, 9, 9, INK);
    p.rect(12, 8, 12, 9, INK);
    p.set(10, 11, INK);
    p.outline(INK);
    return { p, ax: 11, ay: 14 };
  }),
);

/** Нервный узел на вене: пульсирует светом (плоский — под героем). */
registerPropPainter('f15b_node', (o, time) => {
  const s = paintSim();
  const v = f15bView(s);
  const k = v && s ? beatK(v, s.time) : ((time * 0.8 + o.x * 0.1) % 1);
  const f = k < 0.15 ? 0 : k < 0.35 ? 1 : k < 0.6 ? 2 : 3;
  return sprite(`node|${f}`, () => {
    const p = new Px(16, 12);
    const r = [3.6, 3.2, 2.8, 2.6][f];
    shadeEll(p, 8, 6, r + 1, r * 0.7 + 0.6, tn('#3a0810', '#6a1420', '#a02030', '#e04050'));
    p.ell(8, 5.6, r * 0.6, r * 0.4, [VEIN_CORE, VEIN_HOT, VEIN, VEIN][f]);
    // Отростки-дендриты.
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + 0.4;
      stroke(p, 8 + Math.cos(a) * r, 6 + Math.sin(a) * r * 0.6, 8 + Math.cos(a) * (r + 3), 6 + Math.sin(a) * (r + 3) * 0.6, alpha(VEIN, 0.9), 1);
    }
    return { p, ax: 8, ay: 10 };
  });
});

/** Полип-светильник на стене: светящийся мешок, дышит. */
registerPropPainter('f15b_polyp', (o, time) => {
  const s = paintSim();
  const v = f15bView(s);
  const k = v && s ? beatK(v, s.time) : ((time * 0.7 + o.x * 0.17) % 1);
  const f = k < 0.2 ? 0 : k < 0.5 ? 1 : 2;
  return sprite(`polyp|${f}`, () => {
    const p = new Px(16, 22);
    const sw = [1, 0.5, 0][f];
    // Ножка из стены.
    limb(p, 8, 4, 8, 10, 1.6, 2.2, MUSCLE);
    // Мешок светится изнутри.
    const cy = 13;
    p.ell(8, cy, 4.2 + sw * 0.5, 4.6 + sw * 0.6, (x, y) => {
      const dx = (x + 0.5 - 8) / 4.5;
      const dy = (y + 0.5 - cy) / 5;
      const l = 1 - Math.hypot(dx + 0.25, dy + 0.3);
      return mixc(hx('#8a1a1a'), hx('#ffc890'), Math.max(0, Math.min(1, l * (1 + sw * 0.4))));
    });
    p.set(6, cy - 3, WHITE);
    // Отростки-щупальца снизу.
    for (let i = 0; i < 3; i++) stroke(p, 6 + i * 2, cy + 4, 5.5 + i * 2.5, cy + 7 + (i % 2), alpha(MUSCLE[2], 0.9), 1);
    p.outline(INK);
    return { p, ax: 8, ay: 16 };
  });
});

/** Глаз в стене: веки, радужка следит за героем, моргает. */
registerPropPainter('f15b_eye', (o, time) => {
  const s = paintSim();
  let look = 0;
  let lookY = 0;
  if (s) {
    const dx = s.hero.x - (o.x + 0.5);
    const dy = s.hero.y - (o.y + 0.5);
    look = Math.max(-1, Math.min(1, Math.round(dx / 3)));
    lookY = dy > 2 ? 1 : 0;
  }
  const t = (time + o.x * 1.7) % 5.3;
  const blink = t < 0.12 ? 1 : t < 0.2 ? 2 : 0;
  return sprite(`eye|${look}|${lookY}|${blink}`, () => {
    const p = new Px(16, 16);
    // Складки век вокруг.
    shadeEll(p, 8, 8, 7, 5.2, MUSCLE, 0.1);
    if (blink === 2) {
      p.rect(2, 8, 13, 8, INK);
      p.rect(3, 7, 12, 7, MUSCLE[2]);
    } else {
      const open = blink ? 1.4 : 3.2;
      p.ell(8, 8, 5, open, hx('#e8d8c8'));
      // Жилки на белке.
      p.set(4, 8, VEIN);
      p.set(12, 7, VEIN);
      if (!blink) {
        const ix = 8 + look * 2;
        const iy = 8 + lookY;
        p.ell(ix, iy, 2.4, 2.4, GOLD);
        p.ell(ix, iy, 1.2, 2, INK);
        p.set(ix - 1, iy - 1, WHITE);
      }
      // Верхнее веко тенью.
      for (let x = 3; x <= 13; x++) p.set(x, Math.round(8 - open), MUSCLE[0]);
    }
    return { p, ax: 8, ay: 16 };
  });
});

/** Губы клапана у ворот: складки мышцы по бокам. */
registerPropPainter('f15b_lip', (o) =>
  sprite(`lip|${o.x < 32 ? 1 : 0}`, () => {
    const p = new Px(16, 24);
    for (let i = 0; i < 4; i++) limb(p, 4 + i * 2.5, 22, 9 + i * 1.5, 3 + i * 3, 2.6 - i * 0.3, 1.4, MUSCLE, -i * 0.08);
    stroke(p, 6, 20, 11, 5, alpha(VEIN, 0.9), 1);
    p.outline(INK);
    return { p: o.x < 32 ? p : p.flipX(), ax: 8, ay: 24 };
  }),
);

// --- Реликвии: ниша в плоти и вещь павшего босса.

function niche(p: Px, glow: RGBA): void {
  // Арка ниши: тёмное нутро, кант из кости, свет изнутри снизу.
  for (let y = 4; y < 22; y++)
    for (let x = 2; x < 14; x++) {
      const top = y < 9 ? Math.hypot(x + 0.5 - 8, y + 0.5 - 9) > 6 : false;
      if (top) continue;
      const k = (y - 4) / 18;
      p.set(x, y, mixc(DARK, glow, 0.08 + k * 0.28));
    }
  for (let a = Math.PI; a <= TAU + 0.01; a += 0.12) p.set(Math.round(8 + Math.cos(a) * 6.4), Math.round(9 + Math.sin(a) * 6.4), BONE[2]);
  for (let y = 9; y < 22; y++) {
    p.set(1, y, BONE[1]);
    p.set(14, y, BONE[0]);
  }
  for (let x = 1; x < 15; x++) p.set(x, 22, BONE[1]);
}

function relic(key: string, glowHex: string, draw: (p: Px, f: number) => void) {
  return (o: { x: number }, time: number) => {
    const f = frameAt(time + o.x * 0.7, 3, 12);
    const g = f === 0 || f === 1 ? f : 2;
    return sprite(`relic|${key}|${g}`, () => {
      const p = new Px(16, 24);
      niche(p, hx(glowHex));
      draw(p, g);
      return { p, ax: 8, ay: 23 };
    });
  };
}

const glint = (p: Px, x: number, y: number, f: number) => {
  if (f === 2) return;
  const c = f === 0 ? WHITE : alpha(WHITE, 0.6);
  p.set(x, y, c);
  p.set(x - 1, y, alpha(c, 0.6));
  p.set(x + 1, y, alpha(c, 0.6));
  p.set(x, y - 1, alpha(c, 0.6));
  p.set(x, y + 1, alpha(c, 0.6));
};

registerPropPainter(
  'f15b_relic_crown',
  relic('crown', '#ffc040', (p, f) => {
    // Корона Крысиного короля на подушке из крысиных хвостов.
    const G = tn('#5e3a10', '#a6781e', '#e0b040', '#fff0a0');
    for (let x = 4; x <= 11; x++) p.set(x, 20, hx('#5a4038'));
    stroke(p, 3, 21, 13, 19, hx('#8a6a5a'), 1);
    p.rect(4, 15, 11, 18, G[1]);
    for (let x = 4; x <= 11; x++) p.set(x, 15, G[2]);
    for (const x of [4, 7, 8, 11]) {
      p.set(x, 14, G[2]);
      p.set(x, 13, G[3]);
    }
    p.set(6, 16, hx('#d8203a'));
    p.set(9, 16, hx('#3a80ff'));
    glint(p, 5, 13, f);
  }),
);

registerPropPainter(
  'f15b_relic_axe',
  relic('axe', '#ff6040', (p, f) => {
    // Секира Минотавра: древко наискось, два лезвия.
    const ST = tn('#2a2a30', '#5a5a64', '#9a9aa8', '#e6e6f0');
    stroke(p, 4, 21, 11, 6, hx('#5a3a20'), 1.6);
    poly(p, [
      [9, 6],
      [14, 4],
      [15, 9],
      [11, 10],
    ], (x) => tone(ST, x < 12 ? 0.8 : 0.4));
    poly(p, [
      [8, 9],
      [4, 7],
      [3, 12],
      [8, 12],
    ], (x) => tone(ST, x < 5 ? 0.85 : 0.5));
    p.set(10, 8, hx('#8a1a1a'));
    glint(p, 14, 5, f);
  }),
);

registerPropPainter(
  'f15b_relic_skull',
  relic('skull', '#ff7a30', (p, f) => {
    // Череп Красного змея: длинная морда, рога назад.
    const SK = tn('#5a1a10', '#9a3218', '#d05a2a', '#ffa060');
    shadeEll(p, 7, 15, 4.2, 3.4, SK);
    poly(p, [
      [9, 13],
      [14, 15],
      [13, 18],
      [9, 18],
    ], (x) => tone(SK, x < 11 ? 0.7 : 0.4));
    limb(p, 5, 13, 2, 9, 1, 0.3, BONE);
    limb(p, 8, 12, 7, 8, 0.9, 0.3, BONE);
    p.set(8, 15, EMBER_HI);
    for (let x = 10; x <= 13; x += 1) p.set(x, 18, BONE[3]);
    glint(p, 6, 13, f);
  }),
);

registerPropPainter(
  'f15b_relic_hydra',
  relic('hydra', '#60e060', (p, f) => {
    // Голова гидры: гребень, пасть, глаз.
    const HG = tn('#0c2a14', '#1e5a2a', '#3e9a4a', '#8ae08a');
    shadeEll(p, 8, 15, 4, 3.2, HG);
    poly(p, [
      [10, 13],
      [15, 15],
      [14, 18],
      [10, 17],
    ], (x) => tone(HG, x < 12 ? 0.6 : 0.35));
    for (let i = 0; i < 4; i++) limb(p, 5 + i * 1.6, 12, 4 + i * 1.6, 9 - (i % 2), 0.7, 0.2, tn('#3a0a0a', '#8a1a1a', '#c02a2a', '#ff6a5a'));
    p.set(9, 14, hx('#ffe06a'));
    for (let x = 11; x <= 14; x++) p.set(x, 17, BONE[3]);
    glint(p, 7, 13, f);
  }),
);

registerPropPainter(
  'f15b_relic_sword',
  relic('sword', '#b080ff', (p, f) => {
    // Меч Короля демонов остриём вниз, кромка алая.
    const BL = tn('#0e0c10', '#26222c', '#4a4452', '#8a8296');
    poly(p, [
      [7, 7],
      [9, 7],
      [9, 19],
      [8, 21],
      [7, 19],
    ], (x) => tone(BL, x < 8 ? 0.6 : 0.3));
    for (let y = 8; y < 19; y++) p.set(9, y, hx('#c02028'));
    p.rect(4, 6, 12, 6, hx('#a6781e'));
    p.set(4, 5, hx('#e0b040'));
    p.set(12, 5, hx('#e0b040'));
    stroke(p, 8, 5, 8, 2, hx('#2a1a14'), 1);
    p.set(8, 1, hx('#ff2a2a'));
    glint(p, 7, 9, f);
  }),
);

registerPropPainter('f15b_relic_empty', (o, time) => {
  // Пустая ниша: в ней ждёт место. Тусклый холодный свет, пыль.
  const f = frameAt(time + o.x, 2, 8);
  return sprite(`relic|empty|${f}`, () => {
    const p = new Px(16, 24);
    niche(p, hx('#8ab0ff'));
    for (let k = 0; k < 3; k++) {
      const y = 20 - ((f * 2 + k * 5) % 14);
      p.set(5 + k * 3, y, alpha(hx('#c8d8ff'), 0.6));
    }
    return { p, ax: 8, ay: 23 };
  });
});

// ---------------------------------------------------------------------------
// Кадр монстра: вспышка, отражение, кеш.
// ---------------------------------------------------------------------------

interface Built {
  p: Px;
  /** Середина тела и земля в кадре (смотрит вправо). */
  ax: number;
  ay: number;
  eye: [number, number] | null;
}

const frames = new Map<string, MobFrame>();

function finish(key: string, b: Built, flash: boolean, left: boolean): MobFrame {
  let p = b.p;
  if (flash) p = p.tint(WHITE, 0.85);
  if (left) p = p.flipX();
  const eye = b.eye ? ([left ? p.w - 1 - b.eye[0] : b.eye[0], b.eye[1]] as [number, number]) : null;
  const out: MobFrame = { img: p.canvas(), ax: left ? p.w - b.ax : b.ax, ay: b.ay, eye };
  frames.set(key, out);
  return out;
}

function frameOf(key: string, pose: MobPose, build: () => Built, flip = true): MobFrame {
  const k = `${key}|${flip && pose.left ? 1 : 0}|${pose.flash ? 1 : 0}`;
  return frames.get(k) ?? finish(k, build(), pose.flash, flip && pose.left);
}

/** Смерть: тело трескается и осыпается камнем с угольками — кадр k 0…3. */
function crumble(p: Px, k: number, seed: number): Px {
  if (k <= 0) return p;
  const o = new Px(p.w, p.h);
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      const i = (y * p.w + x) * 4;
      if (!p.data[i + 3]) continue;
      const r = hash(x >> 1, y >> 1, seed);
      if (r < k * 0.22) continue;
      const ty = Math.min(p.h - 1, y + Math.floor(k * k * 2.2 * r * (1 + (y / p.h) * 0.2)));
      const j = (ty * p.w + x) * 4;
      const c: RGBA = r < k * 0.3 ? EMBER : r < k * 0.45 ? STONE[1] : [p.data[i], p.data[i + 1], p.data[i + 2], 255];
      o.data[j] = c[0];
      o.data[j + 1] = c[1];
      o.data[j + 2] = c[2];
      o.data[j + 3] = 255;
    }
  return o;
}

/** Окаменение: всё к серому камню, трещины светятся угольком (оболочка). */
function petrify(p: Px, k: number, glow: number, seed: number): void {
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      const i = (y * p.w + x) * 4;
      if (!p.data[i + 3]) continue;
      const l = (p.data[i] * 0.3 + p.data[i + 1] * 0.59 + p.data[i + 2] * 0.11) / 255;
      const g = tone(STONE, l * 1.25 - 0.05);
      p.data[i] = p.data[i] + (g[0] - p.data[i]) * k;
      p.data[i + 1] = p.data[i + 1] + (g[1] - p.data[i + 1]) * k;
      p.data[i + 2] = p.data[i + 2] + (g[2] - p.data[i + 2]) * k;
    }
  // Трещины оболочки.
  if (k < 0.5) return;
  for (let n = 0; n < 7; n++) {
    let x = 10 + hash(n, seed) * (p.w - 20);
    let y = 20 + hash(n, seed, 1) * (p.h - 40);
    let a = hash(n, seed, 2) * TAU;
    for (let s = 0; s < 14; s++) {
      const xi = Math.round(x);
      const yi = Math.round(y);
      if (p.solid(xi, yi)) glowPx(p, xi, yi, glow > 0.5 ? EMBER : VEIN, 0.4 + glow * 0.5);
      a += (hash(n, s, seed) - 0.5) * 1.2;
      x += Math.cos(a);
      y += Math.sin(a);
    }
  }
}

// ---------------------------------------------------------------------------
// Хозяин подземелья — химера: крылатый лев из плоти и камня.
// Бок (ходьба и удары) и анфас (кокон, пробуждение, рык, крылья, сердце).
// ---------------------------------------------------------------------------

/** Каменная броня и плоть (старые четыре тона — для кокона и мелочи). */
const LSTONE = tn('#1e1814', '#40352e', '#66584c', '#9a8a78');
const LFLESH = tn('#2a060c', '#581420', '#8a2632', '#c0505a');
const LFLESH_FAR = tn('#1a0408', '#380c14', '#581820', '#7a2a32');

// --- Материалы Хозяина: ступени тона плюс своя фактура.

type MatTex = 'stone' | 'flesh' | 'mane' | 'bone' | 'memb' | 'scale';
interface Mat {
  r: RGBA[];
  tex: MatTex;
  seed: number;
}
const mat = (tex: MatTex, seed: number, ...h: string[]): Mat => ({ r: rampOf(...h), tex, seed });

const M_STONE = mat('stone', 41, '#120e0f', '#211b1a', '#352c28', '#4e423a', '#6b5b4e', '#8c7866', '#ad9880');
const M_STONE_FAR = mat('stone', 42, '#0b0809', '#151011', '#201918', '#2d2421', '#3c302b', '#4d3f37');
const M_FLESH = mat('flesh', 43, '#1a0409', '#34070f', '#550d18', '#7a1622', '#a0242c', '#c4423e');
const M_FLESH_FAR = mat('flesh', 44, '#10030a', '#1e050c', '#320911', '#4a0f18', '#621720');
const M_MANE = mat('mane', 45, '#120c0a', '#221815', '#352620', '#4c372c', '#654a3a', '#80604a', '#9c7a5c');
const M_MANE_FAR = mat('mane', 46, '#0a0706', '#150f0d', '#221814', '#30221b', '#402e24', '#523b2e');
const M_BONE = mat('bone', 47, '#3a3026', '#5e5242', '#857660', '#a99a80', '#cfc2a4', '#efe6cc');
const M_MEMB = mat('memb', 48, '#14030a', '#2a0712', '#460c1c', '#661528', '#8a2436', '#b03c48');
const M_MEMB_FAR = mat('memb', 49, '#0c0206', '#18040b', '#280812', '#3a0d1a', '#4e1422');
const M_SCALE = mat('scale', 50, '#0c120b', '#172014', '#25331d', '#374b29', '#4e6836', '#6e8c4a');
const MOUTH = mat('memb', 51, '#2a0604', '#6a1406', '#b8300a', '#f06a1c', '#ffb050', '#fff0a8');

/** Подсветка снизу: сердце и пол светят в тело красным. */
let rimK = 0.2;

function texAt(m: Mat, x: number, y: number, along: number, lat: number): number {
  switch (m.tex) {
    case 'stone': {
      let t = (vn(x / 3.2, y / 3.2, m.seed) - 0.5) * 1.1;
      const h = LAT[(((y * 7 + m.seed) & 255) << 8) | ((x * 3 + m.seed) & 255)];
      if (h < 0.035) t -= 1.4;
      else if (h > 0.975) t += 0.9;
      return t;
    }
    case 'flesh':
      return (vn(lat * 1.5 + m.seed, along / 6, m.seed) - 0.5) * 1.7;
    case 'mane':
      return (vn(lat * 1.3 + m.seed, along / 3.5, m.seed) - 0.5) * 1.6;
    case 'bone':
      return (vn(x / 4, y / 4, m.seed) - 0.5) * 0.5;
    case 'memb':
      return (vn(x / 5, y / 7, m.seed) - 0.5) * 0.9;
    case 'scale':
      return ((x + ((y >> 1) & 1) * 2) % 4 === 0 || y % 3 === 0 ? -0.9 : 0.15) + (vn(x / 3, y / 3, m.seed) - 0.5) * 0.4;
  }
}

/** Цвет точки материала: свет l (−1…1), фактура, смещение. */
function matPx(m: Mat, l: number, ny: number, x: number, y: number, along: number, lat: number, bias: number): RGBA {
  const n = m.r.length;
  const idx = 0.2 + (l * 0.45 + 0.33 + bias) * (n - 1) + texAt(m, x, y, along, lat);
  const c = ramp(m.r, idx, x, y);
  // Нижние грани ловят красный свет снизу.
  if (ny > 0.5 && rimK > 0) return mixc(c, VEIN_HOT, Math.min(0.5, (ny - 0.5) * 2 * rimK));
  return c;
}

/** Капсула из материала. */
function mlimb(p: Px, x0: number, y0: number, x1: number, y1: number, r0: number, r1: number, m: Mat, bias = 0): void {
  const minX = Math.floor(Math.min(x0 - r0, x1 - r1)) - 1;
  const maxX = Math.ceil(Math.max(x0 + r0, x1 + r1)) + 1;
  const minY = Math.floor(Math.min(y0 - r0, y1 - r1)) - 1;
  const maxY = Math.ceil(Math.max(y0 + r0, y1 + r1)) + 1;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const L = Math.hypot(dx, dy) || 1e-6;
  const ux = dx / L;
  const uy = dy / L;
  for (let y = minY; y <= maxY; y++)
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const t = Math.max(0, Math.min(1, ((px - x0) * ux + (py - y0) * uy) / L));
      const cx = x0 + dx * t;
      const cy = y0 + dy * t;
      const r = r0 + (r1 - r0) * t;
      const ex = px - cx;
      const ey = py - cy;
      const d = Math.hypot(ex, ey);
      if (d > r) continue;
      const nx = ex / (r || 1);
      const ny = ey / (r || 1);
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      const lat = ex * -uy + ey * ux;
      p.set(x, y, matPx(m, nx * LX + ny * LY + nz * LZ, ny, x, y, t * L, lat, bias));
    }
}

/** Овал из материала. */
function mell(p: Px, cx: number, cy: number, rx: number, ry: number, m: Mat, bias = 0): void {
  if (rx <= 0 || ry <= 0) return;
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      const q = dx * dx + dy * dy;
      if (q > 1) continue;
      const nz = Math.sqrt(1 - q);
      p.set(x, y, matPx(m, dx * LX + dy * LY + nz * LZ, dy, x, y, y - cy, x - cx, bias));
    }
}

/** Плита из материала: грань с наклоном и фаской по краю. */
function mplate(p: Px, pts: [number, number][], m: Mat, tilt: [number, number] = [0, 0], bias = 0): void {
  const inside = (x: number, y: number) => {
    let ins = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i];
      const [xj, yj] = pts[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins;
    }
    return ins;
  };
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
  const l0 = tilt[0] * LX + tilt[1] * LY + 0.55 * LZ;
  for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++)
    for (let x = Math.floor(minX); x <= Math.ceil(maxX); x++) {
      if (!inside(x + 0.5, y + 0.5)) continue;
      let l = l0;
      if (!inside(x - 0.5, y - 0.5)) l += 0.55;
      else if (!inside(x + 1.5, y + 1.5)) l -= 0.6;
      p.set(x, y, matPx(m, l, tilt[1], x, y, y, x, bias));
    }
}

/** Жаркий шов: светящаяся линия (щель между плитами, трещина). */
function seam(p: Px, x0: number, y0: number, x1: number, y1: number, glow: number): void {
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 1.5) + 1;
  for (let i = 0; i <= n; i++) {
    const x = Math.round(x0 + ((x1 - x0) * i) / n);
    const y = Math.round(y0 + ((y1 - y0) * i) / n);
    if (!p.solid(x, y)) continue;
    p.set(x, y, glow > 0.6 ? EMBER_HI : glow > 0.3 ? EMBER : VEIN);
    glowPx(p, x, y + 1, EMBER, 0.2 + glow * 0.3);
  }
}

/** Трещины по камню со светом из-под них (сердце светит сквозь броню). */
function cracksOn(p: Px, pts: [number, number][], glow: number, seed: number): void {
  for (const [x0, y0] of pts) {
    let x = x0;
    let y = y0;
    let a = hash(x0, y0, seed) * TAU;
    for (let s = 0; s < 7; s++) {
      if (p.solid(Math.round(x), Math.round(y))) glowPx(p, x, y, glow > 0.55 ? EMBER_HI : EMBER, 0.35 + glow * 0.6);
      a += (hash(s, x0, seed) - 0.5) * 1.6;
      x += Math.cos(a);
      y += Math.sin(a) * 0.8;
    }
  }
}

/** Точка квадратичной кривой. */
const qb = (a: [number, number], c: [number, number], b: [number, number], t: number): [number, number] => [
  (1 - t) * (1 - t) * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0],
  (1 - t) * (1 - t) * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1],
];

/**
 * Прядь гривы: толстая у корня, тонкая к концу, провисает; кончик тлеет.
 * `droop` — насколько кончик тянет вниз.
 */
function lock(p: Px, bx: number, by: number, a: number, len: number, w: number, m: Mat, glow: number, droop = 0.3, ember = true): void {
  const b: [number, number] = [bx, by];
  const e: [number, number] = [bx + Math.cos(a) * len, by + Math.sin(a) * len + len * droop * 0.5];
  const c: [number, number] = [bx + Math.cos(a) * len * 0.55, by + Math.sin(a) * len * 0.55 - len * 0.05];
  const n = Math.max(4, Math.ceil(len / 2.5));
  let prev = b;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const q = qb(b, c, e, t);
    const r0 = w * Math.pow(1 - (t - 1 / n) * 0.85, 0.9) * 0.5;
    const r1 = w * Math.pow(1 - t * 0.85, 0.9) * 0.5;
    if (ember && t > 0.82 && glow > 0.25) {
      const k = (t - 0.82) / 0.18;
      mlimb(p, prev[0], prev[1], q[0], q[1], r0, r1, MOUTH, -0.35 + glow * 0.25 + k * 0.15);
    } else mlimb(p, prev[0], prev[1], q[0], q[1], r0, r1, m, 0.02);
    prev = q;
  }
}

/** Крыло летучей мыши из камня и плоти: плечо, пальцы веером, перепонка. */
function lionWing(p: Px, sx: number, sy: number, a: number, len: number, open: number, far: boolean): void {
  const MB = far ? M_MEMB_FAR : M_MEMB;
  const BN = far ? M_STONE_FAR : M_STONE;
  const spread = 0.3 + open * 0.7;
  // Локоть и запястье.
  const ex = sx + Math.cos(a) * len * 0.34;
  const ey = sy + Math.sin(a) * len * 0.34;
  const wa = a + 0.35 * spread;
  const wx = ex + Math.cos(wa) * len * 0.3;
  const wy = ey + Math.sin(wa) * len * 0.3;
  const tips: [number, number][] = [];
  for (let i = 0; i < 4; i++) {
    const fa = wa + 0.15 - i * 0.5 * spread;
    const fl = len * (0.7 - i * 0.08);
    tips.push([wx + Math.cos(fa) * fl, wy + Math.sin(fa) * fl]);
  }
  // Последняя перепонка идёт к боку тела.
  const body: [number, number] = [sx + Math.cos(a + 2.2) * len * 0.22, sy + Math.sin(a + 2.2) * len * 0.22 + 6];
  const chain: [number, number][] = [...tips, body];
  for (let i = 0; i < chain.length - 1; i++) {
    const t0 = chain[i];
    const t1 = chain[i + 1];
    const mid: [number, number] = [(t0[0] + t1[0]) / 2, (t0[1] + t1[1]) / 2];
    // Провис перепонки к запястью — зубцом.
    const ctrl: [number, number] = [mid[0] + (wx - mid[0]) * 0.42, mid[1] + (wy - mid[1]) * 0.42];
    const edge: [number, number][] = [[wx, wy], t0];
    for (let k = 1; k < 8; k++) edge.push(qb(t0, ctrl, t1, k / 8));
    edge.push(t1);
    if (i === chain.length - 2) edge.push([sx, sy]);
    poly(p, edge, (x, y) => {
      const d = Math.hypot(x - wx, y - wy) / len;
      // Сквозь тонкую перепонку — свет: к краю светлее.
      const l = -0.4 + d * 1.1 + (vn(x / 3, y / 3, 60 + i) - 0.5) * 0.3;
      return matPx(MB, l, 0, x, y, 0, 0, 0);
    });
    // Жилы — от запястья к краю.
    if (!far) {
      const q = qb(t0, ctrl, t1, 0.5);
      const mm: [number, number] = [(wx + q[0]) / 2 + (hash(i, 3, 9) - 0.5) * 4, (wy + q[1]) / 2];
      for (let k = 0; k < 10; k++) {
        const pt = qb([wx, wy], mm, q, k / 10);
        const X = Math.round(pt[0]);
        const Y = Math.round(pt[1]);
        if (p.solid(X, Y)) glowPx(p, X, Y, VEIN_HOT, 0.35);
      }
    }
  }
  // Кромка перепонки — светлая нить.
  // Кости: плечо, предплечье, пальцы.
  mlimb(p, sx, sy, ex, ey, 3.4, 2.6, BN, 0.05);
  mlimb(p, ex, ey, wx, wy, 2.6, 2, BN, 0.05);
  for (const [tx, ty] of tips) mlimb(p, wx, wy, tx, ty, 1.5, 0.6, BN, 0.1);
  // Коготь на запястье и шипы на локте.
  mlimb(p, wx, wy, wx + Math.cos(a - 1.1) * 5, wy + Math.sin(a - 1.1) * 5, 1.3, 0.3, M_BONE, 0.2);
  mlimb(p, ex, ey, ex + Math.cos(a - 1.6) * 3.5, ey + Math.sin(a - 1.6) * 3.5, 1.1, 0.3, M_BONE, 0.2);
}

/** Голова в профиль: каменный череп, тяжёлая морда, челюсть, глаз, уши. */
function lionHeadSide(p: Px, hx0: number, hy0: number, lp: LionPose, far = false): [number, number] {
  const tilt = lp.head;
  const ca = Math.cos(tilt);
  const sa = Math.sin(tilt);
  const R = (x: number, y: number): [number, number] => [hx0 + x * ca - y * sa, hy0 + x * sa + y * ca];
  const S = far ? M_STONE_FAR : M_STONE;
  const jaw = lp.jaw;
  // Ухо — маленькое, круглое, торчит из гривы.
  mell(p, ...R(-5, -8.5), 2.6, 3, S, 0.1);
  mell(p, ...R(-4.8, -8), 1.3, 1.6, M_FLESH, -0.1);
  // Нижняя челюсть (опускается на рыке).
  const [j0x, j0y] = R(-2, 4.5);
  const [j1x, j1y] = R(12, 5.5 + jaw * 8);
  if (jaw > 0.15) {
    // Пасть: жар, язык, клыки сверху и снизу.
    const [m0x, m0y] = R(1, 3);
    const [m1x, m1y] = R(13, 3 + jaw * 4.5);
    mlimb(p, m0x, m0y, m1x, m1y, 2.6 * jaw + 0.6, 1.6 * jaw + 0.5, MOUTH, 0.1);
  }
  mlimb(p, j0x, j0y, j1x, j1y, 3.8, 2.8, S, -0.1);
  // Череп.
  mell(p, ...R(-1.5, -1), 8.2, 7.6, S, 0.05);
  // Морда — тяжёлая, с подушкой усов.
  mplate(p, [R(1, -5.5), R(12, -3.5), R(15.5, -0.5), R(15, 3.5), R(12, 5), R(2, 5.5)], S, [0.3, -0.2], 0.05);
  mell(p, ...R(10.5, 2.5), 4, 2.8, S, 0.18);
  // Нос.
  mell(p, ...R(14.6, -1.8), 1.9, 1.5, M_STONE_FAR, 0);
  const [nx, ny] = R(15.3, -1.3);
  p.set(Math.round(nx), Math.round(ny), INK);
  // Надбровье — каменный козырёк над глазом.
  mplate(p, [R(-3, -8.5), R(7.5, -7.5), R(9.5, -4.5), R(-1, -4)], S, [-0.3, -0.8], 0.15);
  // Клыки из-под губы.
  for (const k of [7.5, 11]) {
    const [tx, ty] = R(k, 5.2);
    p.set(Math.round(tx), Math.round(ty), BONE[3]);
    p.set(Math.round(tx), Math.round(ty) + 1, BONE[2]);
    if (jaw > 0.3) {
      const [bx, by] = R(k - 1, 5 + jaw * 6);
      p.set(Math.round(bx), Math.round(by), BONE[3]);
      p.set(Math.round(bx), Math.round(by) - 1, BONE[2]);
    }
  }
  // Трещина по щеке со светом.
  cracksOn(p, [R(-1, 2), R(4, -6)], lp.glow, 7);
  // Глаз: тёмная впадина, в ней золотой уголь.
  const [ex, ey] = R(5.5, -3.2);
  const X = Math.round(ex);
  const Y = Math.round(ey);
  p.set(X - 1, Y, INK);
  p.set(X, Y, GOLD);
  p.set(X + 1, Y, GOLD_HI);
  p.set(X, Y + 1, alpha(EMBER, 0.85));
  return [X + 1, Y];
}

/** Грива в профиль: задний слой (тёмный, длинный) и передний — вокруг затылка. */
function maneSide(p: Px, cx: number, cy: number, glow: number, back: boolean, far = false): void {
  const m = back ? (far ? M_MANE_FAR : M_MANE_FAR) : M_MANE;
  const n = back ? 13 : 10;
  for (let i = 0; i < n; i++) {
    const k = i / (n - 1);
    // Сзади: от подбородка вниз-назад, через затылок, до макушки.
    const a = back ? Math.PI * (0.4 + k * 1.1) : Math.PI * (0.6 + k * 0.85);
    const len = (back ? 17 : 11) * (0.75 + hash(i, back ? 3 : 4, 17) * 0.35) * (back ? 0.8 + Math.sin(Math.PI * k) * 0.3 : 1);
    const w = back ? 12 : 9;
    const r0 = back ? 4 : 6;
    lock(p, cx + Math.cos(a) * r0, cy + Math.sin(a) * r0, a + (hash(i, 5, 17) - 0.5) * 0.2, len, w, m, glow, back ? 0.6 : 0.45, i % 3 === 1);
  }
}

/** Хвост: каменные позвонки у корня, дальше — змея с головой (химера). */
function lionTail(p: Px, pts: [number, number][], glow: number, far = false): [number, number] {
  const sp = spline(pts, 7);
  const N = sp.length;
  for (let i = 0; i < N - 1; i++) {
    const k = i / N;
    const snake = k > 0.38;
    const r0 = snake ? 1.9 + (k - 0.38) * 2.2 : 2.6 - k * 2;
    const r1 = r0;
    mlimb(p, sp[i][0], sp[i][1], sp[i + 1][0], sp[i + 1][1], r0, r1, snake ? M_SCALE : far ? M_FLESH_FAR : M_FLESH, 0);
    if (!snake && i % 3 === 1) mell(p, sp[i][0], sp[i][1] - 0.8, 2.8 - k * 2, 2, far ? M_STONE_FAR : M_STONE, 0.1);
  }
  // Змеиная голова: клин, пасть, красный глаз.
  const [x1, y1] = sp[N - 1];
  const [x0, y0] = sp[Math.max(0, N - 4)];
  const a = Math.atan2(y1 - y0, x1 - x0);
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const hx1 = x1 + ux * 3;
  const hy1 = y1 + uy * 3;
  mlimb(p, x1, y1, hx1 + ux * 3.5, hy1 + uy * 3.5, 3.4, 1.6, M_SCALE, 0.1);
  mell(p, x1 + ux * 1.5, y1 + uy * 1.5, 3.4, 3, M_SCALE, 0.1);
  // Пасть приоткрыта.
  const mx = hx1 + ux * 2 + uy * 0.8;
  const my = hy1 + uy * 2 - ux * 0.8;
  p.set(Math.round(mx), Math.round(my), MOUTH.r[2]);
  p.set(Math.round(mx + ux), Math.round(my + uy), MOUTH.r[3]);
  const [ex, ey] = [x1 + ux * 2 - uy * 1.5, y1 + uy * 2 + ux * 1.5 - 1];
  p.set(Math.round(ex), Math.round(ey), glow > 0.2 ? hx('#ff4a3a') : hx('#b02020'));
  return [hx1, hy1];
}

/** Лапа: бедро (плоть под плитой) → голень → стопа с когтями. */
function lionLeg(p: Px, pts: [number, number][], rs: number[], far: boolean, claws: boolean, plate = true): void {
  const S = far ? M_STONE_FAR : M_STONE;
  const F = far ? M_FLESH_FAR : M_FLESH;
  for (let i = 0; i < pts.length - 1; i++)
    mlimb(p, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], rs[i], rs[i + 1], S, i === 0 ? -0.04 : 0.05);
  // Колено — плоть в стыке камня.
  mell(p, pts[1][0], pts[1][1], rs[1] * 0.8, rs[1] * 0.7, F, 0);
  seam(p, pts[0][0] - 1, pts[0][1] + 2, pts[1][0], pts[1][1] - 1, 0.3);
  // Плита на бедре.
  if (plate) {
    const [ax, ay] = pts[0];
    const [bx, by] = pts[1];
    mell(p, ax + (bx - ax) * 0.3 - 1, ay + (by - ay) * 0.3 - 1, rs[0] * 0.75, rs[0] * 0.85, S, 0.12);
  }
  const [px, py] = pts[pts.length - 1];
  mell(p, px + 1.5, py - 1.6, rs[rs.length - 1] + 1.8, 2.8, S, 0.12);
  if (claws)
    for (let k = 0; k < 3; k++) {
      const cx = Math.round(px + 3.5 + k * 1.6);
      p.set(cx, Math.round(py), BONE[3]);
      p.set(cx + 1, Math.round(py), BONE[2]);
      p.set(cx + 1, Math.round(py) + 1, BONE[1]);
    }
}

interface LionPose {
  view: 'side' | 'front';
  /** Фаза шага 0…1 (−1 — стоит). */
  step: number;
  bob: number;
  crouch: number;
  /** Встал на дыбы, 0…1. */
  rear: number;
  /** Голова: наклон (рад, минус — вверх). */
  head: number;
  jaw: number;
  /** Ближняя передняя лапа: 0 — стоит, 1 — занесена, −1 — удар вперёд-вниз. */
  paw: number;
  tail: number;
  /** Крылья: 0 — под плитами спины, 0…1 — раскрыты. */
  wings: number;
  flap: number;
  glow: number;
  /** Лапы поджаты (прыжок, полёт). */
  tuck: number;
  /** Анфас: грудь вскрыта (0…1), сердце светит. */
  chest: number;
  roar: boolean;
  /** Анфас: мах крыльями вперёд (порыв), 0…1. */
  gust: number;
}

const LP = (o: Partial<LionPose>): LionPose => ({
  view: 'side',
  step: -1,
  bob: 0,
  crouch: 0,
  rear: 0,
  head: 0,
  jaw: 0,
  paw: 0,
  tail: 0,
  wings: 0,
  flap: 0,
  glow: 0.35,
  tuck: 0,
  chest: 0,
  roar: false,
  gust: 0,
  ...o,
});

function drawLionSide(lp: LionPose): Built {
  const W = 132;
  const H = 116;
  const G = 108;
  const p = new Px(W, H);
  rimK = 0.12 + lp.glow * 0.18;
  const cr = lp.crouch;
  const rear = lp.rear;
  const hipX = 42;
  const hipY = G - 43 + cr * 8 - lp.bob + rear * 3;
  const shX = 78 - rear * 4;
  const shY = G - 49 + cr * 7 - lp.bob - rear * 16;
  const ph = lp.step < 0 ? 0 : lp.step * TAU;
  const swing = (o: number) => (lp.step < 0 ? 0 : Math.sin(ph + o));
  const lift = (o: number) => (lp.step < 0 ? 0 : Math.max(0, Math.cos(ph + o)) * 3.5);
  const tuck = lp.tuck;
  // --- Дальнее крыло (за телом).
  if (lp.wings > 0) lionWing(p, shX - 10, shY - 2, -Math.PI * 0.6 - lp.flap * 0.45, 54 * (0.6 + lp.wings * 0.4), lp.wings, true);
  // --- Дальние ноги.
  lionLeg(p, [
    [hipX + 4, hipY + 6],
    [hipX + 7 + swing(Math.PI) * 4 - tuck * 2, G - 22 - tuck * 8],
    [hipX + 1 + swing(Math.PI) * 5 - tuck * 6, G - 11 - lift(Math.PI) - tuck * 10],
    [hipX + 5 + swing(Math.PI) * 6 - tuck * 4, G - 3 - lift(Math.PI) - tuck * 12],
  ], [8, 5, 3.6, 3.2], true, false, false);
  lionLeg(p, [
    [shX + 4, shY + 14],
    [shX + 5 + swing(0) * 4 + tuck * 3, G - 22 - tuck * 8 + rear * 4],
    [shX + 7 + swing(0) * 6 + tuck * 6, G - 9 - lift(0) - tuck * 10 - rear * 10],
    [shX + 9 + swing(0) * 6 + tuck * 6, G - 3 - lift(0) - tuck * 12 - rear * 14],
  ], [7, 5.2, 4.2, 3.6], true, false, false);
  // --- Хвост: вверх и назад, змеиная голова смотрит вперёд.
  const tw = lp.tail;
  lionTail(p, [
    [hipX - 10, hipY - 3],
    [hipX - 21, hipY + 2 + tw * 2],
    [hipX - 30 + tw * 2, hipY - 6 + tw * 3],
    [hipX - 32 + tw * 4, hipY - 20 + tw * 2],
    [hipX - 25 + tw * 5, hipY - 29],
    [hipX - 17 + tw * 4, hipY - 31],
  ], lp.glow);
  // --- Тело: брюхо плотью, бедро и грудь — каменные массы.
  mlimb(p, hipX + 2, hipY + 5, shX - 2, shY + 13, 9.5, 13, M_FLESH, 0);
  mell(p, hipX - 2, hipY + 3, 11.5, 12.5, M_STONE, 0.05);
  mell(p, shX + 3, shY + 13, 13.5, 17, M_STONE, 0.08);
  // Рёбра: каменные дуги поперёк бока, меж ними — мышца.
  for (let i = 0; i < 3; i++) {
    const k = (i + 0.8) / 3.8;
    const x = hipX + 6 + (shX - hipX - 8) * k;
    const yt = hipY - 5 + (shY - hipY) * k;
    const yb = hipY + 13 + (shY + 22 - hipY - 13) * k;
    const pts = spline([
      [x - 1, yt],
      [x + 3.5, (yt + yb) / 2],
      [x + 1.5, yb],
    ], 4);
    for (let j = 0; j < pts.length - 1; j++) mlimb(p, pts[j][0], pts[j][1], pts[j + 1][0], pts[j + 1][1], 2, 1.8, M_STONE, 0.12);
  }
  // Брюхо снизу: тёмная складка и вена.
  for (let x = hipX + 8; x < shX - 4; x++) {
    const k = (x - hipX - 8) / (shX - hipX - 12);
    const by = hipY + 14 + (shY + 24 - hipY - 14) * k + Math.sin(k * Math.PI) * 1.5;
    p.set(x, Math.round(by), M_FLESH.r[1]);
    if (x % 6 === 0) glowPx(p, x, by - 3, VEIN_HOT, 0.5);
  }
  // Плиты спины внахлёст — щели светятся сердцем.
  const nPl = 6;
  const folded = lp.wings > 0 ? 0 : 1;
  for (let i = 0; i < nPl; i++) {
    const k0 = i / nPl;
    const k1 = (i + 1.3) / nPl;
    const x0 = hipX - 10 + (shX - hipX + 12) * k0;
    const x1 = hipX - 10 + (shX - hipX + 12) * k1;
    const arch = (k: number) => Math.sin(k * Math.PI) * 4;
    const y0 = hipY - 11 + (shY - 7 - hipY + 11) * k0 - arch(k0);
    const y1 = hipY - 11 + (shY - 7 - hipY + 11) * k1 - arch(k1);
    mplate(p, [
      [x0, y0 + 2],
      [x0 + 2, y0 - 3 - folded * 3],
      [x1, y1 - 3 - folded * 3],
      [x1 + 2, y1 + 3],
      [x0 + 1, y0 + 8],
    ], M_STONE, [-0.2, -0.7], 0.08);
    seam(p, x0 + 0.5, y0 - 1, x0 + 1.2, y0 + 6, lp.glow);
  }
  // Сложенные крылья под плитами: каменный плащ с жаркими щелями.
  if (folded) {
    mplate(p, [
      [shX - 2, shY - 10],
      [shX - 20, shY - 16],
      [hipX + 4, hipY - 17],
      [hipX + 10, hipY - 8],
      [shX - 4, shY + 1],
    ], M_STONE, [-0.3, -0.8], 0.14);
    for (let i = 0; i < 4; i++) seam(p, shX - 7 - i * 7, shY - 12 + i * 0.5, shX - 11 - i * 7, shY - 3 + i, lp.glow * 0.8);
  }
  cracksOn(p, [[hipX - 2, hipY + 2], [shX + 2, shY + 18], [hipX + 12, hipY - 4], [shX - 6, shY + 4]], lp.glow, 3);
  // Сердце в груди светит сквозь рёбра.
  const hcx = shX + 7;
  const hcy = shY + 15;
  p.ell(hcx, hcy, 2.8, 3.2, alpha(lp.glow > 0.6 ? EMBER_HI : EMBER, 0.55 + lp.glow * 0.45));
  for (let a = -1; a <= 1; a += 1) mlimb(p, hcx - 5, hcy + a * 4 - 1, hcx + 5, hcy + a * 4.5, 1.2, 1.1, M_STONE, 0.1);
  // --- Ближние ноги.
  lionLeg(p, [
    [hipX - 1, hipY + 6],
    [hipX + 3 + swing(0) * 4 - tuck * 2, G - 21 - tuck * 8],
    [hipX - 4 + swing(0) * 5 - tuck * 6, G - 11 - lift(0) - tuck * 10],
    [hipX + swing(0) * 6 - tuck * 4, G - 2 - lift(0) - tuck * 12],
  ], [9, 5.6, 4, 3.6], false, true, false);
  const paw = lp.paw;
  let fore: [number, number][];
  if (paw > 0) {
    fore = [
      [shX + 3, shY + 12],
      [shX + 11, shY + 2 - paw * 8],
      [shX + 17, shY - 6 - paw * 10],
      [shX + 21, shY - 10 - paw * 10],
    ];
  } else if (paw < 0) {
    const k = -paw;
    fore = [
      [shX + 3, shY + 12],
      [shX + 13 + k * 4, shY + 17],
      [shX + 23 + k * 4, G - 11],
      [shX + 27 + k * 3, G - 3],
    ];
  } else
    fore = [
      [shX + 3, shY + 12],
      [shX + 2 + swing(Math.PI) * 4 + tuck * 3, G - 22 - tuck * 8 + rear * 2],
      [shX + 5 + swing(Math.PI) * 6 + tuck * 6, G - 9 - lift(Math.PI) - tuck * 10 - rear * 12],
      [shX + 7 + swing(Math.PI) * 6 + tuck * 6, G - 2 - lift(Math.PI) - tuck * 12 - rear * 16],
    ];
  lionLeg(p, fore, [9, 6.2, 4.8, 4.2], false, true);
  if (paw > 0.6) {
    const [px, py] = fore[3];
    for (let k = 0; k < 3; k++) stroke(p, px + 1 + k, py - 2 + k, px + 5 + k, py - 5 + k * 1.5, BONE[3], 1);
  }
  // --- Шея, грива, голова.
  const hx0 = shX + 22 + rear * 3;
  const hy0 = shY - 9 - rear * 4 + lp.head * 6;
  mlimb(p, shX + 4, shY + 5, hx0 - 5, hy0 + 3, 10, 8, M_FLESH, 0.05);
  maneSide(p, hx0 - 4, hy0 + 1, lp.glow, true);
  const eye = lionHeadSide(p, hx0, hy0, lp);
  maneSide(p, hx0 - 5, hy0 + 1, lp.glow, false);
  // --- Ближнее крыло.
  if (lp.wings > 0) lionWing(p, shX - 8, shY - 4, -Math.PI * 0.7 - lp.flap * 0.55, 60 * (0.6 + lp.wings * 0.4), lp.wings, false);
  p.outline(INK);
  rimK = 0.2;
  return { p, ax: 60, ay: G, eye };
}

/** Анфас: морда в венце гривы, грудь с сердцем, лапы в упор, крылья. */
function drawLionFront(lp: LionPose): Built {
  const W = 156;
  const H = 120;
  const G = 112;
  const cx = 78;
  const p = new Px(W, H);
  rimK = 0.14 + lp.glow * 0.2;
  const cr = lp.crouch;
  const shY = G - 46 + cr * 8 - lp.bob;
  // --- Крылья по бокам: одно рисуем и отражаем.
  if (lp.wings > 0) {
    const a = -Math.PI * 0.84 - lp.flap * 0.4 + lp.gust * 0.9;
    const L = 64 * (0.6 + lp.wings * 0.4);
    const q = new Px(W, H);
    lionWing(q, cx - 14, shY - 2, a, L, lp.wings, false);
    const qf = q.flipX();
    for (let i = 0; i < q.data.length; i += 4)
      for (const src of [q, qf])
        if (src.data[i + 3]) {
          p.data[i] = src.data[i];
          p.data[i + 1] = src.data[i + 1];
          p.data[i + 2] = src.data[i + 2];
          p.data[i + 3] = 255;
        }
  }
  // --- Задние лапы за передними.
  for (const s of [-1, 1]) {
    mell(p, cx + s * 19, G - 13, 10, 11, M_STONE_FAR, 0.05);
    mell(p, cx + s * 22, G - 3, 5.5, 2.8, M_STONE_FAR, 0.1);
  }
  // --- Хвост за спиной: змея выглядывает над плечом.
  lionTail(p, [
    [cx + 14, shY + 22],
    [cx + 27, shY + 12],
    [cx + 33, shY - 2 + lp.tail * 3],
    [cx + 30 + lp.tail * 3, shY - 16],
    [cx + 24 + lp.tail * 3, shY - 22],
  ], lp.glow, true);
  // --- Грива сзади: большой тёмный венец.
  const hy0 = shY - 13 + lp.head * 5;
  for (let i = 0; i < 22; i++) {
    const a = -Math.PI / 2 + (i / 22) * TAU + 0.07;
    const down = Math.max(0, Math.sin(a));
    lock(p, cx + Math.cos(a) * 8, hy0 + 2 + Math.sin(a) * 7, a, 15 + hash(i, 1, 33) * 6 + down * 6, 10, M_MANE_FAR, lp.glow, 0.45, i % 3 === 0);
  }
  // --- Грудь и плечи.
  mell(p, cx, shY + 18, 21, 21, M_STONE, 0.08);
  for (const s of [-1, 1]) mell(p, cx + s * 17, shY + 9, 11, 12, M_STONE, s < 0 ? 0.14 : -0.02);
  // Грудная клетка: плоть в середине, каменные рёбра дугами; вскрывается.
  const open = lp.chest;
  mell(p, cx, shY + 21, 9 + open * 6, 12 + open * 4, M_FLESH, 0);
  for (let i = 0; i < 4; i++) {
    const y = shY + 12 + i * 5.2;
    const ok = open * (1 - i * 0.12);
    for (const s of [-1, 1]) {
      const x0 = cx + s * (1.5 + ok * 8);
      const pts = spline([
        [x0, y],
        [x0 + s * 7, y - 1.5],
        [x0 + s * 13, y + 3],
      ], 4);
      for (let j = 0; j < pts.length - 1; j++) mlimb(p, pts[j][0], pts[j][1], pts[j + 1][0], pts[j + 1][1], 1.9, 1.7, M_STONE, 0.12);
    }
  }
  // Сердце в груди.
  const hr = 4 + open * 4;
  p.ell(cx, shY + 21, hr, hr * 1.15, (x, y) => {
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - shY - 21) / hr;
    return d < 0.45 ? EMBER_HI : d < 0.8 ? EMBER : VEIN_HOT;
  });
  cracksOn(p, [[cx - 13, shY + 12], [cx + 13, shY + 14], [cx - 7, shY + 31], [cx + 8, shY + 29]], lp.glow, 5);
  // --- Передние лапы в упор.
  for (const s of [-1, 1]) {
    const raise = s > 0 ? Math.max(0, lp.paw) : 0;
    const pts: [number, number][] = [
      [cx + s * 16, shY + 14],
      [cx + s * 17, G - 19 - raise * 18],
      [cx + s * 16, G - 8 - raise * 22],
      [cx + s * 15, G - 2 - raise * 24],
    ];
    for (let i = 0; i < 3; i++) mlimb(p, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], [8.5, 6, 5][i], [6, 5, 4.4][i], i === 0 ? M_FLESH : M_STONE, 0.05);
    mell(p, pts[0][0] - s * 1, pts[0][1] - 1, 8, 9, M_STONE, 0.12);
    mell(p, pts[3][0], pts[3][1] - 1.5, 6, 3.2, M_STONE, 0.12);
    for (let k = -1; k <= 1; k++) {
      p.set(Math.round(pts[3][0] + k * 2.2), Math.round(pts[3][1] + 0.5), BONE[3]);
      p.set(Math.round(pts[3][0] + k * 2.2), Math.round(pts[3][1] + 1.5), BONE[2]);
    }
  }
  // --- Грива спереди: венец вокруг морды и борода на грудь.
  for (let i = 0; i < 16; i++) {
    const a = -Math.PI / 2 + ((i + 0.5) / 16) * TAU;
    lock(p, cx + Math.cos(a) * 9, hy0 + 1 + Math.sin(a) * 8.5, a, 8 + hash(i, 2, 34) * 4, 7.5, M_MANE, lp.glow, 0.35, i % 4 === 2);
  }
  for (let i = 0; i < 5; i++) lock(p, cx - 6 + i * 3, hy0 + 9, Math.PI / 2 + (i - 2) * 0.18, 9 + (i % 2) * 3, 6, M_MANE, lp.glow, 0.1, false);
  // --- Морда анфас.
  mell(p, cx, hy0, 10.5, 10, M_STONE, 0.1);
  // Уши.
  for (const s of [-1, 1]) {
    mell(p, cx + s * 8.5, hy0 - 8.5, 2.8, 3, M_STONE, 0.1);
    mell(p, cx + s * 8.5, hy0 - 8, 1.4, 1.6, M_FLESH, -0.1);
  }
  // Надбровья.
  mplate(p, [
    [cx - 10.5, hy0 - 5],
    [cx, hy0 - 2],
    [cx + 10.5, hy0 - 5],
    [cx + 9.5, hy0 - 1.5],
    [cx, hy0 + 1.5],
    [cx - 9.5, hy0 - 1.5],
  ], M_STONE, [0, -0.8], 0.15);
  // Морда, подушки усов, нос.
  mell(p, cx, hy0 + 6.5, 7, 5.5, M_STONE, 0.18);
  for (const s of [-1, 1]) mell(p, cx + s * 3.2, hy0 + 7, 3.2, 2.6, M_STONE, 0.24);
  mell(p, cx, hy0 + 3.8, 2.6, 1.7, M_STONE_FAR, 0);
  p.set(cx - 1, hy0 + 4, INK);
  p.set(cx + 1, hy0 + 4, INK);
  // Пасть: на рыке — широко, жар и клыки.
  if (lp.roar || lp.jaw > 0.2) {
    const j = Math.max(lp.jaw, lp.roar ? 1 : 0);
    mell(p, cx, hy0 + 11 + j * 2, 5.4, 2 + j * 3.4, MOUTH, 0.05);
    for (const s of [-1, 1]) {
      p.set(cx + s * 3, hy0 + 9, BONE[3]);
      p.set(cx + s * 3, hy0 + 10, BONE[2]);
      p.set(cx + s * 3, hy0 + 13 + Math.round(j * 5), BONE[3]);
      p.set(cx + s * 3, hy0 + 12 + Math.round(j * 5), BONE[2]);
    }
  } else {
    for (let x = cx - 3; x <= cx + 3; x++) p.set(x, hy0 + 10, INK);
    p.set(cx - 3, hy0 + 11, BONE[3]);
    p.set(cx + 3, hy0 + 11, BONE[3]);
  }
  // Глаза — золотые угли в тёмных впадинах.
  for (const s of [-1, 1]) {
    p.set(cx + s * 5 - 1, hy0 - 1, INK);
    p.set(cx + s * 5 + 1, hy0 - 1, INK);
    p.set(cx + s * 5, hy0 - 1, GOLD);
    p.set(cx + s * 5 + (s < 0 ? 1 : -1), hy0 - 1, GOLD_HI);
    p.set(cx + s * 5, hy0, alpha(EMBER, 0.85));
  }
  cracksOn(p, [[cx - 6, hy0 + 3], [cx + 7, hy0 - 3]], lp.glow, 9);
  p.outline(INK);
  rimK = 0.2;
  return { p, ax: cx, ay: G, eye: [cx + 5, hy0 - 1] };
}

// --- Кокон: каменный бутон в корнях и жилах, внутри сердце.

const COCOON = tn('#1a1412', '#3a302a', '#5e5046', '#8e7c6a');

/** Плёнка кокона: вино, мокрый верх; каменная корка; свет изнутри. */
const MEMB = rampOf('#12030a', '#2a0812', '#46101c', '#66182a', '#8a2a38', '#b04850', '#d87a70');
const CRUST = rampOf('#141011', '#241d1c', '#3a302c', '#54463e', '#726052', '#948070');
const INGLOW = hx('#ff6038');
const INGLOW_HI = hx('#ffc080');

/**
 * Кокон Хозяина: живая куколка на корнях. Плёнка тонкая — изнутри
 * просвечивает свернувшийся зверь и бьётся свет; низ и бока в каменной
 * корке, её колет каждое павшее эхо; рёбра выходят из пола и держат
 * кокон, как когти. `burst` — лопнул (лепестки плёнки наружу).
 */
function drawCocoon(cracks: number, beat: number, burst: number): Built {
  const W = 104;
  const H = 108;
  const G = 98;
  const cx = 52;
  const p = new Px(W, H);
  const cy = G - 38 - beat * 1.2;
  const rx = 23 + beat * 1.4;
  const ry = 35 + beat * 0.8;
  // Корни в пол — толстые жгуты веером, под коконом.
  for (let i = 0; i < 11; i++) {
    const a = Math.PI * (0.02 + (i / 10) * 0.96);
    const x0 = cx + Math.cos(a) * 12;
    const x1 = cx + Math.cos(a) * (32 + (i % 3) * 7);
    const y1 = G - 1 + (i % 2) * 2;
    const mid: [number, number] = [(x0 + x1) / 2, G - 6 - (i % 2) * 2];
    limb(p, x0, G - 14, mid[0], mid[1], 4.2, 3, LFLESH_FAR);
    limb(p, mid[0], mid[1], x1, y1, 3, 1, LFLESH_FAR);
  }
  // Рёбра-когти за коконом (дальние).
  const rib = (side: number, i: number, front: boolean) => {
    const baseX = cx + side * (14 + i * 7);
    const pts = spline([
      [baseX, G - 1],
      [baseX + side * (8 + i * 2), G - 22 - i * 4],
      [cx + side * (rx + 1 - i * 3), cy - 10 - i * 8],
      [cx + side * (rx - 10 - i * 2), cy - ry * 0.55 - i * 6],
    ], 6);
    for (let j = 0; j < pts.length - 1; j++) {
      const k = j / (pts.length - 1);
      limb(p, pts[j][0], pts[j][1], pts[j + 1][0], pts[j + 1][1], 3.1 - k * 1.8, 2.9 - k * 1.8, front ? BONE : tn('#2e261e', '#5a4e40', '#857660', '#a89880'));
    }
  };
  if (burst <= 0) for (const sd of [-1, 1]) rib(sd, 1, false);
  if (burst > 0) {
    // Лопнул: плёнка разорвана лепестками наружу, корка раскидана,
    // внутри пустая горячая полость.
    const open = Math.min(1, burst);
    p.ell(cx, G - 16, 20, 9, MEMB[0]);
    p.ell(cx, G - 17, 14, 5.5, alpha(INGLOW, 0.55 * (1 - open * 0.5)));
    p.ell(cx, G - 17.5, 7, 2.5, alpha(INGLOW_HI, 0.6 * (1 - open * 0.6)));
    const n = 7;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + ((i + 0.5) / n - 0.5) * (1.4 + open * 2.4);
      const bx = cx + Math.cos(a) * 9;
      const by = G - 16 + Math.sin(a) * 4;
      const len = 24 + (i % 2) * 6 - open * 4;
      const tx = cx + Math.cos(a) * (14 + len * 0.9);
      const ty = G - 16 + Math.sin(a) * len;
      const nx = -Math.sin(a);
      const ny = Math.cos(a);
      poly(p, [
        [bx - nx * 7, by - ny * 3 + 4],
        [tx - nx * 2.5, ty],
        [tx + nx * 1.5, ty + 1],
        [bx + nx * 7, by + ny * 3 + 4],
      ], (x, y) => ramp(MEMB, 2.2 + ((x - cx) * LX + (y - G) * LY) * 0.05 + (x + y) * 0, x, y));
      stroke(p, bx, by + 2, (bx + tx) / 2, (by + ty) / 2, VEIN_D, 1);
    }
    // Осколки корки у подножия.
    for (let i = 0; i < 9; i++) {
      const x = cx + (hash(i, 3) - 0.5) * 70;
      const y = G - 3 - hash(i, 4) * 8;
      polyShade(p, [
        [x - 3, y + 2],
        [x - 1, y - 2],
        [x + 3, y - 1],
        [x + 2, y + 2],
      ], LSTONE);
    }
    p.outline(INK);
    return { p, ax: cx, ay: G, eye: null };
  }
  // Тело куколки: эллипсоид, к верху уже.
  const inside = (x: number, y: number) => {
    const dy = (y + 0.5 - cy) / ry;
    const taper = 1 - Math.max(0, -dy) * 0.28;
    const dx = (x + 0.5 - cx) / (rx * taper);
    return dx * dx + dy * dy <= 1 ? [dx, dy] : null;
  };
  const glow = 0.35 + beat * 0.65;
  // Кто внутри: свернувшийся зверь (тёмный силуэт под плёнкой).
  const beast = (x: number, y: number) => {
    const u = (x - cx) / rx;
    const v = (y - cy) / ry;
    const body = Math.hypot((u + 0.1) / 0.62, (v - 0.12) / 0.5) < 1 && Math.hypot((u + 0.15) / 0.3, (v - 0.05) / 0.26) > 1;
    const head = Math.hypot((u - 0.25) / 0.3, (v + 0.35) / 0.24) < 1;
    const wing = Math.abs(u + 0.35 + v * 0.3) < 0.08 && v > -0.55 && v < 0.35;
    return body || head || wing;
  };
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
    for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
      const q = inside(x, y);
      if (!q) continue;
      const [dx, dy] = q;
      const nz = Math.sqrt(Math.max(0, 1 - dx * dx - dy * dy));
      const l = dx * LX + dy * LY + nz * LZ;
      // Плёнка: складки вдоль, тонкие места светятся.
      const fold = Math.sin(dx * 9 + Math.sin(dy * 5) * 1.3) * 0.5 + 0.5;
      const thin = vn(x / 7, y / 9, 31) * 0.7 + fold * 0.3;
      let c = ramp(MEMB, 0.7 + l * 3.4 + fold * 0.6, x, y);
      // Свет изнутри: к середине и в тонких местах; зверь — тенью.
      const core = Math.max(0, 1 - Math.hypot(dx * 0.9, dy * 0.8 - 0.05)) * glow;
      const shade = beast(x, y) ? 0.25 : 1;
      const k = Math.max(0, core * (thin - 0.22) * 2.3) * shade;
      if (k > 0.02) c = mixc(c, k > 0.5 ? INGLOW_HI : INGLOW, Math.min(0.85, k));
      // Сосуды плёнки.
      const vv = vn(x / 11, y / 16, 32);
      if (Math.abs(vv - 0.5) < 0.035) c = mixc(c, k > 0.2 ? INGLOW : VEIN_D, 0.7);
      // Каменная корка: снизу и пятнами по бокам.
      const crust = dy > 0.52 - vn(x / 9, y / 9, 33) * 0.4 || Math.abs(dx) > 0.9 - vn(x / 6, y / 12, 34) * 0.22;
      if (crust) {
        const seam = Math.abs(vn(x / 5.5, y / 4.5, 35) - 0.5) < 0.05;
        c = seam ? CRUST[0] : ramp(CRUST, 1.2 + l * 3.4, x, y);
      }
      p.set(x, y, c);
    }
  // Блик по мокрой плёнке.
  for (let i = 0; i < 9; i++) {
    const a = -2.35 + i * 0.07;
    const x = Math.round(cx + Math.cos(a) * rx * 0.72);
    const y = Math.round(cy + Math.sin(a) * ry * 0.7);
    if (inside(x, y)) p.set(x, y, alpha(SPEC, 0.85 - Math.abs(i - 4) * 0.12));
  }
  // Трещины корки: по одной на павшее эхо, светятся сердцем.
  for (let n = 0; n < cracks; n++) {
    let x = cx + (hash(n, 5) - 0.5) * 30;
    let y = cy + 8 + hash(n, 6) * 20;
    let a = -Math.PI / 2 + (hash(n, 7) - 0.5) * 2.2;
    for (let st = 0; st < 20 + n * 4; st++) {
      const X = Math.round(x);
      const Y = Math.round(y);
      if (inside(X, Y)) {
        p.set(X, Y, glow > 0.6 ? INGLOW_HI : EMBER);
        glowPx(p, X + 1, Y, INGLOW, 0.4);
        glowPx(p, X - 1, Y, INGLOW, 0.25);
      }
      a += (hash(n, st, 3) - 0.5) * 1.2;
      x += Math.cos(a);
      y += Math.sin(a);
    }
  }
  // Рёбра-когти спереди.
  for (const sd of [-1, 1]) rib(sd, 0, true);
  // Пуповина: жгуты от кокона к полу спереди.
  for (const sd of [-1, 1]) limb(p, cx + sd * 6, G - 8, cx + sd * 10, G - 1, 3, 2.2, LFLESH);
  p.outline(INK);
  return { p, ax: cx, ay: G, eye: null };
}

/** Кокон на подставке (до боя и после победы) — предмет у K. */
registerPropPainter('f15b_cocoon', (_o, time) => {
  const s = paintSim();
  const st = s?.boss?.state;
  if (st === 'fight') return null;
  if (st === 'won' || st === 'rest') {
    return sprite('cocoon|burst', () => {
      const b = drawCocoon(5, 0, 1);
      return { p: b.p, ax: b.ax, ay: b.ay };
    });
  }
  const k = (time / 1.5) % 1;
  const f = k < 0.12 ? 2 : k < 0.3 ? 1 : 0;
  return sprite(`cocoon|${f}`, () => {
    const b = drawCocoon(0, f / 2, 0);
    return { p: b.p, ax: b.ax, ay: b.ay };
  });
});

registerMobPainter('f15boss', (m: Mob, pose: MobPose) => {
  const mode = pose.mode;
  const t = pose.t;
  const s = paintSim();
  const v = f15bView(s);
  const phase = m.data.phase ?? 0;
  const winged = phase >= 3 && mode !== 'f15_unfurl' ? 1 : 0;
  const bk = v && s ? beatK(v, s.time) : 0.5;
  const beat = bk < 0.18 ? 1 : bk < 0.4 ? 0.5 : 0;
  const glow = Math.min(1, 0.3 + phase * 0.15 + beat * 0.3);
  const z = Math.round((m.data.z ?? 0) * 3) * 5;
  let key = '';
  let lp: LionPose = LP({ glow, wings: winged });
  let cocoon: [number, number, number] | null = null;
  switch (mode) {
    case 'f15_cocoon':
      cocoon = [v?.echo ?? 0, beat, 0];
      break;
    case 'f15_crack':
      // Вздрогнул: тряска бутона и вспышка трещин.
      cocoon = [v?.echo ?? 0, t < 0.3 ? 1 : 0.5, 0];
      break;
    case 'f15_wake': {
      const T = LION.wake;
      if (t < 1.3) cocoon = [5, t % 0.2 < 0.1 ? 1 : 0.5, 0];
      else if (t < 2.0) cocoon = [5, 1, (t - 1.3) / 0.7];
      else {
        const k = Math.min(3, Math.floor((t - 2) / ((T - 2) / 4)));
        lp = LP({ view: 'front', glow: 1, roar: k >= 1, jaw: k >= 1 ? 1 : 0.3, head: k >= 1 ? -0.3 : 0, crouch: k === 0 ? 0.6 : 0, bob: k === 2 ? 1 : 0 });
        key = `wake${k}`;
      }
      break;
    }
    case 'f15_memory':
    case 'f15_call': {
      const k = Math.floor(t * 6) % 2;
      lp = LP({ view: 'front', glow: 1, roar: true, head: -0.35, jaw: 1, crouch: k * 0.2, wings: winged, flap: k ? 0.3 : -0.2 });
      key = `roar${k}`;
      break;
    }
    case 'f15_unfurl': {
      const k = Math.min(3, Math.floor(t / (LION.unfurl / 4)));
      lp = LP({ view: 'front', glow: 1, roar: k >= 2, jaw: k >= 2 ? 1 : 0, head: -0.2, wings: (k + 1) / 4, flap: k % 2 ? 0.4 : -0.3 });
      key = `unfurl${k}`;
      break;
    }
    case 'f15_rip': {
      const k = Math.min(3, Math.floor(t / (LION.rip / 4)));
      lp = LP({ view: 'front', glow: 1, wings: winged, chest: [0.15, 0.5, 1, 1][k], paw: k === 1 ? 0.7 : 0, roar: k >= 2, jaw: k >= 2 ? 1 : 0, head: k >= 2 ? -0.4 : 0, crouch: k === 3 ? 0.5 : 0 });
      key = `rip${k}`;
      break;
    }
    case 'f15_husk': {
      // Оболочка без сердца: припала, окаменела, трещины дышат в такт.
      lp = LP({ view: 'front', glow: beat, wings: winged, chest: 1, crouch: 1, head: 0.35, flap: -0.8 });
      key = `husk${beat > 0.5 ? 1 : 0}`;
      break;
    }
    case 'f15_claw': {
      const W = LION.clawWarn;
      const k = t < W * 0.75 ? 0 : 1;
      lp = LP({ glow, wings: winged, paw: k ? -1 : 1, rear: k ? 0 : 0.35, head: k ? 0.1 : -0.15, jaw: k ? 0.8 : 0.3 });
      key = `claw${k}`;
      break;
    }
    case 'f15_crouch':
      lp = LP({ glow, wings: winged, crouch: Math.min(1, t / 0.3), head: 0.2, tail: 1, jaw: 0.3 });
      key = `crouch${t < 0.3 ? 0 : 1}`;
      break;
    case 'f15_leap':
      lp = LP({ glow, wings: winged, tuck: 1, head: -0.1, jaw: 1, tail: -1, flap: 0.6 });
      key = 'leap';
      break;
    case 'f15_landed':
      lp = LP({ glow, wings: winged, crouch: 0.8, head: 0.35, flap: -0.9, tail: 0.5 });
      key = `landed${Math.floor(t * 4) % 2}`;
      lp.bob = key.endsWith('1') ? 1 : 0;
      break;
    case 'f15_stomp': {
      const k = t < 0.5 ? 0 : 1;
      lp = LP({ glow, wings: winged, rear: k ? 0 : 1, crouch: k ? 0.5 : 0, head: k ? 0.3 : -0.3, jaw: 1, paw: k ? -0.5 : 0 });
      key = `stomp${k}`;
      break;
    }
    case 'f15_takeoff':
    case 'f15_fly':
    case 'f15_swoopAim': {
      const k = Math.floor(t * 9) % 4;
      lp = LP({ glow, wings: 1, tuck: 0.8, flap: [1, 0.3, -0.8, -0.2][k], head: -0.1, tail: k % 2 ? 0.6 : -0.4 });
      key = `fly${k}`;
      break;
    }
    case 'f15_swoop':
      lp = LP({ glow: 1, wings: 1, tuck: 1, flap: -1, head: 0.25, jaw: 1, tail: -1 });
      key = 'swoop';
      break;
    case 'f15_gust': {
      const k = t < LION.gustWarn * 0.8 ? 0 : 1;
      lp = LP({ view: 'front', glow, wings: 1, gust: k ? 1 : -0.3, flap: k ? -0.6 : 0.8, head: -0.1 });
      key = `gust${k}`;
      break;
    }
    case 'f15_fan': {
      const k = Math.floor(t * 8) % 2;
      lp = LP({ view: 'front', glow, wings: 1, flap: k ? 0.9 : 0.5, head: -0.2, jaw: 0.6 });
      key = `fan${k}`;
      break;
    }
    case 'f15_recover':
      lp = LP({ glow, wings: winged, crouch: 0.2, head: 0.15 });
      key = 'recover';
      break;
    case 'dying': {
      const k = Math.min(3, Math.floor(t / 0.17));
      lp = LP({ view: 'front', glow: 0.2, wings: winged, chest: 1, crouch: 1, head: 0.4, flap: -1 });
      key = `die${k}`;
      break;
    }
    default:
      if (pose.anim === 'run') {
        const f = ((pose.frame % 6) + 6) % 6;
        lp = LP({ glow, wings: winged, step: f / 6, bob: f % 3 === 0 ? 1 : 0, tail: Math.sin((f / 6) * TAU) * 0.6, flap: -0.8 });
        key = `walk${f}`;
      } else {
        const f = ((pose.frame % 4) + 4) % 4;
        lp = LP({ glow, wings: winged, bob: f === 1 || f === 2 ? 1 : 0, tail: [0, 0.4, 0.7, 0.4][f], head: f === 2 ? 0.05 : 0, flap: -0.8 });
        key = `idle${f}`;
      }
  }
  if (cocoon) {
    const [cr, bt, burst] = cocoon;
    const ck = `f15boss|cocoon|${cr}|${bt}|${Math.round(burst * 4)}`;
    return frameOf(ck, pose, () => {
      const b = drawCocoon(cr, bt, burst);
      // Кокон стоит на полклетки ниже середины льва (как предмет у K).
      return { ...b, ay: b.ay - 6 };
    }, false);
  }
  const zq = z;
  const fk = `f15boss|${key}|${winged}|${Math.round(glow * 3)}|${zq}`;
  return frameOf(fk, pose, () => {
    const b = lp.view === 'front' ? drawLionFront(lp) : drawLionSide(lp);
    if (mode === 'f15_husk') petrify(b.p, 0.85, lp.glow, 13);
    if (mode === 'dying') {
      petrify(b.p, 1, 0.2, 13);
      b.p = crumble(b.p, Math.min(3, Math.floor(t / 0.17)), 7);
    }
    if (zq) {
      b.p = copyAt(b.p, b.p.w, b.p.h + zq, 0, 0);
      b.ay += zq;
    }
    return b;
  }, lp.view === 'side');
});

// --- Истинное сердце: камень и плоть, бьётся; раскрытое — светится.

const HEARTF = tn('#3a0610', '#6e1020', '#a8202e', '#e85060');

function drawHeart(open: number, flash: number, dying: number): Built {
  const W = 56;
  const H = 64;
  const G = 58;
  const cx = 28;
  const p = new Px(W, H);
  const cy = 30;
  const sz = 1 + open * 0.08;
  // Аорта и сосуды сверху — дуга и три ствола.
  const vessel = tn('#4a0a14', '#8a1626', '#c02a3a', '#f06070');
  const arch = spline([
    [cx - 2, cy - 10],
    [cx - 4, cy - 20],
    [cx + 6, cy - 25],
    [cx + 12, cy - 16],
  ], 6);
  for (let i = 0; i < arch.length - 1; i++) limb(p, arch[i][0], arch[i][1], arch[i + 1][0], arch[i + 1][1], 4, 3.8, vessel);
  for (const [x, h] of [
    [cx - 3, 8],
    [cx + 3, 10],
    [cx + 9, 7],
  ] as [number, number][])
    limb(p, x, cy - 22, x + (x - cx) * 0.2, cy - 22 - h, 2.2, 1.6, vessel);
  // Правый ствол — полая вена сбоку.
  limb(p, cx - 12, cy - 6, cx - 16, cy - 18, 3, 2.4, vessel, -0.1);
  // Тело сердца: два желудочка, камень поверх плоти.
  const rx = 15 * sz;
  const ry = 17 * sz;
  p.ell(cx, cy + 2, rx, ry, (x, y) => {
    const dx = (x + 0.5 - cx) / rx;
    const dy = (y + 0.5 - cy - 2) / ry;
    // Верхушка сужается к низу (острие сердца смещено влево).
    const nz = Math.sqrt(Math.max(0, 1 - dx * dx - dy * dy));
    return tone(HEARTF, dx * LX + dy * LY + nz * LZ);
  });
  // Острие сердца.
  poly(p, [
    [cx - 11 * sz, cy + 10],
    [cx + 8 * sz, cy + 12],
    [cx - 4, cy + 22 * sz],
  ], (x, y) => tone(HEARTF, 0.55 - (y - cy) * 0.03 - (x - cx) * 0.02));
  // Межжелудочковая борозда с веной.
  const groove = spline([
    [cx + 3, cy - 12],
    [cx + 1, cy],
    [cx - 3, cy + 12],
    [cx - 4, cy + 19],
  ], 6);
  for (let i = 0; i < groove.length - 1; i++) stroke(p, groove[i][0], groove[i][1], groove[i + 1][0], groove[i + 1][1], VEIN_D, 2);
  // Каменные пластины: сжатое — сомкнуты, раскрытое — разошлись, в щелях свет.
  const plates: [number, number, number][] = [
    [-8, -6, 0.2],
    [7, -8, -0.3],
    [-10, 6, 0.5],
    [9, 5, -0.5],
    [-2, 13, 0.1],
  ];
  const core = open > 0.5 ? EMBER_HI : EMBER;
  if (open > 0) p.ell(cx, cy + 2, rx * 0.72, ry * 0.7, (x, y) => (Math.hypot((x - cx) / rx, (y - cy - 2) / ry) < 0.35 ? core : mixc(EMBER, VEIN_HOT, 0.4)));
  for (const [ox, oy, rot] of plates) {
    const px = cx + ox * (1 + open * 0.28);
    const py = cy + oy * (1 + open * 0.2);
    const w = 7;
    const h = 5.5;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const pt = (x: number, y: number): [number, number] => [px + x * c - y * s, py + x * s + y * c];
    polyShade(p, [pt(-w, -h * 0.6), pt(-w * 0.2, -h), pt(w, -h * 0.4), pt(w * 0.8, h * 0.8), pt(-w * 0.6, h)], LSTONE, 0.1);
    // Трещинки в плите светятся.
    stroke(p, ...pt(-w * 0.4, -h * 0.3), ...pt(w * 0.3, h * 0.4), alpha(EMBER, 0.4 + open * 0.5), 1);
  }
  // Жилы-артерии поверх, светятся ударом.
  for (let i = 0; i < 3; i++) {
    const pts = spline([
      [cx - 12 + i * 10, cy - 8],
      [cx - 10 + i * 9, cy + 3],
      [cx - 6 + i * 6, cy + 14],
    ], 5);
    for (let j = 0; j < pts.length - 1; j++) stroke(p, pts[j][0], pts[j][1], pts[j + 1][0], pts[j + 1][1], open > 0.5 ? VEIN_HOT : VEIN, 1);
  }
  if (dying > 0) {
    p.outline(INK);
    const b = crumble(p, dying, 5);
    return { p: b, ax: cx, ay: G, eye: null };
  }
  p.outline(INK);
  if (flash > 0) {
    // Удар сердца: алый ореол вокруг силуэта.
    const q = new Px(W, H);
    q.data.set(p.data);
    q.outline(alpha(VEIN_HOT, 0.7 * flash), true);
    return { p: q, ax: cx, ay: G, eye: [cx + 4, cy - 4] };
  }
  return { p, ax: cx, ay: G, eye: [cx + 4, cy - 4] };
}

registerMobPainter('f15boss_heart', (m: Mob, pose: MobPose) => {
  const s = paintSim();
  const v = f15bView(s);
  const k = v && s ? beatK(v, s.time) : 0.5;
  const open = pose.mode === 'f15h_rise' ? 0.4 : k < HEART.shutK ? 0 : k < HEART.shutK + 0.12 ? 0.5 : 1;
  const flash = k < 0.12 ? 1 : 0;
  const dying = pose.mode === 'dying' ? Math.min(3, Math.floor(pose.t / 0.16) + 1) : 0;
  const z = Math.round((m.data.z ?? 0.6) * 4) * 4;
  const key = `f15heart|${open}|${flash}|${dying}|${z}`;
  return frameOf(key, pose, () => {
    const b = drawHeart(open, flash, dying);
    if (z) {
      b.p = copyAt(b.p, b.p.w, b.p.h + z, 0, 0);
      b.ay += z;
    }
    return b;
  }, false);
});

// --- Кровяной сгусток: катится, раздувается, лопается.

function drawClot(f: number, swell: number): Built {
  const p = new Px(20, 18);
  const cx = 10;
  const r = 4.2 + swell * 2.2;
  const cy = 12 - r * 0.2;
  const sq = [0, 0.4, 0, -0.4][f % 4];
  shadeEll(p, cx, cy, r + sq * 0.5, r - sq * 0.4, tn('#2a0408', '#5a0a14', '#9a1826', '#e04a50'));
  // Плёнка и жилы; раздутый — светится.
  for (let i = 0; i < 3; i++) {
    const a = (f * 0.8 + i * 2.1) % TAU;
    stroke(p, cx + Math.cos(a) * r * 0.2, cy + Math.sin(a) * r * 0.2, cx + Math.cos(a + 0.7) * r * 0.85, cy + Math.sin(a + 0.7) * r * 0.85, swell > 0.3 ? VEIN_HOT : VEIN_D, 1);
  }
  if (swell > 0.4) p.ell(cx, cy, r * 0.4, r * 0.35, alpha(EMBER_HI, 0.6));
  p.set(cx - 2, Math.round(cy - r * 0.5), WET);
  // Глазок-сгусток.
  p.set(cx + 2, Math.round(cy - 1), hx('#ff5060'));
  p.outline(INK);
  return { p, ax: cx, ay: 16, eye: [cx + 2, Math.round(cy - 1)] };
}

registerMobPainter('f15b_clot', (_m: Mob, pose: MobPose) => {
  const swell = pose.mode === 'f15c_swell' ? Math.min(1, pose.t / 0.6) : 0;
  const sk = Math.round(swell * 3);
  const f = pose.anim === 'run' ? ((pose.frame % 4) + 4) % 4 : Math.floor(pose.t * 3) % 2 ? 1 : 0;
  if (pose.mode === 'dying') {
    const k = Math.min(3, Math.floor(pose.t / 0.12));
    return frameOf(`clot|die${k}`, pose, () => {
      const b = drawClot(0, 0.5);
      return { ...b, p: crumble(b.p, k, 3) };
    }, false);
  }
  return frameOf(`clot|${f}|${sk}`, pose, () => drawClot(f, sk / 3), false);
});

// ---------------------------------------------------------------------------
// Отголоски: рисовальщики пяти прошлых боссов, перекрашенные в призрак.
// Кадр хозяина берётся как есть, потом один раз перекрашивается по яркости
// в холодный спектральный ряд, с кантом света и строками «записи», и
// растворяется при подъёме и смерти (дизер).
// ---------------------------------------------------------------------------

const ECHO_SRC: Record<string, string> = {
  f15b_echo_king: 'f1_king',
  f15b_echo_mino: 'f5_minotaur',
  f15b_echo_serpent: 'f6boss',
  f15b_echo_hydra: 'f9_body',
  f15b_echo_head: 'f9_head',
  f15b_echo_demon: 'f10boss',
};

const GHOST: RGBA[] = [hx('#140f2a'), hx('#2a3470'), hx('#3c5a9e'), hx('#6a9ed0'), hx('#a8dcf0'), hx('#e6faff')];
const ghostCache = new WeakMap<HTMLCanvasElement, Map<string, HTMLCanvasElement>>();

function ghostify(src: HTMLCanvasElement, fade: number, scan: number): HTMLCanvasElement {
  let m = ghostCache.get(src);
  if (!m) {
    m = new Map();
    ghostCache.set(src, m);
  }
  const key = `${fade}|${scan}`;
  const hit = m.get(key);
  if (hit) return hit;
  const w = src.width;
  const h = src.height;
  const g = src.getContext('2d');
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  if (!g) return out;
  const id = g.getImageData(0, 0, w, h);
  const d = id.data;
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] > 40;
  const o = new ImageData(w, h);
  const od = o.data;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (d[i + 3] <= 40) continue;
      // Растворение: пиксели уходят по дизеру.
      if (fade > 0 && hash(x >> 1, y >> 1, 77) < fade) continue;
      const l = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255;
      let c = GHOST[Math.max(0, Math.min(5, Math.floor(l * 6.2)))];
      // Кант света по краю силуэта.
      if (!solid(x - 1, y) || !solid(x, y - 1)) c = GHOST[5];
      else if (!solid(x + 1, y) || !solid(x, y + 1)) c = GHOST[3];
      // Строки «записи»: через две — темнее, со сдвигом по кадру.
      const line = (y + scan) % 3 === 0;
      od[i] = line ? c[0] * 0.78 : c[0];
      od[i + 1] = line ? c[1] * 0.78 : c[1];
      od[i + 2] = line ? c[2] * 0.85 : c[2];
      od[i + 3] = line ? 175 : 225;
    }
  out.getContext('2d')!.putImageData(o, 0, 0);
  m.set(key, out);
  return out;
}

registerMobPainter('f15b_echo', (m: Mob, pose: MobPose) => {
  const src = MOB_PAINTERS.get(ECHO_SRC[m.kind] ?? '');
  if (!src) return null;
  // Подъём: хозяину кадра — «стоит», сами растворяемся обратно.
  const rising = pose.mode === 'f15e_rise';
  const pp: MobPose = rising ? { ...pose, mode: 'chase', anim: 'idle', t: 0 } : pose;
  const fr = src(m, pp);
  if (!fr) return null;
  let fade = 0;
  if (rising) fade = Math.max(0, 1 - pose.t / 1.3);
  if (pose.mode === 'dying') fade = Math.min(1, pose.t / 0.6);
  const fq = Math.round(fade * 5) / 5;
  const s = paintSim();
  const scan = Math.floor((s?.time ?? 0) * 6) % 3;
  return { img: ghostify(fr.img, fq, scan), ax: fr.ax, ay: fr.ay, eye: fr.eye };
});

// ---------------------------------------------------------------------------
// Метки ударов, лужи и облака — рисуются по кадру (контекстом, на полу).
// ---------------------------------------------------------------------------

type ZoneX = (Zone | Strike) & {
  ang?: number;
  arc?: number;
  w?: number;
  mob?: number;
  q?: number;
  cells?: number[];
};

const rgba = (c: RGBA, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a)).toFixed(3)})`;

/** Метка удара наливается: `k` 0…1. */
const kOf = (z: ZoneX) => {
  const s = z as Strike;
  if ('warn' in s && typeof s.warn === 'number' && s.warn > 0) return Math.min(1, s.t / s.warn);
  return 1;
};

function cone(g: CanvasRenderingContext2D, x: number, y: number, r: number, a: number, arc: number): void {
  g.beginPath();
  g.moveTo(x, y);
  g.arc(x, y, r, a - arc / 2, a + arc / 2);
  g.closePath();
}

const BLOODC = hx('#e8202e');
const HOT = hx('#ff8a4a');
const STONEC = hx('#c8b8a0');
const GHOSTC = hx('#a8dcf0');

/** Когти льва: три разреза в конусе, ползут к краю. */
registerZonePainter('f15b_claw', (g, z, px, py, S) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const R = zz.r * S;
  const a = zz.ang ?? 0;
  const arc = zz.arc ?? 1.8;
  cone(g, px, py, R, a, arc);
  g.fillStyle = rgba(BLOODC, 0.1 + 0.22 * k);
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = rgba(hx('#ffe0c0'), 0.3 + 0.65 * k);
  for (let i = -1; i <= 1; i++) {
    const aa = a + i * arc * 0.28;
    const r0 = R * 0.3;
    const r1 = R * (0.3 + 0.68 * k);
    g.beginPath();
    g.moveTo(px + Math.cos(aa - 0.12) * r0, py + Math.sin(aa - 0.12) * r0);
    g.quadraticCurveTo(px + Math.cos(aa) * (r0 + r1) * 0.55, py + Math.sin(aa) * (r0 + r1) * 0.55, px + Math.cos(aa + 0.1) * r1, py + Math.sin(aa + 0.1) * r1);
    g.stroke();
  }
  g.lineWidth = 1;
  return true;
});

/** Прыжок льва: тень растёт над меткой, по кругу трещины. */
registerZonePainter('f15b_pounce', (g, z, px, py, S) => {
  const k = kOf(z as ZoneX);
  const R = z.r * S;
  g.fillStyle = rgba(hx('#000000'), 0.18 + 0.4 * k);
  g.beginPath();
  g.ellipse(px, py, R * (0.35 + 0.65 * k), R * (0.35 + 0.65 * k) * 0.62, 0, 0, TAU);
  g.fill();
  g.strokeStyle = rgba(BLOODC, 0.5 + 0.5 * k);
  g.lineWidth = 1;
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.stroke();
  // Четыре когтя-засечки по краю — «сюда ляжет лапа».
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + 0.2;
    g.beginPath();
    g.moveTo(px + Math.cos(a) * R * 0.55, py + Math.sin(a) * R * 0.55);
    g.lineTo(px + Math.cos(a + 0.15) * R * (0.55 + 0.45 * k), py + Math.sin(a + 0.15) * R * (0.55 + 0.45 * k));
    g.stroke();
  }
  return true;
});

/** Кольцо ударной волны: осколки камня (прыжок) и толчок (кокон, крылья). */
function ringMark(g: CanvasRenderingContext2D, z: ZoneX, px: number, py: number, S: number, col: RGBA, time: number, bits: boolean): void {
  const k = kOf(z);
  const R = z.r * S;
  const w = (z.w ?? 0.55) * S;
  g.lineWidth = w * 2;
  g.strokeStyle = rgba(col, 0.1 + 0.28 * k);
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.stroke();
  g.lineWidth = 1;
  g.strokeStyle = rgba(col, 0.5 + 0.5 * k);
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.stroke();
  if (!bits) return;
  // Осколки на кольце — квадратики, дрожат к удару.
  g.fillStyle = rgba(STONEC, 0.6 + 0.4 * k);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * TAU + time * 0.4;
    const j = Math.sin(time * 40 + i) * k * 0.8;
    g.fillRect(Math.round(px + Math.cos(a) * (R + j)) - 1, Math.round(py + Math.sin(a) * (R + j)) - 1, 2, 2);
  }
}

registerZonePainter('f15b_shards', (g, z, px, py, S, time) => {
  ringMark(g, z as ZoneX, px, py, S, hx('#ffb070'), time, true);
  return true;
});
registerZonePainter('f15b_shock', (g, z, px, py, S, time) => {
  ringMark(g, z as ZoneX, px, py, S, hx('#ff6050'), time, false);
  return true;
});

/** Удар сердца: алое кольцо волной, внутри — пульс. */
registerZonePainter('f15b_pulse', (g, z, px, py, S, time) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const R = zz.r * S;
  const w = (zz.w ?? 0.55) * S;
  g.lineWidth = w * 2;
  g.strokeStyle = rgba(hx('#ff2040'), 0.12 + 0.3 * k);
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.stroke();
  // Бегущие по кольцу сгустки света.
  g.lineWidth = 1.5;
  g.strokeStyle = rgba(hx('#ffb0a0'), 0.4 + 0.6 * k);
  for (let i = 0; i < 3; i++) {
    const a0 = time * 2.4 + (i / 3) * TAU;
    g.beginPath();
    g.arc(px, py, R, a0, a0 + 0.9 * k + 0.2);
    g.stroke();
  }
  g.lineWidth = 1;
  return true;
});

/** Каменные шипы бегут к герою: круг с шипом, который растёт. */
registerZonePainter('f15b_spike', (g, z, px, py, S) => {
  const k = kOf(z as ZoneX);
  const R = z.r * S;
  g.fillStyle = rgba(hx('#1a0c08'), 0.2 + 0.35 * k);
  g.beginPath();
  g.ellipse(px, py, R, R * 0.6, 0, 0, TAU);
  g.fill();
  g.strokeStyle = rgba(HOT, 0.4 + 0.5 * k);
  g.beginPath();
  g.ellipse(px, py, R, R * 0.6, 0, 0, TAU);
  g.stroke();
  // Трещина звездой — из неё вылезет шип.
  g.strokeStyle = rgba(hx('#ffd080'), 0.3 + 0.7 * k);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + 0.3;
    g.beginPath();
    g.moveTo(px, py);
    g.lineTo(px + Math.cos(a) * R * 0.8 * k, py + Math.sin(a) * R * 0.5 * k);
    g.stroke();
  }
  if (k > 0.85) {
    // Острие показалось.
    g.fillStyle = rgba(STONEC, (k - 0.85) * 6);
    g.beginPath();
    g.moveTo(px - 3, py + 1);
    g.lineTo(px, py - 8 * (k - 0.85) * 6);
    g.lineTo(px + 3, py + 1);
    g.fill();
  }
  return true;
});

/** Пике: широкая полоса через зал, тень крыльев бежит по ней. */
registerZonePainter('f15b_swoop', (g, z, px, py, S, time) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const L = zz.r * S;
  const w = (zz.w ?? 1) * S;
  g.save();
  g.translate(px, py);
  g.rotate(zz.ang ?? 0);
  g.fillStyle = rgba(BLOODC, 0.1 + 0.2 * k);
  g.fillRect(0, -w, L, w * 2);
  g.fillStyle = rgba(hx('#ffd0c0'), 0.4 + 0.5 * k);
  g.fillRect(0, -w, L, 1);
  g.fillRect(0, w - 1, L, 1);
  // Шевроны «туда» бегут вдоль.
  g.strokeStyle = rgba(hx('#fff0e0'), 0.3 + 0.6 * k);
  for (let x = ((time * 90) % 18) - 18; x < L; x += 18) {
    g.beginPath();
    g.moveTo(x, -w * 0.6);
    g.lineTo(x + 6, 0);
    g.lineTo(x, w * 0.6);
    g.stroke();
  }
  g.restore();
  return true;
});

/** Перо-мина: воткнутое перо, светится перед взрывом. */
registerZonePainter('f15b_quill', (g, z, px, py, S, time) => {
  const k = kOf(z as ZoneX);
  const R = z.r * S;
  g.strokeStyle = rgba(HOT, 0.3 + 0.6 * k);
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.stroke();
  g.strokeStyle = rgba(STONEC, 1);
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(px - 2, py + 2);
  g.lineTo(px + 3, py - 6);
  g.stroke();
  g.lineWidth = 1;
  if (Math.sin(time * (10 + k * 30)) > 0) {
    g.fillStyle = rgba(hx('#ffe0a0'), k);
    g.fillRect(Math.round(px + 2), Math.round(py - 7), 2, 2);
  }
  return true;
});

/** Порыв крыльев: конус с полосами ветра наружу. */
registerZonePainter('f15b_gust', (g, z, px, py, S, time) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const R = zz.r * S;
  const a = zz.ang ?? 0;
  const arc = zz.arc ?? 1.5;
  cone(g, px, py, R, a, arc);
  g.fillStyle = rgba(hx('#c8e0ff'), 0.06 + 0.14 * k);
  g.fill();
  g.strokeStyle = rgba(hx('#e8f4ff'), 0.25 + 0.5 * k);
  for (let i = 0; i < 7; i++) {
    const aa = a + (i / 6 - 0.5) * arc * 0.9;
    const r0 = ((time * 70 + i * 23) % (R * 0.8)) + R * 0.15;
    g.beginPath();
    g.moveTo(px + Math.cos(aa) * r0, py + Math.sin(aa) * r0);
    g.lineTo(px + Math.cos(aa) * (r0 + 10), py + Math.sin(aa) * (r0 + 10));
    g.stroke();
  }
  return true;
});

/** Полоса пламени змея-эха: призрачный огонь по линии. */
registerZonePainter('f15b_flame', (g, z, px, py, S, time) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const L = zz.r * S;
  const w = (zz.w ?? 0.5) * S;
  g.save();
  g.translate(px, py);
  g.rotate(zz.ang ?? 0);
  g.fillStyle = rgba(hx('#ff5a20'), 0.12 + 0.28 * k);
  g.fillRect(0, -w, L, w * 2);
  // Языки пламени растут к удару.
  g.fillStyle = rgba(hx('#ffc060'), 0.3 + 0.6 * k);
  for (let x = 2; x < L; x += 5) {
    const h = (2 + Math.sin(time * 12 + x * 0.7) * 1.5) * k;
    g.fillRect(x, -h, 2, h * 2);
  }
  g.restore();
  return true;
});

registerZonePainter('f15b_bite', (g, z, px, py, S) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const R = zz.r * S;
  if ((zz as Strike).shape === 'cone') {
    cone(g, px, py, R, zz.ang ?? 0, zz.arc ?? 1.2);
    g.fillStyle = rgba(BLOODC, 0.12 + 0.25 * k);
    g.fill();
  } else {
    g.fillStyle = rgba(BLOODC, 0.12 + 0.25 * k);
    g.beginPath();
    g.arc(px, py, R, 0, TAU);
    g.fill();
  }
  // Челюсти смыкаются: два зубчатых полукруга сходятся.
  const a = zz.ang ?? -Math.PI / 2;
  const cxm = px + ((zz as Strike).shape === 'cone' ? Math.cos(a) * R * 0.6 : 0);
  const cym = py + ((zz as Strike).shape === 'cone' ? Math.sin(a) * R * 0.6 : 0);
  const gap = (1 - k) * 5 + 1;
  g.fillStyle = rgba(hx('#f4ead8'), 0.4 + 0.6 * k);
  for (let i = -2; i <= 2; i++) {
    g.fillRect(Math.round(cxm + i * 3) - 1, Math.round(cym - gap - 2), 2, 2);
    g.fillRect(Math.round(cxm + i * 3) - 1, Math.round(cym + gap), 2, 2);
  }
  return true;
});

registerZonePainter('f15b_axe', (g, z, px, py, S) => {
  const k = kOf(z as ZoneX);
  const R = z.r * S;
  g.fillStyle = rgba(BLOODC, 0.12 + 0.26 * k);
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.fill();
  g.strokeStyle = rgba(hx('#e8e8f0'), 0.4 + 0.6 * k);
  g.beginPath();
  g.arc(px, py, R * (1.2 - 0.2 * k), 0, TAU);
  g.stroke();
  // Секира падает: тень лезвия сужается.
  g.fillStyle = rgba(hx('#000000'), 0.2 + 0.3 * k);
  g.fillRect(Math.round(px - R * 0.1), Math.round(py - R * (1 - k)), Math.round(R * 0.2), Math.round(R * (1 - k) * 2) + 1);
  return true;
});

registerZonePainter('f15b_slash', (g, z, px, py, S) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const R = zz.r * S;
  const a = zz.ang ?? 0;
  const arc = zz.arc ?? 2;
  cone(g, px, py, R, a, arc);
  g.fillStyle = rgba(hx('#8a60ff'), 0.1 + 0.24 * k);
  g.fill();
  g.strokeStyle = rgba(GHOSTC, 0.35 + 0.6 * k);
  g.beginPath();
  g.arc(px, py, R, a - arc / 2, a - arc / 2 + arc * k);
  g.stroke();
  return true;
});

registerZonePainter('f15b_cleave', (g, z, px, py, S) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const L = zz.r * S;
  const w = (zz.w ?? 0.7) * S;
  g.save();
  g.translate(px, py);
  g.rotate(zz.ang ?? 0);
  g.fillStyle = rgba(hx('#8a60ff'), 0.12 + 0.28 * k);
  g.fillRect(0, -w, L, w * 2);
  g.fillStyle = rgba(GHOSTC, 0.5 + 0.5 * k);
  g.fillRect(Math.round(L * k) - 4, -1, 4, 2);
  g.restore();
  return true;
});

/** Молния эха: сперва круг-метка, в удар — зигзаг с неба (поверх темноты). */
registerZonePainter('f15b_bolt', (g, z, px, py, S, time) => {
  const k = kOf(z as ZoneX);
  const R = z.r * S;
  g.strokeStyle = rgba(hx('#b8a0ff'), 0.35 + 0.55 * k);
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.stroke();
  g.fillStyle = rgba(hx('#6a50d0'), 0.08 + 0.22 * k);
  g.fill();
  if (k > 0.8) {
    const a = (k - 0.8) * 5;
    g.lineWidth = 2;
    g.strokeStyle = rgba(hx('#d8c8ff'), a);
    g.beginPath();
    let x = px;
    g.moveTo(x, py - 60);
    for (let i = 1; i <= 6; i++) {
      x = px + (i === 6 ? 0 : (hash(i, Math.floor(time * 20), z.id) - 0.5) * 12);
      g.lineTo(x, py - 60 + i * 10);
    }
    g.stroke();
    g.lineWidth = 1;
  }
  return true;
});

/** Извержение лавы: пузырь вспухает, по краю искры. */
registerZonePainter('f15b_erupt', (g, z, px, py, S, time) => {
  const k = kOf(z as ZoneX);
  const R = z.r * S;
  g.fillStyle = rgba(hx('#ff5010'), 0.14 + 0.3 * k);
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.fill();
  g.fillStyle = rgba(hx('#ffd060'), 0.3 + 0.6 * k);
  g.beginPath();
  g.arc(px, py, R * 0.45 * k, 0, TAU);
  g.fill();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + time * 3;
    g.fillRect(Math.round(px + Math.cos(a) * R), Math.round(py + Math.sin(a) * R * 0.8) - (Math.sin(time * 15 + i) > 0 ? 1 : 0), 1, 1);
  }
  return true;
});

/** Гейзер бездны: бирюзовый круг, вода вскипает. */
registerZonePainter('f15b_geyser', (g, z, px, py, S, time) => {
  const k = kOf(z as ZoneX);
  const R = z.r * S;
  g.fillStyle = rgba(hx('#20a0b0'), 0.12 + 0.3 * k);
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.fill();
  g.strokeStyle = rgba(hx('#c0ffff'), 0.4 + 0.6 * k);
  for (let i = 0; i < 3; i++) {
    const r = R * (((time * 1.4 + i / 3) % 1) * k);
    g.beginPath();
    g.arc(px, py, r, 0, TAU);
    g.stroke();
  }
  return true;
});

/** Луч зеркала: тонкая холодная линия, в удар — слепящая. */
registerZonePainter('f15b_beam', (g, z, px, py, S) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const L = zz.r * S;
  const w = (zz.w ?? 0.38) * S;
  g.save();
  g.translate(px, py);
  g.rotate(zz.ang ?? 0);
  g.fillStyle = rgba(hx('#a0c0ff'), 0.08 + 0.2 * k);
  g.fillRect(0, -w, L, w * 2);
  g.fillStyle = rgba(hx('#f0f8ff'), 0.3 + 0.7 * k);
  g.fillRect(0, -0.5, L * Math.min(1, k * 1.3), 1);
  g.restore();
  return true;
});

/** Голова гидры из круга: пасть зелёным кругом. */
registerZonePainter('f15b_hbite', (g, z, px, py, S, time) => {
  const k = kOf(z as ZoneX);
  const R = z.r * S;
  g.fillStyle = rgba(hx('#40c040'), 0.12 + 0.28 * k);
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.fill();
  g.strokeStyle = rgba(hx('#b0ff90'), 0.4 + 0.6 * k);
  g.beginPath();
  g.arc(px, py, R * (1 - 0.3 * Math.sin(time * 9) * k), 0, TAU);
  g.stroke();
  return true;
});

/** Артерия хлещет: жила-линия, пульс бежит от сердца. */
registerZonePainter('f15b_artery', (g, z, px, py, S, time) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const L = zz.r * S;
  const w = (zz.w ?? 0.5) * S;
  g.save();
  g.translate(px, py);
  g.rotate(zz.ang ?? 0);
  g.fillStyle = rgba(hx('#c01028'), 0.12 + 0.3 * k);
  g.fillRect(0, -w, L, w * 2);
  // Волнистая жила по оси, пульс-сгусток бежит наружу.
  g.strokeStyle = rgba(hx('#ff5060'), 0.5 + 0.5 * k);
  g.beginPath();
  for (let x = 0; x <= L; x += 4) {
    const y = Math.sin(x * 0.2 + time * 8) * 1.5 * k;
    if (x === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke();
  g.fillStyle = rgba(hx('#ffd0b0'), 0.6 + 0.4 * k);
  g.fillRect(Math.round(L * k) - 3, -2, 4, 4);
  g.restore();
  return true;
});

// --- Лужи и облака.

registerZonePainter('f15b_flames', (g, z, px, py, S, time) => {
  const zz = z as Zone;
  const life = zz.t - (zz.warn ?? 0);
  const fade = Math.min(1, (zz.life - life) / 0.5);
  const R = zz.r * S;
  g.fillStyle = rgba(hx('#8a1a06'), 0.35 * fade);
  g.beginPath();
  g.ellipse(px, py, R, R * 0.7, 0, 0, TAU);
  g.fill();
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU + zz.id;
    const r = R * (0.2 + 0.6 * hash(i, zz.id));
    const x = px + Math.cos(a) * r;
    const y = py + Math.sin(a) * r * 0.7;
    const h = (3 + Math.sin(time * 14 + i * 2) * 2) * fade;
    g.fillStyle = rgba(hx('#ff8a20'), 0.8 * fade);
    g.fillRect(Math.round(x), Math.round(y - h), 2, Math.round(h));
    g.fillStyle = rgba(hx('#ffe080'), 0.8 * fade);
    g.fillRect(Math.round(x), Math.round(y - h), 1, 1);
  }
  return true;
});

registerZonePainter('f15b_miasma', (g, z, px, py, S, time) => {
  const zz = z as Zone;
  const warn = zz.warn ?? 0;
  const R = zz.r * S;
  if (zz.t < warn) {
    const k = zz.t / warn;
    g.strokeStyle = rgba(hx('#90e040'), 0.4 + 0.5 * k);
    g.beginPath();
    g.arc(px, py, R, 0, TAU);
    g.stroke();
    return true;
  }
  const fade = Math.min(1, (zz.life - (zz.t - warn)) / 0.6);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU + time * 0.5 + zz.id;
    const r = R * (0.25 + 0.55 * ((i * 0.37 + time * 0.15) % 1));
    g.fillStyle = rgba(hx('#6aa020'), 0.3 * fade);
    g.beginPath();
    g.arc(px + Math.cos(a) * r, py + Math.sin(a) * r * 0.7, 3 + (i % 3), 0, TAU);
    g.fill();
  }
  return true;
});

registerZonePainter('f15b_pool', (g, z, px, py, S) => {
  const zz = z as Zone;
  const fade = Math.min(1, (zz.life - zz.t) / 0.6);
  const R = zz.r * S;
  g.fillStyle = rgba(hx('#4a0610'), 0.55 * fade);
  g.beginPath();
  g.ellipse(px, py, R, R * 0.62, 0, 0, TAU);
  g.fill();
  g.fillStyle = rgba(hx('#a01828'), 0.5 * fade);
  g.beginPath();
  g.ellipse(px - R * 0.2, py - R * 0.15, R * 0.5, R * 0.25, 0, 0, TAU);
  g.fill();
  return true;
});

/** Туман под эхом: холодное облако у ног, струйки вверх. */
registerZonePainter('f15b_mist', (g, z, px, py, S, time) => {
  const R = z.r * S;
  g.fillStyle = rgba(hx('#6ab0e0'), 0.18);
  g.beginPath();
  g.ellipse(px, py, R * 1.2, R * 0.5, 0, 0, TAU);
  g.fill();
  for (let i = 0; i < 5; i++) {
    const t = (time * 0.6 + i / 5) % 1;
    const x = px + Math.sin(i * 2.3 + time) * R * 0.8;
    g.fillStyle = rgba(hx('#c8f0ff'), 0.35 * (1 - t));
    g.fillRect(Math.round(x), Math.round(py - t * 18), 1, 2);
  }
  return true;
});

/** Тело змея-эха: призрачные кольца по пути головы. */
const echoSegs = new Map<number, HTMLCanvasElement>();
function echoSeg(r: number): HTMLCanvasElement {
  let c = echoSegs.get(r);
  if (c) return c;
  const S = r * 2 + 4;
  const p = new Px(S, S);
  p.ell(S / 2, S / 2, r, r * 0.86, (x, y) => {
    const dx = (x + 0.5 - S / 2) / r;
    const dy = (y + 0.5 - S / 2) / r;
    const l = 0.6 - dx * 0.3 - dy * 0.4;
    return alpha(GHOST[Math.max(1, Math.min(5, Math.round(l * 5)))], 0.82);
  });
  for (let x = 0; x < S; x++) if (p.solid(x, Math.round(S / 2 + r * 0.5))) p.set(x, Math.round(S / 2 + r * 0.5), alpha(GHOST[1], 0.8));
  c = p.canvas();
  echoSegs.set(r, c);
  return c;
}

registerZonePainter('f15b_echobody', (g, z, px, py, S, time) => {
  const s = paintSim();
  const v = f15bView(s);
  const m = s?.mobs.find((x) => x.id === (z as ZoneX).mob);
  if (!v || !m || m.mode === 'f15e_rise') return true;
  const fade = m.mode === 'dying' ? Math.max(0, 1 - m.t / 0.6) : 1;
  const tr = v.trail;
  const n = Math.min(22, Math.floor(tr.length / 2));
  g.globalAlpha = fade;
  for (let i = n - 1; i >= 2; i--) {
    const x = tr[i * 2];
    const y = tr[i * 2 + 1];
    const k = i / 22;
    const r = Math.max(2, Math.round(6.5 - k * 4.5));
    const wob = Math.sin(time * 5 - i * 0.5) * 0.6;
    const img = echoSeg(r);
    g.drawImage(img, Math.round(px + (x - z.x) * S - img.width / 2 + wob), Math.round(py + (y - z.y) * S - img.height / 2 - r * 0.6));
  }
  g.globalAlpha = 1;
  return true;
});

/** Четверть просыпается: клетки четверти мерцают цветом памяти. */
const QUAD_COL: RGBA[] = [hx('#ff6a20'), hx('#30d0d8'), hx('#c8dcff'), hx('#70f080')];
const cellSets = new WeakMap<number[], Set<number>>();
registerZonePainter('f15b_qwarn', (g, z, px, py, S, time) => {
  const zz = z as ZoneX & Zone;
  const s = paintSim();
  if (!s || !zz.cells) return true;
  const W = s.world.w;
  const col = QUAD_COL[zz.q ?? 0];
  const left = zz.life - zz.t;
  // Мерцание сильнее к моменту перемены; обводка — форма будущего пятна.
  const k = Math.max(0, Math.min(1, 1 - left / 1.6));
  if (k <= 0) return true;
  let set = cellSets.get(zz.cells);
  if (!set) {
    set = new Set(zz.cells);
    cellSets.set(zz.cells, set);
  }
  const on = Math.sin(time * (8 + k * 14)) > 0;
  g.fillStyle = rgba(col, 0.05 + k * 0.14 + (on ? 0.05 : 0));
  const edge = rgba(col, 0.35 + k * 0.55);
  for (const i of zz.cells) {
    const x = Math.round(px + ((i % W) - zz.x) * S);
    const y = Math.round(py + (Math.floor(i / W) - zz.y) * S);
    g.fillRect(x, y, S, S);
  }
  g.fillStyle = edge;
  const w = Math.max(1, Math.round(S / 8));
  for (const i of zz.cells) {
    const x = Math.round(px + ((i % W) - zz.x) * S);
    const y = Math.round(py + (Math.floor(i / W) - zz.y) * S);
    if (!set.has(i - 1)) g.fillRect(x, y, w, S);
    if (!set.has(i + 1)) g.fillRect(x + S - w, y, w, S);
    if (!set.has(i - W)) g.fillRect(x, y, S, w);
    if (!set.has(i + W)) g.fillRect(x, y + S - w, S, w);
  }
  return true;
});

/** Стена вот-вот сожмётся: плоть вспухает над клетками кольца. */
registerZonePainter('f15b_swellwarn', (g, z, px, py, S, time) => {
  const zz = z as ZoneX & Zone;
  const s = paintSim();
  if (!s || !zz.cells) return true;
  const W = s.world.w;
  const k = Math.min(1, zz.t / Math.max(0.1, zz.life - 0.2));
  const pulse = 0.5 + 0.5 * Math.sin(time * (6 + k * 10));
  for (const i of zz.cells) {
    const x = Math.round(px + ((i % W) - zz.x) * S);
    const y = Math.round(py + (Math.floor(i / W) - zz.y) * S);
    g.fillStyle = rgba(hx('#8a1a2a'), 0.25 + 0.4 * k * pulse);
    g.fillRect(x + 1, y + 1, S - 2, S - 2);
    g.fillStyle = rgba(hx('#ff5060'), 0.3 + 0.5 * k);
    g.fillRect(x + 3, y + 3, 2, 2);
    g.fillRect(x + S - 5, y + S - 6, 2, 2);
  }
  return true;
});

/** Водоворот: закрученные дуги вокруг омута. */
registerZonePainter('f15b_swirl', (g, z, px, py, S, time) => {
  const R = z.r * S;
  const zz = z as Zone;
  const k = Math.min(1, zz.t / 0.95);
  g.strokeStyle = rgba(hx('#70e0f0'), 0.25 + 0.5 * k);
  for (let i = 0; i < 4; i++) {
    const a0 = -time * (3 + k * 3) + (i / 4) * TAU;
    g.beginPath();
    g.arc(px, py, R * (0.35 + i * 0.17), a0, a0 + 1.6);
    g.stroke();
  }
  return true;
});

/** Вспышка круга-телепорта. */
registerZonePainter('f15b_warp', (g, z, px, py, S, time) => {
  const zz = z as Zone;
  const k = Math.min(1, zz.t / 0.55);
  const R = zz.r * S;
  g.fillStyle = rgba(hx('#b0ffc8'), 0.2 + 0.5 * k);
  g.beginPath();
  g.arc(px, py, R * (1.2 - k * 0.6), 0, TAU);
  g.fill();
  g.strokeStyle = rgba(WHITE, 0.6 + 0.4 * Math.sin(time * 30));
  g.beginPath();
  g.arc(px, py, R * (0.4 + k * 0.8), 0, TAU);
  g.stroke();
  return true;
});

/**
 * Пульс по венам арены: на каждый удар сердца по веерным венам и двум
 * стволам горловины бежит волна света — по тем же кривым, что на полу.
 */
const veinLen = new WeakMap<object, number[]>();
function veinEnds(s: Sim): number[] {
  const hit = veinLen.get(s.world);
  if (hit) return hit;
  const top = heartTop();
  const out = VEINS.map((v) => {
    let d = 4;
    for (; d < 17; d += 0.1) {
      const [x, y] = veinPoint(v.i, d);
      if (y > 44.5) break;
      const t = s.tiles[Math.floor(y + top) * s.world.w + Math.floor(x)];
      if (t !== 2 && t !== 12 && t !== 11) break;
    }
    return d;
  });
  veinLen.set(s.world, out);
  return out;
}

registerZonePainter('f15b_veins', (g, z, px, py, S) => {
  const s = paintSim();
  const v = f15bView(s);
  const b = s?.boss;
  if (!s || !v || !b || b.state !== 'fight') return true;
  const k = beatK(v, s.time);
  if (k >= 1) return true;
  const front = 3.8 + k * 16;
  const ends = veinEnds(s);
  const top = heartTop();
  const put = (x: number, y: number, e: number, w: number) => {
    const sx = Math.round(px + (x - z.x) * S);
    const sy = Math.round(py + (y + top - z.y) * S);
    g.fillStyle = rgba(VEIN_HOT, 0.22 * e);
    g.fillRect(sx - w, sy - w, w * 2, w * 2);
    g.fillStyle = rgba(VEIN_CORE, 0.75 * e);
    g.fillRect(sx - 1, sy - 1, 2, 2);
  };
  const fade = 1 - k * 0.55;
  for (let i = 0; i < VEINS.length; i++)
    for (let d = front - 1.6; d <= front; d += 0.14) {
      if (d < 3.8 || d > ends[i]) continue;
      const e = ((d - front + 1.6) / 1.6) * fade;
      const [x, y] = veinPoint(i, d);
      put(x, y, e, 3);
    }
  // Стволы горловины: волна идёт дальше вниз, к стыку.
  for (let d = front - 1.6; d <= front; d += 0.14) {
    const y = TRUNK.y0 + (d - 10.2);
    if (y < TRUNK.y0 || y > TRUNK.y1) continue;
    const e = ((d - front + 1.6) / 1.6) * fade;
    for (const side of [-1, 1] as const) put(trunkX(y, side), y, e, 3);
  }
  return true;
});

// ---------------------------------------------------------------------------
// Снаряды.
// ---------------------------------------------------------------------------

const shots = new Map<string, Sprite>();
function shotSprite(key: string, make: () => { p: Px; ax: number; ay: number }): Sprite {
  let s = shots.get(key);
  if (!s) {
    const m = make();
    s = { img: m.p.canvas(), ax: m.ax, ay: m.ay };
    shots.set(key, s);
  }
  return s;
}

/** Каменное перо: поворот по полёту — 8 направлений. */
registerShotPainter('f15b_feather', (s) => {
  const a = Math.atan2(s.vy, s.vx);
  const d = ((Math.round((a / TAU) * 8) % 8) + 8) % 8;
  return shotSprite(`feather|${d}`, () => {
    const p = new Px(14, 14);
    const aa = (d / 8) * TAU;
    const ux = Math.cos(aa);
    const uy = Math.sin(aa);
    // Стержень и опахало: камень с тлеющим кончиком.
    for (let t = -5; t <= 5; t++) {
      const x = 7 + ux * t;
      const y = 7 + uy * t;
      p.set(Math.round(x), Math.round(y), t > 3 ? EMBER_HI : STONE_HI);
      const w = t > -4 && t < 4 ? 1.6 - Math.abs(t) * 0.2 : 0;
      if (w > 0) {
        p.set(Math.round(x - uy * w), Math.round(y + ux * w), STONE[2]);
        p.set(Math.round(x + uy * w), Math.round(y - ux * w), STONE[1]);
      }
    }
    p.outline(INK);
    return { p, ax: 7, ay: 7 };
  });
});

registerShotPainter('f15b_fireball', (s, time) => {
  const f = Math.floor(time * 12) % 3;
  return shotSprite(`fireball|${f}`, () => {
    const p = new Px(12, 12);
    p.ell(6, 6, 4.2 + f * 0.3, 4.2, hx('#c83a0a'));
    p.ell(6, 5.5, 2.8, 2.6, hx('#ff9a2a'));
    p.ell(5.5, 5, 1.4, 1.2, hx('#fff0a0'));
    for (let i = 0; i < 4; i++) p.set(Math.round(6 + Math.cos(i * 1.7 + f) * 5), Math.round(6 + Math.sin(i * 1.7 + f) * 5), alpha(GHOSTC, 0.8));
    return { p, ax: 6, ay: 6 };
  });
});

registerShotPainter('f15b_ice', (s) => {
  const a = Math.atan2(s.vy, s.vx);
  const d = ((Math.round((a / TAU) * 8) % 8) + 8) % 8;
  return shotSprite(`ice|${d}`, () => {
    const p = new Px(12, 12);
    const aa = (d / 8) * TAU;
    poly(p, [
      [6 + Math.cos(aa) * 5, 6 + Math.sin(aa) * 5],
      [6 + Math.cos(aa + 2.4) * 2.4, 6 + Math.sin(aa + 2.4) * 2.4],
      [6 - Math.cos(aa) * 3, 6 - Math.sin(aa) * 3],
      [6 + Math.cos(aa - 2.4) * 2.4, 6 + Math.sin(aa - 2.4) * 2.4],
    ], (x, y) => ((x + y) % 3 === 0 ? hx('#ffffff') : hx('#90e0ff')));
    p.outline(hx('#10304a'));
    return { p, ax: 6, ay: 6 };
  });
});

// ---------------------------------------------------------------------------
// Иконки вещей 10×10.
// ---------------------------------------------------------------------------

registerItemArt('f15b_ichor', () => {
  const p = new Px(10, 10);
  // Флакон с тёмно-алой светящейся жижей.
  p.rect(4, 1, 5, 2, BONE[2]);
  p.ell(4.5, 6, 3.4, 3.2, hx('#5a0a14'));
  p.ell(4.5, 6.5, 2.4, 2.2, hx('#c01c30'));
  p.set(3, 5, hx('#ff9a8a'));
  p.outline(INK);
  return p;
});

registerItemArt('f15b_echo', () => {
  const p = new Px(10, 10);
  // Осколок эха: призрачный кристалл.
  poly(p, [
    [5, 0.5],
    [8.5, 4],
    [6, 9.5],
    [2, 6],
  ], (x, y) => GHOST[Math.max(1, Math.min(5, 5 - Math.floor((x + y) / 3.4)))]);
  p.set(4, 3, WHITE);
  p.outline(hx('#0a0820'));
  return p;
});

registerItemArt('f15b_plume', () => {
  const p = new Px(10, 10);
  // Каменное перо с тлеющим стержнем.
  for (let t = 0; t < 9; t++) {
    const x = 1 + t * 0.9;
    const y = 8.5 - t * 0.9;
    p.set(Math.round(x), Math.round(y), t > 6 ? EMBER : STONE_HI);
    if (t > 1 && t < 8) {
      p.set(Math.round(x - 1), Math.round(y - 1), STONE[2]);
      p.set(Math.round(x + 1), Math.round(y + 1), STONE[1]);
    }
  }
  p.outline(INK);
  return p;
});

registerItemArt('f15mat', () => {
  const p = new Px(10, 10);
  // Сердце подземелья: каменное сердце с горячим швом.
  p.ell(3.5, 4, 2.6, 2.4, HEARTF[2]);
  p.ell(6.5, 4, 2.6, 2.4, HEARTF[1]);
  poly(p, [
    [1, 5],
    [9, 5],
    [5, 9.5],
  ], HEARTF[1]);
  p.set(3, 3, HEARTF[3]);
  stroke(p, 5, 2.5, 5, 8, EMBER, 1);
  p.set(5, 5, EMBER_HI);
  p.outline(INK);
  return p;
});

void [spline, vnoise];
