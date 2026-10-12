// Этаж 14: Хранитель стрелок (анимации мобов 14). Тяжёлый часовой: латунный
// шлем-колокол со шпилем и щелью глаз, тёмно-синий сюртук с латунной каймой,
// эполеты, фалды; на груди — циферблат, его стрелки идут. В правой руке —
// минутная стрелка-копьё (воронёная, с остриём-стрелой и кольцом-противовесом),
// в левой — часовая стрелка-булава (латунная, с пиковым навершием).
//
// Мозг (`f14-brains.ts`, `KEEPER`): погоня (у героя — вполсилы);
// `f14_hour` 0,8 — булава заносится за голову и бьёт в круг перед собой, урон
// в конце → `recover` 0,8 (кадр контакта — первый кадр `recover`: навершие в
// полу, пыль кольцом); `f14_minute` ≈1,01 — копьё отводится влево и ТИКАЕТ
// вправо тремя щелчками, как минутная стрелка: каждый щелчок — линия урона
// (0,6 / 0,78 / 0,96), затем `recover` 0,8; `f14_haste` 0,7 — переводит часы на
// груди (стрелки бегут, циферблат разгорается), в конце — сфера ускорения.

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

const NAVY = tn('#0a0e1c', '#18223e', '#2a3a64', '#44598e');
const NAVY_D = tn('#06080e', '#10141e', '#1c2232', '#2c344a');
const BRASS = tn('#3a2410', '#7a5220', '#b8862e', '#f0c860');
const BLUED = tn('#0c1220', '#1e3258', '#3c64a0', '#a8d0f8');
const GLOVE = tn('#5a5448', '#a09a8c', '#dcd8cc', '#ffffff');
const BOOT = tn('#050506', '#121216', '#24242c', '#3c3c48');
const DIAL = tn('#5a564c', '#a09a8a', '#ddd4c0', '#fffaf0');
const DIAL_HOT = tn('#a0601c', '#e0a040', '#ffd890', '#fff8e0');
const IRON = tn('#0e1014', '#262a32', '#4a505c', '#7c8490');
const INKD = hx('#0a0806');
const EYE = hx('#ffe9a0');
const EYE_OFF = hx('#3a3020');
const LANCE_HI = hx('#7eb0ec');
const AMBER = hx('#ffb040');
const SPARK = hx('#fff4d0');
const SPARK2 = hx('#ffc860');
const EDGE = hx('#e4f0ff');
const DUST: RGBA[] = [hx('#6a5a48'), hx('#8a7a64'), hx('#4a3e32')];
const SHARD: RGBA[] = [hx('#fffaf0'), hx('#ddd4c0'), hx('#f0c860')];

const frac = (x: number) => x - Math.floor(x);
const band = (T: Tones, l: number): RGBA =>
  l > 0.78 ? T[3] : l > 0.38 ? T[2] : l > -0.02 ? T[1] : T[0];

// ---- Поза -------------------------------------------------------------------

interface KpO {
  /** Шаг: фаза, размах 0…1, стойка шире. */
  ph: number;
  step: number;
  wide: number;
  /** Присед, подскок, корпус вперёд, наклон (+ вперёд), крен, поворот плеч (+ вправо), кивок. */
  crouch: number;
  lift: number;
  fx: number;
  lean: number;
  roll: number;
  tw: number;
  nod: number;
  /** Правая рука: курс (+ вправо), подъём (− вниз), вынос; копьё: подъём, курс от руки. */
  ly: number;
  ae: number;
  ex: number;
  lp: number;
  lyo: number;
  /** Левая рука-булава: угол от «вниз» (π/2 — вперёд, π — вверх), кисть, развод; рука к циферблату. */
  ma: number;
  mo: number;
  ms: number;
  hd: number;
  /** Циферблат на груди: стрелки, накал 0…1, разбит. */
  dial: number;
  glow: number;
  shat: number;
  /** Фалды: назад (+) / вперёд, вбок. */
  tail: number;
  tailS: number;
  eye: number;
  /** Смерть: падает ничком 0…1; шлем слетел 0…1. */
  fall: number;
  helm: number;
}

const K0: KpO = {
  ph: 0,
  step: 0,
  wide: 0,
  crouch: 0,
  lift: 0,
  fx: 0,
  lean: 0.03,
  roll: 0,
  tw: 0,
  nod: 0,
  ly: 0.35,
  ae: -0.95,
  ex: 6,
  lp: 1.32,
  lyo: -0.1,
  ma: 0.12,
  mo: 0.45,
  ms: -0.25,
  hd: 0,
  dial: 0,
  glow: 0,
  shat: 0,
  tail: 0,
  tailS: 0,
  eye: 1,
  fall: 0,
  helm: 0,
};

const kp = (T: number, keys: KeyPose<KpO>[], base: KpO = K0) => keyPose(T, keys, base);

// ---- Материалы --------------------------------------------------------------

