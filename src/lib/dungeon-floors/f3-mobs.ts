// Этаж 3 «Затопленная бездна» — анимации мобов (по эталону боссов 12–14 и
// монстров 15-го). Облик и механика мобов прежние, поднята анимация:
//
// - тело — мини-3D риг (`f15-rig.ts`): ход в 8 сторон, рисуются пять (восток,
//   юго-восток, юг, северо-восток, север), запад — зеркалом;
// - каждое действие — дорожка 24 к/с от времени режима (`pose.t`); подготовка
//   занимает весь замах мозга, кадр контакта — первый кадр после замаха (миг
//   урона), дальше проводка и возврат; на замахе кадр `still`;
// - вес — сжатие `sx/sy` на контакте и приземлении, откат `dx/dy`; отдача от
//   удара героя — 6 кадров по `m.kx/ky` (отброс, вжатие, возврат);
// - ход — шаг по пройденному пути, сперва поворот, потом ход; покой с фазой от
//   `m.id` (стая не дышит в такт);
// - смерть своя у каждого вида, `linger` до 0,9 с, кадров мало (12 к/с);
// - кадры — только в `frameLRU` с пределом на вид, сырые кадры (без зеркала,
//   вспышки и облика) — в общем кеше; ход и покой прогреваются заранее.
//
// Состояние рисунка (курс, путь, удар) — в `WeakMap` по мобу; в `m.data`
// рисунок не пишет. Лист кадров (`anim-sheet.mjs`) рисует каждый кадр новым
// мобом: путь там — скорость × время режима, удар героя — `data.vSheetHurt`.

import { hex, Px } from '../dungeon-art';
import { frameLRU, registerMobPainter, registerMobWarm } from '../dungeon-paint';
import type { FrameLRU, MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import { F3 as Fr, proj, renderRig, Rig, SE, vadd, vlerp, vmul, vnorm, vsub } from './f15-rig';
import type { Mat, RGBA, RigOut, Tones, V3 } from './f15-rig';

const PI = Math.PI;
const TAU = PI * 2;
const FPS = 24;
const INK: RGBA = hex('#150f0b');
const WHITE: RGBA = [255, 255, 255, 255];
const GOLD = hex('#ffcc40');

// ---------------------------------------------------------------------------
// Время и кривые.
// ---------------------------------------------------------------------------

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x: number) => {
  const k = clamp01(x);
  return k * k * (3 - 2 * k);
};
const sstep = (a: number, b: number, x: number) => smooth((x - a) / (b - a));
const easeOut = (x: number) => 1 - (1 - clamp01(x)) ** 3;
const easeIn = (x: number) => clamp01(x) ** 2;
/** Номер кадра 24 к/с от времени режима (не больше `max`). */
const fi = (t: number, max: number) => Math.min(max, Math.max(0, Math.floor(t * FPS + 1e-6)));
const tn = (a: string, b: string, c: string, d: string): Tones => [hex(a), hex(b), hex(c), hex(d)];
const angD = (a: number, b: number) => {
  let d = (a - b) % TAU;
  if (d > PI) d -= TAU;
  if (d < -PI) d += TAU;
  return d;
};
const alpha = (c: RGBA, a: number): RGBA => [c[0], c[1], c[2], Math.round(255 * clamp01(a))];

type Ease = 's' | 'o' | 'i' | 'l';
/** Ключи позы: [время, значение, кривая входа в ключ] — разгон и торможение, а не прямая. */
function kf(t: number, keys: [number, number, Ease?][]): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1, e] = keys[i];
    if (t > t1) continue;
    const [t0, v0] = keys[i - 1];
    const x = t1 > t0 ? (t - t0) / (t1 - t0) : 1;
    const k = e === 'o' ? easeOut(x) : e === 'i' ? easeIn(x) : e === 'l' ? x : smooth(x);
    return v0 + (v1 - v0) * k;
  }
  return keys[keys.length - 1][1];
}

