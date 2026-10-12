// Пиксельные книги зачарований — рисовальщик кадров. Игра этот модуль НЕ
// импортирует: она играет готовые полосы WebP по манифесту
// `sprites-books.ts`. Запекание — `scripts/props-pixel/bake.ts -- --set books`.
//
// Приём — как у пиксельных питомцев (`pets-pixel/rig.ts`, его не трогаем):
// луч на пиксель с буфером глубины, свет сверху-слева, тон — НОМЕР ступени
// палитры, швы, кант света, контур «по соседу». Книга — не эллипсоиды, а
// выпуклые тела (`drawSolids`): брус (крышки, блок страниц, пряжка), полуцилиндр
// (корешок, бинты), брус с подрезами (уголки-треугольники, огранённый камень).
// Каждая грань знает свои координаты — обложка расписывается по ним
// (рамка, медальон, тиснение), и при повороте рисунок едет с гранью.
//
// Книга строится в СВОИХ координатах (x — от корешка к обрезу, y — толщина,
// передняя крышка к +y, z — вверх, низ крышек на 0), потом одной позой
// (сплющивание → наклон → поворот → сдвиг) ставится в мир: поворот при
// падении — настоящий 3D, видны корешок, задняя крышка и обрез.
// Логика сцен — `.claude/rules/props-books.md`. Всё детерминировано.

import { Px } from '../dungeon-art';
import {
  add,
  bump,
  clamp01,
  dith,
  dot,
  drawParts,
  hash,
  hx,
  kf,
  lerp,
  LIGHT,
  mixc,
  newFrame,
  norm,
  pitchX,
  project,
  ramp,
  rimLight,
  rollY,
  seams,
  selOutline,
  sub,
  toPx,
  VIEW,
  wrap,
} from '../pets-pixel/rig';
import type { Frame, Part, RGBA, V3 } from '../pets-pixel/rig';
import { bookIdleBob } from './books-idle';
import type { BookTier } from './books-idle';
import type { Canvas, Res, StripDef } from './types';

// ---------------------------------------------------------------------------
// Холсты, ярусы, полосы.
// ---------------------------------------------------------------------------

/** Холст: рамка в середине, сверху место для падения и столба света, снизу — для лучей к кирке. */
export const RES: Record<Res, Canvas> = {
  s: { box: 48, cw: 120, ch: 172, bx: 36, by: 64 },
  l: { box: 112, cw: 280, ch: 400, bx: 84, by: 149 },
};

export const TIERS: readonly BookTier[] = ['simple', 'rare', 'epic', 'legend'];
export type Tier = BookTier;
/** Ярус → ступень редкости (как `TIER_RARITY` в BooksTab). */
const TIER_R: Record<Tier, number> = { simple: 0, rare: 2, epic: 3, legend: 4 };

export const FPS = 24;

/** Секунды → номер кадра. */
const fr = (s: number) => Math.round(s * FPS);

/** Длительности сцен по ярусам (секунды) и ключевые моменты. */
const REVEAL: Record<
  Tier,
  { T: number; land: number; snap: number; open: number; peak: number; close: number; lock: number }
> = {
  simple: { T: 1.75, land: 0.5, snap: 0.72, open: 0.8, peak: 1.2, close: 1.38, lock: 1.56 },
  rare: { T: 2.25, land: 0.55, snap: 0.96, open: 1.04, peak: 1.58, close: 1.8, lock: 2.0 },
  epic: { T: 3.55, land: 0.8, snap: 1.45, open: 1.75, peak: 2.45, close: 2.85, lock: 3.2 },
  legend: { T: 4.6, land: 1.0, snap: 1.85, open: 2.25, peak: 3.1, close: 3.6, lock: 4.1 },
};
const APPLY_T: Record<Tier, number> = { simple: 1.3, rare: 1.42, epic: 1.6, legend: 1.8 };
const BURN_T: Record<Tier, number> = { simple: 1.6, rare: 1.6, epic: 1.7, legend: 1.8 };
/** Покой: петля, секунды. */
const IDLE_T: Record<Tier, number> = { simple: 2, rare: 2, epic: 2, legend: 3 };

function buildStrips(): Record<string, StripDef> {
  const s: Record<string, StripDef> = {};
  for (const t of TIERS) {
    const glyph = glyphAnchors();
    s[`still-${t}`] = { frames: 1, fps: FPS, loop: false, anchors: glyph };
    s[`idle-${t}`] = { frames: fr(IDLE_T[t]), fps: FPS, loop: true, anchors: glyph };
    const r = REVEAL[t];
    s[`reveal-${t}`] = {
      frames: fr(r.T),
      fps: FPS,
      loop: false,
      marks: {
        land: fr(r.land),
        snap: fr(r.snap),
        open: fr(r.open),
        peak: fr(r.peak),
        close: fr(r.close),
        lock: fr(r.lock),
      },
      anchors: { ...glyph, rise: riseAnchor(t) },
    };
    const A = APPLY_T[t];
    s[`apply-ok-${t}`] = {
      frames: fr(A),
      fps: FPS,
      loop: false,
      marks: { open: fr(0.36), hit: fr(applyHit(t)), gone: fr(A - 0.12) },
      anchors: { to: boxFrac(APPLY_TO) },
    };
    s[`apply-burn-${t}`] = {
      frames: fr(BURN_T[t]),
      fps: FPS,
      loop: false,
      marks: { ignite: fr(0.12), crumble: fr(BURN_T[t] - 0.62) },
    };
  }
  return s;
}

/** Покачивание покоя в кадре i (вверх — минус); формула общая с игрой (`books-idle.ts`). */
export function idleBob(tier: Tier, i: number, res: Res): number {
  return bookIdleBob(tier, i, fr(IDLE_T[tier]), RES[res].box / RES.s.box);
}

// ---------------------------------------------------------------------------
// Размеры книги (в пикселях малой полосы) и якоря.
// ---------------------------------------------------------------------------

/** Высота крышек, ширина крышки, толщина книги, толщина крышки, свес крышек над блоком. */
const H = 38;
const W = 28;
const T = 10;
const CB = 1.5;
const OV = 1.3;
/** Выпуклость корешка. */
const SPD = 2.2;
/** Пол — на столько пикселей малой полосы ниже верха рамки. */
const GROUND = 45;
/** Поза на полке: книга чуть развёрнута обрезом к нам. */
const YAW0 = 0.42;
/** Сдвиг книги в позе покоя, чтобы рисунок стоял по середине рамки. */
const X0 = 1.2;
/** Медальон под знак чары: середина на крышке (от корешка, от низа) и радиус. */
const MED_X = W / 2 + 0.7;
const MED_Z = H / 2 + 0.4;
const MED_R = 6.4;

// ---------------------------------------------------------------------------
// Палитры (тени холоднее, свет теплее).
// ---------------------------------------------------------------------------

const P = {
  cover: 0,
  cover2: 1,
  paper: 2,
  metal: 3,
  gold: 4,
  strap: 5,
  gem: 6,
  glow: 7,
  ember: 8,
  char: 9,
  dust: 10,
  pglow: 11,
} as const;

const COVER: Record<Tier, string[]> = {
  simple: ['#1f1418', '#3a2420', '#57351f', '#774a2a', '#966336', '#b47f45', '#cc9d62'],
  rare: ['#0b0f26', '#141c44', '#1c2b66', '#263e88', '#3355a6', '#4870c0', '#6a92d4'],
  epic: ['#170824', '#2a0f3c', '#401858', '#582474', '#73348e', '#9049a8', '#ad68c0'],
  legend: ['#040304', '#0b090b', '#141013', '#1e181b', '#2a2125', '#382c30', '#4a3a3c'],
};
const COVER2: Record<Tier, string[]> = {
  simple: ['#2a1810', '#4a2c1a', '#6a4226', '#8c5c34', '#ad7a48'],
  rare: ['#101830', '#1c2a50', '#2c4274', '#40609a', '#5a80b8'],
  epic: ['#1e0a2a', '#36124a', '#521c6a', '#702c8a', '#9244a6'],
  legend: ['#22050c', '#3e0a15', '#5f121e', '#831c25', '#a8292c', '#cc4636'],
};
const PAPER = ['#4a3a30', '#76624c', '#a08a68', '#c4ae86', '#ddcca2', '#efe3c0', '#fbf5e0'];
const SILVER = ['#1c2030', '#363e52', '#5a667c', '#8490a4', '#b0bccb', '#d8e2ec', '#ffffff'];
const GOLD = ['#2a1406', '#4f2c0c', '#7f5014', '#b07c20', '#dca838', '#f4d26c', '#fff4c4'];
const BRASS = ['#24160a', '#43290f', '#6a4618', '#94672a', '#ba8a40', '#d8ae66'];
const STRAP: Record<Tier, string[]> = {
  simple: ['#20160c', '#3e2c18', '#644a2a', '#8c6c40', '#b2945e', '#d0b682'],
  rare: ['#0a0c16', '#161a2a', '#242b42', '#363f5c', '#4c5876'],
  epic: ['#0e0612', '#1e0e26', '#30183c', '#442454', '#5a346c'],
  legend: ['#1a0c04', '#3a1e08', '#62380e', '#8c561a', '#b47a2a', '#d6a044', '#f0cc72'],
};
const GEM = [
  '#22062e',
  '#4a0f5e',
  '#7e1e96',
  '#b23cc4',
  '#e070e0',
  '#f8b0f2',
  '#ffe8fc',
  '#ffffff',
];
const GLOW: Record<Tier, string[]> = {
  simple: ['#4a4036', '#8a7c66', '#c8baa0', '#ece2cc', '#fffaf0'],
  rare: ['#0e2c62', '#1d58b0', '#3a8cf0', '#7ec0ff', '#cfe8ff', '#ffffff'],
  epic: ['#2e0c56', '#6224a8', '#a058f0', '#cc98ff', '#ecd6ff', '#ffffff'],
  legend: ['#5a2604', '#b05a0c', '#f09a22', '#ffc95a', '#ffeaa8', '#fffcf0'],
};
const EMBER = ['#3a0c04', '#7a1c06', '#c03c0c', '#f07018', '#ffa834', '#ffd870', '#fff6d0'];
const CHAR = ['#070505', '#120c0a', '#1e1410', '#2c1e16', '#3c2a1e'];
const DUST = ['#4a403a', '#6e6458', '#948a78', '#b8ad98', '#d8cfbc', '#eee8da'];

function palsOf(tier: Tier): RGBA[][] {
  const metal = tier === 'rare' ? SILVER : tier === 'simple' ? BRASS : GOLD;
  const pglow = PAPER.map((c, k) =>
    mixc(hx(c), hx(GLOW[tier][Math.min(GLOW[tier].length - 1, k)]), 0.55),
  );
  return [
    ramp(...COVER[tier]),
    ramp(...COVER2[tier]),
    ramp(...PAPER),
    ramp(...metal),
    ramp(...GOLD),
    ramp(...STRAP[tier]),
    ramp(...GEM),
    ramp(...GLOW[tier]),
    ramp(...EMBER),
    ramp(...CHAR),
    ramp(...DUST),
    pglow,
  ];
}

/** Тушь контура: почти чёрная, у каждого яруса своя. */
const INK: Record<Tier, RGBA> = {
  simple: hx('#140c0c'),
  rare: hx('#070a1a'),
  epic: hx('#0e0616'),
  legend: hx('#040306'),
};

// ---------------------------------------------------------------------------
// Выпуклые тела: брус, полуцилиндр, подрезы. Луч на пиксель, как у рига.
// ---------------------------------------------------------------------------

const CE = VIEW[1];
const SE = VIEW[2];
/** Полувектор света и взгляда: ступенчатый блик металла и камня. */
const HV = norm(add(LIGHT, VIEW));

/** Грань: 0 +e1, 1 −e1, 2 +e2, 3 −e2, 4 +e3, 5 −e3, 6 — круглая, 7+ — подрез. */
type Painter = (face: number, q: V3, k: number, n: V3) => number | [number, number] | null;

interface Solid {
  c: V3;
  ax: [V3, V3, V3];
  r: V3;
  /** Цилиндр вдоль оси с этим номером (круглый поперёк двух других); нет — брус. */
  round?: 0 | 1 | 2;
  /** Подрезы в нормированных координатах тела: n·q ≤ d. */
  cuts?: [number, number, number, number][];
  pal: number;
  id: number;
  paint?: Painter;
  bias?: number;
  noSeam?: boolean;
}

function drawSolids(f: Frame, list: Solid[], pals: RGBA[][], ox: number, oy: number): void {
  const { w, h, zb } = f;
  const q0 = [0, 0, 0];
  const qd = [0, 0, 0];
  for (const s of list) {
    const [e1, e2, e3] = s.ax;
    const r = s.r;
    if (r[0] <= 0.04 || r[1] <= 0.04 || r[2] <= 0.04) continue;
    let mnx = 1e9;
    let mxx = -1e9;
    let mny = 1e9;
    let mxy = -1e9;
    for (let a = -1; a <= 1; a += 2)
      for (let b = -1; b <= 1; b += 2)
        for (let c = -1; c <= 1; c += 2) {
          const p: V3 = [
            s.c[0] + a * r[0] * e1[0] + b * r[1] * e2[0] + c * r[2] * e3[0],
            s.c[1] + a * r[0] * e1[1] + b * r[1] * e2[1] + c * r[2] * e3[1],
            s.c[2] + a * r[0] * e1[2] + b * r[1] * e2[2] + c * r[2] * e3[2],
          ];
          const [sx, sy] = project(p);
          mnx = Math.min(mnx, sx);
          mxx = Math.max(mxx, sx);
          mny = Math.min(mny, sy);
          mxy = Math.max(mxy, sy);
        }
    const x0 = Math.max(0, Math.floor(ox + mnx - 1));
    const x1 = Math.min(w - 1, Math.ceil(ox + mxx + 1));
    const y0 = Math.max(0, Math.floor(oy + mny - 1));
    const y1 = Math.min(h - 1, Math.ceil(oy + mxy + 1));
    if (x0 > x1 || y0 > y1) continue;
    const ax = [e1, e2, e3];
    for (let k = 0; k < 3; k++) qd[k] = dot(VIEW, ax[k]) / r[k];
    const N = pals[s.pal].length;
    for (let py = y0; py <= y1; py++) {
      const sy = py + 0.5 - oy;
      const dy = sy * SE - s.c[1];
      const dz = -sy * CE - s.c[2];
      for (let px = x0; px <= x1; px++) {
        const dx = px + 0.5 - ox - s.c[0];
        for (let k = 0; k < 3; k++) {
          const e = ax[k];
          q0[k] = (dx * e[0] + dy * e[1] + dz * e[2]) / r[k];
        }
        let lo = -1e9;
        let hi = 1e9;
        let face = -1;
        let empty = false;
        for (let k = 0; k < 3 && !empty; k++) {
          if (s.round !== undefined && k !== s.round) continue;
          if (Math.abs(qd[k]) < 1e-9) {
            if (Math.abs(q0[k]) > 1) empty = true;
            continue;
          }
          const ta = (-1 - q0[k]) / qd[k];
          const tb = (1 - q0[k]) / qd[k];
          if (qd[k] > 0) {
            if (ta > lo) lo = ta;
            if (tb < hi) {
              hi = tb;
              face = 2 * k;
            }
          } else {
            if (tb > lo) lo = tb;
            if (ta < hi) {
              hi = ta;
              face = 2 * k + 1;
            }
          }
        }
        if (empty) continue;
        if (s.round !== undefined) {
          const a = s.round === 0 ? 1 : 0;
          const b = s.round === 2 ? 1 : 2;
          const A = qd[a] * qd[a] + qd[b] * qd[b];
          const B = 2 * (q0[a] * qd[a] + q0[b] * qd[b]);
          const C = q0[a] * q0[a] + q0[b] * q0[b] - 1;
          if (A < 1e-12) {
            if (C > 0) continue;
          } else {
            const disc = B * B - 4 * A * C;
            if (disc < 0) continue;
            const sq = Math.sqrt(disc);
            const t1 = (-B - sq) / (2 * A);
            const t2 = (-B + sq) / (2 * A);
            if (t1 > lo) lo = t1;
            if (t2 < hi) {
              hi = t2;
              face = 6;
            }
          }
        }
        if (s.cuts)
          for (let j = 0; j < s.cuts.length; j++) {
            const [n0, n1, n2, d] = s.cuts[j];
            const a = n0 * q0[0] + n1 * q0[1] + n2 * q0[2] - d;
            const b = n0 * qd[0] + n1 * qd[1] + n2 * qd[2];
            if (Math.abs(b) < 1e-12) {
              if (a > 0) {
                empty = true;
                break;
              }
              continue;
            }
            const tt = -a / b;
            if (b > 0) {
              if (tt < hi) {
                hi = tt;
                face = 7 + j;
              }
            } else if (tt > lo) lo = tt;
          }
        if (empty || lo > hi || face < 0) continue;
        const t = hi;
        const i = py * w + px;
        if (t <= zb[i]) continue;
        const q: V3 = [q0[0] + t * qd[0], q0[1] + t * qd[1], q0[2] + t * qd[2]];
        let n: V3;
        if (face < 6) {
          const e = ax[face >> 1];
          const sg = face & 1 ? -1 : 1;
          n = [e[0] * sg, e[1] * sg, e[2] * sg];
        } else if (face === 6) {
          const a = s.round === 0 ? 1 : 0;
          const b = s.round === 2 ? 1 : 2;
          n = norm([
            (ax[a][0] * q[a]) / r[a] + (ax[b][0] * q[b]) / r[b],
            (ax[a][1] * q[a]) / r[a] + (ax[b][1] * q[b]) / r[b],
            (ax[a][2] * q[a]) / r[a] + (ax[b][2] * q[b]) / r[b],
          ]);
        } else {
          const [n0, n1, n2] = s.cuts![face - 7];
          n = norm([
            (e1[0] * n0) / r[0] + (e2[0] * n1) / r[1] + (e3[0] * n2) / r[2],
            (e1[1] * n0) / r[0] + (e2[1] * n1) / r[1] + (e3[1] * n2) / r[2],
            (e1[2] * n0) / r[0] + (e2[2] * n1) / r[1] + (e3[2] * n2) / r[2],
          ]);
        }
        const lam = dot(n, LIGHT);
        const bounce = Math.max(0, -n[2]) * 0.14;
        let k = Math.max(0, lam * 0.6 + 0.4 + bounce);
        let pal = s.pal;
        let NN = N;
        if (s.paint) {
          const o = s.paint(face, q, k, n);
          if (o === null) continue;
          if (typeof o === 'number') k = o;
          else {
            pal = o[0];
            k = o[1];
            NN = pals[pal].length;
          }
        }
        if (s.bias) k += s.bias;
        zb[i] = t;
        f.idb[i] = s.noSeam ? -2 : s.id;
        f.pal[i] = pal;
        f.tone[i] = Math.max(0, Math.min(NN - 1, Math.round(k * (NN - 1))));
      }
    }
  }
}

/** Ступенчатый блик по полувектору: металл и камень. */
const shine = (n: V3, a: number, lo = 0.82, hi = 0.94) => {
  const s = dot(n, HV);
  return s > hi ? a : s > lo ? a * 0.45 : 0;
};

// ---------------------------------------------------------------------------
// Перенос в мир: шарнир части → поза книги.
// ---------------------------------------------------------------------------

interface Xf {
  p(v: V3): V3;
  /** Направление с масштабом (длина = растяжение вдоль него). */
  d(v: V3): V3;
}

/** Поворот вокруг вертикали через точку o: + — от +x к +y (к зрителю). */
function rotZ(v: V3, a: number, o: V3 = [0, 0, 0]): V3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const x = v[0] - o[0];
  const y = v[1] - o[1];
  return [o[0] + x * c - y * s, o[1] + x * s + y * c, v[2]];
}
const hingeZ = (a: number, o: V3): Xf => ({
  p: (v) => rotZ(v, a, o),
  d: (v) => rotZ(v, a),
});
const chain = (a: Xf, b: Xf): Xf => ({ p: (v) => b.p(a.p(v)), d: (v) => b.d(a.d(v)) });