/** Сюртук: латунный кант по борту, ряд пуговиц. */
const coatM: Mat = {
  T: NAVY,
  bias: 0.04,
  pat: (q, l) => {
    if (q[0] > 0.25 && Math.abs(q[1]) < 0.07) return band(BRASS, l - 0.15);
    if (q[0] > 0.6 && Math.abs(q[1] + 0.22) < 0.07 && frac(q[2] * 3.2) < 0.4) return band(BRASS, l);
    return null;
  },
};
/** Полы и фалды: кант по низу. */
const skirtM: Mat = {
  T: NAVY,
  bias: 0.02,
  pat: (q, l) =>
    q[2] < -0.78 || (q[0] > 0.3 && Math.abs(q[1]) < 0.08) ? band(BRASS, l - 0.2) : null,
};
const sleeveM: Mat = { T: NAVY, bias: 0.06 };
const legM: Mat = { T: NAVY_D, bias: 0.04 };
const bootM: Mat = { T: BOOT, spec: true };
const gloveM: Mat = { T: GLOVE, bias: 0.05 };
const brassM: Mat = { T: BRASS, spec: true };
const bluedM: Mat = { T: BLUED, spec: true, bias: 0.06 };
const beltM: Mat = {
  T: NAVY_D,
  pat: (q, l) => (q[0] > 0.8 && Math.abs(q[1]) < 0.25 ? band(BRASS, l + 0.1) : null),
};
/** Шлем-колокол: щель глаз спереди, обод. */
const helmM: Mat = {
  T: BRASS,
  spec: true,
  pat: (q) => {
    if (q[0] > 0.4 && q[2] > -0.36 && q[2] < -0.06 && Math.abs(q[1]) < 0.62) return INKD;
    if (q[2] < -0.72) return BRASS[1];
    return null;
  },
};
/** Эполет с бахромой. */
const epM: Mat = {
  T: BRASS,
  spec: true,
  pat: (q, l) =>
    q[2] < -0.2 && frac(Math.atan2(q[1], q[0]) * 2.2) < 0.5 ? band(BRASS, l - 0.5) : null,
};

/** Циферблат на груди: минутная и часовая стрелки; накал — янтарём. */
function dialM(rot: number, rs: number, glow: number, shat: number): Mat {
  const ca = Math.cos(rot);
  const sa = Math.sin(rot);
  const cb = Math.cos(rs);
  const sb = Math.sin(rs);
  const T = glow > 0.5 ? DIAL_HOT : DIAL;
  return {
    T,
    glow: glow > 0.05 ? 0.6 * glow : 0,
    bias: 0.3,
    pat: (q, l) => {
      const rr = Math.hypot(q[1], q[2]);
      if (rr > 0.8) return band(BRASS, l);
      if (
        shat > 0.5 &&
        (Math.abs(q[1] - q[2] * 0.4 + 0.1) < 0.07 || Math.abs(q[2] + q[1] * 0.7) < 0.06)
      )
        return IRON[0];
      // Минутная (длинная) и часовая (короткая) стрелки.
      const x1 = q[1] * ca + q[2] * sa;
      const y1 = -q[1] * sa + q[2] * ca;
      if (Math.abs(x1) < 0.16 && y1 > -0.05 && y1 < 0.7) return IRON[1];
      const x2 = q[1] * cb + q[2] * sb;
      const y2 = -q[1] * sb + q[2] * cb;
      if (Math.abs(x2) < 0.17 && y2 > -0.05 && y2 < 0.44) return IRON[1];
      if (rr > 0.62 && frac(Math.atan2(q[2], q[1]) * (6 / PI)) < 0.2) return band(T, l - 0.4);
      return null;
    },
  };
}

// ---- Риг --------------------------------------------------------------------

const LEG1 = 6.2;
const LEG2 = 6.0;
/** Ход ступни за цикл шага, пикс.; цикл — клеток пути. */
const STR = 9;
const STRIDE_C = 1.1;
/** Копьё: от кисти назад (противовес), вперёд; булава: от кисти. */
const L_BACK = 4.5;
const L_FWD = 11;
const L_TIP = 4.6;
const M_LEN = 7.6;

const lerpF = (a: F3, b: F3, k: number): F3 =>
  new F3(
    vlerp(a.o, b.o, k),
    vnorm(vlerp(a.f, b.f, k)),
    vnorm(vlerp(a.s, b.s, k)),
    vnorm(vlerp(a.u, b.u, k)),
  );

interface KFr {
  B: F3;
  P: F3;
  T: F3;
  hR: V3;
  dL: V3;
  hL: V3;
  dM: V3;
}

/** Рамки и кисти: ноги, таз, корпус; правая кисть и копьё, левая кисть и булава. */
function frames(o: KpO, yaw: number): KFr {
  const B = F3.yaw(yaw);
  const hipZ = LEG1 + LEG2 - 1.2 - o.crouch + o.lift - 6.5 * smooth(clamp01(o.fall));
  const P = B.at(o.fx, 0, hipZ)
    .roll(o.roll)
    .pitch(o.lean + 1.25 * easeIn(o.fall));
  const T = P.turn(o.tw).at(0, 0, 1.2);
  const shR = T.p(0.2, 4.6, 10.6);
  const ca = Math.cos(o.ae);
  const hR = vadd(shR, vmul(T.v(ca * Math.cos(o.ly), ca * Math.sin(o.ly), Math.sin(o.ae)), o.ex));
  const la = o.ly + o.lyo;
  const cp = Math.cos(o.lp);
  const dL = T.v(cp * Math.cos(la), cp * Math.sin(la), Math.sin(o.lp));
  const shL = T.p(0.2, -4.6, 10.6);
  let hL = vadd(shL, vmul(vnorm(T.v(Math.sin(o.ma), -0.22, -Math.cos(o.ma))), 6.4));
  if (o.hd > 0) hL = vlerp(hL, T.p(4.2, -1.2, 9.2), smooth(clamp01(o.hd)));
  const dM = vnorm(T.v(Math.sin(o.ma + o.mo), o.ms, -Math.cos(o.ma + o.mo)));
  return { B, P, T, hR, dL, hL, dM };
}

