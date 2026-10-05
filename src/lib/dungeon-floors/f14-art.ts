// Этаж 14 «Часовая башня» — рисовальщики: монстры, Повелитель часа,
// механизмы и часы, свои клетки трёх районов, метки ударов, стрелки,
// песок, ножи, иконки вещей.
//
// Всё нарисовано кодом: пиксели 16 на клетку, свет сверху-слева, контур
// тёмный, палитра — ступени камня подземелья и два акцента этажа: ЛАТУНЬ
// (механизм, стрелки, рамы) и БИРЮЗА ВРЕМЕНИ (отмотка, сферы, песок
// времени). Песочные часы — тёплый песок, Циферблат — лунная эмаль.
// Двойник из прошлого — лист самого героя (Ninja Adventure, уже в
// проекте), в сепии и полупрозрачный: «это ты пять секунд назад».
//
// Живое (маятники, зубья колец, шестерни, стрелки, песок, колокол,
// метроном, фонари) — кадрами предметов и зон; клетки кешируются по виду
// и соседям и собираются в кусок карты один раз.

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
import type { Mob, Strike, Zone } from '../dungeon-sim';
import { heroSprite } from '../dungeon-sprites';
import type { Dir4 } from '../dungeon-sprites';
import { F14_DIAL, F14_GEO, F14_MARK, F14_MECH, F14_SAND, F14_TOP } from './f14';
import { MAP_F14_DIAL, MAP_F14_SAND } from './f14-map';
import { F14_FX, KNIFE_ANG, LORD, NOON, REAPER, rewindTrail, worldStopped } from './f14-brains';

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
const alpha = (c: RGBA, a: number): RGBA => [
  c[0],
  c[1],
  c[2],
  Math.round(Math.max(0, Math.min(1, a)) * 255),
];

export const INK = hx('#150f0b');
const WHITE = hx('#ffffff');
const GOLDK = hx('#ffcc40');
export const TAU = Math.PI * 2;

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

/** Конечность: сужающаяся «капсула» со светом по нормали. */
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

/** Многоугольник со светом (плоская грань, свет по месту). */
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

/** Линия (толщиной `w`). */
export function stroke(
  p: Px,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  c: RGBA,
  w = 1,
): void {
  const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2) + 1;
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    const y = y0 + ((y1 - y0) * i) / n;
    if (w <= 1) p.set(Math.floor(x), Math.floor(y), c);
    else p.ell(x, y, w / 2, w / 2, c);
  }
}

/** Детерминированный шум 0…1. */
const hash = (a: number, b: number, c = 0) => {
  let h = (a * 374761393 + b * 668265263 + c * 1274126177) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** Обесцветить (статуя, замершее время) с лёгкой сепией. */
function toGray(p: Px, sepia = 0.25): Px {
  const o = new Px(p.w, p.h);
  for (let i = 0; i < p.data.length; i += 4) {
    if (!p.data[i + 3]) continue;
    const l = p.data[i] * 0.3 + p.data[i + 1] * 0.55 + p.data[i + 2] * 0.15;
    o.data[i] = Math.min(255, l * (1 + sepia * 0.25));
    o.data[i + 1] = Math.min(255, l * (1 + sepia * 0.08));
    o.data[i + 2] = Math.min(255, l * (1 - sepia * 0.18));
    o.data[i + 3] = p.data[i + 3];
  }
  return o;
}

// ---------------------------------------------------------------------------
// Палитра этажа: камень подземелья + латунь + бирюза времени.
// ---------------------------------------------------------------------------

const BRASS = tn('#3a2410', '#7a5220', '#b8862e', '#f0c860');
const BRASS_HI = hx('#fff0b0');
const COPPER = tn('#3a1a10', '#6a3420', '#a8583a', '#e0906a');
const IRON = tn('#16161c', '#2e2e38', '#4e4e5a', '#8a8a98');
const STEEL = tn('#2a3038', '#58626e', '#98a4b0', '#e4ecf4');
const ENAMEL = tn('#8a8478', '#c8c0b0', '#ece6d8', '#fffaf0');
export const TEAL = tn('#0e3a44', '#1e7a88', '#4cc8d8', '#b8f4ff');
export const SAND = tn('#6a4a24', '#a8844c', '#d8b878', '#f4e2b0');
const WOOD = tn('#2a160c', '#4a2816', '#6e3e22', '#9a5e34');
const REDC = tn('#3a0a0c', '#6a1418', '#a42228', '#d8484a');
const NAVY = tn('#10142a', '#1e2648', '#34406a', '#5a6aa0');
const SKIN = tn('#8a4a38', '#c88a70', '#f0c0a0', '#ffe4cc');
const GLASS = hx('#bfe8f0', 150);
const GLASS_HI = hx('#ffffff', 200);
export const TEAL_GLOW = hx('#8fe8ff');
const AMBER = hx('#ffb040');

// ---------------------------------------------------------------------------
// Приёмы: шестерня, циферблат, песочные часы, пружина.
// ---------------------------------------------------------------------------

/**
 * Шестерня: диск с зубьями, спицы и ступица. `rot` — поворот; свет по
 * фаске: верхний-левый край светлее, нижний-правый темнее.
 */
function cog(
  p: Px,
  cx: number,
  cy: number,
  r: number,
  teeth: number,
  rot: number,
  t: Tones,
  o: { hole?: number; spokes?: number; tooth?: number; dark?: RGBA } = {},
): void {
  const tooth = o.tooth ?? Math.max(1.2, r * 0.2);
  const body = r - tooth;
  const hole = o.hole ?? Math.max(0.8, r * 0.18);
  const spokes = o.spokes ?? (r > 7 ? 5 : r > 4 ? 4 : 0);
  const win0 = hole + Math.max(1, r * 0.12);
  const win1 = body - Math.max(1.2, r * 0.18);
  for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++)
    for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d = Math.hypot(dx, dy);
      if (d > r) continue;
      const a = Math.atan2(dy, dx) - rot;
      const f = ((((a / TAU) * teeth) % 1) + 1) % 1;
      if (d > body && (f < 0.22 || f > 0.72)) continue;
      if (d < hole) {
        if (o.dark) p.set(x, y, o.dark);
        continue;
      }
      if (spokes && d > win0 && d < win1) {
        const sf = ((((a / TAU) * spokes) % 1) + 1) % 1;
        if (sf > 0.18 && sf < 0.82) {
          if (o.dark) p.set(x, y, o.dark);
          continue;
        }
      }
      // Фаска: обод и зубья светлые сверху-слева, тёмные снизу-справа;
      // у ступицы наоборот (вдавлена); плоскость — ровный тон.
      const nx = dx / (d || 1);
      const ny = dy / (d || 1);
      const lit = -(nx * LX + ny * LY);
      let l: number;
      if (d > body - 1) l = 0.45 - lit * 0.9;
      else if (d < hole + 1.1) l = 0.45 + lit * 0.9;
      else if (spokes && (d < win0 + 0.9 || d > win1 - 0.9)) l = 0.5 - lit * 0.5;
      else l = 0.5 + (hash(x, y, 3) - 0.5) * 0.12;
      p.set(x, y, tone(t, l));
    }
}

/**
 * Циферблат: эмаль, латунный обод, двенадцать рисок, две стрелки.
 * Углы стрелок: 0 — XII, по часовой.
 */
function dialFace(
  p: Px,
  cx: number,
  cy: number,
  r: number,
  minAng: number,
  hourAng: number,
  o: { enamel?: Tones; rim?: Tones; hand?: RGBA; glow?: RGBA | null } = {},
): void {
  const en = o.enamel ?? ENAMEL;
  const rim = o.rim ?? BRASS;
  shadeEll(p, cx, cy, r, r, rim);
  shadeEll(p, cx, cy, r - 1, r - 1, en, 0.25);
  if (o.glow) p.ell(cx, cy, r - 1.2, r - 1.2, alpha(o.glow, 0.35));
  const ink = o.hand ?? INK;
  if (r >= 4)
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      const rr = r - 1.8;
      const x = cx + Math.sin(a) * rr;
      const y = cy - Math.cos(a) * rr;
      p.set(Math.floor(x), Math.floor(y), i % 3 === 0 ? ink : mixc(en[1], ink, 0.5));
    }
  const hand = (a: number, len: number, w: number) => {
    const x1 = cx + Math.sin(a) * len;
    const y1 = cy - Math.cos(a) * len;
    stroke(p, cx - 0.5, cy - 0.5, x1 - 0.5, y1 - 0.5, ink, w);
  };
  hand(hourAng, r * 0.45, 1);
  hand(minAng, r * 0.72, 1);
  p.set(Math.floor(cx - 0.5), Math.floor(cy - 0.5), BRASS[3]);
}

/**
 * Песочные часы: латунные плиты сверху и снизу, стойки, две колбы;
 * `k` — сколько песка вверху (0…1), `flow` — струя идёт.
 */
function hourglass(
  p: Px,
  cx: number,
  top: number,
  w: number,
  h: number,
  k: number,
  flow: boolean,
  f: number,
  o: { sand?: Tones; frame?: Tones; broken?: boolean; glow?: RGBA | null } = {},
): void {
  const sand = o.sand ?? SAND;
  const fr = o.frame ?? BRASS;
  const half = Math.floor(w / 2);
  const bh = Math.max(2, Math.round(h * 0.1));
  const inner = h - bh * 2;
  const mid = top + bh + inner / 2;
  // Колбы: форма — две капли, сходящиеся в горлышко.
  const bulb = (y: number) => {
    const u = Math.abs(y + 0.5 - mid) / (inner / 2);
    return Math.max(0.6, (half - 1.5) * Math.sqrt(Math.max(0, 1 - Math.pow(1 - u, 2.2))));
  };
  for (let y = top + bh; y < top + bh + inner; y++) {
    const r = bulb(y);
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r - 1); x++) {
      const edge = x <= cx - r + 0.6 || x >= cx + r - 1.6;
      p.set(x, y, edge ? alpha(mixc(GLASS, WHITE, 0.3), 0.85) : GLASS);
    }
  }
  // Песок: вверху — к горлышку, внизу — горкой.
  const upH = (inner / 2 - 1) * k;
  const lowH = (inner / 2 - 1) * (1 - k);
  const bottom = top + bh + inner;
  for (let y = top + bh; y < bottom; y++) {
    const r = bulb(y) - 0.7;
    if (r <= 0) continue;
    const upper = y < mid;
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r - 1); x++) {
      const u = Math.min(1, Math.abs(x + 0.5 - cx) / Math.max(1, r));
      // Вверху — воронка (середина ниже), внизу — горка (середина выше).
      const fill = upper
        ? upH > 0.3 && y >= mid - upH + (1 - u) * 1.2
        : lowH > 0.3 && y >= bottom - lowH * (0.6 + 0.4 * (1 - u * u));
      if (!fill) continue;
      const l = (x + 0.5 - cx) / Math.max(1, r);
      p.set(x, y, l < -0.4 ? sand[2] : l > 0.5 ? sand[0] : sand[1]);
    }
  }
  // Струя через горлышко.
  if (flow && k > 0.02 && !o.broken)
    for (let y = Math.floor(mid) - 1; y < top + bh + inner - lowH; y++)
      if ((y + f) % 3 !== 0) p.set(Math.floor(cx - 0.5), y, sand[3]);
  // Блик на стекле.
  for (let y = top + bh + 1; y < mid - 2; y++) p.set(Math.floor(cx - bulb(y) + 1.5), y, GLASS_HI);
  if (o.glow)
    for (let y = top + bh; y < top + bh + inner; y += 2)
      p.set(Math.floor(cx - 0.5), y, alpha(o.glow, 0.5));
  // Плиты и стойки.
  polyShade(
    p,
    [
      [cx - half, top],
      [cx + half, top],
      [cx + half, top + bh],
      [cx - half, top + bh],
    ],
    fr,
  );
  polyShade(
    p,
    [
      [cx - half, top + h - bh],
      [cx + half, top + h - bh],
      [cx + half, top + h],
      [cx - half, top + h],
    ],
    fr,
    -0.1,
  );
  for (const sx of [cx - half + 0.5, cx + half - 1.5])
    for (let y = top + bh; y < top + h - bh; y++) p.set(Math.floor(sx), y, sx < cx ? fr[2] : fr[1]);
  if (o.broken) {
    // Трещины по стеклу, песок высыпался.
    stroke(p, cx - 2, top + bh + 2, cx + 1, mid - 1, alpha(WHITE, 0.9));
    stroke(p, cx + 1, mid + 1, cx - 1, top + h - bh - 2, alpha(WHITE, 0.8));
  }
}

/** Пружина зигзагом от точки к точке. */
function spring(
  p: Px,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  turns: number,
  amp: number,
  c: RGBA,
  c2: RGBA,
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L;
  const ny = dx / L;
  const n = Math.max(4, Math.ceil(L * 1.5));
  let px = x0;
  let py = y0;
  for (let i = 1; i <= n; i++) {
    const k = i / n;
    const s = Math.sin(k * turns * TAU) * amp;
    const x = x0 + dx * k + nx * s;
    const y = y0 + dy * k + ny * s;
    stroke(p, px, py, x, y, s > 0 ? c : c2);
    px = x;
    py = y;
  }
}

// ---------------------------------------------------------------------------
// Кадр монстра: облик, вспышка, отражение, серость статуи, кеш.
// ---------------------------------------------------------------------------

type Look = MobPose['look'];

interface Built {
  p: Px;
  /** Середина тела и земля в кадре (смотрит вправо). */
  ax: number;
  ay: number;
  eye: [number, number] | null;
}

const frames = new Map<string, MobFrame>();

function finish(
  key: string,
  b: Built,
  look: Look,
  flash: boolean,
  left: boolean,
  gray = false,
): MobFrame {
  let p = b.p;
  if (look === 'albino') {
    const pale = hx('#f4ece4');
    const q = new Px(p.w, p.h);
    for (let i = 0; i < p.data.length; i += 4) {
      if (!p.data[i + 3]) continue;
      const l = (p.data[i] + p.data[i + 1] + p.data[i + 2]) / 3;
      const c = mixc([l, l, l, 255], pale, 0.45);
      q.data[i] = c[0];
      q.data[i + 1] = c[1];
      q.data[i + 2] = c[2];
      q.data[i + 3] = p.data[i + 3];
    }
    p = q;
  }
  if (gray) p = toGray(p);
  if (look === 'elite') p.outline(GOLDK);
  if (flash) p = p.tint(WHITE, 0.85);
  if (left) p = p.flipX();
  const eye =
    b.eye && !gray ? ([left ? p.w - 1 - b.eye[0] : b.eye[0], b.eye[1]] as [number, number]) : null;
  const out: MobFrame = { img: p.canvas(), ax: left ? p.w - b.ax : b.ax, ay: b.ay, eye };
  frames.set(key, out);
  return out;
}

function frameOf(
  kind: string,
  pose: MobPose,
  anim: string,
  f: number,
  build: () => Built,
  gray = false,
): MobFrame {
  const key = `${kind}|${anim}|${f}|${pose.left ? 1 : 0}|${pose.flash ? 1 : 0}|${pose.look}|${gray ? 1 : 0}`;
  const hit = frames.get(key);
  if (hit) return hit;
  return finish(key, build(), pose.look, pose.flash, pose.left, gray);
}

/** Пустой кадр (спрятан в часах, висит под потолком — рисует другое). */
const EMPTY = (() => {
  let c: MobFrame | null = null;
  return (): MobFrame => {
    if (!c) {
      const p = new Px(1, 1);
      c = { img: p.canvas(), ax: 0, ay: 0, eye: null };
    }
    return c;
  };
})();

/** Звёздочки над головой оглушённого (кадр f из 4). */
function stars(p: Px, cx: number, cy: number, rx: number, f: number): void {
  const c1 = hx('#fff27a');
  const c2 = hx('#ffffff');
  for (let i = 0; i < 3; i++) {
    const a = (f / 4) * TAU + (i / 3) * TAU;
    const x = Math.round(cx + Math.cos(a) * rx);
    const y = Math.round(cy + Math.sin(a) * rx * 0.35);
    p.set(x, y, c2);
    p.set(x - 1, y, c1);
    p.set(x + 1, y, c1);
  }
}

/** Смерть механизма: фигура оседает, из неё сыплются шестерёнки. */
function scatter(p: Px, k: number, seed: number, bits: RGBA[]): Px {
  if (k <= 0) return p;
  const o = new Px(p.w, p.h);
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      const i = (y * p.w + x) * 4;
      if (!p.data[i + 3]) continue;
      const r = hash(x, y, seed);
      if (r < k * 0.3) continue;
      const ty = Math.min(p.h - 1, y + Math.floor(k * k * 3 * r));
      const tx = x + Math.round((r - 0.5) * k * 3);
      const j = (ty * p.w + Math.max(0, Math.min(p.w - 1, tx))) * 4;
      const c: RGBA =
        r < k * 0.4
          ? bits[Math.floor(r * 97) % bits.length]
          : [p.data[i], p.data[i + 1], p.data[i + 2], 255];
      o.data[j] = c[0];
      o.data[j + 1] = c[1];
      o.data[j + 2] = c[2];
      o.data[j + 3] = 255;
    }
  return o;
}

/** Номер кадра смерти по времени режима. */
const deathK = (pose: MobPose) =>
  pose.mode === 'dying' ? Math.min(3, Math.floor(pose.t / 0.16)) : 0;

/** Стереть пиксель (полупрозрачный `set` поверх не стирает). */
function clear(p: Px, x: number, y: number): void {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || y < 0 || x >= p.w || y >= p.h) return;
  p.data[(y * p.w + x) * 4 + 3] = 0;
}

// ---------------------------------------------------------------------------
// Заводной солдатик: кивер с латунной бляхой и красным султаном, красный
// мундир с белой перевязью, синие штаны, ружьё со штыком, ЗАВОДНОЙ КЛЮЧ в
// спине (крутится — живой; стоит — завод кончился). Кадр 24×28, земля 26.
// ---------------------------------------------------------------------------

interface SoldierPose {
  /** Шаг марша: 0…3. */
  walk: number;
  /** Ружьё: у плеча, наперевес, выпад, висит. */
  gun: 'up' | 'aim' | 'thrust' | 'droop';
  /** Поворот ключа 0…3 (−1 — стоит боком, завод кончился). */
  key: number;
  /** Наклон корпуса: + вперёд. */
  lean: number;
  /** Опустил голову. */
  slump: boolean;
  /** Глаза горят (просыпается). */
  lit?: boolean;
}

const SOLD = {
  hat: tn('#0e0c12', '#1c1822', '#34303e', '#5a5468'),
  plume: tn('#5a0c10', '#9e1e26', '#d8484a', '#ff8a7a'),
  belt: tn('#8a8478', '#c8c0b0', '#ece6d8', '#ffffff'),
  boot: hx('#141018'),
  gunWood: tn('#2a160c', '#5a3218', '#8a5028', '#b87a40'),
  far: tn('#0a0c1a', '#161c36', '#242e52', '#3a4676'),
};

function drawSoldier(o: SoldierPose): Built {
  const p = new Px(24, 28);
  const G = 26;
  const cx = 9;
  const lean = o.lean;
  // Ноги прямые, как у оловянного: шаг ножницами.
  const step = [1.6, 0, -1.6, 0][o.walk % 4];
  const lift = o.walk % 2 === 0 ? 0 : 1;
  const leg = (x: number, dx: number, far: boolean) => {
    limb(p, x, 19, x + dx, G - 2, 1.4, 1.2, far ? SOLD.far : NAVY);
    const fx = Math.round(x + dx);
    p.rect(fx - 1, G - 2, fx + 1, G - 1, SOLD.boot);
    p.set(fx + 2, G - 1, SOLD.boot);
  };
  leg(cx - 1, -step, true);
  leg(cx + 1, step, false);
  const by = lift;
  const tx = (y: number) => cx + lean * ((21 - y) / 9);
  // Фалды мундира сзади.
  polyShade(
    p,
    [
      [tx(18) - 3, 18 + by],
      [tx(18) - 1, 18 + by],
      [cx - 3, 21 + by],
      [cx - 5, 21 + by],
    ],
    REDC,
    -0.2,
  );
  // Мундир: корпус трапецией.
  polyShade(
    p,
    [
      [tx(12) - 3, 12 + by],
      [tx(12) + 3, 12 + by],
      [tx(19) + 3, 19 + by],
      [tx(19) - 3, 19 + by],
    ],
    REDC,
    0.05,
  );
  // Перевязь крест-накрест и пуговицы.
  for (let i = 0; i <= 6; i++) {
    const y = 12 + i + by;
    p.set(Math.round(tx(y) - 2 + i * 0.8), y, SOLD.belt[2]);
    p.set(Math.round(tx(y) + 2 - i * 0.8), y, SOLD.belt[1]);
  }
  for (const y of [13, 15, 17]) p.set(Math.round(tx(y) + 2.5), y + by, BRASS[3]);
  // Пояс и бляха.
  p.rect(Math.round(tx(18) - 3), 18 + by, Math.round(tx(18) + 3), 18 + by, SOLD.belt[1]);
  p.set(Math.round(tx(18)), 18 + by, BRASS[3]);
  // Эполет.
  p.rect(Math.round(tx(12) - 1), 12 + by, Math.round(tx(12) + 1), 12 + by, BRASS[2]);
  p.set(Math.round(tx(12) + 2), 12 + by, BRASS[3]);
  // Заводной ключ в спине: бородка — латунный овал, повёрнутый на кадр.
  const kx = tx(15) - 3.5;
  const ky = 15 + by;
  stroke(p, kx + 0.5, ky, kx - 1.5, ky, BRASS[1]);
  const kw = o.key < 0 ? 0.6 : [2.6, 1.6, 0.6, 1.6][o.key % 4];
  shadeEll(p, kx - 3, ky, kw, 2.4, BRASS, 0.1);
  if (kw > 1.2) p.set(Math.round(kx - 3), Math.round(ky), BRASS[0]);
  // Голова.
  const hxp = tx(9) + (o.slump ? 1.5 : 0);
  const hyp = 9.5 + by + (o.slump ? 1 : 0);
  shadeEll(p, hxp, hyp, 2.6, 2.6, SKIN, 0.1);
  p.set(Math.round(hxp + 1.8), Math.round(hyp + 0.6), hx('#e06060'));
  p.rect(
    Math.round(hxp),
    Math.round(hyp + 1.4),
    Math.round(hxp + 1.5),
    Math.round(hyp + 1.4),
    hx('#3a2410'),
  );
  // Кивер с бляхой.
  polyShade(
    p,
    [
      [hxp - 2.8, hyp - 1.6],
      [hxp + 2.6, hyp - 1.6],
      [hxp + 2.2, hyp - 7.5],
      [hxp - 2.6, hyp - 7.5],
    ],
    SOLD.hat,
    0.1,
  );
  p.rect(
    Math.round(hxp - 3),
    Math.round(hyp - 1.6),
    Math.round(hxp + 3),
    Math.round(hyp - 1.6),
    SOLD.hat[0],
  );
  shadeEll(p, hxp + 0.8, hyp - 4.6, 1.2, 1.3, BRASS, 0.2);
  limb(p, hxp - 0.5, hyp - 7.5, hxp - 0.8, hyp - 10, 1, 0.6, SOLD.plume);
  // Рука и ружьё.
  const sx = tx(13) + 1.5;
  const sy = 13 + by;
  if (o.gun === 'up' || o.gun === 'droop') {
    const gx = sx + 3;
    const tilt = o.gun === 'droop' ? 3 : 0;
    // Ружьё у плеча: приклад внизу, штык вверх.
    limb(p, gx, 21 + by, gx + tilt * 0.3, 12 + by, 1, 0.9, SOLD.gunWood);
    stroke(p, gx + tilt * 0.3, 12 + by, gx + tilt * 0.6, 5 + by, STEEL[2]);
    stroke(p, gx + tilt * 0.6, 5 + by, gx + tilt * 0.8, 2 + by, STEEL[3]);
    limb(p, sx, sy, gx - 0.3, 16 + by, 1.2, 1, REDC);
    p.set(Math.round(gx), 16 + by, SKIN[2]);
  } else {
    // Наперевес: ствол вперёд, штык ещё дальше; выпад — на три пикселя.
    const push = o.gun === 'thrust' ? 3 : 0;
    const gy = 15 + by;
    limb(p, sx - 3 + push, gy + 1, sx + 5 + push, gy - 0.5, 1, 0.8, SOLD.gunWood);
    stroke(p, sx + 5 + push, gy - 0.5, sx + 9 + push, gy - 0.5, STEEL[2]);
    stroke(p, sx + 9 + push, gy - 0.5, sx + 12 + push, gy - 0.5, STEEL[3]);
    limb(p, sx, sy, sx + 2 + push, gy, 1.2, 1, REDC);
    p.set(Math.round(sx + 2 + push), gy, SKIN[2]);
  }
  p.outline(INK);
  // Глаз — поверх контура; султан светлее — читается на тёмном.
  p.set(Math.round(hxp + 1), Math.round(hyp - 0.4), o.lit ? hx('#ffe08a') : INK);
  p.set(Math.round(hxp - 0.8), Math.round(hyp - 10.4), SOLD.plume[3]);
  return { p, ax: cx, ay: G, eye: o.lit ? [Math.round(hxp + 1), Math.round(hyp - 0.4)] : null };
}

registerMobPainter('f14_soldier', (m: Mob, pose: MobPose) => {
  const mode = pose.mode;
  const f = pose.frame;
  const spin = Math.floor(pose.t * 10);
  let anim = 'idle';
  let fr = f % 4;
  let o: SoldierPose = { walk: 0, gun: 'up', key: fr, lean: 0, slump: false };
  const gray = mode === 'f14_statue' || mode === 'f14_frozen';
  if (gray) {
    anim = m.data.frame ? 'tableau' : 'statue';
    fr = 0;
    o = m.data.frame
      ? { walk: 1, gun: 'thrust', key: 1, lean: 1, slump: false }
      : { walk: 0, gun: 'up', key: 1, lean: 0, slump: false };
  } else if (mode === 'dying') {
    anim = 'dead';
    fr = deathK(pose);
    o = { walk: 0, gun: 'droop', key: -1, lean: 1, slump: true };
  } else if (mode === 'aim') {
    anim = 'aim';
    fr = spin % 4;
    o = { walk: 0, gun: 'aim', key: fr, lean: -0.5, slump: false, lit: true };
  } else if (mode === 'recover' && pose.t < 0.25) {
    anim = 'thrust';
    fr = 0;
    o = { walk: 0, gun: 'thrust', key: 0, lean: 1, slump: false, lit: true };
  } else if (mode === 'f14_unwound') {
    anim = 'unwound';
    fr = Math.floor(pose.t * 3) % 4;
    o = { walk: 0, gun: 'droop', key: -1, lean: 1.2, slump: true };
  } else if (mode === 'f14_rewind' || mode === 'f14_waking') {
    anim = 'rewind';
    fr = spin % 4;
    o = {
      walk: 0,
      gun: 'up',
      key: fr,
      lean: 0,
      slump: mode === 'f14_rewind' && pose.t < 0.4,
      lit: true,
    };
  } else if (pose.anim === 'run') {
    anim = 'run';
    o = { walk: fr, gun: 'up', key: fr, lean: 0.3, slump: false, lit: true };
  } else if (pose.anim === 'hurt') {
    anim = 'hurt';
    fr = 0;
    o = { walk: 0, gun: 'up', key: 1, lean: -1, slump: false, lit: true };
  } else o.lit = true;
  return frameOf(
    'f14_soldier',
    pose,
    anim,
    fr,
    () => {
      const b = drawSoldier(o);
      if (anim === 'dead') b.p = scatter(b.p, fr, 3, [BRASS[3], REDC[2], STEEL[3]]);
      if (anim === 'unwound') stars(b.p, b.ax, 3, 4, fr);
      return b;
    },
    gray,
  );
});

// ---------------------------------------------------------------------------
// Кукушка: резная деревянная птица на латунной пружине. Спрятана в часах —
// кадра нет (дверцы рисуют часы); вылетела — пружина тянется к часам.
// ---------------------------------------------------------------------------

const BIRD = {
  body: tn('#3a2210', '#6a4020', '#9a6436', '#c89458'),
  wing: tn('#24140a', '#4a2c14', '#6a4020', '#8a5a30'),
  breast: tn('#8a7a5a', '#c8b48a', '#ece0bc', '#fff8e0'),
  beak: hx('#ff9a30'),
  eye: hx('#1a3a8a'),
};

function drawBird(p: Px, cx: number, cy: number, right: boolean, open: boolean): void {
  const s = right ? 1 : -1;
  // Хвост — назад и вниз, веером.
  polyShade(
    p,
    [
      [cx - 4 * s, cy],
      [cx - 10 * s, cy + 2],
      [cx - 9 * s, cy + 5],
      [cx - 3 * s, cy + 2.5],
    ],
    BIRD.body,
    -0.1,
  );
  for (let i = 0; i < 3; i++)
    p.set(Math.round(cx - (7 + i) * s), Math.round(cy + 2.5 + i * 0.6), BIRD.body[0]);
  shadeEll(p, cx, cy, 5.5, 4, BIRD.body, 0.05);
  shadeEll(p, cx + 2 * s, cy + 1.3, 3, 2.5, BIRD.breast, 0.2);
  // Крыло распахнуто — резное, в три пера.
  polyShade(
    p,
    [
      [cx - 3 * s, cy - 1.5],
      [cx + 1 * s, cy - 2],
      [cx - 2 * s, cy - 7],
      [cx - 6 * s, cy - 5],
    ],
    BIRD.wing,
    0.1,
  );
  stroke(p, cx - 1 * s, cy - 2.5, cx - 3 * s, cy - 6, BIRD.wing[3]);
  // Голова и клюв.
  shadeEll(p, cx + 4.2 * s, cy - 3, 2.8, 2.6, BIRD.body, 0.15);
  poly(
    p,
    [
      [cx + 6.5 * s, cy - 3.8],
      [cx + 10 * s, cy - (open ? 4.5 : 3)],
      [cx + 6.5 * s, cy - 2.2],
    ],
    BIRD.beak,
  );
  if (open)
    poly(
      p,
      [
        [cx + 6.5 * s, cy - 2.2],
        [cx + 9.5 * s, cy - 1],
        [cx + 6.5 * s, cy - 1.4],
      ],
      hx('#c85010'),
    );
}

registerMobPainter('f14_cuckoo', (m: Mob, pose: MobPose) => {
  const mode = pose.mode;
  if (mode !== 'f14_peck' && mode !== 'f14_out' && mode !== 'f14_back' && mode !== 'dying')
    return EMPTY();
  // Пружина — от птицы к часам: направление и длина от места гнезда.
  const nx = m.data.nx ?? m.x;
  const ny = m.data.ny ?? m.y;
  const dx = nx - m.x;
  const dy = ny - m.y - 0.7;
  const len = Math.hypot(dx, dy) * 16;
  const ab = Math.round((Math.atan2(dy, dx) / TAU) * 32);
  const lb = Math.round(len / 3);
  const right = Math.cos(m.dir) >= 0;
  const open = mode === 'f14_peck' || (mode === 'f14_out' && pose.t < 0.25);
  const dk = mode === 'dying' ? deathK(pose) : 0;
  const key = `f14_cuckoo|${ab}|${lb}|${right ? 1 : 0}|${open ? 1 : 0}|${pose.flash ? 1 : 0}|${pose.look}|${dk}`;
  const hit = frames.get(key);
  if (hit) return hit;
  const L = lb * 3;
  const S = Math.max(30, 2 * L + 30);
  const p = new Px(S, S);
  const c = S / 2;
  const a = (ab / 32) * TAU;
  // Пружина: латунный зигзаг до часов.
  if (L > 3 && !dk)
    spring(
      p,
      c,
      c + 1,
      c + Math.cos(a) * L,
      c + Math.sin(a) * L,
      Math.max(2, L / 5),
      1.6,
      BRASS[3],
      BRASS[1],
    );
  drawBird(p, c, c, right, open);
  p.outline(INK);
  p.set(Math.round(c + (right ? 5 : -5)), Math.round(c - 3), BIRD.eye);
  let q = p;
  if (dk) q = scatter(q, dk, 7, [BIRD.body[2], BIRD.breast[2], BRASS[3]]);
  if (pose.look === 'elite') q.outline(GOLDK);
  if (pose.flash) q = q.tint(WHITE, 0.85);
  const out: MobFrame = { img: q.canvas(), ax: c, ay: c + 4, eye: null };
  frames.set(key, out);
  return out;
});

// ---------------------------------------------------------------------------
// Песочный призрак: фигура из текущего песка — капюшон, светящиеся глаза,
// руки-струи, хвост до земли. Рассыпается бугром и собирается обратно.
// Кадр 24×27, земля 25.
// ---------------------------------------------------------------------------

const GHOST = {
  sand: tn('#5a3c1c', '#9a7440', '#d0ac6c', '#f4e2b0'),
  core: tn('#24140a', '#4a3018', '#6a4a24', '#8a6a3a'),
  eye: hx('#ffcf5a'),
};

type GhostArms = 'down' | 'up' | 'claw' | 'blast';
interface GhostPose {
  f: number;
  rise: number;
  arms: GhostArms;
  mound?: boolean;
}

function drawSandGhost(o: GhostPose): Built {
  const p = new Px(24, 27);
  const G = 25;
  const cx = 10;
  if (o.mound || o.rise <= 0.05) {
    // Бугор песка с рябью — бежит под полом.
    for (let x = 3; x <= 17; x++) {
      const u = (x - 10) / 7;
      const hgt = Math.max(0, Math.round((1 - u * u) * 4 + Math.sin(x * 1.3 + o.f) * 0.6));
      for (let y = 0; y < hgt; y++)
        p.set(
          x,
          G - 1 - y,
          y === hgt - 1 ? GHOST.sand[3] : y > hgt - 3 ? GHOST.sand[2] : GHOST.sand[1],
        );
    }
    for (let i = 0; i < 4; i++)
      p.set(5 + Math.floor(hash(i, o.f) * 12), G - 5 - Math.floor(hash(o.f, i) * 3), GHOST.sand[3]);
    p.outline(alpha(INK, 0.6));
    return { p, ax: cx, ay: G, eye: null };
  }
  const top = G - Math.round(21 * o.rise);
  // Хвост-струя до земли.
  for (let y = top + 10; y < G; y++) {
    const k = (y - top - 10) / Math.max(1, G - top - 10);
    const w = 3.5 - k * 1.5 + Math.sin(y * 0.9 + o.f * 1.7) * 0.6;
    for (let x = Math.floor(cx - w); x <= Math.ceil(cx + w - 1); x++) {
      const n = hash(x, y, o.f);
      if (n < 0.1 + k * 0.4) continue;
      p.set(x, y, n > 0.8 ? GHOST.sand[3] : n > 0.45 ? GHOST.sand[2] : GHOST.sand[1]);
    }
  }
  // Тело и капюшон.
  shadeEll(p, cx, top + 9, 5, 5.5, GHOST.sand, 0.05);
  shadeEll(p, cx + 0.5, top + 4.5, 3.9, 3.9, GHOST.sand, 0.12);
  // Тёмное лицо под капюшоном.
  shadeEll(p, cx + 1.6, top + 5.2, 2.3, 2.1, GHOST.core, -0.2);
  const arm = (x0: number, y0: number, x1: number, y1: number) => {
    limb(p, x0, y0, x1, y1, 1.4, 0.8, GHOST.sand, 0.1);
    for (let i = 0; i < 3; i++)
      p.set(Math.round(x1 + (hash(i, o.f, 5) - 0.5) * 2), Math.round(y1 + 1 + i), GHOST.sand[2]);
  };
  if (o.arms === 'up') {
    arm(cx - 3, top + 9, cx - 8, top + 3);
    arm(cx + 4, top + 9, cx + 9, top + 3);
  } else if (o.arms === 'claw') {
    arm(cx + 2, top + 8, cx + 9, top + 8);
    arm(cx - 1, top + 9, cx + 7, top + 11);
  } else if (o.arms === 'blast') {
    arm(cx + 2, top + 7, cx + 9, top + 6);
    for (let i = 0; i < 6; i++)
      p.set(cx + 10 + i, top + 5 + Math.floor(hash(i, o.f, 9) * 3), GHOST.sand[3]);
  } else {
    arm(cx - 3, top + 8, cx - 5, top + 13);
    arm(cx + 3, top + 8, cx + 5, top + 13);
  }
  // Песок осыпается с краёв — кадр живёт.
  for (let i = 0; i < 6; i++) {
    const x = cx - 5 + Math.floor(hash(i, o.f, 1) * 11);
    const y = top + 3 + Math.floor((hash(i, 2) * 10 + o.f * 2) % 14);
    p.set(x, y, GHOST.sand[3]);
  }
  p.outline(INK);
  p.set(cx + 1, top + 5, GHOST.eye);
  p.set(cx + 3, top + 5, GHOST.eye);
  return { p, ax: cx, ay: G, eye: [cx + 3, top + 5] };
}

registerMobPainter('f14_sand', (_m: Mob, pose: MobPose) => {
  const mode = pose.mode;
  const f = pose.frame % 4;
  let anim = 'idle';
  let fr = f;
  let o: GhostPose = { f, rise: 1, arms: 'down' };
  const gray = mode === 'f14_frozen';
  if (gray) {
    anim = 'tableau';
    fr = 0;
    o = { f: 1, rise: 1, arms: 'claw' };
  } else if (mode === 'f14_under') {
    anim = 'under';
    o = { f, rise: 0, arms: 'down', mound: true };
  } else if (mode === 'f14_sink') {
    anim = 'sink';
    fr = Math.min(3, Math.floor(pose.t / 0.09));
    o = { f: fr, rise: 1 - fr / 3.5, arms: 'up' };
  } else if (mode === 'f14_rise') {
    anim = 'rise';
    fr = Math.min(3, Math.floor(pose.t / 0.13));
    o = { f: fr, rise: 0.15 + fr / 3.4, arms: 'up' };
  } else if (mode === 'dying') {
    anim = 'dead';
    fr = deathK(pose);
    o = { f: fr, rise: Math.max(0, 1 - fr / 3), arms: 'up' };
  } else if (mode === 'windup' || mode === 'f14_blast') {
    anim = mode;
    fr = f % 2;
    o = { f: fr, rise: 1, arms: mode === 'windup' ? 'up' : 'blast' };
  } else if (mode === 'recover' && pose.t < 0.2) {
    anim = 'claw';
    fr = 0;
    o = { f: 0, rise: 1, arms: 'claw' };
  } else if (pose.anim === 'hurt') {
    anim = 'hurt';
    fr = 0;
    o = { f: 1, rise: 0.92, arms: 'up' };
  }
  return frameOf('f14_sand', pose, anim, fr, () => drawSandGhost(o), gray);
});

