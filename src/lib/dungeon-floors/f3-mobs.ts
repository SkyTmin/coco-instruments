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
import {
  frameLRU,
  registerImpactPainter,
  registerMobPainter,
  registerMobWarm,
  registerZonePainter,
} from '../dungeon-paint';
import type { FrameLRU, MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import type { F3Zone } from './f3-brains';
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
const RAWS = frameLRU<Pic>(3200);
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
  keys: [] as string[],
  /** По видам: [новых кадров, мс, из них с рисованием рига, мс рига]. */
  kinds: {} as Record<string, number[]>,
  size: () => [...LRU.values()].reduce((s, c) => s + c.size, 0),
  raws: () => RAWS.size,
  sizes: () => Object.fromEntries([...LRU].map(([k, c]) => [k, c.size])),
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

/**
 * Обрезать кадр по рисунку (тело и слой свечения): движок рисует холст целиком,
 * и пустые поля холста риг-кадра стоили бы столько же, сколько тело. Пустой
 * слой свечения отбрасывается.
 */
function cropPic(pc: Pic): Pic {
  const { p, lit } = pc;
  const w = p.w;
  const h = p.h;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  let litAny = false;
  const scan = (q: Px, isLit: boolean) => {
    const d = q.data;
    for (let y = 0; y < h; y++) {
      const row = y * w * 4 + 3;
      for (let x = 0; x < w; x++)
        if (d[row + x * 4]) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
          if (isLit) litAny = true;
        }
    }
  };
  scan(p, false);
  if (lit) scan(lit, true);
  if (x1 < 0) return { p: new Px(1, 1), lit: null, ax: 0, ay: 0, eye: null };
  x0 = Math.max(0, x0 - 1);
  y0 = Math.max(0, y0 - 1);
  x1 = Math.min(w - 1, x1 + 1);
  y1 = Math.min(h - 1, y1 + 1);
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;
  const cut = (q: Px): Px => {
    const o = new Px(cw, ch);
    for (let y = 0; y < ch; y++) {
      const s = ((y + y0) * w + x0) * 4;
      o.data.set(q.data.subarray(s, s + cw * 4), y * cw * 4);
    }
    return o;
  };
  return {
    p: cut(p),
    lit: lit && litAny ? cut(lit) : null,
    ax: pc.ax - x0,
    ay: pc.ay - y0,
    eye: pc.eye ? [pc.eye[0] - x0, pc.eye[1] - y0] : null,
  };
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
  if (!fr && curMob) {
    // Кадр «на потом»: в этом кадре игры новые рисунки уже съели бюджет —
    // моб ещё кадр игры (не дольше двух подряд) показывает прежнюю картинку.
    if (pose.now !== budNow) {
      budNow = pose.now;
      budMs = 0;
    }
    const prev = LAST.get(curMob);
    const w = WAIT.get(curMob) ?? 0;
    if (prev && budMs >= AHEAD_MS && w < 2) {
      WAIT.set(curMob, w + 1);
      return extra ? { ...prev, ...extra } : prev;
    }
  }
  if (!fr) {
    const t0 = performance.now();
    const rk = `${kind}|${key}|${b}`;
    let raw = RAWS.get(rk);
    const st = (F3_MOB_STAT.kinds[kind] ??= [0, 0, 0, 0]);
    if (!raw) {
      raw = RAWS.set(rk, cropPic(build(yawOfSide(b))));
      st[2]++;
      st[3] += performance.now() - t0;
    }
    fr = lru.set(fk, finish(raw, mir, pose.flash, pose.look));
    // Прогрев кладёт и зеркало: без него запад, юго-запад и северо-запад
    // собирались в бою — flipX и новый холст на каждый кадр (сведение v2.99).
    // Медуза без сторон (зеркало только в наклоне) — ей не нужно.
    const hasMir = b === 0 || b === 1 || b === 7;
    if (!curMob && !mir && !pose.flash && pose.look === 'normal' && hasMir && kind !== 'jelly') {
      const mk = `${key}|${b}m|0n`;
      if (!lru.get(mk)) lru.set(mk, finish(raw, true, false, 'normal'));
    }
    const ms = performance.now() - t0;
    st[0]++;
    st[1] += ms;
    F3_MOB_STAT.n++;
    F3_MOB_STAT.ms += ms;
    F3_MOB_STAT.last.push(ms);
    F3_MOB_STAT.keys.push(`${kind}|${fk}`);
    if (F3_MOB_STAT.last.length > 4000) F3_MOB_STAT.last.splice(0, 2000);
    if (F3_MOB_STAT.keys.length > 4000) F3_MOB_STAT.keys.splice(0, 2000);
    if (ms > F3_MOB_STAT.max) {
      F3_MOB_STAT.max = ms;
      F3_MOB_STAT.maxKey = `${kind}|${fk}`;
    }
    budMs += ms;
  }
  if (curMob) {
    WAIT.delete(curMob);
    LAST.set(curMob, fr);
  }
  return extra ? { ...fr, ...extra } : fr;
}

/**
 * Бюджет новых кадров на кадр игры (мс). Толпа в 18 мобов с ригами рисовала
 * по 2–4 новых кадра за кадр игры; сверх бюджета кадр откладывается.
 */
const AHEAD_MS = 0.3;
let budNow = NaN;
let budMs = 0;
/** Моб, которого рисует рисовальщик сейчас (null — прогрев). */
let curMob: Mob | null = null;
const LAST = new WeakMap<Mob, MobFrame>();
const WAIT = new WeakMap<Mob, number>();
/** Рисовальщики видов без обёртки (для прогрева). */
const INNER = new Map<string, (m: Mob, pose: MobPose) => MobFrame | null>();

