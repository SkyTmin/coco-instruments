// Этаж 14 «Часовая башня» — общий набор рисунка мобов (анимации мобов 14).
//
// Мобы этажа собраны из примитивов мини-3D (`f15-rig.ts`) и смотрят в одну
// из 8 сторон — туда, куда идут (курс с пределом поворота): боком не ходят.
// Шаг — по пройденному пути, техника — 24 к/с от времени режима, кадр
// контакта — ровно там, где бьёт мозг (`f14-brains.ts`).
//
// Время этажа: колокол «ЧАС» останавливает мир — мозг не шагает и `m.t`
// стоит, поэтому техника замирает сама. Покой и вторичное движение идут от
// ВРЕМЕНИ МИРА (`wnow`: `sim.time` рисуемого мира), а не от времени рендера,
// — иначе в остановке дышали бы и качали султаном.
//
// Кадр строится раз на позу и сторону и живёт в кеше с вытеснением (у вида
// свой предел). Холст обрезается до рисунка, якорь и `lit` сдвигаются
// следом. Облик (элита, альбинос) и «замершее время» (серый с сепией —
// статуя Завода, Стоп-кадр) — перекраска готового кадра в отдельном кеше;
// вспышка удара героя — копия холста из кольца на 96 холстов. Сверх бюджета
// (0,5 мс новых кадров на кадр рендера) знакомый моб держит прошлый кадр.
// Состояние рисунка — в `WeakMap` по мобу: в `m.data` рисунок не пишет.

import { Px } from '../dungeon-art';
import { frameLRU, paintSim, registerMobWarm } from '../dungeon-paint';
import type { FrameLRU, MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import { F3, Rig, proj, renderRig } from './f15-rig';
import type { Mat, RGBA, RigOut, Tones, V3 } from './f15-rig';
import {
  GOLDK,
  INK,
  KRig,
  NDIR,
  PI,
  TAU,
  WHITE,
  alpha,
  angD,
  arm,
  camSide,
  clamp,
  clamp01,
  dirN,
  easeIn,
  easeIn3,
  easeOut,
  fi,
  fill2,
  gait,
  hash,
  hx,
  ik,
  leg,
  lerp,
  lin,
  litOn,
  mixc,
  rigYaw,
  smear,
  smooth,
  spark2,
  spray,
  sstep,
  tf,
  tn,
  trk,
  vadd,
  vlen,
  vlerp,
  vmul,
  vnorm,
  vsub,
  yawN,
} from './f10-mobs';
import type { Ease, Key } from './f10-mobs';

export {
  F3,
  GOLDK,
  INK,
  KRig,
  NDIR,
  PI,
  Rig,
  TAU,
  WHITE,
  alpha,
  angD,
  arm,
  camSide,
  clamp,
  clamp01,
  dirN,
  easeIn,
  easeIn3,
  easeOut,
  fi,
  fill2,
  gait,
  hash,
  hx,
  ik,
  leg,
  lerp,
  lin,
  litOn,
  mixc,
  proj,
  rigYaw,
  smear,
  smooth,
  spark2,
  spray,
  sstep,
  tf,
  tn,
  trk,
  vadd,
  vlen,
  vlerp,
  vmul,
  vnorm,
  vsub,
  yawN,
};
export type { Ease, Key, Mat, RGBA, RigOut, Tones, V3 };

export const FPS = 24;

/** Пружинный выход за цель и назад (механизм — с отскоком). */
export const easeBack = (k: number) => {
  const x = clamp01(k);
  const s = 1.9;
  return 1 + (s + 1) * (x - 1) ** 3 + s * (x - 1) ** 2;
};

// ---------------------------------------------------------------------------
// Время мира и ход моба.
// ---------------------------------------------------------------------------

/**
 * Время мира, с: стоит в остановке «ЧАС», идёт в бою. Вне рисования мира
 * (лист кадров, портрет бестиария) — время рендера.
 */
export const wnow = (pose: MobPose): number => {
  const s = paintSim();
  return s ? s.time : pose.now || 0;
};

/** Фаза покоя 0…1: своя у каждого моба (стая не дышит в такт). */
export const idlePh = (m: Mob, pose: MobPose, period: number): number => {
  const t = wnow(pose) / period + hash(m.id ?? 0, 17);
  return ((t % 1) + 1) % 1;
};

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
  /** Прошлый кадр (держится, когда бюджет новых кадров исчерпан). */
  last: MobFrame | null;
  lastK: Kind | null;
  /** Нарисованная сторона (с запасом у границы сектора — `sideOf`); −1 — ещё нет. */
  side: number;
}
const VIS = new WeakMap<Mob, Vis>();

