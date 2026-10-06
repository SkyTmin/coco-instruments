// Этаж 7 «Зеркальный лабиринт» — общий набор рисунка мобов (анимации мобов 7,
// по эталону боссов 12–14 и мобов 2–5). Здесь только то, что нужно всем
// рисовальщикам этажа:
//   • кривые и кванты: каждое действие — трек 24 к/с от `pose.t`;
//   • память рисунка по номеру моба: курс с пределом поворота, пройденный
//     путь (шаг — по нему), прошлый режим, миг удара героя и откуда;
//   • отдача от удара героя полями кадра (отброс, вжатие, возврат);
//   • кадр: картинка → облик (элита, альбинос) → зеркало → обрезка до
//     рисунка (площадь кадра — главная цена вывода) → кеш `frameLRU` с
//     пределом на вид; белая вспышка — перекраской готового холста;
//   • прогрев и счёт новых кадров (`F7_MOB_STAT`) — для стенда.
// Мозг этажа отсюда не виден и не трогается: рисунок читает моба и позу.

import { Px } from '../dungeon-art';
import { frameLRU, paintSim } from '../dungeon-paint';
import type { FrameLRU, MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';

export type RGBA = [number, number, number, number];
export type Tones = [RGBA, RGBA, RGBA, RGBA];
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
export const mixc = (a: RGBA, b: RGBA, k: number): RGBA => [
  Math.round(a[0] + (b[0] - a[0]) * k),
  Math.round(a[1] + (b[1] - a[1]) * k),
  Math.round(a[2] + (b[2] - a[2]) * k),
  a[3],
];
export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const alpha = (c: RGBA, a: number): RGBA => [c[0], c[1], c[2], Math.round(clamp01(a) * 255)];
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

export const INK = hx('#10101a');
export const WHITE = hx('#ffffff');
export const GOLD = hx('#ffcc40');

// ---- Кривые и кванты ----------------------------------------------------------

export const smooth = (k: number) => {
  const x = clamp01(k);
  return x * x * (3 - 2 * x);
};
export const sstep = (a: number, b: number, x: number) => smooth((x - a) / (b - a));
export const eIn = (k: number) => clamp01(k) ** 2;
export const eIn3 = (k: number) => clamp01(k) ** 3;
export const eOut = (k: number) => 1 - (1 - clamp01(k)) ** 2;
export const eOut3 = (k: number) => 1 - (1 - clamp01(k)) ** 3;
/** Доля отрезка [a, b], в котором сейчас t. */
export const seg = (t: number, a: number, b: number) => clamp01((t - a) / (b - a || 1));
/** Номер кадра 24 к/с (0…max). */
export const fi = (t: number, max: number) =>
  Math.min(max, Math.max(0, Math.floor(t * FPS + 1e-6)));
/** Середина кадра `f` в секундах. */
export const ft = (f: number) => (f + 0.5) / FPS;
export const mod = (n: number, k: number) => ((Math.floor(n) % k) + k) % k;

export type Ease = (x: number) => number;
export type Key = [number, number, Ease?];
/** Дорожка ключей: время → значение; кривая — у ключа, к которому идём. */
export function trk(t: number, keys: Key[]): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1, e] = keys[i];
    if (t <= t1) {
      const [t0, v0] = keys[i - 1];
      const x = (t - t0) / (t1 - t0 || 1);
      return v0 + (v1 - v0) * (e ?? smooth)(x);
    }
  }
  return keys[keys.length - 1][1];
}