/** Рисовальщик вида: запоминает моба для кадра «на потом». */
function paintMob(id: string, f: (m: Mob, pose: MobPose) => MobFrame | null): void {
  INNER.set(id, f);
  registerMobPainter(id, (m, pose) => {
    curMob = m;
    try {
      return f(m, pose);
    } finally {
      curMob = null;
    }
  });
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
const CRAB_LIM = 1200;

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

paintMob('f3_crab', (m: Mob, pose: MobPose) => {
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
          dotA(
            lit,
            cx + Math.cos(a) * rr,
            cy + Math.sin(a) * rr + ff * ff * 0.4,
            C_SPARK,
            1 - ff / 4,
          );
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
      for (const s of [false, true])
        for (let f = 0; f < 8; f++) {
          const o: CrabO = { ...CRAB0, ph: f / 8, str: 1, side: s ? 1 : 0 };
          if (!g) {
            o.bigE = 0.45;
            o.smE = 0.3;
            o.bigO = 0.25;
          }
          o.h = Math.abs(Math.sin(o.ph * TAU * 2)) * 0.35;
          o.roll = s ? 0 : Math.sin(o.ph * TAU) * 0.05;
          o.bigE += Math.sin(o.ph * TAU) * 0.06;
          const key = `walk${s ? 's' : 'f'}${g ? 'g' : ''}${f}`;
          frameOf('crab', CRAB_LIM, key, d, pose, () => crabPic(o, yaw, 0));
          yield 0;
        }
    // Покой со щитом и без: краб чаще всего стоит щитом к герою — без
    // прогрева эти кадры рисовались прямо в бою (сведение v2.99).
    for (const g of [true, false])
      for (let f = 0; f < 8; f++) {
        const o: CrabO = { ...CRAB0 };
        if (!g) {
          o.bigE = 0.45;
          o.smE = 0.3;
          o.bigO = 0.25;
        }
        o.h = [0, 0.15, 0.3, 0.35, 0.3, 0.15, 0, -0.05][f];
        o.glow = 0.25 + 0.15 * Math.sin((f / 8) * TAU);
        o.eyes = f === 5 ? 0.7 : 1;
        o.bigO = f >= 3 && f <= 5 ? 0.35 : o.bigO;
        frameOf('crab', CRAB_LIM, `idle${g ? 'g' : ''}${f}`, d, pose, () => crabPic(o, yaw, 0));
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
const MOCK_LIM = 1300;

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

paintMob('f3_mocker', (m: Mob, pose: MobPose) => {
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

// ---------------------------------------------------------------------------
// Туманка: медуза без сторон (рисуется плоско, наклон по ходу — зеркалом).
// Колокол бьётся по кругу 24 кадра с фазой от номера: сжался — подскочил,
// расслабился — медленно оседает; щупальца отстают по суставам. Жало 0,5 с:
// вдох (колокол шире, щупальца поджаты, ядро наливается холодом) → дрожь с
// инеем → хлёст на кадре урона (колокол сжат, щупальца вниз и врозь, вспышка
// холода поверх темноты) → щупальца оседают, колокол колышется.
// ---------------------------------------------------------------------------

const J_HI: RGBA = hex('#c4f7ff', 205);
const J_BELL: RGBA = hex('#62d0ea', 165);
const J_DARK: RGBA = hex('#2f8db6', 190);
const J_RIM: RGBA = hex('#e2fcff', 235);
const J_TENT: RGBA = hex('#4fbcd8', 205);
const J_TIP: RGBA = hex('#c8f8ff', 225);
const J_ARM: RGBA = hex('#8fe2f6', 210);
const J_ARMD: RGBA = hex('#4aa6c8', 210);
const J_CORE: RGBA = [255, 255, 255, 255];
const J_CLOVER: RGBA = hex('#b8f4ff');
const J_INK: RGBA = hex('#0b1a28');
const J_FROST: RGBA = [232, 250, 255, 255];

interface JellyO {
  /** Сжатие колокола 0…1 (−: шире обычного, вдох). */
  c: number;
  /** Фаза волны щупалец (обороты) и её размах. */
  ph: number;
  sway: number;
  /** Щупальца: длина (доля), разлёт врозь, поджатость (кончики к колоколу). */
  len: number;
  spread: number;
  curl: number;
  /** Отставание щупалец по суставам — та же сжатость, но раньше по времени. */
  lagC: number[];
  /** Наклон по ходу 0…1 (вправо; влево — зеркало). */
  lean: number;
  /** Свечение ядра 0…1, иней вокруг 0…1, дрожь колокола (точки). */
  glow: number;
  frost: number;
  jit: number;
  /** Колокол лопнул: 0 — цел, 0…1 — разлёт капель. */
  pop: number;
  /** Лежит у пола (смерть): щупальца на земле, 0…1. */
  sag: number;
  /** Хлёст: кольцо инея у кончиков щупалец 0…1 (0 — нет). */
  burst: number;
}

const JW = 30;
const JH = 34;
const JAX = 15;
const JAY = 29;
const JBY = 10;
/** Ход 2 × 24, жало 12, отход 12, оглушение 12, смерть 10, … — без сторон. */
const JELLY_LIM = 520;

/** Пульс: сжатие колокола на фазе 0…1 — быстро сжался, медленно расслабился. */
function jPulse(p: number): number {
  const q = ((p % 1) + 1) % 1;
  return q < 0.22 ? easeOut(q / 0.22) : 1 - smooth((q - 0.22) / 0.62);
}

function jellyO(c: number, ph: number): JellyO {
  return {
    c,
    ph,
    sway: 1,
    len: 1,
    spread: 0,
    curl: 0,
    lagC: [c, c, c, c, c],
    lean: 0,
    glow: 0.45,
    frost: 0,
    jit: 0,
    pop: 0,
    sag: 0,
    burst: 0,
  };
}

function jellyPic(o: JellyO): Pic {
  const p = new Px(JW, JH);
  const lit = new Px(JW, JH);
  const bx = JAX + o.jit;
  const by = JBY + o.sag * 13;
  const rx = 6.6 - 1.6 * o.c;
  const ry = (4.6 + 1.3 * o.c) * (1 - o.sag * 0.55);
  const cut = 1.6 - 0.4 * o.c;
  const rim = by + cut;
  const shear = (y: number) => o.lean * (rim - y) * 0.22;
  const g = clamp01(o.glow);
  if (o.pop <= 0) {
    // Щупальца — за колоколом: пять от кромки, отставание по суставам.
    for (let k = -2; k <= 2; k++) {
      let x = bx + k * rx * 0.36;
      let y = rim;
      const pts: [number, number][] = [[x, y]];
      for (let j = 1; j <= 5; j++) {
        const cj = o.lagC[j - 1];
        const seg = 2.5 * o.len * (1 - 0.14 * cj) * (1 - o.curl * 0.35 * (j / 5));
        const wave = Math.sin((o.ph - j * 0.09) * TAU + k * 1.3) * 1.1 * o.sway * (j / 5);
        const out = k * (0.25 * cj + o.spread) * 0.55;
        const back = -o.lean * 0.55 * j;
        const curl = o.curl * k * -0.35 * j;
        x += out + wave + back + curl;
        y += seg * (1 - o.sag * 0.7);
        pts.push([x, y]);
      }
      for (let j = 0; j < pts.length - 1; j++) {
        const [x0, y0] = pts[j];
        const [x1, y1] = pts[j + 1];
        p.line(
          Math.round(x0),
          Math.round(y0),
          Math.round(x1),
          Math.round(y1),
          j >= 4 ? J_TIP : J_TENT,
        );
      }
      const [tx, ty] = pts[pts.length - 1];
      dotA(lit, tx, ty, J_FROST, 0.25 * g);
    }
    // Колокол: купол, снизу срезан; свет сверху-слева, край темнее.
    for (let y = Math.floor(by - ry - 1); y <= Math.ceil(rim); y++)
      for (let x = Math.floor(bx - rx - 3); x <= Math.ceil(bx + rx + 3); x++) {
        const xs = x - shear(y);
        const dx = (xs + 0.5 - bx) / rx;
        const dy = (y + 0.5 - by) / ry;
        const d = dx * dx + dy * dy;
        if (d > 1 || y > rim) continue;
        const l = -(dx * 0.6 + dy * 0.8);
        p.set(x, y, d > 0.72 ? J_DARK : l > 0.55 ? J_HI : J_BELL);
      }
    // Кромка фестоном и блик.
    for (let x = Math.round(bx - rx); x <= Math.round(bx + rx); x++) {
      const yy = Math.round(rim) + ((x & 1) === 0 ? 0 : 1);
      p.set(x + Math.round(shear(rim)), yy, J_RIM);
      if ((x & 3) === 0) dotA(lit, x + shear(rim), yy, J_RIM, 0.45 * g);
    }
    p.set(Math.round(bx - rx * 0.45 + shear(by - ry * 0.6)), Math.round(by - ry * 0.62), J_CORE);
    // Ротовые ленты — посередине, перед колоколом.
    for (const s of [-1, 1]) {
      let x = bx + s * 0.9 + shear(rim);
      let y = rim - 0.5;
      for (let j = 1; j <= 3; j++) {
        const cj = o.lagC[j];
        const nx =
          x +
          s * (0.45 - 0.5 * cj) +
          Math.sin((o.ph - j * 0.12) * TAU + s) * 0.6 * o.sway -
          o.lean * 0.5;
        const ny = y + 2.6 * o.len * (1 - o.curl * 0.3) * (1 - o.sag * 0.7);
        p.line(
          Math.round(x),
          Math.round(y),
          Math.round(nx),
          Math.round(ny),
          j === 2 ? J_ARMD : J_ARM,
        );
        p.line(Math.round(x) + s, Math.round(y), Math.round(nx) + s, Math.round(ny), J_ARM);
        x = nx;
        y = ny;
      }
    }
    // Клевер внутри: четыре дужки вокруг ядра — светятся холодом.
    const cx = bx + shear(by);
    const cy = by - 0.3;
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * TAU + 0.4;
      const qx = cx + Math.cos(a) * 2.1;
      const qy = cy + Math.sin(a) * 1.4;
      p.set(Math.round(qx), Math.round(qy), J_CLOVER);
      dotA(lit, qx, qy, J_CLOVER, 0.35 + 0.6 * g);
    }
    p.set(Math.round(cx), Math.round(cy), J_CORE);
    dotA(lit, cx, cy, J_CORE, 0.5 + 0.5 * g);
    if (g > 0.7)
      for (let k = 0; k < 4; k++)
        dotA(lit, cx + [1, -1, 0, 0][k], cy + [0, 0, 1, -1][k], J_CLOVER, g - 0.4);
    // Иней: кристаллики роятся вокруг колокола.
    if (o.frost > 0)
      for (let i = 0; i < 7; i++) {
        const a = rnd(i, 21) * TAU + o.ph * TAU * (i % 2 ? 0.5 : -0.5);
        const rr = rx + 1.5 + rnd(i, 22) * 2.5;
        const qx = cx + Math.cos(a) * rr;
        const qy = cy + Math.sin(a) * rr * 0.7;
        dotA(lit, qx, qy, J_FROST, o.frost * (0.5 + 0.5 * rnd(i, 23)));
      }
    p.outline(J_INK);
    if (o.burst > 0) {
      // Хлёст: холод брызнул кольцом от кончиков щупалец — поверх темноты.
      const k = o.burst;
      const by2 = rim + 11 * o.len;
      const r = 2.5 + 7 * easeOut(k);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU + rnd(i, 41) * 0.3;
        const rr = r * (0.8 + 0.3 * rnd(i, 42));
        const qx = bx + Math.cos(a) * rr;
        const qy = by2 + Math.sin(a) * rr * 0.45;
        dotA(lit, qx, qy, J_FROST, 1 - k);
        if (k < 0.5) dotA(lit, qx - Math.cos(a), qy - Math.sin(a) * 0.45, J_CLOVER, (1 - k) * 0.6);
      }
    }
  } else {
    // Лопнула: брызги кольцом наружу и вниз, ошмётки щупалец падают.
    const k = o.pop;
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU + rnd(i, 31) * 0.4;
      const rr = (3 + 9 * easeOut(k)) * (0.7 + 0.4 * rnd(i, 32));
      const qx = bx + Math.cos(a) * rr;
      const qy = by + Math.sin(a) * rr * 0.75 + 10 * k * k;
      const al = 1 - k;
      dotA(p, qx, qy, i % 3 ? J_BELL : J_RIM, al);
      dotA(lit, qx, qy, J_FROST, al * 0.7);
    }
    if (k < 0.25) {
      // Вспышка лопнувшего ядра.
      const r = 2 + k * 14;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU;
        dotA(lit, bx + Math.cos(a) * r, by + Math.sin(a) * r * 0.8, J_CORE, 1 - k * 3);
      }
    }
    // Щупальца легли на пол лужицей.
    for (let kk = -2; kk <= 2; kk++) {
      const x0 = bx + kk * 2.2;
      const y0 = JAY - 1 + Math.abs(kk) * 0.3;
      p.line(
        Math.round(x0 - 1),
        Math.round(y0),
        Math.round(x0 + 1 + kk * 0.5),
        Math.round(y0 + 0.5),
        alpha(J_TENT, 0.9 * (1 - k * 0.6)),
      );
    }
  }
  return { p, lit, ax: JAX, ay: JAY, eye: null };
}

/** Жало, замах: кадр 0…11 (0,5 с). */
function jWind(f: number, o: JellyO): number {
  const t = (f + 0.5) / FPS;
  o.c = kf(t, [
    [0, 0.2],
    [0.17, -0.6, 'o'],
    [0.38, -0.7],
    [0.5, -0.35, 'i'],
  ]);
  o.lagC = [0, 1, 2, 3, 4].map((j) =>
    kf(t - j * 0.03, [
      [0, 0.2],
      [0.17, -0.6, 'o'],
      [0.5, -0.4],
    ]),
  );
  o.curl = kf(t, [
    [0, 0],
    [0.17, 0.8, 'o'],
    [0.42, 1],
  ]);
  o.len = kf(t, [
    [0, 1],
    [0.17, 0.72, 'o'],
    [0.42, 0.62, 'i'],
  ]);
  o.sway = 0.4;
  o.glow = kf(t, [
    [0, 0.45],
    [0.2, 0.85],
    [0.42, 1],
  ]);
  o.frost = sstep(0.12, 0.3, t);
  // Дрожь перед ударом — через кадр.
  o.jit = f >= 4 && f <= 10 ? (f % 2 ? 0.5 : -0.5) : 0;
  o.ph = t * 0.6;
  // Подъём: вдох — приподнялась, перед ударом ещё выше.
  return kf(t, [
    [0, 0],
    [0.2, 1.5, 'o'],
    [0.42, 2.5, 'i'],
    [0.5, 2],
  ]);
}

/** Хлёст и отход: кадр 0 — контакт (миг урона), 1…11 — оседание. */
function jStrike(f: number, o: JellyO): number {
  const t = (f + 0.5) / FPS;
  o.c = kf(t, [
    [0, 1.2],
    [0.08, 1.0],
    [0.2, -0.2, 's'],
    [0.32, 0.35],
    [0.5, 0.1],
  ]);
  o.lagC = [0, 1, 2, 3, 4].map((j) =>
    kf(t - j * 0.02, [
      [-0.1, -0.6],
      [0, 1.2, 'o'],
      [0.2, 0],
      [0.5, 0.2],
    ]),
  );
  o.len = kf(t, [
    [0, 1.4],
    [0.1, 1.3],
    [0.3, 0.95, 's'],
    [0.5, 1],
  ]);
  o.spread = kf(t, [
    [0, 0.9],
    [0.15, 0.5],
    [0.4, 0],
  ]);
  o.sway = kf(t, [
    [0, 0.3],
    [0.2, 1.6],
    [0.5, 1],
  ]);
  o.glow = kf(t, [
    [0, 1],
    [0.3, 0.55],
    [0.5, 0.45],
  ]);
  o.frost = 1 - sstep(0, 0.2, t);
  o.burst = f < 4 ? (f + 0.5) / 4 : 0;
  o.ph = t * 1.4;
  return kf(t, [
    [0, -2],
    [0.12, -1],
    [0.35, 0.5, 's'],
    [0.5, 0],
  ]);
}

paintMob('f3_jelly', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = Math.max(0, pose.t);
  const now = pose.now;
  const id = m.id ?? 0;
  const v = visOf(m, pose, 0, 0);
  const sp = speedOf(m);
  const vx = m.vx ?? 0;
  // Наклон по ходу: без сторон, влево — зеркало правого.
  const lean = sp > 0.35 && Math.abs(vx) > sp * 0.35 ? 1 : 0;
  const d = lean && vx < 0 ? 4 : 0;
  const ex: Partial<MobFrame> = { shadow: 4, still: true, lift: 4 };
  let key: string;
  let o: JellyO;
  let lift = 0;
  if (md === 'dying') {
    // Раздулась, ядро побелело → лопнула брызгами → ошмётки на полу.
    const f = Math.min(9, Math.floor(t * 12));
    o = jellyO(-0.9 - 0.15 * f, f * 0.1);
    o.glow = 0.6 + f * 0.15;
    o.spread = 0.6;
    o.sway = 1.5;
    o.lagC = [-0.5, -0.4, -0.2, 0, 0.2];
    if (f >= 3) {
      o.pop = (f - 3 + 0.5) / 7;
      o.glow = 1;
    }
    key = `die${f}`;
    lift = f < 3 ? f * 0.5 : -4;
    ex.linger = 0.8;
    ex.alpha = 1 - sstep(0.55, 0.8, t);
    ex.shadow = f < 3 ? 4 : 0;
    if (f < 3) {
      ex.sx = 1 + 0.06 * f;
      ex.sy = 1 + 0.04 * f;
    }
  } else if (md === 'windup') {
    const f = fi(t, 11);
    o = jellyO(0, 0);
    lift = jWind(f, o);
    key = `wind${f}`;
  } else if (md === 'recover') {
    const f = fi(t, 11);
    o = jellyO(0, 0);
    lift = jStrike(f, o);
    key = `strike${f}`;
    if (f < 3) {
      const q = 1 - f / 3;
      ex.sx = 1 - 0.12 * q;
      ex.sy = 1 + 0.16 * q;
    }
  } else if (md === 'stun') {
    // Удар героя: колокол смят и колышется, щупальца мечутся, свет мигает.
    const f = fi(t, 11);
    const k = f / 11;
    const wob = Math.cos(f * 1.7) * Math.exp(-f * 0.28);
    o = jellyO(0.9 * wob, f * 0.11);
    o.lagC = [0, 1, 2, 3, 4].map(
      (j) => 0.9 * Math.cos((f - j) * 1.7) * Math.exp(-Math.max(0, f - j) * 0.28),
    );
    o.sway = 2.2 * (1 - k) + 0.6;
    o.spread = 0.4 * (1 - k);
    o.glow = f % 2 ? 0.2 : 0.75 - 0.3 * k;
    key = `stun${f}`;
    lift = -1.5 * (1 - k);
  } else if (md === 'sleep') {
    // Спит: висит низко, тусклая, колокол бьётся медленно.
    const f = Math.floor(now * 1.2 + id * 0.7) % 2;
    o = jellyO(f * 0.35, 0.25 * f);
    o.glow = 0.12;
    o.sway = 0.3;
    o.lagC = [f * 0.3, f * 0.25, f * 0.2, f * 0.1, 0];
    key = `sleep${f}`;
    lift = -2;
  } else if (md === 'alert') {
    // Очнулась: ядро вспыхнуло, колокол сжался — рывок вверх.
    const f = fi(t, 8);
    const ph = f / 9;
    o = jellyO(jPulse(ph * 0.6), ph);
    o.lagC = [0, 1, 2, 3, 4].map((j) => jPulse(ph * 0.6 - j * 0.05));
    o.glow = 1 - 0.5 * (f / 8);
    key = `alert${f}`;
    lift = -2 + 2 * easeOut(f / 8);
  } else if (md === 'drop') {
    // Сорвалась со свода: щупальца тянутся вверх за ней.
    const f = Math.floor(t * 12) % 2;
    o = jellyO(-0.5, f * 0.5);
    o.len = 0.7;
    o.curl = 1;
    o.glow = 0.8;
    key = `drop${f}`;
  } else {
    // Плывёт и дрейфует: пульс 24 кадра с фазой от номера; в ходу пульс
    // чаще и наклон по ходу (щупальца отстают назад).
    const rate = lean ? 1.25 : 1;
    const f = (((Math.floor(now * 24 * rate + id * 7.3) % 24) + 24) % 24) | 0;
    const ph = f / 24;
    o = jellyO(jPulse(ph), ph);
    o.lagC = [0, 1, 2, 3, 4].map((j) => jPulse(ph - 0.05 - j * 0.045));
    o.lean = lean;
    o.glow = 0.4 + 0.2 * jPulse(ph - 0.1);
    key = `swim${lean}${f}`;
    // Сжалась — подскочила, расслабилась — оседает.
    lift = ph < 0.3 ? 2.2 * easeOut(ph / 0.3) : 2.2 * (1 - smooth((ph - 0.3) / 0.7));
  }
  ex.lift = Math.round(4 + lift);
  if (md !== 'dying') recoil(v, now, 2.6, ex, 0.16);
  const oo = o;
  return frameOf('jelly', JELLY_LIM, key, d, pose, () => jellyPic(oo), ex);
});

registerMobWarm('f3_jelly', function* () {
  const pose = warmPose('chase');
  for (const lean of [0, 1])
    for (let f = 0; f < 24; f++) {
      const ph = f / 24;
      const o = jellyO(jPulse(ph), ph);
      o.lagC = [0, 1, 2, 3, 4].map((j) => jPulse(ph - 0.05 - j * 0.045));
      o.lean = lean;
      o.glow = 0.4 + 0.2 * jPulse(ph - 0.1);
      frameOf('jelly', JELLY_LIM, `swim${lean}${f}`, 0, pose, () => jellyPic(o));
      yield 0;
    }
});

// ---------------------------------------------------------------------------
// Шар-копьё: броненосец в охристых пластинах с костяной иглой на морде.
// Ходит рысцой по пути, курс — по ходу (сперва поворот). Замах 1,0 с: присел
// и вздёрнул иглу → свернулся в шар (игла вперёд) → раскрутка на месте с
// ускорением, игла наливается светом, шар дрожит → откат назад и сжатие →
// выстрел: первый кадр `roll` — шар вытянут, пыль из-под него, шлейф.
// Катится: пояса пластин вращаются по пройденному пути (на скорости —
// смазаны), пыль. Отход: тормозит юзом, разворачивается, встряхивается.
// В стене: игла застряла — три рывка, звёзды, выдернул.
// ---------------------------------------------------------------------------

const S_SHELL = tn('#4e3018', '#86592c', '#b8864a', '#e0b878');
const S_BAND: RGBA = hex('#3a2210');
const S_SKIN = tn('#5a3a2a', '#8a6048', '#b48a6a', '#d8b490');
const S_BONE = tn('#8a7c5e', '#c8b890', '#eee2c0', '#fffbea');
const S_BELLY: RGBA = hex('#c8a47a');
const S_LEG = tn('#2e1a0e', '#4a2c1a', '#6a4430', '#8a5e44');
const S_DUST: RGBA = hex('#8a7a62');
const S_EYE: RGBA = hex('#1a0e08');

const mix = (a: number, b: number, k: number) => a + (b - a) * k;

interface SpearO {
  /** Свернулся 0…1 (1 — шар). */
  curl: number;
  /** Поворот шара (рад) и смаз поясов на скорости 0…1. */
  spin: number;
  blur: number;
  /** Сжатие шара вдоль хода (+ сжат, − вытянут). */
  sq: number;
  h: number;
  pitch: number;
  roll: number;
  /** Голова: кивок (+ вниз); игла — подъём (рад). */
  hp: number;
  up: number;
  /** Шаг: фаза и размах. */
  ph: number;
  str: number;
  tail: number;
  /** Игла наливается светом 0…1. */
  glow: number;
  /** На спине (смерть) 0…1, лапы дёргаются. */
  dk: number;
  kick: number;
}

const SPEAR0: SpearO = {
  curl: 0,
  spin: 0,
  blur: 0,
  sq: 0,
  h: 0,
  pitch: 0,
  roll: 0,
  hp: 0,
  up: 0.08,
  ph: 0,
  str: 0,
  tail: 0,
  glow: 0,
  dk: 0,
  kick: 0,
};

function spearRig(o: SpearO, yaw: number): Rig {
  const r = new Rig();
  const B = Fr.yaw(yaw);
  const c = o.curl;
  const R = mix(3.0, 3.5, c);
  const body = B.at(0, 0, mix(3.3, 3.5, c) + o.h)
    .pitch(o.pitch)
    .roll(o.roll + o.dk * PI);
  // Панцирь: пояса пластин вокруг боковой оси — у шара они и крутятся.
  const sf = body.pitch(o.spin);
  const rad: V3 = [
    mix(4.6, 3.5, c) * (1 - 0.22 * o.sq),
    mix(3.4, 3.4, c) * (1 + 0.08 * o.sq),
    mix(3.0, R, c) * (1 + 0.1 * o.sq),
  ];
  r.ell(sf, [0, 0, 0], rad, {
    T: S_SHELL,
    pat: (q, l) => {
      if (o.blur > 0.5) {
        // Смаз: пояса слились в полосы по ходу.
        const b = Math.abs(((((q[1] * 3 + 10) % 1) + 1) % 1) - 0.5);
        return b < 0.1 ? S_SHELL[l > 0.3 ? 2 : 1] : null;
      }
      if (c < 0.5 && q[2] < -0.5) return S_BELLY;
      const a = Math.atan2(q[2], q[0]);
      const b = ((((a * 6) / TAU) % 1) + 1) % 1;
      if (b < 0.16 && Math.abs(q[1]) < 0.93) return S_BAND;
      if (b > 0.2 && b < 0.3 && l > 0.35) return S_SHELL[3];
      return null;
    },
  });
  // Голова: стоя — спереди, свернувшись — внутри шара.
  const hk = 1 - c * 0.45;
  const hd = body
    .at(mix(4.3, 1.6, c), 0, mix(0.1, -0.8, c))
    .pitch(o.hp)
    .scale(hk);
  if (c < 0.9) {
    r.ell(hd, [0.2, 0, 0], [1.9, 1.5, 1.45], { T: S_SKIN });
    r.ell(hd, [1.5, 0, -0.3], [1.0, 0.9, 0.8], { T: S_SKIN, bias: 0.1 });
    for (const s of [-1, 1])
      r.cap(hd.p(-0.6, s * 0.9, 1.0), hd.p(-1.1, s * 1.3, 2.2), 0.5, 0.35, { T: S_SKIN });
    if (o.dk < 0.5 && c < 0.6) {
      r.dot(hd.p(0.9, 0.85, 0.5), S_EYE, 0, 1, 0.9);
      r.eye = hd.p(0.9, 0.85, 0.5);
    }
  }
  // Игла: от морды вперёд и чуть вверх; у шара торчит из него по ходу.
  const base = vlerp(hd.p(2.2, 0, -0.2), body.p(R * 0.85, 0, 0.2), sstep(0.3, 0.8, c));
  const dir = vnorm(body.v(Math.cos(o.up), 0, Math.sin(o.up)));
  r.spike(
    base,
    dir,
    8.2,
    0.95,
    { T: S_BONE, spec: true, bias: 0.15, glow: o.glow * 0.8 },
    4,
    PI / 4,
  );
  // Хвост — короткий, в пластинах; у шара спрятан.
  if (c < 0.8) {
    const t0 = body.p(-4.0, 0, -0.4);
    const t1 = body.p(-6.0 + c * 2, o.tail * 1.2, -1.3 + c * 1.5);
    r.cap(t0, t1, 0.9, 0.45, { T: S_SHELL, bias: -0.05 });
  }
  // Лапы: рысь — диагональные пары вместе; у шара поджаты внутрь.
  if (c < 0.85)
    for (const [fx, s, off] of [
      [2.1, 1, 0],
      [-2.1, -1, 0],
      [2.1, -1, 0.5],
      [-2.1, 1, 0.5],
    ] as const) {
      const hip = body.p(fx, s * 2.1, -1.6);
      const phase = (o.ph + off) % 1;
      const sw = -Math.cos(phase * TAU) * 1.4 * o.str;
      const lift = Math.max(0, Math.sin(phase * TAU)) * 1.1 * o.str;
      let foot: V3;
      if (o.dk > 0) foot = body.p(fx * 1.1, s * 2.6, -3.6 - Math.sin(o.kick + fx) * 0.6);
      else foot = B.p(fx * 1.05 + sw, s * 2.5, lift);
      foot = vlerp(foot, body.p(fx * 0.6, s * 1.4, -1.2), sstep(0.2, 0.75, c));
      r.cap(hip, foot, 0.8, 0.55, { T: S_LEG });
    }
  return r;
}

const SW = 36;
const SH = 30;
const SAX = 18;
const SAY = 18;
/** Ход 8, покой 8, замах 24, катится 4 + смаз, отход 15, в стене 22, … × 5 сторон. */
const SPEAR_LIM = 1100;

function spearPic(o: SpearO, yaw: number, post?: ((o: RigOut, P: Proj2) => void) | null): Pic {
  return draw(spearRig(o, yaw), SW, SH, SAX, SAY, post);
}

/** Замах 1,0 с: поза на кадре `f` (0…23). Возвращает откат (точки, по ходу). */
function spearCurl(f: number, o: SpearO): number {
  const t = (f + 0.5) / FPS;
  // Подготовка: присел, вздёрнул иглу — и свернулся.
  o.pitch = kf(t, [
    [0, 0],
    [0.15, -0.3, 'o'],
    [0.32, 0.1, 'i'],
    [0.45, 0],
  ]);
  o.up = kf(t, [
    [0, 0.08],
    [0.15, 0.55, 'o'],
    [0.38, 0.05, 'i'],
    [1, 0],
  ]);
  o.hp = kf(t, [
    [0, 0],
    [0.15, -0.3],
    [0.35, 0.6, 'i'],
  ]);
  o.h = kf(t, [
    [0, 0],
    [0.15, -0.5, 'o'],
    [0.3, 0.6],
    [0.42, 0, 'i'],
  ]);
  o.curl = sstep(0.18, 0.42, t);
  o.tail = 0;
  // Раскрутка на месте: ускоряется (угол — интеграл скорости).
  const s0 = Math.max(0, t - 0.4);
  o.spin = 0.5 * 90 * s0 * s0;
  o.blur = t > 0.72 ? 1 : 0;
  o.glow = sstep(0.45, 0.9, t);
  o.sq = kf(t, [
    [0, 0],
    [0.8, 0],
    [0.95, 0.35, 'o'],
    [1, 0.4],
  ]);
  // Откат назад перед выстрелом.
  return kf(t, [
    [0, 0],
    [0.78, 0],
    [0.95, -2.2, 'o'],
    [1, -2.4],
  ]);
}

/** В стене, 1,8 с: три рывка, на третьем выдернул. Поза на время `q`. */
function spearStuck(q: number, o: SpearO): number {
  o.curl = kf(q, [
    [0, 0.6],
    [0.2, 0.25, 'o'],
  ]);
  const tug = (a: number) => Math.exp(-(((q - a) / 0.07) ** 2));
  const pull = tug(0.45) * 0.7 + tug(0.85) * 0.85 + tug(1.25) * 1;
  o.pitch = 0.18 - pull * 0.28;
  o.hp = 0.1 - pull * 0.2;
  o.h = -0.4;
  o.up = -0.05;
  o.ph = (q * 3.2) % 1;
  o.str = 0.6 * pull + 0.25;
  o.tail = Math.sin(q * 22) * 0.5;
  // Выдернул на 1,6: отскок назад и встряхнулся.
  if (q > 1.55) {
    const k = clamp01((q - 1.55) / 0.25);
    o.pitch = -0.3 * Math.sin(k * PI);
    o.curl = 0;
    o.roll = Math.sin(k * TAU * 2) * 0.15 * (1 - k);
    return -2.5 * Math.sin(k * PI * 0.5);
  }
  return -pull * 1.1;
}

paintMob('f3_spear', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = Math.max(0, pose.t);
  const now = pose.now;
  const id = m.id ?? 0;
  const sp = speedOf(m);
  const lock = md === 'curl' || md === 'roll' || md === 'dizzy';
  const travel = sp > 0.4 ? Math.atan2(m.vy ?? 0, m.vx ?? 0) : (m.face ?? 0);
  const v = visOf(m, pose, lock ? (m.face ?? 0) : travel, lock ? 40 : 6);
  const d = side8(v.yaw);
  const o: SpearO = { ...SPEAR0 };
  const ex: Partial<MobFrame> = { shadow: 7, still: true };
  const fwd = (k: number) => {
    // Сдвиг кадра по ходу (экран): откат назад, выстрел вперёд.
    ex.dx = (ex.dx ?? 0) + Math.cos(v.yaw) * k;
    ex.dy = (ex.dy ?? 0) + Math.sin(v.yaw) * k * SE;
  };
  let key: string;
  let post: ((r: RigOut, P: Proj2) => void) | null = null;
  if (md === 'dying') {
    // Смерть: кувырок на спину, лапы дёргаются и стихают, игла опустилась.
    const f = Math.min(9, Math.floor(t * 12));
    const k = f / 9;
    o.dk = sstep(0, 0.45, k);
    o.h = kf(k, [
      [0, 0],
      [0.25, 1.4, 'o'],
      [0.45, -0.2, 'i'],
      [0.55, 0.1],
      [0.7, -0.3],
    ]);
    o.kick = f * 2.1;
    o.up = -0.25 * k;
    o.hp = 0.5 * k;
    key = `die${f}`;
    ex.linger = 0.85;
    ex.alpha = 1 - sstep(0.6, 0.85, t);
    ex.shadow = 7 * (1 - sstep(0.6, 0.85, t));
    if (f === 4 || f === 5) {
      const ff = f - 4;
      post = (out, P) => {
        const [cx, cy] = P([0, 0, 0]);
        dust(out, cx, cy + 1, (ff + 0.5) / 2.5, 7, 17, S_DUST, 9);
      };
    }
  } else if (md === 'curl') {
    const f = fi(t, 23);
    fwd(spearCurl(f, o));
    if (f >= 10 && f <= 18) fwd(f % 2 ? 0.4 : -0.4);
    key = `curl${f}`;
    if (f >= 12) {
      // Пыль из-под крутящегося шара.
      const ff = f;
      post = (out, P) => {
        const [cx, cy] = P([-3, 0, 0]);
        dust(out, cx, cy + 1, ((ff * 0.37) % 1) * 0.8 + 0.1, 5, ff, S_DUST, 6);
      };
    }
  } else if (md === 'roll') {
    // Катится: поворот шара — по пройденному пути; на скорости — смаз.
    const vv = Math.max(3, m.data?.v ?? sp);
    o.curl = 1;
    const fast = vv >= 6;
    const f0 = fi(t, 2);
    if (f0 < 2) {
      // Выстрел (кадр контакта): шар вытянут, пыль взрывом из-под него.
      o.sq = f0 === 0 ? -0.5 : -0.3;
      o.blur = 1;
      o.glow = 1 - f0 * 0.3;
      key = `shot${f0}`;
      fwd(f0 === 0 ? 1.5 : 0.8);
      const ff = f0;
      post = (out, P) => {
        const [cx, cy] = P([-4, 0, 0]);
        dust(out, cx, cy + 1, 0.25 + ff * 0.3, 9, 5, S_DUST, 9);
      };
    } else if (fast) {
      const s = Math.floor(now * 30) % 2;
      const pf = Math.floor(v.dist * 2.2) % 3;
      o.blur = 1;
      o.sq = -0.15;
      o.glow = 0.35;
      key = `rollb${s}${pf}`;
      post = (out, P) => {
        const [cx, cy] = P([-3.5, 0, 0]);
        dust(out, cx, cy + 1, (pf + 0.5) / 3.2, 5, 9 + pf, S_DUST, 7);
      };
      ex.ghost = { every: 0.035, life: 0.14, tint: '#e0b878', alpha: 0.35 };
    } else {
      const band = TAU / 6;
      const sk = (((Math.floor((v.dist * 16) / 3.5 / (band / 4)) % 4) + 4) % 4) | 0;
      o.spin = (sk * band) / 4;
      o.glow = 0.2;
      key = `roll${sk}`;
    }
  } else if (md === 'recover') {
    // Отход 0,6 с: тормозит юзом, раскрывается, встряхивается.
    const f = fi(t, 14);
    const q = (f + 0.5) / FPS;
    o.curl = 1 - sstep(0.12, 0.38, q);
    o.spin = kf(q, [
      [0, 0],
      [0.2, 1.6, 'o'],
    ]);
    o.pitch = kf(q, [
      [0, 0],
      [0.38, 0.15],
      [0.46, -0.12],
      [0.6, 0],
    ]);
    o.roll = q > 0.36 ? Math.sin((q - 0.36) * 40) * 0.14 * (1 - sstep(0.36, 0.6, q)) : 0;
    o.hp = kf(q, [
      [0, 0.6],
      [0.38, -0.2, 'o'],
      [0.6, 0],
    ]);
    o.glow = 0.3 * (1 - q / 0.6);
    o.tail = Math.sin(q * 30) * 0.6 * sstep(0.3, 0.4, q);
    key = `unroll${f}`;
    if (f < 6) {
      const ff = f;
      post = (out, P) => {
        const [cx, cy] = P([3, 0, 0]);
        dust(out, cx, cy + 1, (ff + 0.5) / 6, 6, 23, S_DUST, 7);
      };
    }
  } else if (md === 'dizzy') {
    // Игла в стене: дёргает три раза, звёзды, на третьем выдернул.
    const f = t < 0.25 ? fi(t, 5) : 6 + Math.min(18, Math.floor((t - 0.25) * 12));
    const q = f < 6 ? (f + 0.5) / FPS : 0.25 + (f - 6 + 0.5) / 12;
    fwd(spearStuck(q, o) + (f < 2 ? 1 : 0));
    key = `stuck${f}`;
    if (f < 3) {
      const qq = 1 - f / 3;
      ex.sx = 1 + 0.14 * qq;
      ex.sy = 1 - 0.14 * qq;
    }
    if (q > 0.2 && q < 1.55) {
      const ph = (f % 8) / 8;
      post = (out, P) => {
        const [cx, cy] = P([1.5, 0, 9]);
        stars(out, cx, cy, ph, 4);
      };
    }
  } else if (md === 'stun') {
    // Сбит: наполовину свернулся, качнулся.
    const f = fi(t, 6);
    const k = f / 6;
    o.curl = 0.45 * (1 - k);
    o.pitch = -0.25 * (1 - k);
    o.hp = 0.4 * (1 - k);
    o.roll = (f % 2 ? 0.08 : -0.08) * (1 - k);
    key = `stun${f}`;
  } else if (md === 'sleep') {
    // Спит шаром, дышит.
    const f = Math.floor(now * 1.2 + id * 0.7) % 2;
    o.curl = 1;
    o.sq = f ? -0.06 : 0.04;
    key = `sleep${f}`;
  } else if (md === 'alert') {
    // Проснулся: раскрылся и вскинул иглу.
    const f = fi(t, 8);
    const k = f / 8;
    o.curl = 1 - easeOut(k / 0.6);
    o.up = 0.08 + 0.4 * Math.sin(k * PI);
    o.h = Math.sin(k * PI) * 0.6;
    key = `alert${f}`;
  } else if (md === 'drop') {
    // Падает шаром, вертится.
    const f = Math.floor(t * 12) % 4;
    o.curl = 1;
    o.spin = (f * TAU) / 24;
    key = `drop${f}`;
  } else {
    // Рысь по пути (круг — 0,9 клетки) и покой с фазой от номера.
    if (sp > 0.4) {
      const f = Math.floor((v.dist / 0.9) * 8) % 8;
      o.ph = f / 8;
      o.str = 1;
      o.h = Math.abs(Math.sin(o.ph * TAU)) * 0.35;
      o.pitch = Math.sin(o.ph * TAU * 2) * 0.04;
      o.tail = Math.sin(o.ph * TAU) * 0.5;
      o.hp = Math.sin(o.ph * TAU * 2 + 1) * 0.08;
      key = `walk${f}`;
    } else {
      // Покой: нюхает — игла клюёт, хвост дёргается.
      const f = (((Math.floor(now * 5 + id * 2.3) % 8) + 8) % 8) | 0;
      o.hp = [0, 0.1, 0.25, 0.1, 0, -0.05, 0, 0][f];
      o.up = 0.08 - o.hp * 0.3;
      o.h = [0, 0.1, 0.15, 0.1, 0, 0, -0.05, 0][f];
      o.tail = f === 5 ? 0.6 : f === 6 ? -0.3 : 0;
      key = `idle${f}`;
    }
    // Удар героя: поджался 4 кадра (полусвернулся).
    const hf = Math.floor(hurtAge(v, now) * FPS);
    if (hf >= 0 && hf < 4) {
      const q = [1, 0.75, 0.4, 0.15][hf];
      Object.assign(o, SPEAR0);
      o.curl = 0.4 * q;
      o.hp = 0.5 * q;
      o.pitch = -0.15 * q;
      key = `hurt${hf}`;
    }
  }
  if (md !== 'dying') recoil(v, now, 1.4, ex, 0.12);
  return frameOf('spear', SPEAR_LIM, key, d, pose, (yaw) => spearPic(o, yaw, post), ex);
});