/**
 * Прошлый режим для листа кадров: стенд рисует каждый кадр новым мобом и
 * передаёт его номером в `m.data.vSheetPrev` (в игре его помнит `Vis`).
 * Только дописывать в конец — номера уже стоят в спеках листов.
 */
const SHEET_PREV = [
  '',
  'aim',
  'windup',
  'f14_curl',
  'f14_roll',
  'f14_statue',
  'f14_frozen',
  'f14_unwound',
  'f14_rewind',
  'f14_waking',
  'drop',
  'emerge',
  'stun',
  'dizzy',
  'f14_blast',
  'f14_rise',
  'f14_hour',
  'f14_minute',
  'f14_swing',
  'f14_haste',
  'f14_fall',
  'f14_peck',
  'recover',
  'chase',
  'f14_blink',
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
      last: null,
      lastK: null,
      side: -1,
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

/**
 * Сторона рисунка с запасом `hyst` (рад) у границы сектора: курс, что
 * виляет у границы (зигзаг погони), не дёргает сторону туда-сюда.
 */
export function sideOf(v: Vis, hyst = 0.14): number {
  const d = dirN(v.yaw);
  if (v.side < 0 || d === v.side) return (v.side = d);
  const c = (v.side / NDIR) * TAU;
  if (Math.abs(angD(v.yaw, c)) < PI / NDIR + hyst) return v.side;
  return (v.side = d);
}

/** Фаза шага 0…1 по пройденному пути (`stride` — клеток на цикл). */
export const stepPh = (v: Vis, stride: number) => (((v.dist / stride) % 1) + 1) % 1;

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
// Кадр: риг → картинка → обрезка → кеш; облик и «замершее время» — перекраской.
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
  frames: FrameLRU<MobFrame>;
  /** Облик и серый — из готового кадра, свой кеш (~35 % предела вида). */
  looks: FrameLRU<MobFrame>;
  limit: number;
  /** Точек в построенных кадрах вида (замер памяти). */
  px: number;
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
    frames: frameLRU<MobFrame>(limit),
    looks: frameLRU<MobFrame>(Math.ceil(limit * 0.35)),
    limit,
    px: 0,
  };
  KINDS.push(K);
  return K;
};

/**
 * Замер для стенда (урок 2): цена нового кадра (мс), сколько кадров
 * нарисовал прогрев, какие кадры строились в бою (по ключу без номера
 * кадра), сколько раз моб держал прошлый кадр сверх бюджета.
 */
