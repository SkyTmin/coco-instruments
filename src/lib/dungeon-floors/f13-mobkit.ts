// Этаж 13 «Театр марионеток» — общий набор рисунка мобов (анимации мобов 13).
//
// Куклы этажа собираются тем же мини-3D ригом, что и Кукловод с исполином
// (`Rig`, `humanoid`, `renderRig` из `f13-art.ts`) — риг только импортируем:
// босс и исполин обязаны остаться прежними до пикселя. Всё остальное у мобов
// своё: позы-ключи, треки 24 к/с, походка, удар героя, кеш, вспышка, облик.
//
// Кукла смотрит туда, куда идёт (курс с пределом поворота) — боком не ходит;
// шаг — по пройденному пути, техника — 24 к/с от времени режима (стоп-кадр
// мозга держит позу сам), кадр контакта — там, где бьёт мозг
// (`f13-brains.ts`: удар ближнего боя — первый кадр `recover`). 8 честных
// сторон (риг объёмный, кукла несимметрична — меч справа, щит слева).
//
// Кадр строится раз на позу и сторону и живёт в кеше с вытеснением (у вида
// свой предел). Холст обрезается до рисунка, якорь и `lit` сдвигаются следом.
// Облик (элита, альбинос) — перекраска готового кадра в своём кеше; вспышка
// удара героя — белая копия из кольца холстов (в ключ не входит). Состояние
// рисунка — курс, путь, прошлый режим, миг удара героя — в `WeakMap` по мобу:
// в `m.data` рисунок не пишет. Новых кадров за кадр рендера — не дороже
// `F13_MOB_STAT.budget`: сверх него знакомый моб держит прошлый кадр.

import { Px } from '../dungeon-art';
import { frameLRU } from '../dungeon-paint';
import type { FrameLRU, MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import {
  INK,
  P,
  Rig,
  TAU,
  clamp01,
  hash,
  humanoid,
  hx,
  limb,
  mixc,
  pose0,
  renderRig,
  rigProj,
  withA,
} from './f13-art';
import type { Body, Joints, Limb, Pose, RGBA, RigOut, V3 } from './f13-art';

export { clamp01, hash, TAU };

export const PI = Math.PI;
export const FPS = 24;
export const NDIR = 8;

// ---------------------------------------------------------------------------
// Числа и кривые.
// ---------------------------------------------------------------------------

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
export type Ease = (k: number) => number;
export const smooth: Ease = (k) => {
  const x = clamp01(k);
  return x * x * (3 - 2 * x);
};
export const sstep = (a: number, b: number, x: number) => smooth((x - a) / (b - a));
export const lin: Ease = (k) => clamp01(k);
export const easeOut: Ease = (k) => 1 - (1 - clamp01(k)) ** 3;
export const easeIn: Ease = (k) => clamp01(k) ** 2;
export const easeIn3: Ease = (k) => clamp01(k) ** 3;
/** С перелётом: проводка, рывок нити, возврат с отскоком. */
export const eBack: Ease = (k) => {
  const x = clamp01(k) - 1;
  return 1 + 2.4 * x * x * x + 1.4 * x * x;
};
export const angD = (a: number, b: number) => {
  let d = (a - b) % TAU;
  if (d > PI) d -= TAU;
  if (d < -PI) d += TAU;
  return d;
};
/** Номер кадра техники: 24 к/с от времени режима, не дальше `max`. */
export const fi = (t: number, max: number) =>
  Math.max(0, Math.min(max, Math.floor((t || 0) * FPS + 1e-6)));
/** Время кадра техники (середина не нужна: ключи считаются от начала кадра). */
export const tf = (f: number) => f / FPS;

// ---------------------------------------------------------------------------
// Позы: ключи, смесь, добавка, трек.
// ---------------------------------------------------------------------------

type PoseRec = Record<string, number | Limb | undefined>;
const mixLimb = (a: Limb, b: Limb, k: number): Limb => ({
  sw: a.sw + (b.sw - a.sw) * k,
  out: a.out + (b.out - a.out) * k,
  bend: a.bend + (b.bend - a.bend) * k,
});
/** Конечность от базовой со сдвигом. */
export const dl = (b: Limb, sw: number, out = 0, bend = 0): Limb =>
  limb(b.sw + sw, b.out + out, b.bend + bend);

/** Смесь поз: числа и конечности (k вне 0…1 — перелёт). */
export function mixP<T extends Pose>(a: T, b: T, k: number): T {
  if (k === 0) return a;
  if (k === 1) return b;
  const A = a as unknown as PoseRec;
  const B = b as unknown as PoseRec;
  const o: PoseRec = { ...A };
  for (const key in B) {
    const vb = B[key];
    if (vb === undefined) continue;
    // Нет поля (носок `toe`, свои числа вида) — от нуля, а не скачком.
    const va = A[key] ?? (typeof vb === 'number' ? 0 : vb);
    o[key] =
      typeof vb === 'number'
        ? (va as number) + (vb - (va as number)) * k
        : mixLimb(va as Limb, vb, k);
  }
  return o as unknown as T;
}

/** Поза с правкой: копия `b` и поля `o`. */
export const withP = <T extends Pose>(b: T, o: Partial<T>): T => ({ ...b, ...o });

export type PKey<T> = readonly [number, T, Ease?];
/** Поза на треке в момент t; кривая — у ключа, к которому идём. */
export function track<T extends Pose>(t: number, keys: readonly PKey<T>[]): T {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const k1 = keys[i];
    if (t < k1[0]) {
      const k0 = keys[i - 1];
      return mixP(k0[1], k1[1], (k1[2] ?? smooth)((t - k0[0]) / (k1[0] - k0[0])));
    }
  }
  return keys[keys.length - 1][1];
}

