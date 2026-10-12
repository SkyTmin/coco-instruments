// Этаж 12 — мини-3D риг (эллипсоиды, луч на пиксель, буфер глубины), цвет и
// шум. Перенесён из `f12-art.ts` как есть (анимации мобов 12): на нём и
// мамонт, и мобы этажа (`f12-mobkit.ts`). Правка здесь меняет босса — лист
// мамонта до и после обязан совпасть до пикселя.

import { Px } from '../dungeon-art';
import { frameLRU } from '../dungeon-paint';
import type { MobPose } from '../dungeon-paint';

export type RGBA = [number, number, number, number];
export const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Цвет.
// ---------------------------------------------------------------------------

export function hx(h: string, a = 255): RGBA {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255, a];
}
export const alpha = (c: RGBA, k: number): RGBA => [c[0], c[1], c[2], Math.round(255 * k)];
export function mixc(a: RGBA, b: RGBA, k: number): RGBA {
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
    Math.round(a[3] + (b[3] - a[3]) * k),
  ];
}
/** Пять тонов от тени к блику. */
export const ramp = (...c: string[]): RGBA[] => c.map((s) => hx(s));
export const css = (c: RGBA, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

export const INK = hx('#0b1020');
export const WHITE = hx('#ffffff');

/** Снег под луной: тень → блик. Белым он становится только у огня. */
export const SNOW = ramp('#34466c', '#4f648e', '#7088b2', '#9cb2d4', '#cad8ee');
/** Лёд. */
export const ICE = ramp('#163860', '#225486', '#3672a6', '#5c9ccb', '#a0d0ee');
/** Тонкий лёд: темнее, вода близко. */
export const THIN = ramp('#0a1a34', '#112c54', '#1c4272', '#356494', '#72a2cc');
/** Вода. */
export const WATER = ramp('#040e20', '#08203c', '#0f3258', '#1d4f7c', '#4f8bbd');
/** Камень (сине-серый). */
export const STONE = ramp('#1c2232', '#2e3648', '#454f66', '#5f6b84', '#8390aa');
/** Тёмная порода стен. */
export const ROCK = ramp('#0e1220', '#1a2133', '#283249', '#3a4762', '#56658a');
/** Сияние. */
export const AURORA = ramp('#0d5a4a', '#16a07a', '#3ef0b0', '#9affd8', '#e6fff4');
export const TEAL = ramp('#0b4a5a', '#15798a', '#2fb8c8', '#7ae8f0', '#d8fcff');
/** Тёплое: жаровни, костры. */
export const FIRE = ramp('#6a1a08', '#c8461a', '#ff8a2a', '#ffc65a', '#fff3c4');
/** Дерево (сани, лодки, лебёдка). */
export const WOOD = ramp('#2a1608', '#4a2a12', '#6e4220', '#946034', '#b8844e');
/** Мех (шкуры, мамонт). */
export const FUR = ramp('#1e1008', '#3a2012', '#5a361c', '#7e5230', '#a87648');
/** Кость, бивень. */
export const BONE = ramp('#6a6050', '#9a8e74', '#c8bc9a', '#e6dcc0', '#fffaea');
/** Красная охра (орнамент шаманки). */
export const OCHRE = ramp('#3a0e0a', '#6a1c12', '#a0301c', '#d05a2a', '#f08a4a');

// ---------------------------------------------------------------------------
// Шум (детерминированный: один рисунок на одну клетку мира).
// ---------------------------------------------------------------------------

export function hash(x: number, y: number, s = 0): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Плавный шум по мировым пикселям: дюны снега, разводы льда. */
export function vnoise(x: number, y: number, s: number): number {
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

export const fbm = (x: number, y: number, s: number) =>
  vnoise(x, y, s) * 0.55 +
  vnoise(x * 2.1, y * 2.1, s + 7) * 0.3 +
  vnoise(x * 4.3, y * 4.3, s + 13) * 0.15;

/** Порядковый дизеринг 4×4: тон между ступенями без каши. */
export const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(
  (v) => (v + 0.5) / 16,
);
export const dither = (x: number, y: number) => BAYER[(y & 3) * 4 + (x & 3)];

/**
 * Тон по доле 0…1. Без дизеринга — ступени ложатся пятнами по шуму, как
 * у пиксель-арта; `dith` — шахматка только узкой полосой у самого порога.
 */
export function toneOf(r: RGBA[], k: number, x: number, y: number, dith = false): RGBA {
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
export const CAM_C = 0.77;
export const CAM_S = 0.64;
/** К зрителю. */
export const VIEW: V3 = [0, CAM_S, CAM_C];
export type V3 = [number, number, number];
/** К свету: сверху, слева, спереди. */
export const LIGHT: V3 = (() => {
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

export interface Axes {
  c: V3;
  e: [V3, V3, V3];
  r: V3;
}

export function axesOf(pt: Part, face: number): Axes {
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
export function project(x: number, y: number, z: number): [number, number, number] {
  return [x, y * CAM_C - z * CAM_S, y * CAM_S + z * CAM_C];
}

/** Точка в осях модели → мир (поворот на `face`). */
export function toWorld(x: number, y: number, z: number, face: number): V3 {
  const cf = Math.cos(face);
  const sf = Math.sin(face);
  return [x * cf - y * sf, x * sf + y * cf, z];
}

export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * Рабочие буферы рига: глубина, номер части, свечение и холст до обрезки —
 * одни на все кадры (кадр обрезается в свой холст, рабочий — не уходит
 * наружу). Новые массивы на каждый кадр — это сборщик мусора в бою.
 */
export interface RigBufs {
  n: number;
  zb: Float32Array;
  idb: Int16Array;
  glow: Uint8Array;
  px: Map<string, Px>;
}
export const rigBufs = (): RigBufs => ({
  n: 0,
  zb: new Float32Array(0),
  idb: new Int16Array(0),
  glow: new Uint8Array(0),
  px: new Map(),
});
/** Общие — для кадра, нарисованного сразу; свои — у кадра «на потом» (`rigJob`). */
export const RIG_BUF = rigBufs();
export function rigBuf(n: number, B = RIG_BUF) {
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
export function rigPx(w: number, h: number, B = RIG_BUF): Px {
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
export interface RigJob {
  step: (ms: number) => boolean;
  out: () => RigOut;
}
export function rigJob(
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
export const dirN = (face: number, n: number) => ((Math.round((face / TAU) * n) % n) + n) % n;
export const dirAng = (d: number, n: number) => (d / n) * TAU;

/** Плавная кривая 0…1. */
export const ease = (k: number) => {
  const c = Math.max(0, Math.min(1, k));
  return c * c * (3 - 2 * c);
};
export const easeOut = (k: number) => 1 - (1 - Math.max(0, Math.min(1, k))) ** 3;
export const clamp01 = (k: number) => Math.max(0, Math.min(1, k));
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** Кеш кадров: ключ — всё, что меняет картинку. */
export type Cached = {
  img: HTMLCanvasElement;
  lit: HTMLCanvasElement | null;
  eye: [number, number] | null;
  /** Сдвиг обрезанного кадра от левого верха полного холста. */
  dx: number;
  dy: number;
};
export function cachedRig(
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
export const f24 = (t: number) => Math.max(0, Math.floor(t * 24));

/** Вид моба: элита — иней с синевой, альбинос — белый. */
export function lookRamp(r: RGBA[], look: MobPose['look']): RGBA[] {
  if (look === 'albino') return r.map((c) => mixc(c, hx('#f4f8ff'), 0.6));
  if (look === 'elite')
    return r.map((c, i) => mixc(c, i > 2 ? hx('#bfe8ff') : hx('#2a3a8a'), 0.35));
  return r;
}

export type Eye = { x: number; y: number; z: number; c: RGBA; r?: number };
/** Экранная точка модели в кадре: x, y и глубина (к зрителю больше). */
export type Scr = (x: number, y: number, z: number) => [number, number, number];
/** Для рисунка поверх: слой свечения (создаётся по требованию) и глубина тела. */
export interface PostFx {
  lit: () => Px;
  /** Глубина ближней поверхности тела в пикселе кадра, −1e9 — пусто. */
  z: (x: number, y: number) => number;
}
export interface Build {
  parts: Part[];
  eyes?: Eye[];
  clip?: number;
  /** Рисунок поверх (звёзды, брызги, линии хода) в координатах кадра. */
  post?: (p: Px, scr: Scr, fx: PostFx) => void;
  /** Точки модели, которые кадр обязан вместить (след удара). */
  extent?: V3[];
}
export interface Canvas {
  w: number;
  h: number;
  ox: number;
  oy: number;
}
