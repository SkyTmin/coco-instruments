// Этаж 5 «Лабиринт» — рисовальщики: монстры, реквизит, свои клетки,
// метки ударов, иконки вещей. Всё рисует код, пиксели 16 на клетку, свет
// сверху-слева, контур тёмный. Кадры собираются один раз и лежат в кеше.
//
// Порядок модулей: этот файл ничего не вызывает из движка при загрузке —
// только регистрирует рисовальщиков. `Px` и холсты создаются, когда кадр
// впервые нужен рендеру.

import { Px } from '../dungeon-art';
import {
  frameLRU,
  paintSim,
  registerCellPainter,
  registerItemArt,
  registerMobPainter,
  registerMobWarm,
  registerPropPainter,
  registerZonePainter,
} from '../dungeon-paint';
import type { CellCtx, MobFrame, MobPose, Sprite } from '../dungeon-paint';
import type { Mob, Strike, Zone } from '../dungeon-sim';
import { F5_ARENA, F5_MARK, F5_MAZE } from './f5';
// Мобы этажа в объёме (анимации мобов 5): регистрация рисовальщиков.
import './f5-mobs';

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
const alpha = (c: RGBA, a: number): RGBA => [c[0], c[1], c[2], Math.round(a * 255)];

const INK = hx('#150f0b');
const WHITE = hx('#ffffff');
const GOLD = hx('#ffcc40');
export const TAU = Math.PI * 2;

/** Четыре тона формы: тень, основа, свет, блик. */
type Tones = [RGBA, RGBA, RGBA, RGBA];

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

/** Конечность: сужающаяся «капсула» от (x0, y0) до (x1, y1) со светом по нормали. */
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

/** Толстая линия. */
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

/** Кривая Катмулла — Рома через точки. */
function spline(pts: [number, number][], n = 6): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 *
        (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Стереть пиксель (скол, дыра). */
function clear(p: Px, x: number, y: number): void {
  if (x < 0 || y < 0 || x >= p.w || y >= p.h) return;
  p.data[(y * p.w + x) * 4 + 3] = 0;
}

/** Детерминированный шум по двум числам. */
export const hash = (a: number, b: number, c = 0) => {
  let h = (a * 374761393 + b * 668265263 + c * 1274126177) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

// ---------------------------------------------------------------------------
// Кадр монстра: общий конвейер (облик, вспышка, отражение, кеш).
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

/** Альбинос — белёсый, элита — золотой кант, удар — белым. */
function finish(key: string, b: Built, look: Look, flash: boolean, left: boolean): MobFrame {
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
  if (look === 'elite') p.outline(GOLD);
  if (flash) p = p.tint(WHITE, 0.85);
  if (left) p = p.flipX();
  const eye = b.eye ? ([left ? p.w - 1 - b.eye[0] : b.eye[0], b.eye[1]] as [number, number]) : null;
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
): MobFrame {
  const key = `${kind}|${anim}|${f}|${pose.left ? 1 : 0}|${pose.flash ? 1 : 0}|${pose.look}`;
  const hit = frames.get(key);
  if (hit) return hit;
  return finish(key, build(), pose.look, pose.flash, pose.left);
}

const EMPTY = (): Built => ({ p: new Px(2, 2), ax: 1, ay: 1, eye: null });

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
    p.set(x, y - 1, c1);
    p.set(x, y + 1, c1);
  }
}

// ---------------------------------------------------------------------------
// Кролик-рогач: белый, красные глаза, витой рог. 22×18, смотрит вправо.
// ---------------------------------------------------------------------------

const RB = {
  fur: [hx('#8e8276'), hx('#c9bfb2'), hx('#e9e1d5'), hx('#fbf8f2')] as Tones,
  ear: hx('#d88a86'),
  earDk: hx('#a45e5c'),
  horn: [hx('#8a6a2c'), hx('#c8a050'), hx('#f0d890'), hx('#fff6d6')] as Tones,
  eye: hx('#ff2a44'),
  nose: hx('#e07a80'),
  grass: [hx('#26330f'), hx('#3e5218'), hx('#62782a'), hx('#8ea244')] as Tones,
};

interface RabbitPose {
  bx: number;
  by: number;
  brx: number;
  bry: number;
  hx: number;
  hy: number;
  /** Уши: угол (от вертикали назад), длина. */
  ear: number;
  earLen: number;
  /** Рог: угол от горизонтали (минус — вверх). */
  horn: number;
  /** Задняя лапа: вытянута назад (0…1). */
  kick: number;
  /** Передние лапы: подняты (0…1). */
  paws: number;
  closed: boolean;
  lines: boolean;
}

function rabbitPose(anim: string, f: number): RabbitPose {
  const base: RabbitPose = {
    bx: 9.5,
    by: 11.5,
    brx: 5,
    bry: 4,
    hx: 14.5,
    hy: 8,
    ear: 0.35,
    earLen: 6,
    horn: -0.55,
    kick: 0,
    paws: 0,
    closed: false,
    lines: false,
  };
  switch (anim) {
    case 'idle': {
      const b = f % 2 ? 0.35 : 0;
      base.bry += b * 0.6;
      base.by -= b * 0.3;
      base.ear += f === 2 ? -0.2 : f === 3 ? 0.15 : 0;
      base.hy += f === 3 ? 0.4 : 0;
      break;
    }
    case 'hop': {
      const k = f % 4;
      if (k === 0) {
        base.by += 1;
        base.bry -= 0.4;
        base.brx += 0.4;
        base.hy += 1;
        base.ear = 0.6;
      } else if (k === 1) {
        base.by -= 1.5;
        base.bx += 0.8;
        base.brx += 1;
        base.bry -= 0.6;
        base.hx += 1.5;
        base.hy -= 1;
        base.kick = 1;
        base.ear = 0.9;
      } else if (k === 2) {
        base.by -= 2.5;
        base.bx += 0.5;
        base.hy -= 2;
        base.hx += 1;
        base.ear = 1.1;
        base.paws = 0.6;
      } else {
        base.by -= 0.3;
        base.hx += 0.6;
        base.hy += 0.6;
        base.paws = 1;
        base.ear = 0.7;
      }
      break;
    }
    case 'wind': {
      // Припал к земле, уши прижаты, рог вперёд, дрожит.
      base.by += 1.5;
      base.bry -= 0.8;
      base.brx += 0.6;
      base.bx += f % 2 ? 0.4 : -0.1;
      base.hx += 1;
      base.hy += 2.2;
      base.ear = 1.35;
      base.earLen = 5.5;
      base.horn = -0.05;
      break;
    }
    case 'charge': {
      base.by -= 1;
      base.brx = 6.8;
      base.bry = 3;
      base.bx += 0.5;
      base.hx = 17.5;
      base.hy = 9;
      base.ear = 1.45;
      base.earLen = 6.5;
      base.horn = 0;
      base.kick = 1.3;
      base.lines = true;
      break;
    }
    case 'hurt': {
      base.bx -= 1;
      base.hx -= 2;
      base.hy += 1;
      base.ear = 1.2;
      base.closed = true;
      break;
    }
  }
  return base;
}

function paintRabbit(rp: RabbitPose, anim: string): Built {
  const W = 24;
  const H = 18;
  const p = new Px(W, H);
  const G = 16;
  if (anim === 'dead') {
    // На спине, лапы вверх.
    shadeEll(p, 11, 13, 5.5, 3.2, RB.fur);
    shadeEll(p, 16.5, 13.5, 3, 2.6, RB.fur);
    for (const x of [8, 10, 13]) stroke(p, x, 11, x + 1, 8, RB.fur[1]);
    limb(p, 18, 12, 21, 14, 0.7, 0.5, RB.horn);
    p.outline(INK);
    p.set(17, 13, RB.earDk);
    return { p, ax: 11, ay: G, eye: null };
  }
  // Хвост-помпон.
  shadeEll(p, rp.bx - rp.brx + 0.6, rp.by - 1.2, 1.8, 1.7, RB.fur, 0.2);
  // Задняя лапа — длинная ступня.
  const kx = rp.bx - 2 - rp.kick * 3;
  limb(p, rp.bx - 1.5, rp.by + 1.5, kx, G - 0.8, 1.6, 1, RB.fur, -0.1);
  stroke(p, kx - 1.5, G - 0.5, kx + 2, G - 0.5, RB.fur[1]);
  // Тело.
  shadeEll(p, rp.bx, rp.by, rp.brx, rp.bry, RB.fur);
  // Передние лапки.
  const fx = rp.hx - 1.5;
  const fy = rp.by + rp.bry * 0.6;
  limb(p, fx, fy, fx + 0.6 + rp.paws * 1.5, G - 0.8 - rp.paws * 2.5, 0.9, 0.7, RB.fur);
  // Уши: длинные, розовые внутри, назад.
  for (const [dx, k] of [
    [-0.6, 1],
    [0.7, 0.85],
  ] as const) {
    const a = -Math.PI / 2 - rp.ear * k;
    const x0 = rp.hx + dx - 0.5;
    const y0 = rp.hy - 2.2;
    const x1 = x0 + Math.cos(a) * rp.earLen;
    const y1 = y0 + Math.sin(a) * rp.earLen;
    limb(p, x0, y0, x1, y1, 1.1, 0.8, RB.fur, 0.1);
    stroke(
      p,
      x0 + Math.cos(a),
      y0 + Math.sin(a),
      x1 - Math.cos(a) * 1.2,
      y1 - Math.sin(a) * 1.2,
      k === 1 ? RB.ear : RB.earDk,
    );
  }
  // Голова.
  shadeEll(p, rp.hx, rp.hy, 3.1, 2.9, RB.fur);
  shadeEll(p, rp.hx + 2, rp.hy + 0.9, 1.6, 1.4, RB.fur, 0.15);
  // Рог: витой, от лба вперёд.
  const ha = rp.horn;
  const hx0 = rp.hx + 1.2;
  const hy0 = rp.hy - 2;
  const hx1 = hx0 + Math.cos(ha) * 5.2;
  const hy1 = hy0 + Math.sin(ha) * 5.2;
  limb(p, hx0, hy0, hx1, hy1, 1.1, 0.35, RB.horn);
  for (let i = 1; i < 4; i++) {
    const k = i / 4.5;
    p.set(Math.floor(hx0 + (hx1 - hx0) * k), Math.floor(hy0 + (hy1 - hy0) * k), RB.horn[0]);
  }
  if (rp.lines) {
    // Полосы скорости.
    const c = alpha(RB.fur[2], 0.55);
    for (const [y, l] of [
      [7, 4],
      [10, 6],
      [13, 3],
    ] as const)
      stroke(p, 0, y, l, y, c);
  }
  p.outline(INK);
  // Глаз и нос — поверх контура.
  const ex = Math.round(rp.hx + 0.9);
  const ey = Math.round(rp.hy - 0.6);
  if (rp.closed) {
    p.set(ex - 1, ey, INK);
    p.set(ex, ey, INK);
  } else {
    p.set(ex, ey, RB.eye);
    p.set(ex, ey + 1, hx('#a01020'));
  }
  p.set(Math.round(rp.hx + 3.4), Math.round(rp.hy + 0.6), RB.nose);
  return { p, ax: Math.round(rp.bx), ay: G, eye: rp.closed ? null : [ex, ey] };
}

/** Кролик в траве: торчат уши и кончик рога, спереди — стебли. */
function paintRabbitHidden(f: number): Built {
  const p = new Px(16, 16);
  const tw = f % 2 ? 0.25 : 0;
  for (const [dx, k] of [
    [-1.2, 1],
    [0.9, 0.8],
  ] as const) {
    const a = -Math.PI / 2 - (0.25 + tw) * k;
    const x0 = 7 + dx;
    const y0 = 12;
    limb(p, x0, y0, x0 + Math.cos(a) * 6, y0 + Math.sin(a) * 6, 1.1, 0.8, RB.fur, 0.1);
    stroke(
      p,
      x0 + Math.cos(a) * 1.5,
      y0 + Math.sin(a) * 1.5,
      x0 + Math.cos(a) * 4.8,
      y0 + Math.sin(a) * 4.8,
      k === 1 ? RB.ear : RB.earDk,
    );
  }
  limb(p, 9.5, 11, 13, 8.2, 0.9, 0.35, RB.horn);
  p.outline(INK);
  // Глаза блестят из травы.
  p.set(9, 12, RB.eye);
  // Стебли перед зверьком.
  for (let i = 0; i < 9; i++) {
    const x = 2 + i * 1.5 + (hash(i, 7) - 0.5);
    const h = 3 + Math.floor(hash(i, 3) * 4);
    const lean = (hash(i, 5) - 0.5) * 2;
    stroke(p, x, 15, x + lean, 15 - h, RB.grass[1 + (i % 3)]);
  }
  return { p, ax: 8, ay: 15, eye: [9, 12] };
}

registerMobPainter('f5_rabbit', (m: Mob, pose: MobPose) => {
  const mode = pose.mode;
  if (mode === 'f5_hide') {
    const f = Math.floor(pose.t * 1.5 + m.id) % 2;
    return frameOf('f5_rabbit', pose, 'hide', f, () => paintRabbitHidden(f));
  }
  let anim: string = pose.anim;
  let f = pose.frame;
  if (mode === 'aim') {
    anim = 'wind';
    f = Math.floor(pose.t * 14) % 2;
  } else if (mode === 'charge') {
    anim = 'charge';
    f = 0;
  } else if (mode === 'dizzy') anim = 'dizzy';
  else if (anim === 'run' || mode === 'hop' || mode === 'chase') {
    anim = Math.hypot(m.vx, m.vy) > 0.4 || mode === 'hop' ? 'hop' : 'idle';
    f = anim === 'hop' ? Math.floor(pose.t * 9 + m.id) % 4 : pose.frame % 4;
  } else if (anim === 'wind' || anim === 'bite') anim = 'wind';
  else if (anim !== 'hurt' && anim !== 'dead') anim = 'idle';
  if (anim === 'idle') f = ((f % 4) + 4) % 4;
  if (anim === 'dizzy') {
    const k = Math.floor(pose.t * 6) % 4;
    return frameOf('f5_rabbit', pose, 'dizzy', k, () => {
      const b = paintRabbit(rabbitPose('hurt', 0), 'hurt');
      stars(b.p, 14, 3, 4, k);
      return b;
    });
  }
  const ff = anim === 'hurt' || anim === 'dead' || anim === 'charge' ? 0 : f;
  return frameOf('f5_rabbit', pose, anim, ff, () => paintRabbit(rabbitPose(anim, ff), anim));
});

// ---------------------------------------------------------------------------
// Адская гончая — рисует `f5-mobs.ts` (мини-3D, 8 сторон); здесь — палитра
// для иконки уголька.
// ---------------------------------------------------------------------------

const HD = {
  body: [hx('#0e0a0c'), hx('#241c1e'), hx('#3e3234'), hx('#62504c')] as Tones,
  ember: hx('#ff7a1a'),
  emberHi: hx('#ffd24a'),
  emberDk: hx('#a8300c'),
  eye: hx('#ffb030'),
  tooth: hx('#f0e6d0'),
  maw: hx('#5a0e08'),
};

// ---------------------------------------------------------------------------
// Муравей-убийца — рисует `f5-mobs.ts` (мини-3D, 8 сторон); здесь — хитин
// для иконки материала.
// ---------------------------------------------------------------------------

const AN = {
  shell: [hx('#2a0c08'), hx('#5c1c12'), hx('#8e3620'), hx('#d06a40')] as Tones,
  spec: hx('#f6c49a'),
};

// ---------------------------------------------------------------------------
// Тень лабиринта: высокая, чёрная, маска-осколок, три когтя. 22×30.
// ---------------------------------------------------------------------------

const SH = {
  body: [hx('#050308'), hx('#120d1a'), hx('#261d36'), hx('#453764')] as Tones,
  rim: hx('#6a52a0'),
  glow: hx('#a07cff'),
  mask: hx('#dcd6ec'),
  maskDk: hx('#8e86ac'),
  claw: hx('#e4def4'),
  clawDk: hx('#9a92b8'),
  eye: hx('#c8a0ff'),
  smoke: hx('#241a34'),
};

interface ShadePose {
  sway: number;
  lean: number;
  /** Ближняя рука: угол от плеча (0 — вниз, минус — вперёд-вверх). */
  arm: number;
  far: number;
  step: number;
  slash: boolean;
  closed: boolean;
}

function shadePose(anim: string, f: number): ShadePose {
  const ps: ShadePose = {
    sway: 0,
    lean: 0,
    arm: 0.25,
    far: -0.15,
    step: 0,
    slash: false,
    closed: false,
  };
  if (anim === 'idle') {
    ps.sway = [0, 0.6, 1, 0.4][f % 4];
    ps.arm = 0.2 + (f % 2) * 0.08;
  } else if (anim === 'run') {
    const ph = (f / 6) * TAU;
    ps.lean = 2;
    ps.step = ph;
    ps.arm = 0.9 + Math.sin(ph) * 0.3;
    ps.far = 0.6 - Math.sin(ph) * 0.3;
  } else if (anim === 'wind') {
    // Коготь занесён высоко за голову.
    ps.lean = -0.8;
    ps.arm = -2.6 - f * 0.2;
    ps.far = 0.4;
  } else if (anim === 'slash') {
    ps.lean = 2.2;
    ps.arm = -0.9 + f * 0.9;
    ps.far = -0.4;
    ps.slash = f === 0;
  } else if (anim === 'hurt') {
    ps.lean = -1.4;
    ps.arm = 0.6;
    ps.far = 0.5;
    ps.closed = true;
  }
  return ps;
}

function paintShade(sp: ShadePose, anim: string, f: number): Built {
  const W = 24;
  const H = 30;
  const G = 28;
  const p = new Px(W, H);
  const cx = 11 + sp.sway * 0.5;
  const hipY = 19;
  const neckX = cx + sp.lean;
  // Дымные ноги: тонкие, книзу распадаются клочьями.
  const stepA = Math.sin(sp.step) * 2.5;
  limb(p, cx - 1, hipY, cx - 2 - stepA * 0.6, G - 1, 1.2, 0.5, SH.body, -0.3);
  limb(p, cx + 1, hipY, cx + 2 + stepA * 0.6, G - 1, 1.3, 0.5, SH.body);
  for (let i = 0; i < 6; i++) {
    const x = cx - 4 + i * 1.6 + Math.round(hash(i, f) * 1.5);
    const y = G - Math.round(hash(i, f + 3) * 2);
    p.set(Math.floor(x), y, SH.smoke);
  }
  // Дальняя рука.
  const shY = 10.5;
  const farA = sp.far + Math.PI / 2;
  const fex = neckX - 2 + Math.cos(farA) * 6;
  const fey = shY + Math.sin(farA) * 6;
  limb(p, neckX - 2, shY, fex, fey, 1.1, 0.8, SH.body, -0.35);
  for (let k = -1; k <= 1; k++)
    stroke(
      p,
      fex,
      fey,
      fex + Math.cos(farA + k * 0.35) * 3,
      fey + Math.sin(farA + k * 0.35) * 3,
      SH.clawDk,
    );
  // Туловище: узкое, сутулое, к бёдрам сходится.
  poly(
    p,
    [
      [neckX - 3.2, shY - 1],
      [neckX + 3.6, shY - 0.5],
      [cx + 2.2, hipY + 0.5],
      [cx - 2.2, hipY + 0.5],
    ],
    (x, y) => {
      const k = (x + 0.5 - cx) / 4;
      return tone(SH.body, -k * 0.6 - ((y - shY) / (hipY - shY)) * 0.2 + 0.25);
    },
  );
  // Голова: вытянутый овал, маска-осколок на лице.
  const hx0 = neckX + 1.2;
  const hy0 = shY - 4.6;
  shadeEll(p, hx0, hy0, 3, 3.8, SH.body);
  poly(
    p,
    [
      [hx0 + 0.2, hy0 - 3],
      [hx0 + 3, hy0 - 1.8],
      [hx0 + 2.6, hy0 + 2.4],
      [hx0 + 0.6, hy0 + 3.2],
      [hx0 - 0.4, hy0 + 0.4],
    ],
    (x, y) => ((x + y) % 5 === 0 ? SH.maskDk : SH.mask),
  );
  // Ближняя рука с тремя когтями.
  const a = sp.arm + Math.PI / 2;
  const elx = neckX + 2.5 + Math.cos(a) * 3.2;
  const ely = shY + 0.5 + Math.sin(a) * 3.2;
  const hx1 = elx + Math.cos(a - 0.2) * 3.6;
  const hy1 = ely + Math.sin(a - 0.2) * 3.6;
  limb(p, neckX + 2.5, shY + 0.5, elx, ely, 1.3, 1, SH.body);
  limb(p, elx, ely, hx1, hy1, 1, 0.8, SH.body);
  p.outline(INK);
  // Когти — после контура: три длинных тонких, веером, основание темнее.
  for (let k = -1; k <= 1; k++) {
    const ca = a - 0.2 + k * 0.45;
    const bx = hx1 + Math.cos(ca + Math.PI / 2) * k * 0.8;
    const by = hy1 + Math.sin(ca + Math.PI / 2) * k * 0.8;
    for (let i = 1; i <= 5; i++)
      p.set(
        Math.floor(bx + Math.cos(ca) * i),
        Math.floor(by + Math.sin(ca) * i),
        i < 2 ? SH.clawDk : SH.claw,
      );
  }
  // Кромка света по спине и груди — фиолетовый отсвет: тень видна на тёмном полу.
  for (let y = shY; y < hipY; y++) {
    const kb = (y - shY) / (hipY - shY);
    if (y % 2 === 0) p.set(Math.floor(neckX - 3.2 + kb * (cx - 2.2 - neckX + 3.2)), y, SH.rim);
    p.set(Math.floor(neckX + 3.4 + kb * (cx + 2 - neckX - 3.4)), y, y % 3 ? SH.rim : SH.glow);
  }
  // Трещина на маске и глаз.
  stroke(p, hx0 + 1.5, hy0 - 2.4, hx0 + 1, hy0 + 0.5, SH.maskDk);
  const ex = Math.floor(hx0 + 1.8);
  const ey = Math.floor(hy0 - 0.4);
  if (!sp.closed) {
    p.set(ex, ey, SH.eye);
    p.set(ex + 1, ey, SH.glow);
  } else p.set(ex, ey, INK);
  if (sp.slash) {
    // След удара — фиолетовая дуга.
    for (let i = 0; i < 9; i++) {
      const t = i / 8;
      const ang = -1.2 + t * 2.2;
      p.set(
        Math.floor(neckX + 5 + Math.cos(ang) * 7),
        Math.floor(shY + 3 + Math.sin(ang) * 7),
        i % 2 ? SH.glow : SH.rim,
      );
    }
  }
  return { p, ax: Math.round(cx), ay: G, eye: sp.closed ? null : [ex, ey] };
}

/**
 * Выход из стены: тьма сгущается в тело — сначала чёрный полупрозрачный
 * силуэт, к концу — свои цвета; у ног горит трещина.
 */
function bornFrom(b: Built, k: number): Built {
  const src = b.p;
  const p = new Px(src.w, src.h);
  const show = (k + 1) / 4;
  const dark = hx('#0a0606');
  for (let y = 0; y < src.h; y++)
    for (let x = 0; x < src.w; x++) {
      const c = src.get(x, y);
      if (!c[3]) continue;
      const m = mixc(c, dark, 0.85 * (1 - show));
      p.set(x, y, [m[0], m[1], m[2], Math.round(c[3] * (0.45 + 0.55 * show))]);
    }
  // Трещина-свет у ног.
  for (let x = 1; x < src.w - 1; x++)
    if (hash(x, k) < 0.55) p.set(x, b.ay - 1, hx(k % 2 ? '#ff6a2a' : '#c83a18'));
  return { p, ax: b.ax, ay: b.ay, eye: k >= 2 ? b.eye : null };
}

