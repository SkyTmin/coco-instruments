// Этаж 12 «Полярная ночь» — техники: метки замаха (у мобов этажа и у
// мамонта), удары по площади с контактом, зоны-картинки (`api.vfx`) и игла
// ежа.
//
// Мобы этажа ставят `vNoTele`: красную метку движка этаж рисует сам в слое
// пола (`F12_FLOOR_HOOKS`) — тёплый красный, который игрок знает.
//
// Мамонт и шаманка (анимации 12): у их ударов свой язык — лёд. Метка — тень
// холода на полу, иней ползёт от кромки, трещины бегут из-под ног, кромка
// «замыкается» к мигу удара, последние 0,2 с — белая вспышка кромки и
// сходящееся кольцо. Всё рисуется точками сетки МИРА (`pin`): эффект лежит
// на льду и не дрожит при движении камеры. Точки тела — только
// `mamPointPx` «Тела»; что отделилось от тела (снег, лёд, волна бубна,
// занавесы, осколки) — здесь, само тело — в `f12-art.ts`.

import { Px } from '../dungeon-art';
import {
  frameLRU,
  paintSim,
  registerImpactPainter,
  registerMobWarm,
  registerShotPainter,
  registerZonePainter,
} from '../dungeon-paint';
import type { Sprite } from '../dungeon-paint';
import type { Mob, Sim, Strike, Zone } from '../dungeon-sim';
import { F12_FLOOR_HOOKS, F12_SKY_HOOKS, mamPointPx } from './f12-art';
import { f12Glacier, f12Mammoth, MAMMOTH, SPIRIT } from './f12-brains';

type G = CanvasRenderingContext2D;
type C3 = [number, number, number];
const TS = 16;
const TAU = Math.PI * 2;

const c3 = (h: string): C3 => {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};
const rgba = (c: C3, a: number) =>
  `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a)).toFixed(3)})`;

const P = {
  danger: c3('#ff5a44'),
  hot: c3('#ffc0a8'),
  white: c3('#ffffff'),
  frost: c3('#d6f2ff'),
  ice: c3('#8cc8ec'),
  iceD: c3('#3672a6'),
  iceDD: c3('#163860'),
  snow: c3('#cad8ee'),
  snowS: c3('#7088b2'),
  water: c3('#08203c'),
  waterL: c3('#4f8bbd'),
  foam: c3('#e8f6ff'),
  teal: c3('#7ae8f0'),
  tealD: c3('#15798a'),
  aur: c3('#3ef0b0'),
  aurL: c3('#9affd8'),
  aurD: c3('#16a07a'),
  fire: c3('#ff8a2a'),
  fireL: c3('#ffc65a'),
  fireW: c3('#fff3c4'),
  smoke: c3('#4a5468'),
  smokeL: c3('#8a96aa'),
  rock: c3('#3a4762'),
  rockL: c3('#7a88a8'),
  gold: c3('#ffe08a'),
  ink: c3('#0b1020'),
};

// ---------------------------------------------------------------------------
// Помощники.
// ---------------------------------------------------------------------------

