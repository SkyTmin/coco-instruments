// Демон-страж (анимации мобов 10): чёрные латы с золотой каймой, рогатый
// шлем со щелью забрала (глаза-угли), красный табар, алебарда. Ходит
// тяжело, 8 сторон, туда, куда идёт; алебарда и табар отстают.
//
// Метроном — `f10-brains.ts` (`f10_guard`, `GUARD`):
// - взмах `sweep` 0,8 с: до 0,22 доворачивается и заносит древко на плечо,
//   до 0,62 — полный замах за спину (корпус скручен, вес на задней), до 0,7 —
//   задержка с дрожью, удар — лезвие проходит конус справа налево, кадр
//   контакта = первый кадр `recover` (0,8), проводка за цель, отдача, возврат;
// - выпад `thrust` 0,66 с: древко назад к бедру, присел, задержка, выпад — в
//   0,66 остриё на всю длину (кадр контакта), мозг толкает вперёд, возврат;
// - пост `f10_stand` — «смирно» с алебардой у ноги, `alertpost` 0,45 —
//   вскинул алебарду в стойку.
// Смерть 0,85 с: отшатнулся, алебарда выпала, на колени, ничком; угли
// забрала гаснут дымком.

import { registerImpactPainter, registerMobPainter, registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
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
  lin,
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
  vnorm,
  warmAll,
  yawN,
} from './f10-mobs';
import type { Pic, RGBA, V3 } from './f10-mobs';
import type { Mat } from './f15-rig';

const ARMOR = tn('#16121a', '#2e2636', '#4c4256', '#786a84');
const ARMOR_HI = hx('#a898b4');
const GOLD = tn('#5e3a10', '#9a6a1c', '#d8a23a', '#ffe28a');
const RED = tn('#34070b', '#641015', '#9e1e26', '#d8424a');
const HORN = tn('#2a221c', '#5e5040', '#a09076', '#e2d6bc');
const WOOD = tn('#1a100a', '#36241a', '#563c26', '#7a5a3a');
const STEEL = tn('#26262e', '#55556a', '#9a9aac', '#e8e8f2');
const EYE = hx('#ff4a20');
const EYE_HI = hx('#ffd0a0');
const SMOKE: RGBA[] = [hx('#4a4048'), hx('#3a3238'), hx('#5c5258')];
const SMEAR_C = hx('#e8e4f4', 200);

/** Алебарда: середина древка в рамке тела, курс и подъём древка, поворот лезвия. */
interface Pole {
  c: V3;
  wy: number;
  wp: number;
  wr: number;
  /** Где руки на древке (вдоль от середины): задняя (правая), передняя (левая) или null. */
  hr: number;
  hf: number | null;
}

interface GuardO {
  fwd: number;
  lift: number;
  /** Наклон корпуса вперёд, скрутка верха (+ — правым плечом назад), крен. */
  lean: number;
  twist: number;
  roll: number;
  head: number;
  hturn: number;
  /** Шаг: фаза, доля; присел; стойка шире (передняя нога вперёд). */
  ph: number;
  step: number;
  crouch: number;
  wide: number;
  /** На коленях 0…1, ничком 0…1. */
  kneel: number;
  prone: number;
  pole: Pole;
  /** Алебарда выпала: лежит на полу (0…1). */
  drop: number;
  /** Табар отстаёт: вперёд-назад, вбок. */
  cape: number;
  capeS: number;
  dim: number;
}

// Стойка: древко наискось вперёд-вправо — видно с любой стороны, не сливается с телом.
const STANCE: Pole = { c: [2.4, 4.4, 15.2], wy: 0.45, wp: 1.0, wr: PI / 2, hr: -4.5, hf: 3.0 };
const ATTN: Pole = { c: [1.4, 5.4, 13.6], wy: 0, wp: PI / 2, wr: 0, hr: 1.5, hf: null };

const G0: GuardO = {
  fwd: 0,
  lift: 0,
  lean: 0.05,
  twist: 0.4,
  roll: 0,
  head: 0,
  hturn: -0.34,
  ph: 0,
  step: 0,
  crouch: 0,
  wide: 0.5,
  kneel: 0,
  prone: 0,
  pole: STANCE,
  drop: 0,
  cape: 0,
  capeS: 0,
  dim: 0,
};

const POLE_L = 33;