registerMobWarm('f3_spear', function* () {
  const pose = warmPose('chase');
  for (let d = 0; d < 8; d++) {
    if (MIRR[d]) continue;
    const yaw = yawOfSide(d);
    for (let f = 0; f < 8; f++) {
      const o: SpearO = { ...SPEAR0, ph: f / 8, str: 1 };
      o.h = Math.abs(Math.sin(o.ph * TAU)) * 0.35;
      o.pitch = Math.sin(o.ph * TAU * 2) * 0.04;
      o.tail = Math.sin(o.ph * TAU) * 0.5;
      o.hp = Math.sin(o.ph * TAU * 2 + 1) * 0.08;
      frameOf('spear', SPEAR_LIM, `walk${f}`, d, pose, () => spearPic(o, yaw));
      yield 0;
    }
  }
});

// ---------------------------------------------------------------------------
// Омутник: под водой — тёмная тень, рябь и два светящихся глаза. Хват
// (`rise` 0,8 с): пузыри, вода вспухает → голова прорывает гладь, с неё
// стекает вода → руки выныривают и встают высоко, пасть раскрыта (взвод) →
// бросок рук вперёд со следом → контакт (первый кадр `hold`, миг урона):
// ладони вниз, всплеск. Держит 1,6 с: тянет к себе двумя рывками, жуёт,
// качается. Уходит (`sink`): тело вниз, руки — последними. Смерть: всплыл
// брюхом, тонет. Тело ниже кромки воды срезано: кадр сидит в воде сам
// (`lift` 0, тени нет). Контакт хвата — в два слоя: мокрые следы ладоней
// с волоком к воде на полу (зона `f3_grab`) и брызги поверх темноты.
// ---------------------------------------------------------------------------

