// Этаж 14: Шестерёнчатый жук (анимации мобов 14). Панцирь — две латунные
// половинки шестерни (надкрылья на шарнире по хребту), железное брюшко,
// шесть железных ножек, бирюзовый глаз-линза, жвалы-крючья, усики-проволоки,
// на спине тикает часовая ступица. Свернулся — целая шестерня-колесо:
// пять спиц, десять зубьев, глаз — в ступице.
//
// Мозг (`f14-brains.ts`, `BEETLE`): погоня зигзагом; `windup` 0,5 — укус,
// урон в конце → `recover` 0,5 (кадр контакта — первый кадр `recover`);
// `f14_curl` 0,55 (линия на полу) → `f14_roll` до 1,5 с по `m.dir` со
// скоростью 9, отскок от стен (курс — по скорости) → `dizzy` 0,9.

import { registerMobPainter, registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
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
  hash,
  headOf,
  hurtAge,
  hurtFx,
  hx,
  idlePh,
  ik,
  kindOf,
  lerp,
  moving,
  sideOf,
  smear,
  spark2,
  spray,
  sstep,
  stars,
  tn,
  vadd,
  visOf,
  vlerp,
  warmAll,
  yawN,
} from './f14-mobkit';
import type { Mat, Pic, Proj2, RGBA, RigOut, V3 } from './f14-mobkit';

const BRASS = tn('#3a2410', '#7a5220', '#b8862e', '#f0c860');
const BRASS_IN = tn('#1e1208', '#3e2a12', '#6a4a1e', '#9a7030');
const IRON = tn('#0e1014', '#262a32', '#4a505c', '#7c8490');
const STEEL = tn('#2a3038', '#58626e', '#98a4b0', '#e4ecf4');
const TEAL = hx('#5ff0e0');
const TEAL_OFF = hx('#16302e');
const SPARK = hx('#fff4d0');
const SPARK2 = hx('#ffc860');
const DUST: RGBA[] = [hx('#6a5a48'), hx('#8a7a64'), hx('#4a3e32')];
const DUST_UP: RGBA[] = [hx('#7a6a56'), hx('#5a4c3e')];

interface BeO {
  /** Фаза шага (тройки ножек) и размах шага 0…1. */
  ph: number;
  step: number;
  /** Корпус: вперёд, вверх, нос вверх (+), крен. */
  fx: number;
  h: number;
  pitch: number;
  roll: number;
  /** Надкрылья раскрыты 0…1, жвалы раскрыты 0…1. */
  open: number;
  jaw: number;
  /** Усики отстают назад (+) и вниз (−). */
  ant: number;
  /** Ножки поджаты 0…1, передняя пара вскинута 0…1, ножки врастопырку 0…1. */
  tuck: number;
  front: number;
  splay: number;
  /** Глаз горит 0…1; ступица на спине (поворот, рад). */
  lit: number;
  hub: number;
  /** Смерть: перевернулся (0…1), ножки сучат (фаза). */
  flip: number;
  kick: number;
}

const B0: BeO = {
  ph: 0,
  step: 0,
  fx: 0,
  h: 0,
  pitch: 0,
  roll: 0,
  open: 0,
  jaw: 0.15,
  ant: 0,
  tuck: 0,
  front: 0,
  splay: 0,
  lit: 1,
  hub: 0,
  flip: 0,
  kick: 0,
};

/** Колесо: поворот (рад), масштаб (щелчок сворачивания), наклон вбок, свечение глаза. */
interface WhO {
  spin: number;
  k: number;
  tilt: number;
  glow: number;
}