// ---------------------------------------------------------------------------
// Отмотчик: тело — песочные часы в латунной раме, песок бирюзовый; капюшон
// на верхней плите, руки-стрелки. Ранен — песок разгорается (окно перед
// отмоткой); отматывается — песок идёт вверх. Кадр 22×27, земля 25.
// ---------------------------------------------------------------------------

const RW_SAND = tn('#1e5a66', '#3aa0b0', '#7ce0ec', '#d8fcff');
const HOOD = tn('#0a0c14', '#181c2a', '#2a3042', '#44506a');

type RwArm = 'down' | 'up' | 'strike';
interface RwPose {
  f: number;
  legs: number;
  arm: RwArm;
  rew: boolean;
  hot: boolean;
  broken: boolean;
}

function drawRewinder(o: RwPose): Built {
  const p = new Px(22, 27);
  const G = 25;
  const cx = 10;
  // Ноги — латунные прутья.
  const st = [1.2, 0, -1.2, 0][o.legs % 4];
  limb(p, cx - 1.5, 18, cx - 2 - st, G - 1, 0.7, 0.6, BRASS);
  limb(p, cx + 1.5, 18, cx + 2 + st, G - 1, 0.7, 0.6, BRASS);
  p.set(Math.round(cx - 3 - st), G - 1, BRASS[0]);
  p.set(Math.round(cx + 3 + st), G - 1, BRASS[0]);
  // Корпус — песочные часы: отматывается — песок наверху растёт.
  const k = o.rew ? 0.25 + 0.2 * (o.f % 2) : 0.6 - (o.f % 4) * 0.04;
  hourglass(p, cx + 0.5, 5, 10, 14, k, !o.rew, o.f, {
    sand: o.rew || o.hot ? TEAL : RW_SAND,
    broken: o.broken,
    glow: o.hot || o.rew ? TEAL_GLOW : null,
  });
  if (o.rew) for (let y = 8; y < 17; y += 2) p.set(Math.floor(cx), y - (o.f % 2), TEAL_GLOW);
  // Капюшон на верхней плите.
  shadeEll(p, cx + 0.5, 3.2, 3.2, 2.7, HOOD, 0.1);
  const arm = (x0: number, y0: number, x1: number, y1: number) => {
    stroke(p, x0, y0, x1, y1, IRON[2]);
    const a = Math.atan2(y1 - y0, x1 - x0);
    poly(
      p,
      [
        [x1 + Math.cos(a) * 2, y1 + Math.sin(a) * 2],
        [x1 - Math.sin(a) * 1.2, y1 + Math.cos(a) * 1.2],
        [x1 + Math.sin(a) * 1.2, y1 - Math.cos(a) * 1.2],
      ],
      STEEL[3],
    );
  };
  if (o.arm === 'up') {
    arm(cx + 5, 9, cx + 8, 3);
    arm(cx - 4, 9, cx - 6, 13);
  } else if (o.arm === 'strike') {
    arm(cx + 5, 9, cx + 10, 12);
    arm(cx + 5, 10, cx + 10, 9);
  } else {
    arm(cx + 5, 9, cx + 7, 14);
    arm(cx - 4, 9, cx - 6, 14);
  }
  p.outline(INK);
  p.set(Math.round(cx + 1.5), 3, TEAL_GLOW);
  p.set(Math.round(cx + 2.5), 3, TEAL[3]);
  return { p, ax: cx, ay: G, eye: [Math.round(cx + 2), 3] };
}

registerMobPainter('f14_rewinder', (m: Mob, pose: MobPose) => {
  const mode = pose.mode;
  const f = pose.frame % 4;
  let anim = 'idle';
  let fr = f;
  let o: RwPose = { f, legs: 0, arm: 'down', rew: false, hot: false, broken: false };
  const gray = mode === 'f14_frozen';
  if (gray) {
    anim = 'tableau';
    fr = 0;
    o = { f: 0, legs: 1, arm: 'strike', rew: false, hot: false, broken: false };
  } else if (mode === 'f14_rewind') {
    anim = 'rew';
    fr = Math.floor(pose.t * 12) % 2;
    o = { f: fr, legs: 0, arm: 'up', rew: true, hot: true, broken: false };
  } else if (mode === 'f14_dazed') {
    anim = 'dazed';
    fr = Math.floor(pose.t * 6) % 4;
    o = { f: 0, legs: 0, arm: 'down', rew: false, hot: false, broken: true };
  } else if (mode === 'dying') {
    anim = 'dead';
    fr = deathK(pose);
    o = { f: 0, legs: 0, arm: 'down', rew: false, hot: false, broken: true };
  } else if (mode === 'windup') {
    anim = 'wind';
    fr = 0;
    o = { f: 0, legs: 0, arm: 'up', rew: false, hot: false, broken: false };
  } else if (mode === 'recover' && pose.t < 0.2) {
    anim = 'strike';
    fr = 0;
    o = { f: 0, legs: 0, arm: 'strike', rew: false, hot: false, broken: false };
  } else if (pose.anim === 'run') {
    anim = 'run';
    o = { f, legs: f, arm: 'down', rew: false, hot: false, broken: false };
  } else if (pose.anim === 'hurt') {
    anim = 'hurt';
    fr = 0;
    o = { f: 0, legs: 0, arm: 'up', rew: false, hot: false, broken: false };
  }
  // Ранен — окно перед отмоткой: песок уже светится.
  if (m.data.rwAt !== undefined && mode !== 'f14_rewind' && anim !== 'dead') {
    anim += '+';
    o.hot = true;
  }
  return frameOf(
    'f14_rewinder',
    pose,
    anim,
    fr,
    () => {
      const b = drawRewinder(o);
      if (anim === 'dazed') stars(b.p, b.ax, 1, 4, fr);
      if (anim === 'dead') b.p = scatter(b.p, fr, 5, [TEAL[3], BRASS[3], GLASS_HI]);
      return b;
    },
    gray,
  );
});

// ---------------------------------------------------------------------------
// Маятниковый жнец: высокий, в тёмном балахоне с латунной каймой; вместо
// лица в капюшоне — циферблат. Коса — маятник: латунный стержень с грузом
// и лезвие-полумесяц. Кадр 40×34, земля 32.
// ---------------------------------------------------------------------------

const REAP = {
  robe: tn('#08070c', '#16131e', '#282232', '#403850'),
  blade: tn('#3a4250', '#7a8898', '#c0ccd8', '#f4faff'),
  bone: hx('#d8ccb0'),
};

interface ReapPose {
  f: number;
  blade: number;
  hem: number;
  bow: number;
}

function drawReaper(o: ReapPose): Built {
  const p = new Px(40, 34);
  const G = 32;
  const cx = 17;
  // Балахон: трапеция с рваным подолом.
  const top = 10 + o.bow;
  polyShade(
    p,
    [
      [cx - 3, top],
      [cx + 3, top],
      [cx + 6, G - 1],
      [cx - 6, G - 1],
    ],
    REAP.robe,
    0.05,
  );
  for (let x = cx - 6; x <= cx + 6; x++) {
    const d = (hash(x, o.hem) > 0.5 ? 1 : 0) + ((x + o.hem) % 3 === 0 ? 1 : 0);
    for (let y = G - d; y < G; y++) clear(p, x, y);
  }
  // Латунная кайма по подолу и полам.
  for (let x = cx - 5; x <= cx + 5; x++) if ((x + o.hem) % 2) p.set(x, G - 3, BRASS[2]);
  for (let y = top + 3; y < G - 3; y++) p.set(cx + 1 + Math.floor((y - top) * 0.18), y, BRASS[1]);
  // Капюшон и циферблат вместо лица.
  shadeEll(p, cx + 1, top - 2, 4.4, 4.6, REAP.robe, 0.12);
  dialFace(p, cx + 2, top - 1.5, 3.2, (o.f / 4) * TAU, 1.2, {
    rim: tn('#2a1c0c', '#5a3c18', '#8a6424', '#c89a48'),
  });
  // Коса: стержень от рук к лезвию; угол — такт маятника.
  const hxp = cx + 4;
  const hyp = top + 6;
  const a = o.blade;
  const ang = -Math.PI / 2 + a * 1.25;
  const L = 13;
  const bx = hxp + Math.cos(ang) * L;
  const by = hyp + Math.sin(ang) * L * 0.8;
  stroke(p, hxp, hyp + 2, bx, by, BRASS[1], 1);
  stroke(p, hxp + 0.6, hyp + 1.5, bx + 0.6, by - 0.5, BRASS[3], 1);
  // Лезвие-полумесяц, изогнуто против хода.
  const perp = ang + (Math.PI / 2) * (a >= 0 ? 1 : -1);
  for (let i = 0; i <= 12; i++) {
    const k = i / 12;
    const r = 7.5 * (1 - k * 0.15);
    const aa = perp + (k - 0.2) * 2;
    const x = bx + Math.cos(aa) * r * 0.9;
    const y = by + Math.sin(aa) * r * 0.9;
    const w = 1.7 * (1 - Math.abs(k - 0.35) * 1.4);
    if (w > 0.3)
      p.ell(x, y, Math.max(0.5, w), Math.max(0.5, w), k < 0.5 ? REAP.blade[3] : REAP.blade[2]);
  }
  // Груз маятника на стержне.
  shadeEll(p, (hxp + bx) / 2, (hyp + by) / 2, 1.7, 1.7, BRASS, 0.2);
  // Руки — рукава и костяные кисти.
  limb(p, cx + 2, top + 4, hxp, hyp, 1.2, 0.9, REAP.robe);
  p.set(Math.round(hxp), Math.round(hyp), REAP.bone);
  p.set(Math.round(hxp + 1), Math.round(hyp), REAP.bone);
  p.outline(INK);
  return { p, ax: cx, ay: G, eye: null };
}

registerMobPainter('f14_reaper', (m: Mob, pose: MobPose) => {
  const mode = pose.mode;
  const f = pose.frame % 4;
  let anim = 'idle';
  let fr = f;
  let o: ReapPose = { f, blade: 0, hem: f, bow: 0 };
  const gray = mode === 'f14_frozen';
  if (gray) {
    anim = 'tableau';
    fr = 0;
    o = { f: 1, blade: 0.75, hem: 1, bow: 1 };
  } else if (mode === 'f14_swing') {
    // Лезвие в сторону такта: пока метка горит — занесено, потом — пролёт.
    const side = m.data.swSide ?? 1;
    const since = pose.t - (m.data.swAt ?? 0);
    const k = Math.min(1, Math.max(0, since / REAPER.warn));
    const pos = k < 0.8 ? -side * (0.4 + k * 0.5) : side * 0.9;
    anim = 'swing';
    fr = Math.round(pos * 4) + 4;
    o = { f: 0, blade: fr / 4 - 1, hem: 0, bow: 1 };
  } else if (mode === 'recover') {
    anim = 'rest';
    fr = 0;
    o = { f: 0, blade: 0.9, hem: 1, bow: 2 };
  } else if (mode === 'dying') {
    anim = 'dead';
    fr = deathK(pose);
    o = { f: 0, blade: 0.8, hem: 0, bow: 3 };
  } else if (pose.anim === 'run') {
    anim = 'run';
    o = { f, blade: Math.sin((f / 4) * TAU) * 0.15, hem: f, bow: 0 };
  } else if (pose.anim === 'hurt') {
    anim = 'hurt';
    fr = 0;
    o = { f: 0, blade: -0.3, hem: 2, bow: -1 };
  } else {
    // Покой: коса за спиной качается, как маятник.
    o = { f, blade: Math.sin((f / 4) * TAU) * 0.18, hem: 0, bow: 0 };
  }
  return frameOf(
    'f14_reaper',
    pose,
    anim,
    fr,
    () => {
      const b = drawReaper(o);
      if (anim === 'dead') b.p = scatter(b.p, fr, 9, [BRASS[3], ENAMEL[2], REAP.robe[2]]);
      return b;
    },
    gray,
  );
});

// ---------------------------------------------------------------------------
// Шестерёнчатый жук: панцирь — половина латунной шестерни, железные ножки,
// бирюзовый глаз; катится — целая шестерня. Кадр 20×16, земля 14.
// ---------------------------------------------------------------------------

interface BeetlePose {
  legs: number;
  roll: number;
  curl: number;
}

function drawBeetle(o: BeetlePose): Built {
  const p = new Px(20, 16);
  const G = 14;
  const cx = 9;
  if (o.roll >= 0) {
    cog(p, cx, 7.5, 6.4, 10, (o.roll / 4) * (TAU / 10), BRASS, {
      hole: 1.5,
      spokes: 0,
      dark: BRASS[0],
    });
    p.outline(INK);
    p.set(cx + 2, 6, TEAL_GLOW);
    return { p, ax: cx, ay: G, eye: [cx + 2, 6] };
  }
  // Ножки: три пары, шаг.
  for (let i = 0; i < 3; i++) {
    const x = cx - 3 + i * 3;
    const s = ((o.legs + i) % 2 ? 1 : -1) * 0.8;
    stroke(p, x, 10, x + s - 1, G - 1, IRON[2]);
    p.set(Math.round(x + s - 1), G - 1, IRON[3]);
  }
  // Панцирь — половина шестерни зубьями вверх.
  const tmp = new Px(20, 16);
  cog(tmp, cx, 11, 6.4 - o.curl * 0.6, 10, 0.16, BRASS, { hole: 1.2, spokes: 0 });
  for (let y = 0; y <= 11; y++)
    for (let x = 0; x < 20; x++) if (tmp.solid(x, y)) p.set(x, y, tmp.get(x, y));
  // Брюшко и голова.
  p.rect(cx - 5, 10, cx + 4, 11, IRON[1]);
  shadeEll(p, cx + 6, 9.5, 2, 1.8, IRON, 0.1);
  stroke(p, cx + 7.5, 10.5, cx + 9, 11.5, IRON[3]);
  p.outline(INK);
  p.set(cx + 6, 9, TEAL_GLOW);
  return { p, ax: cx, ay: G, eye: [cx + 6, 9] };
}

registerMobPainter('f14_beetle', (_m: Mob, pose: MobPose) => {
  const mode = pose.mode;
  const f = pose.frame % 4;
  let anim = 'idle';
  let fr = f;
  let o: BeetlePose = { legs: 0, roll: -1, curl: 0 };
  if (mode === 'f14_roll') {
    anim = 'roll';
    fr = Math.floor(pose.t * 24) % 4;
    o = { legs: 0, roll: fr, curl: 0 };
  } else if (mode === 'f14_curl') {
    anim = 'curl';
    fr = Math.min(2, Math.floor(pose.t / 0.2));
    o = { legs: 0, roll: fr >= 2 ? 0 : -1, curl: fr };
  } else if (mode === 'dying') {
    anim = 'dead';
    fr = deathK(pose);
  } else if (mode === 'dizzy') {
    anim = 'dizzy';
    fr = Math.floor(pose.t * 6) % 4;
  } else if (pose.anim === 'run') {
    anim = 'run';
    o = { legs: f, roll: -1, curl: 0 };
  } else if (pose.anim === 'wind') {
    anim = 'wind';
    fr = 0;
    o = { legs: 1, roll: -1, curl: 1 };
  } else fr = 0;
  return frameOf('f14_beetle', pose, anim, fr, () => {
    const b = drawBeetle(o);
    if (anim === 'dizzy') stars(b.p, b.ax, 2, 4, fr);
    if (anim === 'dead') b.p = scatter(b.p, fr, 11, [BRASS[3], IRON[3], TEAL_GLOW]);
    return b;
  });
});

// ---------------------------------------------------------------------------
// Хранитель стрелок: шлем-колокол со шпилем, тёмно-синий сюртук с латунью,
// на груди — циферблат (стрелки идут). В руках — минутная стрелка-копьё и
// часовая стрелка-булава. Кадр 32×34, земля 32.
// ---------------------------------------------------------------------------

type KeeperClub = 'rest' | 'up' | 'down';
interface KeeperPose {
  f: number;
  legs: number;
  lance: number;
  club: KeeperClub;
  spin: boolean;
}

function drawKeeper(o: KeeperPose): Built {
  const p = new Px(32, 34);
  const G = 32;
  const cx = 13;
  const LEG = tn('#08080e', '#14141e', '#24242e', '#3a3a48');
  // Ноги.
  const st = [1.4, 0, -1.4, 0][o.legs % 4];
  limb(p, cx - 2, 24, cx - 2 - st, G - 1, 1.8, 1.5, LEG);
  limb(p, cx + 2, 24, cx + 2 + st, G - 1, 1.8, 1.5, LEG, 0.1);
  p.rect(cx - 4 - Math.round(st), G - 1, cx - Math.round(st), G - 1, hx('#0a0808'));
  p.rect(cx + 1 + Math.round(st), G - 1, cx + 4 + Math.round(st), G - 1, hx('#0a0808'));
  // Часовая стрелка-булава: ромб на железной рукояти.
  const club = (x0: number, y0: number, x1: number, y1: number) => {
    stroke(p, x0, y0, x1, y1, IRON[2], 2);
    poly(
      p,
      [
        [x1 - 2.4, y1],
        [x1, y1 - 3],
        [x1 + 2.4, y1],
        [x1, y1 + 3],
      ],
      BRASS[2],
    );
    p.set(Math.round(x1), Math.round(y1), BRASS[0]);
    p.set(Math.round(x1 - 1), Math.round(y1 - 1), BRASS[3]);
  };
  if (o.club === 'up') club(cx - 5, 13, cx - 3, 1.5);
  else if (o.club === 'rest') club(cx - 6, 15, cx - 10, 23);
  // Сюртук.
  polyShade(
    p,
    [
      [cx - 6, 11],
      [cx + 6, 11],
      [cx + 7, 26],
      [cx - 7, 26],
    ],
    NAVY,
    0.05,
  );
  for (let y = 12; y < 26; y++) {
    p.set(cx - 6 - (y > 22 ? 1 : 0), y, BRASS[1]);
    p.set(cx + 6 + (y > 22 ? 1 : 0), y, BRASS[2]);
  }
  // Эполеты.
  shadeEll(p, cx - 5.5, 11.5, 2, 1.3, BRASS, 0.2);
  shadeEll(p, cx + 5.5, 11.5, 2, 1.3, BRASS, 0.2);
  // Циферблат на груди: переводит — стрелки бегут, светится.
  dialFace(
    p,
    cx,
    18,
    5,
    o.spin ? (o.f / 4) * TAU * 3 : (o.f / 16) * TAU,
    o.spin ? (o.f / 4) * TAU : 2.2,
    {
      glow: o.spin ? AMBER : null,
    },
  );
  // Шлем-колокол со шпилем, щель глаз.
  polyShade(
    p,
    [
      [cx - 5, 10],
      [cx + 5, 10],
      [cx + 3.5, 3.5],
      [cx - 3.5, 3.5],
    ],
    BRASS,
    0.1,
  );
  shadeEll(p, cx, 4, 3.6, 1.8, BRASS, 0.2);
  stroke(p, cx, 2.5, cx, 0.5, BRASS[3]);
  p.rect(cx - 3, 7, cx + 3, 7, INK);
  if (o.club === 'down') club(cx + 4, 15, cx + 11, 22);
  // Минутная стрелка-копьё (правая рука): угол `lance`.
  const la = o.lance;
  const lx0 = cx + 6;
  const ly0 = 16;
  const lx1 = lx0 + Math.cos(la) * 12;
  const ly1 = ly0 + Math.sin(la) * 12;
  stroke(p, lx0, ly0, lx1, ly1, BRASS[2]);
  stroke(p, lx0, ly0 + 1, lx1, ly1 + 1, BRASS[0]);
  const ax = Math.cos(la);
  const ay = Math.sin(la);
  poly(
    p,
    [
      [lx1 + ax * 3.5, ly1 + ay * 3.5],
      [lx1 - ay * 1.9, ly1 + ax * 1.9],
      [lx1 + ay * 1.9, ly1 - ax * 1.9],
    ],
    BRASS[3],
  );
  shadeEll(p, lx0, ly0, 1.4, 1.4, SKIN, 0.1);
  p.outline(INK);
  p.set(cx + 1, 7, AMBER);
  p.set(cx + 2, 7, hx('#fff0b0'));
  return { p, ax: cx, ay: G, eye: [cx + 2, 7] };
}

registerMobPainter('f14_keeper', (_m: Mob, pose: MobPose) => {
  const mode = pose.mode;
  const f = pose.frame % 16;
  let anim = 'idle';
  let fr = f;
  let o: KeeperPose = { f, legs: 0, lance: 0.9, club: 'rest', spin: false };
  const gray = mode === 'f14_frozen';
  if (gray) {
    anim = 'tableau';
    fr = 0;
    o = { f: 3, legs: 1, lance: 0.2, club: 'up', spin: false };
  } else if (mode === 'f14_hour') {
    const down = pose.t > 0.62;
    anim = down ? 'hourD' : 'hourU';
    fr = 0;
    o = { f: 0, legs: 0, lance: 1.3, club: down ? 'down' : 'up', spin: false };
  } else if (mode === 'f14_minute') {
    anim = 'min';
    fr = Math.min(2, Math.floor(pose.t / 0.18));
    o = { f: 0, legs: 0, lance: -0.55 + fr * 0.55, club: 'rest', spin: false };
  } else if (mode === 'f14_haste') {
    anim = 'haste';
    fr = Math.floor(pose.t * 12) % 4;
    o = { f: fr, legs: 0, lance: 1, club: 'rest', spin: true };
  } else if (mode === 'dying') {
    anim = 'dead';
    fr = deathK(pose);
  } else if (pose.anim === 'run') {
    anim = 'run';
    fr = f % 4;
    o = { f, legs: fr, lance: 0.9, club: 'rest', spin: false };
  } else if (pose.anim === 'hurt') {
    anim = 'hurt';
    fr = 0;
    o = { f: 0, legs: 0, lance: 1.4, club: 'rest', spin: false };
  }
  return frameOf(
    'f14_keeper',
    pose,
    anim,
    fr,
    () => {
      const b = drawKeeper(o);
      if (anim === 'dead') b.p = scatter(b.p, fr, 13, [BRASS[3], ENAMEL[3], NAVY[2]]);
      return b;
    },
    gray,
  );
});

// ---------------------------------------------------------------------------
// Двойник из прошлого: лист самого героя в сепии, сквозь него шахматкой
// проступает пол, по краю — золотой кант. Ступень — как у героя (из стора,
// ленивым импортом, как у этажа 7).
// ---------------------------------------------------------------------------

let gearGet: (() => number) | null = null;
let gearAsked = false;
function heroTier(): number {
  if (!gearAsked && typeof window !== 'undefined') {
    gearAsked = true;
    void import('../../store')
      .then((S) => {
        gearGet = () => S.useFinanceStore.getState().dungeon?.gear?.robe?.tier ?? 8;
      })
      .catch(() => undefined);
  }
  return gearGet?.() ?? 8;
}

const dirOf = (face: number): Dir4 => {
  const c = Math.cos(face);
  const s = Math.sin(face);
  return Math.abs(c) > Math.abs(s) * 1.1 ? (c < 0 ? 'left' : 'right') : s < 0 ? 'up' : 'down';
};

function pastSelf(tier: number, dir: Dir4, row: number, fade: number): Px | null {
  const c = heroSprite(tier, dir, row);
  if (!c) return null;
  const g = c.getContext('2d');
  if (!g) return null;
  const img = g.getImageData(0, 0, c.width, c.height);
  const p = new Px(c.width + 4, c.height + 4);
  // Засвеченная плёнка: светлота — своя у каждого пикселя героя (форма и
  // забрало читаются), цвет — бледный янтарь; второй отпечаток со сдвигом —
  // двойная экспозиция. Сепия по тонам уводила тёмный доспех Т8 в бурую
  // бочку, а свои цвета с янтарём давали оливковое пятно — ни то ни другое
  // не узнавалось как «я». Контур — золото.
  const PALE = hx('#ffe6a8');
  const DEEP = hx('#5a3a14');
  const px = (x: number, y: number): RGBA | null => {
    const i = (y * c.width + x) * 4;
    if (!img.data[i + 3]) return null;
    const l = Math.min(
      1,
      ((img.data[i] * 0.3 + img.data[i + 1] * 0.55 + img.data[i + 2] * 0.15) / 255) * 1.5 + 0.12,
    );
    return l < 0.2 ? DEEP : mixc(DEEP, PALE, l);
  };
  // Отпечаток прошлого кадра: на пиксель выше и левее, еле виден.
  for (let y = 0; y < c.height; y++)
    for (let x = 0; x < c.width; x++) {
      const o = px(x, y);
      if (o) p.set(x + 1, y + 1, alpha(PALE, 0.26 * fade));
    }
  for (let y = 0; y < c.height; y++)
    for (let x = 0; x < c.width; x++) {
      const o = px(x, y);
      if (!o) continue;
      const line = y % 4 === 3;
      p.set(x + 2, y + 2, alpha(o, (line ? 0.66 : 0.88) * fade));
    }
  p.outline(hx('#ffcf5a', 210));
  return p;
}

registerMobPainter('f14_double', (m: Mob, pose: MobPose) => {
  const tier = heroTier();
  const dir = dirOf(m.face);
  const now = paintSim()?.time ?? 0;
  const since = pose.mode !== 'dying' && m.data.swing !== undefined ? now - m.data.swing : 9;
  const sp = Math.hypot(m.vx, m.vy);
  const row = since < 0.3 ? 4 : sp > 0.4 ? pose.frame % 4 : 0;
  const dk = pose.mode === 'dying' ? deathK(pose) : 0;
  const key = `f14_double|${tier}|${dir}|${row}|${pose.flash ? 1 : 0}|${dk}`;
  const hit = frames.get(key);
  if (hit) return hit;
  const p = pastSelf(tier, dir, row, 1 - dk * 0.22);
  if (!p) return null;
  let q = p;
  if (dk) q = scatter(q, dk, 17, [hx('#ffe9a0'), hx('#fff4c8')]);
  if (pose.flash) q = q.tint(WHITE, 0.85);
  const out: MobFrame = { img: q.canvas(), ax: 10, ay: 18, eye: null };
  frames.set(key, out);
  return out;
});

// ---------------------------------------------------------------------------
// Гиря: чугунный цилиндр с латунными обручами и кольцом, цепь уходит вверх.
// Висит — высоко над своей тенью; падает — ниже; лежит — на полу, вокруг
// пыль. Кадр 20×72, земля 68.
// ---------------------------------------------------------------------------

function drawWeight(height: number, shake: number, down: boolean): Built {
  const p = new Px(20, 72);
  const G = 68;
  const cx = 10 + shake;
  const bottom = G - height;
  const top = bottom - 15;
  // Цепь вверх: звенья вдоль и поперёк.
  for (let y = 0; y < top - 2; y++) {
    const link = Math.floor(y / 2) % 2;
    if (link) p.set(Math.round(cx), y, IRON[3]);
    else {
      p.set(Math.round(cx) - 1, y, IRON[1]);
      p.set(Math.round(cx) + 1, y, IRON[2]);
    }
  }
  // Кольцо.
  p.ell(cx, top - 1.5, 2.2, 1.8, IRON[2]);
  for (let y = top - 2; y <= top - 1; y++) clear(p, Math.round(cx), y);
  // Цилиндр.
  for (let y = top; y <= bottom; y++)
    for (let x = Math.round(cx - 5); x <= Math.round(cx + 4); x++) {
      const u = (x + 0.5 - cx) / 5;
      p.set(x, y, tone(IRON, -u * 0.8 + 0.45 + (y === top ? 0.35 : 0)));
    }
  // Латунные обручи и клеймо гири.
  for (const y of [top + 1, bottom - 2])
    for (let x = Math.round(cx - 5); x <= Math.round(cx + 4); x++)
      p.set(x, y, tone(BRASS, -((x + 0.5 - cx) / 5) * 0.8 + 0.5));
  p.rect(Math.round(cx - 2), top + 6, Math.round(cx), top + 6, BRASS[2]);
  p.rect(Math.round(cx - 1), top + 7, Math.round(cx - 1), top + 8, BRASS[1]);
  p.outline(INK);
  if (down) {
    // Пыль и крошка вокруг основания.
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU;
      p.set(Math.round(cx + Math.cos(a) * 7), Math.round(G - 1 + Math.sin(a) * 1.5), hx('#8a7a6a'));
    }
  }
  return { p, ax: 10, ay: G, eye: null };
}

registerMobPainter('f14_weight', (_m: Mob, pose: MobPose) => {
  const mode = pose.mode;
  let h = 24;
  let shake = 0;
  let down = false;
  if (mode === 'f14_lock') shake = Math.round(Math.sin(pose.t * 60));
  else if (mode === 'f14_fall') h = Math.max(0, 24 * (1 - Math.min(1, pose.t / 0.18)));
  else if (mode === 'f14_down' || mode === 'dying') {
    h = 0;
    down = true;
  } else if (mode === 'f14_up') h = Math.min(24, 24 * (pose.t / 0.8));
  const hb = Math.round(h / 2) * 2;
  const dk = mode === 'dying' ? deathK(pose) : 0;
  return frameOf('f14_weight', pose, `h${hb}${down ? 'd' : ''}`, (shake + 1) * 10 + dk, () => {
    const b = drawWeight(hb, shake, down);
    if (dk) b.p = scatter(b.p, dk, 21, [IRON[3], BRASS[3]]);
    return b;
  });
});

// ---------------------------------------------------------------------------
// Часовщик (редкий): сгорбленный старик в зелёном козырьке, с моноклем и
// мешком часов за спиной. Переводит свои часы — мигает шахматкой.
// Кадр 20×23, земля 21.
// ---------------------------------------------------------------------------

function drawSmith(o: { legs: number; blink: number }): Built {
  const p = new Px(20, 23);
  const G = 21;
  const cx = 9;
  const st = [1.2, 0, -1.2, 0][o.legs % 4];
  limb(p, cx - 1, 16, cx - 1 - st, G - 1, 1, 0.9, tn('#1a1410', '#34281e', '#4e3e2e', '#6a5642'));
  limb(p, cx + 1, 16, cx + 1 + st, G - 1, 1, 0.9, tn('#22180e', '#3e2e1e', '#5a4430', '#76604a'));
  // Мешок за спиной — из него торчат циферблаты.
  shadeEll(p, cx - 4, 11, 4, 4.4, tn('#3a2a14', '#6a5028', '#9a7a44', '#c8a468'), 0.05);
  dialFace(p, cx - 5, 7.5, 2.4, 0.8, 2.4);
  dialFace(p, cx - 2, 7, 1.8, 2.2, 4);
  // Туловище и фартук.
  polyShade(
    p,
    [
      [cx - 2, 9],
      [cx + 3, 9],
      [cx + 4, 17],
      [cx - 2, 17],
    ],
    tn('#1c2a1c', '#2e4430', '#46644a', '#6a8a6e'),
    0.05,
  );
  p.rect(cx, 11, cx + 3, 16, hx('#7a5a3a'));
  p.set(cx + 1, 12, BRASS[3]);
  // Голова: седина, борода, козырёк, монокль.
  shadeEll(p, cx + 2, 6.5, 2.6, 2.6, SKIN, 0.1);
  p.rect(cx + 1, 8, cx + 4, 9, hx('#e8e4dc'));
  p.rect(cx - 0.5, 4, cx + 4.5, 4, hx('#2a8a4a'));
  p.set(cx + 5, 4, hx('#4ab86a'));
  p.outline(INK);
  p.set(cx + 3, 6, hx('#fff0a0'));
  p.set(cx + 4, 6, BRASS[3]);
  if (o.blink > 0)
    for (let y = 0; y < p.h; y++)
      for (let x = 0; x < p.w; x++) if ((x + y + o.blink) % 2 === 0) clear(p, x, y);
  return { p, ax: cx, ay: G, eye: [cx + 3, 6] };
}

registerMobPainter('f14_smith', (_m: Mob, pose: MobPose) => {
  const f = pose.frame % 4;
  let anim = 'idle';
  let fr = f;
  let o = { legs: 0, blink: 0 };
  if (pose.mode === 'f14_blink') {
    anim = 'blink';
    fr = Math.floor(pose.t * 20) % 2;
    o = { legs: 0, blink: 1 + fr };
  } else if (pose.mode === 'dying') {
    anim = 'dead';
    fr = deathK(pose);
  } else if (pose.anim === 'run' || pose.mode === 'flee') {
    anim = 'run';
    o = { legs: f, blink: 0 };
  }
  return frameOf('f14_smith', pose, anim, fr, () => {
    const b = drawSmith(o);
    if (anim === 'dead') b.p = scatter(b.p, fr, 23, [BRASS[3], hx('#ffd040')]);
    return b;
  });
});

// ---------------------------------------------------------------------------
// Повелитель часа (анимация тела — v2.87). Облик прежний: высокий, в длинном
// балахоне с латунной каймой; голова — башенный циферблат в латунном безеле
// со шпилями, за головой ходит шестерня-нимб; в груди за стеклом качается
// маятник. В правой — минутная стрелка-клинок (кольцо-противовес), в левой —
// часовая стрелка-лист. Фаза меняет материал: ночная синь (ДВЕ СТРЕЛКИ), иней
// (ОСТАНОВКА), бирюза и песок (ОТМОТКА), полночь со звёздами (ПОЛНОЧЬ).
//
// Движение — «часовое»: покой и шаг ТИКАЮТ (стрелки на лице щёлкают по такту
// с отскоком, нимб доворачивается на треть зуба, маятник в груди ходит
// тик-так), а удары идут по дуге циферблата: часовая обходит круг через
// голову и рубит со следом, минутная целится, колет и застревает в полу.
//
// Тело — риг из чисел (`LRig`): корпус (наклон, присед, поворот), голова,
// две руки с клинками, песочные часы, ступни. Техника — ключевые позы на оси
// времени МОЗГА (`LORD` в `f14-brains.ts` — метроном), кадр — 24 к/с от
// `pose.t`, между ключами — кривые разгона и торможения; полы, маятник и
// голова отстают на 1–2 кадра сами (`LLAG`). Кадр контакта — кадр, в
// котором мозг бьёт. След клинка — серп по выборкам рига в прошлом.
// Кадры — в `frameLRU`. Влево — своим кадром, а не `sx < 0`: лицо — сам
// Повелитель, и отражённый циферблат шёл бы против часовой. Прогрев первой
// фазы в обе стороны — `registerMobWarm`. Холст 120×112, земля 86,
// обрезается по нарисованному.
// ---------------------------------------------------------------------------

interface LordLook {
  robe: Tones;
  trim: Tones;
  face: Tones;
  glow: RGBA;
  hand: RGBA;
  halo: Tones;
}

const LORD_LOOK: LordLook[] = [
  {
    robe: tn('#07080f', '#121828', '#1e2a44', '#34466a'),
    trim: BRASS,
    face: ENAMEL,
    glow: AMBER,
    hand: INK,
    halo: tn('#1e1208', '#3e2a12', '#6a4a1e', '#9a7236'),
  },
  {
    robe: tn('#10161e', '#222c3a', '#3a4a60', '#6e86a4'),
    trim: tn('#3a4250', '#7a8898', '#c0ccd8', '#f4faff'),
    face: tn('#8a98b0', '#c4d0e4', '#e8f0fc', '#ffffff'),
    glow: hx('#d8e8ff'),
    hand: hx('#16203a'),
    halo: tn('#1a2230', '#34404e', '#56647a', '#8a9ab0'),
  },
  {
    robe: tn('#051418', '#0c2a30', '#16444c', '#28707a'),
    trim: BRASS,
    face: tn('#5a9aa4', '#9ad4dc', '#d0f4f8', '#f4ffff'),
    glow: TEAL_GLOW,
    hand: hx('#0a2a30'),
    halo: tn('#0a2024', '#163c44', '#246068', '#3a8a94'),
  },
  {
    robe: tn('#030308', '#0a0916', '#16132c', '#28224a'),
    trim: tn('#3a3e50', '#7a8098', '#c0c6dc', '#f4f6ff'),
    face: tn('#080c20', '#101838', '#1c2a58', '#34487e'),
    glow: hx('#c8d8ff'),
    hand: hx('#eef4ff'),
    halo: tn('#0c0c1a', '#1a1a30', '#2c2c4c', '#46466e'),
  },
];

/** Минутная стрелка-клинок: кольцо-противовес, ажурный ромб, остриё. */
function minuteHand(
  p: Px,
  x: number,
  y: number,
  ang: number,
  len: number,
  t: Tones,
  glow: RGBA | null,
): void {
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  // Хвост с кольцом за кистью.
  const tx = x - ux * 4.5;
  const ty = y - uy * 4.5;
  limb(p, tx, ty, x + ux * (len - 5), y + uy * (len - 5), 1.1, 0.8, t, 0.1);
  shadeEll(p, tx, ty, 2, 2, t, 0.15);
  p.set(Math.round(tx), Math.round(ty), INK);
  // Ажурный ромб на середине.
  const mx = x + ux * len * 0.5;
  const my = y + uy * len * 0.5;
  poly(
    p,
    [
      [mx - ux * 3, my - uy * 3],
      [mx - uy * 2, my + ux * 2],
      [mx + ux * 3, my + uy * 3],
      [mx + uy * 2, my - ux * 2],
    ],
    t[2],
  );
  p.set(Math.round(mx), Math.round(my), INK);
  // Остриё стрелкой.
  const bx = x + ux * (len - 5);
  const by = y + uy * (len - 5);
  poly(
    p,
    [
      [bx + ux * 6, by + uy * 6],
      [bx - uy * 2.6, by + ux * 2.6],
      [bx - ux * 0.5, by - uy * 0.5],
      [bx + uy * 2.6, by - ux * 2.6],
    ],
    t[2],
  );
  // Кромка — светлая линия вдоль клинка; остриё светится цветом фазы.
  stroke(p, x - uy * 0.8, y + ux * 0.8, bx + ux * 5 - uy * 0.3, by + uy * 5 + ux * 0.3, t[3]);
  if (glow) p.set(Math.round(bx + ux * 5), Math.round(by + uy * 5), glow);
}

