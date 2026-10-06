// Этаж 13 «Театр марионеток» — рисунок: клетки трёх районов, предметы,
// иконки вещей, куклы и Кукловод.
//
// Всё нарисовано кодом (16 точек на клетку, свет сверху-слева, контур
// тёмный). Палитра: бархат занавеса (вишня с бликом), золото лепнины,
// тёплый луч рампы и софита на почти чёрной сине-фиолетовой сцене,
// выцветший крашеный картон декораций. Сказочно и чуть тревожно, без
// хоррора: куклы — дерево, фарфор, жесть и лоскут.
//
// Куклы собираются маленьким 3D-ригом с буфером глубины (капсулы, шары,
// диски), поэтому поворот на любую сторону даром: мобы — 8 сторон, Кукловод
// и исполин — 16. Кадр кешируется (`frameLRU`) по виду, стороне, позе и
// номеру кадра; прогрев — `registerMobWarm`. Нити кукол, лучи софитов,
// волны, звёзды и занавес — в `f13-boss-fx.ts` (одна зона поверх темноты).

import { Px } from '../dungeon-art';
import {
  frameLRU,
  paintSim,
  registerCellPainter,
  registerItemArt,
  registerMobPainter,
  registerMobWarm,
  registerPropPainter,
} from '../dungeon-paint';
import type { CellCtx, FrameLRU, MobFrame, MobPose, Sprite } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import type { WorldObj } from '../dungeon-world';
import { F13_FLIES, F13_FOYER, F13_GEO, F13_HALL, F13_MARK, F13_TOP } from './f13';
import { f13State, F13_FX } from './f13-brains';

export type RGBA = [number, number, number, number];

export const hx = (h: string, a = 255): RGBA => {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255, a];
};
export const mixc = (a: RGBA, b: RGBA, k: number): RGBA => [
  Math.round(a[0] + (b[0] - a[0]) * k),
  Math.round(a[1] + (b[1] - a[1]) * k),
  Math.round(a[2] + (b[2] - a[2]) * k),
  Math.round(a[3] + (b[3] - a[3]) * k),
];
export const withA = (c: RGBA, a: number): RGBA => [
  c[0],
  c[1],
  c[2],
  Math.round(Math.max(0, Math.min(1, a)) * 255),
];
export const css = (c: RGBA, a = 1): string => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

/** Детерминированный шум 0…1 по трём целым. */
export function hash(a: number, b: number, c = 0): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export const TAU = Math.PI * 2;
export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export const INK = hx('#140a12');
const WHITE = hx('#ffffff');

/** Палитра этажа: у каждой формы четыре тона — тень, основа, свет, блик. */
export const P = {
  velvet: [hx('#32060e'), hx('#5e0c1a'), hx('#8e1a2a'), hx('#c8404a')],
  gold: [hx('#4e3010'), hx('#9a6c1c'), hx('#d8a838'), hx('#fff0a8')],
  brass: [hx('#3e2a12'), hx('#7a5a24'), hx('#b8903c'), hx('#ecd08a')],
  wood: [hx('#2e1a0e'), hx('#5a3a1e'), hx('#8a5e32'), hx('#c08c52')],
  pale: [hx('#5a4a3a'), hx('#a8927a'), hx('#dccab0'), hx('#fff4e0')],
  porcelain: [hx('#7a7086'), hx('#c8c0cc'), hx('#eee8ee'), hx('#ffffff')],
  steel: [hx('#22262e'), hx('#4a525e'), hx('#7c8896'), hx('#c4ced8')],
  iron: [hx('#1a1c22'), hx('#30343e'), hx('#4c5260'), hx('#7a8294')],
  ink: [hx('#0a060c'), hx('#1a121e'), hx('#2c2234'), hx('#4a3a58')],
  night: [hx('#0a0c22'), hx('#141a3e'), hx('#22305e'), hx('#3e5694')],
  sea: [hx('#0c2238'), hx('#1a4466'), hx('#2e6e96'), hx('#8ac4dc')],
  forest: [hx('#1a2a1a'), hx('#2e4a2a'), hx('#4e7240'), hx('#8aa868')],
  castle: [hx('#2a3040'), hx('#4a5468'), hx('#748098'), hx('#b0bccc')],
  red: [hx('#4a0a12'), hx('#8e1622'), hx('#c8303a'), hx('#f07a6a')],
  blue: [hx('#101a46'), hx('#22367e'), hx('#3a5ab4'), hx('#8aa8ea')],
  green: [hx('#122a1c'), hx('#1e4a32'), hx('#2e7048'), hx('#6ab07a')],
  cream: [hx('#6a5a46'), hx('#b8a68a'), hx('#e6d8be'), hx('#fffaf0')],
  skin: [hx('#6a3e2c'), hx('#b8784e'), hx('#e8b080'), hx('#ffe0c0')],
  shade: [hx('#08040e'), hx('#1a1028'), hx('#2e2046'), hx('#58447e')],
  pink: [hx('#6a2a46'), hx('#c0587e'), hx('#ec90aa'), hx('#ffd6e2')],
  black: [hx('#08060a'), hx('#16121a'), hx('#262030'), hx('#464058')],
  silver: [hx('#3a4250'), hx('#7a8494'), hx('#b4bcc8'), hx('#f0f4f8')],
} satisfies Record<string, RGBA[]>;
export type Tone = RGBA[];

export const darken = (c: RGBA, k: number): RGBA => mixc(c, [8, 4, 10, 255], k);
export const lighten = (c: RGBA, k: number): RGBA => mixc(c, [255, 244, 220, 255], k);

// ---------------------------------------------------------------------------
// Клетки.
// ---------------------------------------------------------------------------

const MK = F13_MARK;
type AreaKey = 'foyer' | 'hall' | 'flies';

const TURN_CX = F13_GEO.f13bell.turn[0];
const TURN_CY = F13_GEO.f13bell.turn[1] + F13_TOP[F13_FLIES];
const TURN_R = F13_GEO.f13bell.turn[2];

/** Вид пола под предметом: самый частый вид соседей 5×5. */
function autoLook(c: CellCtx): number {
  const n = new Map<number, number>();
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++) {
      const m = c.markAt(dx, dy);
      if (m >= 1 && m <= 9 && c.open(dx, dy))
        n.set(m, (n.get(m) ?? 0) + (Math.abs(dx) + Math.abs(dy) <= 1 ? 3 : 1));
    }
  let best = 0;
  let bv = 0;
  for (const [m, v] of n) if (v > bv) [best, bv] = [m, v];
  return best || MK.boards;
}

const isFloorLook = (m: number, look: number) => m === look || m === MK.auto;

/** Тень у стен: свет сверху-слева, поэтому верхняя кромка темнее всего. */
function wallShadow(p: Px, c: CellCtx): void {
  const up = !c.open(0, -1);
  const lf = !c.open(-1, 0);
  const rt = !c.open(1, 0);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      let k = 0;
      if (up && y < 4) k = Math.max(k, [0.5, 0.34, 0.2, 0.08][y]);
      if (lf && x < 3) k = Math.max(k, [0.3, 0.16, 0.06][x]);
      if (rt && x > 13) k = Math.max(k, [0.04, 0.12, 0.22][x - 13]);
      if (k > 0) p.set(x, y, [6, 2, 10, Math.round(k * 255)]);
    }
}

function fill(p: Px, f: (x: number, y: number) => RGBA): void {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, f(x, y));
}

// ---- полы -------------------------------------------------------------------

function marble(p: Px, c: CellCtx): void {
  const L = [hx('#9c9284'), hx('#c4b8a6'), hx('#dcd0bc'), hx('#efe6d4')];
  // Тёмная плитка — бордовый мрамор, а не чёрный: шахматка не рябит.
  const D = [hx('#4a2c2e'), hx('#6a4040'), hx('#80524e'), hx('#9a6a62')];
  fill(p, (x, y) => {
    const X = c.wx * 16 + x;
    const Y = c.wy * 16 + y;
    const tx = Math.floor(X / 8);
    const ty = Math.floor(Y / 8);
    const dark = (tx + ty) & 1;
    const T = dark ? D : L;
    const lx = X & 7;
    const ly = Y & 7;
    if (lx === 7 || ly === 7) return darken(T[0], 0.35);
    if (lx === 0 || ly === 0) return T[2];
    // Прожилки: тонкая кривая по плитке.
    const s = hash(tx, ty, 3);
    const v = Math.sin((lx + ly * 0.6) * 0.9 + s * 9) * 2.6 + 3.5 - ly * (0.4 + s * 0.4);
    if (Math.abs(v - (s > 0.5 ? lx * 0.5 : 6 - lx * 0.6)) < 0.45) return T[0];
    return hash(X, Y, 1) < 0.05 ? mixc(T[1], T[2], 0.5) : T[1];
  });
}

function parquet(p: Px, c: CellCtx): void {
  const T = P.wood;
  fill(p, (x, y) => {
    const X = c.wx * 16 + x;
    const Y = c.wy * 16 + y;
    const bx = Math.floor(X / 8);
    const by = Math.floor(Y / 8);
    const hor = (bx + by) & 1;
    const u = hor ? Y & 7 : X & 7;
    const v = hor ? X & 7 : Y & 7;
    const plank = u >> 2;
    if ((u & 3) === 3) return darken(T[0], 0.3);
    const n = hash(bx * 2 + plank, by, 7);
    const base = n < 0.33 ? T[1] : n < 0.8 ? mixc(T[1], T[2], 0.5) : T[2];
    if ((u & 3) === 0) return lighten(base, 0.12);
    if (v === 7) return darken(base, 0.25);
    return hash(X, Y, 2) < 0.06 ? darken(base, 0.18) : base;
  });
}

function carpet(p: Px, c: CellCtx, deep = false): void {
  const T = deep ? [hx('#2a0610'), hx('#3e0a16'), hx('#561020'), hx('#7a1a2c')] : P.red;
  const g = P.gold;
  const same = (dx: number, dy: number) => {
    const m = c.markAt(dx, dy);
    return deep ? m === MK.parterre || m === MK.auto : isFloorLook(m, MK.carpet) || m === MK.steps;
  };
  const bl = !same(-1, 0);
  const br = !same(1, 0);
  fill(p, (x, y) => {
    const X = c.wx * 16 + x;
    const Y = c.wy * 16 + y;
    if (!deep) {
      if ((bl && x === 0) || (br && x === 15)) return T[0];
      if ((bl && x === 2) || (br && x === 13)) return g[1];
      if ((bl && x === 1) || (br && x === 14)) return T[1];
    }
    const lx = ((X % 8) + 8) % 8;
    const ly = ((Y % 8) + 8) % 8;
    const d = Math.abs(lx - 3.5) + Math.abs(ly - 3.5);
    if (!deep && d > 2.6 && d < 3.6) return mixc(T[1], g[1], 0.45);
    if (!deep && lx === 3 && ly === 3) return g[2];
    if (deep && X % 6 === 0 && Y % 6 === 3) return T[2];
    // Ворс: ровный, редкие ворсинки — без «снега».
    const n = hash(X, Y, 4);
    return n < 0.03
      ? mixc(T[1], T[2], 0.5)
      : n > 0.985
        ? mixc(T[1], T[0], 0.5)
        : (X + Y) % 2
          ? T[1]
          : mixc(T[1], T[0], 0.12);
  });
}

function steps(p: Px, c: CellCtx, area: AreaKey): void {
  const T = area === 'foyer' ? P.cream : area === 'hall' ? P.red : P.iron;
  fill(p, (x, y) => {
    const ly = y & 7;
    const X = c.wx * 16 + x;
    if (ly === 0) return area === 'flies' ? T[3] : P.brass[2];
    if (ly === 1) return T[3];
    if (ly === 7) return darken(T[0], 0.4);
    if (ly === 6) return T[0];
    if (area === 'flies' && (X & 3) === 0) return T[0];
    return hash(X, c.wy * 16 + y, 5) < 0.1 ? T[2] : T[1];
  });
}

function boards(p: Px, c: CellCtx, T: Tone, chalk = true): void {
  fill(p, (x, y) => {
    const X = c.wx * 16 + x;
    const Y = c.wy * 16 + y;
    const row = Math.floor(Y / 4);
    const off = Math.floor(hash(row, 0, 9) * 24);
    const pi = Math.floor((X + off) / 24);
    const px = (X + off) % 24;
    if ((Y & 3) === 3) return darken(T[0], 0.3);
    if (px === 23) return T[0];
    const n = hash(row, pi, 11);
    const base = n < 0.3 ? T[1] : n < 0.75 ? mixc(T[1], T[2], 0.35) : mixc(T[1], T[0], 0.4);
    if ((Y & 3) === 0) return lighten(base, 0.1);
    if ((px === 2 || px === 20) && (Y & 3) === 1) return T[0];
    const g = hash(X >> 1, Y, 12);
    return g < 0.05 ? darken(base, 0.2) : g > 0.97 ? T[2] : base;
  });
  // Метки на сцене: мелом крестики, где встают актёры.
  if (chalk && hash(c.wx, c.wy, 13) < 0.035) {
    const ox = 4 + Math.floor(hash(c.wx, c.wy, 14) * 8);
    const oy = 4 + Math.floor(hash(c.wx, c.wy, 15) * 8);
    const tape = hash(c.wx, c.wy, 16) < 0.5 ? hx('#d8cca8') : hx('#c87a5a');
    for (let i = -2; i <= 2; i++) {
      p.set(ox + i, oy + i, tape);
      p.set(ox + i, oy - i, tape);
    }
  }
}

const STAGE = [hx('#24160f'), hx('#432c1e'), hx('#5c3f2a'), hx('#7c5838')];
const PIT = [hx('#120e18'), hx('#1e1824'), hx('#2a2230'), hx('#3e3448')];
const NIGHT_BOARDS = [hx('#080a1a'), hx('#10142a'), hx('#1a2040'), hx('#2a3460')];

function pit(p: Px, c: CellCtx): void {
  boards(p, c, PIT, false);
  // Ноты на полу ямы.
  if (hash(c.wx, c.wy, 21) < 0.06) {
    const ox = 3 + Math.floor(hash(c.wx, c.wy, 22) * 6);
    const oy = 3 + Math.floor(hash(c.wx, c.wy, 23) * 6);
    p.rect(ox, oy, ox + 6, oy + 4, hx('#cfc4ac'));
    for (let k = 0; k < 3; k++) p.line(ox + 1, oy + 1 + k, ox + 5, oy + 1 + k, hx('#8a806e'));
    p.set(ox + 3, oy + 2, INK);
    p.set(ox + 5, oy + 1, INK);
  }
}

function turntable(p: Px, c: CellCtx): void {
  const T = STAGE;
  const B = P.brass;
  fill(p, (x, y) => {
    const X = c.wx + (x + 0.5) / 16 - TURN_CX;
    const Y = c.wy + (y + 0.5) / 16 - TURN_CY;
    const r = Math.hypot(X, Y);
    if (Math.abs(r - TURN_R) < 0.1) return B[2];
    if (Math.abs(r - TURN_R + 0.14) < 0.05) return B[0];
    if (r < 0.7) return r < 0.5 ? (r < 0.2 ? B[3] : B[1]) : B[0];
    const ring = Math.floor(r * 4);
    const fr = r * 4 - ring;
    if (fr < 0.14) return darken(T[0], 0.3);
    const a = Math.atan2(Y, X);
    const nSeg = Math.max(6, Math.round(ring * 1.6));
    const sa = ((a / TAU) * nSeg + hash(ring, 1, 31) * nSeg + nSeg) % nSeg;
    const seg = Math.floor(sa);
    if (sa - seg < 0.03 * (40 / Math.max(8, ring))) return T[0];
    const n = hash(ring, seg, 32);
    const base = n < 0.35 ? T[1] : n < 0.8 ? mixc(T[1], T[2], 0.4) : mixc(T[1], T[0], 0.4);
    if (fr < 0.26) return lighten(base, 0.1);
    // Радиальные риски «стрелок» сцены каждые 45°.
    const ang8 = ((a / TAU) * 8 + 8) % 1;
    if (ring % 6 === 3 && (ang8 < 0.02 || ang8 > 0.98)) return P.cream[1];
    return base;
  });
}

function catwalk(p: Px, c: CellCtx): void {
  const S = P.iron;
  fill(p, (x, y) => {
    const X = c.wx * 16 + x;
    const Y = c.wy * 16 + y;
    // Под решёткой — провал с отсветом снизу.
    const under = mixc(hx('#05030a'), hx('#120c1a'), 0.4 + 0.3 * Math.sin(X * 0.1 + Y * 0.07));
    const gx = X % 4;
    const gy = Y % 4;
    if (gx === 0 || gy === 0) return gx === 0 && gy === 0 ? S[3] : S[2];
    if (gx === 1 || gy === 1) return S[0];
    return under;
  });
  // Перила по краям, где мостки кончаются.
  if (!c.open(-1, 0) || c.markAt(-1, 0) === MK.void) p.rect(0, 0, 1, 15, P.iron[1]);
  if (!c.open(1, 0) || c.markAt(1, 0) === MK.void) p.rect(14, 0, 15, 15, P.iron[1]);
}

function voidCell(p: Px, c: CellCtx, lid = false): void {
  fill(p, (x, y) => {
    const X = c.wx * 16 + x;
    const Y = c.wy * 16 + y;
    const k = 0.5 + 0.5 * Math.sin(X * 0.05 + Y * 0.031);
    let col = mixc(hx('#020104'), hx('#0c0814'), k * 0.6);
    // Канаты уходят вниз, в темноту.
    if (!lid && (X % 37 === 11 || X % 53 === 30)) col = mixc(col, P.wood[0], 0.6);
    return col;
  });
  // Край пола над провалом: торец досок.
  if (c.open(0, -1) && c.markAt(0, -1) !== MK.void && c.markAt(0, -1) !== MK.trapOpen) {
    p.rect(0, 0, 15, 2, STAGE[2]);
    p.rect(0, 3, 15, 3, STAGE[0]);
    for (let y = 4; y < 9; y++) p.rect(0, y, 15, y, [0, 0, 0, 120 - y * 12]);
  }
  if (lid) {
    // Открытый люк: откинутая крышка у северного края и лестница.
    if (c.markAt(0, -1) !== MK.trapOpen) {
      p.rect(1, 0, 14, 3, STAGE[3]);
      p.rect(1, 4, 14, 4, STAGE[0]);
      p.set(3, 1, P.iron[3]);
      p.set(12, 1, P.iron[3]);
    }
    if (c.markAt(-1, 0) !== MK.trapOpen) p.rect(0, 0, 0, 15, STAGE[1]);
    if (c.markAt(1, 0) !== MK.trapOpen) p.rect(15, 0, 15, 15, STAGE[0]);
    if (c.markAt(0, 1) !== MK.trapOpen) p.rect(0, 15, 15, 15, STAGE[2]);
  }
}

function groove(p: Px, c: CellCtx): void {
  boards(p, c, STAGE, false);
  const S = P.steel;
  for (let x = 0; x < 16; x++) {
    p.set(x, 5, S[3]);
    p.set(x, 6, S[1]);
    p.set(x, 7, S[0]);
    p.set(x, 8, INK);
    p.set(x, 9, S[0]);
    p.set(x, 10, S[2]);
    if ((c.wx * 16 + x) % 8 === 2) {
      p.set(x, 6, P.brass[3]);
      p.set(x, 9, P.brass[2]);
    }
    // Красная предупредительная риска по краю жёлоба.
    if (((c.wx * 16 + x) >> 1) % 2 === 0) {
      p.set(x, 4, hx('#a02828'));
      p.set(x, 11, hx('#a02828'));
    }
  }
}

function trap(p: Px, c: CellCtx): void {
  boards(p, c, STAGE, false);
  const t = (dx: number, dy: number) => c.markAt(dx, dy) === MK.trap;
  const E = hx('#0a0608');
  if (!t(0, -1)) p.rect(0, 0, 15, 0, E);
  if (!t(-1, 0)) p.rect(0, 0, 0, 15, E);
  if (!t(1, 0)) p.rect(15, 0, 15, 15, E);
  if (!t(0, 1)) p.rect(0, 15, 15, 15, E);
  // Петли и кольцо люка.
  if (!t(0, -1)) {
    p.rect(3, 1, 5, 2, P.iron[2]);
    p.rect(10, 1, 12, 2, P.iron[2]);
  }
  if (!t(0, 1) && !t(1, 0)) {
    p.set(10, 11, P.brass[2]);
    p.set(11, 12, P.brass[1]);
    p.set(9, 12, P.brass[1]);
    p.set(10, 13, P.brass[0]);
  }
}

function ramp(p: Px, c: CellCtx, lit: boolean): void {
  boards(p, c, STAGE, false);
  // Желоб рампы: латунные раковины софитов вдоль края сцены.
  p.rect(0, 9, 15, 15, hx('#140c10'));
  p.rect(0, 9, 15, 9, P.brass[1]);
  if (lit) {
    for (let y = 0; y < 9; y++)
      for (let x = 0; x < 16; x++) {
        const d = Math.hypot(x - 7.5, y - 10);
        if (d < 9) p.set(x, y, [255, 196, 110, Math.round(70 * (1 - d / 9))]);
      }
  }
  p.ell(7.5, 12, 4, 2.6, P.brass[1]);
  p.ell(7.5, 11.6, 3, 1.8, lit ? hx('#ffd890') : P.brass[0]);
  if (lit) {
    p.set(7, 10, hx('#fff6d0'));
    p.set(8, 10, hx('#fff6d0'));
    p.set(7, 9, hx('#ffb040'));
  }
  p.rect(0, 15, 15, 15, P.brass[0]);
}

function seaFloor(p: Px, c: CellCtx, T: Tone): void {
  fill(p, (x, y) => {
    const X = c.wx * 16 + x;
    const Y = c.wy * 16 + y;
    // Крашеный холст: спокойные мазки, чтобы настоящие волны акта читались.
    const w = Math.sin(X * 0.2 + Math.sin(Y * 0.13) * 2) + Math.sin(Y * 0.45 + X * 0.05);
    if (w > 1.75) return mixc(T[2], T[3], 0.35);
    if (w > 1.25) return mixc(T[1], T[2], 0.6);
    if (w < -1.3) return mixc(T[0], T[1], 0.4);
    // Холст: редкое плетение.
    return (X + Y) % 5 === 0 ? mixc(T[1], T[0], 0.3) : T[1];
  });
}

// ---- полы актов (анимации 13 — «Техники») ---------------------------------
//
// Пол каждого акта читается полом с одного взгляда: доски вдоль, швы
// поперёк света, а стены акта — вертикальные плоскости с кромкой и тенью.

/** Акт II: тканевое море — полотнища по 8 точек, каждое волной вдоль. */
function actSeaFloor(p: Px, c: CellCtx): void {
  const T = P.sea;
  fill(p, (x, y) => {
    const X = c.wx * 16 + x;
    const Y = c.wy * 16 + y;
    const strip = Math.floor(Y / 8);
    const ly = Y - strip * 8;
    // Шов полотнищ: тёмная строчка с редкими стежками.
    if (ly === 7) return (X & 3) === 1 ? mixc(T[1], T[2], 0.5) : darken(T[0], 0.2);
    const ph = hash(strip, 0, 71) * TAU;
    const crest = 2.6 + Math.sin(X * 0.17 + ph) * 1.5 + Math.sin(X * 0.06 + ph * 2) * 0.7;
    const d = ly - crest;
    // Склон к свету (север) светлее, гребень — кружевом, за ним тень.
    if (d < -1.6) return mixc(T[1], T[2], 0.35);
    if (d < -0.5) return T[2];
    if (d < 0.5)
      return hash(X >> 1, strip, 72) < 0.2 ? mixc(T[2], T[3], 0.7) : mixc(T[2], T[3], 0.3);
    if (d < 1.6) return mixc(T[0], T[1], 0.45);
    return d > 3.2 ? mixc(T[1], T[0], 0.15) : T[1];
  });
}

/** Акт III: тёмно-синие доски, краской — звёзды и созвездия, блёстки. */
function nightFloor(p: Px, c: CellCtx): void {
  boards(p, c, NIGHT_BOARDS, false);
  const n = hash(c.wx, c.wy, 41);
  const s = hx('#e8d890');
  if (n < 0.3) {
    const x = 2 + Math.floor(hash(c.wx, c.wy, 42) * 12);
    const y = 2 + Math.floor(hash(c.wx, c.wy, 43) * 12);
    p.set(x, y, s);
    if (n < 0.1) {
      p.set(x - 1, y, withA(s, 0.6));
      p.set(x + 1, y, withA(s, 0.6));
      p.set(x, y - 1, withA(s, 0.6));
      p.set(x, y + 1, withA(s, 0.6));
    }
    // Созвездие: тонкий пунктир к соседней звезде.
    if (n < 0.16) {
      const tx = 2 + Math.floor(hash(c.wx + 1, c.wy, 42) * 12) + 16;
      const ty = 2 + Math.floor(hash(c.wx + 1, c.wy, 43) * 12);
      const L = Math.hypot(tx - x, ty - y);
      for (let i = 2; i < L - 1; i += 2)
        p.set(x + ((tx - x) * i) / L, y + ((ty - y) * i) / L, withA(s, 0.32));
    }
  }
  // Блёстки краски.
  for (let i = 0; i < 3; i++)
    if (hash(c.wx, c.wy, 44 + i) < 0.4)
      p.set(
        Math.floor(hash(c.wx, c.wy, 47 + i) * 16),
        Math.floor(hash(c.wx, c.wy, 50 + i) * 16),
        withA(P.silver[3], 0.35),
      );
}

/** Акт I: голые доски сцены, мел и опилки — замок только в задниках. */
function castleFloor(p: Px, c: CellCtx): void {
  boards(p, c, STAGE, true);
  if (hash(c.wx, c.wy, 46) < 0.25)
    for (let i = 0; i < 4; i++)
      p.set(
        Math.floor(hash(c.wx, c.wy, 60 + i) * 16),
        Math.floor(hash(c.wx, c.wy, 64 + i) * 16),
        withA(P.cream[2], 0.5),
      );
  // Мелом — дорожка прохода актёров по середине сцены.
  if (c.wy === 12)
    for (let x = 0; x < 16; x++)
      if (((c.wx * 16 + x) & 7) < 4) p.set(x, 8, withA(hx('#d8cca8'), 0.45));
}

/** Акт IV: пустая тёмная сцена, золотая лента разметки, метки актёров. */
function gridFloor(p: Px, c: CellCtx): void {
  boards(p, c, [hx('#0c080e'), hx('#18101a'), hx('#221824'), hx('#302432')], false);
  const g = withA(P.gold[1], 0.4);
  const gd = withA(P.gold[0], 0.35);
  const ex = (c.wx & 1) === 0;
  const ey = (c.wy & 1) === 0;
  // Лента местами стёрта.
  const worn = (n: number) => hash(n >> 2, c.wx * 7 + c.wy, 48) < 0.15;
  for (let i = 0; i < 16; i++) {
    if (ex && !worn(c.wy * 16 + i)) {
      p.set(0, i, g);
      p.set(1, i, gd);
    }
    if (ey && !worn(c.wx * 16 + i)) {
      p.set(i, 0, g);
      p.set(i, 1, gd);
    }
  }
  // Крест на пересечении ленты.
  if (ex && ey) {
    for (let i = 0; i <= 2; i++) {
      p.set(i, i, P.gold[2]);
      p.set(i, 0, P.gold[2]);
      p.set(0, i, P.gold[2]);
    }
    p.set(2, 2, P.gold[3]);
  }
  // Метки актёров цветной лентой — «Т».
  const m = hash(c.wx, c.wy, 49);
  if (m < 0.06) {
    const col = m < 0.03 ? hx('#c84050') : hx('#4a8ac8');
    const ox = 6 + Math.floor(hash(c.wx, c.wy, 52) * 5);
    const oy = 6 + Math.floor(hash(c.wx, c.wy, 53) * 5);
    p.rect(ox - 2, oy, ox + 2, oy, col);
    p.rect(ox, oy, ox, oy + 3, col);
  }
}

// ---- стены ------------------------------------------------------------------

/** Лицо стены (над открытой клеткой) или верх. Кромка — 3 точки сверху. */
interface WallLook {
  top: (p: Px, c: CellCtx) => void;
  face: (p: Px, c: CellCtx) => void;
  /** Кромка верха, когда стена в одну клетку и лежит на полу над ней. */
  cap?: (p: Px, c: CellCtx, h: number) => void;
}

function darkTop(p: Px, c: CellCtx, base: RGBA, grain: RGBA): void {
  fill(p, (x, y) => {
    const X = c.wx * 16 + x;
    const Y = c.wy * 16 + y;
    return hash(X >> 1, Y >> 1, 51) < 0.08 ? grain : base;
  });
  // Кромка к открытым клеткам: светлее сверху-слева.
  if (c.open(0, -1)) p.rect(0, 0, 15, 0, lighten(base, 0.18));
  if (c.open(-1, 0)) p.rect(0, 0, 0, 15, lighten(base, 0.12));
  if (c.open(1, 0)) p.rect(15, 0, 15, 15, darken(base, 0.3));
}

/** Карниз сверху лица: золотая лепнина. */
function cornice(p: Px, c: CellCtx, T: Tone = P.gold): void {
  p.rect(0, 0, 15, 0, T[3]);
  p.rect(0, 1, 15, 1, T[2]);
  p.rect(0, 2, 15, 2, T[1]);
  for (let x = 0; x < 16; x++) if ((c.wx * 16 + x) % 4 === 1) p.set(x, 2, T[3]);
  p.rect(0, 3, 15, 3, T[0]);
}

const WALL_FOYER: WallLook = {
  top: (p, c) => darkTop(p, c, hx('#1a0c10'), hx('#2a1418')),
  face: (p, c) => {
    // Обои: винный дамаск с золотым узором, ниже — тёмная панель.
    const T = [hx('#2a0a12'), hx('#4a1220'), hx('#6a1c2c'), hx('#8a2a3a')];
    fill(p, (x, y) => {
      const X = c.wx * 16 + x;
      if (y >= 11) {
        if (y === 11) return P.gold[2];
        if (y === 12) return P.wood[2];
        if (y === 15) return P.wood[0];
        return (X & 7) === 0 ? P.wood[0] : P.wood[1];
      }
      const lx = ((X % 8) + 8) % 8;
      const ly = (y + ((X >> 3) & 1) * 4) % 8;
      const d = Math.abs(lx - 3.5) * 0.8 + Math.abs(ly - 3.5);
      if (d > 2.2 && d < 2.9) return mixc(T[1], P.gold[1], 0.55);
      if (lx === 3 && ly === 3) return P.gold[2];
      return y < 6 ? mixc(T[1], T[0], (6 - y) / 10) : T[1];
    });
    cornice(p, c);
  },
};

const WALL_HALL: WallLook = {
  top: (p, c) => darkTop(p, c, hx('#140810'), hx('#200c18')),
  face: (p, c) => {
    // Обитые бархатом стены, золотые пилястры через четыре клетки.
    const T = P.velvet;
    const pil = ((c.wx % 4) + 4) % 4 === 0;
    fill(p, (x, y) => {
      if (pil && x >= 5 && x <= 10) {
        if (x === 5) return P.gold[3];
        if (x === 10) return P.gold[0];
        if ((y & 3) === 0) return P.gold[1];
        return x < 8 ? P.gold[2] : P.gold[1];
      }
      // Стёганые ромбы.
      const X = c.wx * 16 + x;
      const lx = ((X % 6) + 6) % 6;
      const ly = (y + 3) % 6;
      const d = Math.abs(lx - 2.5) + Math.abs(ly - 2.5);
      if (d > 2.6) return T[0];
      if (lx === 2 && ly === 2) return P.gold[1];
      return d < 1.4 ? T[2] : T[1];
    });
    cornice(p, c);
    p.rect(0, 15, 15, 15, P.gold[0]);
  },
};

const WALL_FLIES: WallLook = {
  top: (p, c) => {
    darkTop(p, c, hx('#0e0c12'), hx('#1a161e'));
    // Балки колосников сверху: железные полосы.
    if (((c.wx % 5) + 5) % 5 === 0) p.rect(6, 0, 9, 15, P.iron[1]);
  },
  face: (p, c) => {
    // Закопчённый кирпич.
    const T = [hx('#1a1012'), hx('#3a2220'), hx('#4e302a'), hx('#6a4436')];
    fill(p, (x, y) => {
      const X = c.wx * 16 + x;
      const row = y >> 2;
      const lx = (X + (row & 1) * 4) % 8;
      if ((y & 3) === 3 || lx === 7) return T[0];
      const n = hash((X + (row & 1) * 4) >> 3, c.wy * 4 + row, 61);
      const base = n < 0.4 ? T[1] : n < 0.85 ? T[2] : mixc(T[1], INK, 0.3);
      return (y & 3) === 0 ? lighten(base, 0.08) : base;
    });
    p.rect(0, 0, 15, 1, P.iron[2]);
    p.rect(0, 2, 15, 2, P.iron[0]);
  },
};

function seatsLook(): WallLook {
  const V = P.velvet;
  const back = (p: Px, x0: number, y0: number, h: number) => {
    // Спинка кресла: скруглённый верх, бархат, золотой номерок.
    for (let y = 0; y < h; y++)
      for (let x = 0; x < 7; x++) {
        if (y === 0 && (x === 0 || x === 6)) continue;
        const c = x === 0 ? V[2] : x === 6 ? V[0] : y < 2 ? V[3] : V[1];
        p.set(x0 + x, y0 + y, c);
      }
  };
  return {
    top: (p, c) => {
      darkTop(p, c, hx('#1a080c'), hx('#260c12'));
      for (let k = 0; k < 2; k++) {
        p.rect(k * 8 + 1, 3, k * 8 + 6, 12, V[1]);
        p.rect(k * 8 + 1, 3, k * 8 + 6, 4, V[2]);
      }
    },
    face: (p, c) => {
      fill(p, () => hx('#14060a'));
      for (let k = 0; k < 2; k++) {
        back(p, k * 8 + 1, 0, 11);
        p.set(k * 8 + 4, 9, P.gold[2]);
        // Подлокотник и ножки.
        p.rect(k * 8, 11, k * 8, 14, P.wood[1]);
        p.rect(k * 8 + 1, 11, k * 8 + 6, 12, V[0]);
        p.rect(k * 8 + 2, 13, k * 8 + 2, 15, P.wood[0]);
        p.rect(k * 8 + 5, 13, k * 8 + 5, 15, P.wood[0]);
      }
      if (hash(c.wx, c.wy, 71) < 0.08) {
        // Забытая программка на кресле.
        p.rect(3, 4, 6, 7, P.cream[2]);
        p.set(4, 5, P.red[1]);
      }
    },
    cap: (p, _c, h) => {
      for (let k = 0; k < 2; k++) back(p, k * 8 + 1, 16 - h, h);
    },
  };
}

function velvetLook(bright = false): WallLook {
  const V = P.velvet;
  const fold = (X: number) => {
    const s = Math.sin(X * 0.62) + 0.35 * Math.sin(X * 1.7);
    return s > 0.9 ? V[3] : s > 0.2 ? V[2] : s > -0.6 ? V[1] : V[0];
  };
  return {
    top: (p, c) =>
      fill(p, (x) => {
        const col = fold(c.wx * 16 + x);
        return darken(col, bright ? 0.25 : 0.45);
      }),
    face: (p, c) => {
      fill(p, (x, y) => {
        const X = c.wx * 16 + x;
        const col = fold(X + Math.sin(y * 0.3 + X) * 0.4);
        if (y >= 13) return y === 13 ? P.gold[2] : (X + y) % 2 ? P.gold[1] : P.gold[0];
        return bright && y < 3 ? lighten(col, 0.1) : col;
      });
    },
    cap: (p, c, h) => {
      for (let y = 16 - h; y < 16; y++)
        for (let x = 0; x < 16; x++) p.set(x, y, darken(fold(c.wx * 16 + x), 0.35));
    },
  };
}

const RAIL: WallLook = {
  top: (p, c) => {
    darkTop(p, c, hx('#120a0e'), hx('#1e1016'));
    p.rect(0, 6, 15, 8, P.gold[1]);
    p.rect(0, 6, 15, 6, P.gold[3]);
  },
  face: (p, c) => {
    fill(p, () => hx('#0e080c'));
    p.rect(0, 0, 15, 2, P.gold[2]);
    p.rect(0, 0, 15, 0, P.gold[3]);
    p.rect(0, 3, 15, 3, P.gold[0]);
    // Балясины.
    for (let k = 0; k < 4; k++) {
      const x = k * 4 + 1;
      p.rect(x, 4, x + 1, 12, P.gold[1]);
      p.set(x, 5, P.gold[3]);
      p.ell(x + 1, 8, 1.6, 1.8, P.gold[2]);
      p.set(x, 7, P.gold[3]);
    }
    p.rect(0, 13, 15, 14, P.gold[1]);
    p.rect(0, 15, 15, 15, P.gold[0]);
    void c;
  },
  cap: (p, _c, h) => {
    p.rect(0, 16 - h, 15, 15, P.gold[1]);
    p.rect(0, 16 - h, 15, 16 - h, P.gold[3]);
  },
};

const BACKDROP: WallLook = {
  top: (p, c) => {
    darkTop(p, c, hx('#0e0a12'), hx('#18121e'));
    p.rect(0, 7, 15, 8, P.wood[0]);
  },
  face: (p, c) => {
    // Расписной задник: сумеречное небо, облака, далёкие холмы.
    fill(p, (x, y) => {
      const X = c.wx * 16 + x;
      const hill = 11 + Math.sin(X * 0.05) * 2 + Math.sin(X * 0.13) * 1.2;
      if (y > hill) return y > hill + 2 ? P.forest[0] : P.forest[1];
      const cl = Math.sin(X * 0.09 + y * 0.6) + Math.sin(X * 0.031);
      if (cl > 1.5 && y < 8) return hx('#a08aa4');
      return mixc(hx('#2a2a5a'), hx('#7a4a6a'), y / 12);
    });
    p.rect(0, 0, 15, 0, P.wood[1]);
  },
};

