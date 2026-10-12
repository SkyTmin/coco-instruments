// Этаж 14 — «Кукушка» (анимации мобов 14).
//
// Резная деревянная птица из часов-домика на латунной пружине. Мозг
// (`f14-brains.ts`, `CUCKOO`): `f14_nest` — спрятана (кадра нет, дверцы
// рисуют часы) → `f14_call` 0,45 (дверцы настежь, «ку-ку») → `aim` 0,75
// (линия на полу; урон — в конце, сразу по всей линии) → `f14_peck` 0,14
// (пружина выстреливает) → `f14_out` 1,4 (висит на пружине, открыта, урон
// ×1,3) → `f14_back` 0,3 (пружина втягивает) → гнездо.
//
// Птица — мини-3D (`f15-rig.ts`), 5 честных сторон: пружина бьёт только
// вниз (на юг), север не нужен. Поза — 24 к/с от времени режима.
//
// Пружина и тень — не в кадре: длина пружины меняется каждый кадр, поэтому
// кадр птицы берётся из кеша (прогрет), а пружину (точки по спирали), след и
// тень моб дорисовывает на своём холсте — новых кадров в бою нет.
//
// Кадр контакта — первый кадр `f14_peck`: урон бьёт по всей линии разом,
// поэтому птица в этот кадр уже на конце пружины (рисунок впереди тела моба
// на путь, что оно пролетит за 0,14 с), за ней — след по всей пружине и
// искры у клюва. Птица летит на высоте дверцы, тень — на линии.

import { registerMobPainter } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import { CUCKOO } from './f14-brains';
import {
  F3,
  PI,
  Rig,
  TAU,
  clamp01,
  dirN,
  draw,
  easeIn,
  easeOut,
  fi,
  frameOf,
  hurtAge,
  hx,
  keyPose,
  kindOf,
  lerp,
  proj,
  spark2,
  spray,
  sstep,
  tf,
  tn,
  visOf,
  warmAll,
  demOf,
  regWarm,
  yawN,
} from './f14-mobkit';
import type { KeyPose, Mat, Pic, Proj2, RGBA, RigOut, Tones, V3 } from './f14-mobkit';

const BODY = tn('#4a2810', '#87501f', '#bb7a3e', '#e8b070');
const WING = tn('#2e1a0a', '#5a3416', '#84522a', '#b07a44');
const BREAST = tn('#9a8a66', '#d8c69c', '#f2e8c8', '#fffaf0');
const BEAK = tn('#7a3008', '#c85a14', '#ff9a30', '#ffd080');
const BRASS = tn('#3a2410', '#7a5220', '#b8862e', '#f0c860');
const EYE = hx('#120c08');
const GLINT = hx('#fff6d0');
const SPARK = hx('#fff4d0');
const SPARK2 = hx('#ffc860');
const DUST: RGBA[] = [hx('#6a5a48'), hx('#8a7a64'), hx('#4a3e32')];
const CHIPS: RGBA[] = [BODY[2], BREAST[2], WING[1], BODY[3]];

const tone = (T: Tones, l: number): RGBA =>
  l > 0.78 ? T[3] : l > 0.38 ? T[2] : l > -0.02 ? T[1] : T[0];
const md5 = (x: number, m: number) => ((x % m) + m) % m;

/** Тело: светлая грудка, по спине — резные ряды перьев. */
const BODY_M: Mat = {
  T: BODY,
  bias: 0.08,
  pat: (q, l) => {
    if (q[0] > 0.18 && q[2] < 0.3) return tone(BREAST, l);
    if (q[2] > 0.2 && q[0] < 0.45 && md5(q[0] * 2.4 - q[2] * 0.9, 0.55) < 0.11) return BODY[0];
    return null;
  },
};
/** Голова: горлышко и щёки — светлые. */
const HEAD_M: Mat = {
  T: BODY,
  pat: (q, l) => (q[0] > 0.5 || (q[0] > 0.1 && q[2] < -0.15) ? tone(BREAST, l) : null),
};
const BEAK_M: Mat = { T: BEAK, spec: true };
const WING_M: Mat = { T: WING, bias: 0.06 };
const TAIL_M: Mat = { T: WING, bias: -0.02 };
const BRASS_M: Mat = { T: BRASS, spec: true };

