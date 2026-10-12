// Палач (анимации мобов 10): громила в чёрном колпаке с прорезями, голый
// торс, кожаный фартук; в правой — секира, в левой — цеп на цепи. Ходит
// тяжело, туда, куда идёт, 8 сторон (несимметричен — все рисуются честно).
//
// Метроном — `f10-brains.ts` (`f10_exec`, `EXEC`):
// - пост `f10_stand` — опёрся на секиру, лицом на юг; `alertpost` 0,6 с —
//   вскинул голову, рывком поднял секиру на плечо, цеп сорвался и закачался;
// - цеп `flail` 1,0 с: левая рука вверх, шар идёт кругом над головой всё
//   быстрее, присед; 0,85–1,0 — самый быстрый круг (задержка на пике);
//   кадр контакта — первый кадр `recover`: цепь уходит в кольцо у пола
//   (r 2,35) и обходит его — тут бьёт мозг; дальше шар бухается об пол,
//   палач подтягивает его и встаёт;
// - секира `chop` 0,8 с: шаг левой, секира двумя руками за голову, прогиб,
//   0,55–0,76 — задержка с дрожью; кадр контакта — первый кадр `recover`:
//   лезвие в полу в 1,05 клетки впереди, удар отдаёт в корпус; секира
//   застряла — рывок, выдернул, на плечо;
// - смерть 0,9 с: секира выпала, шатнулся, на колени, ничком; цеп
//   откатился, пыль.

import { registerImpactPainter, registerMobPainter, registerMobWarm } from '../dungeon-paint';
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
  smooth,
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
  vsub,
  warmAll,
  yawN,
} from './f10-mobs';
import type { Pic, RGBA, RigOut, V3 } from './f10-mobs';
import type { Mat } from './f15-rig';

const SKIN = tn('#2e1a18', '#5a3a32', '#84584a', '#a8806a');
const HOOD = tn('#060506', '#161218', '#28222a', '#3e363e');
const APRON = tn('#1e120a', '#3a2412', '#5a3a1e', '#7a522e');
const IRON = tn('#1a1a20', '#3a3a44', '#62626e', '#a0a0ac');
const WOOD = tn('#1a100a', '#362418', '#563a24', '#7a5634');
const BELT = tn('#120a08', '#24160e', '#3a2616', '#563a22');
const BLOOD = hx('#8a1a1e');
const EYE = hx('#ff3020');
const DUST: RGBA[] = [hx('#6a5a50'), hx('#8a7a70'), hx('#4a3e38')];
const SPARK = hx('#fff0c0');
const SMEAR = hx('#d8d4e4');

const SK = 1.5;
/** Секира: длина топорища, где на нём лезвие. */
const HAFT = 13;
/** Длина цепи в покое. */
const CHAIN = 5.5;

interface ExO {
  fwd: number;
  side: number;
  bob: number;
  lean: number;
  twist: number;
  roll: number;
  crouch: number;
  head: number;
  hturn: number;
  /** Ступни — в рамке курса (x — вперёд, y — вправо). */
  fR: V3;
  fL: V3;
  /** Секира: правая кисть, угол топорища (φ — вверх от «вперёд», ψ — вбок), хват от торца. */
  aH: V3;
  aPhi: number;
  aPsi: number;
  aGrip: number;
  /** Левая на топорище (0…1) и где (доля от торца). */
  both: number;
  bothAt: number;
  /** Цеп: левая кисть и шар (рамка курса), провис цепи. */
  fH: V3;
  fB: V3;
  sag: number;
  /** Секира в полу 0…1 (лезвие уходит в плиты), выпала (смерть). */
  dropAxe: number;
  dust: number;
}

const E0: ExO = {
  fwd: 0,
  side: 0,
  bob: 0,
  lean: 0,
  twist: 0,
  roll: 0,
  crouch: 0,
  head: 0,
  hturn: 0,
  fR: [0.3, 2.3, 0],
  fL: [0.3, -2.3, 0],
  aH: [2.2, 3.6, 7.2],
  aPhi: 1.15,
  aPsi: -0.25,
  aGrip: 3,
  both: 0,
  bothAt: 2,
  fH: [1.8, -4.2, 8.6],
  fB: [2.0, -4.4, 3.0],
  sag: 0.4,
  dropAxe: 0,
  dust: 0,
};

interface Fr {
  B: F3;
  P: F3;
  T: F3;
  Hd: F3;
}

