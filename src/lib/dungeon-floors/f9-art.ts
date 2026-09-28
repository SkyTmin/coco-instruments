// Этаж 9 «Лабиринт гидры» — рисовальщики: монстры, гидра и её шеи,
// реквизит (круги, грибы, кристаллы, жаровни…), свои клетки трёх районов,
// метки ударов и лужи, снаряды, иконки вещей. Всё рисует код: пиксели 16 на
// клетку, свет сверху-слева, контур тёмный. Кадры собираются один раз и
// лежат в кеше (ключ — вид, поза, кадр, сторона, вспышка, облик).
//
// Палитра — ступени камня 0x72 и болотная зелень; два акцента этажа:
// кислотная зелень яда и лиловый свет кругов. Стихии голов гидры — свои
// цвета, но только на голове и шее.
//
// Этот файл ничего не зовёт из движка при загрузке — только регистрирует
// рисовальщиков. Холсты создаются, когда кадр впервые нужен рендеру.

import { Px, TS } from '../dungeon-art';
import {
  registerCellPainter,
  registerItemArt,
  registerMobPainter,
  registerPropPainter,
  registerShotPainter,
  registerZonePainter,
} from '../dungeon-paint';
import type { CellCtx, MobFrame, MobPose, Sprite } from '../dungeon-paint';
import type { Mob, Shot, Strike, Zone } from '../dungeon-sim';
import type { WorldObj } from '../dungeon-world';
import { F9_LAIR, F9_MARK, F9_MAZE, F9_RUINS, isBogMark, isRingMark, isWaterMark } from './f9';
import { F9_VIEW, RS } from './f9-brains';

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
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

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

const T = (a: string, b: string, c: string, d: string): Tones => [hx(a), hx(b), hx(c), hx(d)];

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

/** Цепочка капсул по точкам: хвост, шея, щупальце. */
function chain(p: Px, pts: [number, number][], r0: number, r1: number, t: Tones, bias = 0): void {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = i / (pts.length - 1);
    const b = (i + 1) / (pts.length - 1);
    limb(p, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], r0 + (r1 - r0) * a, r0 + (r1 - r0) * b, t, bias);
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

/** Стереть пиксель. */
function clear(p: Px, x: number, y: number): void {
  if (x < 0 || y < 0 || x >= p.w || y >= p.h) return;
  p.data[(y * p.w + x) * 4 + 3] = 0;
}

/** Детерминированный шум 0…1 по трём числам. */
const hash = (a: number, b: number, c = 0) => {
  let h = (a * 374761393 + b * 668265263 + c * 1274126177) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** Чешуя: тёмные «полумесяцы» шахматкой поверх уже закрашенной формы. */
function scales(p: Px, x0: number, y0: number, x1: number, y1: number, dk: RGBA, lt: RGBA | null, seed = 0): void {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      if (!p.solid(x, y)) continue;
      const row = Math.floor(y / 2);
      const col = Math.floor((x + (row % 2) * 1) / 2);
      if ((x + row) % 2 === 0 && y % 2 === 1 && hash(col, row, seed) > 0.25) p.set(x, y, dk);
      else if (lt && (x + row) % 2 === 1 && y % 2 === 0 && hash(col, row, seed + 7) > 0.7) p.set(x, y, lt);
    }
}

/** Дизер-растворение: доля k пикселей исчезает (растворился, телепорт). */
function dissolve(p: Px, k: number, seed = 1): Px {
  const q = new Px(p.w, p.h);
  q.data.set(p.data);
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5][(y % 4) * 4 + (x % 4)] / 16;
      if ((bayer + hash(x, y, seed) * 0.12) < k) clear(q, x, y);
    }
  return q;
}

/** Перекрасить всё к цвету с долей k (свечение, телепорт). */
function tinted(p: Px, c: RGBA, k: number): Px {
  return p.tint(c, k);
}

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

function frameOf(kind: string, pose: MobPose, anim: string, f: number, build: () => Built): MobFrame {
  const key = `${kind}|${anim}|${f}|${pose.left ? 1 : 0}|${pose.flash ? 1 : 0}|${pose.look}`;
  const hit = frames.get(key);
  if (hit) return hit;
  return finish(key, build(), pose.look, pose.flash, pose.left);
}

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

/** Цикл кадра: безопасный остаток. */
const cyc = (f: number, n: number) => ((Math.floor(f) % n) + n) % n;

// ---------------------------------------------------------------------------
// Ящеролюд-копейщик: зелёная чешуя, светлое брюхо, рыжий гребень, копьё с
// наконечником из обсидиана. 30×26, смотрит вправо.
// ---------------------------------------------------------------------------

const LZ_ = {
  skin: T('#16301f', '#2c5a3a', '#4c8a4e', '#86ba6a'),
  belly: T('#5e5a30', '#9c9456', '#c8c07e', '#eae2a6'),
  crest: T('#6a1a10', '#b8401e', '#ec7a34', '#ffc070'),
  wood: T('#2a160c', '#5a3820', '#86582e', '#aa7a44'),
  blade: T('#141420', '#2e2e46', '#5a5a7e', '#a8a8d0'),
  eye: hx('#ffd23a'),
  scaleDk: hx('#1c3a26'),
  scaleLt: hx('#6aa45c'),
  cloth: hx('#a82a2a'),
};

interface LizPose {
  /** Сдвиг тела вперёд и вниз, наклон. */
  bx: number;
  by: number;
  lean: number;
  /** Ноги: фаза шага (−1…1 для каждой) и шаг. */
  la: number;
  lb: number;
  stride: number;
  /** Копьё: сдвиг вдоль древка (минус — назад), подъём острия. */
  spear: number;
  tilt: number;
  /** Хвост: взмах. */
  tail: number;
  jaw: number;
  lines: boolean;
  closed: boolean;
  down: boolean;
}

function lizPose(anim: string, f: number): LizPose {
  const p: LizPose = {
    bx: 0,
    by: 0,
    lean: 0,
    la: 0,
    lb: 0,
    stride: 0,
    spear: 0,
    tilt: 0,
    tail: 0,
    jaw: 0,
    lines: false,
    closed: false,
    down: false,
  };
  switch (anim) {
    case 'idle':
      p.by = f % 2 ? 0.4 : 0;
      p.tail = [0, 0.5, 1, 0.5][f % 4];
      p.tilt = f === 1 ? -0.5 : f === 3 ? 0.5 : 0;
      break;
    case 'run': {
      const k = (f % 6) / 6;
      p.la = Math.sin(k * TAU);
      p.lb = -p.la;
      p.stride = 1;
      p.by = -Math.abs(Math.sin(k * TAU)) * 1.2;
      p.lean = 0.8;
      p.tail = Math.sin(k * TAU + 1) * 1.2;
      break;
    }
    case 'aim':
      // Припал, копьё отведено назад, голова вперёд — сейчас ударит.
      p.by = 1.2;
      p.lean = 1.2;
      p.spear = -4.5 + (f % 2) * 0.6;
      p.tilt = 0.6;
      p.la = 0.6;
      p.lb = -0.8;
      p.stride = 1.3;
      p.jaw = 1;
      p.tail = 1.5;
      break;
    case 'lunge':
      p.bx = 2;
      p.by = 0.5;
      p.lean = 2.4;
      p.spear = 4;
      p.tilt = 0;
      p.la = 1;
      p.lb = -1;
      p.stride = 1.8;
      p.tail = -1.5;
      p.lines = true;
      p.jaw = 1;
      break;
    case 'stuck':
      // Копьё засело в кладке: тянет на себя.
      p.bx = -1 + (f % 2) * 0.8;
      p.lean = -0.8;
      p.spear = 4;
      p.la = -0.4;
      p.lb = 0.6;
      p.stride = 1.2;
      p.tail = 1;
      break;
    case 'wind':
      p.spear = -2.5;
      p.lean = 0.6;
      p.by = 0.6;
      p.jaw = f % 2;
      p.tilt = 0.4;
      break;
    case 'bite':
      p.spear = 3;
      p.bx = 1;
      p.lean = 1.4;
      p.la = 0.8;
      p.lb = -0.6;
      p.stride = 1.2;
      break;
    case 'hurt':
      p.bx = -1.2;
      p.lean = -1;
      p.spear = -1;
      p.tilt = -1.5;
      p.closed = true;
      p.tail = -1;
      break;
    case 'sleep':
      p.down = true;
      p.closed = true;
      break;
  }
  return p;
}

function paintLizard(lp: LizPose, anim: string, f: number): Built {
  const W = 32;
  const H = 28;
  const p = new Px(W, H);
  const G = 26;
  if (anim === 'dead' || lp.down) {
    // Лежит на боку: хвост, тело, копьё рядом.
    const sleep = lp.down;
    stroke(p, 3, 24, 27, 22, LZ_.wood[1], 1);
    chain(p, spline([[4, 23], [8, 22], [12, 22]], 3), 1.2, 2.4, LZ_.skin);
    shadeEll(p, 15, 21.5, 5, 3.2, LZ_.skin);
    shadeEll(p, 15.5, 23, 3.6, 1.3, LZ_.belly);
    shadeEll(p, 21, 20.5, 3.2, 2.3, LZ_.skin);
    limb(p, 22.5, 21, 25.5, 21.5, 1.4, 1, LZ_.skin);
    for (let i = 0; i < 3; i++) p.set(19 + i, 18 - (i % 2), LZ_.crest[2]);
    if (sleep) {
      // Спит, свернувшись: хвост кольцом.
      chain(p, spline([[10, 22], [9, 19], [12, 17]], 3), 1.6, 0.8, LZ_.skin);
    }
    scales(p, 8, 17, 25, 25, LZ_.scaleDk, null, 3);
    p.outline(INK);
    p.set(21, 20, sleep ? INK : hx('#3a2a14'));
    return { p, ax: 15, ay: G, eye: null };
  }
  const bx = 13 + lp.bx;
  const by = lp.by;
  // Хвост: от бедра назад и вниз, кончик машет.
  const tailPts = spline(
    [
      [bx - 2, 17 + by],
      [bx - 6, 19 + by + lp.tail * 0.3],
      [bx - 9, 21 + lp.tail * 0.6],
      [bx - 12, 21.5 + lp.tail],
    ],
    3,
  );
  chain(p, tailPts, 2.3, 0.6, LZ_.skin, -0.1);
  // Ноги: дальняя темнее.
  const leg = (hipX: number, ph: number, far: boolean) => {
    const t = far ? ([LZ_.skin[0], LZ_.skin[0], LZ_.skin[1], LZ_.skin[2]] as Tones) : LZ_.skin;
    const kx = hipX + ph * 1.8 * lp.stride;
    const knee: [number, number] = [kx - 1.2, 20.5 + by * 0.5];
    const ankle: [number, number] = [kx - 0.2 + ph * 0.6, 23.5];
    const toeY = G - 1.5 + (ph > 0.5 && lp.stride ? -1 : 0);
    limb(p, hipX, 17 + by, knee[0], knee[1], 1.9, 1.4, t);
    limb(p, knee[0], knee[1], ankle[0], ankle[1], 1.3, 1, t);
    limb(p, ankle[0], ankle[1], ankle[0] + 2.6, toeY, 0.9, 0.7, t);
    p.set(Math.round(ankle[0] + 3), Math.round(toeY), LZ_.belly[3]);
  };
  leg(bx - 1, lp.lb, true);
  // Древко копья — за телом (дальняя рука держит сзади).
  const sa = -0.06 - lp.tilt * 0.08;
  const sx0 = bx - 9 + lp.spear;
  const sy0 = 16.5 + by;
  const sLen = 22;
  const sx1 = sx0 + Math.cos(sa) * sLen;
  const sy1 = sy0 + Math.sin(sa) * sLen;
  // Туловище: наклонённый овал, брюхо светлее.
  const tx = bx + lp.lean * 0.6;
  shadeEll(p, tx, 12.5 + by, 3.9, 5.2, LZ_.skin);
  shadeEll(p, tx + 1.6, 13.5 + by, 1.9, 4, LZ_.belly, 0.1);
  for (let y = 10; y <= 17; y += 2) p.set(Math.round(tx + 1.8), Math.round(y + by), LZ_.belly[0]);
  leg(bx + 1, lp.la, false);
  // Шея и голова: морда вперёд, челюсть, гребень.
  const hxp = tx + 3.5 + lp.lean * 0.8;
  const hyp = 6.2 + by + lp.lean * 0.4;
  limb(p, tx + 1.5, 9 + by, hxp - 0.5, hyp + 1, 2.2, 1.8, LZ_.skin);
  shadeEll(p, hxp, hyp, 3.2, 2.5, LZ_.skin);
  limb(p, hxp + 1.5, hyp + 0.3, hxp + 5.2, hyp + 0.9, 1.7, 1.1, LZ_.skin);
  // Нижняя челюсть: открыта в замахе.
  limb(p, hxp + 0.5, hyp + 1.8 + lp.jaw * 0.4, hxp + 4.8, hyp + 2.2 + lp.jaw * 1.2, 1.1, 0.7, LZ_.belly);
  if (lp.jaw) {
    p.set(Math.round(hxp + 3), Math.round(hyp + 1.6 + lp.jaw * 0.6), hx('#6a1a1a'));
    p.set(Math.round(hxp + 4), Math.round(hyp + 1.6 + lp.jaw * 0.6), hx('#6a1a1a'));
  }
  // Гребень: три пера назад по затылку.
  for (let i = 0; i < 4; i++) {
    const gx = hxp - 1.5 - i * 1.3;
    const gy = hyp - 2.2 + i * 0.9;
    limb(p, gx, gy, gx - 1.6, gy - 2.2 + i * 0.3, 0.9, 0.4, LZ_.crest);
  }
  // Спина: гребень продолжается мелкими шипами.
  for (let i = 0; i < 4; i++) p.set(Math.round(tx - 3 - i * 0.2), Math.round(9 + i * 2 + by), LZ_.crest[1]);
  scales(p, 0, 4, W - 1, G, LZ_.scaleDk, LZ_.scaleLt, 5);
  // Руки: обе на древке.
  const grip = (k: number): [number, number] => [sx0 + Math.cos(sa) * sLen * k, sy0 + Math.sin(sa) * sLen * k];
  const [g1x, g1y] = grip(0.42);
  const [g2x, g2y] = grip(0.6);
  // Древко поверх тела.
  stroke(p, sx0, sy0, sx1, sy1, LZ_.wood[1]);
  stroke(p, sx0, sy0 - 1, sx1, sy1 - 1, LZ_.wood[2]);
  // Наконечник: листовидный обсидиан, у основания — красная кисть.
  const ux = Math.cos(sa);
  const uy = Math.sin(sa);
  poly(
    p,
    [
      [sx1 - ux * 1, sy1 - uy * 1 - 1.6],
      [sx1 + ux * 4.2, sy1 + uy * 4.2 - 0.4],
      [sx1 - ux * 1, sy1 - uy * 1 + 1.2],
    ],
    (x, y) => tone(LZ_.blade, 0.9 - (y - (sy1 - 1.6)) * 0.28),
  );
  p.set(Math.round(sx1 - ux * 2), Math.round(sy1 + 1), LZ_.cloth);
  p.set(Math.round(sx1 - ux * 2.6), Math.round(sy1 + 2), LZ_.cloth);
  limb(p, tx - 0.5, 10.5 + by, g1x, g1y, 1.2, 1, LZ_.skin);
  limb(p, tx + 1.5, 10 + by, g2x, g2y, 1.3, 1.1, LZ_.skin);
  if (lp.lines) {
    const c = alpha(LZ_.belly[2], 0.55);
    for (const [y, l] of [
      [10, 5],
      [14, 7],
      [18, 4],
    ] as const)
      stroke(p, 0, y + by, l, y + by, c);
  }
  p.outline(INK);
  // Глаз: жёлтый со зрачком-щелью.
  const ex = Math.round(hxp + 0.8);
  const ey = Math.round(hyp - 0.8);
  if (lp.closed) {
    p.set(ex - 1, ey, INK);
    p.set(ex, ey, INK);
  } else {
    p.set(ex, ey, LZ_.eye);
    p.set(ex - 1, ey, hx('#b8901a'));
    p.set(ex, ey + 1, INK);
  }
  // Ноздря.
  p.set(Math.round(hxp + 5), Math.round(hyp), INK);
  void f;
  return { p, ax: Math.round(bx), ay: G, eye: lp.closed ? null : [ex, ey] };
}

registerMobPainter('f9_lizard', (m: Mob, pose: MobPose) => {
  let anim: string = pose.anim;
  let f = pose.frame;
  const mode = pose.mode;
  if (mode === 'aim') {
    anim = 'aim';
    f = cyc(pose.t * 14, 2);
  } else if (mode === 'lunge') {
    anim = 'lunge';
    f = 0;
  } else if (mode === 'stuck') {
    anim = 'stuck';
    f = cyc(pose.t * 8, 2);
  } else if (anim === 'run') f = cyc(f, 6);
  else if (anim === 'wind' || anim === 'bite') f = cyc(f, 2);
  else if (anim === 'idle') f = cyc(f, 4);
  else f = 0;
  if (anim === 'stuck') {
    const k = cyc(pose.t * 6, 4);
    return frameOf('f9_lizard', pose, 'stuck', k, () => {
      const b = paintLizard(lizPose('stuck', k % 2), 'stuck', k);
      stars(b.p, b.ax + 3, 3, 4, k);
      return b;
    });
  }
  return frameOf('f9_lizard', pose, anim, f, () => paintLizard(lizPose(anim, f), anim, f));
});

// ---------------------------------------------------------------------------
// Ядовитая жаба: приземистая, бородавчатая, оливковая с рыжими пятнами яда,
// горловой мешок раздувается перед плевком. 22×18.
// ---------------------------------------------------------------------------

const TD = {
  skin: T('#26300e', '#4a5a1c', '#6e8028', '#9aac44'),
  belly: T('#6a5a2a', '#a8904a', '#cebc72', '#ece0a4'),
  spot: hx('#e0781e'),
  spotHi: hx('#ffc04a'),
  wart: hx('#3a4614'),
  sac: T('#6a5a14', '#b8a02a', '#e8d65a', '#fff6a8'),
  eye: hx('#ff9a2a'),
  mouth: hx('#4a1a14'),
  slime: hx('#b8f050'),
};

function paintToad(anim: string, f: number): Built {
  const W = 24;
  const H = 20;
  const p = new Px(W, H);
  const G = 18;
  if (anim === 'dead') {
    shadeEll(p, 12, 14, 7, 3.6, TD.belly);
    for (const [x, y, x2, y2] of [
      [7, 12, 5, 8],
      [16, 12, 18, 8],
      [9, 15, 6, 17],
      [15, 15, 18, 17],
    ])
      limb(p, x, y, x2, y2, 1.2, 0.8, TD.skin);
    p.outline(INK);
    p.set(10, 13, TD.spot);
    return { p, ax: 12, ay: G, eye: null };
  }
  let by = 0;
  let sac = 0;
  let jump = 0;
  let mouth = 0;
  let squash = 0;
  switch (anim) {
    case 'idle':
      sac = [0.2, 0.5, 0.2, 0][f % 4];
      squash = f % 2 ? 0.3 : 0;
      break;
    case 'hop': {
      const k = f % 4;
      jump = [0, 2.2, 3, 1][k];
      squash = k === 0 ? 0.8 : k === 3 ? 0.4 : -0.4;
      break;
    }
    case 'aim':
      sac = 0.7 + f * 0.3;
      squash = 0.4;
      break;
    case 'spit':
      mouth = 1;
      sac = 0.1;
      break;
    case 'wind':
      mouth = f % 2 ? 0.6 : 0.2;
      squash = 0.5;
      break;
    case 'bite':
      mouth = 1;
      by = -0.5;
      break;
    case 'hurt':
      squash = -0.6;
      break;
    case 'sleep':
      squash = 0.6;
      break;
  }
  by -= jump;
  const bx = 11;
  // Задние лапы — широкие, согнутые.
  const hl = jump > 1 ? 1 : 0;
  limb(p, bx - 4, 13 + by, bx - 7 - hl * 2, 16 + by * 0.3 + hl, 2.2, 1.4, TD.skin);
  limb(p, bx - 7 - hl * 2, 16 + by * 0.3 + hl, bx - 3, G - 1, 1.2, 0.9, TD.skin);
  // Тело: широкое, приплюснутое.
  const rx = 7 + squash * 0.8;
  const ry = 5.2 - squash * 0.8;
  shadeEll(p, bx, 11.5 + by + squash, rx, ry, TD.skin);
  // Брюхо.
  shadeEll(p, bx + 1.5, 14 + by + squash * 0.6, rx * 0.7, ry * 0.45, TD.belly, 0.1);
  // Бородавки и пятна яда.
  for (let i = 0; i < 9; i++) {
    const x = Math.round(bx - 5 + hash(i, 3) * 10);
    const y = Math.round(8 + by + squash + hash(i, 5) * 5);
    if (!p.solid(x, y)) continue;
    if (i % 3 === 0) {
      p.set(x, y, TD.spot);
      p.set(x + 1, y, TD.spot);
      p.set(x, y - 1, TD.spotHi);
    } else p.set(x, y, TD.wart);
  }
  // Горловой мешок: раздувается жёлтым пузырём.
  if (sac > 0.05) {
    const s = 1.2 + sac * 2.6;
    shadeEll(p, bx + 5.5, 14 + by + squash * 0.5, s, s * 0.85, TD.sac, 0.2);
  }
  // Передние лапы.
  limb(p, bx + 4, 13.5 + by, bx + 5.5, G - 1, 1.2, 0.8, TD.skin);
  p.set(bx + 6, G - 1, TD.belly[2]);
  // Голова спереди: глаза сверху, широкая пасть.
  shadeEll(p, bx + 5, 9 + by + squash, 3.4, 2.8, TD.skin);
  shadeEll(p, bx + 3.6, 6.8 + by + squash, 1.7, 1.6, TD.skin, 0.2);
  p.outline(INK);
  // Пасть.
  const my = Math.round(10.5 + by + squash);
  for (let x = bx + 4; x <= bx + 8; x++) p.set(x, my, TD.mouth);
  if (mouth > 0.3) {
    for (let x = bx + 5; x <= bx + 8; x++) p.set(x, my + 1, hx('#8a2a2a'));
    if (anim === 'spit') for (let x = bx + 8; x <= bx + 11; x++) p.set(x, my, TD.slime);
  }
  // Глаз: оранжевый с горизонтальным зрачком.
  const ex = Math.round(bx + 4);
  const ey = Math.round(6.3 + by + squash);
  if (anim === 'sleep' || anim === 'hurt') {
    p.set(ex, ey, INK);
    p.set(ex + 1, ey, INK);
  } else {
    p.set(ex, ey, TD.eye);
    p.set(ex + 1, ey, TD.eye);
    p.set(ex, ey, INK);
  }
  // Капля слизи на губе.
  if (anim === 'aim' && f % 2) p.set(bx + 8, my + 1, TD.slime);
  return { p, ax: bx, ay: G, eye: anim === 'sleep' ? null : [ex + 1, ey] };
}