// ---------------------------------------------------------------------------
// Поза и риг.
// ---------------------------------------------------------------------------

interface CuO {
  /** Высота середины тела (риг; на экране ×0,8). */
  z: number;
  /** Сдвиг тела вперёд по курсу (назад — втянулась в дверцу). */
  fx: number;
  /** Длина тела: >1 — вытянулась в рывке, <1 — сжалась. */
  len: number;
  pitch: number;
  roll: number;
  /** Голова: вперёд, вверх, кивок (носом вниз +). */
  hf: number;
  hu: number;
  hp: number;
  /** Клюв 0…1 — раскрыт. */
  beak: number;
  /** Крылья: 0 — сложены, 1 — вскинуты; `sweep` — назад (+) / вперёд (−). */
  wing: number;
  sweep: number;
  /** Хвост: подъём и раскрытие веера. */
  tail: number;
  fan: number;
  /** Блик в глазу (последние 0,25 с прицела). */
  glint: number;
}

/** Высота дверцы и полёта (риг): на экране 14 и 11 точек над точкой земли. */
const ZD = 17.5;
const ZF = 13.75;
/** Лёжа на боку — середина тела над полом. */
const ZG = 3.4;
/** Масштаб птицы: с героем рядом читается на телефоне. */
const SC = 1.3;

const C0: CuO = {
  z: ZF,
  fx: 0,
  len: 1,
  pitch: 0,
  roll: 0,
  hf: 0,
  hu: 0,
  hp: 0,
  beak: 0,
  wing: 0,
  sweep: 0,
  tail: 0.4,
  fan: 0.35,
  glint: 0,
};

interface CPts {
  tip: V3;
  body: V3;
  ground: V3;
}

function birdRig(o: CuO, yaw: number, r: Rig): CPts {
  const B = F3.yaw(yaw);
  const C = B.at(o.fx, 0, o.z).pitch(o.pitch).roll(o.roll).scale(SC);
  const L = o.len;
  // Хвост — веер из трёх резных перьев.
  const tb = C.p(-3.0 * L, 0, 0.6);
  const tipT = (i: number): V3 =>
    C.p(
      -3.0 * L - 3.4 - (i === 0 ? 0.6 : 0) - o.sweep * 0.3,
      i * (0.9 + 1.7 * o.fan),
      0.7 + o.tail * 1.5 - Math.abs(i) * 0.3,
    );
  r.poly([C.p(-2.6 * L, -1.1, 0.5), tipT(-1), tipT(0), tipT(1), C.p(-2.6 * L, 1.1, 0.5)], TAIL_M);
  for (const i of [-1, 0, 1]) r.line(tb, tipT(i), WING[0], 0, 0.4);
  // Тело и крепление пружины под брюшком.
  r.ell(C, [0, 0, 0], [4.0 * L, 2.7, 2.8], BODY_M);
  r.ell(C.at(-0.8, 0, -2.4), [0, 0, 0], [1.1, 1.1, 0.6], BRASS_M);
  // Голова, клюв, глаз.
  const Hd = C.at(3.0 * L + o.hf, 0, 2.7 + o.hu).pitch(o.hp);
  r.ell(Hd, [0, 0, 0], [2.6, 2.4, 2.4], HEAD_M);
  const tip = Hd.p(4.7, 0, -0.2 + 0.2 * o.beak);
  r.cap(Hd.p(1.9, 0, 0.0), tip, 0.9 * SC, 0.25, BEAK_M);
  r.cap(Hd.p(1.9, 0, -0.55), Hd.p(3.9, 0, -0.85 - 1.5 * o.beak), 0.65 * SC, 0.2, {
    T: BEAK,
    bias: -0.25,
  });
  const sEye = Math.cos(yaw) >= 0 ? 1 : -1;
  for (const s of [-1, 1]) {
    // Глаз — на поверхности головы (виден и в фас, и в профиль).
    const e = Hd.p(2.6 * 0.6, s * 2.4 * 0.66, 2.4 * 0.45);
    r.dot(e, EYE, 0, 1, 0.5);
    if (s === sEye) r.eye = e;
    if (s === sEye && o.glint > 0) r.dot(e, GLINT, 0, 2, 0.45);
  }
  // Крылья: плоские резные пластины на плечах.
  for (const s of [-1, 1]) {
    const w = o.wing;
    const sh0 = C.p(1.3, s * 2.3, 1.0);
    const sh1 = C.p(-1.2, s * 2.5, 1.6 + w * 0.6);
    const tipW = C.p(
      lerp(-5.4, -2.6, w) - o.sweep,
      s * lerp(2.3, 7.0, w),
      lerp(0.5, 5.2, w) - Math.max(0, -o.sweep) * 0.8,
    );
    const mid = C.p(lerp(-2.4, -1.0, w) - o.sweep * 0.5, s * lerp(2.6, 5.2, w), lerp(-1.3, 0.8, w));
    r.poly([sh0, sh1, tipW, mid], WING_M);
    r.line(sh1, tipW, WING[3], 0, 0.3);
    for (const k of [0.35, 0.65]) {
      const a: V3 = [lerp(sh0[0], sh1[0], k), lerp(sh0[1], sh1[1], k), lerp(sh0[2], sh1[2], k)];
      const b: V3 = [lerp(mid[0], tipW[0], k), lerp(mid[1], tipW[1], k), lerp(mid[2], tipW[2], k)];
      r.line(a, b, WING[0], 0, 0.35);
    }
  }
  return { tip, body: C.p(0, 0, 0), ground: B.p(o.fx, 0, 0) };
}

