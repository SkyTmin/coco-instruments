// Этаж 8 «Бесконечный замок» — набор рисунка мобов (анимации мобов 8, по
// эталону боссов 12–14 и мобов 2–5). Облик прежний — нечисть в кимоно и
// хакама, паук, фонарь, сёдзи, — а тело собирается из мини-3D рига
// (`f15-rig.ts`, только импорт): суставы в своих осях, эллипсоиды и капсулы,
// свет сверху-слева, контур. Отсюда 8 сторон хода — все рисуются честно
// (катана, бива и мешок несимметричны). Каждое действие — трек 24 к/с от
// `pose.t` (ключевые позы и кривые), кадр контакта = миг урона мозга;
// вторичное (рукава, волосы, хвост) — те же ключи со сдвигом времени. Ход —
// по пройденному пути, курс с пределом поворота; покой — с фазой от номера
// моба. Кадры — в `frameLRU` с пределом на вид, обрезаны до рисунка,
// вспышка удара героя — заливкой готового холста; прогрев — `registerMobWarm`.

import type { Mob } from '../dungeon-sim';
import { Px } from '../dungeon-art';
import { frameLRU, paintSim } from '../dungeon-paint';
import type { FrameLRU, MobFrame, MobPose } from '../dungeon-paint';
import { F3, proj, renderRig, Rig, SE } from './f15-rig';
import type { Mat, RGBA, Tones, V3 } from './f15-rig';

export { F3, Rig, SE };
export type { Mat, RGBA, Tones, V3 };

export const PI = Math.PI;
export const TAU = PI * 2;
export const FPS = 24;

// ---- Цвета ------------------------------------------------------------------------

export const hx = (h: string, a = 255): RGBA => {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255, a];
};
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
  Math.round(a[3] + (b[3] - a[3]) * k),
];
export const alphaC = (c: RGBA, a: number): RGBA => [
  c[0],
  c[1],
  c[2],
  Math.round(clamp01(a) * 255),
];
export const darkT = (t: Tones, k: number): Tones =>
  t.map((c) => mixc(c, [8, 6, 10, c[3]], k)) as Tones;

export const INK = hx('#150f0b');
export const WHITE = hx('#ffffff');
export const GOLD = hx('#ffcc40');

// ---- Кривые, кванты, шум -------------------------------------------------------------

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
export const smooth = (k: number) => {
  const x = clamp01(k);
  return x * x * (3 - 2 * x);
};
export const sstep = (a: number, b: number, x: number) => smooth((x - a) / (b - a));
export const easeOut = (k: number) => 1 - (1 - clamp01(k)) ** 3;
export const easeIn = (k: number) => clamp01(k) ** 3;
export const easeIn2 = (k: number) => clamp01(k) ** 2;
export const linear = (k: number) => clamp01(k);
/** Номер кадра 24 к/с (не больше `max`). */
export const fi = (t: number, max: number) =>
  Math.min(max, Math.max(0, Math.floor(t * FPS + 1e-6)));
/** Время середины кадра `f` (с). */
export const tf = (f: number) => (f + 0.5) / FPS;
export const mod = (n: number, k: number) => ((Math.floor(n) % k) + k) % k;

/** Детерминированный шум по числам, 0…1 (рисунок не трогает `sim.rng`). */
export const hash = (a: number, b: number, c = 0) => {
  let h = (a * 374761393 + b * 668265263 + c * 1274126177) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export type Ease = (x: number) => number;
export type Key = [number, number, Ease?];
/** Дорожка ключей: время → значение; кривая — у ключа, к которому идём. */
export function trk(t: number, keys: Key[]): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [k1, v1, e] = keys[i];
    if (t <= k1) {
      const [k0, v0] = keys[i - 1];
      const x = (t - k0) / (k1 - k0 || 1);
      return v0 + (v1 - v0) * (e ?? smooth)(x);
    }
  }
  return keys[keys.length - 1][1];
}

// ---- Позы ключами ----------------------------------------------------------------------

/** Поза — словарь чисел и точек; промежуточные — интерполяцией ключей. */
export type PoseO = Record<string, number | V3>;
/** Ключ позы: время (с), правки к основе, кривая подхода. */
export type PKey<O extends PoseO> = [number, Partial<O>, Ease?];

function mixField(a: number | V3, b: number | V3, k: number): number | V3 {
  if (typeof a === 'number') return a + ((b as number) - a) * k;
  const B = b as V3;
  return [a[0] + (B[0] - a[0]) * k, a[1] + (B[1] - a[1]) * k, a[2] + (B[2] - a[2]) * k];
}