function framesOf(o: ExO, yaw: number): Fr {
  const B = F3.yaw(yaw).scale(SK);
  const hipZ = 8.2 - 2.2 * o.crouch + o.bob;
  const P = B.at(o.fwd, o.side, hipZ)
    .roll(o.roll)
    .pitch(o.lean * 0.45);
  const T = P.at(0, 0, 1.4)
    .pitch(o.lean * 0.55)
    .turn(o.twist);
  const Hd = T.at(0.7, 0, 9.0)
    .pitch(-o.lean + o.head)
    .turn(o.hturn);
  return { B, P, T, Hd };
}

/** Секира в мире: торец, кисть, лезвие (центр), направление топорища и острия. */
function axeOf(B: F3, o: ExO) {
  const c = Math.cos(o.aPhi);
  const d = vnorm(B.v(c * Math.cos(o.aPsi), c * Math.sin(o.aPsi), Math.sin(o.aPhi)));
  // Острие смотрит туда, куда секира идёт при ударе (уменьшение φ).
  const s = Math.sin(o.aPhi);
  const e = vnorm(B.v(s * Math.cos(o.aPsi), s * Math.sin(o.aPsi), -c));
  const hand = B.p(o.aH[0], o.aH[1], o.aH[2]);
  const butt = vadd(hand, vmul(d, -o.aGrip * SK));
  const head = vadd(butt, vmul(d, (HAFT - 1.2) * SK));
  return { d, e, hand, butt, head };
}

function execRig(o: ExO, yaw: number): KRig {
  const r = new KRig(SK);
  const { B, P, T, Hd } = framesOf(o, yaw);
  const skin: Mat = { T: SKIN };
  const hood: Mat = { T: HOOD, spec: true };
  const apron: Mat = { T: APRON };
  const iron: Mat = { T: IRON, spec: true };
  // Ноги: бёдра → колени (вперёд) → сапоги.
  for (const sd of [-1, 1]) {
    const f = sd > 0 ? o.fR : o.fL;
    const foot = B.p(f[0], f[1], f[2] + 1.0);
    leg(
      r,
      P.p(0, sd * 2.1, -0.4),
      foot,
      4.4 * SK,
      4.3 * SK,
      B.v(1, sd * 0.2, 0),
      [1.9, 1.5, 1.2],
      skin,
    );
    r.ell(B.at(f[0] + 0.6, f[1], f[2] + 0.9), [0, 0, 0], [1.9, 1.2, 1.0], { T: BELT });
  }
  // Пузо, грудь, плечи, пояс.
  r.ell(P, [0.9, 0, 1.6], [3.9, 3.9, 3.2], skin);
  r.ell(T, [0.4, 0, 5.2], [3.4, 4.3, 3.3], skin);
  for (const sd of [-1, 1]) r.ball(T.p(0, sd * 3.9, 7.0), 2.0, skin);
  r.ell(P, [0.1, 0, 1.4], [3.5, 3.9, 0.7], { T: BELT });
  r.ball(P.p(3.4, 0, 1.4), 0.7, iron);
  // Фартук: от груди до колен, низ отстаёт.
  const ap = (a: number, s: number, u: number) => T.p(a, s, u);
  const apL = vadd(P.p(3.6, -2.6, -5.6), B.v(-o.lean * 1.2, 0, 0));
  const apR = vadd(P.p(3.6, 2.6, -5.6), B.v(-o.lean * 1.2, 0, 0));
  r.poly(
    [ap(2.9, -2.4, 6.4), ap(2.9, 2.4, 6.4), P.p(3.7, 3.0, 1.0), apR, apL, P.p(3.7, -3.0, 1.0)],
    apron,
  );
  // Капюшон-колпак: шар, конус, пелерина на плечах; прорези глаз горят.
  r.ell(T, [0.1, 0, 8.2], [2.8, 3.8, 1.3], hood);
  r.ball(Hd.p(0, 0, 0), 2.5, hood);
  r.spike(Hd.p(-0.4, 0, 1.4), Hd.v(-0.45, 0, 1), 4.0, 1.9, hood, 6);
  for (const sd of [-1, 1]) r.dot(Hd.p(2.3, sd * 0.85, 0.3), EYE, 0.9, 1, 0.6);
  r.eye = Hd.p(2.3, 0.85, 0.3);
  // Секира в правой.
  const A = axeOf(B, o);
  const sh = (sd: number) => T.p(0.1, sd * 4.0, 6.8);
  arm(r, sh(1), A.hand, 4.0 * SK, 4.0 * SK, T.v(-1, 0.6, -0.4), [1.6, 1.3, 1.1], skin);
  r.ball(A.hand, 1.1, skin);
  r.cap(A.butt, vadd(A.butt, vmul(A.d, HAFT * SK)), 0.55, 0.5, { T: WOOD });
  const hb = A.head;
  const bl = (k: number, e: number): V3 => vadd(hb, vadd(vmul(A.d, k * SK), vmul(A.e, e * SK)));
  r.poly([bl(1.6, 0.4), bl(2.8, 3.6), bl(0.2, 4.6), bl(-2.4, 3.6), bl(-1.4, 0.4)], {
    T: IRON,
    spec: true,
  });
  r.cap(bl(2.6, 3.8), bl(-2.2, 3.8), 0.3, 0.3, {
    T: tn('#62626e', '#a0a0ac', '#d8d8e4', '#ffffff'),
  });
  r.spike(hb, vmul(A.e, -1), 1.8, 0.6, iron, 3);
  r.dot(bl(0.4, 2.2), BLOOD, 0, 1, 0.3);
  // Левая: на топорище или с цепом.
  const lh =
    o.both > 0
      ? vlerp(B.p(o.fH[0], o.fH[1], o.fH[2]), vadd(A.butt, vmul(A.d, o.bothAt * SK)), o.both)
      : B.p(o.fH[0], o.fH[1], o.fH[2]);
  arm(r, sh(-1), lh, 4.0 * SK, 4.0 * SK, T.v(-1, -0.6, -0.4), [1.6, 1.3, 1.1], skin);
  r.ball(lh, 1.1, skin);
  // Цеп: рукоять, цепь с провисом, шар с шипами.
  const ball = B.p(o.fB[0], o.fB[1], o.fB[2]);
  const hd = vnorm(vsub(ball, lh));
  const h2 = vadd(lh, vmul(hd, 1.6 * SK));
  r.cap(lh, h2, 0.45, 0.4, { T: WOOD });
  const n = 5;
  let prev = h2;
  for (let i = 1; i <= n; i++) {
    const k = i / n;
    const q = vadd(vlerp(h2, ball, k), B.v(0, 0, -o.sag * 4 * k * (1 - k)));
    r.cap(prev, q, 0.28, 0.28, { T: IRON });
    prev = q;
  }
  r.ball(ball, 1.25, iron);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    r.spike(ball, B.v(Math.cos(a), Math.sin(a), i % 2 ? 0.8 : -0.5), 1.0, 0.35, iron, 3);
  }
  return r;
}

