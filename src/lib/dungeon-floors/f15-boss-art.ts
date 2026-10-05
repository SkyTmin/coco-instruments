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
  frameLRU,
  MOB_PAINTERS,
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
import { F15_HEART, F15B_MARK } from './f15-boss';
import { beatK, f15bView, HEART, LION } from './f15-boss-brains';
import { drawSerpentBody } from './f6-art';

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
export const alpha = (c: RGBA, a: number): RGBA => [c[0], c[1], c[2], Math.round(Math.max(0, Math.min(1, a)) * 255)];

export const INK = hx('#150a0b');
export const WHITE = hx('#ffffff');
export const TAU = Math.PI * 2;
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

/**
 * Многоугольник заливкой (v2.87 — построчно: прежняя проверка «точка внутри»
 * на каждый пиксель съедала половину кадра льва на перепонках крыльев).
 * Правило то же: пиксель внутри, если его центр внутри (чёт-нечет).
 */
const polyXs: number[] = [];
export function poly(p: Px, pts: [number, number][], c: RGBA | ((x: number, y: number) => RGBA)): void {
  const n = pts.length;
  if (n < 3) return;
  let minY = 1e9;
  let maxY = -1e9;
  for (const [, y] of pts) {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const fn = typeof c === 'function' ? c : null;
  const xs = polyXs;
  for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(p.h - 1, Math.ceil(maxY)); y++) {
    const py = y + 0.5;
    xs.length = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const yi = pts[i][1];
      const yj = pts[j][1];
      if (yi > py !== yj > py) xs.push(((pts[j][0] - pts[i][0]) * (py - yi)) / (yj - yi) + pts[i][0]);
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.ceil(xs[k] - 0.5));
      const x1 = Math.min(p.w - 1, Math.ceil(xs[k + 1] - 0.5) - 1);
      for (let x = x0; x <= x1; x++) p.set(x, y, fn ? fn(x, y) : (c as RGBA));
    }
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
export function stroke(p: Px, x0: number, y0: number, x1: number, y1: number, c: RGBA, w = 1): void {
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
export const hash = (a: number, b: number, c = 0) => {
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
export const STONE = tn('#1c1715', '#3a312c', '#5e524a', '#8e7f72');
export const STONE_HI = hx('#b8a898');
const BONE = tn('#4a3e30', '#8a7a62', '#c4b494', '#efe4c8');
const VEIN_D = hx('#5a0a12');
const VEIN = hx('#b0182a');
export const VEIN_HOT = hx('#ff4a3a');
export const VEIN_CORE = hx('#ffb08a');
const EMBER = hx('#ff6a2a');
export const EMBER_HI = hx('#ffd080');
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
export function heartTop(): number {
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
export const VEINS = Array.from({ length: 10 }, (_, i) => ({
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

/**
 * Стык с «Миром»: ниже этого ряда плоть наползает на камень — чем ближе к
 * краю района, тем реже; сквозь просветы виден пол движка (камень).
 */
const CREEP_Y0 = 70.5;
const CREEP_Y1 = 77.8;
/** Покрыта ли точка плотью у стыка: 1 — да, 0 — камень, 0,5 — кромка. */
function creep(X: number, Y: number, top: number): number {
  const ly = Y / 16 - top;
  if (ly < CREEP_Y0) return 1;
  const cov = (CREEP_Y1 - ly) / (CREEP_Y1 - CREEP_Y0);
  const n = vn(X / 6, Y / 6, 90) * 0.75 + vn(X / 2.5, Y / 2.5, 91) * 0.25;
  return n < cov * 1.05 - 0.07 ? 1 : n < cov * 1.05 ? 0.5 : 0;
}

function fleshCell(c: CellCtx, dim = 0, bare = false): Px {
  const p = new Px(16, 16);
  const ox = c.wx * 16;
  const oy = c.wy * 16;
  const top = heartTop();
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const X = ox + x;
      const Y = oy + y;
      const k = creep(X, Y, top);
      if (k === 1) p.set(x, y, floorPx(X, Y, dim, bare, top));
      else {
        // На камне остаются только вены — корни плоти.
        const t = tubeAt(X / 16, Y / 16 - top);
        if (t && Math.abs(t.s) <= 1) p.set(x, y, ramp(VR, 0.9 + tubeShade(t) * 4.2, X, Y));
        else if (k === 0.5) p.set(x, y, FR[1]);
      }
    }
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
  const p = fleshCell(c, 0.5, true);
  const ox = c.wx * 16;
  const oy = c.wy * 16;
  const CH = hx('#1e0e0c');
  const isScorch = (m: number) => m === MK.scorch;
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const X = ox + x;
      const Y = oy + y;
      const s = regionS(c, x, y, isScorch) + wob(X, Y, 76);
      if (s < 1) continue;
      glowPx(p, x, y, CH, Math.min(0.62, 0.2 + s * 0.06) + (vn(X / 5, Y / 5, 13) - 0.5) * 0.2);
      if (LAT[((Y & 255) << 8) | (X & 255)] < 0.012) p.set(x, y, EMBER);
    }
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
    const topF = heartTop();
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const X = ox + x;
        const Y = oy + y;
        if (creep(X, Y, topF) === 0) continue;
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
  const top = heartTop();
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const X = ox + x;
      const Y = oy + y;
      if (creep(X, Y, top) === 0) continue;
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
    const p = new Px(26, 46);
    const flip = o.x < 32;
    // Гнездо: кость вросла в плоть — тёмный бугор с жилами.
    mell(p, 12, 42, 6.5, 3.2, M_FLESH, -0.1);
    const pts = spline([
      [12, 43],
      [11, 31],
      [13, 17],
      [18, 8],
      [22, 5],
    ], 7);
    for (let i = 0; i < pts.length - 1; i++) {
      const k = i / pts.length;
      mlimb(p, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 3 - k * 2, 2.9 - k * 2, M_BONE, 0.05);
    }
    // Жилы, приросшие к кости снизу.
    for (const dx of [-2, 2]) {
      const q = spline([
        [12 + dx * 1.6, 43],
        [12 + dx * 0.8, 38],
        [12 + dx * 0.3, 32],
      ], 4);
      for (let i = 0; i < q.length - 1; i++) mlimb(p, q[i][0], q[i][1], q[i + 1][0], q[i + 1][1], 1, 0.7, M_FLESH, 0.1);
    }
    p.outline(INK);
    return { p: flip ? p.flipX() : p, ax: 12, ay: 44 };
  }),
);

/** Сухожилие-столб: жгут от пола к своду, натянут, дышит. */
registerPropPainter('f15b_tendon', (o, time) => {
  const f = frameAt(time + o.x * 0.13, 1.8, 4);
  return sprite(`tendon|${f}`, () => {
    const p = new Px(22, 50);
    const w = [0, 0.5, 1, 0.5][f];
    // Раструбы у пола и у свода.
    mell(p, 11, 45, 7, 3.4, M_FLESH, -0.05);
    mell(p, 11, 5, 6, 3, M_FLESH, -0.2);
    // Жгут: тоньше к середине, волокна вдоль.
    for (let i = 0; i < 10; i++) {
      const y0 = 6 + i * 4;
      const y1 = y0 + 4;
      const r = (y: number) => 2.6 + Math.abs(y - 25) * 0.11 + w * 0.5 * (1 - Math.abs(y - 25) / 20);
      mlimb(p, 11, y0, 11, y1, r(y0), r(y1), M_FLESH, 0.18);
    }
    // Сухожильные нити — светлые, вдоль.
    for (const dx of [-1, 1]) for (let y = 8; y < 43; y++) if ((y + dx * 3) % 7 < 4) glowPx(p, 11 + dx + Math.round(Math.sin(y * 0.2) * 0.5), y, SINEW[3], 0.35);
    p.outline(INK);
    return { p, ax: 11, ay: 48 };
  });
});

/** Пузырь-нарыв: плёнка, внутри светится жижа (бьётся — в нём ихор). */
const PUS = rampOf('#4a2010', '#8a4a18', '#c08030', '#e8b850', '#f8e08a', '#fff6d0');
registerPropPainter('f15b_pustule', (o, time, _alive, flash) => {
  const f = frameAt(time + o.x * 0.37 + o.y * 0.11, 2.2, 4);
  return sprite(`pus|${f}|${flash ? 1 : 0}`, () => {
    let p = new Px(20, 20);
    const s = [0, 0.4, 0.8, 0.4][f];
    const cx = 10;
    const cy = 11 - s * 0.5;
    const rx = 6 + s * 0.4;
    const ry = 5.4 + s * 0.6;
    // Воспалённое основание.
    mell(p, cx, cy + 4, rx + 2, 3, M_FLESH, 0.05);
    // Мешок: жёлтая жижа сквозь плёнку, снизу гуще.
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        const q = dx * dx + dy * dy;
        if (q > 1) continue;
        const nz = Math.sqrt(1 - q);
        const l = dx * LX + dy * LY + nz * LZ;
        let c = ramp(PUS, 1 + l * 2.6 + (dy > 0.3 ? -0.6 : 0), x, y);
        if (q > 0.72) c = mixc(c, hx('#a0303a'), 0.55);
        p.set(x, y, c);
      }
    // Жилки по плёнке и блик.
    for (const [a, b2, c2, d] of [
      [cx - 4, cy + 3, cx - 2, cy - 3],
      [cx + 2, cy + 4, cx + 4, cy - 1],
      [cx - 1, cy + 4, cx, cy],
    ])
      stroke(p, a, b2, c2, d, alpha(hx('#a0202c'), 0.8), 1);
    p.set(cx - 3, cy - 3, WHITE);
    p.set(cx - 2, cy - 3, alpha(WHITE, 0.7));
    p.set(cx - 3, cy - 2, alpha(WHITE, 0.5));
    p.outline(INK);
    if (flash) p = p.tint(WHITE, 0.8);
    return { p, ax: 10, ay: 18 };
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
    const p = new Px(22, 14);
    const sw = [1, 0.6, 0.25, 0][f];
    // Нервы: пять тяжей, изогнуты.
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + 0.5;
      const q = spline([
        [11 + Math.cos(a) * 3, 7 + Math.sin(a) * 2],
        [11 + Math.cos(a + 0.3) * 6, 7 + Math.sin(a + 0.3) * 3.6],
        [11 + Math.cos(a + 0.5) * 9.5, 7 + Math.sin(a + 0.5) * 5.5],
      ], 4);
      for (let j = 0; j < q.length - 1; j++) mlimb(p, q[j][0], q[j][1], q[j + 1][0], q[j + 1][1], 1.1, 0.6, M_FLESH, 0.15 + sw * 0.3);
    }
    // Узел: вздутие, внутри свет.
    mell(p, 11, 7, 4.2 + sw * 0.5, 3.2 + sw * 0.4, M_FLESH, 0.2);
    p.ell(11, 6.6, 2 + sw * 0.8, 1.3 + sw * 0.5, [VEIN_CORE, VEIN_HOT, VEIN, VEIN_D][f]);
    if (f === 0) p.set(10, 6, WHITE);
    p.outline(INK);
    return { p, ax: 11, ay: 12 };
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

/** Губы клапана у ворот: мясистый валик со складкой, мокрый. */
registerPropPainter('f15b_lip', (o) =>
  sprite(`lip|${o.x < 32 ? 1 : 0}`, () => {
    const p = new Px(18, 26);
    mell(p, 9, 15, 7.5, 10, M_FLESH, 0.12);
    mell(p, 11, 16, 4.5, 8, M_FLESH, -0.12);
    // Складка и блик.
    for (let y = 8; y < 24; y++) p.set(Math.round(12 + Math.sin(y * 0.3) * 0.8), y, INK);
    for (let y = 9; y < 14; y++) p.set(6, y, alpha(SPEC, 0.7));
    p.outline(INK);
    return { p: o.x < 32 ? p : p.flipX(), ax: 9, ay: 25 };
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
// Материалы Хозяина (их же берут предметы арены: рёбра, сухожилия, узлы).
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
const M_MEMB = mat('memb', 48, '#2a0712', '#4a0c1c', '#6e1628', '#962438', '#bc3c4a', '#e0685e');
const M_MEMB_FAR = mat('memb', 49, '#14030a', '#26060f', '#3a0b17', '#521220', '#6a1a2a');
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

/** Точка квадратичной кривой. */
const qb = (a: [number, number], c: [number, number], b: [number, number], t: number): [number, number] => [
  (1 - t) * (1 - t) * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0],
  (1 - t) * (1 - t) * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1],
];


// ---------------------------------------------------------------------------
// v2.87 — Хозяин подземелья: тело. Движок анимаций (библия §14).
//
// Облик прежний (каменные плиты на плоти, грива с тлеющими кончиками,
// хвост-змея, крылья летучей мыши, золотые угли глаз) — меняется движение.
// Поза — риг из чисел (`LRig`): присед, дыбы, перенос веса, голова, пасть,
// грива, хвост, ступни лап (ноги — обратной кинематикой: стоящая лапа не
// скользит, тело ходит над ней), крылья, грудь, окаменение и ход всего тела
// (сдвиг, сжатие, наклон — полями кадра). Техника — дорожка ключей по
// времени режима мозга на 24 к/с: подготовка → удар со следом → проводка →
// возврат; кадр контакта — ровно в миг урона. Покой и бег — от времени
// рендера и пройденного пути. Всё, что светится (глаза, щели плит, сердце в
// груди, тлеющая грива, пасть, когти на ударе, жилы крыльев), — слоем
// `lit`: он поверх темноты и разгорается с фазой и в такт сердцу готовыми
// слоями, без перерисовки кадра. Кадры — `frameLRU`, прогрев —
// `registerMobWarm`. Левый взгляд — зеркалом кадра (`sx < 0`), без копии.
// ---------------------------------------------------------------------------

type P2 = [number, number];
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const clampN = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
/** Доля пути t между a и b, 0…1. */
const seg = (t: number, a: number, b: number) => clamp01((t - a) / (b - a || 1e-6));
const rotV = (v: P2, a: number): P2 => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c];
};

type Ease = (x: number) => number;
const eLin: Ease = (x) => x;
const eIn: Ease = (x) => x * x;
const eIn3: Ease = (x) => x * x * x;
const eOut: Ease = (x) => 1 - (1 - x) * (1 - x);
const eOut3: Ease = (x) => 1 - (1 - x) * (1 - x) * (1 - x);
const eIO: Ease = (x) => (x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) * (1 - x));
const eIO3: Ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - 4 * (1 - x) * (1 - x) * (1 - x));

const FPS = 24;

// --- Риг.

interface LRig {
  /** Присед 0…1 (меньше нуля — выпрямился, оттолкнулся). */
  cr: number;
  /** Дыбы: плечи вверх (минус — плечи к земле, голова вниз). */
  rear: number;
  /** Вес вперёд-назад и подъём туловища над лапами, px. */
  bx: number;
  by: number;
  /** Вдох: грудь и бока шире. */
  br: number;
  /** Голова: наклон (минус — вверх), сдвиг, пасть. */
  hd: number;
  hx: number;
  hy: number;
  jaw: number;
  /** Грива дыбом 0…1 и качание (запаздывает). */
  mane: number;
  msw: number;
  /** Хвост: размах, подъём; голова змеи — бросок. */
  tail: number;
  tup: number;
  snk: number;
  /** Ступни (сдвиг от места в стойке, px) и угол стопы; когти наружу. */
  fnx: number;
  fny: number;
  fna: number;
  cl: number;
  ffx: number;
  ffy: number;
  ffa: number;
  hnx: number;
  hny: number;
  hfx: number;
  hfy: number;
  hna: number;
  /** Крылья (бок: ближнее/дальнее; анфас: левое/правое): раскрытие, подъём, мах вперёд, длина. */
  wo: number;
  wa: number;
  wsw: number;
  wo2: number;
  wa2: number;
  wsw2: number;
  wl: number;
  /** Блеск когтей (звезда на кончиках, 0…1). */
  gl: number;
  /** Глаза горят сильнее, веки. */
  eye: number;
  bl: number;
  /** Анфас: грудь вскрыта, сердце на месте, лапы (сдвиг), голову трясёт. */
  ch: number;
  hrt: number;
  plx: number;
  ply: number;
  prx: number;
  pry: number;
  shk: number;
  /** Окаменение 0…1 (от лап и крыльев к груди и голове). */
  st: number;
  /** Анфас: лев ниже в кадре, px (пробуждение — шаг вперёд из кокона). */
  ly: number;
  /** Ход всего тела — полями кадра. */
  tdx: number;
  tdy: number;
  tsx: number;
  tsy: number;
  trot: number;
}

const R0: LRig = {
  cr: 0,
  rear: 0,
  bx: 0,
  by: 0,
  br: 0,
  hd: 0,
  hx: 0,
  hy: 0,
  jaw: 0,
  mane: 0,
  msw: 0,
  tail: 0,
  tup: 0,
  snk: 0,
  fnx: 0,
  fny: 0,
  fna: 0,
  cl: 0,
  ffx: 0,
  ffy: 0,
  ffa: 0,
  hnx: 0,
  hny: 0,
  hfx: 0,
  hfy: 0,
  hna: 0,
  wo: 0,
  wa: 0,
  wsw: 0,
  wo2: 0,
  wa2: 0,
  wsw2: 0,
  wl: 1,
  gl: 0,
  eye: 0,
  bl: 0,
  ch: 0,
  hrt: 1,
  plx: 0,
  ply: 0,
  prx: 0,
  pry: 0,
  shk: 0,
  st: 0,
  ly: 0,
  tdx: 0,
  tdy: 0,
  tsx: 1,
  tsy: 1,
  trot: 0,
};
type RKey = keyof LRig;
const RKEYS = Object.keys(R0) as RKey[];

/** Крылья на земле (с «КРЫЛЬЕВ»): сложены вдоль спины. */
const WFOLD: Partial<LRig> = { wo: 0.12, wa: -0.2, wsw: 0, wo2: 0.1, wa2: -0.1, wsw2: 0, wl: 0.66 };

/** Ключ дорожки: время (с), каналы, кривая подхода к ключу. */
type LKey = [number, Partial<LRig>, Ease?];

/** Опоздания частей (с): голова, грива, хвост — доигрывают после тела. */
const LLAG: Partial<Record<RKey, number>> = {
  hd: 0.03,
  hx: 0.03,
  hy: 0.03,
  jaw: 0.02,
  mane: 0.05,
  msw: 0.08,
  tail: 0.1,
  tup: 0.08,
  snk: 0.14,
};

function ltrack(keys: LKey[], t: number, base: LRig, lag: Partial<Record<RKey, number>> = LLAG): LRig {
  const out = { ...base };
  for (const ch of RKEYS) {
    const tt = lag[ch] ? Math.max(0, t - lag[ch]!) : t;
    let t0 = 0;
    let v0 = base[ch];
    let t1 = -1;
    let v1 = 0;
    let e: Ease = eIO;
    for (const [kt, kv, ke] of keys) {
      const v = kv[ch];
      if (v === undefined) continue;
      if (kt <= tt) {
        t0 = kt;
        v0 = v;
      } else {
        t1 = kt;
        v1 = v;
        e = ke ?? eIO;
        break;
      }
    }
    out[ch] = t1 < 0 ? v0 : v0 + (v1 - v0) * e(clamp01((tt - t0) / (t1 - t0 || 1)));
  }
  return out;
}

const RW = (w: boolean, o: Partial<LRig> = {}): LRig => ({ ...R0, ...(w ? WFOLD : {}), ...o });
const mixRig = (a: LRig, b: LRig, k: number): LRig => {
  const o = { ...a };
  for (const ch of RKEYS) o[ch] = a[ch] + (b[ch] - a[ch]) * k;
  return o;
};

// --- Рисование частей: фактура в осях ЧАСТИ (камень не «кипит», когда
// часть едет), свет кадра — в слой `LIT`.

/** Слой света кадра, пока он рисуется (null — нет). */
let LIT: Px | null = null;
/** Всё, что рисуется сейчас, светится (пасть, тлеющие кончики). */
let LITALL = false;

function litCopy(p: Px, x: number, y: number): void {
  if (!LIT || x < 0 || y < 0 || x >= p.w || y >= p.h) return;
  const i = (y * p.w + x) * 4;
  LIT.data[i] = p.data[i];
  LIT.data[i + 1] = p.data[i + 1];
  LIT.data[i + 2] = p.data[i + 2];
  LIT.data[i + 3] = p.data[i + 3];
}
/** Светящийся пиксель: в кадр и в слой света тем же цветом. */
function glowSet(p: Px, x: number, y: number, c: RGBA): void {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || y < 0 || x >= p.w || y >= p.h) return;
  p.set(x, y, c);
  litCopy(p, x, y);
}
/** Подмешать свет к пикселю (и в слой света). */
function glowMix(p: Px, x: number, y: number, c: RGBA, k: number): void {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || y < 0 || x >= p.w || y >= p.h) return;
  glowPx(p, x, y, c, k);
  litCopy(p, x, y);
}
/** Ореол только в слое света (вокруг глаза, над пастью) — в кадре его нет. */
function haloSet(x: number, y: number, c: RGBA): void {
  if (!LIT) return;
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || y < 0 || x >= LIT.w || y >= LIT.h) return;
  const i = (y * LIT.w + x) * 4;
  if (LIT.data[i + 3] >= c[3]) return;
  LIT.data[i] = c[0];
  LIT.data[i + 1] = c[1];
  LIT.data[i + 2] = c[2];
  LIT.data[i + 3] = c[3];
}

/** Холсты-черновики кадра: один на слот, чистятся, а не выделяются заново. */
const SCRATCH = new Map<string, Px>();
function scratch(slot: string, w: number, h: number): Px {
  let p = SCRATCH.get(slot);
  if (!p || p.w !== w || p.h !== h) {
    p = new Px(w, h);
    SCRATCH.set(slot, p);
  } else p.data.fill(0);
  return p;
}

/** Быстрая запись непрозрачного цвета. */
function put(p: Px, x: number, y: number, c: RGBA): void {
  if (x < 0 || y < 0 || x >= p.w || y >= p.h) return;
  const i = (y * p.w + x) * 4;
  const d = p.data;
  d[i] = c[0];
  d[i + 1] = c[1];
  d[i + 2] = c[2];
  d[i + 3] = 255;
  if (LITALL && LIT) {
    const L = LIT.data;
    L[i] = c[0];
    L[i + 1] = c[1];
    L[i + 2] = c[2];
    L[i + 3] = 255;
  }
}

/**
 * Фактура материала — заранее посчитанной таблицей 128×128 на материал:
 * шум по решётке на каждый пиксель кадра съедал треть времени кадра.
 * Изотропные (камень, кость, перепонка, чешуя) — по целым (u, v) части,
 * волокна (плоть, грива) — поперёк (¼ пикселя) и вдоль (½ пикселя).
 */
const TEX = new Map<Mat, Float32Array>();
function texTable(m: Mat): Float32Array {
  let t = TEX.get(m);
  if (t) return t;
  t = new Float32Array(128 * 128);
  for (let b = 0; b < 128; b++)
    for (let a = 0; a < 128; a++) {
      const fib = m.tex === 'flesh' || m.tex === 'mane';
      t[b * 128 + a] = fib ? rtexRaw(m, 0, 0, b / 2, (a - 64) / 4) : rtexRaw(m, a - 64, b - 64, 0, 0);
    }
  TEX.set(m, t);
  return t;
}
function rtex(m: Mat, u: number, v: number, along: number, lat: number): number {
  const t = TEX.get(m) ?? texTable(m);
  if (m.tex === 'flesh' || m.tex === 'mane') {
    const a = Math.round(lat * 4) + 64;
    return t[((Math.round(along * 2) & 127) << 7) | (a < 0 ? 0 : a > 127 ? 127 : a)];
  }
  return t[(((v + 64) & 127) << 7) | ((u + 64) & 127)];
}
/** Фактура без таблицы (её считает таблица). */
function rtexRaw(m: Mat, u: number, v: number, along: number, lat: number): number {
  switch (m.tex) {
    case 'stone': {
      let t = (vn(u / 3.2 + 40, v / 3.2 + 40, m.seed) - 0.5) * 1.1;
      const h = LAT[((((v + 300) * 7 + m.seed) & 255) << 8) | (((u + 300) * 3 + m.seed) & 255)];
      if (h < 0.035) t -= 1.4;
      else if (h > 0.975) t += 0.9;
      return t;
    }
    case 'flesh':
      return (vn(lat * 1.5 + m.seed, along / 6, m.seed) - 0.5) * 1.7;
    case 'mane':
      return (vn(lat * 1.3 + m.seed, along / 3.5, m.seed) - 0.5) * 1.6;
    case 'bone':
      return (vn(u / 4 + 40, v / 4 + 40, m.seed) - 0.5) * 0.5;
    case 'memb':
      return (vn(u / 5 + 40, v / 7 + 40, m.seed) - 0.5) * 0.9;
    case 'scale':
      return ((u + 300 + (((v + 300) >> 1) & 1) * 2) % 4 === 0 || (v + 300) % 3 === 0 ? -0.9 : 0.15) + (vn(u / 3 + 40, v / 3 + 40, m.seed) - 0.5) * 0.4;
  }
}

function rpx(m: Mat, l: number, ny: number, x: number, y: number, u: number, v: number, along: number, lat: number, bias: number): RGBA {
  const n = m.r.length;
  const idx = 0.2 + (l * 0.45 + 0.33 + bias) * (n - 1) + rtex(m, u, v, along, lat);
  const c = ramp(m.r, idx, x, y);
  if (ny > 0.5 && rimK > 0) {
    // Подсветка снизу — в общий черновик цвета (put копирует сразу): без выделения на пиксель.
    const k = Math.min(0.5, (ny - 0.5) * 2 * rimK);
    RIMC[0] = Math.round(c[0] + (VEIN_HOT[0] - c[0]) * k);
    RIMC[1] = Math.round(c[1] + (VEIN_HOT[1] - c[1]) * k);
    RIMC[2] = Math.round(c[2] + (VEIN_HOT[2] - c[2]) * k);
    return RIMC;
  }
  return c;
}
const RIMC: RGBA = [0, 0, 0, 255];

/** Капсула рига: фактура вдоль и поперёк части. */
function rlimb(p: Px, x0: number, y0: number, x1: number, y1: number, r0: number, r1: number, m: Mat, bias = 0): void {
  const rm = Math.max(r0, r1);
  const minX = Math.max(0, Math.floor(Math.min(x0, x1) - rm));
  const maxX = Math.min(p.w - 1, Math.ceil(Math.max(x0, x1) + rm));
  const minY = Math.max(0, Math.floor(Math.min(y0, y1) - rm));
  const maxY = Math.min(p.h - 1, Math.ceil(Math.max(y0, y1) + rm));
  const dx = x1 - x0;
  const dy = y1 - y0;
  const L = Math.hypot(dx, dy) || 1e-6;
  const ux = dx / L;
  const uy = dy / L;
  for (let y = minY; y <= maxY; y++) {
    const py = y + 0.5;
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      const t = Math.max(0, Math.min(1, ((px - x0) * ux + (py - y0) * uy) / L));
      const ex = px - (x0 + dx * t);
      const ey = py - (y0 + dy * t);
      const r = r0 + (r1 - r0) * t;
      const d2 = ex * ex + ey * ey;
      if (d2 > r * r) continue;
      const ir = 1 / (r || 1);
      const nx = ex * ir;
      const ny = ey * ir;
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      const lat = ex * -uy + ey * ux;
      const along = t * L;
      put(p, x, y, rpx(m, nx * LX + ny * LY + nz * LZ, ny, x, y, Math.round(lat), Math.round(along), along, lat, bias));
    }
  }
}

