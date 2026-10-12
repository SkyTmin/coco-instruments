// Этаж 14 — «Часовщик» (анимации мобов 14).
//
// Редкий беглец с кладом: сгорбленный старик в зелёном козырьке, с
// моноклем и белой бородой, в зелёном сюртуке с кожаным фартуком; за спиной
// мешок, из горловины торчат циферблаты; в правой руке — карманные часы на
// цепочке. Мозг (`f14-brains.ts`, `f14_smith`): `flee` — удирает зигзагом;
// прижали (ближе 1,6) — `f14_blink` 0,4: часы к лицу, крышка щёлк, три
// щелчка заводной головкой, с 0,25 неуязвим — старик стекает в часы и
// пропадает; в конце режима он уже там, где золотое кольцо зоны, и
// проявляется из часов на бегу (`arrive`, 0,2 с). `escape` 0,4 — тот же
// уход в часы целиком. Удар героя — монеты сыплются из мешка, монокль
// выпадает на шнурке.
//
// Мини-3D (`f15-rig.ts`), 8 честных сторон (мешок за спиной, часы в правой
// руке — несимметричен). Бег — по пройденному пути, корпус смотрит по ходу
// (сторона с запасом у границы: зигзаг погони не дёргает вид). Мешок
// подпрыгивает на шаг позже тела, часы качаются на цепочке, фалды и козырёк
// отстают. Поза — 24 к/с от времени режима.
//
// Смерть 0,85 с (`linger`): удар отбрасывает, часы вылетают из руки и бьются
// о пол, колени подгибаются, старик падает ничком, мешок слетает и
// рассыпает монеты, тело рассыпается золотой пылью (`scatter` из
// `f14-art.ts`).