const G_SKIN = tn('#1e2c26', '#34483e', '#557060', '#7e9a82');
const G_ARM = tn('#5a6e5e', '#8ea48a', '#b8cab0', '#dce8d2');
const G_CLAW = tn('#9aa890', '#c8d4b8', '#e8f0dc', '#ffffff');
const G_MOUTH = tn('#12060a', '#12060a', '#1e0a10', '#1e0a10');
const G_TOOTH: RGBA = hex('#f2f6e4');
const G_EYE: RGBA = hex('#d6ff6a');
const G_FOAM: RGBA = hex('#bff4ea');
const G_RIP: RGBA = hex('#8fe0d8');
const G_DARK: RGBA = hex('#0c2a2c');
/** Кромка воды (высота в риге). */
const G_WL = 0.25;

interface GraspO {
  /** Высота середины тела: −4 — под водой, 1,4 — вынырнул. */
  z: number;
  pitch: number;
  roll: number;
  hp: number;
  mouth: number;
  /** Руки: подъём (рад), разлёт (рад), вытянуты 0…1, когти раскрыты 0…1. */
  ae: number;
  as: number;
  ar: number;
  claw: number;
  /** Левая рука отстаёт (добавка к подъёму). */
  aeL: number;
  /** Брюхом вверх 0…1 (смерть). */
  belly: number;
  eyes: number;
  /** Тень под водой 0…1, пузыри (фаза, −1 — нет), вода стекает 0…1, пена у кромки 0…1. */
  under: number;
  bub: number;
  wet: number;
  foam: number;
  /** Фаза ряби. */
  rip: number;
}

