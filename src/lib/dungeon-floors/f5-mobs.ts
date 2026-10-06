// Этаж 5 «Лабиринт» — мобы в объёме (анимации мобов 5). Кролик-рогач,
// адская гончая, муравей-убийца, тень лабиринта и жаба-арканщица собраны из
// примитивов мини-3D (`f15-rig.ts` — образец массовых мобов) и смотрят в
// одну из 8 сторон — туда, куда идут: боком не ходят. Шаг — по пройденному
// пути, техника — 24 к/с от времени режима (стоп-кадр мозга держит позу
// сам), кадр контакта — ровно там, где бьёт мозг (`f5-brains.ts`). Облик
// прежний: палитры и пропорции рисованных спрайтов.
//
// Кадр строится раз на позу и сторону и живёт в кеше с вытеснением (у вида
// свой предел); вспышка удара, облик (элита, альбинос) и проявление из стены
// — перекраска готового кадра, риг заново не рисуется. Состояние рисунка —
// курс с пределом поворота, путь, прошлый режим, миг удара героя — в
// `WeakMap` по мобу: в `m.data` рисунок не пишет.

import { Px } from '../dungeon-art';
import {
  frameLRU,
  registerImpactPainter,
  registerMobPainter,
  registerMobWarm,
  registerZonePainter,
} from '../dungeon-paint';
import type { FrameLRU, MobFrame, MobPose } from '../dungeon-paint';
import type { Mob, Strike, Zone } from '../dungeon-sim';
import { CE, F3, Rig, SE, proj, renderRig } from './f15-rig';
import type { Mat, RGBA, RigOut, Tones, V3 } from './f15-rig';

const TAU = Math.PI * 2;
const PI = Math.PI;
const FPS = 24;