/** Детерминированный шум по числам (рисунок не трогает `sim.rng`). */
export const hash = (a: number, b: number, c = 0) => {
  let h = (a * 374761393 + b * 668265263 + c * 1274126177) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
/** Фаза покоя от номера моба 0…1: стая не дышит в такт. */
export const phaseOf = (m: Mob) => hash((m.id ?? 0) | 0, 71, 3);

export const angD = (a: number, b: number) => {
  let d = (a - b) % TAU;
  if (d > PI) d -= TAU;
  if (d < -PI) d += TAU;
  return d;
};
/** Сторона 0…7: 0 — восток, 2 — юг (к зрителю), 6 — север. */
export const dir8 = (a: number) => mod(Math.round(a / (PI / 4)), 8);

// ---- Память рисунка ----------------------------------------------------------------

export interface Vis {
  now: number;
  x: number;
  y: number;
  /** Пройденный путь, клетки (шаг — по нему). */
  dist: number;
  /** Курс рисунка — игровой угол, сглаженный пределом поворота. */
  yaw: number;
  /** Сторона рисунка с запасом (у отражения — 4 стороны, как у героя). */
  side: number;
  mode: string;
  prev: string;
  /** Когда режим сменился (часы рендера). */
  since: number;
  /** Удар героя: когда (часы рендера) и откуда — единичный вектор отдачи. */
  hit: number;
  kx: number;
  ky: number;
  fl: number;
  /** Свободные ячейки для рисовальщика (последний кадр, след и т. п.). */
  a: number;
  b: number;
}
const VIS = new Map<number, Vis>();

const speedOf = (m: Mob) => Math.hypot(m.vx ?? 0, m.vy ?? 0);
export const moving = (m: Mob, thr = 0.4) => speedOf(m) > thr;
/** Курс по ходу: движется — по скорости (путь), стоит — куда смотрит. */
export const headOf = (m: Mob, thr = 0.4) =>
  moving(m, thr) ? Math.atan2(m.vy ?? 0, m.vx ?? 0) : (m.face ?? 0);

function knockOf(v: Vis, m: Mob): void {
  const sim = paintSim();
  const x = m.x ?? 0;
  const y = m.y ?? 0;
  let ax = m.kx ?? 0;
  let ay = m.ky ?? 0;
  if (sim && Math.hypot(ax, ay) < 0.01) {
    ax = x - sim.hero.x;
    ay = y - sim.hero.y;
  }
  const l = Math.hypot(ax, ay);
  const f = m.face ?? 0;
  v.kx = l > 0.01 ? ax / l : -Math.cos(f);
  v.ky = l > 0.01 ? ay / l : -Math.sin(f);
}

/**
 * Память рисунка моба (по номеру; лист кадров делает нового моба на каждый
 * кадр с тем же номером — память живёт и там). Время пошло назад — заново.
 * `want` — куда тянется курс, `turn` — предел поворота, рад/с.
 */
export function visOf(m: Mob, pose: MobPose, want: number, turn: number): Vis {
  const id = m.id ?? -1;
  const now = pose.now || 0;
  const fl = m.flash ?? 0;
  let v = VIS.get(id);
  if (v && (now < v.now - 0.05 || now - v.now > 1.5)) v = undefined;
  if (!v) {
    v = {
      now,
      x: m.x ?? 0,
      y: m.y ?? 0,
      dist: speedOf(m) * Math.max(0, pose.t || 0),
      yaw: want,
      side: -1,
      mode: pose.mode,
      prev: (m.data?.vPrev as unknown as string) ?? '',
      since: now - Math.max(0, pose.t || 0),
      hit: fl > 0 ? now - Math.max(0, 0.15 - fl) : -9,
      kx: 0,
      ky: 0,
      fl,
      a: 0,
      b: 0,
    };
    knockOf(v, m);
    VIS.set(id, v);
    if (VIS.size > 400) VIS.delete(VIS.keys().next().value as number);
    return v;
  }
  const dt = clamp(now - v.now, 0, 0.1);
  if (dt > 0) {
    const x = m.x ?? 0;
    const y = m.y ?? 0;
    // В бою — по пути (упёрся в стену — ноги стоят); на листе кадров мир не
    // движется, и шаг идёт от скорости.
    v.dist += paintSim() ? Math.min(Math.hypot(x - v.x, y - v.y), 0.5) : speedOf(m) * dt;
    v.x = x;
    v.y = y;
    v.now = now;
    const mx = turn * dt;
    v.yaw += clamp(angD(want, v.yaw), -mx, mx);
  }
  if (pose.mode !== v.mode) {
    v.prev = v.mode;
    v.mode = pose.mode;
    v.since = now - Math.max(0, pose.t || 0);
  }
  if (fl > v.fl + 0.02 && pose.mode !== 'dying') {
    v.hit = now;
    knockOf(v, m);
  }
  v.fl = fl;
  return v;
}

/**
 * Реакция на удар героя поверх любой позы (0,25 с, 6 кадров): отброс корпуса
 * по отдаче, вжатие, наклон прочь, возврат. `A` — размах, пиксели.
 */
export function hurtFx(v: Vis, now: number, A: number, ex: Partial<MobFrame>): number {
  const age = now - v.hit;
  if (age < 0 || age >= 0.25) return 0;
  const out = age < 0.05 ? eOut(age / 0.05) : 1 - sstep(0.05, 0.25, age);
  const sq = age < 0.1 ? 1 - age / 0.1 : 0;
  ex.dx = (ex.dx ?? 0) + v.kx * A * out;
  ex.dy = (ex.dy ?? 0) + v.ky * A * out * 0.6;
  ex.sx = (ex.sx ?? 1) * (1 + 0.12 * sq);
  ex.sy = (ex.sy ?? 1) * (1 - 0.12 * sq);
  ex.rot = (ex.rot ?? 0) + v.kx * 0.12 * out;
  return out;
}

// ---- Кадр: картинка → облик → зеркало → обрезка → кеш ------------------------------------

/** Готовая картинка позы (до облика, зеркала и вспышки). */
export interface Pic {
  p: Px;
  lit: Px | null;
  ax: number;
  ay: number;
  eye: [number, number] | null;
}

export interface Kind {
  name: string;
  pics: FrameLRU<Pic>;
  frames: FrameLRU<MobFrame>;
  limit: number;
}
const KINDS: Kind[] = [];
/** Вид: свой кеш картинок и кадров с пределом. */
export function kindOf(name: string, limit: number): Kind {
  const K: Kind = {
    name,
    pics: frameLRU<Pic>(Math.round(limit * 0.6)),
    frames: frameLRU<MobFrame>(limit),
    limit,
  };
  KINDS.push(K);
  return K;
}

/** Замер для стенда: новые кадры (сколько, по видам, последние ключи, цена мс). */
export const F7_MOB_STAT = {
  n: 0,
  ms: [] as number[],
  by: {} as Record<string, number>,
  miss: [] as string[],
  max: 0,
  maxKey: '',
  /** Прогрев идёт — кадры не считаются «новыми в бою». */
  warming: false,
  warm: 0,
  sizes: () => Object.fromEntries(KINDS.map((K) => [K.name, [K.frames.size, K.limit]])),
  clear: () => {
    for (const K of KINDS) {
      K.pics.clear();
      K.frames.clear();
    }
  },
};
function stat(K: Kind, ms: number, key: string): void {
  if (F7_MOB_STAT.warming) {
    F7_MOB_STAT.warm++;
    return;
  }
  F7_MOB_STAT.n++;
  if (F7_MOB_STAT.ms.length < 4000) F7_MOB_STAT.ms.push(ms);
  F7_MOB_STAT.by[K.name] = (F7_MOB_STAT.by[K.name] ?? 0) + 1;
  F7_MOB_STAT.miss.push(`${K.name}|${key}`);
  if (F7_MOB_STAT.miss.length > 400) F7_MOB_STAT.miss.splice(0, 200);
  if (ms > F7_MOB_STAT.max) {
    F7_MOB_STAT.max = ms;
    F7_MOB_STAT.maxKey = `${K.name}|${key}`;
  }
}

function paleOf(p: Px): Px {
  const pale = hx('#f4f2ff');
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

/** Золотой кант элиты — кольцом снаружи контура (по плотным точкам). */
function goldOf(p: Px): Px {
  const q = new Px(p.w, p.h);
  q.data.set(p.data);
  const solid = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < p.w && y < p.h && p.data[(y * p.w + x) * 4 + 3] >= 100;
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      if (p.data[(y * p.w + x) * 4 + 3] >= 100) continue;
      if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))
        q.set(x, y, GOLD);
    }
  return q;
}

