// Этаж 14: Отмотчик (анимации мобов 14). Корпус — песочные часы в латунной
// раме: две стеклянные колбы с бирюзовым песком, четыре стойки, плиты; на
// верхней плите тёмный капюшон, вместо лица — циферблат с бирюзовым глазом-
// осью. Руки — воронёные часовые стрелки на шарнирах плеч (правая —
// минутная, длинная; левая — часовая), ноги — латунные прутья.
//
// Мозг (`f14-brains.ts`, `REWIND`): погоня; `windup` 0,55 — минутная стрелка
// тремя щелчками храповика взводится назад и рубит вперёд, урон в конце →
// `recover` 0,6 (кадр контакта — первый кадр `recover`, рывок v 3); удар —
// ровно один оборот стрелки назад. Ранен (не чаще 5,5 с) — окно 0,55 с
// (`m.data.rwAt`): песок горит и течёт вверх, тело дёргает к якорю; затем
// `f14_rewind` 0,45 — летит назад по следу, стрелки крутятся назад, кадр
// «рвётся» строками, как отматываемая плёнка. Герой встал на якорь —
// `f14_dazed` 1,6: стекло треснуло (урон ×1,5 — трещина светится), стрелки
// повисли маятниками, песок течёт из трещины.

import { registerMobPainter } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import { CE, SE } from './f15-rig';
import {
  F3,
  FPS,
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
  smear,
  spark2,
  spray,
  sstep,
  stars,
  tn,
  vadd,
  visOf,
  vlerp,
  vmul,
  vnorm,
  warmAll,
  demOf,
  regWarm,
  warmGray,
  wnow,
  yawN,
} from './f14-mobkit';
import type { KeyPose, Mat, Pic, Proj2, RGBA, RigOut, V3 } from './f14-mobkit';

const BRASS = tn('#3a2410', '#7a5220', '#b8862e', '#f0c860');
const IRON = tn('#0e1014', '#262a32', '#4a505c', '#7c8490');
const BLUED = tn('#0c1220', '#1e3258', '#3c64a0', '#a8d0f8');
const BLADE = tn('#24365a', '#5a80c0', '#a8ccf4', '#f4faff');
const GLASS = tn('#0e181e', '#203a44', '#6496a4', '#e8fcff');
const RSAND = tn('#1e5a66', '#3aa0b0', '#7ce0ec', '#d8fcff');
const HOT = tn('#28b8cc', '#6ef0ff', '#c4ffff', '#ffffff');
const HOOD = tn('#0a0c14', '#181c2a', '#2a3042', '#44506a');
const DIAL = tn('#5a564c', '#a09a8a', '#ddd4c0', '#fffaf0');
const EYE = hx('#8fe8ff');
const EYE_OFF = hx('#1c3438');
const SPARK = hx('#fff4d0');
const SPARK2 = hx('#ffc860');
const SHARD: RGBA[] = [hx('#e0f8fc'), hx('#a8d8e4'), hx('#ffffff')];
const GRAIN: RGBA[] = [hx('#d8fcff'), hx('#7ce0ec'), hx('#3aa0b0')];
const DUST: RGBA[] = [hx('#6a5a48'), hx('#8a7a64'), hx('#4a3e32')];

const frac = (x: number) => x - Math.floor(x);

// ---- Поза -------------------------------------------------------------------

interface RwO {
  /** Шаг: фаза, размах 0…1, стойка выпада (левая вперёд). */
  ph: number;
  step: number;
  wide: number;
  /** Присед, подскок таза. */
  crouch: number;
  lift: number;
  /** Корпус: вперёд, наклон вперёд (+), крен, поворот плеч (+ — правое назад). */
  fx: number;
  lean: number;
  roll: number;
  tw: number;
  /** Стрелки: угол от «вниз» (π/2 — вперёд, π — вверх), развод наружу. */
  aR: number;
  aL: number;
  sR: number;
  sL: number;
  /** Песок: доли колб, течёт (1 — вниз, −1 — вверх, 0 — стоит), фаза песчинок, горит 0…1. */
  fillU: number;
  fillL: number;
  flow: number;
  sph: number;
  hot: number;
  /** Стрелки циферблата-лица (рад); капюшон кивает (+ вниз); глаз 0…1. */
  dial: number;
  nod: number;
  eye: number;
  /** Трещина на колбах 0…1; стекло цело 0/1; куча песка на полу 0…1; капюшон слетел 0…1. */
  crack: number;
  glass: number;
  pile: number;
  hoodOff: number;
}

const R0: RwO = {
  ph: 0,
  step: 0,
  wide: 0,
  crouch: 0,
  lift: 0,
  fx: 0,
  lean: 0.04,
  roll: 0,
  tw: 0,
  aR: 0.25,
  aL: 0.15,
  sR: 0.12,
  sL: 0.12,
  fillU: 0.42,
  fillL: 0.5,
  flow: 1,
  sph: 0,
  hot: 0,
  dial: 0,
  nod: 0,
  eye: 1,
  crack: 0,
  glass: 1,
  pile: 0,
  hoodOff: 0,
};

