// Робот-садовник (анимации мобов 11): бронзовый бочонок на коротких ногах,
// мох и цветок на макушке, маленькая голова с одной линзой (бирюзовой, пока
// садовник спокоен, красной — когда зол), длинные руки до земли. В правой —
// садовые ножницы, в левой — брандспойт; шланг идёт к баку за спиной.
// Мини-3D (`f15-rig.ts`), 8 сторон честно (ножницы и шланг — в разных
// руках), 24 к/с от `pose.t`.
//
// Метроном — `f11-brains.ts` (`f11_gardener`, `GARDENER`):
// - `f11_tend` — спокоен: `data.trim` — стоит и стрижёт куст перед собой
//   (два щелчка, осмотр, полив из брандспойта), иначе бредёт по грядке;
// - `f11_rage` 0,6 с — вздрогнул, линза вспыхнула и покраснела, пар из
//   головы, трясёт кулаками, щёлкает ножницами, топнул — и в погоню;
// - `f11_snip` 0,8 с: ножницы раскрыты и отведены за плечо (корпус
//   скручен), задержка с дрожью, выпад — кадр контакта — первый кадр
//   `recover`: ножницы сомкнулись перед собой, блик и обрезки; проводка,
//   отдача, возврат;
// - `f11_hose` 1 с: поднял брандспойт, правой перехватил шланг, присел —
//   бак за спиной раздувается, по шлангу бежит волна, с носика капает;
//   замок — дрожь и блик на носике; кадр контакта — первый кадр `recover`:
//   отдача струи, брызги веером; бак сдувается, с носика течёт;
// - смерть 0,9 с: искры, линза мигает, ноги подкосились — валится на спину,
//   цветок слетает, из бака хлещет вода.
// Струя (зона мозга `f11_jetfx`) и мокрый след на полу (`f11_jet`) — здесь.

import {
  registerImpactPainter,
  registerMobPainter,
  registerMobWarm,
  registerZonePainter,
} from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob, Zone } from '../dungeon-sim';
import { GARDENER } from './f11-brains';
import {
  F3,
  FPS,
  KRig,
  PI,
  TAU,
  WHITE,
  alpha,
  arm,
  camSide,
  clamp,
  clamp01,
  dirN,
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
  kindOf,
  leg,
  lerp,
  mixc,
  moving,
  put,
  smear,
  spark2,
  spray,
  sstep,
  tn,
  trk,
  vadd,
  vlerp,
  vmul,
  vnorm,
  visOf,
  warmAll,
  yawN,
} from './f11-mobkit';
import type { Key, Pic, RGBA, RigOut, Tones, V3 } from './f11-mobkit';
import { vcross } from './f15-rig';
import type { Mat } from './f15-rig';

const BOT = tn('#4a3a2a', '#6e583e', '#957856', '#b99c74');
const BOT_L = tn('#5e4a32', '#8a7050', '#b49870', '#dcc49a');
const BOT_D = tn('#241a12', '#3a2c1e', '#54412c', '#6e583e');
const SEAM = hx('#34281c');
const MOSS = tn('#26492a', '#36633a', '#4f8446', '#76ad58');
const BRASS = tn('#6a4a1a', '#a07a30', '#d0a84a', '#f4d884');
const HOSE = tn('#34420e', '#58701c', '#80a02c', '#b4cc58');
const STEEL = tn('#5c6470', '#9aa4b0', '#cfd6de', '#ffffff');
const GRIP = tn('#5a1a14', '#8a2a1e', '#b84030', '#e07050');
const RIM = tn('#14161c', '#20242c', '#2c3038', '#3a4048');
const CALM = tn('#0e4a48', '#1e8a84', '#6ff4e6', '#d8fffa');
const ANGRY = tn('#5a1008', '#b02414', '#ff5a3a', '#ffc0a0');
const OFF = tn('#1e2228', '#2c3038', '#3a4048', '#4c5260');
const PETAL = hx('#f4f0ea');
const POLLEN = hx('#f6d24a');
const STEAM = hx('#eef4f8');
const SMOKE = hx('#4c4c54');
const WATER: RGBA[] = [hx('#e8f8ff'), hx('#9ad6ff'), hx('#5aa8e8')];
const SPARK: RGBA[] = [hx('#fff6c0'), hx('#ffd060'), hx('#ffffff')];
const LEAVES: RGBA[] = [MOSS[2], MOSS[3], hx('#a8d070'), MOSS[1]];
const SMEAR_C = hx('#e8eef6', 200);

const band = (T: Tones, l: number): RGBA =>
  l > 0.78 ? T[3] : l > 0.38 ? T[2] : l > -0.02 ? T[1] : T[0];

// ---- Поза --------------------------------------------------------------------

interface GnO {
  /** Сдвиг корпуса вперёд и вбок, высота таза (+ вверх). */
  fwd: number;
  side: number;
  lift: number;
  /** Присел 0…1, наклон вперёд, скрутка (+ — правое плечо назад), крен. */
  crouch: number;
  lean: number;
  twist: number;
  roll: number;
  /** Голова: кивок (+ вниз) и поворот. */
  head: number;
  hturn: number;
  /** Шаг: фаза и доля; стойка шире. */
  ph: number;
  step: number;
  wide: number;
  /** Правая кисть (ножницы) и направление лезвий, раскрытие 0…1. */
  hR: V3;
  bR: V3;
  op: number;
  /** Левая кисть (брандспойт) и направление носика. */
  hL: V3;
  nL: V3;
  /** Линза: 0 — погасла, 1 — горит, >1 — вспышка; цвет 0 — бирюза, 1 — красный. */
  eye: number;
  red: number;
  /** Пар из головы 0…1 и его фаза (кадр). */
  steam: number;
  sp: number;
  /** Давление в баке 0…1, волна по шлангу (фаза 0…1, сила). */
  tank: number;
  wave: number;
  swell: number;
  /** Антенна отстаёт: сдвиг кончика (вперёд, вбок). */
  ant: [number, number];
  /** Падение на спину 0…1; цветок на месте. */
  tip: number;
  bloom: boolean;
}

/** Масштаб рига: садовник ростом с прежний спрайт. */
const GS = 1.12;
const HIP = 6.6;
const THIGH = 4.1;
const SHIN = 4.1;
const ARM1 = 7.6;
const ARM2 = 7.6;
const BLADE_L = 7.4;
/** Бочонок: центр над тазом и полуоси (вперёд, вбок, вверх). */
const BC = 8.6;
const BR: V3 = [6.8, 7.4, 8.4];
/** Голова: выдвинута вперёд с верха бочонка. */
const HX = 5.6;
const HZ = 14.4;
const STANCE_R: V3 = [3.0, 8.6, 4.8];
const STANCE_B: V3 = [0.75, 0.15, -0.6];
const STANCE_L: V3 = [3.0, -8.6, 5.0];
const STANCE_N: V3 = [0.7, -0.1, -0.7];

const G0: GnO = {
  fwd: 0,
  side: 0,
  lift: 0,
  crouch: 0.1,
  lean: 0.06,
  twist: 0,
  roll: 0,
  head: 0.05,
  hturn: 0,
  ph: 0,
  step: 0,
  wide: 0.3,
  hR: STANCE_R,
  bR: STANCE_B,
  op: 0.12,
  hL: STANCE_L,
  nL: STANCE_N,
  eye: 1,
  red: 1,
  steam: 0,
  sp: 0,
  tank: 0,
  wave: 0,
  swell: 0,
  ant: [0, 0],
  tip: 0,
  bloom: true,
};