const H0 = 3.1;
/** Шаг: клеток на цикл (тройка ножек — полцикла опоры), ход ступни по полу, пикс. */
const STRIDE_C = 0.5;
const FOOT = 4;
/** Ножки: углы от курса (перед, середина, зад), вынос ступни, длины. */
const LEG_A = [0.62, 1.55, 2.45];
const R0 = 5.4;
/** Колесо: радиус диска, зубья наружу, спиц. */
const WR = 5.0;
const WT = 1.1;
const SPOKES = 5;
const TEETH = 10;
/** Поворот колеса на клетку пути — честное качение (рад/клетку). */
const ROLL_K = 16 / (WR + WT * 0.5);
const ROLL_N = 8;
const ROLL_P = TAU / SPOKES;

const shellMat = (inner: boolean): Mat => ({
  T: inner ? BRASS_IN : BRASS,
  spec: !inner,
  pat: (q, l) => {
    // Кольцевой гребень шестерни и заклёпки по нему.
    const rr = Math.hypot(q[0], q[1]);
    // Шов по хребту: две половинки шестерни.
    if (!inner && Math.abs(q[1]) < 0.09 && q[2] > 0.3) return BRASS[0];
    if (rr > 0.62 && rr < 0.74) return l > 0.55 ? BRASS[2] : BRASS[1];
    if (rr > 0.86) return l > 0.6 ? BRASS[3] : null;
    return null;
  },
});

/** Ступица: железо с латунными зубцами; `side` — ось вбок (колесо), иначе вверх (спина). */
function hubMat(rot: number, side = false): Mat {
  const n = side ? SPOKES : 4;
  return {
    T: IRON,
    spec: true,
    pat: (q, l) => {
      const y = side ? q[2] : q[1];
      const a = Math.atan2(y, q[0]) + (side ? rot : -rot);
      const fr = ((((a / TAU) * n) % 1) + 1) % 1;
      if (Math.hypot(q[0], y) > 0.45 && fr < 0.3) return l > 0.5 ? BRASS[2] : BRASS[1];
      return null;
    },
  };
}

interface BPts {
  head: V3;
  jaw: V3;
  eye: V3;
  top: V3;
  ground: V3;
}

