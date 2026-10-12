// Абордажник (анимации мобов 11): небесный пират в красной куртке с полами,
// кожаный шлем и голубые очки, жёлтый шарф по ветру, за спиной — сложенный
// планер, в правой — абордажная сабля, в левой — крюк-кошка на цепи. Мини-3D
// (`f15-rig.ts`), 8 сторон честно (сабля и крюк в разных руках), 24 к/с.
//
// Метроном — `f11-brains.ts` (`f11_boarder`, `BOARDER`):
// - `f11_land` 0,95 с — сцена прилёта (зону `f11_glider` рисует он сам):
//   висит под раскрытым планером, подлетает с неба (сдвиг кадра по `data.from`),
//   у края подрывает нос, отпускает, приземляется в присед; `recover` после
//   прилёта — складывает крылья за спину, встаёт;
// - `f11_aimhook` 0,75 с: крутит крюк над головой, всё быстрее (смаз круга),
//   в конце заводит руку назад; кадр броска — первый кадр `f11_throw`
//   (рука хлёстом вперёд, выпад); дальше выбирает цепь на себя, пока крюк не
//   вернулся (цепь и крюк в полёте рисует зона `f11_hook`);
// - `f11_reel` 0,45 с (попал — тянет героя): рывок цепи, замах саблей; удар —
//   в конце, кадр контакта — первый кадр `recover`, тот же, что у `f11_slash`;
// - `f11_slash` 0,55 с: замах из-за плеча, задержка, рубящий наискось; кадр
//   контакта — первый кадр `recover`, проводка, отдача, возврат;
// - бег — шаги по пройденному пути, полы и шарф отстают; смерть 0,85 с —
//   навзничь, сабля и крюк падают, шарф опускается последним.

import { registerMobPainter, registerMobWarm, registerZonePainter } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import { BOARDER } from './f11-brains';
import {
  F3,
  FPS,
  PI,
  Rig,
  TAU,
  alpha,
  arm,
  camSide,
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
  vsub,
  visOf,
  warmAll,
  yawN,
} from './f11-mobkit';
import type { Key, Pic, RigOut, V3 } from './f11-mobkit';
import type { Mat } from './f15-rig';

const COAT = tn('#4a1e1e', '#7a2e28', '#a8443a', '#c8664e');
const PANTS = tn('#2e2a26', '#4a4238', '#6a5e4e', '#8a7c66');
const SCARF = tn('#a86a10', '#e0a020', '#f4c84a', '#ffe890');
const LEATHER = tn('#3a2616', '#5a3a22', '#7a5230', '#9a6e44');
const SKIN = tn('#9a6248', '#c8866a', '#e8ae8e', '#f8d2b4');
const SAIL = tn('#6a2a20', '#9a4430', '#c06a48', '#e09a70');
const PLANK = tn('#5e3e22', '#8a6038', '#aa7c4a', '#c89a62');
const ROPE = tn('#7a6440', '#a8905c', '#cdb57a', '#e6d29a');
const IRON = tn('#26282e', '#3c4048', '#585e6a', '#7c8290');
const STEELB = tn('#5c6470', '#9aa4b0', '#cfd6de', '#ffffff');
const GOLD = tn('#8a6420', '#c29434', '#e4bb52', '#fbe39a');
const GOGGLE = tn('#1e5a5e', '#3aa8b0', '#7af6ff', '#e0ffff');
const CHAIN = hx('#c4c9d2');
const HOOK = tn('#3c4048', '#6a717e', '#a8b0bc', '#eef2f6');
const AIRL = hx('#eaf6ff');
const SMEAR_C = hx('#e8eef6', 200);
const DUST = [hx('#8a7a70'), hx('#a8988c'), hx('#6a5a50')];

// ---- Поза --------------------------------------------------------------------

interface BoO {
  fwd: number;
  lift: number;
  crouch: number;
  lean: number;
  twist: number;
  roll: number;
  head: number;
  hturn: number;
  /** Шаг: фаза, доля, длина шага (ед.); стойка шире; ноги болтаются (в полёте). */
  ph: number;
  step: number;
  stride: number;
  wide: number;
  dangle: number;
  /** Навзничь 0…1. */
  back: number;
  /** Кисти в рамке стоп (f, s, высота); сабля — направление (null — выронил). */
  hR: V3;
  bR: V3 | null;
  hL: V3;
  /** Крюк (рамка стоп) — висит на цепи от левой кисти; null — улетел (рисует зона). */
  hk: V3 | null;
  /** Цепь из кисти вперёд — к летящему крюку. */
  chain: boolean;
  /** Планер: 0 — раскрыт, 1 — сложен за спиной; тангаж и крен крыла. */
  fold: number;
  wp: number;
  wr: number;
  /** Полы куртки отстают (вперёд-назад), шарф — фаза волны и сила. */
  tail: number;
  sc: number;
  sw: number;
}

const HIP = 9.0;
const LEG = 4.8;
const ARM1 = 3.8;
const ARM2 = 3.6;
const SAB = 7.2;

const REST_R: V3 = [1.6, 3.6, 6.6];
const REST_B: V3 = [0.65, 0.3, -0.7];
const REST_L: V3 = [1.4, -3.4, 7.0];
const hang = (h: V3): V3 => [h[0] + 0.3, h[1] - 0.2, h[2] - 3.4];