const kp = (T: number, keys: KeyPose<RwO>[], base: RwO = R0) => keyPose(T, keys, base);

// ---- Материалы --------------------------------------------------------------

const plateM: Mat = {
  T: BRASS,
  spec: true,
  pat: (q, l) => {
    const rr = Math.hypot(q[0], q[1]);
    if (rr > 0.8 && rr < 0.9) return l > 0.5 ? BRASS[1] : BRASS[0];
    return null;
  },
};
const brassM: Mat = { T: BRASS, spec: true };
const ironM: Mat = { T: IRON, spec: true };
const bluedM: Mat = { T: BLUED, spec: true, bias: 0.05 };
const bladeM: Mat = { T: BLADE, spec: true, bias: 0.12 };
const hoodM: Mat = { T: HOOD, bias: 0.05 };

function sandM(hot: number): Mat {
  return hot > 0.5 ? { T: HOT, glow: 0.7 * hot, bias: 0.1 } : { T: RSAND, bias: 0.05 };
}

function dialM(rot: number): Mat {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return {
    T: DIAL,
    pat: (q) => {
      // Две стрелки на лице-циферблате (q[1] — вбок, q[2] — вверх).
      const x = q[1] * c - q[2] * s;
      const y = q[1] * s + q[2] * c;
      if (Math.abs(x) < 0.14 && y > 0 && y < 0.72) return IRON[1];
      if (Math.abs(y) < 0.14 && x > 0 && x < 0.5) return IRON[1];
      if (Math.hypot(q[1], q[2]) > 0.86) return DIAL[1];
      return null;
    },
  };
}

// ---- Риг --------------------------------------------------------------------

interface RPts {
  tipR: V3;
  tipL: V3;
  pivR: V3;
  pivL: V3;
  top: V3;
  neck: V3;
  lower: V3;
  upper: V3;
  base: V3;
}

const LEG1 = 4.7;
const LEG2 = 4.7;
/** Ход ступни за цикл шага, пикс.; цикл — клеток пути. */
const STR = 8;
const STRIDE_C = 1.0;
/** Колбы: радиус, центры над нижней плитой. */
const BR = 3.0;
const BV = 2.75;
const LOW_Z = 3.0;
const UP_Z = 8.8;
const TOP_Z = 11.9;
/** Длины стрелок: минутная, часовая. */
const MIN_L = 9.8;
const HOUR_L = 6.2;
const VIEW: V3 = [0, CE, SE];

const lerpF = (a: F3, b: F3, k: number): F3 =>
  new F3(
    vlerp(a.o, b.o, k),
    vnorm(vlerp(a.f, b.f, k)),
    vnorm(vlerp(a.s, b.s, k)),
    vnorm(vlerp(a.u, b.u, k)),
  );

