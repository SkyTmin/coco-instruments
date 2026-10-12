// Рыцарь ада на коне (анимации мобов 10): вороной конь с огненной гривой,
// хвостом и копытами, красная попона, всадник в чёрных латах с рогатым
// шлемом и копьём с вымпелом. Ходит туда, куда идёт, 8 сторон; на таране —
// галоп по пройденному пути.
//
// Метроном — `f10-brains.ts` (`f10_knight`, `KNIGHT`):
// - прицел `aim` 0,95 с: конь бьёт копытом дважды, всадник опускает копьё
//   наперевес, конь приседает на задние, 0,8–0,95 — задержка с дрожью и
//   огнём из ноздрей;
// - таран `charge`: галоп, копьё наперевес, шлейф; `skid` 0,7 — осадил:
//   задние под себя, передние упёрты, пыль;
// - `dizzy` 1,8 — о кладку: на дыбы, опустился, шатается, звёзды;
// - укол `lance` 0,55: отвёл копьё, задержка; кадр контакта — первый
//   кадр `recover` (копьё на всю длину);
// - в бездну `f10_fall` 0,9 (рендер этот режим не знает — сцена своя):
//   передние за край, конь клюёт носом, всадника подбрасывает, оба уходят
//   вниз, уменьшаясь и кувыркаясь, искры огня вверх; `escape` — пусто;
// - смерть 1,0 с: передние подломились, конь валится на бок, всадник
//   слетает, огонь гривы и копыт гаснет дымом.