/** Жук на ножках. */
function beetleRig(o: BeO, yaw: number, r: Rig): BPts {
  const B = F3.yaw(yaw);
  const bob = o.step ? 0.28 * Math.abs(Math.sin(o.ph * TAU * 2)) : 0;
  const H = lerp(H0, 2.4, o.flip) + o.h + bob - o.tuck * 0.9;
  const C = B.at(o.fx, 0, H)
    .pitch(-o.pitch)
    .roll(o.roll + o.flip * PI);
  const iron: Mat = { T: IRON, spec: true };
  const steel: Mat = { T: STEEL, spec: true };
  // Брюшко.
  r.ell(C, [-0.4, 0, -0.5], [4.3, 2.9, 1.5], { T: IRON });
  // Надкрылья — половинки шестерни на шарнире по хребту.
  for (const s of [-1, 1]) {
    const E = C.at(-0.5, 0, 0.5).roll(s * o.open * 0.95);
    r.ell(E, [0, 0, 0], [4.9, 4.0, 2.3], shellMat(false), (q) => s * q[1] < 0 || q[2] < -0.05);
    // Внутренняя сторона видна, когда раскрыты.
    if (o.open > 0.35)
      r.ell(
        E,
        [0, s * 0.2, -0.15],
        [4.3, 3.3, 1.6],
        shellMat(true),
        (q) => s * q[1] < 0 || q[2] < 0,
      );
    for (let i = 0; i < 5; i++) {
      const th = ((i + 0.5) / 5) * PI;
      const c = Math.cos(th);
      const sn = Math.sin(th);
      r.cap(E.p(c * 4.4, s * sn * 3.5, 0.15), E.p(c * 5.6, s * sn * 4.6, 0.1), 0.72, 0.6, {
        T: BRASS,
        bias: 0.05,
      });
    }
  }
  // Часовая ступица на спине (тикает).
  r.ell(C.at(-0.6, 0, 2.55), [0, 0, 0], [1.25, 1.25, 0.45], hubMat(o.hub));
  // Голова, глаз-линза, жвалы, усики.
  const Hd = C.at(4.3, 0, 0.0).pitch(-o.pitch * 0.4);
  r.ell(Hd, [0, 0, 0], [1.7, 2.0, 1.45], iron);
  const eyeP = Hd.p(1.45, 0, 0.55);
  r.dot(eyeP, o.lit > 0.5 ? TEAL : TEAL_OFF, o.lit > 0.5 ? o.lit : 0, 1, 0.7);
  r.eye = o.lit > 0.5 ? eyeP : null;
  let jawTip: V3 = Hd.p(2.6, 0, -0.6);
  for (const s of [-1, 1]) {
    const base = Hd.p(1.2, s * 0.95, -0.55);
    const mid = Hd.p(2.3 + o.jaw * 0.2, s * (0.9 + o.jaw * 1.5), -0.65);
    const tip = Hd.p(3.1 - o.jaw * 0.3, s * (0.15 + o.jaw * 1.3), -0.7);
    r.cap(base, mid, 0.5, 0.42, steel);
    r.cap(mid, tip, 0.42, 0.25, steel);
    jawTip = vlerp(jawTip, tip, 0.5);
  }
  for (const s of [-1, 1]) {
    const a0 = Hd.p(0.9, s * 0.75, 1.0);
    const a1 = Hd.p(0.9 - o.ant * 0.8, s * 1.7, 2.6 - Math.max(0, -o.ant) * 1.2);
    const a2 = vadd(a1, Hd.v(1.2 - o.ant * 1.4, s * 0.9, 0.5 - Math.abs(o.ant) * 0.6));
    r.line(a0, a1, IRON[2], 0, 0.3);
    r.line(a1, a2, STEEL[2], 0, 0.3);
    r.dot(a2, BRASS[3], 0, 1, 0.8);
  }
  // Ножки: две тройки — опора едет назад, перенос дугой.
  for (const s of [-1, 1])
    for (let i = 0; i < 3; i++) {
      const hip = C.p(1.5 - i * 1.5, s * 2.2, -0.9);
      const a = LEG_A[i] - o.splay * (i === 1 ? 0 : i === 0 ? -0.25 : 0.25);
      const R = R0 * (1 + o.splay * 0.25);
      let foot = B.p(o.fx * 0.35 + Math.cos(a) * R, s * Math.sin(a) * R, 0);
      if (o.step > 0) {
        const g = (i + (s > 0 ? 1 : 0)) % 2;
        const q = (((o.ph + g * 0.5) % 1) + 1) % 1;
        const d = FOOT * o.step;
        if (q < 0.5) foot = vadd(foot, B.v(d / 2 - d * (q / 0.5), 0, 0));
        else {
          const k = (q - 0.5) / 0.5;
          foot = vadd(foot, B.v(-d / 2 + d * k, 0, Math.sin(PI * k) * 1.8));
        }
      }
      if (i === 0 && o.front > 0) foot = vlerp(foot, C.p(4.6, s * 3.4, 2.2), o.front);
      if (o.tuck > 0) foot = vlerp(foot, C.p(1.0 - i * 1.3, s * 2.4, -1.9), clamp01(o.tuck));
      if (o.flip > 0) {
        // На спине: ножки вверх, сучат.
        const kk = Math.sin(o.kick * TAU + i * 2.1 + s) * 0.9;
        const up = C.p(1.8 - i * 1.8 + kk, s * (3.0 + i * 0.3), -3.6 - Math.abs(kk) * 0.4);
        foot = vlerp(foot, up, clamp01(o.flip));
      }
      const pole = vadd(C.u, C.v(0, s * 0.6, 0));
      const knee = ik(hip, foot, 2.5, 3.3, pole);
      r.cap(hip, knee, 0.5, 0.38, iron);
      r.cap(knee, foot, 0.36, 0.2, iron);
      r.dot(knee, BRASS[2], 0, 1, 0.8);
    }
  return {
    head: Hd.p(0, 0, 0),
    jaw: jawTip,
    eye: eyeP,
    top: C.p(-0.6, 0, 4.2),
    ground: B.p(o.fx, 0, 0),
  };
}