/** Тень уходит в пол: тает сверху, внизу лужа тьмы. */
function meltFrom(b: Built, k: number): Built {
  const src = b.p;
  const p = new Px(src.w, src.h);
  const keep = 1 - (k + 1) / 5;
  const top = Math.floor(src.h * (1 - keep));
  for (let y = top; y < src.h; y++)
    for (let x = 0; x < src.w; x++) {
      const c = src.get(x, Math.floor(src.h - (src.h - y) / Math.max(0.2, keep)));
      if (c[3]) p.set(x, y, c);
    }
  p.ell(b.ax, b.ay - 0.5, 4 + k, 1.2, SH.body[1]);
  return { p, ax: b.ax, ay: b.ay, eye: null };
}

registerMobPainter('f5_shade', (m: Mob, pose: MobPose) => {
  const mode = pose.mode;
  if (mode === 'f5_gone') return frameOf('f5_shade', pose, 'gone', 0, EMPTY);
  if (mode === 'f5_born') {
    const k = Math.min(3, Math.floor((pose.t / 0.8) * 4));
    return frameOf('f5_shade', pose, 'born', k, () =>
      bornFrom(paintShade(shadePose('idle', 0), 'idle', 0), k),
    );
  }
  if (mode === 'melt') {
    const k = Math.min(3, Math.floor((pose.t / 0.55) * 4));
    return frameOf('f5_shade', pose, 'melt', k, () =>
      meltFrom(paintShade(shadePose('hurt', 0), 'hurt', 0), k),
    );
  }
  let anim: string = pose.anim;
  let f = pose.frame;
  if (mode === 'slash2') {
    anim = pose.t < 0.2 ? 'wind' : 'slash';
    f = pose.t < 0.2 ? 1 : 0;
  } else if (mode === 'recover' && pose.t < 0.2) {
    anim = 'slash';
    f = pose.t < 0.1 ? 0 : 1;
  }
  if (anim === 'run') f = ((f % 6) + 6) % 6;
  else if (anim === 'idle') f = ((f % 4) + 4) % 4;
  else if (anim === 'wind') f = Math.min(1, Math.max(0, f));
  else if (anim === 'bite') {
    anim = 'slash';
    f = Math.min(1, Math.max(0, f));
  } else if (anim === 'dead') {
    return frameOf('f5_shade', pose, 'dead', 0, () =>
      meltFrom(paintShade(shadePose('hurt', 0), 'hurt', 0), 2),
    );
  } else if (anim === 'sleep') anim = 'idle';
  else if (anim !== 'slash') f = 0;
  return frameOf('f5_shade', pose, anim, f, () => paintShade(shadePose(anim, f), anim, f));
});

// ---------------------------------------------------------------------------
// Жаба-арканщица: оливковая, бородавки, жёлтое брюхо, глаза-бугры. 22×16.
// ---------------------------------------------------------------------------

const FR = {
  skin: [hx('#24360f'), hx('#4a6a24'), hx('#76963a'), hx('#a8c464')] as Tones,
  belly: [hx('#8a7030'), hx('#c8b058'), hx('#e2d07c'), hx('#f4e6a4')] as Tones,
  wart: hx('#2a3c10'),
  wartHi: hx('#b0cc60'),
  iris: hx('#f0dc40'),
  pupil: hx('#101008'),
  mouth: hx('#6a1a1a'),
  tongue: hx('#e87890'),
};

function paintFrog(anim: string, f: number): Built {
  const W = 22;
  const H = 16;
  const G = 14;
  const p = new Px(W, H);
  if (anim === 'dead') {
    shadeEll(p, 11, 11, 6, 3.4, FR.belly);
    limb(p, 7, 10, 4, 7, 1, 0.7, FR.skin);
    limb(p, 15, 10, 18, 7, 1, 0.7, FR.skin);
    p.outline(INK);
    return { p, ax: 11, ay: G, eye: null };
  }
  let by = 10;
  let bx = 10;
  let rx = 6.6;
  let ry = 4.2;
  let jump = 0;
  let throat = 0;
  let mouth = 0;
  let legOut = 0;
  let blink = false;
  if (anim === 'idle') {
    throat = [0, 0.6, 1, 0.4][f % 4];
    blink = f === 3;
  } else if (anim === 'hop') {
    const k = f % 4;
    if (k === 0) {
      by += 1;
      ry -= 0.6;
      rx += 0.5;
    } else if (k === 1) {
      by -= 2;
      bx += 1;
      rx += 1.2;
      ry -= 0.8;
      legOut = 1;
    } else if (k === 2) {
      jump = 3;
      legOut = 0.6;
    } else {
      by += 0.6;
      ry -= 0.3;
    }
  } else if (anim === 'wind') {
    by -= 1;
    ry += 0.6;
    throat = 1.2;
    mouth = 0.3 + f * 0.2;
  } else if (anim === 'lash') {
    by -= 0.5;
    mouth = 1;
    bx += 0.6;
  } else if (anim === 'hurt') {
    ry -= 0.8;
    by += 0.8;
    blink = true;
  }
  const y0 = by - jump;
  // Задние лапы: мощные бёдра сзади.
  const lx = bx - rx + 1.5 - legOut * 3;
  shadeEll(p, bx - rx + 2.6, y0 + 1.6, 2.6, 2.2, FR.skin, -0.1);
  limb(p, bx - rx + 2, y0 + 3, lx, G - jump * 0.3, 1.2, 0.8, FR.skin, -0.2);
  stroke(p, lx - 2, G - jump * 0.3, lx + 1, G - jump * 0.3, FR.skin[1]);
  // Тело.
  shadeEll(p, bx, y0, rx, ry, FR.skin);
  // Брюхо и горловой мешок.
  p.ell(bx + 1.5, y0 + ry * 0.55, rx * 0.72, ry * 0.45, (x, y) =>
    tone(FR.belly, 0.5 - (y - y0) * 0.12),
  );
  if (throat > 0)
    shadeEll(
      p,
      bx + rx - 1.8,
      y0 + 2 + throat * 0.3,
      1.8 + throat,
      1.2 + throat * 0.6,
      FR.belly,
      0.2,
    );
  // Передние лапки.
  limb(p, bx + rx - 2.5, y0 + 2, bx + rx - 1.5, G - jump * 0.3, 0.8, 0.6, FR.skin);
  // Глаза-бугры.
  shadeEll(p, bx + rx - 3, y0 - ry + 0.6, 1.9, 1.7, FR.skin, 0.1);
  // Бородавки.
  for (let i = 0; i < 6; i++) {
    const x = bx - rx * 0.7 + hash(i, 11) * rx * 1.3;
    const y = y0 - ry * 0.5 + hash(i, 13) * ry * 0.7;
    if (p.solid(Math.floor(x), Math.floor(y)))
      p.set(Math.floor(x), Math.floor(y), i % 2 ? FR.wart : FR.wartHi);
  }
  p.outline(INK);
  // Рот — линия вдоль морды; открыт — тёмная щель и язык.
  const mx0 = Math.floor(bx + 1);
  const my = Math.floor(y0 + 1);
  const mx1 = Math.floor(bx + rx);
  for (let x = mx0; x <= mx1; x++) p.set(x, my, FR.mouth);
  if (mouth > 0.2) {
    for (let x = mx0 + 1; x <= mx1; x++) p.set(x, my + 1, FR.mouth);
    if (mouth > 0.8) {
      p.set(mx1, my, FR.tongue);
      p.set(mx1 + 1, my, FR.tongue);
    }
  }
  const ex = Math.floor(bx + rx - 2.6);
  const ey = Math.floor(y0 - ry + 0.4);
  if (blink) p.set(ex, ey, FR.skin[0]);
  else {
    p.set(ex, ey, FR.iris);
    p.set(ex - 1, ey, FR.pupil);
    p.set(ex, ey - 1, FR.iris);
  }
  return { p, ax: Math.round(bx), ay: G, eye: blink ? null : [ex, ey] };
}

registerMobPainter('f5_frog', (m: Mob, pose: MobPose) => {
  let anim: string = pose.anim;
  let f = pose.frame;
  if (pose.mode === 'aim') {
    anim = 'wind';
    f = pose.t > 0.4 ? 1 : 0;
  } else if (pose.mode === 'recover' && pose.t < 0.3) {
    anim = 'lash';
    f = 0;
  } else if (pose.mode === 'f5_born') {
    const k = Math.min(3, Math.floor((pose.t / 0.8) * 4));
    return frameOf('f5_frog', pose, 'born', k, () => bornFrom(paintFrog('idle', 0), k));
  } else if (anim === 'run' || (pose.mode === 'chase' && Math.hypot(m.vx, m.vy) > 0.3)) {
    anim = 'hop';
    f = Math.floor(pose.t * 9 + m.id) % 4;
  }
  if (anim === 'idle' || anim === 'sleep') {
    anim = 'idle';
    f = ((f % 4) + 4) % 4;
  } else if (anim === 'wind') f = Math.min(1, Math.max(0, f));
  else if (anim === 'bite') {
    anim = 'lash';
    f = 0;
  } else if (anim !== 'hop') f = 0;
  return frameOf('f5_frog', pose, anim, f, () => paintFrog(anim, f));
});

// ---------------------------------------------------------------------------
// Минотавр (v2.85): громадный бык с двуручной секирой — скелет в трёх
// измерениях и свой маленький рендер кадра.
//
// Бык собран не картинкой, а скелетом: таз, позвоночник, грудь, шея,
// голова с рогами, руки (плечо — локоть — кулак, обратная кинематика),
// бычьи ноги (бедро — колено — скакательный сустав — копыто), хвост,
// набедренник, секира. Поза — числа каналов (`Rig`), техника — ключи по
// времени с кривыми разгона и торможения; промежуточный кадр — интерполяция
// ключей, а запаздывающие части (голова, хвост, набедренник) берут ту же
// дорожку с опозданием. Кадр рисует мини-рендер: шары и капсулы с объёмом,
// плоские лезвия, z-буфер по пикселям, свет сверху-слева, тёмный контур
// снаружи и тонкий — там, где ближняя часть заходит на дальнюю.
//
// Вид — поворот всего скелета: профиль (влево — зеркало), анфас (идёт на
// камеру) и со спины; вихрь — настоящий оборот тела. Облик прежний:
// палитра `MN`, пропорции, рога и секира — те же, что у рисованного быка.
//
// Метроном — мозг (`f5-brains.ts`, `MINO`): контакт секиры — ровно в
// `axeWarn / haste`, вихря — в `0,9 / haste`, рёва — в `roarWarn / haste`.
// Кадр техники — 24 к/с от `pose.t`; покой и шаг — от `pose.now`.
// ---------------------------------------------------------------------------

/** Провал пасти: тёмное с красным отсветом. */
const MAW_T: Tones = [hx('#1a0604'), hx('#2a0806'), hx('#4a1410'), hx('#6a2018')];

const MN = {
  fur: [hx('#140a06'), hx('#301810'), hx('#4e2a1a'), hx('#704028')] as Tones,
  skin: [hx('#3e1a10'), hx('#6e3222'), hx('#9a4e32'), hx('#c8764c')] as Tones,
  muzzle: [hx('#4e3a36'), hx('#7e625a'), hx('#a8887c'), hx('#cbaea0')] as Tones,
  horn: [hx('#6a5a44'), hx('#b4a282'), hx('#e0d4b6'), hx('#f8f2e0')] as Tones,
  hornTip: hx('#2a2016'),
  hoof: [hx('#0e0806'), hx('#201410'), hx('#36261c'), hx('#50402e')] as Tones,
  cloth: [hx('#1c1008'), hx('#3a2212'), hx('#5a361e'), hx('#7a4e2c')] as Tones,
  iron: [hx('#1e2024'), hx('#3e4248'), hx('#666c74'), hx('#9aa2aa')] as Tones,
  brass: hx('#d8a840'),
  brassDk: hx('#8a6420'),
  haft: [hx('#24120a'), hx('#4a2c18'), hx('#6e4428'), hx('#94643a')] as Tones,
  steel: [hx('#34383e'), hx('#6a727a'), hx('#a8b0b8'), hx('#e4eaee')] as Tones,
  edge: hx('#f8fbfc'),
  blood: hx('#6a1210'),
  eye: hx('#ff3a20'),
  eyeHi: hx('#ffd0a0'),
  ring: hx('#e8c050'),
  nostril: hx('#120806'),
  maw: hx('#2a0806'),
  tooth: hx('#e8dcc4'),
  steam: hx('#e0d8d0', 190),
  dust: hx('#8a7258', 220),
};

// ---- Векторы и повороты. Оси тела: a — вперёд, b — к правому боку (в профиль
// вправо он ближе к камере), h — вверх. ----------------------------------------

type V3 = [number, number, number];
type M3 = [number, number, number, number, number, number, number, number, number];

const vAdd = (p: V3, q: V3): V3 => [p[0] + q[0], p[1] + q[1], p[2] + q[2]];
const vSub = (p: V3, q: V3): V3 => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
const vMul = (p: V3, k: number): V3 => [p[0] * k, p[1] * k, p[2] * k];
const vLen = (p: V3) => Math.hypot(p[0], p[1], p[2]);
const vNorm = (p: V3): V3 => vMul(p, 1 / (vLen(p) || 1));
const vDot = (p: V3, q: V3) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
const vCross = (p: V3, q: V3): V3 => [
  p[1] * q[2] - p[2] * q[1],
  p[2] * q[0] - p[0] * q[2],
  p[0] * q[1] - p[1] * q[0],
];
const vLerp = (p: V3, q: V3, k: number): V3 => [
  p[0] + (q[0] - p[0]) * k,
  p[1] + (q[1] - p[1]) * k,
  p[2] + (q[2] - p[2]) * k,
];

function mMul(A: M3, B: M3): M3 {
  const o = [0, 0, 0, 0, 0, 0, 0, 0, 0] as M3;
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      o[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c];
  return o;
}
const mApp = (M: M3, v: V3): V3 => [
  M[0] * v[0] + M[1] * v[1] + M[2] * v[2],
  M[3] * v[0] + M[4] * v[1] + M[5] * v[2],
  M[6] * v[0] + M[7] * v[1] + M[8] * v[2],
];
/** Поворот вокруг вертикали: «вперёд» уходит к правому боку. */
function yawM(y: number): M3 {
  const c = Math.cos(y);
  const s = Math.sin(y);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}
/** Наклон: верх уходит вперёд. */
function pitchM(p: number): M3 {
  const c = Math.cos(p);
  const s = Math.sin(p);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
}
/** Крен: верх уходит к правому боку. */
function rollM(r: number): M3 {
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [1, 0, 0, 0, c, s, 0, -s, c];
}
/** Направление по азимуту (от «вперёд» к правому боку) и возвышению. */
const dirOf = (az: number, el: number): V3 => [
  Math.cos(el) * Math.cos(az),
  Math.cos(el) * Math.sin(az),
  Math.sin(el),
];
/** Поворот вектора v вокруг единичной оси k на угол a (Родриг). */
function spinAround(v: V3, k: V3, a: number): V3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const kv = vCross(k, v);
  const d = vDot(k, v) * (1 - c);
  return [
    v[0] * c + kv[0] * s + k[0] * d,
    v[1] * c + kv[1] * s + k[1] * d,
    v[2] * c + kv[2] * s + k[2] * d,
  ];
}

// ---- Кадр: 88×100, земля на y 76, середина тела на x 39 (как у прежнего
// быка; ниже земли — место для секиры, идущей на камеру). ---------------------

const MW = 88;
const MH = 100;
const MAX = 39;
const MAY = 76;

/** Камера вида: поворот скелета, «три четверти» (σ) и глубина в высоту (κ). */
type View = 'side' | 'front' | 'back';
interface Cam {
  yaw: number;
  sig: number;
  kap: number;
}
const CAMS: Record<View, Cam> = {
  // Профиль: ближний бок чуть вперёд — как у рисованного быка.
  side: { yaw: 0, sig: 0.45, kap: 0.25 },
  // Анфас: идёт на камеру, вперёд — это вниз по экрану.
  front: { yaw: Math.PI / 2, sig: 0.2, kap: 0.55 },
  back: { yaw: -Math.PI / 2, sig: -0.2, kap: 0.55 },
};

// z-буфер кадра (один на все кадры: рисуем по одному).
const RC = new Uint8ClampedArray(MW * MH * 4);
const RZ = new Float32Array(MW * MH);
const RID = new Uint8Array(MW * MH);
const RH = new Float32Array(MW * MH);

function rClear(): void {
  RC.fill(0);
  RZ.fill(-1e9);
  RID.fill(0);
}

function rPut(i: number, c: RGBA, z: number, id: number): void {
  RZ[i] = z;
  RID[i] = id;
  const j = i * 4;
  RC[j] = c[0];
  RC[j + 1] = c[1];
  RC[j + 2] = c[2];
  RC[j + 3] = 255;
}

/** Смешать цвет поверх (полупрозрачное): глубину не трогает. */
function rBlend(i: number, c: RGBA): void {
  const j = i * 4;
  const a = c[3] / 255;
  const da = RC[j + 3] / 255;
  const oa = a + da * (1 - a);
  if (oa <= 0) return;
  for (let k = 0; k < 3; k++) RC[j + k] = (c[k] * a + RC[j + k] * da * (1 - a)) / oa;
  RC[j + 3] = oa * 255;
}

/** Шар (эллипсоид) на экране: объём по нормали, глубина — выпуклостью. */
function rBall(
  cx: number,
  cy: number,
  cz: number,
  rx: number,
  ry: number,
  rz: number,
  t: Tones,
  bias: number,
  id: number,
): void {
  if (rx < 0.3 || ry < 0.3) return;
  const x0 = Math.max(0, Math.floor(cx - rx - 1));
  const x1 = Math.min(MW - 1, Math.ceil(cx + rx + 1));
  const y0 = Math.max(0, Math.floor(cy - ry - 1));
  const y1 = Math.min(MH - 1, Math.ceil(cy + ry + 1));
  for (let y = y0; y <= y1; y++) {
    const dy = (y + 0.5 - cy) / ry;
    for (let x = x0; x <= x1; x++) {
      const dx = (x + 0.5 - cx) / rx;
      const q = dx * dx + dy * dy;
      if (q > 1) continue;
      const nz = Math.sqrt(1 - q);
      const z = cz + nz * rz;
      const i = y * MW + x;
      if (z <= RZ[i]) continue;
      rPut(i, tone(t, dx * LX + dy * LY + nz * LZ + bias), z, id);
    }
  }
}

/** Капсула с сужением от (x0,y0) к (x1,y1), свет по нормали. */
function rCap(
  x0: number,
  y0: number,
  z0: number,
  r0: number,
  x1: number,
  y1: number,
  z1: number,
  r1: number,
  t: Tones,
  bias: number,
  id: number,
): void {
  const bx0 = Math.max(0, Math.floor(Math.min(x0 - r0, x1 - r1)) - 1);
  const bx1 = Math.min(MW - 1, Math.ceil(Math.max(x0 + r0, x1 + r1)) + 1);
  const by0 = Math.max(0, Math.floor(Math.min(y0 - r0, y1 - r1)) - 1);
  const by1 = Math.min(MH - 1, Math.ceil(Math.max(y0 + r0, y1 + r1)) + 1);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const L2 = dx * dx + dy * dy || 1e-6;
  for (let y = by0; y <= by1; y++)
    for (let x = bx0; x <= bx1; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const k = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / L2));
      const r = r0 + (r1 - r0) * k;
      const ex = px - (x0 + dx * k);
      const ey = py - (y0 + dy * k);
      const d2 = ex * ex + ey * ey;
      if (d2 > r * r) continue;
      const nx = ex / r;
      const ny = ey / r;
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      const z = z0 + (z1 - z0) * k + nz * r;
      const i = y * MW + x;
      if (z <= RZ[i]) continue;
      rPut(i, tone(t, nx * LX + ny * LY + nz * LZ + bias), z, id);
    }
}

/**
 * Плоский многоугольник (лезвие, ухо, набедренник): вершины уже на экране
 * (x, y, глубина, высота над землёй). Глубина — по плоскости, ниже земли —
 * не рисуется (секира в полу). Цвет — функцией от точки.
 */
function rPoly(
  pts: [number, number, number, number][],
  col: (x: number, y: number) => RGBA | null,
  id: number,
): boolean {
  // Нормаль по Ньюэллу — плоскость для глубины и высоты.
  let nx = 0;
  let ny = 0;
  let nz = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    nx += (p[1] - q[1]) * (p[2] + q[2]);
    ny += (p[2] - q[2]) * (p[0] + q[0]);
    nz += (p[0] - q[0]) * (p[1] + q[1]);
    cx += p[0];
    cy += p[1];
    cz += p[2];
  }
  const n = pts.length;
  cx /= n;
  cy /= n;
  cz /= n;
  // Площадь на экране почти ноль — лезвие ребром: рисует вызывающий.
  if (Math.abs(nz) < 2.5) return false;
  const zx = -nx / nz;
  const zy = -ny / nz;
  // Высота над землёй — та же плоскость, по трём самым далёким вершинам.
  const hp = planeOf(pts);
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
  for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(MH - 1, Math.ceil(maxY)); y++)
    for (let x = Math.max(0, Math.floor(minX)); x <= Math.min(MW - 1, Math.ceil(maxX)); x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      let inside = false;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const [xi, yi] = pts[i];
        const [xj, yj] = pts[j];
        if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (!inside) continue;
      if (hp && hp[0] * px + hp[1] * py + hp[2] < -0.4) continue;
      const z = cz + (px - cx) * zx + (py - cy) * zy;
      const i = y * MW + x;
      if (z <= RZ[i]) continue;
      const c = col(x, y);
      if (c) rPut(i, c, z, id);
    }
  return true;
}

/** Высота над землёй как функция экранной точки: h = A·x + B·y + C. */
function planeOf(pts: [number, number, number, number][]): [number, number, number] | null {
  let best = 0;
  let pick: [number, number, number] | null = null;
  const n = pts.length;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      for (let k = j + 1; k < n; k++) {
        const [x1, y1, , h1] = pts[i];
        const [x2, y2, , h2] = pts[j];
        const [x3, y3, , h3] = pts[k];
        const det = (x2 - x1) * (y3 - y1) - (x3 - x1) * (y2 - y1);
        if (Math.abs(det) <= best) continue;
        best = Math.abs(det);
        const A = ((h2 - h1) * (y3 - y1) - (h3 - h1) * (y2 - y1)) / det;
        const B = ((x2 - x1) * (h3 - h1) - (x3 - x1) * (h2 - h1)) / det;
        pick = [A, B, h1 - A * x1 - B * y1];
      }
  return best > 0.5 ? pick : null;
}

/** Наклейка на поверхность: видна, если поверхность там не ближе на tol. */
function rDot(x: number, y: number, z: number, c: RGBA, tol = 2.5): void {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  if (ix < 0 || iy < 0 || ix >= MW || iy >= MH) return;
  const i = iy * MW + ix;
  if (RZ[i] < -1e8 || RZ[i] > z + tol) return;
  if (c[3] < 255) rBlend(i, c);
  else {
    const j = i * 4;
    RC[j] = c[0];
    RC[j + 1] = c[1];
    RC[j + 2] = c[2];
    RC[j + 3] = 255;
  }
}

/** Точка в воздухе (пыль, щепа): рисуется, если перед ней ничего ближе. */
function rFree(x: number, y: number, z: number, c: RGBA): void {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  if (ix < 0 || iy < 0 || ix >= MW || iy >= MH) return;
  const i = iy * MW + ix;
  if (RZ[i] > z + 1) return;
  if (c[3] < 255) rBlend(i, c);
  else rPut(i, c, Math.max(RZ[i], z), 0);
}

