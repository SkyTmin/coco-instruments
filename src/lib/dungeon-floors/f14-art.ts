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
import type { Mob, Strike, Zone } from '../dungeon-sim';
import { heroSprite } from '../dungeon-sprites';
import type { Dir4 } from '../dungeon-sprites';
import { F14_DIAL, F14_GEO, F14_MARK, F14_MECH, F14_SAND, F14_TOP } from './f14';
import { MAP_F14_DIAL, MAP_F14_SAND } from './f14-map';
import { F14_FX, KNIFE_ANG, LORD, NOON, REAPER, rewindTrail, worldStopped } from './f14-brains';

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
const alpha = (c: RGBA, a: number): RGBA => [
  c[0],
  c[1],
  c[2],
  Math.round(Math.max(0, Math.min(1, a)) * 255),
];

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
  // Засвеченная плёнка: свои цвета героя, выбеленные к янтарю, и второй
  // отпечаток со сдвигом — двойная экспозиция. Сепия по яркости не годилась:
  // рыцарь Т8 тёмный и полосатый (забрало, пластины), и в одну бурую гамму
  // он читался бочкой — узнать в двойнике себя было нельзя. Контур — золото.
  const AMBER = hx('#ffd27a');
  const px = (x: number, y: number): RGBA | null => {
    const i = (y * c.width + x) * 4;
    if (!img.data[i + 3]) return null;
    return [img.data[i], img.data[i + 1], img.data[i + 2], 255];
  };
  // Отпечаток прошлого кадра: на пиксель выше и левее, еле виден.
  for (let y = 0; y < c.height; y++)
    for (let x = 0; x < c.width; x++) {
      const o = px(x, y);
      if (o) p.set(x + 1, y + 1, alpha(mixc(o, AMBER, 0.7), 0.32 * fade));
    }
  for (let y = 0; y < c.height; y++)
    for (let x = 0; x < c.width; x++) {
      const o = px(x, y);
      if (!o) continue;
      const ink = o[0] + o[1] + o[2] < 90;
      const line = y % 4 === 3;
      const col = ink ? mixc(o, hx('#3a2208'), 0.5) : mixc(o, AMBER, 0.5);
      p.set(x + 2, y + 2, alpha(col, (line ? 0.66 : 0.86) * fade));
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
// Повелитель часа: высокий, в длинном балахоне с латунной каймой; голова —
// башенный циферблат в латунном безеле со шпилями, за головой медленно
// ходит шестерня-нимб; в груди за стеклом качается маятник. В правой —
// минутная стрелка-клинок (с кольцом-противовесом), в левой — часовая
// стрелка-лист. Фаза меняет материал: ночная синь (ДВЕ СТРЕЛКИ), иней
// (ОСТАНОВКА), бирюза и песок (ОТМОТКА), полночь со звёздами (ПОЛНОЧЬ).
// Кадр 56×64, земля 61.
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

type LordFace = 'on' | 'hot' | 'white' | 'dim' | 'crack';

interface LordPose {
  phase: number;
  /** Такт часов (0…11): стрелки на лице, нимб, качание подола. */
  mb: number;
  lean: number;
  /** Опустился (на колено), пиксели. */
  drop: number;
  /** Правая рука: кисть и угол минутной стрелки. */
  fh: [number, number];
  fa: number;
  /** Левая рука: кисть и угол часовой стрелки. */
  bh: [number, number];
  ba: number;
  face: LordFace;
  /** Песочные часы в руках (отмотка) или разбитые у ног. */
  glass?: 'hold' | 'broken';
  glassK?: number;
  /** Разворот стрелок кругом — полосы движения. */
  spin?: number;
}

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
  // Лист: ширина растёт к двум третям и сходится в остриё.
  const n = 14;
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    const w = 3.6 * Math.sin(Math.min(1, k * 1.25) * Math.PI) * (k < 0.8 ? 1 : (1 - k) * 5);
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

function drawLord(o: LordPose): Built {
  const W = 56;
  const H = 64;
  const G = 61;
  const cx = 26;
  const p = new Px(W, H);
  const L = LORD_LOOK[o.phase] ?? LORD_LOOK[0];
  const d = o.drop;
  const sh = (y: number) => (o.lean * (G - y)) / 34;
  const hy = 18 + d;
  const hxp = cx + sh(hy);
  const top = 29 + d;
  const sway = [0, 1, 0, -1][o.mb % 4];
  // 1. Нимб — шестерня за головой.
  cog(p, hxp, hy, 13, 16, ((o.mb % 4) / 4) * (TAU / 16), L.halo, { hole: 4, spokes: 6 });
  // 2. Левая рука с часовой стрелкой — за телом.
  const shoulderB: [number, number] = [cx - 7 + sh(top), top + 1];
  const shoulderF: [number, number] = [cx + 7 + sh(top), top + 1];
  const bh: [number, number] = [o.bh[0] + sh(o.bh[1]), o.bh[1] + d];
  const fh: [number, number] = [o.fh[0] + sh(o.fh[1]), o.fh[1] + d];
  limb(p, shoulderB[0], shoulderB[1], bh[0], bh[1], 2.4, 1.6, L.robe, -0.1);
  hourHand(p, bh[0], bh[1], o.ba, 15, L.trim);
  shadeEll(p, bh[0], bh[1], 1.6, 1.6, L.trim, 0.1);
  // 3. Балахон.
  for (let y = top; y < G; y++) {
    const k = (y - top) / (G - top);
    const hw = 6.5 + k * 6 + (d > 0 ? k * k * 3 : 0);
    const off = sh(y) + (y > G - 14 ? (sway * (y - (G - 14))) / 14 : 0);
    for (let x = Math.floor(cx + off - hw); x <= Math.ceil(cx + off + hw - 1); x++) {
      const u = (x + 0.5 - (cx + off)) / hw;
      // Складки: тёмные борозды, свет слева.
      const fold = Math.abs((((u + 1) * 2.5 + (sway * k) / 3) % 1) - 0.5) < 0.12 ? -0.28 : 0;
      p.set(x, y, tone(L.robe, 0.52 - u * 0.55 + fold + (1 - k) * 0.08));
    }
    // Полы: латунный кант по середине.
    p.set(Math.round(cx + off + 1), y, y % 3 ? L.trim[1] : L.trim[2]);
  }
  // Подол: латунная кайма с засечками часов.
  for (let x = cx - 14; x <= cx + 14; x++) {
    for (const y of [G - 3, G - 2]) {
      if (!p.solid(x, y)) continue;
      p.set(
        x,
        y,
        (x + (y === G - 2 ? 1 : 0)) % 4 === 0 ? INK : y === G - 3 ? L.trim[2] : L.trim[1],
      );
    }
  }
  // Полночь: в балахоне звёзды; отмотка: песок течёт с подола.
  if (o.phase === 3)
    for (let i = 0; i < 16; i++) {
      const x = Math.round(cx - 10 + hash(i, 3) * 20 + sh(40));
      const y = Math.round(top + 4 + hash(i, 7) * (G - top - 8));
      if (p.solid(x, y) && hash(i, o.mb) > 0.3) p.set(x, y, i % 3 ? hx('#9aa8ff') : WHITE);
    }
  if (o.phase === 2)
    for (let i = 0; i < 6; i++) {
      const x = Math.round(cx - 10 + hash(i, 11) * 20);
      p.set(x, G - 1 - ((i + o.mb) % 3), (i + o.mb) % 2 ? SAND[3] : TEAL[2]);
    }
  // 4. Окно в груди: маятник за стеклом (в отмотке — песок вверх).
  const wx = cx + 1 + sh(top + 9);
  const wy = top + 9;
  p.ell(wx, wy, 4, 5.5, L.trim[1]);
  p.ell(wx, wy, 3, 4.5, hx('#0a0a14'));
  if (o.phase === 2) {
    for (let i = 0; i < 7; i++)
      p.set(Math.round(wx - 1 + (i % 3)), Math.round(wy + 3 - ((i * 1.3 + o.mb) % 8)), TEAL_GLOW);
  } else {
    const a = Math.sin((o.mb / 12) * TAU * 2) * 0.55;
    const bx = wx + Math.sin(a) * 3;
    const by = wy - 3.5 + Math.cos(a) * 5.5;
    stroke(p, wx, wy - 4, bx, by, L.trim[2]);
    shadeEll(p, bx, by, 1.4, 1.4, L.trim, 0.2);
  }
  p.set(Math.round(wx - 2), Math.round(wy - 3), alpha(WHITE, 0.7));
  p.set(Math.round(wx - 2), Math.round(wy - 2), alpha(WHITE, 0.45));
  // 5. Воротник-шестерня и наплечники-колокола.
  cog(p, cx + sh(top), top + 0.5, 5.5, 12, 0, L.trim, { hole: 0.1, spokes: 0 });
  for (const [sx, sy] of [shoulderB, shoulderF]) {
    shadeEll(p, sx, sy - 0.5, 3.6, 3, L.trim, 0.1);
    for (let x = Math.round(sx - 3); x <= Math.round(sx + 3); x++)
      p.set(x, Math.round(sy + 2), L.trim[0]);
  }
  // 6. Голова — циферблат в безеле со шпилями.
  for (const a of [-Math.PI / 2, -Math.PI / 2 - 0.62, -Math.PI / 2 + 0.62]) {
    const bx = hxp + Math.cos(a) * 8.5;
    const by = hy + Math.sin(a) * 8.5;
    const tall = a === -Math.PI / 2 ? 5 : 3.2;
    poly(
      p,
      [
        [bx - 1.6, by + 0.5],
        [bx + 1.6, by + 0.5],
        [bx + Math.cos(a) * tall, by + Math.sin(a) * tall],
      ],
      L.trim[2],
    );
    p.set(Math.round(bx + Math.cos(a) * tall), Math.round(by + Math.sin(a) * tall), L.trim[3]);
  }
  shadeEll(p, hxp, hy, 8.6, 8.6, L.trim, 0.05);
  const faceT: Tones =
    o.face === 'dim' || o.face === 'crack'
      ? [L.face[0], L.face[0], L.face[1], L.face[1]]
      : o.face === 'white'
        ? [hx('#c8d8f0'), hx('#e8f0ff'), WHITE, WHITE]
        : L.face;
  shadeEll(p, hxp, hy, 7, 7, faceT, 0.25);
  if (o.face === 'on' || o.face === 'hot')
    p.ell(hxp, hy, 6, 6, alpha(L.glow, o.face === 'hot' ? 0.5 : 0.25));
  // Риски часов: у III, VI, IX, XII — длинные.
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    const r0 = i % 3 === 0 ? 4.6 : 5.4;
    for (let r = r0; r <= 6.2; r += 0.8)
      p.set(
        Math.floor(hxp + Math.sin(a) * r),
        Math.floor(hy - Math.cos(a) * r),
        o.phase === 3 ? L.hand : INK,
      );
  }
  // Стрелки на лице — идут по такту.
  const minA = (o.mb / 12) * TAU;
  const hourA = (o.mb / 12) * (TAU / 12) + (o.phase === 3 ? -0.35 : 1.9);
  stroke(
    p,
    hxp - 0.5,
    hy - 0.5,
    hxp - 0.5 + Math.sin(hourA) * 3.4,
    hy - 0.5 - Math.cos(hourA) * 3.4,
    L.hand,
    2,
  );
  stroke(
    p,
    hxp - 0.5,
    hy - 0.5,
    hxp - 0.5 + Math.sin(minA) * 5.4,
    hy - 0.5 - Math.cos(minA) * 5.4,
    L.hand,
  );
  if (o.face === 'crack') {
    stroke(p, hxp - 5, hy - 3, hxp - 1, hy + 1, INK);
    stroke(p, hxp - 1, hy + 1, hxp + 2, hy - 1, INK);
    stroke(p, hxp - 1, hy + 1, hxp + 1, hy + 5, INK);
    p.set(Math.round(hxp - 4), Math.round(hy - 3), WHITE);
  }
  // 7. Правая рука с минутной стрелкой — перед телом.
  if (o.glass) {
    // Отмотка: большие песочные часы в руках (или осколки у ног).
    const gx = cx + 9 + sh(top + 14);
    if (o.glass === 'hold') {
      hourglass(p, gx, top + 3, 11, 17, o.glassK ?? 0.5, true, o.mb, {
        sand: TEAL,
        glow: TEAL_GLOW,
      });
      limb(p, shoulderF[0], shoulderF[1], gx - 5, top + 11, 2.4, 1.6, L.robe, 0.05);
      shadeEll(p, gx - 5, top + 11, 1.6, 1.6, L.trim, 0.1);
    } else {
      for (let i = 0; i < 9; i++)
        p.set(
          Math.round(gx - 5 + hash(i, 5) * 12),
          G - 1 - Math.floor(hash(i, 9) * 3),
          i % 2 ? GLASS_HI : TEAL[2],
        );
      polyShade(
        p,
        [
          [gx - 5, G - 2],
          [gx + 1, G - 2],
          [gx + 1, G],
          [gx - 5, G],
        ],
        L.trim,
      );
      limb(p, shoulderF[0], shoulderF[1], fh[0], fh[1], 2.4, 1.6, L.robe, 0.05);
      minuteHand(p, fh[0], fh[1], o.fa, 24, L.trim, null);
      shadeEll(p, fh[0], fh[1], 1.7, 1.7, L.trim, 0.1);
    }
  } else {
    limb(p, shoulderF[0], shoulderF[1], fh[0], fh[1], 2.4, 1.6, L.robe, 0.05);
    minuteHand(
      p,
      fh[0],
      fh[1],
      o.fa,
      24,
      L.trim,
      o.face === 'dim' || o.face === 'crack' ? null : L.glow,
    );
    shadeEll(p, fh[0], fh[1], 1.7, 1.7, L.trim, 0.1);
  }
  // Полосы разворота: стрелки идут кругом.
  if (o.spin !== undefined)
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * TAU + o.spin * 0.35;
      if (i % 3 === 0) continue;
      p.set(
        Math.round(cx + Math.cos(a) * 22),
        Math.round(top + 5 + Math.sin(a) * 7),
        alpha(L.glow, 0.7),
      );
    }
  p.outline(INK);
  // Глаз — ось стрелок: светится поверх контура.
  const eyeOn = o.face !== 'dim' && o.face !== 'crack';
  p.set(Math.round(hxp - 0.5), Math.round(hy - 0.5), eyeOn ? L.glow : L.face[1]);
  return { p, ax: cx, ay: G, eye: eyeOn ? [Math.round(hxp - 0.5), Math.round(hy - 0.5)] : null };
}