// ---- Треки ----------------------------------------------------------------

const FLAIL_T = 1.0;
const CHOP_T = 0.8;

/** Пост: опёрся на секиру — лезвие на полу перед собой, обе руки на торце. */
const POST: Partial<ExO> = {
  aH: [3.0, 0.7, 11.4],
  aPhi: -1.42,
  aPsi: 0.05,
  aGrip: 0.8,
  both: 1,
  bothAt: 1.6,
  fH: [3.0, -0.8, 11.0],
  fB: [2.8, -2.4, 4.4],
  sag: 0.6,
};

function blendO(a: ExO, b: Partial<ExO>, k: number): ExO {
  const o: ExO = { ...a };
  for (const key of Object.keys(b) as (keyof ExO)[]) {
    const va = a[key];
    const vb = b[key];
    if (Array.isArray(va) && Array.isArray(vb))
      (o[key] as V3) = [
        va[0] + (vb[0] - va[0]) * k,
        va[1] + (vb[1] - va[1]) * k,
        va[2] + (vb[2] - va[2]) * k,
      ];
    else (o[key] as number) = (va as number) + ((vb as number) - (va as number)) * k;
  }
  return o;
}

/** Шар цепа, висящий под кистью: качается маятником (угол a вперёд-назад, b вбок). */
function hang(h: V3, a: number, b: number, L = CHAIN): V3 {
  return [h[0] + Math.sin(a) * L, h[1] + Math.sin(b) * L, h[2] - Math.cos(a) * Math.cos(b) * L];
}

function idleO(f: number): ExO {
  const a = (f / 8) * TAU;
  const o: ExO = { ...E0 };
  o.bob = 0.25 * Math.sin(a);
  o.lean = 0.05 * Math.sin(a);
  o.head = 0.06 * Math.sin(a - 0.7);
  o.aH = [2.2, 3.6, 7.2 + 0.25 * Math.sin(a)];
  o.fH = [1.8, -4.2, 8.6 + 0.2 * Math.sin(a)];
  o.fB = hang(o.fH, 0.18 * Math.sin(a - 1.2), 0.08 * Math.sin(a * 0.5));
  return o;
}