interface KPts {
  tipL: V3;
  hR: V3;
  head: V3;
  hL: V3;
  dial: V3;
  base: V3;
  helm: V3;
}

function keepRig(o: KpO, yaw: number, r: Rig): KPts {
  const { B, P, T, hR, dL, hL, dM } = frames(o, yaw);
  // Ноги: тёмные штаны, сапоги; колено вперёд.
  for (const sd of [-1, 1]) {
    const hip = P.p(0, sd * 2.0, 0);
    const [off, rise] = gait(o.ph + (sd > 0 ? 0.5 : 0));
    const st = sd < 0 ? o.wide : -o.wide * 0.7;
    const foot = B.p(
      o.fx * 0.5 + off * STR * o.step + st,
      sd * (2.3 + 0.3 * o.wide),
      rise * 2.6 * o.step,
    );
    const knee = ik(hip, foot, LEG1, LEG2, B.v(1, sd * 0.2, 0));
    r.cap(hip, knee, 1.75, 1.4, legM);
    r.cap(knee, foot, 1.4, 1.15, bootM);
    r.cap(vadd(foot, B.v(-0.9, 0, 0.5)), vadd(foot, B.v(2.0, 0, 0.35)), 1.05, 0.8, bootM);
  }
  // Полы сюртука и фалды (отстают).
  r.ell(P, [-0.1, 0, -0.4], [4.0, 4.9, 5.4], skirtM, (q) => q[2] > 0.1 || q[0] > 0.55);
  for (const sd of [-1, 1])
    r.cap(
      P.p(-3.0, sd * 1.5, 0.4),
      P.p(-3.6 - 1.6 * o.tail, sd * 1.9 + o.tailS, -6.2 + 0.8 * Math.abs(o.tail)),
      1.25,
      0.7,
      skirtM,
    );
  // Корпус, пояс с пряжкой, ворот.
  r.ell(T, [0, 0, 5.4], [3.5, 4.6, 6.6], coatM);
  r.ell(T, [0, 0, 0.6], [3.75, 4.75, 0.75], beltM);
  r.ell(T, [0.6, 0, 11.6], [2.4, 2.8, 1.1], brassM);
  // Циферблат на груди.
  const Df = T.at(3.3, 0, 6.4).pitch(-0.25);
  r.ell(
    Df,
    [0, 0, 0],
    [1.0, 3.1, 3.1],
    dialM(o.dial, 2.2 + (o.glow * o.dial) / 12, o.glow, o.shat),
  );
  const dialP = Df.p(0.8, 0, 0);
  // Эполеты.
  for (const sd of [-1, 1]) r.ell(T, [0.1, sd * 4.7, 10.4], [1.8, 1.9, 0.95], epM);
  // Шлем-колокол со шпилем (при смерти катится по полу).
  let Hh = T.at(0.3, 0, 15.6).pitch(o.nod);
  if (o.helm > 0) {
    const fl = F3.yaw(yaw - 0.9, B.p(o.fx + 11, 3.5, 2.6)).roll(1.35);
    Hh = lerpF(Hh, fl, smooth(clamp01(o.helm)));
  }
  r.ell(Hh, [0, 0, 0.3], [3.1, 3.15, 3.7], helmM, (q) => q[2] < -0.9);
  r.ell(Hh, [0, 0, -2.4], [3.75, 3.8, 0.8], brassM);
  r.cap(Hh.p(0, 0, 3.6), Hh.p(0, 0, 6.6), 0.62, 0.15, brassM);
  r.ball(Hh.p(0, 0, 6.8), 0.5, brassM);
  const eyeP = Hh.p(3.25, 0.5, -0.45);
  const lit = o.eye > 0.4 && o.helm < 0.3;
  r.line(
    Hh.p(3.2, -1.2, -0.45),
    Hh.p(3.2, 1.2, -0.45),
    lit ? EYE : EYE_OFF,
    lit ? 0.5 * o.eye : 0,
    0.9,
  );
  r.eye = lit ? eyeP : null;
  // Руки: рукав, латунный обшлаг, белая перчатка.
  for (const sd of [-1, 1]) {
    const sh = T.p(0.2, sd * 4.6, 10.6);
    const hand = sd > 0 ? hR : hL;
    const el = ik(sh, hand, 4.8, 4.8, T.v(-0.8, sd * 1.2, -0.4));
    r.cap(sh, el, 1.45, 1.2, sleeveM);
    r.cap(el, hand, 1.2, 1.05, sleeveM);
    r.ball(vlerp(el, hand, 0.78), 1.2, brassM);
    r.ball(hand, 1.05, gloveM);
  }
  // Минутная стрелка-копьё: кольцо-противовес, вал, остриё-стрела.
  const butt = vsub(hR, vmul(dL, L_BACK));
  r.ball(butt, 1.0, bluedM);
  r.cap(butt, vadd(hR, vmul(dL, L_FWD)), 0.5, 0.5, bluedM);
  const tipB = vadd(hR, vmul(dL, L_FWD));
  r.spike(tipB, dL, L_TIP, 1.5, bluedM, 4, 0.785);
  // Блик по верхней грани: синее копьё не тонет в тёмно-синем мундире.
  const up: V3 = [0, 0, 0.45];
  r.line(vadd(hR, up), vadd(vadd(tipB, vmul(dL, L_TIP * 0.7)), up), LANCE_HI, 0, 0.5);
  // Часовая стрелка-булава: латунный вал, пиковое навершие.
  const mB = vsub(hL, vmul(dM, 1.4));
  r.cap(mB, vadd(hL, vmul(dM, M_LEN)), 0.62, 0.62, brassM);
  const ax = vnorm(vcross(dM, T.s));
  const MF = new F3(vadd(hL, vmul(dM, M_LEN + 1.6)), dM, T.s, ax);
  r.ell(MF, [0, 0, 0], [2.1, 1.85, 1.3], brassM);
  r.spike(MF.p(1.6, 0, 0), dM, 2.4, 1.0, brassM, 4);
  return {
    tipL: vadd(tipB, vmul(dL, L_TIP)),
    hR,
    head: MF.p(0.5, 0, 0),
    hL,
    dial: dialP,
    base: B.p(o.fx * 0.4, 0, 0),
    helm: Hh.p(0, 0, 0),
  };
}

