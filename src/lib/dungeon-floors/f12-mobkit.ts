// Этаж 12 «Полярная ночь» — набор для мобов (анимации мобов 12).
//
// Мобы рисуются тем же мини-3D ригом, что и мамонт (`f12-rig.ts`: эллипсоиды,
// луч на пиксель, свет сверху-слева), но кадры живут по правилам мобов
// этажей 1–10:
// - техника — дорожка 24 к/с от `pose.t` (`fi`, `trk`), шаг — по пройденному
//   пути, покой — со своей фазой от `m.id`;
// - 8 честных сторон (свет несимметричен — зеркало дало бы свет справа);
// - курс рисунка с пределом поворота (`visOf`), удар героя — отброс корпуса
//   трансформом (`hurtFx`), без новых кадров;
// - кадр обрезан по рисунку, слой света — только если окупается (`litWorth`),
//   элита и альбинос — перекраской готового кадра в отдельном кеше, вспышка —
//   кольцо холстов; новых кадров за кадр рендера — не дороже бюджета;
// - прогрев всех поз во всех сторонах (`warmAll`), замер — `__f12stat()`.

import { Px } from '../dungeon-art';
import { frameLRU, registerMobPainter } from '../dungeon-paint';
import type { FrameLRU, MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import { hash, hx, INK, project, renderRig, TAU, toWorld } from './f12-rig';
import type { Build, Part, PostFx, RGBA, Scr, V3 } from './f12-rig';

export type { Build, Part, PostFx, RGBA, Scr, V3 };

// ---------------------------------------------------------------------------
// Время и кривые.
// ---------------------------------------------------------------------------

export const FPS = 24;
export const PI = Math.PI;
export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
export const smooth = (k: number) => {
  const c = clamp01(k);
  return c * c * (3 - 2 * c);
};
export const sstep = (a: number, b: number, x: number) => smooth((x - a) / (b - a));
export const easeOut = (k: number) => 1 - (1 - clamp01(k)) ** 3;
export const easeIn = (k: number) => clamp01(k) ** 2;
export const lin = (k: number) => clamp01(k);
/** Выход с перелётом (проводка за точку). */
export const easeBack = (k: number) => {
  const c = clamp01(k) - 1;
  return 1 + c * c * (2.7 * c + 1.7);
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

// ---------------------------------------------------------------------------
// Стороны, курс, путь.
// ---------------------------------------------------------------------------

export const NDIR = 8;
export const dirOf = (a: number, n = NDIR) => ((Math.round((a / TAU) * n) % n) + n) % n;
export const angOf = (d: number, n = NDIR) => (d / n) * TAU;
export const angD = (a: number, b: number) => {
  let d = (a - b) % TAU;
  if (d > PI) d -= TAU;
  if (d < -PI) d += TAU;
  return d;
};

export const speedOf = (m: Mob) => Math.hypot(m.vx ?? 0, m.vy ?? 0);
/** Курс по ходу: движется — по скорости, стоит — куда смотрит. */
export const headOf = (m: Mob, thr = 0.4) =>
  speedOf(m) > thr ? Math.atan2(m.vy, m.vx) : (m.face ?? 0);

/** Видимое состояние моба: курс рисунка, путь, прошлый режим, удар героя. */
export interface Vis {
  now: number;
  x: number;
  y: number;
  /** Курс рисунка (игровой угол) — сглажен пределом поворота. */
  yaw: number;
  /** Пройденный путь, клетки. */
  dist: number;
  mode: string;
  prev: string;
  /** Миг смены режима (время рендера). */
  since: number;
  /** Миг последнего удара героя и единичная отдача. */
  hit: number;
  fl: number;
  kx: number;
  ky: number;
  /** Курс скорости в прошлом кадре и миг резкой смены (отскок шара). */
  vang: number;
  bump: number;
  last: MobFrame | null;
  lastK: Kind | null;
}
const VIS = new WeakMap<Mob, Vis>();
let cur: Vis | null = null;
let curFresh = false;

function knockOf(v: Vis, m: Mob): void {
  const kx = m.kx ?? 0;
  const ky = m.ky ?? 0;
  const l = Math.hypot(kx, ky);
  const f = m.face ?? 0;
  v.kx = l > 0.01 ? kx / l : -Math.cos(f);
  v.ky = l > 0.01 ? ky / l : -Math.sin(f);
}

/**
 * Ход моба для рисунка. `want` — куда смотреть, `turn` — предел поворота
 * (рад/с). Лист кадров зовёт рисовальщик новым мобом на каждый кадр — там
 * курс сразу `want`, путь — скорость × время режима.
 */
export function visOf(m: Mob, pose: MobPose, want: number, turn: number): Vis {
  let v = VIS.get(m);
  const now = pose.now || 0;
  const fl = m.flash ?? 0;
  const sp = speedOf(m);
  if (!v) {
    v = {
      now,
      x: m.x ?? 0,
      y: m.y ?? 0,
      yaw: want,
      dist: sp * (pose.t || 0) + hash(m.id ?? 0, 91) * 3,
      mode: pose.mode,
      prev: '',
      since: now - (pose.t || 0),
      hit: fl > 0 ? now - Math.max(0, 0.12 - fl) : -9,
      fl,
      kx: 0,
      ky: 0,
      vang: sp > 0.3 ? Math.atan2(m.vy, m.vx) : (m.face ?? 0),
      bump: -9,
      last: null,
      lastK: null,
    };
    knockOf(v, m);
    VIS.set(m, v);
    cur = v;
    curFresh = true;
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
    if (sp > 0.3) {
      const a = Math.atan2(m.vy, m.vx);
      if (Math.abs(angD(a, v.vang)) > 0.9) v.bump = now;
      v.vang = a;
    }
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
  cur = v;
  curFresh = false;
  return v;
}

/** Фаза шага 0…1 по пройденному пути: `stride` — клеток на полный шаг. */
export const stepPh = (v: Vis, stride: number) => (((v.dist / stride) % 1) + 1) % 1;
/** Фаза покоя: своя у каждого моба, чтобы стая не дышала в такт. */
export const idlePh = (m: Mob, now: number, rate: number, n: number) =>
  Math.floor(now * rate + hash(m.id ?? 0, 17) * n) % n;

/**
 * Реакция на удар героя — 6 кадров поверх любой позы: отброс корпуса по
 * отдаче, вжатие, наклон прочь, возврат. `A` — размах, пиксели.
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
export const hurtAge = (v: Vis, now: number) => now - v.hit;

// ---------------------------------------------------------------------------
// Части рига: суставы и повороты всей модели.
// ---------------------------------------------------------------------------

/** Конечность цепочкой шаров: бедро → колено → лапа (`n` шаров на звено). */
export function limb(
  out: Part[],
  a: V3,
  b: V3,
  c: V3,
  r0: number,
  r1: number,
  R: RGBA[],
  id: number,
  n = 2,
): void {
  const tot = 2 * n;
  for (let i = 0; i <= tot; i++) {
    const k = i / tot;
    const p: V3 =
      i <= n
        ? [
            a[0] + ((b[0] - a[0]) * i) / n,
            a[1] + ((b[1] - a[1]) * i) / n,
            a[2] + ((b[2] - a[2]) * i) / n,
          ]
        : [
            b[0] + ((c[0] - b[0]) * (i - n)) / n,
            b[1] + ((c[1] - b[1]) * (i - n)) / n,
            b[2] + ((c[2] - b[2]) * (i - n)) / n,
          ];
    const r = r0 + (r1 - r0) * k;
    out.push({ x: p[0], y: p[1], z: p[2], rx: r, ry: r, rz: r, ramp: R, id });
  }
}

/** Точка модели (часть, глаз, кончик) — то, что поворачивают вместе с телом. */
export interface Pt {
  x: number;
  y: number;
  z: number;
  yaw?: number;
  pitch?: number;
  roll?: number;
}

/** Повернуть часть модели вокруг оси «вперёд» (крен) через точку высоты `zc`. */
export function rollParts(parts: Pt[], r: number, zc: number, from = 0): void {
  if (!r) return;
  const c = Math.cos(r);
  const s = Math.sin(r);
  for (let i = from; i < parts.length; i++) {
    const p = parts[i];
    const y = p.y;
    const z = p.z - zc;
    p.y = y * c - z * s;
    p.z = zc + y * s + z * c;
    p.roll = (p.roll ?? 0) + r;
  }
}

/** Наклон модели носом вверх (`a` > 0) вокруг точки (x0, z0). */
export function pitchParts(parts: Pt[], a: number, x0: number, z0: number, from = 0): void {
  if (!a) return;
  const c = Math.cos(a);
  const s = Math.sin(a);
  for (let i = from; i < parts.length; i++) {
    const p = parts[i];
    const x = p.x - x0;
    const z = p.z - z0;
    p.x = x0 + x * c - z * s;
    p.z = z0 + x * s + z * c;
    p.pitch = (p.pitch ?? 0) + a;
  }
}

/** Поворот модели вокруг вертикали через (x0, 0). */
export function yawParts(parts: Pt[], a: number, x0: number, from = 0): void {
  if (!a) return;
  const c = Math.cos(a);
  const s = Math.sin(a);
  for (let i = from; i < parts.length; i++) {
    const p = parts[i];
    const x = p.x - x0;
    const y = p.y;
    p.x = x0 + x * c - y * s;
    p.y = x * s + y * c;
    p.yaw = (p.yaw ?? 0) + a;
  }
}

// ---------------------------------------------------------------------------
// Вид, кадр, кеш.
// ---------------------------------------------------------------------------

export interface Canvas {
  w: number;
  h: number;
  ox: number;
  oy: number;
}

export interface Kind {
  name: string;
  cv: Canvas;
  dirs: number;
  frames: FrameLRU<MobFrame>;
  looks: FrameLRU<MobFrame>;
  limit: number;
}
const KINDS: Kind[] = [];

/** Вид: холст рига, предел кеша (кадры облика — ещё ~35% сверху), сторон. */
export function kindOf(name: string, cv: Canvas, limit: number, dirs = NDIR): Kind {
  const K: Kind = {
    name,
    cv,
    dirs,
    frames: frameLRU<MobFrame>(limit),
    looks: frameLRU<MobFrame>(Math.max(24, Math.round(limit * 0.35))),
    limit,
  };
  KINDS.push(K);
  return K;
}

export interface Pic {
  p: Px;
  lit: Px | null;
  ax: number;
  ay: number;
  eye: [number, number] | null;
}

/** Риг → картинка стороны `d` (обрезан ригом, рисунок поверх — `post`). */
export function draw(K: Kind, b: Build, d: number): Pic {
  const { w, h, ox, oy } = K.cv;
  const face = angOf(d, K.dirs);
  const full = (x: number, y: number, z: number): [number, number, number] => {
    const [wx, wy, wz] = toWorld(x, y, z, face);
    const [sx, sy, sd] = project(wx, wy, wz);
    return [ox + sx, oy + sy, sd];
  };
  const keep = (b.extent ?? []).map((e): [number, number] => {
    const [x, y] = full(e[0], e[1], e[2]);
    return [x, y];
  });
  const o = renderRig(b.parts, face, w, h, ox, oy, b.eyes ?? [], 0, b.clip, true, keep);
  const cx = o.cx ?? 0;
  const cy = o.cy ?? 0;
  if (b.post) {
    const scr: Scr = (x, y, z) => {
      const [sx, sy, sd] = full(x, y, z);
      return [sx - cx, sy - cy, sd];
    };
    const zb = o.zb;
    const W = o.p.w;
    const H = o.p.h;
    b.post(o.p, scr, {
      lit: () => (o.lit ??= new Px(W, H)),
      z: (x, y) => {
        const X = Math.round(x);
        const Y = Math.round(y);
        if (!zb || X < 0 || Y < 0 || X >= W || Y >= H) return -1e9;
        return zb[Y * W + X];
      },
    });
  }
  return { p: o.p, lit: o.lit, ax: ox - cx, ay: oy - cy, eye: o.eye };
}

/** Рамка рисунка по обоим слоям. */
function bbox(a: Px, b: Px | null): [number, number, number, number] | null {
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
  return x1 < 0 ? null : [x0, y0, x1, y1];
}

function cropCanvas(p: Px, x0: number, y0: number, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) return c;
  const im = g.createImageData(w, h);
  for (let y = 0; y < h; y++)
    im.data.set(
      p.data.subarray(((y0 + y) * p.w + x0) * 4, ((y0 + y) * p.w + x0 + w) * 4),
      y * w * 4,
    );
  g.putImageData(im, 0, 0);
  return c;
}

/**
 * Слой света — второй `drawImage` во весь кадр на каждый кадр экрана: пара
 * точек глаз его не окупает (глаз движок светит сам по `eye`).
 */
const LIT_MIN = 10;
function litWorth(p: Px | null): boolean {
  if (!p) return false;
  const d = p.data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] >= 40 && ++n > LIT_MIN) return true;
  return false;
}