import { registerMobPainter, registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import { clear, scatter } from './f14-art';
import {
  F3,
  PI,
  Rig,
  TAU,
  clamp01,
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
  spark2,
  spray,
  sstep,
  stepPh,
  tf,
  tn,
  vadd,
  visOf,
  vlerp,
  warmAll,
  yawN,
} from './f14-mobkit';
import type { KeyPose, Mat, Pic, Proj2, RGBA, RigOut, V3 } from './f14-mobkit';

const COAT = tn('#162418', '#2a4430', '#46684e', '#6e9474');
const APRON = tn('#3a2414', '#5e3e24', '#8a5e3a', '#b0845a');
const SACK = tn('#3a2a14', '#6a5028', '#9a7a44', '#c8a468');
const SKIN = tn('#8a4a38', '#c88a70', '#f0c0a0', '#ffe4cc');
const BEARD = tn('#8a8478', '#c8c0b0', '#ece6d8', '#ffffff');
const VISOR = tn('#0a2a14', '#16502a', '#22743c', '#4aa868');
const PANTS = tn('#16120e', '#2e241a', '#4a3a2a', '#66523e');
const BOOT = tn('#0a0705', '#1c130c', '#322418', '#4c3826');
const BRASS = tn('#3a2410', '#7a5220', '#b8862e', '#f0c860');
const DIAL = tn('#a89a80', '#d8ccb0', '#f0e8d4', '#fffaf0');
const INKC = hx('#150f0b');
const GOLD = hx('#ffd040');
const GOLD2 = hx('#fff0a0');
const GLASS = hx('#e8f8ff');
const DUST: RGBA[] = [hx('#6a5a48'), hx('#8a7a64'), hx('#4a3e32')];
const COINS: RGBA[] = [hx('#ffd040'), hx('#f0b030'), hx('#fff0a0')];

const tone = (T: [RGBA, RGBA, RGBA, RGBA], l: number): RGBA =>
  l > 0.78 ? T[3] : l > 0.38 ? T[2] : l > -0.02 ? T[1] : T[0];

/** Сюртук: спереди кожаный фартук, наискось — лямка мешка. */
const COAT_M: Mat = {
  T: COAT,
  bias: 0.04,
  pat: (q, l) => {
    if (Math.abs(q[1] + q[2] * 0.95 - 0.05) < 0.17 && q[0] > -0.2) return tone(SACK, l - 0.15);
    if (q[0] > 0.42 && q[2] < 0.45 && Math.abs(q[1]) < 0.62) return tone(APRON, l);
    return null;
  },
};
/** Голова: лысина блестит, сзади и с боков — седой венчик. */
const HEAD_M: Mat = {
  T: SKIN,
  bias: 0.08,
  spec: true,
  pat: (q, l) => (q[0] < 0.25 && q[2] < 0.3 && q[2] > -0.75 ? tone(BEARD, l + 0.1) : null),
};
/** Мешок: мешковина в заплатах и стежках. */
const SACK_M: Mat = {
  T: SACK,
  bias: 0.02,
  pat: (q, l) => {
    if (Math.abs(q[2] - 0.15 + q[1] * 0.25) < 0.06) return SACK[0];
    if (q[0] < -0.35 && q[1] > 0.05 && q[1] < 0.55 && q[2] > -0.45 && q[2] < 0.15)
      return tone(APRON, l - 0.05);
    return null;
  },
};
/** Циферблат: кремовый, латунный обод, две стрелки. */
const dialM = (rot: number): Mat => ({
  T: DIAL,
  bias: 0.15,
  pat: (q, l) => {
    const r = Math.hypot(q[1], q[2]);
    if (Math.abs(q[0]) < 0.6 || r > 0.78) return tone(BRASS, l + 0.1);
    const a = Math.atan2(q[2], q[1]);
    const d1 = Math.abs(((a - rot + PI) % TAU) - PI);
    if (r < 0.62 && d1 < 0.32) return INKC;
    if (r < 0.42 && Math.abs(((a - rot * 0.2 - 1.6 + PI) % TAU) - PI) < 0.4) return INKC;
    return null;
  },
});

// ---------------------------------------------------------------------------
// Поза и риг.
// ---------------------------------------------------------------------------

interface SmO {
  ph: number;
  step: number;
  crouch: number;
  lift: number;
  lean: number;
  roll: number;
  twist: number;
  head: number;
  hturn: number;
  /** Правая рука: мах (+ вперёд) на бегу; к лицу с часами 0…1. */
  swing: number;
  up: number;
  /** Левая рука: держит лямку 0…1, иначе машет/вскинута (`armL` + вперёд). */
  strap: number;
  armL: number;
  /** Мешок: подскок, увод вбок, запрокид (отстаёт от тела). */
  sackB: number;
  sackS: number;
  sackP: number;
  /** Мешок слетел (смерть) 0…1. */
  sackOff: number;
  /** Часы: качание на цепочке, крышка 0…1, свечение 0…1, стрелка. */
  wsw: number;
  lid: number;
  glow: number;
  hand: number;
  /** Часы вылетели из руки (смерть) 0…1. */
  wOut: number;
  /** Фалды отстают (+ назад), монокль выпал 0…1. */
  tails: number;
  mono: number;
  /** Падение ничком, рад. */
  fall: number;
}

const S0: SmO = {
  ph: 0,
  step: 0,
  crouch: 0.3,
  lift: 0,
  lean: 0.38,
  roll: 0,
  twist: 0,
  head: -0.25,
  hturn: 0,
  swing: 0,
  up: 0,
  strap: 1,
  armL: 0,
  sackB: 0,
  sackS: 0,
  sackP: 0,
  sackOff: 0,
  wsw: 0,
  lid: 0,
  glow: 0,
  hand: 0,
  wOut: 0,
  tails: 0,
  mono: 0,
  fall: 0,
};

const LEG = 7.4;
const STRIDE = 5.2;
const RUN_CELL = 1.15;

interface Pts {
  watch: V3;
  mouth: V3;
  head: V3;
  chest: V3;
}

function smithRig(o: SmO, yaw: number, r: Rig): Pts {
  const B0 = F3.yaw(yaw);
  const B = o.fall ? B0.at(1.4, 0, 0).pitch(o.fall).at(-1.4, 0, 0) : B0;
  const offs = [gait(o.ph)[0], gait(o.ph + 0.5)[0]];
  const stance = o.ph % 1 < 0.5 ? offs[0] : offs[1];
  const reach = Math.abs(stance * STRIDE * o.step);
  const hipZ = Math.sqrt(Math.max(1, LEG * LEG - reach * reach)) - o.crouch + o.lift;
  const P = B.at(0, 0, hipZ).roll(o.roll);
  const T = P.turn(o.twist).pitch(o.lean);
  const pants: Mat = { T: PANTS };
  const boot: Mat = { T: BOOT, spec: true };
  const brass: Mat = { T: BRASS, spec: true };
  const coat: Mat = { T: COAT, bias: 0.02 };
  // Ноги: короткий торопливый шаг, колени согнуты.
  for (const sd of [-1, 1]) {
    const hip = P.p(0, sd * 1.4, 0);
    const [off, rise] = gait(o.ph + (sd > 0 ? 0.5 : 0));
    const foot = B.p(off * STRIDE * o.step + 0.3, sd * 1.5, rise * 1.8 * o.step);
    const knee = ik(hip, foot, 3.8, 3.8, B.v(1, sd * 0.15, 0));
    r.cap(hip, knee, 1.25, 1.05, pants);
    r.cap(knee, foot, 1.05, 0.95, pants);
    r.cap(foot, vadd(foot, B.v(1.7, 0, -0.1)), 1.0, 0.8, boot);
  }
  // Фалды сюртука сзади.
  for (const sd of [-1, 1])
    r.poly(
      [
        T.p(-1.6, sd * 0.2, 1.2),
        T.p(-1.7, sd * 2.2, 1.2),
        P.p(-2.0 - o.tails * 1.6, sd * 1.9, -3.0 + o.tails * 0.9),
        P.p(-1.8 - o.tails * 1.6, sd * 0.3, -2.7 + o.tails * 0.9),
      ],
      { T: COAT, bias: -0.12 },
    );
  r.ell(P, [0, 0, 0.6], [1.9, 2.2, 1.4], coat);
  r.ell(T, [0.1, 0, 3.4], [2.3, 2.7, 3.5], COAT_M);
  const chest = T.p(2.0, 0, 3.8);
  // Голова: вперёд и вниз (сгорблен), борода, нос, брови, монокль, козырёк.
  r.cap(T.p(0.7, 0, 6.2), T.p(1.3, 0, 7.4), 1.0, 0.95, { T: SKIN });
  const Hd = T.at(1.5, 0, 8.3).turn(o.hturn).pitch(o.head);
  r.ball(Hd.p(0, 0, 0), 2.25, HEAD_M);
  r.ell(Hd, [1.2, 0, -1.5], [1.2, 1.4, 1.6], { T: BEARD, bias: 0.1 });
  r.ball(Hd.p(2.15, 0, -0.35), 0.72, { T: SKIN, bias: 0.15 });
  for (const sd of [-1, 1]) r.dot(Hd.p(1.95, sd * 0.95, 0.62), BEARD[3], 0, 1, 0.6);
  r.dot(Hd.p(2.05, -0.9, 0.12), INKC, 0, 1, 0.6);
  // Монокль на правом глазу; выпал — висит на шнурке у груди.
  const mc =
    o.mono > 0 ? vlerp(Hd.p(2.1, 0.9, 0.15), T.p(2.3, 1.2, 4.6), o.mono) : Hd.p(2.1, 0.9, 0.15);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    r.dot(vadd(mc, Hd.v(0.05, Math.cos(a) * 0.62, Math.sin(a) * 0.62)), BRASS[3], 0, 1, 0.7);
  }
  r.dot(mc, GLASS, o.mono > 0 ? 0.2 : 0.55, 1, 0.75);
  if (o.mono > 0) r.line(Hd.p(1.6, 1.8, 0.2), mc, INKC, 0, 0.3);
  r.eye = mc;
  r.ell(Hd, [0, 0, 0.95], [2.32, 2.32, 0.42], { T: VISOR, bias: 0.1 });
  r.poly([Hd.p(1.8, -1.7, 1.1), Hd.p(1.8, 1.7, 1.1), Hd.p(3.0, 1.3, 0.7), Hd.p(3.0, -1.3, 0.7)], {
    T: VISOR,
    bias: 0.2,
  });
  // Мешок за спиной: подскакивает на шаг позже, из горловины — циферблаты.
  const S0f = T.at(-2.9 - o.sackP * 0.8, 0.35 + o.sackS, 4.8 + o.sackB).pitch(-0.15 - o.sackP);
  const Sf = o.sackOff
    ? F3.yaw(yaw + o.sackOff * 0.9, vlerp(S0f.o, B0.p(-6.5, 2.2, 2.6), easeIn(o.sackOff))).pitch(
        -0.15 - o.sackOff * 1.2,
      )
    : S0f;
  r.ell(Sf, [0, 0, 0], [2.3, 2.7, 3.0], SACK_M);
  const mouth = Sf.p(0.2, 0, 3.2);
  r.cap(Sf.p(0, 0, 2.6), mouth, 1.2, 1.0, { T: SACK, bias: 0.05 });
  r.ell(Sf.at(0.5, -1.0, 2.9).pitch(-0.7), [0, 0, 0], [0.4, 1.35, 1.35], dialM(o.hand * 0.5));
  r.ell(Sf.at(-0.4, 1.0, 3.1).pitch(-1.1).turn(0.5), [0, 0, 0], [0.35, 1.05, 1.05], dialM(2));
  r.ball(Sf.p(-0.9, -0.2, 3.3), 0.75, brass);
  // Левая рука: держит лямку у груди, иначе машет/вскинута.
  const shL = T.p(0.3, -2.5, 5.9);
  const shR = T.p(0.3, 2.5, 5.9);
  const freeL = T.p(Math.sin(o.armL) * 5.6, -3.1, 5.9 - Math.cos(o.armL) * 5.6);
  const hL = vlerp(freeL, T.p(1.9, -1.0, 5.3), o.strap);
  const elL = ik(shL, hL, 3.0, 3.0, T.v(-0.6, -1, -0.4));
  r.cap(shL, elL, 1.05, 0.9, coat);
  r.cap(elL, hL, 0.9, 0.8, coat);
  r.ball(hL, 0.85, { T: SKIN });
  // Правая рука с часами: на бегу машет, часы качаются на цепочке; к лицу — смотрит.
  const runH = T.p(Math.sin(o.swing) * 4.6, 3.0, 5.6 - Math.cos(o.swing) * 4.6);
  const faceH = T.p(3.4, 1.0, 7.2);
  const hR = vlerp(runH, faceH, o.up);
  const elR = ik(shR, hR, 3.0, 3.0, T.v(-0.6, 1, -0.4));
  r.cap(shR, elR, 1.05, 0.9, coat);
  r.cap(elR, hR, 0.9, 0.8, coat);
  r.ball(hR, 0.85, { T: SKIN });
  let watch: V3;
  const wm: Mat = { T: BRASS, spec: true, glow: o.glow * 0.85, bias: o.glow * 0.2 };
  if (o.wOut > 0) {
    // Вылетели: дугой вверх-вперёд и на пол.
    const k = o.wOut;
    const to = B0.p(4.5, 2.8, 0.7);
    watch = vadd(vlerp(hR, to, k), [0, 0, Math.sin(PI * k) * 5]);
    r.ball(watch, 1.1, brass);
  } else {
    const dangle = (1 - o.up) * 2.1;
    watch = vadd(hR, T.v(Math.sin(o.wsw) * dangle, 0.1, -Math.cos(o.wsw) * dangle));
    if (dangle > 0.3) r.line(hR, watch, BRASS[3], 0, 0.4);
    const W = F3.yaw(yaw - 0.4, watch);
    r.ell(W, [0, 0, 0], [0.45, 1.15, 1.15], wm);
    if (o.up > 0.3) {
      // Лицо часов к старику: кремовый циферблат и стрелка.
      r.ell(W.at(0.25, 0, 0), [0, 0, 0], [0.25, 0.9, 0.9], {
        ...dialM(o.hand),
        glow: o.glow * 0.6,
      });
      if (o.lid > 0)
        r.ell(
          W.at(0.1, 0, 1.0)
            .pitch(-PI * 0.5 * o.lid)
            .at(0, 0, 1.0),
          [0, 0, 0],
          [0.3, 1.1, 1.1],
          wm,
        );
    }
  }
  return { watch, mouth, head: Hd.p(0, 0, 0), chest };
}