const GRASP0: GraspO = {
  z: 1.4,
  pitch: 0,
  roll: 0,
  hp: 0,
  mouth: 0,
  ae: 0.3,
  as: 0.6,
  ar: 0.4,
  claw: 0.3,
  aeL: 0,
  belly: 0,
  eyes: 1,
  under: 0,
  bub: -1,
  wet: 0,
  foam: 1,
  rip: 0,
};

const GW = 52;
const GH = 46;
const GAX = 26;
const GAY = 30;
/** Под водой 16 × 2, хват 20, держит 23, уходит 11, смерть 11, удар 4 × 5 сторон. */
const GRASP_LIM = 1200;

/** Срез эллипсоида кромкой воды: всё ниже `G_WL` не рисуется. */
function wcut(F: Fr, rad: V3): (q: V3) => boolean {
  const oz = F.o[2];
  const kz = [F.f[2] * rad[0], F.s[2] * rad[1], F.u[2] * rad[2]];
  return (q) => oz + q[0] * kz[0] + q[1] * kz[1] + q[2] * kz[2] < G_WL;
}

/** Капсула, обрезанная кромкой воды; точка пересечения — в `wl` (для пены). */
function capW(r: Rig, a: V3, b: V3, r0: number, r1: number, m: Mat, wl: V3[]): void {
  const ua = a[2] >= G_WL;
  const ub = b[2] >= G_WL;
  if (!ua && !ub) return;
  if (ua && ub) {
    r.cap(a, b, r0, r1, m);
    return;
  }
  const k = (G_WL - a[2]) / (b[2] - a[2]);
  const c = vlerp(a, b, k);
  wl.push(c);
  if (ua) r.cap(a, c, r0, mix(r0, r1, k), m);
  else r.cap(c, b, mix(r0, r1, k), r1, m);
}