// ---------------------------------------------------------------------------
// Общие позы кукол (свои копии: позы босса и исполина не трогаем).
// ---------------------------------------------------------------------------

/** Шаг марионетки: ноги болтаются, тело подбрасывает нитью. `ph` — фаза шага. */
export function gaitP(ph: number, k = 1): Pose {
  const q = pose0();
  const s = Math.sin(ph);
  const c = Math.cos(ph);
  q.bob = Math.abs(s) * 1.6 * k;
  q.lean = 0.12 * k;
  q.lL = limb(0.65 * s * k, 0.06, 0.25 + 0.55 * Math.max(0, -c) * k);
  q.lR = limb(-0.65 * s * k, 0.06, 0.25 + 0.55 * Math.max(0, c) * k);
  q.aL = limb(-0.5 * s * k, 0.18, 0.35 + 0.2 * Math.max(0, s));
  q.aR = limb(0.5 * s * k, 0.18, 0.35 + 0.2 * Math.max(0, -s));
  q.hr = 0.08 * s * k;
  q.side = 0.05 * s * k;
  return q;
}

/** Покой на нитях: покачивается, ноги едва касаются пола. */
export function dangleP(ph: number): Pose {
  const q = pose0();
  const s = Math.sin(ph);
  q.bob = 1 + 0.6 * s;
  q.side = 0.04 * s;
  q.hr = 0.07 * Math.sin(ph * 0.5);
  q.hp = 0.08;
  q.aL = limb(0.05 * s, 0.16, 0.25);
  q.aR = limb(-0.05 * s, 0.16, 0.25);
  q.lL = limb(0.06 * s, 0.04, 0.12);
  q.lR = limb(-0.06 * s, 0.04, 0.12);
  return q;
}

/** Нити отпустили: кукла обвисла (сон, ожидание). */
export function slumpP(k: number): Pose {
  const q = pose0();
  q.sink = 3 * k;
  q.lean = 0.5 * k;
  q.hp = 0.7 * k;
  q.hr = 0.25 * k;
  q.aL = limb(0.15 * k, 0.1, 0.1);
  q.aR = limb(0.05, 0.12, 0.1);
  q.lL = limb(0.5 * k, 0.12, 0.9 * k);
  q.lR = limb(0.4 * k, 0.1, 0.9 * k);
  return q;
}