// ---------------------------------------------------------------------------
// Дорожки (24 к/с от времени режима).
// ---------------------------------------------------------------------------

const RUN_N = 8;
const STAND_N = 16;
const BLINK_N = 10;
const ARRIVE_N = 5;
const FLINCH_N = 6;
const DIE_N = 21;
const DIE_T = 0.85;

function runO(f: number): SmO {
  const ph = f / RUN_N;
  const a = ph * TAU;
  return {
    ...S0,
    ph,
    step: 1,
    lean: 0.5 + 0.04 * Math.sin(a * 2),
    crouch: 0.6,
    roll: 0.05 * Math.sin(a),
    head: -0.4 + 0.06 * Math.sin(a * 2 + 0.6),
    swing: -0.85 * Math.cos(a),
    strap: 1,
    // Мешок на четверть шага позже: подскок и увод.
    sackB: 0.7 * Math.sin(a * 2 - 1.3),
    sackS: 0.35 * Math.sin(a - 0.9),
    sackP: 0.15 + 0.12 * Math.sin(a * 2 - 1.6),
    wsw: 0.6 * Math.cos(a - 1.2),
    tails: 0.55 + 0.2 * Math.sin(a * 2 - 1.0),
    hand: a,
  };
}

function standO(f: number): SmO {
  const k = f / STAND_N;
  const a = k * TAU;
  // Поглядывает на часы: рука подносит их к лицу и опускает.
  const look = sstep(0.3, 0.45, k) * (1 - sstep(0.7, 0.85, k));
  return {
    ...S0,
    lean: 0.36 + 0.02 * Math.sin(a),
    lift: 0.15 * Math.sin(a),
    head: -0.2 + 0.35 * look + 0.03 * Math.sin(a + 0.8),
    hturn: 0.12 * Math.sin(a + 0.4) * (1 - look),
    up: look * 0.85,
    swing: 0.15,
    sackB: 0.15 * Math.sin(a - 0.6),
    wsw: 0.2 * Math.sin(a * 2),
    lid: look,
    hand: a * 2,
    tails: 0.05 * Math.sin(a - 0.5),
  };
}

