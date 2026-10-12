// Этаж 9 — ящеролюды (анимации мобов 9): копейщик и жрец на одном теле.
// Двуногие, 8 сторон (все рисуются честно: копьё и посох — в правой руке),
// идут туда, куда смотрят; шаг — по пройденному пути. Хвост и гребень —
// вторичное движение: волна по хвосту идёт от таза к кончику с
// запаздыванием, копьё и посох догоняют руки.
//
// Копейщик (`f9_lizard`): укол — замах на весь windup 0,45 (взвёл копьё
// назад, присел, задержка, удар с выпадом в кадр урона), проводка дальше
// цели и возврат; выпад — прицел-пружина (сжался, хвост вверх, шипит),
// бросок со шлейфом, торможение юзом; копьё в кладке — три рывка на себя
// и выдёргивание; падение со свода — болтает лапами, приземление в присед.
// Жрец (`f9_priest`): руна — посох над головой, сфера наливается, руны
// кружат, удар посохом оземь ровно в миг переноса; удар посохом — из-за
// плеча сверху. Смерти: копейщик роняет копьё и заваливается на бок,
// жрец оседает, сфера гаснет с мерцанием.

import { registerMobPainter, registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import { F3, Rig, vmul, vnorm, vsub } from './f15-rig';
import type { Mat, V3 } from './f15-rig';
import {
  INK,
  PI,
  TAU,
  WHITE,
  camSide,
  clamp01,
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
  vlerp,
  visOf,
  warmAll,
  yawN,
  dirN,
} from './f9-mobkit';
import type { Kind, Pic } from './f9-mobkit';

// ---- Палитра (прежняя: зелёная чешуя, светлое брюхо, рыжий гребень) ----

const SKIN = tn('#16301f', '#2c5a3a', '#4c8a4e', '#86ba6a');
const BELLY = tn('#5e5a30', '#9c9456', '#c8c07e', '#eae2a6');
const CREST = tn('#6a1a10', '#b8401e', '#ec7a34', '#ffc070');
const WOOD = tn('#2a160c', '#5a3820', '#86582e', '#aa7a44');
const BLADE = tn('#141420', '#2e2e46', '#5a5a7e', '#a8a8d0');
const CLOTH = tn('#4a0c0c', '#8a2020', '#c03a2e', '#f07a5a');
const MOUTH = tn('#2a0808', '#6a1a1a', '#a03030', '#d06060');
const EYE = hx('#ffd23a');
const SCALE_DK = hx('#1c3a26');
const SCALE_LT = hx('#6aa45c');
const TOOTH = hx('#f0e6c8');
// Жрец: плащ из камыша, костяная маска, перья, посох со сферой.
const ROBE = tn('#2a1e10', '#54401e', '#806234', '#a88a54');
const ROBE_DK = hx('#1e1a0a');
const MASK = tn('#6a5a44', '#a89a80', '#d6cab0', '#f2ead6');
const FEATHER_R = tn('#5a140c', '#a82a1e', '#d84a2e', '#ff8a5a');
const FEATHER_B = tn('#0c3048', '#1a6a90', '#2a8ab8', '#7ad0f0');
const ORB = tn('#4a2a8a', '#7a50e0', '#a880ff', '#f0e4ff');
const ORB_EYE = hx('#c89aff');
const RUNE = hx('#d8c0ff');

/** Чешуя по телу: тёмные «полумесяцы» шахматкой (узор в координатах тела — не кипит). */
const scaled = (T: typeof SKIN, seed: number): Mat => ({
  T,
  pat: (q, l) => {
    const a = Math.atan2(q[1], q[0]);
    const row = Math.floor((q[2] + 1) * 4.2);
    const col = Math.floor(a * 2.6 + (row % 2) * 0.5 + 20);
    const h = hash(col, row, seed);
    if (l < 0.62 && h > 0.6) return SCALE_DK;
    if (l > 0.5 && h < 0.08) return SCALE_LT;
    return null;
  },
});
const SKIN_M = scaled(SKIN, 3);
const SKIN_PLAIN: Mat = { T: SKIN };
const SKIN_FAR: Mat = { T: SKIN, bias: -0.16 };
const BELLY_M: Mat = {
  T: BELLY,
  pat: (q, l) => (Math.floor((q[2] + 1) * 5) % 2 === 0 && l < 0.7 ? BELLY[1] : null),
};
const CREST_M: Mat = { T: CREST };
const WOOD_M: Mat = { T: WOOD };
const BLADE_M: Mat = { T: BLADE, spec: true };
const CLOTH_M: Mat = { T: CLOTH };
const ROBE_M: Mat = {
  T: ROBE,
  // Камыш: вертикальные стебли по окружности, тёмные промежутки.
  pat: (q, l) => {
    const a = Math.atan2(q[2], q[1]);
    const s = Math.floor(a * 5.2 + 40);
    if (s % 3 === 0) return l > 0.4 ? ROBE[1] : ROBE_DK;
    return null;
  },
};
const MASK_M: Mat = { T: MASK, bias: 0.1 };
const MANTLE_M: Mat = {
  T: FEATHER_R,
  // Перья полосами по кругу: красные и синие, кончики светлее.
  pat: (q, l) => {
    const s = Math.floor((Math.atan2(q[1], q[0]) / TAU + 1) * 14) % 2;
    const T = s ? FEATHER_B : FEATHER_R;
    return T[l > 0.72 ? 3 : l > 0.45 ? 2 : l > 0.2 ? 1 : 0];
  },
};

// ---- Поза ----

interface LizO {
  /** Ступни в осях земли (вперёд, вбок, подъём): левая, правая. */
  fl: V3;
  fr: V3;
  /** Таз: вперёд, вбок, высота. */
  fwd: number;
  side: number;
  hip: number;
  /** Наклон корпуса вперёд, поворот плеч (+ вправо), кивок головы (+ вниз). */
  lean: number;
  twist: number;
  head: number;
  jaw: number;
  shut: number;
  /** Хвост: фаза волны, размах, подъём. */
  tail: number;
  tailA: number;
  tailUp: number;
  /** Оружие: правая кисть (от таза, оси земли), наклон (+ вверх), поворот (+ вправо). */
  grip: V3;
  wp: number;
  wy: number;
  /** Левая на древке 0…1; оружие выпало (лежит на полу) 0…1. */
  two: number;
  free: number;
  /** Завалился на бок (рад) и ушёл к полу. */
  roll: number;
  /** Жрец: свет сферы, поворот и число рун, левая рука к цели. */
  orb: number;
  spin: number;
  runes: number;
  reach: number;
  /** Подол назад (запаздывание плаща), перья гребня назад. */
  drag: number;
}

const L0: LizO = {
  fl: [0.8, -2.3, 0],
  fr: [-0.8, 2.3, 0],
  fwd: 0,
  side: 0,
  hip: 9,
  lean: 0.1,
  twist: 0,
  head: 0,
  jaw: 0,
  shut: 0,
  tail: 0,
  tailA: 0.6,
  tailUp: 0,
  grip: [1.4, 2.6, 2.2],
  wp: 0.95,
  wy: -0.25,
  two: 1,
  free: 0,
  roll: 0,
  orb: 0.5,
  spin: 0,
  runes: 0,
  reach: 0,
  drag: 0,
};
/** Жрец: посох стоймя в правой руке, левая у пояса. */
const P0: LizO = { ...L0, grip: [1.2, 3.0, 3.0], wp: 1.42, wy: 0, two: 0 };

/** Шаг: стопа на земле идёт назад, в переносе — вперёд дугой (фаза 0…1). */
function walkFeet(o: LizO, ph: number, S: number, H: number, w: number): void {
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
    const p: V3 = [f * w + 0.2, sd * 2.3, z * w];
    if (sd < 0) o.fl = p;
    else o.fr = p;
  }
}