/** Хеш для рисунка (без `sim.rng()`): 0…1. */
const rnd = (a: number, b: number, c = 0) => {
  let h = (a * 374761393 + b * 668265263 + c * 1274126177) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

// ---------------------------------------------------------------------------
// Стороны: 0 — восток, 2 — юг (к зрителю), 4 — запад, 6 — север.
// ---------------------------------------------------------------------------

const side8 = (a: number) => ((Math.round(a / (PI / 4)) % 8) + 8) % 8;
/** Какая из пяти рисуемых сторон и нужно ли зеркало. */
const BASE = [0, 1, 2, 1, 0, 7, 6, 7];
const MIRR = [false, false, false, true, true, true, false, false];
/** Игровой угол → курс рига: на экране морда смотрит точно туда же. */
const rigYaw = (a: number) => Math.atan2(Math.sin(a), SE * Math.cos(a));
const yawOfSide = (b: number) => rigYaw((b * PI) / 4);

// ---------------------------------------------------------------------------
// Состояние рисунка моба: курс с пределом поворота, путь, последний удар.
// ---------------------------------------------------------------------------

interface Vis {
  now: number;
  x: number;
  y: number;
  /** Курс рисунка (игровой угол). */
  yaw: number;
  /** Пройденный путь, клетки. */
  dist: number;
  mode: string;
  prev: string;
  /** Прошлая вспышка (рост — новый удар героя). */
  fl: number;
  /** Когда ударили (часы рендера) и куда отбросило (игровой угол). */
  hitAt: number;
  hitA: number;
}
const VIS = new WeakMap<Mob, Vis>();

const speedOf = (m: Mob) => Math.hypot(m.vx ?? 0, m.vy ?? 0);
const hitAngle = (m: Mob) =>
  Math.hypot(m.kx ?? 0, m.ky ?? 0) > 0.05 ? Math.atan2(m.ky ?? 0, m.kx ?? 0) : (m.face ?? 0) + PI;

function visOf(m: Mob, pose: MobPose, want: number, turn: number): Vis {
  const fl = m.flash ?? 0;
  let v = VIS.get(m);
  if (!v) {
    const sheetHurt = (m.data?.vSheetHurt ?? 0) > 0;
    v = {
      now: pose.now,
      x: m.x ?? 0,
      y: m.y ?? 0,
      yaw: want,
      dist: speedOf(m) * Math.max(0, pose.t) + (m.id ?? 0) * 0.37,
      mode: pose.mode,
      prev: '',
      fl,
      hitAt: sheetHurt ? pose.now - pose.t : fl > 0.001 ? pose.now - Math.max(0, 0.12 - fl) : -99,
      hitA: hitAngle(m),
    };
    VIS.set(m, v);
    return v;
  }
  const dt = Math.max(0, Math.min(0.1, pose.now - v.now));
  if (dt > 0) {
    v.dist += Math.min(Math.hypot((m.x ?? 0) - v.x, (m.y ?? 0) - v.y), 1);
    v.x = m.x ?? 0;
    v.y = m.y ?? 0;
    v.now = pose.now;
    const mx = turn * dt;
    v.yaw += Math.max(-mx, Math.min(mx, angD(want, v.yaw)));
  }
  if (fl > v.fl + 0.001) {
    v.hitAt = pose.now;
    v.hitA = hitAngle(m);
  }
  v.fl = fl;
  if (pose.mode !== v.mode) {
    v.prev = v.mode;
    v.mode = pose.mode;
  }
  return v;
}

/** Сколько секунд назад ударил герой (большое — давно). */
const hurtAge = (v: Vis, now: number) => now - v.hitAt;

/**
 * Отдача от удара героя — 6 кадров 24 к/с: отброс корпуса по `m.kx/ky`,
 * вжатие, лёгкий перелёт назад, возврат. `A` — размах отброса в точках.
 */
function recoil(v: Vis, now: number, A: number, ex: Partial<MobFrame>, sq = 0.14): number {
  const age = hurtAge(v, now);
  if (age < 0 || age >= 0.25) return -1;
  const f = Math.floor(age * FPS);
  const push = [1, 0.8, 0.45, 0.1, -0.15, -0.06][f] ?? 0;
  const squash = [1, 0.7, 0.25, -0.2, -0.1, 0][f] ?? 0;
  ex.dx = (ex.dx ?? 0) + Math.cos(v.hitA) * A * push;
  ex.dy = (ex.dy ?? 0) + Math.sin(v.hitA) * A * push * 0.7;
  ex.sx = (ex.sx ?? 1) * (1 + sq * squash);
  ex.sy = (ex.sy ?? 1) * (1 - sq * squash);
  return f;
}

// ---------------------------------------------------------------------------
// Кадры: сырой рисунок (риг стороны) → зеркало, облик, вспышка → холст.
// ---------------------------------------------------------------------------

interface Pic {
  p: Px;
  lit: Px | null;
  ax: number;
  ay: number;
  eye: [number, number] | null;
}

/** Сырые кадры всех видов: вспышка, облик и зеркало строятся из них дёшево. */
const RAWS = frameLRU<Pic>(900);
const LRU = new Map<string, FrameLRU<MobFrame>>();
const lruOf = (kind: string, limit: number) => {
  let c = LRU.get(kind);
  if (!c) LRU.set(kind, (c = frameLRU<MobFrame>(limit)));
  return c;
};

/** Замер для стенда: сколько новых кадров и почём (мс). */
export const F3_MOB_STAT = {
  n: 0,
  ms: 0,
  max: 0,
  maxKey: '',
  last: [] as number[],
  size: () => [...LRU.values()].reduce((s, c) => s + c.size, 0),
  raws: () => RAWS.size,
};

function pale(src: Px): Px {
  const o = new Px(src.w, src.h);
  const d = src.data;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    const l = (d[i] + d[i + 1] + d[i + 2]) / 3;
    o.data[i] = l * 0.5 + 244 * 0.5;
    o.data[i + 1] = l * 0.5 + 236 * 0.5;
    o.data[i + 2] = l * 0.5 + 228 * 0.5;
    o.data[i + 3] = d[i + 3];
  }
  return o;
}

