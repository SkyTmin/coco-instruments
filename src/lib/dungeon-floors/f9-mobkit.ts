// Этаж 9 «Лабиринт гидры» — общий набор рисунка мобов (анимации мобов 9).
// Мобы собраны из примитивов мини-3D (`f15-rig.ts`, только импорт) и
// смотрят в одну из 8 сторон — туда, куда идут: курс с пределом поворота,
// шаг по пройденному пути. Техники — 24 к/с от времени режима (стоп-кадр
// мозга держит позу сам), кадр контакта — в миг урона мозга
// (`f9-brains.ts`).
//
// Кадр строится раз на позу и сторону и живёт в кеше вида с вытеснением
// (`frameLRU`). Холст обрезается до рисунка (площадь кадра — главная цена
// вывода толпы), якорь и слой `lit` сдвигаются следом. Вспышка удара героя —
// заливкой готового холста (своя копия на холст, без нового рисунка),
// облик (элита, альбинос) — в ключе кадра. Память рисунка (курс, путь,
// прошлый режим, миг удара, перенос) — в `VIS` по номеру моба: в `m.data`
// рисунок не пишет.

import { Px } from '../dungeon-art';
import { frameLRU, paintSim } from '../dungeon-paint';
import type { FrameLRU, MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import { SE, renderRig, vdot, vlen, vmul, vnorm, vsub } from './f15-rig';
import type { RGBA, Rig, Tones, V3 } from './f15-rig';

export type { RGBA, Tones, V3 };
export type Look = MobPose['look'];

export const PI = Math.PI;
export const TAU = PI * 2;
export const FPS = 24;

export const hx = (h: string, a = 255): RGBA => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
  a,
];
export const tn = (a: string, b: string, c: string, d: string): Tones => [
  hx(a),
  hx(b),
  hx(c),
  hx(d),
];
export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
export const mixc = (a: RGBA, b: RGBA, k: number): RGBA => [
  Math.round(a[0] + (b[0] - a[0]) * k),
  Math.round(a[1] + (b[1] - a[1]) * k),
  Math.round(a[2] + (b[2] - a[2]) * k),
  a[3],
];
export const alpha = (c: RGBA, a: number): RGBA => [c[0], c[1], c[2], Math.round(clamp01(a) * 255)];
export const smooth = (k: number) => {
  const x = clamp01(k);
  return x * x * (3 - 2 * x);
};
export const sstep = (a: number, b: number, x: number) => smooth((x - a) / (b - a));
export const easeOut = (k: number) => 1 - (1 - clamp01(k)) ** 3;
export const easeIn = (k: number) => clamp01(k) ** 2;
export const easeIn3 = (k: number) => clamp01(k) ** 3;
export const lin = (k: number) => clamp01(k);
export const vadd = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const vlerp = (a: V3, b: V3, k: number): V3 => [
  a[0] + (b[0] - a[0]) * k,
  a[1] + (b[1] - a[1]) * k,
  a[2] + (b[2] - a[2]) * k,
];

/** Колено (локоть) между `a` и `c` при длинах `l1`, `l2`, сгиб — в сторону `bend`. */
export function ik2(a: V3, c: V3, l1: number, l2: number, bend: V3): V3 {
  const d = vsub(c, a);
  const L = Math.max(0.01, Math.min(vlen(d), l1 + l2 - 0.01));
  const u = vnorm(d);
  const x = (l1 * l1 - l2 * l2 + L * L) / (2 * L);
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  const b = vnorm(vsub(bend, vmul(u, vdot(bend, u))));
  return vadd(vadd(a, vmul(u, x)), vmul(b, h));
}