const ROPES: WallLook = {
  top: (p, c) => {
    WALL_FLIES.top(p, c);
    for (let k = 0; k < 3; k++) p.rect(3 + k * 5, 0, 3 + k * 5, 15, P.wood[2]);
  },
  face: (p, c) => {
    WALL_FLIES.face(p, c);
    // Нагельная планка с канатами.
    p.rect(0, 9, 15, 11, P.wood[1]);
    p.rect(0, 9, 15, 9, P.wood[3]);
    for (let k = 0; k < 3; k++) {
      const x = 3 + k * 5;
      p.rect(x, 0, x, 8, P.cream[1]);
      p.set(x, 3 + k, P.cream[3]);
      p.rect(x - 1, 8, x + 1, 12, P.cream[2]);
      p.rect(x, 12, x, 15, P.wood[2]);
    }
  },
};

function plateLook(): WallLook {
  const S = P.steel;
  return {
    top: (p, c) => {
      darkTop(p, c, hx('#1a1c22'), hx('#262a32'));
      p.rect(0, 6, 15, 9, S[1]);
    },
    face: (p, c) => {
      fill(p, (x, y) => {
        if (y >= 12) return ((x + y + c.wx * 16) >> 2) % 2 ? hx('#d8b030') : hx('#1a1612');
        if (x === 0 || y === 0) return S[3];
        if (x === 15) return S[0];
        if ((x === 2 || x === 13) && (y === 2 || y === 9)) return S[3];
        return y < 6 ? S[2] : S[1];
      });
    },
    cap: (p, _c, h) => p.rect(0, 16 - h, 15, 15, P.steel[2]),
  };
}

function flatLook(paint: (p: Px, c: CellCtx, face: boolean) => void): WallLook {
  return {
    top: (p, c) => {
      // Картон сверху — тонкая кромка и распорка.
      darkTop(p, c, hx('#16100c'), hx('#22180e'));
      p.rect(0, 6, 15, 7, P.cream[1]);
      p.rect(7, 8, 8, 15, P.wood[1]);
      paint(p, c, false);
    },
    face: (p, c) => {
      paint(p, c, true);
      p.rect(0, 0, 15, 0, P.cream[2]);
    },
    cap: (p, c, h) => {
      for (let y = 16 - h; y < 16; y++) p.rect(0, y, 15, y, y === 16 - h ? P.cream[2] : P.cream[1]);
      void c;
    },
  };
}

const TREE_FLAT = flatLook((p, c, face) => {
  if (!face) return;
  const T = P.forest;
  fill(p, (x, y) => {
    const X = c.wx * 16 + x;
    const crown = 7 + Math.sin(X * 0.35) * 2.5 + Math.sin(X * 0.9) * 1.2;
    if (y < crown) {
      const b = Math.sin(X * 0.7 + y * 0.9);
      return b > 0.6 ? T[3] : b > -0.2 ? T[2] : T[1];
    }
    if (X % 11 < 2) return P.wood[1];
    return y > 13 ? T[0] : T[1];
  });
});

// ---- стены актов (анимации 13 — «Техники») --------------------------------

/** Доски сцены в тени — видны за задником сквозь просвет зубцов. */
const behind = (X: number, Y: number): RGBA =>
  (Y & 3) === 3
    ? darken(STAGE[0], 0.5)
    : darken(mixc(STAGE[1], STAGE[2], hash(X >> 4, Y >> 2, 11) * 0.5), 0.45);

/** Плоский картонный замок: зубцы, крашеный камень, бойница, брус внизу. */
function castleFace(p: Px, c: CellCtx): void {
  const T = P.castle;
  fill(p, (x, y) => {
    const X = c.wx * 16 + x;
    const Y = c.wy * 16 + y;
    const m = ((X % 8) + 8) % 8;
    if (y < 4 && m >= 4) return behind(X, Y);
    // Срез картона: кремовая кромка сверху зубца и над просветом.
    if ((y === 0 && m < 4) || (y === 4 && m >= 4)) return P.cream[3];
    if ((y === 1 && m < 4) || (y === 5 && m >= 4)) return P.cream[1];
    if (y < 4 && m === 3) return T[0];
    // Брус, на котором стоит задник.
    if (y === 14) return X % 8 === 3 ? P.iron[3] : P.wood[2];
    if (y === 15) return P.wood[0];
    // Крашеный камень: плоские тона, шов краской, мазок света.
    const course = Math.floor((y - 2) / 4);
    const ly = (y - 2) % 4;
    const sx = (X + (course & 1) * 4) % 8;
    if (ly === 3 || sx === 7) return mixc(T[0], T[1], 0.35);
    const n = hash(Math.floor((X + (course & 1) * 4) / 8), course + c.wy * 4, 77);
    const base = n < 0.45 ? T[1] : n < 0.85 ? mixc(T[1], T[2], 0.55) : mixc(T[1], P.forest[1], 0.4);
    if (ly === 0 || sx === 0) return mixc(base, T[3], 0.35);
    return (X + y * 2) % 9 === 0 ? mixc(base, T[2], 0.4) : base;
  });
  // Бойница нарисована: тёмная щель с аркой и крашеным бликом.
  if (((c.wx % 3) + 3) % 3 === 1) {
    p.rect(7, 7, 8, 11, INK);
    p.set(7, 6, INK);
    p.set(8, 6, INK);
    p.rect(9, 7, 9, 11, T[3]);
    p.rect(6, 12, 9, 12, T[0]);
  }
  // Торцы задника: толщина картона и тень.
  if (c.open(-1, 0))
    for (let y = 0; y < 14; y++) if (y >= 4 || (c.wx * 16) % 8 < 4) p.set(0, y, P.cream[2]);
  if (c.open(1, 0)) for (let y = 0; y < 14; y++) p.set(15, y, P.cream[0]);
}

/** За задником: кромка картона и подпорка с мешком-противовесом. */
function castleBack(p: Px, c: CellCtx): void {
  for (let x = 0; x < 16; x++) {
    const m = (((c.wx * 16 + x) % 8) + 8) % 8;
    if (m < 4) p.set(x, 15, P.cream[2]);
  }
  if ((c.wx & 1) === 0) {
    const x = 6 + (c.wx & 2 ? 3 : 0);
    // Подпорка: брусок от верха задника назад к полу.
    p.rect(x, 5, x + 1, 14, P.wood[2]);
    p.rect(x + 2, 6, x + 2, 14, P.wood[0]);
    p.set(x, 5, P.wood[3]);
    // Мешок с песком прижимает подпорку.
    p.ell(x + 1, 4, 3.4, 2.4, P.cream[1]);
    p.ell(x + 0.5, 3.5, 2.4, 1.5, P.cream[2]);
    p.set(x + 1, 2, P.wood[0]);
    p.set(x + 1, 6, darken(P.cream[0], 0.2));
  }
}

const CASTLE_FLAT: WallLook = {
  top: (p, c) => {
    darkTop(p, c, hx('#16100c'), hx('#22180e'));
    p.rect(0, 6, 15, 7, P.cream[1]);
    p.rect(0, 6, 15, 6, P.cream[2]);
    castleBack(p, c);
  },
  face: castleFace,
  cap: (p, c) => castleBack(p, c),
};

const SHIP: WallLook = {
  top: (p, c) => {
    // Палуба: доски вдоль, нагели на стыках.
    fill(p, (x, y) => {
      const X = c.wx * 16 + x;
      const row = c.wy * 4 + (y >> 2);
      const off = Math.floor(hash(row, 1, 81) * 16);
      const px = (X + off) % 24;
      if ((y & 3) === 3) return P.wood[0];
      if (px === 23) return P.wood[0];
      if ((px === 1 || px === 21) && (y & 3) === 1) return P.brass[1];
      const n = hash(Math.floor((X + off) / 24), row, 82);
      const base = n < 0.5 ? P.wood[2] : mixc(P.wood[2], P.wood[3], 0.35);
      return (y & 3) === 0 ? lighten(base, 0.08) : base;
    });
    // Фальшборт: золотой планширь и стойки по краю.
    if (c.open(0, -1)) {
      p.rect(0, 0, 15, 0, P.gold[3]);
      p.rect(0, 1, 15, 1, P.gold[1]);
      for (let x = 0; x < 16; x += 4) p.set(x + 1, 2, P.wood[0]);
    }
    if (c.open(-1, 0)) p.rect(0, 0, 1, 15, P.gold[2]);
    if (c.open(1, 0)) p.rect(14, 0, 15, 15, P.gold[1]);
    // Мачта (обрубок), люк и бухта каната.
    if (c.wx === 31 || c.wx === 32) {
      const cx = c.wx === 31 ? 16 : 0;
      p.ell(cx, 8, 4.2, 3.6, P.brass[1]);
      p.ell(cx, 8, 3.2, 2.6, P.wood[1]);
      p.ell(cx - 0.5, 7.5, 2, 1.5, P.wood[3]);
    }
    if (c.wx === 29) {
      p.rect(4, 4, 11, 11, P.wood[0]);
      for (let i = 5; i <= 10; i += 2) {
        p.rect(i, 5, i, 10, P.wood[1]);
        p.rect(5, i, 10, i, P.wood[1]);
      }
    }
    if (c.wx === 34) {
      p.ell(8, 9, 4, 3, P.cream[0]);
      p.ell(8, 9, 3, 2.2, P.cream[2]);
      p.ell(8, 9, 1.6, 1.1, P.cream[0]);
    }
  },
  face: (p, c) => {
    const bow = c.open(-1, 0);
    const stern = c.open(1, 0);
    // Нос и корма скошены: за ними — тканевое море.
    if (bow || stern) actSeaFloor(p, c);
    fill(p, (x, y) => {
      if (bow && x < Math.round(y * 0.7)) return [0, 0, 0, 0];
      if (stern && x > 15 - Math.round(y * 0.4)) return [0, 0, 0, 0];
      const X = c.wx * 16 + x;
      if (y === 0) return P.gold[3];
      if (y === 1) return P.gold[2];
      if (y === 2) return P.wood[0];
      if (y === 12) return P.cream[3];
      if (y === 13) return P.red[1];
      if (y >= 14) {
        // Ткань моря плещет о борт.
        const w = 14.5 + Math.sin(X * 0.5) * 0.9;
        if (y > w) return y === 15 ? P.sea[1] : P.sea[3];
        return P.red[0];
      }
      const pl = (y - 3) % 3;
      if (pl === 2) return P.wood[0];
      const n = hash(X >> 3, y >> 1, 83);
      const base = n < 0.5 ? P.wood[2] : P.wood[1];
      return pl === 0 ? lighten(base, 0.1) : base;
    });
    // Срез фанеры на скосах — кремовая кромка.
    if (bow) for (let y = 0; y < 14; y++) p.set(Math.round(y * 0.7), y, P.cream[2]);
    if (stern) for (let y = 0; y < 14; y++) p.set(15 - Math.round(y * 0.4), y, P.cream[0]);
    if (!bow && !stern && ((c.wx % 2) + 2) % 2 === 0) {
      p.ell(8, 7.5, 3, 3, P.brass[2]);
      p.ell(8, 7.5, 2, 2, hx('#1a2e48'));
      p.set(7, 6, hx('#8ac4dc'));
      p.set(9, 9, P.brass[0]);
    }
  },
  cap: (p, c) => {
    // Над носом — бушприт, над кормой — фонарь на столбике.
    if (c.open(-1, 1) && !c.open(1, 1)) {
      p.line(15, 15, 3, 9, P.wood[2]);
      p.line(15, 14, 4, 9, P.wood[1]);
      p.set(2, 9, P.gold[3]);
      p.set(3, 8, P.gold[2]);
    } else if (c.open(1, 1) && !c.open(-1, 1)) {
      p.rect(3, 6, 3, 15, P.wood[1]);
      p.rect(1, 3, 5, 6, P.brass[1]);
      p.rect(2, 4, 4, 5, hx('#ffd890'));
    }
  },
};

const CLOUD_FLAT: WallLook = {
  top: (p, c) => darkTop(p, c, P.night[0], P.night[1]),
  face: (p, c) => {
    // Фанерное облако из ваты на тёмно-синем заднике.
    boards(p, c, NIGHT_BOARDS, false);
    fill(p, (x, y) => {
      const X = c.wx * 16 + x;
      const top = 5 - Math.abs(Math.sin(X * 0.3)) * 3;
      if (y < top || y > 13) return [0, 0, 0, 0];
      if (y < top + 1.5) return hx('#eeeaf6');
      return y > 11 ? hx('#8a86a4') : (X + y) % 5 === 0 ? hx('#dcd8ea') : hx('#c4c0d8');
    });
  },
};

function wallLookOf(mark: number, area: AreaKey): WallLook {
  switch (mark) {
    case MK.seats:
      return SEATS;
    case MK.velvet:
      return VELVET;
    case MK.curtainDown:
      return CURTAIN;
    case MK.rail:
      return RAIL;
    case MK.backdrop:
      return BACKDROP;
    case MK.ropes:
      return ROPES;
    case MK.iron:
      return PLATE;
    case MK.setTree:
      return TREE_FLAT;
    case MK.setCastle:
      return CASTLE_FLAT;
    case MK.actShip:
      return SHIP;
    case MK.actCloud:
      return CLOUD_FLAT;
  }
  return area === 'foyer' ? WALL_FOYER : area === 'hall' ? WALL_HALL : WALL_FLIES;
}

const SEATS = seatsLook();
const VELVET = velvetLook();
const CURTAIN = velvetLook(true);
const PLATE = plateLook();

function floorBase(p: Px, c: CellCtx, look: number, area: AreaKey): void {
  switch (look) {
    case MK.marble:
      return marble(p, c);
    case MK.parquet:
      return parquet(p, c);
    case MK.carpet:
      return carpet(p, c);
    case MK.steps:
      return steps(p, c, area);
    case MK.parterre:
      return carpet(p, c, true);
    case MK.pit:
      return pit(p, c);
    case MK.turn:
      return turntable(p, c);
    case MK.catwalk:
      return catwalk(p, c);
    case MK.groove:
      return groove(p, c);
    case MK.trap:
      return trap(p, c);
    case MK.rampLit:
      return ramp(p, c, true);
    case MK.ramp:
      return ramp(p, c, false);
    case MK.setSea:
      return seaFloor(p, c, P.sea);
    case MK.actSea:
      return actSeaFloor(p, c);
    case MK.actNight:
      return nightFloor(p, c);
    case MK.actCastle:
      return castleFloor(p, c);
    case MK.actGrid:
      return gridFloor(p, c);
    case MK.curtainUp:
      boards(p, c, STAGE, false);
      // Где лежал занавес — золотая риска по полу.
      p.rect(0, 7, 15, 7, P.gold[1]);
      return;
  }
  return boards(p, c, STAGE);
}

function cellPainter(area: AreaKey) {
  return (c: CellCtx): Px | null => {
    const p = new Px(16, 16);
    // Провал и открытый люк.
    if (c.tile === 11) {
      voidCell(p, c, c.mark === MK.trapOpen);
      return p;
    }
    const wall = c.tile === 1 || (!c.open(0, 0) && c.tile !== 11);
    if (wall) {
      if (c.tile !== 1) return null;
      const L = wallLookOf(c.mark, area);
      if (c.open(0, 1)) L.face(p, c);
      else L.top(p, c);
      return p;
    }
    let look = c.mark === MK.auto || c.mark === 0 ? autoLook(c) : c.mark;
    if (look > 14 && look < 30) look = autoLook(c);
    floorBase(p, c, look, area);
    if (look !== MK.catwalk && look !== MK.turn) wallShadow(p, c);
    // Стена в одну клетку ниже: её верх ложится на этот пол.
    if (!c.open(0, 1) && c.open(0, 2)) {
      const L = wallLookOf(c.markAt(0, 1), area);
      if (L.cap) L.cap(p, c, 5);
    }
    return p;
  };
}

registerCellPainter(F13_FOYER, cellPainter('foyer'));
registerCellPainter(F13_HALL, cellPainter('hall'));
registerCellPainter(F13_FLIES, cellPainter('flies'));

// ---------------------------------------------------------------------------
// Иконки вещей.
// ---------------------------------------------------------------------------

function icon(draw: (p: Px) => void): () => Px {
  let cache: Px | null = null;
  return () => {
    if (cache) return cache;
    const p = new Px(16, 16);
    draw(p);
    p.outline(INK);
    cache = p;
    return p;
  };
}

// Нить на катушке (материал этажа).
registerItemArt(
  'f13mat',
  icon((p) => {
    p.rect(4, 3, 11, 4, P.wood[2]);
    p.rect(4, 12, 11, 13, P.wood[1]);
    for (let y = 5; y < 12; y++) p.rect(5, y, 10, y, y % 2 ? P.gold[2] : P.gold[1]);
    p.set(6, 6, P.gold[3]);
    p.set(7, 8, P.gold[3]);
    p.line(10, 8, 14, 2, P.gold[2]);
  }),
);
// Шарнир куклы.
registerItemArt(
  'f13_hinge',
  icon((p) => {
    p.ell(8, 8, 3.5, 3.5, P.wood[2]);
    p.ell(7, 7, 1.5, 1.5, P.wood[3]);
    p.rect(2, 7, 4, 9, P.wood[1]);
    p.rect(12, 7, 14, 9, P.wood[1]);
    p.set(8, 8, P.brass[2]);
  }),
);
// Лоскут бархата.
registerItemArt(
  'f13_velvet',
  icon((p) => {
    for (let y = 3; y < 13; y++)
      for (let x = 3; x < 13; x++)
        if (x + y > 6 && x + y < 23) p.set(x, y, (x + y) % 4 < 2 ? P.velvet[2] : P.velvet[1]);
    p.line(4, 12, 12, 4, P.gold[2]);
  }),
);
// Маска.
registerItemArt(
  'f13_mask',
  icon((p) => {
    p.ell(8, 8, 5.5, 4.5, P.porcelain[2]);
    p.ell(6.5, 6.5, 2, 2, P.porcelain[3]);
    p.rect(5, 7, 6, 8, INK);
    p.rect(10, 7, 11, 8, INK);
    p.line(5, 10, 8, 12, P.red[2]);
    p.line(8, 12, 11, 10, P.red[2]);
  }),
);
// Билет.
registerItemArt(
  'f13_ticket',
  icon((p) => {
    p.rect(2, 5, 13, 11, P.cream[2]);
    p.rect(2, 5, 13, 5, P.cream[3]);
    p.rect(9, 5, 9, 11, P.cream[0]);
    p.rect(4, 7, 7, 7, P.red[1]);
    p.rect(4, 9, 6, 9, P.cream[0]);
    p.set(11, 8, P.gold[2]);
  }),
);
// Вага Кукловода — трофей.
registerItemArt(
  'f13_vaga',
  icon((p) => {
    p.line(3, 4, 12, 13, P.wood[2]);
    p.line(4, 4, 13, 13, P.wood[1]);
    p.line(4, 11, 11, 4, P.wood[2]);
    p.set(3, 4, P.gold[3]);
    p.set(12, 13, P.gold[3]);
    p.set(4, 11, P.gold[3]);
    p.set(11, 4, P.gold[3]);
    p.ell(8, 8, 1.5, 1.5, P.gold[2]);
  }),
);
// Леденец на палочке.
registerItemArt(
  'f13_candy',
  icon((p) => {
    p.rect(7, 9, 8, 14, P.cream[2]);
    p.ell(7.5, 6, 4.5, 4.5, P.red[2]);
    for (let a = 0; a < 6; a++) {
      const r = 1 + a * 0.6;
      p.set(7.5 + Math.cos(a * 1.4) * r, 6 + Math.sin(a * 1.4) * r, P.cream[3]);
    }
  }),
);
// Пирог из буфета.
registerItemArt(
  'f13_pie',
  icon((p) => {
    p.ell(8, 10, 6, 3.5, P.wood[3]);
    p.ell(8, 9, 5.5, 2.8, hx('#e8b868'));
    p.ell(8, 8.5, 2, 1, P.red[2]);
    p.set(5, 9, P.cream[3]);
    p.set(11, 9, P.cream[3]);
    p.rect(2, 11, 13, 11, P.wood[1]);
  }),
);

// ---------------------------------------------------------------------------
// Предметы.
// ---------------------------------------------------------------------------

/** Холст под кадр предмета, кеш по ключу. */
const PROP_CACHE = frameLRU<Sprite>(500);

function sprite(
  key: string,
  w: number,
  h: number,
  ax: number,
  ay: number,
  draw: (p: Px) => void,
  outline = true,
): Sprite {
  const hit = PROP_CACHE.get(key);
  if (hit) return hit;
  const p = new Px(w, h);
  draw(p);
  if (outline) p.outline(INK);
  return PROP_CACHE.set(key, { img: p.canvas(), ax, ay });
}

const flashed = (k: string, flash: boolean) => (flash ? `${k}!` : k);
function flashPx(p: Px): void {
  for (let i = 0; i < p.data.length; i += 4)
    if (p.data[i + 3] > 0) {
      p.data[i] = Math.min(255, p.data[i] + 120);
      p.data[i + 1] = Math.min(255, p.data[i + 1] + 120);
      p.data[i + 2] = Math.min(255, p.data[i + 2] + 120);
    }
}

/** Шар с тенью и бликом (свет сверху-слева). */
export function ball(p: Px, cx: number, cy: number, r: number, T: Tone): void {
  p.ell(cx, cy, r, r, (x, y) => {
    const dx = (x + 0.5 - cx) / r;
    const dy = (y + 0.5 - cy) / r;
    const l = -dx * 0.6 - dy * 0.7 + Math.sqrt(Math.max(0, 1 - dx * dx - dy * dy)) * 0.4;
    return l > 0.75 ? T[3] : l > 0.3 ? T[2] : l > -0.25 ? T[1] : T[0];
  });
}

/** Вертикальный цилиндр (тумба, кадка, литавра): тона по x. */
export function cyl(p: Px, x0: number, x1: number, y0: number, y1: number, T: Tone): void {
  for (let x = x0; x <= x1; x++) {
    const k = (x - x0) / Math.max(1, x1 - x0);
    const c = k < 0.18 ? T[2] : k < 0.35 ? T[3] : k < 0.75 ? T[1] : T[0];
    p.rect(x, y0, x, y1, c);
  }
}

const quant = (t: number, fps: number, n: number) => Math.floor(t * fps) % n;

function chandelierOn(o: WorldObj): boolean {
  const s = paintSim();
  const st = s ? f13State(s) : null;
  if (!st) return true;
  const c = st.chands.find(
    (q) => Math.abs(q.x - (o.x + 0.5)) < 0.1 && Math.abs(q.y - (o.y + 0.5)) < 0.1,
  );
  return c ? c.on : true;
}

// Люстра: висит высоко, свечи мерцают, хрусталь поблёскивает. Гаснет на «Премьере».
registerPropPainter('f13_chandelier', (o, time) => {
  const on = chandelierOn(o);
  const f = on ? quant(time + o.x * 0.37, 6, 6) : 0;
  return sprite(`ch:${on ? 1 : 0}:${f}`, 40, 64, 20, 64, (p) => {
    const G = P.gold;
    // Цепь вверх.
    for (let y = 0; y < 14; y++) p.set(20, y, y % 3 ? G[1] : G[2]);
    // Обод.
    p.ell(20, 26, 15, 5, G[0]);
    p.ell(20, 25, 15, 4.4, G[1]);
    p.ell(20, 25, 13, 3.2, [0, 0, 0, 0]);
    for (let x = 6; x < 34; x++)
      if (x % 3 === 0) p.set(x, 21 + Math.round(4 - Math.abs(x - 20) / 4), G[3]);
    // Рожки и свечи.
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * TAU + 0.3;
      const x = 20 + Math.cos(a) * 14;
      const y = 25 + Math.sin(a) * 4;
      p.rect(x - 0.5, y - 5, x + 0.5, y, P.cream[2]);
      if (on) {
        const fl = (f + k) % 3;
        p.set(x, y - 6, hx('#fff2b0'));
        p.set(x, y - 7 - (fl === 0 ? 1 : 0), hx('#ffb040'));
        if (fl === 2) p.set(x + 1, y - 7, hx('#ff8a20'));
      }
    }
    // Хрустальные подвески.
    for (let k = 0; k < 9; k++) {
      const x = 8 + k * 3;
      const len = 4 + Math.round(4 - Math.abs(k - 4));
      for (let y = 0; y < len; y++)
        p.set(x, 29 + y, y === len - 1 ? P.porcelain[3] : withA(P.porcelain[2], 0.8));
      if (on && (f + k) % 6 === 0) p.set(x, 29 + len - 1, WHITE);
    }
    p.ell(20, 33, 3, 4, G[2]);
    p.set(19, 32, G[3]);
    // Тень на полу.
    p.ell(20, 60, 12, 3, [0, 0, 0, on ? 50 : 70]);
  });
});

// Вешалка с костюмами.
registerPropPainter('f13_rack', (o, _t, _a, flash) =>
  sprite(flashed(`rack:${(o.x + o.y) % 3}`, flash), 28, 30, 14, 29, (p) => {
    p.rect(2, 4, 25, 5, P.brass[2]);
    p.rect(2, 4, 25, 4, P.brass[3]);
    p.rect(2, 5, 3, 28, P.brass[1]);
    p.rect(24, 5, 25, 28, P.brass[0]);
    p.rect(0, 27, 6, 28, P.brass[0]);
    p.rect(21, 27, 27, 28, P.brass[0]);
    const cols = [P.velvet, P.blue, P.green, P.gold, P.pink];
    for (let k = 0; k < 4; k++) {
      const T = cols[(k + o.x) % cols.length];
      const x = 5 + k * 5;
      p.line(x + 2, 3, x + 2, 6, P.iron[2]);
      for (let y = 6; y < 22; y++) {
        const w = y < 9 ? 2 : 2 + Math.floor((y - 9) / 4);
        p.rect(
          x + 2 - w,
          y,
          x + 2 + w,
          y,
          y === 6 ? T[2] : x + 2 - w === x + 2 - w && y % 5 === 0 ? T[0] : T[1],
        );
        p.set(x + 2 - w, y, T[2]);
      }
    }
    if (flash) flashPx(p);
  }),
);

// Стойка буфета/гардероба.
registerPropPainter('f13_counter', (_o, _t, _a, flash) =>
  sprite(flashed('counter', flash), 18, 22, 9, 21, (p) => {
    p.rect(0, 2, 17, 4, P.cream[2]);
    p.rect(0, 2, 17, 2, P.cream[3]);
    p.rect(1, 5, 16, 20, P.wood[1]);
    p.rect(1, 5, 2, 20, P.wood[2]);
    p.rect(3, 8, 14, 17, P.wood[0]);
    p.rect(4, 9, 13, 16, P.wood[2]);
    p.rect(1, 20, 16, 21, P.gold[1]);
    if (flash) flashPx(p);
  }),
);

// Столик со свечой: пламя живое.
registerPropPainter('f13_table', (o, time, _a, flash) => {
  const f = quant(time + o.y * 0.21, 8, 4);
  return sprite(flashed(`table:${f}`, flash), 18, 24, 9, 23, (p) => {
    p.ell(9, 12, 8, 3, P.cream[1]);
    p.ell(9, 11.5, 7.5, 2.5, P.cream[2]);
    p.rect(1, 12, 1, 18, P.cream[1]);
    p.rect(17, 12, 17, 18, P.cream[0]);
    p.rect(8, 14, 9, 22, P.wood[0]);
    p.rect(5, 22, 12, 23, P.wood[0]);
    p.rect(8, 6, 9, 11, P.cream[3]);
    const fy = f === 1 ? 4 : 3;
    p.set(8, fy + 1, hx('#ffb040'));
    p.set(8, fy, hx('#fff2b0'));
    p.set(9, fy + 1 + (f & 1), hx('#ff8a20'));
    p.ell(13, 10.5, 1.5, 1, P.red[2]);
    if (flash) flashPx(p);
  });
});

// Бюст на тумбе.
registerPropPainter('f13_bust', (o, _t, _a, flash) =>
  sprite(flashed(`bust:${o.x & 1}`, flash), 16, 32, 8, 31, (p) => {
    cyl(p, 3, 12, 16, 30, P.cream);
    p.rect(2, 15, 13, 16, P.cream[3]);
    p.rect(2, 29, 13, 31, P.cream[0]);
    // Голова и плечи.
    p.ell(8, 13, 5, 2.5, P.porcelain[1]);
    ball(p, 8, 7, 3.6, P.porcelain);
    if (o.x & 1) p.rect(4, 3, 11, 4, P.gold[2]);
    p.set(7, 7, P.porcelain[0]);
    p.set(9, 7, P.porcelain[0]);
    if (flash) flashPx(p);
  }),
);

// Столбик с бархатным канатом.
registerPropPainter('f13_post', (o, _t, _a, flash) =>
  sprite(flashed(`post:${o.x & 1}`, flash), 16, 22, 8, 21, (p) => {
    cyl(p, 7, 9, 5, 19, P.brass);
    ball(p, 8, 4, 2, P.brass);
    p.ell(8, 20, 3, 1.5, P.brass[1]);
    // Канат к соседу — провисает.
    for (let x = 0; x < 16; x++) {
      if (x > 6 && x < 10) continue;
      const y =
        8 +
        Math.round(Math.sin((x / 16) * Math.PI) * 0) +
        (x < 8 ? Math.round((8 - x) / 4) : Math.round((x - 8) / 4));
      p.set(x, y, P.velvet[2]);
      p.set(x, y + 1, P.velvet[0]);
    }
    if (flash) flashPx(p);
  }),
);

// Пальма в кадке.
registerPropPainter('f13_palm', (o, time, _a, flash) => {
  const f = quant(time + o.x, 2, 4);
  return sprite(flashed(`palm:${f}`, flash), 28, 36, 14, 35, (p) => {
    cyl(p, 9, 18, 26, 34, P.brass);
    p.rect(8, 25, 19, 26, P.brass[3]);
    p.rect(13, 12, 14, 25, P.wood[1]);
    p.set(13, 15, P.wood[3]);
    p.set(13, 20, P.wood[3]);
    const sw = [0, 1, 0, -1][f];
    for (let k = 0; k < 6; k++) {
      const a = Math.PI + (k / 5) * Math.PI;
      for (let s = 0; s < 11; s++) {
        const x = 13.5 + Math.cos(a) * s + sw * (s / 10);
        const y = 12 + Math.sin(a) * s * 0.55 + (s * s) / 18;
        p.set(x, y, s % 3 === 0 ? P.green[3] : P.green[2]);
        p.set(x, y + 1, P.green[0]);
      }
    }
    if (flash) flashPx(p);
  });
});

// Сундук с костюмами (бьётся).
registerPropPainter('f13_trunk', (_o, _t, _a, flash) =>
  sprite(flashed('trunk', flash), 20, 18, 10, 17, (p) => {
    p.rect(1, 4, 18, 16, P.wood[1]);
    p.rect(1, 4, 18, 6, P.wood[2]);
    p.rect(1, 2, 18, 4, P.velvet[1]);
    p.rect(1, 2, 18, 2, P.velvet[2]);
    p.rect(4, 2, 5, 16, P.brass[1]);
    p.rect(14, 2, 15, 16, P.brass[1]);
    p.rect(8, 7, 11, 10, P.brass[2]);
    p.set(9, 8, INK);
    // Торчит рукав.
    p.rect(16, 6, 19, 8, P.blue[2]);
    if (flash) flashPx(p);
  }),
);

// Корзина цветов (бьётся).
registerPropPainter('f13_flowers', (o, _t, _a, flash) =>
  sprite(flashed(`flowers:${o.x % 3}`, flash), 16, 20, 8, 19, (p) => {
    for (let y = 11; y < 19; y++)
      p.rect(
        3 - ((y - 11) >> 2),
        y,
        12 + ((y - 11) >> 2),
        y,
        (y + o.x) % 2 ? P.wood[2] : P.wood[1],
      );
    const cols = [P.red, P.pink, P.cream, P.gold];
    for (let k = 0; k < 7; k++) {
      const x = 3 + ((k * 5 + o.x) % 10);
      const y = 5 + ((k * 3) % 6);
      p.line(x, y + 2, 8, 11, P.green[1]);
      ball(p, x, y, 1.6, cols[(k + o.y) % 4]);
    }
    if (flash) flashPx(p);
  }),
);

// Мешки с песком (бьются).
registerPropPainter('f13_sandbags', (_o, _t, _a, flash) =>
  sprite(flashed('bags', flash), 20, 16, 10, 15, (p) => {
    const bag = (x: number, y: number) => {
      p.ell(x, y, 5, 3, (xx, yy) =>
        yy < y - 1 ? P.cream[2] : xx > x + 2 ? P.cream[0] : P.cream[1],
      );
      p.set(x - 4, y, P.cream[0]);
      p.rect(x + 4, y - 1, x + 5, y, P.wood[1]);
    };
    bag(6, 12);
    bag(14, 12);
    bag(10, 7);
    if (flash) flashPx(p);
  }),
);

// Бухта каната.
registerPropPainter('f13_coil', (o, _t, _a, flash) =>
  sprite(flashed(`coil:${o.x & 1}`, flash), 18, 14, 9, 13, (p) => {
    for (let k = 0; k < 4; k++) {
      p.ell(9, 9 - k * 1.6, 7 - k, 3.4 - k * 0.5, k % 2 ? P.cream[1] : P.cream[2]);
      p.ell(9, 9 - k * 1.6, 5 - k, 2 - k * 0.4, P.cream[0]);
    }
    p.ell(9, 4, 2, 1, INK);
    p.line(14, 8, 17, 12, P.cream[1]);
    if (flash) flashPx(p);
  }),
);

// Картонная декорация (бьётся): куст или облако на подпорке.
registerPropPainter('f13_flat', (o, _t, _a, flash) =>
  sprite(flashed(`flat:${(o.x + o.y) % 3}`, flash), 22, 28, 11, 27, (p) => {
    const kind = (o.x + o.y) % 3;
    p.line(15, 10, 20, 26, P.wood[1]);
    p.rect(1, 25, 21, 26, P.wood[0]);
    if (kind === 0) {
      for (let k = 0; k < 5; k++) ball(p, 5 + k * 3, 14 - ((k * 7) % 5), 5, P.forest);
      p.rect(9, 18, 11, 25, P.wood[1]);
    } else if (kind === 1) {
      for (let k = 0; k < 4; k++)
        ball(p, 5 + k * 4, 12 - (k % 2) * 3, 4.5, [
          hx('#8a86a4'),
          hx('#c4c0d8'),
          hx('#e4e0ee'),
          WHITE,
        ]);
    } else {
      p.rect(4, 6, 17, 24, P.castle[1]);
      for (let x = 4; x <= 17; x += 4) p.rect(x, 3, x + 1, 6, P.castle[2]);
      p.rect(9, 15, 12, 24, INK);
      p.rect(4, 6, 17, 6, P.castle[2]);
    }
    if (flash) flashPx(p);
  }),
);

// Висящая кукла на крюке — покачивается.
registerPropPainter('f13_hanger', (o, time) => {
  const f = quant(time * 0.7 + o.x * 0.13, 6, 8);
  return sprite(`hang:${o.x % 3}:${f}`, 20, 48, 10, 47, (p) => {
    const sw = Math.sin((f / 8) * TAU) * 2.2;
    const T = [P.velvet, P.blue, P.green][o.x % 3];
    p.line(10, 0, 10 + sw, 18, P.gold[2]);
    p.line(7, 2, 7 + sw, 20, withA(P.gold[1], 0.7));
    p.line(13, 2, 13 + sw, 20, withA(P.gold[1], 0.7));
    const x = 10 + sw;
    ball(p, x, 19, 3, P.pale);
    p.rect(x - 3, 23, x + 3, 31, T[1]);
    p.rect(x - 3, 23, x - 2, 31, T[2]);
    p.line(x - 3, 24, x - 6, 30, T[1]);
    p.line(x + 3, 24, x + 5, 30, T[0]);
    p.line(x - 2, 32, x - 3, 39, P.wood[1]);
    p.line(x + 2, 32, x + 3, 39, P.wood[0]);
    p.set(x - 1, 19, INK);
    p.set(x + 1, 19, INK);
    p.ell(10, 45, 4, 1.5, [0, 0, 0, 60]);
  });
});

// Пюпитр.
registerPropPainter('f13_stand', (o, _t, _a, flash) =>
  sprite(flashed(`stand:${o.x & 1}`, flash), 14, 22, 7, 21, (p) => {
    p.rect(6, 9, 7, 20, P.iron[2]);
    p.line(2, 21, 6, 18, P.iron[1]);
    p.line(12, 21, 8, 18, P.iron[1]);
    p.rect(1, 2, 12, 9, P.iron[1]);
    p.rect(2, 3, 11, 8, P.cream[2]);
    for (let k = 0; k < 3; k++) p.line(3, 4 + k * 2, 10, 4 + k * 2, P.cream[0]);
    p.set(5, 4, INK);
    p.set(8, 6, INK);
    if (flash) flashPx(p);
  }),
);

