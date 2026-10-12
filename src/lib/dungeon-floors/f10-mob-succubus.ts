// Суккуба (анимации мобов 10): сиреневая кожа, светлые волосы, рожки,
// платье цвета вина, крылья летучей мыши, хвост с сердцем. Летает: движок
// поднимает кадр над тенью (`lift`), в техниках — без покачивания (`still`).
//
// Метроном — `f10-brains.ts` (`f10_succubus`, `SUCC`):
// - поцелуй `kiss` 0,62 с: ладонь к губам, крылья раскрыты во всю ширь, у
//   губ наливается розовое сердце (в `lit` — видно издалека, сквозь
//   темноту), задержка; кадр контакта — первый кадр `linger` (выстрел
//   `f10_heart`): рука выброшена вперёд, искры; дальше смех;
// - бросок `swoopAim` 0,38 → `swoop` (≤0,75): крылья вверх, сжалась —
//   пике со сложенными крыльями и шлейфом, когти вперёд; после — взмах вверх;
// - когти `claw` 0,5: рука с когтями вверх-назад, корпус скручен, задержка;
//   контакт — первый кадр `linger`: удар наискось со следом;
// - смерть 0,85 с: хватается за грудь, крылья опадают, падает на пол,
//   рассыпается лепестками.

import { registerMobPainter, registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import {
  F3,
  FPS,
  KRig,
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
  hash,
  headOf,
  hurtAge,
  hurtFx,
  hx,
  kindOf,
  leg,
  litOn,
  moving,
  smear,
  spark2,
  spray,
  sstep,
  tn,
  trk,
  vadd,
  visOf,
  vlerp,
  vmul,
  warmAll,
  yawN,
} from './f10-mobs';
import type { Pic, RGBA, RigOut, V3 } from './f10-mobs';
import type { Mat } from './f15-rig';

const SKIN = tn('#5a3458', '#a06c9a', '#d6a8d0', '#f8e2f2');
const HAIR = tn('#5a4a6a', '#9a88b0', '#d0c4e0', '#f4eefa');
const DRESS = tn('#1a0610', '#420c20', '#6e1634', '#a82850');
const WING = tn('#2a0a1e', '#521634', '#7e2450', '#b43c74');
const BONE = tn('#3a1a2c', '#6a2c48', '#94405e', '#c05a80');
const HORN = tn('#1a0608', '#3a0c12', '#6a1a22', '#a0303a');
const LIP = hx('#ff5aa0');
const EYE = hx('#ff70d0');
const HEART: RGBA[] = [hx('#8a1040'), hx('#e0306a'), hx('#ff7aa8'), hx('#ffd0e0')];
const PETAL: RGBA[] = [hx('#e0306a'), hx('#ff7aa8'), hx('#6e1634'), hx('#d6a8d0')];
const NAIL = hx('#ff4a8a');

interface SucO {
  fwd: number;
  /** Подъём корпуса над обычной высотой полёта (в рамке тела), пикс. */
  up: number;
  lean: number;
  twist: number;
  roll: number;
  head: number;
  hturn: number;
  /** Кисти в рамке корпуса (вперёд, вправо, вверх). */
  hR: V3;
  hL: V3;
  /** Крылья: взмах (−1 вверх … 1 вниз), раскрытие 0…1, отвод назад 0…1. */
  flap: number;
  spread: number;
  sweep: number;
  /** Ноги: отведены назад 0…1, поджаты 0…1. */
  legB: number;
  legK: number;
  /** Волосы и хвост отстают по ходу; хвост качается. */
  drag: number;
  tsw: number;
  /** Сердце у губ 0…1, когти 0…1, глаза закрыты 0…1, угасание 0…1. */
  heart: number;
  claw: number;
  shut: number;
  dim: number;
  /** На полу: 0 — в воздухе, 1 — лежит. */
  down: number;
}

const REST_R: V3 = [0.8, 2.3, 1.8];
const REST_L: V3 = [0.8, -2.3, 1.8];
/** Ладонь у губ — хихикает. */
const MOUTH: V3 = [3.0, 0.6, 6.8];

const S0: SucO = {
  fwd: 0,
  up: 0,
  lean: 0.08,
  twist: 0,
  roll: 0,
  head: 0,
  hturn: 0,
  hR: REST_R,
  hL: REST_L,
  flap: 0,
  spread: 0.85,
  sweep: 0.2,
  legB: 0.2,
  legK: 0.3,
  drag: 0.2,
  tsw: 0,
  heart: 0,
  claw: 0,
  shut: 0,
  dim: 0,
  down: 0,
};

const HIP_Z = 10.5;
/** Масштаб рига: фигура крупнее прежнего кадра 36×34 не стала, но тело читается. */
const SK = 1.5;

function wing(r: KRig, T: F3, sd: number, o: SucO): void {
  const root = T.p(-1.0, sd * 1.0, 5.2);
  const low = T.p(-0.9, sd * 0.9, 0.4);
  const sp = o.spread;
  const fl = o.flap;
  const sw = o.sweep;
  const out = T.v(0, sd, 0);
  const up = T.v(0, 0, 1);
  const back = T.v(-1, 0, 0);
  const at = (b: V3, o2: number, u: number, k: number): V3 =>
    vadd(b, vadd(vmul(out, o2), vadd(vmul(up, u), vmul(back, k))));
  // Перепонка — почти поперёк тела: с лица камера сверху видит её плашмя, а
  // не ребром (отведённое назад крыло с лица сливалось в черту).
  const elbow = at(root, 1 + 3.6 * sp, 2.6 - 2.2 * fl, 0.3 + sw * 1.8 - sp * 0.2);
  const wrist = at(elbow, 0.6 + 3.4 * sp, 1.6 - 2.6 * fl, 0.3 + sw * 2.4);
  const t1 = at(wrist, 0.8 + 3.8 * sp, -0.8 - 1.8 * fl, 0.1 + sw * 1.4);
  const t2 = at(wrist, 0.6 + 2.6 * sp, -5.2 - 1.0 * fl, 0.3 + sw * 2.0);
  const t3 = at(wrist, -0.8 + 0.8 * sp, -7.0 + 0.4 * fl, 0.6 + sw * 2.4);
  // Перепонка — ровным тоном: с лица она в тени и сливалась с полом.
  const mem: Mat = { T: WING, flat: 2 };
  const memD: Mat = { T: WING, flat: 1 };
  r.poly([root, elbow, wrist], memD);
  r.poly([wrist, t1, t2], mem);
  r.poly([wrist, t2, t3], memD);
  r.poly([wrist, t3, low, root], mem);
  const b: Mat = { T: BONE };
  r.cap(root, elbow, 0.5, 0.45, b);
  r.cap(elbow, wrist, 0.45, 0.35, b);
  r.cap(wrist, t1, 0.35, 0.15, b);
  r.cap(wrist, t2, 0.3, 0.15, b);
  r.cap(wrist, t3, 0.3, 0.15, b);
  r.spike(wrist, vadd(up, vmul(out, 0.3)), 1.2, 0.35, { T: HORN }, 3);
}

function sucRig(o: SucO, yaw: number): Rig {
  const r = new KRig(SK);
  const B = F3.yaw(yaw).scale(SK);
  const cs = camSide(yaw);
  const dn = o.down;
  const hipZ = HIP_Z + o.up - dn * 7.6;
  const P = B.at(o.fwd, 0, hipZ)
    .roll(o.roll + dn * 0.2)
    .pitch(o.lean + dn * 1.2);
  const T = P.turn(o.twist).pitch(-0.05);
  const skin: Mat = { T: SKIN };
  const dress: Mat = { T: DRESS, spec: true };
  // Крылья — за спиной, рисуем первыми (буфер глубины всё равно рассудит).
  wing(r, T, 1, o);
  wing(r, T, -1, o);
  // Ноги: в полёте висят, отведены назад; на полу — подогнуты.
  for (const sd of [-1, 1]) {
    const hip = P.p(0, sd * 0.9, 0);
    const k = o.legK + (sd > 0 ? 0.15 : 0);
    let foot = P.p(-1.4 - o.legB * 4.2 - k * 1.6, sd * 0.7, -9.2 + o.legB * 3.6 + k * 1.8);
    if (dn > 0) foot = vlerp(foot, B.p(-3.6, sd * 1.4, 0.4), dn);
    leg(r, hip, foot, 5.0 * SK, 5.0 * SK, P.v(1, 0, 0), [1.1, 0.8, 0.55], skin);
    r.cap(foot, vadd(foot, P.v(0.3, 0, -1.4)), 0.55, 0.2, { T: DRESS });
  }
  // Таз и юбка, талия, лиф.
  r.ell(P, [0, 0, 0.3], [1.6, 2.0, 1.4], dress);
  r.ell(P, [-0.1 - o.drag * 0.3, 0, -1.3], [1.9, 2.3, 1.3], { T: DRESS });
  r.ell(T, [0.1, 0, 2.6], [1.15, 1.5, 1.7], skin);
  r.ell(T, [0.4, 0, 4.6], [1.5, 2.0, 1.5], dress);
  r.cap(T.p(0, 0, 5.8), T.p(0.1, 0, 7.0), 0.6, 0.55, skin);
  // Хвост с сердцем: изгиб вниз-назад, качается, отстаёт.
  const tw = o.tsw;
  const q0 = P.p(-1.4, 0, 0.0);
  const q1 = vadd(q0, P.v(-2.6 - o.drag, tw * 1.2, -2.0));
  const q2 = vadd(q1, P.v(-2.0 - o.drag * 1.2, tw * 2.0, -1.0 + o.drag));
  const q3 = vadd(q2, P.v(-1.2, tw * 2.4, 1.4));
  const tb: Mat = { T: WING };
  r.cap(q0, q1, 0.45, 0.35, tb);
  r.cap(q1, q2, 0.35, 0.3, tb);
  r.cap(q2, q3, 0.3, 0.25, tb);
  r.ball(vadd(q3, P.v(0, 0.45, 0.4)), 0.65, { T: tn('#8a1040', '#c0205a', '#ff4a8a', '#ffb0d0') });
  r.ball(vadd(q3, P.v(0, -0.45, 0.4)), 0.65, { T: tn('#8a1040', '#c0205a', '#ff4a8a', '#ffb0d0') });
  r.spike(
    vadd(q3, P.v(0, 0, 0.3)),
    P.v(0, 0, -1),
    1.3,
    0.8,
    { T: tn('#8a1040', '#c0205a', '#ff4a8a', '#ffb0d0') },
    3,
  );
  // Голова: волосы, чёлка, рожки, глаза, губы.
  const Hd = T.at(0.25, 0, 8.6).turn(o.hturn).pitch(o.head);
  r.ball(Hd.p(0, 0, 0), 2.0, skin);
  const hair: Mat = { T: HAIR };
  r.ell(Hd, [-0.6, 0, 0.5], [1.9, 2.3, 2.1], hair);
  r.ell(Hd, [0.9, 0, 1.3], [1.0, 2.0, 0.8], hair);
  for (const s of [-1, 0, 1]) {
    const a = Hd.p(-1.2, s * 1.3, 0.2);
    // Волосы падают на спину и отлетают назад только на ходу.
    const b = vadd(a, B.v(-0.7 - o.drag * 2.2, s * 0.5, -3.2 + o.drag * 1.6));
    const c = vadd(b, B.v(-0.3 - o.drag * 2.0, s * 0.3 + tw * 0.4, -2.8 + o.drag * 1.8));
    r.cap(a, b, 0.85, 0.65, hair);
    r.cap(b, c, 0.65, 0.3, hair);
  }
  for (const sd of [-1, 1]) {
    const h0 = Hd.p(0.7, sd * 1.1, 1.7);
    const h1 = vadd(h0, Hd.v(-0.3, sd * 0.5, 1.3));
    const h2 = vadd(h1, Hd.v(-1.2, sd * 0.2, 0.5));
    r.cap(h0, h1, 0.5, 0.35, { T: HORN });
    r.cap(h1, h2, 0.35, 0.1, { T: HORN });
    if (o.shut < 0.5 && o.dim < 0.7)
      r.dot(Hd.p(1.8, sd * 0.7, 0.2), alpha(EYE, 1 - o.dim), 0.9 * (1 - o.dim), 1, 0.6);
  }
  r.dot(Hd.p(1.95, 0, -0.9), LIP, 0.3, 1, 0.6);
  r.eye = o.shut < 0.5 && o.dim < 0.5 ? Hd.p(1.8, cs * 0.7, 0.2) : null;
  // Руки.
  const shR = T.p(0, 2.2, 5.7);
  const shL = T.p(0, -2.2, 5.7);
  const hR = T.p(o.hR[0], o.hR[1], o.hR[2]);
  const hL = T.p(o.hL[0], o.hL[1], o.hL[2]);
  arm(r, shR, hR, 3.4 * SK, 3.4 * SK, T.v(-1, 0.6, -0.4), [0.7, 0.55, 0.5], skin);
  arm(r, shL, hL, 3.4 * SK, 3.4 * SK, T.v(-1, -0.6, -0.4), [0.7, 0.55, 0.5], skin);
  r.ell(T, [0, 2.3, 5.9], [0.8, 0.8, 0.6], dress);
  r.ell(T, [0, -2.3, 5.9], [0.8, 0.8, 0.6], dress);
  if (o.claw > 0) {
    // Когти правой руки: три лезвия, светятся.
    const fwd = T.v(1, -0.2, 0.2);
    for (const k of [-1, 0, 1])
      r.spike(
        hR,
        vadd(fwd, T.v(0, k * 0.35, k * 0.2)),
        1.2 + 1.4 * o.claw,
        0.3,
        { T: tn('#5a0a24', '#a01a44', '#ff4a8a', '#ffd0e0'), glow: 0.5 * o.claw },
        3,
      );
  }
  return r;
}

/** Сердечко 7×6 в 2D, по центру (x, y): в кадр и поверх темноты. */
function heart2(o: RigOut, x: number, y: number, k: number): void {
  const H = [' XX XX ', 'XXXXXXX', 'XXXXXXX', ' XXXXX ', '  XXX  ', '   X   '];
  const small = ['X X', 'XXX', ' X '];
  const pat = k < 0.45 ? small : H;
  const w = pat[0].length;
  const lit = litOn(o);
  const x0 = Math.round(x - w / 2);
  const y0 = Math.round(y - pat.length / 2);
  for (let j = 0; j < pat.length; j++)
    for (let i = 0; i < w; i++) {
      if (pat[j][i] !== 'X') continue;
      const edge = j === 0 || i === 0 || i === w - 1 || pat[j + 1]?.[i] !== 'X';
      const c = edge ? HEART[1] : j <= 1 && i <= 2 ? HEART[3] : HEART[2];
      o.p.set(x0 + i, y0 + j, c);
      lit.set(x0 + i, y0 + j, alpha(c, 0.55 + 0.45 * k));
    }
}

/** Розовое сияние кольцом (в `lit`): каст читается издалека. */
function halo(o: RigOut, x: number, y: number, R: number, k: number, seed: number): void {
  const lit = litOn(o);
  const n = 10;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + seed * 0.7;
    const px = x + Math.cos(a) * R;
    const py = y + Math.sin(a) * R * 0.6;
    lit.set(px, py, alpha(HEART[2], 0.5 * k));
    if (i % 2 === 0) o.p.set(px, py, alpha(HEART[2], 0.7 * k));
  }
}