function hash(a: number, b: number, s = 0): number {
  let h =
    (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const k01 = (v: number) => Math.max(0, Math.min(1, v));
const eOut = (k: number) => 1 - (1 - k01(k)) ** 3;
const eIn = (k: number) => k01(k) ** 2;
const seedOf = (z: { id: number }) => z.id >>> 0;

function dot(g: G, x: number, y: number, w: number, h: number, c: C3, a: number): void {
  if (a <= 0.01) return;
  g.fillStyle = rgba(c, a);
  g.fillRect(Math.round(x), Math.round(y), w, h);
}

/** Точки по окружности: кромка метки. */
function ringTicks(
  g: G,
  X: number,
  Y: number,
  R: number,
  c: C3,
  a: number,
  step = 4,
  seed = 0,
  keep = 1,
  ry = 1,
): void {
  if (R < 1 || a <= 0.01) return;
  const n = Math.max(10, Math.round((TAU * R) / step));
  g.fillStyle = rgba(c, a);
  for (let i = 0; i < n; i++) {
    if (keep < 1 && hash(seed, i, 7) > keep) continue;
    const t = (i / n) * TAU;
    g.fillRect(Math.round(X + Math.cos(t) * R), Math.round(Y + Math.sin(t) * R * ry), 2, 1);
  }
}

interface Burst {
  n: number;
  seed: number;
  /** Направление и разброс; без разброса — во все стороны. */
  ang?: number;
  spread?: number;
  /** Скорость по полу, пикс/с. */
  v: [number, number];
  /** Подлёт вверх, пикс/с, и тяжесть. */
  up?: [number, number];
  grav?: number;
  life: [number, number];
  size?: [number, number];
  cols: C3[];
  /** Торможение (воздух, снег). */
  drag?: number;
  /** Старт с кольца, пикс. */
  r0?: number;
  /** Дым всплывает, пикс/с. */
  rise?: number;
  /** Задержка вылета частиц, с (размазать по времени). */
  delay?: number;
}

/** Частицы по баллистике: всё считается от возраста, без состояния. */
function burst(g: G, X: number, Y: number, age: number, b: Burst, alphaK = 1): void {
  for (let i = 0; i < b.n; i++) {
    const h1 = hash(b.seed, i, 1);
    const h2 = hash(b.seed, i, 2);
    const h3 = hash(b.seed, i, 3);
    const h4 = hash(b.seed, i, 4);
    const t = age - (b.delay ?? 0) * h4;
    const life = b.life[0] + (b.life[1] - b.life[0]) * h3;
    if (t < 0 || t > life) continue;
    const a = b.spread === undefined ? h1 * TAU : (b.ang ?? 0) + (h1 - 0.5) * b.spread;
    const v = b.v[0] + (b.v[1] - b.v[0]) * h2;
    const drag = b.drag ?? 0;
    const d = drag > 0 ? (v * (1 - Math.exp(-drag * t))) / drag : v * t;
    const r0 = (b.r0 ?? 0) * (0.55 + 0.45 * h4);
    const up = b.up ? b.up[0] + (b.up[1] - b.up[0]) * h2 : 0;
    const z = Math.max(0, up * t - 0.5 * (b.grav ?? 0) * t * t) + (b.rise ?? 0) * t;
    const x = X + Math.cos(a) * (r0 + d);
    const y = Y + Math.sin(a) * (r0 + d) * 0.7 - z;
    const sz = b.size ? Math.round(b.size[0] + (b.size[1] - b.size[0]) * h3) : 1;
    const fade = 1 - eIn(t / life);
    dot(g, x - sz / 2, y - sz / 2, sz, sz, b.cols[i % b.cols.length], fade * alphaK);
  }
}

/** Мягкое пятно света или тени. */
function glow(g: G, X: number, Y: number, R: number, c: C3, a: number, ry = 1, add = false): void {
  if (R < 1 || a <= 0.01) return;
  g.save();
  if (add) g.globalCompositeOperation = 'lighter';
  const gr = g.createRadialGradient(X, Y, 0, X, Y, R);
  gr.addColorStop(0, rgba(c, a));
  gr.addColorStop(1, rgba(c, 0));
  g.fillStyle = gr;
  g.translate(X, Y);
  g.scale(1, ry);
  g.beginPath();
  g.arc(0, 0, R, 0, TAU);
  g.fill();
  g.restore();
}

/** Прямая до стены, клеток (как `clearDist` мозга). */
function rayLen(sim: Sim, x: number, y: number, ang: number, max: number): number {
  const w = sim.world;
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  for (let d = 0.2; d <= max; d += 0.2) {
    const cx = Math.floor(x + ux * d);
    const cy = Math.floor(y + uy * d);
    if (cx < 0 || cy < 0 || cx >= w.w || cy >= w.h) return d;
    const t = sim.tiles[cy * w.w + cx];
    if (t === 1 || t === 0) return d;
  }
  return max;
}

// ---------------------------------------------------------------------------
// Метки: красное ядро движка с ледяной кромкой. `k` — налив 0…1.
// ---------------------------------------------------------------------------

/** Мигание в последние 15% налива. */
const blink = (k: number, time: number) => k > 0.85 && Math.sin(time * 40) > 0;

function markCircle(
  g: G,
  X: number,
  Y: number,
  R: number,
  k: number,
  time: number,
  seed: number,
): void {
  g.fillStyle = rgba(P.danger, 0.07 + 0.05 * k);
  g.beginPath();
  g.arc(X, Y, R, 0, TAU);
  g.fill();
  g.fillStyle = rgba(P.danger, 0.12 + 0.24 * k);
  g.beginPath();
  g.arc(X, Y, Math.max(0, R * eOut(k)), 0, TAU);
  g.fill();
  const edge = blink(k, time) ? P.white : P.frost;
  ringTicks(g, X, Y, R, edge, 0.5 + 0.45 * k, 3);
  // Иней ползёт от кромки внутрь шестью иглами.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + hash(seed, i, 21) * 0.5;
    const L = R * 0.35 * k;
    for (let q = 0; q < L; q++)
      dot(g, X + Math.cos(a) * (R - q), Y + Math.sin(a) * (R - q), 1, 1, P.frost, 0.55 * k);
  }
}

function markRing(g: G, X: number, Y: number, R: number, w: number, k: number, time: number): void {
  g.strokeStyle = rgba(P.danger, 0.14 + 0.3 * k);
  g.lineWidth = w * 2;
  g.beginPath();
  g.arc(X, Y, R, 0, TAU);
  g.stroke();
  const edge = blink(k, time) ? P.white : P.frost;
  ringTicks(g, X, Y, R + w, edge, 0.45 + 0.4 * k, 3);
  ringTicks(g, X, Y, Math.max(1, R - w), edge, 0.3 + 0.4 * k, 4);
}

function markLine(
  g: G,
  X: number,
  Y: number,
  ang: number,
  L: number,
  hw: number,
  k: number,
  time: number,
  a = 1,
): void {
  g.save();
  g.translate(X, Y);
  g.rotate(ang);
  g.fillStyle = rgba(P.danger, (0.08 + 0.06 * k) * a);
  g.fillRect(0, -hw, L, hw * 2);
  g.fillStyle = rgba(P.danger, (0.12 + 0.24 * k) * a);
  g.fillRect(0, -hw, L * eOut(k), hw * 2);
  const edge = blink(k, time) ? P.white : P.frost;
  g.fillStyle = rgba(edge, (0.45 + 0.45 * k) * a);
  for (let x = 0; x < L; x += 3) {
    g.fillRect(x, -hw, 2, 1);
    g.fillRect(x, hw - 1, 2, 1);
  }
  // Шевроны бегут по ходу удара.
  const off = (time * (20 + 40 * k)) % 12;
  g.fillStyle = rgba(P.frost, (0.25 + 0.5 * k) * a);
  const ch = Math.min(4, hw * 0.7);
  for (let x = off; x < L - 3; x += 12)
    for (let q = 0; q <= ch; q++) {
      g.fillRect(Math.round(x - q * 0.7), Math.round(-q), 1, 1);
      g.fillRect(Math.round(x - q * 0.7), Math.round(q), 1, 1);
    }
  g.restore();
}

function markCone(
  g: G,
  X: number,
  Y: number,
  ang: number,
  R: number,
  arc: number,
  k: number,
  time: number,
): void {
  const h = arc / 2;
  g.fillStyle = rgba(P.danger, 0.07 + 0.05 * k);
  g.beginPath();
  g.moveTo(X, Y);
  g.arc(X, Y, R, ang - h, ang + h);
  g.closePath();
  g.fill();
  g.fillStyle = rgba(P.danger, 0.14 + 0.24 * k);
  g.beginPath();
  g.moveTo(X, Y);
  g.arc(X, Y, Math.max(0, R * eOut(k)), ang - h, ang + h);
  g.closePath();
  g.fill();
  const edge = blink(k, time) ? P.white : P.frost;
  const n = Math.max(6, Math.round((arc * R) / 3));
  g.fillStyle = rgba(edge, 0.5 + 0.45 * k);
  for (let i = 0; i <= n; i++) {
    const a = ang - h + (arc * i) / n;
    g.fillRect(Math.round(X + Math.cos(a) * R), Math.round(Y + Math.sin(a) * R), 2, 1);
  }
  for (const s of [-1, 1]) {
    const a = ang + s * h;
    for (let q = 4; q < R; q += 3)
      g.fillRect(Math.round(X + Math.cos(a) * q), Math.round(Y + Math.sin(a) * q), 1, 1);
  }
}

/** Метки обычных мобов этажа (`m.tele`). */
function mobMarks(g: G, sim: Sim, left: number, top: number, time: number): void {
  for (const m of sim.mobs) {
    const t = m.tele;
    if (!t || !m.data.vNoTele || m.kind === 'f12boss' || !m.kind.startsWith('f12')) continue;
    const X = (t.x ?? m.x) * TS - left;
    const Y = (t.y ?? m.y) * TS - top;
    const R = t.r * TS;
    const k = k01(t.k);
    switch (t.shape) {
      case 'circle':
        markCircle(g, X, Y, R, k, time, m.id);
        break;
      case 'ring':
        markRing(g, X, Y, R, (t.w ?? 0.6) * TS, k, time);
        break;
      case 'line':
        markLine(g, X, Y, t.ang ?? 0, R, (t.w ?? 0.5) * TS, k, time);
        break;
      case 'cone':
        markCone(g, X, Y, t.ang ?? 0, R, t.arc ?? 1, k, time);
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// Пиксельное перо (анимации 12). Точки сетки мира: `pin` — где на экране
// нулевая точка мира; остаток привязки один на кадр, поэтому иней и трещины
// стоят на льду, а не плывут на пиксель за камерой.
// ---------------------------------------------------------------------------

/** Палитра мамонта: лёд, снег, бирюза и сияние. Цвет — строкой, прозрачность — `globalAlpha`. */
const C = {
  white: '#ffffff',
  frost: '#d6f2ff',
  iceL: '#a0d0ee',
  ice: '#8cc8ec',
  iceM: '#5c9ccb',
  iceD: '#3672a6',
  iceDD: '#163860',
  snow: '#e2ecfa',
  snowM: '#b4c6e2',
  snowS: '#7088b2',
  snowD: '#4f648e',
  shade: '#081634',
  ink: '#0b1020',
  teal: '#7ae8f0',
  tealL: '#d8fcff',
  tealM: '#2fb8c8',
  tealD: '#15798a',
  aur: '#3ef0b0',
  aurL: '#9affd8',
  aurW: '#e6fff4',
  aurD: '#16a07a',
  vio: '#9a8aff',
  vioD: '#4a3aa0',
  fire: '#ff8a2a',
  fireL: '#ffc65a',
  fireW: '#fff3c4',
  fireD: '#c8461a',
  ember: '#7a2410',
  smoke: '#4a5468',
  smokeL: '#8a96aa',
  rock: '#3a4762',
  rockL: '#7a88a8',
  rockD: '#1a2133',
};

let OX = 0;
let OY = 0;
let QX = 0;
let QY = 0;

/** Привязка к сетке мира: `offX = px − wx` (экранная точка минус мировая). */
function pin(g: G, offX: number, offY: number): void {
  const s = g.getTransform().a || 1;
  OX = offX;
  OY = offY;
  QX = Math.round(offX * s) / s;
  QY = Math.round(offY * s) / s;
}
const WX = (x: number) => Math.floor(x - OX);
const WY = (y: number) => Math.floor(y - OY);

function ink(g: G, c: string, a: number): boolean {
  if (!(a > 0.012)) return false;
  g.fillStyle = c;
  g.globalAlpha = a > 1 ? 1 : a;
  return true;
}
/** Точка (прямоугольник) по экранным координатам — на сетке мира. */
function pp(g: G, x: number, y: number, w = 1, h = 1): void {
  g.fillRect(WX(x) + QX, WY(y) + QY, w, h);
}
/** Строка мира `j` от x0 до x1 (экранные). */
function hrow(g: G, x0: number, x1: number, j: number): void {
  const a = WX(x0);
  const b = WX(x1);
  if (b > a) g.fillRect(a + QX, j + QY, b - a, 1);
}

// Склейка точек: соседние по строке или столбцу точки уходят на канву одним
// прямоугольником. Линия вала во всю арену была ~300 вызовов `fillRect`, стала
// единицы; рисунок тот же до пикселя.
let RX = 0;
let RY = 0;
let RW = 0;
let RH = 0;
/** Точка сетки мира (целые `WX/WY`) — в текущий отрезок или новый. */
function runPx(g: G, x: number, y: number): void {
  if (RW) {
    if (RH === 1 && y === RY) {
      if (x === RX + RW) return void RW++;
      if (x === RX - 1) return void ((RX = x), RW++);
    }
    if (RW === 1 && x === RX) {
      if (y === RY + RH) return void RH++;
      if (y === RY - 1) return void ((RY = y), RH++);
    }
    if (x >= RX && x < RX + RW && y >= RY && y < RY + RH) return;
    g.fillRect(RX + QX, RY + QY, RW, RH);
  }
  RX = x;
  RY = y;
  RW = 1;
  RH = 1;
}
/** Дорисовать накопленный отрезок (до смены цвета или прозрачности). */
function runEnd(g: G): void {
  if (RW) g.fillRect(RX + QX, RY + QY, RW, RH);
  RW = 0;
}

/** Круг строками (без сглаживания). */
function fDisc(g: G, X: number, Y: number, R: number): void {
  fSector(g, X, Y, 0, R, 0, TAU);
}

/**
 * Сектор кольца R0…R1 от угла a0 до a1 (меньше π — клин; иначе — полное
 * кольцо). Строками мира, без сглаживания.
 */
function fSector(g: G, X: number, Y: number, R0: number, R1: number, a0: number, a1: number): void {
  if (R1 < 0.5) return;
  const wedge = a1 - a0 < Math.PI;
  const c0 = Math.cos(a0);
  const s0 = Math.sin(a0);
  const c1 = Math.cos(a1);
  const s1 = Math.sin(a1);
  const j0 = WY(Y - R1);
  const j1 = WY(Y + R1);
  for (let j = j0; j <= j1; j++) {
    const dy = j + 0.5 + OY - Y;
    const d1 = R1 * R1 - dy * dy;
    if (d1 <= 0) continue;
    const ho = Math.sqrt(d1);
    let lo = -ho;
    let hi = ho;
    if (wedge) {
      // По часовой от a0: c0·dy − s0·x ≥ 0 и s1·x − c1·dy ≥ 0.
      if (Math.abs(s0) < 1e-6) {
        if (c0 * dy < 0) continue;
      } else if (s0 > 0) hi = Math.min(hi, (c0 * dy) / s0);
      else lo = Math.max(lo, (c0 * dy) / s0);
      if (Math.abs(s1) < 1e-6) {
        if (-c1 * dy < 0) continue;
      } else if (s1 > 0) lo = Math.max(lo, (c1 * dy) / s1);
      else hi = Math.min(hi, (c1 * dy) / s1);
      if (hi <= lo) continue;
    }
    const d0 = R0 * R0 - dy * dy;
    if (d0 > 0) {
      const hn = Math.sqrt(d0);
      if (lo < -hn) hrow(g, X + lo, X + Math.min(hi, -hn), j);
      if (hi > hn) hrow(g, X + Math.max(lo, hn), X + hi, j);
    } else hrow(g, X + lo, X + hi, j);
  }
}

/** Выпуклый многоугольник строками: [x0, y0, x1, y1, …] — экранные. */
function fPoly(g: G, pts: number[]): void {
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let i = 1; i < pts.length; i += 2) {
    if (pts[i] < y0) y0 = pts[i];
    if (pts[i] > y1) y1 = pts[i];
  }
  const n = pts.length;
  for (let j = WY(y0); j <= WY(y1); j++) {
    const yc = j + 0.5 + OY;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < n; i += 2) {
      const xa = pts[i];
      const ya = pts[i + 1];
      const xb = pts[(i + 2) % n];
      const yb = pts[(i + 3) % n];
      if ((ya <= yc && yb > yc) || (yb <= yc && ya > yc)) {
        const x = xa + ((yc - ya) * (xb - xa)) / (yb - ya);
        if (x < lo) lo = x;
        if (x > hi) hi = x;
      }
    }
    if (hi > lo) hrow(g, lo, hi, j);
  }
}

/** Полоса от (X, Y) по углу: вдоль u0…u1, поперёк v0…v1. */
function fLane(
  g: G,
  X: number,
  Y: number,
  ang: number,
  u0: number,
  u1: number,
  v0: number,
  v1: number,
): void {
  if (u1 - u0 < 0.5 || v1 - v0 < 0.5) return;
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  const P = (u: number, v: number) => [X + ux * u - uy * v, Y + uy * u + ux * v];
  fPoly(g, [...P(u0, v0), ...P(u1, v0), ...P(u1, v1), ...P(u0, v1)]);
}

/** Дуга точками (по одной на пиксель), `dash` — период пунктира в точках. */
function arcPx(
  g: G,
  X: number,
  Y: number,
  R: number,
  a0: number,
  a1: number,
  dash = 0,
  off = 0,
  on = 0,
): void {
  if (R < 1 || a1 <= a0) return;
  const step = 0.7 / R;
  let lx = 1e9;
  let ly = 1e9;
  let i = 0;
  const onN = on || dash / 2;
  for (let a = a0; a <= a1 + 1e-9; a += step) {
    const x = WX(X + Math.cos(a) * R);
    const y = WY(Y + Math.sin(a) * R);
    if (x === lx && y === ly) continue;
    lx = x;
    ly = y;
    i++;
    if (dash && (((i + Math.floor(off)) % dash) + dash) % dash >= onN) {
      runEnd(g);
      continue;
    }
    runPx(g, x, y);
  }
  runEnd(g);
}

/** Линия по пикселям мира (Брезенхэм), `dash` — период, `on` — сколько точек горит. */
function linePx(
  g: G,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  dash = 0,
  off = 0,
  on = 0,
): void {
  let x = WX(x0);
  let y = WY(y0);
  const xe = WX(x1);
  const ye = WY(y1);
  const dx = Math.abs(xe - x);
  const dy = -Math.abs(ye - y);
  const sx = x < xe ? 1 : -1;
  const sy = y < ye ? 1 : -1;
  let err = dx + dy;
  const onN = on || dash / 2;
  for (let n = 0; n < 2000; n++) {
    if (!dash || (((n + Math.floor(off)) % dash) + dash) % dash < onN) runPx(g, x, y);
    else runEnd(g);
    if (x === xe && y === ye) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  runEnd(g);
}

/** Пятно света (мягкое — только свет и вспышки). */
function glowC(g: G, X: number, Y: number, R: number, c: C3, a: number, ry = 1): void {
  if (R < 1 || a <= 0.01) return;
  const ga = g.globalAlpha;
  const op = g.globalCompositeOperation;
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'lighter';
  glow(g, X, Y, R, c, a, ry);
  g.globalCompositeOperation = op;
  g.globalAlpha = ga;
}

// ---- Трещины: путь считается один раз, раскрывается по длине -------------

const CRACK = new Map<string, Int16Array>();

/** Путь трещины от нуля по углу `ang` длиной `len` пикселей (с веточками). */
function crackOf(seed: number, ang: number, len: number, wob = 0.5): Int16Array {
  const aq = Math.round(((((ang % TAU) + TAU) % TAU) / TAU) * 128) % 128;
  const L = Math.max(1, Math.round(len));
  const key = `${seed >>> 0}|${aq}|${L}|${wob}`;
  const hit = CRACK.get(key);
  if (hit) return hit;
  if (CRACK.size > 600) CRACK.clear();
  const out: number[] = [];
  const a0 = (aq / 128) * TAU;
  let x = 0;
  let y = 0;
  let a = a0;
  let lx = 0;
  let ly = 0;
  for (let s = 0; s < L; s++) {
    x += Math.cos(a);
    y += Math.sin(a);
    a += (hash(seed, s, 11) - 0.5) * wob + (a0 - a) * 0.1;
    const px = Math.round(x);
    const py = Math.round(y);
    if (px !== lx || py !== ly) {
      out.push(px, py);
      lx = px;
      ly = py;
    }
    if (s > 3 && hash(seed, s, 12) < 0.07) {
      const b = a + (hash(seed, s, 13) < 0.5 ? 1 : -1) * (0.7 + hash(seed, s, 14) * 0.5);
      const bl = 2 + Math.floor(hash(seed, s, 15) * 4);
      for (let q = 1; q <= bl; q++)
        out.push(Math.round(x + Math.cos(b) * q), Math.round(y + Math.sin(b) * q));
    }
  }
  const arr = Int16Array.from(out);
  CRACK.set(key, arr);
  return arr;
}

/** Трещина: раскрыта на долю `frac`, светлый скол с тёмной тенью ниже. */
function crack(
  g: G,
  X: number,
  Y: number,
  path: Int16Array,
  frac: number,
  hi: string,
  lo: string | null,
  a: number,
): void {
  const N = path.length >> 1;
  const n = Math.min(N, Math.ceil(N * k01(frac)));
  if (n <= 0 || a <= 0.012) return;
  const ox = WX(X);
  const oy = WY(Y);
  if (lo && ink(g, lo, a * 0.75)) {
    for (let i = 0; i < n; i++) runPx(g, ox + path[2 * i], oy + path[2 * i + 1] + 1);
    runEnd(g);
  }
  if (ink(g, hi, a)) {
    for (let i = 0; i < n; i++) runPx(g, ox + path[2 * i], oy + path[2 * i + 1]);
    runEnd(g);
  }
}

/**
 * Иней точками по сетке мира (шаг `st`): точки привязаны к миру, а не к
 * метке — когда метка поворачивается, иней не плывёт. `f` → яркость 0…1.
 */
function frostGrid(
  g: G,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  st: number,
  seed: number,
  time: number,
  a: number,
  f: (x: number, y: number, h: number) => number,
): void {
  if (a <= 0.012) return;
  for (const b of FROST_BIN) b.length = 0;
  const i0 = Math.floor(WX(x0) / st);
  const i1 = Math.floor(WX(x1) / st);
  const j0 = Math.floor(WY(y0) / st);
  const j1 = Math.floor(WY(y1) / st);
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      const h = hash(i, j, seed);
      const wx = i * st + Math.floor(hash(i, j, seed + 1) * st);
      const wy = j * st + Math.floor(hash(i, j, seed + 2) * st);
      const v = f(wx + OX + 0.5, wy + OY + 0.5, h);
      if (v <= 0) continue;
      const tw = 0.7 + 0.3 * Math.sin(time * 2.6 + h * 40);
      const lv = Math.min(7, Math.round(a * v * tw * 7));
      if (lv <= 0) continue;
      const kind = h > 0.9 ? 0 : h > 0.45 ? 1 : 2;
      FROST_BIN[kind * 8 + lv].push(wx, wy, h > 0.75 ? 2 : 1);
    }
  for (let b = 0; b < 24; b++) {
    const pts = FROST_BIN[b];
    if (!pts.length) continue;
    const kind = b >> 3;
    ink(g, kind === 0 ? C.white : kind === 1 ? C.frost : C.iceL, (b & 7) / 7);
    for (let i = 0; i < pts.length; i += 3) {
      const wx = pts[i];
      const wy = pts[i + 1];
      if (kind === 0) {
        g.fillRect(wx + QX, wy - 1 + QY, 1, 3);
        g.fillRect(wx - 1 + QX, wy + QY, 3, 1);
      } else g.fillRect(wx + QX, wy + QY, pts[i + 2], 1);
    }
  }
}
/** Корзины инея: [белые звёздочки, иней, лёд] × 8 ступеней яркости. */
const FROST_BIN: number[][] = Array.from({ length: 24 }, () => []);

// ---- Частицы: всё от возраста и зерна, без состояния ---------------------

/** Ком снега: больше двух точек — без углов. */
function clump(g: G, x: number, y: number, s: number): void {
  const X0 = WX(x) + QX;
  const Y0 = WY(y) + QY;
  if (s <= 2) {
    g.fillRect(X0, Y0, s, s);
    return;
  }
  g.fillRect(X0 + 1, Y0, s - 2, s);
  g.fillRect(X0, Y0 + 1, s, s - 2);
}

interface Spray {
  n: number;
  seed: number;
  ang?: number;
  spread?: number;
  /** Скорость по полу, пикс/с. */
  v: [number, number];
  /** Подлёт, пикс/с, и тяжесть: упав, частица лежит. */
  up?: [number, number];
  grav?: number;
  drag?: number;
  life: [number, number];
  size?: [number, number];
  cols: string[];
  r0?: number;
  /** Всплывает (дым, пар), пикс/с. */
  rise?: number;
  delay?: number;
  /** Сжатие пола по вертикали (вид в три четверти). */
  squash?: number;
}

function spray(g: G, X: number, Y: number, age: number, b: Spray, aK = 1): void {
  const sq = b.squash ?? 0.75;
  for (let i = 0; i < b.n; i++) {
    const h1 = hash(b.seed, i, 1);
    const h2 = hash(b.seed, i, 2);
    const h3 = hash(b.seed, i, 3);
    const h4 = hash(b.seed, i, 4);
    const t = age - (b.delay ?? 0) * h4;
    const life = b.life[0] + (b.life[1] - b.life[0]) * h3;
    if (t < 0 || t > life) continue;
    const a = b.spread === undefined ? h1 * TAU : (b.ang ?? 0) + (h1 - 0.5) * b.spread;
    const v = b.v[0] + (b.v[1] - b.v[0]) * h2;
    const dr = b.drag ?? 0;
    const d = dr > 0 ? (v * (1 - Math.exp(-dr * t))) / dr : v * t;
    const r0 = (b.r0 ?? 0) * (0.55 + 0.45 * h4);
    const up = b.up ? b.up[0] + (b.up[1] - b.up[0]) * h2 : 0;
    const z = Math.max(0, up * t - 0.5 * (b.grav ?? 0) * t * t) + (b.rise ?? 0) * t;
    const sz = b.size ? Math.round(b.size[0] + (b.size[1] - b.size[0]) * h3) : 1;
    if (!ink(g, b.cols[i % b.cols.length], (1 - eIn(t / life)) * aK)) continue;
    clump(g, X + Math.cos(a) * (r0 + d) - sz / 2, Y + Math.sin(a) * (r0 + d) * sq - z - sz / 2, sz);
  }
}

interface ShardSpec {
  n: number;
  seed: number;
  ang?: number;
  spread?: number;
  v: [number, number];
  up: [number, number];
  grav: number;
  life: [number, number];
  /** Длина осколка, точек. */
  len?: [number, number];
  cols: string[];
  r0?: number;
  /** Высота старта над полом, пикс. */
  z0?: number;
  /** Вращение, рад/с. */
  spin?: number;
  /** Трение скольжения по льду, 1/с. */
  slide?: number;
  squash?: number;
  /** Какую часть пути рисовать: всё, только полёт, только лёжа. */
  part?: 'all' | 'air' | 'ground';
  delay?: number;
}

/**
 * Осколки по физике: полёт, отскок, скольжение по льду с трением, вращение
 * в воздухе; тень на полу под летящим. Всё — замкнутые формулы от возраста.
 */
function shards(g: G, X: number, Y: number, age: number, s: ShardSpec, aK = 1): void {
  const sq = s.squash ?? 0.75;
  const G0 = s.grav;
  const fr = s.slide ?? 2.5;
  for (let i = 0; i < s.n; i++) {
    const h1 = hash(s.seed, i, 21);
    const h2 = hash(s.seed, i, 22);
    const h3 = hash(s.seed, i, 23);
    const h4 = hash(s.seed, i, 24);
    const t = age - (s.delay ?? 0) * h4;
    const life = s.life[0] + (s.life[1] - s.life[0]) * h3;
    if (t < 0 || t > life) continue;
    const a = s.spread === undefined ? h1 * TAU : (s.ang ?? 0) + (h1 - 0.5) * s.spread;
    const v = s.v[0] + (s.v[1] - s.v[0]) * h2;
    const up = s.up[0] + (s.up[1] - s.up[0]) * h3;
    const z0 = (s.z0 ?? 0) * (0.6 + 0.4 * h4);
    const w = (s.spin ?? 14) * (h2 - 0.5) * 2;
    const t1 = (up + Math.sqrt(up * up + 2 * G0 * z0)) / G0;
    const up2 = (G0 * t1 - up) * 0.28;
    const t2 = (2 * up2) / G0;
    let d: number;
    let z: number;
    let th: number;
    let air = true;
    if (t <= t1) {
      d = v * t;
      z = z0 + up * t - 0.5 * G0 * t * t;
      th = w * t;
    } else if (t <= t1 + t2) {
      const u = t - t1;
      d = v * t1 + v * 0.55 * u;
      z = up2 * u - 0.5 * G0 * u * u;
      th = w * t1 + w * 0.5 * u;
    } else {
      const u = t - t1 - t2;
      const vs = v * 0.5;
      d = v * t1 + v * 0.55 * t2 + (vs * (1 - Math.exp(-fr * u))) / fr;
      z = 0;
      th = w * t1 + w * 0.5 * t2 + (w * 0.3 * (1 - Math.exp(-fr * u))) / fr;
      air = false;
    }
    const part = s.part ?? 'all';
    if ((part === 'air' && !air) || (part === 'ground' && air)) continue;
    const r0 = (s.r0 ?? 0) * (0.5 + 0.5 * h4);
    const fx = X + Math.cos(a) * (r0 + d);
    const fy = Y + Math.sin(a) * (r0 + d) * sq;
    const al = (1 - eIn(k01((t - life * 0.55) / (life * 0.45)))) * aK;
    if (air && z > 1.5 && ink(g, C.ink, 0.28 * al)) pp(g, fx, fy, 2, 1);
    const L = s.len ? Math.round(s.len[0] + (s.len[1] - s.len[0]) * h1) : 1;
    const col = s.cols[i % s.cols.length];
    if (!ink(g, col, al)) continue;
    const cx = fx;
    const cy = fy - z;
    if (L <= 1) {
      pp(g, cx, cy);
      continue;
    }
    const ux = Math.cos(th);
    const uy = Math.sin(th);
    for (let q = 0; q < L; q++) {
      const o = q - (L - 1) / 2;
      pp(g, cx + ux * o, cy + uy * o);
    }
    // Блик на верхнем конце.
    if (ink(g, C.white, al * 0.9))
      pp(g, cx - Math.abs(ux) * ((L - 1) / 2), cy - Math.abs(uy) * ((L - 1) / 2));
  }
}

// ---- Метка мамонта: тень холода, иней, трещины, кромка замыкается ---------

/** Последние 0,2 с перед уроном — ясный сигнал «сейчас». */
const SIG = 0.2;
const sigOf = (left: number) => k01(1 - left / SIG);
let rmq: MediaQueryList | null | undefined;
/** Просили меньше движения: без мигания и с меньшим числом частиц. */
const reduced = () => {
  if (rmq === undefined)
    rmq =
      typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
  return !!rmq?.matches;
};
const mod = (x: number, n: number) => ((x % n) + n) % n;

// ---------------------------------------------------------------------------
// Метки мамонта (анимации 12): «куда» — тень холода и кромка с первого
// кадра; «когда» — иней и трещины растут равномерно по времени, сплошная
// кромка замыкается ровно к удару; последние 0,2 с — белая кромка в две
// точки и сходящееся к ней кольцо. Без красного: это лёд.
// ---------------------------------------------------------------------------

/** Искра на конце замыкающейся кромки. */
function sparkPx(g: G, x: number, y: number, a: number, big = false): void {
  if (!ink(g, C.white, a)) return;
  pp(g, x, y - 1, 1, 3);
  pp(g, x - 1, y, 3, 1);
  if (big) {
    g.globalAlpha = a * 0.55;
    pp(g, x, y - 2, 1, 1);
    pp(g, x, y + 2, 1, 1);
    pp(g, x - 2, y, 1, 1);
    pp(g, x + 2, y, 1, 1);
  }
}

/**
 * Кромка круга: бегущий пунктир — «куда»; сплошная дуга замыкается по
 * часовой от севера — «когда»; последние 0,2 с — белая, в две точки, и к
 * ней сходится внешнее кольцо.
 */
function rimClose(
  g: G,
  X: number,
  Y: number,
  R: number,
  k: number,
  left: number,
  time: number,
  col = C.teal,
): void {
  const s = sigOf(left);
  const kk = k01(k);
  // Тёмный обвод снаружи — кромка читается на любом льду.
  if (ink(g, C.shade, 0.5)) arcPx(g, X, Y, R + 1, 0, TAU);
  if (ink(g, col, 0.6 + 0.25 * kk)) arcPx(g, X, Y, R, 0, TAU, 6, time * 16, 4);
  const a0 = -Math.PI / 2;
  const a1 = a0 + TAU * kk;
  if (ink(g, s > 0 ? C.white : col, 1)) {
    arcPx(g, X, Y, R, a0, a1);
    arcPx(g, X, Y, R - 1, a0, a1);
  }
  if (s > 0) {
    if (ink(g, C.white, 0.9)) arcPx(g, X, Y, R - 1, 0, TAU);
    const rr = R + 2 + 12 * (1 - eOut(s));
    if (s < 1 && ink(g, C.white, 0.3 + 0.6 * s)) arcPx(g, X, Y, rr, 0, TAU, 3, 0, 2);
  } else sparkPx(g, X + Math.cos(a1) * R, Y + Math.sin(a1) * R, 0.95, kk > 0.6);
}

/** Волны холода бегут от тела к кромке — быстрее к удару. */
function ripples(
  g: G,
  X: number,
  Y: number,
  r0: number,
  r1: number,
  a0: number,
  a1: number,
  k: number,
  time: number,
): void {
  if (r1 <= r0 + 2) return;
  for (let q = 0; q < 2; q++) {
    const ph = mod(time * (0.9 + 1.6 * k) + q * 0.5, 1);
    if (ink(g, C.frost, (0.18 + 0.4 * k) * (1 - ph)))
      arcPx(g, X, Y, r0 + (r1 - r0) * ph, a0, a1, 4, 0, 3);
  }
}

/** Круг топота вокруг тела: иней с кромки к ногам, трещины из-под ног. */
function markStomp(
  g: G,
  X: number,
  Y: number,
  R: number,
  k: number,
  left: number,
  time: number,
  seed: number,
): void {
  const s = sigOf(left);
  if (ink(g, C.tealD, 0.16 + 0.18 * k + 0.12 * s)) fDisc(g, X, Y, R);
  ripples(g, X, Y, R * 0.25, R - 2, 0, TAU, k, time);
  const depth = R * (0.12 + 0.8 * eIn(k));
  frostGrid(g, X - R, Y - R, X + R, Y + R, 4, 1201, time, 0.9, (x, y, h) => {
    const d = Math.hypot(x - X, y - Y);
    return d < R - 1.5 && d > R - depth * (0.5 + 0.5 * h) ? 0.45 + 0.55 * h : 0;
  });
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU + hash(seed, i, 31) * 0.5;
    crack(
      g,
      X,
      Y,
      crackOf(seed * 9 + i, a, R * 0.97, 0.5),
      eOut(k),
      C.frost,
      C.shade,
      0.3 + 0.55 * k,
    );
  }
  if (s > 0 && ink(g, C.frost, (reduced() ? 0.1 : 0.22) * s)) fDisc(g, X, Y, R);
  rimClose(g, X, Y, R, k, left, time);
}

/**
 * Конус бивней: иней бежит от тела к кромке ровно к удару, три трещины
 * веером, кромка замыкается с краёв к середине.
 */
function markTusk(
  g: G,
  X: number,
  Y: number,
  ang: number,
  R: number,
  arc: number,
  r0: number,
  k: number,
  left: number,
  time: number,
  seed: number,
): void {
  const s = sigOf(left);
  const h = arc / 2;
  const a0 = ang - h;
  const a1 = ang + h;
  if (ink(g, C.tealD, 0.16 + 0.18 * k + 0.12 * s)) fSector(g, X, Y, 0, R, a0, a1);
  ripples(g, X, Y, r0, R - 2, a0 + 0.04, a1 - 0.04, k, time);
  const rf = r0 + (R - r0) * k01(k);
  frostGrid(g, X - R, Y - R, X + R, Y + R, 4, 1202, time, 0.9, (x, y, hh) => {
    const d = Math.hypot(x - X, y - Y);
    if (d > rf || d > R - 1.5) return 0;
    const off = Math.abs(mod(Math.atan2(y - Y, x - X) - ang + Math.PI, TAU) - Math.PI);
    return off < h - 0.04 ? 0.35 + 0.65 * hh * (d / R) : 0;
  });
  // Фронт инея — тонкая светлая дуга.
  if (ink(g, C.frost, 0.55 + 0.3 * k)) arcPx(g, X, Y, rf, a0 + 0.05, a1 - 0.05, 4, 0, 3);
  for (let i = -1; i <= 1; i++)
    crack(
      g,
      X,
      Y,
      crackOf(seed * 7 + i + 2, ang + i * h * 0.55, R * 0.96, 0.45),
      rf / R,
      C.frost,
      C.shade,
      0.35 + 0.5 * k,
    );
  if (s > 0 && ink(g, C.frost, (reduced() ? 0.1 : 0.24) * s)) fSector(g, X, Y, r0, R, a0, a1);
  // Кромка: пунктир, края замыкаются к середине.
  const col = s > 0 ? C.white : C.teal;
  for (const [aa, bb] of [
    [a0, a0 + h * k01(k)],
    [a1 - h * k01(k), a1],
  ]) {
    if (ink(g, C.shade, 0.6)) arcPx(g, X, Y + 1, R, aa, bb);
    if (ink(g, col, 1)) arcPx(g, X, Y, R, aa, bb);
  }
  if (ink(g, C.teal, 0.5)) arcPx(g, X, Y, R, a0, a1, 6, time * 14, 4);
  for (const a of [a0, a1]) {
    const c = Math.cos(a);
    const sn = Math.sin(a);
    if (ink(g, s > 0 ? C.white : C.teal, s > 0 ? 0.95 : 0.55))
      linePx(g, X + c * r0, Y + sn * r0, X + c * R, Y + sn * R, s > 0 ? 0 : 5, -time * 14, 3);
  }
  if (s > 0) {
    const rr = R + 2 + 10 * (1 - eOut(s));
    if (s < 1 && ink(g, C.white, 0.3 + 0.6 * s)) arcPx(g, X, Y, rr, a0, a1, 3, 0, 2);
  } else {
    sparkPx(g, X + Math.cos(a0 + h * k) * R, Y + Math.sin(a0 + h * k) * R, 0.9);
    sparkPx(g, X + Math.cos(a1 - h * k) * R, Y + Math.sin(a1 - h * k) * R, 0.9);
  }
}

/**
 * Полоса (набег, шипы): тень, иней бежит от тела к концу, кромки
 * замыкаются к концу полосы, снежные шевроны показывают ход.
 */
function markLane(
  g: G,
  X: number,
  Y: number,
  ang: number,
  L: number,
  hw: number,
  k: number,
  left: number,
  time: number,
  seed: number,
  aK = 1,
  r0 = 0,
): void {
  const s = sigOf(left);
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  if (ink(g, C.tealD, (0.16 + 0.18 * k + 0.12 * s) * aK)) fLane(g, X, Y, ang, r0, L, -hw, hw);
  const uf = r0 + (L - r0) * k01(k);
  const bx0 = Math.min(X + ux * r0, X + ux * L) - hw - 2;
  const bx1 = Math.max(X + ux * r0, X + ux * L) + hw + 2;
  const by0 = Math.min(Y + uy * r0, Y + uy * L) - hw - 2;
  const by1 = Math.max(Y + uy * r0, Y + uy * L) + hw + 2;
  // Длинная полоса (вал во всю арену) — иней реже: точек вдвое меньше.
  const fst = L - r0 > 160 ? 6 : 4;
  frostGrid(g, bx0, by0, bx1, by1, fst, 1203, time, 0.9 * aK, (x, y, h) => {
    const dx = x - X;
    const dy = y - Y;
    const u = dx * ux + dy * uy;
    const v = Math.abs(-dx * uy + dy * ux);
    if (u < r0 || u > uf || v > hw - 1.5) return 0;
    // Гуще у кромок: иней лезет с краёв.
    return 0.3 + 0.7 * h * (0.4 + 0.6 * (v / hw));
  });
  crack(
    g,
    X + ux * r0,
    Y + uy * r0,
    crackOf(seed, ang, L - r0, 0.35),
    k,
    C.frost,
    C.shade,
    (0.4 + 0.5 * k) * aK,
  );
  // Шевроны: бегут к концу, быстрее к удару.
  const ch = Math.min(5, hw * 0.55);
  const sp = 16 + 60 * k;
  const off = mod(time * sp, 16);
  if (ink(g, s > 0 ? C.white : C.frost, (0.3 + 0.5 * k) * aK))
    for (let u = r0 + 6 + off; u < uf - 3; u += 16) {
      const cx = X + ux * u;
      const cy = Y + uy * u;
      for (const sd of [-1, 1])
        linePx(g, cx, cy, cx - ux * ch - uy * ch * sd * 1.2, cy - uy * ch + ux * ch * sd * 1.2);
    }
  // Кромки: пунктир на всю длину, сплошные — до фронта.
  for (const sd of [-1, 1]) {
    const ex = -uy * hw * sd;
    const ey = ux * hw * sd;
    const x0 = X + ux * r0 + ex;
    const y0 = Y + uy * r0 + ey;
    if (ink(g, C.teal, 0.5 * aK))
      linePx(g, x0, y0, X + ux * L + ex, Y + uy * L + ey, 6, -time * 16, 4);
    if (ink(g, C.shade, 0.6 * aK)) linePx(g, x0, y0 + 1, X + ux * uf + ex, Y + uy * uf + ey + 1);
    if (ink(g, s > 0 ? C.white : C.teal, aK)) linePx(g, x0, y0, X + ux * uf + ex, Y + uy * uf + ey);
    if (s <= 0) sparkPx(g, X + ux * uf + ex, Y + uy * uf + ey, 0.9 * aK);
  }
  // Торец.
  if (ink(g, s > 0 ? C.white : C.teal, (0.4 + 0.5 * k) * aK))
    linePx(
      g,
      X + ux * L - uy * hw,
      Y + uy * L + ux * hw,
      X + ux * L + uy * hw,
      Y + uy * L - ux * hw,
    );
  if (s > 0 && ink(g, C.frost, (reduced() ? 0.1 : 0.22) * s * aK))
    fLane(g, X, Y, ang, r0, L, -hw, hw);
}

/** Сюда он врежется: звезда трещин на стене и бирюзовый пульс. */
function markWallStar(
  g: G,
  ex: number,
  ey: number,
  ang: number,
  k: number,
  time: number,
  seed: number,
): void {
  const pulse = 0.55 + 0.45 * Math.sin(time * 9);
  for (let i = 0; i < 7; i++) {
    const a = ang + ((i - 3) / 3) * 1.4;
    crack(
      g,
      ex,
      ey,
      crackOf(seed * 13 + i, a, 9 + 6 * k, 0.6),
      1,
      C.tealL,
      C.shade,
      (0.4 + 0.5 * k) * pulse,
    );
  }
  if (ink(g, C.teal, 0.75 * k)) arcPx(g, ex, ey, 6 + 4 * pulse, 0, TAU, 3, time * 10, 2);
  sparkPx(g, ex, ey, 0.6 + 0.4 * pulse, true);
}

function mammothMarks(g: G, sim: Sim, left: number, top: number, time: number): void {
  const m = f12Mammoth(sim);
  if (!m || m.mode === 'dying') return;
  pin(g, -left, -top);
  const T = MAMMOTH;
  const X = m.x * TS - left;
  const Y = m.y * TS - top;
  const sd = (m.id >>> 0) % 997;
  switch (m.mode) {
    case 'f12b_tusk': {
      if (m.t >= T.tusk.hit) return;
      const k = m.t / T.tusk.hit;
      markTusk(
        g,
        X,
        Y,
        m.face,
        T.tusk.r * TS,
        T.tusk.arc,
        m.r * TS * 0.55,
        k,
        T.tusk.hit - m.t,
        time,
        sd,
      );
      return;
    }
    case 'f12b_stomp': {
      if (m.t >= T.stomp.hit) return;
      markStomp(g, X, Y, T.stomp.r * TS, m.t / T.stomp.hit, T.stomp.hit - m.t, time, sd + 3);
      return;
    }
    case 'f12b_paw': {
      const len = m.data.len ?? 14;
      const k = k01(m.data.k ?? 0);
      const L = len * TS;
      const hw = (m.r + 0.3) * TS;
      markLane(g, X, Y, m.face, L, hw, k, (1 - k) * T.paw, time, sd + 5, 1, m.r * TS * 0.6);
      if (len < 13.9)
        markWallStar(g, X + Math.cos(m.face) * L, Y + Math.sin(m.face) * L, m.face, k, time, sd);
      return;
    }
    case 'f12b_charge': {
      // Несётся: короткий клин впереди, шевроны бегут быстро.
      const hw = (m.r + 0.3) * TS;
      markLane(g, X, Y, m.face, 4.5 * TS + m.r * TS, hw, 1, 1, time * 2.5, sd + 5, 0.45, m.r * TS);
      return;
    }
    case 'f12b_spikes': {
      if (m.t >= T.spikes.hit) return;
      // До удара хобота — три будущие линии: «куда» с первого кадра.
      const total = T.spikes.hit + T.spikes.warn;
      const k = m.t / total;
      [-0.38, 0, 0.38].forEach((off, i) => {
        const ang = m.face + off;
        const x = m.x + Math.cos(ang) * (m.r + 0.4);
        const y = m.y + Math.sin(ang) * (m.r + 0.4);
        const L = Math.min(T.spikes.len, rayLen(sim, x, y, ang, T.spikes.len)) * TS;
        markLane(
          g,
          x * TS - left,
          y * TS - top,
          ang,
          L,
          0.9 * TS,
          k,
          total - m.t,
          time,
          sd + 11 + i,
          0.8,
        );
      });
      return;
    }
    case 'f12b_rear': {
      if (m.t >= 0.9) return;
      // Не урон — отброс: белая кромка без тени, снег приподнимается.
      const k = m.t / 0.9;
      const R = 3.6 * TS;
      frostGrid(g, X - R, Y - R, X + R, Y + R, 5, 1204, time, 0.7, (x, y, h) => {
        const d = Math.hypot(x - X, y - Y);
        return d < R - 1 && d > R - R * 0.35 * k * (0.5 + 0.5 * h) ? 0.5 * h + 0.3 : 0;
      });
      rimClose(g, X, Y, R, k, 0.9 - m.t, time, C.snowM);
      return;
    }
  }
}

F12_FLOOR_HOOKS.push(mobMarks, mammothMarks);

// ---------------------------------------------------------------------------
// Над темнотой: слабое место в оглушении, волна бубна, ветер на жаровню,
// искры ледника.
// ---------------------------------------------------------------------------

/**
 * Скобы прицела у треснувшего бивня — только пока урон больше: оглушён
 * (×2) — ярко; юз и подъём (×1,3) — бледно.
 */
function weakSpot(g: G, m: Mob, X: number, Y: number, time: number): void {
  const full = m.mode === 'f12b_stunned';
  if (!full && m.mode !== 'f12b_getup' && m.mode !== 'f12b_skid') return;
  const [tx, ty] = mamPointPx(m, 'tusk');
  const hx = X + tx;
  const hy = Y + ty;
  const p = reduced() ? 0.6 : 0.5 + 0.5 * Math.sin(time * 8);
  const intro = full ? eOut(m.t / 0.25) : 0.4;
  glow(g, hx, hy, 12 + 4 * p, P.teal, (0.2 + 0.15 * p) * intro, 1, true);
  const d = 7 + 3 * p + 10 * (1 - intro);
  if (ink(g, C.teal, (0.7 + 0.3 * p) * intro))
    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      const cx = hx + sx * d;
      const cy = hy + sy * d;
      pp(g, cx - (sx > 0 ? 3 : 0), cy, 4, 1);
      pp(g, cx, cy - (sy > 0 ? 3 : 0), 1, 4);
    }
  // Три искры льда кружат у трещины.
  for (let i = 0; i < 3; i++) {
    const a = time * 3 + (i * TAU) / 3;
    sparkPx(g, hx + Math.cos(a) * 9, hy + Math.sin(a) * 5, (0.5 + 0.4 * p) * intro);
  }
}