/** Овал рига: фактура от его середины. */
function rell(p: Px, cx: number, cy: number, rx: number, ry: number, m: Mat, bias = 0): void {
  if (rx <= 0 || ry <= 0) return;
  const ox = Math.round(cx);
  const oy = Math.round(cy);
  for (let y = Math.max(0, Math.floor(cy - ry)); y <= Math.min(p.h - 1, Math.ceil(cy + ry)); y++)
    for (let x = Math.max(0, Math.floor(cx - rx)); x <= Math.min(p.w - 1, Math.ceil(cx + rx)); x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      const q = dx * dx + dy * dy;
      if (q > 1) continue;
      const nz = Math.sqrt(1 - q);
      put(p, x, y, rpx(m, dx * LX + dy * LY + nz * LZ, dy, x, y, x - ox, y - oy, y - cy, x - cx, bias));
    }
}

/** Плита рига: грань с наклоном и фаской; построчно. */
function rplate(p: Px, pts: P2[], m: Mat, tilt: P2 = [0, 0], bias = 0): void {
  const n = pts.length;
  let minY = 1e9;
  let maxY = -1e9;
  for (const [, y] of pts) {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const ox = Math.round(pts[0][0]);
  const oy = Math.round(pts[0][1]);
  const l0 = tilt[0] * LX + tilt[1] * LY + 0.55 * LZ;
  // Фаска: светлый край сверху-слева, тёмный снизу-справа — по пролётам строк.
  const spans = (py: number): number[] => {
    const xs: number[] = [];
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const yi = pts[i][1];
      const yj = pts[j][1];
      if (yi > py !== yj > py) xs.push(((pts[j][0] - pts[i][0]) * (py - yi)) / (yj - yi) + pts[i][0]);
    }
    return xs.sort((a, b) => a - b);
  };
  const inside = (xs: number[], px: number) => {
    let c = 0;
    for (const v of xs) if (px >= v) c++;
    return (c & 1) === 1;
  };
  for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(p.h - 1, Math.ceil(maxY)); y++) {
    const xs = spans(y + 0.5);
    if (xs.length < 2) continue;
    const up = spans(y - 0.5);
    const dn = spans(y + 1.5);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.ceil(xs[k] - 0.5));
      const x1 = Math.min(p.w - 1, Math.ceil(xs[k + 1] - 0.5) - 1);
      for (let x = x0; x <= x1; x++) {
        let l = l0;
        if (!inside(up, x - 0.5)) l += 0.55;
        else if (!inside(dn, x + 1.5)) l -= 0.6;
        put(p, x, y, rpx(m, l, tilt[1], x, y, x - ox, y - oy, y, x, bias));
      }
    }
  }
}

const u32 = (p: Px) => new Uint32Array(p.data.buffer, p.data.byteOffset, p.w * p.h);

/** Рамка непустого (по словам в 32 бита): [x0, y0, x1, y1] или null. */
function bbox(p: Px, L: Px | null): [number, number, number, number] | null {
  const { w, h } = p;
  const a = u32(p);
  const b = L ? u32(L) : null;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    const r = y * w;
    let lo = -1;
    let hi = -1;
    for (let x = 0; x < w; x++)
      if (a[r + x] || (b && b[r + x])) {
        lo = x;
        break;
      }
    if (lo < 0) continue;
    for (let x = w - 1; x >= lo; x--)
      if (a[r + x] || (b && b[r + x])) {
        hi = x;
        break;
      }
    if (lo < x0) x0 = lo;
    if (hi > x1) x1 = hi;
    if (y < y0) y0 = y;
    y1 = y;
  }
  return x1 < 0 ? null : [x0, y0, x1, y1];
}

const OUTQ = new Int32Array(1 << 16);
/** Контур снаружи фигуры — по словам в 32 бита и только в рамке рисунка. */
function outlineFast(p: Px, c: RGBA): void {
  const box = bbox(p, null);
  if (!box) return;
  const { w, h } = p;
  const a = u32(p);
  const ink = (255 << 24) | (c[2] << 16) | (c[1] << 8) | c[0];
  const x0 = Math.max(0, box[0] - 1);
  const x1 = Math.min(w - 1, box[2] + 1);
  const y0 = Math.max(0, box[1] - 1);
  const y1 = Math.min(h - 1, box[3] + 1);
  let n = 0;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const i = y * w + x;
      if (a[i]) continue;
      if ((x > 0 && a[i - 1]) || (x < w - 1 && a[i + 1]) || (y > 0 && a[i - w]) || (y < h - 1 && a[i + w])) {
        if (n < OUTQ.length) OUTQ[n++] = i;
      }
    }
  for (let k = 0; k < n; k++) a[OUTQ[k]] = ink;
}

/** Слой света: оставить только то, что не закрыто позже нарисованным. */
function settleLit(p: Px, L: Px): boolean {
  const a = u32(p);
  const b = u32(L);
  let any = false;
  for (let i = 0; i < b.length; i++) {
    const v = b[i];
    if (!v) continue;
    if (v >>> 24 === 255 && a[i] !== v) {
      b[i] = 0;
      continue;
    }
    if (!(v >>> 24)) {
      b[i] = 0;
      continue;
    }
    any = true;
  }
  return any;
}

/** Холст из прямоугольника буфера — строками сразу в ImageData, без промежуточной копии. */
function rectCanvas(p: Px, x0: number, y0: number, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) return c;
  const img = g.createImageData(w, h);
  const a = Math.max(0, x0);
  const b = Math.min(p.w, x0 + w);
  if (b > a)
    for (let y = 0; y < h; y++) {
      const sy = y + y0;
      if (sy < 0 || sy >= p.h) continue;
      img.data.set(p.data.subarray((sy * p.w + a) * 4, (sy * p.w + b) * 4), (y * w + (a - x0)) * 4);
    }
  g.putImageData(img, 0, 0);
  return c;
}

/** Готовый кадр рига до холста. */
interface Built2 {
  p: Px;
  lit: Px | null;
  ax: number;
  ay: number;
  eye: [number, number] | null;
}

/** Обрезать по содержимому и сделать холсты. */
function bake(b: Built2): { img: HTMLCanvasElement; lit: HTMLCanvasElement | null; ax: number; ay: number; eye: [number, number] | null } {
  const box = bbox(b.p, b.lit);
  if (!box) return { img: b.p.canvas(), lit: null, ax: b.ax, ay: b.ay, eye: b.eye };
  const [x0, y0, x1, y1] = box;
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  return {
    img: rectCanvas(b.p, x0, y0, w, h),
    lit: b.lit ? rectCanvas(b.lit, x0, y0, w, h) : null,
    ax: b.ax - x0,
    ay: b.ay - y0,
    eye: b.eye ? [b.eye[0] - x0, b.eye[1] - y0] : null,
  };
}

// --- Холсты-производные (рисует видеокарта, без обхода пикселей).

/** Вспышка удара: белым поверх (у огромного льва — мягче: 0,85 на такой туше слепит). */
function flashCanvas(src: HTMLCanvasElement, k = 0.85): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const g = c.getContext('2d');
  if (g) {
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = `rgba(255,248,240,${k})`;
    g.fillRect(0, 0, c.width, c.height);
  }
  return c;
}

/** Слой света ярче или тусклее: k < 1 — прозрачнее, k > 1 — сложением. */
const litLv = frameLRU<HTMLCanvasElement>(96);
const litIds = new WeakMap<HTMLCanvasElement, number>();
let litSeq = 0;
function litLevel(src: HTMLCanvasElement, k: number): HTMLCanvasElement {
  const q = Math.round(k * 10);
  if (q === 10) return src;
  let id = litIds.get(src);
  if (id === undefined) {
    id = ++litSeq;
    litIds.set(src, id);
  }
  const key = `${id}|${q}`;
  const hit = litLv.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const g = c.getContext('2d');
  if (g) {
    if (q < 10) {
      g.globalAlpha = q / 10;
      g.drawImage(src, 0, 0);
    } else {
      g.drawImage(src, 0, 0);
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = Math.min(1, (q - 10) / 10);
      g.drawImage(src, 0, 0);
      if (q > 20) {
        g.globalAlpha = Math.min(1, (q - 20) / 10);
        g.drawImage(src, 0, 0);
      }
    }
  }
  return litLv.set(key, c);
}

// --- Обратная кинематика ноги.

/**
 * Нога из трёх звеньев: верх → колено (локоть) → «лодыжка» → ступня.
 * `fv` — вектор лодыжка → ступня, `bend` — куда гнётся колено (−1 —
 * вперёд, у задних; 1 — назад, у передних). Не достаёт — лапа отрывается
 * от земли вслед за телом.
 */
function legIK(top: P2, foot: P2, L1: number, L2: number, fv: P2, bend: 1 | -1): P2[] {
  let ax = foot[0] - fv[0];
  let ay = foot[1] - fv[1];
  let dx = ax - top[0];
  let dy = ay - top[1];
  let d = Math.hypot(dx, dy) || 1e-6;
  const max = L1 + L2 - 0.4;
  if (d > max) {
    ax = top[0] + (dx / d) * max;
    ay = top[1] + (dy / d) * max;
    dx = ax - top[0];
    dy = ay - top[1];
    d = max;
  }
  const dd = Math.max(Math.abs(L1 - L2) + 1, d);
  const c = clampN((L1 * L1 + dd * dd - L2 * L2) / (2 * L1 * dd), -1, 1);
  const a = Math.atan2(dy, dx) + bend * Math.acos(c);
  return [top, [top[0] + Math.cos(a) * L1, top[1] + Math.sin(a) * L1], [ax, ay], [ax + fv[0], ay + fv[1]]];
}


// --- Части льва (облик прежний, суставы — из рига).

/** Жаркий шов рига: в кадр и в свет. */
function rseam(p: Px, x0: number, y0: number, x1: number, y1: number, glow: number): void {
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 1.5) + 1;
  for (let i = 0; i <= n; i++) {
    const x = Math.round(x0 + ((x1 - x0) * i) / n);
    const y = Math.round(y0 + ((y1 - y0) * i) / n);
    if (!p.solid(x, y)) continue;
    glowSet(p, x, y, glow > 0.6 ? EMBER_HI : glow > 0.3 ? EMBER : VEIN);
    if (p.solid(x, y + 1)) glowMix(p, x, y + 1, EMBER, 0.2 + glow * 0.3);
  }
}

/** Трещины со светом из-под камня (рига). */
function rcracks(p: Px, pts: P2[], glow: number, seed: number): void {
  for (const [x0, y0] of pts) {
    let x = x0;
    let y = y0;
    let a = hash(Math.round(x0), Math.round(y0), seed) * TAU;
    for (let s = 0; s < 7; s++) {
      if (p.solid(Math.round(x), Math.round(y))) glowMix(p, x, y, glow > 0.55 ? EMBER_HI : EMBER, 0.35 + glow * 0.6);
      a += (hash(s, Math.round(x0), seed) - 0.5) * 1.6;
      x += Math.cos(a);
      y += Math.sin(a) * 0.8;
    }
  }
}

/** Прядь гривы рига: тлеющий кончик светится. */
function rlock(p: Px, bx: number, by: number, a: number, len: number, w: number, m: Mat, glow: number, droop: number, ember: boolean): void {
  const b: P2 = [bx, by];
  const e: P2 = [bx + Math.cos(a) * len, by + Math.sin(a) * len + len * droop * 0.5];
  const c: P2 = [bx + Math.cos(a) * len * 0.55, by + Math.sin(a) * len * 0.55 - len * 0.05];
  const n = Math.max(3, Math.ceil(len / 3));
  let prev = b;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const q = qb(b, c, e, t);
    const r0 = w * Math.pow(1 - (t - 1 / n) * 0.85, 0.9) * 0.5;
    const r1 = w * Math.pow(1 - t * 0.85, 0.9) * 0.5;
    if (ember && t > 0.8 && glow > 0.25) {
      LITALL = true;
      rlimb(p, prev[0], prev[1], q[0], q[1], r0, r1, MOUTH, -0.35 + glow * 0.25 + (t - 0.8) * 0.8);
      LITALL = false;
    } else rlimb(p, prev[0], prev[1], q[0], q[1], r0, r1, m, 0.02);
    prev = q;
  }
}

/** Крыло летучей мыши рига: плечо, пальцы веером, перепонка; жилы светятся. */
function rwing(p: Px, sx: number, sy: number, a: number, len: number, open: number, far: boolean, mir: 1 | -1 = 1): void {
  if (len < 4) return;
  const MB = far ? M_MEMB_FAR : M_MEMB;
  const BN = far ? M_STONE_FAR : M_STONE;
  const spread = 0.3 + open * 0.7;
  const ex = sx + Math.cos(a) * len * 0.34;
  const ey = sy + Math.sin(a) * len * 0.34;
  const wa = a + mir * 0.35 * spread;
  const wx = ex + Math.cos(wa) * len * 0.3;
  const wy = ey + Math.sin(wa) * len * 0.3;
  const tips: P2[] = [];
  for (let i = 0; i < 4; i++) {
    const fa = wa + mir * (0.15 - i * 0.5 * spread);
    const fl = len * (0.7 - i * 0.08);
    tips.push([wx + Math.cos(fa) * fl, wy + Math.sin(fa) * fl]);
  }
  const body: P2 = [sx + Math.cos(a + mir * 2.2) * len * 0.22, sy + Math.sin(a + mir * 2.2) * len * 0.22 + 6];
  const chain: P2[] = [...tips, body];
  for (let i = 0; i < chain.length - 1; i++) {
    const t0 = chain[i];
    const t1 = chain[i + 1];
    const mid: P2 = [(t0[0] + t1[0]) / 2, (t0[1] + t1[1]) / 2];
    const ctrl: P2 = [mid[0] + (wx - mid[0]) * 0.42, mid[1] + (wy - mid[1]) * 0.42];
    const edge: P2[] = [[wx, wy], t0];
    for (let k = 1; k < 8; k++) edge.push(qb(t0, ctrl, t1, k / 8));
    edge.push(t1);
    if (i === chain.length - 2) edge.push([sx, sy]);
    const ox = Math.round(wx);
    const oy = Math.round(wy);
    poly(p, edge, (x, y) => {
      const d = Math.hypot(x - wx, y - wy) / len;
      const l = -0.4 + d * 1.1 + (vn((x - ox) / 3 + 40, (y - oy) / 3 + 40, 60 + i) - 0.5) * 0.3;
      return rpx(MB, l, 0, x, y, x - ox, y - oy, 0, 0, 0);
    });
    if (!far) {
      const q = qb(t0, ctrl, t1, 0.5);
      const mm: P2 = [(wx + q[0]) / 2 + (hash(i, 3, 9) - 0.5) * 4 * mir, (wy + q[1]) / 2];
      for (let k = 0; k < 10; k++) {
        const pt = qb([wx, wy], mm, q, k / 10);
        const X = Math.round(pt[0]);
        const Y = Math.round(pt[1]);
        if (p.solid(X, Y)) glowMix(p, X, Y, VEIN_HOT, 0.35);
      }
    }
  }
  rlimb(p, sx, sy, ex, ey, 3.4, 2.6, BN, 0.05);
  rlimb(p, ex, ey, wx, wy, 2.6, 2, BN, 0.05);
  for (const [tx, ty] of tips) rlimb(p, wx, wy, tx, ty, 1.5, 0.6, BN, 0.1);
  rlimb(p, wx, wy, wx + Math.cos(a - mir * 1.1) * 5, wy + Math.sin(a - mir * 1.1) * 5, 1.3, 0.3, M_BONE, 0.2);
  rlimb(p, ex, ey, ex + Math.cos(a - mir * 1.6) * 3.5, ey + Math.sin(a - mir * 1.6) * 3.5, 1.1, 0.3, M_BONE, 0.2);
}

/** Голова в профиль: каменный череп, морда, челюсть, глаз; свет — в слой. */
function rheadSide(p: Px, hx0: number, hy0: number, r: LRig, far = false): [number, number] {
  const tilt = r.hd;
  const ca = Math.cos(tilt);
  const sa = Math.sin(tilt);
  const R = (x: number, y: number): [number, number] => [hx0 + x * ca - y * sa, hy0 + x * sa + y * ca];
  const S = far ? M_STONE_FAR : M_STONE;
  const jaw = r.jaw;
  rell(p, ...R(-5, -8.5), 2.6, 3, S, 0.1);
  rell(p, ...R(-4.8, -8), 1.3, 1.6, M_FLESH, -0.1);
  const [j0x, j0y] = R(-2, 4.5);
  const [j1x, j1y] = R(12, 5.5 + jaw * 8);
  if (jaw > 0.12) {
    const [m0x, m0y] = R(1, 3);
    const [m1x, m1y] = R(13, 3 + jaw * 4.5);
    rlimb(p, m0x, m0y, m1x, m1y, 2.6 * jaw + 0.6, 1.6 * jaw + 0.5, M_MEMB, -0.15);
    LITALL = jaw > 0.3;
    rlimb(p, m0x + 1, m0y + 0.5, m1x - 3, m1y - 0.5, 1.2 * jaw + 0.3, 0.6 * jaw + 0.3, MOUTH, -0.05);
    LITALL = false;
  }
  rlimb(p, j0x, j0y, j1x, j1y, 3.8, 2.8, S, -0.1);
  rell(p, ...R(-1.5, -1), 8.2, 7.6, S, 0.05);
  rplate(p, [R(1, -5.5), R(12, -3.5), R(15.5, -0.5), R(15, 3.5), R(12, 5), R(2, 5.5)], S, [0.3, -0.2], 0.05);
  rell(p, ...R(10.5, 2.5), 4, 2.8, S, 0.18);
  rell(p, ...R(14.6, -1.8), 1.9, 1.5, M_STONE_FAR, 0);
  const [nx, ny] = R(15.3, -1.3);
  put(p, Math.round(nx), Math.round(ny), INK);
  rplate(p, [R(-3, -8.5), R(7.5, -7.5), R(9.5, -4.5), R(-1, -4)], S, [-0.3, -0.8], 0.15);
  for (const k of [7.5, 11]) {
    const [tx, ty] = R(k, 5.2);
    put(p, Math.round(tx), Math.round(ty), BONE[3]);
    put(p, Math.round(tx), Math.round(ty) + 1, BONE[2]);
    if (jaw > 0.3) {
      const [bx, by] = R(k - 1, 5 + jaw * 6);
      put(p, Math.round(bx), Math.round(by), BONE[3]);
      put(p, Math.round(bx), Math.round(by) - 1, BONE[2]);
    }
  }
  rcracks(p, [R(-1, 2), R(4, -6)], 0.6, 7);
  const [ex, ey] = R(5.5, -3.2);
  const X = Math.round(ex);
  const Y = Math.round(ey);
  put(p, X - 1, Y, INK);
  if (r.bl > 0.5) {
    // Моргнул: веко — камень.
    put(p, X, Y, S.r[2]);
    put(p, X + 1, Y, S.r[3]);
  } else {
    glowSet(p, X, Y, GOLD);
    glowSet(p, X + 1, Y, GOLD_HI);
    glowSet(p, X, Y + 1, mixc(EMBER, GOLD, 0.2));
    if (r.eye > 0.3) {
      // Глаз горит: ореол только в свете — поверх темноты.
      const a = Math.round(90 + r.eye * 110);
      haloSet(X + 2, Y, alpha(GOLD, a / 255));
      haloSet(X, Y - 1, alpha(GOLD, a / 400));
      haloSet(X + 1, Y - 1, alpha(GOLD_HI, a / 300));
      if (r.eye > 0.7) haloSet(X + 3, Y - 1, alpha(EMBER_HI, a / 500));
    }
  }
  return [X + 1, Y];
}

/** Грива в профиль: задний слой и передний; дыбом — длиннее и наружу. */
function rmaneSide(p: Px, cx: number, cy: number, r: LRig, back: boolean): void {
  const m = back ? M_MANE_FAR : M_MANE;
  const n = back ? 13 : 10;
  const up = r.mane;
  for (let i = 0; i < n; i++) {
    const k = i / (n - 1);
    const a0 = back ? Math.PI * (0.4 + k * 1.1) : Math.PI * (0.6 + k * 0.85);
    // Качание сильнее у концов венца; дыбом — пряди расходятся от головы.
    const a = a0 + (hash(i, 5, 17) - 0.5) * 0.2 + r.msw * (0.18 + 0.2 * k) - up * 0.12 * Math.sin(a0);
    const len = (back ? 17 : 11) * (0.75 + hash(i, back ? 3 : 4, 17) * 0.35) * (back ? 0.8 + Math.sin(Math.PI * k) * 0.3 : 1) * (1 + up * 0.22);
    const w = back ? 12 : 9;
    const r0 = back ? 4 : 6;
    const droop = (back ? 0.6 : 0.45) * (1 - up * 0.75);
    rlock(p, cx + Math.cos(a0) * r0, cy + Math.sin(a0) * r0, a, len, w, m, 0.6, droop, i % 3 === 1);
  }
}

/** Хвост: каменные позвонки, дальше — змея с головой; глаз светится. */
function rtail(p: Px, pts: P2[], far = false): void {
  const sp = spline(pts, 6);
  const N = sp.length;
  for (let i = 0; i < N - 1; i++) {
    const k = i / N;
    const snake = k > 0.38;
    const r0 = snake ? 1.9 + (k - 0.38) * 2.2 : 2.6 - k * 2;
    rlimb(p, sp[i][0], sp[i][1], sp[i + 1][0], sp[i + 1][1], r0, r0, snake ? M_SCALE : far ? M_FLESH_FAR : M_FLESH, 0);
    if (!snake && i % 3 === 1) rell(p, sp[i][0], sp[i][1] - 0.8, 2.8 - k * 2, 2, far ? M_STONE_FAR : M_STONE, 0.1);
  }
  const [x1, y1] = sp[N - 1];
  const [x0, y0] = sp[Math.max(0, N - 4)];
  const a = Math.atan2(y1 - y0, x1 - x0);
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const hx1 = x1 + ux * 3;
  const hy1 = y1 + uy * 3;
  rlimb(p, x1, y1, hx1 + ux * 3.5, hy1 + uy * 3.5, 3.4, 1.6, M_SCALE, 0.1);
  rell(p, x1 + ux * 1.5, y1 + uy * 1.5, 3.4, 3, M_SCALE, 0.1);
  const mx = hx1 + ux * 2 + uy * 0.8;
  const my = hy1 + uy * 2 - ux * 0.8;
  glowSet(p, mx, my, MOUTH.r[2]);
  glowSet(p, mx + ux, my + uy, MOUTH.r[3]);
  glowSet(p, x1 + ux * 2 - uy * 1.5, y1 + uy * 2 + ux * 1.5 - 1, hx('#ff4a3a'));
}

/**
 * Лапа рига: бедро, голень, стопа — каменные капсулы, колено — плоть в
 * стыке, плита на бедре; ступня поворачивается (`pa`), когти выходят
 * (`ext`) и на ударе светятся (`hot`).
 */
function rleg(p: Px, pts: P2[], rs: number[], far: boolean, claws: boolean, plate: boolean, pa: number, ext: number, hot: number, glint = 0): void {
  const S = far ? M_STONE_FAR : M_STONE;
  const F = far ? M_FLESH_FAR : M_FLESH;
  for (let i = 0; i < 3; i++) rlimb(p, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], rs[i], rs[i + 1], S, i === 0 ? -0.04 : 0.05);
  rell(p, pts[1][0] - 0.5, pts[1][1] + 0.5, rs[1] * 0.5, rs[1] * 0.45, F, -0.15);
  if (!far) rseam(p, pts[0][0] - 1, pts[0][1] + 2, pts[1][0], pts[1][1] - 1, 0.3);
  if (plate) {
    const [ax, ay] = pts[0];
    const [bx, by] = pts[1];
    rell(p, ax + (bx - ax) * 0.3 - 1, ay + (by - ay) * 0.3 - 1, rs[0] * 0.75, rs[0] * 0.85, S, 0.12);
  }
  const [fx, fy] = pts[3];
  const c0 = rotV([-2.3, -1.6], pa);
  const c1 = rotV([4.8, -1.6], pa);
  rlimb(p, fx + c0[0], fy + c0[1], fx + c1[0], fy + c1[1], 2.9, 2.6, S, 0.12);
  if (!claws) return;
  if (glint > 0.05) {
    // Блеск когтей: звезда на среднем когте — «клинок взведён».
    const tp = rotV([3.4 + 1.6 + (1 + ext * 3.2) * 0.75, 0.2 + (1 + ext * 3.2) * 0.7], pa);
    const X = Math.round(fx + tp[0]);
    const Y = Math.round(fy + tp[1]);
    const R = 1 + Math.round(glint * 3);
    for (let i = -R; i <= R; i++) {
      const a = 1 - Math.abs(i) / (R + 1);
      haloSet(X + i, Y, alpha(i === 0 ? WHITE : GOLD_HI, a));
      haloSet(X, Y + i, alpha(i === 0 ? WHITE : GOLD_HI, a));
    }
    if (glint > 0.5) for (const [dx, dy] of [[1, 1], [-1, -1], [1, -1], [-1, 1]]) haloSet(X + dx, Y + dy, alpha(GOLD_HI, 0.5));
  }
  for (let k = 0; k < 3; k++) {
    const b = rotV([3.4 + k * 1.6, 0.2], pa);
    const len = 1 + ext * 3.2;
    const e = rotV([3.4 + k * 1.6 + len * 0.75, 0.2 + len * 0.7], pa);
    const n = Math.max(1, Math.ceil(len * 1.5));
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const X = Math.round(fx + b[0] + (e[0] - b[0]) * u);
      const Y = Math.round(fy + b[1] + (e[1] - b[1]) * u);
      if (hot > 0.3 && u > 0.55) glowSet(p, X, Y, u > 0.85 ? WHITE : EMBER_HI);
      else put(p, X, Y, u < 0.4 ? BONE[2] : BONE[3]);
    }
  }
}

// --- Слои головы: голова с гривой — самая тяжёлая часть кадра (сотня
// прядей), а меняется она реже тела. Слой рисуется один раз на набор
// каналов головы (с шагом) и кладётся в кадр в целых пикселях — фактура
// у частей своя, так что сдвиг слоя её не меняет.

interface Layer {
  p: Px;
  lit: Px | null;
  ox: number;
  oy: number;
  eye: P2 | null;
}
const LAYERS = frameLRU<Layer>(300);
const hq = (v: number, st: number) => Math.round(v / st) * st;

function layerOf(key: string, w: number, h: number, ox: number, oy: number, draw: (q: Px) => P2 | void): Layer {
  const hit = LAYERS.get(key);
  if (hit) return hit;
  const q = new Px(w, h);
  const ql = new Px(w, h);
  const sl = LIT;
  const sa = LITALL;
  LIT = ql;
  LITALL = false;
  const eye = draw(q) ?? null;
  LIT = sl;
  LITALL = sa;
  const lu = u32(ql);
  let any = false;
  for (let i = 0; i < lu.length; i++)
    if (lu[i]) {
      any = true;
      break;
    }
  return LAYERS.set(key, { p: q, lit: any ? ql : null, ox, oy, eye });
}

/** Положить слой в кадр точкой привязки в (x, y); свет — в слой света кадра. */
function blitLayer(p: Px, ly: Layer, x: number, y: number): P2 | null {
  const X = Math.round(x) - ly.ox;
  const Y = Math.round(y) - ly.oy;
  const a = u32(ly.p);
  const d = u32(p);
  const la = ly.lit ? u32(ly.lit) : null;
  const L = LIT ? u32(LIT) : null;
  for (let yy = 0; yy < ly.p.h; yy++) {
    const ty = yy + Y;
    if (ty < 0 || ty >= p.h) continue;
    for (let xx = 0; xx < ly.p.w; xx++) {
      const tx = xx + X;
      if (tx < 0 || tx >= p.w) continue;
      const i = yy * ly.p.w + xx;
      const j = ty * p.w + tx;
      if (a[i]) d[j] = a[i];
      if (la && L && la[i]) L[j] = la[i];
    }
  }
  return ly.eye ? [ly.eye[0] + X, ly.eye[1] + Y] : null;
}