/** Срезали нить: кукла шатается, руки вразлёт (t — с начала, до 0,6 с). */
export function reelP(t: number): Pose {
  const q = pose0();
  const k = Math.sin(clamp01(t / 0.6) * PI);
  q.lean = -0.35 * k;
  q.side = 0.3 * Math.sin(t * 18) * k;
  q.hp = -0.4 * k;
  q.hr = 0.3 * Math.sin(t * 13);
  q.aL = limb(0.6 * k, 0.9 * k + 0.1, 0.2);
  q.aR = limb(0.5 * k, 1.1 * k + 0.1, 0.3);
  q.lL = limb(0.3 * k, 0.15, 0.3);
  q.lR = limb(-0.2 * k, 0.1, 0.1);
  q.bob = 2 * k;
  return q;
}

/** Без нитей — ползёт на руках, ноги волочатся. */
export function crawlP(ph: number): Pose {
  const q = pose0();
  const s = Math.sin(ph);
  q.sink = 7;
  q.lean = 1.25;
  q.hp = -0.9;
  q.aL = limb(1.4 + 0.5 * s, 0.25, -0.3);
  q.aR = limb(1.4 - 0.5 * s, 0.25, -0.3);
  q.lL = limb(-1.2, 0.15, 0.1);
  q.lR = limb(-1.15, 0.2, 0.2);
  q.side = 0.08 * s;
  return q;
}

/** Ищет героя в темноте: голова крутится, руки вперёд ощупью. */
export function gropeP(ph: number): Pose {
  const q = dangleP(ph);
  q.hy = 0.9 * Math.sin(ph * 0.7);
  q.aL = limb(1.0 + 0.2 * Math.sin(ph), 0.2, 0.2);
  q.aR = limb(0.9 - 0.2 * Math.sin(ph), 0.2, 0.2);
  return q;
}

/** Голова кругом (после промаха, удара о стену): t — фаза качания. */
export function dizzyP(t: number): Pose {
  const q = pose0();
  q.side = 0.25 * Math.sin(t * 7);
  q.lean = 0.15 * Math.cos(t * 7);
  q.hr = 0.4 * Math.sin(t * 9);
  q.hy = 0.5 * Math.cos(t * 9);
  q.aL = limb(0.3, 0.9, 0.3);
  q.aR = limb(0.2, 1.0, 0.4);
  q.lL = limb(0.2 * Math.sin(t * 7), 0.15, 0.3);
  q.lR = limb(-0.2 * Math.sin(t * 7), 0.15, 0.3);
  return q;
}

/**
 * Удар героя по кукле — нити дёргают её прочь: корпус запрокинут, руки
 * вразлёт, тело подброшено; потом обвисает и нити снова натягиваются.
 * Добавка к позе `base` (k — время реакции 0…1).
 */
export function hurtP(base: Pose, t: number): Pose {
  const keys: PKey<Pose>[] = [
    [0, base],
    [
      0.05,
      withP(base, {
        lean: base.lean - 0.5,
        hp: base.hp - 0.55,
        side: base.side + 0.18,
        bob: base.bob + 2.2,
        aL: dl(base.aL, 0.7, 0.8, -0.1),
        aR: dl(base.aR, 0.6, 0.7, -0.1),
        lL: dl(base.lL, 0.35, 0.1, 0.3),
        lR: dl(base.lR, -0.2, 0.05, 0.2),
        toe: 0.55,
      }),
      easeOut,
    ],
    [
      0.14,
      withP(base, {
        lean: base.lean - 0.3,
        hp: base.hp - 0.2,
        side: base.side - 0.08,
        bob: base.bob + 1.4,
        aL: dl(base.aL, 0.35, 0.45),
        aR: dl(base.aR, 0.3, 0.4),
        lL: dl(base.lL, 0.2, 0, 0.2),
        toe: 0.4,
      }),
    ],
    [0.3, base, eBack],
  ];
  return track(t, keys);
}

// ---------------------------------------------------------------------------
// Ход моба для рисунка: курс, путь, прошлый режим, удар героя.
// ---------------------------------------------------------------------------

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
  /** Прошлый кадр (бюджет новых кадров). */
  last: MobFrame | null;
  lastK: Kind | null;
}
const VIS = new WeakMap<Mob, Vis>();
let cur: Vis | null = null;
let curFresh = false;