/** Часовая стрелка: короткий широкий лист с прорезью-сердцем. */
function hourHand(p: Px, x: number, y: number, ang: number, len: number, t: Tones): void {
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  limb(p, x - ux * 2, y - uy * 2, x + ux * len * 0.45, y + uy * len * 0.45, 1.2, 1, t, 0.1);
  // Лист: ширина растёт к двум третям и сходится в остриё; длиннее — шире.
  const n = 14;
  const wk = Math.max(1, Math.min(1.45, len / 15));
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    const w = 3.6 * wk * Math.sin(Math.min(1, k * 1.25) * Math.PI) * (k < 0.8 ? 1 : (1 - k) * 5);
    const cxp = x + ux * len * (0.4 + k * 0.6);
    const cyp = y + uy * len * (0.4 + k * 0.6);
    if (w > 0.4)
      p.ell(cxp, cyp, w * 0.7, w * 0.7, (xx, yy) =>
        tone(t, 0.55 - ((xx - cxp) * -uy + (yy - cyp) * ux) * 0.18),
      );
  }
  // Прорезь.
  const hx0 = x + ux * len * 0.66;
  const hy0 = y + uy * len * 0.66;
  p.set(Math.round(hx0), Math.round(hy0), INK);
  p.set(Math.round(hx0 + ux), Math.round(hy0 + uy), INK);
  p.set(Math.round(x + ux * len), Math.round(y + uy * len), t[3]);
}

const LW = 120;
const LH = 112;
const LG = 86;
const LCX = 60;
const LFPS = 24;
const LF1 = 1 / LFPS;
const INK4: Tones = [INK, INK, INK, INK];

const lclamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
type LEase = (x: number) => number;
const lLin: LEase = (x) => x;
const lIn: LEase = (x) => x * x;
const lIn3: LEase = (x) => x * x * x;
const lOut: LEase = (x) => 1 - (1 - x) * (1 - x);
const lOut3: LEase = (x) => 1 - (1 - x) * (1 - x) * (1 - x);
const lIO: LEase = (x) => (x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) * (1 - x));

/** Холст, который умеет не рисовать вне области (клинок, вошедший в пол). */
class ClipPx extends Px {
  clip: ((x: number, y: number) => boolean) | null = null;
  set(x: number, y: number, c: RGBA | null): void {
    if (this.clip && !this.clip(Math.round(x), Math.round(y))) return;
    super.set(x, y, c);
  }
  /** Контур снаружи фигуры — прямо по массиву (кадр босса большой). */
  outline(c: RGBA): void {
    const { w, h, data: d } = this;
    const add: number[] = [];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (d[i * 4 + 3]) continue;
        if (
          (x > 0 && d[i * 4 - 1]) ||
          (x < w - 1 && d[i * 4 + 7]) ||
          (y > 0 && d[(i - w) * 4 + 3]) ||
          (y < h - 1 && d[(i + w) * 4 + 3])
        )
          add.push(i);
      }
    for (const i of add) {
      d[i * 4] = c[0];
      d[i * 4 + 1] = c[1];
      d[i * 4 + 2] = c[2];
      d[i * 4 + 3] = 255;
    }
  }
}

/**
 * Каналы рига. Точки — от середины ступней (LCX, LG), y вверх — минус.
 *   корпус: lean (наклон верха, px на 34 px роста), drop (присед), tw
 *     (доворот к цели −1…1), hem (полы — отстают сами), turn (полный оборот
 *     вокруг себя 0…1: вид спереди, сбоку, со спины), pend (маятник в груди);
 *   голова: hx, hy (сдвиг), hd (наклон шпилей), halo (поворот нимба), hs
 *     (нимб больше — удар колокола), fm, fh (стрелки лица: 0 — XII, по
 *     часовой; fdir — стрелки УКАЗЫВАЮТ на цель, а не идут, и при взгляде
 *     влево отражаются вместе с телом), glow (накал лица), white (белеет),
 *     dim (гаснет), crack;
 *   руки: f* — правая с минутной, b* — левая с часовой: кисть (x, y), угол
 *     клинка, длина, изгиб локтя (−1…1), перед телом (z), клинок в полу
 *     (pin: 1 — держит воткнутый, 2 — воткнут и брошен, 3 — выронен),
 *     точка в полу, накал клинка;
 *   песочные часы: gl (в руках), gx, gy, gr (поворот), gk (песка вверху),
 *     gc (трещины 0…3), gs (проявление 0…1);
 *   ступни: lf, rf (вперёд-назад), lfy, rfy (подняты);
 *   кадр целиком (поля движка): sx, sy, rot, dx, dy, op (прозрачность).
 */
const LK = [
  'lean',
  'drop',
  'tw',
  'hem',
  'turn',
  'pend',
  'hx',
  'hy',
  'hd',
  'halo',
  'hs',
  'fm',
  'fh',
  'fdir',
  'glow',
  'white',
  'dim',
  'crack',
  'fx',
  'fy',
  'fa',
  'fl',
  'fe',
  'fz',
  'fpin',
  'fpx',
  'fpy',
  'fglow',
  'bx',
  'by',
  'ba',
  'bl',
  'be',
  'bz',
  'bpin',
  'bpx',
  'bpy',
  'bglow',
  'gl',
  'gx',
  'gy',
  'gr',
  'gk',
  'gc',
  'gs',
  'lf',
  'rf',
  'lfy',
  'rfy',
  'sx',
  'sy',
  'rot',
  'dx',
  'dy',
  'op',
] as const;
type LKey = (typeof LK)[number];
type LRig = Record<LKey, number>;

/** Стойка: минутная вниз-вперёд, часовая вниз-назад (как было). */
const L0: LRig = {
  lean: 0,
  drop: 0,
  tw: 0,
  hem: 0,
  turn: 0,
  pend: 0,
  hx: 0,
  hy: 0,
  hd: 0,
  halo: 0,
  hs: 0,
  fm: 0,
  fh: 1.9,
  fdir: 0,
  glow: 0.5,
  white: 0,
  dim: 0,
  crack: 0,
  fx: 8,
  fy: -18,
  fa: 1.05,
  fl: 24,
  fe: -1,
  fz: 1,
  fpin: 0,
  fpx: 0,
  fpy: 0,
  fglow: 0,
  bx: -9,
  by: -18,
  ba: 2.0,
  bl: 15,
  be: 1,
  bz: 0,
  bpin: 0,
  bpx: 0,
  bpy: 0,
  bglow: 0,
  gl: 0,
  gx: 0,
  gy: -26,
  gr: 0,
  gk: 0,
  gc: 0,
  gs: 1,
  lf: 3,
  rf: -4,
  lfy: 0,
  rfy: 0,
  sx: 1,
  sy: 1,
  rot: 0,
  dx: 0,
  dy: 0,
  op: 1,
};

type LKf = [number, Partial<LRig>, LEase?];

/** Каналы «да/нет» и точки, которые меняются скачком. */
const LSTEP = new Set<LKey>(['fz', 'bz', 'fpin', 'bpin', 'fpx', 'fpy', 'bpx', 'bpy', 'gl', 'fdir']);
/** Запаздывание частей: полы, маятник, голова смотрят позу чуть в прошлом. */
const LLAG: Partial<Record<LKey, number>> = { hem: 0.07, pend: 0.1, hx: 0.04, hy: 0.04 };

/**
 * Ключевые позы: ключ меняет только названные каналы, остальные держат
 * значение прошлого ключа. Между ключами — кривая следующего ключа.
 */
function ltrack(keys: LKf[], t: number, base: LRig = L0): LRig {
  const out = { ...base };
  if (!keys.length) return out;
  for (const ch of LK) {
    const lag = LLAG[ch];
    const tt = lag ? Math.max(0, t - lag) : t;
    let pt = keys[0][0];
    let pv = keys[0][1][ch] ?? base[ch];
    let v = pv;
    if (tt > pt)
      for (let i = 1; i < keys.length; i++) {
        const [kt, kv, ke] = keys[i];
        const cv = kv[ch] ?? pv;
        if (tt < kt) {
          v = LSTEP.has(ch)
            ? pv
            : pv + (cv - pv) * (ke ?? lIO)(lclamp((tt - pt) / (kt - pt || 1), 0, 1));
          break;
        }
        pt = kt;
        pv = cv;
        v = cv;
      }
    out[ch] = v;
  }
  return out;
}

/** Смесь двух поз (возврат к стойке). Скачковые каналы — по половине. */
function lmix(a: LRig, b: LRig, k: number): LRig {
  const o = { ...a };
  for (const ch of LK)
    o[ch] = LSTEP.has(ch) ? (k < 0.5 ? a[ch] : b[ch]) : a[ch] + (b[ch] - a[ch]) * k;
  return o;
}

/** Точка на полу по направлению `A` на `dist` px (кадр 3/4: глубина ×0,6). */
const lFloor = (A: number, dist: number): [number, number] => [
  Math.cos(A) * dist,
  Math.sin(A) * dist * 0.6,
];

// ---- Геометрия кадра ----

interface LGeo {
  sh: (y: number) => number;
  top: number;
  /** Поворот вокруг себя: c — к зрителю лицом, s — боком. */
  c: number;
  s: number;
  hx: number;
  hy: number;
  sF: [number, number];
  sB: [number, number];
  hF: [number, number];
  hB: [number, number];
}

function lGeo(r: LRig): LGeo {
  const d = r.drop;
  const sh = (y: number) => (r.lean * (LG - y)) / 34;
  const top = LG - 32 + d;
  const a = r.turn * TAU;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const tw = r.turn ? 0 : r.tw;
  const hy = LG - 43 + d + r.hy;
  return {
    sh,
    top,
    c,
    s,
    hx: LCX + sh(hy) + r.hx - s * 1.5,
    hy,
    sF: [LCX + sh(top) + 7 * c - tw * 2, top + 1 + 3 * s],
    sB: [LCX + sh(top) - 7 * c + tw * 5, top + 1 - 3 * s],
    hF: [LCX + r.fx + sh(LG + r.fy), LG + r.fy + d],
    hB: [LCX + r.bx + sh(LG + r.by), LG + r.by + d],
  };
}

interface LBlade {
  /** Кисть (рукоять). */
  x: number;
  y: number;
  ux: number;
  uy: number;
  /** Видимая длина. */
  len: number;
  /** 0 — в руке, 1 — держит воткнутый, 2 — воткнут и брошен, 3 — выронен. */
  pin: number;
  /** Перед телом. */
  z: boolean;
}

function lBlade(r: LRig, g: LGeo, front: boolean): LBlade {
  const h = front ? g.hF : g.hB;
  const pin = Math.round(front ? r.fpin : r.bpin);
  const len = front ? r.fl : r.bl;
  const a = front ? r.fa : r.ba;
  const z = (front ? r.fz : r.bz) >= 0.5;
  if (pin === 1 || pin === 2) {
    const px = LCX + (front ? r.fpx : r.bpx);
    const py = LG + (front ? r.fpy : r.bpy);
    if (pin === 2) {
      // Стоит сам: остриё в полу, рукоять над ним.
      const vis = len - 5;
      return {
        x: px - Math.cos(a) * vis,
        y: py - Math.sin(a) * vis,
        ux: Math.cos(a),
        uy: Math.sin(a),
        len: vis,
        pin,
        z,
      };
    }
    const L = Math.hypot(px - h[0], py - h[1]) || 1;
    return { x: h[0], y: h[1], ux: (px - h[0]) / L, uy: (py - h[1]) / L, len: L, pin, z };
  }
  return { x: h[0], y: h[1], ux: Math.cos(a), uy: Math.sin(a), len, pin, z };
}

// ---- Рисовальщик тела ----

/** Шестерня с растяжкой по x (нимб и воротник при повороте корпуса). */
function lCog(
  p: Px,
  cx: number,
  cy: number,
  r: number,
  teeth: number,
  rot: number,
  t: Tones,
  sx = 1,
  hole = 0.8,
  spokes = 0,
  sy = 1,
): void {
  const tooth = Math.max(1.2, r * 0.2);
  const body = r - tooth;
  const win0 = hole + Math.max(1, r * 0.12);
  const win1 = body - Math.max(1.2, r * 0.18);
  const rx = r * sx;
  const ry = r * sy;
  for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++)
    for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
      const dx = (x + 0.5 - cx) / sx;
      const dy = (y + 0.5 - cy) / sy;
      const d = Math.hypot(dx, dy);
      if (d > r || d < hole) continue;
      const a = Math.atan2(dy, dx) - rot;
      const f = ((((a / TAU) * teeth) % 1) + 1) % 1;
      if (d > body && (f < 0.22 || f > 0.72)) continue;
      if (spokes && d > win0 && d < win1) {
        const sf = ((((a / TAU) * spokes) % 1) + 1) % 1;
        if (sf > 0.18 && sf < 0.82) continue;
      }
      const nx = dx / (d || 1);
      const ny = dy / (d || 1);
      const lit = -(nx * LX + ny * LY);
      let l = 0.5;
      if (d > body - 1) l = 0.45 - lit * 0.9;
      else if (d < hole + 1.1) l = 0.45 + lit * 0.9;
      else if (spokes && (d < win0 + 0.9 || d > win1 - 0.9)) l = 0.5 - lit * 0.5;
      p.set(x, y, tone(t, l));
    }
}

/** Рука от плеча к кисти: рукав в два звена, латунный обшлаг и перчатка. */
function lArm(
  p: Px,
  s: [number, number],
  h: [number, number],
  bend: number,
  L: LordLook,
  front: boolean,
): void {
  const dx = h[0] - s[0];
  const dy = h[1] - s[1];
  const d = Math.hypot(dx, dy) || 1;
  const seg = 7.6;
  const half = Math.min(d / 2, seg);
  const off = Math.sqrt(Math.max(0, seg * seg - half * half)) * lclamp(bend, -1, 1);
  const ex = s[0] + dx / 2 - (dy / d) * off;
  const ey = s[1] + dy / 2 + (dx / d) * off;
  // Рука перед балахоном — с тёмной каймой, иначе рукав тонет в нём.
  if (front) {
    limb(p, s[0], s[1], ex, ey, 3.4, 3.0, INK4);
    limb(p, ex, ey, h[0], h[1], 3.0, 2.5, INK4);
  }
  limb(p, s[0], s[1], ex, ey, 2.6, 2.2, L.robe, 0.16);
  limb(p, ex, ey, h[0], h[1], 2.2, 1.7, L.robe, 0.22);
  const fl = Math.hypot(h[0] - ex, h[1] - ey) || 1;
  const ux = (h[0] - ex) / fl;
  const uy = (h[1] - ey) / fl;
  shadeEll(p, h[0] - ux * 1.6, h[1] - uy * 1.6, 2.2, 2.2, L.trim, 0.05);
  shadeEll(p, h[0], h[1], 1.7, 1.7, L.trim, 0.15);
}

/** Клинок: минутная или часовая; воткнутый — без острия (оно в полу). */
function lDrawBlade(
  p: ClipPx,
  lit: Px,
  b: LBlade,
  front: boolean,
  L: LordLook,
  heat: number,
  tipGlow: boolean,
): void {
  const ang = Math.atan2(b.uy, b.ux);
  const buried = b.pin === 1 || b.pin === 2;
  const len = buried ? b.len + 6 : b.len;
  if (buried) {
    const lim = b.len + 0.6;
    const bx = b.x;
    const by = b.y;
    const ux = b.ux;
    const uy = b.uy;
    p.clip = (x, y) => (x + 0.5 - bx) * ux + (y + 0.5 - by) * uy <= lim;
  }
  if (front) minuteHand(p, b.x, b.y, ang, len, L.trim, tipGlow && !buried ? L.glow : null);
  else hourHand(p, b.x, b.y, ang, len, L.trim);
  p.clip = null;
  if (buried) {
    // Где вошёл — тёмная щель в полу.
    const ex = b.x + b.ux * b.len;
    const ey = b.y + b.uy * b.len;
    p.set(Math.round(ex - 1), Math.round(ey), INK);
    p.set(Math.round(ex + 1), Math.round(ey), INK);
  }
  if (heat > 0.05 && !buried) {
    // Накал: кромка светится, к острию сильнее.
    const nx = -b.uy;
    const ny = b.ux;
    for (let i = 0.3; i <= 1.001; i += 0.05) {
      const x = b.x + b.ux * len * i + nx * 0.6;
      const y = b.y + b.uy * len * i + ny * 0.6;
      lit.set(Math.round(x), Math.round(y), alpha(L.glow, heat * (0.25 + 0.55 * i)));
    }
    lit.set(
      Math.round(b.x + b.ux * len),
      Math.round(b.y + b.uy * len),
      alpha(WHITE, Math.min(1, heat)),
    );
  }
}

function lArmBlade(
  p: ClipPx,
  lit: Px,
  r: LRig,
  g: LGeo,
  L: LordLook,
  front: boolean,
  inFront: boolean,
  dim: boolean,
): void {
  const b = lBlade(r, g, front);
  const sh = front ? g.sF : g.sB;
  const hd = front ? g.hF : g.hB;
  const heat = front ? r.fglow : r.bglow;
  // Клинок под кистью: кисть держит его поверх.
  if (b.pin !== 3) lDrawBlade(p, lit, b, front, L, heat, !dim);
  lArm(p, sh, hd, front ? r.fe : r.be, L, inFront);
}

interface LOpt {
  ph: number;
  /** Номер кадра: мерцание звёзд, песчинки, струя песка. */
  f: number;
  /** Песок отмотки поднимается от подола (0…1). */
  sandUp?: number;
  /** Дорисовать перед контуром (шестерни распада, пар, осколки). */
  post?: (p: ClipPx, lit: Px, g: LGeo, L: LordLook) => void;
  /** Нарисовать нимб (смерть уносит его отдельно). */
  noHalo?: boolean;
}

function lRobe(p: Px, lit: Px, r: LRig, g: LGeo, L: LordLook, o: LOpt): void {
  const { sh, top, c, s } = g;
  const d = r.drop;
  const rows: [number, number][] = [];
  for (let y = Math.floor(top); y < LG; y++) {
    const k = (y - top) / (LG - top);
    const hw = 6.5 + k * 6 + (d > 0 ? k * k * Math.min(4, d * 0.6) : 0);
    const off = sh(y) + (y > LG - 14 ? (r.hem * (y - (LG - 14))) / 14 : 0);
    const mid = LCX + off;
    rows.push([mid, hw]);
    for (let x = Math.floor(mid - hw); x <= Math.ceil(mid + hw - 1); x++) {
      const u = (x + 0.5 - mid) / hw;
      // Складки: тёмные борозды, свет слева; при повороте они едут по кругу.
      const q = (u + 1) * 2.5 + r.hem * k * 0.09 - s * 0.7;
      const fold = Math.abs((((q % 1) + 1) % 1) - 0.5) < 0.12 ? -0.28 : 0;
      p.set(x, y, tone(L.robe, 0.52 - u * 0.55 + fold + (1 - k) * 0.08));
    }
    if (c > 0.15) {
      // Полы: латунный кант по разрезу спереди.
      p.set(Math.round(mid + 1 - s * hw * 0.85), y, y % 3 ? L.trim[1] : L.trim[2]);
    } else if (c < -0.15) {
      // Со спины — шов.
      p.set(Math.round(mid + s * hw * 0.85), y, L.robe[0]);
    }
  }
  // Подол: латунная кайма с засечками часов.
  for (let x = LCX - 24; x <= LCX + 24; x++)
    for (const y of [LG - 3, LG - 2]) {
      if (!p.solid(x, y)) continue;
      p.set(
        x,
        y,
        (x + (y === LG - 2 ? 1 : 0)) % 4 === 0 ? INK : y === LG - 3 ? L.trim[2] : L.trim[1],
      );
    }
  const rowAt = (y: number) => rows[lclamp(Math.round(y - Math.floor(top)), 0, rows.length - 1)];
  // Полночь: в балахоне звёзды (мерцают медленно, места — свои).
  if (o.ph === 3)
    for (let i = 0; i < 16; i++) {
      const y = Math.round(top + 4 + hash(i, 7) * (LG - top - 8));
      const [mid, hw] = rowAt(y);
      const x = Math.round(mid + (hash(i, 3) - 0.5) * 1.6 * hw);
      if (p.solid(x, y) && hash(i, Math.floor(o.f / 3)) > 0.3)
        p.set(x, y, i % 3 ? hx('#9aa8ff') : WHITE);
    }
  // Отмотка: песок течёт ВВЕРХ с подола.
  const up = o.sandUp ?? (o.ph === 2 ? 0.35 : 0);
  if (up > 0)
    for (let i = 0; i < Math.round(6 + 10 * up); i++) {
      const life = (hash(i, 31) + o.f * (0.05 + 0.04 * hash(i, 9))) % 1;
      const y = Math.round(LG - 1 - life * (6 + 26 * up));
      const [mid, hw] = rowAt(Math.min(LG - 1, y));
      const x = Math.round(mid + (hash(i, 11) - 0.5) * 2 * (hw + 1));
      const col = i % 2 ? SAND[3] : TEAL[2];
      if (life < 0.85) {
        p.set(x, y, col);
        if (up > 0.5) lit.set(x, y, alpha(TEAL_GLOW, 0.5 * (1 - life)));
      }
    }
}

function lChest(p: Px, lit: Px, r: LRig, g: LGeo, L: LordLook, o: LOpt): void {
  const { sh, top, c, s } = g;
  if (c > 0.3) {
    // Окно в груди: маятник за стеклом (в отмотке — песок вверх).
    const wx = LCX + 1 + sh(top + 9) - s * 5;
    const wy = top + 9;
    const rx = 4 * c;
    p.ell(wx, wy, rx, 5.5, L.trim[1]);
    p.ell(wx, wy, Math.max(0.6, rx - 1), 4.5, hx('#0a0a14'));
    if (o.ph === 2) {
      for (let i = 0; i < 7; i++)
        p.set(
          Math.round(wx - 1 + (i % 3)),
          Math.round(wy + 3 - ((i * 1.3 + o.f * 0.5) % 8)),
          TEAL_GLOW,
        );
    } else {
      const a = r.pend;
      const bx = wx + Math.sin(a) * 3 * c;
      const by = wy - 3.5 + Math.cos(a) * 5.5;
      stroke(p, wx, wy - 4, bx, by, L.trim[2]);
      shadeEll(p, bx, by, 1.4, 1.4, L.trim, 0.2);
    }
    p.set(Math.round(wx - 2 * c), Math.round(wy - 3), alpha(WHITE, 0.7));
    p.set(Math.round(wx - 2 * c), Math.round(wy - 2), alpha(WHITE, 0.45));
  } else if (c < -0.25) {
    // Со спины — заводной ключ между лопатками.
    const kx = LCX + sh(top + 6) + s * 2;
    const ky = top + 6;
    stroke(p, kx, ky, kx, ky - 4, L.trim[1], 2);
    const w = 3.5 * Math.abs(Math.cos(r.halo * 3));
    shadeEll(p, kx - w * 0.6, ky - 5, Math.max(0.8, w * 0.6), 1.6, L.trim, 0.1);
    shadeEll(p, kx + w * 0.6, ky - 5, Math.max(0.8, w * 0.6), 1.6, L.trim, 0.1);
  }
  // Воротник-шестерня и наплечники-колокола.
  lCog(p, LCX + sh(top), top + 0.5, 5.5, 12, r.halo * 0.5, L.trim, Math.max(0.5, Math.abs(c)), 0.1);
  const sh2 = [g.sB, g.sF].sort((a, b) => a[1] - b[1]);
  for (const [sx, sy] of sh2) {
    shadeEll(p, sx, sy - 0.5, 3.6, 3, L.trim, 0.1);
    for (let x = Math.round(sx - 3); x <= Math.round(sx + 3); x++)
      p.set(x, Math.round(sy + 2), L.trim[0]);
  }
}

/** Голова — циферблат в безеле со шпилями; со спины — латунная крышка. */
function lHead(p: Px, lit: Px, r: LRig, g: LGeo, L: LordLook, o: LOpt): [number, number] | null {
  const { hx: x0, hy: y0, c } = g;
  const ac = Math.max(0.16, Math.abs(c));
  for (const a0 of [-Math.PI / 2, -Math.PI / 2 - 0.62, -Math.PI / 2 + 0.62]) {
    const a = a0 + r.hd;
    const bx = x0 + Math.cos(a) * 8.5 * ac;
    const by = y0 + Math.sin(a) * 8.5;
    const tall = a0 === -Math.PI / 2 ? 5 : 3.2;
    poly(
      p,
      [
        [bx - 1.6 * Math.max(0.5, ac), by + 0.5],
        [bx + 1.6 * Math.max(0.5, ac), by + 0.5],
        [bx + Math.cos(a) * tall * ac, by + Math.sin(a) * tall],
      ],
      L.trim[2],
    );
    p.set(Math.round(bx + Math.cos(a) * tall * ac), Math.round(by + Math.sin(a) * tall), L.trim[3]);
  }
  shadeEll(p, x0, y0, 8.6 * ac, 8.6, L.trim, 0.05);
  if (c < -0.12) {
    // Крышка часов: заклёпки и ось механизма.
    shadeEll(p, x0, y0, 7 * ac, 7, L.trim, -0.18);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + 0.78;
      p.set(Math.round(x0 + Math.cos(a) * 5 * ac), Math.round(y0 + Math.sin(a) * 5), L.trim[3]);
    }
    lCog(p, x0, y0, 3, 8, -r.halo, L.trim, ac, 0.6);
    return null;
  }
  if (c < 0.12) return null;
  const w = lclamp(r.white, 0, 1);
  const dm = lclamp(r.dim, 0, 1);
  const dimT: Tones = [L.face[0], L.face[0], L.face[1], L.face[1]];
  const faceT = L.face.map((c0, i) => mixc(mixc(c0, WHITE, w), dimT[i], dm)) as Tones;
  shadeEll(p, x0, y0, 7 * ac, 7, faceT, 0.25);
  const gk = lclamp(r.glow, 0, 1.4) * (1 - dm);
  if (gk > 0.02) p.ell(x0, y0, 6 * ac, 6, alpha(L.glow, Math.min(0.6, gk * 0.5)));
  // Накал лица — поверх темноты: видно, куда смотрит.
  const lk = Math.max(0, gk - 0.55) * 0.9 + w * 0.7;
  if (lk > 0.04)
    lit.ell(x0, y0, 6.4 * ac, 6.4, alpha(mixc(L.glow, WHITE, w), Math.min(0.75, lk * 0.6)));
  // Риски часов: у III, VI, IX, XII — длинные.
  const tick = o.ph === 3 ? L.hand : INK;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    const r0 = i % 3 === 0 ? 4.6 : 5.4;
    for (let rr = r0; rr <= 6.2; rr += 0.8)
      p.set(
        Math.floor(x0 + Math.sin(a) * rr * ac),
        Math.floor(y0 - Math.cos(a) * rr),
        dm > 0.6 ? mixc(tick, faceT[1], 0.5) : tick,
      );
  }
  // Стрелки лица.
  stroke(
    p,
    x0 - 0.5,
    y0 - 0.5,
    x0 - 0.5 + Math.sin(r.fh) * 3.4 * ac,
    y0 - 0.5 - Math.cos(r.fh) * 3.4,
    L.hand,
    2,
  );
  stroke(
    p,
    x0 - 0.5,
    y0 - 0.5,
    x0 - 0.5 + Math.sin(r.fm) * 5.4 * ac,
    y0 - 0.5 - Math.cos(r.fm) * 5.4,
    L.hand,
  );
  // Трещины по стеклу — растут стадиями; сквозь них сочится свет фазы.
  const cr = Math.floor(r.crack + 1e-6);
  if (cr >= 1) {
    const seg: [number, number, number, number][] = [
      [-5, -3, -1, 1],
      [-1, 1, 2, -1],
      [-1, 1, 1, 5],
    ];
    if (cr >= 2) seg.push([2, -1, 5, -3], [1, 5, 4, 4], [-1, 1, -5, 3], [2, -1, 1, -5]);
    for (const [a, b, e, f] of seg) {
      stroke(p, x0 + a * ac, y0 + b, x0 + e * ac, y0 + f, INK);
      if (dm < 0.8) {
        lit.set(
          Math.round(x0 + ((a + e) / 2) * ac),
          Math.round(y0 + (b + f) / 2),
          alpha(L.glow, 0.7),
        );
      }
    }
    if (cr >= 3) {
      // Стекло выбито: тёмная дыра в левом верхнем секторе.
      p.ell(x0 - 2.5 * ac, y0 - 2.5, 2.4 * ac, 2.2, hx('#0a0a14'));
      p.set(Math.round(x0 - 4 * ac), Math.round(y0 - 4), WHITE);
    }
  }
  const on = dm < 0.5 && c > 0.3;
  const ex = Math.round(x0 - 0.5);
  const ey = Math.round(y0 - 0.5);
  if (on) lit.set(ex, ey, L.glow);
  return on ? [ex, ey] : null;
}

function lFeet(p: Px, r: LRig, g: LGeo): void {
  for (const [fx, fy] of [
    [r.rf, r.rfy],
    [r.lf, r.lfy],
  ]) {
    const x = LCX + fx + g.sh(LG);
    const y = LG - 1.6 - fy;
    shadeEll(p, x, y, 2.4, 1.4, IRON, 0.15);
    p.set(Math.round(x + 1.6), Math.round(y), BRASS[2]);
  }
}

/** Песочные часы в руках: поворот, проявление, трещины. */
function lGlass(p: Px, lit: Px, r: LRig, g: LGeo, o: LOpt): void {
  const sc = lclamp(r.gs, 0, 1);
  if (sc < 0.06) return;
  const w = Math.max(3, Math.round(13 * sc));
  const h = Math.max(4, Math.round(19 * sc));
  const S = 28;
  const tmp = new Px(S, S);
  const top = Math.round(S / 2 - h / 2);
  const flow = sc > 0.95 && Math.abs(r.gr) < 0.02 && r.gk > 0.02 && r.gc < 3;
  hourglass(tmp, S / 2, top, w, h, lclamp(r.gk, 0, 1), flow, o.f, {
    sand: TEAL,
    glow: sc > 0.95 ? TEAL_GLOW : null,
    broken: r.gc >= 3,
  });
  const gc = Math.floor(r.gc + 1e-6);
  if (gc >= 1 && gc < 3) {
    stroke(tmp, S / 2 - 3, top + 4, S / 2 - 1, top + 7, alpha(WHITE, 0.95));
    if (gc >= 2) {
      stroke(tmp, S / 2 + 2, top + h - 4, S / 2, top + h - 7, alpha(WHITE, 0.95));
      stroke(tmp, S / 2 - 1, top + 7, S / 2 + 2, top + 9, alpha(WHITE, 0.8));
    }
  }
  const cx = LCX + r.gx + g.sh(LG + r.gy);
  const cy = LG + r.gy + r.drop;
  const ca = Math.cos(r.gr);
  const sa = Math.sin(r.gr);
  const R = S / 2 + 1;
  for (let y = -R; y <= R; y++)
    for (let x = -R; x <= R; x++) {
      const sx0 = (x + 0.5) * ca + (y + 0.5) * sa + S / 2;
      const sy0 = -(x + 0.5) * sa + (y + 0.5) * ca + S / 2;
      const ix = Math.floor(sx0);
      const iy = Math.floor(sy0);
      if (ix < 0 || iy < 0 || ix >= S || iy >= S) continue;
      const i = (iy * S + ix) * 4;
      if (!tmp.data[i + 3]) continue;
      p.set(Math.floor(cx + x), Math.floor(cy + y), [
        tmp.data[i],
        tmp.data[i + 1],
        tmp.data[i + 2],
        tmp.data[i + 3],
      ]);
    }
  // Песок светится — поверх темноты.
  if (sc > 0.5) {
    lit.ell(cx, cy, 3.5 * sc, 6 * sc, alpha(TEAL_GLOW, 0.22 * sc));
    if (flow)
      for (let y = -2; y < 4; y++) lit.set(Math.floor(cx), Math.floor(cy + y), alpha(SAND[3], 0.8));
  }
}

/** Полный кадр рига: тело, руки, клинки, часы; контур; свет поверх темноты. */
function paintLord(
  r: LRig,
  o: LOpt,
): { p: ClipPx; lit: Px; eye: [number, number] | null; g: LGeo } {
  const p = new ClipPx(LW, LH);
  const lit = new Px(LW, LH);
  const L = LORD_LOOK[o.ph] ?? LORD_LOOK[0];
  const g = lGeo(r);
  const back = g.c < 0;
  const dim = r.dim > 0.6;
  // 1. Нимб за головой (со спины — перед ней).
  if (!back && !o.noHalo)
    lCog(p, g.hx, g.hy, 13 + r.hs, 18, r.halo, L.halo, Math.max(0.14, Math.abs(g.c)), 4, 6);
  // 2. Руки за телом.
  if (r.bz < 0.5) lArmBlade(p, lit, r, g, L, false, false, dim);
  if (r.fz < 0.5) lArmBlade(p, lit, r, g, L, true, false, dim);
  // 3. Балахон, ступни, грудь, плечи, голова.
  lRobe(p, lit, r, g, L, o);
  lFeet(p, r, g);
  lChest(p, lit, r, g, L, o);
  const eye = lHead(p, lit, r, g, L, o);
  if (back && !o.noHalo)
    lCog(p, g.hx, g.hy, 13 + r.hs, 18, r.halo, L.halo, Math.max(0.14, Math.abs(g.c)), 4, 6);
  // 4. Руки перед телом; песочные часы — в руках.
  if (r.gl >= 0.5) lGlass(p, lit, r, g, o);
  if (r.fz >= 0.5) lArmBlade(p, lit, r, g, L, true, true, dim);
  if (r.bz >= 0.5) lArmBlade(p, lit, r, g, L, false, true, dim);
  if (o.post) o.post(p, lit, g, L);
  p.outline(INK);
  // Глаз — ось стрелок: светится поверх контура.
  if (eye) p.set(eye[0], eye[1], L.glow);
  return { p, lit, eye, g };
}

// ---- Следы и частицы тела (в кадре: своё — у тела, мир — у «Техник») ----

/** Пиксели внутри многоугольника — каждому свой цвет (или пропуск). */
function lPolyEach(pts: [number, number][], fn: (x: number, y: number) => void): void {
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
      if (inside) fn(x, y);
    }
}

/**
 * След клинка — серп по выборкам в прошлом (`sm[0]` — сейчас). У свежего
 * края полоса шире и светлее, к хвосту — у самого острия и через точку.
 */
function lSmear(p: Px, lit: Px, sm: LBlade[], L: LordLook, inner: number): void {
  const n = sm.length - 1;
  if (n < 1) return;
  const pt = (b: LBlade, f: number): [number, number] => [
    b.x + b.ux * b.len * f,
    b.y + b.uy * b.len * f,
  ];
  const hot = mixc(L.glow, WHITE, 0.55);
  for (let i = n - 1; i >= 0; i--) {
    const A = sm[i];
    const B = sm[i + 1];
    if (!A.z && !B.z) continue;
    const [ax, ay] = pt(A, 1);
    const [bx, by] = pt(B, 1);
    if (Math.hypot(ax - bx, ay - by) < 2.4) continue;
    const ka = i / n;
    const kb = (i + 1) / n;
    // Серп: у свежего края — во всю длину от `inner`, к хвосту — только остриё.
    const fa = inner + (1 - inner) * 0.9 * ka * ka;
    const fb = inner + (1 - inner) * 0.9 * kb * kb;
    const [iax, iay] = pt(A, fa);
    const [ibx, iby] = pt(B, fb);
    const age = (ka + kb) / 2;
    const L0x = A.len || 1;
    lPolyEach(
      [
        [iax, iay],
        [ax, ay],
        [bx, by],
        [ibx, iby],
      ],
      (x, y) => {
        // Хвост тает через точку, а не обрывается.
        if (age > 0.5 && (x + y) % 2) return;
        if (age > 0.8 && (x + 2 * y) % 3) return;
        const u = (Math.hypot(x + 0.5 - A.x, y + 0.5 - A.y) / L0x - fa) / (1 - fa || 1);
        let c: RGBA;
        if (u > 0.78) c = age < 0.3 ? BRASS_HI : L.trim[3];
        else if (u > 0.4) c = age < 0.45 ? L.trim[3] : L.trim[2];
        else c = L.trim[2];
        p.set(x, y, alpha(c, age < 0.3 ? 0.95 : 0.75 - age * 0.3));
        if (u > 0.35 && age < 0.75)
          lit.set(x, y, alpha(u > 0.78 ? hot : L.glow, (0.85 - age) * 0.75));
      },
    );
  }
}

/** Выпад: линии скорости тянутся от острия назад вдоль клинка. */
function lThrust(lit: Px, p: Px, b: LBlade, k: number, L: LordLook): void {
  if (k <= 0.02) return;
  const tx = b.x + b.ux * b.len;
  const ty = b.y + b.uy * b.len;
  const nx = -b.uy;
  const ny = b.ux;
  const hot = mixc(L.glow, WHITE, 0.6);
  const lines: [number, number, number][] = [
    [0, 40, 1],
    [-2.2, 26, 0.75],
    [2.2, 26, 0.75],
    [-4.6, 14, 0.5],
    [4.6, 14, 0.5],
  ];
  for (const [o, ln, a] of lines) {
    const n = ln * k;
    for (let i = 4; i < n; i++) {
      if (o && i % 2) continue;
      const x = Math.round(tx - b.ux * i + nx * o);
      const y = Math.round(ty - b.uy * i + ny * o);
      const fade = 1 - i / n;
      lit.set(x, y, alpha(hot, a * fade * k));
      if (!o && fade > 0.5) p.set(x, y, alpha(L.trim[3], 0.6 * fade));
    }
  }
}

/** Рывок в остановке: полосы позади тела (k — сила, up — вверх). */
function lStreak(lit: Px, p: Px, g: LGeo, k: number, up: boolean, L: LordLook): void {
  if (k <= 0.02) return;
  const hot = mixc(L.glow, WHITE, 0.7);
  for (let i = 0; i < 7; i++) {
    const n = (10 + hash(i, 5) * 22) * k;
    if (up) {
      const x = Math.round(LCX - 9 + i * 3 + g.sh(LG - 30));
      const y0 = Math.round(LG - 6 - hash(i, 2) * 8);
      for (let j = 0; j < n; j++) {
        lit.set(x, y0 + j, alpha(hot, 0.75 * (1 - j / n)));
        if (j < n * 0.4) p.set(x, y0 + j, alpha(L.trim[3], 0.5));
      }
    } else {
      const y = Math.round(LG - 6 - i * 6);
      const x0 = Math.round(LCX - 8 + g.sh(y) - hash(i, 3) * 3);
      for (let j = 0; j < n; j++) {
        lit.set(x0 - j, y, alpha(hot, 0.75 * (1 - j / n)));
        if (j < n * 0.4) p.set(x0 - j, y, alpha(L.trim[3], 0.5));
      }
    }
  }
}

