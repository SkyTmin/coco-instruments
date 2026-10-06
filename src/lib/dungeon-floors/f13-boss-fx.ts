// Этаж 13 «Театр марионеток» — всё, что Кукловод создаёт в мире.
//
// Две зоны-режиссёра (их держит правило этажа у героя):
//  • `f13_strings` — поверх темноты: нити кукол и исполина (натяжение,
//    провис, дрожь, обрывки), ореол ваги в окно, столбы софитов с пылью в
//    луче, луна «Звёздной ночи», гребни волн «Бури», звёзды-маятники со
//    шлейфом, яркая часть меток (нити-лезвия, блики, сигнал последних 0,2 с);
//  • `f13_stage` — на полу, под мобами: пятна софитов и луны с туманом, тени
//    нитей (где их резать), разметка меток, след дуги маятника и бегущая
//    впереди тень звезды, проёмы волн, пена, мокрая палуба.
// Остальное — короткие зоны `api.vfx` (лопнувшая нить, контакт ударов без
// своего удара по площади, пыль шагов исполина), занавес, удары по площади
// (сетка нитей, молния, «по памяти»), снаряды и их контакт.
//
// Анимации 13, второй заход (уровень мамонта 12-го): всё рисуется пиксельным
// пером по сетке МИРА (`pin`) — без сглаживания, точки стоят на досках и не
// плывут за камерой; мягкое (градиент) — только свет и вспышки. Язык меток —
// театральный: золотая разметка сцены (пунктир «куда» с первого кадра,
// сплошная лента замыкается ровно к удару), свет рампы бежит от тела к
// кромке, нити натягиваются; последние 0,2 с — белое золото и сходящаяся
// кромка. Время техник — от `m.t` и `z.t` (мозг — метроном), живое — от
// `time`; частицы — замкнутые формулы от возраста и зерна.

import {
  frameLRU,
  paintSim,
  registerImpactPainter,
  registerMobWarm,
  registerShotPainter,
  registerZonePainter,
} from '../dungeon-paint';
import type { ImpactRec, Sprite } from '../dungeon-paint';
import type { Mob, Shot, Strike, Zone } from '../dungeon-sim';
import { solidTile } from '../dungeon-sim';
import { Px } from '../dungeon-art';
import { BOSS, F13_FX, F13_SCENERY, SPOT, stringsOf } from './f13-brains';
import type { StringSeg } from './f13-brains';
import { css, giantShoulderPx, hash, hx, INK, lordVagaPx, P, spiderLift, TAU } from './f13-art';
import type { RGBA } from './f13-art';

type G = CanvasRenderingContext2D;
const TS = 16;
const GOLD = P.gold;
const WARM: RGBA = [255, 220, 150, 255];
const MOON: RGBA = [176, 204, 255, 255];
const k01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ease = (k: number) => {
  const v = k01(k);
  return v * v * (3 - 2 * v);
};
const easeIn = (k: number) => {
  const v = k01(k);
  return v * v;
};
const easeOut = (k: number) => {
  const v = 1 - k01(k);
  return 1 - v * v * v;
};
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const mod = (x: number, n: number) => ((x % n) + n) % n;
const zf = (z: Zone | Strike, key: string): number =>
  (z as unknown as Record<string, number>)[key] ?? 0;
const rgba = (c: RGBA, a: number) => css(c, k01(a));
const life = (z: Zone | Strike) => k01(z.t / Math.max(0.01, (z as Zone).life ?? 1));
const seedOf = (z: { id: number }) => z.id >>> 0;
type To = (x: number, y: number) => [number, number];

/** Мир → экран относительно точки зоны. */
function viewOf(z: { x: number; y: number }, px: number, py: number, S: number): To {
  return (wx: number, wy: number): [number, number] => [px + (wx - z.x) * S, py + (wy - z.y) * S];
}

/** Ширина и высота кадра в игровых пикселях (рендер рисует с масштабом). */
function viewSize(g: G): [number, number] {
  const t = g.getTransform();
  return [g.canvas.width / (Math.abs(t.a) || 1), g.canvas.height / (Math.abs(t.d) || 1)];
}

let rmq: MediaQueryList | null | undefined;
/** Просили меньше движения: без мигания, вспышки тише, частиц меньше. */
const reduced = () => {
  if (rmq === undefined)
    rmq =
      typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
  return !!rmq?.matches;
};

/** Сложением (свет). */
function lighter(g: G, f: () => void): void {
  const o = g.globalCompositeOperation;
  const a = g.globalAlpha;
  g.globalCompositeOperation = 'lighter';
  g.globalAlpha = 1;
  f();
  g.globalCompositeOperation = o;
  g.globalAlpha = a;
}

/** Мягкое свечение: радиальный градиент (только свет и вспышки). */
function glow(g: G, x: number, y: number, r: number, col: RGBA, a: number, sy = 1): void {
  if (a <= 0.004 || r <= 0.2) return;
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, rgba(col, a));
  gr.addColorStop(0.45, rgba(col, a * 0.45));
  gr.addColorStop(1, rgba(col, 0));
  g.fillStyle = gr;
  g.beginPath();
  g.ellipse(x, y, r, r * sy, 0, 0, TAU);
  g.fill();
}
/** Свет сложением. */
const glowC = (g: G, x: number, y: number, r: number, col: RGBA, a: number, sy = 1) =>
  lighter(g, () => glow(g, x, y, r, col, a, sy));

/** Разлёт частиц (картинки кукол этажа: опилки, лоскуты). */
function burst(
  g: G,
  x: number,
  y: number,
  k: number,
  n: number,
  seed: number,
  cols: RGBA[],
  R: number,
  up = 0,
): void {
  for (let i = 0; i < n; i++) {
    const a = hash(seed, i, 1) * TAU;
    const sp = (0.4 + hash(seed, i, 2)) * R;
    const px = x + Math.cos(a) * sp * k;
    const py = y + Math.sin(a) * sp * k * 0.6 - up * k + 20 * k * k * hash(seed, i, 3);
    g.fillStyle = rgba(cols[i % cols.length], 1 - k);
    const s = 1 + (i % 2);
    g.fillRect(px, py, s, s);
  }
}

// ---------------------------------------------------------------------------
// Пиксельное перо: точки сетки мира. `pin(g, offX, offY)` — где на экране
// нулевая точка мира; остаток привязки один на кадр, поэтому разметка и
// щепа стоят на досках, а не плывут на пиксель за камерой.
// ---------------------------------------------------------------------------

const hex = (c: RGBA) =>
  '#' + [c[0], c[1], c[2]].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

/** Палитра техник — строками (прозрачность — `globalAlpha`). */
const C = {
  white: '#ffffff',
  cream: '#fff6dc',
  gold0: hex(GOLD[0]),
  gold1: hex(GOLD[1]),
  gold2: hex(GOLD[2]),
  gold3: hex(GOLD[3]),
  warm: hex(WARM),
  warmD: '#a8641e',
  amber: '#ffbe5a',
  ink: hex(INK),
  shade: '#06030a',
  wood0: hex(P.wood[0]),
  wood1: hex(P.wood[1]),
  wood2: hex(P.wood[2]),
  wood3: hex(P.wood[3]),
  dust0: hex(P.cream[0]),
  dust1: hex(P.cream[1]),
  dust2: hex(P.cream[2]),
  vel0: hex(P.velvet[0]),
  vel1: hex(P.velvet[1]),
  vel2: hex(P.velvet[2]),
  vel3: hex(P.velvet[3]),
  sea0: hex(P.sea[0]),
  sea1: hex(P.sea[1]),
  sea2: hex(P.sea[2]),
  sea3: hex(P.sea[3]),
  foam: '#e8f6ff',
  moon: hex(MOON),
  moonL: '#dce8ff',
  chalk: '#e6ecff',
  chalkD: '#8c9cd0',
  silver1: hex(P.silver[1]),
  silver2: hex(P.silver[2]),
  silver3: hex(P.silver[3]),
  steel3: hex(P.steel[3]),
  rose: hex(P.red[2]),
  roseL: hex(P.red[3]),
  leaf: hex(P.green[2]),
  cold: '#c8dcff',
  soot: '#1a1418',
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
/** Привязка для зоны: её мировая точка (z.x, z.y) — на экране (px, py). */
const pinZ = (g: G, z: { x: number; y: number }, px: number, py: number) =>
  pin(g, px - z.x * TS, py - z.y * TS);
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
// прямоугольником.
let RX = 0;
let RY = 0;
let RW = 0;
let RH = 0;
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
function runEnd(g: G): void {
  if (RW) g.fillRect(RX + QX, RY + QY, RW, RH);
  RW = 0;
}

/** Сектор кольца R0…R1 от a0 до a1 (меньше π — клин; иначе полное кольцо). */
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
const fDisc = (g: G, X: number, Y: number, R: number) => fSector(g, X, Y, 0, R, 0, TAU);

/** Эллипс строками. */
function fEll(g: G, X: number, Y: number, rx: number, ry: number): void {
  if (rx < 0.5 || ry < 0.5) return;
  for (let j = WY(Y - ry); j <= WY(Y + ry); j++) {
    const dy = (j + 0.5 + OY - Y) / ry;
    if (dy * dy >= 1) continue;
    const hw = rx * Math.sqrt(1 - dy * dy);
    hrow(g, X - hw, X + hw, j);
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
  const Q = (u: number, v: number) => [X + ux * u - uy * v, Y + uy * u + ux * v];
  fPoly(g, [...Q(u0, v0), ...Q(u1, v0), ...Q(u1, v1), ...Q(u0, v1)]);
}

/** Дуга точками, `dash` — период пунктира в точках, `on` — сколько горит. */
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
    if (dash && mod(i + Math.floor(off), dash) >= onN) {
      runEnd(g);
      continue;
    }
    runPx(g, x, y);
  }
  runEnd(g);
}

/** Линия по пикселям мира (Брезенхэм), `dash` — период, `on` — сколько горит. */
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
  for (let n = 0; n < 3000; n++) {
    if (!dash || mod(n + Math.floor(off), dash) < onN) runPx(g, x, y);
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

/** Ломаная по точкам [x0, y0, x1, y1, …] без двойных точек на стыках. */
function polyPx(g: G, pts: number[], from = 0, to = 1): void {
  const n = pts.length >> 1;
  if (n < 2) return;
  const i0 = Math.floor(from * (n - 1));
  const i1 = Math.ceil(to * (n - 1));
  for (let i = i0; i < i1; i++)
    linePx(g, pts[2 * i], pts[2 * i + 1], pts[2 * i + 2], pts[2 * i + 3]);
}

/** Звёздочка-блик: крест 3×3, крупная — с лучами через точку. */
function sparkPx(g: G, x: number, y: number, c: string, a: number, big = false): void {
  if (!ink(g, c, a)) return;
  pp(g, x, y - 1, 1, 3);
  pp(g, x - 1, y, 3, 1);
  if (big) {
    g.globalAlpha = Math.min(1, a) * 0.6;
    pp(g, x, y - 3, 1, 1);
    pp(g, x, y + 3, 1, 1);
    pp(g, x - 3, y, 1, 1);
    pp(g, x + 3, y, 1, 1);
  }
}

/** Ком (пыль, пена): больше двух точек — без углов. */
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

// ---- Частицы: всё от возраста и зерна, без состояния ---------------------

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
  /** Всплывает (пыль, пар), пикс/с. */
  rise?: number;
  delay?: number;
  /** Сжатие пола по вертикали (вид в три четверти). */
  squash?: number;
}

function spray(g: G, X: number, Y: number, age: number, b: Spray, aK = 1): void {
  const sq = b.squash ?? 0.6;
  const n = reduced() ? Math.ceil(b.n / 2) : b.n;
  for (let i = 0; i < n; i++) {
    const h1 = hash(b.seed, i, 1);
    const h2 = hash(b.seed, i, 2);
    const h3 = hash(b.seed, i, 3);
    const h4 = hash(b.seed, i, 4);
    const t = age - (b.delay ?? 0) * h4;
    const lf = b.life[0] + (b.life[1] - b.life[0]) * h3;
    if (t < 0 || t > lf) continue;
    const a = b.spread === undefined ? h1 * TAU : (b.ang ?? 0) + (h1 - 0.5) * b.spread;
    const v = b.v[0] + (b.v[1] - b.v[0]) * h2;
    const dr = b.drag ?? 0;
    const d = dr > 0 ? (v * (1 - Math.exp(-dr * t))) / dr : v * t;
    const r0 = (b.r0 ?? 0) * (0.55 + 0.45 * h4);
    const up = b.up ? b.up[0] + (b.up[1] - b.up[0]) * h2 : 0;
    const z = Math.max(0, up * t - 0.5 * (b.grav ?? 0) * t * t) + (b.rise ?? 0) * t;
    const sz = b.size ? Math.round(b.size[0] + (b.size[1] - b.size[0]) * h3) : 1;
    if (!ink(g, b.cols[i % b.cols.length], (1 - easeIn(t / lf)) * aK)) continue;
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
  /** Длина щепки, точек. */
  len?: [number, number];
  cols: string[];
  r0?: number;
  /** Высота старта над полом, пикс. */
  z0?: number;
  /** Вращение, рад/с. */
  spin?: number;
  /** Трение по доскам, 1/с. */
  slide?: number;
  squash?: number;
  /** Какую часть пути рисовать: всё, только полёт, только лёжа. */
  part?: 'all' | 'air' | 'ground';
  delay?: number;
  /** Цвет блика на верхнем конце (null — без). */
  tip?: string | null;
}

/**
 * Щепа и обломки по физике: полёт, отскок, скольжение по доскам с трением,
 * вращение в воздухе; тень на полу под летящим. Замкнутые формулы от возраста.
 */
function shards(g: G, X: number, Y: number, age: number, s: ShardSpec, aK = 1): void {
  const sq = s.squash ?? 0.6;
  const G0 = s.grav;
  const fr = s.slide ?? 4;
  const n = reduced() ? Math.ceil(s.n / 2) : s.n;
  for (let i = 0; i < n; i++) {
    const h1 = hash(s.seed, i, 21);
    const h2 = hash(s.seed, i, 22);
    const h3 = hash(s.seed, i, 23);
    const h4 = hash(s.seed, i, 24);
    const t = age - (s.delay ?? 0) * h4;
    const lf = s.life[0] + (s.life[1] - s.life[0]) * h3;
    if (t < 0 || t > lf) continue;
    const a = s.spread === undefined ? h1 * TAU : (s.ang ?? 0) + (h1 - 0.5) * s.spread;
    const v = s.v[0] + (s.v[1] - s.v[0]) * h2;
    const up = s.up[0] + (s.up[1] - s.up[0]) * h3;
    const z0 = (s.z0 ?? 0) * (0.6 + 0.4 * h4);
    const w = (s.spin ?? 14) * (h2 - 0.5) * 2;
    const t1 = (up + Math.sqrt(up * up + 2 * G0 * z0)) / G0;
    const up2 = (G0 * t1 - up) * 0.25;
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
      d = v * t1 + v * 0.5 * u;
      z = up2 * u - 0.5 * G0 * u * u;
      th = w * t1 + w * 0.5 * u;
    } else {
      const u = t - t1 - t2;
      const vs = v * 0.4;
      d = v * t1 + v * 0.5 * t2 + (vs * (1 - Math.exp(-fr * u))) / fr;
      z = 0;
      th = w * t1 + w * 0.5 * t2 + (w * 0.2 * (1 - Math.exp(-fr * u))) / fr;
      // Лёжа — плашмя вдоль досок или поперёк.
      th = Math.round(th / (Math.PI / 2)) * (Math.PI / 2);
      air = false;
    }
    const part = s.part ?? 'all';
    if ((part === 'air' && !air) || (part === 'ground' && air)) continue;
    const r0 = (s.r0 ?? 0) * (0.5 + 0.5 * h4);
    const fx = X + Math.cos(a) * (r0 + d);
    const fy = Y + Math.sin(a) * (r0 + d) * sq;
    const al = (1 - easeIn(k01((t - lf * 0.6) / (lf * 0.4)))) * aK;
    if (air && z > 1.5 && ink(g, C.shade, 0.3 * al)) pp(g, fx, fy, 2, 1);
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
    if (s.tip !== null && ink(g, s.tip ?? C.dust2, al * 0.9))
      pp(g, cx - Math.abs(ux) * ((L - 1) / 2), cy - Math.abs(uy) * ((L - 1) / 2));
  }
}

/** Искры: короткие черты по баллистике, гаснут (свет — поверх темноты). */
function sparksPx(
  g: G,
  X: number,
  Y: number,
  age: number,
  n: number,
  seed: number,
  speed: number,
  cols: string[],
  span = 0.35,
  dir = -Math.PI / 2,
  spread = Math.PI,
  grav = 260,
): void {
  const N = reduced() ? Math.ceil(n / 2) : n;
  for (let i = 0; i < N; i++) {
    const lf = span * (0.55 + 0.8 * hash(seed, i, 41));
    if (age > lf || age < 0) continue;
    const a = dir + (hash(seed, i, 42) - 0.5) * spread * 2;
    const v = speed * (0.45 + 0.75 * hash(seed, i, 43));
    const at = (t: number): [number, number] => {
      const e = (1 - Math.exp(-3 * t)) / 3;
      return [X + Math.cos(a) * v * e, Y + Math.sin(a) * v * e + 0.5 * grav * t * t * 0.6];
    };
    const [x1, y1] = at(age);
    const [x0, y0] = at(Math.max(0, age - 0.025));
    const k = age / lf;
    if (!ink(g, cols[i % cols.length], 1 - k * k)) continue;
    linePx(g, x0, y0, x1, y1);
  }
}

/** Пыль сцены: клубы, всплывают и тают (на полу, под мобами). */
function dustPuff(
  g: G,
  X: number,
  Y: number,
  age: number,
  n: number,
  seed: number,
  R: number,
  lifeT: number,
  aK = 1,
  ang = 0,
  spread = TAU,
): void {
  spray(
    g,
    X,
    Y,
    age,
    {
      n,
      seed,
      ang,
      spread,
      v: [R * 0.9, R * 2.2],
      drag: 3.2,
      rise: 5,
      life: [lifeT * 0.6, lifeT],
      size: [2, 4],
      cols: [C.dust1, C.dust0, C.dust2],
    },
    aK * 0.55,
  );
}

/** Кривая по пикселям мира: выборка с шагом меньше пикселя, без двойных точек. */
function curvePx(g: G, at: (s: number) => [number, number], L: number, s0 = 0, s1 = 1): void {
  const n = Math.max(2, Math.ceil((L * (s1 - s0)) / 0.8));
  let lx = 1e9;
  let ly = 1e9;
  for (let i = 0; i <= n; i++) {
    const [x, y] = at(s0 + ((s1 - s0) * i) / n);
    const X = WX(x);
    const Y = WY(y);
    if (X === lx && Y === ly) continue;
    if (lx !== 1e9 && (Math.abs(X - lx) > 1 || Math.abs(Y - ly) > 1)) {
      // Пропуск на крутом месте — дотянуть прямой.
      const dx = X - lx;
      const dy = Y - ly;
      const m = Math.max(Math.abs(dx), Math.abs(dy));
      for (let q = 1; q < m; q++)
        runPx(g, lx + Math.round((dx * q) / m), ly + Math.round((dy * q) / m));
    }
    runPx(g, X, Y);
    lx = X;
    ly = Y;
  }
  runEnd(g);
}

// ---------------------------------------------------------------------------
// Нити: натяжение, провис, дрожь, обрывки. Пиксельной линией по сетке мира;
// под золотом — тушь (нить читается и на светлых досках, и в луче).
// ---------------------------------------------------------------------------

/** Высота плеч куклы над её точкой на полу, пиксели (куда крепится нить). */
function shoulderH(m: Mob, time: number): number {
  switch (m.kind) {
    case 'f13_giant':
      return giantShoulderPx(m, time);
    case 'f13_nutcracker':
      return 24;
    case 'f13_spider':
      return 8 + spiderLift(m);
    case 'f13_prompter':
    case 'f13_cashier':
      return 12;
  }
  return 18;
}

const lordNow = () => F13_FX.mobs.find((q) => q.kind === 'f13boss' && q.mode !== 'dying') ?? null;

/** Вага Кукловода на экране — только по `lordVagaPx` «Тела». */
function vagaScreen(to: To, time: number): [number, number] | null {
  const lord = lordNow();
  if (!lord) return null;
  const [x, y] = to(lord.x, lord.y);
  const [dx, dy] = lordVagaPx(lord, time);
  return [x + dx, y + dy];
}

/** Когда лопнула каждая нить (время сцены): дрожь остальных, рост обрывков. */
const CUTS = new WeakMap<Mob, { mask: number; at: number[] }>();
function cutTimes(m: Mob): number[] {
  const mask = m.data.cut ?? 0;
  let c = CUTS.get(m);
  if (!c) {
    c = { mask, at: [-9, -9, -9, -9, -9, -9, -9, -9] };
    CUTS.set(m, c);
  }
  if (c.mask !== mask) {
    for (let i = 0; i < 8; i++) {
      const b = 1 << i;
      if (mask & b && !(c.mask & b)) c.at[i] = F13_FX.time;
      if (!(mask & b)) c.at[i] = -9;
    }
    c.mask = mask;
  }
  return c.at;
}

/** Натяжение: провис (1 — обычный, 0 — струна), дрожь, блеск, рывок ваги. */
interface Pull {
  sag: number;
  buzz: number;
  lit: number;
  jerk: number;
}

const STRIKING = new Set(['windup', 'f13_lance', 'f13_shield', 'f13_charge_aim', 'f13_charge']);
/** Обмякла: нити висят петлёй. */
const SLACK = new Set(['f13_slump', 'f13_fallen', 'f13_broken', 'f13_lost', 'stun']);

function pullOf(m: Mob, lastCut: number): Pull {
  const p: Pull = { sag: 1, buzz: 0, lit: 0, jerk: 0 };
  if (STRIKING.has(m.mode) || m.tele) {
    // Кукла бьёт: вага поддёрнула — нить в струну, блестит, к удару звенит.
    const k = ease(m.t / 0.3);
    p.sag = 1 - 0.94 * k;
    p.lit = 0.35 + 0.65 * k;
    p.jerk = 3 * k;
    if (m.danger > 0) p.buzz = 0.6;
  } else if (m.mode === 'recover' && m.t < 0.5) {
    // Отпустило с отскоком: струна провисает и качнётся раз-другой.
    const u = m.t / 0.5;
    p.sag = 0.06 + 0.94 * ease(u) + 0.45 * Math.sin(u * TAU) * (1 - u);
    p.lit = 1 - u;
    p.jerk = 3 * (1 - easeOut(u));
  } else if (m.mode === 'f13_reel' || m.data.crawl || SLACK.has(m.mode)) p.sag = 2.6;
  // Часть нитей срезана — оставшиеся провисают: кукла висит криво.
  else if (m.data.cut) p.sag = 1.6;
  const age = F13_FX.time - lastCut;
  if (age >= 0 && age < 0.9) p.buzz = Math.max(p.buzz, 2.6 * Math.exp(-age * 4.5));
  return p;
}