/** Слой поверх темноты (глаза, пар, звёзды, накал) — простой буфер. */
class Lit {
  p = new Px(MW, MH);
  any = false;
  set(x: number, y: number, c: RGBA): void {
    this.any = true;
    this.p.set(Math.floor(x), Math.floor(y), c);
  }
}

// Номера частей для тонкого внутреннего контура.
const ID = {
  torso: 1,
  head: 2,
  horn: 3,
  armN: 4,
  armF: 5,
  legN: 6,
  legF: 7,
  axe: 8,
  tail: 9,
  cloth: 10,
  hump: 11,
  blade: 12,
};

/** Готовый кадр из буфера: внутренний контур, наружный контур. */
function rFinish(): Px {
  const p = new Px(MW, MH);
  p.data.set(RC);
  // Ближняя часть поверх дальней — тонкая тёмная кромка по дальней.
  for (let y = 0; y < MH; y++)
    for (let x = 0; x < MW; x++) {
      const i = y * MW + x;
      const id = RID[i];
      if (!id || RC[i * 4 + 3] < 255) continue;
      const z = RZ[i];
      let edge = false;
      if (x > 0 && RID[i - 1] && RID[i - 1] !== id && RZ[i - 1] > z + 3.2) edge = true;
      else if (x < MW - 1 && RID[i + 1] && RID[i + 1] !== id && RZ[i + 1] > z + 3.2) edge = true;
      else if (y > 0 && RID[i - MW] && RID[i - MW] !== id && RZ[i - MW] > z + 3.2) edge = true;
      else if (y < MH - 1 && RID[i + MW] && RID[i + MW] !== id && RZ[i + MW] > z + 3.2) edge = true;
      if (!edge) continue;
      const j = i * 4;
      p.data[j] = Math.round(p.data[j] * 0.45 + 0x15 * 0.55);
      p.data[j + 1] = Math.round(p.data[j + 1] * 0.45 + 0x0f * 0.55);
      p.data[j + 2] = Math.round(p.data[j + 2] * 0.45 + 0x0b * 0.55);
    }
  // Наружный контур — прямо по буферу (как `Px.outline`, но без проверок
  // границ на каждого соседа: кадр босса рисуется за доли миллисекунды).
  const d = p.data;
  const edge: number[] = [];
  for (let y = 0; y < MH; y++)
    for (let x = 0; x < MW; x++) {
      const i = y * MW + x;
      if (d[i * 4 + 3]) continue;
      if (
        (x > 0 && d[i * 4 - 1]) ||
        (x < MW - 1 && d[i * 4 + 7]) ||
        (y > 0 && d[(i - MW) * 4 + 3]) ||
        (y < MH - 1 && d[(i + MW) * 4 + 3])
      )
        edge.push(i);
    }
  for (const i of edge) {
    d[i * 4] = INK[0];
    d[i * 4 + 1] = INK[1];
    d[i * 4 + 2] = INK[2];
    d[i * 4 + 3] = 255;
  }
  return p;
}

// ---- Поза: каналы скелета. ---------------------------------------------------

interface Rig {
  /** Таз: вперёд, вбок, высота. */
  pa: number;
  pb: number;
  ph: number;
  /** Наклон корпуса вперёд, разворот груди, крен, оборот всего тела (вихрь). */
  lean: number;
  twist: number;
  roll: number;
  spin: number;
  /** Вдох: грудь шире и выше (0…1). */
  breath: number;
  /** Голова: вынос вперёд и вверх (px), кивок (+ рогами вперёд), поворот, наклон, пасть. */
  nk: number;
  nu: number;
  hp: number;
  hy: number;
  hr: number;
  jaw: number;
  /** Ближняя (правая) кисть: от плеча — длина, азимут наружу, возвышение. */
  ar: number;
  aaz: number;
  ael: number;
  /** Дальняя (левая) кисть. */
  br: number;
  baz: number;
  bel: number;
  /** Секира в ближней руке: направление рукояти (в осях груди), поворот лезвия. */
  xaz: number;
  xel: number;
  xroll: number;
  /** Дальняя рука на рукояти (0…1), где хват от торца. */
  two: number;
  xs: number;
  /** Секира выпала: 0 — в руке, 1 — лежит/летит (xga, xgb, xgh — торец; xfaz, xfel — направление). */
  xfree: number;
  xga: number;
  xgb: number;
  xgh: number;
  xfaz: number;
  xfel: number;
  /** Копыта: ближнее, дальнее (оси корня). */
  na: number;
  nb: number;
  nh: number;
  fa: number;
  fb: number;
  fh: number;
  /** Хвост: мах вбок, подъём. Набедренник: отлёт (−назад / +вперёд). */
  tsw: number;
  tup: number;
  cloth: number;
  /** Глаза: 0 — открыты, 1 — прищур, 2 — закрыты, 3 — горят. */
  eyes: number;
  /** Пар из ноздрей, накал лезвия, звёзды (0…1). */
  steam: number;
  glow: number;
  stars: number;
  /** Ход кадра целиком: вперёд, вверх (px), сжатие вдоль, по высоте, наклон. */
  tdx: number;
  tdy: number;
  tsx: number;
  tsy: number;
  trot: number;
}
type RigKey = keyof Rig;

const READY: Rig = {
  pa: -1,
  pb: 0,
  ph: 20,
  lean: 0.22,
  twist: 0,
  roll: 0,
  spin: 0,
  breath: 0,
  nk: 0,
  nu: 0,
  hp: 0,
  hy: 0,
  hr: 0,
  jaw: 0,
  ar: 18.5,
  aaz: -0.25,
  ael: -1.2,
  br: 17,
  baz: 2.0,
  bel: -1.2,
  // Секира на плече за спиной: лезвие выглядывает из-за холки слева-сверху,
  // как у прежнего быка.
  xaz: Math.PI + 0.35,
  xel: 0.75,
  xroll: 0,
  two: 0,
  xs: 6,
  xfree: 0,
  xga: 14,
  xgb: 3,
  xgh: 0.8,
  xfaz: 0.25,
  xfel: 0.02,
  na: 4,
  nb: 5.5,
  nh: 0,
  fa: -4,
  fb: -5.5,
  fh: 0,
  tsw: 0,
  tup: 0,
  cloth: 0,
  eyes: 0,
  steam: 0,
  glow: 0,
  stars: 0,
  tdx: 0,
  tdy: 0,
  tsx: 1,
  tsy: 1,
  trot: 0,
};
const RIG_KEYS = Object.keys(READY) as RigKey[];

type Ease = (x: number) => number;
const eLin: Ease = (x) => x;
const eIn: Ease = (x) => x * x;
const eIn3: Ease = (x) => x * x * x;
const eOut: Ease = (x) => 1 - (1 - x) * (1 - x);
const eOut3: Ease = (x) => 1 - (1 - x) * (1 - x) * (1 - x);
const eIO: Ease = (x) => (x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) * (1 - x));
const eHold: Ease = () => 0;
const eStep: Ease = (x) => (x < 1 ? 0 : 1);

/** Ключ: время (с), каналы, кривая ПОДХОДА к этому ключу (по умолчанию — плавно). */
type Key = [number, Partial<Rig>, Ease?];

/**
 * Дорожка ключей: каждый канал интерполируется между ключами, где он задан,
 * по кривой подхода. `lag` — опоздание части (с): голова, хвост, ткань.
 */
function track(keys: Key[], t: number, base: Rig, lag?: Partial<Record<RigKey, number>>): Rig {
  const out = { ...base };
  for (const ch of RIG_KEYS) {
    // Опоздавшая часть в первый миг техники стоит на первом ключе, а не на ГОТОВ.
    const tt = lag?.[ch] ? Math.max(0, t - lag[ch]!) : t;
    let t0 = 0;
    let v0 = base[ch];
    let t1 = -1;
    let v1 = 0;
    let e: Ease = eIO;
    for (const [kt, kv, ke] of keys) {
      const v = kv[ch];
      if (v === undefined) continue;
      if (kt <= tt) {
        t0 = kt;
        v0 = v;
      } else {
        t1 = kt;
        v1 = v;
        e = ke ?? eIO;
        break;
      }
    }
    if (t1 < 0) out[ch] = v0;
    else out[ch] = v0 + (v1 - v0) * e(Math.max(0, Math.min(1, (tt - t0) / (t1 - t0 || 1))));
  }
  return out;
}

/** Опоздания частей по умолчанию. */
const LAG: Partial<Record<RigKey, number>> = {
  hp: 0.035,
  hy: 0.035,
  hr: 0.05,
  nk: 0.03,
  nu: 0.03,
  tsw: 0.09,
  tup: 0.08,
  cloth: 0.06,
};

// ---- Скелет из позы: суставы в осях тела. -----------------------------------

interface Skel {
  pel: V3;
  chest: V3;
  Rc: M3;
  Rh: M3;
  head: V3;
  shN: V3;
  shF: V3;
  elN: V3;
  elF: V3;
  hN: V3;
  hF: V3;
  hipN: V3;
  hipF: V3;
  footN: V3;
  footF: V3;
  /** Секира: торец, направление, плоскость лезвия. */
  ax0: V3;
  axU: V3;
  axN: V3;
  /** Грудь повёрнута к камере на этот угол (для эллипсов). */
  yawC: number;
  yawH: number;
  /** Оборот всего тела (вихрь) — след секиры берёт свой. */
  spin: number;
}

const ARM1 = 11.5;
const ARM2 = 10.5;

/** Две кости: плечо и предплечье, локоть — в сторону `pole`. */
function ik2(s: V3, target: V3, l1: number, l2: number, pole: V3): [V3, V3] {
  let d = vSub(target, s);
  let len = vLen(d);
  const max = l1 + l2 - 0.2;
  if (len > max) {
    d = vMul(d, max / len);
    len = max;
  }
  const hand = vAdd(s, d);
  const dir = vMul(d, 1 / (len || 1));
  const a = (l1 * l1 - l2 * l2 + len * len) / (2 * (len || 1));
  const hgt = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  let perp = vSub(pole, vMul(dir, vDot(pole, dir)));
  perp = vNorm(perp);
  const el = vAdd(vAdd(s, vMul(dir, a)), vMul(perp, hgt));
  return [el, hand];
}

function skeleton(r: Rig): Skel {
  const pel: V3 = [r.pa, r.pb, r.ph];
  const Rs = mMul(rollM(r.roll), pitchM(r.lean));
  const chest = vAdd(pel, mApp(Rs, [0, 0, 15.3]));
  const Rc = mMul(Rs, yawM(r.twist));
  const up = 6 + r.breath * 0.8;
  const shN = vAdd(chest, mApp(Rc, [0.5, 11.5 + r.breath * 0.6, up]));
  const shF = vAdd(chest, mApp(Rc, [0.5, -11.5 - r.breath * 0.6, up]));
  // Голова не наследует наклон корпуса: морда держится горизонтально.
  const head = vAdd(chest, mApp(Rc, [8 + r.nk, 0, 14.5 + r.nu]));
  const Rh = mMul(mMul(rollM(r.roll * 0.5), yawM(r.twist + r.hy)), mMul(pitchM(r.hp), rollM(r.hr)));
  // Кисти и секира — в осях «поворот груди без наклона»: вниз — это вниз,
  // как бы ни сгибался корпус (руки висят, секира падает по дуге).
  const Ra = yawM(r.twist);
  const polar = (rr: number, az: number, el: number, side: number): V3 =>
    mApp(Ra, [
      rr * Math.cos(el) * Math.cos(az),
      side * rr * Math.cos(el) * Math.sin(az),
      rr * Math.sin(el),
    ]);
  const tgtN = vAdd(shN, polar(r.ar, r.aaz, r.ael, 1));
  // Локти — назад, наружу и вниз.
  const [elN, hN] = ik2(shN, tgtN, ARM1, ARM2, mApp(Rc, [-1, 0.7, -0.5]));
  // Секира: в руке — от кулака, выпала — сама по себе.
  let axU: V3;
  let ax0: V3;
  if (r.xfree >= 0.5) {
    axU = dirOf(r.xfaz, r.xfel);
    ax0 = [r.xga, r.xgb, r.xgh];
  } else {
    axU = mApp(Ra, dirOf(r.xaz, r.xel));
    ax0 = vSub(hN, vMul(axU, r.xs));
  }
  // Лезвие — в плоскости взмаха (поперёк оси «бок груди»), потом поворот.
  const side = mApp(Ra, [0, 1, 0]);
  // Выпавшая секира лежит плашмя: лезвие горизонтально.
  let n0 = r.xfree >= 0.5 ? vCross([0, 0, 1], axU) : vCross(side, axU);
  if (vLen(n0) < 0.2) n0 = vCross([0, 0, 1], axU);
  const axN = spinAround(vNorm(n0), axU, r.xroll);
  let tgtF = vAdd(shF, polar(r.br, r.baz, r.bel, -1));
  if (r.two > 0 && r.xfree < 0.5) tgtF = vLerp(tgtF, vAdd(hN, vMul(axU, 7)), r.two);
  const [elF, hF] = ik2(shF, tgtF, ARM1, ARM2, mApp(Rc, [-1, -0.7, -0.5]));
  const hipN = vAdd(pel, mApp(rollM(r.roll * 0.4), [0, 7, -1]));
  const hipF = vAdd(pel, mApp(rollM(r.roll * 0.4), [0, -7, -1]));
  return {
    pel,
    chest,
    Rc,
    Rh,
    head,
    shN,
    shF,
    elN,
    elF,
    hN,
    hF,
    hipN,
    hipF,
    footN: [r.na, r.nb, r.nh],
    footF: [r.fa, r.fb, r.fh],
    ax0,
    axU,
    axN,
    yawC: r.twist,
    yawH: r.twist + r.hy,
    spin: r.spin,
  };
}

// ---- Кадр из позы ------------------------------------------------------------

/** Что ещё нарисовать в кадре, кроме тела. */
interface Extra {
  /** Время кадра, с — для пара, пыли, звёзд. */
  t: number;
  /** Секира в прошлые мгновения — для следа (по свежести). */
  trail: Skel[] | null;
  /** Грунт из-под копыта: сила 0…1 и куда летит (−1 назад, 1 вперёд). */
  dirt: number;
  dirtDir: number;
  /** Растворение при смерти, 0…1. */
  melt: number;
  /** Ярость (фаза 3): глаза и накал краснее. */
  rage: number;
  /** Секира волочится по камню: искры из-под лезвия (0…1). */
  sparks: number;
}