/** Осколки стекла и песок: разлетаются из точки, падают и ложатся. */
function lShards(
  p: Px,
  lit: Px,
  cx: number,
  cy: number,
  t: number,
  n: number,
  seed: number,
  pile: boolean,
): void {
  const G2 = 380;
  for (let i = 0; i < n; i++) {
    const a = -Math.PI * (0.1 + 0.8 * hash(i, seed)) + (hash(i, seed + 1) - 0.5) * 0.6;
    const sp = 26 + 34 * hash(i, seed + 2);
    const vx = Math.cos(a) * sp * (i % 2 ? 1 : -1);
    const vy = Math.sin(a) * sp;
    const floor = LG - 1 - hash(i, seed + 3) * 3;
    let x = cx + vx * t;
    let y = cy + vy * t + 0.5 * G2 * t * t;
    if (y > floor) {
      y = floor;
      const tl = (-vy + Math.sqrt(Math.max(0, vy * vy + 2 * G2 * (floor - cy)))) / G2;
      x = cx + vx * Math.min(t, tl + 0.05);
    }
    const glass = i % 3 !== 0;
    const c = glass ? (i % 2 ? GLASS_HI : alpha(hx('#bfe8f0'), 220)) : TEAL[2];
    p.set(Math.round(x), Math.round(y), c);
    if (glass && y < floor) {
      p.set(Math.round(x - Math.sign(vx)), Math.round(y - 1), alpha(WHITE, 0.6));
      lit.set(Math.round(x), Math.round(y), alpha(TEAL_GLOW, 0.6));
    }
  }
  // Песок высыпается горкой у ног.
  if (!pile) return;
  const heap = Math.min(1, t * 2.5);
  for (let x = -6; x <= 6; x++) {
    const hgt = Math.round(heap * 2.2 * (1 - (x * x) / 40));
    for (let y = 0; y < hgt; y++)
      p.set(Math.round(cx + x), LG - 1 - y, y === hgt - 1 ? SAND[2] : SAND[1]);
  }
}

/** Над головой оглушённого кружат шестерёнки-звёзды. */
function lOrbit(p: Px, lit: Px, g: LGeo, f: number, L: LordLook): void {
  for (let i = 0; i < 3; i++) {
    const a = (f / 12) * TAU + (i / 3) * TAU;
    const x = g.hx + Math.cos(a) * 10;
    const y = g.hy - 13 + Math.sin(a) * 3;
    lCog(p, x, y, 2.2, 6, a * 2, L.trim, 1, 0.5);
    lit.set(Math.round(x), Math.round(y - 2), alpha(WHITE, 0.8));
  }
}

/** Пар из-под воротника: клубы на выдохе (k — возраст 0…1). */
function lSteam(p: Px, lit: Px, g: LGeo, k: number, side: number): void {
  if (k < 0 || k >= 1) return;
  const x = LCX + g.sh(g.top) + side * (9 + k * 9);
  const y = g.top - k * 9;
  const rr = 1.2 + k * 2.6;
  p.ell(x, y, rr, rr * 0.8, alpha(hx('#d8dce4'), 0.55 * (1 - k)));
  lit.ell(x, y, rr * 0.7, rr * 0.5, alpha(WHITE, 0.25 * (1 - k)));
}

// ---- Смерть: циферблат трескается, стрелки встают, корпус сыплется шестернями ----

interface LGear {
  ox: number;
  oy: number;
  r: number;
  vx: number;
  vy: number;
  spin: number;
  tone: number;
}

/** Где шестерня в момент `a` после того, как отвалилась: падает, отскакивает, катится. */
function lGearAt(q: LGear, a: number): [number, number, number] {
  const G2 = 720;
  const floor = LG - 1 - q.r;
  const C = q.oy - floor;
  const t1 = (-q.vy + Math.sqrt(Math.max(0, q.vy * q.vy - 2 * G2 * C))) / G2;
  if (a < t1) return [q.ox + q.vx * a, q.oy + q.vy * a + 0.5 * G2 * a * a, q.spin * a];
  const v1 = -(q.vy + G2 * t1) * 0.3;
  const a2 = a - t1;
  const t2 = (-2 * v1) / G2;
  const y = a2 < t2 ? floor + v1 * a2 + 0.5 * G2 * a2 * a2 : floor;
  // По полу — катится и тормозит.
  const roll = Math.min(a2, 0.35);
  const x = q.ox + q.vx * t1 + q.vx * 0.5 * (roll - (roll * roll) / 0.7);
  return [x, y, q.spin * (t1 + roll)];
}

const DEATH_T = 1.6;
/** Распад сверху вниз: начало и длительность. */
const DEATH_SWEEP = [0.72, 0.5];

function lDeathGears(body: Px): LGear[] {
  const out: LGear[] = [];
  for (let y = 20; y < LG - 2 && out.length < 30; y += 5)
    for (let x = 8; x < LW - 8 && out.length < 30; x += 5) {
      const jx = Math.round(x + (hash(x, y, 41) - 0.5) * 3);
      if (!body.solid(jx, y)) continue;
      const h1 = hash(jx, y, 43);
      out.push({
        ox: jx,
        oy: y,
        r: 1.8 + h1 * 1.8,
        vx: (hash(jx, y, 47) - 0.5) * 80,
        vy: -12 - hash(jx, y, 53) * 26,
        spin: (h1 - 0.5) * 18,
        tone: Math.floor(hash(jx, y, 59) * 4),
      });
    }
  return out;
}

// ---- Техники: ключевые позы на оси времени мозга ----

const lHaste = (ph: number) => (ph >= 3 ? 1.25 : ph >= 2 ? 1.12 : 1);
/** Начало кадра, в котором мозг бьёт: поза контакта стоит ровно в нём. */
const lHitT = (T: number) => Math.floor(T * LFPS + 1e-6) * LF1;
/** Стойка: руки и корпус — как в покое (для возврата из техник). */
const LREST: Partial<LRig> = {
  lean: 0,
  drop: 0,
  tw: 0,
  hem: 0,
  hx: 0,
  hy: 0,
  fx: L0.fx,
  fy: L0.fy,
  fa: L0.fa,
  fl: L0.fl,
  fe: L0.fe,
  bx: L0.bx,
  by: L0.by,
  ba: L0.ba,
  bl: L0.bl,
  be: L0.be,
  glow: 0.5,
  white: 0,
  sx: 1,
  sy: 1,
  pend: 0,
  fglow: 0,
  bglow: 0,
};
/** Щелчок: величина идёт ступеньками, как стрелка часов. */
const lTickQ = (v: number, step: number) => Math.floor(v / step) * step;

/** Покой: 3 с по 10 к/с, шесть тиков. Дыхание — целыми пикселями. */
const IDLE_N = 30;
function lIdle(f: number): LRig {
  const k = Math.floor(f / 5);
  const sub = f % 5;
  const r = { ...L0 };
  const br = 0.5 - 0.5 * Math.cos((f / IDLE_N) * TAU);
  r.drop = -Math.round(br);
  r.hem = 0.9 * Math.sin((f / IDLE_N) * TAU + 1.2);
  // Маятник в груди: тик — у края, так — у другого.
  r.pend = 0.55 * Math.cos(Math.PI * (f / 5));
  // Стрелка лица щёлкает на шестую круга с отскоком, нимб — на треть зуба.
  r.fm = k * (TAU / 6) + (sub === 0 ? 0.16 : sub === 1 ? -0.06 : 0);
  r.halo = k * (TAU / 36) + (sub === 0 ? 0.035 : 0);
  r.glow = sub === 0 ? 0.66 : sub === 1 ? 0.56 : 0.5;
  // На щелчке минутная в руке вздрагивает на пиксель.
  if (sub === 0) r.fy -= 1;
  return r;
}

/** Шаг: 8 кадров на два шага; каждый шаг — «тик» стрелки лица. */
const WALK_N = 8;
const WALK_STRIDE = 26;
function lWalk(f: number, fast: boolean): LRig {
  const ff = ((f % WALK_N) + WALK_N) % WALK_N;
  const a = (ff / WALK_N) * TAU;
  const r = { ...L0 };
  r.drop = Math.round(0.5 + 0.5 * Math.cos(2 * a));
  r.lean = fast ? 2.8 : 1.6;
  r.hem = (fast ? -2.6 : -1.6) + 0.9 * Math.sin(2 * a + 0.8);
  r.lf = 3 + 4.5 * Math.sin(a);
  r.rf = -4 - 4.5 * Math.sin(a);
  r.lfy = Math.max(0, Math.cos(a)) * 1.6;
  r.rfy = Math.max(0, -Math.cos(a)) * 1.6;
  r.fx = L0.fx - 2.4 * Math.sin(a);
  r.bx = L0.bx + 2.4 * Math.sin(a);
  r.fy = L0.fy - Math.round(Math.max(0, -Math.sin(a)));
  r.by = L0.by - Math.round(Math.max(0, Math.sin(a)));
  r.fa = (fast ? 1.45 : 1.2) - 0.14 * Math.sin(a);
  r.ba = (fast ? 2.3 : 2.05) + 0.12 * Math.sin(a);
  r.pend = 0.45 * Math.sin(a + 1);
  r.halo = (ff / WALK_N) * (TAU / 6);
  // Тик-так на каждый шаг: стрелка лица качается метрономом.
  r.fm = ff < 4 ? -0.45 : 0.45;
  if (ff === 0 || ff === 4) r.fm *= 1.25;
  return r;
}

/** Пробуждение: лицо загорается, стрелки сбегаются на XII, удар колокола. */
const ROAR_T = 1.6;
function lRoar(t: number): LRig {
  const keys: LKf[] = [
    [
      0,
      {
        drop: 2,
        hy: 2,
        dim: 1,
        glow: 0,
        fx: 6,
        fy: -13,
        fa: 1.45,
        bx: -7,
        by: -13,
        ba: 1.7,
        hem: 0.5,
        fm: 3.4,
        fh: 3.0,
        pend: 0,
      },
    ],
    [0.3, { dim: 1, hy: 2 }],
    [0.42, { dim: 0, glow: 0.8, hy: 1 }, lIn],
    [0.5, { glow: 1.1, pend: 0.5 }, lOut],
    [
      0.95,
      {
        drop: -1,
        hy: -1,
        fx: 12,
        fy: -35,
        fa: -1.0,
        fe: 1,
        bx: -12,
        by: -35,
        ba: 4.14,
        be: -1,
        bz: 1,
        glow: 1,
        halo: TAU / 3,
        fm: TAU,
        fh: TAU,
        lean: -1,
        pend: -0.6,
        hem: -0.6,
      },
      lIO,
    ],
    [
      1.0,
      {
        fx: 12,
        fy: -39,
        fa: -1.25,
        bx: -12,
        by: -39,
        ba: 4.39,
        white: 1,
        hs: 2,
        sy: 1.06,
        sx: 0.96,
        hy: -2,
      },
      lOut,
    ],
    [1.08, { sy: 0.97, sx: 1.03, hs: 1, white: 0.6, drop: 1, pend: 0.7 }, lOut],
    [1.2, { sy: 1, sx: 1, hs: 0, white: 0.2, drop: 0 }, lIO],
    [ROAR_T, { ...LREST, bz: 0, glow: 0.6 }, lIO],
  ];
  const r = ltrack(keys, t);
  // Стрелки лица бегут к XII щелчками (24 к/с — каждый кадр щелчок).
  if (t > 0.5 && t < 0.95) {
    r.fm = lTickQ(r.fm, TAU / 12);
    r.fh = lTickQ(r.fh, TAU / 24);
  }
  return r;
}

/**
 * Часовая (тяжёлая): стрелка обходит круг через голову, как по циферблату.
 * Перехват → занос назад-вверх → НАТЯГ (корпус скручен, клинок за спиной,
 * лицо накаляется, стрелки лица отщёлкивают назад, как храповик) → рубка
 * через голову по дуге за два кадра со следом → контакт в кадре урона
 * (сжатие от удара) → проводка с перелётом → возврат.
 */
function lHour(t: number, A: number, h: number): LRig {
  const T = LORD.hourWarn / h;
  const R = 0.55 / h;
  const tC = lHitT(T);
  const tA = Math.min(0.22, tC - 6 * LF1);
  const arm = (a: number, tw: number, rr = 13): Partial<LRig> => ({
    bx: -7 + tw * 5 + Math.cos(a) * rr,
    by: -31 + Math.sin(a) * rr,
  });
  // Клинок ходит как часовая стрелка: VII → XI, натяг назад на X, удар
  // X → XII → II → IV (для прицела вправо; иначе — повёрнуто на прицел).
  const keys: LKf[] = [
    [0, {}],
    [0.08, { drop: 1, lean: -0.5, glow: 0.6, fy: L0.fy + 1 }, lOut],
    [
      tA,
      {
        ...arm(A + 3.9, -0.5),
        ba: A + 4.0,
        bl: 16,
        be: -1,
        tw: -0.5,
        lean: -1.5,
        drop: -1,
        glow: 0.8,
        hem: -0.5,
        fx: 10,
        fy: -21,
        fa: 1.55,
        pend: 0.5,
      },
      lIO,
    ],
    [
      tC - 3 * LF1,
      {
        ...arm(A + 4.1, -0.9),
        ba: A + 3.72,
        bl: 18,
        tw: -0.9,
        lean: -2.6,
        drop: 1,
        glow: 1,
        bglow: 1,
        fx: 11,
        fy: -23,
        fa: 1.75,
        hem: -1.2,
        pend: 0.8,
        hy: -1,
      },
      lIO,
    ],
    [
      tC - 2 * LF1,
      { ...arm(A + 4.65, -0.2), ba: A + 4.75, bl: 21, tw: -0.2, lean: 0, drop: -1, bz: 1 },
      lIn,
    ],
    [
      tC - LF1,
      { ...arm(A + 5.45, 0.6), ba: A + 5.65, bl: 23, tw: 0.6, lean: 2, drop: 0, hy: 0 },
      lLin,
    ],
    [
      tC,
      {
        ...arm(A + 6.4, 1),
        ba: A + 6.9,
        bl: 25,
        tw: 1,
        lean: 3,
        drop: 2,
        sx: 1.05,
        sy: 0.95,
        white: 0.5,
        fx: 5,
        fy: -15,
        fa: 1.35,
        hem: 1.5,
        pend: -0.8,
        hy: 1,
      },
      lLin,
    ],
    [tC + LF1, { sx: 1.04, sy: 0.96 }, lLin],
    [
      tC + 4 * LF1,
      {
        ...arm(A + 6.7, 0.8),
        ba: A + 7.4,
        bl: 21,
        lean: 2.4,
        drop: 2.5,
        sx: 1,
        sy: 1,
        white: 0,
        glow: 0.8,
        bglow: 0.5,
        hy: 0,
      },
      lOut,
    ],
    [
      tC + 9 * LF1,
      { ...arm(A + 7.0, 0.5), ba: A + 7.7, bl: 17, lean: 1.2, drop: 1, bglow: 0 },
      lIO,
    ],
    [T + R, { ...LREST, ba: L0.ba + TAU, be: 1, bz: 0 }, lIO],
  ];
  const r = ltrack(keys, t);
  // Натяг: последние кадры заноса — кисть дрожит на полпикселя.
  if (t > tC - 8 * LF1 && t < tC - 3 * LF1) r.by += Math.floor(t * LFPS) % 2 ? 0.6 : -0.6;
  // Стрелки лица: храповик назад на заносе, на ударе — к цели.
  const fA = A + Math.PI / 2;
  if (t < tC - 2 * LF1) {
    r.fm = -lTickQ(t, 0.083) * 6.3;
    r.fh = 1.9 - lTickQ(t, 0.166) * 1.2;
    r.halo = -lTickQ(t, 0.083) * 0.35;
  } else if (t < T + R - 3 * LF1) {
    r.fm = fA;
    r.fh = fA - 0.35;
    r.fdir = 1;
    r.halo = 0.52;
  } else {
    r.fm = 0;
    r.fh = 1.9;
    r.halo = TAU / 6;
  }
  return r;
}

/**
 * Минутная (быстрая): прицел — рука вытягивается к цели, стрелки лица
 * щелчками наводятся на неё; взвод — рука назад; укол в кадре урона с
 * линиями скорости; выпад (тело летит, шлейф); стрелка входит в пол —
 * три рывка вытащить, лицо мигает; вырвал — отшатнулся; возврат.
 */
function lMinute(t: number, A: number, h: number): LRig {
  const T = LORD.minWarn / h;
  const tC = lHitT(T);
  const L1 = T + LORD.lunge;
  const S1 = L1 + LORD.stuck;
  const R1 = S1 + 0.55 / h;
  const sx0 = 5.4;
  const sy0 = -31;
  const [tx, ty] = lFloor(A, 96);
  const beta = Math.atan2(ty - sy0, tx - sx0);
  const aim = (k: number, extra = 0): Partial<LRig> => ({
    fx: sx0 + Math.cos(beta) * k,
    fy: sy0 + Math.sin(beta) * k,
    fa: beta + extra,
  });
  const [px, py] = lFloor(A, 22);
  const pd = Math.atan2(py - sy0, px - sx0);
  const toPin = (k: number): Partial<LRig> => ({
    fx: sx0 + Math.cos(pd) * k,
    fy: sy0 + Math.sin(pd) * k,
  });
  const up = Math.sin(A) < -0.5;
  const keys: LKf[] = [
    [0, {}],
    [
      0.1,
      {
        ...aim(8, 0.5),
        fe: 1,
        tw: 0.5,
        bx: -14,
        by: -27,
        ba: 3.5,
        be: -1,
        drop: 1,
        lean: -1,
        glow: 0.7,
      },
      lOut,
    ],
    [
      0.25,
      { ...aim(13), fl: 27, tw: 0.9, lean: -1.5, drop: 1.5, glow: 0.85, bx: -16, by: -29, ba: 3.7 },
      lIO,
    ],
    [tC - 4 * LF1, { ...aim(8), lean: -2.6, drop: 2.5, fglow: 1, glow: 1, hem: 1 }, lIO],
    [tC - 2 * LF1, { ...aim(7.5), lean: -2.8, drop: 2.6 }, lLin],
    [tC - LF1, { ...aim(12), lean: 0.5, drop: 1 }, lIn],
    [
      tC,
      {
        ...aim(16.5),
        fl: 31,
        lean: 4.5,
        drop: 0,
        sx: 1.07,
        sy: 0.96,
        white: 0.6,
        hem: -2.5,
        bx: -17,
        by: -31,
      },
      lLin,
    ],
    [T + 0.08, { sx: 1.04, sy: 0.97, white: 0.2, lean: 5 }, lOut],
    [L1 - LF1, { ...aim(16), fl: 30 }, lLin],
    [
      L1,
      {
        ...toPin(11),
        fpin: 1,
        fpx: px,
        fpy: py,
        fz: up ? 0 : 1,
        fl: 24,
        lean: 6,
        drop: 4,
        sx: 1.08,
        sy: 0.9,
        fglow: 0,
        glow: 0.6,
        white: 0,
        hem: 3,
      },
      lOut,
    ],
    [L1 + 2 * LF1, { sx: 1.02, sy: 0.97 }, lOut],
    [L1 + 0.16, { ...toPin(8), lean: 1.5, drop: 3, sx: 1, sy: 1, hem: 0 }, lIO],
    [L1 + 0.3, { ...toPin(10), lean: 4, drop: 3.5 }, lIn],
    [L1 + 0.45, { ...toPin(7), lean: 0.5, drop: 2.5 }, lIO],
    [L1 + 0.58, { ...toPin(10), lean: 3.5, drop: 3 }, lIn],
    [L1 + 0.74, { ...toPin(6), lean: -1, drop: 2, hem: -1 }, lIO],
    [S1 - 0.12, { ...toPin(6.5), lean: -1.5 }, lLin],
    [
      S1 - 0.08,
      {
        fpin: 0,
        fx: sx0 + 3,
        fy: sy0 - 6,
        fa: -1.0,
        fl: 24,
        lean: -3.5,
        drop: -1,
        hem: 2,
        fz: 1,
        sx: 0.97,
        sy: 1.04,
      },
      lOut,
    ],
    [S1 + 0.04, { lean: -2, drop: 0, sx: 1, sy: 1 }, lOut],
    [R1, { ...LREST, tw: 0, be: 1 }, lIO],
  ];
  const r = ltrack(keys, t);
  const fA = A + Math.PI / 2;
  const n = Math.floor(t * LFPS);
  r.fdir = t < S1 - 0.08 ? 1 : 0;
  if (t < 0.3) {
    // Наводка: щелчками каждые два кадра — к цели.
    r.fm = fA - lTickQ(Math.max(0, 0.3 - t), 0.083) * 9;
    r.fh = fA - 0.4 - lTickQ(Math.max(0, 0.3 - t), 0.083) * 4;
  } else if (t < L1 + 0.05) {
    // Навёлся: стрелки на цели, щёлкают «дальномером».
    r.fm = fA + (n % 3 === 0 ? 0.12 : 0);
    r.fh = fA - 0.4;
  } else if (t < S1 - 0.08) {
    // Застрял: лицо мигает, стрелки мечутся.
    r.dim = Math.floor(t * 12) % 2 ? 0.85 : 0.1;
    r.fm = fA + (hash(Math.floor(t * 8), 7) - 0.5) * 3;
    r.fh = fA - 0.4 + (hash(Math.floor(t * 6), 9) - 0.5) * 1.5;
  } else {
    r.fm = lTickQ(fA * (1 - lclamp((t - S1) / 0.3, 0, 1)), 0.52);
    r.fh = 1.9;
  }
  return r;
}

/** Руки при обороте: ψ — поворот рук вокруг тела, τ — клинки вниз. */
function lSpinArms(r: LRig, psi: number, tau: number, reach: number): void {
  for (const front of [true, false]) {
    const a = psi + (front ? 0 : Math.PI);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const n = Math.hypot(1, tau);
    const vx = ca / n;
    const vy = (0.5 * sa + tau) / n;
    const ang = Math.atan2(vy, vx);
    const k = Math.hypot(vx, vy);
    const hx0 = ca * reach;
    const hy0 = -26 + sa * reach * 0.5;
    if (front) {
      r.fx = hx0;
      r.fy = hy0;
      r.fa = ang;
      r.fl = 27 * k;
      r.fz = sa > -0.08 ? 1 : 0;
      r.fe = sa > 0 ? -1 : 1;
    } else {
      r.bx = hx0;
      r.by = hy0;
      r.ba = ang;
      r.bl = 19 * k;
      r.bz = sa > -0.08 ? 1 : 0;
      r.be = sa > 0 ? 1 : -1;
    }
  }
}

/**
 * Вращение: руки в стороны, клинки качаются маятником всё шире (тик-так с
 * щелчком на краю), на последнем махе переваливают через верх — и корпус
 * делает полный оборот (вид сбоку, со спины), клинки по кругу со следом;
 * контакт — в кадре урона, клинки во всю длину; дальше юла тормозит.
 */
function lSpin(t: number, h: number): LRig {
  const T = LORD.spinWarn / h;
  const tC = lHitT(T);
  const R = 0.55 / h;
  const tA = tC - 7 * LF1;
  const r = { ...L0 };
  r.glow = 0.85;
  if (t < tA) {
    const u = lclamp(t / tA, 0, 1);
    const sp = lOut(lclamp(t / 0.18, 0, 1));
    const amp = 0.25 + 1.35 * u * u;
    const th = amp * Math.sin(Math.PI * 3 * u);
    r.fx = L0.fx + (17 - L0.fx) * sp;
    r.fy = L0.fy + (-26 - L0.fy) * sp;
    r.bx = L0.bx + (-17 - L0.bx) * sp;
    r.by = L0.by + (-26 - L0.by) * sp;
    r.fa = L0.fa + (Math.PI / 2 + th - L0.fa) * sp;
    r.ba = L0.ba + (Math.PI / 2 + th - L0.ba) * sp;
    r.fl = 24 + 2 * u;
    r.bl = 15 + 3 * u;
    r.fe = 1;
    r.be = -1;
    r.bz = sp > 0.5 ? 1 : 0;
    r.lean = -th * 1.3 * sp;
    r.drop = Math.round(sp);
    r.hem = th * 1.5;
    r.pend = -th * 0.6;
    // Щелчок на каждом краю маха: нимб и стрелка лица.
    const tick = Math.floor(3 * u + 0.5);
    r.halo = tick * (TAU / 18);
    r.fm = tick * (TAU / 4);
    r.glow = 0.7 + 0.3 * u;
  } else if (t < tC + 1e-6) {
    const u = lclamp((t - tA) / (tC - tA), 0, 1);
    const turn = lIn(u);
    lSpinArms(r, turn * TAU, 0.35 + 1.4 * Math.pow(1 - u, 3), 18);
    r.turn = turn;
    r.halo = TAU / 6 + turn * TAU * 0.5;
    r.fm = turn * TAU * 2;
    r.glow = 1.05;
    r.sy = 1 + 0.04 * u;
    r.sx = 1 - 0.03 * u;
    r.hem = 2.5 * Math.sin(turn * TAU);
    r.drop = 1 - Math.round(u);
  } else {
    const u = lclamp((t - tC) / R, 0, 1);
    const turn = 1 + lOut(u);
    lSpinArms(r, turn * TAU, 0.35 + 1.2 * u, 18 - 5 * u);
    r.turn = turn;
    r.halo = TAU / 6 + turn * TAU * 0.5;
    r.fm = turn * TAU * 2;
    r.glow = 1 - 0.45 * u;
    r.hem = 2.5 * Math.sin(turn * TAU) * (1 - u);
    r.lean = Math.sin(u * 9) * 2 * (1 - u);
    r.sy = 1.04 - 0.04 * u;
    r.sx = 0.97 + 0.03 * u;
    if (u > 0.6) return lmix(r, { ...L0, turn: 2, halo: r.halo, fm: r.fm }, lIO((u - 0.6) / 0.4));
  }
  return r;
}

/**
 * Хлопок (2 с — «вдох» мира): руки поднимаются, лицо белеет, стрелки лица
 * бегут всё быстрее, нимб разгоняется; руки расходятся — и сходятся перед
 * лицом: обе стрелки встают на XII, как на циферблате. В кадре хлопка —
 * удар (сжатие, вспышка лица).
 */
const CLAP_END: Partial<LRig> = {
  fx: 1.5,
  fy: -34,
  fa: -Math.PI / 2,
  fe: 1,
  bx: -1.5,
  by: -34,
  ba: 1.5 * Math.PI,
  be: -1,
  bz: 1,
  fl: 28,
  bl: 20,
  white: 1,
  glow: 1,
  sy: 0.96,
  sx: 1.04,
  hs: 1.5,
  fm: 0,
  fh: 0,
};
function lClap(t: number): LRig {
  const keys: LKf[] = [
    [0, {}],
    [
      0.32,
      {
        fx: 14,
        fy: -30,
        fa: -0.55,
        fe: 1,
        bx: -14,
        by: -30,
        ba: 3.69,
        be: -1,
        bz: 1,
        glow: 0.8,
        lean: -0.5,
        drop: -1,
        pend: 0.6,
      },
      lIO,
    ],
    [
      1.2,
      {
        fx: 11,
        fy: -40,
        fa: -1.15,
        bx: -11,
        by: -40,
        ba: 4.29,
        hy: -1,
        sy: 1.04,
        white: 0.35,
        glow: 1,
        drop: -2,
        hem: -0.6,
      },
      lIO,
    ],
    [1.66, { fx: 16, fy: -36, fa: -0.7, bx: -16, by: -36, ba: 3.84, sy: 1.05, white: 0.5 }, lIO],
    [1.875, { fx: 8, fy: -38, fa: -1.25, bx: -8, by: -38, ba: 4.39, fl: 27, bl: 19 }, lIn],
    [1.917, { ...CLAP_END, sy: 1.02, sx: 1, white: 0.85, hs: 0.5 }, lLin],
    [1.958, { ...CLAP_END, drop: 0, hy: 0 }, lOut],
  ];
  const r = ltrack(keys, t);
  // Стрелки лица и нимб: идут, потом бегут — всё быстрее; на хлопке — XII.
  if (t < 1.88) {
    const spin = 0.5 * t + 1.6 * t * t * t;
    r.fm = lTickQ(spin, 1 / 12) * TAU;
    r.fh = 1.9 + lTickQ(spin, 1 / 12) * (TAU / 12);
    r.halo = lTickQ(spin * 0.25, 1 / 36) * TAU;
    r.pend = Math.sin(t * (6 + t * 8)) * (0.4 + 0.3 * t);
  } else {
    r.fm = 0;
    r.fh = 0;
  }
  return r;
}

/**
 * ОСТАНОВКА: мир стоит, движется только он. `e` — настоящие секунды
 * остановки, `D` — её длина (мозг: 2,2 с, в полночь 1,6). Рывок к герою
 * (присел → вытянулся и растаял, на месте — остаточный образ; появился
 * сдвигом от прежнего места, затормозил); ставит ножи веером рук;
 * растаял вверх → появился в стороне; стоит, минутная поднята на XII;
 * перед концом — роняет её вперёд: «время пошло».
 */
function lPlace(e: number, D: number): LRig {
  const keys: LKf[] = [
    [0, CLAP_END],
    [0.1, { white: 0.85, sy: 1, sx: 1, hs: 0 }, lOut],
    [
      0.17,
      {
        fx: -3,
        fy: -17,
        fa: 2.7,
        fe: -1,
        bx: -12,
        by: -19,
        ba: 2.9,
        be: 1,
        bz: 0,
        fl: 24,
        bl: 15,
        lean: 3,
        drop: 3,
        sx: 1.06,
        sy: 0.94,
        hem: 1.5,
        white: 0.7,
      },
      lIO,
    ],
    [0.22, { lean: 6, drop: 1, sx: 1.22, sy: 0.86, hem: -3, op: 1 }, lIn],
    [0.29, { sx: 1.35, sy: 0.82, op: 0.08 }, lLin],
    [0.3, { op: 0.45, lean: -2.5, sx: 1.18, sy: 0.9, drop: 2 }, lLin],
    [0.37, { op: 1, sx: 1.1, sy: 0.9, drop: 3, lean: -1, hem: 2.5 }, lOut],
    [
      0.44,
      {
        fx: -2,
        fy: -20,
        fa: 2.5,
        fe: -1,
        bx: 5,
        by: -20,
        ba: 0.65,
        be: 1,
        bz: 1,
        sx: 1,
        sy: 1,
        drop: 1,
        lean: 0.5,
        white: 0.75,
      },
      lIO,
    ],
    [
      0.53,
      {
        fx: 16,
        fy: -28,
        fa: -0.35,
        fe: 1,
        bx: -16,
        by: -28,
        ba: 3.49,
        be: -1,
        drop: -1,
        lean: -0.5,
      },
      lOut,
    ],
    [
      0.62,
      { fx: 15, fy: -23, fa: 0.3, bx: -15, by: -23, ba: 2.84, drop: 0, lean: 0, white: 0.65 },
      lIO,
    ],
    [0.92, { fx: 15, fy: -22, fa: 0.36, bx: -15, by: -22, ba: 2.78, hy: -1 }, lIO],
    [
      1.0,
      {
        sx: 0.9,
        sy: 1.12,
        drop: -2,
        op: 1,
        fx: 10,
        fy: -30,
        fa: -1.0,
        bx: -10,
        by: -30,
        ba: 4.14,
        hy: 0,
      },
      lIn,
    ],
    [1.09, { sx: 0.72, sy: 1.32, op: 0.06 }, lLin],
    [1.1, { op: 0.45, sx: 0.88, sy: 1.14 }, lLin],
    [1.18, { op: 1, sx: 1.08, sy: 0.92, drop: 2 }, lOut],
    [
      1.27,
      {
        sx: 1,
        sy: 1,
        drop: 0,
        fx: 8,
        fy: -40,
        fa: -Math.PI / 2,
        fe: 1,
        bx: -10,
        by: -19,
        ba: 2.2,
        be: 1,
        bz: 0,
        white: 0.5,
        lean: -0.8,
      },
      lIO,
    ],
    [D - 0.12, { fx: 9, fy: -41, fa: -1.6, white: 0.45 }, lIO],
    [D - 0.04, { fx: 13, fy: -26, fa: 0.3, fe: -1, lean: 1, white: 0.3 }, lIn],
    [D, { fx: 13, fy: -25, fa: 0.35, lean: 1.2, white: 0.2, glow: 0.9 }, lOut],
  ];
  const r = ltrack(keys, e);
  // Только его часы идут: стрелки лица тикают восемь раз в секунду.
  if (e > 0.06) {
    r.fm = lTickQ(e - 0.06, 0.125) * (TAU / 12) * 8;
    r.fh = lTickQ(e - 0.06, 0.5) * (TAU / 12);
    r.halo = lTickQ(e, 0.125) * (TAU / 36);
  }
  return r;
}

/** Время пошло (отдых после остановки): с последней позы — в стойку. */
function lAfterPlace(t: number, h: number, D: number): LRig {
  const a = lPlace(D, D);
  const k = lIO(lclamp(t / (0.55 / h), 0, 1));
  return lmix(a, { ...L0, halo: a.halo, fm: a.fm }, k);
}

/** Хват клинков, воткнутых в ритуале: рукояти — там, где стоят. */
const RIT_PIN = { f: [14, 2, 1.72, 24], b: [-14, 2, 1.42, 17] } as const;
const ritHilt = (front: boolean): [number, number] => {
  const [x, y, a, l] = front ? RIT_PIN.f : RIT_PIN.b;
  const vis = l - 5;
  return [x - Math.cos(a) * vis, y - Math.sin(a) * vis];
};

/**
 * ОТМОТКА: втыкает обе стрелки в пол по бокам, из песка собирает песочные
 * часы, переворачивает их С УСИЛИЕМ (натяг → рывок → перевалило с
 * перелётом → стук), поднимает над головой; песок течёт, стрелки лица и
 * нимб идут назад, с подола поднимается песок. Трещины на стекле — сколько
 * порога снято (`m.data.vRit`).
 */
const RIT_FLIP = 1.45;
const RIT_UP = 1.95;
function lRitual(t: number, crack: number): LRig {
  const [fhx, fhy] = ritHilt(true);
  const [bhx, bhy] = ritHilt(false);
  const keys: LKf[] = [
    [0, {}],
    [
      0.12,
      {
        fx: 10,
        fy: -36,
        fa: -1.3,
        fe: 1,
        bx: -10,
        by: -36,
        ba: 4.44,
        be: -1,
        bz: 1,
        drop: -1,
        glow: 0.9,
        lean: -0.5,
      },
      lOut,
    ],
    [
      0.24,
      {
        fpin: 1,
        fpx: RIT_PIN.f[0],
        fpy: RIT_PIN.f[1],
        bpin: 1,
        bpx: RIT_PIN.b[0],
        bpy: RIT_PIN.b[1],
        fx: fhx,
        fy: fhy,
        bx: bhx,
        by: bhy,
        fe: -1,
        be: 1,
        drop: 3,
        sy: 0.94,
        sx: 1.04,
        lean: 1,
      },
      lIn,
    ],
    [0.32, { sy: 1, sx: 1, drop: 2 }, lOut],
    [
      0.38,
      {
        fpin: 2,
        bpin: 2,
        fa: RIT_PIN.f[2],
        ba: RIT_PIN.b[2],
        fl: RIT_PIN.f[3],
        bl: RIT_PIN.b[3],
        fx: 7,
        fy: -22,
        bx: -7,
        by: -22,
        drop: 0,
        lean: 0,
      },
      lIO,
    ],
    [0.45, { gl: 1, gs: 0, gx: 0, gy: -24, fx: 8, fy: -24, bx: -8, by: -24, fe: 1, be: -1 }, lIO],
    [0.72, { gs: 1, glow: 1 }, lOut],
    [1.0, { gr: 0.28, lean: -1.5, drop: 2, glow: 1.1, fy: -23, by: -25 }, lIn],
    [1.22, { gr: Math.PI + 0.3, lean: 0.5, drop: 1, fy: -24, by: -24 }, lOut],
    [1.32, { gr: Math.PI - 0.06, sy: 0.95, sx: 1.04, drop: 2 }, lIO],
    [RIT_FLIP, { gr: Math.PI, sy: 1, sx: 1, drop: 1 }, lIO],
    [RIT_UP, { gy: -29, fy: -29, by: -29, drop: -1, hy: -1, lean: -0.6, hem: -0.5 }, lIO],
  ];
  const r = ltrack(keys, t);
  // Натяг перед переворотом — руки дрожат.
  if (t > 0.78 && t < 1.0) r.fy += Math.floor(t * LFPS) % 2 ? 0.5 : -0.5;
  if (t >= RIT_FLIP) {
    r.gr = 0;
    r.gk = lclamp(1 - (t - RIT_FLIP) / (LORD.ritual - RIT_FLIP), 0, 1);
  } else r.gk = 0;
  r.gc = crack;
  if (t >= RIT_UP) {
    // Держит над головой: дышит тяжело, раз в секунду.
    const b = Math.round(0.5 - 0.5 * Math.cos((t - RIT_UP) * TAU));
    r.drop -= b;
  }
  if (t > 0.6) {
    // Отмотка: стрелки лица и нимб идут НАЗАД.
    const back = t - 0.6;
    r.fm = -lTickQ(back, 1 / 12) * 7;
    r.fh = 1.9 - lTickQ(back, 1 / 6) * 1.2;
    r.halo = -lTickQ(back, 1 / 12) * 1.1;
    r.glow = 1.05;
  }
  return r;
}

/** Отмотал (отдых после ритуала): часы рассыпаются светом, клинки — из пола. */
function lRegain(t: number, h: number): LRig {
  const R = 0.55 / h;
  const base = lRitual(LORD.ritual - 0.01, 0);
  const [fhx, fhy] = ritHilt(true);
  const [bhx, bhy] = ritHilt(false);
  const keys: LKf[] = [
    [0, {}],
    [0.1, { gs: 0, white: 0.9, glow: 1.25, sy: 1.05, sx: 0.97, hs: 1.5 }, lOut],
    [
      0.18,
      {
        gl: 0,
        white: 0.5,
        fx: fhx,
        fy: fhy,
        bx: bhx,
        by: bhy,
        fe: -1,
        be: 1,
        sy: 1,
        sx: 1,
        hs: 0,
        drop: 1,
        hy: 0,
        lean: 0,
      },
      lIO,
    ],
    [
      0.27,
      {
        fpin: 0,
        bpin: 0,
        fa: 1.2,
        ba: 1.9,
        fl: 24,
        bl: 15,
        fx: 10,
        fy: -20,
        bx: -10,
        by: -20,
        white: 0.2,
      },
      lOut,
    ],
    [R, { ...LREST, be: 1, bz: 0 }, lIO],
  ];
  return ltrack(keys, t, base);
}

