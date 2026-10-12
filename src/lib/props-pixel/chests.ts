// Пиксельные сундуки: обычный, редкий, эпический, легендарный и тёмный
// сундук-загадка — одна модель, одна поза и один кадр (ярус меняется
// подменой под вспышкой, сундук не прыгает). Приём — как у питомцев
// (`pets-pixel/rig.ts`): луч на пиксель, буфер глубины, тон — НОМЕР ступени
// палитры, швы, кант света сверху-слева, контур «по соседу». Отличия:
//   * камера выше (наклон 0,42, у питомцев 0,27): видно крышку и нутро;
//   * тела — выпуклые многогранники: ящик (три пары плоскостей), крышка —
//     полуцилиндр, драгоценности — эллипсоиды с гранями; у каждого тела
//     своя система координат (сундук → крышка → накладка замка), поэтому
//     крышка честно ходит на заднем шарнире, а накладка — на крышке;
//   * свет изнутри: щели досок, скважина и щель под крышкой помечаются
//     «светящимися» и горят цветом редкости до того, как крышка откроется;
//     потом свет идёт вверх из проёма столбом.
// Всё детерминировано: ни `Math.random`, ни времени. Запекание —
// `scripts/props-pixel/bake.ts -- --set chests`. Логика сцены — в
// `.claude/rules/props-chests.md`.

import {
  add,
  bump,
  clamp01,
  dith,
  dot,
  hash,
  hx,
  kf,
  mixc,
  newFrame,
  norm,
  ramp,
  rimLight,
  seams,
  selOutline,
  toPx,
} from '../pets-pixel/rig';
import type { Frame, RGBA, V3 } from '../pets-pixel/rig';
import { Px } from '../dungeon-art';
import type { Canvas, Res, StripDef } from './types';

// ---------------------------------------------------------------------------
// Полосы.
// ---------------------------------------------------------------------------

/**
 * Малая — значки (30, 58 точек), крупная — сцена и витрина (210, 240):
 * рамка 120 при 240 точках — ровно ×6 на DPR 3 и ×4 на DPR 2.
 */
export const RES: { s: Canvas; l: Canvas } = {
  s: { box: 48, cw: 128, ch: 144, bx: 40, by: 78 },
  l: { box: 120, cw: 320, ch: 360, bx: 100, by: 195 },
};

export type Tier = 'common' | 'rare' | 'epic' | 'legend';
export type Kind = Tier | 'mystery';
export const TIERS: Tier[] = ['common', 'rare', 'epic', 'legend'];
export const KINDS: Kind[] = ['common', 'rare', 'epic', 'legend', 'mystery'];

/** Метки разовых: ключ повернулся, защёлка, крышка пошла, пик света. */
export const OPEN_MARKS: Record<Tier, Record<string, number>> = {
  common: { turn: 1, latch: 6, lidOpen: 10, peak: 18 },
  rare: { turn: 1, latch: 6, lidOpen: 10, peak: 11 },
  epic: { turn: 1, latch: 6, lidOpen: 18, peak: 19 },
  legend: { turn: 1, latch: 6, lidOpen: 25, peak: 26 },
};
const OPEN_N: Record<Tier, number> = { common: 26, rare: 30, epic: 40, legend: 54 };
const SPIN_N = 22;

// ---------------------------------------------------------------------------
// Камера и свет (своя камера: выше, чем у питомцев).
// ---------------------------------------------------------------------------

const EL = 0.42;
const CE = Math.cos(EL);
const SE = Math.sin(EL);
const VIEWC: V3 = [0, CE, SE];
/** Свет сверху-слева, выше, чем у питомцев: верх крышки светлее лицевой стенки. */
const LIGHTC: V3 = norm([-0.5, 0.35, 0.8]);
const HV: V3 = norm(add(LIGHTC, VIEWC));
/** Поворот сундука в покое: перёд к левому краю кадра, виден правый торец. */
export const YAW0 = -0.42;

// ---------------------------------------------------------------------------
// Аффинные кадры: мир = o + m·местная.
// ---------------------------------------------------------------------------

type M3 = number[];
interface Xf {
  m: M3;
  o: V3;
}
const I3: M3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
function mm(a: M3, b: M3): M3 {
  const r = new Array<number>(9);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return r;
}
const mv = (a: M3, v: V3): V3 => [
  a[0] * v[0] + a[1] * v[1] + a[2] * v[2],
  a[3] * v[0] + a[4] * v[1] + a[5] * v[2],
  a[6] * v[0] + a[7] * v[1] + a[8] * v[2],
];
const mtv = (a: M3, v: V3): V3 => [
  a[0] * v[0] + a[3] * v[1] + a[6] * v[2],
  a[1] * v[0] + a[4] * v[1] + a[7] * v[2],
  a[2] * v[0] + a[5] * v[1] + a[8] * v[2],
];
function inv3(m: M3): M3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const k = 1 / det;
  return [
    A * k,
    -(b * i - c * h) * k,
    (b * f - c * e) * k,
    B * k,
    (a * i - c * g) * k,
    -(a * f - c * d) * k,
    C * k,
    -(a * h - b * g) * k,
    (a * e - b * d) * k,
  ];
}
const xc = (a: Xf, b: Xf): Xf => ({ m: mm(a.m, b.m), o: add(a.o, mv(a.m, b.o)) });
const xT = (x: number, y: number, z: number): Xf => ({ m: I3, o: [x, y, z] });
const xS = (x: number, y: number, z: number): Xf => ({ m: [x, 0, 0, 0, y, 0, 0, 0, z], o: [0, 0, 0] });
/** Вокруг x: +y (перёд) уходит к +z (вверх). */
function xRx(a: number): Xf {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { m: [1, 0, 0, 0, c, -s, 0, s, c], o: [0, 0, 0] };
}
/** Вокруг вертикали, как `yawZ` рига: + — передом вправо. */
function xRz(a: number): Xf {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { m: [c, s, 0, -s, c, 0, 0, 0, 1], o: [0, 0, 0] };
}
/** Крен в плоскости кадра, как `rollY` рига. */
function xRy(a: number): Xf {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { m: [c, 0, s, 0, 1, 0, -s, 0, c], o: [0, 0, 0] };
}
const apply = (x: Xf, p: V3): V3 => add(x.o, mv(x.m, p));

// ---------------------------------------------------------------------------
// Тела: пересечение выпуклых ограничений в местных координатах.
// ---------------------------------------------------------------------------

/** Пара плоскостей по оси: lo ≤ p[ax] ≤ hi. */
interface Slab {
  k: 0;
  ax: number;
  lo: number;
  hi: number;
}
/** Эллиптический цилиндр вдоль оси `ax`; сечение — по осям `j`, `l`. */
interface Cyl {
  k: 1;
  j: number;
  l: number;
  cj: number;
  cl: number;
  a: number;
  b: number;
}
interface Ell {
  k: 2;
  c: V3;
  r: V3;
}
/** Полупространство n·p ≤ d. */
interface Half {
  k: 3;
  n: V3;
  d: number;
}
type Con = Slab | Cyl | Ell | Half;

/** Шейдер: сдвиг тона по местной точке и нормали; может сменить палитру, свет, класс. */
type Shader = (L: V3, nl: V3, k: number) => number;
let SH_PAL = 0;
let SH_EMI = 0;
let SH_MAT = 0;

interface Prim {
  o: V3;
  m: M3;
  inv: M3;
  cons: Con[];
  pal: number;
  id: number;
  mat: number;
  sh?: Shader;
  gloss?: number;
  facet?: boolean;
  bias?: number;
  /** Сфера-оболочка в мире (пиксели кадра). */
  bc: V3;
  br: number;
}

/** Классы пикселей: что светится, что блестит, что внутри. */
const M_WOOD = 0;
const M_METAL = 1;
const M_GEM = 2;
const M_IN = 3;
const M_LOOT = 4;
const M_KEY = 5;

function prim(
  x: Xf,
  cons: Con[],
  lc: V3,
  lr: number,
  pal: number,
  id: number,
  mat: number,
  opt: { sh?: Shader; gloss?: number; facet?: boolean; bias?: number } = {},
): Prim {
  const sc = Math.max(
    Math.hypot(x.m[0], x.m[3], x.m[6]),
    Math.hypot(x.m[1], x.m[4], x.m[7]),
    Math.hypot(x.m[2], x.m[5], x.m[8]),
  );
  return {
    o: x.o,
    m: x.m,
    inv: inv3(x.m),
    cons,
    pal,
    id,
    mat,
    ...opt,
    bc: apply(x, lc),
    br: lr * sc,
  };
}

function boxP(
  x: Xf,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number,
  pal: number,
  id: number,
  mat: number,
  opt: { sh?: Shader; gloss?: number; bias?: number } = {},
): Prim {
  return prim(
    x,
    [
      { k: 0, ax: 0, lo: x0, hi: x1 },
      { k: 0, ax: 1, lo: y0, hi: y1 },
      { k: 0, ax: 2, lo: z0, hi: z1 },
    ],
    [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2],
    Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2,
    pal,
    id,
    mat,
    opt,
  );
}

function ellP(
  x: Xf,
  c: V3,
  r: V3,
  pal: number,
  id: number,
  mat: number,
  opt: { sh?: Shader; gloss?: number; facet?: boolean; bias?: number } = {},
  extra: Con[] = [],
): Prim {
  return prim(x, [{ k: 2, c, r }, ...extra], c, Math.max(r[0], r[1], r[2]), pal, id, mat, opt);
}

// Кадр: буферы рига + свои (свет щелей, класс пикселя).
interface CFrame extends Frame {
  emi: Uint8Array;
  mat: Uint8Array;
}
function newCFrame(w: number, h: number): CFrame {
  const f = newFrame(w, h) as CFrame;
  f.emi = new Uint8Array(w * h);
  f.mat = new Uint8Array(w * h);
  return f;
}

let PALS: RGBA[][] = [];