let EMPTY: HTMLCanvasElement | null = null;
/** Готовый кадр: обрезка по рисунку, свет — если окупается. */
export function finish(pic: Pic): MobFrame {
  const lit = litWorth(pic.lit) ? pic.lit : null;
  const bb = bbox(pic.p, lit);
  if (!bb) {
    if (!EMPTY) {
      EMPTY = document.createElement('canvas');
      EMPTY.width = 1;
      EMPTY.height = 1;
    }
    return { img: EMPTY, ax: 0, ay: 0, eye: null, lit: null };
  }
  const [x0, y0, x1, y1] = bb;
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  return {
    img: cropCanvas(pic.p, x0, y0, w, h),
    ax: pic.ax - x0,
    ay: pic.ay - y0,
    eye: pic.eye ? [pic.eye[0] - x0, pic.eye[1] - y0] : null,
    lit: lit ? cropCanvas(lit, x0, y0, w, h) : null,
  };
}

/**
 * Облик из готового кадра (тот же, что давал `lookRamp` перекраской частей):
 * элита — иней с синевой (светлое к ледяному, тёмное к ночной сини),
 * альбинос — белёсый. Контур остаётся чернилами.
 */
const ALB = hx('#f4f8ff');
const EL_HI = hx('#bfe8ff');
const EL_LO = hx('#2a3a8a');
function lookCanvas(img: HTMLCanvasElement, look: MobPose['look']): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) return c;
  g.drawImage(img, 0, 0);
  const im = g.getImageData(0, 0, c.width, c.height);
  const d = im.data;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    if (d[i] === INK[0] && d[i + 1] === INK[1] && d[i + 2] === INK[2]) continue;
    let t: RGBA;
    let k: number;
    if (look === 'albino') {
      t = ALB;
      k = 0.6;
    } else {
      const l = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255;
      t = l > 0.42 ? EL_HI : EL_LO;
      k = 0.35;
    }
    d[i] += (t[0] - d[i]) * k;
    d[i + 1] += (t[1] - d[i + 1]) * k;
    d[i + 2] += (t[2] - d[i + 2]) * k;
  }
  g.putImageData(im, 0, 0);
  return c;
}