// ---- Дорожки поз (24 к/с) ---------------------------------------------------

const CALL: KeyPose<CuO>[] = [
  [0, { fx: -3.5, len: 0.8, tail: 0.2, fan: 0.2 }],
  [0.08, { fx: 1.3, pitch: -0.12, tail: 1.0, wing: 0.25 }, easeOut],
  [0.13, { tail: 0.7 }],
  [0.18, { beak: 1, hu: 0.9, hf: 0.5, hp: -0.32, tail: -0.2, wing: 0.25 }, easeOut],
  [0.24, { tail: 0.7 }],
  [0.3, { beak: 1, hu: 0.9, hf: 0.5, hp: -0.32, tail: -0.2, wing: 0.25 }, easeOut],
  [0.38, { beak: 0.1, hp: 0.12, tail: 0.6 }],
  [0.46, { pitch: 0.05 }],
];

/** Прицел: втянулась в дверцу, пружина взведена; последние 0,25 с — блик и дрожь. */
const AIM: KeyPose<CuO>[] = [
  [0, { pitch: 0.05 }],
  [
    0.24,
    { fx: -3.0, len: 0.86, pitch: 0.22, hf: -0.6, hp: 0.15, tail: 1.4, fan: 0.6, sweep: 0.6 },
    easeOut,
  ],
  [0.5, { fx: -3.4, len: 0.84, pitch: 0.24, hf: -0.7, hp: 0.15, tail: 1.5, fan: 0.65, sweep: 0.6 }],
  [
    0.66,
    {
      fx: -4.2,
      len: 0.8,
      pitch: 0.26,
      hf: -0.8,
      hp: 0.18,
      tail: 1.9,
      fan: 0.8,
      sweep: 0.4,
      wing: 0.35,
      beak: 0.35,
    },
    easeIn,
  ],
  [
    0.76,
    {
      fx: -4.3,
      len: 0.8,
      pitch: 0.26,
      hf: -0.8,
      hp: 0.18,
      tail: 1.9,
      fan: 0.8,
      sweep: 0.4,
      wing: 0.4,
      beak: 0.45,
    },
  ],
];