/** Бочонок: шапка мха, пояс с заклёпками, решётка спереди. */
const BODY_M: Mat = {
  T: BOT,
  spec: true,
  pat: (q, l) => {
    if (q[2] > 0.66 && q[0] < 0.3) {
      const n = hash(Math.floor(q[0] * 5 + 9), Math.floor(q[1] * 5 + 9), 711);
      if (n < 0.8 - (0.95 - q[2]) * 2.4) return band(MOSS, l + (n - 0.5) * 0.5);
    }
    const z = q[2] + 0.1;
    if (Math.abs(z) < 0.085) {
      if (Math.abs(z) > 0.05) return SEAM;
      const a = Math.atan2(q[1], q[0]);
      const k = a / 0.42 - Math.round(a / 0.42);
      return Math.abs(k) < 0.2 ? BOT[3] : BOT[l > 0.4 ? 1 : 0];
    }
    if (q[0] > 0.55 && Math.abs(q[1] - 0.16) < 0.3 && q[2] > 0.1 && q[2] < 0.46)
      return Math.floor((q[2] - 0.1) / 0.09) % 2 === 0 ? SEAM : null;
    return null;
  },
};
const HEAD_M: Mat = {
  T: BOT_L,
  spec: true,
  bias: 0.04,
  pat: (q, l) => {
    if (q[2] < -0.24 && q[2] > -0.42) return SEAM;
    if (
      q[2] > 0.7 &&
      q[0] < 0 &&
      hash(Math.floor(q[0] * 5 + 9), Math.floor(q[1] * 5 + 9), 719) < 0.4
    )
      return band(MOSS, l);
    return null;
  },
};
const TANK_M = (bias: number): Mat => ({
  T: BRASS,
  spec: true,
  bias,
  pat: (q) => (Math.abs(q[0] - 0.22) < 0.05 || Math.abs(q[0] - 0.78) < 0.05 ? BRASS[0] : null),
});

const frameB = (yaw: number) => F3.yaw(yaw).scale(GS);
const handFrame = (B: F3, o: GnO) => B.at(o.fwd, o.side, o.lift - o.crouch * 2.4);

/**
 * Куда валится мёртвый (рад от «назад» к правому боку): так, чтобы на экране
 * он упал поперёк — влево или вправо, а не от зрителя.
 */
function fallAz(yaw: number): number {
  let a = -yaw;
  a = ((a % TAU) + TAU) % TAU;
  if (a > PI) a -= TAU;
  if (a > PI / 2) a -= PI;
  if (a < -PI / 2) a += PI;
  return a;
}

/** Таз и корпус (у падающего — наклон вместе с ногами). */
function bodyFrames(B: F3, o: GnO, yaw: number): { P: F3; T: F3 } {
  let P = B.at(o.fwd, o.side, lerp(HIP - o.crouch * 2.4 + o.lift, 7.8, o.tip));
  if (o.tip > 0) {
    const az = fallAz(yaw);
    P = P.turn(az)
      .at(o.tip * 2.6, 0, 0)
      .pitch(-o.tip * 1.42)
      .turn(-az);
  }
  P = P.roll(o.roll);
  const T = P.at(0, 0, 1)
    .turn(o.twist)
    .pitch(o.lean * (1 - o.tip));
  return { P, T };
}

/** Ножницы: ось, концы лезвий и рукоятей (мир). */
function shearsOf(B: F3, W: F3, o: GnO): { pv: V3; t1: V3; t2: V3; g1: V3; g2: V3; d: V3 } {
  const hand = W.p(o.hR[0], o.hR[1], o.hR[2]);
  const d = vnorm(B.v(o.bR[0], o.bR[1], o.bR[2]));
  let n = vcross(d, B.s);
  if (Math.hypot(n[0], n[1], n[2]) < 0.2) n = vcross(d, B.f);
  n = vnorm(n);
  const pv = vadd(hand, vmul(d, 1.1 * GS));
  const a = 0.08 + o.op * 0.5;
  const b = 0.12 + o.op * 0.3;
  const L = BLADE_L * GS;
  const tip = (s: number): V3 =>
    vadd(pv, vmul(vadd(vmul(d, Math.cos(a)), vmul(n, s * Math.sin(a))), L));
  const grip = (s: number): V3 =>
    vadd(pv, vmul(vadd(vmul(d, -Math.cos(b)), vmul(n, s * Math.sin(b))), 2.6 * GS));
  return { pv, t1: tip(1), t2: tip(-1), g1: grip(1), g2: grip(-1), d };
}

/** Носик брандспойта: основание и срез (мир). */
function nozzleOf(B: F3, W: F3, o: GnO): [V3, V3, V3] {
  const hand = W.p(o.hL[0], o.hL[1], o.hL[2]);
  const d = vnorm(B.v(o.nL[0], o.nL[1], o.nL[2]));
  return [hand, vadd(hand, vmul(d, 0.8 * GS)), vadd(hand, vmul(d, 4.4 * GS))];
}