function finish(raw: Pic, mir: boolean, flash: boolean, look: MobPose['look']): MobFrame {
  let p = raw.p;
  let lit = raw.lit;
  if (look === 'albino') p = pale(p);
  if (look === 'elite') {
    const o = new Px(p.w, p.h);
    o.data.set(p.data);
    o.outline(GOLD);
    p = o;
  }
  if (mir) {
    p = p.flipX();
    lit = lit ? lit.flipX() : null;
  }
  if (flash) p = p.tint(WHITE, 0.85);
  const ax = mir ? p.w - raw.ax : raw.ax;
  const eye: [number, number] | null = raw.eye
    ? [mir ? p.w - 1 - raw.eye[0] : raw.eye[0], raw.eye[1]]
    : null;
  return { img: p.canvas(), ax, ay: raw.ay, eye, lit: lit ? lit.canvas() : null };
}

/**
 * Кадр из кеша: `key` — поза (действие и номер кадра), `d` — сторона 0…7.
 * Рисуется сторона из пяти (`BASE`), запад — зеркалом. `extra` — поля хода
 * кадра (сдвиг, сжатие, тень, шлейф, долгая смерть).
 */
function frameOf(
  kind: string,
  limit: number,
  key: string,
  d: number,
  pose: MobPose,
  build: (yaw: number) => Pic,
  extra?: Partial<MobFrame> | null,
): MobFrame {
  const b = BASE[d];
  const mir = MIRR[d];
  const lru = lruOf(kind, limit);
  const fk = `${key}|${b}${mir ? 'm' : ''}|${pose.flash ? 1 : 0}${pose.look[0]}`;
  let fr = lru.get(fk);
  if (!fr) {
    const t0 = performance.now();
    const rk = `${kind}|${key}|${b}`;
    let raw = RAWS.get(rk);
    if (!raw) raw = RAWS.set(rk, build(yawOfSide(b)));
    fr = lru.set(fk, finish(raw, mir, pose.flash, pose.look));
    const ms = performance.now() - t0;
    F3_MOB_STAT.n++;
    F3_MOB_STAT.ms += ms;
    F3_MOB_STAT.last.push(ms);
    if (F3_MOB_STAT.last.length > 4000) F3_MOB_STAT.last.splice(0, 2000);
    if (ms > F3_MOB_STAT.max) {
      F3_MOB_STAT.max = ms;
      F3_MOB_STAT.maxKey = `${kind}|${fk}`;
    }
  }
  return extra ? { ...fr, ...extra } : fr;
}

/** Поза для прогрева: без вспышки, обычный облик. */
const warmPose = (mode: string): MobPose => ({
  anim: 'idle',
  frame: 0,
  mode,
  t: 0,
  left: false,
  flash: false,
  look: 'normal',
  now: 0,
});

type Proj2 = (v: V3) => [number, number];

/** Нарисовать риг на холст и дорисовать поверх (`post` — след, искры, пыль). */
function draw(
  r: Rig,
  w: number,
  h: number,
  ax: number,
  ay: number,
  post?: ((o: RigOut, P: Proj2) => void) | null,
): Pic {
  const o = renderRig(r, w, h, ax, ay, { outline: INK });
  if (post)
    post(o, (v) => {
      const q = proj(v, ax, ay);
      return [q[0], q[1]];
    });
  return { p: o.p, lit: o.lit, ax, ay, eye: o.eye };
}

const litOn = (o: RigOut): Px => (o.lit ??= new Px(o.p.w, o.p.h));

/** Точка с прозрачностью — поверх того, что есть. */
function dotA(p: Px, x: number, y: number, c: RGBA, a: number): void {
  if (a <= 0.02) return;
  p.set(Math.round(x), Math.round(y), alpha(c, a));
}

/**
 * Серп следа по точкам пути (экранные): голова яркая, хвост гаснет;
 * толщина `w` (1–2 точки). Рисуется в слой поверх темноты и тускло в тело.
 */
function smear(o: RigOut, pts: [number, number][], c: RGBA, a0: number, w = 2): void {
  if (pts.length < 2) return;
  const lit = litOn(o);
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
    for (let s = 0; s <= n; s++) {
      const k = (i + s / n) / (pts.length - 1);
      const x = x0 + ((x1 - x0) * s) / n;
      const y = y0 + ((y1 - y0) * s) / n;
      const a = a0 * (0.25 + 0.75 * k);
      dotA(lit, x, y, c, a);
      if (w > 1) dotA(lit, x, y + 1, c, a * 0.6);
    }
  }
}

/** Звёзды над головой оглушённого: две точки по кругу, фаза `ph`. */
function stars(o: RigOut, cx: number, cy: number, ph: number, rx = 4): void {
  const lit = litOn(o);
  for (let i = 0; i < 3; i++) {
    const a = ph * TAU + (i * TAU) / 3;
    const x = cx + Math.cos(a) * rx;
    const y = cy + Math.sin(a) * rx * 0.4;
    const c: RGBA = i === 0 ? [255, 240, 140, 255] : [255, 250, 210, 230];
    lit.set(Math.round(x), Math.round(y), c);
    if (Math.sin(a) > 0) lit.set(Math.round(x), Math.round(y) - 1, alpha(c, 0.5));
  }
}

/** Пыль и крошки у ног: `k` 0…1 — разлёт, `n` — сколько. */
function dust(
  o: RigOut,
  cx: number,
  cy: number,
  k: number,
  n: number,
  seed: number,
  c: RGBA,
  R = 7,
): void {
  if (k <= 0 || k >= 1) return;
  for (let i = 0; i < n; i++) {
    const a = PI + (rnd(seed, i, 1) - 0.5) * PI * 1.6 + (i % 2 ? 0 : PI);
    const sp = 0.5 + rnd(seed, i, 2) * 0.6;
    const r = R * sp * easeOut(k);
    const up = Math.sin(k * PI) * 3 * rnd(seed, i, 3);
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r * 0.45 - up;
    dotA(o.p, x, y, c, (1 - k) * 0.9);
  }
}

