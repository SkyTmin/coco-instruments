// Пиксельные яйца (мшистое, каменное, кристальное, драконье) — рисунок кодом в стиле
// пиксельных питомцев и боссов. Подробности и решения — `.claude/rules/props-pixel.md`.
//
// Яйцо — поверхность вращения (профиль r(s): s −1 низ … +1 верх, низ шире), низ на полу,
// камера и свет — риг питомцев (`pets-pixel/rig.ts`): луч на пиксель, буфер глубины, тон —
// ступень палитры, контур «по соседу». Узор (мох, крапины, руны, грани, чешуя, жилы, трещины)
// задан в МЕСТНЫХ координатах яйца (угол φ: 0 — к зрителю, + — вправо; s) — он поворачивается
// вместе с яйцом, дальняя сторона выходит из-за края при повороте.
// После разлома скорлупа — жёсткие куски (области между трещинами), они рисуются точками
// поверхности (снаружи — материал, изнутри — плёнка, по излому — светлая кромка), летят по
// дугам, падают на пол, отскакивают и тают шахматкой.
//
// Полосы: `idle-<egg>` (петля 2 с), `hatch-<egg>-r<r>` (12 сочетаний, только крупная),
// `pop-<egg>` (0,6 с, только малая — «вылупить все»). Всё детерминировано.

import type { Px } from '../dungeon-art';
import {
  LIGHT,
  VIEW,
  add,
  axes,
  bump,
  clamp01,
  cross,
  dith,
  dot,
  drawParts,
  hash,
  hx,
  kf,
  lerp,
  mixc,
  mul,
  newFrame,
  norm,
  ramp,
  selOutline,
  seams,
  sub,
  toPx,
  wrap,
} from '../pets-pixel/rig';
import type { Frame, Key, Part, RGBA, V3 } from '../pets-pixel/rig';
import { RARITIES } from '../rarity';
import type { Canvas, Res, StripDef } from './types';

export const EGG_KINDS = ['moss', 'stone', 'crystal', 'dragon'] as const;
export type EggKind = (typeof EGG_KINDS)[number];
/** Какие редкости выпадают из какого яйца (сверяется с `EGGS[].odds` в тесте). */
export const EGG_RARITIES: Record<EggKind, number[]> = {
  moss: [0, 1, 2],
  stone: [1, 2, 3],
  crystal: [2, 3, 4],
  dragon: [3, 4, 5],
};

export const RES: { s: Canvas; l: Canvas } = {
  s: { box: 36, cw: 112, ch: 112, bx: 38, by: 66 },
  l: { box: 112, cw: 360, ch: 372, bx: 124, by: 206 },
};

export const FPS = 24;
/** До разлома (с), по редкости: чем реже, тем дольше вопрос. */
export const HATCH_WOB = [1.1, 1.3, 1.6, 2.0, 2.6, 3.2];
/** После разлома до конца полосы (куски падают и тают). */
export const HATCH_POST = [0.8, 0.85, 0.95, 1.05, 1.15, 1.35];
const IDLE_N = 48;
const POP_N = 15;

const fr = (t: number) => Math.round(t * FPS);
export interface Plan {
  W: number;
  c1: number;
  c2: number;
  c3: number;
  b: number;
  clear: number;
  end: number;
  n: number;
}
/** Времена фаз — от кадров меток, чтобы трещина появлялась ровно на кадре метки. */
export function hatchPlan(r: number): Plan {
  const W = HATCH_WOB[r];
  const n = fr(W + HATCH_POST[r]);
  const c1 = fr(W * 0.34) / FPS;
  const c2 = fr(W * 0.62) / FPS;
  const c3 = fr(W * 0.86) / FPS;
  const b = fr(W) / FPS;
  return { W, c1, c2, c3, b, clear: b + 5 / FPS, end: n / FPS, n };
}

function hatchStrip(r: number): StripDef {
  const p = hatchPlan(r);
  return {
    frames: p.n,
    fps: FPS,
    loop: false,
    res: ['l'],
    marks: {
      w1: 0,
      crack1: fr(p.c1),
      w2: fr(p.c1) + 1,
      crack2: fr(p.c2),
      w3: fr(p.c2) + 1,
      crack3: fr(p.c3),
      burst: fr(p.b),
      clear: fr(p.clear),
    },
  };
}

export const STRIPS: Record<string, StripDef> = {};
for (const k of EGG_KINDS) STRIPS[`idle-${k}`] = { frames: IDLE_N, fps: FPS, loop: true };
for (const k of EGG_KINDS)
  for (const r of EGG_RARITIES[k]) STRIPS[`hatch-${k}-r${r}`] = hatchStrip(r);
for (const k of EGG_KINDS)
  STRIPS[`pop-${k}`] = {
    frames: POP_N,
    fps: FPS,
    loop: false,
    res: ['s'],
    marks: { burst: 6, clear: 8 },
  };

// ---------------------------------------------------------------------------
// Камера, свет, палитры.
// ---------------------------------------------------------------------------

const CE = VIEW[1];
const SE = VIEW[2];
const HV = norm(add(LIGHT, VIEW));

const PALS: RGBA[][] = [];
const pal = (p: RGBA[]) => PALS.push(p) - 1;
const MOSS_SHELL = pal(ramp('#1f150d', '#362618', '#523b24', '#6f5432', '#8d6d42', '#ab8a58', '#c9aa74'));
const MOSS = pal(ramp('#0f1f0c', '#173512', '#215016', '#2e6c1a', '#40891f', '#5ea828', '#8ccc3a'));
const SPROUT = pal(ramp('#173018', '#225020', '#2f7428', '#46982f', '#69b83a', '#97d652', '#c8f080'));
const STONE = pal(ramp('#17181d', '#25272d', '#373941', '#4c4e57', '#666871', '#84868e', '#a7a8ae'));
const FRESH = pal(ramp('#2c2a2c', '#433f40', '#5d5857', '#7a7471', '#99928c', '#b8b0a8', '#d6cec4'));
const RUNE = pal(ramp('#0d2426', '#14403f', '#1d6460', '#2c8d81', '#47b8a2', '#7fe0c8', '#cffff0'));
const CRYS = pal(ramp('#10243e', '#173e60', '#1f5d84', '#2f84a8', '#53acc8', '#8cd6e6', '#d4f7fc'));
const CORE = pal(ramp('#3d8fb4', '#62b5d2', '#8fd6e8', '#bdeef6', '#e6fbfd', '#ffffff'));
const DRAG = pal(ramp('#0d0508', '#1d0a0f', '#32101a', '#4d1820', '#6b2226', '#8c302e', '#ad453a'));
const HOT = pal(ramp('#24090a', '#3c110d', '#5a1a10', '#7c2714', '#a23a18', '#c6541e', '#e2742a'));
const EMBER = pal(ramp('#3a0a04', '#6e1606', '#a8300a', '#d85a12', '#f48a22', '#ffb84a', '#ffe8a0'));
const INNER = pal(ramp('#3e3428', '#5e5242', '#827562', '#a89a82', '#cbbfa4', '#e8dfc8', '#fbf6ea'));
/** Свет редкости: из тёмного через основной к белому. */
const GLOW: number[] = RARITIES.slice(0, 6).map((q) => {
  const d = hx(q.dark);
  const c = hx(q.color);
  const l = hx(q.light);
  return pal([d, mixc(d, c, 0.55), c, mixc(c, l, 0.5), l, hx('#ffffff')]);
});
/** Изнанка скорлупы, освещённая изнутри светом редкости. */
const INGLOW: number[] = RARITIES.slice(0, 6).map((q) =>
  pal(PALS[INNER].map((c, i) => mixc(c, hx(q.light), 0.12 + i * 0.07))),
);
const INK = hx('#120a10');

const SHELL: Record<EggKind, number> = {
  moss: MOSS_SHELL,
  stone: STONE,
  crystal: CRYS,
  dragon: DRAG,
};

// ---------------------------------------------------------------------------
// Форма и положение яйца.
// ---------------------------------------------------------------------------

/** Профиль в пикселях малой полосы: высота, радиус, «острота» верха. */
const SHAPE: Record<EggKind, { H: number; R: number; a: number }> = {
  moss: { H: 30.5, R: 11.9, a: 0.14 },
  stone: { H: 30, R: 12.3, a: 0.12 },
  crystal: { H: 31.2, R: 11.3, a: 0.19 },
  dragon: { H: 31, R: 11.7, a: 0.16 },
};

/** Яйцо в кадре: низ `B`, ось `A`, местные «вперёд» `E1` и «вправо» `E2`, размеры в пикселях холста. */
interface Pose {
  B: V3;
  A: V3;
  E1: V3;
  E2: V3;
  H: number;
  R: number;
  a: number;
  /** Масштаб полосы (пикселей холста на пиксель малой). */
  S: number;
}

function prof(H: number, R: number, a: number, s: number) {
  const c = 1 - s * s;
  return c <= 0 ? 0 : R * Math.sqrt(c) * (1 - a * s);
}

/** Местная точка (в пикселях малой: x вправо, y вперёд, z вверх от низа) → кадр. */
function toWorld(P: Pose, l: V3): V3 {
  const k = P.S;
  return [
    P.B[0] + (P.E2[0] * l[0] + P.E1[0] * l[1] + P.A[0] * l[2]) * k,
    P.B[1] + (P.E2[1] * l[0] + P.E1[1] * l[1] + P.A[1] * l[2]) * k,
    P.B[2] + (P.E2[2] * l[0] + P.E1[2] * l[1] + P.A[2] * l[2]) * k,
  ];
}
const dirWorld = (P: Pose, l: V3): V3 => [
  P.E2[0] * l[0] + P.E1[0] * l[1] + P.A[0] * l[2],
  P.E2[1] * l[0] + P.E1[1] * l[1] + P.A[1] * l[2],
  P.E2[2] * l[0] + P.E1[2] * l[1] + P.A[2] * l[2],
];
/** Точка поверхности по (φ, s) в местных координатах (пиксели малой). */
function surfLocal(kind: EggKind, phi: number, s: number, out = 0): V3 {
  const { H, R, a } = SHAPE[kind];
  const r = prof(H, R, a, s) + out;
  return [r * Math.sin(phi), r * Math.cos(phi), ((s + 1) * H) / 2];
}
/** Нормаль поверхности в местных координатах. */
function normLocal(kind: EggKind, phi: number, s: number): V3 {
  const { H, R, a } = SHAPE[kind];
  const c = 1 - s * s;
  if (c < 1e-5) return [0, 0, s > 0 ? 1 : -1];
  const sq = Math.sqrt(c);
  const drds = R * ((-s / sq) * (1 - a * s) - a * sq);
  const drdh = (drds * 2) / H;
  return norm([Math.sin(phi), Math.cos(phi), -drdh]);
}

/** Повороты: вращение вокруг оси `ax` на угол `an` (Родриг). */
function rotV(v: V3, ax: V3, an: number): V3 {
  const c = Math.cos(an);
  const s = Math.sin(an);
  const k = dot(ax, v) * (1 - c);
  const cr = cross(ax, v);
  return [v[0] * c + cr[0] * s + ax[0] * k, v[1] * c + cr[1] * s + ax[1] * k, v[2] * c + cr[2] * s + ax[2] * k];
}

interface PoseIn {
  /** Крен (рад) и направление крена: 0 — в плоскости кадра (вправо +), π/2 — к зрителю. */
  tilt: number;
  beta: number;
  /** Подъём над полом и сдвиг (пиксели малой). */
  lift: number;
  x: number;
  y: number;
  /** Поворот вокруг своей оси (рад). */
  spin: number;
  /** Сжатие/вытяжение вдоль оси. */
  st: number;
}
const REST: PoseIn = { tilt: 0, beta: 0, lift: 0, x: 0, y: 0, spin: 0, st: 0 };

/**
 * Положение яйца: поворот вокруг своей оси, крен вокруг низа, потом сдвиг так, чтобы самая
 * низкая точка поверхности легла на пол (+ подъём), и перекат на радиус кривизны низа.
 */