/**
 * Ключи «с переносом»: поле, которого нет у ключа, держится с прошлого ключа;
 * пустой ключ `{}` — возврат к основе. Для долгих дорожек (смерть, прыжок).
 */
export function carry<O extends PoseO>(keys: PKey<O>[]): PKey<O>[] {
  let acc: Partial<O> = {};
  return keys.map(([t, o, e]) => {
    acc = Object.keys(o).length ? { ...acc, ...o } : {};
    return [t, acc, e] as PKey<O>;
  });
}

/** Поза в миг `t` по ключам (поля, которых нет у ключа, — от основы). */
export function sampleKeys<O extends PoseO>(base: O, keys: PKey<O>[], t: number): O {
  const full = (k: PKey<O>) => k[1];
  let i = 1;
  if (t <= keys[0][0]) return { ...base, ...full(keys[0]) } as O;
  while (i < keys.length && t > keys[i][0]) i++;
  if (i >= keys.length) return { ...base, ...full(keys[keys.length - 1]) } as O;
  const a = keys[i - 1];
  const b = keys[i];
  const x = (t - a[0]) / (b[0] - a[0] || 1);
  const e = (b[2] ?? smooth)(x);
  const o = { ...base } as Record<string, number | V3>;
  const fa = full(a) as Record<string, number | V3>;
  const fb = full(b) as Record<string, number | V3>;
  const keysAll = new Set([...Object.keys(fa), ...Object.keys(fb)]);
  for (const f of keysAll) {
    const va = fa[f] ?? (base as Record<string, number | V3>)[f];
    const vb = fb[f] ?? (base as Record<string, number | V3>)[f];
    if (va === undefined || vb === undefined) continue;
    o[f] = mixField(va, vb, e);
  }
  return o as O;
}

/** Смесь двух поз (переход от одной к другой). */
export function mixPose<O extends PoseO>(a: O, b: O, k: number): O {
  const o = { ...a } as Record<string, number | V3>;
  for (const f of Object.keys(b)) {
    const va = (a as Record<string, number | V3>)[f];
    const vb = (b as Record<string, number | V3>)[f];
    if (va === undefined) o[f] = vb;
    else o[f] = mixField(va, vb, k);
  }
  return o as O;
}

// ---- Вектора и сустав -------------------------------------------------------------------