interface ThreadOpt {
  a: number;
  sag: number;
  seed: number;
  time: number;
  bowX?: number;
  buzz?: number;
  lit?: number;
  /** Нить толще (исполин): две точки поперёк. */
  thick?: boolean;
  /** Цвета: тело нити и блик. */
  col?: string;
  hi?: string;
  /** Верх уходит в темноту колосников. */
  fade?: boolean;
  glints?: boolean;
  /** Без тени тушью: на ночном небе её не видно, а длинная нить — сотни точек. */
  flat?: boolean;
}

/** Точка нити от верха (x0, y0) к низу (x1, y1): провис, выгиб, дрожь. */
function threadAt(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  o: ThreadOpt,
): (s: number) => [number, number] {
  const L = Math.hypot(x1 - x0, y1 - y0) || 1;
  const sag = o.sag * (1.2 + L * 0.055);
  const mx = (x0 + x1) / 2 + (o.bowX ?? 0) + Math.sin(o.time * 1.7 + o.seed) * 0.7 * o.sag;
  const my = (y0 + y1) / 2 + sag;
  const buzz = o.buzz ?? 0;
  const nx = -(y1 - y0) / L;
  const ny = (x1 - x0) / L;
  return (s: number): [number, number] => {
    const u = 1 - s;
    let x = u * u * x0 + 2 * u * s * mx + s * s * x1;
    let y = u * u * y0 + 2 * u * s * my + s * s * y1;
    if (buzz > 0.05) {
      // Стоячая волна: узлы на концах, пучность посередине, частота струны.
      const d = buzz * Math.sin(Math.PI * s) * Math.sin(o.time * 57 + o.seed + s * 3);
      x += nx * d;
      y += ny * d;
    }
    return [x, y];
  };
}

/** Нить от (x0, y0) — верх — к (x1, y1): тушь под золотом, бегущий блик. */
function threadPx(g: G, x0: number, y0: number, x1: number, y1: number, o: ThreadOpt): void {
  if (o.a <= 0.012) return;
  const L = Math.hypot(x1 - x0, y1 - y0) + o.sag * 4;
  const at = threadAt(x0, y0, x1, y1, o);
  const lit = o.lit ?? 0;
  const col = o.col ?? (lit > 0.5 ? C.gold2 : C.gold1);
  const sh = (s: number): [number, number] => {
    const [x, y] = at(s);
    return [x + 1, y + 1];
  };
  if (o.fade) {
    // К колосникам гаснет ступенями: тьма над сценой.
    const st = [0, 0.3, 0.55, 0.78, 1];
    for (let i = 0; i < 4; i++) {
      const a = o.a * (0.2 + 0.8 * (i / 3));
      if (ink(g, C.shade, a * 0.35)) curvePx(g, sh, L, st[i], st[i + 1]);
      if (ink(g, col, a)) curvePx(g, at, L, st[i], st[i + 1]);
    }
  } else {
    if (!o.flat && ink(g, C.shade, o.a * 0.42)) curvePx(g, sh, L);
    if (o.thick && ink(g, C.gold0, o.a)) {
      const at2 = (s: number): [number, number] => {
        const [x, y] = at(s);
        return [x + 1, y];
      };
      curvePx(g, at2, L);
    }
    if (ink(g, col, o.a)) curvePx(g, at, L);
  }
  if (o.glints === false) return;
  // Блики бегут вверх по нити; натянутая блестит ярче и чаще.
  const n = lit > 0.5 ? 2 : 1;
  for (let i = 0; i < n; i++) {
    const k = 1 - mod(o.time * (0.45 + lit * 0.9) + o.seed * 0.13 + i * 0.5, 1);
    if (o.fade && k < 0.35) continue;
    const [bx, by] = at(k);
    if (ink(g, lit > 0.5 ? C.white : (o.hi ?? C.gold3), o.a * (0.6 + 0.4 * lit))) {
      pp(g, bx, by);
      if (lit > 0.5) {
        const [cx, cy] = at(Math.min(1, k + 1.5 / L));
        pp(g, cx, cy);
      }
    }
  }
}

/** Обрывок: свисает от точки (вниз или вверх), качается; кончик распушён. */
function stubPx(
  g: G,
  x: number,
  y: number,
  len: number,
  sway: number,
  a: number,
  up = false,
): void {
  if (len < 0.8 || a <= 0.012) return;
  const s = up ? -1 : 1;
  const ex = x + Math.sin(sway) * len;
  const ey = y + s * Math.cos(sway) * len;
  const mx = x + Math.sin(sway * 0.4) * len * 0.5;
  const my = y + s * len * 0.55;
  const at = (k: number): [number, number] => {
    const u = 1 - k;
    return [u * u * x + 2 * u * k * mx + k * k * ex, u * u * y + 2 * u * k * my + k * k * ey];
  };
  if (ink(g, C.shade, a * 0.4))
    curvePx(
      g,
      (k) => {
        const [px, py] = at(k);
        return [px + 1, py + 1];
      },
      len,
    );
  if (ink(g, C.gold1, a)) curvePx(g, at, len);
  // Распушённый кончик: две волосинки врозь.
  if (ink(g, C.gold2, a * 0.9)) {
    pp(g, ex - 1, ey + s);
    pp(g, ex + 1, ey + s);
  }
}

/** Маленькая вага (крестовина) — куда сходятся нити куклы. */
function crossbarPx(g: G, x: number, y: number, w: number, a: number): void {
  const W = Math.round(w);
  if (ink(g, C.ink, a * 0.8)) {
    pp(g, x - W - 1, y - 1, 2 * W + 3, 3);
    pp(g, x - 1, y - 3, 3, 7);
  }
  if (ink(g, C.wood2, a)) {
    pp(g, x - W, y, 2 * W + 1, 1);
    pp(g, x, y - 2, 1, 5);
  }
  if (ink(g, C.wood3, a)) pp(g, x - W, y, W, 1);
  if (ink(g, C.gold3, a)) {
    pp(g, x - W, y);
    pp(g, x + W, y);
  }
}

/** Нити куклы к её крестовине и выше — во тьму колосников. */
function puppetStrings(g: G, m: Mob, segs: StringSeg[], to: To, time: number, a: number): void {
  const at = cutTimes(m);
  const pull = pullOf(m, Math.max(...at));
  const sh = shoulderH(m, time);
  const bow = -m.vx * 1.4;
  let cx = 0;
  let cy = 0;
  let x0 = Infinity;
  let x1 = -Infinity;
  for (const s of segs) {
    const [bx, by] = to(s.bx, s.by);
    cx += bx;
    cy += by - 18 - pull.jerk;
    x0 = Math.min(x0, bx);
    x1 = Math.max(x1, bx);
  }
  cx /= segs.length;
  cy /= segs.length;
  for (const s of segs) {
    const [lx, lyFloor] = to(s.ax, s.ay);
    const ly = lyFloor + 0.18 * 16 - sh;
    const [tx] = to(s.bx, s.by);
    const ty = cy;
    const age = F13_FX.time - at[s.i];
    if (s.cut) {
      // Обрывки: от плеча и от крестовины, доигрывают хлыст и качаются.
      const k = easeOut(age / 0.3);
      const sw = Math.sin(time * 3.2 + s.i * 1.7 + m.id) * 0.25;
      const kick = Math.exp(-Math.max(0, age) * 3) * Math.sin(age * 14) * 0.9;
      stubPx(g, lx, ly, 5 * k, sw + kick, a * 0.85);
      stubPx(g, tx, ty, 7 * k, -sw - kick * 0.6, a * 0.85);
      continue;
    }
    threadPx(g, tx, ty, lx, ly, {
      a,
      sag: pull.sag,
      bowX: bow,
      buzz: pull.buzz,
      lit: pull.lit,
      seed: s.i * 3.1 + m.id,
      time,
    });
  }
  crossbarPx(g, cx, cy, Math.max(3.5, (x1 - x0) / 2 + 1.5), a);
  // Выше ваги нить уходит во тьму колосников.
  threadPx(g, cx + 1 - bow * 0.5, cy - 44, cx, cy - 3, {
    a: a * 0.8,
    sag: 0.2,
    seed: m.id,
    time,
    fade: true,
    lit: pull.lit,
  });
}

/** Нити исполина: от ваги в руке Кукловода (`lordVagaPx`) к плечам (`giantShoulderPx`). */
function giantStrings(g: G, m: Mob, segs: StringSeg[], to: To, time: number, a: number): void {
  const vaga = vagaScreen(to, time);
  const at = cutTimes(m);
  const pull = pullOf(m, Math.max(...at));
  const sh = giantShoulderPx(m, time);
  const lord = lordNow();
  // Кукловод «провис» (одна нить срезана) — вага ниже, нити слабнут.
  const dip = lord ? k01((0.9 - (lord.data.lift ?? 1)) / 0.5) : 0;
  const sag = pull.sag * (1 + 1.6 * dip);
  const rebuild = m.mode === 'f13_rebuild';
  for (const s of segs) {
    const ox = s.ax - m.x;
    const oy = s.ay + 0.55 - m.y;
    const [bx, byFloor] = to(m.x + ox, m.y + oy);
    const by = byFloor - sh;
    const tx = vaga ? vaga[0] + ox * 8 : bx;
    const ty = vaga ? vaga[1] + 2 + oy * 8 : by - 44;
    const age = F13_FX.time - at[s.i];
    const seed = s.i * 3.1 + m.id;
    if (rebuild) {
      // Нити вяжутся обратно: опускаются от ваги к плечу по одной, щелчок узла.
      const k = easeOut((m.t - 0.25 - s.i * 0.32) / 0.7);
      if (k <= 0) {
        stubPx(g, tx, ty, 6, Math.sin(time * 3 + s.i) * 0.3, a * 0.8);
        continue;
      }
      const ex = lerp(tx, bx, k);
      const ey = lerp(ty, by, k);
      threadPx(g, tx, ty, ex, ey, {
        a,
        sag: 0.4 * (1 - k) + 0.3,
        seed,
        time,
        lit: 1 - k,
        thick: true,
      });
      if (k < 1) sparkPx(g, ex, ey, C.gold3, 0.9);
      else if (m.t - 0.25 - s.i * 0.32 - 0.7 < 0.25) sparkPx(g, bx, by, C.white, 0.9, true);
      continue;
    }
    if (s.cut) {
      const k = easeOut(age / 0.3);
      const sw = Math.sin(time * 2.6 + s.i * 1.9) * 0.22;
      const kick = Math.exp(-Math.max(0, age) * 2.5) * Math.sin(age * 12) * 1.1;
      stubPx(g, tx, ty, 10 * k, sw + kick, a * 0.9);
      stubPx(g, bx, by, 7 * k, -sw * 0.5 - kick * 0.5, a * 0.9);
      continue;
    }
    threadPx(g, tx, ty, bx, by, {
      a,
      sag,
      bowX: -m.vx * 1.6,
      buzz: pull.buzz,
      lit: pull.lit,
      seed,
      time,
      thick: true,
    });
    // Узел на плече: золотая бусина, в ударе горит.
    if (ink(g, pull.lit > 0.5 ? C.gold3 : C.gold1, a)) pp(g, bx, by - 1, 1, 2);
  }
}

function drawStrings(g: G, to: To, hx0: number, hy0: number, time: number): void {
  for (const m of F13_FX.mobs) {
    if (m.mode === 'dying' || (m.data.sn ?? 0) <= 0) continue;
    if (Math.abs(m.x - hx0) > 15 || Math.abs(m.y - hy0) > 13) continue;
    const segs = stringsOf(m);
    if (!segs.length) continue;
    const a = (m.data.ghost ?? 0) > 0 ? 0.3 : 0.9;
    if (m.kind === 'f13_giant') giantStrings(g, m, segs, to, time, a);
    else puppetStrings(g, m, segs, to, time, a);
  }
  g.globalAlpha = 1;
}

/** Тени нитей на полу: где их на самом деле режет взмах (честная линия удара). */
function stringShadows(g: G, to: To, hx0: number, hy0: number, time: number): void {
  for (const m of F13_FX.mobs) {
    if (m.mode === 'dying' || (m.data.sn ?? 0) <= 0) continue;
    if ((m.data.ghost ?? 0) > 0) continue;
    if (Math.abs(m.x - hx0) > 12 || Math.abs(m.y - hy0) > 10) continue;
    const giant = m.kind === 'f13_giant';
    const at = cutTimes(m);
    for (const s of stringsOf(m)) {
      if (s.cut) continue;
      const [ax, ay] = to(s.ax, s.ay);
      const [bx, by] = to(s.bx, s.by);
      if (ink(g, C.shade, giant ? 0.34 : 0.26)) {
        linePx(g, ax, ay, bx, by);
        if (giant) linePx(g, ax + 1, ay, bx + 1, by);
      }
      // Золотая пунктирная риска поверх тени; после подреза соседней — дрожит.
      const shiver = F13_FX.time - Math.max(...at) < 0.6 ? Math.floor(time * 30) % 2 : 0;
      if (ink(g, C.gold2, giant ? 0.4 : 0.28))
        linePx(g, ax, ay + shiver, bx, by + shiver, 4, time * 6, 1);
    }
  }
}

/**
 * Вага Кукловода в окно (акты I–III): ореол и искры. Его собственные нити к
 * шляпе и запястьям рисует «Тело» в кадре (`lordThread`) — второй набор здесь
 * дублировал их и проходил сквозь фигуру (грабля v2.92).
 */
function lordFlies(g: G, to: To, time: number): void {
  if (F13_FX.act === 3) return;
  const lord = lordNow();
  if (!lord || lord.mode === 'chase' || !lord.data.open) return;
  const [x, y] = to(lord.x, lord.y);
  const [vdx, vdy] = lordVagaPx(lord, time);
  const vx = x + vdx;
  const vy = y + vdy;
  const p = reduced() ? 0.5 : 0.5 + 0.5 * Math.sin(time * 7);
  glowC(g, vx, vy, 11 + 2 * p, WARM, 0.3 + 0.1 * p);
  // Искры с концов крестовины всплывают и гаснут.
  for (let i = 0; i < 4; i++) {
    const ph = mod(time * 1.6 + i * 0.25, 1);
    const ex = vx + (i % 2 ? 5 : -5) * (i < 2 ? 1 : 0);
    const ey = vy + (i >= 2 ? (i % 2 ? 4 : -4) : 0);
    sparkPx(g, ex, ey - ph * 4, ph < 0.4 ? C.white : C.gold3, 1 - ph, ph < 0.2);
  }
  g.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// Свет: софиты с пылью в луче, луна акта III с туманом. Свет — мягкий
// (градиент сложением), предметы — пиксельные.
// ---------------------------------------------------------------------------

/** Столб света от фонаря (lx, ly) к пятну (x, y) радиуса r — сложением. */
function beam(
  g: G,
  lx: number,
  ly: number,
  x: number,
  y: number,
  r: number,
  col: RGBA,
  a: number,
  time: number,
  seed: number,
  motes = 9,
): void {
  const dx = x - lx;
  const dy = y - ly;
  const L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L;
  const ny = dx / L;
  const gr = g.createLinearGradient(lx, ly, x, y);
  gr.addColorStop(0, rgba(col, a * 1.2));
  gr.addColorStop(0.6, rgba(col, a * 0.55));
  gr.addColorStop(1, rgba(col, a * 0.2));
  g.fillStyle = gr;
  g.beginPath();
  g.moveTo(lx + nx * 2, ly + ny * 2);
  g.lineTo(x + nx * r, y + ny * r * 0.55);
  g.lineTo(x - nx * r, y - ny * r * 0.55);
  g.lineTo(lx - nx * 2, ly - ny * 2);
  g.closePath();
  g.fill();
  // Пыль в луче: медленно плывёт вниз и вбок, мерцает — точками мира.
  for (let i = 0; i < motes; i++) {
    const u = mod(hash(seed, i, 61) + time * (0.035 + 0.03 * hash(seed, i, 62)), 1);
    const v = Math.sin(time * (0.4 + hash(seed, i, 63) * 0.5) + i * 2.1) * 0.85;
    const half = lerp(2, r, u);
    const px = lx + dx * u + nx * v * half;
    const py = ly + dy * u + ny * v * half * 0.55;
    const tw = 0.35 + 0.65 * Math.abs(Math.sin(time * (1.5 + i * 0.3) + i));
    g.fillStyle = rgba(col, a * 3.2 * tw * Math.sin(u * Math.PI));
    pp(g, px, py);
  }
}

/** Пятно света на полу: мягкий центр, чёткий край прожектора. */
function pool(g: G, x: number, y: number, r: number, col: RGBA, a: number, rim = 0): void {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, rgba(col, a));
  gr.addColorStop(0.75, rgba(col, a * 0.7));
  gr.addColorStop(0.95, rgba(col, a * 0.85));
  gr.addColorStop(1, rgba(col, 0));
  g.fillStyle = gr;
  g.beginPath();
  g.ellipse(x, y, r, r * 0.9, 0, 0, TAU);
  g.fill();
  if (rim > 0) {
    g.strokeStyle = rgba(col, rim);
    g.lineWidth = 1;
    g.beginPath();
    g.ellipse(x, y, r * 0.97, r * 0.87, 0, 0, TAU);
    g.stroke();
  }
}

// Готовые картинки этажа (звёзды по поворотам, месяц) — в кеше кадров.
type Img = HTMLCanvasElement;
const SPR = frameLRU<Img>(128);
function spr(
  key: string,
  w: number,
  h: number,
  draw: (p: Px) => void,
  line: RGBA | null = INK,
): Img {
  let s = SPR.get(key);
  if (!s) {
    const p = new Px(w, h);
    draw(p);
    if (line) p.outline(line);
    s = SPR.set(key, p.canvas());
  }
  return s;
}
/**
 * Картинка, нарисованная своим пером (нити, диски, пунктир) — один раз в кеш:
 * привязка пера на время рисования — к углу картинки, потом возвращается.
 */
function penSprite(key: string, w: number, h: number, draw: (g: G) => void): Img {
  const hit = SPR.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  const g = c.getContext('2d') as G;
  const keep = [OX, OY, QX, QY];
  OX = OY = QX = QY = 0;
  draw(g);
  g.globalAlpha = 1;
  [OX, OY, QX, QY] = keep;
  return SPR.set(key, c);
}
/** Картинка серединой в точку экрана — по сетке мира. */
function blit(g: G, img: Img, x: number, y: number, a = 1): void {
  if (a <= 0.012) return;
  g.globalAlpha = a > 1 ? 1 : a;
  g.drawImage(img, WX(x - img.width / 2) + QX, WY(y - img.height / 2) + QY);
}

/** Месяц из фанеры: серп, кромка тушью, лицо в профиль, свет сверху-слева. */
const moonSprite = () =>
  spr('moon', 23, 23, (p) => {
    const night = P.night[1];
    p.ell(11.5, 11.5, 9.5, 9.5, (x, y) =>
      x + y < 17 ? [244, 246, 255, 255] : [206, 216, 244, 255],
    );
    p.ell(16.5, 9, 8.4, 8.4, night);
    // Убрать «ночь» (вырез) — прозрачным.
    for (let y = 0; y < 23; y++)
      for (let x = 0; x < 23; x++) {
        const c = p.get(x, y);
        if (c[0] === night[0] && c[1] === night[1] && c[2] === night[2])
          p.data[(y * 23 + x) * 4 + 3] = 0;
      }
    p.set(5, 10, INK);
    p.rect(4, 14, 5, 14, INK);
    p.rect(3, 12, 5, 12, [190, 200, 236, 255]);
    p.set(9, 4, GOLD[2]);
    p.set(8, 19, GOLD[2]);
  });

/** Месяц на двух нитях, холодный луч к пятну на полу. */
function moon(g: G, to: To, time: number): void {
  const m = F13_FX.moon;
  if (m.r <= 0) return;
  const [x, y] = to(m.x, m.y);
  const mx = x + 8;
  const my = y - 78 + Math.sin(time * 0.9) * 1.2;
  const R = m.r * 16;
  lighter(g, () => {
    beam(g, mx, my + 4, x, y, R, MOON, 0.09, time, 7, 12);
    glow(g, mx, my, 20, MOON, 0.22);
  });
  // Нити (провис 0,1 качает их меньше пикселя) и фанера — одна картинка.
  const img = penSprite('moonT', 27, 98, (q) => {
    for (const dx of [-4, 4])
      threadPx(q, 13 + dx, 2, 13 + dx * 0.6, 64, {
        a: 0.7,
        sag: 0.1,
        seed: dx,
        time: 0,
        fade: true,
        glints: false,
      });
    q.drawImage(moonSprite(), 2, 61);
  });
  blit(g, img, mx, my - 23);
  g.globalAlpha = 1;
}

/** Пятно луны на полу и туман по его краю. */
function moonPool(g: G, to: To, time: number): void {
  const m = F13_FX.moon;
  if (m.r <= 0) return;
  const [x, y] = to(m.x, m.y);
  const R = m.r * 16;
  pool(g, x, y, R, MOON, 0.26, 0.45);
  // Туман: клочья ползут по краю круга.
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU + time * 0.12 * (i % 2 ? 1 : -1);
    const rr = R * (0.85 + 0.25 * Math.sin(time * 0.5 + i * 1.3));
    const fx = x + Math.cos(a) * rr;
    const fy = y + Math.sin(a) * rr * 0.9;
    glow(g, fx, fy, 9 + 3 * Math.sin(time + i), [200, 214, 240, 255], 0.13, 0.45);
  }
}

// ---------------------------------------------------------------------------
// «Буря»: тканевые волны с шестами по краям проёмов. Гребень с пеной и
// завитком, брызги летят вперёд и ложатся мокрыми пятнами, позади — мокрая
// палуба; проёмы — светлые дорожки ленты с самого набухания волны.
// ---------------------------------------------------------------------------

const ARENA_X0 = 12;
const ARENA_X1 = 52;
type Wave = (typeof F13_FX.waves)[number];
const inGap = (w: Wave, x: number) => w.gaps.some((gx) => Math.abs(x - gx) < w.gapW / 2);
/** Волна проходит за кораблём: над бортом полотно не рисуем. */
const behindShip = (w: Wave, x: number) => Math.abs(w.y - 10.9) < 1.3 && x > 25.8 && x < 38.2;
/** Где была волна в момент T её жизни (закон мозга). */
const waveYAt = (w: Wave, T: number) =>
  w.y -
  w.dir * BOSS.wave.speed * (Math.max(0, w.t - BOSS.wave.swell) - Math.max(0, T - BOSS.wave.swell));