/** Голова и грива в профиль — слоем (каналы головы с шагом). */
function sideHeadLayer(r: LRig): Layer {
  const q: LRig = {
    ...r,
    hd: hq(r.hd, 0.03),
    jaw: hq(r.jaw, 0.06),
    mane: hq(r.mane, 0.08),
    msw: hq(r.msw, 0.08),
    bl: r.bl > 0.5 ? 1 : 0,
    eye: r.eye > 0.3 ? hq(r.eye, 0.25) : 0,
  };
  const key = `sh|${q.hd}|${q.jaw}|${q.mane}|${q.msw}|${q.bl}|${q.eye}`;
  return layerOf(key, 104, 92, 52, 48, (p) => {
    rmaneSide(p, 52 - 4, 48 + 1, q, true);
    const e = rheadSide(p, 52, 48, q);
    rmaneSide(p, 52 - 5, 48 + 1, q, false);
    return e;
  });
}

// --- Бок: геометрия (её же берёт след когтей, без рисования).

const SW = 212;
const SH = 196;
const SG = 182;
const SAX = 100;

interface SGeo {
  hipX: number;
  hipY: number;
  shX: number;
  shY: number;
  hn: P2[];
  hf: P2[];
  fn: P2[];
  ff: P2[];
  hx0: number;
  hy0: number;
}

function sideGeo(r: LRig): SGeo {
  const G = SG;
  const hipX = SAX - 18 + r.bx;
  const shX = SAX + 18 + r.bx - r.rear * 4;
  const hipY = G - 43 + r.cr * 8 - r.by + r.rear * 3;
  const shY = G - 49 + r.cr * 7 - r.by - r.rear * 16;
  const hfv = rotV([4, 9], r.hna);
  return {
    hipX,
    hipY,
    shX,
    shY,
    hn: legIK([hipX - 1, hipY + 6], [SAX - 18 + r.hnx, G - 2 + r.hny], 16.5, 12.2, hfv, -1),
    hf: legIK([hipX + 4, hipY + 6], [SAX - 13 + r.hfx, G - 3 + r.hfy], 16.5, 12.2, hfv, -1),
    fn: legIK([shX + 3, shY + 12], [SAX + 25 + r.fnx, G - 2 + r.fny], 15, 13.3, rotV([2, 7], r.fna), 1),
    ff: legIK([shX + 4, shY + 14], [SAX + 27 + r.ffx, G - 3 + r.ffy], 15, 13.3, rotV([2, 7], r.ffa), 1),
    hx0: shX + 22 + r.rear * 3 + r.hx,
    hy0: shY - 9 - r.rear * 4 + r.hd * 6 + r.hy,
  };
}

/** Кончик когтей ближней передней лапы (для следа удара). */
function sidePawTip(r: LRig): P2 {
  const g = sideGeo(r);
  const f = g.fn[3];
  const v = rotV([6.5 + r.cl * 2.2, 0.6 + r.cl * 1.6], r.fna);
  return [f[0] + v[0], f[1] + v[1]];
}

/** Угол руки крыла в боку: 0 — вдоль спины назад, 1 — вверх, −1 — вниз; мах вперёд — `wsw`. */
const sideWingA = (wa: number, wsw: number, far: boolean) => Math.PI + (0.08 + 0.375 * wa + (far ? 0.18 : 0)) * Math.PI + wsw * 0.85 * Math.PI;

/**
 * След когтей: три серпа по пути кончика (новое — первым), белый жар у
 * лапы, к хвосту — золото и угли; в кадр и в свет.
 */
function clawSmear(p: Px, path: P2[], k: number): void {
  if (path.length < 2 || k <= 0) return;
  const n = path.length;
  for (let c = -1; c <= 1; c++) {
    let prev: P2 | null = null;
    for (let i = 0; i < n; i++) {
      const a = path[Math.max(0, i - 1)];
      const b = path[Math.min(n - 1, i + 1)];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const d = Math.hypot(dx, dy) || 1;
      const off = c * (2.7 - (i / n) * 1.1);
      const pt: P2 = [path[i][0] - (dy / d) * off, path[i][1] + (dx / d) * off];
      if (prev) {
        const u = i / (n - 1);
        if (u > k) break;
        const col = u < 0.18 ? WHITE : u < 0.45 ? GOLD_HI : u < 0.75 ? EMBER_HI : EMBER;
        const steps = Math.ceil(Math.hypot(pt[0] - prev[0], pt[1] - prev[1]) * 1.6) + 1;
        for (let s = 0; s <= steps; s++) {
          const X = Math.round(prev[0] + ((pt[0] - prev[0]) * s) / steps);
          const Y = Math.round(prev[1] + ((pt[1] - prev[1]) * s) / steps);
          glowSet(p, X, Y, col);
          if (u < 0.3 && c === 0) haloSet(X, Y + 1, alpha(EMBER_HI, 0.5));
        }
      }
      prev = pt;
    }
  }
}

/** Бок: лев целиком из рига. `wing` — крылья (с «КРЫЛЬЕВ»), иначе каменный плащ. */
function drawSide(r: LRig, wing: boolean, smear: P2[] | null, smearK = 1): Built2 {
  const p = scratch('sp', SW, SH);
  const L = scratch('sl', SW, SH);
  LIT = L;
  LITALL = false;
  rimK = 0.2;
  const G = SG;
  const g = sideGeo(r);
  const { hipX, hipY, shX, shY } = g;
  const br = 1 + r.br * 0.06;
  const glow = 0.6;
  // Дальнее крыло — за телом.
  if (wing) rwing(p, shX - 8, shY - 4, sideWingA(r.wa2, r.wsw2, true), 52 * (0.6 + r.wo2 * 0.4) * r.wl, r.wo2, true);
  // Дальние ноги.
  rleg(p, g.hf, [8, 5, 3.6, 3.2], true, false, false, r.hna, 0, 0);
  rleg(p, g.ff, [7, 5.2, 4.2, 3.6], true, true, false, r.ffa, r.cl * 0.6, 0);
  // Хвост: вверх и назад, змеиная голова смотрит вперёд.
  const tw = r.tail;
  const tu = r.tup;
  rtail(p, [
    [hipX - 10, hipY - 3],
    [hipX - 21, hipY + 2 + tw * 2 - tu * 2],
    [hipX - 30 + tw * 2, hipY - 6 + tw * 3 - tu * 6],
    [hipX - 32 + tw * 4 + tu * 2, hipY - 20 + tw * 2 - tu * 9],
    [hipX - 25 + tw * 5 + tu * 3, hipY - 29 - tu * 10],
    [hipX - 17 + tw * 4 + tu * 3 + r.snk * 4, hipY - 31 - tu * 10 + r.snk * 3],
  ]);
  // Тело: брюхо плотью, бедро и грудь — каменные массы.
  rlimb(p, hipX + 2, hipY + 5, shX - 2, shY + 13, 9.5 * br, 13 * br, M_FLESH, 0);
  rell(p, hipX - 2, hipY + 3, 11.5, 12.5 * br, M_STONE, 0.05);
  rell(p, shX + 3, shY + 13, 13.5 * br, 17 * br, M_STONE, 0.08);
  for (let i = 0; i < 3; i++) {
    const k = (i + 0.8) / 3.8;
    const x = hipX + 6 + (shX - hipX - 8) * k;
    const yt = hipY - 5 + (shY - hipY) * k;
    const yb = hipY + 13 * br + (shY + 22 * br - hipY - 13 * br) * k;
    const pts = spline([
      [x - 1, yt],
      [x + 3.5 + r.br, (yt + yb) / 2],
      [x + 1.5, yb],
    ], 4);
    for (let j = 0; j < pts.length - 1; j++) rlimb(p, pts[j][0], pts[j][1], pts[j + 1][0], pts[j + 1][1], 2, 1.8, M_STONE, 0.12);
  }
  for (let x = Math.round(hipX + 8); x < shX - 4; x++) {
    const k = (x - hipX - 8) / (shX - hipX - 12);
    const by = hipY + 14 * br + (shY + 24 * br - hipY - 14 * br) * k + Math.sin(k * Math.PI) * 1.5;
    put(p, x, Math.round(by), M_FLESH.r[1]);
    if (x % 6 === 0) glowMix(p, x, by - 3, VEIN_HOT, 0.5);
  }
  // Плиты спины внахлёст — щели светятся сердцем.
  for (let i = 0; i < 6; i++) {
    const k0 = i / 6;
    const k1 = (i + 1.3) / 6;
    const x0 = hipX - 10 + (shX - hipX + 12) * k0;
    const x1 = hipX - 10 + (shX - hipX + 12) * k1;
    const arch = (k: number) => Math.sin(k * Math.PI) * (4 + r.br * 1.2);
    const y0 = hipY - 11 + (shY - 7 - hipY + 11) * k0 - arch(k0);
    const y1 = hipY - 11 + (shY - 7 - hipY + 11) * k1 - arch(k1);
    rplate(p, [
      [x0, y0 + 2],
      [x0 + 2, y0 - 6],
      [x1, y1 - 6],
      [x1 + 2, y1 + 3],
      [x0 + 1, y0 + 8],
    ], M_STONE, [-0.2, -0.7], 0.08);
    rseam(p, x0 + 0.5, y0 - 1, x0 + 1.2, y0 + 6, glow);
  }
  if (!wing) {
    rplate(p, [
      [shX - 2, shY - 10],
      [shX - 20, shY - 16],
      [hipX + 4, hipY - 17],
      [hipX + 10, hipY - 8],
      [shX - 4, shY + 1],
    ], M_STONE, [-0.3, -0.8], 0.14);
    for (let i = 0; i < 4; i++) rseam(p, shX - 7 - i * 7, shY - 12 + i * 0.5, shX - 11 - i * 7, shY - 3 + i, glow * 0.8);
  }
  rcracks(p, [[hipX - 2, hipY + 2], [shX + 2, shY + 18], [hipX + 12, hipY - 4], [shX - 6, shY + 4]], glow, 3);
  // Сердце в груди светит сквозь рёбра.
  if (r.hrt > 0.5) {
    const hcx = shX + 7;
    const hcy = shY + 15;
    p.ell(hcx, hcy, 2.8 + r.br * 0.4, 3.2 + r.br * 0.4, EMBER);
    for (let y = Math.floor(hcy - 4); y <= hcy + 4; y++) for (let x = Math.floor(hcx - 3); x <= hcx + 3; x++) if (p.get(x, y)[0] === EMBER[0] && p.get(x, y)[1] === EMBER[1]) litCopy(p, x, y);
    glowSet(p, hcx, hcy - 1, EMBER_HI);
    for (let a = -1; a <= 1; a += 1) rlimb(p, hcx - 5, hcy + a * 4 - 1, hcx + 5, hcy + a * 4.5, 1.2, 1.1, M_STONE, 0.1);
  }
  // Ближние ноги. Передняя — под шеей и гривой, а занесённая — поверх головы.
  rleg(p, g.hn, [9, 5.6, 4, 3.6], false, true, false, r.hna, 0, 0);
  const high = r.fny < -22;
  if (!high) rleg(p, g.fn, [9, 6.2, 4.8, 4.2], false, true, true, r.fna, r.cl, r.cl, r.gl);
  // Шея, грива, голова.
  rlimb(p, shX + 4, shY + 5, g.hx0 - 5, g.hy0 + 3, 10, 8, M_FLESH, 0.05);
  const eye = blitLayer(p, sideHeadLayer(r), g.hx0, g.hy0);
  if (high) {
    // Занесённая лапа — своим слоем со своим контуром: поверх морды она
    // иначе сливалась с головой в один камень.
    const q = scratch('sq', SW, SH);
    rleg(q, g.fn, [9, 6.2, 4.8, 4.2], false, true, true, r.fna, r.cl, r.cl, r.gl);
    outlineFast(q, INK);
    const a = q.data;
    const d = p.data;
    for (let i = 0; i < a.length; i += 4)
      if (a[i + 3]) {
        d[i] = a[i];
        d[i + 1] = a[i + 1];
        d[i + 2] = a[i + 2];
        d[i + 3] = 255;
      }
  }
  // Ближнее крыло.
  if (wing) rwing(p, shX - 12, shY - 2, sideWingA(r.wa, r.wsw, false), 62 * (0.6 + r.wo * 0.4) * r.wl, r.wo, false);
  outlineFast(p, INK);
  if (smear) clawSmear(p, smear, smearK);
  LIT = null;
  const any = settleLit(p, L);
  return { p, lit: any ? L : null, ax: SAX, ay: G, eye };
}


// --- Анфас: сцены (пробуждение, рёв, крылья, сердце, оболочка).

const FW = 232;
const FH = 184;
const FG = 168;
const FCX = 116;

/** Крыло анфас: правое — та же геометрия зеркально (свет при этом свой, слева-сверху). */
function rwingM(p: Px, sx: number, sy: number, a: number, len: number, open: number, mir: 1 | -1): void {
  rwing(p, sx, sy, a, len, open, false, mir);
}

/** Угол руки левого крыла анфас: 1 — вверх, −1 — вниз вдоль боков; мах вперёд — к нам и вниз. */
const frontWingA = (wa: number, wsw: number) => Math.PI + (0.02 + 0.33 * wa) * Math.PI - wsw * 0.3 * Math.PI;

interface FGeo {
  cx: number;
  shY: number;
  hy0: number;
  hcx: number;
  legL: P2[];
  legR: P2[];
}

function frontGeo(r: LRig): FGeo {
  const G = FG + r.ly;
  const cx = FCX;
  const shY = G - 46 + r.cr * 8 - r.by;
  const hy0 = shY - 13 + r.hd * 5 + r.hy;
  const leg = (s: number, px: number, py: number) =>
    legIK([cx + s * 16, shY + 14], [cx + s * 15 + px, G - 2 + py], 16, 13.5, [0, 6], s > 0 ? -1 : 1);
  return { cx, shY, hy0, hcx: cx + r.shk, legL: leg(-1, r.plx, r.ply), legR: leg(1, r.prx, r.pry) };
}

/** Каменеет от краёв к груди и голове; по кромке — угольная полоса (в свет). */
function stoneProg(p: Px, k: number, cx: number, cy: number, hy: number): void {
  if (k <= 0) return;
  const d = p.data;
  const box = bbox(p, null);
  if (!box) return;
  for (let y = box[1]; y <= box[3]; y++)
    for (let x = box[0]; x <= box[2]; x++) {
      const i = (y * p.w + x) * 4;
      if (!d[i + 3]) continue;
      // Расстояние до «жизни» — отрезка грудь—голова.
      const vy = clampN(y, hy, cy);
      const dist = Math.hypot(x - cx, (y - vy) * 1.1) / 62;
      const th = (1 - Math.min(1, dist)) * 0.9 + hash(x >> 1, y >> 1, 91) * 0.12;
      if (k >= 1 || k > th + 0.04) {
        const l = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255;
        const g = ramp(M_STONE.r, 0.6 + l * 9.5, x, y);
        d[i] = g[0];
        d[i + 1] = g[1];
        d[i + 2] = g[2];
      } else if (k > th - 0.04) {
        // Кромка: камень наступает — тлеет.
        glowSet(p, x, y, k > th ? EMBER : VEIN_HOT);
      }
    }
}

/** Трещины оболочки: светятся сердцем (в свет), силу даёт слой света. */
function huskCracks(p: Px, seed: number, n: number): void {
  for (let c = 0; c < n; c++) {
    let x = FCX + (hash(c, seed) - 0.5) * 60;
    let y = FG - 30 - hash(c, seed, 1) * 70;
    let a = hash(c, seed, 2) * TAU;
    for (let s = 0; s < 16; s++) {
      const xi = Math.round(x);
      const yi = Math.round(y);
      if (p.solid(xi, yi)) glowSet(p, xi, yi, s < 4 ? EMBER_HI : EMBER);
      a += (hash(c, s, seed) - 0.5) * 1.2;
      x += Math.cos(a);
      y += Math.sin(a);
    }
  }
}

/** Анфас целиком из рига. */
/** Передняя лапа анфас: плечо, предплечье, кисть, когти (на замахе — вверх, со звездой блеска). */
function frontLeg(p: Px, pts: P2[], sd: -1 | 1, py: number, cl: number, glint: number): void {
  for (let i = 0; i < 3; i++) rlimb(p, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], [8.5, 6, 5][i], [6, 5, 4.4][i], i === 0 ? M_FLESH : M_STONE, 0.05);
  rell(p, pts[0][0] - sd * 1, pts[0][1] - 1, 8, 9, M_STONE, 0.12);
  const [fx, fy] = pts[3];
  rell(p, fx, fy - 1.5, 6, 3.2, M_STONE, 0.12);
  const raised = py < -6;
  const len = 1 + cl * 3;
  for (let k = -1; k <= 1; k++) {
    const X = Math.round(fx + k * 2.2);
    for (let u = 0; u <= len; u++) {
      const Y = raised ? Math.round(fy - 3.5 - u) : Math.round(fy + 0.5 + u);
      const XX = X + (raised ? Math.round(sd * k * u * 0.3) : 0);
      if (cl > 0.5 && u >= len - 1) glowSet(p, XX, Y, u >= len ? WHITE : EMBER_HI);
      else put(p, XX, Y, u === 0 ? BONE[3] : BONE[2]);
    }
  }
  if (glint > 0.05) {
    const X = Math.round(fx);
    const Y = Math.round(raised ? fy - 3.5 - len : fy + len);
    const R = 1 + Math.round(glint * 3);
    for (let i = -R; i <= R; i++) {
      const a = 1 - Math.abs(i) / (R + 1);
      haloSet(X + i, Y, alpha(i === 0 ? WHITE : GOLD_HI, a));
      haloSet(X, Y + i, alpha(i === 0 ? WHITE : GOLD_HI, a));
    }
  }
}

/** Кончик когтей передней лапы анфас (для следа удара). */
function frontPawTip(r: LRig, sd: -1 | 1): P2 {
  const g = frontGeo(r);
  const f = (sd > 0 ? g.legR : g.legL)[3];
  const py = sd > 0 ? r.pry : r.ply;
  return py < -6 ? [f[0], f[1] - 4.5 - r.cl * 3] : [f[0], f[1] + 1 + r.cl * 3];
}

function drawFront(r: LRig, wing: boolean, scene: { cocoon?: number; shreds?: number; smear?: P2[] | null; smearK?: number } = {}): Built2 {
  const p = scratch('fp', FW, FH);
  const L = scratch('fl', FW, FH);
  LIT = L;
  LITALL = false;
  rimK = 0.22;
  const G = FG + r.ly;
  const g = frontGeo(r);
  const { cx, shY, hy0, hcx } = g;
  const glow = 0.6;
  const br = 1 + r.br * 0.07;
  // Остатки кокона позади (пробуждение).
  if (scene.cocoon !== undefined) cocoonBack(p, cx, FG + 6, scene.cocoon);
  // Крылья.
  if (wing) {
    const lenL = 64 * (0.6 + r.wo * 0.4) * r.wl * (1 - 0.28 * clamp01(r.wsw));
    const lenR = 64 * (0.6 + r.wo2 * 0.4) * r.wl * (1 - 0.28 * clamp01(r.wsw2));
    rwingM(p, cx - 14, shY - 2, frontWingA(r.wa, r.wsw), lenL, r.wo, 1);
    rwingM(p, cx + 14, shY - 2, Math.PI - frontWingA(r.wa2, r.wsw2), lenR, r.wo2, -1);
  }
  // Задние лапы за передними.
  for (const s of [-1, 1]) {
    rell(p, cx + s * (19 + r.cr * 2), G - 13 + r.cr * 3, 10, 11 - r.cr * 1.5, M_STONE_FAR, 0.05);
    rell(p, cx + s * (22 + r.cr * 3), G - 3, 5.5, 2.8, M_STONE_FAR, 0.1);
  }
  // Хвост за спиной: змея выглядывает над плечом.
  rtail(p, [
    [cx + 14, shY + 22],
    [cx + 27, shY + 12],
    [cx + 33, shY - 2 + r.tail * 3],
    [cx + 30 + r.tail * 3, shY - 16 - r.tup * 4],
    [cx + 24 + r.tail * 3 + r.snk * 3, shY - 22 - r.tup * 6],
  ], true);
  // Грива сзади: большой тёмный венец (дыбом — шире, качается с запозданием) — слоем.
  const up = hq(r.mane, 0.08);
  const msw = hq(r.msw, 0.08);
  blitLayer(
    p,
    layerOf(`fc|${up}|${msw}`, 104, 100, 52, 50, (q) => {
      for (let i = 0; i < 22; i++) {
        const a0 = -Math.PI / 2 + (i / 22) * TAU + 0.07;
        const down = Math.max(0, Math.sin(a0));
        const a = a0 + msw * 0.22 * Math.cos(a0) - up * 0.1 * Math.sign(Math.cos(a0)) * down;
        rlock(q, 52 + Math.cos(a0) * 8, 50 + 2 + Math.sin(a0) * 7, a, (15 + hash(i, 1, 33) * 6 + down * 6) * (1 + up * 0.25), 10, M_MANE_FAR, glow, 0.45 * (1 - up * 0.8), i % 5 === 0);
      }
    }),
    hcx,
    hy0,
  );
  // Грудь и плечи.
  rell(p, cx, shY + 18, 21 * br, 21 * br, M_STONE, 0.08);
  for (const s of [-1, 1]) rell(p, cx + s * 17 * br, shY + 9, 11, 12, M_STONE, s < 0 ? 0.14 : -0.02);
  // Грудная клетка: плоть в середине, каменные рёбра дугами; вскрывается.
  const open = r.ch;
  rell(p, cx, shY + 21, 9 + open * 6, 12 + open * 4, M_FLESH, 0);
  if (open > 0.05) {
    // Полость: тёмное нутро, по краю жар.
    const hr = 6 + open * 6;
    for (let y = Math.floor(shY + 21 - hr * 1.2); y <= shY + 21 + hr * 1.2; y++)
      for (let x = Math.floor(cx - hr); x <= cx + hr; x++) {
        const dd = Math.hypot((x + 0.5 - cx) / hr, (y + 0.5 - shY - 21) / (hr * 1.2));
        if (dd > 1) continue;
        if (r.hrt > 0.5) glowSet(p, x, y, dd < 0.5 ? EMBER_HI : dd < 0.8 ? EMBER : VEIN_HOT);
        else glowSet(p, x, y, dd > 0.82 ? EMBER : dd > 0.6 ? VEIN_D : DARK);
      }
  }
  for (let i = 0; i < 4; i++) {
    const y = shY + 12 + i * 5.2;
    const ok = open * (1 - i * 0.12);
    for (const s of [-1, 1]) {
      const x0 = cx + s * (1.5 + ok * 9);
      const pts = spline([
        [x0, y],
        [x0 + s * (7 - ok * 2), y - 1.5 - ok * 2],
        [x0 + s * (13 - ok * 3), y + 3],
      ], 4);
      for (let j = 0; j < pts.length - 1; j++) rlimb(p, pts[j][0], pts[j][1], pts[j + 1][0], pts[j + 1][1], 1.9, 1.7, M_STONE, 0.12);
    }
  }
  // Сердце в груди (пока оно там): светит.
  if (r.hrt > 0.5) {
    const hr = 4 + open * 4 + r.br * 0.6;
    for (let y = Math.floor(shY + 21 - hr * 1.2); y <= shY + 21 + hr * 1.2; y++)
      for (let x = Math.floor(cx - hr); x <= cx + hr; x++) {
        const d = Math.hypot((x + 0.5 - cx) / hr, (y + 0.5 - shY - 21) / (hr * 1.15));
        if (d <= 1) glowSet(p, x, y, d < 0.45 ? EMBER_HI : d < 0.8 ? EMBER : VEIN_HOT);
      }
    if (open > 0.4) for (let k = 0; k < 6; k++) haloSet(cx + Math.round(Math.cos(k) * (hr + 2)), shY + 21 + Math.round(Math.sin(k) * (hr + 2)), alpha(EMBER_HI, 0.5));
  }
  rcracks(p, [[cx - 13, shY + 12], [cx + 13, shY + 14], [cx - 7, shY + 31], [cx + 8, shY + 29]], glow, 5);
  // Передние лапы: стоящие — под мордой, занесённая (выше плеча) — поверх неё своим контуром.
  const legs: [P2[], -1 | 1, number][] = [
    [g.legL, -1, r.ply],
    [g.legR, 1, r.pry],
  ];
  for (const [pts, sd, py] of legs) if (py >= -24) frontLeg(p, pts, sd, py, r.cl, 0);
  // Морда анфас с гривой спереди и бородой — слоем (каналы головы с шагом).
  const jq = hq(r.jaw, 0.06);
  const blq = r.bl > 0.5;
  const eyq = r.eye > 0.3 ? hq(r.eye, 0.25) : 0;
  const face = layerOf(`ff|${up}|${msw}|${jq}|${blq ? 1 : 0}|${eyq}`, 104, 100, 52, 50, (q) => {
    for (let i = 0; i < 16; i++) {
      const a0 = -Math.PI / 2 + ((i + 0.5) / 16) * TAU;
      const a = a0 + msw * 0.3 * Math.cos(a0);
      rlock(q, 52 + Math.cos(a0) * 9, 50 + 1 + Math.sin(a0) * 8.5, a, (8 + hash(i, 2, 34) * 4) * (1 + up * 0.3), 7.5, M_MANE, glow, 0.35 * (1 - up * 0.8), i % 6 === 3);
    }
    for (let i = 0; i < 5; i++) rlock(q, 52 - 6 + i * 3, 50 + 9, Math.PI / 2 + (i - 2) * 0.18 + msw * 0.25, 9 + (i % 2) * 3, 6, M_MANE, glow, 0.1, false);
    // Морда анфас.
    const hx = 52;
    const hy = 50;
    rell(q, hx, hy, 10.5, 10, M_STONE, 0.1);
    for (const s of [-1, 1]) {
      rell(q, hx + s * 8.5, hy - 8.5 - up * 1.5, 2.8, 3, M_STONE, 0.1);
      rell(q, hx + s * 8.5, hy - 8 - up * 1.5, 1.4, 1.6, M_FLESH, -0.1);
    }
    rplate(q, [
      [hx - 10.5, hy - 5 - up],
      [hx, hy - 2],
      [hx + 10.5, hy - 5 - up],
      [hx + 9.5, hy - 1.5],
      [hx, hy + 1.5],
      [hx - 9.5, hy - 1.5],
    ], M_STONE, [0, -0.8], 0.15);
    for (const sd of [-1, 1]) rell(q, hx + sd * 6.5, hy + 3, 5, 5.5, M_STONE, sd < 0 ? 0.12 : -0.04);
    rplate(q, [
      [hx - 2.4, hy - 6],
      [hx + 2.4, hy - 6],
      [hx + 3.4, hy + 3],
      [hx - 3.4, hy + 3],
    ], M_STONE, [0, -0.7], 0.22);
    for (const sd of [-1, 1]) rell(q, hx + sd * 3.4, hy + 7, 3.6, 2.8, M_STONE, 0.26);
    const j = jq;
    if (j > 0.15) {
      // Пасть: жар, клыки сверху и снизу.
      rell(q, hx, hy + 11 + j * 2, 5.4, 2 + j * 3.4, M_MEMB, -0.2);
      LITALL = j > 0.35;
      rell(q, hx, hy + 12 + j * 2.6, 2.6, 0.8 + j * 1.6, MOUTH, -0.1);
      LITALL = false;
      for (const s of [-1, 1]) {
        put(q, hx + s * 3, Math.round(hy + 9), BONE[3]);
        put(q, hx + s * 3, Math.round(hy + 10), BONE[2]);
        put(q, hx + s * 3, Math.round(hy + 13 + j * 5), BONE[3]);
        put(q, hx + s * 3, Math.round(hy + 12 + j * 5), BONE[2]);
      }
    } else {
      rell(q, hx, hy + 10.5, 3.4, 2, M_STONE, 0.05);
      for (let x = Math.round(hx - 3); x <= hx + 3; x++) put(q, x, Math.round(hy + 10), INK);
      put(q, Math.round(hx - 3), Math.round(hy + 11), BONE[3]);
      put(q, Math.round(hx + 3), Math.round(hy + 11), BONE[3]);
    }
    for (const sd of [-1, 1]) for (let k = 0; k < 3; k++) put(q, Math.round(hx + sd * (2 + k * 1.3)), Math.round(hy + 6.5 + (k % 2)), M_STONE_FAR.r[1]);
    poly(q, [
      [hx - 3.4, hy + 2.6],
      [hx + 3.4, hy + 2.6],
      [hx, hy + 6],
    ], (x, y) => (y < hy + 3.6 ? M_STONE_FAR.r[4] : M_STONE_FAR.r[1]));
    put(q, Math.round(hx - 1), Math.round(hy + 4), INK);
    put(q, Math.round(hx + 1), Math.round(hy + 4), INK);
    // Глаза — золотые угли во впадинах под бровью.
    const ey = Math.round(hy - 1);
    for (const sd of [-1, 1]) {
      const ex = Math.round(hx);
      for (let k = -1; k <= 2; k++) put(q, ex + sd * (4 + k), ey - (k > 0 ? 1 : 0), INK);
      if (blq) {
        put(q, ex + sd * 4, ey, M_STONE.r[3]);
        put(q, ex + sd * 5, ey, M_STONE.r[3]);
      } else {
        glowSet(q, ex + sd * 4, ey, GOLD_HI);
        glowSet(q, ex + sd * 5, ey, GOLD);
        glowSet(q, ex + sd * 6, ey - 1, GOLD);
        glowSet(q, ex + sd * 5, ey + 1, mixc(EMBER, GOLD, 0.2));
        if (eyq > 0.3) {
          const a = (90 + eyq * 110) / 255;
          haloSet(ex + sd * 5, ey - 1, alpha(GOLD, a * 0.8));
          haloSet(ex + sd * 7, ey - 1, alpha(GOLD, a * 0.6));
          haloSet(ex + sd * 6, ey - 2, alpha(GOLD_HI, a * 0.5));
        }
      }
    }
    rcracks(q, [[hx - 6, hy + 3], [hx + 7, hy - 3]], glow, 9);
    return [52 + 5, Math.round(50 - 1)];
  });
  const feye = blitLayer(p, face, hcx, hy0);
  for (const [pts, sd, py] of legs)
    if (py < -24) {
      const q = scratch('fq', FW, FH);
      frontLeg(q, pts, sd, py, r.cl, r.gl);
      outlineFast(q, INK);
      const a = u32(q);
      const d = u32(p);
      for (let i = 0; i < a.length; i++) if (a[i]) d[i] = a[i];
    }
  const hx = hcx;
  const hy = hy0;
  const ey = Math.round(hy - 1);
  // Обрывки плёнки кокона на плечах и гриве (пробуждение): трясёт — слетают.
  if (scene.shreds && scene.shreds > 0) {
    const n = Math.round(scene.shreds * 6);
    for (let i = 0; i < n; i++) {
      const x0 = cx + (hash(i, 61) - 0.5) * 44;
      const y0 = shY - 6 + hash(i, 62) * 20;
      const a = Math.PI / 2 + (hash(i, 63) - 0.5) * 0.6 + r.msw * 0.5;
      for (let k = 0; k < 6; k++) put(p, Math.round(x0 + Math.cos(a) * k), Math.round(y0 + Math.sin(a) * k), MEMB2[2 + (k % 3)]);
    }
  }
  if (r.st > 0) stoneProg(p, r.st, cx, shY + 21, hy0);
  outlineFast(p, INK);
  if (r.st >= 1) huskCracks(p, 13, 7);
  if (scene.smear) clawSmear(p, scene.smear, scene.smearK ?? 1);
  LIT = null;
  const any = settleLit(p, L);
  return { p, lit: any ? L : null, ax: cx, ay: FG, eye: feye ?? [Math.round(hx) + 5, ey] };
}