function raster(f: CFrame, P: Prim, ox: number, oy: number): void {
  const { w, h, zb } = f;
  const bx = ox + P.bc[0];
  const by = oy + P.bc[1] * SE - P.bc[2] * CE;
  const R = P.br + 1.5;
  const x0 = Math.max(0, Math.floor(bx - R));
  const x1 = Math.min(w - 1, Math.ceil(bx + R));
  const y0 = Math.max(0, Math.floor(by - R));
  const y1 = Math.min(h - 1, Math.ceil(by + R));
  if (x0 > x1 || y0 > y1) return;
  const inv = P.inv;
  const qd = mv(inv, VIEWC);
  const cons = P.cons;
  const nc = cons.length;
  for (let py = y0; py <= y1; py++) {
    const sy = py + 0.5 - oy;
    for (let px = x0; px <= x1; px++) {
      const sx = px + 0.5 - ox;
      const q0 = mv(inv, [sx - P.o[0], sy * SE - P.o[1], -sy * CE - P.o[2]]);
      let lo = -1e9;
      let hi = 1e9;
      let hc = -1;
      let miss = false;
      for (let c = 0; c < nc && !miss; c++) {
        const C = cons[c];
        let a = -1e9;
        let b = 1e9;
        if (C.k === 0) {
          const s0 = q0[C.ax];
          const ds = qd[C.ax];
          if (Math.abs(ds) < 1e-9) {
            if (s0 < C.lo || s0 > C.hi) miss = true;
            continue;
          }
          const t1 = (C.lo - s0) / ds;
          const t2 = (C.hi - s0) / ds;
          a = Math.min(t1, t2);
          b = Math.max(t1, t2);
        } else if (C.k === 1) {
          const u0 = (q0[C.j] - C.cj) / C.a;
          const du = qd[C.j] / C.a;
          const v0 = (q0[C.l] - C.cl) / C.b;
          const dv = qd[C.l] / C.b;
          const A = du * du + dv * dv;
          const B = 2 * (u0 * du + v0 * dv);
          const Cc = u0 * u0 + v0 * v0 - 1;
          if (A < 1e-12) {
            if (Cc > 0) miss = true;
            continue;
          }
          const disc = B * B - 4 * A * Cc;
          if (disc < 0) {
            miss = true;
            continue;
          }
          const sq = Math.sqrt(disc);
          a = (-B - sq) / (2 * A);
          b = (-B + sq) / (2 * A);
        } else if (C.k === 2) {
          const u0 = (q0[0] - C.c[0]) / C.r[0];
          const v0 = (q0[1] - C.c[1]) / C.r[1];
          const w0 = (q0[2] - C.c[2]) / C.r[2];
          const du = qd[0] / C.r[0];
          const dv = qd[1] / C.r[1];
          const dw = qd[2] / C.r[2];
          const A = du * du + dv * dv + dw * dw;
          const B = 2 * (u0 * du + v0 * dv + w0 * dw);
          const Cc = u0 * u0 + v0 * v0 + w0 * w0 - 1;
          const disc = B * B - 4 * A * Cc;
          if (disc < 0) {
            miss = true;
            continue;
          }
          const sq = Math.sqrt(disc);
          a = (-B - sq) / (2 * A);
          b = (-B + sq) / (2 * A);
        } else {
          const s0 = dot(C.n, q0);
          const dn = dot(C.n, qd);
          if (Math.abs(dn) < 1e-9) {
            if (s0 > C.d) miss = true;
            continue;
          }
          const tt = (C.d - s0) / dn;
          if (dn > 0) b = tt;
          else a = tt;
        }
        if (a > lo) lo = a;
        if (b < hi) {
          hi = b;
          hc = c;
        }
        if (lo > hi) miss = true;
      }
      if (miss || hc < 0) continue;
      const t = hi;
      const i = py * w + px;
      if (t <= zb[i]) continue;
      const L: V3 = [q0[0] + t * qd[0], q0[1] + t * qd[1], q0[2] + t * qd[2]];
      // Нормаль ограничения, на котором луч выходит к зрителю.
      const C = cons[hc];
      let nl: V3;
      if (C.k === 0) {
        nl = [0, 0, 0];
        nl[C.ax] = qd[C.ax] > 0 ? 1 : -1;
      } else if (C.k === 1) {
        nl = [0, 0, 0];
        nl[C.j] = (L[C.j] - C.cj) / (C.a * C.a);
        nl[C.l] = (L[C.l] - C.cl) / (C.b * C.b);
      } else if (C.k === 2) {
        nl = [
          (L[0] - C.c[0]) / (C.r[0] * C.r[0]),
          (L[1] - C.c[1]) / (C.r[1] * C.r[1]),
          (L[2] - C.c[2]) / (C.r[2] * C.r[2]),
        ];
      } else nl = C.n;
      let nn = nl;
      if (P.facet) {
        // Грани — в своих координатах камня: повернулся камень — повернулись грани.
        const u = norm(nl);
        const q: V3 = [Math.round(u[0] * 1.7), Math.round(u[1] * 1.7), Math.round(u[2] * 1.7)];
        if (q[0] || q[1] || q[2]) nn = q;
      }
      const nw = norm(mtv(inv, nn));
      const lam = dot(nw, LIGHTC);
      const k = Math.max(0, lam * 0.6 + 0.4 + Math.max(0, -nw[2]) * 0.14);
      SH_PAL = P.pal;
      SH_EMI = 0;
      SH_MAT = P.mat;
      const off = P.sh ? P.sh(L, norm(nl), k) : 0;
      if (SH_PAL < 0) continue;
      const N = PALS[SH_PAL].length;
      let tone = k * (N - 1) + off + (P.bias ?? 0);
      if (P.gloss) {
        const s = dot(nw, HV);
        tone += s > 0.965 ? P.gloss : s > 0.9 ? P.gloss * 0.5 : 0;
      }
      zb[i] = t;
      f.idb[i] = P.id;
      f.pal[i] = SH_PAL;
      f.tone[i] = Math.max(0, Math.min(N - 1, Math.round(tone)));
      f.emi[i] = SH_EMI;
      f.mat[i] = SH_MAT;
    }
  }
}

/**
 * Плоская фигура в плоскости O + u·E1 + v·E2 (ключ, знаки): `fn(u, v)` даёт
 * ступень или −1. Изнанку не рисует; глубина — плоскости.
 */
function planeShape(
  f: CFrame,
  O: V3,
  E1: V3,
  E2: V3,
  ext: number,
  pal: number,
  id: number,
  mat: number,
  fn: (u: number, v: number) => number,
  ox: number,
  oy: number,
): void {
  // Лицо фигуры — E2 × E1 (u вправо, v вверх — лицом к зрителю).
  const n = norm([
    E2[1] * E1[2] - E2[2] * E1[1],
    E2[2] * E1[0] - E2[0] * E1[2],
    E2[0] * E1[1] - E2[1] * E1[0],
  ]);
  if (dot(n, VIEWC) < 0.05) return;
  const pr = (p: V3): [number, number, number] => [
    p[0],
    p[1] * SE - p[2] * CE,
    p[1] * CE + p[2] * SE,
  ];
  const [cx, cy, cd] = pr(O);
  const [ax, ay, ad] = pr(E1);
  const [bx, by, bd] = pr(E2);
  const det = ax * by - bx * ay;
  if (Math.abs(det) < 1e-9) return;
  const R = ext * Math.max(Math.hypot(ax, ay), Math.hypot(bx, by)) + 1;
  const X0 = Math.max(0, Math.floor(ox + cx - R));
  const X1 = Math.min(f.w - 1, Math.ceil(ox + cx + R));
  const Y0 = Math.max(0, Math.floor(oy + cy - R));
  const Y1 = Math.min(f.h - 1, Math.ceil(oy + cy + R));
  const N = PALS[pal].length;
  for (let py = Y0; py <= Y1; py++)
    for (let px = X0; px <= X1; px++) {
      const dx = px + 0.5 - ox - cx;
      const dy = py + 0.5 - oy - cy;
      const u = (dx * by - bx * dy) / det;
      const v = (ax * dy - dx * ay) / det;
      const tn = fn(u, v);
      if (tn < 0) continue;
      const d = cd + u * ad + v * bd;
      const i = py * f.w + px;
      if (d <= f.zb[i]) continue;
      f.zb[i] = d;
      f.idb[i] = id;
      f.pal[i] = pal;
      f.tone[i] = Math.max(0, Math.min(N - 1, Math.round(tn)));
      f.emi[i] = 0;
      f.mat[i] = mat;
    }
}

// ---------------------------------------------------------------------------
// Палитры (от тени к свету; тени холоднее, свет теплее).
// ---------------------------------------------------------------------------

const P_WOOD = 0;
const P_METAL = 1;
const P_PLATE = 2;
const P_GOLD = 3;
const P_LINING = 4;
const P_COIN = 5;
const P_AMETH = 6;
const P_RUBY = 7;
const P_EMER = 8;
const P_SAPH = 9;
const P_TRIM = 10;
const P_KEY = 11;
const P_GLYPH = 12;

const WOOD_C = ramp(
  '#21141a',
  '#3a2120',
  '#552f24',
  '#71422c',
  '#8f5934',
  '#ad7140',
  '#c98e52',
  '#e2b072',
);
const WOOD_R = ramp('#170f18', '#26181e', '#3a2524', '#50332c', '#684335', '#815741', '#9b6d50');
const LACQ = ramp(
  '#16091f',
  '#251036',
  '#391752',
  '#4f2170',
  '#682e8e',
  '#8442aa',
  '#a463c4',
  '#c88fdc',
);
const RED = ramp('#22070f', '#3a0b18', '#561222', '#741a2c', '#932534', '#b2333c', '#cf4f4c');
const WOOD_M = ramp('#09080e', '#100e17', '#181520', '#211d2c', '#2b2638', '#373046');
const IRON = ramp('#14141c', '#22232e', '#343746', '#4b5062', '#666d82', '#8a93a8', '#b6bdcc');
const STEEL = ramp(
  '#10151f',
  '#1b2433',
  '#28364c',
  '#374a66',
  '#4a6182',
  '#627c9e',
  '#86a0bc',
  '#c4d6e8',
);
const SILVER = ramp(
  '#262a36',
  '#40465a',
  '#5f6779',
  '#838b9c',
  '#a8b0be',
  '#cdd3dc',
  '#eceff4',
  '#ffffff',
);
const GOLD = ramp(
  '#341a0c',
  '#5a3012',
  '#844c16',
  '#b0701c',
  '#d69a28',
  '#efc246',
  '#ffe384',
  '#fff7d6',
);
const IRON_M = ramp('#07080c', '#0e1016', '#171a22', '#22262f', '#30353f', '#444a56', '#5c6472');
const LIN_C = ramp('#160d10', '#231417', '#341e1c', '#482a23', '#5c372b');
const LIN_R = ramp('#0a0f1e', '#121a30', '#1c2846', '#283a5e', '#344c76');
const LIN_E = ramp('#14061c', '#220b2e', '#341244', '#4a1c5c', '#602874');
const LIN_L = ramp('#1c0409', '#2e0710', '#460c1a', '#621426', '#801e32');
const LIN_M = ramp('#050409', '#0a0810', '#100d18', '#171320', '#1f1a2a');
const AMETH = ramp(
  '#220a34',
  '#3e1260',
  '#5e1e8c',
  '#8434b8',
  '#a85ad8',
  '#cc94f0',
  '#eed8ff',
  '#ffffff',
);
const RUBY = ramp(
  '#30040e',
  '#560a1a',
  '#86142c',
  '#b6243c',
  '#e04656',
  '#ff8486',
  '#ffcfcc',
  '#ffffff',
);
const EMER = ramp(
  '#04241a',
  '#0a4028',
  '#12623c',
  '#1e8a52',
  '#38b26e',
  '#76dc9c',
  '#c4f8d8',
  '#ffffff',
);
const SAPH = ramp(
  '#08123a',
  '#101e60',
  '#1a3290',
  '#284cbe',
  '#4472e4',
  '#82a6fa',
  '#cfe0ff',
  '#ffffff',
);
/** Ключ — «слеза гаста», как значок ключа в игре. */
const KEY_P = ramp('#1d3f48', '#2f6470', '#4f8490', '#8fd0da', '#d8f6fa', '#ffffff');
const GLYPH = ramp('#1a1030', '#3a2468', '#6a48b0', '#9a7cff', '#c8b6ff', '#efe8ff');

const INK: RGBA = hx('#0c070b');

interface Look {
  wood: RGBA[];
  metal: RGBA[];
  plate: RGBA[];
  lining: RGBA[];
  /** Цвет редкости: основной и светлый (свет изнутри, искры). */
  col: RGBA;
  lite: RGBA;
  bandX: number;
  bandW: number;
  corners: boolean;
  rims: boolean;
  /** Уровень добра в сундуке (верх кучи). */
  heap: number;
  seed: number;
}
const LOOK: Record<Kind, Look> = {
  common: {
    wood: WOOD_C,
    metal: IRON,
    plate: IRON,
    lining: LIN_C,
    col: hx('#c4c0b8'),
    lite: hx('#f2efe8'),
    bandX: 11.5,
    bandW: 3,
    corners: false,
    rims: false,
    heap: 15.2,
    seed: 3,
  },
  rare: {
    wood: WOOD_R,
    metal: STEEL,
    plate: SILVER,
    lining: LIN_R,
    col: hx('#4aa0ff'),
    lite: hx('#c4e2ff'),
    bandX: 9.6,
    bandW: 3.4,
    corners: true,
    rims: true,
    heap: 16.8,
    seed: 5,
  },
  epic: {
    wood: LACQ,
    metal: GOLD,
    plate: GOLD,
    lining: LIN_E,
    col: hx('#b86bff'),
    lite: hx('#ecd4ff'),
    bandX: 10,
    bandW: 2.6,
    corners: true,
    rims: true,
    heap: 18.6,
    seed: 7,
  },
  legend: {
    wood: RED,
    metal: GOLD,
    plate: GOLD,
    lining: LIN_L,
    col: hx('#ffb52e'),
    lite: hx('#fff0b8'),
    bandX: 10,
    bandW: 3,
    corners: true,
    rims: true,
    heap: 20.5,
    seed: 11,
  },
  mystery: {
    wood: WOOD_M,
    metal: IRON_M,
    plate: IRON_M,
    lining: LIN_M,
    col: hx('#9a7cff'),
    lite: hx('#d6c8ff'),
    bandX: 11.5,
    bandW: 3,
    corners: true,
    rims: false,
    heap: 15,
    seed: 13,
  },
};

