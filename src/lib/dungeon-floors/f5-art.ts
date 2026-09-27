// Этаж 5 «Лабиринт» — рисовальщики: монстры, реквизит, свои клетки,
// метки ударов, иконки вещей. Всё рисует код, пиксели 16 на клетку, свет
// сверху-слева, контур тёмный. Кадры собираются один раз и лежат в кеше.
//
// Порядок модулей: этот файл ничего не вызывает из движка при загрузке —
// только регистрирует рисовальщиков. `Px` и холсты создаются, когда кадр
// впервые нужен рендеру.

import { Px } from '../dungeon-art';
import {
  registerCellPainter,
  registerItemArt,
  registerMobPainter,
  registerPropPainter,
  registerZonePainter,
} from '../dungeon-paint';
import type { CellCtx, MobFrame, MobPose, Sprite } from '../dungeon-paint';
import type { Mob, Strike, Zone } from '../dungeon-sim';
import { F5_ARENA, F5_MARK, F5_MAZE } from './f5';

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
const TAU = Math.PI * 2;

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
function stroke(p: Px, x0: number, y0: number, x1: number, y1: number, c: RGBA, w = 1): void {
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
const hash = (a: number, b: number, c = 0) => {
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
// Адская гончая: угольная, по бокам тлеющие трещины, пасть горит. 32×20.
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

interface HoundPose {
  /** Зад и грудь. */
  hx: number;
  hy: number;
  cx: number;
  cy: number;
  /** Голова и морда. */
  headX: number;
  headY: number;
  jaw: number;
  /** Свечение пасти 0…1. */
  glow: number;
  legs: [number, number, number, number][];
  tail: number;
  sleep: boolean;
}

function houndPose(anim: string, f: number): HoundPose {
  const G = 18;
  let hx0 = 10;
  let hy0 = 10.5;
  let cx = 18;
  let cy = 10;
  let headX = 24.5;
  let headY = 7.2;
  let jaw = 0;
  let glow = 0.2;
  let tail = 0;
  let legs: [number, number, number, number][] = [
    [cx + 1, cy + 2, cx + 1.5, G],
    [cx - 1, cy + 2, cx - 1.2, G],
    [hx0 + 1, hy0 + 2, hx0 + 1.5, G],
    [hx0 - 1.5, hy0 + 2, hx0 - 2.5, G],
  ];
  if (anim === 'idle') {
    const b = f % 2 ? 0.4 : 0;
    cy -= b;
    headY -= b + (f === 3 ? 0.5 : 0);
    tail = Math.sin((f / 4) * TAU) * 1.2;
    glow = 0.25 + (f % 2) * 0.1;
  } else if (anim === 'run') {
    const ph = (f / 6) * TAU;
    const st = Math.sin(ph) * 2.2;
    const bob = Math.max(0, Math.sin(ph + 0.9)) * 1.4;
    hx0 -= st * 0.5;
    cx += st * 0.5;
    headX += st * 0.6;
    hy0 -= bob;
    cy -= bob * 0.8;
    headY -= bob * 0.6 - 0.8;
    const fr = Math.cos(ph) * 3.4;
    const hr = -Math.cos(ph) * 3.6;
    const lift = (k: number) => Math.max(0, Math.sin(ph + k)) * 2;
    legs = [
      [cx + 1, cy + 2, cx + 1.5 + fr, G - lift(0.3)],
      [cx - 1, cy + 2, cx - 0.5 + fr * 0.7, G - lift(1)],
      [hx0 + 1, hy0 + 2, hx0 + 1 + hr, G - lift(3.4)],
      [hx0 - 1.5, hy0 + 2, hx0 - 1.5 + hr * 0.7, G - lift(4.1)],
    ];
    tail = -1.5 + Math.sin(ph) * 0.8;
  } else if (anim === 'wind') {
    // Вдох перед пламенем: голова назад-вверх, грудь раздута, пасть горит.
    headX -= 1.5;
    headY -= 2.2;
    cx -= 0.5;
    cy -= 0.8;
    jaw = 0.35 + f * 0.25;
    glow = 0.6 + f * 0.4;
    tail = 1.5;
  } else if (anim === 'breath') {
    // Выдох: голова вытянута вперёд, пасть нараспашку.
    headX += 1.5;
    headY += 0.8;
    cx += 0.6;
    jaw = 1;
    glow = 1;
    tail = -1;
  } else if (anim === 'bite') {
    headX += 2.2;
    headY += 1.4;
    cx += 1.4;
    jaw = f === 0 ? 1 : 0.4;
    glow = 0.5;
    legs[0] = [cx + 1, cy + 2, cx + 4, G];
    legs[3] = [hx0 - 1.5, hy0 + 2, hx0 - 4, G];
  } else if (anim === 'hurt') {
    headX -= 2;
    headY += 1;
    cx -= 1;
    glow = 0.1;
    tail = 2;
  }
  return { hx: hx0, hy: hy0, cx, cy, headX, headY, jaw, glow, legs, tail, sleep: false };
}

function paintHound(hp: HoundPose, anim: string, f: number): Built {
  const W = 32;
  const H = 20;
  const G = 18;
  const p = new Px(W, H);
  if (anim === 'sleep' || anim === 'dead') {
    // Клубком, угли едва тлеют (спит) или гаснут (убит).
    shadeEll(p, 15, 14, 8, 3.8, HD.body);
    shadeEll(p, 21, 12.5, 3.2, 2.4, HD.body);
    limb(p, 7, 14, 4, 11, 0.9, 0.5, HD.body);
    p.outline(INK);
    const e = anim === 'sleep' ? (f % 2 ? HD.ember : HD.emberDk) : HD.emberDk;
    for (const [x, y] of [
      [12, 12],
      [15, 11],
      [18, 12],
      [13, 15],
    ])
      p.set(x, y, e);
    p.set(3, 10, anim === 'sleep' ? HD.emberHi : HD.emberDk);
    return { p, ax: 15, ay: G, eye: null };
  }
  const far = (l: [number, number, number, number]) =>
    limb(p, l[0], l[1], l[2], l[3], 1, 0.6, HD.body, -0.35);
  const near = (l: [number, number, number, number]) => {
    limb(p, l[0], l[1], (l[0] + l[2]) / 2 + 0.8, (l[1] + l[3]) / 2, 1.3, 0.8, HD.body);
    limb(p, (l[0] + l[2]) / 2 + 0.8, (l[1] + l[3]) / 2, l[2], l[3], 0.8, 0.6, HD.body);
    p.set(Math.round(l[2]) + 1, Math.round(l[3]) - 1, HD.body[2]);
  };
  // Хвост с огоньком на кончике.
  const tp = spline(
    [
      [hp.hx - 3.5, hp.hy - 1],
      [hp.hx - 6, hp.hy - 2.5 + hp.tail * 0.5],
      [hp.hx - 7.5, hp.hy - 5.5 + hp.tail],
    ],
    5,
  );
  tp.forEach(([x, y], i) => {
    p.set(Math.floor(x), Math.floor(y), HD.body[1]);
    if (i < tp.length / 2) p.set(Math.floor(x), Math.floor(y) + 1, HD.body[1]);
  });
  const [tx, ty] = tp[tp.length - 1];
  far(hp.legs[1]);
  far(hp.legs[3]);
  // Тело: зад, талия, грудь.
  shadeEll(p, hp.hx, hp.hy, 4.4, 3.4, HD.body);
  limb(p, hp.hx + 1, hp.hy - 0.5, hp.cx - 1, hp.cy - 0.3, 2.4, 3, HD.body);
  shadeEll(p, hp.cx, hp.cy, 4.6, 3.8, HD.body);
  // Шея и голова с длинной мордой.
  limb(p, hp.cx + 2, hp.cy - 1.5, hp.headX - 1, hp.headY + 0.5, 2.4, 2, HD.body);
  shadeEll(p, hp.headX, hp.headY, 3.6, 2.9, HD.body);
  const snX = hp.headX + 5.6;
  const snY = hp.headY + 1 + hp.jaw * 0.6;
  poly(
    p,
    [
      [hp.headX + 1, hp.headY - 1.8],
      [snX, snY - 0.8],
      [snX, snY + 0.6],
      [hp.headX + 1, hp.headY + 1.4],
    ],
    HD.body[1],
  );
  stroke(p, hp.headX + 1, hp.headY - 1.6, snX - 0.5, snY - 1, HD.body[2]);
  // Нижняя челюсть.
  if (hp.jaw > 0.1) {
    const jy = snY + 0.6 + hp.jaw * 2.2;
    poly(
      p,
      [
        [hp.headX + 0.5, hp.headY + 1.4],
        [snX - 0.5, jy],
        [snX - 1, jy + 1],
        [hp.headX, hp.headY + 2.2],
      ],
      HD.body[1],
    );
    poly(
      p,
      [
        [hp.headX + 1.5, hp.headY + 1.5],
        [snX - 0.5, snY + 0.6],
        [snX - 1, jy],
      ],
      HD.maw,
    );
  }
  // Уши — назад, острые.
  poly(
    p,
    [
      [hp.headX - 1.5, hp.headY - 1.5],
      [hp.headX - 4.5, hp.headY - 5],
      [hp.headX + 0.2, hp.headY - 2.2],
    ],
    HD.body[2],
  );
  // Гребень шипов по хребту.
  for (let i = 0; i < 5; i++) {
    const k = i / 4;
    const x = hp.hx + (hp.cx + 1 - hp.hx) * k;
    const y = hp.hy - 3.3 + (hp.cy - hp.hy) * k - (i === 2 ? 0.5 : 0);
    p.set(Math.floor(x), Math.floor(y) - 1, HD.body[2]);
    p.set(Math.floor(x), Math.floor(y) - 2, HD.body[1]);
  }
  near(hp.legs[0]);
  near(hp.legs[2]);
  p.outline(INK);
  // Тлеющие трещины по бокам — рёбра и бедро светятся изнутри, поверх
  // контура, чтобы горели и в темноте.
  const crack = (x0: number, y0: number, dx: number, dy: number, n: number) => {
    for (let i = 0; i < n; i++) {
      const x = Math.floor(x0 + dx * i);
      const y = Math.floor(y0 + dy * i);
      if (!p.solid(x, y)) continue;
      p.set(x, y, i === Math.floor(n / 2) ? HD.emberHi : i % 2 ? HD.ember : HD.emberDk);
    }
  };
  crack(hp.cx - 2.5, hp.cy - 1.5, 0.6, 1, 4);
  crack(hp.cx - 0.5, hp.cy - 2, 0.6, 1, 5);
  crack(hp.cx + 1.6, hp.cy - 1.5, 0.5, 1, 4);
  crack(hp.hx - 1.5, hp.hy - 1.5, 1, 0.6, 4);
  crack(hp.headX - 1.5, hp.headY - 1.2, 1, 0.3, 2);
  // Пасть светится: чем ближе пламя, тем ярче.
  const mx = Math.floor(snX - 1.5);
  const my = Math.floor(snY + 0.6 + hp.jaw);
  if (hp.glow > 0.3) {
    p.set(mx, my, hp.glow > 0.7 ? HD.emberHi : HD.ember);
    p.set(mx - 1, my, HD.ember);
    if (hp.jaw > 0.5) {
      p.set(mx - 1, my + 1, HD.emberHi);
      p.set(mx - 2, my, HD.emberDk);
    }
  }
  // Зубы.
  p.set(Math.floor(snX) - 1, Math.floor(snY) + 1, HD.tooth);
  if (hp.jaw > 0.3) p.set(Math.floor(snX) - 2, Math.floor(snY + 0.6 + hp.jaw * 2.2), HD.tooth);
  // Огонёк хвоста.
  const fl = f % 2;
  p.set(Math.floor(tx), Math.floor(ty), HD.emberHi);
  p.set(Math.floor(tx), Math.floor(ty) - 1, HD.ember);
  p.set(Math.floor(tx) - fl, Math.floor(ty) - 2, HD.emberDk);
  const ex = Math.floor(hp.headX + 0.8);
  const ey = Math.floor(hp.headY - 0.8);
  p.set(ex, ey, HD.eye);
  return { p, ax: Math.round((hp.hx + hp.cx) / 2), ay: G, eye: [ex, ey] };
}

registerMobPainter('f5_hound', (m: Mob, pose: MobPose) => {
  let anim: string = pose.anim;
  let f = pose.frame;
  if (pose.mode === 'breath') {
    const lit = pose.t > 0.62;
    anim = lit ? 'breath' : 'wind';
    f = lit ? 0 : pose.t > 0.35 ? 1 : 0;
  } else if (pose.mode === 'f5_born') {
    const k = Math.min(3, Math.floor((pose.t / 0.8) * 4));
    return frameOf('f5_hound', pose, 'born', k, () =>
      bornFrom(paintHound(houndPose('idle', 0), 'idle', 0), k),
    );
  }
  if (anim === 'run') f = ((f % 6) + 6) % 6;
  else if (anim === 'idle') f = ((f % 4) + 4) % 4;
  else if (anim === 'wind' && pose.mode !== 'breath') f = Math.min(1, Math.max(0, f));
  else if (anim === 'bite') f = Math.min(1, Math.max(0, f));
  else if (anim === 'sleep') f = ((f % 2) + 2) % 2;
  else if (anim !== 'breath') f = 0;
  return frameOf('f5_hound', pose, anim, f, () => paintHound(houndPose(anim, f), anim, f));
});

// ---------------------------------------------------------------------------
// Муравей-убийца: красно-бурый хитин, жвала, шесть лап. 28×17.
// ---------------------------------------------------------------------------

const AN = {
  shell: [hx('#2a0c08'), hx('#5c1c12'), hx('#8e3620'), hx('#d06a40')] as Tones,
  spec: hx('#f6c49a'),
  leg: hx('#2e120a'),
  legHi: hx('#7a3420'),
  jaw: hx('#2c120a'),
  jawTip: hx('#d8c8a0'),
  eye: hx('#0a0404'),
  eyeHi: hx('#ffb070'),
  pher: hx('#e070c8'),
};

interface AntPose {
  gx: number;
  gy: number;
  /** Брюшко приподнято (зовёт). */
  lift: number;
  tx: number;
  ty: number;
  headX: number;
  headY: number;
  jaw: number;
  ant: number;
  legs: number;
  belly: boolean;
}

function antPose(anim: string, f: number): AntPose {
  const ps: AntPose = {
    gx: 7,
    gy: 9,
    lift: 0,
    tx: 14.5,
    ty: 9.5,
    headX: 20.5,
    headY: 8.5,
    jaw: 0.25,
    ant: 0,
    legs: 0,
    belly: false,
  };
  if (anim === 'idle') {
    ps.ant = f % 4;
    ps.gy += f % 2 ? 0.3 : 0;
  } else if (anim === 'run') {
    ps.legs = f % 4;
    ps.ant = f % 2;
    ps.gy += f % 2 ? 0.4 : 0;
    ps.headY += f % 2 ? 0.3 : 0;
  } else if (anim === 'wind') {
    ps.headY -= 1.6;
    ps.headX -= 0.6;
    ps.jaw = 1;
    ps.ant = 2;
  } else if (anim === 'bite') {
    ps.headX += 1.8;
    ps.tx += 0.8;
    ps.headY += 0.6;
    ps.jaw = f === 0 ? 0 : 0.5;
  } else if (anim === 'call') {
    ps.lift = 1;
    ps.gy -= 2.5;
    ps.gx += 0.5;
    ps.ant = 3;
    ps.jaw = f % 2 ? 0.9 : 0.2;
  } else if (anim === 'hurt') {
    ps.headX -= 0.8;
    ps.gx -= 0.6;
    ps.jaw = 0.6;
  }
  return ps;
}

function paintAnt(ap: AntPose, anim: string, f: number): Built {
  const W = 28;
  const H = 17;
  const G = 15;
  const p = new Px(W, H);
  if (anim === 'dead') {
    shadeEll(p, 9, 12, 5, 3, AN.shell);
    shadeEll(p, 15, 12.5, 2.6, 2, AN.shell);
    shadeEll(p, 20, 12.5, 2.6, 2.4, AN.shell);
    for (const x of [12, 14, 16, 18]) stroke(p, x, 10.5, x + (x % 4 ? -1 : 1), 7.5, AN.leg);
    p.outline(INK);
    return { p, ax: 13, ay: G, eye: null };
  }
  // Лапы: три с дальней стороны (темнее), три с ближней. Трёхточечная походка.
  const gait = [0, 1, 0, 1][ap.legs] ?? 0;
  const legX = [ap.tx - 1.8, ap.tx, ap.tx + 1.6];
  const legSpan = [-4.5, 0.5, 5];
  const legAt = (i: number, farSide: boolean) => {
    const x0 = legX[i];
    const y0 = ap.ty + 0.8;
    const phase = (i + (farSide ? 1 : 0)) % 2 === gait ? 1.6 : -1.2;
    const kx = x0 + legSpan[i] * 0.45 + (ap.legs ? phase * 0.6 : 0);
    const ky = ap.ty - 2.2;
    const fx = x0 + legSpan[i] + (ap.legs ? phase : 0);
    const fy = G - (ap.legs && phase > 0 ? 1 : 0);
    const c = farSide ? AN.leg : AN.legHi;
    stroke(p, x0, y0, kx, ky, c);
    stroke(p, kx, ky, fx, fy, c);
    p.set(Math.floor(fx) + (legSpan[i] > 0 ? 1 : -1), Math.floor(fy), c);
  };
  for (let i = 0; i < 3; i++) legAt(i, true);
  // Брюшко с полосами.
  shadeEll(p, ap.gx, ap.gy, 5.4, 3.9, AN.shell);
  for (const k of [-0.35, 0.15]) {
    const bx = ap.gx + k * 5.4;
    for (let y = -3; y <= 3; y++) {
      const yy = Math.round(ap.gy + y);
      if (p.solid(Math.round(bx), yy)) p.set(Math.round(bx), yy, AN.shell[0]);
    }
  }
  // Стебелёк, грудь.
  shadeEll(p, ap.gx + 5.6, ap.gy + 0.6 + ap.lift, 1.3, 1.2, AN.shell);
  shadeEll(p, ap.tx, ap.ty, 2.8, 2.1, AN.shell);
  // Голова и жвала.
  shadeEll(p, ap.headX, ap.headY, 3.1, 2.8, AN.shell);
  const jx = ap.headX + 2.8;
  const jy = ap.headY + 1.2;
  const open = ap.jaw * 1.8;
  const jaws: [number, number][][] = [
    [
      [jx - 0.5, jy - 0.8],
      [jx + 2.5, jy - 1.2 - open],
      [jx + 4, jy - 0.2 - open * 0.5],
      [jx + 1.5, jy + 0.2],
    ],
    [
      [jx - 0.5, jy + 0.6],
      [jx + 2.5, jy + 1.4 + open],
      [jx + 4, jy + 0.6 + open * 0.5],
      [jx + 1.5, jy - 0.2],
    ],
  ];
  for (const j of jaws) poly(p, j, AN.jaw);
  // Усики с изломом.
  for (const [dx, k] of [
    [-0.5, 1],
    [0.8, 0.8],
  ] as const) {
    const a0 = -1.3 - (ap.ant % 2) * 0.25 * k - (ap.ant === 3 ? 0.4 : 0);
    const x0 = ap.headX + dx;
    const y0 = ap.headY - 2.4;
    const x1 = x0 + Math.cos(a0) * 3.5;
    const y1 = y0 + Math.sin(a0) * 3.5;
    stroke(p, x0, y0, x1, y1, AN.legHi);
    stroke(p, x1, y1, x1 + 2.5 * k, y1 + (ap.ant === 2 ? -1.5 : 0.5), AN.legHi);
  }
  for (let i = 0; i < 3; i++) legAt(i, false);
  p.outline(INK);
  // Блики хитина и глаз.
  p.set(Math.floor(ap.gx - 2), Math.floor(ap.gy - 2.5), AN.spec);
  p.set(Math.floor(ap.headX - 1), Math.floor(ap.headY - 1.8), AN.spec);
  const ex = Math.floor(ap.headX + 1);
  const ey = Math.floor(ap.headY - 0.6);
  p.set(ex, ey, AN.eye);
  p.set(ex + 1, ey, AN.eye);
  p.set(ex, ey - 1, AN.eyeHi);
  // Кончики жвал.
  p.set(Math.floor(jx + 3.5), Math.floor(jy - 0.6 - open * 0.5), AN.jawTip);
  p.set(Math.floor(jx + 3.5), Math.floor(jy + 0.6 + open * 0.5), AN.jawTip);
  if (anim === 'call') {
    // Капли феромона с кончика брюшка.
    const bx = ap.gx - 5;
    const by = ap.gy - 1;
    for (let i = 0; i < 4; i++) {
      const a = Math.PI + 0.6 - i * 0.35 + f * 0.2;
      const r = 1.5 + ((i + f) % 3);
      p.set(Math.floor(bx + Math.cos(a) * r), Math.floor(by + Math.sin(a) * r), AN.pher);
    }
  }
  return { p, ax: Math.round(ap.tx - 1), ay: G, eye: [ex, ey] };
}

registerMobPainter('f5_ant', (m: Mob, pose: MobPose) => {
  let anim: string = pose.anim;
  let f = pose.frame;
  if (pose.mode === 'call') {
    anim = 'call';
    f = Math.floor(pose.t * 8) % 2;
  } else if (pose.mode === 'f5_born') {
    const k = Math.min(3, Math.floor((pose.t / 0.8) * 4));
    return frameOf('f5_ant', pose, 'born', k, () =>
      bornFrom(paintAnt(antPose('idle', 0), 'idle', 0), k),
    );
  }
  if (anim === 'run') f = ((f % 4) + 4) % 4;
  else if (anim === 'idle') f = ((f % 4) + 4) % 4;
  else if (anim === 'bite' || anim === 'wind') f = Math.min(1, Math.max(0, f));
  else if (anim === 'sleep') anim = 'idle';
  else if (anim !== 'call') f = 0;
  if (anim === 'sleep') f = 0;
  return frameOf('f5_ant', pose, anim, f, () => paintAnt(antPose(anim, f), anim, f));
});

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
// Минотавр: громадный бык с двуручной секирой. 76×68, смотрит вправо.
// Сложён сверху тяжелее, чем снизу: широкие плечи и грудь, узкий таз,
// бычьи ноги с копытами, голова с широкими рогами. Поза — точки суставов
// (`MinoPose`): бёдра, грудь, голова, кисти, копыта, секира.
// ---------------------------------------------------------------------------

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

type Pt = [number, number];

interface MinoPose {
  hip: Pt;
  chest: Pt;
  head: Pt;
  /** Голова: 0 — прямо, плюс — опущена рогами вперёд, минус — запрокинута. */
  pitch: number;
  jaw: number;
  /** Кисти: ближняя, дальняя. */
  hand: Pt;
  far: Pt;
  /** Копыта: ближнее, дальнее (земля — y 64). */
  hoof: Pt;
  hoofFar: Pt;
  /** Секира: хват, угол рукояти, «за спиной» или «в руках», лежит на полу. */
  axe: { x: number; y: number; a: number; behind: boolean } | null;
  axeFloor: boolean;
  dust: number;
  dustFront: boolean;
  steam: number;
  starsF: number;
  swoosh: 'none' | 'chop' | 'spin';
  spin: number;
  closed: boolean;
}

const MG = 64;

function minoPose(anim: string, f: number): MinoPose {
  const base: MinoPose = {
    hip: [32, 44],
    chest: [35, 29],
    head: [45, 16],
    pitch: 0,
    jaw: 0,
    hand: [47, 41],
    far: [26, 40],
    hoof: [39, MG - 1],
    hoofFar: [27, MG - 1],
    axe: { x: 47, y: 41, a: -2.45, behind: true },
    axeFloor: false,
    dust: 0,
    dustFront: false,
    steam: 0,
    starsF: -1,
    swoosh: 'none',
    spin: 0,
    closed: false,
  };
  const shift = (p: Pt, dx: number, dy: number): Pt => [p[0] + dx, p[1] + dy];
  switch (anim) {
    case 'idle': {
      const b = f % 2 ? 0.7 : 0;
      base.chest = shift(base.chest, 0, b);
      base.head = shift(base.head, 0, b);
      base.hand = shift(base.hand, 0, b * 0.5);
      base.axe = { ...base.axe!, y: base.axe!.y + b * 0.5 };
      base.steam = f === 1 ? 1 : f === 3 ? 2 : 0;
      break;
    }
    case 'walk': {
      const ph = (f / 6) * TAU;
      const s = Math.sin(ph);
      const bob = Math.abs(Math.cos(ph)) * 1.2;
      base.hip = shift(base.hip, 1, -bob);
      base.chest = shift(base.chest, 2, -bob);
      base.head = shift(base.head, 2, -bob + 0.5);
      base.hand = shift(base.hand, 2, -bob);
      base.axe = { ...base.axe!, x: base.hand[0], y: base.hand[1] };
      base.hoof = [39 + s * 5, MG - 1 - Math.max(0, Math.cos(ph)) * 3];
      base.hoofFar = [27 - s * 5, MG - 1 - Math.max(0, -Math.cos(ph)) * 3];
      break;
    }
    case 'aim': {
      // Роет копытом: голова опущена, рога на цель, секира волочится сзади.
      base.hip = [30, 45];
      base.chest = [36, 32];
      base.head = [48, 26];
      base.pitch = 1;
      base.hand = [33, 47];
      base.far = [28, 44];
      base.axe = { x: 33, y: 47, a: 2.75, behind: true };
      base.hoof = f % 2 ? [45, MG - 4] : [43, MG - 1];
      base.hoofFar = [25, MG - 1];
      base.steam = 2;
      base.dust = f % 2 ? 1 : 0;
      base.dustFront = true;
      break;
    }
    case 'gore': {
      const ph = (f / 4) * TAU;
      base.hip = [28, 44 - Math.abs(Math.sin(ph)) * 1.5];
      base.chest = [37, 34];
      base.head = [50, 30];
      base.pitch = 1.3;
      base.hand = [31, 49];
      base.far = [26, 46];
      base.axe = { x: 31, y: 49, a: 2.95, behind: true };
      base.hoof = [36 + Math.sin(ph) * 8, MG - 1 - Math.max(0, Math.cos(ph)) * 4];
      base.hoofFar = [24 - Math.sin(ph) * 8, MG - 1 - Math.max(0, -Math.cos(ph)) * 4];
      base.dust = 2;
      break;
    }
    case 'skid':
      base.hip = [32, 45];
      base.chest = [31, 30];
      base.head = [41, 20];
      base.pitch = 0.4;
      base.hand = [30, 44];
      base.axe = { x: 30, y: 44, a: 2.7, behind: true };
      base.hoof = [46, MG - 1];
      base.hoofFar = [38, MG - 1];
      base.dust = 3;
      base.dustFront = true;
      break;
    case 'dizzy':
      // Врезался: оглушён, голова свесилась, секира на полу, звёзды.
      base.hip = [31, 46];
      base.chest = [33, 32];
      base.head = [42, 25 + (f % 2) * 0.7];
      base.pitch = 0.8;
      base.jaw = 0.35;
      base.hand = [40, 46];
      base.far = [27, 45];
      base.axe = null;
      base.axeFloor = true;
      base.starsF = f;
      base.closed = true;
      break;
    case 'raise':
      // Секира занесена за голову обеими руками.
      base.chest = [33, 29];
      base.head = [43, 17];
      base.pitch = -0.25;
      base.jaw = 0.35;
      base.hand = [33 - f, 12 - f];
      base.far = [29 - f, 14 - f];
      base.axe = { x: 33 - f, y: 12 - f, a: -2.6 - f * 0.2, behind: true };
      break;
    case 'chop':
      // Удар: секира впереди, лезвием в полу.
      base.hip = [32, 46];
      base.chest = [38, 33];
      base.head = [47, 24];
      base.pitch = 0.7;
      base.jaw = 0.6;
      base.hand = [50, 42];
      base.far = [45, 40];
      base.axe = { x: 50, y: 42, a: f === 0 ? -0.2 : 0.5, behind: false };
      base.swoosh = f === 0 ? 'chop' : 'none';
      base.dust = f === 1 ? 2 : 0;
      base.dustFront = true;
      base.hoof = [42, MG - 1];
      break;
    case 'spinUp':
      base.chest = [34, 30];
      base.head = [44, 18];
      base.hand = [52, 30];
      base.far = [46, 31];
      base.jaw = 0.4;
      base.axe = { x: 52, y: 30, a: -0.15, behind: false };
      break;
    case 'spin': {
      const a = -0.15 + (f / 4) * TAU;
      base.chest = [34, 30];
      base.head = [44, 18];
      base.hand = [34 + Math.cos(a) * 14, 32 + Math.sin(a) * 5];
      base.far = [34 + Math.cos(a) * 9, 32 + Math.sin(a) * 4];
      base.jaw = 0.6;
      base.axe = { x: base.hand[0], y: base.hand[1], a, behind: Math.sin(a) < -0.2 };
      base.swoosh = 'spin';
      base.spin = a;
      break;
    }
    case 'roar':
      // Рёв: голова запрокинута, пасть настежь, руки в стороны.
      base.chest = [33, 29 + (f % 2) * 0.5];
      base.head = [41, 14];
      base.pitch = -1;
      base.jaw = 1;
      base.hand = [53, 38];
      base.far = [19, 30];
      base.axe = { x: 53, y: 38, a: 0.35, behind: false };
      base.steam = 3;
      break;
    case 'hurt':
      base.chest = [32, 30];
      base.head = [40, 18];
      base.pitch = -0.3;
      base.closed = true;
      base.hand = [44, 42];
      base.axe = { ...base.axe!, x: 44, y: 42 };
      break;
    case 'dead':
      base.hip = [31, 54];
      base.chest = [38, 45];
      base.head = [49, 44];
      base.pitch = 1.2;
      base.hand = [44, 58];
      base.far = [30, 58];
      base.hoof = [40, MG - 1];
      base.hoofFar = [24, MG - 1];
      base.axe = null;
      base.axeFloor = true;
      base.closed = true;
      break;
  }
  return base;
}

/** Секира: рукоять от хвата (x, y) по углу, двойное лезвие на конце. */
function paintAxe(p: Px, x: number, y: number, a: number, len = 30): void {
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const ex = x + ux * len;
  const ey = y + uy * len;
  // Рукоять с оковкой, торчит за хватом.
  limb(p, x - ux * 5, y - uy * 5, ex, ey, 1.2, 1.2, MN.haft);
  for (const k of [-4, 3, 8])
    stroke(
      p,
      x + ux * k - uy * 1.3,
      y + uy * k + ux * 1.3,
      x + ux * k + uy * 1.3,
      y + uy * k - ux * 1.3,
      MN.iron[1],
    );
  // Два полумесяца поперёк рукояти.
  const nx = -uy;
  const ny = ux;
  const bx = ex - ux * 2.5;
  const by = ey - uy * 2.5;
  for (const side of [1, -1]) {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 10; i++) {
      const k = i / 10;
      const along = -6 + k * 12;
      const out = 1.6 + Math.sin(k * Math.PI) * 7.5;
      pts.push([bx + ux * along + nx * side * out, by + uy * along + ny * side * out]);
    }
    pts.push([bx + ux * 2.5 + nx * side * 1.5, by + uy * 2.5 + ny * side * 1.5]);
    pts.push([bx - ux * 2.5 + nx * side * 1.5, by - uy * 2.5 + ny * side * 1.5]);
    poly(p, pts, (px, py) => {
      const d = (px + 0.5 - bx) * nx * side + (py + 0.5 - by) * ny * side;
      const along = (px + 0.5 - bx) * ux + (py + 0.5 - by) * uy;
      const out = 1.6 + Math.sin(((along + 6) / 12) * Math.PI) * 7.5;
      if (d > out - 1.3) return MN.edge;
      const l = (px + 0.5 - bx) * LX + (py + 0.5 - by) * LY;
      return tone(MN.steel, 0.3 + l * 0.1 + (d / 9) * 0.5);
    });
    // Зазубрина и старая кровь у кромки.
    const cx = bx + nx * side * 7.6 + ux * (side * 1.5);
    const cy = by + ny * side * 7.6 + uy * (side * 1.5);
    clear(p, Math.floor(cx), Math.floor(cy));
    p.set(Math.floor(cx - nx * side * 1.5), Math.floor(cy - ny * side * 1.5), MN.blood);
  }
  // Втулка с шипом на конце.
  shadeEll(p, bx, by, 2.2, 2.2, MN.iron, 0.1);
  limb(p, ex, ey, ex + ux * 3, ey + uy * 3, 1, 0.3, MN.iron);
}

/** Сустав двухзвенной конечности: середина, сдвинутая вбок на изгиб. */
function joint(a: Pt, b: Pt, len: number, bend: number): Pt {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const d = Math.hypot(dx, dy) || 1;
  const half = Math.min(len / 2, d / 2 + 6);
  const off = Math.sqrt(Math.max(0, half * half - (d / 2) * (d / 2)));
  return [(a[0] + b[0]) / 2 + (-dy / d) * off * bend, (a[1] + b[1]) / 2 + (dx / d) * off * bend];
}

/** Поля кадра: рога, секира над головой и вихрь не должны резаться. */
const MOX = 6;
const MOY = 12;

function paintMino(mp0: MinoPose, anim: string): Built {
  const W = 88;
  const H = 80;
  const p = new Px(W, H);
  const o = (q: Pt): Pt => [q[0] + MOX, q[1] + MOY];
  const mp: MinoPose = {
    ...mp0,
    hip: o(mp0.hip),
    chest: o(mp0.chest),
    head: o(mp0.head),
    hand: o(mp0.hand),
    far: o(mp0.far),
    hoof: o(mp0.hoof),
    hoofFar: o(mp0.hoofFar),
    axe: mp0.axe ? { ...mp0.axe, x: mp0.axe.x + MOX, y: mp0.axe.y + MOY } : null,
  };
  const MG = 64 + MOY;
  const [hx0, hy0] = mp.hip;
  const [cx, cy] = mp.chest;
  const lean = cx - hx0;
  const shN: Pt = [cx + 6, cy - 6];
  const shF: Pt = [cx - 7, cy - 7];
  const dark = (t: Tones): Tones => [t[0], t[0], t[1], t[2]];

  // Бычьи ноги: бедро вперёд к колену, скакательный сустав назад, копыто.
  const leg = (hoof: Pt, far: boolean) => {
    const hipP: Pt = [hx0 + (far ? -4 : 4), hy0 + 1];
    const knee: Pt = [
      hipP[0] + (hoof[0] - hipP[0]) * 0.4 + 4,
      hipP[1] + (hoof[1] - hipP[1]) * 0.45,
    ];
    const hock: Pt = [
      hipP[0] + (hoof[0] - hipP[0]) * 0.72 - 2.5,
      hipP[1] + (hoof[1] - hipP[1]) * 0.78,
    ];
    const t = far ? dark(MN.fur) : MN.fur;
    limb(p, hipP[0], hipP[1], knee[0], knee[1], far ? 5 : 5.6, 3.8, t, far ? -0.3 : 0);
    limb(p, knee[0], knee[1], hock[0], hock[1], 3.6, 2.4, t, far ? -0.3 : 0);
    limb(p, hock[0], hock[1], hoof[0], hoof[1] - 2, 2.4, 2, t, far ? -0.3 : 0);
    // Лохмы над копытом и копыто.
    shadeEll(p, hoof[0], hoof[1] - 2.5, 2.8, 1.4, t, -0.1);
    shadeEll(p, hoof[0] + 0.6, hoof[1] - 0.6, 3, 1.6, MN.hoof);
  };
  if (mp.axe?.behind) paintAxe(p, mp.axe.x, mp.axe.y, mp.axe.a);
  if (mp.axeFloor)
    paintAxe(p, (anim === 'dead' ? 30 : 50) + MOX, MG - 3, anim === 'dead' ? 0.1 : -0.05, 24);
  leg(mp.hoofFar, true);
  // Хвост с кисточкой.
  const tl = spline(
    [
      [hx0 - 6, hy0 - 3],
      [hx0 - 10, hy0 + 2],
      [hx0 - 11, hy0 + 8],
    ],
    5,
  );
  tl.forEach(([x, y]) => {
    p.set(Math.floor(x), Math.floor(y), MN.fur[1]);
    p.set(Math.floor(x) + 1, Math.floor(y), MN.fur[0]);
  });
  shadeEll(p, hx0 - 11, hy0 + 10, 1.4, 2.2, MN.fur, -0.2);
  // Дальняя рука: плечо — локоть — кулак.
  const elF = joint(shF, mp.far, 22, -1);
  limb(p, shF[0], shF[1], elF[0], elF[1], 4, 3.2, dark(MN.skin), -0.2);
  limb(p, elF[0], elF[1], mp.far[0], mp.far[1], 3.2, 2.6, dark(MN.skin), -0.2);
  shadeEll(p, mp.far[0], mp.far[1], 2.6, 2.4, dark(MN.skin));
  // Таз, живот, грудь, плечи — сверху шире, чем снизу.
  shadeEll(p, hx0, hy0 - 1, 7.5, 5.5, MN.skin);
  limb(p, hx0 + lean * 0.2, hy0 - 3, cx, cy + 3, 6.5, 8.5, MN.skin);
  shadeEll(p, cx, cy, 11, 8, MN.skin);
  // Грудные и пресс.
  const pec = (dx: number) => shadeEll(p, cx + dx, cy - 1.5, 5, 3.6, MN.skin, 0.12);
  pec(-3.5);
  pec(4);
  for (let i = 0; i < 3; i++) {
    const y = cy + 4 + i * 3;
    const x = cx + 1 - (lean > 2 ? 0 : i * 0.3);
    p.set(Math.floor(x), Math.floor(y), MN.skin[0]);
    p.set(Math.floor(x) - 2, Math.floor(y) + 1, MN.skin[1]);
    p.set(Math.floor(x) + 2, Math.floor(y) + 1, MN.skin[1]);
  }
  // Дальнее плечо.
  shadeEll(p, shF[0], shF[1] + 1, 5, 4.2, dark(MN.skin));
  // Перевязь через грудь.
  stroke(p, shN[0] - 1, shN[1] + 1, hx0 - 5, hy0 - 3, MN.cloth[1], 2);
  stroke(p, shN[0] - 1, shN[1], hx0 - 5, hy0 - 4, MN.cloth[2]);
  // Пояс и набедренник.
  const bY = hy0 - 2;
  limb(p, hx0 - 8, bY, hx0 + 8, bY - 0.5, 1.8, 1.8, MN.cloth);
  poly(
    p,
    [
      [hx0 - 6, bY + 1],
      [hx0 + 7, bY + 0.5],
      [hx0 + 5, bY + 11],
      [hx0 + 1, bY + 9],
      [hx0 - 4, bY + 11],
    ],
    (x, y) => tone(MN.cloth, 0.55 - (y - bY) * 0.05 + ((x * 3 + y) % 5 === 0 ? -0.45 : 0)),
  );
  shadeEll(p, hx0 + 1, bY - 0.2, 2.2, 1.9, [MN.brassDk, MN.brassDk, MN.brass, hx('#fff0b0')]);
  leg(mp.hoof, false);
  // Холка и грива — тёмная шерсть от плеч к голове.
  const [gx, gy] = mp.head;
  limb(p, cx - 2, cy - 7, gx - 3, gy + 2, 6.5, 5, MN.fur);
  // Голова: дальний рог, череп, уши, морда, ближний рог.
  const pitch = mp.pitch;
  const horn = (far: boolean) => {
    const sx = gx + (far ? -4 : 2.5);
    const sy = gy - 4;
    const dir = far ? -1 : 1;
    const up = pitch < 0 ? -pitch : 0;
    const fwd = Math.max(0, pitch);
    const pts: Pt[] = [
      [sx, sy],
      [sx + dir * 6 + fwd * 3, sy - 1 + fwd * 3 + up],
      [sx + dir * 9 + fwd * 7, sy - 5 + fwd * 4 - up * 2],
      [sx + dir * 8 + fwd * 11, sy - 10 + fwd * 5 - up * 3],
    ];
    const line = spline(pts, 5);
    line.forEach(([x, y], i) => {
      const k = i / (line.length - 1);
      const r = 2.3 * (1 - k) + 0.5;
      if (k > 0.82) p.ell(x, y, r, r, MN.hornTip);
      else shadeEll(p, x, y, r, r, far ? dark(MN.horn) : MN.horn);
    });
  };
  horn(true);
  shadeEll(p, gx, gy, 6.2, 5.6, MN.fur);
  // Чёлка-вихор между рогами.
  for (let i = 0; i < 4; i++)
    p.set(Math.floor(gx - 2 + i * 1.3), Math.floor(gy - 5 - (i % 2)), MN.fur[2]);
  // Уши в стороны.
  poly(
    p,
    [
      [gx - 4.5, gy - 1.5],
      [gx - 10, gy - 3 + pitch * 2],
      [gx - 5, gy + 1],
    ],
    MN.fur[2],
  );
  p.set(Math.floor(gx - 8), Math.floor(gy - 2 + pitch * 2), MN.muzzle[1]);
  // Морда: вперёд, при наклоне — вниз.
  const snX = gx + 7 - Math.max(0, pitch) * 2 + Math.min(0, pitch) * 1.5;
  const snY = gy + 3 + pitch * 4.5;
  limb(p, gx + 2, gy + 0.5, snX - 1.5, snY - 1, 4, 3.4, MN.fur, 0.1);
  shadeEll(p, snX, snY, 4.2, 3.4, MN.muzzle);
  if (mp.jaw > 0.1) {
    const jy = snY + 2.2 + mp.jaw * 3.5;
    poly(
      p,
      [
        [snX - 4, snY + 1.5],
        [snX + 3, snY + 1],
        [snX + 2.5, jy + 1],
        [snX - 3, jy],
      ],
      MN.maw,
    );
    shadeEll(p, snX - 0.5, jy + 1, 3.4, 1.5, MN.muzzle);
    p.set(Math.floor(snX + 1.5), Math.floor(snY + 2), MN.tooth);
    p.set(Math.floor(snX - 1.5), Math.floor(snY + 2), MN.tooth);
  }
  horn(false);
  // Ближняя рука: плечо — локоть — кулак; наруч на предплечье.
  if (mp.axe && !mp.axe.behind) paintAxe(p, mp.axe.x, mp.axe.y, mp.axe.a);
  const elN = joint(shN, mp.hand, 24, lean < -1 ? 1 : -1);
  shadeEll(p, shN[0], shN[1] + 1, 5.4, 4.6, MN.skin, 0.05);
  limb(p, shN[0], shN[1] + 1, elN[0], elN[1], 4.2, 3.4, MN.skin);
  limb(p, elN[0], elN[1], mp.hand[0], mp.hand[1], 3.4, 2.8, MN.skin);
  const bxm = elN[0] + (mp.hand[0] - elN[0]) * 0.55;
  const bym = elN[1] + (mp.hand[1] - elN[1]) * 0.55;
  limb(
    p,
    bxm - (mp.hand[0] - elN[0]) * 0.2,
    bym - (mp.hand[1] - elN[1]) * 0.2,
    bxm + (mp.hand[0] - elN[0]) * 0.2,
    bym + (mp.hand[1] - elN[1]) * 0.2,
    3.6,
    3.2,
    MN.iron,
  );
  shadeEll(p, mp.hand[0], mp.hand[1], 2.8, 2.6, MN.skin, 0.1);
  // Наплечник: железная пластина с шипом.
  shadeEll(p, shN[0] + 0.5, shN[1] - 1, 4.6, 2.6, MN.iron, 0.1);
  poly(
    p,
    [
      [shN[0] - 1, shN[1] - 3],
      [shN[0] + 1, shN[1] - 8],
      [shN[0] + 2.5, shN[1] - 3],
    ],
    MN.iron[2],
  );
  p.outline(INK);
  // После контура: ноздри, кольцо, глаз, заклёпки, пар, пыль, звёзды, вихрь.
  const nx = Math.floor(snX + 2.4);
  const ny = Math.floor(snY - 0.8);
  p.set(nx, ny, MN.nostril);
  p.set(nx - 2, ny, MN.nostril);
  p.set(nx, ny + 2, MN.ring);
  p.set(nx - 1, ny + 3, MN.ring);
  p.set(nx - 2, ny + 2, MN.ring);
  p.set(Math.floor(shN[0]), Math.floor(shN[1] - 1), MN.iron[3]);
  p.set(Math.floor(shN[0] + 2), Math.floor(shN[1] - 1), MN.iron[3]);
  const ex = Math.floor(gx + 3);
  const ey = Math.floor(gy - 1 + pitch * 1.5);
  // Надбровье нависает над глазом.
  p.set(ex - 1, ey - 1, MN.fur[0]);
  p.set(ex, ey - 1, MN.fur[0]);
  p.set(ex + 1, ey - 1, MN.fur[0]);
  if (mp.closed) {
    p.set(ex - 1, ey, INK);
    p.set(ex, ey, INK);
    p.set(ex + 1, ey, INK);
  } else {
    p.set(ex, ey, MN.eye);
    p.set(ex + 1, ey, MN.eye);
    p.set(ex - 1, ey, hx('#8a1a10'));
  }
  if (mp.steam) {
    for (let i = 0; i < 2 + mp.steam; i++)
      p.set(nx + 2 + i, ny + 1 + ((i + mp.steam) % 2) - (i >> 1), alpha(MN.steam, 0.8 - i * 0.12));
  }
  if (mp.dust) {
    const x0 = mp.dustFront ? mp.hoof[0] - 2 : Math.min(mp.hoof[0], mp.hoofFar[0]) - 16;
    for (let i = 0; i < 5 + mp.dust * 4; i++) {
      const x = x0 + hash(i, mp.dust, 3) * 16;
      const y = MG - 1 - hash(i, 9) * (3 + mp.dust * 1.5);
      p.set(Math.floor(x), Math.floor(y), MN.dust);
      if (i % 3 === 0) p.set(Math.floor(x) + 1, Math.floor(y), MN.dust);
    }
  }
  if (mp.starsF >= 0) stars(p, gx - 1, gy - 13, 8, mp.starsF);
  if (mp.swoosh === 'chop') {
    for (let i = 0; i < 18; i++) {
      const k = i / 17;
      const ang = -2.2 + k * 2.3;
      p.set(
        Math.floor(mp.hand[0] - 6 + Math.cos(ang) * 30),
        Math.floor(mp.hand[1] + Math.sin(ang) * 30),
        alpha(WHITE, 0.8 - k * 0.35),
      );
    }
  }
  if (mp.swoosh === 'spin') {
    for (let i = 0; i < 28; i++) {
      const a = mp.spin - (i / 28) * 2.4;
      p.set(
        Math.floor(34 + MOX + Math.cos(a) * 36),
        Math.floor(33 + MOY + Math.sin(a) * 12),
        alpha(WHITE, 0.75 - (i / 28) * 0.6),
      );
    }
  }
  return { p, ax: 33 + MOX, ay: MG, eye: mp.closed ? null : [ex, ey] };
}

registerMobPainter('f5_minotaur', (m: Mob, pose: MobPose) => {
  const mode = pose.mode;
  const t = pose.t;
  let anim = 'idle';
  let f = 0;
  const haste = m.data?.haste ?? 1;
  switch (mode) {
    case 'roar':
    case 'bellow':
      anim = 'roar';
      f = Math.floor(t * 10) % 2;
      break;
    case 'aim':
      anim = 'aim';
      f = Math.floor(t * 7) % 2;
      break;
    case 'gore':
      anim = 'gore';
      f = Math.floor(t * 14) % 4;
      break;
    case 'skid':
      anim = 'skid';
      break;
    case 'dizzy':
      anim = 'dizzy';
      f = Math.floor(t * 6) % 4;
      break;
    case 'axe': {
      const T = 0.85 / haste;
      if (t < T * 0.9) {
        anim = 'raise';
        f = t < T * 0.35 ? 0 : t < T * 0.7 ? 1 : 2;
      } else {
        anim = 'chop';
        f = t < T + 0.12 ? 0 : 1;
      }
      break;
    }
    case 'whirl':
      if (t < 0.9 / haste - 0.1) anim = 'spinUp';
      else {
        anim = 'spin';
        f = Math.floor(t * 16) % 4;
      }
      break;
    case 'recover':
      anim = t < 0.35 && m.data?.chopped ? 'chop' : 'idle';
      f = anim === 'chop' ? 1 : Math.floor(t * 4) % 4;
      break;
    default:
      if (pose.anim === 'dead') anim = 'dead';
      else if (pose.anim === 'hurt') anim = 'hurt';
      else if (pose.anim === 'run') {
        anim = 'walk';
        f = ((pose.frame % 6) + 6) % 6;
      } else f = ((pose.frame % 4) + 4) % 4;
  }
  return frameOf('f5_minotaur', pose, anim, f, () => paintMino(minoPose(anim, f), anim));
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

type ZoneX = (Zone | Strike) & { ang?: number; len?: number; arc?: number };

const rgba = (c: RGBA, a: number) =>
  `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a)).toFixed(3)})`;

/** Сектор (конус) из центра. */
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

/** Метка удара наливается: `k` 0…1. */
const kOf = (z: ZoneX) => {
  const s = z as Strike;
  if ('warn' in s && typeof s.warn === 'number' && s.warn > 0) return Math.min(1, s.t / s.warn);
  return 1;
};

registerZonePainter('f5_fire', (g, z, px, py, S, time) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const R = zz.r * S;
  const a = zz.ang ?? 0;
  const arc = zz.arc ?? 1;
  cone(g, px, py, R, a, arc);
  g.fillStyle = rgba(FIRE[0], 0.14 + 0.24 * k);
  g.fill();
  // Кромка конуса разгорается к удару.
  g.strokeStyle = rgba(FIRE[2], 0.35 + 0.6 * k);
  g.lineWidth = 1;
  g.beginPath();
  g.arc(px, py, R * (0.35 + 0.65 * k), a - arc / 2, a + arc / 2);
  g.stroke();
  // Угольки летят к краю.
  g.fillStyle = rgba(FIRE[3], 0.5 + 0.4 * k);
  for (let i = 0; i < 7; i++) {
    const t = (time * 1.6 + i * 0.37) % 1;
    const aa = a + (hash(i, 3) - 0.5) * arc;
    const r = R * t * k;
    g.fillRect(Math.round(px + Math.cos(aa) * r), Math.round(py + Math.sin(aa) * r), 1, 1);
  }
  return true;
});

registerZonePainter('f5_flame', (g, z, px, py, S, time) => {
  const zz = z as ZoneX;
  const life = (zz as Zone).life || 0.45;
  const t = Math.min(1, (zz as Zone).t / life);
  const R = zz.r * S;
  const a = zz.ang ?? 0;
  const arc = 0.95;
  const reach = Math.min(1, t * 4);
  const fade = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
  // Струя пламени: комья огня по конусу, у пасти белые, к краю красные,
  // пляшут каждый кадр. Плотные — это удар, а не подсветка.
  const seed = Math.floor(time * 24);
  for (let i = 0; i < 26; i++) {
    const k = (i + 0.5) / 26;
    const d = R * k * reach;
    const spread = (hash(i, seed) - 0.5) * arc * (0.35 + k * 0.65);
    const x = px + Math.cos(a + spread) * d;
    const y = py - 3 + Math.sin(a + spread) * d;
    const r = 1.5 + k * 3.2 + hash(i, seed, 2) * 1.5;
    const col = k < 0.2 ? FIRE[3] : k < 0.5 ? FIRE[2] : k < 0.8 ? FIRE[1] : FIRE[0];
    g.fillStyle = rgba(col, 0.9 * fade);
    g.beginPath();
    g.arc(Math.round(x), Math.round(y), r, 0, TAU);
    g.fill();
  }
  // Искры и дым на краю струи.
  g.fillStyle = rgba(FIRE[3], fade);
  for (let i = 0; i < 8; i++) {
    const aa = a + (hash(i, seed, 5) - 0.5) * arc;
    const d = R * (0.7 + hash(i, 4) * 0.4) * reach;
    g.fillRect(Math.round(px + Math.cos(aa) * d), Math.round(py - 5 + Math.sin(aa) * d), 1, 1);
  }
  return true;
});

registerZonePainter('f5_axe', (g, z, px, py, S) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const R = zz.r * S;
  const a = zz.ang ?? 0;
  const arc = zz.arc ?? 2.3;
  cone(g, px, py, R, a, arc);
  g.fillStyle = `rgba(160,20,10,${(0.16 + 0.3 * k).toFixed(3)})`;
  g.fill();
  // Трещины по полу к краю удара.
  g.strokeStyle = `rgba(40,6,4,${(0.4 + 0.5 * k).toFixed(3)})`;
  g.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    const aa = a - arc / 2 + ((i + 0.5) / 5) * arc;
    g.beginPath();
    g.moveTo(px + Math.cos(aa) * R * 0.3, py + Math.sin(aa) * R * 0.3);
    g.lineTo(
      px + Math.cos(aa + 0.08) * R * (0.3 + 0.7 * k),
      py + Math.sin(aa + 0.08) * R * (0.3 + 0.7 * k),
    );
    g.stroke();
  }
  g.strokeStyle = `rgba(255,${Math.round(90 + 120 * k)},60,${(0.5 + 0.5 * k).toFixed(3)})`;
  g.beginPath();
  g.arc(px, py, R, a - arc / 2, a + arc / 2);
  g.stroke();
  return true;
});

