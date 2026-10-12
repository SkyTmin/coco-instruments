// Робот-страж (анимации мобов 11): широкий клёпаный робот в ржавых латах,
// шлем со щелью забрала и красной линзой, наплечники, на груди — створки-щит
// с огневым портом посередине, за ними ядро; в правой — клинок. Мини-3D
// (`f15-rig.ts`), 8 сторон честно (клинок в правой руке), 24 к/с от `pose.t`.
//
// Щит спереди — механика: страж всегда смотрит на героя (`m.face`) и пятится,
// не поворачиваясь (шаг назад — тот же цикл ходьбы задом наперёд), обходит
// боком приставным шагом. Удар в щит — искры по створкам, корпус почти не
// шелохнётся; в бок и в спину — вздрог.
//
// Метроном — `f11-brains.ts` (`f11_guard`, `GUARD`):
// - `f11_dormant` — статуя на одном колене, клинок воткнут в пол, мох на
//   плечах; `f11_rise` 0,8 с из статуи: линза мигает и загорается, голова
//   поднимается, мох осыпается, выдёргивает клинок, встаёт, топ;
// - `f11_post` — караул «смирно», клинок остриём в пол, голова ходит за
//   `m.face` (7 положений); `f11_rise` из караула — вскидывает клинок;
// - лазер `f11_aim` 1,13 с: упирается широкой стойкой, приседает, руки
//   разводит (открыл линию огня), порт на груди набирает свет; замок (0,38 с)
//   — искры сходятся к порту, дрожь, пар из суставов; кадр контакта — первый
//   кадр `f11_vent`: вспышка из порта, отдача назад;
// - `f11_vent` 1,3 с (окно, урон ×1,6): створки распахиваются, ядро светит,
//   пар из труб на спине, голова поникла, линза гаснет; к концу — закрылся;
// - `f11_bash` 0,6 с: замах клинком за плечо (корпус скручен), задержка,
//   удар наискось справа налево; кадр контакта — первый кадр `recover`
//   (клинок посередине конуса, выпад), проводка, отдача, возврат;
// - смерть 0,9 с: искрит, линза мигает, падает на колени, ничком, дым.