function walkO(f: number): ExO {
  const ph = f / 8;
  const a = ph * TAU;
  const o: ExO = { ...E0 };
  const L = 3.2;
  const st = (p: number): [number, number] => {
    const q = ((p % 1) + 1) % 1;
    if (q < 0.5) return [L * (0.5 - q * 2), 0];
    const k = (q - 0.5) / 0.5;
    return [L * (-0.5 + smooth(k)), Math.sin(PI * k)];
  };
  const [r0, ru] = st(ph);
  const [l0, lu] = st(ph + 0.5);
  o.fR = [0.3 + r0, 2.3, 1.4 * ru];
  o.fL = [0.3 + l0, -2.3, 1.4 * lu];
  // Тяжёлый ход: присед на опоре, перекат с ноги на ногу.
  o.bob = -0.5 * Math.abs(Math.cos(a)) + 0.2;
  o.roll = 0.07 * Math.sin(a);
  o.twist = -0.12 * Math.sin(a);
  o.lean = 0.12;
  o.aH = [2.2 + 0.4 * Math.sin(a), 3.6, 7.2 + 0.4 * Math.abs(Math.cos(a))];
  o.aPhi = E0.aPhi + 0.08 * Math.sin(a);
  o.fH = [1.8 - 1.0 * Math.sin(a), -4.2, 8.4];
  // Шар отстаёт от руки.
  o.fB = hang(o.fH, -0.35 - 0.3 * Math.sin(a - 1.1), 0.1 * Math.sin(a));
  return o;
}

function alertO(T: number): ExO {
  // Пост → вскинулся: голова (0–0,15), рывок секиры на плечо (0,1–0,35),
  // цеп сорвался и качается (0,15–0,6).
  const k = sstep(0.1, 0.36, T);
  const o = blendO(blendO(E0, POST, 1), E0, k);
  o.head = trk(T, [
    [0, 0.1],
    [0.1, -0.35, easeOut],
    [0.3, -0.1],
    [0.6, 0],
  ]);
  o.bob = trk(T, [
    [0, 0],
    [0.1, -0.6],
    [0.25, 0.5],
    [0.45, 0],
  ]);
  o.lean = -0.15 * Math.sin(PI * sstep(0.05, 0.4, T));
  const sw = Math.max(0, T - 0.18);
  o.fB = vlerpA(
    POST.fB as V3,
    hang(o.fH, 0.8 * Math.cos(sw * 11) * Math.exp(-sw * 3), 0.2 * Math.sin(sw * 9)),
    sstep(0.12, 0.3, T),
  );
  return o;
}

const vlerpA = (a: V3, b: V3, k: number): V3 => [
  a[0] + (b[0] - a[0]) * k,
  a[1] + (b[1] - a[1]) * k,
  a[2] + (b[2] - a[2]) * k,
];

/** Угол шара цепа над головой (0–1 с): разгон, к концу — самый быстрый круг. */
const spinA = (T: number) => TAU * (0.6 * T + 2.4 * T * T);

function flailO(T: number): ExO {
  const o: ExO = { ...E0 };
  const up = sstep(0, 0.22, T);
  o.crouch = 0.35 * sstep(0.15, 0.6, T);
  o.lean = -0.12 * up;
  o.head = -0.25 * up;
  o.twist = -0.2 * up;
  // Левая — над головой, чуть впереди; круг растёт.
  const hand: V3 = [1.0, -2.4 + 1.6 * up, 8.6 + 9.6 * up - 0.6 * o.crouch];
  o.fH = hand;
  const R = 2.0 + 5.0 * sstep(0.1, 0.7, T);
  const a = spinA(T);
  const swing = hang(hand, 0.25, 0, CHAIN);
  const ring: V3 = [
    hand[0] + Math.cos(a) * R,
    hand[1] + Math.sin(a) * R,
    hand[2] + 0.8 - 1.4 * (1 - up),
  ];
  o.fB = vlerpA(swing, ring, sstep(0.05, 0.25, T));
  o.sag = 0.4 * (1 - up);
  // Секира — к себе, на плечо.
  o.aH = [1.9, 3.8, 7.6];
  if (T > 0.85) {
    const j = Math.floor(T * FPS) % 2 ? 0.2 : -0.2;
    o.fwd += j;
  }
  return o;
}