const dot3 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function rewRig(o: RwO, yaw: number, r: Rig): RPts {
  const B = F3.yaw(yaw);
  const offs = [gait(o.ph)[0], gait(o.ph + 0.5)[0]];
  const stance = frac(o.ph) < 0.5 ? offs[0] : offs[1];
  const reach = Math.abs(stance * STR * o.step);
  const L = LEG1 + LEG2 - 0.4;
  const hipZ = Math.sqrt(Math.max(1, L * L - reach * reach)) - o.crouch + o.lift;
  const P = B.at(o.fx, 0, hipZ).roll(o.roll);
  const H = P.pitch(o.lean).turn(o.tw).at(0, 0, 0.4);
  // Ноги: латунные прутья, колено вперёд, железный башмак.
  for (const sd of [-1, 1]) {
    const hip = P.p(0, sd * 1.6, 0);
    const [off, rise] = gait(o.ph + (sd > 0 ? 0.5 : 0));
    const st = sd < 0 ? o.wide : -o.wide * 0.8;
    const foot = B.p(o.fx * 0.6 + off * STR * o.step + st, sd * 1.9, rise * 2.2 * o.step);
    const knee = ik(hip, foot, LEG1, LEG2, B.v(1, sd * 0.15, 0));
    r.cap(hip, knee, 0.72, 0.6, brassM);
    r.cap(knee, foot, 0.6, 0.5, brassM);
    r.ball(knee, 0.8, brassM);
    r.cap(vadd(foot, B.v(-0.8, 0, 0.3)), vadd(foot, B.v(1.7, 0, 0.1)), 0.78, 0.55, ironM);
  }
  // Песок на полу (течёт из трещины, рассыпан при смерти).
  if (o.pile > 0.02)
    r.ell(
      B,
      [o.fx * 0.4 - 0.4, 0, 0],
      [1 + 4.4 * o.pile, 1 + 3.8 * o.pile, 0.3 + 1.5 * o.pile],
      { T: RSAND },
      (q) => q[2] < 0,
    );
  // Плиты и стойки рамы.
  r.ell(H, [0, 0, 0], [4.0, 4.0, 0.75], plateM);
  r.ell(H, [0, 0, TOP_Z], [4.0, 4.0, 0.75], plateM);
  for (let i = 0; i < 4; i++) {
    const a = PI / 4 + (i * PI) / 2;
    const c = Math.cos(a) * 3.55;
    const s = Math.sin(a) * 3.55;
    r.cap(H.p(c, s, 0.4), H.p(c, s, TOP_Z - 0.4), 0.32, 0.32, brassM);
  }
  r.ell(H, [0, 0, (LOW_Z + UP_Z) / 2], [0.9, 0.9, 0.45], brassM);
  // Колбы: песок внутри, стекло с вырезом к зрителю (видно сквозь).
  const Vl: V3 = [dot3(VIEW, H.f), dot3(VIEW, H.s), dot3(VIEW, H.u)];
  const sM = sandM(o.hot);
  const lower = H.at(0, 0, LOW_Z);
  const upper = H.at(0, 0, UP_Z);
  const levL = -1 + 2 * clamp01(o.fillL);
  const levU = -1 + 2 * clamp01(o.fillU);
  if (o.fillL > 0.02) {
    r.ell(lower, [0, 0, 0], [BR - 0.4, BR - 0.4, BV - 0.35], sM, (q) => q[2] > levL);
    const rad = (BR - 0.4) * Math.sqrt(Math.max(0, 1 - levL * levL)) * 0.92;
    r.ell(
      lower,
      [0, 0, levL * (BV - 0.35)],
      [rad, rad, 0.9 * Math.min(1, o.fillL * 3)],
      sM,
      (q) => q[2] < 0,
    );
  }
  if (o.fillU > 0.02)
    r.ell(upper, [0, 0, 0], [BR - 0.4, BR - 0.4, BV - 0.35], sM, (q) => q[2] > levU);
  // Струйка через горлышко: песчинки бегут вниз или (отмотка) вверх.
  const neck = H.p(0, 0, (LOW_Z + UP_Z) / 2);
  const bot = lower.p(0, 0, levL * (BV - 0.35) + 0.6);
  if (o.flow !== 0 && o.fillU > 0.05 && o.fillL > 0.02) {
    const c = o.hot > 0.5 ? HOT[3] : RSAND[3];
    r.line(neck, bot, c, o.hot > 0.5 ? 0.9 : 0.2, 0.5);
    for (let i = 0; i < 2; i++) {
      const k = frac(o.sph + i / 2);
      r.dot(
        vlerp(neck, bot, o.flow > 0 ? k : 1 - k),
        o.hot > 0.5 ? HOT[2] : RSAND[2],
        o.hot,
        1,
        0.7,
      );
    }
  }
  if (o.glass > 0.5) {
    const gM: Mat = { T: GLASS, spec: true, bias: 0.12 };
    const hole = (q: V3) => q[0] * Vl[0] + q[1] * Vl[1] + q[2] * Vl[2] > 0.42;
    r.ell(lower, [0, 0, 0], [BR, BR, BV], gM, hole);
    r.ell(upper, [0, 0, 0], [BR, BR, BV], gM, hole);
  }
  // Капюшон с циферблатом и глазом-осью (при смерти слетает на пол).
  let Hh = H.at(0.3, 0, TOP_Z + 2.5).pitch(o.nod);
  if (o.hoodOff > 0) {
    const floor = F3.yaw(yaw + 1.2, B.p(o.fx - 2.6, 3.2, 1.9)).pitch(1.3);
    Hh = lerpF(Hh, floor, easeIn(o.hoodOff));
  }
  r.ell(
    Hh,
    [-0.3, 0, 0],
    [2.9, 3.0, 2.8],
    hoodM,
    (q) => q[0] > 0.35 && q[2] < 0.5 && Math.abs(q[1]) < 0.7,
  );
  r.cap(Hh.p(-1.6, 0, 2.0), Hh.p(-3.0, 0, 3.1), 1.3, 0.35, hoodM);
  r.ell(Hh, [0.5, 0, -0.3], [2.2, 2.3, 2.2], dialM(o.dial));
  const eyeP = Hh.p(2.6, 0, -0.3);
  const lit = o.eye > 0.4;
  r.dot(eyeP, lit ? EYE : EYE_OFF, lit ? o.eye : 0, 1, 0.9);
  r.eye = lit && o.hoodOff < 0.3 ? eyeP : null;
  // Руки-стрелки: противовес, вал, лопатка, острие.
  const pts: RPts = {
    tipR: H.p(0, 0, 0),
    tipL: H.p(0, 0, 0),
    pivR: H.p(0, 0, 0),
    pivL: H.p(0, 0, 0),
    top: Hh.p(0, 0, 3),
    neck,
    lower: lower.p(0, 0, 0),
    upper: upper.p(0, 0, 0),
    base: B.p(o.fx * 0.4, 0, 0),
  };
  for (const sd of [-1, 1]) {
    const a = sd > 0 ? o.aR : o.aL;
    const sp = sd > 0 ? o.sR : o.sL;
    const pv = H.p(0.3, sd * 4.3, TOP_Z - 1.3);
    const d = vnorm(vadd(H.v(Math.sin(a), 0, -Math.cos(a)), H.v(0, sd * sp, 0)));
    const Ln = sd > 0 ? MIN_L : HOUR_L;
    const at = (k: number) => vadd(pv, vmul(d, k));
    const cw = sd > 0 ? 1.8 : 1.4;
    r.cap(at(-cw), pv, 0.5, 0.42, bluedM);
    r.ball(at(-cw), sd > 0 ? 0.85 : 0.75, bluedM);
    const s0 = Ln * (sd > 0 ? 0.65 : 0.58);
    const s1 = Ln * (sd > 0 ? 0.8 : 0.74);
    r.cap(pv, at(s0), 0.45, 0.4, bluedM);
    const wb = sd > 0 ? 1.35 : 1.3;
    r.cap(at(s0), at(s1), 0.45, wb, bladeM);
    r.cap(at(s1), at(Ln), wb, 0.15, bladeM);
    r.ball(pv, 0.8, brassM);
    if (sd > 0) {
      pts.tipR = at(Ln);
      pts.pivR = pv;
    } else {
      pts.tipL = at(Ln);
      pts.pivL = pv;
    }
  }
  return pts;
}