// ---------------------------------------------------------------------------
// Друзовый краб: индиговый панцирь, на спине — фиолетовая друза (светится).
// Курс — щит мозга (`m.face` = `data.sh`, поворот не быстрее 1,9 рад/с): игрок
// обязан видеть, куда смотрит панцирь. Ноги идут по пройденному пути вдоль
// хода; краб — единственный, кто может переступать вбок (так устроен его
// щит: разворачивается медленно — заходи сбоку).
// Замах 0,65 с: клешня вверх и назад → задержка на пике (дрожит, друза
// наливается) → взвод ещё дальше, присел → удар в землю (след-серп) →
// контакт (кадр урона): сжатие, пыль и искры друзы → клешня застряла:
// два рывка → выдернул с комьями → щит.
// ---------------------------------------------------------------------------

const C_SHELL = tn('#1a1430', '#2e2654', '#4a3f80', '#7064b0');
const C_CLAW = tn('#3a3264', '#5c5498', '#8c84c8', '#c4bcf0');
const C_XTAL = tn('#6a34c0', '#a070f4', '#d4b4ff', '#fbf2ff');
const C_XDEAD = tn('#2a2438', '#3e3650', '#5a5070', '#7a7090');
const C_LEG = tn('#1a1428', '#2a2240', '#3e3260', '#55487a');
const C_EYE = hex('#e2ccff');
const C_STALK = tn('#211a33', '#3a2e58', '#50427a', '#6a5a96');
const C_DUST: RGBA = hex('#8a7c9a');
const C_SPARK: RGBA = hex('#e8d8ff');

interface CrabO {
  /** Фаза шага 0…1 и его размах 0…1. */
  ph: number;
  str: number;
  /** Ход вдоль корпуса (0) или вбок (1). */
  side: number;
  fwd: number;
  /** Высота корпуса (минус — присел). */
  h: number;
  pitch: number;
  roll: number;
  /** Большая клешня: угол подъёма (рад, 0 — вперёд, π/2 — вверх), раскрытие. */
  bigE: number;
  bigO: number;
  /** Длина большой руки (замах — вытянута вверх). */
  bigR: number;
  /** Малая клешня: угол и раскрытие. */
  smE: number;
  smO: number;
  /** Свечение друзы 0…1. */
  glow: number;
  /** Глаза на стебельках подняты 0…1. */
  eyes: number;
  /** Ноги поджаты (сон, смерть) 0…1. */
  tuck: number;
  /** Смерть 0…1. */
  dk: number;
}

const CRAB0: CrabO = {
  ph: 0,
  str: 0,
  side: 0,
  fwd: 0,
  h: 0,
  pitch: 0,
  roll: 0,
  bigE: 0.8,
  bigO: 0.15,
  bigR: 4.2,
  smE: 0.75,
  smO: 0.1,
  glow: 0.3,
  eyes: 1,
  tuck: 0,
  dk: 0,
};

/** Клешня: плечо → локоть → ладонь, два пальца с щелью; `e` — подъём, `R` — длина. */
function crabClaw(
  r: Rig,
  sh: Fr,
  side: number,
  e: number,
  open: number,
  R: number,
  mat: Mat,
  tip: Mat,
  big: boolean,
): V3 {
  const s0 = sh.p(2.4, side * 3.1, big ? 0.2 : -0.4);
  const ce = Math.cos(e);
  const se = Math.sin(e);
  // Направление руки в рамке корпуса: вперёд-вверх по углу, чуть наружу.
  const d = vnorm(sh.v(ce, side * 0.32 * Math.max(0, ce), se));
  const n = vnorm(sh.v(-se, 0, ce));
  const out = sh.v(0, side, 0);
  const elbow = vadd(vadd(s0, vmul(d, R * 0.48)), vadd(vmul(out, 1.1), vmul(n, -0.9)));
  const palm = vadd(s0, vmul(d, R));
  r.cap(s0, elbow, big ? 1.1 : 0.8, big ? 1.0 : 0.7, mat);
  r.cap(elbow, palm, big ? 1.0 : 0.7, big ? 1.4 : 1.0, mat);
  // Ладонь — объёмная, пинцет — два толстых пальца с щелью: клешня читается
  // и в шестнадцати точках, большая почти с панцирь.
  const s1 = vnorm(sh.v(0, side, 0));
  const pf = new Fr(vadd(palm, vmul(d, big ? 1.3 : 0.9)), d, s1, n);
  r.ell(pf, [0, 0, 0], big ? [2.5, 1.7, 2.1] : [1.7, 1.15, 1.35], mat);
  const pt = pf.p(big ? 1.9 : 1.3, 0, 0);
  const fl = big ? 3.6 : 2.4;
  const a1 = 0.16 + open * 0.6;
  const a2 = -0.1 - open * 0.45;
  const f1 = vadd(pt, vmul(vadd(vmul(d, Math.cos(a1)), vmul(n, Math.sin(a1))), fl));
  const f2 = vadd(pt, vmul(vadd(vmul(d, Math.cos(a2)), vmul(n, Math.sin(a2))), fl * 0.85));
  r.cap(pf.p(1.0, 0, 0.6), f1, big ? 1.3 : 0.85, 0.5, tip);
  r.cap(pf.p(1.0, 0, -0.6), f2, big ? 1.15 : 0.8, 0.45, mat);
  return pt;
}