const BLINK: KeyPose<SmO>[] = [
  [0, { crouch: 0.6, lean: 0.5, head: -0.4, swing: -0.4, tails: 0.5, sackB: 0.4 }],
  [
    0.1,
    {
      crouch: 0.9,
      lean: 0.28,
      head: 0.25,
      up: 1,
      lid: 1,
      swing: 0,
      sackB: -0.5,
      sackP: 0.25,
      tails: -0.2,
    },
    easeOut,
  ],
  [0.25, { crouch: 0.8, lean: 0.25, head: 0.35, up: 1, lid: 1, glow: 1, sackP: 0.1 }],
  [0.4, { crouch: 0.8, lean: 0.25, head: 0.35, up: 1, lid: 1, glow: 1 }],
];
function blinkO(f: number): SmO {
  const T = tf(f);
  const o = keyPose(T, BLINK, S0);
  // Три щелчка заводной головкой — рывок стрелки и вздрог тела.
  const clicks = [0.12, 0.17, 0.22];
  let hand = 0;
  for (const c of clicks) if (T > c) hand += 1.4;
  const near = clicks.some((c) => T > c && T < c + 0.03);
  return { ...o, hand: hand + T * 4, lift: near ? 0.35 : 0, roll: near ? 0.04 : 0 };
}