/**
 * Прошлый режим для листа кадров: стенд рисует каждый кадр новым мобом и
 * передаёт его номером в `m.data.vSheetPrev` (в игре его помнит `Vis`).
 */
const SHEET_PREV = ['', 'windup', 'aim', 'f13_plie', 'f13_spin', 'f13_dive', 'f13_pop', 'stun'];

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

/** Ход моба: курс с пределом поворота `turn` (рад/с) к `want`, путь, прошлый режим, удар. */
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
 * Удар героя поверх любой позы — полями кадра: отброс по отдаче, вжатие,
 * наклон прочь от героя, возврат (0,25 с). `A` — размах, пиксели.
 */
export function hurtFx(v: Vis, now: number, A: number, ex: Partial<MobFrame>): void {
  const age = now - v.hit;
  if (age < 0 || age >= 0.25) return;
  const out = age < 0.05 ? easeOut(age / 0.05) : 1 - sstep(0.05, 0.25, age);
  const sq = age < 0.1 ? 1 - age / 0.1 : 0;
  ex.dx = (ex.dx ?? 0) + v.kx * A * out;
  ex.dy = (ex.dy ?? 0) + v.ky * A * out * 0.6;
  ex.sx = (ex.sx ?? 1) * (1 + 0.1 * sq);
  ex.sy = (ex.sy ?? 1) * (1 - 0.09 * sq);
  ex.rot = (ex.rot ?? 0) + v.kx * 0.1 * out;
}
/** Сколько прошло после удара героя, с; давно — большое. */
export const hurtAge = (v: Vis, now: number) => now - v.hit;

/** Сторона рига 0…7 по курсу; угол стороны — для `renderRig`. */
export const dirN = (a: number) => ((Math.round((a / TAU) * NDIR) % NDIR) + NDIR) % NDIR;
export const yawN = (d: number) => (d / NDIR) * TAU;

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
  limit: number;
  frames: FrameLRU<MobFrame>;
  /** Облики (элита, альбинос) — свой кеш, чтобы не вытеснять прогретое. */
  looks: FrameLRU<MobFrame>;
}

const KINDS: Kind[] = [];
export function kindOf(name: string, w: number, h: number, ax: number, ay: number, limit: number) {
  const K: Kind = {
    name,
    w,
    h,
    ax,
    ay,
    limit,
    frames: frameLRU<MobFrame>(limit),
    looks: frameLRU<MobFrame>(Math.ceil(limit * 0.35)),
  };
  KINDS.push(K);
  return K;
}

/**
 * Замер для стенда: цена нового кадра (мс), сколько нарисовал прогрев, какие
 * кадры строились в бою (по ключу без номера кадра) — урок 2; `held` — сколько
 * раз моб держал прошлый кадр из-за бюджета.
 */