// ---- Треки ------------------------------------------------------------------

const tf = (f: number) => (f + 0.5) / FPS;
const WIND_T = 0.55;
const DIE_T = 0.85;
const REW_T = 0.45;
/** Дурман: щелчок 8 кадров, потом петля 12 кадров на 15 к/с. */
const DAZ_SNAP = 8;
const DAZ_LOOP = 12;

/** Минутная стрелка в замахе: три щелчка храповика назад, держит, срывается. */
const WIND_AR = [
  0.25, -0.5, -1.1, -0.95, -1.5, -2.15, -2.0, -2.45, -2.85, -2.75, -2.72, -2.78, -3.2, -3.75,
];
/** Кадры щелчков (корпус вздрагивает, искры храповика — кадром позже). */
const TICKS = [1, 4, 7];

function windO(T: number, f: number): RwO {
  const o = kp(T, [
    [0, {}],
    [0.12, { lean: -0.08, tw: 0.3, crouch: 0.6, aL: 0.9, fx: -0.3, wide: 0.8 }, easeOut],
    [
      0.34,
      { lean: -0.16, tw: 0.55, crouch: 1.1, aL: 1.25, sL: 0.05, fx: -0.6, wide: 1.6, nod: -0.1 },
    ],
    [
      0.47,
      { lean: -0.18, tw: 0.6, crouch: 1.2, aL: 1.3, sL: 0.05, fx: -0.7, wide: 1.8, nod: -0.12 },
    ],
    [WIND_T, { lean: 0.05, tw: 0.25, crouch: 1.0, aL: 1.0, fx: 0, wide: 2.0 }, easeIn],
  ]);
  o.aR = WIND_AR[Math.min(f, WIND_AR.length - 1)];
  o.sR = 0.25;
  if (TICKS.includes(f)) {
    o.roll += 0.05;
    o.fx -= 0.2;
  }
  if (f === 10 || f === 11) o.fx += f === 10 ? 0.25 : -0.25;
  o.sph = T * 6;
  o.dial = -T * 3;
  return o;
}

/** Удар: стрелка рубит сверху наискось через корпус (`s` — развод, минус — к левому боку). */
const STRIKE_AR: KeyPose<{ a: number; s: number }>[] = [
  [0, { a: -4.75, s: -0.85 }],
  [0.1, { a: -5.6, s: -0.75 }, easeOut],
  [0.3, { a: -5.75, s: -0.3 }],
  [0.55, { a: -6.03, s: 0.12 }],
];
/** След острия в кадрах контакта: (угол, развод). */
const ARC0: [number, number][] = [
  [-3.4, 0.2],
  [-3.85, 0],
  [-4.3, -0.45],
  [-4.75, -0.85],
];

function strikeO(T: number): RwO {
  const o = kp(T, [
    [0, { lean: 0.12, tw: -0.45, fx: 1.4, crouch: 0.4, wide: 2.2, aL: -0.2, nod: 0.12 }],
    [0.1, { lean: 0.16, tw: -0.6, fx: 1.7, crouch: 0.5, wide: 2.2, aL: -0.5 }, easeOut],
    [0.3, { lean: 0.05, tw: -0.1, fx: 0.3, crouch: 0.4, wide: 1.0, aL: 0.3 }],
    [0.6, {}],
  ]);
  const k = keyPose(T, STRIKE_AR, { a: 0, s: 0 });
  o.aR = k.a;
  o.sR = k.s;
  o.sph = 1.5 + T * 6;
  return o;
}