const B0: BoO = {
  fwd: 0,
  lift: 0,
  crouch: 0.1,
  lean: 0.08,
  twist: 0.15,
  roll: 0,
  head: 0,
  hturn: 0,
  ph: 0,
  step: 0,
  stride: 8,
  wide: 0.35,
  dangle: 0,
  back: 0,
  hR: REST_R,
  bR: REST_B,
  hL: REST_L,
  hk: hang(REST_L),
  chain: false,
  fold: 1,
  wp: 0,
  wr: 0,
  tail: 0,
  sc: 0,
  sw: 0.4,
};

/** Таз и корпус по позе (B — рамка курса у стоп). */
function bodyOf(B: F3, o: BoO): { P: F3; T: F3 } {
  const hz = HIP - o.crouch * 2.4 + o.lift - o.back * 6.6;
  const P = B.at(o.fwd - o.back * 1.6, 0, hz).roll(o.roll);
  const T = P.at(0, 0, 0.8)
    .turn(o.twist)
    .pitch(o.lean - o.back * 1.35);
  return { P, T };
}
const handFrame = (B: F3, o: BoO) => B.at(o.fwd, 0, o.lift - o.crouch * 2.4);

/** Сабля: кисть, основание клинка, середина (изгиб), острие. */
function saberOf(B: F3, W: F3, o: BoO): [V3, V3, V3, V3] | null {
  if (!o.bR) return null;
  const hand = W.p(o.hR[0], o.hR[1], o.hR[2]);
  const d = vnorm(B.v(o.bR[0], o.bR[1], o.bR[2]));
  const up: V3 = Math.abs(d[2]) > 0.9 ? B.v(-1, 0, 0) : [0, 0, 1];
  const c = vnorm(vsub(up, vmul(d, d[0] * up[0] + d[1] * up[1] + d[2] * up[2])));
  const b0 = vadd(hand, vmul(d, 0.8));
  const mid = vadd(b0, vmul(d, SAB * 0.55));
  const tip = vadd(mid, vmul(vnorm(vadd(d, vmul(c, 0.32))), SAB * 0.45));
  return [hand, b0, mid, tip];
}

/** Планер: нос, концы крыльев, хвост — между раскрытым и сложенным за спиной. */
function wingOf(B: F3, T: F3, o: BoO): [V3, V3, V3, V3] {
  const k = o.fold;
  const Wg = B.at(o.fwd + 0.6, 0, HIP + 13.4 + o.lift)
    .pitch(o.wp)
    .roll(o.wr);
  const open: V3[] = [
    Wg.p(6, 0, 0.6),
    Wg.p(-3.2, -12.5, 0),
    Wg.p(-3.2, 12.5, 0),
    Wg.p(-4.6, 0, 0.4),
  ];
  const shut: V3[] = [
    T.p(-2.4, 0, 11.6),
    T.p(-3.0, -1.5, 4.4),
    T.p(-3.0, 1.5, 4.4),
    T.p(-2.6, 0, -1.6),
  ];
  const e = k < 0.5 ? 2 * k * k : 1 - 2 * (1 - k) * (1 - k);
  return [
    vlerp(open[0], shut[0], e),
    vlerp(open[1], shut[1], e),
    vlerp(open[2], shut[2], e),
    vlerp(open[3], shut[3], e),
  ];
}