// ---- Треки ------------------------------------------------------------------

const tf = (f: number) => (f + 0.5) / FPS;
const HOUR_T = 0.8;
const DIE_T = 0.85;
/** Щелчки минутной стрелки: время урона, курс стрелки (от лица). */
const TICKS: [number, number][] = [
  [0.6, -0.55],
  [0.78, 0],
  [0.96, 0.55],
];

/** Часовая: булава за голову, держит, бьёт в круг перед собой. */
function hourO(T: number, f: number): KpO {
  const o = kp(T, [
    [0, {}],
    [
      0.2,
      {
        ma: 1.7,
        mo: 0.6,
        lean: -0.08,
        crouch: 0.6,
        wide: 1.2,
        ly: 0.9,
        ae: -1.0,
        lp: 1.0,
        tw: -0.2,
      },
      easeOut,
    ],
    [
      0.5,
      {
        ma: 3.35,
        mo: 0.75,
        ms: -0.05,
        lean: -0.22,
        lift: 0.8,
        crouch: 0,
        wide: 2.0,
        ly: 0.75,
        ae: -0.9,
        lp: 0.9,
        tw: -0.35,
        nod: -0.15,
        tail: -0.5,
      },
    ],
    [
      0.68,
      {
        ma: 3.45,
        mo: 0.8,
        ms: -0.05,
        lean: -0.25,
        lift: 0.9,
        wide: 2.1,
        ly: 0.75,
        ae: -0.9,
        lp: 0.9,
        tw: -0.38,
        nod: -0.18,
        tail: -0.6,
      },
    ],
    [
      HOUR_T,
      {
        ma: 1.1,
        mo: -0.35,
        ms: 0.1,
        lean: 0.42,
        crouch: 2.8,
        wide: 2.4,
        fx: 1.4,
        ly: 0.6,
        ae: -0.8,
        lp: 0.7,
        tw: 0.22,
        nod: 0.25,
        tail: 0.8,
      },
      easeIn,
    ],
  ]);
  if (f >= 12 && f <= 15) o.ma += f % 2 ? 0.03 : -0.03;
  o.dial = T * 0.8;
  return o;
}

/** После удара часовой: навершие в полу, отдача, выдёргивает, назад в стойку. */
function hourFO(T: number): KpO {
  const o = kp(T, [
    [
      0,
      {
        ma: 1.0,
        mo: -0.45,
        ms: 0.1,
        lean: 0.5,
        crouch: 3.3,
        wide: 2.4,
        fx: 1.6,
        ly: 0.6,
        ae: -0.8,
        lp: 0.7,
        tw: 0.25,
        nod: 0.32,
        tail: 1.1,
      },
    ],
    [
      0.16,
      {
        ma: 1.04,
        mo: -0.42,
        ms: 0.1,
        lean: 0.44,
        crouch: 2.9,
        wide: 2.4,
        fx: 1.5,
        tw: 0.2,
        nod: 0.22,
        tail: -0.4,
        ly: 0.6,
        ae: -0.8,
        lp: 0.75,
      },
      easeOut,
    ],
    [
      0.42,
      {
        ma: 0.9,
        mo: 0.3,
        lean: 0.14,
        crouch: 1.0,
        wide: 1.4,
        fx: 0.8,
        tw: 0.05,
        tail: 0.3,
        ly: 0.5,
        lp: 1.0,
      },
    ],
    [0.8, {}],
  ]);
  o.dial = 0.64 + T * 0.8;
  return o;
}

