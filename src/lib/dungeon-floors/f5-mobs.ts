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
import { frameLRU, registerMobPainter, registerMobWarm } from '../dungeon-paint';
import type { FrameLRU, MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import { F3, Rig, SE, proj, renderRig } from './f15-rig';
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

const kindOf = (w: number, h: number, ax: number, ay: number, limit: number): Kind => ({
  w,
  h,
  ax,
  ay,
  pics: frameLRU<Pic>(Math.round(limit * 0.7)),
  frames: frameLRU<MobFrame>(limit),
});

/** Замер для стенда: цена нового кадра (мс) — последние 4000. */
export const F5_MOB_STAT = { n: 0, ms: [] as number[], max: 0, maxKey: '' };
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