function crabRig(o: CrabO, yaw: number, gaitA = 0): Rig {
  const r = new Rig();
  const B = Fr.yaw(yaw);
  const H = 3.3 + o.h - o.tuck * 1.3;
  const sh = B.at(o.fwd, 0, H).pitch(o.pitch).roll(o.roll);
  const dead = o.dk > 0;
  // Панцирь: светлая кромка по низу, две бороздки, тёмные пятна.
  r.ell(sh, [0, 0, 0], [4.4, 5.5, 2.5], {
    T: C_SHELL,
    pat: (q, l) => {
      if (q[2] < 0.12 && q[2] > -0.28 && q[0] > -0.4) return C_SHELL[l > 0.2 ? 3 : 2];
      if (Math.abs(Math.abs(q[1]) - 0.42) < 0.07 && q[2] > 0.2) return C_SHELL[0];
      return null;
    },
  });
  // Друза: призмы вверх-назад; свечение — слой поверх темноты.
  const xm: Mat = dead
    ? { T: C_XDEAD, spec: false }
    : { T: C_XTAL, spec: true, bias: 0.25, glow: 0.35 + 0.55 * o.glow };
  const shardK = 1 - o.dk * 0.5;
  r.spike(sh.p(-0.6, 0.1, 1.8), sh.v(-0.15, 0, 1), 7.0 * shardK, 1.6, xm, 4, 0.3);
  r.spike(sh.p(-1.6, -2.0, 1.4), sh.v(-0.35, -0.5, 1), 5.0 * shardK, 1.3, xm, 4, 0.8);
  r.spike(sh.p(-1.2, 2.1, 1.5), sh.v(-0.25, 0.55, 1), 5.6 * shardK, 1.4, xm, 4, 0.1);
  r.spike(sh.p(0.9, 1.1, 1.8), sh.v(0.3, 0.2, 1), 3.6 * shardK, 1.1, xm, 4, 0.5);
  r.spike(sh.p(-2.6, 0.5, 1.2), sh.v(-0.8, 0.1, 1), 3.8 * shardK, 1.15, xm, 4, 1.1);
  // Глаза на стебельках.
  for (const s of [-1, 1]) {
    const base = sh.p(3.1, s * 1.15, 1.1);
    const top = sh.p(3.4 + (1 - o.eyes) * 0.4, s * 1.35, 1.1 + 0.4 + 2.0 * o.eyes);
    r.cap(base, top, 0.5, 0.45, { T: C_STALK });
    r.ball(top, 0.78, { T: tn('#6a5a96', '#a898d0', '#e2ccff', '#ffffff'), glow: dead ? 0 : 0.4 });
    if (s > 0 && !dead) r.eye = top;
  }
  // Ноги: по три с боку, суставом вверх; треногой через одну. Шаг — вдоль
  // хода (`side` 0 — по корпусу, 1 — вбок), фаза — по пройденному пути.
  const ga = gaitA;
  const gf = Math.cos(ga) * (1 - o.side) + 0 * o.side;
  const gs = Math.sin(ga) * (1 - o.side) + o.side;
  const legs: [number, number][] = [
    [1.9, 0],
    [0.2, 0.5],
    [-1.5, 0],
  ];
  for (const s of [-1, 1])
    legs.forEach(([fx, off], i) => {
      const phase = (o.ph + off + (s > 0 ? 0.5 : 0)) % 1;
      const sw = -Math.cos(phase * TAU) * 1.7 * o.str;
      const up = Math.max(0, Math.sin(phase * TAU)) * 1.5 * o.str;
      const hip = sh.p(fx, s * 4.4, -0.7);
      let foot = B.p(o.fwd + fx * 1.25 + sw * gf, s * (7.6 + i * 0.25) + sw * gs, up);
      const curl = Math.max(o.tuck, o.dk);
      if (curl > 0) foot = vlerp(foot, sh.p(fx * 0.8, s * 3.2, -1.6), curl);
      const knee = vadd(vlerp(hip, foot, 0.42), [0, 0, 2.1 - curl * 1.2]);
      const kneeO = vadd(knee, B.v(0, s * 0.9, 0));
      const lm: Mat = { T: C_LEG, bias: i === 1 ? 0 : -0.05 };
      r.cap(hip, kneeO, 0.85, 0.7, lm);
      r.cap(kneeO, foot, 0.7, 0.4, lm);
    });
  // Клешни: большая справа, малая слева.
  const cm: Mat = { T: C_CLAW };
  const ct: Mat = { T: C_CLAW, bias: 0.15 };
  crabClaw(r, sh, 1, o.bigE, o.bigO, o.bigR, cm, ct, true);
  crabClaw(r, sh, -1, o.smE, o.smO, 3.6, cm, ct, false);
  return r;
}