/** Минутная: копьё отводится влево, тремя щелчками тикает вправо. */
function minO(T: number, f: number): KpO {
  const o = kp(T, [
    [0, {}],
    [
      0.3,
      {
        ly: -0.95,
        ae: -0.2,
        ex: 6.8,
        lp: -0.1,
        lyo: -0.3,
        tw: -0.55,
        lean: 0.04,
        crouch: 1.0,
        wide: 1.8,
        ma: 0.5,
        mo: 0.4,
        ms: -0.6,
        tail: -0.3,
      },
      easeOut,
    ],
    [
      0.56,
      {
        ly: -1.0,
        ae: -0.18,
        ex: 7.0,
        lp: -0.08,
        lyo: -0.3,
        tw: -0.6,
        lean: 0.06,
        crouch: 1.2,
        wide: 2.0,
        ma: 0.55,
        mo: 0.4,
        ms: -0.65,
        tail: -0.35,
      },
    ],
  ]);
  // Курс копья от лица: держит у левого края, затем щелчки с перелётом
  // (щелчок кончается к середине кадра контакта).
  let a = -1.3;
  if (T > 0.3 && T < 0.56) a = -1.3 + (f % 2 ? 0.03 : -0.03);
  for (const [t0, at] of TICKS) {
    const te = t0 - 0.012;
    const s0 = te - 0.035;
    if (T >= s0) {
      const k = (T - s0) / 0.035;
      const prev = at - 0.55 - (t0 === 0.6 ? 0.2 : 0);
      a =
        k < 1
          ? prev + (at - prev) * easeIn(k)
          : at + 0.14 * Math.exp(-(T - te) * 16) * Math.sin((T - te) * 38);
    }
  }
  // Плечи идут за копьём; копьё — на линию от лица (поправка на поворот плеч).
  if (T >= 0.56) o.tw = 0.45 * a;
  if (T >= 0.3) {
    o.ly = a - o.tw + 0.35;
    o.lyo = -0.35;
  }
  if (T >= 0.56) {
    o.ae = -0.15;
    o.ex = 7.2;
    o.lp = -0.06;
    o.lean = 0.12;
    o.crouch = 1.4;
    o.wide = 2.2;
    o.tail = -0.5 * a;
    o.tailS = -0.8 * a;
  }
  o.dial = T * 2;
  return o;
}

/** После минутной: копьё у правого края опадает, потом — в стойку. */
function minFO(T: number): KpO {
  return kp(T, [
    [
      0,
      {
        ly: 0.9,
        ae: -0.15,
        ex: 7.2,
        lp: -0.06,
        lyo: -0.35,
        tw: 0.25,
        lean: 0.12,
        crouch: 1.4,
        wide: 2.2,
        tail: -0.3,
        tailS: -0.45,
        ma: 0.55,
        mo: 0.4,
        ms: -0.65,
      },
    ],
    [
      0.2,
      {
        ly: 0.8,
        ae: -0.5,
        ex: 6.6,
        lp: -0.35,
        lyo: -0.2,
        tw: 0.15,
        lean: 0.16,
        crouch: 1.2,
        wide: 1.8,
        tail: 0.3,
        tailS: 0.2,
        nod: 0.15,
      },
      easeOut,
    ],
    [
      0.45,
      { ly: 0.55, ae: -0.8, lp: 0.4, tw: 0.05, lean: 0.08, crouch: 0.6, wide: 1.0, nod: 0.08 },
    ],
    [0.8, {}],
  ]);
}

/** Переводит часы: левая кисть на заводной головке, стрелки бегут, накал. */
function hasteO(T: number, f: number): KpO {
  const o = kp(T, [
    [0, {}],
    [
      0.15,
      {
        hd: 1,
        ma: 1.0,
        mo: -0.9,
        lean: -0.05,
        crouch: 0.8,
        wide: 1.0,
        nod: 0.2,
        ly: 0.2,
        lp: 1.45,
      },
      easeOut,
    ],
    [
      0.55,
      {
        hd: 1,
        ma: 1.0,
        mo: -0.9,
        lean: -0.08,
        crouch: 1.0,
        wide: 1.2,
        nod: 0.25,
        ly: 0.2,
        lp: 1.45,
      },
    ],
    [
      0.7,
      {
        hd: 0.3,
        ma: 0.6,
        mo: 0.2,
        lean: -0.15,
        crouch: -0.2,
        lift: 0.6,
        wide: 1.2,
        nod: -0.2,
        ly: 0.4,
        lp: 1.25,
        tail: -0.6,
      },
      easeOut,
    ],
  ]);
  o.dial = T * T * 26;
  o.glow = sstep(0.1, 0.55, T);
  o.eye = 1;
  if (f >= 4 && f <= 13) o.tw = f % 2 ? 0.05 : -0.05;
  return o;
}