// Литавра: дрожит на сильную долю.
registerPropPainter('f13_timpani', (_o, time, _a, flash) => {
  const beat = F13_FX.beatLen > 0 ? (F13_FX.time % (F13_FX.beatLen * 4)) / F13_FX.beatLen : 0;
  const hit = beat < 0.35 ? 1 : 0;
  void time;
  return sprite(flashed(`timp:${hit}`, flash), 22, 22, 11, 21, (p) => {
    for (let y = 8; y < 19; y++) {
      const w = 9 - Math.round((y - 8) * 0.35);
      for (let x = -w; x <= w; x++)
        p.set(11 + x, y, x < -w * 0.4 ? P.brass[2] : x < w * 0.3 ? P.brass[1] : P.brass[0]);
    }
    p.ell(11, 8, 9.5, 3.4, P.cream[hit ? 3 : 2]);
    p.ell(11, 8, 9.5, 3.4, (x, y) =>
      Math.hypot((x - 11) / 9.5, (y - 8) / 3.4) > 0.86 ? P.brass[3] : hit ? P.cream[3] : P.cream[2],
    );
    if (hit) {
      p.ell(11, 8, 5, 1.6, P.cream[1]);
      p.ell(11, 8, 3, 1, P.cream[3]);
    }
    p.line(4, 18, 2, 21, P.iron[2]);
    p.line(18, 18, 20, 21, P.iron[2]);
    if (flash) flashPx(p);
  });
});

// Будка суфлёра: лампочка внутри мерцает, листки шуршат.
registerPropPainter('f13_booth', (o, time, _a, flash) => {
  const f = quant(time + o.x * 0.3, 5, 5);
  return sprite(flashed(`booth:${f}`, flash), 34, 26, 17, 25, (p) => {
    // Купол-раковина.
    for (let y = 2; y < 18; y++) {
      const w = Math.round(Math.sqrt(Math.max(0, 1 - ((y - 18) / 16) ** 2)) * 15);
      for (let x = -w; x <= w; x++) {
        const rib = Math.abs(Math.round(Math.atan2(y - 18, x) * 4)) % 2;
        p.set(17 + x, y, x < -w + 2 ? P.gold[2] : rib ? P.gold[1] : P.gold[0]);
      }
    }
    p.rect(3, 17, 31, 25, P.wood[0]);
    // Окно с суфлёрским светом.
    p.rect(8, 12, 26, 21, hx('#1a0c06'));
    const glow = f === 3 ? 0.55 : 0.8;
    for (let y = 12; y < 22; y++)
      for (let x = 8; x < 27; x++) {
        const d = Math.hypot((x - 17) / 10, (y - 20) / 7);
        if (d < 1) p.set(x, y, [255, 200, 110, Math.round(180 * glow * (1 - d))]);
      }
    p.rect(12, 20, 21, 21, P.cream[2]);
    p.set(13 + (f % 4) * 2, 19, P.cream[3]);
    p.rect(1, 24, 33, 25, P.gold[1]);
    if (flash) flashPx(p);
  });
});

// Софит на треноге: поворачивается в такт с лучом.
registerPropPainter('f13_spot', (o, time, _a, flash) => {
  const s = paintSim();
  let ang = Math.PI / 2;
  let on = true;
  if (s) {
    const sp = F13_FX.spots.reduce<{ d: number; i: number }>(
      (b, q, i) => {
        const d = Math.hypot(q.lx - (o.x + 0.5), q.ly - (o.y + 0.5));
        return d < b.d ? { d, i } : b;
      },
      { d: 1.5, i: -1 },
    );
    if (sp.i >= 0) {
      const q = F13_FX.spots[sp.i];
      ang = Math.atan2(q.y - q.ly, q.x - q.lx);
      on = q.on;
    }
  }
  const dir = ((Math.round((ang / TAU) * 16) % 16) + 16) % 16;
  void time;
  return sprite(flashed(`spot:${dir}:${on ? 1 : 0}`, flash), 24, 30, 12, 29, (p) => {
    p.line(12, 18, 5, 29, P.iron[2]);
    p.line(12, 18, 19, 29, P.iron[1]);
    p.line(12, 18, 12, 29, P.iron[0]);
    const a = (dir / 16) * TAU;
    const dx = Math.cos(a);
    const dy = Math.sin(a) * 0.6;
    // Корпус — цилиндр по направлению луча.
    for (let k = -4; k <= 5; k++) {
      const x = 12 + dx * k;
      const y = 13 + dy * k;
      p.ell(x, y, 3.6, 3.6, k < 0 ? P.iron[1] : P.iron[2]);
    }
    const fx = 12 + dx * 6;
    const fy = 13 + dy * 6;
    p.ell(fx, fy, 3.4, 3.4, on ? hx('#fff2c0') : P.iron[0]);
    if (on) p.ell(fx - 0.6, fy - 0.6, 1.6, 1.6, WHITE);
    p.ell(12, 13, 1.2, 1.2, P.brass[2]);
    if (flash) flashPx(p);
  });
});

/** Кулдаун действия: дорисовать «спит» (тусклый) или «готов» (блик). */
function useReady(o: WorldObj): boolean {
  const s = paintSim();
  const st = s ? f13State(s) : null;
  if (!s || !st) return true;
  const until = st.cds.get(o.id) ?? 0;
  return s.time >= until;
}

// Противовес: мешок на канате, качается; срезан — пустой крюк.
registerPropPainter('f13_weight', (o, time, _a, flash) => {
  const ready = useReady(o);
  const f = quant(time * 0.8 + o.x * 0.2, 6, 8);
  return sprite(flashed(`weight:${ready ? 1 : 0}:${f}`, flash), 22, 52, 11, 51, (p) => {
    const sw = Math.sin((f / 8) * TAU) * 1.6;
    p.line(11, 0, 11 + sw, 26, P.cream[1]);
    if (ready) {
      const x = 11 + sw;
      p.ell(x, 32, 6, 7, (xx, yy) => (yy < 28 ? P.cream[2] : xx > x + 2 ? P.cream[0] : P.cream[1]));
      p.rect(x - 2, 25, x + 2, 26, P.wood[1]);
      p.set(x - 2, 31, P.wood[0]);
      p.line(x - 1, 34, x + 2, 34, P.wood[0]);
    } else {
      p.line(11 + sw, 26, 13 + sw, 29, P.iron[2]);
    }
    // Крестовина-метка «здесь бросить» на полу.
    p.ell(11, 49, 6, 2, [0, 0, 0, 70]);
    if (ready) {
      p.set(6, 49, P.gold[2]);
      p.set(16, 49, P.gold[2]);
    }
    if (flash) flashPx(p);
  });
});

// Лебёдка занавеса.
registerPropPainter('f13_winch', (o, time, _a, flash) => {
  const ready = useReady(o);
  const f = ready ? 0 : quant(time, 8, 4);
  return sprite(flashed(`winch:${ready ? 1 : 0}:${f}`, flash), 18, 22, 9, 21, (p) => {
    p.rect(2, 10, 3, 21, P.iron[1]);
    p.rect(14, 10, 15, 21, P.iron[0]);
    p.ell(9, 13, 5, 5, P.wood[1]);
    p.ell(9, 13, 4, 4, (x, y) => ((x + y + f) % 2 ? P.velvet[1] : P.velvet[2]));
    p.ell(9, 13, 1.5, 1.5, P.brass[2]);
    const a = (f / 4) * TAU;
    p.line(9, 13, 9 + Math.cos(a) * 7, 13 + Math.sin(a) * 7, P.iron[2]);
    ball(p, 9 + Math.cos(a) * 7, 13 + Math.sin(a) * 7, 1.6, ready ? P.gold : P.wood);
    if (flash) flashPx(p);
  });
});

// Рычаг люков.
registerPropPainter('f13_lever', (o, _t, _a, flash) => {
  const ready = useReady(o);
  return sprite(flashed(`lever:${ready ? 1 : 0}`, flash), 14, 24, 7, 23, (p) => {
    p.rect(2, 17, 11, 23, P.iron[1]);
    p.rect(2, 17, 11, 17, P.iron[3]);
    p.rect(4, 19, 9, 21, hx('#a02828'));
    const tip = ready ? [3, 3] : [11, 5];
    p.line(7, 18, tip[0], tip[1], P.iron[2]);
    ball(p, tip[0], tip[1], 2, ready ? P.red : P.iron);
    if (flash) flashPx(p);
  });
});

// Пульт дирижёра с палочкой.
registerPropPainter('f13_podium', (o, time, _a, flash) => {
  const ready = useReady(o);
  const f = ready ? quant(time, 3, 2) : 0;
  return sprite(flashed(`podium:${ready ? 1 : 0}:${f}`, flash), 18, 26, 9, 25, (p) => {
    p.rect(3, 14, 14, 25, P.wood[1]);
    p.rect(3, 14, 4, 25, P.wood[2]);
    p.rect(2, 12, 15, 14, P.wood[3]);
    p.rect(2, 4, 15, 12, P.wood[0]);
    p.rect(3, 5, 14, 11, P.cream[2]);
    for (let k = 0; k < 3; k++) p.line(4, 6 + k * 2, 13, 6 + k * 2, P.cream[0]);
    if (ready) {
      p.line(12, 3, 17, 0 + f, P.cream[3]);
      p.set(17, f, WHITE);
    }
    if (flash) flashPx(p);
  });
});

// Колокол третьего звонка: качается, когда звонят.
registerPropPainter('f13_bell', (o, time, _a, flash) => {
  const ready = useReady(o);
  const s = paintSim();
  const tr = s ? f13State(s)?.turn : null;
  const ring = !!tr && tr.state === 1 && tr.t >= tr.next - 2;
  const f = !ready || ring ? quant(time, 10, 6) : 0;
  return sprite(flashed(`bell:${f}`, flash), 26, 40, 13, 39, (p) => {
    // Рама.
    p.rect(2, 4, 3, 39, P.wood[1]);
    p.rect(22, 4, 23, 39, P.wood[0]);
    p.rect(1, 2, 24, 5, P.wood[2]);
    p.rect(1, 2, 24, 2, P.wood[3]);
    const sw = [0, 1, 2, 1, 0, -1][f] * 0.18;
    const cx = 13;
    const cy = 8;
    for (let y = 0; y < 20; y++) {
      const w = 3 + Math.round(y * 0.42 + (y > 15 ? (y - 15) * 0.8 : 0));
      for (let x = -w; x <= w; x++) {
        const X = cx + x + Math.sin(sw) * y;
        const k = (x + w) / (2 * w);
        p.set(
          X,
          cy + y,
          k < 0.2 ? P.brass[3] : k < 0.45 ? P.brass[2] : k < 0.8 ? P.brass[1] : P.brass[0],
        );
      }
    }
    p.rect(cx - 12 + Math.sin(sw) * 20, cy + 20, cx + 12 + Math.sin(sw) * 20, cy + 20, P.brass[0]);
    ball(p, cx + Math.sin(sw * 2.4) * 20, cy + 21, 2, P.iron);
    if (flash) flashPx(p);
  });
});

// Стопор пожарного занавеса.
registerPropPainter('f13_stopper', (o, _t, _a, flash) => {
  const ready = useReady(o);
  return sprite(flashed(`stop:${ready ? 1 : 0}`, flash), 16, 22, 8, 21, (p) => {
    p.rect(3, 6, 12, 21, P.steel[1]);
    p.rect(3, 6, 4, 21, P.steel[2]);
    p.rect(3, 6, 12, 7, P.steel[3]);
    for (let y = 9; y < 20; y += 3) p.rect(5, y, 10, y, ((y / 3) | 0) % 2 ? hx('#d8b030') : INK);
    p.ell(8, 4, 4, 2.4, ready ? hx('#c82828') : P.iron[1]);
    p.set(7, 3, ready ? hx('#ff8a7a') : P.iron[2]);
    if (flash) flashPx(p);
  });
});

// ---- на стене --------------------------------------------------------------

// Канаты с мешками на рейке — висят на лице стены колосников.
registerPropPainter('f13_ropes', (o, time) => {
  const f = quant(time * 0.5 + o.x * 0.7, 4, 6);
  return sprite(`ropes:${f}`, 16, 26, 8, 16, (p) => {
    const sw = Math.sin((f / 6) * TAU);
    for (let k = 0; k < 2; k++) {
      const x = 4 + k * 8;
      p.line(x, 0, x + sw * (k ? -1 : 1), 18, P.cream[2]);
      ball(p, x + sw * (k ? -1 : 1), 20, 2.6, P.cream);
    }
  });
});

// Афиша спектакля.
registerPropPainter('f13_poster', (o) =>
  sprite(`poster:${(o.x + o.y) % 4}`, 14, 16, 7, 14, (p) => {
    const k = (o.x + o.y) % 4;
    const bg = [P.cream, P.pink, P.gold, P.porcelain][k];
    p.rect(1, 1, 12, 14, P.gold[1]);
    p.rect(2, 2, 11, 13, bg[2]);
    p.rect(2, 2, 11, 3, P.red[1]);
    // Силуэт куклы с нитями.
    p.line(6, 4, 6, 7, INK);
    p.line(8, 4, 8, 7, INK);
    p.ell(7, 8, 1.5, 1.5, INK);
    p.rect(6, 10, 8, 12, k % 2 ? P.red[2] : P.blue[2]);
    p.rect(3, 12, 4, 12, INK);
    p.rect(9, 12, 10, 12, INK);
  }),
);

// Зеркало в золотой раме — в нём отблеск.
registerPropPainter('f13_mirror', (o, time) => {
  const f = quant(time * 0.4 + o.x, 3, 10);
  return sprite(
    `mirror:${f}`,
    14,
    16,
    7,
    15,
    (p) => {
      p.ell(7, 8, 6, 7.5, P.gold[1]);
      p.ell(7, 8, 4.6, 6, (x, y) => mixc(hx('#3a4458'), hx('#8a9ab4'), clamp01((x - y + 8) / 14)));
      p.set(7, 0, P.gold[3]);
      if (f < 3) {
        p.line(4 + f * 2, 4, 6 + f * 2, 2, WHITE);
        p.line(4 + f * 2, 6, 7 + f * 2, 3, withA(WHITE, 0.6));
      }
    },
    false,
  );
});

// Камин с огнём.
registerPropPainter('f13_fireplace', (o, time) => {
  const f = quant(time + o.x * 0.17, 8, 6);
  return sprite(
    `fire:${f}`,
    16,
    16,
    8,
    16,
    (p) => {
      p.rect(0, 0, 15, 2, P.cream[3]);
      p.rect(0, 3, 2, 15, P.cream[2]);
      p.rect(13, 3, 15, 15, P.cream[1]);
      p.rect(3, 5, 12, 15, hx('#100604'));
      p.rect(4, 13, 11, 14, P.wood[0]);
      for (let k = 0; k < 4; k++) {
        const h = 3 + ((f + k * 2) % 5);
        const x = 5 + k * 2;
        for (let y = 0; y < h; y++)
          p.set(
            x + (y > 2 ? (f + k) % 2 : 0),
            13 - y,
            y < 2 ? hx('#ffe080') : y < 4 ? hx('#ff9a30') : hx('#c84018'),
          );
      }
    },
    false,
  );
});

// Окошко кассы: лампа, табличка.
registerPropPainter('f13_kassa', (o, time) => {
  const f = quant(time + o.y, 2, 5);
  return sprite(
    `kassa:${f}`,
    16,
    16,
    8,
    16,
    (p) => {
      p.rect(1, 1, 14, 15, P.wood[1]);
      p.rect(1, 1, 14, 3, P.gold[2]);
      p.rect(3, 5, 12, 12, hx('#2a1a08'));
      for (let y = 5; y < 13; y++)
        for (let x = 3; x < 13; x++) p.set(x, y, [255, 200, 120, f === 4 ? 60 : 110]);
      p.rect(3, 13, 12, 14, P.cream[2]);
      p.rect(7, 5, 8, 12, P.wood[0]);
    },
    false,
  );
});

// Маски театра на стене.
registerPropPainter('f13_masks', (o) =>
  sprite(`masks:${o.x & 1}`, 16, 16, 8, 15, (p) => {
    p.ell(5.5, 7, 4, 4.6, P.gold[2]);
    p.ell(10.5, 8.5, 4, 4.6, P.silver[2]);
    p.set(4, 6, INK);
    p.set(7, 6, INK);
    p.line(4, 9, 7, 9, INK);
    p.set(3, 8, INK);
    p.set(8, 8, INK);
    p.set(9, 8, INK);
    p.set(12, 8, INK);
    p.line(9, 11, 12, 11, INK);
    p.set(8, 12, INK);
    p.set(13, 12, INK);
    p.line(2, 12, 0, 15, P.velvet[2]);
    p.line(14, 13, 15, 15, P.velvet[2]);
  }),
);

// ---------------------------------------------------------------------------
// Риг кукол: капсулы, шары и диски в 3D, буфер глубины, свет сверху-слева.
// ---------------------------------------------------------------------------

export interface V3 {
  x: number;
  y: number;
  z: number;
}
export const v3 = (x: number, y: number, z: number): V3 => ({ x, y, z });
export const vadd = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const vsc = (a: V3, k: number): V3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
export const vmix = (a: V3, b: V3, k: number): V3 => ({
  x: a.x + (b.x - a.x) * k,
  y: a.y + (b.y - a.y) * k,
  z: a.z + (b.z - a.z) * k,
});
const vlen = (a: V3) => Math.hypot(a.x, a.y, a.z);
export const vnorm = (a: V3): V3 => vsc(a, 1 / (vlen(a) || 1));
const vsub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const vcross = (a: V3, b: V3): V3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const vdot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;

/** Вокруг оси X: +a наклоняет «вверх» к «вперёд». */
const rotX = (v: V3, a: number): V3 => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: v.x, y: v.y * c - v.z * s, z: v.y * s + v.z * c };
};
/** Вокруг оси Y: +a поворачивает «вперёд» к «вправо». */
const rotY = (v: V3, a: number): V3 => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c };
};
/** Вокруг оси Z: +a клонит «вверх» вправо. */
const rotZ = (v: V3, a: number): V3 => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: v.x * c + v.y * s, y: -v.x * s + v.y * c, z: v.z };
};

/**
 * Узор поверхности: t — вдоль оси, nx/ny — нормаль на экране, nm — нормаль
 * в осях модели (для узора, привязанного к телу: манишка только спереди).
 */
export type Pat = (t: number, nx: number, ny: number, nm: V3) => Tone | RGBA | null;

/** Свечение: true — целиком в слой поверх темноты, число — долей (0…1). */
type Glow = boolean | number;

interface Cap {
  k: 0;
  a: V3;
  b: V3;
  r0: number;
  r1: number;
  T: Tone;
  pat?: Pat;
  glow?: Glow;
}
interface Disc {
  k: 1;
  c: V3;
  r: number;
  h: number;
  T: Tone;
  pat?: (u: number, v: number, side: boolean) => Tone | RGBA | null;
  glow?: Glow;
}
interface Dot {
  k: 2;
  a: V3;
  c: RGBA;
  s: number;
  glow?: Glow;
}
/** Цилиндр с плоскими торцами (тулья и поля цилиндра): точки поверхности. */
interface Cyl {
  k: 3;
  a: V3;
  b: V3;
  r: number;
  T: Tone;
  /** Тон по доле высоты (лента): null — основной. Торцы — t 0 и 1. */
  band?: (t: number) => Tone | null;
  glow?: Glow;
  bias: number;
}
/** Плоский лоскут (фалды фрака): четыре угла по кругу, виден с двух сторон. */
interface Quad {
  k: 4;
  p: [V3, V3, V3, V3];
  T: Tone;
  pat?: (u: number, v: number) => Tone | RGBA | null;
  glow?: Glow;
  bias: number;
}
type Prim = Cap | Disc | Dot | Cyl | Quad;

/** Сжатие глубины пола (вид в три четверти) и вес высоты в глубине. */
const DEPTH = 0.56;

export class Rig {
  prims: Prim[] = [];
  cap(a: V3, b: V3, r0: number, r1: number, T: Tone, pat?: Pat, glow: Glow = false): this {
    this.prims.push({ k: 0, a, b, r0, r1, T, pat, glow });
    return this;
  }
  ball(c: V3, r: number, T: Tone, pat?: Pat, glow: Glow = false): this {
    return this.cap(c, c, r, r, T, pat, glow);
  }
  disc(c: V3, r: number, h: number, T: Tone, pat?: Disc['pat'], glow: Glow = false): this {
    this.prims.push({ k: 1, c, r, h, T, pat, glow });
    return this;
  }
  dot(a: V3, c: RGBA, s = 1, glow: Glow = false): this {
    this.prims.push({ k: 2, a, c, s, glow });
    return this;
  }
  /** Цилиндр от `a` до `b` с плоскими торцами; `bias` — на сколько ближе к глазу. */
  cyl(a: V3, b: V3, r: number, T: Tone, band?: Cyl['band'], glow: Glow = false, bias = 0.4): this {
    this.prims.push({ k: 3, a, b, r, T, band, glow, bias });
    return this;
  }
  /** Лоскут по четырём углам (p00, p10, p11, p01). */
  quad(
    p00: V3,
    p10: V3,
    p11: V3,
    p01: V3,
    T: Tone,
    pat?: Quad['pat'],
    glow: Glow = false,
    bias = 0.6,
  ): this {
    this.prims.push({ k: 4, p: [p00, p10, p11, p01], T, pat, glow, bias });
    return this;
  }
}

/** Проекция рига (та же, что в `renderRig`): точка модели → [x, y, глубина]. */
export function rigProj(
  yaw: number,
  S: number,
  ax: number,
  ay: number,
): (p: V3) => [number, number, number] {
  const fx = Math.cos(yaw);
  const fy = Math.sin(yaw);
  const rx = -fy;
  const ry = fx;
  return (p) => {
    const gx = (p.x * rx + p.z * fx) * S;
    const gy = (p.x * ry + p.z * fy) * S;
    return [ax + gx, ay + gy * DEPTH - p.y * S, gy * 0.77 + p.y * S * 0.64];
  };
}

export interface RigOut {
  px: Px;
  /** Слой поверх темноты: светящиеся части (вага, глаза тени). */
  lit: Px | null;
  /** Первая видимая светящаяся точка — «глаз» для движка. */
  eye: [number, number] | null;
  /** Номер примитива в каждом пикселе (−1 — пусто): контровой свет, обрезка. */
  ids?: Int16Array;
  /** Рамка нарисованного вместе с контуром: x0, y0, x1, y1 включительно (пусто — x1 < x0). */
  box?: [number, number, number, number];
}

export interface RenderOpt {
  flash?: boolean;
  /** Подмешать цвет ко всему (элита — золото, тень — фиолет). */
  tint?: RGBA;
  tintK?: number;
  /** Без контура (призрачное). */
  noOutline?: boolean;
  /** Масштаб модели (исполин — 2). */
  scale?: number;
}

/** Буферы рисования рига: глубина, номер части, цвет, свечение. */
export interface RigScr {
  n: number;
  zb: Float32Array;
  idb: Int16Array;
  col: Uint8ClampedArray;
  glowB: Uint8Array;
}
export const rigScr = (): RigScr => ({
  n: 0,
  zb: new Float32Array(0),
  idb: new Int16Array(0),
  col: new Uint8ClampedArray(0),
  glowB: new Uint8Array(0),
});
/** Общие — для кадра, нарисованного сразу; свои — у кадра «на потом». */
const RIG_SCR = rigScr();
function scrFor(B: RigScr, N: number): RigScr {
  if (B.n < N) {
    B.n = N;
    B.zb = new Float32Array(N);
    B.idb = new Int16Array(N);
    B.col = new Uint8ClampedArray(N * 4);
    B.glowB = new Uint8Array(N);
  }
  return B;
}

/** Нарисовать риг на холст w×h; (ax, ay) — точка ног. */
export function renderRig(
  rig: Rig,
  yaw: number,
  w: number,
  h: number,
  ax: number,
  ay: number,
  opt: RenderOpt = {},
): RigOut {
  return rigJob(rig, yaw, w, h, ax, ay, opt).out();
}

/**
 * Кадр рига по частям: `step(мс)` рисует части, пока не кончится бюджет
 * (`true` — готов), `out()` дорисовывает остаток сразу. Кадр «на потом» —
 * со своими буферами (`own`): между шагами рисуют другие. Итог тот же, что
 * у `renderRig`, до пикселя.
 */
export interface RigJob {
  step: (ms: number) => boolean;
  out: () => RigOut;
}
export function rigJob(
  rig: Rig,
  yaw: number,
  w: number,
  h: number,
  ax: number,
  ay: number,
  opt: RenderOpt = {},
  own?: RigScr,
): RigJob {
  const S = opt.scale ?? 1;
  const fx = Math.cos(yaw);
  const fy = Math.sin(yaw);
  const rx = -fy;
  const ry = fx;
  const proj = (p: V3): [number, number, number] => {
    const gx = (p.x * rx + p.z * fx) * S;
    const gy = (p.x * ry + p.z * fy) * S;
    return [ax + gx, ay + gy * DEPTH - p.y * S, gy * 0.77 + p.y * S * 0.64];
  };
  const N = w * h;
  // Буферы общие на все вызовы (рисуем по одному кадру за раз): без мусора.
  // `ids` из ответа живёт до следующего `renderRig` (у своих — до следующей
  // работы в них).
  const { zb, idb, col, glowB } = scrFor(own ?? RIG_SCR, N);
  zb.fill(-1e9, 0, N);
  idb.fill(-1, 0, N);
  glowB.fill(0, 0, N);
  let eye: [number, number] | null = null;
  const put = (i: number, c: RGBA, z: number, id: number, glow: Glow | undefined) => {
    zb[i] = z;
    idb[i] = id;
    col[i * 4] = c[0];
    col[i * 4 + 1] = c[1];
    col[i * 4 + 2] = c[2];
    col[i * 4 + 3] = c[3];
    glowB[i] = glow === true ? 255 : glow ? Math.round(clamp01(glow) * 255) : 0;
  };
  const band = (T: Tone, l: number): RGBA =>
    l > 0.8 ? T[3] : l > 0.36 ? T[2] : l > -0.08 ? T[1] : T[0];
  // Орты экрана в осях модели: вправо, вниз по экрану, к глазу.
  const scrR = v3(rx, 0, fx);
  const scrD = v3(0.64 * ry, -0.77, 0.64 * fy);
  const scrV = v3(0.77 * ry, 0.64, 0.77 * fy);
  const lightOf = (n: V3) => -0.5 * vdot(n, scrR) - 0.62 * vdot(n, scrD) + 0.6 * vdot(n, scrV);
  const isRGBA = (v: Tone | RGBA): v is RGBA => typeof v[0] === 'number';
  /** Точка поверхности (цилиндр, лоскут) — в свой пиксель, если ближе. */
  const splat = (p: V3, c: RGBA, bias: number, id: number, glow: Glow | undefined) => {
    const [x, y, d] = proj(p);
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    if (xi < 0 || yi < 0 || xi >= w || yi >= h) return;
    const i = yi * w + xi;
    const z = d + bias;
    if (z <= zb[i]) return;
    put(i, c, z, id, glow);
  };
  const STEP = 0.42 / S;
  const drawPrim = (q: Prim, id: number): void => {
    if (q.k === 0) {
      const [x0, y0, d0] = proj(q.a);
      const [x1, y1, d1] = proj(q.b);
      const r0 = q.r0 * S;
      const r1 = q.r1 * S;
      const R = Math.max(r0, r1);
      const bx0 = Math.max(0, Math.floor(Math.min(x0, x1) - R - 1));
      const bx1 = Math.min(w - 1, Math.ceil(Math.max(x0, x1) + R + 1));
      const by0 = Math.max(0, Math.floor(Math.min(y0, y1) - R - 1));
      const by1 = Math.min(h - 1, Math.ceil(Math.max(y0, y1) + R + 1));
      const ex = x1 - x0;
      const ey = y1 - y0;
      const L2 = ex * ex + ey * ey;
      for (let py = by0; py <= by1; py++)
        for (let px = bx0; px <= bx1; px++) {
          const cx = px + 0.5;
          const cy = py + 0.5;
          let t = L2 > 1e-6 ? ((cx - x0) * ex + (cy - y0) * ey) / L2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const dx = cx - (x0 + ex * t);
          const dy = cy - (y0 + ey * t);
          const rr = r0 + (r1 - r0) * t;
          const d2 = dx * dx + dy * dy;
          if (d2 > rr * rr || rr <= 0.05) continue;
          const nx = dx / rr;
          const ny = dy / rr;
          const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
          const z = d0 + (d1 - d0) * t + nz * rr * 0.9;
          const i = py * w + px;
          if (z <= zb[i]) continue;
          const l = -0.5 * nx - 0.62 * ny + 0.6 * nz;
          // Нормаль модели считаем только узорам, которые её просят.
          const pv = q.pat
            ? q.pat.length >= 4
              ? q.pat(t, nx, ny, {
                  x: scrR.x * nx + scrD.x * ny + scrV.x * nz,
                  y: scrD.y * ny + scrV.y * nz,
                  z: scrR.z * nx + scrD.z * ny + scrV.z * nz,
                })
              : q.pat(t, nx, ny, scrV)
            : null;
          const c = pv
            ? pv.length === 4 && typeof pv[0] === 'number'
              ? (pv as RGBA)
              : band(pv as Tone, l)
            : band(q.T, l);
          put(i, c, z, id, q.glow);
        }
    } else if (q.k === 1) {
      const [cx, cy, dc] = proj(q.c);
      const r = q.r * S;
      const ry2 = r * DEPTH;
      const hh = q.h * S;
      const bx0 = Math.max(0, Math.floor(cx - r - 1));
      const bx1 = Math.min(w - 1, Math.ceil(cx + r + 1));
      const by0 = Math.max(0, Math.floor(cy - ry2 - 1));
      const by1 = Math.min(h - 1, Math.ceil(cy + ry2 + hh + 1));
      for (let py = by0; py <= by1; py++)
        for (let px = bx0; px <= bx1; px++) {
          const u = (px + 0.5 - cx) / r;
          const v = (py + 0.5 - cy) / ry2;
          const i = py * w + px;
          if (u * u + v * v <= 1) {
            const z = dc + v * r * 0.77 + 0.3;
            if (z <= zb[i]) continue;
            const rim = u * u + v * v > 0.72;
            const pv = q.pat ? q.pat(u, v, false) : null;
            const base = pv
              ? pv.length === 4 && typeof pv[0] === 'number'
                ? (pv as RGBA)
                : (pv as Tone)[2]
              : q.T[2];
            const c =
              rim && !(pv && pv.length === 4 && typeof pv[0] === 'number')
                ? u + v < 0
                  ? q.T[3]
                  : q.T[1]
                : base;
            put(i, c, z, id, q.glow);
            continue;
          }
          if (Math.abs(u) > 1 || hh <= 0) continue;
          const vb = Math.sqrt(1 - u * u);
          const yb = cy + vb * ry2;
          if (py + 0.5 < cy || py + 0.5 > yb + hh) continue;
          const z = dc + vb * r * 0.77;
          if (z <= zb[i]) continue;
          const pv = q.pat ? q.pat(u, 1, true) : null;
          const T = pv && !(pv.length === 4 && typeof pv[0] === 'number') ? (pv as Tone) : q.T;
          const c =
            pv && pv.length === 4 && typeof pv[0] === 'number'
              ? (pv as RGBA)
              : u < -0.55
                ? T[2]
                : u < 0.35
                  ? T[1]
                  : T[0];
          put(i, c, z, id, q.glow);
        }
    } else if (q.k === 3) {
      // Цилиндр: бок и торцы точками чаще пикселя — края резкие, торец плоский.
      const W = vsub(q.b, q.a);
      const L = vlen(W) || 1e-6;
      const wv = vsc(W, 1 / L);
      const u0 = vnorm(Math.abs(wv.y) < 0.9 ? vcross(wv, v3(0, 1, 0)) : vcross(wv, v3(1, 0, 0)));
      const v0 = vcross(wv, u0);
      const bias = q.bias * S;
      const nt = Math.max(2, Math.ceil(L / STEP) + 1);
      const na = Math.max(10, Math.ceil((TAU * q.r) / STEP));
      for (let ia = 0; ia < na; ia++) {
        const th = (ia / na) * TAU;
        const n = vadd(vsc(u0, Math.cos(th)), vsc(v0, Math.sin(th)));
        if (vdot(n, scrV) < -0.2) continue;
        const l = lightOf(n);
        const side = vsc(n, q.r);
        for (let it = 0; it < nt; it++) {
          const tt = it / (nt - 1);
          const T = q.band?.(tt) ?? q.T;
          splat(vadd(vadd(q.a, vsc(W, tt)), side), band(T, l), bias, id, q.glow);
        }
      }
      for (const top of [true, false]) {
        const n = top ? wv : vsc(wv, -1);
        if (vdot(n, scrV) < -0.05) continue;
        const c0 = top ? q.b : q.a;
        const T = q.band?.(top ? 1 : 0) ?? q.T;
        const l = lightOf(n);
        for (let rr = 0; rr <= q.r + 1e-6; rr += STEP) {
          const nr = Math.max(1, Math.ceil((TAU * rr) / STEP));
          // Кромка торца на тон светлее — цилиндр читается плоским верхом.
          const c = band(T, rr > q.r - STEP * 1.5 && top ? l + 0.35 : l);
          for (let k = 0; k < nr; k++) {
            const th = (k / nr) * TAU;
            splat(
              vadd(c0, vadd(vsc(u0, Math.cos(th) * rr), vsc(v0, Math.sin(th) * rr))),
              c,
              bias,
              id,
              q.glow,
            );
          }
        }
      }
    } else if (q.k === 4) {
      const [p00, p10, p11, p01] = q.p;
      const du = vadd(vsub(p10, p00), vsub(p11, p01));
      const dv = vadd(vsub(p01, p00), vsub(p11, p10));
      let n = vnorm(vcross(du, dv));
      if (vdot(n, scrV) < 0) n = vsc(n, -1);
      const l = lightOf(n);
      const lu = Math.max(vlen(vsub(p10, p00)), vlen(vsub(p11, p01)));
      const lv = Math.max(vlen(vsub(p01, p00)), vlen(vsub(p11, p10)));
      const nu = Math.max(2, Math.ceil(lu / STEP) + 1);
      const nv = Math.max(2, Math.ceil(lv / STEP) + 1);
      const bias = q.bias * S;
      for (let iu = 0; iu < nu; iu++) {
        const u = iu / (nu - 1);
        const a = vmix(p00, p10, u);
        const b = vmix(p01, p11, u);
        for (let iv = 0; iv < nv; iv++) {
          const v = iv / (nv - 1);
          const pv = q.pat ? q.pat(u, v) : null;
          const c = pv ? (isRGBA(pv) ? pv : band(pv, l)) : band(q.T, l);
          splat(vmix(a, b, v), c, bias, id, q.glow);
        }
      }
    } else {
      const [x, y, d] = proj(q.a);
      const s = Math.max(1, Math.round(q.s * S));
      const X0 = Math.round(x - s / 2);
      const Y0 = Math.round(y - s / 2);
      for (let yy = Y0; yy < Y0 + s; yy++)
        for (let xx = X0; xx < X0 + s; xx++) {
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const i = yy * w + xx;
          if (d + 1.6 * S < zb[i]) continue;
          put(i, q.c, Math.max(zb[i], d), idb[i] >= 0 ? idb[i] : id, q.glow);
          if (q.glow && !eye) eye = [xx, yy];
        }
    }
  };
  const finish = (): RigOut => {
    // Рамка нарисованного: дальше всё считается только в ней (+1 на контур) —
    // у больших холстов (Кукловод, исполин) пустые поля стоили больше рисунка.
    let bx0 = w;
    let by0 = h;
    let bx1 = -1;
    let by1 = -1;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++)
        if (idb[row + x] >= 0) {
          if (x < bx0) bx0 = x;
          if (x > bx1) bx1 = x;
          if (y < by0) by0 = y;
          if (y > by1) by1 = y;
        }
    }
    const px = new Px(w, h);
    const out = px.data;
    if (bx1 < 0) return { px, lit: null, eye, ids: idb, box: [0, 0, -1, -1] };
    bx0 = Math.max(0, bx0 - 1);
    by0 = Math.max(0, by0 - 1);
    bx1 = Math.min(w - 1, bx1 + 1);
    by1 = Math.min(h - 1, by1 + 1);
    const tint = opt.tint;
    const tk = opt.tintK ?? 0;
    for (let y = by0; y <= by1; y++)
      for (let i = y * w + bx0, e = y * w + bx1; i <= e; i++) {
        if (idb[i] < 0) continue;
        let r = col[i * 4];
        let g = col[i * 4 + 1];
        let b = col[i * 4 + 2];
        // Внутренний контур: дальняя часть у края ближней темнеет.
        const x = i % w;
        const z = zb[i];
        const id = idb[i];
        const near = (j: number) => idb[j] >= 0 && idb[j] !== id && zb[j] - z > 2.4 * S;
        if (
          (x > 0 && near(i - 1)) ||
          (x < w - 1 && near(i + 1)) ||
          (i >= w && near(i - w)) ||
          (i < N - w && near(i + w))
        ) {
          r = r * 0.45 + INK[0] * 0.55;
          g = g * 0.45 + INK[1] * 0.55;
          b = b * 0.45 + INK[2] * 0.55;
        }
        if (tint && tk > 0) {
          r += (tint[0] - r) * tk;
          g += (tint[1] - g) * tk;
          b += (tint[2] - b) * tk;
        }
        out[i * 4] = r;
        out[i * 4 + 1] = g;
        out[i * 4 + 2] = b;
        out[i * 4 + 3] = col[i * 4 + 3];
      }
    if (!opt.noOutline) {
      // То же, что `px.outline(INK)`, но в рамке и без вызова на пиксель.
      const add: number[] = [];
      const A = (j: number) => out[j * 4 + 3] > 0;
      for (let y = by0; y <= by1; y++)
        for (let x = bx0; x <= bx1; x++) {
          const i = y * w + x;
          if (A(i)) continue;
          if (
            (x > 0 && A(i - 1)) ||
            (x < w - 1 && A(i + 1)) ||
            (y > 0 && A(i - w)) ||
            (y < h - 1 && A(i + w))
          )
            add.push(i);
        }
      for (const i of add) {
        out[i * 4] = INK[0];
        out[i * 4 + 1] = INK[1];
        out[i * 4 + 2] = INK[2];
        out[i * 4 + 3] = 255;
      }
    }
    if (opt.flash) flashPx(px);
    let lit: Px | null = null;
    for (let y = by0; y <= by1; y++)
      for (let i = y * w + bx0, e = y * w + bx1; i <= e; i++)
        if (glowB[i]) {
          lit ??= new Px(w, h);
          lit.data[i * 4] = out[i * 4];
          lit.data[i * 4 + 1] = out[i * 4 + 1];
          lit.data[i * 4 + 2] = out[i * 4 + 2];
          lit.data[i * 4 + 3] =
            glowB[i] === 255 ? out[i * 4 + 3] : (out[i * 4 + 3] * glowB[i]) / 255;
        }
    return { px, lit, eye, ids: idb, box: [bx0, by0, bx1, by1] };
  };
  const prims = rig.prims;
  let next = 0;
  let res: RigOut | null = null;
  const step = (ms: number): boolean => {
    if (res) return true;
    const t0 = performance.now();
    while (next < prims.length) {
      drawPrim(prims[next], next);
      next++;
      if (performance.now() - t0 > ms) return false;
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

// ---------------------------------------------------------------------------
// Человечек-марионетка: суставы из чисел позы.
// ---------------------------------------------------------------------------

export interface Limb {
  /** Мах вперёд (+) / назад (−) от вертикали вниз. */
  sw: number;
  /** Отвод в сторону. */
  out: number;
  /** Сгиб локтя (вперёд) или колена (назад). */
  bend: number;
}
export interface Pose {
  bob: number;
  lean: number;
  side: number;
  twist: number;
  hp: number;
  hy: number;
  hr: number;
  aL: Limb;
  aR: Limb;
  lL: Limb;
  lR: Limb;
  /** Опустить таз (присед, падение), пиксели. */
  sink: number;
  /** Носок вниз, радианы (висит на нитях — ступни свисают). Нет — 0. */
  toe?: number;
}
export const limb = (sw = 0, out = 0, bend = 0): Limb => ({ sw, out, bend });
export const pose0 = (): Pose => ({
  bob: 0,
  lean: 0,
  side: 0,
  twist: 0,
  hp: 0,
  hy: 0,
  hr: 0,
  aL: limb(0, 0.12, 0.2),
  aR: limb(0, 0.12, 0.2),
  lL: limb(0, 0.05, 0.05),
  lR: limb(0, 0.05, 0.05),
  sink: 0,
});

export interface Body {
  hip: number;
  torso: number;
  waist: number;
  chest: number;
  neck: number;
  head: number;
  shW: number;
  upper: number;
  fore: number;
  armR: number;
  hand: number;
  hipW: number;
  thigh: number;
  shin: number;
  legR: number;
  foot: number;
  T: {
    torso: Tone;
    arm: Tone;
    leg: Tone;
    head: Tone;
    hand: Tone;
    foot: Tone;
    joint: Tone;
    pelvis: Tone;
  };
  torsoPat?: Pat;
  armPat?: Pat;
  legPat?: Pat;
  /** Шарниры-шарики на локтях и коленях — кукла. */
  joints?: boolean;
}

export interface Joints {
  pelvis: V3;
  chest: V3;
  neck: V3;
  head: V3;
  up: V3;
  fwd: V3;
  right: V3;
  hUp: V3;
  hFwd: V3;
  hRight: V3;
  shL: V3;
  shR: V3;
  elL: V3;
  elR: V3;
  haL: V3;
  haR: V3;
  hpL: V3;
  hpR: V3;
  knL: V3;
  knR: V3;
  anL: V3;
  anR: V3;
  /** Направление предплечья (для оружия в руке). */
  foreL: V3;
  foreR: V3;
}

function limbDir(l: Limb, side: number, extra: number): V3 {
  const o = l.out * side;
  const d = v3(Math.sin(o), -Math.cos(o), 0);
  return rotX(d, -(l.sw + extra));
}

const inFrame = (d: V3, right: V3, up: V3, fwd: V3): V3 =>
  vadd(vadd(vsc(right, d.x), vsc(up, d.y)), vsc(fwd, d.z));

/** Собрать человечка в риг; вернуть суставы для оружия и украшений. */
export function humanoid(
  rig: Rig,
  b: Body,
  q: Pose,
  skip: { head?: boolean; legs?: boolean; arms?: boolean } = {},
): Joints {
  // Таз: свой поворот (на треть от торса), ноги — от него.
  const pR = rotY(v3(1, 0, 0), q.twist * 0.3);
  const pF = rotY(v3(0, 0, 1), q.twist * 0.3);
  const pU = v3(0, 1, 0);
  const pelvis = v3(0, b.hip + q.bob - q.sink, 0);
  // Торс: поворот → наклон вперёд → крен.
  const tf = (v: V3) => rotZ(rotX(rotY(v, q.twist), q.lean), q.side);
  const right = tf(v3(1, 0, 0));
  const up = tf(v3(0, 1, 0));
  const fwd = tf(v3(0, 0, 1));
  const chest = vadd(pelvis, vsc(up, b.torso));
  const neck = vadd(chest, vsc(up, b.neck));
  const hf = (v: V3) => tf(rotZ(rotX(rotY(v, q.hy), q.hp), q.hr));
  const hUp = hf(v3(0, 1, 0));
  const hFwd = hf(v3(0, 0, 1));
  const hRight = hf(v3(1, 0, 0));
  const head = vadd(neck, vsc(hUp, b.head * 0.92));
  const shL = vadd(vadd(chest, vsc(right, -b.shW)), vsc(up, -b.chest * 0.25));
  const shR = vadd(vadd(chest, vsc(right, b.shW)), vsc(up, -b.chest * 0.25));
  const dUL = inFrame(limbDir(q.aL, -1, 0), right, up, fwd);
  const dUR = inFrame(limbDir(q.aR, 1, 0), right, up, fwd);
  const elL = vadd(shL, vsc(dUL, b.upper));
  const elR = vadd(shR, vsc(dUR, b.upper));
  const foreL = inFrame(limbDir(q.aL, -1, q.aL.bend), right, up, fwd);
  const foreR = inFrame(limbDir(q.aR, 1, q.aR.bend), right, up, fwd);
  const haL = vadd(elL, vsc(foreL, b.fore));
  const haR = vadd(elR, vsc(foreR, b.fore));
  const hpL = vadd(pelvis, vsc(pR, -b.hipW));
  const hpR = vadd(pelvis, vsc(pR, b.hipW));
  const tL = inFrame(limbDir(q.lL, -1, 0), pR, pU, pF);
  const tR = inFrame(limbDir(q.lR, 1, 0), pR, pU, pF);
  const knL = vadd(hpL, vsc(tL, b.thigh));
  const knR = vadd(hpR, vsc(tR, b.thigh));
  const sL = inFrame(limbDir(q.lL, -1, -q.lL.bend), pR, pU, pF);
  const sR = inFrame(limbDir(q.lR, 1, -q.lR.bend), pR, pU, pF);
  const anL = vadd(knL, vsc(sL, b.shin));
  const anR = vadd(knR, vsc(sR, b.shin));
  const T = b.T;
  if (!skip.legs) {
    const toe = q.toe ?? 0;
    const fc = Math.cos(toe);
    const fs = Math.sin(toe);
    for (const [hp, kn, an] of [
      [hpL, knL, anL],
      [hpR, knR, anR],
    ]) {
      rig.cap(hp, kn, b.legR * 1.1, b.legR, T.leg, b.legPat);
      rig.cap(kn, an, b.legR, b.legR * 0.85, T.leg, b.legPat);
      if (b.joints) rig.ball(kn, b.legR * 1.05, T.joint);
      rig.cap(
        an,
        vadd(vadd(an, vsc(pF, b.foot * fc)), v3(0, -0.6 - b.foot * fs, 0)),
        b.legR * 1.05,
        b.legR * 0.9,
        T.foot,
      );
    }
  }
  // Таз и торс.
  rig.cap(pelvis, vadd(pelvis, vsc(up, b.torso * 0.25)), b.waist * 1.05, b.waist, T.pelvis);
  rig.cap(vadd(pelvis, vsc(up, b.torso * 0.15)), chest, b.waist, b.chest, T.torso, b.torsoPat);
  if (!skip.arms) {
    for (const [sh, el, ha] of [
      [shL, elL, haL],
      [shR, elR, haR],
    ]) {
      rig.cap(sh, el, b.armR * 1.1, b.armR, T.arm, b.armPat);
      rig.cap(el, ha, b.armR, b.armR * 0.85, T.arm, b.armPat);
      if (b.joints) rig.ball(el, b.armR * 1.05, T.joint);
      rig.ball(ha, b.hand, T.hand);
    }
  }
  if (!skip.head) {
    rig.cap(chest, neck, b.armR * 0.9, b.armR * 0.8, T.joint);
    rig.ball(head, b.head, T.head);
  }
  return {
    pelvis,
    chest,
    neck,
    head,
    up,
    fwd,
    right,
    hUp,
    hFwd,
    hRight,
    shL,
    shR,
    elL,
    elR,
    haL,
    haR,
    hpL,
    hpR,
    knL,
    knR,
    anL,
    anR,
    foreL,
    foreR,
  };
}

/** Точка на поверхности головы: вперёд на `f`, вправо на `r`, вверх на `u` (доли радиуса). */
export const onHead = (j: Joints, R: number, f: number, r: number, u: number): V3 =>
  vadd(j.head, vadd(vadd(vsc(j.hFwd, f * R), vsc(j.hRight, r * R)), vsc(j.hUp, u * R)));

// ---- общие позы кукол -------------------------------------------------------

const ease = (k: number) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));
const easeOut = (k: number) => 1 - (1 - clamp01(k)) ** 3;