const CW = 36;
const CH = 34;
const CAX = 18;
const CAY = 24;

/** Где ладонь большой клешни на экране (для следа удара). */
function crabPalmPx(o: CrabO, yaw: number, e: number): [number, number] {
  const B = Fr.yaw(yaw);
  const sh = B.at(o.fwd, 0, 3.3 + o.h - o.tuck * 1.3)
    .pitch(o.pitch)
    .roll(o.roll);
  const s0 = sh.p(2.4, 3.1, 0.2);
  const d = vnorm(sh.v(Math.cos(e), 0.32 * Math.max(0, Math.cos(e)), Math.sin(e)));
  const q = proj(vadd(s0, vmul(d, o.bigR + 3.2)), CAX, CAY);
  return [q[0], q[1]];
}

function crabPic(
  o: CrabO,
  yaw: number,
  gaitA: number,
  post?: ((o: RigOut, P: Proj2) => void) | null,
): Pic {
  return draw(crabRig(o, yaw, gaitA), CW, CH, CAX, CAY, post);
}

/** Сколько ключей у краба: ход 8 × 2 оси × щит 2, покой 8 × 2, замах 16, удар 22, … × 8 сторон. */
const CRAB_LIM = 900;

/** Замах: поза на время `t` (0…0,65). */
function crabWind(t: number, o: CrabO): void {
  o.bigE = kf(t, [
    [0, 0.8],
    [0.2, 1.6, 'o'],
    [0.44, 1.68],
    [0.56, 2.1, 'i'],
    [0.6, 1.55, 'i'],
    [0.65, 0.3, 'l'],
  ]);
  o.bigR = kf(t, [
    [0, 4.2],
    [0.2, 6.6, 'o'],
    [0.56, 6.8],
    [0.65, 5.4],
  ]);
  o.bigO = kf(t, [
    [0, 0.15],
    [0.18, 1],
    [0.56, 1],
    [0.62, 0.55],
  ]);
  o.smE = kf(t, [
    [0, 0.75],
    [0.2, 0.55],
    [0.56, 0.45],
  ]);
  o.smO = kf(t, [
    [0, 0.1],
    [0.2, 0.6],
  ]);
  o.pitch = kf(t, [
    [0, 0],
    [0.2, -0.16, 'o'],
    [0.44, -0.18],
    [0.56, -0.28, 'i'],
    [0.65, 0.12, 'i'],
  ]);
  o.h = kf(t, [
    [0, 0],
    [0.2, 0.3, 'o'],
    [0.44, 0.2],
    [0.56, -0.7, 'i'],
    [0.65, -0.4],
  ]);
  o.fwd = kf(t, [
    [0, 0],
    [0.56, -1.1],
    [0.65, 0.9, 'i'],
  ]);
  o.glow = kf(t, [
    [0, 0.3],
    [0.44, 0.9],
    [0.56, 1],
  ]);
  o.eyes = kf(t, [
    [0, 1],
    [0.2, 0.75],
  ]);
  // Задержка на пике: клешня дрожит через кадр — видно, что сейчас ударит.
  if (t > 0.22 && t < 0.54) o.bigE += (Math.floor(t * FPS) % 2 ? 0.07 : -0.05) * sstep(0.2, 0.3, t);
}

/** Клешня в земле: поза на время `t` режима `recover` (0…1,05). */
function crabStuck(t: number, o: CrabO): void {
  // Два рывка: корпус откидывается, клешня ходит в земле.
  const tug = (c: number) => Math.max(0, 1 - Math.abs(t - c) / 0.09);
  const pull = tug(0.36) + tug(0.6) * 1.2;
  o.bigE = kf(t, [
    [0, -0.6],
    [0.06, -0.66, 'o'],
    [0.14, -0.6],
    [0.74, -0.58],
    [0.84, 0.45, 'o'],
    [1.05, 0.8],
  ]);
  o.bigE += pull * 0.08;
  o.bigR = kf(t, [
    [0, 5.4],
    [0.74, 5.4],
    [1.05, 4.2],
  ]);
  o.bigO = kf(t, [
    [0, 0.2],
    [0.74, 0.2],
    [0.84, 0.7],
    [1.05, 0.15],
  ]);
  o.smE = kf(t, [
    [0, 0.3],
    [0.12, 0.6],
    [0.8, 0.6],
    [1.05, 0.75],
  ]);
  o.smO = kf(t, [
    [0, 0.7],
    [0.2, 0.3],
    [1.05, 0.1],
  ]);
  o.pitch =
    kf(t, [
      [0, 0.2],
      [0.12, 0.08, 'o'],
      [0.74, 0.06],
      [0.8, -0.16, 'o'],
      [1.05, 0],
    ]) -
    pull * 0.12;
  o.h = kf(t, [
    [0, -0.9],
    [0.1, -0.2, 'o'],
    [0.74, -0.3],
    [0.84, 0.2],
    [1.05, 0],
  ]);
  o.fwd =
    kf(t, [
      [0, 1.2],
      [0.12, 0.6],
      [0.74, 0.6],
      [0.84, -0.6, 'o'],
      [1.05, 0],
    ]) -
    pull * 0.6;
  o.glow = kf(t, [
    [0, 1],
    [0.3, 0.5],
    [1.05, 0.3],
  ]);
  o.roll = pull * 0.08;
  // Лапы скребут, пока тянет.
  o.ph = (t * 3) % 1;
  o.str = 0.35 * sstep(0.2, 0.3, t) * (1 - sstep(0.72, 0.8, t));
  o.side = 0;
}