registerMobPainter('f9_toad', (m: Mob, pose: MobPose) => {
  let anim: string = pose.anim;
  let f = pose.frame;
  if (pose.mode === 'aim') {
    anim = 'aim';
    f = Math.min(2, Math.floor(pose.t * 5));
  } else if (pose.mode === 'recover' && pose.t < 0.2) {
    anim = 'spit';
    f = 0;
  } else if (anim === 'run') {
    anim = 'hop';
    f = cyc(pose.t * 9 + m.id, 4);
  } else if (anim === 'idle') f = cyc(f, 4);
  else if (anim === 'wind' || anim === 'bite') f = cyc(f, 2);
  else f = 0;
  return frameOf('f9_toad', pose, anim, f, () => paintToad(anim, f));
});

// ---------------------------------------------------------------------------
// Телепорт-кобольд: мелкий, лопоухий, шакалья морда, лиловый капюшон с
// рунными стежками, кинжал. Скупщик — тот же кобольд с мешком монет.
// ---------------------------------------------------------------------------

const KB = {
  fur: T('#3a2a1a', '#6a4a2c', '#96704a', '#c09a6a'),
  hood: T('#1e1432', '#3e2a64', '#5e4696', '#8a70c4'),
  rune: hx('#9af0ff'),
  runeDim: hx('#4a8aa0'),
  steel: T('#303038', '#5e5e6a', '#9a9aa8', '#dadae6'),
  eye: hx('#7af0ff'),
  nose: hx('#1a1010'),
  sack: T('#4a3018', '#7a5430', '#a67a48', '#cca070'),
  coin: hx('#ffd24a'),
  coinHi: hx('#fff4b0'),
};

function paintKobold(anim: string, f: number, hoard: boolean): Built {
  const W = 22;
  const H = 22;
  const p = new Px(W, H);
  const G = 20;
  if (anim === 'dead') {
    shadeEll(p, 11, 17, 5, 2.4, KB.hood);
    shadeEll(p, 16, 16.5, 2.4, 2, KB.fur);
    limb(p, 17, 16, 20.5, 17, 1, 0.6, KB.fur);
    stroke(p, 3, 18, 7, 17, KB.steel[2]);
    if (hoard) {
      shadeEll(p, 5, 16, 3, 2.4, KB.sack);
      p.set(3, 18, KB.coin);
      p.set(8, 18, KB.coin);
      p.set(9, 19, KB.coinHi);
    }
    p.outline(INK);
    return { p, ax: 11, ay: G, eye: null };
  }
  let by = 0;
  let la = 0;
  let arm = 0;
  let lean = 0;
  let ear = 0;
  switch (anim) {
    case 'idle':
      by = f % 2 ? 0.4 : 0;
      ear = [0, 0.3, 0, -0.2][f % 4];
      break;
    case 'run': {
      const k = (f % 6) / 6;
      la = Math.sin(k * TAU);
      by = -Math.abs(Math.cos(k * TAU)) * 1;
      lean = 0.8;
      ear = 0.6;
      break;
    }
    case 'wind':
      arm = -1;
      lean = -0.4;
      by = 0.5;
      break;
    case 'bite':
      arm = 1;
      lean = 1.2;
      break;
    case 'mark':
      arm = 0.3;
      by = f % 2 ? -0.5 : 0;
      ear = 0.8;
      break;
    case 'hurt':
      lean = -1;
      ear = -0.6;
      break;
    case 'sleep':
      by = 2;
      break;
  }
  const bx = 10 + lean * 0.5;
  // Мешок скупщика — за спиной, туго набит.
  if (hoard) {
    shadeEll(p, bx - 4.2, 11 + by, 4, 4.4, KB.sack);
    stroke(p, bx - 6, 7.5 + by, bx - 3, 7 + by, KB.sack[0]);
    for (const [x, y] of [
      [bx - 5, 8],
      [bx - 3.5, 7.4],
    ] as const)
      p.set(Math.round(x), Math.round(y + by), KB.coin);
  }
  // Ноги в обмотках.
  for (const [dx, ph] of [
    [-1.2, -la],
    [1.4, la],
  ] as const) {
    const fx = bx + dx + ph * 1.6;
    limb(p, bx + dx * 0.6, 15 + by, fx, G - 1, 1.3, 1, KB.fur);
    p.set(Math.round(fx + 1), G - 1, KB.fur[3]);
  }
  // Плащ-капюшон: треугольником от плеч, полы рваные.
  poly(
    p,
    [
      [bx - 4.2, 17 + by],
      [bx - 2.2, 7.5 + by],
      [bx + 2.6, 7.5 + by],
      [bx + 4.4, 17 + by],
    ],
    (x, y) => tone(KB.hood, 0.75 - (x - bx + 4) * 0.08 - (y - 7) * 0.02),
  );
  for (let x = Math.floor(bx - 4); x <= bx + 4; x += 2) clear(p, x, Math.round(17 + by));
  // Рунные стежки по полам плаща.
  for (let y = 10; y <= 16; y += 3) {
    p.set(Math.round(bx - 1), Math.round(y + by), anim === 'mark' ? KB.rune : KB.runeDim);
    p.set(Math.round(bx + 2), Math.round(y + 1 + by), anim === 'mark' ? KB.rune : KB.runeDim);
  }
  // Голова: шакалья морда из-под капюшона, уши торчат.
  const hxp = bx + 2 + lean * 0.6;
  const hyp = 6 + by;
  for (const [dx, k] of [
    [-1.6, 1],
    [0.4, 0.85],
  ] as const) {
    const a = -Math.PI / 2 - 0.35 - ear * 0.4 * k;
    limb(p, hxp + dx, hyp - 1.5, hxp + dx + Math.cos(a) * 4, hyp - 1.5 + Math.sin(a) * 4, 1.3, 0.5, KB.fur, 0.1);
  }
  shadeEll(p, hxp, hyp, 2.8, 2.4, KB.fur);
  limb(p, hxp + 1.5, hyp + 0.4, hxp + 4.6, hyp + 1.2, 1.3, 0.8, KB.fur);
  // Капюшон накрывает затылок.
  shadeEll(p, hxp - 1.4, hyp - 0.4, 2.4, 2.8, KB.hood, 0.1);
  // Рука с кинжалом.
  const ax0 = bx + 1.5;
  const ay0 = 10 + by;
  const hx2 = ax0 + 2.5 + arm * 2;
  const hy2 = ay0 + 2 - arm * 1.5;
  limb(p, ax0, ay0, hx2, hy2, 1.1, 0.9, KB.hood);
  const da = -0.4 + arm * 0.5;
  stroke(p, hx2, hy2, hx2 + Math.cos(da) * 4.5, hy2 + Math.sin(da) * 4.5, KB.steel[3]);
  stroke(p, hx2, hy2 + 1, hx2 + Math.cos(da) * 4, hy2 + 1 + Math.sin(da) * 4, KB.steel[1]);
  p.outline(INK);
  // Нос и глаз светится бирюзой.
  p.set(Math.round(hxp + 4.8), Math.round(hyp + 1), KB.nose);
  const ex = Math.round(hxp + 1);
  const ey = Math.round(hyp - 0.5);
  if (anim === 'sleep' || anim === 'hurt') p.set(ex, ey, INK);
  else {
    p.set(ex, ey, KB.eye);
    p.set(ex + 1, ey, hx('#2a8aa0'));
  }
  if (hoard) {
    // Монета блестит из горловины мешка.
    p.set(Math.round(bx - 4), Math.round(7 + by), KB.coinHi);
  }
  return { p, ax: Math.round(bx), ay: G, eye: anim === 'sleep' ? null : [ex, ey] };
}

/** Кадр прыжка: кобольд наливается лиловым и растворяется дизером. */
function koboldPhase(b: Built, k: number, vanish: boolean): Built {
  const glow = tinted(b.p, hx('#b89aff'), 0.35 + 0.4 * k);
  const p = vanish ? dissolve(glow, k, 3) : dissolve(glow, 1 - k, 5);
  return { ...b, p };
}

function koboldPainter(kind: string, hoard: boolean) {
  return (m: Mob, pose: MobPose): MobFrame => {
    const mode = pose.mode;
    if (mode === 'f9_mark') {
      const k = Math.min(3, Math.floor(pose.t * 9));
      return frameOf(kind, pose, 'vanish', k, () =>
        koboldPhase(paintKobold('mark', k, hoard), k / 3, true),
      );
    }
    if (mode === 'f9_appear') {
      const k = Math.min(3, Math.floor(pose.t * 16));
      return frameOf(kind, pose, 'appear', k, () =>
        koboldPhase(paintKobold('idle', 0, hoard), 1 - k / 3, false),
      );
    }
    let anim: string = pose.anim;
    let f = pose.frame;
    if (anim === 'run') f = cyc(f, 6);
    else if (anim === 'idle') f = cyc(f, 4);
    else if (anim === 'wind' || anim === 'bite') f = cyc(f, 2);
    else f = 0;
    if (mode === 'recover' && pose.t > 0.2) anim = 'idle';
    return frameOf(kind, pose, anim, f, () => paintKobold(anim, f, hoard));
  };
}

registerMobPainter('f9_kobold', koboldPainter('f9_kobold', false));
registerMobPainter('f9_hoarder', koboldPainter('f9_hoarder', true));

// ---------------------------------------------------------------------------
// Каменный змей: серо-зелёная каменная чешуя, капюшон с «глазами»,
// голова поднята над кольцами; во взгляде глаза горят бирюзой. 28×22.
// ---------------------------------------------------------------------------

const SP = {
  body: T('#232a26', '#46524a', '#6e7c70', '#9eac9c'),
  belly: T('#4a4632', '#7c7656', '#a8a07a', '#cec6a0'),
  hood: T('#1c2420', '#3a4a40', '#5e7064', '#8a9c8a'),
  moss: hx('#4a6a2a'),
  crack: hx('#1a201c'),
  eye: hx('#6affe0'),
  eyeHot: hx('#e8fff8'),
  tongue: hx('#c83a4a'),
};

function paintSerpent(anim: string, f: number): Built {
  const W = 30;
  const H = 24;
  const p = new Px(W, H);
  const G = 22;
  if (anim === 'dead') {
    const pts = spline([[3, 20], [9, 21], [15, 19.5], [21, 21], [26, 20]], 3);
    chain(p, pts, 1.6, 2.4, SP.body);
    scales(p, 0, 16, W - 1, G, SP.crack, null, 9);
    p.outline(INK);
    p.set(26, 19, INK);
    return { p, ax: 14, ay: G, eye: null };
  }
  const k = (f % 4) / 4;
  const slither = anim === 'run' ? Math.sin(k * TAU) : 0;
  const gaze = anim === 'gaze';
  const strike = anim === 'bite';
  // Кольца на земле: две петли, волна сдвигается при ползании.
  const coil = spline(
    [
      [3, 20 + slither * 0.6],
      [7, 18.5 - slither * 0.8],
      [12, 20.5 + slither * 0.6],
      [16, 19],
      [18, 16],
    ],
    4,
  );
  chain(p, coil, 1.3, 2.9, SP.body);
  shadeEll(p, 11, 20.8, 4.2, 1.3, SP.belly, 0.1);
  // Шея вверх и голова. Во взгляде — выше и с раскрытым капюшоном.
  const hy = gaze ? 5.5 : strike ? 9 : 7.5 + (anim === 'idle' ? [0, 0.5, 0.8, 0.4][f % 4] : 0);
  const hx0 = strike ? 24 : gaze ? 20 : 21;
  const neck = spline([[18, 16], [19.5, 12], [hx0 - 1.5, hy + 2.5]], 4);
  chain(p, neck, 2.4, 1.9, SP.body);
  // Капюшон: веер пластин за головой, в центре — «глаза» узора.
  const hood = gaze ? 1 : strike ? 0.3 : 0.55;
  shadeEll(p, hx0 - 1.3, hy + 2.2, 2.4 + hood * 2.4, 3.2 + hood * 1.6, SP.hood);
  if (hood > 0.5) {
    p.set(Math.round(hx0 - 3), Math.round(hy + 2), SP.eye);
    p.set(Math.round(hx0 + 0.4), Math.round(hy + 2), SP.eye);
  }
  shadeEll(p, hx0, hy, 2.6, 2, SP.body);
  limb(p, hx0 + 1, hy + 0.3, hx0 + 3.8, hy + 0.8, 1.5, 1, SP.body);
  // Мох и трещины камня по чешуе.
  scales(p, 0, 0, W - 1, G, SP.crack, SP.body[3], 11);
  for (let i = 0; i < 5; i++) {
    const x = Math.round(3 + hash(i, 21) * 16);
    const y = Math.round(17 + hash(i, 22) * 4);
    if (p.solid(x, y)) p.set(x, y, SP.moss);
  }
  p.outline(INK);
  // Язык в укусе, глаза: во взгляде — белый жар.
  if (strike || (anim === 'idle' && f === 2)) {
    p.set(Math.round(hx0 + 4.6), Math.round(hy + 1), SP.tongue);
    p.set(Math.round(hx0 + 5.4), Math.round(hy + 0.4), SP.tongue);
    p.set(Math.round(hx0 + 5.4), Math.round(hy + 1.6), SP.tongue);
  }
  const ex = Math.round(hx0 + 0.6);
  const ey = Math.round(hy - 0.6);
  if (anim === 'sleep' || anim === 'hurt') p.set(ex, ey, INK);
  else {
    p.set(ex, ey, gaze ? SP.eyeHot : SP.eye);
    if (gaze) {
      p.set(ex + 1, ey, SP.eye);
      p.set(ex, ey - 1, alpha(SP.eye, 0.6));
    }
  }
  return { p, ax: 13, ay: G, eye: anim === 'sleep' ? null : [ex, ey] };
}

registerMobPainter('f9_serpent', (m: Mob, pose: MobPose) => {
  let anim: string = pose.anim;
  let f = pose.frame;
  if (pose.mode === 'gaze') {
    anim = 'gaze';
    f = cyc(pose.t * 10, 2);
  } else if (anim === 'run') f = cyc(pose.t * 7 + m.id, 4);
  else if (anim === 'idle') f = cyc(f, 4);
  else if (anim === 'wind' || anim === 'bite') f = cyc(f, 2);
  else f = 0;
  return frameOf('f9_serpent', pose, anim, f, () => paintSerpent(anim, f));
});

// ---------------------------------------------------------------------------
// Болотный огонь: сине-зелёное пламя с тёмной сердцевиной и глазами, хвост
// тает книзу. Висит в воздухе (летун). 18×22.
// ---------------------------------------------------------------------------

const WS = {
  outer: hx('#1a8a7a'),
  mid: hx('#4ad8b0'),
  inner: hx('#b8ffe8'),
  core: hx('#0e2a2c'),
  eye: hx('#e8fff8'),
  spark: hx('#e0fff0'),
};

function paintWisp(anim: string, f: number): Built {
  const W = 18;
  const H = 24;
  const p = new Px(W, H);
  const G = 22;
  const cx = 9;
  const flare = anim === 'flare' ? 1 + (f % 2) * 0.3 : 0;
  const cy = 10 - (anim === 'idle' ? [0, 0.5, 1, 0.5][f % 4] : 0);
  const R = 4.2 + flare * 1.6;
  // Язык пламени вверх: колышется по кадрам.
  const sway = [0, 1, 0, -1, 0, 1][f % 6];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      // Капля: снизу круглая, сверху вытянута в язык.
      const up = dy < 0 ? -dy / (R * 1.9) : 0;
      const sx = dx - sway * up * 2;
      const r = dy < 0 ? R * (1 - up * up) : R;
      const d = Math.hypot(sx, dy < 0 ? 0 : dy);
      const e = dy < 0 ? Math.abs(sx) / Math.max(0.1, r) : d / R;
      if (dy < 0 && up > 1) continue;
      if (e > 1) continue;
      const c = e < 0.35 ? WS.inner : e < 0.7 ? WS.mid : WS.outer;
      p.set(x, y, alpha(c, e > 0.85 ? 0.7 : 1));
    }
  // Хвост книзу: тающие искры.
  for (let i = 0; i < 5; i++) {
    const y = Math.round(cy + R + 1 + i * 1.6);
    const x = Math.round(cx + Math.sin((i + f) * 1.7) * 1.4);
    if (y < H) p.set(x, y, alpha(WS.mid, 0.9 - i * 0.16));
  }
  // Тёмная сердцевина и глаза.
  p.ell(cx, cy + 0.6, 1.8, 1.5, WS.core);
  p.outline(alpha(hx('#062220'), 0.85));
  const ex = cx - 1;
  const ey = Math.round(cy + 0.4);
  if (anim !== 'hurt') {
    p.set(ex, ey, WS.eye);
    p.set(ex + 2, ey, WS.eye);
  }
  if (flare) for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + f;
    p.set(Math.round(cx + Math.cos(a) * (R + 2)), Math.round(cy + Math.sin(a) * (R + 2)), WS.spark);
  }
  return { p, ax: cx, ay: G, eye: [ex + 1, ey] };
}

registerMobPainter('f9_wisp', (m: Mob, pose: MobPose) => {
  const mode = pose.mode;
  if (mode === 'fade' || mode === 'f9_fadein') {
    const k = Math.min(3, Math.floor(pose.t * 6));
    const kk = mode === 'fade' ? k / 3 : 1 - k / 3;
    return frameOf('f9_wisp', pose, `fade${mode === 'fade' ? 0 : 1}`, k, () => {
      const b = paintWisp('idle', 0);
      return { ...b, p: dissolve(b.p, kk, 7) };
    });
  }
  let anim: string = mode === 'flare' ? 'flare' : pose.anim === 'hurt' ? 'hurt' : 'idle';
  if (pose.anim === 'dead') anim = 'dead';
  if (anim === 'dead') {
    return frameOf('f9_wisp', pose, 'dead', 0, () => {
      const b = paintWisp('idle', 0);
      return { ...b, p: dissolve(b.p, 0.7, 9) };
    });
  }
  const f = anim === 'flare' ? cyc(pose.t * 10, 2) : cyc(pose.t * 8 + m.id, 6);
  return frameOf('f9_wisp', pose, anim, f, () => paintWisp(anim, f));
});

// ---------------------------------------------------------------------------
// Корневая хваталка: клубок корней с узлом-глазом, живёт в трясине. Под
// водой — бугор и кончики корней; вынырнула — корни извиваются. 26×26.
// ---------------------------------------------------------------------------

const RT = {
  bark: T('#1e140a', '#3e2a16', '#664628', '#8e6a3e'),
  young: T('#2a2a0e', '#4e5a1a', '#768a2a', '#a0b44a'),
  knot: hx('#ffb040'),
  knotHi: hx('#fff0b0'),
  mud: T('#1a1a0c', '#2e3014', '#46481e', '#5e622a'),
  ripple: hx('#8a9a4a'),
};

function paintRoot(anim: string, f: number): Built {
  const W = 28;
  const H = 28;
  const p = new Px(W, H);
  const G = 24;
  const cx = 14;
  if (anim === 'sub' || anim === 'grab') {
    // Под трясиной: бугор тины, из него — кончики корней и пузырь.
    const k = f % 4;
    shadeEll(p, cx, G - 1.5, 5 + (k % 2) * 0.4, 2, RT.mud);
    const tips = anim === 'grab' ? 5 : 3;
    for (let i = 0; i < tips; i++) {
      const bx = cx - 4 + i * (8 / Math.max(1, tips - 1));
      const hgt = (anim === 'grab' ? 5 + k : 2 + ((i + k) % 3)) * (i % 2 ? 0.8 : 1);
      const lean = Math.sin(i * 2 + k) * 1.2;
      limb(p, bx, G - 2, bx + lean, G - 2 - hgt, 1, 0.4, RT.young);
    }
    p.outline(INK);
    // Рябь вокруг.
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU + k * 0.3;
      const x = Math.round(cx + Math.cos(a) * (7 + (k % 2)));
      const y = Math.round(G - 1.5 + Math.sin(a) * 2.4);
      if (!p.solid(x, y)) p.set(x, y, alpha(RT.ripple, 0.7));
    }
    if (k === 2) p.set(cx + 2, G - 5, alpha(RT.ripple, 0.8));
    return { p, ax: cx, ay: G, eye: null };
  }
  if (anim === 'dead') {
    for (let i = 0; i < 5; i++) {
      const a = Math.PI + (i / 4) * Math.PI * 0.8 - 0.3;
      chain(p, spline([[cx, G - 2], [cx + Math.cos(a) * 4, G - 1], [cx + Math.cos(a) * 8, G - 0.5]], 3), 1.2, 0.5, RT.bark);
    }
    shadeEll(p, cx, G - 2, 3.4, 2, RT.bark);
    p.outline(INK);
    p.set(cx, G - 2, hx('#4a3010'));
    return { p, ax: cx, ay: G, eye: null };
  }
  // Вынырнула: корни-щупальца вокруг ствола, извиваются.
  const k = f % 4;
  const whip = anim === 'wind' ? 1 : anim === 'bite' ? 2 : 0;
  const n = 6;
  for (let i = 0; i < n; i++) {
    const side = i % 2 ? 1 : -1;
    const base: [number, number] = [cx + side * (1 + (i >> 1)), G - 3 - (i >> 1)];
    const ph = k * 0.8 + i * 1.3;
    const lift = whip === 1 && i === 1 ? 6 : whip === 2 && i === 1 ? 1 : 0;
    const reach = whip === 2 && i === 1 ? 11 : 6 + (i >> 1);
    const pts: [number, number][] = [
      base,
      [base[0] + side * 2.5 + Math.sin(ph) * 1.2, base[1] - 3 - lift * 0.6],
      [base[0] + side * (reach - 3) + Math.sin(ph + 1) * 1.6, base[1] - 5 - lift + Math.cos(ph) * 1.4],
      [base[0] + side * reach * (whip === 2 && i === 1 ? 1 : 0.8) + Math.sin(ph + 2) * 2, base[1] - 4 - lift * 1.3 + Math.sin(ph) * 2],
    ];
    chain(p, spline(pts, 3), 1.5, 0.4, i % 3 ? RT.bark : RT.young);
  }
  // Ствол-узел: кора и светящийся глаз-сучок.
  shadeEll(p, cx, G - 6, 4.2, 5.2, RT.bark);
  for (let y = G - 11; y < G - 1; y += 2) p.set(cx - 2, y, RT.bark[0]);
  for (let y = G - 10; y < G - 2; y += 3) p.set(cx + 2, y, RT.bark[3]);
  shadeEll(p, cx, G - 1, 5.6, 1.6, RT.mud);
  p.outline(INK);
  const ex = cx + 1;
  const ey = G - 8;
  p.ell(ex + 0.5, ey + 0.5, 1.4, 1.4, anim === 'hurt' ? hx('#6a4010') : RT.knot);
  if (anim !== 'hurt') p.set(ex, ey, RT.knotHi);
  return { p, ax: cx, ay: G, eye: anim === 'hurt' ? null : [ex, ey] };
}