/** Бубен: на каждый удар — звуковое кольцо; вал рождается волной снега от бубна. */
function drumWaves(
  g: G,
  sim: Sim,
  m: Mob,
  X: number,
  Y: number,
  left: number,
  top: number,
  time: number,
): void {
  const [dx, dy] = mamPointPx(m, 'drum');
  const DX = X + dx;
  const DY = Y + dy;
  if (m.mode === 'f12b_drum') {
    const bt = mod(m.t, MAMMOTH.drum.beat);
    if (bt < 0.22) {
      const q = bt / 0.22;
      const r = 3 + 13 * eOut(q);
      for (const [c, rr, a] of [
        [C.shade, r + 1, 0.6],
        [C.white, r, 0.95],
      ] as const)
        if (ink(g, c, a * (1 - q))) {
          arcPx(g, DX, DY, rr, -0.9, 0.9);
          arcPx(g, DX, DY, rr, Math.PI - 0.9, Math.PI + 0.9);
        }
      if (ink(g, C.frost, 0.7 * (1 - q))) arcPx(g, DX, DY, r * 0.6, -0.7, 0.7);
    }
  }
  // Волна к валу: снежный фронт от бубна во всю ширину арены — один раз на
  // пару отрезков (одна строка, один возраст).
  const seen: number[] = [];
  for (const st of sim.strikes) {
    if (st.art !== 'f12_snowwall' || st.from !== m.id || st.t > 0.45) continue;
    const key = Math.round(st.y * 8) * 1000 + Math.round(st.t * 60);
    if (seen.includes(key)) continue;
    seen.push(key);
    const wy = st.y * TS - top;
    const dir = wy >= Y ? 1 : -1;
    const D = Math.max(16, Math.abs(wy - DY));
    const q = st.t / 0.32;
    const e = eOut(q);
    const ry = 4 + (D - 4) * e;
    const rx = 6 + 200 * e;
    const a = (1 - eIn(st.t / 0.45)) * 0.95;
    const sd = Math.round(st.y * 31);
    // Передняя половина эллипса — к валу; задняя — бледнее.
    // Три прохода одним цветом: тень под комьями, хвост фронта, сами комья.
    const n = Math.round(70 + 120 * e);
    const at = (i: number, rr: number): [number, number, number] => {
      const ang = (i / n) * TAU + hash(sd, i, 1) * 0.05;
      const jit = (hash(sd, i, 2) - 0.5) * 3;
      const front = Math.sin(ang) * dir > 0 ? 1 : 0.35;
      return [DX + Math.cos(ang) * (rx * rr + jit), DY + Math.sin(ang) * (ry * rr + jit), front];
    };
    for (const pass of [0, 1, 2]) {
      const col = pass === 0 ? C.snowD : pass === 1 ? C.snowM : C.snow;
      if (!ink(g, col, a * (pass === 0 ? 0.6 : pass === 1 ? 0.5 : 1))) continue;
      for (let i = 0; i < n; i++) {
        const [x, y, f] = at(i, pass === 1 ? 0.9 : 1);
        if (f < 1 && (pass === 1 || i % 2)) continue;
        const sz = i % 4 === 0 ? 3 : 2;
        if (pass === 0) pp(g, x, y + sz, sz, 1);
        else if (pass === 1) pp(g, x, y, 2, 1);
        else clump(g, x, y, sz);
      }
    }
    if (ink(g, C.white, a))
      for (let i = 0; i < n; i += 3) {
        const [x, y, f] = at(i, 1);
        if (f === 1) pp(g, x, y - 1, 1, 1);
      }
    // Хвост позёмки за фронтом.
    if (ink(g, C.snowM, a * 0.6))
      for (let i = 0; i < 24; i++) {
        const ang = (hash(sd, i, 5) * 0.8 + 0.1) * Math.PI * dir;
        const k2 = 0.5 + 0.4 * hash(sd, i, 6);
        pp(g, DX + Math.cos(ang) * rx * k2, DY + Math.sin(ang) * ry * k2, 2, 1);
      }
  }
  void left;
  void time;
}

/** Дует на жаровню: струя инея от хобота, искры сдувает, огонь клонится. */
function blowWind(
  g: G,
  m: Mob,
  X: number,
  Y: number,
  left: number,
  top: number,
  time: number,
): void {
  if (m.mode !== 'f12b_blow') return;
  const t = m.t;
  const w = MAMMOTH.blow;
  if (t < 0.4 || t > w.end) return;
  const [tx, ty] = mamPointPx(m, 'tusk');
  const sx = X + tx;
  const sy = Y + ty + 4;
  const ex = (m.data.bx ?? m.x) * TS - left;
  const ey = (m.data.by ?? m.y) * TS - top - 10;
  const head = eOut((t - 0.4) / (w.hit - 0.05 - 0.4));
  const env = 1 - k01((t - w.hit - 0.1) / 0.3);
  const ddx = ex - sx;
  const ddy = ey - sy;
  const L = Math.hypot(ddx, ddy) || 1;
  const ux = ddx / L;
  const uy = ddy / L;
  for (let i = 0; i < 26; i++) {
    const h = hash(i, 3, 77);
    const p = mod(time * (1.5 + h * 0.8) + h, 1);
    if (p > head) continue;
    const wob = Math.sin(p * 9 + h * 6 + time * 4) * (2 + 5 * p);
    const x = sx + ddx * p - uy * wob;
    const y = sy + ddy * p + ux * wob;
    const a = env * (0.3 + 0.6 * (1 - p)) * (0.6 + 0.4 * h);
    if (ink(g, i % 3 ? C.frost : C.white, a)) {
      pp(g, x, y);
      pp(g, x - ux * 2, y - uy * 2);
      if (i % 2) pp(g, x - ux * 4, y - uy * 4);
    }
  }
  // Искры жаровни сдувает прочь — огонь клонится (до гашения).
  if (t > 0.6 && t < w.hit + 0.05) {
    const q = (t - 0.6) / (w.hit - 0.6);
    for (let i = 0; i < 9; i++) {
      const h = hash(i, 9, 78);
      const p = mod(time * (1.8 + h) + h, 1);
      const x = ex + ux * p * 22 + (h - 0.5) * 6;
      const y = ey + uy * p * 22 - p * 6 + (hash(i, 9, 79) - 0.5) * 4;
      if (ink(g, p < 0.4 ? C.fireL : C.fire, (1 - p) * q)) pp(g, x, y);
    }
  }
  // Погасла: жаровня под головой мамонта, поэтому дым и пар — здесь, над
  // телом. Клубы растут и уходят по ветру, иней искрит у бивня.
  if (t >= w.hit) {
    const q = t - w.hit;
    for (const pass of [0, 1])
      for (let i = 0; i < 9; i++) {
        const t0 = i * 0.03;
        const p = (q - t0) / 0.42;
        if (p < 0 || p > 1) continue;
        const h = hash(i, 4, 82);
        const r = 2 + Math.round(4 * eOut(p));
        const x = ex + ux * 18 * eOut(p) + (h - 0.5) * 10 + Math.sin(p * 5 + h * 6) * 3;
        const y = ey - 4 - 30 * eOut(p) + pass;
        const col = pass ? (i % 3 ? C.smoke : C.smokeL) : C.ink;
        if (ink(g, col, (pass ? 0.75 : 0.25) * (1 - eIn(p)))) clump(g, x, y, r);
      }
    if (q < 0.3)
      for (let i = 0; i < 6; i++) {
        const a = hash(i, 5, 83) * TAU;
        const d = 3 + 14 * eOut(q / 0.3) * (0.5 + hash(i, 6, 83));
        sparkPx(g, ex + Math.cos(a) * d, ey + Math.sin(a) * d * 0.6, 1 - q / 0.3);
      }
  }
}