// ---- Риг ----

function lizRig(o: LizO, yaw: number, priest: boolean): Rig {
  const r = new Rig();
  const B0 = F3.yaw(yaw);
  const B = o.roll ? B0.roll(o.roll) : B0;
  const cs = camSide(yaw);
  const P = B.at(o.fwd, o.side, o.hip);
  const T = P.turn(o.twist * 0.5).pitch(o.lean);
  const ground = (p: V3): V3 => (o.roll ? p : p[2] < 0.7 ? [p[0], p[1], 0.7] : p);

  // Хвост: волна от таза к кончику, кончик лежит на полу.
  {
    const n = 6;
    let prev = ground(P.p(-1.6, 0, priest ? -4.6 : 0.4));
    for (let i = 1; i <= n; i++) {
      const k = i / n;
      const sw = Math.sin(o.tail - i * 0.85) * o.tailA * k * 2.2;
      const drop = priest ? 4.6 + i * 0.9 : -0.4 + i * 1.45;
      const pt = ground(P.p(-1.6 - i * (priest ? 1.9 : 2.3), sw, -drop + o.tailUp * i * 1.1));
      r.cap(prev, pt, lerp(2.3, 0.5, (i - 1) / n), lerp(2.3, 0.5, k), i < 3 ? SKIN_M : SKIN_PLAIN);
      prev = pt;
    }
  }

  // Ноги: бедро → колено (вперёд) → лодыжка → пальцы.
  for (const sd of [-1, 1]) {
    const ft = sd < 0 ? o.fl : o.fr;
    const m = sd === cs ? SKIN_M : SKIN_FAR;
    const hip = P.p(0, sd * 2.1, -0.4);
    const ank = ground(B.p(ft[0], ft[1], ft[2] + 1.3));
    const toe = ground(B.p(ft[0] + 2.3, ft[1] * 1.04, ft[2] + 0.35));
    if (priest) {
      // Под плащом видны только ступни.
      r.cap(ank, toe, 1.1, 0.75, m);
    } else {
      const knee = ik2(hip, ank, 5.4, 5.2, B.v(1, 0, 0.1));
      r.cap(hip, knee, 2.0, 1.5, m);
      r.cap(knee, ank, 1.4, 1.0, m);
      r.cap(ank, toe, 1.0, 0.7, m);
    }
    r.dot(vadd(toe, B.v(0.6, 0, -0.2)), BELLY[3], 0, 1, 0.3);
  }

  // Корпус: чешуя, светлое брюхо, шипы по спине.
  if (priest && !o.roll) {
    // Юбка из камыша: подол отстаёт от таза (`drag`), колышется.
    const hem = ground(B.p(o.fwd * 0.7 - o.drag * 0.8, o.side, 1.0));
    r.cap(hem, P.p(0, 0, 0.8), 3.7, 2.9, ROBE_M);
    r.ell(F3.yaw(yaw, hem), [0, 0, 0], [3.9, 3.9, 0.8], { T: ROBE, bias: -0.3 });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      r.dot(vadd(hem, [Math.cos(a) * 3.9, Math.sin(a) * 3.9, -0.6]), ROBE_DK, 0, 1, 0.1);
    }
  } else if (priest) r.cap(P.p(-0.4, 0, 0), P.p(1.2, 0, -5.2), 4.0, 3.6, ROBE_M);
  r.ell(T, [0.2, 0, 4.6], [3.4, 3.2, 5.6], SKIN_M);
  r.ell(T, [1.5, 0, 4.2], [2.2, 2.5, 4.5], BELLY_M);
  if (priest)
    // Накидка из перьев на плечах.
    r.ell(T, [-0.2, 0, 8.4], [3.1, 3.5, 1.5], MANTLE_M);
  else
    for (let i = 0; i < 4; i++)
      r.spike(T.p(-2.9, 0, 2.4 + i * 2.1), T.v(-1, 0, 0.5), 1.7, 0.65, CREST_M, 3);

  // Шея и голова (голова держится ровнее корпуса).
  const H = T.at(2.2, 0, 11.4).pitch(-o.lean * 0.75 + o.head);
  r.cap(T.p(1.0, 0, 9.0), H.p(-0.6, 0, -0.4), 2.1, 1.8, SKIN_PLAIN);
  r.ell(H, [0, 0, 0], [2.8, 2.3, 2.1], SKIN_PLAIN);
  r.cap(H.p(1.4, 0, 0.1), H.p(4.8, 0, -0.3), 1.5, 1.0, SKIN_PLAIN);
  const J = H.at(0.4, 0, -1.0).pitch(o.jaw * 0.7);
  r.cap(J.p(0, 0, 0), J.p(4.2, 0, -0.2), 1.0, 0.65, { T: BELLY });
  if (o.jaw > 0.15) {
    r.ell(H, [2.6, 0, -1.1 - o.jaw * 0.45], [1.7, 0.9, 0.25 + o.jaw * 0.5], {
      T: MOUTH,
      soft: true,
    });
    r.dot(H.p(3.6, 0.6, -0.9), TOOTH, 0, 1, 0.9);
    r.dot(H.p(3.6, -0.6, -0.9), TOOTH, 0, 1, 0.9);
  }
  if (priest) {
    // Костяная маска с прорезями и гребень из перьев.
    r.ell(H, [1.5, 0, 0.5], [1.7, 2.1, 1.9], MASK_M);
    r.cap(H.p(1.6, 0, 0.6), H.p(3.9, 0, 0.1), 1.45, 1.05, MASK_M);
    for (let i = 0; i < 5; i++) {
      const sd = (i - 2) * 0.55;
      const base = H.p(-0.6 + Math.abs(sd) * 0.2, sd, 1.7);
      const tip = vadd(base, H.v(-1.8 - o.drag * 0.8, sd * 0.9, 3.2 - Math.abs(sd) * 0.6));
      r.cap(base, tip, 0.55, 0.3, { T: i % 2 ? FEATHER_B : FEATHER_R });
    }
  } else
    for (let i = 0; i < 4; i++)
      r.spike(
        H.p(-0.6 - i * 1.0, 0, 1.6 - i * 0.35),
        H.v(-0.7 - o.drag * 0.4, 0, 1),
        2.6 - i * 0.35,
        0.6,
        CREST_M,
        3,
      );
  for (const sd of [-1, 1]) {
    const E = H.p(1.2, sd * 1.6, 0.9);
    if (o.shut > 0.5) r.dot(E, INK, 0, 1, 1.2);
    else r.dot(E, priest ? ORB_EYE : EYE, 0.9, 1, 1.2);
    if (!priest) r.dot(H.p(4.7, sd * 0.5, 0.6), INK, 0, 1, 0.6);
  }
  r.eye = o.shut > 0.5 ? null : H.p(1.2, cs * 1.6, 0.9);

  // Оружие: древко через правую кисть.
  const D = vnorm(
    B0.v(Math.cos(o.wp) * Math.cos(o.wy), Math.cos(o.wp) * Math.sin(o.wy), Math.sin(o.wp)),
  );
  const P0w = B0.at(o.fwd, o.side, o.hip);
  // Жрец держит посох чуть впереди и сбоку, чтобы юбка его не прятала.
  const gx = priest ? 0.8 : 0;
  const G = (o.roll ? P : P0w).p(o.grip[0] + gx, o.grip[1] + gx, o.grip[2]);
  const back = priest ? 11 : 7.5;
  const fwdL = priest ? 17 : 14.5;
  let butt = vsub(G, vmul(D, back));
  let tip = vadd(G, vmul(D, fwdL));
  if (o.free > 0) {
    // Выпало: ложится на пол рядом, с отскоком.
    const lb = B0.p(-3, 4.2, 0.7);
    const lt = vadd(lb, B0.v(back + fwdL - 1, -2.6, 0));
    const k = clamp01(o.free);
    const hop = Math.sin(PI * clamp01((k - 0.55) / 0.45)) * 1.6 * (k > 0.55 ? 1 : 0);
    butt = vlerp(butt, lb, k);
    tip = vlerp(tip, lt, k);
    butt = [butt[0], butt[1], Math.max(0.7, butt[2]) + hop];
    tip = [tip[0], tip[1], Math.max(0.7, tip[2]) + hop * 0.5];
  }
  const Dw = vnorm(vsub(tip, butt));
  r.cap(butt, tip, 0.55, 0.55, WOOD_M);
  if (priest) {
    // Сфера в развилке, вокруг — руны.
    const o2 = vadd(tip, vmul(Dw, 1.6));
    for (const sd of [-1, 1]) r.cap(tip, vadd(o2, B0.v(0, sd * 1.4, -0.2)), 0.45, 0.3, WOOD_M);
    const gl = clamp01(o.orb);
    r.ball(o2, 1.7 + Math.max(0, o.orb - 1) * 0.5, {
      T: o.orb > 1.3 ? [ORB[2], ORB[3], WHITE, WHITE] : ORB,
      glow: 0.35 + gl * 0.65,
    });
    const nR = 5;
    for (let i = 0; i < nR; i++) {
      const k = clamp01(o.runes * nR - i);
      if (k <= 0) continue;
      const a = o.spin + (i / nR) * TAU;
      const R = 3.2 + (1 - k) * 2;
      r.dot(vadd(o2, [Math.cos(a) * R, Math.sin(a) * R, Math.sin(a * 2) * 0.8]), RUNE, 1, 1, 1);
    }
  } else {
    r.spike(vsub(tip, vmul(Dw, 0.3)), Dw, 4.2, 1.15, BLADE_M, 4, PI / 4);
    const tas = vsub(tip, vmul(Dw, 0.9));
    r.cap(tas, vadd(tas, vadd(B0.v(0, 0, -2.0), vmul(Dw, -0.9))), 0.6, 0.3, CLOTH_M);
  }

  // Руки: плечи → локти (наружу-вниз) → кисти на древке.
  for (const sd of [-1, 1]) {
    const S = T.p(0.9, sd * 2.7, 8.4);
    let hand: V3;
    if (sd > 0) hand = o.free > 0.2 ? T.p(2.2, 3.4, 3.6 - o.free * 1.5) : G;
    else if (o.reach > 0) hand = vlerp(T.p(1.6, -3.3, 4.2), T.p(7.2, -1.2, 9.6), o.reach);
    else if (o.two > 0 && o.free <= 0.2)
      hand = vlerp(T.p(1.6, -3.3, 4.2), vadd(G, vmul(D, 4.8)), o.two);
    else hand = T.p(1.6, -3.3, 4.2);
    const el = ik2(S, hand, 3.7, 3.7, B.v(-0.5, sd * 1.0, -0.8));
    const m = sd === cs ? SKIN_PLAIN : SKIN_FAR;
    // Жрец: рукав из камыша до локтя, дальше чешуя.
    r.cap(S, el, 1.35, 1.15, priest ? ROBE_M : m);
    r.cap(el, hand, 1.1, 0.9, m);
    r.ball(hand, 0.95, SKIN_PLAIN);
  }
  return r;
}

