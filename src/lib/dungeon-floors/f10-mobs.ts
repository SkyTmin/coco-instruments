// Этаж 10 «Трон демона» — общий набор рисунка мобов (анимации мобов 10).
//
// Мобы этажа собраны из примитивов мини-3D (`f15-rig.ts`) и смотрят в одну
// из 8 сторон — туда, куда идут (курс с пределом поворота): боком не ходят.
// Шаг — по пройденному пути, техника — 24 к/с от времени режима (стоп-кадр
// мозга держит позу сам), кадр контакта — ровно там, где бьёт мозг
// (`f10-brains.ts`). Облик прежний: палитры и пропорции рисованных спрайтов.
//
// Кадр строится раз на позу и сторону и живёт в кеше с вытеснением (у вида
// свой предел). Холст обрезается до рисунка (площадь кадра — главная цена
// вывода толпы), якорь и `lit` сдвигаются следом. Облик (элита, альбинос) и
// проявление из темноты — перекраска готового рисунка; вспышка удара героя
// — белая копия холста, общая на кадр (в ключ не входит). Состояние рисунка
// — курс, путь, прошлый режим, миг удара героя — в `WeakMap` по мобу: в
// `m.data` рисунок не пишет.

import { Px } from '../dungeon-art';
import { frameLRU } from '../dungeon-paint';
import type { FrameLRU, MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import { F3, Rig, SE, proj, renderRig } from './f15-rig';
import type { RGBA, RigOut, Tones, V3 } from './f15-rig';

export { F3, Rig };
export type { RGBA, Tones, V3, RigOut };

export const TAU = Math.PI * 2;
export const PI = Math.PI;
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
export const vlerp = (a: V3, b: V3, k: number): V3 => [
  a[0] + (b[0] - a[0]) * k,
  a[1] + (b[1] - a[1]) * k,
  a[2] + (b[2] - a[2]) * k,
];
export const vadd = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const vsub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const vmul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const vlen = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const vnorm = (a: V3): V3 => {
  const l = vlen(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const vcross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** Детерминированный шум по числам (рисунок не трогает `sim.rng`). */
export const hash = (a: number, b: number, c = 0) => {
  let h = (a * 374761393 + b * 668265263 + c * 1274126177) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** Номер кадра техники 24 к/с (не больше `max`). */
export const fi = (t: number, max: number) =>
  Math.min(max, Math.max(0, Math.floor(t * FPS + 1e-6)));
/** Время середины кадра `f` техники, с. */
export const tf = (f: number) => (f + 0.5) / FPS;

export type Ease = (x: number) => number;
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

/**
 * Сустав двух звеньев (колено, локоть): от `a` к `b` длинами `l1`, `l2`,
 * сгиб — в сторону `pole`. Не дотягивается — прямая.
 */
export function ik(a: V3, b: V3, l1: number, l2: number, pole: V3): V3 {
  const d = vsub(b, a);
  const L = Math.min(vlen(d), l1 + l2 - 1e-3);
  const u = vnorm(d);
  const x = (l1 * l1 - l2 * l2 + L * L) / (2 * L || 1);
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  let p = vsub(pole, vmul(u, pole[0] * u[0] + pole[1] * u[1] + pole[2] * u[2]));
  if (vlen(p) < 1e-4) p = vcross(u, [0, 0, 1]);
  p = vnorm(p);
  return vadd(a, vadd(vmul(u, x), vmul(p, h)));
}

export const INK = hx('#150f0b');
export const WHITE = hx('#ffffff');
export const GOLDK = hx('#ffcc40');

// ---------------------------------------------------------------------------
// Стороны и ход: 8 сторон, курс с пределом поворота, путь для шага.
// ---------------------------------------------------------------------------

export const NDIR = 8;
/** Игровой угол → курс рига: на экране морда смотрит точно туда же. */
export const rigYaw = (a: number) => Math.atan2(Math.sin(a), SE * Math.cos(a));
export const dirN = (a: number) => ((Math.round((a / TAU) * NDIR) % NDIR) + NDIR) % NDIR;
export const yawN = (d: number) => rigYaw((d / NDIR) * TAU);
export const angD = (a: number, b: number) => {
  let d = (a - b) % TAU;
  if (d > PI) d -= TAU;
  if (d < -PI) d += TAU;
  return d;
};
/** Сторона, на которую смотрит камера (правый бок ближе при cos(курса) ≥ 0). */
export const camSide = (yaw: number) => (Math.cos(yaw) >= 0 ? 1 : -1);

export interface Vis {
  now: number;
  x: number;
  y: number;
  /** Курс рисунка, игровой угол (сглажен пределом поворота). */
  yaw: number;
  /** Пройденный путь, клетки. */
  dist: number;
  mode: string;
  prev: string;
  /** Миг смены режима (время рендера). */
  since: number;
  /** Миг последнего удара героя (время рендера) и отдача — единичный вектор. */
  hit: number;
  fl: number;
  kx: number;
  ky: number;
}
const VIS = new WeakMap<Mob, Vis>();

/**
 * Прошлый режим для листа кадров: стенд рисует каждый кадр новым мобом и
 * передаёт его номером в `m.data.vSheetPrev` (в игре его помнит `Vis`).
 */
const SHEET_PREV = [
  '',
  'windup',
  'aim',
  'pounce',
  'sweep',
  'thrust',
  'aim',
  'charge',
  'lance',
  'kiss',
  'swoopAim',
  'swoop',
  'claw',
  'leap',
  'claw',
  'cast',
  'blink',
  'flail',
  'chop',
  'f10_puff',
  'f10_wake',
  'f10_petrify',
  'alertpost',
  'emerge',
];

export const speedOf = (m: Mob) => Math.hypot(m.vx ?? 0, m.vy ?? 0);
export const moving = (m: Mob, thr = 0.4) => speedOf(m) > thr;
/** Курс по ходу: движется — по скорости, стоит — куда смотрит. */
export const headOf = (m: Mob, thr = 0.4) =>
  moving(m, thr) ? Math.atan2(m.vy, m.vx) : (m.face ?? 0);

function knockOf(v: Vis, m: Mob): void {
  const kx = m.kx ?? 0;
  const ky = m.ky ?? 0;
  const l = Math.hypot(kx, ky);
  const f = m.face ?? 0;
  v.kx = l > 0.01 ? kx / l : -Math.cos(f);
  v.ky = l > 0.01 ? ky / l : -Math.sin(f);
}

/** Ход моба для рисунка: курс с пределом поворота (рад/с), путь, прошлый режим, удар. */
export function visOf(m: Mob, pose: MobPose, want: number, turn: number): Vis {
  let v = VIS.get(m);
  const now = pose.now || 0;
  const fl = m.flash ?? 0;
  if (!v) {
    v = {
      now,
      x: m.x ?? 0,
      y: m.y ?? 0,
      yaw: want,
      dist: speedOf(m) * (pose.t || 0) + hash(m.id ?? 0, 91) * 3,
      mode: pose.mode,
      prev: SHEET_PREV[m.data?.vSheetPrev ?? 0] ?? '',
      since: now - (pose.t || 0),
      hit: fl > 0 ? now - Math.max(0, 0.12 - fl) : -9,
      fl,
      kx: 0,
      ky: 0,
    };
    knockOf(v, m);
    VIS.set(m, v);
    return v;
  }
  const dt = clamp(now - v.now, 0, 0.1);
  if (dt > 0) {
    v.dist += Math.min(Math.hypot((m.x ?? 0) - v.x, (m.y ?? 0) - v.y), 1);
    v.x = m.x ?? 0;
    v.y = m.y ?? 0;
    v.now = now;
    const mx = turn * dt;
    v.yaw += clamp(angD(want, v.yaw), -mx, mx);
  }
  if (pose.mode !== v.mode) {
    v.prev = v.mode;
    v.mode = pose.mode;
    v.since = now - (pose.t || 0);
  }
  if (fl > v.fl + 0.02) {
    v.hit = now;
    knockOf(v, m);
  }
  v.fl = fl;
  return v;
}

/**
 * Реакция на удар героя — 6 кадров поверх любой позы: отброс корпуса по
 * отдаче, вжатие, наклон прочь от героя, возврат. `A` — размах, пиксели.
 */
export function hurtFx(v: Vis, now: number, A: number, ex: Partial<MobFrame>): void {
  const age = now - v.hit;
  if (age < 0 || age >= 0.25) return;
  const out = age < 0.05 ? easeOut(age / 0.05) : 1 - sstep(0.05, 0.25, age);
  const sq = age < 0.1 ? 1 - age / 0.1 : 0;
  ex.dx = (ex.dx ?? 0) + v.kx * A * out;
  ex.dy = (ex.dy ?? 0) + v.ky * A * out * 0.6;
  ex.sx = (ex.sx ?? 1) * (1 + 0.12 * sq);
  ex.sy = (ex.sy ?? 1) * (1 - 0.11 * sq);
  ex.rot = (ex.rot ?? 0) + v.kx * 0.12 * out;
}
/** Сколько прошло после удара героя (для кадров «ушиба»), с; давно — большое. */
export const hurtAge = (v: Vis, now: number) => now - v.hit;

// ---------------------------------------------------------------------------
// Кадр: риг → картинка → обрезка → кеш; облик и вспышка — перекраской.
// ---------------------------------------------------------------------------

export interface Pic {
  p: Px;
  lit: Px | null;
  ax: number;
  ay: number;
  eye: [number, number] | null;
}

export interface Kind {
  name: string;
  w: number;
  h: number;
  ax: number;
  ay: number;
  pics: FrameLRU<Pic>;
  frames: FrameLRU<MobFrame>;
  limit: number;
}

const KINDS: Kind[] = [];
export const kindOf = (
  name: string,
  w: number,
  h: number,
  ax: number,
  ay: number,
  limit: number,
): Kind => {
  const K: Kind = {
    name,
    w,
    h,
    ax,
    ay,
    pics: frameLRU<Pic>(48),
    frames: frameLRU<MobFrame>(limit),
    limit,
  };
  KINDS.push(K);
  return K;
};

/**
 * Замер для стенда: цена нового кадра (мс), сколько кадров нарисовал прогрев
 * и какие кадры строились в бою (по ключу без номера кадра) — урок 2.
 */
export const F10_MOB_STAT = {
  n: 0,
  warm: 0,
  ms: [] as number[],
  max: 0,
  maxKey: '',
  battle: new Map<string, number>(),
  clear: () => {
    for (const K of KINDS) {
      K.pics.clear();
      K.frames.clear();
    }
  },
  reset: () => {
    F10_MOB_STAT.n = 0;
    F10_MOB_STAT.ms = [];
    F10_MOB_STAT.max = 0;
    F10_MOB_STAT.maxKey = '';
    F10_MOB_STAT.battle.clear();
  },
  sizes: () => KINDS.map((K) => `${K.name} ${K.frames.size}/${K.limit}`).join(', '),
};
let warming = false;
function stat(ms: number, K: Kind, key: string): void {
  if (warming) {
    F10_MOB_STAT.warm++;
    return;
  }
  F10_MOB_STAT.n++;
  if (F10_MOB_STAT.ms.length < 4000) F10_MOB_STAT.ms.push(ms);
  if (ms > F10_MOB_STAT.max) {
    F10_MOB_STAT.max = ms;
    F10_MOB_STAT.maxKey = `${K.name}|${key}`;
  }
  const k = `${K.name}|${key
    .split('|')
    .filter((_, i) => i !== 1)
    .join('|')}`;
  F10_MOB_STAT.battle.set(k, (F10_MOB_STAT.battle.get(k) ?? 0) + 1);
}
if (import.meta.env?.DEV && typeof window !== 'undefined') {
  (window as unknown as { __f10stat: () => unknown }).__f10stat = () => {
    const ms = [...F10_MOB_STAT.ms].sort((a, b) => a - b);
    const q = (k: number) =>
      +(ms[Math.min(ms.length - 1, Math.floor(ms.length * k))] ?? 0).toFixed(2);
    return {
      n: F10_MOB_STAT.n,
      warm: F10_MOB_STAT.warm,
      p50: q(0.5),
      p90: q(0.9),
      max: +F10_MOB_STAT.max.toFixed(2),
      maxKey: F10_MOB_STAT.maxKey,
      sizes: F10_MOB_STAT.sizes(),
      battle: [...F10_MOB_STAT.battle.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14),
    };
  };
  (window as unknown as { __f10mob: typeof F10_MOB_STAT }).__f10mob = F10_MOB_STAT;
}

export type Proj2 = (v: V3) => [number, number];
/** Риг → картинка вида; `post` дорисовывает в 2D (след, искры, пыль). */
export function draw(
  K: Kind,
  r: Rig,
  post?: (o: RigOut, P: Proj2) => void,
  inner = 2.2,
  outline: RGBA | null = INK,
): Pic {
  const o = renderRig(r, K.w, K.h, K.ax, K.ay, { outline, inner });
  if (post)
    post(o, (v) => {
      const q = proj(v, K.ax, K.ay);
      return [q[0], q[1]];
    });
  return { p: o.p, lit: o.lit, ax: K.ax, ay: K.ay, eye: o.eye };
}
export const litOn = (o: RigOut): Px => (o.lit ??= new Px(o.p.w, o.p.h));

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
function goldEdge(p: Px): Px {
  const q = new Px(p.w, p.h);
  q.data.set(p.data);
  const solid = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < p.w && y < p.h && p.data[(y * p.w + x) * 4 + 3] >= 200;
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      if (p.data[(y * p.w + x) * 4 + 3] >= 100) continue;
      if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))
        q.set(x, y, GOLDK);
    }
  return q;
}

/** Тьма, из которой проявляется моб: 0 — нет, 3 — почти чёрный; `tint` — цвет тьмы. */
function darkOf(p: Px, lvl: number, tint: RGBA): Px {
  const k = (lvl / 4) * 0.92;
  const q = new Px(p.w, p.h);
  for (let i = 0; i < p.data.length; i += 4) {
    if (!p.data[i + 3]) continue;
    q.data[i] = p.data[i] + (tint[0] - p.data[i]) * k;
    q.data[i + 1] = p.data[i + 1] + (tint[1] - p.data[i + 1]) * k;
    q.data[i + 2] = p.data[i + 2] + (tint[2] - p.data[i + 2]) * k;
    q.data[i + 3] = p.data[i + 3];
  }
  return q;
}

/** Рамка рисунка (с полями `pad`) по обоим слоям. */
function bbox(a: Px, b: Px | null, pad: number): [number, number, number, number] | null {
  let x0 = a.w;
  let y0 = a.h;
  let x1 = -1;
  let y1 = -1;
  for (const p of b ? [a, b] : [a]) {
    const { w, h, data } = p;
    for (let y = 0; y < h; y++)
      for (let x = 0, i = y * w * 4 + 3; x < w; x++, i += 4)
        if (data[i]) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
  }
  if (x1 < 0) return null;
  return [
    Math.max(0, x0 - pad),
    Math.max(0, y0 - pad),
    Math.min(a.w - 1, x1 + pad),
    Math.min(a.h - 1, y1 + pad),
  ];
}

function cropCanvas(p: Px, x0: number, y0: number, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const im = g.createImageData(w, h);
  for (let y = 0; y < h; y++)
    im.data.set(
      p.data.subarray(((y0 + y) * p.w + x0) * 4, ((y0 + y) * p.w + x0 + w) * 4),
      y * w * 4,
    );
  g.putImageData(im, 0, 0);
  return c;
}

/** Есть ли в слое хоть что-то. */
function anyPx(p: Px | null): boolean {
  if (!p) return false;
  const d = p.data;
  for (let i = 3; i < d.length; i += 4) if (d[i]) return true;
  return false;
}

const DARK = hx('#0a0606');

function finish(pic: Pic, look: MobPose['look'], dark: number, darkC: RGBA): MobFrame {
  let p = pic.p;
  if (dark > 0) p = darkOf(p, dark, darkC);
  if (look === 'albino') p = paleOf(p);
  if (look === 'elite') p = goldEdge(p);
  const lit = pic.lit && dark < 2 && anyPx(pic.lit) ? pic.lit : null;
  const bb = bbox(p, lit, 0);
  if (!bb) {
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 1;
    return { img: c, ax: 0, ay: 0, eye: null, lit: null };
  }
  const [x0, y0, x1, y1] = bb;
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  return {
    img: cropCanvas(p, x0, y0, w, h),
    ax: pic.ax - x0,
    ay: pic.ay - y0,
    eye: dark >= 2 || !pic.eye ? null : [pic.eye[0] - x0, pic.eye[1] - y0],
    lit: lit ? cropCanvas(lit, x0, y0, w, h) : null,
  };
}

/**
 * Белая копия холста — вспышка удара героя (0,1–0,15 с). Общая на кадр и
 * живёт, пока жив сам кадр: в ключ кеша вспышка не входит.
 */
const FLASHED = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();
export function flashImg(img: HTMLCanvasElement): HTMLCanvasElement {
  let c = FLASHED.get(img);
  if (!c) {
    c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.globalAlpha = 0.85;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, c.width, c.height);
    FLASHED.set(img, c);
  }
  return c;
}

