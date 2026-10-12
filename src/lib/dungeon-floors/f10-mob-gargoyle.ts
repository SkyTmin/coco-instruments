// Горгулья (анимации мобов 10): сгорбленный демон с перепончатыми крыльями,
// рогами и хвостом-пикой; живая — тёмная, с красными глазами, каменная —
// серый камень. Ходит на четырёх (кулаки и ступни), туда, куда идёт;
// 8 сторон рисуются честно.
//
// Метроном — `f10-brains.ts` (`f10_gargoyle`, `GARG`):
// - `f10_stone` — статуя на постаменте лицом на юг (`ghost`); раз в
//   несколько секунд глаза тлеют — живая выдаёт себя. Та же картинка —
//   у декоративной статуи (`gargStatuePic`): различить их можно только по
//   глазам, как и было;
// - `f10_wake` 0,85 с: трещины расходятся и наливаются жаром (0–0,25),
//   глаза загораются, сыплется крошка (0,25–0,45), скорлупа лопается ровно
//   там, где мозг снимает `ghost` (0,51), рёв с крыльями во всю ширь,
//   спрыгивает с постамента (0,75–0,85);
// - прыжок `leap` 0,8 с: толчок, крылья вверх, взмах на вершине, тормоз
//   крыльями, ноги вперёд; высота — по мозгу (sin(kπ)·1,4 клетки); кадр
//   контакта — первый кадр `recover` (приземление: присед, кулаки в пол);
// - когти `claw` 0,6 с: встаёт, крылья раскрыты, правая лапа заведена за
//   голову, задержка с дрожью; кадр контакта — первый кадр `recover`
//   (лапа прошла поперёк, след когтей);
// - `f10_petrify` 3,2 с: кутается в крылья, камень ползёт от ног (0–0,58),
//   трещины-раны затягиваются шестью ступенями, в конце скорлупа лопается
//   (2,9–3,2);
// - смерть 0,8 с: вскинулась, окаменела от ног вверх, треснула и
//   рассыпалась кусками по полу (`explode`), пыль.