/** Высота гребня: набухает, потом катится с перекатом полотна. */
function crestH(w: Wave, x: number, time: number): number {
  const swell = w.t < BOSS.wave.swell;
  const k = swell ? easeOut(w.t / BOSS.wave.swell) : 1;
  return (
    (3 + 13 * k) * (1 + 0.12 * Math.sin(x * 1.4 + time * 5 * w.dir)) +
    Math.sin(x * 0.6 - time * 3) * 1.2
  );
}

/** Столбцы арены (по 2 пикселя мира), что видны на экране. */
function waveCols(g: G, to: To): [number, number, number] {
  const [vw] = viewSize(g);
  const [ex0] = to(ARENA_X0, 0);
  const c0 = Math.max(0, Math.floor((-6 - ex0) / 2));
  const c1 = Math.min((ARENA_X1 - ARENA_X0) * 8, Math.ceil((vw + 6 - ex0) / 2));
  return [ex0, c0, c1];
}

/** Брызги: по 18 капель в такт, летят вперёд волны и падают (замкнутые формулы). */
function waveSpray(g: G, to: To, w: Wave, time: number, layer: Layer): void {
  if (w.t < BOSS.wave.swell + 0.1) return;
  const [ex0, c0, c1] = waveCols(g, to);
  const N = (ARENA_X1 - ARENA_X0) * 8;
  const slot0 = Math.floor(time * 8);
  const seed = Math.round(w.gaps[0] * 100) + (w.dir > 0 ? 7 : 3);
  for (let j = 0; j < 5; j++) {
    const s = slot0 - j;
    const age = time - s / 8;
    if (age > w.t - BOSS.wave.swell) continue;
    for (let q = 0; q < 18; q++) {
      const c = Math.floor(hash(seed, s, q) * N);
      if (c < c0 - 4 || c > c1 + 4) continue;
      const wx = ARENA_X0 + c / 8;
      if (inGap(w, wx) || behindShip(w, wx)) continue;
      const h1 = hash(s, q, seed + 1);
      const vy = w.dir * (18 + 30 * h1);
      const up = 26 + 40 * hash(s, q, seed + 2);
      const vx = (hash(s, q, seed + 3) - 0.5) * 24;
      const G0 = 300;
      const [, syB] = to(0, waveYAt(w, w.t - age));
      const z0 = crestH(w, wx, time - age);
      const tl = (up + Math.sqrt(up * up + 2 * G0 * z0)) / G0;
      const x = ex0 + c * 2 + vx * Math.min(age, tl);
      const y = syB + vy * Math.min(age, tl);
      if (age < tl) {
        if (layer !== 'above') continue;
        const z = z0 + up * age - 0.5 * G0 * age * age;
        if (ink(g, h1 > 0.5 ? C.foam : C.sea3, 0.95)) pp(g, x, y - z);
      } else if (layer === 'floor') {
        // Легла: мокрое пятно темнеет и сохнет.
        const dry = (age - tl) / 0.5;
        if (dry < 1 && ink(g, C.sea0, 0.5 * (1 - dry))) pp(g, x - 1, y, h1 > 0.6 ? 3 : 2, 1);
      }
    }
  }
}

function waveCrest(g: G, to: To, w: Wave, time: number): void {
  const [vw] = viewSize(g);
  const [, sy] = to(0, w.y);
  const [ex0, c0, c1] = waveCols(g, to);
  const front = w.dir > 0;
  const swell = w.t < BOSS.wave.swell;
  for (let c = c0; c < c1; c++) {
    const sx = ex0 + c * 2;
    const wx = ARENA_X0 + c / 8;
    if (inGap(w, wx + 1 / 16) || behindShip(w, wx)) continue;
    const h = Math.round(crestH(w, wx, time));
    const top = sy - h;
    // Складки полотна: светлые гребни ткани и тени между ними.
    const fold = Math.sin(wx * 2.6 + time * 2.2 * w.dir) + 0.4 * Math.sin(wx * 6.1 - time);
    const body = fold > 0.7 ? C.sea2 : fold < -0.6 ? C.sea0 : C.sea1;
    if (ink(g, C.ink, 0.88)) pp(g, sx, top - 1, 2, h + 2);
    if (front) {
      // Лицо волны к зрителю: тёмная подошва, светлеет к гребню, пена завитком.
      g.fillStyle = body;
      g.globalAlpha = 1;
      pp(g, sx, top, 2, h);
      g.fillStyle = fold > 0.7 ? C.sea3 : C.sea2;
      pp(g, sx, top, 2, Math.max(1, Math.round(h * 0.38)));
      g.fillStyle = C.sea0;
      pp(g, sx, sy - 2, 2, 2);
      const lace = Math.sin(wx * 9 + time * 7) > 0.2;
      g.fillStyle = C.foam;
      pp(g, sx, top, 2, lace ? 2 : 1);
      // Завиток: пена свисает с кромки вперёд.
      if (lace) pp(g, sx + (Math.sin(wx * 5) > 0 ? 1 : 0), top + 2, 1, swell ? 1 : 2);
    } else {
      // Спина волны: тёмная, пена только по кромке.
      g.fillStyle = C.sea0;
      g.globalAlpha = 1;
      pp(g, sx, top, 2, h);
      g.fillStyle = body;
      pp(g, sx, top, 2, Math.max(1, Math.round(h * 0.3)));
      g.fillStyle = C.sea3;
      pp(g, sx, top, 2, 1);
    }
  }
  waveSpray(g, to, w, time, 'above');
  // Края проёмов: шесты рабочих сцены держат полотно — видно заранее.
  for (const gx of w.gaps) {
    for (const s of [-1, 1]) {
      const wx = gx + (s * w.gapW) / 2;
      const [px] = to(wx, 0);
      if (px < -6 || px > vw + 6) continue;
      const h = Math.round(crestH(w, wx, time)) + 7;
      const p = reduced() ? 0.5 : 0.5 + 0.5 * Math.sin(time * 9 + s);
      if (ink(g, C.ink, 0.9)) pp(g, px - 1, sy - h - 1, 3, h + 3);
      if (ink(g, C.wood2, 1)) pp(g, px, sy - h, 1, h + 1);
      glowC(g, px, sy - h, 5 + 2 * p, WARM, swell ? 0.5 : 0.35);
      if (ink(g, C.gold3, 1)) pp(g, px - 1, sy - h - 1, 2, 2);
    }
  }
  g.globalAlpha = 1;
}