registerMobPainter('f3_crab', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = Math.max(0, pose.t);
  const now = pose.now;
  const id = m.id ?? 0;
  const face = m.face ?? 0;
  const v = visOf(m, pose, face, 99);
  const d = side8(v.yaw);
  const yawB = yawOfSide(BASE[d]);
  const guard = (m.data?.ghost ?? 0) > 0;
  const o: CrabO = { ...CRAB0 };
  const ex: Partial<MobFrame> = { shadow: 8, still: true };
  let key: string;
  let gaitA = 0;
  let post: ((r: RigOut, P: Proj2) => void) | null = null;
  if (md === 'dying') {
    // Смерть: лапы подгибаются, корпус оседает, друза гаснет и трескается,
    // клешни падают; 12 к/с, копия держится 0,85 с.
    const T = 0.85;
    const f = Math.min(9, Math.floor(t * 12));
    const k = f / 9;
    o.dk = sstep(0, 0.5, k);
    o.h = -1.6 * easeIn(k / 0.45) + (k > 0.45 && k < 0.6 ? 0.4 : 0);
    o.pitch = 0.18 * sstep(0, 0.4, k);
    o.roll = 0.22 * sstep(0.2, 0.6, k);
    o.bigE = kf(k, [
      [0, 1.4],
      [0.15, 1.9, 'o'],
      [0.6, -0.5, 'i'],
    ]);
    o.bigO = 0.9 * (1 - k);
    o.smE = kf(k, [
      [0, 1.2],
      [0.6, -0.3, 'i'],
    ]);
    o.eyes = 1 - sstep(0.1, 0.6, k);
    o.glow = 1 - k;
    key = `die${f}`;
    ex.linger = T;
    ex.alpha = 1 - sstep(0.62, 0.85, t);
    ex.shadow = 8 * (1 - sstep(0.6, 0.85, t));
    if (f <= 3) {
      const ff = f;
      post = (out, P) => {
        // Друза лопается: осколки-искры вверх.
        const [cx, cy] = P([0, 0, 6]);
        const lit = litOn(out);
        for (let i = 0; i < 6; i++) {
          const a = -PI / 2 + (rnd(i, 7) - 0.5) * 2.4;
          const rr = 2 + ff * 2.2 * (0.6 + rnd(i, 9));
          dotA(lit, cx + Math.cos(a) * rr, cy + Math.sin(a) * rr + ff * ff * 0.4, C_SPARK, 1 - ff / 4);
        }
      };
    }
  } else if (md === 'windup') {
    const f = fi(t, 15);
    const tt = (f + 0.5) / FPS;
    crabWind(tt, o);
    key = `wind${f}`;
    if (f >= 14) {
      // Удар: серп следа клешни сверху-сзади вперёд-вниз.
      const e0 = 2.1;
      const e1 = o.bigE;
      const oo = { ...o };
      post = (out) => {
        const pts: [number, number][] = [];
        for (let i = 0; i <= 6; i++) pts.push(crabPalmPx(oo, yawB, e0 + ((e1 - e0) * i) / 6));
        smear(out, pts, [214, 196, 255, 255], f === 15 ? 0.95 : 0.6);
      };
    }
  } else if (md === 'recover') {
    // Кадр 0 — контакт (миг урона): клешня в земле, корпус вжат.
    const f = t < 0.2 ? fi(t, 4) : 5 + Math.min(16, Math.floor((t - 0.2) * 20));
    const tt = f < 5 ? (f + 0.5) / FPS : 0.2 + (f - 5 + 0.5) / 20;
    crabStuck(tt, o);
    key = `stuck${f}`;
    if (f < 4) {
      const q = 1 - f / 4;
      ex.sx = 1 + 0.13 * q;
      ex.sy = 1 - 0.13 * q;
      ex.dy = f === 0 ? 0.6 : 0;
      const ff = f;
      const oo = { ...o };
      post = (out) => {
        const [px, py] = crabPalmPx(oo, yawB, oo.bigE);
        dust(out, px, py + 1, (ff + 0.6) / 5, 9, 31, C_DUST, 8);
        const lit = litOn(out);
        // Искры друзы на контакте.
        if (ff <= 1)
          for (let i = 0; i < 5; i++) {
            const a = -PI / 2 + (rnd(i, 3) - 0.5) * 2.6;
            const rr = 2 + ff * 3 + rnd(i, 4) * 2;
            dotA(lit, px + Math.cos(a) * rr, py + Math.sin(a) * rr * 0.7, C_SPARK, 1 - ff * 0.4);
          }
      };
    } else if (f >= 16 && f <= 18) {
      // Выдернул: комья земли с клешни.
      const ff = f - 16;
      const oo = { ...o };
      post = (out) => {
        const [px, py] = crabPalmPx(oo, yawB, oo.bigE);
        for (let i = 0; i < 4; i++)
          dotA(
            out.p,
            px + (rnd(i, 5) - 0.5) * 6,
            py + 2 + ff * 1.5 + rnd(i, 6) * 2,
            C_DUST,
            1 - ff * 0.3,
          );
      };
    }
  } else if (md === 'stun') {
    // Оглушён (тяжёлый удар): откинулся, клешни врозь, глаза поджал.
    const f = fi(t, 5);
    const k = f / 5;
    o.pitch = -0.3 * (1 - k);
    o.h = -0.6 * (1 - k);
    o.bigE = 1.9 - 0.75 * k;
    o.bigO = 1 - k;
    o.smE = 1.5 - 0.55 * k;
    o.smO = 1 - k;
    o.eyes = 0.3 + 0.7 * k;
    o.roll = (f % 2 ? 0.06 : -0.06) * (1 - k);
    key = `stun${f}`;
  } else if (md === 'sleep') {
    // Спит: поджал лапы, глаза спрятал, друза тлеет.
    const f = Math.floor(now * 1.5 + id * 0.7) % 2;
    o.tuck = 1;
    o.eyes = 0;
    o.glow = f ? 0.15 : 0.05;
    o.bigE = 0.1;
    o.smE = 0.05;
    key = `sleep${f}`;
  } else if (md === 'alert') {
    // Проснулся: подскочил, глаза вверх, клешни — щитом.
    const f = fi(t, 8);
    const k = f / 8;
    o.tuck = 1 - easeOut(k / 0.5);
    o.eyes = easeOut(k / 0.4);
    o.h = Math.sin(k * PI) * 0.8;
    o.bigE = 0.1 + 1.05 * easeOut(k);
    o.smE = 0.05 + 0.9 * easeOut(k);
    o.glow = 0.05 + 0.5 * k;
    key = `alert${f}`;
  } else {
    // Ход и покой. Щит — клешни торчком перед мордой, пока герой спереди.
    const sp = speedOf(m);
    const moving = sp > 0.3;
    if (!guard) {
      o.bigE = 0.45;
      o.smE = 0.3;
      o.bigO = 0.25;
    }
    if (moving) {
      // Шаг по пути: полный круг лап — 0,6 клетки.
      const travel = Math.atan2(m.vy ?? 0, m.vx ?? 0);
      const rel = angD(rigYaw(travel), yawB);
      const q = ((Math.round(rel / (PI / 2)) % 4) + 4) % 4;
      const sideways = q % 2 === 1;
      let dirSign = q === 0 || q === 1 ? 1 : -1;
      if (sideways && MIRR[d]) dirSign = -dirSign;
      let f = Math.floor((v.dist / 0.6) * 8) % 8;
      if (dirSign < 0) f = (8 - f) % 8;
      o.ph = f / 8;
      o.str = 1;
      o.side = sideways ? 1 : 0;
      o.h = Math.abs(Math.sin(o.ph * TAU * 2)) * 0.35;
      o.roll = sideways ? 0 : Math.sin(o.ph * TAU) * 0.05;
      o.bigE += Math.sin(o.ph * TAU) * 0.06;
      key = `walk${sideways ? 's' : 'f'}${guard ? 'g' : ''}${f}`;
      gaitA = 0;
    } else {
      // Покой: дышит, друза мерцает, глаз дёргается; фаза — от номера.
      const f = Math.floor(now * 5 + id * 2.3) % 8;
      o.h = [0, 0.15, 0.3, 0.35, 0.3, 0.15, 0, -0.05][f];
      o.glow = 0.25 + 0.15 * Math.sin((f / 8) * TAU);
      o.eyes = f === 5 ? 0.7 : 1;
      o.bigO = f >= 3 && f <= 5 ? 0.35 : o.bigO;
      key = `idle${guard ? 'g' : ''}${f}`;
    }
    // Удар героя: корпус поджат 3 кадра (в замахе и в земле — только отдача).
    const hf = Math.floor(hurtAge(v, now) * FPS);
    if (hf >= 0 && hf < 4 && !guard) {
      const q = [1, 0.75, 0.4, 0.15][hf];
      o.pitch = -0.2 * q;
      o.eyes = 1 - 0.6 * q;
      o.bigO = 0.8 * q;
      key = `hurt${hf}`;
      o.str = 0;
    }
  }
  if (md !== 'dying') recoil(v, now, 1.6, ex, 0.12);
  return frameOf('crab', CRAB_LIM, key, d, pose, (yaw) => crabPic(o, yaw, gaitA, post), ex);
});

registerMobWarm('f3_crab', function* () {
  const pose = warmPose('chase');
  for (let d = 0; d < 8; d++) {
    if (MIRR[d]) continue;
    const yaw = yawOfSide(d);
    for (const g of [true, false])
      for (let f = 0; f < 8; f++) {
        const o: CrabO = { ...CRAB0, ph: f / 8, str: 1 };
        if (!g) {
          o.bigE = 0.45;
          o.smE = 0.3;
          o.bigO = 0.25;
        }
        o.h = Math.abs(Math.sin(o.ph * TAU * 2)) * 0.35;
        o.roll = Math.sin(o.ph * TAU) * 0.05;
        o.bigE += Math.sin(o.ph * TAU) * 0.06;
        frameOf('crab', CRAB_LIM, `walkf${g ? 'g' : ''}${f}`, d, pose, () => crabPic(o, yaw, 0));
        yield 0;
      }
  }
});