function graspRig(o: GraspO, yaw: number, wl: V3[], hands: V3[]): Rig {
  const r = new Rig();
  const B = Fr.yaw(yaw);
  const tor = B.at(0, 0, o.z)
    .pitch(o.pitch)
    .roll(o.roll + o.belly * PI * 0.85);
  const tr: V3 = [3.4, 4.4, 3.8];
  r.ell(
    tor,
    [0, 0, 0],
    tr,
    {
      T: G_SKIN,
      pat: (q, l) => (q[2] < -0.35 ? G_ARM[l > 0.2 ? 2 : 1] : null),
    },
    wcut(tor, tr),
  );
  // Голова: широкая, плоская, пасть-щель во всю ширину.
  const hd = tor.at(1.9, 0, 2.7).pitch(o.hp);
  const hr: V3 = [3.3, 4.4, 2.1];
  r.ell(
    hd,
    [0, 0, 0],
    hr,
    {
      T: G_SKIN,
      pat: (q, l) =>
        Math.abs(q[1]) > 0.5 && q[2] > 0.3 && ((q[0] * 5 + q[1] * 3) & 1) === 0 && l < 0.6
          ? G_SKIN[0]
          : null,
    },
    wcut(hd, hr),
  );
  const mf = hd.at(2.7, 0, -0.65 - o.mouth * 0.4);
  const mr: V3 = [0.9, 3.0, 0.35 + o.mouth * 1.1];
  r.ell(mf, [0, 0, 0], mr, { T: G_MOUTH, flat: 0 }, wcut(mf, mr));
  for (let i = -3; i <= 3; i++) {
    const up = hd.p(3.25, i * 0.8, -0.4);
    if (up[2] > G_WL) r.dot(up, G_TOOTH, 0, 1, 0.9);
    if (o.mouth > 0.35) {
      const lo = hd.p(3.1, i * 0.8 + 0.4, -0.9 - o.mouth * 1.4);
      if (lo[2] > G_WL) r.dot(lo, G_TOOTH, 0, 1, 0.9);
    }
  }
  for (const s of [-1, 1]) {
    const e = hd.p(2.2, s * 1.9, 1.1);
    if (e[2] > G_WL && o.eyes > 0.05) {
      r.dot(e, G_EYE, o.eyes, 1, 1.1);
      if (s > 0) r.eye = e;
    }
  }
  // Гребень по спине.
  for (let i = 0; i < 3; i++) {
    const bp = tor.p(-0.5 - i * 1.4, 0, 3.5 - i * 0.4);
    if (bp[2] > G_WL)
      r.spike(bp, tor.v(-0.5, 0, 1), 2.2 - i * 0.4, 0.7, { T: G_SKIN, bias: -0.1 }, 3);
  }
  // Руки: длинные, бледные, с крючьями; ниже воды срезаны.
  const am: Mat = { T: G_ARM };
  for (const s of [-1, 1]) {
    const e = o.ae + (s < 0 ? o.aeL : 0);
    const sh = tor.p(0.8, s * 3.9, 1.2);
    const d = vnorm(tor.v(Math.cos(e) * Math.cos(o.as), s * Math.sin(o.as), Math.sin(e)));
    const L = 5.5 + 8 * o.ar;
    const bend = vmul(tor.v(0, s * 0.6, -1), 1.6 * (1 - o.ar));
    const el = vadd(vadd(sh, vmul(d, L * 0.48)), bend);
    const hand = vadd(sh, vmul(d, L));
    capW(r, sh, el, 1.3, 1.05, am, wl);
    capW(r, el, hand, 1.05, 0.85, am, wl);
    if (hand[2] >= G_WL) {
      hands.push(hand);
      const side = vnorm(tor.v(-Math.sin(o.as) * s, Math.cos(o.as), 0));
      const down = vnorm(vsub(vmul(d, 0.4), [0, 0, 1]));
      for (let k = -1; k <= 1; k++) {
        const tip = vadd(
          vadd(hand, vmul(d, 2.0 + 0.8 * o.claw)),
          vadd(vmul(side, k * (0.6 + 1.0 * o.claw)), vmul(down, 1.1 * (1 - o.claw * 0.5))),
        );
        r.cap(hand, tip, 0.6, 0.25, { T: G_CLAW, bias: 0.1 });
      }
    }
  }
  return r;
}