/** Холст из куска буфера [x0, y0, w, h]. */
function cut(p: Px, x0: number, y0: number, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  const g = c.getContext('2d');
  if (g && w > 0 && h > 0) {
    const img = g.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      const yy = y + y0;
      if (yy < 0 || yy >= p.h) continue;
      const s = (yy * p.w + x0) * 4;
      img.data.set(p.data.subarray(s, s + w * 4), y * w * 4);
    }
    g.putImageData(img, 0, 0);
  }
  return c;
}

function bbox(p: Px, b: [number, number, number, number]): void {
  const { w, h, data } = p;
  for (let y = 0; y < h; y++)
    for (let x = 0, i = y * w * 4 + 3; x < w; x++, i += 4)
      if (data[i]) {
        if (x < b[0]) b[0] = x;
        if (x > b[2]) b[2] = x;
        if (y < b[1]) b[1] = y;
        if (y > b[3]) b[3] = y;
      }
}

/** Картинка → кадр: облик, зеркало, обрезка (якорь, глаз и `lit` — следом). */
function bake(pic: Pic, mir: boolean, look: Look): MobFrame {
  let p = pic.p;
  let lit = pic.lit;
  if (look === 'albino') p = paleOf(p);
  if (look === 'elite') p = goldOf(p);
  let ax = pic.ax;
  let eye = pic.eye;
  if (mir) {
    p = p.flipX();
    if (lit) lit = lit.flipX();
    ax = p.w - ax;
    if (eye) eye = [p.w - 1 - eye[0], eye[1]];
  }
  const b: [number, number, number, number] = [p.w, p.h, -1, -1];
  bbox(p, b);
  if (lit) bbox(lit, b);
  if (b[2] < 0) {
    b[0] = 0;
    b[1] = 0;
    b[2] = 0;
    b[3] = 0;
  }
  const w = b[2] - b[0] + 1;
  const h = b[3] - b[1] + 1;
  return {
    img: cut(p, b[0], b[1], w, h),
    lit: lit ? cut(lit, b[0], b[1], w, h) : null,
    ax: ax - b[0],
    ay: pic.ay - b[1],
    eye: eye ? [eye[0] - b[0], eye[1] - b[1]] : null,
  };
}