// ---- Треки ----------------------------------------------------------------

const KISS_T = 0.62;
const CLAW_T = 0.5;
const AIM_T = 0.38;

function flyO(f: number, run: boolean): SucO {
  // Взмах: 8 кадров на цикл. Вниз быстро (кадры 2–4), вверх плавно.
  const a = (f / 8) * TAU;
  const o: SucO = { ...S0 };
  o.flap = Math.cos(a);
  o.up = -0.8 * Math.sin(a + 0.6);
  o.tsw = 0.5 * Math.sin(a - 1.2);
  o.drag = run ? 1 : 0.2 + 0.1 * Math.sin(a - 1);
  if (run) {
    o.lean = 0.4;
    o.legB = 0.7;
    o.sweep = 0.45;
    o.hR = [0.2, 2.4, 2.4];
    o.hL = [0.2, -2.4, 2.4];
  } else {
    o.hR = vadd(REST_R, [0, 0, 0.3 * Math.sin(a - 1.4)]);
    o.hL = vadd(REST_L, [0, 0, 0.3 * Math.sin(a - 1.6)]);
  }
  return o;
}

/** Поцелуй + после него (смех): T — время от начала поцелуя. */
function kissO(T: number): SucO {
  const o: SucO = { ...S0 };
  const lips: V3 = [3.0, 0.5, 7.4];
  const blow: V3 = [6.0, 1.4, 7.8];
  if (T < 0.2) o.hR = vlerp(REST_R, lips, easeOut(T / 0.2));
  else if (T < KISS_T) o.hR = lips;
  else if (T < KISS_T + 0.12) o.hR = vlerp(lips, blow, easeOut((T - KISS_T) / 0.05));
  else o.hR = vlerp(blow, MOUTH, sstep(KISS_T + 0.12, KISS_T + 0.3, T));
  o.hL =
    T < KISS_T
      ? vlerp(REST_L, [0.6, -2.6, 2.6], sstep(0, 0.3, T))
      : vlerp([0.6, -2.6, 2.6], REST_L, sstep(KISS_T, KISS_T + 0.3, T));
  // Крылья: во всю ширь, медленные взмахи; на выдохе — хлопок вниз.
  o.spread = trk(T, [
    [0, 0.85],
    [0.25, 1],
    [KISS_T + 0.05, 1],
    [KISS_T + 0.5, 0.85],
  ]);
  o.flap = trk(T, [
    [0, 0],
    [0.3, -0.8],
    [0.5, -0.6],
    [KISS_T, -0.9],
    [KISS_T + 0.06, 0.9, easeIn],
    [KISS_T + 0.3, 0],
    [KISS_T + 0.6, -0.4],
    [KISS_T + 0.9, 0],
  ]);
  o.lean = trk(T, [
    [0, 0.08],
    [0.5, -0.12],
    [KISS_T, -0.16],
    [KISS_T + 0.05, 0.22, easeIn],
    [KISS_T + 0.3, -0.05],
    [KISS_T + 0.9, 0.08],
  ]);
  o.head = trk(T, [
    [0, 0],
    [0.4, 0.12],
    [KISS_T, 0.14],
    [KISS_T + 0.05, -0.1],
    [KISS_T + 0.35, -0.35],
    [KISS_T + 0.9, 0],
  ]);
  o.shut = (T > 0.3 && T < KISS_T) || T > KISS_T + 0.3 ? 1 : 0;
  o.heart = T < KISS_T ? sstep(0.12, 0.5, T) : 0;
  o.up = trk(T, [
    [0, 0],
    [0.5, 1.0],
    [KISS_T, 1.2],
    [KISS_T + 0.08, 0.2],
    [KISS_T + 0.9, 0],
  ]);
  // Смех: плечи и голова трясутся (после выдоха).
  if (T > KISS_T + 0.3) {
    const g = Math.sin((T - KISS_T) * 30);
    o.up += 0.3 * g;
    o.head += 0.06 * g;
    o.roll = 0.05 * g;
  }
  o.tsw = 0.6 * Math.sin(T * 9);
  return o;
}