// ---------------------------------------------------------------------------
// Модель (единицы — пиксели малой полосы).
// ---------------------------------------------------------------------------

/** Полуширина, полуглубина, высота короба, толщина стенки. */
const W2 = 18;
const D2 = 11;
const H = 17;
const T = 2;
/** Крышка: полуцилиндр высотой LB, свес LO. */
const LB = 9;
const LO = 0.4;
const LA = D2 + LO;
/** Скважина на накладке замка (место ключа). */
const KEY_Z = 10.4;
const PLATE_Y = D2 + 1.0;
/** Крышка в покое открытого сундука: 108°, откинута назад. */
export const LID_OPEN = 1.88;

let RR = 1;
let HI = false;
let PX = 1;
let OX = 0;
let OY = 0;
let K: Kind = 'common';
let LK: Look = LOOK.common;
let NEXT_ID = 0;
const nid = () => NEXT_ID++;

const frac = (v: number) => v - Math.floor(v);

/** Доски короба: по высоте `z`, вдоль доски — `u`. */
function planks(u: number, z: number, z0: number, z1: number, n: number, sid: number): number {
  const ph = (z1 - z0) / n;
  const rz = (z - z0) / ph;
  const pi = Math.floor(rz);
  const fr = rz - pi;
  let off = (hash(pi, sid, LK.seed) - 0.5) * 0.9;
  if (fr * ph < PX * 0.95 && z > z0 + 0.5) {
    SH_EMI = 1;
    return -3;
  }
  if (fr * ph > ph - PX) off += 1;
  if (HI) {
    // Волокно: штрихи вдоль доски, у каждой доски своя высота и разрывы.
    const g = (0.3 + 0.45 * hash(pi, sid, 41)) * ph;
    if (Math.abs(fr * ph - g) < PX * 0.55 && hash(Math.floor(u / 2.6), pi, sid + 7) > 0.35) off -= 1;
    const g2 = (0.15 + 0.7 * hash(pi, sid, 43)) * ph;
    if (Math.abs(fr * ph - g2) < PX * 0.5 && hash(Math.floor(u / 1.9), pi, sid + 9) > 0.62)
      off -= 1;
    // Сучок.
    const kx = (hash(pi, sid, 47) - 0.5) * 28;
    if (hash(pi, sid, 49) > 0.6 && Math.hypot((u - kx) * 0.8, fr * ph - ph * 0.5) < 0.9) off -= 1.5;
  }
  if (K === 'epic' || K === 'legend') off *= 0.4;
  return off;
}

/** Накладка: заклёпки по линии и фаска. */
function rivet(du: number, dv: number): number {
  const r = HI ? 0.62 : 0.5;
  if (Math.abs(du) < r && Math.abs(dv) < r) return 2;
  if (HI && du >= r - 0.1 && du < r + PX && dv >= -r && dv < r + PX) return -1.5;
  return 0;
}

function metalSh(axU: number, axV: number, cu: number, step: number, rivets: boolean): Shader {
  return (L) => {
    // Щель под крышкой идёт и по оковке.
    if (L[2] > H - PX * 0.95) {
      SH_EMI = 1;
      return -3;
    }
    if (!rivets) return 0;
    const v = L[axV];
    const dv = v - (Math.round(v / step - 0.5) + 0.5) * step;
    return rivet(L[axU] - cu, dv);
  };
}

/** Стенка короба: снаружи доски (или панели), внутри — обивка, сверху — торец. */
function wallSh(side: number): Shader {
  return (L, nl) => {
    const out = nl[0] * L[0] + nl[1] * L[1] > 0.1 && Math.abs(nl[2]) < 0.5;
    if (nl[2] > 0.5) {
      if (L[2] < H - 0.5) {
        // Дно изнутри.
        SH_PAL = P_LINING;
        SH_MAT = M_IN;
        return -2;
      }
      return 0.6;
    }
    if (!out) {
      SH_PAL = P_LINING;
      SH_MAT = M_IN;
      return -1.6 - ((H - L[2]) / H) * 1.6;
    }
    const u = Math.abs(nl[1]) > 0.5 ? L[0] : L[1];
    // Щель под крышкой — тёмная строка, светится изнутри.
    if (L[2] > H - PX * 0.95) {
      SH_EMI = 1;
      return -3;
    }
    if (K === 'legend') {
      // Золотая рама и красные панели.
      const half = Math.abs(nl[1]) > 0.5 ? W2 : D2;
      const e = Math.min(half - Math.abs(u), L[2] - 0.0, H - L[2]);
      if (e < 2.4) {
        SH_PAL = P_TRIM;
        SH_MAT = M_METAL;
        return e > 2.4 - PX ? -1.5 : HI && e < PX ? 1 : 0;
      }
      return planks(u, L[2], 0, H, HI ? 3 : 2, side) * 0.6;
    }
    const z0 = LK.rims ? 2.2 : 0;
    const z1 = LK.rims ? H - 2.2 : H;
    return planks(u, L[2], z0, z1, HI ? (LK.rims ? 3 : 4) : LK.rims ? 2 : 3, side);
  };
}

/** Крышка: доски вдоль ширины по дуге; торцы — с окантовкой; изнутри — обивка. */
const lidSh: Shader = (L, nl) => {
  if (nl[2] < -0.5) {
    // Изнанка: обод оболочки и вогнутая обивка.
    const e = Math.min(W2 + LO - Math.abs(L[0]), L[1] + LO, 2 * D2 + LO - L[1]);
    if (e < T) return -0.6;
    SH_PAL = P_LINING;
    SH_MAT = M_IN;
    const deep = clamp01((e - T) / 7);
    let off = -0.6 - deep * 1.4;
    if (K === 'common' || K === 'mystery') {
      if (frac((L[1] + LO) / (HI ? 4.6 : 7.6)) * (HI ? 4.6 : 7.6) < PX * 0.9) off -= 1.5;
    } else if (HI && (Math.floor(L[0] / 3) + Math.floor(L[1] / 3)) % 2 === 0) off -= 0.5;
    return off;
  }
  const u = (L[1] - D2) / LA;
  const v = L[2] / LB;
  if (Math.abs(nl[0]) > 0.5) {
    // Торец: окантовка по дуге у старших.
    const rho = Math.hypot(u, v);
    if ((LK.rims || K === 'mystery') && rho > 1 - 1.6 / LB) {
      SH_PAL = K === 'legend' ? P_TRIM : P_METAL;
      SH_MAT = M_METAL;
      return 0;
    }
    if (K === 'legend') {
      if (rho > 1 - 2.4 / LB) {
        SH_PAL = P_TRIM;
        SH_MAT = M_METAL;
        return -1;
      }
    }
    return -0.4 + (Math.floor(L[1] / 3.2) % 2 ? -0.4 : 0);
  }
  const th = Math.atan2(v, u);
  const arc = th * (LA + LB) * 0.5;
  const n = HI ? 5 : 3;
  const pl = (Math.PI * (LA + LB) * 0.5) / n;
  if (K === 'legend') {
    // Золотые пластины с красными вставками.
    const fr = frac(arc / pl);
    const ex = W2 + LO - Math.abs(L[0]);
    if (fr * pl < 1.6 || fr * pl > pl - 1.0 || ex < 2.4) {
      SH_PAL = P_TRIM;
      SH_MAT = M_METAL;
      return fr * pl > pl - 1.0 && fr * pl > pl - PX ? -1 : 0;
    }
    return 0;
  }
  const pi = Math.floor(arc / pl);
  const fr = arc / pl - pi;
  if (fr * pl < PX * 0.95 && pi > 0) {
    SH_EMI = 1;
    return -3;
  }
  let off = (hash(pi, 77, LK.seed) - 0.5) * (K === 'epic' ? 0.4 : 0.9);
  if (HI && K !== 'epic') {
    const g = (0.3 + 0.4 * hash(pi, 78)) * pl;
    if (Math.abs(fr * pl - g) < PX * 0.55 && hash(Math.floor(L[0] / 2.6), pi, 79) > 0.4) off -= 1;
  }
  return off;
};

/** Обод-полоса крышки по дуге (`ax` — x). */
function lidBand(x: Xf, cx: number, hw: number, pal: number, id: number, riv: boolean): Prim {
  const sh: Shader = (L) => {
    if (!riv) return 0;
    const th = Math.atan2(L[2] / (LB + 0.6), (L[1] - D2) / (LA + 0.6));
    const arc = th * (LA + LB) * 0.5;
    const step = 3.4;
    const da = arc - (Math.round(arc / step - 0.5) + 0.5) * step;
    return rivet(L[0] - cx, da);
  };
  return prim(
    x,
    [
      { k: 0, ax: 0, lo: cx - hw, hi: cx + hw },
      { k: 1, j: 1, l: 2, cj: D2, cl: 0, a: LA + 0.6, b: LB + 0.6 },
      { k: 3, n: [0, 0, -1], d: -0.3 },
    ],
    [cx, D2, LB / 2],
    LA + 2,
    pal,
    id,
    M_METAL,
    { sh, gloss: 1.5 },
  );
}

interface Pose {
  yaw: number;
  lift: number;
  sz: number;
  sxy: number;
  shx: number;
  roll: number;
  lid: number;
  hasp: number;
  key: number;
  keyVis: number;
  /** Свет из щелей до открытия, 0…1. */
  leak: number;
  /** Свет внутри после открытия, 0…1. */
  inner: number;
  beam: number;
  flash: number;
  /** Блик-проход по металлу: −1 — нет, иначе 0…1. */
  sheen: number;
  /** Мерцание камня/знака 0…1. */
  twinkle: number;
}

const REST: Pose = {
  yaw: 0,
  lift: 0,
  sz: 1,
  sxy: 1,
  shx: 0,
  roll: 0,
  lid: 0,
  hasp: 0,
  key: 0,
  keyVis: 0,
  leak: 0,
  inner: 0,
  beam: 0,
  flash: 0,
  sheen: -1,
  twinkle: 0,
};

/** Сундук в мире (единицы модели, без масштаба полосы). */
function chestXf(o: Pose): Xf {
  return xc(
    xc(xc(xT(o.shx, 0, o.lift), xRy(o.roll)), xRz(YAW0 + o.yaw)),
    xS(o.sxy, o.sxy, o.sz),
  );
}
function lidXf(o: Pose): Xf {
  return xc(xT(0, -D2, H), xRx(o.lid));
}
function haspXf(o: Pose): Xf {
  return xc(xT(0, 2 * D2 + 1.0, 0.8), xRx(o.hasp));
}

/** Точка сундука (местная) → мир модели. */
function chestPt(o: Pose, p: V3): V3 {
  return apply(chestXf(o), p);
}

