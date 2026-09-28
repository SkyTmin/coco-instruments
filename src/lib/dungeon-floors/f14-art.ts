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
  paintSim,
  registerCellPainter,
  registerItemArt,
  registerMobPainter,
  registerPropPainter,
  registerShotPainter,
  registerZonePainter,
} from '../dungeon-paint';
import type { CellCtx, MobFrame, MobPose, Sprite } from '../dungeon-paint';
import type { Mob, Shot, Strike, Zone } from '../dungeon-sim';
import { heroSprite } from '../dungeon-sprites';
import type { Dir4 } from '../dungeon-sprites';
import type { WorldObj } from '../dungeon-world';
import { F14_DIAL, F14_GEO, F14_MARK, F14_MECH, F14_SAND, F14_TOP } from './f14';
import {
  CUCKOO,
  F14_FX,
  KNIFE_ANG,
  LORD,
  NOON,
  REAPER,
  rewindTrail,
  worldStopped,
} from './f14-brains';

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
const css = (c: RGBA, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

const INK = hx('#150f0b');
const WHITE = hx('#ffffff');
const GOLDK = hx('#ffcc40');
const TAU = Math.PI * 2;

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
function stroke(p: Px, x0: number, y0: number, x1: number, y1: number, c: RGBA, w = 1): void {
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

/** Наложить `src` на `dst` (прозрачное пропускаем). */
function over(dst: Px, src: Px, ox = 0, oy = 0): void {
  for (let y = 0; y < src.h; y++)
    for (let x = 0; x < src.w; x++) {
      const i = (y * src.w + x) * 4;
      const a = src.data[i + 3];
      if (!a) continue;
      dst.set(x + ox, y + oy, [src.data[i], src.data[i + 1], src.data[i + 2], a]);
    }
}

/** Повернуть картинку вокруг точки (ближайший сосед, без сглаживания). */
function rotated(src: Px, ang: number, cx: number, cy: number, w: number, h: number, ox: number, oy: number): Px {
  const o = new Px(w, h);
  const c = Math.cos(-ang);
  const s = Math.sin(-ang);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = x + 0.5 - ox;
      const dy = y + 0.5 - oy;
      const sx = Math.floor(cx + dx * c - dy * s);
      const sy = Math.floor(cy + dx * s + dy * c);
      if (sx < 0 || sy < 0 || sx >= src.w || sy >= src.h) continue;
      const i = (sy * src.w + sx) * 4;
      if (!src.data[i + 3]) continue;
      const j = (y * w + x) * 4;
      o.data[j] = src.data[i];
      o.data[j + 1] = src.data[i + 1];
      o.data[j + 2] = src.data[i + 2];
      o.data[j + 3] = src.data[i + 3];
    }
  return o;
}

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
const TEAL = tn('#0e3a44', '#1e7a88', '#4cc8d8', '#b8f4ff');
const SAND = tn('#6a4a24', '#a8844c', '#d8b878', '#f4e2b0');
const WOOD = tn('#2a160c', '#4a2816', '#6e3e22', '#9a5e34');
const REDC = tn('#3a0a0c', '#6a1418', '#a42228', '#d8484a');
const NAVY = tn('#10142a', '#1e2648', '#34406a', '#5a6aa0');
const COAT = tn('#0c0a10', '#1a1620', '#2c2634', '#463e50');
const SKIN = tn('#8a4a38', '#c88a70', '#f0c0a0', '#ffe4cc');
const GLASS = hx('#bfe8f0', 150);
const GLASS_HI = hx('#ffffff', 200);
const TEAL_GLOW = hx('#8fe8ff');
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
      const f = (((a / TAU) * teeth) % 1 + 1) % 1;
      if (d > body && (f < 0.22 || f > 0.72)) continue;
      if (d < hole) {
        if (o.dark) p.set(x, y, o.dark);
        continue;
      }
      if (spokes && d > win0 && d < win1) {
        const sf = (((a / TAU) * spokes) % 1 + 1) % 1;
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
  if (o.glow) for (let y = top + bh; y < top + bh + inner; y += 2) p.set(Math.floor(cx - 0.5), y, alpha(o.glow, 0.5));
  // Плиты и стойки.
  polyShade(p, [[cx - half, top], [cx + half, top], [cx + half, top + bh], [cx - half, top + bh]], fr);
  polyShade(p, [[cx - half, top + h - bh], [cx + half, top + h - bh], [cx + half, top + h], [cx - half, top + h]], fr, -0.1);
  for (const sx of [cx - half + 0.5, cx + half - 1.5]) for (let y = top + bh; y < top + h - bh; y++) p.set(Math.floor(sx), y, sx < cx ? fr[2] : fr[1]);
  if (o.broken) {
    // Трещины по стеклу, песок высыпался.
    stroke(p, cx - 2, top + bh + 2, cx + 1, mid - 1, alpha(WHITE, 0.9));
    stroke(p, cx + 1, mid + 1, cx - 1, top + h - bh - 2, alpha(WHITE, 0.8));
  }
}

/** Пружина зигзагом от точки к точке. */
function spring(p: Px, x0: number, y0: number, x1: number, y1: number, turns: number, amp: number, c: RGBA, c2: RGBA): void {
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

function finish(key: string, b: Built, look: Look, flash: boolean, left: boolean, gray = false): MobFrame {
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
  const eye = b.eye && !gray ? ([left ? p.w - 1 - b.eye[0] : b.eye[0], b.eye[1]] as [number, number]) : null;
  const out: MobFrame = { img: p.canvas(), ax: left ? p.w - b.ax : b.ax, ay: b.ay, eye };
  frames.set(key, out);
  return out;
}

function frameOf(kind: string, pose: MobPose, anim: string, f: number, build: () => Built, gray = false): MobFrame {
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
      const c: RGBA = r < k * 0.4 ? bits[Math.floor(r * 97) % bits.length] : [p.data[i], p.data[i + 1], p.data[i + 2], 255];
      o.data[j] = c[0];
      o.data[j + 1] = c[1];
      o.data[j + 2] = c[2];
      o.data[j + 3] = 255;
    }
  return o;
}

/** Номер кадра смерти по времени режима. */
const deathK = (pose: MobPose) => (pose.mode === 'dying' ? Math.min(3, Math.floor(pose.t / 0.16)) : 0);