/** Когти + после (до смеха): T от начала замаха; контакт — CLAW_T. */
function clawO(T: number): SucO {
  const o: SucO = { ...S0 };
  const raise: V3 = [-0.6, 3.6, 9.0];
  const hit: V3 = [4.6, -1.4, 3.4];
  const thru: V3 = [2.2, -3.4, 1.6];
  if (T < 0.32) o.hR = vlerp(REST_R, raise, easeOut(T / 0.32));
  else if (T < CLAW_T - 0.03) o.hR = vadd(raise, [-0.4 * sstep(0.32, 0.47, T), 0, 0.3]);
  else if (T < CLAW_T + 0.04) o.hR = vlerp(raise, hit, easeIn((T - CLAW_T + 0.03) / 0.07));
  else if (T < CLAW_T + 0.16) o.hR = vlerp(hit, thru, easeOut((T - CLAW_T - 0.04) / 0.12));
  else o.hR = vlerp(thru, MOUTH, sstep(CLAW_T + 0.16, CLAW_T + 0.38, T));
  o.hL = vlerp(
    REST_L,
    [1.6, -2.8, 4.0],
    sstep(0, 0.3, T) * (1 - sstep(CLAW_T + 0.16, CLAW_T + 0.38, T)),
  );
  o.twist = trk(T, [
    [0, 0],
    [0.32, 0.6, easeOut],
    [CLAW_T - 0.03, 0.7],
    [CLAW_T + 0.04, -0.55, easeIn],
    [CLAW_T + 0.16, -0.65],
    [CLAW_T + 0.38, 0],
  ]);
  o.hturn = -o.twist * 0.7;
  o.lean = trk(T, [
    [0, 0.08],
    [0.4, -0.12],
    [CLAW_T + 0.04, 0.35, easeIn],
    [CLAW_T + 0.38, -0.04],
  ]);
  o.fwd = trk(T, [
    [0, 0],
    [0.4, -0.8],
    [CLAW_T + 0.04, 1.4, easeIn],
    [CLAW_T + 0.38, 0],
  ]);
  o.spread = trk(T, [
    [0, 0.85],
    [0.3, 1],
    [CLAW_T + 0.2, 1],
    [CLAW_T + 0.38, 0.85],
  ]);
  o.flap = trk(T, [
    [0, 0],
    [0.35, -0.9],
    [CLAW_T - 0.03, -1],
    [CLAW_T + 0.05, 0.9, easeIn],
    [CLAW_T + 0.4, 0],
  ]);
  o.claw = sstep(0.05, 0.3, T) * (1 - sstep(CLAW_T + 0.16, CLAW_T + 0.36, T));
  if (T > CLAW_T + 0.3) o.shut = 1;
  if (T > 0.42 && T < CLAW_T) o.fwd += Math.floor(T * FPS) % 2 ? 0.2 : -0.2;
  o.tsw = trk(T, [
    [0, 0],
    [0.4, 0.8],
    [CLAW_T + 0.1, -0.8],
    [CLAW_T + 0.5, 0],
  ]);
  return o;
}