/** Шаг марионетки: ноги болтаются, тело подбрасывает нитью. */
function gait(ph: number, k = 1): Pose {
  const q = pose0();
  const s = Math.sin(ph);
  const c = Math.cos(ph);
  q.bob = Math.abs(s) * 1.6 * k;
  q.lean = 0.12 * k;
  q.lL = limb(0.65 * s * k, 0.06, 0.25 + 0.55 * Math.max(0, -c) * k);
  q.lR = limb(-0.65 * s * k, 0.06, 0.25 + 0.55 * Math.max(0, c) * k);
  q.aL = limb(-0.5 * s * k, 0.18, 0.35 + 0.2 * Math.max(0, s));
  q.aR = limb(0.5 * s * k, 0.18, 0.35 + 0.2 * Math.max(0, -s));
  q.hr = 0.08 * s * k;
  q.side = 0.05 * s * k;
  return q;
}

/** Покой на нитях: покачивается, ноги едва касаются пола. */
function dangle(ph: number): Pose {
  const q = pose0();
  const s = Math.sin(ph);
  q.bob = 1 + 0.6 * s;
  q.side = 0.04 * s;
  q.hr = 0.07 * Math.sin(ph * 0.5);
  q.hp = 0.08;
  q.aL = limb(0.05 * s, 0.16, 0.25);
  q.aR = limb(-0.05 * s, 0.16, 0.25);
  q.lL = limb(0.06 * s, 0.04, 0.12);
  q.lR = limb(-0.06 * s, 0.04, 0.12);
  return q;
}

/** Нити отпустили: кукла обвисла (сон, ожидание). */
function slump(k: number): Pose {
  const q = pose0();
  q.sink = 3 * k;
  q.lean = 0.5 * k;
  q.hp = 0.7 * k;
  q.hr = 0.25 * k;
  q.aL = limb(0.15 * k, 0.1, 0.1);
  q.aR = limb(0.05, 0.12, 0.1);
  q.lL = limb(0.5 * k, 0.12, 0.9 * k);
  q.lR = limb(0.4 * k, 0.1, 0.9 * k);
  return q;
}

/** Срезали нить: кукла шатается, руки вразлёт. */
function reel(t: number): Pose {
  const q = pose0();
  const k = Math.sin(clamp01(t / 0.6) * Math.PI);
  q.lean = -0.35 * k;
  q.side = 0.3 * Math.sin(t * 18) * k;
  q.hp = -0.4 * k;
  q.hr = 0.3 * Math.sin(t * 13);
  q.aL = limb(0.6 * k, 0.9 * k + 0.1, 0.2);
  q.aR = limb(0.5 * k, 1.1 * k + 0.1, 0.3);
  q.lL = limb(0.3 * k, 0.15, 0.3);
  q.lR = limb(-0.2 * k, 0.1, 0.1);
  q.bob = 2 * k;
  return q;
}

/** Без нитей — ползёт на руках, ноги волочатся. */
function crawl(ph: number): Pose {
  const q = pose0();
  const s = Math.sin(ph);
  q.sink = 7;
  q.lean = 1.25;
  q.hp = -0.9;
  q.aL = limb(1.4 + 0.5 * s, 0.25, -0.3);
  q.aR = limb(1.4 - 0.5 * s, 0.25, -0.3);
  q.lL = limb(-1.2, 0.15, 0.1);
  q.lR = limb(-1.15, 0.2, 0.2);
  q.side = 0.08 * s;
  return q;
}

/** Смерть куклы: нити лопнули — валится, руки и ноги врозь. */
function collapse(t: number): Pose {
  const q = pose0();
  const k = easeOut(t / 0.45);
  q.sink = 8 * k;
  q.lean = 1.1 * k;
  q.side = 0.5 * k;
  q.hp = 0.6 * k;
  q.hr = 0.6 * k;
  q.aL = limb(0.4, 0.2 + 1.2 * k, 0.1);
  q.aR = limb(0.6, 0.3 + 1.0 * k, 0.4);
  q.lL = limb(-0.9 * k, 0.5 * k, 0.9 * k);
  q.lR = limb(1.0 * k, 0.4 * k, 0.6 * k);
  return q;
}

/** Ищет героя в темноте: голова крутится, руки вперёд ощупью. */
function grope(ph: number): Pose {
  const q = dangle(ph);
  q.hy = 0.9 * Math.sin(ph * 0.7);
  q.aL = limb(1.0 + 0.2 * Math.sin(ph), 0.2, 0.2);
  q.aR = limb(0.9 - 0.2 * Math.sin(ph), 0.2, 0.2);
  return q;
}

function dizzy(t: number): Pose {
  const q = pose0();
  q.side = 0.25 * Math.sin(t * 7);
  q.lean = 0.15 * Math.cos(t * 7);
  q.hr = 0.4 * Math.sin(t * 9);
  q.hy = 0.5 * Math.cos(t * 9);
  q.aL = limb(0.3, 0.9, 0.3);
  q.aR = limb(0.2, 1.0, 0.4);
  q.lL = limb(0.2 * Math.sin(t * 7), 0.15, 0.3);
  q.lR = limb(-0.2 * Math.sin(t * 7), 0.15, 0.3);
  return q;
}

/** Общий выбор позы куклы по режиму (своё — у каждого вида сверху). */
interface Ctx {
  m: Mob;
  pose: MobPose;
  /** Номер кадра шага (своя частота). */
  f: number;
  now: number;
}

const WIND: Record<string, number> = {
  f13_knight: 0.72,
  f13_harlequin: 0.55,
  f13_prompter: 0.6,
  f13_drummer: 0.75,
  f13_fiddler: 0.7,
  f13_comedy: 0.55,
  f13_tragedy: 0.6,
  f13_shade: 0.6,
  f13_spider: 0.8,
  f13_ballerina: 0.6,
  f13_nutcracker: 0.85,
  f13_giant: 0.9,
  f13boss: 0.8,
};

/** Фаза шага и кадр из 8 по скорости. */
const RUN_N = 8;
const IDLE_N = 8;

function basePose(c: Ctx): { q: Pose; key: string } | null {
  const { m, pose } = c;
  const t = m.t;
  if (m.mode === 'dying') {
    const n = Math.min(7, Math.floor(t / 0.06));
    return { q: collapse(n * 0.06), key: `die${n}` };
  }
  if (m.data.crawl) {
    const f = Math.floor(c.now * 6 + m.id) % RUN_N;
    return { q: crawl((f / RUN_N) * TAU), key: `crawl${f}` };
  }
  switch (m.mode) {
    case 'sleep':
    case 'f13_hush': {
      const f = Math.floor(c.now * 2 + m.id) % 4;
      const q = slump(m.mode === 'sleep' ? 1 : 0.6);
      q.bob += f === 1 || f === 2 ? 0.4 : 0;
      return { q, key: `sl${m.mode === 'sleep' ? 1 : 0}${f}` };
    }
    case 'f13_reel': {
      const n = Math.min(9, Math.floor(t / 0.06));
      return { q: reel(n * 0.06), key: `reel${n}` };
    }
    case 'dizzy':
    case 'stun': {
      const n = Math.floor(c.now * 10) % 12;
      return { q: dizzy(n * 0.075), key: `dz${n}` };
    }
    case 'f13_lost': {
      const f = Math.floor(c.now * 5 + m.id) % 12;
      return { q: grope((f / 12) * TAU), key: `lost${f}` };
    }
    case 'f13_wait': {
      const f = Math.floor(c.now * 2 + m.id) % 8;
      const q = dangle((f / 8) * TAU);
      // Курит в кулуарах: рука к лицу.
      q.aR = limb(1.4, 0.3, 1.9);
      q.hp = -0.15;
      return { q, key: `wait${f}` };
    }
    case 'alert': {
      const q = dangle(0);
      const k = clamp01(t / 0.2);
      q.bob = 2.4 * k;
      q.aL = limb(0.5 * k, 0.6 * k, 0.4);
      q.aR = limb(0.5 * k, 0.6 * k, 0.4);
      q.hp = -0.3 * k;
      return { q, key: `al${Math.round(k * 3)}` };
    }
  }
  if (pose.anim === 'run') {
    const f = pose.frame % RUN_N;
    return { q: gait((f / RUN_N) * TAU), key: `run${f}` };
  }
  if (pose.anim === 'hurt') return { q: reel(0.15), key: 'hurt' };
  const f = Math.floor(c.now * 5 + m.id * 0.37) % IDLE_N;
  return { q: dangle((f / IDLE_N) * TAU), key: `idle${f}` };
}

/** Удар оружием в правой руке: замах над головой → рубка → проводка. */
function chopPose(q: Pose, k: number, hit: number): void {
  if (hit < 0) {
    const e = ease(k);
    q.aR = limb(-0.3 + 2.9 * e, 0.25 + 0.2 * e, 0.6 - 0.2 * e);
    q.aL = limb(0.5 * e, 0.3, 0.6);
    q.lean = -0.18 * e;
    q.twist = -0.45 * e;
    q.hp = -0.15 * e;
    q.lL = limb(0.35 * e, 0.12, 0.25);
    q.lR = limb(-0.3 * e, 0.12, 0.3);
    q.sink = 1.2 * e;
    return;
  }
  const e = easeOut(hit);
  q.aR = limb(2.6 - 3.0 * e, 0.4 - 0.1 * e, 0.4 - 0.3 * e);
  q.aL = limb(-0.3, 0.35, 0.5);
  q.lean = -0.18 + 0.5 * e;
  q.twist = -0.45 + 0.85 * e;
  q.lL = limb(0.5, 0.12, 0.3);
  q.lR = limb(-0.4, 0.12, 0.2);
  q.sink = 1.5;
}

const windK = (m: Mob) => clamp01(m.t / (WIND[m.kind] ?? 0.7));

// ---- кеш кадров мобов ----------------------------------------------------

const MOB_CACHE = new Map<string, FrameLRU<MobFrame>>();
function cacheOf(kind: string, n = 360) {
  let c = MOB_CACHE.get(kind);
  if (!c) {
    c = frameLRU<MobFrame>(n);
    MOB_CACHE.set(kind, c);
  }
  return c;
}

const dirOf = (face: number, n: number) => ((Math.round((face / TAU) * n) % n) + n) % n;

function toFrame(o: RigOut, ax: number, ay: number, extra: Partial<MobFrame> = {}): MobFrame {
  return {
    img: o.px.canvas(),
    ax,
    ay,
    eye: o.eye,
    lit: o.lit ? o.lit.canvas() : null,
    still: true,
    ...extra,
  };
}

/** Общий рисовальщик куклы-человечка: тело + оружие по виду. */
interface PuppetSpec {
  w: number;
  h: number;
  ax: number;
  ay: number;
  dirs: number;
  body: Body;
  tint?: RGBA;
  shadow: number;
  /** Своя поза по режиму (null — общая). */
  pose?: (c: Ctx, q: Pose) => { q: Pose; key: string } | null;
  /** Оружие и украшения поверх тела. */
  dress: (rig: Rig, j: Joints, c: Ctx, q: Pose) => void;
  /** Доп. поля кадра (шлейф, прозрачность). */
  frame?: (c: Ctx) => Partial<MobFrame>;
  /** Добавка к ключу кеша (что ещё читает рисовальщик). */
  keyX?: (c: Ctx) => string;
}

function puppetPainter(kind: string, spec: PuppetSpec) {
  const cache = cacheOf(kind);
  return (m: Mob, pose: MobPose): MobFrame | null => {
    const c: Ctx = { m, pose, f: pose.frame, now: pose.now };
    const own = spec.pose ? spec.pose(c, pose0()) : null;
    const got = own ?? basePose(c);
    if (!got) return null;
    const dir = dirOf(m.face, spec.dirs);
    const look = pose.look === 'elite' ? 'e' : pose.look === 'albino' ? 'a' : '';
    const key = `${got.key}:${dir}:${pose.flash ? 1 : 0}${look}:${spec.keyX ? spec.keyX(c) : ''}`;
    const extra = spec.frame ? spec.frame(c) : {};
    const hit = cache.get(key);
    if (hit) return { ...hit, ...extra };
    const rig = new Rig();
    const j = humanoid(rig, spec.body, got.q);
    spec.dress(rig, j, c, got.q);
    const yaw = (dir / spec.dirs) * TAU;
    const o = renderRig(rig, yaw, spec.w, spec.h, spec.ax, spec.ay, {
      flash: pose.flash,
      tint: look === 'e' ? P.gold[2] : look === 'a' ? WHITE : spec.tint,
      tintK: look ? 0.22 : spec.tint ? 0.15 : 0,
    });
    const fr = cache.set(key, toFrame(o, spec.ax, spec.ay, { shadow: spec.shadow }));
    return { ...fr, ...extra };
  };
}

/** Прогрев: покой и шаг во все стороны. */
function warmPuppet(kind: string, dirs: number) {
  const paint = MOB_PAINT.get(kind);
  if (!paint) return;
  registerMobWarm(kind, function* () {
    const m = fakeMob(kind);
    for (let d = 0; d < dirs; d++) {
      m.face = (d / dirs) * TAU;
      for (let f = 0; f < RUN_N; f++) {
        paint(m, {
          anim: 'run',
          frame: f,
          mode: 'chase',
          t: 0,
          left: false,
          flash: false,
          look: 'normal',
          now: 0,
        });
        yield f;
      }
      for (let f = 0; f < IDLE_N; f++) {
        paint(m, {
          anim: 'idle',
          frame: 0,
          mode: 'chase',
          t: 0,
          left: false,
          flash: false,
          look: 'normal',
          now: f / 5,
        });
        yield f;
      }
    }
  });
}

function fakeMob(kind: string): Mob {
  return {
    id: 0,
    kind,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    kx: 0,
    ky: 0,
    r: 0.4,
    hp: 1,
    maxHp: 1,
    dmg: 0,
    speed: 0,
    face: 0,
    mode: 'chase',
    t: 0,
    cd: 0,
    flash: 0,
    danger: 0,
    tele: null,
    data: {},
  } as unknown as Mob;
}

const MOB_PAINT = new Map<string, (m: Mob, pose: MobPose) => MobFrame | null>();
function paintMob(kind: string, f: (m: Mob, pose: MobPose) => MobFrame | null): void {
  MOB_PAINT.set(kind, f);
  registerMobPainter(kind, f);
}

// ---- узоры ---------------------------------------------------------------

/** Ромбы арлекина. */
const diamonds =
  (a: Tone, b: Tone, c: Tone): Pat =>
  (t, nx) => {
    const u = t * 4;
    const v = nx * 2 + 2;
    const k = (Math.floor(u + v) + Math.floor(u - v + 8)) % 3;
    return k === 0 ? a : k === 1 ? b : c;
  };
/** Пояс/полоса: доля длины [t0, t1] — другим тоном. */
const bandPat =
  (t0: number, t1: number, T: Tone, base?: Tone): Pat =>
  (t) =>
    t >= t0 && t <= t1 ? T : (base ?? null);

// ---------------------------------------------------------------------------
// Рыцарь-марионетка.
// ---------------------------------------------------------------------------

const KNIGHT_BODY: Body = {
  hip: 9,
  torso: 7,
  waist: 2.6,
  chest: 3.4,
  neck: 1,
  head: 3.4,
  shW: 3.6,
  upper: 4,
  fore: 3.8,
  armR: 1.25,
  hand: 1.3,
  hipW: 1.6,
  thigh: 4.4,
  shin: 4.4,
  legR: 1.3,
  foot: 2,
  T: {
    torso: P.silver,
    arm: P.wood,
    leg: P.wood,
    head: P.silver,
    hand: P.wood,
    foot: P.iron,
    joint: P.brass,
    pelvis: P.blue,
  },
  torsoPat: bandPat(0, 0.3, P.blue),
  legPat: bandPat(0.55, 1, P.silver),
  joints: true,
};

function sword(rig: Rig, hand: V3, dir: V3, len: number, T: Tone = P.silver): void {
  const tip = vadd(hand, vsc(dir, len));
  const guardA = vadd(hand, vsc(dir, 1.2));
  rig.cap(vadd(hand, vsc(dir, -1.4)), hand, 0.55, 0.55, P.wood);
  rig.cap(guardA, tip, 0.85, 0.35, T);
  // Гарда поперёк.
  const side = vnorm(v3(-dir.z, 0, dir.x));
  rig.cap(vadd(guardA, vsc(side, -1.6)), vadd(guardA, vsc(side, 1.6)), 0.5, 0.5, P.gold);
}

const swordDir = (j: Joints, side: 'L' | 'R', up = 0.6): V3 => {
  const f = side === 'R' ? j.foreR : j.foreL;
  return vnorm(vadd(vsc(f, 1), vadd(vsc(j.fwd, 0.6), v3(0, up, 0))));
};

function knightPose(c: Ctx, q: Pose): { q: Pose; key: string } | null {
  const { m } = c;
  if (m.mode === 'windup' && !m.data.crawl) {
    const n = Math.min(11, Math.floor(windK(m) * 12));
    chopPose(q, n / 11, -1);
    return { q, key: `w${n}` };
  }
  if (m.mode === 'recover' && m.t < 0.3 && !m.data.crawl) {
    const n = Math.min(5, Math.floor(m.t / 0.05));
    chopPose(q, 1, n / 5);
    return { q, key: `h${n}` };
  }
  return null;
}

paintMob(
  'f13_knight',
  puppetPainter('f13_knight', {
    w: 40,
    h: 44,
    ax: 20,
    ay: 38,
    dirs: 8,
    body: KNIGHT_BODY,
    shadow: 6,
    pose: knightPose,
    dress: (rig, j, c) => {
      const R = KNIGHT_BODY.head;
      // Шлем: забрало с прорезью, плюмаж.
      rig.dot(onHead(j, R, 0.98, -0.35, 0.05), INK, 1);
      rig.dot(onHead(j, R, 0.98, 0.35, 0.05), INK, 1);
      rig.dot(onHead(j, R, 0.98, 0, 0.05), INK, 1);
      rig.cap(onHead(j, R, 0.1, 0, 0.95), onHead(j, R, -1.2, 0, 1.4), 1.1, 0.7, P.red);
      // Наплечники.
      rig.ball(vadd(j.shL, v3(0, 0.6, 0)), 1.7, P.silver);
      rig.ball(vadd(j.shR, v3(0, 0.6, 0)), 1.7, P.silver);
      // Меч и щит.
      sword(rig, j.haR, swordDir(j, 'R'), 10);
      const sh = vadd(vmix(j.elL, j.haL, 0.6), vsc(j.right, -1));
      rig.ball(sh, 3.3, P.red, (t, nx, ny) =>
        Math.abs(nx) < 0.18 || Math.abs(ny) < 0.18
          ? P.gold
          : Math.hypot(nx, ny) > 0.82
            ? P.gold
            : null,
      );
      void c;
    },
  }),
);

// ---------------------------------------------------------------------------
// Щелкунчик-гвардеец (элита).
// ---------------------------------------------------------------------------

const NUT_BODY: Body = {
  hip: 10,
  torso: 8.5,
  waist: 3.2,
  chest: 4.2,
  neck: 0.6,
  head: 4.6,
  shW: 4.4,
  upper: 4.6,
  fore: 4.2,
  armR: 1.5,
  hand: 1.5,
  hipW: 2,
  thigh: 5,
  shin: 5,
  legR: 1.6,
  foot: 2.4,
  T: {
    torso: P.red,
    arm: P.red,
    leg: P.blue,
    head: P.cream,
    hand: P.cream,
    foot: P.black,
    joint: P.gold,
    pelvis: P.blue,
  },
  torsoPat: (t, nx) =>
    Math.abs(nx + (t - 0.5) * 1.2) < 0.16 || Math.abs(nx - (t - 0.5) * 1.2) < 0.16
      ? P.cream
      : t < 0.12
        ? P.gold
        : null,
  legPat: bandPat(0.62, 1, P.black),
  joints: true,
};

paintMob(
  'f13_nutcracker',
  puppetPainter('f13_nutcracker', {
    w: 48,
    h: 58,
    ax: 24,
    ay: 52,
    dirs: 8,
    body: NUT_BODY,
    shadow: 8,
    keyX: (c) =>
      c.m.mode === 'windup'
        ? `j${Math.floor(windK(c.m) * 6)}`
        : c.m.mode === 'recover' && c.m.t < 0.2
          ? 'jc'
          : '',
    pose: (c, q) => {
      const { m } = c;
      if (m.mode === 'windup') {
        const n = Math.min(11, Math.floor(windK(m) * 12));
        const e = ease(n / 11);
        // Челюсть распахнута, голова назад, руки в стороны.
        q.hp = -0.45 * e;
        q.lean = -0.15 * e;
        q.aL = limb(0.6 * e, 0.7 * e + 0.1, 0.4);
        q.aR = limb(0.6 * e, 0.7 * e + 0.1, 0.4);
        q.sink = 1.5 * e;
        return { q, key: `w${n}` };
      }
      if (m.mode === 'recover' && m.t < 0.3) {
        const n = Math.min(5, Math.floor(m.t / 0.05));
        const e = easeOut(n / 5);
        q.hp = -0.45 + 0.9 * e;
        q.lean = 0.35 * e;
        q.aL = limb(0.8, 0.5, 0.5);
        q.aR = limb(0.8, 0.5, 0.5);
        return { q, key: `h${n}` };
      }
      if (m.mode === 'aim') {
        // Марш-таран: топчется, саблю вперёд.
        const n = Math.floor(c.now * 10) % 8;
        const s = Math.sin((n / 8) * TAU);
        q.lL = limb(0.5 * Math.max(0, s), 0.1, 0.9 * Math.max(0, s));
        q.lR = limb(0.5 * Math.max(0, -s), 0.1, 0.9 * Math.max(0, -s));
        q.aR = limb(1.5, 0.15, 0.1);
        q.lean = 0.25;
        q.hp = 0.2;
        return { q, key: `aim${n}` };
      }
      if (m.mode === 'f13_charge') {
        const n = Math.floor(c.now * 16) % 8;
        const g = gait((n / 8) * TAU, 1.4);
        g.lean = 0.55;
        g.aR = limb(1.5, 0.15, 0.1);
        g.aL = limb(-0.6, 0.3, 0.6);
        return { q: g, key: `ch${n}` };
      }
      return null;
    },
    dress: (rig, j, c) => {
      const R = NUT_BODY.head;
      const open = c.m.mode === 'windup' ? ease(windK(c.m)) : 0;
      // Кивер: высокий чёрный цилиндр с золотом и плюмажем.
      const hatB = onHead(j, R, -0.05, 0, 0.75);
      const hatT = vadd(hatB, vsc(j.hUp, 7));
      rig.cap(hatB, hatT, 3.6, 3.9, P.black, bandPat(0, 0.18, P.gold));
      rig.ball(vadd(hatT, vsc(j.hFwd, 2.6)), 1.2, P.gold);
      rig.cap(hatT, vadd(hatT, vadd(vsc(j.hUp, 3), vsc(j.hFwd, -1))), 1.4, 0.6, P.red);
      // Лицо: глаза, усы, большая челюсть с бородой.
      rig.dot(onHead(j, R, 0.92, -0.38, 0.2), INK, 1);
      rig.dot(onHead(j, R, 0.92, 0.38, 0.2), INK, 1);
      rig.dot(onHead(j, R, 0.95, -0.38, 0.32), WHITE, 1);
      rig.cap(onHead(j, R, 1, -0.5, -0.12), onHead(j, R, 1, 0.5, -0.12), 0.8, 0.8, P.black);
      const jawA = onHead(j, R, 0.55, 0, -0.55 - open * 0.5);
      rig.cap(vadd(jawA, vsc(j.hRight, -2.6)), vadd(jawA, vsc(j.hRight, 2.6)), 2.2, 2.2, P.cream);
      rig.cap(vadd(jawA, v3(0, -1.6, 0)), vadd(jawA, v3(0, -4, 0)), 2.2, 0.8, P.porcelain);
      if (open > 0.2) rig.dot(onHead(j, R, 1.02, 0, -0.42), INK, 2);
      // Эполеты и пуговицы.
      rig.disc(vadd(j.shL, v3(0, 0.8, 0)), 2.2, 0.8, P.gold);
      rig.disc(vadd(j.shR, v3(0, 0.8, 0)), 2.2, 0.8, P.gold);
      for (let k = 0; k < 3; k++)
        rig.dot(
          vadd(vmix(j.pelvis, j.chest, 0.3 + k * 0.25), vsc(j.fwd, NUT_BODY.chest * 0.95)),
          P.gold[3],
          1,
        );
      sword(rig, j.haR, swordDir(j, 'R', 0.3), 13, P.silver);
    },
  }),
);

// ---------------------------------------------------------------------------
// Барабанщик: кольцо на сильную долю.
// ---------------------------------------------------------------------------

const DRUM_BODY: Body = {
  ...KNIGHT_BODY,
  hip: 8,
  torso: 7,
  waist: 3,
  chest: 3.4,
  head: 3.3,
  T: {
    torso: P.blue,
    arm: P.blue,
    leg: P.cream,
    head: P.skin,
    hand: P.cream,
    foot: P.black,
    joint: P.gold,
    pelvis: P.cream,
  },
  torsoPat: (t, nx) => (Math.abs(nx) < 0.15 && t > 0.2 ? P.gold : null),
  legPat: bandPat(0.6, 1, P.black),
  armPat: bandPat(0.85, 1, P.gold),
};

paintMob(
  'f13_drummer',
  puppetPainter('f13_drummer', {
    w: 40,
    h: 44,
    ax: 20,
    ay: 38,
    dirs: 8,
    body: DRUM_BODY,
    shadow: 7,
    pose: (c, q) => {
      const { m } = c;
      // Палочки вверх на подготовке, удар — на долю.
      if (m.mode === 'f13_drum' || m.mode === 'windup') {
        const T = m.mode === 'windup' ? WIND.f13_drummer : 0.7;
        const n = Math.min(9, Math.floor((m.t / T) * 10));
        const e = ease(n / 9);
        q.aL = limb(0.6 + 1.8 * e, 0.3, 1.2 - 0.6 * e);
        q.aR = limb(0.6 + 1.8 * e, 0.3, 1.2 - 0.6 * e);
        q.hp = -0.2 * e;
        q.lean = -0.1 * e;
        q.bob = 1.5 * e;
        return { q, key: `d${n}` };
      }
      if (m.mode === 'recover' && m.t < 0.3) {
        const n = Math.min(5, Math.floor(m.t / 0.05));
        const e = easeOut(n / 5);
        q.aL = limb(2.4 - 1.9 * e, 0.3, 0.6 + 0.6 * e);
        q.aR = limb(2.4 - 1.9 * e, 0.3, 0.6 + 0.6 * e);
        q.lean = 0.2 * e;
        q.sink = 1.5 * e;
        return { q, key: `h${n}` };
      }
      const b = basePose(c);
      if (b && (b.key.startsWith('run') || b.key.startsWith('idle'))) {
        // Палочки всегда над барабаном.
        b.q.aL = limb(0.9 + b.q.aL.sw * 0.3, 0.3, 1.2);
        b.q.aR = limb(0.9 + b.q.aR.sw * 0.3, 0.3, 1.2);
      }
      return b;
    },
    dress: (rig, j) => {
      const R = DRUM_BODY.head;
      rig.dot(onHead(j, R, 0.95, -0.35, 0.1), INK, 1);
      rig.dot(onHead(j, R, 0.95, 0.35, 0.1), INK, 1);
      rig.dot(onHead(j, R, 0.98, -0.55, -0.25), P.red[2], 1);
      rig.dot(onHead(j, R, 0.98, 0.55, -0.25), P.red[2], 1);
      // Кивер.
      const hb = onHead(j, R, 0, 0, 0.7);
      rig.cap(hb, vadd(hb, vsc(j.hUp, 3.4)), 2.8, 3, P.red, bandPat(0, 0.25, P.gold));
      // Барабан на поясе.
      const dc = vadd(vadd(j.pelvis, vsc(j.up, 2.2)), vsc(j.fwd, 4));
      rig.disc(dc, 4.6, 3.6, P.red, (u, v, side) =>
        side
          ? Math.floor((u + 1) * 5) % 2
            ? P.gold
            : P.red
          : u * u + v * v > 0.8
            ? P.gold
            : P.cream,
      );
      // Палочки.
      for (const [ha, fo] of [
        [j.haL, j.foreL],
        [j.haR, j.foreR],
      ] as const) {
        const d = vnorm(vadd(fo, vsc(j.fwd, 0.8)));
        rig.cap(ha, vadd(ha, vsc(d, 6)), 0.5, 0.45, P.cream);
        rig.ball(vadd(ha, vsc(d, 6)), 0.9, P.cream);
      }
    },
  }),
);