/**
 * Белая вспышка удара из готового кадра: кольцо из `FL_N` холстов (новый
 * холст на кадр вспышки копил копии), кадр, что вспыхнул недавно, — из кольца
 * как есть. Кольцо длиннее шлейфа (`ghost` держит картинку до 0,2 с).
 */
const FL_N = 96;
const FL_RING: { src: CanvasImageSource | null; c: HTMLCanvasElement }[] = [];
let flAt = 0;
export function flashImg(img: HTMLCanvasElement): HTMLCanvasElement {
  for (const e of FL_RING) if (e.src === img) return e.c;
  let e = FL_RING[flAt];
  if (!e) e = FL_RING[flAt] = { src: null, c: document.createElement('canvas') };
  flAt = (flAt + 1) % FL_N;
  const c = e.c;
  if (c.width !== img.width) c.width = img.width;
  if (c.height !== img.height) c.height = img.height;
  const g = c.getContext('2d');
  if (g) {
    g.globalCompositeOperation = 'copy';
    g.globalAlpha = 1;
    g.drawImage(img, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.globalAlpha = 0.85;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
  }
  e.src = img;
  return c;
}

// ---------------------------------------------------------------------------
// Замер (урок 2): цена нового кадра, прогрев, кадры, построенные в бою.
// ---------------------------------------------------------------------------

export const F12_MOB_STAT = {
  /** Бюджет новых кадров на кадр рендера, мс (сверх — знакомый моб держит прошлый). */
  budget: 0.5,
  warming: false,
  n: 0,
  warm: 0,
  held: 0,
  ms: [] as number[],
  max: 0,
  maxKey: '',
  battle: new Map<string, number>(),
  /** Пикселей во всех построенных кадрах (с `lit`) и число кадров. */
  px: 0,
  built: 0,
  clear: () => {
    for (const K of KINDS) {
      K.frames.clear();
      K.looks.clear();
    }
  },
  reset: () => {
    F12_MOB_STAT.n = 0;
    F12_MOB_STAT.held = 0;
    F12_MOB_STAT.ms = [];
    F12_MOB_STAT.max = 0;
    F12_MOB_STAT.maxKey = '';
    F12_MOB_STAT.battle.clear();
  },
  sizes: () => KINDS.map((K) => `${K.name} ${K.frames.size}+${K.looks.size}/${K.limit}`),
};
function stat(ms: number, K: Kind, key: string): void {
  if (F12_MOB_STAT.warming) {
    F12_MOB_STAT.warm++;
    return;
  }
  F12_MOB_STAT.n++;
  if (F12_MOB_STAT.ms.length < 4000) F12_MOB_STAT.ms.push(ms);
  if (ms > F12_MOB_STAT.max) {
    F12_MOB_STAT.max = ms;
    F12_MOB_STAT.maxKey = `${K.name}|${key}`;
  }
  // Ключ без номера кадра: какие позы и стороны строились в бою.
  const k = `${K.name}|${key
    .split('|')
    .filter((_, i) => i !== 1)
    .join('|')}`;
  F12_MOB_STAT.battle.set(k, (F12_MOB_STAT.battle.get(k) ?? 0) + 1);
}
if (import.meta.env?.DEV && typeof window !== 'undefined') {
  const w = window as unknown as Record<string, unknown>;
  w.__f12stat = () => {
    const ms = [...F12_MOB_STAT.ms].sort((a, b) => a - b);
    const q = (k: number) =>
      +(ms[Math.min(ms.length - 1, Math.floor(ms.length * k))] ?? 0).toFixed(2);
    return {
      n: F12_MOB_STAT.n,
      warm: F12_MOB_STAT.warm,
      held: F12_MOB_STAT.held,
      p50: q(0.5),
      p90: q(0.9),
      max: +F12_MOB_STAT.max.toFixed(2),
      maxKey: F12_MOB_STAT.maxKey,
      sizes: F12_MOB_STAT.sizes(),
      mb: +((F12_MOB_STAT.px * 4) / 1048576).toFixed(1),
      kbPerFrame: +((F12_MOB_STAT.px * 4) / 1024 / Math.max(1, F12_MOB_STAT.built)).toFixed(1),
      battle: [...F12_MOB_STAT.battle.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16),
    };
  };
  w.__f12mob = F12_MOB_STAT;
}

let budNow = -1;
let budSpent = 0;

/**
 * Кадр вида: поза `anim`, кадр `f`, сторона `d`. Облик — перекраской
 * готового, вспышка — поверх. Сверх бюджета знакомый моб держит прошлый кадр
 * (лист кадров зовёт рисовальщик новым мобом — там бюджет не срабатывает).
 * Возвращает кадр из кеша — не менять, а копировать (`{ ...fr, ...ex }`).
 */
export function frameOf(
  K: Kind,
  anim: string,
  f: number,
  d: number,
  pose: MobPose,
  build: () => Build,
): MobFrame {
  const key = `${anim}|${f}|${d}`;
  const v = cur;
  cur = null;
  const live = !F12_MOB_STAT.warming;
  let fr = K.frames.get(key);
  if (!fr && live && v && !curFresh && v.last && v.lastK === K) {
    const now = pose.now || 0;
    if (now !== budNow) {
      budNow = now;
      budSpent = 0;
    }
    if (budSpent >= F12_MOB_STAT.budget) {
      F12_MOB_STAT.held++;
      return pose.flash ? { ...v.last, img: flashImg(v.last.img as HTMLCanvasElement) } : v.last;
    }
  }
  if (!fr) {
    const t0 = performance.now();
    fr = K.frames.set(key, finish(draw(K, build(), d)));
    const ms = performance.now() - t0;
    stat(ms, K, key);
    if (live) budSpent += ms;
    F12_MOB_STAT.built++;
    F12_MOB_STAT.px += fr.img.width * fr.img.height * (fr.lit ? 2 : 1);
  }
  if (pose.look !== 'normal') {
    const lk = `${key}|${pose.look}`;
    let lf = K.looks.get(lk);
    if (!lf) {
      const t0 = performance.now();
      lf = K.looks.set(lk, { ...fr, img: lookCanvas(fr.img as HTMLCanvasElement, pose.look) });
      stat(performance.now() - t0, K, lk);
    }
    fr = lf;
  }
  if (v && live) {
    v.last = fr;
    v.lastK = K;
  }
  return pose.flash ? { ...fr, img: flashImg(fr.img as HTMLCanvasElement) } : fr;
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

/** Прогрев: кадры поз во всех сторонах вида, по одному на шаг генератора. */
export function* warmAll(
  K: Kind,
  list: [string, number][],
  build: (anim: string, f: number) => Build,
) {
  for (const [anim, n] of list)
    for (let d = 0; d < K.dirs; d++)
      for (let f = 0; f < n; f++) {
        F12_MOB_STAT.warming = true;
        try {
          frameOf(K, anim, f, d, WARM_POSE, () => build(anim, f));
        } finally {
          F12_MOB_STAT.warming = false;
        }
        yield 0;
      }
}

/**
 * Рисовальщик моба этажа: невидимка «Безмолвия» (видны только глаза) и
 * ослеплённый гонгом (шатается) — у всех одинаково, как у `regMob`.
 * `fn` возвращает свежий объект кадра (поля движка поверх кадра из кеша).
 */
export function paintMob(id: string, fn: (m: Mob, pose: MobPose) => MobFrame | null): void {
  registerMobPainter(id, (m, pose) => {
    const f = fn(m, pose);
    if (!f) return f;
    const data = m.data ?? {};
    if ((data.dark ?? 0) > 0) {
      f.alpha = 0.07;
      f.shadow = 0;
      f.ghost = null;
      f.lit = null;
    }
    if ((data.blind ?? 0) > 0) {
      f.rot = (f.rot ?? 0) + Math.sin((pose.now || 0) * 9) * 0.14;
      f.still = true;
    }
    return f;
  });
}

// ---------------------------------------------------------------------------
// 2D поверх рига (в `post`): пыль снега, крошка льда, след.
// ---------------------------------------------------------------------------

/**
 * Снежная пыль у земли: `n` крупинок разлётом от (x, y, 0) модели, `k` 0…1 —
 * доля разлёта (вверх по дуге, к концу оседает), `seed` — свой рисунок.
 */
export function puff(
  p: Px,
  scr: Scr,
  x: number,
  y: number,
  k: number,
  n: number,
  r: number,
  seed: number,
  col: RGBA[],
  dir = 0,
  spread = TAU,
): void {
  if (k <= 0 || k >= 1) return;
  for (let i = 0; i < n; i++) {
    const a = dir + (hash(i, seed, 501) - 0.5) * spread;
    const v = 0.45 + hash(i, seed, 502) * 0.55;
    const h = (1.5 + hash(i, seed, 503) * 3) * Math.sin(k * PI);
    const [sx, sy] = scr(x + Math.cos(a) * r * k * v, y + Math.sin(a) * r * k * v, h);
    const c = col[i % col.length];
    p.set(sx, sy, k > 0.7 ? [c[0], c[1], c[2], Math.round(c[3] * (1 - k) * 3.3)] : c);
  }
}

/** Ломаная из пикселей с тающей к хвосту прозрачностью (след удара, иглы). */
export function trail(p: Px, pts: [number, number][], c: RGBA, a0 = 1, a1 = 0.2): void {
  const n = pts.length;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
    for (let s = 0; s < steps; s++) {
      const k = (i + s / steps) / Math.max(1, n - 1);
      const a = a0 + (a1 - a0) * k;
      p.set(x0 + ((x1 - x0) * s) / steps, y0 + ((y1 - y0) * s) / steps, [
        c[0],
        c[1],
        c[2],
        Math.round(255 * clamp01(a)),
      ]);
    }
  }
}

const STAR_A = hx('#fff6a0');
const STAR_B = hx('#ffd23a');
/** Звёзды оглушения над головой: фаза 0…1, центр (cx, cy, z) модели, радиус. */
export function stars(p: Px, scr: Scr, z: number, ph: number, cx = 0, cy = 0, r = 4): void {
  for (let k = 0; k < 3; k++) {
    const a = ph * TAU + (k / 3) * TAU;
    const [x, y] = scr(cx + Math.cos(a) * r, cy + Math.sin(a) * r, z);
    p.set(x, y, STAR_A);
    p.set(x + 1, y, STAR_B);
    p.set(x, y - 1, STAR_A);
  }
}

/** Свет луны по кромке (тот же, что у мамонта): тёмный силуэт не тонет в ночном полу. */
export const RIM_C = hx('#a9c8f2');
/** Кромка сверху-слева светлеет к `c` на долю `k` (контур — нет). */
export function rimLight(p: Px, c: RGBA, k: number): void {
  const { w, h, data } = p;
  const dark = (i: number) =>
    data[i + 3] === 0 || (data[i] === INK[0] && data[i + 1] === INK[1] && data[i + 2] === INK[2]);
  const hits: number[] = [];
  for (let y = 1; y < h; y++)
    for (let x = 1; x < w; x++) {
      const i = (y * w + x) * 4;
      if (data[i + 3] < 255 || dark(i)) continue;
      const up = dark(i - w * 4);
      const lf = dark(i - 4);
      if (up || lf) hits.push(i, up ? (lf ? 1 : 0.8) : 0.45);
    }
  for (let j = 0; j < hits.length; j += 2) {
    const i = hits[j];
    const a = hits[j + 1] * k;
    data[i] += (c[0] - data[i]) * a;
    data[i + 1] += (c[1] - data[i + 1]) * a;
    data[i + 2] += (c[2] - data[i + 2]) * a;
  }
}