/** Прицел броска, пике и выход из него (T от начала прицела; пике с AIM_T). */
function swoopO(T: number, out: number): SucO {
  const o: SucO = { ...S0 };
  if (out < 0) {
    const k = clamp01(T / AIM_T);
    const d = clamp01((T - AIM_T) / 0.12);
    o.up = trk(T, [
      [0, 0],
      [AIM_T * 0.8, 2.0, easeOut],
      [AIM_T, 2.2],
      [AIM_T + 0.12, -2.5, easeIn],
    ]);
    o.lean = 0.08 - 0.25 * sstep(0, 0.7, k) + 1.15 * easeIn(d);
    o.flap = -1 * sstep(0, 0.6, k) * (1 - d) + 0.2 * d;
    o.spread = 0.85 - 0.25 * k + (0.3 - 0.6) * d;
    o.sweep = 0.3 + 0.7 * d;
    o.legB = 0.3 + 0.7 * d;
    o.legK = 0.6 * k * (1 - d);
    o.drag = 0.2 + 1.2 * d;
    o.claw = sstep(0.1, 0.35, T);
    o.hR = vlerp(REST_R, [1.0, 2.6, 4.8], k);
    o.hL = vlerp(REST_L, [1.0, -2.6, 4.8], k);
    if (d > 0) {
      o.hR = vlerp(o.hR, [4.4, 1.4, 2.0], d);
      o.hL = vlerp(o.hL, [4.4, -1.4, 2.0], d);
    }
    if (T > AIM_T * 0.8 && T < AIM_T) o.up += Math.floor(T * FPS) % 2 ? 0.25 : -0.25;
    o.tsw = 0.3 * Math.sin(T * 14);
    return o;
  }
  // Выход из пике: хлопок крыльями вниз, корпус встаёт, потом зависла.
  const u = out;
  o.lean = trk(u, [
    [0, 0.9],
    [0.12, -0.35, easeOut],
    [0.35, 0.05],
  ]);
  o.up = trk(u, [
    [0, -2.5],
    [0.15, 1.6, easeOut],
    [0.4, 0],
  ]);
  o.flap = trk(u, [
    [0, -0.9],
    [0.1, 1.0, easeIn],
    [0.3, -0.4],
    [0.45, 0],
  ]);
  o.spread = trk(u, [
    [0, 0.5],
    [0.08, 1],
    [0.4, 0.85],
  ]);
  o.sweep = trk(u, [
    [0, 1],
    [0.15, 0.2],
  ]);
  o.legB = trk(u, [
    [0, 1],
    [0.3, 0.2],
  ]);
  o.drag = trk(u, [
    [0, 1.4],
    [0.35, 0.2],
  ]);
  o.claw = 1 - sstep(0.1, 0.3, u);
  o.hR = vlerp([4.4, 1.4, 2.0], MOUTH, sstep(0.05, 0.36, u));
  if (u > 0.3) o.shut = 1;
  o.hL = vlerp([4.4, -1.4, 2.0], REST_L, sstep(0, 0.3, u));
  o.tsw = 0.6 * Math.sin(u * 12);
  return o;
}