function boarderRig(o: BoO, yaw: number): Rig {
  const r = new Rig();
  const B = F3.yaw(yaw);
  const cs = camSide(yaw);
  const { P, T } = bodyOf(B, o);
  const pants: Mat = { T: PANTS, spec: false };
  const coat: Mat = { T: COAT };
  const coatD: Mat = { T: COAT, bias: -0.15 };
  const lea: Mat = { T: LEATHER, spec: true };
  // Ноги: шаг по фазе, в полёте болтаются, навзничь — вперёд.
  for (const sd of [-1, 1]) {
    const hip = P.p(0, sd * 1.5, 0);
    const [off, rise] = gait(o.ph + (sd > 0 ? 0.5 : 0));
    let foot = B.p(
      o.fwd * 0.4 + off * o.stride * o.step + (sd < 0 ? o.wide * 1.5 : -o.wide * 1.2),
      sd * (1.8 + o.wide * 0.6),
      rise * 2.6 * o.step,
    );
    if (o.dangle > 0)
      foot = vlerp(foot, B.p(o.fwd - 1.4 + sd * 0.6 * Math.sin(o.sc), sd * 1.5, 0.9), o.dangle);
    if (o.back > 0) foot = vlerp(foot, B.p(o.fwd + 4.6 + sd * 0.8, sd * 2.2, 0.6), o.back);
    const near = sd === cs ? 0 : -0.15;
    leg(
      r,
      hip,
      foot,
      LEG,
      LEG,
      B.v(1, sd * 0.2, 0),
      [1.5, 1.2, 1.1],
      { ...pants, bias: near },
      vadd(foot, B.v(1.7, 0, 0)),
    );
    r.ball(vadd(foot, B.v(0.4, 0, 0.5)), 1.35, { ...lea, bias: near });
  }
  // Таз, куртка, ремень с пряжкой, моток верёвки.
  r.ell(P, [0, 0, 0.4], [1.8, 2.3, 1.6], pants);
  r.ell(T, [0, 0, 4.4], [2.2, 2.8, 4.3], coat);
  r.ell(T, [0.1, 0, 1.4], [2.3, 2.9, 0.6], lea);
  r.dot(T.p(2.4, 0, 1.4), GOLD[2], 0, 1, 0.5);
  r.ell(T, [0.4, -2.7, 1.0], [1.2, 0.7, 1.1], { T: ROPE });
  // Полы куртки: сзади и по бокам, отстают по инерции.
  const tl = o.tail;
  for (const sd of [-1, 1]) {
    const top0 = T.p(-1.2, sd * 2.6, 1.6);
    const top1 = T.p(1.4, sd * 2.4, 1.4);
    const low = (f: number, s: number): V3 => {
      const q = P.p(f - tl * 2.2, s, -4.4 + Math.abs(tl) * 1.2);
      return [q[0], q[1], Math.max(0.6, q[2])];
    };
    r.poly([top0, top1, low(1.6, sd * 2.6), low(-1.8, sd * 2.9)], sd === cs ? coat : coatD);
  }
  r.poly(
    [
      T.p(-1.9, -2.2, 1.6),
      T.p(-1.9, 2.2, 1.6),
      (() => {
        const q = P.p(-2.4 - tl * 2.6, 1.6, -4.6 + Math.abs(tl) * 1.4);
        return [q[0], q[1], Math.max(0.6, q[2])] as V3;
      })(),
      (() => {
        const q = P.p(-2.4 - tl * 2.6, -1.6, -4.6 + Math.abs(tl) * 1.4);
        return [q[0], q[1], Math.max(0.6, q[2])] as V3;
      })(),
    ],
    coatD,
  );
  // Шарф на шее и концы по ветру.
  r.ell(T, [0.2, 0, 8.8], [1.9, 2.2, 0.9], { T: SCARF });
  const s0 = T.p(-1.5, 0.7, 8.8);
  const s1 = vadd(s0, B.v(-2.6 - o.sw * 1.4, 0.9 * Math.sin(o.sc), -0.6 - (1 - o.sw) * 1.4));
  const s2 = vadd(s1, B.v(-2.4 - o.sw * 1.2, 1.2 * Math.sin(o.sc - 1.3), -0.4 - (1 - o.sw) * 1.6));
  r.cap(s0, s1, 0.75, 0.6, { T: SCARF });
  r.cap(s1, s2, 0.6, 0.4, { T: SCARF, bias: -0.1 });
  // Голова: лицо, кожаный шлем, очки.
  const Hd = T.at(0.4, 0, 11.0).turn(o.hturn).pitch(o.head);
  r.ball(Hd.p(0.2, 0, -0.2), 2.4, { T: SKIN });
  r.ell(Hd, [-0.3, 0, 0.6], [2.7, 2.7, 2.2], lea, (q) => q[0] > 0.45 && q[2] < 0.25);
  for (const sd of [-1, 1]) r.ball(Hd.p(2.0, sd * 0.95, 0.5), 0.75, { T: GOGGLE, spec: true });
  r.cap(Hd.p(2.0, -0.95, 0.5), Hd.p(2.0, 0.95, 0.5), 0.3, 0.3, { T: LEATHER });
  r.dot(Hd.p(2.35, 0, -1.2), SKIN[0], 0, 1, 0);
  r.eye = Hd.p(2.3, cs * 0.95, 0.5);
  // Планер: сложенный — за спиной, раскрытый — над головой.
  const [nose, tL, tR, tail] = wingOf(B, T, o);
  r.poly([nose, tL, tail], { T: SAIL, bias: 0.05 });
  r.poly([nose, tR, tail], { T: SAIL, bias: 0.05 });
  r.cap(nose, tail, 0.45, 0.4, { T: PLANK });
  if (o.fold < 0.9) {
    // Распорки к поясу.
    r.cap(vlerp(nose, tail, 0.45), T.p(-1.6, 0, 8.0), 0.3, 0.3, { T: PLANK });
    r.cap(vlerp(tL, tR, 0.5), vlerp(tL, nose, 0.4), 0.25, 0.25, { T: PLANK });
    r.cap(vlerp(tL, tR, 0.5), vlerp(tR, nose, 0.4), 0.25, 0.25, { T: PLANK });
  } else r.cap(T.p(-2.0, -1.8, 7.6), T.p(-2.0, 1.8, 7.6), 0.35, 0.35, { T: LEATHER });
  // Руки, сабля, крюк.
  const W = handFrame(B, o);
  const sab = saberOf(B, W, o);
  const hR = W.p(o.hR[0], o.hR[1], o.hR[2]);
  const hL = W.p(o.hL[0], o.hL[1], o.hL[2]);
  for (const sd of [-1, 1]) {
    const sh = T.p(0, sd * 3.2, 7.8);
    const hand = sd > 0 ? hR : hL;
    arm(r, sh, hand, ARM1, ARM2, T.v(-0.5, sd, -0.3), [1.1, 0.95, 0.85], sd === cs ? coat : coatD);
    r.ball(hand, 0.95, lea);
  }
  if (sab) {
    const [, b0, mid, tip] = sab;
    const d = vnorm(vsub(b0, hR));
    const sx = vnorm([-d[1], d[0], 0.0001]);
    r.cap(vadd(b0, vmul(sx, 1.2)), vadd(b0, vmul(sx, -1.2)), 0.35, 0.35, { T: GOLD, spec: true });
    r.cap(b0, mid, 0.62, 0.5, { T: STEELB, spec: true });
    r.cap(mid, tip, 0.5, 0.12, { T: STEELB, spec: true });
  }
  if (o.hk) {
    const k = W.p(o.hk[0], o.hk[1], o.hk[2]);
    r.line(hL, k, CHAIN, 0, 0.3);
    r.ball(k, 0.85, { T: HOOK, spec: true });
    const dn = vnorm(vsub(k, hL));
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU;
      const sp: V3 = vnorm(vadd(dn, [Math.cos(a) * 0.9, Math.sin(a) * 0.9, 0.2]));
      r.cap(k, vadd(k, vmul(sp, 1.9)), 0.38, 0.18, { T: HOOK, spec: true });
    }
  }
  if (o.chain) r.line(hL, vadd(hL, B.v(7, 0, -1.2)), CHAIN, 0, 0.3);
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