export const F14_MOB_STAT = {
  budget: 0.5,
  /** Общая очередь прогрева этажа (стенд: `false` — как греет движок). */
  sched: true,
  warming: false,
  n: 0,
  warm: 0,
  held: 0,
  ms: [] as number[],
  max: 0,
  maxKey: '',
  battle: new Map<string, number>(),
  /** Цена кадров прогрева по видам (мс) — для отчёта замера. */
  wms: new Map<string, number[]>(),
  px: 0,
  built: 0,
  lit: 0,
  clear: () => {
    for (const K of KINDS) {
      K.frames.clear();
      K.looks.clear();
    }
  },
  reset: () => {
    F14_MOB_STAT.n = 0;
    F14_MOB_STAT.held = 0;
    F14_MOB_STAT.ms = [];
    F14_MOB_STAT.max = 0;
    F14_MOB_STAT.maxKey = '';
    F14_MOB_STAT.battle.clear();
  },
  sizes: () =>
    KINDS.map(
      (K) =>
        `${K.name} ${K.frames.size}+${K.looks.size}/${K.limit} ${((K.px * 4) / 1048576).toFixed(1)}MB`,
    ),
};
function stat(ms: number, K: Kind, key: string): void {
  if (F14_MOB_STAT.warming) {
    F14_MOB_STAT.warm++;
    const w = F14_MOB_STAT.wms.get(K.name) ?? [];
    if (w.length < 4000) w.push(ms);
    F14_MOB_STAT.wms.set(K.name, w);
    return;
  }
  F14_MOB_STAT.n++;
  if (F14_MOB_STAT.ms.length < 4000) F14_MOB_STAT.ms.push(ms);
  if (ms > F14_MOB_STAT.max) {
    F14_MOB_STAT.max = ms;
    F14_MOB_STAT.maxKey = `${K.name}|${key}`;
  }
  const k = `${K.name}|${key
    .split('|')
    .filter((_, i) => i !== 1)
    .join('|')}`;
  F14_MOB_STAT.battle.set(k, (F14_MOB_STAT.battle.get(k) ?? 0) + 1);
}
if (import.meta.env?.DEV && typeof window !== 'undefined') {
  const w = window as unknown as Record<string, unknown>;
  w.__f14stat = () => {
    const ms = [...F14_MOB_STAT.ms].sort((a, b) => a - b);
    const q = (k: number) =>
      +(ms[Math.min(ms.length - 1, Math.floor(ms.length * k))] ?? 0).toFixed(2);
    return {
      n: F14_MOB_STAT.n,
      warm: F14_MOB_STAT.warm,
      held: F14_MOB_STAT.held,
      p50: q(0.5),
      p90: q(0.9),
      max: +F14_MOB_STAT.max.toFixed(2),
      maxKey: F14_MOB_STAT.maxKey,
      sizes: F14_MOB_STAT.sizes(),
      mb: +((F14_MOB_STAT.px * 4) / 1048576).toFixed(1),
      litShare: +(F14_MOB_STAT.lit / Math.max(1, F14_MOB_STAT.built)).toFixed(2),
      kbPerFrame: +((F14_MOB_STAT.px * 4) / 1024 / Math.max(1, F14_MOB_STAT.built)).toFixed(1),
      battle: [...F14_MOB_STAT.battle.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16),
      wcost: [...F14_MOB_STAT.wms.entries()].map(([k, w]) => {
        const s = [...w].sort((a, b) => a - b);
        const p = (x: number) =>
          +(s[Math.min(s.length - 1, Math.floor(s.length * x))] ?? 0).toFixed(2);
        return `${k} n${s.length} p50 ${p(0.5)} p90 ${p(0.9)} max ${p(1)}`;
      }),
    };
  };
  w.__f14mob = F14_MOB_STAT;
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

/**
 * Слой света стоит своего вывода (второй `drawImage` на кадр экрана), только
 * если в нём больше `LIT_MIN` заметных точек: глаз движок рисует и так.
 */
const LIT_MIN = 10;
function litWorth(p: Px | null): boolean {
  if (!p) return false;
  const d = p.data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] >= 40 && ++n > LIT_MIN) return true;
  return false;
}

function finish(pic: Pic): MobFrame {
  const lit = litWorth(pic.lit) ? pic.lit : null;
  const bb = bbox(pic.p, lit);
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
    img: cropCanvas(pic.p, x0, y0, w, h),
    ax: pic.ax - x0,
    ay: pic.ay - y0,
    eye: pic.eye ? [pic.eye[0] - x0, pic.eye[1] - y0] : null,
    lit: lit ? cropCanvas(lit, x0, y0, w, h) : null,
  };
}

const PALE = hx('#f4ece4');

/**
 * Облик из готового кадра: альбинос — бледная перекраска, элита — золотой
 * кант снаружи контура (холст шире на точку с каждой стороны), серый —
 * «замершее время» с лёгкой сепией (свет и глаз гаснут).
 */