/** Смех (окно после техники): 12 кадров, 0,5 с, по кругу. */
function laughO(f: number): SucO {
  const a = (f / 12) * TAU;
  const o: SucO = { ...S0 };
  const g = Math.sin(a * 3);
  o.hR = vadd(MOUTH, [0, 0, 0.2 * g]);
  o.hL = REST_L;
  o.head = -0.3 + 0.08 * g;
  o.up = 0.3 * g;
  o.roll = 0.04 * g;
  o.flap = Math.cos(a * 2) * 0.7;
  o.lean = -0.04;
  o.shut = 1;
  o.tsw = 0.7 * Math.sin(a * 2);
  return o;
}

function sucPose(anim: string, f: number): SucO {
  const t = (f + 0.5) / FPS;
  switch (anim) {
    case 'fly':
      return flyO(f, false);
    case 'flym':
      return flyO(f, true);
    case 'sleep':
      return { ...flyO(f * 4, false), shut: 1, spread: 0.3, flap: 0.6, head: 0.35, up: -1 };
    case 'kiss':
      return kissO(Math.min(t, KISS_T - 0.005));
    case 'kissf':
      return kissO(KISS_T + t - 0.5 / FPS + 0.01);
    case 'claw':
      return clawO(Math.min(t, CLAW_T - 0.005));
    case 'clawf':
      return clawO(CLAW_T + t - 0.5 / FPS + 0.01);
    case 'swaim':
      return swoopO(Math.min(t, AIM_T - 0.005), -1);
    case 'swoop':
      return swoopO(AIM_T + t, -1);
    case 'swf':
      return swoopO(0, t - 0.5 / FPS);
    case 'laugh':
      return laughO(f);
    case 'flinch': {
      const k = f / 4;
      const b = Math.sin(PI * Math.min(1, k * 1.25)) * (1 - k * 0.5);
      return {
        ...S0,
        lean: -0.4 * b,
        head: -0.4 * b,
        fwd: -1.2 * b,
        flap: -0.9 * b,
        spread: 0.85 + 0.15 * b,
        hR: vadd(REST_R, [0, 0.6 * b, 2.5 * b]),
        hL: vadd(REST_L, [0, -0.6 * b, 2.5 * b]),
        shut: b > 0.5 ? 1 : 0,
        tsw: 0.8 * b,
      };
    }
    case 'die': {
      // 21 кадр (0,85 с): вздрогнула, руки к груди (0–4), крылья опадают и
      // падает (4–11), лежит, гаснет, лепестки (11–20).
      const o: SucO = { ...S0 };
      o.hR = vlerp(REST_R, [1.8, 0.8, 4.4], sstep(0, 0.12, t));
      o.hL = vlerp(REST_L, [1.8, -0.8, 4.2], sstep(0.02, 0.14, t));
      o.lean = trk(t, [
        [0, -0.35, easeOut],
        [0.15, -0.3],
        [0.3, 0.1],
      ]);
      o.head = trk(t, [
        [0, -0.5],
        [0.2, -0.3],
        [0.46, 0.5],
      ]);
      o.down = trk(t, [
        [0.14, 0],
        [0.44, 1, easeIn],
        [0.5, 0.94],
        [0.56, 1],
      ]);
      o.flap = trk(t, [
        [0, -0.9],
        [0.2, 0.6],
        [0.46, 1],
      ]);
      o.spread = trk(t, [
        [0, 1],
        [0.46, 0.35],
      ]);
      o.sweep = trk(t, [
        [0, 0.2],
        [0.46, 0.8],
      ]);
      o.legK = 0.6;
      o.shut = t > 0.4 ? 1 : 0;
      o.dim = sstep(0.3, 0.6, t);
      o.tsw = trk(t, [
        [0, 0.8],
        [0.46, -0.6],
        [0.56, 0],
      ]);
      return o;
    }
  }
  return { ...S0 };
}