// ---- Позы копейщика ----

function lizPose(anim: string, f: number): LizO {
  const o: LizO = { ...L0, fl: [...L0.fl], fr: [...L0.fr], grip: [...L0.grip] };
  const t = f / 24;
  switch (anim) {
    case 'idle': {
      // 8 кадров по 6 к/с: дыхание грудью, хвост качается, копьё — следом.
      const a = (f / 8) * TAU;
      o.hip = 9 - 0.25 * (1 - Math.cos(a));
      o.lean = 0.1 + 0.03 * Math.sin(a);
      o.head = -0.06 * Math.sin(a - 0.6);
      o.tail = a;
      o.tailA = 0.5;
      o.grip = [1.4, 2.6, 2.2 - 0.25 * (1 - Math.cos(a - 0.5))];
      o.wy = -0.25 + 0.03 * Math.sin(a - 1);
      o.jaw = f === 5 ? 0.25 : 0;
      o.shut = f === 3 ? 1 : 0;
      break;
    }
    case 'run': {
      // 8 кадров на цикл двух шагов: корпус вперёд, копьё наперевес.
      const ph = f / 8;
      walkFeet(o, ph, 3.6, 2.2, 1);
      const b = Math.abs(Math.cos(ph * TAU));
      o.hip = 8.6 + 0.9 * (1 - b);
      o.lean = 0.32;
      o.fwd = 0.6;
      o.side = 0.35 * Math.sin(ph * TAU);
      o.twist = 0.12 * Math.sin(ph * TAU);
      o.tail = ph * TAU;
      o.tailA = 1.0;
      o.tailUp = 0.25;
      o.head = -0.1;
      o.grip = [2.2, 2.4, 2.6 + 0.4 * (1 - b)];
      o.wp = 0.5 + 0.06 * Math.cos(ph * TAU * 2 - 1);
      o.wy = -0.2;
      o.drag = 0.4;
      break;
    }
    case 'jab': {
      // Укол, windup 0,45 (11 кадров): взвёл (до 0,38) → задержка на пике
      // (до 0,84) → удар в кадр урона (10-й, 0,44 с).
      const k = clamp01((f + 1) / 11);
      o.grip = [
        trk(k, [
          [0, 1.6],
          [0.38, -3.2, easeOut],
          [0.84, -3.8],
          [1, 5.4, easeIn3],
        ]),
        trk(k, [
          [0, 2.6],
          [0.38, 2.2],
          [1, 1.6],
        ]),
        trk(k, [
          [0, 2.2],
          [0.38, 1.6],
          [1, 2.0],
        ]),
      ];
      o.wp = trk(k, [
        [0, 0.75],
        [0.35, 0.08, easeOut],
        [1, -0.02],
      ]);
      o.wy = trk(k, [
        [0, -0.2],
        [0.38, 0.05],
        [1, -0.06],
      ]);
      o.twist = trk(k, [
        [0, 0],
        [0.38, -0.4],
        [0.84, -0.45],
        [1, 0.3, easeIn3],
      ]);
      o.lean = trk(k, [
        [0, 0.12],
        [0.38, -0.06],
        [0.84, -0.1],
        [1, 0.45, easeIn3],
      ]);
      o.hip = trk(k, [
        [0, 9],
        [0.38, 7.9],
        [0.84, 7.6],
        [1, 8.3],
      ]);
      o.fwd = trk(k, [
        [0, 0],
        [0.38, -0.9],
        [0.84, -1.1],
        [1, 1.6, easeIn3],
      ]);
      o.fl = [
        trk(k, [
          [0, 0.8],
          [0.84, 1.2],
          [1, 3.4, easeIn],
        ]),
        -2.4,
        k > 0.84 && k < 1 ? 0.8 : 0,
      ];
      o.fr = [
        trk(k, [
          [0, -0.8],
          [0.38, -2.4],
          [1, -2.8],
        ]),
        2.4,
        0,
      ];
      o.tailUp = trk(k, [
        [0, 0],
        [0.38, 0.5],
        [0.84, 0.6],
        [1, 0.05],
      ]);
      o.tail = k * 4;
      o.tailA = 0.5;
      o.jaw = trk(k, [
        [0.3, 0],
        [0.5, 0.65],
        [0.84, 0.55],
        [1, 1],
      ]);
      o.head = trk(k, [
        [0, 0],
        [0.6, 0.12],
        [1, -0.05],
      ]);
      break;
    }
    case 'jabf': {
      // После укола, 0,6 с (15 кадров): проводка дальше цели, отдача, возврат.
      o.grip = [
        trk(t, [
          [0, 5.4],
          [0.06, 6.1, easeOut],
          [0.32, 0.6],
          [0.58, 1.4],
        ]),
        trk(t, [
          [0, 1.6],
          [0.5, 2.6],
        ]),
        2.2,
      ];
      o.wp = trk(t, [
        [0, -0.02],
        [0.1, -0.08],
        [0.45, 0.62],
        [0.6, 0.8],
      ]);
      o.wy = -0.2;
      o.twist = trk(t, [
        [0, 0.3],
        [0.08, 0.38],
        [0.4, 0],
      ]);
      o.lean = trk(t, [
        [0, 0.45],
        [0.06, 0.52],
        [0.34, 0.04],
        [0.6, 0.12],
      ]);
      o.fwd = trk(t, [
        [0, 1.6],
        [0.06, 2.0],
        [0.36, -0.3],
        [0.6, 0],
      ]);
      o.hip = trk(t, [
        [0, 8.3],
        [0.12, 7.9],
        [0.5, 9],
      ]);
      o.fl = [
        trk(t, [
          [0.12, 3.4],
          [0.45, 0.8],
        ]),
        -2.3,
        t > 0.15 && t < 0.42 ? Math.sin(((t - 0.15) / 0.27) * PI) * 1.4 : 0,
      ];
      o.fr = [
        trk(t, [
          [0, -2.8],
          [0.5, -0.8],
        ]),
        2.3,
        0,
      ];
      o.jaw = trk(t, [
        [0, 1],
        [0.1, 0],
      ]);
      o.tail = 4 + t * 9;
      o.tailA = trk(t, [
        [0, 1.2],
        [0.6, 0.5],
      ]);
      o.tailUp = trk(t, [
        [0, 0.05],
        [0.1, 0.4],
        [0.4, 0],
      ]);
      break;
    }
    case 'aim': {
      // Прицел выпада, 0,62 с (15 кадров; в трясине 0,5): сжался пружиной к
      // 0,4 — присел, копьё назад и вровень, хвост вверх, шипит; дальше
      // держит.
      o.hip = trk(t, [
        [0, 9],
        [0.4, 6.6, easeOut],
        [0.62, 6.4],
      ]);
      o.lean = trk(t, [
        [0, 0.1],
        [0.4, 0.55],
      ]);
      o.fwd = trk(t, [
        [0, 0],
        [0.4, -1.6],
      ]);
      o.grip = [
        trk(t, [
          [0, 1.6],
          [0.4, -4.4, easeOut],
          [0.62, -4.7],
        ]),
        trk(t, [
          [0, 2.4],
          [0.4, 1.8],
        ]),
        trk(t, [
          [0, 2.2],
          [0.4, 1.4],
        ]),
      ];
      o.wp = trk(t, [
        [0, 0.75],
        [0.32, -0.02],
      ]);
      o.wy = trk(t, [
        [0, -0.25],
        [0.4, -0.05],
      ]);
      o.twist = trk(t, [
        [0, 0],
        [0.4, -0.3],
      ]);
      o.tailUp = trk(t, [
        [0, 0],
        [0.4, 1.0],
      ]);
      o.tail = t * 10;
      o.tailA = trk(t, [
        [0, 0.6],
        [0.4, 0.25],
      ]);
      o.jaw = trk(t, [
        [0.15, 0],
        [0.32, 0.8],
      ]);
      o.head = trk(t, [
        [0, 0],
        [0.4, -0.3],
      ]);
      o.fl = [
        trk(t, [
          [0, 0.8],
          [0.4, 3.0],
        ]),
        -2.6,
        t > 0.05 && t < 0.3 ? Math.sin(((t - 0.05) / 0.25) * PI) * 1.2 : 0,
      ];
      o.fr = [
        trk(t, [
          [0, -0.8],
          [0.4, -4.2],
        ]),
        2.6,
        0,
      ];
      o.drag = 0.3;
      break;
    }
    case 'lunge': {
      // Выпад 0,34 с (9 кадров): копьё выстреливает за 2 кадра, тело
      // вытянуто в прыжке, хвост струной; лапы перебирают.
      const k = clamp01((f + 0.5) / 2);
      const ph = f / 4;
      o.grip = [lerp(-4.7, 7.2, easeOut(k)), 1.6, 1.6];
      o.wp = -0.04;
      o.wy = -0.05;
      o.twist = lerp(-0.3, 0.35, easeOut(k));
      o.lean = lerp(0.55, 0.78, easeOut(k));
      o.hip = lerp(6.4, 8.0, easeOut(k)) + 0.4 * Math.sin(ph * TAU);
      o.fwd = lerp(-1.6, 1.2, easeOut(k));
      o.fl = [4.6 + Math.sin(ph * TAU) * 1.2, -2.4, 1.8 + Math.cos(ph * TAU) * 0.6];
      o.fr = [-5.4 - Math.sin(ph * TAU) * 1.0, 2.4, 1.2];
      o.tailUp = 0.35;
      o.tailA = 0.15;
      o.tail = ph * TAU;
      o.jaw = 1;
      o.head = -0.35;
      o.drag = 1;
      break;
    }
    case 'lungef': {
      // Торможение после выпада, 0,6 с (15 кадров): юз на передней лапе,
      // корпус откидывает назад, копьё вскидывается и встаёт на место.
      o.lean = trk(t, [
        [0, 0.78],
        [0.12, -0.22, easeOut],
        [0.45, 0.14],
      ]);
      o.fwd = trk(t, [
        [0, 1.2],
        [0.12, -0.6],
        [0.45, 0],
      ]);
      o.hip = trk(t, [
        [0, 8.0],
        [0.12, 7.0],
        [0.5, 9],
      ]);
      o.grip = [
        trk(t, [
          [0, 7.2],
          [0.16, 3.0, easeOut],
          [0.5, 1.4],
        ]),
        trk(t, [
          [0, 1.6],
          [0.5, 2.6],
        ]),
        2.2,
      ];
      o.wp = trk(t, [
        [0, -0.04],
        [0.16, 0.4, easeOut],
        [0.5, 0.9],
      ]);
      o.wy = -0.2;
      o.fl = [
        trk(t, [
          [0, 4.6],
          [0.12, 3.8],
          [0.45, 0.8],
        ]),
        -2.4,
        0,
      ];
      o.fr = [
        trk(t, [
          [0, -5.4],
          [0.2, -3.0],
          [0.5, -0.8],
        ]),
        2.4,
        t < 0.2 ? Math.sin((t / 0.2) * PI) * 1.4 : 0,
      ];
      o.jaw = trk(t, [
        [0, 1],
        [0.2, 0],
      ]);
      o.tail = t * 12;
      o.tailA = trk(t, [
        [0, 1.4],
        [0.6, 0.5],
      ]);
      o.tailUp = trk(t, [
        [0, 0.35],
        [0.12, 0.9],
        [0.45, 0],
      ]);
      o.drag = trk(t, [
        [0, 1],
        [0.3, 0],
      ]);
      break;
    }
    case 'stuck': {
      // Копьё в кладке, 1,1 с (27 кадров): упёрся, три рывка на себя (0,2;
      // 0,55; 0,9) — корпус назад, древко стоит, хвост хлещет.
      const pull =
        Math.max(0, Math.sin(clamp01((t - 0.06) / 0.28) * PI)) * 0.8 +
        Math.max(0, Math.sin(clamp01((t - 0.42) / 0.28) * PI)) * 0.9 +
        Math.max(0, Math.sin(clamp01((t - 0.78) / 0.3) * PI)) * 1.1;
      o.fwd = -0.4 - pull * 1.4;
      o.grip = [4.6 + pull * 1.4, 1.7, 2.0];
      o.wp = -0.06;
      o.wy = -0.04;
      o.lean = -0.18 - pull * 0.22;
      o.twist = -0.1 * pull;
      o.hip = 8.4 - pull * 0.7;
      o.head = -0.15 - pull * 0.15;
      o.jaw = 0.25 + pull * 0.4;
      o.fl = [2.2, -2.5, 0];
      o.fr = [-3.2 - pull * 0.4, 2.5, 0];
      o.tail = t * 9;
      o.tailA = 0.4 + pull * 0.5;
      o.tailUp = pull * 0.4;
      break;
    }
    case 'yank': {
      // Выдернул (recover после кладки, 0,5 с): рывок назад, древко
      // вскидывается, оседает в стойку.
      o.fwd = trk(t, [
        [0, -1.9],
        [0.06, -2.6, easeOut],
        [0.45, 0],
      ]);
      o.lean = trk(t, [
        [0, -0.4],
        [0.08, -0.5],
        [0.45, 0.12],
      ]);
      o.grip = [
        trk(t, [
          [0, 6.0],
          [0.12, 2.0, easeOut],
          [0.45, 1.4],
        ]),
        trk(t, [
          [0, 1.7],
          [0.45, 2.6],
        ]),
        2.2,
      ];
      o.wp = trk(t, [
        [0, -0.06],
        [0.12, 0.7, easeOut],
        [0.45, 0.9],
      ]);
      o.hip = trk(t, [
        [0, 7.7],
        [0.15, 8.2],
        [0.45, 9],
      ]);
      o.fl = [
        trk(t, [
          [0, 2.2],
          [0.3, 0.8],
        ]),
        -2.4,
        0,
      ];
      o.fr = [
        trk(t, [
          [0, -3.6],
          [0.1, -4.2],
          [0.4, -0.8],
        ]),
        2.4,
        0,
      ];
      o.tail = t * 10;
      o.tailA = trk(t, [
        [0, 1.2],
        [0.5, 0.5],
      ]);
      o.jaw = trk(t, [
        [0, 0.65],
        [0.2, 0],
      ]);
      break;
    }
    case 'drop': {
      // Падает со свода (кадр несёт движок): копьё поперёк над головой,
      // лапы болтаются, хвост закручен.
      o.hip = 9.5;
      o.lean = -0.1;
      o.grip = [1.0, 3.6, 8.6];
      o.wp = 0.1;
      o.wy = -1.4;
      o.fl = [1.2, -3.0, f ? 2.2 : 1.2];
      o.fr = [-1.2, 3.0, f ? 1.0 : 2.0];
      o.tailUp = 1.6;
      o.tail = f * 2;
      o.tailA = 0.9;
      o.jaw = 0.8;
      o.head = -0.25;
      break;
    }
    case 'land': {
      // Приземление (stun после падения, 0,2 с): глубокий присед и подъём.
      o.hip = trk(t, [
        [0, 5.6],
        [0.2, 8.6],
      ]);
      o.lean = trk(t, [
        [0, 0.45],
        [0.2, 0.15],
      ]);
      o.fl = [1.8, -3.2, 0];
      o.fr = [-1.6, 3.2, 0];
      o.grip = [
        2.2,
        2.8,
        trk(t, [
          [0, 0.6],
          [0.2, 2.0],
        ]),
      ];
      o.wp = 0.5;
      o.tailUp = trk(t, [
        [0, 0.9],
        [0.2, 0.1],
      ]);
      o.tail = t * 10;
      break;
    }
    case 'flinch': {
      // Ушиб (0,2 с, 5 кадров): голову назад, зажмурился, копьё вверх.
      const b = Math.sin(PI * Math.min(1, (f / 4) * 1.2)) * (1 - (f / 4) * 0.4);
      o.lean = 0.1 - 0.45 * b;
      o.head = -0.45 * b;
      o.twist = 0.2 * b;
      o.fwd = -0.9 * b;
      o.hip = 9 - 0.8 * b;
      o.jaw = 0.5 * b;
      o.shut = b > 0.3 ? 1 : 0;
      o.wp = 0.95 + 0.4 * b;
      o.grip = [1.0, 2.8, 2.2 + 1.2 * b];
      o.tailUp = 0.4 * b;
      o.tail = f;
      break;
    }
    case 'die': {
      // Смерть 0,87 с (21 кадр): отшатнулся (до 0,1) → колени подломились,
      // копьё выпало (до 0,35) → завалился на бок (до 0,55) → хвост дёрнулся.
      o.lean = trk(t, [
        [0, 0.1],
        [0.1, -0.4, easeOut],
        [0.35, 0.3],
        [0.55, 0.2],
      ]);
      o.head = trk(t, [
        [0, 0],
        [0.1, -0.5],
        [0.4, 0.3],
        [0.6, 0.1],
      ]);
      o.jaw = trk(t, [
        [0, 0.6],
        [0.1, 1],
        [0.5, 0.5],
        [0.8, 0.2],
      ]);
      o.shut = t > 0.06 ? 1 : 0;
      o.hip = trk(t, [
        [0, 9],
        [0.1, 8.6],
        [0.35, 4.8, easeIn],
        [0.55, 3.2],
      ]);
      o.fwd = trk(t, [
        [0, 0],
        [0.1, -1.2],
        [0.35, -0.6],
      ]);
      o.roll = trk(t, [
        [0.3, 0],
        [0.55, 1.42, easeIn],
        [0.6, 1.32],
        [0.66, 1.42],
      ]);
      o.free = trk(t, [
        [0.08, 0],
        [0.42, 1, easeIn],
      ]);
      o.wp = trk(t, [
        [0, 0.95],
        [0.1, 1.35],
      ]);
      o.grip = [
        1.0,
        2.8,
        trk(t, [
          [0, 2.2],
          [0.1, 3.4],
        ]),
      ];
      o.fl = [1.2, -2.6, 0];
      o.fr = [-1.0, 2.6, 0];
      o.tail = t > 0.6 ? (t - 0.6) * 26 : 0;
      o.tailA = t > 0.6 ? 0.9 * (1 - clamp01((t - 0.6) / 0.27)) : 0.3;
      o.tailUp = trk(t, [
        [0, 0],
        [0.12, 0.8],
        [0.4, 0],
      ]);
      break;
    }
  }
  return o;
}