/** На полу: проёмы-дорожки впереди, тень гребня, мокрая палуба и пена позади. */
function waveFloor(g: G, to: To, w: Wave, time: number): void {
  const [vw] = viewSize(g);
  const [, sy] = to(0, w.y);
  const [ex0, c0, c1] = waveCols(g, to);
  const [, yTop] = to(0, 2);
  const [, yBot] = to(0, 23);
  const swell = w.t < BOSS.wave.swell;
  // Дорожки проёмов: от волны вперёд до края сцены, лентой по краям.
  const far = w.dir > 0 ? yBot : yTop;
  const off = reduced() ? 0 : -time * 24 * w.dir;
  for (const gx of w.gaps) {
    const [cx] = to(gx, 0);
    const half = (w.gapW / 2) * 16;
    if (cx + half < 0 || cx - half > vw) continue;
    const y0 = Math.min(sy, far);
    const y1 = Math.max(sy, far);
    if (ink(g, C.warm, swell ? 0.15 : 0.1)) pp(g, cx - half, y0, half * 2, y1 - y0);
    if (ink(g, C.gold2, swell ? 0.65 : 0.45)) {
      linePx(g, cx - half, y0, cx - half, y1, 6, off, 3);
      linePx(g, cx + half - 1, y0, cx + half - 1, y1, 6, off, 3);
    }
  }
  // Тень гребня, мокрая палуба (темнеет к волне) и кружево пены позади.
  for (let c = c0; c < c1; c++) {
    const sx = ex0 + c * 2;
    const wx = ARENA_X0 + c / 8;
    if (inGap(w, wx + 1 / 16)) continue;
    if (ink(g, C.shade, 0.4)) pp(g, sx, sy + (w.dir > 0 ? 0 : -3), 2, 4);
    if (swell) continue;
    if (ink(g, C.sea0, 0.22)) pp(g, sx, w.dir > 0 ? sy - 14 : sy + 2, 2, 12);
    for (let j = 0; j < 3; j++) {
      const back = sy - w.dir * (4 + j * 5);
      const on = hash(Math.floor(wx * 3), j, Math.floor(time * 6)) > 0.45 + j * 0.15;
      if (on && ink(g, C.foam, 0.45 - j * 0.12)) pp(g, sx, back, 2, 1);
    }
  }
  waveSpray(g, to, w, time, 'floor');
  g.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// «Звёздная ночь»: звёзды-маятники — дуга на полу, тень впереди, шлейф.
// Звезда — готовая картинка (12 поворотов на луч), летит по дуге со
// шлейфом из прошлых мест; тайминг — закон маятника мозга.
// ---------------------------------------------------------------------------

const STAR = BOSS.star;
const STAR_W = TAU / STAR.period;
const STAR_ROT = 12;
/** Угол маятника звезды i в миг T (тот же закон, что у мозга). */
const starTh = (i: number, T: number) => STAR.amp * Math.sin(STAR_W * T + (i * TAU) / 3);

/** Внутри пятиконечной звезды (r — луч, r·0,45 — впадина, поворот rot). */
function inStar(dx: number, dy: number, r: number, rot: number): boolean {
  let a = Math.atan2(dy, dx) + Math.PI / 2 - rot;
  a = mod(a, TAU / 5);
  const u = Math.abs(a - TAU / 10) / (TAU / 10);
  const rr = r * (0.45 + 0.55 * u * u * (0.6 + 0.4 * u));
  return dx * dx + dy * dy <= rr * rr;
}

type StarKind = 'gold' | 'ghost' | 'shade' | 'dim';
function starSprite(kind: StarKind, r: number, rs: number): Img {
  const S = 2 * Math.ceil(r) + 3;
  const c = S / 2;
  const rot = (mod(rs, STAR_ROT) * (TAU / 5)) / STAR_ROT;
  return spr(
    `st${kind}${r}:${mod(rs, STAR_ROT)}`,
    S,
    S,
    (p) => {
      for (let y = 0; y < S; y++)
        for (let x = 0; x < S; x++) {
          const dx = x + 0.5 - c;
          const dy = y + 0.5 - c;
          if (!inStar(dx, dy, r, rot)) continue;
          if (kind === 'shade') {
            p.set(x, y, [6, 4, 20, 255]);
            continue;
          }
          // Свет сверху-слева: грань к свету — светлее, к тени — темнее.
          const l = (-dx - dy) / (r * 1.2);
          const d = Math.hypot(dx, dy) / r;
          const pal = kind === 'dim' ? [GOLD[0], GOLD[1], GOLD[1], GOLD[2]] : GOLD;
          let col = l > 0.35 ? pal[3] : l > -0.2 ? pal[2] : pal[1];
          if (d < 0.22 && kind !== 'dim') col = pal[3];
          if (kind === 'ghost') col = l > 0 ? [255, 246, 200, 255] : GOLD[3];
          p.set(x, y, col);
        }
    },
    kind === 'shade' ? null : kind === 'ghost' ? null : INK,
  );
}
const starRs = (rot: number) => Math.round((rot / (TAU / 5)) * STAR_ROT);

/** Звезда сейчас, по закону маятника; null — если расходится с мозгом. */
function starNow(i: number, s: (typeof F13_FX.stars)[number]): number | null {
  const th = starTh(i, F13_FX.time);
  const x = s.px + Math.sin(th) * s.L;
  const y = s.py + Math.cos(th) * s.L;
  return Math.hypot(x - s.x, y - s.y) < 0.6 ? th : null;
}

/**
 * Дуга-след на полу мелом: низ дуги (там быстрее всего) — ярче и плотнее.
 * Пунктир бежит (10 шагов в секунду) — 12 фаз картинками, вместо 16 отрезков
 * в кадр на каждую звезду. `cy` — где на картинке ось маятника.
 */
function starArc(L: number, ph: number): { img: Img; cy: number } {
  const Lp = L * TS;
  const W = 2 * Math.ceil(Lp * Math.sin(STAR.amp)) + 8;
  const top = Math.floor(Lp * Math.cos(STAR.amp)) - 4;
  const H = Math.ceil(Lp) - top + 5;
  const cx = W / 2;
  const cy = -top;
  const img = penSprite(`arc|${L}|${ph}`, W, H, (g) => {
    const n = 16;
    for (let j = 0; j < n; j++) {
      const t0 = -STAR.amp + (2 * STAR.amp * j) / n;
      const t1 = t0 + (2 * STAR.amp) / n;
      const fast = 1 - Math.min(1, Math.abs((t0 + t1) / 2) / STAR.amp);
      if (!ink(g, fast > 0.6 ? C.gold3 : C.gold2, 0.18 + 0.4 * fast * fast)) continue;
      linePx(
        g,
        cx + Math.sin(t0) * Lp,
        cy + Math.cos(t0) * Lp,
        cx + Math.sin(t1) * Lp,
        cy + Math.cos(t1) * Lp,
        fast > 0.6 ? 3 : 4,
        -ph,
        fast > 0.6 ? 2 : 1,
      );
    }
  });
  return { img, cy };
}

function starFloor(g: G, to: To, time: number): void {
  F13_FX.stars.forEach((s, i) => {
    if (s.cut) return;
    const at = (th: number): [number, number] =>
      to(s.px + Math.sin(th) * s.L, s.py + Math.cos(th) * s.L);
    const [ppx, ppy] = to(s.px, s.py);
    const arc = starArc(s.L, reduced() ? 0 : mod(Math.floor(time * 10), 12));
    blit(g, arc.img, ppx, ppy - arc.cy + arc.img.height / 2);
    const th = starNow(i, s);
    const [x, y] = to(s.x, s.y);
    // Своя тень под звездой и круг, где она бьёт.
    if (ink(g, C.shade, 0.4)) fEll(g, x, y + 1, 6, 2.2);
    if (ink(g, C.gold2, 0.3)) arcPx(g, x, y, STAR.r * 16, 0, TAU, 4, 0, 2);
    if (th === null) return;
    // Тень бежит впереди: где звезда будет через 0,3 и 0,6 с.
    for (const [ahead, al] of [
      [0.3, 0.45],
      [0.6, 0.24],
    ] as const) {
      const [fx, fy] = at(starTh(i, F13_FX.time + ahead));
      blit(g, starSprite('shade', 6.5, 0), fx, fy, al);
    }
  });
  g.globalAlpha = 1;
}

/** Когда звезда сорвалась (время сцены) — лежачую рисуем после падения. */
const STAR_CUT = [-1, -1, -1, -1, -1, -1];
function drawStars(g: G, to: To, time: number): void {
  F13_FX.stars.forEach((s, i) => {
    const [px, py] = to(s.px, s.py);
    const [x, y] = to(s.x, s.y);
    const top = py - 60;
    if (!s.cut) STAR_CUT[i] = -1;
    else if (STAR_CUT[i] < 0) STAR_CUT[i] = F13_FX.time;
    if (s.cut) {
      // Срезанная: лежит на полу, тускло мерцает (падает — `f13_starfall`);
      // обрывки висят сверху.
      if (F13_FX.time - STAR_CUT[i] >= STAR_FALL) blit(g, starSprite('dim', 6, 2), x, y - 2, 0.9);
      stubPx(g, px - 3, top, 10, Math.sin(time * 2 + i) * 0.3, 0.7);
      stubPx(g, px + 3, top, 8, Math.sin(time * 2.3 + i) * 0.3, 0.7);
      return;
    }
    const sy = y - 14;
    const th = starNow(i, s);
    const v =
      th === null
        ? 0
        : Math.abs(STAR.amp * STAR_W * Math.cos(Math.asin(k01(Math.abs(th) / STAR.amp)))) * s.L;
    const fast = k01((v - 5) / 7);
    // Летит: шлейф прошлых мест и полосы скорости по дуге.
    if (th !== null && fast > 0) {
      for (let j = 6; j >= 1; j--) {
        const tj = starTh(i, F13_FX.time - j * 0.028);
        const [gx, gy] = to(s.px + Math.sin(tj) * s.L, s.py + Math.cos(tj) * s.L);
        blit(
          g,
          starSprite('ghost', Math.round(7.4 - j * 0.4), starRs(time * 3)),
          gx,
          gy - 14,
          fast * 0.34 * (1 - j / 7),
        );
      }
      const pts: number[] = [];
      for (let j = 0; j <= 6; j++) {
        const tj = starTh(i, F13_FX.time - j * 0.03);
        const [gx, gy] = to(s.px + Math.sin(tj) * s.L, s.py + Math.cos(tj) * s.L);
        pts.push(gx, gy - 14);
      }
      for (const o of [-4, 0, 4]) {
        if (!ink(g, o ? C.gold3 : C.white, fast * (o ? 0.45 : 0.7))) continue;
        polyPx(
          g,
          pts.map((v2, q) => (q % 2 ? v2 + o : v2)),
          0,
          o ? 0.7 : 1,
        );
      }
    }
    // Две нити: к звезде от балки — обе режутся.
    threadPx(g, px - 3, top, x - 2, sy - 7, {
      a: 0.9,
      sag: 0.25,
      seed: s.px * 3,
      time,
      thick: false,
      flat: true,
    });
    threadPx(g, px + 3, top, x + 2, sy - 7, {
      a: 0.9,
      sag: 0.25,
      seed: s.px * 3 + 1,
      time,
      flat: true,
    });
    glowC(g, x, sy, 15 + 3 * fast, [255, 236, 160, 255], 0.36 + 0.2 * fast);
    const rot = time * (1.2 + 5 * fast) + s.px;
    blit(g, starSprite('gold', 9, starRs(rot)), x, sy);
    // Мерцание: блик в верхнем левом луче.
    const tw = reduced() ? 0.8 : 0.5 + 0.5 * Math.sin(time * 6 + i * 2);
    sparkPx(g, x - 3, sy - 4, C.white, 0.5 + 0.5 * tw, tw > 0.8);
  });
  g.globalAlpha = 1;
}

/** Облака из ваты на нитях над северным краем сцены (акт III). */
const CLOUD_PUFFS = [
  [-9, 1, 6],
  [-3, -3, 7],
  [4, -2, 6.5],
  [10, 1, 5],
  [1, 2, 6],
];
/**
 * Облако с двумя нитями — одна картинка в кеше (нити без провиса и бликов,
 * от времени не зависят): прямо в кадр это было ~4 тыс. `fillRect`.
 */
function cloudSprite(): Img {
  return penSprite('cloud', 40, 74, (g) => {
    const x = 20;
    const y = 64;
    for (const [dx, seed] of [
      [-6, 0],
      [7, 9],
    ])
      threadPx(g, x + dx, y - 60, x + dx, y - 5, {
        a: 0.5,
        sag: 0,
        seed,
        time: 0,
        fade: true,
        glints: false,
      });
    if (ink(g, C.ink, 0.6)) for (const [dx, dy, r] of CLOUD_PUFFS) fDisc(g, x + dx, y + dy, r + 1);
    if (ink(g, '#9096c4', 1)) for (const [dx, dy, r] of CLOUD_PUFFS) fDisc(g, x + dx, y + dy, r);
    if (ink(g, '#e2e4f6', 1))
      for (const [dx, dy, r] of CLOUD_PUFFS) fDisc(g, x + dx - 1, y + dy - 1.5, r * 0.7);
  });
}

function cottonClouds(g: G, to: To, time: number): void {
  const [vw] = viewSize(g);
  const img = cloudSprite();
  for (let i = 0; i < 5; i++) {
    const wx = ARENA_X0 + 4 + i * 8 + Math.sin(time * 0.15 + i * 2) * 1.2;
    const [x, y0] = to(wx, 2.6 + (i % 2) * 0.6);
    if (x < -30 || x > vw + 30) continue;
    const y = y0 - 34 + Math.sin(time * 0.7 + i) * 1.5;
    // Середина картинки — на (x, y − 27): облако в её низу, нити уходят вверх.
    blit(g, img, x, y - 27);
  }
  g.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// Метки ударов Кукловода и исполина (`vNoTele`): разметка сцены.
// «Куда» — весь контур золотым пунктиром клейкой ленты с первого кадра и
// тёплая заливка; «когда» — сплошная лента замыкается по контуру ровно к
// удару (конус — от боков к середине дуги, полоса — от основания к острию),
// свет рампы бежит от тела к кромке. Последние 0,2 с — белое золото,
// двойной пульс и кромка, сходящаяся к границе удара. Пол — под мобами,
// поверх темноты — только тонкие яркие нити от ваги и блики.
// ---------------------------------------------------------------------------

const WARN: Record<string, number> = {
  f13_cut1: BOSS.cone.warn,
  f13_cut2: BOSS.thrust.warn,
  f13_snare: BOSS.snare.aim,
  f13_needle: BOSS.needle.aim,
  f13_lance: BOSS.lance.aim,
  f13_shield: BOSS.shield.aim,
  f13_charge_aim: BOSS.charge.aim,
};

/** Последние 0,2 с перед уроном: 0 — ещё рано, 1 — удар. */
const SIG = 0.2;
const lastK = (m: Mob) => k01(1 - ((WARN[m.mode] ?? 0.6) - m.t) / SIG);
/** Двойной пульс сигнала (без мигания — ровный, если просили меньше движения). */
const pulse = (f: number) => (f <= 0 ? 0 : reduced() ? 0.6 : 0.5 + 0.5 * Math.cos(f * Math.PI * 4));

type Layer = 'floor' | 'above';

interface Tone {
  /** Свет на полу. */
  fill: string;
  /** Лента разметки и её замыкание. */
  edge: string;
  band: string;
  /** Нить сверху. */
  thread: string;
}
const T_LORD: Tone = { fill: C.warm, edge: C.gold2, band: C.gold3, thread: C.gold2 };
const T_NEEDLE: Tone = { fill: C.cold, edge: C.silver2, band: C.silver3, thread: C.gold2 };
const T_LANCE: Tone = { fill: C.roseL, edge: C.gold2, band: C.gold3, thread: C.gold2 };
const T_SHIELD: Tone = { fill: C.cold, edge: C.gold2, band: C.gold3, thread: C.gold2 };

/** Крест клейкой ленты (метка помрежа на сцене): «встань сюда — получишь». */
function tapeX(g: G, x: number, y: number, a: number, col: string, s = 2): void {
  if (!ink(g, C.shade, a * 0.4)) return;
  for (let i = -s; i <= s; i++) {
    pp(g, x + i + 1, y + i + 1);
    pp(g, x + i + 1, y - i + 1);
  }
  ink(g, col, a);
  for (let i = -s; i <= s; i++) {
    pp(g, x + i, y + i);
    pp(g, x + i, y - i);
  }
}

/** Конус: свет рампы от тела, лента замыкается от боков к середине дуги. */
function markCone(
  g: G,
  layer: Layer,
  X: number,
  Y: number,
  hand: [number, number] | null,
  R: number,
  a0: number,
  arc: number,
  k: number,
  f: number,
  time: number,
  T: Tone,
): void {
  const l = a0 - arc / 2;
  const r = a0 + arc / 2;
  const p = pulse(f);
  if (layer === 'floor') {
    // Свет на досках: ровный слой, у кромки гуще; фронт рампы бежит наружу.
    if (ink(g, T.fill, 0.15 + 0.12 * k + 0.14 * f)) fSector(g, X, Y, 3, R, l, r);
    if (ink(g, T.fill, 0.1 + 0.1 * k)) fSector(g, X, Y, R - 3, R, l, r);
    const fr = 3 + (R - 3) * easeIn(k);
    if (ink(g, T.fill, 0.24 + 0.16 * k)) fSector(g, X, Y, Math.max(3, fr - 4), fr, l, r);
    // «Куда»: пунктир ленты по всему контуру с первого кадра.
    const off = reduced() ? 0 : -time * 8;
    if (ink(g, C.shade, 0.35)) arcPx(g, X + 1, Y + 1, R, l, r, 5, off, 3);
    if (ink(g, T.edge, 0.55 + 0.2 * k)) {
      arcPx(g, X, Y, R, l, r, 5, off, 3);
      for (const e of [l, r])
        linePx(
          g,
          X + Math.cos(e) * 4,
          Y + Math.sin(e) * 4,
          X + Math.cos(e) * R,
          Y + Math.sin(e) * R,
          5,
          off,
          3,
        );
    }
    // «Когда»: сплошная лента — бока от тела наружу, дуга от краёв к середине.
    const half = (arc / 2) * k;
    const col = f > 0 ? (p > 0.5 ? C.white : C.cream) : T.band;
    if (ink(g, col, 0.85 + 0.15 * f)) {
      arcPx(g, X, Y, R, l, l + half);
      arcPx(g, X, Y, R, r - half, r);
      for (const e of [l, r])
        linePx(
          g,
          X + Math.cos(e) * 4,
          Y + Math.sin(e) * 4,
          X + Math.cos(e) * (4 + (R - 4) * k),
          Y + Math.sin(e) * (4 + (R - 4) * k),
        );
    }
    // Сигнал: кромка сходится к границе удара.
    if (f > 0 && ink(g, C.white, 0.35 + 0.5 * f)) arcPx(g, X, Y, R + 5 * (1 - f), l, r);
    g.globalAlpha = 1;
    return;
  }
  // Поверх темноты: искры на сходящихся концах ленты, нити от ваги к кромке.
  const half = (arc / 2) * k;
  for (const e of [l + half, r - half])
    sparkPx(
      g,
      X + Math.cos(e) * R,
      Y + Math.sin(e) * R,
      f > 0 ? C.white : C.gold3,
      0.5 + 0.5 * k,
      f > 0,
    );
  if (hand) {
    const n = 3;
    for (let i = 0; i < n; i++) {
      const a = l + (arc * i) / (n - 1);
      threadPx(g, hand[0], hand[1], X + Math.cos(a) * R, Y + Math.sin(a) * R, {
        a: 0.25 + 0.4 * k + 0.3 * f,
        sag: 1.6 * (1 - ease(k)),
        buzz: f * 0.9,
        lit: k * 0.6 + f * 0.4,
        seed: i * 2.3,
        time,
        col: T.thread,
        glints: i === 1,
      });
    }
  }
  if (f > 0) {
    lighter(g, () => {
      for (const e of [l, r])
        glow(g, X + Math.cos(e) * R, Y + Math.sin(e) * R, 5, WARM, 0.35 * f * (0.6 + 0.4 * p));
    });
  }
  g.globalAlpha = 1;
}

type LineKind = 'thrust' | 'snare' | 'needle' | 'lance' | 'charge';

/** Полоса: свет рампы к острию, лента по краям от основания, крест на острие. */
function markLine(
  g: G,
  layer: Layer,
  X: number,
  Y: number,
  hand: [number, number] | null,
  L: number,
  W: number,
  a0: number,
  k: number,
  f: number,
  time: number,
  T: Tone,
  kind: LineKind,
): void {
  const ux = Math.cos(a0);
  const uy = Math.sin(a0);
  const at = (u: number, v: number): [number, number] => [X + ux * u - uy * v, Y + uy * u + ux * v];
  const p = pulse(f);
  const u0 = kind === 'needle' ? 6 : 3;
  const [ex, ey] = at(L, 0);
  if (layer === 'floor') {
    const narrow = W < 4;
    if (ink(g, T.fill, (narrow ? 0.18 : 0.15) + 0.12 * k + 0.14 * f))
      fLane(g, X, Y, a0, u0, L, -W, W);
    // Фронт рампы: полоса света бежит к острию и упирается в него к удару.
    const uf = u0 + (L - u0) * easeIn(k);
    if (ink(g, T.fill, 0.24 + 0.16 * k)) fLane(g, X, Y, a0, Math.max(u0, uf - 6), uf, -W, W);
    const off = reduced() ? 0 : -time * 9;
    // «Куда»: пунктир по краям (тонкая полоса — одной лентой по оси).
    const edges = narrow ? [0] : [-W, W];
    if (ink(g, C.shade, 0.32))
      for (const v of edges) {
        const [a1, b1] = at(u0, v);
        const [a2, b2] = at(L, v);
        linePx(g, a1 + 1, b1 + 1, a2 + 1, b2 + 1, 5, off, 3);
      }
    if (ink(g, T.edge, 0.55 + 0.2 * k)) {
      for (const v of edges) {
        const [a1, b1] = at(u0, v);
        const [a2, b2] = at(L, v);
        linePx(g, a1, b1, a2, b2, 5, off, 3);
      }
      if (!narrow) {
        const [c1, d1] = at(L, -W);
        const [c2, d2] = at(L, W);
        linePx(g, c1, d1, c2, d2, 5, off, 3);
      }
    }
    // «Когда»: лента сплошная от основания к острию.
    const col = f > 0 ? (p > 0.5 ? C.white : C.cream) : T.band;
    const uk = u0 + (L - u0) * k;
    if (ink(g, col, 0.85 + 0.15 * f)) {
      for (const v of edges) {
        const [a1, b1] = at(u0, v);
        const [a2, b2] = at(uk, v);
        linePx(g, a1, b1, a2, b2);
      }
      if (k >= 1 && !narrow) {
        const [c1, d1] = at(L, -W);
        const [c2, d2] = at(L, W);
        linePx(g, c1, d1, c2, d2);
      }
    }
    // Таран: шевроны по полосе загораются один за другим.
    if (kind === 'charge') {
      const n = Math.max(2, Math.floor((L - u0) / 14));
      for (let i = 0; i < n; i++) {
        const u = u0 + 8 + ((L - u0 - 10) * i) / Math.max(1, n - 1);
        const on = k * n > i + 0.3;
        if (!ink(g, on ? (f > 0 ? C.white : T.band) : T.edge, on ? 0.85 : 0.35)) continue;
        const w = Math.min(W - 3, 7);
        const [a1, b1] = at(u - 4, -w);
        const [a2, b2] = at(u, 0);
        const [a3, b3] = at(u - 4, w);
        linePx(g, a1, b1, a2, b2);
        linePx(g, a2, b2, a3, b3);
      }
    }
    // Крест ленты на острие — куда придёт конец удара.
    if (kind !== 'needle')
      tapeX(
        g,
        ex,
        ey,
        0.6 + 0.4 * k,
        f > 0 ? C.white : T.band,
        kind === 'lance' || kind === 'charge' ? 3 : 2,
      );
    // Сигнал: поперечная черта сходится к острию.
    if (f > 0 && ink(g, C.white, 0.35 + 0.5 * f)) {
      const d = 6 * (1 - f);
      const [c1, d1] = at(L + d, -W - 2);
      const [c2, d2] = at(L + d, W + 2);
      linePx(g, c1, d1, c2, d2);
    }
    g.globalAlpha = 1;
    return;
  }
  // Поверх темноты.
  if (hand && kind !== 'lance' && kind !== 'charge') {
    // Нить от ваги к острию: натягивается, по ней бежит бусина к цели.
    const tip = at(u0 + (L - u0) * (kind === 'snare' ? k : 1), 0);
    threadPx(g, hand[0], hand[1], tip[0], tip[1], {
      a: 0.3 + 0.4 * k + 0.3 * f,
      sag: (kind === 'snare' ? 2.2 : 1.4) * (1 - ease(k)),
      buzz: f * 0.7,
      lit: k * 0.6 + f * 0.4,
      seed: 1.7,
      time,
      col: T.thread,
      glints: false,
    });
    const bk = easeOut(k);
    const bx = lerp(hand[0], tip[0], bk);
    const by = lerp(hand[1], tip[1], bk);
    sparkPx(g, bx, by, f > 0 ? C.white : T.band, 0.7 + 0.3 * k, f > 0);
  }
  if (kind === 'lance' || kind === 'charge') {
    // Блик по оси копья к острию — в последние 0,2 с.
    if (f > 0) {
      const u = u0 + (L - u0) * easeOut(f);
      const [bx, by] = at(u, 0);
      sparkPx(g, bx, by, C.white, 0.9, true);
      lighter(g, () => glow(g, ex, ey, 6, WARM, 0.35 * f * (0.6 + 0.4 * p)));
    }
  } else if (f > 0) sparkPx(g, ex, ey, C.white, 0.5 + 0.5 * p, true);
  g.globalAlpha = 1;
}

/** Аркан над рукой: петля крутится, к броску быстрее и шире. */
function lassoSpin(g: G, hx0: number, hy0: number, k: number, f: number, t: number): void {
  const cx = hx0;
  const cy = hy0 - 7;
  const ph = t * (9 + 22 * k * k);
  const rx = 7 + 2 * k;
  const ry = 2.6;
  const at = (a: number): [number, number] => [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry];
  const L = TAU * rx;
  // Петля: дальняя половина темнее (за рукой), ближняя — ярче.
  if (ink(g, C.shade, 0.5))
    curvePx(
      g,
      (s) => {
        const [x, y] = at(s * TAU);
        return [x, y + 1];
      },
      L,
    );
  if (ink(g, C.gold0, 0.9)) curvePx(g, (s) => at(Math.PI + s * Math.PI), L / 2);
  if (ink(g, f > 0 ? C.cream : C.gold2, 0.95)) curvePx(g, (s) => at(s * Math.PI), L / 2);
  // Верёвка от руки к узлу и сам узел.
  const [kx, ky] = at(ph);
  if (ink(g, C.gold1, 0.9)) linePx(g, hx0, hy0, kx, ky);
  sparkPx(g, kx, ky, f > 0 ? C.white : C.gold3, 0.9, f > 0);
  // Свист: точки позади узла.
  for (let j = 1; j <= 3; j++) {
    const [sx, sy] = at(ph - j * 0.35);
    if (ink(g, C.gold3, (0.3 + 0.4 * k) * (1 - j / 4))) pp(g, sx, sy);
  }
  g.globalAlpha = 1;
}

/**
 * Таран на бегу: метка гаснет с первым шагом, а увернуться ещё надо — остаток
 * пути (`run − t`) лежит перед исполином шевронами, стена его обрезает.
 */
function chargeAhead(g: G, m: Mob, to: To, time: number): void {
  const sim = paintSim();
  const left = (BOSS.charge.run - m.t) * BOSS.charge.speed;
  if (left <= 0.3) return;
  const ca = Math.cos(m.dir);
  const sa = Math.sin(m.dir);
  let len = 0.6;
  while (len < left) {
    const nx = len + 0.5;
    if (sim && solidTile(sim, Math.floor(m.x + ca * nx), Math.floor(m.y + sa * nx))) break;
    len = Math.min(left, nx);
  }
  const [x0, y0] = to(m.x + ca * 0.6, m.y + sa * 0.6);
  const L = (len - 0.6) * TS;
  const w = BOSS.charge.w * TS * 0.5;
  const a = 0.75 * (1 - k01((m.t - BOSS.charge.run + 0.15) / 0.15));
  for (const s of [-1, 1])
    if (ink(g, T_LANCE.edge, a * 0.8))
      linePx(
        g,
        x0 - sa * w * s,
        y0 + ca * w * s,
        x0 - sa * w * s + ca * L,
        y0 + ca * w * s + sa * L,
        4,
        -time * 40,
        2,
      );
  // Шевроны бегут вперёд быстрее исполина.
  const ph = mod(time * 90, 14);
  for (let u = ph; u < L - 2; u += 14) {
    if (!ink(g, T_LANCE.band, a * (1 - u / (L + 8)))) continue;
    const cx = x0 + ca * u;
    const cy = y0 + sa * u;
    const q = Math.min(w - 2, 6);
    linePx(g, cx - ca * 4 - sa * q, cy - sa * 4 + ca * q, cx, cy);
    linePx(g, cx, cy, cx - ca * 4 + sa * q, cy - sa * 4 - ca * q);
  }
  g.globalAlpha = 1;
}

/** Метки Кукловода и исполина по `m.tele` (обе в мозге — `vNoTele`). */
function bossMarks(g: G, layer: Layer, to: To, time: number): void {
  for (const m of F13_FX.mobs) {
    if (layer === 'floor' && m.kind === 'f13_giant' && m.mode === 'f13_charge')
      chargeAhead(g, m, to, time);
    const t = m.tele;
    if (!t || (m.kind !== 'f13boss' && m.kind !== 'f13_giant')) continue;
    const [ox, oy] = to(t.x ?? m.x, t.y ?? m.y);
    const k = k01(t.k ?? 0);
    const f = lastK(m);
    const a0 = t.ang ?? 0;
    const R = t.r * TS;
    const W = (t.w ?? 0.4) * TS;
    let hand: [number, number] | null = null;
    if (m.kind === 'f13boss') {
      const [dx, dy] = lordVagaPx(m, time);
      hand = [ox + dx, oy + dy];
    }
    switch (m.mode) {
      case 'f13_cut1':
        markCone(g, layer, ox, oy, hand, R, a0, t.arc ?? 2, k, f, time, T_LORD);
        break;
      case 'f13_cut2':
        markLine(g, layer, ox, oy, hand, R, W, a0, k, f, time, T_LORD, 'thrust');
        break;
      case 'f13_snare':
        markLine(g, layer, ox, oy, hand, R, W, a0, k, f, time, T_LORD, 'snare');
        if (layer === 'above' && hand) lassoSpin(g, hand[0], hand[1], k, f, m.t);
        break;
      case 'f13_needle':
        // Три иглы веером (разброс мозга 0,24 — по ±0,12): каждой своя серебряная нить.
        for (const d of [-0.12, 0, 0.12])
          markLine(
            g,
            layer,
            ox,
            oy,
            d === 0 ? hand : null,
            R,
            2.4,
            a0 + d,
            k,
            f,
            time,
            T_NEEDLE,
            'needle',
          );
        if (layer === 'above' && hand)
          // Три иглы в пальцах веером — блестят сильнее к броску.
          for (const d of [-0.35, 0, 0.35]) {
            const a = a0 + d;
            const x0 = hand[0] + Math.cos(a) * 2;
            const y0 = hand[1] + Math.sin(a) * 2;
            if (ink(g, C.shade, 0.5))
              linePx(g, x0 + 1, y0 + 1, x0 + Math.cos(a) * 6 + 1, y0 + Math.sin(a) * 6 + 1);
            if (ink(g, C.silver3, 0.95))
              linePx(g, x0, y0, x0 + Math.cos(a) * 6, y0 + Math.sin(a) * 6);
            sparkPx(
              g,
              x0 + Math.cos(a) * 6,
              y0 + Math.sin(a) * 6,
              C.white,
              0.4 + 0.6 * Math.max(k * 0.6, f),
              f > 0,
            );
          }
        break;
      case 'f13_lance':
        markLine(g, layer, ox, oy, null, R, W, a0, k, f, time, T_LANCE, 'lance');
        break;
      case 'f13_charge_aim':
        markLine(g, layer, ox, oy, null, R, W, a0, k, f, time, T_LANCE, 'charge');
        break;
      case 'f13_shield':
        markCone(g, layer, ox, oy, null, R, a0, t.arc ?? 1.7, k, f, time, T_SHIELD);
        break;
      default:
        if (t.shape === 'cone')
          markCone(g, layer, ox, oy, hand, R, a0, t.arc ?? 1, k, f, time, T_LORD);
        else if (t.shape === 'line')
          markLine(g, layer, ox, oy, hand, R, W, a0, k, f, time, T_LORD, 'thrust');
    }
  }
  g.globalAlpha = 1;
}

/** Игла вылетает из руки (над полом) и за 0,25 с опускается к полу. */
function needleLift(s: Shot): number {
  return 26 * (1 - easeOut(s.age / 0.25));
}

/** Иглы в полёте: золотая нитка хвостом вьётся за иглой, блик острия. */
function needleTrails(g: G, to: To, time: number): void {
  const sim = paintSim();
  if (!sim) return;
  for (const s of sim.shots) {
    if (s.art !== 'f13_needle') continue;
    const [x, y] = to(s.x, s.y);
    const v = Math.hypot(s.vx, s.vy) || 1;
    const ux = s.vx / v;
    const uy = s.vy / v;
    const lift = needleLift(s);
    const hy = y - 6 - lift;
    const at = (q: number): [number, number] => {
      const d = 4 + q * 18;
      const wv = Math.sin(time * 14 - q * 5.4 + s.id) * q * 1.1;
      return [x - ux * d - uy * wv, hy - uy * d + ux * wv + Math.min(lift, q * 12) * 0.3];
    };
    if (ink(g, C.shade, 0.35))
      curvePx(
        g,
        (q) => {
          const [a, b] = at(q);
          return [a + 1, b + 1];
        },
        22,
      );
    if (ink(g, C.gold2, 0.8)) curvePx(g, at, 22, 0, 0.6);
    if (ink(g, C.gold1, 0.55)) curvePx(g, at, 22, 0.6, 1);
    sparkPx(
      g,
      x + ux * 5,
      hy + uy * 5,
      C.white,
      reduced() ? 0.8 : 0.6 + 0.4 * Math.sin(time * 40 + s.id),
    );
  }
  g.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// Декорации живут (клетки — в кеше, живое — здесь, на полу под мобами):
// тканевое море «Бури» перекатывает блики по гребням полотнищ, нарисованные
// краской звёзды «Ночи» мерцают. Формулы — те же, что у клеток.
// ---------------------------------------------------------------------------

/** Видимые клетки арены вокруг зоны (мир), без лишнего за краем экрана. */
function arenaCells(
  g: G,
  z: { x: number; y: number },
  px: number,
  py: number,
): [number, number, number, number] {
  const [vw, vh] = viewSize(g);
  const x0 = Math.max(ARENA_X0, Math.floor(z.x - px / TS) - 1);
  const x1 = Math.min(ARENA_X1, Math.ceil(z.x + (vw - px) / TS) + 1);
  const y0 = Math.max(2, Math.floor(z.y - py / TS) - 1);
  const y1 = Math.min(24, Math.ceil(z.y + (vh - py) / TS) + 1);
  return [x0, x1, y0, y1];
}

/** Акт II: блики бегут по гребням полотнищ моря (шов — каждые 8 точек). */
function seaGlints(g: G, z: { x: number; y: number }, px: number, py: number, time: number): void {
  const [x0, x1, y0, y1] = arenaCells(g, z, px, py);
  const ox = px - z.x * TS;
  const oy = py - z.y * TS;
  const sim = paintSim();
  for (let strip = y0 * 2; strip < y1 * 2; strip++) {
    const Ys = strip * 8;
    const ph = hash(strip, 0, 71) * TAU;
    const dir = strip % 2 ? 1 : -1;
    for (let j = 0; j < 3; j++) {
      // Блик скользит вдоль полотнища; у каждого свой ход и период.
      const span = 56;
      const base = Math.floor((x0 * TS) / span) * span;
      for (let X0 = base; X0 < x1 * TS; X0 += span) {
        const X = X0 + mod(hash(strip, j, X0) * span + time * (10 + 6 * j) * dir, span);
        const wx = X / TS;
        const wy = Ys / TS;
        if (sim && solidTile(sim, Math.floor(wx), Math.floor(wy))) continue;
        if (wx > SHIP_BOX[0] && wx < SHIP_BOX[1] && wy > SHIP_BOX[2] && wy < SHIP_BOX[3]) continue;
        const crest = 2.6 + Math.sin(X * 0.17 + ph) * 1.5 + Math.sin(X * 0.06 + ph * 2) * 0.7;
        const a = 0.55 * Math.sin(mod(time * 0.7 + hash(strip, j, 5), 1) * Math.PI);
        if (!ink(g, j ? C.sea3 : C.foam, a)) continue;
        pp(g, ox + X, oy + Ys + Math.round(crest), j ? 3 : 2, 1);
      }
    }
  }
  g.globalAlpha = 1;
}
/** Где на сцене корабль (палуба — не море): x0, x1, y0, y1 в клетках. */
const SHIP_BOX = [24.6, 39.4, 9.2, 12.2];

/** Акт III: звёзды краской на досках мерцают (те же места, что у клетки). */
function nightTwinkle(
  g: G,
  z: { x: number; y: number },
  px: number,
  py: number,
  time: number,
): void {
  const [x0, x1, y0, y1] = arenaCells(g, z, px, py);
  const ox = px - z.x * TS;
  const oy = py - z.y * TS;
  const sim = paintSim();
  for (let wy = y0; wy < y1; wy++)
    for (let wx = x0; wx < x1; wx++) {
      const n = hash(wx, wy, 41);
      if (n >= 0.3 || (sim && solidTile(sim, wx, wy))) continue;
      const tw = Math.sin(time * (1.3 + n * 4) + hash(wx, wy, 45) * TAU);
      if (tw < 0.55) continue;
      const x = ox + wx * TS + 2 + Math.floor(hash(wx, wy, 42) * 12);
      const y = oy + wy * TS + 2 + Math.floor(hash(wx, wy, 43) * 12);
      sparkPx(g, x, y, tw > 0.9 ? C.white : '#e8d890', (tw - 0.55) / 0.45, n < 0.1 && tw > 0.92);
    }
  g.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// Зоны-режиссёры.
// ---------------------------------------------------------------------------

registerZonePainter('f13_strings', (g, z, px, py, S, time) => {
  const to = viewOf(z, px, py, S);
  pinZ(g, z, px, py);
  // Столбы света софитов — сложением, с пылью в луче.
  lighter(g, () => {
    for (const s of F13_FX.spots) {
      if (!s.on || Math.abs(s.x - z.x) > 18 || Math.abs(s.y - z.y) > 14) continue;
      const [lx, ly] = to(s.lx, s.ly);
      const [x, y] = to(s.x, s.y);
      const R = SPOT.r * 16;
      beam(g, lx, ly - 13, x, y, R, WARM, 0.13, time, s.lx * 7 + s.ly);
      // Пятно — поверх темноты: «где луч — там тебя видят», край чёткий.
      pool(g, x, y, R, WARM, 0.16 + 0.03 * Math.sin(time * 3 + s.x), s.turned ? 0.5 : 0.32);
    }
  });
  const act = F13_FX.act;
  if (act === 2) {
    cottonClouds(g, to, time);
    if (F13_FX.moon.r > 0) moon(g, to, time);
  }
  if (act === 1) for (const w of F13_FX.waves) waveCrest(g, to, w, time);
  if (act === 2) drawStars(g, to, time);
  pinZ(g, z, px, py);
  drawStrings(g, to, z.x, z.y, time);
  lordFlies(g, to, time);
  bossMarks(g, 'above', to, time);
  needleTrails(g, to, time);
  g.globalAlpha = 1;
  return true;
});

registerZonePainter('f13_stage', (g, z, px, py, S, time) => {
  const to = viewOf(z, px, py, S);
  pinZ(g, z, px, py);
  for (const s of F13_FX.spots) {
    if (!s.on || Math.abs(s.x - z.x) > 18 || Math.abs(s.y - z.y) > 14) continue;
    const [x, y] = to(s.x, s.y);
    pool(g, x, y, SPOT.r * 16, WARM, 0.22);
  }
  const act = F13_FX.act;
  if (act === 1) seaGlints(g, z, px, py, time);
  if (act === 2) nightTwinkle(g, z, px, py, time);
  if (act === 2) {
    moonPool(g, to, time);
    starFloor(g, to, time);
  }
  if (act === 1) for (const w of F13_FX.waves) waveFloor(g, to, w, time);
  pinZ(g, z, px, py);
  stringShadows(g, to, z.x, z.y, time);
  bossMarks(g, 'floor', to, time);
  g.globalAlpha = 1;
  return true;
});

// ---------------------------------------------------------------------------
// Короткие зоны-картинки.
// ---------------------------------------------------------------------------

/** Ближайшая кукла на нитях у точки — чья нить лопнула. */
function puppetAt(x: number, y: number): Mob | null {
  let best: Mob | null = null;
  let bd = 2.5;
  for (const m of F13_FX.mobs) {
    if ((m.data.sn ?? 0) <= 0) continue;
    const d = Math.hypot(m.x - x, m.y - y);
    if (d < bd) [best, bd] = [m, d];
  }
  return best;
}

// Лопнувшая нить: верх хлещет к ваге волной и закручивается, низ падает на
// пол с тяжестью и ложится змейкой, волокна летят по баллистике и ложатся
// на доски; белая искра в точке разреза.
registerZonePainter('f13_snap', (g, z, px, py, S, time) => {
  const t = z.t;
  const to = viewOf(z, px, py, S);
  pinZ(g, z, px, py);
  const m = puppetAt(z.x, z.y);
  const sh = m ? shoulderH(m, time) : 18;
  const giant = m?.kind === 'f13_giant';
  const star = F13_FX.stars.some(
    (s) => Math.abs(s.px - zf(z, 'bx')) < 0.3 && Math.abs(s.py - zf(z, 'by')) < 0.3,
  );
  // Низ нити (плечо) и верх (вага, крестовина или балка звезды).
  const lx = px;
  const lyF = py;
  const ly = star ? lyF - 14 : lyF - sh + (giant ? 0 : 0.18 * 16);
  const [bx, byF] = to(zf(z, 'bx'), zf(z, 'by'));
  let tx = bx;
  let ty = star ? byF - 60 : byF - 18;
  if (giant) {
    const v = vagaScreen(to, time);
    if (v) [tx, ty] = [v[0], v[1] + 2];
  }
  const cx = (tx + lx) / 2;
  const cy = (ty + ly) / 2;
  const floor = lyF + 2;
  const fade = 1 - k01((t - 0.6) / 0.3);
  // Верх: хлыст к ваге — волна бежит вверх и гаснет, конец перелетает и
  // возвращается (закрутка).
  const up = easeOut(t / 0.2);
  const over = Math.sin(t * 16) * Math.exp(-t * 7);
  const ux0 = lerp(cx, tx, up * 0.78 + over * 0.12);
  const uy0 = lerp(cy, ty, up * 0.78 + over * 0.12);
  const L1 = Math.hypot(ux0 - tx, uy0 - ty) + 2;
  const nx = -(uy0 - ty) / L1;
  const ny = (ux0 - tx) / L1;
  const whip = (s: number): [number, number] => {
    const w = Math.sin(s * Math.PI * 2 - t * 30) * Math.exp(-t * 6) * 5 * s;
    return [lerp(tx, ux0, s) + nx * w, lerp(ty, uy0, s) + ny * w];
  };
  if (ink(g, C.shade, 0.4 * fade))
    curvePx(
      g,
      (s) => {
        const [a, b] = whip(s);
        return [a + 1, b + 1];
      },
      L1 + 6,
    );
  if (ink(g, C.gold2, 0.95 * fade)) curvePx(g, whip, L1 + 6);
  // Низ: конец падает с ускорением, на полу ложится змейкой и скользит.
  const dn = easeIn(t / 0.32);
  const dir = Math.sign(cx - lx) || 1;
  const dx = lerp(cx, lx + 9 * dir, dn) + (t > 0.32 ? dir * 3 * easeOut((t - 0.32) / 0.3) : 0);
  const dy = lerp(cy, floor, dn);
  const L2 = Math.hypot(dx - lx, dy - ly) + 4;
  const lay = (s: number): [number, number] => {
    const x = lerp(lx, dx, s);
    let y = lerp(ly, dy, s) + Math.sin(s * Math.PI) * 4 * dn;
    if (y > floor) y = floor;
    const wig = dn >= 1 ? Math.sin(s * 9 + z.id) * 1.2 * s : 0;
    return [x, y - wig];
  };
  if (ink(g, C.shade, 0.4 * fade))
    curvePx(
      g,
      (s) => {
        const [a, b] = lay(s);
        return [a + 1, b + 1];
      },
      L2,
    );
  if (ink(g, C.gold1, 0.95 * fade)) curvePx(g, lay, L2);
  // Искра разреза: белая звезда, ореол, искры по баллистике.
  const fl = 1 - k01(t / 0.16);
  if (fl > 0) {
    glowC(g, cx, cy, 8, WARM, (reduced() ? 0.3 : 0.55) * fl);
    sparkPx(g, cx, cy, C.white, fl, true);
  }
  sparksPx(g, cx, cy, t, 7, seedOf(z), 70, [C.gold3, C.white, C.gold2], 0.4);
  // Волокна: кувыркаются, падают, ложатся на доски.
  shards(g, cx, floor, t, {
    n: 5,
    seed: seedOf(z) + 3,
    v: [10, 30],
    up: [10, 40],
    grav: 220,
    z0: Math.max(0, floor - cy),
    life: [0.7, 0.9],
    len: [2, 4],
    spin: 16,
    cols: [C.gold2, C.gold1],
    tip: null,
  });
  g.globalAlpha = 1;
  return true;
});

// Рыцарь снова на нитях: спускается с колосников в такт движку (`drop`
// у моба: высота −(1−k²)·40 за 0,55 с), нити натягиваются при касании.
registerZonePainter('f13_retie', (g, z, px, py, _S, time) => {
  const t = z.t;
  pinZ(g, z, px, py);
  const k = k01(t / 0.55);
  const up = (1 - k * k) * 40;
  const sh = py - 18 - up;
  const top = Math.min(sh - 50, py - 90);
  const land = t - 0.55;
  const lit = land > 0 ? Math.exp(-land * 6) : 0.3;
  for (const s of [-1, 1])
    threadPx(g, px + s * 4, top, px + s * 3, sh, {
      a: 0.9 * (1 - k01((t - 0.65) / 0.15)),
      sag: land > 0 ? 0.05 : 0.5,
      buzz: land > 0 ? 2 * Math.exp(-land * 10) : 0,
      lit,
      seed: s + z.id,
      time,
      fade: true,
    });
  if (land > 0) {
    // Касание: пыль из щелей досок, блик натянутой нити.
    dustPuff(g, px, py + 1, land, 6, seedOf(z), 6, 0.45);
    if (land < 0.2) sparkPx(g, px + 3, sh, C.white, 1 - land / 0.2, true);
  }
  g.globalAlpha = 1;
  return true;
});

// Кукла рассыпалась: опилки, лоскуты, шарниры.
registerZonePainter('f13_collapse', (g, z, px, py) => {
  const k = life(z);
  const pale = zf(z, 'k') > 0;
  burst(
    g,
    px,
    py - 8,
    k,
    18,
    z.id,
    pale ? [P.pink[2], P.porcelain[3], GOLD[2]] : [P.wood[2], P.wood[3], P.cream[2], GOLD[2]],
    14,
    6,
  );
  // Пыль оседает.
  g.fillStyle = rgba(P.cream[1], 0.35 * (1 - k));
  g.beginPath();
  g.ellipse(px, py, 8 + 6 * k, 3 + 2 * k, 0, 0, TAU);
  g.fill();
  return true;
});

registerZonePainter('f13_dust', (g, z, px, py) => {
  const k = life(z);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + z.id;
    g.fillStyle = rgba(P.cream[1], 0.4 * (1 - k));
    g.beginPath();
    g.arc(px + Math.cos(a) * 8 * k, py + Math.sin(a) * 4 * k - 3 * k, 2.5 + 2 * k, 0, TAU);
    g.fill();
  }
  return true;
});

// Люк вот-вот откроется: щели светятся снизу, чаще к концу.
registerZonePainter('f13_trapwarn', (g, z, px, py, _S, time) => {
  const k = life(z);
  const blink = 0.5 + 0.5 * Math.sin(time * (8 + 16 * k));
  const R = 16;
  g.strokeStyle = rgba([255, 120, 60, 255], 0.35 + 0.55 * blink);
  g.lineWidth = 1.2;
  g.strokeRect(px - R, py - R, R * 2, R * 2);
  g.fillStyle = rgba([255, 90, 40, 255], 0.1 + 0.2 * k);
  g.fillRect(px - R, py - R, R * 2, R * 2);
  g.fillStyle = rgba([255, 220, 140, 255], 0.5 * blink);
  g.fillRect(px - R, py - 0.5, R * 2, 1);
  g.fillRect(px - 0.5, py - R, 1, R * 2);
  return true;
});

// Аплодисменты: на сцену летят цветы.
registerZonePainter('f13_flowers', (g, z, px, py) => {
  const k = life(z);
  const cols = [P.red[2], P.pink[2], P.cream[3], GOLD[2]];
  for (let i = 0; i < 14; i++) {
    const t = k01(k * 1.6 - hash(z.id, i, 9) * 0.6);
    if (t <= 0) continue;
    const x = px + (hash(z.id, i, 1) - 0.5) * 60;
    const y0 = py - 70;
    const y1 = py + (hash(z.id, i, 2) - 0.5) * 30;
    const y = y0 + (y1 - y0) * ease(t);
    g.fillStyle = rgba(cols[i % 4], 1 - Math.max(0, k - 0.8) * 5);
    g.fillRect(x - 1, y - 1, 2.5, 2.5);
    g.fillStyle = rgba(P.green[2], 1 - Math.max(0, k - 0.8) * 5);
    g.fillRect(x, y + 1.5, 0.8, 2.5);
  }
  return true;
});

// Смена декораций: линии на полу — где встанет картон.
registerZonePainter('f13_setwarn', (g, z, px, py, S, time) => {
  const k = life(z);
  const to = viewOf(z, px, py, S);
  const L = F13_SCENERY[Math.round(zf(z, 'lay'))];
  if (!L) return true;
  const blink = 0.5 + 0.5 * Math.sin(time * (6 + 14 * k));
  const col: RGBA = L.kind === 'sea' ? [120, 200, 255, 255] : [255, 200, 90, 255];
  g.strokeStyle = rgba(col, 0.35 + 0.5 * blink);
  g.lineWidth = 0.8;
  g.setLineDash([3, 2]);
  g.lineDashOffset = -time * 20;
  for (const [x, y] of L.cells) {
    const [sx, sy] = to(x, y);
    g.strokeRect(sx + 1.5, sy + 1.5, S - 3, S - 3);
  }
  g.setLineDash([]);
  g.fillStyle = rgba(col, 0.08 + 0.12 * k);
  for (const [x, y] of L.cells) {
    const [sx, sy] = to(x, y);
    g.fillRect(sx, sy, S, S);
  }
  return true;
});

// Палочка дирижёра: оркестр замолк — кольцо тишины.
registerZonePainter('f13_hush', (g, z, px, py) => {
  const k = life(z);
  g.strokeStyle = rgba([180, 210, 255, 255], 0.7 * (1 - k));
  g.lineWidth = 1.5;
  g.beginPath();
  g.ellipse(px, py, z.r * 16 * ease(k), z.r * 16 * ease(k) * 0.8, 0, 0, TAU);
  g.stroke();
  return true;
});

// Стопор заклинил занавес: искры по ряду.
registerZonePainter('f13_jam', (g, z, px, py, _S, time) => {
  const k = life(z);
  if (k > 0.97) return true;
  for (let i = 0; i < 8; i++) {
    const x = px + (hash(i, Math.floor(time * 12), z.id) - 0.5) * z.r * 32;
    g.fillStyle = rgba(GOLD[3], 0.8);
    g.fillRect(x, py - 6 - hash(i, 3, Math.floor(time * 12)) * 6, 1, 1);
  }
  return true;
});

registerZonePainter('f13_backstab', (g, z, px, py) => {
  const k = life(z);
  const r = 10 * ease(k * 2);
  g.strokeStyle = rgba([210, 190, 255, 255], 1 - k);
  g.lineWidth = 1.4;
  g.beginPath();
  g.moveTo(px - r, py - 10 - r);
  g.lineTo(px + r, py - 10 + r);
  g.moveTo(px + r, py - 10 - r);
  g.lineTo(px - r, py - 10 + r);
  g.stroke();
  return true;
});

registerZonePainter('f13_yank', (g, z, px, py) => {
  const k = life(z);
  g.strokeStyle = rgba(GOLD[3], 0.9 * (1 - k));
  g.lineWidth = 0.8;
  for (let i = -1; i <= 1; i++) {
    g.beginPath();
    g.moveTo(px + i * 4, py - 22 - k * 10);
    g.lineTo(px + i * 4, py - 30 - k * 14);
    g.stroke();
  }
  return true;
});

registerZonePainter('f13_hatch', (g, z, px, py) => {
  const k = life(z);
  g.fillStyle = rgba([10, 4, 8, 255], 0.8 * (1 - k * k));
  g.fillRect(px - 9, py - 6, 18, 12);
  g.strokeStyle = rgba(P.wood[3], 1 - k);
  g.lineWidth = 1;
  g.strokeRect(px - 9, py - 6, 18, 12);
  burst(g, px, py, k, 8, z.id, [P.wood[2], P.cream[1]], 12, 4);
  return true;
});

// Шёпот суфлёра: ленточка букв к тому, кого он подбадривает.
registerZonePainter('f13_whisper', (g, z, px, py, S) => {
  const k = life(z);
  const to = viewOf(z, px, py, S);
  const [tx, ty] = to(zf(z, 'tx'), zf(z, 'ty'));
  for (let i = 0; i < 7; i++) {
    const u = k01(k * 1.4 - i * 0.06);
    if (u <= 0 || u >= 1) continue;
    const x = px + (tx - px) * u;
    const y = py - 10 + (ty - py) * u - Math.sin(u * Math.PI) * 10;
    g.fillStyle = rgba(P.cream[3], 0.9);
    g.fillRect(x, y, 1.6, 1);
    g.fillRect(x + 0.6, y - 1, 0.8, 1);
  }
  return true;
});

registerZonePainter('f13_shatter', (g, z, px, py) => {
  const k = life(z);
  burst(g, px, py - 10, k, 12, z.id, [P.porcelain[3], P.porcelain[1], GOLD[2]], 12, 2);
  return true;
});

registerZonePainter('f13_mend', (g, z, px, py) => {
  const k = life(z);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + k * 3;
    const r = 14 * (1 - k);
    g.fillStyle = rgba(GOLD[3], 0.9 * (1 - k * 0.5));
    g.fillRect(px + Math.cos(a) * r, py - 10 + Math.sin(a) * r * 0.7, 1.2, 1.2);
  }
  return true;
});

// Луч лечения маски маске: золотая лента между двумя.
registerZonePainter('f13_healbeam', (g, z, px, py, S, time) => {
  const k = life(z);
  const to = viewOf(z, px, py, S);
  const a = F13_FX.mobs.find((m) => m.id === zf(z, 'from'));
  const b = F13_FX.mobs.find((m) => m.id === zf(z, 'to'));
  if (!a || !b) return true;
  const [x0, y0] = to(a.x, a.y);
  const [x1, y1] = to(b.x, b.y);
  g.strokeStyle = rgba([255, 230, 140, 255], 0.75 * (1 - k));
  g.lineWidth = 1.4;
  g.beginPath();
  g.moveTo(x0, y0 - 18);
  g.quadraticCurveTo((x0 + x1) / 2, (y0 + y1) / 2 - 30 + Math.sin(time * 9) * 3, x1, y1 - 18);
  g.stroke();
  return true;
});

registerZonePainter('f13_fade', (g, z, px, py) => {
  const k = life(z);
  for (let i = 0; i < 6; i++) {
    g.fillStyle = rgba(P.shade[3], 0.4 * (1 - k));
    g.beginPath();
    g.arc(px + (hash(z.id, i) - 0.5) * 12, py - 8 - k * 16 - i * 2, 2 + i * 0.4, 0, TAU);
    g.fill();
  }
  return true;
});

// ---- занавес ------------------------------------------------------------------
//
// Тяжёлый бархат столбцами по пикселю мира: складки с бликом ворса со
// стороны света (сверху-слева), низ фестонами, галун, бахрома, кисти на
// шнурах — качаются с запаздыванием после удара о пол и каждого рывка;
// ламбрекен с фестонами сверху. Падает с ускорением, кромка волнится на
// лету, бьётся о сцену, ложится складкой и отскакивает; пыль от пола и с
// колосников. Поднимается рывками на тросах — между тросами низ провисает.

interface Drape {
  /** Доля опускания: 0 поднят, 1 до пола. */
  drop: number;
  /** Последний толчок (удар о пол, рывок троса) — время зоны, сила. */
  kickT: number;
  kick: number;
  /** Подъём на тросах — фестоны 0…1. */
  lift: number;
  /** Пыль у кромки при ударе о пол (время после удара). */
  dustT: number;
  /** Скорость падения 0…1: кромка волнится на лету. */
  v: number;
  /** Начало падения (время зоны): пыль с колосников. */
  fallT: number;
}

const DRAPE0 = (): Drape => ({ drop: 0, kickT: -9, kick: 0, lift: 0, dustT: -1, v: 0, fallT: -9 });

/** Падение: свободно 0,62 с, удар, два отскока. */
function fallDrape(t: number, d: Drape): void {
  const T0 = 0.62;
  d.fallT = 0;
  if (t < T0) {
    d.drop = easeIn(t / T0);
    d.v = t / T0;
    return;
  }
  const u = t - T0;
  d.drop = 1 - 0.05 * Math.exp(-u * 5) * Math.abs(Math.sin(u * 11));
  d.kickT = T0;
  d.kick = 1;
  d.dustT = u;
}

/** Подъём рывками: `n` рывков за отрезок [t0, t1]. */
function riseDrape(t: number, t0: number, t1: number, n: number, d: Drape): void {
  const p = k01((t - t0) / (t1 - t0));
  const i = Math.min(n - 1, Math.floor(p * n));
  const q = p * n - i;
  // Рывок — быстрый подхват за 40% доли, потом провис назад на 1,5%.
  const pull = easeOut(q / 0.4);
  const sag = q > 0.4 ? 0.015 * Math.sin(((q - 0.4) / 0.6) * Math.PI) : 0;
  d.drop = 1 - (i + pull) / n + sag;
  d.kickT = t0 + (i / n) * (t1 - t0);
  d.kick = 0.6;
  d.lift = Math.min(1, p * 3) * (1 - k01((p - 0.85) / 0.15));
}

const V_COL = [C.vel0, C.vel1, C.vel2, C.vel3];

function drape(
  g: G,
  z: Zone | Strike,
  px: number,
  py: number,
  S: number,
  d: Drape,
  zt: number,
  time: number,
): void {
  if (d.drop <= 0.002) return;
  const to = viewOf(z, px, py, S);
  pinZ(g, z, px, py);
  const [vw, vh] = viewSize(g);
  const [ax0, top] = to(ARENA_X0, 0);
  const [ax1, bottom] = to(ARENA_X1, 24);
  const yb = top + (bottom - top) * d.drop;
  if (yb < -4 || top > vh) return;
  const x0 = Math.max(ax0, -4);
  const x1 = Math.min(ax1, vw + 4);
  const age = zt - d.kickT;
  // Волна по ткани после толчка — бежит от середины к краям.
  const kick = age >= 0 ? d.kick * Math.exp(-age * 2.5) : 0;
  const [cx] = to((ARENA_X0 + ARENA_X1) / 2, 0);
  const cords = 6;
  const span = (ax1 - ax0) / cords;
  const hem = (x: number) => {
    let o = 0;
    if (d.lift > 0) {
      const u = mod((x - ax0) / span, 1);
      o -= d.lift * 7 * (1 - Math.sin(u * Math.PI));
    }
    // На лету кромка волнится: воздух под бархатом.
    if (d.v > 0 && d.dustT < 0) o += Math.sin((x - ax0) * 0.07 + zt * 9) * 2.2 * d.v;
    // Легла: бархат собрался складкой у пола.
    if (d.dustT >= 0) o += 2 * Math.exp(-d.dustT * 3);
    return o;
  };
  const fold = (x: number) => {
    const wx = x - ax0;
    const ripple = kick * Math.sin(Math.abs(x - cx) * 0.05 - age * 9) * 0.8;
    return (
      Math.sin(wx * 0.21 + Math.sin(time * 0.6) * 0.25 + ripple) + 0.42 * Math.sin(wx * 0.53 + 1.3)
    );
  };
  g.globalAlpha = 1;
  const X0 = WX(x0);
  const X1 = WX(x1);
  for (let X = X0; X < X1; X++) {
    const x = X + OX + 0.5;
    const f = fold(x);
    // Свет сверху-слева: склон складки к свету светлее (ворс бархата).
    const sl = fold(x + 1) - fold(x - 1);
    const lit = f * 0.75 - sl * 1.5;
    const i = lit > 1.0 ? 3 : lit > 0.2 ? 2 : lit > -0.55 ? 1 : 0;
    const yh = yb + hem(x) + (f > 0.25 ? 1 : 0);
    const T0 = WY(top);
    const H = WY(yh) - T0;
    if (H <= 0) continue;
    g.fillStyle = V_COL[i];
    g.fillRect(X + QX, T0 + QY, 1, H);
    // Блик ворса на гребне складки.
    if (lit > 1.25) {
      g.fillStyle = '#d85a64';
      g.fillRect(X + QX, T0 + 26 + QY, 1, Math.max(0, Math.round((H - 26) * 0.7)));
    }
    // Галун над низом и бахрома (нитки разной длины, отстают от качания).
    const Y = WY(yh);
    g.fillStyle = i >= 2 ? C.gold3 : C.gold2;
    g.fillRect(X + QX, Y - 5 + QY, 1, 2);
    g.fillStyle = C.gold1;
    g.fillRect(X + QX, Y - 3 + QY, 1, 1);
    const sw = Math.round(
      Math.sin(time * 3 + X * 0.3) * 0.4 + kick * Math.sin(age * 14 + X * 0.2) * 1.5,
    );
    if (X % 2 === 0) {
      g.fillStyle = (X >> 1) % 2 ? C.gold2 : C.gold1;
      g.fillRect(X + sw + QX, Y - 1 + QY, 1, 3 + ((X >> 1) % 3));
    }
  }
  // Тень под ламбрекеном и тёплый свет рампы на низ полотна (свет — мягко).
  const sh = g.createLinearGradient(0, top, 0, top + 40);
  sh.addColorStop(0, 'rgba(8,2,6,0.55)');
  sh.addColorStop(1, 'rgba(8,2,6,0)');
  g.fillStyle = sh;
  g.fillRect(x0, top, x1 - x0, Math.min(40, yb - top));
  const ramp = g.createLinearGradient(0, yb - 46, 0, yb);
  ramp.addColorStop(0, 'rgba(255,200,120,0)');
  ramp.addColorStop(1, 'rgba(255,190,110,0.22)');
  g.fillStyle = ramp;
  g.fillRect(x0, Math.max(top, yb - 46), x1 - x0, Math.min(46, yb - top));
  // Шов посередине: полотнища заходят друг на друга.
  if (cx > x0 && cx < x1) {
    if (ink(g, C.ink, 0.6)) pp(g, cx, top, 1, yb - top);
    if (ink(g, C.vel3, 0.7)) pp(g, cx + 1, top, 1, yb - top);
  }
  // Тросы подъёма: золотые шнуры с кольцами бегут вверх, низ подтянут к ним.
  if (d.lift > 0) {
    for (let i = 1; i < cords; i++) {
      const x = ax0 + i * span;
      if (x < -2 || x > vw + 2) continue;
      if (ink(g, C.gold2, 0.9 * d.lift)) pp(g, x, top, 1, yb - top - 4);
      if (ink(g, C.gold3, 0.9 * d.lift))
        for (let y = top + 10 + mod(time * 40, 10); y < yb - 6; y += 10) pp(g, x - 1, y, 3, 1);
    }
  }
  // Кисти вдоль низа: висят на шнуре, качаются после толчка с запаздыванием.
  for (let i = 0; i < cords; i++) {
    const x = ax0 + (i + 0.5) * span;
    if (x < -8 || x > vw + 8) continue;
    const yh = yb + hem(x) + 1;
    const lag = Math.max(0, age - 0.08 - i * 0.03);
    const th =
      0.08 * Math.sin(time * 1.8 + i) + (age >= 0 ? kick * 0.6 * Math.sin(lag * 8 + i * 0.7) : 0);
    const L = 9;
    const ex = x + Math.sin(th) * L;
    const ey = yh + Math.cos(th) * L;
    if (ink(g, C.gold1, 1)) linePx(g, x, yh - 2, ex, ey);
    if (ink(g, C.ink, 0.85)) fEll(g, ex, ey + 1, 2.8, 2.6);
    if (ink(g, C.gold2, 1)) fEll(g, ex, ey + 1, 2.1, 1.9);
    if (ink(g, C.gold3, 1)) pp(g, ex - 1, ey);
    // Юбка кисти: нитки, отстают от качания.
    for (let j = -2; j <= 2; j++) {
      if (ink(g, j % 2 ? C.gold1 : C.gold2, 1))
        pp(g, ex + j - Math.sin(th) * 2, ey + 3, 1, 4 + (j & 1));
    }
  }
  // Ламбрекен: фестоны с галуном и короткими кистями между ними.
  if (top > -30) {
    const sw = 32;
    const T0 = WY(top);
    for (let X = X0; X < X1; X++) {
      const u = mod(X + OX - ax0, sw) / sw;
      const dep = Math.round(Math.sin(u * Math.PI) * 15);
      g.globalAlpha = 1;
      g.fillStyle = C.vel0;
      g.fillRect(X + QX, T0 + QY, 1, dep + 1);
      g.fillStyle = u < 0.45 ? C.vel3 : C.vel2;
      if (dep > 3) g.fillRect(X + QX, T0 + QY, 1, dep - 2);
      g.fillStyle = C.gold2;
      g.fillRect(X + QX, T0 + dep + QY, 1, 1);
      if (u < 0.04 || u > 0.96) {
        g.fillStyle = C.gold3;
        g.fillRect(X + QX, T0 + 2 + QY, 1, 6);
      }
    }
    g.fillStyle = C.gold2;
    g.fillRect(X0 + QX, T0 + QY, X1 - X0, 3);
    g.fillStyle = C.gold3;
    g.fillRect(X0 + QX, T0 + QY, X1 - X0, 1);
  }
  // Пыль сцены от удара полотна о пол — клубами вдоль кромки.
  if (d.dustT >= 0 && d.dustT < 0.9) {
    for (let i = 0; i < 7; i++) {
      const x = x0 + ((i + 0.5) / 7) * (x1 - x0);
      dustPuff(g, x, yb + 3, d.dustT, 5, seedOf(z) + i * 7, 9, 0.9, 1, i % 2 ? 0 : Math.PI, 2.2);
    }
  }
  // Пыль с колосников: при начале падения и на каждом рывке троса.
  const fa = d.fallT > -9 ? zt - d.fallT : age >= 0 && d.kick < 1 ? age : -1;
  if (fa >= 0 && fa < 1.2) {
    for (let i = 0; i < 18; i++) {
      const t = fa - hash(i, 9, seedOf(z)) * 0.3;
      if (t < 0) continue;
      const x = x0 + hash(i, 3, seedOf(z)) * (x1 - x0) + Math.sin(t * 4 + i) * 3;
      const y = top + 4 + 40 * t * t + 14 * t;
      if (y > yb) continue;
      if (ink(g, i % 3 ? C.dust1 : C.dust2, 0.55 * (1 - t / 1.2))) pp(g, x, y, i % 4 ? 1 : 2, 1);
    }
  }
  g.globalAlpha = 1;
}

// Между актами: падает (0,62 с) и бьётся о сцену, держится, пока меняют
// декорацию, и уходит вверх четырьмя рывками (весь переход — `BOSS.trans`).
registerZonePainter('f13_curtainfall', (g, z, px, py, S, time) => {
  const t = z.t;
  const T = BOSS.trans;
  const d = DRAPE0();
  const up = BOSS.swap + 0.3;
  if (t < up) fallDrape(t, d);
  else riseDrape(t, up, T - 0.05, 4, d);
  drape(g, z, px, py, S, d, t, time);
  return true;
});

// Начало боя: занавес стоит, потом уходит вверх рывками.
registerZonePainter('f13_curtainrise', (g, z, px, py, S, time) => {
  const t = z.t;
  const d = DRAPE0();
  d.drop = 1;
  if (t >= 0.3) riseDrape(t, 0.3, 1.9, 4, d);
  drape(g, z, px, py, S, d, t, time);
  return true;
});

/** Роза: бутон тушью, лепестки со светом сверху-слева, стебель с листиком. */
function rose(g: G, x: number, y: number, rot: number, a: number): void {
  const ux = Math.cos(rot);
  const uy = Math.sin(rot);
  if (ink(g, C.leaf, a)) linePx(g, x, y, x + ux * 7, y + uy * 7);
  if (ink(g, '#7ad06a', a)) pp(g, x + ux * 4 - uy * 1.5, y + uy * 4 + ux * 1.5, 2, 1);
  if (ink(g, C.ink, a * 0.85)) fDisc(g, x - ux, y - uy, 3);
  if (ink(g, C.rose, a)) fDisc(g, x - ux, y - uy, 2.3);
  if (ink(g, C.roseL, a)) pp(g, x - ux - 1, y - uy - 1, 2, 1);
  if (ink(g, '#5e0c1a', a)) pp(g, x - ux, y - uy);
}

// Смерть Кукловода: из зала летят розы (дугой, кувыркаясь, ложатся у его
// ног с отскоком), потом занавес падает и бьётся о сцену, в конце — рывок.
registerZonePainter('f13_bow', (g, z, px, py, S, time) => {
  const t = z.t;
  const [, vh] = viewSize(g);
  pinZ(g, z, px, py);
  for (let i = 0; i < 18; i++) {
    const t0 = 1.2 + hash(i, 7, 1) * 2.8;
    const u = (t - t0) / 0.75;
    if (u <= 0) continue;
    // Цель — у ног поклонившегося, старт — из зала (за нижним краем кадра).
    const tx = px + (hash(i, 1, 2) - 0.5) * 70;
    const ty = py + 6 + (hash(i, 2, 3) - 0.3) * 22;
    const sx = tx + (hash(i, 3, 4) - 0.5) * 60;
    const sy = Math.max(vh + 10, ty + 60);
    if (u < 1) {
      const x = lerp(sx, tx, u);
      const y = lerp(sy, ty, u) - Math.sin(u * Math.PI) * 50;
      // Тень на полу растёт к приземлению.
      if (ink(g, C.shade, 0.3 * u)) fEll(g, lerp(sx, tx, u), lerp(sy, ty, u) + 2, 3, 1);
      rose(g, x, y, u * 9 + i, 1);
      continue;
    }
    // Легла: отскок и покой; лепестки рядом.
    const b = u - 1;
    const hop = b < 0.5 ? Math.abs(Math.sin(b * TAU)) * 3 * (1 - b * 2) : 0;
    rose(g, tx, ty - hop, i * 1.7, 1);
    if (b < 0.4) sparkPx(g, tx, ty - 3, '#ffb6c8', 1 - b / 0.4);
  }
  g.globalAlpha = 1;
  const d = DRAPE0();
  if (t >= 4.4 && t < 6.1) fallDrape(t - 4.4, d);
  else if (t >= 6.1) riseDrape(t, 6.1, 6.5, 2, d);
  if (t >= 4.4 && d.kickT > -9) d.kickT += 4.4;
  if (d.fallT > -9) d.fallT += 4.4;
  const cz = { ...z, x: zf(z, 'cx'), y: zf(z, 'cy') } as Zone;
  const to = viewOf(z, px, py, S);
  const [cx, cy] = to(cz.x, cz.y);
  drape(g, cz, cx, cy, S, d, t, time);
  return true;
});

// ---- контакты и следы ---------------------------------------------------------
//
// Каждому удару — своя картинка и тряска по силе (мозг: слабый ~0,1, средний
// ~0,25, тяжёлый ~0,5). Тяжёлые — в два слоя: на полу щепа досок, вмятина,
// пыль (под мобами), поверх темноты — искры и вспышка (`f13_v_spark`).

const WOOD = [C.wood1, C.wood2, C.wood3, C.dust2];

/** Трещина по доскам: доски лежат вдоль x — трещина бежит вдоль и рвётся поперёк. */
function boardCrack(
  g: G,
  x: number,
  y: number,
  ang: number,
  len: number,
  seed: number,
  a: number,
): void {
  if (!ink(g, C.shade, a)) return;
  let cx = x;
  let cy = y;
  const n = Math.max(2, Math.round(len / 3));
  for (let i = 0; i < n; i++) {
    // Вдоль доски легко, поперёк — ступенькой на шов.
    const along = Math.abs(Math.cos(ang)) > 0.5 || hash(seed, i, 3) > 0.6;
    const nx = cx + (along ? Math.sign(Math.cos(ang)) || 1 : 0) * 3;
    const ny = cy + (along ? 0 : Math.sign(Math.sin(ang)) || 1) * 2;
    linePx(g, cx, cy, nx, ny);
    cx = nx;
    cy = ny;
  }
}

/** Вмятина в досках: тёмная лунка, светлая кромка сверху-слева, трещины. */
function dent(g: G, x: number, y: number, r: number, seed: number, a: number): void {
  if (ink(g, C.shade, 0.55 * a)) fEll(g, x, y, r, r * 0.55);
  if (ink(g, C.wood0, 0.8 * a)) fEll(g, x + 0.5, y + 0.5, r * 0.6, r * 0.32);
  if (ink(g, C.wood3, 0.7 * a)) arcPx(g, x, y, r, Math.PI * 1.05, Math.PI * 1.6);
  for (let i = 0; i < 4; i++) {
    const ang = (i / 4) * TAU + hash(seed, i, 1) * 1.2;
    boardCrack(
      g,
      x + Math.cos(ang) * r * 0.8,
      y + Math.sin(ang) * r * 0.45,
      ang,
      r * (0.8 + hash(seed, i, 2)),
      seed + i,
      0.6 * a,
    );
  }
}

/** Щепа досок: разлёт, отскок, скольжение, вращение, тень. */
function splinters(
  g: G,
  x: number,
  y: number,
  t: number,
  seed: number,
  n: number,
  v: number,
  ang?: number,
  spread?: number,
  aK = 1,
): void {
  shards(
    g,
    x,
    y,
    t,
    {
      n,
      seed,
      ang,
      spread,
      v: [v * 0.4, v],
      up: [30, 70],
      grav: 260,
      life: [0.6, 1],
      len: [2, 4],
      spin: 18,
      slide: 5,
      cols: WOOD,
    },
    aK,
  );
}

/** Удар копья: вмятина на острие, щепа вперёд, пыль. */
registerZonePainter('f13_lancehit', (g, z, px, py) => {
  const t = z.t;
  const k = life(z);
  pinZ(g, z, px, py);
  const a = zf(z, 'ang');
  const seed = seedOf(z);
  const fade = 1 - k01((k - 0.7) / 0.3);
  // Удар со следом: древко короче своей досягаемости, поэтому в кадр урона
  // вдоль всей полосы проходит толчок — от наконечника до точки контакта.
  const reach = (zf(z, 'len') - 1.5) * TS;
  const wk = 1 - k01(t / 0.16);
  if (reach > 0 && wk > 0) {
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const head = reach * Math.min(1, 0.55 + t / 0.06);
    for (let j = -1; j <= 1; j++) {
      const nx = -sa * j * 3;
      const ny = ca * j * 3;
      if (!ink(g, j ? C.gold2 : C.cream, (j ? 0.35 : 0.6) * wk)) continue;
      const x0 = px - ca * reach + nx;
      const y0 = py - sa * reach + ny;
      linePx(g, x0, y0, x0 + ca * head, y0 + sa * head, j ? 3 : 0, j ? 2 : 0);
    }
  }
  dent(g, px, py, 4 + 2 * easeOut(t / 0.06), seed, fade);
  // Борозда от древка: копьё вошло в доски и выдернуто назад.
  if (ink(g, C.shade, 0.45 * fade)) linePx(g, px - Math.cos(a) * 9, py - Math.sin(a) * 5, px, py);
  splinters(g, px, py, t, seed, 8, 70, a, 1.6, fade);
  dustPuff(g, px, py, t, 6, seed + 1, 7, 0.4, fade);
  g.globalAlpha = 1;
  return true;
});

// Искры и вспышка поверх темноты — второй слой тяжёлых ударов (копьё, щит,
// таран, обвал исполина): металл звенит, `k` — сила.
registerZonePainter('f13_v_spark', (g, z, px0, py0) => {
  const t = z.t;
  const kk = zf(z, 'k') || 0.6;
  const a = zf(z, 'ang');
  pinZ(g, z, px0, py0);
  // `off` — сдвиг по ходу удара (кромка щита), клетки.
  const px = px0 + Math.cos(a) * zf(z, 'off') * TS;
  const py = py0 + Math.sin(a) * zf(z, 'off') * TS;
  const seed = seedOf(z);
  const fl = 1 - k01(t / 0.12);
  if (fl > 0) {
    glowC(g, px, py - 4, 8 + 10 * kk, WARM, (reduced() ? 0.25 : 0.5) * fl * kk);
    sparkPx(g, px, py - 4, C.white, fl, true);
  }
  // Кольцо звона: бежит наружу и гаснет за 0,2 с.
  if (t < 0.2 && ink(g, C.cream, 0.7 * (1 - t / 0.2)))
    arcPx(g, px, py - 4, 3 + 20 * kk * easeOut(t / 0.2), 0, TAU, 3, 0, 2);
  sparksPx(
    g,
    px,
    py - 4,
    t,
    Math.round(6 + 10 * kk),
    seed,
    60 + 70 * kk,
    [C.white, C.gold3, C.amber],
    0.32,
    a,
    1.1,
  );
  g.globalAlpha = 1;
  return true;
});

// След на полу ударов Кукловода: 1 — царапины нити-лезвия по дуге, 2 —
// прокол нити-шпаги, 3 — таран исполина (вмятина, юз, щепа, пыль).
registerZonePainter('f13_v_mark', (g, z, px, py) => {
  const t = z.t;
  const k = life(z);
  pinZ(g, z, px, py);
  const a = zf(z, 'ang');
  const kind = zf(z, 'kind');
  const seed = seedOf(z);
  const fade = 1 - k01((k - 0.6) / 0.4);
  if (kind === 1) {
    // Три царапины по дуге конуса — светлое дерево из-под лака.
    const R = z.r * TS;
    const half = BOSS.cone.arc / 2;
    for (let i = 0; i < 3; i++) {
      const r = R * (0.55 + 0.18 * i);
      const sweep = easeOut(t / 0.1);
      const a0 = a - half * 0.9;
      if (ink(g, C.shade, 0.35 * fade)) arcPx(g, px, py + 1, r, a0, a0 + 2 * half * 0.9 * sweep);
      if (ink(g, i === 1 ? C.dust2 : C.wood3, 0.8 * fade))
        arcPx(g, px, py, r, a0, a0 + 2 * half * 0.9 * sweep);
    }
    splinters(
      g,
      px + Math.cos(a) * R * 0.7,
      py + Math.sin(a) * R * 0.5,
      t,
      seed,
      5,
      45,
      a,
      2,
      fade,
    );
  } else if (kind === 2) {
    const L = zf(z, 'len') * TS;
    const tx = px + Math.cos(a) * L;
    const ty = py + Math.sin(a) * L;
    dent(g, tx, ty, 2.5, seed, fade);
    if (ink(g, C.wood3, 0.6 * fade))
      linePx(g, px + Math.cos(a) * 6, py + Math.sin(a) * 6, tx, ty, 3, 0, 1);
    splinters(g, tx, ty, t, seed, 5, 40, a, 1.4, fade);
  } else {
    // Таран: юз ногами (две борозды назад), вмятина, щепа и пыль вперёд.
    dent(g, px, py, 5, seed, fade);
    for (const s of [-1, 1]) {
      const ox = -Math.sin(a) * 4 * s;
      const oy = Math.cos(a) * 2 * s;
      if (ink(g, C.shade, 0.4 * fade))
        linePx(g, px + ox - Math.cos(a) * 18, py + oy - Math.sin(a) * 10, px + ox, py + oy);
    }
    splinters(g, px, py, t, seed, 10, 90, a, 2, fade);
    dustPuff(g, px, py, t, 9, seed + 2, 12, 0.7, fade);
  }
  g.globalAlpha = 1;
  return true;
});

/** Петля аркана: эллипс верёвкой, узел. */
function loopPx(g: G, x: number, y: number, rx: number, ry: number, a: number, hot: number): void {
  const at = (s: number): [number, number] => [
    x + Math.cos(s * TAU) * rx,
    y + Math.sin(s * TAU) * ry,
  ];
  const L = TAU * rx;
  if (ink(g, C.shade, 0.5 * a))
    curvePx(
      g,
      (s) => {
        const [p, q] = at(s);
        return [p, q + 1];
      },
      L,
    );
  if (ink(g, C.gold0, a)) curvePx(g, at, L, 0.5, 1);
  if (ink(g, hot > 0.5 ? C.cream : C.gold2, a)) curvePx(g, at, L, 0, 0.5);
  sparkPx(g, x - rx, y, hot > 0.5 ? C.white : C.gold3, a, hot > 0.5);
}

/** Рука Кукловода (вага) на экране для зоны, если он рядом. */
function lordHand(z: Zone | Strike, px: number, py: number): [number, number] {
  const lord = lordNow();
  if (!lord) return [px, py - 30];
  const [dx, dy] = lordVagaPx(lord, F13_FX.time);
  return [px + (lord.x - z.x) * TS + dx, py + (lord.y - z.y) * TS + dy];
}

// Аркан попал: верёвка в струну от руки к герою, петля затягивается и тянет.
registerZonePainter('f13_snareline', (g, z, px, py, _S, time) => {
  const t = z.t;
  pinZ(g, z, px, py);
  const sim = paintSim();
  const [hx0, hy0] = lordHand(z, px, py);
  // Где герой сейчас (его тянут) — петля на поясе.
  const hx1 = sim ? px + (sim.hero.x - z.x) * TS : px + (zf(z, 'tx') - z.x) * TS;
  const hy1 = (sim ? py + (sim.hero.y - z.y) * TS : py + (zf(z, 'ty') - z.y) * TS) - 7;
  const fade = 1 - k01((t - 0.45) / 0.15);
  if (fade <= 0) return true;
  // Контакт — в кадр урона: петля уже на герое, бросок — смазом (f13_v_snarethrow).
  const u = t;
  // Натяг: рывок — струна звенит, потом слабнет.
  const buzz = 2 * Math.exp(-u * 8);
  threadPx(g, hx0, hy0, hx1, hy1, {
    a: 0.95 * fade,
    sag: u < 0.25 ? 0.05 : 0.05 + (u - 0.25) * 3,
    buzz,
    lit: 1 - k01(u / 0.3),
    seed: 4.2,
    time,
    thick: true,
  });
  // Петля затягивается: из широкой — в обхват.
  const tight = easeOut(u / 0.12);
  loopPx(g, hx1, hy1, lerp(8, 4, tight), lerp(3.5, 2, tight), fade, 1 - k01(u / 0.2));
  if (u < 0.12) {
    sparkPx(g, hx1, hy1, C.white, 1 - u / 0.12, true);
    sparksPx(g, hx1, hy1, u, 6, seedOf(z), 50, [C.gold3, C.white], 0.3);
  }
  g.globalAlpha = 1;
  return true;
});

// Бросок аркана: петля летит дугой, верёвка тянется следом провисая; мимо —
// ложится у конца и её тянут назад по доскам.
registerZonePainter('f13_v_snarethrow', (g, z, px, py, _S, time) => {
  const t = z.t;
  pinZ(g, z, px, py);
  const a = zf(z, 'ang');
  const L = zf(z, 'len') * TS;
  const lord = lordNow();
  const hit = lord ? (lord.data.vYank ?? 0) > 0 : false;
  const [hx0, hy0] = lordHand(z, px, py);
  if (hit) {
    // Попал: бросок быстрее кадра — смаз из петель от руки к герою, гаснет
    // за 0,08 с; петлю на поясе рисует f13_snareline с того же кадра.
    const sim = paintSim();
    if (!sim || t > 0.08) return true;
    const tx = px + (sim.hero.x - z.x) * TS;
    const ty = py + (sim.hero.y - z.y) * TS - 7;
    const k = 1 - t / 0.08;
    for (let j = 0; j < 3; j++) {
      const u = 0.3 + j * 0.22;
      const bx = lerp(hx0, tx, u);
      const by = lerp(hy0, ty, u) - Math.sin(u * Math.PI) * 6;
      loopPx(g, bx, by, 4 + j, 2 + j * 0.5, k * (0.25 + 0.2 * j), 0);
    }
    g.globalAlpha = 1;
    return true;
  }
  const T1 = 0.2;
  const ex = px + Math.cos(a) * L;
  const ey = py + Math.sin(a) * L - 4;
  let lx: number;
  let ly: number;
  let back = 0;
  if (t < T1) {
    const u = easeOut(t / T1);
    lx = lerp(hx0, ex, u);
    ly = lerp(hy0, ey, u) - Math.sin(u * Math.PI) * 10;
  } else {
    // Мимо: петля упала и ползёт назад к руке.
    back = easeIn((t - T1) / (0.6 - T1));
    lx = lerp(ex, px + Math.cos(a) * 10, back);
    ly = lerp(ey + 3, py + Math.sin(a) * 10, back);
  }
  const fade = 1 - k01((t - 0.5) / 0.1);
  threadPx(g, hx0, hy0, lx, ly, {
    a: 0.9 * fade,
    sag: t < T1 ? 1.4 : 2.2,
    seed: 2.7,
    time,
    glints: false,
  });
  loopPx(g, lx, ly, t < T1 ? 5 + 2 * Math.sin(t * 40) : 6, t < T1 ? 3 : 1.6, fade, 0);
  // Мимо: пыль там, где петля ударилась о доски.
  if (!hit && t >= T1) dustPuff(g, ex, ey + 4, t - T1, 4, seedOf(z), 5, 0.4, fade);
  g.globalAlpha = 1;
  return true;
});

// Волна накрыла: брызги вверх и вперёд падают каплями, кольцо пены, мокрое пятно.
registerZonePainter('f13_splash', (g, z, px, py) => {
  const t = z.t;
  pinZ(g, z, px, py);
  const seed = seedOf(z);
  const fade = 1 - k01((t - 0.4) / 0.2);
  if (ink(g, C.sea0, 0.4 * fade))
    fEll(g, px, py + 1, 9 + 4 * easeOut(t / 0.3), 4 + 2 * easeOut(t / 0.3));
  if (ink(g, C.foam, 0.7 * fade)) {
    const r = 4 + 12 * easeOut(t / 0.35);
    for (let i = 0; i < 14; i++) {
      const an = (i / 14) * TAU + hash(seed, i, 1) * 0.3;
      if (hash(seed, i, 2) < 0.3) continue;
      pp(g, px + Math.cos(an) * r, py + Math.sin(an) * r * 0.5, 2, 1);
    }
  }
  shards(g, px, py, t, {
    n: 16,
    seed,
    v: [10, 40],
    up: [50, 110],
    grav: 340,
    life: [0.45, 0.6],
    cols: [C.foam, C.sea3, C.sea2],
    tip: null,
    slide: 12,
  });
  g.globalAlpha = 1;
  return true;
});

// Звезда упала (нити срезаны): падает с высоты, где висела, с тяжестью, бьётся
// о сцену и подпрыгивает дважды — пыль и золотые искры; потом лежит тускло.
const STAR_FALL = 0.75;
registerZonePainter('f13_starfall', (g, z, px, py) => {
  const t = z.t;
  pinZ(g, z, px, py);
  const seed = seedOf(z);
  const H0 = 14;
  const T1 = Math.sqrt((2 * (H0 - 2)) / 420);
  let h: number;
  let land = -1;
  if (t < T1) h = H0 - 0.5 * 420 * t * t;
  else {
    const u = t - T1;
    land = u;
    const b1 = 0.16;
    const b2 = 0.09;
    h =
      2 +
      (u < b1
        ? 34 * u - 0.5 * 420 * u * u
        : u < b1 + b2
          ? 18 * (u - b1) - 0.5 * 420 * (u - b1) ** 2
          : 0);
    h = Math.max(2, h);
  }
  if (t < STAR_FALL) {
    if (ink(g, C.shade, 0.25 + 0.2 * (1 - h / H0))) fEll(g, px, py + 1, 4 + 2 * (1 - h / H0), 1.6);
    const rs = starRs(t * (land < 0 ? 9 : 2) + seed);
    blit(g, starSprite(land < 0 ? 'gold' : 'dim', land < 0 ? 9 : 6, rs), px, py - h);
  }
  if (land >= 0) {
    dustPuff(g, px, py, land, 8, seed, 9, 0.6);
    if (land < 0.12) glowC(g, px, py - 3, 12, [255, 236, 160, 255], 0.45 * (1 - land / 0.12));
    sparksPx(g, px, py - 2, land, 9, seed + 1, 70, [C.gold3, C.white, C.gold2], 0.4);
  } else if (t < 0.1) sparkPx(g, px, py - H0, C.white, 1 - t / 0.1, true);
  g.globalAlpha = 1;
  return true;
});

// ---- контакты без своего удара (зоны `api.vfx` в строках урона мозга) --------

// Шаг исполина и пыль за тараном: клубы из-под ступни, мелкая щепа.
registerZonePainter('f13_v_dust', (g, z, px, py) => {
  const t = z.t;
  pinZ(g, z, px, py);
  const a = zf(z, 'ang');
  const seed = seedOf(z);
  for (const s of [-1, 1]) {
    const ox = -Math.sin(a) * 5 * s;
    const oy = Math.cos(a) * 2 * s;
    dustPuff(g, px + ox, py + oy, t, 4, seed + (s > 0 ? 3 : 0), 5, 0.6, 1, a + Math.PI, 2.4);
  }
  shards(g, px, py, t, {
    n: 3,
    seed: seed + 9,
    ang: a + Math.PI,
    spread: 2,
    v: [10, 30],
    up: [20, 40],
    grav: 260,
    life: [0.4, 0.6],
    cols: [C.wood2, C.dust1],
    tip: null,
  });
  g.globalAlpha = 1;
  return true;
});

// Щит: ударная дуга по полу перед исполином, пыль сметает к кромке, доски
// подпрыгивают.
registerZonePainter('f13_v_bash', (g, z, px, py) => {
  const t = z.t;
  pinZ(g, z, px, py);
  const a = zf(z, 'ang');
  const R = z.r * TS;
  const half = BOSS.shield.arc / 2;
  const seed = seedOf(z);
  const u = easeOut(t / 0.16);
  const r = R * (0.45 + 0.55 * u);
  const fade = 1 - k01((t - 0.2) / 0.3);
  if (ink(g, C.cream, 0.7 * fade)) arcPx(g, px, py, r, a - half, a + half);
  if (ink(g, C.dust1, 0.5 * fade)) arcPx(g, px, py, r - 2, a - half * 0.9, a + half * 0.9, 3, 0, 2);
  // Дрожь досок: короткие тени-шевеления в секторе.
  if (t < 0.25)
    for (let i = 0; i < 8; i++) {
      const an = a + (hash(seed, i, 1) - 0.5) * 2 * half;
      const rr = R * (0.3 + 0.6 * hash(seed, i, 2));
      if (ink(g, C.shade, 0.35 * (1 - t / 0.25)))
        pp(g, px + Math.cos(an) * rr, py + Math.sin(an) * rr + (Math.floor(t * 40) % 2), 3, 1);
    }
  for (let i = 0; i < 5; i++) {
    const an = a + ((i - 2) / 2) * half;
    dustPuff(
      g,
      px + Math.cos(an) * R,
      py + Math.sin(an) * R,
      t - 0.08,
      3,
      seed + i * 5,
      5,
      0.45,
      1,
      an,
      1.2,
    );
  }
  g.globalAlpha = 1;
  return true;
});

// Таран попал (на герое, поверх темноты): звезда удара, полосы скорости по ходу, искры.
registerZonePainter('f13_v_ram', (g, z, px, py) => {
  const t = z.t;
  pinZ(g, z, px, py);
  const a = zf(z, 'ang');
  const seed = seedOf(z);
  const fl = 1 - k01(t / 0.14);
  if (fl > 0) {
    glowC(g, px, py - 8, 22, WARM, (reduced() ? 0.3 : 0.6) * fl);
    // Звезда удара: 8 лучей, длинные — по ходу тарана.
    if (ink(g, C.white, fl))
      for (let i = 0; i < 8; i++) {
        const an = a + (i / 8) * TAU;
        const Lr = (i === 0 ? 16 : i % 2 ? 7 : 10) * (0.6 + 0.4 * fl);
        linePx(g, px, py - 8, px + Math.cos(an) * Lr, py - 8 + Math.sin(an) * Lr * 0.8);
      }
  }
  // Полосы скорости позади удара.
  if (t < 0.25 && ink(g, C.cream, 0.7 * (1 - t / 0.25)))
    for (const o of [-6, -2, 3, 7]) {
      const ox = -Math.sin(a) * o;
      const oy = Math.cos(a) * o;
      const back = 10 + 14 * easeOut(t / 0.25);
      linePx(
        g,
        px + ox - Math.cos(a) * back,
        py - 8 + oy - Math.sin(a) * back,
        px + ox - Math.cos(a) * (back - 8),
        py - 8 + oy - Math.sin(a) * (back - 8),
      );
    }
  sparksPx(g, px, py - 8, t, 12, seed, 110, [C.white, C.gold3, C.amber], 0.35, a, 1.2);
  g.globalAlpha = 1;
  return true;
});

// Исполин осел (подрезан или конец тарана): пыль кольцом, щепа, трещины.
registerZonePainter('f13_v_slump', (g, z, px, py) => {
  const t = z.t;
  const k = life(z);
  pinZ(g, z, px, py);
  const R = z.r * TS;
  const seed = seedOf(z);
  const fade = 1 - k01((k - 0.6) / 0.4);
  dent(g, px, py + 2, R * 0.35, seed, fade * 0.8);
  for (let i = 0; i < 8; i++) {
    const an = (i / 8) * TAU + hash(seed, i, 1);
    dustPuff(
      g,
      px + Math.cos(an) * R * 0.4,
      py + Math.sin(an) * R * 0.2,
      t,
      3,
      seed + i * 3,
      R * 0.35,
      0.9,
      fade,
      an,
      0.8,
    );
  }
  splinters(
    g,
    px,
    py,
    t,
    seed + 5,
    Math.round(4 + R / 4),
    40 + R * 1.5,
    undefined,
    undefined,
    fade,
  );
  g.globalAlpha = 1;
  return true;
});

// Кукловод рубит (`f13_cut1`): нить-лезвие серпом за 0,1 с — блестящая кромка
// бежит по дуге конуса, за ней тает след; искра на острие.
registerZonePainter('f13_v_cut', (g, z, px, py, _S, time) => {
  const t = z.t;
  pinZ(g, z, px, py);
  const a = zf(z, 'ang');
  const R = z.r * TS;
  const half = BOSS.cone.arc / 2;
  const sweep = easeOut(t / 0.1);
  const a0 = a - half;
  const head = a0 + 2 * half * sweep;
  const fade = 1 - k01((t - 0.12) / 0.3);
  // След-серп: толще у острия, светлее к кромке.
  for (let j = 0; j < 4; j++) {
    const tail = Math.max(a0, head - 2 * half * (0.25 + 0.25 * j));
    const r = R - j;
    if (!ink(g, j === 0 ? C.white : j === 1 ? C.cream : C.gold2, (1 - j * 0.22) * fade)) continue;
    arcPx(g, px, py - 4, r, tail, head);
  }
  if (ink(g, C.gold1, 0.6 * fade)) arcPx(g, px, py - 4, R - 4, a0, head, 3, 0, 1);
  // Нить-лезвие от ваги к острию — пока идёт взмах.
  if (t < 0.16) {
    const [hx0, hy0] = lordHand(z, px, py);
    threadPx(g, hx0, hy0, px + Math.cos(head) * R, py - 4 + Math.sin(head) * R, {
      a: 0.9,
      sag: 0.05,
      seed: 1.1,
      time,
      lit: 1,
      glints: false,
    });
  }
  sparkPx(g, px + Math.cos(head) * R, py - 4 + Math.sin(head) * R, C.white, fade, t < 0.14);
  sparksPx(
    g,
    px + Math.cos(head) * R,
    py - 4 + Math.sin(head) * R,
    t - 0.06,
    5,
    seedOf(z),
    50,
    [C.gold3, C.white],
    0.3,
    head + Math.PI / 2,
    0.8,
  );
  g.globalAlpha = 1;
  return true;
});

// Укол (`f13_cut2`): нить-шпага выстреливает за 2 кадра, звезда на острие,
// втягивается обратно; след тает.
registerZonePainter('f13_v_thrust', (g, z, px, py, _S, time) => {
  const t = z.t;
  pinZ(g, z, px, py);
  const a = zf(z, 'ang');
  const L = zf(z, 'len') * TS;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const out = t < 0.04 ? t / 0.04 : 1 - easeIn((t - 0.12) / 0.2);
  const ext = L * k01(out);
  const y0 = py - 6;
  if (ext > 2) {
    if (ink(g, C.shade, 0.4))
      linePx(g, px + ux * 4 + 1, y0 + uy * 4 + 1, px + ux * ext + 1, y0 + uy * ext + 1);
    if (ink(g, t < 0.1 ? C.white : C.gold3, 0.95))
      linePx(g, px + ux * 4, y0 + uy * 4, px + ux * ext, y0 + uy * ext);
  }
  // След выпада тает дольше самой нити.
  const fade = 1 - k01((t - 0.05) / 0.3);
  if (ink(g, C.cream, 0.45 * fade))
    linePx(g, px + ux * 4, y0 + uy * 4 - 1, px + ux * L, y0 + uy * L - 1, 3, -time * 30, 2);
  const tx = px + ux * L;
  const ty = y0 + uy * L;
  if (t > 0.03 && t < 0.2) {
    const k = (t - 0.03) / 0.17;
    glowC(g, tx, ty, 9, WARM, (reduced() ? 0.25 : 0.45) * (1 - k));
    sparkPx(g, tx, ty, C.white, 1 - k, true);
    if (ink(g, C.cream, 0.7 * (1 - k))) arcPx(g, tx, ty, 2 + 8 * easeOut(k), 0, TAU, 3, 0, 2);
  }
  sparksPx(g, tx, ty, t - 0.04, 6, seedOf(z), 60, [C.white, C.gold3], 0.3, a, 0.9);
  g.globalAlpha = 1;
  return true;
});

// Смерть Кукловода: нити лопаются в кадре «Тела» (там и рисуются). Здесь —
// только вспышка у ваги и золотые волокна, что медленно опускаются.
registerZonePainter('f13_v_lordsnap', (g, z, px, py, _S, time) => {
  const t = z.t;
  pinZ(g, z, px, py);
  // Вага — из кадра «Тела» (`lordVagaPx`), пока умирающий ещё в мире.
  const lord = F13_FX.mobs.find((q) => q.kind === 'f13boss');
  let vx = px - 2;
  let vy = py - 44 - zf(z, 'lift') * 20;
  if (lord) {
    const [dx, dy] = lordVagaPx(lord, time);
    vx = px + (lord.x - z.x) * TS + dx;
    vy = py + (lord.y - z.y) * TS + dy;
  }
  const fl = 1 - k01(t / 0.2);
  if (fl > 0) {
    glowC(g, vx, vy, 14, WARM, (reduced() ? 0.25 : 0.5) * fl);
    sparkPx(g, vx, vy, C.white, fl, true);
  }
  for (let i = 0; i < 10; i++) {
    const t0 = hash(seedOf(z), i, 1) * 0.5;
    const u = t - t0;
    if (u < 0) continue;
    const x = vx + (hash(seedOf(z), i, 2) - 0.5) * 40 + Math.sin(time * 3 + i) * 3;
    const y = vy - 10 + u * 28;
    if (y > py) continue;
    if (ink(g, i % 2 ? C.gold2 : C.gold3, 0.9 * (1 - k01((u - 0.7) / 0.5)))) {
      pp(g, x, y);
      pp(g, x + (Math.sin(time * 5 + i) > 0 ? 1 : -1), y + 1);
    }
  }
  g.globalAlpha = 1;
  return true;
});

const TELE: RGBA = [255, 70, 50, 255];

registerZonePainter('f13_none', () => true);

const warnK = (st: Strike) => k01(st.t / Math.max(0.05, st.warn));

// Противовес: тень мешка растёт, сверху спускается мешок на канате.
registerZonePainter('f13_sandbag', (g, z, px, py) => {
  const st = z as Strike;
  const k = warnK(st);
  const R = st.r * 16;
  g.fillStyle = rgba(TELE, 0.12 + 0.2 * k);
  g.beginPath();
  g.ellipse(px, py, R, R * 0.9, 0, 0, TAU);
  g.fill();
  g.strokeStyle = rgba(TELE, 0.7);
  g.lineWidth = 1;
  g.beginPath();
  g.ellipse(px, py, R * k, R * k * 0.9, 0, 0, TAU);
  g.stroke();
  const y = py - 80 * (1 - ease(k));
  g.strokeStyle = rgba(P.cream[1], 0.9);
  g.beginPath();
  g.moveTo(px, y - 60);
  g.lineTo(px, y - 12);
  g.stroke();
  g.fillStyle = rgba(P.cream[1], 1);
  g.beginPath();
  g.ellipse(px, y - 6, 6, 7, 0, 0, TAU);
  g.fill();
  g.fillStyle = rgba(P.cream[2], 1);
  g.fillRect(px - 4, y - 11, 4, 3);
  return true;
});

// Пожарный занавес: ряд горит полосами «осторожно», сверху спускается лист.
registerZonePainter('f13_iron', (g, z, px, py, _S, time) => {
  const st = z as Strike;
  const k = warnK(st);
  const L = st.r * 16;
  const a = st.ang ?? 0;
  const w = (st.w ?? 0.5) * 16;
  g.save();
  g.translate(px, py);
  g.rotate(a);
  const blink = 0.5 + 0.5 * Math.sin(time * (10 + 14 * k));
  g.fillStyle = rgba(TELE, 0.15 + 0.25 * k);
  g.fillRect(0, -w, L, w * 2);
  for (let x = 0; x < L; x += 6) {
    g.fillStyle = rgba([230, 190, 40, 255], 0.5 + 0.4 * blink);
    g.fillRect(x, -w, 3, w * 2);
  }
  g.restore();
  // Лист железа над рядом — тень спускается.
  if (Math.abs(a) < 0.1 || Math.abs(Math.abs(a) - Math.PI) < 0.1) {
    const x0 = Math.min(px, px + Math.cos(a) * L);
    g.fillStyle = rgba(P.steel[1], 0.55 * k);
    g.fillRect(x0, py - 40 * (1 - k) - 14, L, 14);
    g.fillStyle = rgba(P.steel[3], 0.6 * k);
    g.fillRect(x0, py - 40 * (1 - k) - 14, L, 1);
  }
  return true;
});

// Барабан: кольцо-волна, кожа барабана на полу.
registerZonePainter('f13_drum', (g, z, px, py, _S, time) => {
  const st = z as Strike;
  const k = warnK(st);
  const R = st.r * 16;
  const w = (st.w ?? 0.6) * 16;
  const ri = Math.max(0, R - w);
  g.fillStyle = rgba(TELE, 0.12 + 0.24 * k);
  g.beginPath();
  g.ellipse(px, py, R, R * 0.9, 0, 0, TAU);
  g.ellipse(px, py, ri, ri * 0.9, 0, 0, TAU, true);
  g.fill('evenodd');
  g.strokeStyle = rgba(GOLD[2], 0.5 + 0.4 * Math.sin(time * 12));
  g.lineWidth = 1;
  g.beginPath();
  g.ellipse(px, py, ri + w * k, (ri + w * k) * 0.9, 0, 0, TAU);
  g.stroke();
  return true;
});

// Арлекин вынырнет: люк намечается трещинами.
registerZonePainter('f13_pop', (g, z, px, py) => {
  const st = z as Strike;
  const k = warnK(st);
  const R = st.r * 16;
  g.fillStyle = rgba(TELE, 0.14 + 0.24 * k);
  g.beginPath();
  g.ellipse(px, py, R, R * 0.9, 0, 0, TAU);
  g.fill();
  g.strokeStyle = rgba([255, 200, 120, 255], 0.5 + 0.5 * k);
  g.lineWidth = 0.8;
  g.strokeRect(px - 8, py - 6, 16, 12);
  g.beginPath();
  g.moveTo(px - 8, py);
  g.lineTo(px + 8, py);
  g.stroke();
  return true;
});

// ---- удары Кукловода по площади: метки ---------------------------------------

/** Последние 0,2 с удара по площади. */
const lastS = (st: Strike) => k01(1 - (st.warn - st.t) / SIG);

/** Колышек с катушкой: куда привязана нить сетки. */
function peg(g: G, x: number, y: number, hot: number): void {
  if (ink(g, C.ink, 0.9)) pp(g, x - 2, y - 2, 5, 5);
  if (ink(g, C.wood2, 1)) pp(g, x - 1, y - 1, 3, 3);
  if (ink(g, hot > 0 ? C.white : C.gold3, 1)) pp(g, x - 1, y - 1);
}

// Сетка нитей (акт IV): катушка катится от колышка и разматывает нить к краю,
// нить натягивается (провис уходит), к удару звенит; на полу — полоса ленты
// ровно там, где бьёт луч движка (от 0 до L).
registerZonePainter('f13_gridline', (g, z, px, py, _S, time) => {
  const st = z as Strike;
  pinZ(g, z, px, py);
  const k = warnK(st);
  const f = lastS(st);
  const L = st.r * TS;
  const a = st.ang ?? 0;
  const w = (st.w ?? 0.35) * TS;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const unroll = easeOut(k / 0.35);
  const Lv = L * unroll;
  // Полоса на полу: свет и лента по краям (поверх темноты, поэтому тихо).
  if (ink(g, C.warm, 0.06 + 0.1 * k + 0.12 * f)) fLane(g, px, py, a, 0, Lv, -w, w);
  if (ink(g, f > 0 ? C.cream : C.gold2, 0.3 + 0.4 * k)) {
    const off = reduced() ? 0 : -time * 12;
    for (const v of [-w, w])
      linePx(g, px - uy * v, py + ux * v, px + ux * Lv - uy * v, py + uy * Lv + ux * v, 5, off, 3);
  }
  // Сама нить — на высоте пояса; провис уходит к удару, к концу звенит.
  const h = 8;
  const ex = px + ux * Lv;
  const ey = py + uy * Lv - h;
  const tight = ease((k - 0.35) / 0.65);
  threadPx(g, px, py - h, ex, ey, {
    a: 0.8 + 0.2 * f,
    sag: 0.15 + 0.9 * (1 - tight),
    buzz: f * 1.4 + (k > 0.6 ? 0.3 : 0),
    lit: 0.3 + 0.7 * Math.max(tight * 0.5, f),
    seed: st.id,
    time,
    thick: f > 0,
  });
  // Катушка катится, пока нить разматывается.
  if (unroll < 1) {
    if (ink(g, C.ink, 0.9)) fDisc(g, ex, ey, 3.2);
    if (ink(g, C.wood2, 1)) fDisc(g, ex, ey, 2.4);
    if (ink(g, C.gold3, 1)) pp(g, ex + Math.cos(time * 20) * 1.5, ey + Math.sin(time * 20) * 1.5);
  }
  peg(g, px, py - h, f);
  if (unroll >= 1) peg(g, ex, ey, f);
  // Звон: поперечные чёрточки дрожи вдоль нити в последние 0,2 с.
  if (f > 0 && ink(g, C.white, 0.6 * pulse(f) + 0.2)) {
    for (let i = 1; i < 6; i++) {
      const u = i / 6;
      const x = px + ux * Lv * u;
      const y = py + uy * Lv * u - h;
      pp(g, x - uy * 3, y + ux * 3);
      pp(g, x + uy * 3, y - ux * 3);
    }
  }
  g.globalAlpha = 1;
  return true;
});

/** Фанерная молния: зигзаг из фанеры, кромка тушью, золото по ребру, свет сверху-слева. */
const boltSprite = () =>
  spr('bolt', 13, 19, (p) => {
    const pts = [
      [5, 0],
      [11, 0],
      [7, 7],
      [11, 7],
      [3, 18],
      [5, 10],
      [1, 10],
    ];
    const inside = (x: number, y: number) => {
      let c = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i];
        const [xj, yj] = pts[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
      }
      return c;
    };
    for (let y = 0; y < 19; y++)
      for (let x = 0; x < 13; x++)
        if (inside(x + 0.5, y + 0.5)) p.set(x, y, x + y < 12 ? P.cream[3] : P.cream[2]);
    // Ребро фанеры золотом с правой-нижней стороны.
    for (let y = 1; y < 19; y++)
      for (let x = 12; x > 0; x--)
        if (p.get(x - 1, y)[3] && !p.get(x, y)[3]) {
          p.set(x - 1, y, GOLD[2]);
          break;
        }
  });

// Молния «Бури»: с колосников на нити спускается фанерная молния и качается
// над целью, вокруг неё трещит заряд; на полу — холодный круг ленты,
// «когда» — лента замыкается по часовой с севера.
registerZonePainter('f13_bolt', (g, z, px, py, _S, time) => {
  const st = z as Strike;
  pinZ(g, z, px, py);
  const k = warnK(st);
  const f = lastS(st);
  const R = st.r * TS;
  const p = pulse(f);
  if (ink(g, C.cold, 0.08 + 0.14 * k + 0.12 * f)) fEll(g, px, py, R, R * 0.9);
  const off = reduced() ? 0 : time * 10;
  if (ink(g, C.shade, 0.3)) arcPx(g, px + 1, py + 1, R, 0, TAU, 5, off, 3);
  if (ink(g, C.cold, 0.55 + 0.2 * k)) arcPx(g, px, py, R, 0, TAU, 5, off, 3);
  if (ink(g, f > 0 ? (p > 0.5 ? C.white : C.cream) : C.white, 0.85))
    arcPx(g, px, py, R, -Math.PI / 2, -Math.PI / 2 + TAU * k);
  if (f > 0 && ink(g, C.white, 0.35 + 0.5 * f)) arcPx(g, px, py, R + 5 * (1 - f), 0, TAU);
  // Молния на нити: спускается и качается, заряд трещит всё чаще.
  const sw = Math.sin(time * 4 + st.id) * 0.18 * (1 - f);
  const by = py - 44 - 40 * (1 - easeOut(k));
  const bx = px + Math.sin(sw) * 10;
  threadPx(g, px, by - 70, bx, by - 9, { a: 0.8, sag: 0.05, seed: st.id, time, fade: true });
  glowC(g, bx, by, 10 + 6 * f, MOON, 0.22 + 0.35 * f);
  blit(g, boltSprite(), bx, by);
  const crack = Math.floor(time * (8 + 24 * k));
  if (hash(crack, st.id, 5) < 0.35 + 0.6 * k && ink(g, C.moonL, 0.9)) {
    // Искра заряда: короткий зигзаг у кромки фанеры.
    const an = hash(crack, st.id, 6) * TAU;
    const x0 = bx + Math.cos(an) * 7;
    const y0 = by + Math.sin(an) * 9;
    linePx(g, x0, y0, x0 + Math.cos(an) * 3, y0 + Math.sin(an) * 3 + 2);
  }
  if (f > 0) sparkPx(g, bx, by - 2, C.white, f, p > 0.5);
  g.globalAlpha = 1;
  return true;
});

// Копоть на палубе после молнии (на полу, под мобами): ставится вместе с
// ударом и ждёт его предупреждение, потом дымит и тает 2 с.
registerZonePainter('f13_v_scorch', (g, z, px, py, _S, time) => {
  const u = z.t - BOSS.bolt.warn;
  if (u < 0) return true;
  pinZ(g, z, px, py);
  const R = BOSS.bolt.r * TS;
  const seed = seedOf(z);
  const fade = 1 - k01((u - 1.4) / 0.8);
  if (ink(g, C.soot, 0.55 * fade)) fEll(g, px, py, R * 0.75, R * 0.6);
  if (ink(g, C.shade, 0.5 * fade)) fEll(g, px, py, R * 0.4, R * 0.3);
  for (let i = 0; i < 6; i++) {
    const an = (i / 6) * TAU + hash(seed, i, 1);
    boardCrack(
      g,
      px + Math.cos(an) * R * 0.4,
      py + Math.sin(an) * R * 0.3,
      an,
      R * 0.6,
      seed + i,
      0.5 * fade,
    );
  }
  // Тлеет: угольки гаснут, дым тянется вверх.
  if (u < 0.8)
    for (let i = 0; i < 5; i++)
      if (ink(g, i % 2 ? C.amber : '#ff7a3a', (1 - u / 0.8) * (0.5 + 0.5 * Math.sin(time * 9 + i))))
        pp(g, px + (hash(seed, i, 4) - 0.5) * R, py + (hash(seed, i, 5) - 0.5) * R * 0.6);
  spray(
    g,
    px,
    py,
    u,
    {
      n: 6,
      seed: seed + 3,
      v: [2, 6],
      rise: 14,
      life: [1, 1.6],
      size: [2, 3],
      cols: ['#4a4450', '#2e2a34'],
      delay: 0.6,
    },
    0.5 * fade,
  );
  g.globalAlpha = 1;
  return true;
});

/** Меловой силуэт героя: голова, плечи, ноги — пиксельным мелом. */
function chalkFigure(g: G, x: number, y: number, a: number, col: string): void {
  if (!ink(g, col, a)) return;
  arcPx(g, x, y - 13, 2.6, 0, TAU);
  polyPx(g, [x - 4, y - 9, x + 4, y - 9, x + 3, y - 3, x - 3, y - 3, x - 4, y - 9]);
  linePx(g, x - 2, y - 3, x - 3, y);
  linePx(g, x + 2, y - 3, x + 3, y);
}

// «По памяти» (акт III): мелом обводят место, где ты стоял секунду назад, —
// круг дорисовывается рукой, внутри проступает твой меловой силуэт.
registerZonePainter('f13_memory', (g, z, px, py) => {
  const st = z as Strike;
  pinZ(g, z, px, py);
  const k = warnK(st);
  const f = lastS(st);
  const R = st.r * TS;
  const p = pulse(f);
  if (ink(g, C.chalkD, 0.1 + 0.14 * k + 0.1 * f)) fEll(g, px, py, R, R * 0.9);
  // Мел ведёт круг за 40% метки: «куда» — сразу пунктиром, сплошной — рукой.
  const draw = easeOut(k / 0.4);
  if (ink(g, C.chalkD, 0.5)) arcPx(g, px, py, R, 0, TAU, 4, 0, 2);
  if (ink(g, f > 0 ? (p > 0.5 ? C.white : C.chalk) : C.chalk, 0.8 + 0.2 * f))
    arcPx(g, px, py, R, -Math.PI / 2, -Math.PI / 2 + TAU * draw);
  if (draw < 1) {
    const ca = -Math.PI / 2 + TAU * draw;
    sparkPx(g, px + Math.cos(ca) * R, py + Math.sin(ca) * R, C.white, 1);
  }
  // Штриховка налива — кольцо от края к центру («когда»).
  const fill = R * (1 - easeIn(k));
  if (fill > 1 && ink(g, C.chalk, 0.3 + 0.2 * k)) arcPx(g, px, py, fill, 0, TAU, 3, 0, 1);
  if (f > 0 && ink(g, C.white, 0.35 + 0.5 * f)) arcPx(g, px, py, R + 5 * (1 - f), 0, TAU);
  chalkFigure(g, px, py, 0.3 + 0.55 * k, f > 0 ? C.white : C.chalk);
  g.globalAlpha = 1;
  return true;
});

// ---- контакты ударов ----------------------------------------------------------

function impact(
  art: string,
  paint: (g: G, r: ImpactRec, px: number, py: number, k: number, time: number) => void,
  life0: number,
  shake = 0.15,
  above = false,
  flash = 0,
  flashRgb?: string,
): void {
  registerImpactPainter(art, {
    life: life0,
    shake,
    above,
    flash,
    flashRgb,
    paint: (g, rec, px, py, _S, age, time) => {
      pin(g, px - rec.x * TS, py - rec.y * TS);
      paint(g, rec, px, py, k01(age / life0), time);
      g.globalAlpha = 1;
      return age < life0;
    },
  });
}

impact(
  'f13_sandbag',
  (g, r, px, py, k) => {
    g.fillStyle = rgba(P.cream[1], 1 - k);
    g.beginPath();
    g.ellipse(px, py - 4, 7, 5, 0, 0, TAU);
    g.fill();
    burst(g, px, py, k, 14, r.seed, [P.cream[2], P.cream[1], P.wood[2]], 18, 4);
  },
  0.6,
  0.25,
);

impact(
  'f13_iron',
  (g, r, px, py, k) => {
    burst(g, px, py - 6, k, 18, r.seed, [GOLD[3], [255, 255, 255, 255], P.steel[3]], 26, 6);
  },
  0.5,
  0.3,
);

impact(
  'f13_drum',
  (g, r, px, py, k) => {
    const R = (r.r ?? 3) * 16;
    g.strokeStyle = rgba(GOLD[3], 1 - k);
    g.lineWidth = 2 * (1 - k);
    g.beginPath();
    g.ellipse(px, py, R * (0.8 + 0.4 * k), R * (0.8 + 0.4 * k) * 0.9, 0, 0, TAU);
    g.stroke();
  },
  0.4,
  0.2,
);

impact(
  'f13_pop',
  (g, r, px, py, k) => burst(g, px, py, k, 12, r.seed, [P.wood[2], P.red[2], GOLD[2]], 16, 8),
  0.5,
  0.12,
);

// Нить сетки ударила: вспыхнула струной, лопнула посередине, половины
// хлестнули к колышкам. Тряска мала — бьют шестнадцать отрезков разом.
impact(
  'f13_gridline',
  (g, r, px, py, k, time) => {
    const t = k * 0.5;
    const a = r.ang ?? 0;
    const L = (r.r ?? 4) * TS;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const h = 8;
    const y0 = py - h;
    if (t < 0.06) {
      // Струна: белая, толстая, во всю длину.
      if (ink(g, C.white, 1)) {
        linePx(g, px, y0, px + ux * L, y0 + uy * L);
        linePx(g, px, y0 - 1, px + ux * L, y0 + uy * L - 1);
      }
      glowC(g, px + (ux * L) / 2, y0 + (uy * L) / 2, L / 2 + 4, WARM, reduced() ? 0.12 : 0.25, 0.3);
    } else {
      // Обрыв: половины сворачиваются к колышкам волной.
      const u = easeOut((t - 0.06) / 0.25);
      const half = (L / 2) * (1 - u);
      const fade = 1 - k01((t - 0.3) / 0.2);
      for (const s of [0, 1]) {
        const bx = s ? px + ux * L : px;
        const by = s ? y0 + uy * L : y0;
        const dir = s ? -1 : 1;
        const at = (q: number): [number, number] => {
          const w = Math.sin(q * 9 - t * 40) * 3 * q * (1 - u);
          return [
            bx + ux * dir * half * q - uy * w,
            by + uy * dir * half * q + ux * w + q * q * 6 * u,
          ];
        };
        if (half > 1 && ink(g, C.gold2, 0.95 * fade)) curvePx(g, at, half + 4);
      }
    }
    const cx = px + (ux * L) / 2;
    const cy = y0 + (uy * L) / 2;
    if (t >= 0.05) sparksPx(g, cx, cy, t - 0.05, 6, r.seed, 60, [C.white, C.gold3], 0.3);
    if (t >= 0.05 && t < 0.12) sparkPx(g, cx, cy, C.white, 1, true);
    void time;
  },
  0.5,
  0.025,
  true,
);

// Молния ударила: фанера падает на палубу и подпрыгивает, белый разряд
// зигзагом сверху, кольцо и искры (копоть — `f13_v_scorch` на полу).
impact(
  'f13_bolt',
  (g, r, px, py, k) => {
    const t = k * 0.6;
    const R = (r.r ?? 1.2) * TS;
    if (t < 0.09) {
      glowC(g, px, py - 10, R + 18, MOON, reduced() ? 0.3 : 0.6);
      // Разряд: ствол зигзагом с колосников в точку удара и отросток вбок.
      const bolt = (x0: number, y0: number, x1: number, y1: number, n: number, q: number) => {
        let x = x0;
        let y = y0;
        for (let i = 1; i <= n; i++) {
          const u = i / n;
          const side = (i % 2 ? 1 : -1) * (3 + 6 * hash(r.seed, i, q));
          const nx = i === n ? x1 : lerp(x0, x1, u) + side;
          const ny = lerp(y0, y1, u);
          linePx(g, x, y, nx, ny);
          if (q === 1) linePx(g, x + 1, y, nx + 1, ny);
          x = nx;
          y = ny;
        }
      };
      if (ink(g, C.white, 1 - t / 0.09)) bolt(px + 6, py - 100, px, py - 6, 8, 1);
      if (ink(g, C.moonL, 0.9 * (1 - t / 0.09))) {
        const fy = py - 100 + (94 * 3) / 8;
        bolt(px + 4, fy, px - 16, fy + 30, 4, 2);
      }
    }
    // Фанера бьётся о палубу, подпрыгивает и ложится набок.
    const hop =
      t < 0.05 ? 40 * (1 - t / 0.05) : t < 0.25 ? Math.sin(((t - 0.05) / 0.2) * Math.PI) * 6 : 0;
    blit(g, boltSprite(), px + 2, py - 9 - hop, 1 - k01((k - 0.7) / 0.3));
    if (t < 0.2 && ink(g, C.cold, 0.8 * (1 - t / 0.2)))
      arcPx(g, px, py, R * (0.6 + 0.8 * easeOut(t / 0.2)), 0, TAU, 3, 0, 2);
    sparksPx(
      g,
      px,
      py - 4,
      t,
      14,
      r.seed,
      120,
      [C.white, C.moonL, C.gold3],
      0.4,
      -Math.PI / 2,
      Math.PI,
    );
  },
  0.6,
  0.3,
  true,
  0.3,
  '200,220,255',
);

// «По памяти» сработало: мел взрывается облачком, силуэт смазан и тает.
impact(
  'f13_memory',
  (g, r, px, py, k) => {
    const t = k * 0.6;
    const R = (r.r ?? 1.5) * TS;
    const fade = 1 - k01((k - 0.5) / 0.5);
    // Смазанный силуэт: две копии со сдвигом.
    chalkFigure(g, px - 1, py, 0.6 * fade, C.chalk);
    chalkFigure(g, px + 1, py + 1, 0.35 * fade, C.chalkD);
    if (t < 0.25 && ink(g, C.chalk, 0.8 * (1 - t / 0.25)))
      arcPx(g, px, py, R * (0.8 + 0.5 * easeOut(t / 0.25)), 0, TAU, 3, 0, 2);
    spray(g, px, py, t, {
      n: 18,
      seed: r.seed,
      v: [R * 0.6, R * 1.8],
      drag: 3,
      rise: 10,
      life: [0.4, 0.6],
      size: [1, 3],
      cols: [C.chalk, C.white, C.chalkD],
      r0: R * 0.3,
    });
  },
  0.6,
  0.2,
);

// Игла Кукловода: 16 поворотов, серебро с бликом, ушко с золотой ниткой.
// Вылетает из руки и за 0,25 с опускается к полу (`needleLift`); нитка
// хвостом — в режиссёре поверх темноты.
const dir16 = (s: Shot) => ((Math.round((Math.atan2(s.vy, s.vx) / TAU) * 16) % 16) + 16) % 16;
registerShotPainter('f13_needle', (s) => {
  const d = dir16(s);
  const base = shotSprite(`needle16_${d}`, 16, 16, (p) => {
    const a = (d / 16) * TAU;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const cx = 8;
    const cy = 8;
    p.line(cx - ca * 5, cy - sa * 5, cx + ca * 5, cy + sa * 5, P.silver[2]);
    p.line(cx - ca * 4 - sa * 0.6, cy - sa * 4 + ca * 0.6, cx + ca * 3, cy + sa * 3, P.silver[3]);
    p.set(cx + ca * 5, cy + sa * 5, hx('#ffffff'));
    p.set(cx + ca * 6, cy + sa * 6, hx('#ffffff'));
    p.set(cx - ca * 5, cy - sa * 5, P.gold[2]);
    p.set(cx - ca * 6 + sa, cy - sa * 6 - ca, P.gold[3]);
  });
  return { img: base.img, ax: base.ax, ay: base.ay + Math.round(needleLift(s)) };
});

// Игла вонзилась: игла торчит из доски и дрожит, нитка ложится, блеск.
impact(
  'f13_needle',
  (g, r, px, py, k, time) => {
    const a = Math.atan2(r.vy ?? 0, r.vx ?? 1);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const q = reduced() ? 0 : Math.round(Math.sin(time * 60) * 1.2 * (1 - k) * (1 - k));
    const al = 1 - k01((k - 0.7) / 0.3);
    const ex = px - ca * 5 + q;
    const ey = py - 5 - sa * 2;
    if (ink(g, C.shade, 0.4 * al)) linePx(g, px + 1, py, px - ca * 6 + 1, py - sa * 2 + 1);
    if (ink(g, C.silver3, al)) linePx(g, px, py, ex, ey);
    if (ink(g, C.gold2, al))
      curvePx(
        g,
        (s) => [lerp(ex, px - ca * 13, s), lerp(ey, py + 1, s) - Math.sin(s * Math.PI) * 2],
        10,
      );
    if (k < 0.3) sparkPx(g, px, py - 1, C.white, 1 - k / 0.3, k < 0.1);
    sparksPx(g, px, py - 2, k * 0.5, 5, r.seed, 40, [C.silver3, C.gold3], 0.25);
  },
  0.5,
  0.1,
);

// Прогрев: картинки звёзд, месяца и молнии рисуются заранее, по одной за шаг.
registerMobWarm('f13boss', function* () {
  moonSprite();
  yield;
  boltSprite();
  yield;
  cloudSprite();
  yield;
  for (let ph = 0; ph < 12; ph++) {
    starArc(STAR.L, ph);
    if (ph % 3 === 2) yield;
  }
  starSprite('shade', 6.5, 0);
  for (let rs = 0; rs < STAR_ROT; rs++) {
    starSprite('gold', 9, rs);
    starSprite('dim', 6, rs);
    yield;
    for (const r of [5, 6, 7]) starSprite('ghost', r, rs);
    yield;
  }
});

const SHOT_CACHE = new Map<string, Sprite>();
function shotSprite(key: string, w: number, h: number, draw: (p: Px) => void): Sprite {
  let s = SHOT_CACHE.get(key);
  if (!s) {
    const p = new Px(w, h);
    draw(p);
    p.outline(INK);
    s = { img: p.canvas(), ax: w / 2, ay: h / 2 + 6 };
    SHOT_CACHE.set(key, s);
  }
  return s;
}

const dir8 = (s: Shot) => ((Math.round((Math.atan2(s.vy, s.vx) / TAU) * 8) % 8) + 8) % 8;

// Листок роли — кружится.
registerShotPainter('f13_page', (s, time) => {
  const f = Math.floor(time * 12 + s.id) % 4;
  return shotSprite(`page${f}`, 9, 9, (p) => {
    const w = [3, 2, 1, 2][f];
    p.rect(4 - w, 2, 4 + w, 6, P.cream[3]);
    if (w > 1) {
      p.line(4 - w + 1, 3, 4 + w - 1, 3, P.cream[0]);
      p.line(4 - w + 1, 5, 4 + w - 1, 5, P.cream[0]);
    }
  });
});

// Нота скрипача — светится, режет нити.
registerShotPainter('f13_note', (s, time) => {
  const f = Math.floor(time * 8 + s.id) % 2;
  return shotSprite(`note${f}${s.id % 2}`, 9, 11, (p) => {
    const c = s.id % 2 ? hx('#a8e0ff') : hx('#ffe08a');
    p.ell(3, 8, 2.4, 1.8, c);
    p.rect(5, 1 + f, 5, 8, c);
    p.line(5, 1 + f, 8, 3 + f, c);
  });
});

registerShotPainter('f13_tear', (s) =>
  shotSprite(`tear${dir8(s)}`, 9, 9, (p) => {
    p.ell(4.5, 5, 2.6, 2.6, hx('#6ac8ff'));
    p.set(4, 2, hx('#6ac8ff'));
    p.set(4, 3, hx('#bfe8ff'));
    p.set(3, 4, hx('#ffffff'));
  }),
);

impact(
  'f13_note',
  (g, r, px, py, k) => burst(g, px, py - 6, k, 6, r.seed, [[168, 224, 255, 255], GOLD[3]], 8),
  0.3,
  0,
);
impact(
  'f13_page',
  (g, r, px, py, k) => burst(g, px, py - 6, k, 6, r.seed, [P.cream[3], P.cream[1]], 8),
  0.3,
  0,
);
impact(
  'f13_tear',
  (g, r, px, py, k) =>
    burst(
      g,
      px,
      py - 6,
      k,
      6,
      r.seed,
      [
        [106, 200, 255, 255],
        [255, 255, 255, 255],
      ],
      8,
    ),
  0.3,
  0,
);