/** После цепа (recover 1,05 с): кадр 0 — контакт, цепь кольцом у пола. */
function flailfO(T: number, f: number): ExO {
  const o: ExO = { ...E0 };
  const k = sstep(0.12, 0.3, T);
  const ret = sstep(0.4, 0.8, T);
  o.crouch = 0.6 - 0.2 * k - 0.4 * ret;
  o.lean = 0.2 * (1 - ret);
  o.twist = -0.35 * (1 - ret);
  o.aH = [1.9, 3.8, 7.6];
  if (f <= 3) {
    // Цепь вытянута до кольца (r 2,35 клетки ≈ 25 единиц), шар у пола обходит круг.
    const a = spinA(FLAIL_T) + f * 1.3;
    const hand: V3 = [1.6, -1.0, 13.0];
    o.fH = hand;
    o.fB = [Math.cos(a) * 24, Math.sin(a) * 24, 2.0];
    o.sag = 0;
    return o;
  }
  // Шар бухнулся об пол (≈0,2 с), палач подтягивает его и встаёт.
  const hand: V3 = vlerpA([2.6, -3.0, 9.0], E0.fH, ret);
  o.fH = hand;
  const fall: V3 = [9.0 - 7.0 * k, -6.0 + 1.6 * k, 1.2];
  o.fB = vlerpA(fall, hang(hand, -0.4 * Math.cos(T * 8) * (1 - ret), 0), sstep(0.3, 0.75, T));
  o.sag = 0.7 * (1 - sstep(0.3, 0.7, T));
  o.dust = T > 0.12 && T < 0.4 ? (T - 0.12) / 0.28 : 0;
  return o;
}

/** Секира: шаг левой, двумя руками за голову, прогиб, задержка, срыв. */
function chopO(T: number): ExO {
  const o: ExO = { ...E0 };
  const k = sstep(0.05, 0.5, T);
  const step = sstep(0, 0.2, T);
  o.fL = [0.3 + 2.0 * step, -2.4, 1.2 * Math.sin(PI * step)];
  o.fR = [0.3 - 0.8 * step, 2.4, 0];
  o.lean = -0.4 * k;
  o.twist = 0.25 * k;
  o.head = -0.2 * k;
  o.crouch = 0.15 * step;
  o.aH = vlerpA(E0.aH, [-0.4, 1.0, 17.2], easeOut(k));
  o.aPhi = E0.aPhi + (2.55 - E0.aPhi) * k;
  o.aPsi = E0.aPsi * (1 - k);
  o.aGrip = E0.aGrip + (1.2 - E0.aGrip) * k;
  o.both = sstep(0.05, 0.35, T);
  o.bothAt = 2.6;
  o.fB = hang(o.fH, -0.3 * k, 0);
  if (T > 0.55) {
    const j = Math.floor(T * FPS) % 2 ? 0.2 : -0.2;
    o.fwd += j;
    o.aH = [o.aH[0] - 0.3, o.aH[1], o.aH[2] + 0.2];
  }
  if (T > 0.76) {
    // Срыв: секира пошла вперёд.
    o.aPhi = 2.15;
    o.aH = [0.6, 0.9, 17.0];
    o.lean = -0.2;
  }
  return o;
}

const CHOP_HIT: Partial<ExO> = {
  aH: [5.2, 0.6, 6.0],
  aPhi: -0.85,
  aPsi: 0,
  aGrip: 1.2,
  both: 1,
  bothAt: 2.6,
  lean: 0.75,
  crouch: 0.45,
  twist: -0.1,
  head: 0.3,
  fL: [2.3, -2.4, 0],
  fR: [-0.5, 2.4, 0],
};

/** После секиры (recover 1,05 с): кадр 0 — контакт; застряла — рывок — на плечо. */
function chopfO(T: number): ExO {
  let o = blendO(E0, CHOP_HIT, 1);
  o.dropAxe = 1;
  o.fB = hang(o.fH, 0.6, 0);
  if (T < 0.08) {
    o.fwd += 0.6;
    o.dust = T / 0.08;
    return o;
  }
  o.dust = T < 0.35 ? (T - 0.08) / 0.27 + 0.3 : 0;
  // Рывок (0,3–0,4): корпус назад, секира выходит из плит.
  const tug = Math.sin(PI * sstep(0.28, 0.42, T));
  o.lean = 0.75 - 0.5 * tug;
  o.aH = [5.2 - 0.8 * tug, 0.6, 6.0 + 0.8 * tug];
  const out = sstep(0.38, 0.75, T);
  o = blendO(o, E0, out);
  o.dropAxe = 1 - sstep(0.32, 0.4, T);
  o.fB = hang(o.fH, 0.6 * (1 - out) + 0.3 * Math.sin(T * 10) * (1 - out), 0);
  return o;
}