// ---------------------------------------------------------------------------
// Скрипач.
// ---------------------------------------------------------------------------

const FIDDLE_BODY: Body = {
  ...KNIGHT_BODY,
  hip: 9,
  torso: 7.5,
  waist: 2.2,
  chest: 2.8,
  head: 3.2,
  shW: 3,
  armR: 1.05,
  legR: 1.05,
  T: {
    torso: P.green,
    arm: P.green,
    leg: P.black,
    head: P.pale,
    hand: P.porcelain,
    foot: P.black,
    joint: P.brass,
    pelvis: P.black,
  },
  torsoPat: (t, nx) => (t > 0.7 && Math.abs(nx) < 0.3 ? P.cream : null),
};

function fiddlePose(c: Ctx, q: Pose): { q: Pose; key: string } | null {
  const { m } = c;
  const playing = m.mode === 'aim' || m.mode === 'windup';
  const b = playing ? { q, key: '' } : basePose(c);
  if (!b) return null;
  const bow = playing ? Math.floor(c.now * 14) % 6 : Math.floor(c.now * 4) % 6;
  const s = Math.sin((bow / 6) * TAU);
  // Скрипка у подбородка, смычок ходит.
  b.q.aL = limb(1.2, 0.9, 1.3);
  b.q.aR = limb(1.0 + 0.25 * s, 0.6 + 0.3 * s, 1.2);
  b.q.hr = 0.35;
  if (playing) {
    b.q.lean = -0.1;
    b.q.bob = 1 + 0.5 * s;
  }
  return { q: b.q, key: `${b.key}b${bow}${playing ? 'p' : ''}` };
}

paintMob(
  'f13_fiddler',
  puppetPainter('f13_fiddler', {
    w: 40,
    h: 44,
    ax: 20,
    ay: 38,
    dirs: 8,
    body: FIDDLE_BODY,
    shadow: 5,
    pose: (c, q) =>
      c.m.mode === 'dying' || c.m.mode === 'f13_reel' || c.m.mode === 'sleep' || c.m.data.crawl
        ? null
        : fiddlePose(c, q),
    dress: (rig, j, c) => {
      const R = FIDDLE_BODY.head;
      rig.dot(onHead(j, R, 0.95, -0.35, 0.1), INK, 1);
      rig.dot(onHead(j, R, 0.95, 0.35, 0.1), INK, 1);
      rig.dot(onHead(j, R, 0.97, 0, -0.4), P.red[1], 1);
      // Чёлка-парик.
      rig.cap(onHead(j, R, 0.2, -0.6, 0.7), onHead(j, R, 0.2, 0.6, 0.7), 1.6, 1.6, P.cream);
      if (c.m.mode === 'dying' || c.m.data.crawl) return;
      // Скрипка: корпус у плеча, гриф к левой руке.
      const body = vadd(vadd(j.shL, vsc(j.fwd, 2)), v3(0, 0.6, 0));
      rig.cap(body, vadd(body, vsc(j.right, 1.8)), 1.9, 1.5, P.wood);
      rig.cap(body, j.haL, 0.45, 0.4, P.black);
      // Смычок.
      const bd = vnorm(vadd(vsc(j.right, -1), vsc(j.fwd, 0.3)));
      rig.cap(vadd(j.haR, vsc(bd, -1)), vadd(j.haR, vsc(bd, 8)), 0.35, 0.3, P.cream);
    },
  }),
);

// ---------------------------------------------------------------------------
// Балерина-волчок.
// ---------------------------------------------------------------------------

const BALL_BODY: Body = {
  hip: 9.5,
  torso: 6.5,
  waist: 1.6,
  chest: 2.3,
  neck: 1.2,
  head: 2.8,
  shW: 2.6,
  upper: 3.8,
  fore: 3.6,
  armR: 0.85,
  hand: 0.9,
  hipW: 1.1,
  thigh: 4.8,
  shin: 4.8,
  legR: 0.95,
  foot: 1.2,
  T: {
    torso: P.pink,
    arm: P.porcelain,
    leg: P.porcelain,
    head: P.porcelain,
    hand: P.porcelain,
    foot: P.pink,
    joint: P.porcelain,
    pelvis: P.pink,
  },
  torsoPat: bandPat(0.75, 1, P.porcelain),
};

paintMob(
  'f13_ballerina',
  puppetPainter('f13_ballerina', {
    w: 40,
    h: 44,
    ax: 20,
    ay: 38,
    dirs: 8,
    body: BALL_BODY,
    shadow: 6,
    pose: (c, q) => {
      const { m } = c;
      if (m.mode === 'dying' || m.data.crawl || m.mode === 'f13_reel' || m.mode === 'sleep')
        return null;
      if (m.mode === 'f13_plie' || m.mode === 'windup') {
        const n = Math.min(7, Math.floor((m.t / 0.6) * 8));
        const e = ease(n / 7);
        q.sink = 3 * e;
        q.lL = limb(0.3 * e, 0.5 * e, 0.8 * e);
        q.lR = limb(0.3 * e, 0.5 * e, 0.8 * e);
        q.aL = limb(0.6 + 1.6 * e, 0.9, 0.6);
        q.aR = limb(0.6 + 1.6 * e, 0.9, 0.6);
        return { q, key: `p${n}` };
      }
      if (m.mode === 'f13_spin') {
        // Вращение на пуанте: тело — ось, руки над головой.
        q.bob = 2.5;
        q.lL = limb(0, 0, 0);
        q.lR = limb(0.6, 0.6, 1.6);
        q.aL = limb(2.9, 0.35, 0.7);
        q.aR = limb(2.9, 0.35, 0.7);
        q.hp = -0.1;
        const n = Math.floor(c.now * 24) % 4;
        return { q, key: `s${n}` };
      }
      const b = basePose(c);
      if (b && (b.key.startsWith('idle') || b.key.startsWith('run'))) {
        // Руки — «пятая позиция» овалом, шаг — на носочках.
        b.q.aL = limb(0.9 + b.q.aL.sw * 0.3, 0.6, 1.1);
        b.q.aR = limb(0.9 + b.q.aR.sw * 0.3, 0.6, 1.1);
        b.q.bob += 1.2;
      }
      return b;
    },
    dress: (rig, j, c) => {
      const R = BALL_BODY.head;
      rig.dot(onHead(j, R, 0.95, -0.35, 0.1), INK, 1);
      rig.dot(onHead(j, R, 0.95, 0.35, 0.1), INK, 1);
      rig.dot(onHead(j, R, 0.98, -0.5, -0.3), P.pink[2], 1);
      rig.dot(onHead(j, R, 0.98, 0.5, -0.3), P.pink[2], 1);
      // Пучок волос.
      rig.ball(onHead(j, R, -0.4, 0, 0.9), 1.6, P.wood);
      rig.dot(onHead(j, R, 0.3, 0, 1.0), P.gold[3], 1);
      // Пачка — пышный диск с оборками.
      const tu = vadd(j.pelvis, vsc(j.up, 1.2));
      rig.disc(tu, 7.2, 1.6, P.pink, (u, v, side) => {
        if (side) return P.pink;
        const a = Math.atan2(v, u);
        const r = Math.hypot(u, v);
        return (Math.floor(a * 4 + r * 3) % 2 === 0 ? P.pink : P.porcelain) as Tone;
      });
      void c;
    },
    keyX: (c) => (c.m.mode === 'f13_spin' ? `${dirOf(c.m.face + c.now * 22, 8)}` : ''),
    frame: (c) =>
      c.m.mode === 'f13_spin'
        ? {
            ghost: { every: 0.05, life: 0.18, tint: '#ffc8e0', alpha: 0.5 },
            rot: Math.sin(c.now * 30) * 0.05,
          }
        : {},
  }),
);

// ---------------------------------------------------------------------------
// Арлекин: ныряет в пол, выскакивает за спиной.
// ---------------------------------------------------------------------------

const HARL_BODY: Body = {
  ...KNIGHT_BODY,
  hip: 9,
  torso: 6.8,
  waist: 2.2,
  chest: 2.9,
  head: 3,
  shW: 3,
  armR: 1.05,
  legR: 1.1,
  T: {
    torso: P.red,
    arm: P.red,
    leg: P.red,
    head: P.porcelain,
    hand: P.black,
    foot: P.black,
    joint: P.gold,
    pelvis: P.black,
  },
  torsoPat: diamonds(P.red, P.black, P.gold),
  armPat: diamonds(P.black, P.red, P.gold),
  legPat: diamonds(P.gold, P.red, P.black),
};

paintMob(
  'f13_harlequin',
  puppetPainter('f13_harlequin', {
    w: 40,
    h: 46,
    ax: 20,
    ay: 40,
    dirs: 8,
    body: HARL_BODY,
    shadow: 5,
    pose: (c, q) => {
      const { m } = c;
      if (m.mode === 'f13_dive') {
        // Присел и ушёл в люк головой вперёд.
        const n = Math.min(7, Math.floor((m.t / 0.45) * 8));
        const e = ease(n / 7);
        q.sink = 2 + 6 * e;
        q.lean = 0.9 * e;
        q.aL = limb(2.8 * e, 0.2, 0.1);
        q.aR = limb(2.8 * e, 0.2, 0.1);
        q.lL = limb(-0.5 * e, 0.1, 1.2 * e);
        q.lR = limb(-0.5 * e, 0.1, 1.2 * e);
        return { q, key: `dv${n}` };
      }
      if (m.mode === 'f13_pop') {
        // Выскочил: прыжок вверх, руки звездой.
        const n = Math.min(7, Math.floor((m.t / 0.75) * 8));
        const e = ease(n / 7);
        q.bob = 6 * Math.sin(e * Math.PI);
        q.aL = limb(1.8 * e, 1.4, 0.2);
        q.aR = limb(1.8 * e, 1.4, 0.2);
        q.lL = limb(0.2, 0.5 * e, 0.4);
        q.lR = limb(0.2, 0.5 * e, 0.4);
        q.hp = -0.3 * e;
        return { q, key: `pp${n}` };
      }
      return knightPose(c, q);
    },
    dress: (rig, j, c) => {
      const R = HARL_BODY.head;
      // Чёрная полумаска, улыбка.
      rig.cap(onHead(j, R, 0.92, -0.45, 0.15), onHead(j, R, 0.92, 0.45, 0.15), 0.9, 0.9, P.black);
      rig.dot(onHead(j, R, 1, -0.35, 0.18), P.gold[3], 1);
      rig.dot(onHead(j, R, 1, 0.35, 0.18), P.gold[3], 1);
      rig.dot(onHead(j, R, 1, 0, -0.45), P.red[2], 1);
      // Колпак с двумя рогами и бубенцами.
      const top = onHead(j, R, 0, 0, 0.8);
      for (const s of [-1, 1]) {
        const mid = vadd(top, vadd(vsc(j.hRight, s * 3.2), vsc(j.hUp, 2.4)));
        const tip = vadd(mid, vadd(vsc(j.hRight, s * 2), vsc(j.hUp, -2.2)));
        rig.cap(top, mid, 2, 1.2, s < 0 ? P.red : P.black);
        rig.cap(mid, tip, 1.2, 0.6, s < 0 ? P.red : P.black);
        rig.ball(tip, 1.1, P.gold);
      }
      // Воротник-жабо.
      rig.disc(vadd(j.neck, v3(0, -0.6, 0)), 3.4, 0.6, P.porcelain, (u, v) =>
        Math.floor(Math.atan2(v, u) * 3) % 2 ? P.porcelain : P.cream,
      );
      // Деревянный шлепок-«батоккио».
      if (c.m.mode !== 'f13_dive') {
        const d = swordDir(j, 'R', 0.5);
        rig.cap(j.haR, vadd(j.haR, vsc(d, 7)), 0.6, 1.1, P.wood);
      }
    },
    frame: (c) => {
      const m = c.m;
      if (m.mode === 'f13_dive')
        return { alpha: 1 - ease(clamp01((m.t - 0.2) / 0.25)), dy: ease(m.t / 0.45) * 6 };
      if (m.mode === 'f13_pop')
        return {
          alpha: clamp01(m.t / 0.12),
          ghost: { every: 0.04, life: 0.2, tint: '#ff7088', alpha: 0.4 },
        };
      return {};
    },
  }),
);

// ---------------------------------------------------------------------------
// Суфлёр: колпак, очки, свиток.
// ---------------------------------------------------------------------------

const PROMPT_BODY: Body = {
  hip: 6,
  torso: 6,
  waist: 3,
  chest: 3.2,
  neck: 0.4,
  head: 3.3,
  shW: 3,
  upper: 3.2,
  fore: 3,
  armR: 1.1,
  hand: 1.1,
  hipW: 1.5,
  thigh: 3.2,
  shin: 3,
  legR: 1.1,
  foot: 1.8,
  T: {
    torso: P.wood,
    arm: P.wood,
    leg: P.black,
    head: P.skin,
    hand: P.skin,
    foot: P.black,
    joint: P.wood,
    pelvis: P.wood,
  },
  joints: false,
};

paintMob(
  'f13_prompter',
  puppetPainter('f13_prompter', {
    w: 36,
    h: 40,
    ax: 18,
    ay: 34,
    dirs: 8,
    body: PROMPT_BODY,
    shadow: 5,
    pose: (c, q) => {
      const { m } = c;
      q.lean = 0.35;
      q.hp = -0.25;
      if (m.mode === 'f13_hide') {
        q.sink = 9;
        q.lean = 0.6;
        q.hp = 0.3;
        q.aL = limb(1.2, 0.2, 1.4);
        q.aR = limb(1.2, 0.2, 1.4);
        q.lL = limb(1.2, 0.3, 2);
        q.lR = limb(1.2, 0.3, 2);
        return { q, key: `hide${Math.floor(c.now * 2) % 2}` };
      }
      if (m.mode === 'f13_peek') {
        const n = Math.floor(c.now * 4) % 4;
        q.sink = 3;
        q.hy = [0, 0.5, 0, -0.5][n];
        q.aL = limb(1.3, 0.3, 1.1);
        q.aR = limb(1.3, 0.3, 1.1);
        return { q, key: `pk${n}` };
      }
      if (m.mode === 'aim') {
        const n = Math.min(7, Math.floor((m.t / 0.55) * 8));
        const e = ease(n / 7);
        q.aR = limb(-0.4 + 2.6 * e, 0.3, 0.4);
        q.aL = limb(1.2, 0.3, 1.1);
        q.twist = -0.4 * e;
        return { q, key: `a${n}` };
      }
      const b = basePose(c);
      if (b) {
        b.q.lean += 0.35;
        b.q.hp -= 0.25;
        b.q.aL = limb(1.2, 0.3, 1.1);
      }
      return b;
    },
    dress: (rig, j, c) => {
      const R = PROMPT_BODY.head;
      // Колпак, загнутый назад, с кисточкой.
      const a = onHead(j, R, -0.1, 0, 0.7);
      const b = vadd(a, vadd(vsc(j.hUp, 3), vsc(j.hFwd, -2.4)));
      const tip = vadd(b, vadd(vsc(j.hUp, -1), vsc(j.hFwd, -2.4)));
      rig.cap(a, b, 3.2, 1.6, P.cream);
      rig.cap(b, tip, 1.6, 0.6, P.cream);
      rig.ball(tip, 1, P.red);
      // Очки и нос.
      rig.dot(onHead(j, R, 0.95, -0.4, 0.1), P.gold[3], 2);
      rig.dot(onHead(j, R, 0.95, 0.4, 0.1), P.gold[3], 2);
      rig.ball(onHead(j, R, 1.05, 0, -0.15), 0.9, P.skin);
      // Свиток роли в левой руке.
      if (c.m.mode !== 'dying')
        rig.cap(
          vadd(j.haL, vsc(j.right, -1.5)),
          vadd(j.haL, vsc(j.right, 1.5)),
          1.2,
          1.2,
          P.cream,
          (t) => (t < 0.15 || t > 0.85 ? P.wood : null),
        );
    },
    frame: (c) => (c.m.mode === 'f13_hide' ? { alpha: 0.85 } : {}),
  }),
);

// ---------------------------------------------------------------------------
// Тень-актёр: есть только в луче софита.
// ---------------------------------------------------------------------------

const SHADE_BODY: Body = {
  ...KNIGHT_BODY,
  hip: 10,
  torso: 8,
  waist: 2.4,
  chest: 3.4,
  head: 3,
  armR: 1.1,
  legR: 1.2,
  T: {
    torso: P.shade,
    arm: P.shade,
    leg: P.shade,
    head: P.shade,
    hand: P.shade,
    foot: P.shade,
    joint: P.shade,
    pelvis: P.shade,
  },
  joints: false,
};

paintMob(
  'f13_shade',
  puppetPainter('f13_shade', {
    w: 44,
    h: 48,
    ax: 22,
    ay: 42,
    dirs: 8,
    body: SHADE_BODY,
    shadow: 0,
    pose: (c, q) => {
      const { m } = c;
      if (m.mode === 'windup') {
        const n = Math.min(11, Math.floor(windK(m) * 12));
        const e = ease(n / 11);
        // Плащ распахнут, когти вперёд.
        q.aL = limb(1.6 * e, 0.9 * e, 0.3);
        q.aR = limb(1.6 * e, 0.9 * e, 0.3);
        q.lean = -0.2 * e;
        q.bob = 2 * e;
        return { q, key: `w${n}` };
      }
      if (m.mode === 'recover' && m.t < 0.3) {
        const n = Math.min(5, Math.floor(m.t / 0.05));
        const e = easeOut(n / 5);
        q.aL = limb(1.6 - 0.6 * e, 0.9 - 0.7 * e, 0.3);
        q.aR = limb(1.6 - 0.6 * e, 0.9 - 0.7 * e, 0.3);
        q.lean = 0.45 * e;
        return { q, key: `h${n}` };
      }
      return null;
    },
    dress: (rig, j, c) => {
      const R = SHADE_BODY.head;
      // Плащ: две полы от плеч до земли, развеваются.
      const sway = Math.sin(c.now * 4 + c.m.id) * 0.8;
      for (const s of [-1, 1]) {
        const sh = s < 0 ? j.shL : j.shR;
        const low = vadd(vadd(j.pelvis, vsc(j.right, s * 4)), v3(0, -8, -2 + sway));
        rig.cap(sh, low, 2, 3.4, P.shade);
      }
      // Цилиндр-силуэт и горящие глаза.
      const hb = onHead(j, R, 0, 0, 0.8);
      rig.cap(hb, vadd(hb, vsc(j.hUp, 4)), 2.4, 2.6, P.black);
      rig.disc(hb, 4, 0.5, P.black);
      rig.dot(onHead(j, R, 0.98, -0.38, 0.05), hx('#e0d0ff'), 1, true);
      rig.dot(onHead(j, R, 0.98, 0.38, 0.05), hx('#e0d0ff'), 1, true);
    },
    frame: (c) => {
      const m = c.m;
      const vis = m.data.ghost ? 0.12 + 0.08 * Math.sin(c.now * 6 + m.id) : 0.88;
      return {
        alpha: vis,
        ghost:
          m.mode === 'chase' && !m.data.ghost
            ? { every: 0.08, life: 0.3, tint: '#3a2c50', alpha: 0.35 }
            : null,
      };
    },
    keyX: (c) => (c.m.data.ghost ? 'g' : ''),
  }),
);

// ---------------------------------------------------------------------------
// Кассир с выручкой: удирает, позвякивая мешком.
// ---------------------------------------------------------------------------

const CASH_BODY: Body = {
  hip: 6,
  torso: 5,
  waist: 3.6,
  chest: 3.2,
  neck: 0.4,
  head: 3,
  shW: 3,
  upper: 3,
  fore: 2.8,
  armR: 1,
  hand: 1,
  hipW: 1.6,
  thigh: 3,
  shin: 3,
  legR: 1.05,
  foot: 1.8,
  T: {
    torso: P.green,
    arm: P.cream,
    leg: P.black,
    head: P.skin,
    hand: P.skin,
    foot: P.black,
    joint: P.wood,
    pelvis: P.black,
  },
  torsoPat: (t, nx) => (Math.abs(nx) < 0.12 && t > 0.3 ? P.gold : null),
};

paintMob(
  'f13_cashier',
  puppetPainter('f13_cashier', {
    w: 36,
    h: 40,
    ax: 18,
    ay: 34,
    dirs: 8,
    body: CASH_BODY,
    shadow: 5,
    pose: (c) => {
      if (c.m.mode === 'dying') return null;
      const b = basePose(c);
      if (b && b.key.startsWith('run')) {
        // Бежит часто-часто, мешок — за спиной.
        const f = Math.floor(c.now * 18) % RUN_N;
        const g = gait((f / RUN_N) * TAU, 1.3);
        g.lean = 0.35;
        g.aR = limb(-0.6, 0.4, 1.4);
        return { q: g, key: `run${f}` };
      }
      return b;
    },
    dress: (rig, j) => {
      const R = CASH_BODY.head;
      rig.dot(onHead(j, R, 0.95, -0.35, 0.1), INK, 1);
      rig.dot(onHead(j, R, 0.95, 0.35, 0.1), INK, 1);
      // Козырёк.
      rig.disc(onHead(j, R, 0.5, 0, 0.6), 3, 0.4, P.green);
      rig.cap(onHead(j, R, 0, 0, 0.6), onHead(j, R, 0, 0, 1.05), 2.6, 2.4, P.green);
      // Мешок с монетами.
      const bag = vadd(j.haR, v3(0, -1.4, 0));
      rig.ball(bag, 3.2, P.cream, (_t, nx, ny) =>
        Math.abs(nx) < 0.2 && Math.abs(ny) < 0.5 ? P.gold : null,
      );
      rig.cap(j.haR, vadd(j.haR, v3(0, 1, 0)), 0.8, 0.5, P.wood);
      rig.dot(vadd(bag, v3(0, 3.4, 0)), P.gold[3], 1, true);
    },
  }),
);

// ---------------------------------------------------------------------------
// Маски Комедии и Трагедии — летают парой, лента вьётся.
// ---------------------------------------------------------------------------

const MASK_CACHE = frameLRU<MobFrame>(240);

function maskPx(
  tragic: boolean,
  f: number,
  open: number,
  broken: boolean,
  glow: boolean,
  flash: boolean,
): { px: Px; lit: Px | null } {
  const W = 30;
  const H = 30;
  const p = new Px(W, H);
  const T = tragic ? P.silver : P.gold;
  const cx = 15;
  const cy = 12;
  // Ленты — две, вьются по кадру.
  for (const s of [-1, 1]) {
    for (let k = 0; k < 12; k++) {
      const x = cx + s * (8 + k * 0.6);
      const y = cy + 2 + k * 1.1 + Math.sin(f * 0.8 + k * 0.7 + s) * 1.6;
      p.set(x, y, k % 4 === 0 ? P.velvet[3] : P.velvet[2]);
      p.set(x, y + 1, P.velvet[0]);
    }
  }
  // Лицо: овал с объёмом.
  p.ell(cx, cy, 9, 10, (x, y) => {
    const dx = (x + 0.5 - cx) / 9;
    const dy = (y + 0.5 - cy) / 10;
    const l = -dx * 0.6 - dy * 0.6 + 0.4;
    return l > 0.75 ? T[3] : l > 0.35 ? T[2] : l > -0.1 ? T[1] : T[0];
  });
  // Глазницы: у Комедии — дуги вверх, у Трагедии — вниз.
  const eyeC: RGBA = glow ? (tragic ? hx('#bfe8ff') : hx('#fff0a0')) : INK;
  for (const s of [-1, 1]) {
    const ex = cx + s * 4;
    const ey = cy - 2;
    for (let k = -2; k <= 2; k++) {
      const yy = ey + (tragic ? -1 : 1) * Math.round((k * k) / 3) - (open > 0 ? 1 : 0);
      p.set(ex + k, yy, eyeC);
      p.set(ex + k, yy + 1, eyeC);
    }
  }
  // Рот.
  for (let k = -4; k <= 4; k++) {
    const yy = cy + 4 + (tragic ? 1 : -1) * Math.round(((16 - k * k) / 16) * 3) * -1;
    p.set(cx + k, yy, INK);
    if (open > 0.3) p.set(cx + k, yy + (tragic ? -1 : 1), INK);
  }
  // Румянец и слеза.
  if (!tragic) {
    p.set(cx - 6, cy + 2, P.red[2]);
    p.set(cx + 6, cy + 2, P.red[2]);
  } else {
    p.set(cx + 4, cy + 1, hx('#8ad8ff'));
    p.set(cx + 4, cy + 2, hx('#bfe8ff'));
  }
  // Золотой/серебряный ободок сверху и трещина.
  for (let k = -6; k <= 6; k++) p.set(cx + k, cy - 9 + Math.round((k * k) / 18), T[3]);
  if (broken) {
    p.line(cx - 1, cy - 9, cx + 1, cy - 3, INK);
    p.line(cx + 1, cy - 3, cx - 2, cy + 2, INK);
    p.line(cx - 2, cy + 2, cx + 2, cy + 8, INK);
  }
  p.outline(INK);
  if (flash) flashPx(p);
  let lit: Px | null = null;
  if (glow) {
    lit = new Px(W, H);
    for (const s of [-1, 1]) lit.ell(cx + s * 4, cy - 2, 2.6, 1.6, eyeC);
  }
  return { px: p, lit };
}

function maskPainter(tragic: boolean) {
  return (m: Mob, pose: MobPose): MobFrame | null => {
    const t = m.t;
    let rot = Math.sin(pose.now * 2 + m.id) * 0.12;
    let lift = 10;
    let sc = 1;
    let open = 0;
    let broken = false;
    const glow = m.mode === 'f13_heal' || m.mode === 'windup' || m.mode === 'aim';
    switch (m.mode) {
      case 'windup':
      case 'aim': {
        const k = clamp01(t / (WIND[m.kind] ?? 0.6));
        rot = -0.35 * ease(k) * (Math.cos(m.face) < 0 ? -1 : 1);
        sc = 1 + 0.12 * k;
        open = k;
        break;
      }
      case 'recover':
        if (t < 0.25) {
          rot = 0.3 * (1 - t / 0.25) * (Math.cos(m.face) < 0 ? -1 : 1);
          open = 1;
        }
        break;
      case 'f13_broken':
        // Треснула и лежит: под ней пыль, встаёт к концу.
        broken = true;
        lift = t > 3.4 ? (t - 3.4) * 16 : 0;
        rot = t > 3.4 ? 0 : 1.2;
        break;
      case 'f13_heal':
        open = 0.5;
        break;
      case 'dying':
        broken = true;
        lift = Math.max(0, 10 - t * 30);
        rot = t * 3;
        break;
    }
    const f = Math.floor(pose.now * 8 + m.id) % 8;
    const key = `${tragic ? 1 : 0}:${f}:${Math.round(open * 3)}:${broken ? 1 : 0}:${glow ? 1 : 0}:${pose.flash ? 1 : 0}`;
    let fr = MASK_CACHE.get(key);
    if (!fr) {
      const o = maskPx(tragic, f, open, broken, glow, pose.flash);
      fr = MASK_CACHE.set(key, {
        img: o.px.canvas(),
        lit: o.lit ? o.lit.canvas() : null,
        ax: 15,
        ay: 26,
        eye: [11, 10],
        still: true,
      });
    }
    return {
      ...fr,
      rot,
      sx: sc,
      sy: m.mode === 'f13_broken' && t < 3.4 ? 0.6 * sc : sc,
      lift,
      shadow: lift > 2 ? 5 : 7,
      alpha: m.mode === 'dying' ? Math.max(0, 1 - t / 0.7) : 1,
    };
  };
}

paintMob('f13_comedy', maskPainter(false));
paintMob('f13_tragedy', maskPainter(true));

// ---------------------------------------------------------------------------
// Паук-кукловод: спускается на нити, вяжет куклам нити.
// ---------------------------------------------------------------------------

/** На сколько пикселей паук над полом (нить рисует `f13-boss-fx.ts`). */
export function spiderLift(m: Mob): number {
  const t = m.t;
  switch (m.mode) {
    case 'f13_up':
      return 44;
    case 'f13_drop':
      return 44 * (1 - ease(t / 0.9));
    case 'f13_hang':
      return 4 + Math.sin(t * 3) * 1.5;
    case 'f13_climb':
      return 44 * ease(t / 0.6);
  }
  return 0;
}

function spiderRig(m: Mob, now: number, mode: string, t: number): { rig: Rig; key: string } {
  const rig = new Rig();
  const back = mode === 'f13_fallen';
  const walk = mode === 'chase' || mode === 'f13_retie' || mode === 'alert';
  const f = walk ? Math.floor(now * 12 + m.id) % 8 : Math.floor(now * 5 + m.id) % 8;
  const ph = (f / 8) * TAU;
  const hang =
    mode === 'f13_hang' || mode === 'f13_drop' || mode === 'f13_climb' || mode === 'f13_up';
  const wind = mode === 'windup' ? ease(clamp01(t / 0.8)) : 0;
  const hit = mode === 'recover' && t < 0.25 ? 1 - t / 0.25 : 0;
  const by = back ? 3 : hang ? 6 : 5 + wind * 2;
  const body = v3(0, by, -1);
  const head = v3(0, by + 0.5 + wind * 2, 3.2);
  const flip = back ? -1 : 1;
  rig.ball(body, 4.4, P.black, (_t, nx, ny) =>
    Math.abs(ny + nx * 0.3) < 0.12 || Math.abs(ny + nx * 0.3 - 0.45) < 0.1 ? P.gold : null,
  );
  rig.ball(head, 2.6, P.wood);
  for (let i = 0; i < 8; i++) {
    const s = i < 4 ? -1 : 1;
    const k = i % 4;
    const a0 = (-0.9 + k * 0.6) * 1;
    const sw = walk
      ? Math.sin(ph + k * 1.6 + (s > 0 ? Math.PI : 0)) * 0.35
      : hang
        ? Math.sin(now * 6 + i) * 0.5
        : back
          ? Math.sin(now * 14 + i * 1.3) * 0.6
          : 0;
    const raise = k === 3 ? wind * 1.2 + hit * 0.8 : 0;
    const root = vadd(body, v3(s * 2.6, 0.5 * flip, a0 * 2 + 1));
    const dir = a0 + sw;
    const knee = vadd(
      root,
      v3(
        s * 4 * Math.cos(dir * 0.5),
        (hang ? 1 : 4 + raise * 4) * flip,
        Math.sin(dir) * 4 + raise * 3,
      ),
    );
    const foot = back
      ? vadd(knee, v3(s * 1.5, 4 + Math.sin(now * 14 + i) * 1.5, Math.sin(dir) * 2))
      : vadd(
          knee,
          v3(
            s * 2.4 * Math.cos(dir * 0.5),
            hang ? -5 : -(knee.y - 0.2) + raise * 5,
            Math.sin(dir) * 2.4 + raise * 2,
          ),
        );
    rig.cap(root, knee, 0.75, 0.6, P.wood);
    rig.cap(knee, foot, 0.6, 0.35, P.wood);
    rig.ball(knee, 0.75, P.brass);
  }
  // Глаза — золотые бусины.
  rig.dot(vadd(head, v3(-1, 0.8, 2.4)), hx('#ffcf40'), 1, true);
  rig.dot(vadd(head, v3(1, 0.8, 2.4)), hx('#ffcf40'), 1, true);
  return { rig, key: `${mode}:${f}:${Math.round(wind * 5)}:${Math.round(hit * 3)}` };
}

const SPIDER_CACHE = cacheOf('f13_spider');
paintMob('f13_spider', (m, pose) => {
  const mode = m.mode === 'dying' ? 'f13_fallen' : m.mode;
  const { rig, key } = spiderRig(m, pose.now, mode, m.t);
  const dir = dirOf(m.face, 8);
  const k = `${key}:${dir}:${pose.flash ? 1 : 0}`;
  let fr = SPIDER_CACHE.get(k);
  if (!fr) {
    const o = renderRig(rig, (dir / 8) * TAU, 40, 36, 20, 30, { flash: pose.flash });
    fr = SPIDER_CACHE.set(k, toFrame(o, 20, 30, { shadow: 7 }));
  }
  const lift = spiderLift(m);
  return {
    ...fr,
    dy: -lift,
    shadow: 7 - Math.min(5, lift / 10),
    alpha: m.mode === 'f13_up' ? 0.55 : m.mode === 'dying' ? Math.max(0, 1 - m.t / 0.7) : 1,
  };
});

// ---------------------------------------------------------------------------
// Ключи поз с кривыми, пружины, след удара — для Кукловода и исполина.
// Техника = трек ключей от времени режима (24 к/с), контакт — ровно в урон.
// ---------------------------------------------------------------------------

type Ease = (k: number) => number;
/** Разгон: удар набирает скорость к контакту. */
const eIn: Ease = (k) => clamp01(k) ** 2;
/** С перелётом: проводка, рывок нити. */
const eBack: Ease = (k) => {
  const x = clamp01(k) - 1;
  return 1 + 2.4 * x * x * x + 1.4 * x * x;
};
/** След удара — тёплый белый. */
const SMEAR_C = hx('#fff2cc');
const clampN = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const angD = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

type PoseRec = Record<string, number | Limb>;
const mixLimb = (a: Limb, b: Limb, k: number): Limb => ({
  sw: a.sw + (b.sw - a.sw) * k,
  out: a.out + (b.out - a.out) * k,
  bend: a.bend + (b.bend - a.bend) * k,
});
/** Конечность от базовой со сдвигом (для поз-добавок). */
const dl = (b: Limb, sw: number, out: number, bend: number): Limb =>
  limb(b.sw + sw, b.out + out, b.bend + bend);

/** Смесь поз: числа и конечности (k вне 0…1 — перелёт). */
function mixP<T extends Pose>(a: T, b: T, k: number): T {
  if (k === 0) return a;
  if (k === 1) return b;
  const A = a as unknown as PoseRec;
  const B = b as unknown as PoseRec;
  const o: PoseRec = { ...A };
  for (const key in B) {
    const vb = B[key];
    const va = A[key] ?? vb;
    o[key] =
      typeof vb === 'number'
        ? (va as number) + (vb - (va as number)) * k
        : mixLimb(va as Limb, vb, k);
  }
  return o as unknown as T;
}

/** Добавка поверх живой позы: a + (b − ref)·k. */
function addP<T extends Pose>(a: T, b: T, ref: T, k = 1): T {
  const A = a as unknown as PoseRec;
  const B = b as unknown as PoseRec;
  const R = ref as unknown as PoseRec;
  const o: PoseRec = { ...A };
  for (const key in B) {
    const vb = B[key];
    const vr = R[key] ?? vb;
    const va = A[key] ?? vr;
    if (typeof vb === 'number') o[key] = (va as number) + (vb - (vr as number)) * k;
    else {
      const l = va as Limb;
      const r = vr as Limb;
      o[key] = {
        sw: l.sw + (vb.sw - r.sw) * k,
        out: l.out + (vb.out - r.out) * k,
        bend: l.bend + (vb.bend - r.bend) * k,
      };
    }
  }
  return o as unknown as T;
}

type PKey<T> = readonly [number, T, Ease?];
/** Поза на треке в момент t; кривая — у ключа, к которому идём. */
function track<T extends Pose>(t: number, keys: readonly PKey<T>[]): T {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const k1 = keys[i];
    if (t < k1[0]) {
      const k0 = keys[i - 1];
      return mixP(k0[1], k1[1], (k1[2] ?? ease)((t - k0[0]) / (k1[0] - k0[0])));
    }
  }
  return keys[keys.length - 1][1];
}
const trackEnd = <T>(keys: readonly PKey<T>[]) => keys[keys.length - 1][0];

/** Номер кадра техники: 24 к/с от времени режима, не дальше `end`. */
const F24 = (t: number, end = 99) =>
  Math.max(0, Math.min(Math.floor(t * 24 + 1e-6), Math.ceil(end * 24)));

/** Пружина (полунеявный Эйлер, шаг ≤ 1/120 с). */
function spring(
  x: number,
  v: number,
  to: number,
  w: number,
  z: number,
  dt: number,
): [number, number] {
  const n = Math.max(1, Math.ceil(dt * 120));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    v += (-w * w * (x - to) - 2 * z * w * v) * h;
    x += v * h;
  }
  return [x, v];
}
const quantS = (v: number, step: number, lim: number) =>
  Math.max(-lim, Math.min(lim, Math.round(v / step) * step));

/** Вырезать прямоугольник из буфера пикселей. */
function cutPx(p: Px, x0: number, y0: number, w: number, h: number): Px {
  const o = new Px(w, h);
  for (let y = 0; y < h; y++) {
    const s = ((y0 + y) * p.w + x0) * 4;
    o.data.set(p.data.subarray(s, s + w * 4), y * w * 4);
  }
  return o;
}