/** Порог сорван: часы лопаются в руках, отшатнулся, рухнул на колено, оглушён. */
function lBroken(t: number): LRig {
  const base = lRitual(2.6, 2);
  const [fhx, fhy] = ritHilt(true);
  const [bhx, bhy] = ritHilt(false);
  const keys: LKf[] = [
    [0, { gc: 3 }],
    [
      0.07,
      {
        fx: 15,
        fy: -42,
        fe: 1,
        bx: -15,
        by: -44,
        be: -1,
        lean: -3,
        white: 0.6,
        gl: 0,
        hy: -2,
        hs: 1,
        crack: 1,
      },
      lOut,
    ],
    [0.25, { fx: 11, fy: -22, bx: -11, by: -24, lean: -4, drop: 2, hy: 0, white: 0.2, hs: 0 }, lIO],
    [
      0.5,
      {
        fx: 9,
        fy: -5,
        bx: -9,
        by: -5,
        fe: -1,
        be: 1,
        drop: 7,
        lean: 2.5,
        crack: 2,
        dim: 1,
        glow: 0,
        white: 0,
        hem: 1.5,
      },
      lIn,
    ],
    [0.58, { drop: 6, sy: 0.96 }, lOut],
    [0.66, { sy: 1 }, lIO],
    [1.9, { drop: 6, dim: 1 }],
    [2.1, { fx: fhx, fy: fhy, bx: bhx, by: bhy, drop: 5, lean: 1, dim: 0.4, glow: 0.4 }, lIO],
    [
      2.22,
      {
        fpin: 0,
        bpin: 0,
        fa: 1.2,
        ba: 2.0,
        fl: 24,
        bl: 15,
        fx: 10,
        fy: -20,
        bx: -10,
        by: -19,
        drop: 2,
        crack: 1,
      },
      lOut,
    ],
    [LORD.broken, { ...LREST, crack: 0, dim: 0, be: 1, bz: 0 }, lIO],
  ];
  const r = ltrack(keys, t, base);
  r.gk = 0.4;
  if (t > 0.5 && t < 2.0) {
    // Оглушён: голова кивает, стрелки лица повисли и качаются.
    r.hy = Math.round(Math.sin((t - 0.5) * 7));
    r.fm = Math.PI + Math.sin(t * 5) * 0.3;
    r.fh = Math.PI + 0.4;
  } else if (t <= 0.5) {
    // Сорвалось: стрелки лица бешено крутятся.
    r.fm = t * 40;
    r.fh = t * 9;
  }
  return r;
}

/** Выдохся после полуночи: на колено, клинки — в пол, тяжело дышит, пар. */
const TIRED_DOWN = 0.44;
const TIRED_UP = 2.3;
function lTired(t: number): LRig {
  const keys: LKf[] = [
    [0, {}],
    [
      0.28,
      {
        drop: 7,
        lean: 3,
        fpin: 1,
        fpx: 17,
        fpy: 1,
        bpin: 1,
        bpx: -16,
        bpy: 1,
        fx: 11,
        fy: -9,
        bx: -11,
        by: -9,
        dim: 0.85,
        glow: 0.2,
        hy: 1,
        hem: 1,
      },
      lIn,
    ],
    [0.36, { drop: 6, sy: 0.96 }, lOut],
    [TIRED_DOWN, { sy: 1 }],
    [TIRED_UP, { drop: 6 }],
    [
      2.55,
      { drop: 4, lean: 1.5, fx: 12, fy: -13, bx: -12, by: -13, dim: 0.5, glow: 0.4, hy: 0 },
      lIO,
    ],
    [
      2.66,
      { fpin: 0, bpin: 0, fa: 1.3, ba: 1.9, drop: 2, lean: 0.5, fx: 10, fy: -18, bx: -10, by: -18 },
      lOut,
    ],
    [LORD.tired, { ...LREST, dim: 0, be: 1 }, lIO],
  ];
  const r = ltrack(keys, t);
  if (t > TIRED_DOWN && t < TIRED_UP) {
    const b = Math.round(0.5 - 0.5 * Math.cos(((t - TIRED_DOWN) / 0.8) * TAU));
    r.drop += b;
    r.fy += b;
    r.by += b;
    r.dim = Math.floor(t * 3) % 4 === 0 ? 0.55 : 0.85;
  }
  if (t > 0.2 && t < 2.5) {
    r.fm = Math.PI - 0.25;
    r.fh = Math.PI + 0.35;
    r.pend = 0;
  }
  return r;
}

/** Удар героя по стоящему: голова и корпус отдают назад, нимб вздрагивает. */
function lHurt(f: number): LRig {
  const k = [1, 0.6, 0.25][f] ?? 0;
  return {
    ...L0,
    lean: -2.6 * k,
    hx: -Math.round(k),
    hy: -Math.round(k),
    glow: 0.5 + 0.6 * k,
    white: 0.25 * k,
    halo: 0.09 * k,
    fa: L0.fa - 0.25 * k,
    ba: L0.ba + 0.2 * k,
    fy: L0.fy - 2 * k,
    by: L0.by - k,
    hem: 1.5 * k,
    pend: 0.7 * k,
  };
}

/**
 * Смерть (1,6 с): удар — белая вспышка, руки разлетаются; трещины бегут по
 * стеклу, стрелки лица крутятся назад и ВСТАЮТ за минуту до полуночи; клинки
 * падают из рук и звякают об пол; оседает на колени; стекло выбито, лицо
 * гаснет; нимб соскальзывает и ложится; корпус сверху вниз рассыпается
 * шестернями, они падают, подпрыгивают и катятся.
 */
function lDeath(t: number): LRig {
  const keys: LKf[] = [
    [
      0,
      {
        lean: -3,
        hx: -1,
        hy: -1,
        white: 1,
        glow: 1.2,
        fx: 15,
        fy: -36,
        fa: -0.85,
        fe: 1,
        bx: -14,
        by: -34,
        ba: 3.99,
        be: -1,
        bz: 1,
        hem: 2,
      },
    ],
    [0.12, { white: 0.3, crack: 1, lean: -2 }, lOut],
    [
      0.3,
      {
        crack: 2,
        drop: 3,
        lean: -0.5,
        fpin: 3,
        bpin: 3,
        fx: 9,
        fy: -20,
        bx: -9,
        by: -20,
        fe: -1,
        be: 1,
      },
      lIO,
    ],
    [0.5, { drop: 9, lean: 3, fx: 6, fy: -9, bx: -6, by: -9, hy: 1, dim: 0.4, hem: 1 }, lIn],
    [0.56, { drop: 8, sy: 0.96 }, lOut],
    [0.62, { crack: 3, dim: 1, glow: 0, sy: 1, white: 0 }, lLin],
    [DEATH_T - 0.18, { op: 1 }],
    [DEATH_T, { op: 0 }, lIn],
  ];
  const r = ltrack(keys, t);
  if (t < 0.5) {
    r.fm = -lTickQ(t, LF1) * 30;
    r.fh = -lTickQ(t, LF1) * 6;
  } else {
    // Встали: без минуты полночь.
    r.fm = -0.105;
    r.fh = -0.03;
  }
  r.halo = t > 0.3 && t < 0.62 ? (Math.floor(t * LFPS) % 2 ? 0.06 : -0.06) : 0;
  r.pend = t < 0.4 ? Math.sin(t * 20) * 0.6 * (1 - t / 0.4) : 0.15;
  return r;
}

/** Смена фазы (на ходу): руки вверх, лицо вспыхивает, нимб — полный оборот. */
const PHASE_T = 0.9;
function lPhase(t: number): LRig {
  const keys: LKf[] = [
    [0, {}],
    [
      0.1,
      {
        fx: 14,
        fy: -37,
        fa: -0.9,
        fe: 1,
        bx: -14,
        by: -37,
        ba: 4.04,
        be: -1,
        bz: 1,
        white: 1,
        hs: 2,
        sy: 1.05,
        sx: 0.97,
        drop: -1,
        glow: 1.2,
        hy: -1,
      },
      lOut,
    ],
    [0.2, { white: 0.6, hs: 1, sy: 1, sx: 1 }, lIO],
    [0.55, { white: 0.3, hs: 0, hy: 0 }, lIO],
    [PHASE_T, { ...LREST, be: 1, bz: 0 }, lIO],
  ];
  const r = ltrack(keys, t);
  r.halo = lTickQ(lIO(lclamp((t - 0.08) / 0.6, 0, 1)), 1 / 24) * TAU;
  r.fm = lTickQ(lclamp(t / 0.7, 0, 1), 1 / 24) * TAU * 2;
  return r;
}

/** Полночь: на удар часов — минутная вверх и вниз, «дирижирует» боем. */
const TOLL_T = 0.55;
function lToll(t: number): LRig {
  const keys: LKf[] = [
    [0, {}],
    [0.12, { fx: 9, fy: -39, fa: -1.45, fe: 1, glow: 0.9, lean: -1, drop: -1 }, lOut],
    [0.17, { fx: 14, fy: -30, fa: -0.3 }, lIn],
    [
      0.21,
      {
        fx: 14,
        fy: -21,
        fa: 0.85,
        fe: -1,
        glow: 1.2,
        white: 0.6,
        hs: 1.5,
        sy: 0.96,
        sx: 1.04,
        drop: 1,
        lean: 1.5,
      },
      lLin,
    ],
    [0.3, { white: 0.2, hs: 0.5, sy: 1, sx: 1 }, lOut],
    [TOLL_T, { ...LREST }, lIO],
  ];
  return ltrack(keys, t);
}

// ---- Кадр: запрос → риг → холст; кеш `frameLRU`, влево — свой кадр ----

type LTech =
  | 'idle'
  | 'walk'
  | 'run'
  | 'roar'
  | 'hour'
  | 'minute'
  | 'spin'
  | 'clap'
  | 'place'
  | 'after'
  | 'ritual'
  | 'regain'
  | 'broken'
  | 'tired'
  | 'hurt'
  | 'death'
  | 'phase'
  | 'toll';

interface LReq {
  tech: LTech;
  /** Номер кадра техники. */
  f: number;
  /** Прицел: −2…2 — восьмые круга от «вперёд», вниз — плюс. */
  q: number;
  ph: number;
  /** Своё у техники: трещины часов в ритуале. */
  x: number;
  /** Смотрит влево: кадр отражён целиком, но циферблат идёт по часовой. */
  left: boolean;
}

/** Медленные техники идут на 12 к/с: [начало, к/с] по участкам. */
const LSEG: Partial<Record<LTech, [number, number][]>> = {
  ritual: [
    [0, 24],
    [RIT_UP, 12],
  ],
  broken: [
    [0, 24],
    [0.66, 12],
    [1.9, 24],
  ],
  tired: [
    [0, 24],
    [TIRED_DOWN, 12],
    [TIRED_UP, 24],
  ],
};

function lFrameOf(tech: LTech, t: number): number {
  const seg = LSEG[tech];
  if (!seg) return Math.floor(t * LFPS + 1e-6);
  let n = 0;
  for (let i = 0; i < seg.length; i++) {
    const [s0, fps] = seg[i];
    const s1 = i + 1 < seg.length ? seg[i + 1][0] : Infinity;
    if (t < s1) return n + Math.floor((t - s0) * fps + 1e-6);
    n += Math.ceil((s1 - s0) * fps - 1e-9);
  }
  return n;
}

function lTimeOf(tech: LTech, f: number): number {
  const seg = LSEG[tech];
  if (!seg) return f * LF1;
  let n = 0;
  for (let i = 0; i < seg.length; i++) {
    const [s0, fps] = seg[i];
    const s1 = i + 1 < seg.length ? seg[i + 1][0] : Infinity;
    const cnt = s1 === Infinity ? Infinity : Math.ceil((s1 - s0) * fps - 1e-9);
    if (f < n + cnt) return s0 + (f - n) / fps;
    n += cnt;
  }
  return 0;
}

const lStopDur = (ph: number) => (ph >= 3 ? 1.6 : LORD.stopDur);

function lRig(q: LReq, t: number): LRig {
  const h = lHaste(q.ph);
  const A = q.q * (Math.PI / 4);
  switch (q.tech) {
    case 'idle':
      return lIdle(q.f);
    case 'walk':
    case 'run':
      return lWalk(q.f, q.tech === 'run');
    case 'roar':
      return lRoar(t);
    case 'hour':
      return lHour(t, A, h);
    case 'minute':
      return lMinute(t, A, h);
    case 'spin':
      return lSpin(t, h);
    case 'clap':
      return lClap(t);
    case 'place':
      return lPlace(t, lStopDur(q.ph));
    case 'after':
      return lAfterPlace(t, h, lStopDur(q.ph));
    case 'ritual':
      return lRitual(t, q.x);
    case 'regain':
      return lRegain(t, h);
    case 'broken':
      return lBroken(t);
    case 'tired':
      return lTired(t);
    case 'hurt':
      return lHurt(q.f);
    case 'death':
      return lDeath(t);
    case 'phase':
      return lPhase(t);
    case 'toll':
      return lToll(t);
  }
}

/** След: сколько выборок и на какой отрезок назад (в кадрах). */
const LSMEAR: Partial<Record<LTech, [number, number, number]>> = {
  hour: [7, 1.2, 0.42],
  minute: [3, 1, 0.5],
  spin: [6, 1.7, 0.42],
  clap: [3, 1, 0.5],
  place: [3, 1, 0.5],
  toll: [3, 1, 0.45],
  regain: [3, 1, 0.5],
  broken: [3, 1, 0.5],
  roar: [3, 1, 0.5],
  phase: [3, 1, 0.5],
};

/** Холст из растра по рамке. */
function lCut(p: Px, x0: number, y0: number, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (g) {
    const img = g.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      const o = ((y0 + y) * p.w + x0) * 4;
      img.data.set(p.data.subarray(o, o + w * 4), y * w * 4);
    }
    g.putImageData(img, 0, 0);
  }
  return c;
}

function lBox(p: Px, box: number[]): boolean {
  let any = false;
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++)
      if (p.data[(y * p.w + x) * 4 + 3]) {
        any = true;
        if (x < box[0]) box[0] = x;
        if (y < box[1]) box[1] = y;
        if (x > box[2]) box[2] = x;
        if (y > box[3]) box[3] = y;
      }
  return any;
}

/** Кадры босса (обе стороны — отдельно): ~700 холстов с вытеснением давно не нужных. */
const LFR = frameLRU<MobFrame>(700);
/** Белые копии для вспышки удара: живут 0,12 с и делаются дёшево — свой кеш. */
const LFL = frameLRU<MobFrame>(80);

/** Сколько кадров нарисовано заново (замер стенда). */
export const F14_LORD_STAT = {
  drawn: 0,
  ms: 0,
  max: 0,
  get cached() {
    return LFR.size;
  },
};

function lordBase(q: LReq): MobFrame {
  const key = `b|${q.tech}|${q.f}|${q.q}|${q.ph}|${q.x}|${q.left ? 1 : 0}`;
  const got = LFR.get(key);
  if (got) return got;
  const t0 = performance.now();
  const t = lTimeOf(q.tech, q.f);
  const r = lRig(q, t);
  const L = LORD_LOOK[q.ph] ?? LORD_LOOK[0];
  const o: LOpt = { ph: q.ph, f: q.f };
  const h = lHaste(q.ph);
  if (q.tech === 'ritual') o.sandUp = t > 0.6 ? 1 : 0.35;
  if (q.tech === 'ritual' && t > 0.42 && t < 0.78) {
    // Часы собираются из песка: песчинки сходятся к рукам по спирали.
    const k = (t - 0.42) / 0.36;
    o.post = (p, lit, g) => {
      const cx = LCX + r.gx + g.sh(LG + r.gy);
      const cy = LG + r.gy + r.drop;
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * TAU + k * 5;
        const rr = (1 - k) * (8 + hash(i, 13) * 10) + 1;
        const x = Math.round(cx + Math.cos(a) * rr);
        const y = Math.round(cy + Math.sin(a) * rr * 0.8);
        p.set(x, y, i % 2 ? SAND[3] : TEAL[2]);
        lit.set(x, y, alpha(TEAL_GLOW, 0.7));
      }
    };
  }
  if (q.tech === 'broken') {
    const gx = LCX + 0;
    const gy = LG - 29 - 1;
    o.post = (p, lit, g, LL) => {
      if (t < 1.1) lShards(p, lit, gx + g.sh(gy), gy, t, 16, 61, true);
      if (t > 0.6 && t < 1.95) lOrbit(p, lit, g, q.f, LL);
    };
  }
  if (q.tech === 'tired' && t > TIRED_DOWN && t < TIRED_UP) {
    const ph = ((t - TIRED_DOWN) % 0.8) / 0.8;
    o.post = (p, lit, g) => {
      lSteam(p, lit, g, (ph - 0.45) / 0.5, 1);
      lSteam(p, lit, g, (ph - 0.5) / 0.45, -1);
    };
  }
  if (q.tech === 'death') {
    o.noHalo = t > 0.6;
    o.post = (p, lit, g, LL) => lDeathPost(p, lit, g, LL, t);
  }
  // Влево — кадр отражается целиком, а циферблат нет: лицо, нимб и
  // воротник рисуются с отражёнными углами, и после отражения кадра их
  // стрелки снова идут по часовой (движковое `sx < 0` отразило бы и их).
  const own = r.fdir >= 0.5;
  const rd = q.left ? { ...r, fm: own ? r.fm : -r.fm, fh: own ? r.fh : -r.fh, halo: -r.halo } : r;
  const pl = paintLord(rd, o);
  let p: Px = pl.p;
  let lit: Px = pl.lit;
  let eye = pl.eye;
  // След клинков (после контура: у следа нет тёмной каймы).
  const sm = LSMEAR[q.tech];
  if (sm) {
    const [n, span, inner] = sm;
    const F: LBlade[] = [];
    const B: LBlade[] = [];
    for (let i = 0; i <= n; i++) {
      const ti = t - (i * span * LF1) / n;
      if (ti < 0) break;
      const ri = i ? lRig(q, ti) : r;
      const gi = lGeo(ri);
      F.push(lBlade(ri, gi, true));
      B.push(lBlade(ri, gi, false));
    }
    if (F.every((b) => b.pin === 0)) lSmear(p, lit, F, L, inner);
    if (B.every((b) => b.pin === 0)) lSmear(p, lit, B, L, inner * 0.8);
  }
  if (q.tech === 'minute') {
    const T = LORD.minWarn / h;
    const tC = lHitT(T);
    const L1 = T + LORD.lunge;
    if (t >= tC - 1e-6 && t < L1) {
      const k = t < T + 0.05 ? 1 : lclamp(1 - (t - T - 0.05) / (L1 - T), 0.25, 1);
      lThrust(lit, p, lBlade(r, lGeo(r), true), k, L);
    }
  }
  if (q.tech === 'place') {
    const g = lGeo(r);
    if (t >= 0.19 && t < 0.3) lStreak(lit, p, g, (t - 0.19) / 0.11, false, L);
    else if (t >= 0.3 && t < 0.4) lStreak(lit, p, g, 1 - (t - 0.3) / 0.1, false, L);
    else if (t >= 0.98 && t < 1.1) lStreak(lit, p, g, (t - 0.98) / 0.12, true, L);
    else if (t >= 1.1 && t < 1.2) lStreak(lit, p, g, 1 - (t - 1.1) / 0.1, true, L);
  }
  if (q.tech === 'phase' && t < 0.45) {
    // Смена материала: сверху вниз проходит светлая полоса; ниже неё —
    // ещё прошлое (блёклое), выше — новое.
    const sy = Math.round(18 + (LG - 18) * (t / 0.45));
    for (let y = sy + 1; y < LH; y++)
      for (let x = 0; x < LW; x++) {
        const i = (y * LW + x) * 4;
        if (!p.data[i + 3]) continue;
        const l = (p.data[i] + p.data[i + 1] + p.data[i + 2]) / 3;
        p.data[i] = p.data[i] * 0.35 + l * 0.45;
        p.data[i + 1] = p.data[i + 1] * 0.35 + l * 0.45;
        p.data[i + 2] = p.data[i + 2] * 0.35 + l * 0.5;
      }
    for (let x = 0; x < LW; x++)
      for (const dy of [-1, 0])
        if (p.solid(x, sy + dy))
          lit.set(x, sy + dy, alpha(mixc(L.glow, WHITE, 0.6), dy ? 0.5 : 0.95));
  }
  if (q.left) {
    // Холст симметричен относительно точки ног (LW = 2·LCX): якорь на месте.
    p = p.flipX();
    lit = lit.flipX();
    if (eye) eye = [LW - 1 - eye[0], eye[1]];
  }
  // Холст — по рамке нарисованного.
  const box = [LW, LH, -1, -1];
  lBox(p, box);
  const hasLit = lBox(lit, box);
  if (box[2] < 0) box.splice(0, 4, LCX, LG - 1, LCX, LG);
  const x0 = Math.max(0, box[0] - 1);
  const y0 = Math.max(0, box[1] - 1);
  const w = Math.min(LW, box[2] + 2) - x0;
  const hh = Math.min(LH, box[3] + 2) - y0;
  const out: MobFrame = {
    img: lCut(p, x0, y0, w, hh),
    lit: hasLit ? lCut(lit, x0, y0, w, hh) : null,
    ax: LCX - x0,
    ay: LG - y0,
    eye: eye ? [eye[0] - x0, eye[1] - y0] : null,
    dx: q.left ? -r.dx : r.dx,
    dy: r.dy,
    sx: r.sx,
    sy: r.sy,
    rot: q.left ? -r.rot : r.rot,
    still: true,
    shadow: 13 * lclamp(r.op, 0.25, 1),
  };
  if (r.op < 0.999) out.alpha = lclamp(r.op, 0, 1);
  if (q.tech === 'death')
    out.shadow = 13 * (1 - 0.8 * lclamp((t - DEATH_SWEEP[0]) / DEATH_SWEEP[1], 0, 1));
  const ms = performance.now() - t0;
  F14_LORD_STAT.drawn++;
  F14_LORD_STAT.ms += ms;
  F14_LORD_STAT.max = Math.max(F14_LORD_STAT.max, ms);
  return LFR.set(key, out);
}

/** Смерть: клинки падают, нимб ложится, корпус рассыпается шестернями. */
function lDeathPost(p: ClipPx, lit: Px, g: LGeo, L: LordLook, t: number): void {
  // Выроненные клинки: падают, вращаясь, звякают и ложатся.
  if (t >= 0.3) {
    const k = lclamp((t - 0.3) / 0.22, 0, 1);
    const hop = t > 0.52 && t < 0.62 ? Math.sin(((t - 0.52) / 0.1) * Math.PI) * 1.6 : 0;
    const fx = LCX + 9 + (LCX + 5 - (LCX + 9)) * k;
    const fy = LG - 17 + (LG - 2 - (LG - 17)) * k * k - hop;
    minuteHand(p, fx, fy, -0.6 + (0.1 + 0.6) * lIn(k) + k * TAU * 0.5, 22, L.trim, null);
    const bx0 = LCX - 9 + (LCX - 6 - (LCX - 9)) * k;
    const by0 = LG - 15 + (LG - 2 - (LG - 15)) * k * k - hop * 0.7;
    hourHand(p, bx0, by0, 3.9 - (3.9 - (Math.PI - 0.08)) * lIn(k), 15, L.trim);
  }
  // Нимб соскальзывает за спину и ложится плашмя.
  if (t > 0.62) {
    const k = lclamp((t - 0.6) / 0.12, 0, 1);
    const cx = g.hx - 7 * k;
    const cy = g.hy + (LG - 4 - g.hy) * k * k;
    lCog(p, cx, cy, 13, 18, 0.5 * k, L.halo, 1, 4, 6, 1 - 0.74 * k);
  }
  // Осколки стекла лица.
  if (t > 0.62 && t < 1.1) lShards(p, lit, g.hx - 2, g.hy - 2, t - 0.62, 7, 71, false);
  // Распад: сверху вниз, клетки — в шестерни.
  const [s0, s1] = DEATH_SWEEP;
  if (t <= s0) return;
  const top = 18;
  const k = lclamp((t - s0) / s1, 0, 1);
  const line = top + (LG + 2 - top) * k;
  const gears = lDeathGears(p);
  for (let y = 0; y < Math.min(LH, Math.ceil(line) + 2); y++)
    for (let x = 0; x < LW; x++) {
      const i = (y * LW + x) * 4;
      if (!p.data[i + 3]) continue;
      // У кромки распада — рвано, через одну.
      if (y < line - 1 || (y < line + 2 && hash(x, y, 67) < 0.5)) p.data[i + 3] = 0;
    }
  const tones: Tones[] = [L.trim, L.halo, IRON, STEEL];
  for (const q of gears) {
    const rel = s0 + s1 * ((q.oy - top) / (LG + 2 - top));
    if (t < rel) continue;
    const [x, y, a] = lGearAt(q, t - rel);
    lCog(p, x, y, q.r, 6, a, tones[q.tone], 1, Math.max(0.5, q.r * 0.3));
    if (t - rel < 0.12) lit.set(Math.round(x), Math.round(y), alpha(L.glow, 0.8));
  }
}

function lFlashImg(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const g = c.getContext('2d');
  if (g) {
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.fillRect(0, 0, c.width, c.height);
  }
  return c;
}

function lordFrame(q: LReq, flash: boolean): MobFrame {
  const b = lordBase(q);
  if (!flash) return b;
  const key = `f|${q.tech}|${q.f}|${q.q}|${q.ph}|${q.x}|${q.left ? 1 : 0}`;
  const got = LFL.get(key);
  if (got) return got;
  return LFL.set(key, { ...b, img: lFlashImg(b.img) });
}

// ---- Рисовальщик: режим мозга → техника и кадр ----

interface LMem {
  now: number;
  walk: number;
  ph: number;
  phAt: number;
  toll: number;
  tollAt: number;
}
const lMem = new WeakMap<Mob, LMem>();

/** Прицел в кадре (смотрит вправо): восьмые круга, вниз — плюс. */
function lAim(m: Mob, left: boolean): number {
  const d = m.dir ?? 0;
  const a = left ? Math.PI - d : d;
  return lclamp(Math.round(Math.atan2(Math.sin(a), Math.cos(a)) / (Math.PI / 4)), -2, 2);
}

function lordReq(m: Mob, pose: MobPose): LReq {
  const sim = paintSim();
  const ph = lclamp(Math.round(m.data?.vPh ?? F14_FX.bossPhase), 0, 3);
  const h = lHaste(ph);
  let s = lMem.get(m);
  const fresh = !s;
  if (!s) {
    s = { now: pose.now, walk: 0, ph, phAt: -9, toll: F14_FX.midnight, tollAt: -9 };
    lMem.set(m, s);
  }
  const dt = lclamp(pose.now - s.now, 0, 0.1);
  s.now = pose.now;
  s.walk += Math.hypot(m.vx ?? 0, m.vy ?? 0) * 16 * dt;
  if (ph > s.ph && pose.mode !== 'dying') s.phAt = pose.now;
  s.ph = ph;
  if (F14_FX.midnight > s.toll && ph >= 3) s.tollAt = pose.now;
  s.toll = F14_FX.midnight;
  const q: LReq = { tech: 'idle', f: 0, q: 0, ph, x: 0, left: pose.left };
  const t = Math.max(0, pose.t);
  const at = (tech: LTech, tt: number, end = Infinity) => {
    q.tech = tech;
    q.f = lFrameOf(tech, Math.min(tt, end - 1e-4));
  };
  const Th = LORD.hourWarn / h;
  const Tm = LORD.minWarn / h;
  const Ts = LORD.spinWarn / h;
  const R = 0.55 / h;
  switch (pose.mode) {
    case 'roar':
      at('roar', t, ROAR_T);
      return q;
    case 'f14_hour':
      q.q = lAim(m, pose.left);
      at('hour', t, Th + R);
      return q;
    case 'f14_minute':
      q.q = lAim(m, pose.left);
      at('minute', t);
      return q;
    case 'f14_lunge':
      q.q = lAim(m, pose.left);
      at('minute', Tm + t, Tm + LORD.lunge + LORD.stuck + R);
      return q;
    case 'f14_stuck':
      q.q = lAim(m, pose.left);
      at('minute', Tm + LORD.lunge + t, Tm + LORD.lunge + LORD.stuck + R);
      return q;
    case 'f14_spin':
      at('spin', t, Ts + R);
      return q;
    case 'f14_clap':
      at('clap', t, LORD.clap);
      return q;
    case 'f14_place': {
      // Мир стоит, а его часы идут: настоящие секунды остановки.
      const D = lStopDur(ph);
      const e = sim ? (worldStopped(sim) ? D - sim.scaleT : D) : t;
      at('place', e, D);
      return q;
    }
    case 'recover': {
      const from = m.data?.vFrom ?? 0;
      if (from === 1) {
        q.q = lAim(m, pose.left);
        at('hour', Th + t, Th + R);
      } else if (from === 2) at('spin', Ts + t, Ts + R);
      else if (from === 3) {
        q.q = lAim(m, pose.left);
        const S = Tm + LORD.lunge + LORD.stuck;
        at('minute', S + t, S + R);
      } else if (from === 4) at('after', t, R);
      else if (from === 5) at('regain', t, R);
      else break;
      return q;
    }
    case 'f14_toHub':
      q.tech = 'run';
      q.f = Math.floor((((fresh ? pose.now * 66 : s.walk) / WALK_STRIDE) % 1) * WALK_N) % WALK_N;
      return q;
    case 'f14_ritual': {
      const v = m.data?.vRit ?? 0;
      q.x = v >= 0.67 ? 2 : v >= 0.34 ? 1 : 0;
      at('ritual', t, LORD.ritual);
      return q;
    }
    case 'f14_broken':
      at('broken', t, LORD.broken);
      return q;
    case 'f14_tired':
      at('tired', t, LORD.tired);
      return q;
    case 'dying':
      at('death', t, DEATH_T);
      return q;
  }
  // Погоня и отдых: смена фазы, удар полночи, отдача, шаг, покой.
  // (`vPhT`, `vTollT` — только для листа кадров: там моб новый на каждый
  // кадр, и сцена считается от начала режима.)
  const vPhT = m.data?.vPhT;
  const phT = vPhT !== undefined ? t - vPhT : pose.now - s.phAt;
  if (phT < PHASE_T) {
    at('phase', phT, PHASE_T);
    return q;
  }
  const vTollT = m.data?.vTollT;
  const tollT = vTollT !== undefined ? t - vTollT : pose.now - s.tollAt;
  if (ph >= 3 && tollT < TOLL_T) {
    at('toll', tollT, TOLL_T);
    return q;
  }
  const fl = m.flash ?? 0;
  if (fl > 0.01) {
    q.tech = 'hurt';
    q.f = fl > 0.08 ? 0 : fl > 0.04 ? 1 : 2;
    return q;
  }
  const sp = Math.hypot(m.vx ?? 0, m.vy ?? 0);
  if (pose.anim === 'run' || sp > 0.4) {
    q.tech = 'walk';
    const d = fresh ? pose.now * sp * 16 : s.walk;
    q.f = Math.floor(((d / WALK_STRIDE) % 1) * WALK_N) % WALK_N;
    return q;
  }
  // Покой — по часам этажа: в «ЧАС» он стоит вместе с миром.
  const ck = sim ? F14_FX.clock : pose.now;
  q.tech = 'idle';
  q.f = ((Math.floor(ck * 10 + (m.id ?? 0) * 3.7) % IDLE_N) + IDLE_N) % IDLE_N;
  return q;
}

registerMobPainter('f14boss', (m: Mob, pose: MobPose) => {
  const q = lordReq(m, pose);
  const t = Math.max(0, pose.t);
  // Смерть белым не мигает: копия убранного моба держит последнюю вспышку.
  const flash = pose.flash && (pose.mode !== 'dying' || t < 0.08);
  const out: MobFrame = { ...lordFrame(q, flash) };
  const left = pose.left;
  const sim = paintSim();
  // Отдача от удара героя — от героя, с возвратом.
  const fl = m.flash ?? 0;
  let rx = 0;
  let ry = 0;
  if (fl > 0 && pose.mode !== 'dying') {
    const age = lclamp(0.12 - fl, 0, 0.12);
    let ux = left ? 1 : -1;
    let uy = 0;
    if (sim) {
      const dx = m.x - sim.hero.x;
      const dy = m.y - sim.hero.y;
      const d = Math.hypot(dx, dy) || 1;
      ux = dx / d;
      uy = dy / d;
    }
    const soft = q.tech === 'idle' || q.tech === 'walk' || q.tech === 'hurt';
    const kk = Math.sin((age / 0.12) * Math.PI) * (soft ? 2.2 : 0.9);
    rx = ux * kk;
    ry = uy * kk * 0.6;
  }
  // Остановка: появился на новом месте — доезжает от прежнего сдвигом
  // кадра (шлейф ляжет по пути): «двигается один», а не телепорт.
  if (q.tech === 'place') {
    const e = lTimeOf('place', q.f);
    const slide = (k0: number, fx?: number, fy?: number) => {
      if (fx === undefined || fy === undefined || !Number.isFinite(fx)) return;
      const k = lclamp((e - k0) / 0.1, 0, 1);
      const w = 1 - lOut3(k);
      rx += (fx - m.x) * 16 * w;
      ry += (fy - m.y) * 16 * w;
    };
    if (e >= 0.3 && e < 0.4) slide(0.3, m.data?.vAx, m.data?.vAy);
    if (e >= 1.1 && e < 1.2) slide(1.1, m.data?.vBx, m.data?.vBy);
  }
  // Влево кадр уже отражён в пикселях (циферблат — нет), сдвиг и наклон —
  // уже в сторону взгляда: добавить только отдачу и доезд.
  out.dx = (out.dx ?? 0) + rx;
  out.dy = (out.dy ?? 0) + ry;
  // Шлейф — на быстром: выпад, рывки остановки, оборот, рубка часовой.
  const tt = lTimeOf(q.tech, q.f);
  const h = lHaste(q.ph);
  if (q.tech === 'minute') {
    const T = LORD.minWarn / h;
    if (tt >= lHitT(T) && tt < T + LORD.lunge + 0.02)
      out.ghost = { every: 0.022, life: 0.2, tint: '#fff0b0', alpha: 0.42 };
  } else if (q.tech === 'place') {
    if ((tt >= 0.17 && tt < 0.42) || (tt >= 0.98 && tt < 1.22))
      out.ghost = { every: 0.02, life: 0.32, tint: '#e8f0ff', alpha: 0.5 };
  } else if (q.tech === 'spin') {
    const T = lHitT(LORD.spinWarn / h);
    if (tt > T - 6 * LF1 && tt < T + 4 * LF1)
      out.ghost = { every: 0.03, life: 0.14, tint: '#ffd890', alpha: 0.25 };
  } else if (q.tech === 'hour') {
    const T = lHitT(LORD.hourWarn / h);
    if (tt > T - 2.5 * LF1 && tt < T + 1.5 * LF1)
      out.ghost = { every: 0.025, life: 0.13, tint: '#ffe0a0', alpha: 0.24 };
  }
  if (q.tech === 'death') out.linger = DEATH_T;
  return out;
});

// Прогрев: первая фаза в обе стороны — покой, шаг, пробуждение, обе
// стрелки (прицел вперёд), вращение, отдача, часовая вверх и вниз.
registerMobWarm('f14boss', function* () {
  const q: LReq = { tech: 'idle', f: 0, q: 0, ph: 0, x: 0, left: false };
  const run = function* (tech: LTech, n: number, aim = 0) {
    for (let f = 0; f < n; f++)
      for (const left of [false, true]) {
        lordBase({ ...q, tech, f, q: aim, left });
        yield f;
      }
  };
  yield* run('idle', IDLE_N);
  yield* run('walk', WALK_N);
  yield* run('roar', lFrameOf('roar', ROAR_T) + 1);
  yield* run('hour', lFrameOf('hour', LORD.hourWarn + 0.55) + 1);
  yield* run('minute', lFrameOf('minute', LORD.minWarn + LORD.lunge + LORD.stuck + 0.55) + 1);
  yield* run('spin', lFrameOf('spin', LORD.spinWarn + 0.55) + 1);
  yield* run('hurt', 3);
  yield* run('hour', lFrameOf('hour', LORD.hourWarn + 0.55) + 1, 1);
  yield* run('hour', lFrameOf('hour', LORD.hourWarn + 0.55) + 1, -1);
});

// ---------------------------------------------------------------------------
// Предметы. Живое берёт часы этажа (`F14_FX.clock`): в «ЧАС» они стоят
// вместе с миром — огоньки, маятники и шестерни замирают.
// ---------------------------------------------------------------------------

const sprites = new Map<string, Sprite>();

function sprite(key: string, build: () => { p: Px; ax: number; ay: number } | null): Sprite | null {
  const hit = sprites.get(key);
  if (hit) return hit;
  const b = build();
  if (!b) return null;
  const s: Sprite = { img: b.p.canvas(), ax: b.ax, ay: b.ay };
  sprites.set(key, s);
  return s;
}

const clk = () => F14_FX.clock;
const FIRE: Tones = tn('#8a1a06', '#e05a14', '#ffb040', '#fff4c0');

/** Огонёк: капля в три тона, кадр f качает верх. */
function flame(p: Px, x: number, y: number, h: number, f: number): void {
  const sway = [0, 1, 0, -1][f % 4];
  for (let i = 0; i < h; i++) {
    const k = i / h;
    const w = Math.max(0.5, (1 - k) * 1.6 + (k < 0.3 ? k : 0));
    const xx = x + sway * k * k;
    p.ell(xx, y - i, w, 0.6, k < 0.25 ? FIRE[1] : k < 0.6 ? FIRE[2] : FIRE[3]);
  }
  p.set(Math.round(x), Math.round(y - 1), FIRE[3]);
}

/** Латунная табличка/болты: точка света и тень. */
function rivet(p: Px, x: number, y: number, t: Tones = BRASS): void {
  p.set(x, y, t[3]);
  p.set(x + 1, y + 1, t[0]);
}

// ---- Настенное ------------------------------------------------------------

/**
 * Настенные часы: минутная стрелка — СЧЁТ ДО КОЛОКОЛА (на двенадцати бьёт
 * «ЧАС»), за три секунды циферблат разгорается. Маятник под ним качается.
 */