function gardenerRig(o: GnO, yaw: number): KRig {
  const r = new KRig(GS);
  const B = frameB(yaw);
  const cs = camSide(yaw);
  const { P, T } = bodyFrames(B, o, yaw);
  const limbM = (near: boolean): Mat => ({ T: BOT, bias: near ? -0.08 : -0.24, spec: true });
  // Ноги: короткие, ступни-башмаки.
  for (const sd of [-1, 1]) {
    const near = sd === cs;
    const hip = P.p(0, sd * 3.4, 0.8);
    const [off, rise] = gait(o.ph + (sd > 0 ? 0.5 : 0));
    let foot = B.p(
      o.fwd * 0.4 + off * 6.4 * o.step,
      o.side * 0.4 + sd * (3.4 + o.wide * 1.2),
      rise * 2.2 * o.step,
    );
    if (o.tip > 0) foot = vlerp(foot, P.p(-2.6, sd * 3.8, -6.4), easeOut(o.tip));
    const knee = leg(r, hip, foot, THIGH * GS, SHIN * GS, B.v(1, sd * 0.2, 0), [1.9, 1.6, 1.4], {
      T: BOT_D,
      bias: near ? 0.04 : -0.16,
      spec: true,
    });
    r.ball(knee, 1.5, { T: BOT, bias: near ? 0 : -0.15, spec: true });
    const F = F3.yaw(0, vadd(foot, B.v(0.8, 0, 0.4)))
      .turn(Math.atan2(B.f[1], B.f[0]))
      .pitch(-o.tip * 1.2)
      .scale(GS);
    r.ell(F, [0, 0, 0], [2.5, 1.7, 1.2], { T: BOT, bias: near ? -0.05 : -0.2, spec: true });
  }
  // Таз, бочонок, шея.
  r.ell(P, [0, 0, 1.4], [3.6, 4.8, 2.2], { T: BOT_D, spec: true });
  r.ell(T, [0, 0, BC], BR, BODY_M);
  r.ell(T, [HX - 1.4, 0, HZ - 1.6], [2.4, 2.8, 1.8], { T: BOT_D, bias: -0.1 });
  // Бак за спиной: латунь, кольца, вентиль.
  const tk = 1 + o.tank * 0.2;
  r.cap(T.p(-6.4, 0, 2.6), T.p(-7.1, 0, 10.8), 3.1 * tk, 2.9 * tk, TANK_M(cs * 0 - 0.05));
  r.cap(T.p(-7.2, 0, 11.6), T.p(-7.3, 0, 13.4), 0.6, 0.6, { T: RIM, spec: true });
  r.ell(T.at(-7.3, 0, 13.6), [0, 0, 0], [1.5, 1.5, 0.45], { T: GRIP, spec: true });
  // Цветок на макушке.
  if (o.bloom) {
    const st = T.p(-2.0, -3.7, BC + 6.6);
    const fl = T.p(-2.3, -3.9, BC + 9.6);
    r.line(st, fl, MOSS[1], 0, 0.3);
    r.dot(fl, PETAL, 0, 2, 0.8);
    r.dot(fl, POLLEN, 0, 1, 1.2);
  }
  // Голова: шов, линза в оправе, антенна с листиком.
  const Hd = T.at(HX, 0, HZ).turn(o.hturn).pitch(o.head);
  r.ell(Hd, [0, 0, 0], [3.8, 4.2, 3.1], HEAD_M);
  r.ball(Hd.p(2.7, 0, 0.1), 2.1, { T: RIM, spec: true });
  const e = o.eye;
  const LT: Tones = o.red > 0.5 ? ANGRY : CALM;
  r.ball(Hd.p(4.0, 0, 0.1), 1.55, {
    T: e > 0.3 ? (e > 1.2 ? [LT[2], LT[3], WHITE, WHITE] : LT) : OFF,
    glow: clamp01(e * 0.85),
    bias: e > 0.3 ? 0.2 + 0.3 * Math.min(e, 1.5) : -0.2,
    soft: e > 0.3,
  });
  r.eye = e > 0.3 ? Hd.p(4.6, 0, 0.1) : null;
  const a0 = Hd.p(-0.8, 0.8, 2.4);
  const a1 = vadd(Hd.p(-1.5, 1.3, 5.6), B.v(o.ant[0], o.ant[1], 0));
  r.cap(a0, a1, 0.32, 0.24, { T: RIM, spec: true });
  r.ell(F3.yaw(yaw, a1).scale(GS), [0, 0, 0.5], [1.1, 0.45, 0.75], { T: MOSS, bias: 0.1 });
  // Руки: длинные, до земли; правая — ножницы, левая — брандспойт.
  const W = handFrame(B, o);
  const sh = shearsOf(B, W, o);
  const [hL, n0, n1] = nozzleOf(B, W, o);
  const hR = W.p(o.hR[0], o.hR[1], o.hR[2]);
  for (const sd of [-1, 1]) {
    const near = sd === cs;
    const s0 = T.p(0.8, sd * 7.6, 11.0);
    const hand = sd > 0 ? hR : hL;
    arm(r, s0, hand, ARM1 * GS, ARM2 * GS, T.v(-1, sd * 0.7, 0), [1.1, 1.0, 1.45], limbM(near), {
      T: BOT,
      bias: near ? 0 : -0.15,
      spec: true,
    });
    r.ball(s0, 2.1, { T: BOT, bias: near ? 0.04 : -0.14, spec: true });
    r.ball(hand, 1.7, { T: BOT, bias: near ? 0.02 : -0.16, spec: true });
  }
  // Ножницы: лезвия и красные рукояти.
  const bl: Mat = { T: STEEL, spec: true };
  r.cap(sh.pv, sh.t1, 1.0, 0.3, bl);
  r.cap(sh.pv, sh.t2, 1.0, 0.3, bl);
  r.cap(sh.pv, sh.g1, 0.55, 0.6, { T: GRIP, spec: true });
  r.cap(sh.pv, sh.g2, 0.55, 0.6, { T: GRIP, spec: true });
  r.dot(sh.pv, BRASS[3], 0, 1, 1.4);
  // Брандспойт и шланг к баку (провис, волна давления).
  r.cap(n0, n1, 1.15, 0.9, { T: BRASS, spec: true });
  r.ball(n1, 0.95, { T: RIM });
  const t0 = T.p(-5.6, -3.0, 2.2);
  const mid = vlerp(t0, n0, 0.5);
  const c = vadd(mid, vadd(B.v(-0.5, -2.6, 0), [0, 0, -4.2]));
  const N = 7;
  let prev = t0;
  for (let i = 1; i <= N; i++) {
    const k = i / N;
    const q = vadd(vadd(vmul(t0, (1 - k) * (1 - k)), vmul(c, 2 * k * (1 - k))), vmul(n0, k * k));
    const pt: V3 = [q[0], q[1], Math.max(0.7, q[2])];
    const sw = o.swell * Math.max(0, Math.cos((k - o.wave) * 7));
    r.cap(prev, pt, 1.0 + sw * 0.55, 1.0 + sw * 0.55, {
      T: HOSE,
      bias: 0.05 * cs,
      spec: true,
    });
    prev = pt;
  }
  return r;
}

// ---- Треки -------------------------------------------------------------------

const k3 = (k: number, keys: [number, V3, ((x: number) => number)?][]): V3 => [
  trk(
    k,
    keys.map(([t, v, e]) => [t, v[0], e] as Key),
  ),
  trk(
    k,
    keys.map(([t, v, e]) => [t, v[1], e] as Key),
  ),
  trk(
    k,
    keys.map(([t, v, e]) => [t, v[2], e] as Key),
  ),
];

function idleO(f: number, calm: boolean): GnO {
  // Гудит: 8 кадров по 5 к/с — бочонок дышит, руки качаются следом, голова
  // поглядывает по сторонам.
  const a = (f / 8) * TAU;
  const o: GnO = { ...G0, red: calm ? 0 : 1 };
  o.lift = 0.3 * Math.sin(a);
  o.hR = [STANCE_R[0], STANCE_R[1], STANCE_R[2] + 0.4 * Math.sin(a - 0.9)];
  o.hL = [STANCE_L[0], STANCE_L[1], STANCE_L[2] + 0.4 * Math.sin(a - 0.9)];
  o.hturn = 0.22 * Math.sin(a);
  o.op = 0.12 + (f === 3 || f === 4 ? 0.3 : 0);
  o.ant = [-0.4 * Math.sin(a - 1.4), 0.3 * Math.cos(a)];
  return o;
}

function walkO(f: number, calm: boolean): GnO {
  // Вразвалку: бочонок качается с ноги на ногу, руки — маятником с запозданием.
  const a = (f / 8) * TAU;
  const o: GnO = { ...G0, ph: f / 8, step: calm ? 0.75 : 1, wide: 0.15, red: calm ? 0 : 1 };
  const A = calm ? 0.7 : 1;
  o.lift = -0.5 * A * Math.cos(2 * a) - 0.1;
  o.roll = 0.09 * A * Math.sin(a);
  o.twist = 0.12 * A * Math.cos(a);
  o.lean = calm ? 0.06 : 0.2;
  o.head = calm ? 0.12 : -0.04;
  o.hturn = calm ? 0.3 * Math.sin(a * 0.5) : 0;
  const sw = 2.4 * A;
  o.hR = [
    STANCE_R[0] + sw * Math.cos(a - 0.5),
    STANCE_R[1],
    STANCE_R[2] + 0.5 + 0.4 * Math.cos(2 * a - 1),
  ];
  o.hL = [
    STANCE_L[0] - sw * Math.cos(a - 0.5),
    STANCE_L[1],
    STANCE_L[2] + 0.5 + 0.4 * Math.cos(2 * a - 1),
  ];
  o.op = calm ? 0.1 : 0.3;
  o.ant = [-0.8 * A - 0.4 * Math.cos(2 * a), -0.6 * A * Math.sin(a)];
  return o;
}

const TRIM_R: V3 = [8.0, 3.2, 5.6];
const TRIM_B: V3 = [0.9, -0.15, -0.35];