/** Распад оболочки: куски падают по очереди, оседают кучей, пыль (k 0…1). */
function crumbleProg(src: Built2, k: number, seed: number): Built2 {
  const p0 = src.p;
  const o = new Px(p0.w, p0.h);
  const L = src.lit ? new Px(p0.w, p0.h) : null;
  const G = src.ay;
  for (let y = 0; y < p0.h; y++)
    for (let x = 0; x < p0.w; x++) {
      const i = (y * p0.w + x) * 4;
      if (!p0.data[i + 3]) continue;
      const bx = x >> 2;
      const by = y >> 2;
      const h0 = hash(bx, by, seed);
      // Сверху — раньше: голова и плечи осыпаются первыми.
      const start = 0.05 + (y / G) * 0.45 + h0 * 0.2;
      const u = clamp01((k - start) / 0.4);
      let tx = x;
      let ty = y;
      let c: RGBA = [p0.data[i], p0.data[i + 1], p0.data[i + 2], 255];
      if (u > 0) {
        if (h0 < 0.18 * u) continue;
        // Падает с ускорением, разлетаясь от середины; у земли — в кучу.
        const fall = u * u * (G - y) * 1.05;
        ty = Math.min(G - 1 - Math.floor(hash(bx, by, seed + 1) * 5 * u), Math.round(y + fall));
        tx = Math.round(x + (x - src.ax) * 0.18 * u + (hash(bx, by, seed + 2) - 0.5) * 6 * u);
        const l = (c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11) / 255;
        c = h0 < 0.3 && u < 0.6 ? EMBER : ramp(M_STONE.r, 0.6 + l * 9 - u * 2, tx, ty);
      }
      if (tx < 0 || ty < 0 || tx >= o.w || ty >= o.h) continue;
      const j = (ty * o.w + tx) * 4;
      o.data[j] = c[0];
      o.data[j + 1] = c[1];
      o.data[j + 2] = c[2];
      o.data[j + 3] = 255;
      if (L && src.lit && src.lit.data[i + 3] && u < 0.5) {
        L.data[j] = src.lit.data[i];
        L.data[j + 1] = src.lit.data[i + 1];
        L.data[j + 2] = src.lit.data[i + 2];
        L.data[j + 3] = Math.round(src.lit.data[i + 3] * (1 - u * 2));
      }
    }
  return { p: o, lit: L, ax: src.ax, ay: src.ay, eye: null };
}


// --- Кокон: живая куколка на корнях. Плёнка тонкая — изнутри просвечивает
// свернувшийся зверь и бьётся свет (в слой света: «свет изнутри» горит и в
// темноте); низ и бока в каменной корке, её колет каждое павшее эхо.

const MEMB2 = rampOf('#12030a', '#2a0812', '#46101c', '#66182a', '#8a2a38', '#b04850', '#d87a70');
const CRUST2 = rampOf('#141011', '#241d1c', '#3a302c', '#54463e', '#726052', '#948070');
const INGLOW2 = hx('#ff6038');
const INGLOW2_HI = hx('#ffc080');
const LFLESH2 = tn('#1a0408', '#380c14', '#581820', '#7a2a32');
const LSTONE2 = tn('#1e1814', '#40352e', '#66584c', '#9a8a78');

const CW = 112;
const CH = 112;
const CG = 102;

interface CocoonPose {
  /** Трещин: целая часть — готовые, дробная — растущая. */
  cracks: number;
  /** Свет изнутри 0…1 (удар сердца), шевеление зверя −1…1. */
  glow: number;
  stir: number;
  /** Толчок изнутри: угол (0 — вправо), сила 0…1. */
  bulgeA: number;
  bulge: number;
  /** Вдох: шире и ниже. */
  breath: number;
}

/** Корни и рёбра-когти кокона (сзади и спереди). */
function cocoonRoots(p: Px, cx: number, G: number): void {
  for (let i = 0; i < 11; i++) {
    const a = Math.PI * (0.02 + (i / 10) * 0.96);
    const x0 = cx + Math.cos(a) * 12;
    const x1 = cx + Math.cos(a) * (32 + (i % 3) * 7);
    const y1 = G - 1 + (i % 2) * 2;
    const mid: P2 = [(x0 + x1) / 2, G - 6 - (i % 2) * 2];
    limb(p, x0, G - 14, mid[0], mid[1], 4.2, 3, LFLESH2);
    limb(p, mid[0], mid[1], x1, y1, 3, 1, LFLESH2);
  }
}

function cocoonRib(p: Px, cx: number, G: number, cy: number, rx: number, ry: number, side: number, i: number, front: boolean): void {
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
}

/** Кокон целым: свет изнутри — в слой света. */
function drawCocoon2(c: CocoonPose): Built2 {
  const p = scratch('cp', CW, CH);
  const L = scratch('cl', CW, CH);
  LIT = L;
  LITALL = false;
  const G = CG;
  const cx = CW / 2;
  const cy = G - 38 - c.breath * 1.2;
  const rx = 23 + c.breath * 1.4;
  const ry = 35 + c.breath * 0.6;
  cocoonRoots(p, cx, G);
  for (const sd of [-1, 1]) cocoonRib(p, cx, G, cy, rx, ry, sd, 1, false);
  // Толчок изнутри выпячивает плёнку.
  const bA = c.bulgeA;
  const bump = (dx: number, dy: number) => {
    if (c.bulge <= 0) return 1;
    const a = Math.atan2(dy, dx);
    let d = a - bA;
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    return 1 + c.bulge * 0.2 * Math.exp(-(d * d) / 0.12);
  };
  const inside = (x: number, y: number): [number, number] | null => {
    const dy = (y + 0.5 - cy) / ry;
    const taper = 1 - Math.max(0, -dy) * 0.28;
    const dx = (x + 0.5 - cx) / (rx * taper);
    const k = bump(dx, dy);
    return dx * dx + dy * dy <= k * k ? [dx / k, dy / k] : null;
  };
  const glow = 0.35 + c.glow * 0.65;
  const su = c.stir * 0.05;
  const beast = (x: number, y: number) => {
    const u = (x - cx) / rx - su;
    const v = (y - cy) / ry;
    const body = Math.hypot((u + 0.08) / 0.46, (v - 0.1) / 0.36) < 1 && Math.hypot((u + 0.1) / 0.2, (v - 0.04) / 0.17) > 1;
    const head = Math.hypot((u - 0.2 - su) / 0.22, (v + 0.3 + su) / 0.18) < 1;
    const wingS = Math.abs(u + 0.3 + v * 0.3) < 0.06 && v > -0.5 && v < 0.3;
    // Лапа упирается в плёнку там, где толчок.
    let paw = false;
    if (c.bulge > 0.2) {
      const px = Math.cos(bA) * 0.62;
      const py = Math.sin(bA) * 0.62;
      paw = Math.hypot((u - px) / 0.13, (v - py) / 0.1) < 1 || (Math.abs((u - px * 0.6) * Math.sin(bA) - (v - py * 0.6) * Math.cos(bA)) < 0.05 && Math.hypot(u, v) < 0.62);
    }
    return body || head || wingS || paw;
  };
  for (let y = Math.floor(cy - ry * 1.25); y <= Math.ceil(cy + ry); y++)
    for (let x = Math.floor(cx - rx * 1.25); x <= Math.ceil(cx + rx * 1.25); x++) {
      const q = inside(x, y);
      if (!q) continue;
      const [dx, dy] = q;
      const nz = Math.sqrt(Math.max(0, 1 - dx * dx - dy * dy));
      const l = dx * LX + dy * LY + nz * LZ;
      const fold = Math.sin(dx * 9 + Math.sin(dy * 5) * 1.3) * 0.5 + 0.5;
      const thin = vn(x / 7, y / 9, 31) * 0.7 + fold * 0.3;
      let col = ramp(MEMB2, 0.7 + l * 3.4 + fold * 0.6, x, y);
      const core = Math.max(0, 1 - Math.hypot(dx * 0.9, dy * 0.8 - 0.05)) * glow;
      const shade = beast(x, y) ? 0.12 : 1;
      const k = Math.max(0, core * (thin - 0.08) * 2.6) * shade + (c.bulge > 0 ? c.bulge * 0.25 * Math.max(0, bump(dx, dy) - 1) * 5 * shade : 0);
      let lit = false;
      if (k > 0.02) {
        col = mixc(col, k > 0.5 ? INGLOW2_HI : INGLOW2, Math.min(0.88, k));
        lit = k > 0.3;
      }
      const vv = vn(x / 11, y / 16, 32);
      if (Math.abs(vv - 0.5) < 0.035) {
        col = mixc(col, k > 0.2 ? INGLOW2 : VEIN_D, 0.7);
        lit = lit || k > 0.2;
      }
      const crust = dy > 0.52 - vn(x / 9, y / 9, 33) * 0.4 || Math.abs(dx) > 0.9 - vn(x / 6, y / 12, 34) * 0.22;
      if (crust) {
        const sm = Math.abs(vn(x / 5.5, y / 4.5, 35) - 0.5) < 0.05;
        col = sm ? CRUST2[0] : ramp(CRUST2, 1.2 + l * 3.4, x, y);
        lit = false;
      }
      put(p, x, y, col);
      if (lit) litCopy(p, x, y);
    }
  for (let i = 0; i < 9; i++) {
    const a = -2.35 + i * 0.07;
    const x = Math.round(cx + Math.cos(a) * rx * 0.72);
    const y = Math.round(cy + Math.sin(a) * ry * 0.7);
    if (inside(x, y)) p.set(x, y, alpha(SPEC, 0.85 - Math.abs(i - 4) * 0.12));
  }
  // Трещины корки: по одной на павшее эхо; новая растёт и вспыхивает.
  const full = Math.floor(c.cracks + 1e-6);
  const part = c.cracks - full;
  for (let n = 0; n < Math.min(5, full + (part > 0 ? 1 : 0)); n++) {
    const grow = n < full ? 1 : part;
    let x = cx + (hash(n, 5) - 0.5) * 30;
    let y = cy + 8 + hash(n, 6) * 20;
    let a = -Math.PI / 2 + (hash(n, 7) - 0.5) * 2.2;
    const len = Math.round((20 + n * 4) * grow);
    const fresh = n >= full;
    for (let st = 0; st < len; st++) {
      const X = Math.round(x);
      const Y = Math.round(y);
      if (inside(X, Y)) {
        glowSet(p, X, Y, fresh || glow > 0.75 ? INGLOW2_HI : EMBER);
        if (inside(X + 1, Y)) glowMix(p, X + 1, Y, INGLOW2, fresh ? 0.6 : 0.4);
        if (inside(X - 1, Y)) glowMix(p, X - 1, Y, INGLOW2, 0.25);
        if (fresh) haloSet(X, Y - 1, alpha(INGLOW2_HI, 0.6));
      }
      a += (hash(n, st, 3) - 0.5) * 1.2;
      x += Math.cos(a);
      y += Math.sin(a);
    }
  }
  for (const sd of [-1, 1]) cocoonRib(p, cx, G, cy, rx, ry, sd, 0, true);
  for (const sd of [-1, 1]) limb(p, cx + sd * 6, G - 8, cx + sd * 10, G - 1, 3, 2.2, LFLESH);
  outlineFast(p, INK);
  LIT = null;
  const any = settleLit(p, L);
  return { p, lit: any ? L : null, ax: cx, ay: G, eye: null };
}

/**
 * Лопнувший кокон позади льва: лепестки плёнки наружу (k 0…1 — раскрытие с
 * перелётом), потом вянут и оседают (k 1…2).
 */
function cocoonBack(p: Px, cx: number, G: number, k: number): void {
  const open = k <= 1 ? eOut3(clamp01(k)) * 1.12 - Math.max(0, k - 0.75) * 0.48 : 1;
  const wilt = clamp01(k - 1);
  const savedL = LIT;
  LIT = null;
  // Корни.
  for (let i = 0; i < 11; i++) {
    const a = Math.PI * (0.02 + (i / 10) * 0.96);
    const x0 = cx + Math.cos(a) * 12;
    const x1 = cx + Math.cos(a) * (32 + (i % 3) * 7) * (1 - wilt * 0.2);
    const mid: P2 = [(x0 + x1) / 2, G - 6 - (i % 2) * 2 + wilt * 3];
    limb(p, x0, G - 14 + wilt * 8, mid[0], mid[1], 4.2 - wilt, 3 - wilt * 0.8, LFLESH2);
    limb(p, mid[0], mid[1], x1, G - 1 + (i % 2) * 2, 3 - wilt, 1, LFLESH2);
  }
  // Полость: тёплая, гаснет.
  p.ell(cx, G - 16 + wilt * 6, 20, 9 - wilt * 4, MEMB2[0]);
  LIT = savedL;
  const heat = (1 - wilt) * 0.6;
  if (heat > 0.05) {
    for (let y = Math.floor(G - 23); y <= G - 10; y++)
      for (let x = Math.floor(cx - 14); x <= cx + 14; x++) {
        const d = Math.hypot((x - cx) / 14, (y - (G - 17 + wilt * 6)) / 5.5);
        if (d > 1) continue;
        glowMix(p, x, y, d < 0.5 ? INGLOW2_HI : INGLOW2, heat * (1 - d));
      }
  }
  LIT = null;
  // Лепестки плёнки: верхние стоят за спиной, как расколотая скорлупа,
  // боковые раскинуты до пола; кончики загнуты наружу.
  const n = 9;
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n - 0.5;
    const a = -Math.PI / 2 + u * (0.9 + open * 2.5);
    const side = Math.sign(u) || 1;
    const bx = cx + Math.cos(a) * 8;
    const by = G - 20 + Math.sin(a) * 6 + wilt * 8;
    const len = (36 + (i % 2) * 8 + (1 - Math.abs(u) * 2) * 6) * (1 - wilt * 0.5);
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const nx = -uy;
    const ny = ux;
    const curl = 0.35 + open * 0.35 + wilt * 0.6;
    const pts: P2[] = [];
    const L: P2[] = [];
    const Rr: P2[] = [];
    for (let k = 0; k <= 6; k++) {
      const t = k / 6;
      const bend = curl * t * t;
      const dx = ux * Math.cos(bend * side) - uy * Math.sin(bend * side);
      const dy = ux * Math.sin(bend * side) + uy * Math.cos(bend * side);
      const px = bx + dx * len * t;
      const py = by + dy * len * t + wilt * 12 * t * t;
      const w = 6.5 * (1 - t) + 1;
      L.push([px - nx * w, py - ny * w]);
      Rr.push([px + nx * w, py + ny * w]);
      pts.push([px, py]);
    }
    poly(p, [...L, ...Rr.reverse()], (x, y) => ramp(MEMB2, 2.4 - wilt * 1.3 + ((x - cx) * LX + (y - G) * LY) * 0.04 + (vn(x / 4, y / 4, 36 + i) - 0.5) * 1.2, x, y));
    for (let k = 0; k < pts.length - 2; k++) stroke(p, pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1], VEIN_D, 1);
  }
  for (let i = 0; i < 9; i++) {
    const x = cx + (hash(i, 3) - 0.5) * 70;
    const y = G - 3 - hash(i, 4) * 8;
    polyShade(p, [
      [x - 3, y + 2],
      [x - 1, y - 2],
      [x + 3, y - 1],
      [x + 2, y + 2],
    ], LSTONE2);
  }
  LIT = savedL;
}

// --- Истинное сердце: камень и плоть, бьётся. Сжато — тусклое и маленькое
// (бить бесполезно), раскрыто — разошлись пластины, жар и золотой ореол
// (окно); сильный удар — сжимается и раскрывается крупнее, жилы дёргаются.

const HEART2 = tn('#3a0610', '#6e1020', '#a8202e', '#e85060');
const HEART2_DIM = tn('#2a040c', '#4e0a16', '#761622', '#a83444');
const HW = 72;
const HH = 80;
const HG = 72;

interface HeartPose {
  /** Размер (1 — покой). */
  sz: number;
  /** Свет нутра 0…1. */
  glow: number;
  /** Раскрыто (окно): пластины разошлись, ореол. */
  open: boolean;
  /** Пластины: 0 — сомкнуты, 1 — разошлись. */
  plates: number;
  /** Сдвиг жил (дёрг), −1…1. */
  twitch: number;
  /** Распад 0…1 (финал). */
  die: number;
  /** Капает: вырвано из груди. */
  torn: number;
}

function drawHeart2(h: HeartPose): Built2 {
  const p = scratch('hp', HW, HH);
  const L = scratch('hl', HW, HH);
  LIT = L;
  LITALL = false;
  const cx = HW / 2;
  const cy = 38;
  const sz = h.sz;
  const T = h.glow > 0.45 ? HEART2 : HEART2_DIM;
  const vessel = h.glow > 0.45 ? tn('#4a0a14', '#8a1626', '#c02a3a', '#f06070') : tn('#3a0810', '#6a1220', '#962230', '#c04858');
  const tw = h.twitch;
  // Аорта и стволы сверху; у вырванного — оборваны, капают.
  const arch = spline([
    [cx - 2, cy - 10 * sz],
    [cx - 4 + tw * 0.6, cy - 20 * sz],
    [cx + 6, cy - 25 * sz],
    [cx + 12 - tw * 0.5, cy - 16 * sz],
  ], 6);
  for (let i = 0; i < arch.length - 1; i++) limb(p, arch[i][0], arch[i][1], arch[i + 1][0], arch[i + 1][1], 4, 3.8, vessel);
  for (const [x, hh] of [
    [cx - 3, 8],
    [cx + 3, 10],
    [cx + 9, 7],
  ] as [number, number][])
    limb(p, x, cy - 22 * sz, x + (x - cx) * 0.2 + tw * 0.8, cy - 22 * sz - hh * (1 - h.torn * 0.4), 2.2, 1.6, vessel);
  limb(p, cx - 12 * sz, cy - 6, cx - 16 * sz - tw, cy - 18 * sz, 3, 2.4, vessel, -0.1);
  // Тело: два желудочка.
  const rx = 15 * sz;
  const ry = 17 * sz;
  p.ell(cx, cy + 2, rx, ry, (x, y) => {
    const dx = (x + 0.5 - cx) / rx;
    const dy = (y + 0.5 - cy - 2) / ry;
    const nz = Math.sqrt(Math.max(0, 1 - dx * dx - dy * dy));
    return tone(T, dx * LX + dy * LY + nz * LZ);
  });
  poly(p, [
    [cx - 11 * sz, cy + 10 * sz],
    [cx + 8 * sz, cy + 12 * sz],
    [cx - 4 * sz, cy + 22 * sz],
  ], (x, y) => tone(T, 0.55 - (y - cy) * 0.03 - (x - cx) * 0.02));
  const groove = spline([
    [cx + 3, cy - 12 * sz],
    [cx + 1 + tw * 0.5, cy],
    [cx - 3, cy + 12 * sz],
    [cx - 4, cy + 19 * sz],
  ], 6);
  for (let i = 0; i < groove.length - 1; i++) stroke(p, groove[i][0], groove[i][1], groove[i + 1][0], groove[i + 1][1], VEIN_D, 2);
  // Нутро светит в щелях — сильнее, чем шире разошлись пластины.
  const pl = h.plates;
  if (pl > 0.05 || h.glow > 0.5) {
    const k = Math.max(pl, (h.glow - 0.5) * 0.6);
    for (let y = Math.floor(cy + 2 - ry * 0.7); y <= cy + 2 + ry * 0.7; y++)
      for (let x = Math.floor(cx - rx * 0.72); x <= cx + rx * 0.72; x++) {
        const d = Math.hypot((x + 0.5 - cx) / (rx * 0.72), (y + 0.5 - cy - 2) / (ry * 0.7));
        if (d > 1) continue;
        const c = d < 0.35 ? (h.open ? GOLD_HI : EMBER_HI) : d < 0.7 ? (h.open ? EMBER_HI : EMBER) : mixc(EMBER, VEIN_HOT, 0.4);
        if (k > 0.4 || d < 0.6) glowSet(p, x, y, c);
      }
  }
  const plates: [number, number, number][] = [
    [-8, -6, 0.2],
    [7, -8, -0.3],
    [-10, 6, 0.5],
    [9, 5, -0.5],
    [-2, 13, 0.1],
  ];
  for (const [ox, oy, rot] of plates) {
    const px = cx + ox * sz * (0.82 + pl * 0.6);
    const py = cy + oy * sz * (0.85 + pl * 0.38);
    const w = 7 * sz;
    const hh = 5.5 * sz;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const pt = (x: number, y: number): P2 => [px + x * c - y * s, py + x * s + y * c];
    polyShade(p, [pt(-w, -hh * 0.6), pt(-w * 0.2, -hh), pt(w, -hh * 0.4), pt(w * 0.8, hh * 0.8), pt(-w * 0.6, hh)], LSTONE2, 0.1);
    const [ax, ay] = pt(-w * 0.4, -hh * 0.3);
    const [bx, by] = pt(w * 0.3, hh * 0.4);
    const n = Math.ceil(Math.hypot(bx - ax, by - ay)) + 1;
    for (let i = 0; i <= n; i++) {
      const X = Math.round(ax + ((bx - ax) * i) / n);
      const Y = Math.round(ay + ((by - ay) * i) / n);
      if (h.glow > 0.4) glowSet(p, X, Y, h.open ? EMBER_HI : EMBER);
      else put(p, X, Y, VEIN);
    }
  }
  // Жилы поверх: светятся ударом, дёргаются.
  for (let i = 0; i < 3; i++) {
    const j = (i % 2 ? 1 : -1) * tw;
    const pts = spline([
      [cx - 12 * sz + i * 10 * sz, cy - 8 * sz],
      [cx - 10 * sz + i * 9 * sz + j, cy + 3],
      [cx - 6 * sz + i * 6 * sz, cy + 14 * sz],
    ], 5);
    for (let k = 0; k < pts.length - 1; k++) {
      const n = Math.ceil(Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]) * 2) + 1;
      for (let s = 0; s <= n; s++) {
        const X = Math.round(pts[k][0] + ((pts[k + 1][0] - pts[k][0]) * s) / n);
        const Y = Math.round(pts[k][1] + ((pts[k + 1][1] - pts[k][1]) * s) / n);
        if (!p.solid(X, Y)) continue;
        if (h.glow > 0.55) glowSet(p, X, Y, VEIN_HOT);
        else put(p, X, Y, VEIN);
      }
    }
  }
  // Вырванное: капли с оборванных жил.
  if (h.torn > 0) {
    for (let i = 0; i < 4; i++) {
      const x = cx - 9 + i * 6 + Math.round(tw);
      const yb = Math.round(cy + 18 * sz + (i % 2) * 3);
      const len = 2 + Math.round(h.torn * (2 + (i % 3)));
      for (let k = 0; k < len; k++) put(p, x, yb + k, k === len - 1 ? HEART2[3] : HEART2[1]);
    }
  }
  outlineFast(p, INK);
  if (h.open) {
    // Окно: золотой ореол вокруг силуэта — только в слое света.
    const a = new Uint8Array(HW * HH);
    for (let i = 0; i < HW * HH; i++) a[i] = p.data[i * 4 + 3] ? 1 : 0;
    for (let y = 1; y < HH - 1; y++)
      for (let x = 1; x < HW - 1; x++) {
        const i = y * HW + x;
        if (a[i]) continue;
        if (a[i - 1] || a[i + 1] || a[i - HW] || a[i + HW]) haloSet(x, y, alpha(GOLD, 0.85));
        else if (a[i - 2] || a[i + 2] || a[i - 2 * HW] || a[i + 2 * HW]) haloSet(x, y, alpha(GOLD_HI, 0.35));
      }
  }
  LIT = null;
  const any = settleLit(p, L);
  let b: Built2 = { p, lit: any ? L : null, ax: cx, ay: HG, eye: [cx + 4, cy - 4] };
  if (h.die > 0) b = heartBurst(b, h.die);
  return b;
}