function lerpPole(a: Pole, b: Pole, k: number): Pole {
  return {
    c: vlerp(a.c, b.c, k),
    wy: a.wy + (b.wy - a.wy) * k,
    wp: a.wp + (b.wp - a.wp) * k,
    wr: a.wr + (b.wr - a.wr) * k,
    hr: a.hr + (b.hr - a.hr) * k,
    hf: a.hf === null || b.hf === null ? (k < 0.5 ? a.hf : b.hf) : a.hf + (b.hf - a.hf) * k,
  };
}

/** Направление древка и лезвия в мире. */
function poleAxes(B: F3, p: Pole): { d: V3; n: V3; c: V3 } {
  const cw = Math.cos(p.wp);
  const d = vnorm(B.v(cw * Math.cos(p.wy), cw * Math.sin(p.wy), Math.sin(p.wp)));
  // Поперёк древка: вправо по горизонтали и «вверх» в его вертикальной плоскости.
  const side = vnorm(B.v(-Math.sin(p.wy), Math.cos(p.wy), 0));
  const up = vnorm([
    d[1] * side[2] - d[2] * side[1],
    d[2] * side[0] - d[0] * side[2],
    d[0] * side[1] - d[1] * side[0],
  ]);
  const n = vnorm(vadd(vmul(side, Math.cos(p.wr)), vmul(up, -Math.sin(p.wr))));
  return { d, n, c: B.p(p.c[0], p.c[1], p.c[2]) };
}

/** Остриё и основание лезвия алебарды (мир) — для следа. */
function poleTip(B: F3, p: Pole): [V3, V3] {
  const { d, n, c } = poleAxes(B, p);
  const head = vadd(c, vmul(d, POLE_L * 0.55));
  return [vadd(vadd(head, vmul(d, -3)), vmul(n, 5)), vadd(head, vmul(d, -4))];
}

/** Рамка алебарды: тело без скрутки — вперёд с выпадом, вниз с приседом. */
const POLE_Z = 1.6;
const poleFrame = (B: F3, o: GuardO) => B.at(o.fwd, 0, POLE_Z + o.lift - o.crouch * 2.4);

function drawPole(r: Rig, B: F3, p: Pole): void {
  const { d, n, c } = poleAxes(B, p);
  const butt = vadd(c, vmul(d, -POLE_L * 0.45));
  const head = vadd(c, vmul(d, POLE_L * 0.55));
  r.cap(butt, head, 0.75, 0.7, { T: WOOD });
  r.cap(vadd(head, vmul(d, -5.5)), vadd(head, vmul(d, -4.6)), 1.0, 1.0, { T: GOLD });
  // Наконечник-пика, лезвие-полумесяц и крюк сзади.
  r.spike(head, d, 4.2, 0.9, { T: STEEL, spec: true }, 4);
  const blade: Mat = { T: STEEL, spec: true };
  const b0 = vadd(head, vmul(d, -1.0));
  const b1 = vadd(head, vmul(d, -4.6));
  r.poly(
    [
      b0,
      vadd(vadd(b0, vmul(n, 3.6)), vmul(d, 1.6)),
      vadd(vadd(head, vmul(n, 5.2)), vmul(d, -2.8)),
      vadd(vadd(b1, vmul(n, 3.8)), vmul(d, -2.2)),
      b1,
    ],
    blade,
  );
  r.spike(vadd(head, vmul(d, -2.6)), vmul(n, -1), 2.6, 0.6, { T: STEEL }, 3);
}