function arriveO(f: number): SmO {
  const o = runO(2 + f);
  return { ...o, up: 0.6 * (1 - f / ARRIVE_N), lid: 1 - f / ARRIVE_N, glow: 1 - f / ARRIVE_N };
}

function flinchO(f: number): SmO {
  const k = f / FLINCH_N;
  const b = Math.sin(PI * Math.min(1, k * 1.4)) * (1 - k * 0.5);
  return {
    ...S0,
    lean: 0.38 - 0.5 * b,
    head: -0.25 - 0.45 * b,
    twist: -0.2 * b,
    crouch: 0.3 + 0.6 * b,
    strap: 1 - 0.8 * b,
    armL: -0.6 * b,
    swing: 0.9 * b,
    sackB: 1.3 * b,
    sackP: 0.4 * b,
    sackS: -0.4 * b,
    wsw: 1.2 * b,
    tails: -0.5 * b,
    mono: Math.min(1, k * 2.5),
  };
}

function dieO(f: number): SmO {
  const T = tf(f);
  const hit = Math.sin(PI * clamp01(T / 0.2));
  const buckle = sstep(0.12, 0.3, T);
  const fall = easeIn(clamp01((T - 0.22) / 0.2));
  const land = T > 0.42 ? 0.12 * Math.sin(PI * clamp01((T - 0.42) / 0.1)) : 0;
  return {
    ...S0,
    lean: lerp(0.38 - 0.45 * hit, 0.55, buckle),
    head: -0.25 - 0.6 * hit + 0.5 * buckle,
    crouch: 0.3 + 2.6 * buckle,
    strap: 1 - hit,
    armL: -1.2 * hit + 1.4 * fall,
    swing: 1.6 * hit + 1.0 * fall,
    sackB: 0.9 * hit,
    sackOff: easeOut(clamp01((T - 0.2) / 0.25)),
    wOut: clamp01(T / 0.32),
    mono: clamp01(T / 0.12),
    tails: -0.5 * hit + 0.4 * fall,
    fall: fall * 1.32 - land,
  };
}