function build(o: Pose): Prim[] {
  const out: Prim[] = [];
  const C = xc(xS(RR, RR, RR), chestXf(o));
  const Lx = xc(C, lidXf(o));
  const bodyId = nid();
  const w = (sid: number) => ({ sh: wallSh(sid), gloss: K === 'epic' ? 1.2 : 0 });
  // Короб: четыре стенки и дно, одна деталь (без швов на углах).
  out.push(boxP(C, -W2, W2, D2 - T, D2, 0, H, P_WOOD, bodyId, M_WOOD, w(1)));
  out.push(boxP(C, -W2, W2, -D2, -D2 + T, 0, H, P_WOOD, bodyId, M_WOOD, w(2)));
  out.push(boxP(C, -W2, -W2 + T, -D2 + T, D2 - T, 0, H, P_WOOD, bodyId, M_WOOD, w(3)));
  out.push(boxP(C, W2 - T, W2, -D2 + T, D2 - T, 0, H, P_WOOD, bodyId, M_WOOD, w(4)));
  out.push(boxP(C, -W2 + T, W2 - T, -D2 + T, D2 - T, 0, T, P_WOOD, bodyId, M_WOOD, w(5)));

  // Оковка короба.
  const bandId = nid();
  const bw = LK.bandW / 2;
  const riv = HI || K === 'rare';
  for (const sx of [-1, 1]) {
    const cx = sx * LK.bandX;
    const msh = metalSh(0, 2, cx, 3.2, riv);
    out.push(
      boxP(C, cx - bw, cx + bw, D2 - 0.2, D2 + 0.6, 0, H, P_METAL, bandId, M_METAL, {
        sh: msh,
        gloss: 1.5,
      }),
    );
    out.push(
      boxP(C, cx - bw, cx + bw, -D2 - 0.6, -D2 + 0.2, 0, H, P_METAL, bandId, M_METAL, {
        sh: msh,
        gloss: 1.5,
      }),
    );
  }
  if (LK.rims) {
    // Пояса: низ и верх короба.
    for (const [z0, z1] of [
      [0, 2.2],
      [H - 2.2, H - 0.05],
    ]) {
      out.push(
        boxP(C, -W2 - 0.5, W2 + 0.5, D2 - 0.2, D2 + 0.5, z0, z1, P_METAL, bandId, M_METAL, {
          gloss: 1.5,
          sh: metalSh(2, 0, (z0 + z1) / 2, 3.2, HI),
        }),
      );
      out.push(
        boxP(C, -W2 - 0.5, W2 + 0.5, -D2 - 0.5, -D2 + 0.2, z0, z1, P_METAL, bandId, M_METAL, {
          gloss: 1.5,
        }),
      );
      for (const sx of [-1, 1])
        out.push(
          boxP(
            C,
            sx > 0 ? W2 - 0.2 : -W2 - 0.5,
            sx > 0 ? W2 + 0.5 : -W2 + 0.2,
            -D2 - 0.5,
            D2 + 0.5,
            z0,
            z1,
            P_METAL,
            bandId,
            M_METAL,
            { gloss: 1.5, sh: metalSh(2, 1, (z0 + z1) / 2, 3.2, HI) },
          ),
        );
    }
  }
  if (LK.corners) {
    // Уголки: пластина спереди/сзади и сбоку на каждом ребре.
    const cw = 3.6;
    for (const sx of [-1, 1])
      for (const sy of [-1, 1]) {
        const xo = sx * (W2 + 0.6);
        const xi = sx * (W2 - cw);
        const yo = sy * (D2 + 0.6);
        const yi = sy * (D2 - cw);
        const cz1 = H - 0.05;
        out.push(
          boxP(
            C,
            Math.min(xo, xi),
            Math.max(xo, xi),
            Math.min(yo, sy * (D2 - 0.2)),
            Math.max(yo, sy * (D2 - 0.2)),
            0,
            cz1,
            P_METAL,
            bandId,
            M_METAL,
            { gloss: 1.5, sh: metalSh(0, 2, sx * (W2 - 1.4), 3.2, HI) },
          ),
        );
        out.push(
          boxP(
            C,
            Math.min(xo, sx * (W2 - 0.2)),
            Math.max(xo, sx * (W2 - 0.2)),
            Math.min(yo, yi),
            Math.max(yo, yi),
            0,
            cz1,
            P_METAL,
            bandId,
            M_METAL,
            { gloss: 1.5, sh: metalSh(1, 2, sy * (D2 - 1.4), 3.2, HI) },
          ),
        );
      }
  }
  // Боковые полосы торцов (по середине).
  if (K === 'rare' || K === 'legend' || K === 'mystery')
    for (const sx of [-1, 1])
      out.push(
        boxP(
          C,
          sx > 0 ? W2 - 0.2 : -W2 - 0.6,
          sx > 0 ? W2 + 0.6 : -W2 + 0.2,
          -1.6,
          1.6,
          0,
          H - 0.05,
          P_METAL,
          bandId,
          M_METAL,
          { gloss: 1.5, sh: metalSh(1, 2, 0, 3.2, riv) },
        ),
      );
  // Петли сзади: лист на коробе и валик на оси.
  for (const sx of [-1, 1]) {
    const hx0 = sx * 9;
    out.push(
      boxP(C, hx0 - 1.8, hx0 + 1.8, -D2 - 0.9, -D2 + 0.2, H - 5.5, H - 0.1, P_METAL, bandId, M_METAL, {
        gloss: 1,
        sh: metalSh(0, 2, hx0, 2.6, true),
      }),
    );
    out.push(
      prim(
        C,
        [
          { k: 0, ax: 0, lo: hx0 - 1.8, hi: hx0 + 1.8 },
          { k: 1, j: 1, l: 2, cj: -D2 - 0.3, cl: H, a: 0.95, b: 0.95 },
        ],
        [hx0, -D2, H],
        2.5,
        P_METAL,
        bandId,
        M_METAL,
        { gloss: 1.5 },
      ),
    );
  }

  // Замок: накладка на коробе, скважина (или «?» у загадки).
  const plateId = nid();
  const plateSh: Shader = (L, nl) => {
    if (nl[1] < 0.5) return -0.5;
    const dx = L[0];
    const dz = L[2] - KEY_Z;
    // Фаска: верх и левый край светлее, низ и правый темнее.
    const ex = 4.2 - Math.abs(dx);
    const ez = Math.min(L[2] - 6.6, 16.6 - L[2]);
    let off = 0;
    if (ex < PX || ez < PX) off = dx < 0 || L[2] > KEY_Z + 2 ? 1 : -1;
    if (K === 'mystery') {
      // «?» вместо скважины: светится.
      const g = glyphQ(dx, dz + 0.4);
      if (g) {
        SH_PAL = P_GLYPH;
        SH_EMI = 2;
        SH_MAT = M_GEM;
        return 2;
      }
      return off;
    }
    const rr = HI ? 1.15 : 0.75;
    if (dx * dx + dz * dz < rr * rr || (Math.abs(dx) < (HI ? 0.48 : 0.5) && dz < 0 && dz > -2.4)) {
      SH_EMI = 1;
      return -9;
    }
    if (HI) {
      // Винты по углам.
      for (const [vx, vz] of [
        [-3.1, 15.6],
        [3.1, 15.6],
        [-3.1, 7.6],
        [3.1, 7.6],
      ]) {
        const r = rivet(dx - vx, L[2] - vz);
        if (r) return r;
      }
    }
    return off;
  };
  out.push(
    boxP(C, -4.2, 4.2, D2 - 0.2, PLATE_Y, 6.6, 16.6, P_PLATE, plateId, M_METAL, {
      sh: plateSh,
      gloss: 1.5,
    }),
  );

  // Крышка.
  const lidId = nid();
  out.push(
    prim(
      Lx,
      [
        { k: 0, ax: 0, lo: -W2 - LO, hi: W2 + LO },
        { k: 1, j: 1, l: 2, cj: D2, cl: 0, a: LA, b: LB },
        { k: 3, n: [0, 0, -1], d: 0 },
      ],
      [0, D2, LB / 2],
      W2 + 4,
      P_WOOD,
      lidId,
      M_WOOD,
      { sh: lidSh, gloss: K === 'epic' ? 1.5 : 0 },
    ),
  );
  const lbId = nid();
  for (const sx of [-1, 1])
    out.push(lidBand(Lx, sx * LK.bandX, bw, P_METAL, lbId, riv));
  if (LK.corners)
    for (const sx of [-1, 1]) out.push(lidBand(Lx, sx * (W2 + LO - 1.7), 1.5, P_METAL, lbId, false));
  // Губа крышки спереди: полоса по нижнему краю дуги.
  out.push(
    prim(
      Lx,
      [
        { k: 0, ax: 0, lo: -W2 - LO - 0.3, hi: W2 + LO + 0.3 },
        { k: 1, j: 1, l: 2, cj: D2, cl: 0, a: LA + 0.5, b: LB + 0.5 },
        { k: 3, n: [0, 0, -1], d: -0.25 },
        { k: 3, n: [0, 0, 1], d: 2.5 },
        { k: 3, n: [0, -1, 0], d: -D2 },
      ],
      [0, 2 * D2, 1.2],
      W2 + 3,
      P_METAL,
      lbId,
      M_METAL,
      { gloss: 1.5, sh: metalSh(2, 0, 1.25, 3.4, HI && K !== 'common') },
    ),
  );
  // Лист петли на крышке.
  for (const sx of [-1, 1])
    out.push(
      boxP(Lx, sx * 9 - 1.8, sx * 9 + 1.8, -0.9, 1.6, 0.2, 4.2, P_METAL, lbId, M_METAL, {
        gloss: 1,
      }),
    );
  if (K === 'legend') {
    // Солнце на крышке: диск с рубином, лучи — пластинами по дуге.
    const th = 0.75;
    const tilt = Math.atan2(Math.sin(th) / LB, Math.cos(th) / LA);
    const sun = xc(Lx, xc(xT(0, D2 + LA * Math.cos(th), LB * Math.sin(th)), xRx(tilt)));
    const sunId = nid();
    out.push(
      ellP(sun, [0, 0, 0], [3.4, 0.9, 3.4], P_TRIM, sunId, M_METAL, {
        gloss: 2,
        sh: (L) => (Math.hypot(L[0], L[2]) > 2.6 ? -1 : 0.5),
      }),
    );
    out.push(ellP(sun, [0, 0.7, 0], [1.3, 0.7, 1.3], P_RUBY, nid(), M_GEM, { facet: true, gloss: 3 }));
    for (let r = 0; r < 8; r++) {
      const a = (r / 8) * Math.PI * 2;
      const c: V3 = [Math.cos(a) * 4.6, -0.1, Math.sin(a) * 4.6];
      out.push(
        ellP(sun, c, [r % 2 ? 0.9 : 1.2, 0.5, r % 2 ? 0.9 : 1.2], P_TRIM, sunId, M_METAL, {
          gloss: 2,
        }),
      );
    }
  }

  // Накладка-петля замка на крышке.
  const Hx = xc(Lx, haspXf(o));
  const haspId = nid();
  out.push(
    boxP(Hx, -2.3, 2.3, 0, 1.0, -5.4, 0.6, P_PLATE, haspId, M_METAL, {
      gloss: 1.5,
      sh: (L, nl) => {
        if (nl[1] < 0.5) return -0.5;
        if (HI && Math.abs(L[0]) < 0.9 && L[2] < -3.9 && L[2] > -4.9) return -4;
        if (2.3 - Math.abs(L[0]) < PX) return L[0] < 0 ? 1 : -1;
        return 0;
      },
    }),
  );
  if (K === 'epic' || K === 'legend') {
    out.push(
      ellP(Hx, [0, 1.15, -2.4], [1.55, 0.75, 1.9], K === 'epic' ? P_AMETH : P_RUBY, nid(), M_GEM, {
        facet: true,
        gloss: 3,
        bias: 0.3,
      }),
    );
  }
  if (K === 'legend') {
    // Камни на поясах: рубин, изумруд, сапфир.
    const gemPal = [P_RUBY, P_EMER, P_SAPH];
    let gi = 0;
    for (const sx of [-1, 1]) {
      out.push(
        ellP(C, [sx * LK.bandX, D2 + 0.9, 1.1], [1.25, 0.6, 1.0], gemPal[gi++ % 3], nid(), M_GEM, {
          facet: true,
          gloss: 3,
        }),
      );
      out.push(
        ellP(C, [sx * LK.bandX, D2 + 0.9, H - 1.1], [1.25, 0.6, 1.0], gemPal[gi++ % 3], nid(), M_GEM, {
          facet: true,
          gloss: 3,
        }),
      );
    }
  }

  // Добро внутри — только когда крышка приоткрыта.
  if (o.lid > 0.03) loot(out, C);
  return out;
}