/** Детерминированный шум 0…1 по числам (рисунок не трогает `sim.rng`). */
export const hash = (a: number, b: number, c = 0) => {
  let h = (a * 374761393 + b * 668265263 + c * 1274126177) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** Номер кадра техники 24 к/с (0…max). */
export const fi = (t: number, max: number) =>
  Math.min(max, Math.max(0, Math.floor(t * FPS + 1e-6)));
/** Время середины кадра `f` техники, с. */
export const tf = (f: number) => (f + 0.5) / FPS;
export const mod = (n: number, k: number) => ((Math.floor(n) % k) + k) % k;

type Ease = (x: number) => number;
export type Key = [number, number, Ease?];
/** Дорожка ключей: время → значение; кривая — у ключа, к которому идём. */
export function trk(k: number, keys: Key[]): number {
  if (k <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [k1, v1, e] = keys[i];
    if (k <= k1) {
      const [k0, v0] = keys[i - 1];
      const x = (k - k0) / (k1 - k0 || 1);
      return v0 + (v1 - v0) * (e ?? smooth)(x);
    }
  }
  return keys[keys.length - 1][1];
}

export const INK = hx('#150f0b');
export const WHITE = hx('#ffffff');
export const GOLD = hx('#ffcc40');

// ---------------------------------------------------------------------------
// Стороны и ход.
// ---------------------------------------------------------------------------

export const NDIR = 8;
/** Игровой угол → курс рига: на экране морда смотрит точно туда же. */
export const rigYaw = (a: number) => Math.atan2(Math.sin(a), SE * Math.cos(a));
export const dirN = (a: number) => mod(Math.round((a / TAU) * NDIR), NDIR);
export const yawN = (d: number) => rigYaw((d / NDIR) * TAU);
export const angD = (a: number, b: number) => {
  let d = (a - b) % TAU;
  if (d > PI) d -= TAU;
  if (d < -PI) d += TAU;
  return d;
};
/** Ближний к камере бок при курсе рига: +1 — правый (s > 0). */
export const camSide = (yaw: number) => (Math.cos(yaw) >= 0 ? 1 : -1);

export const speedOf = (m: Mob) => Math.hypot(m.vx ?? 0, m.vy ?? 0);
export const moving = (m: Mob, thr = 0.4) => speedOf(m) > thr;
/** Курс по ходу: движется — по скорости, стоит — куда смотрит. */
export const headOf = (m: Mob, thr = 0.4) =>
  moving(m, thr) ? Math.atan2(m.vy, m.vx) : (m.face ?? 0);

export interface Vis {
  now: number;
  x: number;
  y: number;
  /** Пройденный путь, клетки (шаг — по нему). */
  dist: number;
  /** Курс рисунка, игровой угол (сглажен пределом поворота). */
  yaw: number;
  /** Скорость поворота курса, рад/с (сглажена) — изгиб длинного тела. */
  spin: number;
  mode: string;
  prev: string;
  /** Миг удара героя (часы рендера) и откуда — угол от героя к мобу. */
  hitAt: number;
  hitAng: number;
  flash: number;
  /** Миг мгновенного переноса (круг-телепорт) и откуда (клетки). */
  warpAt: number;
  wx: number;
  wy: number;
}
const VIS = new Map<number, Vis>();

/**
 * Ход моба для рисунка: курс с пределом поворота (рад/с), путь, прошлый
 * режим, удар героя, перенос. Мир не движется на листе кадров — там путь
 * идёт от скорости.
 */
export function visOf(m: Mob, pose: MobPose, want: number, turn: number): Vis {
  const id = m.id ?? -1;
  const x = m.x ?? 0;
  const y = m.y ?? 0;
  const now = pose.now || 0;
  let v = VIS.get(id);
  // Время пошло назад (лист кадров, новый бой) — память заново.
  if (v && (now < v.now - 0.05 || now - v.now > 1.5)) v = undefined;
  if (!v) {
    v = {
      now,
      x,
      y,
      dist: 0,
      yaw: want,
      spin: 0,
      mode: pose.mode,
      prev: '',
      hitAt: -9,
      hitAng: 0,
      flash: 0,
      warpAt: -9,
      wx: x,
      wy: y,
    };
    VIS.set(id, v);
    if (VIS.size > 300) VIS.delete(VIS.keys().next().value as number);
  }
  const dt = clamp(now - v.now, 0, 0.1);
  if (dt > 0) {
    const moved = Math.hypot(x - v.x, y - v.y);
    if (moved > 1.2 && paintSim()) {
      // Перенос кругом: в мире моб прыгнул сразу на клетки.
      v.warpAt = now;
      v.wx = v.x;
      v.wy = v.y;
    } else v.dist += paintSim() ? Math.min(moved, 0.5) : speedOf(m) * dt;
    const mx = turn * dt;
    const step = clamp(angD(want, v.yaw), -mx, mx);
    v.yaw += step;
    v.spin += (step / dt - v.spin) * Math.min(1, dt * 6);
  }
  v.x = x;
  v.y = y;
  v.now = now;
  if (pose.mode !== v.mode) {
    v.prev = v.mode;
    v.mode = pose.mode;
  }
  const fl = m.flash ?? 0;
  if (fl > v.flash + 0.01 && pose.mode !== 'dying') {
    v.hitAt = now;
    const sim = paintSim();
    const kx = m.kx ?? 0;
    const ky = m.ky ?? 0;
    v.hitAng = sim
      ? Math.atan2(y - sim.hero.y, x - sim.hero.x)
      : Math.hypot(kx, ky) > 0.01
        ? Math.atan2(ky, kx)
        : (m.face ?? 0) + PI;
  }
  v.flash = fl;
  return v;
}

/**
 * Реакция на удар героя (0,22 с, 5 кадров) поверх любой позы: отброс
 * корпуса по удару, вжатие, наклон прочь, возврат — полями кадра.
 */
export function hurtFields(v: Vis, now: number, ex: Partial<MobFrame>, k = 1): void {
  const a = now - v.hitAt;
  if (a < 0 || a > 0.22) return;
  const out = a < 0.04 ? easeOut(a / 0.04) : 1 - sstep(0.04, 0.22, a);
  const sq = a < 0.09 ? 1 - a / 0.09 : 0;
  const cx = Math.cos(v.hitAng);
  const cy = Math.sin(v.hitAng);
  ex.dx = (ex.dx ?? 0) + cx * 1.8 * out * k;
  ex.dy = (ex.dy ?? 0) + cy * 0.9 * out * k;
  ex.rot = (ex.rot ?? 0) + cx * 0.1 * out * k;
  ex.sx = (ex.sx ?? 1) * (1 + 0.1 * sq * k);
  ex.sy = (ex.sy ?? 1) * (1 - 0.1 * sq * k);
}
/** Сколько прошло после удара героя, с (для позы ушиба), или -1. */
export const hurtAge = (v: Vis, now: number) => {
  const a = now - v.hitAt;
  return a >= 0 && a < 0.25 ? a : -1;
};

// ---------------------------------------------------------------------------
// Кадр: риг → обрезанный холст → кеш вида.
// ---------------------------------------------------------------------------

export interface Kind {
  name: string;
  w: number;
  h: number;
  ax: number;
  ay: number;
  frames: FrameLRU<MobFrame>;
  /** Предел кеша (для стенда). */
  limit: number;
  /** Масштаб рига: позы задаются в «своих» пикселях, рисунок — крупнее. */
  s: number;
  /** Стенд: охват всех построенных кадров на холсте [x0, y0, x1, y1]. */
  ext: [number, number, number, number];
}
const KINDS: Kind[] = [];
/**
 * Вид моба: холст `w×h` с точкой ног `(ax, ay)` — в пикселях кадра (по
 * охвату всех кадров вида, с запасом); `s` — во сколько раз риг крупнее
 * своих поз.
 */
export function kindOf(
  name: string,
  w: number,
  h: number,
  ax: number,
  ay: number,
  limit: number,
  s = 1,
): Kind {
  const K: Kind = {
    name,
    w,
    h,
    ax,
    ay,
    frames: frameLRU<MobFrame>(limit),
    limit,
    s,
    ext: [1e9, 1e9, -1, -1],
  };
  KINDS.push(K);
  return K;
}

/** Риг крупнее в `k` раз от точки ног (все примитивы и глаз). */
function scaleRig(r: Rig, k: number): void {
  const s = (p: V3): V3 => [p[0] * k, p[1] * k, p[2] * k];
  for (const q of r.prims) {
    if (q.k === 0) {
      q.c = s(q.c);
      q.a = [s(q.a[0]), s(q.a[1]), s(q.a[2])];
    } else if (q.k === 1) {
      q.a = s(q.a);
      q.b = s(q.b);
      q.r0 *= k;
      q.r1 *= k;
    } else if (q.k === 2) {
      q.pts = q.pts.map(s);
      q.bias *= k;
    } else if (q.k === 3) {
      q.p = s(q.p);
      q.bias *= k;
    } else {
      q.a = s(q.a);
      q.b = s(q.b);
      q.bias *= k;
    }
  }
  if (r.eye) r.eye = s(r.eye);
}

/**
 * Замер для стенда: цена нового кадра (мс), сколько построено по видам и
 * последние промахи кеша (что рисуется заново в бою).
 */
export const F9_MOB_STAT = {
  n: 0,
  ms: [] as number[],
  by: {} as Record<string, number>,
  /** Цена нового кадра по видам, мс (до 3000 на вид). */
  kms: {} as Record<string, number[]>,
  /** Из неё — рисунок рига (остальное — облик, обрезка, холст), мс. */
  build: 0,
  /** Сколько кадров вида несут слой поверх темноты. */
  lit: {} as Record<string, number>,
  bake: 0,
  miss: [] as string[],
  sizes: () => Object.fromEntries(KINDS.map((K) => [K.name, [K.frames.size, K.limit]])),
  ext: () => Object.fromEntries(KINDS.map((K) => [K.name, [K.w, K.h, ...K.ext]])),
  clear: () => {
    for (const K of KINDS) K.frames.clear();
  },
};
function stat(kind: string, ms: number, key: string): void {
  F9_MOB_STAT.n++;
  if (F9_MOB_STAT.ms.length < 4000) F9_MOB_STAT.ms.push(ms);
  F9_MOB_STAT.by[kind] = (F9_MOB_STAT.by[kind] ?? 0) + 1;
  const km = (F9_MOB_STAT.kms[kind] ??= []);
  if (km.length < 3000) km.push(ms);
  F9_MOB_STAT.miss.push(`${kind}|${key}`);
  if (F9_MOB_STAT.miss.length > 600) F9_MOB_STAT.miss.splice(0, 300);
}

function paleOf(p: Px): Px {
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
  return q;
}

/** Золотой кант элиты — кольцом снаружи контура. */
function goldEdge(p: Px): void {
  const solid = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < p.w && y < p.h && p.data[(y * p.w + x) * 4 + 3] >= 200;
  const add: number[] = [];
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      if (p.data[(y * p.w + x) * 4 + 3] >= 100) continue;
      if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) add.push(x, y);
    }
  for (let i = 0; i < add.length; i += 2) p.set(add[i], add[i + 1], GOLD);
}