registerMobPainter('f9_root', (m: Mob, pose: MobPose) => {
  const mode = pose.mode;
  if (mode === 'f9_sub' || mode === 'dive') {
    const f = cyc(pose.t * 4 + m.id, 4);
    return frameOf('f9_root', pose, 'sub', f, () => paintRoot('sub', f));
  }
  if (mode === 'grab') {
    const f = cyc(pose.t * 8, 4);
    return frameOf('f9_root', pose, 'grab', f, () => paintRoot('grab', f));
  }
  let anim: string = pose.anim;
  if (anim === 'run' || anim === 'sleep') anim = 'idle';
  const f = anim === 'idle' ? cyc(pose.t * 6 + m.id, 4) : anim === 'wind' || anim === 'bite' ? cyc(pose.frame, 2) : 0;
  return frameOf('f9_root', pose, anim, f, () => paintRoot(anim, f));
});

// ---------------------------------------------------------------------------
// Пиявка: тёмный кольчатый червь с красной присоской. 14×12.
// ---------------------------------------------------------------------------

const LC = {
  body: T('#140a0e', '#2e161e', '#4e2a30', '#7a4448'),
  stripe: hx('#6a4a1a'),
  mouth: hx('#c8304a'),
  mouthHi: hx('#ff8aa0'),
  wet: hx('#b8a0a8'),
};

function paintLeech(anim: string, f: number): Built {
  const W = 16;
  const H = 14;
  const p = new Px(W, H);
  const G = 12;
  const k = (f % 4) / 4;
  const fat = anim === 'latch' ? 0.8 + (f % 2) * 0.4 : 0;
  const curl = anim === 'dizzy' || anim === 'dead';
  const pts: [number, number][] = curl
    ? [
        [4, 9],
        [5, 6],
        [8, 5.5],
        [10, 7.5],
        [8.5, 9.5],
      ]
    : anim === 'leap'
      ? [
          [2, 10],
          [6, 7],
          [10, 5],
          [13, 5],
        ]
      : [
          [2, 10 + Math.sin(k * TAU) * 0.8],
          [5, 9.5 - Math.sin(k * TAU) * 0.8],
          [8, 10 + Math.sin(k * TAU + 1) * 0.8],
          [12, 9.5],
        ];
  chain(p, spline(pts, 3), 1.2 + fat * 0.3, 1.9 + fat, LC.body);
  // Кольца и полоса по спине.
  for (let x = 3; x < 13; x += 2)
    for (let y = 0; y < H; y++)
      if (p.solid(x, y) && !p.solid(x, y - 1)) {
        p.set(x, y + 1, LC.body[0]);
        p.set(x + 1, y, LC.stripe);
      }
  p.outline(INK);
  // Присоска.
  const [mx, my] = pts[pts.length - 1];
  p.set(Math.round(mx + 1), Math.round(my), LC.mouth);
  p.set(Math.round(mx + 1), Math.round(my - 1), anim === 'latch' ? LC.mouthHi : LC.mouth);
  // Мокрый блик.
  p.set(Math.round(pts[1][0]), Math.round(pts[1][1] - 1.2), LC.wet);
  return { p, ax: 7, ay: G, eye: [Math.round(mx), Math.round(my - 1)] };
}

registerMobPainter('f9_leech', (m: Mob, pose: MobPose) => {
  const mode = pose.mode;
  let anim: string = pose.anim;
  let f = 0;
  if (mode === 'latch') {
    anim = 'latch';
    f = cyc(pose.t * 3, 2);
  } else if (mode === 'f9_leap') anim = 'leap';
  else if (mode === 'dizzy') anim = 'dizzy';
  else if (anim === 'run' || anim === 'idle') {
    anim = 'run';
    f = cyc(pose.t * 10 + m.id, 4);
  } else if (anim !== 'dead' && anim !== 'hurt') anim = 'run';
  return frameOf('f9_leech', pose, anim, f, () => {
    const b = paintLeech(anim, f);
    if (anim === 'leap') {
      // Прыжок: кадр выше земли — летит из воды.
      const q = new Px(b.p.w, b.p.h + 6);
      for (let y = 0; y < b.p.h; y++)
        for (let x = 0; x < b.p.w; x++) {
          const c = b.p.get(x, y);
          if (c[3]) q.set(x, y, c);
        }
      return { p: q, ax: b.ax, ay: b.ay + 6, eye: b.eye };
    }
    if (anim === 'dizzy') stars(b.p, 7, 2, 3, cyc(pose.t * 6, 4));
    return b;
  });
});

// ---------------------------------------------------------------------------
// Ящер-жрец: ящер в плаще из камыша и перьев, костяная маска, посох с
// лиловой рунной сферой. 22×28.
// ---------------------------------------------------------------------------

const PR = {
  skin: T('#16301f', '#2c5a3a', '#4c8a4e', '#86ba6a'),
  robe: T('#2a2410', '#4e4420', '#766a34', '#a09454'),
  feather: hx('#c83a2a'),
  featherB: hx('#2a8ab8'),
  mask: T('#6a5a44', '#a89a80', '#d6cab0', '#f2ead6'),
  staff: T('#2a160c', '#5a3820', '#86582e', '#aa7a44'),
  orb: hx('#9a70ff'),
  orbHi: hx('#e8d8ff'),
  orbDk: hx('#4a2a8a'),
};

function paintPriest(anim: string, f: number): Built {
  const W = 26;
  const H = 30;
  const p = new Px(W, H);
  const G = 28;
  if (anim === 'dead') {
    stroke(p, 2, 26, 22, 24, PR.staff[1], 1);
    p.ell(22.5, 23.5, 1.6, 1.6, PR.orbDk);
    shadeEll(p, 12, 24.5, 6, 2.8, PR.robe);
    shadeEll(p, 18, 23.5, 2.6, 2, PR.mask);
    p.outline(INK);
    return { p, ax: 12, ay: G, eye: null };
  }
  const cast = anim === 'cast';
  const by = anim === 'idle' ? (f % 2 ? 0.4 : 0) : anim === 'run' ? -Math.abs(Math.sin(((f % 4) / 4) * TAU)) * 0.8 : 0;
  const bx = 11;
  // Хвост из-под плаща.
  chain(p, spline([[bx - 3, 23 + by], [bx - 7, 25], [bx - 9, 26.5]], 3), 1.8, 0.5, PR.skin);
  // Ноги.
  const la = anim === 'run' ? Math.sin(((f % 4) / 4) * TAU) : 0;
  limb(p, bx - 1, 22 + by, bx - 2 - la, G - 1, 1.3, 1, PR.skin);
  limb(p, bx + 1.5, 22 + by, bx + 2 + la, G - 1, 1.3, 1, PR.skin);
  // Плащ из камыша: трапеция со штрихами, полы бахромой.
  poly(
    p,
    [
      [bx - 5, 24 + by],
      [bx - 3, 10 + by],
      [bx + 3.5, 10 + by],
      [bx + 5, 24 + by],
    ],
    (x, y) => tone(PR.robe, 0.7 - (x - bx + 5) * 0.07 + ((x + y) % 3 === 0 ? -0.3 : 0)),
  );
  for (let x = bx - 5; x <= bx + 5; x += 2) p.set(x, Math.round(24 + by), PR.robe[0]);
  // Перья на плечах.
  for (let i = 0; i < 3; i++) {
    p.set(bx - 3 + i, Math.round(10 + by), i % 2 ? PR.featherB : PR.feather);
    p.set(bx + 2 + i, Math.round(10.5 + by), i % 2 ? PR.feather : PR.featherB);
  }
  // Голова в костяной маске.
  const hxp = bx + 2.5;
  const hyp = 6.5 + by;
  shadeEll(p, hxp, hyp, 3, 2.6, PR.skin);
  limb(p, hxp + 1.4, hyp + 0.4, hxp + 5, hyp + 1, 1.5, 1, PR.skin);
  shadeEll(p, hxp + 0.5, hyp - 0.8, 2.8, 2, PR.mask, 0.2);
  // Гребень из перьев над маской.
  for (let i = 0; i < 4; i++)
    limb(p, hxp - 1 + i * 0.8, hyp - 2.2, hxp - 2 + i * 1.2, hyp - 5.5 - (i % 2), 0.6, 0.4, [PR.feather, PR.feather, i % 2 ? PR.featherB : PR.feather, WHITE]);
  // Посох: в руке, в касте — поднят.
  const sx = bx + 5.5;
  const top = cast ? 1 : 5;
  stroke(p, sx, G - 1, sx + (cast ? 1 : 0), top, PR.staff[1]);
  stroke(p, sx - 1, G - 1, sx - 1 + (cast ? 1 : 0), top, PR.staff[2]);
  limb(p, bx + 2, 12 + by, sx - 0.5, cast ? 8 : 14, 1.1, 0.9, PR.skin);
  p.outline(INK);
  // Сфера посоха — поверх контура, светится.
  const ox = sx + (cast ? 1 : 0);
  const oy = top - 1.5;
  const glow = cast ? 1 + (f % 2) * 0.4 : 0.8;
  p.ell(ox, oy, 1.8 * glow, 1.8 * glow, PR.orb);
  p.set(Math.round(ox - 0.5), Math.round(oy - 0.5), PR.orbHi);
  if (cast)
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + f * 0.8;
      p.set(Math.round(ox + Math.cos(a) * 3.5), Math.round(oy + Math.sin(a) * 3.5), PR.orbHi);
    }
  // Глаза в прорезях маски.
  const ex = Math.round(hxp + 1.4);
  const ey = Math.round(hyp - 0.8);
  p.set(ex, ey, anim === 'hurt' ? INK : hx('#c89aff'));
  return { p, ax: bx, ay: G, eye: anim === 'hurt' ? null : [ex, ey] };
}

registerMobPainter('f9_priest', (m: Mob, pose: MobPose) => {
  let anim: string = pose.anim;
  let f = pose.frame;
  if (pose.mode === 'cast') {
    anim = 'cast';
    f = cyc(pose.t * 8, 2);
  } else if (anim === 'run') f = cyc(f, 4);
  else if (anim === 'idle') f = cyc(f, 4);
  else if (anim === 'wind' || anim === 'bite') {
    anim = 'cast';
    f = 0;
  } else f = 0;
  return frameOf('f9_priest', pose, anim, f, () => paintPriest(anim, f));
});

// ---------------------------------------------------------------------------
// Гидра: стихии голов — свои тона, общий силуэт. Шеи рисует зона `f9_necks`
// на полу (под телом и головами), сегментами по кривой.
// ---------------------------------------------------------------------------

interface ElemLook {
  skin: Tones;
  belly: Tones;
  crest: Tones;
  glow: RGBA;
  glowHi: RGBA;
  eye: RGBA;
}

/** 0 огонь, 1 лёд, 2 яд, 3 гроза, 4 свет, 5 скрытая голова. */
const ELEM: ElemLook[] = [
  {
    skin: T('#2a0806', '#6a160e', '#b0341a', '#ec6a34'),
    belly: T('#6a3a14', '#a8642a', '#d8944a', '#ffc47a'),
    crest: T('#140808', '#2e1612', '#4e2a22', '#7a4a3a'),
    glow: hx('#ff7a1a'),
    glowHi: hx('#fff0a0'),
    eye: hx('#ffe06a'),
  },
  {
    skin: T('#16243e', '#34568a', '#6a9ad0', '#c8e8ff'),
    belly: T('#4a5a6a', '#8aa0b4', '#c0d4e4', '#f0faff'),
    crest: T('#5a8ab8', '#9ad0f0', '#d8f4ff', '#ffffff'),
    glow: hx('#8ae8ff'),
    glowHi: hx('#ffffff'),
    eye: hx('#e8fcff'),
  },
  {
    skin: T('#10240c', '#26521a', '#4c8a26', '#94d046'),
    belly: T('#4a4a1a', '#8a8a34', '#bcb85a', '#e8e490'),
    crest: T('#2a1a3a', '#5a3470', '#8a5aa8', '#c090e0'),
    glow: hx('#b8f050'),
    glowHi: hx('#f0ffc0'),
    eye: hx('#f0ff6a'),
  },
  {
    skin: T('#141030', '#2e2468', '#5a4ab8', '#a898f4'),
    belly: T('#3a3450', '#6a6090', '#9a90c4', '#d0c8f0'),
    crest: T('#6a5a14', '#b8a02a', '#f0d84a', '#fff8b0'),
    glow: hx('#f0e04a'),
    glowHi: hx('#ffffff'),
    eye: hx('#fff8a0'),
  },
  {
    skin: T('#5a4a2a', '#a89468', '#dccca0', '#fffae0'),
    belly: T('#6a5a3a', '#b8a478', '#e4d8b0', '#fffcec'),
    crest: T('#8a6a14', '#c8a030', '#f0d060', '#fff4b0'),
    glow: hx('#fff0b0'),
    glowHi: hx('#ffffff'),
    eye: hx('#fff4c0'),
  },
  {
    skin: T('#08060e', '#1c1628', '#3a2e52', '#6a5a8a'),
    belly: T('#2a2a34', '#5a5a6a', '#9a9aac', '#e0e0f0'),
    crest: T('#4a4a5a', '#8a8aa0', '#c8c8dc', '#ffffff'),
    glow: hx('#b88aff'),
    glowHi: hx('#f4ecff'),
    eye: hx('#d0a0ff'),
  },
];

const HY = {
  body: T('#0c1a12', '#1e3a26', '#36603c', '#5e8a58'),
  plate: T('#1a2a14', '#34502a', '#587a40', '#8aa860'),
  spike: T('#0a0806', '#2a241c', '#4e443a', '#8a7a68'),
  belly: T('#3a3a1e', '#6a6636', '#948e54', '#bcb67a'),
  water: hx('#0e2a28'),
  waterLt: hx('#3a7a70'),
  foam: hx('#a8e0d0'),
  mud: T('#141008', '#2e2616', '#4a3e26', '#6a5a3a'),
  scar: hx('#6a1a14'),
};

/** Углы шей на теле — те же, что `anchorOf` в сценарии. */
const NECK_ANG = [
  Math.PI / 2,
  Math.PI / 2 - 1.05,
  Math.PI / 2 + 1.05,
  -Math.PI / 2,
  -0.4,
  Math.PI + 0.4,
  -Math.PI / 2 - 0.9,
  -Math.PI / 2 + 0.9,
];

/** Тело гидры: чешуйчатая гора в озере, гребень шипов, воротники шей. */
function paintBody(anim: string, f: number, risen: boolean): Built {
  const W = 80;
  const H = 60;
  const p = new Px(W, H);
  const ax = 40;
  const ay = 38;
  const cx = ax;
  const cy = ay + 4;
  const breath = anim === 'idle' ? [0, 0.6, 1, 0.6][f % 4] : anim === 'roar' ? 1.4 : 0;
  const dead = anim === 'dead';
  const rx = dead ? 22 : 21 + breath * 0.4;
  const ry = dead ? 10 : 12.5 + breath * 0.5;
  const top = cy - (dead ? 2 : 3) - breath * 0.6;
  if (risen && !dead) {
    // Вышло из ила: видны короткие лапы с когтями.
    for (const [dx, s] of [
      [-15, -1],
      [-8, -1],
      [8, 1],
      [15, 1],
    ] as const) {
      limb(p, cx + dx, cy + 6, cx + dx + s * 4, cy + 12, 3, 2, HY.body);
      for (let k = -1; k <= 1; k++) stroke(p, cx + dx + s * 4 + k * 1.5, cy + 12, cx + dx + s * 5 + k * 2, cy + 14, HY.spike[3]);
    }
  }
  // Воротники шей по краю тела (шеи уходят под них).
  for (const a of NECK_ANG) {
    const nx = cx + Math.cos(a) * rx * 0.9;
    const ny = top + Math.sin(a) * ry * 0.85;
    shadeEll(p, nx, ny, 4.4, 3.4, HY.plate, -0.1);
  }
  // Тело: горб, свет сверху-слева.
  shadeEll(p, cx, top, rx, ry, HY.body);
  // Пластины брони по хребту — от головы к хвосту.
  for (let i = 0; i < 9; i++) {
    const k = i / 8;
    const x = cx - rx * 0.75 + k * rx * 1.5;
    const y = top - ry * 0.35 - Math.sin(k * Math.PI) * ry * 0.35;
    shadeEll(p, x, y, 3.4, 2.4, HY.plate, 0.1);
  }
  // Гребень: ряд шипов, дышит (приподнимается).
  for (let i = 0; i < 8; i++) {
    const k = (i + 0.5) / 8;
    const x = cx - rx * 0.7 + k * rx * 1.4;
    const base = top - ry * 0.55 - Math.sin(k * Math.PI) * ry * 0.4;
    const hgt = (4 + Math.sin(k * Math.PI) * 5) * (dead ? 0.4 : 1) + breath;
    poly(
      p,
      [
        [x - 2, base + 1],
        [x + 0.5, base - hgt],
        [x + 2, base + 1],
      ],
      (px, py) => tone(HY.spike, 0.8 - (px - x + 2) * 0.2 - (py - base + hgt) * 0.02),
    );
  }
  // Чешуя и шрамы.
  scales(p, 0, 0, W - 1, H - 1, HY.body[0], HY.body[3], 17);
  for (const [x0, y0, x1, y1] of [
    [cx - 10, top + 2, cx - 4, top + 5],
    [cx + 6, top - 3, cx + 12, top - 1],
  ])
    stroke(p, x0, y0, x1, y1, HY.scar);
  p.outline(INK);
  // Вода у подножия: нижняя треть тонет в озере (кроме вылезшего).
  if (!risen || dead) {
    const wl = cy + 3;
    for (let y = Math.floor(wl); y < H; y++)
      for (let x = 0; x < W; x++) {
        if (!p.solid(x, y)) continue;
        const k = clamp01((y - wl) / 5);
        const c = p.get(x, y);
        p.set(x, y, mixc(c, HY.water, 0.4 + 0.5 * k));
      }
    // Пена по кромке воды.
    for (let x = cx - rx - 2; x <= cx + rx + 2; x++) {
      const y = Math.round(wl + Math.sin(x * 0.7 + f * 1.6) * 0.8);
      if (p.solid(x, y) || p.solid(x, y - 1)) p.set(x, y, alpha(HY.foam, (x + f) % 3 ? 0.9 : 0.5));
    }
  } else {
    // Ил налип на брюхо.
    for (let y = cy + 4; y < cy + 12; y++)
      for (let x = 0; x < W; x++) if (p.solid(x, y) && hash(x, y, 3) < 0.55) p.set(x, y, HY.mud[1 + (y % 2)]);
  }
  return { p, ax, ay, eye: null };
}

registerMobPainter('f9_body', (m: Mob, pose: MobPose) => {
  const risen = (m.data.risen ?? 0) > 0;
  let anim = pose.anim === 'dead' ? 'dead' : pose.mode === 'roar' && pose.t < 1.5 ? 'roar' : 'idle';
  const f = anim === 'idle' ? cyc(pose.t * 2.5, 4) : 0;
  if (anim === 'roar') anim = 'roar';
  return frameOf(risen ? 'f9_body_r' : 'f9_body', pose, anim, f, () => paintBody(anim, f, risen));
});