function lookFrame(fr: MobFrame, look: MobPose['look'], gray: boolean): MobFrame {
  const src = fr.img as HTMLCanvasElement;
  const pad = look === 'elite' ? 1 : 0;
  const w = src.width + pad * 2;
  const h = src.height + pad * 2;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) return fr;
  g.drawImage(src, pad, pad);
  const im = g.getImageData(0, 0, w, h);
  const d = im.data;
  const solid = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] >= 200;
  if (look === 'albino' || gray)
    for (let i = 0; i < d.length; i += 4) {
      if (!d[i + 3]) continue;
      if (look === 'albino') {
        // Контур остаётся тёмным: бледный моб не теряет силуэт на тёмном полу.
        const l = (d[i] + d[i + 1] + d[i + 2]) / 3;
        const q = mixc([l, l, l, 255], PALE, l < 40 ? 0.12 : 0.45);
        d[i] = q[0];
        d[i + 1] = q[1];
        d[i + 2] = q[2];
      }
      if (gray) {
        const l = d[i] * 0.3 + d[i + 1] * 0.55 + d[i + 2] * 0.15;
        d[i] = Math.min(255, l * 1.0625);
        d[i + 1] = Math.min(255, l * 1.02);
        d[i + 2] = Math.min(255, l * 0.955);
      }
    }
  if (pad) {
    const ring: number[] = [];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (d[(y * w + x) * 4 + 3] >= 100) continue;
        if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))
          ring.push((y * w + x) * 4);
      }
    for (const i of ring) {
      d[i] = GOLDK[0];
      d[i + 1] = GOLDK[1];
      d[i + 2] = GOLDK[2];
      d[i + 3] = 255;
    }
  }
  g.putImageData(im, 0, 0);
  let lit: HTMLCanvasElement | null = null;
  if (fr.lit && !gray) {
    if (pad) {
      lit = document.createElement('canvas');
      lit.width = w;
      lit.height = h;
      lit.getContext('2d')?.drawImage(fr.lit as HTMLCanvasElement, pad, pad);
    } else lit = fr.lit as HTMLCanvasElement;
  }
  return {
    ...fr,
    img: c,
    ax: fr.ax + pad,
    ay: fr.ay + pad,
    eye: fr.eye && !gray ? [fr.eye[0] + pad, fr.eye[1] + pad] : null,
    lit,
  };
}

/**
 * Белая вспышка удара из готового кадра: кольцо из `FL_N` холстов; кадр,
 * что вспыхнул недавно, — из кольца как есть.
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
  }
  e.src = img;
  return c;
}

let cur: Vis | null = null;
let curFresh = false;
let budNow = -1;
let budSpent = 0;

/**
 * Кадр вида: поза `anim`, кадр `f`, сторона `d`; `gray` — замершее время.
 * Облик и серый — перекраской готового, вспышка — поверх. Сверх бюджета
 * знакомый моб держит прошлый кадр (лист кадров рисует новым мобом — там
 * бюджет не срабатывает). Кадр из кеша не менять — копировать (`{...fr}`).
 */