/** Рамка рисунка по обоим слоям (кадр в кеше — без пустых полей). */
function cropBox(
  a: Px,
  b: Px | null,
  boxA?: [number, number, number, number],
): [number, number, number, number] {
  let x0 = a.w;
  let y0 = a.h;
  let x1 = -1;
  let y1 = -1;
  for (const p of b ? [a, b] : [a]) {
    const d = p.data;
    // У тела рамку уже знает `renderRig` — сканируем только её.
    const [X0, Y0, X1, Y1] = p === a && boxA ? boxA : [0, 0, p.w - 1, p.h - 1];
    for (let y = Y0; y <= Y1; y++)
      for (let x = X0; x <= X1; x++)
        if (d[(y * p.w + x) * 4 + 3] > 0) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
  }
  return x1 < 0 ? [0, 0, 1, 1] : [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
}

/** Кадр из буферов с обрезкой: точка ног и метки сдвигаются вместе. */
function cropFrame(
  px: Px,
  lit: Px | null,
  ax: number,
  ay: number,
  extra: Partial<MobFrame> = {},
  boxA?: [number, number, number, number],
): { fr: MobFrame; x0: number; y0: number } {
  const [x0, y0, w, h] = cropBox(px, lit, boxA);
  const img = cutPx(px, x0, y0, w, h);
  const lt = lit ? cutPx(lit, x0, y0, w, h) : null;
  return {
    fr: {
      img: img.canvas(),
      ax: ax - x0,
      ay: ay - y0,
      eye: null,
      lit: lt ? lt.canvas() : null,
      still: true,
      ...extra,
    },
    x0,
    y0,
  };
}

/** Контровой свет: верхний и левый край силуэта — в слой поверх темноты. */
function rimLight(o: RigOut, lit: Px | null, c: RGBA): Px | null {
  const ids = o.ids;
  if (!ids) return lit;
  const { w, h, data } = o.px;
  const [X0, Y0, X1, Y1] = o.box ?? [0, 0, w - 1, h - 1];
  for (let y = Y0; y <= Y1; y++)
    for (let x = X0; x <= X1; x++) {
      const i = y * w + x;
      if (ids[i] < 0 || data[i * 4 + 3] === 0) continue;
      if (x > 0 && ids[i - 1] >= 0 && y > 0 && ids[i - w] >= 0) continue;
      lit ??= new Px(w, h);
      lit.set(x, y, c);
    }
  return lit;
}

/**
 * След взмаха: полосы между соседними положениями отрезка (внутренний
 * край, конец). `segs[0]` — сейчас; дальше в прошлое, слабее.
 */
function smearInto(lit: Px, segs: [number, number, number, number][], col: RGBA): void {
  if (segs.length < 2) return;
  const { w, h } = lit;
  const A = new Float32Array(w * h);
  const tri = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    a: number,
  ) => {
    const ar = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0);
    if (Math.abs(ar) < 0.05) return;
    const s = ar > 0 ? 1 : -1;
    const bx0 = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
    const bx1 = Math.min(w - 1, Math.ceil(Math.max(x0, x1, x2)));
    const by0 = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
    const by1 = Math.min(h - 1, Math.ceil(Math.max(y0, y1, y2)));
    for (let y = by0; y <= by1; y++)
      for (let x = bx0; x <= bx1; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        if (((x1 - x0) * (py - y0) - (y1 - y0) * (px - x0)) * s < 0) continue;
        if (((x2 - x1) * (py - y1) - (y2 - y1) * (px - x1)) * s < 0) continue;
        if (((x0 - x2) * (py - y2) - (y0 - y2) * (px - x2)) * s < 0) continue;
        const i = y * w + x;
        if (A[i] < a) A[i] = a;
      }
  };
  const n = segs.length - 1;
  for (let i = 0; i < n; i++) {
    const [ax, ay, bx, by] = segs[i];
    const [cx, cy, dx, dy] = segs[i + 1];
    const a = 0.7 * (1 - i / n) ** 1.3 + 0.08;
    tri(ax, ay, bx, by, dx, dy, a);
    tri(ax, ay, dx, dy, cx, cy, a);
  }
  // Кромка — самая яркая: по ней глаз читает, куда шёл удар.
  for (let i = 0; i < n; i++) {
    const [, , bx, by] = segs[i];
    const [, , dx, dy] = segs[i + 1];
    const k = Math.max(1, Math.ceil(Math.hypot(dx - bx, dy - by)));
    for (let s = 0; s <= k; s++) {
      const x = Math.floor(bx + ((dx - bx) * s) / k);
      const y = Math.floor(by + ((dy - by) * s) / k);
      if (x >= 0 && y >= 0 && x < w && y < h)
        A[y * w + x] = Math.max(A[y * w + x], 0.95 - i * 0.12);
    }
  }
  for (let i = 0; i < A.length; i++)
    if (A[i] > 0) lit.set(i % w, Math.floor(i / w), withA(col, A[i]));
}

/** Мягкое пятно света (ореол открытой ваги). */
function halo(p: Px, cx: number, cy: number, r: number, c: RGBA, a: number): void {
  for (let y = Math.floor(cy - r); y <= cy + r; y++)
    for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r;
      if (d < 1) p.set(x, y, withA(c, a * (1 - d) ** 1.6));
    }
}

// ---------------------------------------------------------------------------
// Рыцарь-исполин (акт I): та же кукла вдвое, копьё и щит. Ходит на нитях:
// шаг — подъём (колено вверх, тело тянет вверх), тяжёлое приземление.
// ---------------------------------------------------------------------------

const GIANT_BODY: Body = {
  ...KNIGHT_BODY,
  T: { ...KNIGHT_BODY.T, pelvis: P.red },
  torsoPat: bandPat(0, 0.32, P.red),
};

/** Поза исполина: копьё по древку (ln), копьё на полу (drop), сжатие, выпад. */
interface GP extends Pose {
  toe: number;
  ln: number;
  drop: number;
  sq: number;
  fw: number;
}
const GP0: GP = { ...pose0(), toe: 0, ln: 0, drop: 0, sq: 1, fw: 0 };
const gp = (o: Partial<GP>, b: GP = GP0): GP => ({ ...b, ...o });

const GS = 2;
const GW = 124;
const GH = 124;
const GAX = 62;
const GAY = 98;
/** Шаг исполина: клеток пути на два шага. */
const G_STRIDE = 1.6;

const G_BASE = gp({
  lean: 0.05,
  aR: limb(0.55, 0.15, 0.95),
  aL: limb(0.4, 0.32, 1.1),
  lL: limb(0.06, 0.08, 0.1),
  lR: limb(-0.06, 0.09, 0.1),
});
/** Куча лат: нити отпустили. */
const G_HEAP = gp({
  sink: 7.4,
  lean: 0.95,
  side: 0.22,
  hp: 1.0,
  hr: 0.35,
  aL: limb(0.15, 0.75, 0.1),
  aR: limb(0.25, 0.65, 0.15),
  lL: limb(1.45, 0.35, 2.5),
  lR: limb(1.2, 0.42, 2.3),
  drop: 1,
  toe: 0.3,
});

/** Шаг на нитях: 6 кадров на шаг, вторая половина — другой ногой. */
const G_STEP: readonly [number, number, number, Limb, Limb, number][] = [
  // bob, sink, sq, нога в переносе, опорная, носок
  [0, 0.9, 0.97, limb(-0.3, 0.08, 0.5), limb(0.3, 0.08, 0.15), 0.1],
  [1.5, 0, 1.02, limb(0.2, 0.1, 1.1), limb(0.15, 0.08, 0.05), 0.35],
  [2.8, 0, 1.03, limb(0.75, 0.1, 1.45), limb(0, 0.08, 0.05), 0.5],
  [3.0, 0, 1.02, limb(0.85, 0.1, 0.9), limb(-0.12, 0.08, 0.05), 0.3],
  [1.2, 0, 1, limb(0.55, 0.1, 0.2), limb(-0.25, 0.08, 0.1), 0],
  [-0.4, 1.7, 0.92, limb(0.35, 0.1, 0.25), limb(-0.32, 0.08, 0.2), 0],
];
function giantWalk(f: number): GP {
  const k = f % 6;
  const left = f < 6;
  const [bob, sink, sq, swing, stand, toe] = G_STEP[k];
  const fwdL = left ? swing.sw : stand.sw;
  return gp(
    {
      bob,
      sink,
      sq,
      toe,
      lean: 0.08,
      side: (left ? -1 : 1) * 0.04,
      twist: -0.08 * fwdL,
      lL: left ? swing : stand,
      lR: left ? stand : swing,
      aL: limb(0.4 - 0.25 * fwdL, 0.32, 1.1 - 0.1 * Math.abs(fwdL)),
      aR: limb(0.55 + 0.06 * fwdL, 0.15, 0.95),
      hp: 0.05 + 0.04 * (sq < 1 ? 1 : 0),
    },
    G_BASE,
  );
}

/** Таран: 8 кадров на 2,4 клетки, низко, голова вперёд. */
function giantRun(f: number): GP {
  const ph = (f / 8) * TAU;
  const s = Math.sin(ph);
  const c = Math.cos(ph);
  return gp(
    {
      lean: 0.55,
      hp: 0.5,
      bob: 1.2 * Math.abs(c),
      sink: 0.8,
      lL: limb(0.8 * s, 0.1, 0.25 + 1.1 * Math.max(0, c)),
      lR: limb(-0.8 * s, 0.1, 0.25 + 1.1 * Math.max(0, -c)),
      aR: limb(1.4, 0.1, 0.1),
      aL: limb(0.9 - 0.25 * s, 0.35, 1.0),
    },
    G_BASE,
  );
}

// Копьё: отвод (0–0,65) → держит → выпад, контакт ровно в 1,0 → проводка.
const G_LUNGE = gp(
  {
    twist: -0.45,
    lean: 0.35,
    sink: 2.6,
    aR: limb(1.45, 0.08, 0.05),
    aL: limb(0.2, 0.55, 0.8),
    lL: limb(0.78, 0.1, 0.65),
    lR: limb(-0.6, 0.12, 0.1),
    ln: 6,
    fw: 6,
  },
  G_BASE,
);
const G_LANCE: readonly PKey<GP>[] = [
  [0, G_BASE],
  [
    0.65,
    gp(
      {
        twist: 0.55,
        lean: -0.12,
        sink: 1.5,
        aR: limb(0.35, 0.25, 1.45),
        aL: limb(0.7, 0.4, 1.2),
        lL: limb(0.38, 0.1, 0.3),
        lR: limb(-0.35, 0.12, 0.35),
        ln: -5,
      },
      G_BASE,
    ),
  ],
  [
    0.9,
    gp(
      {
        twist: 0.62,
        lean: -0.15,
        sink: 1.8,
        aR: limb(0.3, 0.27, 1.55),
        aL: limb(0.75, 0.42, 1.2),
        lL: limb(0.4, 0.1, 0.32),
        lR: limb(-0.38, 0.12, 0.38),
        ln: -6,
      },
      G_BASE,
    ),
  ],
  [1.0, G_LUNGE, eIn],
  [
    1.08,
    gp({ twist: -0.52, lean: 0.4, sink: 2.8, aR: limb(1.5, 0.06, 0.02), ln: 7.5, fw: 7 }, G_LUNGE),
    easeOut,
  ],
  [1.35, gp({ twist: -0.5, lean: 0.38, ln: 6.5, fw: 6 }, G_LUNGE)],
  [1.8, G_BASE],
];

// Щит: замах в сторону → удар (0,8) → проводка.
const G_BASH = gp(
  {
    twist: 0.5,
    lean: 0.3,
    sink: 2.1,
    aL: limb(1.5, 0.15, 0.4),
    aR: limb(0.3, 0.3, 0.9),
    lL: limb(0.55, 0.12, 0.45),
    lR: limb(-0.4, 0.14, 0.15),
    fw: 4,
  },
  G_BASE,
);
const G_SHIELD: readonly PKey<GP>[] = [
  [0, G_BASE],
  [
    0.55,
    gp(
      {
        twist: -0.6,
        lean: -0.1,
        sink: 1.3,
        aL: limb(0.45, 1.1, 0.9),
        aR: limb(0.5, 0.2, 1.0),
        lL: limb(0.25, 0.14, 0.25),
        lR: limb(-0.25, 0.14, 0.25),
      },
      G_BASE,
    ),
  ],
  [
    0.7,
    gp(
      {
        twist: -0.68,
        lean: -0.12,
        sink: 1.5,
        aL: limb(0.5, 1.22, 0.85),
        aR: limb(0.5, 0.2, 1.0),
        lL: limb(0.28, 0.14, 0.28),
        lR: limb(-0.28, 0.14, 0.28),
      },
      G_BASE,
    ),
  ],
  [0.8, G_BASH, eIn],
  [
    0.9,
    gp({ twist: 0.62, lean: 0.34, sink: 2.2, aL: limb(1.6, -0.05, 0.35), fw: 4.5 }, G_BASH),
    easeOut,
  ],
  [1.15, gp({ twist: 0.58, aL: limb(1.55, 0.02, 0.38), fw: 4 }, G_BASH)],
  [1.6, G_BASE],
];

// Разгон: присел, голова вперёд, бьёт ногой землю.
const G_CROUCH = gp(
  {
    lean: 0.38,
    sink: 2.6,
    hp: 0.45,
    aR: limb(1.35, 0.1, 0.15),
    aL: limb(0.95, 0.35, 1.0),
    lL: limb(0.42, 0.1, 0.5),
    lR: limb(-0.35, 0.12, 0.4),
  },
  G_BASE,
);
const G_STAMP = gp({ lR: limb(-0.15, 0.12, 1.25), bob: 0.6, sink: 2.0 }, G_CROUCH);
const G_THUD = gp({ sq: 0.95, sink: 2.8 }, G_CROUCH);
const G_AIM: readonly PKey<GP>[] = [
  [0, G_BASE],
  [0.25, G_CROUCH],
  [0.35, G_STAMP, easeOut],
  [0.45, G_THUD, eIn],
  [0.6, G_STAMP, easeOut],
  [0.7, G_THUD, eIn],
  [0.85, G_STAMP, easeOut],
  [0.95, G_THUD, eIn],
  [1.0, gp({ lean: 0.48, hp: 0.5 }, G_CROUCH)],
];

// Остановка тарана: клюёт носом и выпрямляется.
const G_DIP: readonly PKey<GP>[] = [
  [0, gp({ lean: 0.55, hp: 0.5, aR: limb(1.4, 0.1, 0.1), aL: limb(0.9, 0.35, 1.0) }, G_BASE)],
  [
    0.12,
    gp(
      {
        lean: 0.9,
        hp: 0.75,
        sink: 2.2,
        fw: 5,
        sq: 0.94,
        aR: limb(1.1, 0.12, 0.05),
        aL: limb(1.1, 0.4, 0.6),
        lL: limb(0.5, 0.1, 0.4),
        lR: limb(-0.5, 0.12, 0.2),
      },
      G_BASE,
    ),
    easeOut,
  ],
  [0.35, gp({ lean: -0.15, hp: -0.1, sink: 0.5, fw: -1, sq: 1.03 }, G_BASE)],
  [0.55, gp({ lean: 0.1 }, G_BASE)],
  [0.8, G_BASE],
];

// Нити отпустили: голова, руки, колени, корпус — по суставам в кучу.
const G_SLUMP: readonly PKey<GP>[] = [
  [0, G_BASE],
  [0.15, gp({ hp: 1.0 }, G_BASE), eIn],
  [
    0.35,
    gp({ hp: 1.0, aL: limb(0.1, 0.5, 0.05), aR: limb(0.1, 0.45, 0.05), drop: 0.35 }, G_BASE),
    eIn,
  ],
  [
    0.6,
    gp(
      {
        hp: 1.0,
        sink: 4.2,
        lean: 0.3,
        aL: limb(0.1, 0.6, 0.05),
        aR: limb(0.15, 0.55, 0.1),
        lL: limb(0.8, 0.25, 1.4),
        lR: limb(0.65, 0.3, 1.3),
        drop: 0.85,
      },
      G_BASE,
    ),
    eIn,
  ],
  [0.9, G_HEAP, eIn],
  [1.0, gp({ sink: 6.6, lean: 0.88 }, G_HEAP), easeOut],
  [1.12, G_HEAP],
];

// Сборка: нити поднимают части по одной — правая рука, левая, корпус, ноги.
const G_REB: readonly PKey<GP>[] = [
  [0, G_HEAP],
  [0.5, gp({ aR: G_BASE.aR, drop: 0 }, G_HEAP), eBack],
  [1.0, gp({ aR: G_BASE.aR, aL: G_BASE.aL, drop: 0 }, G_HEAP), eBack],
  [
    1.6,
    gp(
      { aR: G_BASE.aR, aL: G_BASE.aL, drop: 0, lean: 0.05, hp: 0, hr: 0, side: 0, sink: 4.5 },
      G_HEAP,
    ),
    eBack,
  ],
  [2.2, gp({ sink: -1.2, bob: 0 }, G_BASE), eBack],
  [2.36, gp({ sink: 1.7, sq: 0.93 }, G_BASE), eIn],
  [2.5, G_BASE, easeOut],
];

// Встаёт (начало акта): то же, сжато в 1,2 с.
const G_STAND: readonly PKey<GP>[] = [
  [0, G_HEAP],
  [0.3, gp({ aR: G_BASE.aR, aL: G_BASE.aL, drop: 0 }, G_HEAP), eBack],
  [
    0.65,
    gp(
      { aR: G_BASE.aR, aL: G_BASE.aL, drop: 0, lean: 0.05, hp: 0, hr: 0, side: 0, sink: 4.5 },
      G_HEAP,
    ),
    eBack,
  ],
  [1.0, gp({ sink: -0.8 }, G_BASE), eBack],
  [1.2, G_BASE],
];

// Смерть: разваливается (сцена короткая — акт убирает его сразу).
const G_DIE: readonly PKey<GP>[] = [
  [0, gp({ lean: -0.3, hp: -0.4, aL: limb(0.5, 0.9, 0.2), aR: limb(0.5, 0.8, 0.2) }, G_BASE)],
  [0.35, gp({ sink: 8.5, side: 0.4 }, G_HEAP), eIn],
  [0.7, gp({ sink: 8.8, side: 0.45 }, G_HEAP)],
];

/** Обрезанные нити → какая часть обвисает (бит: 0 пр. рука, 1 пр. плечо, 2 л. рука, 3 л. плечо). */
function giantCut(g: Mob): number {
  const cut = g.data.cut ?? 0;
  const n = g.data.sn ?? 0;
  if (!cut || n < 2) return 0;
  const vg = F13_FX.vaga;
  let px = 1;
  let py = 0;
  const L = Math.hypot(vg.x - g.x, vg.y - g.y);
  if (L > 0.01) {
    px = -(vg.y - g.y) / L;
    py = (vg.x - g.x) / L;
    if (px < 0) [px, py] = [-px, -py];
  }
  // Нити расходятся поперёк направления к ваге (как в `stringsOf`);
  // правая сторона куклы — по её лицу.
  const rx = -Math.sin(g.face);
  const ry = Math.cos(g.face);
  let bits = 0;
  for (let i = 0; i < n; i++) {
    if (!(cut & (1 << i))) continue;
    const ox = i / (n - 1) - 0.5;
    const right = ox * (px * rx + py * ry) >= 0;
    const arm = Math.abs(ox) > 0.3;
    bits |= 1 << ((right ? 0 : 2) + (arm ? 0 : 1));
  }
  return bits;
}

function giantCutPose(q: GP, bits: number, k: number): GP {
  if (!bits) return q;
  let o = q;
  let side = 0;
  let hr = 0;
  if (bits & 1) {
    o = mixP(o, gp({ aR: limb(0.05, 0.18, 0.05) }, o), k);
    side += 0.08;
  }
  if (bits & 2) {
    side += 0.16;
    hr += 0.25;
  }
  if (bits & 4) {
    o = mixP(o, gp({ aL: limb(0.05, 0.2, 0.05) }, o), k);
    side -= 0.08;
  }
  if (bits & 8) {
    side -= 0.16;
    hr -= 0.25;
  }
  return gp({ side: o.side + side * k, hr: o.hr + hr * k }, o);
}

interface GRig {
  rig: Rig;
  j: Joints;
  tip: V3;
  mid: V3;
  sh: V3;
}
function giantRig(q: GP): GRig {
  const rig = new Rig();
  const j = humanoid(rig, GIANT_BODY, q);
  const R = GIANT_BODY.head;
  rig.dot(onHead(j, R, 0.98, -0.35, 0.05), INK, 1);
  rig.dot(onHead(j, R, 0.98, 0.35, 0.05), INK, 1);
  rig.dot(onHead(j, R, 0.98, 0, 0.05), INK, 1);
  rig.dot(onHead(j, R, 1.0, -0.35, 0.05), hx('#ffe08a'), 0.5, true);
  rig.cap(onHead(j, R, 0.1, 0, 0.95), onHead(j, R, -1.3, 0, 1.6), 1.3, 0.8, P.gold);
  rig.ball(vadd(j.shL, v3(0, 0.6, 0)), 1.9, P.silver);
  rig.ball(vadd(j.shR, v3(0, 0.6, 0)), 1.9, P.silver);
  // Копьё: держит у пояса, ходит по древку (ln); упало — лежит рядом.
  const ld = vnorm(vadd(j.foreR, vsc(j.fwd, 1.4)));
  let a = vadd(j.haR, vsc(ld, -4 + q.ln));
  let b = vadd(j.haR, vsc(ld, 15 + q.ln));
  if (q.drop > 0) {
    const k = ease(q.drop);
    a = vmix(a, v3(-3.5, 0.7, -3), k);
    b = vmix(b, v3(2.5, 0.7, 15), k);
  }
  rig.cap(a, b, 0.7, 0.35, P.wood, (t) =>
    t > 0.85 ? P.silver : Math.floor(t * 10) % 2 ? P.red : null,
  );
  const ad = vnorm(vsub(b, a));
  const g0 = vadd(a, vsc(ad, 4.5 - q.ln * (1 - q.drop)));
  rig.cap(vadd(g0, vsc(ad, 0.5)), vadd(g0, vsc(ad, 2.5)), 1.8, 0.6, P.silver);
  // Щит-миндаль с гербом.
  const sh = vadd(vmix(j.elL, j.haL, 0.6), vsc(j.fwd, 1));
  rig.cap(vadd(sh, v3(0, 2, 0)), vadd(sh, v3(0, -2.5, 0)), 3.6, 1.6, P.blue, (t, nx) =>
    Math.abs(nx) < 0.15 || Math.abs(t - 0.4) < 0.08 ? P.gold : null,
  );
  return { rig, j, tip: b, mid: vmix(a, b, 0.55), sh };
}

interface GSmear {
  keys: readonly PKey<GP>[];
  T: number;
  w0: number;
  w1: number;
  part: 'tip' | 'shield';
}
interface GSpec {
  q: GP;
  key: string;
  smear: GSmear | null;
  trail: boolean;
  alpha: number;
}

/** Поза исполина по режиму (чистая функция — её же зовёт прогрев). */
function giantSpec(
  mode: string,
  t: number,
  prev: string,
  odo: number,
  now: number,
  speed: number,
): GSpec {
  const tk = (
    keys: readonly PKey<GP>[],
    T: number,
    id: string,
    win?: [number, number],
    part: GSmear['part'] = 'tip',
  ): GSpec => {
    const n = F24(T, trackEnd(keys));
    const tq = n / 24;
    const sm = win && tq >= win[0] && tq <= win[1] + 0.06;
    return {
      q: track(tq, keys),
      key: `${id}${n}`,
      smear: sm ? { keys, T: tq, w0: win[0], w1: win[1], part } : null,
      trail: false,
      alpha: 1,
    };
  };
  switch (mode) {
    case 'f13_lance':
      return tk(G_LANCE, t, 'L', [0.88, 1.05]);
    case 'f13_shield':
      return tk(G_SHIELD, t, 'S', [0.66, 0.86], 'shield');
    case 'f13_charge_aim':
      return tk(G_AIM, t, 'A');
    case 'f13_charge': {
      const f = Math.floor(((odo / 2.4) % 1) * 8) % 8;
      return { q: giantRun(f), key: `R${f}`, smear: null, trail: true, alpha: 1 };
    }
    case 'recover':
      if (prev === 'f13_lance') return tk(G_LANCE, 1 + t, 'L', [0.88, 1.05]);
      if (prev === 'f13_shield') return tk(G_SHIELD, 0.8 + t, 'S', [0.66, 0.86], 'shield');
      if (prev === 'f13_charge') return tk(G_DIP, t, 'D');
      break;
    case 'f13_slump': {
      if (t < 1.12) return tk(G_SLUMP, t, 'P');
      // Лежит; изредка дёргается нитка.
      const f = Math.floor(now * 6) % 14;
      const q = f === 3 ? gp({ aR: limb(0.45, 0.6, 0.4) }, G_HEAP) : G_HEAP;
      return { q, key: `P_${f === 3 ? 1 : 0}`, smear: null, trail: false, alpha: 1 };
    }
    case 'f13_rebuild':
      return tk(G_REB, t, 'B');
    case 'f13_stand':
      return tk(G_STAND, t, 'U');
    case 'dying': {
      const s = tk(G_DIE, t, 'X');
      s.alpha = clamp01(1 - (t - 0.35) / 0.35);
      return s;
    }
  }
  if (speed > 0.2) {
    const f = Math.floor(((odo / G_STRIDE) % 1) * 12) % 12;
    return { q: giantWalk(f), key: `W${f}`, smear: null, trail: false, alpha: 1 };
  }
  const f = Math.floor(now * 6) % 8;
  const s = Math.sin((f / 8) * TAU);
  return {
    q: gp({ bob: 0.35 * s, aL: limb(0.4 + 0.05 * s, 0.32, 1.1) }, G_BASE),
    key: `I${f}`,
    smear: null,
    trail: false,
    alpha: 1,
  };
}

interface GCached {
  fr: MobFrame;
  /** Плечи над точкой ног на холсте, пиксели. */
  sh: number;
}

function giantRender(q: GP, dir: number, flash: boolean, smear: GSmear | null): GCached {
  const { rig, j } = giantRig(q);
  const yaw = (dir / 16) * TAU;
  const o = renderRig(rig, yaw, GW, GH, GAX, GAY, { flash, scale: GS });
  const proj = rigProj(yaw, GS, GAX, GAY);
  let lit = o.lit;
  if (smear) {
    const segs: [number, number, number, number][] = [];
    for (let k = 0; k < 7; k++) {
      const ts = smear.T - k / 72;
      if (ts < smear.w0 - 1e-6) break;
      if (ts > smear.w1 + 1e-6) continue;
      const g = k === 0 ? giantRig(q) : giantRig(track(ts, smear.keys));
      const [p0, p1] =
        smear.part === 'tip'
          ? [g.mid, g.tip]
          : [vadd(g.sh, vsc(g.j.up, 2.4)), vadd(g.sh, vsc(g.j.up, -3))];
      const [ax, ay] = proj(p0);
      const [bx, by] = proj(p1);
      segs.push([ax, ay, bx, by]);
    }
    if (segs.length >= 2) {
      lit ??= new Px(GW, GH);
      smearInto(lit, segs, flash ? WHITE : SMEAR_C);
    }
  }
  const shY = (proj(j.shL)[1] + proj(j.shR)[1]) / 2;
  const { fr } = cropFrame(o.px, lit, GAX, GAY, { shadow: 16 }, o.box);
  return { fr, sh: GAY - shY };
}

interface GState {
  now: number;
  mode: string;
  prev: string;
  odo: number;
  sh: number;
  fl: boolean;
  hitAt: number;
  hdx: number;
  hdy: number;
}
const GST = new Map<number, GState>();
const GIANT_CACHE = frameLRU<GCached>(500);
const TRAIL = { every: 0.06, life: 0.26, tint: '#2a1e3a', alpha: 0.4 };

function giantKey(s: GSpec, dir: number, flash: boolean, cut: number): string {
  return `${s.key}:${dir}:${flash ? 1 : 0}:${cut}`;
}

paintMob('f13_giant', (m, pose) => {
  const now = pose.now;
  let st = GST.get(m.id);
  if (!st || now < st.now - 1e-4 || now - st.now > 1) {
    if (GST.size > 8) GST.clear();
    st = { now, mode: m.mode, prev: '', odo: 0, sh: 34, fl: pose.flash, hitAt: -9, hdx: 0, hdy: 0 };
    GST.set(m.id, st);
  }
  const dt = Math.min(0.1, Math.max(0, now - st.now));
  st.now = now;
  if (m.mode !== st.mode) {
    st.prev = st.mode;
    st.mode = m.mode;
  }
  const speed = Math.hypot(m.vx, m.vy);
  st.odo += speed * dt;
  if (pose.flash && !st.fl) {
    const h = paintSim()?.hero;
    const ax = h ? m.x - h.x : -Math.cos(m.face);
    const ay = h ? m.y - h.y : -Math.sin(m.face);
    const L = Math.hypot(ax, ay) || 1;
    st.hitAt = now;
    st.hdx = ax / L;
    st.hdy = ay / L;
  }
  st.fl = pose.flash;
  const s = giantSpec(m.mode, m.t, st.prev, st.odo, now, speed);
  const cut = m.mode === 'dying' ? 0 : giantCut(m);
  const busy = m.mode !== 'chase' && m.mode !== 'f13_stand';
  const q = giantCutPose(s.q, cut, busy ? 0.6 : 1);
  const dir = dirOf(m.face, 16);
  const key = giantKey(s, dir, pose.flash, cut);
  let c = GIANT_CACHE.get(key);
  if (!c) c = GIANT_CACHE.set(key, giantRender(q, dir, pose.flash, s.smear));
  const yaw = (dir / 16) * TAU;
  let dx = q.fw * Math.cos(yaw);
  let dy = q.fw * Math.sin(yaw);
  const ha = now - st.hitAt;
  if (ha >= 0 && ha < 0.2) {
    const k = 1 - ha / 0.2;
    dx += st.hdx * 1.6 * k;
    dy += st.hdy * 1.6 * k;
  }
  const fr: MobFrame = { ...c.fr, dx, dy, alpha: s.alpha, ghost: s.trail ? TRAIL : null };
  if (q.sq !== 1) {
    fr.sy = q.sq;
    fr.sx = 1 + (1 - q.sq) * 0.6;
  }
  st.sh = c.sh * q.sq - dy - 2;
  return fr;
});

/**
 * Высота плеч исполина над его точкой на полу, игровые пиксели. Сюда
 * `f13-boss-fx.ts` крепит его нити: берётся из последнего нарисованного
 * кадра (присед, куча лат, подъём на нитях), с поправкой на сдвиг кадра.
 */
export function giantShoulderPx(m: Mob, _now: number): number {
  return GST.get(m.id)?.sh ?? 34;
}

// ---------------------------------------------------------------------------
// Кукловод: высокий цилиндр с лентой, фарфоровая маска с нарисованной
// улыбкой, фрак с фалдами, белая манишка, золото; вага-крестовина в руке.
// Акты I–III висит на нитях: маятник вокруг подвеса, ноги и фалды отстают
// пружиной, рука с вагой дёргает раньше удара исполина. Акт IV ходит сам.
// Техники — ключи 24 к/с от `m.t`, контакт — в кадре урона.
// ---------------------------------------------------------------------------

/** Масштаб модели и холст до обрезки (точка ног — LAX, LAY). */
const LS = 1.5;
const LW = 124;
const LH = 150;
const LAX = 62;
const LAY = 134;
const LIFT_PX = 30;
/** Точка подвеса (поля шляпы), пиксели над ногами: вокруг неё качается. */
const PIVOT = 47;

const COAT: Tone = [hx('#09060e'), hx('#1e1632'), hx('#3a2c5a'), hx('#6e5ca6')];
const TROUS: Tone = [hx('#08060c'), hx('#17121f'), hx('#2a2236'), hx('#4c405e')];
const SHIRT: Tone = [hx('#8a8296'), hx('#d4ccd8'), hx('#f2eef4'), hx('#ffffff')];
const HAT: Tone = [hx('#050308'), hx('#141019'), hx('#2a2236'), hx('#5c4c74')];
const SHOE: Tone = [hx('#050307'), hx('#121016'), hx('#2c2834'), hx('#9a94a6')];
const LIP = hx('#a01c2c');
const ROUGE = hx('#e88aa2');
const GHOST_T = hx('#7a68b0');
const RIM = hx('#ffe6be', 150);
const RIM_G = hx('#d8caff', 140);
const THREAD = P.gold[2];

/** Перед и право торса — для манишки (узор читает нормаль модели). */
const DRESS = { fwd: v3(0, 0, 1), right: v3(1, 0, 0) };

const LORD_BODY: Body = {
  hip: 13.8,
  torso: 10,
  waist: 2.5,
  chest: 3.8,
  neck: 1.6,
  head: 3.6,
  shW: 3.9,
  upper: 5.6,
  fore: 5.2,
  armR: 1.15,
  hand: 1.3,
  hipW: 1.5,
  thigh: 6.4,
  shin: 6.4,
  legR: 1.2,
  foot: 2.5,
  T: {
    torso: COAT,
    arm: COAT,
    leg: TROUS,
    head: P.porcelain,
    hand: SHIRT,
    foot: SHOE,
    joint: SHIRT,
    pelvis: COAT,
  },
  // Манишка — V от пояса к вороту, по краю золотые лацканы, запонки.
  torsoPat: (t, _nx, _ny, nm) => {
    const f = vdot(nm, DRESS.fwd);
    if (f < 0.25) return null;
    const r = Math.abs(vdot(nm, DRESS.right));
    const v = 0.1 + 0.34 * clamp01((t - 0.18) / 0.82);
    if (t > 0.18 && r < v) {
      if (r < 0.07 && (Math.abs(t - 0.42) < 0.05 || Math.abs(t - 0.64) < 0.05)) return P.gold[2];
      return SHIRT;
    }
    if (t > 0.22 && r < v + 0.14) return P.gold;
    if (t < 0.16 && t > 0.04 && Math.abs(r - 0.3) < 0.08) return P.gold[2];
    return null;
  },
};

/** Поза Кукловода: тело и всё, что он держит. */
interface LP extends Pose {
  toe: number;
  /** Ось ваги в осях торса: вправо, вверх, вперёд. */
  wx: number;
  wy: number;
  wz: number;
  /** Хват: 0 — за середину (правит), 1 — за конец (клинком). */
  wg: number;
  /** 1 — вага в правой; 0 — выпала и лежит (vX, vY, vZ; ось wx/wy/wz в осях модели). */
  wh: number;
  vX: number;
  vY: number;
  vZ: number;
  /** Пальцы веером: правая, левая. */
  fR: number;
  fL: number;
  /** Фалды: назад, вбок, разлёт. */
  tb: number;
  ts: number;
  tw: number;
  /** Шляпа: 0 — на голове, 1 — в левой руке, 2 — слетела (hX, hY, hZ, наклон hT). */
  hat: number;
  hX: number;
  hY: number;
  hZ: number;
  hT: number;
  /** Иглы веером в левой. */
  nd: number;
  /** Аркан: петля есть, угол раскрутки, бросок (0…1 летит, 1…2 лежит). */
  lo: number;
  la: number;
  lt: number;
  /** Нити между пальцами (сетка). */
  web: number;
  /** Выпад вперёд по ходу и подъём на нитях (смерть), пиксели; сжатие кадра. */
  fw: number;
  up: number;
  sq: number;
}

const LP0: LP = {
  ...pose0(),
  toe: 0,
  wx: 0,
  wy: -0.15,
  wz: 1,
  wg: 0,
  wh: 1,
  vX: 0,
  vY: 0,
  vZ: 0,
  fR: 0,
  fL: 0,
  tb: 0.12,
  ts: 0,
  tw: 0,
  hat: 0,
  hX: 0,
  hY: 0,
  hZ: 0,
  hT: 0,
  nd: 0,
  lo: 0,
  la: 0,
  lt: 0,
  web: 0,
  fw: 0,
  up: 0,
  sq: 1,
};
const lp = (o: Partial<LP>, b: LP = LP0): LP => ({ ...b, ...o });

// ---- опорные позы ----------------------------------------------------------

/** Висит и правит: вага перед грудью, левую тянет нить за запястье. */
const HOLD = lp({
  lean: 0.06,
  twist: 0.1,
  hp: 0.18,
  toe: 0.85,
  aR: limb(1.05, 0.3, 1.0),
  aL: limb(0.5, 0.6, 0.8),
  lL: limb(0.1, 0.06, 0.3),
  lR: limb(-0.04, 0.07, 0.4),
  wx: -0.1,
  wy: -0.15,
  wz: 1,
  tb: 0.1,
});
/** Безжизненная кукла (до пробуждения). */
const LIMP = lp({
  lean: 0.2,
  side: 0.12,
  hp: 0.95,
  hr: 0.25,
  toe: 1.1,
  aR: limb(0.05, 0.12, 0.05),
  aL: limb(0, 0.1, 0.05),
  lL: limb(0.05, 0.04, 0.15),
  lR: limb(0, 0.04, 0.2),
  wx: 0.1,
  wy: -1,
  wz: 0.15,
  wg: 0.6,
  tb: 0.02,
});
/** Акт IV, стоит: вага тростью у ноги. */
const STAND = lp({
  lean: 0.03,
  twist: 0.08,
  hp: 0.05,
  aR: limb(0.5, 0.22, 0.55),
  aL: limb(0.12, 0.2, 0.35),
  lL: limb(0.08, 0.1, 0.05),
  lR: limb(-0.06, 0.12, 0.05),
  wx: 0.1,
  wy: -0.9,
  wz: 0.45,
  wg: 1,
  tb: 0.06,
});
/** Акт IV, к бою: правый бок вперёд, вага клинком. */
const GUARD = lp({
  lean: 0.08,
  twist: -0.25,
  sink: 1.5,
  hp: -0.05,
  aR: limb(1.0, 0.3, 0.55),
  aL: limb(0.75, 0.75, 1.2),
  lL: limb(0.35, 0.12, 0.3),
  lR: limb(-0.3, 0.14, 0.25),
  wx: 0,
  wy: 0.15,
  wz: 1,
  wg: 1,
  tb: 0.15,
});
/** Рука у полей шляпы. */
const DOFF = limb(2.6, 0.3, 1.2);