/** Ледник живой: редкие блики бегут по граням поднятых слоёв. */
function glacierGlints(g: G, sim: Sim, left: number, top: number, time: number): void {
  const gl = f12Glacier(sim);
  if (!gl.layer) return;
  const w = sim.world.w;
  const { w: sw, h: sh } = screenOf(g);
  for (let L = 0; L < gl.layer && L < gl.layers.length; L++)
    for (const i of gl.layers[L]) {
      if (sim.tiles[i] !== 1) continue;
      const cx = (i % w) * TS - left;
      const cy = Math.floor(i / w) * TS - top;
      if (cx < -TS || cy < -TS || cx > sw || cy > sh) continue;
      const ph = mod(time / 2.9 + hash(i, 5, 81), 1);
      if (ph > 0.12) continue;
      const q = ph / 0.12;
      const a = Math.sin(q * Math.PI);
      const x = cx + 3 + Math.floor(hash(i, 6, 81) * 10);
      const y = cy + 2 + Math.floor(hash(i, 7, 81) * 9);
      sparkPx(g, x, y, a * 0.9, a > 0.6);
    }
}

F12_SKY_HOOKS.push((g, sim, left, top, time) => {
  pin(g, -left, -top);
  glacierGlints(g, sim, left, top, time);
  const m = f12Mammoth(sim);
  if (!m || m.mode === 'dying') return;
  const X = m.x * TS - left;
  const Y = m.y * TS - top;
  weakSpot(g, m, X, Y, time);
  drumWaves(g, sim, m, X, Y, left, top, time);
  blowWind(g, m, X, Y, left, top, time);
  g.globalAlpha = 1;
});

// ---------------------------------------------------------------------------
// Удары по площади: метка до `warn`, контакт — `registerImpactPainter`.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Пиксельные рисунки (анимации 12): сосульки, шипы, сугробы, ленты сияния.
// Всё — в `frameLRU`, прогрев — `registerMobWarm('f12boss')`.
// ---------------------------------------------------------------------------

type RGBA = [number, number, number, number];
const rgbaOf = (h: string, a = 255): RGBA => {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255, a];
};
const OUTLINE: RGBA = [10, 20, 44, 235];

const SPR = frameLRU<HTMLCanvasElement>(320);
function sprite(key: string, make: () => Px): HTMLCanvasElement {
  return SPR.get(key) ?? SPR.set(key, make().canvas());
}

/** Холст на сетку мира: левый верх (x, y) — экранные игровые пиксели. */
function blitPx(g: G, cv: HTMLCanvasElement, x: number, y: number): void {
  g.drawImage(cv, WX(x) + QX, WY(y) + QY);
}

/** Эллипс строками (тень, лужа). */
function fEll(g: G, X: number, Y: number, rx: number, ry: number): void {
  if (rx < 0.5 || ry < 0.5) return;
  for (let j = WY(Y - ry); j <= WY(Y + ry); j++) {
    const dy = (j + 0.5 + OY - Y) / ry;
    const q = 1 - dy * dy;
    if (q <= 0) continue;
    const hw = rx * Math.sqrt(q);
    hrow(g, X - hw, X + hw, j);
  }
}

/** Поворот пиксельного рисунка вокруг центра (ближайший сосед), с контуром. */
function rotPx(src: Px, th: number): Px {
  const S = Math.ceil(Math.hypot(src.w, src.h)) + 2;
  const out = new Px(S, S);
  const c = Math.cos(th);
  const s = Math.sin(th);
  const cx = (S - 1) / 2;
  const cy = (S - 1) / 2;
  const sx0 = (src.w - 1) / 2;
  const sy0 = (src.h - 1) / 2;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const u = Math.round(c * dx + s * dy + sx0);
      const v = Math.round(-s * dx + c * dy + sy0);
      if (u < 0 || v < 0 || u >= src.w || v >= src.h) continue;
      const p = src.get(u, v);
      if (p[3]) out.set(x, y, p);
    }
  out.outline(OUTLINE);
  return out;
}

// ---- Сосулька -----------------------------------------------------------

const ICE_W = 9;
const ICE_H = 23;

/** Сосулька остриём вниз: скол сверху со снегом, грани, блик слева. */
function iciclePx(v: number): Px {
  const p = new Px(ICE_W, ICE_H);
  const cols = [C.white, C.frost, C.iceL, C.ice, C.iceM, C.iceD].map((c) => rgbaOf(c));
  for (let y = 0; y < ICE_H; y++) {
    const half = 3.9 * (1 - y / ICE_H) ** 0.85 + 0.35;
    const mid = 4 + (v ? 0.35 : -0.2) * (y / ICE_H);
    for (let x = 0; x < ICE_W; x++) {
      const d = x - mid;
      if (Math.abs(d) > half) continue;
      // Свет сверху-слева: левая грань светлая, правая в тени.
      const f = (d + half) / (2 * half + 0.001);
      let i = f < 0.25 ? 1 : f < 0.55 ? 3 : f < 0.8 ? 4 : 5;
      if (y > ICE_H * 0.75 && i > 2) i -= 1;
      p.set(x, y, cols[i]);
    }
    // Блик вдоль левой грани.
    if (y > 2 && y < ICE_H - 5 && (y + v) % 7 !== 0)
      p.set(Math.round(mid - half * 0.45), y, cols[0]);
  }
  // Пузырьки воздуха в толще.
  for (let q = 0; q < 3; q++) {
    const y = 5 + q * 5 + v;
    p.set(Math.round(4 + (q % 2 ? 1 : 0)), y, cols[2]);
  }
  // Скол сверху: неровная кромка и шапка снега.
  const snow = rgbaOf(C.snow);
  const snowS = rgbaOf(C.snowM);
  for (let x = 0; x < ICE_W; x++) {
    const h = hash(x, v, 401) < 0.5 ? 1 : 2;
    for (let y = 0; y < h; y++) p.set(x, y, y === 0 ? snow : snowS);
  }
  p.set(0, 0, null);
  p.set(ICE_W - 1, 0, null);
  return p;
}

/** Повёрнутая сосулька: 13 шагов по 0,1 рад в обе стороны. */
function icicleRot(v: number, th: number): HTMLCanvasElement {
  const q = Math.max(-6, Math.min(6, Math.round(th / 0.1)));
  return sprite(`ic|${v}|${q}`, () => rotPx(iciclePx(v), q * 0.1));
}

/** Обломок сосульки, торчащий изо льда (верх — скол). */
function icicleStub(v: number): HTMLCanvasElement {
  return sprite(`icstub|${v}`, () => {
    const src = iciclePx(v);
    const p = new Px(ICE_W, 9);
    for (let y = 0; y < 9; y++)
      for (let x = 0; x < ICE_W; x++) {
        const c = src.get(x, y + 12);
        if (c[3]) p.set(x, y, c);
      }
    // Скол сверху — белый.
    const w = rgbaOf(C.white);
    for (let x = 0; x < ICE_W; x++) if (p.get(x, 0)[3]) p.set(x, 0, w);
    p.outline(OUTLINE);
    return p;
  });
}

/**
 * Сосулька со свода (мамонт топнул): висит и дрожит, сыплет крошку —
 * отрывается — падает с ускорением, вращаясь, со следом инея. Тень на полу
 * рисует метка удара; разбивается — контакт `f12_iciclefall`.
 */
zoneFx('f12_icdrop', (g, z, X, Y, k, age, time) => {
  const life = Math.max(0.05, z.life);
  if (k >= 1) return;
  pin(g, X - z.x * TS, Y - z.y * TS);
  const sd = seedOf(z);
  const v = sd & 1;
  const H0 = 150;
  const hang = Math.min(0.32, life * 0.3);
  const tf = k01((age - hang) / (life - hang));
  const hgt = H0 * (1 - tf * tf);
  const vel = (2 * H0 * tf) / (life - hang);
  const spin = (hash(sd, 1, 5) - 0.5) * 1.1;
  const th = (hash(sd, 2, 5) - 0.5) * 0.25 + spin * tf * tf;
  // Висит: дрожит, сыплет снег.
  const shake = tf <= 0 ? (Math.floor(time * 28) % 2 ? 1 : -1) * (age > hang * 0.4 ? 1 : 0) : 0;
  const cx = X + shake;
  const cy = Y - hgt;
  spray(g, X, Y - H0 + 2, age, {
    n: reduced() ? 4 : 9,
    seed: sd + 3,
    v: [2, 8],
    up: [0, 0],
    rise: -110,
    life: [0.25, 0.5],
    delay: hang,
    size: [1, 2],
    cols: [C.snow, C.white, C.snowM],
  });
  // След падения: полосы инея над сосулькой и блёстки, что остались в воздухе.
  if (tf > 0.05) {
    const L = Math.min(46, vel * 0.055);
    for (let q = 0; q < 3; q++) {
      const a = (0.42 - q * 0.12) * (0.4 + 0.6 * tf);
      if (ink(g, q ? C.frost : C.white, a))
        pp(
          g,
          cx - 2 + q,
          cy - 10 - L * (0.3 + q * 0.35),
          1,
          Math.max(1, Math.round(L * (0.7 - q * 0.15))),
        );
    }
    for (let i = 0; i < 7; i++) {
      const ti = hang + (i / 7) * (age - hang);
      const tq = k01((ti - hang) / (life - hang));
      const yh = H0 * (1 - tq * tq);
      const a = (1 - (age - ti) / 0.35) * 0.8;
      if (a > 0 && ink(g, C.white, a)) pp(g, X + (hash(sd, i, 7) - 0.5) * 7, Y - yh - 8);
    }
  }
  const cv = icicleRot(v, th);
  blitPx(g, cv, cx - cv.width / 2, cy - cv.height / 2 - 8);
  // Холодный отблеск на кончике у самого пола.
  if (tf > 0.8) glowC(g, X, Y - 2, 6 + 6 * tf, P.teal, 0.25 * (tf - 0.8) * 5, 0.5);
});

/** Метка сосульки: тень растёт и темнеет, кромка замыкается, перекрестье. */
registerZonePainter('f12_iciclefall', (g, st, px, py, _s, time) => {
  const s = st as Strike;
  const k = k01(s.t / Math.max(0.05, s.warn));
  const R = s.r * TS;
  const sim = paintSim();
  const mam = sim ? f12Mammoth(sim) : null;
  if (!mam || s.from !== mam.id) {
    // Сосулька-моб: тёплый красный язык мобов этажа.
    glow(g, px, py, R * (1.5 - 0.5 * k), P.ink, 0.25 + 0.45 * k, 0.6);
    markCircle(g, px, py, R, k, time, s.id);
    dot(g, px - 2, py, 5, 1, P.frost, 0.4 + 0.5 * k);
    dot(g, px, py - 2, 1, 5, P.frost, 0.4 + 0.5 * k);
    return true;
  }
  pin(g, px - s.x * TS, py - s.y * TS);
  const left = s.warn - s.t;
  const sig = sigOf(left);
  const e = eIn(k);
  if (ink(g, C.shade, 0.12 + 0.16 * k)) fDisc(g, px, py, R);
  if (ink(g, C.shade, 0.2 + 0.45 * e)) fEll(g, px, py, R * (0.3 + 0.55 * e), R * (0.2 + 0.4 * e));
  if (ink(g, C.ink, 0.3 * e)) fEll(g, px, py, R * 0.3 * e, R * 0.2 * e);
  frostGrid(g, px - R, py - R, px + R, py + R, 4, 1210, time, 0.8, (x, y, h) => {
    const d = Math.hypot(x - px, y - py);
    return d < R - 1.5 && d > R * (1 - 0.6 * k) ? 0.4 + 0.6 * h : 0;
  });
  // Перекрестье сходится к точке.
  const d = 4 + 6 * (1 - k);
  if (ink(g, sig > 0 ? C.white : C.frost, 0.5 + 0.5 * k)) {
    pp(g, px - d - 3, py, 3, 1);
    pp(g, px + d + 1, py, 3, 1);
    pp(g, px, py - d - 3, 1, 3);
    pp(g, px, py + d + 1, 1, 3);
  }
  rimClose(g, px, py, R, k, left, time);
  return true;
});

registerImpactPainter('f12_iciclefall', {
  life: 1.35,
  shake: 0.15,
  paint(g, rec, px, py, _s, age) {
    pin(g, px - rec.x * TS, py - rec.y * TS);
    const R = (rec.r ?? 1) * TS;
    const sd = rec.seed >>> 0;
    const fade = 1 - k01((age - 0.8) / 0.55);
    // Вмятина и трещины звездой.
    if (ink(g, C.shade, 0.35 * fade)) fEll(g, px, py, 5, 3);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU + hash(sd, i, 1) * 0.6;
      crack(
        g,
        px,
        py,
        crackOf(sd + i, a, R * (0.8 + 0.4 * hash(sd, i, 2)), 0.55),
        eOut(age / 0.09),
        C.frost,
        C.shade,
        0.8 * fade,
      );
    }
    // Вспышка удара — звезда на кадр.
    if (age < 0.07) {
      const q = 1 - age / 0.07;
      glowC(g, px, py - 2, 14, P.white, 0.55 * q, 0.7);
      if (ink(g, C.white, q)) {
        pp(g, px - 5, py, 11, 1);
        pp(g, px, py - 6, 1, 11);
        pp(g, px - 2, py - 2, 1, 1);
        pp(g, px + 2, py - 2, 1, 1);
        pp(g, px - 2, py + 2, 1, 1);
        pp(g, px + 2, py + 2, 1, 1);
      }
    }
    // Кольцо ледяной пыли.
    if (age < 0.28) {
      const q = age / 0.28;
      if (ink(g, C.white, 0.85 * (1 - q)))
        arcPx(g, px, py, 4 + R * 1.15 * eOut(q), 0, TAU, 3, 0, 2);
    }
    // Обломок торчит изо льда — и рассыпается.
    if (age < 0.32) {
      const cv = icicleStub(sd & 1);
      blitPx(g, cv, px - cv.width / 2, py - cv.height + 2 + Math.floor(age * 10));
    }
    const big = reduced() ? 2 : 3;
    shards(g, px, py, age, {
      n: big,
      seed: sd + 11,
      v: [50, 85],
      up: [40, 90],
      grav: 430,
      z0: 8,
      len: [4, 6],
      spin: 16,
      slide: 2.4,
      life: [0.95, 1.25],
      cols: [C.iceL, C.ice, C.frost],
    });
    shards(g, px, py, age, {
      n: reduced() ? 7 : 14,
      seed: sd + 13,
      v: [30, 115],
      up: [30, 120],
      grav: 460,
      z0: 6,
      len: [1, 2],
      spin: 22,
      slide: 3,
      life: [0.55, 1.0],
      cols: [C.white, C.frost, C.iceL, C.iceM],
    });
    // Второй хруст: обломок осыпается.
    shards(g, px, py - 4, age - 0.32, {
      n: 6,
      seed: sd + 17,
      v: [15, 45],
      up: [20, 50],
      grav: 400,
      len: [1, 2],
      life: [0.4, 0.7],
      cols: [C.ice, C.frost, C.iceM],
    });
    spray(
      g,
      px,
      py - 3,
      age,
      {
        n: reduced() ? 6 : 12,
        seed: sd + 19,
        v: [10, 34],
        drag: 3,
        rise: 9,
        life: [0.4, 0.85],
        size: [2, 3],
        cols: [C.snow, C.white, C.snowM],
      },
      0.75,
    );
    return age < 1.35;
  },
});

/** Вода из-под льдины: тёмный круг, рябь сходится, пузыри. */
registerZonePainter('f12_surge', (g, st, px, py, _s, time) => {
  const s = st as Strike;
  const k = k01(s.t / Math.max(0.05, s.warn));
  const R = s.r * TS;
  glow(g, px, py, R * 1.2, P.water, 0.55 + 0.3 * k);
  markCircle(g, px, py, R, k, time, s.id);
  for (let i = 0; i < 3; i++) {
    const r = R * (1 - ((time * 0.9 + i / 3) % 1));
    ringTicks(g, px, py, r, P.waterL, 0.5 * k, 3, s.id + i, 0.8);
  }
  const sd = s.id >>> 0;
  for (let i = 0; i < 6; i++) {
    const ph = (time * (1.4 + hash(sd, i, 2)) + hash(sd, i, 3)) % 1;
    const a = hash(sd, i, 4) * TAU;
    const r = hash(sd, i, 5) * R * 0.7;
    dot(g, px + Math.cos(a) * r, py + Math.sin(a) * r - ph * 3, 1, 1, P.foam, k * (1 - ph));
  }
  return true;
});

registerImpactPainter('f12_surge', {
  life: 1,
  shake: 0.14,
  paint(g, rec, px, py, _s, age) {
    const R = (rec.r ?? 1.2) * TS;
    const sd = rec.seed >>> 0;
    if (age < 0.5)
      ringTicks(g, px, py, R * (0.5 + eOut(age / 0.5)), P.foam, 1 - age / 0.5, 2, sd, 0.9);
    // Столб воды: брызги вверх и обратно.
    burst(g, px, py, age, {
      n: 26,
      seed: sd,
      v: [6, 34],
      up: [70, 140],
      grav: 330,
      life: [0.6, 0.95],
      size: [1, 2],
      cols: [P.foam, P.waterL, P.white, P.ice],
    });
    glow(g, px, py, R, P.foam, 0.35 * (1 - k01(age / 0.4)), 0.7);
    return age < 1;
  },
});

// ---- Вал вьюги ----------------------------------------------------------

const DRIFT_H = 24;
const DRIFT_BASE = DRIFT_H - 4;

/**
 * Сугроб вала: верх светлый (свет сверху), лицо к зрителю в тени, гребень
 * с карнизом, складки. Растёт — выезжает из-под снега (`driftAt`).
 */
function driftCv(sd: number, Lpx: number): HTMLCanvasElement {
  return sprite(`dr|${sd}|${Lpx}`, () => {
    const p = new Px(Lpx, DRIFT_H);
    const white = rgbaOf(C.white);
    const snow = rgbaOf(C.snow);
    const mid = rgbaOf(C.snowM);
    const sh = rgbaOf(C.snowS);
    const dk = rgbaOf(C.snowD);
    const Hm = 14;
    const f1 = hash(sd, 1, 41) * 6;
    const f2 = hash(sd, 2, 41) * 6;
    const hAt = (x: number) => {
      const end = Math.min(1, x / 9, (Lpx - 1 - x) / 9);
      const n = 0.72 + 0.16 * Math.sin(x * 0.13 + f1) + 0.12 * Math.sin(x * 0.37 + f2);
      return Math.max(0, Hm * n * Math.sqrt(Math.max(0, end)));
    };
    for (let x = 0; x < Lpx; x++) {
      const h = Math.round(hAt(x));
      if (h <= 0) continue;
      const top = DRIFT_BASE - h;
      const slope = hAt(x + 1) - hAt(x - 1);
      const face = Math.max(1, Math.round(h * 0.55));
      for (let y = top; y <= DRIFT_BASE; y++) {
        const d = y - top;
        let c = d < 2 ? snow : d < h - face ? snow : y >= DRIFT_BASE - 1 ? sh : mid;
        // Свет слева: склон, что смотрит влево-вверх, светлее.
        if (d === 0 && slope > 0.15) c = white;
        if (d > 1 && d < h - face && slope < -0.2) c = mid;
        p.set(x, y, c);
      }
      // Складки на лице сугроба.
      if ((x + sd) % 9 === 0 && h > 4)
        for (let y = DRIFT_BASE - face + 1; y < DRIFT_BASE; y++) p.set(x, y, sh);
      // Карниз гребня нависает тенью.
      if (h > 5) p.set(x, top + 2, hash(x, sd, 42) < 0.5 ? mid : snow);
      p.set(x, DRIFT_BASE + 1, dk);
    }
    p.outline(OUTLINE);
    return p;
  });
}