function guardRig(o: GuardO, yaw: number): Rig {
  const r = new Rig();
  const B = F3.yaw(yaw);
  const cs = camSide(yaw);
  const kn = o.kneel;
  const hipZ = 13.2 - o.crouch * 2.4 - kn * 7.2 + o.lift;
  const P = B.at(o.fwd, 0, hipZ).roll(o.roll);
  const T = P.turn(o.twist).pitch(o.lean + o.prone * 1.25);
  const arm1: Mat = { T: ARMOR, spec: true };
  const dark: Mat = { T: ARMOR, bias: -0.15 };
  const gold: Mat = { T: GOLD, spec: true };
  // Ноги: шаг по фазе, стойка, колени.
  for (const sd of [-1, 1]) {
    const hip = P.p(0, sd * 2.5, 0);
    const [off, rise] = gait(o.ph + (sd > 0 ? 0.5 : 0));
    const S = 10.4 * o.step;
    let foot = B.p(
      o.fwd * 0.5 + off * S + (sd < 0 ? o.wide * 2.6 : -o.wide * 2.2),
      sd * (2.7 + o.wide * 0.5),
      rise * 2.4 * o.step,
    );
    if (kn > 0) foot = vlerp(foot, B.p(-5.6, sd * 2.8, 0.2), kn);
    const pole = B.v(1, sd * 0.15, 0);
    const legM: Mat = { T: ARMOR, bias: sd === cs ? 0.05 : -0.18, spec: true };
    const knee = leg(
      r,
      hip,
      foot,
      7.0,
      7.2,
      pole,
      [2.1, 1.6, 1.4],
      legM,
      vadd(foot, B.v(2.0, 0, 0)),
    );
    r.ball(vadd(knee, B.v(0.6, 0, 0.2)), 1.4, gold);
  }
  // Таз с набедренниками, корпус, кираса.
  r.ell(P, [0, 0, 0.6], [2.8, 3.8, 2.2], dark);
  r.ell(T, [0.3, 0, 6.6], [3.5, 4.6, 5.0], arm1);
  r.ell(T, [0.4, 0, 2.4], [2.9, 3.9, 1.1], gold);
  // Табар спереди и сзади — отстаёт по инерции.
  const tab = (front: number) => {
    const fx = front * 3.4;
    const lag = -o.cape * front;
    const top = [T.p(fx, -2.6, 5.0), T.p(fx, 2.6, 5.0)];
    const bot = [
      vadd(P.p(fx * 1.05 + lag * 1.6, 2.5 + o.capeS, -8.2), B.v(0, 0, kn * 3.4)),
      vadd(P.p(fx * 1.05 + lag * 1.6, -2.5 + o.capeS, -8.2), B.v(0, 0, kn * 3.4)),
    ];
    r.poly([top[0], top[1], bot[0], bot[1]], { T: RED });
  };
  tab(1);
  tab(-1);
  // Голова: шлем, забрало, рога.
  const Hd = T.at(0.6, 0, 12.8).turn(o.hturn).pitch(o.head);
  r.ball(Hd.p(0, 0, 0), 3.2, arm1);
  r.ell(Hd, [2.1, 0, -0.7], [1.4, 2.4, 1.8], dark);
  r.cap(Hd.p(-0.8, 0, 3.1), Hd.p(2.0, 0, 2.4), 0.8, 0.5, gold);
  for (const sd of [-1, 1]) {
    // Рога: вбок-назад, потом вверх и вперёд — сбоку видны оба (дальний выше).
    const h0 = Hd.p(0.0, sd * 2.6, 1.4);
    const h1 = vadd(h0, Hd.v(-0.6 - sd * 0.5, sd * 2.8, 1.6));
    const h2 = vadd(h1, Hd.v(1.4, sd * 0.3, 3.2));
    r.cap(h0, h1, 1.0, 0.7, { T: HORN });
    r.cap(h1, h2, 0.7, 0.2, { T: HORN });
    if (o.dim < 0.8)
      r.dot(
        Hd.p(3.1, sd * 1.0, -0.3),
        alpha(o.dim > 0.4 ? EYE : EYE_HI, 1 - o.dim * 0.6),
        1 - o.dim,
        1,
        0.6,
      );
  }
  r.eye = o.dim < 0.5 ? Hd.p(3.1, cs * 1.0, -0.3) : null;
  // Наплечники.
  const shR = T.p(0.2, 4.9, 9.8);
  const shL = T.p(0.2, -4.9, 9.8);
  r.ell(T, [0.2, 5.2, 10.6], [2.7, 2.4, 1.9], arm1);
  r.ell(T, [0.2, -5.2, 10.6], [2.7, 2.4, 1.9], arm1);
  r.cap(T.p(-2.2, 5.6, 9.6), T.p(2.6, 5.6, 9.6), 0.5, 0.5, gold);
  r.cap(T.p(-2.2, -5.6, 9.6), T.p(2.6, -5.6, 9.6), 0.5, 0.5, gold);
  r.dot(T.p(0.6, 5.2 * cs, 12.3), ARMOR_HI, 0, 1, 0.7);
  // Алебарда и руки.
  if (o.drop >= 1) {
    // Лежит на полу перед ним.
    const lp: Pole = { c: [7, 1.5, 0.8], wy: 0.35, wp: 0, wr: 0, hr: 0, hf: null };
    drawPole(r, B, lp);
    arm(r, shR, T.p(3.2, 4.2, 1.0), 6.0, 5.8, T.v(-1, 0.4, 0), [1.7, 1.4, 1.3], arm1);
    arm(r, shL, T.p(3.2, -4.2, 1.0), 6.0, 5.8, T.v(-1, -0.4, 0), [1.7, 1.4, 1.3], arm1);
    return r;
  }
  const pl = o.pole;
  const W = poleFrame(B, o);
  const { d, c } = poleAxes(W, pl);
  if (o.drop > 0) {
    // Выпадает из рук: падает вперёд, поворачиваясь к полу.
    const lz = 0.8 - POLE_Z - o.lift + o.crouch * 2.4;
    const lp: Pole = { c: [7 - o.fwd, 1.5, lz], wy: 0.35, wp: 0, wr: 0, hr: 0, hf: null };
    drawPole(r, W, lerpPole(pl, lp, easeIn(o.drop)));
  } else drawPole(r, W, pl);
  const hR = o.drop > 0 ? T.p(4.4, 4.0, 3.2) : vadd(c, vmul(d, pl.hr));
  const hL = o.drop > 0 || pl.hf === null ? T.p(1.6, -4.7, 2.6) : vadd(c, vmul(d, pl.hf));
  arm(r, shR, hR, 6.0, 5.8, T.v(-0.6, 1, -0.3), [1.8, 1.4, 1.3], arm1);
  arm(r, shL, hL, 6.0, 5.8, T.v(-0.6, -1, -0.3), [1.8, 1.4, 1.3], arm1);
  r.ball(hR, 1.4, gold);
  r.ball(hL, 1.4, gold);
  return r;
}