function poseOf(anim: string, f: number): SmO {
  switch (anim) {
    case 'run':
      return runO(f);
    case 'stand':
      return standO(f);
    case 'blink':
      return blinkO(f);
    case 'arrive':
      return arriveO(f);
    case 'flinch':
      return flinchO(f);
    case 'die':
      return dieO(f);
  }
  return { ...S0 };
}

// ---------------------------------------------------------------------------
// Кадр: риг + 2D (растворение в часы, искры, монеты, пыль).
// ---------------------------------------------------------------------------

const KS = kindOf('smith', 52, 48, 26, 38, 760);

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
/**
 * Растворение в часы: точки гаснут шахматкой Байера от ног вверх (`dis`
 * 0…1), часы остаются; золотые искры вьются спиралью к часам.
 */
function dissolve(
  o: RigOut,
  wx: number,
  wy: number,
  dis: number,
  f: number,
  inward: boolean,
): void {
  const p = o.p;
  let top = p.h;
  let bot = 0;
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++)
      if (p.solid(x, y)) {
        top = Math.min(top, y);
        bot = Math.max(bot, y);
      }
  const span = Math.max(1, bot - top);
  for (let y = top; y <= bot; y++)
    for (let x = 0; x < p.w; x++) {
      if (!p.solid(x, y)) continue;
      if (Math.abs(x - wx) <= 1.5 && Math.abs(y - wy) <= 1.5) continue;
      const fromFeet = (bot - y) / span;
      const th = (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
      if (th < dis * 1.7 - fromFeet * 0.7) {
        clear(p, x, y);
        if (o.lit) clear(o.lit, x, y);
      }
    }
  if (dis <= 0) return;
  for (let i = 0; i < 7; i++) {
    const s = (i / 7 + f * 0.11) % 1;
    const k = inward ? 1 - s : s;
    const a = i * 2.4 + f * 0.9;
    const rr = 2 + k * 9;
    const x = Math.round(wx + Math.cos(a) * rr);
    const y = Math.round(wy + Math.sin(a) * rr * 0.7 + k * 4);
    spark2(o, x, y, i % 2 ? GOLD : GOLD2, 0.8 * Math.min(1, dis * 2));
  }
}

function post(anim: string, f: number, d: number, o: RigOut, P: Proj2, pts: Pts): void {
  const [wx, wy] = P(pts.watch);
  if (anim === 'blink') {
    const T = tf(f);
    // Крышка щёлкнула; три щелчка головкой — вспышка у часов.
    if (f === 2 || [0.12, 0.17, 0.22].some((c) => T > c && T < c + 0.045)) {
      spark2(o, wx, wy - 2, GOLD2);
      spark2(o, wx - 1, wy - 1, GOLD, 0.8);
      spark2(o, wx + 1, wy - 1, GOLD, 0.8);
    }
    if (T > 0.22) dissolve(o, wx, wy, clamp01((T - 0.22) / 0.17), f, true);
    if (T > 0.3) {
      spark2(o, wx, wy, GOLD2);
      spark2(o, wx, wy - 2, GOLD, 0.7);
      spark2(o, wx, wy + 2, GOLD, 0.7);
      spark2(o, wx - 2, wy, GOLD, 0.7);
      spark2(o, wx + 2, wy, GOLD, 0.7);
    }
  } else if (anim === 'arrive') {
    dissolve(o, wx, wy, 1 - (f + 1) / (ARRIVE_N + 1), f, false);
    if (f < 2) spark2(o, wx, wy, GOLD2);
  } else if (anim === 'flinch' && f >= 1 && f <= 4) {
    // Монеты из горловины мешка дугой.
    const [mx, my] = P(pts.mouth);
    const k = (f - 1) / 3;
    for (let i = 0; i < 4; i++) {
      const a = -PI / 2 + (hash(d, i, 3) - 0.5) * 2.2;
      const rr = (2 + hash(d, i, 4) * 4) * k;
      const x = Math.round(mx + Math.cos(a) * rr);
      const y = Math.round(my + Math.sin(a) * rr - 3 * Math.sin(PI * k) + k * k * 5);
      spark2(o, x, y, COINS[i % 3], 0.6);
    }
  } else if (anim === 'die') {
    const T = tf(f);
    if (T > 0.3 && T < 0.42) {
      // Часы бьются о пол: стекло брызгами.
      const k = (T - 0.3) / 0.12;
      for (let i = 0; i < 4; i++) {
        const a = hash(d, i, 7) * TAU;
        spark2(
          o,
          Math.round(wx + Math.cos(a) * (1 + k * 3)),
          Math.round(wy + Math.sin(a) * k * 2 - k * 2),
          GLASS,
          0.8,
        );
      }
    }
    if (T > 0.36) {
      // Мешок лёг — монеты рассыпаются.
      const [mx, my] = P(pts.mouth);
      spray(o.p, mx, my + 2, 9, 7, easeOut(clamp01((T - 0.36) / 0.3)), 21 + d, COINS, 0, 2);
    }
    if (T > 0.38 && T < 0.6) {
      const [cx, cy] = P(pts.chest);
      spray(o.p, cx, cy + 3, 8, 9, (T - 0.38) / 0.22, 13 + d, DUST, 1, 2);
    }
    if (T > 0.55) {
      const q = scatter(o.p, clamp01((T - 0.55) / 0.3) * 1.2, 23 + d, [
        GOLD,
        BRASS[3],
        COINS[1],
        BEARD[2],
      ]);
      o.p.data.set(q.data);
      if (o.lit) o.lit.data.fill(0);
    }
  }
}