/** Зерно сугроба по месту отрезка: метка и контакт рисуют один и тот же вал. */
const driftSeed = (x: number, y: number) =>
  ((Math.round(x * 4) * 31 + Math.round(y * 4) * 17) % 64) >>> 0;

/** Сугроб, выросший на долю `grow` (0…1): выезжает из пола, низ срезан. */
function driftAt(g: G, sd: number, L: number, x: number, y: number, grow: number): void {
  const Lpx = Math.max(4, Math.round(L));
  const cv = driftCv(sd, Lpx);
  const shift = Math.round((1 - grow) * 16);
  const h = DRIFT_H - shift;
  if (h <= 0) return;
  g.drawImage(cv, 0, 0, Lpx, h, WX(x) + QX, WY(y - DRIFT_BASE + 3 + shift) + QY, Lpx, h);
}

/** Соседний отрезок того же вала (вал режется проёмом надвое). */
function wallPartner(sim: Sim, s: Strike): Strike | null {
  for (const o of sim.strikes)
    if (
      o !== s &&
      o.art === 'f12_snowwall' &&
      Math.abs(o.y - s.y) < 0.01 &&
      Math.abs(o.t - s.t) < 0.02 &&
      o.x > s.x
    )
      return o;
  return null;
}

/**
 * Вал вьюги: волна от бубна докатилась — снег наметает гребнем, позёмка
 * срывается с гребня; проём светится с первого кадра.
 */
registerZonePainter('f12_snowwall', (g, st, px, py, _s, time) => {
  const s = st as Strike;
  pin(g, px - s.x * TS, py - s.y * TS);
  const k = k01(s.t / Math.max(0.05, s.warn));
  const left = s.warn - s.t;
  const L = s.r * TS;
  const hw = (s.w ?? 1) * TS;
  const ang = s.ang ?? 0;
  const sd = s.id >>> 0;
  markLane(g, px, py, ang, L, hw, k, left, time, sd, 0.85);
  const sim = paintSim();
  // Проём: светлая дорожка между отрезками — видно, куда уходить.
  const pa = sim ? wallPartner(sim, s) : null;
  if (pa) {
    const gx0 = px + L;
    const gx1 = px + (pa.x - s.x) * TS;
    const pulse = reduced() ? 0.7 : 0.55 + 0.45 * Math.sin(time * 6);
    if (ink(g, C.teal, 0.1 + 0.08 * pulse))
      pp(g, gx0 + 2, py - hw * 1.6, Math.max(1, Math.round(gx1 - gx0 - 4)), Math.round(hw * 3.2));
    for (const gx of [gx0, gx1])
      if (ink(g, C.tealL, 0.55 + 0.4 * pulse))
        linePx(g, gx, py - hw * 1.7, gx, py + hw * 1.7, 4, -time * 12, 2);
    // Стрелки сквозь проём — в обе стороны.
    const mx = (gx0 + gx1) / 2;
    const off = mod(time * 18, 10);
    if (ink(g, C.tealL, 0.5 * pulse))
      for (const sgn of [-1, 1])
        for (let q = 0; q < 2; q++) {
          const yy = py + sgn * (hw * 0.4 + q * 10 + off * 0.4);
          linePx(g, mx - 3, yy - sgn * 3, mx, yy);
          linePx(g, mx + 3, yy - sgn * 3, mx, yy);
        }
  }
  // Сугроб растёт, когда волна бубна докатилась (~0,3 с).
  const grow = eOut(k01((s.t - 0.22) / Math.max(0.1, s.warn - 0.22)));
  if (grow > 0) {
    g.globalAlpha = 1;
    driftAt(g, driftSeed(s.x, s.y), L, px, py, grow);
    // Позёмка: снег срывается с гребня по ветру.
    const n = Math.round(L / 12);
    for (let i = 0; i < n; i++) {
      const ph = mod(time * (1.4 + hash(sd, i, 3)) + hash(sd, i, 2), 1);
      const x = px + ((i + hash(sd, i, 4)) / n) * L + ph * 14;
      const y = py + 3 - 12 * grow - ph * 5;
      if (x < px + L && ink(g, ph < 0.5 ? C.white : C.snow, 0.8 * grow * (1 - ph)))
        pp(g, x, y, ph < 0.3 ? 2 : 1, 1);
    }
  } else if (s.t > 0.05) {
    // Ещё до волны: снег закручивается по линии.
    spray(
      g,
      px + L / 2,
      py,
      s.t,
      {
        n: 8,
        seed: sd,
        v: [L * 0.3, L * 0.5],
        spread: 0.3,
        ang: 0,
        drag: 2,
        life: [0.3, 0.5],
        size: [1, 2],
        cols: [C.snow, C.white],
      },
      0.6,
    );
  }
  return true;
});

registerImpactPainter('f12_snowwall', {
  life: 1.1,
  shake: 0.22,
  paint(g, rec, px, py, _s, age) {
    pin(g, px - rec.x * TS, py - rec.y * TS);
    const L = (rec.r ?? 4) * TS;
    const sd = rec.seed >>> 0;
    const hw = (rec.w ?? 1) * TS;
    // Вал рушится: снег выстреливает столбиками с рваным верхом, по полу —
    // белая полоса удара; потом низкий сугроб тает.
    if (age < 0.24) {
      const q = age / 0.24;
      const up = eOut(Math.min(1, q * 2.2));
      const fadeW = 1 - eIn(q);
      if (ink(g, C.snowM, 0.6 * fadeW))
        for (let x = 0; x < L; x += 3) {
          const h = (6 + 12 * hash(sd, x, 21)) * up;
          pp(g, px + x + 1, py - h + 1, 3, h);
        }
      if (ink(g, C.white, 0.85 * fadeW))
        for (let x = 0; x < L; x += 3) {
          const h = (6 + 12 * hash(sd, x, 21)) * up;
          pp(g, px + x, py - h, 3, Math.max(1, h - 2));
        }
      if (ink(g, C.white, 0.7 * (1 - q))) pp(g, px - 2, py + hw * 0.5 * (1 - q), L + 4, 2);
    }
    // Вал оседает: уходит в пол и тает.
    const sink = 1 - eOut(age / 0.9);
    if (sink > 0.02) {
      g.globalAlpha = 1 - eIn(age / 1.1);
      driftAt(g, driftSeed(rec.x, rec.y), L, px, py, sink * 0.8);
    }
    const step = 14;
    const n = Math.max(2, Math.round(L / step));
    for (let i = 0; i < n; i++) {
      const x = px + (i + 0.5) * (L / n);
      spray(g, x, py - 4, age, {
        n: reduced() ? 2 : 4,
        seed: sd + i * 17,
        v: [16, 44],
        up: [40, 90],
        grav: 200,
        drag: 2,
        life: [0.45, 0.9],
        size: [2, 4],
        cols: [C.white, C.snow, C.snowM],
      });
    }
    // Клубы снега катятся в обе стороны.
    spray(
      g,
      px + L / 2,
      py - 2,
      age,
      {
        n: reduced() ? 6 : 12,
        seed: sd + 3,
        v: [20, 50],
        r0: L * 0.45,
        drag: 2.5,
        rise: 6,
        life: [0.6, 1.05],
        size: [3, 4],
        cols: [C.snow, C.snowM],
        squash: 0.25,
      },
      0.55,
    );
    g.globalAlpha = 1;
    return age < 1.1;
  },
});

// ---- Шипы ---------------------------------------------------------------

const SPIKE_H = 22;

/** Ледяной шип: левая грань в свету, правая в тени, блик по ребру. */
function spikeCv(v: number): HTMLCanvasElement {
  return sprite(`sp|${v}`, () => {
    const H = 13 + (v % 5) * 2;
    const W = 5 + (v % 3);
    const p = new Px(W + 2, SPIKE_H);
    const cols = [C.white, C.frost, C.iceL, C.ice, C.iceM, C.iceD, C.iceDD].map((c) => rgbaOf(c));
    const lean = ((v % 4) - 1.5) * 0.6;
    for (let y = SPIKE_H - H; y < SPIKE_H; y++) {
      const q = (y - (SPIKE_H - H)) / H;
      const half = (W / 2) * q + 0.3;
      const mid = (W + 1) / 2 + lean * (1 - q);
      for (let x = 0; x < W + 2; x++) {
        const d = x - mid;
        if (Math.abs(d) > half) continue;
        const f = (d + half) / (2 * half + 0.001);
        let i = f < 0.3 ? 2 : f < 0.5 ? 3 : f < 0.75 ? 4 : 5;
        if (y >= SPIKE_H - 2) i = Math.min(6, i + 1);
        p.set(x, y, cols[i]);
      }
      // Ребро: свет на левой стороне от гребня.
      if (q > 0.08 && q < 0.85) p.set(Math.round(mid - 0.4), y, cols[q < 0.35 ? 0 : 1]);
    }
    p.outline(OUTLINE);
    return p;
  });
}

/** Номер линии в веере (0…2) — одно зерно трещины до и после удара хобота. */
function spikeLane(sim: Sim, s: Strike): number {
  const sib = sim.strikes.filter(
    (o) => o.art === 'f12_spikes' && o.from === s.from && Math.abs(o.t - s.t) < 0.02,
  );
  if (sib.length < 2) return 1;
  const a0 = sib[0].ang ?? 0;
  const rel = (o: Strike) => mod((o.ang ?? 0) - a0 + Math.PI, TAU) - Math.PI;
  const mean = sib.reduce((a, o) => a + rel(o), 0) / sib.length;
  const mine = rel(s) - mean;
  return mine < -0.19 ? 0 : mine > 0.19 ? 2 : 1;
}

/**
 * Шипы мамонта до удара: трещина бежит фронтом, под ней светится и
 * вспучивается лёд — острия проклёвываются там, где встанут.
 */
registerZonePainter('f12_spikes', (g, st, px, py, _s, time) => {
  const s = st as Strike;
  pin(g, px - s.x * TS, py - s.y * TS);
  const T = MAMMOTH.spikes;
  const total = T.hit + s.warn;
  const k = k01((T.hit + s.t) / total);
  const left = s.warn - s.t;
  const L = s.r * TS;
  const hw = (s.w ?? 0.9) * TS;
  const ang = s.ang ?? 0;
  const sim = paintSim();
  const lane = sim ? spikeLane(sim, s) : 1;
  const sd = ((s.from ?? 0) >>> 0) % 997;
  markLane(g, px, py, ang, L, hw, k, left, time, sd + 11 + lane, 0.8);
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  const f = L * eOut(k01(s.t / s.warn) * 1.2);
  // Фронт: свет из-подо льда.
  glowC(g, px + ux * f, py + uy * f, 10, P.teal, 0.55 * (0.4 + 0.6 * k), 0.6);
  // Острия проклёвываются за фронтом.
  const sid = s.id >>> 0;
  const n = Math.max(3, Math.round(L / 7));
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) * (L / n);
    if (u > f) break;
    const side = (hash(sid, i, 2) - 0.5) * hw;
    const x = px + ux * u - uy * side;
    const y = py + uy * u + ux * side;
    const peek = Math.min(4, 1 + Math.floor(4 * k01((f - u) / 40) * k));
    if (ink(g, C.iceD, 0.9)) pp(g, x - 1, y, 3, 1);
    if (ink(g, C.frost, 0.9)) pp(g, x, y - peek, 1, peek);
    if (ink(g, C.white, 0.8)) pp(g, x, y - peek, 1, 1);
  }
  return true;
});

registerImpactPainter('f12_spikes', {
  life: 1.55,
  shake: 0.25,
  flash: 0.1,
  flashRgb: '190,235,255',
  paint(g, rec, px, py, _s, age) {
    pin(g, px - rec.x * TS, py - rec.y * TS);
    const L = (rec.r ?? 6) * TS;
    const ang = rec.ang ?? 0;
    const sd = rec.seed >>> 0;
    const ux = Math.cos(ang);
    const uy = Math.sin(ang);
    const hw = (rec.w ?? 0.9) * TS;
    const n = Math.max(3, Math.round(L / 6));
    const fade = 1 - k01((age - 1.1) / 0.45);
    // Шов во льду, откуда вышли шипы.
    if (ink(g, C.shade, 0.5 * fade)) fLane(g, px, py, ang, 0, L, -2, 2);
    crack(g, px, py, crackOf(sd, ang, L, 0.3), 1, C.frost, C.shade, 0.8 * fade);
    // Шипы встают волной от мамонта; дальние (северные) рисуем первыми.
    const order: number[] = [];
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) * (L / n);
      const side = (hash(sd, i, 2) - 0.5) * hw * 1.2;
      xs.push(px + ux * u - uy * side);
      ys.push(py + uy * u + ux * side * 0.7);
      order.push(i);
    }
    order.sort((a, b) => ys[a] - ys[b]);
    for (const i of order) {
      const u = (i + 0.5) * (L / n);
      const t0 = (u / L) * 0.14;
      const t = age - t0;
      if (t < 0) continue;
      const x = xs[i];
      const y = ys[i];
      const v = Math.floor(hash(sd, i, 3) * 15);
      const cv = spikeCv(v);
      const W = cv.width;
      const tb = 0.6 + hash(sd, i, 4) * 0.25;
      if (t < tb) {
        // Встаёт с перехлёстом и дрожит.
        const up = eOut(t / 0.06);
        const wob =
          t > 0.06 ? 1 + 0.12 * Math.exp(-(t - 0.06) * 18) * Math.cos((t - 0.06) * 60) : up;
        const hv = Math.max(1, Math.min(SPIKE_H, Math.round(SPIKE_H * wob)));
        g.globalAlpha = 1;
        g.drawImage(cv, 0, 0, W, hv, WX(x - W / 2) + QX, WY(y - hv) + QY, W, hv);
        // Блик бежит снизу вверх по ребру.
        const gl = (t - 0.1) / 0.18;
        if (gl > 0 && gl < 1 && ink(g, C.white, 1 - gl)) pp(g, x - 1, y - 2 - gl * (hv - 4), 1, 2);
        if (t < 0.12)
          spray(g, x, y, t, {
            n: 3,
            seed: sd + i * 7,
            v: [10, 30],
            up: [30, 60],
            grav: 300,
            life: [0.2, 0.35],
            size: [1, 2],
            cols: [C.white, C.frost],
          });
      } else {
        // Ломается: верх отлетает, пенёк тает в лужу.
        const tm = t - tb;
        const hs = Math.max(0, Math.round(SPIKE_H * 0.42 * (1 - eIn(tm / 0.55))));
        if (hs > 0) {
          g.globalAlpha = 1;
          g.drawImage(cv, 0, SPIKE_H - hs, W, hs, WX(x - W / 2) + QX, WY(y - hs) + QY, W, hs);
          if (ink(g, C.white, 0.9)) pp(g, x - 1, y - hs, 3, 1);
        }
        shards(g, x, y, tm, {
          n: 2,
          seed: sd + i * 13,
          ang: ang + (hash(sd, i, 5) - 0.5) * 2,
          spread: 1.2,
          v: [25, 55],
          up: [20, 50],
          z0: 12,
          grav: 420,
          len: [3, 5],
          spin: 14,
          slide: 2.6,
          life: [0.55, 0.85],
          cols: [C.iceL, C.ice],
        });
        if (tm < 0.4)
          shards(g, x, y - 6, tm, {
            n: 3,
            seed: sd + i * 19,
            v: [12, 40],
            up: [20, 60],
            grav: 400,
            len: [1, 2],
            life: [0.3, 0.5],
            cols: [C.white, C.frost, C.iceM],
          });
        // Лужица талой воды.
        const pa = k01(tm / 0.4) * (1 - k01((age - 1.15) / 0.4));
        if (ink(g, C.iceDD, 0.55 * pa)) fEll(g, x, y, 3 + W / 2, 2);
        if (ink(g, C.iceL, 0.6 * pa)) pp(g, x - 2, y - 1, 2, 1);
      }
    }
    g.globalAlpha = 1;
    return age < 1.55;
  },
});

// ---- Занавес сияния -----------------------------------------------------

const AUR_HUES = [C.aur, C.aurL, C.teal, C.vio, C.aurL, C.tealM];

/** Столбик ленты: снизу яркий, вверх ступенями гаснет (пиксельные полосы). */
function ribbonCv(hue: number, h: number): HTMLCanvasElement {
  return sprite(`rb|${hue}|${h}`, () => {
    const p = new Px(2, h);
    const c = rgbaOf(AUR_HUES[hue]);
    const w = rgbaOf(C.aurW);
    for (let y = 0; y < h; y++) {
      const q = 1 - y / h;
      const a = q > 0.95 ? 0 : Math.max(1, Math.min(4, Math.floor((1 - q) ** 1.3 * 5))) / 4;
      if (a <= 0) continue;
      const col = y > h - 3 ? w : c;
      p.set(0, y, [col[0], col[1], col[2], Math.round(255 * a)]);
      p.set(1, y, [col[0], col[1], col[2], Math.round(200 * a)]);
    }
    return p;
  });
}

/**
 * Лента сияния вдоль линии: столбики колышутся, цвет переливается вдоль
 * ленты и во времени, `dens` — насколько сгустилась.
 */
function ribbons(
  g: G,
  X: number,
  Y: number,
  ang: number,
  L: number,
  dens: number,
  Hk: number,
  time: number,
  sd: number,
  bright = 0,
): void {
  if (dens <= 0.01) return;
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  const op = g.globalCompositeOperation;
  g.globalCompositeOperation = 'lighter';
  const flat = Math.abs(uy) > 0.85 ? 3 : 2;
  for (let u = 0; u < L; u += flat) {
    const w1 = Math.sin(time * 2.6 + u * 0.07 + sd);
    const w2 = Math.sin(time * 4.1 - u * 0.13 + sd * 0.5);
    const hgt = Math.round((16 + 18 * Hk) * (0.62 + 0.24 * w1 + 0.14 * w2));
    if (hgt < 3) continue;
    const hq = Math.min(64, Math.max(4, hgt - (hgt % 2)));
    const hue =
      Math.floor(mod(u * 0.025 + time * 0.5 + sd * 0.1, 1) * AUR_HUES.length) % AUR_HUES.length;
    const sway = Math.round(Math.sin(time * 1.7 + u * 0.05) * 2);
    const x = X + ux * u;
    const y = Y + uy * u;
    g.globalAlpha = Math.min(1, dens * (0.55 + 0.45 * (0.5 + 0.5 * w1)) + bright);
    blitPx(g, ribbonCv(hue, hq), x + sway, y - hq + 1);
  }
  g.globalCompositeOperation = op;
  g.globalAlpha = 1;
}

/**
 * Занавес (шаманка — над темнотой, хранитель — на полу): лента
 * разгорается и колышется, к удару сгущается, кромка замыкается.
 */