function makePose(kind: EggKind, res: Res, q: PoseIn): Pose {
  const S = RES[res].box / 36;
  const sh = SHAPE[kind];
  const H = sh.H * (1 + q.st) * S;
  const R = sh.R * (1 - q.st * 0.5) * S;
  let A: V3 = [0, 0, 1];
  let E1: V3 = [-Math.sin(q.spin), Math.cos(q.spin), 0];
  let E2: V3 = [Math.cos(q.spin), Math.sin(q.spin), 0];
  if (q.tilt) {
    // Ось крена горизонтальна: β = 0 — ось «к зрителю» (крен в плоскости кадра).
    const ax: V3 = [-Math.sin(q.beta), Math.cos(q.beta), 0];
    A = rotV(A, ax, q.tilt);
    E1 = rotV(E1, ax, q.tilt);
    E2 = rotV(E2, ax, q.tilt);
  }
  // Самая низкая точка: профиль в плоскости оси и вертикали (перпендикуляр к оси «вниз»).
  // Поворот вокруг нижнего полюса + подъём до пола = перекат по кривизне низа.
  let minZ = 0;
  const dz = -1 + A[2] * A[2];
  const pz = Math.abs(dz) > 1e-9 ? dz / Math.hypot(A[0] * A[2], A[1] * A[2], dz) : 0;
  for (let j = 0; j <= 64; j++) {
    const s = -1 + j / 32;
    const z = (A[2] * (s + 1) * H) / 2 + pz * prof(H, R, sh.a, s);
    if (z < minZ) minZ = z;
  }
  const B: V3 = [q.x * S, q.y * S, q.lift * S - minZ];
  return { B, A, E1, E2, H, R, a: sh.a, S };
}

// ---------------------------------------------------------------------------
// Шум и узоры (в местных координатах).
// ---------------------------------------------------------------------------

const sm = (u: number) => u * u * (3 - 2 * u);
function vnoise(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const fx = sm(x - xi);
  const fy = sm(y - yi);
  const fz = sm(z - zi);
  const h = (a: number, b: number, c: number) =>
    hash(a + Math.imul(c, 7919), b + Math.imul(c, 104729), seed);
  const l = (a: number, b: number, k: number) => a + (b - a) * k;
  return l(
    l(l(h(xi, yi, zi), h(xi + 1, yi, zi), fx), l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), fx), fy),
    l(
      l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), fx),
      l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), fx),
      fy,
    ),
    fz,
  );
}
/** Ячейка решётки 3D: шум «крапин» — одна крапина на ячейку, своё место и размер. */
function speck(l: V3, cell: number, seed: number, dens: number, rad: number): number {
  const cx = Math.floor(l[0] / cell);
  const cy = Math.floor(l[1] / cell);
  const cz = Math.floor(l[2] / cell);
  let best = 9;
  for (let dz = -1; dz <= 1; dz++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const X = cx + dx;
        const Y = cy + dy;
        const Z = cz + dz;
        const hh = hash(X + Z * 131, Y - Z * 71, seed);
        if (hh > dens) continue;
        const px = (X + hash(X, Y + Z * 17, seed + 1)) * cell;
        const py = (Y + hash(X + Z * 5, Y, seed + 2)) * cell;
        const pz = (Z + hash(X - Y, Z, seed + 3)) * cell;
        const d = Math.hypot(l[0] - px, l[1] - py, l[2] - pz) / (rad * (0.6 + hh / dens));
        if (d < best) best = d;
      }
  return best;
}

const wrapPi = (a: number) => wrap(a + Math.PI, Math.PI * 2) - Math.PI;
type Seg = [number, number, number, number];
/** Расстояние от точки до отрезка на плоскости. */
function segD(px: number, py: number, s: Seg): number {
  const dx = s[2] - s[0];
  const dy = s[3] - s[1];
  const L = dx * dx + dy * dy;
  const u = L ? clamp01(((px - s[0]) * dx + (py - s[1]) * dy) / L) : 0;
  return Math.hypot(px - s[0] - dx * u, py - s[1] - dy * u);
}

// --- Руны каменного (штрихи в квадрате −1…1, y вверх) ---
const GLYPHS: Seg[][] = [
  // ᚠ — ствол и две ветви вверх-вправо
  [
    [-0.45, -1, -0.45, 1],
    [-0.45, 0.25, 0.5, 0.85],
    [-0.45, -0.25, 0.5, 0.3],
  ],
  // ᛉ — ствол и «рогатка»
  [
    [0, -1, 0, 1],
    [0, 0.2, -0.65, 0.95],
    [0, 0.2, 0.65, 0.95],
  ],
  // ᛟ — ромб на ножках
  [
    [0, 1, -0.6, 0.25],
    [-0.6, 0.25, 0, -0.45],
    [0, -0.45, 0.6, 0.25],
    [0.6, 0.25, 0, 1],
    [0, -0.45, -0.55, -1],
    [0, -0.45, 0.55, -1],
  ],
  // ᛒ — ствол и две «чаши»
  [
    [-0.4, -1, -0.4, 1],
    [-0.4, 1, 0.45, 0.5],
    [0.45, 0.5, -0.4, 0],
    [-0.4, 0, 0.45, -0.5],
    [0.45, -0.5, -0.4, -1],
  ],
];
/** Руны на камне: (φ, s) центра, размер (пиксели малой), какая. */
const RUNES: [number, number, number, number][] = [
  [-0.32, 0.12, 4.6, 0],
  [1.55, -0.12, 4.2, 1],
  [3.0, 0.22, 4.4, 2],
  [-1.75, -0.2, 4.0, 3],
];
/** Сколы камня: (φ, s, радиус) — вырезанные шары у поверхности. */
const CHIPS: [number, number, number][] = [
  [-1.25, 0.42, 1.9],
  [1.18, -0.36, 1.7],
  [0.3, 0.78, 1.5],
  [2.6, -0.5, 1.8],
];

// --- Кристалл: пояса граней (по s) и число граней в поясе ---
/** Огранка: ромбов по кругу и по высоте. */
const CUT_N = 7;
const CUT_M = 4.6;

// --- Драконье: огненные жилы (ломаные в (φ, s)) ---
const VEINS: [number, number][][] = [
  [
    [-0.35, 0.84],
    [-0.2, 0.6],
    [-0.36, 0.38],
    [-0.16, 0.13],
    [-0.3, -0.14],
    [-0.18, -0.36],
  ],
  [
    [-0.2, 0.6],
    [0.06, 0.5],
    [0.16, 0.64],
  ],
  [
    [-0.16, 0.13],
    [0.12, 0.02],
  ],
  [
    [0.78, 0.56],
    [0.62, 0.3],
    [0.82, 0.04],
    [0.7, -0.2],
  ],
  [
    [-1.0, -0.02],
    [-0.82, -0.28],
    [-1.0, -0.56],
  ],
  [
    [1.9, 0.5],
    [1.7, 0.1],
    [1.95, -0.25],
  ],
  [
    [2.9, 0.42],
    [2.7, 0.0],
  ],
  [
    [-1.9, 0.48],
    [-2.12, 0.1],
  ],
  [
    [-2.8, -0.2],
    [-2.6, -0.5],
  ],
  [
    [0.22, -0.56],
    [0.4, -0.74],
  ],
];

// --- Мох: пятна (φ, s, радиус по s) и пучки (φ, s) ---
const MOSS_PATCH: [number, number, number][] = [
  [0.72, 0.3, 0.26],
  [-0.85, 0.02, 0.28],
  [2.4, 0.4, 0.26],
  [-2.3, -0.05, 0.3],
  [-0.1, 0.66, 0.15],
];
const TUFTS: [number, number][] = [
  [-0.95, -0.62],
  [0.7, -0.68],
  [0.78, 0.32],
  [-0.9, 0.05],
  [2.1, -0.6],
  [-2.2, -0.62],
];

// ---------------------------------------------------------------------------
// Материал точки поверхности.
// ---------------------------------------------------------------------------

/** Результат материала (один объект на всё — без мусора в цикле пикселей). */
const M = { pal: 0, dt: 0, emis: -1, gl: 0, fn: null as V3 | null, kind: 0 };
const FN: V3 = [0, 0, 0];

/** Мох у основания и пятнами: 0…1 (насколько точка под мхом). */
function mossAt(phi: number, s: number, l: V3): number {
  const n = vnoise(l[0] * 0.55, l[1] * 0.55, l[2] * 0.55, 11) - 0.5;
  let m = -0.62 - s * 1.25 + n * 0.7;
  for (const [pc, sc, rr] of MOSS_PATCH) {
    const dphi = wrapPi(phi - pc) * Math.sqrt(Math.max(0.05, 1 - s * s));
    const d = Math.hypot(dphi * 0.9, s - sc) / rr;
    m = Math.max(m, 1 - d + n * 0.8);
  }
  return m;
}

/**
 * Материал по (φ, s) и местной точке `l`; `hi` — крупная полоса (мельче узор, больше деталей).
 * Свет здесь не считается — только палитра, сдвиг тона, «светится сам» (`emis`) и грань.
 */