/** Куча монет и камни: верх кучи — по ярусу. */
function loot(out: Prim[], C: Xf): void {
  const top = LK.heap;
  const rz = top - T + 2;
  // Куча лежит на дне: ниже дна её нет.
  const floorCut: Con = { k: 3, n: [0, 0, -1], d: -T };
  const heapId = nid();
  const heapSh: Shader = (L) => {
    // Монеты ячейками: светлая середина, тёмный зазор, блёстки.
    const cs = HI ? 2.2 : 2.6;
    const row = Math.floor(L[1] / (cs * 0.8));
    const cx = L[0] / cs + (row % 2 ? 0.5 : 0);
    const fx = frac(cx) - 0.5;
    const fy = frac(L[1] / (cs * 0.8)) - 0.5;
    const d = Math.hypot(fx, fy * 1.3);
    let off = d > 0.42 ? -1.5 : fx < -0.1 && fy < -0.05 ? 1 : 0;
    if (hash(Math.floor(cx), row, 91) > 0.86 && d < 0.3) off += 1.5;
    return off;
  };
  if (K === 'common') {
    out.push(
      ellP(C, [-4, -1.5, T - 2], [11, 7, rz - 1], P_COIN, heapId, M_LOOT, { sh: heapSh, gloss: 1 }, [
        floorCut,
      ]),
    );
  } else {
    out.push(
      ellP(
        C,
        [0, -1, T - 2],
        [W2 - T - 0.8, D2 - T - 0.6, rz],
        P_COIN,
        heapId,
        M_LOOT,
        { sh: heapSh, gloss: 1 },
        [floorCut],
      ),
    );
  }
  // Монеты на куче: наклонённые диски.
  const nCoins = K === 'common' ? 3 : K === 'rare' ? 4 : 5;
  for (let j = 0; j < nCoins; j++) {
    const hx0 = (hash(j, 3, LK.seed) - 0.5) * (K === 'common' ? 16 : 26) + (K === 'common' ? -4 : 0);
    const hy0 = (hash(j, 5, LK.seed) - 0.5) * 9 - 1;
    const z = top - 0.6 - Math.abs(hx0) * 0.06 - hash(j, 6) * 1.2;
    const cx = xc(C, xc(xT(hx0, hy0, z), xc(xRz(hash(j, 7) * 6), xRx(0.5 + hash(j, 8) * 0.6))));
    out.push(
      ellP(cx, [0, 0, 0], [2.1, 2.1, 0.55], P_COIN, nid(), M_LOOT, {
        gloss: 2,
        sh: (L) => (Math.hypot(L[0], L[1]) > 1.5 ? -1 : HI && Math.hypot(L[0], L[1]) < 0.8 ? 0.6 : 0),
      }),
    );
  }
  // Камни.
  const gems: [number, V3, number][] =
    K === 'epic'
      ? [
          [P_AMETH, [-7, 0, top - 0.4], 2.0],
          [P_AMETH, [6, -2, top - 0.2], 1.7],
          [P_AMETH, [1, 2, top + 0.1], 1.4],
        ]
      : K === 'legend'
        ? [
            [P_RUBY, [-8, 0, top - 0.6], 2.1],
            [P_EMER, [7, -1.5, top - 0.6], 1.9],
            [P_SAPH, [0, 1.5, top + 0.2], 1.7],
            [P_AMETH, [-2, -4, top - 0.2], 1.5],
          ]
        : K === 'rare'
          ? [[P_SAPH, [4, 0, top - 0.3], 1.5]]
          : [];
  for (const [pl, c, r] of gems)
    out.push(ellP(C, c, [r, r * 0.9, r * 1.1], pl, nid(), M_GEM, { facet: true, gloss: 3 }));
}

/** «?» загадки: битовая маска в координатах накладки (единицы модели). */
const Q_S = ['.##.', '#..#', '...#', '..#.', '.#..', '....', '.#..'];
const Q_L = [
  '..####..',
  '.##..##.',
  '.##..##.',
  '.....##.',
  '....##..',
  '...##...',
  '...##...',
  '........',
  '...##...',
  '...##...',
];
function glyphQ(dx: number, dz: number): boolean {
  const rows = HI ? Q_L : Q_S;
  const cell = HI ? 0.62 : 1.0;
  const cols = rows[0].length;
  const gx = Math.floor(dx / cell + cols / 2);
  const gy = Math.floor(-dz / cell + rows.length / 2);
  if (gx < 0 || gy < 0 || gx >= cols || gy >= rows.length) return false;
  return rows[gy][gx] === '#';
}

// ---------------------------------------------------------------------------
// Время: позы по полосам.
// ---------------------------------------------------------------------------

const PI = Math.PI;

/** Дрожь: знак чередуется по кадрам 24 к/с, амплитуда `a`. */
const jitter = (t: number, a: number) => (Math.round(t * 24) % 2 ? a : -a);

function openPose(tier: Tier, t: number): Pose {
  const o: Pose = { ...REST, keyVis: 1 };
  o.key = kf(t, [
    [0.04, 0],
    [0.21, PI / 2, 's'],
  ]);
  if (tier === 'common') {
    o.keyVis = t < 0.3 ? 1 : clamp01(1 - (t - 0.3) / 0.12);
    o.hasp = kf(t, [
      [0.24, 0],
      [0.29, 0.62, 'o'],
      [0.35, 0.42],
      [0.41, 0.5],
    ]);
    o.sz = 1 - 0.03 * bump(t, 0.24, 0.34);
    o.lid = kf(t, [
      [0.4, 0],
      [0.46, 0.1, 'o'],
      [0.54, 0.07],
      [0.6, 0.3, 'i'],
      [0.7, 1.55],
      [0.76, 2.02, 'o'],
      [0.84, 1.8],
      [0.92, 1.92],
      [1.0, LID_OPEN],
    ]);
    o.inner = 0;
  } else if (tier === 'rare') {
    o.keyVis = t < 0.29 ? 1 : clamp01(1 - (t - 0.29) / 0.09);
    o.leak = kf(t, [
      [0.06, 0],
      [0.25, 0.35],
      [0.4, 1, 'i'],
      [0.47, 0],
    ]);
    o.hasp = kf(t, [
      [0.24, 0],
      [0.28, 0.7, 'o'],
      [0.34, 0.45],
      [0.4, 0.55],
    ]);
    o.sz = 1 - 0.06 * bump(t, 0.3, 0.42) + 0.05 * bump(t, 0.42, 0.54);
    o.sxy = 1 + (1 - o.sz) * 0.5;
    o.lid = kf(t, [
      [0.4, 0],
      [0.43, 0.3, 'i'],
      [0.47, 1.3, 'l'],
      [0.52, 2.2, 'o'],
      [0.6, 1.72],
      [0.68, 1.96],
      [0.76, 1.85],
      [0.84, LID_OPEN],
    ]);
    o.inner = kf(t, [
      [0.4, 0],
      [0.46, 1],
      [0.8, 0.6],
      [1.2, 0.45],
    ]);
    o.beam = kf(t, [
      [0.42, 0],
      [0.48, 0.7],
      [0.75, 0.45],
      [1.02, 0],
    ]);
  } else if (tier === 'epic') {
    o.keyVis = t < 0.29 ? 1 : clamp01(1 - (t - 0.29) / 0.08);
    o.hasp = kf(t, [
      [0.24, 0],
      [0.28, 0.75, 'o'],
      [0.34, 0.5],
      [0.4, 0.6],
    ]);
    o.leak = kf(t, [
      [0.06, 0],
      [0.25, 0.3],
      [0.62, 1],
      [0.74, 1],
      [0.79, 0],
    ]);
    if (t > 0.25 && t < 0.62) {
      const a = 0.35 + 0.6 * clamp01((t - 0.25) / 0.35);
      o.shx = jitter(t, a);
      o.roll = jitter(t + 1 / 24, 0.012 * a);
    }
    o.sz = kf(t, [
      [0.58, 1],
      [0.68, 0.86, 'o'],
      [0.71, 1.1, 'i'],
      [0.78, 1],
      [0.9, 1],
      [0.93, 0.88, 'o'],
      [1.0, 1.04],
      [1.06, 0.98],
      [1.12, 1],
    ]);
    o.sxy = 1 + (1 - o.sz) * 0.5;
    o.lift = kf(t, [
      [0.7, 0],
      [0.79, 7, 'o'],
      [0.91, 0, 'i'],
    ]);
    o.lid =
      0.09 * bump(t, 0.34, 0.4) +
      0.12 * bump(t, 0.48, 0.54) +
      kf(t, [
        [0.72, 0],
        [0.75, 0.6, 'i'],
        [0.8, 2.25, 'o'],
        [0.9, 1.7],
        [0.98, 1.98],
        [1.06, 1.84],
        [1.14, LID_OPEN],
      ]);
    o.inner = kf(t, [
      [0.74, 0],
      [0.8, 1],
      [1.3, 0.7],
      [1.6, 0.55],
    ]);
    o.beam = kf(t, [
      [0.76, 0],
      [0.8, 1],
      [1.2, 0.85],
      [1.5, 0],
    ]);
  } else {
    o.keyVis = t < 0.28 ? 1 : clamp01(1 - (t - 0.28) / 0.08);
    o.hasp = kf(t, [
      [0.24, 0],
      [0.27, 0.8, 'o'],
      [0.33, 0.5],
      [0.4, 0.62],
    ]);
    o.leak =
      kf(t, [
        [0.06, 0],
        [0.25, 0.4],
        [0.9, 1],
        [1.0, 1],
        [1.05, 0],
      ]) *
      (0.85 + 0.15 * Math.sin(t * 40));
    if (t > 0.25 && t < 0.93) {
      const u = (t - 0.25) / 0.68;
      const a = 0.4 + 1.6 * u * u;
      o.shx = jitter(t, a);
      o.roll = jitter(t + 1 / 24, 0.016 * a);
    }
    o.sz = kf(t, [
      [0.8, 1],
      [0.94, 0.84, 'o'],
      [0.97, 1.12, 'i'],
      [1.05, 1],
      [1.22, 1],
      [1.26, 0.86, 'o'],
      [1.34, 1.05],
      [1.42, 0.98],
      [1.5, 1],
    ]);
    o.sxy = 1 + (1 - o.sz) * 0.5;
    o.lift = kf(t, [
      [0.96, 0],
      [1.08, 11, 'o'],
      [1.24, 0, 'i'],
    ]);
    o.lid =
      0.1 * bump(t, 0.4, 0.46) +
      0.14 * bump(t, 0.56, 0.62) +
      0.18 * bump(t, 0.72, 0.78) +
      kf(t, [
        [1.0, 0],
        [1.04, 0.8, 'i'],
        [1.1, 2.5, 'o'],
        [1.2, 1.62],
        [1.3, 2.02],
        [1.4, 1.82],
        [1.5, 1.92],
        [1.6, LID_OPEN],
      ]);
    o.flash = kf(t, [
      [1.06, 0],
      [1.09, 1],
      [1.3, 0],
    ]);
    o.inner = kf(t, [
      [1.04, 0],
      [1.1, 1],
      [2.25, 0.75],
    ]);
    o.beam = kf(t, [
      [1.07, 0],
      [1.1, 1],
      [1.8, 0.85],
      [2.15, 0],
    ]);
  }
  return o;
}

function idlePose(k: Kind, t: number): Pose {
  const o: Pose = { ...REST };
  // Блик проходит по металлу за 0,6 с, остальное время — тишина.
  const u = (t - 0.25) / 0.6;
  o.sheen = u >= 0 && u <= 1 ? u : -1;
  if (k === 'legend') {
    o.lift = 0.5 * (1 - Math.cos(PI * t));
    o.leak = 0.32 + 0.12 * (1 - Math.cos(PI * t)) * 0.5;
  }
  if (k === 'epic' || k === 'rare') o.twinkle = bump(t, 1.15, 1.55);
  if (k === 'mystery') o.twinkle = 0.5 - 0.5 * Math.cos(PI * t);
  return o;
}