function graspPic(o: GraspO, yaw: number, post?: ((o: RigOut, P: Proj2) => void) | null): Pic {
  const wl: V3[] = [];
  const hands: V3[] = [];
  const rig = graspRig(o, yaw, wl, hands);
  // Курс на экране — для тени под водой и глаз.
  const hx = Math.cos(yaw);
  const hy = Math.sin(yaw) * SE;
  const hl = Math.hypot(hx, hy) || 1;
  const ux = hx / hl;
  const uy = hy / hl;
  return draw(rig, GW, GH, GAX, GAY, (out, P) => {
    const p = out.p;
    const lit = litOn(out);
    const empty = (x: number, y: number) => !p.solid(Math.round(x), Math.round(y));
    // Тень под водой: вытянута по курсу, только там, где пусто.
    if (o.under > 0.02) {
      for (let y = -6; y <= 6; y++)
        for (let x = -9; x <= 9; x++) {
          const a = (x * ux + y * uy) / 7.5;
          const b = (-x * uy + y * ux) / 4.6;
          if (a * a + b * b > 1) continue;
          if (empty(GAX + x, GAY + y))
            dotA(p, GAX + x, GAY + y, G_DARK, o.under * (a * a + b * b > 0.6 ? 0.35 : 0.55));
        }
      if (o.eyes > 0.05 && o.under > 0.4)
        for (const s of [-1, 1]) {
          const ex = GAX + ux * 4.5 - uy * s * 1.8;
          const ey = GAY + uy * 4.5 + ux * s * 1.8 * 0.7;
          dotA(lit, ex, ey, G_EYE, o.eyes * o.under);
          dotA(p, ex, ey, G_EYE, 0.6 * o.eyes * o.under);
        }
    }
    // Рябь: кольцо расходится от тела (только по пустому).
    const rr = 6 + (((o.rip % 1) + 1) % 1) * 7;
    const ra = 0.55 * (1 - (((o.rip % 1) + 1) % 1));
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * TAU;
      const x = GAX + Math.cos(a) * rr;
      const y = GAY + Math.sin(a) * rr * 0.55;
      if (empty(x, y) && (i + Math.floor(o.rip * 7)) % 3 !== 0) dotA(p, x, y, G_RIP, ra);
    }
    // Пена у кромки вокруг тела: передняя дуга — поверх тела.
    if (o.foam > 0.02) {
      const fr = 4.6 + (o.z > 0 ? 0.6 : 0);
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * TAU;
        const x = GAX + Math.cos(a) * fr + ((i * 7) % 3) - 1;
        const y = GAY + Math.sin(a) * fr * 0.55;
        if (Math.sin(a) > 0 || empty(x, y)) dotA(p, x, y, i % 3 ? G_FOAM : G_RIP, o.foam * 0.9);
      }
      for (const c of wl) {
        const [x, y] = P(c);
        for (let k = -2; k <= 2; k++) dotA(p, x + k, y + (k & 1), G_FOAM, o.foam * 0.85);
      }
    }
    // Пузыри: всплывают и лопаются.
    if (o.bub >= 0)
      for (let i = 0; i < 6; i++) {
        const q = (o.bub + rnd(i, 61)) % 1;
        const a = rnd(i, 62) * TAU;
        const rad = 2 + rnd(i, 63) * 6;
        const x = GAX + Math.cos(a) * rad;
        const y = GAY + Math.sin(a) * rad * 0.55;
        if (q < 0.7) dotA(p, x, y, G_FOAM, 0.9);
        else
          for (let k = 0; k < 4; k++)
            dotA(p, x + [1, -1, 0, 0][k], y + [0, 0, 1, -1][k], G_RIP, 0.7);
      }
    // Вода стекает с головы и рук.
    if (o.wet > 0.05) {
      const pts = hands.map((h) => P(h));
      pts.push(P([Math.cos(yaw) * 3.5, Math.sin(yaw) * 3.5, o.z + 1.2]));
      pts.forEach(([x, y], i) => {
        for (let k = 0; k < 3; k++)
          dotA(p, x + ((i + k) % 3) - 1, y + 2 + k * 2, G_FOAM, o.wet * (1 - k * 0.25));
      });
    }
    if (post) post(out, P);
  });
}

/** Хват 0,8 с: поза на время `t`. */
function graspRise(t: number, o: GraspO): void {
  o.z = kf(t, [
    [0, -4],
    [0.3, -2.4, 'i'],
    [0.36, -0.6, 'o'],
    [0.5, 1.1, 'o'],
    [0.6, 1.5],
    [0.72, 1.7],
    [0.8, 1.3, 'i'],
  ]);
  o.under = 1 - sstep(0.3, 0.45, t);
  o.bub = t < 0.36 ? t * 2.6 : -1;
  o.foam = sstep(0.3, 0.38, t);
  o.wet = kf(t, [
    [0.34, 0],
    [0.4, 1],
    [0.8, 0.4],
  ]);
  o.ae = kf(t, [
    [0, -1.2],
    [0.48, -0.9],
    [0.6, 1.2, 'o'],
    [0.72, 1.45],
    [0.8, 0.02, 'i'],
  ]);
  o.ar = kf(t, [
    [0, 0.2],
    [0.6, 0.45],
    [0.72, 0.5],
    [0.8, 1.0, 'i'],
  ]);
  o.as = kf(t, [
    [0, 0.6],
    [0.6, 0.8],
    [0.72, 0.9],
    [0.8, 0.3, 'i'],
  ]);
  o.aeL = kf(t, [
    [0.5, 0],
    [0.6, -0.35],
    [0.7, 0],
  ]);
  o.claw = kf(t, [
    [0, 0],
    [0.6, 1],
    [0.77, 1],
    [0.8, 0.3],
  ]);
  o.pitch = kf(t, [
    [0, 0],
    [0.5, -0.1],
    [0.62, -0.32, 'o'],
    [0.72, -0.38],
    [0.8, 0.14, 'i'],
  ]);
  o.mouth = kf(t, [
    [0, 0],
    [0.5, 0.1],
    [0.62, 1, 'o'],
    [0.76, 1],
    [0.8, 0.2, 'i'],
  ]);
  o.hp = kf(t, [
    [0, 0],
    [0.62, -0.2],
    [0.8, 0.15],
  ]);
  o.eyes = 1;
  o.rip = t * 2;
}

/** Держит 1,6 с: тянет к себе двумя рывками, жуёт, качается. */
function graspHold(q: number, o: GraspO): void {
  const tug = (a: number) => Math.exp(-(((q - a) / 0.08) ** 2));
  const pull = tug(0.35) + tug(0.8) * 1.1;
  o.z = 1.3 + Math.sin(q * TAU * 1.2) * 0.2 - pull * 0.3;
  o.ar = kf(q, [
    [0, 1],
    [0.25, 0.95],
    [0.4, 0.62, 'o'],
    [0.7, 0.6],
    [0.85, 0.32, 'o'],
    [1.6, 0.3],
  ]);
  o.ae = kf(q, [
    [0, 0.02],
    [0.4, 0.08],
    [0.85, 0.2],
    [1.6, 0.35],
  ]);
  o.as = kf(q, [
    [0, 0.3],
    [0.85, 0.45],
    [1.6, 0.6],
  ]);
  o.claw = kf(q, [
    [0, 0.2],
    [1.2, 0.2],
    [1.5, 0.7],
  ]);
  o.pitch =
    kf(q, [
      [0, 0.14],
      [0.25, 0.08],
      [1.6, 0],
    ]) -
    pull * 0.22;
  o.hp = -pull * 0.12;
  o.mouth = q > 0.3 ? 0.35 + 0.35 * Math.sin((q - 0.3) * TAU * 2.2) : 0.15;
  o.roll = Math.sin(q * 4.2) * 0.06;
  o.wet = 0.4 * (1 - q / 1.6);
  o.rip = q * 1.5;
}