function trimO(f: number): GnO {
  // Стрижёт куст перед собой: два щелчка, осмотр, полив; 24 кадра по кругу.
  const o: GnO = { ...G0, red: 0, crouch: 0.35, lean: 0.24, head: 0.32, wide: 0.5 };
  const t = f / FPS;
  o.op = trk(t, [
    [0, 1],
    [2 / FPS, 0, easeIn],
    [4.5 / FPS, 1],
    [6 / FPS, 0, easeIn],
    [9 / FPS, 0.9],
    [12 / FPS, 0.5],
    [20 / FPS, 0.5],
    [23.5 / FPS, 1],
  ]);
  const jig = f < 8 ? (f % 4 < 2 ? 0.3 : -0.3) : 0;
  o.hR = k3(t, [
    [0, [TRIM_R[0], TRIM_R[1], TRIM_R[2]]],
    [8 / FPS, [TRIM_R[0], TRIM_R[1] - 0.8, TRIM_R[2]]],
    [13 / FPS, [6.4, 1.2, 8.4]],
    [19 / FPS, [6.4, 1.2, 8.4]],
    [24 / FPS, TRIM_R],
  ]);
  o.hR = [o.hR[0] + jig, o.hR[1], o.hR[2]];
  o.bR = k3(t, [
    [0, TRIM_B],
    [8 / FPS, TRIM_B],
    [13 / FPS, [0.5, -0.4, 0.75]],
    [19 / FPS, [0.5, -0.4, 0.75]],
    [24 / FPS, TRIM_B],
  ]);
  // Осмотр: голова набок, к срезу.
  o.head = trk(t, [
    [0, 0.32],
    [9 / FPS, 0.36],
    [13 / FPS, 0.08],
    [19 / FPS, 0.08],
    [23 / FPS, 0.32],
  ]);
  o.hturn = trk(t, [
    [0, 0],
    [9 / FPS, 0],
    [13 / FPS, 0.32],
    [19 / FPS, 0.26],
    [23 / FPS, 0],
  ]);
  // Левой — поливает куст (носик к земле перед собой).
  o.hL = k3(t, [
    [0, STANCE_L],
    [12 / FPS, STANCE_L],
    [15 / FPS, [6.2, -4.6, 6.4]],
    [21 / FPS, [6.2, -4.6, 6.4]],
    [24 / FPS, STANCE_L],
  ]);
  o.nL = k3(t, [
    [0, STANCE_N],
    [12 / FPS, STANCE_N],
    [15 / FPS, [0.75, 0.3, -0.6]],
    [21 / FPS, [0.75, 0.3, -0.6]],
    [24 / FPS, STANCE_N],
  ]);
  o.lift = f === 2 || f === 6 ? -0.25 : 0;
  o.ant = [f === 2 || f === 6 ? 0.5 : 0, 0.3 * Math.sin((f / 24) * TAU)];
  return o;
}

const RAGE_T = 0.6;
function rageO(T: number): GnO {
  // Вздрогнул, линза вспыхнула и покраснела, пар; кулаки вверх, щёлк-щёлк, топ.
  const f = Math.floor(T * FPS);
  const o: GnO = { ...G0 };
  o.red = T < 0.09 ? 0 : 1;
  o.eye = f <= 1 ? 1.7 : f <= 3 ? 1.4 : 1.15;
  o.lift = trk(T, [
    [0, 0],
    [0.06, 1.6, easeOut],
    [0.16, 0.2],
    [0.3, 0.6],
    [0.36, -0.5, easeIn],
    [0.44, 0.4],
    [0.5, -0.5, easeIn],
    [0.6, -0.2],
  ]);
  o.head = trk(T, [
    [0, 0.05],
    [0.06, -0.28],
    [0.2, -0.12],
    [0.6, -0.04],
  ]);
  o.lean = trk(T, [
    [0, 0.06],
    [0.06, -0.16],
    [0.3, 0.02],
    [0.6, 0.2],
  ]);
  o.crouch = trk(T, [
    [0, 0.1],
    [0.06, 0],
    [0.4, 0.3],
    [0.6, 0.2],
  ]);
  const sh = f >= 6 && f <= 12 ? (f % 2 ? 1 : -1) : 0;
  o.hR = k3(T, [
    [0, STANCE_R],
    [0.06, [1.2, 11.0, 9.0], easeOut],
    [0.2, [2.6, 7.2, 16.4]],
    [0.5, [2.8, 7.0, 16.0]],
    [0.6, [4.0, 8.4, 6.0]],
  ]);
  o.hL = k3(T, [
    [0, STANCE_L],
    [0.06, [1.2, -11.0, 9.0], easeOut],
    [0.2, [2.6, -7.2, 16.4]],
    [0.5, [2.8, -7.0, 16.0]],
    [0.6, [4.0, -8.4, 6.2]],
  ]);
  o.hR = [o.hR[0], o.hR[1], o.hR[2] + sh * 1.4];
  o.hL = [o.hL[0], o.hL[1], o.hL[2] - sh * 1.4];
  o.bR = T < 0.5 ? [0.3, 0.2, 0.95] : STANCE_B;
  o.nL = T < 0.5 ? [0.3, -0.2, 0.95] : STANCE_N;
  o.op = f >= 6 && f <= 12 ? (Math.floor(f / 2) % 2 ? 1 : 0.1) : 0.5;
  o.steam = T > 0.08 ? 1 : 0;
  o.sp = f;
  o.ant = [
    trk(T, [
      [0, 0],
      [0.06, -1.4],
      [0.2, 0.8],
      [0.34, -0.4],
      [0.6, 0],
    ]),
    sh * 0.6,
  ];
  return o;
}

const SNIP_T = GARDENER.snip;
const WIND_R: V3 = [-1.0, 6.4, 20.4];
const WIND_B: V3 = [-0.55, 0.15, 0.8];
const HIT_R: V3 = [10.0, 1.6, 8.0];
const HIT_B: V3 = [0.98, -0.12, -0.05];
const FOL_R: V3 = [8.2, -3.6, 6.0];
const FOL_B: V3 = [0.7, -0.65, -0.25];