function dieO(T: number): KpO {
  return kp(T, [
    [0, {}],
    [
      0.08,
      { lean: -0.3, nod: -0.3, shat: 1, eye: 0.3, fx: -1.2, ma: 0.7, ly: 0.8, lp: 0.9 },
      easeOut,
    ],
    [
      0.35,
      {
        lean: 0.15,
        crouch: 4.5,
        shat: 1,
        eye: 0.15,
        ma: 0.4,
        ly: 0.6,
        ae: -1.2,
        lp: 0.2,
        nod: 0.3,
        tail: -0.3,
      },
    ],
    [
      0.58,
      {
        fall: 1,
        crouch: 4.5,
        shat: 1,
        eye: 0,
        helm: 0.8,
        ma: 1.5,
        mo: 0.1,
        ly: 0.2,
        ae: 0.2,
        lp: 0.05,
        nod: 0.4,
        tail: 0.6,
      },
      easeIn,
    ],
    [
      DIE_T,
      {
        fall: 1,
        crouch: 4.5,
        shat: 1,
        eye: 0,
        helm: 1,
        ma: 1.5,
        mo: 0.1,
        ly: 0.2,
        ae: 0.2,
        lp: 0.05,
        nod: 0.4,
        tail: 0.3,
      },
    ],
  ]);
}

const SLEEP: Partial<KpO> = {
  nod: 0.42,
  crouch: 0.9,
  lean: 0.12,
  eye: 0.1,
  ly: 0.3,
  lp: 1.15,
  ma: 0.05,
};

function kpPose(anim: string, f: number): KpO {
  const T = tf(f);
  switch (anim) {
    case 'idle': {
      const a = (f / 16) * TAU;
      return {
        ...K0,
        crouch: 0.15 * (1 - Math.cos(a)),
        nod: 0.03 * Math.sin(a),
        lp: 1.32 + 0.03 * Math.sin(a),
        ma: 0.12 + 0.06 * Math.sin(a - 0.8),
        tail: 0.1 * Math.sin(a - 1.2),
        dial: (f / 16) * TAU,
      };
    }
    case 'walk': {
      const ph = f / 8;
      const a = ph * TAU;
      return {
        ...K0,
        ph,
        step: 1,
        lift: 0.55 * Math.abs(Math.cos(a)),
        roll: 0.05 * Math.sin(a),
        lean: 0.1,
        tw: -0.06 * Math.sin(a),
        ma: 0.12 + 0.28 * Math.sin(a - 0.6),
        lp: 1.28 + 0.04 * Math.cos(2 * a),
        tail: 0.35 + 0.25 * Math.cos(2 * a - 0.8),
        tailS: 0.4 * Math.sin(a - 1.0),
        nod: 0.03 * Math.cos(2 * a),
      };
    }
    case 'hour':
      return hourO(Math.min(T, HOUR_T - 0.005), f);
    case 'hourF':
      return hourFO(T);
    case 'minute':
      return minO(T, f);
    case 'minF':
      return minFO(T);
    case 'haste':
      return hasteO(T, f);
    case 'flinch': {
      const k = f / 6;
      const b = Math.sin(PI * Math.min(1, k * 1.4)) * (1 - k * 0.5);
      return {
        ...K0,
        fx: -1.0 * b,
        lean: 0.03 - 0.26 * b,
        nod: -0.25 * b,
        crouch: 0.6 * b,
        ma: 0.12 + 0.6 * b,
        lp: 1.32 - 0.25 * b,
        ly: 0.35 + 0.3 * b,
        tail: 0.6 * b,
        eye: 1 - 0.5 * b,
      };
    }
    case 'die':
      return dieO(T);
    case 'sleep':
      return { ...K0, ...SLEEP, crouch: 0.9 + 0.2 * Math.sin((f / 4) * TAU) };
    case 'alert':
      return kp(T, [
        [0, SLEEP],
        [0.12, { nod: -0.2, lift: 0.7, lp: 1.45, ma: 0.5, tail: -0.4 }, easeOut],
        [0.35, {}],
      ]);
    case 'drop':
      return { ...K0, wide: 1.4, crouch: 0.4, lean: -0.15, ma: 1.4, lp: 1.0, ly: 0.9, tail: -0.8 };
    case 'land':
      return kp(T, [
        [0, { crouch: 3.0, wide: 2.0, lean: 0.25, ma: 0.9, tail: 1.0, nod: 0.2 }],
        [0.12, { crouch: 0.2, lift: 0.5, tail: -0.4 }, easeOut],
        [0.3, {}],
      ]);
  }
  return { ...K0 };
}

// ---- Кадр -------------------------------------------------------------------

const KK = kindOf('keeper', 88, 80, 44, 54, 1900);

/** Остриё копья для позы `o` (след щелчка). */
function lanceTip(o: KpO, yaw: number): [V3, V3] {
  const { hR, dL } = frames(o, yaw);
  return [vadd(hR, vmul(dL, L_FWD + L_TIP)), vadd(hR, vmul(dL, L_FWD * 0.45))];
}
/** Навершие булавы для позы `o` (след удара часовой). */
function maceHead(o: KpO, yaw: number): [V3, V3] {
  const { hL, dM } = frames(o, yaw);
  return [vadd(hL, vmul(dM, M_LEN + 2.4)), vadd(hL, vmul(dM, 1))];
}