/** Голова гидры стихии `el`: клин морды, рога-гребень, глаз, пасть. */
function paintHead(el: number, anim: string, f: number, crown = false): Built {
  const L = ELEM[el];
  const s = crown ? 1.3 : 1;
  const W = Math.round(32 * s);
  const H = Math.round(28 * s);
  const p = new Px(W, H);
  const ax = Math.round(13 * s);
  const ay = Math.round(24 * s);
  const cx = 13 * s;
  const cy = 12 * s;
  let jaw = 0;
  let lunge = 0;
  let droop = 0;
  let recoil = 0;
  switch (anim) {
    case 'idle':
      jaw = [0, 0.1, 0.2, 0.1][f % 4];
      break;
    case 'wind':
      jaw = 0.8 + (f % 2) * 0.2;
      recoil = 1;
      break;
    case 'bite':
      lunge = 2.5;
      jaw = 0;
      break;
    case 'cast':
    case 'prism':
      jaw = 1;
      break;
    case 'heal':
      jaw = 0.3;
      break;
    case 'hurt':
      recoil = 2;
      jaw = 0.3;
      break;
    case 'dead':
      droop = 1;
      jaw = 0.6;
      break;
  }
  const hx0 = cx + lunge - recoil;
  const hy0 = cy + droop * 5;
  // Свет белой головы — нимб за затылком.
  if (el === 4 && !droop) {
    const R = 7 * s + (anim === 'heal' ? 1 + (f % 2) : 0);
    for (let a = 0; a < TAU; a += 0.12) {
      const x = Math.round(hx0 - 2 * s + Math.cos(a) * R);
      const y = Math.round(hy0 - 1 * s + Math.sin(a) * R * 0.9);
      p.set(x, y, alpha(L.glow, anim === 'heal' ? 0.95 : 0.6));
    }
  }
  // Шея-обрубок у затылка — сливается с шеей на полу.
  limb(p, hx0 - 12 * s, hy0 + 6 * s, hx0 - 4 * s, hy0 + 1.5 * s, 4.2 * s, 3.6 * s, L.skin);
  // Нижняя челюсть: опускается в замахе.
  const ja = 0.18 + jaw * 0.55 + droop * 0.4;
  const jx0 = hx0 + 1 * s;
  const jy0 = hy0 + 3 * s;
  const jx1 = jx0 + Math.cos(ja) * 10 * s;
  const jy1 = jy0 + Math.sin(ja) * 10 * s;
  limb(p, jx0, jy0, jx1, jy1, 2.4 * s, 1.3 * s, L.belly);
  // Пасть изнутри: тёмная, со светом стихии в касте.
  if (jaw > 0.4) {
    poly(
      p,
      [
        [hx0 + 2 * s, hy0 + 1.5 * s],
        [hx0 + 11 * s, hy0 + 1 * s],
        [jx1, jy1 - 1 * s],
        [jx0 + 1 * s, jy0],
      ],
      anim === 'cast' || anim === 'prism' ? L.glow : hx('#3a0a0e'),
    );
    if (anim === 'cast' || anim === 'prism') p.ell(hx0 + 6 * s, hy0 + 2.8 * s, 2 * s, 1.4 * s, L.glowHi);
    // Клыки.
    for (let k = 0; k < 3; k++) {
      const x = hx0 + (4 + k * 2.5) * s;
      p.set(Math.round(x), Math.round(hy0 + 1.5 * s), WHITE);
      p.set(Math.round(x), Math.round(hy0 + 2.5 * s), hx('#d8d0c0'));
    }
  }
  // Череп и морда.
  shadeEll(p, hx0, hy0, 6.2 * s, 4.8 * s, L.skin);
  limb(p, hx0 + 2 * s, hy0 + 0.2 * s, hx0 + 11 * s, hy0 + 1 * s, 3.4 * s, 2 * s, L.skin);
  // Гребень/рога по стихии.
  if (el === 1) {
    // Лёд: ледяные иглы назад.
    for (let k = 0; k < 4; k++) {
      const bx = hx0 - (1 + k * 1.8) * s;
      const by = hy0 - 3.8 * s + k * 0.8 * s;
      poly(
        p,
        [
          [bx - 1.2 * s, by + 1],
          [bx - (3 + k) * s, by - (5 - k) * s],
          [bx + 1.2 * s, by + 1],
        ],
        (x, y) => tone(L.crest, 0.9 - (y - by + 5 * s) * 0.05),
      );
    }
  } else if (el === 3) {
    // Гроза: два рога-молнии.
    for (const d of [0, 1]) {
      const bx = hx0 - (1 + d * 3) * s;
      const pts: [number, number][] = [
        [bx, hy0 - 3.5 * s],
        [bx - 2 * s, hy0 - 6 * s],
        [bx - 0.5 * s, hy0 - 7 * s],
        [bx - 3 * s, hy0 - 10 * s],
      ];
      for (let k = 0; k < 3; k++) stroke(p, pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1], L.crest[2 + (k % 2)], 1.6 * s);
    }
  } else if (el === 2) {
    // Яд: перепончатый гребень с пятнами.
    for (let k = 0; k < 5; k++) {
      const bx = hx0 - (k * 1.6 - 1) * s;
      const hgt = (4.5 - Math.abs(k - 1.5)) * s;
      limb(p, bx, hy0 - 3.8 * s, bx - 1.5 * s, hy0 - 3.8 * s - hgt, 1 * s, 0.4 * s, L.crest);
    }
  } else if (el === 5) {
    // Скрытая голова: корона из пяти рогов и плавники.
    for (let k = 0; k < 5; k++) {
      const a = -Math.PI / 2 - 0.9 + k * 0.38;
      const bx = hx0 - 1 * s + Math.cos(a) * 4 * s;
      const by = hy0 - 1 * s + Math.sin(a) * 3.5 * s;
      limb(p, bx, by, bx + Math.cos(a) * 5 * s - 2 * s, by + Math.sin(a) * 5 * s, 1.1 * s, 0.3 * s, L.crest);
    }
    for (let k = 0; k < 3; k++) limb(p, hx0 - 4 * s, hy0 + k * 1.5 * s, hx0 - 9 * s, hy0 - 1 * s + k * 2.5 * s, 1 * s, 0.4 * s, L.belly);
  } else {
    // Огонь и свет: два изогнутых рога назад.
    for (const d of [0, 1]) {
      const pts = spline(
        [
          [hx0 - (1 + d * 2) * s, hy0 - 3.5 * s],
          [hx0 - (4 + d * 2) * s, hy0 - 6 * s],
          [hx0 - (8 + d) * s, hy0 - 6.5 * s],
        ],
        3,
      );
      chain(p, pts, 1.4 * s, 0.4 * s, L.crest);
    }
  }
  scales(p, 0, 0, W - 1, H - 1, L.skin[0], L.skin[3], 29 + el);
  // Прожилки стихии по чешуе.
  if (el === 0)
    for (let k = 0; k < 6; k++) {
      const x = Math.round(hx0 - 4 * s + hash(k, 41) * 12 * s);
      const y = Math.round(hy0 - 2 * s + hash(k, 42) * 5 * s);
      if (p.solid(x, y)) p.set(x, y, (f + k) % 3 ? L.glow : L.glowHi);
    }
  if (el === 3)
    for (let k = 0; k < 3; k++) {
      const x = Math.round(hx0 - 3 * s + k * 3 * s);
      p.set(x, Math.round(hy0 - 1 * s), L.crest[3]);
      p.set(x + 1, Math.round(hy0), L.crest[2]);
    }
  if (el === 2 && jaw > 0.3) {
    // Яд капает с челюсти.
    p.set(Math.round(jx1 - 1), Math.round(jy1 + 2), L.glow);
    p.set(Math.round(jx1 - 1), Math.round(jy1 + 3 + (f % 2)), alpha(L.glow, 0.7));
  }
  p.outline(INK);
  // Ноздри и глаз (у скрытой — четыре глаза).
  p.set(Math.round(hx0 + 10.5 * s), Math.round(hy0 - 0.6 * s), INK);
  const ex = Math.round(hx0 + 2 * s);
  const ey = Math.round(hy0 - 1.6 * s);
  if (droop || anim === 'hurt') {
    p.set(ex - 1, ey, INK);
    p.set(ex, ey, INK);
    p.set(ex + 1, ey, INK);
  } else {
    p.set(ex, ey, L.eye);
    p.set(ex + 1, ey, L.eye);
    p.set(ex + 1, ey, INK);
    if (el === 5) {
      p.set(ex - 2, ey + 2, L.eye);
      p.set(ex + 2, ey - 2, L.eye);
      p.set(ex - 3, ey - 1, L.eye);
    }
  }
  return { p, ax, ay, eye: droop ? null : [ex, ey] };
}

registerMobPainter('f9_head', (m: Mob, pose: MobPose) => {
  const el = m.data.el ?? 0;
  const mode = pose.mode;
  let anim = 'idle';
  let f = cyc(pose.t * 5 + m.id, 4);
  if (pose.anim === 'dead') {
    anim = 'dead';
    f = 0;
  } else if (mode === 'rise') {
    const k = Math.min(3, Math.floor(pose.t * 4));
    return frameOf(`f9_head${el}`, pose, 'rise', k, () => {
      const b = paintHead(el, 'idle', 0);
      return { ...b, p: dissolve(b.p, 1 - (k + 1) / 4, 11) };
    });
  } else if (mode === 'bite') {
    anim = pose.t < 0.6 ? 'wind' : 'bite';
    f = cyc(pose.t * 10, 2);
  } else if (mode === 'cast') {
    anim = 'cast';
    f = cyc(pose.t * 10, 2);
  } else if (mode === 'heal') {
    anim = 'heal';
    f = cyc(pose.t * 6, 2);
  } else if (pose.anim === 'hurt') {
    anim = 'hurt';
    f = 0;
  }
  return frameOf(`f9_head${el}`, pose, anim, f, () => paintHead(el, anim, f));
});

/** Рябь ила над нырнувшей скрытой головой. */
function paintWake(f: number): Built {
  const p = new Px(28, 16);
  const cx = 14;
  shadeEll(p, cx, 11, 5 + (f % 2), 2.2, HY.mud);
  for (let i = 0; i < 3; i++) limb(p, cx - 3 + i * 3, 10, cx - 3 + i * 3 + 1, 7 - (i % 2) - (f % 2), 0.9, 0.3, ELEM[5].crest);
  p.outline(INK);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * TAU + f * 0.4;
    const x = Math.round(cx + Math.cos(a) * (8 + (f % 2)));
    const y = Math.round(11 + Math.sin(a) * 3.2);
    if (!p.solid(x, y)) p.set(x, y, alpha(HY.mud[3], 0.8));
  }
  return { p, ax: cx, ay: 14, eye: null };
}

registerMobPainter('f9_crown', (m: Mob, pose: MobPose) => {
  const mode = pose.mode;
  if (mode === 'hunt' || mode === 'whirl') {
    const f = cyc(pose.t * 8, 4);
    return frameOf('f9_crown', pose, 'wake', f, () => paintWake(f));
  }
  if (mode === 'rise' || mode === 'dive') {
    const k = Math.min(3, Math.floor(pose.t * (mode === 'rise' ? 3 : 6)));
    const kk = mode === 'rise' ? 1 - (k + 1) / 4 : (k + 1) / 4;
    return frameOf('f9_crown', pose, mode, k, () => {
      const b = paintHead(5, 'idle', 0, true);
      return { ...b, p: dissolve(b.p, kk, 13) };
    });
  }
  let anim = 'idle';
  let f = cyc(pose.t * 5, 4);
  if (pose.anim === 'dead') {
    anim = 'dead';
    f = 0;
  } else if (mode === 'bite') {
    anim = pose.t < 0.62 ? 'wind' : 'bite';
    f = cyc(pose.t * 10, 2);
  } else if (mode === 'prism') {
    anim = 'prism';
    f = cyc(pose.t * 10, 2);
  } else if (pose.anim === 'hurt') anim = 'hurt';
  return frameOf('f9_crown', pose, anim, f, () => paintHead(5, anim, f, true));
});

/** Обрубок шеи: срез с костью и кровью; прижжённый — угли и огонь. */
function paintStump(el: number, state: string, f: number): Built {
  // Обрубок стоит столбиком — срез смотрит вверх, к камере: так он
  // читается «шеей без головы» с любой стороны, а не банкой на боку.
  const L = ELEM[el];
  const W = 22;
  const H = 26;
  const p = new Px(W, H);
  const ax = 11;
  const ay = 23;
  const seared = state === 'seared';
  // Лужа крови у основания.
  if (!seared) p.ell(11, 23, 6.5, 2, alpha(hx('#5a0e0c'), 0.85));
  else p.ell(11, 23, 6, 1.8, alpha(hx('#1a120c'), 0.8));
  // Столб шеи.
  limb(p, 11, 22.5, 11, 13, 4.6, 4.1, L.skin);
  scales(p, 0, 10, W - 1, H - 1, L.skin[0], L.skin[3], 51);
  // Рваный край: зубцы кожи вокруг среза.
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * TAU;
    const x = Math.round(11 + Math.cos(a) * 4.6);
    const y = Math.round(12.5 + Math.sin(a) * 2.3 - (k % 2));
    p.set(x, y, L.skin[k % 2 ? 2 : 1]);
  }
  // Срез: мясо, в середине кость (или угли, если прижжено).
  p.ell(11, 12.5, 3.8, 2.1, seared ? hx('#1a100c') : hx('#7a1612'));
  p.ell(11, 12.3, 2.7, 1.4, seared ? hx('#2e1a10') : hx('#c83a2a'));
  p.ell(11, 12.2, 1.1, 0.7, seared ? hx('#4a3a2a') : hx('#f0e6d0'));
  if (!seared) {
    // Кровь стекает по шее — две струйки, растут и срываются.
    const dl = [2, 4, 6, 3][f % 4];
    for (let i = 0; i < dl; i++) p.set(8, 14 + i, i === dl - 1 ? hx('#c83a2a') : hx('#8a1a14'));
    for (let i = 0; i < ((f + 2) % 4) + 1; i++) p.set(13, 14 + i, hx('#8a1a14'));
  }
  p.outline(INK);
  if (seared) {
    // Угли по кромке и язык огня.
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU + f;
      p.set(Math.round(11 + Math.cos(a) * 3.6), Math.round(12.5 + Math.sin(a) * 2), (k + f) % 2 ? hx('#ff7a1a') : hx('#ffd24a'));
    }
    // Прижжённый срез не горит — тлеет: дымок, а не пламя (с пламенем
    // обрубок читался свечкой).
    for (let i = 0; i < 9; i++) {
      const y = 10 - i;
      const x = Math.round(11 + Math.sin((i + f * 1.5) * 0.9) * (0.6 + i * 0.25));
      const a = 0.75 - i * 0.07;
      p.set(x, y, alpha(i < 2 ? hx('#6a5a4a') : hx('#8a8a86'), a));
      if (i > 3 && i % 2) p.set(x + 1, y, alpha(hx('#a8a8a2'), a * 0.6));
    }
  }
  if (state === 'can') {
    // Прижги! — золотая стрелка вниз, на срез.
    const by = 1 + (f % 2);
    for (let i = 0; i < 4; i++) {
      p.set(8 + i, by + i, GOLD);
      p.set(14 - i, by + i, GOLD);
    }
    p.set(11, by + 4, hx('#fff4b0'));
    p.set(11, by + 5, hx('#ff7a1a'));
  }
  return { p, ax, ay, eye: null };
}

registerMobPainter('f9_stump', (m: Mob, pose: MobPose) => {
  const el = m.data.el ?? 0;
  const state = pose.mode === 'seared' ? 'seared' : (m.data.can ?? 0) > 0 ? 'can' : 'bleed';
  const f = state === 'seared' ? cyc(pose.t * 8, 4) : cyc(pose.t * 3, 2);
  if (pose.anim === 'dead') return frameOf(`f9_stump${el}`, pose, 'dead', 0, () => {
    const b = paintStump(el, 'bleed', 0);
    return { ...b, p: dissolve(b.p, 0.5, 3) };
  });
  return frameOf(`f9_stump${el}`, pose, state, f, () => paintStump(el, state, f));
});

// --- Шеи на полу: сегменты по кривой от тела к голове. ---

const segCache = new Map<string, HTMLCanvasElement>();

/** Сегмент шеи радиуса r: круг с объёмом, чешуйкой и шипом гребня. */
function neckSeg(el: number, r: number, cut: number, spike: boolean): HTMLCanvasElement {
  const key = `${el}|${r}|${cut}|${spike ? 1 : 0}`;
  let c = segCache.get(key);
  if (c) return c;
  const L = ELEM[el];
  const S = r * 2 + 6;
  const p = new Px(S, S);
  const t: Tones = cut === 2 ? T('#0e0806', '#241a14', '#3a2a20', '#5a4436') : L.skin;
  shadeEll(p, S / 2, S / 2 + 1, r, r * 0.9, t);
  shadeEll(p, S / 2 + 0.5, S / 2 + r * 0.45 + 1, r * 0.6, r * 0.35, cut === 2 ? t : L.belly, 0.1);
  if (spike)
    poly(
      p,
      [
        [S / 2 - 1.5, S / 2 - r * 0.6],
        [S / 2 - 0.5, S / 2 - r - 2.5],
        [S / 2 + 1, S / 2 - r * 0.6],
      ],
      cut === 2 ? t[0] : L.crest[1],
    );
  p.outline(INK);
  c = p.canvas();
  segCache.set(key, c);
  return c;
}

registerZonePainter('f9_necks', (g, z, px, py, S, time) => {
  const left = z.x * S - px;
  const top = z.y * S - py;
  const phase = F9_VIEW.phase;
  // Круги по воде вокруг тела (в иле — пузыри).
  if (phase >= 0 && phase < 3) {
    for (let k = 0; k < 3; k++) {
      const u = (time * 0.35 + k / 3) % 1;
      const R = (1.8 + u * 3.2) * S;
      g.strokeStyle = `rgba(168,224,208,${(0.35 * (1 - u)).toFixed(3)})`;
      g.lineWidth = 1;
      g.beginPath();
      g.ellipse(Math.round(px), Math.round(py), R, R * 0.62, 0, 0, TAU);
      g.stroke();
    }
  } else if (phase === 3) {
    g.fillStyle = 'rgba(106,90,58,0.8)';
    for (let k = 0; k < 6; k++) {
      const u = (time * 0.8 + k * 0.37) % 1;
      const a = k * 1.9;
      const d = (1.2 + (k % 3)) * S;
      const r = 1 + u * 2;
      g.beginPath();
      g.arc(Math.round(px + Math.cos(a) * d), Math.round(py + Math.sin(a) * d * 0.6), r, 0, TAU);
      g.fill();
    }
  }
  // Шеи: от основания у тела к голове, с изгибом вверх (шея поднята).
  for (const n of F9_VIEW.necks) {
    const ax = n.ax * S - left;
    const ay = n.ay * S - top;
    const bob = n.id ? Math.round(Math.sin(time * 5 + n.id) * 1.5) : 0;
    const hx2 = n.hx * S - left;
    const hy2 = n.hy * S - top + (n.id ? -6 - 4 + bob : -2);
    const dx = hx2 - ax;
    const dy = hy2 - ay;
    const L = Math.hypot(dx, dy) || 1;
    // Контрольная точка: середина, поднятая и отведённая вбок.
    const sway = Math.sin(time * 1.6 + n.ax * 3 + n.hx) * 0.18;
    const mx = ax + dx * 0.5 - (dy / L) * L * sway;
    const my = ay + dy * 0.5 + (dx / L) * L * sway - Math.min(14, L * 0.35) * (n.cut ? 0.2 : 1);
    const steps = Math.max(4, Math.ceil(L / 3));
    const r0 = n.big ? 6 : 5;
    const r1 = n.big ? 5 : 4;
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const x = (1 - u) * (1 - u) * ax + 2 * (1 - u) * u * mx + u * u * hx2;
      const y = (1 - u) * (1 - u) * ay + 2 * (1 - u) * u * my + u * u * hy2;
      const r = Math.round(r0 + (r1 - r0) * u);
      const img = neckSeg(n.el, r, n.cut, i % 3 === 1);
      g.drawImage(img, Math.round(x - img.width / 2), Math.round(y - img.height / 2));
    }
  }
  return true;
});

// ---------------------------------------------------------------------------
// Реквизит этажа. Живые (кадрами): круги, грибы, кристаллы, жаровни,
// камыш, кувшинки, лианы, грибы-лампы, идол, рунный камень, икра.
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
function flame(p: Px, x: number, y: number, h: number, f: number, w = 2.2): void {
  const sway = [0, 1, 0, -1][f % 4];
  for (let i = 0; i < h; i++) {
    const k = i / h;
    const ww = (1 - k) * w + 0.4;
    const cx = x + sway * k * 1.2;
    for (let dx = -Math.ceil(ww); dx <= Math.ceil(ww); dx++) {
      if (Math.abs(dx) > ww) continue;
      const core = Math.abs(dx) / ww;
      const c =
        k > 0.8 ? FIRE[1] : core < 0.35 && k < 0.6 ? FIRE[3] : core < 0.7 ? FIRE[2] : FIRE[1];
      p.set(Math.round(cx + dx), y - i, c);
    }
  }
  if (f % 2) p.set(x + sway, y - h - 1, FIRE[1]);
}

/** Цвета кругов: [тёмный, основной, светлый, блик]. 0 серый … 10 бирюза выхода. */
const RING_PAL: Tones[] = [
  T('#1e1c22', '#3a3844', '#5e5c6a', '#8a8898'),
  T('#0a3a3a', '#1a8a84', '#46e0d0', '#c8fff6'),
  T('#123a12', '#2a8a2a', '#6ae04a', '#d8ffb8'),
  T('#2a1450', '#5a34a8', '#9a70ff', '#e8d8ff'),
  T('#0e1e4a', '#2448a8', '#5a8aff', '#d0e0ff'),
  T('#4a3208', '#a8740e', '#ffc830', '#fff4b0'),
  T('#3a3a44', '#8a8aa0', '#dcdcf0', '#ffffff'),
  T('#4a080e', '#a81a2a', '#ff4a5a', '#ffd0d4'),
  T('#4a2008', '#a84a10', '#ff8a2a', '#ffe0b0'),
  T('#0a3a3a', '#1a8a84', '#46e0d0', '#c8fff6'),
  T('#0a3a3a', '#1a8a84', '#46e0d0', '#c8fff6'),
];

/** Руны пар: 5×5 знаков — у каждой пары свой. */
const GLYPH: string[][] = [
  ['.....', '..#..', '.#.#.', '..#..', '.....'],
  ['#...#', '.#.#.', '..#..', '..#..', '..#..'],
  ['..#..', '.###.', '#.#.#', '..#..', '..#..'],
  ['#####', '.#.#.', '..#..', '.#.#.', '#####'],
  ['#...#', '##.##', '#.#.#', '#...#', '#...#'],
  ['..#..', '.#.#.', '#...#', '.#.#.', '..#..'],
  ['.###.', '#...#', '#.#.#', '#...#', '.###.'],
  ['#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
  ['#.#.#', '.#.#.', '#.#.#', '.#.#.', '#.#.#'],
  ['..#..', '..#..', '#####', '..#..', '..#..'],
  ['.#.#.', '#####', '.#.#.', '#####', '.#.#.'],
];

function glyph(p: Px, x0: number, y0: number, g: string[], c: RGBA): void {
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) if (g[y][x] === '#') p.set(x0 + x, y0 + y, c);
}

/** Круг-телепорт: кольцо рун, в центре — руна пары; 8 кадров вращения. */
function ringSprite(col: number, state: number, f: number): Sprite {
  return spriteOf(`ring|${col}|${state}|${f}`, () => {
    const W = 28;
    const H = 18;
    const p = new Px(W, H);
    const cx = W / 2;
    const cy = 9;
    const spin = state === RS.spin;
    const pal = RING_PAL[spin ? 1 + (f % 8) : col] ?? RING_PAL[0];
    const on = state === RS.on || state === RS.charge || spin;
    const trap = state === RS.trap;
    const dim = state === RS.off || state === RS.dormant || state === RS.exit;
    const rx = 11;
    const ry = 6.4;
    // Каменный диск основания — уже в клетке; здесь светящийся желоб.
    for (let a = 0; a < TAU; a += 0.035) {
      const x = Math.round(cx + Math.cos(a) * rx);
      const y = Math.round(cy + Math.sin(a) * ry);
      p.set(x, y, dim ? pal[1] : pal[2]);
      const x2 = Math.round(cx + Math.cos(a) * (rx - 2.5));
      const y2 = Math.round(cy + Math.sin(a) * (ry - 1.6));
      if (!dim || (Math.floor(a * 10) % 3 === 0)) p.set(x2, y2, dim ? pal[0] : pal[1]);
    }
    // Руны по кольцу: шесть штрихов, бегут по кругу.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + (f / 8) * (TAU / 6) * (spin ? 3 : 1);
      const x = Math.round(cx + Math.cos(a) * (rx - 1.2));
      const y = Math.round(cy + Math.sin(a) * (ry - 0.8));
      const c = on ? (i === f % 6 ? pal[3] : pal[2]) : pal[1];
      p.set(x, y, c);
      p.set(x + 1, y, c);
      if (on) p.set(x, y - 1, alpha(pal[3], 0.5));
    }
    // Руна пары в центре (у ловушки — треснувшая).
    const g = GLYPH[col] ?? GLYPH[0];
    glyph(p, Math.round(cx) - 2, Math.round(cy) - 2, g, on ? pal[3] : pal[1]);
    if (trap) {
      glyph(p, Math.round(cx) - 2, Math.round(cy) - 2, GLYPH[7], RING_PAL[7][f % 2 ? 3 : 2]);
      // Трещина через кольцо.
      for (let k = 0; k < 7; k++) p.set(Math.round(cx - 6 + k * 2), Math.round(cy - 3 + (k % 2) * 2 + k * 0.6), INK);
    }
    if (state === RS.dormant)
      for (let k = 0; k < 6; k++) p.set(Math.round(cx - 7 + k * 2.6), Math.round(cy + 2 - (k % 2) * 3), INK);
    if (state === RS.charge) {
      // Налился: заполнен светом, искры вверх.
      p.ell(cx, cy, rx - 3, ry - 2, alpha(pal[2], 0.45));
      for (let k = 0; k < 5; k++) {
        const x = Math.round(cx - 7 + k * 3.5);
        const y = Math.round(cy - 2 - ((f * 3 + k * 5) % 9));
        if (y >= 0) p.set(x, y, pal[3]);
      }
    }
    return { img: p.canvas(), ax: Math.round(cx), ay: 16 };
  });
}