// ---- Треки ----------------------------------------------------------------

const SW_T = 0.8;
const TH_T = 0.66;

/** Взмах: замах 0,8 + отдых 0,85 одним треком T (с). Контакт — T = 0,8. */
function sweepO(T: number): GuardO {
  const o: GuardO = { ...G0 };
  const back: Pole = { c: [0.5, 4.6, 17.5], wy: 1.4, wp: 0.75, wr: PI, hr: -3.0, hf: 4.0 };
  const full: Pole = { c: [-1.4, 4.8, 17.6], wy: 2.35, wp: 0.55, wr: PI, hr: -3.0, hf: 4.0 };
  // Удар: курс древка по дуге справа-сзади → центр → слева (ease-in к контакту).
  if (T < 0.22) o.pole = lerpPole(STANCE, back, easeOut(T / 0.22));
  else if (T < 0.62) o.pole = lerpPole(back, full, easeOut((T - 0.22) / 0.4));
  else if (T < 0.7) {
    o.pole = { ...full, wy: full.wy + 0.08 * ((T - 0.62) / 0.08) };
  } else {
    const wy = trk(T, [
      [0.7, 2.43],
      [0.73, 2.2, easeIn],
      [0.77, 1.25, easeIn],
      [0.795, 0.4, lin],
      [0.81, -0.2, lin],
      [0.85, -1.2, easeOut],
      [0.9, -1.7, easeOut],
      [1.0, -1.95, easeOut],
      [1.12, -1.85],
      [1.4, STANCE.wy],
    ]);
    const wp = trk(T, [
      [0.7, 0.55],
      [0.79, 0.05],
      [0.92, -0.05],
      [1.12, 0.0],
      [1.4, STANCE.wp],
    ]);
    const cc = vlerp(full.c, [4.8, -2.2, 13.0], sstep(0.7, 0.86, T));
    o.pole = {
      c: T < 1.12 ? cc : vlerp([4.8, -2.2, 13.0], STANCE.c, sstep(1.12, 1.4, T)),
      wy,
      wp,
      wr: T < 1.12 ? PI : PI + (STANCE.wr - PI) * sstep(1.12, 1.4, T),
      hr: -3.0 + (STANCE.hr + 3.0) * sstep(1.12, 1.4, T),
      hf: 4.0 + ((STANCE.hf ?? 4) - 4.0) * sstep(1.12, 1.4, T),
    };
  }
  o.twist = trk(T, [
    [0, 0.4],
    [0.22, 0.7],
    [0.62, 1.1, easeOut],
    [0.7, 1.15],
    [0.79, 0.3, easeIn],
    [0.86, -0.6, easeOut],
    [1.0, -0.7],
    [1.12, -0.55],
    [1.4, 0.4],
  ]);
  o.crouch = trk(T, [
    [0, 0],
    [0.62, 0.7],
    [0.7, 0.75],
    [0.8, 0.45],
    [0.92, 0.6],
    [1.12, 0.5],
    [1.4, 0],
  ]);
  o.lean = trk(T, [
    [0, 0.05],
    [0.62, -0.12],
    [0.7, -0.14],
    [0.82, 0.22, easeIn],
    [1.0, 0.18],
    [1.4, 0.05],
  ]);
  o.wide = trk(T, [
    [0, 0.5],
    [0.3, 1],
    [1.2, 1],
    [1.45, 0.5],
  ]);
  o.fwd = trk(T, [
    [0, 0],
    [0.62, -1.0],
    [0.8, 0.6, easeIn],
    [1.0, 1.0],
    [1.4, 0],
  ]);
  o.hturn = -o.twist * 0.75;
  o.cape = trk(T - 0.05, [
    [0, 0],
    [0.62, -0.6],
    [0.82, 0.9],
    [1.1, -0.3],
    [1.4, 0],
  ]);
  o.capeS = -o.twist * 1.2;
  if (T > 0.62 && T < 0.7) o.fwd += Math.floor(T * FPS) % 2 ? 0.25 : -0.25;
  return o;
}