function idleO(f: number): BoO {
  // Стоит вполоборота: дышит, шарф треплет ветер, крюк покачивается.
  const a = (f / 8) * TAU;
  const o: BoO = { ...B0 };
  o.lift = 0.18 * Math.sin(a);
  o.sc = a;
  o.sw = 0.45;
  o.hR = [REST_R[0], REST_R[1], REST_R[2] + 0.25 * Math.sin(a - 0.8)];
  o.hL = [REST_L[0], REST_L[1], REST_L[2] + 0.25 * Math.sin(a - 0.8)];
  o.hk = [o.hL[0] + 0.3 + 0.7 * Math.sin(a - 1.4), o.hL[1] - 0.2, o.hL[2] - 3.4];
  o.tail = 0.1 * Math.sin(a - 1.2);
  return o;
}

function runO(f: number): BoO {
  // Бег: 8 кадров на 1,3 клетки, руки в ход, полы и шарф полощутся.
  const a = (f / 8) * TAU;
  const o: BoO = { ...B0, ph: f / 8, step: 1, stride: 10, wide: 0 };
  o.lift = -0.7 * Math.cos(2 * a) - 0.3;
  o.lean = 0.3;
  o.twist = 0.1 * Math.cos(a);
  o.roll = 0.04 * Math.sin(a);
  o.hR = [REST_R[0] + 2.2 * Math.cos(a), REST_R[1], REST_R[2] + 1.2 + 0.8 * Math.cos(a)];
  o.bR = [0.4, 0.2, -0.85];
  o.hL = [REST_L[0] - 2.4 * Math.cos(a), REST_L[1], REST_L[2] + 1.2 - 0.8 * Math.cos(a)];
  o.hk = [o.hL[0] - 1.0 - 0.6 * Math.cos(a - 0.9), o.hL[1], o.hL[2] - 3.1];
  o.tail = 0.85 + 0.25 * Math.sin(2 * a);
  o.sc = a * 2;
  o.sw = 1;
  o.head = -0.1;
  return o;
}

const AIM_T = BOARDER.aim;
/** Оборотов крюка к мигу `T` прицела (крутит всё быстрее). */
const revs = (T: number) => 0.9 * T + 2.6 * T * T;
const SPIN_C: V3 = [0.4, -1.2, 19.6];

function aimO(T: number): BoO {
  const o: BoO = { ...B0 };
  const k = T / AIM_T;
  o.wide = trk(T, [
    [0, 0.35],
    [0.18, 0.7],
  ]);
  o.crouch = trk(T, [
    [0, 0.1],
    [0.2, 0.3],
    [0.62, 0.3],
    [0.75, 0.42],
  ]);
  o.twist = trk(T, [
    [0, 0.15],
    [0.25, -0.15],
    [0.6, -0.15],
    [0.75, -0.55, easeIn],
  ]);
  o.lean = trk(T, [
    [0, 0.08],
    [0.25, -0.04],
    [0.62, -0.04],
    [0.75, -0.14],
  ]);
  const th = revs(T) * TAU;
  // Кисть над головой ходит малым кругом; в конце — заведена назад.
  const back = sstep(0.6, 0.75, T);
  const hc: V3 = [SPIN_C[0] - back * 3.4, SPIN_C[1] - back * 0.8, SPIN_C[2] - 2.4 - back * 1.6];
  o.hL = k3(T, [
    [0, REST_L],
    [0.16, [hc[0] + Math.cos(th) * 0.8, hc[1] + Math.sin(th) * 0.8, hc[2]], easeOut],
  ]);
  if (T > 0.16) o.hL = [hc[0] + Math.cos(th) * 0.8, hc[1] + Math.sin(th) * 0.8, hc[2]];
  const R = 4.6 * (0.6 + 0.4 * clamp01(k * 2));
  const hk: V3 = [hc[0] + Math.cos(th) * R, hc[1] + Math.sin(th) * R, hc[2] + 0.9];
  o.hk = T < 0.16 ? vlerp(hang(REST_L), hk, T / 0.16) : hk;
  o.hR = [REST_R[0] - 0.4, REST_R[1] + 0.3, REST_R[2]];
  o.head = -0.18;
  o.sc = T * 14;
  o.sw = 0.7;
  o.tail = 0.15 * Math.sin(T * 12);
  return o;
}

const THROW_HAND: V3 = [5.4, -1.0, 9.2];