/** Кадр вида: поза `anim`, кадр `f`, сторона `d`; `dark` — проявление из тьмы. */
export function frameOf(
  K: Kind,
  anim: string,
  f: number,
  d: number,
  pose: MobPose,
  build: () => Pic,
  dark = 0,
  darkC: RGBA = DARK,
): MobFrame {
  const key = `${anim}|${f}|${d}`;
  const fk = `${key}|${pose.look}|${dark}`;
  let fr = K.frames.get(fk);
  if (!fr) {
    const t0 = performance.now();
    let pic = K.pics.get(key);
    if (!pic) pic = K.pics.set(key, build());
    fr = K.frames.set(fk, finish(pic, pose.look, dark, darkC));
    stat(performance.now() - t0, K, fk);
  }
  return pose.flash ? { ...fr, img: flashImg(fr.img) } : fr;
}

export const WARM_POSE: MobPose = {
  anim: 'idle',
  frame: 0,
  mode: 'chase',
  t: 0,
  left: false,
  flash: false,
  look: 'normal',
  now: 0,
};

/** Прогрев: кадры поз по всем 8 сторонам, по одному на шаг. */
export function* warmAll(
  K: Kind,
  list: [string, number][],
  pic: (a: string, f: number, d: number) => Pic,
) {
  for (const [anim, n] of list)
    for (let d = 0; d < NDIR; d++)
      for (let f = 0; f < n; f++) {
        warming = true;
        try {
          frameOf(K, anim, f, d, WARM_POSE, () => pic(anim, f, d));
        } finally {
          warming = false;
        }
        yield 0;
      }
}