import { registerImpactPainter, registerMobPainter, registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import {
  F3,
  FPS,
  KRig,
  PI,
  TAU,
  WARM_POSE,
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
  ik,
  kindOf,
  litOn,
  mixc,
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
  vsub,
  warmAll,
  yawN,
} from './f10-mobs';
import type { Pic, Proj2, RGBA, RigOut, Tones, V3 } from './f10-mobs';
import type { Mat } from './f15-rig';

const SKIN = tn('#17121a', '#2e2734', '#4a4052', '#73667c');
const MEMB = tn('#1a0c12', '#3a1622', '#5c2434', '#84384a');
const BONE = tn('#3a3026', '#6a5c48', '#a8987a', '#dcd0b4');
const STONE = tn('#232127', '#423f47', '#67636b', '#959098');
const STONE_M = tn('#1e1c22', '#38353d', '#57535b', '#7d7880');
const MOUTH = tn('#2a0608', '#5a1010', '#a02a18', '#e05a20');
const EYE = hx('#ff3a2a');
const EYE_ST = hx('#ff8a3a');
const EYE_DEAD = hx('#141016');
const MAGMA = hx('#ff7a2a');
const MAGMA_HI = hx('#ffd27a');
const CRACK = hx('#0e0b0e');
const CHIPS: RGBA[] = [hx('#67636b'), hx('#959098'), hx('#423f47'), hx('#7d7880')];
const DUST: RGBA[] = [hx('#6a646e'), hx('#857e88'), hx('#4a4550')];
const STEELW = hx('#f4e8ff');

/** Тона материала между живым и камнем (0 — живая, 1 — камень). */
function blendT(a: Tones, b: Tones, k: number): Tones {
  if (k <= 0) return a;
  if (k >= 1) return b;
  return [mixc(a[0], b[0], k), mixc(a[1], b[1], k), mixc(a[2], b[2], k), mixc(a[3], b[3], k)];
}

interface GaO {
  /** Корень: вперёд, вверх (постамент, подскок), присед 0…1+, наклон корпуса. */
  fwd: number;
  up: number;
  /** Подъём корпуса без лап (шаг). */
  bob: number;
  crouch: number;
  lean: number;
  twist: number;
  roll: number;
  /** Голова: кивок (+ вниз), поворот, пасть 0…1. */
  head: number;
  hturn: number;
  jaw: number;
  /** Крылья: размах 0…1, взмах −1 (вверх) … 1 (вниз). */
  spread: number;
  flap: number;
  /** Кисти и ступни — в рамке курса от корня (x — вперёд, y — вправо). */
  hR: V3;
  hL: V3;
  fR: V3;
  fL: V3;
  /** Когти растопырены 0…1 (и куда смотрят кончики). */
  claw: number;
  /** Хвост: размах −1…1, отставание 0…1. */
  tail: number;
  drag: number;
  /** Камень 0…1, трещины 0…1, жар трещин 0…1, глаза 0…1. */
  st: number;
  crk: number;
  glow: number;
  eyes: number;
  /** Скорлупа лопнула 0…1, крошка 0…1, раскол (смерть) 0…1, пыль 0…1. */
  shards: number;
  crumbs: number;
  boom: number;
  dust: number;
}

const G0: GaO = {
  fwd: 0,
  up: 0,
  bob: 0,
  crouch: 0.3,
  lean: 0,
  twist: 0,
  roll: 0,
  head: 0,
  hturn: 0,
  jaw: 0,
  spread: 0.55,
  flap: -0.2,
  hR: [3.1, 2.5, 1.3],
  hL: [3.1, -2.5, 1.3],
  fR: [0.8, 2.6, 0],
  fL: [0.8, -2.6, 0],
  claw: 0,
  tail: 0,
  drag: 0,
  st: 0,
  crk: 0,
  glow: 0,
  eyes: 1,
  shards: 0,
  crumbs: 0,
  boom: 0,
  dust: 0,
};

const SK = 1.75;
/** Высота постамента, пиксели: на нём стоит статуя. */
const PLINTH = 5;

interface Frames {
  B: F3;
  /** Земля под лапами: на постаменте — его верх. */
  G: F3;
  P: F3;
  T: F3;
  Hd: F3;
}

function framesOf(o: GaO, yaw: number): Frames {
  const B = F3.yaw(yaw).scale(SK);
  const G = B.at(0, 0, o.up / SK);
  const hipZ = 4.4 - 1.6 * o.crouch + (o.up + o.bob) / SK;
  const P = B.at(o.fwd, 0, hipZ)
    .roll(o.roll)
    .pitch(0.15 + o.lean * 0.4);
  const T = P.at(0.2, 0, 0.9)
    .pitch(0.3 + o.lean * 0.6)
    .turn(o.twist);
  const Hd = T.at(0.7, 0, 7.4)
    .pitch(-(0.45 + o.lean) + o.head)
    .turn(o.hturn);
  return { B, G, P, T, Hd };
}

function wing(r: KRig, W: F3, sd: number, o: GaO, mem: Mat, memD: Mat, bone: Mat): void {
  const root = W.p(-1.0, sd * 1.6, 4.6);
  const low = W.p(-1.4, sd * 1.4, 0.2);
  // Размах — в сторону и чуть назад: сбоку крыло видно плоскостью, а не ребром.
  const out = vnorm(W.v(-0.55, sd, 0));
  const up = W.v(0, 0, 1);
  const back = W.v(-1, 0, 0);
  const at = (b: V3, o2: number, u: number, k: number): V3 =>
    vadd(b, vadd(vmul(out, o2), vadd(vmul(up, u), vmul(back, k))));
  const sp = o.spread;
  const fl = o.flap;
  const elbow = at(root, 1.2 + 2.8 * sp, 3.0 - 2.6 * fl + 0.6 * (1 - sp), 0.6 * (1 - sp));
  const wrist = at(elbow, 0.4 + 3.2 * sp, 2.2 - 2.8 * fl - 0.4 * (1 - sp), 0.8 * (1 - sp));
  const t1 = at(wrist, 0.6 + 3.2 * sp, -1.4 - 1.6 * fl, 0.2);
  const t2 = at(wrist, 0.4 + 2.4 * sp, -5.0 - 0.8 * fl, 0.5);
  const t3 = at(wrist, -0.6 + 1.2 * sp, -7.0 + 0.4 * fl, 0.8);
  r.poly([root, elbow, wrist], memD);
  r.poly([wrist, t1, t2], mem);
  r.poly([wrist, t2, t3], memD);
  r.poly([wrist, t3, low, root], mem);
  r.cap(root, elbow, 0.55, 0.45, bone);
  r.cap(elbow, wrist, 0.45, 0.35, bone);
  r.cap(wrist, t1, 0.35, 0.12, bone);
  r.cap(wrist, t2, 0.3, 0.12, bone);
  r.cap(wrist, t3, 0.3, 0.12, bone);
  r.spike(wrist, vadd(up, vmul(out, 0.4)), 1.3, 0.35, bone, 3);
}

/** Задняя лапа: бедро → колено (вперёд) → скакательный (назад) → ступня, когти. */
function hindLeg(r: KRig, B: F3, hip: V3, foot: V3, sd: number, skin: Mat, bone: Mat): void {
  const hock = vadd(foot, B.v(-1.6, 0, 1.6));
  // Колени — вперёд и врозь: сидит на корточках, как на карнизе.
  const knee = ik(hip, hock, 2.9 * SK, 2.4 * SK, B.v(0.7, sd * 0.8, 0.3));
  r.cap(hip, knee, 1.5, 1.0, skin);
  r.cap(knee, hock, 0.95, 0.6, skin);
  r.cap(hock, foot, 0.6, 0.5, skin);
  for (const k of [-1, 0, 1]) r.spike(foot, B.v(1, k * 0.4, -0.2), 1.2, 0.28, bone, 3);
}

function gargRig(o: GaO, yaw: number): KRig {
  const r = new KRig(SK);
  const { B, G, P, T, Hd } = framesOf(o, yaw);
  const cs = camSide(yaw);
  const st = o.st;
  const skin: Mat = { T: blendT(SKIN, STONE, st), spec: st < 0.5 };
  const mem: Mat = { T: blendT(MEMB, STONE_M, st), flat: 2 };
  const memD: Mat = { T: blendT(MEMB, STONE_M, st), flat: 1 };
  const bone: Mat = { T: blendT(BONE, STONE, st * 0.85) };
  // Крылья — над спиной: рамка крыла выпрямлена против сутулости.
  const W = T.pitch(-0.55 - o.lean * 0.3);
  wing(r, W, 1, o, mem, memD, bone);
  wing(r, W, -1, o, mem, memD, bone);
  // Задние лапы.
  for (const sd of [-1, 1]) {
    const f = sd > 0 ? o.fR : o.fL;
    hindLeg(r, B, P.p(-0.3, sd * 1.9, -0.2), G.p(o.fwd + f[0], f[1], f[2]), sd, skin, bone);
  }
  // Таз, живот, грудь, гребень на спине.
  r.ell(P, [0.1, 0, 0.3], [1.9, 2.2, 1.8], skin);
  r.ell(T, [0.3, 0, 3.0], [2.4, 3.1, 3.1], skin);
  r.ell(T, [0.9, 0, 4.7], [1.6, 3.2, 1.5], { ...skin, bias: 0.05 });
  for (let i = 0; i < 3; i++)
    r.spike(T.p(-1.9, 0, 1.6 + i * 1.6), T.v(-1, 0, 0.5), 1.1 - i * 0.15, 0.4, bone, 3);
  // Хвост-пика: лежит за спиной, качается и отстаёт.
  const q0 = P.p(-1.7, 0, -0.5);
  const q1 = vadd(q0, B.v(-1.8 - o.drag * 0.9, o.tail * 1.2, -1.2));
  const q2 = vadd(q1, B.v(-1.6 - o.drag * 1.2, o.tail * 2.1, -0.6 + o.drag * 0.6));
  const q3 = vadd(q2, B.v(-0.4 - o.drag * 0.6, o.tail * 1.6 - 0.6 * o.tail, 1.0 - o.drag * 0.4));
  r.cap(q0, q1, 0.7, 0.5, skin);
  r.cap(q1, q2, 0.5, 0.35, skin);
  r.cap(q2, q3, 0.35, 0.25, skin);
  r.spike(q3, vsub(q3, q2), 1.4, 0.75, bone, 3);
  // Шея и голова: морда, надбровье, челюсть, клыки, рога, уши.
  r.cap(T.p(0.6, 0, 5.2), Hd.p(-0.6, 0, -0.6), 1.45, 1.2, skin);
  r.ball(Hd.p(0, 0, 0), 2.1, skin);
  r.ell(Hd, [1.7, 0, -0.5], [1.3, 1.2, 0.9], { ...skin, bias: 0.12 });
  r.ell(Hd, [0.9, 0, 0.65], [0.9, 1.6, 0.5], { ...skin, bias: -0.12 });
  const J = Hd.at(0.5, 0, -0.8).pitch(o.jaw * 0.55);
  r.ell(J, [1.1, 0, -0.35], [1.2, 1.0, 0.45], skin);
  if (o.jaw > 0.25)
    r.ell(Hd, [1.4, 0, -1.0], [0.8, 0.7, 0.35], {
      T: blendT(MOUTH, STONE, st),
      glow: st < 0.5 ? 0.6 * o.jaw : 0,
      flat: 2,
    });
  for (const sd of [-1, 1]) {
    r.spike(Hd.p(2.35, sd * 0.55, -0.85), Hd.v(0.1, 0, -1), 0.8 + o.jaw * 0.3, 0.28, bone, 3);
    const h0 = Hd.p(0.1, sd * 1.3, 1.3);
    const h1 = vadd(h0, Hd.v(-0.5, sd * 1.6, 1.6));
    const h2 = vadd(h1, Hd.v(-0.6, sd * 0.1, 2.0));
    const h3 = vadd(h2, Hd.v(0.6, sd * -0.4, 0.8));
    r.cap(h0, h1, 0.7, 0.5, bone);
    r.cap(h1, h2, 0.5, 0.3, bone);
    r.cap(h2, h3, 0.3, 0.08, bone);
    r.spike(Hd.p(-0.3, sd * 1.7, 0.5), Hd.v(-0.5, sd * 1.0, 0.45), 1.8, 0.55, skin, 3);
    if (o.eyes > 0.05) r.dot(Hd.p(1.55, sd * 0.7, 0.25), st > 0.5 ? EYE_ST : EYE, o.eyes, 1, 0.6);
    else r.dot(Hd.p(1.55, sd * 0.7, 0.25), EYE_DEAD, 0, 1, 0.6);
  }
  r.eye = o.eyes > 0.5 ? Hd.p(1.55, cs * 0.7, 0.25) : null;
  // Передние лапы: плечо → локоть (назад и в сторону) → кулак с когтями.
  for (const sd of [-1, 1]) {
    const h = sd > 0 ? o.hR : o.hL;
    const sh = T.p(0.6, sd * 2.6, 4.6);
    const hand = G.p(o.fwd + h[0], h[1], h[2]);
    arm(r, sh, hand, 3.9 * SK, 4.1 * SK, B.v(-0.6, sd * 1.4, 0.2), [1.0, 0.8, 0.7], skin);
    r.ball(hand, 0.8, skin);
    const cd = vnorm(vsub(hand, vlerp(sh, hand, 0.5)));
    for (const k of [-1, 0, 1])
      r.spike(
        vadd(hand, B.v(0, k * 0.35, 0)),
        vadd(cd, B.v(0, k * 0.3 * (1 + o.claw), 0)),
        1.2 + 0.9 * o.claw,
        0.3,
        { ...bone, glow: st < 0.5 ? 0.35 * o.claw : 0 },
        3,
      );
  }
  if (o.boom > 0) r.explode(o.boom, B.p(o.fwd, 0, 5), 7, 9, 34, 0, 0.35);
  return r;
}

// ---- 2D поверх рига: трещины, крошка, осколки ---------------------------

/** Трещины по телу: зигзаги от узлов, только по непустым пикселям; жар — в `lit`. */
function cracks(o: RigOut, pts: [number, number][], k: number, glow: number, seed: number): void {
  if (k <= 0) return;
  const p = o.p;
  const lit = glow > 0.05 ? litOn(o) : null;
  const n = Math.round(2 + 7 * k);
  for (let s = 0; s < pts.length; s++) {
    let [x, y] = pts[s];
    x = Math.round(x);
    y = Math.round(y);
    let a = hash(seed, s, 1) * TAU;
    for (let i = 0; i < n; i++) {
      a += (hash(seed, s * 31 + i, 2) - 0.5) * 1.6;
      x += Math.round(Math.cos(a));
      y += Math.round(Math.sin(a));
      if (x < 0 || y < 0 || x >= p.w || y >= p.h) break;
      if (!p.data[(y * p.w + x) * 4 + 3]) continue;
      const hot = glow > 0.05 && i < n - 1;
      p.set(x, y, hot ? mixc(CRACK, i < n * 0.5 ? MAGMA_HI : MAGMA, glow) : CRACK);
      if (hot && lit) lit.set(x, y, alpha(i < n * 0.5 ? MAGMA_HI : MAGMA, glow * 0.9));
    }
  }
}

/** Узлы, от которых идут трещины: грудь, голова, плечи, бёдра, крылья. */
function crackRoots(o: GaO, yaw: number, P2: Proj2): [number, number][] {
  const { P, T, Hd } = framesOf(o, yaw);
  const W = T.pitch(-0.55 - o.lean * 0.3);
  return [
    P2(T.p(1.2, 0, 3.2)),
    P2(Hd.p(1.2, 0, 0.6)),
    P2(T.p(0.6, 2.2, 4.4)),
    P2(T.p(0.6, -2.2, 4.4)),
    P2(P.p(0.3, 1.3, 0)),
    P2(P.p(0.3, -1.3, 0)),
    P2(W.p(-1.0, 3.6, 7.0)),
    P2(W.p(-1.0, -3.6, 7.0)),
  ];
}

// ---- Треки ----------------------------------------------------------------

const WAKE_T = 0.85;
const LEAP_T = 0.8;
const CLAW_T = 0.6;
/** Конец перехода в камень и начало «скорлупы» (`f10_petrify` 3,2 с). */
const PETR_IN = 0.58;
const PETR_OUT = 2.9;

/** Статуя: присела на постаменте, лапы держат край, крылья подняты. */
function stoneO(): GaO {
  return {
    ...G0,
    up: PLINTH,
    crouch: 1.0,
    lean: 0.15,
    head: 0.15,
    spread: 0.85,
    flap: -0.3,
    hR: [2.9, 1.9, 0.3],
    hL: [2.9, -1.9, 0.3],
    fR: [0.6, 1.9, 0],
    fL: [0.6, -1.9, 0],
    tail: 0.6,
    st: 1,
    eyes: 0,
  };
}

function wakeO(T: number): GaO {
  const o = stoneO();
  // 0–0,25: трещины расходятся, дрожь; 0,25–0,45: глаза, крошка.
  o.crk = sstep(0, 0.42, T) * (1 - sstep(0.5, 0.54, T));
  o.glow = sstep(0.05, 0.4, T) * (1 - sstep(0.5, 0.54, T));
  o.eyes = sstep(0.24, 0.4, T);
  o.crumbs = T > 0.2 && T < 0.5 ? (T - 0.2) / 0.3 : 0;
  if (T < 0.48) o.fwd = (Math.floor(T * FPS) % 2 ? 0.18 : -0.18) * sstep(0.05, 0.3, T);
  // 0,48–0,53: скорлупа лопается — камень сходит, осколки.
  o.st = 1 - sstep(0.47, 0.52, T);
  o.shards = T >= 0.48 && T < 0.75 ? (T - 0.48) / 0.27 : 0;
  // Рёв: голова вверх, пасть, крылья во всю ширь (0,5–0,75).
  const roar = sstep(0.47, 0.56, T) * (1 - sstep(0.7, 0.8, T));
  o.head = 0.15 - 0.65 * roar;
  o.jaw = roar;
  o.lean = 0.15 - 0.45 * roar;
  o.spread = 0.75 + 0.25 * roar;
  o.flap = -0.55 - 0.45 * roar + (T > 0.56 && T < 0.7 ? 0.2 * Math.sin((T - 0.56) * 40) : 0);
  o.crouch = 0.75 - 0.35 * roar;
  // Спрыгнул с постамента (0,72–0,85): подскок и присед на полу.
  const hop = sstep(0.72, 0.85, T);
  o.up = PLINTH * (1 - hop) + Math.sin(PI * hop) * 3;
  o.fwd += 1.2 * hop;
  if (T > 0.78) o.crouch = 0.4 + 0.5 * sstep(0.78, 0.85, T);
  o.hR = vlerpA([2.9, 1.9, 0.3], G0.hR, hop);
  o.hL = vlerpA([2.9, -1.9, 0.3], G0.hL, hop);
  return o;
}

function leapO(T: number): GaO {
  const o: GaO = { ...G0 };
  // Толчок (0–0,06), подъём (0,06–0,3), вершина со взмахом (0,3–0,5),
  // спуск: тормоз крыльями, ноги вперёд (0,5–0,8).
  o.crouch = trk(T, [
    [0, 0.9],
    [0.07, -0.3, easeOut],
    [0.3, 0.2],
    [0.62, 0.0],
    [0.8, 0.5, easeIn],
  ]);
  o.lean = trk(T, [
    [0, 0.4],
    [0.07, -0.35, easeOut],
    [0.4, 0.3],
    [0.8, 0.45],
  ]);
  o.flap = trk(T, [
    [0, 0.2],
    [0.07, 0.9, easeOut],
    [0.28, -1, easeOut],
    [0.36, -1],
    [0.46, 1, easeIn],
    [0.58, -0.9, easeOut],
    [0.8, -0.8],
  ]);
  o.spread = trk(T, [
    [0, 0.6],
    [0.1, 1],
    [0.8, 1],
  ]);
  o.head = trk(T, [
    [0, 0.2],
    [0.1, -0.4],
    [0.5, 0.1],
    [0.8, 0.3],
  ]);
  o.jaw = sstep(0.5, 0.7, T) * 0.8;
  // Ступни: оттолкнулись назад, поджаты, к посадке — вперёд и вниз.
  const tuck = sstep(0.06, 0.25, T) * (1 - sstep(0.55, 0.75, T));
  const reach = sstep(0.55, 0.78, T);
  for (const sd of [-1, 1]) {
    const f: V3 = [
      0.4 - 2.6 * tuck * (T < 0.3 ? 1 : 0.6) + 1.4 * reach,
      sd * 2.0,
      0 + 2.6 * tuck + 0.4 * reach,
    ];
    if (sd > 0) o.fR = f;
    else o.fL = f;
    const h: V3 = [
      3.3 - 3.0 * sstep(0.02, 0.12, T) + 4.2 * sstep(0.3, 0.7, T),
      sd * (2.3 + 0.8 * sstep(0.3, 0.7, T)),
      0.5 + 3.5 * sstep(0.02, 0.2, T) + 1.0 * sstep(0.3, 0.6, T) - 2.8 * sstep(0.62, 0.8, T),
    ];
    if (sd > 0) o.hR = h;
    else o.hL = h;
  }
  o.claw = sstep(0.4, 0.65, T);
  o.tail = -0.3 + 0.6 * sstep(0.1, 0.6, T);
  o.drag = 0.4 + 0.6 * sstep(0.05, 0.3, T);
  return o;
}

/** Приземление (recover после прыжка): кадр 0 — контакт. */
function landO(T: number): GaO {
  const o: GaO = { ...G0 };
  const k = sstep(0.05, 0.55, T);
  o.crouch = trk(T, [
    [0, 1.25],
    [0.08, 1.05],
    [0.18, 0.9],
    [0.55, 0.3],
  ]);
  o.lean = trk(T, [
    [0, 0.75],
    [0.12, 0.55],
    [0.55, 0],
  ]);
  o.flap = trk(T, [
    [0, -1],
    [0.1, 0.7, easeOut],
    [0.3, -0.4],
    [0.55, -0.2],
  ]);
  o.spread = 1 - 0.45 * k;
  o.head = trk(T, [
    [0, 0.5],
    [0.15, -0.2],
    [0.3, 0.15],
    [0.45, -0.05],
    [0.6, 0],
  ]);
  o.jaw = 0.8 * (1 - sstep(0.1, 0.35, T));
  const hx0 = 4.0 - 0.7 * k;
  const lift = sstep(0.3, 0.62, T);
  o.hR = vlerpA([hx0, 2.6 - 0.3 * k, 0.4], G0.hR, lift);
  o.hL = vlerpA([hx0, -2.6 + 0.3 * k, 0.4], G0.hL, lift);
  o.claw = 1 - k;
  o.drag = 1 - k;
  o.tail = 0.4 * Math.sin(T * 14) * (1 - k);
  o.dust = T < 0.3 ? T / 0.3 : 0;
  return o;
}

/** Замах когтями: правая лапа за голову, крылья раскрыты, задержка. */
const CLAW_UP: V3 = [1.8, 3.2, 9.2];
const CLAW_END: V3 = [4.6, -1.4, 1.4];

function clawO(T: number): GaO {
  const o: GaO = { ...G0 };
  const k = sstep(0, 0.4, T);
  o.crouch = 0.3 - 0.5 * k;
  o.lean = -0.25 * k;
  o.twist = 0.5 * sstep(0.1, 0.42, T);
  o.spread = 0.55 + 0.45 * sstep(0, 0.25, T);
  o.flap = -0.2 - 0.8 * sstep(0, 0.3, T);
  o.head = -0.15 * k;
  o.jaw = 0.7 * sstep(0.15, 0.35, T);
  o.hR = [
    vl(G0.hR[0], CLAW_UP[0], k),
    vl(G0.hR[1], CLAW_UP[1], k),
    vl(G0.hR[2], CLAW_UP[2], easeOut(k)),
  ];
  o.hL = [3.1 + 0.8 * k, -2.4 + 0.3 * k, 1.3 + 2.0 * k];
  o.claw = sstep(0.3, 0.5, T);
  o.tail = 0.6 * k;
  if (T > 0.44) {
    // Задержка на пике — дрожь.
    const j = Math.floor(T * FPS) % 2 ? 0.2 : -0.2;
    o.fwd += j;
    o.hR = [o.hR[0] - 0.3, o.hR[1], o.hR[2] + 0.3];
  }
  if (T > 0.56) {
    // Срыв — лапа пошла.
    o.hR = vlerpA(o.hR, CLAW_END, 0.25);
    o.twist = 0.3;
  }
  return o;
}
const vl = (a: number, b: number, k: number) => a + (b - a) * k;
const vlerpA = (a: V3, b: V3, k: number): V3 => [
  vl(a[0], b[0], k),
  vl(a[1], b[1], k),
  vl(a[2], b[2], k),
];

/** После удара когтями (recover): кадр 0 — контакт, лапа прошла насквозь. */
function clawfO(T: number): GaO {
  const o: GaO = { ...G0 };
  const ret = sstep(0.2, 0.55, T);
  const thr = 1 - sstep(0.05, 0.2, T);
  o.twist = -0.6 - 0.15 * thr * (T < 0.1 ? 1 : 0) + 0.6 * ret;
  o.lean = 0.5 * (1 - ret);
  o.fwd = 1.4 * (1 - ret) * (T < 0.06 ? 0.8 : 1);
  o.crouch = 0.1 + 0.2 * ret;
  o.spread = 1 - 0.45 * ret;
  o.flap = trk(T, [
    [0, 0.8],
    [0.12, 0.3],
    [0.3, -0.5],
    [0.55, -0.2],
  ]);
  o.head = 0.2 * (1 - ret);
  o.jaw = 0.6 * (1 - sstep(0.05, 0.3, T));
  o.hR = vlerpA(
    [CLAW_END[0] + 0.4 * thr, CLAW_END[1] - 0.6 * thr, CLAW_END[2] - 0.3 * thr],
    G0.hR,
    ret,
  );
  o.hL = vlerpA([3.0, -2.6, 0.8], G0.hL, ret);
  o.claw = 1 - ret;
  o.tail = -0.6 * (1 - ret);
  o.drag = 0.4 * (1 - ret);
  return o;
}

/** Каменеет: кутается в крылья, камень ползёт от ног. */
function petrO(T: number): GaO {
  const o: GaO = { ...G0 };
  const k = sstep(0, 0.4, T);
  o.crouch = 0.3 + 0.55 * k;
  o.lean = 0.35 * k;
  o.head = 0.45 * k;
  o.spread = 0.55 - 0.4 * k;
  o.flap = -0.2 + 0.7 * k;
  o.hR = vlerpA(G0.hR, [2.0, 1.2, 3.2], k);
  o.hL = vlerpA(G0.hL, [2.0, -1.2, 3.0], k);
  o.tail = 0.6 * k;
  o.st = sstep(0.12, PETR_IN, T);
  o.crk = 1;
  o.glow = 1;
  o.eyes = 1;
  o.crumbs = T > 0.1 ? 0.5 : 0;
  return o;
}

/** Камень с затягивающимися трещинами: ступень `s` из 6. */
function stoneHealO(s: number): GaO {
  const o = petrO(PETR_IN);
  o.crk = 1 - (s + 1) / 7;
  o.glow = 0.9 - s * 0.12;
  o.crumbs = 0;
  return o;
}

/** Скорлупа лопается (2,9–3,2 с): камень сходит, крылья — в стороны. */
function burstO(T: number): GaO {
  const o = petrO(PETR_IN);
  const k = sstep(0.04, 0.14, T);
  o.st = 1 - k;
  o.crk = 0.3 * (1 - k);
  o.glow = 0.5 * (1 - k);
  o.shards = T > 0.04 ? clamp01((T - 0.04) / 0.26) : 0;
  o.spread = 0.15 + 0.85 * k;
  o.flap = 0.5 - 1.4 * k;
  o.head = 0.45 - 0.75 * k;
  o.jaw = k;
  o.lean = 0.35 - 0.5 * k;
  o.crouch = 0.85 - 0.3 * k;
  o.hR = vlerpA(o.hR, [3.6, 2.8, 0.6], k);
  o.hL = vlerpA(o.hL, [3.6, -2.8, 0.6], k);
  return o;
}

function gaPose(anim: string, f: number): GaO {
  const t = (f + 0.5) / FPS;
  switch (anim) {
    case 'stone':
      return { ...stoneO(), eyes: f ? 0.55 : 0 };
    case 'wake':
      return wakeO(t);
    case 'idle': {
      const a = (f / 8) * TAU;
      return {
        ...G0,
        crouch: 0.3 + 0.06 * Math.sin(a),
        lean: 0.04 * Math.sin(a),
        flap: -0.2 - 0.15 * Math.sin(a + 0.8),
        spread: 0.55 + 0.05 * Math.sin(a + 0.8),
        head: 0.08 * Math.sin(a - 0.6),
        hturn: f >= 4 && f <= 6 ? 0.25 : 0,
        tail: 0.5 * Math.sin(a - 1.2),
      };
    }
    case 'walk': {
      // Рысь на четырёх: правая рука и левая нога — вместе.
      const ph = f / 8;
      const o: GaO = { ...G0, drag: 0.5, lean: 0.25, crouch: 0.35 };
      const L = 2.6;
      const step = (p: number): [number, number] => {
        const q = ((p % 1) + 1) % 1;
        if (q < 0.5) return [L * (0.5 - q * 2), 0];
        const k = (q - 0.5) / 0.5;
        return [L * (-0.5 + k * k * (3 - 2 * k)), Math.sin(PI * k)];
      };
      const [rh, rhu] = step(ph);
      const [lh, lhu] = step(ph + 0.5);
      const [rf, rfu] = step(ph + 0.5);
      const [lf, lfu] = step(ph);
      o.hR = [3.3 + rh, 2.4, 0.5 + 1.6 * rhu];
      o.hL = [3.3 + lh, -2.4, 0.5 + 1.6 * lhu];
      o.fR = [0.4 + rf, 2.0, 1.2 * rfu];
      o.fL = [0.4 + lf, -2.0, 1.2 * lfu];
      const a = ph * TAU * 2;
      o.bob = 0.6 * Math.abs(Math.sin(a / 2 + 0.6));
      o.roll = 0.06 * Math.sin(ph * TAU);
      o.flap = -0.3 + 0.25 * Math.sin(a);
      o.spread = 0.45;
      o.head = 0.05 * Math.sin(a);
      o.tail = 0.6 * Math.sin(ph * TAU + PI);
      return o;
    }
    case 'leap':
      return leapO(t);
    case 'land':
      return landO(t);
    case 'claw':
      return clawO(Math.min(t, CLAW_T - 0.005));
    case 'clawf':
      return clawfO(t - 0.5 / FPS);
    case 'petr':
      return petrO(t);
    case 'stonecr':
      return stoneHealO(f);
    case 'burst':
      return burstO(t);
    case 'flinch': {
      const k = f / 4;
      const b = Math.sin(PI * Math.min(1, k * 1.25)) * (1 - k * 0.5);
      return {
        ...G0,
        fwd: -1.0 * b,
        lean: -0.45 * b,
        head: -0.55 * b,
        jaw: 0.6 * b,
        flap: -0.2 - 0.7 * b,
        spread: 0.55 + 0.35 * b,
        tail: 0.5 * b,
      };
    }
    case 'die': {
      // 19 кадров (0,8 с): вскинулась (0–0,12), каменеет от ног (0,1–0,4),
      // трещины (0,35–0,5), раскол на куски (0,48–0,8), пыль.
      const o: GaO = { ...G0 };
      const up = sstep(0, 0.1, t);
      o.lean = -0.5 * up;
      o.head = -0.6 * up;
      o.jaw = up;
      o.flap = -0.2 - 0.8 * up;
      o.spread = 0.55 + 0.45 * up;
      o.hR = [3.0, 2.8, 0.5 + 4.0 * up];
      o.hL = [3.0, -2.8, 0.5 + 3.4 * up];
      o.crouch = 0.3 - 0.3 * up;
      o.st = sstep(0.1, 0.4, t);
      o.eyes = 1 - sstep(0.2, 0.42, t);
      o.crk = sstep(0.34, 0.5, t);
      o.boom = t > 0.48 ? easeOut((t - 0.48) / 0.32) : 0;
      o.dust = t > 0.48 ? (t - 0.48) / 0.32 : 0;
      return o;
    }
  }
  return { ...G0 };
}

// ---- Кадр -----------------------------------------------------------------

const GA = kindOf('gargoyle', 88, 96, 44, 74, 1400);

const gaPic = (anim: string, f: number, d: number): Pic => {
  const o0 = gaPose(anim, f);
  const yaw = yawN(d);
  const seed = 17 + f * 3;
  return draw(GA, gargRig(o0, yaw), (o, P) => {
    const { B, T } = framesOf(o0, yaw);
    if (o0.crk > 0 && o0.boom < 0.2) cracks(o, crackRoots(o0, yaw, P), o0.crk, o0.glow, 5);
    if (o0.crumbs > 0) {
      // Крошка с плеч и крыльев — сыплется вниз.
      const [x, y] = P(T.p(0.5, 0, 6));
      spray(o.p, x, y, 7, 9, 0.3 + 0.7 * o0.crumbs, seed, CHIPS, 9, -2);
    }
    if (o0.shards > 0) {
      const [x, y] = P(T.p(0.5, 0, 3.5));
      spray(o.p, x, y, 16, 16, easeOut(o0.shards), 41, CHIPS, 10, 5);
      if (o0.shards < 0.3) spray(o.p, x, y, 8, 10, o0.shards / 0.3, 43, [MAGMA, MAGMA_HI], 0, 2);
    }
    if (o0.dust > 0) {
      const [x, y] = P(B.p(o0.fwd + 1, 0, 0));
      spray(o.p, x, y, 12, 14, 0.25 + 0.75 * o0.dust, 61 + f, DUST, -2, 2);
    }
    if (anim === 'clawf' && f <= 2) {
      // След когтей: дуга от пика замаха до конца удара.
      const tips: [number, number][] = [];
      const bases: [number, number][] = [];
      const n = 5;
      for (let i = 0; i <= n; i++) {
        const k = (i / n) * (f === 0 ? 1 : 1 - f * 0.3);
        const h = vlerpA(CLAW_UP, CLAW_END, easeIn(k));
        const tip = B.p(h[0] + 1.6, h[1], h[2] + 0.4);
        tips.push(P(tip));
        bases.push(P(vadd(tip, vmul(vnorm(B.v(-1, 0, 0.4)), 2.4))));
      }
      smear(o, tips, bases, alpha(STEELW, f === 0 ? 220 : 140), 0.6);
      if (f === 0) {
        const [x, y] = P(B.p(CLAW_END[0] + 2.2, CLAW_END[1], CLAW_END[2]));
        spark2(o, x, y, hx('#ffffff'));
        spark2(o, x + 1, y - 1, MAGMA_HI, 0.8);
        spark2(o, x - 1, y + 1, MAGMA, 0.8);
      }
    }
  });
};

/** Декоративная статуя на постаменте (`f10_gargstatue`): та же горгулья, глаза тёмные. */
export function gargStatuePic(): Pic {
  return gaPic('stone', 0, 2);
}

const TECH = new Set(['claw', 'recover', 'leap', 'f10_wake', 'f10_petrify']);

registerMobPainter('f10_gargoyle', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = pose.t;
  const now = pose.now || 0;
  const id = m.id ?? 0;
  const stoneSide = md === 'f10_stone' || (md === 'f10_wake' && t < 0.5);
  const want = stoneSide ? PI / 2 : TECH.has(md) ? (m.face ?? 0) : headOf(m);
  const v = visOf(m, pose, want, md === 'leap' ? 14 : 8);
  let d = dirN(v.yaw);
  const ex: Partial<MobFrame> = { shadow: 8 };
  let anim = 'idle';
  let f = 0;
  let dark = 0;
  if (md === 'dying') {
    f = fi(t, 18);
    anim = 'die';
    ex.linger = 0.85;
    ex.alpha = 1 - sstep(0.72, 0.85, t);
    ex.shadow = 8 * (1 - sstep(0.45, 0.6, t));
    ex.still = true;
  } else if (md === 'f10_stone') {
    // Глаза тлеют раз в ~2,5 с на 0,2 с — фаза своя у каждой.
    f = (now * 0.4 + hash(id, 11)) % 1 < 0.08 ? 1 : 0;
    anim = 'stone';
    d = 2;
    ex.still = true;
    ex.shadow = 0;
  } else if (md === 'f10_wake') {
    f = fi(t, 20);
    anim = 'wake';
    if (t < 0.5) d = 2;
    ex.still = true;
    ex.shadow = t > WAKE_T - 0.1 ? 8 : 0;
  } else if (md === 'leap') {
    f = fi(t, 19);
    anim = 'leap';
    ex.still = true;
    const k = clamp01(t / LEAP_T);
    const z = Math.sin(k * PI);
    ex.dy = -z * 1.4 * 16;
    ex.shadow = 8 * (1 - 0.35 * z);
    if (k > 0.55) ex.ghost = { every: 0.03, life: 0.14, tint: '#8a7a90', alpha: 0.3 };
  } else if (md === 'claw') {
    f = fi(t, 14);
    anim = 'claw';
    ex.still = true;
  } else if (md === 'recover' && (v.prev === 'leap' || v.prev === 'claw')) {
    ex.still = true;
    anim = v.prev === 'leap' ? 'land' : 'clawf';
    f = fi(t, anim === 'land' ? 15 : 13);
    if (f === 0) {
      ex.sx = 1.14;
      ex.sy = 0.86;
    } else if (f === 1) {
      ex.sx = 1.06;
      ex.sy = 0.95;
    }
    if (t > (anim === 'land' ? 16 : 14) / FPS) {
      anim = 'idle';
      f = Math.floor((now + hash(id, 7) * 4) * 6) % 8;
    }
  } else if (md === 'f10_petrify') {
    ex.still = true;
    if (t < PETR_IN) {
      f = fi(t, 13);
      anim = 'petr';
    } else if (t < PETR_OUT) {
      f = Math.min(5, Math.floor(((t - PETR_IN) / (PETR_OUT - PETR_IN)) * 6));
      anim = 'stonecr';
    } else {
      f = fi(t - PETR_OUT, 7);
      anim = 'burst';
    }
  } else if (md === 'emerge') {
    f = Math.floor(t * 16) % 8;
    anim = 'walk';
    dark = 3 - Math.min(3, Math.floor(clamp01(t / 0.45) * 4));
  } else if (md === 'stun' || hurtAge(v, now) < 0.2) {
    f = fi(md === 'stun' ? t : hurtAge(v, now), 4);
    anim = 'flinch';
  } else if (moving(m)) {
    f = Math.floor((v.dist / 0.75) * 8) % 8;
    anim = 'walk';
  } else {
    f = Math.floor((now + hash(id, 7) * 4) * (md === 'sleep' ? 2 : 6)) % 8;
    anim = 'idle';
    if (md === 'alert') ex.dy = -Math.sin(PI * clamp01(t / 0.35)) * 2.4;
  }
  if (md !== 'dying' && md !== 'f10_stone' && md !== 'f10_petrify') hurtFx(v, now, 1.6, ex);
  return { ...frameOf(GA, anim, f, d, pose, () => gaPic(anim, f, d), dark), ...ex };
});