function throwO(T: number): BoO {
  // Бросок: рука хлёстом вперёд, выпад, проводка.
  const o: BoO = { ...B0, hk: null, chain: true };
  o.fwd = trk(T, [
    [0, 0.4],
    [0.08, 1.3, easeOut],
    [0.2, 0.9],
  ]);
  o.twist = trk(T, [
    [0, 0.2],
    [0.08, 0.45, easeOut],
    [0.2, 0.3],
  ]);
  o.lean = trk(T, [
    [0, 0.2],
    [0.08, 0.34],
    [0.2, 0.2],
  ]);
  o.crouch = 0.4;
  o.wide = 0.8;
  o.hL = k3(T, [
    [0, [3.2, -1.6, 13.4]],
    [0.06, THROW_HAND, easeOut],
    [0.2, [4.6, -1.4, 8.8]],
  ]);
  o.hR = [REST_R[0] - 0.6, REST_R[1] + 0.4, REST_R[2]];
  o.sc = T * 14;
  o.sw = 0.8;
  o.tail = trk(T, [
    [0, 0.2],
    [0.1, -0.5],
    [0.2, -0.2],
  ]);
  return o;
}

function haulO(f: number): BoO {
  // Выбирает цепь: левая тянет к себе и снова вперёд, корпус откинут.
  const a = (f / 8) * TAU;
  const o: BoO = { ...B0, hk: null, chain: true };
  const pull = 0.5 - 0.5 * Math.cos(a);
  o.fwd = 0.5;
  o.crouch = 0.35;
  o.wide = 0.8;
  o.lean = -0.08 - 0.06 * pull;
  o.twist = 0.25 - 0.4 * pull;
  o.hL = [4.8 - 3.8 * pull, -1.4 - 1.2 * pull, 8.8 - 0.4 * pull];
  o.hR = [REST_R[0] - 0.6, REST_R[1] + 0.4, REST_R[2] + 0.2 * pull];
  o.sc = a;
  o.sw = 0.6;
  o.tail = 0.12 * Math.sin(a);
  return o;
}

const SL_T = BOARDER.slash;
const WIND_R: V3 = [-1.4, 3.8, 15.2];
const WIND_B: V3 = [-0.4, 0.35, 0.85];
const HIT_R: V3 = [5.2, 0.6, 8.8];
const HIT_B: V3 = [0.85, -0.45, -0.25];
const FOL_R: V3 = [2.4, -3.8, 6.0];
const FOL_B: V3 = [0.1, -0.92, -0.38];

/** Рубящий: τ — время от начала замаха длиной `S` (дальше — `recover`). */
function slashO(tau: number, S: number, reel: boolean): BoO {
  const o: BoO = { ...B0 };
  const f = Math.floor(tau * FPS);
  const w0 = reel ? 0.16 : 0;
  const w1 = reel ? 0.34 : 0.24;
  o.twist = trk(tau, [
    [w0, reel ? -0.4 : 0.15],
    [w1, 0.55, easeOut],
    [S - 0.08, 0.55],
    [S, -0.1, easeIn],
    [S + 0.1, -0.6, easeOut],
    [S + 0.3, -0.5],
    [S + 0.7, 0.15],
  ]);
  o.lean = trk(tau, [
    [w0, reel ? -0.24 : 0.08],
    [w1, -0.1],
    [S - 0.08, -0.1],
    [S, 0.3, easeIn],
    [S + 0.12, 0.36],
    [S + 0.7, 0.08],
  ]);
  o.fwd = trk(tau, [
    [w0, reel ? -0.6 : 0],
    [w1, -0.5],
    [S - 0.08, -0.5],
    [S, 1.0, easeIn],
    [S + 0.12, 1.3],
    [S + 0.7, 0],
  ]);
  o.crouch = trk(tau, [
    [w0, reel ? 0.4 : 0.1],
    [w1, 0.3],
    [S, 0.4],
    [S + 0.12, 0.5],
    [S + 0.7, 0.1],
  ]);
  o.wide = trk(tau, [
    [w0, reel ? 0.8 : 0.35],
    [w1, 0.6],
    [S, 1.0, easeIn],
    [S + 0.4, 0.95],
    [S + 0.7, 0.35],
  ]);
  o.hR = k3(tau, [
    [w0, REST_R],
    [w1, WIND_R, easeOut],
    [S - 0.08, WIND_R],
    [S, HIT_R, easeIn],
    [S + 0.1, FOL_R, easeOut],
    [S + 0.3, FOL_R],
    [S + 0.7, REST_R],
  ]);
  o.bR = k3(tau, [
    [w0, REST_B],
    [w1, WIND_B, easeOut],
    [S - 0.08, WIND_B],
    [S, HIT_B, easeIn],
    [S + 0.1, FOL_B, easeOut],
    [S + 0.3, FOL_B],
    [S + 0.7, REST_B],
  ]);
  o.hL = k3(tau, [
    [w0, reel ? [-1.0, -3.4, 9.4] : REST_L],
    [w1, [3.4, -2.6, 10.2]],
    [S - 0.08, [3.4, -2.6, 10.2]],
    [S, [0.2, -3.8, 8.6], easeIn],
    [S + 0.7, REST_L],
  ]);
  o.hk = tau < S + 0.3 ? null : hang(o.hL);
  if (reel && tau < w0) {
    // Рывок цепи: левая рвёт назад, корпус откинут.
    const k = easeOut(tau / w0);
    o.hL = vlerp([3.8, -1.6, 8.8], [-1.0, -3.4, 9.4], k);
    o.lean = -0.24 * k;
    o.twist = -0.4 * k;
    o.fwd = -0.6 * k;
    o.crouch = 0.4;
    o.wide = 0.8;
  }
  if (reel && tau < S + 0.05) o.chain = tau < w1;
  if (tau > w1 + 0.02 && tau < S - 0.08) {
    const s = f % 2 ? 1 : -1;
    o.hR = [o.hR[0] + 0.2 * s, o.hR[1], o.hR[2] + 0.15 * s];
  }
  o.sc = tau * 12;
  o.sw = 0.6;
  o.tail = trk(tau, [
    [S - 0.05, 0.2],
    [S + 0.1, -0.6],
    [S + 0.35, 0.2],
    [S + 0.7, 0],
  ]);
  return o;
}