registerZonePainter('f12_curtain', (g, st, px, py, _s, time) => {
  const s = st as Strike;
  pin(g, px - s.x * TS, py - s.y * TS);
  const k = k01(s.t / Math.max(0.05, s.warn));
  const left = s.warn - s.t;
  const sig = sigOf(left);
  const L = s.r * TS;
  const ang = s.ang ?? 0;
  const hw = (s.w ?? 0.8) * TS;
  const sd = (s.id >>> 0) % 97;
  if (!s.above) markLine(g, px, py, ang, L, hw, k, time, 0.7);
  else {
    // Полоса сияния на снегу: края замыкаются к концу.
    const ux = Math.cos(ang);
    const uy = Math.sin(ang);
    if (ink(g, C.aurD, 0.12 + 0.14 * k)) fLane(g, px, py, ang, 0, L, -hw, hw);
    const uf = L * k;
    for (const sg of [-1, 1]) {
      const ex = -uy * hw * sg;
      const ey = ux * hw * sg;
      if (ink(g, C.aur, 0.45))
        linePx(g, px + ex, py + ey, px + ux * L + ex, py + uy * L + ey, 6, time * 14, 3);
      if (ink(g, sig > 0 ? C.white : C.aurL, 0.95))
        linePx(g, px + ex, py + ey, px + ux * uf + ex, py + uy * uf + ey);
      if (sig <= 0) sparkPx(g, px + ux * uf + ex, py + uy * uf + ey, 0.9);
    }
    if (sig > 0 && ink(g, C.aurW, (reduced() ? 0.1 : 0.18) * sig))
      fLane(g, px, py, ang, 0, L, -hw, hw);
  }
  ribbons(g, px, py, ang, L, 0.3 + 0.55 * k, k, time, sd, sig * 0.3);
  // Искры поднимаются от основания ленты.
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  for (let i = 0; i < 10; i++) {
    const ph = mod(time * (0.7 + hash(sd, i, 1) * 0.6) + hash(sd, i, 2), 1);
    const u = hash(sd, i, 3) * L;
    if (ink(g, i % 3 ? C.aurL : C.white, (0.3 + 0.6 * k) * (1 - ph)))
      pp(g, px + ux * u + Math.sin(ph * 7 + i) * 2, py + uy * u - ph * (20 + 20 * k));
  }
  return true;
});

registerImpactPainter('f12_curtain', {
  life: 0.95,
  shake: 0.1,
  flash: 0.08,
  flashRgb: '150,255,210',
  above: true,
  paint(g, rec, px, py, _s, age, time) {
    pin(g, px - rec.x * TS, py - rec.y * TS);
    const L = (rec.r ?? 4) * TS;
    const ang = rec.ang ?? 0;
    const sd = rec.seed >>> 0;
    const ux = Math.cos(ang);
    const uy = Math.sin(ang);
    const hw = (rec.w ?? 1) * TS;
    // Вспышка бежит вдоль ленты за 0,12 с.
    const run = L * eOut(age / 0.12);
    const fade = 1 - eIn(age / 0.95);
    if (age < 0.3) {
      const q = 1 - age / 0.3;
      if (ink(g, C.aurW, 0.8 * q))
        fLane(g, px, py, ang, Math.max(0, run - 40), run, -hw * 0.5, hw * 0.5);
      if (ink(g, C.white, q)) fLane(g, px, py, ang, Math.max(0, run - 8), run, -hw * 0.7, hw * 0.7);
      glowC(g, px + ux * run, py + uy * run - 8, 22, P.aurL, 0.6 * q, 0.8);
    }
    // Ленты взмывают и рассыпаются искрами.
    ribbons(
      g,
      px,
      py,
      ang,
      Math.min(L, run),
      0.9 * fade,
      1 + 0.8 * eOut(age / 0.25),
      time,
      sd % 97,
      0.35 * (1 - k01(age / 0.25)),
    );
    for (let i = 0; i < 4; i++) {
      const u = L * ((i + 0.5) / 4);
      spray(g, px + ux * u, py + uy * u - 6, age, {
        n: reduced() ? 4 : 8,
        seed: sd + i * 3,
        v: [4, 18],
        rise: 34,
        drag: 1.5,
        life: [0.5, 0.9],
        cols: [C.aurL, C.white, C.teal, C.aur],
      });
    }
    // Иней по шву на полу.
    crack(g, px, py, crackOf(sd, ang, L, 0.3), 1, C.frost, null, 0.5 * fade);
    return age < 0.95;
  },
});

/** Убийство окружением: без метки и без общего взрыва. */
registerZonePainter('f12_none', () => true);
registerImpactPainter('f12_none', { life: 0.01, shake: 0, paint: () => false });

// ---------------------------------------------------------------------------
// Игла ежа.
// ---------------------------------------------------------------------------

const QUILL = new Map<number, Sprite>();
registerShotPainter('f12_quill', (s) => {
  const a = Math.atan2(s.vy, s.vx);
  const q = ((Math.round((a / TAU) * 16) % 16) + 16) % 16;
  const hit = QUILL.get(q);
  if (hit) return hit;
  const p = new Px(13, 13);
  const dx = Math.cos((q * TAU) / 16);
  const dy = Math.sin((q * TAU) / 16);
  for (let k = -5; k <= 4; k++) {
    const col: [number, number, number, number] =
      k >= 3
        ? [255, 255, 255, 255]
        : k >= 0
          ? [160, 208, 238, 255]
          : k >= -3
            ? [92, 156, 203, 230]
            : [54, 114, 166, 150];
    p.set(6 + dx * k, 6 + dy * k, col);
  }
  p.outline([10, 24, 48, 200]);
  const spr: Sprite = { img: p.canvas(), ax: 6, ay: 6 };
  QUILL.set(q, spr);
  return spr;
});

registerImpactPainter('f12_quill', {
  life: 0.4,
  shake: 0.02,
  paint(g, rec, px, py, _s, age) {
    const sd = rec.seed >>> 0;
    const back = Math.atan2(-(rec.vy ?? 0), -(rec.vx ?? 1));
    burst(g, px, py, age, {
      n: 6,
      seed: sd,
      ang: back,
      spread: 2.2,
      v: [20, 50],
      up: [10, 30],
      grav: 200,
      life: [0.2, 0.4],
      cols: [P.white, P.ice],
    });
    return age < 0.4;
  },
});

// ---------------------------------------------------------------------------
// Зоны-картинки (`api.vfx`): t — возраст, life — длина.
// ---------------------------------------------------------------------------

type ZoneFx = (g: G, z: Zone, X: number, Y: number, k: number, age: number, time: number) => void;
function zoneFx(art: string, f: ZoneFx): void {
  registerZonePainter(art, (g, z, px, py, _s, time) => {
    const zz = z as Zone;
    const life = Math.max(0.05, zz.life);
    if (zz.t > life) return true;
    f(g, zz, px, py, k01(zz.t / life), zz.t, time);
    return true;
  });
}

/** Жаровня или факел вспыхнули: тёплый круг и искры вверх. */
zoneFx('f12_ignite', (g, z, X, Y, k, age) => {
  const R = z.r * TS;
  glow(g, X, Y - 4, R * (0.6 + 0.6 * eOut(k)), P.fire, 0.55 * (1 - k), 0.7, true);
  ringTicks(g, X, Y, R * eOut(k / 0.6), P.fireL, 0.8 * (1 - k), 3, seedOf(z), 0.7, 0.7);
  burst(g, X, Y - 6, age, {
    n: 16,
    seed: seedOf(z),
    v: [6, 24],
    rise: 34,
    drag: 2,
    life: [0.4, 0.85],
    cols: [P.fireW, P.fireL, P.fire],
  });
});

/** Огонь задули: дым клубами вверх. */
zoneFx('f12_smoke', (g, z, X, Y, _k, age) => {
  burst(
    g,
    X,
    Y - 8,
    age,
    {
      n: 12,
      seed: seedOf(z),
      v: [3, 12],
      rise: 20,
      drag: 1.5,
      life: [0.6, 1.2],
      size: [2, 4],
      cols: [P.smokeL, P.smoke, P.snowS],
      delay: 0.3,
    },
    0.7,
  );
});

/** Всплеск: брызги, кольцо ряби, пена. */
zoneFx('f12_splash', (g, z, X, Y, k, age) => {
  const R = z.r * TS;
  const sd = seedOf(z);
  ringTicks(g, X, Y, R * (0.3 + 0.8 * eOut(k)), P.foam, 0.8 * (1 - k), 2, sd, 0.85, 0.7);
  ringTicks(g, X, Y, R * 0.6 * eOut(k * 1.4), P.waterL, 0.6 * (1 - k), 3, sd + 1, 0.85, 0.7);
  burst(g, X, Y, age, {
    n: 18,
    seed: sd,
    v: [10, 36],
    up: [50, 110],
    grav: 300,
    life: [0.5, 0.8],
    size: [1, 2],
    cols: [P.foam, P.waterL, P.white],
  });
});

/** Лёд разбит: осколки веером, иней кольцом. */
zoneFx('f12_shatter', (g, z, X, Y, k, age) => {
  const R = z.r * TS;
  const sd = seedOf(z);
  if (age < 0.15) glow(g, X, Y - 8, R, P.white, 0.7 * (1 - age / 0.15), 1, true);
  ringTicks(g, X, Y, R * eOut(k * 1.6), P.frost, 0.7 * (1 - k), 2, sd, 0.6, 0.7);
  burst(g, X, Y - 8, age, {
    n: 22,
    seed: sd,
    v: [30, 90],
    up: [20, 80],
    grav: 280,
    life: [0.35, z.life],
    size: [1, 3],
    cols: [P.white, P.ice, P.frost, P.iceD],
  });
});

/** Герой замёрз: иглы инея сходятся к нему (глыбу рисует слой неба). */
zoneFx('f12_iceblock', (g, z, X, Y, _k, age) => {
  if (age > 0.35) return;
  const q = age / 0.35;
  const sd = seedOf(z);
  for (let i = 0; i < 10; i++) {
    const a = hash(sd, i, 1) * TAU;
    const r = (26 + 10 * hash(sd, i, 2)) * (1 - eOut(q));
    const x = X + Math.cos(a) * r;
    const y = Y - 10 + Math.sin(a) * r * 0.8;
    dot(g, x, y, 2, 1, P.white, 1 - q * 0.6);
    dot(g, x - Math.cos(a) * 3, y - Math.sin(a) * 2, 1, 1, P.ice, 0.7 * (1 - q));
  }
});

/** Пар из проталины или источника. */
zoneFx('f12_steampuff', (g, z, X, Y, _k, age) => {
  burst(
    g,
    X,
    Y - 4,
    age,
    {
      n: 9,
      seed: seedOf(z),
      v: [2, 8],
      rise: 18,
      life: [0.6, 1.2],
      size: [2, 4],
      cols: [P.white, P.frost, P.snow],
      delay: 0.4,
    },
    0.55,
  );
});

/** Гонг: золотые кольца бегут по залу, звери слепнут. Над темнотой. */
zoneFx('f12_gongwave', (g, z, X, Y, k, age) => {
  const R = z.r * TS;
  if (age < 0.2) glow(g, X, Y - 10, 40, P.gold, 0.8 * (1 - age / 0.2), 1, true);
  for (let i = 0; i < 3; i++) {
    const q = k01((age - i * 0.18) / 1.0);
    if (q <= 0 || q >= 1) continue;
    ringTicks(
      g,
      X,
      Y,
      R * eOut(q),
      i ? P.gold : P.white,
      0.75 * (1 - q),
      2,
      seedOf(z) + i,
      0.9,
      0.75,
    );
  }
});

/** Удар по ледяному затвору: искры льда и стружка. */
zoneFx('f12_gatehit', (g, z, X, Y, _k, age) => {
  if (age < 0.08) glow(g, X, Y - 6, 12, P.white, 0.8, 1, true);
  burst(g, X, Y - 8, age, {
    n: 12,
    seed: seedOf(z),
    v: [30, 70],
    up: [20, 60],
    grav: 260,
    life: [0.3, 0.6],
    cols: [P.white, P.ice, P.frost],
  });
});

/** Снежный клуб: песец нырнул или вынырнул, удар в сугроб. */
zoneFx('f12_snowburst', (g, z, X, Y, _k, age) => {
  const sd = seedOf(z);
  burst(g, X, Y - 2, age, {
    n: 18,
    seed: sd,
    v: [14, 40],
    up: [30, 70],
    grav: 200,
    drag: 2,
    life: [0.35, z.life],
    size: [2, 3],
    cols: [P.white, P.snow, P.snowS],
  });
});

/** Дыхание духа: струя инея по конусу (dur — угол). */
zoneFx('f12_breath', (g, z, X, Y, k, age) => {
  const ang = z.dur ?? 0;
  const R = z.r * TS;
  const h = SPIRIT.arc / 2;
  const sd = seedOf(z);
  g.fillStyle = rgba(P.frost, 0.22 * (1 - k));
  g.beginPath();
  g.moveTo(X, Y);
  g.arc(X, Y, R * eOut(k * 2), ang - h, ang + h);
  g.closePath();
  g.fill();
  for (let i = 0; i < 26; i++) {
    const a = ang + (hash(sd, i, 1) - 0.5) * 2 * h;
    const r = R * k01(age * (2.2 + hash(sd, i, 2)) - hash(sd, i, 3) * 0.3);
    if (r <= 0) continue;
    dot(
      g,
      X + Math.cos(a) * r,
      Y + Math.sin(a) * r - 6,
      i % 3 ? 1 : 2,
      1,
      i % 2 ? P.white : P.teal,
      0.85 * (1 - k),
    );
  }
});

// ---------------------------------------------------------------------------
// Контакты прямых ударов мамонта (анимации 12): зоны `api.vfx` в строке
// урона мозга. Пиксели на сетке мира, всё — от возраста и зерна зоны.
// ---------------------------------------------------------------------------

/** Привязка зоны к сетке мира. */
const pinZ = (g: G, z: { x: number; y: number }, X: number, Y: number) =>
  pin(g, X - z.x * TS, Y - z.y * TS);

/**
 * Топот (мамонт, дыбы, голем): лёд проседает — тёмная чаша и трещины за
 * 0,08 с, кольцо удара, плиты льда встают ребром по кромке, снег подлетает.
 */
zoneFx('f12_stompring', (g, z, X, Y, k, age) => {
  pinZ(g, z, X, Y);
  const R = z.r * TS;
  const sd = seedOf(z);
  const fade = 1 - eIn(k);
  // Проседание: тёмная чаша, к концу выравнивается.
  const sink = (1 - eOut(k01(age / 0.5))) * 0.5 + 0.15;
  if (ink(g, C.shade, sink * fade)) fEll(g, X, Y, R * 0.55, R * 0.4);
  if (ink(g, C.ink, sink * 0.6 * fade)) fEll(g, X, Y, R * 0.3, R * 0.2);
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * TAU + hash(sd, i, 1) * 0.5;
    const len = R * (0.75 + 0.35 * hash(sd, i, 2));
    crack(g, X, Y, crackOf(sd + i, a, len, 0.55), eOut(age / 0.08), C.frost, C.shade, 0.8 * fade);
  }
  // Удар: белая звезда на кадр и кольцо волны.
  if (age < 0.06) glowC(g, X, Y - 2, R * 0.7, P.white, 0.5 * (1 - age / 0.06), 0.6);
  for (let i = 0; i < 2; i++) {
    const q = (age - i * 0.06) / 0.34;
    if (q <= 0 || q >= 1) continue;
    if (ink(g, i ? C.snow : C.white, (i ? 0.6 : 0.95) * (1 - q)))
      arcPx(g, X, Y, R * (0.25 + 0.85 * eOut(q)), 0, TAU, i ? 4 : 0, 0, 2);
  }
  // Плиты льда встают ребром по кромке и ложатся.
  const n = 10;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + hash(sd, i, 3) * 0.4;
    const t = age - 0.02 - hash(sd, i, 4) * 0.05;
    if (t < 0 || t > 0.55) continue;
    const up = Math.sin(Math.PI * k01(t / 0.55));
    const r = R * (0.62 + 0.18 * hash(sd, i, 5));
    const x = X + Math.cos(a) * r;
    const y = Y + Math.sin(a) * r * 0.8;
    const w = 3 + Math.floor(hash(sd, i, 6) * 3);
    const h = Math.max(1, Math.round(5 * up));
    if (ink(g, C.iceD, 0.95)) pp(g, x - w / 2, y - h, w, h + 1);
    if (ink(g, C.ice, 0.95)) pp(g, x - w / 2, y - h, Math.ceil(w / 2), h);
    if (ink(g, C.white, 0.9)) pp(g, x - w / 2, y - h, w, 1);
  }
  shards(g, X, Y, age, {
    n: reduced() ? 6 : 12,
    seed: sd + 9,
    v: [R * 0.9, R * 2],
    r0: R * 0.5,
    up: [40, 110],
    grav: 420,
    len: [1, 3],
    spin: 18,
    slide: 3,
    life: [0.5, z.life],
    cols: [C.white, C.frost, C.iceL, C.iceM],
  });
  // Снег подлетает кольцом и оседает.
  spray(
    g,
    X,
    Y,
    age,
    {
      n: reduced() ? 12 : 26,
      seed: sd + 5,
      v: [R * 1.1, R * 2.2],
      r0: R * 0.35,
      up: [20, 55],
      grav: 120,
      drag: 3,
      life: [0.45, z.life],
      size: [2, 4],
      cols: [C.snow, C.white, C.snowM],
    },
    0.8,
  );
});

/** Бивни: серп следа снизу вверх по конусу, щепа льда и снег по ходу. */
zoneFx('f12_tuskhit', (g, z, X, Y, _k, age) => {
  pinZ(g, z, X, Y);
  const ang = z.dur ?? 0;
  const R = z.r * TS;
  const sd = seedOf(z);
  const h = MAMMOTH.tusk.arc / 2;
  // Серп: голова проходит по дуге за 0,08 с, хвост гаснет.
  const head = eOut(age / 0.08);
  const tail = k01((age - 0.04) / 0.22);
  const a0 = ang - h + 2 * h * tail;
  const a1 = ang - h + 2 * h * head;
  if (a1 > a0) {
    if (ink(g, C.frost, 0.55 * (1 - tail))) fSector(g, X, Y, R * 0.55, R * 0.92, a0, a1);
    if (ink(g, C.white, 0.95 * (1 - tail))) {
      arcPx(g, X, Y, R * 0.92, a0, a1);
      arcPx(g, X, Y, R * 0.9, a0, a1);
    }
    if (ink(g, C.teal, 0.6 * (1 - tail))) arcPx(g, X, Y, R * 0.55, a0, a1);
  }
  // Скол на кромке, где прошёл бивень.
  for (let i = -1; i <= 1; i++) {
    const a = ang + i * h * 0.6;
    const x = X + Math.cos(a) * R * 0.88;
    const y = Y + Math.sin(a) * R * 0.88;
    crack(
      g,
      x,
      y,
      crackOf(sd + i + 3, a, 10, 0.6),
      eOut(age / 0.1),
      C.frost,
      C.shade,
      0.7 * (1 - eIn(age / 0.5)),
    );
  }
  shards(g, X + Math.cos(ang) * R * 0.75, Y + Math.sin(ang) * R * 0.75, age, {
    n: reduced() ? 5 : 10,
    seed: sd,
    ang,
    spread: 2 * h,
    v: [40, 110],
    up: [50, 110],
    grav: 430,
    z0: 4,
    len: [1, 3],
    spin: 20,
    life: [0.35, 0.5],
    cols: [C.white, C.frost, C.iceL],
  });
  spray(
    g,
    X + Math.cos(ang) * R * 0.7,
    Y + Math.sin(ang) * R * 0.7,
    age,
    {
      n: reduced() ? 5 : 10,
      seed: sd + 3,
      ang,
      spread: 2 * h,
      v: [20, 50],
      drag: 3,
      up: [10, 30],
      grav: 80,
      life: [0.3, 0.5],
      size: [2, 3],
      cols: [C.snow, C.white],
    },
    0.7,
  );
});