/** Выстрел: кадр 0 — контакт (вытянута стрелой, клюв щёлкнул), дальше — отдача. */
const PECK: Partial<CuO>[] = [
  { len: 1.35, fx: 1.6, pitch: 0.1, hf: 1.2, hp: 0.08, beak: 0.2, sweep: 2.4, tail: 0.1, fan: 0.1 },
  { len: 1.16, fx: 1.0, pitch: 0.06, hf: 0.8, wing: 0.2, sweep: 1.6, tail: 0.3, fan: 0.2 },
  { len: 0.9, fx: 0.2, wing: 0.7, sweep: 0.2, tail: 0.9, fan: 0.5, hp: -0.1 },
  { len: 0.97, wing: 0.9, tail: 1.0, fan: 0.6, hp: -0.15, beak: 0.3 },
];
const OUT0: Partial<CuO>[] = [
  { wing: 0.75, len: 1.03, tail: 0.8, fan: 0.55, beak: 0.4, hp: -0.1 },
  { wing: 0.4, tail: 0.6, beak: 0.2 },
  { wing: 0.2, tail: 0.5 },
  { wing: 0.5 },
];
/** Висит: петля 12 кадров — два взмаха, кивок, «ку» раз в петлю. */
const OUT_LOOP = 12;

function outO(f: number): CuO {
  if (f < 4) return { ...C0, ...OUT0[f] };
  const u = (f - 4) / OUT_LOOP;
  const fl = Math.sin(u * TAU * 2);
  const ku = u > 0.6 && u < 0.86;
  return {
    ...C0,
    z: ZF + 0.6 * fl,
    wing: 0.45 + 0.45 * fl,
    sweep: -0.6 * Math.cos(u * TAU * 2),
    hu: 0.35 * Math.sin(u * TAU * 2 + 1.2) + (ku ? 0.5 : 0),
    hp: ku ? -0.28 : 0.05,
    beak: ku ? 0.85 : 0,
    tail: 0.6 - 0.35 * fl,
    fan: 0.45,
    roll: 0.12 * Math.sin(u * TAU),
  };
}

function hurtO(f: number): CuO {
  const k = f / 4;
  return {
    ...C0,
    z: ZF + (1 - k) * 0.8,
    len: lerp(0.84, 1, k),
    roll: 0.35 * (1 - k),
    hp: -0.35 * (1 - k),
    beak: 0.8 * (1 - k),
    wing: lerp(1, 0.45, k),
    sweep: -0.5 * (1 - k),
    tail: lerp(1.6, 0.6, k),
    fan: 0.7,
  };
}

/** Втягивает: дёрнуло за брюшко — нос кверху, крылья вперёд, кричит. */
function backO(f: number): CuO {
  const k = 1 - clamp01(tf(f) / CUCKOO.back);
  return {
    ...C0,
    z: lerp(ZD, ZF, k),
    fx: f >= 5 ? -1.6 * (f - 4) : 0,
    len: 1.05,
    pitch: lerp(-0.1, -0.42, k),
    wing: lerp(0.3, 1, k),
    sweep: lerp(-0.4, -2.0, k),
    tail: lerp(0.3, -0.4, k),
    fan: 0.6,
    beak: f < 4 ? 0.8 : 0.3,
    hp: -0.2,
  };
}

/** Смерть: подбросило, кувырком на пол, отскок, рассыпалась на резные куски. */
const DIE_T = 0.85;
function dieO(f: number): CuO {
  const t = tf(f);
  const z0 = ZF + 1.2;
  let z: number;
  if (t < 0.08) z = ZF + 1.2 * (t / 0.08);
  else if (t < 0.33) z = Math.max(ZG, z0 * (1 - ((t - 0.08) / 0.25) ** 2));
  else if (t < 0.45) z = ZG + 1.6 * Math.sin((PI * (t - 0.33)) / 0.12);
  else z = ZG;
  return {
    ...C0,
    z,
    roll: lerp(0.3, PI * 0.5, sstep(0.05, 0.33, t)),
    pitch: 0.5 * sstep(0.1, 0.33, t),
    len: t < 0.08 ? 0.85 : 1,
    wing: t < 0.33 ? 0.9 : 0.35,
    sweep: -0.5,
    beak: 0.8,
    hp: -0.3,
    tail: 0.2,
    fan: 0.7,
  };
}