const hx = (h: string, a = 255): RGBA => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
  a,
];
const tn = (a: string, b: string, c: string, d: string): Tones => [hx(a), hx(b), hx(c), hx(d)];
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const mixc = (a: RGBA, b: RGBA, k: number): RGBA => [
  Math.round(a[0] + (b[0] - a[0]) * k),
  Math.round(a[1] + (b[1] - a[1]) * k),
  Math.round(a[2] + (b[2] - a[2]) * k),
  a[3],
];
const alpha = (c: RGBA, a: number): RGBA => [c[0], c[1], c[2], Math.round(clamp01(a) * 255)];
const smooth = (k: number) => {
  const x = clamp01(k);
  return x * x * (3 - 2 * x);
};
const sstep = (a: number, b: number, x: number) => smooth((x - a) / (b - a));
const easeOut = (k: number) => 1 - (1 - clamp01(k)) ** 3;
const easeIn = (k: number) => clamp01(k) ** 2;
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const vlerp = (a: V3, b: V3, k: number): V3 => [
  a[0] + (b[0] - a[0]) * k,
  a[1] + (b[1] - a[1]) * k,
  a[2] + (b[2] - a[2]) * k,
];
const vadd = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/** Детерминированный шум по числам (рисунок не трогает `sim.rng`). */
const hash = (a: number, b: number, c = 0) => {
  let h = (a * 374761393 + b * 668265263 + c * 1274126177) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** Номер кадра техники 24 к/с (не больше `max`). */
const fi = (t: number, max: number) => Math.min(max, Math.max(0, Math.floor(t * FPS)));
/** Доля техники длиной `T` в середине кадра `f`. */
const kf = (f: number, T: number) => clamp01((f + 0.5) / FPS / T);

type Ease = (x: number) => number;
type Key = [number, number, Ease?];
/** Дорожка ключей: время → значение; кривая — у ключа, к которому идём. */
function trk(k: number, keys: Key[]): number {
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

const INK = hx('#150f0b');
const WHITE = hx('#ffffff');
const GOLD = hx('#ffcc40');

// ---------------------------------------------------------------------------
// Стороны и ход: 8 сторон, курс с пределом поворота, путь для шага.
// ---------------------------------------------------------------------------

const NDIR = 8;
/** Игровой угол → курс рига: на экране морда смотрит точно туда же. */
const rigYaw = (a: number) => Math.atan2(Math.sin(a), SE * Math.cos(a));
const dirN = (a: number) => ((Math.round((a / TAU) * NDIR) % NDIR) + NDIR) % NDIR;
const yawN = (d: number) => rigYaw((d / NDIR) * TAU);
const angD = (a: number, b: number) => {
  let d = (a - b) % TAU;
  if (d > PI) d -= TAU;
  if (d < -PI) d += TAU;
  return d;
};

interface Vis {
  now: number;
  x: number;
  y: number;
  /** Курс рисунка, игровой угол (сглажен пределом поворота). */
  yaw: number;
  /** Пройденный путь, клетки. */
  dist: number;
  mode: string;
  prev: string;
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
const SHEET_PREV = ['', 'windup', 'charge', 'breath', 'slash2', 'aim', 'call'];

const speedOf = (m: Mob) => Math.hypot(m.vx ?? 0, m.vy ?? 0);
const moving = (m: Mob, thr = 0.4) => speedOf(m) > thr;
/** Курс по ходу: движется — по скорости, стоит — куда смотрит. */
const headOf = (m: Mob) => (moving(m) ? Math.atan2(m.vy, m.vx) : (m.face ?? 0));

function knockOf(v: Vis, m: Mob): void {
  const kx = m.kx ?? 0;
  const ky = m.ky ?? 0;
  const l = Math.hypot(kx, ky);
  const f = m.face ?? 0;
  v.kx = l > 0.01 ? kx / l : -Math.cos(f);
  v.ky = l > 0.01 ? ky / l : -Math.sin(f);
}

/** Ход моба для рисунка: курс с пределом поворота (рад/с), путь, прошлый режим, удар. */
function visOf(m: Mob, pose: MobPose, want: number, turn: number): Vis {
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
function hurtFx(v: Vis, now: number, A: number, ex: Partial<MobFrame>): void {
  const age = now - v.hit;
  if (age < 0 || age >= 0.25) return;
  const out = age < 0.05 ? easeOut(age / 0.05) : 1 - sstep(0.05, 0.25, age);
  const sq = age < 0.1 ? 1 - age / 0.1 : 0;
  ex.dx = (ex.dx ?? 0) + v.kx * A * out;
  ex.dy = (ex.dy ?? 0) + v.ky * A * out * 0.6;
  ex.sx = (ex.sx ?? 1) * (1 + 0.14 * sq);
  ex.sy = (ex.sy ?? 1) * (1 - 0.13 * sq);
  ex.rot = (ex.rot ?? 0) + v.kx * 0.14 * out;
}

/** Выход из стены: откуда лезет (к стене) — единичный вектор на экране. */
function wallDir(m: Mob): [number, number] {
  const wx = m.data?.wx;
  const wy = m.data?.wy;
  if (wx !== undefined && wy !== undefined) {
    const dx = wx + 0.5 - (m.x ?? 0);
    const dy = wy + 0.5 - (m.y ?? 0);
    const l = Math.hypot(dx, dy);
    if (l > 0.05) return [dx / l, dy / l];
  }
  const f = m.face ?? 0;
  return [-Math.cos(f), -Math.sin(f)];
}

// ---------------------------------------------------------------------------
// Кадр: риг → картинка → кеш; облик и вспышка — перекраской готового.
// ---------------------------------------------------------------------------

interface Pic {
  p: Px;
  lit: Px | null;
  ax: number;
  ay: number;
  eye: [number, number] | null;
}

interface Kind {
  w: number;
  h: number;
  ax: number;
  ay: number;
  pics: FrameLRU<Pic>;
  frames: FrameLRU<MobFrame>;
}

const KINDS: Kind[] = [];
const kindOf = (w: number, h: number, ax: number, ay: number, limit: number): Kind => {
  const K: Kind = {
    w,
    h,
    ax,
    ay,
    pics: frameLRU<Pic>(Math.round(limit * 0.7)),
    frames: frameLRU<MobFrame>(limit),
  };
  KINDS.push(K);
  return K;
};

/**
 * Замер для стенда: цена нового кадра (мс) — последние 4000; `clear` —
 * сбросить кеши всех видов (замер после прогрева JIT).
 */
export const F5_MOB_STAT = {
  n: 0,
  ms: [] as number[],
  max: 0,
  maxKey: '',
  clear: () => {
    for (const K of KINDS) {
      K.pics.clear();
      K.frames.clear();
    }
  },
};
function stat(ms: number, key: string): void {
  F5_MOB_STAT.n++;
  if (F5_MOB_STAT.ms.length < 4000) F5_MOB_STAT.ms.push(ms);
  if (ms > F5_MOB_STAT.max) {
    F5_MOB_STAT.max = ms;
    F5_MOB_STAT.maxKey = key;
  }
}

type Proj2 = (v: V3) => [number, number];
function draw(K: Kind, r: Rig, post?: (o: RigOut, P: Proj2) => void, inner = 2.2): Pic {
  const o = renderRig(r, K.w, K.h, K.ax, K.ay, { outline: INK, inner });
  if (post)
    post(o, (v) => {
      const q = proj(v, K.ax, K.ay);
      return [q[0], q[1]];
    });
  return { p: o.p, lit: o.lit, ax: K.ax, ay: K.ay, eye: o.eye };
}
const litOn = (o: RigOut): Px => (o.lit ??= new Px(o.p.w, o.p.h));

function copyPx(p: Px): Px {
  const q = new Px(p.w, p.h);
  q.data.set(p.data);
  return q;
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

/** Тьма, из которой проявляется моб (выход из стены, из норы): 0 — нет, 3 — почти чёрный. */
function darkOf(p: Px, lvl: number): Px {
  const k = (lvl / 4) * 0.9;
  const dk = hx('#0a0606');
  const q = new Px(p.w, p.h);
  for (let i = 0; i < p.data.length; i += 4) {
    if (!p.data[i + 3]) continue;
    q.data[i] = p.data[i] + (dk[0] - p.data[i]) * k;
    q.data[i + 1] = p.data[i + 1] + (dk[1] - p.data[i + 1]) * k;
    q.data[i + 2] = p.data[i + 2] + (dk[2] - p.data[i + 2]) * k;
    q.data[i + 3] = p.data[i + 3];
  }
  return q;
}

function finish(pic: Pic, look: MobPose['look'], flash: boolean, dark: number): MobFrame {
  let p = pic.p;
  if (dark > 0) p = darkOf(p, dark);
  if (look === 'albino') p = paleOf(p);
  if (look === 'elite') {
    if (p === pic.p) p = copyPx(p);
    goldEdge(p);
  }
  if (flash) p = p.tint(WHITE, 0.85);
  return {
    img: p.canvas(),
    ax: pic.ax,
    ay: pic.ay,
    eye: dark >= 2 ? null : pic.eye,
    lit: pic.lit && dark < 2 ? pic.lit.canvas() : null,
  };
}

/** Кадр вида: поза `anim`, кадр `f`, сторона `d`; `dark` — проявление. */
function frameOf(
  K: Kind,
  anim: string,
  f: number,
  d: number,
  pose: MobPose,
  build: () => Pic,
  dark = 0,
): MobFrame {
  const key = `${anim}|${f}|${d}`;
  const fk = `${key}|${pose.flash ? 1 : 0}|${pose.look}|${dark}`;
  let fr = K.frames.get(fk);
  if (fr) return fr;
  const t0 = performance.now();
  let pic = K.pics.get(key);
  if (!pic) pic = K.pics.set(key, build());
  fr = K.frames.set(fk, finish(pic, pose.look, pose.flash, dark));
  stat(performance.now() - t0, fk);
  return fr;
}

const WARM_POSE: MobPose = {
  anim: 'idle',
  frame: 0,
  mode: 'chase',
  t: 0,
  left: false,
  flash: false,
  look: 'normal',
  now: 0,
};

/** Прогрев: кадры поз по сторонам, по одному на шаг. */
function* warmAll(
  K: Kind,
  list: [string, number][],
  pic: (a: string, f: number, d: number) => Pic,
) {
  for (const [anim, n] of list)
    for (let d = 0; d < NDIR; d++)
      for (let f = 0; f < n; f++) {
        frameOf(K, anim, f, d, WARM_POSE, () => pic(anim, f, d));
        yield 0;
      }
}

/** Сторона, на которую смотрит камера (правый бок ближе при cos(курса) ≥ 0). */
const camSide = (yaw: number) => (Math.cos(yaw) >= 0 ? 1 : -1);

// ---------------------------------------------------------------------------
// Муравей-убийца: рыжий хитин, полосатое брюшко, жвала цвета кости. Ходит
// трёхногой походкой (тройки лап попеременно), шаг — по пути. Укус: пятится,
// задирает голову и разводит жвала (0,5 с — весь замах), выпад — жвала
// смыкаются в кадр урона; проводка, отдача, возврат. Зов: брюшко вверх,
// жвала стучат, с кончика капает феромон. Смерть: отшатнулся, перевернулся
// на спину, лапы поджимаются и дрыгают.
// ---------------------------------------------------------------------------

const AN_SHELL = tn('#2a0c08', '#5c1c12', '#8e3620', '#d06a40');
const AN_LEG = tn('#1a0806', '#3e1a0e', '#6e2e18', '#9a4a2a');
const AN_JAW = tn('#140804', '#2c120a', '#5a3018', '#8a5a34');
const AN_TIP = hx('#d8c8a0');
const AN_EYE = hx('#0a0404');
const AN_EYEHI = hx('#ffb070');
const AN_ANT = hx('#7a3420');
const AN_PHER = hx('#e070c8');
const AN_PHER_HI = hx('#ffc0ee');

interface AntO {
  /** Корпус вперёд (выпад), подъём, наклон носом вниз, крен (на спину — π). */
  fwd: number;
  lift: number;
  pitch: number;
  roll: number;
  /** Голова носом вниз (минус — задрана). */
  head: number;
  /** Жвала: 0 — сомкнуты, 1 — настежь. */
  jaw: number;
  /** Брюшко: вверх (+), вбок. */
  gas: number;
  gsw: number;
  /** Усики: 0 — вперёд, 1 — назад; взмах. */
  ant: number;
  antW: number;
  /** Шаг: фаза 0…1 и доля (0 — стоит). */
  ph: number;
  step: number;
  /** Передние лапы подняты; лапы поджаты (сон); к брюху (смерть); дрыгают. */
  front: number;
  tuck: number;
  curl: number;
  kick: number;
  /** Капли феромона: кадр 0…3, −1 — нет. */
  drops: number;
  /** Темнее (смерть). */
  dark: number;
  /** Вспышка смыкания жвал 0…1. */
  snap: number;
}
const A0: AntO = {
  fwd: 0,
  lift: 0,
  pitch: 0,
  roll: 0,
  head: 0,
  jaw: 0.25,
  gas: 0,
  gsw: 0,
  ant: 0.15,
  antW: 0,
  ph: 0,
  step: 0,
  front: 0,
  tuck: 0,
  curl: 0,
  kick: 0,
  drops: -1,
  dark: 0,
  snap: 0,
};

/** Лапы: опора по оси (вперёд), вбок; бедро на груди. */
const AN_FOOT_F = [5.9, 0.6, -4.9];
const AN_FOOT_S = [5.8, 6.7, 6.1];
const AN_HIP_F = [1.5, 0.6, -0.4];

function antRig(o: AntO, yaw: number): Rig {
  const r = new Rig();
  const B = F3.yaw(yaw);
  const zc = 4.6 + o.lift;
  const C = B.at(o.fwd, 0, zc).pitch(o.pitch).roll(o.roll);
  const shell: Mat = { T: AN_SHELL, spec: true, bias: -o.dark };
  const legM: Mat = { T: AN_LEG, bias: -o.dark };
  const jawM: Mat = { T: AN_JAW, bias: -o.dark };
  // Брюшко с двумя тёмными поясами — от стебелька, отстаёт и качается.
  const G = C.at(-2.5, 0, -0.1).turn(o.gsw).pitch(o.gas);
  const gasM: Mat = {
    T: AN_SHELL,
    spec: true,
    bias: -o.dark,
    pat: (q, l) =>
      Math.abs(q[0] - 0.12) < 0.09 || Math.abs(q[0] + 0.38) < 0.09
        ? l > 0.5
          ? AN_SHELL[1]
          : AN_SHELL[0]
        : null,
  };
  r.ell(G, [-4.3, 0, 0.5], [4.7, 3.7, 3.4], gasM);
  r.ball(C.p(-2.2, 0, -0.3), 1.05, shell);
  // Грудь и голова.
  r.ell(C, [0.6, 0, 0.2], [2.7, 1.9, 1.9], shell);
  const H = C.at(3.1, 0, 0.5).pitch(o.head);
  r.ell(H, [1.7, 0, 0.3], [2.5, 2.4, 2.2], shell);
  const cs = camSide(yaw);
  for (const sd of [-1, 1]) {
    r.dot(H.p(2.5, sd * 1.95, 0.9), AN_EYE, 0, 1, 0.5);
    r.dot(H.p(2.4, sd * 1.9, 1.45), AN_EYEHI, 0, 1, 0.6);
    // Жвала: два звена, кончик — кость.
    const b0 = H.p(3.5, sd * 1.0, -0.5);
    const b1 = H.p(5.0, sd * (1.35 + o.jaw * 1.3), -0.7);
    const b2 = H.p(5.9, sd * (0.3 + o.jaw * 1.9), -0.85);
    r.cap(b0, b1, 0.72, 0.55, jawM);
    r.cap(b1, b2, 0.55, 0.32, jawM);
    r.dot(b2, AN_TIP, 0, 1, 0.5);
    // Усики с изломом: стебель вверх, бич вперёд (или назад).
    const a0 = H.p(2.9, sd * 0.9, 1.7);
    const a1 = H.p(3.6 - o.ant * 2.4, sd * (1.4 + o.ant * 0.4), 5.3);
    const wv = o.antW * (sd > 0 ? 1 : -0.7);
    const a2 = H.p(7.4 - o.ant * 6.8, sd * (2.2 + o.ant * 0.7), 4.3 + wv + o.ant * 1.4);
    r.line(a0, a1, AN_ANT, 0, 0.4);
    r.line(a1, a2, AN_ANT, 0, 0.4);
  }
  r.eye = H.p(2.6, cs * 2.0, 1.0);
  // Лапы: тройки попеременно; опора стоит на полу, пока корпус едет.
  const up: V3 = [0, 0, 1];
  for (let i = 0; i < 3; i++)
    for (const sd of [-1, 1]) {
      const hip = C.p(AN_HIP_F[i], sd * 1.25, -0.7);
      const grp = (i + (sd > 0 ? 1 : 0)) % 2;
      const ps = (((o.ph + grp * 0.5) % 1) + 1) % 1;
      const L = 4.4 * o.step;
      let off = 0;
      let rise = 0;
      if (ps < 0.5) off = L / 2 - L * (ps / 0.5);
      else {
        off = -L / 2 + L * ((ps - 0.5) / 0.5);
        rise = Math.sin(PI * ((ps - 0.5) / 0.5)) * 1.7 * o.step;
      }
      let foot = B.p(AN_FOOT_F[i] + o.fwd * 0.35 + off, sd * AN_FOOT_S[i], rise);
      if (i === 0 && o.front > 0)
        foot = vlerp(foot, C.p(4.6, sd * 2.8, 1.6 + o.front), clamp01(o.front));
      if (o.tuck > 0) foot = vlerp(foot, B.p(AN_FOOT_F[i] * 0.55 + o.fwd, sd * 3.0, 0), o.tuck);
      if (o.curl > 0) {
        const kk = o.kick * Math.sin(i * 2.1 + (sd > 0 ? 1.3 : 0));
        foot = vlerp(foot, C.p(AN_HIP_F[i] * 1.6 + kk, sd * (3.4 + kk * 0.6), -5.6 - kk), o.curl);
      }
      const mid = vlerp(hip, foot, 0.45);
      const knee = vadd(
        vadd(mid, [up[0], up[1], (3.4 - o.tuck * 2.2) * (1 - o.curl)]),
        vadd(B.v(0, sd * 1.5 * (1 - o.curl), 0), C.v(0, sd * 0.9 * o.curl, -1.2 * o.curl)),
      );
      r.cap(hip, knee, 0.62, 0.46, legM);
      r.cap(knee, foot, 0.46, 0.3, legM);
    }
  // Капли феромона с кончика брюшка — светятся (слой поверх темноты).
  if (o.drops >= 0) {
    const tip = G.p(-8.7, 0, 0.4);
    for (let j = 0; j < 3; j++) {
      const k = ((o.drops + j * 1.33) % 4) / 4;
      r.dot(vadd(tip, [0, 0, -k * 4.2]), j ? AN_PHER : AN_PHER_HI, 1, j ? 1 : 2, 0.6);
    }
  }
  if (o.snap > 0) r.dot(H.p(6.3, 0, -0.85), alpha(WHITE, o.snap), 1, 2, 1);
  return r;
}

/** Поза муравья по позе-ключу и номеру кадра. */
function antPose(anim: string, f: number): AntO {
  const o: AntO = { ...A0 };
  switch (anim) {
    case 'idle': {
      // 8 кадров по 6 к/с: усики ощупывают, жвала разминаются, брюшко дышит.
      const a = (f / 8) * TAU;
      o.ant = 0.15 + 0.12 * Math.sin(a);
      o.antW = Math.sin(a * 2) * 0.7;
      o.jaw = 0.25 + 0.2 * Math.max(0, Math.sin(a * 2 + 1));
      o.gas = 0.04 * Math.sin(a + 0.6);
      o.lift = 0.15 * Math.sin(a);
      o.head = 0.06 * Math.sin(a - 0.8);
      break;
    }
    case 'run': {
      // 8 кадров на цикл шага (0,56 клетки пути).
      o.ph = f / 8;
      o.step = 1;
      o.lift = 0.35 * Math.abs(Math.sin(o.ph * TAU));
      o.pitch = 0.04;
      o.ant = 0.35;
      o.antW = Math.sin(o.ph * TAU) * 0.6;
      o.gsw = Math.sin(o.ph * TAU - 0.8) * 0.07;
      o.gas = -0.04 + 0.04 * Math.sin(o.ph * TAU * 2 - 1);
      o.jaw = 0.3;
      break;
    }
    case 'bite': {
      // Замах 0,5 с, 12 кадров: пятится и задирает голову, жвала настежь
      // (подготовка 0–0,55), дрожит на пике (до 0,78), бросок (до 1).
      const k = kf(f, 0.5);
      o.fwd = trk(k, [
        [0, 0],
        [0.55, -2.4, easeOut],
        [0.78, -2.7],
        [1, 2.6, easeIn],
      ]);
      o.lift = trk(k, [
        [0, 0],
        [0.55, 1.5],
        [0.78, 1.7],
        [1, 0.1, easeIn],
      ]);
      o.pitch = trk(k, [
        [0, 0],
        [0.55, -0.3],
        [0.78, -0.34],
        [1, 0.12, easeIn],
      ]);
      o.head = trk(k, [
        [0, 0],
        [0.55, -0.55, easeOut],
        [0.78, -0.6],
        [1, 0.32, easeIn],
      ]);
      o.jaw = trk(k, [
        [0, 0.25],
        [0.4, 1, easeOut],
        [0.78, 1],
        [1, 0.55, easeIn],
      ]);
      if (k > 0.55 && k < 0.8) o.jaw += f % 2 ? 0.08 : -0.06;
      o.front = trk(k, [
        [0, 0],
        [0.5, 0.8],
        [0.78, 0.9],
        [1, 0, easeIn],
      ]);
      o.gas = trk(k, [
        [0.1, 0],
        [0.65, 0.3],
        [1, -0.1, easeIn],
      ]);
      o.ant = trk(k, [
        [0, 0.15],
        [0.5, 0.75],
        [1, 0.9],
      ]);
      break;
    }
    case 'bitef': {
      // Отдых после укуса 0,45 с: контакт (сомкнул, вжался), проводка,
      // отдача назад, возврат; брюшко догоняет с опозданием.
      const t = f / FPS;
      o.fwd = trk(t, [
        [0, 2.9],
        [0.08, 3.3, easeOut],
        [0.22, -0.7],
        [0.45, 0],
      ]);
      o.head = trk(t, [
        [0, 0.36],
        [0.08, 0.4],
        [0.22, -0.12],
        [0.45, 0],
      ]);
      o.pitch = trk(t, [
        [0, 0.12],
        [0.1, 0.1],
        [0.24, -0.06],
        [0.45, 0],
      ]);
      o.jaw = trk(t, [
        [0, 0],
        [0.1, 0],
        [0.24, 0.55],
        [0.45, 0.25],
      ]);
      o.gas = trk(t - 0.06, [
        [0, -0.12],
        [0.14, 0.18],
        [0.3, -0.04],
        [0.4, 0],
      ]);
      o.ant = trk(t - 0.04, [
        [0, 0.9],
        [0.3, 0.2],
      ]);
      o.lift = trk(t, [
        [0, -0.4],
        [0.1, -0.5],
        [0.3, 0.2],
        [0.45, 0],
      ]);
      o.snap = f === 0 ? 1 : f === 1 ? 0.6 : 0;
      break;
    }
    case 'call': {
      // Зов 1 с: подъём (0–4), стук жвалами 4 кадра по кругу (5–8),
      // опускание (9–12). Номер кадра — от позы, не от времени.
      const rise = f <= 4 ? easeOut((f + 1) / 5) : f <= 8 ? 1 : 1 - easeIn((f - 8) / 4);
      o.gas = 0.75 * rise;
      o.pitch = -0.14 * rise;
      o.lift = 0.8 * rise;
      o.head = -0.25 * rise;
      o.ant = 0.15 - 0.3 * rise;
      if (f >= 5 && f <= 8) {
        const c = f - 5;
        o.jaw = [1, 0.1, 0.9, 0][c];
        o.antW = [0.8, -0.6, 0.5, -0.8][c];
        o.drops = c;
        o.gsw = [0.05, 0, -0.05, 0][c];
      } else o.jaw = 0.3 + 0.5 * rise;
      break;
    }
    case 'flinch': {
      // Ушиб (оглушение или удар без сбития): вжался, голова назад, жвала
      // раскрылись, брюшко подбросило — и обратно (5 кадров).
      const k = f / 4;
      const b = Math.sin(PI * Math.min(1, k * 1.25)) * (1 - k * 0.5);
      o.fwd = -1.3 * b;
      o.lift = -0.6 * b;
      o.head = -0.35 * b;
      o.jaw = 0.25 + 0.6 * b;
      o.gas = 0.3 * b;
      o.ant = 0.15 + 0.7 * b;
      break;
    }
    case 'sleep': {
      // Спит: лапы поджаты, корпус на полу, усики опущены, брюшко дышит.
      o.tuck = 1;
      o.lift = -1.6;
      o.head = 0.3;
      o.ant = 0.85;
      o.jaw = 0.1;
      o.gas = -0.12 + (f ? 0.05 : 0);
      break;
    }
    case 'die': {
      // 15 кадров: отшатнулся (0–2), перевернулся на спину с подскоком
      // (3–8), лапы поджимаются и дрыгают (9–14).
      const t = f / FPS;
      o.fwd = trk(t, [
        [0, -1.6, easeOut],
        [0.12, -1.8],
        [0.4, -1],
      ]);
      o.roll = trk(t, [
        [0.1, 0],
        [0.36, PI],
      ]);
      o.lift = trk(t, [
        [0, 0.4],
        [0.1, 0.6],
        [0.22, 3.2, easeOut],
        [0.36, -0.9, easeIn],
        [0.62, -1.0],
      ]);
      o.curl = trk(t, [
        [0.1, 0],
        [0.4, 1],
      ]);
      o.kick = t > 0.3 ? Math.sin(f * 2.3) * 1.6 * (1 - sstep(0.3, 0.62, t)) : 0;
      o.jaw = trk(t, [
        [0, 1],
        [0.3, 0.8],
        [0.62, 0.4],
      ]);
      o.head = trk(t, [
        [0, -0.4],
        [0.5, 0.3],
      ]);
      o.gas = trk(t, [
        [0, 0.3],
        [0.4, -0.2],
      ]);
      o.ant = 0.9;
      o.antW = Math.sin(f * 1.9) * (1 - t / 0.62);
      o.dark = 0.22 * sstep(0.3, 0.62, t);
      break;
    }
  }
  return o;
}

const ANT = kindOf(36, 28, 18, 19, 1000);
const antPic = (anim: string, f: number, d: number): Pic =>
  draw(ANT, antRig(antPose(anim, f), yawN(d)));
const ANT_IDLE_FPS = 6;

registerMobPainter('f5_ant', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = pose.t;
  const now = pose.now || 0;
  const tech = md === 'windup' || md === 'recover' || md === 'call' || md === 'alert';
  const v = visOf(m, pose, tech ? (m.face ?? 0) : headOf(m), 12);
  const d = dirN(v.yaw);
  const ex: Partial<MobFrame> = { shadow: 7 };
  let anim = 'idle';
  let f = 0;
  let dark = 0;
  const id = m.id ?? 0;
  if (md === 'dying') {
    f = fi(t, 14);
    anim = 'die';
    ex.linger = 0.95;
    ex.alpha = 1 - sstep(0.7, 0.95, t);
    ex.shadow = 7 * (1 - sstep(0.62, 0.95, t));
    ex.still = true;
  } else if (md === 'windup') {
    f = fi(t, 11);
    anim = 'bite';
    ex.still = true;
  } else if (md === 'recover') {
    f = fi(t, 10);
    anim = 'bitef';
    ex.still = true;
    // Контакт: корпус вжало о цель.
    if (f <= 1) {
      ex.sx = 1.08;
      ex.sy = 0.93;
    }
  } else if (md === 'call') {
    // Подъём 5 кадров, стук по кругу, опускание — последние 4 кадра режима.
    const n = Math.floor(t * FPS);
    f =
      n <= 4
        ? n
        : t > 1 - 4 / FPS
          ? Math.min(12, 9 + Math.floor((t - (1 - 4 / FPS)) * FPS))
          : 5 + ((n - 5) % 4);
    anim = 'call';
    ex.still = true;
  } else if (md === 'f5_born' || md === 'emerge') {
    // Из стены (из норы): перебирает лапами, проявляясь из темноты; из стены
    // ещё и выползает — сдвиг от кладки к месту.
    const T = md === 'emerge' ? 0.45 : 0.8;
    const k = clamp01(t / T);
    f = Math.floor(t * 18) % 8;
    anim = 'run';
    dark = 3 - Math.min(3, Math.floor(k * 4));
    if (md === 'f5_born') {
      const [wx, wy] = wallDir(m);
      const off = (1 - easeOut(k)) * 9;
      ex.dx = wx * off;
      ex.dy = wy * off;
      ex.alpha = 0.35 + 0.65 * k;
    }
  } else if (md === 'sleep') {
    f = Math.floor(now * 1.2 + hash(id, 3)) % 2;
    anim = 'sleep';
  } else if (md === 'stun' || pose.anim === 'hurt') {
    f = fi(md === 'stun' ? t : now - v.hit, 4);
    anim = 'flinch';
  } else if (moving(m)) {
    f = Math.floor((v.dist / 0.56) * 8) % 8;
    anim = 'run';
  } else {
    f = Math.floor((now + hash(id, 7) * 4) * ANT_IDLE_FPS) % 8;
    anim = 'idle';
    if (md === 'alert') ex.dy = -Math.sin(PI * clamp01(t / 0.35)) * 2.2;
  }
  if (md !== 'dying') hurtFx(v, now, 1.6, ex);
  return { ...frameOf(ANT, anim, f, d, pose, () => antPic(anim, f, d), dark), ...ex };
});

registerMobWarm('f5_ant', function* () {
  yield* warmAll(
    ANT,
    [
      ['run', 8],
      ['idle', 8],
      ['bite', 12],
      ['bitef', 11],
      ['flinch', 5],
      ['call', 13],
      ['die', 15],
      ['sleep', 2],
    ],
    antPic,
  );
});

// ---------------------------------------------------------------------------
// Адская гончая: угольная, по бокам тлеющие трещины (светятся в темноте),
// глаза и пасть горят, гребень шипов, хвост с огоньком. Галоп — по пути
// (8 кадров на цикл). Пламя (0,8 с): голову к цели, вдох — грудь
// раздувается, трещины разгораются, голова назад; бросок головы — пасть
// настежь в кадр удара, выдох держит всю струю. Укус (0,38 с): присела на
// задние, бросок, хватка с трёпкой головой. Смерть: подломились лапы, легла
// на бок, угли гаснут.
// ---------------------------------------------------------------------------

const HD_BODY = tn('#141012', '#2e2426', '#4e3e3e', '#7a625a');
const HD_EMB: RGBA[] = [hx('#a8300c'), hx('#ff7a1a'), hx('#ffd24a'), hx('#fff0a0')];
const HD_EYE = hx('#ffb030');
const HD_TOOTH = hx('#f0e6d0');
const HD_MAW = tn('#3a0806', '#8a1c08', '#e0601a', '#ffc050');

interface HoundO {
  fwd: number;
  lift: number;
  pitch: number;
  roll: number;
  /** Голова носом вниз; вбок (трёпка); шея вытянута вперёд. */
  head: number;
  hturn: number;
  neck: number;
  jaw: number;
  /** Грудь раздута (вдох) 0…1, накал трещин 0…1. */
  chest: number;
  heat: number;
  /** Уши прижаты 0…1; хвост вверх (+) / поджат (−), вбок. */
  ears: number;
  tail: number;
  tsw: number;
  /** Галоп: фаза и доля. */
  ph: number;
  step: number;
  /** Присела на задние; передние в упор; лёжа (сон); лапы подломились (смерть). */
  crouch: number;
  brace: number;
  tuck: number;
  fall: number;
  /** Огонь из пасти — кадр 0…2, −1 нет. */
  flame: number;
  snap: number;
  /** Угли гаснут (смерть) 0…1; глаза закрыты. */
  dim: number;
  shut: number;
  /** Огонёк хвоста — кадр. */
  flick: number;
}
const H0: HoundO = {
  fwd: 0,
  lift: 0,
  pitch: 0,
  roll: 0,
  head: 0,
  hturn: 0,
  neck: 0,
  jaw: 0.1,
  chest: 0,
  heat: 0.4,
  ears: 0.2,
  tail: 0,
  tsw: 0,
  ph: 0,
  step: 0,
  crouch: 0,
  brace: 0,
  tuck: 0,
  fall: 0,
  flame: -1,
  snap: 0,
  dim: 0,
  shut: 0,
  flick: 0,
};

/** Трещина по боку (координаты тела на единичной сфере). */
const houndCrack = (q: V3) => {
  if (Math.abs(q[1]) < 0.32 || q[2] < -0.55) return false;
  const v = q[0] * 2.3 + q[2] * 1.4 + 0.3 * Math.sin(q[2] * 7 + q[1] * 3);
  return v - Math.floor(v) < 0.15;
};

function houndRig(o: HoundO, yaw: number): Rig {
  const r = new Rig();
  const B = F3.yaw(yaw);
  const cs = camSide(yaw);
  const zc = 8.4 + o.lift - o.tuck * 5.0 - o.crouch * 1.2;
  const C = B.at(o.fwd, 0, zc).pitch(o.pitch).roll(o.roll);
  const heat = clamp01(o.heat) * (1 - o.dim);
  const emb = heat > 0.8 ? HD_EMB[3] : heat > 0.5 ? HD_EMB[2] : heat > 0.15 ? HD_EMB[1] : HD_EMB[0];
  const plain: Mat = { T: HD_BODY };
  const body: Mat = {
    T: HD_BODY,
    pat: (q) => (houndCrack(q) ? (o.dim > 0.7 ? HD_BODY[1] : emb) : null),
    gpat: (q) => (houndCrack(q) ? (0.3 + 0.7 * heat) * (1 - o.dim) : 0),
  };
  // Зад, поджарая талия, глубокая грудь (на вдохе раздувается).
  r.ell(C, [-4.5, 0, 0.2], [3.7, 3.8, 2.9], body);
  r.cap(C.p(-2.2, 0, 0.5), C.p(1.6, 0, 0.6), 2.6, 3.1, plain);
  const ch = 1 + 0.17 * o.chest;
  r.ell(C, [3.0, 0, 0.4 + o.chest * 0.3], [4.0, 4.2 * ch, 3.5 * ch], body);
  // Шея и голова: череп, длинная морда, нижняя челюсть.
  const Hd = C.at(7.0 + o.neck * 1.6, 0, 3.7 - o.neck * 0.8 - o.tuck * 1.4)
    .turn(o.hturn)
    .pitch(o.head);
  r.cap(C.p(4.6, 0, 1.6), Hd.p(-0.9, 0, -0.3), 2.8, 2.2, plain);
  r.ell(Hd, [0.6, 0, 0.3], [2.8, 2.8, 2.2], plain);
  r.cap(Hd.p(2.2, 0, 0), Hd.p(5.7, 0, -0.5), 1.65, 1.05, plain);
  r.dot(Hd.p(6.2, 0, -0.3), HD_BODY[0], 0, 1, 0.4);
  const J = Hd.at(1.9, 0, -1.2).pitch(o.jaw * 0.8);
  r.cap(J.p(0, 0, 0), J.p(3.6, 0, -0.2), 1.1, 0.75, plain);
  // Пасть горит изнутри: видна, когда челюсть открыта; на выдохе — добела
  // (саму струю рисует зона `f5_flame` от этой пасти).
  if (o.jaw > 0.15)
    r.ell(Hd, [3.4, 0, -1.25 - o.jaw * 0.5], [1.8, 0.9, 0.4 + o.jaw * 0.6], {
      T: o.flame >= 0 ? [HD_MAW[2], HD_MAW[3], HD_EMB[3], WHITE] : HD_MAW,
      glow: o.flame >= 0 ? 1 : 0.5 + 0.5 * heat,
      soft: true,
    });
  for (const sd of [-1, 1]) {
    r.dot(Hd.p(5.0, sd * 0.65, -1.25), HD_TOOTH, 0, 1, 0.5);
    if (o.jaw > 0.3) r.dot(J.p(3.1, sd * 0.6, 0.7), HD_TOOTH, 0, 1, 0.5);
    // Глаза — угли.
    if (!o.shut && o.dim < 0.6) r.dot(Hd.p(1.9, sd * 1.6, 1.0), HD_EYE, 1, 2, 0.6);
    // Уши — назад, острые; прижимаются.
    r.spike(
      Hd.p(-0.4, sd * 1.5, 1.6),
      Hd.v(-0.7 - o.ears * 1.2, sd * 0.7, 1.4 - o.ears * 1.0),
      3.4,
      1.5,
      { T: HD_BODY, bias: 0.15 },
      3,
    );
  }
  r.eye = Hd.p(1.9, cs * 1.6, 1.0);
  // Гребень шипов по хребту.
  for (let i = 0; i < 5; i++) {
    const k = i / 4;
    const P = vlerp(C.p(-5.4, 0, 2.6), C.p(3.6, 0, 3.6 + o.chest * 0.5), k);
    r.spike(P, C.v(-0.7, 0, 1), 1.6 + (i === 2 ? 0.6 : 0), 1.1, { T: HD_BODY, bias: 0.2 }, 3);
  }
  // Хвост-плеть: низко назад, кончик книзу, огонёк на конце.
  const a1 = 0.3 + o.tail * 0.6;
  const a2 = a1 - 0.45 + o.tail * 0.2;
  const T0 = C.p(-7.6, 0, 1.0);
  const T1 = vadd(T0, C.v(-2.8 * Math.cos(a1), Math.sin(o.tsw) * 2.0, 2.8 * Math.sin(a1)));
  const T2 = vadd(T1, C.v(-2.6 * Math.cos(a2), Math.sin(o.tsw * 1.7) * 2.2, 2.6 * Math.sin(a2)));
  r.cap(T0, T1, 1.1, 0.75, plain);
  r.cap(T1, T2, 0.75, 0.45, plain);
  if (o.dim < 0.8) {
    const fl = o.flick % 3;
    r.dot(T2, HD_EMB[3], 1, 1, 0.6);
    r.dot(vadd(T2, [fl === 1 ? 0.5 : -0.3, 0, 1.0]), HD_EMB[2], 1, 1, 0.6);
    if (fl !== 2) r.dot(vadd(T2, [fl ? 0.2 : -0.6, 0, 1.9]), HD_EMB[1], 0.9, 1, 0.6);
  }
  // Лапы: галоп (передние и задние парами со сдвигом), упор, сон, падение.
  const legs: [number, number, number, number, boolean][] = [
    // бедро по оси, опора по оси, вбок, фаза, передняя
    [3.4, 3.9, 3.4, 0, true],
    [-4.6, -5.0, 3.6, 0.55, false],
  ];
  for (const [hipF, footF, footS, phase, front] of legs)
    for (const sd of [-1, 1]) {
      const legM: Mat = { T: HD_BODY, bias: sd === cs ? 0 : -0.18 };
      const hip = C.p(hipF, sd * 2.7, -1.1);
      const ps = (((o.ph + phase + (sd > 0 ? 0.12 : 0)) % 1) + 1) % 1;
      const R = (front ? 3.6 : 3.9) * o.step;
      let off = 0;
      let rise = 0;
      if (ps < 0.42) off = R - 2 * R * (ps / 0.42);
      else {
        off = -R + 2 * R * ((ps - 0.42) / 0.58);
        rise = Math.sin(PI * ((ps - 0.42) / 0.58)) * 3.0 * o.step;
      }
      let foot = B.p(
        footF + o.fwd * 0.3 + off + (front ? 1.3 * o.brace : 1.6 * o.crouch),
        sd * (footS + (front ? 0.7 * o.brace : 0)),
        rise,
      );
      if (o.tuck > 0)
        foot = vlerp(foot, B.p(front ? footF + 3.4 : footF + 1.2, sd * 2.8, 0), o.tuck);
      if (o.fall > 0) foot = vlerp(foot, C.p(footF * 0.9, sd * 4.2, -6.0), o.fall);
      const mid = vlerp(hip, foot, 0.5);
      if (front) {
        const elbow = vadd(mid, C.v(-0.9, 0, 0.2));
        r.cap(hip, elbow, 1.45, 0.95, legM);
        r.cap(elbow, foot, 0.9, 0.65, legM);
      } else {
        const knee = vadd(mid, C.v(1.6, 0, 0.3));
        const hock = vadd(vlerp(knee, foot, 0.6), C.v(-1.1, 0, 0.3));
        r.cap(hip, knee, 1.85, 1.15, legM);
        r.cap(knee, hock, 1.0, 0.7, legM);
        r.cap(hock, foot, 0.68, 0.6, legM);
      }
    }
  // Искра хватки.
  if (o.snap > 0) r.dot(Hd.p(5.8, 0, -1.3), alpha(WHITE, o.snap), 1, 2, 1);
  return r;
}

function houndPose(anim: string, f: number): HoundO {
  const o: HoundO = { ...H0, flick: f };
  switch (anim) {
    case 'idle': {
      // 8 кадров по 6 к/с: дышит грудью, хвост ходит, голова оглядывается.
      const a = (f / 8) * TAU;
      o.chest = 0.12 + 0.1 * Math.sin(a);
      o.tsw = Math.sin(a) * 0.5;
      o.tail = 0.1 * Math.sin(a + 1);
      o.hturn = 0.18 * Math.sin(a * 0.5 + 0.5) * (f > 3 ? 1 : 0.4);
      o.jaw = f % 4 < 2 ? 0.28 : 0.12;
      o.heat = 0.35 + 0.15 * Math.sin(a);
      o.ears = 0.15 + (f === 5 ? 0.35 : 0);
      o.lift = 0.15 * Math.sin(a);
      break;
    }
    case 'run': {
      // Галоп: 8 кадров на цикл (1,1 клетки пути); корпус качается, хвост
      // тянется назад, уши прижаты.
      o.ph = f / 8;
      o.step = 1;
      const a = o.ph * TAU;
      o.pitch = 0.11 * Math.sin(a + 0.6);
      o.lift = 0.9 * Math.max(0, Math.sin(a + 2.2));
      o.head = -0.08 * Math.sin(a + 0.6);
      o.neck = 0.4;
      o.tail = -0.25 + 0.15 * Math.sin(a + 1.5);
      o.tsw = 0.15 * Math.sin(a);
      o.ears = 0.7;
      o.jaw = 0.25;
      o.heat = 0.55;
      break;
    }
    case 'breath': {
      // Пламя, 0,8 с (19 кадров): голову к цели (до 0,18), вдох — грудь
      // раздувается, голова назад-вверх, трещины разгораются (до 0,62),
      // бросок головы вперёд — пасть раскрывается к удару (0,8).
      const k = kf(f, 0.8);
      o.chest = trk(k, [
        [0.2, 0],
        [0.75, 1, easeIn],
        [1, 0.85],
      ]);
      o.heat = trk(k, [
        [0, 0.45],
        [0.75, 1],
      ]);
      o.head = trk(k, [
        [0, 0],
        [0.22, 0.12],
        [0.75, -0.5, easeOut],
        [1, 0.18, easeIn],
      ]);
      o.neck = trk(k, [
        [0.22, 0.3],
        [0.75, -0.6],
        [1, 1, easeIn],
      ]);
      o.fwd = trk(k, [
        [0.22, 0],
        [0.75, -1.0],
        [1, 0.6, easeIn],
      ]);
      o.lift = trk(k, [
        [0.22, 0],
        [0.75, 0.6],
        [1, 0.1],
      ]);
      o.jaw = trk(k, [
        [0.22, 0.2],
        [0.4, 0],
        [0.82, 0],
        [1, 0.75, easeIn],
      ]);
      o.brace = trk(k, [
        [0, 0],
        [0.4, 1],
      ]);
      o.ears = trk(k, [
        [0, 0.3],
        [0.5, 1],
      ]);
      o.tail = trk(k, [
        [0, 0],
        [0.7, 0.7],
        [1, 0.5],
      ]);
      if (k > 0.55 && k < 0.8) o.lift += f % 2 ? 0.15 : -0.1;
      break;
    }
    case 'breathf': {
      // Выдох (отдых после пламени, 0,55 с): пасть настежь всю струю
      // (0,45 с), грудь опадает, корпус откатывает отдачей; потом закрыла.
      const t = f / FPS;
      o.jaw = trk(t, [
        [0, 1],
        [0.4, 0.9],
        [0.52, 0.15],
      ]);
      o.neck = trk(t, [
        [0, 1],
        [0.42, 0.8],
        [0.55, 0],
      ]);
      o.head = trk(t, [
        [0, 0.18],
        [0.45, 0.1],
        [0.55, 0],
      ]);
      o.chest = trk(t, [
        [0, 0.85],
        [0.45, 0.05],
      ]);
      o.fwd = trk(t, [
        [0, 0.6],
        [0.12, -0.6, easeOut],
        [0.55, 0],
      ]);
      o.heat = trk(t, [
        [0, 1],
        [0.55, 0.5],
      ]);
      o.brace = trk(t, [
        [0.3, 1],
        [0.55, 0],
      ]);
      o.ears = 0.8;
      o.tail = trk(t - 0.08, [
        [0, 0.5],
        [0.4, 0],
      ]);
      o.flame = t < 0.43 ? f % 3 : -1;
      break;
    }
    case 'bite': {
      // Укус, 0,38 с (9 кадров): присела на задние, голова низко, уши
      // прижаты (до 0,5), дрожит (до 0,78), бросок — пасть настежь.
      const k = kf(f, 0.38);
      o.crouch = trk(k, [
        [0, 0],
        [0.5, 1, easeOut],
        [0.78, 1],
        [1, 0, easeIn],
      ]);
      o.fwd = trk(k, [
        [0, 0],
        [0.5, -2.0, easeOut],
        [0.78, -2.2],
        [1, 2.8, easeIn],
      ]);
      o.pitch = trk(k, [
        [0, 0],
        [0.5, -0.14],
        [0.78, -0.16],
        [1, 0.1, easeIn],
      ]);
      o.head = trk(k, [
        [0, 0],
        [0.5, 0.28],
        [1, 0.05],
      ]);
      o.jaw = trk(k, [
        [0, 0.1],
        [0.5, 0.35],
        [0.78, 0.4],
        [1, 1, easeIn],
      ]);
      o.ears = 1;
      o.tail = -0.1;
      o.heat = 0.6;
      if (k > 0.5 && k < 0.8) o.fwd += f % 2 ? 0.2 : -0.2;
      break;
    }
    case 'bitef': {
      // Хватка (0,55 с): сомкнула пасть, трёпка головой, отдача, возврат.
      const t = f / FPS;
      o.fwd = trk(t, [
        [0, 3.2],
        [0.06, 3.5],
        [0.3, -1.0],
        [0.55, 0],
      ]);
      o.jaw = trk(t, [
        [0, 0],
        [0.25, 0],
        [0.35, 0.4],
        [0.55, 0.1],
      ]);
      o.head = trk(t, [
        [0, 0.15],
        [0.3, 0.1],
        [0.55, 0],
      ]);
      o.hturn = t < 0.28 ? 0.38 * Math.sin(f * 2.4) * (1 - t / 0.28) : 0;
      o.pitch = trk(t, [
        [0, 0.1],
        [0.3, -0.04],
        [0.55, 0],
      ]);
      o.ears = trk(t, [
        [0, 1],
        [0.55, 0.3],
      ]);
      o.tail = trk(t - 0.06, [
        [0, 0.3],
        [0.3, -0.1],
        [0.5, 0],
      ]);
      o.heat = 0.6;
      o.snap = f === 0 ? 1 : f === 1 ? 0.5 : 0;
      break;
    }
    case 'flinch': {
      // Ушиб: взвизгнула — голова вверх, пасть приоткрыта, хвост поджат.
      const k = f / 4;
      const b = Math.sin(PI * Math.min(1, k * 1.25)) * (1 - k * 0.5);
      o.fwd = -1.6 * b;
      o.lift = -0.5 * b;
      o.head = -0.45 * b;
      o.jaw = 0.1 + 0.55 * b;
      o.ears = 0.3 + 0.7 * b;
      o.tail = -0.7 * b;
      o.heat = 0.4 + 0.4 * b;
      break;
    }
    case 'sleep': {
      // Спит клубком: лапы под собой, голова на лапах, угли едва тлеют.
      o.tuck = 1;
      o.head = 0.55;
      o.neck = -0.4;
      o.ears = 0.9;
      o.tail = -0.5;
      o.tsw = 1.1;
      o.heat = 0.15 + f * 0.12;
      o.chest = f * 0.12;
      o.shut = 1;
      o.jaw = 0;
      break;
    }
    case 'die': {
      // 16 кадров: отшатнулась (0–2), лапы подломились — легла на бок
      // (3–10), угли гаснут, голова падает (11–15).
      const t = f / FPS;
      o.fwd = trk(t, [
        [0, -1.6, easeOut],
        [0.12, -1.8],
        [0.66, -1.2],
      ]);
      o.head = trk(t, [
        [0, -0.5],
        [0.12, -0.55],
        [0.5, 0.5],
        [0.66, 0.65],
      ]);
      o.jaw = trk(t, [
        [0, 0.8],
        [0.4, 0.5],
        [0.66, 0.3],
      ]);
      o.roll = trk(t, [
        [0.12, 0],
        [0.42, 1.35, easeIn],
        [0.5, 1.25],
        [0.58, 1.32],
      ]);
      o.lift = trk(t, [
        [0, 0],
        [0.12, 0.2],
        [0.42, -3.2, easeIn],
        [0.66, -3.4],
      ]);
      o.fall = trk(t, [
        [0.1, 0],
        [0.45, 1],
      ]);
      o.tail = trk(t, [
        [0, 0.4],
        [0.5, -0.4],
      ]);
      o.ears = 1;
      o.heat = 0.8;
      o.dim = sstep(0.3, 0.66, t);
      o.shut = t > 0.45 ? 1 : 0;
      break;
    }
  }
  return o;
}

const HOUND = kindOf(44, 34, 22, 25, 1000);
const houndPic = (anim: string, f: number, d: number): Pic =>
  draw(HOUND, houndRig(houndPose(anim, f), yawN(d)));

registerMobPainter('f5_hound', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = pose.t;
  const now = pose.now || 0;
  const tech = md === 'windup' || md === 'recover' || md === 'breath' || md === 'alert';
  const v = visOf(m, pose, tech ? (m.face ?? 0) : headOf(m), 12);
  const d = dirN(v.yaw);
  const ex: Partial<MobFrame> = { shadow: 8 };
  let anim = 'idle';
  let f = 0;
  let dark = 0;
  const id = m.id ?? 0;
  if (md === 'dying') {
    f = fi(t, 15);
    anim = 'die';
    ex.linger = 1.0;
    ex.alpha = 1 - sstep(0.75, 1.0, t);
    ex.shadow = 8 * (1 - sstep(0.66, 1.0, t));
    ex.still = true;
  } else if (md === 'breath') {
    f = fi(t, 18);
    anim = 'breath';
    ex.still = true;
  } else if (md === 'windup') {
    f = fi(t, 8);
    anim = 'bite';
    ex.still = true;
  } else if (md === 'recover') {
    if (v.prev === 'breath') {
      f = fi(t, 13);
      anim = 'breathf';
    } else {
      f = fi(t, 12);
      anim = 'bitef';
      if (f <= 1) {
        ex.sx = 1.08;
        ex.sy = 0.93;
      }
    }
    ex.still = true;
  } else if (md === 'f5_born') {
    const k = clamp01(t / 0.8);
    f = Math.floor(t * 16) % 8;
    anim = 'run';
    dark = 3 - Math.min(3, Math.floor(k * 4));
    const [wx, wy] = wallDir(m);
    const off = (1 - easeOut(k)) * 10;
    ex.dx = wx * off;
    ex.dy = wy * off;
    ex.alpha = 0.35 + 0.65 * k;
  } else if (md === 'sleep') {
    f = Math.floor(now * 1.1 + hash(id, 3)) % 2;
    anim = 'sleep';
  } else if (md === 'stun' || pose.anim === 'hurt') {
    f = fi(md === 'stun' ? t : now - v.hit, 4);
    anim = 'flinch';
  } else if (moving(m)) {
    f = Math.floor((v.dist / 1.1) * 8) % 8;
    anim = 'run';
  } else {
    f = Math.floor((now + hash(id, 7) * 4) * 6) % 8;
    anim = 'idle';
    if (md === 'alert') ex.dy = -Math.sin(PI * clamp01(t / 0.35)) * 2.6;
  }
  if (md !== 'dying') hurtFx(v, now, 1.8, ex);
  return { ...frameOf(HOUND, anim, f, d, pose, () => houndPic(anim, f, d), dark), ...ex };
});

registerMobWarm('f5_hound', function* () {
  yield* warmAll(
    HOUND,
    [
      ['run', 8],
      ['idle', 8],
      ['bite', 9],
      ['bitef', 13],
      ['breath', 19],
      ['breathf', 14],
      ['flinch', 5],
      ['die', 16],
      ['sleep', 2],
    ],
    houndPic,
  );
});

// ---- Пламя гончей в два слоя: метка на полу наливается от пасти к краю
// (последние 0,2 с — белая кромка), струя (`f5_flame`, `above`) бьёт из
// пасти кадра поверх темноты, копоть с углями (`f5_fire`, контакт) остаётся
// на полу. Случай — только `hash` от времени рендера и номера зоны.

type ZoneArt = (Zone | Strike) & { ang?: number; arc?: number; len?: number; life?: number };
const css = (c: RGBA, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${clamp01(a).toFixed(3)})`;
const FIRE_C: RGBA[] = [hx('#7a1c06'), hx('#d8400e'), hx('#ff8a1e'), hx('#ffd24a'), hx('#fff4c0')];
const SOOT = hx('#140c0a');

/** Точка пасти гончей на экране от середины моба (кадр выдоха, сторона по углу). */
function houndMouth(a: number): [number, number] {
  const ya = yawN(dirN(a));
  const L = 15;
  return [Math.cos(ya) * L, Math.sin(ya) * L * SE - 9.4 * CE];
}

function fan(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  r0: number,
  r1: number,
  a: number,
  arc: number,
): void {
  g.beginPath();
  g.arc(x, y, r1, a - arc / 2, a + arc / 2);
  g.arc(x, y, Math.max(0, r0), a + arc / 2, a - arc / 2, true);
  g.closePath();
}

registerZonePainter('f5_fire', (g, z, px, py, S, time) => {
  const s = z as Strike & ZoneArt;
  const k = s.warn > 0 ? clamp01(s.t / s.warn) : 1;
  const left = s.warn > 0 ? s.warn - s.t : 0;
  const R = s.r * S;
  const a = s.ang ?? 0;
  const arc = s.arc ?? 1;
  const hot = left < 0.2;
  // Жар под конусом: слабая заливка, налив идёт от пасти к краю.
  fan(g, px, py, 0, R, a, arc);
  g.fillStyle = css(FIRE_C[0], 0.1 + 0.12 * k);
  g.fill();
  const front = R * (0.18 + 0.82 * easeOut(k));
  fan(g, px, py, 0, front, a, arc * (0.55 + 0.45 * k));
  g.fillStyle = css(FIRE_C[1], 0.12 + 0.22 * k);
  g.fill();
  // Кромка налива — бегущая дуга; к удару замыкается на внешнем краю.
  g.lineWidth = hot ? 2 : 1;
  g.strokeStyle = css(hot ? FIRE_C[4] : FIRE_C[2], 0.45 + 0.5 * k);
  g.beginPath();
  g.arc(px, py, front, a - (arc / 2) * (0.55 + 0.45 * k), a + (arc / 2) * (0.55 + 0.45 * k));
  g.stroke();
  // Внешний край и бока — пунктиром, пока не налилось.
  g.lineWidth = 1;
  g.strokeStyle = css(hot ? FIRE_C[4] : FIRE_C[1], hot ? 0.9 : 0.35 + 0.3 * k);
  g.setLineDash(hot ? [] : [2, 2]);
  fan(g, px, py, 0, R, a, arc);
  g.stroke();
  g.setLineDash([]);
  // Мерцание жара: угольки ползут от пасти по конусу.
  const n = 6 + Math.round(k * 8);
  for (let i = 0; i < n; i++) {
    const u = (time * 1.4 + hash(i, s.id, 1)) % 1;
    const aa = a + (hash(i, s.id, 2) - 0.5) * arc * 0.9;
    const d = R * u * (0.25 + 0.75 * k);
    g.fillStyle = css(u < 0.4 ? FIRE_C[3] : FIRE_C[2], (0.5 + 0.5 * k) * (1 - u * 0.6));
    g.fillRect(Math.round(px + Math.cos(aa) * d), Math.round(py + Math.sin(aa) * d), 1, 1);
  }
  return true;
});

registerZonePainter('f5_flame', (g, z, px, py, S, time) => {
  const zz = z as Zone & ZoneArt;
  const life = zz.life || 0.45;
  const t = clamp01(zz.t / life);
  const R = zz.r * S;
  const a = zz.ang ?? 0;
  const arc = 0.95;
  const [mx, my] = houndMouth(a);
  const ox = px + mx;
  const oy = py + my;
  // Точка струи: доля `u` от пасти до края конуса под углом `a + sp`; к краю
  // струя опускается к полу и чуть горбится вверх.
  const at = (u: number, sp: number): [number, number] => [
    ox + (px + Math.cos(a + sp) * R - ox) * u,
    oy + (py + Math.sin(a + sp) * R - oy) * u - Math.sin(PI * u) * 3,
  ];
  // Струя летит 0,1 с, держится, потом отрывается от пасти и гаснет.
  const reach = easeOut(t * 4.5);
  const tail = sstep(0.62, 1, t);
  const fade = 1 - sstep(0.75, 1, t);
  const seed = Math.floor(time * FPS);
  g.save();
  // Свет струи на полу и в воздухе — мягкое свечение.
  g.globalCompositeOperation = 'lighter';
  const gl = g.createRadialGradient(
    px + Math.cos(a) * R * 0.5,
    py + Math.sin(a) * R * 0.5,
    0,
    px + Math.cos(a) * R * 0.5,
    py + Math.sin(a) * R * 0.5,
    R * 0.75,
  );
  gl.addColorStop(0, css(FIRE_C[2], 0.28 * fade));
  gl.addColorStop(1, css(FIRE_C[0], 0));
  g.fillStyle = gl;
  g.fillRect(px - R * 1.5, py - R * 1.5, R * 3, R * 3);
  g.globalCompositeOperation = 'source-over';
  // Комья пламени: от пасти по конусу, у пасти белые, к краю красные и
  // ниже — струя опускается к полу; каждый кадр пляшут.
  const N = 30;
  for (let pass = 0; pass < 2; pass++)
    for (let i = 0; i < N; i++) {
      const u = (i + 0.5) / N;
      if (u > reach || u < tail) continue;
      const sp = (hash(i, seed, 3) - 0.5) * arc;
      const [x, y] = at(u, sp);
      const rr = (1.4 + u * 4.2 + hash(i, seed, 4) * 1.8) * (pass ? 0.55 : 1);
      const ci = pass
        ? u < 0.35
          ? 4
          : u < 0.7
            ? 3
            : 2
        : u < 0.25
          ? 3
          : u < 0.55
            ? 2
            : u < 0.8
              ? 1
              : 0;
      g.fillStyle = css(FIRE_C[ci], (pass ? 0.95 : 0.85) * fade * (1 - Math.max(0, u - 0.85) * 3));
      g.beginPath();
      g.arc(Math.round(x), Math.round(y), rr, 0, TAU);
      g.fill();
    }
  // Язычок у самой пасти — белый, пока струя не оторвалась.
  if (tail < 0.05) {
    g.fillStyle = css(FIRE_C[4], fade);
    g.beginPath();
    g.arc(Math.round(ox), Math.round(oy), 2.2, 0, TAU);
    g.fill();
  }
  // Искры с края и дым над струёй.
  for (let i = 0; i < 10; i++) {
    const u = 0.55 + hash(i, seed, 5) * 0.5;
    if (u > reach + 0.1) continue;
    const [x, y0] = at(u, (hash(i, seed, 6) - 0.5) * arc * 1.1);
    const y = y0 - 3 - hash(i, seed, 7) * 5;
    g.fillStyle = css(i % 3 ? FIRE_C[3] : FIRE_C[4], fade);
    g.fillRect(Math.round(x), Math.round(y), 1, 1);
  }
  for (let i = 0; i < 4; i++) {
    const u = 0.5 + i * 0.15;
    if (u > reach) continue;
    const [x, y0] = at(u, 0);
    const y = y0 - 6 - t * 8;
    g.fillStyle = css(SOOT, 0.3 * fade * t);
    g.beginPath();
    g.arc(Math.round(x), Math.round(y), 3 + u * 3, 0, TAU);
    g.fill();
  }
  g.restore();
  return true;
});

// Копоть на полу после струи: конус сажи, угли гаснут, язычки огня в первые
// полсекунды. Слой пола (под мобами), 1,6 с.
registerImpactPainter('f5_fire', {
  life: 1.6,
  shake: 0.1,
  paint: (g, rec, px, py, S, age) => {
    const R = (rec.r ?? 3.4) * S;
    const a = rec.ang ?? 0;
    const arc = rec.arc ?? 0.95;
    const k = clamp01(age / 1.6);
    const fade = 1 - sstep(0.55, 1, k);
    fan(g, px, py, R * 0.12, R * 0.96, a, arc * 0.92);
    g.fillStyle = css(SOOT, 0.45 * fade);
    g.fill();
    // Угли: тлеют и остывают от жёлтого к тёмно-красному.
    for (let i = 0; i < 22; i++) {
      const u = 0.18 + hash(i, rec.seed, 1) * 0.78;
      const aa = a + (hash(i, rec.seed, 2) - 0.5) * arc * 0.85;
      const cool = clamp01(k * 1.6 + hash(i, rec.seed, 3) * 0.4);
      const c = cool < 0.35 ? FIRE_C[3] : cool < 0.7 ? FIRE_C[2] : FIRE_C[1];
      const blink = (Math.floor(age * 12 + i) % 4 === 0 ? 0.6 : 1) * fade;
      g.fillStyle = css(c, blink * (1 - cool * 0.5));
      g.fillRect(
        Math.round(px + Math.cos(aa) * R * u),
        Math.round(py + Math.sin(aa) * R * u),
        1,
        1,
      );
    }
    // Язычки огня на копоти первые 0,5 с.
    if (age < 0.5) {
      const f = Math.floor(age * FPS);
      for (let i = 0; i < 5; i++) {
        const u = 0.35 + hash(i, rec.seed, 4) * 0.55;
        const aa = a + (hash(i, rec.seed, 5) - 0.5) * arc * 0.7;
        const x = Math.round(px + Math.cos(aa) * R * u);
        const y = Math.round(py + Math.sin(aa) * R * u);
        const h = Math.round((1 - age / 0.5) * (3 + hash(i, rec.seed, 6) * 3)) + ((f + i) % 2);
        for (let j = 0; j < h; j++) {
          g.fillStyle = css(j === h - 1 ? FIRE_C[3] : j > h / 2 ? FIRE_C[2] : FIRE_C[1], 0.9);
          g.fillRect(x + (j === h - 1 ? ((f + i) % 3) - 1 : 0), y - j, 1, 1);
        }
      }
    }
    return true;
  },
});

// ---------------------------------------------------------------------------
// Жаба-арканщица: оливковая, бородавки, жёлтое брюхо, глаза-бугры, горловой
// мешок. Прыжки — по фазе мозга (`hopSpeed`: в воздухе, пока синус фазы
// положителен), так что взлёт и приземление совпадают с рывком скорости.
// Аркан (0,7 с): поднялась на передних, мешок качает дважды, откинулась,
// мешок толкает — пасть настежь в кадр удара; язык вылетает зоной
// `f5_tongue_out` за 0,1 с до удара и втягивается зоной `f5_tongue`. Отдых:
// глотает (глаза проваливаются). Укус: присела и бросок. Смерть: подпрыгнула,
// перевернулась на спину, дрыгнула лапами, сдулась.
// ---------------------------------------------------------------------------

const FR_SKIN = tn('#24360f', '#4a6a24', '#76963a', '#a8c464');
const FR_BELLY = tn('#8a7030', '#c8b058', '#e2d07c', '#f4e6a4');
const FR_LEG = tn('#18260a', '#36521a', '#5a7c2c', '#88a64c');
const FR_WART = hx('#2a3c10');
const FR_WART_HI = hx('#b0cc60');
const FR_IRIS = hx('#f0dc40');
const FR_PUPIL = hx('#101008');
const FR_MOUTH = tn('#2a0808', '#6a1a1a', '#a03030', '#d06060');
const FR_TONGUE = hx('#e87890');

interface FrogO {
  fwd: number;
  pitch: number;
  roll: number;
  /** Сплющена (+) / вытянута (−). */
  squash: number;
  /** Голова: вперёд, вверх носом (−) / вниз (+). */
  neck: number;
  head: number;
  jaw: number;
  /** Горловой мешок 0…1; глоток (комок в горле). */
  throat: number;
  /** Задние лапы вытянуты назад 0…1; передние вперёд. */
  ext: number;
  reach: number;
  /** Глаза закрыты 0…1 (глотает — проваливаются). */
  blink: number;
  /** Лапы врозь кверху (на спине), дрыг. */
  splay: number;
  kick: number;
}
const FG0: FrogO = {
  fwd: 0,
  pitch: 0,
  roll: 0,
  squash: 0,
  neck: 0,
  head: 0,
  jaw: 0,
  throat: 0.2,
  ext: 0,
  reach: 0,
  blink: 0,
  splay: 0,
  kick: 0,
};

const FROG_WARTS: V3[] = [
  [-1.6, -1.4, 2.2],
  [-0.4, 1.6, 2.3],
  [0.9, -0.6, 2.5],
  [-2.6, 0.6, 1.8],
  [-1.0, 2.6, 1.4],
  [-1.2, -2.7, 1.4],
  [1.5, 1.9, 1.9],
];

function frogRig(o: FrogO, yaw: number): Rig {
  const r = new Rig();
  const B = F3.yaw(yaw);
  const cs = camSide(yaw);
  const sq = o.squash;
  const zc = 3.1 - sq * 0.7;
  const C = B.at(o.fwd, 0, zc).pitch(o.pitch).roll(o.roll);
  const skin: Mat = { T: FR_SKIN };
  // Брюхо снизу, спина сверху (сплющивается и вытягивается).
  r.ell(C, [0.2, 0, -0.6], [4.0 * (1 + sq * 0.12), 3.5 * (1 + sq * 0.1), 2.0], { T: FR_BELLY });
  r.ell(
    C,
    [0, 0, 0.2],
    [4.3 * (1 + sq * 0.15), 3.8 * (1 + sq * 0.12), 2.5 * (1 - sq * 0.28)],
    skin,
  );
  for (const w of FROG_WARTS) {
    r.dot(C.p(w[0], w[1], w[2] * (1 - sq * 0.28)), FR_WART, 0, 1, 0.5);
    r.dot(C.p(w[0] + 0.35, w[1], w[2] * (1 - sq * 0.28) + 0.25), FR_WART_HI, 0, 1, 0.55);
  }
  // Голова: широкая и плоская, глаза-бугры, пасть во всю ширину.
  const Hd = C.at(3.0 + o.neck, 0, 0.8 - sq * 0.3).pitch(o.head);
  r.ell(Hd, [0.6, 0, 0], [2.5, 3.2, 1.7], skin);
  const J = Hd.at(-0.2, 0, -0.7).pitch(o.jaw * 0.85);
  r.ell(J, [1.3, 0, -0.2], [2.0, 2.8, 0.7], { T: FR_BELLY });
  if (o.jaw > 0.12) {
    r.ell(Hd, [1.4, 0, -0.85 - o.jaw * 0.6], [1.7, 2.3, 0.35 + o.jaw * 0.7], {
      T: FR_MOUTH,
      soft: true,
    });
    r.ball(Hd.p(1.4, 0, -1.0 - o.jaw * 0.6), 0.9, {
      T: tn('#8a3040', '#c05068', '#e87890', '#f8b0c0'),
    });
  } else
    r.line(Hd.p(2.6, -2.3, -0.4), Hd.p(3.1, 0, -0.55), FR_MOUTH[1], 0, 0.5).line(
      Hd.p(3.1, 0, -0.55),
      Hd.p(2.6, 2.3, -0.4),
      FR_MOUTH[1],
      0,
      0.5,
    );
  // Горловой мешок: раздувается под челюстью, блестит.
  const th = clamp01(o.throat);
  if (th > 0.05)
    r.ell(
      Hd,
      [1.0 - th * 0.2, 0, -1.2 - th * 0.6],
      [1.2 + th * 1.0, 1.8 + th * 1.0, 0.6 + th * 1.2],
      {
        T: FR_BELLY,
        spec: th > 0.6,
      },
    );
  // Глаза: бугры с жёлтой радужкой и чёрной щелью зрачка.
  const sink = o.blink * 0.7;
  for (const sd of [-1, 1]) {
    const E = Hd.p(0.3, sd * 1.8, 1.5 - sink);
    r.ell(Hd, [0.3, sd * 1.8, 1.5 - sink], [1.35, 1.25, 1.25], skin);
    if (o.blink < 0.5) {
      r.dot(vadd(E, Hd.v(0.85, sd * 0.3, 0.5)), FR_IRIS, 0.3, 2, 0.9);
      r.dot(vadd(E, Hd.v(1.05, sd * 0.3, 0.55)), FR_PUPIL, 0, 1, 1.0);
    } else
      r.line(vadd(E, Hd.v(0.6, sd * -0.3, 0.6)), vadd(E, Hd.v(0.6, sd * 0.7, 0.6)), FR_WART, 0, 1);
  }
  r.eye = o.blink < 0.5 ? Hd.p(1.15, cs * 2.1, 2.0 - sink) : null;
  // Передние лапы: короткие, пальцы врозь.
  for (const sd of [-1, 1]) {
    const legM: Mat = { T: FR_LEG, bias: sd === cs ? 0 : -0.15 };
    const S = C.p(2.0, sd * 2.6, -1.0);
    let F = B.p(3.4 + o.fwd * 0.4 + o.reach * 1.8, sd * 3.7, 0);
    if (o.splay > 0) F = vlerp(F, C.p(3.4, sd * 4.6, -2.6 + Math.sin(o.kick + sd) * 0.6), o.splay);
    const El = vadd(vlerp(S, F, 0.5), C.v(0, sd * 0.9, 0.5));
    r.cap(S, El, 0.95, 0.7, legM);
    r.cap(El, F, 0.7, 0.55, legM);
    for (const k of [-1, 0, 1])
      r.dot(vadd(F, B.v(0.7, sd * 0.2 + k * 0.6, 0)), FR_SKIN[1], 0, 1, 0.2);
  }
  // Задние: сложены «гармошкой»; в прыжке вытянуты назад.
  for (const sd of [-1, 1]) {
    const legM: Mat = { T: FR_LEG, bias: sd === cs ? 0 : -0.15 };
    const H = C.p(-2.6, sd * 2.4, -0.4);
    let K = B.p(o.fwd - 0.2, sd * 4.7, 1.9);
    let E = B.p(o.fwd - 3.5, sd * 4.1, 0.7);
    let T = B.p(o.fwd - 1.4, sd * 4.9, 0);
    const ex = clamp01(o.ext);
    if (ex > 0) {
      K = vlerp(K, C.p(-5.0, sd * 3.0, -0.8), ex);
      E = vlerp(E, C.p(-7.6, sd * 2.6, -1.0), ex);
      T = vlerp(T, C.p(-9.4, sd * 2.4, -1.1), ex);
    }
    if (o.splay > 0) {
      const w = Math.sin(o.kick * 1.3 + sd * 1.1) * 1.2;
      K = vlerp(K, C.p(-3.4, sd * 5.0, -2.2), o.splay);
      E = vlerp(E, C.p(-5.2 + w * 0.5, sd * 5.6, -3.0 - w * 0.4), o.splay);
      T = vlerp(T, C.p(-6.4 + w, sd * 6.2, -2.6 - w * 0.5), o.splay);
    }
    r.cap(H, K, 1.55, 1.0, legM);
    r.cap(K, E, 0.9, 0.6, legM);
    r.cap(E, T, 0.6, 0.5, legM);
    for (const k of [-1, 0, 1])
      r.dot(vadd(T, C.v(-0.6, sd * 0.2 + k * 0.6, 0)), FR_SKIN[1], 0, 1, 0.2);
  }
  return r;
}

/** Прыжок по фазе мозга φ ∈ [0, 2π): в воздухе при sin φ > 0. */
function frogHop(o: FrogO, ph: number): void {
  if (ph < PI) {
    const u = ph / PI;
    o.squash = -0.45 * Math.sin(PI * u);
    o.pitch = trk(u, [
      [0, -0.3],
      [0.5, 0],
      [1, 0.22],
    ]);
    o.ext = trk(u, [
      [0, 1],
      [0.45, 0.8],
      [0.9, 0.1],
    ]);
    o.reach = trk(u, [
      [0.3, -0.4],
      [0.85, 1],
    ]);
    o.throat = 0.1;
  } else {
    const v = (ph - PI) / PI;
    o.squash = trk(v, [
      [0, 0.55],
      [0.3, 0.05, easeOut],
      [0.75, 0.05],
      [1, 0.4, easeIn],
    ]);
    o.pitch = trk(v, [
      [0, 0.22],
      [0.3, 0],
      [0.8, 0.05],
      [1, -0.2],
    ]);
    o.reach = trk(v, [
      [0, 1],
      [0.35, 0],
    ]);
    o.throat = 0.2 + 0.1 * Math.sin(v * TAU);
  }
}

function frogPose(anim: string, f: number): FrogO {
  const o: FrogO = { ...FG0 };
  switch (anim) {
    case 'idle': {
      // 8 кадров по 6 к/с: мешок дышит, моргнула.
      const a = (f / 8) * TAU;
      o.throat = 0.35 + 0.3 * Math.max(0, Math.sin(a * 2));
      o.squash = 0.05 + 0.04 * Math.sin(a);
      o.blink = f === 6 ? 1 : 0;
      o.head = -0.05 * Math.sin(a);
      break;
    }
    case 'hop':
      frogHop(o, (f / 16) * TAU);
      break;
    case 'aim': {
      // Аркан, 0,7 с (17 кадров): поднялась на передних, мешок качает
      // дважды (до 0,42); откинулась, мешок полон (до 0,62); толчок —
      // пасть открывается в удар.
      const k = kf(f, 0.7);
      o.pitch = trk(k, [
        [0, 0],
        [0.25, -0.3, easeOut],
        [0.6, -0.26],
        [0.88, -0.36],
        [1, -0.05, easeIn],
      ]);
      o.reach = trk(k, [
        [0, 0],
        [0.25, 0.5],
        [0.88, 0.5],
        [1, 0.3],
      ]);
      o.fwd = trk(k, [
        [0.6, 0],
        [0.88, -0.9, easeOut],
        [1, 0.3, easeIn],
      ]);
      o.squash = trk(k, [
        [0.6, 0],
        [0.88, 0.25],
        [1, -0.15],
      ]);
      o.throat =
        k < 0.6
          ? 0.35 + 0.65 * Math.max(0, Math.sin((k / 0.6) * TAU * 2 - PI / 2) * 0.5 + 0.5)
          : trk(k, [
              [0.6, 0.7],
              [0.88, 1],
              [1, 0.35, easeIn],
            ]);
      o.neck = trk(k, [
        [0.88, -0.3],
        [1, 0.8, easeIn],
      ]);
      o.jaw = trk(k, [
        [0.88, 0],
        [1, 0.75, easeIn],
      ]);
      o.blink = k > 0.6 && k < 0.88 ? 0.4 : 0;
      break;
    }
    case 'lashf': {
      // Отдых после аркана (0,8 с): пасть настежь, пока язык втягивается
      // (0,3 с), голова за ним; захлопнула — глоток (глаза проваливаются),
      // успокоилась.
      const t = f / FPS;
      o.jaw = trk(t, [
        [0, 1],
        [0.24, 0.8],
        [0.32, 0, easeIn],
      ]);
      o.neck = trk(t, [
        [0, 1],
        [0.3, -0.4],
        [0.55, 0],
      ]);
      o.fwd = trk(t, [
        [0, 0.6],
        [0.3, -0.5],
        [0.6, 0],
      ]);
      o.pitch = trk(t, [
        [0, -0.05],
        [0.3, 0.1],
        [0.6, 0],
      ]);
      o.throat = trk(t, [
        [0, 0.1],
        [0.3, 0.1],
        [0.38, 0.75, easeOut],
        [0.7, 0.25],
      ]);
      o.blink = t > 0.32 && t < 0.5 ? 1 : 0;
      o.squash = trk(t, [
        [0.3, 0],
        [0.38, 0.2],
        [0.6, 0.05],
      ]);
      break;
    }
    case 'bite': {
      // Укус, 0,4 с (10 кадров): присела, голова низко, задние под себя.
      const k = kf(f, 0.4);
      o.squash = trk(k, [
        [0, 0],
        [0.6, 0.4, easeOut],
        [0.85, 0.45],
        [1, -0.3, easeIn],
      ]);
      o.fwd = trk(k, [
        [0, 0],
        [0.6, -0.9],
        [1, 1.2, easeIn],
      ]);
      o.head = trk(k, [
        [0, 0],
        [0.6, 0.2],
        [1, -0.1],
      ]);
      o.ext = trk(k, [
        [0.85, 0],
        [1, 0.7],
      ]);
      o.jaw = trk(k, [
        [0.6, 0],
        [0.85, 0.2],
        [1, 0.9, easeIn],
      ]);
      o.throat = 0.3;
      if (k > 0.6 && k < 0.86) o.fwd += f % 2 ? 0.15 : -0.15;
      break;
    }
    case 'bitef': {
      // После укуса (0,8 с): захлопнула пасть, отдача, села.
      const t = f / FPS;
      o.fwd = trk(t, [
        [0, 1.8],
        [0.06, 2.0],
        [0.35, 0],
      ]);
      o.ext = trk(t, [
        [0, 0.8],
        [0.2, 0],
      ]);
      o.jaw = trk(t, [
        [0, 0.9],
        [0.08, 0],
      ]);
      o.squash = trk(t, [
        [0.05, -0.2],
        [0.2, 0.3],
        [0.45, 0.05],
      ]);
      o.throat = trk(t, [
        [0.08, 0.2],
        [0.2, 0.6],
        [0.5, 0.3],
      ]);
      break;
    }
    case 'flinch': {
      // Ушиб: сжалась, зажмурилась, мешок выдохнул.
      const k = f / 4;
      const b = Math.sin(PI * Math.min(1, k * 1.25)) * (1 - k * 0.5);
      o.squash = 0.5 * b - 0.15 * (k > 0.6 ? 1 : 0);
      o.fwd = -1.2 * b;
      o.pitch = -0.2 * b;
      o.blink = b > 0.3 ? 1 : 0;
      o.throat = 0.6 * b;
      o.jaw = 0.3 * b;
      break;
    }
    case 'sleep': {
      o.blink = 1;
      o.squash = 0.3;
      o.throat = 0.25 + f * 0.25;
      o.head = 0.12;
      break;
    }
    case 'die': {
      // 20 кадров: подпрыгнула (0–2), перевернулась в воздухе на спину
      // (2–8), дрыгнула лапами дважды (9–15), сдулась (16–19).
      const t = f / FPS;
      o.jaw = trk(t, [
        [0, 0.9],
        [0.3, 0.5],
        [0.8, 0.2],
      ]);
      o.roll = trk(t, [
        [0.08, 0],
        [0.34, PI * 0.95, easeIn],
        [0.4, PI],
      ]);
      o.squash = trk(t, [
        [0, -0.3],
        [0.34, -0.1],
        [0.38, 0.35],
        [0.5, 0.1],
        [0.7, 0.1],
        [0.84, 0.45],
      ]);
      o.splay = trk(t, [
        [0.1, 0],
        [0.36, 1],
      ]);
      o.kick = t > 0.4 && t < 0.66 ? (t - 0.4) * 36 : 0;
      o.throat = trk(t, [
        [0, 0.6],
        [0.4, 0.8],
        [0.84, 0],
      ]);
      o.blink = t > 0.4 ? 1 : 0;
      break;
    }
  }
  return o;
}

const FROG = kindOf(34, 26, 17, 17, 900);
const frogPic = (anim: string, f: number, d: number): Pic =>
  draw(FROG, frogRig(frogPose(anim, f), yawN(d)));

registerMobPainter('f5_frog', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = pose.t;
  const now = pose.now || 0;
  const tech = md === 'windup' || md === 'recover' || md === 'aim';
  const v = visOf(m, pose, tech ? (m.face ?? 0) : headOf(m), 14);
  const d = dirN(v.yaw);
  const ex: Partial<MobFrame> = { shadow: 6 };
  let anim = 'idle';
  let f = 0;
  let dark = 0;
  const id = m.id ?? 0;
  if (md === 'dying') {
    f = fi(t, 19);
    anim = 'die';
    ex.linger = 0.85;
    // Подскок на переворот — дугой над тенью.
    const k = clamp01((t - 0.04) / 0.34);
    ex.dy = -Math.sin(PI * k) * 7;
    ex.shadow = 6 - Math.sin(PI * k) * 2;
    ex.alpha = 1 - sstep(0.68, 0.85, t);
    ex.still = true;
  } else if (md === 'aim') {
    f = fi(t, 16);
    anim = 'aim';
    ex.still = true;
  } else if (md === 'windup') {
    f = fi(t, 9);
    anim = 'bite';
    ex.still = true;
  } else if (md === 'recover') {
    f = fi(t, 19);
    anim = v.prev === 'aim' ? 'lashf' : 'bitef';
    if (anim === 'lashf' && f === 0) {
      ex.sx = 1.06;
      ex.sy = 0.95;
    }
    ex.still = true;
  } else if (md === 'f5_born') {
    const k = clamp01(t / 0.8);
    f = Math.floor(((t * 9 + id) / TAU) * 16) % 16;
    anim = 'hop';
    dark = 3 - Math.min(3, Math.floor(k * 4));
    const [wx, wy] = wallDir(m);
    const off = (1 - easeOut(k)) * 9;
    ex.dx = wx * off;
    ex.dy = wy * off;
    ex.alpha = 0.35 + 0.65 * k;
  } else if (md === 'sleep') {
    f = Math.floor(now * 1.2 + hash(id, 3)) % 2;
    anim = 'sleep';
  } else if (md === 'stun' || pose.anim === 'hurt') {
    f = fi(md === 'stun' ? t : now - v.hit, 4);
    anim = 'flinch';
  } else if (md === 'chase' && moving(m, 0.2)) {
    // Фаза прыжка — та же, что у скорости мозга (`hopSpeed`).
    const ph = (((t * 9 + id) % TAU) + TAU) % TAU;
    f = Math.floor((ph / TAU) * 16) % 16;
    anim = 'hop';
    if (ph < PI) {
      ex.dy = -Math.sin(ph) * 6;
      ex.shadow = 6 - Math.sin(ph) * 2;
    }
  } else {
    f = Math.floor((now + hash(id, 7) * 4) * 6) % 8;
    anim = 'idle';
    if (md === 'alert') ex.dy = -Math.sin(PI * clamp01(t / 0.35)) * 3;
  }
  if (md !== 'dying') hurtFx(v, now, 1.4, ex);
  return { ...frameOf(FROG, anim, f, d, pose, () => frogPic(anim, f, d), dark), ...ex };
});

registerMobWarm('f5_frog', function* () {
  yield* warmAll(
    FROG,
    [
      ['hop', 16],
      ['idle', 8],
      ['aim', 17],
      ['lashf', 20],
      ['bite', 10],
      ['bitef', 20],
      ['flinch', 5],
      ['die', 20],
      ['sleep', 2],
    ],
    frogPic,
  );
});

// ---- Язык жабы: вылет (`f5_tongue_out`, 0,1 с до удара — `api.vfx` мозга) и
// втягивание (`f5_tongue`, 0,3 с от удара); оба поверх темноты, от пасти
// кадра. Липкая подушечка на конце, слюна на втягивании.

/** Точка пасти жабы на экране от середины моба (кадр аркана, сторона по углу). */
function frogMouth(a: number): [number, number] {
  const ya = yawN(dirN(a));
  const L = 6.4;
  return [Math.cos(ya) * L, Math.sin(ya) * L * SE - 3.4 * CE];
}

function tongue(
  g: CanvasRenderingContext2D,
  px: number,
  py: number,
  S: number,
  a: number,
  len: number,
  out: number,
  sag: number,
  drip: number,
): void {
  const [mx, my] = frogMouth(a);
  const x0 = px + mx;
  const y0 = py + my;
  const L = len * S * out;
  if (L < 1) return;
  const x1 = px + Math.cos(a) * L;
  const y1 = py + Math.sin(a) * L - 2.5;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2 + sag;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(x0, y0);
  g.quadraticCurveTo(cx, cy, x1, y1);
  g.strokeStyle = 'rgba(96,20,32,0.95)';
  g.lineWidth = 3.2;
  g.stroke();
  g.strokeStyle = css(FR_TONGUE, 1);
  g.lineWidth = 1.8;
  g.stroke();
  g.strokeStyle = 'rgba(255,200,214,0.85)';
  g.lineWidth = 0.7;
  g.beginPath();
  g.moveTo(x0, y0 - 0.6);
  g.quadraticCurveTo(cx, cy - 0.6, x1, y1 - 0.6);
  g.stroke();
  g.lineCap = 'butt';
  // Липкая подушечка.
  g.fillStyle = 'rgba(96,20,32,0.95)';
  g.beginPath();
  g.arc(x1, y1, 2.9, 0, TAU);
  g.fill();
  g.fillStyle = 'rgba(240,140,160,1)';
  g.beginPath();
  g.arc(x1, y1, 2.1, 0, TAU);
  g.fill();
  g.fillStyle = 'rgba(255,224,232,1)';
  g.fillRect(Math.round(x1 - 1), Math.round(y1 - 1), 1, 1);
  if (drip > 0) {
    g.fillStyle = css(hx('#e8f0ff'), 0.8 * drip);
    for (let i = 0; i < 3; i++)
      g.fillRect(
        Math.round(x1 + (i - 1) * 1.5),
        Math.round(y1 + 2 + (1 - drip) * (2 + i * 2)),
        1,
        1,
      );
  }
}

registerZonePainter('f5_tongue_out', (g, z, px, py, S) => {
  const zz = z as Zone & ZoneArt;
  const u = clamp01(zz.t / (zz.life || 0.1));
  tongue(g, px, py, S, zz.ang ?? 0, zz.len ?? 3, u ** 1.3, 0, 0);
  return true;
});

registerZonePainter('f5_tongue', (g, z, px, py, S) => {
  const zz = z as Zone & ZoneArt;
  const k = clamp01(zz.t / (zz.life || 0.3));
  // Удар — язык во всю длину; держит миг и втягивается с ускорением.
  const out = k < 0.12 ? 1 : 1 - easeIn((k - 0.12) / 0.88);
  tongue(g, px, py, S, zz.ang ?? 0, zz.len ?? 3, out, Math.sin(PI * k) * 2.5, sstep(0.1, 0.7, k));
  return true;
});

// ---------------------------------------------------------------------------
// Кролик-рогач: белый, уши розовые изнутри, золотой рог, красные глаза.
// Прыжки — по фазе мозга (`hopSpeed`, как у жабы), уши отстают. Засада в
// траве: торчат уши, рог и глаз, перед ним стебли. Замах (0,5 / 0,34 с):
// припал, рог к цели, зад поднят, лапы скребут, дрожь пружины. Рывок —
// вытянулся стрелой со шлейфом. Отдых: попал — отскок и тряска головой;
// мимо — юз на задних. В стену — рог застрял, звёзды. Смерть: подскочил,
// упал на бок, задняя лапа бьёт дважды, уши опали.
// ---------------------------------------------------------------------------

const RB_FUR = tn('#8e8276', '#c9bfb2', '#e9e1d5', '#fbf8f2');
const RB_EAR = tn('#a45e5c', '#c47670', '#d88a86', '#f0b0aa');
const RB_HORN = tn('#8a6a2c', '#c8a050', '#f0d890', '#fff6d6');
const RB_EYE = hx('#ff2a44');
const RB_NOSE = hx('#e07a80');
const RB_GRASS: RGBA[] = [hx('#26330f'), hx('#3e5218'), hx('#62782a'), hx('#8ea244')];

interface RabbitO {
  fwd: number;
  pitch: number;
  roll: number;
  squash: number;
  /** Опущен в траву / прижат к земле 0…1. */
  tuck: number;
  /** Голова носом вниз (+), вбок; шея вперёд. */
  head: number;
  hturn: number;
  neck: number;
  /** Уши назад 0…1 (прижаты), развал; каждое отдельно — подёргивание. */
  ears: number;
  earL: number;
  earR: number;
  flop: number;
  /** Задние лапы назад 0…1; передние вперёд; дрожь лап. */
  ext: number;
  reach: number;
  /** Нос дёргается; глаза закрыты. */
  nose: number;
  shut: number;
  /** Звёзды над головой (кадр) −1 — нет; блеск рога. */
  stars: number;
  glint: number;
  /** Лёжа на боку: задняя лапа бьёт (фаза). */
  kick: number;
}
const RB0: RabbitO = {
  fwd: 0,
  pitch: 0,
  roll: 0,
  squash: 0,
  tuck: 0,
  head: 0,
  hturn: 0,
  neck: 0,
  ears: 0.15,
  earL: 0,
  earR: 0,
  flop: 0,
  ext: 0,
  reach: 0,
  nose: 0,
  shut: 0,
  stars: -1,
  glint: 0,
  kick: 0,
};

/** Масштаб кролика: прежний спрайт крупнее, чем риг в единицах. */
const RBS = 1.5;

function rabbitRig(o: RabbitO, yaw: number): Rig {
  const r = new Rig();
  const B = F3.yaw(yaw).scale(RBS);
  const cs = camSide(yaw);
  const sq = o.squash;
  const zc = 2.7 - o.tuck * 1.2 - sq * 0.5;
  const C = B.at(o.fwd, 0, zc).pitch(o.pitch).roll(o.roll);
  const fur: Mat = { T: RB_FUR };
  // Корпус, бёдра, хвост-помпон.
  r.ell(C, [-0.5, 0, 0], [3.0 * (1 - sq * 0.15), 2.3 * (1 + sq * 0.1), 2.3 * (1 - sq * 0.25)], fur);
  for (const sd of [-1, 1])
    r.ell(C, [-1.6, sd * 1.35, -0.5], [1.9, 1.15, 1.6 * (1 - sq * 0.2)], {
      T: RB_FUR,
      bias: sd === cs ? 0 : -0.12,
    });
  r.ball(C.p(-3.4, 0, 0.7), 0.95 * RBS, { T: tn('#b8b0a6', '#e6e0d8', '#fbf8f2', '#ffffff') });
  // Голова: круглая, мордочка, нос, красные глаза.
  const Hd = C.at(2.5 + o.neck, 0, 1.5 - o.tuck * 0.5 - sq * 0.3)
    .turn(o.hturn)
    .pitch(o.head);
  r.ell(Hd, [0.3, 0, 0], [1.9, 1.55, 1.55], fur);
  r.ell(Hd, [1.6, 0, -0.45], [0.95, 1.0, 0.8], fur);
  r.dot(Hd.p(2.45, o.nose * 0.25, -0.3 + o.nose * 0.15), RB_NOSE, 0, 1, 0.6);
  for (const sd of [-1, 1])
    if (!o.shut) r.dot(Hd.p(1.05, sd * 1.15, 0.35), RB_EYE, 0.7, 1, 0.6);
    else r.dot(Hd.p(1.05, sd * 1.15, 0.3), RB_FUR[0], 0, 1, 0.6);
  r.eye = o.shut ? null : Hd.p(1.1, cs * 1.25, 0.35);
  // Рог: золотой, вперёд-вверх; с блеском.
  r.spike(
    Hd.p(1.0, 0, 1.15),
    Hd.v(1.0, 0, 0.9),
    3.9 * RBS,
    0.75 * RBS,
    { T: RB_HORN, spec: true, glow: o.glint * 0.6 },
    4,
    0.4,
  );
  if (o.glint > 0.3) r.dot(Hd.p(3.7, 0, 3.8), WHITE, 1, 1, 1);
  // Уши: длинные, назад и вверх; изнутри розовые; отстают в прыжке.
  for (const sd of [-1, 1]) {
    const own = sd < 0 ? o.earL : o.earR;
    const back = clamp01(o.ears + own);
    const base = Hd.p(-0.5, sd * 0.6, 1.25);
    const dir = Hd.v(
      -0.5 - back * 1.9,
      sd * (0.35 + o.flop * 1.4),
      3.0 - back * 2.1 - o.flop * 2.4,
    );
    const tip = vadd(base, dir);
    const mid = vadd(vlerp(base, tip, 0.5), Hd.v(0, sd * 0.15, 0.1));
    r.cap(base, mid, 0.62 * RBS, 0.66 * RBS, { T: RB_FUR, bias: sd === cs ? 0 : -0.1 });
    r.cap(mid, tip, 0.66 * RBS, 0.42 * RBS, { T: RB_FUR, bias: sd === cs ? 0 : -0.1 });
    r.cap(vadd(base, Hd.v(0.3, 0, 0.2)), vadd(tip, Hd.v(0.25, 0, -0.35)), 0.34 * RBS, 0.2 * RBS, {
      T: RB_EAR,
      bias: 0.1,
    });
  }
  // Лапы: передние короткие; задние — длинная стопа.
  for (const sd of [-1, 1]) {
    const legM: Mat = { T: RB_FUR, bias: sd === cs ? -0.05 : -0.2 };
    const S = C.p(1.5, sd * 0.95, -1.5);
    let F = B.p(2.1 + o.fwd * 0.5 + o.reach * 1.9, sd * 1.05, 0);
    if (o.kick > 0) F = C.p(1.8, sd * 2.4, -2.2);
    r.cap(S, F, 0.6 * RBS, 0.45 * RBS, legM);
    let heel = B.p(o.fwd - 1.5 - o.ext * 2.4, sd * 1.45, 0.35 + o.ext * 0.9);
    let toe = B.p(o.fwd + 0.5 - o.ext * 3.4, sd * 1.5, 0);
    if (o.kick > 0) {
      const w = Math.sin(o.kick) * (sd > 0 ? 1 : 0.3);
      heel = C.p(-2.4 + w * 0.6, sd * 2.0, -2.0);
      toe = C.p(-1.2 + w * 1.6, sd * 2.6, -3.4 - w * 0.6);
    }
    r.cap(C.p(-1.7, sd * 1.4, -1.2), heel, 0.95 * RBS, 0.6 * RBS, legM);
    r.cap(heel, toe, 0.6 * RBS, 0.55 * RBS, legM);
  }
  // Звёзды оглушения кружат над головой — рисует `rabbitStars` по этой точке.
  rbStarAt = o.stars >= 0 ? Hd.p(0.2, 0, 3.6) : null;
  return r;
}

let rbStarAt: V3 | null = null;
/** Звёздочки-крестики над головой оглушённого (кадр f из 8). */
function rabbitStars(f: number) {
  return (o: RigOut, P: Proj2) => {
    if (!rbStarAt) return;
    const [cx, cy] = P(rbStarAt);
    const pale = hx('#fff27a');
    for (let i = 0; i < 3; i++) {
      const a = (f / 8) * TAU + (i / 3) * TAU;
      const x = Math.round(cx + Math.cos(a) * 6);
      const y = Math.round(cy + Math.sin(a) * 6 * 0.4);
      for (const [dx, dy, c] of [
        [0, 0, WHITE],
        [-1, 0, pale],
        [1, 0, pale],
        [0, -1, pale],
        [0, 1, pale],
      ] as [number, number, RGBA][])
        if (x + dx >= 0 && y + dy >= 0 && x + dx < o.p.w && y + dy < o.p.h)
          o.p.set(x + dx, y + dy, c);
    }
  };
}

/** Прыжок по фазе мозга, как у жабы: уши отстают на четверть фазы. */
function rabbitHop(o: RabbitO, ph: number): void {
  const air = ph < PI;
  const u = air ? ph / PI : (ph - PI) / PI;
  if (air) {
    o.squash = -0.4 * Math.sin(PI * u);
    o.pitch = trk(u, [
      [0, -0.35],
      [0.5, 0],
      [1, 0.25],
    ]);
    o.ext = trk(u, [
      [0, 1],
      [0.5, 0.6],
      [0.9, 0],
    ]);
    o.reach = trk(u, [
      [0.2, -0.5],
      [0.8, 1],
    ]);
  } else {
    o.squash = trk(u, [
      [0, 0.5],
      [0.3, 0.05, easeOut],
      [0.8, 0.1],
      [1, 0.4, easeIn],
    ]);
    o.pitch = trk(u, [
      [0, 0.25],
      [0.3, 0],
      [1, -0.15],
    ]);
    o.reach = trk(u, [
      [0, 1],
      [0.3, 0],
    ]);
  }
  // Уши: в воздухе отстают назад, на приземлении хлопают вперёд.
  const lag = (((ph - 0.9) % TAU) + TAU) % TAU;
  o.ears = 0.25 + 0.45 * Math.max(0, Math.sin(lag));
  o.flop = 0.15 * Math.max(0, -Math.sin(lag));
}

function rabbitPose(anim: string, f: number): RabbitO {
  const o: RabbitO = { ...RB0 };
  switch (anim) {
    case 'idle': {
      // 8 кадров по 6 к/с: нос дёргается, уши по очереди.
      o.nose = f % 2;
      o.earL = f === 2 || f === 3 ? 0.3 : 0;
      o.earR = f === 5 ? 0.35 : 0;
      o.hturn = f >= 4 && f <= 6 ? 0.25 : 0;
      o.squash = 0.06 * Math.sin((f / 8) * TAU);
      break;
    }
    case 'hop':
      rabbitHop(o, (f / 16) * TAU);
      break;
    case 'hide': {
      // В траве: прижат, видны уши, рог и глаз; уши подёргиваются.
      o.tuck = 1;
      o.squash = 0.3;
      o.ears = 0.1;
      o.earL = f === 1 ? 0.35 : 0;
      o.earR = f === 3 ? 0.3 : 0;
      o.nose = f % 2;
      break;
    }
    case 'aim': {
      // Замах (13 кадров на всё время замаха): припал, рог к цели, зад
      // поднят, лапы скребут; последняя треть — дрожь пружины.
      const k = f / 12;
      o.tuck = trk(k, [
        [0, 0],
        [0.4, 0.7, easeOut],
      ]);
      o.head = trk(k, [
        [0, 0],
        [0.4, 0.45, easeOut],
        [0.9, 0.5],
        [1, 0.35],
      ]);
      o.pitch = trk(k, [
        [0, 0],
        [0.4, 0.22],
        [1, 0.3],
      ]);
      o.fwd = trk(k, [
        [0, 0],
        [0.6, -0.6],
        [0.95, -0.9],
        [1, 0.3, easeIn],
      ]);
      o.ears = trk(k, [
        [0, 0.2],
        [0.5, 1],
      ]);
      o.squash = trk(k, [
        [0.4, 0.2],
        [0.95, 0.45],
        [1, 0],
      ]);
      o.ext = k > 0.55 ? (f % 2) * 0.35 : 0;
      o.glint = k > 0.6 ? clamp01((k - 0.6) / 0.3) : 0;
      if (k > 0.6 && k < 0.98) o.fwd += f % 2 ? 0.12 : -0.12;
      break;
    }
    case 'charge': {
      // Рывок стрелой: вытянут, рог вперёд, задние разом толкают.
      const a = (f / 6) * TAU;
      o.squash = -0.5;
      o.head = 0.5;
      o.pitch = 0.18;
      o.ears = 1;
      o.ext = 0.5 + 0.5 * Math.sin(a);
      o.reach = 0.6 + 0.4 * Math.sin(a + PI);
      o.glint = 1;
      break;
    }
    case 'hitf': {
      // Попал (0,55 с): удар — сжался, отскок назад с подскоком, тряхнул
      // головой, сел.
      const t = f / FPS;
      o.squash = trk(t, [
        [0, 0.55],
        [0.1, -0.2],
        [0.3, 0.2],
        [0.5, 0],
      ]);
      o.fwd = trk(t, [
        [0, 0.8],
        [0.25, -1.4, easeOut],
        [0.55, -0.6],
      ]);
      o.head = trk(t, [
        [0, 0.5],
        [0.12, -0.2],
        [0.5, 0],
      ]);
      o.hturn = t > 0.22 && t < 0.42 ? 0.35 * Math.sin((t - 0.22) * 50) : 0;
      o.ears = trk(t, [
        [0, 1],
        [0.2, 0.1],
        [0.55, 0.2],
      ]);
      o.flop = t > 0.22 && t < 0.42 ? 0.3 : 0;
      o.glint = trk(t, [
        [0, 1],
        [0.2, 0],
      ]);
      break;
    }
    case 'missf': {
      // Мимо (0,55 с): юз на задних — упёрся передними, корпус назад, рог
      // вверх, встряхнулся.
      const t = f / FPS;
      o.pitch = trk(t, [
        [0, 0.18],
        [0.12, -0.35],
        [0.35, -0.1],
        [0.55, 0],
      ]);
      o.reach = trk(t, [
        [0, 0.8],
        [0.12, 1.4],
        [0.4, 0],
      ]);
      o.ext = trk(t, [
        [0, 0.6],
        [0.15, 0],
      ]);
      o.squash = trk(t, [
        [0, -0.4],
        [0.15, 0.3],
        [0.4, 0],
      ]);
      o.head = trk(t, [
        [0, 0.5],
        [0.15, -0.25],
        [0.5, 0],
      ]);
      o.ears = trk(t, [
        [0, 1],
        [0.1, 0],
        [0.3, 0.4],
        [0.55, 0.2],
      ]);
      o.flop = trk(t, [
        [0.08, 0],
        [0.15, 0.4],
        [0.35, 0],
      ]);
      break;
    }
    case 'dizzy': {
      // Рог в стене (1,1 с): упёрся, шатается, звёзды кружат.
      const a = (f / 8) * TAU;
      o.head = 0.4;
      o.fwd = 0.4;
      o.roll = 0.18 * Math.sin(a);
      o.hturn = 0.2 * Math.sin(a + 1);
      o.ears = 0.3;
      o.flop = 0.5 + 0.2 * Math.sin(a);
      o.squash = 0.15;
      o.shut = f % 4 === 0 ? 1 : 0;
      o.stars = f;
      break;
    }
    case 'flinch': {
      // Ушиб: уши торчком, отпрянул, сжался.
      const k = f / 4;
      const b = Math.sin(PI * Math.min(1, k * 1.25)) * (1 - k * 0.5);
      o.fwd = -1.2 * b;
      o.squash = 0.4 * b;
      o.ears = 0;
      o.flop = -0.2 * b;
      o.head = -0.3 * b;
      o.shut = b > 0.4 ? 1 : 0;
      break;
    }
    case 'sleep': {
      o.tuck = 0.8;
      o.squash = 0.35;
      o.ears = 1;
      o.shut = 1;
      o.head = 0.2;
      o.nose = f;
      break;
    }
    case 'die': {
      // 19 кадров: подскочил (0–3), упал на бок (4–8), задняя лапа бьёт
      // дважды (9–14), уши опали, затих.
      const t = f / FPS;
      o.squash = trk(t, [
        [0, -0.35],
        [0.15, -0.1],
        [0.3, 0.3],
        [0.4, 0],
      ]);
      o.roll = trk(t, [
        [0.1, 0],
        [0.3, 1.45, easeIn],
        [0.36, 1.3],
        [0.42, 1.4],
      ]);
      o.head = trk(t, [
        [0, -0.4],
        [0.3, 0.3],
      ]);
      o.ears = 0.2;
      o.flop = trk(t, [
        [0.2, 0],
        [0.45, 1],
      ]);
      o.kick = t > 0.38 && t < 0.62 ? 0.5 + (t - 0.38) * 52 : t >= 0.62 ? 0.5 : 0;
      o.shut = t > 0.3 ? 1 : 0;
      o.nose = 0;
      break;
    }
  }
  return o;
}

/** Стебли травы перед засадой: рисуются поверх рига. */
function rabbitGrass(f: number) {
  return (o: RigOut, P: Proj2) => {
    const [gx, gy] = P([0, 0, 0]);
    for (let i = 0; i < 15; i++) {
      const x = Math.round(gx - 10 + i * 1.4 + (hash(i, 7) - 0.5));
      const h = 4 + Math.floor(hash(i, 3) * 5);
      const lean = (hash(i, 5) - 0.5) * 2 + (f % 2 ? 0.4 : -0.2) * (i % 2 ? 1 : -1);
      const c = RB_GRASS[1 + (i % 3)];
      for (let j = 0; j < h; j++) {
        const xx = Math.round(x + (lean * j) / h);
        const yy = Math.round(gy + 1 - j);
        if (xx >= 0 && yy >= 0 && xx < o.p.w && yy < o.p.h)
          o.p.set(xx, yy, j === h - 1 ? RB_GRASS[3] : c);
      }
    }
  };
}

const RABBIT = kindOf(40, 34, 20, 24, 900);
const rabbitPic = (anim: string, f: number, d: number): Pic =>
  draw(
    RABBIT,
    rabbitRig(rabbitPose(anim, f), yawN(d)),
    anim === 'hide' ? rabbitGrass(f) : anim === 'dizzy' ? rabbitStars(f) : undefined,
  );

registerMobPainter('f5_rabbit', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = pose.t;
  const now = pose.now || 0;
  const tech = md === 'aim' || md === 'charge' || md === 'recover' || md === 'dizzy';
  const v = visOf(m, pose, tech ? (m.face ?? 0) : headOf(m), md === 'charge' ? 40 : 16);
  const d = dirN(v.yaw);
  const ex: Partial<MobFrame> = { shadow: 5 };
  let anim = 'idle';
  let f = 0;
  let dark = 0;
  const id = m.id ?? 0;
  if (md === 'dying') {
    f = fi(t, 18);
    anim = 'die';
    ex.linger = 0.8;
    const k = clamp01(t / 0.3);
    ex.dy = -Math.sin(PI * k) * 5;
    ex.alpha = 1 - sstep(0.62, 0.8, t);
    ex.still = true;
  } else if (md === 'f5_hide') {
    f = Math.floor(now * 3 + hash(id, 5) * 4) % 4;
    anim = 'hide';
    ex.shadow = 0;
  } else if (md === 'aim') {
    const T = m.data.quick ? 0.34 : 0.5;
    f = Math.min(12, Math.floor((t / T) * 12));
    anim = 'aim';
    ex.still = true;
  } else if (md === 'charge') {
    f = Math.floor(t * FPS) % 6;
    anim = 'charge';
    ex.still = true;
    ex.ghost = { every: 0.03, life: 0.16, tint: '#f4ece4', alpha: 0.35 };
  } else if (md === 'recover') {
    f = fi(t, 13);
    anim = m.data.hit ? 'hitf' : 'missf';
    ex.still = true;
  } else if (md === 'dizzy') {
    f = Math.floor(t * 10) % 8;
    anim = 'dizzy';
    ex.still = true;
    if (t < 0.12) {
      ex.sx = 0.86;
      ex.sy = 1.1;
    }
  } else if (md === 'f5_born') {
    const k = clamp01(t / 0.8);
    f = Math.floor(((t * 9 + id) / TAU) * 16) % 16;
    anim = 'hop';
    dark = 3 - Math.min(3, Math.floor(k * 4));
    const [wx, wy] = wallDir(m);
    const off = (1 - easeOut(k)) * 9;
    ex.dx = wx * off;
    ex.dy = wy * off;
    ex.alpha = 0.35 + 0.65 * k;
  } else if (md === 'sleep') {
    f = Math.floor(now * 1.3 + hash(id, 3)) % 2;
    anim = 'sleep';
  } else if (md === 'stun' || pose.anim === 'hurt') {
    f = fi(md === 'stun' ? t : now - v.hit, 4);
    anim = 'flinch';
  } else if ((md === 'chase' || md === 'hop') && moving(m, 0.2)) {
    const ph = (((t * 9 + id) % TAU) + TAU) % TAU;
    f = Math.floor((ph / TAU) * 16) % 16;
    anim = 'hop';
    if (ph < PI) {
      ex.dy = -Math.sin(ph) * 5;
      ex.shadow = 5 - Math.sin(ph) * 1.5;
    }
  } else {
    f = Math.floor((now + hash(id, 7) * 4) * 6) % 8;
    anim = 'idle';
    if (md === 'alert') ex.dy = -Math.sin(PI * clamp01(t / 0.35)) * 3;
  }
  if (md !== 'dying') hurtFx(v, now, 1.2, ex);
  return { ...frameOf(RABBIT, anim, f, d, pose, () => rabbitPic(anim, f, d), dark), ...ex };
});

registerMobWarm('f5_rabbit', function* () {
  yield* warmAll(
    RABBIT,
    [
      ['hop', 16],
      ['idle', 8],
      ['hide', 4],
      ['aim', 13],
      ['charge', 6],
      ['hitf', 14],
      ['missf', 14],
      ['dizzy', 8],
      ['flinch', 5],
      ['die', 19],
      ['sleep', 2],
    ],
    rabbitPic,
  );
});