/**
 * Кадр вида: `key` — поза, кадр и рисуемая сторона; `mir` — зеркало. Кадр
 * без вспышки: вспышку кладёт `withFlash` перекраской готового холста.
 */
export function frameOf(
  K: Kind,
  key: string,
  mir: boolean,
  look: Look,
  build: () => Pic,
): MobFrame {
  const fk = `${key}|${mir ? 1 : 0}|${look}`;
  let fr = K.frames.get(fk);
  if (fr) return fr;
  const t0 = performance.now();
  let pic = K.pics.get(key);
  if (!pic) pic = K.pics.set(key, build());
  fr = K.frames.set(fk, bake(pic, mir, look));
  stat(K, performance.now() - t0, fk);
  return fr;
}

const FLASHED = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();
/** Белая вспышка удара из готового холста (без перерисовки позы). */
export function flashImg(img: HTMLCanvasElement): HTMLCanvasElement {
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

/** Кадр с полями хода и вспышкой: новый объект, кешированный холст. */
export function dress(fr: MobFrame, flash: boolean, ex: Partial<MobFrame>): MobFrame {
  const o: MobFrame = { ...fr, ...ex };
  if (flash) o.img = flashImg(fr.img);
  return o;
}

/** Прогрев: шаги — функции, каждая строит один кадр. */
export function* warmSteps(steps: Iterable<() => unknown>): Generator<number> {
  F7_MOB_STAT.warming = true;
  try {
    for (const s of steps) {
      F7_MOB_STAT.warming = true;
      s();
      F7_MOB_STAT.warming = false;
      yield 0;
    }
  } finally {
    F7_MOB_STAT.warming = false;
  }
}

/** Пустой кадр (моб уже ушёл в стекло, а мир ещё держит его). */
let EMPTY: HTMLCanvasElement | null = null;
export const emptyFrame = (): MobFrame => {
  EMPTY ??= new Px(1, 1).canvas();
  return { img: EMPTY, ax: 0, ay: 0, eye: null, shadow: 0, still: true, lit: null };
};

/** Цвет светящихся глаз по облику — как у движка (`drawMob`). */
export const eyeCol = (look: Look, base: RGBA): RGBA =>
  look === 'albino' ? hx('#ff6a88') : look === 'elite' ? hx('#ffb020') : base;

// ---- Мелкий рисунок -----------------------------------------------------------------

/** Свет сверху-слева (экран), для плоских частей. */
const LX = -0.45;
const LY = -0.72;
const LZ = 0.52;
export const toneOf = (t: Tones, l: number): RGBA =>
  l > 0.78 ? t[3] : l > 0.42 ? t[2] : l > 0.02 ? t[1] : t[0];

/** Капсула от (x0, y0) до (x1, y1) со светом по нормали (клинок, коготь). */
export function capsule(
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
      const k = clamp01(((px - x0) * dx + (py - y0) * dy) / L2);
      const r = r0 + (r1 - r0) * k;
      const ex = px - (x0 + dx * k);
      const ey = py - (y0 + dy * k);
      const d = Math.hypot(ex, ey);
      if (d > r) continue;
      const nx = ex / (r || 1);
      const ny = ey / (r || 1);
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      p.set(x, y, toneOf(t, nx * LX + ny * LY + nz * LZ + bias));
    }
}