registerZonePainter('f5_whirl', (g, z, px, py, S, time) => {
  const k = kOf(z as ZoneX);
  const R = z.r * S;
  g.fillStyle = `rgba(170,20,10,${(0.12 + 0.28 * k).toFixed(3)})`;
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.fill();
  // Кольцо из штрихов крутится — видно, что сейчас пойдёт вкруговую.
  g.strokeStyle = `rgba(255,200,120,${(0.4 + 0.6 * k).toFixed(3)})`;
  g.lineWidth = 1;
  for (let i = 0; i < 8; i++) {
    const a0 = time * 6 * (0.5 + k) + (i / 8) * TAU;
    g.beginPath();
    g.arc(px, py, R, a0, a0 + 0.4);
    g.stroke();
  }
  return true;
});

registerZonePainter('f5_roar', (g, z, px, py, S, time) => {
  const k = kOf(z as ZoneX);
  const R = z.r * S;
  g.fillStyle = `rgba(255,220,90,${(0.08 + 0.18 * k).toFixed(3)})`;
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.fill();
  // Волны рёва сходятся к быку — круг оглушения.
  g.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    const t = 1 - ((time * 1.8 + i / 3) % 1);
    g.strokeStyle = `rgba(255,236,140,${(0.25 + 0.5 * k * t).toFixed(3)})`;
    g.beginPath();
    g.arc(px, py, R * t, 0, TAU);
    g.stroke();
  }
  g.strokeStyle = `rgba(255,240,160,${(0.6 + 0.4 * k).toFixed(3)})`;
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.stroke();
  return true;
});