/** Выпад: подготовка 0,66 + отдых 0,85; контакт — T = 0,66. */
function thrustO(T: number): GuardO {
  const o: GuardO = { ...G0 };
  const ch1: Pole = { c: [-2.6, 2.6, 12.2], wy: 0.05, wp: 0.12, wr: 0, hr: -4.0, hf: 3.5 };
  const ch2: Pole = { c: [-4.6, 2.8, 11.6], wy: 0.06, wp: 0.1, wr: 0, hr: -4.5, hf: 3.0 };
  const ext: Pole = { c: [11.5, 0.8, 12.6], wy: 0.0, wp: 0.04, wr: 0, hr: -5.5, hf: 1.5 };
  if (T < 0.2) o.pole = lerpPole(STANCE, ch1, easeOut(T / 0.2));
  else if (T < 0.5) o.pole = lerpPole(ch1, ch2, smoothK((T - 0.2) / 0.3));
  else if (T < 0.62) o.pole = ch2;
  else if (T < 0.68) o.pole = lerpPole(ch2, ext, easeIn((T - 0.62) / 0.06));
  else if (T < 0.86)
    o.pole = { ...ext, c: vadd(ext.c, [0.6 * Math.sin(((T - 0.68) / 0.18) * PI), 0, 0]) };
  else o.pole = lerpPole(ext, STANCE, sstep(0.86, 1.26, T));
  o.twist = trk(T, [
    [0, 0.4],
    [0.2, 0.7],
    [0.5, 0.85],
    [0.62, 0.88],
    [0.68, -0.2, easeIn],
    [0.86, -0.2],
    [1.26, 0.4],
  ]);
  o.hturn = -o.twist * 0.8;
  o.crouch = trk(T, [
    [0, 0],
    [0.5, 0.85],
    [0.62, 0.9],
    [0.68, 0.55],
    [0.86, 0.6],
    [1.26, 0],
  ]);
  o.lean = trk(T, [
    [0, 0.05],
    [0.5, -0.1],
    [0.68, 0.3, easeIn],
    [0.86, 0.28],
    [1.26, 0.05],
  ]);
  o.wide = trk(T, [
    [0, 0.5],
    [0.3, 1.1],
    [0.68, 1.6],
    [0.9, 1.6],
    [1.3, 0.5],
  ]);
  o.fwd = trk(T, [
    [0, 0],
    [0.5, -1.4],
    [0.68, 2.6, easeIn],
    [0.86, 2.8],
    [1.26, 0],
  ]);
  o.cape = trk(T - 0.05, [
    [0, 0],
    [0.5, -0.4],
    [0.7, 1.0],
    [1.0, -0.2],
    [1.3, 0],
  ]);
  if (T > 0.5 && T < 0.62) o.fwd += Math.floor(T * FPS) % 2 ? 0.25 : -0.25;
  return o;
}
const smoothK = (k: number) => {
  const x = clamp01(k);
  return x * x * (3 - 2 * x);
};