export function frameOf(
  K: Kind,
  anim: string,
  f: number,
  d: number,
  pose: MobPose,
  build: () => Pic,
  gray = false,
): MobFrame {
  const key = `${anim}|${f}|${d}`;
  const v = cur;
  cur = null;
  const live = !F14_MOB_STAT.warming;
  let fr = K.frames.get(key);
  if (!fr && live) miss(K, anim, f, d);
  if (!fr && live && v && !curFresh && v.last && v.lastK === K) {
    const now = pose.now || 0;
    if (now !== budNow) {
      budNow = now;
      budSpent = 0;
    }
    if (budSpent >= F14_MOB_STAT.budget) {
      F14_MOB_STAT.held++;
      return pose.flash ? { ...v.last, img: flashImg(v.last.img as HTMLCanvasElement) } : v.last;
    }
  }
  if (!fr) {
    const t0 = performance.now();
    fr = K.frames.set(key, finish(build()));
    const ms = performance.now() - t0;
    stat(ms, K, key);
    if (live) budSpent += ms;
    F14_MOB_STAT.built++;
    if (fr.lit) F14_MOB_STAT.lit++;
    const px = fr.img.width * fr.img.height * (fr.lit ? 2 : 1);
    F14_MOB_STAT.px += px;
    K.px += px;
  }
  if (pose.look !== 'normal' || gray) {
    const lk = `${key}|${pose.look}|${gray ? 1 : 0}`;
    let lf = K.looks.get(lk);
    if (!lf) {
      const t0 = performance.now();
      lf = K.looks.set(lk, lookFrame(fr, pose.look, gray));
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

/**
 * Прогрев: кадры поз во всех 8 сторонах, по одному на шаг генератора.
 * `dirs` — свой список сторон позы (статуя Завода смотрит только на юг).
 */
export function* warmAll(
  K: Kind,
  list: [string, number, number[]?][],
  pic: (a: string, f: number, d: number) => Pic,
) {
  for (const [anim, n, dirs] of list)
    for (const d of dirs ?? [0, 1, 2, 3, 4, 5, 6, 7])
      for (let f = 0; f < n; f++) {
        F14_MOB_STAT.warming = true;
        try {
          frameOf(K, anim, f, d, WARM_POSE, () => pic(anim, f, d));
        } finally {
          F14_MOB_STAT.warming = false;
        }
        yield 0;
      }
}

/** Прогрев серого (замершее время) для готовых кадров: поза, номера кадров, стороны. */
export function* warmGray(K: Kind, list: [string, number[], number[]?][]) {
  for (const [anim, fs, dirs] of list)
    for (const d of dirs ?? [0, 1, 2, 3, 4, 5, 6, 7])
      for (const f of fs) {
        const fr = K.frames.get(`${anim}|${f}|${d}`);
        const lk = `${anim}|${f}|${d}|normal|1`;
        if (fr && !K.looks.get(lk)) K.looks.set(lk, lookFrame(fr, 'normal', true));
        yield 0;
      }
}

// ---------------------------------------------------------------------------
// Прогрев этажа — одна очередь на все виды. Движок греет виды по одному, в
// порядке `sim.mobs`, и только тех, кто уже в мире: вид, пришедший, пока
// греется другой (песочный призрак и отмотчик у часов, пока греется жнец),
// строил кадры в бою — его прогрев начинался поздно. Здесь живой промах
// `frameOf` — спрос на всю серию (поза, сторона): её греем первой, со
// следующего шага прогрева; вид, нарисованный вживую, сразу встаёт в общую
// очередь — его прогрев идёт, кого бы ни грел сейчас движок.
// ---------------------------------------------------------------------------

export type WarmList = [string, number, number[]?][];
type PicFn = (a: string, f: number, d: number) => Pic;
/** Серия позы для спроса: сколько кадров и чем рисовать (нет — не греем). */
type Dem = (anim: string) => [number, PicFn] | null;
interface WJob {
  gen: () => Iterator<unknown>;
  it: Iterator<unknown> | null;
  done: boolean;
}
const JOBS = new Map<Kind, WJob>();
const DEMS = new Map<Kind, Dem>();
const WANT: WJob[] = [];
const DEMAND: [Kind, string, number, number][] = [];
const DKEY = new Set<string>();

function want(j: WJob, restart: boolean): void {
  if (!restart && j.done) return;
  if (!j.it) {
    j.it = j.gen();
    j.done = false;
  }
  if (!WANT.includes(j)) WANT.push(j);
}

function miss(K: Kind, anim: string, f: number, d: number): void {
  const j = JOBS.get(K);
  if (!j || !F14_MOB_STAT.sched) return;
  want(j, false);
  const k = `${K.name}|${anim}|${d}`;
  if (DKEY.has(k) || DEMAND.length >= 64 || !DEMS.get(K)?.(anim)) return;
  DKEY.add(k);
  DEMAND.push([K, anim, f, d]);
}

function* drain() {
  for (;;) {
    const q = DEMAND.shift();
    if (q) {
      const [K, anim, f0, d] = q;
      DKEY.delete(`${K.name}|${anim}|${d}`);
      const s = DEMS.get(K)?.(anim);
      if (s)
        for (let i = 1; i <= s[0]; i++) {
          const f = (f0 + i) % s[0];
          if (K.frames.get(`${anim}|${f}|${d}`)) continue;
          F14_MOB_STAT.warming = true;
          try {
            frameOf(K, anim, f, d, WARM_POSE, () => s[1](anim, f, d));
          } finally {
            F14_MOB_STAT.warming = false;
          }
          yield 0;
        }
      continue;
    }
    const j = WANT[0];
    if (!j) return;
    if (!j.it || j.it.next().done) {
      j.it = null;
      j.done = true;
      WANT.shift();
    }
    yield 0;
  }
}

/** Спрос из списка прогрева вида. */
export const demOf =
  (list: WarmList, pic: PicFn): Dem =>
  (anim) => {
    const e = list.find((q) => q[0] === anim);
    return e ? [e[1], pic] : null;
  };

/**
 * Прогрев вида через общую очередь этажа: `gen` — его генератор (как для
 * `registerMobWarm`), `kinds` — виды, что он греет, и их спрос.
 */
export function regWarm(paintId: string, gen: () => Iterator<unknown>, kinds: [Kind, Dem][]) {
  const j: WJob = { gen, it: null, done: false };
  for (const [K, dem] of kinds) {
    JOBS.set(K, j);
    DEMS.set(K, dem);
  }
  registerMobWarm(paintId, function* () {
    want(j, true);
    yield* drain();
  });
}

// ---------------------------------------------------------------------------
// 2D поверх рига: звёзды оглушения, шестерёнки, искры.
// ---------------------------------------------------------------------------

const STAR_A = hx('#fff27a');
const STAR_B = hx('#ffffff');

/** Звёздочки по кругу над головой (`ph` 0…1 — фаза кружения). */
export function stars(o: RigOut, cx: number, cy: number, rx: number, ph: number, n = 3): void {
  for (let i = 0; i < n; i++) {
    const a = ph * TAU + (i / n) * TAU;
    const x = Math.round(cx + Math.cos(a) * rx);
    const y = Math.round(cy + Math.sin(a) * rx * 0.35);
    const front = Math.sin(a) > -0.2;
    spark2(o, x, y, STAR_B, front ? 0.9 : 0.4);
    if (front) {
      spark2(o, x - 1, y, STAR_A, 0.5);
      spark2(o, x + 1, y, STAR_A, 0.5);
    }
  }
}

/** Свет экрана для 2D-фаски (сверху-слева). */
const LX = -0.45;
const LY = -0.72;

/**
 * Плоская шестерёнка в 2D (разлёт деталей, пружины): диск с зубьями,
 * ступица; `rot` — поворот; фаска светлая сверху-слева.
 */
export function cog2(
  p: Px,
  cx: number,
  cy: number,
  r: number,
  teeth: number,
  rot: number,
  t: Tones,
): void {
  const tooth = Math.max(1, r * 0.28);
  const body = r - tooth;
  const hole = Math.max(0.6, r * 0.22);
  for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++)
    for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const dd = Math.hypot(dx, dy);
      if (dd > r || dd < hole) continue;
      const a = Math.atan2(dy, dx) - rot;
      const fr = ((((a / TAU) * teeth) % 1) + 1) % 1;
      if (dd > body && (fr < 0.25 || fr > 0.75)) continue;
      const lit = -((dx / (dd || 1)) * LX + (dy / (dd || 1)) * LY);
      const l = dd > body - 0.8 ? 0.5 - lit * 0.8 : 0.55;
      p.set(x, y, l > 0.78 ? t[3] : l > 0.42 ? t[2] : l > 0.1 ? t[1] : t[0]);
    }
}

// ---------------------------------------------------------------------------
// Позы ключами: смешение полей (числа и векторы) и дорожка ключевых поз.
// ---------------------------------------------------------------------------

/** Смесь двух поз: числа и векторы — линейно. */
export function mixPose<T extends object>(a: T, b: T, k: number): T {
  const A = a as Record<string, unknown>;
  const Bv = b as Record<string, unknown>;
  const o: Record<string, unknown> = { ...A };
  for (const key of Object.keys(A)) {
    const x = A[key];
    const y = Bv[key];
    if (typeof x === 'number') o[key] = lerp(x, y as number, k);
    else if (Array.isArray(x))
      o[key] = x.map((v: number, i: number) => lerp(v, (y as number[])[i], k));
  }
  return o as T;
}

export type KeyPose<T> = [number, Partial<T>, Ease?];

/** Ключевые позы по времени поверх `base` (кривая — у ключа, к которому идём). */
export function keyPose<T extends object>(T: number, keys: KeyPose<T>[], base: T): T {
  const full = (p: Partial<T>): T => ({ ...base, ...p });
  if (T <= keys[0][0]) return full(keys[0][1]);
  for (let i = 1; i < keys.length; i++) {
    const [t1, p1, e] = keys[i];
    if (T <= t1) {
      const [t0, p0] = keys[i - 1];
      const x = (T - t0) / (t1 - t0 || 1);
      return mixPose(full(p0), full(p1), (e ?? smooth)(clamp01(x)));
    }
  }
  return full(keys[keys.length - 1][1]);
}