/** Шестерня-колесо: диск со спицами, десять зубьев, ступица с глазом. */
function wheelRig(o: WhO, yaw: number, r: Rig): BPts {
  const B = F3.yaw(yaw);
  const W = B.at(0, 0, (WR + WT) * o.k)
    .roll(o.tilt)
    .scale(o.k);
  const spin = o.spin;
  // Две половинки панциря, сжатые вместе: толстый диск с круглым ободом.
  const face: Mat = {
    T: BRASS,
    spec: true,
    pat: (q, l) => {
      const rr = Math.hypot(q[0], q[2]);
      if (rr > 0.86) return l > 0.55 ? BRASS[3] : BRASS[2];
      if (rr > 0.77) return BRASS[1];
      if (rr < 0.32) return null;
      const a = Math.atan2(q[2], q[0]) + spin;
      const fr = ((((a / TAU) * SPOKES) % 1) + 1) % 1;
      return fr > 0.32 ? BRASS_IN[1] : null;
    },
  };
  for (const sd of [-1, 1]) r.ell(W, [0, sd * 1.0, 0], [WR, 1.05, WR], face);
  for (let i = 0; i < TEETH; i++) {
    const a = (i / TEETH) * TAU - spin;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const Ft = new F3(W.p(c * (WR + 0.25), 0, s * (WR + 0.25)), W.v(c, 0, s), W.s, W.v(-s, 0, c));
    r.ell(Ft, [0, 0, 0], [WT, 1.55, 0.72], { T: BRASS, bias: 0.05 });
  }
  r.ell(W, [0, 0, 0], [1.4, 2.6, 1.4], hubMat(spin, true));
  const glow = clamp01(o.glow);
  const eyes = [W.p(0, 2.65, 0), W.p(0, -2.65, 0)];
  for (const e of eyes) r.dot(e, glow > 0.2 ? TEAL : TEAL_OFF, glow, 1, 0.8);
  const cs = Math.sin(yaw) >= 0 ? 0 : 1;
  r.eye = glow > 0.2 ? eyes[cs] : null;
  return {
    head: W.p(0, 0, 0),
    jaw: W.p(WR, 0, 0),
    eye: eyes[cs],
    top: W.p(0, 0, WR + WT + 0.5),
    ground: B.p(0, 0, 0),
  };
}

// ---- Треки ----------------------------------------------------------------

const tf = (f: number) => (f + 0.5) / FPS;
const BITE_T = 0.5;
const CURL_T = 0.55;
/** Кадр щелчка: жук сворачивается в колесо. */
const SNAP_F = 7;
const DIZZY_T = 0.9;
const DIE_T = 0.8;

/** Укус: на дыбы, жвалы врозь, надкрылья приподняты; дрожь; бросок вперёд. */
function biteO(T: number, f: number): BeO {
  const k1 = easeOut(sstep(0, 0.2, T));
  const hold = sstep(0.18, 0.24, T) * (1 - sstep(0.38, 0.4, T));
  const k3 = easeIn(sstep(0.38, BITE_T, T));
  const tr = (f % 2 ? 1 : -1) * 0.22 * hold;
  return {
    ...B0,
    fx: -1.5 * k1 + 1.6 * k3 + tr,
    pitch: 0.36 * k1 * (1 - k3) - 0.05 * k3,
    h: 0.3 * k1 * (1 - k3),
    jaw: 0.15 + 0.85 * k1 * (1 - 0.3 * k3),
    open: 0.16 * k1 * (1 - k3),
    front: 0.65 * k1 * (1 - k3),
    ant: 0.6 * k1 - 0.3 * k3,
    hub: T * 4,
  };
}