function trail(
  o: RigOut,
  P: Proj2,
  poses: KpO[],
  yaw: number,
  fn: (o: KpO, yaw: number) => [V3, V3],
  c: RGBA,
): void {
  const tips: [number, number][] = [];
  const bases: [number, number][] = [];
  for (const q of poses) {
    const [a, b] = fn(q, yaw);
    const pa = P(a);
    const pb = P(b);
    tips.push([pa[0], pa[1]]);
    bases.push([pb[0], pb[1]]);
  }
  smear(o, tips, bases, c, 0.5);
}

function post(anim: string, f: number, d: number, o: RigOut, P: Proj2, pts: KPts): void {
  const yaw = yawN(d);
  const T = tf(f);
  if (anim === 'hour') {
    if (f === 14) {
      const [x, y] = P(pts.head);
      spark2(o, Math.round(x), Math.round(y) - 1, SPARK, 0.9);
      spark2(o, Math.round(x) - 1, Math.round(y) - 1, SPARK2, 0.4);
      spark2(o, Math.round(x) + 1, Math.round(y) - 1, SPARK2, 0.4);
    }
    if (f >= 17) {
      const ps: KpO[] = [];
      for (let i = 0; i <= 4; i++)
        ps.push(hourO(Math.min(HOUR_T - 0.005, T - 2 / FPS + (i * 2) / FPS / 4), 0));
      trail(o, P, ps, yaw, maceHead, hx('#ffe8b0', f === 19 ? 190 : 130));
    }
  }
  if (anim === 'hourF' && f < 9) {
    // Удар в пол: пыль кольцом, искры, трещины.
    const [x, y] = P([pts.head[0], pts.head[1], 0]);
    const k = (f + 1) / 9;
    spray(o.p, x, y + 1, 16, 14, easeOut(k), 71 + d, DUST, 0, 2);
    if (f < 3) {
      spark2(o, Math.round(x), Math.round(y), SPARK, 1);
      spark2(o, Math.round(x) - 2, Math.round(y) - 1, SPARK2, 0.8);
      spark2(o, Math.round(x) + 2, Math.round(y) - 1, SPARK2, 0.8);
      spark2(o, Math.round(x) + 1, Math.round(y) - 3, SPARK, 0.6);
    }
    if (f < 7)
      for (let i = 0; i < 5; i++) {
        const a = hash(i, d, 73) * TAU;
        for (let j = 1; j <= 3; j++)
          o.p.set(
            Math.round(x + Math.cos(a) * (2 + j * 1.3)),
            Math.round(y + Math.sin(a) * (1 + j * 0.7)),
            INKD,
          );
      }
  }
  if (anim === 'minute') {
    for (const [t0] of TICKS) {
      const fT = Math.floor(t0 * FPS);
      if (f === fT || f === fT + 1) {
        // Щелчок: след острия за кадр, искры храповика в кисти.
        const ps: KpO[] = [];
        for (let i = 0; i <= 4; i++) ps.push(minO(T - 1 / FPS + i / FPS / 4, f));
        trail(o, P, ps, yaw, lanceTip, hx('#c8e4ff', f === fT ? 200 : 110));
        if (f === fT) {
          const [x, y] = P(pts.hR);
          spark2(o, Math.round(x), Math.round(y) - 1, SPARK, 0.9);
          spark2(o, Math.round(x) + 1, Math.round(y) - 2, SPARK2, 0.6);
          const [tx, ty] = P(pts.tipL);
          spark2(o, Math.round(tx), Math.round(ty), EDGE, 0.8);
        }
      }
    }
  }
  if (anim === 'haste') {
    // Стрелки на груди бегут: янтарные искры кружат у циферблата, в конце — вспышка.
    const [cx, cy] = P(pts.dial);
    const n = 3 + Math.floor(f / 4);
    for (let i = 0; i < n; i++) {
      const a = f * 0.9 + (i / n) * TAU;
      const rr = 4 + (f >= 14 ? (f - 13) * 4 : 0);
      spark2(
        o,
        Math.round(cx + Math.cos(a) * rr),
        Math.round(cy + Math.sin(a) * rr * 0.6),
        AMBER,
        0.8,
      );
    }
    if (f >= 14) spark2(o, Math.round(cx), Math.round(cy), SPARK, 1);
  }
  if (anim === 'die') {
    const [cx, cy] = P(pts.dial);
    if (f === 2 || f === 3) {
      spark2(o, Math.round(cx), Math.round(cy), hx('#ffffff'), 1);
      spark2(o, Math.round(cx) + 1, Math.round(cy) - 1, SPARK, 0.8);
      spark2(o, Math.round(cx) - 1, Math.round(cy) + 1, SPARK, 0.8);
    }
    if (f >= 2 && f <= 10) {
      const k = (f - 2) / 8;
      for (let i = 0; i < 6; i++) {
        const a = hash(d, i, 41) * TAU;
        const dist = (3 + hash(i, d, 42) * 7) * easeOut(k * 1.2);
        const x = cx + Math.cos(a) * dist;
        const y = cy + Math.sin(a) * dist * 0.6 - 3 * Math.sin(PI * k) + k * k * 10;
        o.p.set(Math.round(x), Math.round(y), SHARD[i % 3]);
      }
    }
    if (f >= 9) {
      // Из разбитого циферблата выскакивают шестерёнки.
      const k = (f - 9) / 11;
      for (let i = 0; i < 3; i++) {
        const a = hash(d, i, 45) * TAU;
        const dist = (4 + hash(d, i, 46) * 7) * easeOut(k);
        const x = cx + Math.cos(a) * dist;
        const y = cy + Math.sin(a) * dist * 0.55 - Math.sin(PI * Math.min(1, k * 1.5)) * 5 + k * 5;
        if (i < 2) cog2(o.p, x, y, 1.9, 6, k * 6 + i, BRASS);
        else spark2(o, Math.round(x), Math.round(y), BRASS[3], 0);
      }
    }
    if (f === 13 || f === 14) {
      const [x, y] = P(pts.base);
      spray(o.p, x + 4, y, 12, 12, (f - 12) / 2, 77 + d, DUST, 1, 1);
    }
  }
  if (anim === 'land' && f < 6) {
    const [x, y] = P(pts.base);
    spray(o.p, x, y + 1, 12, 10, (f + 1) / 6, 81 + d, DUST, 1, 1);
  }
}