// ---------------------------------------------------------------------------
// 2D поверх рига: след оружия, искры, пыль, крошка.
// ---------------------------------------------------------------------------

/** Заливка многоугольника в 2D: `fn(x, y)` — цвет пикселя или null. */
export function fill2(
  p: Px,
  pts: [number, number][],
  fn: (x: number, y: number) => RGBA | null,
): void {
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
  for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(p.h - 1, Math.ceil(maxY)); y++)
    for (let x = Math.max(0, Math.floor(minX)); x <= Math.min(p.w - 1, Math.ceil(maxX)); x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i];
        const [xj, yj] = pts[j];
        if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) {
        const c = fn(x, y);
        if (c) p.set(x, y, c);
      }
    }
}

/**
 * След оружия (смаз): лента между дугой острия `tips` и дугой основания
 * `bases` (точки экрана по времени, от старой к новой). Старое — прозрачнее.
 * Рисуется ЗА телом (только в пустых пикселях) и светом — в `lit`.
 */
export function smear(
  o: RigOut,
  tips: [number, number][],
  bases: [number, number][],
  c: RGBA,
  glowA = 0.55,
): void {
  const n = Math.min(tips.length, bases.length);
  const lit = glowA > 0 ? litOn(o) : null;
  for (let i = 0; i < n - 1; i++) {
    const a = (0.25 + (0.75 * (i + 1)) / (n - 1)) * (c[3] / 255);
    const q: [number, number][] = [tips[i], tips[i + 1], bases[i + 1], bases[i]];
    const col = alpha(c, a);
    fill2(o.p, q, (x, y) => (o.p.data[(y * o.p.w + x) * 4 + 3] ? null : col));
    if (lit) fill2(lit, q, () => alpha(c, a * glowA));
  }
}