registerPropPainter('f14_wallclock', (o) => {
  const P = Math.max(1, F14_FX.bellP);
  const k = 1 - Math.max(0, Math.min(1, F14_FX.bellIn / P));
  const mb = Math.round(k * 24) % 24;
  const pb = Math.floor(clk() * 2.4 + o.x) % 4;
  const warn = F14_FX.bellIn < 3 && F14_FX.bellIn > 0 ? 1 + (Math.floor(clk() * 6) % 2) : 0;
  return sprite(`wc|${mb}|${pb}|${warn}`, () => {
    const p = new Px(16, 18);
    // Деревянный футляр.
    polyShade(
      p,
      [
        [2, 1],
        [14, 1],
        [14, 16],
        [2, 16],
      ],
      WOOD,
      0.1,
    );
    p.rect(3, 0, 13, 0, WOOD[3]);
    // Окошко маятника.
    p.rect(5, 12, 11, 15, hx('#0c0806'));
    const pa = [-0.35, 0, 0.35, 0][pb];
    const bx = 8 + Math.sin(pa) * 4;
    stroke(p, 8, 12, bx, 14.5, BRASS[1]);
    shadeEll(p, bx, 14.6, 1.2, 1, BRASS, 0.3);
    // Циферблат.
    dialFace(p, 8, 6.5, 5.6, (mb / 24) * TAU, 5.2, {
      glow: warn ? (warn === 2 ? hx('#ff5a3a') : AMBER) : null,
    });
    p.outline(INK);
    return { p, ax: 8, ay: 16 };
  });
});

/** Кукушкины часы: домик с крышей, дверца над циферблатом, шишки-гири. */
registerPropPainter('f14_cuckooclock', (o) => {
  const st = F14_FX.cuckoo.get(o.id) ?? 0;
  const pb = Math.floor(clk() * 2 + o.y) % 4;
  return sprite(`cu|${st}|${pb}`, () => {
    const p = new Px(20, 26);
    const ROOF = tn('#1a0e06', '#3a2010', '#5a3418', '#7a4a22');
    // Цепи и шишки-гири (свисают ниже стены).
    for (const [x, h] of [
      [6, 19],
      [13, 21],
    ] as [number, number][]) {
      for (let y = 14; y < h; y++) p.set(x, y, y % 2 ? IRON[3] : IRON[1]);
      shadeEll(p, x, h + 1.5, 1.6, 2.4, tn('#2a1a0c', '#5a3a1c', '#7a5028', '#a07038'), 0.1);
    }
    // Маятник-листок.
    const pa = [-0.3, 0, 0.3, 0][pb];
    stroke(p, 10, 14, 10 + Math.sin(pa) * 5, 21, BRASS[1]);
    shadeEll(p, 10 + Math.sin(pa) * 5.5, 22, 1.4, 1.8, BRASS, 0.2);
    // Корпус.
    polyShade(
      p,
      [
        [3, 5],
        [17, 5],
        [16, 15],
        [4, 15],
      ],
      WOOD,
      0.1,
    );
    // Крыша с резными листьями.
    polyShade(
      p,
      [
        [0, 6],
        [10, -1],
        [20, 6],
        [18, 7],
        [10, 1.5],
        [2, 7],
      ],
      ROOF,
      0.1,
    );
    for (let x = 2; x <= 18; x += 3) p.set(x, 7, hx('#5a7a2a'));
    // Дверца: закрыта, открыта (темно) или сломана (висит, торчит пружина).
    if (st === 0) {
      p.rect(8, 5, 12, 8, WOOD[2]);
      p.set(10, 5, WOOD[3]);
      p.set(11, 7, BRASS[3]);
    } else {
      p.rect(8, 5, 12, 8, hx('#050302'));
      if (st === 1) {
        p.rect(6, 5, 7, 8, WOOD[2]);
        p.rect(13, 5, 14, 8, WOOD[1]);
      } else {
        p.rect(12, 8, 13, 11, WOOD[1]);
        spring(p, 10, 8, 10, 3, 3, 1, BRASS[3], BRASS[1]);
      }
    }
    dialFace(p, 10, 11.5, 3.2, 1.2 + pb * 0.05, 3.8);
    p.outline(INK);
    return { p, ax: 10, ay: 17 };
  });
});

/** Трубы: медь, латунные муфты, манометр с дрожащей стрелкой, пар. */
registerPropPainter('f14_pipes', (o) => {
  const t = clk() + hash(o.x, o.y) * 7;
  const ph = t % 4.5;
  const puff = ph < 1 ? Math.min(3, Math.floor(ph * 4)) : -1;
  const needle = Math.floor(t * 3) % 3;
  return sprite(`pi|${puff}|${needle}`, () => {
    const p = new Px(16, 26);
    const o0 = 10;
    for (const x of [3, 11])
      for (let y = o0; y < o0 + 16; y++)
        for (let dx = -1; dx <= 1; dx++) p.set(x + dx, y, tone(COPPER, 0.5 - dx * 0.45));
    for (let x = 2; x <= 13; x++)
      for (let dy = -1; dy <= 1; dy++) p.set(x, o0 + 9 + dy, tone(COPPER, 0.5 - dy * 0.45));
    for (const [x, y] of [
      [3, o0 + 3],
      [11, o0 + 3],
      [3, o0 + 9],
      [11, o0 + 9],
    ])
      p.rect(x - 2, y, x + 2, y, BRASS[2]);
    // Манометр.
    shadeEll(p, 7, o0 + 4, 2.6, 2.6, BRASS, 0.1);
    p.ell(7, o0 + 4, 1.8, 1.8, ENAMEL[2]);
    const na = -2.2 + needle * 0.3;
    stroke(p, 7, o0 + 4, 7 + Math.cos(na) * 1.6, o0 + 4 + Math.sin(na) * 1.6, REDC[2]);
    // Вентиль.
    p.ell(11, o0 + 13, 2, 2, REDC[1]);
    p.set(11, o0 + 13, REDC[3]);
    p.outline(INK);
    // Пар из муфты — поверх контура, полупрозрачный.
    if (puff >= 0)
      for (let i = 0; i <= puff; i++) {
        const r = 1.2 + i * 0.8;
        p.ell(3 + i * 0.5, o0 + 2 - i * 3, r, r, alpha(hx('#e8e4dc'), 0.55 - i * 0.1));
      }
    return { p, ax: 8, ay: 26 };
  });
});

/** Заводной ключ Завода: огромная бородка торчит из стены и вращается. */
registerPropPainter('f14_key', () => {
  const spin = F14_FX.key.spin ? Math.floor(clk() * 6) % 4 : 1;
  const stopped = F14_FX.key.stopped;
  return sprite(`key|${spin}|${stopped}`, () => {
    const p = new Px(30, 30);
    const cx = 15;
    // Скважина в латунной плите.
    polyShade(
      p,
      [
        [9, 16],
        [21, 16],
        [21, 28],
        [9, 28],
      ],
      BRASS,
      0.05,
    );
    for (const [x, y] of [
      [10, 17],
      [19, 17],
      [10, 26],
      [19, 26],
    ])
      rivet(p, x, y);
    // Стержень — к нам.
    limb(p, cx, 22, cx, 17, 2, 2, IRON, 0.1);
    // Бородка: ширина по кадру вращения.
    const w = [10, 6.5, 2, 6.5][spin];
    shadeEll(p, cx, 9, w, 7, BRASS, 0.12);
    if (w > 3) shadeEll(p, cx, 9, w * 0.55, 3.6, tn('#050302', '#0c0806', '#140c08', '#1c120a'));
    if (stopped) {
      // Стопор: железная скоба поперёк.
      p.rect(cx - 12, 14, cx + 12, 15, IRON[2]);
      p.rect(cx - 12, 14, cx + 12, 14, IRON[3]);
    }
    p.outline(INK);
    return { p, ax: 15, ay: 28 };
  });
});

// ---- Пол: механизм ----------------------------------------------------------

registerPropPainter('f14_lamp', (o) => {
  const f = Math.floor(clk() * 8 + o.x * 3) % 4;
  return sprite(`lamp|${f}`, () => {
    const p = new Px(12, 30);
    const G = 29;
    // Основание и столб.
    polyShade(
      p,
      [
        [3, G - 2],
        [9, G - 2],
        [9, G],
        [3, G],
      ],
      IRON,
    );
    for (let y = 10; y < G - 2; y++) {
      p.set(5, y, IRON[2]);
      p.set(6, y, IRON[1]);
    }
    p.rect(4, 17, 7, 17, BRASS[2]);
    // Фонарь: латунная рама, стекло, огонь.
    p.rect(2, 3, 9, 3, BRASS[2]);
    p.rect(3, 2, 8, 2, BRASS[3]);
    p.rect(3, 4, 8, 9, alpha(hx('#ffe4a0'), 0.5));
    for (const x of [3, 8]) for (let y = 4; y <= 9; y++) p.set(x, y, BRASS[1]);
    p.rect(2, 10, 9, 10, BRASS[1]);
    p.set(5, 0, BRASS[3]);
    p.set(5, 1, BRASS[2]);
    p.outline(INK);
    flame(p, 5.5, 8.5, 4, f);
    return { p, ax: 6, ay: G };
  });
});

registerPropPainter('f14_column', () =>
  sprite('column', () => {
    const p = new Px(18, 36);
    const G = 34;
    const STONE = tn('#1c1814', '#3a322a', '#5a4e40', '#7e705c');
    for (let y = 6; y < G - 3; y++)
      for (let x = 3; x <= 14; x++) {
        const u = (x - 8.5) / 6;
        const flute = (x - 3) % 3 === 0 ? -0.2 : 0;
        p.set(x, y, tone(STONE, 0.5 - u * 0.6 + flute));
      }
    // Латунные пояса, капитель-шестерня, база.
    for (const y of [11, G - 7])
      for (let x = 3; x <= 14; x++) p.set(x, y, tone(BRASS, 0.55 - ((x - 8.5) / 6) * 0.6));
    cog(p, 8.5, 5, 7.5, 12, 0.13, BRASS, { hole: 0.1, spokes: 0 });
    polyShade(
      p,
      [
        [1, G - 3],
        [16, G - 3],
        [16, G],
        [1, G],
      ],
      STONE,
    );
    p.outline(INK);
    return { p, ax: 9, ay: G };
  }),
);

registerPropPainter('f14_crate', (_o, _t, _alive, flash) =>
  sprite(`crate|${flash ? 1 : 0}`, () => {
    let p = new Px(16, 17);
    const G = 16;
    // Верх — светлее, лицо — доски.
    p.rect(1, 3, 14, 6, WOOD[3]);
    p.rect(1, 7, 14, G - 1, WOOD[2]);
    for (let y = 8; y < G; y += 3) p.rect(1, y, 14, y, WOOD[1]);
    for (const x of [1, 14]) for (let y = 3; y < G; y++) p.set(x, y, WOOD[1]);
    // Латунные уголки и трафарет-шестерёнка.
    for (const [x, y] of [
      [1, 3],
      [13, 3],
      [1, G - 2],
      [13, G - 2],
    ])
      p.rect(x, y, x + 1, y + 1, BRASS[2]);
    cog(p, 8, 11, 3.2, 8, 0.2, tn('#1a0e06', '#2a1a0c', '#3a2410', '#4a3018'), {
      hole: 1,
      spokes: 0,
    });
    p.outline(INK);
    if (flash) p = p.tint(WHITE, 0.7);
    return { p, ax: 8, ay: G };
  }),
);

registerPropPainter('f14_barrel', (_o, _t, _alive, flash) =>
  sprite(`barrel|${flash ? 1 : 0}`, () => {
    let p = new Px(14, 18);
    const G = 17;
    for (let y = 3; y < G; y++)
      for (let x = 2; x <= 11; x++) {
        const u = (x - 6.5) / 5;
        p.set(x, y, tone(tn('#0c0c10', '#1c1c24', '#30303c', '#50505e'), 0.5 - u * 0.7));
      }
    p.ell(6.5, 3, 4.6, 1.6, hx('#08080a'));
    p.ell(6.5, 3, 3.2, 1, hx('#141418'));
    for (const y of [5, 10, 15])
      for (let x = 2; x <= 11; x++) p.set(x, y, tone(BRASS, 0.5 - ((x - 6.5) / 5) * 0.7));
    // Потёк масла.
    for (let y = 4; y < 9; y++) p.set(9, y, hx('#050506'));
    p.outline(INK);
    if (flash) p = p.tint(WHITE, 0.7);
    return { p, ax: 7, ay: G };
  }),
);

/** Верстак часовщика: тиски, лупа, россыпь колёсиков; одно крутится. */
registerPropPainter('f14_bench', (o) => {
  const f = Math.floor(clk() * 4 + o.x) % 4;
  return sprite(`bench|${f}`, () => {
    const p = new Px(24, 20);
    const G = 19;
    // Ножки.
    for (const x of [3, 20]) for (let y = 10; y <= G; y++) p.set(x, y, WOOD[1]);
    p.rect(3, 15, 20, 15, WOOD[0]);
    // Столешница (верх и кромка).
    p.rect(1, 5, 22, 8, WOOD[3]);
    p.rect(1, 9, 22, 10, WOOD[1]);
    // Тиски.
    p.rect(3, 2, 6, 5, IRON[2]);
    p.rect(3, 2, 6, 2, IRON[3]);
    // Шестерня в тисках — крутится.
    cog(p, 13, 5, 3, 8, (f / 4) * (TAU / 8), BRASS, { hole: 0.8, spokes: 0 });
    // Колёсики и лупа.
    p.set(9, 6, BRASS[3]);
    p.set(17, 7, STEEL[3]);
    p.set(18, 6, BRASS[2]);
    p.ell(20, 4, 1.8, 1.8, alpha(GLASS_HI, 0.8));
    stroke(p, 21, 5, 22, 7, WOOD[0]);
    p.outline(INK);
    return { p, ax: 12, ay: G };
  });
});

registerPropPainter('f14_gearpile', (o) =>
  sprite(`gpile|${(o.x + o.y) % 2}`, () => {
    const p = new Px(18, 14);
    const G = 13;
    cog(p, 6, 9, 4.6, 10, 0.1, IRON, { hole: 1, spokes: 0 });
    cog(p, 12, 10, 3.6, 8, 0.3, BRASS, { hole: 0.8, spokes: 0 });
    cog(p, 9, 5, 3.4, 8, (o.x % 3) * 0.2, BRASS, { hole: 0.8, spokes: 0 });
    cog(p, 14, 5, 2, 6, 0, COPPER, { hole: 0.4, spokes: 0 });
    p.outline(INK);
    return { p, ax: 9, ay: G };
  }),
);

/** Метроном: деревянная пирамидка, маятник с грузиком тикает. */
registerPropPainter('f14_metronome', (o) => {
  const f = Math.floor(clk() * 6 + o.x) % 8;
  return sprite(`metro|${f}`, () => {
    const p = new Px(14, 22);
    const G = 21;
    polyShade(
      p,
      [
        [3, G],
        [11, G],
        [8.5, 4],
        [5.5, 4],
      ],
      WOOD,
      0.1,
    );
    p.rect(4, G - 3, 10, G - 3, BRASS[2]);
    const a = Math.sin((f / 8) * TAU) * 0.55;
    const tx = 7 + Math.sin(a) * 11;
    const ty = G - 4 - Math.cos(a) * 11;
    stroke(p, 7, G - 4, tx, ty, STEEL[2]);
    p.rect(
      Math.round(7 + Math.sin(a) * 7) - 1,
      Math.round(G - 4 - Math.cos(a) * 7),
      Math.round(7 + Math.sin(a) * 7) + 1,
      Math.round(G - 4 - Math.cos(a) * 7) + 1,
      BRASS[3],
    );
    p.outline(INK);
    return { p, ax: 7, ay: G };
  });
});

/** Шестерня в провале: огромная, в полутьме; ходит медленно. */
registerPropPainter('f14_gear', (o) => {
  const r = Math.floor(clk() * 6 + o.x) % 8;
  return sprite(`pitgear|${r}`, () => {
    const p = new Px(62, 62);
    const DARK = tn('#0c0804', '#221608', '#3a2610', '#5a3e1c');
    cog(p, 31, 31, 29, 20, (r / 8) * (TAU / 20), DARK, { hole: 5, spokes: 6, tooth: 4 });
    // Смазка блестит на зубьях.
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * TAU + (r / 8) * (TAU / 20) + 0.08;
      if (Math.cos(a) * LX + Math.sin(a) * LY < 0.2) continue;
      p.set(Math.round(31 + Math.cos(a) * 27), Math.round(31 + Math.sin(a) * 27), BRASS[2]);
    }
    return { p, ax: 31 - 8, ay: 31 + 8 };
  });
});

/**
 * Зуб кольца: латунный брусок, остриём наружу, с гранью-торцом. Кольцо
 * ходит по такту — угол и место берём из правил этажа; привязка кадра
 * поправлена на долю клетки, иначе зуб прыгал бы по рядам.
 */
registerPropPainter('f14_tooth', (o) => {
  const t = F14_FX.teeth.get(o.id);
  const ang = t ? t.ang : 0;
  const y = t ? t.y : o.y + 0.5;
  const ab = ((Math.round((ang / TAU) * 32) % 32) + 32) % 32;
  const base = sprite(`tooth|${ab}`, () => {
    const p = new Px(24, 24);
    const a = (ab / 32) * TAU;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const pts = (cx: number, cy: number): [number, number][] => [
      [cx - ux * 5 - uy * 5, cy - uy * 5 + ux * 5],
      [cx + ux * 5 - uy * 3, cy + uy * 5 + ux * 3],
      [cx + ux * 5 + uy * 3, cy + uy * 5 - ux * 3],
      [cx - ux * 5 + uy * 5, cy - uy * 5 - ux * 5],
    ];
    // Торец (вниз на 5 точек) — тёмный, верх — светлый, по фаске.
    for (let k = 5; k >= 1; k--) poly(p, pts(12, 11 + k), k === 5 ? BRASS[0] : BRASS[1]);
    polyShade(p, pts(12, 11), BRASS, 0.15);
    const [x0, y0] = [12 + ux * 3.5, 11 + uy * 3.5];
    p.set(Math.round(x0), Math.round(y0), BRASS_HI);
    p.outline(INK);
    return { p, ax: 12, ay: 17 };
  });
  if (!base) return null;
  const ay = Math.round(17 + (Math.floor(y) + 1 - y) * 16 - 8);
  return { img: base.img, ax: base.ax, ay };
});

/** Ступица Зала шестерён: большое колесо на полу, идёт с кольцами. */
registerPropPainter('f14_hubgear', () => {
  const step = TAU / 16 / 6;
  const r = ((Math.round(F14_FX.gearAng / step) % 6) + 6) % 6;
  return sprite(`hub|${r}`, () => {
    const p = new Px(56, 56);
    cog(p, 28, 28, 25, 16, r * step, BRASS, {
      hole: 4,
      spokes: 6,
      tooth: 3.5,
      dark: hx('#140c06'),
    });
    cog(p, 28, 28, 9, 10, -r * step * 1.8, COPPER, { hole: 2, spokes: 0 });
    shadeEll(p, 28, 28, 2.6, 2.6, STEEL, 0.2);
    p.outline(INK);
    return { p, ax: 28, ay: 28 + 8 };
  });
});

/**
 * Маятник поперёк прохода: штанга уходит под потолок, лезвие-полумесяц
 * ходит по такту. Разогнанное лезвие светится — у края, почти стоящее,
 * оно тёмное: там и проходить.
 */
registerPropPainter('f14_pendulum', (o) => {
  const st = F14_FX.pend.get(o.id);
  const off = st ? st.off : 0;
  const hot = st && Math.abs(st.v) >= 1.6 ? 1 : 0;
  const ob = Math.round(off * 8);
  return sprite(`pend|${ob}|${hot}`, () => {
    const W = 96;
    const p = new Px(W, 54);
    const cx = W / 2;
    const bx = cx + ob * 2;
    const B = 44;
    // Тень лезвия на полу.
    p.ell(bx, 49, 8, 1.6, alpha(INK, 0.45));
    // Штанга: от оси под потолком к лезвию.
    stroke(p, cx, 0, bx, B - 3, IRON[2]);
    stroke(p, cx + 1, 0, bx + 1, B - 3, IRON[1]);
    // Груз на штанге.
    shadeEll(p, cx + (bx - cx) * 0.55, (B - 3) * 0.55, 2.6, 2.6, BRASS, 0.2);
    // Лезвие-полумесяц.
    for (let x = -8; x <= 8; x++) {
      const k = x / 8;
      const top = B - 3 + k * k * 3;
      for (let y = Math.round(top); y <= Math.round(top + 3 - Math.abs(k) * 2); y++)
        p.set(bx + x, y, y === Math.round(top) ? STEEL[3] : STEEL[2]);
    }
    p.outline(INK);
    if (hot)
      for (let x = -7; x <= 7; x++)
        p.set(bx + x, Math.round(B + 1 - Math.abs(x) * 0.15), hx('#ff7a4a'));
    return { p, ax: cx, ay: B + 12 };
  });
});

/** Люк под лебёдкой гири: чугунная крышка с болтами и полосами. */
registerPropPainter('f14_winch', () =>
  sprite('winch', () => {
    const p = new Px(20, 20);
    shadeEll(p, 10, 10, 9, 7.5, IRON, 0.1);
    shadeEll(p, 10, 10, 6.5, 5.2, tn('#0c0c10', '#1c1c24', '#2a2a34', '#3a3a48'), 0);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      p.set(Math.round(10 + Math.cos(a) * 7.8), Math.round(10 + Math.sin(a) * 6.4), BRASS[2]);
    }
    for (let x = 5; x <= 15; x++) if ((x >> 1) % 2) p.set(x, 10, hx('#c8a020'));
    return { p, ax: 10, ay: 10 + 8 };
  }),
);

/** Стопор: рычаг на станине; взведён — рукоять вверх, держит — вниз. */
registerPropPainter('f14_lever', (o) => {
  const on = F14_FX.levers.get(o.id) ?? 0;
  const blink = on ? 0 : Math.floor(clk() * 2) % 2;
  return sprite(`lever|${on}|${blink}`, () => {
    const p = new Px(16, 22);
    const G = 21;
    polyShade(
      p,
      [
        [2, G - 5],
        [14, G - 5],
        [14, G],
        [2, G],
      ],
      IRON,
      0.1,
    );
    p.rect(2, G - 6, 14, G - 6, IRON[3]);
    const a = on ? 0.9 : -0.9;
    const tx = 8 + Math.sin(a) * 11;
    const ty = G - 6 - Math.cos(a) * 11;
    stroke(p, 8, G - 6, tx, ty, STEEL[2], 2);
    shadeEll(p, tx, ty, 2, 2, REDC, 0.2);
    shadeEll(p, 8, G - 6, 1.6, 1.6, BRASS, 0.2);
    p.outline(INK);
    // Лампочка: зелёная — держит, мигает жёлтым — можно дёрнуть.
    p.set(12, G - 3, on ? hx('#7cff9a') : blink ? AMBER : hx('#5a4010'));
    return { p, ax: 8, ay: G };
  });
});

/** Планетарий Регуляторной: латунные кольца, солнце, планеты ходят. */
registerPropPainter('f14_orrery', () => {
  const f = Math.floor(clk() * 3) % 24;
  return sprite(`orrery|${f}`, () => {
    const p = new Px(40, 46);
    const G = 44;
    const cx = 20;
    const cy = 18;
    // Подставка.
    polyShade(
      p,
      [
        [cx - 8, G - 4],
        [cx + 8, G - 4],
        [cx + 10, G],
        [cx - 10, G],
      ],
      WOOD,
      0.1,
    );
    limb(p, cx, G - 4, cx, cy + 4, 1.4, 1.2, BRASS, 0.1);
    // Кольца орбит (эллипсы — вид сверху-сбоку).
    for (const [rx, ry] of [
      [17, 6],
      [12, 4.4],
      [7, 2.8],
    ] as [number, number][])
      for (let i = 0; i < 90; i++) {
        const a = (i / 90) * TAU;
        const x = cx + Math.cos(a) * rx;
        const y = cy + Math.sin(a) * ry;
        p.set(Math.round(x), Math.round(y), Math.sin(a) > 0 ? BRASS[2] : BRASS[1]);
      }
    // Солнце.
    shadeEll(p, cx, cy, 3.2, 3.2, tn('#8a4a06', '#e09a20', '#ffd060', '#fff4c0'), 0.3);
    // Планеты: у каждой своя скорость.
    const pl: [number, number, number, Tones][] = [
      [7, 2.8, 3, TEAL],
      [12, 4.4, 2, REDC],
      [17, 6, 1, tn('#1a2a4a', '#3a5a8a', '#6a8ac8', '#b0c8f0')],
    ];
    for (const [rx, ry, sp, t] of pl) {
      const a = (f / 24) * TAU * sp + rx;
      shadeEll(p, cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, 1.7, 1.7, t, 0.2);
    }
    p.outline(INK);
    return { p, ax: cx, ay: G };
  });
});

// ---- Пол: песочные часы ----------------------------------------------------

/** Струя песка с потолка: зерно бежит вниз, у пола — горка и брызги. */
registerPropPainter('f14_sandfall', (o) => {
  const f = Math.floor(clk() * 10 + o.x) % 4;
  return sprite(`sandfall|${f}`, () => {
    const p = new Px(16, 44);
    const B = 38;
    // Струя: плотное ядро, по краям — редкое зерно; к полу чуть шире.
    for (let y = 0; y < B; y++) {
      const w = 1.6 + (y / B) * 1.2;
      for (let x = Math.floor(7.5 - w - 1); x <= Math.ceil(7.5 + w); x++) {
        const d = Math.abs(x + 0.5 - 8) / w;
        const n = hash(x, (y + f * 4) >> 1, 7);
        if (d > 1 ? n < 0.8 : n < 0.08) continue;
        const core = d < 0.45;
        p.set(
          x,
          y,
          alpha(
            core ? (n > 0.5 ? SAND_FLOOR[3] : SAND_FLOOR[2]) : SAND_FLOOR[1],
            core ? 0.95 : 0.7,
          ),
        );
      }
    }
    // Горка и брызги.
    for (let x = 2; x <= 13; x++) {
      const u = (x - 7.5) / 6;
      const hgt = Math.round((1 - u * u) * 3);
      for (let y = 0; y < hgt; y++) p.set(x, B + 3 - y, y === hgt - 1 ? SAND[3] : SAND[2]);
    }
    for (let i = 0; i < 4; i++) p.set(3 + ((i * 3 + f * 2) % 10), B - 1 - ((i + f) % 3), SAND[3]);
    return { p, ax: 8, ay: B + 4 };
  });
});

/** Великие часы Зала отмотки: песок уходит к перевороту; якоря целы — светятся. */
registerPropPainter('f14_bigglass', () => {
  const G = F14_FX.bigGlass;
  const k = Math.round(G.k * 12);
  const f = Math.floor(clk() * 8) % 3;
  const flip = G.on && clk() - G.flip < 0.7 ? 1 : 0;
  return sprite(`bigglass|${k}|${f}|${G.broken}|${G.on}|${flip}`, () => {
    const p = new Px(34, 52);
    const B = 50;
    // Колонны рамы.
    hourglass(p, 17, 4, 28, B - 4, k / 12, G.on === 1 && !G.broken, f, {
      sand: G.on ? tn('#6a4a24', '#c89a50', '#f0cc80', '#fff4d0') : SAND,
      broken: G.broken === 1,
      glow: G.on && !G.broken ? AMBER : null,
    });
    // Резные шары на углах.
    for (const [x, y] of [
      [4, 4],
      [30, 4],
      [4, B],
      [30, B],
    ])
      shadeEll(p, x, y, 2.4, 2.4, BRASS, 0.2);
    if (G.broken)
      for (let i = 0; i < 14; i++)
        p.set(6 + Math.floor(hash(i, 3) * 22), B - 1 - Math.floor(hash(i, 5) * 3), SAND[2]);
    p.outline(INK);
    if (flip) p.ell(17, B / 2 + 2, 12, 22, alpha(WHITE, 0.35));
    return { p, ax: 17, ay: B };
  });
});

/** Якорь отмотки: бирюзовый кристалл в латунной люльке, пульсирует. */
registerPropPainter('f14_anchor', (o, _t, _alive, flash) => {
  const f = Math.floor(clk() * 5 + o.x) % 4;
  return sprite(`anchor|${f}|${flash ? 1 : 0}`, () => {
    let p = new Px(16, 24);
    const G = 23;
    polyShade(
      p,
      [
        [3, G - 3],
        [13, G - 3],
        [12, G],
        [4, G],
      ],
      BRASS,
      0.1,
    );
    // Кристалл — вытянутый ромб с гранями.
    poly(
      p,
      [
        [8, 2],
        [12, 11],
        [8, G - 3],
        [4, 11],
      ],
      (x, y) => (x < 8 ? (y < 11 ? TEAL[3] : TEAL[2]) : y < 11 ? TEAL[2] : TEAL[1]),
    );
    stroke(p, 8, 2, 8, G - 4, TEAL[0]);
    // Люлька: две латунные дуги.
    for (let y = 9; y < G - 3; y++) {
      p.set(Math.round(4 + (y - 9) * 0.12), y, BRASS[2]);
      p.set(Math.round(12 - (y - 9) * 0.12), y, BRASS[1]);
    }
    p.outline(INK);
    const glow = [0.25, 0.45, 0.6, 0.45][f];
    p.ell(8, 10, 3, 5, alpha(TEAL_GLOW, glow));
    p.set(7, 6, WHITE);
    if (flash) p = p.tint(WHITE, 0.7);
    return { p, ax: 8, ay: G };
  });
});

/** Малые часы на подставке: готовы — песок бежит, тёплый блик зовёт; перевёрнуты — бирюза. */
registerPropPainter('f14_glass', (o) => {
  const used = F14_FX.glasses.get(o.id) ?? 0;
  const f = Math.floor(clk() * 6 + o.y) % 4;
  return sprite(`glass|${used}|${f}`, () => {
    const p = new Px(14, 22);
    const G = 21;
    polyShade(
      p,
      [
        [2, G - 3],
        [12, G - 3],
        [11, G],
        [3, G],
      ],
      WOOD,
      0.1,
    );
    hourglass(p, 7, 2, 10, G - 5, used ? 0.85 : 0.5 - f * 0.03, !used, f, {
      sand: used ? TEAL : SAND,
      glow: used ? TEAL_GLOW : null,
    });
    p.outline(INK);
    if (!used && f === 0) p.set(4, 5, WHITE);
    return { p, ax: 7, ay: G };
  });
});

// ---- Пол: циферблат ---------------------------------------------------------

/** Колокол «ЧАС» на деревянной звоннице: ударили — качается и гудит. */
registerPropPainter('f14_bell', () => {
  const since = F14_FX.clock - F14_FX.bell;
  const ang = since >= 0 && since < 2.6 ? Math.sin(since * 7) * 0.45 * (1 - since / 2.6) : 0;
  const ab = Math.round(ang * 10);
  return sprite(`bell|${ab}`, () => {
    const p = new Px(36, 46);
    const G = 44;
    // Звонница: две стойки, перекладина, подпорки.
    for (const x of [4, 31]) {
      for (let y = 4; y <= G; y++) {
        p.set(x, y, WOOD[2]);
        p.set(x + 1, y, WOOD[1]);
      }
      stroke(p, x + (x < 18 ? -3 : 4), G, x + (x < 18 ? 1 : 0), G - 8, WOOD[1]);
    }
    p.rect(2, 3, 33, 5, WOOD[3]);
    p.rect(2, 6, 33, 6, WOOD[1]);
    // Колокол — поворот вокруг подвеса.
    const a = ab / 10;
    const px0 = 18;
    const py0 = 7;
    const R = (x: number, y: number): [number, number] => [
      px0 + x * Math.cos(a) - y * Math.sin(a),
      py0 + x * Math.sin(a) + y * Math.cos(a),
    ];
    const BRONZE = tn('#2a1606', '#6a3e14', '#a86a28', '#e8b060');
    const shape: [number, number][] = [];
    for (let i = 0; i <= 8; i++) {
      const y = 2 + i * 2.6;
      const w = 4 + Math.pow(i / 8, 2.2) * 8;
      shape.push(R(w, y));
    }
    for (let i = 8; i >= 0; i--) {
      const y = 2 + i * 2.6;
      const w = 4 + Math.pow(i / 8, 2.2) * 8;
      shape.push(R(-w, y));
    }
    polyShade(p, shape, BRONZE, 0.1);
    // Губа колокола и поясок.
    const [lx0, ly0] = R(-12, 23);
    const [lx1, ly1] = R(12, 23);
    stroke(p, lx0, ly0, lx1, ly1, BRONZE[0], 2);
    const [bx0, by0] = R(-6, 9);
    const [bx1, by1] = R(6, 9);
    stroke(p, bx0, by0, bx1, by1, BRONZE[3]);
    // Язык.
    const [cx1, cy1] = R(Math.sin(-a * 2) * 3, 24);
    stroke(p, px0, py0 + 2, cx1, cy1, IRON[2]);
    shadeEll(p, cx1, cy1 + 1, 1.6, 1.6, IRON, 0.2);
    p.outline(INK);
    return { p, ax: 18, ay: G };
  });
});

/** Маятник Стоп-кадра: стоит в крайней точке (время стоит), толкнёшь — идёт. */
registerPropPainter('f14_bigpendulum', () => {
  const go = F14_FX.frame;
  const a = go ? Math.sin(clk() * 2.4) * 0.5 : 0.48;
  const ab = Math.round(a * 16);
  return sprite(`bigpend|${ab}|${go}`, () => {
    const p = new Px(44, 64);
    const G = 62;
    const cx = 22;
    const ang = ab / 16;
    const L = 48;
    const bx = cx + Math.sin(ang) * L * 0.62;
    const by = 4 + Math.cos(ang) * L;
    // Кронштейн.
    p.rect(cx - 6, 0, cx + 6, 3, BRASS[1]);
    p.rect(cx - 6, 0, cx + 6, 0, BRASS[3]);
    stroke(p, cx, 3, bx, by - 6, BRASS[2], 2);
    stroke(p, cx + 1, 3, bx + 1, by - 6, BRASS[1]);
    // Диск с солнцем.
    shadeEll(p, bx, by, 7.5, 7.5, BRASS, 0.12);
    shadeEll(p, bx, by, 4.5, 4.5, tn('#8a4a06', '#e09a20', '#ffd060', '#fff4c0'), 0.3);
    for (let i = 0; i < 8; i++) {
      const aa = (i / 8) * TAU;
      p.set(Math.round(bx + Math.cos(aa) * 6), Math.round(by + Math.sin(aa) * 6), BRASS[3]);
    }
    // Тень на полу.
    p.ell(bx, G - 1, 7, 1.4, alpha(INK, 0.4));
    p.outline(INK);
    if (!go) {
      // Время стоит: следы-«кадры» пройденного пути застыли в воздухе.
      for (let k = 1; k <= 3; k++) {
        const aa = ang - k * 0.12;
        const qx = cx + Math.sin(aa) * L * 0.62;
        const qy = 4 + Math.cos(aa) * L;
        p.ell(qx, qy, 7 - k, 7 - k, alpha(hx('#dfe8ff'), 0.16));
      }
    }
    return { p, ax: cx, ay: G };
  });
});

/** Часовые лампы арены: гаснут по одной, когда бьёт полночь. */
registerPropPainter('f14_hourlamp', (o) => {
  const ar = F14_GEO.arena;
  const ay0 = (F14_TOP[F14_DIAL] ?? 0) + ar.y;
  const a = Math.atan2(o.y + 0.5 - ay0, o.x + 0.5 - ar.x);
  const hour = Math.round((((a + Math.PI / 2) / TAU) * 12 + 12 - 0.5) % 12);
  const out = hour < F14_FX.midnight ? 1 : 0;
  const f = Math.floor(clk() * 7 + o.x) % 4;
  return sprite(`hl|${out}|${out ? 0 : f}|${hour}`, () => {
    const p = new Px(12, 26);
    const G = 25;
    p.rect(4, G - 1, 7, G, IRON[2]);
    for (let y = 9; y < G - 1; y++) {
      p.set(5, y, IRON[2]);
      p.set(6, y, IRON[1]);
    }
    // Фонарик-клетка.
    p.rect(3, 2, 8, 2, BRASS[3]);
    for (const x of [3, 8]) for (let y = 3; y <= 8; y++) p.set(x, y, BRASS[1]);
    p.rect(3, 9, 8, 9, BRASS[2]);
    if (!out) p.rect(4, 3, 7, 8, alpha(hx('#ffe0a0'), 0.55));
    else p.rect(4, 3, 7, 8, hx('#0c0c14'));
    // Номер часа — зарубками на столбе.
    for (let i = 0; i < Math.min(4, (hour % 4) + 1); i++) p.set(7, 12 + i * 2, BRASS[3]);
    p.outline(INK);
    if (!out) flame(p, 5.5, 7.5, 4, f);
    else {
      // Погасла: тонкий дымок.
      p.set(5, 1, alpha(hx('#8a8a9a'), 0.6));
      p.set(6, 0, alpha(hx('#8a8a9a'), 0.4));
    }
    return { p, ax: 6, ay: G };
  });
});

// ---------------------------------------------------------------------------
// Клетки районов. Узор, который должен сшиваться с соседями (рябь песка,
// доски, шестерённый диск, циферблат), считается от МИРОВЫХ координат
// точки — стык клеток невидим. Кромки — по соседям (`markAt`).
// ---------------------------------------------------------------------------

const MK = F14_MARK;
const cells = new Map<string, Px>();

function cellOf(key: string, build: () => Px): Px {
  const hit = cells.get(key);
  if (hit) return hit;
  const p = build();
  cells.set(key, p);
  return p;
}

/** Мировая точка пикселя клетки. */
const wpt = (c: CellCtx, x: number, y: number): [number, number] => [
  c.wx + (x + 0.5) / 16,
  c.wy + (y + 0.5) / 16,
];

/** Кромка: сосед не той же породы (по списку меток). */
function edges(c: CellCtx, same: (k: number) => boolean) {
  return {
    n: !same(c.markAt(0, -1)),
    s: !same(c.markAt(0, 1)),
    w: !same(c.markAt(-1, 0)),
    e: !same(c.markAt(1, 0)),
  };
}

/** Копия клетки, чтобы рисовать поверх, не трогая кеш. */
function dup(p: Px): Px {
  const q = new Px(p.w, p.h);
  q.data.set(p.data);
  return q;
}