function place(s: Solid, xf: Xf): Solid {
  const ax: [V3, V3, V3] = [s.ax[0], s.ax[1], s.ax[2]];
  const r: V3 = [s.r[0], s.r[1], s.r[2]];
  for (let k = 0; k < 3; k++) {
    const d = xf.d(s.ax[k]);
    const l = Math.hypot(d[0], d[1], d[2]) || 1;
    ax[k] = [d[0] / l, d[1] / l, d[2] / l];
    r[k] = s.r[k] * l;
  }
  // Оси после неравного сжатия перестают быть ортогональными — выпрямляем (сжатие только
  // у стоящей книги, перекос мал).
  const e1 = ax[0];
  let e2 = sub(ax[1], [e1[0] * dot(ax[1], e1), e1[1] * dot(ax[1], e1), e1[2] * dot(ax[1], e1)]);
  e2 = norm(e2);
  const e3: V3 = [
    e1[1] * e2[2] - e1[2] * e2[1],
    e1[2] * e2[0] - e1[0] * e2[2],
    e1[0] * e2[1] - e1[1] * e2[0],
  ];
  const sg = dot(e3, ax[2]) < 0 ? -1 : 1;
  return { ...s, c: xf.p(s.c), ax: [e1, e2, [e3[0] * sg, e3[1] * sg, e3[2] * sg]], r };
}

function scaleSolid(s: Solid, RR: number): Solid {
  return {
    ...s,
    c: [s.c[0] * RR, s.c[1] * RR, s.c[2] * RR],
    r: [s.r[0] * RR, s.r[1] * RR, s.r[2] * RR],
  };
}

const AXB: [V3, V3, V3] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
const box = (c: V3, r: V3, pal: number, id: number, o: Partial<Solid> = {}): Solid => ({
  c,
  ax: AXB,
  r,
  pal,
  id,
  ...o,
});

// ---------------------------------------------------------------------------
// Поза.
// ---------------------------------------------------------------------------

interface Pose {
  /** Положение низа книги (середина подошвы) в мире. */
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Наклон назад (−) / к зрителю (+) вокруг точки на высоте `pz`. */
  lean: number;
  roll: number;
  pz: number;
  /** Сплющивание по высоте (1 — нет); вширь — обратно. */
  sq: number;
  /** Угол передней крышки (0 закрыта, ~π — раскрыта). */
  open: number;
  /** Застёжка: угол отхода от обреза (0 — застёгнута). */
  strap: number;
  /** Листы, перелистнутые вправо-влево: угол каждого. */
  sheets: number[];
  /** Свет страниц 0…1, свет в щелях обреза 0…1. */
  glow: number;
  edge: number;
  /** Блик по крышке: место полосы (null — нет). */
  sheen: number | null;
  gem: number;
  sigil: number;
  /** Цепи легендарной: 0 — на месте, 1 — сорваны (звенья в полёте рисует сцена). */
  chains: number;
  /** Растворение (вписано): доля 0…1, прозрачность шахматкой снизу вверх. */
  fade: number;
  /** Вспышка: доля белого по телу. */
  flash: number;
  /** Непрозрачность книги (шахматкой) — появление сверху. */
  alpha: number;
}

const REST: Pose = {
  x: X0,
  y: 0,
  z: 0,
  yaw: YAW0,
  lean: 0,
  roll: 0,
  pz: 0,
  sq: 1,
  open: 0,
  strap: 0,
  sheets: [],
  glow: 0,
  edge: 0,
  sheen: null,
  gem: 0,
  sigil: 0,
  chains: 0,
  fade: 0,
  flash: 0,
  alpha: 1,
};

function bookXf(o: Pose): Xf {
  const sx = 1 / Math.sqrt(o.sq);
  const piv: V3 = [0, 0, o.pz];
  const rot = (v: V3, withPivot: boolean): V3 => {
    let p = v;
    p = pitchX(p, o.lean, withPivot ? piv : [0, 0, 0]);
    p = rollY(p, o.roll, withPivot ? piv : [0, 0, 0]);
    p = rotZ(p, o.yaw);
    return p;
  };
  return {
    p: (v) => {
      const s: V3 = [v[0] * sx, v[1] * sx, v[2] * o.sq];
      return add(rot(s, true), [o.x, o.y, o.z]);
    },
    d: (v) => rot([v[0] * sx, v[1] * sx, v[2] * o.sq], false),
  };
}

// ---------------------------------------------------------------------------
// Рисунок крышек.
// ---------------------------------------------------------------------------

interface Ctx {
  tier: Tier;
  pose: Pose;
  RR: number;
  /** Один пиксель холста в единицах модели. */
  pxu: number;
  hi: boolean;
}

/** Расстояние до рамки-прямоугольника (внутренняя кромка на `ins` от краёв крышки). */
function frameDist(X: number, Z: number, insL: number, ins: number): number {
  const dx = Math.min(X - insL, W - ins - X);
  const dz = Math.min(Z - ins, H - ins - Z);
  return Math.min(dx, dz);
}

/**
 * Обложка. `front` — лицевая сторона передней крышки (медальон), иначе задняя.
 * X — от корешка, Z — от низа, единицы модели.
 */
function paintCover(
  c: Ctx,
  X: number,
  Z: number,
  k: number,
  n: V3,
  front: boolean,
): number | [number, number] {
  const { tier, pxu } = c;
  const lw = c.hi ? 1.8 * pxu : pxu;
  // Мягкий перелив по крышке: светлее к верхнему левому углу (ступенями палитры).
  k += (0.5 - X / W) * 0.05 + (Z / H - 0.5) * 0.06;
  // Паз у корешка: крышка сгибается здесь.
  if (X > 2.1 && X < 2.1 + lw) return k - 0.16;
  if (X >= 2.1 + lw && X < 2.1 + 2 * lw) k += 0.06;
  // Медальон: углубление, светлая кромка внизу-справа (стенка смотрит на свет), тёмная вверху-слева.
  const dxm = X - MED_X;
  const dzm = Z - MED_Z;
  const dm = Math.hypot(dxm, dzm);
  const ring = tier === 'simple' ? 0 : c.hi ? 1.3 : 1.0;
  if (front && dm < MED_R + ring + (tier === 'legend' ? 1.6 : 0)) {
    if (dm < MED_R - lw) return k * 0.82 - 0.06;
    if (dm < MED_R) {
      const lit = (dxm - dzm) / (dm || 1) > 0;
      return lit ? k + 0.12 : k - 0.22;
    }
    if (dm < MED_R + ring) {
      // Металлическое кольцо — выпуклое: свет сверху-слева.
      const up = (-dxm + dzm) / (dm || 1);
      return [
        P.metal,
        0.5 + up * 0.28 + shine(n, 0.2) + (c.pose.sheen !== null ? sheenK(c, X, Z) * 1.5 : 0),
      ];
    }
    // Светящийся знак легендарной — кольцо из рун вокруг медальона.
    const a = Math.atan2(dzm, dxm);
    const tick = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 16) % 2 === 0;
    const g = 0.45 + c.pose.sigil * 0.5 + (tick ? 0.1 : -0.1);
    return [P.glow, g];
  }
  // Камень эпической — над медальоном, оправа рисуется телом.
  // Рамка-тиснение.
  if (tier === 'simple') {
    const d = frameDist(X, Z, 4.2, 2.4);
    if (d > -lw && d < 0) k -= 0.16;
    else if (d >= 0 && d < lw) k += 0.06;
    // Потёртости: светлее у углов и кромок, пятна по шуму.
    const edge = Math.min(X, W - X, Z, H - Z);
    const nz = hash(Math.floor(X / (2 * pxu)), Math.floor(Z / (2 * pxu)), 7);
    if (edge < 1.6 && nz > 0.35) k += 0.1;
    else if (nz > 0.86) k += 0.06;
    else if (nz < 0.08) k -= 0.06;
    return k;
  }
  if (tier === 'rare') {
    // Холст: мелкое плетение.
    const ix = Math.floor(X / pxu);
    const iz = Math.floor(Z / pxu);
    if (((ix + iz) & 1) === 0) k += 0.035;
    const d = frameDist(X, Z, 4.4, 2.6);
    if (d > -lw && d < 0) return [P.metal, 0.42 + (n[0] < 0 ? 0.1 : 0) + sheenK(c, X, Z)];
    return k + sheenK(c, X, Z);
  }
  if (tier === 'epic') {
    const nz = hash(Math.floor(X / pxu), Math.floor(Z / pxu), 3);
    if (nz > 0.9) k += 0.05;
    const d = frameDist(X, Z, 4.4, 2.6);
    if (d > -lw && d < 0) return [P.gold, 0.55 + shine(n, 0.2) + sheenK(c, X, Z) * 1.5];
    return k + sheenK(c, X, Z);
  }
  // Легендарная: чёрная кожа, вставка из багровой кожи рамкой, золотые филёнки.
  const d = frameDist(X, Z, 4.2, 2.2);
  const band = c.hi ? 2.2 : 2.0;
  if (d > -lw && d < 0) return [P.gold, 0.6 + shine(n, 0.2) + sheenK(c, X, Z) * 1.5];
  if (d >= 0 && d < band) return [P.cover2, k * 0.95 + sheenK(c, X, Z)];
  if (d >= band && d < band + lw) return [P.gold, 0.5 + sheenK(c, X, Z) * 1.5];
  // Золотые точки-заклёпки в углах вставки.
  return k + sheenK(c, X, Z);
}

/** Полоса блика по лицу крышки (сверху-слева вниз-вправо). */
function sheenK(c: Ctx, X: number, Z: number): number {
  const s = c.pose.sheen;
  if (s === null) return 0;
  const u = (X / W + (1 - Z / H) * 0.8) / 1.8;
  const d = Math.abs(u - s);
  return d < 0.035 ? 0.2 : d < 0.08 ? 0.09 : 0;
}

// ---------------------------------------------------------------------------
// Сборка книги.
// ---------------------------------------------------------------------------

const ID = {
  back: 1,
  front: 2,
  block: 3,
  spine: 4,
  corner: 5,
  strap: 6,
  gem: 7,
  band: 9,
  hasp: 10,
  sheet: 20,
} as const;

/** Шарнир передней крышки: вертикаль у корешка по середине толщины крышки. */
const HINGE: V3 = [-W / 2, T / 2 - CB / 2, 0];
/** Шарнир застёжки: передняя кромка обреза. */
const STRAP_HINGE: V3 = [W / 2 + 0.55, T / 2 + 0.5, 0];

function cornerSolids(c: Ctx, yc: number, front: boolean): Solid[] {
  if (c.tier === 'simple') return [];
  const cs = c.tier === 'legend' ? 6.2 : 5.2;
  const out: Solid[] = [];
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const cx = sx < 0 ? -W / 2 + cs / 2 - 0.2 : W / 2 - cs / 2 + 0.25;
      const cz = sz < 0 ? cs / 2 - 0.25 : H - cs / 2 + 0.25;
      out.push(
        box([cx, yc, cz], [cs / 2 + 0.25, CB / 2 + 0.38, cs / 2 + 0.25], P.metal, ID.corner, {
          cuts: [[-sx, 0, -sz, 0.05]],
          noSeam: true,
          paint: (face, q, k, n) => {
            // Литая накладка: свет по грани, кант у подреза, заклёпка в углу.
            let kk = k * 0.72 + 0.04 + shine(n, 0.3);
            if (face >= 7) kk -= 0.12;
            if (c.pose.sheen !== null && (face === 2 || face === 3))
              kk += front ? 0.18 * bump(c.pose.sheen, 0.0, 1.0) : 0;
            const rx = q[0] * sx;
            const rz = q[2] * sz;
            if ((face === 2 || face === 3) && rx > 0.35 && rz > 0.35 && rx < 0.75 && rz < 0.75)
              kk += 0.18;
            return kk;
          },
        }),
      );
    }
  return out;
}

/** Книга в своей позе: список тел в мире (единицы модели). */
function bookSolids(c: Ctx): Solid[] {
  const o = c.pose;
  const tier = c.tier;
  const out: Solid[] = [];
  const W2 = W / 2;
  const xfB = bookXf(o);
  const xfF = chain(hingeZ(o.open, HINGE), xfB);

  // Задняя крышка.
  const yb = -T / 2 + CB / 2;
  out.push(
    place(
      box([0, yb, H / 2], [W2, CB / 2, H / 2], P.cover, ID.back, {
        cuts: tier === 'simple' ? frayCuts() : undefined,
        paint: (face, q, k, n) => {
          if (face === 3) {
            const X = (q[0] + 1) * W2;
            const Z = (q[2] + 1) * (H / 2);
            return paintCover(c, X, Z, k, n, false);
          }
          if (face === 2) return [P.paper, k * 0.9];
          return k - 0.06;
        },
      }),
      xfB,
    ),
  );
  for (const s of cornerSolids(c, yb, false)) out.push(place(s, xfB));

  // Блок страниц.
  const bw = (W - OV) / 2;
  const bt = T / 2 - CB;
  out.push(
    place(
      box([-OV / 2, 0, H / 2], [bw, bt, H / 2 - OV], P.paper, ID.block, {
        paint: (face, q, k) => paintBlock(c, face, q, k, bt),
      }),
      xfB,
    ),
  );

  // Корешок: полуцилиндр с бинтами.
  const spinePal = tier === 'legend' ? P.cover2 : P.cover;
  out.push(
    place(
      box([-W2, 0, H / 2], [SPD, T / 2 + 0.05, H / 2], spinePal, ID.spine, {
        round: 2,
        cuts: [[1, 0, 0, 0]],
        paint: (face, q, k) => {
          if (face === 4 || face === 5) return k - 0.1;
          const Z = (q[2] + 1) * (H / 2);
          for (const zb of SPINE_BANDS) {
            const dz = Z - zb * H;
            if (Math.abs(dz) < 1.2)
              return tier === 'legend'
                ? [P.gold, 0.5 + (dz > 0 ? 0.15 : -0.1)]
                : k + (dz > 0 ? 0.14 : -0.14);
          }
          return k;
        },
      }),
      xfB,
    ),
  );

  // Передняя крышка на шарнире.
  const yf = T / 2 - CB / 2;
  out.push(
    place(
      box([0, yf, H / 2], [W2, CB / 2, H / 2], P.cover, ID.front, {
        cuts: tier === 'simple' ? frayCuts() : undefined,
        paint: (face, q, k, n) => {
          if (face === 2) {
            const X = (q[0] + 1) * W2;
            const Z = (q[2] + 1) * (H / 2);
            return paintCover(c, X, Z, k, n, true);
          }
          if (face === 3) return paintEndpaper(c, q, k);
          return k - 0.06;
        },
      }),
      xfF,
    ),
  );
  for (const s of cornerSolids(c, yf, true)) out.push(place(s, xfF));

  // Листы на том же шарнире, что крышка: ложатся на раскрытую крышку стопкой.
  // Внешняя половина листа отстаёт от внутренней — лист гнётся.
  const pw = W - OV;
  const inner = pw * 0.45;
  o.sheets.forEach((a, k) => {
    if (a < 0.01) return;
    const ys = T / 2 - CB - 0.3 - k * 0.12;
    const zr = H / 2 - OV - 0.3;
    const xfI = chain(hingeZ(a, HINGE), xfB);
    const lag = a - 0.6 * Math.sin(a);
    const elbow: V3 = [-W / 2 + inner, ys, 0];
    const xfO = chain(chain(hingeZ(lag - a, elbow), hingeZ(a, HINGE)), xfB);
    const pagePaint = (x0: number, len: number) => (face: number, q: V3, k2: number) => {
      if (face !== 2 && face !== 3) return k2 - 0.1;
      const qx = ((x0 + ((q[0] + 1) / 2) * len) / pw) * 2 - 1;
      return paintPage(c, face === 2 ? qx : -qx, q[2], k2);
    };
    out.push(
      place(
        box([-W / 2 + inner / 2, ys, H / 2], [inner / 2, 0.22, zr], P.paper, ID.sheet + k, {
          paint: pagePaint(0, inner),
        }),
        xfI,
      ),
      place(
        box(
          [-W / 2 + inner + (pw - inner) / 2, ys, H / 2],
          [(pw - inner) / 2, 0.22, zr],
          P.paper,
          ID.sheet + k,
          {
            paint: pagePaint(inner, pw - inner),
          },
        ),
        xfO,
      ),
    );
  });

  // Камень эпической — над медальоном, в золотой оправе.
  if (tier === 'epic') {
    const gz = MED_Z + MED_R + 4.6;
    const gx = MED_X - W2;
    out.push(
      place(
        box([gx, T / 2 + 0.25, gz], [2.7, 0.55, 2.7], P.gold, ID.hasp, {
          cuts: octo(1.5),
          noSeam: true,
          paint: (_f, _q, k, n) => k + shine(n, 0.3),
        }),
        xfF,
      ),
      place(
        box([gx, T / 2 + 0.95, gz], [1.9, 0.9, 2.2], P.gem, ID.gem, {
          cuts: [
            ...octo(1.45),
            [1, 1.3, 0, 1.55],
            [-1, 1.3, 0, 1.55],
            [0, 1.3, 1, 1.55],
            [0, 1.3, -1, 1.55],
          ],
          noSeam: true,
          paint: (face, q, k, n) => {
            // Свет проходит камень насквозь: грани от света — с внутренним жаром.
            const through = Math.max(0, -dot(n, LIGHT)) * 0.35;
            let kk = 0.35 + k * 0.45 + through + shine(n, 0.45, 0.8, 0.92) + o.gem * 0.25;
            if (face === 2 && q[0] < -0.1 && q[2] > 0.1) kk += 0.2;
            return kk;
          },
        }),
        xfF,
      ),
    );
  }

  // Застёжка.
  out.push(...strapSolids(c, xfB, xfF));
  return out;
}

const SPINE_BANDS = [0.2, 0.4, 0.6, 0.8];

/** Восьмиугольник в плоскости x–z (подрезы углов бруса). */
function octo(d: number): [number, number, number, number][] {
  return [
    [1, 0, 1, d],
    [-1, 0, 1, d],
    [1, 0, -1, d],
    [-1, 0, -1, d],
  ];
}
/** Обтрёпанные углы простой: скошены у обреза. */
function frayCuts(): [number, number, number, number][] {
  return [
    [1, 0, 1, 1.9],
    [1, 0, -1, 1.88],
    [-1, 0, 1, 1.95],
  ];
}

/** Блок страниц: обрез и верх в линиях листов, лицевой лист — с текстом. */
function paintBlock(c: Ctx, face: number, q: V3, k: number, bt: number): number | [number, number] {
  const { tier, pose } = c;
  if (face === 0 || face === 4) {
    // Листы — линии вдоль крышки; через одну темнее.
    const y = ((q[1] + 1) / 2) * bt * 2;
    const step = c.hi ? 0.62 : 1.0;
    const line = Math.floor(y / step) % 2 === 0;
    let kk = k + (line ? -0.06 : 0.02);
    if (tier === 'simple') kk -= 0.08;
    const gilt = tier === 'legend' || tier === 'epic';
    if (pose.edge > 0) {
      // Свет изнутри — в щелях между листами.
      const g = pose.edge * (line ? 0.9 : 0.55);
      if (g > 0.25) return [P.glow, 0.35 + g * 0.65];
    }
    if (gilt) return [P.gold, 0.25 + kk * 0.55];
    return kk;
  }
  if (face === 2) return paintPage(c, q[0], q[2], k);
  return k - 0.1;
}