/**
 * Финал сердца (v2.87): последнее сжатие → сквозь пластины бьёт золото →
 * взрыв: пять каменных пластин и куски плоти разлетаются целыми и падают,
 * аорта летит вверх, нутро вспыхивает золотым шаром и гаснет углями.
 * Первые ~0,33 с идут в замедлении (финал), поэтому взрыв — на 0,18.
 */
const HDW = 132;
const HDH = 124;
const HDG = 108;
function drawHeartDeath(t: number): Built2 {
  const p = new Px(HDW, HDH);
  const L = new Px(HDW, HDH);
  const cx = HDW / 2;
  const cy = HDG - (HG - 38);
  const paste = (b: Built2) => {
    const ox = Math.round(cx - b.ax);
    const oy = Math.round(HDG - b.ay);
    for (let y = 0; y < b.p.h; y++)
      for (let x = 0; x < b.p.w; x++) {
        const i = (y * b.p.w + x) * 4;
        const tx = x + ox;
        const ty = y + oy;
        if (tx < 0 || ty < 0 || tx >= HDW || ty >= HDH) continue;
        const j = (ty * HDW + tx) * 4;
        if (b.p.data[i + 3]) {
          p.data[j] = b.p.data[i];
          p.data[j + 1] = b.p.data[i + 1];
          p.data[j + 2] = b.p.data[i + 2];
          p.data[j + 3] = 255;
        }
        if (b.lit && b.lit.data[i + 3]) {
          L.data[j] = b.lit.data[i];
          L.data[j + 1] = b.lit.data[i + 1];
          L.data[j + 2] = b.lit.data[i + 2];
          L.data[j + 3] = b.lit.data[i + 3];
        }
      }
  };
  const BURST = 0.18;
  if (t < BURST) {
    // Последнее сжатие (дрожь), потом раздувается — сквозь швы бьёт золото.
    const sq = t < 0.09;
    const k = sq ? eOut(t / 0.09) : seg(t, 0.09, BURST);
    const hp: HeartPose = sq
      ? { sz: lerp(1.05, 0.7, k), glow: 0.35, open: false, plates: 0, twitch: Math.floor(t * 70) % 2 ? 1.5 : -1.5, die: 0, torn: 0 }
      : { sz: lerp(0.7, 1.16, eOut(k)), glow: 1, open: false, plates: k * 0.5, twitch: 0, die: 0, torn: 0 };
    paste(drawHeart2(hp));
    if (!sq) {
      LIT = L;
      for (let n = 0; n < 7; n++) {
        let a = (n / 7) * TAU + hash(n, 3) * 0.6;
        let x = cx;
        let y = cy;
        const len = 6 + k * 16;
        for (let st = 0; st < len; st++) {
          if (p.solid(Math.round(x), Math.round(y))) glowSet(p, x, y, st < 4 ? WHITE : GOLD_HI);
          a += (hash(n, st, 7) - 0.5) * 0.7;
          x += Math.cos(a);
          y += Math.sin(a) * 0.9;
        }
      }
      LIT = null;
    }
    return { p, lit: L, ax: cx, ay: HDG, eye: null };
  }
  const u = t - BURST;
  const G = HDG;
  const grav = 300;
  /** Обломок: полёт с вращением, у пола — лёг и остыл. */
  const fly = (i: number, sp: number, up: number): { x: number; y: number; a: number; land: number } => {
    const dir = (i / 5) * TAU + hash(i, 11) * 0.8 - Math.PI / 2;
    const vx = Math.cos(dir) * sp * (0.8 + hash(i, 12) * 0.5);
    const vy = Math.sin(dir) * sp * 0.6 - up;
    let x = cx + Math.cos(dir) * 8 + vx * u;
    let y = cy + Math.sin(dir) * 8 + vy * u + 0.5 * grav * u * u;
    const om = (hash(i, 13) - 0.5) * 14;
    let a = om * u;
    // Время касания пола (решение квадратного уравнения), дальше — лежит.
    const y0 = cy + Math.sin(dir) * 8;
    const disc = vy * vy + 2 * grav * (G - 3 - y0);
    const tl = disc > 0 ? (-vy + Math.sqrt(disc)) / grav : 9;
    let land = 0;
    if (u > tl) {
      x = cx + Math.cos(dir) * 8 + vx * tl + vx * 0.15 * Math.min(0.2, u - tl);
      y = G - 3;
      a = om * tl;
      land = u - tl;
    }
    return { x, y, a, land };
  };
  // Пластины — целыми.
  const plates: [number, number][] = [
    [7, 5.5],
    [7, 5.5],
    [6.5, 5],
    [6.5, 5],
    [6, 5],
  ];
  plates.forEach(([w, h], i) => {
    const f = fly(i, 70, 70);
    const fade = seg(u, 0.75 + hash(i, 15) * 0.25, 1.2);
    if (fade >= 1) return;
    const c = Math.cos(f.a);
    const sn = Math.sin(f.a);
    const pt = (x: number, y: number): P2 => [f.x + x * c - y * sn, f.y + x * sn + y * c];
    const pts = [pt(-w, -h * 0.6), pt(-w * 0.2, -h), pt(w, -h * 0.4), pt(w * 0.8, h * 0.8), pt(-w * 0.6, h)];
    poly(p, pts, (x, y) => (hash(x, y, 31) < fade ? ([0, 0, 0, 0] as RGBA) : tone(LSTONE2, ((x - f.x) * LX + (y - f.y) * LY) / w + 0.5 - f.land * 0.8)));
    // Раскалённый шов в пластине остывает на лету.
    if (u < 0.45) {
      LIT = L;
      const [ax, ay] = pt(-w * 0.4, -h * 0.3);
      const [bx, by] = pt(w * 0.3, h * 0.4);
      for (let k = 0; k <= 6; k++) {
        const X = ax + ((bx - ax) * k) / 6;
        const Y = ay + ((by - ay) * k) / 6;
        if (p.solid(Math.round(X), Math.round(Y))) glowSet(p, X, Y, u < 0.2 ? GOLD_HI : EMBER);
      }
      LIT = null;
    }
  });
  // Куски плоти — мельче и быстрее; кровь темнеет.
  for (let i = 0; i < 7; i++) {
    const f = fly(i + 7, 95, 40);
    const fade = seg(u, 0.55 + hash(i, 16) * 0.3, 1.1);
    if (fade >= 1) continue;
    const r = 2 + hash(i, 17) * 1.6;
    p.ell(f.x, f.y - (f.land > 0 ? 0 : 0), r + (f.land > 0 ? 1 : 0), f.land > 0 ? r * 0.5 : r * 0.8, (x, y) =>
      hash(x, y, 41) < fade ? ([0, 0, 0, 0] as RGBA) : tone(HEART2, 0.6 - (y - f.y) * 0.15 - f.land * 1.2),
    );
  }
  // Аорта: рвётся вверх, кувыркаясь, и падает.
  {
    const f = fly(2, 30, 140);
    const fade = seg(u, 0.8, 1.2);
    if (fade < 1) {
      const c = Math.cos(f.a * 0.6);
      const sn = Math.sin(f.a * 0.6);
      const arcP: P2[] = [
        [-6, 4],
        [-5, -4],
        [3, -7],
        [7, -1],
      ];
      const pts = spline(arcP.map(([x, y]) => [f.x + x * c - y * sn, f.y + x * sn + y * c] as P2), 5);
      for (let k = 0; k < pts.length - 1; k++)
        if (hash(k, 3, 51) >= fade) limb(p, pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1], 2.6, 2.4, tn('#4a0a14', '#8a1626', '#c02a3a', '#f06070'));
    }
  }
  outlineFast(p, INK);
  // Нутро: золотой шар — вспыхнул и гаснет (ступенями Байера, как свет вен).
  const fl = u < 0.06 ? u / 0.06 : Math.max(0, 1 - (u - 0.06) / 0.5);
  if (fl > 0) {
    const R = 5 + 26 * eOut(Math.min(1, u / 0.3));
    for (let y = Math.floor(cy - R); y <= cy + R; y++)
      for (let x = Math.floor(cx - R); x <= cx + R; x++) {
        if (x < 0 || y < 0 || x >= HDW || y >= HDH) continue;
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / R;
        if (d > 1) continue;
        const e = (1 - d) * fl * 1.6;
        if (e < BAYER[(y & 3) * 4 + (x & 3)] * 0.9) continue;
        const c = e > 1 ? WHITE : e > 0.6 ? GOLD_HI : e > 0.3 ? GOLD : EMBER;
        const i = (y * HDW + x) * 4;
        L.data[i] = c[0];
        L.data[i + 1] = c[1];
        L.data[i + 2] = c[2];
        L.data[i + 3] = Math.round(255 * Math.min(1, 0.55 + e * 0.5));
      }
  }
  // Угли: вверх и гаснут.
  for (let i = 0; i < 16; i++) {
    const a = hash(i, 21) * TAU;
    const sp = 18 + hash(i, 22) * 34;
    const life = 0.5 + hash(i, 23) * 0.7;
    if (u > life) continue;
    const k = u / life;
    const x = Math.round(cx + Math.cos(a) * sp * u * 1.4);
    const y = Math.round(cy + Math.sin(a) * sp * u * 0.8 - 26 * u - 10 * k * k);
    if (x < 0 || y < 0 || x >= HDW || y >= HDH) continue;
    const c = k < 0.4 ? GOLD_HI : k < 0.75 ? EMBER_HI : EMBER;
    const j = (y * HDW + x) * 4;
    L.data[j] = c[0];
    L.data[j + 1] = c[1];
    L.data[j + 2] = c[2];
    L.data[j + 3] = Math.round(255 * (1 - k * 0.6));
  }
  return { p, lit: L, ax: cx, ay: HDG, eye: null };
}

/**
 * Финал сердца: пластины разлетаются, нутро вспыхивает золотом и гаснет
 * углём; осколки падают к земле.
 */
function heartBurst(src: Built2, k: number): Built2 {
  const p0 = src.p;
  const o = new Px(p0.w, p0.h);
  const L = new Px(p0.w, p0.h);
  const cx = src.ax;
  const cy = 40;
  for (let y = 0; y < p0.h; y++)
    for (let x = 0; x < p0.w; x++) {
      const i = (y * p0.w + x) * 4;
      if (!p0.data[i + 3]) continue;
      const bx = x >> 2;
      const by = y >> 2;
      const h0 = hash(bx, by, 71);
      const u = clamp01((k - h0 * 0.25) / 0.75);
      if (u > 0 && h0 < u * 0.85) continue;
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.hypot(dx, dy) || 1;
      const fly = u * (6 + h0 * 10);
      const tx = Math.round(x + (dx / d) * fly);
      const ty = Math.round(y + (dy / d) * fly * 0.6 + u * u * 26);
      if (tx < 0 || ty < 0 || tx >= o.w || ty >= o.h) continue;
      const j = (ty * o.w + tx) * 4;
      const l = (p0.data[i] * 0.3 + p0.data[i + 1] * 0.59 + p0.data[i + 2] * 0.11) / 255;
      const c = u > 0.5 ? ramp(M_STONE.r, 0.6 + l * 7, tx, ty) : mixc([p0.data[i], p0.data[i + 1], p0.data[i + 2], 255], GOLD_HI, Math.max(0, 0.6 - u) * Math.min(1, k * 4));
      o.data[j] = c[0];
      o.data[j + 1] = c[1];
      o.data[j + 2] = c[2];
      o.data[j + 3] = 255;
      if (u < 0.6) {
        L.data[j] = c[0];
        L.data[j + 1] = c[1];
        L.data[j + 2] = c[2];
        L.data[j + 3] = Math.round(255 * (1 - u / 0.6));
      }
    }
  // Вспышка нутра: золотой шар растёт и гаснет — в свете.
  const f = Math.sin(clamp01(k / 0.5) * Math.PI);
  if (f > 0.02) {
    const R = 6 + k * 22;
    for (let y = Math.floor(cy - R); y <= cy + R; y++)
      for (let x = Math.floor(cx - R); x <= cx + R; x++) {
        if (x < 0 || y < 0 || x >= L.w || y >= L.h) continue;
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / R;
        if (d > 1) continue;
        const a = f * (1 - d) * (d < 0.35 ? 1 : 0.7);
        const c = d < 0.3 ? WHITE : d < 0.6 ? GOLD_HI : GOLD;
        const i = (y * L.w + x) * 4;
        if (L.data[i + 3] / 255 >= a) continue;
        L.data[i] = c[0];
        L.data[i + 1] = c[1];
        L.data[i + 2] = c[2];
        L.data[i + 3] = Math.round(a * 255);
      }
  }
  return { p: o, lit: L, ax: src.ax, ay: src.ay, eye: null };
}

// --- Кровяной сгусток: катится (блик ходит по кругу), набухает, лопается.

const CLOT = tn('#2a0408', '#5a0a14', '#9a1826', '#e04a50');

function drawClot2(f: number, swell: number, wob: number, splat: number): Built2 {
  const p = new Px(28, 26);
  const L = new Px(28, 26);
  LIT = L;
  LITALL = false;
  const cx = 14;
  const G = 22;
  if (splat > 0) {
    // Лопнул: хлопок кольцом, капли летят дугой, на полу — глянцевая лужица.
    const k = eOut(splat);
    const r = 3.5 + k * 5;
    const ry = r * 0.36;
    for (let y = Math.floor(G - 1 - ry); y <= G - 1 + ry; y++)
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        const dx = (x + 0.5 - cx) / r;
        const dy = (y + 0.5 - (G - 1)) / ry;
        const q = dx * dx + dy * dy;
        if (q > 1) continue;
        put(p, x, y, q < 0.3 && dx < 0.1 && dy < 0 ? CLOT[2] : q > 0.75 ? CLOT[0] : CLOT[1]);
      }
    put(p, Math.round(cx - r * 0.4), Math.round(G - 1 - ry * 0.4), WET);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU + hash(i, 4) * 0.5;
      const d = 2 + k * (7 + hash(i, 5) * 6);
      const x = cx + Math.cos(a) * d;
      const y = G - 2 + Math.sin(a) * d * 0.4 - Math.sin(splat * Math.PI) * (4 + 5 * hash(i, 6));
      put(p, Math.round(x), Math.round(y), i % 3 ? CLOT[2] : CLOT[3]);
      if (hash(i, 7) < 0.4) put(p, Math.round(x), Math.round(y) + 1, CLOT[1]);
      if (splat < 0.45) glowSet(p, x, y, i % 2 ? EMBER : VEIN_HOT);
    }
    outlineFast(p, INK);
    if (splat < 0.3) {
      // Хлопок: тонкое кольцо жара — только в свете.
      const R = 4 + splat * 22;
      for (let a = 0; a < TAU; a += 0.25) haloSet(cx + Math.cos(a) * R, G - 4 + Math.sin(a) * R * 0.55, alpha(EMBER_HI, 0.8 - splat * 2));
    }
    LIT = null;
    const any = settleLit(p, L);
    return { p, lit: any ? L : null, ax: cx, ay: G, eye: null };
  }
  const r = 4.2 + swell * 2.6;
  const sq = Math.sin((f / 8) * TAU * 2) * 0.35 * (1 - swell) + wob;
  const cy = G - 1 - r * (1 - sq * 0.15);
  const rx = r * (1 + sq * 0.12);
  const ry = r * (1 - sq * 0.12);
  shadeEll(p, cx, cy, rx, ry, CLOT);
  // Жилы плёнки крутятся с качением; набухший — светятся.
  for (let i = 0; i < 3; i++) {
    const a = (f / 8) * TAU + i * 2.1;
    const x0 = cx + Math.cos(a) * rx * 0.2;
    const y0 = cy + Math.sin(a) * ry * 0.2;
    const x1 = cx + Math.cos(a + 0.7) * rx * 0.85;
    const y1 = cy + Math.sin(a + 0.7) * ry * 0.85;
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 1.6) + 1;
    for (let s = 0; s <= n; s++) {
      const X = Math.round(x0 + ((x1 - x0) * s) / n);
      const Y = Math.round(y0 + ((y1 - y0) * s) / n);
      if (swell > 0.3) glowSet(p, X, Y, swell > 0.7 ? EMBER_HI : VEIN_HOT);
      else put(p, X, Y, VEIN_D);
    }
  }
  if (swell > 0.35) {
    for (let y = Math.floor(cy - ry * 0.45); y <= cy + ry * 0.45; y++)
      for (let x = Math.floor(cx - rx * 0.45); x <= cx + rx * 0.45; x++)
        if (Math.hypot((x + 0.5 - cx) / (rx * 0.45), (y + 0.5 - cy) / (ry * 0.4)) <= 1) glowMix(p, x, y, EMBER_HI, 0.3 + swell * 0.4);
  }
  // Блик ходит по кругу — шар катится.
  const ha = -2.3 + (f / 8) * 0.6;
  put(p, Math.round(cx + Math.cos(ha) * rx * 0.55), Math.round(cy + Math.sin(ha) * ry * 0.55), WET);
  const ex = Math.round(cx + 2 + Math.cos((f / 8) * TAU) * 0.6);
  const ey = Math.round(cy - 1);
  glowSet(p, ex, ey, hx('#ff5060'));
  outlineFast(p, INK);
  LIT = null;
  const any = settleLit(p, L);
  return { p, lit: any ? L : null, ax: cx, ay: G, eye: [ex, ey] };
}


// ---------------------------------------------------------------------------
// Техники: одна дорожка ключей на весь ход — режим мозга и то, что за ним
// (когти → проводка, присед → прыжок → приземление, прицел → пике →
// посадка), чтобы запаздывающие части не прыгали на смене режима.
// Время хода τ; контакт — ровно в миг урона мозга.
// ---------------------------------------------------------------------------

/** Всё, что двигалось, — на место (крылья — сложены, если есть). */
const BACKK = (w: boolean): Partial<LRig> => ({
  cr: 0,
  rear: 0,
  bx: 0,
  by: 0,
  br: 0,
  hd: 0,
  hx: 0,
  hy: 0,
  jaw: 0,
  mane: 0,
  msw: 0,
  tail: 0,
  tup: 0,
  snk: 0,
  fnx: 0,
  fny: 0,
  fna: 0,
  cl: 0,
  ffx: 0,
  ffy: 0,
  ffa: 0,
  hnx: 0,
  hny: 0,
  hfx: 0,
  hfy: 0,
  hna: 0,
  eye: 0,
  tdx: 0,
  tdy: 0,
  tsx: 1,
  tsy: 1,
  trot: 0,
  ...(w ? WFOLD : {}),
});

/** Дрожь натяжения: 12 к/с, ± по каналам. */
function tremble(r: LRig, t: number, a: number, b: number, k: Partial<Record<RKey, number>>): void {
  if (t <= a || t >= b) return;
  const q = Math.floor(t * 12) % 2 ? 1 : -1;
  for (const ch of Object.keys(k) as RKey[]) r[ch] += q * k[ch]!;
}

// --- Покой: вдох раз в 2,4 с, грива и хвост с запозданием, змея оглядывается.

const IDLE_N = 24;
function tIdle(ph: number, w: boolean): LRig {
  const a = ph * TAU;
  const br = 0.5 - 0.5 * Math.cos(a);
  const r = RW(w);
  r.br = br;
  r.by = br * 1.3;
  r.hd = 0.05 * Math.sin(a - 0.9);
  r.hy = 0.7 * Math.sin(a - 1.3);
  r.jaw = Math.max(0, Math.sin(a + 2.4)) * 0.14;
  r.mane = 0.12 * br;
  r.msw = 0.4 * Math.sin(a - 1.7);
  r.tail = 0.55 * Math.sin(a + 0.4) + 0.2 * Math.sin(2 * a);
  r.tup = 0.25 + 0.18 * Math.sin(a - 0.6);
  r.snk = 0.7 * Math.sin(2 * a + 1);
  r.bl = ph > 0.76 && ph < 0.81 ? 1 : 0;
  // Передняя лапа чуть переминается.
  r.fnx = 0.6 * Math.max(0, Math.sin(a * 2 - 0.5));
  if (w) {
    r.wa = (WFOLD.wa ?? 0) + 0.1 * Math.sin(a - 0.6);
    r.wa2 = (WFOLD.wa2 ?? 0) + 0.1 * Math.sin(a - 0.9);
    r.wo = (WFOLD.wo ?? 0) + 0.05 * br;
  }
  return r;
}

// --- Бег: лапы по земле не скользят (шаг — от пройденного пути), вес на
// приземлении лапы, голова и грива против хода.

const WALK_N = 12;
/** Пройдено пикселей за полный цикл шага. */
const WALK_CYC = 34;

function gait(ph: number, off: number, S: number, lift: number): [number, number, number] {
  const q = (((ph + off) % 1) + 1) % 1;
  const st = 0.6;
  if (q < st) return [S / 2 - (S * q) / st, 0, 0];
  const k = (q - st) / (1 - st);
  return [-S / 2 + S * eIO(k), -Math.sin(k * Math.PI) * lift, Math.sin(k * Math.PI) * (k < 0.55 ? 0.9 : -0.25)];
}

function tWalk(ph: number, w: boolean): LRig {
  const r = RW(w);
  const a = ph * TAU;
  const hn = gait(ph, 0, 18, 5);
  const fn = gait(ph, 0.25, 20, 6.5);
  const hf = gait(ph, 0.5, 18, 5);
  const ff = gait(ph, 0.75, 20, 6.5);
  r.hnx = hn[0];
  r.hny = hn[1];
  r.hna = hn[2] * 0.7;
  r.fnx = fn[0];
  r.fny = fn[1];
  r.fna = fn[2];
  r.hfx = hf[0];
  r.hfy = hf[1];
  r.ffx = ff[0];
  r.ffy = ff[1];
  r.ffa = ff[2];
  r.by = 1.2 * Math.cos(2 * a + 0.4);
  r.bx = 0.8 * Math.sin(2 * a);
  r.rear = 0.05 * Math.sin(a + 0.6);
  r.hd = 0.07 * Math.sin(2 * a + 1.4);
  r.hy = -0.8 * Math.cos(2 * a + 1.2);
  r.jaw = 0.1;
  r.mane = 0.15;
  r.msw = 0.45 * Math.sin(2 * a - 1.4);
  r.tail = 0.45 * Math.sin(a - 1.1);
  r.tup = 0.2 + 0.1 * Math.sin(2 * a - 2);
  r.snk = 0.5 * Math.sin(a + 2);
  if (w) {
    r.wa = (WFOLD.wa ?? 0) + 0.12 * Math.sin(2 * a - 1);
    r.wa2 = (WFOLD.wa2 ?? 0) + 0.12 * Math.sin(2 * a - 1.3);
  }
  return r;
}

// --- Когти: подготовка всю метку (вес назад, лапа взведена над головой,
// когти выходят) → удар по дуге вперёд-вниз → контакт ровно в T → загреб
// по земле → возврат. Комбо (с «КРЫЛЬЕВ») — апперкот той же лапой.

const clawT = (h: number) => LION.clawWarn / h;
const recT = (h: number) => 0.7 / h;

function clawKeys(T: number, w: boolean): LKey[] {
  const k: LKey[] = [
    [0, {}],
    [0.12 * T, { bx: -2, cr: 0.15, hd: -0.04, jaw: 0.15, mane: 0.25, tail: 0.3, eye: 0.4 }, eOut],
    [0.3 * T, { bx: -3, rear: 0.3, cr: 0.18, fnx: 12, fny: -30, fna: -1.0, cl: 0.4, hd: -0.05, hx: -2, jaw: 0.3, mane: 0.5, tail: 0.6, tup: 0.4, eye: 0.8, tsx: 0.98, tsy: 1.02, gl: 0 }, eOut],
    [0.45 * T, { gl: 1 }, eOut],
    [0.55 * T, { bx: -4, rear: 0.5, cr: 0.25, fnx: 22, fny: -44, fna: -1.6, cl: 1, hd: -0.18, hx: -3, hy: -1, jaw: 0.55, mane: 0.75, tail: 0.8, tup: 0.6, eye: 1, tsx: 0.97, tsy: 1.03 }, eIO],
    [0.65 * T, { gl: 0 }, eIn],
    [T - 0.14, { bx: -5.5, rear: 0.58, fnx: 17, fny: -54, fna: -1.9, hd: -0.3, hx: -4, hy: -2, jaw: 0.6, tsx: 0.96, tsy: 1.04 }, eLin],
    [T - 0.07, { bx: 1, rear: 0.25, fnx: 31, fny: -36, fna: -0.8, hd: 0, hx: 1, hy: 0, jaw: 0.9, tsx: 1.02, tsy: 0.99 }, eIn],
    [T, { bx: 7, rear: -0.25, cr: 0.22, fnx: 31, fny: -3, fna: 0.55, hd: -0.05, hx: 5, jaw: 1, mane: 1, tail: -0.6, tdx: 3, tsx: 1.05, tsy: 0.96 }, eIn],
  ];
  if (w) {
    k[2][1].wo = 0.45;
    k[2][1].wa = 0.45;
    k[2][1].wo2 = 0.4;
    k[2][1].wa2 = 0.5;
    k[5][1].wo = 0.55;
    k[5][1].wa = -0.35;
    k[5][1].wo2 = 0.5;
    k[5][1].wa2 = -0.2;
  }
  return k;
}

function clawRecKeys(t0: number, R: number, w: boolean, up: boolean): LKey[] {
  if (up)
    return [
      [t0 + 0.07, { fnx: 28, fny: -64, fna: -1.85, rear: 0.58, bx: 7.5, tdx: 4.2, tsx: 0.97, tsy: 1.05 }, eOut3],
      [t0 + 0.2, { fnx: 22, fny: -40, fna: -1.2, rear: 0.35, bx: 5, jaw: 0.6, tdx: 3, tsx: 1, tsy: 1, cl: 0.6 }, eIO],
      [t0 + 0.6 * R, { bx: 1, rear: 0.05, cr: 0.05, fnx: 6, fny: -6, fna: -0.2, jaw: 0.2, mane: 0.3, tail: 0.2, tdx: 0.6, hd: 0, hx: 0, cl: 0.1, eye: 0.3 }, eIO],
      [t0 + R, BACKK(w), eIO],
    ];
  return [
    [t0 + 0.06, { bx: 8, rear: -0.3, cr: 0.25, fnx: 33, fny: 0, fna: 0.85, tdx: 3.6, tsx: 1.03, tsy: 0.97, cl: 1 }, eOut3],
    [t0 + 0.18, { bx: 5, rear: -0.15, fnx: 25, fny: 0, fna: 0.3, jaw: 0.6, tdx: 2.5, tsx: 1.01, tsy: 0.99, cl: 0.6 }, eIO],
    [t0 + 0.6 * R, { bx: 1, rear: 0, cr: 0.08, fnx: 6, fny: -5, fna: -0.2, jaw: 0.2, mane: 0.3, tail: 0.2, tup: 0.1, tdx: 0.6, tsx: 1, tsy: 1, cl: 0.1, eye: 0.3, hd: 0, hx: 0 }, eIO],
    [t0 + R, BACKK(w), eIO],
  ];
}

