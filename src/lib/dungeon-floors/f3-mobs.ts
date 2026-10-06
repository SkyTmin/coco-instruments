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

// ---------------------------------------------------------------------------
// Пересмешник: пепельная птица с длинным хвостом и белой маской-лицом.
// Летает: тень и подъём задаёт кадр (`lift`, `still`). Курс — по ходу с
// пределом поворота. Зов (`call`) — приманка, а не атака: висит, крылья
// раскрыты вперёд, как руки, голова склонена набок, рот маски «говорит»,
// маска светится лицом в темноте, красного глаза нет. Замах (`aim` 0,6 с,
// быстрый — 0,42 с тем же треком): вздыбился вверх, крылья высоко, хвост
// веером → задержка на пике, крик, глаз загорается → взвод: голова назад,
// корпус клонится к цели, крылья складываются → пике (первый кадр `dive` —
// бросок): шлейф, вниз к герою. После пике — посадка со сжатием, одышка,
// взлёт. В стену — оглушён на земле, звёзды.
// ---------------------------------------------------------------------------

const M_FEATH = tn('#3a4652', '#66747f', '#96a2aa', '#cad2d4');
const M_FAR = tn('#232a33', '#36404b', '#505b66', '#6a7680');
const M_TIP: RGBA = hex('#141820');
const M_PALE: RGBA = hex('#d8dacd');
const M_MASK = tn('#7a725e', '#b8ae94', '#e6dec6', '#fbf5e4');
const M_HOLE: RGBA = hex('#1a1210');
const M_BEAK = tn('#1e1812', '#3a3024', '#5a4a36', '#7a6648');
const M_MOUTH = tn('#2a0c0c', '#2a0c0c', '#3a1010', '#3a1010');
const M_EYE: RGBA = hex('#ff5a3c');
const M_FEATHER_C: RGBA = hex('#9aa6ae');

interface MockO {
  /** Ближнее крыло: подъём (рад, + вверх), отвод назад (рад), сложено 0…1. */
  el: number;
  sw: number;
  fold: number;
  /** Дальнее крыло (отстаёт по фазе). */
  elFar: number;
  pitch: number;
  roll: number;
  /** Высота корпуса над точкой ног. */
  h: number;
  /** Голова: кивок (+ вниз), наклон набок. */
  hp: number;
  ht: number;
  mouth: number;
  /** Хвост: изгиб у корня и у конца (отстаёт), веер. */
  tail: number;
  tail2: number;
  fan: number;
  /** Лапы выпущены 0…1. */
  legs: number;
  /** Глаз горит 0…1; маска светится 0…1 (зов — без глаза). */
  eye: number;
  mask: number;
  /** Смерть: глаз погас. */
  dk: number;
}

const MOCK0: MockO = {
  el: 0.4,
  sw: 0.15,
  fold: 0,
  elFar: 0.4,
  pitch: 0,
  roll: 0,
  h: 3.4,
  hp: 0,
  ht: 0,
  mouth: 0,
  tail: 0,
  tail2: 0,
  fan: 0,
  legs: 0,
  eye: 0,
  mask: 0,
  dk: 0,
};

/** Крыло: плечо → запястье (кроющие), веер маховых с тёмными концами. */
function mockWing(
  r: Rig,
  body: Fr,
  side: number,
  el: number,
  sw: number,
  fold: number,
  far: boolean,
): void {
  const T = far ? M_FAR : M_FEATH;
  const sh = body.p(0.7, side * 1.4, 0.9);
  const ce = Math.cos(el);
  const se = Math.sin(el);
  // Рука крыла в рамке корпуса: наружу, вверх по `el`, назад по `sw`.
  const L = vnorm(body.v(-Math.sin(sw), side * Math.cos(sw) * ce, Math.cos(sw) * se));
  const back = body.v(-1, 0, 0);
  const arm = 3.6 * (1 - 0.35 * fold);
  const wr = vadd(sh, vmul(L, arm));
  // Маховые: от запястья наружу и назад; сложенное крыло — вдоль спины.
  const fl = (1 - 0.4 * fold) * 5.0;
  const fdir = (k: number) => vnorm(vadd(vmul(L, 1 - k), vmul(back, k + fold * 0.7)));
  const t1 = vadd(wr, vmul(fdir(0.1), fl));
  const n2 = vadd(wr, vmul(fdir(0.24), fl * 0.66));
  const t2 = vadd(wr, vmul(fdir(0.38), fl * 0.92));
  const n3 = vadd(wr, vmul(fdir(0.52), fl * 0.58));
  const t3 = vadd(wr, vmul(fdir(0.66), fl * 0.8));
  const t4 = vadd(vadd(sh, vmul(back, 2.4)), vmul(L, 1.3));
  const mat: Mat = {
    T,
    pat: (q, l) => {
      const dw = Math.hypot(q[0] - wr[0], q[1] - wr[1], q[2] - wr[2]);
      if (dw > fl * 0.7) return far ? T[0] : M_TIP;
      if (dw < 1.5 && l > 0.1) return T[3];
      return null;
    },
  };
  r.poly([vadd(sh, vmul(back, -0.5)), wr, t1, n2, t2, n3, t3, t4, vadd(sh, vmul(back, 1.7))], mat);
  r.cap(sh, wr, far ? 0.9 : 1.1, 0.75, { T, bias: 0.2 });
}