export const vadd = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const vsub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const vmul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const vdot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const vlen = (a: V3) => Math.sqrt(vdot(a, a));
export const vnorm = (a: V3): V3 => {
  const l = vlen(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const vlerp = (a: V3, b: V3, k: number): V3 => [
  a[0] + (b[0] - a[0]) * k,
  a[1] + (b[1] - a[1]) * k,
  a[2] + (b[2] - a[2]) * k,
];

/** Сустав двух звеньев: от `a` к `b`, длины `l1`, `l2`, колено — в сторону `pole`. */
export function ik(a: V3, b: V3, l1: number, l2: number, pole: V3): V3 {
  const d = vsub(b, a);
  let L = vlen(d);
  if (L < 1e-6) return vadd(a, vmul(vnorm(pole), l1));
  const dir = vmul(d, 1 / L);
  L = Math.min(L, l1 + l2 - 1e-3);
  const x = (l1 * l1 - l2 * l2 + L * L) / (2 * L);
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  let pp = vsub(pole, vmul(dir, vdot(pole, dir)));
  const pl = vlen(pp);
  pp = pl > 1e-6 ? vmul(pp, 1 / pl) : [0, 0, 1];
  return vadd(vadd(a, vmul(dir, x)), vmul(pp, h));
}

// ---- Стороны и ход -------------------------------------------------------------------------

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

export interface Vis {
  now: number;
  x: number;
  y: number;
  /** Курс рисунка, игровой угол (сглажен пределом поворота). */
  yaw: number;
  /** Пройденный путь, клетки (вперёд по курсу — плюс, пятится — минус). */
  dist: number;
  mode: string;
  prev: string;
  /** Когда сменился режим (часы рендера) — переходы. */
  modeAt: number;
  /** Миг последнего удара героя (часы рендера) и отдача — единичный вектор. */
  hit: number;
  fl: number;
  kx: number;
  ky: number;
  /** Прошлый показанный кадр и его вид — его держит бюджет новых кадров. */
  last?: MobFrame;
  lastK?: Kind;
}
const VIS = new WeakMap<Mob, Vis>();
/** Моб текущего вызова рисовальщика (`visOf` → `frameOf`) и впервые ли он виден. */
let cur: Vis | null = null;
let curFresh = false;

/**
 * Прошлый режим для листа кадров: стенд рисует каждый кадр новым мобом и
 * передаёт его номером в `m.data.vSheetPrev` (в игре его помнит `Vis`).
 */
const SHEET_PREV = [
  '',
  'leap',
  'lunge',
  'drop',
  'star',
  'aim',
  'belly',
  'f8_gone',
  'f8_thrust',
  'f8_open',
];

export const speedOf = (m: Mob) => Math.hypot(m.vx ?? 0, m.vy ?? 0);
export const moving = (m: Mob, thr = 0.4) => speedOf(m) > thr;

function knockOf(v: Vis, m: Mob): void {
  const sim = paintSim();
  let kx = m.kx ?? 0;
  let ky = m.ky ?? 0;
  if (sim && Math.hypot(kx, ky) < 0.01) {
    kx = (m.x ?? 0) - sim.hero.x;
    ky = (m.y ?? 0) - sim.hero.y;
  }
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
      dist: speedOf(m) * (pose.t || 0),
      mode: pose.mode,
      prev: SHEET_PREV[m.data?.vSheetPrev ?? 0] ?? '',
      modeAt: now - (pose.t || 0),
      hit: fl > 0 ? now - Math.max(0, 0.12 - fl) : -9,
      fl,
      kx: 0,
      ky: 0,
    };
    knockOf(v, m);
    VIS.set(m, v);
    cur = v;
    curFresh = true;
    return v;
  }
  cur = v;
  curFresh = false;
  const dt = clamp(now - v.now, 0, 0.1);
  if (dt > 0) {
    const mx = (m.x ?? 0) - v.x;
    const my = (m.y ?? 0) - v.y;
    const step = Math.min(Math.hypot(mx, my), 1);
    // Вдоль курса — вперёд, против — пятится (шаг назад теми же кадрами).
    const along = mx * Math.cos(v.yaw) + my * Math.sin(v.yaw);
    v.dist += along >= -0.3 * step ? step : -step;
    v.x = m.x ?? 0;
    v.y = m.y ?? 0;
    v.now = now;
    const lim = turn * dt;
    v.yaw += clamp(angD(want, v.yaw), -lim, lim);
  }
  if (pose.mode !== v.mode) {
    v.prev = v.mode;
    v.mode = pose.mode;
    v.modeAt = now - (pose.t || 0);
  }
  if (fl > v.fl + 0.02) {
    v.hit = now;
    knockOf(v, m);
  }
  v.fl = fl;
  return v;
}

/**
 * Реакция на удар героя поверх любой позы (0,25 с): отброс корпуса по
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
  ex.sy = (ex.sy ?? 1) * (1 - 0.12 * sq);
  ex.rot = (ex.rot ?? 0) + v.kx * 0.12 * out;
}

/** Кадр реакции на удар (0…4) — поза «вздрогнул», пока идёт отдача. */
export const hurtF = (v: Vis, now: number) => {
  const a = now - v.hit;
  return a >= 0 && a < 0.21 ? fi(a, 4) : -1;
};

/** Удар героя пришёлся спереди (+1) или сзади (−1) — по курсу рисунка. */
export const hitFront = (v: Vis) =>
  -(v.kx * Math.cos(v.yaw) + v.ky * Math.sin(v.yaw)) >= 0 ? 1 : -1;

// ---- Кадр: риг → картинка → обрезка → кеш ----------------------------------------------------

export interface Pic {
  p: Px;
  lit: Px | null;
  ax: number;
  ay: number;
  eye: [number, number] | null;
}

export interface Kind {
  id: string;
  w: number;
  h: number;
  ax: number;
  ay: number;
  limit: number;
  frames: FrameLRU<MobFrame>;
}

const KINDS: Kind[] = [];
export function kindOf(id: string, w: number, h: number, ax: number, ay: number, limit: number) {
  const K: Kind = { id, w, h, ax, ay, limit, frames: frameLRU<MobFrame>(limit) };
  KINDS.push(K);
  return K;
}

/**
 * Замер для стенда: цена нового кадра (мс), сколько и каких кадров
 * построено (`miss` — последние ключи), `clear` — сбросить кеши всех видов.
 */