/** Страница: поля, строки, свет. qx −1 у корешка. */
function paintPage(c: Ctx, qx: number, qz: number, k: number): number | [number, number] {
  const { pose, pxu } = c;
  const X = ((qx + 1) / 2) * (W - OV);
  const Z = ((qz + 1) / 2) * (H - 2 * OV);
  let kk = k + 0.08;
  if (c.tier === 'simple') kk -= 0.06;
  // Строки: тонкие, через 2,4 пикселя, с полями.
  const lineStep = 2.4;
  const inText = X > 3.2 && X < W - OV - 2.6 && Z > 3.2 && Z < H - 2 * OV - 3.4;
  const onLine =
    inText &&
    Z % lineStep < pxu * (c.hi ? 1.3 : 1) &&
    hash(Math.floor(Z / lineStep), Math.floor(X / 3), 5) > 0.12;
  if (onLine) kk -= 0.22;
  if (pose.glow > 0) {
    // Страницы светятся цветом яруса: светлее к середине разворота.
    const mid = 1 - Math.abs(qz) * 0.5;
    const g = pose.glow * (0.6 + 0.4 * mid);
    if (onLine && c.tier !== 'simple') return [P.glow, 0.42 + g * 0.4];
    return [P.pglow, kk * 0.82 + g * 0.12];
  }
  return kk;
}

/** Форзац: изнанка передней крышки. */
function paintEndpaper(c: Ctx, q: V3, k: number): number | [number, number] {
  const X = ((q[0] + 1) / 2) * W;
  const Z = ((q[2] + 1) / 2) * H;
  // Кромка крышки, загнутая внутрь, — полоса материала по краю.
  if (X > W - 1.8 || Z < 1.6 || Z > H - 1.6) return [P.cover, k * 0.8];
  if (c.pose.glow > 0) return [P.pglow, k * 0.8 + c.pose.glow * 0.1];
  return [P.paper, k + 0.02];
}

/** Застёжка по ярусу: шнур на пуговице, ремешок с пряжкой, цепи (ремешки-пряжки с цепью). */
function strapSolids(c: Ctx, xfB: Xf, xfF: Xf): Solid[] {
  const o = c.pose;
  const tier = c.tier;
  const out: Solid[] = [];
  const xfS = chain(hingeZ(-o.strap, STRAP_HINGE), xfB);
  const yF = T / 2 + 0.5;
  const xE = W / 2 + 0.55;
  if (tier === 'simple') {
    // Шнур: обмотка вокруг обреза + конец с петлёй на пуговице.
    const zc = H / 2 - 0.5;
    const cord = (face: number, q: V3, k: number) => {
      const tw = Math.floor((q[0] * 3 + q[2] * 2 + q[1] * 2) * 2) % 2 === 0;
      return k + (tw ? 0.08 : -0.06);
    };
    out.push(
      place(
        box([xE, 0, zc], [0.5, T / 2 + 0.55, 0.6], P.strap, ID.strap, {
          paint: cord,
          noSeam: true,
        }),
        xfB,
      ),
      place(
        box([xE - 4.2, yF, zc], [4.2, 0.45, 0.6], P.strap, ID.strap, { paint: cord, noSeam: true }),
        xfS,
      ),
      place(
        box([xE - 8.2, yF - 0.05, zc], [1.3, 0.55, 1.3], P.metal, ID.hasp, {
          round: 1,
          noSeam: true,
          paint: (_f, _q, k, n) => k * 0.8 + 0.22 + shine(n, 0.35),
        }),
        xfF,
      ),
    );
    return out;
  }
  if (tier === 'legend') {
    // Две пряжки на цепях: цепь рисуется звеньями поверх (`chainLinks`), здесь — пластины.
    if (o.chains >= 1) return out;
    for (const zc of CHAIN_Z) {
      out.push(
        place(
          box([xE - 4.6, yF + 0.15, zc * H], [2.6, 0.6, 1.7], P.gold, ID.hasp, {
            cuts: [
              [-1, 0, 1, 1.5],
              [-1, 0, -1, 1.5],
            ],
            noSeam: true,
            paint: (face, q, k, n) => {
              let kk = k * 0.75 + 0.06 + shine(n, 0.3);
              // Скоба под звено цепи — тёмная щель у обреза.
              if (face === 2 && q[0] > 0.3 && q[0] < 0.7 && Math.abs(q[2]) < 0.35) kk = 0.08;
              return kk;
            },
          }),
          xfS,
        ),
      );
    }
    return out;
  }
  // Ремешок с пряжкой (редкая — серебро, эпическая — золото).
  const zc = H / 2 - 0.2;
  const sh = 2.3;
  const leather = (face: number, q: V3, k: number) => {
    // Строчка вдоль кромки ремешка.
    if ((face === 2 || face === 0) && Math.abs(q[2]) > 0.62 && Math.abs(q[2]) < 0.8)
      return k + 0.14;
    return k;
  };
  out.push(
    place(
      box([xE, 0, zc], [0.5, T / 2 + 0.55, sh], P.strap, ID.strap, {
        paint: leather,
        noSeam: true,
      }),
      xfB,
    ),
    place(
      box([xE - 3.6, yF, zc], [3.6, 0.45, sh], P.strap, ID.strap, { paint: leather, noSeam: true }),
      xfS,
    ),
    place(
      box([xE - 7.4, yF + 0.2, zc], [1.8, 0.65, sh + 0.9], P.metal, ID.hasp, {
        noSeam: true,
        cuts: [
          [-1, 0, 1, 1.6],
          [-1, 0, -1, 1.6],
        ],
        paint: (face, q, k, n) => {
          let kk = k * 0.75 + 0.06 + shine(n, 0.3);
          if (face === 2 && Math.abs(q[0] + 0.05) < 0.28 && Math.abs(q[2]) < 0.22) kk = 0.05;
          if (face === 2 && q[0] > 0.55) kk -= 0.1;
          return kk;
        },
      }),
      xfS,
    ),
  );
  return out;
}

/** Высоты цепей легендарной (доля высоты). */
const CHAIN_Z = [0.27, 0.73];

// ---------------------------------------------------------------------------
// Кадр: тела → пиксели → контур → свет и частицы.
// ---------------------------------------------------------------------------

interface Scene {
  c: Ctx;
  f: Frame;
  p: Px;
  pals: RGBA[][];
  ox: number;
  oy: number;
  /** Пиксели контура (1): частицы «позади» под ним не рисуются. */
  ol: Uint8Array;
  /** Глубина середины книги: что дальше неё — «позади», контур его закрывает. */
  deep: number;
  /** Пиксели самой книги (эпическая и легендарная): свет рисуется только вне их. */
  body?: Uint8Array;
}

/** Точка модели → холст: x, y, глубина (в пикселях холста). */
function scr(sc: Scene, p: V3): [number, number, number] {
  const [x, y, d] = project(p);
  const R = sc.c.RR;
  return [sc.ox + x * R, sc.oy + y * R, d * R];
}

/** Пиксель поверх с проверкой глубины: дальше тела — не рисуем. */
function put(sc: Scene, x: number, y: number, c: RGBA, depth?: number): void {
  x = Math.floor(x);
  y = Math.floor(y);
  const { f } = sc;
  if (x < 0 || y < 0 || x >= f.w || y >= f.h) return;
  const i = y * f.w + x;
  if (depth !== undefined) {
    if (f.pal[i] >= 0 && f.zb[i] > depth) return;
    if (sc.ol[i] && depth < sc.deep) return;
  }
  sc.p.set(x, y, c);
}

function render(
  tier: Tier,
  pose: Pose,
  res: Res,
  fx?: (sc: Scene) => void,
  opt: { parts?: Part[]; chains?: boolean } = {},
): Px {
  const parts = opt.parts;
  const cv = RES[res];
  const RR = cv.box / RES.s.box;
  const c: Ctx = { tier, pose, RR, pxu: 1 / RR, hi: res === 'l' };
  const f = newFrame(cv.cw, cv.ch);
  const pals = palsOf(tier);
  const ox = cv.bx + cv.box / 2;
  const oy = cv.by + Math.round(GROUND * RR);
  const solids = bookSolids(c).map((s) => scaleSolid(s, RR));
  drawSolids(f, solids, pals, ox, oy);
  if (parts?.length)
    drawParts(
      f,
      parts.map((pt) => ({
        ...pt,
        c: [pt.c[0] * RR, pt.c[1] * RR, pt.c[2] * RR],
        r: [pt.r[0] * RR, pt.r[1] * RR, pt.r[2] * RR],
      })),
      pals,
      ox,
      oy,
    );
  seams(f, 1.6 * RR, 1);
  rimLight(f, pals, (pl) => pl !== P.glow && pl !== P.pglow);
  if (pose.flash > 0) {
    for (let i = 0; i < f.w * f.h; i++)
      if (f.pal[i] >= 0)
        f.tone[i] = Math.min(pals[f.pal[i]].length - 1, f.tone[i] + Math.round(pose.flash * 3));
  }
  const p = toPx(f, pals);
  const ol = new Uint8Array(f.w * f.h);
  const before = new Uint8Array(f.w * f.h);
  for (let i = 0; i < f.w * f.h; i++) before[i] = p.data[i * 4 + 3] > 0 ? 1 : 0;
  selOutline(p, INK[tier], 0.8);
  for (let i = 0; i < f.w * f.h; i++) if (!before[i] && p.data[i * 4 + 3] > 0) ol[i] = 1;
  const sc: Scene = { c, f, p, pals, ox, oy, ol, deep: 0 };
  // Глубина «середины книги»: что дальше — позади неё (контур его закрывает).
  sc.deep = scr(sc, [pose.x, pose.y, pose.z + H / 2])[2];
  if (pose.alpha < 1) thin(sc, pose.alpha);
  if (pose.fade > 0) dissolve(sc, pose.fade);
  // Цепи легендарной на месте (в сцене открытия их ведёт сама сцена).
  if (tier === 'legend' && pose.chains === 0 && opt.chains !== false)
    for (const L of chainRest(pose)) link(sc, L.p, L.face, 0, pose.alpha);
  if (fx) fx(sc);
  return p;
}

/** Убрать пиксели книги шахматкой: остаётся доля `k`. Буфер кадра тоже чистится. */
function thin(sc: Scene, k: number): void {
  const { p, f } = sc;
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      const i = y * p.w + x;
      if (p.data[i * 4 + 3] === 0 || dith(x, y, k)) continue;
      p.data[i * 4 + 3] = 0;
      f.pal[i] = -1;
      f.zb[i] = -1e9;
      sc.ol[i] = 0;
    }
}

/**
 * Растворение снизу вверх светом: ниже кромки пусто, на кромке — полоса
 * света цвета яруса, край полосы шахматкой. Вписанная книга уходит в кирку.
 */
function dissolve(sc: Scene, k: number): void {
  const { p } = sc;
  let top = p.h;
  let bot = 0;
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++)
      if (p.data[(y * p.w + x) * 4 + 3] > 0) {
        top = Math.min(top, y);
        bot = Math.max(bot, y);
      }
  if (top > bot) return;
  const R = sc.c.RR;
  const band = 3 * R;
  const front = bot + 1 - k * (bot - top + 1 + band * 2);
  const ramp = GLOW[sc.c.tier].map((c) => hx(c));
  const N = ramp.length;
  for (let y = top; y <= bot; y++) {
    const d = y - front;
    if (d < -band) continue;
    for (let x = 0; x < p.w; x++) {
      const i = y * p.w + x;
      if (p.data[i * 4 + 3] === 0) continue;
      const gone = d > 0 && (d > 1.5 * R || dith(x, y, d / (1.5 * R)));
      if (gone) {
        p.data[i * 4 + 3] = 0;
        sc.f.pal[i] = -1;
        sc.f.zb[i] = -1e9;
        sc.ol[i] = 0;
        continue;
      }
      const c = ramp[d > -band * 0.4 ? N - 1 : d > -band * 0.75 ? N - 2 : N - 3];
      p.data[i * 4] = c[0];
      p.data[i * 4 + 1] = c[1];
      p.data[i * 4 + 2] = c[2];
    }
  }
}

// ---------------------------------------------------------------------------
// Кадр по имени полосы.
// ---------------------------------------------------------------------------

function parse(name: string): { kind: string; tier: Tier } {
  const tier = TIERS.find((t) => name.endsWith(`-${t}`));
  if (!tier) throw new Error(`книги: нет яруса в имени ${name}`);
  return { kind: name.slice(0, name.length - tier.length - 1), tier };
}

export function frame(name: string, i: number, res: Res, _v = 0): Px {
  const st = STRIPS[name];
  if (!st) throw new Error(`книги: нет полосы ${name}`);
  const { kind, tier } = parse(name);
  const t = i / FPS;
  if (kind === 'still') return idleFrame(tier, 0, res);
  if (kind === 'idle') return idleFrame(tier, i, res);
  // Последний кадр открытия — книга на полке, как кадр 0 покоя: сцена меняет полосу без скачка.
  if (kind === 'reveal')
    return i >= st.frames - 1
      ? idleFrame(tier, 0, res)
      : isHi(tier)
        ? revealFrameHi(tier, t, res)
        : revealFrame(tier, t, res);
  if (kind === 'apply-ok')
    return isHi(tier) ? applyFrameHi(tier, t, res) : applyFrame(tier, t, res);
  if (kind === 'apply-burn') return burnFrame(tier, t, res);
  throw new Error(`книги: неизвестная полоса ${name}`);
}

// ---------------------------------------------------------------------------
// Покой.
// ---------------------------------------------------------------------------

function idleFrame(tier: Tier, i: number, res: Res): Px {
  const n = fr(IDLE_T[tier]);
  const u = wrap(i, n) / n;
  const RR = RES[res].box / RES.s.box;
  const pose: Pose = { ...REST, sheets: [] };
  pose.z = -idleBob(tier, i, res) / RR;
  // Блик идёт по крышке раз за петлю, во второй половине.
  const s = (u - 0.42) / 0.36;
  pose.sheen = s > -0.1 && s < 1.15 ? s : null;
  if (tier === 'epic') pose.gem = bump(u, 0.1, 0.4);
  if (tier === 'legend') pose.sigil = 0.5 + 0.5 * Math.sin(u * Math.PI * 4);
  pose.edge = idleEdge(tier, u);
  return render(tier, pose, res, (sc) => {
    if (tier === 'rare' && bump(u, 0.12, 0.3) > 0) {
      // Искра на серебряном уголке.
      const p = bookPoint(pose, [W / 2 - 1, T / 2 + 0.5, H - 1]);
      star(sc, p, bump(u, 0.12, 0.3), GLOW.rare);
    }
    if (tier === 'epic' && bump(u, 0.12, 0.34) > 0) {
      const p = bookPoint(pose, [MED_X - W / 2 - 0.6, T / 2 + 2, MED_Z + MED_R + 5.4]);
      star(sc, p, bump(u, 0.12, 0.34), ['#ffffff', '#f8b0f2', '#e070e0']);
    }
    if (tier === 'legend') legendMotes(sc, pose, u);
  });
}

/** Сколько светится обрез в покое (кадр u петли). */
const idleEdge = (tier: Tier, u: number) =>
  tier === 'simple' || tier === 'rare' ? 0 : 0.18 + 0.12 * Math.sin(u * Math.PI * 2);

/**
 * Огоньки легендарной на орбите (кадр u петли покоя): дальняя половина — за книгой.
 * `k` < 1 — гаснут (открытие их зажигает, вписывание гасит).
 */
function legendMotes(sc: Scene, pose: Pose, u: number, k = 1): void {
  for (let j = 0; j < 5; j++) {
    if (k < 1 && (j + 0.5) / 5 > k) continue;
    const a = u * Math.PI * 2 + (j * Math.PI * 2) / 5;
    const pz = H * 0.5 + Math.sin(a * 2 + j) * 4 + pose.z;
    const p: V3 = [pose.x + Math.cos(a) * (W * 0.78), Math.sin(a) * (W * 0.5), pz];
    mote(sc, p, GLOW.legend, j % 2 === 0 ? 2 : 1);
  }
}

/** Точка книги (в своих координатах, крышка закрыта) → мир. */
function bookPoint(o: Pose, v: V3): V3 {
  return bookXf(o).p(v);
}

// ---------------------------------------------------------------------------
// Частицы и свет (поверх, с проверкой глубины).
// ---------------------------------------------------------------------------

/** Четырёхлучевая звёздочка: середина белая, лучи цвета яруса. */
function star(sc: Scene, p: V3, k: number, ramp: string[], depthTest = true): void {
  const [x, y, d] = scr(sc, p);
  const R = sc.c.RR;
  const L = Math.max(1, Math.round((1 + k * 2.2) * (R > 1 ? 1.8 : 1)));
  const c0 = hx(ramp[ramp.length - 1]);
  const c1 = hx(ramp[Math.max(0, ramp.length - 2)]);
  const c2 = hx(ramp[Math.max(0, ramp.length - 3)]);
  const dep = depthTest ? d : undefined;
  put(sc, x, y, c0, dep);
  for (let s = 1; s <= L; s++) {
    const c = s === 1 ? c1 : c2;
    put(sc, x + s, y, c, dep);
    put(sc, x - s, y, c, dep);
    put(sc, x, y + s, c, dep);
    put(sc, x, y - s, c, dep);
  }
  if (R > 1 && L > 2) {
    put(sc, x + 1, y + 1, c1, dep);
    put(sc, x - 1, y - 1, c1, dep);
    put(sc, x + 1, y - 1, c1, dep);
    put(sc, x - 1, y + 1, c1, dep);
  }
}

/** Огонёк: квадрат 1–2 пикселя (крупная — ×2), светлое ядро. */
function mote(sc: Scene, p: V3, ramp: string[], size: number, alpha = 255): void {
  const [x, y, d] = scr(sc, p);
  const s = Math.max(1, Math.round(size * (sc.c.RR > 1 ? 2 : 1)));
  const core = hx(ramp[ramp.length - 1], alpha);
  const rim = hx(ramp[Math.max(0, ramp.length - 3)], alpha);
  for (let yy = 0; yy < s; yy++)
    for (let xx = 0; xx < s; xx++)
      put(
        sc,
        x + xx - (s >> 1),
        y + yy - (s >> 1),
        s > 2 && (xx === 0 || yy === 0 || xx === s - 1 || yy === s - 1) ? rim : core,
        d,
      );
}

/** Звено цепи: кольцо (лицом) или планка (ребром), золото, свет сверху-слева. */
function link(sc: Scene, p: V3, faceOn: boolean, rot: number, alpha = 1): void {
  const [x, y, d] = scr(sc, p);
  const big = sc.c.RR > 1;
  const rx = big ? 3.2 : 1.7;
  const ry = faceOn ? (big ? 2.6 : 1.5) : big ? 1.1 : 0.6;
  const th = big ? 0.55 : 0.7;
  const gold = GOLD.map((c) => hx(c));
  const ca = Math.cos(rot);
  const sa = Math.sin(rot);
  const R = Math.ceil(rx + 1);
  for (let yy = -R; yy <= R; yy++)
    for (let xx = -R; xx <= R; xx++) {
      const u = (xx * ca + yy * sa) / rx;
      const v = (-xx * sa + yy * ca) / ry;
      const q = u * u + v * v;
      if (q > 1) continue;
      if (faceOn && q < th * th) continue;
      const px = x + xx;
      const py = y + yy;
      if (alpha < 1 && !dith(Math.floor(px), Math.floor(py), alpha)) continue;
      const lit = -u * 0.6 - v * 0.8;
      const tone = lit > 0.35 ? 6 : lit > 0 ? 5 : lit > -0.4 ? 4 : 3;
      put(sc, px, py, q > 0.75 ? gold[Math.max(1, tone - 2)] : gold[tone], d + 1);
    }
}

// ---------------------------------------------------------------------------
// Открытие (покупка, наковальня): падает с вращением → садится → застёжка →
// раскрывается на корешке → листы → свет из страниц → знак → закрывается.
// ---------------------------------------------------------------------------

const TURNS: Record<Tier, number> = { simple: 1, rare: 1.5, epic: 2, legend: 2.5 };
const SHEETS: Record<Tier, number> = { simple: 2, rare: 4, epic: 6, legend: 10 };
/** На сколько книга взлетает, раскрываясь (простая и редкая — стоят на полу). */
const AIR: Record<Tier, number> = { simple: 0, rare: 0, epic: 12, legend: 16 };
const Z_DROP = 38;
/** Угол раскрытой крышки: не совсем плашмя — книга стоит буквой V. */
const OPEN_A = Math.PI - 0.34;
/** Сдвиг раскрытой книги, чтобы разворот стоял посередине. */
const SPREAD_X = W * 0.5;