registerPropPainter('f9_ring', (o: WorldObj, time) => {
  const col = F9_VIEW.ringColor.get(o.id) ?? 0;
  const state = F9_VIEW.ringState.get(o.id) ?? RS.on;
  const rate = state === RS.spin ? 16 : state === RS.charge ? 14 : 5;
  const f = cyc(time * rate + o.x, 8);
  return ringSprite(col, state, f);
});

/** Грибы-лампы: три шляпки светятся, споры поднимаются. */
const SHROOM = {
  stem: T('#4a4a3a', '#8a8a6a', '#c0bc98', '#e8e4c8'),
  cap: T('#0a3a3a', '#1a7a6a', '#3ad0a8', '#b0ffe0'),
  spot: hx('#e0fff0'),
  spore: hx('#9affd8'),
};

registerPropPainter('f9_shroom', (o, time) => {
  const v = Math.floor(hash(o.x, o.y, 3) * 3);
  const f = cyc(time * 3 + o.x * 0.7, 4);
  return spriteOf(`shroom|${v}|${f}`, () => {
    const p = new Px(20, 22);
    const caps: [number, number, number][] =
      v === 0
        ? [
            [6, 12, 3.4],
            [13, 9, 4.2],
            [16, 15, 2.6],
          ]
        : v === 1
          ? [
              [9, 8, 4.6],
              [4, 14, 2.8],
              [15, 13, 3.2],
            ]
          : [
              [7, 10, 3.8],
              [14, 12, 3.4],
              [10, 16, 2.4],
            ];
    for (const [x, y, r] of caps) limb(p, x, y, x - 0.5, 20, r * 0.35, r * 0.45, SHROOM.stem);
    const glow = [0, 0.15, 0.3, 0.15][f];
    for (const [x, y, r] of caps) {
      shadeEll(p, x, y, r, r * 0.62, SHROOM.cap, glow);
      for (let k = 0; k < 3; k++) p.set(Math.round(x - r * 0.4 + k * r * 0.4), Math.round(y - r * 0.25), SHROOM.spot);
    }
    p.outline(INK);
    for (const [x, y, r] of caps) for (let dx = -Math.floor(r * 0.6); dx <= r * 0.6; dx++) p.set(Math.round(x + dx), Math.round(y + r * 0.62), hx('#2a8a70'));
    // Споры вверх.
    for (let k = 0; k < 4; k++) {
      const y = 8 - ((f * 2 + k * 4) % 9);
      const x = 4 + k * 4 + (k % 2);
      if (y >= 0) p.set(x, y, alpha(SHROOM.spore, 0.8));
    }
    return { img: p.canvas(), ax: 10, ay: 21 };
  });
});

/** Кристалл маны: лиловые грани, блик бежит по ним. */
const CRYS = T('#1e1040', '#4a2a8a', '#8a5ae0', '#e0d0ff');

registerPropPainter('f9_crystal', (o, time) => {
  const v = Math.floor(hash(o.x, o.y, 5) * 2);
  const f = cyc(time * 5 + o.y, 6);
  return spriteOf(`crystal|${v}|${f}`, () => {
    const p = new Px(20, 26);
    const shards: [number, number, number, number][] = v
      ? [
          [10, 24, 3.2, 20],
          [5, 24, 2.2, 12],
          [15, 24, 2.4, 14],
        ]
      : [
          [9, 24, 3, 18],
          [14, 24, 2.6, 15],
          [4, 24, 2, 10],
        ];
    shards.forEach(([x, b, w, h], k) => {
      poly(
        p,
        [
          [x - w, b],
          [x - w * 0.7, b - h * 0.8],
          [x, b - h],
          [x + w * 0.7, b - h * 0.8],
          [x + w, b],
        ],
        (px, py) => {
          const left = px < x;
          const t = left ? 0.85 : 0.35;
          return tone(CRYS, t - (py - (b - h)) * 0.012 + k * 0.02);
        },
      );
    });
    p.outline(INK);
    // Блик бежит снизу вверх по большому осколку.
    const [x, b, , h] = shards[0];
    const y = Math.round(b - 2 - ((f / 6) * (h - 3)));
    p.set(x - 1, y, CRYS[3]);
    p.set(x - 1, y - 1, WHITE);
    p.set(x, y + 1, CRYS[3]);
    // Искры маны вокруг.
    if (f % 3 === 0) p.set(3 + f, 6, alpha(CRYS[3], 0.9));
    return { img: p.canvas(), ax: 10, ay: 25 };
  });
});

/** Жаровня арены: чаша на треноге, огонь; упавшая — дым. */
const IRON = T('#16161a', '#34343c', '#58585e', '#8a8a92');

registerPropPainter('f9_brazier', (o, time) => {
  const lit = F9_VIEW.braziers.get(o.id) ?? true;
  const f = cyc(time * 9 + o.x, 4);
  return spriteOf(`brazier|${lit ? 1 : 0}|${f}`, () => {
    const p = new Px(22, 30);
    // Тренога.
    for (const [x0, x1] of [
      [6, 3],
      [16, 19],
      [11, 11],
    ])
      limb(p, x0, 17, x1, 28, 1, 0.8, IRON);
    // Чаша с углями.
    shadeEll(p, 11, 16, 7, 3.2, IRON);
    for (let x = 5; x <= 17; x++) p.set(x, 14, IRON[3]);
    p.ell(11, 14.5, 5.5, 1.4, hx('#3a1a0a'));
    for (let k = 0; k < 6; k++) p.set(6 + k * 2, 14 + (k % 2), (k + f) % 2 ? FIRE[1] : FIRE[0]);
    p.outline(INK);
    if (lit) {
      flame(p, 8, 14, 7, f, 2.4);
      flame(p, 13, 14, 10, (f + 1) % 4, 2.8);
      flame(p, 16, 14, 6, (f + 2) % 4, 1.8);
    }
    return { img: p.canvas(), ax: 11, ay: 29 };
  });
});

registerPropPainter('f9_brazier_out', (o, time) => {
  const f = cyc(time * 3 + o.x, 4);
  return spriteOf(`brazierout|${f}`, () => {
    const p = new Px(26, 26);
    // Опрокинута: чаша на боку, угли в воде, дым.
    shadeEll(p, 12, 20, 6.5, 3, IRON);
    p.ell(8, 20, 2.6, 2.4, hx('#1a1210'));
    limb(p, 16, 18, 23, 13, 1, 0.8, IRON);
    limb(p, 15, 22, 22, 24, 1, 0.8, IRON);
    p.outline(INK);
    for (let k = 0; k < 3; k++) p.set(5 + k * 2, 22, k === f % 3 ? FIRE[0] : hx('#3a2a20'));
    for (let k = 0; k < 4; k++) {
      const y = 16 - k * 4 - (f % 4);
      const x = 8 + Math.round(Math.sin(k + f * 0.8) * 2);
      if (y >= 0) p.ell(x, y, 1.6 + k * 0.4, 1.2 + k * 0.3, alpha(hx('#8a8a88'), 0.5 - k * 0.1));
    }
    return { img: p.canvas(), ax: 12, ay: 25 };
  });
});

/** Камыш: стебли с бархатными початками, качаются. */
const REED = { stem: T('#1e2a0e', '#3a5018', '#5e7a26', '#86a23a'), head: T('#2a160c', '#5a3218', '#7e4a24', '#a06a3a') };

registerPropPainter('f9_reeds', (o, time) => {
  const v = Math.floor(hash(o.x, o.y, 7) * 3);
  const f = cyc(time * 2.2 + o.x * 0.9 + o.y * 0.3, 4);
  return spriteOf(`reeds|${v}|${f}`, () => {
    const p = new Px(16, 24);
    const n = 4 + v;
    for (let i = 0; i < n; i++) {
      const x = 2 + i * (12 / n) + hash(i, v) * 1.5;
      const h = 12 + hash(i, v, 2) * 8;
      const sway = [0, 1, 1.4, 1][(f + i) % 4] * (i % 2 ? 1 : 0.7);
      const tx = x + sway;
      stroke(p, x, 22, tx, 22 - h, REED.stem[1 + (i % 3)]);
      if (i % 2 === 0) limb(p, tx, 22 - h + 1, tx + sway * 0.2, 22 - h + 4.5, 1.2, 1.2, REED.head);
      else stroke(p, tx, 22 - h, tx + sway + 1.5, 22 - h - 3, REED.stem[3]);
    }
    p.outline(alpha(INK, 0.8));
    return { img: p.canvas(), ax: 8, ay: 22 };
  });
});

/** Кувшинки на воде: круглые листья с вырезом, изредка цветок. */
const LILY = T('#0e2a0e', '#1e5a1c', '#3a8a2e', '#7ac050');

registerPropPainter('f9_lily', (o, time) => {
  const v = Math.floor(hash(o.x, o.y, 9) * 4);
  const f = cyc(time * 1.5 + o.x + o.y * 0.5, 4);
  return spriteOf(`lily|${v}|${f}`, () => {
    const p = new Px(18, 14);
    const bob = [0, 0.4, 0.6, 0.3][f];
    const pads: [number, number, number][] =
      v === 0
        ? [
            [6, 8, 3.6],
            [12, 10, 2.8],
          ]
        : v === 1
          ? [[9, 9, 4]]
          : [
              [5, 10, 2.6],
              [11, 7, 3.2],
              [13, 11, 2.2],
            ];
    for (const [x, y, r] of pads) {
      shadeEll(p, x, y + bob, r, r * 0.6, LILY);
      // Вырез листа.
      for (let k = 0; k < r; k++) clear(p, Math.round(x + k * 0.5), Math.round(y + bob - k * 0.3));
      p.set(Math.round(x - r * 0.3), Math.round(y + bob - r * 0.2), LILY[3]);
    }
    p.outline(alpha(hx('#06120a'), 0.9));
    if (v === 2 || v === 1) {
      // Розовый цветок кувшинки.
      const [x, y] = pads[0];
      p.ell(x + 0.5, y - 1 + bob, 1.8, 1.2, hx('#e87aa0'));
      p.set(Math.round(x + 0.5), Math.round(y - 2 + bob), hx('#ffd0e0'));
      p.set(Math.round(x + 0.5), Math.round(y - 1 + bob), hx('#ffe07a'));
    }
    return { img: p.canvas(), ax: 9, ay: 13 };
  });
});

/** Лианы со стены: свисают на лицо стены, кончики качаются. */
const VINE = T('#0e2210', '#1e4a1e', '#3a7a2e', '#6aaa44');

registerPropPainter('f9_vine', (o, time) => {
  const v = Math.floor(hash(o.x, o.y, 11) * 3);
  const f = cyc(time * 1.8 + o.x * 0.6, 4);
  return spriteOf(`vine|${v}|${f}`, () => {
    const p = new Px(16, 22);
    const n = 3 + v;
    for (let i = 0; i < n; i++) {
      const x = 2 + i * (12 / n) + hash(i, v, 3) * 2;
      const len = 10 + hash(i, v, 4) * 10;
      const sway = [0, 0.6, 1, 0.6][(f + i) % 4] * (i % 2 ? 1 : -1);
      const pts: [number, number][] = [
        [x, 0],
        [x + sway * 0.3, len * 0.4],
        [x + sway * 0.7, len * 0.75],
        [x + sway, len],
      ];
      const s = spline(pts, 4);
      s.forEach(([px, py], k) => {
        p.set(Math.floor(px), Math.floor(py), VINE[1 + (k % 2)]);
        if (k % 4 === 2) {
          p.set(Math.floor(px) + 1, Math.floor(py), VINE[3]);
          p.set(Math.floor(px) - 1, Math.floor(py) + 1, VINE[2]);
        }
      });
    }
    if (v === 2) {
      p.set(9, 12, hx('#e8c040'));
      p.set(10, 12, hx('#fff0a0'));
    }
    p.outline(alpha(INK, 0.7));
    return { img: p.canvas(), ax: 8, ay: 16 };
  });
});

/** Гриб-лампа на стене: полка трутовиков светится зелёным, дышит. */
registerPropPainter('f9_walllamp', (o, time) => {
  const f = cyc(time * 2 + o.x, 4);
  return spriteOf(`walllamp|${f}`, () => {
    const p = new Px(16, 18);
    const glow = [0, 0.2, 0.35, 0.2][f];
    const cap = T('#0e3a14', '#2a8a2a', '#6ae04a', '#e0ffc0');
    shadeEll(p, 8, 9, 6, 2.4, cap, glow);
    shadeEll(p, 5, 12.5, 3.6, 1.6, cap, glow);
    shadeEll(p, 11, 13.5, 3, 1.4, cap, glow);
    p.outline(INK);
    for (let x = 3; x <= 13; x += 2) p.set(x, 11, alpha(cap[3], 0.7));
    // Капли света падают.
    const y = 15 + (f % 3);
    if (y < 18) p.set(7 + (f % 2) * 3, y, alpha(cap[3], 0.8));
    return { img: p.canvas(), ax: 8, ay: 16 };
  });
});

/** Идол-змей: столб с головой змеи, мох, глаза тлеют бирюзой. */
const STONE = T('#26282a', '#4a4e4c', '#727872', '#a0a69c');

registerPropPainter('f9_idol', (o, time) => {
  const blink = cyc(time * 0.8 + o.x * 0.3, 8) === 0;
  return spriteOf(`idol|${blink ? 1 : 0}`, () => {
    const p = new Px(20, 34);
    // Постамент и столб.
    for (let y = 28; y <= 32; y++) for (let x = 3; x <= 16; x++) p.set(x, y, tone(STONE, 0.6 - (x - 3) * 0.05 - (y === 32 ? 0.4 : 0)));
    limb(p, 10, 27, 10, 13, 4, 3.4, STONE);
    // Кольца змеиного тела по столбу.
    for (let y = 16; y <= 26; y += 4) stroke(p, 6, y, 14, y + 1, STONE[0]);
    // Голова змеи с капюшоном.
    shadeEll(p, 10, 9, 6.2, 5, STONE);
    shadeEll(p, 10, 6.5, 3.4, 3.2, STONE, 0.1);
    limb(p, 10, 7, 10, 3, 2.2, 1.4, STONE);
    // Мох.
    for (let k = 0; k < 10; k++) {
      const x = Math.round(4 + hash(k, 3) * 12);
      const y = Math.round(6 + hash(k, 4) * 24);
      if (p.solid(x, y)) p.set(x, y, hx('#3a6a2a'));
    }
    p.outline(INK);
    p.set(8, 6, blink ? INK : hx('#6affe0'));
    p.set(12, 6, blink ? INK : hx('#6affe0'));
    if (!blink) {
      p.set(8, 5, alpha(hx('#c8fff0'), 0.8));
      p.set(12, 5, alpha(hx('#c8fff0'), 0.8));
    }
    return { img: p.canvas(), ax: 10, ay: 33 };
  });
});

/** Обломок колонны: мох, трещины, у одного — сбитая капитель. */
registerPropPainter('f9_column', (o) => {
  const v = Math.floor(hash(o.x, o.y, 13) * 2);
  return spriteOf(`column|${v}`, () => {
    const p = new Px(18, 32);
    const top = v ? 10 : 4;
    for (let y = 26; y <= 30; y++) for (let x = 2; x <= 15; x++) p.set(x, y, tone(STONE, 0.6 - (x - 2) * 0.06 - (y === 30 ? 0.4 : 0)));
    for (let y = top + 3; y < 26; y++)
      for (let x = 4; x <= 13; x++) {
        const k = (x - 4) / 9;
        const fl = (x - 4) % 3 === 2 ? -0.25 : 0;
        p.set(x, y, tone(STONE, 0.75 - k * 0.8 + fl));
      }
    // Излом сверху.
    for (let x = 4; x <= 13; x++) {
      const t = top + Math.round(hash(x, v, 2) * 3);
      for (let y = t; y < top + 3; y++) p.set(x, y, tone(STONE, 0.6 - (x - 4) * 0.07));
    }
    if (!v) for (let y = 1; y <= 4; y++) for (let x = 1; x <= 16; x++) p.set(x, y, tone(STONE, 0.65 - (x - 1) * 0.05 - (y === 4 ? 0.4 : 0)));
    // Мох и плющ снизу вверх.
    for (let k = 0; k < 16; k++) {
      const x = Math.round(3 + hash(k, v, 5) * 12);
      const y = Math.round(top + 4 + hash(k, v, 6) * 22);
      if (p.solid(x, y) && y > 14) p.set(x, y, k % 3 ? hx('#3a6a2a') : hx('#5a9a3a'));
    }
    stroke(p, 7, top + 6, 9, top + 15, STONE[0]);
    p.outline(INK);
    return { img: p.canvas(), ax: 9, ay: 31 };
  });
});

/** Урна: глиняная, в болотной тине; бьётся. */
const CLAY = T('#3a2a14', '#6a4a24', '#94703a', '#c09a5a');

registerPropPainter('f9_urn', (o, _time, _alive, flash) => {
  const v = Math.floor(hash(o.x, o.y, 15) * 2);
  return spriteOf(`urn|${v}|${flash ? 1 : 0}`, () => {
    let p = new Px(14, 17);
    shadeEll(p, 7, 11, 5, 4.8, CLAY);
    limb(p, 7, 3.5, 7, 6.5, 2, 2.6, CLAY);
    shadeEll(p, 7, 3.5, 2.8, 1, CLAY, 0.2);
    for (let x = 3; x <= 11; x++) p.set(x, 10, CLAY[0]);
    // Тина по низу и узор-змейка.
    for (let x = 3; x <= 11; x++) {
      p.set(x, 13 + (x % 2), hx('#3a5a1e'));
      if (v) p.set(x, 8 + ((x >> 1) % 2), hx('#d0b070'));
    }
    p.outline(INK);
    p.set(7, 3, hx('#1a1008'));
    if (flash) p = p.tint(WHITE, 0.85);
    return { img: p.canvas(), ax: 7, ay: 16 };
  });
});

/** Икра жаб: студень с тёмными точками; дрожит. */
registerPropPainter('f9_eggs', (o, time, _alive, flash) => {
  const f = cyc(time * 2 + o.x, 2);
  return spriteOf(`eggs|${f}|${flash ? 1 : 0}`, () => {
    let p = new Px(16, 12);
    for (let k = 0; k < 9; k++) {
      const x = 3 + (k % 4) * 3 + (k > 3 ? 1.5 : 0);
      const y = 5 + Math.floor(k / 4) * 2.5 + (f && k % 2 ? 0.4 : 0);
      p.ell(x, y, 1.8, 1.5, alpha(hx('#a8c890'), 0.85));
    }
    p.outline(alpha(hx('#2a3a1a'), 0.9));
    for (let k = 0; k < 9; k++) p.set(Math.round(3 + (k % 4) * 3 + (k > 3 ? 1.5 : 0)), Math.round(5 + Math.floor(k / 4) * 2.5), hx('#1a1a10'));
    if (flash) p = p.tint(WHITE, 0.85);
    return { img: p.canvas(), ax: 8, ay: 11 };
  });
});

/** Гнилое бревно с трутовиками. */
registerPropPainter('f9_log', (o) => {
  const v = Math.floor(hash(o.x, o.y, 17) * 2);
  return spriteOf(`log|${v}`, () => {
    const p = new Px(26, 14);
    const bark = T('#1a120a', '#3a2814', '#5a4222', '#7a5e36');
    limb(p, 3, 9, 23, 8, 3.6, 3.2, bark);
    p.ell(23, 8, 2.4, 3, hx('#8a6a42'));
    p.ell(23, 8, 1.2, 1.6, hx('#5a4228'));
    for (let x = 5; x < 21; x += 3) stroke(p, x, 6, x + 2, 7, bark[0]);
    // Трутовики и мох.
    shadeEll(p, 9, 5, 2.4, 1, T('#4a2a0a', '#8a5a1a', '#c08a3a', '#f0c070'));
    shadeEll(p, 15, 5.5, 1.8, 0.8, T('#4a2a0a', '#8a5a1a', '#c08a3a', '#f0c070'));
    if (v) for (let x = 4; x < 12; x++) p.set(x, 11, hx('#3a6a2a'));
    p.outline(INK);
    return { img: p.canvas(), ax: 13, ay: 13 };
  });
});

/** Кости: скелет смельчака и сломанное копьё ящеров. */
const BONE = T('#6a6050', '#a89c84', '#d4cab0', '#f0e8d4');

registerPropPainter('f9_bones', (o) => {
  const v = Math.floor(hash(o.x, o.y, 19) * 3);
  return spriteOf(`bones|${v}`, () => {
    const p = new Px(20, 14);
    const sx = v === 1 ? 5 : 14;
    shadeEll(p, sx, 7, 3, 2.7, BONE);
    shadeEll(p, sx + (v === 1 ? -1.2 : 1.2), 9, 1.8, 1.2, BONE);
    for (let i = 0; i < 3; i++) stroke(p, 5 + i * 2 + (v === 1 ? 5 : 0), 8, 4 + i * 2 + (v === 1 ? 5 : 0), 11, BONE[1]);
    stroke(p, 1, 11, 9, 9, BONE[2]);
    if (v !== 2) {
      // Сломанное копьё с обсидиановым наконечником.
      stroke(p, 9, 12, 18, 7, hx('#5a3820'));
      poly(p, [[17, 6], [20, 5], [18, 8]], hx('#3a3a58'));
    } else {
      // Ржавый шлем.
      shadeEll(p, 15, 10, 3, 2, T('#3a1a0a', '#6a3a1a', '#8a5a2a', '#b07a3a'));
    }
    p.outline(INK);
    p.set(sx - (v === 1 ? 1 : -1), 7, INK);
    return { img: p.canvas(), ax: 10, ay: 14 };
  });
});

/** Тотем ящеров: резной столб, черепа, перья. */
registerPropPainter('f9_totem', () =>
  spriteOf('totem', () => {
    const p = new Px(16, 34);
    const wood = T('#1e120a', '#46301a', '#6a4a2a', '#8e6a3e');
    limb(p, 8, 32, 8, 6, 2.8, 2.4, wood);
    // Резные лица ящеров — три яруса.
    for (const y of [12, 20, 27]) {
      stroke(p, 5, y, 11, y, wood[0]);
      p.set(6, y - 2, hx('#ffd23a'));
      p.set(10, y - 2, hx('#ffd23a'));
      limb(p, 8, y - 1, 12, y - 0.5, 1.2, 0.8, wood);
    }
    // Череп наверху и перья.
    shadeEll(p, 8, 5, 3, 2.6, BONE);
    for (let k = 0; k < 4; k++) limb(p, 5 + k * 2, 3, 3 + k * 3, -1 + (k % 2), 0.7, 0.4, [hx('#6a1a10'), hx('#a82a1a'), k % 2 ? hx('#2a8ab8') : hx('#e05a2a'), WHITE]);
    p.outline(INK);
    p.set(7, 5, INK);
    p.set(9, 5, INK);
    return { img: p.canvas(), ax: 8, ay: 33 };
  }),
);