// ---- Позы жреца ----

function priestPose(anim: string, f: number): LizO {
  const o: LizO = { ...P0, fl: [...P0.fl], fr: [...P0.fr], grip: [...P0.grip] };
  const t = f / 24;
  switch (anim) {
    case 'idle': {
      // 8 кадров по 5 к/с: дышит, сфера пульсирует, перья колышутся.
      const a = (f / 8) * TAU;
      o.hip = 9 - 0.2 * (1 - Math.cos(a));
      o.orb = 0.5 + 0.2 * Math.sin(a);
      o.spin = a * 0.5;
      o.tail = a;
      o.tailA = 0.5;
      o.drag = 0.15 * Math.sin(a - 1);
      o.head = 0.05 * Math.sin(a - 0.5);
      o.grip = [1.2, 3.0, 3.0 - 0.2 * (1 - Math.cos(a - 0.4))];
      break;
    }
    case 'walk': {
      // 8 кадров на цикл: шаг под подолом, посох идёт вперёд с шагом.
      const ph = f / 8;
      walkFeet(o, ph, 2.6, 1.4, 1);
      const b = Math.abs(Math.cos(ph * TAU));
      o.hip = 8.7 + 0.5 * (1 - b);
      o.lean = 0.15;
      o.side = 0.3 * Math.sin(ph * TAU);
      o.drag = 1.0 + 0.4 * b;
      o.tail = ph * TAU;
      o.tailA = 0.8;
      o.grip = [1.6 + 1.0 * Math.sin(ph * TAU), 3.0, 3.2];
      o.wp = 1.32 + 0.08 * Math.sin(ph * TAU);
      o.orb = 0.5;
      o.spin = ph * TAU;
      break;
    }
    case 'cast': {
      // Руна, 1,15 с (28 кадров): присел и прибрал посох (до 0,22) → посох
      // над головой, левая рука к цели (до 0,4) → сфера наливается, руны
      // кружат (до 0,95) → дрожь (до 1,1) → оземь в кадр переноса (27-й).
      o.hip = trk(t, [
        [0, 9],
        [0.22, 7.4],
        [0.4, 9.4, easeOut],
        [1.04, 9.2],
        [1.12, 7.2, easeIn3],
      ]);
      o.grip = [
        trk(t, [
          [0, 1.2],
          [0.22, 0.6],
          [0.4, 2.2],
          [1.04, 2.4],
          [1.12, 3.2, easeIn3],
        ]),
        trk(t, [
          [0, 3.0],
          [0.22, 2.6],
          [0.4, 1.8],
          [1.12, 2.6],
        ]),
        trk(t, [
          [0, 3.0],
          [0.22, 1.6],
          [0.4, 8.4, easeOut],
          [1.04, 8.6],
          [1.12, 3.6, easeIn3],
        ]),
      ];
      o.wp = trk(t, [
        [0, 1.42],
        [0.22, 1.3],
        [0.4, 1.5],
      ]);
      o.lean = trk(t, [
        [0, 0.1],
        [0.22, 0.3],
        [0.4, -0.15],
        [1.04, -0.18],
        [1.12, 0.35, easeIn3],
      ]);
      o.reach = trk(t, [
        [0.2, 0],
        [0.4, 1, easeOut],
        [1.04, 1],
        [1.12, 0.4],
      ]);
      o.orb = trk(t, [
        [0, 0.5],
        [0.4, 0.8],
        [0.95, 1.4],
        [1.12, 1.8],
      ]);
      o.orb += t > 0.4 && t < 1.1 ? 0.15 * Math.sin(t * 30) : 0;
      o.runes = trk(t, [
        [0.3, 0],
        [0.8, 1],
      ]);
      o.spin = t * 7;
      o.tail = t * 6;
      o.tailA = 0.7;
      o.head = trk(t, [
        [0, 0],
        [0.4, -0.2],
        [1.04, -0.2],
        [1.12, 0.2],
      ]);
      o.jaw = trk(t, [
        [0.4, 0],
        [0.55, 0.5],
        [1.1, 0.7],
        [1.12, 1],
      ]);
      o.drag = trk(t, [
        [0.3, 0],
        [0.45, 0.6],
        [0.7, 0.2],
      ]);
      o.fl = [1.4, -2.6, 0];
      o.fr = [-1.0, 2.6, 0];
      break;
    }
    case 'castf': {
      // После руны, 0,7 с (17 кадров): посох в полу, вспышка сферы гаснет,
      // руны разлетаются, выпрямился.
      o.hip = trk(t, [
        [0, 7.2],
        [0.06, 6.9],
        [0.45, 9],
      ]);
      o.grip = [
        trk(t, [
          [0, 3.2],
          [0.45, 1.2],
        ]),
        trk(t, [
          [0, 2.6],
          [0.45, 3.0],
        ]),
        trk(t, [
          [0, 3.6],
          [0.06, 3.3],
          [0.45, 3.0],
        ]),
      ];
      o.lean = trk(t, [
        [0, 0.35],
        [0.06, 0.4],
        [0.45, 0.1],
      ]);
      o.orb = trk(t, [
        [0, 2.0],
        [0.1, 1.6],
        [0.5, 0.5],
      ]);
      o.runes = trk(t, [
        [0, 1],
        [0.3, 0],
      ]);
      o.spin = 8 + t * 4;
      o.reach = trk(t, [
        [0, 0.4],
        [0.3, 0],
      ]);
      o.jaw = trk(t, [
        [0, 1],
        [0.15, 0],
      ]);
      o.drag = trk(t, [
        [0, -0.6],
        [0.3, 0.2],
        [0.6, 0],
      ]);
      o.tail = 7 + t * 6;
      o.fl = [1.4, -2.6, 0];
      o.fr = [-1.0, 2.6, 0];
      break;
    }
    case 'swing': {
      // Удар посохом, windup 0,4 (10 кадров): занёс за правое плечо (до 0,3)
      // → задержка → хлёст сверху вперёд в кадр урона (9-й).
      const k = clamp01((f + 1) / 10);
      o.twist = trk(k, [
        [0, 0],
        [0.7, -0.7, easeOut],
        [0.86, -0.75],
        [1, 0.5, easeIn3],
      ]);
      o.grip = [
        trk(k, [
          [0, 1.2],
          [0.7, -1.6],
          [0.86, -1.8],
          [1, 3.4, easeIn3],
        ]),
        trk(k, [
          [0, 3.0],
          [0.7, 3.4],
          [1, 1.2],
        ]),
        trk(k, [
          [0, 3.0],
          [0.7, 6.4, easeOut],
          [0.86, 6.8],
          [1, 4.4, easeIn3],
        ]),
      ];
      o.wp = trk(k, [
        [0, 1.42],
        [0.7, 2.35],
        [0.86, 2.45],
        [1, 0.05, easeIn3],
      ]);
      o.wy = trk(k, [
        [0, 0],
        [0.7, 0.4],
        [1, -0.1],
      ]);
      o.lean = trk(k, [
        [0, 0.1],
        [0.7, -0.15],
        [1, 0.4, easeIn3],
      ]);
      o.hip = trk(k, [
        [0, 9],
        [0.7, 8.4],
        [1, 8.0],
      ]);
      o.fl = [
        trk(k, [
          [0, 0.8],
          [0.86, 1.0],
          [1, 2.8],
        ]),
        -2.5,
        0,
      ];
      o.fr = [-1.6, 2.5, 0];
      o.jaw = trk(k, [
        [0.5, 0],
        [0.86, 0.5],
        [1, 1],
      ]);
      o.orb = 0.6 + k * 0.4;
      o.tail = k * 4;
      o.drag = trk(k, [
        [0.86, 0],
        [1, -0.8],
      ]);
      break;
    }
    case 'swingf': {
      // После удара, 0,7 с: посох проходит ниже цели, отдача, посох стоймя.
      o.wp = trk(t, [
        [0, 0.05],
        [0.06, -0.3, easeOut],
        [0.4, 1.0],
        [0.6, 1.42],
      ]);
      o.wy = trk(t, [
        [0, -0.1],
        [0.5, 0],
      ]);
      o.twist = trk(t, [
        [0, 0.5],
        [0.08, 0.6],
        [0.45, 0],
      ]);
      o.grip = [
        trk(t, [
          [0, 3.4],
          [0.08, 3.8],
          [0.5, 1.2],
        ]),
        trk(t, [
          [0, 1.2],
          [0.5, 3.0],
        ]),
        trk(t, [
          [0, 4.4],
          [0.08, 3.6],
          [0.5, 3.0],
        ]),
      ];
      o.lean = trk(t, [
        [0, 0.4],
        [0.08, 0.48],
        [0.45, 0.1],
      ]);
      o.hip = trk(t, [
        [0, 8.0],
        [0.45, 9],
      ]);
      o.fl = [
        trk(t, [
          [0.1, 2.8],
          [0.45, 0.8],
        ]),
        -2.4,
        0,
      ];
      o.fr = [-1.4, 2.4, 0];
      o.jaw = trk(t, [
        [0, 1],
        [0.12, 0],
      ]);
      o.drag = trk(t, [
        [0, -0.8],
        [0.35, 0.3],
        [0.6, 0],
      ]);
      o.tail = 4 + t * 7;
      break;
    }
    case 'drop': {
      o.hip = 9.5;
      o.grip = [1.0, 3.6, 7.6];
      o.wp = 0.2;
      o.wy = -1.3;
      o.fl = [1.0, -2.6, f ? 2.0 : 1.0];
      o.fr = [-1.0, 2.6, f ? 1.0 : 2.0];
      o.drag = -1.4;
      o.reach = 0.6;
      o.jaw = 0.8;
      o.tailUp = 1.2;
      break;
    }
    case 'land': {
      o.hip = trk(t, [
        [0, 6.4],
        [0.2, 8.8],
      ]);
      o.lean = trk(t, [
        [0, 0.4],
        [0.2, 0.12],
      ]);
      o.drag = trk(t, [
        [0, 1.2],
        [0.2, 0.2],
      ]);
      o.fl = [1.4, -3.0, 0];
      o.fr = [-1.4, 3.0, 0];
      break;
    }
    case 'flinch': {
      const b = Math.sin(PI * Math.min(1, (f / 4) * 1.2)) * (1 - (f / 4) * 0.4);
      o.lean = 0.1 - 0.4 * b;
      o.head = -0.4 * b;
      o.twist = 0.25 * b;
      o.fwd = -0.8 * b;
      o.shut = b > 0.3 ? 1 : 0;
      o.jaw = 0.5 * b;
      o.grip = [0.6, 3.2, 3.0 + 1.0 * b];
      o.wp = 1.42 - 0.25 * b;
      o.orb = 0.5 - 0.3 * b;
      o.drag = 0.6 * b;
      break;
    }
    case 'die': {
      // Смерть 0,87 с: откинуло, посох валится, оседает и ложится, сфера
      // мерцает и гаснет.
      o.lean = trk(t, [
        [0, 0.1],
        [0.1, -0.35, easeOut],
        [0.4, 0.3],
      ]);
      o.head = trk(t, [
        [0, 0],
        [0.1, -0.5],
        [0.45, 0.35],
      ]);
      o.shut = t > 0.06 ? 1 : 0;
      o.jaw = trk(t, [
        [0, 0.5],
        [0.1, 1],
        [0.6, 0.3],
      ]);
      o.hip = trk(t, [
        [0, 9],
        [0.12, 8.6],
        [0.42, 4.2, easeIn],
        [0.6, 3.0],
      ]);
      o.roll = trk(t, [
        [0.35, 0],
        [0.6, -1.4, easeIn],
        [0.65, -1.3],
        [0.7, -1.4],
      ]);
      o.free = trk(t, [
        [0.05, 0],
        [0.45, 1, easeIn],
      ]);
      o.orb =
        t < 0.45
          ? 1.4 - t * 2 + (Math.floor(t * 24) % 2 ? 0.5 : 0)
          : Math.max(0, 0.6 - (t - 0.45) * 3);
      o.drag = trk(t, [
        [0, 0],
        [0.15, 1.2],
        [0.5, -0.6],
      ]);
      o.tail = t > 0.6 ? (t - 0.6) * 24 : 0;
      o.tailA = t > 0.6 ? 0.8 * (1 - clamp01((t - 0.6) / 0.27)) : 0.3;
      break;
    }
  }
  return o;
}