function sheetAngles(tier: Tier, t: number, t0: number, open: number): number[] {
  const n = SHEETS[tier];
  const gap = tier === 'legend' ? 0.045 : tier === 'epic' ? 0.07 : tier === 'rare' ? 0.09 : 0.13;
  const dur = tier === 'legend' ? 0.17 : 0.24;
  const out: number[] = [];
  for (let k = 0; k < n; k++) {
    const u = clamp01((t - (t0 + k * gap)) / dur);
    const e = u * u * (3 - 2 * u);
    const target = OPEN_A - 0.035 * (k + 1);
    out.push(Math.min(e * target, Math.max(0, open - 0.035 * (k + 1))));
  }
  return out;
}

function revealPose(tier: Tier, t: number): Pose {
  const R = REVEAL[tier];
  const o: Pose = { ...REST, sheets: [] };
  const air = AIR[tier];
  const T0 = R.T;
  o.pz = H / 2;
  // Падение: разгон вниз, вращение вокруг вертикали гаснет к посадке.
  if (t < R.land) {
    const u = t / R.land;
    o.z = Z_DROP * (1 - u * u);
    o.yaw = YAW0 + TURNS[tier] * Math.PI * 2 * (1 - u) * (1 - u);
    o.alpha = clamp01(t / 0.1 + 0.3);
    o.roll = 0.1 * Math.sin(u * Math.PI * 2) * (1 - u);
  } else {
    o.yaw = kf(t, [
      [R.snap, YAW0],
      [R.open + 0.06, 0],
      [R.close, 0],
      [R.close + 0.3, YAW0],
    ]);
  }
  // Посадка: сплющивание, отскок, успокоение.
  o.sq = kf(t, [
    [R.land, 1],
    [R.land + 0.05, 0.8, 'o'],
    [R.land + 0.13, 1.07],
    [R.land + 0.21, 0.97],
    [R.land + 0.29, 1],
  ]);
  // Ожидание: дрожь растёт до застёжки (у простой — нет).
  const shake = tier === 'rare' ? 0.035 : tier === 'epic' ? 0.06 : tier === 'legend' ? 0.09 : 0;
  if (shake > 0) {
    const a = R.land + 0.3;
    const g = t > a && t < R.snap ? ((t - a) / (R.snap - a)) ** 1.5 : 0;
    o.roll += shake * g * Math.sin(t * Math.PI * 2 * 13);
    o.x += shake * g * 14 * Math.sin(t * Math.PI * 2 * 17 + 1);
  }
  // Разворот к зрителю, сдвиг под разворот.
  o.x += kf(t, [
    [R.snap, 0],
    [R.open + 0.2, SPREAD_X],
    [R.close + 0.05, SPREAD_X],
    [R.close + 0.32, 0],
  ]);
  if (air > 0) {
    // Взлёт, наклон назад (разворот смотрит вверх-вперёд), висит, опускается.
    o.z += kf(t, [
      [R.snap - 0.05, 0],
      [R.open + 0.05, air, 'o'],
      [R.close + 0.1, air],
      [T0 - 0.28, 0, 'i'],
    ]);
    o.z += Math.sin((t - R.open) * Math.PI * 2 * 0.9) * 1.2 * bump(t, R.open, R.close + 0.1);
    o.lean = kf(t, [
      [R.snap, 0],
      [R.open + 0.08, -0.5],
      [R.close + 0.1, -0.5],
      [T0 - 0.3, 0],
    ]);
    o.sq *= kf(t, [
      [T0 - 0.28, 1],
      [T0 - 0.23, 0.9, 'o'],
      [T0 - 0.14, 1.03],
      [T0 - 0.04, 1],
    ]);
  }
  // Застёжка отходит от обреза и возвращается.
  const sOpen = tier === 'simple' ? 1.25 : 2.15;
  o.strap = kf(t, [
    [R.snap, 0],
    [R.snap + 0.1, sOpen + 0.18, 'o'],
    [R.snap + 0.18, sOpen - 0.1],
    [R.snap + 0.26, sOpen],
    [R.close + 0.06, sOpen],
    [R.lock, 0, 'i'],
  ]);
  o.chains = tier === 'legend' && t >= R.snap && t < R.lock ? 1 : 0;
  // Крышка: распахнулась с перелётом — захлопнулась с отскоком.
  o.open = kf(t, [
    [R.open, 0],
    [R.open + 0.16, OPEN_A + 0.12, 'o'],
    [R.open + 0.24, OPEN_A - 0.05],
    [R.open + 0.32, OPEN_A],
    [R.close, OPEN_A],
    [R.close + 0.15, 0, 'i'],
    [R.close + 0.19, 0.07],
    [R.close + 0.24, 0],
  ]);
  o.sheets = sheetAngles(tier, t, R.open + 0.2, o.open);
  // Свет: сперва в щелях обреза (от редкой), потом страницы.
  if (tier !== 'simple')
    o.edge = kf(t, [
      [R.land, 0],
      [R.snap, tier === 'rare' ? 0.45 : 0.75],
      [R.open + 0.1, 0.9],
      [R.open + 0.2, 0],
      [R.close + 0.12, 0],
      [R.close + 0.2, 0.6],
      [T0, idleEdge(tier, 0)],
    ]);
  const gMax = tier === 'simple' ? 0.35 : 1;
  o.glow = kf(t, [
    [R.open + 0.05, 0],
    [R.peak, gMax],
    [R.close, gMax * 0.75],
    [R.close + 0.14, 0],
  ]);
  if (tier === 'epic')
    o.gem = clamp01(bump(t, R.land + 0.2, R.snap + 0.2) * 1.2) * (0.6 + 0.4 * Math.sin(t * 40));
  if (tier === 'legend')
    o.sigil = Math.max(
      bump(t, R.land + 0.2, R.snap + 0.1) * (0.7 + 0.3 * Math.sin(t * 38)),
      // На замке знак вспыхивает и садится к свечению покоя.
      t > R.lock - 0.1
        ? kf(t, [
            [R.lock - 0.1, 0],
            [R.lock + 0.1, 0.85],
            [T0, 0.5],
          ])
        : 0,
    );
  const fl = tier === 'legend' ? 1 : tier === 'epic' ? 0.7 : tier === 'rare' ? 0.5 : 0.25;
  o.flash =
    fl *
    kf(t, [
      [R.peak - 0.05, 0],
      [R.peak, 1],
      [R.peak + 0.13, 0],
    ]);
  if (t >= T0 - 1e-6) return { ...REST, sheets: o.sheets.map(() => 0) };
  return o;
}

/** Середина разворота и куда смотрит разворот (в мире). */
function spreadOf(o: Pose): { c: V3; n: V3 } {
  const xf = bookXf(o);
  const c = xf.p([-W / 2, T / 2 + 0.6, H / 2]);
  const n = norm(xf.d([0, 1, 0]));
  return { c, n };
}

function revealFrame(tier: Tier, t: number, res: Res): Px {
  const R = REVEAL[tier];
  const o = revealPose(tier, t);
  const rr = TIER_R[tier];
  const glow = GLOW[tier];
  return render(
    tier,
    o,
    res,
    (sc) => {
      // Тень на полу, пока книга в воздухе (только по пустому).
      if (o.z > 0.6) shadow(sc, o);
      // Пыль от посадки (у простой — больше), у взлетающих — и от второй посадки.
      dust(sc, o, t - R.land, tier === 'simple' ? 1.25 : 1);
      if (AIR[tier] > 0) dust(sc, o, t - (R.T - 0.28), 0.7);
      // Искры посадки и щелчка застёжки (от редкой).
      if (rr >= 2) {
        const n = rr === 2 ? 4 : rr === 3 ? 6 : 8;
        for (let j = 0; j < n; j++) {
          const t0 = R.land + j * 0.035;
          const k = bump(t, t0, t0 + 0.3);
          if (k <= 0) continue;
          const a = hash(j, 3, rr) * Math.PI * 2;
          const rad = W * (0.55 + 0.35 * hash(j, 4, rr));
          star(
            sc,
            [o.x + Math.cos(a) * rad, Math.sin(a) * rad * 0.5, 4 + hash(j, 5, rr) * H],
            k,
            glow,
          );
        }
        const ks = bump(t, R.snap - 0.02, R.snap + 0.2);
        if (ks > 0 && tier !== 'legend')
          star(sc, bookXf(o).p([W / 2 - 4, T / 2 + 1.5, H / 2 + 2]), ks, [
            '#ffffff',
            ...glow.slice(-3).reverse(),
          ]);
      }
      // Свет из страниц: огоньки поднимаются с разворота.
      risingMotes(sc, tier, o, t, R.open + 0.08, R.close + 0.1);
      // Кольцо света по полу в пик (от редкой), у легендарной ещё и вспышка-кольцо.
      if (rr >= 2)
        ring(sc, spreadOf(o).c[0], t - R.peak + 0.04, 0.5, W * (rr === 2 ? 1.3 : 1.7), glow);
      // Брызги звёзд из разворота в пик.
      if (rr >= 2) {
        const n = rr === 2 ? 6 : rr === 3 ? 10 : 16;
        const sp = spreadOf(o);
        for (let j = 0; j < n; j++) {
          const u = (t - R.peak + 0.02) / 0.5;
          if (u <= 0 || u >= 1) continue;
          const a = (j / n) * Math.PI * 2 + hash(j, 9, rr) * 0.5;
          const rad = (6 + 26 * (1 - (1 - u) ** 2)) * (0.7 + 0.5 * hash(j, 8, rr));
          const p: V3 = [
            sp.c[0] + Math.cos(a) * rad,
            sp.c[1] + 3,
            sp.c[2] + Math.sin(a) * rad * 0.8 + 4,
          ];
          star(sc, p, (1 - u) * 0.9, glow, false);
        }
      }
    },
    { chains: false },
  );
}

/** Тень книги на полу — тёмный овал шахматкой, меньше и бледнее с высотой. */
function shadow(sc: Scene, o: Pose): void {
  const [x, y] = scr(sc, [o.x, 0, 0]);
  const R = sc.c.RR;
  const k = clamp01(1 - o.z / 50);
  const rx = W * 0.55 * k * R;
  const ry = rx * 0.28;
  const c = hx('#000000', 110);
  for (let yy = Math.floor(-ry); yy <= Math.ceil(ry); yy++)
    for (let xx = Math.floor(-rx); xx <= Math.ceil(rx); xx++) {
      const q = (xx / rx) ** 2 + (yy / ry) ** 2;
      if (q > 1) continue;
      const px = Math.floor(x + xx);
      const py = Math.floor(y + yy);
      if (!dith(px, py, 0.6 * k * (1 - q * 0.5))) continue;
      const i = py * sc.f.w + px;
      if (px < 0 || py < 0 || px >= sc.f.w || py >= sc.f.h || sc.p.data[i * 4 + 3] > 0) continue;
      sc.p.set(px, py, c);
    }
}

/** Клубы пыли от углов подошвы: катятся по полу наружу, светлые сверху-слева, тают шахматкой. */
function dust(sc: Scene, o: Pose, dt: number, amt: number): void {
  if (dt < 0 || dt > 0.6) return;
  const R = sc.c.RR;
  const dcol = DUST.map((c) => hx(c));
  const xf = bookXf({ ...o, sq: 1 });
  for (const side of [-1, 1])
    for (const front of [1, -1])
      for (let j = 0; j < 3; j++) {
        const life = 0.4 + j * 0.06;
        const u = (dt - j * 0.04) / life;
        if (u <= 0 || u >= 1) continue;
        const base = xf.p([side * (W / 2 - 2), front * (T / 2 - 1), 0]);
        const e = 1 - (1 - u) ** 2;
        const cx = base[0] + side * (2 + 6 * e * (1 + j * 0.5)) * amt;
        const cz = 0.8 + (1.2 + j * 0.8) * e;
        const rr =
          (1.2 + 2.2 * Math.sin(Math.min(1, u * 1.4) * Math.PI * 0.5)) * (1 - j * 0.25) * amt;
        // Клуб — три пузыря: большой и два поменьше по бокам.
        const blobs: [number, number, number][] = [
          [0, 0, rr],
          [side * rr * 0.9, -rr * 0.25, rr * 0.7],
          [-side * rr * 0.7, -rr * 0.35, rr * 0.55],
        ];
        const fade = u > 0.35 ? (u - 0.35) / 0.65 : 0;
        for (const [bx, bz, br] of blobs) {
          const [x, y, d] = scr(sc, [cx + bx, base[1] + front * 1.5, cz + bz + br * 0.6]);
          const r = br * R;
          for (let yy = Math.floor(-r); yy <= Math.ceil(r); yy++)
            for (let xx = Math.floor(-r); xx <= Math.ceil(r); xx++) {
              const q = (xx * xx + yy * yy) / (r * r);
              if (q > 1) continue;
              const px = Math.floor(x + xx);
              const py = Math.floor(y + yy);
              if (fade > 0 && dith(px, py, fade)) continue;
              const l = (-xx - yy * 1.2) / (r || 1);
              const tone = l > 0.55 ? 5 : l > 0.1 ? 4 : l > -0.5 ? 3 : 2;
              put(sc, px, py, dcol[tone], d);
            }
        }
      }
}

/** Кольцо на полу (z = 0): переднюю дугу видно поверх подошвы, задняя — за книгой. */
function ring(sc: Scene, cx: number, dt: number, life: number, Rmax: number, ramp: string[]): void {
  if (dt < 0 || dt > life) return;
  const u = dt / life;
  const rad = 6 + (Rmax - 6) * (1 - (1 - u) ** 2);
  const R = sc.c.RR;
  const th = R > 1 ? 2 : 1;
  const n = Math.ceil(rad * R * 7);
  const c0 = hx(ramp[ramp.length - 1]);
  const c1 = hx(ramp[Math.max(0, ramp.length - 3)]);
  for (let j = 0; j < n; j++) {
    const a = (j / n) * Math.PI * 2;
    const p: V3 = [cx + Math.cos(a) * rad, Math.sin(a) * rad * 0.55, 0.3];
    const [x, y, d] = scr(sc, p);
    for (let w = 0; w < th; w++) {
      const px = Math.floor(x);
      const py = Math.floor(y) - w;
      if (u > 0.45 && dith(px, py, (u - 0.45) / 0.55)) continue;
      put(sc, px, py, w === 0 ? c1 : c0, d);
    }
  }
}

/** Огоньки, что поднимаются из разворота (у простой — тёплая пыль без свечения). */
function risingMotes(sc: Scene, tier: Tier, o: Pose, t: number, a: number, b: number): void {
  if (t < a || t > b + 0.7) return;
  const n = tier === 'simple' ? 7 : tier === 'rare' ? 10 : tier === 'epic' ? 14 : 18;
  const xf = bookXf(o);
  const ramp = GLOW[tier];
  for (let j = 0; j < n * 2; j++) {
    const t0 = a + ((j + hash(j, 1, 7) * 0.8) / (n * 2)) * (b - a);
    const life = Math.min(0.75, b + 0.25 - t0);
    const u = (t - t0) / life;
    if (u <= 0 || u >= 1) continue;
    // Точка на развороте: левая страница (на крышке) или правая (блок).
    const lx = -W / 2 + (hash(j, 2, 7) * 2 - 1) * W * 0.85;
    const lz = 4 + hash(j, 3, 7) * (H - 8);
    const lp =
      lx < -W / 2 ? rotZ([lx, T / 2 - CB / 2, lz], o.open, HINGE) : ([lx, T / 2 - CB, lz] as V3);
    const p0 = xf.p(lp);
    const rise = 6 + 26 * u;
    const p: V3 = [p0[0] + Math.sin(u * 5 + j) * 2, p0[1] + 4 + 6 * u, p0[2] + rise];
    const sz = tier === 'simple' ? 1 : hash(j, 4, 7) > 0.6 ? 2 : 1;
    if (u > 0.6 && dith(Math.floor(p[0] * 7), Math.floor(p[2] * 5), (u - 0.6) / 0.4)) continue;
    mote(sc, p, tier === 'simple' ? ['#8a7c66', '#c8baa0', '#efe6d0'] : ramp, sz);
  }
}

/** Цепи легендарной: на месте; сорваны — звенья разлетаются и встают на орбиту; на замке — назад. */
function chainRest(o: Pose): { p: V3; face: boolean }[] {
  const xfB = bookXf(o);
  const xfS = chain(hingeZ(-o.strap, STRAP_HINGE), xfB);
  const out: { p: V3; face: boolean }[] = [];
  const xE = W / 2 + 0.55;
  for (const zc of CHAIN_Z) {
    const z = zc * H;
    // Три звена по крышке от скобы к обрезу, одно — на обрезе.
    for (let k = 0; k < 3; k++)
      out.push({
        p: xfS.p([xE - 1.7 + k * 0.0 - (2 - k) * 0 + (k - 1) * 0, T / 2 + 0.9, z]),
        face: k % 2 === 0,
      });
    out.push({ p: xfB.p([xE + 0.7, 0, z]), face: false });
  }
  // Разнести звенья по крышке: шаг 1,8.
  for (let c = 0; c < 2; c++)
    for (let k = 0; k < 3; k++) {
      const z = CHAIN_Z[c] * H;
      out[c * 4 + k].p = xfS.p([xE - 0.4 - (2 - k) * 1.75, T / 2 + 0.9, z]);
    }
  return out;
}

// ---------------------------------------------------------------------------
// Эпическая и легендарная: открытие заново (после отзыва владельца на v2.140).
// Свой ход позы и свои эффекты; простая и редкая идут прежним кодом байт в байт.
// Эпическая — тайная магия: пурпур с бирюзой, свет снизу (круг призыва на полу),
// спирали, острые искры. Легендарная — свет свыше: золото с багрянцем, портал-
// нимб сверху, лучи за книгой, руны на орбите, цепи рвутся и падают.
// Приёмы — `REFS.md`, раунд 2: слои во времени, свет вокруг предмета, а не на
// нём, ступени палитры вместо шахматки, искры с хвостом и затуханием.
// ---------------------------------------------------------------------------

type HiTier = 'epic' | 'legend';
const isHi = (t: Tier): t is HiTier => t === 'epic' || t === 'legend';

/** Вторая краска яруса: эпическая — бирюза (дополнение к пурпуру), легендарная — багрянец. */
const HI_ACC: Record<HiTier, string[]> = {
  epic: ['#071c26', '#0c3e4e', '#14707e', '#22aab4', '#6ee6e6', '#dcffff'],
  legend: ['#260408', '#560a12', '#92161e', '#cc2c26', '#f8643a', '#ffc690'],
};
/** Высота портала: книга выходит из него низом вперёд (что выше плоскости — ещё «там»). */
const PORTAL_Z: Record<HiTier, number> = { epic: 58, legend: 62 };

/** Пиксель эффекта: не ближе пикселя к краю холста (post.py), с проверкой глубины. */
function hp(sc: Scene, x: number, y: number, c: RGBA, depth?: number): void {
  x = Math.floor(x);
  y = Math.floor(y);
  if (x < 1 || y < 1 || x >= sc.f.w - 1 || y >= sc.f.h - 1) return;
  put(sc, x, y, c, depth);
}

/** Пиксель заднего плана: только там, где нет книги (свет идёт за ней и вокруг). */
function bg(sc: Scene, x: number, y: number, c: RGBA): void {
  x = Math.floor(x);
  y = Math.floor(y);
  if (x < 1 || y < 1 || x >= sc.f.w - 1 || y >= sc.f.h - 1) return;
  if (sc.body?.[y * sc.f.w + x]) return;
  sc.p.set(x, y, c);
}

const cols = (r: string[]) => r.map((s) => hx(s));
/** Ступень палитры с краю: 0 — самая светлая, дальше темнее. */
const tone = (c: RGBA[], step: number) =>
  c[Math.max(0, Math.min(c.length - 1, c.length - 1 - step))];