function guardPose(anim: string, f: number): GuardO {
  const t = (f + 0.5) / FPS;
  switch (anim) {
    case 'idle': {
      // Стойка, 8 кадров по 5 к/с: дышит, алебарда покачивается с запозданием.
      const a = (f / 8) * TAU;
      const o: GuardO = { ...G0 };
      o.lift = 0.25 * Math.sin(a);
      o.pole = { ...STANCE, c: vadd(STANCE.c, [0, 0, 0.4 * Math.sin(a - 0.8)]) };
      o.hturn = -0.34 + 0.18 * Math.sin(a * 0.5) * (f > 3 ? 1 : 0.3);
      o.cape = 0.1 * Math.sin(a - 1);
      return o;
    }
    case 'walk': {
      // Тяжёлый шаг: 8 кадров на 1,3 клетки; древко качается с отставанием.
      const o: GuardO = { ...G0, ph: f / 8, step: 1 };
      const a = (f / 8) * TAU;
      o.lift = 0.5 * Math.abs(Math.cos(a));
      o.roll = 0.05 * Math.sin(a);
      o.twist = 0.25 + 0.08 * Math.sin(a);
      o.hturn = -0.2;
      o.wide = 0;
      o.lean = 0.12;
      o.pole = {
        ...STANCE,
        c: vadd(STANCE.c, [0, 0, 0.7 * Math.sin(a * 2 - 1.2)]),
        wp: STANCE.wp - 0.06 * Math.sin(a * 2 - 1.6),
      };
      o.cape = -0.35 + 0.15 * Math.sin(a * 2 - 1.4);
      o.capeS = 0.4 * Math.sin(a - 1);
      return o;
    }
    case 'attn': {
      // На посту: «смирно», алебарда у правой ноги; 4 кадра по 3 к/с.
      const a = (f / 4) * TAU;
      return {
        ...G0,
        lean: 0,
        twist: 0,
        wide: 0,
        hturn: 0,
        lift: 0.2 * Math.sin(a),
        pole: { ...ATTN, c: vadd(ATTN.c, [0, 0, 0.2 * Math.sin(a - 1)]) },
        cape: 0.06 * Math.sin(a),
      };
    }
    case 'alert': {
      // Заметил (0,45 с, 11 кадров): вскинул голову, древко из «смирно» в стойку.
      const k = t / 0.45;
      const o: GuardO = { ...G0 };
      o.pole = lerpPole(ATTN, STANCE, easeOut(sstep(0.1, 0.7, k)));
      o.twist = 0.4 * sstep(0.1, 0.7, k);
      o.hturn = -o.twist * 0.85;
      o.head = trk(k, [
        [0, 0],
        [0.15, -0.3],
        [0.6, 0],
      ]);
      o.crouch = trk(k, [
        [0.4, 0],
        [0.65, 0.6],
        [0.85, 0.2],
        [1, 0],
      ]);
      o.wide = sstep(0.4, 0.8, k) * 0.5;
      o.cape = trk(k, [
        [0.4, 0],
        [0.7, 0.5],
        [1, 0],
      ]);
      return o;
    }
    case 'sweep':
      return sweepO(Math.min(t, SW_T - 0.005));
    case 'sweepf':
      return sweepO(SW_T + t - 0.5 / FPS + 0.01);
    case 'thrust':
      return thrustO(Math.min(t, TH_T - 0.005));
    case 'thrustf':
      return thrustO(TH_T + t - 0.5 / FPS + 0.01);
    case 'flinch': {
      const k = f / 4;
      const b = Math.sin(PI * Math.min(1, k * 1.25)) * (1 - k * 0.5);
      const o: GuardO = { ...G0 };
      o.lean = -0.3 * b;
      o.head = -0.4 * b;
      o.fwd = -1.2 * b;
      o.pole = { ...STANCE, wp: STANCE.wp + 0.25 * b, c: vadd(STANCE.c, [-1.5 * b, 0, 0.8 * b]) };
      o.cape = 0.6 * b;
      return o;
    }
    case 'die': {
      // 20 кадров (0,83 с): отшатнулся (0–3), алебарда выпала, на колени
      // (3–9), ничком (9–16), дымок из забрала (12–19).
      const o: GuardO = { ...G0 };
      o.lean = trk(t, [
        [0, -0.35, easeOut],
        [0.14, -0.4],
        [0.36, 0.1],
      ]);
      o.prone = trk(t, [
        [0.36, 0],
        [0.62, 1, easeIn],
        [0.68, 0.93],
        [0.74, 1],
      ]);
      o.kneel = trk(t, [
        [0.12, 0],
        [0.36, 1, easeIn],
      ]);
      o.head = trk(t, [
        [0, -0.5],
        [0.36, 0.3],
        [0.62, 0.4],
      ]);
      o.fwd = trk(t, [
        [0, -1.6, easeOut],
        [0.36, -0.6],
        [0.62, 1.2],
      ]);
      o.drop = trk(t, [
        [0.08, 0],
        [0.36, 1, easeIn],
      ]);
      o.pole = { ...STANCE, wp: STANCE.wp + 0.35, c: vadd(STANCE.c, [-1.5, 0, 1]) };
      o.cape = trk(t, [
        [0, 0.6],
        [0.36, -0.4],
        [0.62, 0.5],
      ]);
      o.dim = sstep(0.36, 0.7, t);
      return o;
    }
  }
  return { ...G0 };
}