const LIMP: Partial<RwO> = {
  crack: 1,
  crouch: 1.5,
  roll: 0.12,
  lean: 0.18,
  nod: 0.35,
  aR: 0.05,
  aL: -0.05,
  sR: 0.35,
  sL: 0.3,
  flow: 0,
  fillL: 0.42,
  fillU: 0.3,
  eye: 0.7,
  pile: 0.22,
};

function dazedO(f: number): RwO {
  if (f < DAZ_SNAP) {
    const T = tf(f);
    return kp(T, [
      [
        0,
        {
          fx: -1.2,
          lean: -0.3,
          aR: -1.4,
          aL: 1.6,
          sR: 0.5,
          sL: 0.5,
          crack: 1,
          eye: 0.3,
          crouch: 0.4,
        },
      ],
      [
        0.12,
        {
          fx: -0.6,
          lean: -0.1,
          aR: -0.6,
          aL: 0.8,
          sR: 0.4,
          sL: 0.4,
          crack: 1,
          crouch: 1.2,
          roll: 0.08,
        },
        easeOut,
      ],
      [DAZ_SNAP / FPS, LIMP],
    ]);
  }
  const a = ((f - DAZ_SNAP) / DAZ_LOOP) * TAU;
  return {
    ...R0,
    ...LIMP,
    roll: 0.12 + 0.07 * Math.sin(a),
    lean: 0.18 + 0.04 * Math.sin(a + 1),
    aR: 0.05 + 0.3 * Math.sin(a - 0.8),
    aL: -0.05 + 0.28 * Math.sin(a - 1.2),
    nod: 0.35 + 0.05 * Math.sin(a),
    eye: f - DAZ_SNAP === 3 || f - DAZ_SNAP === 8 ? 0 : 0.75,
  };
}

/** Смерть: колбы лопаются, песок — на пол, рама оседает набок, капюшон слетает. */
function dieO(T: number, f: number): RwO {
  const down: Partial<RwO> = {
    glass: 0,
    fillU: 0,
    fillL: 0,
    crouch: 5.0,
    roll: 1.15,
    fx: -0.4,
    lean: 0.2,
    aR: 0.9,
    aL: -0.8,
    sR: 0.8,
    sL: 0.8,
    hoodOff: 1,
    eye: 0.3,
    pile: 0.9,
    flow: 0,
  };
  const o = kp(T, [
    [0, {}],
    [
      0.08,
      { fx: -0.8, lean: -0.28, aR: -1.2, aL: 1.4, sR: 0.5, sL: 0.5, nod: -0.3, crack: 1 },
      easeOut,
    ],
    [
      0.2,
      {
        glass: 0,
        fillU: 0,
        fillL: 0,
        crouch: 1.5,
        lean: -0.1,
        roll: 0.2,
        aR: -0.6,
        aL: 0.8,
        pile: 0.35,
        flow: 0,
      },
    ],
    [0.5, down, easeIn],
    [0.6, { ...down, crouch: 4.5, roll: 1.05 }],
    [DIE_T, { ...down, crouch: 4.8, roll: 1.1, eye: 0, pile: 1 }],
  ]);
  o.glass = f >= 3 ? 0 : 1;
  if (f >= 3) {
    o.fillU = 0;
    o.fillL = 0;
  }
  o.eye = f < 3 ? 1 : f < 12 ? (f % 3 === 0 ? 0.2 : 0.8) : f < 15 ? 0.3 : 0;
  return o;
}

/** Окно перед отмоткой: песок горит и течёт вверх, циферблат крутится назад. */
function hotO(o: RwO, f: number): RwO {
  return {
    ...o,
    hot: 1,
    flow: -1,
    fillU: o.fillU + 0.12,
    fillL: o.fillL - 0.12,
    sph: f / 3,
    dial: -f * 0.9,
    eye: 1,
  };
}

