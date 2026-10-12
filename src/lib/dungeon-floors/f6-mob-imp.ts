// Этаж 6 — Бесёнок-старьёвщик (анимации мобов 6). Красный чертёнок с
// мешком добычи за плечом: рожки, острые уши, ухмылка, хвост стрелкой.
// Мини-3D (риг 15-го, ×1,45), 8 сторон честно.
//
// Из норы 0,45 с: из ямы выпрыгивает, комья земли, приземляется уже на
// бегу. Бег — по пройденному пути: мешок подпрыгивает с запозданием, хвост
// мотается, раз в пару секунд оглядывается через плечо и ухмыляется. Петарда
// (каждые 1,6–2,2 с — видно по `data.bang`): лезет в мешок и швыряет назад,
// фитиль искрит. Оглушён: мешок съехал, глаза кругами. Ушёл (0,4 с):
// прыжок и щучкой в нору, хвост последним, дымок. Смерть 0,85 с: мешок
// лопается, монеты веером, бесёнок крутится и исчезает клубом дыма.

import { registerMobPainter, registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import { F3, Rig, vadd } from './f15-rig';
import type { Mat, RigOut, V3 } from './f15-rig';
import {
  alpha,
  angD,
  clamp,
  CLIP,
  dirN,
  draw,
  easeIn,
  easeOut,
  FIRE,
  fi,
  FPS,
  frameOf,
  GOLD,
  hash,
  hurtFx,
  hx,
  kindOf,
  litOn,
  mod,
  moving,
  PI,
  sstep,
  TAU,
  tn,
  trk,
  visOf,
  warmAll,
  yawN,
} from './f6-mobkit';
import type { Key, Pic, Proj2 } from './f6-mobkit';

const RED = tn('#3a0806', '#7a160c', '#c0301a', '#f0603a');
const DARK = tn('#1a0806', '#3a1008', '#6a2010', '#9a3a20');
const HORN = tn('#5a4a3a', '#a08c70', '#e0d0b0', '#fff4dc');
const SACK = tn('#3a2210', '#6a4020', '#9a6634', '#c8925a');
const EYE = hx('#ffe040');
const TOOTH = hx('#fff4dc');
const STICK = tn('#5a0c0c', '#a01818', '#e03a2a', '#ff8a6a');
const SMOKE = hx('#8a7e78');
const HOLE = hx('#140c0a');
const SC = 1.45;

interface ImpO {
  z: number;
  fwd: number;
  pitch: number;
  roll: number;
  /** Ноги: фаза бега, доля шага; голова через плечо (рад), ухмылка 0…1. */
  ph: number;
  step: number;
  look: number;
  grin: number;
  /** Мешок: подскок (запаздывает), съехал 0…1. */
  bag: number;
  slip: number;
  stick: boolean;
  /** Кисть с петардой (точка в теле, перекрывает `arm`), фитиль горит. */
  hand: V3 | null;
  fuse: number;
  /** Куда пришёлся фитиль (заполняет риг — для искр в `post`). */
  fusePt: V3 | null;
  /** Хвост: взмах. Глаза кругами. Ушёл в пол 0…1 (нора), яма 0…1. */
  tail: number;
  dizzy: boolean;
  dive: number;
  hole: number;
  /** Смерть: мешок лопнул 0…1, крутится (рад), пропал в дыму 0…1. */
  pop: number;
  spin: number;
  poof: number;
  dirt: number;
}

const O0 = (): ImpO => ({
  z: 3.6,
  fwd: 0,
  pitch: 0.15,
  roll: 0,
  ph: 0,
  step: 0,
  look: 0,
  grin: 0.5,
  bag: 0,
  slip: 0,
  stick: false,
  hand: null,
  fuse: 0,
  fusePt: null,
  tail: 0,
  dizzy: false,
  dive: 0,
  hole: 0,
  pop: 0,
  spin: 0,
  poof: 0,
  dirt: 0,
});

function impRig(o: ImpO, yaw: number): Rig {
  const r = new Rig();
  const B = F3.yaw(yaw + o.spin, [0, 0, 0]).scale(SC);
  const C = B.at(o.fwd, 0, o.z).pitch(o.pitch).roll(o.roll);
  const skin: Mat = { T: RED };
  const limb: Mat = { T: DARK };
  // Ноги: бег, копытца.
  for (const sd of [-1, 1]) {
    // Опора 40% шага (нога едет назад вместе с полом), остальное — мах и полёт.
    const ps = mod((o.ph + (sd > 0 ? 0.5 : 0)) * 1000, 1000) / 1000;
    const L = 3.4 * o.step;
    let f = 0;
    let u = 0;
    if (ps < STANCE) f = L / 2 - L * (ps / STANCE);
    else {
      const q = (ps - STANCE) / (1 - STANCE);
      f = -L / 2 + L * easeOutQ(q);
      u = Math.sin(PI * q) * 1.6 * o.step;
    }
    const hip = C.p(-0.2, sd * 0.75, -1.4);
    const ft = B.p(o.fwd + f, sd * 0.85, u + 0.4 + Math.max(0, o.z - 3.8) * 0.7);
    const knee = vadd(B.v(0.5, 0, 0), [
      (hip[0] + ft[0]) / 2,
      (hip[1] + ft[1]) / 2,
      (hip[2] + ft[2]) / 2,
    ]);
    r.cap(hip, knee, 0.5 * SC, 0.4 * SC, limb);
    r.cap(knee, ft, 0.4 * SC, 0.35 * SC, limb);
    r.ell(F3.yaw(yaw + o.spin, ft).scale(SC), [0.25, 0, 0], [0.6, 0.45, 0.4], {
      T: tn('#0c0606', '#1e1210', '#3a2620', '#5a3e32'),
    });
  }
  // Хвост стрелкой.
  let prev = C.p(-1.0, 0, -1.0);
  for (let i = 1; i <= 4; i++) {
    const k = i / 4;
    const nx = C.p(-1.0 - k * 2.4, Math.sin(o.tail + k * 2.2) * 1.2 * k, -1.0 + k * 2.4 * k);
    r.cap(prev, nx, 0.32 * SC, 0.26 * SC, limb);
    prev = nx;
  }
  r.spike(prev, C.v(-0.4, Math.sin(o.tail + 2.2) * 0.4, 1), 0.9 * SC, 0.45 * SC, limb, 3);
  // Тельце.
  r.ell(C, [0, 0, 0], [1.4, 1.3, 1.7], skin);
  r.ell(C, [0.6, 0, -0.3], [0.8, 0.9, 1.1], { T: RED, bias: 0.3 });
  // Мешок за спиной: подпрыгивает, съезжает; узел и монеты в горловине.
  if (o.pop < 0.5) {
    const S = C.at(-1.9 - o.slip * 0.6, o.slip * 1.2, 1.0 + o.bag - o.slip * 1.6).roll(
      o.slip * 0.6,
    );
    const sw = 1 + o.pop * 0.8;
    r.ell(S, [0, 0, 0], [1.8 * sw, 1.9 * sw, 2.1 * sw], {
      T: SACK,
      pat: (q) => (Math.abs(q[1]) < 0.06 && q[0] < 0 ? SACK[0] : null),
    });
    r.ell(S, [0.2, 0, 2.0], [0.7, 0.7, 0.5], { T: SACK, bias: -0.1 });
    r.dot(S.p(0.4, -0.3, 2.3), GOLD, 0.4, 1, 1.4);
    r.dot(S.p(0.1, 0.4, 2.35), GOLD, 0.3, 1, 1.4);
  }
  // Голова: рожки, уши, глаза, ухмылка.
  const H = C.at(0.5, 0, 2.6).turn(o.look);
  r.ell(H, [0, 0, 0], [1.7, 1.8, 1.6], skin);
  for (const sd of [-1, 1]) {
    r.spike(H.p(-0.2, sd * 1.5, 0.4), H.v(-0.3, sd, 0.5), 1.5 * SC, 0.45 * SC, skin, 3);
    r.spike(H.p(0.2, sd * 0.8, 1.2), H.v(-0.35, sd * 0.35, 1), 1.4 * SC, 0.38 * SC, { T: HORN }, 4);
    if (o.dizzy) {
      r.dot(H.p(1.5, sd * 0.6, 0.35), EYE, 0.5, 1, 2.2);
      r.dot(H.p(1.55, sd * 0.6, 0.35), DARK[0], 0, 1, 2.6);
    } else r.dot(H.p(1.5, sd * 0.6, 0.3), EYE, 0.8, 1, 2.2);
  }
  if (o.grin > 0.2) r.line(H.p(1.5, -0.7, -0.5), H.p(1.5, 0.7, -0.5 + 0.2 * o.grin), TOOTH, 0, 2.2);
  r.eye = H.p(1.5, (Math.cos(yaw) >= 0 ? 1 : -1) * 0.6, 0.3);
  // Рука на горловине мешка.
  r.cap(C.p(0.2, -1.2, 1.0), C.p(-0.7, -1.0, 2.0 - o.slip), 0.36 * SC, 0.3 * SC, limb);
  // Свободная рука: мах в беге или бросок петарды.
  const sw = Math.sin(o.ph * TAU) * 1.2 * o.step;
  const hand: V3 = o.hand ? C.p(o.hand[0], o.hand[1], o.hand[2]) : C.p(0.4 + sw, 1.4, -0.4);
  const sh = C.p(0.2, 1.2, 1.0);
  const elbow = vadd(
    [(sh[0] + hand[0]) / 2, (sh[1] + hand[1]) / 2, (sh[2] + hand[2]) / 2],
    C.v(-0.25, 0.55, -0.25),
  );
  r.cap(sh, elbow, 0.36 * SC, 0.32 * SC, limb);
  r.cap(elbow, hand, 0.32 * SC, 0.3 * SC, limb);
  r.ell(F3.yaw(yaw + o.spin, hand).scale(SC), [0, 0, 0], [0.45, 0.45, 0.45], skin);
  if (o.stick) {
    // Палочка торчит из кулака вверх-назад, фитиль на конце.
    const tip = vadd(hand, C.v(-0.4, 0.15, 2.0));
    r.cap(hand, tip, 0.34 * SC, 0.34 * SC, { T: STICK });
    o.fusePt = vadd(tip, C.v(-0.2, 0, 0.5));
    r.dot(o.fusePt, o.fuse ? FIRE[4] : SMOKE, 0.9, 1, 2.2);
  }
  // Нора: всё, что ниже пола, не видно.
  if (o.dive > 0.01)
    r.poly(
      [
        [-40, -40, 0],
        [40, -40, 0],
        [40, 40, 0],
        [-40, 40, 0],
      ],
      { T: CLIP, flat: 0, soft: true },
    );
  return r;
}

/** Доля опоры в шаге; путь за шаг (две ноги), клетки. */
const STANCE = 0.4;
const STRIDE = 0.75;
const easeOutQ = (k: number) => 1 - (1 - k) * (1 - k);

function run(o: ImpO, ph: number): void {
  o.ph = ph;
  o.step = 1;
  // Ниже всего — посреди опоры (ph 0,2 и 0,7), выше всего — в полёте.
  const s = Math.abs(Math.sin(TAU * (ph - 0.2)));
  o.z = 3.5 + 0.6 * s;
  o.pitch = 0.3 + 0.06 * (1 - s);
  // Мешок отстаёт от тела на ~1/8 шага и бьёт по спине.
  o.bag = 0.55 * Math.abs(Math.sin(TAU * (ph - 0.32)));
  o.roll = 0.08 * Math.sin(ph * TAU);
  o.tail = ph * TAU - 0.9;
}

/**
 * Петарда — 14 кадров (24 к/с), контакт на 7-м = миг, когда мозг ставит круг:
 * 0–2 рука в мешок, 3–4 вынул, фитиль загорелся, 5–6 замах вперёд-вверх
 * (6 — держит, пока герой далеко), 7 — швырнул за спину, 8–10 проводка,
 * 11–13 рука возвращается к бегу. Ноги — свои, по пути (4 фазы).
 */
const TOSS = 14;
const TOSS_HIT = 7;
const H_X: Key[] = [
  [0, 0.4],
  [2, -1.5, easeOut],
  [4, -0.4],
  [6, 0.7, easeOut],
  [7, -1.9, easeIn],
  [9, -2.3, easeOut],
  [13, 0.4],
];
const H_Y: Key[] = [
  [0, 1.4],
  [2, 0.7],
  [4, 1.5],
  [7, 1.4],
  [9, 1.5],
  [13, 1.4],
];
const H_Z: Key[] = [
  [0, -0.4],
  [2, 2.6, easeOut],
  [4, 3.2],
  [6, 3.7, easeOut],
  [7, 2.6, easeIn],
  [9, 0.4, easeOut],
  [13, -0.4],
];

function toss(o: ImpO, tf: number, lp: number): void {
  run(o, lp / 4);
  o.hand = [trk(tf, H_X), trk(tf, H_Y), trk(tf, H_Z)];
  o.stick = tf >= 3 && tf < TOSS_HIT;
  o.fuse = tf >= 3 && tf < TOSS_HIT ? 1 : 0;
  o.look = trk(tf, [
    [0, 0],
    [2, 0.7],
    [4, 0.2],
    [6, 0],
    [7, 1.5, easeOut],
    [10, 1.9],
    [13, 0.2],
  ]);
  // Замах — откинулся назад, бросок — клюнул вперёд, мешок подбросило.
  o.pitch += trk(tf, [
    [0, 0],
    [6, -0.22, easeOut],
    [7, 0.3, easeIn],
    [9, 0.18],
    [13, 0],
  ]);
  o.bag += trk(tf, [
    [0, 0],
    [7, 0],
    [8, 0.6, easeOut],
    [11, 0],
  ]);
  o.grin = 1;
}

function impPose(anim: string, f: number): ImpO {
  const o = O0();
  switch (anim) {
    case 'run':
      run(o, f / 8);
      break;
    case 'runl':
      // Бег с оглядкой: голова через плечо, ухмылка.
      run(o, f / 8);
      o.look = 2.2;
      o.grin = 1;
      break;
    case 'idle': {
      // Пританцовывает на месте, дразнится.
      const a = (f / 8) * TAU;
      o.z = 3.6 + 0.5 * Math.abs(Math.sin(a));
      o.bag = 0.3 * Math.abs(Math.sin(a - 0.8));
      o.tail = a;
      o.look = 0.4 * Math.sin(a * 0.5);
      o.grin = 1;
      o.roll = 0.1 * Math.sin(a);
      break;
    }
    case 'toss':
      // f = кадр трека × 4 + фаза ног (по пути).
      toss(o, Math.floor(f / 4), f % 4);
      break;
    case 'emerge': {
      // 0,45 с (11 кадров): из ямы — прыжок — приземление на бегу.
      const t = f / FPS;
      const k = t / 0.45;
      o.dive = 1;
      o.hole = 1 - sstep(0.6, 1, k);
      o.z = trk(k, [
        [0, -2.5],
        [0.45, 6.5, easeOut],
        [0.8, 4.0, easeIn],
        [1, 3.6],
      ]);
      o.pitch = trk(k, [
        [0, -0.6],
        [0.45, -0.2],
        [1, 0.3],
      ]);
      o.step = sstep(0.6, 1, k);
      o.ph = k;
      o.dirt = k < 0.6 ? 1 : 0;
      o.bag = -0.6 * (1 - k);
      o.tail = k * 4;
      break;
    }
    case 'escape': {
      // 0,4 с (10 кадров): прыжок и щучкой в нору, хвост последним.
      const k = f / 9;
      o.dive = 1;
      o.hole = 1;
      o.z = trk(k, [
        [0, 3.6],
        [0.35, 7, easeOut],
        [1, -9, easeIn],
      ]);
      o.pitch = trk(k, [
        [0, 0.3],
        [0.35, 0.9],
        [1, 1.6],
      ]);
      o.fwd = 1.5 * k;
      o.dirt = k > 0.5 ? 1 : 0;
      o.grin = 1;
      o.tail = k * 6;
      break;
    }
    case 'dizzy': {
      // Оглушён (12 кадров на 0,5 с): мешок съехал, качается, глаза кругами.
      const a = (f / 12) * TAU;
      o.slip = sstep(0, 3, f) * 0.8;
      o.dizzy = true;
      o.roll = 0.2 * Math.sin(a * 1.5);
      o.pitch = -0.1;
      o.z = 3.4;
      o.grin = 0;
      o.tail = a;
      break;
    }
    case 'die': {
      // 0,85 с (21 кадр): мешок лопается (до 0,2), монеты веером, крутится
      // и исчезает в клубе дыма (до 0,6).
      const t = f / FPS;
      o.pop = sstep(0.05, 0.2, t);
      o.spin = easeIn(sstep(0.15, 0.55, t)) * TAU * 1.5;
      o.z = 3.6 + 2.5 * Math.sin(PI * sstep(0.1, 0.55, t));
      o.dizzy = true;
      o.poof = sstep(0.45, 0.6, t);
      o.grin = 0;
      o.pitch = -0.2;
      break;
    }
  }
  return o;
}

const IK = kindOf('f6_imp', 52, 56, 26, 44, 1400);

function impPic(anim: string, f: number, d: number): Pic {
  const o = impPose(anim, f);
  const yaw = yawN(d);
  if (o.poof >= 1) return smokePic(f);
  return draw(IK, impRig(o, yaw), (out, P) => post(out, P, o, f, anim));
}

/** Только клуб дыма и монеты — бесёнок уже исчез. */
function smokePic(f: number): Pic {
  const o = O0();
  o.poof = 1;
  o.pop = 1;
  const r = new Rig();
  return draw(IK, r, (out, P) => post(out, P, o, f, 'die'));
}

function post(out: RigOut, P: Proj2, o: ImpO, f: number, anim: string): void {
  const [gx, gy] = P([0, 0, 0]);
  // Яма норы под ним.
  if (o.hole > 0) {
    out.p.ell(gx, gy, 4.5 * o.hole + 0.5, 1.8 * o.hole + 0.3, alpha(HOLE, 0.95));
  }
  // Комья земли.
  if (o.dirt > 0)
    for (let i = 0; i < 6; i++) {
      const k = mod(f * 0.19 + i / 6, 1);
      const side = i % 2 ? 1 : -1;
      out.p.set(
        Math.round(gx + side * (2 + k * 7)),
        Math.round(gy - 1 - Math.sin(PI * k) * 7),
        hx('#5a4a44'),
      );
    }
  if (anim === 'die') {
    const t = f / FPS;
    const lit = litOn(out);
    // Монеты веером из лопнувшего мешка.
    if (o.pop > 0)
      for (let i = 0; i < 7; i++) {
        const an = hash(i, 4) * TAU;
        const v = 0.6 + hash(i, 5) * 0.7;
        const k = clamp((t - 0.1) / 0.5, 0, 1);
        const x = gx + Math.cos(an) * k * 12 * v;
        const y = gy - 8 + Math.sin(an) * k * 4 * v - (k * 12 - k * k * 14) * v;
        const c = (f + i) % 3 === 0 ? hx('#fff4b0') : GOLD;
        out.p.set(Math.round(x), Math.round(Math.min(gy, y)), c);
        lit.set(Math.round(x), Math.round(Math.min(gy, y)), c);
      }
    // Клуб дыма.
    if (t > 0.42) {
      const k = sstep(0.42, 0.85, t);
      for (let i = 0; i < 5; i++) {
        const an = (i / 5) * TAU + 0.4;
        const R = 2 + k * 6;
        const x = gx + Math.cos(an) * R;
        const y = gy - 6 - k * 4 + Math.sin(an) * R * 0.5;
        const rr = 2.4 + k * 1.6;
        out.p.ell(x, y, rr, rr * 0.8, alpha(SMOKE, 0.85 * (1 - k)));
      }
    }
  }
  // Фитиль искрит — поверх темноты: видно, что бесёнок сейчас бросит.
  if (o.fusePt && o.fuse) {
    const [fx, fy] = P(o.fusePt);
    const lit = litOn(out);
    lit.set(Math.round(fx), Math.round(fy), FIRE[4]);
    for (let i = 0; i < 3; i++) {
      const an = hash(f, i, 31) * TAU;
      const rr = 1 + hash(f, i, 32) * 2;
      const x = Math.round(fx + Math.cos(an) * rr);
      const y = Math.round(fy - 0.5 + Math.sin(an) * rr);
      const c = i ? FIRE[3] : hx('#fff4b0');
      out.p.set(x, y, c);
      lit.set(x, y, c);
    }
  }
  if (anim === 'escape' && f >= 6) {
    const k = (f - 6) / 3;
    out.p.ell(gx, gy - 3 - k * 3, 2 + k * 3, 1.5 + k * 2, alpha(SMOKE, 0.7 * (1 - k * 0.7)));
  }
}

registerMobPainter('f6_imp', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = pose.t;
  const now = pose.now || 0;
  const id = m.id ?? 0;
  const sp = Math.hypot(m.vx ?? 0, m.vy ?? 0);
  const want = sp > 0.4 ? Math.atan2(m.vy ?? 0, m.vx ?? 0) : (m.face ?? 0);
  const v = visOf(m, pose, want, 12);
  const d = dirN(v.yaw);
  // Петарда по таймеру мозга `bang`: последние 0,29 с до броска — рука в
  // мешке и замах (ниже нуля — герой далеко, держит наготове); таймер
  // подскочил — мозг поставил круг, это кадр контакта.
  const bang = m.data?.bang;
  if (bang !== undefined && bang > (v.n.bang ?? bang) + 0.5) v.n.thrown = now;
  v.n.bang = bang ?? 9;
  const ex: Partial<MobFrame> = { shadow: 4, still: true };
  let anim = 'idle';
  let f = 0;
  const ta = now - (v.n.thrown ?? -9);
  if (md === 'dying') {
    anim = 'die';
    f = fi(t, 20);
    ex.linger = 0.85;
    ex.alpha = 1 - sstep(0.7, 0.85, t);
    ex.shadow = 4 * (1 - sstep(0.3, 0.5, t));
  } else if (md === 'emerge') {
    anim = 'emerge';
    f = fi(t, 10);
    ex.shadow = 4 * sstep(0.1, 0.3, t);
  } else if (md === 'escape') {
    anim = 'escape';
    f = fi(t, 9);
    ex.shadow = 4 * (1 - sstep(0.1, 0.3, t));
  } else if (md === 'stun') {
    anim = 'dizzy';
    f = fi(t, 11);
  } else if ((ta >= 0 && ta < (TOSS - TOSS_HIT) / FPS) || (bang ?? 9) < TOSS_HIT / FPS) {
    anim = 'toss';
    const tf =
      ta >= 0 && ta < (TOSS - TOSS_HIT) / FPS
        ? TOSS_HIT + Math.min(TOSS - 1 - TOSS_HIT, Math.floor(ta * FPS))
        : clamp(Math.floor((TOSS_HIT / FPS - (bang ?? 0)) * FPS), 0, TOSS_HIT - 1);
    f = tf * 4 + (Math.floor((v.dist / STRIDE) * 4) % 4);
  } else if (moving(m)) {
    // Оглядывается раз в ~2,2 с (фаза по id) на 0,4 с.
    const g = mod(now + hash(id, 5) * 2.2, 2.2);
    anim = g < 0.4 ? 'runl' : 'run';
    f = Math.floor((v.dist / STRIDE) * 8) % 8;
    const turn = angD(want, v.yaw);
    ex.rot = clamp(turn * 0.1, -0.1, 0.1);
  } else {
    anim = 'idle';
    f = Math.floor((now + hash(id, 7) * 3) * 10) % 8;
  }
  if (md !== 'dying' && md !== 'escape' && md !== 'emerge') hurtFx(v, now, 1.6, ex);
  return { ...frameOf(IK, anim, f, d, pose, () => impPic(anim, f, d)), ...ex };
});

registerMobWarm('f6_imp', function* () {
  yield* warmAll(
    IK,
    [
      ['run', 8],
      ['runl', 8],
      ['toss', TOSS * 4],
      ['emerge', 11],
      ['escape', 10],
      ['dizzy', 12],
      ['die', 21],
      ['idle', 8],
    ],
    impPic,
  );
});