function mockRig(o: MockO, yaw: number): Rig {
  const r = new Rig();
  const B = Fr.yaw(yaw);
  const body = B.at(0, 0, o.h).pitch(o.pitch).roll(o.roll);
  // Хвост: две длинные ленты со светлыми концами; изгиб отстаёт от корпуса.
  const spread = 0.45 + o.fan * 1.4;
  for (const s of [-1, 1]) {
    const a = body.p(-2.6, s * 0.4, 0.2);
    const b = body.p(-5.8, s * spread * 0.9, -0.2 + o.tail * 1.2);
    const c = body.p(-8.8, s * spread * 1.6, -0.4 + o.tail * 1.6 + o.tail2 * 1.4);
    const tm: Mat = { T: s > 0 ? M_FEATH : M_FAR, bias: 0.1 };
    r.cap(a, b, 0.9, 0.65, tm);
    r.cap(b, c, 0.65, 0.45, tm);
    r.ball(c, 0.7, { T: [M_PALE, M_PALE, M_PALE, M_PALE], flat: 0 });
  }
  // Корпус: светлое брюхо, тёмная спина.
  r.ell(body, [0, 0, 0], [3.2, 2.0, 2.0], {
    T: M_FEATH,
    pat: (q, l) => (q[2] < -0.3 ? M_FEATH[l > 0.1 ? 3 : 2] : null),
  });
  // Лапы: сидит — до земли, летит — поджаты под брюхо.
  if (o.legs > 0.05)
    for (const s of [-1, 1]) {
      const hip = body.p(0.2, s * 0.7, -1.6);
      const foot = vlerp(body.p(-1.2, s * 0.7, -2.3), B.p(0.4, s * 0.9, 0), o.legs);
      r.cap(hip, foot, 0.5, 0.4, { T: M_BEAK });
      if (o.legs > 0.6) r.cap(foot, vadd(foot, B.v(1.1, 0, 0)), 0.35, 0.3, { T: M_BEAK });
    }
  // Крылья: дальнее темнее и отстаёт.
  mockWing(r, body, -1, o.elFar, o.sw, o.fold, true);
  mockWing(r, body, 1, o.el, o.sw, o.fold, false);
  // Голова и маска: лицо почти человеческое — глазницы, крючок клюва снизу.
  const hd = body.at(3.0, 0, 1.6).pitch(o.hp).roll(o.ht);
  r.ell(hd, [0, 0, 0], [2.1, 2.1, 2.0], { T: M_FEATH });
  r.ell(hd, [1.1, 0, -0.1], [1.15, 1.75, 1.95], { T: M_MASK, bias: 0.2, glow: o.mask * 0.45 });
  for (const s of [-1, 1]) r.dot(hd.p(2.2, s * 0.75, 0.35), M_HOLE, 0, 1, 0.9);
  if (o.eye > 0.05) r.dot(hd.p(2.25, 0.75, 0.35), M_EYE, o.eye, 1, 1.1);
  r.cap(hd.p(2.0, 0, -0.9), hd.p(2.6, 0, -1.9), 0.6, 0.3, { T: M_BEAK });
  if (o.mouth > 0.05)
    r.ell(hd, [2.15, 0, -0.85], [0.45, 0.65, 0.25 + o.mouth * 0.5], { T: M_MOUTH, flat: 0 });
  if (o.dk < 0.5 && o.mask < 0.5) r.eye = hd.p(2.2, 0.75, 0.35);
  return r;
}

const MW = 40;
const MH = 36;
const MAX = 20;
const MAY = 27;
/** Полёт 8 × 2, зов 16, замах 15, пике 6, посадка 21, оглушение 20, … × 5 сторон. */
const MOCK_LIM = 900;