// ---- Кадр -----------------------------------------------------------------

const GUARD = kindOf('guard', 76, 70, 38, 50, 1300);

/** След по треку: точки острия и основания лезвия за прошлые кадры. */
function trail(anim: string, f: number, d: number, n: number): { tips: V3[]; bases: V3[] } {
  const B = F3.yaw(yawN(d));
  const tips: V3[] = [];
  const bases: V3[] = [];
  for (let i = n; i >= 0; i--) {
    let a = anim;
    let g = f - i;
    if (g < 0 && anim === 'sweepf') {
      a = 'sweep';
      g = Math.round(SW_T * FPS) + g;
    }
    if (g < 0 && anim === 'thrustf') {
      a = 'thrust';
      g = Math.round(TH_T * FPS) + g;
    }
    if (g < 0) continue;
    const o = guardPose(a, g);
    const [tip, base] = poleTip(poleFrame(B, o), o.pole);
    tips.push(tip);
    bases.push(base);
  }
  return { tips, bases };
}

const guardPic = (anim: string, f: number, d: number): Pic =>
  draw(GUARD, guardRig(guardPose(anim, f), yawN(d)), (o, P) => {
    const sw =
      (anim === 'sweep' && f >= 17) || (anim === 'sweepf' && f <= 2)
        ? 3
        : (anim === 'thrust' && f >= 15) || (anim === 'thrustf' && f <= 1)
          ? 2
          : 0;
    if (sw) {
      const { tips, bases } = trail(anim, f, d, sw);
      smear(o, tips.map(P), bases.map(P), SMEAR_C, 0.5);
    }
    if (anim === 'sweepf' && f === 0) {
      // Искра на кромке в миг удара — поверх темноты.
      const o0 = guardPose('sweepf', 0);
      const [x, y] = P(poleTip(poleFrame(F3.yaw(yawN(d)), o0), o0.pole)[0]);
      spark2(o, x, y, hx('#ffffff'));
      spark2(o, x + 1, y, hx('#ffe0a0'), 0.8);
    }
    if (anim === 'die' && f >= 12) {
      const [x, y] = P([0, 0, 4]);
      spray(o.p, x, y - 2, 6, 7, (f - 11) / 8, 31, SMOKE, 0, 9);
    }
  });

const tech = new Set(['sweep', 'thrust', 'recover', 'alertpost', 'f10_stand']);

registerMobPainter('f10_guard', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = pose.t;
  const now = pose.now || 0;
  const want = md === 'f10_stand' ? PI / 2 : tech.has(md) ? (m.face ?? 0) : headOf(m);
  const v = visOf(m, pose, want, 7);
  const d = dirN(v.yaw);
  const ex: Partial<MobFrame> = { shadow: 9 };
  let anim = 'idle';
  let f = 0;
  const id = m.id ?? 0;
  if (md === 'dying') {
    f = fi(t, 19);
    anim = 'die';
    ex.linger = 0.9;
    ex.alpha = 1 - sstep(0.74, 0.9, t);
    ex.still = true;
  } else if (md === 'sweep') {
    f = fi(t, 19);
    anim = 'sweep';
    ex.still = true;
  } else if (md === 'thrust') {
    f = fi(t, 15);
    anim = 'thrust';
    ex.still = true;
  } else if (md === 'recover' && (v.prev === 'sweep' || v.prev === 'thrust')) {
    anim = v.prev === 'sweep' ? 'sweepf' : 'thrustf';
    f = fi(t, 20);
    ex.still = true;
    if (f <= 1) {
      ex.sx = 1.05;
      ex.sy = 0.96;
    }
  } else if (md === 'f10_stand') {
    f = Math.floor(now * 3 + hash(id, 3) * 4) % 4;
    anim = 'attn';
  } else if (md === 'alertpost') {
    f = fi(t, 10);
    anim = 'alert';
    ex.still = true;
  } else if (md === 'stun' || hurtAge(v, now) < 0.2) {
    f = fi(md === 'stun' ? t : hurtAge(v, now), 4);
    anim = 'flinch';
  } else if (moving(m, 0.5)) {
    f = Math.floor((v.dist / 1.3) * 8) % 8;
    anim = 'walk';
  } else {
    f = Math.floor((now + hash(id, 7) * 4) * 5) % 8;
    anim = 'idle';
  }
  if (md !== 'dying') hurtFx(v, now, 1.2, ex);
  return { ...frameOf(GUARD, anim, f, d, pose, () => guardPic(anim, f, d)), ...ex };
});