/** Кадр 0 — контакт: жвалы сомкнуты в броске; перелёт, отдача назад, оседание. */
function bitefO(T: number): BeO {
  const out = T < 0.09 ? 1 : 1 - easeOut(sstep(0.09, 0.36, T));
  const over = Math.sin(PI * clamp01(T / 0.09)) * 0.5;
  const back = Math.sin(PI * sstep(0.12, 0.4, T)) * 0.45;
  const chew = Math.sin(PI * sstep(0.26, 0.36, T)) * 0.35;
  return {
    ...B0,
    fx: 2.6 * out + over - back,
    pitch: -0.14 * out + 0.08 * back,
    h: -0.45 * out,
    jaw: 0.15 * (1 - out) + chew,
    open: 0.1 * out,
    ant: -0.4 * out + 0.5 * back,
    hub: BITE_T * 4 + T * 2,
  };
}

/** Сворачивание до щелчка: ножки поджать, присесть, надкрылья обнять корпус. */
function curlO(T: number): BeO {
  const k = sstep(0, tf(SNAP_F) - 0.02, T);
  return {
    ...B0,
    tuck: easeOut(k),
    h: -0.4 * k,
    pitch: 0.25 * Math.sin(PI * k),
    open: 0.55 * Math.sin(PI * Math.min(1, k * 1.2)),
    jaw: 0.15 * (1 - k),
    ant: 0.9 * k,
    hub: T * 6,
  };
}

/** Колесо после щелчка: откат назад (завод пружины), дрожь, глаз разгорается. */
function curlW(T: number, f: number): WhO {
  const snapT = tf(SNAP_F);
  const pop = f === SNAP_F ? 0.86 : f === SNAP_F + 1 ? 1.06 : 1;
  const wind = -0.55 * sstep(snapT + 0.04, 0.48, T);
  const tr = T > 0.44 ? (f % 2 ? 1 : -1) * 0.07 : 0;
  return { spin: wind + tr, k: pop, tilt: 0, glow: 0.4 + 0.6 * sstep(snapT, CURL_T, T) };
}

/** Головокружение: колесо разворачивается в жука; шатается, звёзды. */
function dizzyO(T: number, f: number): BeO {
  const k = sstep(0.1, 0.2, T);
  const wob = Math.sin(T * 15) * 0.28 * (1 - sstep(0.55, DIZZY_T, T));
  return {
    ...B0,
    tuck: 1 - easeOut(sstep(0.1, 0.3, T)),
    h: -0.3 * (1 - k) + 0.6 * Math.sin(PI * sstep(0.12, 0.3, T)),
    roll: wob,
    pitch: -0.08 * Math.sin(T * 11),
    splay: 0.8 * k * (1 - sstep(0.6, DIZZY_T, T)),
    jaw: 0.5 + 0.2 * Math.sin(T * 17),
    ant: -0.7 * k + 0.3 * Math.sin(T * 13),
    lit: f % 5 === 3 && T < 0.7 ? 0 : 1,
    hub: T * 2,
  };
}

/** Смерть: удар, переворот на спину с подскоком, ножки сучат и стихают. */
function dieO(T: number): BeO {
  const hit = Math.sin(PI * sstep(0, 0.1, T));
  const fl = easeIn(sstep(0.06, 0.3, T));
  const hop = Math.sin(PI * sstep(0.06, 0.32, T)) * 3.2;
  const land = Math.sin(PI * sstep(0.3, 0.4, T)) * -0.5;
  return {
    ...B0,
    fx: -1.0 * hit,
    pitch: 0.3 * hit,
    h: hop + land,
    splay: hit,
    open: 0.5 * hit,
    jaw: 0.9 * hit + 0.3,
    flip: fl,
    kick: T * (5 - 4 * sstep(0.3, 0.7, T)),
    ant: -0.6 * fl,
    lit: T < 0.45 ? 1 : T < 0.5 ? 0 : T < 0.54 ? 1 : 0,
    hub: T * 8,
  };
}

