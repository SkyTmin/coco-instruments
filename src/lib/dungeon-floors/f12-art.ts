// Этаж 12 «Полярная ночь» — рисовальщики: клетки трёх районов, предметы,
// монстры и Ледниковый мамонт, иконки вещей, слой пола и слой неба.
//
// Палитра: ночной синий, бирюза и зелень сияния, белый снег с голубыми
// тенями, редкие тёплые жаровни. Всё нарисовано кодом.
//
// Монстры и мамонт — маленький 3D-риг: тело собрано из эллипсоидов, кадр
// считается лучом на пиксель с буфером глубины (свет сверху-слева-спереди,
// пять тонов, контур и линии стыка частей). Поэтому у всех 16 сторон один и
// тот же свет, а не зеркало, и «боком не ходит» видно глазом. Кадры — в
// `frameLRU`, мамонт и мелочь греются заранее (`registerMobWarm`).

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
import { F12_GEO, F12_GROTTO, F12_LAKE, F12_MARK, F12_SHRINE, F12_TOP } from './f12';
import {
  f12Aurora,
  f12Broken,
  f12Floes,
  f12Frost,
  f12Gate,
  f12Holes,
  f12Ice,
  f12Lit,
  f12State,
  f12Storm,
  f12Thin,
  f12Torch,
  f12Winch,
  MAMMOTH,
} from './f12-brains';

type RGBA = [number, number, number, number];
const TAU = Math.PI * 2;
const MK = F12_MARK;

// ---------------------------------------------------------------------------
// Цвет.
// ---------------------------------------------------------------------------