interface Parsed {
  kind: Kind;
  mode: 'idle' | 'open' | 'spin';
}
function parse(name: string): Parsed {
  if (name === 'mystery-spin') return { kind: 'mystery', mode: 'spin' };
  const [m, k] = name.split('-');
  if ((m !== 'idle' && m !== 'open') || !KINDS.includes(k as Kind) || (m === 'open' && k === 'mystery'))
    throw new Error(`нет полосы сундука ${name}`);
  return { kind: k as Kind, mode: m };
}

export function poseOf(name: string, t: number): Pose {
  const { kind, mode } = parse(name);
  if (mode === 'spin') return { ...REST, yaw: (4 * PI * t * 24) / SPIN_N };
  if (mode === 'idle') return idlePose(kind, t);
  return openPose(kind as Tier, t);
}

// ---------------------------------------------------------------------------
// Оверлеи: свет, частицы — с проверкой глубины.
// ---------------------------------------------------------------------------

/** Точка мира модели → кадр (x, y, глубина) в пикселях полосы. */
function sp(p: V3): [number, number, number] {
  return [
    OX + RR * p[0],
    OY + RR * (p[1] * SE - p[2] * CE),
    RR * (p[1] * CE + p[2] * SE),
  ];
}

let DZ: Float32Array = new Float32Array(0);

function put(p: Px, x: number, y: number, d: number, c: RGBA, addMode = false): void {
  x = Math.floor(x);
  y = Math.floor(y);
  if (x < 0 || y < 0 || x >= p.w || y >= p.h) return;
  const i = y * p.w + x;
  if (DZ[i] > d + 0.6) return;
  if (!addMode) {
    p.set(x, y, c);
    return;
  }
  const j = i * 4;
  const a = c[3] / 255;
  const da = p.data[j + 3];
  if (da === 0) {
    p.data[j] = c[0];
    p.data[j + 1] = c[1];
    p.data[j + 2] = c[2];
    p.data[j + 3] = c[3];
    return;
  }
  p.data[j] = Math.min(255, p.data[j] + c[0] * a);
  p.data[j + 1] = Math.min(255, p.data[j + 1] + c[1] * a);
  p.data[j + 2] = Math.min(255, p.data[j + 2] + c[2] * a);
  p.data[j + 3] = Math.max(da, c[3]);
}

const withA = (c: RGBA, a: number): RGBA => [c[0], c[1], c[2], Math.round(clamp01(a) * 255)];
const WHITE: RGBA = [255, 255, 255, 255];

/** Искра-звёздочка: жизнь 0…1 — вырастает и гаснет. */
function sparkle(p: Px, x: number, y: number, d: number, life: number, col: RGBA, hot: RGBA): void {
  if (life <= 0 || life >= 1) return;
  const s = Math.sin(PI * life);
  const L = HI ? Math.round(1 + 4 * s) : Math.round(s * 2.2);
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  put(p, xi, yi, d, s > 0.35 ? WHITE : hot);
  for (let k = 1; k <= L; k++) {
    const c = k === 1 ? hot : col;
    put(p, xi + k, yi, d, c);
    put(p, xi - k, yi, d, c);
    put(p, xi, yi + k, d, c);
    put(p, xi, yi - k, d, c);
  }
  if (HI && s > 0.6) {
    put(p, xi + 1, yi + 1, d, withA(col, 0.7), true);
    put(p, xi - 1, yi - 1, d, withA(col, 0.7), true);
    put(p, xi + 1, yi - 1, d, withA(col, 0.7), true);
    put(p, xi - 1, yi + 1, d, withA(col, 0.7), true);
  }
}

/** Пятно-клуб пыли: круг, светлый верх-слева, проявление шахматкой. */
function puff(p: Px, x: number, y: number, d: number, r: number, vis: number, base: RGBA): void {
  const R = r * RR;
  const lite = mixc(base, WHITE, 0.35);
  const dark = mixc(base, INK, 0.35);
  for (let yy = Math.floor(y - R); yy <= Math.ceil(y + R); yy++)
    for (let xx = Math.floor(x - R); xx <= Math.ceil(x + R); xx++) {
      const dx = xx + 0.5 - x;
      const dy = yy + 0.5 - y;
      const q = (dx * dx + dy * dy) / (R * R);
      if (q > 1) continue;
      if (!dith(xx, yy, vis)) continue;
      const c = dx + dy < -R * 0.3 ? lite : dx + dy > R * 0.6 ? dark : base;
      put(p, xx, yy, d, c);
    }
}

/** Кольцо на полу вокруг сундука (световое или ударная волна). */
function ring(p: Px, o: Pose, r: number, vis: number, col: RGBA, thick: number): void {
  const n = Math.ceil(r * RR * 7);
  const base = chestPt({ ...o, lift: 0 }, [0, 0, 0]);
  for (let s = 0; s < n; s++) {
    const a = (s / n) * PI * 2;
    const w: V3 = [base[0] + Math.cos(a) * r * 1.25, base[1] + Math.sin(a) * r * 0.85, 0];
    const [x, y, d] = sp(w);
    for (let k = 0; k < thick; k++) {
      if (!dith(Math.floor(x), Math.floor(y) - k, vis)) continue;
      put(p, x, y - k, d, k === 0 ? col : withA(col, 0.6), true);
    }
  }
}

/**
 * Столб света из проёма: ядро белее, края цветом редкости, по нему вверх
 * бегут светлые штрихи; глубина — середины проёма, поэтому передняя стенка
 * прячет его основание, а откинутая крышка (она дальше) им подсвечена.
 * `hgt` — высота в единицах модели, `wid` — доля ширины проёма.
 */
function beam(p: Px, o: Pose, t: number, k: number, col: RGBA, lite: RGBA, hgt: number, wid: number): void {
  if (k <= 0.01) return;
  const c = chestPt(o, [0, -1, H - 1]);
  const [cx, cy, cd] = sp(c);
  const top = cy - RR * hgt;
  const hw0 = RR * (W2 - T) * wid;
  const hot = mixc(lite, WHITE, 0.55);
  const sw = HI ? 3 : 2;
  for (let y = Math.floor(top); y <= Math.ceil(cy); y++) {
    const up = clamp01((cy - y) / (cy - top));
    const hw = hw0 * (1 + 0.35 * up);
    const fade = k * (1 - up) ** 1.1;
    for (let x = Math.floor(cx - hw); x <= Math.ceil(cx + hw); x++) {
      const dx = Math.abs(x + 0.5 - cx) / hw;
      if (dx > 1) continue;
      // Штрихи: свой столбик, бегут вверх.
      const col0 = Math.floor((x - cx) / sw);
      const run = frac((y / RR + t * (50 + 30 * hash(col0, 3))) / (7 + 5 * hash(col0, 4)) + hash(col0, 5));
      const streak = hash(col0, 6) > 0.45 && run < 0.35;
      let a: number;
      let cc: RGBA;
      if (dx < 0.22) {
        a = 0.9 * fade;
        cc = hot;
      } else if (dx < 0.55) {
        a = (streak ? 0.85 : 0.55) * fade;
        cc = streak ? hot : lite;
      } else {
        a = (streak ? 0.7 : 0.4) * fade;
        cc = streak ? lite : col;
        if (!dith(x, y, 1.15 - (dx - 0.55) / 0.45)) continue;
      }
      if (a < 0.05) continue;
      if (up > 0.5 && !dith(x, y, (1 - up) / 0.5 + 0.15)) continue;
      put(p, x, y, cd, withA(cc, a), true);
    }
  }
}

/** Лучи вспышки из проёма (легендарный): 8 клиньев, медленно поворачиваются. */
function burst(p: Px, o: Pose, k: number, rot: number, col: RGBA, lite: RGBA): void {
  if (k <= 0.01) return;
  const c = chestPt(o, [0, 0, H + 2]);
  const [cx, cy, cd] = sp(c);
  const R = RR * (26 + 14 * k);
  for (let y = Math.floor(cy - R); y <= Math.ceil(cy + R); y++)
    for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const r = Math.hypot(dx, dy * 1.15);
      if (r > R || r < RR * 4) continue;
      const a = Math.atan2(dy, dx) + rot;
      const wv = Math.cos(a * 4);
      if (wv < 0.82) continue;
      const fall = 1 - r / R;
      const s = k * fall * (wv > 0.95 ? 1 : 0.6);
      if (!dith(x, y, s * 1.6)) continue;
      put(p, x, y, cd, withA(wv > 0.95 ? lite : col, 0.75), true);
    }
}

/** Монетка-диск: ширина по повороту, свет сверху-слева. */
function coinSpr(p: Px, x: number, y: number, d: number, spin: number, vis: number): void {
  const r = (HI ? 2.0 : 1.6) * RR * 0.55 + (HI ? 0.6 : 0.4);
  const wx = Math.max(0.5, Math.abs(Math.cos(spin)) * r);
  for (let yy = Math.floor(y - r); yy <= Math.ceil(y + r); yy++)
    for (let xx = Math.floor(x - wx); xx <= Math.ceil(x + wx); xx++) {
      const dx = (xx + 0.5 - x) / wx;
      const dy = (yy + 0.5 - y) / r;
      const q = dx * dx + dy * dy;
      if (q > 1) continue;
      if (vis < 1 && !dith(xx, yy, vis)) continue;
      const tone = q > 0.55 ? 3 : dx + dy < -0.5 ? 6 : dx + dy > 0.6 ? 4 : 5;
      put(p, xx, yy, d, GOLD[tone]);
    }
}

/** Руны: 5×7 для крупной, 3×4 для малой. */
const RUNES_L = [
  ['x....x.', 'x...x..', 'x..x...', 'x.x....', 'xx.....', 'x.x....', 'x..x...', 'x...x..', 'x....x.'],
  ['...x...', '..x.x..', '.x...x.', 'x.....x', '.x...x.', '..x.x..', '...x...', '...x...', '...x...'],
  ['x.....x', 'xx...xx', 'x.x.x.x', 'x..x..x', 'x.x.x.x', 'xx...xx', 'x.....x', 'x.....x', 'x.....x'],
  ['xxxx...', 'x...x..', 'x....x.', 'x...x..', 'xxxx...', 'x.x....', 'x..x...', 'x...x..', 'x....x.'],
  ['x......', 'xx.....', 'x.x....', 'x..x...', 'x...x..', 'x..x...', 'x.x....', 'xx.....', 'x......'],
  ['x..x..x', '.x.x.x.', '..xxx..', '...x...', '...x...', '...x...', '...x...', '...x...', '...x...'],
];
const RUNES_S = [
  ['x.x', 'xx.', 'x.x', 'x..'],
  ['.x.', 'x.x', '.x.', '.x.'],
  ['x.x', 'xxx', 'x.x', 'x.x'],
  ['xx.', 'x.x', 'xx.', 'x.x'],
  ['x..', 'xx.', 'x.x', 'xx.'],
  ['.x.', 'xxx', '.x.', '.x.'],
];
function rune(p: Px, j: number, x: number, y: number, d: number, vis: number, col: RGBA, lite: RGBA): void {
  const g = (HI ? RUNES_L : RUNES_S)[j % 6];
  const x0 = Math.round(x - g[0].length / 2);
  const y0 = Math.round(y - g.length / 2);
  // Ореол: клетки вокруг знака цветом редкости.
  for (let yy = -1; yy <= g.length; yy++)
    for (let xx = -1; xx <= g[0].length; xx++) {
      const on = g[yy]?.[xx] === 'x';
      if (!dith(x0 + xx, y0 + yy, vis)) continue;
      if (on) put(p, x0 + xx, y0 + yy, d, lite);
      else {
        const nb =
          g[yy]?.[xx - 1] === 'x' ||
          g[yy]?.[xx + 1] === 'x' ||
          g[yy - 1]?.[xx] === 'x' ||
          g[yy + 1]?.[xx] === 'x';
        if (nb) put(p, x0 + xx, y0 + yy, d, withA(col, 0.85), true);
      }
    }
}