function flinchO(f: number): BoO {
  const k = [1, 0.85, 0.55, 0.25, 0][Math.min(4, f)];
  const o: BoO = { ...B0 };
  o.lean = 0.08 - 0.4 * k;
  o.twist = 0.15 + 0.35 * k;
  o.head = -0.35 * k;
  o.fwd = -0.8 * k;
  o.crouch = 0.1 + 0.3 * k;
  o.hR = [REST_R[0] - 1.4 * k, REST_R[1] + 0.8 * k, REST_R[2] + 2 * k];
  o.hL = [REST_L[0] - 1.6 * k, REST_L[1] - 0.8 * k, REST_L[2] + 2.4 * k];
  o.hk = [o.hL[0] + 1.2 * k, o.hL[1], o.hL[2] - 3.2];
  o.tail = 0.5 * k;
  o.sc = f;
  return o;
}

function dieO(T: number): BoO {
  // Навзничь: отбросило, ноги подкосились, рухнул на спину, сабля выпала.
  const o: BoO = { ...B0 };
  o.lean = trk(T, [
    [0, 0.08],
    [0.1, -0.45, easeOut],
    [0.3, -0.3],
  ]);
  o.head = trk(T, [
    [0, 0],
    [0.1, -0.4],
    [0.5, -0.1],
    [0.62, 0.25],
  ]);
  o.crouch = trk(T, [
    [0.1, 0.1],
    [0.3, 0.6],
  ]);
  o.back = trk(T, [
    [0.25, 0],
    [0.55, 1, easeIn],
  ]);
  o.fwd = trk(T, [
    [0, 0],
    [0.12, -1.2, easeOut],
    [0.55, -1.8],
  ]);
  o.hR = k3(T, [
    [0.1, [REST_R[0] - 1, REST_R[1] + 1.4, REST_R[2] + 4]],
    [0.55, [-3.2, 6.2, 0.8]],
  ]);
  o.hL = k3(T, [
    [0.1, [REST_L[0] - 1, REST_L[1] - 1.4, REST_L[2] + 4]],
    [0.55, [-3.0, -6.0, 0.8]],
  ]);
  o.bR = T < 0.2 ? REST_B : null;
  o.hk = T < 0.2 ? hang(o.hL) : null;
  o.tail = trk(T, [
    [0, 0],
    [0.12, 0.8],
    [0.55, -0.6],
    [0.7, 0],
  ]);
  o.sc = T * 10;
  o.sw = trk(T, [
    [0.3, 0.8],
    [0.8, 0],
  ]);
  return o;
}

const LAND_T = BOARDER.land;
/** Прилёт: к 0,76 — висит под крылом, подрыв носа, отпустил, сел к 0,85. */
function landO(T: number): BoO {
  const o: BoO = { ...B0, fold: 0, crouch: 0, lean: 0.02, twist: 0, wide: 0, hk: null };
  o.dangle = 1 - sstep(0.74, 0.84, T);
  o.sc = T * 16;
  o.sw = 1;
  o.tail = 0.9;
  o.wp = trk(T, [
    [0, -0.06],
    [0.66, -0.1],
    [0.78, -0.3, easeOut],
    [0.86, -0.2],
  ]);
  o.wr = 0.06 * Math.sin(T * 7);
  o.lean = trk(T, [
    [0.66, 0.02],
    [0.78, -0.22],
    [0.86, 0.35, easeIn],
    [0.95, 0.4],
  ]);
  o.crouch = trk(T, [
    [0.82, 0],
    [0.88, 1.0, easeOut],
    [0.95, 0.85],
  ]);
  o.fold = trk(T, [
    [0.86, 0],
    [0.95, 0.25],
  ]);
  // Руки на распорках крыла; приземлившись — упор в землю.
  const bar = (sd: number): V3 => [1.4, sd * 3.6, 19.6];
  o.hR = k3(T, [
    [0.82, bar(1)],
    [0.9, [3.0, 3.8, 5.6], easeOut],
  ]);
  o.hL = k3(T, [
    [0.82, bar(-1)],
    [0.9, [3.0, -3.6, 5.8], easeOut],
  ]);
  o.bR = [0.2, 0.75, -0.6];
  o.hk = T > 0.9 ? hang(o.hL) : null;
  return o;
}