function hx(h: string, a = 255): RGBA {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255, a];
}
const alpha = (c: RGBA, k: number): RGBA => [c[0], c[1], c[2], Math.round(255 * k)];
function mixc(a: RGBA, b: RGBA, k: number): RGBA {
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
    Math.round(a[3] + (b[3] - a[3]) * k),
  ];
}
/** Пять тонов от тени к блику. */
const ramp = (...c: string[]): RGBA[] => c.map((s) => hx(s));
const css = (c: RGBA, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

const INK = hx('#0b1020');
const WHITE = hx('#ffffff');

/** Снег: тень → блик. */
const SNOW = ramp('#5f7aa6', '#8ea7cc', '#b9cbe6', '#dce7f5', '#f6faff');
/** Лёд. */
const ICE = ramp('#24507e', '#3a72a6', '#5c98c9', '#8cc0e4', '#c8e8fb');
/** Тонкий лёд: темнее, вода близко. */
const THIN = ramp('#102a4c', '#1c416c', '#2d5d8c', '#4b80ae', '#8ab8dc');
/** Вода. */
const WATER = ramp('#040e20', '#08203c', '#0f3258', '#1d4f7c', '#4f8bbd');
/** Камень (сине-серый). */
const STONE = ramp('#1c2232', '#2e3648', '#454f66', '#5f6b84', '#8390aa');
/** Тёмная порода стен. */
const ROCK = ramp('#0e1220', '#1a2133', '#283249', '#3a4762', '#56658a');
/** Сияние. */
const AURORA = ramp('#0d5a4a', '#16a07a', '#3ef0b0', '#9affd8', '#e6fff4');
const TEAL = ramp('#0b4a5a', '#15798a', '#2fb8c8', '#7ae8f0', '#d8fcff');
/** Тёплое: жаровни, костры. */
const FIRE = ramp('#6a1a08', '#c8461a', '#ff8a2a', '#ffc65a', '#fff3c4');
/** Дерево (сани, лодки, лебёдка). */
const WOOD = ramp('#2a1608', '#4a2a12', '#6e4220', '#946034', '#b8844e');
/** Мех (шкуры, мамонт). */
const FUR = ramp('#1e1008', '#3a2012', '#5a361c', '#7e5230', '#a87648');
/** Кость, бивень. */
const BONE = ramp('#6a6050', '#9a8e74', '#c8bc9a', '#e6dcc0', '#fffaea');
/** Красная охра (орнамент шаманки). */
const OCHRE = ramp('#3a0e0a', '#6a1c12', '#a0301c', '#d05a2a', '#f08a4a');

// ---------------------------------------------------------------------------
// Шум (детерминированный: один рисунок на одну клетку мира).
// ---------------------------------------------------------------------------

function hash(x: number, y: number, s = 0): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Плавный шум по мировым пикселям: дюны снега, разводы льда. */
function vnoise(x: number, y: number, s: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi, s);
  const b = hash(xi + 1, yi, s);
  const c = hash(xi, yi + 1, s);
  const d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

const fbm = (x: number, y: number, s: number) =>
  vnoise(x, y, s) * 0.55 + vnoise(x * 2.1, y * 2.1, s + 7) * 0.3 + vnoise(x * 4.3, y * 4.3, s + 13) * 0.15;

/** Порядковый дизеринг 4×4: тон между ступенями без каши. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const dither = (x: number, y: number) => BAYER[(y & 3) * 4 + (x & 3)];

/** Тон по доле 0…1 с дизерингом между ступенями. */
function toneOf(r: RGBA[], k: number, x: number, y: number): RGBA {
  const f = Math.max(0, Math.min(0.999, k)) * (r.length - 1);
  const i = Math.floor(f);
  return r[Math.min(r.length - 1, i + (f - i > dither(x, y) ? 1 : 0))];
}

// ---------------------------------------------------------------------------
// Риг: эллипсоиды, луч на пиксель, буфер глубины.
// ---------------------------------------------------------------------------

/** Наклон камеры от вертикали: пол сжат на cos, стены — на sin. */
const CAM_C = 0.77;
const CAM_S = 0.64;
/** К зрителю. */
const VIEW: V3 = [0, CAM_S, CAM_C];
type V3 = [number, number, number];
/** К свету: сверху, слева, спереди. */
const LIGHT: V3 = (() => {
  const v: V3 = [-0.5, 0.42, 0.76];
  const n = Math.hypot(...v);
  return [v[0] / n, v[1] / n, v[2] / n];
})();

/** Часть тела — эллипсоид в своих осях (вперёд, вбок, вверх). */
export interface Part {
  /** Центр в осях модели: x — вперёд, y — влево… вправо, z — вверх. Пиксели. */
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
  /** Свой поворот вокруг вертикали и наклон носа вверх (рад). */
  yaw?: number;
  pitch?: number;
  /** Крен вокруг своей оси «вперёд» (рад). */
  roll?: number;
  ramp: RGBA[];
  /** Мех: доля прядей (тёмные штрихи вниз по телу). */
  fur?: number;
  /** Светится (слой поверх темноты). */
  glow?: boolean;
  /** Блеск льда: светлая искра на изломе. */
  gloss?: boolean;
  /** Номер для линий стыка (по умолчанию — порядковый). */
  id?: number;
}

export interface RigOut {
  p: Px;
  lit: Px | null;
  /** Глаз в кадре (если виден). */
  eye: [number, number] | null;
}

interface Axes {
  c: V3;
  e: [V3, V3, V3];
  r: V3;
}

function axesOf(pt: Part, face: number): Axes {
  const cf = Math.cos(face);
  const sf = Math.sin(face);
  const c: V3 = [pt.x * cf - pt.y * sf, pt.x * sf + pt.y * cf, pt.z];
  const a = face + (pt.yaw ?? 0);
  const p = pt.pitch ?? 0;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const cp = Math.cos(p);
  const sp = Math.sin(p);
  let e1: V3 = [ca * cp, sa * cp, sp];
  let e2: V3 = [-sa, ca, 0];
  let e3: V3 = [-ca * sp, -sa * sp, cp];
  const r = pt.roll ?? 0;
  if (r) {
    const cr = Math.cos(r);
    const sr = Math.sin(r);
    const n2: V3 = [e2[0] * cr + e3[0] * sr, e2[1] * cr + e3[1] * sr, e2[2] * cr + e3[2] * sr];
    const n3: V3 = [-e2[0] * sr + e3[0] * cr, -e2[1] * sr + e3[1] * cr, -e2[2] * sr + e3[2] * cr];
    e2 = n2;
    e3 = n3;
  }
  e1 = e1 as V3;
  return { c, e: [e1, e2, e3], r: [pt.rx, pt.ry, pt.rz] };
}

/** Экранная точка модели: (x, y, z) мира → кадр относительно начала. */
function project(x: number, y: number, z: number): [number, number, number] {
  return [x, y * CAM_C - z * CAM_S, y * CAM_S + z * CAM_C];
}

/** Точка в осях модели → мир (поворот на `face`). */
function toWorld(x: number, y: number, z: number, face: number): V3 {
  const cf = Math.cos(face);
  const sf = Math.sin(face);
  return [x * cf - y * sf, x * sf + y * cf, z];
}

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * Нарисовать риг в кадр `w×h`, начало модели (земля под серединой) — в
 * точке (ox, oy) кадра.
 */
export function renderRig(
  parts: Part[],
  face: number,
  w: number,
  h: number,
  ox: number,
  oy: number,
  eyes: { x: number; y: number; z: number; c: RGBA; r?: number }[] = [],
  flash = 0,
): RigOut {
  const p = new Px(w, h);
  const zb = new Float32Array(w * h).fill(-1e9);
  const idb = new Int16Array(w * h).fill(-1);
  const glowAt = new Uint8Array(w * h);
  let anyGlow = false;
  parts.forEach((pt, k) => {
    const A = axesOf(pt, face);
    const [e1, e2, e3] = A.e;
    const [r1, r2, r3] = A.r;
    // Рамка на экране: центр ± наибольший радиус.
    const [scx, scy] = project(A.c[0], A.c[1], A.c[2]);
    const R = Math.max(r1, r2, r3) + 1;
    const x0 = Math.max(0, Math.floor(ox + scx - R));
    const x1 = Math.min(w - 1, Math.ceil(ox + scx + R));
    const y0 = Math.max(0, Math.floor(oy + scy - R));
    const y1 = Math.min(h - 1, Math.ceil(oy + scy + R));
    if (x0 > x1 || y0 > y1) return;
    const qd: V3 = [dot(VIEW, e1) / r1, dot(VIEW, e2) / r2, dot(VIEW, e3) / r3];
    const a = dot(qd, qd);
    const id = pt.id ?? k;
    for (let py = y0; py <= y1; py++)
      for (let px = x0; px <= x1; px++) {
        const sx = px + 0.5 - ox;
        const sy = py + 0.5 - oy;
        // Точка луча при t = 0: (sx, sy·C, −sy·S).
        const d: V3 = [sx - A.c[0], sy * CAM_C - A.c[1], -sy * CAM_S - A.c[2]];
        const q0: V3 = [dot(d, e1) / r1, dot(d, e2) / r2, dot(d, e3) / r3];
        const b = 2 * dot(q0, qd);
        const cc = dot(q0, q0) - 1;
        const disc = b * b - 4 * a * cc;
        if (disc < 0) continue;
        const t = (-b + Math.sqrt(disc)) / (2 * a);
        const i = py * w + px;
        if (t <= zb[i]) continue;
        zb[i] = t;
        idb[i] = id;
        const q: V3 = [q0[0] + t * qd[0], q0[1] + t * qd[1], q0[2] + t * qd[2]];
        const n: V3 = [
          (e1[0] * q[0]) / r1 + (e2[0] * q[1]) / r2 + (e3[0] * q[2]) / r3,
          (e1[1] * q[0]) / r1 + (e2[1] * q[1]) / r2 + (e3[1] * q[2]) / r3,
          (e1[2] * q[0]) / r1 + (e2[2] * q[1]) / r2 + (e3[2] * q[2]) / r3,
        ];
        const nl = Math.hypot(n[0], n[1], n[2]) || 1;
        let lam = dot(n, LIGHT) / nl;
        // Отражённый снизу холодный свет: тень не чёрная.
        const rim = Math.max(0, -n[2] / nl) * 0.18;
        let k2 = Math.max(0, lam * 0.62 + 0.36 + rim);
        if (pt.fur) {
          // Пряди: тёмные штрихи по вертикали модели, зерно — по месту на теле.
          const hz = hash(Math.round(q[0] * 9 + q[1] * 5), Math.round(q[2] * 3 + q[1] * 2), id);
          if (hz < pt.fur) k2 -= 0.22;
          else if (hz > 1 - pt.fur * 0.4) k2 += 0.1;
        }
        if (pt.gloss) {
          const hs = dot(n, [0.2, 0.5, 0.84]) / nl;
          if (hs > 0.93) k2 = 1;
        }
        lam = k2;
        p.set(px, py, toneOf(pt.ramp, lam, px, py));
        if (pt.glow) {
          glowAt[i] = 1;
          anyGlow = true;
        } else glowAt[i] = 0;
      }
  });
  // Линии стыка: дальняя часть темнее у кромки ближней.
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (idb[i] < 0) continue;
      for (const j of [i + 1, i + w, i - 1, i - w]) {
        if (j < 0 || j >= w * h || idb[j] < 0 || idb[j] === idb[i]) continue;
        if (zb[j] - zb[i] > 2.2) {
          const c = p.get(x, y);
          p.set(x, y, [Math.round(c[0] * 0.55), Math.round(c[1] * 0.55), Math.round(c[2] * 0.62), 255]);
          break;
        }
      }
    }
  // Глаза: видны, если ближе тела.
  let eye: [number, number] | null = null;
  for (const e of eyes) {
    const [wx, wy, wz] = toWorld(e.x, e.y, e.z, face);
    const [sx, sy, sd] = project(wx, wy, wz);
    const ex = Math.floor(ox + sx);
    const ey = Math.floor(oy + sy);
    if (ex < 0 || ey < 0 || ex >= w || ey >= h) continue;
    const i = ey * w + ex;
    if (idb[i] >= 0 && zb[i] > sd + 1.2) continue;
    p.set(ex, ey, e.c);
    if ((e.r ?? 0) > 0) p.set(ex + 1, ey, e.c);
    if (!eye) eye = [ex + 0.5, ey + 0.5];
  }
  p.outline(INK);
  let lit: Px | null = null;
  if (anyGlow) {
    lit = new Px(w, h);
    for (let i = 0; i < w * h; i++)
      if (glowAt[i]) {
        const x = i % w;
        const y = (i / w) | 0;
        lit.set(x, y, p.get(x, y));
      }
  }
  if (flash > 0) {
    const f = p.tint(WHITE, flash);
    return { p: f, lit, eye };
  }
  return { p, lit, eye };
}