function exPose(anim: string, f: number): ExO {
  const t = (f + 0.5) / FPS;
  switch (anim) {
    case 'post': {
      const a = (f / 8) * TAU;
      const o = blendO(E0, POST, 1);
      o.bob = 0.2 * Math.sin(a);
      o.head = 0.15 + 0.05 * Math.sin(a - 0.6);
      o.fB = hang(o.fH, 0.05 * Math.sin(a), 0.4 + 0.05 * Math.sin(a), 6.6);
      return o;
    }
    case 'alert':
      return alertO(t);
    case 'idle':
      return idleO(f);
    case 'walk':
      return walkO(f);
    case 'flail':
      return flailO(Math.min(t, FLAIL_T - 0.005));
    case 'flailf':
      return flailfO(t - 0.5 / FPS, f);
    case 'chop':
      return chopO(Math.min(t, CHOP_T - 0.005));
    case 'chopf':
      return chopfO(t - 0.5 / FPS);
    case 'flinch': {
      const k = f / 4;
      const b = Math.sin(PI * Math.min(1, k * 1.25)) * (1 - k * 0.5);
      const o: ExO = { ...E0 };
      o.fwd = -0.9 * b;
      o.lean = -0.35 * b;
      o.head = -0.5 * b;
      o.twist = 0.2 * b;
      o.aH = [1.8, 3.8, 7.6 + 0.6 * b];
      o.aPhi = E0.aPhi + 0.25 * b;
      o.fB = hang(o.fH, -0.7 * b, 0.2 * b);
      return o;
    }
    case 'die': {
      // 22 кадра (0,9 с): секира выпала (0–0,2), шатнулся, на колени
      // (0,2–0,45), ничком (0,45–0,7), пыль.
      const o: ExO = { ...E0 };
      const knee = sstep(0.2, 0.45, t);
      const fall = sstep(0.45, 0.68, t);
      o.lean = trk(t, [
        [0, -0.3],
        [0.15, -0.45],
        [0.45, 0.25],
        [0.7, 1.45, easeIn],
        [0.76, 1.3],
        [0.82, 1.42],
      ]);
      o.crouch = 1.7 * knee + 0.5 * fall;
      o.fwd = 1.2 * fall;
      o.head = trk(t, [
        [0, -0.5],
        [0.3, 0.3],
        [0.7, 0.1],
      ]);
      o.roll = 0.15 * Math.sin(PI * sstep(0.05, 0.4, t));
      o.fR = [-1.6 * knee, 2.4, 0];
      o.fL = [-1.2 * knee, -2.4, 0];
      // Секира падает плашмя вправо, цеп — влево.
      const ax = easeIn(sstep(0, 0.3, t));
      o.aH = vlerpA(E0.aH, [3.0, 7.0, 0.8], ax);
      o.aPhi = E0.aPhi + (0.02 - E0.aPhi) * ax;
      o.aPsi = E0.aPsi + 1.5 * ax;
      o.fH = vlerpA(E0.fH, [3.6, -4.6, 1.8 + 3.0 * (1 - fall)], sstep(0.15, 0.6, t));
      o.fB = vlerpA(hang(E0.fH, -0.3, 0), [6.0, -7.0, 1.2], sstep(0.1, 0.55, t));
      o.dust = t > 0.66 ? (t - 0.66) / 0.24 : 0;
      return o;
    }
  }
  return { ...E0 };
}

// ---- Кадр -----------------------------------------------------------------

const EX = kindOf('exec', 120, 112, 60, 82, 1500);

const exPic = (anim: string, f: number, d: number): Pic => {
  const o0 = exPose(anim, f);
  const yaw = yawN(d);
  return draw(EX, execRig(o0, yaw), (o, P) => {
    const { B } = framesOf(o0, yaw);
    if (o0.dust > 0) {
      const at =
        anim === 'die' ? B.p(o0.fwd + 5, 0, 0) : anim === 'chopf' ? B.p(12, 0.6, 0) : B.p(6, -4, 0);
      const [x, y] = P(at);
      spray(o.p, x, y, 12, 13, 0.25 + 0.75 * clamp01(o0.dust), 71 + f, DUST, -3, 3);
    }
    if (anim === 'chopf' && f <= 1) {
      // Искры из-под лезвия.
      const [x, y] = P(B.p(11.5, 0.6, 0));
      for (let i = 0; i < 7; i++) {
        const a = -PI * (0.1 + 0.8 * hash(5, i));
        const rr = (2 + 6 * hash(6, i)) * (f + 1) * 0.7;
        spark2(
          o,
          x + Math.cos(a) * rr * 1.3,
          y + Math.sin(a) * rr,
          i % 2 ? SPARK : hx('#ffb050'),
          0.9,
        );
      }
    }
    if (anim === 'chop' && f >= 18) {
      const p0 = exPose('chop', 17);
      const A0 = axeOf(B, p0);
      const A1 = axeOf(B, o0);
      const tip = (A: ReturnType<typeof axeOf>) => P(vadd(A.head, vmul(A.e, 4.4 * SK)));
      const base = (A: ReturnType<typeof axeOf>) => P(A.head);
      smear(o, [tip(A0), tip(A1)], [base(A0), base(A1)], alpha(SMEAR, 200), 0.5);
    }
    if (anim === 'chopf' && f <= 1) {
      // След секиры: от пика замаха до пола.
      const tips: [number, number][] = [];
      const bases: [number, number][] = [];
      const top = exPose('chop', 18);
      for (let i = 0; i <= 5; i++) {
        const q = blendO(top, CHOP_HIT, easeIn(i / 5));
        const A = axeOf(B, q);
        tips.push(P(vadd(A.head, vmul(A.e, 4.4 * SK))));
        bases.push(P(A.head));
      }
      smear(o, tips, bases, alpha(SMEAR, f === 0 ? 210 : 120), 0.5);
    }
    if (anim === 'flail' && f >= 10) {
      // Размытый круг шара над головой: где шар был в прошлых кадрах.
      const pts: [number, number][] = [];
      for (let i = 0; i < 6; i++) {
        const q = flailO(Math.max(0, (f + 0.5) / FPS - i * 0.02));
        pts.push(P(B.p(q.fB[0], q.fB[1], q.fB[2])));
      }
      trail(o, pts, f >= 20 ? 1 : 0.6);
    }
    if (anim === 'flailf' && f <= 3) {
      // Цепь обходит кольцо у пола — светлый серп по кругу.
      const pts: [number, number][] = [];
      const a0 = spinA(FLAIL_T) + f * 1.3;
      for (let i = 0; i < 14; i++) {
        const a = a0 - i * 0.16;
        pts.push(P(B.p(Math.cos(a) * 24, Math.sin(a) * 24, 2.0)));
      }
      trail(o, pts, 1 - f * 0.22);
    }
  });
};

