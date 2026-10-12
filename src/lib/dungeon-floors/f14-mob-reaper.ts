// Этаж 14: Маятниковый жнец (анимации мобов 14). Высокий балахон с латунной
// каймой, в капюшоне вместо лица — циферблат; его стрелка-маятник качается
// вместе с большим. В костяных руках — маятник: латунный стержень с грузом-
// диском и лезвием-полумесяцем на конце (лезвие «Колодца и маятника»).
//
// Мозг (`f14-brains.ts`, `REAPER`): погоня; `f14_swing` 2,88 с — четыре такта
// по 0,72; в начале такта конус в свою сторону (`dir ± 0,62`, сторона
// чередуется от `m.data.side`), урон — через 0,55 после начала такта. Маятник
// качается настоящим маятником: конец замаха прошлого такта — уже замах
// следующего (лезвие висит у противоположного бока, корпус скручен к нему),
// затем срывается вниз через низ дуги и взлетает к своему боку; кадр контакта
// — лезвие в конусе на полном ходу. После серии `recover` 1,3 (урон ×1,4):
// маятник затухает двумя качаниями, жнец сгорблен и дышит.

import { registerMobPainter, registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import { vcross } from './f15-rig';
import {
  F3,
  FPS,
  PI,
  Rig,
  TAU,
  clamp01,
  cog2,
  draw,
  easeIn,
  easeOut,
  fi,
  frameOf,
  gait,
  hash,
  headOf,
  hurtAge,
  hurtFx,
  hx,
  idlePh,
  ik,
  keyPose,
  kindOf,
  lerp,
  moving,
  sideOf,
  smear,
  smooth,
  spark2,
  spray,
  sstep,
  tn,
  vadd,
  visOf,
  vlerp,
  vmul,
  vnorm,
  vsub,
  warmAll,
  warmGray,
  yawN,
} from './f14-mobkit';
import type { KeyPose, Mat, Pic, Proj2, RGBA, RigOut, Tones, V3 } from './f14-mobkit';

const ROBE = tn('#0c0a14', '#1e1a2c', '#342e4a', '#564e72');
const BRASS = tn('#3a2410', '#7a5220', '#b8862e', '#f0c860');
const BLADE = tn('#2e3644', '#6a7888', '#b4c2d0', '#f4faff');
const BONE = tn('#4a3e2c', '#8a7c5c', '#d0c4a4', '#fff4dc');
const DIAL = tn('#5a564c', '#a09a8a', '#ddd4c0', '#fffaf0');
const IRON = tn('#0e1014', '#262a32', '#4a505c', '#7c8490');
const EYE = hx('#ffb040');
const EYE_OFF = hx('#3a2410');
const EDGE = hx('#f4faff');
const SPARK = hx('#fff4d0');
const SPARK2 = hx('#ffc860');
const DUST: RGBA[] = [hx('#6a5a48'), hx('#8a7a64'), hx('#4a3e32')];
const SHARD: RGBA[] = [hx('#fffaf0'), hx('#ddd4c0'), hx('#f0c860')];

const frac = (x: number) => x - Math.floor(x);
const band = (T: Tones, l: number): RGBA =>
  l > 0.78 ? T[3] : l > 0.38 ? T[2] : l > -0.02 ? T[1] : T[0];

// ---- Поза -------------------------------------------------------------------

interface RpO {
  /** Шаг: фаза, размах 0…1. */
  ph: number;
  step: number;
  /** Корпус: вперёд, подскок, присед, наклон вперёд (+), крен, поворот плеч (+ — вправо). */
  fx: number;
  lift: number;
  crouch: number;
  lean: number;
  roll: number;
  tw: number;
  /** Капюшон кивает (+ вниз). */
  nod: number;
  /** Маятник: угол качания (+ — к правому боку), сдвиг рук вперёд, вбок, вверх. */
  sw: number;
  pvF: number;
  pvS: number;
  pvU: number;
  /** Подол: отстаёт вбок; раструб (приземление, смерть). */
  hem: number;
  flare: number;
  /** Стрелка циферблата-лица; глаз-ось 0…1; трещина циферблата. */
  dial: number;
  eye: number;
  crack: number;
  /** Смерть: балахон оседает 0…1; маятник падает на пол 0…1. */
  slump: number;
  fall: number;
}

const R0: RpO = {
  ph: 0,
  step: 0,
  fx: 0,
  lift: 0,
  crouch: 0,
  lean: 0.04,
  roll: 0,
  tw: 0,
  nod: 0.05,
  sw: 0,
  pvF: 0,
  pvS: 0,
  pvU: 0,
  hem: 0,
  flare: 0,
  dial: 0,
  eye: 1,
  crack: 0,
  slump: 0,
  fall: 0,
};

const kp = (T: number, keys: KeyPose<RpO>[], base: RpO = R0) => keyPose(T, keys, base);

/** Такт в другую сторону — та же поза в зеркале. */
const mirror = (o: RpO): RpO => ({
  ...o,
  sw: -o.sw,
  tw: -o.tw,
  roll: -o.roll,
  pvS: -o.pvS,
  hem: -o.hem,
  dial: -o.dial,
});

// ---- Материалы --------------------------------------------------------------

/** Балахон: латунная кайма по подолу, шов спереди, тёмные складки. */
function robeM(ph: number): Mat {
  return {
    T: ROBE,
    bias: 0.04,
    pat: (q, l) => {
      const az = Math.atan2(q[1], q[0]);
      if (q[2] > 0.085 && q[2] < 0.14)
        return frac(az * (8 / PI) + ph) < 0.55 ? band(BRASS, l - 0.2) : band(ROBE, l - 0.3);
      if (q[0] > 0.2 && Math.abs(q[1] - 0.12) < 0.07 && q[2] < 0.75) return band(BRASS, l - 0.3);
      if (frac(az * (5 / PI) + 0.25 + ph * 0.1) < 0.13) return band(ROBE, l - 0.45);
      return null;
    },
  };
}
const topM: Mat = {
  T: ROBE,
  bias: 0.06,
  pat: (q, l) => (q[0] > 0.3 && Math.abs(q[1] - 0.12) < 0.09 ? band(BRASS, l - 0.3) : null),
};
const hoodM: Mat = {
  T: ROBE,
  bias: 0.08,
  pat: (q, l) =>
    q[0] > 0.15 && q[2] < 0.7 && Math.abs(q[1]) < 0.88 ? band(BRASS, l - 0.15) : null,
};
const sleeveM: Mat = { T: ROBE, bias: 0.06 };
const brassM: Mat = { T: BRASS, spec: true };
const bladeM: Mat = { T: BLADE, spec: true, bias: 0.15 };
const boneM: Mat = { T: BONE, bias: 0.05 };
const bootM: Mat = { T: BONE, bias: -0.05 };
const bobM: Mat = {
  T: BRASS,
  spec: true,
  pat: (q, l) => {
    const rr = Math.hypot(q[0], q[1]);
    if (rr > 0.62 && rr < 0.78) return band(BRASS, l - 0.4);
    return null;
  },
};

/** Циферблат-лицо: стрелка-маятник из оси вниз качается с большим маятником. */
function dialM(rot: number, crack: number): Mat {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return {
    T: DIAL,
    bias: 0.1,
    pat: (q, l) => {
      const rr = Math.hypot(q[1], q[2]);
      if (rr > 0.8) return band(BRASS, l);
      if (crack > 0.5 && Math.abs(q[1] * 0.8 + q[2] * 0.6 - 0.12 * Math.sin(q[1] * 9)) < 0.08)
        return IRON[0];
      const x = q[1] * c + q[2] * s;
      const y = q[1] * s - q[2] * c;
      if (Math.abs(x) < 0.15 && y > -0.05 && y < 0.74) return IRON[1];
      if (Math.abs(q[1]) < 0.13 && q[2] > -0.05 && q[2] < 0.5) return IRON[1];
      return null;
    },
  };
}

// ---- Риг --------------------------------------------------------------------

/** Стержень маятника (от рук), радиус полумесяца, наклон плоскости качания вперёд. */
const ROD = 12.5;
const RB = 5.4;
const FW = 0.55;
const Q = 0.835;
/** Апекс лезвия от рук. */
const APEX = ROD - 2.6 + RB;
/** Ход ступни за цикл шага, пикс.; цикл — клеток пути. */
const STR = 5;
const STRIDE_C = 1.0;

const lerpF = (a: F3, b: F3, k: number): F3 =>
  new F3(
    vlerp(a.o, b.o, k),
    vnorm(vlerp(a.f, b.f, k)),
    vnorm(vlerp(a.s, b.s, k)),
    vnorm(vlerp(a.u, b.u, k)),
  );
const dot3 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

interface Fr {
  B: F3;
  C: F3;
  pv: V3;
  d: V3;
  t: V3;
}

/** Рамки: ноги (`B`), корпус (`C`), руки-ось маятника `pv`, стержень `d`, касательная качания `t`. */
function frames(o: RpO, yaw: number): Fr {
  const B = F3.yaw(yaw);
  const s = clamp01(o.slump);
  const C = B.at(o.fx, 0, 11.5 + o.lift - o.crouch - 9 * s)
    .pitch(o.lean)
    .roll(o.roll)
    .turn(o.tw);
  let pv = C.p(3.6 + o.pvF, o.pvS, 5.0 + o.pvU);
  let d = C.v(FW, Math.sin(o.sw) * Q, -Math.cos(o.sw) * Q);
  let t = C.v(0, Math.cos(o.sw), Math.sin(o.sw));
  if (o.fall > 0) {
    // Падает на пол: ложится вдоль пола справа-спереди, лезвие плашмя.
    const k = smooth(clamp01(o.fall));
    pv = vlerp(pv, B.p(o.fx + 2.5, -3.0, 1.2), k);
    d = vnorm(vlerp(d, B.v(0.45, 0.89, 0.02), k));
    const tf0 = vlerp(t, B.v(-0.89, 0.45, 0), k);
    t = vnorm(vsub(tf0, vmul(d, dot3(tf0, d))));
  }
  return { B, C, pv, d, t };
}

interface PPts {
  apex: V3;
  mid: V3;
  dial: V3;
  head: V3;
  base: V3;
  heap: V3;
}

function reapRig(o: RpO, yaw: number, r: Rig): PPts {
  const { B, C, pv, d, t } = frames(o, yaw);
  const s = clamp01(o.slump);
  // Башмаки из-под подола (шаг по пути).
  if (s < 0.5)
    for (const sd of [-1, 1]) {
      const [off, rise] = gait(o.ph + (sd > 0 ? 0.5 : 0));
      const foot = B.p(o.fx * 0.6 + 2.4 + off * STR * o.step, sd * 1.9, 0.7 + rise * 1.4 * o.step);
      r.ell(F3.yaw(yaw, foot), [0.6, 0, 0], [1.5, 0.8, 0.55], bootM);
    }
  // Балахон: колокол до плеч, рваный подол, раструб.
  const H = lerp(16, 3.2, s);
  const W = 1 + 0.45 * s + 0.12 * o.flare;
  const hph = o.ph * 2 + o.hem * 0.15;
  r.ell(B, [o.fx * 0.5 - 0.3, o.hem * 0.5, 0], [4.7 * W, 5.3 * W, H], robeM(hph), (q) => {
    if (q[2] < 0) return true;
    return q[2] < 0.075 && frac(Math.atan2(q[1], q[0]) * 1.4 + hph) < 0.45;
  });
  // Грудь и плечи, застёжка.
  r.ell(C, [0, 0, 3.6], [3.3, 4.3, 5.0], topM);
  r.ball(C.p(2.9, 0.4, 7.4), 0.75, brassM);
  // Капюшон с циферблатом (при смерти падает на кучу).
  let Hd = C.at(0.5, 0, 11.6).pitch(o.nod);
  if (s > 0.2) {
    const floor = F3.yaw(yaw + 0.5, B.p(o.fx + 3.2, -0.6, 2.4)).pitch(1.2);
    Hd = lerpF(Hd, floor, smooth((s - 0.2) / 0.8));
  }
  r.ell(
    Hd,
    [-0.3, 0, 0],
    [3.2, 3.25, 3.6],
    hoodM,
    (q) => q[0] > 0.3 && q[2] < 0.55 && Math.abs(q[1]) < 0.7,
  );
  r.cap(Hd.p(-1.8, 0, 2.2), Hd.p(-3.7, 0, 3.4), 1.4, 0.35, hoodM);
  const Df = Hd.at(0.75, 0, -0.45).pitch(-0.3);
  r.ell(Df, [0, 0, 0], [2.2, 2.5, 2.5], dialM(o.dial, o.crack));
  const eyeP = Df.p(2.25, 0, 0);
  const lit = o.eye > 0.4;
  r.dot(eyeP, lit ? EYE : EYE_OFF, lit ? o.eye : 0, 1, 0.9);
  r.eye = lit && s < 0.3 ? eyeP : null;
  // Руки: левая держит маятник у оси, правая — ниже по стержню.
  const grip2 = vadd(pv, vmul(d, 2.1));
  for (const sd of [-1, 1]) {
    const sh = C.p(0.4, sd * 3.9, 6.6);
    const hand = sd < 0 ? pv : grip2;
    const el = ik(sh, hand, 5.2, 5.0, C.v(-0.6, sd * 1.4, -0.8));
    r.cap(sh, el, 1.35, 1.1, sleeveM);
    r.cap(el, hand, 1.1, 1.0, sleeveM);
    r.ball(hand, 0.85, boneM);
  }
  // Маятник: навершие, стержень, груз-диск, полумесяц.
  const n = vcross(d, t);
  const PF = new F3(pv, d, t, n);
  r.ball(vsub(pv, vmul(d, 1.4)), 0.85, brassM);
  r.cap(vsub(pv, vmul(d, 1.0)), vadd(pv, vmul(d, ROD + 1.3)), 0.45, 0.42, brassM);
  r.ell(PF, [ROD * 0.55, 0, 0], [1.8, 1.8, 0.55], bobM);
  const Cc = PF.p(ROD - 2.6, 0, 0);
  const N = 9;
  let prev: V3 | null = null;
  let prevE: V3 | null = null;
  let wPrev = 0;
  for (let i = 0; i <= N; i++) {
    const a = -1.25 + (2.5 * i) / N;
    const w = 0.2 + 1.0 * (1 - (a / 1.25) ** 2);
    const u = vadd(vmul(d, Math.cos(a)), vmul(t, Math.sin(a)));
    const p = vadd(Cc, vmul(u, RB));
    const e = vadd(Cc, vmul(u, RB + w * 0.75));
    if (prev && prevE) {
      r.cap(prev, p, wPrev, w, bladeM);
      r.line(prevE, e, EDGE, 0, 0.7);
    }
    prev = p;
    prevE = e;
    wPrev = w;
  }
  return {
    apex: vadd(pv, vmul(d, APEX)),
    mid: vadd(pv, vmul(d, ROD * 0.5)),
    dial: eyeP,
    head: Hd.p(0, 0, 3.5),
    base: B.p(o.fx * 0.4, 0, 0),
    heap: B.p(o.fx * 0.5, 0, H * 0.6),
  };
}

// ---- Треки ------------------------------------------------------------------

const tf = (f: number) => (f + 0.5) / FPS;
const BEAT = 0.72;
const HIT = 0.55;
const DIE_T = 0.85;
/** Затухание после серии (по сторонам) и хвост «отдышался» на 12 к/с. */
const REC_TAIL = 19 / FPS;
const REC_T = 1.3;

/** Удар вправо (сторона +1); влево — `mirror`. Конец такта = начало следующего в зеркале. */
const SWB: KeyPose<RpO>[] = [
  [0, { sw: -1.6, tw: -0.3, lean: 0.02, roll: 0.03, fx: 0.3, pvS: -0.8, pvU: 0.8, crouch: 0.3 }],
  [
    0.13,
    {
      sw: -1.95,
      tw: -0.45,
      lean: -0.1,
      roll: 0.07,
      fx: -0.4,
      pvS: -1.3,
      pvU: 1.6,
      crouch: 0.6,
      nod: -0.08,
    },
    easeOut,
  ],
  [
    0.38,
    {
      sw: -1.9,
      tw: -0.5,
      lean: -0.13,
      roll: 0.08,
      fx: -0.6,
      pvS: -1.4,
      pvU: 1.8,
      crouch: 0.8,
      nod: -0.1,
    },
  ],
  [
    HIT,
    {
      sw: 0.57,
      tw: 0.28,
      lean: 0.17,
      roll: -0.03,
      fx: 1.0,
      pvS: 0.6,
      pvU: -0.8,
      crouch: 1.1,
      nod: 0.15,
    },
    easeIn,
  ],
  [
    BEAT,
    { sw: 1.6, tw: 0.3, lean: 0.02, roll: -0.03, fx: 0.3, pvS: 0.8, pvU: 0.8, crouch: 0.3 },
    easeOut,
  ],
];
/** Первый такт — из покоя: маятник чуть вперёд, затем взмах к противоположному боку. */
const SWA: KeyPose<RpO>[] = [
  [0, {}],
  [0.1, { sw: 0.35, tw: 0.12, pvS: 0.5, lean: 0.06, crouch: 0.3 }, easeOut],
  [0.3, { ...SWB[1][1] }],
  ...SWB.slice(2),
];

function swO(T: number, first: boolean): RpO {
  const keys = first ? SWA : SWB;
  const o = kp(T, keys);
  // Держит на вершине дуги — дрожь натуги.
  if (T > 0.17 && T < 0.38) {
    const j = Math.floor(T * FPS) % 2 ? 1 : -1;
    o.sw += 0.03 * j;
    o.pvU += 0.15 * j;
  }
  // Подол отстаёт от плеч на 3 кадра (до такта — прошлый такт в зеркале).
  const tl = T - 0.12;
  const twl = tl >= 0 ? kp(tl, keys).tw : first ? 0 : -kp(tl + BEAT, SWB).tw;
  o.hem = 3 * twl;
  o.dial = o.sw * 0.9;
  return o;
}

/** После серии: маятник затухает (сторона +1 — последний взмах ушёл вправо). */
function recO(T: number): RpO {
  const o = kp(T, [
    [0, { ...SWB[4][1] }],
    [
      0.25,
      { tw: 0.05, lean: 0.3, fx: 0.6, pvU: -2.2, crouch: 2.2, nod: 0.45, eye: 0.55, hem: -0.6 },
      easeOut,
    ],
    [0.95, { lean: 0.34, fx: 0.5, pvU: -2.4, crouch: 2.4, nod: 0.5, eye: 0.5 }],
    [REC_T, {}],
  ]);
  const A = 1.6 * Math.exp(-3.2 * T) * (1 - sstep(0.55, 0.8, T));
  o.sw = A * Math.cos((TAU * T) / 0.62);
  if (T > 0.25 && T < 1.05) {
    const b = Math.sin((T - 0.25) * TAU * 2.4) * (1 - sstep(0.85, 1.05, T));
    o.crouch += 0.35 * b;
    o.nod += 0.05 * b;
  }
  o.dial = o.sw * 0.9;
  return o;
}

function dieO(T: number): RpO {
  return kp(T, [
    [0, {}],
    [
      0.08,
      { lean: -0.35, nod: -0.45, pvU: 2.2, pvF: -1, sw: 1.3, crack: 1, eye: 0.3, fx: -0.8 },
      easeOut,
    ],
    [0.3, { slump: 0.45, lean: 0.25, nod: 0.5, fall: 0.35, sw: 0.7, crack: 1, eye: 0.1, fx: -0.3 }],
    [0.5, { slump: 0.92, lean: 0.45, nod: 0.9, fall: 1, crack: 1, eye: 0 }, easeIn],
    [0.6, { slump: 1, lean: 0.42, nod: 0.95, fall: 1, crack: 1, eye: 0, flare: 1 }, easeOut],
    [DIE_T, { slump: 1, lean: 0.42, nod: 0.95, fall: 1, crack: 1, eye: 0, flare: 1.2 }],
  ]);
}

function rpPose(anim: string, f: number): RpO {
  const T = tf(f);
  switch (anim) {
    case 'idle': {
      const a = (f / 16) * TAU;
      return {
        ...R0,
        sw: 0.3 * Math.sin(a),
        tw: 0.05 * Math.sin(a),
        roll: -0.02 * Math.sin(a),
        hem: -0.6 * Math.sin(a - 1),
        pvS: 0.3 * Math.sin(a),
        pvU: 0.25 * Math.cos(2 * a),
        crouch: 0.1 * (1 - Math.cos(2 * a)),
        dial: 0.27 * Math.sin(a),
        nod: 0.05 + 0.04 * Math.cos(2 * a),
      };
    }
    case 'walk': {
      const ph = f / 8;
      const a = ph * TAU;
      return {
        ...R0,
        ph,
        step: 1,
        lift: 0.35 * Math.abs(Math.cos(a)),
        roll: 0.04 * Math.sin(a),
        lean: 0.1,
        sw: 0.25 * Math.sin(a),
        tw: 0.06 * Math.sin(a),
        hem: -0.9 * Math.sin(a - 0.9),
        dial: 0.22 * Math.sin(a),
        pvU: 0.3 * Math.cos(2 * a),
      };
    }
    case 'swAR':
    case 'swAL':
    case 'swBR':
    case 'swBL': {
      const o = swO(T, anim[2] === 'A');
      return anim.endsWith('L') ? mirror(o) : o;
    }
    case 'recR':
    case 'recL': {
      const o = recO(T);
      return anim.endsWith('L') ? mirror(o) : o;
    }
    case 'rec':
      return recO(REC_TAIL + (f + 0.5) / 12);
    case 'flinch': {
      const k = f / 6;
      const b = Math.sin(PI * Math.min(1, k * 1.4)) * (1 - k * 0.5);
      return {
        ...R0,
        fx: -1.0 * b,
        lean: 0.04 - 0.3 * b,
        nod: 0.05 - 0.35 * b,
        pvU: 1.2 * b,
        pvF: -0.8 * b,
        sw: 0.35 * b,
        crouch: 0.5 * b,
        eye: 1 - 0.5 * b,
        hem: 0.5 * b,
        dial: 0.3 * b,
      };
    }
    case 'die':
      return dieO(T);
    case 'drop':
      return { ...R0, pvU: 2.2, lean: -0.12, flare: 1.4, crouch: -0.4, nod: -0.1 };
    case 'land':
      return kp(T, [
        [0, { crouch: 2.6, flare: 1.8, lean: 0.2, pvU: -1.5, nod: 0.3 }],
        [0.12, { lift: 0.4, flare: 0.4, pvU: 0.8, sw: 0.4, dial: 0.36 }, easeOut],
        [0.3, {}],
      ]);
  }
  return { ...R0 };
}

// ---- Кадр -------------------------------------------------------------------

const KRP = kindOf('reaper', 80, 68, 40, 50, 1700);

/** Апекс лезвия и середина стержня для позы `o` (след взмаха). */
function bladeAt(o: RpO, yaw: number): [V3, V3] {
  const { pv, d } = frames(o, yaw);
  return [vadd(pv, vmul(d, APEX)), vadd(pv, vmul(d, ROD * 0.45))];
}

function post(anim: string, f: number, d: number, o: RigOut, P: Proj2, pts: PPts): void {
  const yaw = yawN(d);
  const [ax, ay] = P(pts.apex);
  const X = Math.round(ax);
  const Y = Math.round(ay);
  if (anim.startsWith('sw')) {
    const L = anim.endsWith('L');
    if (f === 7) {
      // Блик на вершине дуги: лезвие занесено — сейчас сорвётся.
      spark2(o, X, Y, EDGE, 0.9);
      spark2(o, X - 1, Y, SPARK, 0.4);
      spark2(o, X + 1, Y, SPARK, 0.4);
      spark2(o, X, Y - 1, SPARK, 0.4);
    }
    if (f >= 12 && f <= 14) {
      // След: дуга апекса за последний кадр (контакт — за два с лишним).
      const T = tf(f);
      const span = f === 13 ? 2.3 / FPS : 1 / FPS;
      const tips: [number, number][] = [];
      const bases: [number, number][] = [];
      for (let i = 0; i <= 4; i++) {
        let oi = swO(T - span + (span * i) / 4, false);
        if (L) oi = mirror(oi);
        const [a, b] = bladeAt(oi, yaw);
        const pa = P(a);
        const pb = P(b);
        tips.push([pa[0], pa[1]]);
        bases.push([pb[0], pb[1]]);
      }
      smear(o, tips, bases, hx('#e8f2ff', f === 13 ? 200 : 120), 0.5);
    }
    if (f === 13) {
      spark2(o, X, Y, SPARK);
      spark2(o, X + 1, Y - 1, SPARK2, 0.7);
      spark2(o, X - 1, Y + 1, SPARK2, 0.7);
      spark2(o, X + 2, Y, SPARK, 0.5);
    }
  }
  if ((anim === 'recR' || anim === 'recL') && f < 10 && pts.apex[2] < 2.4) {
    // Лезвие чиркает по полу на дне дуги.
    spark2(o, X, Y, SPARK2, 0.7);
    spark2(o, X + (f % 2 ? 1 : -1), Y - 1, SPARK, 0.5);
    spray(o.p, X, Y + 1, 5, 5, 0.6, 51 + f + d, DUST, 1, 1);
  }
  if (anim === 'die') {
    const [cx, cy] = P(pts.dial);
    if (f === 1 || f === 2) {
      spark2(o, Math.round(cx), Math.round(cy), hx('#ffffff'), 1);
      spark2(o, Math.round(cx) + 1, Math.round(cy) - 1, SPARK, 0.8);
    }
    if (f >= 1 && f <= 9) {
      // Осколки стекла циферблата.
      const k = (f - 1) / 8;
      for (let i = 0; i < 5; i++) {
        const a = hash(d, i, 31) * TAU;
        const dist = (3 + hash(i, d, 32) * 6) * easeOut(k * 1.2);
        const x = cx + Math.cos(a) * dist;
        const y = cy + Math.sin(a) * dist * 0.6 - 3 * Math.sin(PI * k) + k * k * 9;
        o.p.set(Math.round(x), Math.round(y), SHARD[i % 3]);
      }
    }
    if (f === 12 || f === 13) {
      // Маятник лёг на пол: звон.
      spark2(o, X, Y, SPARK, f === 12 ? 1 : 0.6);
      spark2(o, X + 1, Y - 1, SPARK2, 0.7);
      spark2(o, X - 2, Y, SPARK2, 0.5);
    }
    if (f >= 8) {
      // Из-под балахона раскатываются шестерёнки.
      const k = (f - 8) / 12;
      const [hx0, hy0] = P(pts.heap);
      for (let i = 0; i < 3; i++) {
        const a = hash(d, i, 35) * TAU;
        const dist = (5 + hash(d, i, 36) * 6) * easeOut(k);
        const x = hx0 + Math.cos(a) * dist;
        const y = hy0 + Math.sin(a) * dist * 0.55 - Math.sin(PI * Math.min(1, k * 1.5)) * 4 + k * 4;
        if (i < 2) cog2(o.p, x, y, 1.8, 6, k * 5 + i, BRASS);
        else spark2(o, Math.round(x), Math.round(y), BRASS[3], 0);
      }
    }
  }
  if (anim === 'land' && f < 6) {
    const [x, y] = P(pts.base);
    spray(o.p, x, y + 1, 10, 9, (f + 1) / 6, 61 + d, DUST, 1, 1);
  }
}

const rpPic = (anim: string, f: number, d: number): Pic => {
  const ro = rpPose(anim, f);
  const yaw = yawN(d);
  const r = new Rig();
  const pts = reapRig(ro, yaw, r);
  return draw(KRP, r, (o, P) => post(anim, f, d, o, P, pts));
};

/** Режимы, где курс держит мозг (`m.face`). */
const TECH = new Set(['f14_swing', 'recover']);

registerMobPainter('f14_reaper', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = pose.t;
  const now = pose.now || 0;
  const want = TECH.has(md) ? (m.face ?? 0) : headOf(m);
  const v = visOf(m, pose, want, md === 'f14_swing' ? 8 : 6);
  const d = sideOf(v);
  const ex: Partial<MobFrame> = { shadow: 6 };
  const side0 = (m.data?.side ?? 1) < 0 ? -1 : 1;
  let anim = 'idle';
  let f = 0;
  let gray = false;
  if (md === 'dying') {
    anim = 'die';
    f = fi(t, 20);
    ex.linger = DIE_T;
    ex.alpha = 1 - sstep(0.7, DIE_T, t);
    ex.still = true;
  } else if (md === 'f14_frozen') {
    // Стоп-кадр: застыл на взмахе (картина зала) или в покое.
    gray = true;
    if (m.data?.frame) {
      anim = 'swBR';
      f = 13;
    }
    ex.still = true;
  } else if (md === 'f14_swing') {
    const beat = Math.min(3, Math.floor(t / BEAT));
    const sg = beat % 2 ? -side0 : side0;
    f = fi(t - beat * BEAT, 17);
    anim = (beat === 0 && f < 9 ? 'swA' : 'swB') + (sg > 0 ? 'R' : 'L');
    ex.still = true;
    if (f >= 11 && f <= 14) ex.ghost = { every: 0.03, life: 0.12, tint: '#c8d8ff', alpha: 0.22 };
    if (f === 13) {
      ex.sx = 1.04;
      ex.sy = 0.97;
    }
  } else if (md === 'recover') {
    // Последний такт серии — в сторону, обратную первому.
    if (t < REC_TAIL) {
      anim = side0 > 0 ? 'recL' : 'recR';
      f = fi(t, 18);
    } else {
      anim = 'rec';
      f = Math.min(6, Math.floor((t - REC_TAIL) * 12));
    }
    ex.still = true;
  } else if (md === 'drop') {
    anim = 'drop';
  } else if (md === 'stun' && v.prev === 'drop') {
    anim = 'land';
    f = fi(t, 7);
    if (f < 3) {
      ex.sx = 1 + 0.08 * (1 - f / 3);
      ex.sy = 1 - 0.1 * (1 - f / 3);
    }
  } else if (md === 'stun' && v.prev === '') {
    // Встаёт в зале отмотки: смерть задом наперёд.
    anim = 'die';
    f = 20 - Math.min(4, Math.floor(t * FPS)) * 5;
    ex.still = true;
  } else if (md === 'stun' || hurtAge(v, now) < 0.25) {
    anim = 'flinch';
    f = fi(md === 'stun' ? t : hurtAge(v, now), 5);
  } else if (md === 'emerge' || moving(m, 0.4)) {
    anim = 'walk';
    f = Math.floor(frac(v.dist / STRIDE_C) * 8) % 8;
  } else {
    anim = 'idle';
    f = Math.floor(idlePh(m, pose, 1.6) * 16) % 16;
  }
  if (md !== 'dying' && !gray) hurtFx(v, now, 0.6, ex);
  return { ...frameOf(KRP, anim, f, d, pose, () => rpPic(anim, f, d), gray), ...ex };
});

/** Всё, что играет в бою, — во всех 8 сторонах. */
const WARM: [string, number, number[]?][] = [
  ['walk', 8],
  ['idle', 16],
  ['swAR', 9],
  ['swAL', 9],
  ['swBR', 18],
  ['swBL', 18],
  ['recR', 19],
  ['recL', 19],
  ['rec', 7],
  ['flinch', 6],
  ['die', 21],
  ['drop', 1],
  ['land', 8],
];

registerMobWarm('f14_reaper', function* () {
  yield* warmAll(KRP, WARM, rpPic);
  yield* warmGray(KRP, [
    ['swBR', [13]],
    ['idle', [0]],
  ]);
});