function poseOf(anim: string, f: number): CuO {
  if (anim === 'call') return keyPose(tf(f), CALL, { ...C0, z: ZD });
  if (anim === 'aim') {
    const o = keyPose(tf(f), AIM, { ...C0, z: ZD });
    // Дрожь взведённой пружины: в удержании — через кадр, ближе к удару — сильнее.
    if (f >= 6) o.fx += (f & 1 ? 1 : -1) * (f >= 12 ? 0.55 : 0.3);
    o.glint = f >= 12 ? 1 : 0;
    return o;
  }
  if (anim === 'peck') return { ...C0, ...PECK[f] };
  if (anim === 'out') return outO(f);
  if (anim === 'hurt') return hurtO(f);
  if (anim === 'back') return backO(f);
  if (anim === 'die') return dieO(f);
  return C0;
}

// ---- Кадр ------------------------------------------------------------------

const KC = kindOf('cuckoo', 58, 50, 29, 40, 700);

function post(anim: string, f: number, o: RigOut, P: Proj2, pts: CPts): void {
  if (anim === 'peck' && f <= 1) {
    // Щелчок клюва: искры звездой у острия.
    const [x, y] = P(pts.tip);
    const xi = Math.round(x);
    const yi = Math.round(y);
    const R = f === 0 ? 2 : 1;
    spark2(o, xi, yi, SPARK, 0);
    for (let i = 1; i <= R; i++) {
      spark2(o, xi + i, yi, i === 1 ? SPARK : SPARK2, 0);
      spark2(o, xi, yi - i, SPARK2, 0);
      spark2(o, xi, yi + i, SPARK2, 0);
      spark2(o, xi - i, yi, SPARK2, 0);
    }
    if (f === 0) {
      spark2(o, xi + 2, yi - 2, SPARK2, 0);
      spark2(o, xi + 2, yi + 2, SPARK2, 0);
    }
  }
  if (anim === 'die') {
    const [gx, gy] = P(pts.ground);
    if (f >= 8 && f <= 11) spray(o.p, gx, gy, 8, 7, (f - 7) / 4, 31, DUST, 1, 1);
    if (f >= 11) {
      const k = clamp01((f - 10) / 8);
      spray(o.p, gx, gy - 1, 6, 9, easeOut(k), 47, CHIPS, 3, 2);
    }
  }
}

const cuPic = (anim: string, f: number, d: number): Pic => {
  const r = new Rig();
  const pts = birdRig(poseOf(anim, f), yawN(d), r);
  if (anim === 'die') {
    const k = sstep(0.45, 0.8, tf(f));
    if (k > 0) r.explode(k, pts.body, 7 + d, 7, 24, 0, 0.45);
  }
  return draw(KC, r, (o, P) => post(anim, f, o, P, pts));
};

/** Крепление пружины от точки земли птицы — на экране (по позе, без рига). */
function mountOf(anim: string, f: number, d: number): [number, number] {
  const o = poseOf(anim, f);
  const C = F3.yaw(yawN(d)).at(o.fx, 0, o.z).pitch(o.pitch).roll(o.roll).scale(SC);
  const q = proj(C.p(-0.8, 0, -2.6), 0, 0);
  return [q[0], q[1]];
}

// ---------------------------------------------------------------------------
// Пружина, след и тень — на холсте моба поверх кадра птицы из кеша.
// ---------------------------------------------------------------------------