// ---- Кадр -----------------------------------------------------------------

const SUC = kindOf('succubus', 64, 62, 32, 50, 1500);

/** Кисть правой руки в мире для поз `anim` (след когтей). */
function handOf(anim: string, f: number, d: number): V3 {
  const o = sucPose(anim, f);
  const B = F3.yaw(yawN(d)).scale(SK);
  const dn = o.down;
  const P = B.at(o.fwd, 0, HIP_Z + o.up - dn * 7.6)
    .roll(o.roll + dn * 0.2)
    .pitch(o.lean + dn * 1.2);
  const T = P.turn(o.twist).pitch(-0.05);
  return vadd(T.p(o.hR[0], o.hR[1], o.hR[2]), T.v(1.6, -0.3, 0.3));
}

const sucPic = (anim: string, f: number, d: number): Pic =>
  draw(SUC, sucRig(sucPose(anim, f), yawN(d)), (o, P) => {
    const po = sucPose(anim, f);
    const B = F3.yaw(yawN(d)).scale(SK);
    const head = (): [number, number] => {
      const P0 = B.at(po.fwd, 0, HIP_Z + po.up).pitch(po.lean);
      return P(P0.turn(po.twist).p(0.25 + 2.6, 0.6, 8.0));
    };
    if (anim === 'kiss' && po.heart > 0) {
      // Сердце наливается у губ, сияние — кольцом (поверх темноты).
      const [x, y] = head();
      heart2(o, x, y - 1, po.heart);
      halo(o, x - 2, y + 6, 9 + 3 * po.heart + (f % 2), po.heart, f);
    }
    if (anim === 'kissf' && f <= 2) {
      // Выдох: искры у ладони.
      const [x, y] = P(handOf(anim, f, d));
      for (let i = 0; i < 6; i++) {
        const a = hash(f, i) * TAU;
        const rr = 1 + (f + 1) * 1.6 * hash(i, f, 3);
        spark2(o, x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.7, HEART[i % 2 ? 2 : 3], 0.8);
      }
    }
    const sw = (anim === 'clawf' && f <= 2) || (anim === 'claw' && f >= 11) ? 2 : 0;
    if (sw) {
      const tips: [number, number][] = [];
      const bases: [number, number][] = [];
      for (let i = sw; i >= 0; i--) {
        let a = anim;
        let g = f - i;
        if (g < 0 && anim === 'clawf') {
          a = 'claw';
          g = Math.round(CLAW_T * FPS) + g;
        }
        if (g < 0) continue;
        const h = handOf(a, g, d);
        tips.push(P(vadd(h, [0, 0, 1.2])));
        bases.push(P(vadd(h, [0, 0, -1.2])));
      }
      smear(o, tips, bases, hx('#ff70b0', 210), 0.7);
    }
    if (anim === 'die' && f >= 11) {
      const [x, y] = P([0, 0, 2]);
      spray(o.p, x, y - 1, 10, 9, (f - 10) / 10, 41, PETAL, 3, 5);
    }
    if (anim === 'swoop') {
      // Когти в пике светятся.
      const [x, y] = P(handOf(anim, f, d));
      spark2(o, x, y, NAIL, 0.7);
    }
  });