function rwPose(anim: string, f: number): RwO {
  const T = tf(f);
  if (anim.endsWith('H')) return hotO(rwPose(anim.slice(0, -1), f), f);
  switch (anim) {
    case 'idle': {
      const a = (f / 16) * TAU;
      const tick = (f >> 2) % 2 ? 1 : -1;
      const snap = f % 4 === 0 ? 1.6 : 1;
      return {
        ...R0,
        aR: 0.25 + 0.07 * tick * snap,
        aL: 0.15 - 0.03 * tick,
        roll: 0.03 * Math.sin(a),
        nod: 0.06 * Math.sin(a + 1),
        crouch: 0.25 + 0.25 * Math.sin(a),
        sph: (f / 16) * 4,
        dial: tick * 0.25,
      };
    }
    case 'walk': {
      const ph = f / 8;
      const a = ph * TAU;
      return {
        ...R0,
        ph,
        step: 1,
        lean: 0.14,
        roll: 0.05 * Math.sin(a),
        aR: 0.25 + 0.42 * Math.cos(a),
        aL: 0.15 - 0.42 * Math.cos(a),
        nod: 0.04 * Math.sin(2 * a),
        sph: ph * 2,
      };
    }
    case 'wind':
      return windO(Math.min(T, WIND_T - 0.005), f);
    case 'strike':
      return strikeO(T);
    case 'flinch': {
      const k = f / 6;
      const b = Math.sin(PI * Math.min(1, k * 1.4)) * (1 - k * 0.5);
      return {
        ...R0,
        fx: -1.2 * b,
        lean: 0.04 - 0.34 * b,
        roll: 0.1 * b,
        aR: 0.25 - 0.8 * b,
        aL: 0.15 + 0.9 * b,
        sR: 0.12 + 0.3 * b,
        sL: 0.12 + 0.3 * b,
        crouch: 0.6 * b,
        nod: -0.2 * b,
        sph: k,
        eye: 1 - 0.6 * b,
      };
    }
    case 'rewind': {
      const k = clamp01(T / REW_T);
      return {
        ...R0,
        ph: 1 - T * 3.4,
        step: 1,
        lean: -0.14,
        roll: 0.04 * Math.sin(T * 30),
        aR: 0.25 - T * ((4 * PI) / REW_T),
        aL: 0.15 - T * (PI / REW_T),
        sR: 0.2,
        sL: 0.2,
        hot: 1,
        flow: -1,
        fillU: lerp(0.5, 0.75, k),
        fillL: lerp(0.4, 0.2, k),
        sph: f / 2,
        dial: -f * 1.3,
      };
    }
    case 'dazed':
      return dazedO(f);
    case 'die':
      return dieO(T, f);
    case 'sleep': {
      const a = (f / 4) * TAU;
      return {
        ...R0,
        crouch: 4.6 + 0.15 * Math.sin(a),
        lean: 0.3,
        nod: 0.45,
        aR: 0.5,
        aL: 0.4,
        sR: 0.6,
        sL: 0.6,
        eye: 0.1,
        flow: 0,
      };
    }
    case 'alert':
      return kp(T, [
        [
          0,
          {
            crouch: 4.6,
            lean: 0.3,
            nod: 0.45,
            aR: 0.5,
            aL: 0.4,
            sR: 0.6,
            sL: 0.6,
            eye: 0.1,
            flow: 0,
          },
        ],
        [
          0.12,
          { crouch: -0.2, lift: 0.8, aR: -1.0, aL: 1.2, sR: 0.3, sL: 0.3, nod: -0.15 },
          easeOut,
        ],
        [0.35, {}],
      ]);
    case 'drop':
      return { ...R0, wide: 1.2, crouch: 0.6, aR: 2.6, aL: 2.4, sR: 0.5, sL: 0.5, lean: -0.15 };
    case 'land':
      return kp(T, [
        [0, { crouch: 2.4, lean: 0.2, aR: 1.0, aL: 1.0, sR: 0.6, sL: 0.6 }],
        [0.12, { crouch: 0.3, lift: 0.4, aR: -0.2, aL: -0.1 }, easeOut],
        [0.3, {}],
      ]);
  }
  return { ...R0 };
}

// ---- Кадр -------------------------------------------------------------------

const KR = kindOf('rewinder', 84, 66, 42, 48, 1800);

/** Острие минутной стрелки при угле `a` (для следа). */
function tipAt(o: RwO, yaw: number, a: number, s = o.sR): [V3, V3] {
  const q = rewRig({ ...o, aR: a, sR: s }, yaw, new Rig());
  return [q.tipR, q.pivR];
}

/** «Рваная плёнка»: строки кадра сдвинуты вбок (кадр отмотки). */
function tear(o: RigOut, f: number): void {
  const p = o.p;
  for (let b = 0; b < 2; b++) {
    const y0 = 10 + Math.floor(hash(f, b, 7) * (p.h - 24));
    const hgt = 1 + Math.floor(hash(f, b, 8) * 2);
    const sh = (hash(f, b, 9) < 0.5 ? -1 : 1) * (1 + Math.floor(hash(b, f, 10) * 2));
    for (let y = y0; y < Math.min(p.h, y0 + hgt); y++) {
      const row = p.data.slice(y * p.w * 4, (y + 1) * p.w * 4);
      for (let x = 0; x < p.w; x++) {
        const sx = x - sh;
        const j = (y * p.w + x) * 4;
        if (sx < 0 || sx >= p.w) {
          p.data[j + 3] = 0;
          continue;
        }
        for (let c = 0; c < 4; c++) p.data[j + c] = row[sx * 4 + c];
      }
    }
  }
}