/**
 * Свет сгущается в книгу: пиксели книги ступенями переходят от силуэта цвета яруса
 * (тени и блики сохраняются — по яркости) к своим краскам. `k` 1 → 0.
 */
function condense(sc: Scene, k: number, ramp: string[]): void {
  const c = cols(ramp);
  const N = c.length;
  const s = Math.ceil(k * 6) / 6;
  if (s <= 0) return;
  const d = sc.p.data;
  for (let i = 0; i < sc.f.w * sc.f.h; i++) {
    if (!sc.body?.[i]) continue;
    const lum = (d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11) / 255;
    const tgt = c[Math.min(N - 1, Math.round((N - 1) * (0.45 + 0.55 * lum)))];
    const m = mixc([d[i * 4], d[i * 4 + 1], d[i * 4 + 2], 255], tgt, s);
    d[i * 4] = m[0];
    d[i * 4 + 1] = m[1];
    d[i * 4 + 2] = m[2];
  }
}

/** Контур книги загорается цветом яруса — свет из-за неё (подсветка краёв). */
function rimGlow(sc: Scene, k: number, ramp: string[]): void {
  if (k < 0.2) return;
  const c = cols(ramp);
  const col = k > 0.7 ? tone(c, 1) : k > 0.45 ? tone(c, 2) : tone(c, 3);
  for (let i = 0; i < sc.f.w * sc.f.h; i++)
    if (sc.ol[i]) {
      const x = i % sc.f.w;
      const y = (i / sc.f.w) | 0;
      sc.p.set(x, y, col);
    }
}

/**
 * Ореол вокруг книги: полосы цвета яруса от силуэта наружу, ступенями (ярче у края),
 * только по пустому. Ширина растёт с `k`.
 */
function aura(sc: Scene, k: number, ramp: string[], maxW: number): void {
  const R = sc.c.RR;
  const w = Math.round(k * maxW * R);
  if (w < 1 || !sc.body) return;
  const W0 = sc.f.w;
  const Hh = sc.f.h;
  const c = cols(ramp);
  let cur = Uint8Array.from(sc.body);
  for (let d = 1; d <= w; d++) {
    const nxt = Uint8Array.from(cur);
    const diag = d % 2 === 0;
    for (let y = 1; y < Hh - 1; y++)
      for (let x = 1; x < W0 - 1; x++) {
        const i = y * W0 + x;
        if (cur[i]) continue;
        let hit = cur[i - 1] || cur[i + 1] || cur[i - W0] || cur[i + W0];
        if (!hit && diag)
          hit = cur[i - W0 - 1] || cur[i - W0 + 1] || cur[i + W0 - 1] || cur[i + W0 + 1];
        if (!hit) continue;
        nxt[i] = 1;
        const f = d / w;
        const col = f <= 0.34 ? tone(c, k > 0.75 ? 2 : 3) : f <= 0.67 ? tone(c, 4) : tone(c, 5);
        bg(sc, x, y, col);
      }
    cur = nxt;
  }
}

/**
 * Толстое кольцо в горизонтальной плоскости (на полу или в воздухе на высоте `c[2]`):
 * внутренняя кромка светлее, `k` гасит его ступенями. Дальняя дуга — за книгой.
 */
function hring(
  sc: Scene,
  c: V3,
  r: number,
  th: number,
  k: number,
  ramp: string[],
  back = true,
  wall = 0,
): void {
  if (k <= 0.08 || r <= 0) return;
  const R = sc.c.RR;
  const col = cols(ramp);
  const dim = Math.round((1 - k) * 3);
  const n = Math.max(24, Math.ceil(r * R * 7));
  const m = Math.max(2, Math.ceil(th * R * 2));
  for (let s = 0; s < n; s++) {
    const a = (s / n) * Math.PI * 2;
    if (!back && Math.sin(a) < 0) continue;
    for (let q = 0; q <= m; q++) {
      const f = q / m;
      const rr = r - th / 2 + th * f;
      const [x, y, d] = scr(sc, [c[0] + Math.cos(a) * rr, c[1] + Math.sin(a) * rr, c[2]]);
      hp(sc, x, y, tone(col, (f < 0.3 ? 0 : f < 0.7 ? 1 : 2) + dim), d);
    }
    // Стенка света над внутренней кромкой: ярче у пола, вверх темнее ступенями.
    const wh = Math.round(wall * k * CE * R);
    if (wh < 1) continue;
    const [x, y, d] = scr(sc, [
      c[0] + Math.cos(a) * (r - th / 4),
      c[1] + Math.sin(a) * (r - th / 4),
      c[2],
    ]);
    for (let h = 1; h <= wh; h++)
      hp(sc, x, y - h, tone(col, (h <= wh * 0.4 ? 1 : h <= wh * 0.75 ? 2 : 3) + dim), d);
  }
}

/** Тень эпической и легендарной: сплошной овал в две ступени прозрачности, без шахматки. */
function shadowHi(sc: Scene, o: Pose): void {
  const [x, y] = scr(sc, [o.x, 0, 0]);
  const R = sc.c.RR;
  const k = clamp01(1 - o.z / 50);
  if (k <= 0.05) return;
  const rx = W * 0.55 * k * R;
  const ry = rx * 0.28;
  const inner = hx('#000000', Math.round(110 * k));
  const outer = hx('#000000', Math.round(60 * k));
  for (let yy = Math.floor(-ry); yy <= Math.ceil(ry); yy++)
    for (let xx = Math.floor(-rx); xx <= Math.ceil(rx); xx++) {
      const q = (xx / rx) ** 2 + (yy / ry) ** 2;
      if (q > 1) continue;
      bg(sc, x + xx, y + yy, q < 0.45 ? inner : outer);
    }
}

/** Отрезок в мире, точками с глубиной. */
function wline(sc: Scene, a: V3, b: V3, c: RGBA): void {
  const pa = scr(sc, a);
  const pb = scr(sc, b);
  const n = Math.max(2, Math.ceil(Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) * 1.5));
  for (let s = 0; s <= n; s++) {
    const u = s / n;
    hp(sc, lerp(pa[0], pb[0], u), lerp(pa[1], pb[1], u), c, lerp(pa[2], pb[2], u));
  }
}

/** Ромбик (острая искра): `L` — полудлина. */
function diamond(
  sc: Scene,
  x: number,
  y: number,
  L: number,
  c0: RGBA,
  c1: RGBA,
  depth?: number,
): void {
  for (let yy = -L; yy <= L; yy++)
    for (let xx = -L; xx <= L; xx++) {
      const m = Math.abs(xx) + Math.abs(yy);
      if (m > L) continue;
      hp(sc, x + xx, y + yy, m < L ? c0 : c1, depth);
    }
}

/**
 * Четырёхлучевая звезда: горячая белая середина, лучи сужаются и темнеют к концам
 * (сдвиг тона к краю). `k` — размер 0…1.
 */
function star4(sc: Scene, x: number, y: number, k: number, ramp: string[], depth?: number): void {
  if (k <= 0.05) return;
  const R = sc.c.RR;
  const c = cols(ramp);
  const L = Math.max(1, Math.round(k * (R > 1 ? 7 : 3.2)));
  const core = R > 1 && k > 0.5 ? 1 : 0;
  for (let yy = -core; yy <= core; yy++)
    for (let xx = -core; xx <= core; xx++) hp(sc, x + xx, y + yy, tone(c, 0), depth);
  for (let s = 1; s <= L; s++) {
    const f = s / L;
    const col = tone(c, f < 0.34 ? 0 : f < 0.67 ? 1 : 2);
    const wd = R > 1 && f < 0.4 ? 1 : 0;
    for (let q = -wd; q <= wd; q++) {
      hp(sc, x + s + core, y + q, col, depth);
      hp(sc, x - s - core, y + q, col, depth);
      hp(sc, x + q, y + s + core, col, depth);
      hp(sc, x + q, y - s - core, col, depth);
    }
  }
}

/** Искра: голова 1–3 пикселя и короткий хвост против скорости (экранной), тон по возрасту. */
function sparkPx(
  sc: Scene,
  p: V3,
  v: V3,
  age: number,
  ramp: string[],
  size = 1,
  depth = true,
): void {
  if (age < 0 || age >= 1) return;
  const R = sc.c.RR;
  const c = cols(ramp);
  const [x, y, d] = scr(sc, p);
  const [x2, y2] = scr(sc, sub(p, [v[0] * 0.06, v[1] * 0.06, v[2] * 0.06]));
  const step = age < 0.25 ? 0 : age < 0.55 ? 1 : age < 0.8 ? 2 : 3;
  const dep = depth ? d : undefined;
  const s = Math.max(1, Math.round(size * (R > 1 ? 2 : 1) * (age < 0.8 ? 1 : 0.6)));
  const dx = x2 - x;
  const dy = y2 - y;
  const dl = Math.hypot(dx, dy);
  const len = Math.min(dl, (R > 1 ? 12 : 5) * (1 - age * 0.5));
  // Хвост — против скорости, темнее к концу; медленная искра — крестик.
  if (len >= 1.5) {
    const ux = dx / dl;
    const uy = dy / dl;
    for (let q = 1; q <= len; q++) {
      const f = q / len;
      hp(sc, x + ux * q, y + uy * q, tone(c, step + (f < 0.45 ? 1 : 2)), dep);
    }
  } else if (age < 0.8) {
    const o = (s >> 1) + 1;
    const ct = tone(c, step + 1);
    hp(sc, x - o, y, ct, dep);
    hp(sc, x + s - (s >> 1), y, ct, dep);
    hp(sc, x, y - o, ct, dep);
    hp(sc, x, y + s - (s >> 1), ct, dep);
  }
  for (let yy = 0; yy < s; yy++)
    for (let xx = 0; xx < s; xx++) hp(sc, x + xx - (s >> 1), y + yy - (s >> 1), tone(c, step), dep);
}

/** Искра с сопротивлением и тяжестью: где она через `a` секунд. */
function ballistic(p: V3, v: V3, a: number, drag: number, g: number): { p: V3; v: V3 } {
  const e = Math.exp(-drag * a);
  const f = drag > 0 ? (1 - e) / drag : a;
  return {
    p: [p[0] + v[0] * f, p[1] + v[1] * f, p[2] + v[2] * f - 0.5 * g * a * a],
    v: [v[0] * e, v[1] * e, v[2] * e - g * a],
  };
}

/** Кольцо искр по полу от точки `c`: разлёт с торможением, чуть вверх. */
function floorBurst(
  sc: Scene,
  c: V3,
  dt: number,
  n: number,
  speed: number,
  ramp: string[],
  seed: number,
  life = 0.6,
): void {
  if (dt < 0 || dt > life) return;
  for (let j = 0; j < n; j++) {
    const a = (j / n) * Math.PI * 2 + hash(j, seed, 1) * 0.3;
    const sp = speed * (0.75 + 0.5 * hash(j, seed, 2));
    const v: V3 = [Math.cos(a) * sp, Math.sin(a) * sp * 0.8, 10 + 14 * hash(j, seed, 3)];
    const b = ballistic([c[0] + Math.cos(a) * 4, c[1] + Math.sin(a) * 3, c[2] + 1], v, dt, 4.5, 60);
    if (b.p[2] < 0) continue;
    sparkPx(sc, b.p, b.v, dt / life, ramp, j % 3 === 0 ? 1.5 : 1);
  }
}

/** Фонтан искр вверх из точки (тяжесть тянет назад, хвосты по скорости). */
function fountain(
  sc: Scene,
  c: V3,
  dt: number,
  n: number,
  ramp: string[],
  seed: number,
  spread = 1,
): void {
  for (let j = 0; j < n; j++) {
    const t0 = hash(j, seed, 4) * 0.18;
    const life = 0.7 + 0.35 * hash(j, seed, 5);
    const a = dt - t0;
    if (a < 0 || a > life) continue;
    const ang = hash(j, seed, 6) * Math.PI * 2;
    const r = (0.35 + 0.65 * hash(j, seed, 7)) * 22 * spread;
    const v: V3 = [Math.cos(ang) * r, Math.sin(ang) * r * 0.6, 48 + 26 * hash(j, seed, 8)];
    const b = ballistic(c, v, a, 1.6, 70);
    sparkPx(sc, b.p, b.v, a / life, ramp, j % 4 === 0 ? 1.5 : 1, false);
  }
}

/**
 * Луч света из разворота вверх: белое ядро, 3 полосы цвета яруса, края ступенями с
 * колебанием на пиксель по строкам, мерцание шириной, внутри — штрихи и огоньки,
 * бегущие вверх. Растёт из страниц, умирает сужением (ядро гаснет последним).
 * Только по пустому — книга остаётся читаемой.
 */
function beam(
  sc: Scene,
  o: Pose,
  t: number,
  a: number,
  b: number,
  ramp: string[],
  acc: string[],
  seed: number,
): void {
  if (t <= a || t >= b) return;
  const R = sc.c.RR;
  const c = cols(ramp);
  const ca = cols(acc);
  const grow = clamp01((t - a) / 0.32);
  const die = clamp01((b - t) / 0.3);
  const ge = 1 - (1 - grow) ** 3;
  const de = die * die * (3 - 2 * die);
  const flick = Math.sin(t * 37) > 0.55 ? 1 : 0;
  const w = (W * 0.46 * R + flick) * ge * de;
  if (w < 0.6) return;
  const sp = spreadOf(o);
  const [cx, cy] = scr(sc, sp.c);
  const y0 = Math.floor(cy);
  const topFull = 2;
  const reach = lerp(y0, topFull, ge);
  const span = Math.max(1, y0 - reach);
  // Верх луча — рваный: каждый столбец кончается на своей высоте (ядро выше всех,
  // края ниже, волна бежит), у конца столбца тон на ступень-две темнее. Так луч
  // уходит вверх струями и тает, а не упирается в край холста и не сходится в остриё.
  const colTop = (x: number, f: number) =>
    reach +
    span * (0.04 + 0.3 * f * f + 0.1 * (0.5 + 0.5 * Math.sin((x / R) * 0.9 + t * 7 + seed)));
  for (let y = Math.max(topFull, Math.floor(reach)); y <= y0; y++) {
    // Низ луча у самых страниц шире — свет выходит из разворота.
    const foot = 1 + 0.25 * clamp01(1 - (y0 - y) / (6 * R));
    const wob = Math.round(Math.sin(y * 0.33 + t * 11) * 0.9);
    const hw = w * foot;
    const hh = hw * 1.3 + R;
    for (let x = Math.floor(cx - hh - 1); x <= Math.ceil(cx + hh + 1); x++) {
      const dx = Math.abs(x + 0.5 - cx - wob * 0.5);
      if (dx > hh) continue;
      const f = dx / Math.max(0.5, hw);
      const d = (y - colTop(x, Math.min(1.3, f))) / R;
      if (d < 0) continue;
      const fade = d < 3 ? 2 : d < 8 ? 1 : 0;
      // Ядро гаснет последним: при смерти полосы снаружи уходят первыми.
      const band = f < 0.24 * (0.6 + 0.4 * de) ? 0 : f < 0.5 ? 1 : f < 0.76 ? 2 : f <= 1 ? 3 : 4;
      bg(sc, x, y, tone(c, band + fade));
    }
  }
  // Штрихи вверх по ядру и огоньки по краям.
  const H0 = y0 - topFull;
  for (let j = 0; j < 9; j++) {
    const ph = wrap(t * (1.6 + hash(j, seed, 1)) + hash(j, seed, 2), 1);
    const y = y0 - ph * H0;
    if (y < reach + 2) continue;
    const xo = (hash(j, seed, 3) - 0.5) * w * 1.2;
    const len = Math.round((R > 1 ? 7 : 3) + hash(j, seed, 4) * (R > 1 ? 6 : 3));
    for (let q = 0; q < len; q++) bg(sc, cx + xo, y + q, tone(c, q < 2 ? 0 : 1));
  }
  for (let j = 0; j < 7; j++) {
    const ph = wrap(t * (0.7 + 0.4 * hash(j, seed, 5)) + hash(j, seed, 6), 1);
    const y = y0 - ph * H0 * 0.85;
    if (y < reach + 2) continue;
    const side = j % 2 ? 1 : -1;
    const x = cx + side * (w + 1.5 * R + Math.sin(ph * 9 + j) * 2 * R);
    const s = R > 1 ? 2 : 1;
    const col = ph < 0.6 ? tone(ca, 1) : tone(ca, 2);
    for (let yy = 0; yy < s; yy++) for (let xx = 0; xx < s; xx++) bg(sc, x + xx, y + yy, col);
  }
}

/**
 * Волна света в пик: кольцо вокруг разворота в плоскости экрана, расходится с
 * торможением, толщина и тон убывают ступенями. Только по пустому — за книгой.
 */
function burstRing(
  sc: Scene,
  cx: number,
  cy: number,
  u: number,
  rMax: number,
  ramp: string[],
  thMax = 5,
): void {
  if (u <= 0 || u >= 1) return;
  const R = sc.c.RR;
  const c = cols(ramp);
  const r = rMax * R * (1 - (1 - u) ** 3);
  const th = Math.max(1, (1 - u) * thMax * R);
  const step = u < 0.3 ? 0 : u < 0.55 ? 1 : u < 0.8 ? 2 : 3;
  const ro = r + th;
  for (let y = Math.floor(cy - ro * 0.8); y <= Math.ceil(cy + ro * 0.8); y++)
    for (let x = Math.floor(cx - ro); x <= Math.ceil(cx + ro); x++) {
      const q = Math.hypot(x + 0.5 - cx, (y + 0.5 - cy) / 0.8);
      if (q < r - th || q > r + th) continue;
      const e = Math.abs(q - r) / th;
      bg(sc, x, y, tone(c, step + (e < 0.35 ? 0 : e < 0.7 ? 1 : 2)));
    }
}

/**
 * Лучи за книгой (свет свыше, легендарная): клинья от разворота, светлая ось у
 * главных, тон по длине ступенями. Растут наружу (`grow`), гаснут ступенями (`k`).
 */
function rays(sc: Scene, o: Pose, grow: number, k: number, rot: number, ramp: string[]): void {
  if (k <= 0 || grow <= 0) return;
  const R = sc.c.RR;
  const c = cols(ramp);
  const [cx, cy] = scr(sc, add(spreadOf(o).c, [0, 0, 4]));
  const n = 12;
  const Lmax = 70 * R * (1 - (1 - grow) ** 3);
  const dim = k > 0.7 ? 0 : k > 0.4 ? 1 : 2;
  for (let j = 0; j < n; j++) {
    const main = j % 2 === 0;
    const a0 = rot * (main ? 1 : -0.6) + (j / n) * Math.PI * 2;
    const L = Lmax * (main ? 1 : 0.62);
    const ca = Math.cos(a0);
    const sa = Math.sin(a0);
    for (let r = 5 * R; r < L; r += 0.6) {
      const f = r / L;
      // Тонкий луч: шире к середине длины, к концу сходится; тон светлый, к концу — на две ступени темнее.
      const half = (main ? 1.4 : 0.8) * R * Math.sin(Math.PI * Math.min(1, 0.15 + f * 0.85)) + 0.3;
      const base = f < 0.4 ? 1 : f < 0.75 ? 2 : 3;
      for (let q = -half; q <= half; q += 0.6) {
        const axis = Math.abs(q) > half * 0.55 ? 1 : 0;
        bg(sc, cx + ca * r - sa * q, cy + sa * r * 0.9 + ca * q, tone(c, base + axis + dim));
      }
    }
  }
}

/**
 * Круг призыва эпической на полу: два кольца, шесть ромбов-знаков бирюзой между ними
 * и две встречно вращающиеся тройки хорд (шестиконечная звезда). `k` — накал.
 */