import { registerImpactPainter, registerMobPainter, registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import { GUARD } from './f11-brains';
import {
  F3,
  FPS,
  KRig,
  PI,
  TAU,
  WHITE,
  alpha,
  angD,
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
  hurtAge,
  hurtFx,
  hx,
  kindOf,
  leg,
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
import type { Mat } from './f15-rig';

const STEEL = tn('#3a4250', '#5c6676', '#848fa0', '#b4bec9');
const LIMB = tn('#1e2229', '#30353f', '#474e5a', '#666e7c');
const PLATE = tn('#4a5262', '#728096', '#9eabbd', '#dae2ec');
const DARKM = tn('#1c2028', '#2a2f38', '#3c4250', '#565e6c');
const RUST = tn('#5a2c18', '#8a4424', '#b0643a', '#cc8656');
const MOSS = tn('#26492a', '#36633a', '#4f8446', '#76ad58');
const BLADE = tn('#5c6470', '#9aa4b0', '#cfd6de', '#ffffff');
const CORE = tn('#a03810', '#ff7a20', '#ffb040', '#fff0b0');
const LENS = tn('#5a1008', '#b02414', '#ff5a3a', '#ffc0a0');
const LENS_OFF = tn('#1e2228', '#2c3038', '#3a4048', '#4c5260');
const PORT_C = hx('#ff5a3a');
const STEAM = hx('#eef4f8');
const SMOKE: RGBA[] = [hx('#3a3a40'), hx('#4c4c54'), hx('#2c2c32')];
const SPARK: RGBA[] = [hx('#fff6c0'), hx('#ffd060'), hx('#ffffff')];
const MOSS_BITS: RGBA[] = [MOSS[2], MOSS[3], MOSS[1]];
const SMEAR_C = hx('#e8eef6', 210);

const band = (T: Tones, l: number): RGBA =>
  l > 0.78 ? T[3] : l > 0.38 ? T[2] : l > -0.02 ? T[1] : T[0];

// ---- Поза --------------------------------------------------------------------

interface GdO {
  /** Сдвиг корпуса вперёд и вбок (отдача, выпад), высота таза (+ вверх). */
  fwd: number;
  side: number;
  lift: number;
  /** Присел 0…1, наклон корпуса вперёд, скрутка (+ — правое плечо назад), крен. */
  crouch: number;
  lean: number;
  twist: number;
  roll: number;
  head: number;
  hturn: number;
  /** Шаг вперёд (фаза, доля) и приставной вбок (фаза, доля); стойка шире. */
  ph: number;
  step: number;
  sph: number;
  sstep: number;
  wide: number;
  /** Кисти: правая (с клинком) и левая — в рамке стоп (f, s, высота); клинок — направление. */
  hR: V3;
  bR: V3;
  hL: V3;
  /** Створки 0…1, ядро 0…1, заряд порта 0…1, линза 0 — погасла, 1 — горит, >1 — вспышка. */
  plate: number;
  core: number;
  port: number;
  eye: number;
  /** Пар 0…1 и его фаза (номер кадра). */
  steam: number;
  sp: number;
  /** Статуя на колене 0…1, на коленях 0…1, ничком 0…1, мох 0…1. */
  statue: number;
  kneel: number;
  prone: number;
  moss: number;
}

/** Масштаб рига: страж крупнее и шире прочих роботов. */
const SK = 1.15;
const H0 = 11.4;
const LEG = 6.1;
const ARM1 = 6.0;
const ARM2 = 5.8;
const BLADE_L = 9.6;
const STANCE_R: V3 = [3.0, 6.8, 9.4];
const STANCE_B: V3 = [0.5, 0.2, -0.85];
const STANCE_L: V3 = [1.5, -7.0, 9.8];

const G0: GdO = {
  fwd: 0,
  side: 0,
  lift: 0,
  crouch: 0.1,
  lean: 0.06,
  twist: 0.12,
  roll: 0,
  head: 0,
  hturn: 0,
  ph: 0,
  step: 0,
  sph: 0,
  sstep: 0,
  wide: 0.4,
  hR: STANCE_R,
  bR: STANCE_B,
  hL: STANCE_L,
  plate: 0,
  core: 0,
  port: 0.15,
  eye: 1,
  steam: 0,
  sp: 0,
  statue: 0,
  kneel: 0,
  prone: 0,
  moss: 0,
};

/** Латы: шов поясом, ржавые подтёки от швов вниз, мох сверху (статуя). */
function armorMat(T: Tones, moss: number, rust: boolean, bias = 0): Mat {
  return {
    T,
    bias,
    spec: true,
    pat: (q, l) => {
      if (moss > 0 && q[2] > 0.25) {
        const n = hash(Math.floor(q[0] * 3.5 + 9), Math.floor(q[1] * 3.5 + 9), 77);
        if (n < moss * 0.95 - (0.6 - q[2]) * 0.6) return band(MOSS, l + (n - 0.5) * 0.4);
      }
      if (!rust) return null;
      if (q[2] > -0.24 && q[2] < -0.1) return l > 0.5 ? T[1] : DARKM[1];
      if (q[2] < -0.24 && q[2] > -0.8)
        for (const c of [-0.55, 0.45, -0.05])
          if (Math.abs(q[1] - c) < 0.08 + (q[2] + 0.24) * 0.06 && q[0] > -0.3)
            return l > 0.45 ? RUST[2] : RUST[1];
      return null;
    },
  };
}

/** Клинок: основание и острие (мир) по кисти и направлению. */
function bladeOf(B: F3, W: F3, o: GdO): [V3, V3, V3, V3] {
  const hand = W.p(o.hR[0], o.hR[1], o.hR[2]);
  const d = vnorm(B.v(o.bR[0], o.bR[1], o.bR[2]));
  return [hand, d, vadd(hand, vmul(d, 1.3 * SK)), vadd(hand, vmul(d, (1.3 + BLADE_L) * SK))];
}

/** Рамка курса в масштабе стража. */
const frameB = (yaw: number) => F3.yaw(yaw).scale(SK);

const handFrame = (B: F3, o: GdO) => B.at(o.fwd, o.side, o.lift - o.crouch * 2.6);

function guardRig(o: GdO, yaw: number): KRig {
  const r = new KRig(SK);
  const B = frameB(yaw);
  const cs = camSide(yaw);
  const drop = o.crouch * 2.6 + Math.max(o.kneel * 5.2, o.statue * 4.4) + o.prone * 1.6;
  const P = B.at(o.fwd + o.prone * 1.2, o.side, H0 - drop + o.lift).roll(o.roll);
  const T = P.at(0, 0, 1.2)
    .turn(o.twist)
    .pitch(o.lean + o.prone * 1.3);
  const cuir = armorMat(STEEL, o.moss, true);
  const cuirD = armorMat(STEEL, o.moss * 0.6, false, -0.12);
  const dark: Mat = { T: DARKM, spec: true };
  // Ноги: шаг по фазе (вперёд или вбок), колено, наколенник, сабатон.
  for (const sd of [-1, 1]) {
    const hip = P.p(0, sd * 2.8, 0);
    const [off, rise] = gait(o.ph + (sd > 0 ? 0.5 : 0));
    const [loff, lrise] = gait(o.sph + (sd > 0 ? 0.5 : 0));
    let foot = B.p(
      o.fwd * 0.4 + off * 8 * o.step + (sd < 0 ? o.wide * 1.7 : -o.wide * 1.3),
      o.side * 0.4 + sd * (3.1 + o.wide * 1.1) + loff * 6 * o.sstep,
      Math.max(rise * 2.4 * o.step, lrise * 2 * o.sstep),
    );
    if (o.statue > 0)
      foot = vlerp(foot, sd > 0 ? B.p(-5.4, 2.9, 0.3) : B.p(3.8, -3.2, 0), o.statue);
    if (o.kneel > 0) foot = vlerp(foot, B.p(-5.6 + o.prone * 1.5, sd * 3.0, 0.3), o.kneel);
    const near = sd === cs ? 0.04 : -0.16;
    const knee = leg(r, hip, foot, LEG * SK, LEG * SK, B.v(1, sd * 0.25, 0), [2.0, 1.6, 1.3], {
      T: LIMB,
      bias: near,
      spec: true,
    });
    // Поножь, наколенник, сабатон — светлее голени.
    const sh = vlerp(knee, foot, 0.62);
    r.cap(vadd(knee, B.v(0.5, 0, 0)), vadd(sh, B.v(0.6, 0, 0)), 1.9, 1.6, {
      T: STEEL,
      bias: near,
      spec: true,
    });
    r.ball(vadd(knee, B.v(0.9, 0, 0.3)), 1.6, cuir);
    r.ell(
      F3.yaw(0, vadd(foot, B.v(1.1, 0, 0.3)))
        .turn(Math.atan2(B.f[1], B.f[0]))
        .scale(SK),
      [0, 0, 0],
      [2.6, 1.6, 1.1],
      {
        T: STEEL,
        bias: near - 0.05,
        spec: true,
      },
    );
  }
  // Таз, живот, кираса.
  r.ell(P, [0, 0, 0.6], [3.0, 4.2, 2.2], dark);
  r.ell(T, [0, 0, 2.6], [3.0, 4.4, 2.6], { T: LIMB, spec: true });
  r.ell(T, [0, 0, 7.4], [4.5, 6.6, 5.2], cuir);
  // Трубы на спине.
  for (const sd of [-1, 1])
    r.cap(T.p(-3.8, sd * 2.6, 9.6), T.p(-4.9, sd * 2.6, 12.8), 1.2, 1.0, dark);
  // Ядро за створками и створки-щит.
  const pl = o.plate;
  if (pl > 0.02) {
    r.ball(T.p(2.9, 0, 6.4), 2.9, {
      T: CORE,
      glow: 0.35 + 0.6 * o.core,
      bias: 0.25 + 0.4 * o.core,
      soft: true,
    });
    r.ell(T, [2.2, 0, 6.4], [1.6, 3.6, 4.0], { T: DARKM, bias: -0.2 });
  }
  for (const sd of [-1, 1]) {
    const H = T.at(3.6 - pl * 0.6, sd * (2.3 + pl * 3.0), 6.6).turn(sd * pl * 0.95);
    r.ell(H, [0, 0, 0], [1.3, 2.5, 4.6], armorMat(PLATE, o.moss * 0.7, false, 0.05));
    r.cap(H.p(0.9, -sd * 2.2, 3.6), H.p(0.9, -sd * 2.2, -3.6), 0.35, 0.35, dark);
  }
  if (pl < 0.3) {
    // Порт посередине щита: оправа и заряд.
    const c = o.port;
    r.ball(T.p(4.6, 0, 4.9), 1.4, dark);
    r.ball(T.p(5.1, 0, 4.9), 1.0, {
      T:
        c > 0.85
          ? [CORE[2], CORE[3], WHITE, WHITE]
          : c > 0.45
            ? [LENS[2], LENS[3], CORE[3], WHITE]
            : LENS,
      glow: clamp01(c * 1.1),
      bias: -0.3 + c * 1.1,
      soft: true,
    });
  }
  // Наплечники.
  for (const sd of [-1, 1]) {
    r.ell(
      T,
      [0, sd * 6.8, 10.6],
      [3.2, 3.0, 2.3],
      armorMat(PLATE, o.moss, false, sd === cs ? 0 : -0.15),
    );
    r.cap(T.p(-2.4, sd * 7.6, 9.6), T.p(2.8, sd * 7.6, 9.6), 0.6, 0.6, { T: RUST, spec: true });
  }
  // Шлем: забрало-щель, линза, гребень, антенна.
  const Hd = T.at(0.6, 0, 14.2).turn(o.hturn).pitch(o.head);
  r.ell(T, [0.3, 0, 11.8], [2.6, 3.2, 1.6], dark);
  r.ell(Hd, [0, 0, 0], [3.8, 4.3, 3.6], armorMat(STEEL, o.moss, false, 0.12));
  r.ell(Hd, [2.6, 0, -0.3], [1.5, 3.6, 0.95], { T: DARKM, bias: -0.35 });
  const e = o.eye;
  r.ball(Hd.p(3.6, 1.0, -0.3), 1.15, {
    T: e > 0.3 ? (e > 1.2 ? [LENS[2], LENS[3], WHITE, WHITE] : LENS) : LENS_OFF,
    glow: clamp01(e * 0.8),
    bias: e > 0.3 ? 0.2 + 0.3 * Math.min(e, 1.5) : -0.2,
    soft: e > 0.3,
  });
  r.cap(Hd.p(-2.8, 0, 2.8), Hd.p(1.4, 0, 3.9), 0.9, 0.6, cuir);
  r.cap(Hd.p(-1.4, 0, 3.6), Hd.p(-2.0, 0, 6.6), 0.35, 0.3, dark);
  r.dot(Hd.p(-2.0, 0, 7.0), e > 0.3 ? PORT_C : LENS_OFF[2], e > 0.3 ? 0.5 : 0, 1, 0.6);
  r.eye = e > 0.3 ? Hd.p(3.6, 1.0, -0.3) : null;
  // Руки: правая с клинком, левая — кулак.
  const W = handFrame(B, o);
  const [hR, d, b0, b1] = bladeOf(B, W, o);
  const hL = W.p(o.hL[0], o.hL[1], o.hL[2]);
  for (const sd of [-1, 1]) {
    const sh = T.p(0, sd * 6.9, 9.4);
    const hand = sd > 0 ? hR : hL;
    arm(
      r,
      sh,
      hand,
      ARM1 * SK,
      ARM2 * SK,
      T.v(-0.6, sd * 1, -0.2),
      [1.7, 1.9, 1.7],
      { T: LIMB, bias: sd === cs ? 0 : -0.15, spec: true },
      sd === cs ? cuir : cuirD,
    );
    r.ball(hand, 2.0, sd === cs ? cuir : cuirD);
  }
  const bm: Mat = { T: BLADE, spec: true };
  const side = vnorm([-d[1], d[0], 0.0001]);
  r.cap(vadd(hR, vmul(side, 1.7 * SK)), vadd(hR, vmul(side, -1.7 * SK)), 0.55, 0.55, dark);
  r.cap(vadd(hR, vmul(d, -1.6 * SK)), hR, 0.6, 0.6, dark);
  r.cap(b0, b1, 1.25, 0.3, bm);
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

function idleO(f: number): GdO {
  // Гудит: 8 кадров по 5 к/с — дышит тазом, клинок и кулак качаются следом.
  const a = (f / 8) * TAU;
  const o: GdO = { ...G0 };
  o.lift = 0.25 * Math.sin(a);
  o.hR = [STANCE_R[0], STANCE_R[1], STANCE_R[2] + 0.35 * Math.sin(a - 0.8)];
  o.hL = [STANCE_L[0], STANCE_L[1], STANCE_L[2] + 0.35 * Math.sin(a - 0.8)];
  o.hturn = 0.18 * Math.sin(a);
  o.port = 0.15 + 0.12 * (0.5 + 0.5 * Math.sin(a));
  return o;
}

function walkO(f: number): GdO {
  // Тяжёлый шаг: 8 кадров на клетку; на постановке ноги — оседает.
  const a = (f / 8) * TAU;
  const o: GdO = { ...G0, ph: f / 8, step: 1, wide: 0.1 };
  o.lift = -0.45 * Math.cos(2 * a) - 0.1;
  o.roll = 0.06 * Math.sin(a);
  o.twist = 0.1 + 0.12 * Math.cos(a);
  o.lean = 0.12;
  o.hR = [STANCE_R[0] + 1.6 * Math.cos(a), STANCE_R[1], STANCE_R[2] + 0.3 * Math.cos(2 * a)];
  o.hL = [STANCE_L[0] - 2.2 * Math.cos(a), STANCE_L[1], STANCE_L[2] + 0.3 * Math.cos(2 * a)];
  return o;
}

function sideO(f: number): GdO {
  // Приставной шаг вправо (назад по кадрам — влево), щит к герою.
  const a = (f / 8) * TAU;
  const o: GdO = { ...G0, sph: f / 8, sstep: 1, wide: 0.1, crouch: 0.3 };
  o.lift = -0.35 * Math.cos(2 * a) - 0.1;
  o.roll = 0.07 * Math.sin(a);
  o.side = 0.4 * Math.sin(a);
  o.hR = [STANCE_R[0], STANCE_R[1], STANCE_R[2] + 0.4 * Math.cos(2 * a)];
  o.hL = [STANCE_L[0], STANCE_L[1], STANCE_L[2] + 0.4 * Math.cos(2 * a)];
  return o;
}

const POST_R: V3 = [4.3, 0.9, 11.4];
const POST_B: V3 = [0.06, -0.04, -1];
const POST_L: V3 = [4.3, -0.9, 12.2];

function postO(f: number): GdO {
  // «Смирно»: клинок остриём в пол, руки на навершии, голова ходит.
  return {
    ...G0,
    wide: 0,
    lean: 0,
    twist: 0,
    crouch: 0,
    hturn: (f - 3) * 0.3,
    hR: POST_R,
    bR: POST_B,
    hL: POST_L,
    port: 0.22,
  };
}

const STAT_R: V3 = [5.0, 0.8, 8.6];
const STAT_L: V3 = [5.0, -0.8, 9.4];
function statueO(): GdO {
  return {
    ...G0,
    statue: 1,
    wide: 0,
    lean: 0.14,
    twist: 0,
    crouch: 0,
    head: 0.5,
    hR: STAT_R,
    bR: [0.04, 0, -1],
    hL: STAT_L,
    eye: 0,
    port: 0,
    moss: 1,
  };
}

function riseO(T: number): GdO {
  // Из статуи: линза мигает, голова вверх, мох осыпается, клинок из пола, встал, топ.
  const o = statueO();
  const ff = Math.floor(T * FPS);
  o.eye = ff < 1 ? 0 : ff < 2 ? 0.7 : ff < 3 ? 0 : ff < 6 ? 1.5 : 1;
  o.head = trk(T, [
    [0.12, 0.5],
    [0.32, -0.15, easeOut],
    [0.55, 0],
  ]);
  o.moss = trk(T, [
    [0.18, 1],
    [0.45, 0],
  ]);
  o.statue = trk(T, [
    [0.36, 1],
    [0.68, 0],
  ]);
  o.crouch = trk(T, [
    [0.6, 0],
    [0.7, 0.4, easeIn],
    [0.8, 0.1],
  ]);
  o.lean = trk(T, [
    [0.2, 0.14],
    [0.3, 0.02],
    [0.5, 0.2],
    [0.8, 0.06],
  ]);
  o.wide = trk(T, [
    [0.6, 0],
    [0.72, 0.4],
  ]);
  o.twist = trk(T, [
    [0.55, 0],
    [0.8, 0.12],
  ]);
  o.hR = k3(T, [
    [0.36, STAT_R],
    [0.56, [4.4, 3.6, 13.2]],
    [0.78, STANCE_R],
  ]);
  o.bR = k3(T, [
    [0.36, [0.04, 0, -1]],
    [0.56, [0.3, 0.1, 0.95]],
    [0.78, STANCE_B],
  ]);
  o.hL = k3(T, [
    [0.3, STAT_L],
    [0.5, [3.4, -6.0, 9.4]],
    [0.75, STANCE_L],
  ]);
  o.port = trk(T, [
    [0.2, 0],
    [0.4, 0.3],
    [0.8, 0.15],
  ]);
  return o;
}

function alertO(T: number): GdO {
  // Из караула: линза вспыхнула, клинок рывком вверх, шаг в стойку.
  const o = postO(3);
  o.hturn = 0;
  o.eye = T < 0.04 ? 1 : T < 0.25 ? 1.6 : 1;
  o.hR = k3(T, [
    [0.1, POST_R],
    [0.35, [4.4, 4.2, 15.0], easeOut],
    [0.5, [4.4, 4.6, 14.6]],
    [0.78, STANCE_R],
  ]);
  o.bR = k3(T, [
    [0.1, POST_B],
    [0.35, [0.45, 0.2, 0.9], easeOut],
    [0.78, STANCE_B],
  ]);
  o.hL = k3(T, [
    [0.12, POST_L],
    [0.4, [3.2, -6.4, 11.0]],
    [0.75, STANCE_L],
  ]);
  o.wide = trk(T, [
    [0.4, 0],
    [0.55, 0.5, easeOut],
    [0.8, 0.4],
  ]);
  o.crouch = trk(T, [
    [0.4, 0],
    [0.56, 0.35, easeIn],
    [0.8, 0.1],
  ]);
  o.lean = trk(T, [
    [0.1, 0],
    [0.3, -0.06],
    [0.6, 0.12],
    [0.8, 0.06],
  ]);
  o.twist = trk(T, [
    [0.4, 0],
    [0.8, 0.12],
  ]);
  o.port = 0.22;
  return o;
}

const AIM_T = GUARD.track + GUARD.lock;
const AIM_R: V3 = [-1.4, 8.3, 10.2];
const AIM_B: V3 = [-0.35, 0.35, -0.85];
const AIM_L: V3 = [-1.2, -8.3, 10.6];

function aimO(T: number): GdO {
  // Упор: стопы шире, присел, руки в стороны — линия огня открыта; порт копит свет.
  const o: GdO = { ...G0 };
  const f = Math.floor(T * FPS);
  o.crouch = trk(T, [
    [0, 0.1],
    [0.2, 0.95, easeOut],
    [0.3, 0.85],
    [0.98, 0.85],
    [1.1, 1.0, easeIn],
  ]);
  o.wide = trk(T, [
    [0, 0.4],
    [0.16, 1.15, easeOut],
  ]);
  o.lean = trk(T, [
    [0, 0.06],
    [0.24, 0.26],
    [0.98, 0.24],
    [1.1, 0.3],
  ]);
  o.twist = trk(T, [
    [0, 0.12],
    [0.24, 0],
  ]);
  o.head = trk(T, [
    [0, 0],
    [0.3, 0.14],
  ]);
  o.hR = k3(T, [
    [0, STANCE_R],
    [0.24, AIM_R, easeOut],
  ]);
  o.bR = k3(T, [
    [0, STANCE_B],
    [0.24, AIM_B],
  ]);
  o.hL = k3(T, [
    [0, STANCE_L],
    [0.24, AIM_L, easeOut],
  ]);
  o.port = trk(T, [
    [0, 0.15],
    [0.2, 0.3],
    [GUARD.track, 0.62],
    [AIM_T, 1, easeIn],
  ]);
  o.eye = T < GUARD.track ? 1.2 : 1.6;
  if (T > GUARD.track) {
    // Замок: дрожь упора, пар из суставов.
    o.fwd = f % 2 ? 0.3 : -0.3;
    o.roll = f % 2 ? 0.025 : -0.025;
    o.steam = 0.35;
    o.sp = f;
  }
  return o;
}

function ventO(T: number): GdO {
  // Отдача выстрела, створки настежь, ядро светит, пар; к концу — закрылся.
  const o: GdO = { ...G0 };
  const f = Math.floor(T * FPS);
  o.fwd = trk(T, [
    [0, -1.4],
    [0.1, -2.1, easeOut],
    [0.35, -1.6],
    [1.3, 0],
  ]);
  o.lean = trk(T, [
    [0, -0.14],
    [0.12, -0.06],
    [0.36, 0.32],
    [1.1, 0.3],
    [1.3, 0.06],
  ]);
  o.crouch = trk(T, [
    [0, 1.0],
    [0.3, 0.7],
    [1.06, 0.62],
    [1.3, 0.1],
  ]);
  o.wide = trk(T, [
    [0, 1.15],
    [1.06, 1.0],
    [1.3, 0.4],
  ]);
  o.twist = trk(T, [
    [0.9, 0],
    [1.3, 0.12],
  ]);
  o.plate = trk(T, [
    [0.04, 0],
    [0.24, 1, easeOut],
    [1.1, 1],
    [1.27, 0, easeIn],
  ]);
  o.core = trk(T, [
    [0.06, 0],
    [0.22, 1],
  ]);
  o.core *= 0.78 + 0.22 * Math.cos(T * 15);
  o.port = trk(T, [
    [0, 1],
    [0.12, 0],
  ]);
  o.eye = trk(T, [
    [0, 1.4],
    [0.3, 0.1],
    [1.08, 0.1],
    [1.18, 1.3],
    [1.3, 1],
  ]);
  o.head = trk(T, [
    [0, -0.12],
    [0.36, 0.42],
    [1.06, 0.4],
    [1.28, 0],
  ]);
  o.hturn = 0.08 * Math.sin(T * 4);
  o.steam = trk(T, [
    [0, 0],
    [0.08, 1],
    [1.0, 0.75],
    [1.3, 0],
  ]);
  o.sp = f;
  o.hR = k3(T, [
    [0, AIM_R],
    [0.4, [2.4, 7.6, 8.0]],
    [1.06, [2.4, 7.6, 8.0]],
    [1.3, STANCE_R],
  ]);
  o.bR = k3(T, [
    [0, AIM_B],
    [0.4, [0.35, 0.12, -0.95]],
    [1.06, [0.35, 0.12, -0.95]],
    [1.3, STANCE_B],
  ]);
  o.hL = k3(T, [
    [0, AIM_L],
    [0.4, [1.6, -7.6, 8.2]],
    [1.06, [1.6, -7.6, 8.2]],
    [1.3, STANCE_L],
  ]);
  return o;
}

const BASH_T = GUARD.bash;
const WIND_R: V3 = [-2.4, 6.4, 17.2];
const WIND_B: V3 = [-0.35, 0.25, 0.9];
const HIT_R: V3 = [6.8, 0.2, 10.4];
const HIT_B: V3 = [0.85, -0.45, -0.3];
const FOL_R: V3 = [3.6, -6.4, 8.4];
const FOL_B: V3 = [0.15, -0.95, -0.35];

/** Удар клинком: τ — время от начала `f11_bash` (дальше — `recover`). */
function bashO(tau: number): GdO {
  const o: GdO = { ...G0 };
  const f = Math.floor(tau * FPS);
  const S = BASH_T;
  o.twist = trk(tau, [
    [0, 0.12],
    [0.3, 0.62, easeOut],
    [S - 0.1, 0.62],
    [S, -0.1, easeIn],
    [S + 0.12, -0.62, easeOut],
    [S + 0.36, -0.5],
    [S + 0.7, 0.12],
  ]);
  o.lean = trk(tau, [
    [0, 0.06],
    [0.3, -0.12],
    [S - 0.1, -0.12],
    [S, 0.26, easeIn],
    [S + 0.12, 0.3],
    [S + 0.7, 0.06],
  ]);
  o.fwd = trk(tau, [
    [0, 0],
    [0.3, -0.8],
    [S - 0.1, -0.8],
    [S, 1.3, easeIn],
    [S + 0.14, 1.6],
    [S + 0.7, 0],
  ]);
  o.crouch = trk(tau, [
    [0, 0.1],
    [0.3, 0.35],
    [S, 0.5],
    [S + 0.14, 0.6],
    [S + 0.7, 0.1],
  ]);
  o.wide = trk(tau, [
    [0, 0.4],
    [0.3, 0.8],
    [S, 1.25, easeIn],
    [S + 0.4, 1.2],
    [S + 0.7, 0.4],
  ]);
  o.head = trk(tau, [
    [0, 0],
    [0.3, -0.06],
    [S, 0.14],
    [S + 0.7, 0],
  ]);
  o.hR = k3(tau, [
    [0, STANCE_R],
    [0.3, WIND_R, easeOut],
    [S - 0.1, WIND_R],
    [S, HIT_R, easeIn],
    [S + 0.12, FOL_R, easeOut],
    [S + 0.36, FOL_R],
    [S + 0.7, STANCE_R],
  ]);
  o.bR = k3(tau, [
    [0, STANCE_B],
    [0.3, WIND_B, easeOut],
    [S - 0.1, WIND_B],
    [S, HIT_B, easeIn],
    [S + 0.12, FOL_B, easeOut],
    [S + 0.36, FOL_B],
    [S + 0.7, STANCE_B],
  ]);
  o.hL = k3(tau, [
    [0, STANCE_L],
    [0.3, [4.4, -4.4, 12.4]],
    [S - 0.1, [4.4, -4.4, 12.4]],
    [S, [0.4, -7.6, 10.4], easeIn],
    [S + 0.7, STANCE_L],
  ]);
  o.eye = tau > 0.2 && tau < S + 0.2 ? 1.4 : 1;
  if (tau > 0.32 && tau < S - 0.1) {
    // Задержка на пике замаха: дрожь сервоприводов.
    const s = f % 2 ? 1 : -1;
    o.hR = [o.hR[0] + 0.25 * s, o.hR[1], o.hR[2] + 0.2 * s];
    o.roll = 0.02 * s;
  }
  return o;
}

function flinchO(f: number): GdO {
  // Удар в бок или в спину: корпус дёрнуло, голова мотнулась, возврат.
  const k = [1, 0.85, 0.55, 0.25, 0][Math.min(4, f)];
  const o: GdO = { ...G0 };
  o.lean = 0.06 - 0.26 * k;
  o.twist = 0.12 + 0.3 * k;
  o.head = -0.25 * k;
  o.hturn = 0.3 * k;
  o.fwd = -0.6 * k;
  o.crouch = 0.1 + 0.25 * k;
  o.eye = f < 2 ? 1.6 : 1;
  o.hR = [STANCE_R[0] - 1.2 * k, STANCE_R[1] + 0.8 * k, STANCE_R[2] + 1.4 * k];
  o.hL = [STANCE_L[0] - 1.6 * k, STANCE_L[1] - 0.6 * k, STANCE_L[2] + 1.8 * k];
  return o;
}

function blockO(f: number): GdO {
  // Удар в щит: створки звякнули, корпус почти не шелохнулся.
  const k = [1, 0.6, 0.25, 0][Math.min(3, f)];
  const o: GdO = { ...G0 };
  o.fwd = -0.5 * k;
  o.lean = 0.06 - 0.06 * k;
  o.crouch = 0.1 + 0.2 * k;
  o.eye = f < 2 ? 1.5 : 1;
  return o;
}

function dieO(T: number): GdO {
  // Искрит, линза мигает, отшатнулся, на колени, ничком; из труб — дым.
  const o: GdO = { ...G0 };
  const f = Math.floor(T * FPS);
  o.eye = [1.6, 0, 1.2, 0, 0, 0.7, 0][Math.min(6, f)];
  o.port = T < 0.2 ? 0.6 : 0;
  o.fwd = trk(T, [
    [0, 0],
    [0.1, -1.1, easeOut],
    [0.4, -0.6],
    [0.68, 1.2],
  ]);
  o.lean = trk(T, [
    [0, 0.06],
    [0.1, -0.26],
    [0.3, 0.12],
  ]);
  o.twist = trk(T, [
    [0, 0.12],
    [0.12, 0.35],
    [0.5, -0.1],
  ]);
  o.kneel = trk(T, [
    [0.12, 0],
    [0.4, 1, easeIn],
  ]);
  o.prone = trk(T, [
    [0.4, 0],
    [0.68, 1, easeIn],
  ]);
  o.head = trk(T, [
    [0, 0],
    [0.12, -0.3],
    [0.45, 0.55],
    [0.68, 0.3],
  ]);
  o.hR = k3(T, [
    [0.1, [STANCE_R[0] - 1, STANCE_R[1] + 1, STANCE_R[2] + 2]],
    [0.4, [3.4, 7.2, 4.2]],
    [0.68, [9.0, 6.6, 1.2]],
  ]);
  o.bR = k3(T, [
    [0.1, STANCE_B],
    [0.4, [0.3, 0.3, -0.9]],
    [0.68, [0.5, 0.86, -0.05]],
  ]);
  o.hL = k3(T, [
    [0.1, [STANCE_L[0] - 1, STANCE_L[1] - 1, STANCE_L[2] + 2]],
    [0.4, [3.0, -7.2, 4.4]],
    [0.68, [9.2, -6.4, 1.2]],
  ]);
  o.steam = T > 0.55 ? 1 : 0;
  o.sp = f;
  return o;
}

function guardPose(anim: string, f: number): GdO {
  const t = (f + 0.5) / FPS;
  switch (anim) {
    case 'idle':
      return idleO(f);
    case 'walk':
      return walkO(f);
    case 'side':
      return sideO(f);
    case 'post':
      return postO(f);
    case 'statue':
      return statueO();
    case 'rise':
      return riseO(t);
    case 'alert':
      return alertO(t);
    case 'aim':
      return aimO(Math.min(t, AIM_T - 0.005));
    case 'vent':
      return ventO(t - 0.5 / FPS + 0.004);
    case 'bash':
      return bashO(Math.min(t, BASH_T - 0.005));
    case 'bashf':
      return bashO(BASH_T + t - 0.5 / FPS + 0.004);
    case 'flinch':
      return flinchO(f);
    case 'block':
      return blockO(f);
    case 'die':
      return dieO(t);
  }
  return { ...G0 };
}

// ---- Кадр --------------------------------------------------------------------

const GD = kindOf('guard', 72, 66, 36, 46, 1900);

/** След клинка по треку удара: острие и основание за прошлые кадры. */
function trail(anim: string, f: number, d: number, n: number): { tips: V3[]; bases: V3[] } {
  const B = frameB(yawN(d));
  const tips: V3[] = [];
  const bases: V3[] = [];
  const tau0 = anim === 'bashf' ? BASH_T + f / FPS + 0.004 : (f + 0.5) / FPS;
  for (let i = n; i >= 0; i--) {
    const tau = tau0 - i / FPS;
    if (tau < 0) continue;
    const o = bashO(tau);
    const [, , b0, b1] = bladeOf(B, handFrame(B, o), o);
    tips.push(b1);
    bases.push(vlerp(b0, b1, 0.35));
  }
  return { tips, bases };
}

/** Пар клубами: от точки вверх, по фазе. */
function puffs(o: RigOut, x: number, y: number, ph: number, amt: number, c: RGBA, n = 3): void {
  for (let i = 0; i < n; i++) {
    const k = (((ph * 0.11 + i / n) % 1) + 1) % 1;
    const px = x + Math.sin(i * 2.1 + ph * 0.6) * 2.2 * k;
    const py = y - k * 9;
    const rr = 0.8 + k * 1.6;
    const a = amt * 0.6 * (1 - k * 0.7);
    for (let yy = -2; yy <= 2; yy++)
      for (let xx = -2; xx <= 2; xx++)
        if (xx * xx + yy * yy <= rr * rr)
          o.p.set(Math.round(px + xx), Math.round(py + yy), alpha(c, a));
  }
}

const guardPic = (anim: string, f: number, d: number): Pic => {
  const g = guardPose(anim, f);
  const yaw = yawN(d);
  return draw(GD, guardRig(g, yaw), (o, P2) => {
    const B = frameB(yaw);
    const drop = g.crouch * 2.6 + Math.max(g.kneel * 5.2, g.statue * 4.4) + g.prone * 1.6;
    const Pp = B.at(g.fwd + g.prone * 1.2, g.side, H0 - drop + g.lift);
    const T = Pp.at(0, 0, 1.2)
      .turn(g.twist)
      .pitch(g.lean + g.prone * 1.3);
    const portP = P2(T.p(5.3, 0, 4.9));
    // След клинка: удар и проводка.
    const sw = (anim === 'bash' && f >= 12) || (anim === 'bashf' && f <= 3) ? 3 : 0;
    if (sw) {
      const { tips, bases } = trail(anim, f, d, sw);
      smear(o, tips.map(P2), bases.map(P2), SMEAR_C, 0.45);
    }
    if (anim === 'aim' && f >= 3 && Math.sin(yaw) > -0.35) {
      // Порт копит свет: ореол растёт с зарядом.
      const rr = 1.4 + g.port;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        const c = i % 2 ? PORT_C : hx('#ffb080');
        spark2(
          o,
          portP[0] + Math.cos(a) * rr,
          portP[1] + Math.sin(a) * rr,
          alpha(c, 0.35 + 0.6 * g.port),
          0.7,
        );
      }
    }
    if (anim === 'aim' && f >= 18) {
      // Замок: искры сходятся к порту.
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU + f * 0.7;
        const rr = 7 * (1 - ((f - 18 + i * 0.5) % 4) / 4);
        const x = Math.round(portP[0] + Math.cos(a) * rr);
        const y = Math.round(portP[1] + Math.sin(a) * rr * 0.7);
        // Спиной к зрителю порт за корпусом — искры только вокруг силуэта.
        if (Math.sin(yaw) < -0.35 && o.p.get(x, y)[3]) continue;
        spark2(o, x, y, alpha(SPARK[i % 3], 0.9), 0.8);
      }
    }
    if (anim === 'vent' && f <= 2) {
      // Вспышка выстрела из порта, луч уходит вперёд. Спиной к зрителю — порт
      // за корпусом: свет только вокруг силуэта.
      const behind = Math.sin(yaw) < -0.35;
      const fl = (x: number, y: number, c: RGBA) => {
        const X = Math.round(x);
        const Y = Math.round(y);
        if (
          behind &&
          X >= 0 &&
          Y >= 0 &&
          X < o.p.w &&
          Y < o.p.h &&
          o.p.data[(Y * o.p.w + X) * 4 + 3]
        )
          return;
        spark2(o, X, Y, c, 1);
      };
      const fx = Math.cos(yaw);
      const fy = Math.sin(yaw) * 0.6;
      const L = [9, 6, 3][f];
      for (let j = 0; j <= L; j++)
        fl(portP[0] + fx * j, portP[1] + fy * j, alpha(j < 2 ? WHITE : PORT_C, 1 - j / (L + 2)));
      const R = [3, 2, 1][f] + (behind ? 1 : 0);
      for (let yy = -R; yy <= R; yy++)
        for (let xx = -R; xx <= R; xx++)
          if (xx * xx + yy * yy <= R * R + 0.5)
            fl(
              portP[0] + xx,
              portP[1] + yy,
              xx * xx + yy * yy <= 1 ? WHITE : alpha(hx('#ffb090'), 0.85),
            );
    }
    if (g.steam > 0) {
      // Пар (дым у мёртвого) из труб на спине.
      const c = anim === 'die' ? SMOKE[1] : STEAM;
      for (const sd of [-1, 1]) {
        const q = P2(T.p(-5.0, sd * 2.6, 13.4));
        puffs(
          o,
          q[0],
          q[1],
          g.sp + (sd > 0 ? 3 : 0),
          g.steam * (anim === 'die' ? 0.9 : 1),
          c,
          anim === 'aim' ? 2 : 3,
        );
      }
      if (anim === 'vent' && g.plate > 0.5) {
        const q = P2(T.p(4.6, 0, 9.5));
        puffs(o, q[0], q[1], g.sp + 5, g.steam * 0.7, STEAM, 2);
      }
    }
    if (anim === 'block' && f <= 1) {
      // Искры по щиту.
      const q = P2(T.p(5.0, 0, 7.4));
      spray(o.p, q[0], q[1], 7, 5, f ? 1 : 0.6, 41, SPARK, 2, 2);
      spark2(o, q[0], q[1], WHITE);
    }
    if (anim === 'flinch' && f <= 2) {
      const q = P2(T.p(0, 6.6, 8));
      spray(o.p, q[0], q[1], 5, 4, (f + 1) / 3, 43, SPARK, 2, 2);
    }
    if (anim === 'rise' && f >= 5 && f <= 13) {
      // Мох осыпается с плеч и шлема.
      const q = P2(T.p(0, 0, 11));
      spray(o.p, q[0], q[1], 9, 8, (f - 4) / 9, 47, MOSS_BITS, 10, 0);
    }
    if (anim === 'rise' && f >= 8 && f <= 12) {
      // Крошка из пола, где торчал клинок.
      const q = P2(B.p(5.0, 0.8, 0));
      spray(o.p, q[0], q[1], 6, 5, (f - 7) / 5, 49, [hx('#6a5a50'), hx('#8a7a70')], 3, 4);
    }
    if (anim === 'die' && f <= 8) {
      // Искры из суставов.
      for (const [qf, qs, qz] of [
        [0, 6.9, 9.4],
        [0, -6.9, 9.4],
        [0.6, 0, 13],
      ] as V3[]) {
        const q = P2(T.p(qf, qs, qz));
        spray(o.p, q[0], q[1], 4, 5, ((f % 3) + 1) / 3, 53 + f, SPARK, 2, 2);
      }
    }
    if (anim === 'die' && f >= 16 && f <= 19) {
      const q = P2(B.p(4, 0, 0));
      spray(
        o.p,
        q[0],
        q[1],
        8,
        9,
        (f - 15) / 4,
        59,
        [hx('#6a5a50'), hx('#8a7a70'), hx('#4a3e38')],
        0,
        3,
      );
    }
  });
};

registerMobPainter('f11_guard', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = pose.t;
  const now = pose.now || 0;
  const id = m.id ?? 0;
  const face = m.face ?? 0;
  const v = visOf(m, pose, md === 'f11_post' ? PI / 2 : face, md === 'chase' ? 9 : 14);
  let d = dirN(v.yaw);
  const ex: Partial<MobFrame> = { shadow: 9 };
  let anim = 'idle';
  let f = 0;
  let dark = 0;
  // Удар в щит — спереди (±1,15 рад, как `onHit` мозга).
  const front = Math.abs(angD(Math.atan2(v.ky, v.kx) + PI, v.yaw)) < 1.15;
  if (md === 'dying') {
    f = fi(t, 21);
    anim = 'die';
    ex.linger = 0.9;
    ex.alpha = 1 - sstep(0.76, 0.9, t);
    ex.still = true;
    const th = clamp01((t - 0.66) / 0.1);
    if (th > 0 && th < 1) {
      ex.sx = 1 + 0.08 * Math.sin(PI * th);
      ex.sy = 1 - 0.1 * Math.sin(PI * th);
    }
  } else if (md === 'f11_dormant') {
    anim = 'statue';
  } else if (md === 'f11_post') {
    anim = 'post';
    f = clamp(Math.round(angD(face, PI / 2) / 0.3) + 3, 0, 6);
    d = 2;
  } else if (md === 'f11_rise' || md === 'alert') {
    const T = md === 'alert' ? t * (0.8 / 0.35) : t;
    f = fi(T, 19);
    anim = md === 'alert' || v.prev === 'f11_post' ? 'alert' : 'rise';
    ex.still = true;
  } else if (md === 'f11_aim') {
    f = fi(t, 27);
    anim = 'aim';
    ex.still = true;
  } else if (md === 'f11_vent') {
    f = fi(t, 31);
    anim = 'vent';
    ex.still = true;
    if (f <= 1) {
      ex.sx = 1.06;
      ex.sy = 0.94;
    }
  } else if (md === 'f11_bash') {
    f = fi(t, 14);
    anim = 'bash';
    ex.still = true;
  } else if (md === 'recover' && (v.prev === 'f11_bash' || v.prev === '')) {
    f = fi(t, 16);
    anim = 'bashf';
    ex.still = true;
    if (f <= 1) {
      ex.sx = 1.05;
      ex.sy = 0.95;
    }
  } else if (md === 'stun' || hurtAge(v, now) < 0.2) {
    const a = md === 'stun' && hurtAge(v, now) > 0.2 ? t : hurtAge(v, now);
    if (front && md !== 'stun') {
      f = fi(a, 3);
      anim = 'block';
    } else {
      f = fi(a, 4);
      anim = 'flinch';
    }
  } else if (moving(m, 0.35)) {
    const rel = angD(Math.atan2(m.vy ?? 0, m.vx ?? 0), v.yaw);
    const c = Math.cos(rel);
    if (Math.abs(c) >= 0.55) {
      const k = Math.floor((v.dist / 1.0) * 8) % 8;
      f = c > 0 ? k : (8 - k) % 8;
      anim = 'walk';
    } else {
      const k = Math.floor((v.dist / 0.75) * 8) % 8;
      f = Math.sin(rel) > 0 ? k : (8 - k) % 8;
      anim = 'side';
    }
  } else {
    f = Math.floor((now + hash(id, 7) * 4) * 5) % 8;
    anim = 'idle';
  }
  if (md === 'emerge') dark = 3 - Math.min(3, Math.floor(clamp01(t / 0.45) * 4));
  if (md !== 'dying') hurtFx(v, now, front ? 0.5 : 1.1, ex);
  return put(
    frameOf(GD, anim, f, d, pose, (dd) => guardPic(anim, f, dd), dark),
    ex,
  );
});