/** Рунный камень: монолит с желобками, руны загораются по очереди. */
registerPropPainter('f9_runestone', (o, time) => {
  const spin = F9_VIEW.spin > 0;
  const hall = o.area === F9_MAZE;
  const f = spin ? cyc(time * 16, 8) : cyc(time * 3 + o.x, 8);
  return spriteOf(`runestone|${hall ? 1 : 0}|${spin ? 1 : 0}|${f}`, () => {
    const p = new Px(18, 34);
    const st = T('#16141e', '#2e2a3e', '#4a4460', '#72698e');
    poly(
      p,
      [
        [3, 32],
        [4, 6],
        [9, 1],
        [14, 6],
        [15, 32],
      ],
      (x, y) => tone(st, 0.8 - (x - 3) * 0.06 - y * 0.004),
    );
    p.outline(INK);
    // Руна «вперёд» — в зале Круговорота горит золотом (цвет пары 5).
    const pal = spin ? RING_PAL[1 + (f % 8)] : hall ? RING_PAL[5] : RING_PAL[3];
    glyph(p, 7, 9, GLYPH[5], pal[3]);
    glyph(p, 7, 9, GLYPH[5], (f % 4) < 2 ? pal[3] : pal[2]);
    // Столбец малых рун — загораются по одной.
    for (let k = 0; k < 5; k++) {
      const y = 17 + k * 3;
      const c = k === f % 5 ? pal[3] : pal[1];
      p.set(8, y, c);
      p.set(9, y, c);
      p.set(8 + (k % 2), y + 1, c);
    }
    return { img: p.canvas(), ax: 9, ay: 33 };
  });
});

// ---------------------------------------------------------------------------
// Свои клетки. У каждого района свой рисовальщик и своя палитра: руины —
// оливковая топь и зелёная мозаика, лабиринт — лиловая вода с планктоном
// и полы с рунными желобами, логово — чёрная заводь, гать и ил.
// ---------------------------------------------------------------------------

interface CellPal {
  deep: RGBA;
  mid: RGBA;
  lite: RGBA;
  bank: RGBA;
  foam: RGBA;
  weed: RGBA;
  weedLt: RGBA;
  speck: RGBA | null;
  bog: RGBA;
  bogDk: RGBA;
  bogLt: RGBA;
  venom: RGBA;
  venomLt: RGBA;
  moss: RGBA;
  mossLt: RGBA;
  tileA: RGBA;
  tileB: RGBA;
  grout: RGBA;
}

const PAL_RUINS: CellPal = {
  deep: hx('#0c1a10'),
  mid: hx('#15301c'),
  lite: hx('#24482a'),
  bank: hx('#1c2414'),
  foam: hx('#8aa870'),
  weed: hx('#3a6a24'),
  weedLt: hx('#6a9a3a'),
  speck: null,
  bog: hx('#3a3a1a'),
  bogDk: hx('#26260e'),
  bogLt: hx('#6a6a2e'),
  venom: hx('#2f4a12'),
  venomLt: hx('#9cd23a'),
  moss: hx('#2e5a22'),
  mossLt: hx('#5a8a34'),
  tileA: hx('#3a6a5a'),
  tileB: hx('#8a7a4a'),
  grout: hx('#1e241c'),
};

const PAL_MAZE: CellPal = {
  deep: hx('#0a0a1a'),
  mid: hx('#12152c'),
  lite: hx('#1e2346'),
  bank: hx('#161626'),
  foam: hx('#7a80c8'),
  weed: hx('#2a3a5a'),
  weedLt: hx('#4a6a8a'),
  speck: hx('#9a8aff'),
  bog: hx('#22223a'),
  bogDk: hx('#161628'),
  bogLt: hx('#44466a'),
  venom: hx('#2c4618'),
  venomLt: hx('#94d040'),
  moss: hx('#27403a'),
  mossLt: hx('#3e6a5a'),
  tileA: hx('#3a2e6a'),
  tileB: hx('#2a5a6a'),
  grout: hx('#14121e'),
};

const PAL_LAIR: CellPal = {
  deep: hx('#030b0a'),
  mid: hx('#081816'),
  lite: hx('#10282a'),
  bank: hx('#0e1412'),
  foam: hx('#5a9a8e'),
  weed: hx('#1e3a2e'),
  weedLt: hx('#3a6a4a'),
  speck: hx('#3affc8'),
  bog: hx('#1e2616'),
  bogDk: hx('#10160c'),
  bogLt: hx('#3a4a2a'),
  venom: hx('#284414'),
  venomLt: hx('#90cc38'),
  moss: hx('#1e3a24'),
  mossLt: hx('#3a6a3a'),
  tileA: hx('#2a4a44'),
  tileB: hx('#5a5238'),
  grout: hx('#101614'),
};

/** Гладкий шум 0…1 по мировым пикселям. */
function vnoise(x: number, y: number, s: number, seed = 0): number {
  const xi = Math.floor(x / s);
  const yi = Math.floor(y / s);
  const fx = x / s - xi;
  const fy = y / s - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const r = (a: number, b: number) => hash(a, b, seed);
  const a = r(xi, yi) * (1 - u) + r(xi + 1, yi) * u;
  const b = r(xi, yi + 1) * (1 - u) + r(xi + 1, yi + 1) * u;
  return a * (1 - v) + b * v;
}

const cellCache = new Map<string, Px>();
function cellOf(key: string, make: () => Px): Px {
  let p = cellCache.get(key);
  if (!p) {
    p = make();
    cellCache.set(key, p);
  }
  return p;
}

/** Расстояние от пикселя клетки до «суши» (соседи, где `wet` ложь), скруглённо. */
function shoreDist(wet: (dx: number, dy: number) => boolean) {
  const rects: number[] = [];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && !wet(dx, dy)) rects.push(dx * TS, dy * TS);
  const R = 5;
  const corners: number[] = [];
  if (!wet(0, -1) && !wet(-1, 0)) corners.push(0, 0, 1, 1);
  if (!wet(0, -1) && !wet(1, 0)) corners.push(TS, 0, -1, 1);
  if (!wet(0, 1) && !wet(-1, 0)) corners.push(0, TS, 1, -1);
  if (!wet(0, 1) && !wet(1, 0)) corners.push(TS, TS, -1, -1);
  return (x: number, y: number) => {
    let d2 = 64;
    const px = x + 0.5;
    const py = y + 0.5;
    for (let i = 0; i < rects.length; i += 2) {
      const x0 = rects[i];
      const y0 = rects[i + 1];
      const qx = px < x0 ? x0 : px > x0 + TS ? x0 + TS : px;
      const qy = py < y0 ? y0 : py > y0 + TS ? y0 + TS : py;
      const e = (px - qx) * (px - qx) + (py - qy) * (py - qy);
      if (e < d2) d2 = e;
    }
    let d = Math.sqrt(d2);
    for (let i = 0; i < corners.length; i += 4) {
      const cx = corners[i];
      const cy = corners[i + 1];
      if (Math.abs(cx - px) > R || Math.abs(cy - py) > R) continue;
      const kx = cx + corners[i + 2] * R;
      const ky = cy + corners[i + 3] * R;
      const e = R - Math.hypot(px - kx, py - ky);
      if (e < d) d = e < 0 ? 0 : e;
    }
    return d;
  };
}

/** Вода топи: тёмная глубь, светлее у берега, ряска, пена, кромка берега. */
function waterCell(c: CellCtx, P: CellPal, tag: string, pool = false): Px {
  return cellOf(`w|${tag}|${c.wx}|${c.wy}`, () => {
    const p = new Px(TS, TS);
    const wet = (dx: number, dy: number) => {
      if (!dx && !dy) return true;
      if (!c.open(dx, dy)) return true;
      const mk = c.markAt(dx, dy);
      return isWaterMark(mk) || mk === F9_MARK.pool;
    };
    const dist = shoreDist(wet);
    const wallN = !c.open(0, -1);
    for (let y = 0; y < TS; y++)
      for (let x = 0; x < TS; x++) {
        const X = c.wx * TS + x;
        const Y = c.wy * TS + y;
        const d = dist(x, y);
        if (d <= 0.01) {
          p.set(x, y, P.bank);
          continue;
        }
        const n = vnoise(X, Y, 11, 3);
        let col = mixc(P.deep, P.mid, n * 0.8);
        if (pool) col = mixc(col, P.deep, 0.35);
        // Ближе к берегу — мельче и светлее.
        if (d < 6) col = mixc(col, P.lite, (1 - d / 6) * 0.7);
        // Ряска островками: мелкие листики, к середине островка гуще; без
        // шахматки — она читалась камуфляжем, а не водой.
        const w = vnoise(X * 1.3, Y * 1.3, 7, 9);
        if (!pool && w > 0.72) {
          const h = hash(X, Y, 41);
          if (h < 0.35 + (w - 0.72) * 3) col = h < 0.06 ? P.weedLt : mixc(P.weed, col, 0.25);
          else col = mixc(col, P.weed, 0.25);
        }
        // Рябь — редкие светлые штрихи.
        const r = Math.sin(Y * 0.6 + vnoise(X, Y, 23, 5) * 6);
        if (r > 0.96 && vnoise(X * 0.8, Y * 1.6, 6, 12) > 0.55) col = mixc(col, P.foam, pool ? 0.35 : 0.45);
        // Планктон и искры в глубине.
        if (P.speck && hash(X, Y, 71) > 0.992) col = P.speck;
        if (d < 1.4) col = mixc(P.foam, P.bank, 0.35);
        else if (d < 2.4 && (X + Y) % 3 === 0) col = mixc(col, P.foam, 0.5);
        p.set(x, y, col);
      }
    if (wallN)
      for (let x = 0; x < TS; x++)
        for (let y = 0; y < 3; y++) p.set(x, y, mixc(P.deep, [0, 0, 0, 255], 0.6 - y * 0.2));
    return p;
  });
}

/** Трясина/топь поверх пола: края тают по соседям. */
function sludgeCell(c: CellCtx, P: CellPal, tag: string, venom: boolean, flood = false): Px {
  const same = (dx: number, dy: number) => {
    const mk = c.markAt(dx, dy);
    return venom ? mk === F9_MARK.venom : isBogMark(mk);
  };
  let bits = 0;
  let k = 0;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      if (same(dx, dy) || !c.open(dx, dy)) bits |= 1 << k;
      k++;
    }
  const v = Math.floor(hash(c.wx, c.wy, 31) * 4);
  return cellOf(`s|${tag}|${venom ? 1 : 0}${flood ? 1 : 0}|${bits}|${v}`, () => {
    const p = new Px(TS, TS);
    const wet = (dx: number, dy: number) => (!dx && !dy ? true : same(dx, dy) || !c.open(dx, dy));
    const dist = shoreDist(wet);
    const base = venom ? P.venom : flood ? mixc(P.bog, P.lite, 0.5) : P.bog;
    const lt = venom ? P.venomLt : flood ? P.foam : P.bogLt;
    for (let y = 0; y < TS; y++)
      for (let x = 0; x < TS; x++) {
        const d = dist(x, y);
        if (d < 0.6) continue;
        const n = hash(x + v * 16, y, 5);
        const swirl = Math.sin((x + v * 5) * 0.8 + Math.sin(y * 0.7 + v) * 2);
        let col = n < 0.3 ? mixc(base, P.bogDk, 0.6) : base;
        // Яд — маслянистые разводы, а не газон: светлое только гребнями.
        if (swirl > 0.85) col = mixc(col, lt, venom ? 0.4 : 0.3);
        else if (venom && swirl < -0.7) col = mixc(col, P.bogDk, 0.35);
        const a = d < 3 ? 0.55 + (d / 3) * 0.4 : 0.95;
        p.set(x, y, alpha(col, a));
      }
    // Пузыри.
    const nb = venom ? 4 : 2;
    for (let i = 0; i < nb; i++) {
      const x = 3 + Math.floor(hash(i, v, 7) * 10);
      const y = 3 + Math.floor(hash(i, v, 8) * 10);
      if (dist(x, y) < 3) continue;
      p.set(x, y, lt);
      p.set(x + 1, y, alpha(lt, 0.6));
      if (venom) p.set(x, y - 1, alpha(WHITE, 0.7));
      p.set(x, y + 1, mixc(base, P.bogDk, 0.7));
    }
    return p;
  });
}

/** Корни по полу: тянутся к соседям с корнями, между ними — отростки. */
function rootsCell(c: CellCtx, P: CellPal, tag: string): Px {
  const rooty = (mk: number) => mk === F9_MARK.roots || mk === F9_MARK.rootwall || mk === F9_MARK.chapel;
  const nb = [rooty(c.markAt(0, -1)), rooty(c.markAt(1, 0)), rooty(c.markAt(0, 1)), rooty(c.markAt(-1, 0))];
  const v = Math.floor(hash(c.wx, c.wy, 33) * 3);
  return cellOf(`r|${tag}|${nb.map((b) => (b ? 1 : 0)).join('')}|${v}`, () => {
    const p = new Px(TS, TS);
    const bark = T('#1a1008', '#3a2614', '#5a3e22', '#7a5a34');
    const cx = 7 + v;
    const cy = 8 - v;
    const ends: [number, number][] = [
      [8 + v, 0],
      [16, 7 + v],
      [7 - v, 16],
      [0, 9],
    ];
    let any = false;
    nb.forEach((b, i) => {
      if (!b) return;
      any = true;
      chain(p, spline([[cx, cy], [(cx + ends[i][0]) / 2 + (v - 1), (cy + ends[i][1]) / 2 + 1], ends[i]], 3), 1.5, 1.1, bark);
    });
    // Своя петля корня.
    chain(p, spline([[cx - 5, cy + 4], [cx, cy], [cx + 4, cy - 3]], 3), any ? 0.9 : 1.4, 0.5, bark);
    if (!any) chain(p, spline([[cx - 3, cy - 4], [cx + 1, cy + 1], [cx + 5, cy + 5]], 3), 1.1, 0.5, bark);
    // Отростки-волоски.
    for (let i = 0; i < 4; i++) {
      const x = Math.floor(hash(i, v, 9) * 14) + 1;
      const y = Math.floor(hash(i, v, 10) * 14) + 1;
      p.set(x, y, bark[1]);
      p.set(x + 1, y + 1, bark[0]);
    }
    p.outline(alpha(INK, 0.55));
    void P;
    return p;
  });
}

/** Мох пятнами, край мягкий там, где мха нет. */
function mossCell(c: CellCtx, P: CellPal, tag: string): Px {
  return cellOf(`m|${tag}|${c.wx}|${c.wy}`, () => {
    const p = new Px(TS, TS);
    for (let y = 0; y < TS; y++)
      for (let x = 0; x < TS; x++) {
        const X = c.wx * TS + x;
        const Y = c.wy * TS + y;
        const n = vnoise(X, Y, 6, 41) * 0.7 + vnoise(X, Y, 2.5, 43) * 0.3;
        if (n < 0.45) continue;
        const col = n > 0.7 ? P.mossLt : P.moss;
        p.set(x, y, alpha(col, n > 0.55 ? 0.95 : 0.6));
        if (n > 0.78 && (X + Y) % 5 === 0) p.set(x, y, mixc(P.mossLt, WHITE, 0.25));
      }
    return p;
  });
}

/** Мозаика руин: плитка 4×4, узор, выпавшие плитки; кант, где мозаика кончается. */
function mosaicCell(c: CellCtx, P: CellPal, tag: string): Px {
  const same = (dx: number, dy: number) => {
    const mk = c.markAt(dx, dy);
    return mk === F9_MARK.mosaic || isRingMark(mk);
  };
  const edges = [same(0, -1), same(1, 0), same(0, 1), same(-1, 0)];
  // Смальта 2×2 точки: мельче клетки вчетверо, поэтому шов не рисуем — его
  // даёт скос каждого камешка (светлый угол, тёмный угол). Сетка 4×4 со швом
  // читалась миллиметровкой.
  return cellOf(`q|${tag}|${edges.map((b) => (b ? 1 : 0)).join('')}|${c.wx}|${c.wy}`, () => {
    const p = new Px(TS, TS);
    const earth = mixc(P.grout, P.bank, 0.5);
    for (let ty = 0; ty < 8; ty++)
      for (let tx = 0; tx < 8; tx++) {
        const gx = c.wx * 8 + tx;
        const gy = c.wy * 8 + ty;
        // Узор: ромб-медальон через 16 камешков (две клетки), с каймой.
        const d = Math.abs((((gx % 16) + 16) % 16) - 7.5) + Math.abs((((gy % 16) + 16) % 16) - 7.5);
        let col: RGBA;
        if (d < 2.6) col = P.tileB;
        else if (d < 3.6) col = mixc(P.tileB, WHITE, 0.18);
        else if (d > 6 && d < 7.2) col = mixc(P.tileA, P.grout, 0.55);
        else col = P.tileA;
        col = mixc(col, P.grout, hash(gx, gy, 38) * 0.28);
        // Выпавшие камешки гнёздами, мох заползает с краёв.
        const gone = vnoise(gx, gy, 5, 61) > 0.66 || hash(gx, gy, 37) < 0.05;
        const moss = vnoise(gx + 40, gy, 4, 62) > 0.7;
        for (let y = 0; y < 2; y++)
          for (let x = 0; x < 2; x++) {
            const X = tx * 2 + x;
            const Y = ty * 2 + y;
            let q: RGBA;
            if (gone) q = hash(X + c.wx * 16, Y + c.wy * 16, 63) < 0.2 ? mixc(earth, P.tileA, 0.3) : earth;
            else if (moss) q = x + y === 0 ? P.mossLt : P.moss;
            else q = x + y === 0 ? mixc(col, WHITE, 0.14) : x + y === 2 ? mixc(col, P.grout, 0.35) : col;
            p.set(X, Y, q);
          }
      }
    // Кант по краю мозаики.
    if (!edges[0]) for (let x = 0; x < TS; x++) p.set(x, 0, P.grout);
    if (!edges[2]) for (let x = 0; x < TS; x++) p.set(x, 15, P.grout);
    if (!edges[3]) for (let y = 0; y < TS; y++) p.set(0, y, P.grout);
    if (!edges[1]) for (let y = 0; y < TS; y++) p.set(15, y, P.grout);
    return p;
  });
}

/** Пол часовни: большие плиты с резьбой-спиралью корня. */
function chapelCell(c: CellCtx, P: CellPal): Px {
  // Плита — 2×2 клетки; спираль-корень вырезана через одну плиту и на всю
  // плиту, а не в каждой клетке: клетка со своей спиралью давала обои.
  const qx = ((c.wx % 2) + 2) % 2;
  const qy = ((c.wy % 2) + 2) % 2;
  const sx = Math.floor(c.wx / 2);
  const sy = Math.floor(c.wy / 2);
  const carved = hash(sx, sy, 45) < 0.45;
  const rot = Math.floor(hash(sx, sy, 46) * 4);
  const worn = Math.floor(hash(sx, sy, 44) * 3);
  return cellOf(`ch|${qx}${qy}|${carved ? rot : 9}|${worn}`, () => {
    const p = new Px(TS, TS);
    const slab = T('#2a2a22', '#4a4a3a', '#66644e', '#86846a');
    for (let y = 0; y < TS; y++)
      for (let x = 0; x < TS; x++) {
        const X = qx * TS + x;
        const Y = qy * TS + y;
        const seam = X === 0 || Y === 0;
        const groove = !seam && (X === 3 || Y === 3 || X === 28 || Y === 28) && X >= 3 && Y >= 3 && X <= 28 && Y <= 28;
        let t = 0.52 + hash(X, Y, 43 + worn) * 0.1 - ((X * 3 + Y * 5 + worn * 7) % 23 === 0 ? 0.2 : 0);
        if (groove) t = 0.25;
        p.set(x, y, seam ? slab[0] : tone(slab, t));
      }
    if (carved) {
      // Спираль-корень на всю плиту, центр — в углу этой клетки.
      const cx = 16 - qx * TS;
      const cy = 16 - qy * TS;
      for (let t = 0; t < 26; t += 0.12) {
        const r = 1.5 + t * 0.44;
        const a = t * 0.72 + (rot * Math.PI) / 2;
        const x = Math.round(cx + Math.cos(a) * r);
        const y = Math.round(cy + Math.sin(a) * r);
        if (x >= 0 && y >= 0 && x < TS && y < TS) p.set(x, y, slab[0]);
        const x2 = Math.round(cx + Math.cos(a) * r + 0.7);
        const y2 = Math.round(cy + Math.sin(a) * r + 0.7);
        if (x2 >= 0 && y2 >= 0 && x2 < TS && y2 < TS && (x2 !== x || y2 !== y)) p.set(x2, y2, slab[3]);
      }
      const hx0 = cx;
      const hy0 = cy;
      if (hx0 >= 0 && hy0 >= 0 && hx0 < TS && hy0 < TS) p.set(hx0, hy0, mixc(P.mossLt, WHITE, 0.2));
    }
    return p;
  });
}