/** Цепочка шаров по кривой (хобот, бивень, хвост): точки и радиусы. */
export function chain(
  pts: [number, number, number][],
  r: (k: number) => number,
  rmp: RGBA[],
  id: number,
  extra: Partial<Part> = {},
): Part[] {
  const out: Part[] = [];
  for (let i = 0; i < pts.length; i++) {
    const k = pts.length > 1 ? i / (pts.length - 1) : 0;
    const rr = r(k);
    out.push({ x: pts[i][0], y: pts[i][1], z: pts[i][2], rx: rr, ry: rr, rz: rr, ramp: rmp, id, ...extra });
  }
  return out;
}

/** Точки кривой Безье второго порядка. */
export function bez(a: V3, b: V3, c: V3, n: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push([
      u * u * a[0] + 2 * u * t * b[0] + t * t * c[0],
      u * u * a[1] + 2 * u * t * b[1] + t * t * c[1],
      u * u * a[2] + 2 * u * t * b[2] + t * t * c[2],
    ]);
  }
  return out;
}

/** Сторона из 16 (или n) и угол стороны. */
const dirN = (face: number, n: number) => (((Math.round((face / TAU) * n) % n) + n) % n);
const dirAng = (d: number, n: number) => (d / n) * TAU;

/** Плавная кривая 0…1. */
const ease = (k: number) => {
  const c = Math.max(0, Math.min(1, k));
  return c * c * (3 - 2 * c);
};
const easeOut = (k: number) => 1 - (1 - Math.max(0, Math.min(1, k))) ** 3;
const clamp01 = (k: number) => Math.max(0, Math.min(1, k));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** Кадр моба из рига. */
function frameOf(out: RigOut, ax: number, ay: number, extra: Partial<MobFrame> = {}): MobFrame {
  return {
    img: out.p.canvas(),
    ax,
    ay,
    eye: out.eye,
    lit: out.lit ? out.lit.canvas() : null,
    ...extra,
  };
}

/** Кеш кадров: ключ — всё, что меняет картинку. */
type Cached = { img: HTMLCanvasElement; lit: HTMLCanvasElement | null; eye: [number, number] | null };
function cachedRig(
  cache: ReturnType<typeof frameLRU<Cached>>,
  key: string,
  make: () => RigOut,
): Cached {
  const hit = cache.get(key);
  if (hit) return hit;
  const o = make();
  return cache.set(key, { img: o.p.canvas(), lit: o.lit ? o.lit.canvas() : null, eye: o.eye });
}

/** Кадр 24 к/с по времени режима. */
const f24 = (t: number) => Math.max(0, Math.floor(t * 24));

/** Вид моба: элита — иней с синевой, альбинос — белый. */
function lookRamp(r: RGBA[], look: MobPose['look']): RGBA[] {
  if (look === 'albino') return r.map((c) => mixc(c, hx('#f4f8ff'), 0.6));
  if (look === 'elite') return r.map((c, i) => mixc(c, i > 2 ? hx('#bfe8ff') : hx('#2a3a8a'), 0.35));
  return r;
}

void frameOf;
void lerp;
void easeOut;
void ease;
void dirAng;
void bez;
void chain;
void renderRig;