/** Дверца часов над точкой гнезда на экране (с поправкой движка +2 у ног). */
const DOOR_Y = 15;
const COILS = 6;
const SPR = ['#4a3014', '#a0742a', '#f0c860'];
const SPR_GRAY = ['#3a3a38', '#7e7c78', '#c8c6c0'];

interface Cmp {
  c: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
}
const CMP = new WeakMap<Mob, Cmp>();
const PTS: number[][] = [[], [], []];

function cmpOf(m: Mob, w: number, h: number): Cmp | null {
  let e = CMP.get(m);
  if (!e) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    if (!g) return null;
    e = { c, g };
    CMP.set(m, e);
  } else if (e.c.width < w || e.c.height < h) {
    e.c.width = Math.max(e.c.width, w);
    e.c.height = Math.max(e.c.height, h);
  } else e.g.clearRect(0, 0, e.c.width, e.c.height);
  e.g.imageSmoothingEnabled = false;
  return e;
}

/** Пружина спиралью от (ax, ay) к (bx, by): ближняя половина витка светлее. */
function spring(
  g: CanvasRenderingContext2D,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  R: number,
  N: number,
  cols: string[],
): void {
  const dx = bx - ax;
  const dy = by - ay;
  const L = Math.hypot(dx, dy);
  if (L < 1 || N <= 0) return;
  const nx = -dy / L;
  const ny = dx / L;
  const steps = Math.ceil(L * 2 + N * R * 9);
  for (const b of PTS) b.length = 0;
  let lx = NaN;
  let ly = NaN;
  for (let i = 0; i <= steps; i++) {
    const s = i / steps;
    const ph = s * N * TAU;
    const sn = Math.sin(ph);
    const x = Math.floor(ax + dx * s + nx * R * sn);
    const y = Math.floor(ay + dy * s + ny * R * sn);
    if (x === lx && y === ly) continue;
    lx = x;
    ly = y;
    const cs = Math.cos(ph);
    PTS[cs > 0.55 ? 2 : cs > -0.25 ? 1 : 0].push(x, y);
  }
  for (let k = 0; k < 3; k++) {
    g.fillStyle = cols[k];
    const b = PTS[k];
    for (let j = 0; j < b.length; j += 2) g.fillRect(b[j], b[j + 1], 1, 1);
  }
}

/** След рывка: две нити вдоль пружины, к дверце гаснут. */
function streak(
  g: CanvasRenderingContext2D,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  k: number,
): void {
  const dx = bx - ax;
  const dy = by - ay;
  const L = Math.hypot(dx, dy);
  if (L < 4 || k <= 0) return;
  const nx = -dy / L;
  const ny = dx / L;
  g.fillStyle = '#fff2c0';
  for (const off of [-3, 3]) {
    let lx = NaN;
    let ly = NaN;
    for (let i = 0; i <= L; i++) {
      const s = i / L;
      const x = Math.floor(ax + dx * s + nx * off * (0.4 + 0.6 * s));
      const y = Math.floor(ay + dy * s + ny * off * (0.4 + 0.6 * s));
      if (x === lx && y === ly) continue;
      lx = x;
      ly = y;
      g.globalAlpha = k * (0.15 + 0.75 * s * s);
      g.fillRect(x, y, 1, 1);
    }
  }
  g.globalAlpha = 1;
}

interface Lay {
  /** Точка земли птицы от якоря моба (экран, целые). */
  bx: number;
  by: number;
  /** Дверца от якоря и доля пружины от неё (обрыв в смерти); null — без пружины. */
  door: [number, number] | null;
  part: number;
  mount: [number, number];
  coil: number;
  smear: number;
  /** Полуось тени (0 — без тени) и её густота. */
  shadow: number;
  sa: number;
  gray: boolean;
}