/** Пол Круговорота: тёмный камень, рунные желоба решёткой светятся. */
function hallCell(c: CellCtx, P: CellPal): Px {
  // Центр зала — середина между его краями (ищем по меткам): узор —
  // выбитый в полу магический круг вокруг рунного камня, а не сетка.
  // Край — последняя клетка зала по лучу; камень и гнёзда кругов посреди
  // зала (своя метка или без неё) луч перешагивает, иначе у каждого ряда
  // выходил бы свой центр и круг рвался швами.
  const reach = (dx: number, dy: number) => {
    let last = 0;
    for (let k = 1; k < 26; k++) {
      const mk = c.markAt(dx * k, dy * k);
      if (mk === F9_MARK.hall) last = k;
      else if (k - last > 2) break;
    }
    return last;
  };
  const cx = c.wx + (reach(1, 0) - reach(-1, 0)) / 2;
  const cy = c.wy + (reach(0, 1) - reach(0, -1)) / 2;
  const ox = Math.round((c.wx - cx) * TS);
  const oy = Math.round((c.wy - cy) * TS);
  return cellOf(`hall|${ox}|${oy}`, () => {
    const p = new Px(TS, TS);
    const glow = hx('#7a5ad0');
    const glowHi = hx('#cbb8ff');
    const slab = T('#15141e', '#23212e', '#302d3e', '#403c50');
    for (let y = 0; y < TS; y++)
      for (let x = 0; x < TS; x++) {
        const X = ox + x;
        const Y = oy + y;
        // Плиты 2×2 клетки со швами.
        // Швы плит — в стороне от центра: шов через середину резал круг.
        const seam = ((X + 16) % 32 + 32) % 32 === 0 || ((Y + 16) % 32 + 32) % 32 === 0;
        let col = tone(slab, 0.45 + hash(Math.floor((X + 16) / 32), Math.floor((Y + 16) / 32), 47) * 0.2 + hash(X, Y, 48) * 0.08);
        if (seam) col = slab[0];
        const r = Math.hypot(X, Y * 1.0);
        const a = Math.atan2(Y, X);
        // Кольца круга: три, внешнее — с рунами.
        const ring = [40, 72, 112].some((R) => Math.abs(r - R) < 0.8);
        const outer = Math.abs(r - 118) < 0.7;
        // Восемь лучей от центра до внешнего кольца.
        const fr = (((a / (Math.PI / 4)) % 1) + 1) % 1;
        const ray = r > 14 && r < 112 && Math.min(fr, 1 - fr) * (Math.PI / 4) * r < 0.7;
        if (ring || ray) col = mixc(glow, slab[1], 0.45);
        if (outer) col = mixc(glow, slab[1], 0.65);
        // Знаки между внешними кольцами.
        if (r > 112.5 && r < 117.5) {
          const seg = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 36);
          const u = (((a + Math.PI) / (Math.PI * 2)) * 36) % 1;
          if (hash(seg, 3, 49) < 0.8 && (u < 0.12 || (u > 0.4 && u < 0.5 && r > 114 && r < 116)))
            col = mixc(glowHi, glow, 0.4);
        }
        if (r < 3) col = glowHi;
        p.set(x, y, col);
      }
    void P;
    return p;
  });
}

/** Пол зала засады: плиты с когтями и тёмной кровью. */
function ambushCell(c: CellCtx, P: CellPal): Px {
  // Следы — на части плит: кровь на каждой пятой, когти на каждой третьей.
  // Одна и та же отметина в каждой клетке читалась обоями.
  const v = Math.floor(hash(c.wx, c.wy, 49) * 10);
  return cellOf(`amb|${v}`, () => {
    const p = new Px(TS, TS);
    const slab = T('#1e1a1e', '#342e36', '#4a424e', '#625a68');
    for (let y = 0; y < TS; y++)
      for (let x = 0; x < TS; x++) p.set(x, y, x === 0 || y === 0 ? slab[0] : tone(slab, 0.5 + hash(x, y, v) * 0.15));
    if (v < 2) {
      // Кровь.
      p.ell(6 + v * 3, 9, 3 + v, 2, hx('#3a0a0e'));
      p.set(9, 5, hx('#4a0e12'));
      p.set(11, 12, hx('#3a0a0e'));
    }
    // Когти по камню.
    if (v >= 2 && v < 5)
      for (let k = 0; k < 3; k++) stroke(p, 3 + k * 2 + v, 2, 6 + k * 2 + v, 7, slab[0]);
    // Трещина.
    if (v === 7) {
      stroke(p, 2, 12, 7, 9, slab[0]);
      stroke(p, 7, 9, 12, 11, slab[0]);
    }
    void P;
    return p;
  });
}

/** Гать: доски поперёк хода, по краям вода и верёвки. */
function causewayCell(c: CellCtx, P: CellPal): Px {
  // Гать — брёвна ПОПЕРЁК хода. Ход шириной в три клетки, поэтому
  // направление берём по длине пробега гати, а не по одному соседу:
  // иначе на горизонтальном колене брёвна ложились вдоль.
  const run = (dx: number, dy: number) => {
    let k = 1;
    while (k < 8 && c.markAt(dx * k, dy * k) === F9_MARK.causeway) k++;
    return k - 1;
  };
  const vert = run(0, -1) + run(0, 1) >= run(-1, 0) + run(1, 0);
  const same = (dx: number, dy: number) => !isWaterMark(c.markAt(dx, dy));
  const e = [same(0, -1), same(1, 0), same(0, 1), same(-1, 0)];
  const along0 = vert ? c.wy : c.wx;
  const across0 = vert ? c.wx : c.wy;
  return cellOf(`cw|${vert ? 1 : 0}|${e.map((b) => (b ? 1 : 0)).join('')}|${along0}|${across0}`, () => {
    const p = new Px(TS, TS);
    const wood = T('#1a1108', '#3a2814', '#5a4022', '#7e5e36');
    const moss = hx('#3e5a22');
    // Вода под брёвнами (видна в щелях).
    p.rect(0, 0, 15, 15, P.deep);
    // Брёвна по 4 точки вдоль хода: светлый верх, тёмный низ, щель.
    for (let a = 0; a < TS; a++) {
      const A = along0 * TS + a;
      const log = Math.floor(A / 4);
      const k = A % 4;
      const gap = k === 3 && hash(log, 1, 52) < 0.7;
      if (gap) continue;
      const shade = k === 0 ? 0.78 : k === 1 ? 0.6 : 0.36;
      // Концы брёвен неровные: у кромки гати бревно короче или длиннее.
      for (let b = 0; b < TS; b++) {
        const B = across0 * TS + b;
        const x = vert ? b : a;
        const y = vert ? a : b;
        const edgeLo = !(vert ? e[3] : e[0]) && b < Math.floor(hash(log, 2, 53) * 3);
        const edgeHi = !(vert ? e[1] : e[2]) && b > 15 - Math.floor(hash(log, 3, 54) * 3);
        if (edgeLo || edgeHi) continue;
        let col = tone(wood, shade + hash(log, B >> 2, 55) * 0.08);
        // Сучки и кора кольцами.
        if (k === 1 && hash(log, B, 56) > 0.93) col = wood[0];
        // Мох на старых брёвнах.
        if (vnoise(A, B, 6, 57) > 0.74 && k < 2) col = mixc(col, moss, 0.7);
        p.set(x, y, col);
      }
    }
    // Верёвки у кромки: вяжут концы брёвен.
    const rope = hx('#8a7a4a');
    const ropeDk = hx('#4a3e22');
    if (vert) {
      if (!e[3]) for (let y = 0; y < TS; y += 2) p.set(2, y, y % 4 ? ropeDk : rope);
      if (!e[1]) for (let y = 1; y < TS; y += 2) p.set(13, y, y % 4 === 1 ? rope : ropeDk);
    } else {
      if (!e[0]) for (let x = 0; x < TS; x += 2) p.set(x, 2, x % 4 ? ropeDk : rope);
      if (!e[2]) for (let x = 1; x < TS; x += 2) p.set(x, 13, x % 4 === 1 ? rope : ropeDk);
    }
    return p;
  });
}

/** Ил на дне ушедшего озера. */
function mudCell(c: CellCtx, P: CellPal): Px {
  return cellOf(`mud|${c.wx}|${c.wy}`, () => {
    const p = new Px(TS, TS);
    const mud = HY.mud;
    for (let y = 0; y < TS; y++)
      for (let x = 0; x < TS; x++) {
        const X = c.wx * TS + x;
        const Y = c.wy * TS + y;
        const n = vnoise(X, Y, 5, 53);
        let col = tone(mud, 0.25 + n * 0.5);
        if (vnoise(X, Y, 9, 55) > 0.72) col = mixc(P.deep, P.lite, 0.4);
        if (hash(X, Y, 57) > 0.985) col = BONE[2];
        p.set(x, y, col);
      }
    return p;
  });
}

/** Лицо стены: лианы; сверху — зелень. */
function vineWallCell(c: CellCtx, P: CellPal, tag: string): Px {
  const face = c.open(0, 1);
  const v = Math.floor(hash(c.wx, c.wy, 59) * 4);
  return cellOf(`vw|${tag}|${face ? 1 : 0}|${v}`, () => {
    const p = new Px(TS, TS);
    if (face) {
      for (let i = 0; i < 5; i++) {
        const x = 1 + i * 3 + (v % 2);
        const len = 6 + Math.floor(hash(i, v, 61) * 10);
        for (let y = 0; y < len; y++) {
          const xx = x + Math.round(Math.sin(y * 0.5 + i) * 0.8);
          p.set(xx, y, y % 4 === 1 ? P.mossLt : P.moss);
          if (y % 4 === 2) p.set(xx + 1, y, VINE[3]);
        }
      }
    } else {
      for (let i = 0; i < 7; i++) {
        const x = Math.floor(hash(i, v, 63) * 14);
        const y = Math.floor(hash(i, v, 64) * 14);
        p.ell(x + 1, y + 1, 1.6, 1.2, i % 2 ? P.moss : P.mossLt);
      }
    }
    return p;
  });
}

/** Корневая стена: сплетённые корни держат проход. */
function rootWallCell(c: CellCtx, P: CellPal): Px {
  const face = c.open(0, 1);
  const v = Math.floor(hash(c.wx, c.wy, 65) * 3);
  return cellOf(`rw|${face ? 1 : 0}|${v}`, () => {
    const p = new Px(TS, TS);
    const bark = T('#140c06', '#2e1e10', '#4e341c', '#72502e');
    const n = face ? 6 : 4;
    for (let i = 0; i < n; i++) {
      const y0 = i * (16 / n) + v;
      chain(p, spline([[-2, y0], [5, y0 + 3 * (i % 2 ? 1 : -1)], [11, y0 - 1], [18, y0 + 2]], 3), 2, 1.6, bark);
    }
    for (let i = 0; i < 3; i++) chain(p, spline([[4 + i * 5, -2], [3 + i * 5, 8], [5 + i * 5, 18]], 3), 1.6, 1.3, bark);
    p.outline(alpha(INK, 0.8));
    // Кора сочится светом там, где корни сплелись с жилой маны.
    if (face) p.set(8, 7 + v, mixc(P.mossLt, hx('#ffb040'), 0.7));
    return p;
  });
}

/** Светящийся мох на стене. */
function glowMossCell(c: CellCtx, P: CellPal): Px {
  const face = c.open(0, 1);
  const v = Math.floor(hash(c.wx, c.wy, 67) * 4);
  return cellOf(`gm|${face ? 1 : 0}|${v}`, () => {
    const p = new Px(TS, TS);
    const g = hx('#2ac8a8');
    const gh = hx('#c8fff0');
    const n = face ? 4 : 2;
    for (let i = 0; i < n; i++) {
      const x = 2 + Math.floor(hash(i, v, 69) * 11);
      const y = (face ? 3 : 2) + Math.floor(hash(i, v, 70) * 9);
      p.ell(x, y, 1.8 + (i % 2), 1.4, alpha(g, 0.85));
      p.set(x, y, gh);
    }
    void P;
    return p;
  });
}

/** Основание круга: каменный диск с желобом (свет рисует круг-предмет). */
function ringBaseCell(c: CellCtx, P: CellPal): Px {
  return cellOf(`rb|${P === PAL_MAZE ? 1 : P === PAL_LAIR ? 2 : 0}`, () => {
    const p = new Px(TS, TS);
    const st = T('#1c1a24', '#34303e', '#4c4658', '#6a6278');
    p.ell(8, 8.5, 7.6, 5, (x, y) => tone(st, 0.6 - (x + y) * 0.015));
    p.ell(8, 8.5, 5.6, 3.4, st[0]);
    p.ell(8, 8.5, 4.6, 2.6, st[1]);
    void c;
    return p;
  });
}

/** Общий разбор клетки по виду для района с палитрой P. */
function areaCell(c: CellCtx, P: CellPal, tag: string): Px | null {
  const mk = c.mark;
  if (c.tile === 11) {
    // Глубина: вода (с кувшинками — тоже), озеро гидры.
    if (mk === F9_MARK.pool) return waterCell(c, P, tag + 'p', true);
    return waterCell(c, P, tag);
  }
  if (isRingMark(mk)) return ringBaseCell(c, P);
  switch (mk) {
    case F9_MARK.bog:
    case F9_MARK.reeds:
    case F9_MARK.eggs:
      return sludgeCell(c, P, tag, false);
    case F9_MARK.flood:
      return sludgeCell(c, P, tag, false, true);
    case F9_MARK.venom:
      return sludgeCell(c, P, tag, true);
    case F9_MARK.roots:
      return rootsCell(c, P, tag);
    case F9_MARK.moss:
      return mossCell(c, P, tag);
    case F9_MARK.mosaic:
      return mosaicCell(c, P, tag);
    case F9_MARK.chapel:
      return chapelCell(c, P);
    case F9_MARK.hall:
      return hallCell(c, P);
    case F9_MARK.ambush:
      return ambushCell(c, P);
    case F9_MARK.causeway:
      return causewayCell(c, P);
    case F9_MARK.mud:
      return mudCell(c, P);
    case F9_MARK.vinewall:
      return vineWallCell(c, P, tag);
    case F9_MARK.rootwall:
      return rootWallCell(c, P);
    case F9_MARK.glowmoss:
      return glowMossCell(c, P);
    default:
      return null;
  }
}

registerCellPainter(F9_RUINS, (c) => areaCell(c, PAL_RUINS, 'r'));
registerCellPainter(F9_MAZE, (c) => areaCell(c, PAL_MAZE, 'm'));
registerCellPainter(F9_LAIR, (c) => areaCell(c, PAL_LAIR, 'l'));

// ---------------------------------------------------------------------------
// Метки ударов, лужи, вспышки кругов. Рисуются на полу, под мобами.
// ---------------------------------------------------------------------------

type ZoneX = (Zone | Strike) & {
  ang?: number;
  len?: number;
  arc?: number;
  col?: number;
  step?: number;
  w?: number;
};

const rgba = (c: RGBA, a: number) =>
  `rgba(${c[0]},${c[1]},${c[2]},${clamp01(a).toFixed(3)})`;

/** Метка удара наливается: `k` 0…1. У лужи — 1. */
const kOf = (z: ZoneX) => {
  const s = z as Strike;
  if ('warn' in s && typeof s.warn === 'number' && s.warn > 0) return Math.min(1, s.t / s.warn);
  return 1;
};
/** Лужа: доля жизни после предупреждения (0 — только что). */
const lifeK = (z: ZoneX) => {
  const zz = z as Zone;
  return clamp01((zz.t - (zz.warn ?? 0)) / Math.max(0.01, zz.life));
};
const warned = (z: ZoneX) => (z as Zone).t >= ((z as Zone).warn ?? 0);

function cone(g: CanvasRenderingContext2D, x: number, y: number, r: number, a: number, arc: number): void {
  g.beginPath();
  g.moveTo(x, y);
  g.arc(x, y, r, a - arc / 2, a + arc / 2);
  g.closePath();
}

function ringPath(g: CanvasRenderingContext2D, x: number, y: number, r: number, squash = 0.62): void {
  g.beginPath();
  g.ellipse(Math.round(x), Math.round(y), Math.max(0.5, r), Math.max(0.5, r * squash), 0, 0, TAU);
}

/** Пиксельный кружок-частица. */
function dot(g: CanvasRenderingContext2D, x: number, y: number, c: string, s = 1): void {
  g.fillStyle = c;
  g.fillRect(Math.round(x), Math.round(y), s, s);
}

const ringCol = (z: ZoneX) => RING_PAL[(z.col as number | undefined) ?? 3] ?? RING_PAL[3];

// Круг наливается: столб света растёт.
registerZonePainter('f9_warp_in', (g, z, px, py, S, time) => {
  const zz = z as ZoneX;
  const k = clamp01((zz as Zone).t / 0.55);
  const pal = ringCol(zz);
  g.fillStyle = rgba(pal[2], 0.25 + 0.35 * k);
  ringPath(g, px, py, 0.72 * S);
  g.fill();
  for (let i = 0; i < 7; i++) {
    const u = (time * 2.4 + i / 7) % 1;
    const a = i * 0.9;
    const x = px + Math.cos(a) * 0.55 * S;
    const y = py + Math.sin(a) * 0.34 * S - u * S * (0.8 + k);
    dot(g, x, y, rgba(pal[3], (1 - u) * (0.5 + 0.5 * k)));
  }
  g.fillStyle = rgba(pal[3], 0.2 * k);
  g.fillRect(Math.round(px - 0.35 * S), Math.round(py - S * 1.6 * k), Math.round(0.7 * S), Math.round(S * 1.6 * k));
  return true;
});

// Точка выхода: пара вспыхивает ещё до переноса — видно, куда перенесёт.
registerZonePainter('f9_warp_out', (g, z, px, py, S, time) => {
  const zz = z as ZoneX;
  const pal = ringCol(zz);
  const t = (zz as Zone).t;
  const beat = 0.5 + 0.5 * Math.sin(time * 18);
  g.strokeStyle = rgba(pal[3], 0.55 + 0.4 * beat);
  g.lineWidth = 1;
  ringPath(g, px, py, (0.55 + 0.25 * beat) * S);
  g.stroke();
  g.fillStyle = rgba(pal[2], 0.18 + 0.2 * beat);
  ringPath(g, px, py, 0.8 * S);
  g.fill();
  // Луч вверх.
  g.fillStyle = rgba(pal[3], 0.22 * Math.min(1, t * 3));
  g.fillRect(Math.round(px - 2), Math.round(py - S * 2), 4, Math.round(S * 2));
  return true;
});

registerZonePainter('f9_warp_arrive', (g, z, px, py, S) => {
  const zz = z as Zone;
  const k = clamp01(zz.t / Math.max(0.01, zz.life));
  const pal = RING_PAL[3];
  g.strokeStyle = rgba(pal[3], 1 - k);
  g.lineWidth = 1;
  ringPath(g, px, py, (0.4 + k * 1.1) * S);
  g.stroke();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    dot(g, px + Math.cos(a) * (0.3 + k) * S, py + Math.sin(a) * (0.2 + k * 0.6) * S - k * 6, rgba(pal[3], 1 - k));
  }
  return true;
});

// Метка прыжка кобольда: маленький рунный круг — сюда он встанет.
registerZonePainter('f9_blink', (g, z, px, py, S, time) => {
  const zz = z as Zone;
  const k = clamp01(zz.t / 0.42);
  const pal = RING_PAL[3];
  g.strokeStyle = rgba(pal[2], 0.5 + 0.5 * k);
  g.lineWidth = 1;
  ringPath(g, px, py, zz.r * S);
  g.stroke();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + time * 6;
    dot(g, px + Math.cos(a) * zz.r * S * 0.7, py + Math.sin(a) * zz.r * S * 0.45, rgba(pal[3], 0.6 + 0.4 * k), 2);
  }
  g.fillStyle = rgba(pal[2], 0.15 + 0.3 * k);
  ringPath(g, px, py, zz.r * S * k);
  g.fill();
  return true;
});

registerZonePainter('f9_puff', (g, z, px, py, S) => {
  const zz = z as Zone;
  const k = clamp01(zz.t / Math.max(0.01, zz.life));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU;
    const r = (0.2 + k * 0.5) * S;
    g.fillStyle = rgba(hx('#8a7aa8'), 0.6 * (1 - k));
    g.beginPath();
    g.arc(Math.round(px + Math.cos(a) * r), Math.round(py - 6 + Math.sin(a) * r * 0.6 - k * 5), 2 + k * 2, 0, TAU);
    g.fill();
  }
  return true;
});

/** Лужа: до падения — кольцо-прицел, потом — пузырящееся пятно. */
function puddle(
  g: CanvasRenderingContext2D,
  z: ZoneX,
  px: number,
  py: number,
  S: number,
  time: number,
  base: RGBA,
  hi: RGBA,
  kind: 'venom' | 'frost' | 'embers',
): void {
  const zz = z as Zone;
  const R = zz.r * S;
  if (!warned(z)) {
    const k = clamp01(zz.t / Math.max(0.01, zz.warn ?? 1));
    g.strokeStyle = rgba(hi, 0.35 + 0.5 * k);
    g.lineWidth = 1;
    ringPath(g, px, py, R, 0.7);
    g.stroke();
    return;
  }
  const lk = lifeK(z);
  const fade = lk > 0.8 ? 1 - (lk - 0.8) / 0.2 : 1;
  const grow = Math.min(1, ((zz.t - (zz.warn ?? 0)) / 0.2));
  g.fillStyle = rgba(base, 0.55 * fade);
  ringPath(g, px, py, R * grow, 0.7);
  g.fill();
  g.fillStyle = rgba(mixc(base, hi, 0.4), 0.5 * fade);
  ringPath(g, px - 1, py - 1, R * 0.6 * grow, 0.7);
  g.fill();
  const seed = Math.floor(time * (kind === 'embers' ? 10 : 4));
  for (let i = 0; i < 7; i++) {
    const a = hash(i, zz.id, 3) * TAU;
    const d = hash(i, zz.id, 4) * R * 0.8;
    const x = px + Math.cos(a) * d;
    const y = py + Math.sin(a) * d * 0.7;
    const on = kind === 'frost' ? true : hash(i, seed, zz.id) > 0.5;
    if (!on) continue;
    if (kind === 'frost') {
      dot(g, x, y, rgba(hi, 0.9 * fade));
      dot(g, x + 1, y - 1, rgba(WHITE, 0.6 * fade));
    } else if (kind === 'embers') {
      dot(g, x, y, rgba(i % 2 ? FIRE[2] : FIRE[1], fade), i % 3 ? 1 : 2);
      dot(g, x, y - 2 - (seed % 3), rgba(FIRE[3], 0.6 * fade));
    } else {
      dot(g, x, y, rgba(hi, 0.9 * fade), 2);
      dot(g, x, y - 1, rgba(WHITE, 0.5 * fade));
    }
  }
}

registerZonePainter('f9_venom', (g, z, px, py, S, time) => {
  puddle(g, z as ZoneX, px, py, S, time, hx('#4a7a14'), hx('#c8f04a'), 'venom');
  return true;
});
registerZonePainter('f9_frost', (g, z, px, py, S, time) => {
  puddle(g, z as ZoneX, px, py, S, time, hx('#6a9ad0'), hx('#e0f8ff'), 'frost');
  return true;
});
registerZonePainter('f9_embers', (g, z, px, py, S, time) => {
  puddle(g, z as ZoneX, px, py, S, time, hx('#6a1a08'), hx('#ff8a2a'), 'embers');
  return true;
});

// Конус огненной головы: наливается, угольки бегут к краю.
registerZonePainter('f9_firecone', (g, z, px, py, S, time) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const R = zz.r * S;
  const a = zz.ang ?? 0;
  const arc = zz.arc ?? 1;
  cone(g, px, py, R, a, arc);
  g.fillStyle = rgba(FIRE[0], 0.14 + 0.26 * k);
  g.fill();
  g.strokeStyle = rgba(FIRE[2], 0.35 + 0.6 * k);
  g.lineWidth = 1;
  g.beginPath();
  g.arc(px, py, R * (0.35 + 0.65 * k), a - arc / 2, a + arc / 2);
  g.stroke();
  for (let i = 0; i < 8; i++) {
    const t = (time * 1.6 + i * 0.37) % 1;
    const aa = a + (hash(i, 3) - 0.5) * arc;
    const r = R * t * k;
    dot(g, px + Math.cos(aa) * r, py + Math.sin(aa) * r, rgba(FIRE[3], 0.5 + 0.4 * k));
  }
  return true;
});