/** Наложить `src` поверх `dst` с прозрачностью. */
function lay(dst: Px, src: Px): Px {
  for (let y = 0; y < src.h; y++)
    for (let x = 0; x < src.w; x++) {
      const c = src.get(x, y);
      if (c[3]) dst.set(x, y, c);
    }
  return dst;
}

/** Места и центры, которые не вывести из меток: великие часы, колокол. */
function findIn(rows: readonly string[], ch: string): [number, number] {
  for (let y = 0; y < rows.length; y++) {
    const x = rows[y].indexOf(ch);
    if (x >= 0) return [x + 0.5, y + 0.5];
  }
  return [0, 0];
}
const BIGGLASS_AT = findIn(MAP_F14_SAND, 'Z');
const BELL_AT = findIn(MAP_F14_DIAL, '4');

// ---- Механизм --------------------------------------------------------------

const TREAD = tn('#2a1c0c', '#5a4020', '#8a6834', '#c09a4c');

/**
 * Рифлёный латунный лист: листы по две клетки, короткие рёбра наискось
 * «ёлочкой» (как на настоящем рифлёном железе), у кромки — фаска и заклёпки.
 */
function brassCell(c: CellCtx): Px {
  const same = (k: number) =>
    k === MK.brass || k === MK.stripe || k === MK.rank || k === MK.crack || k === MK.oil;
  const e = edges(c, same);
  const ox = (c.wx & 1) * 16;
  const oy = (c.wy & 1) * 16;
  // Тоны берутся по номеру, а не через порог `tone`: основа сидела ровно на
  // пороге 0,42, и шум перекидывал каждый пиксель то в тёмный, то в средний
  // тон — рифлёный лист выходил наждачным «лабиринтом».
  return cellOf(`brass|${+e.n}${+e.s}${+e.w}${+e.e}|${ox}${oy}`, () => {
    const p = new Px(16, 16);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const X = ox + x;
        const Y = oy + y;
        let k = 2;
        // Рифы «чечевицей»: в квадрате 8×8 два коротких ребра — «/» и «\»;
        // верх ребра на свету, под ним тень.
        const bx = X % 8;
        const by = Y % 8;
        if ((bx === 1 && by === 3) || (bx === 2 && by === 2) || (bx === 3 && by === 1)) k = 3;
        else if ((bx === 2 && by === 3) || (bx === 3 && by === 2)) k = 1;
        if ((bx === 5 && by === 5) || (bx === 6 && by === 6) || (bx === 7 && by === 7)) k = 3;
        else if ((bx === 5 && by === 6) || (bx === 6 && by === 7)) k = 1;
        // Затёртость: редкие тёмные точки.
        else if (k === 2 && hash(X, Y, 5) < 0.05) k = 1;
        // Шов листа: две клетки — один лист.
        if (X % 32 === 0 || Y % 32 === 0) k = 0;
        else if (X % 32 === 1 || Y % 32 === 1) k = 3;
        else if (X % 32 === 31 || Y % 32 === 31) k = 1;
        p.set(x, y, TREAD[k]);
      }
    if (e.n)
      for (let x = 0; x < 16; x++) {
        p.set(x, 0, TREAD[3]);
        p.set(x, 1, TREAD[2]);
      }
    if (e.w) for (let y = 0; y < 16; y++) p.set(0, y, TREAD[2]);
    if (e.s) for (let x = 0; x < 16; x++) p.set(x, 15, TREAD[0]);
    if (e.e) for (let y = 0; y < 16; y++) p.set(15, y, TREAD[0]);
    for (const [x, y] of [
      [2, 2],
      [13, 2],
      [2, 13],
      [13, 13],
    ])
      if (
        (y < 8 ? e.n || oy === 0 : e.s || oy === 16) &&
        (x < 8 ? e.w || ox === 0 : e.e || ox === 16)
      )
        rivet(p, x, y, BRASS);
    return p;
  });
}

/** Метки, на которые можно положить мелочь (трещину, масло, песок). */
const FLOOR_LOOK = new Set<number>([
  0,
  MK.brass,
  MK.dune,
  MK.stone,
  MK.parquet,
  MK.still,
  MK.runner,
  MK.dial,
]);

/** Мелочь поверх пола соседей: трещина или пятно ложатся на их узор. */
function onBase(c: CellCtx, paint: (c: CellCtx) => Px | null, over: Px): Px {
  const cnt = new Map<number, number>();
  for (const [dx, dy] of [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ]) {
    const k = c.markAt(dx, dy);
    if (FLOOR_LOOK.has(k)) cnt.set(k, (cnt.get(k) ?? 0) + 1);
  }
  let best = 0;
  let n = 0;
  for (const [k, v] of cnt)
    if (v > n) {
      best = k;
      n = v;
    }
  if (!best) return over;
  const b = paint({ ...c, mark: best });
  return b ? lay(dup(b), over) : over;
}

function crackOver(c: CellCtx): Px {
  return cellOf(`crack|${(c.wx * 7 + c.wy * 3) % 4}`, () => {
    const p = new Px(16, 16);
    const v = (c.wx * 7 + c.wy * 3) % 4;
    let x = 2 + v * 3;
    let y = 0;
    while (y < 16) {
      p.set(x, y, alpha(INK, 0.85));
      p.set(x + 1, y, alpha(hx('#8a7a60'), 0.45));
      y += 1;
      x += hash(x, y, v) > 0.6 ? 1 : hash(x, y, v + 1) > 0.7 ? -1 : 0;
      if (y === 7) for (let k = 1; k < 5; k++) p.set(x - k, y + (k >> 1), alpha(INK, 0.7));
    }
    for (let i = 0; i < 6; i++)
      p.set(Math.floor(hash(i, v) * 16), Math.floor(hash(v, i) * 16), alpha(hx('#8a7a60'), 0.6));
    return p;
  });
}

function oilOver(c: CellCtx): Px {
  return cellOf(`oil|${(c.wx + c.wy * 5) % 3}`, () => {
    const p = new Px(16, 16);
    const v = (c.wx + c.wy * 5) % 3;
    const cx = 6 + v * 2;
    const cy = 8 - v;
    p.ell(cx, cy, 5.5, 3.6, alpha(hx('#050404'), 0.7));
    p.ell(cx + 3, cy + 3, 2.4, 1.6, alpha(hx('#050404'), 0.6));
    // Радужная плёнка.
    p.set(cx - 2, cy - 1, alpha(hx('#6a4aa8'), 0.7));
    p.set(cx - 1, cy - 1, alpha(hx('#3a8a8a'), 0.7));
    p.set(cx, cy - 2, alpha(hx('#a88a3a'), 0.6));
    return p;
  });
}

/** Рассыпанная мелочь мастерской: винтики, шайбы, обрывок пружины. */
function debrisOver(c: CellCtx): Px {
  return cellOf(`debris|${(c.wx * 5 + c.wy * 3) % 4}`, () => {
    const p = new Px(16, 16);
    const v = (c.wx * 5 + c.wy * 3) % 4;
    for (let i = 0; i < 3; i++) {
      const x = 2 + Math.floor(hash(i, v, 3) * 11);
      const y = 3 + Math.floor(hash(v, i, 4) * 10);
      if (i === 0) {
        p.ell(x + 0.5, y + 0.5, 1.6, 1.2, BRASS[2]);
        p.set(x, y, INK);
      } else if (i === 1) {
        p.set(x, y, STEEL[3]);
        p.set(x + 1, y, STEEL[2]);
        p.set(x + 2, y + 1, STEEL[1]);
      } else spring(p, x, y, x + 5, y + 1, 2, 1, BRASS[3], BRASS[1]);
    }
    return p;
  });
}

/** Полосы «опасно» у механизмов: наискось по мировым координатам. */
function stripeCell(c: CellCtx): Px {
  return cellOf(`stripe|${(c.wx - c.wy) & 3}`, () => {
    const p = new Px(16, 16);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const d = (((c.wx * 16 + x - (c.wy * 16 + y)) % 16) + 16) % 16;
        const yel = d < 8;
        const worn = hash(x, y, c.wx) > 0.88;
        p.set(
          x,
          y,
          yel ? (worn ? hx('#7a5a10') : hx('#b8901c')) : worn ? hx('#2a2418') : hx('#16120c'),
        );
      }
    return p;
  });
}

/** Дорожка маятника: чугунная плита, по середине — щель, по краям — царапины. */
function trackCell(c: CellCtx): Px {
  const W = c.markAt(-1, 0) === MK.track;
  const E = c.markAt(1, 0) === MK.track;
  if (!W && !E) return onBase(c, (q) => mechBase(q), debrisOver(c));
  return cellOf(`track|${+W}${+E}`, () => {
    const p = new Px(16, 16);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++)
        p.set(x, y, tone(IRON, 0.35 + (y < 2 ? 0.25 : 0) + (hash(x, y, 4) - 0.5) * 0.1));
    for (let x = W ? 0 : 3; x <= (E ? 15 : 12); x++) {
      p.set(x, 7, hx('#050408'));
      p.set(x, 8, hx('#0a0810'));
      p.set(x, 6, IRON[0]);
      p.set(x, 9, IRON[3]);
    }
    // Дуги царапин — лезвие чиркает по краю хода.
    for (let x = 0; x < 16; x++) {
      if ((x + (W ? 1 : 0)) % 5 === 0) p.set(x, 11, IRON[3]);
      if ((x + 2) % 6 === 0) p.set(x, 4, IRON[3]);
    }
    return p;
  });
}

/** Решётка над механизмом: снизу тёплый свет и тени шестерён. */
function grateCell(c: CellCtx): Px {
  return cellOf(`grate|${(c.wx + c.wy) % 2}`, () => {
    const p = new Px(16, 16);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const bar = x % 4 === 0 || y % 4 === 0;
        if (bar) p.set(x, y, tone(IRON, x % 4 === 0 ? 0.55 : 0.3));
        else {
          const warm = hash(x >> 2, y >> 2, c.wx + c.wy) > 0.5;
          p.set(x, y, warm ? hx('#3a1e08') : hx('#120a06'));
        }
      }
    return p;
  });
}

/** Провал к механизму: чёрная шахта, латунный край, внизу поблёскивают зубья. */
function pitCell(c: CellCtx): Px {
  const lip = c.markAt(0, -1) !== MK.pit;
  const lw = c.markAt(-1, 0) !== MK.pit;
  const le = c.markAt(1, 0) !== MK.pit;
  return cellOf(`pit|${+lip}${+lw}${+le}|${(c.wx * 3 + c.wy) % 4}`, () => {
    const p = new Px(16, 16);
    const v = (c.wx * 3 + c.wy) % 4;
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++)
        p.set(x, y, mixc(hx('#020101'), hx('#0e0804'), hash(x, y, v) * 0.5));
    for (let i = 0; i < 3; i++) {
      const x = 2 + Math.floor(hash(i, v, 1) * 12);
      const y = 5 + Math.floor(hash(v, i, 2) * 10);
      p.set(x, y, hx('#3a2610'));
      p.set(x + 1, y, hx('#5a3c18'));
    }
    if (lip) {
      // Латунный край и стенка шахты уходят вниз.
      for (let x = 0; x < 16; x++) {
        p.set(x, 0, BRASS[3]);
        p.set(x, 1, BRASS[1]);
        for (let y = 2; y < 7; y++) p.set(x, y, mixc(hx('#3a2a1c'), hx('#050302'), (y - 2) / 5));
      }
    }
    if (lw) for (let y = lip ? 2 : 0; y < 16; y++) p.set(0, y, hx('#2a1c10'));
    if (le) for (let y = lip ? 2 : 0; y < 16; y++) p.set(15, y, hx('#1a1008'));
    return p;
  });
}

/** Центр Зала шестерён в мировых координатах. */
function gearCenter(): [number, number] {
  const g = F14_GEO.gear;
  return [g.x, (F14_TOP[F14_MECH] ?? 0) + g.y];
}

/** Диск Зала шестерён: кольца стали и латуни, радиальные швы, желоба колец. */
function discCell(c: CellCtx): Px {
  const g = F14_GEO.gear;
  const [gx, gy] = gearCenter();
  const p = new Px(16, 16);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const [wx, wy] = wpt(c, x, y);
      const dx = wx - gx;
      const dy = wy - gy;
      const r = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      let col: RGBA;
      const grooveR = Math.abs(r - g.r[0]) < 0.5 ? g.r[0] : Math.abs(r - g.r[1]) < 0.5 ? g.r[1] : 0;
      if (grooveR) {
        // Желоб кольца: тёмный канал, латунные рельсы по краям.
        const d = r - grooveR;
        col =
          Math.abs(d) > 0.38
            ? BRASS[d < 0 ? 3 : 1]
            : mixc(hx('#07050a'), hx('#140e08'), hash(x, y) * 0.6);
      } else {
        const band = Math.floor(r * 2) % 2;
        const seam = Math.abs((((a / TAU) * 24 + 48) % 1) - 0.5) > 0.47;
        const l = 0.42 + (band ? 0.06 : -0.02) + (hash(x, y, 9) - 0.5) * 0.06;
        col = seam ? IRON[0] : tone(r < 3.2 ? TREAD : IRON, l + (r < 3.2 ? 0.1 : 0));
        if (Math.abs(r - 3.2) < 0.08 || Math.abs(r - 12) < 0.08) col = BRASS[2];
      }
      p.set(x, y, col);
    }
  return p;
}

/** Место в строю Завода: квадрат краской и стёртые следы сапог. */
function rankCell(c: CellCtx): Px {
  const q = dup(brassCell(c));
  for (let i = 2; i <= 13; i++)
    for (const [x, y] of [
      [i, 2],
      [i, 13],
      [2, i],
      [13, i],
    ])
      if ((i >> 1) % 2 === 0) q.set(x, y, alpha(hx('#d8d0b0'), 0.8));
  q.rect(5, 6, 6, 9, alpha(INK, 0.5));
  q.rect(9, 6, 10, 9, alpha(INK, 0.5));
  return q;
}

function wspotOver(): Px {
  return cellOf('wspot', () => {
    const p = new Px(16, 16);
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * TAU;
      p.set(
        Math.round(7.5 + Math.cos(a) * 7),
        Math.round(7.5 + Math.sin(a) * 6.5),
        (i >> 2) % 2 ? hx('#b8901c') : hx('#16120c'),
      );
    }
    return p;
  });
}

function hubCellMech(c: CellCtx): Px {
  const p = discCell(c);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, alpha(INK, 0.35));
  return p;
}

/** Пол механизма по метке (для подложки мелочи). */
/** Район по мировому ряду (рисовальщику видны только мировые координаты). */
function areaOfRow(wy: number): string {
  if (wy < (F14_TOP[F14_SAND] ?? 0)) return F14_DIAL;
  if (wy < (F14_TOP[F14_MECH] ?? 0)) return F14_SAND;
  return F14_MECH;
}

const DECK = tn('#1a1510', '#332c24', '#4e4436', '#7c6c54');

/**
 * Настил Механизма — пол без метки: чугунные листы два на два с фаской,
 * болтами по углам, потёртостью и пятнами масла. Раньше тут лежала общая
 * плита подземелья в тонировке — зернистая, как наждак, и чужая рядом с
 * латунным рифлёным листом залов.
 */
function deckCell(c: CellCtx): Px {
  const sx = c.wx >> 1;
  const sy = c.wy >> 1;
  const sv = Math.floor(hash(sx, sy, 41) * 6);
  return cellOf(`deck|${c.wx & 1}${c.wy & 1}|${sv}`, () => {
    const p = new Px(16, 16);
    const ox = (c.wx & 1) * 16;
    const oy = (c.wy & 1) * 16;
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const X = ox + x;
        const Y = oy + y;
        // Лист — тёмный тон; зерно — редкие точки средним и самым тёмным.
        const g = hash(X, Y, sv + 17);
        let k = g < 0.05 ? 2 : g > 0.96 ? 0 : 1;
        // Выдавленная рамка жёсткости по краю листа: свет сверху-слева.
        const d = Math.min(X, Y, 31 - X, 31 - Y);
        if (d === 3) k = X === 3 || Y === 3 ? 2 : 1;
        else if (d === 4) k = X === 28 || Y === 28 ? 0 : k;
        if (d === 0) k = 0;
        else if (d === 1) k = X === 1 || Y === 1 ? 2 : 0;
        // Потёртость ходом: посередине листа зерно светлее.
        if (k === 1 && Math.abs(Y - 16) < 5 && d > 5 && hash(X, Y, sv) < 0.12 + sv * 0.02) k = 2;
        p.set(x, y, DECK[k]);
      }
    // Болты по углам листа.
    for (const [X, Y] of [
      [6, 6],
      [25, 6],
      [6, 25],
      [25, 25],
    ]) {
      const lx = X - ox;
      const ly = Y - oy;
      if (lx >= 1 && lx < 15 && ly >= 1 && ly < 15) rivet(p, lx, ly, IRON);
    }
    // Пятно масла у части листов, царапины — у других.
    if (sv === 0 || sv === 3) {
      const cx = 16 + (sv - 1.5) * 3 - ox;
      const cy = 17 - oy;
      for (let y = 0; y < 16; y++)
        for (let x = 0; x < 16; x++) {
          const r = Math.hypot((x - cx) / 4.2, (y - cy) / 2.8);
          if (r < 1) p.set(x, y, alpha(hx('#0c0906'), 0.35 * (1 - r * r)));
          if (r > 0.55 && r < 0.7 && hash(x, y, 8) < 0.5) p.set(x, y, alpha(hx('#6a5a8a'), 0.18));
        }
    } else if (sv === 4) {
      for (let k = 0; k < 3; k++) {
        const x0 = 8 + k * 5 - ox;
        const y0 = 10 + k * 3 - oy;
        for (let t = 0; t < 6; t++) {
          const x = x0 + t;
          const y = y0 - (t >> 1);
          if (x >= 0 && x < 16 && y >= 0 && y < 16) p.set(x, y, alpha(DECK[3], 0.55));
        }
      }
    }
    return p;
  });
}

function mechBase(c: CellCtx): Px | null {
  if (c.mark === 0 && c.tile === 2) {
    const a = areaOfRow(c.wy);
    return a === F14_MECH ? deckCell(c) : a === F14_SAND ? packedCell(c) : parquetCell(c, false);
  }
  if (c.mark === MK.brass) return brassCell(c);
  if (c.mark === MK.dune) return duneCell(c);
  if (c.mark === MK.stone) return stoneCell(c);
  if (c.mark === MK.parquet) return parquetCell(c, false);
  if (c.mark === MK.still) return parquetCell(c, true);
  if (c.mark === MK.runner) return runnerCell(c);
  if (c.mark === MK.dial) return dialCell(c, DIAL_DAY, false);
  return null;
}

// ---- Лица стен ---------------------------------------------------------------

/** Панель под часы: тёмное дерево в латунной рамке. */
function panelFace(c: CellCtx, kind: 'wood' | 'green' | 'soot' | 'plate'): Px | null {
  if (!c.open(0, 1)) return null;
  return cellOf(`panel|${kind}|${c.wx % 2}`, () => {
    const p = new Px(16, 16);
    const T =
      kind === 'wood'
        ? WOOD
        : kind === 'green'
          ? tn('#06120a', '#10261a', '#1c3a28', '#2e5a3e')
          : kind === 'plate'
            ? BRASS
            : tn('#0c0a08', '#1a1612', '#2a241e', '#3a322a');
    for (let y = 1; y < 15; y++)
      for (let x = 1; x < 15; x++) {
        const l =
          0.45 +
          (kind === 'wood' ? (x % 4 === 0 ? -0.2 : 0) : 0) +
          (kind === 'green' && (x + y) % 4 === 0 ? 0.15 : 0);
        p.set(x, y, tone(T, l + (hash(x, y, 2) - 0.5) * 0.08 - (x > 12 ? 0.15 : 0)));
      }
    if (kind === 'soot')
      for (let y = 1; y < 15; y++)
        for (let x = 1; x < 15; x++) if (hash(x, y, 5) > 0.7) p.set(x, y, alpha(INK, 0.6));
    for (let x = 0; x < 16; x++) {
      p.set(x, 0, BRASS[2]);
      p.set(x, 15, BRASS[0]);
    }
    for (let y = 0; y < 16; y++) {
      p.set(0, y, BRASS[1]);
      p.set(15, y, BRASS[0]);
    }
    if (kind === 'plate')
      for (const [x, y] of [
        [2, 2],
        [12, 2],
        [2, 12],
        [12, 12],
      ])
        rivet(p, x, y, BRASS);
    return p;
  });
}

/** Стеклянная стенка колбы: за стеклом — песок и блики. */
function glassFace(c: CellCtx): Px | null {
  if (!c.open(0, 1)) return null;
  return cellOf(`gwall|${c.wx % 3}`, () => {
    const p = new Px(16, 16);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const dune = 9 + Math.sin((c.wx * 16 + x) * 0.3) * 2;
        p.set(
          x,
          y,
          y > dune
            ? tone(SAND, 0.4 + (y - dune) * 0.02)
            : mixc(hx('#0c1418'), hx('#1a2830'), y / 16),
        );
      }
    for (let i = 0; i < 10; i++) p.set((i + c.wx * 5) % 16, i, alpha(GLASS_HI, 0.35));
    for (let x = 0; x < 16; x++) {
      p.set(x, 0, BRASS[2]);
      p.set(x, 15, BRASS[1]);
    }
    return p;
  });
}

/** Окно Циферблата: ночь, звёзды, у одного из окон — луна; латунный переплёт. */
function windowFace(c: CellCtx): Px | null {
  if (!c.open(0, 1)) return null;
  const moon = (c.wx * 5 + c.wy) % 7 === 0;
  return cellOf(`window|${c.wx % 4}|${+moon}`, () => {
    const p = new Px(16, 16);
    const inArch = (x: number, y: number) =>
      x >= 3 && x <= 12 && y >= 2 && y <= 14 && (y > 6 || Math.hypot(x - 7.5, y - 6.5) < 5.2);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        if (!inArch(x, y)) {
          p.set(
            x,
            y,
            tone(tn('#141820', '#262c38', '#3a4252', '#565e70'), 0.45 - (x > 12 ? 0.15 : 0)),
          );
          continue;
        }
        const sky = mixc(hx('#0a1030'), hx('#1c2a5a'), y / 14);
        p.set(x, y, hash(x, y, c.wx) > 0.93 ? hx('#dfe8ff') : sky);
      }
    if (moon) {
      p.ell(9, 6, 2.2, 2.2, hx('#f0f0d8'));
      p.ell(10, 5.5, 1.8, 1.8, hx('#1c2a5a'));
    }
    for (let y = 2; y <= 14; y++) if (inArch(7, y)) p.set(7, y, BRASS[1]);
    for (let x = 3; x <= 12; x++) p.set(x, 9, BRASS[1]);
    p.rect(2, 14, 13, 14, BRASS[2]);
    return p;
  });
}

// ---- Песочные часы -------------------------------------------------------------

const SAND_FLOOR = tn('#5a4020', '#8a6a3a', '#b8945a', '#dcc08a');

/**
 * Дюны: гребни — тонкие светлые линии с тенью под ними, изгибаются по
 * мировым координатам; между гребнями — ровный песок с зерном.
 */
function duneCell(c: CellCtx): Px {
  const p = new Px(16, 16);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const [wx, wy] = wpt(c, x, y);
      const bend = Math.sin(wx * 0.55 + wy * 0.18) * 0.9 + Math.sin(wx * 0.17 - wy * 0.11) * 1.7;
      const ph = (((wy * 0.85 + bend) % 1) + 1) % 1;
      let l = 0.45 + (hash(x, y, c.wx ^ (c.wy << 3)) - 0.5) * 0.12;
      if (ph < 0.07) l += 0.3;
      else if (ph < 0.2) l -= 0.16;
      else l += (ph - 0.6) * 0.1;
      p.set(x, y, tone(SAND_FLOOR, l));
    }
  return p;
}

/** Утоптанный песок без ряби: переход между дюнами и камнем. */
function packedCell(c: CellCtx): Px {
  // Та же рябь, что у дюн, но притоптанная: тон ниже на шаг, гребень —
  // средним тоном, песчинки — редкими точками (по номеру тона: основа на
  // пороге `tone` давала сплошной шум).
  const p = new Px(16, 16);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const [wx, wy] = wpt(c, x, y);
      const bend = Math.sin(wx * 0.55 + wy * 0.18) * 0.9 + Math.sin(wx * 0.17 - wy * 0.11) * 1.7;
      const ph = (((wy * 0.85 + bend) % 1) + 1) % 1;
      const g = hash(x, y, c.wx ^ (c.wy << 3));
      let k = g < 0.1 ? 2 : g > 0.97 ? 0 : 1;
      if (ph < 0.08) k = g < 0.3 ? 3 : 2;
      p.set(x, y, SAND_FLOOR[k]);
    }
  const v = (c.wx * 7 + c.wy * 13) % 5;
  if (v === 0) p.ell(5 + (c.wx % 3) * 2, 6 + (c.wy % 3) * 2, 1.3, 0.9, SAND_FLOOR[0]);
  return p;
}

const SANDSTONE = tn('#3a2a18', '#6a5236', '#927252', '#b89a72');

/**
 * Плиты песчаника два на два, в швах песок. У каждой плиты свой тон и
 * свой износ: песок намело в швы (гуще с наветренной, северо-западной
 * стороны), у части — трещина, у части — стёртый угол. Одинаковые плиты
 * читались кафелем ванной, а не дном часов.
 */
function stoneCell(c: CellCtx): Px {
  const sx = c.wx >> 1;
  const sy = c.wy >> 1;
  const sv = Math.floor(hash(sx, sy, 71) * 6);
  return cellOf(`stone|${c.wx & 1}${c.wy & 1}|${sv}`, () => {
    const p = new Px(16, 16);
    const ox = (c.wx & 1) * 16;
    const oy = (c.wy & 1) * 16;
    // Плита светлая или тёмная (через одну — по зерну), а не «где-то на
    // пороге»: иначе шум перекидывал пиксели между тонами.
    const hi = sv % 2 === 0;
    const crack = sv === 1 || sv === 4;
    const worn = sv === 2 || sv === 5;
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const X = ox + x;
        const Y = oy + y;
        const seam = X % 32 === 0 || Y % 32 === 0;
        const edgeHi = X % 32 === 1 || Y % 32 === 1;
        const edgeLo = X % 32 === 31 || Y % 32 === 31;
        if (seam) {
          p.set(x, y, SAND_FLOOR[hash(X, Y, sv) < 0.7 ? 1 : 2]);
          continue;
        }
        // Нанос: у северного и западного края плиты, неровной кромкой.
        const dEdge = Math.min(X % 32, Y % 32);
        const drift = dEdge < 5 && hash(X, Y, sv + 9) < 0.55 - dEdge * 0.12;
        if (drift) {
          p.set(x, y, SAND_FLOOR[hash(X, Y, 3) < 0.25 ? 3 : 2]);
          continue;
        }
        // Стёртый угол: юго-восточный, пологой дугой.
        const rim = worn && Math.hypot(31 - X, 31 - Y) < 7;
        const g = hash(x, y, sv);
        let k = hi ? 2 : 1;
        if (g < 0.05) k -= 1;
        else if (g > 0.97) k += 1;
        if (edgeHi) k = hi ? 3 : 2;
        else if (edgeLo) k = 0;
        if (rim && k > 0 && !edgeLo) k -= 1;
        p.set(x, y, SANDSTONE[Math.max(0, Math.min(3, k))]);
      }
    if (crack) {
      // Трещина через плиту: ломаная, тёмная черта с песчинкой внутри.
      let x = 6 + ((sv * 5) % 18);
      for (let Y = 3; Y < 29; Y++) {
        if (hash(Y, sv, 5) < 0.35) x += hash(Y, sv, 6) < 0.5 ? -1 : 1;
        const lx = x - ox;
        const ly = Y - oy;
        if (lx >= 0 && lx < 16 && ly >= 0 && ly < 16) p.set(lx, ly, SANDSTONE[0]);
        if (lx + 1 >= 0 && lx + 1 < 16 && ly >= 0 && ly < 16)
          p.set(lx + 1, ly, tone(SANDSTONE, 0.7));
      }
    }
    return p;
  });
}

/**
 * Латунный обод: в Зале отмотки — круглый помост великих часов (кольца от
 * центра), в горловине — полоса обода с кромкой по соседям.
 */
function rimCell(c: CellCtx): Px {
  const cx = BIGGLASS_AT[0];
  const cy = (F14_TOP[F14_SAND] ?? 0) + BIGGLASS_AT[1];
  if (Math.hypot(c.wx + 0.5 - cx, c.wy + 0.5 - cy) < 6.5) {
    const p = dup(stoneCell(c));
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const [wx, wy] = wpt(c, x, y);
        const dx = wx - cx;
        const dy = wy - cy;
        const r = Math.hypot(dx, dy);
        if (r > 4.6) continue;
        const ring = r > 4.35 ? 0.1 : Math.floor(r * 2.5) % 2 ? 0.52 : 0.44;
        const lit = -(dx / (r || 1)) * 0.12 - (dy / (r || 1)) * 0.16;
        p.set(x, y, tone(TREAD, ring + (r > 4.35 ? 0 : lit)));
        if (Math.abs(r - 4.2) < 0.05) p.set(x, y, BRASS[3]);
      }
    return p;
  }
  const e = edges(c, (k) => k === MK.rim || k === MK.stream);
  return cellOf(`rim|${+e.n}${+e.s}${+e.w}${+e.e}`, () => {
    const p = new Px(16, 16);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) p.set(x, y, tone(TREAD, 0.48 + (hash(x, y, 1) - 0.5) * 0.05));
    // Гравировка: песочные часы и черты.
    for (let x = 0; x < 16; x += 4) p.set(x, 8, TREAD[0]);
    if (e.n) for (let x = 0; x < 16; x++) p.set(x, 0, BRASS[3]);
    if (e.s) for (let x = 0; x < 16; x++) p.set(x, 15, TREAD[0]);
    if (e.w) for (let y = 0; y < 16; y++) p.set(0, y, BRASS[2]);
    if (e.e) for (let y = 0; y < 16; y++) p.set(15, y, TREAD[0]);
    return p;
  });
}

/** Под струёй: горка сыпучего песка. */
function streamCell(c: CellCtx): Px {
  const p = duneCell(c);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const r = Math.hypot(x - 7.5, y - 7.5);
      if (r < 6.5) p.set(x, y, tone(SAND_FLOOR, 0.62 - r * 0.04 + (hash(x, y, 7) - 0.5) * 0.2));
    }
  return p;
}

function sandbitsOver(c: CellCtx): Px {
  return cellOf(`sbits|${(c.wx * 5 + c.wy) % 4}`, () => {
    const p = new Px(16, 16);
    const v = (c.wx * 5 + c.wy) % 4;
    for (let i = 0; i < 40; i++) {
      const x = Math.floor(hash(i, v, 1) * 16);
      const y = Math.floor(hash(v, i, 2) * 16);
      p.set(x, y, alpha(SAND_FLOOR[hash(i, v) > 0.6 ? 3 : 2], 0.75));
    }
    p.ell(4 + v * 2, 10, 3, 1.4, alpha(SAND_FLOOR[2], 0.6));
    return p;
  });
}

/**
 * Стеклянный пол над нижней колбой: сквозь толстое зеленоватое стекло
 * видно, как внизу ходит песок; латунные рамы по две клетки, блики.
 */
function glassCell(c: CellCtx): Px {
  const e = edges(c, (k) => k === MK.glass || k === MK.slow || k === MK.fast);
  const p = new Px(16, 16);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const [wx, wy] = wpt(c, x, y);
      const swirl = Math.sin(wx * 0.6 + wy * 0.35) + Math.sin(wy * 0.8 - wx * 0.25) * 0.8;
      const s = Math.max(0, Math.min(1, 0.5 + swirl * 0.3));
      const sand = mixc(SAND_FLOOR[0], SAND_FLOOR[2], s);
      p.set(x, y, mixc(sand, hx('#3a6a6e'), 0.42));
    }
  // Рамы стёкол: латунь раз в две клетки и по краю пола.
  if ((c.wx & 1) === 0 || e.w) for (let y = 0; y < 16; y++) p.set(0, y, BRASS[2]);
  if ((c.wy & 1) === 0 || e.n) for (let x = 0; x < 16; x++) p.set(x, 0, BRASS[3]);
  if (e.e) for (let y = 0; y < 16; y++) p.set(15, y, BRASS[0]);
  if (e.s) for (let x = 0; x < 16; x++) p.set(x, 15, BRASS[0]);
  // Блик по стеклу — короткие косые штрихи.
  if ((c.wx + c.wy) % 2 === 0)
    for (let i = 0; i < 5; i++) p.set(3 + i, 9 - i, alpha(hx('#dff8f4'), 0.55));
  return p;
}

/** Знак сферы на полу: песочные часы в круге — холодный (медленно) или тёплый. */
function sigilOver(fast: boolean): Px {
  return cellOf(`sigil|${+fast}`, () => {
    const p = new Px(16, 16);
    const col = fast ? AMBER : TEAL_GLOW;
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * TAU;
      p.set(
        Math.round(7.5 + Math.cos(a) * 6.6),
        Math.round(7.5 + Math.sin(a) * 6.6),
        alpha(col, 0.85),
      );
    }
    poly(
      p,
      [
        [4.5, 3.5],
        [11.5, 3.5],
        [8, 8],
      ],
      alpha(col, 0.7),
    );
    poly(
      p,
      [
        [4.5, 12.5],
        [11.5, 12.5],
        [8, 8],
      ],
      alpha(col, 0.7),
    );
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * TAU + (fast ? 0.3 : -0.3);
      p.set(Math.round(7.5 + Math.cos(a) * 5.2), Math.round(7.5 + Math.sin(a) * 5.2), WHITE);
    }
    return p;
  });
}

// ---- Циферблат -----------------------------------------------------------------

interface DialPal {
  base: Tones;
  line: RGBA;
  ink: RGBA;
  bezel: Tones;
  star?: boolean;
  arrows?: boolean;
  frost?: boolean;
}

/** Старая эмаль: слоновая кость, притемнённая — светильники её не выжигают. */
const DIAL_DAY: DialPal = {
  base: tn('#5a4a34', '#8a7552', '#ae986e', '#cfba90'),
  line: hx('#3a3022'),
  ink: hx('#140e08'),
  bezel: BRASS,
};
const DIAL_STOP: DialPal = {
  base: tn('#3a4456', '#627088', '#8a98b0', '#b4c2d8'),
  line: hx('#26324a'),
  ink: hx('#0a1020'),
  bezel: tn('#3a4250', '#7a8898', '#c0ccd8', '#f4faff'),
  frost: true,
};
const DIAL_REWIND: DialPal = {
  base: tn('#1a3c40', '#2e6066', '#4a868a', '#74b0b4'),
  line: hx('#0c2a2e'),
  ink: hx('#041416'),
  bezel: BRASS,
  arrows: true,
};
const DIAL_NIGHT: DialPal = {
  base: tn('#04060e', '#0a1026', '#141c3c', '#243060'),
  line: hx('#3a4a80'),
  ink: hx('#c8d4ff'),
  bezel: tn('#3a3e50', '#7a8098', '#c0c6dc', '#f4f6ff'),
  star: true,
};

/** Ближайший циферблат района: площадь «Полдень» или арена. */
function dialOf(wy: number): { cx: number; cy: number; R: number; N: number } {
  const top = F14_TOP[F14_DIAL] ?? 0;
  const pz = F14_GEO.plaza;
  const ar = F14_GEO.arena;
  const dp = Math.abs(wy - (top + pz.y));
  const da = Math.abs(wy - (top + ar.y));
  return dp < da
    ? { cx: pz.x, cy: top + pz.y, R: pz.r, N: pz.num }
    : { cx: ar.x, cy: top + ar.y, R: ar.r, N: ar.num };
}

/** Римские цифры 7 в высоту: I, V, X; над и под числом — черта, как на башенных часах. */
const GLYPH: Record<string, string[]> = {
  I: ['#', '#', '#', '#', '#', '#', '#'],
  V: ['#...#', '#...#', '.#.#.', '.#.#.', '.#.#.', '..#..', '..#..'],
  X: ['#...#', '.#.#.', '.#.#.', '..#..', '.#.#.', '.#.#.', '#...#'],
};
const ROMAN = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];

function numeral(p: Px, hour: number, ink: RGBA): void {
  const s = ROMAN[hour];
  const w = [...s].reduce((a, ch) => a + GLYPH[ch][0].length + 1, -1);
  let x0 = Math.round(8 - w / 2);
  const y0 = 4;
  for (const ch of s) {
    const g = GLYPH[ch];
    for (let y = 0; y < g.length; y++)
      for (let x = 0; x < g[y].length; x++) if (g[y][x] === '#') p.set(x0 + x, y0 + y, ink);
    x0 += g[0].length + 1;
  }
  const L = Math.round(8 - w / 2) - 1;
  for (let x = L; x <= L + w + 1; x++) {
    p.set(x, y0 - 2, ink);
    p.set(x, y0 + 8, ink);
  }
}