/** Хобот бьёт в лёд перед шипами: кольцо и звезда трещин у бивней. */
zoneFx('f12_slam', (g, z, X, Y, _k, age) => {
  const sim = paintSim();
  const m = sim ? f12Mammoth(sim) : null;
  pinZ(g, z, X, Y);
  let x = X;
  let y = Y;
  if (m) {
    const [tx, ty] = mamPointPx(m, 'tusk');
    x = X + (m.x - z.x) * TS + tx;
    y = Y + (m.y - z.y) * TS + ty + 6;
  }
  const sd = seedOf(z);
  if (age < 0.06) glowC(g, x, y, 16, P.teal, 0.6 * (1 - age / 0.06), 0.6);
  for (let i = 0; i < 6; i++)
    crack(
      g,
      x,
      y,
      crackOf(sd + i, (i / 6) * TAU + 0.3, 12 + 6 * hash(sd, i, 1), 0.5),
      eOut(age / 0.07),
      C.tealL,
      C.shade,
      0.85 * (1 - eIn(age / 0.7)),
    );
  if (age < 0.25 && ink(g, C.white, 1 - age / 0.25))
    arcPx(g, x, y, 4 + 18 * eOut(age / 0.25), 0, TAU, 3, 0, 2);
  shards(g, x, y, age, {
    n: 8,
    seed: sd,
    v: [20, 60],
    up: [50, 100],
    grav: 420,
    len: [1, 2],
    life: [0.35, 0.55],
    cols: [C.white, C.frost, C.iceL],
  });
});

/**
 * Набег и рытьё: из-под ног летят назад комья снега и ледяная крошка
 * (dur — куда смотрит мамонт).
 */
zoneFx('f12_kick', (g, z, X, Y, _k, age) => {
  pinZ(g, z, X, Y);
  const back = (z.dur ?? 0) + Math.PI;
  const sd = seedOf(z);
  const R = z.r * TS;
  spray(g, X, Y, age, {
    n: reduced() ? 4 : 8,
    seed: sd,
    ang: back,
    spread: 1.3,
    r0: R * 1.4,
    v: [30, 80],
    up: [40, 90],
    grav: 300,
    drag: 1.5,
    life: [0.35, 0.6],
    size: [2, 4],
    cols: [C.snow, C.white, C.snowM],
  });
  shards(g, X, Y, age, {
    n: reduced() ? 2 : 4,
    seed: sd + 1,
    ang: back,
    spread: 1.6,
    r0: R * 0.6,
    v: [40, 100],
    up: [30, 80],
    grav: 420,
    len: [1, 2],
    life: [0.35, 0.6],
    cols: [C.frost, C.iceL, C.iceM],
  });
});

/** Набег сшиб героя: удар льда и снега в точке контакта. */
zoneFx('f12_ram', (g, z, X, Y, _k, age) => {
  pinZ(g, z, X, Y);
  const ang = z.dur ?? 0;
  const sd = seedOf(z);
  if (age < 0.08) {
    const q = 1 - age / 0.08;
    glowC(g, X, Y - 6, 18, P.white, 0.6 * q, 0.8);
    if (ink(g, C.white, q)) {
      pp(g, X - 7, Y - 6, 15, 1);
      pp(g, X, Y - 13, 1, 15);
    }
  }
  if (age < 0.3 && ink(g, C.frost, 1 - age / 0.3))
    arcPx(g, X, Y - 4, 5 + 16 * eOut(age / 0.3), ang - 1.2, ang + 1.2);
  shards(g, X, Y - 4, age, {
    n: 10,
    seed: sd,
    ang,
    spread: 2.2,
    v: [50, 120],
    up: [40, 100],
    grav: 420,
    len: [1, 3],
    life: [0.3, 0.5],
    cols: [C.white, C.frost, C.iceL],
  });
  spray(
    g,
    X,
    Y,
    age,
    {
      n: 10,
      seed: sd + 2,
      ang,
      spread: 2.4,
      v: [30, 70],
      drag: 3,
      life: [0.3, 0.5],
      size: [2, 3],
      cols: [C.snow, C.white],
    },
    0.8,
  );
});

/**
 * Юз после набега: две борозды тянутся за ногами ровно по ходу торможения
 * (скорость гаснет линейно за `skid`), снег веером из-под ног, борозды
 * гаснут (r — путь юза, клеток; dur — направление).
 */
zoneFx('f12_skid', (g, z, X, Y, _k, age) => {
  pinZ(g, z, X, Y);
  const ang = z.dur ?? 0;
  const D = z.r * TS;
  const S = MAMMOTH.charge.skid;
  const q = k01(age / S);
  const d = D * (1 - (1 - q) * (1 - q));
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  const sd = seedOf(z);
  const fade = 1 - k01((age - 1.1) / 1.1);
  const off = TS * 0.45;
  if (d >= 1)
    for (const sg of [-1, 1]) {
      const ox = -uy * off * sg;
      const oy = ux * off * sg;
      // Жёлоб: тёмная полоса в 3 точки, на дне — синий лёд.
      if (ink(g, C.shade, 0.6 * fade)) fLane(g, X + ox, Y + oy, ang, 0, d, -1.5, 1.5);
      if (ink(g, C.iceDD, 0.7 * fade)) fLane(g, X + ox, Y + oy, ang, 0, d, -0.5, 0.5);
      // Валы снега по обе стороны жёлоба — комьями.
      for (let u = 2; u < d; u += 3) {
        const i = Math.round(u);
        for (const side of [-1, 1]) {
          const h = hash(sd + (sg > 0 ? 7 : 0), i, side > 0 ? 1 : 2);
          if (h < 0.25) continue;
          const v = (2.5 + h * 1.5) * side;
          const x = X + ox + ux * u - uy * v;
          const y = Y + oy + uy * u + ux * v;
          if (ink(g, h > 0.7 ? C.white : C.snow, 0.9 * fade))
            clump(g, x - 1, y - 1, h > 0.6 ? 3 : 2);
        }
      }
    }
  // Из-под ног — веер снега вперёд и вбок, пока едет.
  if (age < S + 0.6) {
    const v0 = (2 * D) / S;
    for (let i = 0; i < 8; i++) {
      const te = i * (S / 8);
      if (te > age) break;
      const qe = te / S;
      const de = D * (1 - (1 - qe) * (1 - qe));
      const strength = 1 - qe;
      for (const sg of [-1, 1])
        spray(
          g,
          X + ux * de - uy * off * sg,
          Y + uy * de + ux * off * sg,
          age - te,
          {
            n: reduced() ? 3 : 6,
            seed: sd + i * 7 + (sg > 0 ? 1 : 0),
            ang: ang + sg * 1.0,
            spread: 0.9,
            v: [v0 * 0.3 * strength + 10, v0 * 0.6 * strength + 20],
            up: [40, 90],
            grav: 260,
            drag: 2,
            life: [0.4, 0.6],
            size: [2, 4],
            cols: [C.snow, C.white, C.snowM],
          },
          strength * 0.8 + 0.2,
        );
    }
  }
});

// ---- Удар в стену -------------------------------------------------------

/**
 * Мамонт врезался в стену: белая вспышка, ледяной взрыв (глыбы по физике,
 * щепа, снежное облако), звезда трещин, со свода падают сосульки. Два слоя
 * одного взрыва: на полу (`f12_wallhit` — трещины, легшие обломки, тени
 * сосулек) и над темнотой и телом (`f12_wallburst` — вспышка, летящее).
 * Зерно — от места удара: оба слоя рисуют одни и те же осколки.
 */
function wallFx(g: G, z: Zone, X: number, Y: number, k: number, age: number, air: boolean): void {
  pinZ(g, z, X, Y);
  const sim = paintSim();
  const m = sim ? f12Mammoth(sim) : null;
  const into = m ? m.face : -Math.PI / 2;
  const back = into + Math.PI;
  const R = z.r * TS;
  const sd = (Math.round(z.x * 16) * 7 + Math.round(z.y * 16) * 13) >>> 0;
  const fade = 1 - eIn(k);
  const part = air ? 'air' : 'ground';
  if (air && age < 0.1) {
    const q = 1 - age / 0.1;
    glowC(g, X, Y - 8, R * 1.1, P.white, 0.85 * q, 0.9);
    if (ink(g, C.white, q)) {
      pp(g, X - 12, Y - 8, 25, 1);
      pp(g, X, Y - 20, 1, 25);
      linePx(g, X - 8, Y - 16, X + 8, Y);
      linePx(g, X + 8, Y - 16, X - 8, Y);
    }
  }
  if (!air) {
    // Трещины звездой — больше по полу назад от стены.
    for (let i = 0; i < 12; i++) {
      const a = back + ((i - 5.5) / 5.5) * 1.7 + hash(sd, i, 1) * 0.2;
      const len = R * (0.6 + 0.6 * hash(sd, i, 2)) * (i % 3 ? 1 : 1.4);
      crack(g, X, Y, crackOf(sd + i, a, len, 0.6), eOut(age / 0.1), C.white, C.shade, 0.85 * fade);
    }
    if (age < 0.35 && ink(g, C.white, 0.9 * (1 - age / 0.35)))
      arcPx(g, X, Y, 6 + R * eOut(age / 0.35), back - 1.6, back + 1.6, 3, 0, 2);
  }
  // Глыбы льда — тяжёлые, крутятся, отскакивают, едут по льду.
  shards(g, X, Y - 4, age, {
    n: reduced() ? 4 : 7,
    seed: sd + 1,
    ang: back,
    spread: 2.6,
    v: [40, 100],
    up: [60, 140],
    grav: 420,
    z0: 14,
    len: [4, 7],
    spin: 12,
    slide: 2,
    life: [1.0, 1.2],
    cols: [C.iceL, C.ice, C.frost],
    part,
  });
  shards(g, X, Y - 4, age, {
    n: reduced() ? 10 : 22,
    seed: sd + 2,
    ang: back,
    spread: 3.2,
    v: [50, 150],
    up: [40, 160],
    grav: 460,
    z0: 10,
    len: [1, 2],
    spin: 24,
    slide: 3,
    life: [0.6, 1.0],
    cols: [C.white, C.frost, C.iceL, C.iceM, C.rockL],
    part,
  });
  // Снежное облако клубится и оседает.
  if (air)
    spray(
      g,
      X,
      Y - 6,
      age,
      {
        n: reduced() ? 10 : 22,
        seed: sd + 3,
        ang: back,
        spread: 3.4,
        v: [20, 60],
        drag: 2.6,
        rise: 8,
        life: [0.6, 1.15],
        size: [3, 5],
        cols: [C.snow, C.white, C.snowM],
      },
      0.7,
    );
  // Сосульки со свода: срываются от удара и бьются у стены.
  const nI = reduced() ? 3 : 5;
  for (let i = 0; i < nI; i++) {
    const t0 = 0.1 + hash(sd, i, 7) * 0.45;
    const t = age - t0;
    if (t < 0) continue;
    const side = (hash(sd, i, 8) - 0.5) * R * 2.2;
    const dist = 6 + hash(sd, i, 9) * R * 0.9;
    const fx = X + Math.cos(back) * dist - Math.sin(back) * side;
    const fy = Y + Math.sin(back) * dist + Math.cos(back) * side * 0.7;
    const TF = 0.34;
    if (t < TF) {
      const q = t / TF;
      const H = 150 * (1 - q * q);
      if (!air) {
        if (ink(g, C.shade, 0.25 + 0.4 * q)) fEll(g, fx, fy, 2 + 3 * q, 1 + 1.5 * q);
        continue;
      }
      const cv = icicleRot(i & 1, (hash(sd, i, 10) - 0.5) * 0.5 + q * q * (hash(sd, i, 11) - 0.5));
      if (ink(g, C.frost, 0.35 * q)) pp(g, fx - 1, fy - H - 30, 1, 18);
      g.globalAlpha = 1;
      blitPx(g, cv, fx - cv.width / 2, fy - H - cv.height + 4);
    } else {
      const tb = t - TF;
      if (!air)
        crack(
          g,
          fx,
          fy,
          crackOf(sd + 40 + i, hash(sd, i, 12) * TAU, 7, 0.7),
          eOut(tb / 0.06),
          C.frost,
          C.shade,
          0.7 * fade,
        );
      shards(g, fx, fy, tb, {
        n: 7,
        seed: sd + 50 + i,
        v: [20, 70],
        up: [30, 80],
        grav: 440,
        z0: 4,
        len: [1, 3],
        life: [0.4, 0.7],
        cols: [C.white, C.frost, C.iceL],
        part,
      });
    }
  }
}
zoneFx('f12_wallhit', (g, z, X, Y, k, age) => wallFx(g, z, X, Y, k, age, false));
zoneFx('f12_wallburst', (g, z, X, Y, k, age) => wallFx(g, z, X, Y, k, age, true));

// ---- Жаровня гаснет / морозный выдох -----------------------------------

/**
 * Морозный выдох. Духи (r < 1,7) — облачко инея и кристаллы. Мамонт задул
 * жаровню (r 1,8): пламя гнётся по ветру и гаснет, валит дым, по жаровне
 * ползёт иней, тлеющие угли тухнут.
 */
zoneFx('f12_frostburst', (g, z, X, Y, k, age, time) => {
  pinZ(g, z, X, Y);
  const R = z.r * TS;
  const sd = seedOf(z);
  if (z.r < 1.7) {
    glowC(g, X, Y - 4, R * (0.5 + 0.8 * eOut(k)), P.ice, 0.45 * (1 - k), 0.8);
    if (ink(g, C.frost, 0.7 * (1 - k))) arcPx(g, X, Y, R * eOut(k * 1.3), 0, TAU, 3, sd, 2);
    shards(g, X, Y - 4, age, {
      n: 14,
      seed: sd,
      v: [20, 50],
      up: [20, 50],
      grav: 160,
      len: [1, 2],
      spin: 20,
      life: [0.35, z.life],
      cols: [C.white, C.frost, C.teal],
    });
    spray(
      g,
      X,
      Y - 4,
      age,
      {
        n: 8,
        seed: sd + 1,
        v: [10, 26],
        drag: 3,
        rise: 6,
        life: [0.3, z.life],
        size: [2, 3],
        cols: [C.frost, C.white],
      },
      0.6,
    );
    return;
  }
  const sim = paintSim();
  const m = sim ? f12Mammoth(sim) : null;
  const wind = m ? Math.atan2(z.y - m.y, z.x - m.x) : 0;
  const wx = Math.cos(wind);
  const wy = Math.sin(wind);
  const FY = Y - 9;
  // Пламя: гнётся по ветру, сжимается, гаснет за 0,16 с.
  if (age < 0.16) {
    const q = age / 0.16;
    const hgt = 12 * (1 - q);
    for (let s = 0; s < hgt; s++) {
      const f = s / Math.max(1, hgt);
      const bend = (4 + 10 * q) * f * f;
      const w = Math.max(1, Math.round(4 * (1 - f)));
      const x = X + wx * bend - w / 2;
      const y = FY - s + wy * bend * 0.5;
      if (ink(g, f < 0.3 ? C.fireW : f < 0.6 ? C.fireL : C.fire, 1 - q * 0.5)) pp(g, x, y, w, 1);
    }
    glowC(g, X, FY - 4, 18 * (1 - q), P.fire, 0.4 * (1 - q), 0.8);
  }
  // Дым: столб, сносимый ветром, клубы растут и светлеют.
  for (let i = 0; i < 14; i++) {
    const t = age - 0.08 - i * 0.045;
    if (t < 0 || t > 0.85) continue;
    const q = t / 0.85;
    const sz = 2 + Math.round(q * 4);
    const x = X + wx * (8 + 22 * q) + Math.sin(t * 7 + i) * 2 * q;
    const y = FY - 4 - q * 26 + wy * 6 * q;
    if (ink(g, q < 0.4 ? C.smoke : C.smokeL, 0.7 * (1 - q))) clump(g, x - sz / 2, y - sz / 2, sz);
  }
  // Угли тухнут: искры гаснут на лету.
  spray(g, X, FY, age, {
    n: 8,
    seed: sd + 4,
    ang: wind,
    spread: 1.4,
    v: [20, 50],
    up: [20, 50],
    grav: 120,
    drag: 2,
    life: [0.15, 0.4],
    cols: [C.fireL, C.fire, C.ember],
  });
  // Иней ползёт по жаровне и вокруг.
  const fr = eOut(k01((age - 0.1) / 0.6)) * (1 - eIn(k01((age - 0.75) / 0.25)));
  frostGrid(g, X - R, Y - R, X + R, Y + R, 3, 1220, time, fr, (x, y, h) => {
    const d = Math.hypot(x - X, (y - Y) * 1.3);
    return d < R * eOut(k01((age - 0.1) / 0.5)) ? 0.4 + 0.6 * h : 0;
  });
  if (age > 0.15 && age < 0.6 && ink(g, C.frost, 0.9 * (1 - (age - 0.15) / 0.45)))
    arcPx(g, X, Y, 4 + R * eOut((age - 0.15) / 0.45), 0, TAU, 3, 0, 2);
});

// ---- Сияние ------------------------------------------------------------

/**
 * Вспышка сияния (шаманка спрыгнула, пала, улетает): столп света, ленты
 * вьются вверх спиралью, искры, кольцо по снегу. Над темнотой.
 */
zoneFx('f12_auroraburst', (g, z, X, Y, k, age, time) => {
  pinZ(g, z, X, Y);
  const R = z.r * TS;
  const sd = seedOf(z);
  const env = Math.sin(Math.PI * k01(age / z.life)) ** 0.6;
  if (age < 0.12) glowC(g, X, Y - 10, R * 1.4, P.aurL, 0.7 * (1 - age / 0.12), 1);
  glowC(g, X, Y - 18, R * (0.9 + 0.5 * eOut(k)), P.aur, 0.35 * env, 1.3);
  if (age < 0.5 && ink(g, C.aurL, 0.9 * (1 - age / 0.5)))
    arcPx(g, X, Y, 4 + R * 1.3 * eOut(age / 0.5), 0, TAU, 3, 0, 2);
  // Ленты: столбики сияния по спирали, вверх.
  const op = g.globalCompositeOperation;
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 5; i++) {
    const a0 = (i / 5) * TAU + hash(sd, i, 1);
    for (let s = 0; s < 9; s++) {
      const q = s / 9;
      const a = a0 + q * 2.2 + age * 2.4;
      const r = R * (0.35 + 0.45 * q);
      const x = X + Math.cos(a) * r * 0.7;
      const y = Y + Math.sin(a) * r * 0.35 - q * 36 * eOut(k * 2) - age * 14;
      const hq = 8 + 2 * Math.round(3 * (1 - q));
      g.globalAlpha = 0.85 * env * (1 - q * 0.5);
      blitPx(g, ribbonCv((i + s) % AUR_HUES.length, hq), x, y - hq);
    }
  }
  g.globalCompositeOperation = op;
  spray(
    g,
    X,
    Y - 8,
    age,
    {
      n: reduced() ? 8 : 16,
      seed: sd + 2,
      v: [10, 30],
      rise: 40,
      drag: 1.2,
      life: [0.6, 1.2],
      cols: [C.aurL, C.white, C.teal, C.aurW],
    },
    env,
  );
  void time;
});

// ---- Смена фазы --------------------------------------------------------

/** Окно экрана в игровых пикселях (пурга, иней по краям, небо). */
function screenOf(g: G): { w: number; h: number } {
  const s = g.getTransform().a || 1;
  return { w: g.canvas.width / s, h: g.canvas.height / s };
}