function bePose(anim: string, f: number): BeO {
  const T = tf(f);
  switch (anim) {
    case 'idle': {
      const a = (f / 8) * TAU;
      return {
        ...B0,
        h: 0.18 * Math.sin(a),
        pitch: 0.03 * Math.sin(a + 1),
        ant: 0.25 * Math.sin(a - 0.7),
        jaw: f === 5 ? 0.6 : f === 6 ? 0.35 : 0.15,
        hub: (f < 4 ? 0 : 1) * (TAU / 8),
      };
    }
    case 'run': {
      const ph = f / 6;
      return {
        ...B0,
        ph,
        step: 1,
        pitch: -0.05,
        roll: 0.06 * Math.sin(ph * TAU),
        ant: 0.45 + 0.15 * Math.sin((ph - 0.15) * 2 * TAU),
        hub: ph * PI,
      };
    }
    case 'bite':
      return biteO(Math.min(T, BITE_T - 0.005), f);
    case 'bitef':
      return bitefO(T);
    case 'curl':
      return curlO(T);
    case 'dizzy':
      return dizzyO(T, f);
    case 'flinch': {
      const k = f / 6;
      const b = Math.sin(PI * Math.min(1, k * 1.4)) * (1 - k * 0.5);
      return {
        ...B0,
        fx: -1.3 * b,
        pitch: 0.32 * b,
        h: 0.4 * b,
        open: 0.55 * b,
        jaw: 0.15 + 0.6 * b,
        splay: 0.6 * b,
        ant: 0.8 * b,
        hub: k,
      };
    }
    case 'die':
      return dieO(T);
    case 'sleep': {
      const a = (f / 4) * TAU;
      return {
        ...B0,
        tuck: 0.55,
        h: -0.5 + 0.12 * Math.sin(a),
        lit: 0,
        jaw: 0,
        ant: -0.9,
        pitch: -0.08,
      };
    }
    case 'alert': {
      const k = sstep(0, 0.3, T);
      return {
        ...B0,
        tuck: 0.55 * (1 - k),
        h: -0.5 * (1 - k) + 1.6 * Math.sin(PI * sstep(0.06, 0.22, T)),
        lit: T > 0.04 ? 1 : 0,
        open: 0.5 * Math.sin(PI * sstep(0.06, 0.3, T)),
        ant: lerp(-0.9, 0, k) + 0.4 * Math.sin(PI * sstep(0.1, 0.3, T)),
        jaw: 0.15 + 0.5 * Math.sin(PI * sstep(0.08, 0.2, T)),
        hub: T * 6,
      };
    }
    case 'drop':
      return { ...B0, open: f ? 0.75 : 0.55, splay: 1, front: 0.4, ant: -0.4, h: 0.6 };
    case 'land': {
      const s = Math.sin(PI * sstep(0, 0.16, T)) - 0.3 * Math.sin(PI * sstep(0.16, 0.3, T));
      return {
        ...B0,
        h: -0.9 * s,
        splay: 0.8 * s,
        open: 0.4 * s,
        ant: -0.6 * s,
        jaw: 0.15 + 0.3 * s,
      };
    }
  }
  return { ...B0 };
}

// ---- Кадр -----------------------------------------------------------------

const KB = kindOf('beetle', 44, 40, 22, 28, 1400);