function getupO(T: number): BoO {
  // После прилёта: крылья складываются за спину, встаёт, крюк в руку.
  const o: BoO = { ...B0 };
  o.fold = trk(T, [
    [0, 0.25],
    [0.3, 1, easeOut],
  ]);
  o.crouch = trk(T, [
    [0, 0.85],
    [0.22, 0.85],
    [0.5, 0.1],
  ]);
  o.lean = trk(T, [
    [0, 0.4],
    [0.22, 0.35],
    [0.5, 0.08],
  ]);
  o.twist = trk(T, [
    [0.3, 0],
    [0.6, 0.15],
  ]);
  o.hR = k3(T, [
    [0.2, [3.0, 3.8, 5.6]],
    [0.5, REST_R],
  ]);
  o.bR = REST_B;
  o.hL = k3(T, [
    [0.2, [3.0, -3.6, 5.8]],
    [0.5, REST_L],
  ]);
  o.hk = hang(o.hL);
  o.head = trk(T, [
    [0.2, 0.25],
    [0.5, -0.1],
    [0.7, 0],
  ]);
  o.sc = T * 10;
  o.sw = trk(T, [
    [0, 1],
    [0.6, 0.45],
  ]);
  o.tail = trk(T, [
    [0, 0.6],
    [0.4, -0.2],
    [0.7, 0],
  ]);
  return o;
}

function boPose(anim: string, f: number): BoO {
  const t = (f + 0.5) / FPS;
  const t0 = f / FPS + 0.004;
  switch (anim) {
    case 'idle':
      return idleO(f);
    case 'run':
      return runO(f);
    case 'aim':
      return aimO(Math.min(t, AIM_T - 0.005));
    case 'throw':
      return throwO(t0);
    case 'haul':
      return haulO(f);
    case 'reel':
      return slashO(Math.min(t, BOARDER.reel - 0.005), BOARDER.reel, true);
    case 'slash':
      return slashO(Math.min(t, SL_T - 0.005), SL_T, false);
    case 'slashf':
      return slashO(SL_T + t0, SL_T, false);
    case 'flinch':
      return flinchO(f);
    case 'die':
      return dieO(t);
    case 'land':
      return landO(Math.min(t, LAND_T - 0.005));
    case 'getup':
      return getupO(t0);
  }
  return { ...B0 };
}

// ---- Кадр --------------------------------------------------------------------

const BO = kindOf('boarder', 64, 64, 32, 44, 1500);

/** След сабли по треку удара. */
function trail(anim: string, f: number, d: number, n: number): { tips: V3[]; bases: V3[] } {
  const B = F3.yaw(yawN(d));
  const tips: V3[] = [];
  const bases: V3[] = [];
  const reel = anim === 'reel';
  const S = reel ? BOARDER.reel : SL_T;
  const tau0 = anim === 'slashf' ? SL_T + f / FPS + 0.004 : (f + 0.5) / FPS;
  for (let i = n; i >= 0; i--) {
    const tau = tau0 - i / FPS;
    if (tau < 0) continue;
    const o = slashO(tau, S, reel && tau < S);
    const s = saberOf(B, handFrame(B, o), o);
    if (!s) continue;
    tips.push(s[3]);
    bases.push(vlerp(s[1], s[3], 0.4));
  }
  return { tips, bases };
}

const boPic = (anim: string, f: number, d: number): Pic => {
  const g = boPose(anim, f);
  const yaw = yawN(d);
  return draw(BO, boarderRig(g, yaw), (o: RigOut, P2) => {
    const sw =
      (anim === 'slash' && f >= 11) || (anim === 'reel' && f >= 9) || (anim === 'slashf' && f <= 2)
        ? 3
        : 0;
    if (sw) {
      const { tips, bases } = trail(anim, f, d, sw);
      smear(o, tips.map(P2), bases.map(P2), SMEAR_C, 0.4);
    }
    const B = F3.yaw(yaw);
    if (anim === 'aim' && f >= 8) {
      // Смаз круга крюка — пунктир по орбите, гуще к броску.
      const W = handFrame(B, g);
      const T = (f + 0.5) / FPS;
      const back = sstep(0.6, 0.75, T);
      const hc: V3 = [SPIN_C[0] - back * 3.4, SPIN_C[1] - back * 0.8, SPIN_C[2] - 2.4 - back * 1.6];
      const R = 4.6;
      const th = revs(T) * TAU;
      const n = 6 + Math.min(6, f - 8);
      for (let i = 1; i <= n; i++) {
        const a = th - i * 0.32;
        const q = P2(W.p(hc[0] + Math.cos(a) * R, hc[1] + Math.sin(a) * R, hc[2] + 0.9));
        spark2(o, q[0], q[1], alpha(AIRL, 0.95 * (1 - i / (n + 1))), 0);
      }
    }
    if (anim === 'land' && f <= 18) {
      // Полосы ветра за концами крыльев.
      const { T } = bodyOf(B, g);
      const [, tL, tR] = wingOf(B, T, g);
      for (const tp of [tL, tR])
        for (let j = 1; j <= 3; j++) {
          const q = P2(vadd(tp, B.v(-1.6 * j, 0, 0)));
          spark2(o, q[0], q[1], alpha(AIRL, 0.6 * (1 - j / 4)), 0);
        }
    }
    if (anim === 'land' && f >= 20) {
      const q = P2(B.p(0.5, 0, 0));
      spray(o.p, q[0], q[1], 8, 8, (f - 19) / 3, 61, DUST, 0, 2);
    }
    if (anim === 'die' && f >= 13 && f <= 16) {
      const q = P2(B.p(-1.6, 0, 0));
      spray(o.p, q[0], q[1], 7, 8, (f - 12) / 4, 67, DUST, 0, 2);
    }
    if (anim === 'die' && f >= 4) {
      // Выпавшая сабля и крюк лежат у рук.
      const sab = P2(B.p(-2.0, 6.8, 0.3));
      const tipq = P2(B.p(4.6, 7.8, 0.3));
      const n = 8;
      for (let i = 0; i <= n; i++) {
        const x = sab[0] + ((tipq[0] - sab[0]) * i) / n;
        const y = sab[1] + ((tipq[1] - sab[1]) * i) / n;
        o.p.set(x, y, i < 2 ? GOLD[2] : STEELB[i % 3 ? 2 : 1]);
      }
      const hq = P2(B.p(-1.0, -7.2, 0.3));
      o.p.set(hq[0], hq[1], IRON[2]);
      o.p.set(hq[0] + 1, hq[1], IRON[1]);
      o.p.set(hq[0], hq[1] - 1, IRON[3]);
    }
  });
};