function arcaneCircle(
  sc: Scene,
  cx: number,
  k: number,
  rot: number,
  ramp: string[],
  acc: string[],
): void {
  if (k <= 0) return;
  const Rr = W * 1.02;
  const ri = Rr * 0.7;
  const kk = Math.min(1, k);
  hring(sc, [cx, 0, 0], Rr, 2.2, kk * 0.8, ramp);
  hring(sc, [cx, 0, 0], ri, 1, kk * 0.65, ramp);
  const c = cols(ramp);
  const ca = cols(acc);
  const dim = Math.round((1 - kk) * 3);
  for (let tri = 0; tri < 2; tri++) {
    const r0 = tri ? -rot * 0.7 : rot;
    for (let s = 0; s < 3; s++) {
      const a = r0 + tri * (Math.PI / 3) + (s / 3) * Math.PI * 2;
      const b = a + (Math.PI * 2) / 3;
      wline(
        sc,
        [cx + Math.cos(a) * ri, Math.sin(a) * ri, 0],
        [cx + Math.cos(b) * ri, Math.sin(b) * ri, 0],
        tone(c, 3 + dim),
      );
    }
  }
  const R = sc.c.RR;
  for (let s = 0; s < 6; s++) {
    const a = -rot * 0.5 + (s / 6) * Math.PI * 2;
    const rm = (Rr + ri) / 2;
    const [x, y, d] = scr(sc, [cx + Math.cos(a) * rm, Math.sin(a) * rm, 0]);
    diamond(sc, x, y, R > 1 ? 2 : 1, tone(ca, dim), tone(ca, 2 + dim), d);
  }
}