/** Линия толщиной `w` (кругляш на каждой точке). */
export function thick(p: Px, x0: number, y0: number, x1: number, y1: number, c: RGBA, w = 1): void {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 1.5));
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    const y = y0 + ((y1 - y0) * i) / n;
    if (w <= 1) p.set(x, y, c);
    else p.ell(x, y, w / 2, w / 2, c);
  }
}

/** Заливка многоугольника строками; цвет — функция точки или цвет. */
export function fillPoly(
  p: Px,
  pts: [number, number][],
  col: RGBA | ((x: number, y: number) => RGBA | null),
): void {
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const q of pts) {
    y0 = Math.min(y0, q[1]);
    y1 = Math.max(y1, q[1]);
  }
  const xs: number[] = [];
  for (let y = Math.ceil(y0 - 0.5); y <= Math.floor(y1 - 0.5); y++) {
    const yc = y + 0.5;
    xs.length = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if (a[1] === b[1]) continue;
      if ((yc >= a[1] && yc < b[1]) || (yc >= b[1] && yc < a[1]))
        xs.push(a[0] + ((yc - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2)
      for (let x = Math.ceil(xs[i] - 0.5); x <= Math.floor(xs[i + 1] - 0.5); x++) {
        const c = typeof col === 'function' ? col(x, y) : col;
        if (c) p.set(x, y, c);
      }
  }
}

/**
 * След-серп: сектор между углами `a0` → `a1` (по ходу клинка) от `r0` до
 * `r1` вокруг (cx, cy); у переднего края ярче, к хвосту гаснет. `sy` —
 * сжатие по высоте (пол в три четверти).
 */
export function smear(
  p: Px,
  cx: number,
  cy: number,
  a0: number,
  a1: number,
  r0: number,
  r1: number,
  hot: RGBA,
  cold: RGBA,
  k = 1,
  sy = 0.8,
): void {
  const span = angD(a1, a0);
  if (Math.abs(span) < 0.05) return;
  const R = Math.ceil(r1 + 1);
  for (let y = Math.floor(cy - R); y <= Math.ceil(cy + R); y++)
    for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x++) {
      const dx = x + 0.5 - cx;
      const dy = (y + 0.5 - cy) / sy;
      const r = Math.hypot(dx, dy);
      if (r < r0 || r > r1) continue;
      const a = Math.atan2(dy, dx);
      const u = angD(a, a0) / span;
      if (u < 0 || u > 1) continue;
      // Передний край (u → 1) — горячий и плотный, хвост — редкий и холодный.
      const near = u;
      const edge = r > r1 - 1.2 ? 1 : 0.6;
      const al = (0.25 + 0.75 * near) * edge * k;
      if (al < 0.18) continue;
      if (near < 0.45 && (x + y) % 2) continue;
      p.set(x, y, alpha(mixc(cold, hot, near), al));
    }
}