/** Точка света в 2D: в кадр и поверх темноты. */
export function spark2(o: RigOut, x: number, y: number, c: RGBA, glow = 1): void {
  o.p.set(x, y, c);
  if (glow > 0) litOn(o).set(x, y, alpha(c, glow));
}

/** Крошка, пыль, капли — `n` точек вокруг (x, y) на расстоянии r по фазе k. */
export function spray(
  p: Px,
  x: number,
  y: number,
  n: number,
  r: number,
  k: number,
  seed: number,
  cs: RGBA[],
  grav = 0,
  up = 0,
): void {
  for (let i = 0; i < n; i++) {
    const a = hash(seed, i, 1) * TAU;
    const s = 0.55 + 0.45 * hash(seed, i, 2);
    const d = r * s * k;
    const px = x + Math.cos(a) * d;
    const py = y + Math.sin(a) * d * 0.55 - up * s * k + grav * k * k;
    p.set(px, py, cs[i % cs.length]);
  }
}

// ---------------------------------------------------------------------------
// Двуногие: шаг по фазе, нога и рука по IK.
// ---------------------------------------------------------------------------

type CapMat = Parameters<Rig['cap']>[4];

/**
 * Шаг ноги по фазе `ps` (0…1, опора — первая половина): вынос `off` от
 * +0,5 до −0,5 шага на опоре и обратно в переносе, подъём `rise` 0…1.
 */