/** Ножницы: τ — время от начала `f11_snip` (дальше — `recover`). */
function snipO(tau: number): GnO {
  const o: GnO = { ...G0 };
  const S = SNIP_T;
  const f = Math.floor(tau * FPS);
  o.twist = trk(tau, [
    [0, 0],
    [0.22, 0.55, easeOut],
    [S - 0.18, 0.6],
    [S, -0.3, easeIn],
    [S + 0.12, -0.55, easeOut],
    [S + 0.34, -0.45],
    [S + 0.7, 0],
  ]);
  o.lean = trk(tau, [
    [0, 0.06],
    [0.22, -0.18],
    [S - 0.18, -0.2],
    [S, 0.16, easeIn],
    [S + 0.12, 0.22],
    [S + 0.7, 0.06],
  ]);
  o.fwd = trk(tau, [
    [0, 0],
    [0.22, -1.0],
    [S - 0.18, -1.1],
    [S, 1.8, easeIn],
    [S + 0.12, 2.2],
    [S + 0.36, 1.6],
    [S + 0.7, 0],
  ]);
  o.crouch = trk(tau, [
    [0, 0.1],
    [0.22, 0.4],
    [S, 0.55],
    [S + 0.12, 0.6],
    [S + 0.7, 0.1],
  ]);
  o.wide = trk(tau, [
    [0, 0.3],
    [0.22, 0.8],
    [S, 1.1, easeIn],
    [S + 0.4, 1.0],
    [S + 0.7, 0.3],
  ]);
  o.head = trk(tau, [
    [0, 0.05],
    [0.22, -0.12],
    [S, 0.16],
    [S + 0.7, 0.05],
  ]);
  o.hR = k3(tau, [
    [0, STANCE_R],
    [0.22, WIND_R, easeOut],
    [S - 0.18, WIND_R],
    [S, HIT_R, easeIn],
    [S + 0.12, FOL_R, easeOut],
    [S + 0.36, FOL_R],
    [S + 0.7, STANCE_R],
  ]);
  o.bR = k3(tau, [
    [0, STANCE_B],
    [0.22, WIND_B, easeOut],
    [S - 0.18, WIND_B],
    [S, HIT_B, easeIn],
    [S + 0.12, FOL_B, easeOut],
    [S + 0.36, FOL_B],
    [S + 0.7, STANCE_B],
  ]);
  o.hL = k3(tau, [
    [0, STANCE_L],
    [0.22, [6.4, -6.6, 9.4]],
    [S - 0.18, [6.4, -6.6, 9.4]],
    [S, [-0.6, -9.0, 8.0], easeIn],
    [S + 0.7, STANCE_L],
  ]);
  // Раскрыл; дразнящий щелчок на задержке; сомкнул — ровно в миг урона.
  o.op = trk(tau, [
    [0, 0.12],
    [0.18, 1, easeOut],
    [0.36, 1],
    [0.4, 0.55],
    [0.46, 1],
    [S - 0.03, 1],
    [S, 0, easeIn],
    [S + 0.4, 0],
    [S + 0.7, 0.12],
  ]);
  o.eye = tau > 0.16 && tau < S + 0.16 ? 1.45 : 1;
  if (tau > 0.24 && tau < S - 0.18) {
    // Задержка на пике замаха: дрожь сервоприводов.
    const s = f % 2 ? 1 : -1;
    o.hR = [o.hR[0] + 0.25 * s, o.hR[1], o.hR[2] + 0.2 * s];
    o.roll = 0.02 * s;
  }
  o.ant = [
    trk(tau, [
      [0, 0],
      [0.26, 1.0],
      [S - 0.1, 0.6],
      [S + 0.1, -1.8],
      [S + 0.3, 0.6],
      [S + 0.6, 0],
    ]),
    0,
  ];
  return o;
}

const HOSE_T = GARDENER.hose;
const AIM_L: V3 = [9.4, -0.8, 12.0];
const AIM_N: V3 = [1, 0.04, -0.04];

/** Брандспойт: τ — время от начала `f11_hose` (дальше — `recover`). */
function hoseO(tau: number): GnO {
  const o: GnO = { ...G0 };
  const H = HOSE_T;
  const f = Math.floor(tau * FPS);
  o.twist = trk(tau, [
    [0, 0],
    [0.25, -0.3, easeOut],
    [H, -0.34],
    [H + 0.06, -0.2, easeOut],
    [H + 0.8, 0],
  ]);
  o.crouch = trk(tau, [
    [0, 0.1],
    [0.25, 0.45, easeOut],
    [0.75, 0.62],
    [H, 0.62],
    [H + 0.05, 0.75, easeOut],
    [H + 0.45, 0.6],
    [H + 0.8, 0.1],
  ]);
  o.wide = trk(tau, [
    [0, 0.3],
    [0.25, 1.1],
    [H + 0.5, 1.1],
    [H + 0.8, 0.3],
  ]);
  o.lean = trk(tau, [
    [0, 0.06],
    [0.25, 0.14],
    [H, 0.16],
    [H + 0.05, -0.12, easeOut],
    [H + 0.45, -0.04],
    [H + 0.8, 0.06],
  ]);
  o.fwd = trk(tau, [
    [0, 0],
    [0.25, 0.4],
    [H, 0.5],
    [H + 0.06, -1.6, easeOut],
    [H + 0.45, -1.2],
    [H + 0.8, 0],
  ]);
  o.hL = k3(tau, [
    [0, STANCE_L],
    [0.25, AIM_L, easeOut],
    [H, AIM_L],
    [H + 0.06, [8.0, -0.8, 14.0], easeOut],
    [H + 0.45, [8.6, -0.8, 13.0]],
    [H + 0.8, STANCE_L],
  ]);
  o.nL = k3(tau, [
    [0, STANCE_N],
    [0.25, AIM_N, easeOut],
    [H, AIM_N],
    [H + 0.06, [0.95, 0.02, 0.3], easeOut],
    [H + 0.45, [1, 0.02, 0.1]],
    [H + 0.8, STANCE_N],
  ]);
  // Правой перехватил шланг у носика; ножницы — остриём вниз.
  o.hR = k3(tau, [
    [0, STANCE_R],
    [0.3, [7.2, 1.4, 10.0], easeOut],
    [H + 0.06, [6.0, 1.4, 11.4], easeOut],
    [H + 0.45, [6.6, 1.4, 10.8]],
    [H + 0.8, STANCE_R],
  ]);
  o.bR = k3(tau, [
    [0, STANCE_B],
    [0.3, [-0.7, 0.35, -0.6]],
    [H + 0.45, [-0.7, 0.35, -0.6]],
    [H + 0.8, STANCE_B],
  ]);
  o.op = 0;
  o.tank = trk(tau, [
    [0.25, 0],
    [0.75, 1],
    [H, 1],
    [H + 0.45, 0, easeOut],
  ]);
  // Волна давления: от бака к носику, всё чаще.
  o.swell = trk(tau, [
    [0.25, 0],
    [0.4, 1],
    [H, 1],
    [H + 0.3, 0],
  ]);
  o.wave = tau < H ? ((((tau - 0.25) * (2 + tau * 3)) % 1) + 1) % 1 : 1;
  // Качает: таз подрагивает в такт насосу; замок — мелкая дрожь.
  if (tau > 0.3 && tau < 0.75) o.lift = 0.3 * Math.sin((tau - 0.3) * TAU * 6);
  if (tau >= 0.75 && tau < H) {
    const s = f % 2 ? 1 : -1;
    o.hL = [o.hL[0] + 0.2 * s, o.hL[1], o.hL[2] + 0.15 * s];
    o.roll = 0.015 * s;
  }
  if (tau >= H && tau < H + 0.45) {
    // Струя бьёт: отдача мелко трясёт руки.
    const s = f % 2 ? 1 : -1;
    o.hL = [o.hL[0] - 0.3 * s, o.hL[1], o.hL[2] + 0.3 * s];
  }
  o.eye = tau > 0.2 && tau < H + 0.3 ? 1.4 : 1;
  o.ant = [
    trk(tau, [
      [0, 0],
      [0.25, 0.6],
      [H, 0.6],
      [H + 0.08, -1.6],
      [H + 0.3, 0.5],
      [H + 0.6, 0],
    ]),
    0,
  ];
  return o;
}

function flinchO(f: number): GnO {
  // Удар: корпус дёрнуло назад, голова мотнулась, руки вразлёт, возврат.
  const k = [1, 0.85, 0.55, 0.25, 0][Math.min(4, f)];
  const o: GnO = { ...G0 };
  o.lean = 0.06 - 0.3 * k;
  o.twist = 0.3 * k;
  o.head = -0.3 * k;
  o.hturn = 0.3 * k;
  o.fwd = -0.8 * k;
  o.crouch = 0.1 + 0.25 * k;
  o.eye = f < 2 ? 1.7 : 1;
  o.hR = [STANCE_R[0] - 1.6 * k, STANCE_R[1] + 1.6 * k, STANCE_R[2] + 3.2 * k];
  o.hL = [STANCE_L[0] - 1.6 * k, STANCE_L[1] - 1.6 * k, STANCE_L[2] + 3.0 * k];
  o.op = 0.12 + 0.6 * k;
  o.ant = [-1.6 * k, 0.6 * k];
  return o;
}