function material(kind: EggKind, phi: number, s: number, l: V3, hi: boolean, t: number): void {
  M.pal = SHELL[kind];
  M.dt = 0;
  M.emis = -1;
  M.gl = 0;
  M.fn = null;
  M.kind = 0;
  if (kind === 'moss') {
    const m = mossAt(phi, s, l);
    if (m > 0) {
      M.pal = MOSS;
      // Кочки: у каждой светлая макушка, между ними тень.
      const d = speck(l, hi ? 1.5 : 2.2, 17, 0.95, hi ? 1.1 : 1.5);
      M.dt = d < 0.45 ? 1 : d < 0.85 ? 0 : -1;
      if (m < 0.1) M.dt -= 1;
      M.kind = 1;
      return;
    }
    const sp = speck(l, hi ? 2.2 : 3, 21, 0.55, hi ? 0.5 : 0.7);
    if (sp < 1) M.dt = -2;
    else if (sp < 1.4 && hi) M.dt = -1;
    const sp2 = speck(l, hi ? 3.2 : 4.2, 33, 0.4, hi ? 0.45 : 0.6);
    if (sp2 < 1) {
      M.pal = MOSS;
      M.dt = -1;
    }
    return;
  }
  if (kind === 'stone') {
    const g = vnoise(l[0] * 0.35, l[1] * 0.35, l[2] * 0.35, 7);
    M.dt = g > 0.68 ? 1 : g < 0.3 ? -1 : 0;
    const d1 = speck(l, hi ? 1.7 : 2.4, 41, 0.55, hi ? 0.42 : 0.6);
    if (d1 < 1) M.dt -= hi ? 2 : 1;
    const d2 = speck(l, hi ? 2.1 : 3.4, 43, 0.45, hi ? 0.42 : 0.55);
    if (d2 < 1) M.dt += 2;
    // Руны: штрих — паз; свет руны пульсирует (покой) — `emis`.
    const rr = prof(SHAPE.stone.H, SHAPE.stone.R, SHAPE.stone.a, s);
    for (const [pc, sc, sz, gi] of RUNES) {
      const u = (wrapPi(phi - pc) * rr) / sz;
      const v = ((s - sc) * SHAPE.stone.H) / 2 / sz;
      if (Math.abs(u) > 1.4 || Math.abs(v) > 1.4) continue;
      let d = 9;
      for (const sg of GLYPHS[gi]) d = Math.min(d, segD(u, v, sg));
      const w = (hi ? 0.62 : 0.9) / sz;
      if (d < w) {
        M.pal = RUNE;
        M.kind = 2;
        M.emis = 0.42;
        M.dt = 0;
        return;
      }
      // Кромка паза: верхняя в тени, нижняя на свету.
      if (hi && d < w + 0.9 / sz) {
        const up = (() => {
          let best = 9;
          let side = 0;
          for (const sg of GLYPHS[gi]) {
            const dd = segD(u, v, sg);
            if (dd < best) {
              best = dd;
              const mx = (sg[0] + sg[2]) / 2;
              const my = (sg[1] + sg[3]) / 2;
              side = v - my + (u - mx) * 0.2;
            }
          }
          return side;
        })();
        M.dt = up > 0 ? -2 : 1;
        return;
      }
    }
    return;
  }
  if (kind === 'crystal') {
    // Огранка ромбами: две косые решётки по (φ, s), у полюсов ромбы сходятся звездой.
    const A0 = (wrap(phi, Math.PI * 2) / (Math.PI * 2)) * CUT_N;
    const B0 = ((s + 1) * CUT_M) / 2;
    const a = A0 + B0;
    const b = A0 - B0;
    const ia = Math.floor(a);
    const ib = Math.floor(b);
    const pc = (((ia + ib + 1) / 2) * Math.PI * 2) / CUT_N;
    const sc = Math.max(-0.97, Math.min(0.97, (ia - ib) / CUT_M - 1));
    const nl = normLocal('crystal', pc, sc);
    FN[0] = nl[0];
    FN[1] = nl[1];
    FN[2] = nl[2];
    M.fn = FN;
    M.kind = 3;
    const hh = hash(ia + 31, ib + 17, 77);
    M.dt = hh < 0.28 ? -1 : hh > 0.8 ? 1 : 0;
    const fa = a - ia;
    const fb = b - ib;
    const e = Math.min(fa, 1 - fa, fb, 1 - fb);
    if (e < (hi ? 0.055 : 0.085)) M.dt = fa + fb > 1 ? -1 : 2;
    M.gl = (((ia * 7 + ib * 3) % 11) + 11) % 11;
    return;
  }
  // dragon: чешуя рядами + огненные жилы.
  const rr = prof(SHAPE.dragon.H, SHAPE.dragon.R, SHAPE.dragon.a, s);
  // Жилы.
  let dv = 9;
  for (const v of VEINS)
    for (let i = 1; i < v.length; i++) {
      const sg: Seg = [
        wrapPi(v[i - 1][0] - phi) * rr,
        ((v[i - 1][1] - s) * SHAPE.dragon.H) / 2,
        wrapPi(v[i][0] - phi) * rr,
        ((v[i][1] - s) * SHAPE.dragon.H) / 2,
      ];
      dv = Math.min(dv, segD(0, 0, sg));
    }
  const vw = hi ? 0.34 : 0.5;
  if (dv < vw) {
    M.pal = EMBER;
    M.kind = 4;
    M.emis = 0.55;
    return;
  }
  if (dv < vw + (hi ? 0.6 : 0.22)) {
    M.pal = HOT;
    M.gl = 1;
  }
  // Чешуя: диски внахлёст, верхний ряд лежит на нижнем, видна нижняя дуга каждой.
  const cw = hi ? 2.6 : 3.4;
  const rh = cw * 0.62;
  const zz = ((1 - s) * SHAPE.dragon.H) / 2;
  const row = Math.floor(zz / rh);
  let own = -1;
  let dd = 0;
  let dyy = 0;
  for (let j = row - 1; j <= row + 1 && own < 0; j++) {
    if (j < 0) continue;
    const u = (phi * rr) / cw + (j % 2) * 0.5;
    const kk = Math.round(u);
    const dx = (u - kk) * cw;
    const dy = zz - (j + 0.15) * rh;
    const d = Math.hypot(dx, dy * 1.05) / (cw * 0.6);
    if (d < 1) {
      own = j;
      dd = d;
      dyy = dy;
    }
  }
  if (own < 0 || dd > 0.84) M.dt += -2;
  else if (dyy > 0 && dd > 0.55) M.dt += 1;
  else if (dyy < -0.25 * cw) M.dt += -1;
  M.kind = 5;
}

// ---------------------------------------------------------------------------
// Трещины и куски скорлупы.
// ---------------------------------------------------------------------------

interface Crack {
  pts: [number, number][];
  /** Когда появляется и сколько бежит (с). */
  at: number;
  run: number;
  /** Граница кусков (по ней скорлупа расходится). */
  edge: boolean;
}
interface Net {
  cracks: Crack[];
  /** Кольцо: s(φ) — зигзаг по узлам. */
  ringPhi: number[];
  ringS: number[];
  /** Разрезы колпака и низа: φ(s) — ломаные (s по убыванию). */
  up: [number, number][][];
  lo: [number, number][][];
}

const ZIG = 20;
function ringAt(net: Net, phi: number): number {
  const u = (wrap(phi + Math.PI, Math.PI * 2) / (Math.PI * 2)) * ZIG;
  const i = Math.floor(u) % ZIG;
  const f = u - Math.floor(u);
  return lerp(net.ringS[i], net.ringS[(i + 1) % ZIG], f);
}
function splitAt(pl: [number, number][], s: number): number {
  // pl: [φ, s], s монотонно убывает.
  if (s >= pl[0][1]) return pl[0][0];
  for (let i = 1; i < pl.length; i++)
    if (s >= pl[i][1]) {
      const f = (pl[i - 1][1] - s) / (pl[i - 1][1] - pl[i][1]);
      return pl[i - 1][0] + wrapPi(pl[i][0] - pl[i - 1][0]) * f;
    }
  return pl[pl.length - 1][0];
}

const netCache = new Map<string, Net>();
/** Сеть трещин яйца для редкости `r` (одна на обе полосы). `pop` — быстрая для «вылупить все». */
function crackNet(kind: EggKind, r: number, pop = false): Net {
  const key = `${kind}${r}${pop}`;
  const hit = netCache.get(key);
  if (hit) return hit;
  const seed = EGG_KINDS.indexOf(kind) * 97 + 13;
  const ringPhi: number[] = [];
  const ringS: number[] = [];
  for (let i = 0; i < ZIG; i++) {
    ringPhi.push(-Math.PI + (i / ZIG) * Math.PI * 2);
    ringS.push(0.2 + (i % 2 ? 0.075 : -0.065) + (hash(i, 3, seed) - 0.5) * 0.06);
  }
  const net: Net = { cracks: [], ringPhi, ringS, up: [], lo: [] };
  const ringPts = (a: number, b: number): [number, number][] => {
    const pts: [number, number][] = [];
    const steps = Math.max(2, Math.ceil((Math.abs(b - a) / (Math.PI * 2)) * ZIG * 2));
    for (let j = 0; j <= steps; j++) {
      const phi = a + ((b - a) * j) / steps;
      pts.push([phi, ringAt(net, phi)]);
    }
    return pts;
  };
  // Вертикальный разрез: от кольца вверх (к s1) или вниз — зигзаг по s.
  const vert = (phi0: number, s1: number, k: number): [number, number][] => {
    const s0 = ringAt(net, phi0);
    const n = 5;
    const pts: [number, number][] = [];
    for (let j = 0; j <= n; j++) {
      const s = lerp(s0, s1, j / n);
      const z = j === 0 ? 0 : (j % 2 ? 1 : -1) * 0.13 + (hash(j, k, seed + 5) - 0.5) * 0.08;
      pts.push([phi0 + z, s]);
    }
    return pts;
  };
  const P = pop ? null : hatchPlan(r);
  const c1 = P?.c1 ?? 3 / FPS;
  const c2 = P?.c2 ?? 3 / FPS;
  const c3 = P?.c3 ?? 3 / FPS;
  const run = pop ? 2 / FPS : 3 / FPS;
  net.cracks.push({ pts: ringPts(-0.55, 0.45), at: c1, run, edge: true });
  net.cracks.push({ pts: ringPts(-0.55, -1.55), at: c2, run, edge: true });
  net.cracks.push({ pts: ringPts(0.45, 1.5), at: c2, run, edge: true });
  // Ветка вверх спереди — у r ≥ 3 это разрез колпака.
  const upFront = vert(-0.12, 0.66, 1);
  net.cracks.push({ pts: upFront, at: c2 + 1 / FPS, run, edge: r >= 3 });
  net.cracks.push({ pts: ringPts(1.5, Math.PI), at: c3, run, edge: true });
  net.cracks.push({ pts: ringPts(-1.55, -Math.PI), at: c3, run, edge: true });
  // Разрезы низа: лепестки.
  const loPhi = r >= 5 ? [0.72, 2.05, -2.85, -1.7, -0.5] : r >= 3 ? [0.78, -0.98, 2.3, -2.55] : [0.8, -1.02, 2.85];
  loPhi.forEach((ph, j) => {
    const pl = vert(ph, -1, 10 + j);
    net.lo.push(pl);
    // Видимая часть — до s −0.62.
    net.cracks.push({ pts: pl.filter((p) => p[1] > -0.66), at: c3 + 1 / FPS, run, edge: true });
  });
  if (r >= 3) {
    const upPhi = r >= 5 ? [-0.12, 1.15, 2.45, -2.5, -1.25] : [-0.12, 2.0, -2.1];
    upPhi.forEach((ph, j) => {
      const pl = ph === -0.12 ? upFront : vert(ph, 0.72, 20 + j);
      // Продолжение к макушке.
      net.up.push([...pl, [pl[pl.length - 1][0] + 0.2, 1]]);
      if (ph !== -0.12) net.cracks.push({ pts: pl, at: c3 + 1 / FPS, run, edge: true });
    });
  }
  if (r >= 5 && P) {
    // Мифическое: трещины расползаются по всему яйцу, пока оно крутится.
    for (let j = 0; j < 9; j++) {
      const ph0 = -Math.PI + (j / 9) * Math.PI * 2 + 0.2;
      const s0 = j % 2 ? 0.55 : -0.45;
      const pts: [number, number][] = [[ph0, s0]];
      for (let q = 1; q <= 3; q++)
        pts.push([ph0 + (hash(j, q, seed + 9) - 0.5) * 0.5, s0 + (j % 2 ? -1 : 1) * q * 0.09]);
      net.cracks.push({ pts, at: lerp(c2, c3, j / 9), run: 4 / FPS, edge: false });
    }
  }
  netCache.set(key, net);
  return net;
}

/** Номер куска скорлупы по (φ, s): колпак (0…nUp−1), потом лепестки низа. */
function pieceOf(net: Net, phi: number, s: number): number {
  const ring = ringAt(net, phi);
  const sector = (cuts: [number, number][][], base: number) => {
    if (cuts.length < 2) return base;
    const at = cuts.map((pl) => wrap(splitAt(pl, s), Math.PI * 2));
    const p = wrap(phi, Math.PI * 2);
    const order = at.map((a, i) => [a, i] as [number, number]).sort((x, y) => x[0] - y[0]);
    let k = order.length - 1;
    for (let i = 0; i < order.length; i++) if (p >= order[i][0]) k = i;
    return base + order[k][1];
  };
  if (s >= ring) return sector(net.up, 0);
  return sector(net.lo, Math.max(1, net.up.length));
}
const nPieces = (net: Net) => Math.max(1, net.up.length) + Math.max(1, net.lo.length);