export function gait(ps: number): [number, number] {
  const p = ((ps % 1) + 1) % 1;
  if (p < 0.5) return [0.5 - p * 2, 0];
  const k = (p - 0.5) / 0.5;
  return [-0.5 + smooth(k), Math.sin(PI * k)];
}

/** Нога: бедро → колено (IK, сгиб к `pole`) → ступня (+ носок). */
export function leg(
  r: Rig,
  hip: V3,
  foot: V3,
  l1: number,
  l2: number,
  pole: V3,
  rad: [number, number, number],
  m: CapMat,
  toe?: V3,
): V3 {
  const knee = ik(hip, foot, l1, l2, pole);
  r.cap(hip, knee, rad[0], rad[1], m);
  r.cap(knee, foot, rad[1], rad[2], m);
  if (toe) r.cap(foot, toe, rad[2], rad[2] * 0.8, m);
  return knee;
}

/** Рука: плечо → локоть (IK, сгиб к `pole`) → кисть. */
export function arm(
  r: Rig,
  sh: V3,
  hand: V3,
  l1: number,
  l2: number,
  pole: V3,
  rad: [number, number, number],
  m1: CapMat,
  m2: CapMat = m1,
): V3 {
  const el = ik(sh, hand, l1, l2, pole);
  r.cap(sh, el, rad[0], rad[1], m1);
  r.cap(el, hand, rad[1], rad[2], m2);
  return el;
}

/**
 * Риг в масштабе `k`: рамки строятся через `F3.scale(k)` (точки и
 * эллипсоиды растут сами), а радиусы капсул, шаров и шипов — здесь.
 */
export class KRig extends Rig {
  constructor(public k: number) {
    super();
  }
  cap(a: V3, b: V3, r0: number, r1: number, m: CapMat): this {
    return super.cap(a, b, r0 * this.k, r1 * this.k, m);
  }
  ball(c: V3, r: number, m: CapMat): this {
    return super.ball(c, r * this.k, m);
  }
  spike(b: V3, d: V3, L: number, w: number, m: CapMat, n = 4, tw = 0): this {
    return super.spike(b, d, L * this.k, w * this.k, m, n, tw);
  }
}