// ---- циклы -------------------------------------------------------------------

/** Висит: 16 кадров (10 к/с); ноги и фалды отстают на пружине (lg, ls). */
function hangPose(f: number, lg: number, ls: number): LP {
  const ph = (f / 16) * TAU;
  const s = Math.sin(ph);
  return lp(
    {
      bob: 0.6 * s,
      hp: HOLD.hp + 0.06 * Math.sin(ph + 1.1),
      hr: 0.05 * Math.sin(ph - 0.3),
      lL: limb(
        HOLD.lL.sw + 0.1 * Math.sin(ph - 0.7) + lg,
        HOLD.lL.out - ls,
        HOLD.lL.bend + 0.1 * Math.max(0, s),
      ),
      lR: limb(
        HOLD.lR.sw - 0.1 * Math.sin(ph - 0.7) + lg,
        HOLD.lR.out + ls,
        HOLD.lR.bend + 0.1 * Math.max(0, -s),
      ),
      aL: limb(HOLD.aL.sw + 0.07 * Math.sin(ph - 0.4), HOLD.aL.out + 0.04 * s, HOLD.aL.bend),
      tb: HOLD.tb + 0.05 * Math.sin(ph - 1.3) - lg * 1.5,
      ts: ls * 1.4,
      tw: 0.04 * Math.sin(ph - 0.9),
      toe: HOLD.toe + 0.06 * Math.sin(ph - 0.5),
    },
    HOLD,
  );
}

/** Акт IV, шаг: 8 кадров на 1,3 клетки пути; вага тростью, фалды запаздывают. */
const L_STRIDE = 1.3;
function walkPose(f: number): LP {
  const ph = (f / 8) * TAU;
  const s = Math.sin(ph);
  const c = Math.cos(ph);
  return lp({
    bob: 0.9 * Math.abs(c) - 0.3,
    lean: 0.1,
    twist: 0.14 * s + 0.05,
    hp: 0.04,
    hr: 0.03 * s,
    lL: limb(0.5 * s, 0.07, 0.12 + 0.95 * Math.max(0, c) ** 1.5),
    lR: limb(-0.5 * s, 0.07, 0.12 + 0.95 * Math.max(0, -c) ** 1.5),
    aL: limb(-0.4 * s, 0.16, 0.3 + 0.15 * Math.max(0, -s)),
    aR: limb(0.55 + 0.12 * s, 0.2, 0.6),
    wx: 0.05,
    wy: -0.75,
    wz: 0.65,
    wg: 1,
    tb: 0.22 + 0.08 * Math.sin(2 * ph - 1.2),
    tw: 0.07 * Math.sin(ph - 0.8),
  });
}

/** Акт IV, стоит: 12 кадров (8 к/с) — переносит вес, оглядывается. */
function standPose(f: number): LP {
  const ph = (f / 12) * TAU;
  const s = Math.sin(ph);
  return lp(
    {
      bob: 0.3 * s,
      side: 0.025 * s,
      hy: 0.22 * Math.sin(ph + 0.6),
      wx: STAND.wx + 0.12 * Math.sin(ph - 0.4),
      tb: STAND.tb + 0.03 * Math.sin(ph - 1),
    },
    STAND,
  );
}

/** Внизу, без нитей: растерян — озирается, вага опущена. 16 кадров (8 к/с). */
function lostPose(f: number): LP {
  const ph = (f / 16) * TAU;
  const s = Math.sin(ph);
  return lp(
    {
      sink: 1.3,
      lean: 0.12,
      bob: 0.25 * Math.abs(Math.cos(ph)),
      hy: 0.6 * s,
      hp: 0.12,
      hr: -0.12 * s,
      aL: limb(0.75, 0.55 + 0.12 * s, 1.0),
      aR: limb(0.85, 0.35, 0.95),
      wx: 0.15,
      wy: -0.55,
      wz: 0.8,
      wg: 0.3,
      fL: 0.5,
      lL: limb(0.14 + 0.1 * Math.max(0, s), 0.12, 0.25 + 0.3 * Math.max(0, s)),
      lR: limb(-0.1 + 0.1 * Math.max(0, -s), 0.13, 0.3 + 0.3 * Math.max(0, -s)),
    },
    STAND,
  );
}

// ---- сцены и техники (ключи) ---------------------------------------------------

/** Пробуждение 2,4 с: кукла оживает по частям, вага выводит дугу. */
const ROAR: readonly PKey<LP>[] = [
  [0, LIMP],
  [0.3, lp({ side: 0.05, hr: 0.16 }, LIMP)],
  [0.47, lp({ hp: -0.25, hr: 0, side: 0.04 }, LIMP), eBack],
  [
    0.74,
    lp({ hp: -0.15, aR: HOLD.aR, wx: HOLD.wx, wy: HOLD.wy, wz: HOLD.wz, wg: 0, side: 0.02 }, LIMP),
    eBack,
  ],
  [
    1.02,
    lp(
      { hp: -0.1, aR: HOLD.aR, aL: HOLD.aL, wx: HOLD.wx, wy: HOLD.wy, wz: HOLD.wz, wg: 0, side: 0 },
      LIMP,
    ),
    eBack,
  ],
  [1.28, lp({ bob: 1.5 }, HOLD), eBack],
  [
    1.55,
    lp(
      { aL: DOFF, aR: limb(1.55, 1.15, 0.45), wx: 1, wy: 0.35, wz: 0.25, twist: 0.25, hp: -0.1 },
      HOLD,
    ),
  ],
  [
    1.85,
    lp(
      {
        aL: DOFF,
        aR: limb(1.35, -0.25, 0.7),
        wx: -0.8,
        wy: 0.3,
        wz: 0.6,
        twist: -0.25,
        lean: 0.12,
      },
      HOLD,
    ),
  ],
  [2.15, lp({ lean: 0.4, hp: 0.3, aL: limb(1.0, 0.8, 0.4), aR: limb(1.1, 0.3, 1.2) }, HOLD)],
  [2.4, HOLD],
];

/** Смена акта 3,2 с: снимает шляпу, глубокий поклон в воздухе, надевает. */
const BOW_AIR = lp(
  {
    lean: 0.95,
    hp: 0.35,
    aL: limb(0.95, 1.0, 0.2),
    hat: 1,
    aR: limb(0.85, -0.35, 1.9),
    wx: -0.3,
    wy: -0.7,
    wz: 0.4,
    lR: limb(-0.45, 0.07, 0.6),
    lL: limb(0.25, 0.06, 0.4),
    toe: 0.6,
  },
  HOLD,
);
const VAGA_LOW = { aR: limb(0.4, 0.25, 0.95), wx: 0.1, wy: -0.85, wz: 0.45 };
const TRANS: readonly PKey<LP>[] = [
  [0, HOLD],
  [0.25, lp({ aL: DOFF, ...VAGA_LOW, hp: 0.05 }, HOLD)],
  [0.45, lp({ aL: limb(2.75, 0.35, 0.9), hat: 1, ...VAGA_LOW }, HOLD)],
  [0.8, lp({ aL: limb(1.55, 1.25, 0.25), hat: 1, ...VAGA_LOW, twist: 0.15 }, HOLD)],
  [1.25, BOW_AIR],
  [2.1, lp({ lean: 0.88, hp: 0.3 }, BOW_AIR)],
  [2.45, lp({ aL: limb(2.75, 0.35, 0.9), hat: 1, ...VAGA_LOW, lean: 0.05 }, HOLD)],
  [2.62, lp({ aL: DOFF, hat: 0, ...VAGA_LOW }, HOLD)],
  [
    2.9,
    lp(
      { aL: limb(1.3, 1.25, 0.35), aR: limb(1.3, 1.2, 0.35), wx: 0.7, wy: 0.3, wz: 0.6, hp: -0.15 },
      HOLD,
    ),
    easeOut,
  ],
  [3.2, HOLD],
];

/** Иглы (акт III): веер в левой у уха → бросок в 0,45 (вага остаётся в правой). */
const NEEDLE: readonly PKey<LP>[] = [
  [0, HOLD],
  [
    0.26,
    lp({ aL: limb(2.5, 0.55, 2.1), twist: -0.15, hy: -0.15, fL: 1, nd: 1, lean: -0.05 }, HOLD),
    easeOut,
  ],
  [
    0.33,
    lp({ aL: limb(2.65, 0.6, 2.25), twist: -0.22, hy: -0.15, fL: 1, nd: 1, lean: -0.08 }, HOLD),
  ],
  [
    0.45,
    lp({ aL: limb(1.45, 0.25, 0.1), twist: 0.4, lean: 0.12, fL: 1, nd: 0, hy: 0.05 }, HOLD),
    eIn,
  ],
];
const NEEDLE_FT: readonly PKey<LP>[] = [
  [0, NEEDLE[3][1]],
  [0.1, lp({ aL: limb(1.15, 0.2, 0.05), twist: 0.5, lean: 0.15, fL: 0.6 }, HOLD), easeOut],
  [0.5, HOLD],
];

// Жесты акта I поверх висения: вага дёргает РАНЬШЕ удара исполина.
const G_L_PULL = lp(
  { aR: limb(1.5, 0.45, 1.65), wx: 0.05, wy: 0.45, wz: 0.85, twist: 0.12, lean: -0.08 },
  HOLD,
);
const G_L_JERK = lp(
  { aR: limb(0.62, 0.18, 0.35), wx: -0.1, wy: -0.65, wz: 0.75, twist: -0.3, lean: 0.16 },
  HOLD,
);
/** Копьё исполина (1,0) и его отдых (1 + t). */
const LG_LANCE: readonly PKey<LP>[] = [
  [0, HOLD],
  [0.55, G_L_PULL],
  [0.76, lp({ aR: limb(1.62, 0.5, 1.8), wy: 0.55, wz: 0.8, twist: 0.18, lean: -0.1 }, G_L_PULL)],
  [0.86, G_L_JERK, eIn],
  [1.0, lp({ aR: limb(0.72, 0.2, 0.45), wy: -0.55, twist: -0.26, lean: 0.12 }, G_L_JERK)],
  [1.1, lp({ aR: limb(0.55, 0.15, 0.3), wy: -0.75, twist: -0.36, lean: 0.18 }, G_L_JERK), easeOut],
  [1.8, HOLD],
];
/** Щит (0,8) и отдых (0,8 + t): вага влево поперёк тела → рывок вправо. */
const G_S_SWING = lp(
  { aR: limb(1.15, -0.25, 1.35), wx: -0.85, wy: 0.15, wz: 0.5, twist: -0.35 },
  HOLD,
);
const G_S_JERK = lp(
  { aR: limb(0.95, 0.95, 0.55), wx: 0.95, wy: -0.25, wz: 0.35, twist: 0.32, lean: 0.06 },
  HOLD,
);
const LG_SHIELD: readonly PKey<LP>[] = [
  [0, HOLD],
  [0.45, G_S_SWING],
  [0.6, lp({ aR: limb(1.2, -0.3, 1.45), wx: -0.9, wy: 0.2, twist: -0.38 }, G_S_SWING)],
  [0.68, G_S_JERK, eIn],
  [0.8, lp({ aR: limb(0.9, 0.85, 0.6), wx: 0.85, twist: 0.25 }, G_S_JERK)],
  [0.9, lp({ aR: limb(0.85, 1.0, 0.5), wx: 1.0, twist: 0.36 }, G_S_JERK), easeOut],
  [1.4, HOLD],
];
/** Таран: прицел (0–1) → бег (1–1,8) → рывок на себя на остановке (1,8 + t). */
const LG_CHARGE: readonly PKey<LP>[] = [
  [0, HOLD],
  [0.45, lp({ lean: 0.18, aR: limb(1.35, 0.3, 0.95), wx: 0, wy: -0.1, wz: 1, hp: 0 }, HOLD)],
  [0.9, lp({ lean: 0.22, aR: limb(1.45, 0.32, 1.05), wx: 0, wy: 0.05, wz: 1, hp: -0.05 }, HOLD)],
  [
    0.97,
    lp({ lean: 0.3, aR: limb(0.95, 0.2, 0.25), wx: 0, wy: -0.35, wz: 1, twist: -0.22 }, HOLD),
    eIn,
  ],
  [1.8, lp({ lean: 0.26, aR: limb(1.05, 0.22, 0.3), wx: 0, wy: -0.3, wz: 1, twist: -0.18 }, HOLD)],
  [
    1.92,
    lp({ lean: -0.22, aR: limb(1.9, 0.45, 1.95), wy: 0.6, wz: 0.6, twist: 0.3 }, HOLD),
    easeOut,
  ],
  [2.6, HOLD],
];
/** Сборка исполина: рывок на каждую часть (0; 0,5; 1,0; 1,6). */
const PULL_R = lp({ aR: limb(1.9, 0.45, 1.7), wy: 0.7, wz: 0.6, lean: -0.1, twist: 0.12 }, HOLD);
const PULL_L = lp({ aL: limb(2.6, 0.5, 0.6), fL: 1, lean: -0.08, twist: -0.1, hy: -0.2 }, HOLD);
const PULL_B = lp(
  { aR: limb(2.0, 0.45, 1.6), aL: limb(2.5, 0.55, 0.5), wy: 0.7, wz: 0.6, lean: -0.15, fL: 1 },
  HOLD,
);
const LG_REBUILD: readonly PKey<LP>[] = [
  [0, HOLD],
  [0.08, PULL_R, easeOut],
  [0.45, HOLD],
  [0.58, PULL_L, easeOut],
  [0.95, HOLD],
  [1.08, PULL_R, easeOut],
  [1.5, HOLD],
  [1.68, PULL_B, easeOut],
  [2.25, HOLD],
];
/** Исполин встаёт: вага тянет вверх. */
const LG_STAND: readonly PKey<LP>[] = [
  [0, lp({ aR: limb(0.6, 0.25, 0.6), wy: -0.5 }, HOLD)],
  [0.9, lp({ aR: limb(1.75, 0.4, 1.6), wy: 0.55, wz: 0.7, lean: -0.08 }, HOLD)],
  [1.2, HOLD, easeOut],
];
/** Исполин рухнул: вага упала, нити ослабли. */
const LG_SLUMP: readonly PKey<LP>[] = [
  [0, HOLD],
  [0.15, lp({ aR: limb(0.45, 0.2, 0.3), wy: -0.85, wz: 0.5, lean: 0.12, hp: 0.3 }, HOLD), easeOut],
];

/** Акт IV: удар по дуге (cut1, контакт 0,7) → выпад (cut2, контакт 1,3) → отдых. */
const AT_WIND = lp(
  {
    twist: 0.75,
    lean: -0.12,
    sink: 1.2,
    hp: -0.1,
    hy: -0.2,
    aR: limb(2.75, 0.85, 1.55),
    aL: limb(1.1, 0.8, 0.9),
    lL: limb(0.45, 0.12, 0.35),
    lR: limb(-0.3, 0.14, 0.3),
    wx: 0.35,
    wy: -0.25,
    wz: -0.9,
    wg: 1,
    tb: 0.18,
  },
  GUARD,
);
const AT_CUT = lp(
  {
    twist: -0.65,
    lean: 0.3,
    sink: 3,
    hp: 0.05,
    hy: 0.1,
    aR: limb(1.15, -0.55, 0.12),
    aL: limb(0.4, 0.9, 0.3),
    lL: limb(0.7, 0.12, 0.7),
    lR: limb(-0.55, 0.14, 0.15),
    wx: -0.75,
    wy: -0.35,
    wz: 0.75,
    wg: 1,
    tb: 0.35,
    fw: 3,
  },
  GUARD,
);
const AT_DRAW = lp(
  {
    twist: 0.45,
    lean: -0.12,
    sink: 2,
    hp: -0.05,
    aR: limb(1.25, 0.35, 1.95),
    aL: limb(2.2, 0.75, 1.1),
    lL: limb(0.45, 0.1, 0.4),
    lR: limb(-0.45, 0.14, 0.3),
    wx: 0,
    wy: 0.05,
    wz: 1,
    wg: 1,
    fw: 0,
  },
  GUARD,
);
const AT_LUNGE = lp(
  {
    twist: -0.35,
    lean: 0.5,
    sink: 4.5,
    hp: -0.1,
    aR: limb(1.6, 0.05, 0),
    aL: limb(-0.5, 0.55, 0.1),
    lL: limb(1.0, 0.1, 0.95),
    lR: limb(-0.95, 0.14, 0.05),
    wx: 0,
    wy: 0.02,
    wz: 1,
    wg: 1,
    fw: 7,
    tb: 0.5,
  },
  GUARD,
);
const ATK: readonly PKey<LP>[] = [
  [0, GUARD],
  [0.42, AT_WIND],
  [0.58, lp({ twist: 0.82, aR: limb(2.85, 0.9, 1.6) }, AT_WIND), easeOut],
  [0.7, AT_CUT, eIn],
  [
    0.8,
    lp(
      {
        twist: -0.78,
        lean: 0.34,
        sink: 3.2,
        aR: limb(0.85, -0.8, 0.1),
        wx: -1,
        wy: -0.55,
        wz: 0.3,
        fw: 3.5,
      },
      AT_CUT,
    ),
    easeOut,
  ],
  [1.05, AT_DRAW],
  [1.2, lp({ twist: 0.5, sink: 2.3, aR: limb(1.2, 0.38, 2.05) }, AT_DRAW), easeOut],
  [1.3, AT_LUNGE, eIn],
  [1.42, lp({ lean: 0.55, fw: 8, aR: limb(1.62, 0.05, 0) }, AT_LUNGE), easeOut],
  [1.85, lp({ fw: 0 }, GUARD)],
  [2.0, STAND],
];

/** Аркан: петля над головой (0,15–0,65) → взвод → бросок в 0,8. */
const SN_UP = lp(
  {
    aR: limb(2.85, 0.35, 0.45),
    wx: 0,
    wy: 1,
    wz: 0.1,
    wg: 1,
    lo: 1,
    hp: -0.25,
    lean: -0.05,
    twist: 0.1,
    aL: limb(0.6, 0.6, 0.8),
  },
  GUARD,
);
const SN_THROW = lp(
  {
    aR: limb(1.5, 0.1, 0.05),
    wx: 0,
    wy: 0.1,
    wz: 1,
    wg: 1,
    lo: 1,
    lt: 0.35,
    twist: -0.4,
    lean: 0.3,
    sink: 2.5,
    lL: limb(0.7, 0.1, 0.6),
    lR: limb(-0.6, 0.14, 0.1),
    aL: limb(0.3, 0.7, 0.3),
  },
  GUARD,
);
const SNARE: readonly PKey<LP>[] = [
  [0, GUARD],
  [0.15, SN_UP],
  [0.62, lp({ aR: limb(2.8, 0.45, 0.5) }, SN_UP)],
  [0.68, lp({ aR: limb(2.35, 0.65, 1.35), wy: 0.6, wz: -0.7, twist: 0.45, lean: -0.12 }, SN_UP)],
  [0.8, SN_THROW, eIn],
];
/** Попал: рывок на себя. Время — от начала аркана (0,8 + t). */
const SN_YANK: readonly PKey<LP>[] = [
  [0.8, lp({ lo: 0 }, SN_THROW)],
  [0.88, lp({ lo: 0, lean: 0.32 }, SN_THROW)],
  [
    1.08,
    lp(
      {
        lean: -0.35,
        aR: limb(0.95, 0.3, 1.9),
        aL: limb(1.15, -0.15, 1.5),
        twist: 0.3,
        sink: 2.2,
        lL: limb(0.3, 0.1, 0.3),
        lR: limb(-0.5, 0.14, 0.35),
        wy: 0.3,
        wz: 0.9,
        fw: -3,
        hp: -0.15,
        lo: 0,
      },
      GUARD,
    ),
    easeOut,
  ],
  [1.5, STAND],
];
/** Мимо: петля долетает и падает, он качает головой. */
const SN_MISS: readonly PKey<LP>[] = [
  [0.8, SN_THROW],
  [1.0, lp({ lt: 1, aR: limb(1.2, 0.15, 0.1), lean: 0.2 }, SN_THROW), easeOut],
  [1.2, lp({ lo: 1, lt: 1.6, hy: 0.35, wg: 1 }, STAND)],
  [1.32, lp({ lo: 1, lt: 1.8, hy: -0.35 }, STAND)],
  [1.5, lp({ lo: 0 }, STAND)],
];
/** Угол раскрутки петли: разгоняется. */
const snareSpin = (T: number) => {
  const u = clamp01((T - 0.15) / 0.5);
  return TAU * (1.5 * u + 1.6 * u * u);
};

/** Сетка: руки вверх (0,45), пальцы растягивают нити до каста (1,2) → разводит. */
const UP2 = lp(
  {
    aR: limb(2.9, 0.25, 0.35),
    aL: limb(2.9, 0.25, 0.35),
    bob: 2.2,
    toe: 0.55,
    hp: -0.35,
    fR: 1,
    fL: 1,
    wx: 0,
    wy: 1,
    wz: 0.15,
    wg: 0.5,
    lean: -0.08,
  },
  STAND,
);
const GRID_OPEN = lp(
  {
    aR: limb(1.65, 1.55, 0.05),
    aL: limb(1.65, 1.55, 0.05),
    bob: 0.5,
    sink: 1.5,
    hp: -0.2,
    lean: 0.05,
    wx: 1,
    wy: 0.1,
    wz: 0.2,
    wg: 0.5,
    fR: 1,
    fL: 1,
  },
  STAND,
);
const GRID: readonly PKey<LP>[] = [
  [0, GUARD],
  [0.45, UP2],
  [1.1, lp({ aR: limb(2.6, 0.95, 0.3), aL: limb(2.6, 0.95, 0.3), web: 1, wx: 0.6, wy: 0.8 }, UP2)],
  [1.2, lp({ aR: limb(2.55, 1.0, 0.3), aL: limb(2.55, 1.0, 0.3), web: 1, wx: 0.6, wy: 0.8 }, UP2)],
  [1.27, GRID_OPEN, easeOut],
  [2.0, lp({ aR: limb(1.6, 1.45, 0.15), aL: limb(1.6, 1.45, 0.15) }, GRID_OPEN)],
  [
    2.4,
    lp(
      { aR: limb(0.9, 0.7, 0.3), aL: limb(0.9, 0.7, 0.3), sink: 2, lean: 0.2, fR: 0, fL: 0 },
      STAND,
    ),
  ],
];
/** Выдохся: оседает на колено, вага вниз. */
const KNEEL = lp(
  {
    sink: 5.5,
    lean: 0.55,
    hp: 0.55,
    hr: 0.15,
    side: 0.05,
    aR: limb(0.35, 0.3, 0.3),
    aL: limb(0.3, 0.35, 0.25),
    lL: limb(1.45, 0.1, 1.7),
    lR: limb(-0.25, 0.14, 1.9),
    toe: 0.4,
    wx: 0.1,
    wy: -0.9,
    wz: 0.4,
    wg: 0.8,
    tb: 0.05,
  },
  STAND,
);
const SPENT_IN: readonly PKey<LP>[] = [
  [0, GRID[GRID.length - 1][1]],
  [0.3, lp({ sink: 6.2, lean: 0.62 }, KNEEL), eIn],
  [0.4, KNEEL, easeOut],
];
const SPENT_UP: readonly PKey<LP>[] = [
  [0, KNEEL],
  [0.25, lp({ sink: 2.5, lean: 0.25, hp: 0.1 }, GUARD)],
  [0.4, GUARD],
];

// Добавки (относительно LP0): приземление, подъём, спуск, отдача от удара.
const LAND: readonly PKey<LP>[] = [
  [
    0,
    lp({
      sink: 3,
      lean: 0.14,
      hp: 0.25,
      lL: dl(LP0.lL, 0.4, 0, 0.85),
      lR: dl(LP0.lR, 0.35, 0, 0.8),
      aL: dl(LP0.aL, 0.3, 0.3, 0),
      aR: dl(LP0.aR, 0.1, 0.1, 0),
      sq: 0.9,
      toe: -0.6,
    }),
  ],
  [
    0.1,
    lp({
      sink: 3.6,
      lean: 0.16,
      hp: 0.3,
      lL: dl(LP0.lL, 0.45, 0, 0.95),
      lR: dl(LP0.lR, 0.4, 0, 0.9),
      aL: dl(LP0.aL, 0.25, 0.35, 0),
      sq: 0.92,
      toe: -0.8,
    }),
    easeOut,
  ],
  [
    0.28,
    lp({
      sink: 0.6,
      sq: 1.03,
      toe: -0.8,
      lL: dl(LP0.lL, 0.1, 0, 0.2),
      lR: dl(LP0.lR, 0.1, 0, 0.2),
    }),
  ],
  [0.5, LP0],
];
const RISE: readonly PKey<LP>[] = [
  [
    0,
    lp({
      aL: dl(LP0.aL, 0.9, 0, -0.1),
      aR: dl(LP0.aR, 0.5, 0, 0),
      hp: -0.35,
      sq: 1.08,
      lL: dl(LP0.lL, 0, 0, -0.05),
      lR: dl(LP0.lR, 0, 0, -0.05),
    }),
  ],
  [
    0.1,
    lp({
      aL: dl(LP0.aL, 0.5, 0, -0.05),
      hp: -0.2,
      sq: 1.04,
      lL: dl(LP0.lL, 0.35, 0, 0.7),
      lR: dl(LP0.lR, 0.3, 0, 0.6),
    }),
    easeOut,
  ],
  [0.45, LP0],
];
const DROP = lp({
  toe: -0.45,
  lL: dl(LP0.lL, -0.05, 0, -0.2),
  lR: dl(LP0.lR, 0, 0, -0.25),
  aL: dl(LP0.aL, 0.35, 0.1, 0),
  aR: dl(LP0.aR, 0.15, 0, 0),
  hp: -0.1,
});
/** Отдача: герой спереди, сзади, слева, справа (в осях тела). */
const FLINCH: readonly LP[] = [
  lp({ lean: -0.32, hp: -0.3, aL: dl(LP0.aL, 0, 0.3, -0.1), aR: dl(LP0.aR, 0, 0.25, -0.1) }),
  lp({ lean: 0.28, hp: 0.3, aL: dl(LP0.aL, 0, 0.25, 0), aR: dl(LP0.aR, 0, 0.2, 0) }),
  lp({ side: 0.24, hr: 0.22, aL: dl(LP0.aL, 0, 0.3, 0) }),
  lp({ side: -0.24, hr: -0.22, aR: dl(LP0.aR, 0, 0.3, 0) }),
];

/** Смерть 5,2 с: нити лопаются по одной → куча → встаёт сам → поклон → занавес. */
export const LORD_DEATH = 5.2;
const DIE_HIT = lp(
  {
    lean: -0.38,
    hp: -0.4,
    sink: 1,
    aL: limb(0.75, 0.9, 0.3),
    aR: limb(0.8, 0.85, 0.35),
    lL: limb(0.3, 0.12, 0.25),
    lR: limb(-0.25, 0.14, 0.2),
    wx: 0.6,
    wy: 0.3,
    wz: 0.6,
    wg: 0.6,
  },
  GUARD,
);
const DIE_PUP = lp(
  {
    up: 9,
    toe: 0.95,
    hp: -0.15,
    aL: limb(2.3, 0.75, 0.5),
    aR: limb(2.3, 0.75, 0.5),
    fL: 1,
    fR: 1,
    lL: limb(0.1, 0.06, 0.3),
    lR: limb(-0.05, 0.07, 0.45),
    tb: 0.05,
  },
  STAND,
);
const DIE_HEAP = lp(
  {
    sink: 9.6,
    lean: 1.15,
    side: 0.3,
    hp: 0.9,
    hr: 0.5,
    aL: limb(0.5, 1.35, 0.15),
    aR: limb(0.85, 1.2, 0.5),
    lL: limb(1.7, 0.35, 2.6),
    lR: limb(1.35, 0.45, 2.4),
    toe: 0.2,
    tb: 0.5,
    tw: 0.3,
  },
  STAND,
);
const DIE_PICK = lp(
  {
    lean: 0.8,
    sink: 2.5,
    hp: 0.4,
    aL: limb(0.6, 0.45, 0.15),
    lL: limb(0.35, 0.12, 0.6),
    lR: limb(-0.2, 0.14, 0.5),
    hat: 1,
  },
  STAND,
);
const DIE_BOW = lp(
  {
    lean: 0.95,
    hp: 0.35,
    aR: limb(0.95, -0.45, 2.05),
    aL: limb(0.5, 1.05, 0.2),
    lR: limb(-0.35, 0.12, 0.3),
    lL: limb(0.15, 0.1, 0.25),
    sink: 1,
  },
  STAND,
);
const DIE: readonly PKey<LP>[] = [
  [0, DIE_HIT],
  [0.12, lp({ lean: -0.42 }, DIE_HIT)],
  [0.35, DIE_PUP, easeOut],
  [0.45, lp({ side: 0.05 }, DIE_PUP)],
  [0.55, lp({ side: 0.2, up: 8.6, aR: limb(0.15, 0.3, 0.1), fR: 0 }, DIE_PUP), eIn],
  [
    0.8,
    lp(
      { side: 0.04, up: 8.2, aR: limb(0.1, 0.25, 0.1), aL: limb(0.1, 0.25, 0.1), fR: 0, fL: 0 },
      DIE_PUP,
    ),
    eIn,
  ],
  [
    1.05,
    lp(
      {
        side: -0.28,
        hr: 0.6,
        hp: 0.55,
        up: 7.6,
        aR: limb(0.05, 0.2, 0.05),
        aL: limb(0.15, 0.3, 0.1),
        fR: 0,
        fL: 0,
        toe: 1.1,
      },
      DIE_PUP,
    ),
    eIn,
  ],
  [
    1.15,
    lp(
      {
        side: -0.32,
        hr: 0.62,
        hp: 0.6,
        up: 7.6,
        aR: limb(0.05, 0.2, 0.05),
        aL: limb(0.15, 0.3, 0.1),
        fR: 0,
        fL: 0,
        toe: 1.1,
      },
      DIE_PUP,
    ),
  ],
  [
    1.32,
    lp(
      {
        sink: 6,
        lean: 0.6,
        hp: 0.7,
        hr: 0.5,
        side: -0.1,
        lL: limb(1.0, 0.3, 1.8),
        lR: limb(0.8, 0.35, 1.6),
        aL: limb(0.4, 0.9, 0.2),
        aR: limb(0.5, 0.9, 0.3),
        toe: 0.4,
      },
      STAND,
    ),
    eIn,
  ],
  [1.5, DIE_HEAP, eBack],
  [2.3, DIE_HEAP],
  [2.38, lp({ aR: limb(0.95, 1.1, 1.1) }, DIE_HEAP), easeOut],
  [2.5, DIE_HEAP],
  [
    2.95,
    lp(
      {
        sink: 6.5,
        lean: 0.85,
        side: 0.1,
        hp: 0.3,
        hr: 0.1,
        aL: limb(0.95, 0.45, 0.15),
        aR: limb(0.95, 0.45, 0.15),
        lL: limb(1.6, 0.2, 2.5),
        lR: limb(1.2, 0.25, 2.3),
      },
      STAND,
    ),
  ],
  [
    3.3,
    lp(
      {
        sink: 4.5,
        lean: 0.25,
        hp: -0.1,
        lL: limb(1.45, 0.1, 1.7),
        lR: limb(-0.25, 0.14, 1.9),
        aL: limb(0.6, 0.6, 0.3),
        aR: limb(0.6, 0.6, 0.3),
      },
      STAND,
    ),
  ],
  [
    3.6,
    lp(
      {
        side: 0.12,
        aL: limb(0.6, 0.95, 0.3),
        aR: limb(0.6, 0.95, 0.3),
        lL: limb(0.05, 0.18, 0.05),
        lR: limb(-0.05, 0.2, 0.05),
      },
      STAND,
    ),
    eBack,
  ],
  [3.72, lp({ side: -0.08, aL: limb(0.5, 0.8, 0.3), aR: limb(0.5, 0.8, 0.3) }, STAND)],
  [3.95, DIE_PICK],
  [4.05, DIE_PICK],
  [4.3, lp({ aL: DOFF, hat: 1 }, STAND)],
  [4.4, lp({ aL: DOFF, hat: 0 }, STAND)],
  [4.75, DIE_BOW],
  [5.2, DIE_BOW],
];
/** Обрыв нитей: поля шляпы слева, справа, запястья слева, справа. */
const SNAP_T = [0.95, 1.15, 0.7, 0.45] as const;

// ---- рисунок ---------------------------------------------------------------------

const VH = 4.6; // полдлины планки ваги
const VC = 3.1; // полдлины поперечины
interface VagaG {
  c: V3;
  tip: V3;
  tail: V3;
  u: V3;
}
function vagaOf(j: Joints, L: LP): VagaG {
  let A: V3;
  let c: V3;
  if (L.wh >= 0.5) {
    A = vnorm(vadd(vadd(vsc(j.right, L.wx), vsc(j.up, L.wy)), vsc(j.fwd, L.wz)));
    c = vadd(j.haR, vsc(A, L.wg * VH * 0.85));
  } else {
    A = vnorm(v3(L.wx, L.wy, L.wz));
    c = v3(L.vX, L.vY, L.vZ);
  }
  const u0 = vcross(A, v3(0, 1, 0));
  const u = vlen(u0) < 0.25 ? j.right : vnorm(u0);
  return { c, tip: vadd(c, vsc(A, VH)), tail: vadd(c, vsc(A, -VH)), u };
}

const HAT_BR = 4.6;
const HAT_CR = 3.0;
const HAT_H = 6.4;
function hatOf(j: Joints, L: LP): { b: V3; up: V3 } {
  if (L.hat >= 1.5)
    return {
      b: v3(L.hX, L.hY, L.hZ),
      up: vnorm(v3(Math.sin(L.hT), Math.cos(L.hT), 0.25 * Math.sin(L.hT))),
    };
  const b0 = onHead(j, LORD_BODY.head, -0.06, 0, 0.6);
  const k = clamp01(L.hat);
  if (k === 0) return { b: b0, up: j.hUp };
  const b1 = vadd(j.haL, vadd(vsc(j.foreL, 1.3), vsc(j.up, 0.4)));
  const u1 = vnorm(vadd(vsc(j.fwd, 0.75), vsc(j.up, 0.65)));
  return { b: vmix(b0, b1, k), up: vnorm(vmix(j.hUp, u1, k)) };
}