registerMobWarm('f10_gargoyle', function* () {
  // Статуя смотрит только на юг.
  for (let f = 0; f < 2; f++) {
    frameOf(GA, 'stone', f, 2, WARM_POSE, () => gaPic('stone', f, 2));
    yield 0;
  }
  yield* warmAll(
    GA,
    [
      ['idle', 8],
      ['walk', 8],
      ['wake', 21],
      ['leap', 20],
      ['land', 16],
      ['claw', 15],
      ['clawf', 14],
      ['petr', 14],
      ['stonecr', 6],
      ['burst', 8],
      ['flinch', 5],
      ['die', 19],
    ],
    gaPic,
  );
});

// ---- Контакт на полу ------------------------------------------------------

type Rec = Parameters<Parameters<typeof registerImpactPainter>[1]['paint']>[1];
const css = (c: RGBA, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${clamp01(a).toFixed(3)})`;

// Приземление горгульи: кольцо пыли, трещины в плитах, каменная крошка.
registerImpactPainter('f10_land', {
  life: 0.6,
  shake: 0.22,
  paint(g, rec: Rec, px, py, S, age) {
    const k = clamp01(age / 0.6);
    const R = (rec.r ?? 1.2) * S;
    if (age < 0.18) {
      const q = age / 0.18;
      g.strokeStyle = css(DUST[1], 0.7 * (1 - q));
      g.lineWidth = Math.max(1, 3 * (1 - q));
      g.beginPath();
      g.ellipse(px, py, R * (0.4 + 0.7 * q), R * (0.4 + 0.7 * q) * 0.6, 0, 0, TAU);
      g.stroke();
    }
    g.fillStyle = css(CRACK, 0.55 * (1 - k));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + hash(rec.seed, i) * 0.8;
      for (let j = 2; j < 7; j++) {
        const rr = R * 0.12 * j;
        const w = (hash(rec.seed, i * 9 + j) - 0.5) * 2;
        g.fillRect(
          Math.round(px + Math.cos(a) * rr + w),
          Math.round(py + Math.sin(a) * rr * 0.6),
          1,
          1,
        );
      }
    }
    for (let i = 0; i < 10; i++) {
      const a = hash(rec.seed, i, 3) * TAU;
      const sp = 0.5 + 0.5 * hash(rec.seed, i, 4);
      const d = R * 1.1 * sp * easeOut(k);
      const hgt = Math.sin(PI * Math.min(1, k * 1.6)) * 7 * sp;
      g.fillStyle = css(CHIPS[i % CHIPS.length], 1 - k);
      g.fillRect(
        Math.round(px + Math.cos(a) * d),
        Math.round(py + Math.sin(a) * d * 0.6 - hgt),
        1,
        1,
      );
    }
    for (let i = 0; i < 7; i++) {
      const a = hash(rec.seed, i, 5) * TAU;
      const d = R * (0.5 + 0.6 * k) * (0.6 + 0.4 * hash(rec.seed, i, 6));
      g.fillStyle = css(DUST[i % DUST.length], 0.45 * (1 - k));
      const s = 2 + Math.round(2 * k);
      g.fillRect(
        Math.round(px + Math.cos(a) * d - s / 2),
        Math.round(py + Math.sin(a) * d * 0.6 - s / 2 - 2 * k),
        s,
        s,
      );
    }
    return true;
  },
});

// Когти: три светлые борозды поперёк конуса, тлеют и темнеют.
registerImpactPainter('f10_claws', {
  life: 0.45,
  shake: 0.1,
  paint(g, rec: Rec, px, py, S, age) {
    const k = clamp01(age / 0.45);
    const R = (rec.r ?? 1.75) * S;
    const a = rec.ang ?? 0;
    const nx = -Math.sin(a);
    const ny = Math.cos(a);
    for (let i = -1; i <= 1; i++) {
      const off = i * 3;
      const r0 = R * 0.35;
      const r1 = R * (0.92 - Math.abs(i) * 0.1);
      const bend = 0.25;
      g.strokeStyle = age < 0.12 ? css(STEELW, 0.9 * (1 - age / 0.12)) : css(CRACK, 0.6 * (1 - k));
      g.lineWidth = age < 0.12 ? 2 : 1;
      g.beginPath();
      for (let j = 0; j <= 6; j++) {
        const q = j / 6;
        const rr = r0 + (r1 - r0) * q;
        const aa = a + (q - 0.5) * bend;
        const x = px + Math.cos(aa) * rr + nx * off;
        const y = py + Math.sin(aa) * rr + ny * off;
        if (j) g.lineTo(x, y);
        else g.moveTo(x, y);
      }
      g.stroke();
    }
    if (age < 0.2)
      for (let i = 0; i < 6; i++) {
        const q = hash(rec.seed, i);
        const rr = R * (0.5 + 0.45 * q) + age * 30;
        const aa = a + (hash(rec.seed, i, 2) - 0.5) * 0.9;
        g.fillStyle = css(i % 2 ? MAGMA : MAGMA_HI, 1 - age / 0.2);
        g.fillRect(Math.round(px + Math.cos(aa) * rr), Math.round(py + Math.sin(aa) * rr), 1, 1);
      }
    return true;
  },
});