function compose(m: Mob, fr: MobFrame, L: Lay): MobFrame {
  const img = fr.img as HTMLCanvasElement;
  let x0 = Math.min(0, L.bx - fr.ax, L.bx - L.shadow - 1);
  let y0 = Math.min(0, L.by - fr.ay);
  let x1 = Math.max(0, L.bx - fr.ax + img.width, L.bx + L.shadow + 1);
  let y1 = Math.max(0, L.by - fr.ay + img.height, L.by + 3);
  if (L.door) {
    x0 = Math.min(x0, L.door[0] - 4);
    x1 = Math.max(x1, L.door[0] + 4);
    y0 = Math.min(y0, L.door[1] - 4);
    y1 = Math.max(y1, L.door[1] + 4);
  }
  x0 = Math.floor(x0) - 1;
  y0 = Math.floor(y0) - 1;
  const w = Math.ceil(x1) - x0 + 2;
  const h = Math.ceil(y1) - y0 + 2;
  const e = cmpOf(m, w, h);
  if (!e) return fr;
  const { c, g } = e;
  const ox = -x0;
  const oy = -y0;
  const bx = ox + L.bx;
  const by = oy + L.by;
  if (L.shadow > 0) {
    g.fillStyle = `rgba(0,0,0,${L.sa.toFixed(3)})`;
    g.beginPath();
    g.ellipse(bx, by, L.shadow, Math.max(1.2, L.shadow * 0.3), 0, 0, TAU);
    g.fill();
  }
  if (L.door) {
    const ax = ox + L.door[0];
    const ay = oy + L.door[1];
    const mx = bx + L.mount[0];
    const my = by + L.mount[1];
    if (L.smear > 0) streak(g, ax, ay, mx, my, L.smear);
    const k = L.part;
    spring(
      g,
      ax,
      ay,
      ax + (mx - ax) * k,
      ay + (my - ay) * k,
      L.coil,
      COILS * k,
      L.gray ? SPR_GRAY : SPR,
    );
  }
  g.drawImage(img, bx - fr.ax, by - fr.ay);
  return {
    img: c,
    ax: ox,
    ay: oy,
    eye: fr.eye ? [fr.eye[0] - fr.ax + bx, fr.eye[1] - fr.ay + by] : null,
    lit: null,
  };
}

// ---------------------------------------------------------------------------
// Рисовальщик.
// ---------------------------------------------------------------------------

let empty: MobFrame | null = null;
function emptyFrame(): MobFrame {
  if (empty) return empty;
  const c = document.createElement('canvas');
  c.width = 1;
  c.height = 1;
  empty = { img: c, ax: 0, ay: 0, eye: null, shadow: 0 };
  return empty;
}

/** Курс птицы: пружина бьёт только вниз; север — к ближнему боку. */
function faceOf(a: number): number {
  const s = Math.sin(a);
  const c = Math.cos(a);
  if (s >= 0) return Math.atan2(s, c);
  return c >= 0 ? 0 : PI;
}

const SPRUNG = new Set(['f14_peck', 'f14_out', 'f14_back', 'stun']);
/** Перелёт рисунка в выстреле: на конце пружины, с отдачей (клетки). */
const PECK_OVER = [0, 0.1, 0.06, 0.02];