interface Built3 {
  p: Px;
  lit: Px | null;
  eye: [number, number] | null;
  /** Сдвиг рисунка в кадре (секира не влезала): привязка сдвинута так же. */
  ox: number;
  oy: number;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

function paintMino3(r: Rig, sk: Skel, cam: Cam, ex: Extra): Built3 {
  rClear();
  const lit = new Lit();
  const R0 = yawM(cam.yaw + r.spin);
  // Кадр 88×100 — секира на замахе над головой и в полу впереди в него не
  // всегда влезает. Тогда весь рисунок сдвигается внутри кадра на целые
  // пиксели, и привязка (середина тела, земля) — вместе с ним: на экране
  // бык стоит на том же месте, эхо на 15-м берёт ту же привязку.
  let ox = 0;
  let oy = 0;
  {
    const pr = (q: V3): [number, number] => {
      const w = mApp(R0, q);
      return [MAX + w[0] + cam.sig * w[1], MAY - w[2] + cam.kap * w[1]];
    };
    const pts: V3[] = [];
    const add = (k: Skel) => {
      const bc = vAdd(k.ax0, vMul(k.axU, 32.5));
      const Ry = yawM(k.spin - sk.spin);
      for (const [a, b] of [
        [6, 9],
        [-6, 9],
        [6, -9],
        [-6, -9],
        [0, 9.2],
        [0, -9.2],
        [5.5, 0],
      ])
        pts.push(mApp(Ry, vAdd(vAdd(bc, vMul(k.axU, a)), vMul(k.axN, b))));
    };
    add(sk);
    if (ex.trail) ex.trail.slice(0, 2).forEach(add);
    pts.push(
      sk.hN,
      sk.hF,
      vAdd(sk.head, mApp(sk.Rh, [4, 13.4, 13.4])),
      vAdd(sk.head, mApp(sk.Rh, [4, -13.4, 13.4])),
    );
    let x0 = 1e9;
    let x1 = -1e9;
    let y0 = 1e9;
    let y1 = -1e9;
    for (const q of pts) {
      // Лезвие в полу ниже земли не рисуется — не в счёт.
      const [x, y] = pr([q[0], q[1], Math.max(0, q[2])]);
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    if (x1 > MW - 3) ox = Math.floor(MW - 3 - x1);
    if (x0 + ox < 2) ox = Math.ceil(2 - x0);
    if (y0 < 2) oy = Math.ceil(2 - y0);
    if (y1 + oy > MH - 2) oy = Math.min(oy, Math.floor(MH - 2 - y1));
  }
  // Точка тела → экран: [x, y, глубина, высота над землёй].
  const P = (q: V3): [number, number, number, number] => {
    const w = mApp(R0, q);
    return [MAX + ox + w[0] + cam.sig * w[1], MAY + oy - w[2] + cam.kap * w[1], w[1] + zb, q[2]];
  };
  // Голова лежит поверх гривы и груди (как у прежнего быка, где голова
  // рисовалась после холки): глубина головы с запасом.
  let zb = 0;
  /** Дальнее темнее: смещение света по глубине. */
  const far = (z: number) => clamp(z * 0.03, -0.42, 0);
  /** Эллипсоид тела (радиусы вдоль a, b, h) с поворотом ψ к камере. */
  const ellP = (
    c: V3,
    ra: number,
    rb: number,
    rh: number,
    psi: number,
    t: Tones,
    bias: number,
    id: number,
  ) => {
    const s = P(c);
    const yaw = cam.yaw + r.spin + psi;
    const ca = Math.cos(yaw);
    const sa = Math.sin(yaw);
    const al = ca + cam.sig * sa;
    const be = -sa + cam.sig * ca;
    const rx = Math.sqrt(ra * ra * al * al + rb * rb * be * be);
    const rz = Math.sqrt(ra * ra * sa * sa + rb * rb * ca * ca);
    const ry = Math.sqrt(rh * rh + cam.kap * cam.kap * rz * rz);
    rBall(s[0], s[1], s[2], rx, ry, rz, t, bias + far(s[2]), id);
  };
  const capP = (p0: V3, p1: V3, r0: number, r1: number, t: Tones, bias: number, id: number) => {
    const a = P(p0);
    const b = P(p1);
    rCap(a[0], a[1], a[2], r0, b[0], b[1], b[2], r1, t, bias + far((a[2] + b[2]) / 2), id);
  };
  const dotP = (q: V3, c: RGBA, tol = 2.5) => {
    const s = P(q);
    rDot(s[0], s[1], s[2], c, tol);
  };
  const dark = (t: Tones): Tones => [t[0], t[0], t[1], t[2]];
  const inC = (v: V3) => vAdd(sk.chest, mApp(sk.Rc, v));
  const inH = (v: V3) => vAdd(sk.head, mApp(sk.Rh, v));
  const pelR = mMul(rollM(r.roll * 0.4), yawM(r.twist * 0.25));
  const inP = (v: V3) => vAdd(sk.pel, mApp(pelR, v));

  // --- Ноги: бедро вперёд к колену, скакательный сустав назад, копыто. ---
  const leg = (hip: V3, foot: V3, near: boolean) => {
    const d = vSub(foot, hip);
    const len = vLen(d);
    const comp = clamp(1 - len / 21, 0, 0.6);
    // «Вперёд» ноги — ось тела, перпендикулярно самой ноге.
    const fwd0 = mApp(pelR, [1, 0, 0]);
    const dir = vMul(d, 1 / (len || 1));
    const fwd = vNorm(vSub(fwd0, vMul(dir, vDot(fwd0, dir))));
    const knee = vAdd(vAdd(hip, vMul(d, 0.42)), vMul(fwd, 3.6 + comp * 14));
    const hock = vAdd(vAdd(hip, vMul(d, 0.76)), vMul(fwd, -2.6 - comp * 7));
    // Дальняя (от камеры) нога темнее — по глубине, а не по имени: в анфас
    // обе ноги одинаково близко.
    const behind = P(hip)[2] < -4;
    const t = behind ? dark(MN.fur) : MN.fur;
    const id = near ? ID.legN : ID.legF;
    const b0 = behind ? -0.3 : 0;
    capP(hip, knee, near ? 5.6 : 5, 3.8, t, b0, id);
    capP(knee, hock, 3.6, 2.4, t, b0, id);
    const ank: V3 = [foot[0], foot[1], foot[2] + 2];
    capP(hock, ank, 2.4, 2, t, b0, id);
    // Лохмы над копытом и само копыто.
    ellP([foot[0], foot[1], foot[2] + 2.5], 2.8, 2.6, 1.4, r.twist * 0.2, t, b0 - 0.1, id);
    ellP([foot[0] + 0.6, foot[1], foot[2] + 0.9], 3, 2.8, 1.6, r.twist * 0.2, MN.hoof, 0, id);
  };
  leg(sk.hipF, sk.footF, false);
  leg(sk.hipN, sk.footN, true);

  // --- Хвост с кисточкой (отстаёт). ---
  {
    const base = inP([-7, 0, 3]);
    const pts: V3[] = [
      base,
      inP([-12 - r.tup * 2, r.tsw * 4, -1.5 + r.tup * 4]),
      inP([-13.5 - r.tup * 4, r.tsw * 8, -8 + r.tup * 8.5]),
    ];
    const s2 = spline(
      pts.map((q) => {
        const s = P(q);
        return [s[0], s[1]] as [number, number];
      }),
      5,
    );
    const zs = pts.map((q) => P(q)[2]);
    s2.forEach(([x, y], i) => {
      const k = i / (s2.length - 1);
      const z = zs[0] + (zs[2] - zs[0]) * k - 1;
      rBall(x, y, z, 1.1, 1.1, 1, MN.fur, -0.1, ID.tail);
    });
    const tip = P(pts[2]);
    rBall(tip[0], tip[1] + 1.5, tip[2] - 1, 1.5, 2.3, 1.5, MN.fur, -0.2, ID.tail);
  }

  // --- Корпус: таз, живот, грудь, грудные мышцы, холка. ---
  ellP(inP([0, 0, -1]), 7.5, 8.5, 5.5, r.twist * 0.25, MN.skin, 0, ID.torso);
  capP(inP([0.5, 0, -3 + 3]), inC([0, 0, -3 - 3]), 6.8, 8.6, MN.skin, 0, ID.torso);
  const cb = 1 + r.breath * 0.12;
  ellP(sk.chest, 9 * cb, 11.2 * cb, 8 * cb, r.twist, MN.skin, -0.06, ID.torso);
  // Грудные — две выпуклости спереди.
  for (const s of [1, -1])
    ellP(inC([5.5, s * 5.2, 1.4]), 3.4, 4.8, 3.6, r.twist, MN.skin, 0.12, ID.torso);
  // Пресс: три ряда точек спереди живота.
  for (let i = 0; i < 3; i++)
    for (const s of [1, -1])
      dotP(vLerp(inC([7.2, s * 2.2, -4.5]), inP([6.8, s * 2, 3.5]), i / 3), MN.skin[0], 2);
  // Холка и грива — тёмная шерсть накидкой на лопатки и шею, к затылку.
  ellP(inC([-3, 0, 5.2]), 8.2, 11, 7.2, r.twist, MN.fur, 0.02, ID.hump);
  capP(inC([-2, 0, 6]), inH([-3.2, 0, -0.5]), 7.2, 5.4, MN.fur, 0.04, ID.hump);
  capP(inC([-7, 0, 1]), inC([-4, 0, 8]), 6.2, 6.6, MN.fur, -0.04, ID.hump);
  // Дальнее плечо.
  const farF = P(sk.shF)[2] < -5;
  const farN = P(sk.shN)[2] < -5;
  const skinF = farF ? dark(MN.skin) : MN.skin;
  const skinN = farN ? dark(MN.skin) : MN.skin;
  ellP(sk.shF, 5, 5, 4.2, r.twist, skinF, farF ? -0.1 : 0.05, ID.armF);

  // --- Перевязь через грудь, пояс с пряжкой, набедренник. ---
  {
    const a0 = inC([2, 9, 6.5]);
    const a1 = inC([8.8, 0, 0]);
    const a2 = inP([6.5, -6.5, 3.5]);
    for (let i = 0; i <= 16; i++) {
      const k = i / 16;
      const q = k < 0.5 ? vLerp(a0, a1, k * 2) : vLerp(a1, a2, (k - 0.5) * 2);
      const s = P(q);
      rDot(s[0], s[1], s[2] + 1, MN.cloth[1], 3.5);
      rDot(s[0], s[1] - 1, s[2] + 1, MN.cloth[2], 3.5);
    }
    // Пояс — кольцо вокруг таза, видна ближняя половина.
    for (let i = 0; i < 40; i++) {
      const th = (i / 40) * TAU;
      const q = inP([Math.cos(th) * 8.4, Math.sin(th) * 9, 3.2]);
      const s = P(q);
      rDot(s[0], s[1], s[2] + 1.5, MN.cloth[1], 2.4);
      rDot(s[0], s[1] + 1, s[2] + 1.5, MN.cloth[2], 2.4);
    }
    const bk = P(inP([8.6, 0, 3]));
    if (bk[2] > P(sk.pel)[2] - 1) {
      rDot(bk[0], bk[1], bk[2] + 2, MN.brass, 4);
      rDot(bk[0] + 1, bk[1], bk[2] + 2, MN.brassDk, 4);
      rDot(bk[0], bk[1] + 1, bk[2] + 2, MN.brassDk, 4);
      rDot(bk[0] - 1, bk[1] - 1, bk[2] + 2, hx('#fff0b0'), 4);
    }
    // Набедренник спереди и сзади: ткань отстаёт (`cloth`).
    const flap = (fa: number, back: boolean) => {
      const sw = r.cloth * (back ? 1 : 1);
      const q = [
        inP([fa, 5.5, 2.4]),
        inP([fa, -5.5, 2.4]),
        inP([fa + sw * 3 - (back ? -1 : 1), -4.2, -8.5]),
        inP([fa + sw * 3 - (back ? -1 : 1), 4.2, -8.5]),
      ].map(P);
      rPoly(
        q,
        (x, y) => tone(MN.cloth, 0.5 - (y - q[0][1]) * 0.045 + ((x * 3 + y) % 5 === 0 ? -0.45 : 0)),
        ID.cloth,
      );
    };
    flap(7.4, false);
    flap(-7, true);
  }

  // --- Дальняя рука (за телом, темнее). ---
  capP(sk.shF, sk.elF, 4, 3.2, skinF, farF ? -0.2 : 0, ID.armF);
  capP(sk.elF, sk.hF, 3.2, 2.6, skinF, farF ? -0.2 : 0, ID.armF);
  ellP(sk.hF, 2.6, 2.6, 2.4, r.twist, skinF, farF ? -0.05 : 0.1, ID.armF);

  // --- Голова: череп, морда, челюсть, уши, рога. ---
  zb = 6;
  const psiH = sk.yawH;
  ellP(sk.head, 6.2, 5.8, 5.6, psiH, MN.fur, 0, ID.head);
  // Переносица к морде, морда светлее.
  const snout = inH([7.4, 0, -3.6]);
  capP(inH([2, 0, 0.4]), inH([6, 0, -2.6]), 4, 3.4, MN.fur, 0.1, ID.head);
  ellP(snout, 4.2, 3.9, 3.4, psiH, MN.muzzle, 0, ID.head);
  // Челюсть: открывается вниз вокруг шарнира под черепом.
  if (r.jaw > 0.08) {
    const Rj = mMul(sk.Rh, pitchM(-r.jaw * 0.55));
    const hinge = inH([0.5, 0, -2.8]);
    const jawTip = vAdd(hinge, mApp(Rj, [6.5, 0, -2.2]));
    const lowSn = inH([7.8, 0, -5.4]);
    const mawPts = [inH([1.5, 0, -3.2]), lowSn, vAdd(jawTip, mApp(Rj, [1.2, 0, 0.6])), hinge].map(
      P,
    );
    // Пасть — тёмный клин между мордой и челюстью (сбоку) и провал рта
    // объёмом (анфас: клин в профиль ребром и не виден).
    rPoly(mawPts, () => MN.maw, ID.head);
    ellP(inH([6.6, 0, -4.4 - r.jaw * 1.2]), 3, 3, 0.8 + r.jaw * 1.7, psiH, MAW_T, 0, ID.head);
    capP(vAdd(hinge, mApp(Rj, [2, 0, -0.6])), jawTip, 2.6, 2.2, MN.muzzle, -0.05, ID.head);
    const tt = P(vAdd(lowSn, mApp(sk.Rh, [-0.8, 1.2, 0.4])));
    rDot(tt[0], tt[1], tt[2] + 3, MN.tooth, 4);
    const t2 = P(vAdd(lowSn, mApp(sk.Rh, [-2.6, 1.4, 0.4])));
    rDot(t2[0], t2[1], t2[2] + 3, MN.tooth, 4);
  }
  // Уши — плоские лопасти в стороны, под рогами.
  for (const s of [1, -1]) {
    const q = [
      inH([-1.5, s * 4.6, 0.8]),
      inH([-4.5, s * 10.5, -0.4 + r.hp * 1.5]),
      inH([-1.2, s * 5.4, -1.8]),
    ].map(P);
    const ok = rPoly(q, () => MN.fur[2], ID.head);
    if (ok) {
      const m = P(inH([-3, s * 8.4, -0.4 + r.hp * 1.2]));
      rDot(m[0], m[1], m[2] + 1, MN.muzzle[1], 3);
    }
  }
  // Рога: наружу, потом вверх и чуть вперёд; концы тёмные.
  for (const s of [1, -1]) {
    const pts: V3[] = [
      inH([-0.6, s * 4.4, 3.2]),
      inH([0.4, s * 10.5, 2.8]),
      inH([2.2, s * 14.6, 7.2]),
      inH([4, s * 13.4, 13.4]),
    ];
    // Рога в профиль разведены шире, чем честная проекция: так их
    // рисовал прежний бык — полумесяцем над головой.
    const hb = mApp(R0, sk.head)[1];
    const sc = pts.map((q) => {
      const v = P(q);
      if (cam.yaw === 0) v[0] += (mApp(R0, q)[1] - hb) * 0.26;
      return v;
    });
    const line = spline(
      sc.map((q) => [q[0], q[1]] as [number, number]),
      5,
    );
    const zs = sc.map((q) => q[2]);
    line.forEach(([x, y], i) => {
      const k = i / (line.length - 1);
      const seg = Math.min(2.999, k * 3);
      const zi = Math.floor(seg);
      const z = zs[zi] + (zs[zi + 1] - zs[zi]) * (seg - zi);
      const rr = 2.3 * (1 - k) + 0.5;
      const fz = far(z - P(sk.head)[2]);
      if (k > 0.82)
        rBall(x, y, z, rr, rr, rr, [MN.hornTip, MN.hornTip, MN.hornTip, MN.hornTip], 0, ID.horn);
      else rBall(x, y, z, rr, rr, rr, MN.horn, fz * 0.8, ID.horn);
    });
  }
  // Чёлка-вихор между рогами.
  for (let i = 0; i < 4; i++)
    dotP(inH([0.5 + (i % 2) * 0.6, -1.8 + i * 1.2, 5.6 + (i % 2) * 0.7]), MN.fur[2], 3);
  zb = 0;

  // --- Ближняя рука: плечо, локоть, кулак, наруч; наплечник. ---
  capP(sk.shN, sk.elN, 4.2, 3.4, skinN, farN ? -0.2 : 0, ID.armN);
  capP(sk.elN, sk.hN, 3.4, 2.8, skinN, farN ? -0.2 : 0, ID.armN);
  {
    const a = vLerp(sk.elN, sk.hN, 0.35);
    const b = vLerp(sk.elN, sk.hN, 0.72);
    capP(a, b, 3.6, 3.2, MN.iron, 0.05, ID.armN);
  }
  ellP(sk.hN, 2.8, 2.8, 2.6, r.twist, MN.skin, 0.1, ID.armN);
  ellP(sk.shN, 5.4, 5.4, 4.6, r.twist, MN.skin, 0.05, ID.armN);
  ellP(inC([0.8, 11.6, 7.6]), 4.6, 4.4, 2.6, r.twist, MN.iron, 0.1, ID.armN);
  {
    const q = [inC([0, 12, 8.5]), inC([1.6, 12.4, 13.5]), inC([3, 12, 8.5])].map(P);
    rPoly(q, () => MN.iron[2], ID.armN);
    const s1 = P(inC([0.4, 12.6, 8.2]));
    rDot(s1[0], s1[1], s1[2] + 2, MN.iron[3], 3);
    const s2 = P(inC([2.6, 12.6, 8.2]));
    rDot(s2[0], s2[1], s2[2] + 2, MN.iron[3], 3);
  }

  // --- Секира. ---
  const ground = paintAxe3(sk, P, R0, lit, r.glow, ex.rage);

  // --- Глаза, надбровье, ноздри, кольцо. ---
  let eyePx: [number, number] | null = null;
  for (const s of [1, -1]) {
    const e = P(inH([3.3, s * 3.8, 0.9]));
    // Глаз виден, если его сторона смотрит на камеру и его не закрыло
    // что-то кроме самой головы (плечо, секира, рука).
    const en = mApp(R0, mApp(sk.Rh, [0.35, s * 0.93, 0.1]));
    if (en[1] < -0.05) continue;
    const ix = Math.floor(e[0]);
    const iy = Math.floor(e[1]);
    if (ix < 1 || iy < 1 || ix >= MW - 1 || iy >= MH - 1) continue;
    const oc = RID[iy * MW + ix];
    if (oc !== ID.head && oc !== ID.horn && RZ[iy * MW + ix] > e[2] + 1) continue;
    const put = (x: number, y: number, c: RGBA) => {
      const i = y * MW + x;
      if (x < 0 || y < 0 || x >= MW || y >= MH || RZ[i] < -1e8) return;
      const j = i * 4;
      RC[j] = c[0];
      RC[j + 1] = c[1];
      RC[j + 2] = c[2];
      RC[j + 3] = 255;
    };
    const bx = Math.floor(P(inH([3.4, s * 3.7, 2.2]))[0]);
    put(bx - 1, iy - 1, MN.fur[0]);
    put(bx, iy - 1, MN.fur[0]);
    put(bx + 1, iy - 1, MN.fur[0]);
    if (r.eyes >= 1.5 && r.eyes < 2.5) {
      put(ix - 1, iy, INK);
      put(ix, iy, INK);
      put(ix + 1, iy, INK);
    } else {
      const hot = r.eyes >= 2.5 ? 1 : 0;
      put(ix, iy, MN.eye);
      put(ix + 1, iy, r.eyes >= 0.5 && r.eyes < 1.5 ? MN.fur[0] : MN.eye);
      put(ix - 1, iy, hx('#8a1a10'));
      const c = ex.rage > 0.5 || hot ? hx('#ffb040') : hx('#ff5a30');
      lit.set(ix, iy, c);
      if (hot || ex.rage > 0.5) lit.set(ix + 1, iy, hx('#ff3a20', 220));
      if (!eyePx || en[1] > 0.3) eyePx = [ix, iy];
    }
  }
  // Ноздри и кольцо в носу — на передке морды.
  for (const s of [1, -1]) dotP(inH([11, s * 1.3, -2.9]), MN.nostril, 3);
  dotP(inH([10.6, 0.9, -5.1]), MN.ring, 3.5);
  dotP(inH([10.3, 0, -5.8]), MN.ring, 3.5);
  dotP(inH([10.6, -0.9, -5.1]), MN.ring, 3.5);
  const p = rFinish();
  // След секиры — после контура: полупрозрачный, без чёрной каймы.
  if (ex.trail && ex.trail.length > 1) smear3(p, [sk, ...ex.trail], P, lit, ex.rage);
  // Искры: лезвие скребёт камень — летят назад и гаснут.
  if (ex.sparks > 0.05 && ground) {
    const back = P(vAdd([ground[0], ground[1], ground[2]], mApp(yawM(r.twist), [-6, 0, 0])));
    const g0 = P(ground);
    const bx = back[0] - g0[0];
    const by = back[1] - g0[1];
    const f = Math.floor(ex.t * 48);
    for (let i = 0; i < 7; i++) {
      const k = (i + hash(i, f, 5)) / 7;
      const x = g0[0] + bx * k * 1.6 + (hash(i, f, 9) - 0.5) * 2;
      const y = g0[1] + by * k * 1.6 - Math.sin(k * Math.PI) * (2 + hash(i, f, 2) * 3);
      const c = k < 0.3 ? hx('#fff8d0') : k < 0.65 ? hx('#ffc040') : hx('#ff6a20', 200);
      if (hash(i, f, 13) < 0.25 + 0.6 * ex.sparks) lit.set(x, y, c);
    }
  }

  // --- После контура: пар, грунт, звёзды. ---
  if (r.steam > 0.05) {
    // Пар бьёт из ноздрей вперёд (по взгляду, а не по наклону морды) и
    // поднимается, тая.
    const np = inH([11.6, 0, -3.2]);
    const nose = P(np);
    const dirS = P(vAdd(np, mApp(yawM(r.twist + r.hy), [4, 0, -0.8])));
    const dx = dirS[0] - nose[0];
    const dy = dirS[1] - nose[1];
    const dl = Math.hypot(dx, dy) || 1;
    const ux = dx / dl;
    const uy = dy / dl;
    const n = Math.round(2 + r.steam * 5);
    const ph = (ex.t * 7) % 1;
    for (let i = 0; i < n; i++) {
      const k = (i + ph) / n;
      const d = 1 + k * (3 + r.steam * 7);
      const w = (hash(i, Math.floor(ex.t * 12)) - 0.5) * k * 3;
      const x = nose[0] + ux * d - uy * w;
      const y = nose[1] + uy * d + ux * w - k * k * 4;
      const a = (1 - k) * (0.5 + r.steam * 0.4);
      lit.set(x, y, alpha(MN.steam, a));
      if (k < 0.5 && r.steam > 0.5) lit.set(x, y + 1, alpha(MN.steam, a * 0.6));
    }
  }
  if (ex.dirt > 0.05) {
    const f = r.nh > r.fh ? sk.footN : sk.footN;
    const s = P(f);
    for (let i = 0; i < 4 + ex.dirt * 8; i++) {
      const k = hash(i, 17, Math.floor(ex.t * 24));
      const x = s[0] + ex.dirtDir * (3 + k * 12 * ex.dirt) + (hash(i, 3) - 0.5) * 3;
      const y = s[1] - 1 - hash(i, 9) * (2 + ex.dirt * 5) * (1 - k * 0.5);
      p.set(Math.floor(x), Math.floor(y), MN.dust);
      if (i % 3 === 0) p.set(Math.floor(x) + 1, Math.floor(y), MN.dust);
    }
  }
  if (r.stars > 0.1) {
    const top = P(inH([0, 0, 14]));
    for (let i = 0; i < 3; i++) {
      const a = ex.t * 5.2 + (i / 3) * TAU;
      const x = Math.round(top[0] + Math.cos(a) * 9);
      const y = Math.round(top[1] - 2 + Math.sin(a) * 3);
      const big = Math.sin(a) > 0;
      lit.set(x, y, WHITE);
      lit.set(x - 1, y, hx('#fff27a'));
      lit.set(x + 1, y, hx('#fff27a'));
      lit.set(x, y - 1, hx('#fff27a'));
      lit.set(x, y + 1, hx('#fff27a'));
      if (big) {
        lit.set(x - 2, y, hx('#ffd040', 150));
        lit.set(x + 2, y, hx('#ffd040', 150));
      }
    }
  }
  if (ex.melt > 0) meltPx(p, lit, ex.melt, ex.t);
  return { p, lit: lit.any ? lit.p : null, eye: eyePx, ox, oy };
}

/** Секира: рукоять с оковкой, два полумесяца, втулка с шипом. */
function paintAxe3(
  sk: Skel,
  P: (q: V3) => [number, number, number, number],
  R0: M3,
  lit: Lit,
  glow: number,
  rage: number,
): V3 | null {
  const u = sk.axU;
  const n = sk.axN;
  const p0 = sk.ax0;
  const end = vAdd(p0, vMul(u, 35));
  // Где лезвие касается пола (для искр): самая низкая точка кромки.
  let ground: V3 | null = null;
  {
    const bc0 = vAdd(p0, vMul(u, 32.5));
    let lo = 1e9;
    for (const side of [1, -1])
      for (let i = 0; i <= 10; i++) {
        const k = i / 10;
        const q = vAdd(
          vAdd(bc0, vMul(u, -6 + k * 12)),
          vMul(n, side * (1.6 + Math.sin(k * Math.PI) * 7.5)),
        );
        if (q[2] < lo) {
          lo = q[2];
          ground = q;
        }
      }
    if (lo > 1.5) ground = null;
    else if (ground) ground = [ground[0], ground[1], 0];
  }
  // Рукоять (с земли не торчит: ниже нуля обрезается в лезвии, рукоять — нет).
  {
    // В полу рукоять обрезается у земли.
    let e2 = end;
    if (end[2] < 0 && p0[2] > 0) e2 = vLerp(p0, end, p0[2] / (p0[2] - end[2]));
    const a = P(p0);
    const b = P(e2);
    rCap(a[0], a[1], a[2], 1.2, b[0], b[1], b[2], 1.2, MN.haft, 0, ID.axe);
    for (const k of [1, 11, 16]) {
      const q = vAdd(p0, vMul(u, k));
      if (q[2] < 0.5) continue;
      const c1 = P(vAdd(q, vMul(n, 1.3)));
      const c2 = P(vAdd(q, vMul(n, -1.3)));
      rDot(c1[0], c1[1], c1[2] + 1, MN.iron[1], 2);
      rDot((c1[0] + c2[0]) / 2, (c1[1] + c2[1]) / 2, (c1[2] + c2[2]) / 2 + 1, MN.iron[2], 2);
      rDot(c2[0], c2[1], c2[2] + 1, MN.iron[1], 2);
    }
  }
  const bc = vAdd(p0, vMul(u, 32.5));
  // Грань к свету: нормаль плоскости лезвия.
  const m = mApp(R0, vCross(u, n));
  const faceL = Math.abs(m[0] * LX - m[2] * LY + m[1] * LZ);
  for (const side of [1, -1]) {
    const pts: [number, number, number, number][] = [];
    for (let i = 0; i <= 10; i++) {
      const k = i / 10;
      const along = -6 + k * 12;
      const out = 1.6 + Math.sin(k * Math.PI) * 7.5;
      pts.push(P(vAdd(vAdd(bc, vMul(u, along)), vMul(n, side * out))));
    }
    pts.push(P(vAdd(vAdd(bc, vMul(u, 2.5)), vMul(n, side * 1.5))));
    pts.push(P(vAdd(vAdd(bc, vMul(u, -2.5)), vMul(n, side * 1.5))));
    // Для цвета — координаты точки в плоскости лезвия: вдоль рукояти и
    // поперёк (к кромке). Кромка — полоса у края полумесяца, как у прежней секиры.
    const c0 = P(bc);
    const pu = P(vAdd(bc, u));
    const pn = P(vAdd(bc, vMul(n, side)));
    const ux = pu[0] - c0[0];
    const uy = pu[1] - c0[1];
    const nx2 = pn[0] - c0[0];
    const ny2 = pn[1] - c0[1];
    const det = ux * ny2 - uy * nx2;
    const hot = glow > 0.05;
    const edgeC = hot ? mixc(MN.edge, rage > 0.5 ? hx('#ff9060') : hx('#fff6d0'), glow) : MN.edge;
    const ok = rPoly(
      pts,
      (x, y) => {
        const qx = x + 0.5 - c0[0];
        const qy = y + 0.5 - c0[1];
        let al = 0;
        let ac = 4;
        if (Math.abs(det) > 0.08) {
          al = (qx * ny2 - qy * nx2) / det;
          ac = (ux * qy - uy * qx) / det;
        }
        const out = 1.6 + Math.sin(((clamp(al, -6, 6) + 6) / 12) * Math.PI) * 7.5;
        const thin = Math.min(1, Math.abs(det) / 0.6);
        if (ac > out - 1.3 / Math.max(0.35, thin)) return edgeC;
        const l = (qx * LX + qy * LY) * 0.08;
        return tone(MN.steel, 0.2 + faceL * 0.35 + l + (ac / 9) * 0.5);
      },
      ID.blade,
    );
    if (!ok) {
      // Лезвие ребром к камере: тонкая светлая полоса.
      for (let i = 0; i < pts.length - 2; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        if (a[3] < -0.4 && b[3] < -0.4) continue;
        rCap(a[0], a[1], a[2], 0.6, b[0], b[1], b[2], 0.6, MN.steel, 0.3, ID.blade);
      }
    }
    // Накал кромки — поверх темноты.
    if (glow > 0.05) {
      for (let i = 1; i < 10; i++) {
        const q = pts[i];
        if (q[3] < -0.4) continue;
        lit.set(
          q[0],
          q[1],
          rage > 0.5
            ? hx('#ff7a40', Math.round(glow * 230))
            : hx('#fff4d0', Math.round(glow * 220)),
        );
      }
    }
    // Зазубрина и старая кровь у кромки.
    const cx = P(vAdd(vAdd(bc, vMul(n, side * 7.6)), vMul(u, side * 1.5)));
    const ci = Math.floor(cx[1]) * MW + Math.floor(cx[0]);
    if (ci >= 0 && ci < MW * MH && RID[ci] === ID.blade && Math.abs(RZ[ci] - cx[2]) < 2) {
      RC[ci * 4 + 3] = 0;
      RID[ci] = 0;
      RZ[ci] = -1e9;
      const cb = P(vAdd(vAdd(bc, vMul(n, side * 6.1)), vMul(u, side * 1.5)));
      rDot(cb[0], cb[1], cb[2], MN.blood, 2);
    }
  }
  // Втулка с шипом.
  const bs = P(bc);
  if (bs[3] > -1) rBall(bs[0], bs[1], bs[2], 2.2, 2.2, 2.2, MN.iron, 0.1, ID.axe);
  const s0 = P(end);
  const s1 = P(vAdd(end, vMul(u, 3)));
  if (s1[3] > -0.5) rCap(s0[0], s0[1], s0[2], 1, s1[0], s1[1], s1[2], 0.3, MN.iron, 0, ID.axe);
  return ground;
}

/** Залить четырёхугольник на экране: fn(x, y) для каждого пикселя внутри. */
function fillQuad(q: [number, number, number, number][], fn: (x: number, y: number) => void): void {
  const xs = q.map((v) => v[0]);
  const ys = q.map((v) => v[1]);
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const y1 = Math.min(MH - 1, Math.ceil(Math.max(...ys)));
  const x0 = Math.max(0, Math.floor(Math.min(...xs)));
  const x1 = Math.min(MW - 1, Math.ceil(Math.max(...xs)));
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      let inside = false;
      for (let a = 0, b = q.length - 1; a < q.length; b = a++) {
        const [xa, ya] = q[a];
        const [xb, yb] = q[b];
        if (ya > py !== yb > py && px < ((xb - xa) * (py - ya)) / (yb - ya) + xa) inside = !inside;
      }
      if (inside) fn(x, y);
    }
}

/**
 * След секиры (smear): полоса там, где прошла головка секиры за последние
 * доли секунды, — светлая кромка снаружи, полупрозрачная к рукояти, свежая
 * часть ярче хвоста. Есть только там, где лезвие шло быстро; тело, что ближе
 * следа, его закрывает. У вихря каждое прошлое положение — со своим оборотом.
 */
function smear3(
  p: Px,
  all: Skel[],
  P: (q: V3) => [number, number, number, number],
  lit: Lit,
  rage: number,
): void {
  const now = all[0].spin;
  // Полоса следа — поперёк движения головки: у рубки это вдоль рукояти
  // (головка идёт по дуге), у вихря с вертикальным лезвием — по высоте лезвия.
  const heads = all.map((s) => mApp(yawM(s.spin - now), vAdd(s.ax0, vMul(s.axU, 32.5))));
  // Ось полосы — одна на весь след, по свежему ходу головки.
  const mv0 = vNorm(vSub(heads[0], heads[Math.min(1, heads.length - 1)]));
  const u0 = mApp(yawM(0), all[0].axU);
  const useN = Math.abs(vDot(u0, mv0)) > Math.abs(vDot(all[0].axN, mv0));
  const seg = all.map((s, i): [V3, V3] => {
    const Ry = yawM(s.spin - now);
    const bc = heads[i];
    if (!useN) {
      const u = mApp(Ry, s.axU);
      return [vAdd(bc, vMul(u, -8)), vAdd(bc, vMul(u, 6))];
    }
    const nn = mApp(Ry, s.axN);
    return [vAdd(bc, vMul(nn, -8.5)), vAdd(bc, vMul(nn, 8.5))];
  });
  // Концы полос соседних выборок — в одну сторону, иначе четырёхугольник
  // перекручивается «бантиком».
  for (let i = 1; i < seg.length; i++) {
    const [p0, p1] = seg[i - 1];
    const [q0, q1] = seg[i];
    if (vDot(vSub(p1, p0), vSub(q1, q0)) < 0) seg[i] = [q1, q0];
  }
  const core = rage > 0.5 ? hx('#ffe2b8') : hx('#f6fbff');
  const mid = rage > 0.5 ? hx('#f07040') : hx('#bccbd8');
  const tail = rage > 0.5 ? hx('#9a2a16') : hx('#6e7e8c');
  const n = seg.length - 1;
  for (let i = n - 1; i >= 0; i--) {
    const [a0, a1] = seg[i];
    const [b0, b1] = seg[i + 1];
    const sp = vLen(vSub(vLerp(a0, a1, 0.5), vLerp(b0, b1, 0.5)));
    if (sp < 3.2) continue;
    // Свежесть: 0 — у лезвия, 1 — хвост.
    const k = i / Math.max(1, n - 1);
    const tone0 = k < 0.34 ? core : k < 0.67 ? mid : tail;
    const edgeC = k < 0.67 ? core : mid;
    const al = 0.9 - k * 0.62;
    const q = [a0, a1, b1, b0].map(P);
    if (q.every((v) => v[3] < -0.5)) continue;
    const zz = (q[0][2] + q[1][2] + q[2][2] + q[3][2]) / 4;
    // Поперёк полосы: у рукояти прозрачно, середина — цвет, кромка — свет.
    const ix = (q[0][0] + q[3][0]) / 2;
    const iy = (q[0][1] + q[3][1]) / 2;
    const ox = (q[1][0] + q[2][0]) / 2 - ix;
    const oy = (q[1][1] + q[2][1]) / 2 - iy;
    const ol = ox * ox + oy * oy || 1;
    fillQuad(q, (x, y) => {
      const i2 = y * MW + x;
      const id = RID[i2];
      if (id === ID.blade || id === ID.axe) return;
      // Тело ближе следа — след за ним.
      if (id && RZ[i2] > zz + 1.5) return;
      const u = ((x + 0.5 - ix) * ox + (y + 0.5 - iy) * oy) / ol;
      const c = u > 0.8 ? edgeC : u > 0.5 ? tone0 : mid;
      const a = u > 0.8 ? Math.min(1, al * 1.08) : u > 0.5 ? al * 0.8 : al * 0.38;
      p.set(x, y, alpha(c, id ? a * 0.6 : a));
      if (u > 0.8 && k < 0.5) lit.set(x, y, alpha(core, 0.55 * (1 - k)));
    });
  }
}

/** Растворение: пиксели уходят снизу вверх по шуму, пепел летит вверх. */
function meltPx(p: Px, lit: Lit, k: number, t: number): void {
  let top = MH;
  let bot = 0;
  for (let y = 0; y < MH; y++)
    for (let x = 0; x < MW; x++)
      if (p.data[(y * MW + x) * 4 + 3]) {
        top = Math.min(top, y);
        bot = Math.max(bot, y);
      }
  const span = Math.max(1, bot - top);
  for (let y = 0; y < MH; y++)
    for (let x = 0; x < MW; x++) {
      const i = (y * MW + x) * 4;
      if (!p.data[i + 3]) continue;
      const h = (bot - y) / span;
      const th = k * 1.35 - h * 0.35;
      if (hash(x >> 1, y >> 1, 91) < th) {
        p.data[i + 3] = 0;
        // Пепел: часть исчезнувших пикселей тлеет поверх темноты.
        if (hash(x, y, 7) < 0.06 * (1 - k)) {
          const up = (t * 20 + hash(x, y, 3) * 6) % 10;
          lit.set(x, y - up, hx('#ff8a40', Math.round(200 * (1 - k))));
        }
      } else if (hash(x >> 1, y >> 1, 91) < th + 0.08) {
        p.data[i] = Math.round(p.data[i] * 0.5 + 60);
        p.data[i + 1] = Math.round(p.data[i + 1] * 0.5 + 30);
        p.data[i + 2] = Math.round(p.data[i + 2] * 0.5 + 20);
      }
    }
}

// ---- Техники: поза во времени. Числа мозга (`MINO` в f5-brains.ts) —
// здесь копией: мозг — метроном, рисунок подстраивается под него. ----------

const MT = {
  aim: 0.95,
  aimNext: 0.62,
  axe: 0.85,
  axeTail: 0.75,
  whirl: 0.9,
  roar: 1.05,
  dizzy: 2.3,
  pillar: 3.0,
  skid: 0.5,
  recover: 0.65,
  entry: 1.5,
  // Эхо на 15-м (`MINO_E` в f15-boss-brains.ts): свой оглушённый срок.
  echoDizzy: 1.9,
};

const FPS = 24;

type Tech =
  | 'idle'
  | 'walk'
  | 'roar'
  | 'bellow'
  | 'aim'
  | 'gore'
  | 'skid'
  | 'dizzy'
  | 'axe'
  | 'whirl'
  | 'recover'
  | 'death';

/** Откуда пришли в технику (вариант начала). */
const FROM = { none: 0, bellow: 1, skid: 2, axe: 3, whirl: 4 } as const;

interface Pose3 {
  r: Rig;
  dirt: number;
  dirtDir: number;
  melt: number;
  sparks: number;
}

const pose3 = (r: Rig, dirt = 0, dirtDir = -1, melt = 0, sparks = 0): Pose3 => ({
  r,
  dirt,
  dirtDir,
  melt,
  sparks,
});

// --- Опорные позы (частичные: остальное — из ГОТОВ) ---

/** Голова вниз, рога на цель, секира волочится сзади. */
const HEADDOWN: Partial<Rig> = {
  lean: 0.58,
  ph: 18.2,
  pa: -1.6,
  hp: 0.95,
  nk: 2.6,
  nu: -3.2,
  twist: 0.12,
  ar: 18,
  aaz: 2.3,
  ael: -1.1,
  xaz: Math.PI - 0.15,
  xel: -0.3,
  xroll: 1.1,
  br: 16,
  baz: 1.35,
  bel: -0.8,
  steam: 0.5,
  eyes: 1,
  tup: 0.4,
  cloth: -0.2,
};
/** Сжатая пружина перед рывком. */
const COIL: Partial<Rig> = {
  ...HEADDOWN,
  ph: 15.8,
  pa: -4,
  lean: 0.8,
  hp: 1.15,
  nk: 3.2,
  nu: -4.2,
  na: 5,
  nh: 0,
  fa: -8.5,
  fh: 0,
  steam: 1,
  eyes: 3,
  jaw: 0.25,
  tsx: 1.06,
  tsy: 0.93,
  tdx: -2.2,
};
/** Секира в полу после рубки: корпус внизу, руки у земли. */
const CHOPPED: Partial<Rig> = {
  pa: 2,
  ph: 15.6,
  lean: 0.5,
  twist: -0.25,
  hp: 0.35,
  nk: 2,
  nu: -0.5,
  jaw: 0.3,
  two: 1,
  ar: 18,
  aaz: -0.5,
  ael: -0.72,
  xaz: -0.05,
  xel: -0.62,
  xs: 9,
  xroll: 0,
  na: -7,
  nb: 5,
  fa: 9,
  fb: -5,
  tsx: 1,
  tsy: 1,
  tdx: 2.5,
  eyes: 0,
  glow: 0,
};
/** Рёв во всю грудь: голова запрокинута, руки в стороны. */
const ROARING: Partial<Rig> = {
  ph: 22.2,
  lean: -0.12,
  breath: 1,
  hp: -0.85,
  nu: 2,
  nk: -2,
  jaw: 1,
  // Руки в стороны и вниз — «грудь колесом»; секира висит из кулака
  // лезвием к полу, силуэт головы и рогов чистый.
  ar: 18,
  aaz: 1.05,
  ael: -0.55,
  br: 18.5,
  baz: 1.0,
  bel: -0.35,
  xaz: 0.25,
  xel: -1.2,
  steam: 1,
  tup: 1,
  eyes: 3,
};
/** Выдох рёва-оглушения: голова вперёд, пасть настежь. */
const BLAST: Partial<Rig> = {
  ph: 19.5,
  lean: 0.45,
  breath: 0.6,
  hp: 0.18,
  nk: 3.2,
  nu: -0.5,
  jaw: 1,
  ar: 19,
  aaz: 0.7,
  ael: -0.8,
  br: 19,
  baz: 0.7,
  bel: -0.75,
  xaz: 0.4,
  xel: -1.1,
  steam: 1,
  eyes: 3,
  tup: 0.8,
  tdx: 1.8,
};
/** Конец заноса: упёрся, выпрямляется. */
const SKID_END: Partial<Rig> = {
  lean: 0.32,
  ph: 19.2,
  na: 6,
  fa: -1,
  hp: 0.35,
  hy: 0.18,
  trot: 0,
  eyes: 1,
};

const easeRig = (a: Rig, b: Rig, k: number): Rig => {
  const o = { ...a };
  for (const ch of RIG_KEYS) o[ch] = a[ch] + (b[ch] - a[ch]) * k;
  return o;
};
const R = (p: Partial<Rig>): Rig => ({ ...READY, ...p });

/** Покой: два вдоха на круг, моргание, хвост, пар на выдохе. `ph` — 0…1. */
function techIdle(ph: number): Pose3 {
  const a = ph * TAU;
  const b = a * 2;
  const br = 0.5 - 0.5 * Math.cos(b);
  const r = { ...READY };
  r.breath = br;
  r.ph = 20 - br * 0.35;
  r.lean = 0.22 - br * 0.035;
  r.nu = br * 0.8 - 0.3;
  r.hp = 0.06 * Math.sin(b - 1.1) + 0.04 * Math.sin(a + 0.4);
  r.hy = 0.1 * Math.sin(a - 0.3);
  r.ael = READY.ael + 0.05 * Math.sin(b - 0.6);
  r.bel = READY.bel + 0.05 * Math.sin(b - 0.9);
  r.xel = READY.xel + 0.025 * Math.sin(b - 1.2);
  r.tsw = 0.6 * Math.sin(a + 0.6);
  r.tup = 0.15 + 0.12 * Math.sin(b + 0.5);
  r.cloth = 0.12 * Math.sin(a - 0.5);
  r.roll = 0.02 * Math.sin(a);
  r.steam = Math.max(0, -Math.sin(b)) * 0.7;
  r.eyes = ph > 0.86 && ph < 0.92 ? 2 : 0;
  return pose3(r);
}

/** Шаг: тяжёлая походка, копыта не скользят (фаза — от пройденного пути). */
function techWalk(ph: number): Pose3 {
  const a = ph * TAU;
  const r = { ...READY };
  r.lean = 0.3;
  r.na = 1 + 8 * Math.cos(a);
  r.nh = Math.max(0, -Math.sin(a)) * 4.8;
  r.fa = 1 - 8 * Math.cos(a);
  r.fh = Math.max(0, Math.sin(a)) * 4.8;
  r.nb = 5;
  r.fb = -5;
  r.ph = 19.3 + 1.1 * Math.abs(Math.sin(a));
  r.pb = 0.8 * Math.sin(a);
  r.roll = 0.045 * Math.sin(a);
  r.twist = 0.1 * Math.cos(a);
  r.nu = -0.7 * Math.abs(Math.sin(a - 0.45));
  r.hp = 0.05 + 0.06 * Math.sin(2 * a - 0.9);
  r.baz = 2.2 - 0.75 * Math.cos(a);
  r.bel = -1.1;
  r.ael = READY.ael + 0.06 * Math.sin(2 * a - 1);
  r.xel = READY.xel + 0.07 * Math.sin(2 * a - 1.5);
  r.tsw = 0.55 * Math.sin(a - 1.3);
  r.tup = 0.22;
  r.cloth = -0.3 + 0.22 * Math.sin(2 * a - 0.6);
  return pose3(r);
}

/** Рёв (вход в бой и когда герой упал): 1,5 с. */
function techRoar(t: number): Pose3 {
  const keys: Key[] = [
    [0, {}],
    [
      0.3,
      {
        ph: 18,
        lean: 0.46,
        hp: 0.5,
        nk: -1,
        nu: -1.5,
        breath: 0.35,
        ar: 15,
        aaz: -0.45,
        ael: -0.9,
        br: 14,
        baz: 2.1,
        bel: -0.7,
        eyes: 1,
        tup: 0.1,
      },
      eIO,
    ],
    [0.42, ROARING, eOut3],
    [0.5, { ph: 21.8, hp: -0.78 }, eOut],
    [1.12, { ph: 21.6, hp: -0.8, breath: 0.95 }, eLin],
    [
      1.3,
      {
        ph: 20.4,
        lean: 0.26,
        breath: 0.3,
        hp: 0.1,
        nu: 0,
        nk: 0,
        jaw: 0.15,
        ar: 18.5,
        aaz: -0.25,
        ael: -1.2,
        br: 17,
        baz: 2.5,
        bel: -1.2,
        xel: READY.xel,
        steam: 0.3,
        tup: 0.2,
        eyes: 0,
      },
      eIO,
    ],
    [1.5, READY, eIO],
  ];
  const r = track(keys, t, READY, LAG);
  // Рёв дрожит: голова и челюсть, 4 кадра на 12 к/с.
  if (t > 0.5 && t < 1.15) {
    const q = Math.floor(t * 12) % 4;
    r.hr += [0.05, 0, -0.05, 0][q];
    r.hy += [0, 0.04, 0, -0.04][q];
    r.jaw -= [0, 0.08, 0, 0.08][q];
  }
  return pose3(r);
}

/** Рёв-оглушение: вдох, грудь раздута, голова назад — и выдох ровно в T. */
function techBellow(t: number, h: number): Pose3 {
  const T = MT.roar / h;
  const keys: Key[] = [
    [0, {}],
    [0.2 * T, { ph: 19, hp: 0.35, lean: 0.36, breath: 0.2, eyes: 1 }, eIO],
    [
      0.62 * T,
      {
        ph: 22,
        lean: -0.08,
        breath: 1,
        hp: -0.72,
        nu: 1.5,
        nk: -1.5,
        jaw: 0.35,
        ar: 18,
        aaz: 1.15,
        ael: -0.45,
        br: 18,
        baz: 1.1,
        bel: -0.2,
        xaz: 0.25,
        xel: -1.2,
        eyes: 1,
        tup: 0.8,
        steam: 0.3,
      },
      eIO,
    ],
    [
      T - 3 / FPS,
      {
        ph: 22.6,
        hp: -0.95,
        breath: 1.15,
        jaw: 0.5,
        ael: -0.35,
        bel: -0.35,
        lean: -0.14,
        tsx: 0.97,
        tsy: 1.04,
      },
      eIn,
    ],
    [T, { ...BLAST, tsx: 1.06, tsy: 0.94 }, eOut3],
  ];
  const r = track(keys, t, READY, LAG);
  // Последние кадры до выдоха: дрожь натяжения (голова), не всего тела.
  if (t > T - 0.3 && t < T) {
    const q = Math.floor(t * FPS) % 2;
    r.hr += q ? 0.035 : -0.035;
  }
  return pose3(r);
}

/** Прицел рывка: голова вниз, копыто роет землю, пружина сжимается. */
function techAim(t: number, h: number, next: boolean, from: number): Pose3 {
  const T = (next ? MT.aimNext : MT.aim) / h;
  const start: Partial<Rig> =
    from === FROM.bellow
      ? { ...BLAST, tsx: 1.06, tsy: 0.94 }
      : from === FROM.skid
        ? SKID_FINAL
        : {};
  const keys: Key[] = [[0, start]];
  keys.push([0.2 * T, HEADDOWN, eIO]);
  let dirt = 0;
  const scrape = (t0: number, t1: number, t2: number) => {
    keys.push([t0, { na: 3 }, eIO]);
    keys.push([t1, { na: 12, nh: 5.5 }, eOut]);
    keys.push([t2, { na: -4, nh: 0 }, eIn]);
    const u = (t - t1) / (t2 - t1);
    if (u > 0.35 && u < 1.6) dirt = Math.max(dirt, 1 - Math.abs(u - 0.9) / 0.8);
  };
  if (next) scrape(0.24 * T, 0.36 * T, 0.5 * T);
  else {
    scrape(0.22 * T, 0.3 * T, 0.4 * T);
    scrape(0.42 * T, 0.5 * T, 0.6 * T);
  }
  const { tdx: _a, tsx: _b, tsy: _c, ...coilBody } = COIL;
  void _a;
  void _b;
  void _c;
  keys.push([
    0.74 * T,
    { ...coilBody, ph: 16.8, pa: -3, lean: 0.72, tsx: 1.03, tsy: 0.965, tdx: -1.2 },
    eIO,
  ]);
  keys.push([T, COIL, eIn]);
  const r = track(keys, t, READY, LAG);
  // Окно уклона: голова и рога вздрагивают, пар рвётся из ноздрей.
  if (t > T - 0.28) {
    const q = Math.floor(t * FPS) % 2;
    r.hr += q ? 0.04 : -0.04;
    r.steam = 1;
  }
  return pose3(r, dirt, -1);
}

/** Рывок: разгон из пружины и бег на таран, 8 кадров на шаг. */
function gallop(t: number): Rig {
  const a = t * 3 * TAU + 0.5;
  const r = { ...READY };
  r.lean = 0.8;
  r.pa = 1;
  r.ph = 16.8 + 2.2 * Math.max(0, Math.sin(2 * a));
  r.hp = 1.18;
  r.nk = 4;
  r.nu = -4.6 + 0.6 * Math.sin(2 * a - 1);
  r.na = 2 + 13 * Math.cos(a);
  r.nh = 8 * Math.max(0, -Math.sin(a));
  r.fa = 2 - 13 * Math.cos(a);
  r.fh = 8 * Math.max(0, Math.sin(a));
  r.nb = 4.5;
  r.fb = -4.5;
  r.twist = 0.14 * Math.cos(a);
  r.roll = 0.04 * Math.sin(a);
  // Секира волочится за спиной, нижний рог лезвия скребёт пол.
  r.ar = 18;
  r.aaz = 2.3;
  r.ael = -1.1 + 0.06 * Math.sin(2 * a);
  r.xaz = Math.PI - 0.15;
  r.xel = -0.3 + 0.05 * Math.sin(2 * a);
  r.xroll = 1.1;
  r.br = 17;
  r.baz = 1.5 + 0.9 * Math.cos(a);
  r.bel = -0.65;
  r.tsw = 0.3 * Math.sin(a - 1);
  r.tup = 0.95;
  r.cloth = -1;
  r.eyes = 3;
  r.steam = 0.5 + 0.5 * Math.max(0, Math.sin(2 * a + 1));
  r.jaw = 0.25;
  r.tdy = 1.2 * Math.max(0, Math.sin(2 * a));
  const land = Math.max(0, -Math.sin(2 * a));
  r.tsx = 1 + 0.035 * land;
  r.tsy = 1 - 0.035 * land;
  return r;
}
function techGore(t: number): Pose3 {
  const g = gallop(t);
  if (t >= 0.125) return pose3(g, 0.6, -1, 0, 1);
  // Первые три кадра — выстрел из пружины: растяжка вперёд.
  const k = eOut(t / 0.125);
  const r = easeRig(R(COIL), g, k);
  r.tsx = t < 0.05 ? 0.94 : 1 + (r.tsx - 1) * k;
  r.tsy = t < 0.05 ? 1.06 : r.tsy;
  r.tdx = COIL.tdx! * (1 - k);
  return pose3(r, 1, -1, 0, 0.6);
}

/** Конец заноса: упёрся, голова ищет героя, секира всё ещё волочится. */
const SKID_FINAL: Partial<Rig> = {
  ...SKID_END,
  ...HEADDOWN,
  ph: 18.6,
  lean: 0.5,
  hp: 0.5,
  hy: 0.15,
  eyes: 0,
  cloth: 0,
  tup: 0.3,
  steam: 0.4,
};
/** Средняя поза бега — с неё начинается занос (фаза шага не важна). */
const GALLOP_MID: Partial<Rig> = {
  lean: 0.8,
  pa: 1,
  ph: 17.6,
  hp: 1.18,
  nk: 4,
  nu: -4.6,
  na: 2,
  nh: 2,
  fa: 2,
  fh: 2,
  nb: 4.5,
  fb: -4.5,
  ar: 18,
  aaz: 2.3,
  ael: -1.1,
  xaz: Math.PI - 0.15,
  xel: -0.3,
  xroll: 1.1,
  br: 17,
  baz: 1.5,
  bel: -0.65,
  tup: 0.95,
  cloth: -1,
  eyes: 3,
  jaw: 0.25,
};
/** Занос: копыта вперёд, корпус назад, грунт веером, секира волочится. */
function techSkid(t: number, h: number): Pose3 {
  const D = MT.skid / h;
  const keys: Key[] = [
    [0, GALLOP_MID],
    [
      0.07,
      {
        lean: 0.36,
        ph: 16.2,
        pa: -1,
        na: 12,
        nh: 0,
        fa: 6,
        fh: 0,
        hp: 0.8,
        nk: 2,
        br: 18,
        baz: 0.5,
        bel: -0.25,
        trot: -0.15,
        cloth: 0.9,
        tup: 0.5,
        eyes: 1,
        jaw: 0.35,
      },
      eOut,
    ],
    [
      0.55 * D,
      {
        trot: -0.04,
        lean: 0.44,
        ph: 18.2,
        na: 7.5,
        fa: 1,
        hp: 0.6,
        nk: 2.2,
        cloth: 0.25,
        baz: 1.4,
        bel: -0.8,
        jaw: 0.1,
      },
      eIO,
    ],
    [D, SKID_FINAL, eIO],
  ];
  const r = track(keys, t, READY, LAG);
  const dirt = clamp(1 - t / (0.7 * D), 0, 1);
  return pose3(r, dirt, 1, 0, clamp(1 - t / (0.6 * D), 0, 1));
}

/** Оглушение: удар о стену, отскок, секира из рук, шатается, трясёт головой, поднимает секиру. */
function dizzyT(h: number, v: number): number {
  if (v === 2) return MT.echoDizzy;
  if (v === 1) return MT.pillar;
  return h >= 1.29 ? MT.dizzy * 0.8 : MT.dizzy;
}
const DIZ_LOOP = 13;
function dizzyWobble(t: number): Partial<Rig> {
  const w = ((t - 0.4) / 1.1) * TAU;
  return {
    roll: 0.11 * Math.sin(w),
    hy: 0.28 * Math.sin(w - 0.7),
    hr: 0.16 * Math.sin(w + 1),
    hp: 0.72 + 0.14 * Math.sin(2 * w),
    ph: 16 + 0.5 * Math.sin(2 * w + 0.5),
    pb: 0.8 * Math.sin(w),
    tsw: 0.5 * Math.sin(w - 1.4),
    jaw: 0.45 + 0.1 * Math.sin(2 * w),
  };
}
/**
 * Сидит оглушённый: таз отъехал назад (сам бык, а не кадр — секира на полу
 * должна лежать на месте), руки висят, секира лежит впереди плашмя.
 */
const DIZZY_BASE: Partial<Rig> = {
  pa: -5,
  ph: 16,
  lean: 0.12,
  hp: 0.72,
  nk: 1,
  nu: -2.5,
  jaw: 0.45,
  ar: 18.5,
  aaz: 0.2,
  ael: -1.42,
  br: 18,
  baz: 0.6,
  bel: -1.4,
  xfree: 1,
  xga: 6,
  xgb: 5,
  xgh: 0.9,
  xfaz: -0.5,
  xfel: 0.03,
  xroll: 0.9,
  na: 0,
  nb: 6.5,
  fa: -9,
  fb: -6.5,
  eyes: 2,
  stars: 1,
  tdx: 0,
  tup: 0,
};
function techDizzy(t: number, h: number, v: number): Pose3 {
  const Td = dizzyT(h, v);
  const exit0 = Td - 0.5;
  if (t < 0.4) {
    const keys: Key[] = [
      // Кадр удара (держится стоп-кадром мозга): сжат о стену.
      [
        0,
        {
          ...GALLOP_MID,
          pa: 3,
          lean: 0.95,
          hp: 1.35,
          nk: 5,
          nu: -5,
          eyes: 2,
          jaw: 0.35,
          tsx: 0.86,
          tsy: 1.06,
          tdx: 0,
          xel: 0.3,
          xaz: 2.2,
        },
      ],
      [
        0.1,
        {
          pa: -6,
          tsx: 1.05,
          tsy: 0.95,
          lean: -0.22,
          hp: -0.6,
          ph: 19.5,
          nk: -1,
          nu: 1,
          ar: 17,
          aaz: 0.9,
          ael: 0.45,
          br: 17,
          baz: 0.9,
          bel: 0.5,
          na: 2,
          nh: 2.5,
          fa: -7,
          fh: 0,
          xfree: 1,
          xga: 2,
          xgb: 8,
          xgh: 34,
          xfaz: 0.9,
          xfel: 1.1,
          eyes: 2,
          jaw: 0.6,
          stars: 0.3,
        },
        eOut,
      ],
      [0.16, { xga: 5, xgb: 6, xgh: 20, xfaz: 0.1, xfel: 0.4, xroll: 3.2 }, eLin],
      [0.26, { xga: 6, xgb: 5, xgh: 0.9, xfaz: -0.5, xfel: 0.03, xroll: 0.9 }, eIn],
      [0.32, { xgh: 3, xfel: 0.18 }, eOut],
      [0.38, { xgh: 0.9, xfel: 0.03 }, eIn],
      [0.4, { ...DIZZY_BASE, ...dizzyWobble(0.4) }, eIO],
    ];
    const r = track(keys, t, READY, LAG);
    // В кадре удара секира ещё в руке.
    if (t < 0.02) r.xfree = 0;
    return pose3(r);
  }
  if (t < exit0) return pose3(R({ ...DIZZY_BASE, ...dizzyWobble(t) }));
  // Выход: трясёт головой, наклоняется за секирой и поднимается с ней.
  const from = R({ ...DIZZY_BASE, ...dizzyWobble(exit0) });
  const u = t - exit0;
  const keys: Key[] = [
    [0, from],
    [0.06, { hy: 0.5, hr: 0.2, eyes: 2, stars: 0.6 }, eOut],
    [0.12, { hy: -0.5, hr: -0.2, stars: 0.3 }, eIO],
    [0.18, { hy: 0.35, hr: 0.1, stars: 0, eyes: 1, jaw: 0.2, steam: 1 }, eIO],
    [
      0.32,
      {
        hy: 0,
        hr: 0,
        roll: 0,
        pb: 0,
        pa: -2,
        ph: 14,
        lean: 1.05,
        hp: 0.35,
        ar: 21,
        aaz: -0.15,
        ael: -1.2,
        na: 3,
        fa: -6,
        eyes: 0,
      },
      eIO,
    ],
    [0.33, { xfree: 0, xaz: -0.5, xel: 0.02, xs: 4, xroll: 0 }, eStep],
    [0.5, { ...READY, xs: READY.xs }, eIO],
  ];
  const r = track(keys, u, from, LAG);
  return pose3(r);
}

/** Секира: замах за спину с разворотом, рубка по дуге, секира в полу. */
function techAxe(t: number, h: number): Pose3 {
  const T = MT.axe / h;
  const end = T + MT.axeTail / h;
  const keys: Key[] = [
    [0, {}],
    // Подхватывает секиру второй рукой и чуть приседает — предвестие.
    [
      0.16 * T,
      {
        ph: 18.8,
        lean: 0.34,
        two: 1,
        ar: 16.5,
        aaz: -0.2,
        ael: -0.55,
        xaz: 2.4,
        xel: 0.9,
        hp: 0.15,
        eyes: 1,
      },
      eIO,
    ],
    // Замах: секира высоко за спиной, грудь развёрнута назад, вес на заднюю ногу.
    [
      0.72 * T,
      {
        ph: 21.5,
        lean: -0.08,
        twist: 0.72,
        pa: -2,
        ar: 17,
        aaz: 0.55,
        ael: 1.05,
        xaz: 2.75,
        xel: 0.72,
        xroll: 0.15,
        hp: -0.25,
        nu: 1,
        jaw: 0.3,
        na: 6.5,
        fa: -6.5,
        eyes: 3,
        tup: 0.6,
        glow: 0.6,
        breath: 0.7,
      },
      eIO,
    ],
    // Дотягивает назад — натяжение, кромка вспыхивает (видно, когда рубанёт).
    [
      T - 4 / FPS,
      { twist: 0.82, xel: 0.62, xaz: 2.85, ael: 1.12, ph: 21.8, glow: 1, lean: -0.12 },
      eOut,
    ],
    // Рубка: три кадра по дуге через верх вперёд и вниз.
    [
      T - 2.5 / FPS,
      { twist: 0.45, aaz: 0.3, ael: 1.0, xaz: 0.9, xel: 1.35, lean: 0.12, ph: 21 },
      eIn,
    ],
    [
      T - 1.2 / FPS,
      { twist: -0.05, aaz: -0.25, ael: 0.2, xaz: -0.1, xel: 0.25, lean: 0.55, ph: 18.5, hp: 0.4 },
      eLin,
    ],
    [T, { ...CHOPPED, jaw: 0.8, tsx: 1.06, tsy: 0.93, glow: 0.7, eyes: 3, hp: 0.75 }, eOut],
    // Проводка: корпус проседает дальше, потом оседает.
    [
      T + 0.07,
      { ph: 15.5, lean: 0.7, twist: -0.6, hp: 0.9, tsx: 1.03, tsy: 0.965, glow: 0.3 },
      eOut,
    ],
    [T + 0.22, { ...CHOPPED, tsx: 1, tsy: 1, glow: 0, jaw: 0.35 }, eIO],
    [end - 0.12, { ph: 16, lean: 0.64, breath: 0.6 }, eIO],
    [end, { ph: 16.5, lean: 0.58, hp: 0.5, breath: 0.2, ar: 16.5 }, eIO],
  ];
  const r = track(keys, t, READY, LAG);
  // Тяжёлое дыхание над воткнутой секирой.
  if (t > T + 0.22) r.steam = 0.4 + 0.4 * Math.max(0, Math.sin((t - T) * 9));
  return pose3(r, t >= T && t < T + 0.12 ? 1 : 0, 1);
}

/** Вихрь: скрут назад, раскрутка, полный оборот ровно к T, ещё оборот и удар в пол. */
function techWhirl(t: number, h: number): Pose3 {
  const T = MT.whirl / h;
  const end = T + MT.axeTail / h;
  const s0 = 0.5 * T;
  const keys: Key[] = [
    [0, {}],
    [
      0.32 * T,
      {
        ph: 18,
        lean: 0.46,
        twist: 1.25,
        two: 1,
        ar: 15.5,
        aaz: 1.45,
        ael: -0.35,
        xaz: 2.2,
        xel: -0.05,
        xs: 12,
        xroll: 0,
        hp: 0.3,
        eyes: 3,
        tup: 0.5,
        glow: 0.3,
      },
      eIO,
    ],
    [s0, { ph: 17.2, twist: 1.55, lean: 0.52, glow: 0.7, fa: -7, na: 6 }, eIn],
    // Раскрутка: секира вперёд, руки вытянуты, тело вращается.
    [
      T,
      {
        twist: -0.1,
        ar: 15,
        aaz: 0.2,
        ael: -0.15,
        xaz: 0.2,
        xel: 0.05,
        xs: 13,
        ph: 17.6,
        lean: 0.55,
        jaw: 0.9,
        glow: 1,
        na: 3,
        fa: -3,
        cloth: 0.8,
        tup: 1,
      },
      eIO,
    ],
    [T + 0.3 / h, { twist: -0.2, xel: 0.9, ael: 0.6, ph: 19.5, lean: 0.3, glow: 0.8 }, eOut],
    [end - 0.2 / h, { ...CHOPPED, jaw: 0.8, tsx: 1.06, tsy: 0.93, glow: 0.6 }, eIn],
    [end - 0.1 / h, { ph: 15.5, lean: 0.7, tsx: 1.02, tsy: 0.98, glow: 0.2 }, eOut],
    [end, { ...CHOPPED, tsx: 1, tsy: 1, glow: 0 }, eIO],
  ];
  const r = track(keys, t, READY, LAG);
  // Оборот тела: разгон к T (полный круг), ещё круг с торможением к удару.
  if (t > s0) {
    if (t <= T) {
      const u = (t - s0) / (T - s0);
      r.spin = TAU * u * u;
    } else {
      const u = clamp((t - T) / (end - 0.2 / h - T), 0, 1);
      r.spin = TAU + TAU * eOut(u) * 1;
    }
  }
  return pose3(r, t > end - 0.2 / h && t < end - 0.05 ? 1 : 0, 1);
}

/** Восстановление: выдернуть секиру из пола — или выпрямиться после заноса. */
function techRecover(t: number, h: number, from: number): Pose3 {
  const D = MT.recover / h;
  if (from === FROM.axe || from === FROM.whirl) {
    const hold = R({ ...CHOPPED, ph: 16.5, lean: 0.58, hp: 0.5, ar: 16.5 });
    const keys: Key[] = [
      [0, hold],
      [0.1, { lean: 0.45, ph: 17.2, hp: 0.3, ar: 15.5, tdx: 1.5, jaw: 0.5 }, eIO],
      [
        0.18,
        {
          xel: -0.1,
          xaz: 0.2,
          ael: -0.3,
          aaz: -0.4,
          lean: 0.42,
          ph: 19.5,
          hp: -0.1,
          tdx: 0.5,
          twist: -0.2,
          fa: 3,
          na: 3,
          jaw: 0.2,
        },
        eOut3,
      ],
      [
        0.18 + 0.45 * (D - 0.18),
        {
          xaz: 2.2,
          xel: 1.1,
          ar: 17,
          aaz: -0.1,
          ael: -0.6,
          two: 0.3,
          twist: 0.1,
          lean: 0.3,
          ph: 20.3,
        },
        eOut,
      ],
      [D, READY, eIO],
    ];
    const r = track(keys, t, hold, LAG);
    const dirt = t > 0.12 && t < 0.26 ? 1 - Math.abs(t - 0.17) / 0.09 : 0;
    return pose3(r, dirt, -1);
  }
  if (from === FROM.skid) {
    const s = R(SKID_FINAL);
    const keys: Key[] = [
      [0, s],
      [0.12, { hy: -0.3, hr: -0.08 }, eIO],
      [0.22, { hy: 0.28, hr: 0.08, steam: 1 }, eIO],
      [0.32, { hy: 0, hr: 0, steam: 0.6 }, eIO],
      [D, READY, eIO],
    ];
    return pose3(track(keys, t, s, LAG));
  }
  return techIdle(0);
}

/** Смерть: удар, колени подламываются, секира падает, голова клонится, распад. */
function techDeath(t: number): Pose3 {
  const keys: Key[] = [
    [
      0,
      {
        hp: -0.5,
        jaw: 1,
        lean: -0.08,
        ph: 21,
        ar: 18,
        aaz: 0.9,
        ael: 0.2,
        br: 18,
        baz: 0.9,
        bel: 0.3,
        tdx: -2,
        eyes: 0,
        steam: 1,
        xel: 1.1,
      },
      eOut,
    ],
    [0.1, { hp: -0.65 }, eLin],
    [0.2, { xfree: 0 }, eStep],
    [0.21, { xfree: 1, xga: 10, xgb: 9, xgh: 30, xfaz: 1.0, xfel: 1.2 }, eStep],
    [
      0.34,
      {
        ph: 13.5,
        lean: 0.45,
        hp: 0.45,
        jaw: 0.6,
        ael: -1.2,
        bel: -1.2,
        aaz: 0.2,
        baz: 0.6,
        na: 3,
        fa: -5,
        tdx: -1,
        steam: 0.4,
      },
      eIn,
    ],
    [0.42, { xga: 15, xgb: 6, xgh: 0.8, xfaz: 0.15, xfel: 0.02 }, eIn],
    [0.48, { xgh: 2.5, xfel: 0.12 }, eOut],
    [0.54, { xgh: 0.8, xfel: 0.02 }, eIn],
    // На коленях: таз низко, голени лежат (копыта сзади).
    [
      0.58,
      { ph: 9.5, lean: 0.55, na: -9, nh: 0.5, fa: -11, fh: 0.5, tsy: 0.97, tsx: 1.02, eyes: 1 },
      eOut,
    ],
    [
      0.8,
      {
        lean: 0.72,
        hp: 1.1,
        nk: 2,
        nu: -3,
        jaw: 0.3,
        ar: 20,
        aaz: 0.1,
        ael: -1.45,
        br: 20,
        baz: 0.4,
        bel: -1.45,
        eyes: 2,
        tsy: 1,
        tsx: 1,
        steam: 0,
        tup: 0,
        tsw: 0.4,
      },
      eIO,
    ],
    [1.45, { lean: 0.8, hp: 1.25 }, eLin],
  ];
  const r = track(keys, t, READY, LAG);
  const melt = clamp((t - 0.9) / 0.55, 0, 1);
  return pose3(r, 0, 1, melt);
}

// ---- Кадр по запросу: техника, кадр, вид. -------------------------------------

interface MinoReq {
  tech: Tech;
  f: number;
  /** Темп фазы ×100 (ключ кеша). */
  hk: number;
  v: number;
  view: View;
  flip: boolean;
  flash: boolean;
  look: Look;
  /** Вздрог от удара героя (в покое и на ходу): 0…2. */
  fl: number;
}

/** Длительность техники в кадрах (для прогрева) и где контакт. */
function techSpan(tech: Tech, h: number, v: number): { n: number; hit: number } {
  switch (tech) {
    case 'idle':
      return { n: 24, hit: -1 };
    case 'walk':
      return { n: 8, hit: -1 };
    case 'roar':
      return { n: Math.round(MT.entry * FPS), hit: -1 };
    case 'bellow':
      return { n: Math.ceil((MT.roar / h) * FPS) + 1, hit: MT.roar / h };
    case 'aim':
      return { n: Math.ceil(((v & 1 ? MT.aimNext : MT.aim) / h) * FPS) + 1, hit: -1 };
    case 'gore':
      return { n: 11, hit: -1 };
    case 'skid':
      return { n: Math.ceil((MT.skid / h) * FPS) + 1, hit: -1 };
    case 'dizzy':
      return { n: 23 + 13, hit: -1 };
    case 'axe':
      return { n: Math.ceil(((MT.axe + MT.axeTail) / h) * FPS) + 1, hit: MT.axe / h };
    case 'whirl':
      return { n: Math.ceil(((MT.whirl + MT.axeTail) / h) * FPS) + 1, hit: MT.whirl / h };
    case 'recover':
      return { n: Math.ceil((MT.recover / h) * FPS) + 1, hit: -1 };
    case 'death':
      return { n: 35, hit: -1 };
  }
}

/** Время кадра f техники: 24 к/с, а кадр, в котором урон, — ровно в миг урона. */
function frameTime(f: number, hit: number): number {
  const t = f / FPS;
  if (hit >= 0 && hit >= t && hit < t + 1 / FPS) return hit;
  return t;
}

/** Поза кадра (и что ещё рисовать) — чистая функция запроса и времени. */
function poseAt(tech: Tech, t: number, h: number, v: number): Pose3 {
  switch (tech) {
    case 'idle':
      return techIdle(t);
    case 'walk':
      return techWalk(t);
    case 'roar':
      return techRoar(t);
    case 'bellow':
      return techBellow(t, h);
    case 'aim':
      return techAim(t, h, (v & 1) === 1, v >> 1);
    case 'gore':
      return techGore(t);
    case 'skid':
      return techSkid(t, h);
    case 'dizzy':
      return techDizzy(t, h, v);
    case 'axe':
      return techAxe(t, h);
    case 'whirl':
      return techWhirl(t, h);
    case 'recover':
      return techRecover(t, h, v);
    case 'death':
      return techDeath(t);
  }
}

/** Время позы для кадра f (петли — фаза 0…1). */
function reqTime(q: MinoReq): number {
  const h = q.hk / 100;
  switch (q.tech) {
    case 'idle':
      return q.f / 24;
    case 'walk':
      return q.f / 8;
    case 'gore':
      return q.f / FPS;
    case 'roar':
      // Середина рёва — петля 4 кадра на 12 к/с (кадры 12…15).
      return q.f >= 12 && q.f < 16
        ? 0.5 + (q.f - 12) / 12
        : q.f < 12
          ? q.f / FPS
          : 1.15 + (q.f - 16) / FPS;
    case 'dizzy': {
      const Td = dizzyT(h, q.v);
      if (q.f < 10) return q.f / FPS;
      if (q.f < 23) return 0.4 + ((q.f - 10) / DIZ_LOOP) * 1.1;
      return Td - 0.5 + (q.f - 23) / FPS;
    }
    default: {
      const { hit } = techSpan(q.tech, h, q.v);
      return frameTime(q.f, hit);
    }
  }
}

const TRAIL_TECH: Partial<Record<Tech, boolean>> = {
  axe: true,
  whirl: true,
  recover: true,
  roar: true,
};

const MFR = frameLRU<MobFrame>(400);

/** Кадр без зеркала и вспышки: рендер скелета. */
function minoBase(q: MinoReq): MobFrame {
  const key = `b|${q.tech}|${q.v}|${q.hk}|${q.f}|${q.fl}|${q.view}|${q.look}`;
  const hit = MFR.get(key);
  if (hit) return hit;
  const h = q.hk / 100;
  const t = reqTime(q);
  const ps = poseAt(q.tech, t, h, q.v);
  const r = ps.r;
  if (q.fl > 0) {
    // Вздрог: голова назад, плечи вверх, прищур.
    const k = q.fl / 2;
    r.lean -= 0.12 * k;
    r.hp -= 0.32 * k;
    r.nk -= 1.2 * k;
    r.ph -= 0.5 * k;
    r.twist += 0.14 * k;
    r.jaw = Math.max(r.jaw, 0.35 * k);
    r.eyes = 1;
    r.ael += 0.15 * k;
  }
  // Анфас и со спины лезвие в плоскости взмаха смотрит на камеру ребром —
  // тонкая палка. Рукоять чуть провёрнута: полумесяц виден с любой стороны.
  const roll = q.view === 'side' ? 0 : 0.85;
  r.xroll += roll;
  const sk = skeleton(r);
  let trail: Skel[] | null = null;
  if (TRAIL_TECH[q.tech] && (q.tech !== 'roar' || t < 0.5)) {
    trail = [];
    // Вихрь идёт по кругу быстрее рубки — выборки чаще, иначе след лесенкой.
    const n = q.tech === 'whirl' ? 8 : 5;
    const dt = q.tech === 'whirl' ? 1 / 80 : 1 / 48;
    for (let i = 1; i <= n; i++) {
      const rr = poseAt(q.tech, Math.max(0, t - i * dt), h, q.v).r;
      rr.xroll += roll;
      trail.push(skeleton(rr));
    }
  }
  const cam = CAMS[q.view];
  const b = paintMino3(r, sk, cam, {
    t,
    trail,
    dirt: ps.dirt,
    dirtDir: ps.dirtDir,
    melt: ps.melt,
    rage: h >= 1.29 ? 1 : 0,
    sparks: ps.sparks,
  });
  const p = b.p;
  if (q.look === 'elite') p.outline(GOLD);
  const fwd = r.tdx;
  let dx = 0;
  let dy = -r.tdy;
  let sx = r.tsx;
  let sy = r.tsy;
  let rot = 0;
  if (q.view === 'side') {
    dx = fwd;
    rot = r.trot;
  } else {
    dy += q.view === 'front' ? fwd * 0.8 : -fwd * 0.8;
    dx = fwd * 0.2;
    sy = r.tsy * (1 - (1 - r.tsx) * 0.5);
    sx = 1 + (1 - r.tsx) * 0.3 + (1 - r.tsy) * 0.5;
  }
  const out: MobFrame = {
    img: p.canvas(),
    ax: MAX + b.ox,
    ay: MAY + b.oy,
    eye: b.eye,
    lit: b.lit ? b.lit.canvas() : null,
    dx,
    dy,
    sx,
    sy,
    rot,
    still: true,
    shadow: 17 * (1 - ps.melt * 0.8),
  };
  return MFR.set(key, out);
}

function mirrorCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const g = c.getContext('2d');
  if (g) {
    g.translate(src.width, 0);
    g.scale(-1, 1);
    g.drawImage(src, 0, 0);
  }
  return c;
}
function flashCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
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