registerMobWarm('f10_guard', function* () {
  yield* warmAll(
    GUARD,
    [
      ['walk', 8],
      ['idle', 8],
      ['sweep', 20],
      ['sweepf', 21],
      ['thrust', 16],
      ['thrustf', 21],
      ['flinch', 5],
      ['die', 20],
      ['alert', 11],
      ['attn', 4],
    ],
    guardPic,
  );
});

// ---- Контакт на полу: взмах — рубец дугой и пыль, выпад — борозда от острия.

type Rec = Parameters<Parameters<typeof registerImpactPainter>[1]['paint']>[1];
const css = (c: RGBA, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${clamp01(a).toFixed(3)})`;
const DUST = hx('#8a7a70');
const SCAR = hx('#0e0a0c');

registerImpactPainter('f10_sweep', {
  life: 0.55,
  shake: 0.16,
  paint(g, rec: Rec, px, py, S, age) {
    const k = clamp01(age / 0.55);
    const R = (rec.r ?? 2.4) * S;
    const a0 = (rec.ang ?? 0) - (rec.arc ?? 2.1) / 2;
    const a1 = (rec.ang ?? 0) + (rec.arc ?? 2.1) / 2;
    // Светлый серп по дуге — тает за 0,2 с.
    if (age < 0.2) {
      g.strokeStyle = css(hx('#f0eaff'), 0.75 * (1 - age / 0.2));
      g.lineWidth = Math.max(1, 3 * (1 - age / 0.2));
      g.beginPath();
      g.arc(px, py, R * 0.86, a0, a1);
      g.stroke();
    }
    // Рубец на плитах и пыль, разлетающаяся по дуге.
    g.fillStyle = css(SCAR, 0.45 * (1 - k));
    for (let i = 0; i < 9; i++) {
      const a = a0 + ((a1 - a0) * (i + 0.5)) / 9;
      const rr = R * (0.78 + 0.08 * hash(rec.seed, i));
      g.fillRect(Math.round(px + Math.cos(a) * rr), Math.round(py + Math.sin(a) * rr), 2, 1);
    }
    g.fillStyle = css(DUST, 0.55 * (1 - k));
    for (let i = 0; i < 12; i++) {
      const a = a0 + (a1 - a0) * hash(rec.seed, i, 3);
      const rr = R * (0.7 + 0.35 * easeOut(k) * hash(rec.seed, i, 4));
      g.fillRect(
        Math.round(px + Math.cos(a) * rr),
        Math.round(py + Math.sin(a) * rr - 4 * k * hash(rec.seed, i, 5)),
        1,
        1,
      );
    }
    return true;
  },
});

registerImpactPainter('f10_thrust', {
  life: 0.45,
  shake: 0.1,
  paint(g, rec: Rec, px, py, S, age) {
    const k = clamp01(age / 0.45);
    const L = (rec.r ?? 3.4) * S;
    const a = rec.ang ?? 0;
    const ex = px + Math.cos(a) * L;
    const ey = py + Math.sin(a) * L;
    // Борозда от острия и сноп искр на конце.
    g.strokeStyle = css(SCAR, 0.5 * (1 - k));
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(px + Math.cos(a) * L * 0.55, py + Math.sin(a) * L * 0.55);
    g.lineTo(ex, ey);
    g.stroke();
    if (age < 0.16) {
      g.fillStyle = css(hx('#fff4d0'), 1 - age / 0.16);
      for (let i = 0; i < 6; i++) {
        const b = a + (hash(rec.seed, i) - 0.5) * 1.8;
        const r = 2 + 7 * lin(age / 0.16) * hash(rec.seed, i, 2);
        g.fillRect(Math.round(ex + Math.cos(b) * r), Math.round(ey + Math.sin(b) * r), 1, 1);
      }
    }
    g.fillStyle = css(DUST, 0.5 * (1 - k));
    for (let i = 0; i < 6; i++) {
      const r = 3 * easeOut(k) * hash(rec.seed, i, 6);
      g.fillRect(Math.round(ex - 2 + r * 1.5), Math.round(ey - 2 * k - r * 0.5), 1, 1);
    }
    return true;
  },
});