// Хвост гидры: из воды поднимается гребень и метёт веером по берегу.
// Метка — мутная вода, по дуге бежит гребень от края к краю: где он сейчас,
// туда и придёт удар в конце.
const TAIL_C = [hx('#1d3a33'), hx('#2f6a55'), hx('#7fc49a'), hx('#d9f5d0')];
registerZonePainter('f9_tail', (g, z, px, py, S, time) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const R = zz.r * S;
  const a = zz.ang ?? 0;
  const arc = zz.arc ?? 1.2;
  cone(g, px, py, R, a, arc);
  g.fillStyle = rgba(TAIL_C[0], 0.18 + 0.3 * k);
  g.fill();
  g.strokeStyle = rgba(TAIL_C[2], 0.3 + 0.55 * k);
  g.lineWidth = 1;
  g.beginPath();
  g.arc(px, py, R, a - arc / 2, a + arc / 2);
  g.stroke();
  // Кольца волн у кромки.
  for (let i = 0; i < 3; i++) {
    const t = (time * 0.9 + i / 3) % 1;
    g.strokeStyle = rgba(TAIL_C[1], (1 - t) * 0.5 * k);
    g.beginPath();
    g.arc(px, py, R * (0.3 + 0.7 * t), a - arc / 2, a + arc / 2);
    g.stroke();
  }
  // Гребень хвоста: изогнутая спина с плавником, бежит по дуге.
  const sweep = a - arc / 2 + arc * Math.min(1, k * 1.05);
  const rise = Math.sin(Math.min(1, k) * Math.PI * 0.5);
  for (let i = 0; i < 9; i++) {
    const f = i / 8;
    const r = R * (0.25 + 0.72 * f);
    const aa = sweep - 0.18 * f;
    const x = px + Math.cos(aa) * r;
    const y = py + Math.sin(aa) * r - rise * (2 + 3 * Math.sin(f * Math.PI));
    const s = Math.max(1, Math.round((1 - f) * 3 + 1));
    g.fillStyle = rgba(TAIL_C[1], 0.55 + 0.4 * k);
    g.fillRect(Math.round(x) - s, Math.round(y) - s, s * 2, s * 2);
    if (i % 2 === 0) dot(g, x, y - s - 1, rgba(TAIL_C[3], 0.4 + 0.5 * k), 1);
  }
  return true;
});

// Сама струя пламени — после метки, полсекунды.
registerZonePainter('f9_flame', (g, z, px, py, S, time) => {
  const zz = z as ZoneX;
  if (!warned(zz)) return true;
  const t = lifeK(zz);
  const R = zz.r * S;
  const a = zz.ang ?? 0;
  const arc = 0.9;
  const reach = Math.min(1, t * 4);
  const fade = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
  const seed = Math.floor(time * 24);
  for (let i = 0; i < 26; i++) {
    const k = (i + 0.5) / 26;
    const d = R * k * reach;
    const spread = (hash(i, seed) - 0.5) * arc * (0.35 + k * 0.65);
    const x = px + Math.cos(a + spread) * d;
    const y = py - 3 + Math.sin(a + spread) * d;
    const r = 1.5 + k * 3.2 + hash(i, seed, 2) * 1.5;
    g.fillStyle = rgba(k < 0.2 ? FIRE[3] : k < 0.5 ? FIRE[2] : k < 0.8 ? FIRE[1] : FIRE[0], 0.9 * fade);
    g.beginPath();
    g.arc(Math.round(x), Math.round(y), r, 0, TAU);
    g.fill();
  }
  return true;
});

/** Линия удара с узором: молния, корни, лучи призмы. */
function lineMark(
  g: CanvasRenderingContext2D,
  z: ZoneX,
  px: number,
  py: number,
  S: number,
  time: number,
  base: RGBA,
  hi: RGBA,
  jag: number,
): void {
  const k = kOf(z);
  const len = z.r * S;
  const w = (z.w ?? 0.5) * S;
  const a = z.ang ?? 0;
  g.save();
  g.translate(Math.round(px), Math.round(py));
  g.rotate(a);
  g.fillStyle = rgba(base, 0.14 + 0.3 * k);
  g.fillRect(0, -w, len, w * 2);
  // Ломаная по оси — у молнии пляшет каждый кадр.
  const seed = Math.floor(time * (jag > 0 ? 20 : 4));
  g.fillStyle = rgba(hi, 0.35 + 0.6 * k);
  let y = 0;
  for (let x = 0; x < len * k; x += 2) {
    y += jag ? (hash(x, seed) - 0.5) * jag : 0;
    y = Math.max(-w + 1, Math.min(w - 1, y));
    g.fillRect(x, Math.round(y), 2, 1);
  }
  g.restore();
}

registerZonePainter('f9_bolt', (g, z, px, py, S, time) => {
  lineMark(g, z as ZoneX, px, py, S, time, hx('#3a2a8a'), hx('#fff8a0'), 3);
  return true;
});

registerZonePainter('f9_rootline', (g, z, px, py, S, time) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  lineMark(g, zz, px, py, S, time, hx('#3a2614'), hx('#8a6a3a'), 0);
  // Кончики корней пробиваются вдоль линии.
  const len = zz.r * S;
  const a = zz.ang ?? 0;
  for (let d = 4; d < len; d += 6) {
    const x = px + Math.cos(a) * d;
    const y = py + Math.sin(a) * d;
    const h = Math.round(1 + k * 4 * (0.6 + hash(d, 1) * 0.6));
    g.fillStyle = rgba(hx('#5a3e22'), 0.6 + 0.4 * k);
    g.fillRect(Math.round(x), Math.round(y - h), 1, h);
    if (k > 0.7) dot(g, x, y - h, rgba(hx('#a8c040'), 0.9));
  }
  return true;
});

const RAY = [
  [hx('#6a1a08'), FIRE[2]],
  [hx('#34568a'), hx('#e8fcff')],
  [hx('#26521a'), hx('#c8f04a')],
  [hx('#2e2468'), hx('#fff8a0')],
  [hx('#a89468'), hx('#ffffff')],
] as const;
for (let i = 0; i < 5; i++)
  registerZonePainter(`f9_ray${i}`, (g, z, px, py, S, time) => {
    lineMark(g, z as ZoneX, px, py, S, time, RAY[i][0], RAY[i][1], i === 3 ? 2.5 : 0.8);
    return true;
  });

// Укус головы: круг, по краю — зубы смыкаются.
registerZonePainter('f9_bite', (g, z, px, py, S) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const R = zz.r * S;
  g.fillStyle = rgba(hx('#a82a2a'), 0.12 + 0.28 * k);
  ringPath(g, px, py, R, 0.7);
  g.fill();
  g.strokeStyle = rgba(hx('#ff6a5a'), 0.5 + 0.4 * k);
  g.lineWidth = 1;
  ringPath(g, px, py, R, 0.7);
  g.stroke();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    const d = R * (1 - 0.55 * k);
    dot(g, px + Math.cos(a) * d, py + Math.sin(a) * d * 0.7, rgba(WHITE, 0.6 + 0.4 * k), 2);
  }
  return true;
});

registerZonePainter('f9_geyser', (g, z, px, py, S, time) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const R = zz.r * S;
  g.fillStyle = rgba(hx('#3a6a14'), 0.15 + 0.3 * k);
  ringPath(g, px, py, R, 0.7);
  g.fill();
  const seed = Math.floor(time * 8);
  for (let i = 0; i < 8; i++) {
    if (hash(i, seed, 2) > 0.3 + k * 0.6) continue;
    const a = hash(i, 5) * TAU;
    const d = hash(i, 6) * R;
    dot(g, px + Math.cos(a) * d, py + Math.sin(a) * d * 0.7 - k * 3, rgba(hx('#c8f04a'), 0.9), 2);
  }
  g.strokeStyle = rgba(hx('#c8f04a'), 0.4 + 0.5 * k);
  g.lineWidth = 1;
  ringPath(g, px, py, R * (0.3 + 0.7 * k), 0.7);
  g.stroke();
  return true;
});

// Водоворот скрытой головы: спираль в иле стягивается.
registerZonePainter('f9_whirl', (g, z, px, py, S, time) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const R = zz.r * S;
  g.fillStyle = rgba(hx('#2a1a3a'), 0.25 + 0.35 * k);
  ringPath(g, px, py, R, 0.66);
  g.fill();
  for (let arm = 0; arm < 3; arm++)
    for (let t = 0; t < 1; t += 0.04) {
      const a = t * 5 + arm * (TAU / 3) + time * (3 + k * 6);
      const r = R * (1 - t) ;
      dot(g, px + Math.cos(a) * r, py + Math.sin(a) * r * 0.66, rgba(hx('#b88aff'), (0.3 + 0.6 * k) * (1 - t * 0.5)));
    }
  return true;
});

registerZonePainter('f9_glare', (g, z, px, py, S, time) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const R = zz.r * S;
  g.fillStyle = rgba(hx('#fff0b0'), 0.12 + 0.3 * k);
  ringPath(g, px, py, R, 0.7);
  g.fill();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + time * 2;
    g.fillStyle = rgba(WHITE, 0.3 + 0.6 * k);
    g.fillRect(Math.round(px + Math.cos(a) * R * k), Math.round(py + Math.sin(a) * R * 0.7 * k), 2, 1);
  }
  return true;
});

// Взгляд змея: вспышка по конусу на миг.
registerZonePainter('f9_gaze', (g, z, px, py, S) => {
  const zz = z as ZoneX;
  const k = 1 - lifeK(zz);
  const R = zz.r * S;
  cone(g, px, py - 4, R, zz.ang ?? 0, 0.95);
  g.fillStyle = rgba(hx('#6affe0'), 0.45 * k);
  g.fill();
  return true;
});

// Корни держат: частокол корней из-под земли.
registerZonePainter('f9_grab', (g, z, px, py, S) => {
  const zz = z as ZoneX;
  const k = 1 - lifeK(zz);
  const R = zz.r * S;
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU;
    const x = px + Math.cos(a) * R * 0.8;
    const y = py + Math.sin(a) * R * 0.55;
    const h = Math.round((4 + (i % 3) * 2) * k);
    g.fillStyle = rgba(hx('#4e341c'), 0.95 * k);
    g.fillRect(Math.round(x), Math.round(y - h), 2, h);
    dot(g, x, y - h, rgba(hx('#8aa040'), k));
  }
  return true;
});

// Руна жреца под героем: знаки бегут по кругу, круг заполняется.
registerZonePainter('f9_rune', (g, z, px, py, S, time) => {
  const zz = z as Zone;
  const k = clamp01(zz.t / 1.15);
  const R = zz.r * S;
  const pal = RING_PAL[3];
  g.fillStyle = rgba(pal[1], 0.1 + 0.3 * k);
  ringPath(g, px, py, R * k, 0.66);
  g.fill();
  g.strokeStyle = rgba(pal[2], 0.6 + 0.4 * k);
  g.lineWidth = 1;
  ringPath(g, px, py, R, 0.66);
  g.stroke();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + time * 3;
    dot(g, px + Math.cos(a) * R, py + Math.sin(a) * R * 0.66, rgba(pal[3], 0.9), 2);
  }
  return true;
});

registerZonePainter('f9_flare', (g, z, px, py, S) => {
  const zz = z as Zone;
  const k = clamp01(zz.t / Math.max(0.01, zz.life));
  g.strokeStyle = rgba(hx('#b8ffe8'), 1 - k);
  g.lineWidth = 2;
  ringPath(g, px, py, zz.r * S * (0.4 + 0.6 * k), 0.7);
  g.stroke();
  return true;
});

registerZonePainter('f9_splash', (g, z, px, py, S) => {
  const zz = z as Zone;
  const k = clamp01(zz.t / Math.max(0.01, zz.life));
  g.strokeStyle = rgba(hx('#a8e0d0'), 0.8 * (1 - k));
  g.lineWidth = 1;
  ringPath(g, px, py, (0.2 + k * 0.7) * S, 0.6);
  g.stroke();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    const h = Math.sin(k * Math.PI) * 6;
    dot(g, px + Math.cos(a) * (2 + k * 7), py + Math.sin(a) * (1 + k * 4) - h, rgba(hx('#d8fff4'), 1 - k));
  }
  return true;
});

// Прилив: вода встаёт над гатью — сперва темнеет и рябит, потом заливает.
registerZonePainter('f9_tidewater', (g, z, px, py, S, time) => {
  const zz = z as Zone;
  const w = zz.warn ?? 0;
  const k = clamp01(zz.t / Math.max(0.01, w));
  const x0 = Math.round(px - S / 2);
  const y0 = Math.round(py - S / 2);
  // Вода встаёт: сперва темнеет, к концу метки брёвна скрываются почти
  // целиком — видны только кончики сквозь муть.
  g.fillStyle = `rgba(10,30,26,${(0.3 + 0.6 * k).toFixed(3)})`;
  g.fillRect(x0, y0, S, S);
  const seed = Math.floor(time * 3);
  const u = Math.max(1, Math.round(S / 16));
  for (let i = 0; i < 5; i++) {
    const y = y0 + ((i * 7 + seed * 3) % S);
    g.fillStyle = `rgba(120,190,170,${(0.2 + 0.4 * k).toFixed(3)})`;
    g.fillRect(x0 + ((i * 11 + seed * 5) % Math.max(1, S - 5 * u)), y, 5 * u, u);
  }
  // Пена у кромки — там, где вода только пришла.
  if (k < 1) {
    g.fillStyle = `rgba(200,236,220,${(0.5 * (1 - k)).toFixed(3)})`;
    for (let i = 0; i < 4; i++) g.fillRect(x0 + ((i * 5 + seed) % S), y0 + ((i * 9) % S), u, u);
  }
  return true;
});

// Огонь в руке: пламя вокруг ног и над плечом, пока горит.
registerZonePainter('f9_handfire', (g, _z, px, py, S, time) => {
  const k = F9_VIEW.fire;
  if (k <= 0) return true;
  const seed = Math.floor(time * 14);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU + time * 2.5;
    const x = px + Math.cos(a) * 0.45 * S;
    const y = py + 1 + Math.sin(a) * 0.25 * S;
    const h = 2 + ((seed + i) % 3);
    g.fillStyle = rgba(FIRE[(i + seed) % 3 + 1], 0.85);
    g.fillRect(Math.round(x), Math.round(y - h), 1, h);
  }
  // Факел над плечом: язык пламени, тает к концу срока.
  const fx = px + 5;
  const fy = py - 16;
  for (let i = 0; i < 6; i++) {
    const w = (1 - i / 6) * 2.2 * (0.5 + 0.5 * k);
    const sway = Math.sin(time * 12 + i) * 0.8;
    g.fillStyle = rgba(i < 2 ? FIRE[3] : i < 4 ? FIRE[2] : FIRE[1], 0.95);
    g.fillRect(Math.round(fx - w + sway), Math.round(fy - i), Math.max(1, Math.round(w * 2)), 1);
  }
  return true;
});

registerZonePainter('f9_sear', (g, z, px, py, S) => {
  const zz = z as Zone;
  const k = clamp01(zz.t / Math.max(0.01, zz.life));
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    const d = (0.2 + k) * S;
    dot(g, px + Math.cos(a) * d, py + Math.sin(a) * d * 0.6 - k * 8, rgba(i % 2 ? FIRE[3] : FIRE[2], 1 - k), 2);
  }
  g.fillStyle = rgba(hx('#8a8a88'), 0.5 * (1 - k));
  g.beginPath();
  g.arc(Math.round(px), Math.round(py - 6 - k * 10), 3 + k * 5, 0, TAU);
  g.fill();
  return true;
});

registerZonePainter('f9_regrow', (g, z, px, py, S) => {
  const zz = z as Zone;
  const k = clamp01(zz.t / Math.max(0.01, zz.life));
  g.strokeStyle = rgba(hx('#c83a2a'), 1 - k);
  g.lineWidth = 2;
  ringPath(g, px, py, (0.3 + k * 1.2) * S, 0.6);
  g.stroke();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    dot(g, px + Math.cos(a) * k * S, py + Math.sin(a) * k * S * 0.6 - 4, rgba(hx('#e04a3a'), 1 - k), 2);
  }
  return true;
});

registerZonePainter('f9_healed', (g, z, px, py, S, time) => {
  const zz = z as Zone;
  const k = clamp01(zz.t / Math.max(0.01, zz.life));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + time * 3;
    dot(g, px + Math.cos(a) * 0.6 * S, py - 10 + Math.sin(a) * 4 - k * 8, rgba(hx('#fff4c0'), 1 - k), 2);
  }
  return true;
});

// ---------------------------------------------------------------------------
// Снаряды: плевок жабы, ледяной шар, ядовитый ком.
// ---------------------------------------------------------------------------

function blobShot(key: string, core: Tones, tail: RGBA, frames: number) {
  return (s: Shot, time: number): Sprite => {
    const f = cyc(time * 12 + s.id, frames);
    return spriteOf(`${key}|${f}`, () => {
      const p = new Px(12, 12);
      shadeEll(p, 6, 6, 3 + (f % 2) * 0.3, 2.8, core);
      p.set(3, 8 + (f % 2), tail);
      p.set(2, 9, alpha(tail, 0.6));
      p.outline(alpha(INK, 0.8));
      p.set(5, 5, WHITE);
      return { img: p.canvas(), ax: 6, ay: 8 };
    });
  };
}

registerShotPainter('f9_spit', blobShot('spit', T('#2a4a0a', '#5a8a14', '#a8d83a', '#e8ff9a'), hx('#c8f04a'), 2));
registerShotPainter('f9_venomglob', blobShot('vglob', T('#142a0a', '#2a5a1a', '#5a9a2a', '#b8f050'), hx('#94d046'), 2));
registerShotPainter('f9_iceball', (s: Shot, time: number) => {
  const f = cyc(time * 10 + s.id, 4);
  return spriteOf(`ice|${f}`, () => {
    const p = new Px(14, 14);
    shadeEll(p, 7, 7, 3.6, 3.6, ELEM[1].skin);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + f * 0.4;
      stroke(p, 7, 7, 7 + Math.cos(a) * 5.5, 7 + Math.sin(a) * 5.5, ELEM[1].crest[2]);
    }
    p.outline(alpha(INK, 0.7));
    p.set(6, 5, WHITE);
    return { img: p.canvas(), ax: 7, ay: 9 };
  });
});

// ---------------------------------------------------------------------------
// Иконки вещей 10×10.
// ---------------------------------------------------------------------------

function meatIcon(meat: Tones, bone: boolean): Px {
  const p = new Px(10, 10);
  shadeEll(p, 4.5, 5, 3.6, 3, meat);
  if (bone) {
    limb(p, 6.5, 6, 9, 8.5, 0.8, 0.8, BONE);
    p.set(9, 9, BONE[3]);
  }
  p.outline(INK);
  p.set(3, 4, alpha(WHITE, 0.6));
  return p;
}

registerItemArt('f9_tail', () => {
  const p = new Px(10, 10);
  chain(p, spline([[1.5, 4], [5, 4.5], [8.5, 7]], 3), 2.2, 0.8, LZ_.skin);
  scales(p, 0, 0, 9, 9, LZ_.scaleDk, null, 2);
  p.ell(1.6, 4, 1.2, 1.6, hx('#c83a2a'));
  p.outline(INK);
  return p;
});
registerItemArt('f9_frogleg', () => meatIcon(T('#6a4a2a', '#b07a4a', '#e0a870', '#ffd8a8'), true));
registerItemArt('f9_snake', () => {
  const p = new Px(10, 10);
  chain(p, spline([[1, 7], [4, 3], [7, 6], [9, 3]], 3), 1.4, 1.1, T('#6a3a2a', '#b0664a', '#e0987a', '#ffc8a8'));
  p.outline(INK);
  return p;
});
registerItemArt('f9mat', () => {
  const p = new Px(10, 10);
  for (const [x, y] of [
    [3, 3],
    [6.5, 4],
    [4.5, 6.5],
  ])
    shadeEll(p, x, y, 2.4, 2, LZ_.skin, 0.1);
  p.outline(INK);
  p.set(3, 2, LZ_.scaleLt);
  p.set(6, 3, LZ_.scaleLt);
  return p;
});
registerItemArt('f9_toxin', () => {
  const p = new Px(10, 10);
  limb(p, 5, 2, 5, 3.5, 1, 1, T('#3a2a14', '#6a4a24', '#94703a', '#c09a5a'));
  shadeEll(p, 5, 6.5, 3, 2.6, T('#2a4a0a', '#5a8a14', '#a8d83a', '#e8ff9a'));
  p.outline(INK);
  p.set(4, 5, WHITE);
  return p;
});
registerItemArt('f9_rune', () => {
  const p = new Px(10, 10);
  poly(
    p,
    [
      [1, 8],
      [2, 2],
      [7, 1],
      [9, 6],
      [6, 9],
    ],
    (x, y) => tone(T('#1c1a24', '#34303e', '#4c4658', '#6a6278'), 0.8 - (x + y) * 0.05),
  );
  p.outline(INK);
  glyph(p, 3, 3, GLYPH[3], RING_PAL[3][3]);
  return p;
});
registerItemArt('f9_mana', () => {
  const p = new Px(10, 10);
  poly(
    p,
    [
      [5, 0.5],
      [8.5, 4],
      [5, 9.5],
      [1.5, 4],
    ],
    (x) => tone(CRYS, x < 5 ? 0.85 : 0.35),
  );
  p.outline(INK);
  p.set(4, 3, WHITE);
  return p;
});
registerItemArt('f9_root', () => {
  const p = new Px(10, 10);
  chain(p, spline([[1, 8], [4, 5], [6, 5.5], [9, 2]], 3), 1.3, 0.6, RT.bark);
  chain(p, spline([[4, 5], [3, 2], [4.5, 1]], 3), 0.8, 0.4, RT.young);
  p.outline(INK);
  p.set(5, 5, RT.knot);
  return p;
});
registerItemArt('f9_heart', () => {
  const p = new Px(10, 10);
  shadeEll(p, 3.5, 4, 2.6, 2.4, T('#3a0808', '#7a1a14', '#c83a2a', '#ff8a7a'));
  shadeEll(p, 6.5, 4, 2.6, 2.4, T('#3a0808', '#7a1a14', '#c83a2a', '#ff8a7a'));
  poly(
    p,
    [
      [1.2, 5],
      [8.8, 5],
      [5, 9.2],
    ],
    hx('#9a2a1e'),
  );
  // Жилы стихий.
  p.set(3, 6, ELEM[0].glow);
  p.set(5, 7, ELEM[2].glow);
  p.set(7, 6, ELEM[1].glow);
  p.outline(INK);
  p.set(3, 3, alpha(WHITE, 0.7));
  return p;
});