/** Кадр по запросу: зеркало и белая вспышка — из кадра без них. */
function minoFrame(q: MinoReq): MobFrame {
  if (!q.flip && !q.flash) return minoBase(q);
  const key = `v|${q.tech}|${q.v}|${q.hk}|${q.f}|${q.fl}|${q.view}|${q.look}|${q.flip ? 1 : 0}|${q.flash ? 1 : 0}`;
  const hit = MFR.get(key);
  if (hit) return hit;
  if (q.flash) {
    const src = minoFrame({ ...q, flash: false });
    return MFR.set(key, { ...src, img: flashCanvas(src.img) });
  }
  const b = minoBase({ ...q, flip: false });
  return MFR.set(key, {
    ...b,
    img: mirrorCanvas(b.img),
    lit: b.lit ? mirrorCanvas(b.lit) : null,
    eye: b.eye ? [MW - 1 - b.eye[0], b.eye[1]] : null,
    ax: MW - b.ax,
    dx: -(b.dx ?? 0),
    rot: -(b.rot ?? 0),
  });
}

// ---- Рисовальщик: режим мозга → техника и кадр; вид; отдача; вспышка фазы. ----

/** Что рисовальщик помнит о быке между кадрами (только для рисунка). */
interface MinoMem {
  view: View;
  flip: boolean;
  mode: string;
  prev: string;
  haste: number;
  flareT: number;
  walk: number;
  now: number;
}
const minoMem = new WeakMap<Mob, MinoMem>();