function post(anim: string, f: number, d: number, o: RigOut, P: Proj2, pts: BPts): void {
  if (anim === 'bitef' && f <= 1) {
    // Щелчок жвал: короткий след и искры на острие.
    const yaw = yawN(d);
    const r0 = new Rig();
    const from = beetleRig(biteO(BITE_T - 0.06, 10), yaw, r0);
    if (f === 0) {
      // Узкий след острия: основание — чуть позади жвал, не центр головы.
      const back = (a: V3, b: V3) => P(vlerp(a, b, 0.3));
      smear(
        o,
        [P(from.jaw), P(pts.jaw)],
        [back(from.jaw, from.head), back(pts.jaw, pts.head)],
        hx('#f4f0e4', 130),
        0.35,
      );
    }
    const [x, y] = P(pts.jaw);
    spark2(o, x, y, SPARK);
    spark2(o, x + 1, y, SPARK2, 0.7);
    spark2(o, x - 1, y, SPARK2, 0.7);
    if (f === 0) {
      spark2(o, x, y - 1, SPARK2, 0.6);
      spark2(o, x + 2, y + 1, SPARK2, 0.4);
    }
  }
  if (anim === 'roll') {
    // Искры из-под зубьев и пыль позади колеса.
    const yaw = yawN(d);
    const B = F3.yaw(yaw);
    const [gx, gy] = P(B.p(-1.5, 0, 0.3));
    const [bx, by] = P(B.p(-4.5 - (f % 2) * 1.5, 0, 0.2));
    spark2(o, gx, gy, f % 2 ? SPARK2 : SPARK, 0.8);
    if (f % 3 === 0) spark2(o, gx - 1, gy - 1, SPARK2, 0.5);
    spray(o.p, bx, by, 4, 3, 0.6 + (f % 4) * 0.1, 40 + d * 8 + f, DUST_UP, 0, 1.5);
  }
  if (anim === 'curl' && f === SNAP_F) {
    // Щелчок: надкрылья схлопнулись — искры по ободу.
    const [x, y] = P(pts.top);
    spark2(o, x, y, SPARK);
    spark2(o, x - 2, y + 2, SPARK2, 0.6);
    spark2(o, x + 2, y + 2, SPARK2, 0.6);
  }
  if (anim === 'dizzy' && f >= 4) {
    const [x, y] = P(pts.top);
    stars(o, x, y - 1, 4, (f / 22) * 2.2, 3);
  }
  if (anim === 'land' && f < 6) {
    const [x, y] = P(pts.ground);
    spray(o.p, x, y + 1, 9, 7, (f + 1) / 6, 23 + d, DUST, 1, 1);
  }
  if (anim === 'die' && f >= 8) {
    // Пружинка и шестерёнки сыплются из-под панциря.
    const k = (f - 8) / 10;
    const [x0, y0] = P(pts.top);
    for (let i = 0; i < 4; i++) {
      const a = hash(d, i, 9) * TAU;
      const dist = (3 + hash(d, i, 10) * 6) * easeOut(k);
      const x = x0 + Math.cos(a) * dist;
      const y =
        y0 + 2 + Math.sin(a) * dist * 0.55 - Math.sin(PI * Math.min(1, k * 1.5)) * 4 + k * 4;
      if (i < 2) cog2(o.p, x, y, 1.6, 6, k * 7 + i, BRASS);
      else spark2(o, Math.round(x), Math.round(y), i === 2 ? STEEL[3] : TEAL, i === 3 ? 0.5 : 0);
    }
  }
}

const bePic = (anim: string, f: number, d: number): Pic => {
  const yaw = yawN(d);
  const r = new Rig();
  let pts: BPts;
  if (anim === 'roll')
    pts = wheelRig({ spin: (f / ROLL_N) * ROLL_P, k: 1, tilt: 0, glow: 1 }, yaw, r);
  else if (anim === 'curl' && f >= SNAP_F) pts = wheelRig(curlW(tf(f), f), yaw, r);
  else if (anim === 'dizzy' && f < 3)
    pts = wheelRig(
      { spin: 0.3 * f, k: 1 - f * 0.08, tilt: [0.15, -0.3, 0.45][f], glow: 0.6 },
      yaw,
      r,
    );
  else pts = beetleRig(bePose(anim, f), yaw, r);
  return draw(KB, r, (o, P) => post(anim, f, d, o, P, pts));
};

/** Режимы, где курс держит мозг (`m.face` = `m.dir`). */
const TECH = new Set(['windup', 'recover', 'f14_curl', 'dizzy']);