/** Расстояние (пиксели малой) от точки (φ, s) до видимых к моменту `t` трещин. */
function crackDist(net: Net, kind: EggKind, phi: number, s: number, t: number, edgeOnly = false) {
  const sh = SHAPE[kind];
  const rr = Math.max(1.5, prof(sh.H, sh.R, sh.a, s));
  let best = 9;
  for (const c of net.cracks) {
    if (t < c.at || (edgeOnly && !c.edge)) continue;
    const u = clamp01((t - c.at) / c.run);
    const n = c.pts.length - 1;
    const upto = u * n;
    for (let i = 1; i <= n; i++) {
      if (i - 1 >= upto) break;
      const f = Math.min(1, upto - (i - 1));
      const a = c.pts[i - 1];
      const b = c.pts[i];
      const bx = wrapPi(a[0] - phi) + wrapPi(b[0] - a[0]) * f;
      const by = a[1] + (b[1] - a[1]) * f;
      const sg: Seg = [
        wrapPi(a[0] - phi) * rr,
        ((a[1] - s) * sh.H) / 2,
        bx * rr,
        ((by - s) * sh.H) / 2,
      ];
      const d = segD(0, 0, sg);
      if (d < best) best = d;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Рисование целого яйца лучом.
// ---------------------------------------------------------------------------

interface Look {
  kind: EggKind;
  res: Res;
  t: number;
  /** Редкость (свет трещин с r ≥ 2) или −1 — покой. */
  r: number;
  net: Net | null;
  /** Свет изнутри 0…1 (растёт с трещинами). */
  inner: number;
  /** Пульс идла: биение сердца, свет руны, ядро. */
  pulse: number;
  /** Блик грани кристалла (номер грани) или −1. */
  glint: number;
}

const ID_EGG = 1;

/** Тон по свету: ступени палитры, как у рига (`drawParts`). */
function litTone(n: V3, N: number): number {
  const lam = n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2];
  const bounce = Math.max(0, -n[2]) * 0.14;
  return Math.max(0, lam * 0.6 + 0.4 + bounce) * (N - 1);
}

/** Пиксель поверхности: палитра и тон по материалу, свету, трещинам. */
function shadePx(
  f: Frame,
  i: number,
  L: Look,
  phi: number,
  s: number,
  l: V3,
  nW: V3,
  P: Pose | null,
  inside: boolean,
  edge: boolean,
): void {
  const hi = L.res === 'l';
  const glowR = L.r >= 2 ? L.r : -1;
  if (inside) {
    const pl = glowR >= 0 ? INGLOW[glowR] : INNER;
    const N = PALS[pl].length;
    // Изнанка: свет изнутри яйца сильнее света сверху.
    const k = litTone(mul(nW, -1), N) * 0.5 + (N - 1) * (glowR >= 0 ? 0.5 : 0.25);
    f.pal[i] = pl;
    f.tone[i] = Math.max(0, Math.min(N - 1, Math.round(k)));
    return;
  }
  if (edge) {
    f.pal[i] = glowR >= 0 ? INGLOW[glowR] : INNER;
    f.tone[i] = 5;
    return;
  }
  // Трещина.
  if (L.net) {
    const d = crackDist(L.net, L.kind, phi, s, L.t);
    const w = hi ? 0.42 : 0.5;
    if (d < w) {
      if (glowR >= 0) {
        f.pal[i] = GLOW[glowR];
        f.tone[i] = Math.min(5, 3 + Math.round(L.inner * 2));
      } else {
        f.pal[i] = SHELL[L.kind];
        f.tone[i] = 0;
      }
      return;
    }
    if (d < w + (hi ? 0.5 : 0.45)) {
      // Кромка излома: у светящихся — отсвет, у простых — светлый скол под трещиной.
      if (glowR >= 0) {
        f.pal[i] = GLOW[glowR];
        f.tone[i] = Math.min(4, 1 + Math.round(L.inner * 2.5));
        return;
      }
      f.pal[i] = INNER;
      f.tone[i] = 4;
      return;
    }
  }
  material(L.kind, phi, s, l, hi, L.t);
  const pl = M.pal;
  const N = PALS[pl].length;
  let tone: number;
  if (M.emis >= 0) {
    let e = M.emis;
    if (M.kind === 4) e = 0.45 + L.pulse * 0.55 + L.inner * 0.3;
    if (M.kind === 2) e = 0.3 + L.pulse * 0.35 + L.inner * 0.3;
    tone = e * (N - 1);
  } else {
    const nn = M.fn && P ? norm(dirWorld(P, M.fn)) : nW;
    tone =
      M.kind === 3
        ? Math.max(0, (nn[0] * LIGHT[0] + nn[1] * LIGHT[1] + nn[2] * LIGHT[2]) * 0.95 + 0.26) *
          (N - 1)
        : litTone(nn, N);
    // Ступенчатый блик: кристалл — грани, дракон — глянец чешуи.
    const sp = nn[0] * HV[0] + nn[1] * HV[1] + nn[2] * HV[2];
    if (M.kind === 3) {
      if (sp > 0.93) tone += 2;
      else if (sp > 0.84) tone += 1;
      if (L.glint >= 0 && M.gl === L.glint) tone += 3;
    } else if (M.kind === 5 && sp > 0.9) tone += 1;
    if (M.gl === 1 && M.pal === HOT) tone += L.pulse * 1.5;
  }
  f.pal[i] = pl;
  f.tone[i] = Math.max(0, Math.min(N - 1, Math.round(tone + M.dt)));
}

/** Целое яйцо лучом на пиксель (с вырезанными сколами у каменного). */
function castEgg(f: Frame, P: Pose, L: Look, ox: number, oy: number): void {
  const { w, h } = f;
  const sh = SHAPE[L.kind];
  const C: V3 = add(P.B, mul(P.A, P.H / 2));
  const Rb = P.H / 2 + P.S * 1.2;
  const [cx, cy] = [C[0], C[1] * SE - C[2] * CE];
  const chips =
    L.kind === 'stone'
      ? CHIPS.map(([ph, s, rad]) => {
          const n = normLocal('stone', ph, s);
          const p = surfLocal('stone', ph, s);
          return { c: toWorld(P, add(p, mul(n, rad * 0.45))), r: rad * P.S };
        })
      : [];
  const step = 0.55 * P.S;
  const F = (x: number, y: number, z: number): number => {
    const dx = x - P.B[0];
    const dy = y - P.B[1];
    const dz = z - P.B[2];
    const hh = dx * P.A[0] + dy * P.A[1] + dz * P.A[2];
    if (hh < 0) return -hh + 0.01;
    if (hh > P.H) return hh - P.H + 0.01;
    const qx = dx - P.A[0] * hh;
    const qy = dy - P.A[1] * hh;
    const qz = dz - P.A[2] * hh;
    const s = (2 * hh) / P.H - 1;
    let v = Math.sqrt(qx * qx + qy * qy + qz * qz) - prof(P.H, P.R, P.a, s);
    for (const c of chips) {
      const g = Math.hypot(x - c.c[0], y - c.c[1], z - c.c[2]) - c.r;
      if (-g > v) v = -g;
    }
    return v;
  };
  const x0 = Math.max(0, Math.floor(ox + cx - Rb - 1));
  const x1 = Math.min(w - 1, Math.ceil(ox + cx + Rb + 1));
  const y0 = Math.max(0, Math.floor(oy + cy - Rb - 1));
  const y1 = Math.min(h - 1, Math.ceil(oy + cy + Rb + 1));
  for (let py = y0; py <= y1; py++) {
    const sy = py + 0.5 - oy;
    for (let px = x0; px <= x1; px++) {
      const sx = px + 0.5 - ox;
      // Луч: (sx, sy·SE, −sy·CE) + t·VIEW.
      const ox0 = sx;
      const oy0 = sy * SE;
      const oz0 = -sy * CE;
      const wx = C[0] - ox0;
      const wy = C[1] - oy0;
      const wz = C[2] - oz0;
      const tp = wy * CE + wz * SE;
      const cl = Math.hypot(wx, wy - CE * tp, wz - SE * tp);
      if (cl > Rb) continue;
      let t = tp + Rb;
      let prev = F(ox0, oy0 + CE * t, oz0 + SE * t);
      if (prev < 0) continue;
      let hit = NaN;
      for (t -= step; t > tp - Rb; t -= step) {
        const v = F(ox0, oy0 + CE * t, oz0 + SE * t);
        if (v < 0) {
          let a = t + step;
          let b = t;
          for (let k = 0; k < 7; k++) {
            const m = (a + b) / 2;
            if (F(ox0, oy0 + CE * m, oz0 + SE * m) < 0) b = m;
            else a = m;
          }
          hit = (a + b) / 2;
          break;
        }
        prev = v;
      }
      if (Number.isNaN(hit)) continue;
      const i = py * w + px;
      if (hit <= f.zb[i]) continue;
      const X: V3 = [ox0, oy0 + CE * hit, oz0 + SE * hit];
      // Местные координаты.
      const d = sub(X, P.B);
      const hh = dot(d, P.A);
      const q = sub(d, mul(P.A, hh));
      const lx = dot(q, P.E2) / P.S;
      const ly = dot(q, P.E1) / P.S;
      const s = Math.max(-1, Math.min(1, (2 * hh) / P.H - 1));
      const phi = Math.atan2(lx, ly);
      const l: V3 = [lx, ly, hh / P.S];
      // Нормаль: у скола — к центру шара, иначе — поверхность.
      let nW: V3 | null = null;
      let chip = false;
      if (chips.length && Math.hypot(q[0], q[1], q[2]) - prof(P.H, P.R, P.a, s) < -0.25 * P.S) {
        // Точка внутри яйца — значит, на стенке скола: нормаль к центру ближайшего шара.
        let best = 1e9;
        for (const c of chips) {
          const g = Math.abs(Math.hypot(X[0] - c.c[0], X[1] - c.c[1], X[2] - c.c[2]) - c.r);
          if (g < best) {
            best = g;
            nW = norm(sub(c.c, X));
          }
        }
        chip = true;
      }
      if (!nW) nW = norm(dirWorld(P, normLocal(L.kind, phi, s)));
      f.zb[i] = hit;
      f.idb[i] = ID_EGG;
      if (chip) {
        f.pal[i] = FRESH;
        f.tone[i] = Math.max(1, Math.min(6, Math.round(litTone(nW, 7)) + 1));
        continue;
      }
      shadePx(f, i, L, phi, s, l, nW, P, false, false);
      // Ядро кристалла сквозь стенку: луч проходит у середины — светлее.
      if (L.kind === 'crystal') {
        const cc = toWorld(P, [0, 0, sh.H * 0.44]);
        const vx = cc[0] - ox0;
        const vy = cc[1] - oy0;
        const vz = cc[2] - oz0;
        const tq = vy * CE + vz * SE;
        const dc = Math.hypot(vx, vy - CE * tq, vz - SE * tq) / P.S;
        const rc = 6.4 + L.pulse * 1.6 + L.inner * 3;
        if (dc < rc) {
          const k = 1 - dc / rc;
          if (k > 0.55) {
            f.pal[i] = L.r >= 2 && L.inner > 0.3 ? GLOW[L.r] : CORE;
            f.tone[i] = Math.min(5, 2 + Math.round(k * 3 + L.inner));
          } else if (k > 0.22 || dith(px, py, k * 3))
            f.tone[i] = Math.min(PALS[f.pal[i]].length - 1, f.tone[i] + 1 + (k > 0.38 ? 1 : 0));
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Куски скорлупы точками.
// ---------------------------------------------------------------------------

interface Sample {
  phi: number;
  s: number;
  l: V3;
  n: V3;
  piece: number;
  edge: boolean;
}
interface Shell {
  samples: Sample[];
  /** Середина куска (местные, пиксели малой) и размер. */
  cen: V3[];
  ext: number[];
  n: number;
}
const shellCache = new Map<string, Shell>();
function shellOf(kind: EggKind, r: number, res: Res, pop: boolean): Shell {
  const key = `${kind}${r}${res}${pop}`;
  const hit = shellCache.get(key);
  if (hit) return hit;
  const net = crackNet(kind, r, pop);
  const sh = SHAPE[kind];
  const S = RES[res].box / 36;
  const sp = 0.42 / S;
  const ns = Math.ceil(sh.H / 2 / sp) * 2;
  const n = nPieces(net);
  const samples: Sample[] = [];
  const sum = Array.from({ length: n }, () => [0, 0, 0, 0]);
  const edgeW = (res === 'l' ? 0.9 : 0.6) / S;
  for (let j = 0; j <= ns; j++) {
    const s = -1 + (2 * j) / ns;
    const rr = prof(sh.H, sh.R, sh.a, s);
    const nphi = Math.max(1, Math.ceil((Math.PI * 2 * rr) / sp));
    for (let k = 0; k < nphi; k++) {
      const phi = -Math.PI + ((k + (j % 2) * 0.5) / nphi) * Math.PI * 2;
      if (kind === 'stone') {
        let cut = false;
        for (const [ph, cs, rad] of CHIPS) {
          const dp = Math.hypot(wrapPi(phi - ph) * rr, ((s - cs) * sh.H) / 2);
          if (dp < rad * 0.8) cut = true;
        }
        if (cut) continue;
      }
      const l = surfLocal(kind, phi, s);
      const piece = pieceOf(net, phi, s);
      // Кромка излома: рядом (на ширину кромки) уже другой кусок.
      const dp = edgeW / Math.max(1, rr);
      const ds = (edgeW * 2) / sh.H;
      const edge =
        pieceOf(net, phi + dp, s) !== piece ||
        pieceOf(net, phi - dp, s) !== piece ||
        pieceOf(net, phi, s + ds) !== piece ||
        pieceOf(net, phi, s - ds) !== piece;
      samples.push({ phi, s, l, n: normLocal(kind, phi, s), piece, edge });
      const a = sum[piece];
      a[0] += l[0];
      a[1] += l[1];
      a[2] += l[2];
      a[3]++;
    }
  }
  const cen = sum.map((a) => [a[0] / (a[3] || 1), a[1] / (a[3] || 1), a[2] / (a[3] || 1)] as V3);
  const ext = cen.map(() => 0);
  for (const sm0 of samples) {
    const c = cen[sm0.piece];
    ext[sm0.piece] = Math.max(ext[sm0.piece], Math.hypot(sm0.l[0] - c[0], sm0.l[1] - c[1], sm0.l[2] - c[2]));
  }
  const out = { samples, cen, ext, n };
  shellCache.set(key, out);
  return out;
}

/** Состояние куска: сдвиг середины (кадр, пиксели холста) и поворот (ось, угол), видимость. */
interface PieceAt {
  pos: V3;
  ax: V3;
  an: number;
  vis: number;
  /** Лежит на полу: самая низкая точка ровно на полу (иначе только не ниже пола). */
  ground?: boolean;
}

/** Нарисовать куски точками: поворот вокруг середины, потом в кадр; пол — не ниже z = 0. */
function splatShell(
  f: Frame,
  P: Pose,
  sh: Shell,
  L: Look,
  at: (k: number) => PieceAt,
  ox: number,
  oy: number,
): { st: PieceAt[]; lift: number[] } {
  const st = Array.from({ length: sh.n }, (_, k) => at(k));
  // Опора о пол: самая низкая точка куска.
  const lift = st.map(() => -1e9);
  const world = (sm0: Sample, k: number): V3 => {
    const c = sh.cen[k];
    const rel = dirWorld(P, [sm0.l[0] - c[0], sm0.l[1] - c[1], sm0.l[2] - c[2]]);
    const rot = rotV(rel, st[k].ax, st[k].an);
    return [st[k].pos[0] + rot[0] * P.S, st[k].pos[1] + rot[1] * P.S, st[k].pos[2] + rot[2] * P.S];
  };
  for (let j = 0; j < sh.samples.length; j += 7) {
    const sm0 = sh.samples[j];
    const k = sm0.piece;
    const z = world(sm0, k)[2];
    if (-z > lift[k]) lift[k] = -z;
  }
  for (let k = 0; k < sh.n; k++) if (!st[k].ground) lift[k] = Math.max(0, lift[k]);
  const { w, h } = f;
  for (const sm0 of sh.samples) {
    const k = sm0.piece;
    const S0 = st[k];
    if (S0.vis <= 0) continue;
    const X = world(sm0, k);
    X[2] += lift[k];
    const sx = X[0];
    const sy = X[1] * SE - X[2] * CE;
    const dz = X[1] * CE + X[2] * SE;
    const px = Math.floor(ox + sx);
    const py = Math.floor(oy + sy);
    if (px < 0 || py < 0 || px >= w || py >= h) continue;
    if (S0.vis < 1 && !dith(px, py, S0.vis)) continue;
    const i = py * w + px;
    if (dz <= f.zb[i]) continue;
    const nW = rotV(dirWorld(P, sm0.n), S0.ax, S0.an);
    const inside = nW[0] * VIEW[0] + nW[1] * VIEW[1] + nW[2] * VIEW[2] < 0;
    f.zb[i] = dz;
    f.idb[i] = 10 + k;
    shadePx(f, i, L, sm0.phi, sm0.s, sm0.l, nW, null, inside, sm0.edge && !inside);
    if (!inside && L.kind === 'crystal' && f.pal[i] === CRYS) {
      // Грань куска: нормаль середины грани (как у целого).
      material('crystal', sm0.phi, sm0.s, sm0.l, L.res === 'l', L.t);
      if (M.fn) {
        const nn = norm(rotV(dirWorld(P, M.fn), S0.ax, S0.an));
        const sp = dot(nn, HV);
        f.tone[i] = Math.max(0, Math.min(6, Math.round(litTone(nn, 7) + M.dt + (sp > 0.9 ? 2 : 0))));
      }
    }
  }
  return { st, lift };
}

// ---------------------------------------------------------------------------
// Частицы и свет (накладываются поверх готовых пикселей).
// ---------------------------------------------------------------------------

function blend(p: Px, x: number, y: number, c: RGBA, a: number): void {
  if (a <= 0) return;
  p.set(x, y, [c[0], c[1], c[2], Math.round(Math.min(1, a) * 255)]);
}
/** Только по пустому: свет «за» предметом. */
function onEmpty(p: Px, x: number, y: number, c: RGBA): void {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || y < 0 || x >= p.w || y >= p.h) return;
  if (p.data[(y * p.w + x) * 4 + 3] > 0) return;
  p.set(x, y, c);
}

/** Искра-звёздочка: крест с белой серединой (крупная — с длинными лучами). */
function star(p: Px, x: number, y: number, sz: number, c: RGBA, empty = false): void {
  const put = (xx: number, yy: number, cc: RGBA) => (empty ? onEmpty(p, xx, yy, cc) : p.set(xx, yy, cc));
  const X = Math.round(x);
  const Y = Math.round(y);
  const n = Math.max(0, Math.round(sz));
  for (let k = 1; k <= n; k++) {
    const cc = k === n && n > 1 ? mixc(c, [c[0], c[1], c[2], 0], 0.45) : c;
    put(X + k, Y, cc);
    put(X - k, Y, cc);
    put(X, Y + k, cc);
    put(X, Y - k, cc);
  }
  if (n >= 3) {
    put(X + 1, Y + 1, c);
    put(X - 1, Y - 1, c);
    put(X + 1, Y - 1, c);
    put(X - 1, Y + 1, c);
  }
  put(X, Y, hx('#ffffff'));
}

/** Клуб пыли/дыма: круг, свет сверху-слева, растворяется шахматкой. */
function puff(p: Px, x: number, y: number, rr: number, cols: RGBA[], vis: number): void {
  if (rr < 0.4 || vis <= 0) return;
  for (let yy = Math.floor(y - rr); yy <= Math.ceil(y + rr); yy++)
    for (let xx = Math.floor(x - rr); xx <= Math.ceil(x + rr); xx++) {
      const dx = xx + 0.5 - x;
      const dy = yy + 0.5 - y;
      const d = Math.hypot(dx, dy) / rr;
      if (d > 1) continue;
      if (!dith(xx, yy, vis)) continue;
      const lit = (-dx - dy) / (rr * 1.41);
      const c = lit > 0.35 ? cols[2] : d > 0.78 && lit < -0.2 ? cols[0] : cols[1];
      p.set(xx, yy, c);
    }
}

function ellipseRing(
  p: Px,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  thick: number,
  c: RGBA,
  vis: number,
  front?: (x: number, y: number) => boolean,
): void {
  if (rx < 0.5 || vis <= 0) return;
  for (let yy = Math.floor(cy - ry - thick); yy <= Math.ceil(cy + ry + thick); yy++)
    for (let xx = Math.floor(cx - rx - thick); xx <= Math.ceil(cx + rx + thick); xx++) {
      const dx = (xx + 0.5 - cx) / rx;
      const dy = (yy + 0.5 - cy) / Math.max(0.5, ry);
      const d = Math.hypot(dx, dy);
      const e = Math.abs(d - 1) * Math.min(rx, Math.max(ry, rx * 0.35));
      if (e > thick / 2) continue;
      if (!dith(xx, yy, vis)) continue;
      if (front && !front(xx, yy)) continue;
      p.set(xx, yy, c);
    }
}

// ---------------------------------------------------------------------------
// Время: поза яйца, свет, пульс.
// ---------------------------------------------------------------------------

/** Пульс покоя 0…1: у дракона сердце «тук-тук» дважды за петлю, у рун и ядра — дыхание. */
function pulseAt(kind: EggKind, t: number): number {
  if (kind === 'dragon') {
    const u = wrap(t, 1);
    return Math.max(bump(u, 0, 0.16), bump(u, 0.2, 0.38) * 0.7);
  }
  return 0.5 - 0.5 * Math.cos(Math.PI * t);
}
/** Дыхание покоя: лёгкий крен и сжатие (целые круги за 2 с). */
function breathe(t: number): PoseIn {
  return {
    ...REST,
    tilt: 0.022 * Math.sin(Math.PI * t),
    st: 0.012 * Math.sin(Math.PI * 2 * t),
  };
}

/** Удар-покачивание: затухающее колебание от толчка изнутри. */
function beat(t: number, a: number, b: number, amp: number, cyc: number): number {
  if (t <= a || t >= b) return 0;
  const u = (t - a) / (b - a);
  return amp * Math.sin(Math.PI * 2 * cyc * u) * (1 - u) ** 0.8;
}

function hatchPose(kind: EggKind, r: number, t: number): PoseIn {
  const p = hatchPlan(r);
  const q = breathe(t);
  const k = 1 + r * 0.06;
  let tilt = q.tilt;
  tilt += beat(t, p.W * 0.05, p.c1, 0.18 * k, 1.5);
  tilt += beat(t, p.c1 + 1 / FPS, p.c2, -0.28 * k, 2);
  tilt += beat(t, p.c2 + 1 / FPS, p.c3, 0.38 * k, r >= 4 ? 4 : 3);
  // Толчок у каждой трещины: кадр сжатия.
  let st = q.st;
  for (const c of [p.c1, p.c2, p.c3]) st -= bump(t, c - 0.5 / FPS, c + 2.5 / FPS) * 0.05;
  // Перед разломом: присел и вытянулся.
  st += kf(t, [
    [p.c3, 0],
    [p.b - 3 / FPS, -0.1, 'o'],
    [p.b - 1 / FPS, 0.07, 'i'],
    [p.b, 0.08],
  ]);
  let beta = 0;
  let lift = 0;
  let spin = 0;
  let x = 0;
  if (r >= 3) {
    // Подъём над гнездом в третьей качке; качка идёт по кругу (видно верх и бока).
    const hov = r >= 5 ? 0 : kf(t, [[p.c2, 0], [p.c2 + 0.3, r >= 4 ? 4.5 : 3.2, 'o'], [p.b, r >= 4 ? 5 : 3.6]]);
    lift = hov + (hov > 0 ? Math.sin(Math.PI * 4 * t) * 0.5 * (hov / 4) : 0);
    if (t > p.c2) beta = (t - p.c2) * 9;
  }
  if (r >= 4) {
    const sh = clamp01((t - p.c3) / (p.b - p.c3));
    x += Math.sin(Math.PI * 2 * 15 * t) * 0.9 * sh;
    tilt += Math.sin(Math.PI * 2 * 11 * t) * 0.06 * sh;
  }
  if (r >= 5) {
    // Взлёт и вращение вокруг своей оси с разгоном.
    lift = kf(t, [[p.c1, 0], [p.c2, 9, 'o'], [p.c3, 13], [p.b, 14]]);
    lift += t > p.c1 ? Math.sin(Math.PI * 3 * (t - p.c1)) * 0.8 : 0;
    const a = t > p.c1 ? t - p.c1 : 0;
    const acc = 13 / (p.b - p.c1);
    spin = 0.5 * acc * a * a;
    tilt = tilt * (t > p.c1 ? 0.35 : 1) + (t > p.c1 ? 0.1 : 0);
    beta = spin * 0.5;
  }
  return { tilt, beta, lift, x, y: 0, spin, st };
}

/** Свет изнутри 0…1: ступенями у трещин, полный перед разломом. */
function innerAt(r: number, t: number): number {
  const p = hatchPlan(r);
  return kf(t, [
    [p.c1, 0],
    [p.c1 + 0.08, 0.3, 'o'],
    [p.c2, 0.3],
    [p.c2 + 0.08, 0.55, 'o'],
    [p.c3, 0.6],
    [p.c3 + 0.08, 0.85, 'o'],
    [p.b, 1],
  ]);
}

// ---------------------------------------------------------------------------
// Мелочь на яйце: мох, росток (части рига).
// ---------------------------------------------------------------------------

const ID_TUFT = 3;
function mossParts(P: Pose, t: number, hi: boolean, pieceXf?: (phi: number, s: number) => ((v: V3) => V3) | null): Part[] {
  const parts: Part[] = [];
  const S = P.S;
  const same = (v: V3) => v;
  const xf = (phi: number, s: number) => (pieceXf ? pieceXf(phi, s) : same);
  TUFTS.forEach(([ph, s], k) => {
    const T = xf(ph, s);
    if (!T) return;
    const base = toWorld(P, surfLocal('moss', ph, s, -0.3));
    const nrm = norm(dirWorld(P, normLocal('moss', ph, s)));
    const blades = hi ? 5 : 3;
    for (let j = 0; j < blades; j++) {
      const sway = Math.sin(Math.PI * 2 * t + k * 1.7 + j) * 0.18;
      const spread = (j - (blades - 1) / 2) * (hi ? 0.32 : 0.5);
      const side = norm(cross(nrm, P.A));
      let dir = norm(add(add(nrm, mul(P.A, 0.9)), mul(side, spread + sway)));
      dir = norm(dir);
      const len = (hi ? 1.7 : 2.0) * (0.75 + hash(k, j, 7) * 0.5);
      const c = add(base, mul(dir, len * S * 0.75));
      parts.push({
        c: T(c),
        ax: axes(sub(T(add(c, dir)), T(c)), [0, 0, 1]),
        r: [len * S * 0.75, (hi ? 0.5 : 0.62) * S, (hi ? 0.5 : 0.62) * S],
        pal: MOSS,
        id: ID_TUFT + k,
        bias: 0.08 + hash(j, k, 3) * 0.1,
      });
    }
  });
  // Росток на макушке: стебель и два листа.
  const T = xf(0, 1);
  if (T) {
    const top = toWorld(P, [0, 0, SHAPE.moss.H - 0.4]);
    const sway = Math.sin(Math.PI * t) * 0.16;
    const up = norm(add(P.A, mul(P.E2, sway)));
    const stem = add(top, mul(up, 1.6 * S));
    parts.push({ c: T(stem), ax: axes(sub(T(add(stem, up)), T(stem)), [0, 1, 0]), r: [1.7 * S, 0.55 * S, 0.55 * S], pal: SPROUT, id: 7 });
    const tip = add(top, mul(up, 3.2 * S));
    for (const sd of [-1, 1]) {
      const fl = Math.sin(Math.PI * 2 * t + sd) * 0.12;
      const d = norm(add(mul(P.E2, sd), mul(up, 0.55 + fl)));
      const c = add(tip, mul(d, 1.9 * S));
      parts.push({ c: T(c), ax: axes(sub(T(add(c, d)), T(c)), dirWorld(P, [0, 1, 0])), r: [2.2 * S, 1.15 * S, 0.45 * S], pal: SPROUT, id: 8, bias: sd < 0 ? 0.12 : 0 });
    }
  }
  return parts;
}

// ---------------------------------------------------------------------------
// Кадр.
// ---------------------------------------------------------------------------

const origin = (res: Res): [number, number] => {
  const cv = RES[res];
  return [cv.bx + cv.box / 2, cv.by + cv.box - 2 * (cv.box / 36)];
};

/** Свет за яйцом: дым дракона (над макушкой). */
function smoke(p: Px, P: Pose, t: number, ox: number, oy: number, k: number): void {
  const top = toWorld(P, [0.6, 0, SHAPE.dragon.H - 0.5]);
  const S = P.S;
  for (let j = 6; j >= 0; j--) {
    const u = wrap(t / 2 + j / 7, 1);
    const x = top[0] + (Math.sin(u * Math.PI * 1.7 + 0.3) * 2.4 - u * 1.4) * S;
    const z = top[2] + (1.2 + u * 14) * S;
    const sx = ox + x;
    const sy = oy + top[1] * SE - z * CE;
    const rr = (1.1 + u * 2.2) * S * (1 - sm(clamp01((u - 0.6) / 0.4))) * Math.min(1, u / 0.12);
    const vis = (u > 0.8 ? 1 - (u - 0.8) / 0.2 : 1) * k;
    puff(p, sx, sy, rr, [hx('#2e2729'), hx('#4f4649'), hx('#776c6e')], vis);
  }
}

/** Блик грани кристалла в покое: две вспышки за петлю. */
function glintAt(t: number): number {
  const u = wrap(t, 2);
  if (u > 0.55 && u < 0.72) return 3;
  if (u > 1.35 && u < 1.52) return 8;
  return -1;
}

function eggFrame(kind: EggKind, res: Res, t: number, q: PoseIn, L: Look): { f: Frame; P: Pose } {
  const cv = RES[res];
  const f = newFrame(cv.cw, cv.ch);
  const [ox, oy] = origin(res);
  const P = makePose(kind, res, q);
  castEgg(f, P, L, ox, oy);
  if (kind === 'moss') drawParts(f, mossParts(P, t, res === 'l'), PALS, ox, oy);
  seams(f, 1.2, 1);
  return { f, P };
}

function finish(f: Frame): Px {
  const p = toPx(f, PALS);
  selOutline(p, INK, 0.8);
  return p;
}

function idleFrame(kind: EggKind, i: number, res: Res): Px {
  const t = i / FPS;
  const L: Look = { kind, res, t, r: -1, net: null, inner: 0, pulse: pulseAt(kind, t), glint: kind === 'crystal' ? glintAt(t) : -1 };
  const { f, P } = eggFrame(kind, res, t, breathe(t), L);
  const p = finish(f);
  overIdle(p, kind, res, t, P, L);
  return p;
}

/** То, что живёт поверх яйца и в покое, и во время вылупления: дым, искра грани. */
function overIdle(p: Px, kind: EggKind, res: Res, t: number, P: Pose, L: Look, k = 1): void {
  const [ox, oy] = origin(res);
  if (kind === 'dragon') smoke(p, P, t, ox, oy, k);
  if (kind === 'crystal' && L.glint >= 0) {
    const ph = L.glint === 3 ? -0.55 : 0.75;
    const sv = L.glint === 3 ? 0.42 : -0.1;
    const w = toWorld(P, surfLocal('crystal', ph, sv, 0.3));
    const u = L.glint === 3 ? (wrap(t, 2) - 0.55) / 0.17 : (wrap(t, 2) - 1.35) / 0.17;
    const sz = Math.round(Math.sin(clamp01(u) * Math.PI) * (res === 'l' ? 4 : 1.6));
    if (sz > 0) star(p, ox + w[0], oy + w[1] * SE - w[2] * CE, sz, hx('#e8fdff'));
  }
}

/** Для теста: самая низкая точка поверхности в позе вылупления (пиксели холста, пол = 0). */
export function lowestZ(kind: EggKind, r: number, t: number, res: Res = 'l'): number {
  const P = makePose(kind, res, hatchPose(kind, r, t));
  let m = Infinity;
  for (let j = 0; j <= 80; j++)
    for (let k = 0; k < 96; k++) {
      const z = toWorld(P, surfLocal(kind, (k / 96) * Math.PI * 2 - Math.PI, -1 + j / 80))[2];
      if (z < m) m = z;
    }
  return m;
}

export function frame(name: string, i: number, res: Res): Px {
  const [kind0, kind1, rr] = name.split('-');
  if (kind0 === 'idle') return idleFrame(kind1 as EggKind, i, res);
  if (kind0 === 'pop') return popFrame(kind1 as EggKind, i, res);
  return hatchFrame(kind1 as EggKind, Number(rr.slice(1)), i, res);
}

// ---------------------------------------------------------------------------
// Вылупление.
// ---------------------------------------------------------------------------

const GRAV = 300;

interface Body {
  pos: V3;
  vel: V3;
  ax: V3;
  w: number;
  /** Высота середины над полом в покое. */
  rest: number;
}
/** Полёт с полом: шаги 1/240 с, отскок один-два раза, потом лежит. */
function fly(b: Body, tau: number, grav = GRAV): { pos: V3; an: number; floor: boolean } {
  const dt = 1 / 240;
  const pos: V3 = [...b.pos];
  const vel: V3 = [...b.vel];
  let w = b.w;
  let an = 0;
  const n = Math.round(tau / dt);
  for (let k = 0; k < n; k++) {
    vel[2] -= grav * dt;
    pos[0] += vel[0] * dt;
    pos[1] += vel[1] * dt;
    pos[2] += vel[2] * dt;
    an += w * dt;
    if (pos[2] < b.rest) {
      pos[2] = b.rest;
      if (vel[2] < -25) {
        vel[2] = -vel[2] * 0.32;
        vel[0] *= 0.55;
        vel[1] *= 0.55;
        w *= 0.45;
      } else {
        vel[2] = 0;
        vel[0] *= 0.9;
        vel[1] *= 0.9;
        w *= 0.9;
      }
    }
  }
  return { pos, an, floor: pos[2] <= b.rest + 1e-6 && Math.abs(vel[2]) < 1e-6 };
}

interface Bit {
  pos: V3;
  vel: V3;
  r: number;
  pal: number;
  t0: number;
  life: number;
  ember: boolean;
}

function bitsFor(kind: EggKind, r: number, cen: V3, pop: boolean): Bit[] {
  const n = pop ? 5 : [6, 8, 10, 14, 18, 24][r];
  const out: Bit[] = [];
  const seed = EGG_KINDS.indexOf(kind) * 31 + r * 7 + (pop ? 3 : 0);
  for (let j = 0; j < n; j++) {
    const a = hash(j, 1, seed) * Math.PI * 2;
    const up = 0.5 + hash(j, 2, seed) * 0.8;
    const sp = (pop ? 40 : 45 + r * 9) * (0.6 + hash(j, 3, seed) * 0.7);
    const ember = kind === 'dragon' && j % 2 === 0;
    out.push({
      pos: [cen[0] + Math.sin(a) * 4, cen[1] + Math.cos(a) * 4, cen[2] + (hash(j, 4, seed) - 0.3) * 8],
      vel: [Math.sin(a) * sp, Math.cos(a) * sp * 0.5, sp * up * (ember ? 0.4 : 1)],
      r: (0.55 + hash(j, 5, seed) * 0.6) * (kind === 'stone' ? 1.15 : 1),
      pal: kind === 'moss' ? (j % 3 ? MOSS : MOSS_SHELL) : kind === 'stone' ? (j % 3 ? STONE : FRESH) : kind === 'crystal' ? CRYS : DRAG,
      t0: 0,
      life: 0.5 + hash(j, 6, seed) * 0.4,
      ember,
    });
  }
  return out;
}

/** Цвет пыли по материалу. */
const DUST: Record<EggKind, RGBA[]> = {
  moss: [hx('#4a4a26'), hx('#6c6a3a'), hx('#8f8c56')],
  stone: [hx('#4a4b50'), hx('#6c6d72'), hx('#9a9a9e')],
  crystal: [hx('#4f8fa8'), hx('#8cc8da'), hx('#d0f2f8')],
  dragon: [hx('#1c1416'), hx('#3a3032'), hx('#5e5254')],
};

function hatchFrame(kind: EggKind, r: number, i: number, res: Res): Px {
  const pl = hatchPlan(r);
  const t = i / FPS;
  const net = crackNet(kind, r);
  const [ox, oy] = origin(res);
  const S = RES[res].box / 36;
  const rc = RARITIES[r];
  const RC = hx(rc.color);
  const RL = hx(rc.light);
  const W = hx('#ffffff');
  const pulse = pulseAt(kind, t);
  if (t < pl.b) {
    const inner = innerAt(r, t);
    const L: Look = { kind, res, t, r, net, inner, pulse: Math.max(pulse, kind === 'dragon' ? inner * 0.6 : 0), glint: kind === 'crystal' ? glintAt(t) : -1 };
    const q = hatchPose(kind, r, t);
    const cv = RES[res];
    const f = newFrame(cv.cw, cv.ch);
    const P = makePose(kind, res, q);
    // Руны вокруг (r ≥ 4): позади яйца — до него, чтобы яйцо их закрыло.
    const runes = r >= 4 ? orbitRunes(r, t, P, S) : [];
    castEgg(f, P, L, ox, oy);
    if (kind === 'moss') drawParts(f, mossParts(P, t, res === 'l'), PALS, ox, oy);
    seams(f, 1.2, 1);
    // Отсвет трещин на скорлупу (r ≥ 2): соседи светящейся трещины на ступень светлее.
    if (r >= 2) spill(f, GLOW[r], res === 'l' ? 2 : 1);
    const p = finish(f);
    overIdle(p, kind, res, t, P, L);
    const C = toWorld(P, [0, 0, SHAPE[kind].H * 0.5]);
    const cx = ox + C[0];
    const cy = oy + C[1] * SE - C[2] * CE;
    // Свет из трещин наружу (r ≥ 2): лучи за яйцом.
    if (r >= 2 && t >= pl.c3) {
      const k = clamp01((t - pl.c3) / (pl.b - pl.c3));
      rays(p, cx, cy, (SHAPE[kind].R * 1.2 + k * (8 + r * 3)) * S, 7 + r, t * 0.4, k, RC, RL, S);
    }
    // Искры у трещин (r ≥ 1).
    if (r >= 1)
      for (const c of [pl.c1, pl.c2, pl.c3]) {
        const u = (t - c) / 0.25;
        if (u < 0 || u > 1) continue;
        for (let j = 0; j < 1 + Math.floor(r / 2); j++) {
          const a = hash(j, Math.round(c * 100), 5) * Math.PI * 2;
          const d = (SHAPE[kind].R * 0.9 + u * 6) * S;
          star(p, cx + Math.sin(a) * d, cy - 2 * S + Math.cos(a) * d * 0.7 - u * 3 * S, Math.round(Math.sin(u * Math.PI) * (res === 'l' ? 3 : 1.4)), RL);
        }
      }
    for (const ru of runes) drawRune(p, f, ru, RC, RL, S, ox, oy);
    return p;
  }
  return burstFrame(kind, r, t, res, pl);
}

/** Соседи пикселей палитры `pl` (светящейся трещины) на скорлупе — светлее на ступень. */
function spill(f: Frame, pl: number, rad: number): void {
  const { w, h } = f;
  const src: number[] = [];
  for (let i = 0; i < w * h; i++) if (f.pal[i] === pl) src.push(i);
  const hit = new Set<number>();
  for (const i of src) {
    const x = i % w;
    const y = (i / w) | 0;
    for (let dy = -rad; dy <= rad; dy++)
      for (let dx = -rad; dx <= rad; dx++) {
        if (Math.abs(dx) + Math.abs(dy) > rad) continue;
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx;
        if (f.pal[j] < 0 || f.pal[j] === pl || f.pal[j] === EMBER) continue;
        hit.add(j);
      }
  }
  for (const j of hit) f.tone[j] = Math.min(PALS[f.pal[j]].length - 1, f.tone[j] + 1);
}

/** Лучи света за предметом: веер из середины, только по пустым пикселям. */
function rays(
  p: Px,
  cx: number,
  cy: number,
  len: number,
  n: number,
  rot: number,
  k: number,
  c: RGBA,
  l: RGBA,
  S: number,
): void {
  if (k <= 0) return;
  for (let j = 0; j < n; j++) {
    const a = rot + (j / n) * Math.PI * 2 + hash(j, 2, 9) * 0.3;
    const L = len * (0.75 + hash(j, 3, 9) * 0.5);
    const wdt = Math.max(1, Math.round((j % 2 ? 1 : 1.6) * S * 0.6));
    for (let d = 0; d < L; d += 0.5) {
      const x = cx + Math.cos(a) * d;
      const y = cy + Math.sin(a) * d;
      const fade = 1 - d / L;
      for (let o = -(wdt >> 1); o <= wdt >> 1; o++) {
        const xx = Math.round(x - Math.sin(a) * o);
        const yy = Math.round(y + Math.cos(a) * o);
        if (!dith(xx, yy, fade * k * 1.2)) continue;
        onEmpty(p, xx, yy, fade > 0.55 && o === 0 ? l : c);
      }
    }
  }
}

interface RuneAt {
  pos: V3;
  g: number;
  vis: number;
}
/** Руны на орбите вокруг яйца (r ≥ 4): летают всё быстрее и втягиваются перед разломом. */
function orbitRunes(r: number, t: number, P: Pose, S: number): RuneAt[] {
  const pl = hatchPlan(r);
  if (t < pl.c1) return [];
  const out: RuneAt[] = [];
  const n = r >= 5 ? 6 : 5;
  const a0 = t - pl.c1;
  const sp = 2.2 + a0 * 1.4;
  const shrink = 1 - clamp01((t - (pl.b - 0.3)) / 0.3);
  const C = add(P.B, mul(P.A, P.H * 0.5));
  for (let j = 0; j < n; j++) {
    const a = (j / n) * Math.PI * 2 + sp * a0;
    const R0 = (SHAPE.crystal.R * 1.9 + Math.sin(a0 * 3 + j) * 1.2) * S * shrink;
    const pos: V3 = [C[0] + Math.cos(a) * R0, C[1] + Math.sin(a) * R0, C[2] + Math.sin(a * 2 + j) * 2.5 * S - 3 * S];
    out.push({ pos, g: j % GLYPHS.length, vis: clamp01(a0 / 0.3) * (shrink > 0.05 ? 1 : 0) });
  }
  return out;
}
function drawRune(p: Px, f: Frame, ru: RuneAt, c: RGBA, l: RGBA, S: number, ox: number, oy: number): void {
  if (ru.vis <= 0) return;
  const sx = ox + ru.pos[0];
  const sy = oy + ru.pos[1] * SE - ru.pos[2] * CE;
  const dz = ru.pos[1] * CE + ru.pos[2] * SE;
  const sz = S >= 2 ? 3.2 * S * 0.75 : 2;
  for (const sg of GLYPHS[ru.g]) {
    const n = Math.ceil(Math.hypot(sg[2] - sg[0], sg[3] - sg[1]) * sz * 1.5) + 1;
    for (let k = 0; k <= n; k++) {
      const x = Math.round(sx + lerp(sg[0], sg[2], k / n) * sz * 0.6);
      const y = Math.round(sy - lerp(sg[1], sg[3], k / n) * sz);
      if (x < 0 || y < 0 || x >= f.w || y >= f.h) continue;
      const i = y * f.w + x;
      // Позади яйца — закрыта им.
      if (f.pal[i] >= 0 && f.zb[i] > dz) continue;
      if (!dith(x, y, ru.vis)) continue;
      p.set(x, y, S >= 2 ? l : c);
      if (S >= 2) {
        for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < f.w && yy < f.h && !(f.pal[yy * f.w + xx] >= 0 && f.zb[yy * f.w + xx] > dz)) p.set(xx, yy, c);
        }
      }
    }
  }
}

/**
 * Лепесток низа: подскок и заваливание наружу на бок (≈80°) с отскоком; середина падает
 * с высоты (яйцо могло висеть), пол держит самую низкую точку (`splatShell`).
 */
function petal(k: number, r: number, cw: V3, dirH: V3, tip: V3, tau: number, dist: number, vz: number, S: number, vis: number): PieceAt {
  const sd = hash(k, 7, r) - 0.5;
  const T = 0.17 + (hash(k, 3, r) - 0.5) * 0.05 - r * 0.01;
  const th = 1.32 + sd * 0.3;
  const u = tau / T;
  const an = u < 1 ? th * u * u : th - th * 0.16 * Math.sin(Math.PI * clamp01((u - 1) / 0.7)) * (u < 1.7 ? 1 : 0);
  const z = cw[2] + vz * tau - (GRAV * S * tau * tau) / 2;
  const d = dist * (1 - Math.exp(-tau / 0.1));
  return { pos: [cw[0] + dirH[0] * d, cw[1] + dirH[1] * d * 0.6, z], ax: tip, an, vis };
}

function burstFrame(kind: EggKind, r: number, t: number, res: Res, pl: Plan): Px {
  const cv = RES[res];
  const [ox, oy] = origin(res);
  const S = cv.box / 36;
  const tau = t - pl.b;
  const net = crackNet(kind, r);
  const sh = shellOf(kind, r, res, false);
  const P = makePose(kind, res, hatchPose(kind, r, pl.b - 0.001));
  const rc = RARITIES[r];
  const RC = hx(rc.color);
  const RL = hx(rc.light);
  const WH = hx('#ffffff');
  const fadeA = pl.end - pl.b - 0.34;
  const fadeB = pl.end - pl.b - 2 / FPS;
  const vis = 1 - clamp01((tau - fadeA) / (fadeB - fadeA));
  const nUp = Math.max(1, net.up.length);
  const C = add(P.B, mul(P.A, P.H * 0.5));
  const L: Look = { kind, res, t, r, net: null, inner: 1, pulse: 1, glint: -1 };
  const f = newFrame(cv.cw, cv.ch);
  // Куски: колпак вверх и в стороны, лепестки низа заваливаются наружу.
  const at = (k: number): PieceAt => {
    const cl = sh.cen[k];
    const cw = toWorld(P, cl);
    const outL = norm([cl[0], cl[1], 0.0001]);
    const out = dirWorld(P, outL);
    const cap = k < nUp;
    const sd = hash(k, 7, r) - 0.5;
    if (r >= 5) {
      // Мифическое: куски уходят на орбиту вокруг места яйца, потом разлетаются.
      const T1 = 0.5;
      const a0 = Math.atan2(cw[1] - C[1], cw[0] - C[0]);
      const rad0 = Math.hypot(cw[0] - C[0], cw[1] - C[1]);
      const ro = (SHAPE[kind].R * 2.1 + (k % 3) * 2.2) * S;
      const orb = (u: number): V3 => {
        const e = 1 - (1 - clamp01(u / 0.2)) ** 3;
        const a = a0 + 7 * u;
        const rr = lerp(rad0, ro, e);
        return [C[0] + Math.cos(a) * rr, C[1] + Math.sin(a) * rr, lerp(cw[2], C[2] + ((k % 4) - 1.5) * 3 * S, e)];
      };
      if (tau < T1) return { pos: orb(tau), ax: norm([sd, 0.4, 1]), an: tau * (9 + k), vis };
      const p0 = orb(T1);
      const p1 = orb(T1 - 0.01);
      const v: V3 = mul(sub(p0, p1), 100 * 0.55);
      const b = fly({ pos: p0, vel: [v[0], v[1], v[2] + 40 * S], ax: [0, 0, 1], w: 6, rest: sh.ext[k] * 0.25 * S }, tau - T1, GRAV * S);
      return { pos: b.pos, ax: norm([sd, 0.4, 1]), an: T1 * (9 + k) + b.an, vis };
    }
    const dirH: V3 = cap && nUp === 1 ? [-0.8, 0.15, 0] : out;
    const tip = norm(cross([0, 0, 1], dirH[0] || dirH[1] ? dirH : [1, 0, 0]));
    if (cap) {
      const vz = (62 + r * 12) * (0.9 + sd * 0.3);
      const vh = nUp > 1 ? 28 + r * 5 : 34 + r * 4;
      const vel: V3 = [dirH[0] * vh * S, dirH[1] * vh * S * 0.6, vz * S];
      const b = fly({ pos: cw, vel, ax: tip, w: -(7 + r), rest: sh.ext[k] * 0.3 * S }, tau, GRAV * S);
      return { pos: b.pos, ax: tip, an: b.an, vis, ground: b.floor };
    }
    return petal(k, r, cw, dirH, tip, tau, (SHAPE[kind].R * 0.55 + r * 1.6) * S, (14 + r * 7) * S, S, vis);
  };
  const sp = splatShell(f, P, sh, L, at, ox, oy);
  // Частицы материала: мох, сколы, осколки, чешуйки.
  const bits = bitsFor(kind, r, [C[0] / S, C[1] / S, C[2] / S], false);
  const parts: Part[] = [];
  bits.forEach((b, j) => {
    if (b.ember) return;
    const q = fly({ pos: mul(b.pos, S), vel: mul(b.vel, S), ax: [0, 0, 1], w: 0, rest: b.r * S }, tau, GRAV * S);
    const life = 1 - clamp01((tau - b.life) / 0.2);
    if (life <= 0 || vis <= 0) return;
    parts.push({
      c: q.pos,
      ax: axes(norm([Math.cos(j + tau * 9), Math.sin(j), 0.3]), [0, 0, 1]),
      r: [b.r * S * 1.25, b.r * S, b.r * S * 0.8],
      pal: b.pal,
      id: 40 + j,
      bias: 0.05,
    });
  });
  // Мох с колпаком: пучки и росток летят с кусками.
  if (kind === 'moss') {
    const xf = (phi: number, s: number) => {
      const k = pieceOf(net, phi, s);
      const st = sp.st[k];
      if (st.vis <= 0) return null;
      const c0 = toWorld(P, sh.cen[k]);
      const up = sp.lift[k];
      return (v: V3): V3 => {
        const w = add(st.pos, rotV(sub(v, c0), st.ax, st.an));
        w[2] += up;
        return w;
      };
    };
    parts.push(...mossParts(P, t, res === 'l', xf));
  }
  drawParts(f, parts, PALS, ox, oy);
  seams(f, 1.2, 1);
  const p = finish(f);
  const cx = ox + C[0];
  const cy = oy + C[1] * SE - C[2] * CE;
  const floorY = oy;
  const k0 = 1 - clamp01(tau / 0.35);
  // Столб света (r ≥ 3): из места яйца вверх; ближние куски его закрывают.
  if (r >= 3) pillar(p, f, cx, cy + 6 * S, C[1] * CE + C[2] * SE, tau, pl, S, RC, RL, r);
  // Солнце (r5): вращающиеся лучи за всем.
  if (r >= 5) rays(p, cx, cy, (34 + Math.min(1, tau / 0.2) * 22) * S * 0.6, 14, tau * 1.2, 1 - clamp01((tau - 0.7) / 0.35), RC, hx('#ffe0a0'), S);
  else if (r >= 2) rays(p, cx, cy, (20 + r * 5) * S * 0.6, 7 + r, pl.b * 0.4, k0, RC, RL, S);
  // Кольцо света на полу (r ≥ 2) и ударная волна (r ≥ 4).
  if (r >= 2) {
    const u = clamp01(tau / 0.45);
    const fr0 = (10 + u * (18 + r * 3)) * S;
    ellipseRing(p, cx, floorY, fr0, fr0 * SE * 1.1, Math.max(1, S * 1.2 * (1 - u) + 0.6), u < 0.5 ? RL : RC, 1 - u);
  }
  if (r >= 4) {
    const u = clamp01(tau / 0.32);
    ellipseRing(p, cx, cy, (8 + u * 46) * S, (8 + u * 46) * S * 0.9, Math.max(1, 2.2 * S * (1 - u)), u < 0.4 ? WH : RL, 1 - u * u);
  }
  // Пыль у основания.
  const nPuff = 3 + Math.min(4, r);
  for (let j = 0; j < nPuff; j++) {
    const sd = j % 2 ? 1 : -1;
    const u = clamp01(tau / (0.5 + hash(j, 2, 4) * 0.2));
    const x = cx + sd * (4 + u * (10 + j * 2.2)) * S;
    const y = floorY - (1.5 + u * 2 + (j % 3)) * S;
    puff(p, x, y, (1.6 + u * 3.2) * S * (0.8 + hash(j, 1, 4) * 0.4), DUST[kind], (1 - u) * 0.95 * (tau < 0.02 ? 0 : 1));
  }
  // Угольки дракона: поднимаются, мерцают.
  if (kind === 'dragon')
    bits.forEach((b, j) => {
      if (!b.ember) return;
      const u = tau / (b.life + 0.3);
      if (u > 1) return;
      const x = ox + (b.pos[0] + b.vel[0] * tau * 0.8) * S;
      const z = (b.pos[2] + b.vel[2] * 0.6 * tau + 18 * tau * tau) * S;
      const y = oy + b.pos[1] * S * SE - z * CE;
      const c = (Math.floor(tau * 24) + j) % 3 ? hx('#ffb84a') : hx('#ffe8a0');
      if (dith(Math.round(x), Math.round(y), 1 - u)) {
        p.set(x, y, c);
        if (S >= 2) {
          p.set(x + 1, y, hx('#f48a22'));
          p.set(x, y + 1, hx('#d85a12'));
        }
      }
    });
  // Искры редкости (r ≥ 1): разлетаются и гаснут.
  if (r >= 1) {
    const n = 3 + r * 2;
    for (let j = 0; j < n; j++) {
      const a = (j / n) * Math.PI * 2 + hash(j, 1, 8);
      const u = clamp01(tau / (0.45 + hash(j, 2, 8) * 0.3));
      if (u >= 1) continue;
      const d = (8 + u * (18 + r * 4)) * S;
      const sz = Math.sin(u * Math.PI) * (S >= 2 ? 3.5 : 1.6) * (j % 3 ? 1 : 1.3);
      star(p, cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.75 - u * 6 * S, Math.round(sz), u < 0.5 ? RL : RC);
    }
  }
  // Вспышка разлома: белая середина, кайма редкости, тает шахматкой.
  const fl = r >= 4 ? 1.25 : r >= 2 ? 0.8 : 0.45;
  const fu = clamp01(tau / (r >= 4 ? 0.22 : 0.14));
  if (fu < 1) {
    const rr = (SHAPE[kind].R * (0.6 + fu * 0.9) * fl + 2) * S;
    for (let yy = Math.floor(cy - rr); yy <= cy + rr; yy++)
      for (let xx = Math.floor(cx - rr); xx <= cx + rr; xx++) {
        const d = Math.hypot(xx + 0.5 - cx, (yy + 0.5 - cy) * 1.1) / rr;
        if (d > 1 || !dith(xx, yy, (1 - fu) * (1.3 - d))) continue;
        blend(p, xx, yy, d < 0.55 ? WH : r >= 1 ? RL : hx('#f4efe4'), r === 0 ? 0.75 : 1);
      }
  }
  return p;
}

function pillar(
  p: Px,
  f: Frame,
  cx: number,
  cy: number,
  dz: number,
  tau: number,
  pl: Plan,
  S: number,
  c: RGBA,
  l: RGBA,
  r: number,
): void {
  const dur = pl.end - pl.b - 0.15;
  const grow = clamp01(tau / 0.12);
  const fade = 1 - clamp01((tau - dur * 0.55) / (dur * 0.4));
  if (fade <= 0) return;
  const half = (r >= 5 ? 9 : 7) * S * (0.6 + 0.4 * grow) * (0.7 + 0.3 * fade);
  const top = cy - (70 + r * 4) * S * 0.8 * grow;
  const WH = hx('#ffffff');
  for (let y = Math.floor(top); y <= cy; y++) {
    const v = (cy - y) / (cy - top + 1);
    const flow = (Math.floor((y + tau * 90 * S) / (5 * S)) % 3 === 0 ? 1 : 0) * 0.15;
    const wv = half * (1 - v * 0.25);
    for (let x = Math.floor(cx - wv); x <= cx + wv; x++) {
      if (x < 0 || y < 0 || x >= f.w || y >= f.h) continue;
      const e = Math.abs(x + 0.5 - cx) / wv;
      const k = fade * (1 - v * v) * (1 - e * 0.5) + flow;
      if (!dith(x, y, k)) continue;
      const i = y * f.w + x;
      // Ближний кусок закрывает столб.
      if (f.pal[i] >= 0 && f.zb[i] > dz) continue;
      if (p.data[i * 4 + 3] > 0 && f.pal[i] < 0) continue;
      blend(p, x, y, e < 0.3 ? WH : e < 0.65 ? l : c, f.pal[i] >= 0 ? 0.55 : 0.9);
    }
  }
}

// ---------------------------------------------------------------------------
// «Вылупить все»: короткий хлопок (малая полоса).
// ---------------------------------------------------------------------------

function popFrame(kind: EggKind, i: number, res: Res): Px {
  const t = i / FPS;
  const net = crackNet(kind, 0, true);
  const [ox, oy] = origin(res);
  const S = RES[res].box / 36;
  const tb = 6 / FPS;
  const cv = RES[res];
  if (t < tb) {
    const tilt = kf(t, [[0, 0], [1 / FPS, -0.2, 'o'], [2.5 / FPS, 0.2], [4 / FPS, -0.1], [5 / FPS, 0]]);
    const st = kf(t, [[3 / FPS, 0], [4.5 / FPS, -0.1, 'o'], [5.5 / FPS, 0.06, 'i']]);
    const q = { ...breathe(t), tilt: breathe(t).tilt + tilt, st: breathe(t).st + st };
    const L: Look = { kind, res, t, r: 0, net, inner: 0, pulse: pulseAt(kind, t), glint: -1 };
    const f = newFrame(cv.cw, cv.ch);
    const P = makePose(kind, res, q);
    castEgg(f, P, L, ox, oy);
    if (kind === 'moss') drawParts(f, mossParts(P, t, false), PALS, ox, oy);
    seams(f, 1.2, 1);
    const p = finish(f);
    overIdle(p, kind, res, t, P, L);
    return p;
  }
  const tau = t - tb;
  const sh = shellOf(kind, 0, res, true);
  const P = makePose(kind, res, { ...REST, st: 0.06 });
  // Тает к предпоследнему кадру: последний пустой.
  const vis = 1 - clamp01((tau - 0.12) / ((POP_N - 2) / FPS - tb - 0.12));
  const L: Look = { kind, res, t, r: 0, net: null, inner: 0, pulse: 0, glint: -1 };
  const f = newFrame(cv.cw, cv.ch);
  const at = (k: number): PieceAt => {
    const cl = sh.cen[k];
    const cw = toWorld(P, cl);
    const cap = k === 0;
    const out = dirWorld(P, norm([cl[0], cl[1], 0.0001]));
    const dirH: V3 = cap ? [-0.7, 0.2, 0] : out;
    const ax = norm(cross([0, 0, 1], dirH));
    if (!cap) return petal(k, 0, cw, dirH, ax, tau, 6 * S, 14 * S, S, vis);
    const vel: V3 = [dirH[0] * 26 * S, dirH[1] * 12 * S, 75 * S];
    const b = fly({ pos: cw, vel, ax, w: -9, rest: sh.ext[k] * 0.3 * S }, tau, GRAV * S);
    return { pos: b.pos, ax, an: b.an, vis, ground: b.floor };
  };
  splatShell(f, P, sh, L, at, ox, oy);
  const C = add(P.B, mul(P.A, P.H * 0.5));
  const parts: Part[] = [];
  bitsFor(kind, 0, [C[0] / S, C[1] / S, C[2] / S], true).forEach((b, j) => {
    if (b.ember) return;
    const q = fly({ pos: mul(b.pos, S), vel: mul(b.vel, S), ax: [0, 0, 1], w: 0, rest: b.r * S }, tau, GRAV * S);
    if (vis <= 0) return;
    parts.push({ c: q.pos, ax: axes([1, 0, 0.3], [0, 0, 1]), r: [b.r * S * 1.2, b.r * S, b.r * S * 0.8], pal: b.pal, id: 40 + j });
  });
  drawParts(f, parts, PALS, ox, oy);
  const p = finish(f);
  const cx = ox + C[0];
  const cy = oy + C[1] * SE - C[2] * CE;
  for (let j = 0; j < 3; j++) {
    const u = clamp01(tau / 0.32);
    puff(p, cx + (j - 1) * (3 + u * 7) * S, oy - (1.5 + u * 1.5) * S, (1.4 + u * 2.4) * S, DUST[kind], (1 - u) * 0.9);
  }
  if (tau < 0.09) star(p, cx, cy - 3 * S, 2, hx('#fff6dc'));
  return p;
}