/** Свет до открытия: щели и скважина горят цветом редкости, рядом — отсвет. */
function leakFx(p: Px, f: CFrame, k: number, col: RGBA, lite: RGBA): void {
  if (k <= 0.01) return;
  const w = f.w;
  const halo: number[] = [];
  for (let i = 0; i < f.w * f.h; i++) {
    if (f.emi[i] !== 1) continue;
    const j = i * 4;
    const c = mixc([p.data[j], p.data[j + 1], p.data[j + 2], 255], k > 0.6 ? lite : col, Math.min(1, k * 1.3));
    p.data[j] = c[0];
    p.data[j + 1] = c[1];
    p.data[j + 2] = c[2];
    for (const n of [i - w, i + w]) if (n >= 0 && n < f.w * f.h && f.emi[n] !== 1 && f.pal[n] >= 0) halo.push(n);
  }
  const a = 0.5 * k;
  for (const n of halo) {
    const j = n * 4;
    p.data[j] = Math.min(255, p.data[j] + col[0] * a);
    p.data[j + 1] = Math.min(255, p.data[j + 1] + col[1] * a);
    p.data[j + 2] = Math.min(255, p.data[j + 2] + col[2] * a);
  }
}

// ---------------------------------------------------------------------------
// Кадр.
// ---------------------------------------------------------------------------

function setup(res: Res): Canvas {
  const cv = RES[res];
  RR = cv.box / RES.s.box;
  HI = res === 'l';
  PX = 1 / RR;
  OX = cv.bx + cv.box / 2;
  OY = cv.by + 38 * RR;
  return cv;
}

function palsFor(k: Kind): RGBA[][] {
  const L = LOOK[k];
  const P: RGBA[][] = [];
  P[P_WOOD] = L.wood;
  P[P_METAL] = L.metal;
  P[P_PLATE] = L.plate;
  P[P_GOLD] = GOLD;
  P[P_LINING] = L.lining;
  P[P_COIN] = GOLD;
  P[P_AMETH] = AMETH;
  P[P_RUBY] = RUBY;
  P[P_EMER] = EMER;
  P[P_SAPH] = SAPH;
  P[P_TRIM] = GOLD;
  P[P_KEY] = KEY_P;
  P[P_GLYPH] = GLYPH;
  return P;
}

/** Ключ-«слеза» в скважине: капля остриём вверх, поворот `a` по часовой. */
function keyShape(f: CFrame, o: Pose): void {
  if (o.keyVis <= 0) return;
  const C = chestXf(o);
  const O = apply(C, [0, PLATE_Y + 0.9, KEY_Z + 0.2]);
  const E1 = mv(C.m, [1, 0, 0]);
  const E2 = mv(C.m, [0, 0, 1]);
  const ca = Math.cos(o.key);
  const sa = Math.sin(o.key);
  const len = HI ? 3.6 : 3.4;
  const wid = HI ? 2.0 : 1.7;
  planeShape(
    f,
    [O[0] * RR, O[1] * RR, O[2] * RR],
    [E1[0] * RR, E1[1] * RR, E1[2] * RR],
    [E2[0] * RR, E2[1] * RR, E2[2] * RR],
    len + 1,
    P_KEY,
    nid(),
    M_KEY,
    (u, v) => {
      // В своей системе ключа: остриё по оси (sin a, cos a).
      const ku = u * ca - v * sa;
      const kv = u * sa + v * ca;
      // Капля: круг внизу + сужение кверху.
      const y = kv + len * 0.35;
      const r = y < 0 ? wid : wid * (1 - y / (len * 1.05));
      if (y < -wid || y > len * 1.05 || Math.abs(ku) > Math.max(0, Math.sqrt(Math.max(0, r * r - (y < 0 ? y * y : 0))))) return -1;
      if (o.keyVis < 1 && !dith(Math.floor(u * RR + 64), Math.floor(v * RR + 64), o.keyVis)) return -1;
      // Блик слева-сверху, тень справа-снизу.
      const lit = -ku * 0.6 + kv * 0.25;
      return 3 + lit * 1.4 + (Math.abs(ku) > r - PX * 1.1 ? -1 : 0);
    },
    OX,
    OY,
  );
}

/** Кадр `i` полосы `name` в размере `res`. */
export function frame(name: string, i: number, res: Res = 's'): Px {
  const cv = setup(res);
  const { kind, mode } = parse(name);
  const st = STRIPS[name];
  const t = i / st.fps;
  K = kind;
  LK = LOOK[kind];
  PALS = palsFor(kind);
  NEXT_ID = 0;
  const o = poseOf(name, t);
  const f = newCFrame(cv.cw, cv.ch);
  const prims = build(o);
  for (const P of prims) raster(f, P, OX, OY);
  keyShape(f, o);

  // Свет внутри: нутро, обивка и добро светлеют (в палитре, ступенями).
  if (o.inner > 0.01 || o.flash > 0.01) {
    const up = Math.round(o.inner * 2 + o.flash * 2);
    for (let j = 0; j < f.w * f.h; j++) {
      if (f.pal[j] < 0) continue;
      const m = f.mat[j];
      const add2 = m === M_IN || m === M_LOOT ? up : Math.round(o.flash * 2);
      if (add2) f.tone[j] = Math.min(PALS[f.pal[j]].length - 1, f.tone[j] + add2);
    }
  }
  // Проход блика по металлу.
  if (o.sheen >= 0) {
    const sx0 = OX - 26 * RR + o.sheen * 52 * RR;
    const bw = HI ? 5 : 2.5;
    for (let y = 0; y < f.h; y++)
      for (let x = 0; x < f.w; x++) {
        const j = y * f.w + x;
        if (f.pal[j] < 0 || (f.mat[j] !== M_METAL && f.mat[j] !== M_GEM)) continue;
        const dd = x - sx0 + (y - OY) * 0.6;
        if (Math.abs(dd) < bw) {
          const pl = PALS[f.pal[j]];
          const up = Math.abs(dd) < bw * 0.45 ? 2 : 1;
          f.tone[j] = Math.min(pl.length - 1, f.tone[j] + (K === 'common' ? 1 : up));
        }
      }
  }
  seams(f, 1.2 * RR, 1);
  rimLight(f, PALS, (pl) => pl !== P_LINING && pl !== P_KEY);
  const p = toPx(f, PALS);
  selOutline(p, INK, 0.8);

  // Глубина для оверлеев: у контура — от соседа.
  DZ = new Float32Array(f.zb);
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      const j = y * p.w + x;
      if (f.pal[j] >= 0 || p.data[j * 4 + 3] === 0) continue;
      let best = -1e9;
      if (x > 0) best = Math.max(best, f.zb[j - 1]);
      if (x < p.w - 1) best = Math.max(best, f.zb[j + 1]);
      if (y > 0) best = Math.max(best, f.zb[j - p.w]);
      if (y < p.h - 1) best = Math.max(best, f.zb[j + p.w]);
      DZ[j] = best;
    }

  const col = LK.col;
  const lite = LK.lite;
  leakFx(p, f, o.leak, col, lite);
  // Светящиеся «?» и камни: ореол шахматкой вокруг.
  glowFx(p, f, o);
  if (o.flash > 0.01) flashFx(p, f, o.flash, lite);
  if (o.lift > 0.6) shadow(p, o);
  if (mode === 'open') openFx(p, f, kind as Tier, t, o);
  if (mode === 'idle') idleFx(p, kind, t, o);
  return p;
}

/** Ореол у знака «?» и мерцание камня. */
function glowFx(p: Px, f: CFrame, o: Pose): void {
  if (K === 'mystery') {
    const k = 0.35 + 0.65 * o.twinkle;
    const col = LK.col;
    for (let y = 1; y < f.h - 1; y++)
      for (let x = 1; x < f.w - 1; x++) {
        const j = y * f.w + x;
        if (f.emi[j] !== 2) {
          const near =
            f.emi[j - 1] === 2 || f.emi[j + 1] === 2 || f.emi[j - f.w] === 2 || f.emi[j + f.w] === 2;
          if (near && f.pal[j] >= 0 && dith(x, y, k * 0.9)) put(p, x, y, 1e9, withA(col, 0.5 * k), true);
          continue;
        }
        const c = mixc(GLYPH[2], GLYPH[5], k);
        p.set(x, y, c);
      }
  }
}

function flashFx(p: Px, f: CFrame, k: number, lite: RGBA): void {
  for (let j = 0; j < f.w * f.h; j++) {
    if (p.data[j * 4 + 3] === 0) continue;
    const c = mixc([p.data[j * 4], p.data[j * 4 + 1], p.data[j * 4 + 2], 255], lite, 0.6 * k);
    p.data[j * 4] = c[0];
    p.data[j * 4 + 1] = c[1];
    p.data[j * 4 + 2] = c[2];
  }
}

/** Тень на полу, только в прыжке: меньше и бледнее, чем выше сундук. */
function shadow(p: Px, o: Pose): void {
  const base = chestPt({ ...o, lift: 0 }, [0, 0, 0]);
  const [cx, cy] = sp(base);
  const s = 1 / (1 + o.lift * 0.05);
  const rx = RR * 20 * s;
  const ry = RR * 7 * s;
  const vis = 0.55 * s;
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const q = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2;
      if (q > 1 || !dith(x, y, vis)) continue;
      const j = (y * p.w + x) * 4;
      if (x < 0 || y < 0 || x >= p.w || y >= p.h || p.data[j + 3] > 0) continue;
      p.set(x, y, [8, 4, 10, 120]);
    }
}

/** Детерминированные частицы: n штук, своё зерно. */
const rnd = (j: number, s: number) => hash(j, s, 1234);