export const F13_MOB_STAT = {
  n: 0,
  warm: 0,
  ms: [] as number[],
  max: 0,
  maxKey: '',
  battle: new Map<string, number>(),
  budget: 0.5,
  held: 0,
  px: 0,
  built: 0,
  lit: 0,
  warming: false,
  clear: () => {
    for (const K of KINDS) {
      K.frames.clear();
      K.looks.clear();
    }
  },
  reset: () => {
    F13_MOB_STAT.n = 0;
    F13_MOB_STAT.ms = [];
    F13_MOB_STAT.max = 0;
    F13_MOB_STAT.maxKey = '';
    F13_MOB_STAT.held = 0;
    F13_MOB_STAT.battle.clear();
  },
  sizes: () => KINDS.map((K) => `${K.name} ${K.frames.size}/${K.limit}+${K.looks.size}`).join(', '),
};
function stat(ms: number, K: Kind, key: string): void {
  if (F13_MOB_STAT.warming) {
    F13_MOB_STAT.warm++;
    return;
  }
  F13_MOB_STAT.n++;
  if (F13_MOB_STAT.ms.length < 4000) F13_MOB_STAT.ms.push(ms);
  if (ms > F13_MOB_STAT.max) {
    F13_MOB_STAT.max = ms;
    F13_MOB_STAT.maxKey = `${K.name}|${key}`;
  }
  const k = `${K.name}|${key
    .split('|')
    .filter((_, i) => i !== 1)
    .join('|')}`;
  F13_MOB_STAT.battle.set(k, (F13_MOB_STAT.battle.get(k) ?? 0) + 1);
}
if (import.meta.env?.DEV && typeof window !== 'undefined') {
  (window as unknown as { __f13stat: () => unknown }).__f13stat = () => {
    const ms = [...F13_MOB_STAT.ms].sort((a, b) => a - b);
    const q = (k: number) =>
      +(ms[Math.min(ms.length - 1, Math.floor(ms.length * k))] ?? 0).toFixed(2);
    return {
      n: F13_MOB_STAT.n,
      warm: F13_MOB_STAT.warm,
      held: F13_MOB_STAT.held,
      p50: q(0.5),
      p90: q(0.9),
      max: +F13_MOB_STAT.max.toFixed(2),
      maxKey: F13_MOB_STAT.maxKey,
      sizes: F13_MOB_STAT.sizes(),
      litShare: +(F13_MOB_STAT.lit / Math.max(1, F13_MOB_STAT.built)).toFixed(2),
      kbPerFrame: +((F13_MOB_STAT.px * 4) / 1024 / Math.max(1, F13_MOB_STAT.built)).toFixed(1),
      battle: [...F13_MOB_STAT.battle.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14),
    };
  };
  (window as unknown as { __f13mob: typeof F13_MOB_STAT }).__f13mob = F13_MOB_STAT;
}

/** Экранная точка рига: модель → [x, y] на холсте вида. */
export type Proj2 = (v: V3) => [number, number];
export const projOf = (K: Kind, yaw: number): Proj2 => {
  const pr = rigProj(yaw, 1, K.ax, K.ay);
  return (v) => {
    const q = pr(v);
    return [q[0], q[1]];
  };
};

/** Риг → картинка вида; `post` дорисовывает в 2D (след, искры, пыль). */
export function draw(
  K: Kind,
  r: Rig,
  yaw: number,
  post?: (o: RigOut, P: Proj2, lit: () => Px) => void,
): Pic {
  const o = renderRig(r, yaw, K.w, K.h, K.ax, K.ay);
  if (post) post(o, projOf(K, yaw), () => (o.lit ??= new Px(K.w, K.h)));
  return { p: o.px, lit: o.lit, ax: K.ax, ay: K.ay, eye: o.eye };
}

/** Суставы позы без рисунка (для следа: где было оружие кадр назад). */
export function jointsOf(b: Body, q: Pose): Joints {
  return humanoid(new Rig(), b, q);
}

/**
 * Стоит ли слой света своего вывода: слой — второй `drawImage` на кадр
 * экрана; пары точек глаз он не окупает (глаз движок рисует по `eye`).
 */
const LIT_MIN = 10;
function litWorth(p: Px | null): boolean {
  if (!p) return false;
  const d = p.data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] >= 40 && ++n > LIT_MIN) return true;
  return false;
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

function cropPx(p: Px, x0: number, y0: number, w: number, h: number): Px {
  const o = new Px(w, h);
  for (let y = 0; y < h; y++) {
    const s = ((y0 + y) * p.w + x0) * 4;
    o.data.set(p.data.subarray(s, s + w * 4), y * w * 4);
  }
  return o;
}

/** Обрезанные точки кадра (для облика из готового кадра). */
const PXOF = new WeakMap<HTMLCanvasElement, Px>();

function finish(pic: Pic): MobFrame {
  const lit = pic.lit && litWorth(pic.lit) ? pic.lit : null;
  const bb = bbox(pic.p, lit);
  if (!bb) {
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 1;
    return { img: c, ax: 0, ay: 0, eye: null, lit: null, still: true };
  }
  const [x0, y0, x1, y1] = bb;
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const p = cropPx(pic.p, x0, y0, w, h);
  const img = p.canvas();
  PXOF.set(img, p);
  return {
    img,
    ax: pic.ax - x0,
    ay: pic.ay - y0,
    eye: pic.eye ? [pic.eye[0] - x0, pic.eye[1] - y0] : null,
    lit: lit ? cropPx(lit, x0, y0, w, h).canvas() : null,
    still: true,
  };
}