function comboKeys(T: number, T2: number, w: boolean): LKey[] {
  return [
    [T + 0.18, { bx: -3, cr: 0.45, rear: -0.2, fnx: 9, fny: -1, fna: 1.0, cl: 1, hd: 0.2, hy: 2, hx: 0, jaw: 0.4, tdx: 2, tsx: 1.04, tsy: 0.96 }, eOut],
    [T2 - 0.14, { bx: -4.5, cr: 0.55, fnx: 7, fny: 0, fna: 1.2, hd: 0.25, tdx: 1.5, tsx: 1.06, tsy: 0.94 }, eLin],
    [T2 - 0.06, { bx: 3, cr: 0.1, rear: 0.25, fnx: 30, fny: -24, fna: -0.6, hd: -0.05, jaw: 0.9, tsx: 0.98, tsy: 1.03 }, eIn],
    [T2, { bx: 7, cr: -0.2, rear: 0.5, fnx: 30, fny: -58, fna: -1.6, hd: -0.25, hx: 4, jaw: 1, mane: 1, tdx: 4, tsx: 0.96, tsy: 1.06, ...(w ? { wa: 0.6, wo: 0.6 } : {}) }, eIn],
  ];
}

// --- Когти анфас (герой внизу — бьёт к нам): правая лапа взведена у морды,
// удар сверху вниз к нам; комбо — левой.

function clawFrontKeys(T: number, w: boolean): LKey[] {
  return [
    [0, {}],
    [0.12 * T, { cr: 0.15, by: 1, hd: -0.05, jaw: 0.2, mane: 0.3, eye: 0.5 }, eOut],
    [0.3 * T, { prx: 4, pry: -30, cl: 0.4, cr: 0.2, by: 2, hd: -0.1, jaw: 0.35, mane: 0.5, shk: -1.5, gl: 0 }, eOut],
    [0.45 * T, { gl: 1 }, eOut],
    [0.55 * T, { prx: 7, pry: -54, cl: 1, by: 3, cr: 0.15, hd: -0.18, jaw: 0.55, mane: 0.8, shk: -3, msw: 0.4, eye: 1, tsx: 0.98, tsy: 1.02, ...(w ? { wo: 0.4, wa: 0.6, wo2: 0.4, wa2: 0.6 } : {}) }, eIO],
    [0.65 * T, { gl: 0 }, eIn],
    [T - 0.14, { prx: 9, pry: -58, by: 4, hd: -0.22, shk: -3.5, tsx: 0.97, tsy: 1.04 }, eLin],
    [T - 0.07, { prx: 2, pry: -36, by: 2, hd: 0, shk: 0, jaw: 0.9, tsx: 1.01, tsy: 0.99 }, eIn],
    [T, { prx: -9, pry: -5, by: -1, cr: 0.45, hd: 0.15, hy: 2, shk: 2, jaw: 1, mane: 1, msw: -0.4, tsx: 1.05, tsy: 0.94, tdy: 2, ...(w ? { wa: -0.3, wa2: -0.3 } : {}) }, eIn],
  ];
}
function clawFrontRec(t0: number, R: number, w: boolean, left: boolean): LKey[] {
  const pa: Partial<LRig> = left ? { plx: 11, ply: 0 } : { prx: -11, pry: 0 };
  const pb: Partial<LRig> = left ? { plx: 6, ply: 0 } : { prx: -6, pry: 0 };
  return [
    [t0 + 0.06, { ...pa, cr: 0.55, tsx: 1.06, tsy: 0.93, tdy: 2.5 }, eOut3],
    [t0 + 0.2, { ...pb, cr: 0.4, jaw: 0.6, tsx: 1.01, tsy: 0.99, tdy: 1.5, cl: 0.6 }, eIO],
    [t0 + 0.6 * R, { prx: 0, pry: 0, plx: 0, ply: 0, cr: 0.1, by: 0, jaw: 0.2, hd: 0, hy: 0, shk: 0, mane: 0.3, msw: 0, tdy: 0, tsx: 1, tsy: 1, cl: 0.1, eye: 0.3 }, eIO],
    [t0 + R, BACKK(w), eIO],
  ];
}
function comboFrontKeys(T: number, T2: number): LKey[] {
  return [
    [T + 0.18, { plx: -7, ply: -50, cl: 1, prx: -6, pry: 0, by: 3, cr: 0.15, shk: 3, hd: -0.15, jaw: 0.5, tdy: 1, tsx: 0.98, tsy: 1.02 }, eOut],
    [T2 - 0.14, { plx: -9, ply: -56, by: 4, shk: 3.5, hd: -0.2 }, eLin],
    [T2 - 0.07, { plx: -2, ply: -34, by: 2, shk: 0, jaw: 0.9, tsx: 1.01, tsy: 0.99 }, eIn],
    [T2, { plx: 9, ply: -5, by: -1, cr: 0.45, hd: 0.15, hy: 2, shk: -2, jaw: 1, mane: 1, msw: 0.4, tsx: 1.05, tsy: 0.94, tdy: 2.5 }, eIn],
  ];
}

function stompFrontKeys(R: number, w: boolean): LKey[] {
  return [
    [0, {}],
    [0.1, { cr: 0.35, hd: 0.1, mane: 0.3 }, eOut],
    [0.36, { cr: -0.2, by: 9, plx: -4, ply: -34, prx: 4, pry: -34, hd: -0.35, jaw: 0.6, mane: 0.8, br: 1, eye: 1, tsy: 1.06, tsx: 0.96, cl: 0.6, ...(w ? { wo: 0.65, wa: 0.85, wo2: 0.65, wa2: 0.85 } : {}) }, eOut3],
    [0.43, { by: 11, ply: -40, pry: -40, hd: -0.42, jaw: 0.7 }, eOut],
    [0.5, { cr: 0.6, by: -2, plx: -6, ply: 0, prx: 6, pry: 0, hd: 0.3, hy: 3, jaw: 1, mane: 1, br: 0, tsx: 1.12, tsy: 0.88, tdy: 3, cl: 1, ...(w ? { wa: -0.5, wa2: -0.5 } : {}) }, eIn3],
    [0.58, { cr: 0.5, tsx: 1.04, tsy: 0.97, tdy: 2 }, eOut],
    [0.85, { cr: 0.55, jaw: 0.9, hd: 0.2, tsx: 1.02, tsy: 0.99 }, eIO],
    [STOMP_T, { cr: 0.1, by: 0, plx: 0, ply: 0, prx: 0, pry: 0, jaw: 0.2, mane: 0.2, hd: 0.05, hy: 0, tsx: 1, tsy: 1, tdy: 0, cl: 0, eye: 0.3, ...(w ? { wo: 0.3, wa: 0, wo2: 0.25, wa2: 0 } : {}) }, eIO],
    [STOMP_T + R, BACKK(w), eIO],
  ];
}

// --- Топот: на дыбы (передние высоко) → удар лапами в 0,5 (шипы) → давит,
// рычит → встаёт.

const STOMP_T = LION.stomp;
function stompKeys(R: number, w: boolean): LKey[] {
  return [
    [0, {}],
    [0.1, { cr: 0.35, rear: -0.15, bx: -2, hd: 0.1, mane: 0.3 }, eOut],
    [0.36, { cr: 0.1, rear: 1, bx: -6, by: 4, fnx: 8, fny: -44, fna: -1.3, ffx: 11, ffy: -41, ffa: -1.1, hd: -0.35, hx: -1, hy: -2, jaw: 0.6, mane: 0.8, tail: 1, tup: 0.8, tsx: 0.97, tsy: 1.04, cl: 0.6, eye: 1, ...(w ? { wo: 0.65, wa: 0.85, wo2: 0.6, wa2: 0.85 } : {}) }, eOut3],
    [0.43, { rear: 1.08, by: 5, fny: -49, ffy: -46, fnx: 6, ffx: 9, hd: -0.42, jaw: 0.7 }, eOut],
    [0.5, { rear: -0.35, cr: 0.55, bx: 3, by: 0, fnx: 14, fny: 0, fna: 0.15, ffx: 16, ffy: 0, ffa: 0.15, hd: 0.25, hx: 3, hy: 2, jaw: 1, mane: 1, tsx: 1.1, tsy: 0.9, tail: -0.5, tup: 0.2, cl: 1, ...(w ? { wa: -0.5, wa2: -0.4 } : {}) }, eIn3],
    [0.58, { cr: 0.45, tsx: 1.03, tsy: 0.98, rear: -0.28 }, eOut],
    [0.85, { cr: 0.5, jaw: 0.9, hd: 0.15, tsx: 1.02, tsy: 0.99 }, eIO],
    [STOMP_T, { cr: 0.1, rear: 0, bx: 0, fnx: 2, ffx: 2, fny: 0, ffy: 0, fna: 0, ffa: 0, jaw: 0.2, mane: 0.2, hd: 0.05, hx: 0, hy: 0, tail: 0, tup: 0, tsx: 1, tsy: 1, cl: 0, eye: 0.3, ...(w ? { wo: 0.3, wa: 0, wo2: 0.25, wa2: 0 } : {}) }, eIO],
    [STOMP_T + R, BACKK(w), eIO],
  ];
}

// --- Прыжок льва: присед (кошка перед броском: переминается задними, хвост
// хлещет) → толчок, полёт по дуге (подъём — полем кадра) → приземление
// сжатием → в 0,35 удар осколков (давит лапами) → окно: тяжело дышит.

const P_C = LION.crouch;
const P_L = LION.crouch + LION.leap;
const P_END = P_L + LION.landed;
const LEAP_H = 2.3;

function pounceKeys(w: boolean): LKey[] {
  return [
    [0, {}],
    [0.18, { cr: 0.75, rear: -0.35, bx: -3, hd: 0.3, hy: 3, jaw: 0.25, mane: 0.4, tail: 0.4, tup: 0.3, fnx: 4, ffx: 5, tsx: 1.04, tsy: 0.96, eye: 0.6 }, eOut3],
    [0.6, { cr: 1, rear: -0.45, bx: -5, hd: 0.35, hy: 4, eye: 1, jaw: 0.35, mane: 0.7, tail: 0.9, tup: 0.9, tsx: 1.07, tsy: 0.93 }, eIO],
    [P_C, { cr: 1.05, bx: -6, tsx: 1.08, tsy: 0.92 }, eIO],
    // Толчок: всё тело — в струну.
    [P_C + 0.06, { cr: -0.45, rear: 0.35, bx: 4, hnx: -16, hny: -2, hfx: -14, hfy: -1, hna: 1.0, fnx: 14, fny: -12, fna: -0.8, ffx: 16, ffy: -10, ffa: -0.7, hd: -0.1, hy: 0, jaw: 0.6, mane: 0.6, tail: -1, tup: 0.2, tsx: 0.9, tsy: 1.12, ...(w ? { wo: 0.8, wa: 0.9, wo2: 0.8, wa2: 0.9 } : {}) }, eOut3],
    [P_C + 0.26, { cr: 0.2, rear: 0.05, fnx: 18, fny: -14, fna: -0.4, ffx: 20, ffy: -12, ffa: -0.3, hnx: -6, hny: -12, hfx: -4, hfy: -11, hna: 0.3, tsx: 1, tsy: 1, jaw: 0.9, mane: 0.9, tail: -0.6, ...(w ? { wa: 0.2, wa2: 0.3 } : {}) }, eIO],
    [P_C + 0.48, { rear: 0.25, fnx: 16, fny: -2, fna: 0.3, ffx: 18, ffy: -2, ffa: 0.3, hnx: -10, hny: -6, hfx: -8, hfy: -5, hd: -0.15, jaw: 1, tsx: 0.95, tsy: 1.06, ...(w ? { wa: 1.0, wa2: 1.0 } : {}) }, eIO],
    [P_L, { cr: 0.4, rear: 0.1, fnx: 10, fny: 0, fna: 0, ffx: 12, ffy: 0, ffa: 0, hnx: -4, hny: 0, hfx: -2, hfy: 0, hna: 0, tsx: 1.08, tsy: 0.92 }, eIn],
    // Приземление: сжатие от веса.
    [P_L + 0.07, { cr: 1.05, rear: -0.25, bx: 3, fnx: 12, ffx: 14, hnx: -2, hfx: 0, hd: 0.3, hy: 4, jaw: 0.5, mane: 1, tsx: 1.14, tsy: 0.86, tail: 0.8, tup: 0, ...(w ? { wo: 0.9, wa: -0.6, wo2: 0.8, wa2: -0.5 } : {}) }, eOut3],
    [P_L + 0.2, { cr: 0.7, tsx: 1.02, tsy: 0.99, hd: 0.15, hy: 1 }, eOut],
    [P_L + 0.3, { cr: 0.6, rear: 0.1, fnx: 13, fny: -4, ffx: 15, ffy: -3, jaw: 0.6, hd: 0.05 }, eIO],
    // 0,35 — осколки: давит лапами в пол, рык.
    [P_L + 0.35, { cr: 0.85, rear: -0.15, fny: 0, ffy: 0, jaw: 1, mane: 1, hd: 0.2, tsx: 1.07, tsy: 0.93, eye: 1 }, eIn],
    [P_L + 0.45, { cr: 0.75, tsx: 1.02, tsy: 0.98, jaw: 0.8 }, eOut],
    // Окно: тяжело дышит (дыхание — поверх дорожки).
    [P_L + 0.6, { cr: 0.65, rear: -0.2, hd: 0.35, hy: 4, jaw: 0.55, mane: 0.3, fnx: 8, ffx: 10, tsx: 1, tsy: 1, eye: 0.2, ...(w ? { wo: 0.6, wa: -0.4, wo2: 0.5, wa2: -0.3 } : {}) }, eIO],
    [P_END - 0.22, { cr: 0.55, hd: 0.3, jaw: 0.5 }, eLin],
    [P_END, BACKK(w), eIO],
  ];
}

/** Подъём прыжка (клеток): парабола, ровно ноль на толчке и на приземлении. */
const leapZ = (k: number) => 4 * k * (1 - k) * LEAP_H;

/** Тяжёлое дыхание окна: бока ходят, пасть открыта (поверх дорожки). */
function pant(r: LRig, t: number, a: number, b: number, hz: number): void {
  const env = seg(t, a, a + 0.15) * (1 - seg(t, b - 0.2, b));
  if (env <= 0) return;
  const s = 0.5 - 0.5 * Math.cos((t - a) * TAU * hz);
  r.br += s * env;
  r.by += s * 1.6 * env;
  r.jaw += (s * 0.25 - 0.05) * env;
  r.hy += s * 0.8 * env;
  r.msw += Math.sin((t - a) * TAU * hz - 1.4) * 0.25 * env;
}

// --- Крылья: взлёт, полёт (взмахи: вниз — быстро, вверх — сложив
// перепонку; бросок перьев — на конце сильного взмаха), прицел пике
// (зависает, крылья назад), пике, тяжёлая посадка.

const FLAP_P = 1.15 / 2;
const FLY_N = 14;
const FLY_H = 3;

/** Поза полёта на доле взмаха φ (0 — конец удара вниз) и сила взмаха. */
function flyRig(ph: number, big: boolean, w: boolean): LRig {
  const r = RW(w);
  const wing = (q: number) => {
    q = ((q % 1) + 1) % 1;
    if (q < 0.62) {
      const k = q / 0.62;
      return { a: -1 + (big ? 2.3 : 2.1) * eIO(k), o: 1 - 0.32 * Math.sin(k * Math.PI), up: 1 - eIO(k) };
    }
    const k = (q - 0.62) / 0.38;
    return { a: (big ? 1.3 : 1.1) - (big ? 2.3 : 2.1) * eIn(k), o: 1, up: eIO(k) };
  };
  const n = wing(ph);
  const f = wing(ph - 0.05);
  r.wa = n.a;
  r.wo = n.o;
  r.wa2 = f.a * 0.92;
  r.wo2 = f.o;
  // В небе крылья во весь размах: на них держится такая туша.
  r.wl = 1.32;
  r.wsw = 0;
  r.wsw2 = 0;
  const bob = n.up;
  r.tdy = -(FLY_H + 0.16 * bob) * 16;
  r.trot = 0.06;
  r.hnx = -8;
  r.hny = -15 + bob * 2;
  r.hfx = -6;
  r.hfy = -14 + bob * 2;
  r.hna = 1.0;
  r.fnx = 9 + Math.sin(ph * TAU) * 1.5;
  r.fny = -22;
  r.fna = -0.5;
  r.ffx = 11;
  r.ffy = -21;
  r.ffa = -0.3;
  r.cr = 0.15;
  r.tail = -0.8 + 0.3 * Math.sin(ph * TAU - 1.2);
  r.tup = 0.1;
  r.snk = 0.6 * Math.sin(ph * TAU - 2);
  r.msw = 0.45 * Math.sin(ph * TAU - 1.6);
  r.mane = 0.3;
  r.hd = -0.05 + 0.06 * Math.sin(ph * TAU - 0.8);
  r.jaw = big ? 0.25 + 0.6 * Math.max(0, Math.sin(ph * TAU + 0.9)) : 0.2;
  r.eye = big ? 0.8 : 0.4;
  return r;
}

/** Доля взмаха на времени полёта и сильный ли он (бросок перьев — на 0,5 и 1,65). */
function flyPhase(t: number): { ph: number; big: boolean } {
  const u = (t - 0.5) / FLAP_P;
  const ph = ((u % 1) + 1) % 1;
  const m = Math.ceil(u - 1e-6);
  return { ph, big: ((m % 2) + 2) % 2 === 0 };
}

const TO_T = LION.takeoff;
function takeoffKeys(w: boolean): LKey[] {
  const end = flyRig(flyPhase(0).ph, flyPhase(0).big, w);
  const e: Partial<LRig> = {};
  for (const ch of RKEYS) if (ch !== 'tdy') e[ch] = end[ch];
  return [
    [0, {}],
    [0.16, { cr: 0.7, rear: 0.1, wo: 1, wa: 1.1, wo2: 1, wa2: 1.05, wl: 1.15, hd: -0.1, jaw: 0.4, tsx: 1.06, tsy: 0.94, mane: 0.4, eye: 0.6 }, eOut],
    [0.28, { cr: -0.3, rear: 0.3, wa: -0.95, wa2: -0.9, hnx: -7, hny: -2, hna: 0.6, hfx: -5, hfy: -1, fnx: 5, fny: -9, fna: -0.5, ffx: 7, ffy: -8, tsx: 0.95, tsy: 1.07, jaw: 0.6 }, eIn3],
    [0.46, { wa: 1.0, wa2: 0.95, wo: 0.65, wo2: 0.65, cr: 0.1, hnx: -6, hny: -11, hfx: -4, hfy: -10, hna: 0.9, fnx: 7, fny: -13, ffx: 9, ffy: -12, tsx: 1, tsy: 1 }, eIO],
    [0.62, { wa: -0.9, wa2: -0.85, wo: 1, wo2: 1 }, eIn],
    [TO_T, e, eOut],
  ];
}
const takeoffZ = (t: number) => FLY_H * eIO(seg(t, 0.24, TO_T)) + 0.2 * Math.sin(seg(t, 0.24, TO_T) * Math.PI);

const D_AIM = LION.swoopAim;
const D_SW = LION.swoopAim + LION.swoop;
const D_END = D_SW + LION.airLanded;
const AIM_H = 3.35;

function diveKeys(w: boolean): LKey[] {
  const st = flyPhase(LION.fly);
  const s0 = flyRig(st.ph, st.big, w);
  const k0: Partial<LRig> = {};
  for (const ch of RKEYS) if (ch !== 'tdy') k0[ch] = s0[ch];
  return [
    [0, k0],
    [0.25, { wa: -0.6, wa2: -0.55, wo: 1, wo2: 1 }, eIn],
    [0.5, { wa: 1.3, wsw: -0.3, wa2: 1.25, wsw2: -0.28, wo: 0.55, wo2: 0.55, trot: 0.3, hd: 0.3, hy: 2, jaw: 0.6, fnx: 12, fny: -10, fna: -0.9, cl: 1, ffx: 14, ffy: -9, ffa: -0.8, hnx: -10, hny: -8, hfx: -8, hfy: -7, tail: -1, eye: 1, mane: 0.8 }, eIO],
    [0.85, { wsw: -0.4, wsw2: -0.38, wo: 0.4, wo2: 0.4, trot: 0.35, tsx: 0.95, tsy: 1.05 }, eIO],
    [D_AIM, { trot: 0.5, wsw: -0.45, wsw2: -0.42, wo: 0.25, wo2: 0.25, tsx: 1.12, tsy: 0.9, jaw: 1, hd: 0.35 }, eIn],
    [D_AIM + 0.3, { trot: 0.55, tsx: 1.2, tsy: 0.86, fnx: 18, fny: -6, ffx: 20, ffy: -5, cl: 1 }, eLin],
    [D_SW, { trot: 0.12, tsx: 1.1, tsy: 0.9, fnx: 14, fny: 0, ffx: 16, ffy: 0, hnx: -6, hny: 0, hfx: -4, hfy: 0, hna: 0.3, wo: 0.6, wsw: -0.2, wa: 0.4, wo2: 0.55, wsw2: -0.2, wa2: 0.4 }, eIn],
    // Посадка всем весом: крылья хлопают о пол, юзом вперёд.
    [D_SW + 0.08, { cr: 1.15, rear: -0.4, bx: 5, fnx: 16, ffx: 18, fny: 0, ffy: 0, hnx: 0, hny: 0, hfx: 0, hfy: 0, hna: 0, hd: 0.4, hy: 5, jaw: 0.7, wo: 1, wa: -1.0, wsw: 0, wo2: 0.9, wa2: -0.9, wsw2: 0, trot: 0, tsx: 1.2, tsy: 0.82, tdx: 4, cl: 0.4 }, eOut3],
    [D_SW + 0.25, { tsx: 1.04, tsy: 0.97, cr: 0.9, tdx: 2.5 }, eOut],
    [D_SW + 0.5, { cr: 0.75, rear: -0.25, hd: 0.35, hy: 4, jaw: 0.55, wa: -0.9, wo: 0.9, wa2: -0.8, wo2: 0.8, tdx: 2, tsx: 1, tsy: 1, eye: 0.2, cl: 0 }, eIO],
    [D_END - 0.3, { cr: 0.6, wa: -0.6, wo: 0.6, wa2: -0.5, wo2: 0.5, tdx: 1.5 }, eLin],
    [D_END, BACKK(w), eIO],
  ];
}
/** Высота прицела и пике (клеток). */
const diveZ = (t: number) => (t < D_AIM ? FLY_H + (AIM_H - FLY_H) * eIO(seg(t, 0, 0.85)) : t < D_SW ? AIM_H * (1 - eIn(seg(t, D_AIM, D_SW))) : 0);

// --- Порыв: крылья вверх и назад (вдох) → мах вперёд ровно в урон.

const GUST_T = LION.gustWarn + 0.35;
function gustKeys(R: number, w: boolean, front: boolean): LKey[] {
  if (front)
    return [
      [0, {}],
      [0.35, { wo: 1, wo2: 1, wa: 1.2, wa2: 1.2, wl: 1.05, br: 1, cr: 0.2, by: 2, hd: -0.25, jaw: 0.3, mane: 0.6, tsx: 0.97, tsy: 1.04, eye: 0.8 }, eOut],
      [0.72, { wa: 1.35, wa2: 1.35, by: 3, hd: -0.32 }, eIO],
      [LION.gustWarn, { wa: 0.15, wa2: 0.15, wsw: 1, wsw2: 1, wo: 1, wo2: 1, cr: 0.35, by: 0, br: 0, hd: 0.15, jaw: 1, mane: 1, tsx: 1.06, tsy: 0.95 }, eIn3],
      [LION.gustWarn + 0.1, { wsw: 1.15, wsw2: 1.15, wa: 0, wa2: 0, tsx: 1.02, tsy: 0.99 }, eOut],
      [GUST_T, { wsw: 0.4, wsw2: 0.4, wa: 0.4, wa2: 0.4, wo: 0.6, wo2: 0.6, cr: 0.1, jaw: 0.4, hd: 0, mane: 0.4, tsx: 1, tsy: 1 }, eIO],
      [GUST_T + R, { ...BACKK(w), wsw: 0, wsw2: 0, wa: 0.3, wa2: 0.3, wo: 0.35, wo2: 0.35, wl: 0.9 }, eIO],
    ];
  return [
    [0, {}],
    [0.35, { rear: 0.45, bx: -4, cr: 0.2, wo: 1, wa: 1.05, wsw: -0.15, wo2: 1, wa2: 1.0, wsw2: -0.12, wl: 1.05, br: 1, hd: -0.25, jaw: 0.3, mane: 0.6, tsx: 0.96, tsy: 1.04, eye: 0.8 }, eOut],
    [0.72, { wa: 1.12, wsw: -0.22, wa2: 1.08, wsw2: -0.2, rear: 0.52, bx: -5.5, hd: -0.32 }, eIO],
    [LION.gustWarn, { rear: -0.2, bx: 6, wa: 1, wsw: 0.62, wa2: 1, wsw2: 0.6, wo: 1, br: 0, hd: 0.08, hx: 3, jaw: 1, mane: 1, tsx: 1.05, tsy: 0.96, tdx: 2 }, eIn3],
    [LION.gustWarn + 0.1, { wsw: 0.75, wsw2: 0.72, tsx: 1.02 }, eOut],
    [GUST_T, { wsw: 0.3, wsw2: 0.3, wa: 0.6, wa2: 0.6, wo: 0.6, wo2: 0.6, rear: 0, bx: 2, jaw: 0.5, tdx: 1, hx: 0 }, eIO],
    [GUST_T + R, BACKK(w), eIO],
  ];
}

// --- Веер перьев: взмах на каждый залп (0,45 · 0,8 · 1,15): ближнее,
// дальнее, оба.

const FAN_T = LION.fan;
const FAN_SHOTS = [0.45, 0.8, 1.15];
function fanKeys(R: number, w: boolean, front: boolean): LKey[] {
  const end = front ? { ...BACKK(w), wa: 0.3, wa2: 0.3, wo: 0.35, wo2: 0.35, wl: 0.9 } : BACKK(w);
  return [
    [0, {}],
    [0.25, { wo: 1, wa: 1.0, wsw: -0.2, wl: 1, rear: front ? 0 : 0.25, bx: front ? 0 : -3, by: front ? 2 : 0, hd: -0.15, jaw: 0.3, wo2: 0.7, wa2: 0.6, eye: 0.7 }, eOut],
    [0.45, { wsw: 0.55, wa: 0.85, rear: front ? 0 : -0.1, bx: front ? 0 : 3, cr: front ? 0.2 : 0, hd: 0.05, jaw: 0.8, tsx: 1.03, tsy: 0.97 }, eIn3],
    [0.6, { wsw: 0.05, wa: 0.4, wo2: 1, wa2: 1.05, wsw2: -0.2, rear: front ? 0 : 0.2, bx: front ? 0 : -2, cr: 0, jaw: 0.3, tsx: 1, tsy: 1 }, eIO],
    [0.8, { wsw2: 0.55, wa2: 0.85, rear: front ? 0 : -0.1, bx: front ? 0 : 3, cr: front ? 0.2 : 0, jaw: 0.8, tsx: 1.03, tsy: 0.97 }, eIn3],
    [0.97, { wa: 1.1, wsw: -0.25, wa2: 1.05, wsw2: -0.2, wo: 1, wo2: 1, rear: front ? 0 : 0.35, bx: front ? 0 : -4, by: front ? 3 : 0, cr: 0, br: 1, hd: -0.2, jaw: 0.4, tsx: 0.97, tsy: 1.03 }, eIO],
    [1.15, { wsw: 0.65, wsw2: 0.62, wa: 0.9, wa2: 0.9, rear: front ? 0 : -0.2, bx: front ? 0 : 5, by: 0, cr: front ? 0.3 : 0, br: 0, jaw: 1, mane: 1, tsx: 1.05, tsy: 0.96, tdx: front ? 0 : 1.5 }, eIn3],
    [FAN_T, { wsw: 0.3, wsw2: 0.3, wa: 0.5, wa2: 0.5, wo: 0.6, wo2: 0.6, rear: 0, bx: front ? 0 : 2, cr: 0, jaw: 0.4, tdx: front ? 0 : 0.5 }, eIO],
    [FAN_T + R, end, eIO],
  ];
}

