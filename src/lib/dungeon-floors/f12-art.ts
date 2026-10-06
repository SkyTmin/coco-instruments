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

/** Снег под луной: тень → блик. Белым он становится только у огня. */
const SNOW = ramp('#34466c', '#4f648e', '#7088b2', '#9cb2d4', '#cad8ee');
/** Лёд. */
const ICE = ramp('#163860', '#225486', '#3672a6', '#5c9ccb', '#a0d0ee');
/** Тонкий лёд: темнее, вода близко. */
const THIN = ramp('#0a1a34', '#112c54', '#1c4272', '#356494', '#72a2cc');
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
  vnoise(x, y, s) * 0.55 +
  vnoise(x * 2.1, y * 2.1, s + 7) * 0.3 +
  vnoise(x * 4.3, y * 4.3, s + 13) * 0.15;

/** Порядковый дизеринг 4×4: тон между ступенями без каши. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const dither = (x: number, y: number) => BAYER[(y & 3) * 4 + (x & 3)];

/**
 * Тон по доле 0…1. Без дизеринга — ступени ложатся пятнами по шуму, как
 * у пиксель-арта; `dith` — шахматка только узкой полосой у самого порога.
 */
function toneOf(r: RGBA[], k: number, x: number, y: number, dith = false): RGBA {
  const f = Math.max(0, Math.min(0.999, k)) * (r.length - 1);
  const i = Math.floor(f);
  const fr = f - i;
  const th = dith ? 0.5 + (dither(x, y) - 0.5) * 0.35 : 0.5;
  return r[Math.min(r.length - 1, i + (fr > th ? 1 : 0))];
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
  /** Снег на спине: доля верха тела под рваными пятнами снега. */
  snowy?: number;
  /** Светится (слой поверх темноты). */
  glow?: boolean;
  /** Блеск льда: светлая искра на изломе. */
  gloss?: boolean;
  /** Номер для линий стыка (по умолчанию — порядковый). */
  id?: number;
  /** Прозрачность (лёд вокруг вмёрзшего, тело духа): рисуется поверх плотного. */
  alpha?: number;
}

export interface RigOut {
  p: Px;
  lit: Px | null;
  /** Глаз в кадре (если виден). */
  eye: [number, number] | null;
  /** Обрезка (`crop`): левый верхний угол кадра в полном холсте. */
  cx?: number;
  cy?: number;
  /** Глубина ближней поверхности по кадру (к зрителю больше), −1e9 — пусто. */
  zb?: Float32Array;
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
 * Рабочие буферы рига: глубина, номер части, свечение и холст до обрезки —
 * одни на все кадры (кадр обрезается в свой холст, рабочий — не уходит
 * наружу). Новые массивы на каждый кадр — это сборщик мусора в бою.
 */
interface RigBufs {
  n: number;
  zb: Float32Array;
  idb: Int16Array;
  glow: Uint8Array;
  px: Map<string, Px>;
}
const rigBufs = (): RigBufs => ({
  n: 0,
  zb: new Float32Array(0),
  idb: new Int16Array(0),
  glow: new Uint8Array(0),
  px: new Map(),
});
/** Общие — для кадра, нарисованного сразу; свои — у кадра «на потом» (`rigJob`). */
const RIG_BUF = rigBufs();
function rigBuf(n: number, B = RIG_BUF) {
  if (B.n < n) {
    B.n = n;
    B.zb = new Float32Array(n);
    B.idb = new Int16Array(n);
    B.glow = new Uint8Array(n);
  }
  const zb = B.zb.subarray(0, n);
  const idb = B.idb.subarray(0, n);
  const glow = B.glow.subarray(0, n);
  zb.fill(-1e9);
  idb.fill(-1);
  glow.fill(0);
  return { zb, idb, glow };
}
function rigPx(w: number, h: number, B = RIG_BUF): Px {
  const k = `${w}x${h}`;
  let p = B.px.get(k);
  if (!p) {
    p = new Px(w, h);
    if (B.px.size > 8) B.px.clear();
    B.px.set(k, p);
  } else p.data.fill(0);
  return p;
}

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
  clipZ = -1e9,
  crop = false,
  /** Точки кадра, которые обрезка обязана сохранить (след бивней и т. п.). */
  keep: [number, number][] = [],
): RigOut {
  return rigJob(parts, face, w, h, ox, oy, eyes, flash, clipZ, crop, keep).out();
}

/**
 * Кадр рига по частям: `step(мс)` рисует части, пока не кончится бюджет
 * (`true` — кадр готов), `out()` дорисовывает остаток сразу. Кадр «на
 * потом» (`own` — свои буферы: между шагами рисуют другие) растягивается на
 * несколько кадров игры, и ни один из них не платит за кадр целиком.
 */
interface RigJob {
  step: (ms: number) => boolean;
  out: () => RigOut;
}
function rigJob(
  parts: Part[],
  face: number,
  w: number,
  h: number,
  ox: number,
  oy: number,
  eyes: { x: number; y: number; z: number; c: RGBA; r?: number }[] = [],
  flash = 0,
  clipZ = -1e9,
  crop = false,
  keep: [number, number][] = [],
  own?: RigBufs,
): RigJob {
  const p = own ? rigPx(w, h, own) : crop ? rigPx(w, h) : new Px(w, h);
  // Рамка нарисованного: швы, контур и холст — только в ней.
  let bx0 = w;
  let by0 = h;
  let bx1 = -1;
  let by1 = -1;
  const { zb, idb, glow: glowAt } = rigBuf(w * h, own);
  let anyGlow = false;
  // Сперва плотные части — от ближних к дальним (дальний пиксель за ближним
  // отсекает буфер глубины без расчёта цвета; итог тот же: в пикселе всегда
  // ближайшая часть), потом прозрачные (лёд вокруг вмёрзшего, дух).
  const order = parts
    .map((pt, k) => {
      const A = axesOf(pt, face);
      const glass = (pt.alpha ?? 1) < 1;
      return { pt, k, A, glass, d: glass ? 0 : dot(VIEW, A.c) };
    })
    .sort(
      (a, b) =>
        (a.glass ? 1 : 0) - (b.glass ? 1 : 0) || (a.glass ? a.k - b.k : b.d - a.d || a.k - b.k),
    );
  const drawPart = ({ pt, k, A, glass }: (typeof order)[number]) => {
    const [e1, e2, e3] = A.e;
    const [r1, r2, r3] = A.r;
    // Рамка на экране — точная тень эллипсоида (опорная функция по осям
    // экрана): у длинных тонких частей она в разы меньше квадрата по
    // наибольшему радиусу, а пиксели те же — за рамкой луч всё равно мимо.
    const [scx, scy] = project(A.c[0], A.c[1], A.c[2]);
    const [e1x, e1y, e1z] = e1;
    const [e2x, e2y, e2z] = e2;
    const [e3x, e3y, e3z] = e3;
    const RX = Math.sqrt((r1 * e1x) ** 2 + (r2 * e2x) ** 2 + (r3 * e3x) ** 2) + 1;
    const RY =
      Math.sqrt(
        (r1 * (e1y * CAM_C - e1z * CAM_S)) ** 2 +
          (r2 * (e2y * CAM_C - e2z * CAM_S)) ** 2 +
          (r3 * (e3y * CAM_C - e3z * CAM_S)) ** 2,
      ) + 1;
    const x0 = Math.max(0, Math.floor(ox + scx - RX));
    const x1 = Math.min(w - 1, Math.ceil(ox + scx + RX));
    const y0 = Math.max(0, Math.floor(oy + scy - RY));
    const y1 = Math.min(h - 1, Math.ceil(oy + scy + RY));
    if (x0 > x1 || y0 > y1) return;
    // Всё по скалярам: массив на пиксель — это сборщик мусора в кадре.
    const qdx = dot(VIEW, e1) / r1;
    const qdy = dot(VIEW, e2) / r2;
    const qdz = dot(VIEW, e3) / r3;
    const a = qdx * qdx + qdy * qdy + qdz * qdz;
    const [ccx, ccy, ccz] = A.c;
    const id = pt.id ?? k;
    const fur = pt.fur ?? 0;
    const alphaP = pt.alpha ?? 1;
    // Ближе этой глубины у части точек нет: пиксель, где уже лежит что-то
    // ближе, луч не проверяет (части идут от ближних к дальним).
    const tMax = dot(VIEW, A.c) + Math.max(r1, r2, r3) + 1e-3;
    // Пролёт строки: дискриминант по x — парабола ветвями вниз, луч попадает
    // только между её корнями. Пиксели вне пролёта (+1 запаса на округление)
    // не проверяем вовсе; внутри — та же проверка, что и раньше.
    const ux = e1x / r1;
    const uy = e2x / r2;
    const uz = e3x / r3;
    const al = ux * qdx + uy * qdy + uz * qdz;
    const A2 = al * al - a * (ux * ux + uy * uy + uz * uz);
    for (let py = y0; py <= y1; py++) {
      const sy = py + 0.5 - oy;
      // Точка луча при t = 0: (sx, sy·C, −sy·S).
      const dy0 = sy * CAM_C - ccy;
      const dz0 = -sy * CAM_S - ccz;
      const zTop = -sy * CAM_S;
      let xa = x0;
      let xb = x1;
      if (A2 < -1e-9) {
        const vx = (dy0 * e1y + dz0 * e1z) / r1;
        const vy = (dy0 * e2y + dz0 * e2z) / r2;
        const vz = (dy0 * e3y + dz0 * e3z) / r3;
        const be = vx * qdx + vy * qdy + vz * qdz;
        const B2 = al * be - a * (ux * vx + uy * vy + uz * vz);
        const C2 = be * be - a * (vx * vx + vy * vy + vz * vz - 1);
        const D2 = B2 * B2 - A2 * C2;
        if (D2 < 0) continue;
        const sq = Math.sqrt(D2);
        const s1 = (-B2 - sq) / A2;
        const s2 = (-B2 + sq) / A2;
        const base = ox + ccx - 0.5;
        xa = Math.max(x0, Math.floor(Math.min(s1, s2) + base) - 1);
        xb = Math.min(x1, Math.ceil(Math.max(s1, s2) + base) + 1);
      }
      for (let px = xa; px <= xb; px++) {
        const i = py * w + px;
        if (zb[i] >= tMax) continue;
        const dx0 = px + 0.5 - ox - ccx;
        const q0x = (dx0 * e1x + dy0 * e1y + dz0 * e1z) / r1;
        const q0y = (dx0 * e2x + dy0 * e2y + dz0 * e2z) / r2;
        const q0z = (dx0 * e3x + dy0 * e3y + dz0 * e3z) / r3;
        const b = 2 * (q0x * qdx + q0y * qdy + q0z * qdz);
        const cc = q0x * q0x + q0y * q0y + q0z * q0z - 1;
        const disc = b * b - 4 * a * cc;
        if (disc < 0) continue;
        const t = (-b + Math.sqrt(disc)) / (2 * a);
        if (t <= zb[i]) continue;
        if (zTop + t * CAM_C < clipZ) continue;
        if (px < bx0) bx0 = px;
        if (px > bx1) bx1 = px;
        if (py < by0) by0 = py;
        if (py > by1) by1 = py;
        if (!glass) {
          zb[i] = t;
          idb[i] = id;
        }
        const qx = q0x + t * qdx;
        const qy = q0y + t * qdy;
        const qz = q0z + t * qdz;
        const nx = (e1x * qx) / r1 + (e2x * qy) / r2 + (e3x * qz) / r3;
        const ny = (e1y * qx) / r1 + (e2y * qy) / r2 + (e3y * qz) / r3;
        const nz = (e1z * qx) / r1 + (e2z * qy) / r2 + (e3z * qz) / r3;
        const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        const lam = (nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]) / nl;
        // Отражённый снизу холодный свет: тень не чёрная.
        const rim = Math.max(0, -nz / nl) * 0.18;
        let k2 = Math.max(0, lam * 0.62 + 0.36 + rim);
        if (fur) {
          // Пряди: тёмные штрихи по вертикали модели, зерно — по месту на теле.
          const hz = hash(Math.round(qx * 9 + qy * 5), Math.round(qz * 3 + qy * 2), id);
          if (hz < fur) k2 -= 0.22;
          else if (hz > 1 - fur * 0.4) k2 += 0.1;
        }
        if (pt.gloss) {
          const hs = (nx * 0.2 + ny * 0.5 + nz * 0.84) / nl;
          if (hs > 0.93) k2 = 1;
        }
        let rp = pt.ramp;
        if (pt.snowy) {
          // Пятна снега там, куда смотрит небо: чем ровнее верх, тем гуще.
          const up = nz / nl - (1 - pt.snowy);
          if (up > 0) {
            const hs =
              hash(Math.round(qx * 3.2 + qy * 1.3), Math.round(qy * 3.2 - qx * 1.1), id + 77) *
                0.6 +
              hash(Math.round(qx * 9), Math.round(qy * 9 + qz * 4), id + 78) * 0.4;
            if (hs < (up / pt.snowy) * 1.15) {
              rp = SNOW;
              k2 += 0.08;
            }
          }
        }
        const col = toneOf(rp, k2, px, py);
        if (glass) {
          // Стекло: кромка плотнее середины.
          const edge = 1 - Math.abs((nx * VIEW[0] + ny * VIEW[1] + nz * VIEW[2]) / nl);
          p.set(px, py, alpha(col, Math.min(1, alphaP * (0.6 + edge * 0.9))));
          if (pt.glow) {
            glowAt[i] = 1;
            anyGlow = true;
          }
          continue;
        }
        p.set(px, py, col);
        if (pt.glow) {
          glowAt[i] = 1;
          anyGlow = true;
        } else glowAt[i] = 0;
      }
    }
  };
  const finish = (): RigOut => {
    // Линии стыка: дальняя часть темнее у кромки ближней.
    for (let y = by0; y <= by1; y++)
      for (let x = bx0; x <= bx1; x++) {
        const i = y * w + x;
        if (idb[i] < 0) continue;
        for (let n = 0; n < 4; n++) {
          const j = n === 0 ? i + 1 : n === 1 ? i + w : n === 2 ? i - 1 : i - w;
          if (j < 0 || j >= w * h || idb[j] < 0 || idb[j] === idb[i]) continue;
          if (zb[j] - zb[i] > 2.2) {
            const c = p.get(x, y);
            p.set(x, y, [
              Math.round(c[0] * 0.55),
              Math.round(c[1] * 0.55),
              Math.round(c[2] * 0.62),
              255,
            ]);
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
    if (crop) {
      // Кадр по рамке (+6: контур и рисунок поверх — звёзды, брызги): меньше
      // холст, контур и вывод на экран.
      if (bx1 < 0) {
        bx0 = by0 = 0;
        bx1 = by1 = 0;
      }
      for (const [kx, ky] of keep) {
        bx0 = Math.min(bx0, Math.floor(kx));
        bx1 = Math.max(bx1, Math.ceil(kx));
        by0 = Math.min(by0, Math.floor(ky));
        by1 = Math.max(by1, Math.ceil(ky));
      }
      const cx = Math.max(0, bx0 - 6);
      const cy = Math.max(0, by0 - 6);
      const cw = Math.min(w, bx1 + 7) - cx;
      const ch = Math.min(h, by1 + 7) - cy;
      const q = new Px(cw, ch);
      for (let y = 0; y < ch; y++) {
        const src = ((y + cy) * w + cx) * 4;
        q.data.set(p.data.subarray(src, src + cw * 4), y * cw * 4);
      }
      q.outline(INK);
      let lit: Px | null = null;
      if (anyGlow) {
        lit = new Px(cw, ch);
        const qd = q.data;
        const c4: RGBA = [0, 0, 0, 0];
        for (let y = 0; y < ch; y++)
          for (let x = 0; x < cw; x++)
            if (glowAt[(y + cy) * w + x + cx]) {
              const j = (y * cw + x) * 4;
              c4[0] = qd[j];
              c4[1] = qd[j + 1];
              c4[2] = qd[j + 2];
              c4[3] = qd[j + 3];
              lit.set(x, y, c4);
            }
      }
      const e2: [number, number] | null = eye ? [eye[0] - cx, eye[1] - cy] : null;
      const zc = new Float32Array(cw * ch);
      for (let y = 0; y < ch; y++)
        zc.set(zb.subarray((y + cy) * w + cx, (y + cy) * w + cx + cw), y * cw);
      return { p: flash > 0 ? q.tint(WHITE, flash) : q, lit, eye: e2, cx, cy, zb: zc };
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
  };
  let n = 0;
  let res: RigOut | null = null;
  const step = (ms: number): boolean => {
    if (res) return true;
    const t0 = ms < Infinity ? performance.now() : 0;
    while (n < order.length) {
      drawPart(order[n++]);
      if (ms < Infinity && performance.now() - t0 > ms) return false;
    }
    res = finish();
    return true;
  };
  return {
    step,
    out: () => {
      step(Infinity);
      return res as RigOut;
    },
  };
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
const dirN = (face: number, n: number) => ((Math.round((face / TAU) * n) % n) + n) % n;
const dirAng = (d: number, n: number) => (d / n) * TAU;

/** Плавная кривая 0…1. */
const ease = (k: number) => {
  const c = Math.max(0, Math.min(1, k));
  return c * c * (3 - 2 * c);
};
const easeOut = (k: number) => 1 - (1 - Math.max(0, Math.min(1, k))) ** 3;
const clamp01 = (k: number) => Math.max(0, Math.min(1, k));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** Кеш кадров: ключ — всё, что меняет картинку. */
type Cached = {
  img: HTMLCanvasElement;
  lit: HTMLCanvasElement | null;
  eye: [number, number] | null;
  /** Сдвиг обрезанного кадра от левого верха полного холста. */
  dx: number;
  dy: number;
};
function cachedRig(
  cache: ReturnType<typeof frameLRU<Cached>>,
  key: string,
  make: () => RigOut,
): Cached {
  const hit = cache.get(key);
  if (hit) return hit;
  const o = make();
  return cache.set(key, {
    img: o.p.canvas(),
    lit: o.lit ? o.lit.canvas() : null,
    eye: o.eye,
    dx: o.cx ?? 0,
    dy: o.cy ?? 0,
  });
}

/** Кадр 24 к/с по времени режима. */
const f24 = (t: number) => Math.max(0, Math.floor(t * 24));

/** Вид моба: элита — иней с синевой, альбинос — белый. */
function lookRamp(r: RGBA[], look: MobPose['look']): RGBA[] {
  if (look === 'albino') return r.map((c) => mixc(c, hx('#f4f8ff'), 0.6));
  if (look === 'elite')
    return r.map((c, i) => mixc(c, i > 2 ? hx('#bfe8ff') : hx('#2a3a8a'), 0.35));
  return r;
}

// ---------------------------------------------------------------------------
// Шум по миру: заранее посчитанные периодические текстуры 256×256.
// Клетка берёт пиксели по мировым координатам — стыков нет, а кусок карты
// строится за миллисекунды (одна выборка массива на пиксель).
// ---------------------------------------------------------------------------

const NW = 256;
function periodic(cell: number, seed: number): Float32Array {
  const P = NW / cell;
  const out = new Float32Array(NW * NW);
  for (let y = 0; y < NW; y++)
    for (let x = 0; x < NW; x++) {
      const gx = x / cell;
      const gy = y / cell;
      const xi = Math.floor(gx);
      const yi = Math.floor(gy);
      const fx = gx - xi;
      const fy = gy - yi;
      const u = fx * fx * (3 - 2 * fx);
      const v = fy * fy * (3 - 2 * fy);
      const h = (a: number, b: number) => hash(((a % P) + P) % P, ((b % P) + P) % P, seed);
      const a = h(xi, yi);
      const b = h(xi + 1, yi);
      const c = h(xi, yi + 1);
      const d = h(xi + 1, yi + 1);
      out[y * NW + x] = a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    }
  return out;
}

let NZ: { fbm: Float32Array; big: Float32Array; fine: Float32Array; streak: Float32Array } | null =
  null;
function noise() {
  if (NZ) return NZ;
  const n32 = periodic(32, 11);
  const n16 = periodic(16, 12);
  const n8 = periodic(8, 13);
  const n4 = periodic(4, 14);
  const n64 = periodic(64, 15);
  const fbm = new Float32Array(NW * NW);
  const big = new Float32Array(NW * NW);
  const fine = new Float32Array(NW * NW);
  const streak = new Float32Array(NW * NW);
  for (let i = 0; i < NW * NW; i++) {
    fbm[i] = n32[i] * 0.5 + n16[i] * 0.28 + n8[i] * 0.14 + n4[i] * 0.08;
    big[i] = n64[i] * 0.7 + n32[i] * 0.3;
    fine[i] = n8[i] * 0.6 + n4[i] * 0.4;
  }
  // Полосы полировки льда: шум, вытянутый вдоль диагонали.
  for (let y = 0; y < NW; y++)
    for (let x = 0; x < NW; x++) {
      const u = (x + y * 2) & (NW - 1);
      const v = ((y - x) * 3) & (NW - 1);
      streak[y * NW + x] = n16[(v & (NW - 1)) * NW + u] * 0.65 + n4[y * NW + x] * 0.35;
    }
  NZ = { fbm, big, fine, streak };
  return NZ;
}
const at = (a: Float32Array, X: number, Y: number) => a[(Y & (NW - 1)) * NW + (X & (NW - 1))];

// ---------------------------------------------------------------------------
// Клетки районов.
// ---------------------------------------------------------------------------

const TS = 16;
type Look = 'grotto' | 'lake' | 'shrine';
const LOOK: Record<string, Look> = {
  [F12_GROTTO]: 'grotto',
  [F12_LAKE]: 'lake',
  [F12_SHRINE]: 'shrine',
};

/** Вода: открытая полынья, озеро, протока, источник. */
const WETS = new Set<number>([
  MK.hole,
  MK.sealHole,
  MK.water,
  MK.current,
  MK.bridge0,
  MK.spring,
  MK.holeNew,
]);
/** Пол «из снега»: сугроб, снег. */
const SNOWY = new Set<number>([MK.snow, MK.drift, MK.foxDrift]);

/** Тень от стены сверху и с боков — пол рисуется целиком, тень наша. */
function wallShade(c: CellCtx, x: number, y: number): number {
  let k = 0;
  if (!c.open(0, -1)) k += Math.max(0, 1 - y / 5) * 0.55;
  if (!c.open(-1, 0)) k += Math.max(0, 1 - x / 3) * 0.3;
  if (!c.open(1, 0)) k += Math.max(0, 1 - (15 - x) / 3) * 0.3;
  if (!c.open(-1, -1) && c.open(0, -1) && x < 3 && y < 3) k += 0.15;
  if (!c.open(1, -1) && c.open(0, -1) && x > 12 && y < 3) k += 0.15;
  return Math.min(0.7, k);
}

/** Вода рядом (для каёмки): клетка-сосед — открытая вода. */
const wetAt = (c: CellCtx, dx: number, dy: number) => c.open(dx, dy) && WETS.has(c.markAt(dx, dy));

function snowPx(p: Px, c: CellCtx, look: Look, drift: boolean): void {
  const N = noise();
  const X0 = c.wx * TS;
  const Y0 = c.wy * TS;
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const Y = Y0 + y;
      const f = at(N.fbm, X, Y);
      const b = at(N.big, X, Y);
      // Заструги: мягкие гряды поперёк ветра.
      const rip = Math.sin(X * 0.16 + Y * 0.42 + b * 9) * 0.5 + 0.5;
      let k = 0.5 + (f - 0.5) * 0.55 + (rip - 0.5) * 0.12;
      if (drift) {
        // Сугроб: крупнее и светлее, с тенью снизу-справа у каждой «горбушки».
        const g = at(N.big, X + 40, Y + 17);
        const gs = at(N.big, X + 37, Y + 14);
        k = 0.66 + (g - 0.5) * 0.6 + (g - gs) * 3.2;
      }
      if (look === 'lake') k -= 0.05;
      k -= wallShade(c, x, y);
      let col = toneOf(SNOW, k, X, Y);
      // Искры инея.
      const h = hash(X, Y, 3);
      if (h < (drift ? 0.012 : 0.007) && k > 0.45) col = WHITE;
      else if (h > 0.996) col = hx('#a8f0ff');
      p.set(x, y, col);
    }
  // Сугроб у края: голубая тень на соседний пол — рисует сам сугроб снизу.
  if (drift) {
    const below = c.markAt(0, 1);
    if (!SNOWY.has(below) || below === MK.snow) {
      for (let x = 0; x < TS; x++) {
        const d = Math.round(1 + hash(X0 + x, Y0, 9) * 2);
        for (let y = TS - d; y < TS; y++) p.set(x, y, alpha(SNOW[0], 0.55));
      }
    }
  }
}

function icePx(
  p: Px,
  c: CellCtx,
  look: Look,
  kind: 'ice' | 'thin' | 'polish' | 'grit' | 'post',
): void {
  const N = noise();
  const X0 = c.wx * TS;
  const Y0 = c.wy * TS;
  const R = kind === 'thin' ? THIN : ICE;
  const base = kind === 'thin' ? 0.46 : kind === 'polish' ? 0.62 : 0.5;
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const Y = Y0 + y;
      const f = at(N.fbm, X, Y);
      const s = at(N.streak, X, Y);
      let k = base + (f - 0.5) * 0.45;
      // Глубина подо льдом — тёмные облака.
      const deep = at(N.big, X + 91, Y + 33);
      if (deep < 0.38) k -= (0.38 - deep) * (kind === 'thin' ? 1.6 : 0.8);
      // Полировка: светлые косые полосы.
      if (s > 0.72) k += (s - 0.72) * (kind === 'polish' ? 2.2 : 1.3);
      k -= wallShade(c, x, y);
      let col = toneOf(R, k, X, Y);
      const h = hash(X, Y, 5);
      // Пузырьки воздуха во льду.
      if (h < 0.006) col = R[4];
      else if (h > 0.994 && kind !== 'thin') col = R[1];
      if (kind === 'grit') {
        // Посыпано золой и песком: по такому не скользят.
        const g = hash(X >> 1, Y >> 1, 21);
        if (g < 0.22) col = g < 0.07 ? hx('#3a2a22') : g < 0.15 ? hx('#6a5a4c') : hx('#8a7a66');
      }
      p.set(x, y, col);
    }
  // Трещины во льду: ломаные по мировым координатам (сквозь клетки).
  crackLines(p, X0, Y0, kind === 'thin' ? 0.5 : kind === 'polish' ? 0.06 : 0.12, kind === 'thin');
  if (kind === 'polish') {
    // Плиты чертога: швы через 4 клетки, светлые.
    for (let y = 0; y < TS; y++)
      for (let x = 0; x < TS; x++) {
        const X = X0 + x;
        const Y = Y0 + y;
        if (X % 48 === 0 || Y % 32 === 0) p.set(x, y, alpha(ICE[4], 0.55));
        else if (X % 48 === 1 || Y % 32 === 1) p.set(x, y, alpha(ICE[0], 0.35));
      }
  }
  if (kind === 'post') {
    // Под сосулькой: кружок инея и осколки — видно, где упадёт.
    for (let y = 0; y < TS; y++)
      for (let x = 0; x < TS; x++) {
        const d = Math.hypot(x - 7.5, (y - 7.5) * 1.25);
        if (d > 5.6 && d < 6.6 && hash(c.wx * 16 + x, c.wy * 16 + y, 31) < 0.7)
          p.set(x, y, alpha(WHITE, 0.55));
        if (d < 5 && hash(x, y, c.wx * 7 + c.wy) < 0.05) p.set(x, y, ICE[4]);
      }
  }
}

/** Сеть трещин: отрезки по решётке 24 px с дрожью; `k` — сколько их. */
function crackLines(p: Px, X0: number, Y0: number, k: number, dark: boolean): void {
  const G = 24;
  const gx0 = Math.floor(X0 / G) - 1;
  const gy0 = Math.floor(Y0 / G) - 1;
  const light = dark ? alpha(THIN[4], 0.6) : alpha(ICE[4], 0.5);
  const shade = dark ? alpha(WATER[0], 0.6) : alpha(ICE[1], 0.4);
  const node = (i: number, j: number): [number, number] => [
    i * G + hash(i, j, 41) * G * 0.8,
    j * G + hash(i, j, 42) * G * 0.8,
  ];
  for (let j = gy0; j <= gy0 + 2; j++)
    for (let i = gx0; i <= gx0 + 2; i++) {
      const a = node(i, j);
      for (const [di, dj, s] of [
        [1, 0, 43],
        [0, 1, 44],
        [1, 1, 45],
      ] as const) {
        if (hash(i, j, s) > k) continue;
        const b = node(i + di, j + dj);
        const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]));
        let jx = 0;
        for (let t = 0; t <= n; t++) {
          if (t % 4 === 0) jx = (hash(i * 31 + t, j, s) - 0.5) * 2;
          const X = Math.round(a[0] + ((b[0] - a[0]) * t) / n + jx);
          const Y = Math.round(a[1] + ((b[1] - a[1]) * t) / n);
          const x = X - X0;
          const y = Y - Y0;
          if (x < 0 || y < 0 || x >= TS || y >= TS) continue;
          p.set(x, y, light);
          p.set(x, y + 1, shade);
        }
      }
    }
}

function rugPx(p: Px, c: CellCtx): void {
  const X0 = c.wx * TS;
  const Y0 = c.wy * TS;
  // Ковёр шаманки: тёмный войлок, ступенчатый северный ромб на две клетки
  // (одна клетка повторялась сеткой и кричала), протёртости и снежная пыль.
  const N = noise();
  const RUG = ramp('#240c12', '#3a141a', '#562026', '#743230', '#8e4636');
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const Y = Y0 + y;
      const u = ((X % 32) + 32) % 32;
      const v = ((Y % 32) + 32) % 32;
      const q = Math.floor((Math.abs(u - 15.5) + Math.abs(v - 15.5)) / 2);
      let col = RUG[1];
      if (q === 0) col = TEAL[1];
      else if (q === 2 || q === 5) col = BONE[1];
      else if (q === 3 || q === 4) col = RUG[2];
      else if (q === 7) col = RUG[3];
      else if (q >= 13) col = RUG[0];
      const wear = at(N.fbm, X, Y);
      if (wear < 0.4) col = mixc(col, RUG[0], 0.5);
      const sn = at(N.big, X * 2, Y * 2);
      if (sn > 0.66) col = mixc(col, SNOW[3], Math.min(0.7, (sn - 0.66) * 2.4));
      col = mixc(col, INK, wallShade(c, x, y));
      p.set(x, y, col);
    }
  const edge = (dx: number, dy: number) => c.markAt(dx, dy) !== MK.rug || !c.open(dx, dy);
  for (let i = 0; i < TS; i++) {
    if (edge(0, -1)) {
      p.set(i, 0, BONE[0]);
      if (i % 2 === 0) p.set(i, 1, BONE[1]);
    }
    if (edge(0, 1)) {
      p.set(i, 15, BONE[0]);
      if (i % 2 === 0) p.set(i, 14, BONE[1]);
    }
    if (edge(-1, 0)) p.set(0, i, BONE[0]);
    if (edge(1, 0)) p.set(15, i, BONE[0]);
  }
}

function stonePx(p: Px, c: CellCtx, warm: boolean): void {
  const N = noise();
  const X0 = c.wx * TS;
  const Y0 = c.wy * TS;
  const R = warm ? ramp('#1a1c22', '#2c3036', '#444a4c', '#5c6460', '#7c8678') : STONE;
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const Y = Y0 + y;
      // Плиты 8×8 со сдвигом рядов.
      const row = Math.floor(Y / 8);
      const sx = X + (row & 1) * 4;
      const seam = ((sx % 8) + 8) % 8 === 0 || ((Y % 8) + 8) % 8 === 0;
      const slab = hash(Math.floor(sx / 8), row, 51);
      let k = 0.42 + slab * 0.22 + (at(N.fine, X, Y) - 0.5) * 0.3;
      k -= wallShade(c, x, y);
      let col = seam ? R[0] : toneOf(R, k, X, Y);
      if (!warm && seam && hash(X, Y, 52) < 0.55) col = SNOW[1]; // снег в швах
      if (warm) {
        // Тёплый камень: мокрый, мох у швов, лужицы.
        if (seam && hash(X, Y, 53) < 0.5) col = hx('#2f4a2a');
        const pud = at(N.big, X + 13, Y + 77);
        if (pud > 0.66) col = toneOf(TEAL, 0.2 + (pud - 0.66) * 2, X, Y);
      }
      p.set(x, y, col);
    }
}

function arenaPx(p: Px, c: CellCtx, area: string): void {
  icePx(p, c, 'shrine', 'polish');
  const g = F12_GEO.arena;
  const top = F12_TOP[area] ?? 0;
  const cx = g.x;
  const cy = g.y + top;
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const wx = c.wx + (x + 0.5) / TS;
      const wy = c.wy + (y + 0.5) / TS;
      const dx = (wx - cx) / g.rx;
      const dy = (wy - cy) / g.ry;
      const d = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      const px = 1 / (TS * g.rx);
      // Три кольца рун — вырезаны во льду, светятся бирюзой.
      for (const R0 of [0.32, 0.64, 0.94]) {
        if (Math.abs(d - R0) < px * 1.1) p.set(x, y, TEAL[3]);
        else if (Math.abs(d - R0 - px * 1.6) < px * 0.7) p.set(x, y, alpha(ICE[0], 0.6));
      }
      // Руны между кольцами: засечки по углу.
      const ring = d > 0.4 && d < 0.56 ? 1 : d > 0.72 && d < 0.86 ? 2 : 0;
      if (ring) {
        const n = ring === 1 ? 12 : 20;
        const s = (a / TAU + 1) * n;
        const f = s - Math.floor(s);
        const id = Math.floor(s) % n;
        const mid = ring === 1 ? 0.48 : 0.79;
        const v = (d - mid) / 0.06;
        const glyph = runeAt(id, f, v);
        if (glyph) p.set(x, y, glyph === 2 ? AURORA[3] : TEAL[2]);
      }
      // Звезда в центре.
      if (d < 0.22) {
        const st = Math.abs(Math.cos(a * 4)) ** 8;
        if (d < 0.05 + st * 0.15 && d > 0.02) p.set(x, y, TEAL[3]);
      }
    }
}

/** Знак руны: (номер, доля по дуге 0…1, высота −1…1) → 0 / 1 линия / 2 точка. */
function runeAt(id: number, f: number, v: number): number {
  if (Math.abs(v) > 1 || f < 0.2 || f > 0.8) return 0;
  const u = (f - 0.2) / 0.6;
  const h = hash(id, 0, 77);
  // Вертикальная черта посередине у всех.
  if (Math.abs(u - 0.5) < 0.09) return 1;
  // Ветки по зерну: вверх-влево, вниз-вправо, полочка.
  if (h < 0.5 && Math.abs(v + 0.5 - (u - 0.5) * 1.6) < 0.22 && u < 0.5) return 1;
  if (h > 0.3 && Math.abs(v - 0.4 + (u - 0.5) * 1.6) < 0.22 && u > 0.5) return 1;
  if (h > 0.75 && Math.abs(v) < 0.16) return 1;
  if (h < 0.25 && Math.abs(u - 0.82) < 0.1 && Math.abs(v + 0.7) < 0.2) return 2;
  return 0;
}

/** Вода: глубина, каёмка льда, «лицо» льдины над верхним краем. */
function waterPx(p: Px, c: CellCtx, mark: number): void {
  const N = noise();
  const X0 = c.wx * TS;
  const Y0 = c.wy * TS;
  const spring = mark === MK.spring;
  const flow = mark === MK.current;
  const R = spring ? ramp('#06221e', '#0c3a34', '#14584c', '#2a8a70', '#7ad8b8') : WATER;
  const dryUp = !c.open(0, -1) || !wetAt(c, 0, -1);
  const dryDn = !c.open(0, 1) || !wetAt(c, 0, 1);
  const dryL = !c.open(-1, 0) || !wetAt(c, -1, 0);
  const dryR = !c.open(1, 0) || !wetAt(c, 1, 0);
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const Y = Y0 + y;
      let k = 0.38 + (at(N.fbm, X, Y) - 0.5) * 0.35;
      if (mark === MK.water) k -= 0.1;
      if (flow) {
        // Струи течения — рваными штрихами вдоль протоки, а не сплошными
        // полосами (сплошные читались дождём).
        const dash = at(N.fine, X * 3, Y * 0.3) > 0.52 ? 1 : 0.15;
        k += (Math.sin(X * 0.9 + at(N.big, X, Y * 0.3) * 12) * 0.5 + 0.5) * 0.12 * dash;
      }
      // Мелко у кромки: светлее.
      let edge = 99;
      if (dryUp) edge = Math.min(edge, y);
      if (dryDn) edge = Math.min(edge, 15 - y);
      if (dryL) edge = Math.min(edge, x);
      if (dryR) edge = Math.min(edge, 15 - x);
      if (edge < 6) k += (6 - edge) * 0.04;
      // Подо льдом верхнего края — тень льдины.
      if (dryUp && y < 6) k -= (6 - y) * 0.05;
      p.set(x, y, toneOf(R, k, X, Y));
    }
  // Каёмка: рваный белый край льда (сосед — твёрдое).
  const lip = (x: number, y: number, depth: number, top: boolean) => {
    for (let d = 0; d < depth; d++) {
      const col = top
        ? d === 0
          ? ICE[4]
          : d < depth - 1
            ? ICE[d % 2 === 0 ? 2 : 1]
            : ICE[0]
        : d === 0
          ? WHITE
          : ICE[3];
      if (top) p.set(x, y + d, col);
      else p.set(x, y, col);
    }
  };
  for (let i = 0; i < TS; i++) {
    const j = hash(X0 + i, Y0, 61);
    if (dryUp) lip(i, 0, 3 + Math.round(j * 2), true); // лицо льдины: 3–5 px
    if (dryDn) {
      const n = 1 + Math.round(hash(X0 + i, Y0 + 15, 62) * 1.4);
      for (let d = 0; d < n; d++) p.set(i, 15 - d, d === 0 ? ICE[3] : alpha(ICE[4], 0.8));
    }
    if (dryL) {
      const n = 1 + Math.round(hash(X0, Y0 + i, 63) * 1.4);
      for (let d = 0; d < n; d++) p.set(d, i, d === 0 ? ICE[3] : alpha(ICE[4], 0.7));
    }
    if (dryR) {
      const n = 1 + Math.round(hash(X0 + 15, Y0 + i, 64) * 1.4);
      for (let d = 0; d < n; d++) p.set(15 - d, i, d === 0 ? ICE[2] : alpha(ICE[3], 0.7));
    }
  }
  if (mark === MK.hole || mark === MK.sealHole || mark === MK.holeNew) holeShape(p, c, X0, Y0);
  if (mark === MK.holeNew) {
    // Свежая полынья: плавают обломки льда.
    for (let k = 0; k < 3; k++) {
      const cx = 3 + hash(X0, Y0, 70 + k) * 10;
      const cy = 4 + hash(X0, Y0, 80 + k) * 9;
      const r = 1.2 + hash(X0, Y0, 90 + k) * 1.6;
      p.ell(cx, cy, r + 0.6, r * 0.8, ICE[3]);
      p.ell(cx - 0.4, cy - 0.4, r * 0.6, r * 0.45, ICE[4]);
    }
  }
  if (mark === MK.bridge0) {
    // Под мостом: старые сваи торчат из воды.
    for (const sx of [2, 13]) {
      p.rect(sx, 6, sx + 1, 13, WOOD[1]);
      p.set(sx, 6, WOOD[3]);
      p.rect(sx - 1, 13, sx + 2, 13, alpha(WATER[4], 0.6));
    }
  }
  if (spring) {
    // Пузыри источника.
    for (let k = 0; k < 4; k++) {
      const bx = Math.floor(2 + hash(X0, Y0, 100 + k) * 12);
      const by = Math.floor(3 + hash(X0, Y0, 110 + k) * 11);
      p.set(bx, by, R[4]);
      p.set(bx + 1, by, alpha(R[3], 0.7));
    }
  }
}

/**
 * Полынья — дыра во льду, а не квадрат с рамкой: углы у сухих сторон
 * скруглены, край рваный, снаружи — шуга и битый лёд (по ней тоже не
 * пройти: клетка целиком глубокая, поэтому снаружи не гладкий лёд, а
 * каша), под верхней кромкой — толща льдины.
 */
function holeShape(p: Px, c: CellCtx, X0: number, Y0: number): void {
  const dryU = !wetAt(c, 0, -1);
  const dryD = !wetAt(c, 0, 1);
  const dryL = !wetAt(c, -1, 0);
  const dryR = !wetAt(c, 1, 0);
  const RC = 7;
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const Y = Y0 + y;
      const du = dryU ? y : 99;
      const dd = dryD ? 15 - y : 99;
      const dl = dryL ? x : 99;
      const dr = dryR ? 15 - x : 99;
      const dx = Math.min(dl, dr);
      const dy = Math.min(du, dd);
      // Скругление только там, где сухие обе стороны угла.
      const dist =
        dx < RC && dy < RC ? RC - Math.hypot(RC - dx - 0.5, RC - dy - 0.5) : Math.min(dx, dy) + 0.5;
      // Рваный край: шум по миру, чтобы соседние полыньи не повторялись.
      const ins = 1.2 + at(noise().fine, X * 2, Y * 2) * 2.2;
      if (dist < ins) {
        // Шуга: серо-голубая каша с белыми крошками.
        const h = hash(X, Y, 71);
        p.set(x, y, h < 0.18 ? SNOW[4] : h < 0.5 ? ICE[2] : h < 0.8 ? ICE[1] : SNOW[2]);
      } else if (dist < ins + 1) {
        p.set(x, y, dy <= dx && dryU && du <= dd ? ICE[4] : WHITE);
      } else if (dryU && du <= dd && dy <= dx && dist < ins + 3.5) {
        // Толща льдины под верхней кромкой.
        p.set(x, y, dist < ins + 2.2 ? ICE[2] : ICE[1]);
      }
    }
}

function bridgePx(p: Px, c: CellCtx): void {
  // Мост лебёдки: доски поперёк, канаты по краям.
  waterPx(p, c, MK.bridge0);
  for (let y = 0; y < TS; y++) {
    const plank = Math.floor((c.wy * TS + y) / 4);
    const tone = 0.45 + hash(plank, c.wx, 121) * 0.3;
    for (let x = 1; x < 15; x++) {
      const X = c.wx * TS + x;
      const Y = c.wy * TS + y;
      let col = toneOf(WOOD, tone + (hash(X, plank, 122) - 0.5) * 0.18, X, Y);
      if ((Y & 3) === 3) col = WOOD[0];
      if ((Y & 3) === 0 && hash(plank, 1, 123) < 0.5 && x < 4) col = SNOW[3];
      p.set(x, y, col);
    }
    p.set(0, y, (c.wy * TS + y) % 6 < 3 ? BONE[1] : BONE[0]);
    p.set(15, y, (c.wy * TS + y) % 6 < 3 ? BONE[1] : BONE[0]);
  }
}

function meltPx(p: Px, c: CellCtx): void {
  // Талое место: мокрый лёд, лужица, капли.
  icePx(p, c, 'grotto', 'ice');
  const X0 = c.wx * TS;
  const Y0 = c.wy * TS;
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const d = Math.hypot(x - 7.5 + (hash(X0, Y0, 131) - 0.5) * 4, (y - 8) * 1.4);
      if (d < 5.5) p.set(x, y, d < 4.6 ? toneOf(WATER, 0.6 + (5 - d) * 0.04, x, y) : ICE[4]);
    }
}

// ---- Стены ----------------------------------------------------------------

/** Лицо стены (клетка под ней открыта): порода, снежная шапка, иней. */
function wallFacePx(c: CellCtx, look: Look): Px {
  const p = new Px(TS, TS);
  const N = noise();
  const X0 = c.wx * TS;
  const Y0 = c.wy * TS;
  const mk = c.mark;
  const iceFace = mk === MK.iceWall || mk === MK.meltWall || mk === MK.iceGate || mk === MK.glacier;
  const R = iceFace ? ICE : ROCK;
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const Y = Y0 + y;
      // Пласты породы: косые слои + шум.
      const layer = Math.sin((Y + at(N.big, X, 0) * 18) * 0.55) * 0.5 + 0.5;
      let k = 0.34 + layer * 0.22 + (at(N.fine, X, Y) - 0.5) * 0.3;
      // Свет сверху: лицо темнеет книзу (к полу).
      k -= (y / 15) * 0.18;
      if (iceFace) k = 0.45 + (at(N.streak, X, Y) - 0.5) * 0.6 - (y / 15) * 0.15;
      p.set(x, y, toneOf(R, k, X, Y));
      // Вертикальные трещины породы.
      if (!iceFace && hash(X >> 2, 0, 141) < 0.18 && (X & 3) === 1 && y > 3) p.set(x, y, R[0]);
    }
  // Снежная шапка по верхнему краю (рваная).
  if (mk !== MK.glacier)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const n = 2 + Math.round(at(N.fine, X, Y0) * 3);
      for (let y = 0; y < n; y++) p.set(x, y, y === n - 1 ? SNOW[1] : y === 0 ? SNOW[4] : SNOW[3]);
    }
  // Иней у подножия.
  for (let x = 0; x < TS; x++)
    if (hash(X0 + x, Y0 + 15, 142) < 0.45) p.set(x, 15, alpha(SNOW[2], 0.8));
  switch (mk) {
    case MK.crystalWall: {
      // Друза бирюзовых кристаллов растёт из лица.
      for (let k = 0; k < 4; k++) {
        const bx = 2 + hash(X0, Y0, 150 + k) * 12;
        const by = 15;
        const hgt = 5 + hash(X0, Y0, 160 + k) * 8;
        const lean = (hash(X0, Y0, 170 + k) - 0.5) * 0.7;
        crystal(p, bx, by, hgt, 1.6 + hash(X0, Y0, 180 + k), lean, TEAL);
      }
      break;
    }
    case MK.window: {
      // Окно сияния: прозрачный лёд, за ним зелёная лента.
      for (let y = 3; y < 15; y++)
        for (let x = 2; x < 14; x++) {
          const band = Math.sin(x * 0.5 + c.wx * 8) * 2 + 9;
          const dist = Math.abs(y - band);
          const col = dist < 1.5 ? AURORA[3] : dist < 3 ? AURORA[2] : dist < 5 ? AURORA[1] : ICE[0];
          p.set(x, y, col);
        }
      p.rect(1, 2, 14, 2, ICE[4]);
      p.rect(1, 2, 1, 15, ICE[3]);
      p.rect(14, 2, 14, 15, ICE[1]);
      for (let y = 3; y < 15; y += 3) p.set(3 + (y % 5), y, alpha(WHITE, 0.7));
      break;
    }
    case MK.banner: {
      // Знамя из шкуры с охряным знаком мамонта.
      p.rect(3, 1, 12, 1, WOOD[2]);
      for (let y = 2; y < 15; y++) {
        const w = y > 12 ? 12 - y : 0;
        for (let x = 4 - w * 0; x <= 11; x++) {
          if (y > 12 && (x + y) % 3 === 0) continue;
          p.set(x, y, toneOf(FUR, 0.55 - (x === 4 || x === 11 ? 0.2 : 0) - y * 0.01, x, y));
        }
      }
      // Знак: бивни дугой и глаз.
      for (let a = 0; a < 10; a++) {
        const t = a / 9;
        p.set(5 + t * 2, 6 + Math.sin(t * Math.PI) * 4, OCHRE[3]);
        p.set(10 - t * 2, 6 + Math.sin(t * Math.PI) * 4, OCHRE[3]);
      }
      p.set(7, 7, BONE[4]);
      p.set(8, 7, BONE[4]);
      break;
    }
    case MK.gateSide: {
      // Столбы затвора: тёсаный лёд с кольцами.
      for (let y = 0; y < TS; y++)
        for (let x = 4; x < 12; x++) p.set(x, y, toneOf(ICE, 0.35 + (11 - x) * 0.05, x, y));
      for (const y of [4, 10]) p.rect(4, y, 11, y, BONE[2]);
      break;
    }
    case MK.meltWall: {
      // Тает: подтёки, капли, лужа у подножия.
      for (let k = 0; k < 5; k++) {
        const x = Math.floor(1 + hash(X0, Y0, 190 + k) * 14);
        const len = 4 + Math.floor(hash(X0, Y0, 200 + k) * 9);
        for (let y = 3; y < 3 + len && y < 16; y++) p.set(x, y, alpha(ICE[4], 0.75));
      }
      p.rect(0, 14, 15, 15, toneOf(WATER, 0.6, 0, 0));
      break;
    }
    case MK.icicles: {
      // Сосульки с кромки.
      for (let x = 0; x < TS; x += 2) {
        const len = 2 + Math.floor(hash(X0 + x, Y0, 210) * 7);
        for (let y = 2; y < 2 + len; y++) {
          p.set(x, y, y === 2 + len - 1 ? ICE[4] : ICE[3]);
          if (y < 2 + len - 2) p.set(x + 1, y, ICE[1]);
        }
      }
      break;
    }
    case MK.glacier: {
      // Стена ледника: голубой лёд с прожилками и снегом поверху.
      for (let y = 0; y < TS; y++)
        for (let x = 0; x < TS; x++) {
          const X = X0 + x;
          const Y = Y0 + y;
          const k = 0.55 + (at(N.streak, X, Y) - 0.5) * 0.7 - (y / 15) * 0.2;
          p.set(x, y, toneOf(ICE, k, X, Y));
        }
      for (let x = 0; x < TS; x++) {
        p.set(x, 0, WHITE);
        p.set(x, 1, SNOW[3]);
        if (hash(X0 + x, Y0, 220) < 0.3) p.set(x, 2, SNOW[2]);
      }
      crackLines(p, X0, Y0, 0.6, false);
      break;
    }
  }
  if (look === 'grotto' && mk === 0 && hash(c.wx, c.wy, 230) < 0.18) {
    // В гроте — редкие кристаллы и на простой стене.
    crystal(p, 4 + hash(c.wx, c.wy, 231) * 8, 15, 4 + hash(c.wx, c.wy, 232) * 4, 1.3, -0.2, TEAL);
  }
  return p;
}

/**
 * Лицо ледника (анимации 12): живой лёд — грани-призмы со светом слева и
 * тенью справа (счёт от мира, швов на стыке клеток нет), пузырьки воздуха,
 * бирюзовая жила в толще, снежная шапка с наплывами сверху, иней у подножия.
 */
function glacierFacePx(c: CellCtx): Px {
  const p = new Px(TS, TS);
  const N = noise();
  const X0 = c.wx * TS;
  const Y0 = c.wy * TS;
  const capped = c.markAt(0, -1) !== MK.glacier;
  for (let x = 0; x < TS; x++) {
    const X = X0 + x;
    // Грань: столбцы шириной 5 со сдвигом по шуму — призмы.
    const fx = X + Math.floor(at(N.big, X, 7) * 4);
    const col = Math.floor(fx / 5);
    const pos = ((fx % 5) + 5) % 5;
    const facet = (hash(col, 0, 300) - 0.5) * 0.16;
    const vein = hash(col, 1, 300) < 0.22;
    for (let y = 0; y < TS; y++) {
      const Y = Y0 + y;
      let k = 0.6 - (y / 15) * 0.26 + (at(N.streak, X, Y) - 0.5) * 0.22 + facet;
      if (pos === 0) k += 0.24;
      else if (pos === 1) k += 0.08;
      else if (pos === 4) k -= 0.2;
      p.set(x, y, toneOf(ICE, k, X, Y));
      if (vein && pos === 2 && y > 3 && y < 14) p.set(x, y, alpha(TEAL[3], 0.4));
    }
  }
  // Пузырьки воздуха: кольцо и блик слева сверху.
  for (let q = 0; q < 3; q++) {
    if (hash(X0, Y0, 310 + q) > 0.55) continue;
    const bx = 2 + Math.floor(hash(X0, Y0, 320 + q) * 11);
    const by = 5 + Math.floor(hash(X0, Y0, 330 + q) * 8);
    const big = hash(X0, Y0, 340 + q) < 0.4;
    p.set(bx, by, alpha(ICE[4], 0.75));
    if (big) {
      p.set(bx + 1, by, alpha(ICE[3], 0.7));
      p.set(bx, by + 1, alpha(ICE[3], 0.7));
      p.set(bx + 1, by + 1, alpha(ICE[2], 0.6));
    }
    p.set(bx, by, alpha(WHITE, 0.85));
  }
  crackLines(p, X0, Y0, 0.35, false);
  // Снежная шапка с наплывами (если сверху не тот же ледник).
  if (capped)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const n = 2 + Math.round(at(N.fine, X, Y0) * 2);
      const drip = hash(X, Y0, 350) < 0.18 ? 1 + Math.floor(hash(X, Y0, 351) * 2) : 0;
      for (let y = 0; y < n + drip; y++)
        p.set(x, y, y === 0 ? WHITE : y < n - 1 ? SNOW[4] : SNOW[3]);
      p.set(x, n + drip, alpha(ICE[0], 0.55));
    }
  else for (let x = 0; x < TS; x++) p.set(x, 0, alpha(ICE[4], 0.6));
  // Подножие: тень и иней.
  for (let x = 0; x < TS; x++) {
    p.set(x, 14, alpha(ICE[0], 0.35));
    if (hash(X0 + x, Y0 + 15, 142) < 0.55) p.set(x, 15, alpha(SNOW[3], 0.85));
  }
  return p;
}

/**
 * Верх ледника (стена над стеной, анимации 12): снег, сдутый ветром до
 * голубого льда пятнами, заструги; открытые края — светлая кромка с
 * севера и запада, тень с востока.
 */
function glacierTopPx(c: CellCtx): Px {
  const p = new Px(TS, TS);
  const N = noise();
  const X0 = c.wx * TS;
  const Y0 = c.wy * TS;
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const Y = Y0 + y;
      const ice = at(N.big, X, Y) > 0.6;
      if (ice) p.set(x, y, toneOf(ICE, 0.66 + (at(N.fbm, X, Y) - 0.5) * 0.4, X, Y));
      else {
        p.set(x, y, toneOf(SNOW, 0.8 + (at(N.fbm, X, Y) - 0.5) * 0.3, X, Y));
        // Заструги: косые гребни — тень и свет рядом.
        const s = (X + Y * 2 + Math.floor(at(N.big, X, Y) * 9)) % 11;
        if (s === 0) p.set(x, y, SNOW[2]);
        else if (s === 1) p.set(x, y, SNOW[4]);
      }
    }
  if (c.open(0, -1))
    for (let x = 0; x < TS; x++) {
      p.set(x, 0, WHITE);
      p.set(x, 1, SNOW[4]);
    }
  if (c.open(-1, 0)) for (let y = 0; y < TS; y++) p.set(0, y, SNOW[4]);
  if (c.open(1, 0)) for (let y = 0; y < TS; y++) p.set(15, y, ICE[1]);
  return p;
}

/** Кристалл: шестигранная игла от основания (bx, by) вверх. */
function crystal(
  p: Px,
  bx: number,
  by: number,
  h: number,
  w: number,
  lean: number,
  R: RGBA[],
): void {
  for (let i = 0; i <= h; i++) {
    const t = i / h;
    const cx = bx + lean * i;
    const ww = t > 0.75 ? w * (1 - (t - 0.75) / 0.25) : w;
    for (let dx = -Math.ceil(ww); dx <= Math.ceil(ww); dx++) {
      if (Math.abs(dx) > ww + 0.2) continue;
      const col = dx < 0 ? R[3] : dx === 0 ? R[4] : R[1];
      p.set(cx + dx, by - i, col);
    }
  }
  p.set(bx + lean * h, by - h, WHITE);
}

// ---- Снег и лёд вперемешку: край по шуму, а не по клеткам ----------------

/** Доля «снега» вида клетки; null — не поверхность (камень, вода, стена). */
function snowness(mk: number): number | null {
  if (mk === MK.snow || mk === MK.drift || mk === MK.foxDrift) return 1;
  if (mk === MK.ice || mk === MK.grit || mk === MK.polish || mk === MK.postIce || mk === MK.postWar)
    return 0;
  return null;
}
const driftness = (mk: number): number | null =>
  mk === MK.drift || mk === MK.foxDrift ? 1 : mk === MK.snow ? 0 : null;

/** Билинейная смесь значения по соседям (у края клетки — 50 на 50). */
function blendAt(c: CellCtx, x: number, y: number, f: (mk: number) => number | null): number {
  const own = f(c.mark) ?? 0;
  const u = (x + 0.5) / TS - 0.5;
  const v = (y + 0.5) / TS - 0.5;
  const sx = u < 0 ? -1 : 1;
  const sy = v < 0 ? -1 : 1;
  const val = (dx: number, dy: number) => (c.open(dx, dy) ? (f(c.markAt(dx, dy)) ?? own) : own);
  const ax = Math.abs(u);
  const ay = Math.abs(v);
  const top = own * (1 - ax) + val(sx, 0) * ax;
  const bot = val(0, sy) * (1 - ax) + val(sx, sy) * ax;
  return top * (1 - ay) + bot * ay;
}

/** Пол из снега и льда: каждый пиксель решает сам, снег он или лёд. */
function surfacePx(p: Px, c: CellCtx, look: Look): void {
  const N = noise();
  const X0 = c.wx * TS;
  const Y0 = c.wy * TS;
  const own = c.mark;
  const ownIce = snowness(own) === 0;
  const iceKind =
    own === MK.grit
      ? 'grit'
      : own === MK.polish
        ? 'polish'
        : own === MK.postIce || own === MK.postWar
          ? 'post'
          : 'ice';
  // Снег у плит чертога: под рыхлым краем — те же плиты, а не простой лёд.
  let nearPolish = false;
  for (const [dx, dy] of [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ])
    if (c.open(dx, dy) && c.markAt(dx, dy) === MK.polish) nearPolish = true;
  // Сначала оба слоя целиком, потом выбор по пикселю.
  const ice = new Px(TS, TS);
  icePx(ice, c, look, ownIce ? iceKind : nearPolish ? 'polish' : 'ice');
  const snow = new Px(TS, TS);
  snowPx(snow, c, look, false);
  const drift = new Px(TS, TS);
  snowPx(drift, c, look, true);
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const Y = Y0 + y;
      const n = (at(N.fine, X + 7, Y + 3) - 0.5) * 0.55;
      const s = blendAt(c, x, y, snowness) + n;
      let col: RGBA;
      if (s > 0.5) {
        const d = blendAt(c, x, y, driftness) + n * 0.8;
        col = d > 0.5 ? drift.get(x, y) : snow.get(x, y);
        // Край снега на льду: тонкая светлая кромка.
        if (s < 0.58) col = mixc(col, SNOW[4], 0.35);
      } else {
        col = ice.get(x, y);
        // Позёмка у края снега.
        if (s > 0.4 && hash(X, Y, 301) < 0.3) col = mixc(col, SNOW[2], 0.5);
      }
      p.set(x, y, col);
    }
}

function cellPainter(area: string) {
  const look = LOOK[area] ?? 'grotto';
  return (c: CellCtx): Px | null => {
    const mk = c.mark;
    if (!c.open(0, 0)) {
      // Стена: лицо — если под ней открыто; верх — порода движка.
      if (mk === MK.glacier) return c.open(0, 1) ? glacierFacePx(c) : glacierTopPx(c);
      if (c.open(0, 1)) return wallFacePx(c, look);
      return null;
    }
    if (WETS.has(mk)) {
      const p = new Px(TS, TS);
      waterPx(p, c, mk);
      return p;
    }
    const p = new Px(TS, TS);
    if (snowness(mk) !== null) {
      surfacePx(p, c, look);
      return p;
    }
    switch (mk) {
      case MK.thin:
        icePx(p, c, look, 'thin');
        break;
      case MK.grit:
        icePx(p, c, look, 'grit');
        break;
      case MK.polish:
        icePx(p, c, look, 'polish');
        break;
      case MK.postIce:
      case MK.postWar:
        icePx(p, c, look, 'post');
        break;
      case MK.arena:
        arenaPx(p, c, area);
        break;
      case MK.rug:
        rugPx(p, c);
        break;
      case MK.stone:
        stonePx(p, c, false);
        break;
      case MK.warm:
        stonePx(p, c, true);
        break;
      case MK.bridge:
        bridgePx(p, c);
        break;
      case MK.melt:
        meltPx(p, c);
        break;
      case MK.drift:
      case MK.foxDrift:
        snowPx(p, c, look, true);
        break;
      default:
        snowPx(p, c, look, false);
    }
    return p;
  };
}

registerCellPainter(F12_GROTTO, cellPainter(F12_GROTTO));
registerCellPainter(F12_LAKE, cellPainter(F12_LAKE));
registerCellPainter(F12_SHRINE, cellPainter(F12_SHRINE));

// ---------------------------------------------------------------------------
// Предметы. Кадры живых — по времени, в кеше по ключу.
// ---------------------------------------------------------------------------

const PROPS = new Map<string, Sprite>();
function spr(key: string, make: () => [Px, number, number]): Sprite {
  let s = PROPS.get(key);
  if (!s) {
    const [p, ax, ay] = make();
    s = { img: p.canvas(), ax, ay };
    PROPS.set(key, s);
  }
  return s;
}
const flashed = (p: Px, f: boolean) => (f ? p.tint(WHITE, 0.75) : p);

/** Вертикальный цилиндр: тон по x (свет слева), торцы — эллипсы. */
function cyl(p: Px, cx: number, y0: number, y1: number, r: number, R: RGBA[], ry = r * 0.4): void {
  for (let y = Math.round(y0); y <= Math.round(y1); y++)
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const u = (x + 0.5 - cx) / r;
      if (Math.abs(u) > 1) continue;
      const k = 0.62 - u * 0.32 - Math.abs(u) ** 3 * 0.25;
      p.set(x, y, toneOf(R, k, x, y));
    }
  p.ell(cx, y0, r, ry, (x, y) => toneOf(R, 0.8 - ((x + 0.5 - cx) / r) * 0.15, x, y));
}

/** Ящик в три четверти: верх, лицо, бок. */
function boxPx(p: Px, x0: number, y0: number, w: number, h: number, d: number, R: RGBA[]): void {
  // Верх.
  p.rect(x0, y0, x0 + w - 1, y0 + d - 1, R[3]);
  // Лицо.
  p.rect(x0, y0 + d, x0 + w - 1, y0 + d + h - 1, R[2]);
  // Тень справа на лице.
  p.rect(x0 + w - 2, y0 + d, x0 + w - 1, y0 + d + h - 1, R[1]);
  p.rect(x0, y0 + d, x0 + w - 1, y0 + d, R[4]);
}

/** Язык пламени: высота h, кадр f (0…7). */
function flame(p: Px, cx: number, by: number, h: number, w: number, f: number, cold = false): void {
  const R = cold ? TEAL : FIRE;
  for (let y = 0; y < h; y++) {
    const t = y / h;
    const sway = Math.sin(f * 0.8 + t * 5) * t * 1.2;
    const ww = w * (1 - t) ** 0.8 * (0.85 + Math.sin(f * 1.7 + y) * 0.15);
    for (let x = Math.floor(cx - ww); x <= Math.ceil(cx + ww); x++) {
      const u = Math.abs(x + 0.5 - cx - sway) / Math.max(0.6, ww);
      if (u > 1) continue;
      const k = 1 - u * 0.55 - t * 0.55;
      p.set(x, by - y, toneOf(R, k, x, y));
    }
  }
  // Искра.
  const sy = by - h - ((f * 3) % 6);
  p.set(cx + Math.sin(f * 2.3) * 2, sy, R[4]);
}

const fr8 = (time: number, fps = 10) => Math.floor(time * fps) % 8;

registerPropPainter('f12_torch', (o, time) => {
  const sim = paintSim();
  const on = f12Torch(sim, o.id);
  const f = on ? fr8(time + (o.x * 0.37 + o.y * 0.11)) : 0;
  return spr(`torch|${on}|${f}`, () => {
    const p = new Px(10, 24);
    // Шест из кости и чаша с жиром.
    p.rect(4, 9, 5, 23, BONE[1]);
    p.rect(4, 9, 4, 23, BONE[2]);
    p.ell(5, 21.5, 3, 1.2, alpha(SNOW[1], 0.9));
    p.ell(5, 9, 3.2, 1.6, WOOD[1]);
    p.rect(2, 8, 7, 8, WOOD[3]);
    if (on) flame(p, 5, 7, 7, 2.2, f);
    else {
      // Погас: дымок и иней на чаше.
      p.set(4, 7, alpha(SNOW[3], 0.8));
      p.set(5, 5, alpha(SNOW[2], 0.5));
      p.rect(3, 8, 6, 8, SNOW[2]);
    }
    p.outline(INK);
    return [p, 5, 22];
  });
});

registerPropPainter('f12_brazier', (o, time) => {
  const sim = paintSim();
  const lit = f12Lit(sim, o.id);
  const f = lit ? fr8(time + o.x * 0.21) : Math.floor(time * 2) % 2;
  return spr(`brazier|${lit}|${f}`, () => {
    const p = new Px(18, 22);
    // Треножник и чаша из бронзы. Холодная — пепел под снежной шапкой и
    // сосульки по ободу («зажги меня»), без огоньков-«глаз».
    const BR = ramp('#2e1c10', '#5a3a20', '#8a5a2a', '#b07a3a', '#d8a860');
    for (const [a, b] of [
      [4, 21],
      [14, 21],
    ]) {
      p.line(9, 14, a, b, BR[1]);
      p.line(9, 15, a + (a < 9 ? 1 : -1), b, BR[0]);
      p.set(a, b, BR[3]);
    }
    p.line(9, 14, 9, 21, BR[2]);
    p.set(9, 21, BR[3]);
    p.ell(9, 12.6, 7.4, 3.6, BR[1]);
    p.ell(9, 13.8, 6.2, 2.2, BR[0]);
    p.ell(9, 11.6, 7, 2.4, BR[3]);
    p.ell(9, 11.6, 5.8, 1.7, lit ? FIRE[1] : hx('#2e2a30'));
    p.line(4, 11, 7, 10, BR[4]);
    if (lit) {
      flame(p, 7, 12, 8, 2.4, f);
      flame(p, 11, 12, 6, 2, (f + 3) % 8);
      p.set(6 + (f % 3), 11, FIRE[4]);
    } else {
      p.ell(9, 11.2, 4.6, 1.5, hx('#57535e'));
      p.ell(9, 10.6, 3.6, 1, SNOW[3]);
      p.set(8, 10, SNOW[4]);
      p.set(10, 10, WHITE);
      if (f) p.set(12, 11, FIRE[1]);
      for (const x of [4, 8, 12, 15]) {
        p.set(x, 14, ICE[3]);
        p.set(x, 15, ICE[2]);
      }
    }
    p.outline(INK);
    return [p, 9, 20];
  });
});

registerPropPainter('f12_hearth', (o, time) => {
  const f = fr8(time + o.y * 0.3, 9);
  return spr(`hearth|${f}`, () => {
    const p = new Px(22, 20);
    // Костёр в кольце камней.
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * TAU;
      const sx = 11 + Math.cos(a) * 8;
      const sy = 15 + Math.sin(a) * 3.6;
      p.ell(sx, sy, 2, 1.5, toneOf(STONE, 0.45 + Math.sin(a) * 0.15, k, 0));
      p.set(sx - 1, sy - 1, SNOW[2]);
    }
    p.ell(11, 15, 6, 2.4, hx('#1a1210'));
    p.line(6, 16, 15, 13, WOOD[2]);
    p.line(7, 13, 16, 16, WOOD[1]);
    flame(p, 10, 15, 11, 3.2, f);
    flame(p, 13, 15, 7, 2.2, (f + 4) % 8);
    p.outline(INK);
    return [p, 11, 17];
  });
});

registerPropPainter('f12_column', (o) =>
  spr(`column|${o.x % 3}`, () => {
    const p = new Px(16, 40);
    // Ледяная колонна: прозрачная, внутри — вмёрзшие пузыри.
    cyl(p, 8, 4, 36, 5.5, ICE, 2);
    p.rect(2, 34, 13, 37, SNOW[2]);
    p.ell(8, 37, 6.5, 2, SNOW[1]);
    p.rect(2, 2, 13, 4, SNOW[3]);
    p.ell(8, 2, 6.5, 1.6, SNOW[4]);
    for (let k = 0; k < 9; k++) {
      const by = 8 + hash(o.x, k, 401) * 24;
      const bx = 5 + hash(o.y, k, 402) * 6;
      p.set(bx, by, ICE[4]);
    }
    for (let y = 6; y < 34; y++) if ((y + o.x) % 7 < 4) p.set(5, y, alpha(WHITE, 0.6));
    p.outline(INK);
    return [p, 8, 37];
  }),
);

registerPropPainter('f12_gong', (o, time) => {
  const sim = paintSim();
  const st = f12State(sim);
  const cd = st?.gong.cd ?? 0;
  // Только что ударили — гонг дрожит и светится 2 с.
  const ring = cd > 9 ? Math.floor(time * 16) % 4 : -1;
  const ready = cd <= 0;
  return spr(`gong|${ring}|${ready}|${Math.floor(time * 2) % 2}`, () => {
    const p = new Px(28, 34);
    // Рама из бивней и бронзовый диск.
    p.line(3, 33, 5, 6, BONE[2]);
    p.line(4, 33, 6, 6, BONE[1]);
    p.line(24, 33, 22, 6, BONE[1]);
    p.line(23, 33, 21, 6, BONE[0]);
    for (let x = 4; x <= 23; x++)
      p.set(x, 5 + Math.round(Math.sin(((x - 4) / 19) * Math.PI) * -2), BONE[3]);
    const dx = ring >= 0 ? [0, 1, 0, -1][ring] : 0;
    const cx = 14 + dx;
    p.ell(cx, 17, 8, 8, (x, y) => {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - 17) / 8;
      const l = 0.55 + ((cx - x) / 8) * 0.25 + (17 - y) * 0.015;
      return toneOf(
        ramp('#3a2408', '#6e4614', '#a8701e', '#d8a03a', '#ffe08a'),
        d > 0.85 ? 0.3 : l,
        x,
        y,
      );
    });
    p.ell(cx, 17, 3, 3, hx('#8a5a18'));
    p.ell(cx - 1, 16, 1.4, 1.4, hx('#ffe08a'));
    for (let a = 0; a < 12; a++) {
      const t = (a / 12) * TAU;
      p.set(cx + Math.cos(t) * 5.6, 17 + Math.sin(t) * 5.6, hx('#5a3a10'));
    }
    p.line(cx, 6, cx, 9, BONE[1]);
    if (ring >= 0) {
      // Волна по диску.
      const r = 2 + ring * 1.6;
      for (let a = 0; a < 24; a++) {
        const t = (a / 24) * TAU;
        p.set(cx + Math.cos(t) * r, 17 + Math.sin(t) * r, TEAL[4]);
      }
    } else if (ready && Math.floor(time * 2) % 2) p.set(cx + 3, 13, WHITE);
    p.outline(INK);
    return [p, 14, 32];
  });
});

registerPropPainter('f12_barrel', (_o, _t, _alive, flash) =>
  spr(`barrel|${flash}`, () => {
    const p = new Px(14, 16);
    cyl(p, 7, 3, 14, 5.5, WOOD, 1.8);
    for (const y of [5, 11]) for (let x = 2; x <= 12; x++) p.set(x, y, hx('#4a4e5a'));
    p.ell(7, 3, 5.5, 1.8, SNOW[3]);
    p.set(5, 2, WHITE);
    p.outline(INK);
    return [flashed(p, flash), 7, 14];
  }),
);

registerPropPainter('f12_crate', (_o, _t, _alive, flash) =>
  spr(`crate|${flash}`, () => {
    const p = new Px(16, 16);
    boxPx(p, 1, 2, 14, 10, 4, WOOD);
    p.line(2, 7, 13, 14, WOOD[1]);
    p.line(2, 14, 13, 7, WOOD[1]);
    p.rect(1, 2, 14, 3, SNOW[3]);
    p.set(3, 2, WHITE);
    p.outline(INK);
    return [flashed(p, flash), 8, 15];
  }),
);

registerPropPainter('f12_statue', (o) =>
  spr(`statue|${o.x & 1}`, () => {
    // Ледяная статуя воина с копьём: прозрачная, на постаменте.
    const parts: Part[] = [
      { x: 0, y: 0, z: 3, rx: 7, ry: 7, rz: 3, ramp: SNOW },
      { x: 0, y: 0, z: 13, rx: 4.2, ry: 5.2, rz: 7, ramp: ICE, gloss: true },
      { x: 0, y: 0, z: 23, rx: 3, ry: 3, rz: 3.2, ramp: ICE, gloss: true },
      { x: 0, y: -5, z: 14, rx: 1.6, ry: 1.6, rz: 5, ramp: ICE },
      { x: 0, y: 5, z: 15, rx: 1.6, ry: 1.6, rz: 5, ramp: ICE },
      { x: 1, y: 0, z: 25, rx: 3.4, ry: 3.4, rz: 1.6, ramp: ICE, gloss: true },
    ];
    for (let k = 0; k < 8; k++)
      parts.push({ x: 0, y: 6.5, z: 6 + k * 3.2, rx: 0.8, ry: 0.8, rz: 1.8, ramp: BONE });
    const out = renderRig(parts, Math.PI / 2 + (o.x & 1 ? 0.5 : -0.5), 26, 40, 13, 34);
    return [out.p, 13, 34];
  }),
);

registerPropPainter('f12_crystals', (o, time) => {
  const f = Math.floor(time * 3 + o.x) % 6;
  return spr(`crystals|${o.x % 4}|${f}`, () => {
    const p = new Px(18, 22);
    p.ell(9, 19, 7, 2.4, ROCK[2]);
    const seeds = [
      [9, 19, 14, 2.2, 0],
      [5, 19, 9, 1.6, -0.25],
      [13, 19, 10, 1.7, 0.22],
      [7, 20, 6, 1.3, -0.4],
      [12, 20, 5, 1.2, 0.5],
    ];
    seeds.forEach(([x, y, h, w, l], k) =>
      crystal(
        p,
        x + (hash(o.x, k, 410) - 0.5),
        y,
        h * (0.85 + hash(o.y, k, 411) * 0.3),
        w,
        l,
        TEAL,
      ),
    );
    // Искра бежит по граням.
    if (f < 3) p.set(9 + f, 6 + f * 2, WHITE);
    p.outline(INK);
    return [p, 9, 19];
  });
});

registerPropPainter('f12_icechunk', (o, _t, _alive, flash) =>
  spr(`chunk|${o.x % 3}|${flash}`, () => {
    // Глыба: многогранник из трёх эллипсоидов, внутри — синий кристалл.
    const parts: Part[] = [
      { x: 0, y: 0, z: 5, rx: 7, ry: 6, rz: 5.5, ramp: ICE, gloss: true, yaw: 0.4 },
      { x: 2, y: -3, z: 9, rx: 4, ry: 4, rz: 4.5, ramp: ICE, gloss: true, yaw: -0.3 },
      { x: -3, y: 3, z: 4, rx: 4, ry: 3.5, rz: 3.5, ramp: ICE, yaw: 0.9 },
    ];
    const out = renderRig(parts, (o.x % 3) * 0.9, 20, 20, 10, 15);
    const p = out.p;
    p.set(9, 8, TEAL[4]);
    p.set(10, 9, TEAL[3]);
    p.set(8, 10, TEAL[2]);
    return [flashed(p, flash), 10, 15];
  }),
);

registerPropPainter('f12_icegate', (o) => {
  const sim = paintSim();
  const n = f12Gate(sim, o.id);
  return spr(`gate|${n}`, () => {
    const p = new Px(16, 30);
    if (n >= 3) {
      // Разбит: груда осколков на пороге.
      for (let k = 0; k < 9; k++) {
        const x = 2 + hash(o.x, k, 420) * 12;
        const y = 24 + hash(o.y, k, 421) * 4;
        p.ell(x, y, 1.6, 1, k % 2 ? ICE[3] : ICE[2]);
        p.set(x - 1, y - 1, ICE[4]);
      }
      return [p, 8, 28];
    }
    // Затвор: плита голубого льда в раме, видно, что её можно разбить.
    for (let y = 2; y < 28; y++)
      for (let x = 1; x < 15; x++) {
        const k = 0.55 + (at(noise().streak, x * 3, y * 2) - 0.5) * 0.6 - y * 0.008;
        p.set(x, y, toneOf(ICE, k, x, y));
      }
    p.rect(0, 0, 15, 2, BONE[2]);
    p.rect(0, 0, 15, 0, BONE[3]);
    // Цепь «разбей меня»: три кольца.
    for (const x of [4, 8, 12]) p.ell(x, 5, 1.2, 1.2, hx('#5a5e6a'));
    // Трещины по числу ударов.
    if (n >= 1) {
      p.line(8, 10, 4, 18, WHITE);
      p.line(8, 10, 12, 15, WHITE);
      p.line(4, 18, 3, 24, ICE[4]);
    }
    if (n >= 2) {
      p.line(12, 15, 13, 25, WHITE);
      p.line(8, 10, 9, 26, ICE[4]);
      p.line(4, 18, 9, 21, WHITE);
      p.line(2, 8, 7, 13, ICE[4]);
    }
    p.outline(INK);
    return [p, 8, 28];
  });
});

registerPropPainter('f12_stalag', (o, time) => {
  const f = Math.floor(time * 1.5 + o.x * 0.7) % 4;
  return spr(`stalag|${o.x % 3}|${f}`, () => {
    const p = new Px(14, 24);
    const h = 18 + (o.x % 3) * 2;
    for (let y = 0; y < h; y++) {
      const t = y / h;
      const w = 5 * (1 - t) ** 1.2 + 0.5;
      for (let x = Math.floor(7 - w); x <= Math.ceil(7 + w); x++) {
        const u = (x + 0.5 - 7) / w;
        if (Math.abs(u) > 1) continue;
        p.set(x, 22 - y, toneOf(ICE, 0.6 - u * 0.3 + t * 0.15, x, y));
      }
    }
    p.ell(7, 22, 6, 1.6, SNOW[2]);
    // Капля стекает и блестит.
    p.set(6, 22 - h + 2 + f * 3, WHITE);
    p.outline(INK);
    return [p, 7, 22];
  });
});

registerPropPainter('f12_sled', (_o, _t, _alive, flash) =>
  spr(`sled|${flash}`, () => {
    const p = new Px(24, 14);
    // Полозья, загнутые спереди, и поклажа под шкурой.
    p.line(1, 12, 21, 12, BONE[2]);
    p.line(21, 12, 23, 9, BONE[2]);
    p.line(1, 10, 20, 10, WOOD[1]);
    for (const x of [4, 10, 16]) p.line(x, 10, x, 12, WOOD[2]);
    p.ell(11, 7, 8, 3.4, (x, y) => toneOf(FUR, 0.6 - (y - 4) * 0.06, x, y));
    p.line(4, 6, 18, 8, OCHRE[2]);
    p.rect(5, 4, 15, 4, SNOW[3]);
    p.outline(INK);
    return [flashed(p, flash), 12, 12];
  }),
);

registerPropPainter('f12_runestone', (o, time) => {
  const f = Math.floor(time * 2 + o.x) % 6;
  return spr(`rune|${f}`, () => {
    const p = new Px(16, 26);
    for (let y = 3; y < 24; y++)
      for (let x = 2; x < 14; x++) {
        const top = 3 + Math.abs(x - 7.5) ** 2 * 0.12;
        if (y < top) continue;
        p.set(x, y, toneOf(STONE, 0.6 - (x - 2) * 0.03 + (hash(x, y, 430) - 0.5) * 0.15, x, y));
      }
    p.rect(2, 3, 13, 4, SNOW[3]);
    // Руны светятся по очереди.
    const glyphs = [
      [5, 8, 5, 12],
      [5, 10, 8, 8],
      [10, 8, 10, 13],
      [8, 15, 11, 17],
      [5, 18, 5, 21],
      [5, 20, 9, 18],
    ];
    glyphs.forEach(([a, b, c, d], k) => p.line(a, b, c, d, k === f ? AURORA[4] : AURORA[1]));
    p.ell(8, 24, 7, 1.8, SNOW[1]);
    p.outline(INK);
    return [p, 8, 24];
  });
});

registerPropPainter('f12_tent', (o, time) => {
  const f = Math.floor(time * 3 + o.x) % 4;
  return spr(`tent|${f}`, () => {
    // Чум: конус из шкур на шестах, вход с тёплым светом.
    const p = new Px(32, 32);
    for (let y = 4; y < 29; y++) {
      const t = (y - 4) / 25;
      const w = 2 + t * 13;
      for (let x = Math.floor(16 - w); x <= Math.ceil(16 + w); x++) {
        const u = (x + 0.5 - 16) / w;
        if (Math.abs(u) > 1) continue;
        let col = toneOf(FUR, 0.66 - u * 0.3 - (Math.floor(y / 5) % 2) * 0.06, x, y);
        if (Math.abs(u) < 0.25 && y > 18) col = toneOf(FIRE, 0.45 + (f === 1 ? 0.1 : 0), x, y);
        p.set(x, y, col);
      }
    }
    // Шесты над верхом.
    p.line(14, 4, 11, 0, WOOD[3]);
    p.line(17, 4, 20, 0, WOOD[2]);
    p.line(16, 4, 16, 1, WOOD[1]);
    // Полог шевелится.
    const fl = f % 2;
    p.line(13 - fl, 19, 16, 28, FUR[1]);
    p.rect(1, 28, 30, 29, SNOW[2]);
    for (let x = 6; x < 26; x += 3) p.set(x, 27, SNOW[3]);
    p.set(12, 10, OCHRE[3]);
    p.set(20, 10, OCHRE[3]);
    p.line(10, 14, 22, 14, OCHRE[2]);
    p.outline(INK);
    void o;
    return [p, 16, 28];
  });
});

registerPropPainter('f12_boat', () =>
  spr('boat', () => {
    // Лодка из шкур на каркасе, вмёрзла в лёд.
    const p = new Px(30, 16);
    for (let x = 1; x < 29; x++) {
      const t = (x - 1) / 27;
      const top = 6 - Math.sin(t * Math.PI) * 1.5 + (t < 0.1 || t > 0.9 ? -2 : 0);
      const bot = 9 + Math.sin(t * Math.PI) * 3;
      for (let y = Math.round(top); y < bot; y++)
        p.set(x, y, toneOf(FUR, 0.6 - (y - top) * 0.06, x, y));
      p.set(x, Math.round(top), BONE[2]);
    }
    p.ell(15, 7, 10, 1.5, FUR[0]);
    for (let x = 6; x < 26; x += 5) p.line(x, 6, x, 10, BONE[1]);
    p.ell(15, 13, 14, 2.4, alpha(ICE[3], 0.85));
    p.rect(9, 5, 13, 5, SNOW[3]);
    p.outline(INK);
    return [p, 15, 13];
  }),
);

registerPropPainter('f12_winch', (o, time) => {
  const sim = paintSim();
  const step = f12Winch(sim);
  const st = f12State(sim);
  const turning = (st?.winch.cd ?? 0) > 0;
  const f = turning ? Math.floor(time * 12) % 4 : 0;
  return spr(`winch|${step}|${f}`, () => {
    const p = new Px(24, 24);
    // Станина, барабан с канатом, рукоять.
    p.line(3, 22, 6, 8, WOOD[2]);
    p.line(21, 22, 18, 8, WOOD[1]);
    p.rect(2, 21, 22, 22, WOOD[1]);
    cylH(p, 12, 11, 7, 4, WOOD);
    // Намотано столько каната, сколько сделано шагов.
    for (let k = 0; k < 2 + step * 2; k++) {
      const x = 6 + k * 1.5;
      if (x > 18) break;
      p.line(x, 7, x, 15, BONE[k % 2 ? 1 : 2]);
    }
    // Рукоять — четыре положения.
    const a = (f / 4) * TAU;
    p.line(20, 11, 20 + Math.cos(a) * 3.5, 11 + Math.sin(a) * 3.5, hx('#6a6e78'));
    p.set(20 + Math.cos(a) * 3.5, 11 + Math.sin(a) * 3.5, BONE[3]);
    // Канат уходит к мосту.
    p.line(12, 15, 12, 23, BONE[1]);
    if (step >= 3) p.rect(4, 3, 6, 5, AURORA[2]);
    p.outline(INK);
    void o;
    return [p, 12, 22];
  });
});

/** Лежачий цилиндр (барабан): ось по x. */
function cylH(p: Px, cx: number, cy: number, rx: number, r: number, R: RGBA[]): void {
  for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++)
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      const v = (y + 0.5 - cy) / r;
      if (Math.abs(v) > 1) continue;
      p.set(x, y, toneOf(R, 0.6 - v * 0.35, x, y));
    }
  p.ell(cx - rx, cy, 1.4, r, R[3]);
}

registerPropPainter('f12_steam', (o, time) => {
  const f = Math.floor(time * 8 + o.x * 3) % 16;
  return spr(`steam|${f}`, () => {
    const p = new Px(20, 30);
    // Пар из тёплой отдушины: три клуба поднимаются и тают.
    p.ell(10, 27, 5, 1.6, hx('#2a3236'));
    p.ell(10, 27, 3, 1, TEAL[1]);
    for (let k = 0; k < 3; k++) {
      const t = ((f + k * 5.3) % 16) / 16;
      const y = 26 - t * 24;
      const r = 1.6 + t * 3.4;
      const a = 0.55 * (1 - t);
      p.ell(10 + Math.sin(t * 6 + k) * 2, y, r, r * 0.8, alpha(SNOW[4], a));
    }
    return [p, 10, 27];
  });
});

registerPropPainter('f12_rack', (o, time) => {
  const f = Math.floor(time * 2 + o.x) % 2;
  return spr(`rack|${f}`, () => {
    // Вешала с рыбой.
    const p = new Px(22, 22);
    p.line(3, 21, 4, 3, WOOD[2]);
    p.line(18, 21, 17, 3, WOOD[1]);
    p.line(2, 4, 19, 4, WOOD[3]);
    for (let k = 0; k < 4; k++) {
      const x = 6 + k * 3.5 + (k === 1 ? f * 0.6 : 0);
      p.line(x, 4, x, 6, BONE[1]);
      p.ell(x, 9, 1.3, 3, (xx, yy) =>
        toneOf(
          ramp('#3a4a5a', '#5a7088', '#8aa0b4', '#b8c8d4', '#e0ecf4'),
          0.6 - (yy - 6) * 0.06 + (xx < x ? 0.15 : 0),
          xx,
          yy,
        ),
      );
      p.set(x, 13, hx('#3a4a5a'));
      p.set(x - 1, 13, hx('#3a4a5a'));
      p.set(x + 1, 13, hx('#3a4a5a'));
    }
    p.ell(10.5, 21, 9, 1.4, SNOW[1]);
    p.outline(INK);
    return [p, 11, 20];
  });
});

registerPropPainter('f12_bones', (o) =>
  spr(`bones|${o.x & 1}`, () => {
    // Рёбра мамонта из снега: дуги кости, череп с бивнем.
    const p = new Px(34, 26);
    const flip = o.x & 1;
    for (let k = 0; k < 5; k++) {
      const x0 = 6 + k * 5;
      const h = 14 - Math.abs(k - 1.5) * 2;
      for (let t = 0; t <= 1.0001; t += 0.05) {
        const x = x0 + Math.sin(t * Math.PI) * 3.5;
        const y = 22 - t * h;
        p.set(x, y, BONE[3]);
        p.set(x + 1, y, BONE[1]);
      }
    }
    p.line(4, 21, 30, 21, BONE[1]);
    p.ell(30, 18, 3.5, 3, BONE[2]);
    p.set(29, 17, INK);
    for (let t = 0; t <= 1; t += 0.06)
      p.set(31 + Math.sin(t * 2.6) * 2 - t * 8, 20 - t * 7 + t * t * 9, BONE[4]);
    p.ell(17, 23, 15, 2.2, alpha(SNOW[3], 0.9));
    p.outline(INK);
    return [flip ? p.flipX() : p, 17, 22];
  }),
);

registerPropPainter('f12_totem', (o, time) => {
  const f = Math.floor(time * 6 + o.x) % 8;
  return spr(`totem|${f}`, () => {
    // Шест шаманки: череп, рога, ленты сияния на ветру.
    const p = new Px(22, 36);
    p.rect(10, 8, 11, 34, WOOD[2]);
    p.rect(10, 8, 10, 34, WOOD[3]);
    for (const y of [14, 20, 26]) p.rect(9, y, 12, y, OCHRE[2]);
    p.ell(10.5, 7, 3.4, 3, BONE[3]);
    p.set(9, 7, INK);
    p.set(12, 7, INK);
    p.line(7, 5, 3, 1, BONE[2]);
    p.line(14, 5, 18, 1, BONE[2]);
    // Ленты: синус по времени.
    const cols = [AURORA[2], TEAL[3], AURORA[3]];
    for (let k = 0; k < 3; k++)
      for (let i = 0; i < 9; i++) {
        const x = 12 + i;
        const y = 12 + k * 3 + Math.sin(f * 0.8 + i * 0.7 + k) * 1.4 + i * 0.25;
        p.set(x, y, cols[k]);
      }
    p.ell(10.5, 34, 6, 1.6, SNOW[1]);
    p.outline(INK);
    return [p, 11, 34];
  });
});

registerPropPainter('f12_fishhole', (o, time) => {
  const f = Math.floor(time * 4 + o.x) % 8;
  return spr(`fish|${f}`, () => {
    // Лунка с удочкой: вода, круги, поплавок.
    const p = new Px(18, 14);
    p.ell(9, 8, 6, 3.4, ICE[4]);
    p.ell(9, 8, 5, 2.6, WATER[1]);
    const r = (f / 8) * 4;
    for (let a = 0; a < 16; a++) {
      const t = (a / 16) * TAU;
      p.set(9 + Math.cos(t) * r, 8 + Math.sin(t) * r * 0.5, alpha(WATER[4], 1 - f / 8));
    }
    p.set(9, 7 + (f < 2 ? 1 : 0), OCHRE[3]);
    p.line(9, 7, 16, 1, BONE[1]);
    p.line(14, 3, 17, 4, WOOD[2]);
    return [p, 9, 11];
  });
});

// ---------------------------------------------------------------------------
// Монстры: общее.
// ---------------------------------------------------------------------------

type Eye = { x: number; y: number; z: number; c: RGBA; r?: number };
/** Экранная точка модели в кадре: x, y и глубина (к зрителю больше). */
type Scr = (x: number, y: number, z: number) => [number, number, number];
/** Для рисунка поверх: слой свечения (создаётся по требованию) и глубина тела. */
interface PostFx {
  lit: () => Px;
  /** Глубина ближней поверхности тела в пикселе кадра, −1e9 — пусто. */
  z: (x: number, y: number) => number;
}
interface Build {
  parts: Part[];
  eyes?: Eye[];
  clip?: number;
  /** Рисунок поверх (звёзды, брызги, линии хода) в координатах кадра. */
  post?: (p: Px, scr: Scr, fx: PostFx) => void;
  /** Точки модели, которые кадр обязан вместить (след удара). */
  extent?: V3[];
}
interface Canvas {
  w: number;
  h: number;
  ox: number;
  oy: number;
}

const LRUS = new Map<string, ReturnType<typeof frameLRU<Cached>>>();
function lruOf(id: string, n = 600) {
  let c = LRUS.get(id);
  if (!c) {
    c = frameLRU<Cached>(n);
    LRUS.set(id, c);
  }
  return c;
}

/** Кадр рига в кеше: ключ — вид, сторона (из 16), поза, вспышка. */
function rigCached(
  id: string,
  key: string,
  face: number,
  cv: Canvas,
  flash: boolean,
  make: (face: number) => Build,
  dirs = 16,
): Cached {
  const task = rigTask(id, key, face, cv, flash, make, dirs);
  const hit = lruOf(id).get(task.key);
  if (hit) return hit;
  task.step(Infinity);
  return task.res as Cached;
}

/**
 * Кадр рига в кеш по шагам: сборка позы, порядок частей, части (`rigJob`),
 * рисунок поверх, холст. `step(мс)` — сколько успеть сейчас (`true` — кадр
 * в кеше, `res`). С `own` кадр рисуется «на потом» в своих буферах.
 */
interface RigTask {
  key: string;
  res: Cached | null;
  step: (ms: number) => boolean;
}
function rigTask(
  id: string,
  key: string,
  face: number,
  cv: Canvas,
  flash: boolean,
  make: (face: number) => Build,
  dirs = 16,
  own?: RigBufs,
): RigTask {
  const d = dirN(face, dirs);
  const f = dirAng(d, dirs);
  const lru = lruOf(id);
  const full = (x: number, y: number, z: number): [number, number, number] => {
    const [wx, wy, wz] = toWorld(x, y, z, f);
    const [sx, sy, sd] = project(wx, wy, wz);
    return [cv.ox + sx, cv.oy + sy, sd];
  };
  let stage = 0;
  let b: Build | null = null;
  let job: RigJob | null = null;
  let out: RigOut | null = null;
  const task: RigTask = {
    key: `${key}|${d}|${flash ? 1 : 0}`,
    res: null,
    step: (ms) => {
      const t0 = ms < Infinity ? performance.now() : 0;
      const over = () => ms < Infinity && performance.now() - t0 > ms;
      if (stage === 0) {
        b = make(f);
        stage = 1;
        if (over()) return false;
      }
      if (stage === 1 && b) {
        job = rigJob(
          b.parts,
          f,
          cv.w,
          cv.h,
          cv.ox,
          cv.oy,
          b.eyes ?? [],
          flash ? 0.8 : 0,
          b.clip,
          true,
          (b.extent ?? []).map((e) => {
            const [x, y] = full(e[0], e[1], e[2]);
            return [x, y];
          }),
          own,
        );
        stage = 2;
        if (over()) return false;
      }
      if (stage === 2 && job) {
        if (!job.step(ms < Infinity ? Math.max(0, ms - (performance.now() - t0)) : ms))
          return false;
        out = job.out();
        stage = 3;
        if (over()) return false;
      }
      if (stage === 3 && b && out) {
        if (b.post) {
          const o = out;
          const cx = o.cx ?? 0;
          const cy = o.cy ?? 0;
          const scr: Scr = (x, y, z) => {
            const [sx, sy, sd] = full(x, y, z);
            return [sx - cx, sy - cy, sd];
          };
          const zb = o.zb;
          const W = o.p.w;
          const H = o.p.h;
          b.post(o.p, scr, {
            lit: () => (o.lit ??= new Px(W, H)),
            z: (x, y) => {
              const X = Math.round(x);
              const Y = Math.round(y);
              if (!zb || X < 0 || Y < 0 || X >= W || Y >= H) return -1e9;
              return zb[Y * W + X];
            },
          });
        }
        stage = 4;
        if (over()) return false;
      }
      if (stage === 4 && out) {
        task.res = cachedRig(lru, task.key, () => out as RigOut);
        stage = 5;
      }
      return stage === 5;
    },
  };
  return task;
}

/**
 * Кадр рига без вспышки — из кеша (или нарисован), вспышка удара — тот же
 * кадр, перекрашенный холстом (без нового рисунка рига: босса бьют часто,
 * и каждая белая поза была бы ещё одним полным кадром).
 */
function rigFrame(
  id: string,
  key: string,
  face: number,
  cv: Canvas,
  flash: boolean,
  make: (face: number) => Build,
  dirs = 16,
): Cached {
  const c = rigCached(id, key, face, cv, false, make, dirs);
  if (!flash) return c;
  const fk = `${key}|${dirN(face, dirs)}`;
  const lru = lruOf(`${id}#flash`, 40);
  const hit = lru.get(fk);
  if (hit && hit.dx === c.dx && hit.dy === c.dy) return hit;
  const img = document.createElement('canvas');
  img.width = c.img.width;
  img.height = c.img.height;
  const g = img.getContext('2d');
  if (g) {
    g.drawImage(c.img, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = 'rgba(255,255,255,0.8)';
    g.fillRect(0, 0, img.width, img.height);
  }
  return lru.set(fk, { ...c, img });
}

function mobFrame(c: Cached, cv: Canvas, extra: Partial<MobFrame> = {}): MobFrame {
  return { img: c.img, lit: c.lit, eye: c.eye, ax: cv.ox - c.dx, ay: cv.oy - c.dy, ...extra };
}

/** Прошлый режим моба (контакт удара рисуется в первых кадрах `recover`). */
const TRACK = new Map<number, { mode: string; prev: string }>();
function prevMode(m: Mob): string {
  let r = TRACK.get(m.id);
  if (!r) {
    r = { mode: m.mode, prev: '' };
    TRACK.set(m.id, r);
    if (TRACK.size > 900) TRACK.delete(TRACK.keys().next().value as number);
  } else if (r.mode !== m.mode) {
    r.prev = r.mode;
    r.mode = m.mode;
  }
  return r.prev;
}

const speedOf = (m: Mob) => Math.hypot(m.vx, m.vy);
/** Фаза бега 0…7 по времени рендера (свой сдвиг у каждого моба). */
const runFrame = (pose: MobPose, m: Mob, rate: number) =>
  Math.floor((pose.now * rate + m.id * 0.618) * 8) & 7;
/** Кадр 24 к/с по времени режима, не больше `max`. */
const k24 = (t: number, max = 999) => Math.min(max, f24(t));

/** Нога-цепочка: бедро → колено → лапа. */
function leg(
  out: Part[],
  hip: V3,
  foot: V3,
  r0: number,
  r1: number,
  R: RGBA[],
  id: number,
  knee = 0,
): void {
  const mid: V3 = [(hip[0] + foot[0]) / 2 + knee, (hip[1] + foot[1]) / 2, (hip[2] + foot[2]) / 2];
  const pts = [...bez(hip, mid, foot, 3)];
  pts.forEach((pt, i) => {
    const r = r0 + ((r1 - r0) * i) / (pts.length - 1);
    out.push({ x: pt[0], y: pt[1], z: pt[2], rx: r, ry: r, rz: r, ramp: R, id });
  });
}

/** Четыре ноги рысью: фаза бега 0…1, шаг и подъём лапы. */
function legs4(
  out: Part[],
  o: {
    fx: number;
    bx: number;
    wy: number;
    hz: number;
    r0: number;
    r1: number;
    ph: number;
    stride: number;
    lift: number;
    R: RGBA[];
    id: number;
    spread?: number;
    tuck?: number;
  },
): void {
  const L: [number, number, number][] = [
    [o.fx, -o.wy, 0],
    [o.fx, o.wy, 0.5],
    [o.bx, -o.wy, 0.5],
    [o.bx, o.wy, 0],
  ];
  L.forEach(([hx, hy, off], k) => {
    const a = (o.ph + off) * TAU;
    const fx = hx + Math.sin(a) * o.stride + (o.spread ?? 0) * Math.sign(hx);
    const fz = Math.max(0, Math.cos(a)) * o.lift + (o.tuck ?? 0);
    leg(out, [hx, hy, o.hz], [fx, hy * 1.05, fz + o.r1 * 0.8], o.r0, o.r1, o.R, o.id + k);
  });
}

/** Звёзды оглушения над головой. */
function stars(p: Px, scr: Scr, z: number, ph: number, cx = 0, cy = 0, r = 4): void {
  for (let k = 0; k < 3; k++) {
    const a = ph * TAU + (k / 3) * TAU;
    const [x, y] = scr(cx + Math.cos(a) * r, cy + Math.sin(a) * r, z);
    p.set(x, y, hx('#fff6a0'));
    p.set(x + 1, y, hx('#ffd23a'));
    p.set(x, y - 1, hx('#fff6a0'));
  }
}

/** Брызги снега/льда разлётом: k — доля 0…1. */
function spray(p: Px, scr: Scr, k: number, n: number, r: number, seed: number, col: RGBA[]): void {
  for (let i = 0; i < n; i++) {
    const a = hash(i, seed, 501) * TAU;
    const v = 0.5 + hash(i, seed, 502) * 0.5;
    const z = Math.sin(Math.min(1, k) * Math.PI) * (2 + hash(i, seed, 503) * 5);
    const [x, y] = scr(Math.cos(a) * r * k * v, Math.sin(a) * r * k * v, z);
    p.set(x, y, col[i % col.length]);
  }
}

// ---------------------------------------------------------------------------
// Лемминг: маленький, быстрый, прыгает в лицо.
// ---------------------------------------------------------------------------

const LEM_BACK = ramp('#1a100a', '#33200f', '#54361a', '#7a5228', '#a2763a');
const LEM_SIDE = ramp('#5a3a14', '#8a5a20', '#b8862e', '#dcae4a', '#f4d27a');
const LEM_BELLY = ramp('#6a5a48', '#9a8a70', '#c8b898', '#e6dcc4', '#fff6e4');
const CV_LEM: Canvas = { w: 22, h: 22, ox: 11, oy: 16 };

function lemmingBuild(
  look: MobPose['look'],
  o: {
    run: number;
    moving: boolean;
    crouch: number;
    stretch: number;
    mouth: number;
    roll: number;
    head: number;
  },
): Build {
  const parts: Part[] = [];
  const back = lookRamp(LEM_BACK, look);
  const side = lookRamp(LEM_SIDE, look);
  const belly = lookRamp(LEM_BELLY, look);
  const bob = o.moving ? Math.abs(Math.sin(o.run * Math.PI)) * 1.2 : 0;
  const z = 3.2 + bob - o.crouch * 1;
  const L = 4.2 * (1 + o.stretch * 0.35);
  const pitch = o.crouch * 0.35 - o.stretch * 0.15;
  parts.push({
    x: -0.4,
    y: 0,
    z,
    rx: L,
    ry: 3.3,
    rz: 2.9,
    ramp: side,
    pitch,
    roll: o.roll,
    fur: 0.12,
  });
  parts.push({
    x: -0.2,
    y: 0,
    z: z + 1.3,
    rx: L * 0.86,
    ry: 2.7,
    rz: 2.0,
    ramp: back,
    pitch,
    roll: o.roll,
    fur: 0.15,
  });
  parts.push({ x: 0, y: 0, z: z - 1.2, rx: L * 0.75, ry: 2.4, rz: 1.6, ramp: belly, roll: o.roll });
  const hx2 = L * 0.82 + o.stretch * 1;
  const hz = z + 0.6 - o.crouch * 0.8 + o.head;
  parts.push({ x: hx2, y: 0, z: hz, rx: 2.5, ry: 2.4, rz: 2.2, ramp: back, fur: 0.1 });
  parts.push({ x: hx2 + 1.6, y: 0, z: hz - 0.6, rx: 1.3, ry: 1.2, rz: 1, ramp: side });
  // Ушки.
  parts.push({ x: hx2 - 0.6, y: -1.6, z: hz + 1.8, rx: 0.8, ry: 0.8, rz: 0.9, ramp: back });
  parts.push({ x: hx2 - 0.6, y: 1.6, z: hz + 1.8, rx: 0.8, ry: 0.8, rz: 0.9, ramp: back });
  // Хвостик.
  parts.push({ x: -L - 0.4, y: 0, z: z + 0.2, rx: 1, ry: 0.8, rz: 0.8, ramp: side });
  legs4(parts, {
    fx: L * 0.5 + o.stretch * 1.5,
    bx: -L * 0.55,
    wy: 2,
    hz: z - 1,
    r0: 1,
    r1: 0.8,
    ph: o.run,
    stride: o.moving ? 1.6 : 0,
    lift: o.moving ? 1.2 : 0,
    R: back,
    id: 20,
    spread: o.stretch * 1.6,
  });
  const eyes: Eye[] = [
    { x: hx2 + 1, y: -1.3, z: hz + 0.7, c: hx('#0a0604') },
    { x: hx2 + 1, y: 1.3, z: hz + 0.7, c: hx('#0a0604') },
  ];
  return {
    parts,
    eyes,
    post:
      o.mouth > 0
        ? (p, scr) => {
            // Резцы: две белые точки — укусит.
            const [x, y] = scr(hx2 + 2.4, 0, hz - 1.2);
            p.set(x, y, WHITE);
            p.set(x, y + 1, BONE[3]);
          }
        : undefined,
  };
}

regMob('f12_lemming', (m, pose) => {
  const prev = prevMode(m);
  const mode = pose.mode;
  const moving = speedOf(m) > 0.4;
  let o = { run: 0, moving, crouch: 0, stretch: 0, mouth: 0, roll: 0, head: 0 };
  let key = '';
  const ex: Partial<MobFrame> = { shadow: 4 };
  if (mode === 'dying') {
    const k = Math.min(1, pose.t / 0.3);
    o = { ...o, moving: false, roll: k * Math.PI * 0.9 };
    key = `die${Math.round(k * 6)}`;
    ex.dy = -Math.sin(k * Math.PI) * 3;
  } else if (mode === 'f12_wind') {
    const k = Math.min(1, pose.t / 0.32);
    o = { ...o, moving: false, crouch: ease(k), head: -0.4 * k };
    key = `wind${Math.round(k * 6)}`;
    ex.dx = (k24(pose.t) % 2 ? 0.4 : -0.4) * k;
    ex.still = true;
  } else if (mode === 'f12_hop') {
    const k = Math.min(1, pose.t / 0.16);
    o = { ...o, moving: false, stretch: 1, mouth: 1 };
    key = 'hop';
    ex.dy = -Math.sin(k * Math.PI) * 4;
    ex.still = true;
  } else if (mode === 'recover' && prev === 'f12_hop' && pose.t < 0.14) {
    o = { ...o, moving: false, crouch: 0.7, mouth: 1 };
    key = 'land';
    ex.sy = 0.86;
    ex.sx = 1.12;
  } else if (mode === 'stun' || pose.anim === 'hurt') {
    o = { ...o, moving: false, head: 0.8, crouch: 0.3 };
    key = 'hurt';
  } else if (moving) {
    const f = runFrame(pose, m, 2.6);
    o = { ...o, run: f / 8 };
    key = `run${f}`;
  } else {
    const f = Math.floor(pose.now * 3 + m.id) % 4;
    o = { ...o, moving: false, head: f === 1 ? 0.4 : f === 3 ? -0.2 : 0 };
    key = `idle${f}`;
  }
  const c = rigCached('f12_lemming', `${pose.look}|${key}`, m.face, CV_LEM, pose.flash, () =>
    lemmingBuild(pose.look, o),
  );
  return mobFrame(c, CV_LEM, ex);
});

// ---------------------------------------------------------------------------
// Ледяной ёж: иглы изо льда, сворачивается в шар и катится, отскакивает,
// кружится оглушённый; ощетинивается и стреляет иглами.
// ---------------------------------------------------------------------------

const URC_FUR = ramp('#121a2a', '#22304a', '#34486a', '#4c6488', '#6a84a8');
const URC_SNOUT = ramp('#4a3a44', '#6a5664', '#8e7686', '#b49aa8', '#d8c0cc');
const CV_URC: Canvas = { w: 30, h: 30, ox: 15, oy: 22 };

function urchinBuild(
  look: MobPose['look'],
  o: { curl: number; spin: number; bristle: number; run: number; moving: boolean; dizzy: number },
): Build {
  const parts: Part[] = [];
  const fur = lookRamp(URC_FUR, look);
  const ice = look === 'elite' ? lookRamp(TEAL, look) : ICE;
  const c = o.curl;
  // Тело: от «ежа» (вытянут) к шару.
  const rx = lerp(5.2, 4.6, c);
  const rz = lerp(3.6, 4.6, c);
  const z = lerp(3.8, 4.8, c);
  parts.push({ x: 0, y: 0, z, rx, ry: lerp(4.4, 4.6, c), rz, ramp: fur, fur: 0.2, pitch: o.spin });
  if (c < 0.7) {
    const k = 1 - c / 0.7;
    // Мордочка.
    parts.push({
      x: rx * 0.9,
      y: 0,
      z: z - 0.8,
      rx: 2.2 * k + 0.3,
      ry: 1.8 * k + 0.3,
      rz: 1.6 * k + 0.3,
      ramp: URC_SNOUT,
    });
    parts.push({
      x: rx * 0.9 + 2 * k,
      y: 0,
      z: z - 1.2,
      rx: 0.8,
      ry: 0.8,
      rz: 0.7,
      ramp: ramp('#0a0608', '#1a1018', '#2a1a24', '#3a2a34', '#5a4a54'),
    });
    legs4(parts, {
      fx: 2.6,
      bx: -2.6,
      wy: 2.6,
      hz: 2,
      r0: 1,
      r1: 0.9,
      ph: o.run,
      stride: o.moving ? 1.2 : 0,
      lift: o.moving ? 0.8 : 0,
      R: fur,
      id: 30,
      tuck: c * 2,
    });
  }
  // Иглы: два кольца по спине; в шаре — по всей сфере, крутятся с ним.
  const n = 16;
  const len = 2.6 + o.bristle * 2.4;
  for (let i = 0; i < n; i++) {
    const ring = i % 2;
    const a = (i / n) * TAU;
    // Направление иглы на сфере: широта по кольцу.
    let lat = ring ? 0.95 : 0.45;
    let lon = a;
    if (c > 0.5) {
      lat = ((i * 0.618) % 1) * Math.PI - Math.PI / 2;
      lon = a * 1.7;
    }
    // Вращение шара — вокруг поперечной оси.
    let dx = Math.cos(lat) * Math.cos(lon) * 0.55 - (c < 0.5 ? 0.45 : 0);
    let dy = Math.cos(lat) * Math.sin(lon);
    let dz = Math.sin(lat);
    if (c > 0.5) {
      const cs = Math.cos(o.spin);
      const sn = Math.sin(o.spin);
      const nx = dx * cs - dz * sn;
      const nz = dx * sn + dz * cs;
      dx = nx;
      dz = nz;
    } else if (dz < 0.1) dz = 0.1 + Math.abs(dz) * 0.3;
    const nl = Math.hypot(dx, dy, dz) || 1;
    dx /= nl;
    dy /= nl;
    dz /= nl;
    const bx = dx * rx * 0.85;
    const by = dy * 4.2;
    const bz = z + dz * rz * 0.85;
    if (bz < 0.5) continue;
    parts.push({
      x: bx + dx * len * 0.55,
      y: by + dy * len * 0.55,
      z: bz + dz * len * 0.55,
      rx: len * 0.6,
      ry: 0.75,
      rz: 0.75,
      yaw: Math.atan2(dy, dx),
      pitch: Math.asin(Math.max(-1, Math.min(1, dz))),
      ramp: ice,
      gloss: true,
      glow: o.bristle > 0.6,
    });
  }
  const eyes: Eye[] =
    c < 0.6
      ? [
          { x: rx * 0.75, y: -1.5, z: z + 0.4, c: hx('#8af0ff') },
          { x: rx * 0.75, y: 1.5, z: z + 0.4, c: hx('#8af0ff') },
        ]
      : [];
  return {
    parts,
    eyes,
    post: o.dizzy > 0 ? (p, scr) => stars(p, scr, z + rz + 4, o.dizzy) : undefined,
  };
}

regMob('f12_urchin', (m, pose) => {
  const mode = pose.mode;
  const prev = prevMode(m);
  const moving = speedOf(m) > 0.3;
  let o = { curl: 0, spin: 0, bristle: 0, run: 0, moving, dizzy: 0 };
  let key = '';
  const ex: Partial<MobFrame> = { shadow: 5.5 };
  let face = m.face;
  if (mode === 'dying') {
    // Рассыпается иглами.
    const k = Math.min(1, pose.t / 0.4);
    o = { ...o, moving: false, curl: 0.3, bristle: 1 - k };
    key = `die${Math.round(k * 5)}`;
    ex.sy = 1 - k * 0.5;
  } else if (mode === 'f12_curl') {
    const k = Math.min(1, pose.t / 0.7);
    o = { ...o, moving: false, curl: ease(k * 1.4), spin: k * 0.8 };
    key = `curl${Math.round(k * 10)}`;
    ex.still = true;
    ex.dx = k > 0.6 ? (k24(pose.t) % 2 ? 0.5 : -0.5) : 0;
  } else if (mode === 'f12_roll') {
    // Шар катится: поворот по пройденному пути (8 положений).
    const sp = Math.floor((pose.now * 14) % 8);
    o = { ...o, moving: false, curl: 1, spin: (sp / 8) * TAU };
    key = `roll${sp}`;
    face = Math.atan2(m.vy, m.vx);
    ex.still = true;
    ex.ghost = { every: 0.05, life: 0.18, tint: '#8ad8ff', alpha: 0.35 };
  } else if (mode === 'dizzy') {
    const ph = Math.floor(pose.now * 8) % 8;
    o = { ...o, moving: false, curl: 0.25, dizzy: ph / 8 + 0.01 };
    key = `dizzy${ph}`;
    face = m.face + Math.sin(pose.now * 9) * 0.6;
  } else if (mode === 'f12_bristle') {
    const k = Math.min(1, pose.t / 0.6);
    o = { ...o, moving: false, curl: 0.15, bristle: ease(k) };
    key = `bristle${Math.round(k * 8)}`;
    ex.still = true;
    ex.sx = 1 + k * 0.08;
    ex.sy = 1 + k * 0.08;
  } else if (mode === 'recover' && prev === 'f12_bristle' && pose.t < 0.15) {
    o = { ...o, moving: false, curl: 0.15, bristle: 0.2 };
    key = 'fired';
    ex.sx = 0.92;
  } else if (moving) {
    const f = runFrame(pose, m, 1.8);
    o = { ...o, run: f / 8 };
    key = `run${f}`;
  } else {
    const f = Math.floor(pose.now * 2 + m.id) % 2;
    o = { ...o, moving: false, bristle: f * 0.08 };
    key = `idle${f}`;
  }
  const c = rigCached('f12_urchin', `${pose.look}|${key}`, face, CV_URC, pose.flash, () =>
    urchinBuild(pose.look, o),
  );
  return mobFrame(c, CV_URC, ex);
});

// ---------------------------------------------------------------------------
// Тюлень-толкач: ждёт подо льдом, всплывает, встаёт на ласты и бросается
// брюхом по льду; хвостом бьёт тех, кто зашёл сзади.
// ---------------------------------------------------------------------------

const SEAL_BODY = ramp('#141c28', '#263244', '#3e4c60', '#5e6e84', '#8a9aae');
const SEAL_BELLY = ramp('#3a4450', '#5a6674', '#7e8a98', '#a6b0bc', '#d0d8e0');
const CV_SEAL: Canvas = { w: 40, h: 34, ox: 20, oy: 25 };

function sealBuild(
  look: MobPose['look'],
  o: {
    rear: number;
    slide: number;
    flip: number;
    run: number;
    moving: boolean;
    sink: number;
    mouth: number;
  },
): Build {
  const parts: Part[] = [];
  const body = lookRamp(SEAL_BODY, look);
  const belly = lookRamp(SEAL_BELLY, look);
  const r = o.rear;
  const s = o.slide;
  const gal = o.moving ? Math.sin(o.run * TAU) : 0;
  const z = 4.4 - s * 1.2 - o.sink;
  // Корпус: при подъёме перед встаёт (наклон носа вверх).
  const pitch = r * 0.75 - s * 0.05 + gal * 0.08;
  const L = 8.2 + s * 1.5;
  parts.push({ x: 0, y: 0, z, rx: L, ry: 5, rz: 4.2, ramp: body, pitch, fur: 0.06 });
  parts.push({ x: 0.8, y: 0, z: z - 1.4, rx: L * 0.8, ry: 4, rz: 2.8, ramp: belly, pitch });
  // Голова: впереди, при подъёме — выше.
  const hx2 = L * 0.95 * Math.cos(pitch) + 1;
  const hz = z + 2.4 + Math.sin(pitch) * L * 0.9 + gal * 0.6;
  parts.push({ x: hx2, y: 0, z: hz, rx: 3.4, ry: 3, rz: 2.9, ramp: body });
  parts.push({
    x: hx2 + 2.4,
    y: 0,
    z: hz - 0.8 - o.mouth * 0.6,
    rx: 1.8,
    ry: 1.9,
    rz: 1.4,
    ramp: belly,
  });
  // Ласты: передние по бокам, задние — хвост (бьёт при «перевороте»).
  const fl = s > 0 ? -1.2 : 1.2;
  parts.push({
    x: 2.5,
    y: -5,
    z: z - 2.5 + r * 2,
    rx: 2.8,
    ry: 1,
    rz: 0.9,
    yaw: -0.7 + fl * 0.3,
    ramp: body,
  });
  parts.push({
    x: 2.5,
    y: 5,
    z: z - 2.5 + r * 2,
    rx: 2.8,
    ry: 1,
    rz: 0.9,
    yaw: 0.7 - fl * 0.3,
    ramp: body,
  });
  const ta = o.flip * 2.2;
  const tx = -L - 1.5;
  const tz = z - 1 + Math.sin(o.flip * Math.PI) * 4;
  parts.push({
    x: tx,
    y: Math.sin(ta) * 3,
    z: tz,
    rx: 2.4,
    ry: 2.6,
    rz: 0.9,
    ramp: body,
    yaw: ta * 0.5,
  });
  const eyes: Eye[] = [
    { x: hx2 + 1.2, y: -1.6, z: hz + 0.9, c: hx('#05080c') },
    { x: hx2 + 1.2, y: 1.6, z: hz + 0.9, c: hx('#05080c') },
  ];
  return {
    parts,
    eyes,
    clip: o.sink > 0 ? 0.2 : undefined,
    post: (p, scr) => {
      // Усы и пятна.
      const [x, y] = scr(hx2 + 3.6, 0, hz - 0.8);
      p.set(x - 2, y, alpha(WHITE, 0.8));
      p.set(x + 2, y, alpha(WHITE, 0.8));
      if (o.sink > 0) {
        // Кромка воды вокруг.
        for (let a = 0; a < 20; a++) {
          const t = (a / 20) * TAU;
          const [wx, wy] = scr(Math.cos(t) * 7, Math.sin(t) * 5.5, 0.2);
          p.set(wx, wy, alpha(ICE[4], 0.8));
        }
      }
    },
  };
}

regMob('f12_seal', (m, pose) => {
  const mode = pose.mode;
  const prev = prevMode(m);
  const moving = speedOf(m) > 0.3;
  let o = { rear: 0, slide: 0, flip: 0, run: 0, moving, sink: 0, mouth: 0 };
  let key = '';
  const ex: Partial<MobFrame> = { shadow: 8 };
  if (mode === 'f12_under') {
    // Подо льдом: только пузыри на лунке.
    const f = Math.floor(pose.now * 3 + m.id) % 3;
    const s = spr(`sealbub|${f}`, () => {
      const p = new Px(16, 10);
      for (let k = 0; k <= f; k++) p.set(5 + k * 3, 6 - k, alpha(WATER[4], 0.9));
      return [p, 8, 7];
    });
    return { img: s.img, ax: 8, ay: 7, shadow: 0 };
  }
  if (mode === 'dying') {
    const k = Math.min(1, pose.t / 0.5);
    o = { ...o, moving: false, sink: k * 4 };
    key = `die${Math.round(k * 6)}`;
  } else if (mode === 'f12_rise') {
    const k = Math.min(1, pose.t / 0.55);
    o = { ...o, moving: false, sink: (1 - easeOut(k)) * 8, rear: 0.5 * (1 - k) };
    key = `rise${Math.round(k * 12)}`;
    ex.still = true;
  } else if (mode === 'f12_wind') {
    const k = Math.min(1, pose.t / 0.65);
    o = { ...o, moving: false, rear: ease(k) * 0.9, mouth: k > 0.6 ? 1 : 0 };
    key = `wind${Math.round(k * 12)}`;
    ex.still = true;
  } else if (mode === 'f12_slide') {
    o = { ...o, moving: false, slide: 1, mouth: 1 };
    key = 'slide';
    ex.still = true;
    ex.ghost = { every: 0.06, life: 0.22, tint: '#bfe8ff', alpha: 0.3 };
  } else if (mode === 'f12_flip') {
    const k = Math.min(1, pose.t / 0.5);
    o = { ...o, moving: false, flip: k < 1 ? ease(k) : 1 };
    key = `flip${Math.round(k * 12)}`;
    ex.still = true;
  } else if (mode === 'recover' && prev === 'f12_flip' && pose.t < 0.2) {
    o = { ...o, moving: false, flip: 1 - pose.t * 3 };
    key = `flipend${k24(pose.t)}`;
  } else if (mode === 'recover' && prev === 'f12_slide' && pose.t < 0.3) {
    o = { ...o, moving: false, slide: 1 - pose.t / 0.3 };
    key = `slideend${k24(pose.t)}`;
  } else if (mode === 'stun' || pose.anim === 'hurt') {
    o = { ...o, moving: false, rear: 0.3 };
    key = 'hurt';
  } else if (moving) {
    const f = runFrame(pose, m, 1.6);
    o = { ...o, run: f / 8 };
    key = `run${f}`;
  } else {
    const f = Math.floor(pose.now * 1.5 + m.id) % 4;
    o = { ...o, moving: false, rear: f === 2 ? 0.15 : 0 };
    key = `idle${f}`;
  }
  const c = rigCached('f12_seal', `${pose.look}|${key}`, m.face, CV_SEAL, pose.flash, () =>
    sealBuild(pose.look, o),
  );
  return mobFrame(c, CV_SEAL, ex);
});

/**
 * Рисовальщик моба этажа: общее для всех — невидимка «Безмолвия» (видны
 * только глаза) и ослеплённый гонгом (шатается).
 */
function regMob(id: string, fn: (m: Mob, pose: MobPose) => MobFrame | null): void {
  registerMobPainter(id, (m, pose) => {
    const f = fn(m, pose);
    if (!f) return f;
    if ((m.data.dark ?? 0) > 0) {
      f.alpha = 0.07;
      f.shadow = 0;
      f.ghost = null;
      f.lit = null;
    }
    if ((m.data.blind ?? 0) > 0) {
      f.rot = (f.rot ?? 0) + Math.sin(pose.now * 9) * 0.14;
      f.still = true;
    }
    return f;
  });
}

// ---------------------------------------------------------------------------
// Песец: прячется в сугробе (видны кончики ушей), прыгает дугой из снега,
// кусает сериями, зарывается обратно. Ниже половины — оборотень.
// ---------------------------------------------------------------------------

const FOX_FUR = ramp('#46567a', '#7686a4', '#a8b6cc', '#d2dce8', '#f2f6fc');
const FOX_WERE = ramp('#1a2034', '#2e3a58', '#4a5a80', '#7486aa', '#a8b8d4');
const RED_FOX = ramp('#3a1408', '#6a2a10', '#a4461c', '#d0702e', '#f0a050');
const SACK = ramp('#3a2a18', '#5e4628', '#86683c', '#ac8c58', '#d0b47c');
const DARK = ramp('#05060a', '#0e1018', '#1a1c26', '#2a2c36', '#3c3e48');
const CV_FOX: Canvas = { w: 36, h: 36, ox: 18, oy: 26 };

interface FoxO {
  run: number;
  moving: boolean;
  gallop: number;
  pitch: number;
  head: number;
  jaw: number;
  sink: number;
  dig: number;
  were: boolean;
  sack: number;
  red: boolean;
  roll: number;
}

function foxBuild(look: MobPose['look'], o: FoxO): Build {
  const parts: Part[] = [];
  const base = o.red ? RED_FOX : o.were ? FOX_WERE : FOX_FUR;
  const fur = lookRamp(base, look);
  const s = o.were ? 1.15 : 1;
  const bob = o.moving ? Math.abs(Math.sin(o.run * Math.PI)) * 1.4 * o.gallop : 0;
  const z = (4.6 + bob) * s - o.sink;
  const L = 5.4 * s;
  parts.push({
    x: 0,
    y: 0,
    z,
    rx: L,
    ry: 2.9 * s,
    rz: 2.8 * s,
    ramp: fur,
    pitch: o.pitch,
    roll: o.roll,
    fur: 0.14,
  });
  // Грудь и шея.
  const cx = Math.cos(o.pitch) * L * 0.8;
  const cz = z + Math.sin(o.pitch) * L * 0.8 + 0.6;
  parts.push({ x: cx, y: 0, z: cz, rx: 2.8 * s, ry: 2.7 * s, rz: 3 * s, ramp: fur, fur: 0.1 });
  // Голова: «head» тянет вперёд-вниз (укус) или назад (замах).
  const hx2 = cx + (2.6 + o.head * 1.8) * s;
  const hz = cz + (2.6 - o.head * 1.2) * s;
  parts.push({ x: hx2, y: 0, z: hz, rx: 2.5 * s, ry: 2.4 * s, rz: 2.2 * s, ramp: fur });
  // Морда: верхняя и нижняя челюсть (раскрыта при укусе).
  const jaw = o.jaw;
  parts.push({
    x: hx2 + 2.4 * s,
    y: 0,
    z: hz - 0.4 + jaw * 0.6,
    rx: 2 * s,
    ry: 1.1 * s,
    rz: 0.9 * s,
    ramp: fur,
    pitch: jaw * 0.35,
  });
  parts.push({
    x: hx2 + 2.1 * s,
    y: 0,
    z: hz - 1.2 - jaw * 0.6,
    rx: 1.7 * s,
    ry: 0.9 * s,
    rz: 0.6 * s,
    ramp: fur,
    pitch: -jaw * 0.45,
  });
  parts.push({
    x: hx2 + 4.1 * s,
    y: 0,
    z: hz - 0.3 + jaw * 0.9,
    rx: 0.6,
    ry: 0.6,
    rz: 0.55,
    ramp: DARK,
  });
  // Уши — острые.
  for (const e of [-1, 1])
    parts.push({
      x: hx2 - 0.5,
      y: e * 1.4 * s,
      z: hz + 2.2 * s,
      rx: 0.8 * s,
      ry: 0.7 * s,
      rz: 1.6 * s,
      ramp: fur,
      roll: e * 0.25,
    });
  if (o.were)
    for (let k = 0; k < 5; k++)
      parts.push({
        x: L * 0.6 - k * 1.8,
        y: 0,
        z: z + 2.8 * s - k * 0.1,
        rx: 0.7,
        ry: 0.5,
        rz: 1.5,
        ramp: fur,
        pitch: -0.4,
      });
  // Хвост: пушистый, по дуге назад-вверх.
  const tw = o.moving ? Math.sin(o.run * TAU) * 0.8 : Math.sin(o.dig * 7) * 0.5;
  const tail = bez(
    [-L * 0.9, 0, z + 0.5],
    [-L * 1.5, tw, z + 2.5 * s],
    [-L * 2.0, tw * 1.6, z + 1.2 * s],
    5,
  );
  tail.forEach((pt, i) => {
    const r = (1.2 + Math.sin(((i + 0.5) / 6) * Math.PI) * 1.2) * s;
    const tip = i === tail.length - 1;
    parts.push({
      x: pt[0],
      y: pt[1],
      z: pt[2],
      rx: r,
      ry: r,
      rz: r,
      ramp: tip && !o.red ? fur : tip ? FOX_FUR : fur,
      fur: 0.1,
    });
  });
  // Ноги: галоп или рытьё (передние лапы гребут попеременно).
  if (o.dig > 0) {
    for (const e of [-1, 1]) {
      const a = o.dig * 14 + (e > 0 ? Math.PI : 0);
      leg(
        parts,
        [cx, e * 1.6, z - 1],
        [cx + 2 + Math.sin(a) * 1.5, e * 1.8, Math.max(0, Math.cos(a)) * 1.5 + 0.6],
        1,
        0.8,
        fur,
        40 + e,
      );
    }
    for (const e of [-1, 1])
      leg(parts, [-L * 0.6, e * 1.6, z - 1], [-L * 0.7, e * 1.8, 0.6], 1.1, 0.8, fur, 45 + e);
  } else
    legs4(parts, {
      fx: L * 0.6,
      bx: -L * 0.6,
      wy: 1.6 * s,
      hz: z - 1.2,
      r0: 1.1 * s,
      r1: 0.8 * s,
      ph: o.run,
      stride: o.moving ? 2.4 * o.gallop : 0,
      lift: o.moving ? 1.6 : 0,
      R: fur,
      id: 40,
      spread: o.pitch !== 0 ? 2.5 : 0,
    });
  if (o.sack > 0) {
    // Мешок на спине: перевязан, из горловины блестят монеты.
    parts.push({
      x: -1,
      y: 0,
      z: z + 4.2,
      rx: 3.6 * o.sack,
      ry: 3.4 * o.sack,
      rz: 3.2 * o.sack,
      ramp: SACK,
      fur: 0.08,
    });
    parts.push({ x: 1.6, y: 0, z: z + 6.8 * o.sack, rx: 1.3, ry: 1.3, rz: 0.9, ramp: SACK });
  }
  const eyeC = o.were ? hx('#ff5a3a') : hx('#ffb84a');
  return {
    parts,
    eyes: [
      { x: hx2 + 1.2, y: -1.2 * s, z: hz + 0.8, c: eyeC },
      { x: hx2 + 1.2, y: 1.2 * s, z: hz + 0.8, c: eyeC },
    ],
    clip: o.sink > 0 ? 0.3 : undefined,
    post: (p, scr) => {
      if (o.jaw > 0.5) {
        const [x, y] = scr(hx2 + 3.4 * s, 0, hz - 0.8);
        p.set(x, y, WHITE);
      }
      if (o.sack > 0) {
        const [x, y] = scr(1.8, 0, z + 7.6 * o.sack);
        p.set(x, y, hx('#ffe08a'));
        p.set(x + 1, y + 1, hx('#ffc23a'));
      }
      if (o.dig > 0)
        spray(p, scr, (o.dig * 3) % 1, 6, 6, Math.floor(o.dig * 3), [SNOW[4], SNOW[3]]);
    },
  };
}

const FOX0: FoxO = {
  run: 0,
  moving: false,
  gallop: 1,
  pitch: 0,
  head: 0,
  jaw: 0,
  sink: 0,
  dig: 0,
  were: false,
  sack: 0,
  red: false,
  roll: 0,
};

function foxPose(
  m: Mob,
  pose: MobPose,
  red: boolean,
): { o: FoxO; key: string; ex: Partial<MobFrame>; face: number } {
  const mode = pose.mode;
  const prev = prevMode(m);
  const moving = speedOf(m) > 0.4;
  const were = !red && (m.data.were ?? 0) > 0;
  let o: FoxO = { ...FOX0, moving, were, red, sack: red ? 1 : 0 };
  let key = '';
  let face = m.face;
  const ex: Partial<MobFrame> = { shadow: 5.5 };
  if (mode === 'dying') {
    const k = Math.min(1, pose.t / 0.4);
    o = { ...o, moving: false, roll: k * 1.4, sink: k * 1.5 };
    key = `die${Math.round(k * 6)}`;
  } else if (mode === 'f12_hide') {
    // В сугробе: видны кончики ушей; изредка дёргаются.
    const tw = Math.floor(pose.now * 2 + m.id) % 7 === 0 ? 1 : 0;
    o = { ...o, moving: false, sink: 6.9 - tw * 0.6 };
    key = `hide${tw}`;
    ex.shadow = 0;
  } else if (mode === 'f12_leap') {
    const k = Math.min(1, pose.t / 0.6);
    o = {
      ...o,
      moving: false,
      pitch: lerp(0.55, -0.6, k),
      head: k > 0.7 ? 1 : 0,
      jaw: k > 0.7 ? 1 : 0,
    };
    key = `leap${Math.round(k * 14)}`;
    ex.dy = -Math.sin(k * Math.PI) * 12;
    ex.still = true;
    ex.ghost = { every: 0.05, life: 0.2, tint: '#dff4ff', alpha: 0.3 };
  } else if (mode === 'f12_wind') {
    const T = (m.data.bites ?? 0) === 0 ? 0.32 : 0.2;
    const k = Math.min(1, pose.t / T);
    // Сразу после укуса (серия) — 2 кадра контакта.
    if ((m.data.bites ?? 0) > 0 && pose.t < 0.07) {
      o = { ...o, moving: false, head: 1, jaw: 1, pitch: -0.15 };
      key = 'bite';
    } else {
      o = { ...o, moving: false, head: -0.8 * ease(k), jaw: k > 0.75 ? 0.6 : 0, pitch: 0.12 * k };
      key = `wind${Math.round(k * 8)}`;
    }
    ex.still = true;
  } else if (mode === 'recover' && prev === 'f12_wind' && pose.t < 0.12) {
    o = { ...o, moving: false, head: 1, jaw: 1, pitch: -0.15 };
    key = 'bite';
  } else if (mode === 'f12_burrow' && (m.data.dug ?? 0) > 0) {
    const d = m.data.dug ?? 0;
    o = { ...o, moving: false, dig: d, sink: Math.min(7, d * 5), pitch: -0.3 };
    key = `dig${Math.round(d * 12)}`;
  } else if (mode === 'stun' || pose.anim === 'hurt') {
    o = { ...o, moving: false, head: -0.6, pitch: 0.2 };
    key = 'hurt';
  } else if (moving || mode === 'f12_burrow' || mode === 'escape') {
    const f = runFrame(pose, m, red ? 3 : 2.4);
    o = { ...o, moving: true, run: f / 8 };
    key = `run${f}`;
    if (red) face = Math.atan2(m.vy, m.vx);
  } else {
    const f = Math.floor(pose.now * 2.5 + m.id) % 4;
    o = { ...o, moving: false, head: f === 1 ? -0.2 : 0, jaw: f === 2 ? 0.4 : 0 };
    key = `idle${f}`;
  }
  return { o, key: `${pose.look}|${were ? 'w' : ''}|${key}`, ex, face };
}

regMob('f12_fox', (m, pose) => {
  const { o, key, ex, face } = foxPose(m, pose, false);
  const c = rigCached('f12_fox', key, face, CV_FOX, pose.flash, () => foxBuild(pose.look, o));
  return mobFrame(c, CV_FOX, ex);
});

regMob('f12_sackfox', (m, pose) => {
  const { o, key, ex, face } = foxPose(m, pose, true);
  const c = rigCached('f12_sackfox', key, face, CV_FOX, pose.flash, () => foxBuild(pose.look, o));
  return mobFrame(c, CV_FOX, {
    ...ex,
    ghost: { every: 0.08, life: 0.2, tint: '#ffcf7a', alpha: 0.25 },
  });
});

// ---------------------------------------------------------------------------
// Полярная сова: сидит высоко под сводом, кружит, высматривает (крылья
// вверх, взгляд на цель), пикирует по прямой, бьётся о снег и взлетает.
// ---------------------------------------------------------------------------

const OWL_F = ramp('#4c566c', '#7e889c', '#b4bccc', '#dee4ec', '#ffffff');
const OWL_SPECK = ramp('#2a3040', '#4a5264', '#7a8296', '#a6aebe', '#d0d6e0');
const CV_OWL: Canvas = { w: 40, h: 36, ox: 20, oy: 28 };

function owlBuild(
  look: MobPose['look'],
  o: { flap: number; spread: number; tuck: number; pitch: number; headYaw: number; ground: number },
): Build {
  const parts: Part[] = [];
  const F = lookRamp(OWL_F, look);
  const z = 6 - o.ground * 2.5;
  // Тело — яйцо, наклон вперёд при пикировании.
  parts.push({ x: 0, y: 0, z, rx: 3.6, ry: 3.4, rz: 4.6, ramp: F, pitch: o.pitch, fur: 0.1 });
  const hx2 = Math.sin(o.pitch) * -4.5 + 0.5;
  const hz = z + Math.cos(o.pitch) * 4.8;
  parts.push({
    x: hx2,
    y: 0,
    z: hz,
    rx: 3.1,
    ry: 3.2,
    rz: 2.8,
    ramp: F,
    yaw: o.headYaw,
    fur: 0.05,
  });
  // Лицевой диск и клюв (поворачиваются с головой).
  const ca = Math.cos(o.headYaw);
  const sa = Math.sin(o.headYaw);
  parts.push({
    x: hx2 + ca * 2.2,
    y: sa * 2.2,
    z: hz - 0.2,
    rx: 1,
    ry: 2.6,
    rz: 2.2,
    ramp: F,
    yaw: o.headYaw,
  });
  parts.push({
    x: hx2 + ca * 3.2,
    y: sa * 3.2,
    z: hz - 0.8,
    rx: 0.8,
    ry: 0.6,
    rz: 0.8,
    ramp: DARK,
  });
  // Крылья: сложены вдоль тела или раскрыты и машут.
  for (const e of [-1, 1]) {
    const sp = o.spread;
    const flapA = Math.sin(o.flap * TAU) * 0.9 * sp;
    const wl = 5 + sp * 3;
    const yaw = e * (0.15 + sp * 1.25) + Math.PI;
    const wx = Math.cos(yaw) * wl * 0.5 - o.tuck * 1.5;
    const wy = e * (3 + sp * wl * 0.45);
    const wz = z + 1.2 + sp * (2 + flapA * 3) - o.tuck * 0.5 - o.ground * sp * 1.8;
    parts.push({
      x: wx,
      y: wy,
      z: Math.max(0.6, wz),
      rx: wl * 0.62,
      ry: 1 + sp * 1.4,
      rz: 2.6 - sp * 1.6,
      yaw: yaw + Math.PI,
      roll: e * (flapA + sp * 0.2),
      ramp: OWL_SPECK,
      fur: 0.18,
    });
  }
  // Хвост.
  parts.push({
    x: -3.4 + Math.sin(o.pitch) * 2,
    y: 0,
    z: z - 2.2,
    rx: 1.8,
    ry: 1.8,
    rz: 0.8,
    ramp: OWL_SPECK,
    pitch: o.pitch,
  });
  // Лапы с когтями — видны, когда стоит или пикирует.
  if (o.tuck < 0.5)
    for (const e of [-1, 1])
      parts.push({
        x: 0.6,
        y: e * 1.4,
        z: Math.max(0.6, z - 4.4),
        rx: 1,
        ry: 0.8,
        rz: 0.7,
        ramp: DARK,
      });
  const eyes: Eye[] = [
    { x: hx2 + ca * 2.9 - sa * 1.2, y: sa * 2.9 + ca * -1.2, z: hz + 0.3, c: hx('#ffd23a') },
    { x: hx2 + ca * 2.9 + sa * 1.2, y: sa * 2.9 + ca * 1.2, z: hz + 0.3, c: hx('#ffd23a') },
  ];
  return { parts, eyes };
}

regMob('f12_owl', (m, pose) => {
  const mode = pose.mode;
  let o = { flap: 0, spread: 0, tuck: 0, pitch: 0, headYaw: 0, ground: 0 };
  let key = '';
  const ex: Partial<MobFrame> = { shadow: 4, still: true, lift: 16 };
  let face = m.face;
  if (mode === 'dying') {
    const k = Math.min(1, pose.t / 0.5);
    o = { ...o, spread: 0.8, ground: k };
    key = `die${Math.round(k * 6)}`;
    ex.lift = 16 * (1 - k * k);
    ex.rot = k * 1.2;
  } else if (mode === 'f12_perch') {
    // Высоко под сводом: крылья сложены, голова крутится.
    const f = Math.floor(pose.now * 0.8 + m.id) % 6;
    o = { ...o, headYaw: [0, 0.7, 0.7, 0, -0.7, -0.7][f] };
    key = `perch${f}`;
    ex.lift = 22;
    ex.shadow = 2.5;
    ex.alpha = 0.92;
  } else if (mode === 'f12_hover' || mode === 'chase') {
    const f = Math.floor(pose.now * 9 + m.id) % 8;
    o = { ...o, spread: 1, flap: f / 8 };
    key = `hover${f}`;
    ex.lift = 16 + Math.sin(pose.now * 3 + m.id) * 1.5;
  } else if (mode === 'f12_spot') {
    // Высмотрела: крылья вверх, голова на цель.
    const k = Math.min(1, pose.t / 0.7);
    o = { ...o, spread: 1, flap: 0.25, pitch: 0.25 * k };
    key = `spot${Math.round(k * 8)}`;
    ex.lift = 16 - k * 2;
  } else if (mode === 'f12_dive') {
    const len = m.data.len ?? 8;
    const k = Math.min(1, (pose.t * 10.5) / len);
    o = { ...o, spread: 0.15, tuck: 1, pitch: 0.9 };
    key = 'dive';
    ex.lift = 14 * (1 - k) + 1;
    face = Math.atan2(m.vy, m.vx) || m.face;
    ex.ghost = { every: 0.04, life: 0.18, tint: '#ffffff', alpha: 0.35 };
  } else if (mode === 'f12_ground') {
    // Ударилась о снег: крылья распластаны — бей.
    const k = Math.min(1, pose.t / 1.1);
    const f = Math.floor(pose.t * 6) % 2;
    o = { ...o, spread: 1, ground: 1, flap: 0.5 + f * 0.05, headYaw: Math.sin(pose.t * 5) * 0.4 };
    key = `ground${f}${k > 0.8 ? 'u' : ''}`;
    ex.lift = 0;
    ex.shadow = 7;
  } else if (mode === 'f12_rise') {
    const k = Math.min(1, pose.t / 0.55);
    const f = Math.floor(pose.t * 14) % 8;
    o = { ...o, spread: 1, flap: f / 8 };
    key = `rise${f}`;
    ex.lift = 16 * easeOut(k);
  } else if (mode === 'stun' || pose.anim === 'hurt') {
    o = { ...o, spread: 0.7, flap: 0.6 };
    key = 'hurt';
  } else {
    const f = Math.floor(pose.now * 9 + m.id) % 8;
    o = { ...o, spread: 1, flap: f / 8 };
    key = `hover${f}`;
  }
  const c = rigCached('f12_owl', `${pose.look}|${key}`, face, CV_OWL, pose.flash, () =>
    owlBuild(pose.look, o),
  );
  return mobFrame(c, CV_OWL, ex);
});

// ---------------------------------------------------------------------------
// Сосулька: висит под сводом (тень на полу — где упадёт), трещит у корня,
// падает в такт удару и торчит из льда, пока не растает.
// ---------------------------------------------------------------------------

const CV_ICI: Canvas = { w: 20, h: 40, ox: 10, oy: 34 };

function icicleBuild(o: { crack: number; stuck: number; melt: number }): Build {
  const parts: Part[] = [];
  const L = 22;
  const n = 9;
  // Корень вверху (z = L), остриё внизу (z = 0). Воткнутая — остриём в лёд.
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const r = 0.6 + (1 - t) * 3.2 * (1 - o.melt * 0.4);
    const z = t * L - o.stuck * 6;
    parts.push({ x: 0, y: 0, z: L - z, rx: r, ry: r, rz: r * 1.5, ramp: ICE, gloss: true });
  }
  return {
    parts,
    clip: o.stuck > 0 ? 0 : undefined,
    post: (p, scr) => {
      if (o.crack > 0) {
        // Трещины у корня: белые зигзаги.
        const [x, y] = scr(0, 0, L);
        const n2 = Math.round(o.crack * 4);
        for (let k = 0; k < n2; k++) {
          p.set(x - 2 + k, y + 1 + (k % 2), WHITE);
          p.set(x + 2 - k, y + 3 + (k % 2), ICE[4]);
        }
      }
      if (o.stuck > 0) {
        // Лёд вокруг острия раскололся звездой.
        const [x, y] = scr(0, 0, 0);
        for (let a = 0; a < 6; a++) {
          const t = (a / 6) * TAU + 0.3;
          for (let r = 2; r < 6; r++)
            p.set(x + Math.cos(t) * r, y + Math.sin(t) * r * 0.55, alpha(WHITE, 0.8));
        }
      }
    },
  };
}

regMob('f12_icicle', (m, pose) => {
  const mode = pose.mode;
  const HANG = 18;
  if (mode === 'f12_hang' || mode === 'f12_crack') {
    const t = mode === 'f12_crack' ? pose.t : 0;
    const shake = t > 0 && t < 0.35;
    const fall = t > 0.35 ? Math.min(1, (t - 0.35) / 0.45) : 0;
    const crack = mode === 'f12_crack' ? Math.min(1, t / 0.3) : 0;
    const c = rigCached(
      'f12_icicle',
      `h${Math.round(crack * 4)}`,
      0,
      CV_ICI,
      pose.flash,
      () => icicleBuild({ crack, stuck: 0, melt: 0 }),
      1,
    );
    return mobFrame(c, CV_ICI, {
      lift: HANG * (1 - fall * fall) + 0.01,
      dx: shake ? (k24(t) % 2 ? 0.6 : -0.6) : 0,
      still: true,
      shadow: 2 + crack * 1.5 + fall * 2,
      alpha: mode === 'f12_hang' ? 0.9 : 1,
    });
  }
  if (mode === 'f12_stuck' || mode === 'escape' || mode === 'dying') {
    const melt = mode === 'f12_stuck' ? Math.max(0, (pose.t - 2.2) / 0.8) : 1;
    const c = rigCached(
      'f12_icicle',
      `s${Math.round(melt * 4)}`,
      0,
      CV_ICI,
      pose.flash,
      () => icicleBuild({ crack: 0, stuck: 1, melt }),
      1,
    );
    return mobFrame(c, CV_ICI, {
      still: true,
      shadow: 3,
      alpha: mode === 'f12_stuck' ? 1 - melt * 0.5 : Math.max(0, 0.5 - pose.t),
      sy: mode === 'dying' ? 1 - Math.min(1, pose.t * 2) * 0.6 : 1,
    });
  }
  const c = rigCached(
    'f12_icicle',
    'h0',
    0,
    CV_ICI,
    pose.flash,
    () => icicleBuild({ crack: 0, stuck: 0, melt: 0 }),
    1,
  );
  return mobFrame(c, CV_ICI, { lift: HANG, still: true, shadow: 2 });
});

// ---------------------------------------------------------------------------
// Дух стужи: полупрозрачный, светится; гасит факелы, дышит инеем конусом,
// бежит от жаровни.
// ---------------------------------------------------------------------------

const SPIRIT_R = ramp('#2a6a8a', '#4a9ab8', '#7accdc', '#b6eef4', '#ecffff');
const CV_SPI: Canvas = { w: 34, h: 40, ox: 17, oy: 32 };

function spiritBuild(o: {
  swell: number;
  blow: number;
  stretch: number;
  bob: number;
  arms: number;
}): Build {
  const parts: Part[] = [];
  const z = 9 + o.bob;
  const s = 1 + o.swell * 0.25;
  parts.push({
    x: 0,
    y: 0,
    z,
    rx: 3.4 * s,
    ry: 3.6 * s,
    rz: 4 * s,
    ramp: SPIRIT_R,
    alpha: 0.6,
    glow: true,
  });
  parts.push({ x: 0.5, y: 0, z: z + 1, rx: 1.6, ry: 1.6, rz: 1.8, ramp: TEAL, glow: true });
  const hz = z + 5 * s;
  parts.push({
    x: 0.6 + o.blow * 0.8,
    y: 0,
    z: hz,
    rx: 3 * s,
    ry: 3 * s,
    rz: 2.9 * s,
    ramp: SPIRIT_R,
    alpha: 0.7,
    glow: true,
  });
  // Шлейф: вниз и назад, вытягивается на бегу.
  const tail = bez(
    [-1, 0, z - 3],
    [-4 - o.stretch * 4, Math.sin(o.bob * 3) * 2, z - 6],
    [-7 - o.stretch * 7, 0, 2.5],
    5,
  );
  tail.forEach((pt, i) => {
    const r = 2.6 - i * 0.4;
    parts.push({
      x: pt[0],
      y: pt[1],
      z: pt[2],
      rx: r,
      ry: r,
      rz: r,
      ramp: SPIRIT_R,
      alpha: 0.45,
      glow: true,
    });
  });
  // Руки-клочья.
  for (const e of [-1, 1]) {
    const a = o.arms * 1.2;
    parts.push({
      x: 1 + a * 1.5,
      y: e * (3.6 + a),
      z: z + 1 + a * 2,
      rx: 2.2,
      ry: 0.9,
      rz: 0.9,
      yaw: e * 0.6,
      ramp: SPIRIT_R,
      alpha: 0.5,
      glow: true,
    });
  }
  return {
    parts,
    eyes: [
      { x: 2.4 + o.blow, y: -1.1, z: hz + 0.4, c: hx('#0a2030') },
      { x: 2.4 + o.blow, y: 1.1, z: hz + 0.4, c: hx('#0a2030') },
    ],
    post:
      o.blow > 0
        ? (p, scr) => {
            // Струя холодного воздуха изо рта.
            for (let k = 0; k < 6; k++) {
              const [x, y] = scr(
                4.5 + k * 1.6,
                (hash(k, Math.round(o.blow * 9), 520) - 0.5) * 2,
                hz - 0.6 - k * 0.3,
              );
              p.set(x, y, alpha(SPIRIT_R[4], 0.9 - k * 0.12));
            }
          }
        : undefined,
  };
}

regMob('f12_spirit', (m, pose) => {
  const mode = pose.mode;
  const prev = prevMode(m);
  let o = { swell: 0, blow: 0, stretch: 0, bob: Math.sin(pose.now * 2.4 + m.id) * 1.2, arms: 0 };
  const bobF = Math.round(o.bob * 2);
  o.bob = bobF / 2;
  let key = '';
  const ex: Partial<MobFrame> = { shadow: 3.5, still: true, lift: 2 };
  if (mode === 'dying') {
    const k = Math.min(1, pose.t / 0.6);
    o = { ...o, swell: k * 1.5, arms: k };
    key = `die${Math.round(k * 6)}`;
    ex.alpha = 1 - k;
    ex.sy = 1 + k * 0.4;
  } else if (mode === 'f12_douse') {
    const blowing = (m.data.blow ?? 0) > 0;
    const f = Math.floor(pose.now * 12) % 4;
    o = { ...o, blow: blowing ? 1 + f * 0.01 : 0, swell: blowing ? 0.1 : 0.3 };
    key = `douse${blowing ? f : 'n'}|${bobF}`;
  } else if (mode === 'f12_wind') {
    const k = Math.min(1, pose.t / 0.6);
    o = { ...o, swell: ease(k), arms: ease(k) };
    key = `wind${Math.round(k * 10)}|${bobF}`;
  } else if (mode === 'recover' && prev === 'f12_wind' && pose.t < 0.3) {
    o = { ...o, swell: 0, blow: 1, arms: 0.6 };
    key = `breath${k24(pose.t, 6)}|${bobF}`;
  } else if (mode === 'f12_flee') {
    o = { ...o, stretch: 1 };
    key = `flee|${bobF}`;
    ex.alpha = 0.6;
    ex.ghost = { every: 0.06, life: 0.25, tint: '#bff8ff', alpha: 0.3 };
  } else {
    key = `idle|${bobF}`;
  }
  const c = rigCached('f12_spirit', key, m.face, CV_SPI, pose.flash, () => spiritBuild(o));
  return mobFrame(c, CV_SPI, ex);
});

// ---------------------------------------------------------------------------
// Человекоподобные: вмёрзший воин, хранитель, шаманка. Риг из шаров:
// таз, корпус, голова, руки и ноги — цепочками по кривым.
// ---------------------------------------------------------------------------

interface Body {
  /** Масштаб фигуры. */
  s: number;
  /** Наклон корпуса вперёд (рад). */
  lean: number;
  /** Подъём (прыжок) и присед, px. */
  up: number;
  crouch: number;
  /** Шаг: фаза 0…1 и длина шага. */
  step: number;
  stride: number;
  /** Кисти рук в осях модели (x вперёд, y вбок, z вверх) — от плеча. */
  handL: V3;
  handR: V3;
  /** Колени врозь (стойка). */
  wide: number;
  /** Поворот корпуса вокруг вертикали (замах). */
  twist: number;
  /** На коленях (0…1). */
  kneel: number;
  /** Ступни явно (левая, правая) — летит, сидит верхом. Иначе — шаг. */
  feet?: [V3, V3];
}

const BODY0: Body = {
  s: 1,
  lean: 0,
  up: 0,
  crouch: 0,
  step: 0,
  stride: 0,
  handL: [1.5, -4.2, 9],
  handR: [1.5, 4.2, 9],
  wide: 0,
  twist: 0,
  kneel: 0,
};

interface Dress {
  skin: RGBA[];
  torso: RGBA[];
  legs: RGBA[];
  arms: RGBA[];
  /** Юбка/роба: конус до земли вместо ног. */
  robe?: RGBA[];
}

/** Тело: возвращает опорные точки (плечи, голова, кисти) для оружия. */
function humanoid(parts: Part[], b: Body, d: Dress): { head: V3; handL: V3; handR: V3; chest: V3 } {
  const s = b.s;
  const hipZ = (9 - b.crouch - b.kneel * 4.5) * s + b.up;
  const tw = b.twist;
  // Ноги.
  if (!d.robe)
    for (const e of [-1, 1]) {
      const ph = (b.step + (e > 0 ? 0.5 : 0)) * TAU;
      const fx = Math.sin(ph) * b.stride * s;
      const fz = Math.max(0, Math.cos(ph)) * b.stride * 0.5 * s + b.up * 0.6;
      const hy = e * (1.7 + b.wide * 0.6) * s;
      const fe = b.feet?.[e < 0 ? 0 : 1];
      const foot: V3 = fe
        ? [fe[0] * s, fe[1] * s, fe[2] * s + b.up]
        : [b.kneel > 0.5 ? -3 * s : fx, hy * (1 + b.wide * 0.4), b.kneel > 0.5 ? 0.8 : fz + 0.8];
      const kneeX = fe
        ? (foot[0] + 0) / 2 + 2.2 * s
        : b.kneel > 0.5
          ? 2.5 * s
          : (fx + 0) / 2 + 1.2 * s + b.crouch * 0.6;
      const knee: V3 = [
        kneeX,
        fe ? (hy + foot[1]) / 2 : hy,
        b.kneel > 0.5 && !fe ? 1.2 : (hipZ + foot[2]) / 2,
      ];
      const pts = bez([0, hy, hipZ], knee, foot, 4);
      pts.forEach((pt, i) => {
        const r = (1.7 - i * 0.12) * s;
        parts.push({ x: pt[0], y: pt[1], z: pt[2], rx: r, ry: r, rz: r, ramp: d.legs, id: 60 + e });
      });
      parts.push({
        x: foot[0] + 0.8 * s,
        y: foot[1],
        z: fe ? foot[2] : 0.9 * s,
        rx: 1.8 * s,
        ry: 1.1 * s,
        rz: 0.9 * s,
        ramp: DARK,
        id: 62 + e,
      });
    }
  else {
    // Роба: конус от пояса к земле.
    const n = 5;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const r = (2.6 + t * 2.6) * s;
      parts.push({
        x: -t * b.lean * 3,
        y: 0,
        z: hipZ - t * (hipZ - 1.8 - b.up),
        rx: r,
        ry: r * 1.05,
        rz: 2.2 * s,
        ramp: d.robe,
        fur: 0.04,
        id: 70,
      });
    }
  }
  // Таз и корпус.
  parts.push({ x: 0, y: 0, z: hipZ, rx: 2.4 * s, ry: 2.9 * s, rz: 2 * s, ramp: d.legs, id: 71 });
  const cl = Math.sin(b.lean);
  const chest: V3 = [cl * 4.5 * s, 0, hipZ + Math.cos(b.lean) * 4.5 * s];
  parts.push({
    x: chest[0] * 0.55,
    y: 0,
    z: (hipZ + chest[2]) / 2,
    rx: 2.4 * s,
    ry: 3.1 * s,
    rz: 2.8 * s,
    ramp: d.torso,
    pitch: -b.lean,
    yaw: tw,
    id: 72,
  });
  parts.push({
    x: chest[0],
    y: 0,
    z: chest[2],
    rx: 2.8 * s,
    ry: 3.8 * s,
    rz: 2.8 * s,
    ramp: d.torso,
    pitch: -b.lean,
    yaw: tw,
    fur: 0.06,
    id: 73,
  });
  // Голова.
  const head: V3 = [chest[0] + cl * 3.8 * s, 0, chest[2] + Math.cos(b.lean) * 4.2 * s];
  parts.push({
    x: head[0],
    y: 0,
    z: head[2],
    rx: 2.3 * s,
    ry: 2.2 * s,
    rz: 2.5 * s,
    ramp: d.skin,
    id: 74,
  });
  // Руки: плечо → локоть (наружу и вниз) → кисть.
  const out: { L: V3; R: V3 } = { L: [0, 0, 0], R: [0, 0, 0] };
  for (const e of [-1, 1]) {
    const sh: V3 = [
      chest[0] - Math.sin(tw) * e * 3.6 * s,
      Math.cos(tw) * e * 3.6 * s,
      chest[2] + 1.2 * s,
    ];
    const h0 = e < 0 ? b.handL : b.handR;
    const hand: V3 = [h0[0] * s, h0[1] * s, h0[2] * s + b.up - b.crouch];
    const elbow: V3 = [
      (sh[0] + hand[0]) / 2 - 1 * s,
      (sh[1] + hand[1]) / 2 + e * 1.4 * s,
      (sh[2] + hand[2]) / 2 - 0.6 * s,
    ];
    const pts = bez(sh, elbow, hand, 4);
    pts.forEach((pt, i) => {
      const r = (1.5 - i * 0.1) * s;
      parts.push({
        x: pt[0],
        y: pt[1],
        z: pt[2],
        rx: r,
        ry: r,
        rz: r,
        ramp: i < 2 ? d.torso : d.arms,
        id: 80 + e,
      });
    });
    parts.push({
      x: hand[0],
      y: hand[1],
      z: hand[2],
      rx: 1.2 * s,
      ry: 1.2 * s,
      rz: 1.2 * s,
      ramp: d.skin,
      id: 82 + e,
    });
    if (e < 0) out.L = hand;
    else out.R = hand;
  }
  return { head, handL: out.L, handR: out.R, chest };
}

/** Древко с навершием от кисти по направлению (yaw, pitch в осях модели). */
function haft(
  parts: Part[],
  from: V3,
  yaw: number,
  pitch: number,
  back: number,
  len: number,
  r: number,
  R: RGBA[],
  id: number,
): V3 {
  const dx = Math.cos(yaw) * Math.cos(pitch);
  const dy = Math.sin(yaw) * Math.cos(pitch);
  const dz = Math.sin(pitch);
  const n = Math.max(3, Math.round((len + back) / 1.4));
  for (let i = 0; i <= n; i++) {
    const t = -back + ((len + back) * i) / n;
    parts.push({
      x: from[0] + dx * t,
      y: from[1] + dy * t,
      z: from[2] + dz * t,
      rx: r,
      ry: r,
      rz: r,
      ramp: R,
      id,
    });
  }
  return [from[0] + dx * len, from[1] + dy * len, from[2] + dz * len];
}

// ---- Вмёрзший воин --------------------------------------------------------

const W_SKIN = ramp('#1a2a44', '#2c4468', '#466690', '#6a8cb4', '#9ab8d8');
const W_IRON = ramp('#14161c', '#2a2e38', '#464c58', '#6a7280', '#9aa2ae');
const W_CLOAK = ramp('#1c120c', '#34221a', '#523828', '#74523a', '#9a7454');
const CV_WAR: Canvas = { w: 48, h: 50, ox: 24, oy: 40 };

interface WarO {
  body: Body;
  axeYaw: number;
  axePitch: number;
  block: number;
  shards: number;
  frost: number;
}

function warriorBuild(look: MobPose['look'], o: WarO): Build {
  const parts: Part[] = [];
  const d: Dress = {
    skin: lookRamp(W_SKIN, look),
    torso: lookRamp(W_IRON, look),
    legs: lookRamp(W_CLOAK, look),
    arms: lookRamp(W_SKIN, look),
  };
  const j = humanoid(parts, o.body, d);
  const s = o.body.s;
  // Шлем с рогами.
  parts.push({
    x: j.head[0],
    y: 0,
    z: j.head[2] + 1.2 * s,
    rx: 2.6 * s,
    ry: 2.6 * s,
    rz: 1.8 * s,
    ramp: d.torso,
    id: 90,
  });
  for (const e of [-1, 1]) {
    const horn = bez(
      [j.head[0], e * 2.2 * s, j.head[2] + 1.6 * s],
      [j.head[0] + 0.5, e * 4.2 * s, j.head[2] + 2.4 * s],
      [j.head[0] + 1.4, e * 4.6 * s, j.head[2] + 4.6 * s],
      3,
    );
    horn.forEach((pt, i) =>
      parts.push({
        x: pt[0],
        y: pt[1],
        z: pt[2],
        rx: 0.9 - i * 0.15,
        ry: 0.9 - i * 0.15,
        rz: 0.9 - i * 0.15,
        ramp: BONE,
        id: 91 + e,
      }),
    );
  }
  // Плащ из шкуры на плечах.
  parts.push({
    x: j.chest[0] - 2 * s,
    y: 0,
    z: j.chest[2] - 1,
    rx: 2 * s,
    ry: 4.4 * s,
    rz: 4 * s,
    ramp: d.legs,
    fur: 0.25,
    id: 93,
  });
  // Секира в правой руке.
  const tip = haft(parts, j.handR, o.axeYaw, o.axePitch, 2.5 * s, 9 * s, 0.7 * s, WOOD, 94);
  const bx = Math.cos(o.axeYaw);
  const by = Math.sin(o.axeYaw);
  parts.push({
    x: tip[0] - bx * 1.2,
    y: tip[1] - by * 1.2,
    z: tip[2],
    rx: 1.1 * s,
    ry: 3 * s,
    rz: 2.6 * s,
    yaw: o.axeYaw,
    pitch: o.axePitch,
    ramp: ICE,
    gloss: true,
    id: 95,
  });
  if (o.block > 0) {
    // Глыба льда вокруг (прозрачная), чем меньше — тем больше трещин.
    parts.push({
      x: 0.5,
      y: 0,
      z: 10 * s,
      rx: 6.5 * s,
      ry: 7.2 * s,
      rz: 12 * s * o.block,
      ramp: ICE,
      alpha: 0.42,
      gloss: true,
      id: 96,
    });
  }
  if (o.shards > 0)
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU + 0.3;
      const r = 5 + o.shards * 9;
      const z = 6 + (k % 3) * 5 + Math.sin(o.shards * Math.PI) * 6 - o.shards * o.shards * 8;
      if (z < 0.5) continue;
      parts.push({
        x: Math.cos(a) * r,
        y: Math.sin(a) * r,
        z,
        rx: 1.8,
        ry: 1.2,
        rz: 1.5,
        yaw: a,
        ramp: ICE,
        gloss: true,
        id: 97 + k,
      });
    }
  return {
    parts,
    eyes: [
      { x: j.head[0] + 2, y: -0.9 * s, z: j.head[2] + 0.2, c: hx('#8ad8ff') },
      { x: j.head[0] + 2, y: 0.9 * s, z: j.head[2] + 0.2, c: hx('#8ad8ff') },
    ],
    post:
      o.frost > 0
        ? (p, scr) => {
            // Иней на плечах и шлеме.
            for (let k = 0; k < 6; k++) {
              const [x, y] = scr(
                j.chest[0] + (k % 3) - 1,
                (k - 2.5) * 1.4,
                j.chest[2] + 2.4 + (k % 2),
              );
              p.set(x, y, alpha(WHITE, 0.85));
            }
          }
        : undefined,
  };
}

/** Позы воина. Кисти — в осях модели от земли (x вперёд, y вбок, z вверх). */
function warPose(m: Mob, pose: MobPose): { o: WarO; key: string; ex: Partial<MobFrame> } {
  const mode = pose.mode;
  const prev = prevMode(m);
  const moving = speedOf(m) > 0.3;
  const base: WarO = {
    body: { ...BODY0, handR: [3, 4.5, 10], handL: [2, -4.2, 9] },
    axeYaw: 0.2,
    axePitch: 1.0,
    block: 0,
    shards: 0,
    frost: 1,
  };
  const ex: Partial<MobFrame> = { shadow: 7 };
  let o = base;
  let key = '';
  const hits = m.data.hits ?? 0;
  if (mode === 'f12_frozen') {
    // В глыбе — боевая стойка, секира над плечом; трещины по числу ударов.
    o = {
      ...base,
      body: { ...base.body, wide: 1, lean: 0.15, handR: [0, 4.5, 17], handL: [3.5, -3, 11] },
      axeYaw: Math.PI,
      axePitch: 0.9,
      block: 1 - Math.min(2, hits) * 0.08,
    };
    key = `frozen${Math.min(2, hits)}`;
    ex.still = true;
  } else if (mode === 'f12_thaw') {
    const k = Math.min(1, pose.t / 1.1);
    const sh = k24(pose.t) % 2 ? 0.5 : -0.5;
    o = {
      ...base,
      body: {
        ...base.body,
        wide: 1,
        lean: 0.15 - k * 0.1,
        handR: [0, 4.5, 17 - k * 6],
        handL: [3.5, -3, 11],
      },
      axeYaw: Math.PI * (1 - k * 0.8),
      axePitch: 0.9,
      shards: k,
    };
    key = `thaw${Math.round(k * 14)}`;
    ex.dx = k < 0.5 ? sh : 0;
    ex.still = true;
  } else if (mode === 'dying') {
    const k = Math.min(1, pose.t / 0.9);
    o = {
      ...base,
      body: {
        ...base.body,
        kneel: Math.min(1, k * 2),
        lean: k * 0.9,
        handR: [4, 4, 3],
        handL: [3, -4, 3],
      },
      axeYaw: 0.3,
      axePitch: -0.2,
      shards: k > 0.6 ? (k - 0.6) * 2.5 : 0,
    };
    key = `die${Math.round(k * 10)}`;
    ex.linger = 0.9;
    ex.alpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
  } else if (mode === 'f12_wind') {
    // Замах: секира уходит за голову, корпус назад, вес на заднюю ногу.
    const k = ease(Math.min(1, pose.t / 0.75));
    o = {
      ...base,
      body: {
        ...base.body,
        wide: 0.6,
        lean: -0.25 * k,
        twist: -0.4 * k,
        handR: [lerp(3, -1.5, k), lerp(4.5, 3, k), lerp(10, 21, k)],
        handL: [lerp(2, 0, k), -3.5, lerp(9, 19, k)],
      },
      axeYaw: lerp(0.2, Math.PI, k),
      axePitch: lerp(1, 0.6, k),
    };
    key = `wind${Math.round(k * 12)}`;
    ex.still = true;
  } else if (
    (mode === 'recover' && prev === 'f12_wind' && pose.t < 0.28) ||
    (mode === 'recover' && prev === 'f12_slam' && pose.t < 0.36)
  ) {
    // Контакт: секира внизу перед собой; у удара сверху — лезвие во льду.
    const slam = prev === 'f12_slam';
    const k = Math.min(1, pose.t / (slam ? 0.36 : 0.28));
    o = {
      ...base,
      body: {
        ...base.body,
        wide: 0.8,
        lean: 0.5 - k * 0.3,
        crouch: slam ? 2 : 1,
        twist: slam ? 0 : 0.35,
        handR: [6, slam ? 1.5 : 2.5, slam ? 4 : 6],
        handL: [5.5, slam ? -1 : -2.5, slam ? 4.5 : 7],
      },
      axeYaw: slam ? 0 : -0.5,
      axePitch: slam ? -0.9 : -0.35,
    };
    key = `hit${slam ? 's' : 'w'}${Math.round(k * 6)}`;
    ex.still = true;
  } else if (mode === 'f12_slam') {
    // Двумя руками над головой, подпрыгнул — и вниз в такт удару.
    const k = Math.min(1, pose.t / 0.95);
    const up = k < 0.75 ? ease(k / 0.75) : 1 - (k - 0.75) / 0.25;
    o = {
      ...base,
      body: {
        ...base.body,
        wide: 0.8,
        lean: -0.2 * up + (k > 0.75 ? 0.6 * (k - 0.75) * 4 : 0),
        up: up * 2.5,
        handR: [lerp(3, 0, up), 1.5, lerp(10, 22, up)],
        handL: [lerp(2, 0, up), -1, lerp(9, 22, up)],
      },
      axeYaw: lerp(0.2, Math.PI, up),
      axePitch: lerp(0.4, 0.5, up),
    };
    key = `slam${Math.round(k * 14)}`;
    ex.still = true;
  } else if (mode === 'stun' || pose.anim === 'hurt') {
    o = {
      ...base,
      body: { ...base.body, lean: -0.3, handR: [1, 5, 8], handL: [0, -5, 8] },
      axeYaw: 0.6,
      axePitch: 0.4,
    };
    key = 'hurt';
  } else if (moving) {
    const f = runFrame(pose, m, 1.4);
    const sw = Math.sin((f / 8) * TAU);
    o = {
      ...base,
      body: {
        ...base.body,
        step: f / 8,
        stride: 2.4,
        lean: 0.15,
        handR: [3 - sw * 1.5, 4.5, 10],
        handL: [2 + sw * 1.5, -4.2, 9],
      },
    };
    key = `run${f}`;
  } else {
    const f = Math.floor(pose.now * 1.6 + m.id) % 4;
    o = { ...base, body: { ...base.body, wide: 0.4, crouch: f === 2 ? 0.4 : 0 } };
    key = `idle${f}`;
  }
  return { o, key: `${pose.look}|${key}`, ex };
}

regMob('f12_warrior', (m, pose) => {
  const { o, key, ex } = warPose(m, pose);
  const c = rigCached('f12_warrior', key, m.face, CV_WAR, pose.flash, () =>
    warriorBuild(pose.look, o),
  );
  return mobFrame(c, CV_WAR, ex);
});

// ---- Хранитель льда --------------------------------------------------------

const K_ROBE = ramp('#0a1222', '#16223a', '#243656', '#384e76', '#546c96');
const K_MASK = ramp('#5a5448', '#8a8270', '#bab096', '#ddd4b8', '#fbf4dc');
const CV_KEEP: Canvas = { w: 48, h: 54, ox: 24, oy: 44 };

function keeperBuild(
  look: MobPose['look'],
  o: {
    body: Body;
    staffYaw: number;
    staffPitch: number;
    glow: number;
    shield: number;
    spin: number;
    summon: number;
  },
): Build {
  const parts: Part[] = [];
  const robe = lookRamp(K_ROBE, look);
  const d: Dress = { skin: K_MASK, torso: robe, legs: robe, arms: robe, robe };
  const j = humanoid(parts, o.body, d);
  // Капюшон и маска с рогами-кристаллами.
  parts.push({
    x: j.head[0] - 0.6,
    y: 0,
    z: j.head[2] + 0.6,
    rx: 3,
    ry: 3,
    rz: 3.2,
    ramp: robe,
    id: 100,
  });
  parts.push({
    x: j.head[0] + 1.4,
    y: 0,
    z: j.head[2],
    rx: 1.4,
    ry: 2,
    rz: 2.3,
    ramp: K_MASK,
    id: 101,
  });
  for (const e of [-1, 1])
    crystalPart(
      parts,
      [j.head[0] - 0.5, e * 1.8, j.head[2] + 2.8],
      0.2,
      e * 0.5,
      3.2,
      TEAL,
      102 + e,
    );
  // Посох с зелёным кристаллом сияния.
  const tip = haft(parts, j.handR, o.staffYaw, o.staffPitch, 7, 7, 0.6, BONE, 105);
  parts.push({
    x: tip[0],
    y: tip[1],
    z: tip[2] + 1.2,
    rx: 1.4 + o.glow * 0.6,
    ry: 1.4 + o.glow * 0.6,
    rz: 2.4 + o.glow,
    ramp: AURORA,
    glow: true,
    gloss: true,
    id: 106,
  });
  // Щит: осколки льда кружат вокруг, пока хранитель холодный.
  if (o.shield > 0)
    for (let k = 0; k < 6; k++) {
      const a = o.spin + (k / 6) * TAU;
      parts.push({
        x: Math.cos(a) * 7,
        y: Math.sin(a) * 7,
        z: 9 + Math.sin(a * 2) * 2,
        rx: 1.5,
        ry: 0.8,
        rz: 2.4,
        yaw: a,
        ramp: ICE,
        gloss: true,
        alpha: 0.75,
        glow: true,
        id: 110 + k,
      });
    }
  return {
    parts,
    eyes: [
      { x: j.head[0] + 2.6, y: -0.8, z: j.head[2] + 0.3, c: hx('#6cff9a') },
      { x: j.head[0] + 2.6, y: 0.8, z: j.head[2] + 0.3, c: hx('#6cff9a') },
    ],
    post:
      o.summon > 0
        ? (p, scr) => {
            // Вихрь сияния вокруг поднятых рук.
            for (let k = 0; k < 10; k++) {
              const a = o.summon * 9 + (k / 10) * TAU;
              const [x, y] = scr(
                Math.cos(a) * (4 + k * 0.4),
                Math.sin(a) * (4 + k * 0.4),
                14 + k * 0.8,
              );
              p.set(x, y, k % 2 ? AURORA[3] : TEAL[3]);
            }
          }
        : undefined,
  };
}

/** Кристалл-рог из трёх шаров. */
function crystalPart(
  parts: Part[],
  at: V3,
  yaw: number,
  roll: number,
  len: number,
  R: RGBA[],
  id: number,
): void {
  for (let i = 0; i < 3; i++) {
    const r = 0.9 - i * 0.22;
    parts.push({
      x: at[0],
      y: at[1] + Math.sin(roll) * i * len * 0.3,
      z: at[2] + i * len * 0.33,
      rx: r,
      ry: r,
      rz: r * 1.4,
      ramp: R,
      gloss: true,
      glow: true,
      yaw,
      id,
    });
  }
}

regMob('f12_keeper', (m, pose) => {
  const mode = pose.mode;
  const prev = prevMode(m);
  const sim = paintSim();
  const st = f12State(sim);
  const warm = !!st?.braziers.some(
    (o) => st.lit.has(o.id) && Math.hypot(o.x + 0.5 - m.x, o.y + 0.5 - m.y) < 3.2,
  );
  const casting = mode === 'f12_wind' || mode === 'f12_summon';
  const shield = !(warm || (m.data.spent ?? 0) > 0 || casting) && mode !== 'dying';
  const sp = Math.floor(pose.now * 6) % 6;
  const float = Math.round(Math.sin(pose.now * 2 + m.id) * 2) / 2;
  const base = {
    body: { ...BODY0, up: 1.5 + float, handR: [3, 4, 10] as V3, handL: [2.5, -3.5, 10] as V3 },
    staffYaw: 0,
    staffPitch: 1.45,
    glow: 0,
    shield: shield ? 1 : 0,
    spin: (sp / 6) * (TAU / 6),
    summon: 0,
  };
  let o = base;
  let key = '';
  const ex: Partial<MobFrame> = { shadow: 6, still: true };
  if (mode === 'dying') {
    const k = Math.min(1, pose.t / 0.8);
    o = {
      ...base,
      body: { ...base.body, kneel: k, lean: k * 0.6, up: 0 },
      staffPitch: 1.45 - k * 1.3,
      shield: 0,
    };
    key = `die${Math.round(k * 8)}`;
    ex.linger = 0.8;
    ex.alpha = 1 - k * 0.8;
  } else if (mode === 'f12_wind') {
    // Посох вверх, кристалл разгорается — и вперёд, к герою.
    const k = Math.min(1, pose.t / 0.85);
    const up = ease(Math.min(1, k / 0.7));
    const thrust = k > 0.8 ? (k - 0.8) / 0.2 : 0;
    o = {
      ...base,
      body: {
        ...base.body,
        lean: -0.2 * up + thrust * 0.4,
        handR: [lerp(3, 1, up) + thrust * 4, lerp(4, 2.5, up), lerp(10, 20, up) - thrust * 6],
        handL: [3, -3.5, 12 + up * 2],
      },
      staffPitch: lerp(1.45, 1.55, up) - thrust * 1.1,
      glow: up,
    };
    key = `cast${Math.round(k * 12)}`;
  } else if (mode === 'recover' && prev === 'f12_wind' && pose.t < 0.25) {
    o = {
      ...base,
      body: { ...base.body, lean: 0.35, handR: [7, 2.5, 13], handL: [3, -3.5, 12] },
      staffPitch: 0.4,
      glow: 1 - pose.t * 4,
    };
    key = `thrust${k24(pose.t, 6)}`;
  } else if (mode === 'f12_summon') {
    const k = Math.min(1, pose.t / 1);
    o = {
      ...base,
      body: { ...base.body, lean: -0.15, handR: [1, 4.5, 19], handL: [1, -4.5, 19] },
      staffPitch: 1.5,
      glow: 0.6,
      summon: k,
    };
    key = `summon${Math.round(k * 12)}`;
  } else if (mode === 'stun' || pose.anim === 'hurt') {
    o = { ...base, body: { ...base.body, lean: -0.3 } };
    key = 'hurt';
  } else {
    const moving = speedOf(m) > 0.3;
    o = { ...base, body: { ...base.body, lean: moving ? 0.15 : 0 } };
    key = `idle${moving ? 'm' : ''}`;
  }
  const c = rigCached(
    'f12_keeper',
    `${pose.look}|${key}|${o.shield}|${sp}|${float}`,
    m.face,
    CV_KEEP,
    pose.flash,
    () => keeperBuild(pose.look, o),
  );
  return mobFrame(c, CV_KEEP, ex);
});

// ---- Снежный голем ----------------------------------------------------------

const G_SNOW = ramp('#3a4c72', '#5a7098', '#8098c0', '#aec2e0', '#dce8f6');
const CV_GOL: Canvas = { w: 60, h: 60, ox: 30, oy: 48 };

interface GolO {
  lean: number;
  roll: number;
  fistR: V3;
  fistL: V3;
  legLift: number;
  squash: number;
  crumble: number;
  step: number;
  moving: boolean;
}

function golemBuild(look: MobPose['look'], o: GolO): Build {
  const parts: Part[] = [];
  const S = lookRamp(G_SNOW, look);
  const I = look === 'elite' ? lookRamp(TEAL, look) : ICE;
  const cr = o.crumble;
  const drop = (z: number, k: number) => Math.max(1.5, z - cr * cr * z * (0.6 + k * 0.1));
  const sp = (x: number, k: number) => x * (1 + cr * (0.4 + (k % 3) * 0.2));
  // Ноги — тумбы.
  for (const e of [-1, 1]) {
    const ph = (o.step + (e > 0 ? 0.5 : 0)) * TAU;
    const fx = o.moving ? Math.sin(ph) * 2.2 : 0;
    const lift = (e > 0 ? o.legLift : 0) + (o.moving ? Math.max(0, Math.cos(ph)) * 1.4 : 0);
    parts.push({
      x: sp(fx, 1),
      y: sp(e * 4, 2),
      z: drop(3 + lift, 1),
      rx: 3.4,
      ry: 3.2,
      rz: 3.4,
      ramp: S,
      id: 130 + e,
    });
  }
  // Туловище: нижний ком и грудь, наклон вперёд.
  const sq = 1 - o.squash * 0.15;
  parts.push({
    x: sp(0, 3),
    y: 0,
    z: drop(9 * sq, 3),
    rx: 6.4,
    ry: 7,
    rz: 5.4 * sq,
    ramp: S,
    roll: o.roll,
    fur: 0.08,
    id: 133,
  });
  const cx = Math.sin(o.lean) * 7;
  const cz = 9 * sq + Math.cos(o.lean) * 7.5;
  parts.push({
    x: sp(cx, 4),
    y: 0,
    z: drop(cz, 4),
    rx: 6,
    ry: 7.6,
    rz: 5.4,
    ramp: S,
    pitch: -o.lean,
    roll: o.roll,
    fur: 0.08,
    id: 134,
  });
  // Слабое место: ядро-кристалл на спине (видно, когда голем спиной).
  parts.push({
    x: sp(cx - 5.4, 5),
    y: 0,
    z: drop(cz + 0.6, 5),
    rx: 1.6,
    ry: 2.4,
    rz: 2.8,
    ramp: TEAL,
    glow: true,
    gloss: true,
    id: 135,
  });
  // Ледяные глыбы на плечах.
  for (const e of [-1, 1])
    parts.push({
      x: sp(cx - 0.5, 6),
      y: sp(e * 6.4, 6),
      z: drop(cz + 3.4, 6),
      rx: 2.6,
      ry: 2.2,
      rz: 2.4,
      yaw: e * 0.6,
      ramp: I,
      gloss: true,
      id: 136 + e,
    });
  // Голова маленькая, вдавлена в плечи.
  const hx2 = cx + Math.sin(o.lean) * 5 + 1.5;
  const hz = cz + Math.cos(o.lean) * 4.6;
  parts.push({ x: sp(hx2, 7), y: 0, z: drop(hz, 7), rx: 3, ry: 3.2, rz: 2.8, ramp: S, id: 139 });
  // Руки: плечо → кулак (огромный).
  for (const e of [-1, 1]) {
    const sh: V3 = [cx, e * 7.4, cz + 2];
    const f = e > 0 ? o.fistR : o.fistL;
    const el: V3 = [(sh[0] + f[0]) / 2 - 1, (sh[1] + f[1]) / 2 + e * 1.5, (sh[2] + f[2]) / 2];
    bez(sh, el, f, 3).forEach((pt, i) =>
      parts.push({
        x: sp(pt[0], 8 + i),
        y: sp(pt[1], 8),
        z: drop(pt[2], 8 + i),
        rx: 2.2 + i * 0.25,
        ry: 2.2 + i * 0.25,
        rz: 2.2 + i * 0.25,
        ramp: S,
        id: 140 + e,
      }),
    );
    parts.push({
      x: sp(f[0], 9),
      y: sp(f[1], 9),
      z: drop(f[2], 9),
      rx: 3.4,
      ry: 3.4,
      rz: 3.2,
      ramp: I,
      gloss: true,
      id: 142 + e,
    });
  }
  return {
    parts,
    eyes:
      cr > 0.5
        ? []
        : [
            { x: hx2 + 2.6, y: -1.2, z: hz + 0.5, c: hx('#6cf0ff') },
            { x: hx2 + 2.6, y: 1.2, z: hz + 0.5, c: hx('#6cf0ff') },
          ],
  };
}

const GOL0: GolO = {
  lean: 0.2,
  roll: 0,
  fistR: [4, 8, 6],
  fistL: [4, -8, 6],
  legLift: 0,
  squash: 0,
  crumble: 0,
  step: 0,
  moving: false,
};

regMob('f12_golem', (m, pose) => {
  const mode = pose.mode;
  const prev = prevMode(m);
  let o = GOL0;
  let key = '';
  const ex: Partial<MobFrame> = { shadow: 11 };
  if (mode === 'dying') {
    const k = Math.min(1, pose.t / 1.1);
    o = { ...GOL0, crumble: ease(k) };
    key = `die${Math.round(k * 12)}`;
    ex.linger = 1.1;
    ex.alpha = k > 0.75 ? 1 - (k - 0.75) * 4 : 1;
  } else if (mode === 'f12_wind') {
    // Кулак над головой, корпус назад.
    const k = ease(Math.min(1, pose.t / 0.9));
    o = {
      ...GOL0,
      lean: lerp(0.2, -0.25, k),
      fistR: [lerp(4, -1, k), lerp(8, 5, k), lerp(6, 27, k)],
    };
    key = `wind${Math.round(k * 12)}`;
    ex.still = true;
  } else if (mode === 'recover' && prev === 'f12_wind' && pose.t < 0.3) {
    // Контакт: кулак в снегу перед собой.
    o = { ...GOL0, lean: 0.75, fistR: [12, 3, 2.5], squash: 0.4 };
    key = `punch${k24(pose.t, 7)}`;
    ex.still = true;
  } else if (mode === 'f12_stomp') {
    const k = Math.min(1, pose.t / 1.15);
    const up = k < 0.8 ? ease(k / 0.8) : 1 - (k - 0.8) / 0.2;
    o = {
      ...GOL0,
      lean: -0.1 * up,
      legLift: up * 7,
      fistR: [2, 9, 6 + up * 10],
      fistL: [2, -9, 6 + up * 10],
      roll: -up * 0.12,
    };
    key = `stomp${Math.round(k * 14)}`;
    ex.still = true;
  } else if (mode === 'recover' && prev === 'f12_stomp' && pose.t < 0.3) {
    o = { ...GOL0, squash: 1 - pose.t * 3, fistR: [3, 9, 4], fistL: [3, -9, 4] };
    key = `land${k24(pose.t, 7)}`;
    ex.sy = 0.92;
    ex.sx = 1.06;
    ex.still = true;
  } else if (mode === 'stun' || pose.anim === 'hurt') {
    o = { ...GOL0, lean: -0.1, roll: 0.1 };
    key = 'hurt';
  } else if (speedOf(m) > 0.3) {
    const f = runFrame(pose, m, 0.9);
    o = {
      ...GOL0,
      moving: true,
      step: f / 8,
      roll: Math.sin((f / 8) * TAU) * 0.07,
      fistR: [4 - Math.sin((f / 8) * TAU) * 2, 8, 6],
      fistL: [4 + Math.sin((f / 8) * TAU) * 2, -8, 6],
    };
    key = `run${f}`;
  } else {
    const f = Math.floor(pose.now * 1.2 + m.id) % 2;
    o = { ...GOL0, squash: f * 0.1 };
    key = `idle${f}`;
  }
  const c = rigCached('f12_golem', `${pose.look}|${key}`, m.face, CV_GOL, pose.flash, () =>
    golemBuild(pose.look, o),
  );
  return mobFrame(c, CV_GOL, ex);
});

// ---------------------------------------------------------------------------
// Ледниковый мамонт с шаманкой сияния (анимации 12 — стандарт v2.85).
//
// Тот же риг из эллипсоидов, что у зверей этажа, но поза — из полусотни
// чисел (`MamO`, `ShO`), а кадр техники — от времени режима мозга по ключам
// с кривыми (`kf`): подготовка медленная, удар — разгоном, проводка —
// торможением; кадр контакта = кадр урона мозга. Запаздывающие части (хобот,
// шерсть, уши, наездница, ленты) — те же ключи со сдвигом времени. Шаг — по
// пройденному пути: стопа в опоре стоит на льду, переступ на развороте
// идёт вбок. Боком не ходит: 16 сторон, тело всегда по `m.face`.
//
// Цена кадра. Новый кадр мамонта с наездницей (~190 частей) — 1,4–1,8 мс
// на стенде (минимум по проходам). Техника 24 к/с при 60–100 к/с игры —
// новый рисунок раз в 2–4 кадра игры, и p95 кадра боя был ценой этого
// рисунка. Поэтому следующий кадр рисуется заранее по кусочку
// (`mamAhead`, `rigTask` в своих буферах), пока игра показывает текущий.
// Ключ кадра обязан покрывать картинку: ленты наездницы в техниках — от
// времени режима, а не от часов рендера, иначе кадр «на потом» отличался
// бы от нарисованного сразу.
// ---------------------------------------------------------------------------

/** Ключ позы: [время, значение, подход — i разгон, o торможение, l ровно, иначе плавно]. */
type Key = [number, number, string?];
function kf(t: number, keys: Key[]): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const k = keys[i];
    if (t < k[0]) {
      const p = keys[i - 1];
      const u = (t - p[0]) / (k[0] - p[0]);
      const e = k[2];
      const w =
        e === 'i' ? u * u * u : e === 'o' ? 1 - (1 - u) ** 3 : e === 'l' ? u : u * u * (3 - 2 * u);
      return p[1] + (k[1] - p[1]) * w;
    }
  }
  return keys[keys.length - 1][1];
}
/** Горб 0 → 1 → 0 на отрезке [a, b]. */
const bump = (t: number, a: number, b: number) =>
  t <= a || t >= b ? 0 : Math.sin(((t - a) / (b - a)) * Math.PI);
const lerp3 = (a: V3, b: V3, k: number): V3 => [
  lerp(a[0], b[0], k),
  lerp(a[1], b[1], k),
  lerp(a[2], b[2], k),
];
function bezQ(a: V3, b: V3, c: V3, u: number): V3 {
  const v = 1 - u;
  return [
    v * v * a[0] + 2 * u * v * b[0] + u * u * c[0],
    v * v * a[1] + 2 * u * v * b[1] + u * u * c[1],
    v * v * a[2] + 2 * u * v * b[2] + u * u * c[2],
  ];
}
/** Колотушка по ударам `hits`: занос (−1) за 0,22 с, удар разгоном, контакт (1) ровно в ударе, отскок. */
function beatAt(t: number, hits: number[]): number {
  for (const h of hits) {
    if (t >= h - 0.22 && t < h - 0.07) return -ease((t - (h - 0.22)) / 0.15);
    if (t >= h - 0.07 && t < h) return -1 + 2 * ((t - (h - 0.07)) / 0.07) ** 2;
    if (t >= h && t < h + 0.14) return 1 - ease((t - h) / 0.14);
  }
  return 0;
}

const FROST_R = ramp('#2c3a56', '#4c6080', '#7890b0', '#a8c0dc', '#e2eefa');
/** Иней на шерсти: тон к тону (светотень остаётся), светлые седеют сильнее. */
function frostRamp(r: RGBA[], k: number): RGBA[] {
  if (k <= 0) return r;
  return r.map((c, i) => mixc(c, FROST_R[i], Math.min(0.88, k * (0.45 + i * 0.12))));
}

const RIM_C = hx('#a9c8f2');
/** Свет луны по кромке сверху-слева: тёмный силуэт не тонет в ночном полу. */
function rimLight(p: Px, c: RGBA, k: number): void {
  const { w, h, data } = p;
  const dark = (i: number) =>
    data[i + 3] === 0 || (data[i] === INK[0] && data[i + 1] === INK[1] && data[i + 2] === INK[2]);
  const hits: number[] = [];
  for (let y = 1; y < h; y++)
    for (let x = 1; x < w; x++) {
      const i = (y * w + x) * 4;
      if (data[i + 3] < 255 || dark(i)) continue;
      const up = dark(i - w * 4);
      const lf = dark(i - 4);
      if (up || lf) hits.push(i, up ? (lf ? 1 : 0.8) : 0.45);
    }
  for (let j = 0; j < hits.length; j += 2) {
    const i = hits[j];
    const a = hits[j + 1] * k;
    data[i] += (c[0] - data[i]) * a;
    data[i + 1] += (c[1] - data[i + 1]) * a;
    data[i + 2] += (c[2] - data[i + 2]) * a;
  }
}

/** Треугольник в маску следа (максимум доли), за телом — не рисуется. */
function fillTri(
  mask: Float32Array,
  w: number,
  h: number,
  a: number[],
  b: number[],
  c: number[],
  v: number,
  fx: PostFx,
  zt: number,
): void {
  const d = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (Math.abs(d) < 1e-3) return;
  const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
  const x1 = Math.min(w - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
  const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
  const y1 = Math.min(h - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const w0 = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / d;
      const w1 = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / d;
      if (w0 < -0.02 || w1 < -0.02 || 1 - w0 - w1 < -0.02) continue;
      if (fx.z(x, y) > zt + 3) continue;
      const i = y * w + x;
      if (mask[i] < v) mask[i] = v;
    }
}

// ---- Шаманка сияния ----------------------------------------------------------
// Наездница мамонта и (в фазе 3) летунья под сводом — одна модель: парка с
// меховой опушкой, капюшон, оленьи рога, бубен в левой, колотушка в правой,
// две ленты сияния от плеч (светятся поверх темноты). На спине мамонта и в
// небе она одна и та же — и одного размера.

const SH_PARKA = ramp('#2e0a14', '#5a1222', '#8a2230', '#bc3e3a', '#e8785a');
const SH_FACE = ramp('#5a3a2a', '#86563c', '#b07a56', '#d4a07a', '#f0c8a0');
const SH_TRIM = ramp('#5a5e6e', '#8a90a2', '#b8bece', '#dde2ec', '#ffffff');
const SH_LEG = ramp('#160a10', '#2a121c', '#44202a', '#62323a', '#84504e');
const RIB_V = ramp('#3a1a6a', '#5a2ea0', '#8a5ad8', '#b89aff', '#eee0ff');
const SH_EYE = hx('#6cff9a');
/** Масштаб наездницы и летуньи — как у мамонта: спрыгнув, она не уменьшается. */
const SH_SC = 1.3;
/** Рост фигуры шаманки в модели (до масштаба `SH_SC`). */
const SH_S = 1;
const CV_SHA: Canvas = { w: 76, h: 92, ox: 38, oy: 70 };
const SH_HIGH = 30;

interface ShO {
  body: Body;
  /** Бубен: 0 у груди … 1 над головой. */
  drum: number;
  /** Колотушка: −1 занесена, 0 у груди, 1 удар в бубен. */
  beat: number;
  /** Сила сияния лент 0…2. */
  aurora: number;
  /** Ленты: фаза волны, размах, подъём (−1 висят … 2 вверх), длина 0…1. */
  rib: number;
  ribA: number;
  ribUp: number;
  ribLen: number;
  /** Подол парки снесён назад (полёт) 0…1. */
  hem: number;
}

/** Кисти по бубну и колотушке (оси фигуры до масштаба). */
function shHands(drum: number, beat: number): { L: V3; R: V3 } {
  const L = lerp3([3.6, -3.4, 11], [2.4, -3, 17.5], drum);
  const rest = lerp3([3.4, 3.6, 10], [2.6, 3.6, 15.5], drum);
  const up = lerp3([-0.8, 4.6, 16.5], [-1, 4.4, 21.5], drum);
  const hit: V3 = [L[0] + 1.4, L[1] + 3.4, L[2] + 0.4];
  return { L, R: beat < 0 ? lerp3(rest, up, -beat) : lerp3(rest, hit, beat) };
}

/** Середина бубна в осях фигуры (с масштабом фигуры) — та же точка, что рисуется. */
function shDrumLocal(o: ShO): V3 {
  const b = o.body;
  const s = b.s;
  return [
    b.handL[0] * s + 0.9 * s,
    b.handL[1] * s + 1.1 * s,
    b.handL[2] * s + b.up - b.crouch + 0.2 * s,
  ];
}

/** Наклон вектора фигуры вперёд (как корпус `humanoid`). */
function tiltV(v: V3, a: number): V3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [v[0] * c + v[2] * s, v[1], v[2] * c - v[0] * s];
}

function shamanParts(
  parts: Part[],
  o: ShO,
  look: MobPose['look'],
  place: (p: V3) => V3,
  pitch = 0,
  roll = 0,
): { head: V3; drum: V3; eyes: Eye[] } {
  const sub: Part[] = [];
  const b = o.body;
  const s = b.s;
  const park = lookRamp(SH_PARKA, look);
  const j = humanoid(sub, b, { skin: SH_FACE, torso: park, legs: SH_LEG, arms: park });
  const hd = j.head;
  const at = (v: V3): V3 => {
    const t = tiltV(v, b.lean);
    return [hd[0] + t[0] * s, hd[1] + t[1] * s, hd[2] + t[2] * s];
  };
  // Капюшон, лицо и меховая опушка кольцом вокруг лица.
  const hood = at([-0.6, 0, 0.4]);
  sub.push({
    x: hood[0],
    y: 0,
    z: hood[2],
    rx: 2.9 * s,
    ry: 3 * s,
    rz: 3.1 * s,
    ramp: park,
    fur: 0.25,
    pitch: -b.lean,
    id: 120,
  });
  const face = at([1.5, 0, -0.2]);
  sub.push({
    x: face[0],
    y: 0,
    z: face[2],
    rx: 1.4 * s,
    ry: 1.9 * s,
    rz: 2.1 * s,
    ramp: SH_FACE,
    pitch: -b.lean,
    id: 121,
  });
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU;
    const c = at([1.5, Math.cos(a) * 2.5, Math.sin(a) * 2.7 + 0.1]);
    sub.push({
      x: c[0],
      y: c[1],
      z: c[2],
      rx: 1.05 * s,
      ry: 1.05 * s,
      rz: 1.05 * s,
      ramp: SH_TRIM,
      fur: 0.3,
      id: 122,
    });
  }
  // Оленьи рога над капюшоном.
  // Рога назад-в стороны дугой, с отростком вперёд-вверх: сбоку — серп,
  // спереди — «рогатка» (прямые рога сбоку читались восклицательным знаком).
  for (const e of [-1, 1]) {
    const ant = bez(
      at([-0.6, e * 1.6, 2.2]),
      at([-3.6, e * 4.6, 3.8]),
      at([-5.8, e * 5.4, 7.2]),
      5,
    );
    ant.forEach((pt, i) => {
      const r = (0.75 - i * 0.06) * s;
      sub.push({ x: pt[0], y: pt[1], z: pt[2], rx: r, ry: r, rz: r, ramp: BONE, id: 123 });
    });
    for (const u of [0, 0.5, 1]) {
      const tp = lerp3(at([-2.7, e * 3.9, 4.4]), at([-1.6, e * 4.3, 6.8]), u);
      sub.push({
        x: tp[0],
        y: tp[1],
        z: tp[2],
        rx: 0.55 * s,
        ry: 0.55 * s,
        rz: 0.55 * s,
        ramp: BONE,
        id: 123,
      });
    }
  }
  // Подол парки с опушкой: в полёте сносит назад.
  const hipZ = (9 - b.crouch - b.kneel * 4.5) * s + b.up;
  for (const [dz, r, rp] of [
    [-1.3, 3.3, park],
    [-2.9, 3.6, SH_TRIM],
  ] as const)
    sub.push({
      x: -o.hem * (dz < -2 ? 2.6 : 1.4) * s,
      y: 0,
      z: hipZ + (dz + o.hem * (dz < -2 ? 1.8 : 0.8)) * s,
      rx: r * s,
      ry: r * 1.05 * s,
      rz: 1.5 * s,
      ramp: rp,
      fur: 0.2,
      pitch: o.hem * 0.6,
      id: 124,
    });
  // Бубен в левой: кожа и обод охрой; поднятый — смотрит вверх.
  const dc = shDrumLocal(o);
  // Кожа смотрит вверх-наружу: бубен читается сверху с любой стороны.
  // В миг удара кожа вспыхивает сиянием (сама волна — у «Техник»).
  const hitK = clamp01((o.beat - 0.7) / 0.3);
  const skinR = hitK > 0 ? BONE.map((c) => mixc(c, AURORA[4], hitK * 0.75)) : BONE;
  const dRoll = -(0.85 + 0.35 * o.drum);
  sub.push({
    x: dc[0],
    y: dc[1],
    z: dc[2],
    rx: 3.9 * s,
    ry: 0.8 * s,
    rz: 3.9 * s,
    yaw: 0.35,
    roll: dRoll,
    ramp: skinR,
    glow: hitK > 0.3,
    id: 125,
  });
  sub.push({
    x: dc[0],
    y: dc[1],
    z: dc[2],
    rx: 4.3 * s,
    ry: 0.5 * s,
    rz: 4.3 * s,
    yaw: 0.35,
    roll: dRoll,
    ramp: OCHRE,
    id: 126,
  });
  // Колотушка в правой: занесена — вверх-назад, удар — в кожу бубна.
  const bd =
    o.beat < 0
      ? lerp3([0.7, -0.5, 0.25], [-0.3, 0.25, 1], -o.beat)
      : lerp3([0.7, -0.5, 0.25], [0.25, -1, -0.1], o.beat);
  const bl = Math.hypot(bd[0], bd[1], bd[2]) || 1;
  const end = haft(
    sub,
    j.handR,
    Math.atan2(bd[1], bd[0]),
    Math.asin(bd[2] / bl),
    0.5 * s,
    3.8 * s,
    0.62 * s,
    WOOD,
    127,
  );
  sub.push({
    x: end[0],
    y: end[1],
    z: end[2],
    rx: 1.1 * s,
    ry: 1.1 * s,
    rz: 1.1 * s,
    ramp: SH_TRIM,
    fur: 0.3,
    id: 128,
  });
  // Ленты сияния от плеч: волна бежит от плеча к концу, цвет — к фиолету.
  const aur = Math.max(0, o.aurora);
  const ribR = [0, 1, 2].map((q) =>
    AURORA.map((c, i) => mixc(mixc(c, RIB_V[i], q * 0.42), WHITE, Math.max(0, aur - 1) * 0.35)),
  );
  const n = Math.round(10 * Math.max(0, Math.min(1, o.ribLen)));
  for (const e of [-1, 1]) {
    const base: V3 = [
      j.chest[0] + tiltV([-1.7, 0, 0.8], b.lean)[0] * s,
      e * 2.7 * s,
      j.chest[2] + tiltV([-1.7, 0, 0.8], b.lean)[2] * s,
    ];
    for (let i = 1; i <= n; i++) {
      const u = i / 10;
      const ph = o.rib - u * 4.2 + (e > 0 ? 1.3 : 0);
      const r = (0.95 - u * 0.35) * s;
      sub.push({
        x: base[0] - u * 12 * s,
        y: base[1] * (1 + u * 0.45) + Math.sin(ph) * o.ribA * u * 2.4 * s,
        z: base[2] + o.ribUp * u * 8 * s + Math.cos(ph * 0.9) * o.ribA * u * 1.4 * s,
        rx: r,
        ry: r,
        rz: r,
        ramp: ribR[Math.min(2, Math.floor(u * 3))],
        glow: aur > 0.05,
        id: 130 + (e > 0 ? 1 : 0),
      });
    }
  }
  for (const pt of sub) {
    const c = place([pt.x, pt.y, pt.z]);
    // Части фигуры свои (только что собраны) — правим на месте, без копий.
    pt.x = c[0];
    pt.y = c[1];
    pt.z = c[2];
    pt.pitch = (pt.pitch ?? 0) + pitch;
    pt.roll = (pt.roll ?? 0) + roll;
    parts.push(pt);
  }
  const eyes: Eye[] = [-1, 1].map((e) => {
    const c = place(at([2.75, e * 0.75, 0.15]));
    return { x: c[0], y: c[1], z: c[2], c: SH_EYE };
  });
  return { head: place(hd), drum: place(dc), eyes };
}

// ---- Мамонт -------------------------------------------------------------------

const M_FUR = ramp('#120806', '#26140b', '#3e2312', '#5e351b', '#8a5428');
const M_HAIR = ramp('#0b0504', '#1c0e07', '#311a0d', '#4c2a15', '#704020');
const M_TUSK = ramp('#6a604c', '#9a8e72', '#c8bc98', '#e8e0c4', '#fffaea');
const M_TUSKB = ramp('#4a3e2c', '#6e5e44', '#968466', '#bcae8c', '#ddd2b4');
const M_SKIN = ramp('#1c1310', '#33241c', '#4f3b2e', '#6e5444', '#8e705c');
const M_MOUTH = ramp('#2a0a0a', '#4a1414', '#6a2222', '#8a3434', '#aa4a4a');
const M_EYE = hx('#8ad8ff');
/** Мамонт крупнее модели в 1,3 раза: на арене он должен давить массой. */
const MAM_SC = 1.3;
const CV_MAM: Canvas = { w: 176, h: 160, ox: 88, oy: 108 };
/** Цикл шага и галопа, клеток пути; ход стопы в опоре — доля цикла (ноги не скользят). */
const WALK_C = 2.0;
const GALLOP_C = 3.6;
const WALK_S = (0.7 * WALK_C * 16) / MAM_SC;
const GALLOP_S = (0.42 * GALLOP_C * 16) / MAM_SC;

interface MamO {
  /** Шаг: фаза 0…1, походка (0 стоит, 1 шаг, 2 галоп), ход стопы в опоре, подъём стопы. */
  ph: number;
  gait: number;
  stride: number;
  lift: number;
  /** Переступ на месте при развороте: вбок, со знаком поворота. */
  side: number;
  /** Корпус: вверх-вниз, тангаж (перед вверх +) вокруг задних ног, крен, присед. */
  bob: number;
  pitch: number;
  roll: number;
  crouch: number;
  /** Голова: вниз (+), вбок; пасть; уши (0 прижаты … 1 развёрнуты). */
  hp: number;
  hy: number;
  jaw: number;
  ear: number;
  /** Хобот: угол первого звена вниз от «вперёд», завиток на звено, вбок. */
  ta: number;
  tk: number;
  tsw: number;
  /** Передние ноги: подъём и вынос левой/правой; вынос всех передних и задних. */
  liftL: number;
  liftR: number;
  reachL: number;
  reachR: number;
  reachF: number;
  reachB: number;
  /** На коленях: передние, задние (0…1). */
  kneelF: number;
  kneelB: number;
  /** Шерсть: снос кончиков (+ вперёд), подлёт, фаза и сила волны, снос вбок. */
  furX: number;
  furUp: number;
  furPh: number;
  furAmp: number;
  furRoll: number;
  /** Наездница: подскок, наклон, колотушка, бубен, присед, руки вверх, сползание. */
  rider: boolean;
  rUp: number;
  rLean: number;
  rBeat: number;
  rDrum: number;
  rCrouch: number;
  rArms: number;
  rSlide: number;
  rRib: number;
  /** Трещина бивня: 0 тёмная, 1 светится (оглушён), 2 вспышка (удар в стену). */
  crack: number;
  /** Кольцо звёзд над головой: фаза (−1 — нет); глаза закрыты. */
  daze: number;
  shut: boolean;
  /** Фаза боя (иней растёт), иней смерти поверх всего. */
  phase: number;
  frost: number;
  /** Пар из хобота 0…1 (клуб выдоха). */
  breath: number;
  /** След бивней: прошлые кадры [кончик Л, кончик П, середина Л, середина П]. */
  trail: V3[][] | null;
}

const MAM0: MamO = {
  ph: 0,
  gait: 0,
  stride: 0,
  lift: 0,
  side: 0,
  bob: 0,
  pitch: 0,
  roll: 0,
  crouch: 0,
  hp: 0.06,
  hy: 0,
  jaw: 0,
  ear: 0.2,
  ta: 1.3,
  tk: -0.06,
  tsw: 0,
  liftL: 0,
  liftR: 0,
  reachL: 0,
  reachR: 0,
  reachF: 0,
  reachB: 0,
  kneelF: 0,
  kneelB: 0,
  furX: 0,
  furUp: 0,
  furPh: 0,
  furAmp: 0.04,
  furRoll: 0,
  rider: true,
  rUp: 0,
  rLean: 0,
  rBeat: 0,
  rDrum: 0,
  rCrouch: 0,
  rArms: 0,
  rSlide: 0,
  rRib: 0,
  crack: 0,
  daze: -1,
  shut: false,
  phase: 0,
  frost: 0,
  breath: 0,
  trail: null,
};

/** Скелет позы: тело (тангаж вокруг задних ног, крен) и голова в своих осях. */
interface MamSkel {
  z0: number;
  /** Точка тела → модель. */
  B: (p: V3) => V3;
  /** Только крен (стопы на льду при падении на бок). */
  Rl: (p: V3) => V3;
  /** Точка головы (от основания шеи) → модель. */
  H: (x: number, y: number, z: number) => V3;
}

function mamSkel(o: MamO): MamSkel {
  const z0 = 26 - o.crouch + o.bob;
  const piv: V3 = [-13, 0, 16 - o.crouch * 0.6];
  const cp = Math.cos(o.pitch);
  const sp = Math.sin(o.pitch);
  const cr = Math.cos(o.roll);
  const sr = Math.sin(o.roll);
  const ZR = 5;
  const Rl = (p: V3): V3 => {
    const z = p[2] - ZR;
    return [p[0], p[1] * cr - z * sr, ZR + p[1] * sr + z * cr];
  };
  const B = (p: V3): V3 => {
    const dx = p[0] - piv[0];
    const dz = p[2] - piv[2];
    return Rl([piv[0] + dx * cp - dz * sp, p[1], piv[2] + dx * sp + dz * cp]);
  };
  const N: V3 = [17, 0, z0 + 4];
  const ch = Math.cos(o.hp);
  const sh = Math.sin(o.hp);
  const cy = Math.cos(o.hy);
  const sy = Math.sin(o.hy);
  const H = (x: number, y: number, z: number): V3 => {
    const px = x * ch + z * sh;
    const pz = z * ch - x * sh;
    return B([N[0] + px * cy - y * sy, px * sy + y * cy, N[2] + pz]);
  };
  return { z0, B, Rl, H };
}

/** Бивни: опорные точки кривых (левый, правый), кончики и середины — оси модели. */
function mamTusks(S: MamSkel): { ctl: V3[][]; tip: V3[]; mid: V3[] } {
  const ctl: V3[][] = [];
  for (const e of [-1, 1])
    ctl.push([S.H(6, e * 4.8, -3.5), S.H(18, e * 14.5, -17), S.H(27.5, e * 6.5, -3)]);
  return {
    ctl,
    tip: ctl.map((c) => c[2]),
    mid: ctl.map((c) => bezQ(c[0], c[1], c[2], 0.7)),
  };
}

/** Поза наездницы по позе мамонта. */
function riderSh(o: MamO): ShO {
  const hd = shHands(o.rDrum, o.rBeat);
  const L = lerp3(hd.L, [1.6, -3.4, 19.5], o.rArms);
  const R = lerp3(hd.R, [1.6, 3.4, 19.5], o.rArms);
  const off = o.rSlide > 0.7;
  return {
    body: {
      ...BODY0,
      s: SH_S,
      lean: o.rLean + o.rCrouch * 0.35,
      crouch: o.rCrouch * 1.6,
      wide: 1.6,
      handL: L,
      handR: R,
      kneel: off ? 1 : 0,
      feet: off
        ? undefined
        : [
            [1.8, -8.4, 2.2],
            [1.8, 8.4, 2.2],
          ],
    },
    drum: o.rDrum,
    beat: o.rBeat,
    aurora: 0.35 + o.phase * 0.22 + o.rArms * 0.9,
    rib: o.rRib,
    ribA: 0.55 + o.rArms * 0.6,
    ribUp: -0.45 + o.rArms * 1.6,
    ribLen: 0.8,
    hem: 0,
  };
}

/** Где сидит наездница: седло на загривке (за горбом), при смерти — сползает с бока. */
function riderPlace(o: MamO, S: MamSkel): { place: (p: V3) => V3; onBody: boolean } {
  const hip0 = 9 * SH_S;
  const seat: V3 = [5, 0, S.z0 + 16 + o.rUp - o.rCrouch * 0.6];
  if (o.rSlide <= 0)
    return { place: (p) => S.B([seat[0] + p[0], p[1], seat[2] + p[2] - hip0]), onBody: true };
  // Сползает с правого бока: сперва вбок через шерсть, потом вниз — не
  // сквозь тушу.
  const A = S.B(seat);
  const u = o.rSlide;
  const pos: V3 = [
    lerp(A[0], 2, ease(u)),
    lerp(A[1], 22, easeOut(u * 1.4)),
    lerp(A[2], hip0 * 0.4, u * u) + Math.sin(u * Math.PI) * 4,
  ];
  return { place: (p) => [pos[0] + p[0], pos[1] + p[1], pos[2] + p[2] - hip0], onBody: false };
}

function mammothBuild(look: MobPose['look'], o: MamO): Build {
  const S = mamSkel(o);
  const z0 = S.z0;
  const parts: Part[] = [];
  const fr = o.phase * 0.08 + o.frost * 0.85;
  const fur = lookRamp(frostRamp(M_FUR, fr), look);
  const hair = lookRamp(frostRamp(M_HAIR, fr * 1.5), look);
  const skin = frostRamp(M_SKIN, o.frost * 0.7);
  const snowy = Math.min(0.9, 0.1 + o.phase * 0.05 + o.frost * 0.6);
  const ice = o.frost > 0.45;
  const P = o.pitch;
  const R = o.roll;
  const body = (
    c: V3,
    rx: number,
    ry: number,
    rz: number,
    rp: RGBA[],
    id: number,
    ex: Partial<Part> = {},
  ) => {
    const w = S.B(c);
    parts.push({
      ...ex,
      x: w[0],
      y: w[1],
      z: w[2],
      rx,
      ry,
      rz,
      ramp: rp,
      id,
      pitch: (ex.pitch ?? 0) + P,
      roll: (ex.roll ?? 0) + R,
      gloss: ex.gloss || ice,
    });
  };
  const head = (
    c: V3,
    rx: number,
    ry: number,
    rz: number,
    rp: RGBA[],
    id: number,
    ex: Partial<Part> = {},
  ) => {
    const w = S.H(c[0], c[1], c[2]);
    parts.push({
      ...ex,
      x: w[0],
      y: w[1],
      z: w[2],
      rx,
      ry,
      rz,
      ramp: rp,
      id,
      yaw: (ex.yaw ?? 0) + o.hy,
      pitch: (ex.pitch ?? 0) - o.hp + P,
      roll: (ex.roll ?? 0) + R,
      gloss: ex.gloss || ice,
    });
  };
  const ball = (w: V3, r: number, rp: RGBA[], id: number, ex: Partial<Part> = {}) =>
    parts.push({
      ...ex,
      x: w[0],
      y: w[1],
      z: w[2],
      rx: r,
      ry: r,
      rz: r,
      ramp: rp,
      id,
      gloss: ex.gloss || ice,
    });
  // Корпус: бочка, горб, загривок, круп, грудь, брюхо. Снег — пятнами по верху.
  body([-2, 0, z0], 18, 13.8, 12.5, fur, 1, { fur: 0.3, snowy });
  body([7, 0, z0 + 7], 11, 11.2, 9.5, fur, 2, { fur: 0.3, snowy });
  body([10.5, 0, z0 + 12], 6.5, 7.2, 5.5, fur, 2, {
    fur: 0.3,
    snowy: Math.min(0.95, snowy + 0.12),
  });
  body([-14, 0, z0 - 2], 9.5, 12.2, 10, fur, 1, { fur: 0.3, snowy });
  body([13, 0, z0 - 1], 8, 11.2, 10.5, fur, 3, { fur: 0.32 });
  body([-1, 0, z0 - 7.5], 15, 11.2, 5.5, hair, 4, { fur: 0.45 });
  // Длинная шерсть — пряди по бокам, груди и крупу. Висят по отвесу (не по
  // корпусу), качаются волной с отставанием от шага, подлетают на ударе.
  const tips: V3[] = [];
  const strand = (a: V3, len: number, e: number, id: number) => {
    const at = S.B(a);
    const wave = o.furAmp * Math.sin((o.furPh - a[0] / 28) * TAU);
    const p = clamp01((o.furX * 0.06 + wave + 1.1) / 2.2) * 2.2 - 1.1;
    const r = Math.max(-1.4, Math.min(1.4, e * (0.1 + o.furUp * 0.95) + o.furRoll));
    const half = (len * (1 - o.furUp * 0.25)) / 2;
    const n3: V3 = [-Math.sin(p) * Math.cos(r), -Math.sin(r), Math.cos(p) * Math.cos(r)];
    parts.push({
      x: at[0] - n3[0] * half,
      y: at[1] - n3[1] * half,
      z: at[2] - n3[2] * half,
      rx: 2.5,
      ry: 1.6,
      rz: half,
      pitch: p,
      roll: r,
      ramp: hair,
      fur: 0.5,
      id,
      gloss: ice,
    });
    tips.push([at[0] - n3[0] * half * 2, at[1] - n3[1] * half * 2, at[2] - n3[2] * half * 2]);
  };
  for (const e of [-1, 1])
    for (let k = 0; k < 9; k++) {
      const x = -21 + k * 4.5;
      const hw = 12.8 * Math.sqrt(Math.max(0.15, 1 - ((x + 2) / 21) ** 2));
      strand(
        [x, e * (hw - 1), z0 - 1],
        12 + hash(k, e + 3, 91) * 4 + (k > 2 && k < 7 ? 2 : 0),
        e,
        6 + (k % 2),
      );
    }
  for (let k = 0; k < 4; k++)
    strand([17, -4.5 + k * 3, z0 - 5], 11 + (k % 2) * 2.5, 0, 8 + (k % 2));
  for (let k = 0; k < 3; k++) strand([-24, -4 + k * 4, z0 - 2], 10 + (k % 2) * 2, 0, 8 + (k % 2));
  // Голова: купол с высокой макушкой, лоб к хоботу, уши, пасть.
  head([2, 0, 3], 8.8, 8.8, 9.5, fur, 10, { fur: 0.28 });
  head([-0.5, 0, 11.5], 6.4, 6, 6, hair, 10, { fur: 0.4, snowy });
  head([7.5, 0, -2], 5.2, 5.6, 6.6, lookRamp(frostRamp(M_SKIN, o.frost * 0.7), look), 11, {
    fur: 0.2,
  });
  for (const e of [-1, 1])
    head([-1.5, e * 7.8, 2.5], 1.6, 3 + o.ear * 1.6, 4.4, hair, 12, {
      fur: 0.45,
      yaw: e * (0.25 + o.ear * 0.7),
    });
  if (o.jaw > 0.05) head([5.5, 0, -7.5 - o.jaw], 3, 3, 1.4 + o.jaw * 1.6, M_MOUTH, 16);
  head([5, 0, -9 - o.jaw * 2.4], 2.4, 2.6, 1.3, skin, 16, { fur: 0.1 });
  // Бивни: вниз-наружу и вверх-внутрь; у основания темнее.
  const T = mamTusks(S);
  T.ctl.forEach((c, j) => {
    for (let i = 0; i <= 9; i++) {
      const u = i / 9;
      ball(bezQ(c[0], c[1], c[2], u), 2.5 - u * 1.55, u < 0.2 ? M_TUSKB : M_TUSK, 13 + j, {
        gloss: true,
      });
    }
  });
  // Хобот: звенья по углу и завитку, кончик темнее.
  let tp: V3 = [9, 0, -3];
  let a = o.ta;
  for (let i = 0; i < 10; i++) {
    a += o.tk;
    const l = o.tsw * ((i + 1) / 10);
    tp = [
      tp[0] + 2.6 * Math.cos(a) * Math.cos(l),
      tp[1] + 2.6 * Math.sin(l),
      tp[2] - 2.6 * Math.sin(a) * Math.cos(l),
    ];
    ball(S.H(tp[0], tp[1], tp[2]), 3.1 - i * 0.16, skin, 15, { fur: 0.14 });
  }
  const trunkTip = S.H(tp[0], tp[1], tp[2]);
  ball(trunkTip, 1.9, M_SKIN, 15);
  // Хвост с кисточкой: качается с шагом.
  const tw = Math.sin(o.furPh * TAU) * 1.6;
  ball(S.B([-24, 0, z0 + 2]), 1.5, hair, 17);
  ball(S.B([-25.5, tw * 0.5, z0 - 2]), 1.3, hair, 17);
  ball(S.B([-26.5, tw, z0 - 6]), 1.9, hair, 17, { fur: 0.5 });
  // Ноги-тумбы. Шаг — диагональная последовательность (ЛЗ, ПП, ПЗ, ЛП),
  // галоп — поворотный; в опоре стопа идёт назад ровно со скоростью хода.
  const LEGS: [number, number, number, number, boolean][] = [
    [11, -8.2, 0.75, 0.55, true],
    [11, 8.2, 0.25, 0.43, true],
    [-14, -8.6, 0, 0, false],
    [-14, 8.6, 0.5, 0.12, false],
  ];
  const rolled = clamp01((Math.abs(R) - 0.2) / 0.7);
  LEGS.forEach(([lx, ly, offW, offG, front], k) => {
    const hip = S.B([lx, ly * 0.92, z0 - 5]);
    let foot: V3 = [lx + (front ? o.reachF + (k === 0 ? o.reachL : o.reachR) : o.reachB), ly, 0];
    let lifted = 0;
    if (o.gait > 0 && (o.stride > 0.01 || o.side !== 0)) {
      const beta = o.gait === 2 ? 0.42 : 0.7;
      const phi = (((o.ph + (o.gait === 2 ? offG : offW)) % 1) + 1) % 1;
      const sg = front ? 1 : -1;
      if (phi < beta) {
        const u = phi / beta;
        foot[0] += o.stride * (0.5 - u);
        foot[1] -= sg * o.side * (u - 0.5);
      } else {
        const u = (phi - beta) / (1 - beta);
        const w = ease(u);
        foot[0] += o.stride * (w - 0.5);
        foot[1] -= sg * o.side * (0.5 - w);
        lifted = Math.sin(u * Math.PI) * o.lift;
        foot[2] = lifted;
      }
    }
    if (front) {
      const up = k === 0 ? o.liftL : o.liftR;
      foot[2] += up;
      foot[0] += up * 0.35;
      lifted += up;
      // На дыбах передние ноги уходят вместе с грудью, согнутые.
      const w = clamp01((P - 0.08) / 0.25);
      if (w > 0) foot = lerp3(foot, S.B([lx + 4, ly, z0 - 20 + up * 0.6]), w);
    }
    let knee: V3 = [
      (hip[0] + foot[0]) / 2 + (front ? -0.5 - lifted * 0.3 : 1 + lifted * 0.35),
      (hip[1] + foot[1]) / 2,
      (hip[2] + foot[2]) / 2,
    ];
    const kn = front ? o.kneelF : o.kneelB;
    if (kn > 0) {
      knee = lerp3(knee, [lx + 3.5, ly, 3.6], kn);
      foot = lerp3(foot, [lx - 5.5, ly, 2.4], kn);
    }
    if (rolled > 0) {
      knee = lerp3(knee, S.Rl(knee), rolled);
      foot = lerp3(foot, S.Rl(foot), rolled);
    }
    for (let i = 0; i < 3; i++)
      ball(lerp3(hip, knee, i / 3), 5.4 - i * 0.25, fur, 20 + k, { fur: 0.32 });
    for (let i = 0; i < 3; i++)
      ball(lerp3(knee, foot, i / 2.6), 4.7 - i * 0.2, i < 2 ? fur : hair, 20 + k, { fur: 0.3 });
    parts.push({
      x: foot[0] + 0.5,
      y: foot[1],
      z: foot[2] + 1.2,
      rx: 4.9,
      ry: 4.7,
      rz: 1.9,
      ramp: skin,
      id: 24 + k,
      roll: R * rolled,
    });
    if (front)
      for (const nn of [-1.9, 0, 1.9])
        parts.push({
          x: foot[0] + 4.6,
          y: foot[1] + nn,
          z: foot[2] + 1.1,
          rx: 0.9,
          ry: 0.9,
          rz: 0.7,
          ramp: BONE,
          id: 24 + k,
        });
  });
  // Глаза мамонта (закрыты — не светятся) и наездница.
  const eyes: Eye[] = o.shut
    ? []
    : [-1, 1].map((e) => {
        const c = S.H(8.8, e * 5.5, 3.4);
        return { x: c[0], y: c[1], z: c[2], c: M_EYE };
      });
  if (o.rider) {
    const rp = riderPlace(o, S);
    const r = shamanParts(parts, riderSh(o), look, rp.place, rp.onBody ? P : 0, rp.onBody ? R : 0);
    eyes.push(...r.eyes);
  }
  const extent: V3[] = [];
  if (o.trail) for (const fr2 of o.trail) extent.push(...fr2);
  if (o.daze >= 0) {
    const c = S.H(-1, 0, 20);
    for (const [dx, dy] of [
      [15, 0],
      [-15, 0],
      [0, 15],
      [0, -15],
    ] as const)
      extent.push([c[0] + dx, c[1] + dy, c[2]]);
  }
  if (o.breath > 0)
    for (const [dy, dz] of [
      [-9, 6],
      [9, -6],
    ] as const)
      extent.push([trunkTip[0], trunkTip[1] + dy, trunkTip[2] + dz]);
  return scaleBuild(
    {
      parts,
      eyes,
      extent,
      post: (p, scr, fx) => {
        rimLight(p, RIM_C, 0.42);
        // Сосульки на кончиках прядей: с каждой фазой больше, в смерти — везде.
        const nIce = Math.min(tips.length, Math.round(o.phase * 3 + o.frost * 14));
        for (let k = 0; k < nIce; k++) {
          const tip = tips[(k * 7) % tips.length];
          const [x, y, d] = scr(tip[0], tip[1], tip[2]);
          if (fx.z(x, y - 1) > d + 4) continue;
          p.set(x, y, ICE[4]);
          p.set(x, y + 1, ICE[3]);
          if (k % 2) p.set(x, y + 2, ICE[2]);
        }
        // Трещина левого бивня — видна всегда; светится только в оглушении.
        const [ca, cb, cc] = T.ctl[0];
        const lit = o.crack > 0 ? fx.lit() : null;
        let prev: [number, number] | null = null;
        for (let i = 0; i <= 6; i++) {
          const u = 0.28 + i * 0.055;
          const q = bezQ(ca, cb, cc, u);
          const r = 2.5 - u * 1.55;
          const [x, y, d] = scr(q[0], q[1] + (i % 2 ? 0.5 : -0.5), q[2] + r * 0.85);
          const X = Math.round(x);
          const Y = Math.round(y);
          if (fx.z(X, Y) > d + 2.5) {
            prev = null;
            continue;
          }
          const col =
            o.crack >= 2 ? WHITE : o.crack >= 1 ? TEAL[o.crack > 1.2 ? 4 : 3] : hx('#3e2e1e');
          if (prev) p.line(prev[0], prev[1], X, Y, col);
          else p.set(X, Y, col);
          if (lit) {
            if (prev) lit.line(prev[0], prev[1], X, Y, o.crack >= 2 ? WHITE : TEAL[4]);
            for (const [dx, dy] of [
              [1, 0],
              [-1, 0],
              [0, 1],
              [0, -1],
            ])
              if (!lit.solid(X + dx, Y + dy)) lit.set(X + dx, Y + dy, alpha(TEAL[2], 0.55));
          }
          prev = [X, Y];
        }
        // Клуб пара у кончика хобота (выдох): прицеплен к хоботу.
        if (o.breath > 0) {
          const [x, y] = scr(trunkTip[0], trunkTip[1], trunkTip[2]);
          const k = o.breath;
          for (let i = 0; i < 5; i++) {
            const an = hash(i, 3, 77) * TAU;
            const rr = (1 + k * 5) * (0.3 + hash(i, 5, 78) * 0.7);
            const cx = x + Math.cos(an) * rr;
            const cy = y + Math.sin(an) * rr * 0.6 - k * 3;
            const r = 1 + k * 2.2 * (0.6 + hash(i, 7, 79) * 0.4);
            p.ell(cx, cy, r, r * 0.8, alpha(hx('#e4eef8'), 0.75 * (1 - k * k)));
            p.set(cx - r * 0.4, cy - r * 0.4, alpha(WHITE, 0.8 * (1 - k)));
          }
        }
        // Оглушён: звёзды и снежинки кругом над головой (дальние — тусклее).
        if (o.daze >= 0) {
          const c = S.H(-1, 0, 20);
          const gl = fx.lit();
          for (let i = 0; i < 4; i++) {
            const an = o.daze * TAU + (i / 4) * TAU;
            const [x, y] = scr(c[0] + Math.cos(an) * 12, c[1] + Math.sin(an) * 12, c[2]);
            const X = Math.round(x);
            const Y = Math.round(y);
            const far = Math.sin(an + Math.PI * 0.1) < -0.25;
            const star = i % 2 === 1;
            const hi = star ? hx(far ? '#c8a838' : '#fff2a0') : hx(far ? '#8aa8cc' : '#f0faff');
            const lo = star ? hx(far ? '#7a5a18' : '#e0b030') : hx(far ? '#4a6488' : '#9cc8f0');
            const arm = far ? 1 : 2;
            const pts: [number, number, RGBA][] = [[0, 0, WHITE]];
            for (let r = 1; r <= arm; r++)
              for (const [dx, dy] of [
                [1, 0],
                [-1, 0],
                [0, 1],
                [0, -1],
              ])
                pts.push([dx * r, dy * r, r === 1 ? hi : lo]);
            if (star)
              for (const [dx, dy] of [
                [1, 1],
                [-1, 1],
                [1, -1],
                [-1, -1],
              ])
                pts.push([dx, dy, lo]);
            else if (!far)
              for (const [dx, dy] of [
                [2, 2],
                [-2, 2],
                [2, -2],
                [-2, -2],
              ])
                pts.push([dx, dy, lo]);
            for (const [dx, dy] of pts)
              for (const [ex, ey] of [
                [1, 0],
                [0, 1],
                [-1, 0],
                [0, -1],
              ])
                if (!pts.some((q) => q[0] === dx + ex && q[1] === dy + ey))
                  p.set(X + dx + ex, Y + dy + ey, alpha(INK, 0.55));
            for (const [dx, dy, col] of pts) {
              p.set(X + dx, Y + dy, col);
              if (!far) gl.set(X + dx, Y + dy, col);
            }
          }
        }
        // След кончиков бивней: полосы между прошлыми кадрами, гаснут к хвосту.
        if (o.trail && o.trail.length > 1) {
          const tr = o.trail.map((f) => f.map((v) => scr(v[0], v[1], v[2])));
          const mask = new Float32Array(p.w * p.h);
          for (let j = 0; j < 2; j++)
            for (let k = 0; k < tr.length - 1; k++) {
              const v = 0.85 * (1 - k / (tr.length - 1));
              const a0 = tr[k][2 + j];
              const a1 = tr[k][j];
              const b1 = tr[k + 1][j];
              const b0 = tr[k + 1][2 + j];
              const zt = (a1[2] + b1[2]) / 2;
              fillTri(mask, p.w, p.h, a0, a1, b1, v, fx, zt);
              fillTri(mask, p.w, p.h, a0, b1, b0, v * 0.7, fx, zt);
            }
          for (let i = 0; i < mask.length; i++)
            if (mask[i] > 0.04) {
              const x = i % p.w;
              const y = (i / p.w) | 0;
              p.set(x, y, alpha(mixc(FROST_R[3], WHITE, mask[i]), Math.min(0.85, mask[i] * 0.9)));
            }
          // Кромка следа — путь самих кончиков, ярче к свежему.
          for (let j = 0; j < 2; j++)
            for (let k = 0; k < tr.length - 1; k++) {
              const a = tr[k][j];
              const b = tr[k + 1][j];
              if (fx.z(a[0], a[1]) > a[2] + 3) continue;
              p.line(a[0], a[1], b[0], b[1], alpha(WHITE, 0.95 * (1 - k / (tr.length - 1))));
            }
        }
      },
    },
    MAM_SC,
  );
}

/**
 * Масштаб сборки: части, глаза, точки кадра и рисунок поверх. Части —
 * литералом одной формы (не `{...p}`): копия через spread у двух сотен
 * частей — заметная доля кадра, а одна форма объекта ускоряет и сам риг.
 */
function scaleBuild(b: Build, s: number): Build {
  const sc = (v: V3): V3 => [v[0] * s, v[1] * s, v[2] * s];
  return {
    ...b,
    parts: b.parts.map(
      (p): Part => ({
        x: p.x * s,
        y: p.y * s,
        z: p.z * s,
        rx: p.rx * s,
        ry: p.ry * s,
        rz: p.rz * s,
        yaw: p.yaw ?? 0,
        pitch: p.pitch ?? 0,
        roll: p.roll ?? 0,
        ramp: p.ramp,
        fur: p.fur ?? 0,
        snowy: p.snowy ?? 0,
        glow: p.glow ?? false,
        gloss: p.gloss ?? false,
        id: p.id,
        alpha: p.alpha ?? 1,
      }),
    ),
    eyes: b.eyes?.map((e) => ({ ...e, x: e.x * s, y: e.y * s, z: e.z * s, r: 1 })),
    extent: b.extent?.map(sc),
    clip: b.clip === undefined ? undefined : b.clip * s,
    post: b.post
      ? (p, scr, fx) => b.post?.(p, (x, y, z) => scr(x * s, y * s, z * s), fx)
      : undefined,
  };
}

interface MamCtx {
  rider: boolean;
  phase: number;
  walk: number;
  turn: number;
  speed: number;
  k: number;
  stun: number;
}

/** Поза мамонта в режиме `mode` на время `t` (с; уже квантовано по кадрам). */
function mamAt(mode: string, t: number, now: number, c: MamCtx): MamO {
  // Ленты — от времени режима: ключ кадра техники покрывает и их.
  const o: MamO = { ...MAM0, rider: c.rider, phase: c.phase, rRib: t * 4.5 };
  switch (mode) {
    case 'roar': {
      // Вход: трясёт головой, удар ногой — голову вверх, хобот трубой, рёв;
      // шаманка бьёт в бубен.
      o.hy = 0.25 * Math.sin(t * 14) * clamp01(1 - t / 0.5);
      o.hp = kf(t, [
        [0, 0.1],
        [0.3, 0.2],
        [0.5, 0.05],
        [0.66, 0.32],
        [0.8, -0.5, 'i'],
        [1.9, -0.45],
        [2.3, 0.06],
      ]);
      o.crouch = kf(t, [
        [0.55, 0],
        [0.72, 1.8],
        [0.8, 0, 'i'],
        [0.87, 1.6, 'o'],
        [1.1, 0.3],
        [2.3, 0],
      ]);
      o.pitch = kf(t, [
        [0.6, 0],
        [0.8, 0.1, 'i'],
        [1.9, 0.08],
        [2.3, 0],
      ]);
      o.liftL = bump(t, 0.55, 0.8) * 5;
      o.ta = kf(t - 0.08, [
        [0, 1.3],
        [0.62, 1.7],
        [0.85, -0.4, 'i'],
        [1.9, -0.55],
        [2.3, 1.3],
      ]);
      o.tk = kf(t - 0.08, [
        [0, -0.06],
        [0.85, -0.3],
        [1.9, -0.32],
        [2.3, -0.06],
      ]);
      o.jaw = kf(t, [
        [0.75, 0],
        [0.9, 1, 'o'],
        [1.85, 1],
        [2.05, 0],
      ]);
      o.ear = kf(t, [
        [0.7, 0.2],
        [0.9, 1],
        [1.9, 1],
        [2.2, 0.2],
      ]);
      o.furUp = kf(t, [
        [0.78, 0],
        [0.82, 0.5, 'i'],
        [1.05, 0],
      ]);
      o.furAmp = 0.05 + bump(t, 0.8, 2.0) * 0.07;
      o.furPh = t * 6;
      o.rDrum = kf(t, [
        [0.8, 0],
        [1.0, 1, 'o'],
        [2.0, 1],
        [2.3, 0],
      ]);
      o.rBeat = beatAt(t, [1.15, 1.5, 1.85]);
      o.rLean = kf(t, [
        [0.75, 0],
        [0.85, -0.2, 'o'],
        [1.1, -0.05],
      ]);
      return o;
    }
    case 'f12b_tusk': {
      // Бивни снизу вверх: голова вниз-назад (0–0,62) — рывок разгоном,
      // контакт в 0,85 — проводка выше головы — отдача.
      o.hp = kf(t, [
        [0, 0.08],
        [0.5, 0.55],
        [0.62, 0.6, 'o'],
        [0.85, -0.3, 'i'],
        [0.98, -0.62, 'o'],
        [1.12, -0.55],
        [1.35, 0.08],
      ]);
      o.hy = kf(t, [
        [0, 0],
        [0.5, -0.3],
        [0.62, -0.34],
        [0.85, 0.1, 'i'],
        [0.98, 0.3, 'o'],
        [1.35, 0],
      ]);
      o.pitch = kf(t, [
        [0, 0],
        [0.55, -0.07],
        [0.85, 0.05, 'i'],
        [1.0, 0.11, 'o'],
        [1.35, 0],
      ]);
      o.crouch = kf(t, [
        [0, 0],
        [0.55, 2.4],
        [0.85, 0.4, 'i'],
        [1.0, 0],
        [1.35, 0],
      ]);
      o.liftL = bump(t, 0.6, 0.84) * 4;
      o.reachL = kf(t, [
        [0.6, 0],
        [0.84, 4.5, 'o'],
        [1.2, 4.5],
        [1.35, 2],
      ]);
      const tl = t - 0.07;
      o.ta = kf(tl, [
        [0, 1.3],
        [0.55, 1.95],
        [0.85, 0.9, 'i'],
        [1.0, 0.35, 'o'],
        [1.35, 1.3],
      ]);
      o.tk = kf(tl, [
        [0, -0.06],
        [0.55, 0.16],
        [0.85, -0.05],
        [1.0, -0.22],
        [1.35, -0.06],
      ]);
      o.tsw = kf(tl, [
        [0, 0],
        [0.55, 0.25],
        [0.9, -0.35],
        [1.35, 0],
      ]);
      o.jaw = bump(t, 0.75, 1.15) * 0.8;
      o.ear = 0.2 + bump(t, 0.7, 1.25) * 0.8;
      o.furX = kf(t - 0.06, [
        [0, 0],
        [0.55, -1.5],
        [0.85, 0],
        [1.0, 3.5, 'o'],
        [1.2, -1],
        [1.35, 0],
      ]);
      o.furAmp = 0.06 + bump(t, 0.85, 1.35) * 0.18;
      o.furPh = t * 2.2;
      o.rLean = kf(t - 0.05, [
        [0, 0],
        [0.55, -0.32],
        [0.85, 0.1, 'i'],
        [1.0, 0.4, 'o'],
        [1.35, 0],
      ]);
      o.rUp = bump(t, 0.85, 1.1) * 1.5;
      return o;
    }
    case 'f12b_stomp':
    case 'f12b_rear': {
      // На дыбы: присел — поднялся, передние молотят воздух — вниз разгоном,
      // контакт ровно в ударе мозга — сжатие, шерсть подлетает.
      const rear = mode === 'f12b_rear';
      const H = rear ? 0.9 : MAMMOTH.stomp.hit;
      const top = rear ? 0.8 : 0.66;
      const sh = (x: number) => (x * H) / 1.0;
      o.pitch = kf(t, [
        [0, 0],
        [sh(0.22), -0.06],
        [sh(0.72), top - 0.04, 'o'],
        [sh(0.88), top],
        [H, 0, 'i'],
        [H + 0.08, -0.05, 'o'],
        [H + 0.3, 0.02],
        [H + 0.55, 0],
      ]);
      o.crouch = kf(t, [
        [0, 0],
        [sh(0.22), 3.2],
        [sh(0.5), 0],
        [H, 0],
        [H + 0.06, 2.8, 'o'],
        [H + 0.4, rear ? 0.5 : 0],
        [H + 0.6, 0],
      ]);
      const paw = t > sh(0.35) && t < H - 0.05;
      const sw = Math.sin((t - sh(0.35)) * 4.5 * Math.PI);
      o.liftL = paw ? Math.max(0, sw) * 4.5 : 0;
      o.liftR = paw ? Math.max(0, -sw) * 4.5 : 0;
      o.hp = rear
        ? kf(t, [
            [0, 0.08],
            [0.2, 0.3],
            [0.62, -0.5],
            [0.85, -0.55],
            [H, 0.25, 'i'],
            [1.0, 0.35],
            [1.15, -0.45, 'o'],
            [1.45, -0.4],
            [1.6, 0.05],
          ])
        : kf(t, [
            [0, 0.08],
            [0.22, 0.25],
            [0.72, -0.38],
            [0.92, -0.42],
            [H, 0.3, 'i'],
            [1.12, 0.45, 'o'],
            [1.55, 0.08],
          ]);
      const tl = t - 0.08;
      o.ta = rear
        ? kf(tl, [
            [0, 1.3],
            [0.62, 0],
            [0.85, -0.1],
            [0.96, 1.9, 'i'],
            [1.15, -0.3, 'o'],
            [1.45, -0.2],
            [1.6, 1.2],
          ])
        : kf(tl, [
            [0, 1.3],
            [0.72, 0.1],
            [0.92, 0],
            [1.06, 1.95, 'i'],
            [1.25, 1.2],
            [1.55, 1.3],
          ]);
      o.tk = rear
        ? kf(tl, [
            [0, -0.06],
            [0.62, -0.35],
            [0.96, 0.1],
            [1.15, -0.3],
            [1.45, -0.3],
            [1.6, -0.06],
          ])
        : kf(tl, [
            [0, -0.06],
            [0.72, -0.32],
            [0.92, -0.35],
            [1.06, 0.12],
            [1.55, -0.06],
          ]);
      o.jaw = Math.max(bump(t, sh(0.42), H), rear ? bump(t, 1.06, 1.55) : 0) * 0.95;
      o.ear = 0.2 + Math.max(bump(t, sh(0.35), H + 0.1), rear ? bump(t, 1.05, 1.6) : 0) * 0.8;
      o.furUp = kf(t, [
        [H - 0.05, 0],
        [H, 0.85, 'i'],
        [H + 0.22, -0.12, 'o'],
        [H + 0.45, 0],
      ]);
      o.furX = kf(t - 0.05, [
        [0, 0],
        [sh(0.72), -2.4],
        [H, -1],
        [H + 0.1, 1.5],
        [H + 0.55, 0],
      ]);
      o.furAmp = 0.05 + bump(t, H, H + 0.55) * 0.15;
      o.furPh = t * 2.5;
      o.rLean = kf(t - 0.05, [
        [0, 0],
        [sh(0.72), 0.45],
        [H, 0.2],
        [H + 0.06, -0.25, 'o'],
        [H + 0.4, 0],
      ]);
      o.rUp = kf(t, [
        [H, 0],
        [H + 0.06, 2.5, 'o'],
        [H + 0.2, 0],
      ]);
      if (rear) {
        o.rDrum = kf(t, [
          [1.0, 0],
          [1.15, 1, 'o'],
          [1.5, 1],
          [1.6, 0],
        ]);
        o.rBeat = beatAt(t, [1.27, 1.47]);
      }
      return o;
    }
    case 'f12b_paw': {
      // Роет копытом: три гребка правой передней (вперёд — и назад по льду),
      // голова низко, бивни на героя, пар из хобота; к концу — сжался пружиной.
      const tt = clamp01(c.k) * MAMMOTH.paw;
      const sc = (tt - 0.1) / 0.3;
      const si = Math.floor(sc);
      const su = sc - si;
      const scr2 = si >= 0 && si < 3;
      o.liftR = scr2
        ? su < 0.35
          ? ease(su / 0.35) * 8.5
          : 8.5 * Math.max(0, 1 - ease((su - 0.35) / 0.22))
        : 0;
      o.reachR = scr2 ? (su < 0.35 ? ease(su / 0.35) * 6 : 6 - ease((su - 0.35) / 0.65) * 13) : 0;
      o.hp =
        kf(tt, [
          [0, 0.1],
          [0.25, 0.42],
          [1.05, 0.46],
        ]) + (scr2 ? bump(su, 0.35, 0.8) * 0.05 : 0);
      o.pitch = kf(tt, [
        [0, 0],
        [0.25, -0.05],
        [0.85, -0.05],
        [1.05, -0.1],
      ]);
      o.crouch = kf(tt, [
        [0, 0],
        [0.25, 1.6],
        [0.85, 1.6],
        [1.05, 2.4],
      ]);
      o.reachB = kf(tt, [
        [0, 0],
        [0.25, -1.5],
        [1.05, -2.5],
      ]);
      o.ta = 1.8;
      o.tk = 0.18;
      o.tsw = 0.12 * Math.sin(tt * 9);
      o.breath = scr2 && su > 0.5 ? (su - 0.5) / 0.5 : 0;
      o.ear = 0.85 + 0.15 * Math.sin(tt * 20);
      o.furAmp = 0.08;
      o.furPh = tt * 3;
      o.rLean = 0.35;
      o.rCrouch = 0.5;
      return o;
    }
    case 'f12b_charge': {
      // Галоп: шаг по пройденному пути (частота растёт со скоростью), корпус
      // наклонён вперёд и качается, шерсть и уши сносит назад.
      o.gait = 2;
      o.ph = Math.floor(((((c.walk / GALLOP_C) % 1) + 1) % 1) * 12) / 12;
      o.stride = GALLOP_S;
      o.lift = 6;
      const a = o.ph * TAU;
      const st = clamp01(1 - Math.floor(t * 12) / 12 / 0.25);
      o.pitch = -0.08 + 0.07 * Math.sin(a + 0.6) - 0.08 * st;
      o.bob = 1.4 * Math.max(0, Math.sin(a + 1.2)) + 0.4;
      o.crouch = 0.8 + 1.2 * st;
      o.hp = 0.36 + 0.06 * Math.sin(a - 0.8);
      o.ta = 1.95;
      o.tk = 0.18;
      o.tsw = 0.12 * Math.sin(a - 1.6);
      o.ear = 0.75 + 0.25 * Math.sin(a * 2);
      o.jaw = 0.25;
      o.furX = -3.8;
      o.furAmp = 0.16;
      o.furPh = o.ph * 2;
      o.rLean = 0.5 + 0.08 * Math.sin(a - 1);
      o.rUp = Math.sin(a - 0.6);
      o.rCrouch = 0.4;
      o.rRib = a * 2;
      return o;
    }
    case 'f12b_skid': {
      // Юз: ноги упёрты вперёд, корпус по инерции — откинут, к остановке
      // клюёт вперёд и встаёт; шерсть и хобот летят вперёд.
      o.reachF = kf(t, [
        [0, 6],
        [0.6, 5],
        [0.85, 0],
      ]);
      o.reachB = kf(t, [
        [0, 3],
        [0.6, 2.5],
        [0.85, 0],
      ]);
      o.pitch = kf(t, [
        [0, 0.06],
        [0.45, 0.1],
        [0.68, -0.07, 'i'],
        [0.78, 0.02, 'o'],
        [0.85, 0],
      ]);
      o.crouch = kf(t, [
        [0, 2.6],
        [0.6, 2.2],
        [0.85, 0],
      ]);
      o.hp = kf(t, [
        [0, -0.12],
        [0.5, -0.08],
        [0.7, 0.32, 'i'],
        [0.85, 0.1],
      ]);
      o.ta = kf(t - 0.08, [
        [0, 0.7],
        [0.55, 0.6],
        [0.75, 1.9, 'i'],
        [0.85, 1.4],
      ]);
      o.tk = kf(t - 0.08, [
        [0, -0.15],
        [0.75, 0.1],
        [0.85, -0.06],
      ]);
      o.furX = kf(t - 0.05, [
        [0, 3.5],
        [0.55, 3],
        [0.72, 5, 'o'],
        [0.85, -1],
      ]);
      o.furAmp = 0.12;
      o.furPh = t * 4;
      o.ear = 0.9;
      o.rLean = kf(t - 0.05, [
        [0, 0.55],
        [0.7, 0.75],
        [0.85, 0.1],
      ]);
      return o;
    }
    case 'f12b_stunned': {
      // Удар в стену: сжатие, голова отскакивает, бивень трескается (кадр
      // контакта — вспышка трещины), откат; дальше — пошатывается, звёзды.
      o.crack = 1;
      if (t < 0.5) {
        o.hp = kf(t, [
          [0, -0.45],
          [0.06, -0.5],
          [0.22, 0.52, 'o'],
          [0.36, 0.38],
          [0.5, 0.45],
        ]);
        o.pitch = kf(t, [
          [0, 0.12],
          [0.08, 0.1],
          [0.25, -0.06, 'o'],
          [0.5, -0.03],
        ]);
        o.crouch = kf(t, [
          [0, 0.5],
          [0.1, 3.8, 'o'],
          [0.3, 2.2],
          [0.5, 2.6],
        ]);
        o.roll = kf(t, [
          [0, 0],
          [0.3, 0.07],
          [0.5, 0.05],
        ]);
        o.ta = kf(t - 0.06, [
          [0, 0.4],
          [0.2, 1.95, 'i'],
          [0.4, 1.6],
          [0.5, 1.75],
        ]);
        o.tk = 0.12;
        o.tsw = kf(t, [
          [0, 0],
          [0.3, 0.3],
          [0.5, 0.1],
        ]);
        o.furX = kf(t - 0.04, [
          [0, 4.5],
          [0.15, 2],
          [0.3, -1.5],
          [0.5, 0],
        ]);
        o.furUp = bump(t, 0, 0.3) * 0.6;
        o.ear = kf(t, [
          [0, 1],
          [0.5, 0.1],
        ]);
        o.reachF = kf(t, [
          [0, 2],
          [0.5, 1],
        ]);
        o.crack = t < 0.16 ? 2 : 1;
        o.daze = t > 0.3 ? ((t - 0.3) / 1.2) % 1 : -1;
        o.rLean = kf(t, [
          [0, 0.7],
          [0.1, 0.9],
          [0.3, -0.2],
          [0.5, 0.1],
        ]);
        o.rUp = bump(t, 0, 0.25) * 3;
        return o;
      }
      const fl = Math.floor(((t - 0.5) / 1.2) * 12) % 12;
      const u = fl / 12;
      const a = u * TAU;
      o.hp = 0.45 + 0.06 * Math.sin(a * 2);
      o.hy = 0.28 * Math.sin(a);
      o.roll = 0.04 + 0.08 * Math.sin(a + 0.6);
      o.crouch = 2.6;
      o.pitch = -0.03;
      o.ta = 1.75 + 0.06 * Math.sin(a * 2);
      o.tk = 0.12;
      o.tsw = 0.3 * Math.sin(a - 0.9);
      o.ear = 0.1;
      o.reachF = 1;
      o.shut = fl >= 4 && fl <= 6;
      o.daze = (u + 0.17) % 1;
      o.crack = fl % 4 < 2 ? 1.3 : 1;
      o.liftL = bump(u, 0.15, 0.35) * 2;
      o.furAmp = 0.05;
      o.furPh = u;
      o.rLean = 0.15 + 0.06 * Math.sin(a);
      o.rRib = a * 2;
      return o;
    }
    case 'f12b_getup': {
      // Подъём с усилием: упёрся — просел — встал; трясёт головой.
      o.crouch = kf(t, [
        [0, 2.6],
        [0.14, 1.2, 'o'],
        [0.24, 1.9],
        [0.45, -0.3, 'o'],
        [0.6, 0],
      ]);
      o.pitch = kf(t, [
        [0, -0.03],
        [0.14, 0.07],
        [0.24, 0.02],
        [0.45, 0.05],
        [0.6, 0],
      ]);
      o.hp = kf(t, [
        [0, 0.45],
        [0.2, 0.3],
        [0.45, -0.05],
        [0.6, 0.08],
      ]);
      o.hy = 0.32 * Math.sin(t * 30) * clamp01(1 - t / 0.6);
      o.ear = 0.3 + 0.6 * Math.abs(Math.sin(t * 30)) * clamp01(1 - t / 0.6);
      o.ta = kf(t - 0.06, [
        [0, 1.75],
        [0.3, 1.0],
        [0.6, 1.3],
      ]);
      o.tsw = -o.hy * 1.2;
      o.furAmp = 0.25 * clamp01(1 - t / 0.6);
      o.furPh = t * 5;
      o.daze = t < 0.25 ? (t * 2) % 1 : -1;
      o.liftR = bump(t, 0.1, 0.3) * 3;
      o.reachF = kf(t, [
        [0, 1],
        [0.6, 0],
      ]);
      o.rLean = kf(t, [
        [0, 0.15],
        [0.3, 0.3],
        [0.6, 0],
      ]);
      return o;
    }
    case 'f12b_drum': {
      // Вьюга: шаманка заносит колотушку и бьёт в бубен ровно в такт валам
      // (0,35 / 0,70 / 1,05 с); мамонт притопывает передними в те же удары.
      const hits = [0.35, 0.7, 1.05];
      o.rDrum = kf(t, [
        [0, 0],
        [0.14, 1, 'o'],
        [1.2, 1],
        [1.5, 0],
      ]);
      o.rBeat = beatAt(t, hits);
      o.rLean = -0.1 + hits.reduce((s, h) => s + bump(t, h - 0.02, h + 0.16) * 0.18, 0);
      o.liftL = bump(t, 0.35 - 0.24, 0.35) * 4.5 + bump(t, 1.05 - 0.24, 1.05) * 4.5;
      o.liftR = bump(t, 0.7 - 0.24, 0.7) * 4.5;
      o.bob = -hits.reduce((s, h) => s + bump(t, h, h + 0.14), 0) * 0.9;
      o.hp = -0.12 + hits.reduce((s, h) => s + bump(t, h, h + 0.2) * 0.07, 0);
      o.ta = 1.1 + 0.2 * Math.sin((t * TAU) / 0.7);
      o.tsw = 0.3 * Math.sin((t * TAU) / 0.7 - 1);
      o.ear = 0.5;
      o.furAmp = 0.08;
      o.furPh = t / 0.35;
      o.rUp = hits.reduce((s, h) => s + bump(t, h, h + 0.18) * 0.8, 0);
      return o;
    }
    case 'f12b_spikes': {
      // Хобот вверх (вдох) — и хоботом с бивнями в лёд ровно в 0,9 с.
      const tl = t - 0.04;
      o.ta = kf(tl, [
        [0, 1.3],
        [0.55, -0.65, 'o'],
        [0.8, -0.8],
        [0.9, 1.9, 'i'],
        [1.0, 1.75],
        [1.4, 1.3],
      ]);
      o.tk = kf(tl, [
        [0, -0.06],
        [0.55, -0.12],
        [0.8, -0.18],
        [0.9, 0.05],
        [1.4, -0.06],
      ]);
      o.hp = kf(t, [
        [0, 0.06],
        [0.55, -0.42, 'o'],
        [0.8, -0.48],
        [0.9, 0.58, 'i'],
        [1.02, 0.5],
        [1.4, 0.08],
      ]);
      o.pitch = kf(t, [
        [0, 0],
        [0.55, 0.2, 'o'],
        [0.8, 0.23],
        [0.9, -0.06, 'i'],
        [1.05, 0],
        [1.4, 0],
      ]);
      o.crouch = kf(t, [
        [0, 0],
        [0.2, 1.5],
        [0.55, 0],
        [0.9, 0],
        [0.96, 3, 'o'],
        [1.3, 0],
      ]);
      o.liftL = o.liftR = kf(t, [
        [0.4, 0],
        [0.7, 3],
        [0.9, 0, 'i'],
      ]);
      o.jaw = bump(t, 0.4, 0.88) * 0.9;
      o.ear = 0.2 + bump(t, 0.4, 1.1) * 0.8;
      o.furUp = kf(t, [
        [0.88, 0],
        [0.92, 0.65, 'i'],
        [1.15, -0.1, 'o'],
        [1.35, 0],
      ]);
      o.furAmp = 0.05 + bump(t, 0.9, 1.4) * 0.12;
      o.furPh = t * 2.5;
      o.rArms = kf(t, [
        [0, 0],
        [0.5, 1],
        [0.85, 1],
        [0.95, 0.2],
        [1.4, 0],
      ]);
      o.rLean = kf(t, [
        [0.85, 0],
        [0.92, 0.3, 'o'],
        [1.2, 0],
      ]);
      return o;
    }
    case 'f12b_blow': {
      // Дует на жаровню: вдох хоботом вверх, грудь раздувается — хобот на
      // жаровню, выдох клубами (к 0,9 с жаровня гаснет).
      const tl = t - 0.04;
      o.ta = kf(tl, [
        [0, 1.3],
        [0.55, -0.55, 'o'],
        [0.72, -0.6],
        [0.84, 0.55, 'i'],
        [1.15, 0.6],
        [1.3, 1.3],
      ]);
      o.tk = kf(tl, [
        [0, -0.06],
        [0.55, -0.25],
        [0.84, 0],
        [1.15, 0],
        [1.3, -0.06],
      ]);
      o.tsw = t > 0.84 && t < 1.15 ? (f24(t) % 2 ? 0.03 : -0.03) : 0;
      o.hp = kf(t, [
        [0, 0.06],
        [0.55, -0.28],
        [0.72, -0.3],
        [0.84, 0.18, 'i'],
        [1.15, 0.15],
        [1.3, 0.06],
      ]);
      o.pitch = kf(t, [
        [0, 0],
        [0.55, 0.05],
        [0.84, -0.03, 'i'],
        [1.15, -0.02],
        [1.3, 0],
      ]);
      o.breath = t >= 0.84 && t < 1.2 ? ((t - 0.84) / 0.12) % 1 : 0;
      o.ear = 0.3 + bump(t, 0.3, 0.84) * 0.6;
      o.rLean = kf(t, [
        [0.8, 0],
        [0.9, -0.2, 'o'],
        [1.3, 0],
      ]);
      return o;
    }
    case 'f12b_drop': {
      // Сияние: шаманка приседает, тянет руки к небу — мамонт вскидывается
      // и подбрасывает её в 0,7 с (дальше она — свой моб).
      o.rider = t < 0.7;
      o.pitch = kf(t, [
        [0, 0],
        [0.45, -0.05],
        [0.7, 0.2, 'i'],
        [0.9, 0.22],
        [1.2, 0],
      ]);
      o.crouch = kf(t, [
        [0, 0],
        [0.45, 2.2],
        [0.7, 0, 'i'],
        [1.2, 0],
      ]);
      o.hp = kf(t, [
        [0, 0.06],
        [0.45, 0.2],
        [0.7, -0.4, 'i'],
        [0.95, -0.42],
        [1.2, 0.06],
      ]);
      o.ta = kf(t - 0.07, [
        [0, 1.3],
        [0.45, 1.5],
        [0.75, -0.2, 'i'],
        [1.0, -0.3],
        [1.2, 1.2],
      ]);
      o.tk = kf(t - 0.07, [
        [0, -0.06],
        [0.75, -0.3],
        [1.2, -0.06],
      ]);
      o.jaw = bump(t, 0.65, 1.15);
      o.ear = 0.2 + bump(t, 0.6, 1.2) * 0.8;
      o.rCrouch = kf(t, [
        [0, 0],
        [0.45, 1],
      ]);
      o.rArms = kf(t, [
        [0.1, 0],
        [0.5, 1],
      ]);
      o.rUp = kf(t, [
        [0.5, 0],
        [0.7, 4, 'i'],
      ]);
      return o;
    }
    case 'dying': {
      // Смерть 2,6 с: вздрогнул — передние колени подломились — задние —
      // завалился на бок с глухим ударом — иней затягивает шерсть.
      o.hp = kf(t, [
        [0, 0.06],
        [0.12, -0.35, 'o'],
        [0.4, -0.2],
        [1.0, 0.45],
        [1.8, 0.55],
        [2.6, 0.6],
      ]);
      o.jaw = bump(t, 0.05, 0.9) * 0.9;
      o.pitch = kf(t, [
        [0, 0],
        [0.15, 0.06],
        [0.45, 0],
        [1.05, -0.17, 'i'],
        [1.4, -0.12],
        [1.9, -0.04],
      ]);
      o.kneelF = kf(t, [
        [0.35, 0],
        [1.05, 1, 'i'],
      ]);
      o.kneelB = kf(t, [
        [0.8, 0],
        [1.45, 1, 'i'],
      ]);
      o.crouch = kf(t, [
        [0.3, 0],
        [1.05, 4.5, 'i'],
        [1.45, 8],
        [1.9, 9],
      ]);
      o.roll = kf(t, [
        [1.25, 0],
        [1.85, 1.38, 'i'],
        [1.97, 1.28, 'o'],
        [2.1, 1.33],
      ]);
      o.ta = kf(t - 0.1, [
        [0, 1.3],
        [0.2, 0.6],
        [1.0, 1.7],
        [1.9, 2.1],
      ]);
      o.tk = kf(t - 0.1, [
        [0, -0.06],
        [1.0, 0.15],
      ]);
      o.ear = kf(t, [
        [0, 0.8],
        [1.0, 0.1],
      ]);
      o.furUp = kf(t, [
        [1.8, 0],
        [1.87, 0.6, 'i'],
        [2.05, 0],
      ]);
      o.furX = kf(t, [
        [0, 0],
        [1.05, 2],
        [1.4, 0],
      ]);
      o.furAmp = 0.05 + bump(t, 1.85, 2.4) * 0.12;
      o.furPh = t * 3;
      o.frost = kf(t, [
        [1.5, 0],
        [2.35, 1],
      ]);
      o.shut = t > 1.3;
      o.rSlide = kf(t, [
        [0.25, 0],
        [1.0, 1],
      ]);
      o.rLean = kf(t, [
        [0, 0],
        [0.2, -0.4],
        [0.6, 0.6],
        [1.0, 0.9],
      ]);
      return o;
    }
  }
  // Ходьба (погоня, к жаровне) и стоянка.
  const moving = c.speed > 0.25 || Math.abs(c.turn) > 0.05;
  if (!moving) {
    const fI = Math.floor(now / 0.3) % 8;
    const u = fI / 8;
    o.bob = 0.5 * Math.sin(u * TAU);
    o.hp = 0.06 + 0.03 * Math.sin(u * TAU - 0.6);
    o.tsw = 0.22 * Math.sin(u * TAU - 1.2);
    o.ta = 1.3 + 0.08 * Math.sin(u * TAU * 2);
    o.tk = -0.06 - 0.05 * Math.sin(u * TAU - 1);
    o.ear = 0.2 + (fI === 5 ? 0.6 : fI === 6 ? 0.3 : 0);
    o.furAmp = 0.05;
    o.furPh = u;
    o.rUp = 0.4 * Math.sin(u * TAU - 0.8);
    o.rRib = u * TAU;
    return o;
  }
  const { fq, lq } = walkQ(c);
  const lead = lq * 0.24;
  const ph = Math.floor(((((c.walk / WALK_C) % 1) + 1) % 1) * 12) / 12;
  const a = ph * TAU;
  const ramp0 =
    mode === 'chase' || mode === 'f12b_douse' ? clamp01(Math.floor(t * 12) / 12 / 0.25) : 1;
  o.gait = 1;
  o.ph = ph;
  o.stride = [0.15, 0.55, 1][fq] * WALK_S * ease(ramp0);
  o.side = (1 - [0.15, 0.55, 1][fq]) * 6 * Math.sign(c.turn);
  o.lift = 6.5;
  o.bob = 1.1 * Math.cos(a * 2);
  o.roll = 0.045 * Math.sin(a);
  o.pitch = 0.012 * Math.sin(a * 2 + 1);
  o.hp = 0.08 + 0.035 * Math.sin(a * 2 - 1.2);
  o.hy = lead + 0.05 * Math.sin(a - 0.8);
  o.tsw = 0.32 * Math.sin(a - 1.6) - lead * 0.6;
  o.ta = 1.28 + 0.1 * Math.sin(a * 2 - 2);
  o.ear = 0.25 + 0.1 * Math.sin(a * 2 - 2.2);
  o.furPh = ph - 0.15;
  o.furAmp = 0.14;
  o.furRoll = -lead * 0.3 + 0.06 * Math.sin(a - 1.9);
  o.rUp = 0.8 * Math.cos(a * 2 - 0.9);
  o.rLean = 0.06 * Math.sin(a * 2 - 1.4);
  o.rRib = a;
  return o;
}

/** Ключ кадра ходьбы/стоянки (всё, что меняет картинку). */
/**
 * Ход и разворот: доля пути вперёд в шаге (`fq`: 0 — почти на месте,
 * 1 — вполоборота, 2 — прямо) и куда ведёт голова (`lq`). Мозг доворачивает
 * не быстрее 1,5 рад/с, малый угол закрывает за пару тиков — переступ
 * по углу, а не «есть поворот — значит, весь шаг на месте».
 */
function walkQ(c: MamCtx): { fq: number; lq: number } {
  const rot = 1.5 * 1.6 * clamp01((Math.abs(c.turn) - 0.03) / 0.25);
  const fwd = c.speed / (c.speed + rot + 1e-6);
  return {
    fq: fwd > 0.75 ? 2 : fwd > 0.33 ? 1 : 0,
    lq: Math.abs(c.turn) < 0.2 ? 0 : Math.sign(c.turn),
  };
}

function mamWalkKey(t: number, now: number, c: MamCtx, mode: string): string {
  const moving = c.speed > 0.25 || Math.abs(c.turn) > 0.05;
  if (!moving) return `i${Math.floor(now / 0.3) % 8}`;
  const { fq, lq } = walkQ(c);
  const wf = Math.floor(((((c.walk / WALK_C) % 1) + 1) % 1) * 12);
  const r = (mode === 'chase' || mode === 'f12b_douse') && t < 0.25 ? `r${Math.floor(t * 12)}` : '';
  return `w${wf}${fq}${lq}${fq < 2 ? Math.sign(c.turn) : ''}${r}`;
}

/** Техники мамонта: в первые 0,125 с ноги ставятся из шага (без скачка позы). */
const MAM_TECH = new Set([
  'f12b_tusk',
  'f12b_stomp',
  'f12b_paw',
  'f12b_drum',
  'f12b_spikes',
  'f12b_blow',
  'f12b_rear',
  'f12b_drop',
]);
const MAM_LEN: Record<string, number> = {
  roar: MAMMOTH.intro,
  f12b_tusk: MAMMOTH.tusk.end,
  f12b_stomp: MAMMOTH.stomp.end,
  f12b_rear: MAMMOTH.rear,
  f12b_skid: MAMMOTH.charge.skid,
  f12b_getup: 0.6,
  f12b_drum: MAMMOTH.drum.end,
  f12b_spikes: MAMMOTH.spikes.end,
  f12b_blow: MAMMOTH.blow.end,
  f12b_drop: 1.2,
  dying: 2.6,
};
/** Где след бивней: [с, по] времени режима. */
const MAM_TRAIL: Record<string, [number, number]> = {
  f12b_tusk: [0.72, 1.06],
};

/** Кадр мамонта: поза на квантованное время, ключ и поля движка. */
function mamFrame(
  mode: string,
  tRaw: number,
  now: number,
  c: MamCtx,
  face: number,
): { o: MamO; key: string; ex: Partial<MobFrame> } {
  const len = MAM_LEN[mode];
  // Техника — 24 к/с от времени режима (библия §14, правило 1).
  const fi = f24(tRaw);
  const t = len !== undefined ? Math.min(len, fi / 24) : fi / 24;
  const ex: Partial<MobFrame> = { shadow: 30, still: true };
  let key: string;
  let o: MamO;
  if (mode === 'f12b_charge') {
    o = mamAt(mode, t, now, c);
    key = `ch${Math.round(o.ph * 12)}${t < 0.25 ? `s${Math.floor(t * 12)}` : ''}`;
    ex.ghost = { every: 0.05, life: 0.26, tint: '#9ac8ff', alpha: 0.26 };
  } else if (mode === 'f12b_stunned') {
    o = mamAt(mode, t, now, c);
    key = t < 0.5 ? `sn${f24(t)}` : `sd${Math.floor(((t - 0.5) / 1.2) * 12) % 12}`;
    if (t < 0.5) {
      // Удар в стену: вжат в неё (сжатие по ходу), потом откат назад.
      const kc = clamp01(1 - t / 0.1);
      const ac = Math.abs(Math.cos(face));
      const as = Math.abs(Math.sin(face));
      ex.sx = 1 - 0.08 * kc * ac + 0.04 * kc * as;
      ex.sy = 1 - 0.08 * kc * as + 0.04 * kc * ac;
      const rec = kf(t, [
        [0, 1.5],
        [0.1, 0],
        [0.22, -3, 'o'],
        [0.5, -2],
      ]);
      ex.dx = Math.cos(face) * rec;
      ex.dy = Math.sin(face) * rec;
    } else {
      // Шатается: корпус ходит вбок вместе с креном.
      const sw = Math.sin(((Math.floor(((t - 0.5) / 1.2) * 12) % 12) / 12) * TAU + 0.6) * 1.2;
      ex.dx = -Math.cos(face) * 2 - Math.sin(face) * sw;
      ex.dy = -Math.sin(face) * 2 + Math.cos(face) * sw;
    }
  } else if (mode === 'f12b_getup') {
    o = mamAt(mode, t, now, c);
    key = `gu${f24(t)}`;
    const rec = kf(t, [
      [0, -2],
      [0.6, 0],
    ]);
    ex.dx = Math.cos(face) * rec;
    ex.dy = Math.sin(face) * rec;
  } else if (mode === 'f12b_paw') {
    const tt = clamp01(c.k) * MAMMOTH.paw;
    const pi = f24(tt);
    o = mamAt(mode, pi / 24, now, { ...c, k: pi / 24 / MAMMOTH.paw });
    key = `paw${pi}`;
  } else if (len !== undefined) {
    o = mamAt(mode, t, now, c);
    key = `${mode.replace('f12b_', '')}${Math.min(fi, Math.round(len * 24))}`;
  } else {
    o = mamAt(mode, t, now, c);
    key = mamWalkKey(tRaw, now, c, mode);
  }
  // Начало техники: ноги из шага встают на лёд за 0,125 с.
  if (MAM_TECH.has(mode) && t < 0.125) {
    const wf = Math.floor(((((c.walk / WALK_C) % 1) + 1) % 1) * 6) * 2;
    const k = 1 - ease(t / 0.125);
    o.gait = 1;
    o.ph = wf / 12;
    o.stride = WALK_S * k;
    o.lift = 6.5 * k;
    key += `b${wf}`;
  }
  // След бивней: те же ключи на 0,15 с назад, через полкадра — дуга, а не
  // ломаная из трёх хорд.
  const tw = MAM_TRAIL[mode];
  if (tw && t >= tw[0] && t <= tw[1]) {
    const tr: V3[][] = [];
    for (let k = 0; k <= 7; k++) {
      const ok = k === 0 ? o : mamAt(mode, t - k / 48, now, c);
      const T = mamTusks(mamSkel(ok));
      tr.push([T.tip[0], T.tip[1], T.mid[0], T.mid[1]]);
    }
    o.trail = tr;
  }
  // Сжатие на контакте: дыбы и шипы — в лёд, бубен — в такт.
  const squash = (at: number, k: number, d = 0.14) => {
    if (t >= at && t < at + d) {
      const q = 1 - (t - at) / d;
      ex.sy = 1 - k * q;
      ex.sx = 1 + k * 0.7 * q;
    }
  };
  if (mode === 'f12b_stomp') squash(MAMMOTH.stomp.hit, 0.09);
  if (mode === 'f12b_rear') squash(0.9, 0.1);
  if (mode === 'f12b_spikes') squash(MAMMOTH.spikes.hit, 0.07);
  if (mode === 'f12b_tusk') squash(MAMMOTH.tusk.hit, 0.035, 0.1);
  if (mode === 'f12b_drum') for (const h of [0.35, 0.7, 1.05]) squash(h, 0.025, 0.1);
  if (mode === 'roar' && t >= 0.8 && t < 0.92) squash(0.8, 0.05);
  if (mode === 'f12b_blow') {
    const sw = kf(t, [
      [0, 0],
      [0.6, 1],
      [0.84, 1],
      [0.95, -0.4, 'o'],
      [1.3, 0],
    ]);
    ex.sx = 1 + 0.035 * sw;
    ex.sy = 1 + 0.02 * sw;
  }
  // Рёв и вздыбленный рёв: мелкая дрожь всего тела (не кадрами).
  if ((mode === 'roar' && t > 0.9 && t < 1.85) || (mode === 'f12b_rear' && t > 1.1 && t < 1.45))
    ex.dx = (ex.dx ?? 0) + Math.sin(now * 55) * 0.35;
  if (mode === 'dying') {
    ex.linger = 2.6;
    ex.alpha = t > 2.25 ? Math.max(0, 1 - (t - 2.25) / 0.35) : 1;
    if (t >= 1.85 && t < 2.0) {
      const q = 1 - (t - 1.85) / 0.15;
      ex.sy = 1 - 0.06 * q;
      ex.sx = 1 + 0.04 * q;
    }
  }
  return { o, key, ex };
}

function mamCtx(m: Mob): MamCtx {
  return {
    rider: (m.data.rider ?? 0) > 0,
    // Иней по фазам: 0–1 один облик (иначе на смене фазы все кадры ходьбы
    // и техник рисуются заново), 2 — седеет, 3 — весь в инее.
    phase: [0, 0, 1.5, 3][Math.max(0, Math.min(3, Math.round(m.data.phase ?? 0)))],
    walk: m.data.walk ?? 0,
    turn: m.data.turn ?? 0,
    speed: speedOf(m),
    k: m.data.k ?? 0,
    stun: m.data.stunT || MAMMOTH.stun,
  };
}

/** Позы мамонта по режиму мозга. */
function mamPose(
  m: Mob,
  pose: MobPose,
  /** Кадр «на потом»: на сколько кадров 24 к/с вперёд (0 — сейчас). */
  j = 0,
): { o: MamO; key: string; ex: Partial<MobFrame> } {
  const c = mamCtx(m);
  let t = pose.t;
  if (j) {
    if (MAM_LEN[pose.mode] !== undefined) t = (f24(pose.t) + j + 0.5) / 24;
    else {
      // Шаг и набег: ход идёт по пройденному пути (как в `tankStep` мозга).
      t += j / 24;
      c.walk += (c.speed + 2.4 * clamp01((Math.abs(c.turn) - 0.03) / 0.25)) * (j / 24);
    }
    if (pose.mode === 'f12b_paw') c.k += j / 24 / MAMMOTH.paw;
  }
  const { o, key, ex } = mamFrame(pose.mode, t, pose.now + j / 24, c, m.face);
  return { o, key: `${pose.look}|${c.rider ? 'r' : ''}${c.phase}|${key}`, ex };
}

/**
 * Кадр «на потом». Техника идёт 24 к/с, игра — 60–100 к/с: новый рисунок
 * нужен раз в 2–4 кадра игры, и каждый такой кадр платил за него целиком
 * (p95 кадра боя, библия §14 п. 12). Теперь следующий кадр мамонта рисуется
 * заранее в своих буферах — по `PIPE_MS` за кадр игры; к своему времени он
 * уже в кеше, а не успел — дорисовывается остаток. Не угадал (сменился
 * режим, повернул) — брошен, картинка та же, что без него.
 */
const MAM_PIPE = rigBufs();
const PIPE_MS = 0.45;
let mamNext: { id: number; mode: string; until: number; task: RigTask } | null = null;

function mamAhead(m: Mob, pose: MobPose, look: MobPose['look']): void {
  if (mamNext && (mamNext.id !== m.id || mamNext.mode !== pose.mode || pose.now > mamNext.until))
    mamNext = null;
  const t0 = performance.now();
  const left = () => PIPE_MS - (performance.now() - t0);
  for (let j = 1; j <= 3 && left() > 0; j++) {
    if (!mamNext) {
      const { o, key } = mamPose(m, pose, j);
      const task = rigTask(
        'f12boss',
        key,
        m.face,
        CV_MAM,
        false,
        () => mammothBuild(look, o),
        16,
        MAM_PIPE,
      );
      if (lruOf('f12boss').get(task.key)) continue;
      mamNext = { id: m.id, mode: pose.mode, until: pose.now + 0.3, task };
    }
    if (!mamNext.task.step(left())) return;
    mamNext = null;
  }
}

/** Точки кадра (px от точки моба на полу): бубен и середина кончиков бивней. */
function mamPts(
  o: MamO,
  face: number,
  ex: Partial<MobFrame>,
): { drum: [number, number]; tusk: [number, number] } {
  const S = mamSkel(o);
  const T = mamTusks(S);
  const tip: V3 = [
    (T.tip[0][0] + T.tip[1][0]) / 2,
    (T.tip[0][1] + T.tip[1][1]) / 2,
    (T.tip[0][2] + T.tip[1][2]) / 2,
  ];
  const sh = riderSh(o);
  const drum = riderPlace(o, S).place(shDrumLocal(sh));
  const f = dirAng(dirN(face, 16), 16);
  const px = (p: V3): [number, number] => {
    const [wx, wy, wz] = toWorld(p[0] * MAM_SC, p[1] * MAM_SC, p[2] * MAM_SC, f);
    const [sx, sy] = project(wx, wy, wz);
    return [(ex.dx ?? 0) + sx * (ex.sx ?? 1), 2 + (ex.dy ?? 0) + sy * (ex.sy ?? 1)];
  };
  return { drum: px(drum), tusk: px(tip) };
}
const MAM_PTS = new Map<number, { drum: [number, number]; tusk: [number, number] }>();

lruOf('f12boss', 560);
lruOf('f12_shaman', 320);

regMob('f12boss', (m, pose) => {
  const { o, key, ex } = mamPose(m, pose);
  // Нужный кадр рисовался заранее — дорисовать остаток.
  if (mamNext?.id === m.id && mamNext.task.key === `${key}|${dirN(m.face, 16)}|0`) {
    mamNext.task.step(Infinity);
    mamNext = null;
  }
  const c = rigFrame('f12boss', key, m.face, CV_MAM, pose.flash, () => mammothBuild(pose.look, o));
  MAM_PTS.set(m.id, mamPts(o, m.face, ex));
  if (MAM_PTS.size > 8) MAM_PTS.delete(MAM_PTS.keys().next().value as number);
  mamAhead(m, pose, pose.look);
  return mobFrame(c, CV_MAM, ex);
});

/**
 * Точки тела мамонта для эффектов «Техник» — px кадра от точки моба на
 * полу: `drum` — бубен шаманки на спине, `tusk` — кончик бивня (середина
 * пары). Берутся из той же позы, что последний нарисованный кадр (дыбы,
 * подъём головы, наклон, сжатие, откат), повёрнутой на сторону кадра.
 */
export function mamPointPx(m: Mob, which: 'drum' | 'tusk'): [number, number] {
  let p = MAM_PTS.get(m.id);
  if (!p) {
    const { o, ex } = mamFrame(m.mode, m.t, performance.now() / 1000, mamCtx(m), m.face);
    p = mamPts(o, m.face, ex);
  }
  return which === 'drum' ? p.drum : p.tusk;
}

// Прогрев: вход (лицом на юг), ходьба во все 16 сторон, бивни, топот и рытьё
// лицом на юг (оттуда герой входит в арену).
registerMobWarm('f12boss', function* () {
  const c0: MamCtx = {
    rider: true,
    phase: 0,
    walk: 0,
    turn: 0,
    speed: 0,
    k: 0,
    stun: MAMMOTH.stun,
  };
  const S = Math.PI / 2;
  const one = (mode: string, t: number, face: number, c: MamCtx) => {
    const { o, key } = mamFrame(mode, t, 0, c, face);
    rigCached('f12boss', `normal|r0|${key}`, face, CV_MAM, false, () => mammothBuild('normal', o));
  };
  for (let i = 0; i < Math.round(MAMMOTH.intro * 24); i++) {
    one('roar', i / 24, S, c0);
    yield 0;
  }
  for (let d = 0; d < 16; d++)
    for (let wf = 0; wf < 12; wf++) {
      one('chase', 1, (d / 16) * TAU, { ...c0, speed: 2.3, walk: (wf / 12) * WALK_C + 0.01 });
      yield 0;
    }
  for (const [mode, end] of [
    ['f12b_tusk', MAMMOTH.tusk.end],
    ['f12b_stomp', MAMMOTH.stomp.end],
  ] as const)
    for (let i = 0; i <= Math.round(end * 24); i++) {
      one(mode, i / 24, S, c0);
      yield 0;
    }
  for (let i = 0; i <= Math.round(MAMMOTH.paw * 24); i++) {
    one('f12b_paw', 0.5, S, { ...c0, k: i / 24 / MAMMOTH.paw });
    yield 0;
  }
});

// ---- Шаманка в небе (фаза 3) -----------------------------------------------------

/** Полёт: корпус наклонён по ходу, ноги отстают, бубен вперёд, ленты сзади. */
function shFly(lean: number, rib: number): ShO {
  return {
    body: {
      ...BODY0,
      s: SH_S,
      lean,
      handL: [3.5, -3.2, 12.5],
      handR: [-1, 4, 11],
      feet: [
        [-3.5 - lean * 2.5, -1.6, 1.5 + lean * 3.5],
        [-2.5 - lean * 2.5, 1.6, 0.5 + lean * 4],
      ],
    },
    drum: 0,
    beat: 0,
    aurora: 1,
    rib,
    ribA: 1.1,
    ribUp: 0.12,
    ribLen: 1,
    hem: Math.min(1, lean * 1.3),
  };
}

function shamanPose(
  m: Mob,
  pose: MobPose,
): { o: ShO; key: string; ex: Partial<MobFrame>; face: number } {
  const t = f24(pose.t) / 24;
  const ex: Partial<MobFrame> = { shadow: 4, still: true, lift: 0.01 };
  let face = m.face;
  const fI = Math.floor(pose.now * 10) % 10;
  const fly = shFly(0.65, (fI / 10) * TAU);
  switch (pose.mode) {
    case 'f12s_jump': {
      // Спрыгнула со спины мамонта и взмыла: смотрит туда же, куда он.
      const mam = paintSim()?.mobs.find((x) => x.kind === 'f12boss');
      if (mam) face = mam.face;
      const k = clamp01((t - 0.1) / 0.5);
      const o = shFly(lerp(-0.1, 0.65, ease(k)), t * 7);
      const up = 1 - ease(clamp01((t - 0.3) / 0.6));
      const hd = shHands(0, 0);
      o.body.handL = lerp3(hd.L, [1.6, -3.4, 19.5], up);
      o.body.handR = lerp3([-1, 4, 11], [1.6, 3.4, 19.5], up);
      o.body.crouch = t < 0.1 ? 2 : 0;
      if (t < 0.3) o.body.feet = undefined;
      o.ribUp = kf(t, [
        [0, -1],
        [0.5, -0.6],
        [0.9, 0.12],
      ]);
      o.ribA = 1.4;
      o.aurora = kf(t, [
        [0, 1.3],
        [0.9, 1],
      ]);
      ex.lift = kf(t, [
        [0, 14],
        [0.1, 12, 'o'],
        [0.55, SH_HIGH + 8, 'o'],
        [0.9, SH_HIGH],
      ]);
      ex.ghost = { every: 0.05, life: 0.22, tint: '#9affd8', alpha: 0.3 };
      ex.shadow = 3.5;
      return { o, key: `j${f24(t)}`, ex, face };
    }
    case 'f12s_dive': {
      // Пике к месту колдовства: головой вниз, руки назад, ленты рвутся вверх.
      const k = clamp01(t / 0.45);
      const o = shFly(1.0, t * 12);
      o.body.handL = [-1.5, -4, 12];
      o.body.handR = [-1.5, 4, 12];
      o.ribUp = 1.3;
      o.ribA = 0.6;
      ex.lift = lerp(SH_HIGH, 5, k * k);
      ex.ghost = { every: 0.035, life: 0.18, tint: '#9affd8', alpha: 0.4 };
      return { o, key: `d${f24(t)}`, ex, face };
    }
    case 'f12s_cast': {
      // Колдует: торможение у пола — бубен вверх, три удара — руки к небу,
      // ленты встают и вспыхивают к 1,1 с (занавесы падают в этот миг).
      const o = shFly(
        kf(t, [
          [0, 0.9],
          [0.12, -0.12, 'o'],
          [1.0, -0.2],
          [1.1, -0.3],
        ]),
        t * 9,
      );
      o.body.feet = undefined;
      o.body.wide = 0.8;
      o.drum = kf(t, [
        [0.08, 0],
        [0.3, 1, 'o'],
      ]);
      o.beat = beatAt(t, [0.45, 0.65, 0.85]);
      const hd = shHands(o.drum, o.beat);
      const up = kf(t, [
        [0.92, 0],
        [1.05, 1, 'o'],
      ]);
      o.body.handL = lerp3(hd.L, [1.5, -3.3, 20.5], up);
      o.body.handR = lerp3(hd.R, [1.5, 3.3, 20.5], up);
      o.ribUp = kf(t, [
        [0, 1.2],
        [0.2, 0.6],
        [0.95, 1.7],
        [1.1, 2.2],
      ]);
      o.ribA = kf(t, [
        [0, 0.8],
        [1.1, 1.8],
      ]);
      o.aurora = kf(t, [
        [0, 0.8],
        [0.9, 1.4],
        [1.1, 2],
      ]);
      o.hem = kf(t, [
        [0, 1],
        [0.2, 0.2],
      ]);
      ex.lift = kf(t, [
        [0, 5],
        [0.1, 3.5, 'o'],
        [0.3, 4.5],
        [1.1, 7.5],
      ]);
      if (t < 0.12) {
        const q = 1 - t / 0.12;
        ex.sy = 1 - 0.1 * q;
        ex.sx = 1 + 0.08 * q;
      }
      ex.shadow = 5;
      return { o, key: `c${f24(t)}`, ex, face };
    }
    case 'f12s_low': {
      // Выдохлась: у самого пола, на коленях, грудь ходит — бей сейчас.
      const fP = Math.floor(t * 10) % 4;
      const o = shFly(0.55 + 0.07 * Math.sin((fP / 4) * TAU), fP * 0.6);
      o.body.feet = undefined;
      o.body.kneel = 1;
      o.body.crouch = 2.2 + 0.4 * Math.sin((fP / 4) * TAU);
      o.body.handL = [2.5, -3.6, 5];
      o.body.handR = [2.5, 3.6, 4.5];
      o.ribUp = -1.4;
      o.ribA = 0.25;
      o.ribLen = 0.85;
      o.aurora = 0.25;
      o.hem = 0;
      if (t < 0.12) {
        const k = ease(t / 0.12);
        o.body.handL = lerp3([1.5, -3.3, 20.5], [2.5, -3.6, 5], k);
        o.body.handR = lerp3([1.5, 3.3, 20.5], [2.5, 3.6, 4.5], k);
        o.ribUp = lerp(2.2, -1.4, k);
        o.aurora = lerp(2, 0.25, k);
      }
      ex.lift = t < 0.12 ? lerp(7.5, 1.5, ease(t / 0.12)) : 1.5;
      ex.shadow = 5;
      return { o, key: t < 0.12 ? `lb${f24(t)}` : `l${fP}`, ex, face };
    }
    case 'f12s_rise': {
      // Взмывает: присела глубже — толчок, ленты хлещут вниз.
      const o = shFly(
        kf(t, [
          [0, 0.55],
          [0.12, 0.8],
          [0.45, 0.65],
        ]),
        t * 10,
      );
      if (t < 0.15) {
        o.body.feet = undefined;
        o.body.kneel = 1;
        o.body.crouch = kf(t, [
          [0, 2.2],
          [0.12, 3],
        ]);
      }
      o.ribUp = kf(t, [
        [0, -1.4],
        [0.15, -1.2],
        [0.45, 0.12],
      ]);
      o.ribA = 1.6;
      o.aurora = kf(t, [
        [0, 0.3],
        [0.2, 1.2],
        [0.45, 1],
      ]);
      ex.lift = kf(t, [
        [0, 1.5],
        [0.12, 0.8, 'o'],
        [0.45, SH_HIGH, 'o'],
      ]);
      ex.ghost = { every: 0.04, life: 0.2, tint: '#9affd8', alpha: 0.32 };
      return { o, key: `r${f24(t)}`, ex, face };
    }
    case 'dying': {
      // Падает с высоты, сгибается, ленты гаснут и опадают.
      const o = shFly(
        kf(t, [
          [0, -0.45],
          [0.3, -0.2],
          [0.45, 0.9],
          [0.9, 1.35],
        ]),
        t * 6,
      );
      o.body.feet = undefined;
      o.body.kneel = kf(t, [
        [0.3, 0],
        [0.5, 1],
      ]);
      o.body.handL = lerp3([1, -5, 17], [3, -4, 2], clamp01((t - 0.3) / 0.4));
      o.body.handR = lerp3([1, 5, 17], [3, 4, 2], clamp01((t - 0.3) / 0.4));
      o.ribLen = kf(t, [
        [0, 1],
        [1.0, 0],
      ]);
      o.ribUp = kf(t, [
        [0, 1.5],
        [0.6, -1.5],
      ]);
      o.aurora = kf(t, [
        [0, 2],
        [0.15, 1.5],
        [1.0, 0],
      ]);
      o.hem = 0;
      ex.lift = kf(t, [
        [0, 6],
        [0.3, 0.01, 'i'],
        [0.36, 1, 'o'],
        [0.45, 0.01, 'i'],
      ]);
      ex.linger = 1.3;
      ex.alpha = t > 0.85 ? Math.max(0, 1 - (t - 0.85) / 0.45) : 1;
      ex.shadow = 5;
      return { o, key: `x${f24(t)}`, ex, face };
    }
    case 'escape':
      ex.lift = SH_HIGH + t * 50;
      ex.alpha = Math.max(0, 1 - t / 0.4);
      return { o: fly, key: `h${fI}`, ex, face };
    default:
      // Под сводом кругами — недосягаема: чуть прозрачна, ленты по ветру.
      ex.lift = SH_HIGH + Math.sin(pose.now * 1.7) * 1.5;
      ex.alpha = 0.88;
      ex.shadow = 3.2;
      return { o: fly, key: `h${fI}`, ex, face };
  }
}

function shamanBuild(look: MobPose['look'], o: ShO): Build {
  const parts: Part[] = [];
  const r = shamanParts(parts, o, look, (p) => p);
  return scaleBuild({ parts, eyes: r.eyes, post: (p) => rimLight(p, RIM_C, 0.38) }, SH_SC);
}

regMob('f12_shaman', (m, pose) => {
  const { o, key, ex, face } = shamanPose(m, pose);
  const c = rigFrame('f12_shaman', `${pose.look}|${key}`, face, CV_SHA, pose.flash, () =>
    shamanBuild(pose.look, o),
  );
  return mobFrame(c, CV_SHA, ex);
});

// Прогрев шаманки: полёт под сводом во все 16 сторон.
registerMobWarm('f12_shaman', function* () {
  for (let d = 0; d < 16; d++)
    for (let fI = 0; fI < 10; fI++) {
      const o = shFly(0.65, (fI / 10) * TAU);
      rigCached('f12_shaman', `normal|h${fI}`, (d / 16) * TAU, CV_SHA, false, () =>
        shamanBuild('normal', o),
      );
      yield 0;
    }
});

// ---------------------------------------------------------------------------
// Слой пола (`f12_floor`, под мобами): трещины тонкого льда, пролом
// Ледолома, полыньи затягиваются, льдины протоки, рябь течения, след
// скольжения героя. Зона одна на вылазку и едет за героем — рисуем окно вида.
// ---------------------------------------------------------------------------

function viewOf(g: CanvasRenderingContext2D, z: Zone | Strike, px: number, py: number) {
  const m = g.getTransform();
  const s = m.a || 1;
  return {
    left: z.x * TS - px,
    top: z.y * TS - py,
    gw: g.canvas.width / s,
    gh: g.canvas.height / s,
  };
}

/** Трещины тонкого льда: стадия 0…2 × 4 вида. Лучи из точки нагрузки. */
const CRACK = new Map<number, HTMLCanvasElement>();
function crackCv(stage: number, v: number): HTMLCanvasElement {
  const key = stage * 8 + v;
  const hit = CRACK.get(key);
  if (hit) return hit;
  const p = new Px(TS, TS);
  const cx = 5 + hash(v, 1, 71) * 6;
  const cy = 5 + hash(v, 2, 71) * 6;
  const rays = 3 + stage * 2;
  const light = stage >= 2 ? WHITE : alpha(ICE[4], 0.55 + stage * 0.2);
  for (let k = 0; k < rays; k++) {
    let a = (k / rays) * TAU + hash(v, k, 72) * 1.2;
    let x = cx;
    let y = cy;
    const len = 3 + stage * 2.6 + hash(v, k, 73) * 3;
    for (let s = 0; s < len; s++) {
      x += Math.cos(a);
      y += Math.sin(a);
      a += (hash(v * 7 + k, s, 74) - 0.5) * 0.8;
      p.set(x, y, light);
      p.set(x, y + 1, alpha(WATER[0], 0.45 + stage * 0.15));
    }
  }
  if (stage >= 1) {
    // Кольцо вокруг точки нагрузки.
    for (let a = 0; a < TAU; a += 0.35)
      if (hash(v, Math.round(a * 10), 75) < 0.4 + stage * 0.25)
        p.set(cx + Math.cos(a) * (2.4 + stage), cy + Math.sin(a) * (1.9 + stage), light);
  }
  if (stage >= 2) {
    // Вода выступает в середине.
    p.ell(cx, cy + 0.5, 1.8, 1.3, alpha(WATER[2], 0.85));
    p.set(cx - 1, cy, alpha(THIN[4], 0.9));
  }
  const cv = p.canvas();
  CRACK.set(key, cv);
  return cv;
}

/** Вода пролома: тёмная, с бликом, 4 вида. */
const OPEN = new Map<number, HTMLCanvasElement>();
function openCv(v: number): HTMLCanvasElement {
  const hit = OPEN.get(v);
  if (hit) return hit;
  const p = new Px(TS, TS);
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const k = 0.3 + (vnoise(x * 0.3 + v * 5, y * 0.3, 77) - 0.5) * 0.3;
      p.set(x, y, toneOf(WATER, k, x, y));
    }
  for (let i = 0; i < 3; i++) {
    const x = Math.floor(hash(v, i, 78) * 12) + 2;
    const y = Math.floor(hash(v, i, 79) * 12) + 2;
    p.line(x, y, x + 3, y, alpha(WATER[4], 0.5));
  }
  const cv = p.canvas();
  OPEN.set(v, cv);
  return cv;
}

/** Обломок льда в воде: белая плитка с тёмной кромкой (3 вида). */
const SHARD = new Map<number, HTMLCanvasElement>();
function shardCv(v: number): HTMLCanvasElement {
  const hit = SHARD.get(v);
  if (hit) return hit;
  const w = 4 + (v % 3);
  const p = new Px(w + 2, w);
  for (let y = 0; y < w - 1; y++)
    for (let x = 0; x < w + 1; x++) {
      const e = Math.abs(x - w / 2) / (w / 2 + 0.5) + Math.abs(y - (w - 2) / 2) / (w / 2);
      if (e > 1.15 + hash(v, x + y * 9, 80) * 0.3) continue;
      p.set(x, y, y < 1 ? WHITE : y < w / 2 ? ICE[4] : ICE[3]);
    }
  for (let x = 0; x < w + 2; x++) if (p.solid(x, w - 2)) p.set(x, w - 1, alpha(ICE[0], 0.9));
  const cv = p.canvas();
  SHARD.set(v, cv);
  return cv;
}

/** Льдина протоки: неровный край, толщина снизу, снег сверху. */
const FLOE = new Map<string, HTMLCanvasElement>();
function floeCv(f: { id: number; rx: number; ry: number }): HTMLCanvasElement {
  const key = `${f.id}:${f.rx.toFixed(2)}:${f.ry.toFixed(2)}`;
  const hit = FLOE.get(key);
  if (hit) return hit;
  if (FLOE.size > 80) FLOE.clear();
  const RX = f.rx * TS;
  const RY = f.ry * TS;
  const W = Math.ceil(RX * 2) + 4;
  const H = Math.ceil(RY * 2) + 8;
  const p = new Px(W, H);
  const cx = W / 2;
  const cy = RY + 2;
  const rim = (a: number) =>
    1 -
    0.13 * vnoise(Math.cos(a) * 2 + f.id * 3.1, Math.sin(a) * 2, 81) -
    0.05 * Math.sin(a * 5 + f.id);
  const inside = (x: number, y: number, dz: number) => {
    const dx = (x - cx) / RX;
    const dy = (y - cy - dz) / RY;
    const r = Math.hypot(dx, dy);
    return r <= rim(Math.atan2(dy, dx));
  };
  // Толщина: тёмный бок, видный снизу.
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (inside(x, y, 0)) continue;
      if (inside(x, y, -4)) p.set(x, y, y > cy + RY - 1 ? ICE[1] : ICE[2]);
    }
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!inside(x, y, -0.0)) continue;
      const dx = (x - cx) / RX;
      const dy = (y - cy) / RY;
      const r = Math.hypot(dx, dy);
      // Снег на льдине пятнами, по краю — голый лёд.
      const sn = vnoise(x * 0.18 + f.id, y * 0.22, 82) - r * 0.55;
      const lit = 0.55 - dx * 0.18 - dy * 0.22;
      if (sn > 0.12) p.set(x, y, toneOf(SNOW, lit + 0.15, x, y));
      else p.set(x, y, toneOf(ICE, lit + (r > 0.85 ? 0.12 : 0), x, y));
    }
  // Кромка: светлая сверху-слева, трещина поперёк.
  for (let y = 1; y < H; y++)
    for (let x = 1; x < W; x++)
      if (p.solid(x, y) && !p.solid(x, y - 1) && y < cy) p.set(x, y, WHITE);
  for (let i = 0; i < RX * 1.2; i++) {
    const x = cx - RX * 0.6 + i;
    const y = cy - 2 + Math.sin(i * 0.5 + f.id) * 1.5 + i * 0.12;
    if (p.solid(x, y)) p.set(x, y, alpha(ICE[1], 0.8));
  }
  p.outline(alpha(INK, 0.8));
  const cv = p.canvas();
  FLOE.set(key, cv);
  return cv;
}

/**
 * Вставки в слои пола и неба: метки замаха и мамонта (`f12-boss-fx.ts`).
 * Рисуют в игровых пикселях, `left/top` — мировой пиксель левого верха вида.
 */
export type F12Hook = (
  g: CanvasRenderingContext2D,
  sim: Sim,
  left: number,
  top: number,
  time: number,
) => void;
export const F12_FLOOR_HOOKS: F12Hook[] = [];
export const F12_SKY_HOOKS: F12Hook[] = [];

/** След скольжения героя: точки за последние ~1,2 с, своя на вылазку. */
const TRAIL = new WeakMap<Sim, { x: number; y: number; t: number }[]>();

registerZonePainter('f12_floor', (g, z, px, py, _s, time) => {
  const sim = paintSim();
  if (!sim) return true;
  const w = sim.world;
  const { left, top, gw, gh } = viewOf(g, z, px, py);
  const x0 = Math.floor(left / TS) - 2;
  const y0 = Math.floor(top / TS) - 2;
  const x1 = Math.ceil((left + gw) / TS) + 2;
  const y1 = Math.ceil((top + gh) / TS) + 2;
  const inView = (x: number, y: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
  const mk = (x: number, y: number) =>
    x < 0 || y < 0 || x >= w.w || y >= w.h ? 0 : w.mark[y * w.w + x];

  // Рябь течения протоки: блики плывут на север вместе со льдинами.
  g.fillStyle = css(WATER[4], 0.45);
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      if (mk(x, y) !== MK.current) continue;
      for (let k = 0; k < 2; k++) {
        const s = hash(x, y, 83 + k);
        const yy = (((s * TS - time * 22 * (0.7 + s * 0.6)) % TS) + TS) % TS;
        g.fillRect(Math.round(x * TS - left + 2 + s * 10), Math.round(y * TS - top + yy), 3, 1);
      }
    }

  // Трещины тонкого льда.
  const thin = f12Thin(sim);
  if (thin)
    for (const [i, v] of thin) {
      const x = i % w.w;
      const y = (i - x) / w.w;
      if (!inView(x, y)) continue;
      const stage = Math.min(2, Math.floor(v));
      // Перед проломом трещина дрожит.
      const sh = v > 2.4 ? Math.round(Math.sin(time * 40 + i) * 0.6) : 0;
      g.drawImage(crackCv(stage, (i * 7) & 3), x * TS - left + sh, y * TS - top);
      if (v % 1 > 0.5 && stage < 2) {
        g.globalAlpha = (v % 1) - 0.5;
        g.drawImage(crackCv(stage + 1, (i * 7) & 3), x * TS - left, y * TS - top);
        g.globalAlpha = 1;
      }
    }

  // Полыньи затягиваются: шуга, потом корка от краёв к середине.
  for (const hl of f12Holes(sim)) {
    const x = hl.i % w.w;
    const y = (hl.i - x) / w.w;
    if (!inView(x, y)) continue;
    const k = Math.min(1, hl.t / 22);
    const X = x * TS - left;
    const Y = y * TS - top;
    const n = Math.floor(k * 14);
    for (let s = 0; s < n; s++) {
      const a = hash(hl.i, s, 84);
      const b = hash(hl.i, s, 85);
      g.fillStyle = css(s % 3 ? ICE[3] : WHITE, 0.5 + k * 0.4);
      g.fillRect(
        Math.round(X + 1 + a * 13 + Math.sin(time + s) * 0.6),
        Math.round(Y + 1 + b * 13),
        2,
        1,
      );
    }
    if (k > 0.35) {
      const d = Math.round(((k - 0.35) / 0.65) * 8);
      g.fillStyle = css(THIN[3], 0.85);
      g.fillRect(X, Y, TS, d);
      g.fillRect(X, Y + TS - d, TS, d);
      g.fillRect(X, Y + d, d, TS - 2 * d);
      g.fillRect(X + TS - d, Y + d, d, TS - 2 * d);
      g.fillStyle = css(THIN[4], 0.7);
      if (d < 8) {
        g.fillRect(X + d, Y + d, TS - 2 * d, 1);
        g.fillRect(X + d, Y + d, 1, TS - 2 * d);
      }
    }
  }

  // Пролом Ледолома: сперва трещит, потом вода с обломками, потом
  // замерзает рядами (клетки уходят из списка).
  const broken = f12Broken(sim);
  if (broken && broken.size) {
    for (const [i, v] of broken) {
      const x = i % w.w;
      const y = (i - x) / w.w;
      if (!inView(x, y)) continue;
      const X = x * TS - left;
      const Y = y * TS - top;
      if (v < 0) {
        const sh = v > -0.25 ? Math.round(Math.sin(time * 50 + i) * 0.8) : 0;
        g.drawImage(crackCv(v > -0.4 ? 2 : 1, (i * 5) & 3), X + sh, Y);
        continue;
      }
      g.drawImage(openCv((i * 3) & 3), X, Y);
      // Кромка там, где сосед цел.
      g.fillStyle = css(ICE[4], 0.95);
      if (!broken.has(i - w.w) || (broken.get(i - w.w) ?? 0) < 0) {
        g.fillRect(X, Y, TS, 2);
        g.fillStyle = css(ICE[1], 0.9);
        g.fillRect(X, Y + 2, TS, 2);
        g.fillStyle = css(ICE[4], 0.95);
      }
      if (!broken.has(i + w.w) || (broken.get(i + w.w) ?? 0) < 0) g.fillRect(X, Y + TS - 1, TS, 1);
      if (!broken.has(i - 1) || (broken.get(i - 1) ?? 0) < 0) g.fillRect(X, Y, 1, TS);
      if (!broken.has(i + 1) || (broken.get(i + 1) ?? 0) < 0) g.fillRect(X + TS - 1, Y, 1, TS);
      // Обломки качаются и дрейфуют.
      for (let s = 0; s < 2; s++) {
        const a = hash(i, s, 86);
        const b = hash(i, s, 87);
        const fx = X + 2 + a * 9 + Math.sin(time * 0.9 + a * 9) * 1.5;
        const fy = Y + 3 + b * 8 + Math.cos(time * 0.7 + b * 9) * 1.2;
        g.drawImage(shardCv(Math.floor(a * 3)), Math.round(fx), Math.round(fy));
      }
    }
  }

  // Льдины протоки.
  for (const f of f12Floes(sim)) {
    const sx = f.x * TS - left;
    const sy = f.y * TS - top;
    if (sx < -60 || sy < -60 || sx > gw + 60 || sy > gh + 60) continue;
    const cv = floeCv(f);
    const bob = Math.round(Math.sin(time * 1.6 + f.ph) * 0.8);
    // Тень и пена вокруг.
    g.fillStyle = css(WATER[0], 0.55);
    g.beginPath();
    g.ellipse(sx, sy + 3, f.rx * TS + 2, f.ry * TS + 2, 0, 0, TAU);
    g.fill();
    g.fillStyle = css(WHITE, 0.35);
    for (let s = 0; s < 6; s++) {
      const a = (s / 6) * TAU + time * 0.4 + f.ph;
      g.fillRect(
        Math.round(sx + Math.cos(a) * (f.rx * TS + 2)),
        Math.round(sy + 2 + Math.sin(a) * (f.ry * TS + 2)),
        2,
        1,
      );
    }
    g.drawImage(cv, Math.round(sx - cv.width / 2), Math.round(sy - f.ry * TS - 2 + bob));
    if (f.lamp) {
      // Фонарь на шесте: шест, рамка, огонёк.
      const lx = Math.round(sx + f.rx * TS * 0.35);
      const ly = Math.round(sy - 2 + bob);
      g.fillStyle = css(WOOD[1]);
      g.fillRect(lx, ly - 12, 1, 12);
      g.fillStyle = css(INK);
      g.fillRect(lx - 2, ly - 17, 5, 6);
      const fl = 0.75 + 0.25 * Math.sin(time * 9 + f.id);
      g.fillStyle = css(FIRE[3], fl);
      g.fillRect(lx - 1, ly - 16, 3, 4);
      g.fillStyle = css(FIRE[4]);
      g.fillRect(lx, ly - 15, 1, 2);
    }
  }

  // Блики сияния на глади озера: широкие бирюзовые полосы медленно ползут
  // по льду — свет сияния сквозь свод. Полосы привязаны к миру, а не к
  // камере; только на озере (в гроте и чертоге своё освещение).
  if (w.rowArea[Math.floor(sim.hero.y)] === F12_LAKE) {
    const ax = Math.cos(0.5);
    const ay = Math.sin(0.5);
    const P = 260;
    const proj = (x: number, y: number) => x * ax + y * ay;
    const c0 = [
      proj(left, top),
      proj(left + gw, top),
      proj(left, top + gh),
      proj(left + gw, top + gh),
    ];
    const s0 = Math.min(...c0);
    const s1 = Math.max(...c0);
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const [ph, sp, wd, a] of [
      [0, 5, 46, 0.15],
      [131, -3.2, 28, 0.1],
    ] as const) {
      const off = ph + time * sp;
      for (let k = Math.floor((s0 - off - wd) / P); k * P + off - wd < s1; k++) {
        const s = k * P + off;
        const x0 = (s - wd) * ax - left;
        const y0 = (s - wd) * ay - top;
        const gr = g.createLinearGradient(x0, y0, x0 + ax * wd * 2, y0 + ay * wd * 2);
        const tw = 0.75 + 0.25 * Math.sin(time * 0.7 + k * 1.7 + ph);
        gr.addColorStop(0, 'rgba(62,240,200,0)');
        gr.addColorStop(0.5, `rgba(62,240,200,${(a * tw).toFixed(3)})`);
        gr.addColorStop(1, 'rgba(62,240,200,0)');
        g.fillStyle = gr;
        g.fillRect(0, 0, gw, gh);
      }
    }
    g.restore();
  }

  // След скольжения.
  const ice = f12Ice(sim);
  let tr = TRAIL.get(sim);
  if (!tr) {
    tr = [];
    TRAIL.set(sim, tr);
  }
  const h = sim.hero;
  if (ice.on && ice.slide > 0.4) {
    const last = tr[tr.length - 1];
    if (!last || Math.hypot(last.x - h.x, last.y - h.y) > 0.18)
      tr.push({ x: h.x, y: h.y, t: time });
  }
  while (tr.length && (time - tr[0].t > 1.4 || tr[0].t > time)) tr.shift();
  for (let k = 1; k < tr.length; k++) {
    const a = tr[k - 1];
    const b = tr[k];
    const life = 1 - (time - b.t) / 1.4;
    g.strokeStyle = css(WHITE, 0.35 * life);
    g.lineWidth = 1;
    for (const o of [-3, 3]) {
      g.beginPath();
      g.moveTo(Math.round(a.x * TS - left + o), Math.round(a.y * TS - top + 5));
      g.lineTo(Math.round(b.x * TS - left + o), Math.round(b.y * TS - top + 5));
      g.stroke();
    }
  }
  for (const f of F12_FLOOR_HOOKS) f(g, sim, left, top, time);
  return true;
});

// ---------------------------------------------------------------------------
// Слой неба (`f12_sky`, поверх темноты): мороз на герое (иней, три доли над
// головой, глыба при заморозке), вьюга с порывами, ленты сияния Купола,
// ледяная пыль в воздухе.
// ---------------------------------------------------------------------------

/** Снежинка доли мороза 7×7: пустая и полная. */
const FLAKE: HTMLCanvasElement[] = [];
function flakeCv(full: boolean): HTMLCanvasElement {
  const k = full ? 1 : 0;
  if (FLAKE[k]) return FLAKE[k];
  const p = new Px(9, 9);
  const c = full ? TEAL[4] : alpha(ICE[1], 0.9);
  const d = full ? TEAL[2] : alpha(INK, 0.7);
  for (let a = 0; a < 6; a++) {
    const ang = (a / 6) * TAU - Math.PI / 2;
    for (let r = 0; r <= 3.6; r += 0.5) p.set(4 + Math.cos(ang) * r, 4 + Math.sin(ang) * r, c);
  }
  p.set(4, 4, full ? WHITE : d);
  p.outline(full ? alpha(TEAL[0], 0.95) : alpha(INK, 0.85));
  FLAKE[k] = p.canvas();
  return FLAKE[k];
}

/** Глыба льда на замёрзшем герое, трещины по стадии 0…2. */
const BLOCK: HTMLCanvasElement[] = [];
function blockCv(stage: number): HTMLCanvasElement {
  if (BLOCK[stage]) return BLOCK[stage];
  const W = 24;
  const H = 30;
  const p = new Px(W, H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      // Гранёная глыба: срезанные углы.
      const cut = Math.min(x, W - 1 - x) + Math.min(y, H - 1 - y) * 0.6;
      if (cut < 3) continue;
      const k = 0.45 + (x < 7 ? 0.25 : 0) - y * 0.008 + (x + y * 2 > 46 ? -0.15 : 0);
      const c = toneOf(ICE, k, x, y);
      p.set(x, y, alpha(c, 0.55));
    }
  // Блики граней.
  p.line(4, 3, 4, 20, alpha(WHITE, 0.8));
  p.line(5, 2, 12, 2, alpha(WHITE, 0.7));
  p.line(18, 5, 18, 12, alpha(ICE[4], 0.6));
  for (let s = 0; s < stage * 3; s++) {
    let x = 8 + hash(stage, s, 88) * 8;
    let y = 6 + hash(stage, s, 89) * 16;
    let a = hash(stage, s, 90) * TAU;
    for (let t = 0; t < 7; t++) {
      x += Math.cos(a);
      y += Math.sin(a);
      a += (hash(s, t, 91) - 0.5) * 0.9;
      p.set(x, y, WHITE);
    }
  }
  p.outline(alpha(ICE[0], 0.9));
  BLOCK[stage] = p.canvas();
  return BLOCK[stage];
}

registerZonePainter('f12_sky', (g, z, px, py, _s, time) => {
  const sim = paintSim();
  if (!sim) return true;
  const { left, top, gw, gh } = viewOf(g, z, px, py);
  const h = sim.hero;
  const hx0 = Math.round(h.x * TS - left);
  const hy0 = Math.round(h.y * TS - top);

  // Ленты сияния Купола: пятно света на полу и занавес вверх.
  const bands = f12Aurora(sim);
  if (bands.length) {
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const b of bands) {
      const bx = b.x * TS - left;
      const by = b.y * TS - top;
      const R = 3.4 * TS;
      const gr = g.createRadialGradient(bx, by, 2, bx, by, R);
      gr.addColorStop(0, css(AURORA[2], 0.32 * b.k));
      gr.addColorStop(0.6, css(AURORA[1], 0.14 * b.k));
      gr.addColorStop(1, css(AURORA[0], 0));
      g.fillStyle = gr;
      g.beginPath();
      g.ellipse(bx, by, R, R * 0.7, 0, 0, TAU);
      g.fill();
      // Занавес: вертикальные лучи, волна бежит по ним.
      for (let k = -9; k <= 9; k++) {
        const xx = bx + k * 3 + Math.sin(time * 1.3 + k * 0.5) * 3;
        const hgt = 34 + 16 * Math.sin(time * 0.9 + k * 0.7);
        const a = 0.16 * b.k * (1 - Math.abs(k) / 10) * (0.6 + 0.4 * Math.sin(time * 3 + k));
        const lg = g.createLinearGradient(0, by - hgt - 20, 0, by);
        lg.addColorStop(0, css(TEAL[3], 0));
        lg.addColorStop(0.5, css(AURORA[3], a));
        lg.addColorStop(1, css(AURORA[2], a * 0.4));
        g.fillStyle = lg;
        g.fillRect(Math.round(xx), Math.round(by - hgt - 20), 2, hgt + 20);
      }
    }
    g.restore();
  }

  // Ледяная пыль: редкие искры в воздухе (вне вьюги).
  const storm = f12Storm(sim);
  if (storm.k < 0.3) {
    for (let i = 0; i < 26; i++) {
      const s = hash(i, 1, 92);
      const xx = ((((s * 997 + time * (4 + s * 6) - left * 0.9) % gw) + gw) % gw) | 0;
      const yy = ((((hash(i, 2, 92) * 991 + time * (3 + s * 4) - top * 0.9) % gh) + gh) % gh) | 0;
      const tw = Math.sin(time * (2 + s * 3) + i);
      if (tw < 0.3) continue;
      g.fillStyle = css(i % 4 ? ICE[4] : AURORA[3], 0.35 * tw);
      g.fillRect(xx, yy, 1, 1);
    }
  }

  // Вьюга: пелена и косой снег; порыв — сперва стрелки по ветру, потом
  // снег гуще и вдоль порыва.
  if (storm.k > 0.02) {
    const k = storm.k;
    const gust = storm.gust;
    const push = !!gust && gust.t > gust.warn;
    g.fillStyle = css(SNOW[3], 0.1 * k + (push ? 0.06 : 0));
    g.fillRect(0, 0, gw, gh);
    const ang = gust ? gust.ang : Math.PI / 2 + 0.55;
    const ux = Math.cos(ang);
    const uy = Math.sin(ang);
    const n = Math.round((push ? 220 : 130) * k);
    const sp = push ? 260 : 120;
    for (let i = 0; i < n; i++) {
      const s = hash(i, 3, 93);
      const d = 0.5 + s * 0.8;
      const ox = hash(i, 4, 93) * (gw + 80);
      const oy = hash(i, 5, 93) * (gh + 80);
      const xx =
        ((((ox + ux * time * sp * d - left * 0.15) % (gw + 80)) + gw + 80) % (gw + 80)) - 40;
      const yy =
        ((((oy + uy * time * sp * d - top * 0.15) % (gh + 80)) + gh + 80) % (gh + 80)) - 40;
      const L = (push ? 7 : 3) * d;
      g.strokeStyle = css(i % 5 ? SNOW[4] : WHITE, 0.45 + 0.4 * s);
      g.lineWidth = d > 1 ? 2 : 1;
      g.beginPath();
      g.moveTo(Math.round(xx), Math.round(yy));
      g.lineTo(Math.round(xx - ux * L), Math.round(yy - uy * L));
      g.stroke();
    }
    if (gust && !push) {
      // Предупреждение: три шеврона у героя по ходу порыва, наливаются.
      const w = gust.t / gust.warn;
      g.strokeStyle = css(WHITE, 0.35 + 0.55 * w);
      g.lineWidth = 2;
      for (let c = 0; c < 3; c++) {
        const off = 18 + c * 9 + ((time * 30) % 9);
        const cx = hx0 + ux * off;
        const cy = hy0 - 8 + uy * off;
        const nx = -uy;
        const ny = ux;
        g.beginPath();
        g.moveTo(Math.round(cx - ux * 4 + nx * 5), Math.round(cy - uy * 4 + ny * 5));
        g.lineTo(Math.round(cx), Math.round(cy));
        g.lineTo(Math.round(cx - ux * 4 - nx * 5), Math.round(cy - uy * 4 - ny * 5));
        g.stroke();
      }
    }
  }

  // Мороз на герое.
  const fr = f12Frost(sim);
  if (fr.frozen > 0) {
    const stage = fr.frozen > 0.66 ? 0 : fr.frozen > 0.33 ? 1 : 2;
    const cv = blockCv(stage);
    const sh = stage === 2 ? Math.round(Math.sin(time * 45) * 0.7) : 0;
    g.drawImage(cv, hx0 - 12 + sh, hy0 - 26);
  }
  if (fr.frost > 0.01 || fr.frozen > 0) {
    // Иней: искры вокруг фигуры, гуще с каждой долей.
    const n = Math.round(fr.frost * 5);
    for (let i = 0; i < n; i++) {
      const a = hash(i, 6, 94) * TAU + time * 0.3;
      const r = 6 + hash(i, 7, 94) * 5;
      const tw = 0.5 + 0.5 * Math.sin(time * 5 + i * 1.7);
      g.fillStyle = css(i % 2 ? WHITE : TEAL[4], 0.4 + 0.5 * tw);
      g.fillRect(
        Math.round(hx0 + Math.cos(a) * r),
        Math.round(hy0 - 10 + Math.sin(a) * r * 1.3),
        1,
        1,
      );
    }
    // Три доли над головой: полная — бирюзовая, часть — наливается снизу.
    const full = flakeCv(true);
    const empty = flakeCv(false);
    const top0 = hy0 - 38;
    for (let i = 0; i < 3; i++) {
      const x = hx0 - 15 + i * 10;
      const f = fr.frozen > 0 ? 1 : Math.max(0, Math.min(1, fr.frost - i));
      g.drawImage(empty, x, top0);
      if (f > 0) {
        const hh = Math.max(1, Math.round(9 * f));
        g.drawImage(full, 0, 9 - hh, 9, hh, x, top0 + 9 - hh, 9, hh);
      }
    }
  }
  for (const f of F12_SKY_HOOKS) f(g, sim, left, top, time);
  return true;
});

// ---------------------------------------------------------------------------
// Иконки вещей 10×10.
// ---------------------------------------------------------------------------

registerItemArt('f12mat', () => {
  // Осколок вечного льда: гранёный клин со светом внутри.
  const p = new Px(10, 10);
  const pts: [number, number][] = [
    [5, 0],
    [8, 3],
    [7, 8],
    [4, 9],
    [2, 5],
  ];
  for (let y = 0; y < 10; y++)
    for (let x = 0; x < 10; x++) {
      let ins = true;
      for (let k = 0; k < pts.length; k++) {
        const [ax, ay] = pts[k];
        const [bx, by] = pts[(k + 1) % pts.length];
        if ((bx - ax) * (y + 0.5 - ay) - (by - ay) * (x + 0.5 - ax) < 0) ins = false;
      }
      if (!ins) continue;
      const k = 0.7 - x * 0.06 + (x > 5 ? -0.15 : 0.05) - y * 0.02;
      p.set(x, y, toneOf(ICE, k, x, y));
    }
  p.line(5, 1, 5, 8, TEAL[3]);
  p.set(5, 4, TEAL[4]);
  p.set(4, 2, WHITE);
  p.outline(hx('#0a1830'));
  return p;
});

registerItemArt('f12_crystal', () => {
  // Кристалл сияния: две зелёные призмы.
  const p = new Px(10, 10);
  const prism = (x0: number, y0: number, h: number) => {
    for (let y = 0; y < h; y++) {
      const w = y < 2 ? y : 2;
      for (let x = -w; x <= w; x++) {
        const k = 0.75 - (x + 2) * 0.12 - y * 0.03;
        p.set(x0 + x, y0 + y, toneOf(AURORA, k, x, y));
      }
    }
  };
  prism(6, 1, 8);
  prism(3, 3, 6);
  p.set(5, 2, WHITE);
  p.set(2, 4, AURORA[4]);
  p.outline(hx('#062a22'));
  return p;
});

registerItemArt('f12_fur', () => {
  // Песцовый мех: свёрнутая шкурка с хвостом.
  const p = new Px(10, 10);
  p.ell(4.5, 5.5, 3.6, 2.8, (x, y) => toneOf(SNOW, 0.85 - (x - 2) * 0.05 - (y - 4) * 0.08, x, y));
  for (let i = 0; i < 4; i++) p.set(7 + i * 0.6, 4 - i, SNOW[4 - (i >> 1)]);
  p.set(9, 1, WHITE);
  p.set(8, 2, WHITE);
  p.line(2, 5, 6, 5, alpha(SNOW[1], 0.7));
  p.set(3, 4, WHITE);
  p.outline(hx('#1a2440'));
  return p;
});

registerItemArt('f12_fish', () => {
  // Мороженая рыба: серебро в инее, хвост вверх.
  const p = new Px(10, 10);
  p.ell(4.5, 5.5, 3.5, 2, (x, y) => toneOf(ICE, 0.8 - (y - 4) * 0.18, x, y));
  p.set(8, 4, ICE[3]);
  p.set(9, 3, ICE[3]);
  p.set(8, 6, ICE[2]);
  p.set(9, 7, ICE[2]);
  p.set(2, 5, INK);
  p.set(4, 4, WHITE);
  p.set(6, 6, WHITE);
  p.line(3, 6, 6, 6, alpha(ICE[1], 0.6));
  p.outline(hx('#0a1830'));
  return p;
});

registerItemArt('f12_tea', () => {
  // Брусничный сбитень: деревянная кружка, пар.
  const p = new Px(10, 10);
  p.rect(2, 4, 6, 9, WOOD[2]);
  p.rect(2, 4, 2, 9, WOOD[3]);
  p.rect(6, 4, 6, 9, WOOD[1]);
  p.rect(2, 4, 6, 4, hx('#8a1a2a'));
  p.set(3, 4, hx('#d0405a'));
  p.rect(7, 5, 8, 5, WOOD[1]);
  p.rect(8, 6, 8, 7, WOOD[1]);
  p.set(4, 2, alpha(WHITE, 0.6));
  p.set(5, 1, alpha(WHITE, 0.5));
  p.set(4, 0, alpha(WHITE, 0.35));
  p.outline(hx('#1a0c06'));
  return p;
});

registerItemArt('f12_quill', () => {
  // Ледяная игла ежа: тонкая наискось, белое остриё.
  const p = new Px(10, 10);
  for (let i = 0; i < 8; i++) {
    p.set(1 + i, 8 - i, ICE[2 + (i > 4 ? 1 : 0)]);
    if (i < 6) p.set(1 + i, 9 - i, ICE[1]);
  }
  p.set(8, 1, WHITE);
  p.set(9, 0, WHITE);
  p.outline(hx('#0a1830'));
  return p;
});

registerItemArt('f12_tusk', () => {
  // Бивень мамонта: изогнутая кость, тёмный корень.
  const p = new Px(10, 10);
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const x = 1.5 + t * 7;
    const y = 8 - Math.sin(t * Math.PI * 0.9) * 5 - t * 1.5;
    const r = 1.4 * (1 - t * 0.6);
    p.ell(x, y, r, r, i < 2 ? BONE[1] : BONE[3 - (i > 6 ? 0 : 1)]);
  }
  p.set(4, 3, BONE[4]);
  p.set(5, 2, BONE[4]);
  p.outline(hx('#2a2018'));
  return p;
});