// ---- Кадры ----

const LIZ = kindOf('f9_lizard', 70, 55, 35, 36, 1600, 1.2);
const PRI = kindOf('f9_priest', 72, 69, 36, 46, 1500, 1.2);

const lizPic = (anim: string, f: number, d: number): Pic =>
  drawRig(LIZ, lizRig(lizPose(anim, f), yawN(d), false));
const priPic = (anim: string, f: number, d: number): Pic =>
  drawRig(PRI, lizRig(priestPose(anim, f), yawN(d), true));

/** Шаг копейщика: цикл двух шагов — 0,9 клетки пути; жреца — 0,72. */
const LIZ_STRIDE = 0.9;
const PRI_STRIDE = 0.72;

/** Общий выбор позы: смерть, падение, ушиб, покой и ход. */
function common(
  K: Kind,
  m: Mob,
  pose: MobPose,
  stride: number,
  walkAnim: string,
): { anim: string; f: number; ex: Partial<MobFrame>; v: ReturnType<typeof visOf>; tech: boolean } {
  const md = pose.mode;
  const tech = md !== 'chase' && md !== 'flee' && md !== 'idle' && md !== 'drop' && md !== 'stun';
  const v = visOf(m, pose, tech || !moving(m) ? (m.face ?? 0) : headOf(m), md === 'lunge' ? 40 : 9);
  const now = pose.now || 0;
  const id = m.id ?? 0;
  const ex: Partial<MobFrame> = { shadow: 6, still: true };
  let anim = 'idle';
  let f = 0;
  if (md === 'dying') {
    anim = 'die';
    f = fi(pose.t, 20);
    ex.linger = 0.9;
    ex.alpha = 1 - sstep(0.72, 0.9, pose.t);
    ex.shadow = 6 + clamp01((pose.t - 0.35) / 0.25) * 3;
  } else if (md === 'drop') {
    anim = 'drop';
    f = mod(now * 12 + id, 2);
    ex.shadow = 0;
  } else if (md === 'stun' && v.prev === 'drop') {
    anim = 'land';
    f = fi(pose.t, 4);
    const sq = 1 - clamp01(pose.t / 0.12);
    ex.sx = 1 + 0.16 * sq;
    ex.sy = 1 - 0.18 * sq;
  } else if (md === 'stun' || hurtAge(v, now) >= 0) {
    anim = 'flinch';
    f = fi(md === 'stun' ? pose.t : hurtAge(v, now), 4);
  } else if (moving(m, 0.3)) {
    anim = walkAnim;
    f = mod((v.dist / stride) * 8, 8);
  } else {
    anim = 'idle';
    f = mod((now + hash(id, 7) * 4) * (K === PRI ? 5 : 6), 8);
  }
  return { anim, f, ex, v, tech };
}