function minoMemOf(m: Mob, pose: MobPose): { s: MinoMem; fresh: boolean } {
  const c = Math.cos(m.face ?? 0);
  const sn = Math.sin(m.face ?? 0);
  let s = minoMem.get(m);
  const fresh = !s;
  if (!s) {
    s = {
      view: Math.abs(c) >= Math.abs(sn) ? 'side' : sn > 0 ? 'front' : 'back',
      flip: c < 0,
      mode: pose.mode,
      prev: '',
      haste: m.data?.haste ?? 1,
      flareT: -9,
      walk: 0,
      now: pose.now,
    };
    minoMem.set(m, s);
  }
  // Вид — с запасом, как у героя: по диагонали не мигает.
  const ac = Math.abs(c);
  const as = Math.abs(sn);
  if (s.view === 'side') {
    if (as > ac + 0.3) s.view = sn > 0 ? 'front' : 'back';
  } else if (ac > as + 0.3) s.view = 'side';
  else s.view = sn > 0 ? 'front' : 'back';
  if (s.view === 'side' || ac > 0.2) s.flip = c < 0;
  if (pose.mode !== s.mode) {
    s.prev = s.mode;
    s.mode = pose.mode;
  }
  const hs = m.data?.haste ?? 1;
  if (hs > s.haste + 0.01) s.flareT = pose.now;
  s.haste = hs;
  const dt = clamp(pose.now - s.now, 0, 0.1);
  s.now = pose.now;
  s.walk += Math.hypot(m.vx ?? 0, m.vy ?? 0) * 16 * dt;
  return { s, fresh };
}