function openFx(p: Px, f: CFrame, tier: Tier, t: number, o: Pose): void {
  const col = LK.col;
  const lite = LK.lite;
  const M = OPEN_MARKS[tier];
  const tOpen = M.lidOpen / 24;
  const peak = M.peak / 24;
  // Ключ растворяется: искорки цвета слезы (у редкого и выше).
  if (tier !== 'common' && o.keyVis > 0 && o.keyVis < 1) {
    const kp = chestPt(o, [0, PLATE_Y + 1, KEY_Z]);
    const [x, y, d] = sp(kp);
    const life = 1 - o.keyVis;
    for (let j = 0; j < 3; j++)
      sparkle(p, x + (rnd(j, 1) - 0.5) * 6 * RR, y - life * 4 * RR - rnd(j, 2) * 3 * RR, d + 2, life, KEY_P[3], WHITE);
  }
  // Светлый «щелчок» в скважине на защёлке.
  const tl = M.latch / 24;
  if (t >= tl && t < tl + 0.13 && tier !== 'common') {
    const kp = chestPt(o, [0, PLATE_Y + 1, KEY_Z]);
    const [x, y, d] = sp(kp);
    sparkle(p, x, y, d + 2, (t - tl) / 0.13, col, lite);
  }

  if (tier === 'common') {
    // Пыль из щели крышки и у петель, когда крышка трогается и бьётся об упор.
    const puffs: [number, V3, number][] = [
      [0.6, [-12, D2 + 1, H + 0.5], 0],
      [0.62, [10, D2 + 1, H + 0.5], 1],
      [0.64, [-1, D2 + 1.5, H + 1], 2],
      [0.76, [-14, -D2 - 1, H + 1], 3],
      [0.78, [12, -D2 - 1, H + 1], 4],
    ];
    for (const [t0, w, j] of puffs) {
      const u = (t - t0) / 0.32;
      if (u < 0 || u > 1) continue;
      const pw = chestPt(o, [w[0] + (rnd(j, 3) - 0.5) * 4 * u, w[1] + 2 * u, w[2] + 5 * u]);
      const [x, y, d] = sp(pw);
      puff(p, x, y, d + 1, 1.4 + 2.2 * u, 1 - u * u, hx('#a89a88'));
    }
    // Блик на монете.
    const life = (t - peak) / 0.28;
    if (life > 0 && life < 1) {
      const gp = chestPt(o, [-5, 0, LK.heap - 0.5]);
      const [x, y, d] = sp(gp);
      sparkle(p, x, y, d + 30, life, GOLD[6], WHITE);
    }
    return;
  }

  // Столб света из проёма.
  if (tier === 'rare') beam(p, o, t, o.beam, col, lite, 22, 0.62);
  if (tier === 'epic') beam(p, o, t, o.beam, col, lite, 58, 0.5);
  if (tier === 'legend') beam(p, o, t, o.beam, col, lite, 84, 0.66);
  if (tier === 'legend') burst(p, o, kf(t, [[1.08, 0], [1.12, 1], [1.5, 0]]), t * 0.6, col, lite);

  // Кольцо света по полу (редкий — при открытии, эпик — на посадке).
  if (tier === 'rare') {
    const u = (t - tOpen - 0.04) / 0.45;
    if (u > 0 && u < 1) ring(p, o, 14 + 16 * u, 1 - u, lite, HI ? 2 : 1);
  }
  if (tier === 'epic') {
    const u = (t - 0.92) / 0.4;
    if (u > 0 && u < 1) ring(p, o, 15 + 17 * u, 1 - u, lite, HI ? 2 : 1);
    // Пыль из-под днища на посадке.
    for (let j = 0; j < 4; j++) {
      const v = (t - 0.91) / 0.3;
      if (v < 0 || v > 1) continue;
      const sx = j < 2 ? -1 : 1;
      const pw = chestPt({ ...o, lift: 0 }, [sx * (16 + 6 * v + j * 2), (j % 2 ? 1 : -1) * 6, 1 + 2 * v]);
      const [x, y, d] = sp(pw);
      puff(p, x, y, d + 1, 1.2 + 1.6 * v, 1 - v, hx('#8c7ea0'));
    }
  }
  if (tier === 'legend') {
    const u = (t - 1.24) / 0.5;
    if (u > 0 && u < 1) {
      ring(p, o, 14 + 26 * u, 1 - u, lite, HI ? 3 : 2);
      if (u > 0.15) ring(p, o, 10 + 20 * (u - 0.15), 1 - u, col, 1);
    }
    for (let j = 0; j < 6; j++) {
      const v = (t - 1.23) / 0.36;
      if (v < 0 || v > 1) continue;
      const a = (j / 6) * PI * 2 + 0.3;
      const pw = chestPt({ ...o, lift: 0 }, [Math.cos(a) * (19 + 8 * v), Math.sin(a) * (12 + 5 * v), 1 + 3 * v]);
      const [x, y, d] = sp(pw);
      puff(p, x, y, d + 1, 1.4 + 2 * v, 1 - v, hx('#b09a70'));
    }
  }

  // Искры из проёма.
  const nSp = tier === 'rare' ? 10 : tier === 'epic' ? 12 : 18;
  const spEnd = tier === 'rare' ? 0.62 : 1.1;
  for (let j = 0; j < nSp; j++) {
    const t0 = peak + rnd(j, 11) * (tier === 'legend' ? 0.8 : 0.25);
    const life = (t - t0) / (0.3 + rnd(j, 12) * 0.3);
    if (life <= 0 || life >= 1 || t > peak + spEnd) continue;
    const a = rnd(j, 13) * PI * 2;
    const sp0 = 10 + rnd(j, 14) * 14;
    const u = 1 - (1 - life) ** 2;
    const w: V3 = [
      Math.cos(a) * (W2 - 4) * 0.6 * rnd(j, 15) + Math.cos(a) * sp0 * u,
      Math.sin(a) * 6 + Math.sin(a) * sp0 * 0.6 * u,
      H + 1 + (14 + rnd(j, 16) * 16) * u - 6 * life * life,
    ];
    const [x, y, d] = sp(chestPt({ ...o, lift: o.lift }, w));
    sparkle(p, x, y, d, life, col, lite);
  }

  // Эпик: руны поднимаются из проёма и кружат вокруг сундука.
  if (tier === 'epic') {
    for (let j = 0; j < 6; j++) {
      const t0 = 0.8 + j * 0.04;
      const u = t - t0;
      if (u < 0 || t > 1.52) continue;
      const rise = clamp01(u / 0.35);
      const e = 1 - (1 - rise) ** 2;
      const a = (j / 6) * PI * 2 + u * ((2 * PI) / 1.2) + 0.4;
      const r = 4 + 24 * e;
      const z = H + 2 + 12 * e - 3 * clamp01((u - 0.35) / 0.4) + Math.sin(u * 7 + j) * 1.2;
      const vis = clamp01(rise * 3) * clamp01((1.52 - t) / 0.24);
      const base = chestPt({ ...o, lift: 0 }, [0, 0, 0]);
      const w: V3 = [base[0] + Math.cos(a) * r * 1.15, base[1] + Math.sin(a) * r * 0.8, z];
      const [x, y, d] = sp(w);
      rune(p, j, x, y, d, vis, col, lite);
    }
  }

  // Легендарный: вихрь искр сходится к сундуку перед прыжком; фонтан монет.
  if (tier === 'legend') {
    for (let j = 0; j < 12; j++) {
      const t0 = 0.26 + rnd(j, 21) * 0.4;
      const dur = 0.42;
      for (let tr = 0; tr < 3; tr++) {
        const u = (t - tr * 0.025 - t0) / dur;
        if (u < 0 || u > 1) continue;
        const a = rnd(j, 22) * PI * 2 + u * 4.2;
        const r = 40 * (1 - u) + 6;
        const z = 6 + rnd(j, 23) * 16 * (1 - u) + 6 * u;
        const w: V3 = [Math.cos(a) * r, Math.sin(a) * r * 0.7, z];
        const [x, y, d] = sp(chestPt({ ...o, shx: 0, roll: 0 }, w));
        const c = tr === 0 ? lite : withA(col, 0.75 - tr * 0.2);
        if (tr === 0) {
          put(p, x, y, d, WHITE);
          put(p, x + 1, y, d, lite);
          put(p, x - 1, y, d, lite);
          put(p, x, y + 1, d, lite);
          put(p, x, y - 1, d, lite);
          if (HI) {
            put(p, x + 2, y, d, withA(col, 0.8), true);
            put(p, x - 2, y, d, withA(col, 0.8), true);
            put(p, x, y + 2, d, withA(col, 0.8), true);
            put(p, x, y - 2, d, withA(col, 0.8), true);
          }
        } else {
          put(p, x, y, d, c, true);
          if (HI) put(p, x + 1, y, d, withA(col, 0.4), true);
        }
      }
    }
    // Монеты: вылет из проёма, падение на пол на своей глубине, отскок, покой.
    const G = 220;
    for (let j = 0; j < 16; j++) {
      const t0 = 1.12 + j * 0.03;
      const tau = t - t0;
      if (tau < 0) continue;
      const a = rnd(j, 31) * PI * 2;
      const hv = 14 + rnd(j, 32) * 18;
      const vx = Math.cos(a) * hv * 1.2;
      const vy = Math.sin(a) * hv * 0.6 + 5;
      const vz = 72 + rnd(j, 33) * 26;
      const x0 = (rnd(j, 34) - 0.5) * 16;
      const y0 = (rnd(j, 35) - 0.5) * 8;
      const z0 = H + 1;
      const tl1 = (vz + Math.sqrt(vz * vz + 2 * G * z0)) / G;
      let X: number;
      let Y: number;
      let Z: number;
      let rest = 0;
      if (tau < tl1) {
        X = x0 + vx * tau;
        Y = y0 + vy * tau;
        Z = z0 + vz * tau - 0.5 * G * tau * tau;
      } else {
        const vz2 = 0.35 * (G * tl1 - vz);
        const tl2 = (2 * vz2) / G;
        const t2 = tau - tl1;
        const bx0 = x0 + vx * tl1;
        const by0 = y0 + vy * tl1;
        if (t2 < tl2) {
          X = bx0 + vx * 0.6 * t2;
          Y = by0 + vy * 0.6 * t2;
          Z = vz2 * t2 - 0.5 * G * t2 * t2;
        } else {
          X = bx0 + vx * 0.6 * tl2;
          Y = by0 + vy * 0.6 * tl2;
          Z = 0;
          rest = t2 - tl2;
        }
      }
      const vis = clamp01(1 - (rest - 0.12) / 0.2);
      if (vis <= 0 || t > 2.12) continue;
      const base = chestPt({ ...o, lift: 0, shx: 0, roll: 0 }, [0, 0, 0]);
      const [x, y, d] = sp([base[0] + X, base[1] + Y, Math.max(0, Z) + (HI ? 0.7 : 0.6)]);
      coinSpr(p, x, y, d, rest > 0 ? 0 : tau * (9 + j % 4), vis);
    }
  }
}

function idleFx(p: Px, kind: Kind, t: number, o: Pose): void {
  // Мерцание камня (эпик) или заклёпки (редкий).
  if ((kind === 'epic' || kind === 'rare') && o.twinkle > 0) {
    const life = clamp01((t - 1.15) / 0.4);
    const lp = kind === 'epic' ? [0, PLATE_Y + 2.4, H - 2.0] : [-LOOK.rare.bandX, D2 + 0.6, 13.3];
    const C = chestXf(o);
    // Камень epic — на накладке крышки.
    const w = kind === 'epic' ? apply(xc(C, xc(lidXf(o), haspXf(o))), [0, 1.6, -2.4]) : apply(C, lp as V3);
    const [x, y, d] = sp(w);
    sparkle(p, x - RR * 0.6, y - RR * 0.6, d + 2, life, kind === 'epic' ? AMETH[5] : STEEL[6], WHITE);
  }
  if (kind === 'legend') {
    // Три искры в разных местах и в разное время.
    const pts: [number, V3][] = [
      [0.2, [-17, 9, 20]],
      [0.85, [16, -4, 24]],
      [1.4, [3, 12, 8]],
    ];
    for (const [t0, w] of pts) {
      const life = (t - t0) / 0.4;
      if (life <= 0 || life >= 1) continue;
      const [x, y, d] = sp(chestPt(o, w));
      sparkle(p, x, y, d + 3, life, LOOK.legend.col, LOOK.legend.lite);
    }
  }
}

/** Скважина в покое — в долях рамки (туда летит ключ). */
function lockAnchor(): [number, number] {
  const cv = setup('l');
  const [x, y] = sp(chestPt(REST, [0, PLATE_Y, KEY_Z]));
  return [
    Math.round(((x - cv.bx) / cv.box) * 1000) / 1000,
    Math.round(((y - cv.by) / cv.box) * 1000) / 1000,
  ];
}
const LOCK = lockAnchor();

export const STRIPS: Record<string, StripDef> = {
  'idle-common': { frames: 24, fps: 12, loop: true, anchors: { lock: LOCK } },
  'idle-rare': { frames: 24, fps: 12, loop: true, anchors: { lock: LOCK } },
  'idle-epic': { frames: 24, fps: 12, loop: true, anchors: { lock: LOCK } },
  'idle-legend': { frames: 24, fps: 12, loop: true, anchors: { lock: LOCK } },
  'idle-mystery': { frames: 24, fps: 12, loop: true },
  /** Два настоящих оборота за 0,92 с; кадр 0 — поза неподвижного. Только сцена — крупная. */
  'mystery-spin': { frames: SPIN_N, fps: 24, loop: true, res: ['l'] },
  'open-common': openDef('common'),
  'open-rare': openDef('rare'),
  'open-epic': openDef('epic'),
  'open-legend': openDef('legend'),
};
function openDef(t: Tier): StripDef {
  return { frames: OPEN_N[t], fps: 24, loop: false, marks: OPEN_MARKS[t], anchors: { lock: LOCK } };
}

// Служебное для тестов: поза полосы.
export const __test = { poseOf, REST, parse };
