// Этаж 9 — телепорт-кобольд и кобольд-скупщик (анимации мобов 9). Мелкий,
// лопоухий, шакалья морда, лиловый капюшон с рунными стежками, кинжал;
// скупщик — тот же кобольд с мешком монет на спине. 8 сторон честно.
//
// Прыжок — две сцены, а не мигание. Уход (`f9_mark`, 0,42 с): присел и
// сжался → руны наливаются, вокруг искры → рывок вверх (вытянулся) →
// столб света. Приход (`f9_appear`, 0,22 с): столб → вытянутое тело
// падает → присед-сплющивание → встал, уже лицом к герою. Мгновенный
// перенос кругом (режим не меняется) ловится по скачку позиции — та же
// сцена прихода поверх погони.
// Удар кинжалом — короткий замах на весь windup 0,32, укол в кадр урона.
// Уши, хвост, полы капюшона и мешок — вторичное движение с запаздыванием.

import { registerMobPainter, registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import { F3, Rig, vmul, vnorm, vsub } from './f15-rig';
import type { Mat, V3 } from './f15-rig';
import {
  INK,
  PI,
  TAU,
  camSide,
  clamp01,
  dirN,
  drawRig,
  easeIn,
  easeIn3,
  easeOut,
  fi,
  frameOf,
  hash,
  headOf,
  hurtAge,
  hurtFields,
  hx,
  ik2,
  kindOf,
  lerp,
  mod,
  moving,
  out,
  sstep,
  tn,
  trk,
  vadd,
  visOf,
  vlerp,
  warmAll,
  yawN,
} from './f9-mobkit';
import type { Kind, Pic } from './f9-mobkit';

// ---- Палитра (прежняя) ----

const FUR = tn('#3a2a1a', '#6a4a2c', '#96704a', '#c09a6a');
const FUR_LT = tn('#6a4a2c', '#96704a', '#c09a6a', '#e0c49a');
const HOOD = tn('#1e1432', '#3e2a64', '#5e4696', '#8a70c4');
const STEEL = tn('#303038', '#5e5e6a', '#9a9aa8', '#dadae6');
const SACK = tn('#4a3018', '#7a5430', '#a67a48', '#cca070');
const BEAM = tn('#3a6aa0', '#7ac0f0', '#c0f4ff', '#ffffff');
const RUNE = hx('#9af0ff');
const RUNE_DIM = hx('#4a8aa0');
const EYE = hx('#7af0ff');
const NOSE = hx('#1a1010');
const COIN = hx('#ffd24a');
const COIN_HI = hx('#fff4b0');
const ROPE = hx('#3a2410');

const FUR_M: Mat = {
  T: FUR,
  // Шерсть: короткие тёмные штрихи по телу.
  pat: (q, l) =>
    l < 0.6 && hash(Math.floor(q[0] * 5 + 9), Math.floor(q[2] * 6 + 9), 5) > 0.72 ? FUR[0] : null,
};
const FUR_PLAIN: Mat = { T: FUR };
const FUR_FAR: Mat = { T: FUR, bias: -0.15 };
const FUR_LT_M: Mat = { T: FUR_LT };
const HOOD_M: Mat = { T: HOOD };
const STEEL_M: Mat = { T: STEEL, spec: true };
const SACK_M: Mat = {
  T: SACK,
  pat: (q, l) =>
    Math.abs(q[2] - 0.35) < 0.09
      ? ROPE
      : l < 0.35 && hash(Math.floor(q[0] * 4 + 9), Math.floor(q[1] * 4 + 9), 2) > 0.7
        ? SACK[0]
        : null,
};
const BEAM_M: Mat = { T: BEAM, glow: 1, soft: true, bias: 0.4 };

interface KobO {
  fl: V3;
  fr: V3;
  fwd: number;
  side: number;
  hip: number;
  lean: number;
  twist: number;
  head: number;
  jaw: number;
  shut: number;
  /** Уши: отставание назад (рад), хвост: фаза и размах. */
  ears: number;
  tail: number;
  tailA: number;
  /** Кинжал: кисть (от таза, оси земли), наклон и поворот клинка. */
  grip: V3;
  dp: number;
  dyaw: number;
  /** Левая кисть (от таза) — свободная. */
  lh: V3;
  /** Полы капюшона назад, свет рун, искры вокруг. */
  drag: number;
  rune: number;
  spark: number;
  spin: number;
  /** Столб света вместо тела (0 — нет, 1 — тонкий яркий). */
  beam: number;
  free: number;
  roll: number;
  /** Мешок скупщика: подскок (запаздывает за телом), монеты разлетелись. */
  sack: number;
  burst: number;
}

const K0: KobO = {
  fl: [0.6, -1.6, 0],
  fr: [-0.6, 1.6, 0],
  fwd: 0,
  side: 0,
  hip: 5.4,
  lean: 0.2,
  twist: 0,
  head: 0,
  jaw: 0,
  shut: 0,
  ears: 0.15,
  tail: 0,
  tailA: 0.5,
  grip: [1.6, 2.2, 1.6],
  dp: 0.5,
  dyaw: 0,
  lh: [1.0, -2.2, 1.4],
  drag: 0.2,
  rune: 0.3,
  spark: 0,
  spin: 0,
  beam: 0,
  free: 0,
  roll: 0,
  sack: 0,
  burst: 0,
};

/** Шаг: стопа на земле едет назад, в переносе — вперёд дугой. */
function feet(o: KobO, ph: number, S: number, H: number): void {
  for (const sd of [-1, 1]) {
    const u = mod((ph + (sd > 0 ? 0.5 : 0)) * 1000, 1000) / 1000;
    let f: number;
    let z = 0;
    if (u < 0.5) f = S * (1 - 4 * u);
    else {
      const k = (u - 0.5) * 2;
      f = -S + 2 * S * (k * k * (3 - 2 * k));
      z = Math.sin(PI * k) * H;
    }
    const p: V3 = [f + 0.2, sd * 1.6, z];
    if (sd < 0) o.fl = p;
    else o.fr = p;
  }
}

function kobRig(o: KobO, yaw: number, hoard: boolean): Rig {
  const r = new Rig();
  const B0 = F3.yaw(yaw);
  if (o.beam > 0) {
    // Столб света: тоньше и выше к концу ухода; у пола — вспышка-лужица.
    const w = 0.85 + (1 - o.beam) * 1.5;
    r.ell(B0, [0, 0, 9], [w, w, 9.5], BEAM_M);
    r.ell(B0, [0, 0, 0.5], [1.2 + o.beam * 2.4, 1.2 + o.beam * 2.4, 0.4], BEAM_M);
    return r;
  }
  const B = o.roll ? B0.roll(o.roll) : B0;
  const cs = camSide(yaw);
  const P = B.at(o.fwd, o.side, o.hip);
  const T = P.turn(o.twist * 0.5).pitch(o.lean);
  const ground = (p: V3): V3 => (o.roll ? p : p[2] < 0.5 ? [p[0], p[1], 0.5] : p);

  // Хвост: волна от крестца.
  {
    let prev = P.p(-1.2, 0, 0.2);
    for (let i = 1; i <= 4; i++) {
      const k = i / 4;
      const sw = Math.sin(o.tail - i * 0.9) * o.tailA * k * 1.6;
      const pt = ground(P.p(-1.2 - i * 1.4, sw, 0.2 - i * 0.9));
      r.cap(prev, pt, lerp(0.9, 0.35, k - 0.25), lerp(0.9, 0.35, k), FUR_PLAIN);
      prev = pt;
    }
  }

  // Ноги: стопа на пальцах, колено вперёд, пятка назад.
  for (const sd of [-1, 1]) {
    const ft = sd < 0 ? o.fl : o.fr;
    const m = sd === cs ? FUR_M : FUR_FAR;
    const hip = P.p(0, sd * 1.4, -0.2);
    const ank = ground(B.p(ft[0] - 0.7, ft[1], ft[2] + 1.2));
    const toe = ground(B.p(ft[0] + 1.1, ft[1], ft[2] + 0.3));
    const knee = ik2(hip, ank, 2.9, 2.9, B.v(1, 0, 0.1));
    r.cap(hip, knee, 1.25, 0.85, m);
    r.cap(knee, ank, 0.75, 0.55, m);
    r.cap(ank, toe, 0.6, 0.45, m);
  }

  // Мешок скупщика — за спиной, с верёвкой и монетами сверху.
  if (hoard) {
    const S0 = T.p(-3.4, 0, 3.8 + o.sack);
    r.ell(T.at(-3.4, 0, 3.8 + o.sack), [0, 0, 0], [2.3, 1.9, 2.6], SACK_M);
    r.cap(T.p(-1.4, 0, 6.6 + o.sack), T.p(-3.0, 0, 7.6 + o.sack), 0.9, 0.6, { T: SACK });
    for (let i = 0; i < 4; i++)
      r.dot(
        vadd(S0, T.v(-0.4 + (i % 2) * 0.9, (i - 1.5) * 0.6, 2.6 + (i % 2) * 0.4)),
        i % 2 ? COIN : COIN_HI,
        0,
        1,
        1,
      );
    for (const sd of [-1, 1])
      r.line(T.p(0.6, sd * 1.6, 5.4), T.p(-1.6, sd * 1.9, 2.4), ROPE, 0, 0.2);
    // Смерть: мешок лопнул — монеты веером на пол.
    for (let i = 0; i < 9 && o.burst > 0; i++) {
      const a = (i / 9) * TAU + 0.3;
      const k = clamp01(o.burst * (0.8 + (i % 3) * 0.12));
      const R = 1.5 + k * (5 + (i % 4));
      const z = Math.max(0.4, 4 * (1 - k) + Math.sin(k * PI) * 4);
      r.dot(
        B0.p(o.fwd - 2 + Math.cos(a) * R, Math.sin(a) * R, z),
        i % 2 ? COIN : COIN_HI,
        0.4,
        1,
        1,
      );
    }
  }

  // Тело, светлое брюхо.
  // Скупщик — в лиловой робе с рунами (как прежде), кобольд — мехом наружу.
  r.ell(T, [0, 0, 2.8], [2.2, 2.1, 3.1], hoard ? HOOD_M : FUR_M);
  if (!hoard) r.ell(T, [0.9, 0, 2.6], [1.4, 1.6, 2.3], FUR_LT_M);
  else
    for (let i = 0; i < 3; i++)
      r.dot(
        T.p(2.15, (i - 1) * 0.9, 2.0 + (i % 2) * 1.1),
        o.rune > 0.6 ? RUNE : RUNE_DIM,
        o.rune > 0.6 ? o.rune : 0,
        1,
        1,
      );
  // Полы капюшона-плаща за спиной (отстают при беге).
  if (!hoard) {
    const a = T.p(-1.6, 0, 5.4);
    const b = ground(B.p(o.fwd - 2.0 - o.drag * 1.8, o.side * 0.4, 2.2 + o.drag * 0.6));
    r.cap(a, b, 1.9, 1.4, HOOD_M);
    for (let i = 1; i <= 3; i++) {
      const p = vlerp(a, b, i / 4);
      r.dot(
        vadd(p, B.v(-1.5, 0, 0)),
        o.rune > 0.6 ? RUNE : RUNE_DIM,
        o.rune > 0.6 ? o.rune : 0,
        1,
        1,
      );
    }
  }

  // Голова в капюшоне: морда наружу, уши сквозь прорези.
  const H = T.at(1.0, 0, 6.4).pitch(-o.lean * 0.7 + o.head);
  r.ell(H, [0, 0, 0], [2.0, 1.8, 1.7], FUR_PLAIN);
  r.ell(H, [-0.5, 0, 0.3], [2.2, 2.3, 2.1], HOOD_M, (q) => q[0] > 0.4 && q[2] < 0.75);
  r.cap(H.p(0.9, 0, -0.3), H.p(3.3, 0, -0.75), 1.0, 0.55, FUR_PLAIN);
  r.dot(H.p(3.4, 0, -0.55), NOSE, 0, 1, 0.9);
  if (o.jaw > 0.15)
    r.cap(H.p(1.2, 0, -1.0), H.p(2.9, 0, -1.2 - o.jaw * 0.7), 0.5, 0.35, {
      T: tn('#2a0a0a', '#5a1a1a', '#8a2a2a', '#b04a4a'),
    });
  for (const sd of [-1, 1]) {
    const base = H.p(-0.4, sd * 1.15, 1.3);
    r.spike(
      base,
      H.v(-0.35 - o.ears, sd * 0.6, 1 - o.ears * 0.5),
      3.3,
      1.0,
      sd === cs ? FUR_PLAIN : FUR_FAR,
      3,
    );
    if (o.shut > 0.5) r.dot(H.p(1.0, sd * 0.95, 0.45), INK, 0, 1, 1.2);
    else r.dot(H.p(1.0, sd * 0.95, 0.45), EYE, o.rune > 0.6 ? 0.9 : 0, 1, 1.2);
  }
  r.eye = o.shut > 0.5 ? null : H.p(1.0, cs * 0.95, 0.45);

  // Руки и кинжал (у скупщика — левая придерживает лямку, правая пустая).
  const D = vnorm(
    B0.v(Math.cos(o.dp) * Math.cos(o.dyaw), Math.cos(o.dp) * Math.sin(o.dyaw), Math.sin(o.dp)),
  );
  const Pw = o.roll ? P : B0.at(o.fwd, o.side, o.hip);
  const G = Pw.p(o.grip[0], o.grip[1], o.grip[2]);
  for (const sd of [-1, 1]) {
    const S = T.p(0.4, sd * 1.9, 4.9);
    const hand = sd > 0 ? (o.free > 0.2 ? T.p(1.4, 2.4, 2.2) : G) : Pw.p(o.lh[0], o.lh[1], o.lh[2]);
    const el = ik2(S, hand, 2.3, 2.3, B.v(-0.5, sd * 1.0, -0.7));
    r.cap(S, el, 0.85, 0.7, HOOD_M);
    r.cap(el, hand, 0.65, 0.55, sd === cs ? FUR_PLAIN : FUR_FAR);
    r.ball(hand, 0.65, FUR_PLAIN);
  }
  if (!hoard) {
    let a = vsub(G, vmul(D, 1.0));
    let b = vadd(G, vmul(D, 0.7));
    let dir = D;
    if (o.free > 0) {
      const k = clamp01(o.free);
      const la = B0.p(2.4, 3.2, 0.5);
      const lb = vadd(la, B0.v(1.6, 0.4, 0));
      a = vlerp(a, la, k);
      b = vlerp(b, lb, k);
      dir = vnorm(vsub(b, a));
    }
    r.cap(a, b, 0.42, 0.42, { T: tn('#1a1010', '#3a2418', '#5a3a24', '#7a5434') });
    r.spike(b, dir, 4.4, 1.0, STEEL_M, 4, PI / 4);
  }

  // Искры прыжка: кружат вокруг и поднимаются.
  if (o.spark > 0) {
    const n = 6;
    for (let i = 0; i < n; i++) {
      const a = o.spin + (i / n) * TAU;
      const R = 3.6 - o.spark * 1.2;
      const z = 1 + ((i * 2.3 + o.spin * 2) % 10) * o.spark;
      r.dot(
        B0.p(o.fwd + Math.cos(a) * R, Math.sin(a) * R, z),
        i % 2 ? RUNE : hx('#e0d0ff'),
        1,
        1,
        1,
      );
    }
  }
  return r;
}

// ---- Позы ----

function kobPose(anim: string, f: number, hoard: boolean): KobO {
  const o: KobO = { ...K0, fl: [...K0.fl], fr: [...K0.fr], grip: [...K0.grip], lh: [...K0.lh] };
  if (hoard) {
    o.lean = 0.32;
    o.grip = [1.6, 2.0, 2.2];
    o.lh = [1.6, -2.0, 2.4];
  }
  const t = f / 24;
  switch (anim) {
    case 'idle': {
      // 8 кадров по 6 к/с: переминается, уши ловят звуки, хвост метёт.
      const a = (f / 8) * TAU;
      o.hip -= 0.2 * (1 - Math.cos(a));
      o.ears = 0.15 + 0.25 * Math.max(0, Math.sin(a * 2 - 1));
      o.tail = a;
      o.head = 0.08 * Math.sin(a + 1);
      o.twist = 0.15 * Math.sin(a);
      o.dp = 0.5 + 0.15 * Math.sin(a - 0.5);
      o.shut = f === 4 ? 1 : 0;
      o.rune = 0.35 + 0.15 * Math.sin(a);
      o.sack = -0.15 * (1 - Math.cos(a - 0.6));
      break;
    }
    case 'run': {
      // 8 кадров на цикл двух шагов: низко, рывками; уши назад, плащ
      // вьётся; у скупщика мешок прыгает с запаздыванием.
      const ph = f / 8;
      feet(o, ph, 2.6, 1.8);
      const b = Math.abs(Math.cos(ph * TAU));
      o.hip = 5.0 + 0.7 * (1 - b);
      o.lean = hoard ? 0.65 : 0.5;
      o.fwd = 0.5;
      o.side = 0.25 * Math.sin(ph * TAU);
      o.twist = 0.2 * Math.sin(ph * TAU);
      o.ears = 0.7 + 0.15 * Math.sin(ph * TAU * 2 - 1.2);
      o.tail = ph * TAU;
      o.tailA = 0.9;
      o.drag = 1;
      o.grip = [0.8 + 1.0 * Math.sin(ph * TAU + PI), 2.2, 2.0];
      o.lh = hoard ? [1.6, -2.0, 2.4] : [0.8 + 1.0 * Math.sin(ph * TAU), -2.2, 2.0];
      o.dp = 0.2;
      o.sack = 0.6 * (1 - Math.abs(Math.cos(ph * TAU - 0.9)));
      break;
    }
    case 'mark': {
      // Уход, 0,42 с (11 кадров): присел (до 0,12) → руны и искры (до 0,3)
      // → рывок вверх (до 0,38) → столб света (последние два).
      if (t >= 0.375) {
        o.beam = t >= 0.4 ? 1 : 0.6;
        break;
      }
      o.hip = trk(t, [
        [0, 5.4],
        [0.12, 3.6, easeOut],
        [0.3, 3.4],
        [0.36, 6.4, easeIn],
      ]);
      o.lean = trk(t, [
        [0, 0.3],
        [0.12, 0.6],
        [0.3, 0.55],
        [0.36, -0.1],
      ]);
      o.ears = trk(t, [
        [0, 0.2],
        [0.12, 0.9],
        [0.36, -0.2],
      ]);
      o.rune = trk(t, [
        [0, 0.4],
        [0.3, 1],
      ]);
      o.spark = trk(t, [
        [0.06, 0],
        [0.3, 1],
      ]);
      o.spin = t * 18;
      o.fl = [0.9, -2.0, 0];
      o.fr = [-0.6, 2.0, 0];
      o.grip = [0.6, 2.0, 3.6];
      o.dp = 1.2;
      o.lh = [0.6, -1.8, 3.6];
      o.shut = t > 0.12 && t < 0.3 ? 1 : 0;
      o.drag = trk(t, [
        [0, 0.2],
        [0.3, -0.4],
        [0.36, 1.2],
      ]);
      o.sack = trk(t, [
        [0, 0],
        [0.12, -0.6],
        [0.36, -1.2],
      ]);
      break;
    }
    case 'appear': {
      // Приход, 0,22 с (6 кадров): столб → падает вытянутым → присед → встал.
      if (f === 0) {
        o.beam = 1;
        break;
      }
      o.hip = trk(t, [
        [0.04, 6.6],
        [0.1, 3.4, easeIn],
        [0.2, 5.4, easeOut],
      ]);
      o.lean = trk(t, [
        [0.04, -0.1],
        [0.1, 0.6],
        [0.2, 0.35],
      ]);
      o.ears = trk(t, [
        [0.04, -0.3],
        [0.1, 0.9],
        [0.2, 0.2],
      ]);
      o.fl = [0.9, -2.0, t < 0.08 ? 1.2 : 0];
      o.fr = [-0.6, 2.0, t < 0.08 ? 1.2 : 0];
      o.rune = trk(t, [
        [0.04, 1],
        [0.2, 0.4],
      ]);
      o.spark = trk(t, [
        [0.04, 0.8],
        [0.16, 0],
      ]);
      o.spin = t * 18;
      o.drag = trk(t, [
        [0.04, -1.0],
        [0.12, 0.6],
        [0.2, 0.2],
      ]);
      o.grip = [1.2, 2.2, 2.0];
      o.dp = 0.3;
      o.sack = trk(t, [
        [0.04, 1.2],
        [0.1, -0.8],
        [0.2, 0],
      ]);
      break;
    }
    case 'stab': {
      // Укол, windup 0,32 (8 кадров): кинжал назад к уху (до 0,2),
      // задержка, укол с выпадом — кадр урона 7-й.
      const k = clamp01((f + 1) / 8);
      o.grip = [
        trk(k, [
          [0, 1.6],
          [0.62, -1.4, easeOut],
          [0.85, -1.6],
          [1, 4.2, easeIn3],
        ]),
        trk(k, [
          [0, 2.2],
          [0.62, 2.4],
          [1, 1.2],
        ]),
        trk(k, [
          [0, 1.6],
          [0.62, 4.0],
          [0.85, 4.1],
          [1, 2.4, easeIn3],
        ]),
      ];
      o.dp = trk(k, [
        [0, 0.5],
        [0.62, 0.9],
        [1, -0.2, easeIn3],
      ]);
      o.twist = trk(k, [
        [0, 0],
        [0.62, -0.5],
        [0.85, -0.55],
        [1, 0.45, easeIn3],
      ]);
      o.lean = trk(k, [
        [0, 0.3],
        [0.62, 0.15],
        [1, 0.65, easeIn3],
      ]);
      o.hip = trk(k, [
        [0, 5.4],
        [0.62, 4.7],
        [1, 4.9],
      ]);
      o.fwd = trk(k, [
        [0, 0],
        [0.62, -0.6],
        [1, 1.3, easeIn3],
      ]);
      o.fl = [
        trk(k, [
          [0.85, 0.6],
          [1, 2.4],
        ]),
        -1.7,
        k > 0.86 && k < 1 ? 0.8 : 0,
      ];
      o.fr = [-1.2, 1.7, 0];
      o.ears = trk(k, [
        [0, 0.2],
        [0.62, 0.8],
        [1, 0.5],
      ]);
      o.jaw = trk(k, [
        [0.4, 0],
        [0.7, 0.7],
        [1, 1],
      ]);
      o.lh = [0.4, -2.4, 3.0];
      o.tail = k * 3;
      break;
    }
    case 'stabf': {
      // После укола 0,55 с: клинок дальше цели, отдёрнул, отскок назад —
      // готовится к прыжку прочь.
      o.grip = [
        trk(t, [
          [0, 4.2],
          [0.05, 4.6, easeOut],
          [0.3, 1.6],
        ]),
        trk(t, [
          [0, 1.2],
          [0.3, 2.2],
        ]),
        trk(t, [
          [0, 2.4],
          [0.3, 1.6],
        ]),
      ];
      o.dp = trk(t, [
        [0, -0.2],
        [0.06, -0.3],
        [0.3, 0.5],
      ]);
      o.twist = trk(t, [
        [0, 0.45],
        [0.3, 0],
      ]);
      o.lean = trk(t, [
        [0, 0.65],
        [0.08, 0.7],
        [0.35, 0.35],
      ]);
      o.fwd = trk(t, [
        [0, 1.3],
        [0.1, 1.4],
        [0.4, -0.4],
        [0.55, 0],
      ]);
      o.hip = trk(t, [
        [0, 4.9],
        [0.4, 5.0],
        [0.55, 5.4],
      ]);
      o.fl = [
        trk(t, [
          [0.15, 2.4],
          [0.4, 0.6],
        ]),
        -1.7,
        t > 0.15 && t < 0.4 ? Math.sin(((t - 0.15) / 0.25) * PI) * 1.2 : 0,
      ];
      o.fr = [-1.2, 1.7, 0];
      o.jaw = trk(t, [
        [0, 1],
        [0.12, 0],
      ]);
      o.ears = trk(t, [
        [0, 0.5],
        [0.2, 0.1],
        [0.4, 0.3],
      ]);
      o.tail = 3 + t * 10;
      break;
    }
    case 'flinch': {
      const b = Math.sin(PI * Math.min(1, (f / 4) * 1.2)) * (1 - (f / 4) * 0.4);
      o.lean = 0.3 - 0.5 * b;
      o.head = -0.4 * b;
      o.fwd = -0.8 * b;
      o.ears = 0.15 + 0.9 * b;
      o.shut = b > 0.3 ? 1 : 0;
      o.jaw = 0.6 * b;
      o.grip = [0.8, 2.4, 1.6 + 1.6 * b];
      o.dp = 0.5 + 0.6 * b;
      o.sack = 0.5 * b;
      break;
    }
    case 'die': {
      // Смерть 0,87 с: отбросило, кинжал выпал, рухнул на бок — руны
      // гаснут, дрогнули уши.
      o.lean = trk(t, [
        [0, 0.3],
        [0.1, -0.4, easeOut],
        [0.4, 0.4],
      ]);
      o.head = trk(t, [
        [0, 0],
        [0.1, -0.5],
        [0.45, 0.3],
      ]);
      o.hip = trk(t, [
        [0, 5.4],
        [0.1, 5.2],
        [0.38, 2.4, easeIn],
      ]);
      o.fwd = trk(t, [
        [0, 0],
        [0.12, -1.2],
      ]);
      o.roll = trk(t, [
        [0.25, 0],
        [0.45, 1.45, easeIn],
        [0.5, 1.35],
        [0.55, 1.45],
      ]);
      o.free = trk(t, [
        [0.05, 0],
        [0.35, 1, easeIn],
      ]);
      o.shut = t > 0.05 ? 1 : 0;
      o.jaw = trk(t, [
        [0, 0.5],
        [0.1, 1],
        [0.6, 0.4],
      ]);
      o.rune = trk(t, [
        [0, 1],
        [0.5, 0.3],
        [0.8, 0],
      ]);
      o.ears =
        t > 0.6 ? 0.4 + 0.3 * Math.sin((t - 0.6) * 40) * (1 - clamp01((t - 0.6) / 0.25)) : 0.6;
      o.tail = t * 4;
      o.tailA = trk(t, [
        [0.5, 0.5],
        [0.8, 0],
      ]);
      o.sack = trk(t, [
        [0, 0],
        [0.15, 1.0],
        [0.45, -1.2],
      ]);
      if (hoard)
        o.burst = trk(t, [
          [0.12, 0],
          [0.6, 1, easeOut],
        ]);
      break;
    }
  }
  return o;
}

// ---- Кадры ----

const KOB = kindOf('f9_kobold', 40, 38, 20, 24, 1100, 1.4);
const HOA = kindOf('f9_hoarder', 40, 38, 20, 24, 900, 1.4);
const kobPic = (anim: string, f: number, d: number): Pic =>
  drawRig(KOB, kobRig(kobPose(anim, f, false), yawN(d), false));
const hoaPic = (anim: string, f: number, d: number): Pic =>
  drawRig(HOA, kobRig(kobPose(anim, f, true), yawN(d), true));
const STRIDE = 0.8;

function painter(K: Kind, hoard: boolean, pic: (a: string, f: number, d: number) => Pic) {
  return (m: Mob, pose: MobPose): MobFrame => {
    const md = pose.mode;
    const t = pose.t;
    const now = pose.now || 0;
    const id = m.id ?? 0;
    const tech = md === 'windup' || md === 'recover' || md === 'f9_mark' || md === 'f9_appear';
    const v = visOf(m, pose, tech || !moving(m, 0.3) ? (m.face ?? 0) : headOf(m, 0.3), 12);
    const ex: Partial<MobFrame> = { shadow: 4, still: true };
    let anim = 'idle';
    let f = 0;
    const warp = now - v.warpAt;
    if (md === 'dying') {
      anim = 'die';
      f = fi(t, 20);
      ex.linger = 0.9;
      ex.alpha = 1 - sstep(0.7, 0.9, t);
    } else if (md === 'f9_mark') {
      anim = 'mark';
      f = fi(t, 10);
      // Сжатие и рывок — масштабом кадра, столб — своим рисунком.
      if (t < 0.12) {
        const k = t / 0.12;
        ex.sx = 1 + 0.12 * k;
        ex.sy = 1 - 0.12 * k;
      } else if (t < 0.3) {
        ex.sx = 1.12;
        ex.sy = 0.88;
        ex.dx = (Math.floor(t * 40) % 2 ? 0.3 : -0.3) * (hoard ? 0.5 : 1);
      } else if (t < 0.375) {
        const k = (t - 0.3) / 0.075;
        ex.sx = lerp(1.12, 0.7, k);
        ex.sy = lerp(0.88, 1.4, k);
        ex.dy = -3 * k;
      }
      if (t >= 0.375) ex.shadow = 2;
    } else if (md === 'f9_appear' || (warp >= 0 && warp < 0.22 && md !== 'windup')) {
      // Приход: прыжком или кругом (мгновенный перенос — по скачку).
      const tt = md === 'f9_appear' ? t : warp;
      anim = 'appear';
      f = fi(tt, 5);
      if (tt < 0.1 && f > 0) {
        const k = (tt - 0.04) / 0.06;
        ex.sx = lerp(0.7, 1.22, clamp01(k));
        ex.sy = lerp(1.4, 0.78, clamp01(k));
        ex.dy = -3 * (1 - clamp01(k));
      } else if (tt < 0.2 && f > 0) {
        const k = (tt - 0.1) / 0.1;
        ex.sx = lerp(1.22, 1, easeOut(k));
        ex.sy = lerp(0.78, 1, easeOut(k));
      }
      if (f === 0) ex.shadow = 2;
    } else if (md === 'windup' && !hoard) {
      anim = 'stab';
      f = fi(t, 7);
    } else if (md === 'recover' && !hoard) {
      anim = 'stabf';
      f = fi(t, 13);
    } else if (md === 'stun' || hurtAge(v, now) >= 0) {
      anim = 'flinch';
      f = fi(md === 'stun' ? t : hurtAge(v, now), 4);
    } else if (moving(m, 0.3)) {
      anim = 'run';
      f = mod((v.dist / STRIDE) * 8, 8);
    } else {
      anim = 'idle';
      f = mod((now + hash(id, 11) * 5) * 6, 8);
    }
    if (md !== 'dying') hurtFields(v, now, ex);
    const d = dirN(v.yaw);
    return out(
      frameOf(K, anim, f, d, pose.look, () => pic(anim, f, d)),
      ex,
      pose.flash,
    );
  };
}

registerMobPainter('f9_kobold', painter(KOB, false, kobPic));
registerMobPainter('f9_hoarder', painter(HOA, true, hoaPic));

export const KOB_WARM: [string, number][] = [
  ['run', 8],
  ['idle', 8],
  ['mark', 11],
  ['appear', 6],
  ['stab', 8],
  ['stabf', 14],
  ['flinch', 5],
  ['die', 21],
];
export const HOA_WARM: [string, number][] = [
  ['run', 8],
  ['idle', 8],
  ['mark', 11],
  ['appear', 6],
  ['flinch', 5],
  ['die', 21],
];
registerMobWarm('f9_kobold', function* () {
  yield* warmAll(KOB, KOB_WARM, kobPic);
});
registerMobWarm('f9_hoarder', function* () {
  yield* warmAll(HOA, HOA_WARM, hoaPic);
});