paintMob('f3_grasp', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = Math.max(0, pose.t);
  const now = pose.now;
  const id = m.id ?? 0;
  const sp = speedOf(m);
  const travel = sp > 0.4 ? Math.atan2(m.vy ?? 0, m.vx ?? 0) : (m.face ?? 0);
  const lock = md === 'rise' || md === 'hold' || md === 'sink';
  const v = visOf(m, pose, lock ? (m.face ?? 0) : travel, lock ? 12 : 5);
  const d = side8(v.yaw);
  const o: GraspO = { ...GRASP0 };
  const ex: Partial<MobFrame> = { shadow: 0, still: true, lift: 0 };
  let key: string;
  let post: ((r: RigOut, P: Proj2) => void) | null = null;
  if (md === 'dying') {
    // Смерть: дёрнулся, перевернулся брюхом вверх, всплыл — и тонет.
    const f = Math.min(10, Math.floor(t * 12));
    const k = f / 12;
    o.belly = sstep(0.08, 0.45, k);
    o.z = kf(k, [
      [0, 1.3],
      [0.15, 2.0, 'o'],
      [0.45, 0.6, 'i'],
      [0.85, -0.4],
    ]);
    o.ae = kf(k, [
      [0, 1.2],
      [0.3, 0.5],
      [0.5, -0.6],
    ]);
    o.ar = 0.5;
    o.as = 0.9;
    o.claw = 1 - k;
    o.mouth = kf(k, [
      [0, 1],
      [0.4, 0.6],
      [0.6, 0.2],
    ]);
    o.eyes = 1 - sstep(0.1, 0.4, k);
    o.wet = 0;
    o.bub = f >= 6 ? f * 0.13 : -1;
    o.rip = k * 2;
    key = `die${f}`;
    ex.linger = 0.9;
    ex.alpha = 1 - sstep(0.6, 0.9, t);
    if (f >= 3 && f <= 5) {
      const ff = f - 3;
      post = (out) => dust(out, GAX, GAY + 1, (ff + 0.5) / 3.5, 10, 41, G_FOAM, 10);
    }
  } else if (md === 'rise') {
    const f = fi(t, 19);
    graspRise((f + 0.5) / FPS, o);
    key = `rise${f}`;
    if (f >= 18) {
      // Бросок рук: серп следа от поднятых ладоней вниз-вперёд.
      const yawB = yawOfSide(BASE[d]);
      const ff = f;
      post = (out, P) => {
        const pts: [number, number][] = [];
        for (let i = 0; i <= 5; i++) {
          const oo: GraspO = { ...o, ae: mix(1.45, o.ae, i / 5), ar: mix(0.5, o.ar, i / 5) };
          const hs: V3[] = [];
          graspRig(oo, yawB, [], hs);
          if (hs[1]) pts.push(P(hs[1]));
        }
        smear(out, pts, [220, 240, 228, 255], ff === 19 ? 0.95 : 0.6);
      };
    }
  } else if (md === 'hold') {
    // Кадр 0 — контакт (миг урона): ладони у цели, всплеск, тело вперёд.
    const f = t < 0.25 ? fi(t, 5) : 6 + Math.min(16, Math.floor((t - 0.25) * 12));
    const q = f < 6 ? (f + 0.5) / FPS : 0.25 + (f - 6 + 0.5) / 12;
    graspHold(q, o);
    key = `hold${f}`;
    if (f < 3) {
      const qq = 1 - f / 3;
      ex.sx = 1 + 0.12 * qq;
      ex.sy = 1 - 0.1 * qq;
      const ff = f;
      post = (out, P) => {
        const hs: V3[] = [];
        graspRig(o, yawOfSide(BASE[d]), [], hs);
        for (const h of hs) {
          const [x, y] = P([h[0], h[1], 0]);
          dust(out, x, y, (ff + 0.6) / 3.6, 7, 13 + ff, G_FOAM, 7);
        }
      };
    }
    const hf = Math.floor(hurtAge(v, now) * FPS);
    if (hf >= 0 && hf < 4) {
      // Удар героя: голова откинута, пасть настежь.
      const qq = [1, 0.75, 0.4, 0.15][hf];
      Object.assign(o, GRASP0);
      graspHold(1.0, o);
      o.hp = -0.45 * qq;
      o.pitch = -0.3 * qq;
      o.mouth = 0.9 * qq + 0.2;
      key = `hurt${hf}`;
    }
  } else if (md === 'sink') {
    // Уходит: тело вниз, руки — последними.
    const f = fi(t, 10);
    const q = (f + 0.5) / FPS;
    o.z = kf(q, [
      [0, 1.3],
      [0.1, 1.6, 'o'],
      [0.45, -4, 'i'],
    ]);
    o.ae = kf(q, [
      [0, 0.25],
      [0.2, 1.3, 'o'],
    ]);
    o.ar = 0.55;
    o.as = 0.5;
    o.claw = kf(q, [
      [0, 0.6],
      [0.3, 1],
    ]);
    o.mouth = 0;
    o.under = sstep(0.22, 0.4, q);
    o.wet = 0.3;
    o.rip = q * 2;
    key = `sink${f}`;
  } else {
    // Под водой: тень, глаза, рябь; плывёт — горб воды впереди.
    const moving = sp > 0.5;
    const f = (((Math.floor(now * (moving ? 12 : 6) + id * 3.7) % 16) + 16) % 16) | 0;
    o.z = -4;
    o.under = md === 'sleep' ? 0.6 : 1;
    o.eyes = md === 'sleep' || f === 9 ? 0 : 1;
    o.foam = moving ? 0.35 : 0;
    o.rip = f / 16;
    o.bub = !moving && f >= 12 ? (f - 12) / 4 : -1;
    key = `lurk${moving ? 1 : 0}${o.eyes ? '' : 'c'}${f}`;
  }
  if (md !== 'dying') recoil(v, now, 1.2, ex, 0.1);
  return frameOf('grasp', GRASP_LIM, key, d, pose, (yaw) => graspPic(o, yaw, post), ex);
});

registerMobWarm('f3_grasp', function* () {
  const pose = warmPose('lurk');
  for (let d = 0; d < 8; d++) {
    if (MIRR[d]) continue;
    const yaw = yawOfSide(d);
    for (let f = 0; f < 20; f++) {
      const o: GraspO = { ...GRASP0 };
      graspRise((f + 0.5) / FPS, o);
      frameOf('grasp', GRASP_LIM, `rise${f}`, d, pose, () => graspPic(o, yaw));
      yield 0;
    }
  }
});

/** Брызги хвата — поверх темноты: капли взлетают из-под ладоней и падают. */
registerImpactPainter('f3_grab', {
  life: 0.6,
  shake: 0.22,
  above: true,
  paint(g, rec, px, py, _scale, age) {
    const seed = (rec.seed ?? 1) >>> 0;
    const k = age / 0.6;
    for (let i = 0; i < 14; i++) {
      const a = rnd(seed % 997, i, 1) * TAU;
      const sp = 14 + rnd(seed % 997, i, 2) * 22;
      const x = px + Math.cos(a) * sp * age * 1.4;
      const y =
        py +
        Math.sin(a) * sp * age * 0.7 -
        (40 * age - 70 * age * age) * (0.6 + rnd(seed % 997, i, 3));
      g.fillStyle = i % 3 ? 'rgba(191,244,234,1)' : 'rgba(255,255,255,1)';
      g.globalAlpha = Math.max(0, 1 - k);
      g.fillRect(Math.round(x), Math.round(y), 1, 1);
    }
    if (age < 0.12) {
      // Вспышка-кольцо пены в миг хвата.
      const r = 4 + age * 60;
      g.globalAlpha = 1 - age / 0.12;
      g.fillStyle = 'rgba(232,255,250,1)';
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * TAU;
        g.fillRect(Math.round(px + Math.cos(a) * r), Math.round(py + Math.sin(a) * r * 0.55), 1, 1);
      }
    }
    g.globalAlpha = 1;
    return true;
  },
});

/** Хват на полу: мокрое пятно, следы ладоней с когтями и волок к воде. */
registerZonePainter('f3_grab', (g, z, px, py) => {
  const zz = z as F3Zone & { t: number; life: number; id: number };
  const u = clamp01(zz.t / (zz.life || 1.4));
  const a = zz.vAng ?? 0;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const fade = 1 - sstep(0.55, 1, u);
  // Волок: ладони тянут к воде.
  const drag = 12 * easeOut(sstep(0.12, 0.6, u));
  g.fillStyle = 'rgba(12,42,44,1)';
  g.globalAlpha = 0.35 * fade;
  for (let s = 0; s <= drag; s += 1)
    for (const side of [-1, 1])
      g.fillRect(
        Math.round(px + ca * s - sa * side * 3),
        Math.round(py + sa * s * 0.6 + ca * side * 2),
        1,
        1,
      );
  // Мокрое пятно.
  g.globalAlpha = 0.3 * fade;
  for (let i = -5; i <= 5; i++)
    for (let j = -2; j <= 2; j++)
      if ((i * i) / 30 + (j * j) / 6 <= 1) g.fillRect(Math.round(px + i), Math.round(py + j), 1, 1);
  // Ладони с когтями — бледные, тают.
  g.fillStyle = 'rgba(220,232,210,1)';
  g.globalAlpha = 0.75 * fade;
  for (const side of [-1, 1]) {
    const hx = px + ca * drag - sa * side * 3;
    const hy = py + sa * drag * 0.6 + ca * side * 2;
    g.fillRect(Math.round(hx) - 1, Math.round(hy), 2, 1);
    for (let k = -1; k <= 1; k++)
      g.fillRect(Math.round(hx - ca * 2 + -sa * k), Math.round(hy - sa * 1.2 + ca * k * 0.6), 1, 1);
  }
  g.globalAlpha = 1;
  return true;
});

// ---------------------------------------------------------------------------
// Прогрев действий: замахи, удары, проводки и смерть каждого вида по пяти
// рисуемым сторонам; зеркала (запад) кладёт `frameOf` тут же из сырого кадра.
// Без него толпа рисовала первые кадры атак прямо в бою — 2–4 новых кадра за
// кадр игры; смерть — потому что бьют пачками (сведение v2.99).
// ---------------------------------------------------------------------------

/** [режим, длительность с, скорость кл/с] — как режимы мозга этажа. */
type WarmStep = [string, number, number];
const WARM_ACTS: Record<string, WarmStep[]> = {
  f3_crab: [
    ['dying', 0.9, 0],
    ['windup', 0.65, 0],
    ['recover', 1.05, 0],
    ['stun', 0.25, 0],
  ],
  f3_mocker: [
    ['dying', 0.9, 0],
    ['aim', 0.6, 0],
    ['dive', 0.4, 12],
    ['perch', 0.95, 0],
    ['call', 2, 0],
    ['dizzy', 1.4, 0],
  ],
  f3_jelly: [
    ['dying', 0.9, 0],
    ['chase', 1, 1.2],
    ['windup', 0.5, 0],
    ['recover', 0.5, 0],
    ['stun', 0.5, 0],
  ],
  f3_spear: [
    ['dying', 0.9, 0],
    ['curl', 1, 0],
    ['roll', 0.5, 10],
    ['recover', 0.6, 0],
    ['dizzy', 1.8, 0],
  ],
  f3_grasp: [
    ['dying', 0.9, 0],
    ['lurk', 1.4, 2.6],
    ['hold', 1.6, 0],
    ['sink', 0.45, 0],
  ],
};

for (const [kind, acts] of Object.entries(WARM_ACTS))
  registerMobWarm(kind, function* () {
    const paint = INNER.get(kind);
    if (!paint) return;
    for (let d = 0; d < 8; d++) {
      if (MIRR[d]) continue;
      const face = (d * PI) / 4;
      for (const [mode, dur, sp] of acts)
        for (let f = 0; f < dur * FPS; f++) {
          const t = (f + 0.5) / FPS;
          const m = {
            id: 1,
            kind,
            x: 0,
            y: 0,
            vx: Math.cos(face) * sp,
            vy: Math.sin(face) * sp,
            face,
            mode,
            t,
            data: mode === 'roll' ? { v: sp } : {},
            flash: 0,
            kx: 0,
            ky: 0,
            r: 0.4,
          } as unknown as Mob;
          paint(m, { ...warmPose(mode), t, now: t });
          yield 0;
        }
    }
  });