/** Вырезать прямоугольник из буфера в холст. */
function cut(p: Px, x0: number, y0: number, w: number, h: number): HTMLCanvasElement {
  if (!x0 && !y0 && w === p.w && h === p.h) return p.canvas();
  const q = new Px(w, h);
  for (let y = 0; y < h; y++) {
    const s = ((y + y0) * p.w + x0) * 4;
    q.data.set(p.data.subarray(s, s + w * 4), y * w * 4);
  }
  return q.canvas();
}

export interface Pic {
  p: Px;
  lit: Px | null;
  eye: [number, number] | null;
}

/** Рисунок рига на холсте вида (внешний контур — чернилами, внутренний — по глубине). */
export function drawRig(K: Kind, r: Rig, inner = 2.2, outline: RGBA | null = INK): Pic {
  if (K.s !== 1) scaleRig(r, K.s);
  const o = renderRig(r, K.w, K.h, K.ax, K.ay, { outline, inner: inner * K.s });
  return { p: o.p, lit: o.lit, eye: o.eye };
}

/** Готовый рисунок → кадр: облик, обрезка до рисунка, якорь и `lit` — следом. */
function bake(K: Kind, pic: Pic, look: Look): MobFrame {
  let p = pic.p;
  if (look === 'albino') p = paleOf(p);
  if (look === 'elite') {
    if (p === pic.p) {
      const q = new Px(p.w, p.h);
      q.data.set(p.data);
      p = q;
    }
    goldEdge(p);
  }
  const { w, h, data } = p;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0, i = y * w * 4 + 3; x < w; x++, i += 4)
      if (data[i]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
  if (x1 < 0) {
    x0 = 0;
    y0 = 0;
    x1 = 0;
    y1 = 0;
  }
  const e = K.ext;
  if (x1 >= 0) {
    if (x0 < e[0]) e[0] = x0;
    if (y0 < e[1]) e[1] = y0;
    if (x1 > e[2]) e[2] = x1;
    if (y1 > e[3]) e[3] = y1;
  }
  const cw = x1 + 1 - x0;
  const ch = y1 + 1 - y0;
  const img = cut(p, x0, y0, cw, ch);
  let lit: HTMLCanvasElement | null = null;
  if (pic.lit) {
    // Слой поверх темноты — только до последней светящейся точки.
    let lx = -1;
    let ly = -1;
    const L = pic.lit.data;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++)
        if (L[(y * w + x) * 4 + 3]) {
          if (x > lx) lx = x;
          ly = y;
        }
    if (lx >= 0) {
      lit = cut(pic.lit, x0, y0, lx + 1 - x0, ly + 1 - y0);
      F9_MOB_STAT.lit[K.name] = (F9_MOB_STAT.lit[K.name] ?? 0) + 1;
    }
  }
  return {
    img,
    ax: K.ax - x0,
    ay: K.ay - y0,
    eye: pic.eye ? [pic.eye[0] - x0, pic.eye[1] - y0] : null,
    lit,
  };
}