const DIE_T = 0.9;
function dieO(T: number): GnO {
  // Искрит, линза мигает, ноги подкосились, валится на спину; цветок слетает.
  const o: GnO = { ...G0 };
  const f = Math.floor(T * FPS);
  o.eye = [1.7, 0, 1.3, 0, 0, 0.8, 0, 0, 0.5][Math.min(8, f)] ?? 0;
  o.fwd = trk(T, [
    [0, 0],
    [0.1, -0.9, easeOut],
    [0.3, -0.4],
    [0.45, -1.0],
  ]);
  o.twist = trk(T, [
    [0, 0],
    [0.12, 0.4],
    [0.3, -0.25],
    [0.45, 0.1],
  ]);
  o.lean = trk(T, [
    [0, 0.06],
    [0.1, -0.24],
    [0.3, 0.2],
    [0.45, 0.1],
  ]);
  o.crouch = trk(T, [
    [0.1, 0.1],
    [0.42, 1, easeIn],
  ]);
  o.tip = trk(T, [
    [0.42, 0],
    [0.68, 1, easeIn],
  ]);
  o.head = trk(T, [
    [0, 0.05],
    [0.12, -0.35],
    [0.4, 0.5],
    [0.68, 0.2],
  ]);
  o.hR = k3(T, [
    [0, STANCE_R],
    [0.1, [1.2, 10.4, 12.0], easeOut],
    [0.42, [4.0, 9.0, 4.0]],
    [0.68, [-1.0, 9.6, 2.0]],
  ]);
  o.hL = k3(T, [
    [0, STANCE_L],
    [0.1, [1.2, -10.4, 12.0], easeOut],
    [0.42, [4.0, -9.0, 4.0]],
    [0.68, [-1.0, -9.6, 2.0]],
  ]);
  o.bR = T < 0.42 ? STANCE_B : [-0.6, 0.6, -0.5];
  o.nL = T < 0.42 ? STANCE_N : [-0.4, -0.7, -0.6];
  o.op = T < 0.1 ? 0.12 : 0.9;
  o.bloom = T < 0.6;
  o.steam = T > 0.66 ? 1 : 0;
  o.sp = f;
  o.ant = [
    trk(T, [
      [0, 0],
      [0.1, -1.4],
      [0.4, 1.0],
      [0.68, -1.2],
      [0.8, 0.4],
    ]),
    0,
  ];
  return o;
}

function gardenerPose(anim: string, f: number): GnO {
  const t = (f + 0.5) / FPS;
  switch (anim) {
    case 'idle':
      return idleO(f, false);
    case 'walk':
      return walkO(f, false);
    case 'amble':
      return walkO(f, true);
    case 'trim':
      return trimO(f);
    case 'rage':
      return rageO(t);
    case 'snip':
      return snipO(Math.min(t, SNIP_T - 0.005));
    case 'snipf':
      return snipO(SNIP_T + t - 0.5 / FPS + 0.004);
    case 'hose':
      return hoseO(Math.min(t, HOSE_T - 0.005));
    case 'hosef':
      return hoseO(HOSE_T + t - 0.5 / FPS + 0.004);
    case 'flinch':
      return flinchO(f);
    case 'die':
      return dieO(t);
  }
  return { ...G0 };
}

// ---- Кадр --------------------------------------------------------------------

const GN = kindOf('gardener', 76, 62, 38, 46, 1800);

/** След ножниц по треку удара: острие и середина лезвия за прошлые кадры. */
function trail(anim: string, f: number, d: number, n: number): { tips: V3[]; bases: V3[] } {
  const B = frameB(yawN(d));
  const tips: V3[] = [];
  const bases: V3[] = [];
  const tau0 = anim === 'snipf' ? SNIP_T + f / FPS + 0.004 : (f + 0.5) / FPS;
  for (let i = n; i >= 0; i--) {
    const tau = tau0 - i / FPS;
    if (tau < 0) continue;
    const o = snipO(tau);
    const s = shearsOf(B, handFrame(B, o), o);
    tips.push(vlerp(s.t1, s.t2, 0.5));
    bases.push(vlerp(s.pv, vlerp(s.t1, s.t2, 0.5), 0.3));
  }
  return { tips, bases };
}

/** Пар клубами: от точки вверх, по фазе. */
function puffs(o: RigOut, x: number, y: number, ph: number, amt: number, c: RGBA, n = 3): void {
  for (let i = 0; i < n; i++) {
    const k = (((ph * 0.11 + i / n) % 1) + 1) % 1;
    const px = x + Math.sin(i * 2.1 + ph * 0.6) * 2.2 * k;
    const py = y - k * 8;
    const rr = 0.7 + k * 1.4;
    const a = amt * 0.75 * (1 - k * 0.75);
    for (let yy = -2; yy <= 2; yy++)
      for (let xx = -2; xx <= 2; xx++)
        if (xx * xx + yy * yy <= rr * rr)
          o.p.set(Math.round(px + xx), Math.round(py + yy), alpha(c, a));
  }
}

/** Капли: падают из точки вниз по фазе. */
function drips(o: RigOut, x: number, y: number, ph: number, n: number, fall: number): void {
  for (let i = 0; i < n; i++) {
    const k = (((ph * 0.13 + i / n) % 1) + 1) % 1;
    const px = Math.round(x + (hash(i, 3, 91) - 0.5) * 1.6);
    const py = Math.round(y + k * fall);
    o.p.set(px, py, WATER[i % 2 ? 1 : 0]);
  }
}