registerMobWarm('f11_guard', function* () {
  yield* warmAll(
    GD,
    [
      ['walk', 8],
      ['idle', 8],
      ['aim', 28],
      ['vent', 32],
      ['bash', 15],
      ['bashf', 17],
      ['side', 8],
      ['block', 4],
      ['flinch', 5],
      ['die', 22],
      ['rise', 20],
      ['alert', 20],
      ['statue', 1],
    ],
    guardPic,
  );
  // Караул смотрит на юг: одна сторона, 7 положений головы.
  yield* warmAll(GD, [['post', 7]], guardPic, ['normal'], [2]);
});

// ---- Контакт лазера на полу: прожжённая полоса остывает, на конце — искры.

const LASER_LIFE = 0.7;
registerImpactPainter('f11_laser', {
  life: LASER_LIFE,
  shake: 0.08,
  paint(g, rec, px, py, scale, age) {
    const s = scale / 16;
    const k = age / LASER_LIFE;
    const ang = rec.ang ?? 0;
    const L = (rec.r ?? 4) * scale;
    const ux = Math.cos(ang);
    const uy = Math.sin(ang);
    const hot = 1 - k;
    // Полоса: от ног стража до конца луча, остывает от белого к тёмно-красному.
    const n = Math.max(2, Math.floor(L / (2 * s)));
    const col = mixc(
      mixc(hx('#fff0c0'), hx('#ff6a30'), clamp01(k * 2.5)),
      hx('#5a1a10'),
      clamp01(k * 1.6 - 0.4),
    );
    g.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${(0.85 * hot).toFixed(3)})`;
    for (let i = 2; i <= n; i++) {
      const q = i / n;
      const w = q > 0.96 ? 2 : 1;
      g.fillRect(
        Math.round(px + ux * L * q),
        Math.round(py + uy * L * q),
        Math.ceil(w * s),
        Math.ceil(s),
      );
    }
    // Тлеющие точки вдоль полосы.
    for (let i = 0; i < 6; i++) {
      const q = 0.2 + 0.8 * hash(rec.seed, i, 3);
      const a = hot * (0.5 + 0.5 * Math.sin(age * 20 + i * 2));
      g.fillStyle = `rgba(255,${Math.round(180 - 120 * k)},80,${clamp01(a).toFixed(3)})`;
      g.fillRect(
        Math.round(px + ux * L * q),
        Math.round(py + uy * L * q - s),
        Math.ceil(s),
        Math.ceil(s),
      );
    }
    // Искры на конце луча.
    const ex = px + ux * L;
    const ey = py + uy * L;
    const e = easeOut(Math.min(1, k * 1.6));
    for (let i = 0; i < 8; i++) {
      const th = ang + PI + (hash(rec.seed, i, 5) - 0.5) * 3.2;
      const rr = (2 + 7 * hash(rec.seed, i, 7)) * e * s;
      const x = ex + Math.cos(th) * rr;
      const y = ey - 8 * s + Math.sin(th) * rr * 0.7 + 8 * k * k * s;
      g.fillStyle =
        i % 3
          ? `rgba(255,${Math.round(220 - 120 * k)},90,${hot.toFixed(3)})`
          : `rgba(255,255,255,${hot.toFixed(3)})`;
      g.fillRect(Math.round(x), Math.round(y), Math.ceil(s), Math.ceil(s));
    }
    return true;
  },
});