/** Кадр вида: поза `anim`, кадр `f`, сторона `d` (ключ — всё, что меняет рисунок). */
export function frameOf(
  K: Kind,
  anim: string,
  f: number,
  d: number,
  look: Look,
  build: () => Pic,
): MobFrame {
  const key = `${anim}|${f}|${d}|${look}`;
  let fr = K.frames.get(key);
  if (fr) return fr;
  const t0 = performance.now();
  const pic = build();
  const t1 = performance.now();
  fr = K.frames.set(key, bake(K, pic, look));
  const t2 = performance.now();
  F9_MOB_STAT.build += t1 - t0;
  F9_MOB_STAT.bake += t2 - t1;
  stat(K.name, t2 - t0, key);
  return fr;
}

/**
 * Вспышка удара героя — белым поверх готового холста. Копия на холст
 * одна (`WeakMap`): вспышка не множит кадры кеша и не рисует риг заново.
 */
const FLASHED = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();
function flashImg(img: HTMLCanvasElement): HTMLCanvasElement {
  let c = FLASHED.get(img);
  if (!c) {
    c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d');
    if (g) {
      g.drawImage(img, 0, 0);
      g.globalCompositeOperation = 'source-atop';
      g.globalAlpha = 0.85;
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, c.width, c.height);
    }
    FLASHED.set(img, c);
  }
  return c;
}