/** Своя очередь кадров босса: их много (фаза × такт × поза), держим с потолком. */
const lordFrames = new Map<string, MobFrame>();

registerMobPainter('f14boss', (_m: Mob, pose: MobPose) => {
  const mode = pose.mode;
  const phase = Math.max(0, Math.min(3, F14_FX.bossPhase));
  const mb = Math.floor(F14_FX.clock * 2) % 12;
  const stopped = (() => {
    const s = paintSim();
    return s ? worldStopped(s) : false;
  })();
  // Поза по умолчанию: минутная вниз-вперёд, часовая вниз-назад.
  let o: LordPose = {
    phase,
    mb,
    lean: 0,
    drop: 0,
    fh: [34, 43],
    fa: 1.05,
    bh: [17, 43],
    ba: 2.0,
    face: 'on',
  };
  let anim = 'idle';
  let fr = 0;
  if (mode === 'dying') {
    anim = 'dead';
    fr = deathK(pose);
    o = { ...o, lean: 1.5, drop: 4, face: 'crack', fh: [33, 50], fa: 1.3, bh: [18, 50], ba: 1.8 };
  } else if (mode === 'roar') {
    anim = 'roar';
    o = { ...o, lean: -1, fh: [36, 22], fa: -1.15, bh: [14, 22], ba: -2.0, face: 'hot' };
  } else if (mode === 'f14_hour') {
    const down = pose.t > (LORD.hourWarn / (phase >= 3 ? 1.25 : phase >= 2 ? 1.12 : 1)) * 0.72;
    anim = down ? 'hourD' : 'hourU';
    o = down
      ? { ...o, lean: 1.5, bh: [36, 40], ba: 0.55, fh: [33, 44], fa: 1.2 }
      : { ...o, lean: -1, bh: [19, 12], ba: -2.2, fh: [34, 43], fa: 1.1, face: 'hot' };
  } else if (mode === 'f14_minute') {
    anim = 'minAim';
    fr = Math.floor(pose.t * 8) % 2;
    o = { ...o, lean: -1.5, fh: [37, 32], fa: 0, bh: [15, 40], ba: 2.4, face: fr ? 'hot' : 'on' };
  } else if (mode === 'f14_lunge') {
    anim = 'lunge';
    o = { ...o, lean: 3, fh: [40, 36], fa: 0.12, bh: [14, 38], ba: 2.8 };
  } else if (mode === 'f14_stuck') {
    anim = 'stuck';
    fr = Math.floor(pose.t * 6) % 2;
    o = {
      ...o,
      lean: 3,
      drop: 2,
      fh: [37, 40],
      fa: 0.95,
      bh: [17, 46],
      ba: 1.9,
      face: fr ? 'dim' : 'on',
    };
  } else if (mode === 'f14_spin') {
    anim = 'spin';
    fr = Math.floor(pose.t * 10) % 4;
    const back = fr % 2 === 1;
    o = {
      ...o,
      fh: back ? [14, 35] : [39, 35],
      fa: back ? Math.PI : 0,
      bh: back ? [38, 34] : [13, 34],
      ba: back ? 0 : Math.PI,
      spin: fr,
      face: 'hot',
    };
  } else if (mode === 'f14_clap') {
    anim = 'clap';
    fr = pose.t > LORD.clap * 0.6 ? 1 : 0;
    o = {
      ...o,
      lean: -1,
      fh: [28, 8],
      fa: -1.35,
      bh: [23, 8],
      ba: -1.8,
      face: fr ? 'white' : 'hot',
    };
  } else if (mode === 'f14_place' || stopped) {
    anim = 'place';
    o = { ...o, fh: [38, 32], fa: 0.45, bh: [12, 32], ba: 2.7, face: 'white' };
  } else if (mode === 'f14_ritual') {
    anim = 'ritual';
    fr = mb;
    o = {
      ...o,
      drop: 6,
      bh: [18, 44],
      ba: 1.9,
      glass: 'hold',
      glassK: Math.min(0.95, 0.15 + pose.t / LORD.ritual),
      face: 'hot',
    };
  } else if (mode === 'f14_broken') {
    anim = 'broken';
    fr = Math.floor(pose.t * 5) % 2;
    o = {
      ...o,
      lean: 1,
      drop: 6,
      fh: [33, 46],
      fa: 1.25,
      bh: [18, 46],
      ba: 1.8,
      glass: 'broken',
      face: 'crack',
    };
  } else if (mode === 'f14_tired') {
    anim = 'tired';
    fr = Math.floor(pose.t * 2) % 2;
    o = {
      ...o,
      lean: 1.5,
      drop: 3 + fr,
      fh: [33, 48],
      fa: 1.35,
      bh: [18, 48],
      ba: 1.75,
      face: 'dim',
    };
  } else if (pose.anim === 'run') {
    anim = 'run';
    fr = pose.frame % 4;
    o = { ...o, lean: 0.8, mb: (mb - (mb % 4) + fr) % 12 };
  } else if (pose.anim === 'hurt') {
    anim = 'hurt';
    o = { ...o, lean: -1.5, face: 'hot' };
  }
  const key = `${anim}|${fr}|${phase}|${o.mb}|${pose.left ? 1 : 0}|${pose.flash ? 1 : 0}|${pose.look}`;
  const hit = lordFrames.get(key);
  if (hit) return hit;
  if (lordFrames.size > 600) lordFrames.clear();
  const b = drawLord(o);
  if (anim === 'dead') b.p = scatter(b.p, fr, 31, [BRASS[3], ENAMEL[3], LORD_LOOK[phase].glow]);
  const out = finish(`lord|${key}`, b, pose.look, pose.flash, pose.left);
  frames.delete(`lord|${key}`);
  lordFrames.set(key, out);
  return out;
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

type ZoneX = (Zone | Strike) & {
  ang?: number;
  arc?: number;
  w?: number;
  which?: string;
  shot?: number;
  mob?: number;
};

const rgba = (c: RGBA, a: number) =>
  `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a)).toFixed(3)})`;

/** Метка удара наливается: `k` 0…1. */
const kOf = (z: ZoneX) => {
  const s = z as Strike;
  if ('warn' in s && typeof s.warn === 'number' && s.warn > 0) return Math.min(1, s.t / s.warn);
  return 1;
};

/** Доля жизни зоны (0 — только легла). */
const lifeK = (z: ZoneX) => {
  const zz = z as Zone;
  return zz.life > 0 && zz.life < 1e8 ? Math.min(1, zz.t / zz.life) : 0;
};

function cone(
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

const RED = hx('#ff3a28');
const HOT = hx('#ffe0a0');
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

/** Отмотка Повелителя: кольцо песка течёт к центру, против часовой. */
registerZonePainter('f14_glassring', (g, z, px, py, S) => {
  const R = z.r * S;
  const t = F14_FX.clock;
  const k = lifeK(z as ZoneX);
  g.strokeStyle = rgba(TEAL_GLOW, 0.5);
  g.lineWidth = 1;
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.stroke();
  // Сектор — сколько времени у тебя осталось.
  g.fillStyle = rgba(TEAL[2], 0.14);
  g.beginPath();
  g.moveTo(px, py);
  g.arc(px, py, R, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - k));
  g.closePath();
  g.fill();
  for (let i = 0; i < 18; i++) {
    const a = -(i / 18) * TAU - t * 1.4;
    const rr = R * (1 - ((i * 0.37 + t * 0.8) % 1));
    g.fillStyle = rgba(i % 3 ? SAND[3] : TEAL_GLOW, 0.8);
    g.fillRect(Math.round(px + Math.cos(a) * rr), Math.round(py + Math.sin(a) * rr), 1, 1);
  }
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

/** Часовая Повелителя: тяжёлый конус, по нему проходит тень стрелки. */
registerZonePainter('f14_lordhour', (g, z, px, py, S) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const R = z.r * S;
  const a = zz.ang ?? 0;
  const arc = zz.arc ?? 1.9;
  cone(g, px, py, R, a, arc);
  g.fillStyle = rgba(RED, 0.14 + 0.3 * k);
  g.fill();
  g.strokeStyle = rgba(RED, 0.7 + 0.3 * k);
  g.lineWidth = 1;
  g.stroke();
  // Тень стрелки ползёт от края к краю.
  const sa = a - arc / 2 + arc * k;
  g.strokeStyle = rgba(INK, 0.55);
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(px, py);
  g.lineTo(px + Math.cos(sa) * R, py + Math.sin(sa) * R);
  g.stroke();
  return true;
});

/** Разворот стрелок: кольцо, по нему бегут два клинка. */
registerZonePainter('f14_lordspin', (g, z, px, py, S) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const R = z.r * S;
  const w = (zz.w ?? 0.72) * S;
  g.strokeStyle = rgba(RED, 0.16 + 0.3 * k);
  g.lineWidth = w * 2;
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.stroke();
  g.strokeStyle = rgba(RED, 0.7);
  g.lineWidth = 1;
  for (const rr of [R - w, R + w]) {
    g.beginPath();
    g.arc(px, py, rr, 0, TAU);
    g.stroke();
  }
  for (let i = 0; i < 2; i++) {
    const a = k * TAU * 1.5 + i * Math.PI;
    g.strokeStyle = rgba(HOT, 0.9);
    g.lineWidth = 2;
    g.beginPath();
    g.arc(px, py, R, a - 0.4, a);
    g.stroke();
  }
  return true;
});

/**
 * Двенадцатый удар: темнеет вся арена, кроме ступицы. Ступица светится —
 * куда бежать, видно сразу; двенадцать лучей часов по полу.
 */
registerZonePainter('f14_midnight', (g, z, px, py, S) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const R = z.r * S;
  const w = (zz.w ?? 4.5) * S;
  const inner = R - w;
  const outer = R + w;
  g.fillStyle = rgba(hx('#2a0a3a'), 0.25 + 0.4 * k);
  g.beginPath();
  g.arc(px, py, outer, 0, TAU);
  g.arc(px, py, inner, 0, TAU, true);
  g.fill('evenodd');
  g.strokeStyle = rgba(RED, 0.6 + 0.4 * k);
  g.lineWidth = 1;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    g.beginPath();
    g.moveTo(px + Math.cos(a) * inner, py + Math.sin(a) * inner);
    g.lineTo(
      px + Math.cos(a) * (inner + (outer - inner) * k),
      py + Math.sin(a) * (inner + (outer - inner) * k),
    );
    g.stroke();
  }
  // Спасение — ступица: белое кольцо пульсирует.
  g.strokeStyle = rgba(hx('#dfe8ff'), 0.7 + 0.3 * Math.sin(k * 30));
  g.lineWidth = 2;
  g.beginPath();
  g.arc(px, py, inner - 2, 0, TAU);
  g.stroke();
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