function mockPic(o: MockO, yaw: number, post?: ((o: RigOut, P: Proj2) => void) | null): Pic {
  return draw(mockRig(o, yaw), MW, MH, MAX, MAY, post);
}

/** Взмах: фаза 0…1 → крылья и хвост; возвращает подскок корпуса (точки). */
function flap(o: MockO, ph: number, amp = 1): number {
  const wing = (p: number): number => {
    // Вниз — быстро (0…0,45), вверх — медленнее.
    const top = 1.15 * amp;
    const bot = -0.55 * amp;
    return p < 0.45
      ? top + (bot - top) * smooth(p / 0.45)
      : bot + (top - bot) * smooth((p - 0.45) / 0.55);
  };
  const p = ((ph % 1) + 1) % 1;
  o.el = wing(p);
  o.elFar = wing((p + 0.92) % 1);
  // На подъёме крыло подогнуто и отведено назад.
  const up = p < 0.45 ? 0 : Math.sin(((p - 0.45) / 0.55) * PI);
  o.sw = 0.05 + 0.35 * up;
  o.fold = 0.35 * up;
  // Хвост отстаёт от корпуса.
  o.tail = Math.sin((p - 0.2) * TAU) * 0.35 * amp;
  o.tail2 = Math.sin((p - 0.35) * TAU) * 0.4 * amp;
  // Корпус подскакивает на взмахе вниз.
  return Math.sin((p - 0.1) * TAU) * 0.8 * amp;
}

/** Замах: доля `k` 0…1 (быстрый — тот же трек короче). Возвращает подъём. */
function mockAim(o: MockO, k: number): number {
  o.el = kf(k, [
    [0, 0.5],
    [0.3, 1.3, 'o'],
    [0.62, 1.35],
    [0.9, 1.5, 'i'],
    [1, 0.6, 'i'],
  ]);
  // Задержка на пике: кончики крыльев дрожат через кадр.
  if (k > 0.32 && k < 0.6) o.el += Math.floor(k * 30) % 2 ? 0.07 : -0.07;
  o.elFar = o.el - 0.08;
  o.sw = kf(k, [
    [0, 0.1],
    [0.3, -0.1],
    [0.62, 0],
    [0.9, 0.55, 'i'],
    [1, 1.0],
  ]);
  o.fold = kf(k, [
    [0, 0],
    [0.9, 0.1],
    [1, 0.6, 'i'],
  ]);
  o.pitch = kf(k, [
    [0, 0],
    [0.3, -0.42, 'o'],
    [0.62, -0.38],
    [0.92, 0.25, 'i'],
    [1, 0.35],
  ]);
  o.hp = kf(k, [
    [0, 0],
    [0.3, 0.25],
    [0.62, 0.3],
    [0.85, -0.25, 'i'],
    [1, 0.1],
  ]);
  o.mouth = kf(k, [
    [0, 0],
    [0.3, 0.2],
    [0.45, 1, 'o'],
    [0.85, 1],
    [1, 0.6],
  ]);
  o.fan = kf(k, [
    [0, 0],
    [0.3, 1, 'o'],
    [0.85, 0.8],
    [1, 0],
  ]);
  o.tail = kf(k, [
    [0, 0],
    [0.3, -0.9, 'o'],
    [0.85, -0.6],
    [1, 0.3],
  ]);
  o.tail2 = o.tail * 0.8;
  o.eye = kf(k, [
    [0, 0],
    [0.35, 0],
    [0.6, 1, 'o'],
  ]);
  // Подъём: вздыбился вверх, на взводе — чуть ниже.
  return kf(k, [
    [0, 0],
    [0.3, 4, 'o'],
    [0.62, 4.5],
    [0.92, 3.2, 'i'],
    [1, 3],
  ]);
}

/** Удар героя в полёте: взъерошился 4 кадра. */
function mockHurt(o: MockO, hf: number): void {
  const q = [1, 0.75, 0.4, 0.15][hf] ?? 0;
  flap(o, 0.1, 0.9);
  o.el = 1.35 * q + o.el * (1 - q);
  o.elFar = 1.2 * q + o.elFar * (1 - q);
  o.pitch = -0.3 * q;
  o.hp = -0.45 * q;
  o.tail = 0.9 * q;
  o.fan = 0.6 * q;
  o.mouth = 0.7 * q;
}