registerMobPainter('f9_lizard', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = pose.t;
  const c = common(LIZ, m, pose, LIZ_STRIDE, 'run');
  let { anim, f } = c;
  const { ex, v } = c;
  if (md === 'windup') {
    anim = 'jab';
    f = fi(t, 10);
  } else if (md === 'recover') {
    anim = v.prev === 'lunge' ? 'lungef' : v.prev === 'stuck' ? 'yank' : 'jabf';
    f = fi(t, anim === 'yank' ? 11 : 14);
  } else if (md === 'aim') {
    anim = 'aim';
    f = fi(t, 14);
    // Последние доли прицела — пружина дрожит (сдвигом, без нового рисунка).
    if (t > 0.42) ex.dx = (Math.floor(t * 30) % 2 ? 0.3 : -0.3) * Math.cos(v.yaw);
  } else if (md === 'lunge') {
    anim = 'lunge';
    f = fi(t, 8);
    ex.ghost = { every: 0.03, life: 0.16, tint: '#8ad070', alpha: 0.42 };
  } else if (md === 'stuck') {
    anim = 'stuck';
    f = fi(t, 26);
  }
  if (md !== 'dying') hurtFields(v, pose.now || 0, ex);
  const d = dirN(v.yaw);
  const look = pose.look;
  return out(
    frameOf(LIZ, anim, f, d, look, () => lizPic(anim, f, d)),
    ex,
    pose.flash,
  );
});