import { registerMobPainter, registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import {
  F3,
  FPS,
  KRig,
  PI,
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

const HORSE = tn('#0a080c', '#1a161e', '#2e2834', '#4a4250');
const FIRE = tn('#8a1a06', '#e05010', '#ffa030', '#fff0a0');
const ARMOR = tn('#16121a', '#2e2636', '#4c4256', '#786a84');
const GOLD = tn('#5e3a10', '#9a6a1c', '#d8a23a', '#ffe28a');
const RED = tn('#34070b', '#641015', '#9e1e26', '#d8424a');
const HORN = tn('#2a221c', '#5e5040', '#a09076', '#e2d6bc');
const WOOD = tn('#1a100a', '#36241a', '#563c26', '#7a5a3a');
const STEEL = tn('#26262e', '#55556a', '#9a9aac', '#e8e8f2');
const LEATHER = tn('#140c08', '#2a1a10', '#46301e', '#6a4a30');
const EYE = hx('#ff4a20');
const STAR = hx('#ffe28a');
const DUST: RGBA[] = [hx('#6a5a50'), hx('#8a7a70'), hx('#4a3e38')];
const EMBER: RGBA[] = [hx('#ffa030'), hx('#e05010'), hx('#fff0a0')];
const SMOKE: RGBA[] = [hx('#3a3238'), hx('#4a4048'), hx('#2a2428')];

const SK = 1.05;
const LANCE_L = 28;

interface KnO {
  fwd: number;
  /** Конь: фаза шага, шаг (0 — стоит), галоп или шаг. */
  ph: number;
  step: number;
  gallop: number;
  /** Дыбы 0…1, присел на задние 0…1, упор передних 0…1, копыто бьёт 0…1. */
  rear: number;
  sit: number;
  brace: number;
  paw: number;
  /** Голова коня: вниз/вверх, мотает; огонь из ноздрей 0…1. */
  head: number;
  shake: number;
  snort: number;
  /** Грива и хвост отстают 0…1. */
  drag: number;
  /** Всадник: наклон, скрутка, копьё (курс, подъём, хват от комля, выпад). */
  lean: number;
  twist: number;
  ly: number;
  lp: number;
  grip: number;
  thrust: number;
  /** Звёзды (оглушён) 0…1; пад в бездну: клевок 0…1, всадника подбросило. */
  stars: number;
  dive: number;
  toss: number;
  /** Смерть: конь лёг 0…1, всадник слетел 0…1, огонь погас 0…1. */
  lie: number;
  off: number;
  out: number;
}

const K0: KnO = {
  fwd: 0,
  ph: 0,
  step: 0,
  gallop: 0,
  rear: 0,
  sit: 0,
  brace: 0,
  paw: 0,
  head: 0,
  shake: 0,
  snort: 0,
  drag: 0.15,
  lean: 0,
  twist: 0,
  ly: 0.25,
  lp: 1.05,
  grip: 10,
  thrust: 0,
  stars: 0,
  dive: 0,
  toss: 0,
  lie: 0,
  off: 0,
  out: 0,
};

/** Корпус коня: середина спины, наклон (дыбы — назад, клевок — вперёд). */
function bodyOf(B: F3, o: KnO): F3 {
  const z = 11 + o.rear * 3.2 - o.sit * 2.2 - o.lie * 7.2 - o.dive * 1.5;
  const x = o.fwd - o.rear * 2.4 - o.sit * 1.2;
  return B.at(x, 0, z)
    .pitch(-o.rear * 0.95 + o.sit * -0.28 + o.dive * 0.75)
    .roll(o.lie * 1.25);
}

/** Сиденье всадника и его рамка. */
function riderOf(C: F3, o: KnO): F3 {
  const R0 = C.at(-0.6 + o.off * -2.5, o.off * 4.5, 4.4 + o.toss * 6 - o.off * 2);
  return R0.pitch(o.lean + o.rear * 0.6 - o.toss * 0.9 + o.off * 1.1).turn(o.twist);
}

/** Копьё: комель, остриё, направление (мир). */
function lanceOf(R: F3, o: KnO): { butt: V3; tip: V3; d: V3 } {
  const cp = Math.cos(o.lp);
  const d = vnorm(R.v(cp * Math.cos(o.ly), cp * Math.sin(o.ly), Math.sin(o.lp)));
  const h = R.p(1.8 + o.thrust, 2.6, 3.2);
  const butt = vadd(h, vmul(d, -o.grip * SK));
  return { butt, tip: vadd(butt, vmul(d, LANCE_L * SK)), d };
}

function knightRig(o: KnO, yaw: number): KRig {
  const r = new KRig(SK);
  const B = F3.yaw(yaw).scale(SK);
  const cs = camSide(yaw);
  const C = bodyOf(B, o);
  const hm: Mat = { T: HORSE, spec: true };
  const fire = 1 - o.out;
  const fm: Mat = { T: FIRE, glow: 0.9 * fire, soft: true, flat: fire > 0.5 ? undefined : 1 };
  // Конь: бочка, грудь, круп.
  r.ell(C, [0, 0, 0], [6.6, 3.0, 3.4], hm);
  r.ell(C, [5.2, 0, 0.6], [2.8, 2.9, 3.4], hm);
  r.ell(C, [-5.4, 0, 0.8], [3.0, 3.1, 3.4], hm);
  // Попона и седло.
  for (const sd of [-1, 1])
    r.poly(
      [
        C.p(3.2, sd * 3.1, 2.8),
        C.p(-4.2, sd * 3.2, 2.8),
        C.p(-4.8 - o.drag * 1.5, sd * 3.6, -2.6),
        C.p(3.6 - o.drag, sd * 3.6, -2.4),
      ],
      { T: RED },
    );
  r.ell(C, [-0.4, 0, 3.4], [2.5, 2.7, 0.8], { T: LEATHER });
  r.cap(C.p(3.2, -3.0, 2.4), C.p(3.2, 3.0, 2.4), 0.35, 0.35, { T: GOLD });
  // Шея и голова.
  const nb = C.p(6.4, 0, 2.6);
  const N = C.at(9.0, 0, 7.4 - o.head * 2.0).turn(o.shake * 0.35);
  r.cap(nb, N.p(0, 0, 0), 2.3, 1.5, hm);
  const Hh = N.pitch(0.7 + o.head * 0.5);
  r.ell(Hh, [1.6, 0, -0.2], [2.6, 1.3, 1.4], hm);
  r.ell(Hh, [3.6, 0, -0.5], [1.2, 1.1, 1.0], { T: HORSE, bias: -0.1 });
  for (const sd of [-1, 1]) {
    r.spike(Hh.p(0.2, sd * 0.8, 1.0), Hh.v(-0.4, sd * 0.2, 1), 1.5, 0.45, hm, 3);
    if (fire > 0.3) r.dot(Hh.p(1.4, sd * 1.15, 0.4), alpha(EYE, fire), fire, 1, 0.6);
  }
  if (o.snort > 0)
    r.spike(Hh.p(4.4, 0, -0.7), Hh.v(1, 0, -0.4), 1.5 + 2.5 * o.snort, 0.8, { ...fm, glow: 0.9 * o.snort }, 4);
  // Грива: языки огня вдоль шеи, отстают назад.
  for (let i = 0; i < 5; i++) {
    const k = i / 4;
    const base = vlerp(N.p(-0.6, 0, 1.0), C.p(5.8, 0, 3.0), k);
    const dir = C.v(-0.6 - o.drag * 1.2, 0.15 * Math.sin(i * 2 + o.ph * TAU), 1.0 - o.drag * 0.3);
    r.spike(base, dir, (2.0 + 0.8 * (i % 2)) * (0.4 + 0.6 * fire), 0.9, fm, 4);
  }
  // Хвост — пламя.
  r.spike(C.p(-8.0, 0, 1.6), C.v(-1, 0.1 * Math.sin(o.ph * TAU), 0.5 - o.drag * 0.5), (4.0 + o.drag * 2) * (0.4 + 0.6 * fire), 1.2, fm, 5);
  // Ноги: передние и задние, шаг или галоп; дыбы, присед, упор, удар копытом.
  const legs: [number, number, number, boolean][] = [
    [5.0, 0.0, 0.25, true],
    [-5.4, 0.5, 0.75, false],
  ];
  for (const [hx0, phG, phW, front] of legs)
    for (const sd of [-1, 1]) {
      const legM: Mat = { T: HORSE, bias: sd === cs ? 0 : -0.2 };
      const hip = C.p(hx0, sd * 2.1, front ? -1.2 : -0.6);
      // Фаза: галоп — пары со сдвигом, шаг — четыре такта.
      const ph0 = o.gallop > 0.5 ? phG + (sd > 0 ? 0.1 : 0) : phW + (sd > 0 ? 0.5 : 0);
      const ps = (((o.ph + ph0) % 1) + 1) % 1;
      const st = o.gallop > 0.5 ? 0.4 : 0.6;
      const R = (o.gallop > 0.5 ? 4.6 : 2.6) * o.step;
      let off = 0;
      let rise = 0;
      if (ps < st) off = R - 2 * R * (ps / st);
      else {
        off = -R + 2 * R * ((ps - st) / (1 - st));
        rise = Math.sin(PI * ((ps - st) / (1 - st))) * (o.gallop > 0.5 ? 3.2 : 1.8) * o.step;
      }
      let foot = B.p(o.fwd + hx0 + off + (front ? 2.2 * o.brace : 0.4 * o.sit), sd * 2.3, rise);
      if (front && sd > 0 && o.paw > 0)
        foot = vlerp(foot, B.p(o.fwd + hx0 + 2.4, sd * 2.3, 3.4), o.paw);
      if (front && o.rear > 0)
        foot = vlerp(foot, C.p(hx0 + 3.0 + sd * 0.8, sd * 2.2, -4.2 + Math.sin(o.ph * TAU + sd) * 1.2), o.rear);
      if (o.dive > 0 && front) foot = vlerp(foot, C.p(hx0 + 4.0, sd * 2.0, -6.0), o.dive);
      if (o.lie > 0)
        foot = vlerp(foot, C.p(hx0 + (front ? 3 : -2), sd * 2.5 + 3.5, -5.5), o.lie);
      const mid = vlerp(hip, foot, 0.5);
      let hoof: V3;
      if (front) {
        const knee = vadd(mid, C.v(0.8 * (1 - o.rear) - 0.4 * o.rear, 0, 0.3));
        r.cap(hip, knee, 1.45, 0.9, legM);
        r.cap(knee, foot, 0.85, 0.6, legM);
        hoof = foot;
      } else {
        const stifle = vadd(mid, C.v(1.4, 0, 0.6));
        const hock = vadd(vlerp(stifle, foot, 0.6), C.v(-1.4, 0, 0.4));
        r.cap(hip, stifle, 1.9, 1.2, legM);
        r.cap(stifle, hock, 1.1, 0.7, legM);
        r.cap(hock, foot, 0.7, 0.6, legM);
        hoof = foot;
      }
      r.ball(hoof, 0.8, { T: FIRE, glow: 0.8 * fire, flat: fire > 0.5 ? undefined : 0 });
    }
  // Всадник.
  const R = riderOf(C, o);
  const am: Mat = { T: ARMOR, spec: true };
  const gold: Mat = { T: GOLD, spec: true };
  if (o.off < 0.9)
    for (const sd of [-1, 1]) {
      const hip = R.p(0, sd * 1.3, 0);
      const foot = vadd(C.p(0.6, sd * 3.6, -2.4), B.v(0, 0, o.toss * 5));
      arm(r, hip, foot, 3.6 * SK, 3.8 * SK, C.v(1, 0, 0), [1.2, 1.0, 0.85], am);
    }
  r.ell(R, [0, 0, 3.0], [1.9, 2.5, 3.2], am);
  r.ell(R, [0.2, 0, 0.6], [2.0, 2.6, 0.5], gold);
  r.ell(R, [0, 2.7, 5.4], [1.6, 1.5, 1.2], am);
  r.ell(R, [0, -2.7, 5.4], [1.6, 1.5, 1.2], am);
  const Hd = R.at(0.3, 0, 7.9);
  r.ball(Hd.p(0, 0, 0), 2.1, am);
  r.ell(Hd, [1.3, 0, -0.4], [1.0, 1.6, 1.2], { T: ARMOR, bias: -0.15 });
  for (const sd of [-1, 1]) {
    const h0 = Hd.p(0, sd * 1.8, 0.9);
    const h1 = vadd(h0, Hd.v(-0.6, sd * 1.9, 1.3));
    const h2 = vadd(h1, Hd.v(1.0, sd * 0.3, 2.0));
    r.cap(h0, h1, 0.7, 0.5, { T: HORN });
    r.cap(h1, h2, 0.5, 0.15, { T: HORN });
    if (o.stars < 0.5 && o.out < 0.8) r.dot(Hd.p(2.0, sd * 0.6, -0.2), EYE, 1, 1, 0.6);
  }
  r.eye = o.out < 0.5 ? Hd.p(2.0, cs * 0.6, -0.2) : null;
  // Копьё (правая) и повод (левая).
  const L = lanceOf(R, o);
  const hR = vadd(L.butt, vmul(L.d, o.grip * SK));
  const hL = vadd(C.p(4.6, -0.8, 3.6), B.v(0, 0, o.toss * 4));
  arm(r, R.p(0, 2.7, 5.0), hR, 3.2 * SK, 3.2 * SK, R.v(-1, 0.4, -0.4), [1.0, 0.85, 0.8], am);
  arm(r, R.p(0, -2.7, 5.0), hL, 3.2 * SK, 3.2 * SK, R.v(-1, -0.4, -0.4), [1.0, 0.85, 0.8], am);
  r.ball(hR, 0.9, gold);
  r.cap(L.butt, L.tip, 0.5, 0.4, { T: WOOD });
  r.cap(vadd(L.butt, vmul(L.d, (o.grip - 1.2) * SK)), vadd(L.butt, vmul(L.d, (o.grip + 1.0) * SK)), 1.0, 0.6, { T: STEEL });
  r.spike(L.tip, L.d, 3.4, 0.7, { T: STEEL, spec: true }, 4);
  // Вымпел у острия — отстаёт по ходу.
  const pb = vadd(L.tip, vmul(L.d, -2.0 * SK));
  const pw = vadd(pb, vmul(L.d, -3.2 * SK));
  const fl = B.v(-1.6 - o.drag * 2.4, 0, -0.8);
  r.poly([pb, pw, vadd(pw, fl), vadd(pb, vadd(fl, B.v(-1.2, 0, -0.6)))], { T: RED });
  return r;
}

// ---- Треки ----------------------------------------------------------------

const AIM_T = 0.95;
const LANCE_T = 0.55;

const COUCH = { ly: 0.04, lp: 0.08, grip: 12 };

function aimO(T: number): KnO {
  const o: KnO = { ...K0 };
  const k = sstep(0, 0.5, T);
  o.ly = 0.25 + (COUCH.ly - 0.25) * k;
  o.lp = 1.05 + (COUCH.lp - 1.05) * easeOut(k);
  o.grip = 10 + (COUCH.grip - 10) * k;
  o.lean = 0.35 * sstep(0.3, 0.8, T);
  // Конь бьёт копытом дважды (0,05–0,25 и 0,3–0,5).
  o.paw = Math.max(Math.sin(PI * clamp01((T - 0.05) / 0.2)), Math.sin(PI * clamp01((T - 0.3) / 0.2)));
  o.head = trk(T, [
    [0, 0],
    [0.15, 0.6],
    [0.3, -0.2],
    [0.45, 0.6],
    [0.6, 0.3],
    [AIM_T, 0.5],
  ]);
  o.sit = trk(T, [
    [0.5, 0],
    [0.8, 0.55, easeOut],
    [AIM_T, 0.6],
  ]);
  o.snort = T > 0.55 ? 0.5 + 0.5 * Math.sin(T * 30) : 0;
  if (T > 0.8) {
    const j = Math.floor(T * FPS) % 2 ? 0.25 : -0.25;
    o.fwd += j;
    o.snort = 1;
  }
  return o;
}

function skidO(T: number): KnO {
  const o: KnO = { ...K0, ...COUCH };
  o.sit = trk(T, [
    [0, 0.2],
    [0.12, 0.9, easeOut],
    [0.45, 0.8],
    [0.7, 0],
  ]);
  o.brace = trk(T, [
    [0, 0.3],
    [0.1, 1],
    [0.5, 0.8],
    [0.7, 0],
  ]);
  o.lean = trk(T, [
    [0, 0.4],
    [0.12, 0.7, easeOut],
    [0.3, -0.25],
    [0.7, 0],
  ]);
  o.head = trk(T, [
    [0, 0.2],
    [0.2, -0.5],
    [0.7, 0],
  ]);
  o.lp = COUCH.lp + 0.9 * sstep(0.15, 0.6, T);
  o.ly = COUCH.ly + 0.2 * sstep(0.15, 0.6, T);
  o.grip = COUCH.grip - 2 * sstep(0.15, 0.6, T);
  o.drag = 1 - sstep(0, 0.5, T);
  return o;
}

function dizzyO(T: number): KnO {
  // О кладку: на дыбы (0–0,45), опустился (0,45–0,65), шатается.
  const o: KnO = { ...K0 };
  o.rear = trk(T, [
    [0, 0.2],
    [0.18, 1, easeOut],
    [0.4, 0.95],
    [0.62, 0, easeIn],
  ]);
  o.ph = T * 3;
  o.head = trk(T, [
    [0, -0.6],
    [0.3, -0.8],
    [0.7, 0.6],
  ]);
  o.lean = trk(T, [
    [0, -0.4],
    [0.3, -0.2],
    [0.7, 0.3],
  ]);
  o.lp = 1.3;
  o.ly = 0.6;
  o.grip = 9;
  o.stars = sstep(0.35, 0.6, T);
  o.shake = T > 0.62 ? Math.sin((T - 0.62) * 9) : 0;
  o.sit = T > 0.62 ? 0.15 : 0;
  return o;
}

function lanceO(T: number): KnO {
  // Отвёл копьё (0–0,35), задержка (0,35–0,55); контакт — T = 0,55;
  // выпад на всю длину (0,55–0,62), держит, возврат.
  const o: KnO = { ...K0 };
  const back = { ly: 0.1, lp: 0.12, grip: 14 };
  if (T < 0.35) {
    const k = easeOut(T / 0.35);
    o.ly = 0.25 + (back.ly - 0.25) * k;
    o.lp = 1.05 + (back.lp - 1.05) * k;
    o.grip = 10 + (back.grip - 10) * k;
    o.thrust = -2.2 * k;
    o.twist = 0.5 * k;
  } else if (T < LANCE_T) {
    Object.assign(o, back);
    o.thrust = -2.4;
    o.twist = 0.55;
    o.fwd += Math.floor(T * FPS) % 2 ? 0.2 : -0.2;
  } else {
    const k = easeOut(sstep(LANCE_T, LANCE_T + 0.06, T));
    const ret = sstep(LANCE_T + 0.3, LANCE_T + 0.6, T);
    Object.assign(o, back);
    o.thrust = -2.4 + 6.4 * k * (1 - ret) + 2.4 * ret * 0;
    o.thrust = o.thrust * (1 - ret);
    o.twist = 0.55 - 0.85 * k * (1 - ret) - 0.55 * ret * (1 - k);
    o.ly = back.ly + (0.25 - back.ly) * ret;
    o.lp = back.lp + (1.05 - back.lp) * ret;
    o.grip = back.grip + (10 - back.grip) * ret;
    o.lean = 0.35 * k * (1 - ret);
  }
  o.head = 0.3 * sstep(0, 0.35, T) * (1 - sstep(LANCE_T + 0.3, LANCE_T + 0.6, T));
  return o;
}

function fallO(T: number): KnO {
  const o: KnO = { ...K0, ...COUCH };
  o.dive = sstep(0, 0.3, T);
  o.toss = trk(T, [
    [0.05, 0],
    [0.3, 1, easeOut],
    [0.6, 0.6],
  ]);
  o.head = 0.8;
  o.drag = 1;
  o.lp = COUCH.lp + 1.4 * sstep(0.1, 0.5, T);
  o.ly = 0.6 * sstep(0.1, 0.5, T);
  return o;
}

function knPose(anim: string, f: number): KnO {
  const t = (f + 0.5) / FPS;
  switch (anim) {
    case 'stand': {
      const a = (f / 8) * TAU;
      return { ...K0, head: 0.15 + 0.15 * Math.sin(a), ph: f / 8, shake: f === 5 ? 0.4 : 0 };
    }
    case 'walk':
      return { ...K0, ph: f / 8, step: 1, head: 0.2 + 0.1 * Math.sin((f / 8) * TAU * 2), drag: 0.35 };
    case 'gallop': {
      const a = (f / 8) * TAU;
      return {
        ...K0,
        ...COUCH,
        ph: f / 8,
        step: 1,
        gallop: 1,
        lean: 0.35,
        drag: 1,
        head: 0.35 + 0.2 * Math.sin(a),
        fwd: 0.4 * Math.sin(a),
      };
    }
    case 'aim':
      return aimO(Math.min(t, AIM_T - 0.005));
    case 'skid':
      return skidO(t);
    case 'dizzy':
      return dizzyO(t);
    case 'daze': {
      const a = (f / 8) * TAU;
      return {
        ...dizzyO(0.9),
        shake: Math.sin(a),
        stars: 1,
        head: 0.6 + 0.15 * Math.sin(a * 2),
        lean: 0.3 + 0.1 * Math.sin(a),
      };
    }
    case 'lance':
      return lanceO(Math.min(t, LANCE_T - 0.005));
    case 'lancef':
      return lanceO(LANCE_T + t - 0.5 / FPS + 0.01);
    case 'fall':
      return fallO(t);
    case 'flinch': {
      const k = f / 4;
      const b = Math.sin(PI * Math.min(1, k * 1.25)) * (1 - k * 0.5);
      return { ...K0, lean: -0.45 * b, head: -0.6 * b, fwd: -1.2 * b, rear: 0.25 * b, lp: 1.05 + 0.3 * b };
    }
    case 'die': {
      // 24 кадра (1,0 с): передние подломились (0–0,3), валится на бок
      // (0,3–0,6), всадник слетает (0,2–0,55), огонь гаснет дымом.
      const o: KnO = { ...K0 };
      o.dive = trk(t, [
        [0, 0],
        [0.3, 0.7, easeIn],
        [0.55, 0.3],
      ]);
      o.lie = trk(t, [
        [0.25, 0],
        [0.6, 1, easeIn],
        [0.66, 0.92],
        [0.72, 1],
      ]);
      o.off = trk(t, [
        [0.2, 0],
        [0.55, 1, easeIn],
      ]);
      o.head = trk(t, [
        [0, -0.6],
        [0.3, 0.6],
        [0.7, 1.0],
      ]);
      o.lp = 1.05 + 1.2 * sstep(0.2, 0.6, t);
      o.out = sstep(0.3, 0.75, t);
      o.drag = 0.6;
      return o;
    }
  }
  return { ...K0 };
}

// ---- Кадр -----------------------------------------------------------------

const KN = kindOf('knight', 90, 84, 45, 64, 1500);

const knPic = (anim: string, f: number, d: number): Pic => {
  const o0 = knPose(anim, f);
  const yaw = yawN(d);
  return draw(KN, knightRig(o0, yaw), (o, P) => {
    const B = F3.yaw(yaw).scale(SK);
    const C = bodyOf(B, o0);
    const R = riderOf(C, o0);
    if (anim === 'skid' && f < 12) {
      // Пыль из-под копыт.
      const [x, y] = P(B.p(o0.fwd + 6, 0, 0));
      spray(o.p, x, y, 10, 10, (f + 2) / 12, 13 + f, DUST, 2, 3);
    }
    if (anim === 'aim' && (f === 4 || f === 5 || f === 10 || f === 11)) {
      const [x, y] = P(B.p(o0.fwd + 7.4, 2.3, 0));
      spray(o.p, x, y, 6, 5, (f % 6) / 2 + 0.3, 7 + f, DUST, 1, 2);
    }
    if (o0.stars > 0) {
      const Hd = R.at(0.3, 0, 10.6);
      for (let i = 0; i < 3; i++) {
        const a = f * 0.55 + (i / 3) * TAU;
        const [x, y] = P(vadd(Hd.p(0, 0, 0), B.v(Math.cos(a) * 3.2, Math.sin(a) * 3.2, 0)));
        spark2(o, x, y, STAR, 0.8 * o0.stars);
        spark2(o, x + 1, y, alpha(STAR, 160), 0.4 * o0.stars);
      }
    }
    if ((anim === 'lancef' && f <= 2) || (anim === 'lance' && f >= 13)) {
      const L0 = lanceOf(R, o0);
      const prev = knPose(anim === 'lancef' && f === 0 ? 'lance' : anim, anim === 'lancef' && f === 0 ? 13 : Math.max(0, f - 1));
      const Rp = riderOf(bodyOf(B, prev), prev);
      const L1 = lanceOf(Rp, prev);
      smear(o, [P(L1.tip), P(L0.tip)], [P(vadd(L1.tip, vmul(L1.d, -6))), P(vadd(L0.tip, vmul(L0.d, -6)))], hx('#e8e4f4', 200), 0.5);
      if (anim === 'lancef' && f === 0) {
        const [x, y] = P(vadd(L0.tip, vmul(L0.d, 3.4)));
        spark2(o, x, y, hx('#ffffff'));
        spark2(o, x + 1, y, hx('#ffe0a0'), 0.8);
        spark2(o, x - 1, y, hx('#ffe0a0'), 0.8);
      }
    }
    if (anim === 'fall' && f >= 4) {
      const [x, y] = P(B.p(0, 0, 4));
      spray(o.p, x, y, 10, 12, (f - 3) / 18, 61, EMBER, -6, 10);
    }
    if (anim === 'die' && f >= 10) {
      const [x, y] = P(B.p(2, 2, 6));
      spray(o.p, x, y, 10, 9, (f - 9) / 14, 91, SMOKE, -3, 10);
    }
  });
};

const TECH = new Set(['aim', 'charge', 'skid', 'dizzy', 'lance', 'recover', 'f10_fall', 'f10_patrol']);

registerMobPainter('f10_knight', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = pose.t;
  const now = pose.now || 0;
  const want = md === 'f10_patrol' ? (m.data?.look ?? m.face ?? 0) : TECH.has(md) ? (m.face ?? 0) : headOf(m);
  const v = visOf(m, pose, want, md === 'charge' ? 20 : 5);
  const d = dirN(v.yaw);
  const ex: Partial<MobFrame> = { shadow: 11 };
  let anim = 'stand';
  let f = 0;
  const id = m.id ?? 0;
  if (md === 'dying') {
    f = fi(t, 23);
    anim = 'die';
    ex.linger = 1.0;
    ex.alpha = 1 - sstep(0.85, 1.0, t);
    ex.still = true;
  } else if (md === 'f10_fall' || md === 'escape') {
    // В бездну: уходит вниз, уменьшаясь; тени нет — под ним пропасть.
    const T = md === 'escape' ? 0.9 : t;
    f = fi(T, 21);
    anim = 'fall';
    const k = sstep(0.2, 0.9, T);
    ex.dy = 26 * easeIn(k);
    ex.sx = 1 - 0.55 * k;
    ex.sy = 1 - 0.55 * k;
    ex.rot = 0.6 * easeIn(k);
    ex.alpha = md === 'escape' ? 0 : 1 - sstep(0.55, 0.9, T);
    ex.shadow = 0;
    ex.still = true;
  } else if (md === 'aim') {
    f = fi(t, 22);
    anim = 'aim';
    ex.still = true;
  } else if (md === 'charge') {
    f = Math.floor((v.dist / 3.4) * 8) % 8;
    anim = 'gallop';
    ex.still = true;
    ex.ghost = { every: 0.03, life: 0.16, tint: '#ff7a2a', alpha: 0.28 };
  } else if (md === 'skid') {
    f = fi(t, 16);
    anim = 'skid';
    ex.still = true;
  } else if (md === 'dizzy') {
    if (t < 0.75) {
      f = fi(t, 17);
      anim = 'dizzy';
    } else {
      f = Math.floor(now * 8) % 8;
      anim = 'daze';
    }
    ex.still = true;
  } else if (md === 'lance') {
    f = fi(t, 13);
    anim = 'lance';
    ex.still = true;
  } else if (md === 'recover' && v.prev === 'lance') {
    f = fi(t, 14);
    anim = 'lancef';
    ex.still = true;
  } else if (md === 'stun' || hurtAge(v, now) < 0.2) {
    f = fi(md === 'stun' ? t : hurtAge(v, now), 4);
    anim = 'flinch';
  } else if (moving(m, 0.5)) {
    f = Math.floor((v.dist / 1.8) * 8) % 8;
    anim = 'walk';
  } else {
    f = Math.floor((now + hash(id, 7) * 4) * 4) % 8;
    anim = 'stand';
  }
  if (md !== 'dying' && md !== 'f10_fall' && md !== 'escape') hurtFx(v, now, 1.0, ex);
  return { ...frameOf(KN, anim, f, d, pose, () => knPic(anim, f, d)), ...ex };
});

registerMobWarm('f10_knight', function* () {
  yield* warmAll(
    KN,
    [
      ['stand', 8],
      ['walk', 8],
      ['aim', 23],
      ['gallop', 8],
      ['skid', 17],
      ['lance', 14],
      ['lancef', 15],
      ['dizzy', 18],
      ['daze', 8],
      ['fall', 22],
      ['flinch', 5],
      ['die', 24],
    ],
    knPic,
  );
});