export const F8_MOB_STAT = {
  n: 0,
  ms: [] as number[],
  by: {} as Record<string, number>,
  /** Из неё — обрезка и холсты (`finishPic`), мс. */
  fin: [] as number[],
  /** Цена нового кадра по видам, мс. */
  msBy: {} as Record<string, number[]>,
  miss: [] as string[],
  warm: 0,
  /**
   * Бюджет новых кадров на кадр рендера, мс (как у 1-го этажа): сверх него
   * знакомый моб держит прошлый кадр, новый строится в следующем кадре.
   */
  budget: 0.5,
  /** Сколько раз моб держал прошлый кадр из-за бюджета. */
  held: 0,
  /** Площадь построенных холстов (кадр + `lit`), точек — оценка памяти кеша. */
  px: 0,
  /** Сейчас идёт прогрев (кадры прогрева не попадают в `miss`). */
  warming: false,
  sizes: () => KINDS.map((K) => `${K.id}:${K.frames.size}/${K.limit}`).join(' '),
  clear: () => {
    for (const K of KINDS) K.frames.clear();
  },
};
function stat(K: Kind, ms: number, key: string): void {
  if (F8_MOB_STAT.warming) {
    F8_MOB_STAT.warm++;
    return;
  }
  F8_MOB_STAT.n++;
  if (F8_MOB_STAT.ms.length < 4000) F8_MOB_STAT.ms.push(ms);
  F8_MOB_STAT.by[K.id] = (F8_MOB_STAT.by[K.id] ?? 0) + 1;
  const mb = (F8_MOB_STAT.msBy[K.id] ??= []);
  if (mb.length < 2000) mb.push(ms);
  F8_MOB_STAT.miss.push(`${K.id}|${key}`);
  if (F8_MOB_STAT.miss.length > 600) F8_MOB_STAT.miss.splice(0, 300);
}

/** Риг → картинка на холсте вида. `post` дорисовывает по экранным точкам. */
export type Proj2 = (v: V3) => [number, number];
export function draw(
  K: Kind,
  r: Rig,
  post?: (p: Px, lit: () => Px, P: Proj2) => void,
  inner = 2.2,
  outline: RGBA = INK,
): Pic {
  const o = renderRig(r, K.w, K.h, K.ax, K.ay, { outline, inner });
  if (post) {
    const litOn = () => (o.lit ??= new Px(o.p.w, o.p.h));
    post(o.p, litOn, (v) => {
      const q = proj(v, K.ax, K.ay);
      return [q[0], q[1]];
    });
  }
  return { p: o.p, lit: o.lit, ax: K.ax, ay: K.ay, eye: o.eye };
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
function goldEdge(src: Px): Px {
  const p = new Px(src.w, src.h);
  p.data.set(src.data);
  const solid = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < p.w && y < p.h && src.data[(y * p.w + x) * 4 + 3] >= 200;
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      if (src.data[(y * p.w + x) * 4 + 3] >= 100) continue;
      if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))
        p.set(x, y, GOLD);
    }
  return p;
}

/** Холст из части буфера пикселей. */
function canvasOf(p: Px, x0: number, y0: number, cw: number, ch: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  const g = c.getContext('2d');
  if (g) {
    const img = g.createImageData(cw, ch);
    for (let y = 0; y < ch; y++) {
      const s = ((y + y0) * p.w + x0) * 4;
      img.data.set(p.data.subarray(s, s + cw * 4), y * cw * 4);
    }
    g.putImageData(img, 0, 0);
  }
  return c;
}

/**
 * Готовая картинка → кадр: облик (элита — золотой кант, альбинос —
 * бледный), холст обрезан до рисунка и света (`lit`) — площадь кадра главная
 * цена вывода толпы; якорь, глаз и `lit` сдвинуты следом.
 */
export function finishPic(pic: Pic, look: MobPose['look']): MobFrame {
  let p = pic.p;
  if (look === 'albino') p = paleOf(p);
  if (look === 'elite') p = goldEdge(p);
  const { w, h } = p;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  const scan = (d: Uint8ClampedArray) => {
    for (let y = 0; y < h; y++)
      for (let x = 0, i = y * w * 4 + 3; x < w; x++, i += 4)
        if (d[i]) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
  };
  scan(p.data);
  if (pic.lit) scan(pic.lit.data);
  if (x1 < 0) {
    x0 = 0;
    y0 = 0;
    x1 = 0;
    y1 = 0;
  }
  const cw = x1 + 1 - x0;
  const ch = y1 + 1 - y0;
  return {
    img: canvasOf(p, x0, y0, cw, ch),
    ax: pic.ax - x0,
    ay: pic.ay - y0,
    eye: pic.eye ? [pic.eye[0] - x0, pic.eye[1] - y0] : null,
    lit: pic.lit ? canvasOf(pic.lit, x0, y0, cw, ch) : null,
  };
}