/** Эмаль циферблата: тонкие лучи «солнце», риски минут, двойное кольцо, безель. */
function dialCell(c: CellCtx, pal: DialPal, withNum: boolean): Px {
  const D = dialOf(c.wy + 0.5);
  const p = new Px(16, 16);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const [wx, wy] = wpt(c, x, y);
      const dx = wx - D.cx;
      const dy = wy - D.cy;
      const r = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      // Гильош «солнце» — только во внутреннем поле, тонкими лучами.
      const inner = r > 3 && r < D.N - 1.4;
      const sun = inner ? (((((a / TAU) * 120) % 1) + 1) % 1 < 0.5 ? 0.035 : -0.02) : 0;
      let col = tone(pal.base, 0.5 + sun + (hash(x, y, c.wx * 7 + c.wy) - 0.5) * 0.04 - r * 0.006);
      if (r > D.R - 0.4) {
        col = tone(pal.bezel, 0.5 - (dx / r) * 0.3 - (dy / r) * 0.4);
      } else if (Math.abs(r - (D.N + 1.05)) < 0.07 || Math.abs(r - (D.N - 1.05)) < 0.05)
        col = pal.line;
      else if (r > D.N + 0.55 && r < D.N + 1.0) {
        const m = ((((a / TAU) * 60) % 1) + 1) % 1;
        if (m < 0.1 || m > 0.9) col = pal.line;
      } else if (Math.abs(r - 3) < 0.05) col = pal.line;
      else if (Math.abs(r - (D.N - 2)) < 0.1) {
        // Пояс бусин между кольцом цифр и полем.
        const m = ((((a / TAU) * 96) % 1) + 1) % 1;
        if (m < 0.3) col = tone(pal.bezel, 0.6);
      }
      if (pal.star && hash(x, y, c.wx * 31 + c.wy) > 0.985)
        col = hash(x, y, 7) > 0.5 ? WHITE : hx('#9aa8ff');
      if (pal.frost && (x + y * 3 + c.wx * 16) % 23 === 0) col = mixc(col, WHITE, 0.6);
      p.set(x, y, col);
    }
  if (pal.arrows && (c.wx + c.wy) % 3 === 0) {
    // Отмотка: гравированные стрелки против часовой.
    const [wx, wy] = wpt(c, 8, 8);
    const a = Math.atan2(wy - D.cy, wx - D.cx) - Math.PI / 2;
    for (let k = -3; k <= 3; k++)
      p.set(Math.round(8 + Math.cos(a) * k), Math.round(8 + Math.sin(a) * k), pal.line);
    p.set(
      Math.round(8 + Math.cos(a) * 3 + Math.cos(a + 2.3) * 2),
      Math.round(8 + Math.sin(a) * 3 + Math.sin(a + 2.3) * 2),
      pal.line,
    );
  }
  if (withNum) {
    const [wx, wy] = wpt(c, 8, 8);
    const a = Math.atan2(wy - D.cy, wx - D.cx);
    const hour = ((Math.round(((a + Math.PI / 2) / TAU) * 12) % 12) + 12) % 12;
    numeral(p, hour, pal.ink);
  }
  return p;
}

/**
 * Ступица: латунные кольца вокруг оси — у циферблата (площадь, арена) и
 * под колоколом Колокольни; за краем ступицы — эмаль или паркет.
 */
function hubCell(c: CellCtx, pal: DialPal): Px {
  const top = F14_TOP[F14_DIAL] ?? 0;
  const bx = BELL_AT[0];
  const by = top + BELL_AT[1];
  const bell = Math.hypot(c.wx + 0.5 - bx, c.wy + 0.5 - by) < 4;
  const D = dialOf(c.wy + 0.5);
  const cx = bell ? bx : D.cx;
  const cy = bell ? by : D.cy;
  const R = bell ? 2.6 : 1.4;
  const p = bell ? dup(parquetCell(c, false)) : dialCell(c, pal, false);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const [wx, wy] = wpt(c, x, y);
      const dx = wx - cx;
      const dy = wy - cy;
      const r = Math.hypot(dx, dy);
      if (r > R) continue;
      const ring = Math.floor(r * 3) % 2;
      p.set(
        x,
        y,
        r > R - 0.12
          ? BRASS[0]
          : tone(
              r < 0.3 ? STEEL : BRASS,
              0.46 + (ring ? 0.1 : -0.06) - (dx / (r || 1)) * 0.16 - (dy / (r || 1)) * 0.2,
            ),
      );
    }
  return p;
}

const PARQ = tn('#1c0f07', '#382010', '#54341c', '#76502c');

/** Паркет: доски 4 точки в ширину, стыки вразбежку, у каждой доски свой тон. */
function parquetCell(c: CellCtx, still: boolean): Px {
  return cellOf(`parq|${c.wx & 3}|${c.wy & 3}|${+still}`, () => {
    const p = new Px(16, 16);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const X = (c.wx & 3) * 16 + x;
        const Y = (c.wy & 3) * 16 + y;
        const row = Math.floor(Y / 4);
        const off = (row * 11) % 24;
        const plank = Math.floor((X + off) / 24);
        const seamY = Y % 4 === 3;
        const seamX = (X + off) % 24 === 0;
        const grain = (X + row * 7) % 7 === 0 ? -0.06 : 0;
        let col = tone(
          PARQ,
          0.46 + (hash(plank, row, 3) - 0.5) * 0.2 + grain + (seamY || seamX ? -0.3 : 0),
        );
        if (still) {
          const l = (col[0] * 0.3 + col[1] * 0.55 + col[2] * 0.15) / 255;
          col = mixc([l * 240, l * 245, l * 265, 255], col, 0.3);
        }
        p.set(x, y, col);
      }
    if (still)
      // Пыль повисла в воздухе: светлые точки не падают.
      for (let i = 0; i < 3; i++)
        p.set(
          Math.floor(hash(i, c.wx & 3, 5) * 16),
          Math.floor(hash(c.wy & 3, i, 6) * 16),
          alpha(hx('#e8f0ff'), 0.85),
        );
    return p;
  });
}

/** Ковровая дорожка: тёмное вино, латунная кайма там, где кончается. */
function runnerCell(c: CellCtx): Px {
  const e = edges(c, (k) => k === MK.runner);
  const motif = (c.wx * 3 + c.wy) % 5 === 0;
  return cellOf(`runner|${+e.n}${+e.s}${+e.w}${+e.e}|${+motif}`, () => {
    const p = new Px(16, 16);
    const R = tn('#160808', '#2a0e10', '#3e1618', '#562424');
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++)
        p.set(x, y, tone(R, 0.45 + (x % 4 === 1 ? -0.07 : 0) + (hash(x, y, 8) - 0.5) * 0.06));
    if (motif) {
      // Узор: маленький циферблат золотой нитью.
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * TAU;
        p.set(
          Math.round(7.5 + Math.cos(a) * 3),
          Math.round(7.5 + Math.sin(a) * 3),
          alpha(BRASS[1], 0.8),
        );
      }
      p.set(8, 5, BRASS[2]);
      p.set(8, 6, BRASS[2]);
      p.set(9, 8, BRASS[2]);
    }
    if (e.w)
      for (let y = 0; y < 16; y++) {
        p.set(0, y, BRASS[1]);
        p.set(1, y, R[0]);
      }
    if (e.e)
      for (let y = 0; y < 16; y++) {
        p.set(15, y, BRASS[1]);
        p.set(14, y, R[0]);
      }
    if (e.n)
      for (let x = 0; x < 16; x++) {
        p.set(x, 0, BRASS[2]);
        p.set(x, 1, R[0]);
      }
    if (e.s)
      for (let x = 0; x < 16; x++) {
        p.set(x, 15, BRASS[1]);
        p.set(x, 14, R[0]);
      }
    return p;
  });
}

/** Песок по краю арены в отмотке: наметён на эмаль, вязнет. */
function rimSandCell(c: CellCtx): Px {
  const p = dialCell(c, DIAL_REWIND, false);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const [wx, wy] = wpt(c, x, y);
      const s = Math.sin(wx * 1.3 + wy * 0.7) + Math.sin(wy * 2.1 - wx * 0.4);
      if (s > -0.6)
        p.set(x, y, tone(SAND_FLOOR, 0.42 + (s > 1.1 ? 0.25 : 0) + (hash(x, y, 2) - 0.5) * 0.1));
    }
  return p;
}

/** Решётка Зала отмотки: железные прутья. */
function barsCell(c: CellCtx): Px {
  return cellOf(`bars|${+c.open(0, 1)}`, () => {
    const p = new Px(16, 16);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, hx('#08060a'));
    for (let x = 1; x < 16; x += 4)
      for (let y = 0; y < 16; y++) {
        p.set(x, y, IRON[3]);
        p.set(x + 1, y, IRON[1]);
      }
    for (const y of [2, 13]) for (let x = 0; x < 16; x++) p.set(x, y, IRON[2]);
    return p;
  });
}

function mechCell(c: CellCtx): Px | null {
  switch (c.mark) {
    case 0:
      return c.tile === 2 ? deckCell(c) : null;
    case MK.brass: {
      const [gx, gy] = gearCenter();
      if (Math.hypot(c.wx + 0.5 - gx, c.wy + 0.5 - gy) < 4) return discCell(c);
      return brassCell(c);
    }
    case MK.crack:
      return onBase(c, mechBase, crackOver(c));
    case MK.oil:
      return onBase(c, mechBase, oilOver(c));
    case MK.stripe:
      return stripeCell(c);
    case MK.track:
      return trackCell(c);
    case MK.grate:
      return grateCell(c);
    case MK.pit:
      return pitCell(c);
    case MK.disc:
    case MK.groove:
      return discCell(c);
    case MK.rank:
      return rankCell(c);
    case MK.wspot:
      return onBase(c, mechBase, wspotOver());
    case MK.hubgear:
      return hubCellMech(c);
    case MK.wclock:
      return panelFace(c, 'wood');
    case MK.cuckoo:
      return panelFace(c, 'green');
    case MK.pipes:
      return panelFace(c, 'soot');
    case MK.keyface:
      return panelFace(c, 'plate');
  }
  return null;
}

function sandCell(c: CellCtx): Px | null {
  switch (c.mark) {
    case 0:
      // Весь район — песок: пол без метки — утоптанный.
      return c.tile === 2 ? packedCell(c) : null;
    case MK.dune:
      return duneCell(c);
    case MK.stone:
      return stoneCell(c);
    case MK.rim:
      return rimCell(c);
    case MK.stream:
      return streamCell(c);
    case MK.sandbits:
      return onBase(c, mechBase, sandbitsOver(c));
    case MK.glass:
      return glassCell(c);
    case MK.slow:
      return lay(dup(glassCell(c)), sigilOver(false));
    case MK.fast:
      return lay(dup(duneCell(c)), sigilOver(true));
    case MK.glasswall:
      return glassFace(c);
    case MK.bars:
      return barsCell(c);
    case MK.crack:
      return onBase(c, mechBase, crackOver(c));
    case MK.oil:
      return onBase(c, mechBase, oilOver(c));
    case MK.brass:
      return brassCell(c);
    case MK.stripe:
      return stripeCell(c);
    case MK.wclock:
      return panelFace(c, 'wood');
    case MK.cuckoo:
      return panelFace(c, 'green');
    case MK.pipes:
      return panelFace(c, 'soot');
  }
  return null;
}

function dialAreaCell(c: CellCtx): Px | null {
  switch (c.mark) {
    case 0:
      // Пол без метки — тот же паркет служебных ходов (с проплешинами).
      return c.tile === 2 ? parquetCell(c, false) : null;
    case MK.dial:
    case MK.hourlamp:
      return dialCell(c, DIAL_DAY, false);
    case MK.numeral:
      return dialCell(c, DIAL_DAY, true);
    case MK.dialStop:
      return dialCell(c, DIAL_STOP, false);
    case MK.numStop:
      return dialCell(c, DIAL_STOP, true);
    case MK.dialRewind:
      return dialCell(c, DIAL_REWIND, false);
    case MK.numRewind:
      return dialCell(c, DIAL_REWIND, true);
    case MK.dialNight:
      return dialCell(c, DIAL_NIGHT, false);
    case MK.numNight:
      return dialCell(c, DIAL_NIGHT, true);
    case MK.rimSand:
      return rimSandCell(c);
    case MK.hub: {
      // Ступица арены — в тон фазе (её кусок перерисуют вместе с ареной).
      const top = F14_TOP[F14_DIAL] ?? 0;
      const arena = dialOf(c.wy + 0.5).cy === top + F14_GEO.arena.y;
      const ph = arena ? F14_FX.bossPhase : 0;
      return hubCell(c, [DIAL_DAY, DIAL_STOP, DIAL_REWIND, DIAL_NIGHT][ph] ?? DIAL_DAY);
    }
    case MK.parquet:
      return parquetCell(c, false);
    case MK.still:
      return parquetCell(c, true);
    case MK.frozen:
    case MK.knife:
      // Места замерших и ножей — пол соседей (дорожка или паркет).
      return onBase(c, mechBase, new Px(16, 16));
    case MK.runner:
      return runnerCell(c);
    case MK.window:
      return windowFace(c);
    case MK.crack:
      return onBase(c, mechBase, crackOver(c));
    case MK.oil:
      return onBase(c, mechBase, oilOver(c));
    case MK.brass:
      return brassCell(c);
    case MK.stripe:
      return stripeCell(c);
    case MK.wclock:
      return panelFace(c, 'wood');
    case MK.cuckoo:
      return panelFace(c, 'green');
    case MK.pipes:
      return panelFace(c, 'soot');
  }
  return null;
}

registerCellPainter(F14_MECH, mechCell);
registerCellPainter(F14_SAND, sandCell);
registerCellPainter(F14_DIAL, dialAreaCell);

// ---------------------------------------------------------------------------
// Метки ударов, сферы, песок, стрелки площади и арены, ножи.
// ---------------------------------------------------------------------------

export type ZoneX = (Zone | Strike) & {
  ang?: number;
  arc?: number;
  w?: number;
  which?: string;
  shot?: number;
  mob?: number;
};

export const rgba = (c: RGBA, a: number) =>
  `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a)).toFixed(3)})`;

/** Метка удара наливается: `k` 0…1. */
export const kOf = (z: ZoneX) => {
  const s = z as Strike;
  if ('warn' in s && typeof s.warn === 'number' && s.warn > 0) return Math.min(1, s.t / s.warn);
  return 1;
};

/** Доля жизни зоны (0 — только легла). */
export const lifeK = (z: ZoneX) => {
  const zz = z as Zone;
  return zz.life > 0 && zz.life < 1e8 ? Math.min(1, zz.t / zz.life) : 0;
};

export function cone(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  a: number,
  arc: number,
): void {
  g.beginPath();
  g.moveTo(x, y);
  g.arc(x, y, r, a - arc / 2, a + arc / 2);
  g.closePath();
}

export const RED = hx('#ff3a28');
export const HOT = hx('#ffe0a0');
const COLD = hx('#9ad8ff');

/** Стрелка часов из центра (угол 0 — XII, по часовой): клинок с остриём и хвостом. */
function drawHand(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  ang: number,
  len: number,
  w: number,
  body: RGBA,
  edge: RGBA,
  tip: RGBA,
): void {
  const ux = Math.sin(ang);
  const uy = -Math.cos(ang);
  const nx = -uy;
  const ny = ux;
  const tail = len * 0.16;
  g.fillStyle = rgba(body, 1);
  g.beginPath();
  g.moveTo(x - ux * tail + nx * w * 0.5, y - uy * tail + ny * w * 0.5);
  g.lineTo(x + ux * len * 0.82 + nx * w * 0.5, y + uy * len * 0.82 + ny * w * 0.5);
  g.lineTo(x + ux * len * 0.8 + nx * w * 1.3, y + uy * len * 0.8 + ny * w * 1.3);
  g.lineTo(x + ux * len, y + uy * len);
  g.lineTo(x + ux * len * 0.8 - nx * w * 1.3, y + uy * len * 0.8 - ny * w * 1.3);
  g.lineTo(x + ux * len * 0.82 - nx * w * 0.5, y + uy * len * 0.82 - ny * w * 0.5);
  g.lineTo(x - ux * tail - nx * w * 0.5, y - uy * tail - ny * w * 0.5);
  g.closePath();
  g.fill();
  g.strokeStyle = rgba(INK, 0.9);
  g.lineWidth = 1;
  g.stroke();
  // Кромка — светлая линия; кольцо-противовес на хвосте.
  g.strokeStyle = rgba(edge, 0.9);
  g.beginPath();
  g.moveTo(x - ux * tail + nx * (w * 0.5 - 1), y - uy * tail + ny * (w * 0.5 - 1));
  g.lineTo(x + ux * len * 0.8 + nx * (w * 0.5 - 1), y + uy * len * 0.8 + ny * (w * 0.5 - 1));
  g.stroke();
  g.fillStyle = rgba(body, 1);
  g.beginPath();
  g.arc(x - ux * tail, y - uy * tail, w * 0.9, 0, TAU);
  g.fill();
  g.stroke();
  g.fillStyle = rgba(tip, 1);
  g.fillRect(Math.round(x + ux * len) - 1, Math.round(y + uy * len) - 1, 2, 2);
}

/** Сфера времени: прозрачный шар, по краю — риски часов; стрелка идёт медленно или бешено. */
function sphere(
  g: CanvasRenderingContext2D,
  z: ZoneX,
  px: number,
  py: number,
  S: number,
  fast: boolean,
): boolean {
  const R = z.r * S;
  const t = F14_FX.clock;
  const col = fast ? HOT : COLD;
  const fade = (z as Zone).life < 1e8 ? Math.min(1, ((z as Zone).life - (z as Zone).t) / 0.6) : 1;
  const born = Math.min(1, (z as Zone).t / 0.3);
  const a = fade * born;
  if (a <= 0) return true;
  g.fillStyle = rgba(col, 0.1 * a);
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.fill();
  g.strokeStyle = rgba(col, 0.55 * a);
  g.lineWidth = 1;
  g.stroke();
  g.strokeStyle = rgba(col, 0.22 * a);
  g.beginPath();
  g.arc(px, py, R - 3, 0, TAU);
  g.stroke();
  // Риски часов по кромке.
  g.fillStyle = rgba(col, 0.8 * a);
  for (let i = 0; i < 12; i++) {
    const aa = (i / 12) * TAU;
    g.fillRect(
      Math.round(px + Math.cos(aa) * (R - 2)),
      Math.round(py + Math.sin(aa) * (R - 2)),
      i % 3 ? 1 : 2,
      i % 3 ? 1 : 2,
    );
  }
  // Секундная стрелка: в медленной — ползёт, в быстрой — вихрь.
  const sa = t * (fast ? 7 : 0.6) + z.id;
  g.strokeStyle = rgba(col, 0.7 * a);
  g.beginPath();
  g.moveTo(px, py);
  g.lineTo(px + Math.sin(sa) * (R - 5), py - Math.cos(sa) * (R - 5));
  g.stroke();
  if (fast)
    for (let k = 1; k <= 3; k++) {
      g.strokeStyle = rgba(col, (0.3 - k * 0.08) * a);
      g.beginPath();
      g.moveTo(px, py);
      g.lineTo(px + Math.sin(sa - k * 0.3) * (R - 5), py - Math.cos(sa - k * 0.3) * (R - 5));
      g.stroke();
    }
  // Взвесь: в медленной песчинки висят, в быстрой — несутся по кругу.
  for (let i = 0; i < 8; i++) {
    const aa = hash(i, z.id) * TAU + t * (fast ? 2.5 : 0.15) * (i % 2 ? 1 : -1);
    const rr = R * (0.25 + hash(z.id, i) * 0.6);
    g.fillStyle = rgba(fast ? AMBER : WHITE, 0.7 * a);
    g.fillRect(Math.round(px + Math.cos(aa) * rr), Math.round(py + Math.sin(aa) * rr), 1, 1);
  }
  return true;
}

registerZonePainter('f14_slow', (g, z, px, py, S) => sphere(g, z as ZoneX, px, py, S, false));
registerZonePainter('f14_fast', (g, z, px, py, S) => sphere(g, z as ZoneX, px, py, S, true));

/** Песок верхней колбы: поднимается рядами; фронт светится, держат — бирюзой. */
registerZonePainter('f14_flood', (g, _z, px, py, S) => {
  const F = F14_FX.flood;
  if (!F.front) return true;
  const t = F14_FX.clock;
  // Центр зоны — центр колбы: переводим мировые координаты в экранные.
  const X = (wx: number) => px + (wx - F.cx) * S;
  const Y = (wy: number) => py + (wy - F.cy) * S;
  const y0 = Math.max(F.top, F.front);
  // Ряды по 2 точки: тело песка тёмнее к низу, по нему бегут светлые жилки.
  const step = 2 / S;
  for (let wy = Math.floor(y0 / step) * step; wy < F.bottom + 1; wy += step) {
    const dy = (wy + step / 2 - F.cy) / F.ry;
    let half = dy * dy <= 1.05 ? F.rx * Math.sqrt(Math.max(0, 1.05 - dy * dy)) : 0;
    if (wy > F.cy) half = Math.max(half, 3);
    if (half <= 0) continue;
    const depth = Math.min(1, (wy - F.front) / 6);
    const front = wy - F.front < 0.35;
    g.fillStyle = front
      ? F.paused
        ? rgba(TEAL[2], 0.85)
        : rgba(SAND_FLOOR[3], 0.85)
      : rgba(mixc(SAND_FLOOR[2], SAND_FLOOR[0], depth * 0.7), 0.78);
    g.fillRect(Math.round(X(F.cx - half)), Math.round(Y(wy)), Math.round(half * 2 * S), 2);
    // Жилки — поток песка вверх.
    if (!front)
      for (let i = 0; i < 3; i++) {
        const wx =
          F.cx - half + ((hash(i, Math.round(wy * 8)) + t * 0.15 * (i + 1)) % 1) * half * 2;
        g.fillStyle = rgba(SAND_FLOOR[3], 0.35);
        g.fillRect(Math.round(X(wx)), Math.round(Y(wy)), 3, 1);
      }
  }
  // Гребень фронта — бугры бегут.
  g.fillStyle = rgba(F.paused ? TEAL_GLOW : WHITE, 0.7);
  const fy = Y(F.front);
  const dy = (F.front - F.cy) / F.ry;
  const half = dy * dy <= 1.05 ? F.rx * Math.sqrt(Math.max(0, 1.05 - dy * dy)) : 3;
  for (let i = 0; i < 20; i++) {
    const wx = F.cx - half + (((i / 20) * half * 2 + t * 1.3) % (half * 2));
    g.fillRect(
      Math.round(X(wx)),
      Math.round(fy - 1 - Math.abs(Math.sin(i * 1.7 + t * 3)) * 2),
      2,
      1,
    );
  }
  return true;
});

/** Стрелки площади и арены — клинки из ступицы; за минутной — шлейф. */
registerZonePainter('f14_hands', (g, z, px, py, S) => {
  const which = (z as ZoneX).which === 'arena' ? 'arena' : 'plaza';
  const H = F14_FX.hands[which];
  if (!H.on) return true;
  const minLen = (which === 'arena' ? 9.6 : NOON.minLen) * S;
  const hourLen = (which === 'arena' ? 6.2 : NOON.hourLen) * S;
  const w = NOON.w * 2 * S;
  // Шлейф минутной: откуда она идёт — там уже не бьёт, куда — бьёт.
  for (let k = 1; k <= 4; k++) {
    const a = H.m - k * 0.07;
    g.strokeStyle = rgba(which === 'arena' ? hx('#c8d8ff') : HOT, 0.12 - k * 0.02);
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(px + Math.sin(a) * NOON.hub * S, py - Math.cos(a) * NOON.hub * S);
    g.lineTo(px + Math.sin(a) * minLen, py - Math.cos(a) * minLen);
    g.stroke();
  }
  // Тени стрелок на полу.
  g.lineWidth = w;
  g.strokeStyle = rgba(INK, 0.35);
  for (const [a, L] of [
    [H.h, hourLen],
    [H.m, minLen],
  ]) {
    g.beginPath();
    g.moveTo(px + 3, py + 4);
    g.lineTo(px + Math.sin(a) * L + 3, py - Math.cos(a) * L + 4);
    g.stroke();
  }
  const metal = which === 'arena' ? tn('#3a3e50', '#7a8098', '#c0c6dc', '#f4f6ff') : BRASS;
  drawHand(g, px, py, H.h, hourLen, w * 1.3, metal[1], metal[3], metal[3]);
  drawHand(
    g,
    px,
    py,
    H.m,
    minLen,
    w,
    metal[2],
    metal[3],
    which === 'arena' ? hx('#c8d8ff') : AMBER,
  );
  // Ступица.
  g.fillStyle = rgba(metal[1], 1);
  g.beginPath();
  g.arc(px, py, 5, 0, TAU);
  g.fill();
  g.strokeStyle = rgba(INK, 1);
  g.lineWidth = 1;
  g.stroke();
  g.fillStyle = rgba(metal[3], 1);
  g.fillRect(Math.round(px) - 1, Math.round(py) - 2, 2, 2);
  return true;
});

/** Здесь встанет павший: песчаная воронка, силуэт тянется вверх. */
registerZonePainter('f14_risemark', (g, z, px, py, S) => {
  const k = lifeK(z as ZoneX);
  const R = z.r * S;
  g.fillStyle = rgba(SAND[1], 0.3 + 0.3 * k);
  g.beginPath();
  g.ellipse(px, py, R, R * 0.6, 0, 0, TAU);
  g.fill();
  g.strokeStyle = rgba(RED, 0.5 + 0.5 * k);
  g.lineWidth = 1;
  g.beginPath();
  g.arc(px, py, R * (1.2 - k * 0.4), 0, TAU);
  g.stroke();
  const h = 10 * k;
  g.fillStyle = rgba(SAND[3], 0.6 * k);
  g.fillRect(Math.round(px) - 2, Math.round(py - h), 4, Math.round(h));
  return true;
});

/** Сюда переведёт часы часовщик. */
registerZonePainter('f14_blink', (g, z, px, py, S) => {
  const k = lifeK(z as ZoneX);
  const R = z.r * S;
  g.strokeStyle = rgba(GOLDK, 0.8);
  g.lineWidth = 1;
  g.beginPath();
  g.arc(px, py, R * (1 - k * 0.5), 0, TAU);
  g.stroke();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU + k * 3;
    g.fillStyle = rgba(GOLDK, 0.9);
    g.fillRect(Math.round(px + Math.cos(a) * R), Math.round(py + Math.sin(a) * R), 1, 1);
  }
  return true;
});

/** Якорь отмотчика: куда его унесёт; след — пунктир из прошлого. Встань — сорвёшь. */
registerZonePainter('f14_anchor', (g, z, px, py, S) => {
  const zz = z as ZoneX;
  const t = F14_FX.clock;
  const R = z.r * S;
  const sim = paintSim();
  const m = sim?.mobs.find((q) => q.id === zz.mob);
  if (m && sim) {
    const tr = rewindTrail(m);
    g.fillStyle = rgba(TEAL_GLOW, 0.55);
    for (let i = 0; i < tr.length; i += 2) {
      const q = tr[i];
      g.fillRect(Math.round(px + (q.x - z.x) * S), Math.round(py + (q.y - z.y) * S), 1, 1);
    }
  }
  g.fillStyle = rgba(TEAL[2], 0.25);
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.fill();
  g.strokeStyle = rgba(TEAL_GLOW, 0.6 + 0.4 * Math.sin(t * 14));
  g.lineWidth = 1;
  g.stroke();
  // Часики в середине.
  g.fillStyle = rgba(WHITE, 0.9);
  g.fillRect(Math.round(px) - 2, Math.round(py) - 3, 5, 1);
  g.fillRect(Math.round(px) - 2, Math.round(py) + 3, 5, 1);
  g.fillRect(Math.round(px), Math.round(py) - 2, 1, 5);
  return true;
});

/** Линия висящего ножа — куда полетит, когда время пойдёт. */
registerZonePainter('f14_knifeline', (g, z, px, py, S) => {
  const zz = z as ZoneX;
  const sim = paintSim();
  const s = sim?.shots.find((q) => q.id === zz.shot);
  if (!s || s.age > -1e5) return true;
  const a = zz.ang ?? 0;
  const L = 7 * S;
  // Сплошная тонкая линия, тающая к концу, и по ней бегут штрихи к цели.
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const grad = g.createLinearGradient(px, py, px + ux * L, py + uy * L);
  grad.addColorStop(0, rgba(RED, 0.55));
  grad.addColorStop(1, rgba(RED, 0));
  g.strokeStyle = grad;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(px + ux * 6, py + uy * 6);
  g.lineTo(px + ux * L, py + uy * L);
  g.stroke();
  const t = F14_FX.clock;
  for (let k = 0; k < 3; k++) {
    const d = 8 + ((t * 1.2 + k / 3) % 1) * (L - 12);
    g.fillStyle = rgba(hx('#ffd0c0'), 0.8 * (1 - d / L));
    g.fillRect(Math.round(px + ux * d) - 1, Math.round(py + uy * d) - 1, 2, 2);
  }
  return true;
});

// ---- Удары ------------------------------------------------------------------

registerZonePainter('f14_none', () => true);

registerZonePainter('f14_sandrise', (g, z, px, py, S) => {
  const k = kOf(z as ZoneX);
  const R = z.r * S;
  g.fillStyle = rgba(SAND[1], 0.2 + 0.35 * k);
  g.beginPath();
  g.arc(px, py, R * (0.4 + 0.6 * k), 0, TAU);
  g.fill();
  g.strokeStyle = rgba(RED, 0.5 + 0.5 * k);
  g.lineWidth = 1;
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.stroke();
  // Песок вздыбливается.
  for (let i = 0; i < 10; i++) {
    const a = hash(i, z.id) * TAU;
    const rr = R * hash(z.id, i) * 0.8;
    g.fillStyle = rgba(SAND[3], 0.8);
    g.fillRect(
      Math.round(px + Math.cos(a) * rr),
      Math.round(py + Math.sin(a) * rr - k * 4 * hash(i, 3)),
      1,
      1,
    );
  }
  return true;
});

registerZonePainter('f14_sandblast', (g, z, px, py, S) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const R = z.r * S;
  const a = zz.ang ?? 0;
  const arc = zz.arc ?? 1.2;
  cone(g, px, py, R, a, arc);
  g.fillStyle = rgba(SAND[2], 0.12 + 0.3 * k);
  g.fill();
  g.strokeStyle = rgba(RED, 0.4 + 0.5 * k);
  g.lineWidth = 1;
  g.beginPath();
  g.arc(px, py, R, a - arc / 2, a + arc / 2);
  g.stroke();
  for (let i = 0; i < 14; i++) {
    const aa = a + (hash(i, z.id) - 0.5) * arc;
    const rr = R * (((hash(z.id, i) + k * 0.8) % 1) * 0.9 + 0.1);
    g.fillStyle = rgba(SAND[3], 0.85);
    g.fillRect(Math.round(px + Math.cos(aa) * rr), Math.round(py + Math.sin(aa) * rr), 1, 1);
  }
  return true;
});

/** Коса жнеца: полумесяц скользит по краю конуса к удару. */
registerZonePainter('f14_scythe', (g, z, px, py, S) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const R = z.r * S;
  const a = zz.ang ?? 0;
  const arc = zz.arc ?? 1.5;
  cone(g, px, py, R, a, arc);
  g.fillStyle = rgba(RED, 0.1 + 0.26 * k);
  g.fill();
  g.strokeStyle = rgba(STEEL[3], 0.4 + 0.6 * k);
  g.lineWidth = 2;
  g.beginPath();
  g.arc(px, py, R - 1, a - arc / 2, a - arc / 2 + arc * k);
  g.stroke();
  g.lineWidth = 1;
  g.strokeStyle = rgba(RED, 0.6 + 0.4 * k);
  g.beginPath();
  g.arc(px, py, R, a - arc / 2, a + arc / 2);
  g.stroke();
  return true;
});

/** Часовая стрелка хранителя: тень стрелки опускается в круг. */
registerZonePainter('f14_hourhand', (g, z, px, py, S) => {
  const k = kOf(z as ZoneX);
  const R = z.r * S;
  g.fillStyle = rgba(RED, 0.12 + 0.28 * k);
  g.beginPath();
  g.arc(px, py, R * k, 0, TAU);
  g.fill();
  g.strokeStyle = rgba(RED, 0.5 + 0.5 * k);
  g.lineWidth = 1;
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.stroke();
  // Двенадцать рисок: бьёт «час».
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    g.fillStyle = rgba(HOT, 0.5 + 0.5 * k);
    g.fillRect(
      Math.round(px + Math.cos(a) * (R - 2)),
      Math.round(py + Math.sin(a) * (R - 2)),
      1,
      1,
    );
  }
  return true;
});

/** Минутная стрелка: линия, остриё бежит к концу. */
function lineStrike(
  g: CanvasRenderingContext2D,
  z: ZoneX,
  px: number,
  py: number,
  S: number,
  heavy: boolean,
): void {
  const k = kOf(z);
  const L = z.r * S;
  const w = (z.w ?? 0.4) * S;
  g.save();
  g.translate(px, py);
  g.rotate(z.ang ?? 0);
  g.fillStyle = rgba(RED, 0.12 + 0.28 * k);
  g.fillRect(0, -w, L, w * 2);
  g.fillStyle = rgba(heavy ? HOT : STEEL[3], 0.5 + 0.5 * k);
  g.fillRect(0, -w, L, 1);
  g.fillRect(0, w - 1, L, 1);
  const tip = Math.round(L * k);
  g.beginPath();
  g.moveTo(tip, 0);
  g.lineTo(tip - 5, -3);
  g.lineTo(tip - 5, 3);
  g.closePath();
  g.fill();
  g.restore();
}

registerZonePainter('f14_minutehand', (g, z, px, py, S) => {
  lineStrike(g, z as ZoneX, px, py, S, false);
  return true;
});

/** Эхо твоего удара: сепия, пунктир — это ты пять секунд назад. */
registerZonePainter('f14_echo', (g, z, px, py, S) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const R = z.r * S;
  const a = zz.ang ?? 0;
  const arc = zz.arc ?? 1.9;
  cone(g, px, py, R, a, arc);
  g.fillStyle = rgba(hx('#ffcf5a'), 0.1 + 0.25 * k);
  g.fill();
  g.strokeStyle = rgba(hx('#ffe9a0'), 0.5 + 0.5 * k);
  g.lineWidth = 1;
  g.setLineDash([2, 2]);
  g.beginPath();
  g.arc(px, py, R, a - arc / 2, a + arc / 2);
  g.stroke();
  g.setLineDash([]);
  return true;
});

registerZonePainter('f14_echostomp', (g, z, px, py, S) => {
  const k = kOf(z as ZoneX);
  const R = z.r * S;
  g.strokeStyle = rgba(hx('#ffe9a0'), 0.5 + 0.5 * k);
  g.lineWidth = 1;
  g.setLineDash([2, 2]);
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.stroke();
  g.setLineDash([]);
  g.fillStyle = rgba(hx('#ffcf5a'), 0.12 + 0.3 * k);
  g.beginPath();
  g.arc(px, py, R * k, 0, TAU);
  g.fill();
  return true;
});

// ---- Нож ---------------------------------------------------------------------

/** Нож: висит — стоит в воздухе остриём по ходу; летит — со следом. */
registerShotPainter('f14_knife', (s) => {
  const ang = KNIFE_ANG.get(s.id) ?? Math.atan2(s.vy, s.vx);
  const ab = ((Math.round((ang / TAU) * 32) % 32) + 32) % 32;
  const fly = s.age > -1e5 ? 1 : 0;
  return sprite(`knife|${ab}|${fly}`, () => {
    const p = new Px(22, 22);
    const a = (ab / 32) * TAU;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const cx = 11;
    const cy = 11;
    // Клинок — стрелка часов в миниатюре: рукоять-кольцо, лезвие, остриё.
    stroke(p, cx - ux * 6, cy - uy * 6, cx + ux * 5, cy + uy * 5, STEEL[2]);
    stroke(
      p,
      cx - ux * 6 - uy * 0.7,
      cy - uy * 6 + ux * 0.7,
      cx + ux * 5 - uy * 0.7,
      cy + uy * 5 + ux * 0.7,
      STEEL[3],
    );
    poly(
      p,
      [
        [cx + ux * 8, cy + uy * 8],
        [cx + ux * 4 - uy * 2, cy + uy * 4 + ux * 2],
        [cx + ux * 4 + uy * 2, cy + uy * 4 - ux * 2],
      ],
      STEEL[3],
    );
    p.ell(cx - ux * 6, cy - uy * 6, 1.6, 1.6, BRASS[2]);
    p.outline(INK);
    if (fly)
      for (let k = 1; k <= 4; k++)
        p.set(
          Math.round(cx - ux * (7 + k * 2)),
          Math.round(cy - uy * (7 + k * 2)),
          alpha(WHITE, 0.6 - k * 0.12),
        );
    else p.set(Math.round(cx + ux * 8), Math.round(cy + uy * 8), RED);
    return { p, ax: cx, ay: cy + 4 };
  });
});

// ---- Вещи ----------------------------------------------------------------------

registerItemArt('f14mat', () => {
  const p = new Px(10, 10);
  cog(p, 5, 5, 4.6, 8, 0.2, BRASS, { hole: 1.2, spokes: 0 });
  p.outline(INK);
  return p;
});

registerItemArt('f14_spring', () => {
  const p = new Px(10, 10);
  spring(p, 2, 8, 8, 2, 4, 1.6, BRASS[3], BRASS[1]);
  p.set(2, 8, BRASS[2]);
  p.set(8, 2, BRASS[2]);
  p.outline(INK);
  return p;
});

registerItemArt('f14_sand', () => {
  const p = new Px(10, 10);
  // Мешочек с песком времени: бирюзовая завязка.
  shadeEll(p, 5, 6.2, 3.6, 3.2, tn('#3a2a14', '#6a5028', '#9a7a44', '#c8a468'), 0.1);
  p.rect(4, 2, 6, 3, tn('#3a2a14', '#6a5028', '#9a7a44', '#c8a468')[2]);
  p.rect(3, 3, 7, 3, TEAL[2]);
  p.set(5, 6, SAND[3]);
  p.set(4, 7, SAND[2]);
  p.set(6, 5, TEAL_GLOW);
  p.outline(INK);
  return p;
});

registerItemArt('f14_glass', () => {
  const p = new Px(10, 10);
  shadeEll(p, 5, 5, 4.2, 4.2, ENAMEL, 0.2);
  stroke(p, 5, 5, 5, 2, INK);
  stroke(p, 5, 5, 7, 6, INK);
  p.set(3, 3, WHITE);
  p.outline(INK);
  return p;
});

registerItemArt('f14_hand', () => {
  const p = new Px(10, 10);
  minuteHand(p, 3, 7, -0.75, 9, BRASS, AMBER);
  p.outline(INK);
  return p;
});

registerItemArt('f14_egg', () => {
  const p = new Px(10, 10);
  shadeEll(p, 5, 5.5, 3, 3.8, tn('#6a6048', '#b0a888', '#e0d8c0', '#fffaf0'), 0.2);
  p.set(4, 4, hx('#8a7a5a'));
  p.set(6, 6, hx('#8a7a5a'));
  p.set(5, 8, hx('#8a7a5a'));
  p.outline(INK);
  return p;
});

registerItemArt('f14_ration', () => {
  const p = new Px(10, 10);
  // Жестяная банка с латунной крышкой.
  for (let y = 3; y <= 8; y++)
    for (let x = 2; x <= 7; x++) p.set(x, y, tone(STEEL, 0.55 - (x - 4.5) * 0.15));
  p.ell(4.5, 3, 2.8, 1.1, BRASS[2]);
  p.rect(2, 5, 7, 6, REDC[2]);
  p.set(4, 5, WHITE);
  p.outline(INK);
  return p;
});