registerMobPainter('f9_priest', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = pose.t;
  const c = common(PRI, m, pose, PRI_STRIDE, 'walk');
  let { anim, f } = c;
  const { ex, v } = c;
  if (md === 'cast') {
    anim = 'cast';
    f = fi(t, 27);
    if (t > 0.92 && t < 1.04) ex.dx = Math.floor(t * 40) % 2 ? 0.35 : -0.35;
  } else if (md === 'windup') {
    anim = 'swing';
    f = fi(t, 9);
  } else if (md === 'recover') {
    anim = v.prev === 'cast' ? 'castf' : 'swingf';
    f = fi(t, 16);
    if (anim === 'castf' && t < 0.1) {
      const sq = 1 - t / 0.1;
      ex.sx = 1 + 0.08 * sq;
      ex.sy = 1 - 0.08 * sq;
    }
  }
  if (md !== 'dying') hurtFields(v, pose.now || 0, ex);
  const d = dirN(v.yaw);
  return out(
    frameOf(PRI, anim, f, d, pose.look, () => priPic(anim, f, d)),
    ex,
    pose.flash,
  );
});

export const LIZ_WARM: [string, number][] = [
  ['run', 8],
  ['idle', 8],
  ['jab', 11],
  ['jabf', 15],
  ['aim', 15],
  ['lunge', 9],
  ['lungef', 15],
  ['flinch', 5],
  ['die', 21],
];
export const PRI_WARM: [string, number][] = [
  ['walk', 8],
  ['idle', 8],
  ['cast', 28],
  ['castf', 17],
  ['swing', 10],
  ['swingf', 17],
  ['flinch', 5],
  ['die', 21],
];
registerMobWarm('f9_lizard', function* () {
  yield* warmAll(LIZ, LIZ_WARM, lizPic);
});
registerMobWarm('f9_priest', function* () {
  yield* warmAll(PRI, PRI_WARM, priPic);
});