/**
 * Облик из готового кадра: тело (всё, кроме контура тушью) подмешивает
 * золото элиты или белое альбиноса — как прежний `renderRig` с `tint` 0,22.
 */
const ELITE_C = P.gold[2];
const ALBINO_C = hx('#ffffff');
function lookOf(fr: MobFrame, look: MobPose['look']): MobFrame {
  const src = PXOF.get(fr.img);
  if (!src) return fr;
  const c = look === 'elite' ? ELITE_C : ALBINO_C;
  const q = new Px(src.w, src.h);
  const s = src.data;
  const d = q.data;
  for (let i = 0; i < s.length; i += 4) {
    const a = s[i + 3];
    if (!a) continue;
    const ink = s[i] === INK[0] && s[i + 1] === INK[1] && s[i + 2] === INK[2];
    d[i] = ink ? s[i] : s[i] + (c[0] - s[i]) * 0.22;
    d[i + 1] = ink ? s[i + 1] : s[i + 1] + (c[1] - s[i + 1]) * 0.22;
    d[i + 2] = ink ? s[i + 2] : s[i + 2] + (c[2] - s[i + 2]) * 0.22;
    d[i + 3] = a;
  }
  return { ...fr, img: q.canvas() };
}

/**
 * Белая копия холста — вспышка удара героя (0,1–0,15 с). Кольцо заранее
 * заведённых холстов: кадр, что вспыхнул недавно, берётся как есть.
 */
const FL_N = 64;
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
 * Кадр вида: поза `anim`, кадр `f`, сторона `d`. Новых кадров за кадр
 * рендера — не дороже `F13_MOB_STAT.budget`: сверх него знакомый моб (не
 * первый показ, тот же вид) держит прошлый кадр. Лист кадров зовёт
 * рисовальщик с новым мобом на каждый кадр — там бюджет не срабатывает.
 */