function post(anim: string, f: number, d: number, o: RigOut, P: Proj2, pts: RPts, ro: RwO): void {
  const yaw = yawN(d);
  const base = anim.endsWith('H') ? anim.slice(0, -1) : anim;
  if (base === 'wind' && TICKS.includes(f - 1)) {
    // Щелчок храповика: искры у шарнира плеча.
    const [x, y] = P(pts.pivR);
    spark2(o, Math.round(x), Math.round(y) - 1, SPARK, 0.8);
    spark2(o, Math.round(x) + 1, Math.round(y) - 2, SPARK2, 0.6);
    spark2(o, Math.round(x) - 1, Math.round(y), SPARK2, 0.5);
  }
  if (base === 'strike' && f <= 1) {
    // След острия: дуга взмаха минутной стрелки.
    const as: [number, number][] =
      f === 0
        ? ARC0
        : [
            [-4.75, -0.85],
            [-5.1, -0.8],
            [ro.aR, ro.sR],
          ];
    const tips: [number, number][] = [];
    const bases: [number, number][] = [];
    for (const [a, sr] of as) {
      const [tp, pv] = tipAt(ro, yaw, a, sr);
      tips.push(P(tp));
      bases.push(P(vlerp(tp, pv, 0.3)));
    }
    smear(o, tips, bases, hx('#e4f4ff', 160), 0.5);
    const [x, y] = P(pts.tipR);
    spark2(o, Math.round(x), Math.round(y), SPARK);
    if (f === 0) {
      spark2(o, Math.round(x) + 1, Math.round(y) - 1, SPARK2, 0.7);
      spark2(o, Math.round(x) - 1, Math.round(y) + 1, SPARK2, 0.7);
    }
  }
  if (base === 'rewind') {
    // Стрелки крутятся назад — веер следа; плёнка рвётся строками.
    const step = (4 * PI) / REW_T / FPS;
    const tips: [number, number][] = [];
    const bases: [number, number][] = [];
    for (const k of [1, 0.66, 0.33, 0]) {
      const [tp, pv] = tipAt(ro, yaw, ro.aR + step * k);
      tips.push(P(tp));
      bases.push(P(vlerp(tp, pv, 0.6)));
    }
    smear(o, tips, bases, hx('#9af4ff', 150), 0.6);
    tear(o, f);
  }
  if (base === 'dazed') {
    // Трещина по нижней колбе светится (окно урона), песок течёт на пол.
    const [cx, cy] = P(pts.lower);
    const glow = f < 3;
    const crack: [number, number][] = [
      [-2, -2],
      [-1, -1],
      [-1, 0],
      [0, 1],
      [1, 1],
      [1, 2],
      [0, -1],
      [1, -2],
    ];
    for (const [x, y] of crack)
      spark2(o, Math.round(cx) + x, Math.round(cy) + y, glow ? SPARK : HOT[2], glow ? 1 : 0.8);
    const lf = f - DAZ_SNAP;
    if (lf >= 0) {
      for (let i = 0; i < 3; i++) {
        const k = frac(lf / 6 + i / 3);
        o.p.set(Math.round(cx) + 1, Math.round(cy + 3 + k * 8), GRAIN[i]);
      }
      const [tx, ty] = P(pts.top);
      stars(o, tx, ty - 1, 4, lf / DAZ_LOOP, 3);
    }
  }
  if (base === 'die') {
    const [lx, ly] = P(pts.lower);
    const [ux, uy] = P(pts.upper);
    if (f === 3 || f === 4) {
      for (const [x, y] of [
        [lx, ly],
        [ux, uy],
      ])
        for (const [dx, dy] of [
          [0, 0],
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ])
          spark2(
            o,
            Math.round(x) + dx,
            Math.round(y) + dy,
            f === 3 ? hx('#ffffff') : SHARD[0],
            0.9,
          );
    }
    if (f >= 3 && f <= 14) {
      const k = (f - 3) / 11;
      for (let i = 0; i < 12; i++) {
        const [x0, y0] = i % 2 ? [lx, ly] : [ux, uy];
        const a = hash(d, i, 21) * TAU;
        const dist = (4 + hash(i, d, 22) * 9) * easeOut(k * 1.3);
        const x = x0 + Math.cos(a) * dist;
        const y = Math.min(ly + 10, y0 + Math.sin(a) * dist * 0.6 + k * k * 12);
        o.p.set(Math.round(x), Math.round(y), SHARD[i % 3]);
      }
      if (f <= 8) spray(o.p, lx, ly, 10, 8, (f - 2) / 6, 31 + d, GRAIN, 6, 2);
    }
  }
  if (base === 'land' && f < 6) {
    const [x, y] = P(pts.base);
    spray(o.p, x, y + 1, 10, 8, (f + 1) / 6, 41 + d, DUST, 1, 1);
  }
}

const rwPic = (anim: string, f: number, d: number): Pic => {
  const ro = rwPose(anim, f);
  const yaw = yawN(d);
  const r = new Rig();
  const pts = rewRig(ro, yaw, r);
  return draw(KR, r, (o, P) => post(anim, f, d, o, P, pts, ro));
};