/** Пурга: косые штрихи снега по всему экрану. */
function blizzard(g: G, a: number, time: number, sd: number, n: number): void {
  if (a <= 0.02) return;
  const { w, h } = screenOf(g);
  const tr = g.getTransform();
  g.save();
  g.setTransform(tr.a, 0, 0, tr.d, 0, 0);
  for (let i = 0; i < n; i++) {
    const sp = 260 + 200 * hash(sd, i, 1);
    const x = mod(hash(sd, i, 2) * w * 1.6 + time * sp, w * 1.6) - w * 0.3;
    const y = mod(hash(sd, i, 3) * h + time * sp * 0.45, h);
    const L = 3 + Math.floor(hash(sd, i, 4) * 6);
    if (!ink(g, i % 4 ? C.snow : C.white, a * (0.4 + 0.6 * hash(sd, i, 5)))) continue;
    for (let q = 0; q < L; q++) g.fillRect(Math.floor(x - q * 2), Math.floor(y - q), 1, 1);
  }
  g.restore();
}

/** Иней ползёт с краёв экрана внутрь: кристаллы и ветки. */
function frostEdges(g: G, depth: number, a: number, time: number): void {
  if (a <= 0.02 || depth <= 1) return;
  const { w, h } = screenOf(g);
  const tr = g.getTransform();
  g.save();
  g.setTransform(tr.a, 0, 0, tr.d, 0, 0);
  const st = 4;
  const nI = Math.ceil(w / st);
  const dI = Math.ceil(depth / st);
  for (let j = 0; j < h / st; j++)
    for (let i = 0; i < nI; i++) {
      // Середина ряда вне полосы инея — мимо.
      if (i === dI && j * st > depth && j * st < h - depth) i = Math.max(i, nI - dI - 1);
      const x = i * st;
      const y = j * st;
      const e = Math.min(x, y, w - x, h - y);
      const hh = hash(i, j, 1230);
      const lim = depth * (0.55 + 0.45 * hash(i >> 2, j >> 2, 1231));
      if (e > lim) continue;
      const v = 1 - e / lim;
      const tw = 0.75 + 0.25 * Math.sin(time * 2 + hh * 30);
      if (!ink(g, hh > 0.85 ? C.white : hh > 0.4 ? C.frost : C.iceL, a * (0.25 + 0.75 * v) * tw))
        continue;
      const ox = Math.floor(hash(i, j, 1232) * st);
      const oy = Math.floor(hash(i, j, 1233) * st);
      if (hh > 0.92) {
        g.fillRect(x + ox, y + oy - 1, 1, 3);
        g.fillRect(x + ox - 1, y + oy, 3, 1);
      } else g.fillRect(x + ox, y + oy, v > 0.6 ? 2 : 1, 1);
    }
  g.restore();
}

/** Ленты сияния по небу (верх экрана). */
function skyRibbons(g: G, a: number, time: number, sd: number): void {
  if (a <= 0.02) return;
  const { w, h } = screenOf(g);
  const tr = g.getTransform();
  g.save();
  g.setTransform(tr.a, 0, 0, tr.d, 0, 0);
  g.globalCompositeOperation = 'lighter';
  for (let b = 0; b < 2; b++) {
    const base = h * (0.16 + b * 0.1);
    for (let x = 0; x < w; x += 2) {
      const y =
        base +
        Math.sin(x * 0.02 + time * 0.9 + b * 2 + sd) * 14 +
        Math.sin(x * 0.051 - time * 1.3) * 6;
      const hq = Math.min(
        64,
        Math.max(4, 2 * Math.round((18 + 10 * Math.sin(x * 0.04 + time * 2 + b)) / 2)),
      );
      const hue =
        Math.floor(mod(x * 0.006 + time * 0.3 + b * 0.5, 1) * AUR_HUES.length) % AUR_HUES.length;
      g.globalAlpha = a * (0.45 + 0.3 * Math.sin(x * 0.03 + time * 3 + b));
      g.drawImage(ribbonCv(hue, hq), Math.floor(x), Math.floor(y - hq));
    }
  }
  g.restore();
}

/**
 * Смена фазы (dur — номер фазы): вспышка цвета фазы и кольцо, и сцена
 * фазы — набег: снежный вихрь; вьюга: пурга по экрану; ледник: иней с
 * краёв экрана; сияние: ленты по небу и столп над мамонтом. Над темнотой.
 */
const PHASE_HEX = [C.iceL, C.white, C.ice, C.aur];
const PHASE_C3: C3[] = [P.ice, P.white, P.ice, P.aur];
zoneFx('f12_phase', (g, z, X, Y, k, age, time) => {
  pinZ(g, z, X, Y);
  const p = Math.max(0, Math.min(3, Math.round(z.dur ?? 0)));
  const R = z.r * TS;
  const sd = seedOf(z);
  const env = Math.sin(Math.PI * k) ** 0.5;
  if (age < 0.2) glowC(g, X, Y - 16, 60, PHASE_C3[p], 0.6 * (1 - age / 0.2), 1);
  for (let i = 0; i < 2; i++) {
    const q = k01((age - i * 0.18) / 1.1);
    if (q <= 0 || q >= 1) continue;
    if (ink(g, PHASE_HEX[p], 0.85 * (1 - q))) arcPx(g, X, Y, R * eOut(q), 0, TAU, i ? 4 : 3, sd, 2);
  }
  if (p === 0) {
    // Набег: снежный вихрь закручивается вокруг мамонта и поднимается.
    for (let i = 0; i < (reduced() ? 24 : 48); i++) {
      const a = hash(sd, i, 1) * TAU + age * (3 + hash(sd, i, 2) * 2);
      const r = 18 + hash(sd, i, 3) * 60 * eOut(k * 1.5);
      const y = Y - 6 + Math.sin(a) * r * 0.45 - age * 30 * hash(sd, i, 4);
      if (ink(g, i % 3 ? C.snow : C.white, 0.8 * env)) pp(g, X + Math.cos(a) * r, y, 2, 1);
    }
  } else if (p === 1) {
    blizzard(g, env, time, sd, reduced() ? 60 : 150);
  } else if (p === 2) {
    frostEdges(g, 10 + 34 * eOut(k01(age / 0.9)), 0.95 * (1 - eIn(k01((age - 1.1) / 0.5))), time);
    // Кристаллы вырастают по кругу у ног.
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU;
      const x = X + Math.cos(a) * R * 0.3;
      const y = Y + Math.sin(a) * R * 0.22;
      const hgt = Math.round(12 * eOut(k * 3) * (1 - eIn(k)));
      if (hgt < 1) continue;
      if (ink(g, C.iceD, 0.9)) pp(g, x - 1, y - hgt, 3, hgt);
      if (ink(g, C.frost, 0.9)) pp(g, x - 1, y - hgt, 1, hgt);
      if (ink(g, C.white, 0.9)) pp(g, x, y - hgt, 1, 1);
    }
  } else {
    skyRibbons(g, 0.9 * env, time, sd);
    // Столп сияния над мамонтом — шаманка взлетает.
    const op = g.globalCompositeOperation;
    g.globalCompositeOperation = 'lighter';
    for (let s = -2; s <= 2; s++) {
      g.globalAlpha = 0.45 * env * (1 - Math.abs(s) / 3);
      for (let yy = 0; yy < 140; yy += 32)
        blitPx(
          g,
          ribbonCv((s + 6) % AUR_HUES.length, 32),
          X + s * 3,
          Y - 32 - yy - mod(time * 40, 32),
        );
    }
    g.globalCompositeOperation = op;
  }
});

// ---- Ледник ------------------------------------------------------------

/**
 * Ледник растёт (dur — номер слоя): клетки следующего слоя индевеют от
 * краёв к середине, растут кристаллы; последние 0,2 с — белая кромка
 * клеток. Через миг здесь поднимется стена — уходи к середине.
 */
zoneFx('f12_glacierwarn', (g, z, X, Y, k, age, time) => {
  const sim = paintSim();
  if (!sim) return;
  const cells = f12Glacier(sim).layers[Math.round(z.dur ?? 0)];
  if (!cells) return;
  pinZ(g, z, X, Y);
  const left = z.x * TS - X;
  const top = z.y * TS - Y;
  const w = sim.world.w;
  const { w: sw, h: sh } = screenOf(g);
  const sig = sigOf(z.life + 0.05 - age);
  const set = new Set(cells);
  for (const i of cells) {
    const cx = (i % w) * TS - left;
    const cy = Math.floor(i / w) * TS - top;
    if (cx < -TS || cy < -TS * 2 || cx > sw + TS || cy > sh + TS) continue;
    if (ink(g, C.shade, 0.1 + 0.2 * k)) pp(g, cx, cy, TS, TS);
    // Иней от краёв клетки к середине.
    const d = 8 * eOut(k);
    frostGrid(g, cx, cy, cx + TS - 1, cy + TS - 1, 4, 1240, time, 0.95, (x, y, h) => {
      const e = Math.min(x - cx, y - cy, cx + TS - x, cy + TS - y);
      return e < d * (0.6 + 0.4 * h) ? 0.4 + 0.6 * h : 0;
    });
    // Кристаллы прорастают.
    for (let q = 0; q < 2 + (i % 2); q++) {
      const x = cx + 3 + Math.floor(hash(i, q, 1) * 10);
      const y = cy + 13 - Math.floor(hash(i, q, 2) * 4);
      const hgt = Math.round((3 + 6 * hash(i, q, 3)) * eOut(k01((age - q * 0.15) / 0.8)));
      if (hgt < 1) continue;
      if (ink(g, C.iceD, 0.9)) pp(g, x - 1, y - hgt, 3, hgt);
      if (ink(g, C.frost, 0.95)) pp(g, x - 1, y - hgt, 1, hgt);
      if (ink(g, C.white, 0.95)) pp(g, x, y - hgt, 1, 1);
    }
    // Кромка слоя (там, где сосед — не слой): бирюза, в конце — белая.
    const col = sig > 0 ? C.white : C.teal;
    const a = sig > 0 ? 1 : 0.35 + 0.45 * k;
    if (ink(g, col, a)) {
      if (!set.has(i - w)) pp(g, cx, cy, TS, 1);
      if (!set.has(i + w)) pp(g, cx, cy + TS - 1, TS, 1);
      if (!set.has(i - 1)) pp(g, cx, cy, 1, TS);
      if (!set.has(i + 1)) pp(g, cx + TS - 1, cy, 1, TS);
    }
  }
});

/**
 * Слой ледника поднялся: лёд выдавливается из пола снизу вверх — светлая
 * кромка бежит по клетке, крошка и снег летят, по полу рядом трещины.
 */
zoneFx('f12_glacierrise', (g, z, X, Y, k, age) => {
  const sim = paintSim();
  if (!sim) return;
  const cells = f12Glacier(sim).layers[Math.round(z.dur ?? 0)];
  if (!cells) return;
  pinZ(g, z, X, Y);
  const left = z.x * TS - X;
  const top = z.y * TS - Y;
  const w = sim.world.w;
  const { w: sw, h: sh } = screenOf(g);
  const rise = eOut(k01(age / 0.35));
  for (const i of cells) {
    if (sim.tiles[i] !== 1) continue;
    const cx = (i % w) * TS - left;
    const cy = Math.floor(i / w) * TS - top;
    if (cx < -TS || cy < -TS * 2 || cx > sw + TS || cy > sh + TS) continue;
    const delay = hash(i, 1, 1250) * 0.12;
    const q = eOut(k01((age - delay) / 0.3));
    // Ещё не вылезшая часть — в тени, фронт — белая полоса.
    const front = cy + TS - TS * q;
    if (q < 1) {
      if (ink(g, C.shade, 0.55 * (1 - q))) pp(g, cx, cy - 4, TS, Math.max(0, front - cy + 4));
      if (ink(g, C.white, 0.95)) pp(g, cx, front, TS, 1);
      if (ink(g, C.frost, 0.7)) pp(g, cx, front + 1, TS, 1);
    }
    const sd = i * 7;
    const t = age - delay;
    if (t > 0 && (i & 1) === 0)
      shards(g, cx + TS / 2, cy + TS, t, {
        n: 3,
        seed: sd,
        v: [20, 50],
        up: [50, 100],
        grav: 420,
        z0: 4,
        len: [1, 2],
        life: [0.35, 0.55],
        cols: [C.white, C.frost, C.iceL],
      });
    if (t > 0 && (i & 3) === 1)
      spray(
        g,
        cx + TS / 2,
        cy + TS,
        t,
        {
          n: 3,
          seed: sd + 1,
          v: [10, 26],
          up: [20, 40],
          grav: 80,
          drag: 2,
          life: [0.4, 0.7],
          size: [2, 3],
          cols: [C.snow, C.white],
        },
        0.8,
      );
  }
  void rise;
});

// ---- Вход и смерть мамонта ---------------------------------------------

/**
 * Вход мамонта: рёв — звуковые кольца от бивней, со свода сыплется снег
 * и комья, иней кольцом по полу, высоко над ним разгорается сияние.
 */
zoneFx('f12_wake', (g, z, X, Y, k, age, time) => {
  pinZ(g, z, X, Y);
  const sd = seedOf(z);
  const sim = paintSim();
  const m = sim ? f12Mammoth(sim) : null;
  // Иней кольцом.
  const Rf = 12 * TS * 0.55 * eOut(age / 0.9);
  if (age < 0.9 && ink(g, C.frost, 0.8 * (1 - age / 0.9))) arcPx(g, X, Y, Rf, 0, TAU, 3, sd, 2);
  frostGrid(g, X - Rf, Y - Rf, X + Rf, Y + Rf, 6, 1260, time, 0.8 * (1 - eIn(k)), (x, y, h) => {
    const d = Math.hypot(x - X, y - Y);
    return d < Rf && d > Rf - 30 ? 0.3 + 0.7 * h : 0;
  });
  // Рёв: кольца от бивней.
  if (m && m.mode === 'roar') {
    const [tx, ty] = mamPointPx(m, 'tusk');
    const hx = X + (m.x - z.x) * TS + tx;
    const hy = Y + (m.y - z.y) * TS + ty;
    for (let i = 0; i < 4; i++) {
      const t = age - 0.45 - i * 0.28;
      if (t < 0 || t > 0.5) continue;
      const q = t / 0.5;
      if (ink(g, C.white, 0.75 * (1 - q))) {
        arcPx(g, hx, hy, 6 + 34 * eOut(q), -1.1, 1.1, 0, 0);
        arcPx(g, hx, hy, 6 + 34 * eOut(q), Math.PI - 1.1, Math.PI + 1.1, 0, 0);
      }
    }
  }
  // Снег со свода: хлопья падают, комья бьются о лёд.
  for (let i = 0; i < (reduced() ? 36 : 70); i++) {
    const t0 = 0.3 + hash(sd, i, 1) * 1.6;
    const t = age - t0;
    if (t < 0 || t > 1) continue;
    const a = hash(sd, i, 2) * TAU;
    const r = 8 + hash(sd, i, 3) * 100;
    const big = i % 7 === 0;
    const x = X + Math.cos(a) * r + (big ? 0 : Math.sin(t * 6 + i) * 3);
    const yf = Y + Math.sin(a) * r * 0.6;
    const y = yf - 130 * (1 - (big ? t * t : t));
    if (ink(g, C.white, 0.85 * (1 - eIn(t)))) clump(g, x, y, big ? 3 : i % 4 ? 1 : 2);
  }
  // Сияние разгорается высоко над ним.
  const env = Math.sin(Math.PI * k);
  ribbons(g, X - 80, Y - 70, 0, 160, 0.55 * env, 0.8, time, sd % 97);
});

/**
 * Смерть мамонта (dur — куда смотрел): шатается — лёд трещит под ним;
 * валится (~1,5 с) — удар снега и ледяной крошки, тряска; иней затягивает
 * место; дух уходит в сияние — зелёные огни вверх и ленты над телом.
 */
zoneFx('f12_mamdeath', (g, z, X, Y, k, age, time) => {
  pinZ(g, z, X, Y);
  const sd = seedOf(z);
  const R = z.r * TS;
  const fade = 1 - eIn(k);
  for (let i = 0; i < 12; i++)
    crack(
      g,
      X,
      Y,
      crackOf(sd + i, (i / 12) * TAU + hash(sd, i, 1) * 0.5, R * (1 + 0.6 * hash(sd, i, 2)), 0.55),
      eOut(age / 1.2),
      C.frost,
      C.shade,
      0.75 * fade,
    );
  // Падение тела — к 1,5 с.
  const fall = age - 1.45;
  if (fall > 0) {
    if (fall < 0.1) glowC(g, X, Y - 4, R * 1.2, P.white, 0.4 * (1 - fall / 0.1), 0.6);
    if (fall < 0.45 && ink(g, C.white, 1 - fall / 0.45))
      arcPx(g, X, Y, R * (0.5 + 1.1 * eOut(fall / 0.45)), 0, TAU, 3, 0, 2);
    spray(
      g,
      X,
      Y,
      fall,
      {
        n: reduced() ? 20 : 40,
        seed: sd + 3,
        v: [40, 100],
        r0: R * 0.5,
        up: [20, 50],
        grav: 90,
        drag: 2.4,
        life: [0.8, 1.4],
        size: [2, 4],
        cols: [C.white, C.snow, C.snowM],
      },
      0.85,
    );
    shards(g, X, Y, fall, {
      n: reduced() ? 8 : 16,
      seed: sd + 4,
      v: [40, 110],
      r0: R * 0.6,
      up: [40, 110],
      grav: 430,
      len: [1, 3],
      spin: 18,
      life: [0.5, 0.9],
      cols: [C.white, C.frost, C.iceL],
    });
    // Иней затягивает место.
    const fr = eOut(k01(fall / 1.0));
    frostGrid(g, X - R * 1.4, Y - R, X + R * 1.4, Y + R, 4, 1270, time, 0.85 * fade, (x, y, h) => {
      const d = Math.hypot((x - X) / 1.4, y - Y);
      return d < R * fr ? 0.3 + 0.7 * h : 0;
    });
  }
});

/**
 * Дух мамонта уходит в сияние (та же длина и место, что `f12_mamdeath`, но
 * над темнотой): ленты над телом и зелёные огни вверх со следом.
 */
zoneFx('f12_mamsoul', (g, z, X, Y, _k, age, time) => {
  pinZ(g, z, X, Y);
  const sd = seedOf(z);
  const pil = k01((age - 1.3) / 0.5) * (1 - k01((age - 2.5) / 0.5));
  if (pil > 0) ribbons(g, X - 24, Y - 4, 0, 48, 0.8 * pil, 1.6, time, sd % 97, 0.1 * pil);
  const op = g.globalCompositeOperation;
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 16; i++) {
    const t = age - 1.4 - i * 0.07;
    if (t < 0 || t > 1.3) continue;
    const sp = 50 + 30 * hash(sd, i, 6);
    const xo = (hash(sd, i, 5) - 0.5) * 44;
    const a = 1 - t / 1.3;
    for (let q = 4; q >= 0; q--) {
      const tq = Math.max(0, t - q * 0.05);
      const xq = X + xo + Math.sin(tq * 4 + i) * 6;
      const yq = Y - 8 - tq * sp;
      if (ink(g, q ? C.aurD : C.aurL, a * (q ? 0.55 - q * 0.1 : 1)))
        pp(g, xq, yq, q ? 2 : 3, q ? 2 : 3);
    }
    if (ink(g, C.white, a * 0.9)) pp(g, X + xo + Math.sin(t * 4 + i) * 6 + 1, Y - 8 - t * sp + 1);
  }
  g.globalCompositeOperation = op;
});

// ---- Прогрев: сосульки, шипы, ленты — до первого удара --------------------

registerMobWarm('f12boss', function* () {
  for (let v = 0; v < 2; v++) {
    for (let q = -6; q <= 6; q++) {
      icicleRot(v, q * 0.1);
      yield;
    }
    icicleStub(v);
  }
  for (let v = 0; v < 15; v++) {
    spikeCv(v);
    yield;
  }
  for (let hue = 0; hue < AUR_HUES.length; hue++)
    for (let h = 4; h <= 64; h += 2) {
      ribbonCv(hue, h);
      if (h % 8 === 0) yield;
    }
});