export function frameOf(
  K: Kind,
  anim: string,
  f: number,
  d: number,
  pose: MobPose,
  build: () => Pic,
): MobFrame {
  const key = `${anim}|${f}|${d}`;
  const v = cur;
  cur = null;
  const live = !F13_MOB_STAT.warming;
  let fr = K.frames.get(key);
  if (!fr && live) {
    const now = pose.now || 0;
    if (now !== budNow) {
      budNow = now;
      budSpent = 0;
    }
    if (budSpent >= F13_MOB_STAT.budget && v && !curFresh && v.last && v.lastK === K) {
      F13_MOB_STAT.held++;
      return pose.flash ? { ...v.last, img: flashImg(v.last.img) } : v.last;
    }
  }
  if (!fr) {
    const t0 = performance.now();
    fr = K.frames.set(key, finish(build()));
    const ms = performance.now() - t0;
    stat(ms, K, `${key}|normal`);
    if (live) budSpent += ms;
    F13_MOB_STAT.built++;
    if (fr.lit) F13_MOB_STAT.lit++;
    F13_MOB_STAT.px += fr.img.width * fr.img.height * (fr.lit ? 2 : 1);
  }
  if (pose.look !== 'normal') {
    const lk = `${key}|${pose.look}`;
    let lf = K.looks.get(lk);
    if (!lf) {
      const t0 = performance.now();
      lf = K.looks.set(lk, lookOf(fr, pose.look));
      stat(performance.now() - t0, K, lk);
    }
    fr = lf;
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
) {
  for (const [anim, n] of list)
    for (let d = 0; d < NDIR; d++)
      for (let f = 0; f < n; f++) {
        if (K.frames.get(`${anim}|${f}|${d}`)) continue;
        F13_MOB_STAT.warming = true;
        try {
          frameOf(K, anim, f, d, WARM_POSE, () => pic(anim, f, d));
        } finally {
          F13_MOB_STAT.warming = false;
        }
        yield 0;
      }
}

// ---------------------------------------------------------------------------
// 2D поверх рига: след оружия, искры, пыль.
// ---------------------------------------------------------------------------

/**
 * След взмаха: полосы между соседними положениями отрезка [внутренний край,
 * конец]. `segs[0]` — сейчас, дальше — в прошлое, слабее; кромка ярче.
 */
export function smearInto(
  p: Px,
  segs: [number, number, number, number][],
  col: RGBA,
  a0 = 0.7,
): void {
  if (segs.length < 2) return;
  const { w, h } = p;
  const A = new Float32Array(w * h);
  const tri = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    a: number,
  ) => {
    const ar = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0);
    if (Math.abs(ar) < 0.05) return;
    const s = ar > 0 ? 1 : -1;
    const bx0 = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
    const bx1 = Math.min(w - 1, Math.ceil(Math.max(x0, x1, x2)));
    const by0 = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
    const by1 = Math.min(h - 1, Math.ceil(Math.max(y0, y1, y2)));
    for (let y = by0; y <= by1; y++)
      for (let x = bx0; x <= bx1; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        if (((x1 - x0) * (py - y0) - (y1 - y0) * (px - x0)) * s < 0) continue;
        if (((x2 - x1) * (py - y1) - (y2 - y1) * (px - x1)) * s < 0) continue;
        if (((x0 - x2) * (py - y2) - (y0 - y2) * (px - x2)) * s < 0) continue;
        const i = y * w + x;
        if (A[i] < a) A[i] = a;
      }
  };
  const n = segs.length - 1;
  for (let i = 0; i < n; i++) {
    const [ax, ay, bx, by] = segs[i];
    const [cx, cy, dx, dy] = segs[i + 1];
    const a = a0 * (1 - i / n) ** 1.3 + 0.08;
    tri(ax, ay, bx, by, dx, dy, a);
    tri(ax, ay, dx, dy, cx, cy, a);
  }
  for (let i = 0; i < n; i++) {
    const [, , bx, by] = segs[i];
    const [, , dx, dy] = segs[i + 1];
    const k = Math.max(1, Math.ceil(Math.hypot(dx - bx, dy - by)));
    for (let s = 0; s <= k; s++) {
      const x = Math.floor(bx + ((dx - bx) * s) / k);
      const y = Math.floor(by + ((dy - by) * s) / k);
      if (x >= 0 && y >= 0 && x < w && y < h)
        A[y * w + x] = Math.max(A[y * w + x], Math.min(1, a0 + 0.25) - i * 0.12);
    }
  }
  for (let i = 0; i < A.length; i++)
    if (A[i] > 0) p.set(i % w, Math.floor(i / w), withA(col, A[i]));
}

/** Искра-крестик: середина и четыре луча. */
export function spark(p: Px, x: number, y: number, c: RGBA, k = 1): void {
  const xi = Math.round(x);
  const yi = Math.round(y);
  p.set(xi, yi, withA(c, k));
  if (k > 0.45) {
    const e = withA(c, k * 0.55);
    p.set(xi - 1, yi, e);
    p.set(xi + 1, yi, e);
    p.set(xi, yi - 1, e);
    p.set(xi, yi + 1, e);
  }
}

/**
 * Пыль и щепа у точки (x, y): `n` крупинок разлетаются веером вверх и
 * оседают; `k` — возраст 0…1, `seed` — свой разброс.
 */
export function puff(
  p: Px,
  x: number,
  y: number,
  k: number,
  seed: number,
  cols: readonly RGBA[],
  n = 7,
  R = 6,
): void {
  if (k <= 0 || k >= 1) return;
  for (let i = 0; i < n; i++) {
    const a = PI + (i / (n - 1)) * PI + (hash(seed, i) - 0.5) * 0.5;
    const r = R * (0.4 + 0.6 * hash(seed, i, 3)) * easeOut(k);
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r * 0.55 + 4 * k * k;
    const c = cols[i % cols.length];
    p.set(px, py, withA(c, 1 - k * k));
  }
}

/** Тон, ослабленный к тени (для щепы, пыли). */
export const dim = (c: RGBA, k: number): RGBA => mixc(c, INK, k);