const gardenerPic = (anim: string, f: number, d: number): Pic => {
  const g = gardenerPose(anim, f);
  const yaw = yawN(d);
  return draw(GN, gardenerRig(g, yaw), (o, P2) => {
    const B = frameB(yaw);
    const { T } = bodyFrames(B, g, yaw);
    const W = handFrame(B, g);
    const behind = Math.sin(yaw) < -0.35;
    const free = (x: number, y: number) => {
      const X = Math.round(x);
      const Y = Math.round(y);
      return !(X >= 0 && Y >= 0 && X < o.p.w && Y < o.p.h && o.p.data[(Y * o.p.w + X) * 4 + 3]);
    };
    // След ножниц: выпад и проводка.
    const sw = (anim === 'snip' && f >= 15) || (anim === 'snipf' && f <= 3) ? 3 : 0;
    if (sw) {
      const { tips, bases } = trail(anim, f, d, sw);
      smear(o, tips.map(P2), bases.map(P2), SMEAR_C, 0);
    }
    const sh = shearsOf(B, W, g);
    if (anim === 'snipf' && f <= 2) {
      // Контакт: ножницы сомкнулись — блик-звезда и обрезки.
      const q = P2(vlerp(sh.pv, vlerp(sh.t1, sh.t2, 0.5), 0.75));
      const R = [3, 2, 1][f];
      for (let i = -R; i <= R; i++) {
        spark2(o, q[0] + i, q[1], i === 0 ? WHITE : alpha(WHITE, 0.8), 1);
        spark2(o, q[0], q[1] + i, i === 0 ? WHITE : alpha(WHITE, 0.8), 1);
      }
      spray(o.p, q[0], q[1], 8, 7, (f + 1) / 3, 61, LEAVES, 3, 2);
    }
    if (anim === 'trim' && (f === 2 || f === 3 || f === 6 || f === 7)) {
      const q = P2(vlerp(sh.t1, sh.t2, 0.5));
      spray(o.p, q[0], q[1], 5, 4, f % 4 === 2 ? 0.5 : 1, 63 + f, LEAVES, 4, 1);
    }
    if (anim === 'trim' && f >= 15 && f <= 21) {
      const [, , n1] = nozzleOf(B, W, g);
      const q = P2(n1);
      drips(o, q[0], q[1] + 1, f, 3, 6);
    }
    if (g.steam > 0) {
      // Пар из головы (злость) и дым (смерть).
      const Hd = T.at(HX, 0, HZ).turn(g.hturn).pitch(g.head);
      const c = anim === 'die' ? SMOKE : STEAM;
      for (const sd of [-1, 1]) {
        const q = P2(Hd.p(-0.4, sd * 3.2, 2.0));
        puffs(o, q[0], q[1], g.sp + (sd > 0 ? 3 : 0), anim === 'die' ? 0.8 : 1, c, 2);
      }
    }
    if (anim === 'hose') {
      const [, , n1] = nozzleOf(B, W, g);
      const q = P2(n1);
      if (f >= 8 && f < 18 && !(behind && !free(q[0], q[1]))) drips(o, q[0], q[1] + 1, f, 2, 5);
      if (f >= 8 && f < 18 && f % 4 === 1) {
        // Носик плюётся: давление растёт.
        spray(o.p, q[0], q[1], 4, 3, 0.8, 81 + f, WATER, 1, 1);
      }
      if (f >= 17) {
        // Замок: на срезе носика вздувается водяной шар, брызги сходятся к нему.
        const k = (f - 17) / 6;
        const R = 1 + k * 1.6;
        for (let yy = -3; yy <= 3; yy++)
          for (let xx = -3; xx <= 3; xx++) {
            const dd = xx * xx + yy * yy;
            if (dd > R * R + 0.3) continue;
            const x = q[0] + xx;
            const y = q[1] + yy;
            if (behind && !free(x, y)) continue;
            spark2(o, Math.round(x), Math.round(y), dd <= 1 ? WHITE : alpha(WATER[1], 0.85), 0.8);
          }
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU + f * 0.8;
          const rr = 5 * (1 - k) + R + 1;
          const x = q[0] + Math.cos(a) * rr;
          const y = q[1] + Math.sin(a) * rr * 0.7;
          if (behind && !free(x, y)) continue;
          spark2(o, Math.round(x), Math.round(y), alpha(WATER[i % 2], 0.9), 0.6);
        }
      }
      if (f >= 12 && f % 4 < 2) {
        // Бак шипит на вентиле.
        const v = P2(T.p(-7.3, 0, 14.2));
        puffs(o, v[0], v[1], f, 0.7, STEAM, 1);
      }
    }
    if (anim === 'hosef' && f <= 10) {
      // Струя рвётся из носика: брызги веером, первые кадры — белые.
      const [, n0, n1] = nozzleOf(B, W, g);
      const a = P2(n0);
      const q = P2(n1);
      const ux = q[0] - a[0];
      const uy = q[1] - a[1];
      const l = Math.hypot(ux, uy) || 1;
      const fx = ux / l;
      const fy = uy / l;
      const L = f <= 1 ? 13 : 10;
      for (let j = 0; j <= L; j++) {
        const x = q[0] + fx * j;
        const y = q[1] + fy * j;
        if (behind && !free(x, y)) continue;
        const c = j < 3 || f <= 1 ? WHITE : WATER[j % 3 === 0 ? 1 : 0];
        spark2(o, Math.round(x), Math.round(y), alpha(c, 1 - j / (L + 4)), 0.7);
        if (j > 2 && j % 2 === 0)
          spark2(o, Math.round(x - fy), Math.round(y + fx), alpha(WATER[1], 0.7), 0.3);
      }
      spray(o.p, q[0] + fx * 4, q[1] + fy * 4, 9, 7, ((f % 3) + 1) / 3, 71 + f, WATER, 2, 2);
      if (f <= 1) {
        const R = 2 - f;
        for (let yy = -R; yy <= R; yy++)
          for (let xx = -R; xx <= R; xx++)
            if (xx * xx + yy * yy <= R * R + 0.5) spark2(o, q[0] + xx, q[1] + yy, WHITE, 1);
      }
    }
    if (anim === 'hosef' && f > 10 && f <= 18) {
      const [, , n1] = nozzleOf(B, W, g);
      const q = P2(n1);
      drips(o, q[0], q[1] + 1, f, 2, 6);
    }
    if (anim === 'flinch' && f <= 2) {
      const q = P2(T.p(0, 0, BC + 2));
      spray(o.p, q[0], q[1], 5, 5, (f + 1) / 3, 43, SPARK, 2, 2);
    }
    if (anim === 'die' && f <= 9) {
      // Искры из плеч и шеи.
      for (const [qf, qs, qz] of [
        [0.8, 7.6, 11],
        [0.8, -7.6, 11],
        [2.8, 0, 13.6],
      ] as V3[]) {
        const q = P2(T.p(qf, qs, qz));
        spray(o.p, q[0], q[1], 4, 5, ((f % 3) + 1) / 3, 53 + f, SPARK, 2, 2);
      }
    }
    if (anim === 'die' && f >= 14) {
      // Цветок слетел; из бака хлещет вода, лужица растёт.
      const top = P2(T.p(-2.3, -3.9, BC + 9.6));
      const k = (f - 13) / 8;
      const px = top[0] - 3 - k * 6;
      const py = top[1] - 6 * Math.sin(PI * Math.min(1, k * 1.4)) + k * k * 10;
      o.p.set(Math.round(px), Math.round(py), PETAL);
      o.p.set(Math.round(px) + 1, Math.round(py), PETAL);
      o.p.set(Math.round(px), Math.round(py) - 1, POLLEN);
      const tq = P2(T.p(-7.0, 0, 6.0));
      const gq = P2(B.p(-7.0, 0, 0));
      for (let i = 0; i < 7; i++) {
        const kk = (((f * 0.21 + i / 7) % 1) + 1) % 1;
        o.p.set(
          Math.round(lerp(tq[0], gq[0] - 4, kk) + (i % 3) - 1),
          Math.round(lerp(tq[1], gq[1], kk * kk)),
          alpha(WATER[i % 3], 0.85),
        );
      }
      const pr = Math.min(7, 2 + (f - 14) * 0.9);
      for (let xx = -Math.ceil(pr); xx <= pr; xx++)
        for (let yy = -1; yy <= 1; yy++)
          if ((xx * xx) / (pr * pr) + (yy * yy) / 2.2 <= 1) {
            const X = Math.round(gq[0] - 3 + xx);
            const Y = Math.round(gq[1] + yy);
            if (free(X, Y)) o.p.set(X, Y, alpha(WATER[2], 0.55));
          }
    }
    if (anim === 'die' && f >= 16 && f <= 19) {
      const q = P2(B.p(-4, 0, 0));
      spray(o.p, q[0], q[1], 8, 9, (f - 15) / 4, 59, [hx('#6a5a50'), hx('#8a7a70')], 0, 3);
    }
  });
};

const HEAD = new WeakMap<Mob, number>();