/** Знак-руна 5×7 (легендарная): по строкам, `#` — штрих. */
const GLYPHS = [
  ['#.#.#', '#.#.#', '.###.', '..#..', '..#..', '..#..', '..#..'],
  ['..#..', '.#.#.', '#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
  ['###..', '#..#.', '#..#.', '###..', '#.#..', '#..#.', '#...#'],
  ['..#..', '.###.', '#.#.#', '..#..', '..#..', '..#..', '..#..'],
  ['#...#', '##.##', '#.#.#', '##.##', '#...#', '#...#', '#...#'],
  ['..#..', '.#.#.', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
];

/**
 * Руны на наклонной орбите вокруг книги: светлое ядро, ореол цвета яруса; дальняя
 * половина темнее и прячется за книгой (буфер глубины). `k` — проявление ступенями.
 */
function runeOrbit(sc: Scene, o: Pose, t: number, k: number, ramp: string[]): void {
  if (k <= 0) return;
  const R = sc.c.RR;
  const s = R > 1 ? 2 : 1;
  const c = cols(ramp);
  const sp = spreadOf(o);
  const cz = o.z + H * 0.55;
  for (let j = 0; j < GLYPHS.length; j++) {
    const a = t * 1.5 + (j / GLYPHS.length) * Math.PI * 2;
    const p: V3 = [
      sp.c[0] + Math.cos(a) * W * 1.15,
      Math.sin(a) * W * 0.75,
      cz + Math.sin(a + 0.9) * 5,
    ];
    const [x, y, d] = scr(sc, p);
    const far = Math.sin(a) < 0;
    const coreC = k < 0.34 ? null : tone(c, far ? 2 : k < 0.67 ? 1 : 0);
    const haloC = tone(c, far ? 4 : 3);
    const g = GLYPHS[j];
    const on = (gx: number, gy: number) =>
      gy >= 0 && gy < 7 && gx >= 0 && gx < 5 && g[gy][gx] === '#';
    const blk = (gx: number, gy: number, col: RGBA) => {
      for (let yy = 0; yy < s; yy++)
        for (let xx = 0; xx < s; xx++) hp(sc, x + (gx - 2) * s + xx, y + (gy - 3) * s + yy, col, d);
    };
    for (let gy = -1; gy <= 7; gy++)
      for (let gx = -1; gx <= 5; gx++)
        if (!on(gx, gy) && (on(gx - 1, gy) || on(gx + 1, gy) || on(gx, gy - 1) || on(gx, gy + 1)))
          blk(gx, gy, haloC);
    if (coreC)
      for (let gy = 0; gy < 7; gy++)
        for (let gx = 0; gx < 5; gx++) if (on(gx, gy)) blk(gx, gy, coreC);
  }
}

/** Крупное звено цепи (легендарная): кольцо лицом или планка ребром; `dim` — ступени темнее. */
function linkHi(
  sc: Scene,
  p: V3,
  faceOn: boolean,
  rot: number,
  dim = 0,
  glow = 0,
  sz = 1.25,
): void {
  const [x, y, d] = scr(sc, p);
  const big = sc.c.RR > 1;
  const rx = (big ? 3.2 : 1.7) * sz;
  const ry = (faceOn ? (big ? 2.6 : 1.5) : big ? 1.1 : 0.6) * sz;
  const th = big ? 0.55 : 0.7;
  const gold = GOLD.map((c) => hx(c));
  const hot = cols(GLOW.legend);
  const ca = Math.cos(rot);
  const sa = Math.sin(rot);
  const Rb = Math.ceil(rx + 1);
  for (let yy = -Rb; yy <= Rb; yy++)
    for (let xx = -Rb; xx <= Rb; xx++) {
      const u = (xx * ca + yy * sa) / rx;
      const v = (-xx * sa + yy * ca) / ry;
      const q = u * u + v * v;
      if (q > 1 || (faceOn && q < th * th)) continue;
      const lit = -u * 0.6 - v * 0.8;
      let tn = (lit > 0.35 ? 6 : lit > 0 ? 5 : lit > -0.4 ? 4 : 3) - dim;
      if (q > 0.75) tn -= 2;
      if (tn < 1) continue;
      const col =
        glow > 0.15
          ? tone(hot, Math.round((1 - glow) * 2 + (6 - tn) * 0.5))
          : gold[Math.min(6, tn)];
      hp(sc, x + xx, y + yy, col, d + 1);
    }
}

/**
 * Цепи легендарной: натянуты и дрожат → на `snap` скобы лопаются с искрами, звенья
 * летят дугами, бьются об пол один раз и гаснут ступенями → к `lock` новые звенья
 * сгущаются из света на скобах.
 */
function chainsHiRest(sc: Scene, o: Pose, t: number): void {
  const R = REVEAL.legend;
  if (t >= R.snap) return;
  // Натянуты и дрожат всё чаще; рисуются до сгущения — светятся вместе с книгой.
  const g = clamp01((t - R.land - 0.4) / (R.snap - R.land - 0.4));
  chainRest(o).forEach((L, j) => {
    const jit = g > 0 ? Math.sin(t * 95 + j * 2) * 0.6 * g * g : 0;
    link(sc, add(L.p, [jit * 0.4, 0, jit]), L.face, 0);
  });
}

function chainsHi(sc: Scene, o: Pose, t: number): void {
  const R = REVEAL.legend;
  if (t < R.snap) return;
  const now = chainRest(o);
  const rest = chainRest(revealPoseHi('legend', R.snap - 0.001));
  const dt = t - R.snap;
  rest.forEach((L, j) => {
    // Разлёт веером от скоб: вправо-вверх и к зрителю, часть — назад над книгой.
    const v: V3 = [-8 + 38 * hash(j, 31, 1), 4 + 12 * hash(j, 31, 2), 34 + 16 * hash(j, 31, 3)];
    const g = 140;
    // До пола: z(t) = z0 + vz t − g t²/2 = 0.
    const tf = (v[2] + Math.sqrt(v[2] * v[2] + 2 * g * L.p[2])) / g;
    let p: V3;
    let a = dt;
    if (dt <= tf)
      p = [L.p[0] + v[0] * dt, L.p[1] + v[1] * dt, L.p[2] + v[2] * dt - 0.5 * g * dt * dt];
    else {
      const vz = (v[2] - g * tf) * -0.38;
      const d2 = dt - tf;
      const base: V3 = [L.p[0] + v[0] * tf, L.p[1] + v[1] * tf, 0];
      p = [
        base[0] + v[0] * 0.45 * d2,
        base[1] + v[1] * 0.45 * d2,
        Math.max(0, vz * d2 - 0.5 * g * d2 * d2),
      ];
      a = tf + d2 * 0.4;
    }
    const fade = clamp01((dt - tf - 0.3) / 0.36);
    if (fade >= 1) return;
    // Сорванное звено сперва раскалено добела, за 0,3 с остывает до золота.
    const hot = 1 - clamp01(dt / 0.3);
    linkHi(sc, p, (j + Math.floor(a * 9)) % 2 === 0, a * 13 + j, Math.round(fade * 4), hot, 1.5);
  });
  // Искры разрыва на скобах.
  for (const zc of CHAIN_Z) {
    const hp0 = bookXf(o).p([W / 2 - 3.5, T / 2 + 1.5, zc * H]);
    const [x, y] = scr(sc, hp0);
    const kb = 1 - clamp01(dt / 0.32);
    if (kb > 0) star4(sc, x, y, Math.min(1, kb * 1.3), GLOW.legend);
    for (let j = 0; j < 8; j++) {
      const ang = (j / 8) * Math.PI * 2 + zc * 3;
      const b = ballistic(hp0, [Math.cos(ang) * 55, 14, Math.sin(ang) * 55 + 12], dt, 5, 60);
      sparkPx(
        sc,
        b.p,
        b.v,
        dt / 0.5,
        j % 2 ? GLOW.legend : HI_ACC.legend,
        j % 3 === 0 ? 1.5 : 1,
        false,
      );
    }
  }
  // Новые звенья сгущаются из света к замку; после — обычные, как в покое.
  const kl = clamp01((t - (R.lock - 0.3)) / 0.3);
  if (kl >= 1) for (const L of now) link(sc, L.p, L.face, 0);
  else if (kl > 0)
    for (const L of now)
      if (dith(Math.floor(L.p[0] * 3), Math.floor(L.p[2] * 3), kl * 1.6))
        linkHi(sc, L.p, L.face, 0, 0, 1 - kl, 1);
  const ks = bump(t, R.lock - 0.05, R.lock + 0.3);
  if (ks > 0)
    for (const zc of CHAIN_Z) {
      const [x, y] = scr(sc, bookXf(o).p([W / 2 - 3.5, T / 2 + 1.5, zc * H]));
      star4(sc, x, y, ks * 0.8, GLOW.legend);
    }
}

/** Спираль огоньков вокруг книги (эпическая): сходятся к книге, поднимаясь. */
function spiral(
  sc: Scene,
  o: Pose,
  t: number,
  a: number,
  b: number,
  n: number,
  ramp: string[],
  inward: boolean,
): void {
  if (t <= a || t >= b) return;
  const k = Math.min(clamp01((t - a) / 0.2), clamp01((b - t) / 0.2));
  const sp = spreadOf(o);
  for (let j = 0; j < n; j++) {
    const life = 0.9;
    const u = wrap((t - a) / life + j / n, 1);
    const ang = j * 2.4 + u * Math.PI * 2.2 * (j % 2 ? 1 : -1);
    const r = inward ? lerp(W * 1.4, W * 0.35, u * u) : lerp(W * 0.4, W * 1.2, u);
    const z = inward ? lerp(2, o.z + H * 0.6, u) : o.z + H * 0.5 + u * 34;
    const p: V3 = [sp.c[0] + Math.cos(ang) * r, Math.sin(ang) * r * 0.8, z];
    const v: V3 = [-Math.sin(ang) * 40 * (j % 2 ? 1 : -1), Math.cos(ang) * 30, inward ? 20 : 30];
    // Сходятся — разгораются у книги; расходятся — гаснут вдали.
    const age = Math.min(0.95, Math.max(inward ? (1 - u) * 0.7 : u * 0.9, 1 - k));
    sparkPx(sc, p, v, age, ramp, j % 2 === 0 ? 2 : 1.5);
  }
}

/** Портал в воздухе: толстое кольцо, раскрывается и закрывается, с зубцами-знаками. */
function portal(
  sc: Scene,
  tier: HiTier,
  cx: number,
  t: number,
  a: number,
  b: number,
  ramp: string[],
  acc: string[],
): void {
  if (t <= a || t >= b) return;
  const L = tier === 'legend';
  const open = clamp01((t - a) / 0.3);
  const close = clamp01((b - t) / 0.22);
  const r = W * (L ? 0.95 : 0.88) * (1 - (1 - open) ** 3) * (0.2 + 0.8 * close);
  const k = Math.min(1, open * 1.5) * close;
  const z = PORTAL_Z[tier];
  const R = sc.c.RR;
  const c = cols(ramp);
  // Проём: тёмный диск со светлой кромкой изнутри (по пустому — книга перед ним).
  if (r > 1) {
    const [x0, y0] = scr(sc, [cx, 0, z]);
    const rx = r * R;
    const ry = r * SE * R;
    for (let y = Math.floor(y0 - ry); y <= Math.ceil(y0 + ry); y++)
      for (let x = Math.floor(x0 - rx); x <= Math.ceil(x0 + rx); x++) {
        const q = ((x + 0.5 - x0) / rx) ** 2 + ((y + 0.5 - y0) / ry) ** 2;
        if (q > 1) continue;
        bg(sc, x, y, tone(c, q > 0.62 ? 4 : 5));
      }
  }
  hring(sc, [cx, 0, z], r, L ? 3.4 : 3, k, ramp);
  const ca = cols(L ? ramp : acc);
  if (!L) hring(sc, [cx, 0, z], r * 0.78, 1, k * 0.8, acc);
  const n = L ? 12 : 8;
  for (let s = 0; s < n; s++) {
    const ang = (L ? t * 0.7 : -t * 2.2) + (s / n) * Math.PI * 2;
    const p0: V3 = [cx + Math.cos(ang) * (r + 2), Math.sin(ang) * (r + 2), z];
    const [x, y, d] = scr(sc, p0);
    if (!L) diamond(sc, x, y, R > 1 ? 2 : 1, tone(ca, 0), tone(ca, 2), d);
    else {
      // Нимб: зубцы-лучи наружу, светлые у кольца.
      const len = (s % 2 ? 3 : 5.5) * k;
      const p1: V3 = [
        cx + Math.cos(ang) * (r + 2 + len),
        Math.sin(ang) * (r + 2 + len),
        z + len * 0.4,
      ];
      wline(sc, p0, p1, tone(ca, s % 2 ? 2 : 1));
    }
  }
}

/**
 * Свет свыше из портала к полу (легендарная): падают светлые штрихи — голова внизу,
 * хвост вверх темнее. Только по пустому.
 */
function holyCone(sc: Scene, cx: number, t: number, k: number, ramp: string[]): void {
  if (k <= 0) return;
  const c = cols(ramp);
  const R = sc.c.RR;
  const [x0, yTop] = scr(sc, [cx, 0, PORTAL_Z.legend]);
  const [, yBot] = scr(sc, [cx, 0, 0]);
  const wk = 1 - (1 - k) ** 2;
  // Падающие штрихи: светлая голова внизу, хвост вверх.
  const Hh = yBot - yTop;
  for (let j = 0; j < 9; j++) {
    const ph = wrap(t * (0.9 + 0.5 * hash(j, 61, 1)) + hash(j, 61, 2), 1);
    const y = yTop + ph * Hh;
    const x = x0 + (hash(j, 61, 3) - 0.5) * 1.3 * W * 0.62 * R * wk;
    const len = Math.round((R > 1 ? 9 : 4) * (0.6 + 0.4 * k));
    for (let q = 0; q < len; q++) bg(sc, x, y - q, tone(c, q < 2 ? 1 : q < len * 0.6 ? 2 : 3));
  }
}

function sheetAnglesHi(tier: HiTier, t: number, t0: number, open: number): number[] {
  const n = SHEETS[tier];
  const gap = tier === 'legend' ? 0.055 : 0.085;
  const dur = 0.32;
  const out: number[] = [];
  for (let k = 0; k < n; k++) {
    const u = clamp01((t - (t0 + k * gap)) / dur);
    // Лист перелетает чуть дальше и ложится.
    const e = kf(u, [
      [0, 0],
      [0.75, 1.04, 'o'],
      [1, 1],
    ]);
    const target = OPEN_A - 0.035 * (k + 1);
    out.push(Math.min(e * target, Math.max(0, open - 0.035 * (k + 1))));
  }
  return out;
}

function revealPoseHi(tier: HiTier, t: number): Pose {
  const R = REVEAL[tier];
  const L = tier === 'legend';
  const o: Pose = { ...REST, sheets: [] };
  const T0 = R.T;
  o.pz = H / 2;
  // Прибытие из портала: разгон вниз, вращение вокруг вертикали гаснет к посадке.
  if (t < R.land) {
    const u = t / R.land;
    const e = L ? u * u * (1.6 - 0.6 * u) : u * u;
    o.z = (PORTAL_Z[tier] + 2) * (1 - e);
    o.yaw = YAW0 + TURNS[tier] * Math.PI * 2 * (1 - u) * (1 - u);
    o.roll = 0.08 * Math.sin(u * Math.PI * 2) * (1 - u);
  } else
    o.yaw = kf(t, [
      [R.snap + 0.1, YAW0],
      [R.open, 0],
      [R.close + 0.05, 0],
      [R.close + 0.45, YAW0],
    ]);
  // Посадка: сплющивание, отскок, затухание; перед срывом — присед.
  o.sq = kf(t, [
    [R.land, 1],
    [R.land + 0.06, 0.76, 'o'],
    [R.land + 0.17, 1.09],
    [R.land + 0.28, 0.96],
    [R.land + 0.38, 1.01],
    [R.land + 0.46, 1],
    [R.snap - 0.12, 1],
    [R.snap - 0.03, 0.93, 'o'],
    [R.snap + 0.06, 1.05],
    [R.snap + 0.16, 1],
  ]);
  // Ожидание: дрожь растёт до срыва застёжки.
  const sh = L ? 0.07 : 0.05;
  const a0 = R.land + 0.45;
  const g = t > a0 && t < R.snap ? ((t - a0) / (R.snap - a0)) ** 1.6 : 0;
  o.roll += sh * g * Math.sin(t * Math.PI * 2 * 12);
  o.x += sh * g * 12 * Math.sin(t * Math.PI * 2 * 15 + 1);
  // Разворот к зрителю и сдвиг под разворот.
  o.x += kf(t, [
    [R.snap + 0.1, 0],
    [R.open + 0.15, SPREAD_X],
    [R.close + 0.1, SPREAD_X],
    [R.close + 0.45, 0],
  ]);
  // Взлёт, наклон назад, парение, спуск со второй посадкой.
  const air = AIR[tier];
  o.z += kf(t, [
    [R.snap, 0],
    [R.open + 0.12, air, 'o'],
    [R.close + 0.12, air],
    [R.lock - 0.02, 0, 'i'],
  ]);
  o.z += Math.sin((t - R.open) * Math.PI * 2 * 0.7) * 1.1 * bump(t, R.open, R.close + 0.12);
  o.lean = kf(t, [
    [R.snap + 0.05, 0],
    [R.open + 0.12, -0.5],
    [R.close + 0.1, -0.5],
    [R.lock - 0.04, 0],
  ]);
  // Вторая посадка на замке: сплющилась, отпружинила.
  o.sq *= kf(t, [
    [R.lock - 0.03, 1],
    [R.lock + 0.03, 0.88, 'o'],
    [R.lock + 0.12, 1.04],
    [R.lock + 0.22, 1],
  ]);
  // Застёжка отходит от обреза и возвращается на замке.
  o.strap = kf(t, [
    [R.snap, 0],
    [R.snap + 0.1, 2.35, 'o'],
    [R.snap + 0.2, 2.05],
    [R.snap + 0.3, 2.15],
    [R.close + 0.1, 2.15],
    [R.lock, 0, 'i'],
  ]);
  o.chains = L && t >= R.snap && t < R.lock ? 1 : 0;
  // Крышка: дёргается (предвкушение), распахивается с перелётом, захлопывается с отскоком.
  o.open = kf(t, [
    [R.open - 0.16, 0],
    [R.open - 0.08, 0.11, 'o'],
    [R.open, 0],
    [R.open + 0.22, OPEN_A + 0.16, 'o'],
    [R.open + 0.34, OPEN_A - 0.06],
    [R.open + 0.44, OPEN_A + 0.02],
    [R.open + 0.52, OPEN_A],
    [R.close - 0.1, OPEN_A],
    [R.close, OPEN_A + 0.07, 'o'],
    [R.close + 0.18, 0, 'i'],
    [R.close + 0.23, 0.08],
    [R.close + 0.29, 0],
  ]);
  o.sheets = sheetAnglesHi(tier, t, R.open + 0.18, o.open);
  o.edge = kf(t, [
    [R.land, 0],
    [R.snap, 0.8],
    [R.open + 0.1, 1],
    [R.open + 0.25, 0.3],
    [R.close + 0.12, 0.3],
    [R.close + 0.25, 0.7],
    [T0, idleEdge(tier, 0)],
  ]);
  // Страницы светятся, но не выбеливаются: свет — вокруг книги, а не на ней.
  o.glow = kf(t, [
    [R.open + 0.05, 0],
    [R.open + 0.35, 0.35],
    [R.peak, 0.6],
    [R.close, 0.45],
    [R.close + 0.14, 0],
  ]);
  if (!L)
    o.gem = Math.max(
      clamp01(bump(t, R.land + 0.25, R.snap + 0.25) * 1.2) * (0.6 + 0.4 * Math.sin(t * 30)),
      bump(t, R.peak - 0.2, R.close),
    );
  else
    o.sigil = Math.max(
      bump(t, R.land + 0.25, R.snap + 0.12) * (0.7 + 0.3 * Math.sin(t * 34)),
      t > R.lock - 0.1
        ? kf(t, [
            [R.lock - 0.1, 0],
            [R.lock + 0.12, 0.85],
            [T0, 0.5],
          ])
        : 0,
    );
  return o;
}

/** Пиксели книги выше линии `yP` ещё «по ту сторону» портала: стираются вместе с буферами. */
function clipAbove(sc: Scene, yP: number): void {
  const { p, f } = sc;
  const yc = Math.min(p.h, Math.max(0, Math.ceil(yP)));
  for (let y = 0; y < yc; y++)
    for (let x = 0; x < p.w; x++) {
      const i = y * p.w + x;
      if (p.data[i * 4 + 3] === 0) continue;
      p.data[i * 4 + 3] = 0;
      f.pal[i] = -1;
      f.zb[i] = -1e9;
      sc.ol[i] = 0;
    }
}

function revealFrameHi(tier: HiTier, t: number, res: Res): Px {
  const R = REVEAL[tier];
  const L = tier === 'legend';
  const o = revealPoseHi(tier, t);
  const glow = GLOW[tier];
  const acc = HI_ACC[tier];
  const seed = L ? 7 : 5;
  const pk = L ? glow : acc;
  return render(
    tier,
    o,
    res,
    (sc) => {
      // 0. Прибытие: книга выходит из портала низом вперёд.
      if (L) chainsHiRest(sc, o, t);
      if (t < R.land) clipAbove(sc, scr(sc, [X0, 0, PORTAL_Z[tier]])[1]);
      const n = sc.f.w * sc.f.h;
      sc.body = new Uint8Array(n);
      for (let i = 0; i < n; i++) if (sc.p.data[i * 4 + 3] > 0) sc.body[i] = 1;
      // 1. Свет сгущается в книгу ступенями к посадке.
      const kc = 1 - clamp01((t - 0.1) / (R.land * 0.85));
      condense(sc, kc, glow);
      if (o.z > 0.6) shadowHi(sc, o);
      // 2. Задний план (только по пустому): конус свыше, лучи, ореол, луч из разворота.
      if (L) holyCone(sc, X0, t, Math.min(1, bump(t, -0.15, R.land + 0.3) * 1.25), glow);
      if (L)
        rays(
          sc,
          o,
          clamp01((t - R.peak + 0.1) / 0.45),
          clamp01((R.close + 0.15 - t) / 0.4),
          t * 0.3,
          glow,
        );
      const kAura = Math.max(
        kc * 0.9,
        t < R.open ? clamp01((t - R.land - 0.3) / (R.snap - R.land - 0.3)) * 0.5 : 0,
        bump(t, R.open - 0.05, R.close + 0.2) * 0.85,
        bump(t, R.lock - 0.1, R.T - 0.06) * 0.45,
      );
      aura(sc, kAura, glow, 3);
      {
        const [bx, by] = scr(sc, spreadOf(o).c);
        burstRing(sc, bx, by, (t - R.peak + 0.03) / 0.45, L ? 52 : 46, glow);
        burstRing(sc, bx, by, (t - R.peak - 0.08) / 0.5, L ? 56 : 50, acc);
      }
      beam(sc, o, t, R.peak - 0.42, R.close + 0.12, glow, acc, seed);
      rimGlow(sc, Math.max(kc, bump(t, R.peak - 0.35, R.close + 0.1)), glow);
      // 3. Пол: круг призыва (эпическая), ударные кольца.
      if (!L) {
        const on = clamp01(t / 0.35) * 0.65;
        const lit =
          t < R.land
            ? on
            : 0.7 +
              0.3 * bump(t, R.land, R.land + 0.45) +
              0.3 * bump(t, R.peak - 0.15, R.peak + 0.55);
        arcaneCircle(
          sc,
          X0,
          Math.min(1, lit) * clamp01((R.T - 0.2 - t) / 0.45),
          t * 0.9,
          glow,
          acc,
        );
      }
      const ringAt = (
        cx: number,
        dt: number,
        life: number,
        rMax: number,
        th: number,
        ramp: string[],
      ) => {
        if (dt < 0 || dt > life) return;
        const u = dt / life;
        hring(
          sc,
          [cx, 0, 0],
          W * 0.4 + rMax * (1 - (1 - u) ** 3),
          th * (1 - u * 0.5),
          1 - u,
          ramp,
          true,
          th,
        );
      };
      ringAt(X0, t - R.land, 0.6, W * (L ? 1.2 : 1.0), L ? 4.5 : 3.5, glow);
      if (L) ringAt(X0, t - R.land - 0.1, 0.65, W * 1.45, 2.4, acc);
      ringAt(X0 + SPREAD_X, t - R.peak + 0.02, 0.65, W * (L ? 1.35 : 1.1), L ? 4 : 3, pk);
      ringAt(X0, t - R.lock, R.T - R.lock - 0.1, W * 0.8, 3, glow);
      // 4. Портал прибытия.
      portal(sc, tier, X0, t, -0.05, R.land + 0.05, glow, acc);
      // 5. Искры: кольцом по полу на посадке, накопление, фонтан и звёзды в пик.
      floorBurst(sc, [X0, 0, 0], t - R.land, L ? 18 : 14, L ? 58 : 50, glow, seed);
      floorBurst(sc, [X0, 0, 0], t - R.lock, 10, 36, glow, seed + 9, R.T - R.lock - 0.08);
      if (!L) {
        spiral(sc, o, t, R.land + 0.3, R.snap + 0.05, 16, acc, true);
        spiral(sc, o, t, R.peak - 0.1, R.close + 0.15, 12, acc, false);
      } else {
        // Огоньки поднимаются вокруг книги, пока она копит свет (свет свыше — медленно).
        for (let j = 0; j < 14; j++) {
          const life = 1.1;
          const a = R.land + 0.3 + hash(j, 41, 1) * 0.6;
          if (t < a || t > R.close + 0.2) continue;
          const ph = wrap((t - a) / life, 1);
          const ang = hash(j, 41, 2) * Math.PI * 2;
          const p: V3 = [
            o.x + Math.cos(ang) * W * 0.85,
            Math.sin(ang) * W * 0.6,
            2 + ph * (H + 14),
          ];
          sparkPx(sc, p, [0, 0, 22], ph, j % 3 ? glow : acc, j % 3 === 0 ? 2 : 1.5);
        }
      }
      const sp = spreadOf(o);
      const dp = t - R.peak + 0.02;
      if (dp > 0) fountain(sc, sp.c, dp, L ? 24 : 18, pk, seed + 3, L ? 1.2 : 0.9);
      // Кольцо звёзд в пик: разлёт с торможением, гаснут ступенями.
      if (dp > 0 && dp < 0.65) {
        const u = dp / 0.65;
        const [cx, cy] = scr(sc, sp.c);
        const nS = L ? 8 : 6;
        const rr = (1 - (1 - u) ** 3) * (L ? 42 : 34) * sc.c.RR;
        for (let j = 0; j < nS; j++) {
          const a = (j / nS) * Math.PI * 2 + 0.3;
          star4(
            sc,
            cx + Math.cos(a) * rr,
            cy + Math.sin(a) * rr * 0.75,
            (1 - u) * (j % 2 ? 0.7 : 1),
            pk,
          );
        }
      }
      // Вспышка-звезда на щелчке застёжки и на замке (эпическая).
      if (!L) {
        const clasp = bookXf(o).p([W / 2 - 4, T / 2 + 1.5, H / 2 + 2]);
        const ks = bump(t, R.snap - 0.02, R.snap + 0.28);
        if (ks > 0) star4(sc, scr(sc, clasp)[0], scr(sc, clasp)[1], ks, glow);
        const kl = bump(t, R.lock - 0.04, R.lock + 0.3);
        if (kl > 0) star4(sc, scr(sc, clasp)[0], scr(sc, clasp)[1], kl * 0.8, acc);
      }
      // 6. Руны и цепи легендарной, огоньки покоя к концу.
      if (L) {
        const kr = Math.min(clamp01((t - R.snap - 0.05) / 0.3), clamp01((R.lock - t) / 0.3));
        runeOrbit(sc, o, t, kr, glow);
        chainsHi(sc, o, t);
        if (t > R.T - 0.45)
          legendMotes(sc, o, (t - R.T) / IDLE_T.legend, (t - (R.T - 0.45)) / 0.38);
      }
    },
    { chains: false },
  );
}

// ---------------------------------------------------------------------------
// Вписано: книга раскрывается, листы срываются и летят светом вниз — в кирку
// (точка `APPLY_TO`), книга тает снизу вверх. Последний кадр пуст.
// ---------------------------------------------------------------------------

const APPLY_N: Record<Tier, number> = { simple: 3, rare: 5, epic: 7, legend: 10 };
/** Куда летят листы: точка под книгой (в сцене там кирка), мир. */
const APPLY_TO: V3 = [X0, 2, -30];
const LIFT = 0.08;
const FLY = 0.3;
const SHEET0 = 0.52;

function applyGap(tier: Tier): number {
  return (APPLY_T[tier] - 0.5 - SHEET0) / APPLY_N[tier];
}
function applyHit(_tier: Tier): number {
  return SHEET0 + LIFT + FLY;
}

function applyPose(tier: Tier, t: number): Pose {
  const A = APPLY_T[tier];
  const o: Pose = { ...REST, sheets: [] };
  o.pz = H / 2;
  o.z = kf(t, [
    [0, 0],
    [0.3, 3, 'o'],
  ]);
  const g = clamp01(t / 0.3);
  if (t < 0.34) o.roll = 0.05 * g * g * Math.sin(t * Math.PI * 2 * 15);
  const sOpen = tier === 'simple' ? 1.25 : 2.15;
  o.strap = kf(t, [
    [0.28, 0],
    [0.36, sOpen + 0.18, 'o'],
    [0.44, sOpen],
  ]);
  o.chains = tier === 'legend' && t >= 0.3 ? 1 : 0;
  o.yaw = kf(t, [
    [0.3, YAW0],
    [0.46, 0],
  ]);
  o.x += kf(t, [
    [0.3, 0],
    [0.5, SPREAD_X],
  ]);
  o.open = kf(t, [
    [0.36, 0],
    [0.5, OPEN_A + 0.1, 'o'],
    [0.56, OPEN_A],
  ]);
  const gap = applyGap(tier);
  for (let k = 0; k < APPLY_N[tier]; k++) {
    const tk = SHEET0 + k * gap;
    const u = clamp01((t - tk) / LIFT);
    // Лист приподнимается к зрителю и срывается (дальше это луч).
    o.sheets.push(t < tk + LIFT ? 1.25 * u * u : 0);
  }
  // Начало — кадр 0 покоя (обрез и знак легендарной светятся), дальше — своё.
  const from0 = clamp01(1 - t / 0.2);
  o.edge = Math.max(idleEdge(tier, 0) * from0, tier !== 'simple' ? bump(t, 0.05, 0.5) * 0.8 : 0);
  o.glow = kf(t, [
    [0.36, 0.25],
    [0.6, tier === 'simple' ? 0.5 : 1],
  ]);
  if (tier === 'epic') o.gem = bump(t, 0.05, 0.45);
  if (tier === 'legend') o.sigil = Math.max(0.5 * from0, bump(t, 0.05, 0.45));
  o.fade = kf(t, [
    [A - 0.44, 0],
    [A - 0.1, 1],
  ]);
  return o;
}

function applyFrame(tier: Tier, t: number, res: Res): Px {
  const o = applyPose(tier, t);
  const ramp = GLOW[tier];
  const gap = applyGap(tier);
  return render(tier, o, res, (sc) => {
    // Блик щелчка застёжки.
    const ks = bump(t, 0.26, 0.46);
    if (ks > 0 && tier !== 'legend')
      star(
        sc,
        bookXf(o).p([W / 2 - 4, T / 2 + 1.5, H / 2 + 2]),
        ks,
        ['#ffffff', ...ramp.slice(-3).reverse()],
        false,
      );
    // Звенья легендарной осыпаются вниз и тают.
    if (tier === 'legend' && t >= 0.3) {
      const rest = chainRest(applyPose('legend', 0.299));
      const dt = t - 0.3;
      if (dt < 0.4)
        rest.forEach((L, j) => {
          const ang = hash(j, 21, 5) * Math.PI * 2;
          const p: V3 = [
            L.p[0] + Math.cos(ang) * 22 * dt,
            L.p[1] + 8 * dt,
            L.p[2] + 14 * dt - 80 * dt * dt,
          ];
          link(sc, p, j % 2 === 0, dt * 16 + j, 1 - dt / 0.4);
        });
    }
    // Огоньки легендарной гаснут.
    if (tier === 'legend' && t < 0.3) legendMotes(sc, o, t / IDLE_T.legend, 1 - t / 0.3);
    // Листы — лучи света вниз, к кирке.
    for (let k = 0; k < APPLY_N[tier]; k++) {
      const t0 = SHEET0 + k * gap + LIFT;
      const u = (t - t0) / FLY;
      if (u <= 0 || u > 1.25) continue;
      const pos = applyPose(tier, t0 - 0.001);
      const from = chain(hingeZ(1.25, HINGE), bookXf(pos)).p([
        W / 2 - 3,
        T / 2 - CB - 0.3,
        H * (0.35 + 0.3 * hash(k, 2, 9)),
      ]);
      const side = (k % 2 ? 1 : -1) * (6 + 10 * hash(k, 3, 9));
      const ctrl: V3 = [
        lerp(from[0], APPLY_TO[0], 0.3) + side,
        from[1] + 6,
        lerp(from[2], APPLY_TO[2], 0.25) + 8,
      ];
      streak(sc, from, ctrl, APPLY_TO, u, ramp);
      // От редкой — второй, тоньше и с другим изгибом: лист рвётся светом на полосы.
      if (tier !== 'simple' && u > 0.1) {
        const c2: V3 = [ctrl[0] - side * 0.9, ctrl[1], ctrl[2] + 4];
        streak(sc, add(from, [-2.5, 0, -3]), c2, APPLY_TO, (u - 0.1) * 1.05, ramp);
      }
      // Лист вспыхивает, когда срывается.
      if (u < 0.3) star(sc, from, 1 - u / 0.3, ['#ffffff', ...ramp.slice(-3).reverse()], false);
    }
    // Попадание: искра в точке кирки.
    const hitK = bump(t, applyHit(tier) - 0.02, applyHit(tier) + 0.2);
    if (hitK > 0) star(sc, APPLY_TO, hitK * 1.4, ramp, false);
    // Книга тает — огоньки сыплются из тающей кромки вниз.
    if (o.fade > 0 && o.fade < 1) {
      for (let j = 0; j < 14; j++) {
        const u = wrap(t * 2.2 + j / 14, 1);
        const sx = o.x + (hash(j, 5, 9) * 2 - 1) * W;
        const p: V3 = [lerp(sx, APPLY_TO[0], u * u), 3, lerp(H * (1 - o.fade), APPLY_TO[2], u * u)];
        mote(sc, p, ramp, hash(j, 6, 9) > 0.5 ? 2 : 1);
      }
    }
  });
}

/**
 * Вписано (эпическая, легендарная): тот же ход, что у прочих, но свет вокруг книги, а не
 * на ней, лучи — ступенями без шахматки, книга тает рваной кромкой света снизу вверх.
 */
function applyFrameHi(tier: HiTier, t: number, res: Res): Px {
  const A = APPLY_T[tier];
  const L = tier === 'legend';
  const o = applyPose(tier, t);
  // Страницы светятся, но не выбеливаются; растворение — своё, ступенями.
  o.glow = Math.min(o.glow, 0.55);
  const fadeK = o.fade;
  o.fade = 0;
  const ramp = GLOW[tier];
  const acc = HI_ACC[tier];
  const gap = applyGap(tier);
  return render(tier, o, res, (sc) => {
    const n = sc.f.w * sc.f.h;
    dissolveHi(sc, fadeK, ramp);
    sc.body = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (sc.p.data[i * 4 + 3] > 0) sc.body[i] = 1;
    // Ореол и подсветка контура, пока книга отдаёт свет.
    const kA = bump(t, 0.3, A - 0.15) * 0.8;
    aura(sc, kA * (1 - fadeK), ramp, 2.5);
    rimGlow(sc, kA * (1 - fadeK), ramp);
    // Щелчок застёжки (эпическая) — звезда.
    const ks = bump(t, 0.26, 0.48);
    if (ks > 0 && !L) {
      const [x, y] = scr(sc, bookXf(o).p([W / 2 - 4, T / 2 + 1.5, H / 2 + 2]));
      star4(sc, x, y, ks, ramp);
    }
    // Звенья легендарной лопаются раскалёнными и падают.
    if (L && t >= 0.3) {
      const rest = chainRest(applyPose('legend', 0.299));
      const dt = t - 0.3;
      if (dt < 0.5)
        rest.forEach((Lk, j) => {
          const v: V3 = [-10 + 36 * hash(j, 21, 5), 6, 22 + 14 * hash(j, 22, 5)];
          const b = ballistic(Lk.p, v, dt, 0.5, 140);
          linkHi(
            sc,
            b.p,
            j % 2 === 0,
            dt * 16 + j,
            Math.round(clamp01((dt - 0.25) / 0.25) * 4),
            1 - clamp01(dt / 0.25),
            1.3,
          );
        });
      for (const zc of CHAIN_Z) {
        const [x, y] = scr(sc, bookXf(o).p([W / 2 - 3.5, T / 2 + 1.5, zc * H]));
        star4(sc, x, y, 1 - clamp01(dt / 0.3), ramp);
      }
    }
    if (L && t < 0.3) legendMotes(sc, o, t / IDLE_T.legend, 1 - t / 0.3);
    // Листы — лучи света вниз, к кирке.
    for (let k = 0; k < APPLY_N[tier]; k++) {
      const t0 = SHEET0 + k * gap + LIFT;
      const u = (t - t0) / FLY;
      if (u <= 0 || u > 1.3) continue;
      const pos = applyPose(tier, t0 - 0.001);
      const from = chain(hingeZ(1.25, HINGE), bookXf(pos)).p([
        W / 2 - 3,
        T / 2 - CB - 0.3,
        H * (0.35 + 0.3 * hash(k, 2, 9)),
      ]);
      const side = (k % 2 ? 1 : -1) * (6 + 10 * hash(k, 3, 9));
      const ctrl: V3 = [
        lerp(from[0], APPLY_TO[0], 0.3) + side,
        from[1] + 6,
        lerp(from[2], APPLY_TO[2], 0.25) + 8,
      ];
      streakHi(sc, from, ctrl, APPLY_TO, u, k % 3 === 2 ? acc : ramp);
      if (u < 0.3) {
        const [x, y] = scr(sc, from);
        star4(sc, x, y, 1 - u / 0.3, ramp);
      }
    }
    // Попадание: звезда и волна в точке кирки.
    const hit = applyHit(tier);
    const [hx0, hy0] = scr(sc, APPLY_TO);
    const hitK = bump(t, hit - 0.02, hit + 0.24);
    if (hitK > 0) star4(sc, hx0, hy0, Math.min(1, hitK * 1.2), ramp);
    burstRing(sc, hx0, hy0, (t - hit) / 0.4, 18, ramp, 2.2);
    // Тающая кромка роняет искры вниз, к кирке.
    if (fadeK > 0 && fadeK < 1) {
      for (let j = 0; j < 12; j++) {
        const u = wrap(t * 2.2 + j / 12, 1);
        const sx = o.x + (hash(j, 5, 9) * 2 - 1) * W * 0.9;
        const z0 = H * (1 - fadeK);
        const p: V3 = [lerp(sx, APPLY_TO[0], u * u), 3, lerp(z0, APPLY_TO[2], u * u)];
        const v: V3 = [(APPLY_TO[0] - sx) * 2 * u, 0, (APPLY_TO[2] - z0) * 2 * u - 8];
        sparkPx(sc, p, v, u, j % 3 ? ramp : acc, j % 4 === 0 ? 1.5 : 1, false);
      }
    }
  });
}

/**
 * Растворение снизу вверх без шахматки: кромка рваная по столбцам (у каждого — своё
 * смещение), над ней полоса света яруса в три ступени, ниже — пусто.
 */
function dissolveHi(sc: Scene, k: number, ramp: string[]): void {
  if (k <= 0) return;
  const { p } = sc;
  let top = p.h;
  let bot = 0;
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++)
      if (p.data[(y * p.w + x) * 4 + 3] > 0) {
        top = Math.min(top, y);
        bot = Math.max(bot, y);
      }
  if (top > bot) return;
  const R = sc.c.RR;
  const band = 4 * R;
  const front = bot + 1 - k * (bot - top + 1 + band * 2 + 2 * R);
  const c = cols(ramp);
  const cw = R > 1 ? 2 : 1;
  for (let y = top; y <= bot; y++)
    for (let x = 0; x < p.w; x++) {
      const i = y * p.w + x;
      if (p.data[i * 4 + 3] === 0) continue;
      const d = y - front - (hash(Math.floor(x / cw), 3, 77) - 0.5) * 2.5 * R;
      if (d > 0) {
        p.data[i * 4 + 3] = 0;
        sc.f.pal[i] = -1;
        sc.f.zb[i] = -1e9;
        sc.ol[i] = 0;
        continue;
      }
      if (d < -band) continue;
      const col = tone(c, d > -band * 0.3 ? 0 : d > -band * 0.65 ? 1 : 2);
      p.data[i * 4] = col[0];
      p.data[i * 4 + 1] = col[1];
      p.data[i * 4 + 2] = col[2];
    }
}

/**
 * Луч-лист (эпическая, легендарная): голова — звезда с белой серединой, хвост по
 * квадратичной кривой сужается и темнеет ступенями (без шахматки), с хвоста срываются искры.
 */
function streakHi(sc: Scene, a: V3, b: V3, c: V3, u: number, ramp: string[]): void {
  const R = sc.c.RR;
  const head = Math.min(1, u) ** 2;
  const tail = Math.max(0, Math.min(1, u - 0.4)) ** 2;
  if (head <= tail) return;
  const col = cols(ramp);
  const pa = scr(sc, a);
  const pc = scr(sc, c);
  const len = Math.hypot(pc[0] - pa[0], pc[1] - pa[1]);
  const steps = Math.max(10, Math.ceil(len * 3));
  for (let s = 0; s <= steps; s++) {
    const e = tail + ((head - tail) * s) / steps;
    const [x, y] = scr(sc, bezQ3(a, b, c, e));
    const v = (e - tail) / (head - tail || 1);
    // Ширина растёт к голове; тон: у головы светлый, к хвосту — ступенями темнее.
    const wd = (R > 1 ? 3 : 1.5) * (0.3 + 0.7 * v);
    const tn = v > 0.75 ? 0 : v > 0.5 ? 1 : v > 0.25 ? 2 : 3;
    for (let q = -Math.floor(wd); q <= Math.floor(wd); q++) {
      const edge = Math.abs(q) >= Math.floor(wd) && wd >= 1 ? 1 : 0;
      hp(sc, x + q, y, tone(col, tn + edge));
    }
  }
  if (u < 1) {
    const [x, y] = scr(sc, bezQ3(a, b, c, head));
    star4(sc, x, y, 0.75, ramp);
  }
  // Искры с хвоста.
  for (let j = 0; j < 3; j++) {
    const e = lerp(tail, head, 0.2 + 0.25 * j);
    const age = clamp01((u - 0.2 - j * 0.12) / 0.5);
    if (age <= 0 || age >= 1) continue;
    const p0 = bezQ3(a, b, c, e);
    const p: V3 = [p0[0] + (j - 1) * 6 * age, p0[1], p0[2] - 4 * age];
    sparkPx(sc, p, [(j - 1) * 20, 0, -18], age, ramp, 1, false);
  }
}

/** Луч: голова светлая ромбом, хвост цвета яруса тает шахматкой; путь — квадратичная кривая. */
function streak(sc: Scene, a: V3, b: V3, c: V3, u: number, ramp: string[]): void {
  const R = sc.c.RR;
  const head = Math.min(1, u) ** 2;
  const tail = Math.max(0, Math.min(1, u - 0.38)) ** 2;
  if (head <= tail) return;
  const col = ramp.map((s) => hx(s));
  const N = col.length;
  const pa = scr(sc, a);
  const pc = scr(sc, c);
  const len = Math.hypot(pc[0] - pa[0], pc[1] - pa[1]);
  const steps = Math.max(8, Math.ceil(len * 3));
  const wd = R > 1 ? 2 : 1;
  for (let s = 0; s <= steps; s++) {
    const e = tail + ((head - tail) * s) / steps;
    const [x, y] = scr(sc, bezQ3(a, b, c, e));
    const v = (e - tail) / (head - tail || 1);
    const px = Math.floor(x);
    const py = Math.floor(y);
    if (v < 0.35 && dith(px, py, 1 - v / 0.35)) continue;
    const core = v > 0.7 ? col[N - 1] : col[N - 2];
    const rim = v > 0.7 ? col[N - 2] : col[N - 3];
    for (let q = -wd; q <= wd; q++)
      sc.p.set(px + q, py, Math.abs(q) < wd || v < 0.5 ? (Math.abs(q) === 0 ? core : rim) : rim);
  }
  if (u < 1) {
    const [x, y] = scr(sc, bezQ3(a, b, c, head));
    const s = R > 1 ? 3 : 2;
    for (let yy = -s; yy <= s; yy++)
      for (let xx = -s; xx <= s; xx++) {
        const m = Math.abs(xx) + Math.abs(yy);
        if (m <= s)
          sc.p.set(x + xx, y + yy, m < s - 1 ? col[N - 1] : m < s ? col[N - 2] : col[N - 3]);
      }
  }
}

function bezQ3(a: V3, b: V3, c: V3, u: number): V3 {
  const v = 1 - u;
  return [
    v * v * a[0] + 2 * u * v * b[0] + u * u * c[0],
    v * v * a[1] + 2 * u * v * b[1] + u * u * c[1],
    v * v * a[2] + 2 * u * v * b[2] + u * u * c[2],
  ];
}

// ---------------------------------------------------------------------------
// Сгорела: огонь от краёв силуэта внутрь, за кромкой — уголь с тлеющими
// трещинами, языки пламени вверх; медальон горит последним. Потом уголь
// осыпается сверху вниз хлопьями, они падают, отскакивают от пола и тают.
// ---------------------------------------------------------------------------

function burnFrame(tier: Tier, t: number, res: Res): Px {
  const T0 = BURN_T[tier];
  const crumble = T0 - 0.62;
  // Толчок неудачи: книга вздрагивает.
  const o: Pose = { ...REST, sheets: [], pz: H / 2 };
  o.roll = 0.06 * Math.sin(t * 60) * bump(t, 0, 0.2);
  o.z = 2 * bump(t, 0, 0.18);
  if (tier === 'legend') o.sigil = 0.6 * bump(t, 0, 0.3);
  return render(tier, o, res, (sc) => burnFx(sc, t, T0, crumble, isHi(tier) ? tier : null));
}

/**
 * `hi` — эпическая и легендарная: пламя с краской яруса, без шахматки (кончики языков и
 * хлопья гаснут ступенями и целиком), из огня уходит свет яруса — искры с хвостами.
 */
function burnFx(sc: Scene, t: number, T0: number, crumble: number, hi: HiTier | null = null): void {
  const { p } = sc;
  const w = p.w;
  const h = p.h;
  const R = sc.c.RR;
  const n = w * h;
  // Расстояние до края силуэта (шаги 3/4 — фаска).
  const dist = new Float32Array(n);
  for (let i = 0; i < n; i++) dist[i] = p.data[i * 4 + 3] > 0 ? 1e6 : 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (dist[i] === 0) continue;
      let d = dist[i];
      if (x > 0) d = Math.min(d, dist[i - 1] + 3);
      if (y > 0) d = Math.min(d, dist[i - w] + 3);
      if (x > 0 && y > 0) d = Math.min(d, dist[i - w - 1] + 4);
      if (x < w - 1 && y > 0) d = Math.min(d, dist[i - w + 1] + 4);
      dist[i] = d;
    }
  let maxD = 0;
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (dist[i] === 0) continue;
      let d = dist[i];
      if (x < w - 1) d = Math.min(d, dist[i + 1] + 3);
      if (y < h - 1) d = Math.min(d, dist[i + w] + 3);
      if (x < w - 1 && y < h - 1) d = Math.min(d, dist[i + w + 1] + 4);
      if (x > 0 && y < h - 1) d = Math.min(d, dist[i + w - 1] + 4);
      dist[i] = d;
      maxD = Math.max(maxD, d);
    }
  const ign = 0.12;
  const u = clamp01((t - ign) / (crumble - ign - 0.06));
  const front = u * u * (3 - 2 * u) * (maxD + 6) - 3;
  const band = 2.6 * 3 * R;
  const ember = EMBER.map((c) => hx(c));
  const charC = CHAR.map((c) => hx(c));
  const orig = new Uint8ClampedArray(p.data);
  const burnt = new Uint8Array(n);
  // Пиксели книги: уголь / кромка огня / цело.
  const cells: number[] = [];
  for (let i = 0; i < n; i++) {
    if (orig[i * 4 + 3] === 0) continue;
    const x = i % w;
    const y = (i / w) | 0;
    const d = dist[i] + (hash(x, y, 3) - 0.5) * 3 * R;
    if (d > front) continue;
    const since = (front - d) / band;
    let c: RGBA;
    if (since < 1) {
      // Кромка: жар, светлее у самой кромки.
      c = ember[since < 0.3 ? 5 : since < 0.6 ? 4 : 3];
    } else {
      const lum = (orig[i * 4] * 0.3 + orig[i * 4 + 1] * 0.55 + orig[i * 4 + 2] * 0.15) / 255;
      c = charC[Math.min(charC.length - 1, Math.floor(lum * 3.2))];
      // Тлеющие трещины: остывают от жёлтого к тёмно-красному.
      const crack =
        hash(Math.floor(x / (2 * R)), Math.floor(y / (3 * R)), 11) > 0.82 && hash(x, y, 12) > 0.3;
      if (crack) {
        const cool = clamp01((since - 1) / 6);
        c = ember[Math.max(0, 3 - Math.floor(cool * 4))];
      }
    }
    p.data[i * 4] = c[0];
    p.data[i * 4 + 1] = c[1];
    p.data[i * 4 + 2] = c[2];
    burnt[i] = 1;
    cells.push(i);
  }
  if (t < crumble) {
    // Языки пламени над кромкой: вверх, только по углю и пустому.
    const amp = bump(t, ign, crumble + 0.1);
    for (const i of cells) {
      if (front - dist[i] > band * 0.8) continue;
      const x = i % w;
      const y = (i / w) | 0;
      const fl = (2 + 5 * hash(x >> 1, Math.floor(t * 14), 5)) * R * amp;
      for (let k = 1; k <= fl; k++) {
        if (y - k < 0) break;
        const j = (y - k) * w + x;
        if (orig[j * 4 + 3] > 0 && !burnt[j]) break;
        const v = k / fl;
        if (hi) {
          // Язык: у корня — жар, выше — краска яруса, кончик на ступень темнее.
          const fc = hi === 'epic' ? FLAME_EPIC : FLAME_LEGEND;
          p.set(x, y - k, fc[v < 0.25 ? 0 : v < 0.5 ? 1 : v < 0.78 ? 2 : 3]);
          continue;
        }
        if (v > 0.8 && dith(x, y - k, (v - 0.8) / 0.2)) continue;
        p.set(x, y - k, ember[v < 0.3 ? 5 : v < 0.6 ? 4 : v < 0.85 ? 3 : 2]);
      }
    }
  } else {
    // Осыпается: хлопья сверху вниз, падают, отскакивают, тают.
    const bs = Math.max(2, Math.round(2 * R));
    const floorY = sc.oy;
    const g = 420 * R;
    let top = h;
    let bot = 0;
    for (const i of cells) {
      const y = (i / w) | 0;
      top = Math.min(top, y);
      bot = Math.max(bot, y);
    }
    const snap = new Uint8ClampedArray(p.data);
    for (let i = 0; i < n; i++) if (orig[i * 4 + 3] > 0) p.data[i * 4 + 3] = 0;
    const done = new Set<number>();
    const fade = clamp01((t - (T0 - 0.34)) / 0.24);
    for (const i of cells) {
      const x = i % w;
      const y = (i / w) | 0;
      const bx = Math.floor(x / bs) * bs;
      const by = Math.floor(y / bs) * bs;
      const key = by * w + bx;
      if (done.has(key)) continue;
      done.add(key);
      const hn = (by - top) / Math.max(1, bot - top);
      const rel = crumble + hn * 0.22 + hash(bx, by, 4) * 0.08;
      const dt = Math.max(0, t - rel);
      const vx = (hash(bx, by, 6) - 0.5) * 34 * R;
      const fall = floorY - (by + bs);
      const tf = fall > 0 ? Math.sqrt((2 * fall) / g) : 0;
      let oyy: number;
      if (dt <= tf) oyy = 0.5 * g * dt * dt;
      else {
        const vb = 0.28 * g * tf;
        const d2 = dt - tf;
        oyy = fall - Math.max(0, vb * d2 - 0.5 * g * d2 * d2);
      }
      const oxx = vx * Math.min(dt, tf + 0.1);
      for (let yy = 0; yy < bs; yy++)
        for (let xx = 0; xx < bs; xx++) {
          if (by + yy >= h || bx + xx >= w) continue;
          const si = ((by + yy) * w + bx + xx) * 4;
          if (!burnt[si / 4]) continue;
          const nx = Math.floor(bx + xx + oxx);
          const ny = Math.floor(by + yy + oyy);
          if (fade >= 1) continue;
          // Хлопья гаснут целиком, каждое в свой миг (у простой и редкой — шахматкой).
          if (hi ? fade > hash(bx, by, 7) : fade > 0 && dith(nx, ny, fade)) continue;
          // Хлопья гаснут: жар уходит в серый пепел.
          // Эпическая и легендарная: хлопок одного тона целиком, верхний ряд — на ступень светлее.
          const ash = hi ? hash(bx, by, 9) > 0.65 : hash(nx, ny, 9) > 0.8;
          const c: RGBA =
            dt > 0.15
              ? ash || (hi && yy === 0)
                ? hx(hi && ash && yy === 0 ? '#7a685a' : '#5a4a40')
                : hx('#2a2220')
              : [snap[si], snap[si + 1], snap[si + 2], 255];
          p.set(nx, ny, c);
        }
    }
  }
  if (hi) {
    burnSparksHi(sc, t, T0, crumble, hi);
    return;
  }
  // Искры летят вверх из огня.
  for (let j = 0; j < 16; j++) {
    const t0 = 0.12 + hash(j, 1, 13) * (T0 - 0.62);
    // Искра гаснет до последнего кадра: он пуст.
    const uu = (t - t0) / Math.min(0.55, T0 - 0.08 - t0);
    if (uu <= 0 || uu >= 1) continue;
    const sx = sc.ox + (hash(j, 2, 13) - 0.5) * W * R;
    const sy = sc.oy - hash(j, 3, 13) * H * 0.9 * R;
    const x = sx + Math.sin(uu * 6 + j) * 3 * R;
    const y = sy - uu * 26 * R;
    if (uu > 0.7 && dith(Math.floor(x), Math.floor(y), (uu - 0.7) / 0.3)) continue;
    const c = ember[uu < 0.4 ? 5 : uu < 0.7 ? 4 : 3];
    p.set(x, y, c);
    if (R > 1) p.set(x + 1, y, c);
  }
}