interface LRig {
  rig: Rig;
  j: Joints;
  vg: VagaG;
  hat: { b: V3; up: V3 };
}
function lordRig(L: LP, open: boolean): LRig {
  const rig = new Rig();
  const B = LORD_BODY;
  // Перед торса — та же цепочка поворотов, что у `humanoid`.
  const tf = (v: V3) => rotZ(rotX(rotY(v, L.twist), L.lean), L.side);
  DRESS.fwd = tf(v3(0, 0, 1));
  DRESS.right = tf(v3(1, 0, 0));
  const j = humanoid(rig, B, { ...L, toe: Math.max(0, L.toe) }, { head: true, arms: true });
  // Белые гетры.
  for (const [an, kn] of [
    [j.anL, j.knL],
    [j.anR, j.knR],
  ]) {
    const d = vnorm(vsub(kn, an));
    rig.cap(vadd(an, vsc(d, 0.2)), vadd(an, vsc(d, 1.5)), 1.34, 1.3, SHIRT, undefined, 0.15);
  }
  // Руки: рукав фрака, манжета, перчатка; пальцы веером.
  const arm = (sh: V3, el: V3, ha: V3, fore: V3, fan: number) => {
    rig.ball(sh, 1.45, COAT);
    rig.cap(sh, el, 1.22, 1.1, COAT);
    rig.cap(el, vadd(ha, vsc(fore, -1.0)), 1.1, 1.02, COAT);
    rig.cap(
      vadd(ha, vsc(fore, -1.5)),
      vadd(ha, vsc(fore, -0.75)),
      1.12,
      1.12,
      SHIRT,
      undefined,
      0.2,
    );
    rig.ball(ha, B.hand, SHIRT, undefined, 0.5);
    if (fan > 0.05) {
      const s0 = vcross(fore, v3(0, 1, 0));
      const s = vlen(s0) < 0.2 ? j.right : vnorm(s0);
      for (let k = 0; k < 4; k++) {
        const o = (k - 1.5) * 0.62 * fan;
        const along = 1.0 + 0.5 * fan * (1 - Math.abs(k - 1.5) / 3);
        rig.ball(vadd(vadd(ha, vsc(fore, along)), vsc(s, o)), 0.42, SHIRT, undefined, 0.5);
      }
    }
  };
  arm(j.shL, j.elL, j.haL, j.foreL, L.fL);
  arm(j.shR, j.elR, j.haR, j.foreR, L.fR);
  // Воротник, бабочка, маска с нарисованным лицом.
  rig.cap(j.chest, vadd(j.neck, vsc(j.up, 0.3)), 1.3, 1.15, SHIRT, undefined, 0.2);
  const bt = vadd(vadd(j.neck, vsc(j.fwd, 1.05)), vsc(j.up, -0.5));
  rig.ball(vadd(bt, vsc(j.right, -0.6)), 0.6, P.velvet);
  rig.ball(vadd(bt, vsc(j.right, 0.6)), 0.6, P.velvet);
  const R = B.head;
  rig.ball(j.head, R, P.porcelain, undefined, 0.45);
  for (const s of [-1, 1]) {
    rig.dot(onHead(j, R, 0.93, 0.36 * s, 0.16), INK, 1);
    rig.dot(onHead(j, R, 0.84, 0.44 * s, 0.44), INK, 1);
    rig.dot(onHead(j, R, 0.8, 0.58 * s, -0.14), ROUGE, 1);
  }
  for (const [r, u] of [
    [-0.42, -0.3],
    [-0.22, -0.44],
    [0, -0.48],
    [0.22, -0.44],
    [0.42, -0.3],
  ])
    rig.dot(onHead(j, R, 0.9, r, u), LIP, 1);
  // Цилиндр: поля, тулья, бархатная лента и золотой кант.
  const hat = hatOf(j, L);
  rig.cyl(
    vadd(hat.b, vsc(hat.up, -0.2)),
    vadd(hat.b, vsc(hat.up, 0.3)),
    HAT_BR,
    HAT,
    undefined,
    false,
    0.5,
  );
  rig.cyl(
    vadd(hat.b, vsc(hat.up, 0.3)),
    vadd(hat.b, vsc(hat.up, HAT_H)),
    HAT_CR,
    HAT,
    (t) => (t > 0.04 && t < 0.26 ? P.velvet : t >= 0.26 && t < 0.31 ? P.gold : null),
    false,
    0.5,
  );
  // Фалды: два лоскута от спины пояса, висят по отвесу, отстают.
  const pF = rotY(v3(0, 0, 1), L.twist * 0.3);
  const pR = rotY(v3(1, 0, 0), L.twist * 0.3);
  const top = vadd(vadd(j.pelvis, vsc(j.up, B.torso * 0.3)), vsc(pF, -B.waist * 0.9));
  const fl = (p: V3): V3 => (p.y < 0.4 ? v3(p.x, 0.4, p.z) : p);
  for (const s of [-1, 1]) {
    const tb = L.tb + s * L.tw;
    const D = vnorm(
      vadd(vadd(v3(0, -Math.cos(tb), 0), vsc(pF, -Math.sin(tb))), vsc(pR, Math.sin(L.ts))),
    );
    const a = vadd(top, vsc(pR, s * 0.15));
    const b = vadd(vadd(top, vsc(pR, s * B.waist * 1.05)), vsc(pF, 0.9));
    rig.quad(
      a,
      b,
      fl(vadd(b, vadd(vsc(D, 8.6), vsc(pR, s * 0.3)))),
      fl(vadd(a, vsc(D, 10))),
      COAT,
      undefined,
      false,
      0,
    );
  }
  // Вага-крестовина: дерево и золото; горит, только когда окно открыто.
  const vg = vagaOf(j, L);
  const vt = open ? P.gold : P.wood;
  const vgl: Glow = open ? 0.9 : false;
  const c0 = vadd(vg.c, vsc(vg.u, -VC));
  const c1 = vadd(vg.c, vsc(vg.u, VC));
  rig.cap(vg.tail, vg.tip, 0.55, 0.48, vt, undefined, vgl);
  rig.cap(c0, c1, 0.5, 0.5, vt, undefined, vgl);
  for (const p of [vg.tip, vg.tail, c0, c1]) rig.ball(p, 0.8, P.gold, undefined, open);
  // Иглы веером в левой.
  if (L.nd > 0.05) {
    const s0 = vcross(j.foreL, v3(0, 1, 0));
    const s = vlen(s0) < 0.2 ? j.right : vnorm(s0);
    for (let k = -1; k <= 1; k++) {
      const d = vnorm(vadd(vadd(j.foreL, vsc(s, k * 0.4 * L.nd)), v3(0, 0.25, 0)));
      rig.cap(
        vadd(j.haL, vsc(d, 0.8)),
        vadd(j.haL, vsc(d, 0.8 + 4.4 * L.nd)),
        0.22,
        0.12,
        P.silver,
        undefined,
        0.45,
      );
    }
  }
  // Аркан: петля над вагой, летит вперёд, падает.
  if (L.lo > 0.5) {
    let c: V3;
    let r = 2.6;
    if (L.lt <= 0) c = vadd(vg.tip, v3(Math.cos(L.la) * 3, 1.6, Math.sin(L.la) * 3));
    else if (L.lt <= 1) {
      c = vadd(vg.tip, v3(0, 1.6 - L.lt * 2.4, 2 + L.lt * 16));
      r += L.lt * 1.2;
    } else {
      const tp = vadd(vg.tip, v3(0, 0, 18));
      c = v3(tp.x, 0.4, tp.z);
      r = 3.8;
    }
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * TAU;
      rig.dot(
        vadd(c, v3(Math.cos(a) * r, Math.sin(a + L.la) * 0.5, Math.sin(a) * r)),
        THREAD,
        1,
        0.6,
      );
    }
    const n = Math.max(4, Math.ceil(vlen(vsub(c, vg.tip)) / 0.8));
    for (let i = 1; i < n; i++) {
      const p = vmix(vg.tip, c, i / n);
      p.y -= Math.sin((i / n) * Math.PI) * (L.lt > 0 ? 1.5 : 0.5);
      rig.dot(p, THREAD, 1, 0.6);
    }
  }
  // Нити между пальцами (сетка).
  if (L.web > 0.3) {
    // «Колыбель для кошки»: две пары нитей крест-накрест и одна прямая,
    // с провисом к середине; редкие точки, чтобы между нитями был просвет.
    const ends: [number, number][] = [
      [1.4, -1.4],
      [-1.4, 1.4],
      [0.6, 0.6],
      [-0.9, -0.9],
    ];
    for (const [ya, yb] of ends) {
      const a = vadd(j.haL, v3(0, ya, 0));
      const b = vadd(j.haR, v3(0, yb, 0));
      const n = Math.ceil(vlen(vsub(b, a)) / 0.7);
      for (let i = 1; i < n; i++) {
        const p = vmix(a, b, i / n);
        p.y -= Math.sin((i / n) * Math.PI) * 0.7 * L.web;
        rig.dot(p, THREAD, 0.7, 0.5);
      }
    }
  }
  return { rig, j, vg, hat };
}

/** Нить, на которой висит: вверх от точки, с провисом; оборвалась — верх уходит. */
function lordThread(
  lit: Px,
  x: number,
  y: number,
  str: number,
  sag: number,
  i: number,
  age: number,
): void {
  const len = 64;
  const sgn = i % 2 ? 1 : -1;
  if (age < 0) {
    for (let s = 1; s < len; s++) {
      const yy = y - s;
      if (yy < 0) break;
      const xx = x + sag * Math.sin(Math.PI * Math.min(1, s / 28)) * sgn;
      lit.set(xx, yy, withA(THREAD, str * 0.8 * (1 - s / len) ** 0.7));
    }
    return;
  }
  const gap = 6 + age * 140;
  const a = str * 0.8 * clamp01(1 - age / 0.6);
  if (a > 0.02)
    for (let s = gap; s < len + gap; s++) {
      const yy = y - s;
      if (yy < 0) break;
      lit.set(x + Math.sin(s * 0.4 + age * 30) * 0.8, yy, withA(THREAD, a * (1 - (s - gap) / len)));
    }
  const sw = Math.sin(age * 14) * 2.5 * clamp01(1 - age / 1.2);
  const la = str * 0.75 * clamp01(1 - age / 1.6);
  if (la > 0.02)
    for (let s = 0; s < 7; s++) lit.set(x + sw * (s / 7), y - 1 + s, withA(THREAD, la));
}

interface LSmear {
  at: (t: number) => LP;
  t: number;
  w0: number;
  w1: number;
  part: 'vaga' | 'handL';
}
interface LordDraw {
  L: LP;
  dir: number;
  flash: boolean;
  open: boolean;
  ghost: boolean;
  str: number;
  sag: number;
  snap: readonly number[] | null;
  smear: LSmear | null;
}
interface LordCached {
  fr: MobFrame;
  /** Центр ваги в кадре (после обрезки). */
  vx: number;
  vy: number;
}

function lordRender(d: LordDraw): LordCached {
  const { L } = d;
  const { j, rig, vg, hat } = lordRig(L, d.open);
  const yaw = (d.dir / 16) * TAU;
  const o = renderRig(rig, yaw, LW, LH, LAX, LAY, {
    scale: LS,
    flash: d.flash,
    tint: d.ghost ? GHOST_T : undefined,
    tintK: d.ghost ? 0.1 : 0,
  });
  const proj = rigProj(yaw, LS, LAX, LAY);
  let lit = rimLight(o, o.lit, d.ghost ? RIM_G : RIM);
  // Свои нити: к полям шляпы (или к вискам) и к запястьям.
  if (d.str > 0.02) {
    const out = lit ?? new Px(LW, LH);
    lit = out;
    const R = LORD_BODY.head;
    const onH = L.hat < 0.5;
    const pts: V3[] = [
      onH ? vadd(hat.b, vsc(j.hRight, -HAT_BR * 0.8)) : onHead(j, R, 0, -0.95, 0.3),
      onH ? vadd(hat.b, vsc(j.hRight, HAT_BR * 0.8)) : onHead(j, R, 0, 0.95, 0.3),
      vadd(j.haL, v3(0, 0.8, 0)),
      vadd(j.haR, v3(0, 0.8, 0)),
    ];
    pts.forEach((p, i) => {
      const [x, y] = proj(p);
      lordThread(out, x, y, d.str, d.sag, i, d.snap ? d.snap[i] : -1);
    });
  }
  // След взмаха.
  const sm = d.smear;
  if (sm) {
    const segs: [number, number, number, number][] = [];
    for (let k = 0; k < 7; k++) {
      const ts = sm.t - k / 72;
      if (ts < sm.w0 - 1e-6) break;
      if (ts > sm.w1 + 1e-6) continue;
      const Lk = k === 0 ? L : sm.at(ts);
      const jk = k === 0 ? j : humanoid(new Rig(), LORD_BODY, Lk, { head: true, arms: true });
      let p0: V3;
      let p1: V3;
      if (sm.part === 'vaga') {
        const v = k === 0 ? vg : vagaOf(jk, Lk);
        p0 = vmix(v.tail, v.tip, 0.35);
        p1 = v.tip;
      } else {
        p0 = jk.elL;
        p1 = vadd(jk.haL, vsc(jk.foreL, 1.2 + 4 * Lk.nd));
      }
      const [ax, ay] = proj(p0);
      const [bx, by] = proj(p1);
      segs.push([ax, ay, bx, by]);
    }
    if (segs.length >= 2) {
      lit ??= new Px(LW, LH);
      smearInto(lit, segs, d.flash ? WHITE : SMEAR_C);
    }
  }
  const [cx, cy] = proj(vg.c);
  if (d.open) {
    lit ??= new Px(LW, LH);
    halo(lit, cx, cy, 8, P.gold[3], 0.3);
  }
  const { fr, x0, y0 } = cropFrame(o.px, lit, LAX, LAY, {}, o.box);
  return { fr, vx: cx - x0, vy: cy - y0 };
}

// ---- состояние и выбор кадра ----------------------------------------------------

const HANG_MODES = new Set(['roar', 'f13_hang', 'f13_needle', 'f13_trans']);
const ACT4 = new Set([
  'chase',
  'f13_cut1',
  'f13_cut2',
  'f13_snare',
  'f13_grid',
  'f13_spent',
  'recover',
]);

const liftOf = (m: Mob) =>
  m.mode === 'dying' ? 0 : clamp01(m.data.lift ?? (HANG_MODES.has(m.mode) ? 1 : 0));

export function lordLiftPx(m: Mob): number {
  return liftOf(m) * LIFT_PX;
}

interface LState {
  now: number;
  mode: string;
  prev: string;
  yaw: number;
  /** Маятник (рад) и его скорость. */
  th: number;
  thv: number;
  /** Отставание ног и фалд: вперёд-назад и вбок. */
  lg: number;
  lgv: number;
  ls: number;
  lsv: number;
  lift: number;
  liftV: number;
  landAt: number;
  riseAt: number;
  fl: boolean;
  hitAt: number;
  hb: number;
  hdx: number;
  hdy: number;
  odo: number;
  needleAt: number;
  last: LP | null;
  lastKey: string;
  bFrom: LP | null;
  bKey: string;
  bAt: number;
  vaga: [number, number] | null;
}
const LST = new Map<number, LState>();

function lordTick(m: Mob, now: number, flash: boolean): LState {
  const lift = liftOf(m);
  let st = LST.get(m.id);
  if (!st || now < st.now - 1e-4 || now - st.now > 1) {
    if (LST.size > 8) LST.clear();
    st = {
      now,
      mode: m.mode,
      prev: '',
      yaw: m.face,
      th: 0,
      thv: 0,
      lg: 0,
      lgv: 0,
      ls: 0,
      lsv: 0,
      lift,
      liftV: 0,
      landAt: -9,
      riseAt: -9,
      fl: flash,
      hitAt: -9,
      hb: 0,
      hdx: 0,
      hdy: 0,
      odo: 0,
      needleAt: -9,
      last: null,
      lastKey: '',
      bFrom: null,
      bKey: '',
      bAt: -9,
      vaga: null,
    };
    LST.set(m.id, st);
  }
  const dt = Math.min(0.1, Math.max(0, now - st.now));
  st.now = now;
  if (m.mode !== st.mode) {
    if (st.mode === 'f13_needle' && m.mode === 'f13_hang') st.needleAt = now;
    if (st.last && st.lastKey.length < 140 && m.mode !== 'dying') {
      st.bFrom = st.last;
      st.bKey = st.lastKey;
      st.bAt = now;
    }
    st.prev = st.mode;
    st.mode = m.mode;
  }
  const dying = m.mode === 'dying';
  const hang = lift > 0.02;
  if (dt > 0) {
    if (!dying) {
      if (HANG_MODES.has(m.mode)) st.yaw += clampN(angD(m.face, st.yaw), -9 * dt, 9 * dt);
      else if (m.mode === 'chase' || m.mode === 'recover' || m.mode === 'idle') {
        // Ходит лицом по ходу, стоит — к цели; поворот плавный.
        const sp = Math.hypot(m.vx, m.vy);
        const to = m.mode === 'chase' && sp > 0.3 ? Math.atan2(m.vy, m.vx) : m.face;
        st.yaw += clampN(angD(to, st.yaw), -14 * dt, 14 * dt);
      } else st.yaw = m.face;
    }
    // Маятник: вершина идёт за вагой, низ отстаёт; на остановке — перелёт.
    const thT = hang && !dying ? clampN(m.vx * 0.075, -0.3, 0.3) : 0;
    [st.th, st.thv] = spring(st.th, st.thv, thT, hang ? 5.2 : 10, hang ? 0.2 : 0.9, dt);
    const c = Math.cos(st.yaw);
    const s = Math.sin(st.yaw);
    const vf = m.vx * c + m.vy * s;
    const vs = -m.vx * s + m.vy * c;
    [st.lg, st.lgv] = spring(
      st.lg,
      st.lgv,
      hang ? clampN(-vf * 0.11, -0.45, 0.45) : 0,
      4.4,
      0.2,
      dt,
    );
    [st.ls, st.lsv] = spring(st.ls, st.lsv, hang ? clampN(-vs * 0.07, -0.3, 0.3) : 0, 4.4, 0.2, dt);
    st.liftV += ((lift - st.lift) / dt - st.liftV) * Math.min(1, dt * 20);
    st.odo += Math.hypot(m.vx, m.vy) * dt;
  }
  if (st.lift > 0.02 && lift <= 0.02) st.landAt = now;
  if (st.lift <= 0.02 && lift > 0.02) st.riseAt = now;
  st.lift = lift;
  // Удар героя: отдача от него, висящего ещё и качнёт.
  if (flash && !st.fl && !dying) {
    const h = paintSim()?.hero;
    let ax = h ? h.x - m.x : Math.cos(st.yaw);
    let ay = h ? h.y - m.y : Math.sin(st.yaw);
    const L = Math.hypot(ax, ay) || 1;
    ax /= L;
    ay /= L;
    st.hitAt = now;
    st.hdx = -ax;
    st.hdy = -ay;
    const c = Math.cos(st.yaw);
    const s = Math.sin(st.yaw);
    const f = ax * c + ay * s;
    const sd = -ax * s + ay * c;
    st.hb = Math.abs(f) >= Math.abs(sd) ? (f > 0 ? 0 : 1) : sd > 0 ? 3 : 2;
    if (hang) st.thv += ax * 1.8;
  }
  st.fl = flash;
  return st;
}

/** Что делает исполин (акт I) — для жеста ваги. В листе — `m.data.vG`. */
const GCODE: Record<string, number> = {
  f13_lance: 1,
  f13_shield: 2,
  f13_charge_aim: 3,
  f13_charge: 4,
  f13_slump: 6,
  f13_rebuild: 7,
  chase: 8,
  f13_stand: 9,
};
function giantCue(m: Mob, now: number): { code: number; t: number; ph: number } | null {
  const v = m.data.vG ?? 0;
  if (v > 0) return { code: v, t: m.t, ph: (now * 0.8) % 1 };
  if (!paintSim()) return null;
  const g = F13_FX.mobs.find((q) => q.kind === 'f13_giant' && q.mode !== 'dying');
  if (!g) return null;
  const gs = GST.get(g.id);
  let code = GCODE[g.mode] ?? 0;
  if (g.mode === 'recover')
    code = gs?.prev === 'f13_charge' ? 10 : gs?.prev === 'f13_shield' ? 11 : 5;
  return code ? { code, t: g.t, ph: gs ? (gs.odo / G_STRIDE) % 1 : 0 } : null;
}

function gesture(c: { code: number; t: number; ph: number }): { L: LP; key: string } | null {
  if (c.code === 8) {
    // Исполин шагает: вага покачивается в такт его шагу.
    const f = Math.floor(c.ph * 8) % 8;
    const s = Math.sin((f / 8) * TAU * 2);
    return {
      L: lp(
        {
          aR: limb(HOLD.aR.sw + 0.12 * s, HOLD.aR.out, HOLD.aR.bend + 0.1 * s),
          wx: HOLD.wx + 0.25 * s,
          twist: HOLD.twist + 0.05 * s,
        },
        HOLD,
      ),
      key: `gc${f}`,
    };
  }
  const tab: Record<number, [readonly PKey<LP>[], number, number]> = {
    1: [LG_LANCE, 0, 1],
    5: [LG_LANCE, 1, 1],
    2: [LG_SHIELD, 0, 2],
    11: [LG_SHIELD, 0.8, 2],
    3: [LG_CHARGE, 0, 3],
    4: [LG_CHARGE, 1, 3],
    10: [LG_CHARGE, 1.8, 3],
    6: [LG_SLUMP, 0, 6],
    7: [LG_REBUILD, 0, 7],
    9: [LG_STAND, 0, 9],
  };
  const e = tab[c.code];
  if (!e) return null;
  const n = F24(e[1] + c.t, trackEnd(e[0]));
  let L = track(n / 24, e[0]);
  // Прицел тарана: рука дрожит от натяжения.
  if (e[2] === 3 && n / 24 > 0.45 && n / 24 < 0.9 && n % 2)
    L = lp({ aR: limb(L.aR.sw + 0.07, L.aR.out, L.aR.bend) }, L);
  return { L, key: `g${e[2]}.${n}` };
}

interface LSpec {
  key: string;
  L: LP;
  str: number;
  sag: number;
  snap: readonly number[] | null;
  smear: LSmear | null;
  /** Доля маятника (висит — 1). */
  hang: number;
  liftPx: number;
  alpha: number;
  trail: boolean;
  blend: boolean;
}

function hangSpec(m: Mob, now: number, st: LState, o: LSpec): void {
  const t = m.t;
  const lift = st.lift;
  o.str = 1;
  o.hang = 1;
  o.blend = false;
  if (m.mode === 'roar') {
    const n = F24(t, trackEnd(ROAR));
    const tq = n / 24;
    o.L = track(tq, ROAR);
    o.key = `roar${n}`;
    if (tq >= 1.55 && tq <= 1.92)
      o.smear = { at: (x) => track(x, ROAR), t: tq, w0: 1.55, w1: 1.85, part: 'vaga' };
    return;
  }
  if (m.mode === 'f13_trans') {
    const n = F24(t, trackEnd(TRANS));
    o.L = track(n / 24, TRANS);
    o.key = `tr${n}`;
    return;
  }
  const lg = quantS(st.lg, 0.08, 0.48);
  const ls = quantS(st.ls, 0.08, 0.32);
  if (lift <= 0.02) {
    const f = Math.floor(now * 8) % 16;
    o.L = lostPose(f);
    o.key = `fl${f}`;
    o.sag = 5;
  } else {
    // Пока исполин действует или летят иглы, цикл висения стоит (жест ведёт
    // руку сам, маятник и ноги живут на пружинах) — кадров в кеше меньше.
    const cue = giantCue(m, now);
    const still = !!cue || m.mode === 'f13_needle' || now - st.needleAt < 0.5;
    const f = still ? 0 : (((Math.floor(now * 10) + m.id * 3) % 16) + 16) % 16;
    o.L = hangPose(f, lg, ls);
    o.key = `hg${f}.${Math.round(lg / 0.08)}.${Math.round(ls / 0.08)}`;
    // Спускают: нити провисают, ноги тянутся к полу.
    if (st.liftV < -0.4) {
      o.L = addP(o.L, DROP, LP0);
      o.key += 'd';
      o.sag = Math.round(1 + 3 * (1 - lift));
    }
    const g = cue ? gesture(cue) : null;
    if (g) {
      o.L = addP(o.L, g.L, HOLD);
      o.key += g.key;
    }
  }
  if (m.mode === 'f13_needle') {
    const n = F24(t, 0.45);
    const tq = n / 24;
    const base = o.L;
    o.L = addP(base, track(tq, NEEDLE), HOLD);
    o.key += `nd${n}`;
    if (tq >= 0.35)
      o.smear = {
        at: (x) => addP(base, track(x, NEEDLE), HOLD),
        t: tq,
        w0: 0.33,
        w1: 0.45,
        part: 'handL',
      };
  } else {
    const na = now - st.needleAt;
    if (na >= 0 && na < 0.5) {
      const n = F24(na);
      const base = o.L;
      o.L = addP(base, track(n / 24, NEEDLE_FT), HOLD);
      o.key += `nf${n}`;
      // Кадр выпуска (урон в 0,45) — со следом руки от замаха.
      if (n === 0)
        o.smear = {
          at: (x) => addP(base, track(x, NEEDLE), HOLD),
          t: 0.45,
          w0: 0.33,
          w1: 0.45,
          part: 'handL',
        };
    }
  }
  // Подъём с пола — рывком: руки вверх, тело тянет, ноги догоняют.
  const ra = now - st.riseAt;
  if (ra >= 0 && ra < 0.45 && lift > 0.02) {
    const n = F24(ra);
    o.L = addP(o.L, track(n / 24, RISE), LP0);
    o.key += `r${n}`;
  }
}

function walkSpec(m: Mob, now: number, st: LState, o: LSpec): void {
  const t = m.t;
  o.str = clamp01(st.lift * 3);
  o.hang = clamp01(st.lift * 4);
  const atk = (T: number) => {
    const n = F24(T, trackEnd(ATK));
    const tq = n / 24;
    o.L = track(tq, ATK);
    o.key = `at${n}`;
    if (tq >= 0.56 && tq <= 0.82)
      o.smear = { at: (x) => track(x, ATK), t: tq, w0: 0.56, w1: 0.76, part: 'vaga' };
    if (tq >= 1.18 && tq <= 1.38)
      o.smear = { at: (x) => track(x, ATK), t: tq, w0: 1.18, w1: 1.33, part: 'vaga' };
    o.trail = tq >= 1.18 && tq <= 1.45;
  };
  switch (m.mode) {
    case 'f13_cut1':
      return atk(t);
    case 'f13_cut2':
      return atk(0.7 + t);
    case 'f13_snare': {
      const n = F24(t, 0.8);
      const tq = n / 24;
      o.L = { ...track(tq, SNARE), la: snareSpin(tq) };
      o.key = `sn${n}`;
      if (tq >= 0.66)
        o.smear = {
          at: (x) => ({ ...track(x, SNARE), la: snareSpin(x) }),
          t: tq,
          w0: 0.66,
          w1: 0.8,
          part: 'vaga',
        };
      return;
    }
    case 'f13_grid': {
      const n = F24(t, trackEnd(GRID));
      const tq = n / 24;
      o.L = track(tq, GRID);
      if (tq > 0.45 && tq < 1.2 && n % 2)
        o.L = lp({ aR: dl(o.L.aR, 0, 0.05, 0), aL: dl(o.L.aL, 0, 0.05, 0) }, o.L);
      o.key = `gr${n}`;
      return;
    }
    case 'f13_spent': {
      if (t < 0.4) {
        const n = F24(t, 0.4);
        o.L = track(n / 24, SPENT_IN);
        o.key = `sp${n}`;
      } else if (t < 2.75) {
        const f = Math.floor(now * 8) % 12;
        const s = Math.sin((f / 12) * TAU);
        o.L = lp({ bob: 0.4 * s, hp: KNEEL.hp + 0.08 * s, lean: KNEEL.lean - 0.04 * s }, KNEEL);
        o.key = `sb${f}`;
      } else {
        const n = F24(t - 2.75, 0.4);
        o.L = track(n / 24, SPENT_UP);
        o.key = `su${n}`;
      }
      return;
    }
    case 'recover':
      if (st.prev === 'f13_cut2') return atk(1.3 + t);
      if (st.prev === 'f13_snare') {
        const yank = (m.data.vYank ?? 0) > 0;
        const n = F24(t, 0.7);
        const tq = 0.8 + n / 24;
        o.L = { ...track(tq, yank ? SN_YANK : SN_MISS), la: snareSpin(0.66) };
        o.key = `s${yank ? 'y' : 'm'}${n}`;
        return;
      }
      break;
  }
  if (Math.hypot(m.vx, m.vy) > 0.3) {
    const f = Math.floor(((st.odo / L_STRIDE) % 1) * 8) % 8;
    o.L = walkPose(f);
    o.key = `wk${f}`;
  } else {
    const f = Math.floor(now * 8) % 12;
    o.L = standPose(f);
    o.key = `st${f}`;
  }
}

let DIE_AUX: { hand: V3; hat: V3; pick: V3 } | null = null;
/** Где рука роняет вагу, где шляпа слетает и где её поднимут. */
function dieAux(): { hand: V3; hat: V3; pick: V3 } {
  if (!DIE_AUX) {
    const at = (t: number) => {
      const L = track(t, DIE);
      return { L, j: humanoid(new Rig(), LORD_BODY, L, { head: true, arms: true }) };
    };
    const a = at(0.3);
    const b = at(1.05);
    const c = at(3.95);
    DIE_AUX = { hand: vagaOf(a.j, a.L).c, hat: hatOf(b.j, b.L).b, pick: c.j.haL };
  }
  return DIE_AUX;
}

function deathSpec(t: number): LSpec {
  const n = F24(t, LORD_DEATH);
  const tq = n / 24;
  const L: LP = { ...track(tq, DIE) };
  const ax = dieAux();
  if (tq >= 0.3) {
    // Вага выпала из руки и легла у ног.
    const k = eIn((tq - 0.3) / 0.2);
    const p = vmix(ax.hand, v3(ax.hand.x, 0.6, ax.hand.z), k);
    L.wh = 0;
    L.vX = p.x;
    L.vY = p.y;
    L.vZ = p.z;
    L.wx = 1;
    L.wy = 0.8 * (1 - k);
    L.wz = 0.35;
  }
  if (tq >= 1.05 && tq < 4.05) {
    // Шляпа слетает дугой, катится и ждёт, пока её поднимут.
    const P1 = v3(-6, HAT_BR, 4);
    const P2 = v3(ax.pick.x, HAT_BR, ax.pick.z);
    let p: V3;
    let hT = Math.PI / 2;
    if (tq < 1.4) {
      const k = (tq - 1.05) / 0.35;
      p = vmix(ax.hat, P1, k);
      p.y += Math.sin(k * Math.PI) * 4;
      hT = k * (Math.PI / 2);
    } else if (tq < 2.2) {
      const k = ease((tq - 1.4) / 0.8);
      p = vmix(P1, P2, k);
      hT = Math.PI / 2 - 0.25 * Math.sin(k * Math.PI * 3) * (1 - k);
    } else p = P2;
    L.hat = 2;
    L.hX = p.x;
    L.hY = p.y;
    L.hZ = p.z;
    L.hT = hT;
  }
  const str = tq < 0.12 || tq > 2.8 ? 0 : clamp01((tq - 0.12) / 0.15);
  return {
    key: `D${n}`,
    L,
    str,
    sag: 0,
    snap: SNAP_T.map((s) => (tq >= s ? tq - s : -1)),
    smear: null,
    hang: 0,
    liftPx: L.up,
    alpha: tq < 4.7 ? 1 : clamp01(1 - (tq - 4.7) / 0.5),
    trail: false,
    blend: false,
  };
}

function lordSpec(m: Mob, now: number, st: LState): LSpec {
  if (m.mode === 'dying') return deathSpec(m.t);
  const o: LSpec = {
    key: '',
    L: LP0,
    str: 0,
    sag: 0,
    snap: null,
    smear: null,
    hang: 0,
    liftPx: st.lift * LIFT_PX,
    alpha: 1,
    trail: false,
    blend: true,
  };
  if (HANG_MODES.has(m.mode) || (!ACT4.has(m.mode) && st.lift > 0.02)) hangSpec(m, now, st, o);
  else walkSpec(m, now, st, o);
  // Приземлился: колени подогнулись, сжался.
  const la = now - st.landAt;
  if (la >= 0 && la < 0.5) {
    const n = F24(la);
    o.L = addP(o.L, track(n / 24, LAND), LP0);
    o.key += `|l${n}`;
  }
  // Удар героя: отдача от него.
  const ha = now - st.hitAt;
  if (ha >= 0 && ha < 0.3) {
    const n = Math.min(7, Math.floor(ha * 24));
    const k = n < 2 ? [0.7, 1][n] : 1 - ease((n - 1) / 6);
    o.L = addP(o.L, FLINCH[st.hb], LP0, k);
    o.key += `|h${st.hb}${n}`;
  }
  return o;
}

const LORD_CACHE = frameLRU<LordCached>(640);
const LORD_TRAIL = { every: 0.05, life: 0.24, tint: '#2a1e3a', alpha: 0.4 };

function lordKey(
  key: string,
  dir: number,
  flash: boolean,
  open: boolean,
  ghost: boolean,
  str: number,
  sag: number,
): string {
  return `${key}:${dir}:${flash ? 1 : 0}${open ? 'o' : ''}${ghost ? 'g' : ''}:${Math.round(str * 10)}.${sag}`;
}

function paintLord(m: Mob, pose: MobPose): MobFrame {
  const now = pose.now;
  const st = lordTick(m, now, pose.flash);
  const sp = lordSpec(m, now, st);
  let L = sp.L;
  let key = sp.key;
  // Смена режима в акте IV — короткое сведение поз (без скачка).
  if (sp.blend && st.bFrom) {
    const a = now - st.bAt;
    if (a >= 0 && a < 0.16) {
      const n = Math.floor(a / 0.04);
      L = mixP(st.bFrom, L, ease((n + 1) / 5));
      key = `B${n}{${st.bKey}}${key}`;
    }
  }
  st.last = L;
  st.lastKey = key;
  const dying = m.mode === 'dying';
  const dir = dying ? dirOf(m.face, 16) : dirOf(st.yaw, 16);
  const flash = pose.flash && (!dying || m.t < 0.08);
  const open = (m.data.open ?? 0) > 0 && !dying;
  const ghost = (m.data.ghost ?? 0) > 0 && !dying;
  const full = lordKey(key, dir, flash, open, ghost, sp.str, sp.sag);
  let c = LORD_CACHE.get(full);
  if (!c)
    c = LORD_CACHE.set(
      full,
      lordRender({
        L,
        dir,
        flash,
        open,
        ghost,
        str: sp.str,
        sag: sp.sag,
        snap: sp.snap,
        smear: sp.smear,
      }),
    );
  // Маятник вокруг подвеса, подъём на нитях, выпад, отдача.
  const th = st.th * sp.hang;
  const yaw = (dir / 16) * TAU;
  let dx = L.fw * Math.cos(yaw) - PIVOT * Math.sin(th);
  let dy = L.fw * Math.sin(yaw) - sp.liftPx - PIVOT * (1 - Math.cos(th));
  const ha = now - st.hitAt;
  if (ha >= 0 && ha < 0.3 && !dying) {
    const k = 1 - ha / 0.3;
    dx += st.hdx * 2.5 * k;
    dy += st.hdy * 2.5 * k;
  }
  const fr: MobFrame = {
    ...c.fr,
    dx,
    dy,
    shadow: dying ? 15 * sp.alpha : 15 - 7 * st.lift,
    alpha: (ghost ? 0.92 : 1) * sp.alpha,
    ghost: sp.trail ? LORD_TRAIL : null,
  };
  const sy = L.sq;
  const sx = 1 + (1 - L.sq) * 0.6;
  if (Math.abs(th) > 1e-3) fr.rot = th;
  if (sy !== 1) {
    fr.sx = sx;
    fr.sy = sy;
  }
  if (dying) fr.linger = LORD_DEATH;
  // Вага на экране (от точки на полу) — сюда «Техники» сводят нити исполина.
  const lx = (c.vx - c.fr.ax) * sx;
  const ly = (c.vy - c.fr.ay) * sy;
  const cs = Math.cos(th);
  const sn = Math.sin(th);
  st.vaga = [lx * cs - ly * sn + dx, lx * sn + ly * cs + dy + 2];
  return fr;
}
paintMob('f13boss', paintLord);

/**
 * Вага на экране относительно точки Кукловода на полу, игровые пиксели:
 * из последнего нарисованного кадра (поза, подъём, маятник, зеркало).
 */
export function lordVagaPx(m: Mob, _now: number): [number, number] {
  return LST.get(m.id)?.vaga ?? [-2, -44 - lordLiftPx(m)];
}

// ---- прогрев -----------------------------------------------------------------

for (const k of [
  'f13_knight',
  'f13_nutcracker',
  'f13_drummer',
  'f13_fiddler',
  'f13_ballerina',
  'f13_harlequin',
  'f13_prompter',
  'f13_shade',
  'f13_cashier',
])
  warmPuppet(k, 8);

/**
 * Кукловод: пробуждение, висение акта I в обе стороны с жестами ваги под
 * копьё, щит и шаг исполина, потом шаг акта IV во все 16 сторон. Кадры —
 * через сам рисовальщик (свой номер моба, своё состояние), ключи те же.
 */
registerMobWarm('f13boss', function* () {
  const m = fakeMob('f13boss');
  m.id = -13;
  const at = (now: number): MobPose => ({
    anim: 'idle',
    frame: 0,
    mode: m.mode,
    t: m.t,
    left: false,
    flash: false,
    look: 'normal',
    now,
  });
  m.mode = 'roar';
  m.face = Math.PI / 2;
  m.data = { lift: 1, ghost: 1 };
  for (let n = 0; n <= 58; n++) {
    m.t = n / 24;
    paintLord(m, at(n / 24));
    yield n;
  }
  for (const side of [1, -1]) {
    m.face = Math.atan2(1, -side);
    m.mode = 'f13_hang';
    m.data = { lift: 1, ghost: 1 };
    for (let f = 0; f < 16; f++) {
      m.t = f / 10;
      paintLord(m, at(f / 10));
      yield f;
    }
    for (const [code, dur] of [
      [1, 1.0],
      [5, 0.8],
      [2, 0.8],
      [11, 0.6],
      [8, 1.0],
    ]) {
      m.data = { lift: 1, ghost: 1, vG: code };
      for (let n = 0; n / 24 <= dur; n++) {
        m.t = n / 24;
        paintLord(m, at(n / 24));
        yield n;
      }
    }
  }
  for (let d = 0; d < 16; d++)
    for (let f = 0; f < 8; f++) {
      const key = lordKey(`wk${f}`, d, false, false, false, 0, 0);
      if (!LORD_CACHE.get(key)) {
        const L = walkPose(f);
        LORD_CACHE.set(
          key,
          lordRender({
            L,
            dir: d,
            flash: false,
            open: false,
            ghost: false,
            str: 0,
            sag: 0,
            snap: null,
            smear: null,
          }),
        );
      }
      yield f;
    }
});

/** Исполин: шаг во все 16 сторон, копьё и щит — в четыре стороны к залу. */
registerMobWarm('f13_giant', function* () {
  for (let d = 0; d < 16; d++)
    for (let f = 0; f < 12; f++) {
      const s = giantSpec('chase', 0, '', (f / 12) * G_STRIDE + 0.01, 0, 2);
      const key = giantKey(s, d, false, 0);
      if (!GIANT_CACHE.get(key)) GIANT_CACHE.set(key, giantRender(s.q, d, false, s.smear));
      yield f;
    }
  for (const d of [2, 4, 6, 12])
    for (const [mode, prev, dur] of [
      ['f13_lance', '', 1.0],
      ['recover', 'f13_lance', 0.8],
      ['f13_shield', '', 0.8],
      ['recover', 'f13_shield', 0.8],
    ] as const)
      for (let n = 0; n / 24 < dur; n++) {
        const s = giantSpec(mode, n / 24, prev, 0, 0, 0);
        const key = giantKey(s, d, false, 0);
        if (!GIANT_CACHE.get(key)) GIANT_CACHE.set(key, giantRender(s.q, d, false, s.smear));
        yield n;
      }
});