/** Кадр + поля хода + вспышка: то, что отдаёт рисовальщик. */
export function out(fr: MobFrame, ex: Partial<MobFrame>, flash: boolean): MobFrame {
  const o = { ...fr, ...ex };
  if (flash) o.img = flashImg(fr.img);
  return o;
}

/** Прогрев: кадры поз во всех 8 сторонах, по одному на шаг. */
export function* warmAll(
  K: Kind,
  list: [string, number][],
  pic: (a: string, f: number, d: number) => Pic,
): Generator<number> {
  for (const [anim, n] of list)
    for (let d = 0; d < NDIR; d++)
      for (let f = 0; f < n; f++) {
        frameOf(K, anim, f, d, 'normal', () => pic(anim, f, d));
        yield 0;
      }
}
/** Сколько кадров в списке прогрева (все 8 сторон). */
export const warmCount = (list: [string, number][]) => list.reduce((a, [, n]) => a + n, 0) * NDIR;

/** Пустой кадр (моб не виден: под водой, между переносами). */
let EMPTY: HTMLCanvasElement | null = null;
export const emptyFrame = (): MobFrame => {
  EMPTY ??= new Px(1, 1).canvas();
  return { img: EMPTY, ax: 0, ay: 0, eye: null, shadow: 0, still: true };
};

/** Решётка Байера 4×4 — растворение без «кипения» (порог по точке, не по случаю). */
export const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => v / 16);
/** Растворить долю `k` рисунка (по Байеру) — перенос, гибель, проявление. */
export function dissolvePx(p: Px, k: number): void {
  if (k <= 0) return;
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++)
      if (BAYER[(y % 4) * 4 + (x % 4)] < k) p.data[(y * p.w + x) * 4 + 3] = 0;
}
/** Перекрасить к цвету с долей `k` (свечение переноса, камень). */
export function tintPx(p: Px, c: RGBA, k: number): void {
  if (k <= 0) return;
  const d = p.data;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    d[i] = Math.round(d[i] + (c[0] - d[i]) * k);
    d[i + 1] = Math.round(d[i + 1] + (c[1] - d[i + 1]) * k);
    d[i + 2] = Math.round(d[i + 2] + (c[2] - d[i + 2]) * k);
  }
}