/**
 * Белая вспышка удара из готового кадра: тот же холст, залитый белым поверх
 * себя, без перерисовки позы. Холсты вспышки — кольцо из `FL_N` штук: новый
 * холст на каждый кадр вспышки стоил ~45 мкс и копил копии кадров, перекраска
 * готового — ~13 мкс; кадр, что вспыхнул недавно, берётся из кольца как есть.
 * Кольцо длиннее шлейфа (`ghost` держит картинку до 0,16 с).
 */
const FL_N = 96;
const FL_RING: { src: HTMLCanvasElement | null; c: HTMLCanvasElement }[] = [];
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

let budNow = -1;
let budSpent = 0;

/**
 * Кадр вида: поза `anim`, кадр `f`, сторона `d`. Вспышка — поверх готового.
 * Новых кадров за кадр рендера — не дороже `F8_MOB_STAT.budget`: сверх него
 * знакомый моб (не первый показ, тот же вид) держит прошлый кадр. Лист кадров
 * зовёт рисовальщик с новым мобом на каждый кадр — там бюджет не срабатывает.
 */
export function frameOf(
  K: Kind,
  anim: string,
  f: number,
  d: number,
  pose: MobPose,
  build: () => Pic,
): MobFrame {
  const key = `${anim}|${f}|${d}|${pose.look}`;
  const v = cur;
  cur = null;
  const live = !F8_MOB_STAT.warming;
  let fr = K.frames.get(key);
  if (!fr && live) {
    const now = pose.now || 0;
    if (now !== budNow) {
      budNow = now;
      budSpent = 0;
    }
    if (budSpent >= F8_MOB_STAT.budget && v && !curFresh && v.last && v.lastK === K) {
      F8_MOB_STAT.held++;
      fr = v.last;
    }
  }
  if (!fr) {
    const t0 = performance.now();
    const pic = build();
    const t1 = performance.now();
    fr = K.frames.set(key, finishPic(pic, pose.look));
    if (!F8_MOB_STAT.warming && F8_MOB_STAT.fin.length < 4000)
      F8_MOB_STAT.fin.push(performance.now() - t1);
    stat(K, performance.now() - t0, key);
    if (live) budSpent += performance.now() - t0;
    F8_MOB_STAT.px += fr.img.width * fr.img.height * (fr.lit ? 2 : 1);
  }
  if (v && live) {
    v.last = fr;
    v.lastK = K;
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

/** Прогрев: кадры поз во всех 8 сторонах, по одному на шаг. */
export function* warmAll(
  K: Kind,
  list: [string, number][],
  pic: (a: string, f: number, d: number) => Pic,
  dirs: number[] = [0, 1, 2, 3, 4, 5, 6, 7],
) {
  for (const [anim, n] of list)
    for (const d of dirs)
      for (let f = 0; f < n; f++) {
        F8_MOB_STAT.warming = true;
        frameOf(K, anim, f, d, WARM_POSE, () => pic(anim, f, d));
        F8_MOB_STAT.warming = false;
        yield 0;
      }
}

/** Пустой кадр (моб спрятан). */
let EMPTY: HTMLCanvasElement | null = null;
export const emptyFrame = (): MobFrame => {
  EMPTY ??= new Px(1, 1).canvas();
  return { img: EMPTY, ax: 0, ay: 0, eye: null, shadow: 0, still: true };
};

// ---- Рисование в кадре поверх рига (след, искры, звуковые дуги) --------------------------------

/** Точка на холсте (полупрозрачная — поверх). */
export const dot = (p: Px, x: number, y: number, c: RGBA) => p.set(Math.floor(x), Math.floor(y), c);

/** Отрезок по пикселям. */
export function seg2(p: Px, x0: number, y0: number, x1: number, y1: number, c: RGBA): void {
  const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))) + 1;
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    p.set(Math.floor(x0 + (x1 - x0) * k), Math.floor(y0 + (y1 - y0) * k), c);
  }
}

/**
 * След (smear) дугой: полоса между двумя дугами экрана по точкам `pts`
 * (старые → новые), прозрачность растёт к новому краю.
 */
export function smear(p: Px, pts: [number, number][], c: RGBA, edge: RGBA, w = 2): void {
  for (let i = 1; i < pts.length; i++) {
    const k = i / (pts.length - 1);
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const a = 0.25 + 0.65 * k;
    seg2(p, x0, y0, x1, y1, alphaC(i === pts.length - 1 ? edge : c, a));
    if (w > 1) {
      const nx = -(y1 - y0);
      const ny = x1 - x0;
      const l = Math.hypot(nx, ny) || 1;
      seg2(p, x0 + nx / l, y0 + ny / l, x1 + nx / l, y1 + ny / l, alphaC(c, a * 0.6));
    }
  }
}