registerMobPainter('f3_mocker', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = Math.max(0, pose.t);
  const now = pose.now;
  const id = m.id ?? 0;
  const sp = speedOf(m);
  const lock = md === 'aim' || md === 'dive' || md === 'call';
  const travel = sp > 1.2 ? Math.atan2(m.vy ?? 0, m.vx ?? 0) : (m.face ?? 0);
  const v = visOf(m, pose, lock ? (m.face ?? 0) : travel, lock ? 30 : 9);
  const d = side8(v.yaw);
  const o: MockO = { ...MOCK0 };
  const ex: Partial<MobFrame> = { shadow: 5, still: true, lift: 7 };
  let key: string;
  let post: ((r: RigOut, P: Proj2) => void) | null = null;
  if (md === 'dying') {
    // Смерть: крылья вскинуты, кувырок вниз, удар о землю — перья, лежит.
    const f = Math.min(10, Math.floor(t * 12));
    const k = f / 12;
    const fall = clamp01(k / 0.4);
    o.el = kf(k, [
      [0, 1.3],
      [0.15, 1.45, 'o'],
      [0.45, 0.6],
      [0.55, -0.4, 'o'],
    ]);
    o.elFar = o.el + 0.2;
    o.sw = 0.3;
    o.roll = kf(k, [
      [0, 0],
      [0.4, 1.0, 'i'],
      [0.5, 1.25, 'o'],
    ]);
    o.pitch = kf(k, [
      [0, -0.3],
      [0.4, 0.5, 'i'],
      [0.6, 0.15],
    ]);
    o.hp = 0.6 * sstep(0.35, 0.6, k);
    o.h = kf(k, [
      [0, 3.4],
      [0.45, 1.6, 'i'],
      [0.55, 1.3],
    ]);
    o.tail = 0.6 * (1 - k);
    o.mouth = 0.8 * (1 - fall);
    o.dk = sstep(0.4, 0.6, k);
    key = `die${f}`;
    ex.lift = Math.round(7 * (1 - fall * fall));
    ex.linger = 0.9;
    ex.alpha = 1 - sstep(0.65, 0.9, t);
    ex.shadow = 5 + fall;
    if (f >= 5 && f <= 8) {
      const ff = f - 5;
      post = (out, P) => {
        const [cx, cy] = P([0, 0, 2]);
        for (let i = 0; i < 7; i++) {
          const a = rnd(i, 11) * TAU;
          const rr = 3 + ff * 2.4 * (0.5 + rnd(i, 12));
          const c = i % 2 ? M_PALE : M_FEATHER_C;
          dotA(out.p, cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.5 - ff * 0.6, c, 1 - ff / 4);
        }
      };
    }
  } else if (md === 'aim') {
    // Замах: тот же трек и у быстрого (0,42 с) — кадры реже.
    const wind = (m.data?.quick ?? 0) > 0 ? 0.42 : 0.6;
    const f = Math.min(14, Math.floor((t / wind) * 15));
    const lift = mockAim(o, (f + 0.5) / 15);
    key = `aim${f}`;
    ex.lift = Math.round(7 + lift);
  } else if (md === 'dive') {
    // Пике: кадр 0 — бросок (крылья сложены назад, корпус к цели), дальше —
    // бреющий со шлейфом, подъём падает к герою за 0,14 с.
    const f = fi(t, 7);
    const k = clamp01((f + 0.5) / FPS / 0.14);
    o.el = kf(k, [
      [0, 0.6],
      [1, 0.15, 'o'],
    ]);
    o.elFar = o.el;
    o.sw = kf(k, [
      [0, 1.0],
      [1, 1.4, 'o'],
    ]);
    o.fold = kf(k, [
      [0, 0.6],
      [1, 1, 'o'],
    ]);
    o.pitch = kf(k, [
      [0, 0.45],
      [1, 0.12],
    ]);
    o.mouth = 1;
    o.eye = 1;
    o.hp = -0.15;
    o.tail = 0.25;
    o.tail2 = f % 2 ? 0.3 : -0.1;
    key = `dive${Math.min(f, 4)}${f > 4 ? f % 2 : ''}`;
    ex.lift = Math.round(
      kf(t, [
        [0, 10],
        [0.14, 3, 'o'],
      ]),
    );
    ex.ghost = { every: 0.03, life: 0.16, tint: '#c8d4dc', alpha: 0.4 };
    ex.sx = 1.06;
    ex.sy = 0.95;
  } else if (md === 'perch' || (md === 'chase' && v.prev === 'perch' && t < 0.25)) {
    // После пике: посадка (крылья тормозят, сжатие), одышка, взлёт.
    const tt = md === 'perch' ? t : 0.95 + t;
    const f = tt < 0.25 ? fi(tt, 5) : 6 + Math.min(14, Math.floor((tt - 0.25) * 12));
    const q = f < 6 ? (f + 0.5) / FPS : 0.25 + (f - 6 + 0.5) / 12;
    const breath = Math.sin(((q - 0.25) / 0.33) * TAU);
    const rest = q > 0.25 && q < 0.8;
    o.legs = kf(q, [
      [0, 0.4],
      [0.08, 1],
      [0.92, 1],
      [1.1, 0, 'o'],
    ]);
    o.el = kf(q, [
      [0, 1.2],
      [0.1, 1.0],
      [0.25, -0.45, 'o'],
      [0.8, -0.45],
      [0.95, 1.1, 'i'],
      [1.1, -0.2, 'o'],
    ]);
    o.elFar = o.el + 0.05;
    o.sw = kf(q, [
      [0, -0.2],
      [0.25, 0.75],
      [0.8, 0.75],
      [0.95, 0.1],
    ]);
    o.fold = kf(q, [
      [0, 0],
      [0.25, 0.55],
      [0.8, 0.55],
      [0.95, 0],
    ]);
    o.pitch = kf(q, [
      [0, -0.35],
      [0.12, 0.15, 'o'],
      [0.25, 0.05],
      [0.8, 0.05],
      [0.92, 0.25, 'i'],
      [1.05, -0.1],
    ]);
    o.h = 3.6 + (rest ? breath * 0.25 : 0) - (q > 0.82 && q < 0.95 ? 0.6 : 0);
    o.mouth = q > 0.2 && q < 0.85 ? 0.4 + 0.5 * Math.max(0, breath) : 0;
    o.hp = rest ? 0.15 + breath * 0.08 : 0;
    o.tail = kf(q, [
      [0, -0.5],
      [0.12, 0.6, 'o'],
      [0.3, 0.2],
    ]);
    key = `perch${f}`;
    ex.lift = Math.round(
      kf(q, [
        [0, 3],
        [0.08, 0, 'i'],
        [0.95, 0],
        [1.15, 7, 'o'],
      ]),
    );
    ex.shadow = 6;
    if (f >= 1 && f <= 3) {
      const qq = 1 - (f - 1) / 3;
      ex.sx = 1 + 0.18 * qq;
      ex.sy = 1 - 0.18 * qq;
    }
  } else if (md === 'call') {
    // Зов: манит. Крылья раскрыты вперёд и плавно «зовут», голова набок,
    // рот маски шевелится по слогам, маска светится. Без угрозы.
    const f = (((Math.floor(now * 8 + id * 3.1) % 16) + 16) % 16) | 0;
    const ph = f / 16;
    // Манящий жест: крылья раскрыты, кончики подгибаются к себе («иди сюда»).
    const beck = Math.max(0, Math.sin(ph * TAU * 2));
    o.el = 0.6 + 0.2 * Math.sin(ph * TAU);
    o.elFar = 0.6 + 0.2 * Math.sin(ph * TAU - 0.5);
    o.sw = -0.7 + 0.3 * beck;
    o.fold = 0.55 * beck;
    o.pitch = -0.25;
    o.ht = 0.45 * Math.sin(ph * TAU + 0.4);
    o.hp = 0.2;
    o.mouth = [0, 0.7, 0.2, 0.8, 0, 0, 0.6, 0.3, 0.9, 0.2, 0, 0, 0, 0.5, 0.8, 0][f];
    o.tail = 0.3 * Math.sin(ph * TAU - 1);
    o.tail2 = 0.3 * Math.sin(ph * TAU - 1.6);
    o.mask = 1;
    key = `call${f}`;
    ex.lift = Math.round(7 + Math.sin(ph * TAU) * 1.2);
  } else if (md === 'dizzy') {
    // В стену: шлёпнулся, сидит, голова ходит кругом, звёзды.
    const f = t < 0.2 ? fi(t, 4) : 5 + Math.min(14, Math.floor((t - 0.2) * 12));
    const q = f < 5 ? (f + 0.5) / FPS : 0.2 + (f - 5 + 0.5) / 12;
    const wob = (q - 0.2) * 6;
    const daze = q > 0.2 && q < 1.2;
    o.legs = 1;
    o.el = kf(q, [
      [0, 1.4],
      [0.15, -0.5, 'o'],
      [1.2, -0.5],
      [1.4, 1.0],
    ]);
    o.elFar = o.el + 0.1;
    o.sw = 0.6;
    o.fold = 0.4;
    o.pitch = kf(q, [
      [0, 0.4],
      [0.15, 0.1],
    ]);
    o.ht = daze ? Math.sin(wob) * 0.35 : 0;
    o.hp = daze ? Math.cos(wob) * 0.15 + 0.1 : 0;
    key = `dizzy${f}`;
    ex.lift = Math.round(
      kf(q, [
        [0, 2],
        [0.1, 0, 'i'],
        [1.25, 0],
        [1.4, 3, 'o'],
      ]),
    );
    ex.shadow = 6;
    if (f < 4) {
      const qq = 1 - f / 4;
      ex.sx = 1 + 0.2 * qq;
      ex.sy = 1 - 0.2 * qq;
    }
    if (q > 0.15 && q < 1.25) {
      const ph = (f % 8) / 8;
      post = (out, P) => {
        const [cx, cy] = P([2.5, 0, 8.6]);
        stars(out, cx, cy, ph, 4);
      };
    }
  } else if (md === 'sleep') {
    // Спит на земле: голова под крылом, дышит.
    const f = Math.floor(now * 1.2 + id * 0.7) % 2;
    o.legs = 1;
    o.el = -0.5;
    o.elFar = -0.5;
    o.sw = 1.1;
    o.fold = 1;
    o.hp = 0.9;
    o.h = 3.1 + f * 0.2;
    key = `sleep${f}`;
    ex.lift = 0;
    ex.shadow = 6;
  } else if (md === 'alert') {
    // Проснулся: вскинул голову, крылья — и в воздух.
    const f = fi(t, 8);
    const k = f / 8;
    o.legs = 1 - k;
    flap(o, 0.1 + k * 0.9, 1.1);
    o.hp = 0.9 * (1 - easeOut(k / 0.4));
    key = `alert${f}`;
    ex.lift = Math.round(7 * easeOut(k));
  } else if (md === 'drop') {
    // Сорвался со свода: крылья бьют часто, ловит воздух.
    const f = Math.floor(t * 16) % 4;
    flap(o, f / 4, 1.2);
    o.pitch = -0.3;
    o.hp = -0.3;
    o.fan = 1;
    key = `drop${f}`;
  } else if (md === 'stun') {
    // Сбит ударом: крылья вразлёт, голову откинуло, просел.
    const f = fi(t, 7);
    const k = f / 7;
    o.el = 1.4 - 0.9 * k;
    o.elFar = 1.2 - 0.8 * k;
    o.sw = -0.2;
    o.pitch = -0.4 * (1 - k);
    o.hp = -0.4 * (1 - k);
    o.tail = 0.9 * (1 - k);
    o.mouth = 0.8 * (1 - k);
    key = `stun${f}`;
    ex.lift = Math.round(7 - 3 * Math.sin(k * PI));
  } else {
    // Полёт и парение: взмахи по пройденному пути, покой — своей фазой.
    const moving = sp > 1.2;
    const ph = moving ? v.dist / 1.15 : now * 2.6 + id * 0.41;
    const f = Math.floor((((ph % 1) + 1) % 1) * 8) % 8;
    const bob = flap(o, f / 8, moving ? 1 : 0.8);
    o.pitch = moving ? 0.12 : -0.05;
    key = `fly${moving ? '' : 'h'}${f}`;
    ex.lift = Math.round(7 + bob);
    const hf = Math.floor(hurtAge(v, now) * FPS);
    if (hf >= 0 && hf < 4) {
      Object.assign(o, MOCK0);
      mockHurt(o, hf);
      key = `hurt${hf}`;
    }
  }
  if (md !== 'dying') recoil(v, now, 2.2, ex, 0.12);
  return frameOf('mock', MOCK_LIM, key, d, pose, (yaw) => mockPic(o, yaw, post), ex);
});

registerMobWarm('f3_mocker', function* () {
  const pose = warmPose('chase');
  for (let d = 0; d < 8; d++) {
    if (MIRR[d]) continue;
    const yaw = yawOfSide(d);
    for (const moving of [true, false])
      for (let f = 0; f < 8; f++) {
        const o: MockO = { ...MOCK0 };
        flap(o, f / 8, moving ? 1 : 0.8);
        o.pitch = moving ? 0.12 : -0.05;
        frameOf('mock', MOCK_LIM, `fly${moving ? '' : 'h'}${f}`, d, pose, () => mockPic(o, yaw));
        yield 0;
      }
  }
});