// --- Сцены анфас.

const WAKE_T = LION.wake;
/** Кокон лопнул на 1,3; рёв с ударной волной — ровно 1,35. */
const WAKE_POP = 1.3;
const WAKE_ROAR = 1.35;
function wakeKeys(): LKey[] {
  return [
    [WAKE_POP, { cr: 1, hd: 0.45, hy: 3, mane: 0.2, plx: 4, prx: -4, tsx: 1.04, tsy: 0.94, by: -2 }],
    [WAKE_ROAR, { cr: -0.2, by: 5, hd: -0.45, hy: -2, jaw: 1, mane: 1, plx: -6, ply: -3, prx: 6, pry: -3, br: 1, eye: 1, tsx: 0.95, tsy: 1.07 }, eOut3],
    [1.5, { tsx: 1, tsy: 1, by: 4 }, eOut],
    [2.05, { hd: -0.4, jaw: 1, mane: 1, by: 3.5 }, eLin],
    [2.22, { jaw: 0.3, hd: 0.15, by: 1, cr: 0.15, mane: 0.6, br: 0.3, plx: 0, ply: 0, prx: 0, pry: 0 }, eIO],
    [2.85, { cr: 0.1, by: 0, jaw: 0.1, hd: 0.05, mane: 0.3, br: 0, eye: 0.5 }, eIO],
    [3.2, { cr: 0.25, ly: 6 }, eIO],
    [WAKE_T, { cr: 0, ly: 14.4, eye: 0, mane: 0, jaw: 0, hd: 0 }, eIO],
  ];
}

const MEM_T = LION.memory;
function memoryKeys(): LKey[] {
  return [
    [0, {}],
    [0.4, { cr: 0.35, br: 1, hd: 0.15, mane: 0.5, jaw: 0.1, plx: 2, prx: -2, tsx: 1.03, tsy: 0.97 }, eIO],
    [0.55, { cr: -0.15, by: 4, br: 0.6, hd: -0.5, hy: -2, jaw: 1, mane: 1, eye: 1, plx: -3, prx: 3, tsx: 0.96, tsy: 1.05 }, eOut3],
    [0.75, { tsx: 1, tsy: 1 }, eOut],
    [2.0, { hd: -0.45, jaw: 0.95, by: 3 }, eLin],
    [MEM_T, { cr: 0, by: 0, br: 0, hd: 0, hy: 0, jaw: 0, mane: 0, eye: 0, plx: 0, prx: 0 }, eIO],
  ];
}

const CALL_T = LION.call;
function callKeys(w: boolean): LKey[] {
  return [
    [0, {}],
    [0.42, { cr: 0.3, br: 1, mane: 0.7, hd: 0.1, jaw: 0.1, tsx: 1.04, tsy: 0.96, eye: 0.6, ...(w ? { wo: 0.5, wa: 0.7, wo2: 0.5, wa2: 0.7 } : {}) }, eIO],
    [0.55, { cr: -0.1, by: 3, br: 0.5, hd: 0.2, hy: 1, jaw: 1, mane: 1, eye: 1, tsx: 0.97, tsy: 1.04, ...(w ? { wo: 0.8, wa: 0.2, wo2: 0.8, wa2: 0.2 } : {}) }, eOut3],
    [0.9, { jaw: 0.9, tsx: 1, tsy: 1 }, eLin],
    [CALL_T, { cr: 0, by: 0, br: 0, hd: 0, hy: 0, jaw: 0, mane: 0, eye: 0, ...(w ? { wo: 0.35, wa: 0.3, wo2: 0.35, wa2: 0.3 } : {}) }, eIO],
  ];
}

const UNF_T = LION.unfurl;
const UNF_HIT = 1.2;
function unfurlKeys(): LKey[] {
  return [
    [0, { wl: 0.3, wo: 0, wa: -0.6, wo2: 0, wa2: -0.6 }],
    [0.45, { cr: 0.6, hd: 0.35, hy: 2, mane: 0.4, br: 0.3, wl: 0.45, wa: -0.3, wa2: -0.3, wo: 0.1, wo2: 0.1, tsx: 1.04, tsy: 0.96 }, eIO],
    [0.95, { cr: 0.3, by: 2, hd: -0.1, wl: 0.85, wo: 0.55, wo2: 0.55, wa: 1.2, wa2: 1.2, br: 0.8, jaw: 0.3, tsx: 1, tsy: 1, eye: 0.7 }, eIO],
    [1.08, { wa: 1.35, wa2: 1.35, wo: 0.8, wo2: 0.8, wl: 1, by: 4, hd: -0.3 }, eOut],
    [UNF_HIT, { wa: -0.4, wa2: -0.4, wo: 1, wo2: 1, wl: 1.05, cr: 0.35, by: 0, hd: 0.1, jaw: 1, mane: 1, eye: 1, tsx: 1.06, tsy: 0.93 }, eIn3],
    [1.35, { wa: -0.2, wa2: -0.2, tsx: 1, tsy: 1, cr: 0.15 }, eOut],
    [1.6, { wa: 1.0, wa2: 1.0, wo: 0.7, wo2: 0.7, jaw: 0.8, hd: -0.3, by: 3 }, eIO],
    [1.78, { wa: -0.5, wa2: -0.5, wo: 1, wo2: 1, by: 0 }, eIn],
    [UNF_T, { wa: 0.3, wa2: 0.3, wo: 0.35, wo2: 0.35, wl: 0.9, jaw: 0.1, hd: 0, mane: 0.3, cr: 0, br: 0, eye: 0.3 }, eIO],
  ];
}

const RIP_T = LION.rip;
const RIP_OUT = 1.7;
function ripKeys(): LKey[] {
  return [
    [0, { wa: 0.3, wa2: 0.3, wo: 0.35, wo2: 0.35, wl: 0.9 }],
    [0.4, { cr: -0.15, by: 5, hd: -0.5, jaw: 0.8, mane: 0.8, wa: 1.0, wa2: 1.0, wo: 0.8, wo2: 0.8, wl: 1, br: 1, plx: 4, ply: -10, prx: -4, pry: -10, eye: 1 }, eIO],
    [0.85, { plx: 11, ply: -38, prx: -11, pry: -38, cl: 1, hd: 0.1, jaw: 0.4, by: 3, br: 0.6 }, eIO],
    [0.95, { plx: 14, ply: -28, prx: -14, pry: -28, ch: 0.3, jaw: 1, hd: 0.25, tsx: 1.05, tsy: 0.95 }, eIn3],
    [1.6, { plx: 6, ply: -27, prx: -6, pry: -27, ch: 1, jaw: 1, hd: -0.2, mane: 1, wa: 1.2, wa2: 1.2, tsx: 1, tsy: 1 }, eIO],
    [RIP_OUT, { plx: -10, ply: -30, prx: 10, pry: -30, hd: -0.45, by: 4, wa: 1.3, wa2: 1.3, tsx: 0.96, tsy: 1.05 }, eOut3],
    [2.1, { cr: 0.5, by: 0, hd: 0.3, jaw: 0.5, plx: -2, ply: -4, prx: 2, pry: -4, wa: -0.3, wa2: -0.3, wo: 0.7, wo2: 0.7, mane: 0.3, tsx: 1, tsy: 1, eye: 0.6 }, eIO],
    [2.2, { st: 0 }, eLin],
    [RIP_T, { cr: 1, hd: 0.4, hy: 3, jaw: 0.2, wa: -0.7, wa2: -0.7, wo: 0.5, wo2: 0.5, plx: 0, ply: 0, prx: 0, pry: 0, st: 1, mane: 0, eye: 0, cl: 0 }, eIO],
  ];
}


// ---------------------------------------------------------------------------
// Ход → поза кадра.
// ---------------------------------------------------------------------------

type View = 'side' | 'front';

interface LPose {
  view: View;
  r: LRig;
  smear?: P2[] | null;
  smearK?: number;
  scene?: { cocoon?: number; shreds?: number; smear?: P2[] | null; smearK?: number };
  ghost?: MobFrame['ghost'];
  linger?: number;
  crumble?: number;
}

/** Ход: id дорожки, вариант (комбо, анфас), время хода; длительность — для кадров. */
interface Move {
  mv: string;
  v: number;
  tau: number;
}

/** Дорожки ходов: ключи по варианту, спешке и крыльям (собираются один раз). */
const keyCache = new Map<string, LKey[]>();
function keysOf(mv: string, v: number, h: number, w: boolean): LKey[] {
  const k = `${mv}|${v}|${h}|${w ? 1 : 0}`;
  let ks = keyCache.get(k);
  if (ks) return ks;
  const T = clawT(h);
  const R = recT(h);
  switch (mv) {
    case 'claw':
      ks = v === 1 ? [...clawFrontKeys(T, w), ...clawFrontRec(T, R, w, false)] : [...clawKeys(T, w), ...clawRecKeys(T, R, w, false)];
      break;
    case 'clawC': {
      const T2 = T + (T - 0.05);
      ks =
        v === 1
          ? [...clawFrontKeys(T, w), ...comboFrontKeys(T, T2), ...clawFrontRec(T2, R, w, true)]
          : [...clawKeys(T, w), ...comboKeys(T, T2, w), ...clawRecKeys(T2, R, w, true)];
      break;
    }
    case 'stomp':
      ks = v === 1 ? stompFrontKeys(R, w) : stompKeys(R, w);
      break;
    case 'pounce':
      ks = pounceKeys(w);
      break;
    case 'takeoff':
      ks = takeoffKeys(w);
      break;
    case 'dive':
      ks = diveKeys(w);
      break;
    case 'gust':
      ks = gustKeys(R, w, v === 1);
      break;
    case 'fan':
      ks = fanKeys(R, w, v === 1);
      break;
    case 'wake':
      ks = wakeKeys();
      break;
    case 'memory':
      ks = memoryKeys();
      break;
    case 'call':
      ks = callKeys(w);
      break;
    case 'unfurl':
      ks = unfurlKeys();
      break;
    case 'rip':
      ks = ripKeys();
      break;
    default:
      ks = [[0, {}]];
  }
  keyCache.set(k, ks);
  return ks;
}

/** Миги контакта хода (кадр, в который попал контакт, рисуется ровно в нём). */
function contactsOf(mv: string, v: number, h: number): number[] {
  const T = clawT(h);
  switch (mv) {
    case 'claw':
      return [T];
    case 'clawC':
      return [T, 2 * T - 0.05];
    case 'stomp':
      return [0.5];
    case 'pounce':
      return [P_C, P_L, P_L + 0.35];
    case 'dive':
      return [D_AIM, D_SW];
    case 'gust':
      return [LION.gustWarn];
    case 'fan':
      return FAN_SHOTS;
    case 'wake':
      return [WAKE_ROAR];
    case 'call':
      return [0.55];
    case 'unfurl':
      return [UNF_HIT];
    case 'rip':
      return [0.95, RIP_OUT];
  }
  return [];
}

/** Время кадра: номер на 24 к/с; если в кадр попал контакт — сам контакт. */
function quant(tau: number, marks: number[]): { f: number; tt: number } {
  const f = Math.floor(tau * FPS + 1e-6);
  const t0 = f / FPS;
  for (const c of marks) if (c > t0 + 1e-6 && c < t0 + 1 / FPS - 1e-6) return { f, tt: c };
  return { f, tt: t0 };
}

/** Кончики когтей вдоль удара (для следа), новое — первым. */
function smearPath(ks: LKey[], base: LRig, tt: number, from: number, to: number, tip: (r: LRig) => P2 = sidePawTip): P2[] | null {
  if (tt < from || tt > to + 0.16) return null;
  const out: P2[] = [];
  for (let i = 0; i <= 9; i++) {
    const s = Math.min(tt, to + 0.02) - i * 0.013;
    if (s < from) break;
    out.push(tip(ltrack(ks, s, base)));
  }
  return out.length >= 2 ? out : null;
}

function poseOf(mv: string, v: number, tt: number, h: number, w: boolean): LPose {
  const base = RW(w);
  switch (mv) {
    case 'idle':
      return { view: 'side', r: tIdle(tt, w) };
    case 'run':
      return { view: 'side', r: tWalk(tt, w) };
    case 'claw':
    case 'clawC': {
      const ks = keysOf(mv, v, h, w);
      const r = ltrack(ks, tt, base);
      const T = clawT(h);
      const fr = v === 1;
      tremble(r, tt, 0.55 * T, T - 0.14, fr ? { prx: 0.6, shk: 0.3 } : { fnx: 0.6, hd: 0.012 });
      let smear: P2[] | null = smearPath(ks, base, tt, T - 0.12, T, fr ? (q) => frontPawTip(q, 1) : sidePawTip);
      let smearK = tt > T ? 1 - (tt - T) / 0.16 : 1;
      if (mv === 'clawC') {
        const T2 = 2 * T - 0.05;
        tremble(r, tt, T + 0.2, T2 - 0.14, fr ? { plx: 0.5, shk: 0.3 } : { fnx: 0.5, hd: 0.01 });
        const s2 = smearPath(ks, base, tt, T2 - 0.11, T2, fr ? (q) => frontPawTip(q, -1) : sidePawTip);
        if (s2) {
          smear = s2;
          smearK = tt > T2 ? 1 - (tt - T2) / 0.16 : 1;
        } else if (tt > T + 0.05) smear = null;
      }
      return fr ? { view: 'front', r, scene: { smear, smearK } } : { view: 'side', r, smear, smearK };
    }
    case 'stomp': {
      const r = ltrack(keysOf(mv, v, h, w), tt, base);
      tremble(r, tt, 0.5, 0.85, v === 1 ? { shk: 0.8, hy: 0.4, jaw: 0.05 } : { hx: 0.8, hy: 0.4, jaw: 0.05 });
      return { view: v === 1 ? 'front' : 'side', r };
    }
    case 'pounce': {
      const r = ltrack(keysOf(mv, v, h, w), tt, base);
      // Кошка перед броском: переминается задними, хвост хлещет.
      if (tt > 0.28 && tt < P_C - 0.04) {
        const s = Math.sin((tt - 0.28) * TAU * 5);
        r.hny -= Math.max(0, s) * 1.6;
        r.hfy -= Math.max(0, -s) * 1.6;
        r.tail += Math.sin(tt * TAU * 3.2) * 0.45;
        r.snk += Math.sin(tt * TAU * 3.2 - 1) * 0.6;
      }
      if (tt >= P_C && tt <= P_L) {
        const k = (tt - P_C) / LION.leap;
        r.tdy = -leapZ(k) * 16;
        // Нос вверх на толчке, вниз к земле — и ровно к касанию (иначе кадр приземления дёргался вбок).
        r.trot = -0.22 * Math.cos(Math.PI * k) * (1 - seg(k, 0.78, 1));
      }
      pant(r, tt, P_L + 0.5, P_END - 0.05, 2.6);
      return {
        view: 'side',
        r,
        ghost: tt >= P_C && tt < P_L ? { every: 0.035, life: 0.2, tint: '#ff5a32', alpha: 0.26 } : null,
      };
    }
    case 'takeoff': {
      const r = ltrack(keysOf(mv, v, h, w), tt, base);
      r.tdy = -takeoffZ(tt) * 16;
      return { view: 'side', r };
    }
    case 'fly': {
      const big = v === 1;
      const r = flyRig(tt, big, w);
      return { view: 'side', r };
    }
    case 'dive': {
      const r = ltrack(keysOf(mv, v, h, w), tt, base);
      tremble(r, tt, 0.75, D_AIM, { tdx: 0.7, wa: 0.04 });
      r.tdy = -diveZ(tt) * 16;
      pant(r, tt, D_SW + 0.35, D_END - 0.1, 2.3);
      return {
        view: 'side',
        r,
        ghost: tt >= D_AIM - 0.05 && tt < D_SW + 0.02 ? { every: 0.022, life: 0.24, tint: '#ff4024', alpha: 0.32 } : null,
      };
    }
    case 'gust': {
      const r = ltrack(keysOf(mv, v, h, w), tt, base);
      tremble(r, tt, 0.6, 0.76, { wa: 0.03, wa2: 0.03, hy: 0.4 });
      return { view: v === 1 ? 'front' : 'side', r };
    }
    case 'fan':
      return { view: v === 1 ? 'front' : 'side', r: ltrack(keysOf(mv, v, h, w), tt, base) };
    case 'wake': {
      const r = ltrack(keysOf(mv, v, h, false), tt, R0);
      // Рёв дрожит; потом отряхивается: голова и грива — из стороны в сторону.
      tremble(r, tt, 1.45, 2.05, { hy: 0.6, shk: 0.8 });
      if (tt > 2.22 && tt < 2.9) {
        const k = (tt - 2.22) / 0.68;
        const env = Math.sin(Math.min(1, k * 1.6) * Math.PI * 0.5) * (1 - eIn(k));
        r.shk += 7 * Math.sin(k * TAU * 3) * env;
        r.msw += -1.1 * Math.sin(k * TAU * 3 - 0.9) * env;
        r.tsx *= 1 + 0.02 * Math.sin(k * TAU * 3 + 1) * env;
      }
      const cocoon = tt < 2.9 ? 0.7 * seg(tt, WAKE_POP, WAKE_POP + 0.18) + 0.3 * seg(tt, WAKE_POP + 0.18, 1.6) : 1 + seg(tt, 2.9, WAKE_T);
      return { view: 'front', r, scene: { cocoon, shreds: 1 - seg(tt, 2.3, 2.75) } };
    }
    case 'memory': {
      const r = ltrack(keysOf(mv, v, h, false), tt, R0);
      tremble(r, tt, 0.6, 2.0, { hy: 0.6, shk: 0.6, jaw: 0.04 });
      return { view: 'front', r };
    }
    case 'call': {
      const r = ltrack(keysOf(mv, v, h, w), tt, RW(false, w ? { wo: 0.35, wa: 0.3, wo2: 0.35, wa2: 0.3, wl: 0.9 } : {}));
      tremble(r, tt, 0.58, 0.9, { hy: 0.5, shk: 0.6 });
      return { view: 'front', r };
    }
    case 'unfurl': {
      const r = ltrack(keysOf(mv, v, h, true), tt, R0);
      tremble(r, tt, 0.3, 0.9, { shk: 0.5, hy: 0.3 });
      tremble(r, tt, 1.22, 1.5, { hy: 0.5, shk: 0.7 });
      return { view: 'front', r };
    }
    case 'rip': {
      const r = ltrack(keysOf(mv, v, h, true), tt, R0);
      r.hrt = tt < RIP_OUT ? 1 : 0;
      r.ch = tt < 0.95 ? r.ch : Math.max(r.ch, tt < RIP_OUT ? r.ch : 1);
      tremble(r, tt, 0.6, 0.92, { plx: 0.6, prx: -0.6 });
      tremble(r, tt, 1.0, RIP_OUT, { shk: 1, hy: 0.5, plx: 0.7, prx: -0.7 });
      return { view: 'front', r };
    }
    case 'husk':
    case 'death': {
      const r = ltrack(keysOf('rip', 0, h, true), RIP_T, R0);
      r.hrt = 0;
      r.ch = 1;
      r.st = 1;
      // Финал идёт в замедлении (0,22), а через 1,5 с настоящих поверх встаёт
      // церемония и мир замирает: игрок видит лишь ~0,33 с смерти. Обвал —
      // в первые 0,45 с, к паузе оболочка уже рушится, дальше — пыль.
      if (mv === 'death') return { view: 'front', r, crumble: clamp01(tt / 0.45), linger: 1.5 };
      return { view: 'front', r };
    }
  }
  return { view: 'side', r: RW(w) };
}

// ---------------------------------------------------------------------------
// Кадр: риг → пиксели → холсты; кеш.
// ---------------------------------------------------------------------------

const LFR = frameLRU<MobFrame>(420);

/** Кадр хода без вспышки (для боя — правым боком, левый — зеркалом в рисовальщике). */
function lionBase(mv: string, v: number, f: number, tt: number, h: number, w: boolean): MobFrame {
  const key = `${mv}|${v}|${f}|${h}|${w ? 1 : 0}`;
  const hit = LFR.get(key);
  if (hit) return hit;
  const ps = poseOf(mv, v, tt, h, w);
  const r = ps.r;
  let b = ps.view === 'front' ? drawFront(r, w || mv === 'unfurl' || mv === 'rip', ps.scene ?? {}) : drawSide(r, w, ps.smear ?? null, ps.smearK ?? 1);
  if (ps.crumble !== undefined) b = crumbleProg(b, ps.crumble, 7);
  const bk = bake(b);
  const z = Math.max(0, -r.tdy);
  const out: MobFrame = {
    img: bk.img,
    lit: bk.lit,
    ax: bk.ax,
    ay: bk.ay,
    eye: bk.eye,
    dx: r.tdx,
    dy: r.tdy,
    sx: r.tsx,
    sy: r.tsy,
    rot: r.trot,
    still: true,
    shadow: (ps.view === 'front' ? 30 : 31) * (1 - Math.min(0.45, z / 110)) * (ps.crumble !== undefined ? 1 - ps.crumble * 0.5 : 1),
    ghost: ps.ghost ?? null,
    linger: ps.linger,
  };
  return LFR.set(key, out);
}

function lionFlash(base: MobFrame, key: string): MobFrame {
  const k = `${key}|fl`;
  const hit = LFR.get(k);
  if (hit) return hit;
  return LFR.set(k, { ...base, img: flashCanvas(base.img, 0.5) });
}

// --- Кокон в бою (пролог и начало пробуждения).

const CFR = frameLRU<MobFrame>(120);
function cocoonFrame(c: CocoonPose, key: string): MobFrame {
  const hit = CFR.get(key);
  if (hit) return hit;
  const b = drawCocoon2(c);
  const bk = bake(b);
  // Кокон стоит на полклетки ниже середины льва (как предмет у K).
  return CFR.set(key, { img: bk.img, lit: bk.lit, ax: bk.ax, ay: bk.ay - 6, eye: null, still: true, shadow: 26 });
}

/** Удар сердца для рисунка: 0…1 — вспышка в начале удара. */
const beatPulse = (k: number) => (k < 0.07 ? k / 0.07 : Math.exp(-(k - 0.07) * 6));

// ---------------------------------------------------------------------------
// Рисовальщик: режим мозга → ход и кадр; взгляд, разворот, отдача, свет.
// ---------------------------------------------------------------------------

interface LMem {
  mode: string;
  prev: string;
  now: number;
  t: number;
  walk: number;
  left: boolean;
  turnT: number;
  combo: number;
  front: number;
  viewF: boolean;
  viewT: number;
}
const lmems = new Map<number, LMem>();

function lmemOf(m: Mob, pose: MobPose): LMem {
  let s = lmems.get(m.id);
  if (!s || Math.abs(pose.now - s.now) > 5) {
    s = { mode: pose.mode, prev: '', now: pose.now, t: pose.t, walk: 0, left: pose.left, turnT: -9, combo: 0, front: 0, viewF: false, viewT: -9 };
    lmems.set(m.id, s);
    if (lmems.size > 8) lmems.delete(lmems.keys().next().value as number);
  }
  if (pose.mode !== s.mode) {
    s.prev = s.mode;
    s.mode = pose.mode;
    if (pose.mode === 'f15_gust' || pose.mode === 'f15_fan' || pose.mode === 'f15_claw' || pose.mode === 'f15_stomp') {
      // Герой ниже (в пределах 50° от «прямо вниз») — бьёт к нам, анфас; иначе боком.
      s.front = Math.sin(m.dir) > 0.64 ? 1 : 0;
    }
  }
  const dt = clampN(pose.now - s.now, 0, 0.1);
  s.now = pose.now;
  s.t = pose.t;
  s.walk += Math.hypot(m.vx, m.vy) * 16 * dt;
  return s;
}

/** Сцены — всегда анфас; когти, топот, порыв и веер — анфас при v = 1 (герой внизу). */
const FRONT_MOVES = new Set(['wake', 'memory', 'call', 'unfurl', 'rip', 'husk', 'death']);
const VARIANT_FRONT = new Set(['claw', 'clawC', 'stomp', 'gust', 'fan']);
const SIDE_MODES = new Set(['chase', 'f15_recover', 'f15_claw', 'f15_crouch', 'f15_leap', 'f15_landed', 'f15_stomp', 'f15_takeoff', 'f15_fly', 'f15_swoopAim', 'f15_swoop']);

function lionMove(m: Mob, pose: MobPose, s: LMem, h: number): Move {
  const t = Math.max(0, pose.t);
  const T = clawT(h);
  const d = m.data ?? {};
  // Лист кадров: откуда пришли — подсказкой (1 когти, 2 топот, 3 порыв, 4 веер).
  const prev = d.vPrev ? ['', 'f15_claw', 'f15_stomp', 'f15_gust', 'f15_fan'][d.vPrev] : s.prev;
  switch (pose.mode) {
    case 'f15_claw': {
      const c = d.combo ? 1 : 0;
      s.combo = c;
      const fv = (d.vFront ?? s.front) as number;
      return c ? { mv: 'clawC', v: fv, tau: T + Math.max(0, t - 0.05) } : { mv: 'claw', v: fv, tau: t };
    }
    case 'f15_recover': {
      const fv = (d.vFront ?? s.front) as number;
      if (prev === 'f15_claw') return (d.vCombo ?? s.combo) ? { mv: 'clawC', v: fv, tau: 2 * T - 0.05 + t } : { mv: 'claw', v: fv, tau: T + t };
      if (prev === 'f15_stomp') return { mv: 'stomp', v: fv, tau: STOMP_T + t };
      if (prev === 'f15_gust') return { mv: 'gust', v: (d.vFront ?? s.front) as number, tau: GUST_T + t };
      if (prev === 'f15_fan') return { mv: 'fan', v: (d.vFront ?? s.front) as number, tau: FAN_T + t };
      break;
    }
    case 'f15_crouch':
      return { mv: 'pounce', v: 0, tau: t };
    case 'f15_leap':
      return { mv: 'pounce', v: 0, tau: P_C + t };
    case 'f15_landed':
      return d.air ? { mv: 'dive', v: 0, tau: D_SW + t } : { mv: 'pounce', v: 0, tau: P_L + t };
    case 'f15_stomp':
      return { mv: 'stomp', v: (d.vFront ?? s.front) as number, tau: t };
    case 'f15_takeoff':
      return { mv: 'takeoff', v: 0, tau: t };
    case 'f15_fly': {
      const fp = flyPhase(t);
      return { mv: 'fly', v: fp.big ? 1 : 0, tau: fp.ph };
    }
    case 'f15_swoopAim':
      return { mv: 'dive', v: 0, tau: t };
    case 'f15_swoop':
      return { mv: 'dive', v: 0, tau: D_AIM + t };
    case 'f15_gust':
      return { mv: 'gust', v: (d.vFront ?? s.front) as number, tau: t };
    case 'f15_fan':
      return { mv: 'fan', v: (d.vFront ?? s.front) as number, tau: t };
    case 'f15_wake':
      return { mv: t < WAKE_POP ? 'wakeC' : 'wake', v: 0, tau: t };
    case 'f15_memory':
      return { mv: 'memory', v: 0, tau: t };
    case 'f15_call':
      return { mv: 'call', v: 0, tau: t };
    case 'f15_unfurl':
      return { mv: 'unfurl', v: 0, tau: t };
    case 'f15_rip':
      return { mv: 'rip', v: 0, tau: t };
    case 'f15_husk':
      return { mv: 'husk', v: 0, tau: 0 };
    case 'dying':
      return { mv: 'death', v: 0, tau: t };
    case 'f15_cocoon':
      return { mv: 'coc', v: 0, tau: t };
    case 'f15_crack':
      return { mv: 'crack', v: 0, tau: t };
  }
  if (Math.hypot(m.vx, m.vy) > 0.4) return { mv: 'run', v: 0, tau: (s.walk / WALK_CYC) % 1 };
  return { mv: 'idle', v: 0, tau: ((pose.now * 10 + m.id * 3.7) % IDLE_N) / IDLE_N };
}