registerZonePainter('f5_rift', (g, z, px, py, S, time) => {
  const zz = z as Zone & { ang?: number };
  const warn = zz.warn ?? 0;
  const life = zz.life;
  const on = zz.t >= warn;
  const fade = Math.min(1, (warn + life - zz.t) / 0.8);
  const a = (zz.ang ?? 0) + Math.PI / 2;
  const L = zz.r * S * 1.3;
  // Трещина поперёк удара.
  g.strokeStyle = `rgba(20,4,2,${(0.9 * fade).toFixed(3)})`;
  g.lineWidth = 2;
  g.beginPath();
  for (let i = 0; i <= 6; i++) {
    const k = i / 6 - 0.5;
    const j = (hash(i, zz.id) - 0.5) * 3;
    const x = px + Math.cos(a) * L * k * 2 + Math.cos(a + Math.PI / 2) * j;
    const y = py + Math.sin(a) * L * k * 2 + Math.sin(a + Math.PI / 2) * j;
    if (i) g.lineTo(x, y);
    else g.moveTo(x, y);
  }
  g.stroke();
  if (!on) return true;
  // Огонь в трещине.
  for (let i = 0; i < 5; i++) {
    const k = i / 4 - 0.5;
    const x = px + Math.cos(a) * L * k * 1.8;
    const y = py + Math.sin(a) * L * k * 1.8;
    const h = 3 + ((time * 9 + i * 1.7) % 3);
    g.fillStyle = `rgba(255,120,30,${(0.8 * fade).toFixed(3)})`;
    g.fillRect(Math.round(x) - 1, Math.round(y - h), 2, Math.round(h));
    g.fillStyle = `rgba(255,230,120,${(0.9 * fade).toFixed(3)})`;
    g.fillRect(Math.round(x), Math.round(y - h + 1), 1, Math.round(h * 0.6));
  }
  return true;
});

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