registerMobPainter('f11_gardener', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = pose.t;
  const now = pose.now || 0;
  const id = m.id ?? 0;
  const face = m.face ?? 0;
  const mv = moving(m, 0.3);
  // Курс: на ходу — по скорости; стоя на грядке — куда шёл; в техниках —
  // туда, куда повернул мозг.
  let want = face;
  if (md === 'f11_tend' || md === 'chase' || md === 'recover') {
    if (mv) HEAD.set(m, Math.atan2(m.vy ?? 0, m.vx ?? 0));
    want = md === 'f11_tend' ? (HEAD.get(m) ?? face) : headOf(m, 0.3);
  }
  const turn = md === 'chase' ? 6 : md === 'f11_tend' ? 4 : md === 'dying' ? 0 : 12;
  const v = visOf(m, pose, want, turn);
  const d = dirN(v.yaw);
  const ex: Partial<MobFrame> = { shadow: 8 };
  let anim = 'idle';
  let f = 0;
  if (md === 'dying') {
    f = fi(t, 21);
    anim = 'die';
    ex.linger = DIE_T;
    ex.alpha = 1 - sstep(0.76, DIE_T, t);
    ex.still = true;
    const th = clamp01((t - 0.66) / 0.1);
    if (th > 0 && th < 1) {
      ex.sx = 1 + 0.08 * Math.sin(PI * th);
      ex.sy = 1 - 0.1 * Math.sin(PI * th);
    }
  } else if (md === 'f11_rage') {
    f = fi(t, Math.round(RAGE_T * FPS) - 1);
    anim = 'rage';
    ex.still = true;
    if (f === 9 || f === 12) {
      ex.sx = 1.05;
      ex.sy = 0.95;
    }
  } else if (md === 'f11_snip') {
    f = fi(t, Math.round(SNIP_T * FPS) - 1);
    anim = 'snip';
    ex.still = true;
  } else if (md === 'f11_hose') {
    f = fi(t, Math.round(HOSE_T * FPS) - 1);
    anim = 'hose';
    ex.still = true;
  } else if (md === 'recover' && (v.prev === 'f11_snip' || v.prev === 'f11_hose')) {
    f = fi(t, 19);
    anim = v.prev === 'f11_snip' ? 'snipf' : 'hosef';
    ex.still = true;
    if (f <= 1) {
      ex.sx = 1.06;
      ex.sy = 0.94;
    }
  } else if (md === 'stun' || hurtAge(v, now) < 0.2) {
    const a = md === 'stun' && hurtAge(v, now) > 0.2 ? t : hurtAge(v, now);
    f = fi(a, 4);
    anim = 'flinch';
  } else if (md === 'f11_tend') {
    if (mv && !m.data?.trim) {
      f = Math.floor((v.dist / 0.8) * 8) % 8;
      anim = 'amble';
    } else {
      f = Math.floor((now + hash(id, 7) * 4) * FPS) % 24;
      anim = 'trim';
    }
  } else if (mv) {
    f = Math.floor((v.dist / 1.0) * 8) % 8;
    anim = 'walk';
  } else {
    f = Math.floor((now + hash(id, 7) * 4) * 5) % 8;
    anim = 'idle';
  }
  if (md !== 'dying') hurtFx(v, now, 1.0, ex);
  return put(
    frameOf(GN, anim, f, d, pose, (dd) => gardenerPic(anim, f, dd)),
    ex,
  );
});

registerMobWarm('f11_gardener', function* () {
  yield* warmAll(
    GN,
    [
      ['trim', 24],
      ['amble', 8],
      ['rage', 15],
      ['walk', 8],
      ['idle', 8],
      ['snip', 20],
      ['snipf', 20],
      ['hose', 24],
      ['hosef', 20],
      ['flinch', 5],
      ['die', 22],
    ],
    gardenerPic,
  );
});

// ---- Струя (зона мозга `f11_jetfx`, поверх) и мокрый след на полу (`f11_jet`) ----

const TS = 16;
/** Струя: из носика (высота руки) вдоль `ang`, рвётся и опадает каплями. */
registerZonePainter('f11_jetfx', (g, z, px, py, _s, time) => {
  const zz = z as Zone & { ang?: number };
  const life = zz.life || 0.45;
  const k = Math.min(1, z.t / life);
  const ang = zz.ang ?? 0;
  const L = z.r * TS;
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  const ox = px + ux * 7;
  const oy = py - 9 + uy * 5;
  // Струя дотягивается за 0,06 с, к концу рвётся с хвоста.
  const head = Math.min(1, z.t / 0.06);
  const tail = sstep(0.45, 1, k);
  const wob = Math.floor(time * 30);
  for (let i = 0; i <= 40; i++) {
    const q = i / 40;
    if (q > head || q < tail) continue;
    const x = ox + ux * L * q;
    const y = oy + uy * L * q + q * q * 6;
    const w = 1.2 + q * 2.2 + (hash(i, wob, 31) - 0.5) * 1.2;
    g.fillStyle = `rgba(110,190,255,${(0.55 * (1 - k * k)).toFixed(3)})`;
    g.fillRect(Math.round(x - uy * w), Math.round(y + ux * w * 0.6 - w * 0.5), 2, Math.ceil(w));
    g.fillStyle = `rgba(240,252,255,${(0.95 * (1 - k * k)).toFixed(3)})`;
    g.fillRect(Math.round(x), Math.round(y), 1, Math.max(1, Math.ceil(w * 0.45)));
  }
  // Капли срываются со струи.
  g.fillStyle = `rgba(200,236,255,${(0.9 * (1 - k)).toFixed(3)})`;
  for (let i = 0; i < 10; i++) {
    const q = clamp(tail + (head - tail) * hash(i, 5, 37), 0, 1);
    const fall = (k * 10 + hash(i, 6, 37) * 4) * k;
    g.fillRect(
      Math.round(ox + ux * L * q + (hash(i, 7, 37) - 0.5) * 4),
      Math.round(oy + uy * L * q + q * q * 6 + fall),
      1,
      1,
    );
  }
  return true;
});

const JET_LIFE = 0.9;
registerImpactPainter('f11_jet', {
  life: JET_LIFE,
  shake: 0.05,
  paint(g, rec, px, py, scale, age) {
    const s = scale / 16;
    const k = age / JET_LIFE;
    const ang = rec.ang ?? 0;
    const L = (rec.r ?? 4) * scale;
    const ux = Math.cos(ang);
    const uy = Math.sin(ang);
    const dot = (x: number, y: number, w = 1) =>
      g.fillRect(Math.round(x), Math.round(y), Math.ceil(w * s), Math.ceil(s));
    // Мокрая полоса темнеет на полу и сохнет.
    g.fillStyle = `rgba(60,110,170,${(0.32 * (1 - k)).toFixed(3)})`;
    const n = Math.max(2, Math.floor(L / (2 * s)));
    for (let i = 2; i <= n; i++) {
      const q = i / n;
      const w = 1 + Math.round(q * 2);
      dot(px + ux * L * q - uy * s, py + uy * L * q, w);
    }
    // Брызги на конце струи: веером, падают.
    const e = easeOut(Math.min(1, k * 2.2));
    for (let i = 0; i < 12; i++) {
      const th = ang + (hash(rec.seed, i, 5) - 0.5) * 2.4;
      const rr = (2 + 9 * hash(rec.seed, i, 7)) * e * s;
      const x = px + ux * L + Math.cos(th) * rr;
      const y = py + uy * L - 6 * s * Math.sin(PI * Math.min(1, k * 1.8)) + Math.sin(th) * rr * 0.6;
      const c = mixc(WATER[i % 3], WATER[2], k);
      g.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${(1 - k).toFixed(3)})`;
      dot(x, y);
    }
    // Кольцо всплеска.
    if (k < 0.5) {
      const R = (3 + 10 * easeOut(k * 2)) * s;
      g.fillStyle = `rgba(220,244,255,${(0.8 * (1 - k * 2)).toFixed(3)})`;
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * TAU;
        dot(px + ux * L + Math.cos(a) * R, py + uy * L + Math.sin(a) * R * 0.5);
      }
    }
    return true;
  },
});