/** Кокон: удар сердца (свет), шевеление, толчки на пробуждении. */
function cocoonOf(mv: string, t: number, echo: number, bk: number, now: number): { c: CocoonPose; key: string; dx: number; sx: number; sy: number } {
  const breath = 0.5 + 0.5 * Math.sin((now * TAU) / 3.2);
  if (mv === 'crack') {
    const grow = seg(t, 0, 0.28);
    const flare = t < 0.12 ? 1 : Math.max(0, 1 - (t - 0.12) / 0.5);
    const gl = Math.round(Math.max(flare, beatPulse(bk) * 0.7) * 5) / 5;
    const gq = Math.round(grow * 6) / 6;
    const dx = Math.sin(t * 55) * 2.4 * (1 - seg(t, 0, 0.9)) ** 2;
    return {
      c: { cracks: Math.max(0, echo - 1) + gq, glow: gl, stir: 1, bulgeA: 0, bulge: 0, breath: 0.5 },
      key: `crack|${echo}|${gq}|${gl}`,
      dx,
      sx: 1 + 0.03 * flare,
      sy: 1 - 0.02 * flare,
    };
  }
  if (mv === 'wakeC') {
    // Сердце частит, свет растёт; изнутри бьют лапы; кокон трясёт.
    const ph = (t * (2.2 + t * 3.2)) % 1;
    const gl = Math.round(clampN(0.35 + t * 0.45 + beatPulse(ph) * 0.35, 0, 1) * 5) / 5;
    let bulge = 0;
    let bulgeA = 0;
    if (t > 0.3 && t < 0.72) {
      bulge = Math.sin(seg(t, 0.3, 0.72) * Math.PI);
      bulgeA = -0.5;
    } else if (t > 0.75 && t < 1.15) {
      bulge = Math.sin(seg(t, 0.75, 1.15) * Math.PI);
      bulgeA = Math.PI + 0.55;
    } else if (t >= 1.15) {
      bulge = seg(t, 1.15, WAKE_POP) * 0.8;
      bulgeA = -Math.PI / 2;
    }
    const bq = Math.round(bulge * 4) / 4;
    const stir = Math.round(Math.sin(t * 9) * 2) / 2;
    const dx = Math.sin(t * 70) * (0.6 + t * 1.6);
    return {
      c: { cracks: 5, glow: gl, stir, bulgeA, bulge: bq, breath: 0.5 },
      key: `wake|${gl}|${bq}|${bulgeA.toFixed(2)}|${stir}`,
      dx,
      sx: 1 + bq * 0.02,
      sy: 1 + 0.015 * Math.sin(t * 40),
    };
  }
  const pulse = beatPulse(bk);
  const gl = Math.round(pulse * 5) / 5;
  const stir = Math.round(Math.sin((now * TAU) / 5.3) * 2) / 2;
  return {
    c: { cracks: echo, glow: gl, stir, bulgeA: 0, bulge: 0, breath: 0.5 },
    key: `coc|${echo}|${gl}|${stir}`,
    dx: 0,
    sx: 1 + pulse * 0.025 + breath * 0.01,
    sy: 1 + breath * 0.018 - pulse * 0.01,
  };
}

registerMobPainter('f15boss', (m: Mob, pose: MobPose) => {
  const s = paintSim();
  const v = f15bView(s);
  const phase = m.data.phase ?? 0;
  const w = phase >= 3;
  const h = phase >= 3 ? 1.15 : 1;
  const mem = lmemOf(m, pose);
  const mvq = lionMove(m, pose, mem, h);
  const bk = v && s ? beatK(v, s.time) : (pose.now % 1.5) / 1.5;
  // Пролог: кокон.
  if (mvq.mv === 'coc' || mvq.mv === 'crack' || mvq.mv === 'wakeC') {
    const echo = mvq.mv === 'wakeC' ? 5 : (v?.echo ?? m.data.vEcho ?? 0);
    const c = cocoonOf(mvq.mv, mvq.tau, echo, bk, pose.now);
    const fr = cocoonFrame(c.c, c.key);
    const out: MobFrame = { ...fr, dx: c.dx, sx: c.sx, sy: c.sy };
    if (pose.flash && fr.img) out.img = flashOf(fr, `c|${c.key}`);
    out.lit = fr.lit ? litLevel(fr.lit, 1 + beatPulse(bk) * 0.6) : null;
    return out;
  }
  const marks = mvq.mv === 'idle' || mvq.mv === 'run' || mvq.mv === 'fly' || mvq.mv === 'husk' ? [] : contactsOf(mvq.mv, mvq.v, h);
  let f: number;
  let tt: number;
  if (mvq.mv === 'idle') {
    f = Math.floor(mvq.tau * IDLE_N + 1e-6) % IDLE_N;
    tt = f / IDLE_N;
  } else if (mvq.mv === 'run') {
    f = Math.floor(mvq.tau * WALK_N + 1e-6) % WALK_N;
    tt = f / WALK_N;
  } else if (mvq.mv === 'fly') {
    f = Math.floor(mvq.tau * FLY_N + 1e-6) % FLY_N;
    tt = f / FLY_N;
  } else {
    const q = quant(mvq.tau, marks);
    f = q.f;
    tt = q.tt;
  }
  const key = `${mvq.mv}|${mvq.v}|${f}|${h}|${w ? 1 : 0}`;
  const base = lionBase(mvq.mv, mvq.v, f, tt, h, w);
  // Смерть белым не мигает (копия убранного держит последнюю вспышку).
  const flash = pose.flash && (pose.mode !== 'dying' || pose.t < 0.08);
  const fr = flash ? lionFlash(base, key) : base;
  const out: MobFrame = { ...fr };
  const side = SIDE_MODES.has(pose.mode) && !FRONT_MOVES.has(mvq.mv) && !(mvq.v === 1 && VARIANT_FRONT.has(mvq.mv));
  // Взгляд: боком — зеркалом кадра; разворот — короткое сжатие.
  if (side) {
    if (mem.left !== pose.left) {
      mem.left = pose.left;
      mem.turnT = pose.now;
    }
    const tk = clamp01((pose.now - mem.turnT) / 0.14);
    const turn = tk < 1 ? 1 - 0.32 * Math.sin(tk * Math.PI) : 1;
    if (pose.left) {
      out.sx = -(out.sx ?? 1) * turn;
      out.dx = -(out.dx ?? 0);
      out.rot = -(out.rot ?? 0);
    } else out.sx = (out.sx ?? 1) * turn;
  }
  // Смена вида (сцена анфас ↔ бок): поворот сжатием.
  if (side !== !mem.viewF) {
    mem.viewF = !side;
    mem.viewT = pose.now;
  }
  const vk = clamp01((pose.now - mem.viewT) / 0.16);
  if (vk < 1) out.sx = (out.sx ?? 1) * (0.7 + 0.3 * eOut(vk));
  // Отдача от удара героя — по направлению удара, с возвратом.
  const fl = m.flash ?? 0;
  if (fl > 0 && pose.mode !== 'dying' && mvq.mv !== 'husk') {
    const age = clampN(0.12 - fl, 0, 0.12);
    let ux = pose.left ? 1 : -1;
    let uy = 0;
    if (s) {
      const dx = m.x - s.hero.x;
      const dy = m.y - s.hero.y;
      const d = Math.hypot(dx, dy) || 1;
      ux = dx / d;
      uy = dy / d;
    }
    const calmK = mvq.mv === 'idle' || mvq.mv === 'run' || mvq.mv === 'pounce' ? 1 : 0.45;
    const k = Math.sin((age / 0.12) * Math.PI) * 2.2 * calmK;
    out.dx = (out.dx ?? 0) + ux * k;
    out.dy = (out.dy ?? 0) + uy * k * 0.5;
    out.sy = (out.sy ?? 1) * (1 - 0.03 * calmK * Math.sin((age / 0.12) * Math.PI));
  }
  // Свет: разгорается с фазой и в такт сердцу.
  if (out.lit) {
    const ph = [1, 0.85, 1, 1.1, 0.75][Math.min(4, phase)];
    const beat = mvq.mv === 'husk' ? beatPulse(bk) * 1.1 : beatPulse(bk) * 0.5;
    out.lit = litLevel(out.lit, Math.round((ph + beat) * 5) / 5);
  }
  // Герой за тушей (она огромная) — туша полупрозрачна: героя и метки видно.
  const hr = s?.hero;
  if (hr && pose.mode !== 'dying' && hr.y < m.y - 0.2 && m.y - hr.y < 5.5 && Math.abs(hr.x - m.x) < 3.4) out.alpha = 0.5;
  return out;
});

function flashOf(fr: MobFrame, key: string): HTMLCanvasElement {
  const k = `${key}|fl`;
  const hit = CFR.get(k);
  if (hit) return hit.img;
  return CFR.set(k, { ...fr, img: flashCanvas(fr.img, 0.5) }).img;
}

// Прогрев: всё, что игрок увидит в первом бою (бок вправо; левый — зеркало):
// покой, бег, когти с проводкой, прыжок, топот; анфас — пробуждение.
registerMobWarm('f15boss', function* () {
  const list: [string, number, number][] = [
    ['idle', 0, IDLE_N],
    ['run', 0, WALK_N],
    ['claw', 0, Math.ceil((clawT(1) + recT(1)) * FPS)],
    ['pounce', 0, Math.ceil(P_END * FPS)],
    ['stomp', 0, Math.ceil((STOMP_T + recT(1)) * FPS)],
    // Герой внизу — анфас.
    ['claw', 1, Math.ceil((clawT(1) + recT(1)) * FPS)],
    ['stomp', 1, Math.ceil((STOMP_T + recT(1)) * FPS)],
    ['wake', 0, Math.ceil(WAKE_T * FPS)],
  ];
  for (const [mv, v, n] of list)
    for (let f = mv === 'wake' ? Math.floor(WAKE_POP * FPS) : 0; f < n; f++) {
      const tt = mv === 'idle' ? f / IDLE_N : mv === 'run' ? f / WALK_N : quant(f / FPS + 1e-4, contactsOf(mv, v, 1)).tt;
      lionBase(mv, v, f, tt, 1, false);
      yield f;
    }
});
registerMobWarm('f15boss', function* () {
  // Пролог: кокон на всех трещинах и ступенях света.
  for (let e = 0; e <= 5; e++)
    for (let g = 0; g <= 5; g++)
      for (const st of [-1, -0.5, 0, 0.5, 1]) {
        const key = `coc|${e}|${g / 5}|${st}`;
        cocoonFrame({ cracks: e, glow: g / 5, stir: st, bulgeA: 0, bulge: 0, breath: 0.5 }, key);
        yield e;
      }
});

// ---------------------------------------------------------------------------
// Кокон до боя и после победы (предмет у K).
// ---------------------------------------------------------------------------

const cocoonProps = new Map<string, Sprite>();
registerPropPainter('f15b_cocoon', (_o, time) => {
  const s = paintSim();
  const st = s?.boss?.state;
  if (st === 'fight') return null;
  const key = st === 'won' || st === 'rest' ? 'burst' : `beat|${Math.round(beatPulse((time / 1.5) % 1) * 4)}|${Math.round(Math.sin((time * TAU) / 5.3) * 2) / 2}`;
  let sp = cocoonProps.get(key);
  if (!sp) {
    let b: Built2;
    if (key === 'burst') {
      const p = new Px(CW, CH);
      cocoonBack(p, CW / 2, CG, 1.6);
      outlineFast(p, INK);
      b = { p, lit: null, ax: CW / 2, ay: CG, eye: null };
    } else {
      const g = Number(key.split('|')[1]) / 4;
      b = drawCocoon2({ cracks: 0, glow: g, stir: Number(key.split('|')[2]), bulgeA: 0, bulge: 0, breath: 0.5 });
    }
    const bk = bake({ ...b, lit: null });
    sp = { img: bk.img, ax: bk.ax, ay: bk.ay };
    cocoonProps.set(key, sp);
  }
  return sp;
});

// ---------------------------------------------------------------------------
// Истинное сердце.
// ---------------------------------------------------------------------------

const HFR = frameLRU<MobFrame>(160);
const HEART_Q = 20;

/** Поза удара на доле k (0 — только что сжалось). */
function heartBeatPose(k: number, strong: boolean): HeartPose {
  const c = strong ? 0.74 : 0.82;
  const o = strong ? 1.18 : 1.1;
  const shut = HEART.shutK;
  let sz: number;
  let glow: number;
  let plates: number;
  if (k < 0.08) {
    const u = eOut(k / 0.08);
    sz = lerp(1, c, u);
    glow = lerp(0.75, 0.3, u);
    plates = lerp(0.5, 0, u);
  } else if (k < shut) {
    sz = c + (Math.floor(k * 60) % 2 ? 0.01 : -0.01);
    glow = 0.3;
    plates = 0;
  } else if (k < shut + 0.08) {
    const u = eOut3((k - shut) / 0.08);
    sz = lerp(c, o, u);
    glow = lerp(0.6, 1, u);
    plates = u;
  } else {
    const u = eIO((k - shut - 0.08) / (1 - shut - 0.08));
    sz = lerp(o, 1, u);
    glow = lerp(1, 0.75, u);
    plates = lerp(1, 0.5, u);
  }
  const twitch = k < 0.14 ? (Math.floor(k * 90) % 2 ? 1 : -1) * (strong ? 1.5 : 1) : k >= shut && k < shut + 0.06 ? 1 : 0;
  return { sz, glow, open: k >= shut, plates, twitch, die: 0, torn: 0 };
}

function heartFrame(key: string, make: () => HeartPose, lift: number): MobFrame {
  const hit = HFR.get(key);
  if (hit) return hit;
  const bk = bake(drawHeart2(make()));
  return HFR.set(key, { img: bk.img, lit: bk.lit, ax: bk.ax, ay: bk.ay, eye: bk.eye, still: true, shadow: 16, lift });
}

registerMobPainter('f15boss_heart', (m: Mob, pose: MobPose) => {
  const s = paintSim();
  const v = f15bView(s);
  let fr: MobFrame;
  if (pose.mode === 'dying') {
    // Финал: последнее сжатие → трещины золота → пластины разлетаются.
    const t = pose.t;
    const q = Math.min(35, Math.floor(t * 24));
    let hit = HFR.get(`die|${q}`);
    if (!hit) {
      const bk = bake(drawHeartDeath(q / 24));
      hit = HFR.set(`die|${q}`, { img: bk.img, lit: bk.lit, ax: bk.ax, ay: bk.ay, eye: null, still: true });
    }
    // Обломки падают на пол: сердце опускается с высоты, пока летят.
    fr = { ...hit, linger: 1.45, shadow: 16 * (1 - seg(pose.t, 0.18, 0.5)), lift: 6 + 0.6 * 13 * (1 - eIO(seg(pose.t, 0.18, 0.6))) };
  } else if (pose.mode === 'f15h_rise') {
    // Вырвано из груди: бьётся часто и слабо, капает; поднимается к центру.
    const t = pose.t;
    const k = Math.min(1, t / HEART.rise);
    const bq = Math.floor(((t * 3.4) % 1) * 10);
    const z = Math.sin(k * Math.PI) * 1.2 + k * 0.6;
    fr = heartFrame(`rise|${bq}`, () => ({ ...heartBeatPose(bq / 10, false), torn: 1, open: false, glow: 0.55 }), 6);
    fr = { ...fr, lift: 6 + z * 13, ghost: k < 0.6 ? { every: 0.05, life: 0.2, tint: '#ff3040', alpha: 0.2 } : null };
  } else {
    const k = v && s ? beatK(v, s.time) : (pose.now % 0.9) / 0.9;
    const strong = v ? v.beats % HEART.strongEvery === 0 : Math.floor(pose.now / 0.9) % 3 === 0;
    const q = Math.min(HEART_Q - 1, Math.floor(k * HEART_Q + 1e-6));
    fr = heartFrame(`beat|${strong ? 1 : 0}|${q}`, () => heartBeatPose(q / HEART_Q, strong), 6 + 0.6 * 13);
  }
  const out: MobFrame = { ...fr };
  if (pose.flash && pose.mode !== 'dying') out.img = flashCanvasCached(fr.img);
  return out;
});

const flashCache = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();
function flashCanvasCached(src: HTMLCanvasElement): HTMLCanvasElement {
  let c = flashCache.get(src);
  if (!c) {
    c = flashCanvas(src);
    flashCache.set(src, c);
  }
  return c;
}

registerMobWarm('f15boss_heart', function* () {
  for (const strong of [false, true])
    for (let q = 0; q < HEART_Q; q++) {
      heartFrame(`beat|${strong ? 1 : 0}|${q}`, () => heartBeatPose(q / HEART_Q, strong), 6 + 0.6 * 13);
      yield q;
    }
});

// ---------------------------------------------------------------------------
// Кровяной сгусток.
// ---------------------------------------------------------------------------

const KFR = frameLRU<MobFrame>(80);
function clotFrame(key: string, make: () => Built2): MobFrame {
  const hit = KFR.get(key);
  if (hit) return hit;
  const bk = bake(make());
  return KFR.set(key, { img: bk.img, lit: bk.lit, ax: bk.ax, ay: bk.ay, eye: bk.eye, still: true, shadow: 4 });
}

registerMobPainter('f15b_clot', (m: Mob, pose: MobPose) => {
  let fr: MobFrame;
  let sx = 1;
  let sy = 1;
  if (pose.mode === 'dying') {
    const q = Math.min(5, Math.floor(pose.t / 0.06));
    fr = clotFrame(`splat|${q}`, () => drawClot2(0, 0, 0, (q + 1) / 6));
  } else if (pose.mode === 'f15c_swell') {
    const k = clamp01(pose.t / 0.6);
    const q = Math.min(7, Math.floor(k * 8));
    const wq = Math.floor(pose.t * 20) % 2;
    fr = clotFrame(`swell|${q}|${wq}`, () => drawClot2(q, (q + 1) / 8, (wq ? 1 : -1) * 0.12 * (q / 7), 0));
  } else {
    const run = pose.anim === 'run' && pose.mode !== 'drop';
    const q = run ? Math.floor(pose.now * 14 + m.id * 2.3) % 8 : Math.floor(pose.now * 5 + m.id) % 8;
    fr = clotFrame(`roll|${run ? 1 : 0}|${q}`, () => drawClot2(run ? q : 0, 0, run ? 0 : Math.sin((q / 8) * TAU) * 0.18, 0));
    if (pose.mode === 'drop') {
      // Капля со свода: вытянута, пока падает.
      sx = 0.8;
      sy = 1.25;
    } else if (pose.mode === 'stun' && pose.t < 0.3) {
      // Шлёп о пол: сплющило и отпружинило.
      const k = pose.t / 0.3;
      sx = 1 + 0.35 * (1 - k) * Math.cos(k * 9);
      sy = 1 - 0.3 * (1 - k) * Math.cos(k * 9);
    }
  }
  const out: MobFrame = { ...fr, sx, sy };
  if (pose.flash && pose.mode !== 'dying') out.img = flashCanvasCached(fr.img);
  return out;
});


/** Сердце подземелья (иконка трофея). */
const HEARTF = tn('#3a0610', '#6e1020', '#a8202e', '#e85060');


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
  // v2.85: ход тела хозяина (выпад, прыжок, наклон) эхо повторяет, а свечение,
  // шлейф и долгую смерть — нет: эхо само призрачное и тает по-своему.
  return {
    img: ghostify(fr.img, fq, scan),
    ax: fr.ax,
    ay: fr.ay,
    eye: fr.eye,
    dx: fr.dx,
    dy: fr.dy,
    sx: fr.sx,
    sy: fr.sy,
    rot: fr.rot,
    still: fr.still,
    shadow: fr.shadow,
    lift: fr.lift,
  };
});

// ---------------------------------------------------------------------------
// Метки ударов, лужи и облака — рисуются по кадру (контекстом, на полу).
// ---------------------------------------------------------------------------

export type ZoneX = (Zone | Strike) & {
  ang?: number;
  arc?: number;
  w?: number;
  mob?: number;
  q?: number;
  cells?: number[];
};

export const rgba = (c: RGBA, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a)).toFixed(3)})`;

/** Метка удара наливается: `k` 0…1. */
export const kOf = (z: ZoneX) => {
  const s = z as Strike;
  if ('warn' in s && typeof s.warn === 'number' && s.warn > 0) return Math.min(1, s.t / s.warn);
  return 1;
};

export function cone(g: CanvasRenderingContext2D, x: number, y: number, r: number, a: number, arc: number): void {
  g.beginPath();
  g.moveTo(x, y);
  g.arc(x, y, r, a - arc / 2, a + arc / 2);
  g.closePath();
}

export const BLOODC = hx('#e8202e');
export const HOT = hx('#ff8a4a');
export const STONEC = hx('#c8b8a0');
export const GHOSTC = hx('#a8dcf0');

/** Кольцо ударной волны: осколки камня (прыжок) и толчок (кокон, крылья). */
export function ringMark(g: CanvasRenderingContext2D, z: ZoneX, px: number, py: number, S: number, col: RGBA, time: number, bits: boolean): void {
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

// --- Лужи и облака.


/**
 * Тело змея-эха (v2.87): то же тело, что у Красного змея 6-го этажа
 * (`drawSerpentBody`: одна труба колец по пути головы, пластины, шипы
 * хребта, лопасть хвоста, волна ползка), но в призраке — как голова эха:
 * цвет по яркости в холодный ряд, светлый кант сверху-слева, строки
 * «записи». Перекраска — составлением холстов (видеокарта), без обхода
 * пикселей на кадр.
 */
const EB = 208;
let ebA: HTMLCanvasElement | null = null;
let ebB: HTMLCanvasElement | null = null;
let ebC: HTMLCanvasElement | null = null;
const ebuf = () => {
  if (!ebA) {
    const mk = () => {
      const c = document.createElement('canvas');
      c.width = EB;
      c.height = EB;
      return c;
    };
    ebA = mk();
    ebB = mk();
    ebC = mk();
  }
  return [ebA, ebB!, ebC!] as const;
};

registerZonePainter('f15b_echobody', (g, z, px, py, _S, time) => {
  const s = paintSim();
  const v = f15bView(s);
  const m = s?.mobs.find((x) => x.id === (z as ZoneX).mob);
  if (!v || !m || !s) return true;
  const rising = m.mode === 'f15e_rise';
  const fade = rising ? clamp01(m.t / 1.3) : m.mode === 'dying' ? Math.max(0, 1 - m.t / 0.6) : 1;
  if (fade <= 0.02 || v.trail.length < 4) return true;
  const [A, B, C] = ebuf();
  const ga = A.getContext('2d');
  const gb = B.getContext('2d');
  const gc = C.getContext('2d');
  if (!ga || !gb || !gc) return true;
  // Тело змея — в буфер в игровых пикселях, голова — в его середине.
  const ox = EB / 2;
  const oy = EB / 2 + 20;
  ga.setTransform(1, 0, 0, 1, 0, 0);
  ga.clearRect(0, 0, EB, EB);
  ga.imageSmoothingEnabled = false;
  drawSerpentBody(
    ga,
    {
      id: m.id,
      trail: v.trail,
      mode: rising ? 'chase' : m.mode,
      t: m.t,
      x: m.x,
      y: m.y,
      face: m.face,
      haste: 1,
      flash: m.flash,
      die: -1,
    },
    ox,
    oy,
    16,
    time,
  );
  // Призрак: цвет — холодный, яркость — своя; чёрное — в тёмную синь.
  gb.setTransform(1, 0, 0, 1, 0, 0);
  gb.globalCompositeOperation = 'source-over';
  gb.globalAlpha = 1;
  gb.clearRect(0, 0, EB, EB);
  gb.drawImage(A, 0, 0);
  gb.globalCompositeOperation = 'color';
  gb.fillStyle = '#5a8ed8';
  gb.fillRect(0, 0, EB, EB);
  gb.globalCompositeOperation = 'screen';
  gb.fillStyle = '#1a2c58';
  gb.fillRect(0, 0, EB, EB);
  gb.globalCompositeOperation = 'destination-in';
  gb.drawImage(A, 0, 0);
  // Строки «записи», как у головы: каждая третья темнее, бегут вниз.
  const scan = Math.floor(time * 6) % 3;
  gb.globalCompositeOperation = 'destination-out';
  gb.fillStyle = 'rgba(0,0,0,0.26)';
  for (let y = (3 - (((oy - Math.round(py)) % 3) + 3) % 3 + scan) % 3; y < EB; y += 3) gb.fillRect(0, y, EB, 1);
  // Кант света сверху-слева: пиксели тела, у которых сосед сверху-слева пуст.
  gc.setTransform(1, 0, 0, 1, 0, 0);
  gc.globalCompositeOperation = 'source-over';
  gc.clearRect(0, 0, EB, EB);
  gc.drawImage(A, 0, 0);
  gc.globalCompositeOperation = 'destination-out';
  gc.drawImage(A, 1, 1);
  gc.globalCompositeOperation = 'source-in';
  gc.fillStyle = '#d8f4ff';
  gc.fillRect(0, 0, EB, EB);
  gb.globalCompositeOperation = 'source-over';
  gb.drawImage(C, 0, 0);
  // На пол: прозрачность призрака (голова — 0,88), растворение — вместе с головой.
  const prevA = g.globalAlpha;
  const prevS = g.imageSmoothingEnabled;
  g.imageSmoothingEnabled = false;
  g.globalAlpha = 0.86 * fade;
  g.drawImage(B, Math.round(px - ox), Math.round(py - oy));
  g.globalAlpha = prevA;
  g.imageSmoothingEnabled = prevS;
  return true;
});


/** Четверть просыпается: клетки четверти мерцают цветом памяти. */
export const QUAD_COL: RGBA[] = [hx('#ff6a20'), hx('#30d0d8'), hx('#c8dcff'), hx('#70f080')];
export const cellSets = new WeakMap<number[], Set<number>>();

/**
 * Пульс по венам арены: на каждый удар сердца по веерным венам и двум
 * стволам горловины бежит волна света — по тем же кривым, что на полу.
 */
const veinLen = new WeakMap<object, number[]>();
export function veinEnds(s: Sim): number[] {
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

// ---------------------------------------------------------------------------
// Снаряды.
// ---------------------------------------------------------------------------

const shots = new Map<string, Sprite>();
export function shotSprite(key: string, make: () => { p: Px; ax: number; ay: number }): Sprite {
  let s = shots.get(key);
  if (!s) {
    const m = make();
    s = { img: m.p.canvas(), ax: m.ax, ay: m.ay };
    shots.set(key, s);
  }
  return s;
}

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