/** Пламя эпической — тайный огонь (белое → сирень → пурпур), легендарной — золото → багрянец. */
const FLAME_EPIC = cols(['#ffffff', '#ecd6ff', '#a058f0', '#6224a8']);
const FLAME_LEGEND = cols(['#fffcf0', '#ffc95a', '#f8643a', '#92161e']);

/**
 * Искры сгорания (эпическая, легендарная): из огня вверх — с хвостом, тормозят и
 * виляют, тон гаснет ступенями; часть — светом яруса (магия уходит из книги).
 */
function burnSparksHi(sc: Scene, t: number, T0: number, crumble: number, tier: HiTier): void {
  for (let j = 0; j < 18; j++) {
    const t0 = 0.12 + hash(j, 1, 13) * (crumble - 0.05);
    const life = Math.min(0.6, T0 - 0.1 - t0);
    const a = t - t0;
    if (a < 0 || a >= life) continue;
    const u = a / life;
    const p0: V3 = [X0 + (hash(j, 2, 13) - 0.5) * W, 2, hash(j, 3, 13) * H * 0.9];
    const magic = j % 3 === 0;
    const sway = Math.sin(u * 7 + j) * 10;
    const b = ballistic(p0, [sway, 0, magic ? 70 : 52], a, 2.2, magic ? -10 : 14);
    sparkPx(sc, b.p, b.v, u, magic ? GLOW[tier] : EMBER.slice(1), magic ? 1.5 : 1, false);
  }
}

// В конце файла: полосам нужны константы сцен выше.
/** Точка мира → доли рамки (как якоря манифеста). */
function boxFrac(v: V3): [number, number] {
  const [x, y] = project(v);
  const B = RES.s.box;
  const q = (n: number) => Math.round(n * 1000) / 1000;
  return [q(0.5 + x / B), q((GROUND + y) / B)];
}

/**
 * Медальон на лицевой крышке в позе покоя: `glyph` — середина, `glyphX` — край по
 * оси крышки вправо, `glyphY` — край вверх (на радиус медальона). Игра строит по ним
 * матрицу знака чары — он лежит в медальоне с тем же поворотом крышки.
 */
function glyphAnchors(): Record<string, [number, number]> {
  const xf = bookXf(REST);
  const c: V3 = [MED_X - W / 2, T / 2, MED_Z];
  return {
    glyph: boxFrac(xf.p(c)),
    glyphX: boxFrac(xf.p([c[0] + MED_R, c[1], c[2]])),
    glyphY: boxFrac(xf.p([c[0], c[1], c[2] + MED_R])),
  };
}

/** Над разворотом в кадре `peak`: здесь сцена зажигает знак чары. */
function riseAnchor(t: Tier): [number, number] {
  const sp = spreadOf(isHi(t) ? revealPoseHi(t, REVEAL[t].peak) : revealPose(t, REVEAL[t].peak));
  return boxFrac(add(sp.c, [0, 0, 16]));
}

export const STRIPS: Record<string, StripDef> = buildStrips();