/** Откуда пришли: память рисовальщика, а на листе кадров — подсказка `vFrom`. */
function fromOf(m: Mob, s: MinoMem): number {
  const hint = m.data?.vFrom;
  if (hint) return hint;
  if (s.prev === 'bellow') return FROM.bellow;
  if (s.prev === 'skid') return FROM.skid;
  if (s.prev === 'axe') return FROM.axe;
  if (s.prev === 'whirl') return FROM.whirl;
  return FROM.none;
}

const WALK_STRIDE = 30;

function minoReq(m: Mob, pose: MobPose): { q: MinoReq; s: MinoMem } {
  const { s, fresh } = minoMemOf(m, pose);
  const h = m.data?.haste ?? 1;
  const hk = Math.round(h * 100);
  const echo = m.kind === 'f15b_echo_mino';
  const t = Math.max(0, pose.t);
  const q: MinoReq = {
    tech: 'idle',
    f: 0,
    hk,
    v: 0,
    view: s.view,
    flip: s.flip,
    // Смерть белым не мигает: копия убранного моба держит последнюю вспышку.
    flash: pose.flash && (pose.mode !== 'dying' || pose.t < 0.1),
    look: pose.look,
    fl: 0,
  };
  const at = (n: number) => Math.min(n - 1, Math.floor(t * FPS + 1e-6));
  switch (pose.mode) {
    case 'roar': {
      q.tech = 'roar';
      const tt = t % MT.entry;
      q.f =
        tt < 0.5
          ? Math.floor(tt * FPS)
          : tt < 1.15
            ? 12 + (Math.floor((tt - 0.5) * 12) % 4)
            : Math.min(24, 16 + Math.floor((tt - 1.15) * FPS));
      break;
    }
    case 'bellow':
      q.tech = 'bellow';
      q.f = at(techSpan('bellow', h, 0).n);
      break;
    case 'aim': {
      q.tech = 'aim';
      const from = fromOf(m, s);
      q.v = (m.data?.next ? 1 : 0) | ((from === FROM.bellow || from === FROM.skid ? from : 0) << 1);
      q.f = at(techSpan('aim', h, q.v).n);
      break;
    }
    case 'gore': {
      q.tech = 'gore';
      const f = Math.floor(t * FPS + 1e-6);
      q.f = f < 3 ? f : 3 + ((f - 3) % 8);
      break;
    }
    case 'skid':
      q.tech = 'skid';
      q.f = at(techSpan('skid', h, 0).n);
      break;
    case 'dizzy': {
      q.tech = 'dizzy';
      q.v = echo ? 2 : m.data?.long ? 1 : 0;
      const Td = dizzyT(h, q.v);
      if (t < 0.4) q.f = Math.floor(t * FPS);
      else if (t < Td - 0.5) q.f = 10 + (Math.floor((t - 0.4) * (DIZ_LOOP / 1.1)) % DIZ_LOOP);
      else q.f = Math.min(35, 23 + Math.floor((t - (Td - 0.5)) * FPS));
      break;
    }
    case 'axe':
      q.tech = 'axe';
      q.f = at(techSpan('axe', h, 0).n);
      break;
    case 'whirl':
      q.tech = 'whirl';
      q.f = at(techSpan('whirl', h, 0).n);
      break;
    case 'recover': {
      q.tech = 'recover';
      let from = fromOf(m, s);
      if (from !== FROM.axe && from !== FROM.whirl && from !== FROM.skid)
        from = m.data?.chopped ? FROM.axe : s.prev === 'skid' ? FROM.skid : FROM.none;
      if (from === FROM.none) {
        q.tech = 'idle';
        q.f = Math.floor(pose.now * 10 + m.id * 3.7) % 24;
        break;
      }
      q.v = from;
      q.f = at(techSpan('recover', h, 0).n);
      break;
    }
    case 'dying':
      q.tech = 'death';
      q.f = at(35);
      break;
    default: {
      const run = pose.anim === 'run';
      if (run) {
        q.tech = 'walk';
        const d = fresh ? pose.now * Math.hypot(m.vx ?? 0, m.vy ?? 0) * 16 : s.walk;
        q.f = Math.floor(((d / WALK_STRIDE) % 1) * 8) % 8;
      } else {
        q.tech = 'idle';
        q.f = Math.floor(pose.now * 10 + (m.id ?? 0) * 3.7) % 24;
      }
      // Вздрог от удара героя — в покое и на ходу (в технике бык прёт сквозь удар).
      const fl = m.flash ?? 0;
      q.fl = fl > 0.07 ? 2 : fl > 0.01 ? 1 : 0;
    }
  }
  return { q, s };
}

/** Кайма ярости вокруг силуэта (смена фазы): поверх темноты, 4 ступени. */
const flareCache = new WeakMap<HTMLCanvasElement, HTMLCanvasElement[]>();
function flareOf(
  img: HTMLCanvasElement,
  lit: HTMLCanvasElement | null,
  lvl: number,
): HTMLCanvasElement {
  let arr = flareCache.get(img);
  if (!arr) {
    arr = [];
    flareCache.set(img, arr);
  }
  const hit = arr[lvl];
  if (hit) return hit;
  const w = img.width;
  const h = img.height;
  const g = img.getContext('2d');
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const og = out.getContext('2d');
  if (!g || !og) return out;
  const src = g.getImageData(0, 0, w, h).data;
  const o = og.createImageData(w, h);
  const a = [0, 0.35, 0.6, 0.85, 1][lvl];
  const solid = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < w && y < h && src[(y * w + x) * 4 + 3] > 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (solid(x, y)) continue;
      let d = 9;
      for (let yy = -2; yy <= 2; yy++)
        for (let xx = -2; xx <= 2; xx++)
          if (solid(x + xx, y + yy)) d = Math.min(d, Math.abs(xx) + Math.abs(yy));
      if (d > 3) continue;
      const i = (y * w + x) * 4;
      const k = d <= 1 ? 1 : d === 2 ? 0.6 : 0.3;
      o.data[i] = 255;
      o.data[i + 1] = d <= 1 ? 120 : 60;
      o.data[i + 2] = 40;
      o.data[i + 3] = Math.round(255 * a * k);
    }
  og.putImageData(o, 0, 0);
  if (lit) og.drawImage(lit, 0, 0);
  arr[lvl] = out;
  return out;
}

registerMobPainter('f5_minotaur', (m: Mob, pose: MobPose) => {
  const { q, s } = minoReq(m, pose);
  const fr = minoFrame(q);
  const out: MobFrame = { ...fr };
  // Шлейф на таране; долгая смерть.
  if (q.tech === 'gore') out.ghost = { every: 0.035, life: 0.2, tint: '#b8401c', alpha: 0.22 };
  if (q.tech === 'death') out.linger = 1.45;
  // Отдача от удара героя: по направлению удара, с возвратом.
  const fl = m.flash ?? 0;
  if (fl > 0 && pose.mode !== 'dying') {
    const sim = paintSim();
    const age = clamp(0.12 - fl, 0, 0.12);
    let ux = pose.left ? 1 : -1;
    let uy = 0;
    if (sim) {
      const dx = m.x - sim.hero.x;
      const dy = m.y - sim.hero.y;
      const d = Math.hypot(dx, dy) || 1;
      ux = dx / d;
      uy = dy / d;
    }
    const tech = q.tech === 'idle' || q.tech === 'walk' || q.tech === 'dizzy' ? 1 : 0.45;
    const k = Math.sin((age / 0.12) * Math.PI) * 2.4 * tech;
    out.dx = (out.dx ?? 0) + ux * k;
    out.dy = (out.dy ?? 0) + uy * k * 0.6;
    out.sx = (out.sx ?? 1) * (1 - 0.03 * tech * Math.sin((age / 0.12) * Math.PI));
    out.sy = (out.sy ?? 1) * (1 + 0.025 * tech * Math.sin((age / 0.12) * Math.PI));
  }
  // Смена фазы: кайма ярости разгорается и гаснет за 0,8 с.
  const fa = pose.now - s.flareT;
  if (fa >= 0 && fa < 0.8 && pose.mode !== 'dying') {
    const lvl = Math.max(1, Math.min(4, Math.round((1 - Math.abs(fa - 0.25) / 0.55) * 4)));
    out.lit = flareOf(fr.img, fr.lit ?? null, lvl);
  }
  return out;
});

// Прогрев: всё, что игрок увидит в первом бою, в обе стороны; анфас — рёв входа.
registerMobWarm('f5_minotaur', function* () {
  const base = { hk: 100, v: 0, flash: false, look: 'normal' as Look, fl: 0 };
  const list: [Tech, number, View[]][] = [
    ['roar', 0, ['front', 'side']],
    ['idle', 0, ['side']],
    ['walk', 0, ['side']],
    ['aim', 0, ['side']],
    ['gore', 0, ['side']],
    ['axe', 0, ['side']],
    ['recover', FROM.axe, ['side']],
    ['skid', 0, ['side']],
    ['dizzy', 0, ['side']],
  ];
  for (const [tech, v, views] of list) {
    const n = tech === 'roar' ? 25 : techSpan(tech, 1, v).n;
    for (const view of views)
      for (const flip of view === 'side' ? [false, true] : [false]) {
        for (let f = 0; f < n; f++) {
          minoFrame({ ...base, tech, v, f, view, flip });
          yield f;
        }
      }
  }
});

// ---------------------------------------------------------------------------
// Реквизит: факел, кости, горшок, колонна, оружие в песке.
// ---------------------------------------------------------------------------

const sprites = new Map<string, Sprite>();
const spriteOf = (key: string, make: () => Sprite): Sprite => {
  let s = sprites.get(key);
  if (!s) {
    s = make();
    sprites.set(key, s);
  }
  return s;
};

const FIRE = [hx('#a8300c'), hx('#ff6a1a'), hx('#ffb030'), hx('#fff0a0')];

/** Язычок пламени высотой h (кадр f) с основанием в (x, y). */
function flame(p: Px, x: number, y: number, h: number, f: number): void {
  const sway = [0, 1, 0, -1][f % 4];
  for (let i = 0; i < h; i++) {
    const k = i / h;
    const w = (1 - k) * 2.2 + 0.4;
    const cx = x + sway * k * 1.2;
    for (let dx = -Math.ceil(w); dx <= Math.ceil(w); dx++) {
      if (Math.abs(dx) > w) continue;
      const core = Math.abs(dx) / w;
      const c =
        k > 0.8 ? FIRE[1] : core < 0.35 && k < 0.6 ? FIRE[3] : core < 0.7 ? FIRE[2] : FIRE[1];
      p.set(Math.round(cx + dx), y - i, c);
    }
  }
  if (f % 2) p.set(x + sway, y - h - 1, FIRE[1]);
}

registerPropPainter('f5_torch', (_o, time) => {
  const f = Math.floor(time * 8) % 4;
  return spriteOf(`torch|${f}`, () => {
    const p = new Px(12, 22);
    // Скоба в стене и держак.
    const iron: Tones = [hx('#1a1a1e'), hx('#3a3a40'), hx('#5e5e66'), hx('#8a8a92')];
    limb(p, 6, 15, 6, 19, 1, 1, iron);
    stroke(p, 3, 18, 9, 18, iron[1], 2);
    limb(p, 6, 8, 6, 15, 1.3, 1, [hx('#2a160c'), hx('#50301a'), hx('#744a2a'), hx('#96643a')]);
    stroke(p, 4, 9, 8, 9, iron[2]);
    p.outline(INK);
    flame(p, 6, 8, 7, f);
    return { img: p.canvas(), ax: 6, ay: 22 };
  });
});

const BONE: Tones = [hx('#6a6050'), hx('#a89c84'), hx('#d4cab0'), hx('#f0e8d4')];

registerPropPainter('f5_bones', (o) => {
  const v = Math.floor(hash(o.x, o.y) * 3);
  return spriteOf(`bones|${v}`, () => {
    const p = new Px(18, 12);
    // Череп.
    const sx = v === 1 ? 5 : 12;
    shadeEll(p, sx, 6, 3, 2.7, BONE);
    shadeEll(p, sx + (v === 1 ? -1.2 : 1.2), 8, 1.8, 1.2, BONE);
    // Рёбра и кости.
    for (let i = 0; i < 3; i++)
      stroke(p, 5 + i * 2 + (v === 1 ? 5 : 0), 7, 4 + i * 2 + (v === 1 ? 5 : 0), 10, BONE[1]);
    stroke(p, 1, 10, 9, 8, BONE[2]);
    p.set(1, 9, BONE[3]);
    p.set(9, 7, BONE[3]);
    if (v !== 2) {
      // Ржавый клинок авантюриста.
      stroke(p, 10, 11, 17, 7, hx('#8a5a3a'));
      stroke(p, 11, 11, 17, 8, hx('#5a3a24'));
      p.set(10, 10, hx('#3a2a1a'));
    }
    p.outline(INK);
    // Глазницы.
    p.set(sx - (v === 1 ? 1 : -1), 6, INK);
    p.set(sx + (v === 1 ? 0.5 : -0.5), 5, hx('#2a241c'));
    return { img: p.canvas(), ax: 9, ay: 13 };
  });
});

const CLAY: Tones = [hx('#5a2a16'), hx('#8e4a28'), hx('#b86a3a'), hx('#dc9460')];

registerPropPainter('f5_pot', (o, _time, _alive, flash) => {
  const v = Math.floor(hash(o.x, o.y, 5) * 2);
  return spriteOf(`pot|${v}|${flash ? 1 : 0}`, () => {
    let p = new Px(14, 16);
    shadeEll(p, 7, 10, 5, 4.6, CLAY);
    limb(p, 7, 3, 7, 6, 2, 2.4, CLAY);
    shadeEll(p, 7, 3, 2.8, 1.1, CLAY, 0.2);
    // Узор — полоса и зигзаг.
    for (let x = 3; x <= 11; x++) p.set(x, 9, CLAY[0]);
    for (let x = 3; x <= 11; x++) p.set(x, (x % 2) + 11, v ? hx('#e0c080') : CLAY[0]);
    if (v) {
      limb(p, 2.5, 7, 1.5, 9, 0.8, 0.8, CLAY);
      limb(p, 11.5, 7, 12.5, 9, 0.8, 0.8, CLAY);
    }
    p.outline(INK);
    p.set(7, 3, hx('#2a140a'));
    if (flash) p = p.tint(WHITE, 0.85);
    return { img: p.canvas(), ax: 7, ay: 16 };
  });
});

const STONE: Tones = [hx('#4a3a30'), hx('#7a6454'), hx('#a48a74'), hx('#c8b098')];

registerPropPainter('f5_pillar', (o, time) => {
  const v = Math.floor(hash(o.x, o.y, 7) * 2);
  const f = Math.floor(time * 8 + o.x) % 4;
  return spriteOf(`pillar|${v}|${f}`, () => {
    const p = new Px(18, 46);
    // Основание, ствол с каннелюрами, капитель.
    for (let y = 40; y <= 44; y++)
      for (let x = 2; x <= 15; x++)
        p.set(x, y, tone(STONE, 0.6 - (x - 2) * 0.06 - (y === 44 ? 0.4 : 0)));
    for (let y = 8; y < 40; y++)
      for (let x = 4; x <= 13; x++) {
        const k = (x - 4) / 9;
        const fl = (x - 4) % 3 === 2 ? -0.25 : 0;
        p.set(x, y, tone(STONE, 0.75 - k * 0.8 + fl));
      }
    for (let y = 3; y <= 8; y++)
      for (let x = 1; x <= 16; x++)
        p.set(x, y, tone(STONE, 0.65 - (x - 1) * 0.05 - (y === 8 ? 0.4 : 0)));
    // Трещины и сколы.
    const cr = spline(
      [
        [v ? 6 : 11, 10],
        [v ? 8 : 9, 18],
        [v ? 7 : 10, 26],
        [v ? 9 : 8, 31],
      ],
      4,
    );
    cr.forEach(([x, y]) => p.set(Math.floor(x), Math.floor(y), STONE[0]));
    clear(p, 13, 22);
    clear(p, 13, 23);
    // Красная полоса арены на капители.
    for (let x = 1; x <= 16; x++) p.set(x, 5, hx(x % 3 ? '#8a2a1a' : '#c8a040'));
    // Скоба с факелом на стволе — арена освещена.
    const iron: Tones = [hx('#1a1a1e'), hx('#3a3a40'), hx('#5e5e66'), hx('#8a8a92')];
    stroke(p, 10, 24, 14, 24, iron[2], 1);
    limb(p, 14, 18, 14, 24, 1.1, 0.9, [hx('#2a160c'), hx('#50301a'), hx('#744a2a'), hx('#96643a')]);
    p.outline(INK);
    flame(p, 14, 18, 6, f);
    return { img: p.canvas(), ax: 9, ay: 46 };
  });
});

registerPropPainter('f5_pillar_broken', (o, time) => {
  const v = Math.floor(hash(o.x, o.y, 7) * 2);
  const f = Math.floor(time * 8 + o.x) % 4;
  return spriteOf(`pillarb|${v}|${f}`, () => {
    const p = new Px(22, 16);
    for (let y = 9; y <= 14; y++)
      for (let x = 6; x <= 15; x++) p.set(x, y, tone(STONE, 0.6 - (x - 6) * 0.08));
    // Излом сверху.
    for (let x = 6; x <= 15; x++) {
      const top = 9 - Math.round(hash(x, v) * 4);
      for (let y = top; y < 9; y++) p.set(x, y, tone(STONE, 0.55 - (x - 6) * 0.08));
    }
    // Обломки вокруг.
    shadeEll(p, 3.5, 13.5, 3, 2, STONE);
    shadeEll(p, 18.5, 13, 2.6, 2.2, STONE);
    shadeEll(p, 12, 15, 2, 1, STONE, -0.2);
    p.outline(INK);
    // Упавший факел ещё горит в обломках.
    flame(p, 17, 12, 4, f);
    return { img: p.canvas(), ax: 11, ay: 16 };
  });
});

registerPropPainter('f5_blade', (o) => {
  const v = Math.floor(hash(o.x, o.y, 9) * 3);
  return spriteOf(`blade|${v}`, () => {
    const p = new Px(14, 20);
    const steel: Tones = [hx('#4a4e54'), hx('#7e868e'), hx('#b4bcc4'), hx('#e8eef2')];
    if (v === 2) {
      // Копьё.
      stroke(p, 3, 18, 10, 2, hx('#6a4028'), 2);
      poly(
        p,
        [
          [10, 0],
          [12, 4],
          [9, 5],
        ],
        steel[2],
      );
    } else {
      // Меч в песке: клинок, гарда, рукоять.
      const lean = v ? 1 : -1;
      limb(p, 7 + lean * 2, 5, 7 - lean, 17, 1.2, 0.9, steel);
      stroke(p, 3 + lean * 2, 6, 11 + lean * 2, 5, hx('#8a6a30'), 2);
      stroke(p, 7 + lean * 2.4, 5, 7 + lean * 3, 1, hx('#4a2a18'), 2);
      p.set(Math.floor(7 + lean * 3), 0, hx('#c8a040'));
    }
    // Песок, насыпанный у лезвия.
    for (let x = 3; x < 12; x++) p.set(x, 18 + (x % 2), hx('#a88458'));
    p.outline(INK);
    return { img: p.canvas(), ax: 7, ay: 20 };
  });
});

/** Живая стена дышит: шов наливается светом и гаснет, у каждой — своя фаза. */
registerPropPainter('f5_vein', (o, time) => {
  const ph = hash(o.x, o.y, 12) * TAU;
  const k = 0.5 + 0.5 * Math.sin(time * 2.2 + ph);
  const f = Math.min(3, Math.floor(k * 4));
  const v = Math.floor(hash(o.x, o.y, 4) * 3);
  return spriteOf(`vein|${v}|${f}`, () => {
    const p = new Px(16, 16);
    const seam = spline(
      [
        [7 + v, 0],
        [6 + v, 5],
        [8, 9],
        [7 + (v % 2), 15],
      ],
      4,
    );
    const glow = [FLESH.dk, FLESH.lt, FLESH.glow, FLESH.hot][f];
    seam.forEach(([x, y], i) => {
      if (f === 0 && i % 2) return;
      p.set(Math.floor(x), Math.floor(y), glow);
      if (f >= 2) {
        p.set(Math.floor(x) - 1, Math.floor(y), alpha(FLESH.glow, 0.45));
        p.set(Math.floor(x) + 1, Math.floor(y), alpha(FLESH.glow, 0.45));
      }
    });
    if (f === 3) {
      const [cx, cy] = seam[6];
      p.set(Math.floor(cx), Math.floor(cy), WHITE);
    }
    return { img: p.canvas(), ax: 8, ay: 16 };
  });
});

// Герб арены: мозаика в песке под логовом — бычья голова в кольце.
let emblemImg: HTMLCanvasElement | null = null;
registerZonePainter('f5_emblem', (g, _z, px, py) => {
  if (!emblemImg) {
    const p = new Px(52, 40);
    const cx = 26;
    const cy = 20;
    const red = hx('#7a2016');
    const redLt = hx('#a4382a');
    const gold = hx('#c8a040');
    const goldLt = hx('#ecd07a');
    const dk = hx('#4a2a1c');
    for (let y = 0; y < 40; y++)
      for (let x = 0; x < 52; x++) {
        const dx = (x + 0.5 - cx) / 25;
        const dy = (y + 0.5 - cy) / 19;
        const d = Math.hypot(dx, dy);
        if (d > 1) continue;
        // Кольца мозаики: внешнее тёмное, золотой поясок, красное поле.
        const c =
          d > 0.93
            ? dk
            : d > 0.84
              ? (x + y) % 3
                ? gold
                : goldLt
              : d > 0.78
                ? dk
                : (x * 7 + y * 3) % 11 === 0
                  ? redLt
                  : red;
        p.set(x, y, alpha(c, 0.85));
      }
    // Бычья голова: череп и рога золотом.
    p.ell(cx, cy + 2, 5, 6, alpha(gold, 0.95));
    p.ell(cx, cy + 6, 3.2, 2.4, alpha(goldLt, 0.95));
    for (const dir of [-1, 1]) {
      const pts = spline(
        [
          [cx + dir * 4, cy - 2],
          [cx + dir * 10, cy - 4],
          [cx + dir * 13, cy - 10],
        ],
        4,
      );
      pts.forEach(([x, y], i) => p.ell(x, y, 1.6 - i * 0.08, 1.6 - i * 0.08, alpha(goldLt, 0.95)));
    }
    p.set(cx - 2, cy + 1, dk);
    p.set(cx + 2, cy + 1, dk);
    emblemImg = p.canvas();
  }
  g.drawImage(emblemImg, Math.round(px - 26), Math.round(py - 20));
  return true;
});