const TECH = new Set(['kiss', 'linger', 'swoopAim', 'swoop', 'claw']);

registerMobPainter('f10_succubus', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = pose.t;
  const now = pose.now || 0;
  const v = visOf(m, pose, TECH.has(md) ? (m.face ?? 0) : headOf(m), md === 'swoop' ? 30 : 9);
  const d = dirN(v.yaw);
  const ex: Partial<MobFrame> = { shadow: 6, lift: 7 };
  let anim = 'fly';
  let f = 0;
  let dark = 0;
  const id = m.id ?? 0;
  if (md === 'dying') {
    f = fi(t, 20);
    anim = 'die';
    ex.linger = 0.9;
    ex.alpha = 1 - sstep(0.72, 0.9, t);
    // Падает: высота полёта уходит к полу вместе с телом.
    ex.lift = 7 * (1 - sstep(0.12, 0.44, t));
    ex.still = true;
  } else if (md === 'kiss') {
    f = fi(t, 14);
    anim = 'kiss';
    ex.still = true;
  } else if (md === 'linger') {
    ex.still = true;
    const g = fi(t, 21);
    const pr = v.prev;
    const fol = pr === 'kiss' ? 'kissf' : pr === 'claw' ? 'clawf' : pr === 'swoop' ? 'swf' : '';
    if (fol && g < 10) {
      anim = fol;
      f = g;
      if (fol === 'kissf' && f <= 1) {
        ex.sx = 1.05;
        ex.sy = 0.96;
      }
      if (fol === 'swf') ex.lift = 7 - 4 * (1 - sstep(0, 0.3, t));
    } else {
      anim = 'laugh';
      f = Math.floor(now * 24 + hash(id, 2) * 12) % 12;
    }
  } else if (md === 'swoopAim') {
    f = fi(t, 8);
    anim = 'swaim';
    ex.still = true;
  } else if (md === 'swoop') {
    f = fi(t, 17);
    anim = 'swoop';
    ex.still = true;
    ex.lift = 7 - 4 * sstep(0, 0.12, t);
    ex.ghost = { every: 0.03, life: 0.18, tint: '#ff4a8a', alpha: 0.3 };
  } else if (md === 'claw') {
    f = fi(t, 11);
    anim = 'claw';
    ex.still = true;
  } else if (md === 'sleep') {
    f = Math.floor(now * 1.2 + hash(id, 3) * 2) % 2;
    anim = 'sleep';
  } else if (md === 'emerge' || md === 'drop') {
    const k = clamp01(t / (md === 'emerge' ? 0.45 : 0.55));
    f = Math.floor(now * 12) % 8;
    anim = 'fly';
    dark = md === 'emerge' ? 3 - Math.min(3, Math.floor(k * 4)) : 0;
  } else if (md === 'stun' || hurtAge(v, now) < 0.2) {
    f = fi(md === 'stun' ? t : hurtAge(v, now), 4);
    anim = 'flinch';
  } else if (moving(m, 0.6)) {
    f = Math.floor(now * 14 + hash(id, 5) * 8) % 8;
    anim = 'flym';
  } else {
    f = Math.floor(now * 11 + hash(id, 7) * 8) % 8;
    anim = 'fly';
  }
  if (md !== 'dying') hurtFx(v, now, 1.4, ex);
  return { ...frameOf(SUC, anim, f, d, pose, () => sucPic(anim, f, d), dark), ...ex };
});

registerMobWarm('f10_succubus', function* () {
  yield* warmAll(
    SUC,
    [
      ['fly', 8],
      ['flym', 8],
      ['kiss', 15],
      ['kissf', 10],
      ['laugh', 12],
      ['swaim', 9],
      ['swoop', 18],
      ['swf', 10],
      ['claw', 12],
      ['clawf', 10],
      ['flinch', 5],
      ['die', 21],
      ['sleep', 2],
    ],
    sucPic,
  );
});