const kkPic = (anim: string, f: number, d: number): Pic => {
  const ko = kpPose(anim, f);
  const yaw = yawN(d);
  const r = new Rig();
  const pts = keepRig(ko, yaw, r);
  return draw(KK, r, (o, P) => post(anim, f, d, o, P, pts));
};

/** Режимы, где курс держит мозг (`m.face`). */
const TECH = new Set(['f14_hour', 'f14_minute', 'f14_haste', 'recover']);

registerMobPainter('f14_keeper', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = pose.t;
  const now = pose.now || 0;
  const want = TECH.has(md) ? (m.face ?? 0) : headOf(m);
  const v = visOf(m, pose, want, md === 'f14_hour' ? 10 : 5);
  const d = sideOf(v);
  const ex: Partial<MobFrame> = { shadow: 7 };
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
    // Стоп-кадр: застыл с булавой над головой (картина зала) или в стойке.
    gray = true;
    if (m.data?.frame) {
      anim = 'hour';
      f = 14;
    }
    ex.still = true;
  } else if (md === 'f14_hour') {
    anim = 'hour';
    f = fi(t, 19);
    ex.still = true;
    if (f >= 18) ex.ghost = { every: 0.03, life: 0.12, tint: '#ffe0a0', alpha: 0.22 };
  } else if (md === 'f14_minute') {
    anim = 'minute';
    f = fi(t, 24);
    ex.still = true;
    if (f >= 14) ex.ghost = { every: 0.04, life: 0.1, tint: '#c8e0ff', alpha: 0.18 };
  } else if (md === 'f14_haste') {
    anim = 'haste';
    f = fi(t, 16);
    ex.still = true;
  } else if (md === 'recover') {
    anim = v.prev === 'f14_minute' ? 'minF' : 'hourF';
    f = fi(t, 19);
    ex.still = true;
    if (anim === 'hourF' && f < 3) {
      ex.sx = 1 + 0.07 * (1 - f / 3);
      ex.sy = 1 - 0.08 * (1 - f / 3);
    }
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
    anim = 'die';
    f = 20 - Math.min(4, Math.floor(t * FPS)) * 5;
    ex.still = true;
  } else if (md === 'stun' || hurtAge(v, now) < 0.25) {
    anim = 'flinch';
    f = fi(md === 'stun' ? t : hurtAge(v, now), 5);
  } else if (md === 'sleep') {
    anim = 'sleep';
    f = Math.floor(idlePh(m, pose, 2.6) * 4) % 4;
  } else if (md === 'alert') {
    anim = 'alert';
    f = fi(t, 7);
  } else if (md === 'emerge' || moving(m, 0.4)) {
    anim = 'walk';
    f = Math.floor(frac(v.dist / STRIDE_C) * 8) % 8;
  } else {
    anim = 'idle';
    f = Math.floor(idlePh(m, pose, 2.0) * 16) % 16;
  }
  if (md !== 'dying' && !gray) hurtFx(v, now, 0.5, ex);
  return { ...frameOf(KK, anim, f, d, pose, () => kkPic(anim, f, d), gray), ...ex };
});

/** Всё, что играет в бою, — во всех 8 сторонах. */
const WARM: [string, number, number[]?][] = [
  ['walk', 8],
  ['idle', 16],
  ['hour', 20],
  ['hourF', 20],
  ['minute', 25],
  ['minF', 20],
  ['haste', 17],
  ['flinch', 6],
  ['die', 21],
  ['sleep', 4],
  ['alert', 8],
  ['drop', 1],
  ['land', 8],
];

registerMobWarm('f14_keeper', function* () {
  yield* warmAll(KK, WARM, kkPic);
  yield* warmGray(KK, [
    ['hour', [14]],
    ['idle', [0]],
  ]);
});