/** След шара цепа: точки от новой к старой, гаснут к хвосту; свет — в `lit`. */
function trail(o: RigOut, pts: [number, number][], k: number): void {
  const lit = litOn(o);
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
    const a = k * (1 - i / pts.length);
    for (let j = 0; j < n; j++) {
      const x = Math.round(ax + ((bx - ax) * j) / n);
      const y = Math.round(ay + ((by - ay) * j) / n);
      if (x < 0 || y < 0 || x >= o.p.w || y >= o.p.h) continue;
      if (!o.p.data[(y * o.p.w + x) * 4 + 3]) o.p.set(x, y, alpha(SMEAR, a * 0.8));
      lit.set(x, y, alpha(SMEAR, a * 0.45));
    }
  }
}

const TECH = new Set(['alertpost', 'flail', 'chop', 'recover']);

registerMobPainter('f10_exec', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = pose.t;
  const now = pose.now || 0;
  const id = m.id ?? 0;
  const onPost = md === 'f10_stand' && !moving(m, 0.3);
  const want = onPost ? PI / 2 : TECH.has(md) ? (m.face ?? 0) : headOf(m, 0.3);
  const v = visOf(m, pose, want, md === 'alertpost' ? 9 : 5);
  const d = dirN(v.yaw);
  const ex: Partial<MobFrame> = { shadow: 11 };
  let anim = 'idle';
  let f = 0;
  let dark = 0;
  if (md === 'dying') {
    f = fi(t, 21);
    anim = 'die';
    ex.linger = 0.9;
    ex.alpha = 1 - sstep(0.76, 0.9, t);
    ex.still = true;
    if (f >= 16 && f <= 17) {
      ex.sx = 1.06;
      ex.sy = 0.94;
    }
  } else if (md === 'alertpost') {
    f = fi(t, 14);
    anim = 'alert';
    ex.still = true;
  } else if (md === 'flail') {
    f = fi(t, 23);
    anim = 'flail';
    ex.still = true;
  } else if (md === 'chop') {
    f = fi(t, 19);
    anim = 'chop';
    ex.still = true;
  } else if (md === 'recover' && (v.prev === 'flail' || v.prev === 'chop')) {
    ex.still = true;
    anim = v.prev === 'flail' ? 'flailf' : 'chopf';
    f = fi(t, 23);
    if (f === 0) {
      ex.sx = anim === 'chopf' ? 1.1 : 1.05;
      ex.sy = anim === 'chopf' ? 0.9 : 0.96;
    }
    if (t >= 24 / FPS) {
      anim = 'idle';
      f = Math.floor((now + hash(id, 7) * 4) * 5) % 8;
    }
  } else if (md === 'emerge') {
    f = Math.floor(t * 12) % 8;
    anim = 'walk';
    dark = 3 - Math.min(3, Math.floor(clamp01(t / 0.45) * 4));
  } else if (md === 'stun' || hurtAge(v, now) < 0.2) {
    f = fi(md === 'stun' ? t : hurtAge(v, now), 4);
    anim = 'flinch';
  } else if (moving(m, 0.3)) {
    f = Math.floor((v.dist / 1.1) * 8) % 8;
    anim = 'walk';
  } else if (md === 'f10_stand') {
    f = Math.floor((now + hash(id, 7) * 4) * 3) % 8;
    anim = 'post';
  } else {
    f = Math.floor((now + hash(id, 7) * 4) * 5) % 8;
    anim = 'idle';
  }
  if (md !== 'dying') hurtFx(v, now, 1.2, ex);
  return { ...frameOf(EX, anim, f, d, pose, () => exPic(anim, f, d), dark), ...ex };
});