const TECH = new Set(['f11_aimhook', 'f11_slash', 'f11_reel', 'f11_throw', 'f11_land']);

registerMobPainter('f11_boarder', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = pose.t;
  const now = pose.now || 0;
  const id = m.id ?? 0;
  const v = visOf(m, pose, TECH.has(md) ? (m.face ?? 0) : headOf(m, 0.5), md === 'chase' ? 10 : 16);
  const d = dirN(v.yaw);
  const ex: Partial<MobFrame> = { shadow: 6 };
  let anim = 'idle';
  let f = 0;
  let dark = 0;
  if (md === 'dying') {
    f = fi(t, 20);
    anim = 'die';
    ex.linger = 0.85;
    ex.alpha = 1 - sstep(0.7, 0.85, t);
    ex.still = true;
    const th = clamp01((t - 0.52) / 0.1);
    if (th > 0 && th < 1) {
      ex.sx = 1 + 0.08 * Math.sin(PI * th);
      ex.sy = 1 - 0.1 * Math.sin(PI * th);
    }
  } else if (md === 'f11_land') {
    f = fi(t, 22);
    anim = 'land';
    ex.still = true;
    // Подлёт с неба: сдвиг кадра к месту посадки, высота — вверх по экрану.
    const k = clamp01(t / LAND_T);
    const a = m.data?.from ?? (m.face ?? 0) + PI;
    const D = 70 * (1 - k) ** 1.15;
    const h = k < 0.78 ? 4.4 + 16 * (1 - k / 0.78) : 4.4 * (1 - clamp01((k - 0.78) / 0.105) ** 2);
    ex.dx = Math.cos(a) * D;
    ex.dy = Math.sin(a) * D - h;
    ex.shadow = 2 + 4 * k;
  } else if (md === 'f11_aimhook') {
    f = fi(t, 17);
    anim = 'aim';
    ex.still = true;
  } else if (md === 'f11_throw') {
    if (t < 0.2) {
      f = fi(t, 4);
      anim = 'throw';
    } else {
      f = Math.floor((t - 0.2) * FPS) % 8;
      anim = 'haul';
    }
    ex.still = true;
  } else if (md === 'f11_reel') {
    f = fi(t, 10);
    anim = 'reel';
    ex.still = true;
  } else if (md === 'f11_slash') {
    f = fi(t, 12);
    anim = 'slash';
    ex.still = true;
  } else if (md === 'recover' && v.prev === 'f11_land') {
    f = fi(t, 16);
    anim = 'getup';
    ex.still = true;
  } else if (
    md === 'recover' &&
    (v.prev === 'f11_slash' || v.prev === 'f11_reel' || v.prev === '')
  ) {
    f = fi(t, 16);
    anim = 'slashf';
    ex.still = true;
    if (f <= 1) {
      ex.sx = 1.05;
      ex.sy = 0.95;
    }
  } else if (md === 'stun' || hurtAge(v, now) < 0.2) {
    f = fi(md === 'stun' && hurtAge(v, now) > 0.2 ? t : hurtAge(v, now), 4);
    anim = 'flinch';
  } else if (moving(m, 0.6)) {
    f = Math.floor((v.dist / 1.3) * 8) % 8;
    anim = 'run';
  } else {
    f = Math.floor((now + hash(id, 7) * 4) * 5) % 8;
    anim = 'idle';
  }
  if (md === 'emerge') dark = 3 - Math.min(3, Math.floor(clamp01(t / 0.45) * 4));
  if (md !== 'dying' && md !== 'f11_land') hurtFx(v, now, 1.3, ex);
  return put(
    frameOf(BO, anim, f, d, pose, (dd) => boPic(anim, f, dd), dark),
    ex,
  );
});

registerMobWarm('f11_boarder', function* () {
  yield* warmAll(
    BO,
    [
      ['run', 8],
      ['idle', 8],
      ['aim', 18],
      ['throw', 5],
      ['haul', 8],
      ['slash', 13],
      ['reel', 11],
      ['slashf', 17],
      ['flinch', 5],
      ['die', 21],
      ['getup', 17],
    ],
    boPic,
  );
  // Прилёт — только с четырёх сторон неба.
  yield* warmAll(BO, [['land', 23]], boPic, ['normal'], [0, 2, 4, 6]);
});

// Подлёт рисует сам абордажник (`f11_land`): зона планера только держит место.
registerZonePainter('f11_glider', () => true);