const smPic = (anim: string, f: number, d: number): Pic => {
  const o0 = poseOf(anim, f);
  const r = new Rig();
  const pts = smithRig(o0, yawN(d), r);
  return draw(KS, r, (o, P) => post(anim, f, d, o, P, pts));
};

// ---------------------------------------------------------------------------
// Рисовальщик.
// ---------------------------------------------------------------------------

registerMobPainter('f14_smith', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = pose.t || 0;
  const now = pose.now || 0;
  const tech = md === 'f14_blink' || md === 'escape' || md === 'dying';
  const v = visOf(m, pose, tech ? (m.face ?? 0) : headOf(m), 14);
  const d = sideOf(v);
  const ex: Partial<MobFrame> = { shadow: 4 };
  let anim = 'stand';
  let f = 0;
  const age = hurtAge(v, now);
  if (md === 'dying') {
    anim = 'die';
    f = fi(t, DIE_N - 1);
    ex.linger = DIE_T;
    ex.alpha = 1 - sstep(0.66, DIE_T, t);
    ex.still = true;
    ex.shadow = 4 * (1 - sstep(0.5, DIE_T, t));
  } else if (md === 'f14_blink' || md === 'escape') {
    anim = 'blink';
    f = fi(t, BLINK_N - 1);
    ex.still = true;
    ex.shadow = 4 * (1 - sstep(0.26, 0.4, t));
  } else if (md === 'stun' || age < 0.22) {
    anim = 'flinch';
    f = fi(md === 'stun' ? t : age, FLINCH_N - 1);
  } else if (v.prev === 'f14_blink' && t < ARRIVE_N / 24) {
    anim = 'arrive';
    f = fi(t, ARRIVE_N - 1);
    ex.shadow = 4 * sstep(0, ARRIVE_N / 24, t);
  } else if (moving(m, 0.5) || md === 'emerge') {
    anim = 'run';
    f = Math.floor(stepPh(v, RUN_CELL) * RUN_N) % RUN_N;
  } else {
    anim = 'stand';
    f = Math.floor(idlePh(m, pose, 2.2) * STAND_N) % STAND_N;
  }
  if (md !== 'dying') hurtFx(v, now, 0.9, ex);
  return { ...frameOf(KS, anim, f, d, pose, () => smPic(anim, f, d)), ...ex };
});

const WARM: [string, number, number[]?][] = [
  ['run', RUN_N],
  ['stand', STAND_N],
  ['blink', BLINK_N],
  ['arrive', ARRIVE_N],
  ['flinch', FLINCH_N],
  ['die', DIE_N],
];

registerMobWarm('f14_smith', function* () {
  yield* warmAll(KS, WARM, smPic);
});