registerMobWarm('f10_exec', function* () {
  yield* warmAll(
    EX,
    [
      ['idle', 8],
      ['walk', 8],
      ['post', 8],
      ['alert', 15],
      ['flail', 24],
      ['flailf', 24],
      ['chop', 20],
      ['chopf', 24],
      ['flinch', 5],
      ['die', 22],
    ],
    exPic,
  );
});

// ---- Контакт на полу ------------------------------------------------------

type Rec = Parameters<Parameters<typeof registerImpactPainter>[1]['paint']>[1];
const css = (c: RGBA, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${clamp01(a).toFixed(3)})`;
const SCAR = hx('#0e0a0c');

// Секира в плиты: раскол звездой, искры, крошка.
registerImpactPainter('f10_chop', {
  life: 0.6,
  shake: 0.22,
  paint(g, rec: Rec, px, py, S, age) {
    const k = clamp01(age / 0.6);
    const R = (rec.r ?? 1.05) * S;
    g.fillStyle = css(SCAR, 0.6 * (1 - k));
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + hash(rec.seed, i) * 0.9;
      for (let j = 1; j < 6; j++) {
        const rr = R * 0.16 * j;
        g.fillRect(
          Math.round(px + Math.cos(a) * rr + (hash(rec.seed, i * 7 + j) - 0.5) * 2),
          Math.round(py + Math.sin(a) * rr * 0.6),
          1,
          1,
        );
      }
    }
    g.fillRect(Math.round(px - R * 0.5), Math.round(py), Math.round(R), 1);
    if (age < 0.16) {
      const q = age / 0.16;
      g.fillStyle = css(SPARK, 1 - q);
      for (let i = 0; i < 9; i++) {
        const a = -PI * (0.05 + 0.9 * hash(rec.seed, i, 3));
        const rr = (3 + 10 * hash(rec.seed, i, 4)) * easeOut(q);
        g.fillRect(
          Math.round(px + Math.cos(a) * rr),
          Math.round(py + Math.sin(a) * rr * 0.8),
          1,
          1,
        );
      }
    }
    for (let i = 0; i < 8; i++) {
      const a = hash(rec.seed, i, 5) * TAU;
      const d = R * (0.4 + 0.7 * k) * (0.5 + 0.5 * hash(rec.seed, i, 6));
      const hgt = Math.sin(PI * Math.min(1, k * 1.5)) * 5 * hash(rec.seed, i, 7);
      g.fillStyle = css(DUST[i % DUST.length], 0.7 * (1 - k));
      g.fillRect(
        Math.round(px + Math.cos(a) * d),
        Math.round(py + Math.sin(a) * d * 0.6 - hgt),
        2,
        2,
      );
    }
    return true;
  },
});

// Цеп по кольцу: светлый след по кругу, искры и пыль там, где шар чиркнул.
registerImpactPainter('f10_flail', {
  life: 0.5,
  shake: 0.16,
  paint(g, rec: Rec, px, py, S, age) {
    const k = clamp01(age / 0.5);
    const R = (rec.r ?? 2.35) * S;
    if (age < 0.18) {
      g.strokeStyle = css(SMEAR, 0.7 * (1 - age / 0.18));
      g.lineWidth = Math.max(1, 3 * (1 - age / 0.18));
      g.beginPath();
      g.arc(px, py, R, 0, TAU);
      g.stroke();
    }
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU + hash(rec.seed, i) * 0.4;
      const rr = R + (hash(rec.seed, i, 2) - 0.5) * 4;
      const x = px + Math.cos(a) * rr;
      const y = py + Math.sin(a) * rr;
      g.fillStyle = css(DUST[i % DUST.length], 0.55 * (1 - k));
      const s = 1 + Math.round(2 * k);
      g.fillRect(Math.round(x - s / 2), Math.round(y - s / 2 - 3 * k), s, s);
      if (age < 0.12 && i % 3 === 0) {
        g.fillStyle = css(SPARK, 1 - age / 0.12);
        g.fillRect(Math.round(x), Math.round(y - 2), 1, 1);
      }
    }
    return true;
  },
});