registerMobPainter('f14_beetle', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = pose.t;
  const now = pose.now || 0;
  const rolling = md === 'f14_roll';
  const want = rolling
    ? moving(m, 0.5)
      ? Math.atan2(m.vy, m.vx)
      : (m.dir ?? m.face ?? 0)
    : TECH.has(md)
      ? (m.face ?? 0)
      : headOf(m);
  const v = visOf(m, pose, want, rolling ? 60 : md === 'windup' || md === 'f14_curl' ? 16 : 11);
  const d = sideOf(v);
  const ex: Partial<MobFrame> = { shadow: 5 };
  let anim = 'idle';
  let f = 0;
  let gray = false;
  if (md === 'dying') {
    anim = 'die';
    f = fi(t, 17);
    ex.linger = DIE_T;
    ex.alpha = 1 - sstep(0.62, DIE_T, t);
    ex.still = true;
  } else if (md === 'f14_frozen') {
    gray = true;
    ex.still = true;
  } else if (rolling) {
    anim = 'roll';
    const sp = ((((v.dist * ROLL_K) / ROLL_P) % 1) + 1) % 1;
    f = Math.floor(sp * ROLL_N) % ROLL_N;
    ex.still = true;
    ex.ghost = { every: 0.03, life: 0.13, tint: '#ffd890', alpha: 0.24 };
  } else if (md === 'f14_curl') {
    anim = 'curl';
    f = fi(t, 13);
    ex.still = true;
    if (f === SNAP_F) {
      ex.sx = 1.12;
      ex.sy = 0.88;
    } else if (f === SNAP_F + 1) {
      ex.sx = 0.95;
      ex.sy = 1.05;
    }
  } else if (md === 'dizzy') {
    anim = 'dizzy';
    f = fi(t, 21);
    ex.still = true;
  } else if (md === 'windup') {
    anim = 'bite';
    f = fi(t, 11);
    ex.still = true;
  } else if (md === 'recover') {
    anim = 'bitef';
    f = fi(t, 11);
    ex.still = true;
    if (f < 2) {
      ex.sx = 1.08;
      ex.sy = 0.92;
    }
  } else if (md === 'drop') {
    anim = 'drop';
    f = Math.floor(now * 14 + hash(m.id ?? 0, 5) * 2) % 2;
  } else if (md === 'stun' && v.prev === 'drop') {
    anim = 'land';
    f = fi(t, 7);
    if (f < 3) {
      ex.sx = 1 + 0.1 * (1 - f / 3);
      ex.sy = 1 - 0.12 * (1 - f / 3);
    }
  } else if (md === 'stun' || hurtAge(v, now) < 0.25) {
    anim = 'flinch';
    f = fi(md === 'stun' ? t : hurtAge(v, now), 5);
  } else if (md === 'sleep') {
    anim = 'sleep';
    f = Math.floor(idlePh(m, pose, 2.2) * 4) % 4;
  } else if (md === 'alert') {
    anim = 'alert';
    f = fi(t, 7);
  } else if (md === 'emerge' || moving(m, 0.4)) {
    anim = 'run';
    f = Math.floor(((((v.dist / STRIDE_C) % 1) + 1) % 1) * 6) % 6;
  } else {
    anim = 'idle';
    f = Math.floor(idlePh(m, pose, 1.6) * 8) % 8;
  }
  if (md !== 'dying' && !rolling && !gray) hurtFx(v, now, 0.8, ex);
  return { ...frameOf(KB, anim, f, d, pose, () => bePic(anim, f, d), gray), ...ex };
});

/** Всё, что играет в бою, — во всех 8 сторонах. */
const WARM: [string, number, number[]?][] = [
  ['run', 6],
  ['idle', 8],
  ['bite', 12],
  ['bitef', 12],
  ['curl', 14],
  ['roll', ROLL_N],
  ['dizzy', 22],
  ['flinch', 6],
  ['die', 18],
  ['sleep', 4],
  ['alert', 8],
  ['drop', 2],
  ['land', 8],
];

registerMobWarm('f14_beetle', function* () {
  yield* warmAll(KB, WARM, bePic);
});