// ---------------------------------------------------------------------------
// Свои клетки: трава, мох, живая стена, песок, провал, шипы, трибуны.
// ---------------------------------------------------------------------------

const cells = new Map<string, Px>();
const cellOf = (key: string, make: () => Px): Px => {
  let c = cells.get(key);
  if (!c) {
    c = make();
    cells.set(key, c);
  }
  return c;
};

const GR = {
  base: hx('#2a3412'),
  dk: hx('#1e260c'),
  mid: hx('#465a1c'),
  lt: hx('#6c8228'),
  tip: hx('#9aae48'),
  dry: hx('#8a7a3a'),
  flower: hx('#e0c860'),
};

function grassCell(c: CellCtx): Px {
  const up = c.markAt(0, -1) === F5_MARK.grass;
  const v = Math.floor(hash(c.wx, c.wy) * 4);
  return cellOf(`grass|${v}|${up ? 1 : 0}`, () => {
    const p = new Px(16, 16);
    // Подложка — тёмная зелень, края рваные к полу.
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const n = hash(x + v * 16, y, 3);
        if (!up && y < 3 && n > 0.45) continue;
        p.set(x, y, n < 0.3 ? GR.dk : GR.base);
      }
    // Стебли: ряды снизу вверх, с наклоном.
    for (let i = 0; i < 22; i++) {
      const x = Math.floor(hash(i, v, 1) * 16);
      const y = 5 + Math.floor(hash(i, v, 2) * 11);
      const h = 3 + Math.floor(hash(i, v, 4) * 5);
      const lean = hash(i, v, 5) < 0.5 ? -1 : 1;
      const col = hash(i, v, 6) < 0.15 ? GR.dry : hash(i, v, 7) < 0.5 ? GR.mid : GR.lt;
      for (let k = 0; k < h; k++) {
        const xx = x + (k > h / 2 ? lean : 0);
        p.set(xx, y - k, k === h - 1 ? GR.tip : col);
      }
    }
    if (v === 2) p.set(5, 7, GR.flower);
    return p;
  });
}

const MOSS = { dk: hx('#1e4a18'), mid: hx('#3a8a2a'), lt: hx('#6ad24a'), glow: hx('#c8ff8a') };

function mossCell(c: CellCtx): Px | null {
  const face = c.open(0, 1);
  const v = Math.floor(hash(c.wx, c.wy, 2) * 4);
  return cellOf(`moss|${v}|${face ? 1 : 0}`, () => {
    const p = new Px(16, 16);
    if (face) {
      // Мох свисает со шва кладки и светится.
      for (let x = 0; x < 16; x++) {
        const len = 2 + Math.floor(hash(x, v, 1) * (x % 5 === v ? 9 : 5));
        for (let y = 0; y < len; y++) {
          const k = y / len;
          p.set(x, y, k < 0.3 ? MOSS.dk : k < 0.75 ? MOSS.mid : MOSS.lt);
        }
      }
      for (let i = 0; i < 5; i++)
        p.set(Math.floor(hash(i, v, 3) * 16), 4 + Math.floor(hash(i, v, 4) * 10), MOSS.glow);
    } else {
      for (let i = 0; i < 8; i++) {
        const x = Math.floor(hash(i, v, 5) * 15);
        const y = Math.floor(hash(i, v, 6) * 15);
        p.set(x, y, MOSS.mid);
        p.set(x + 1, y, MOSS.lt);
      }
    }
    return p;
  });
}

const FLESH = {
  dk: hx('#3a0c0a'),
  mid: hx('#7a1e18'),
  lt: hx('#b8402a'),
  glow: hx('#ff8a3a'),
  hot: hx('#ffd27a'),
};

function livingCell(c: CellCtx): Px | null {
  const face = c.open(0, 1);
  const v = Math.floor(hash(c.wx, c.wy, 4) * 3);
  return cellOf(`living|${v}|${face ? 1 : 0}`, () => {
    const p = new Px(16, 16);
    if (!face) {
      for (let i = 0; i < 6; i++)
        p.set(Math.floor(hash(i, v, 1) * 16), Math.floor(hash(i, v, 2) * 16), FLESH.mid);
      return p;
    }
    // Прожилки по швам кладки, в середине — шов, откуда выходят.
    const seam = spline(
      [
        [7 + v, 0],
        [6 + v, 5],
        [8, 9],
        [7 + (v % 2), 15],
      ],
      4,
    );
    // Шов тёмный: светится он предметом `f5_vein` — дышит.
    seam.forEach(([x, y]) => {
      p.set(Math.floor(x) - 1, Math.floor(y), FLESH.mid);
      p.set(Math.floor(x), Math.floor(y), FLESH.dk);
      p.set(Math.floor(x) + 1, Math.floor(y), FLESH.mid);
    });
    // Ветви прожилок в стороны.
    for (let i = 0; i < 4; i++) {
      const sy = 2 + i * 3.5;
      const dir = i % 2 ? 1 : -1;
      const len = 3 + Math.floor(hash(i, v, 3) * 4);
      for (let k = 0; k < len; k++) {
        const x = 7 + dir * (k + 1);
        const y = Math.floor(sy + k * 0.4);
        p.set(x, y, k < len - 1 ? FLESH.lt : FLESH.dk);
      }
    }
    // Поры.
    for (let i = 0; i < 3; i++) {
      const x = 2 + Math.floor(hash(i, v, 7) * 12);
      const y = 3 + Math.floor(hash(i, v, 8) * 10);
      p.set(x, y, FLESH.dk);
      p.set(x + 1, y, FLESH.lt);
    }
    return p;
  });
}

const SAND = {
  dk: hx('#8a6a42'),
  mid: hx('#b48e5c'),
  lt: hx('#cca672'),
  hi: hx('#e2c48e'),
  shade: hx('#5a4228'),
};

function sandCell(c: CellCtx): Px {
  const wallN = !c.open(0, -1);
  const wallW = !c.open(-1, 0);
  const wallE = !c.open(1, 0);
  const v = Math.floor(hash(c.wx, c.wy, 6) * 4);
  return cellOf(`sand|${v}|${wallN ? 1 : 0}${wallW ? 1 : 0}${wallE ? 1 : 0}`, () => {
    const p = new Px(16, 16);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const n = hash(x + v * 17, y + v * 5, 9);
        p.set(x, y, n < 0.12 ? SAND.dk : n < 0.7 ? SAND.mid : n < 0.95 ? SAND.lt : SAND.hi);
      }
    // Рябь — полосы от ветра по арене.
    for (let x = 0; x < 16; x++) {
      const y = (Math.floor(x * 0.4) + v * 3) % 16;
      p.set(x, y, SAND.lt);
      p.set(x, (y + 1) % 16, SAND.dk);
    }
    if (v === 3) {
      // След копыта.
      p.ell(7, 8, 2, 1.4, SAND.dk);
      p.set(7, 7, SAND.shade);
    }
    if (wallN)
      for (let y = 0; y < 3; y++)
        for (let x = 0; x < 16; x++) p.set(x, y, alpha(SAND.shade, 0.55 - y * 0.15));
    if (wallW)
      for (let x = 0; x < 2; x++)
        for (let y = 0; y < 16; y++) p.set(x, y, alpha(SAND.shade, 0.4 - x * 0.15));
    if (wallE)
      for (let x = 14; x < 16; x++)
        for (let y = 0; y < 16; y++) p.set(x, y, alpha(SAND.shade, 0.25));
    return p;
  });
}

const PIT = {
  void: hx('#050302'),
  wall: [hx('#1a100c'), hx('#2e1e16'), hx('#4a3226'), hx('#6a4a36')],
  ember: hx('#ff5a1a'),
  emberDk: hx('#8a2a0c'),
};

function pitCell(c: CellCtx): Px {
  const pit = (dx: number, dy: number) => c.markAt(dx, dy) === F5_MARK.pit;
  const n = !pit(0, -1);
  const w = !pit(-1, 0);
  const e = !pit(1, 0);
  const s = !pit(0, 1);
  const v = Math.floor(hash(c.wx, c.wy, 8) * 4);
  return cellOf(`pit|${n ? 1 : 0}${w ? 1 : 0}${e ? 1 : 0}${s ? 1 : 0}|${v}`, () => {
    const p = new Px(16, 16);
    p.rect(0, 0, 15, 15, PIT.void);
    // Далеко внизу тлеет нижний ярус.
    if (v === 1) {
      p.set(5, 11, PIT.emberDk);
      p.set(11, 7, PIT.ember);
      p.set(12, 7, PIT.emberDk);
    }
    if (v === 3) p.set(8, 13, PIT.emberDk);
    if (n) {
      // Северная стенка провала: кромка плиты, под ней кладка уходит вниз
      // и тонет в темноте — видно, что это яма, а не чёрная клякса.
      const brick: Tones = [hx('#241814'), hx('#4a3630'), hx('#6a5048'), hx('#8a6c5e')];
      for (let y = 2; y < 13; y++) {
        const k = (y - 2) / 11;
        for (let x = 0; x < 16; x++) {
          const seam = (y - 2) % 4 === 3 || (x + (Math.floor((y - 2) / 4) % 2) * 4) % 8 === 0;
          const t = seam ? 0 : k < 0.25 ? 3 : k < 0.55 ? 2 : 1;
          p.set(x, y, mixc(brick[t], PIT.void, Math.min(1, k * k * 1.1)));
        }
      }
      for (let x = 0; x < 16; x++) {
        p.set(x, 0, hx('#c0a08a'));
        p.set(x, 1, INK);
      }
    }
    if (w) for (let y = n ? 2 : 0; y < 16; y++) p.set(0, y, hx('#5a4038'));
    if (e) for (let y = n ? 2 : 0; y < 16; y++) p.set(15, y, hx('#2a1c18'));
    if (s) {
      // Южная кромка: край плиты над провалом.
      for (let x = 0; x < 16; x++) {
        p.set(x, 15, hx('#a88a78'));
        p.set(x, 14, INK);
      }
    }
    return p;
  });
}

function spikeCell(c: CellCtx): Px {
  const v = Math.floor(hash(c.wx, c.wy, 10) * 2);
  return cellOf(`spike|${v}`, () => {
    const p = new Px(16, 16);
    // Железная плита с отверстиями: светлее пола, с заклёпками по углам.
    const plate: Tones = [hx('#3a3a40'), hx('#6a6a72'), hx('#8e8e96'), hx('#b4b4bc')];
    for (let y = 1; y < 15; y++)
      for (let x = 1; x < 15; x++) p.set(x, y, tone(plate, 0.6 - (x + y) * 0.015));
    for (let i = 1; i < 15; i++) {
      p.set(i, 1, plate[3]);
      p.set(1, i, plate[3]);
      p.set(i, 14, plate[0]);
      p.set(14, i, plate[0]);
    }
    for (let i = 0; i < 16; i++) {
      p.set(i, 0, INK);
      p.set(0, i, INK);
      p.set(i, 15, INK);
      p.set(15, i, INK);
    }
    for (const [x, y] of [
      [2, 2],
      [13, 2],
      [2, 13],
      [13, 13],
    ])
      p.set(x, y, hx('#d8d8de'));
    // Отверстия: тёмная дыра, в глубине — остриё.
    for (const y of [5, 8, 11])
      for (const x of [5, 8, 11]) {
        p.set(x - 1, y - 1, hx('#0e0a0a'));
        p.set(x, y - 1, hx('#0e0a0a'));
        p.set(x - 1, y, hx('#0e0a0a'));
        p.set(x, y, hx(v ? '#7a7a82' : '#5a5a62'));
      }
    return p;
  });
}

function standsCell(c: CellCtx): Px | null {
  const face = c.open(0, 1);
  if (!face) return null;
  const v = c.wx % 4;
  return cellOf(`stands|${v}`, () => {
    const p = new Px(16, 16);
    // Крупная тёсаная кладка арены и красно-золотая полоса.
    const blk: Tones = [hx('#3e2c22'), hx('#6a4c3a'), hx('#8c6a52'), hx('#a88468')];
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const row = y < 7 ? 0 : 1;
        const off = row ? 4 : 0;
        const seam = y === 6 || y === 15 || (x + off + v * 4) % 8 === 7;
        p.set(x, y, seam ? blk[0] : tone(blk, 0.55 - (y % 7) * 0.05 - ((x + off) % 8) * 0.02));
      }
    for (let x = 0; x < 16; x++) {
      p.set(x, 9, hx('#6a1a12'));
      p.set(x, 10, hx(x % 4 === 1 ? '#d8a840' : '#8a2418'));
      p.set(x, 11, hx('#4a120c'));
    }
    if (v === 2) {
      // Рельеф: бычий череп над полосой.
      p.ell(8, 4, 2.2, 1.8, blk[3]);
      p.set(5, 2, blk[3]);
      p.set(4, 1, blk[3]);
      p.set(11, 2, blk[3]);
      p.set(12, 1, blk[3]);
      p.set(7, 4, blk[0]);
      p.set(9, 4, blk[0]);
    }
    return p;
  });
}

function cellPainter(c: CellCtx): Px | null {
  switch (c.mark) {
    case F5_MARK.grass:
      return grassCell(c);
    case F5_MARK.moss:
      return mossCell(c);
    case F5_MARK.living:
      return livingCell(c);
    case F5_MARK.sand:
      return sandCell(c);
    case F5_MARK.pit:
      return pitCell(c);
    case F5_MARK.spike:
      return spikeCell(c);
    case F5_MARK.stands:
      return standsCell(c);
    default:
      return null;
  }
}

registerCellPainter(F5_MAZE, cellPainter);
registerCellPainter(F5_ARENA, cellPainter);

// ---------------------------------------------------------------------------
// Метки ударов и лужи: огонь гончей, секира, вихрь, рёв, рифты, трещина
// живой стены, феромон, язык жабы, шипы.
// ---------------------------------------------------------------------------

export type ZoneX = (Zone | Strike) & { ang?: number; len?: number; arc?: number };

export const rgba = (c: RGBA, a: number) =>
  `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a)).toFixed(3)})`;

/** Сектор (конус) из центра. */
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

/** Метка удара наливается: `k` 0…1. */
export const kOf = (z: ZoneX) => {
  const s = z as Strike;
  if ('warn' in s && typeof s.warn === 'number' && s.warn > 0) return Math.min(1, s.t / s.warn);
  return 1;
};

// Огонь гончей (`f5_fire`, `f5_flame`) рисует `f5-mobs.ts` — в два слоя.

registerZonePainter('f5_birth', (g, z, px, py, S, time) => {
  const zz = z as Zone;
  const k = Math.min(1, zz.t / 1.1);
  // Трещина по лицу стены растёт и светится; к выходу — вспышка.
  const top = py - S * 0.5;
  const bottom = py + S * 0.5;
  const pts: [number, number][] = [];
  const n = 6;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push([px + (hash(i, zz.id) - 0.5) * 6 * k, top + (bottom - top) * t]);
  }
  const shown = Math.max(2, Math.round(n * Math.min(1, k * 1.4)));
  g.lineWidth = 3;
  g.strokeStyle = `rgba(255,90,30,${(0.35 + 0.4 * k).toFixed(3)})`;
  g.beginPath();
  pts.slice(0, shown + 1).forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.stroke();
  g.lineWidth = 1;
  g.strokeStyle = `rgba(255,230,140,${(0.6 + 0.4 * k).toFixed(3)})`;
  g.stroke();
  // Искры из трещины.
  g.fillStyle = `rgba(255,200,90,${(0.8 * k).toFixed(3)})`;
  for (let i = 0; i < 4 + Math.round(k * 6); i++) {
    const t = (time * 2 + i * 0.29) % 1;
    const [x0, y0] = pts[i % pts.length];
    g.fillRect(Math.round(x0 + (hash(i, 7) - 0.5) * 10 * t), Math.round(y0 + S * 0.5 * t), 1, 1);
  }
  if (k > 0.9) {
    g.fillStyle = `rgba(255,240,200,${((k - 0.9) * 6).toFixed(3)})`;
    g.fillRect(Math.round(px - S * 0.5), Math.round(top), S, S);
  }
  return true;
});

registerZonePainter('f5_pher', (g, z, px, py, S, time) => {
  // Метка на герое: розово-фиолетовая дымка у ног и капли, что поднимаются.
  const R = z.r * S;
  const pulse = 0.5 + 0.5 * Math.sin(time * 6);
  g.fillStyle = `rgba(224,112,200,${(0.16 + 0.1 * pulse).toFixed(3)})`;
  g.beginPath();
  g.ellipse(px, py + 1, R, R * 0.45, 0, 0, TAU);
  g.fill();
  g.strokeStyle = `rgba(255,150,230,${(0.45 + 0.3 * pulse).toFixed(3)})`;
  g.lineWidth = 1;
  g.beginPath();
  g.ellipse(px, py + 1, R, R * 0.45, 0, 0, TAU);
  g.stroke();
  g.fillStyle = 'rgba(255,170,235,0.85)';
  for (let i = 0; i < 5; i++) {
    const t = (time * 0.9 + i * 0.2) % 1;
    const a = i * 1.26;
    g.fillRect(Math.round(px + Math.cos(a) * R * 0.7), Math.round(py - t * S * 1.1), 1, 1);
  }
  return true;
});

registerZonePainter('f5_tongue', (g, z, px, py, S) => {
  const zz = z as Zone & { ang?: number; len?: number };
  const t = Math.min(1, zz.t / zz.life);
  // Выстрел и возврат языка.
  const out = t < 0.5 ? t * 2 : (1 - t) * 2;
  const L = (zz.len ?? 3) * S * out;
  const a = zz.ang ?? 0;
  const x1 = px + Math.cos(a) * L;
  const y1 = py - 4 + Math.sin(a) * L;
  g.strokeStyle = 'rgba(120,30,40,0.95)';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(px, py - 4);
  g.lineTo(x1, y1);
  g.stroke();
  g.strokeStyle = 'rgba(232,120,144,1)';
  g.lineWidth = 1.6;
  g.stroke();
  g.fillStyle = 'rgba(240,140,160,1)';
  g.beginPath();
  g.arc(x1, y1, 2.2, 0, TAU);
  g.fill();
  return true;
});

registerZonePainter('f5_spike', (g, z, px, py, S) => {
  const k = kOf(z as ZoneX);
  // Отверстия плиты раскаляются, из них показываются острия.
  const h = Math.round(k * 3);
  g.fillStyle = `rgba(255,70,40,${(0.2 + 0.4 * k).toFixed(3)})`;
  g.fillRect(
    Math.round(px - S * 0.45),
    Math.round(py - S * 0.45),
    Math.round(S * 0.9),
    Math.round(S * 0.9),
  );
  g.fillStyle = 'rgba(200,204,212,1)';
  for (const dy of [-4, 0, 4])
    for (const dx of [-4, 0, 4])
      if (h > 0) g.fillRect(Math.round(px + dx), Math.round(py + dy - h), 1, h);
  return true;
});

registerZonePainter('f5_spikes_up', (g, z, px, py) => {
  const zz = z as Zone;
  const warn = zz.warn ?? 0;
  if (zz.t < warn) return true;
  const t = (zz.t - warn) / zz.life;
  const h = Math.round((t < 0.15 ? t / 0.15 : 1 - Math.max(0, t - 0.5) / 0.5) * 8);
  if (h <= 0) return true;
  // Острые шипы из каждого отверстия: широкие у основания, игла на конце.
  for (const dy of [-3, 0, 3])
    for (const dx of [-3, 0, 3]) {
      const x = Math.round(px + dx);
      const y = Math.round(py + dy);
      for (let k = 0; k < h; k++) {
        const w = k < h * 0.4 ? 1 : 0;
        g.fillStyle = k === h - 1 ? 'rgba(255,255,255,1)' : 'rgba(40,40,46,1)';
        g.fillRect(x - w, y - k, 1 + w * 2, 1);
        if (k < h - 1) {
          g.fillStyle = 'rgba(206,210,220,1)';
          g.fillRect(x, y - k, 1, 1);
        }
      }
    }
  return true;
});

// ---------------------------------------------------------------------------
// Иконки вещей 10×10.
// ---------------------------------------------------------------------------

function meatIcon(meat: Tones, bone: boolean, char = false): Px {
  const p = new Px(10, 10);
  shadeEll(p, 4.5, 5.5, 3.6, 3, meat);
  if (bone) {
    limb(p, 6.5, 3.5, 8.5, 1.5, 0.8, 0.8, BONE);
    p.set(9, 1, BONE[3]);
    p.set(8, 0, BONE[3]);
  }
  if (char) {
    p.set(3, 4, hx('#2a1008'));
    p.set(5, 6, hx('#2a1008'));
  }
  p.outline(INK);
  return p;
}

registerItemArt('f5_hare', () =>
  meatIcon([hx('#8a3a3a'), hx('#c85a5a'), hx('#e88a84'), hx('#f8c0b8')], true),
);
registerItemArt('f5_houndmeat', () =>
  meatIcon([hx('#4a1410'), hx('#7a2418'), hx('#a8402a'), hx('#d86a44')], true, true),
);
registerItemArt('f5_legs', () => {
  const p = new Px(10, 10);
  limb(p, 2, 8, 5, 3, 1.2, 0.9, FR.skin);
  limb(p, 5, 8, 8, 3, 1.2, 0.9, FR.skin);
  shadeEll(p, 5, 3, 1.4, 1, [hx('#a85a5a'), hx('#d88a84'), hx('#f0b0a8'), hx('#ffd8d0')]);
  p.outline(INK);
  return p;
});
registerItemArt('f5_horn', () => {
  const p = new Px(10, 10);
  limb(p, 2, 8.5, 8, 1.5, 1.5, 0.4, RB.horn);
  for (let i = 1; i < 4; i++) p.set(2 + i * 1.5, 8 - i * 1.7, RB.horn[0]);
  p.outline(INK);
  return p;
});
registerItemArt('f5_chitin', () => {
  const p = new Px(10, 10);
  poly(
    p,
    [
      [1, 5],
      [4, 1.5],
      [9, 3],
      [8.5, 7.5],
      [3.5, 8.5],
    ],
    (x, y) => tone(AN.shell, 0.9 - (x + y) * 0.08),
  );
  stroke(p, 3, 4, 7, 6, AN.shell[0]);
  p.outline(INK);
  p.set(4, 3, AN.spec);
  return p;
});
registerItemArt('f5_ember', () => {
  const p = new Px(10, 10);
  shadeEll(p, 5, 5.5, 3.6, 3.2, HD.body);
  p.outline(INK);
  for (const [x, y, c] of [
    [4, 4, HD.emberHi],
    [5, 5, HD.ember],
    [6, 6, HD.emberDk],
    [3, 6, HD.ember],
    [6, 4, HD.ember],
  ] as [number, number, RGBA][])
    p.set(x, y, c);
  return p;
});
registerItemArt('f5_minohorn', () => {
  const p = new Px(10, 10);
  const line = spline(
    [
      [1.5, 8.5],
      [4, 6.5],
      [6.5, 5],
      [8, 2.5],
      [7.5, 0.8],
    ],
    4,
  );
  line.forEach(([x, y], i) => {
    const k = i / (line.length - 1);
    const r = 1.6 * (1 - k) + 0.4;
    if (k > 0.8) p.ell(x, y, r, r, MN.hornTip);
    else shadeEll(p, x, y, r, r, MN.horn);
  });
  p.outline(INK);
  p.set(2, 8, hx('#8a1a14'));
  return p;
});