/** Режимы, где курс держит мозг (`m.face`). */
const TECH = new Set(['windup', 'recover', 'f14_rewind', 'f14_dazed']);

registerMobPainter('f14_rewinder', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = pose.t;
  const now = pose.now || 0;
  const want = TECH.has(md) ? (m.face ?? 0) : headOf(m);
  const v = visOf(m, pose, want, md === 'windup' ? 16 : 10);
  const d = sideOf(v);
  const ex: Partial<MobFrame> = { shadow: 5 };
  let anim = 'idle';
  let f = 0;
  let gray = false;
  let canHot = false;
  if (md === 'dying') {
    anim = 'die';
    f = fi(t, 20);
    ex.linger = DIE_T;
    ex.alpha = 1 - sstep(0.7, DIE_T, t);
    ex.still = true;
  } else if (md === 'f14_frozen') {
    gray = true;
    if (m.data?.frame) {
      anim = 'strike';
      f = 1;
    }
    ex.still = true;
  } else if (md === 'windup') {
    anim = 'wind';
    f = fi(t, 13);
    ex.still = true;
    canHot = true;
  } else if (md === 'recover') {
    anim = 'strike';
    f = fi(t, 14);
    ex.still = true;
    canHot = true;
    if (f < 3) ex.ghost = { every: 0.03, life: 0.12, tint: '#c8e0ff', alpha: 0.22 };
    if (f < 1) {
      ex.sx = 1.04;
      ex.sy = 0.97;
    }
  } else if (md === 'f14_rewind') {
    anim = 'rewind';
    f = fi(t, 10);
    ex.still = true;
    ex.ghost = { every: 0.035, life: 0.2, tint: '#7ef0ff', alpha: 0.3 };
  } else if (md === 'f14_dazed') {
    anim = 'dazed';
    f =
      t < DAZ_SNAP / FPS
        ? fi(t, DAZ_SNAP - 1)
        : DAZ_SNAP + (Math.floor((t - DAZ_SNAP / FPS) * 15) % DAZ_LOOP);
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
    // Встаёт там, где пал (зал отмотки): смерть задом наперёд — колбы собираются.
    anim = 'die';
    f = 20 - Math.min(4, Math.floor(t * FPS)) * 5;
    ex.still = true;
  } else if (md === 'stun' || hurtAge(v, now) < 0.25) {
    anim = 'flinch';
    f = fi(md === 'stun' ? t : hurtAge(v, now), 5);
    canHot = true;
  } else if (md === 'sleep') {
    anim = 'sleep';
    f = Math.floor(idlePh(m, pose, 2.4) * 4) % 4;
  } else if (md === 'alert') {
    anim = 'alert';
    f = fi(t, 7);
  } else if (md === 'emerge' || moving(m, 0.4)) {
    anim = 'walk';
    f = Math.floor(frac(v.dist / STRIDE_C) * 8) % 8;
    canHot = true;
  } else {
    anim = 'idle';
    f = Math.floor(idlePh(m, pose, 1.6) * 16) % 16;
    canHot = true;
  }
  if (md !== 'dying' && !gray) hurtFx(v, now, 0.9, ex);
  const rwAt = m.data?.rwAt;
  if (canHot && rwAt !== undefined) {
    // Окно перед отмоткой: тело дёргает к якорю, всё чаще и сильнее.
    anim += 'H';
    const k = clamp01(1 - (rwAt - wnow(pose)) / 0.55);
    const ax = (m.data.ax ?? m.x) - (m.x ?? 0);
    const ay = (m.data.ay ?? m.y) - (m.y ?? 0);
    const l = Math.hypot(ax, ay);
    if (l > 0.05 && frac(now * (6 + 8 * k) + hash(m.id ?? 0, 3)) < 0.45) {
      const amp = 0.6 + 1.6 * k;
      ex.dx = (ex.dx ?? 0) + (ax / l) * amp;
      ex.dy = (ex.dy ?? 0) + (ay / l) * amp * 0.6;
    }
  }
  return { ...frameOf(KR, anim, f, d, pose, () => rwPic(anim, f, d), gray), ...ex };
});

/** Всё, что играет в бою, — во всех 8 сторонах (окно отмотки — тоже). */
const WARM: [string, number, number[]?][] = [
  ['walk', 8],
  ['idle', 16],
  ['wind', 14],
  ['strike', 15],
  ['flinch', 6],
  ['walkH', 8],
  ['idleH', 16],
  ['windH', 14],
  ['strikeH', 15],
  ['flinchH', 6],
  ['rewind', 11],
  ['dazed', DAZ_SNAP + DAZ_LOOP],
  ['die', 21],
  ['sleep', 4],
  ['alert', 8],
  ['drop', 1],
  ['land', 8],
];

regWarm(
  'f14_rewinder',
  function* () {
    yield* warmAll(KR, WARM, rwPic);
    yield* warmGray(KR, [['strike', [1]]]);
  },
  [[KR, demOf(WARM, rwPic)]],
);