registerMobPainter('f14_cuckoo', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = pose.t || 0;
  const now = pose.now || 0;
  const th = m.dir ?? m.face ?? 0;
  const tech = md !== 'f14_call' && md !== 'idle' && md !== 'f14_nest' && md !== 'chase';
  const v = visOf(m, pose, faceOf(tech ? th : (m.face ?? 0)), md === 'f14_call' ? 14 : 40);
  const d = dirN(faceOf(v.yaw));
  let anim = '';
  let f = 0;
  let gray = false;
  const ex: Partial<MobFrame> = { shadow: 0, still: true };
  const age = hurtAge(v, now);
  if (md === 'dying') {
    anim = 'die';
    f = fi(t, 20);
    ex.linger = DIE_T;
    ex.alpha = 1 - sstep(0.66, DIE_T, t);
  } else if (md === 'f14_frozen') {
    // Стоп-кадр (кукушку мозг не замораживает — на всякий случай): серая.
    if (SPRUNG.has(v.prev)) {
      anim = 'out';
      f = 4;
      gray = true;
    } else return emptyFrame();
  } else if (md === 'f14_call') {
    anim = 'call';
    f = fi(t, 10);
  } else if (md === 'aim') {
    anim = 'aim';
    f = fi(t, 17);
  } else if (md === 'f14_peck') {
    anim = 'peck';
    f = fi(t, 3);
  } else if (md === 'f14_out' || md === 'stun') {
    if (age < 0.21) {
      anim = 'hurt';
      f = fi(age, 4);
    } else {
      anim = 'out';
      const k = fi(t, 999);
      f = k < 4 ? k : 4 + ((k - 4) % OUT_LOOP);
    }
  } else if (md === 'f14_back') {
    anim = 'back';
    f = fi(t, 6);
  } else if (md === 'idle') {
    // Портрет бестиария: висит на пружине, лицом вправо.
    anim = 'out';
    f = 4;
  } else return emptyFrame();
  const fr = frameOf(KC, anim, f, d, pose, () => cuPic(anim, f, d), gray);
  if (!SPRUNG.has(md) && md !== 'dying' && md !== 'f14_frozen') return { ...fr, ...ex };
  // Пружина: длина — та же, что ведёт мозг (лист кадров не двигает моба).
  const len = m.data?.len ?? CUCKOO.len;
  const nx = m.data?.nx ?? m.x ?? 0;
  const ny = m.data?.ny ?? m.y ?? 0;
  const here = Math.hypot((m.x ?? 0) - nx, (m.y ?? 0) - ny);
  const dist =
    md === 'f14_peck'
      ? len * clamp01(t / CUCKOO.peck)
      : md === 'f14_out'
        ? len + Math.sin(t * 12) * 0.12 * (1 - t / CUCKOO.out)
        : md === 'f14_back'
          ? len * (1 - clamp01(t / CUCKOO.back))
          : here;
  const vis = md === 'f14_peck' ? len + PECK_OVER[f] : dist;
  const cx = Math.cos(th);
  const cy = Math.sin(th);
  // Удар героя: птицу на пружине отбрасывает, пружина тянется следом.
  const kn = age < 0.05 ? easeOut(age / 0.05) : age < 0.25 ? 1 - sstep(0.05, 0.25, age) : 0;
  const bx = Math.round((vis - dist) * 16 * cx + v.kx * 2.5 * kn);
  const by = Math.round((vis - dist) * 16 * cy + v.ky * 1.5 * kn);
  const z = poseOf(anim, f).z;
  const lay: Lay = {
    bx,
    by,
    door: [-dist * 16 * cx, -dist * 16 * cy - DOOR_Y],
    part: anim === 'die' ? clamp01(0.5 - f / 10) : 1,
    mount: mountOf(anim, f, d),
    coil: md === 'f14_peck' && f === 0 ? 0.8 : 1.6,
    smear: md === 'f14_peck' ? [0.9, 0.5, 0.2, 0][f] : 0,
    shadow: 2.6 + 2.4 * (1 - clamp01(z / ZD)),
    sa: 0.2 + 0.14 * (1 - clamp01(z / ZD)),
    gray,
  };
  if (lay.part <= 0) lay.door = null;
  return { ...compose(m, fr, lay), ...ex };
});

// ---------------------------------------------------------------------------
// Прогрев: всё, что играет, — в 5 сторонах (на север пружина не бьёт).
// ---------------------------------------------------------------------------

const SIDES = [0, 1, 2, 3, 4];
const WARM: [string, number, number[]][] = [
  ['call', 11, SIDES],
  ['aim', 18, SIDES],
  ['peck', 4, SIDES],
  ['out', 4 + OUT_LOOP, SIDES],
  ['hurt', 5, SIDES],
  ['back', 7, SIDES],
  ['die', 21, SIDES],
];

regWarm(
  'f14_cuckoo',
  function* () {
    yield* warmAll(KC, WARM, cuPic);
  },
  [[KC, demOf(WARM, cuPic)]],
);
