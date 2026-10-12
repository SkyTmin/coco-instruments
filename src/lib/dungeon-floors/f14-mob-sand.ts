// Этаж 14: Песочный призрак (анимации мобов 14). Фигура из текущего песка:
// капюшон с острым куколем, тёмное лицо и два янтарных глаза, руки-струи с
// когтями из спрессованного песка, тело стекает хвостом до пола. По телу и
// хвосту вниз бегут тёмные ручейки — песок течёт всегда.
//
// Мозг (`f14-brains.ts`, `SAND`): погоня зигзагом; `windup` 0,6 — когти,
// урон в конце → `recover` 0,6 (кадр контакта — первый кадр `recover`);
// `f14_blast` 0,75 — песчаный выдох конусом, урон в конце → `recover`;
// от удара (40 %) `f14_sink` 0,35 → `f14_under` (бугор ползёт под полом) →
// `f14_rise`: удар кругом через 0,5 с (кадр 12) → `recover`. Наводнение
// поднимает призрака сразу в `f14_rise`.

import { registerMobPainter } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import {
  F3,
  FPS,
  KRig,
  PI,
  TAU,
  clamp01,
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
  idlePh,
  ik,
  kindOf,
  lerp,
  moving,
  sideOf,
  smear,
  smooth,
  spark2,
  spray,
  sstep,
  tn,
  vadd,
  visOf,
  vlerp,
  vmul,
  vnorm,
  vsub,
  warmAll,
  demOf,
  regWarm,
  warmGray,
  yawN,
} from './f14-mobkit';
import type { Ease, Mat, Pic, Proj2, RGBA, RigOut, Tones, V3 } from './f14-mobkit';

const SAND = tn('#5a3c1c', '#9a7440', '#d0ac6c', '#f4e2b0');
const SAND_D = tn('#3a2410', '#6a4c26', '#a8844c', '#d8bc80');
const CLAW = tn('#6a4a24', '#b8904e', '#ecd296', '#fffbe8');
const CORE = tn('#120a04', '#24160a', '#3a2614', '#5a3e20');
const EYE = hx('#ffcf5a');
const EYE_HI = hx('#fff6c8');
const EYE_OFF = hx('#4a3018');
const GRAIN: RGBA[] = [hx('#f4e2b0'), hx('#d0ac6c'), hx('#b8945a')];
const GRAIN_D: RGBA[] = [hx('#9a7440'), hx('#c8a468'), hx('#7a5a30')];

const frac = (x: number) => x - Math.floor(x);

// ---- Поза ------------------------------------------------------------------

interface SgO {
  /** Корпус: вперёд, выше парения, наклон вперёд (+), крен. */
  fx: number;
  h: number;
  lean: number;
  roll: number;
  /** Поворот плеч от курса (+ — правое плечо назад). */
  tw: number;
  /** Раздут (вдох перед выдохом) −0,4…1. */
  swell: number;
  /** Хвост: отстаёт назад, волна (фаза, размах), длина до пола 0…1. */
  lag: number;
  sway: number;
  swA: number;
  tail: number;
  /** Фаза ручейков песка (1 — цикл). */
  flow: number;
  /** Кисти от плеча в рамке корпуса: вперёд, наружу, вверх. */
  hl: V3;
  hr: V3;
  /** Когти 0…1. */
  claw: number;
  /** Капюшон: раздут, откинут назад (+). */
  hood: number;
  hback: number;
  /** Глаза горят 0…1; вспышка глаз 0…1 (2D). */
  eye: number;
  flare: number;
  /** Осыпался в кучу 0…1; куча растеклась (1 — обычно). */
  melt: number;
  spread: number;
}

const S0: SgO = {
  fx: 0,
  h: 0,
  lean: 0.08,
  roll: 0,
  tw: 0,
  swell: 0,
  lag: 0.35,
  sway: 0,
  swA: 0.8,
  tail: 1,
  flow: 0,
  hl: [1.0, 0.9, -5.0],
  hr: [1.0, 0.9, -5.0],
  claw: 0.3,
  hood: 1,
  hback: 0,
  eye: 1,
  flare: 0,
  melt: 0,
  spread: 1,
};

const v3l = (a: V3, b: V3, k: number): V3 => [
  lerp(a[0], b[0], k),
  lerp(a[1], b[1], k),
  lerp(a[2], b[2], k),
];

function mixO(a: SgO, b: SgO, k: number): SgO {
  const o = { ...a };
  for (const key of Object.keys(a) as (keyof SgO)[]) {
    const x = a[key];
    const y = b[key];
    if (typeof x === 'number') (o[key] as number) = lerp(x, y as number, k);
    else (o[key] as V3) = v3l(x, y as V3, k);
  }
  return o;
}

type KP = [number, Partial<SgO>, Ease?];
/** Ключевые позы по времени (кривая — у ключа, к которому идём). */
function seq(T: number, keys: KP[], base: SgO = S0): SgO {
  const full = (p: Partial<SgO>): SgO => ({ ...base, ...p });
  if (T <= keys[0][0]) return full(keys[0][1]);
  for (let i = 1; i < keys.length; i++) {
    const [t1, p1, e] = keys[i];
    if (T <= t1) {
      const [t0, p0] = keys[i - 1];
      const x = (T - t0) / (t1 - t0 || 1);
      return mixO(full(p0), full(p1), (e ?? smooth)(clamp01(x)));
    }
  }
  return full(keys[keys.length - 1][1]);
}

// ---- Материалы --------------------------------------------------------------

const band = (T: Tones, l: number): RGBA =>
  l > 0.78 ? T[3] : l > 0.38 ? T[2] : l > -0.02 ? T[1] : T[0];

/** Песок тела: книзу темнее (уходит в струю), вниз бегут ручейки (`flow` — фаза). */
function bodyMat(flow: number, bias = 0, fade = 0.35): Mat {
  return {
    T: SAND,
    bias,
    pat: (q, l) => {
      const af = frac(Math.atan2(q[1], q[0]) / TAU) * 7;
      const sec = Math.floor(af);
      const lv = l - (q[2] < -0.2 ? fade * Math.min(1, (-0.2 - q[2]) * 2.5) : 0);
      if (af - sec < 0.32 && frac(q[2] * 0.7 + flow + hash(sec, 5)) < 0.45 && l < 0.92)
        return band(SAND_D, lv);
      return band(SAND, lv);
    },
  };
}

/** Струя хвоста (капсула `i` из цепочки): по ней к концу бегут тёмные кольца. */
function tailMat(flow: number, i: number): Mat {
  return {
    T: SAND,
    pat: (q, l) => {
      const lv = l - 0.1;
      if (frac((q[0] + i) * 1.2 - flow) < 0.17) return band(SAND_D, lv);
      return band(SAND, lv);
    },
  };
}

/** Рука-струя: вдоль неё течёт тёмная прядь. */
function armMat(flow: number, i: number): Mat {
  return {
    T: SAND,
    pat: (q, l) => {
      if (Math.abs(q[1] + 0.25) < 0.24 && frac((q[0] + i) * 1.1 - flow) < 0.55)
        return band(SAND_D, l);
      return band(SAND, l);
    },
  };
}

const PILE: Mat = {
  T: SAND,
  pat: (q, l) => {
    const rr = Math.hypot(q[0], q[1]);
    if (frac(rr * 2.6) < 0.16 && q[2] < 0.8) return band(SAND_D, l);
    return null;
  },
};
const CLAWM: Mat = { T: CLAW, spec: true, bias: 0.22 };

// ---- Риг --------------------------------------------------------------------

interface SPts {
  hl: V3;
  hr: V3;
  /** Острия средних когтей. */
  tl: V3;
  tr: V3;
  head: V3;
  chest: V3;
  base: V3;
  /** Конец хвоста. */
  tail: V3;
  eyes: [V3, V3];
}

const HOVER = 13.2;

/** Призрак (и куча песка под ним, когда осыпается). */
function ghostRig(o: SgO, yaw: number, r: KRig): SPts {
  const m = clamp01(o.melt);
  const B = F3.yaw(yaw);
  // Осыпание: фигура ниже и шире, капсулы тоньше (масштаб рига).
  const wide = r.k * (1 + 0.35 * m);
  const low = r.k * (1 - 0.6 * m);
  const Bm = new F3(B.o, vmul(B.f, wide), vmul(B.s, wide), vmul(B.u, low));
  const base = B.p(o.fx * 0.3, 0, 0);
  if (m > 0.02) {
    const sp = o.spread;
    r.ell(
      B,
      [o.fx * 0.3, 0, 0],
      [1.5 + 4.4 * m * sp, 1.4 + 3.8 * m * sp, (0.4 + 3.0 * m) / (sp * sp)],
      PILE,
      (q) => q[2] < 0,
    );
  }
  // Низ корпуса и хвост — по курсу; плечи и руки — с поворотом корпуса.
  const C0 = Bm.at(o.fx, 0, HOVER + o.h)
    .pitch(o.lean)
    .roll(o.roll);
  const C = C0.turn(o.tw);
  const eyes: [V3, V3] = [C.p(3, -1, 5), C.p(3, 1, 5)];
  const pts: SPts = {
    hl: C.p(0, 0, 0),
    hr: C.p(0, 0, 0),
    tl: C.p(1, 0, 0),
    tr: C.p(1, 0, 0),
    head: C.p(0.5, 0, 5.6),
    chest: C.p(1.5, 0, 1.2),
    base,
    tail: base,
    eyes,
  };
  if (m > 0.97) return pts;
  const sw = 1 + 0.24 * o.swell;
  // Хвост: от низа корпуса к полу, отстаёт назад, по нему идёт волна.
  const root = C0.p(-0.3, 0, -3.3);
  const endZ = lerp(HOVER * 0.55 + o.h, 1.3, o.tail);
  const end = Bm.p(o.fx * 0.3 - 0.6 - 2.8 * o.lag, 0, endZ);
  const ctrl = Bm.p(o.fx * 0.6 - 0.4 - 1.5 * o.lag, 0, lerp(HOVER * 0.7 + o.h, 4.6, o.tail));
  const RT = [2.1, 1.5, 1.05, 0.72, 0.45];
  let prev = root;
  for (let i = 1; i < RT.length; i++) {
    const k = i / (RT.length - 1);
    const a = vlerp(root, ctrl, k);
    const b = vlerp(ctrl, end, k);
    const side = o.swA * Math.sin(o.sway - k * 2.4) * k;
    const p = vadd(vlerp(a, b, k), Bm.v(0, side, 0));
    r.cap(prev, p, RT[i - 1], RT[i], tailMat(o.flow, i - 1));
    prev = p;
  }
  pts.tail = prev;
  // Корпус-балахон и плечи.
  r.ell(C0, [0, 0, -0.5], [2.4 * sw, 2.9 * sw, 3.7 * (1 + 0.1 * o.swell)], bodyMat(o.flow));
  r.ell(C, [0.1, 0, 2.3], [2.6 * sw, 4.3 * sw, 2.0], bodyMat(o.flow + 0.3, 0.06, 0));
  // Капюшон с вырезом лица, тёмное лицо внутри, куколь назад.
  const Hd = C0.turn(o.tw * 0.45)
    .at(0.5, 0, 5.9)
    .pitch(-o.hback)
    .scale(o.hood);
  r.ell(
    Hd,
    [-0.4, 0, 0],
    [3.5, 3.4, 3.7],
    bodyMat(o.flow * 0.5, 0.14, 0),
    (q) => q[0] > 0.3 && q[2] < 0.55 && Math.abs(q[1]) < 0.72,
  );
  r.ell(Hd, [0.2, 0, -0.4], [2.6, 2.5, 2.5], { T: CORE });
  r.cap(
    Hd.p(-2.0, 0, 2.5),
    Hd.p(-4.0 - 1.2 * o.lag, 0, 4.6 - 0.8 * o.lag),
    1.7,
    0.45,
    armMat(o.flow, 0),
  );
  eyes[0] = Hd.p(2.5, -1.0, -0.35);
  eyes[1] = Hd.p(2.5, 1.0, -0.35);
  const lit = o.eye > 0.35;
  for (const e of eyes) r.dot(e, lit ? EYE : EYE_OFF, lit ? o.eye : 0, 1, 0.9);
  r.eye = lit ? (eyes[0][1] > eyes[1][1] ? eyes[0] : eyes[1]) : null;
  pts.head = Hd.p(0, 0, 0);
  // Руки-струи с когтями.
  for (const sd of [-1, 1]) {
    const hv = sd < 0 ? o.hl : o.hr;
    const sh = C.p(0.4, sd * 3.6, 2.4);
    const hand = vadd(sh, C.v(hv[0], sd * hv[1], hv[2]));
    const el = ik(sh, hand, 3.8, 3.8, C.v(-0.7, sd * 1.0, -0.5));
    r.cap(sh, el, 1.05, 0.85, armMat(o.flow, 0));
    r.cap(el, hand, 0.85, 0.6, armMat(o.flow, 1));
    r.ball(hand, 0.9, bodyMat(o.flow, 0.1, 0));
    const dir = vnorm(vsub(hand, el));
    let mid = hand;
    if (o.claw > 0.05) {
      const L = 1.3 + 3.2 * o.claw;
      for (let i = -1; i <= 1; i++) {
        const dd = vnorm(vadd(dir, vadd(C.v(0, i * 0.55 * o.claw, 0), C.v(0, 0, -0.25))));
        r.spike(hand, dd, L * (i === 0 ? 1 : 0.8), 0.55, CLAWM, 3);
        if (i === 0) mid = vadd(hand, vmul(dd, L));
      }
    }
    if (sd < 0) {
      pts.hl = hand;
      pts.tl = mid;
    } else {
      pts.hr = hand;
      pts.tr = mid;
    }
  }
  return pts;
}

/** Бугор песка: ползёт под полом, по нему бежит рябь назад; глаза выглядывают. */
interface MoO {
  ph: number;
  bulge: number;
  eyes: number;
  tr: number;
}

function moundRig(o: MoO, yaw: number, r: KRig): SPts {
  const B = F3.yaw(yaw).at(o.tr, 0, 0);
  const rip: Mat = {
    T: SAND,
    pat: (q, l) => {
      if (frac(q[0] * 2.2 + o.ph) < 0.2 && q[2] > 0.1) return l > 0.4 ? SAND[1] : SAND_D[1];
      return null;
    },
  };
  const bz = o.bulge;
  r.ell(B, [0.2, 0, 0], [5.0, 3.9, 2.3 + bz * 1.2], rip, (q) => q[2] < 0);
  r.ell(B, [-3.8, 0, 0], [3.0, 2.4, 1.1], PILE, (q) => q[2] < 0);
  r.ell(
    B,
    [2.4, 0, 0.6],
    [2.5 + bz * 0.6, 2.7 + bz * 0.6, 2.0 + bz * 2.4],
    rip,
    (q) => q[2] < -0.3,
  );
  const eyes: [V3, V3] = [
    B.p(4.2 + bz * 0.4, -0.9, 1.9 + bz * 2),
    B.p(4.2 + bz * 0.4, 0.9, 1.9 + bz * 2),
  ];
  const lit = o.eyes > 0.35;
  for (const e of eyes) r.dot(e, lit ? EYE : EYE_OFF, lit ? o.eyes : 0, 1, 0.9);
  r.eye = null;
  return {
    hl: B.p(1, -2, 2),
    hr: B.p(1, 2, 2),
    tl: B.p(3, 0, 2),
    tr: B.p(3, 0, 2),
    head: B.p(2.4, 0, 3 + bz * 2.4),
    chest: B.p(2.4, 0, 2),
    base: B.p(0, 0, 0),
    tail: B.p(-4, 0, 0),
    eyes,
  };
}

// ---- Треки ------------------------------------------------------------------

const tf = (f: number) => (f + 0.5) / FPS;
const CLAW_T = 0.6;
const BLAST_T = 0.75;
const RISE_HIT = 12;
const DIE_T = 0.85;

const RAISE: Partial<SgO> = {
  fx: -0.8,
  h: 1.4,
  lean: -0.15,
  tw: 0.85,
  hr: [-1.2, 3.0, 4.0],
  hl: [2.6, 0.6, 0.2],
  claw: 1,
  hood: 1.08,
  hback: 0.18,
  lag: -0.1,
  swA: 0.4,
  swell: 0.12,
  flare: 0.6,
};
const SWING: Partial<SgO> = {
  fx: 0.4,
  h: 0.8,
  lean: 0.05,
  tw: 0.35,
  hr: [2.4, 4.8, 1.6],
  hl: [1.8, 1.0, -0.8],
  claw: 1,
  hood: 1.04,
  hback: 0.06,
  lag: 0.15,
  flare: 0.4,
};
const CONTACT: Partial<SgO> = {
  fx: 1.4,
  h: 0,
  lean: 0.2,
  tw: -0.55,
  hr: [5.8, 2.0, -0.6],
  hl: [0.2, 2.4, -2.8],
  claw: 1,
  hback: -0.08,
  lag: 0.6,
  swA: 0.9,
  flare: 1,
};
const THRU: Partial<SgO> = {
  fx: 1.7,
  h: -0.3,
  lean: 0.26,
  tw: -0.9,
  hr: [4.4, -0.6, -2.8],
  hl: [-0.6, 2.4, -2.6],
  claw: 0.9,
  lag: 0.8,
  hback: -0.05,
};
const RECOIL: Partial<SgO> = {
  fx: -0.4,
  h: 0.6,
  lean: 0,
  tw: -0.25,
  hr: [1.4, 2.0, -3.4],
  hl: [0.8, 1.4, -3.6],
  claw: 0.55,
  lag: 0.2,
};

/** Когти: правая рука взведена за спину (корпус повёрнут), дрожь, взмах поперёк. */
function clawO(T: number, f: number): SgO {
  const o = seq(T, [
    [0, {}],
    [0.2, RAISE, easeOut],
    [0.46, RAISE],
    [CLAW_T, SWING, easeIn],
  ]);
  const hold = sstep(0.18, 0.24, T) * (1 - sstep(0.44, 0.48, T));
  o.fx += (f % 2 ? 0.3 : -0.3) * hold;
  o.flow = T * 3;
  o.sway = T * 6;
  return o;
}

function clawfO(T: number): SgO {
  const o = seq(T, [
    [0, CONTACT],
    [0.1, THRU, easeOut],
    [0.32, RECOIL],
    [0.6, {}],
  ]);
  o.flow = 1.8 + T * 2;
  o.sway = 3.6 + T * 6;
  return o;
}

const INHALE: Partial<SgO> = {
  fx: -0.6,
  h: 2.0,
  lean: -0.14,
  swell: 1,
  tail: 0.5,
  lag: -0.15,
  swA: 0.3,
  hl: [2.7, -1.5, 1.2],
  hr: [2.7, -1.5, 1.2],
  claw: 0.1,
  hood: 1.12,
  hback: 0.18,
  flare: 0.5,
};
const PUSH: Partial<SgO> = {
  ...INHALE,
  fx: 0.2,
  h: 1.6,
  lean: 0.14,
  swell: 0.9,
  tail: 0.55,
  hl: [4.6, -0.6, 1.2],
  hr: [4.6, -0.6, 1.2],
  claw: 0.2,
  hback: 0.05,
};
const BLASTC: Partial<SgO> = {
  fx: -1.5,
  h: 0.9,
  lean: -0.2,
  swell: -0.38,
  tail: 0.75,
  lag: 0.95,
  hl: [6.6, 0.4, 0.9],
  hr: [6.6, 0.4, 0.9],
  claw: 0.15,
  hood: 0.96,
  hback: 0.28,
  flare: 1,
};

/** Выдох: вдыхает песок (раздувается, хвост втянут), ком в ладонях, толчок. */
function blastO(T: number, f: number): SgO {
  const o = seq(T, [
    [0, {}],
    [0.3, INHALE, easeOut],
    [0.6, INHALE],
    [BLAST_T, PUSH, easeIn],
  ]);
  const hold = sstep(0.28, 0.34, T) * (1 - sstep(0.58, 0.62, T));
  o.h += (f % 2 ? 0.25 : -0.25) * hold;
  o.flow = -T * 3;
  o.sway = T * 5;
  return o;
}

function blastfO(T: number): SgO {
  const o = seq(T, [
    [0, BLASTC],
    [
      0.14,
      { ...BLASTC, fx: -1.8, swell: -0.42, hl: [6.0, 0.8, 0.0], hr: [6.0, 0.8, 0.0] },
      easeOut,
    ],
    [
      0.36,
      { fx: -0.4, swell: -0.12, tail: 0.95, lag: 0.4, hl: [2.0, 1.3, -3.4], hr: [2.0, 1.3, -3.4] },
    ],
    [0.6, {}],
  ]);
  o.flow = T * 2.5;
  o.sway = 1 + T * 6;
  return o;
}

const JOLT: Partial<SgO> = {
  fx: -1.0,
  lean: -0.3,
  hback: 0.35,
  h: 0.8,
  hl: [-0.4, 2.8, 3.0],
  hr: [-0.2, 2.9, 2.8],
  eye: 0.8,
  claw: 0.1,
  lag: 0.5,
  flare: 0.6,
};

/** Осыпается в песок: рывок от удара, капюшон проваливается, куча. */
function sinkO(T: number): SgO {
  const o = seq(T, [
    [0, {}],
    [0.06, JOLT, easeOut],
    [
      0.34,
      {
        melt: 1,
        eye: 0,
        hl: [0.6, 1.6, -1.2],
        hr: [0.6, 1.6, -1.2],
        claw: 0,
        hood: 0.8,
        hback: -0.3,
      },
      easeIn,
    ],
  ]);
  o.flow = T * 6;
  return o;
}

const RISEC: Partial<SgO> = {
  h: 3.4,
  lean: -0.22,
  hl: [0.2, 3.2, 5.6],
  hr: [0.4, 3.4, 5.4],
  claw: 1,
  swell: 0.25,
  tail: 0.6,
  lag: -0.2,
  hback: 0.25,
  flare: 1,
};

/** Встаёт из песка: фигура пробивает бугор, удар кругом — кадр 12. */
function riseO(T: number): SgO {
  const o = seq(T, [
    [
      0.25,
      {
        melt: 0.85,
        h: -1.0,
        hl: [1.4, 0.6, -0.4],
        hr: [1.4, 0.6, -0.4],
        claw: 0.3,
        hood: 0.9,
        hback: -0.3,
        tail: 0.3,
        lag: 0,
        swA: 0.2,
      },
    ],
    [
      0.47,
      {
        melt: 0.25,
        h: 0.2,
        lean: 0.18,
        hl: [1.8, 0.4, 0.8],
        hr: [1.8, 0.4, 0.8],
        claw: 0.6,
        hback: -0.15,
        tail: 0.45,
        lag: 0,
      },
      easeIn,
    ],
    [0.52, RISEC, easeOut],
    [
      0.65,
      {
        h: 1.4,
        lean: -0.05,
        hl: [0.8, 2.6, 1.6],
        hr: [0.8, 2.6, 1.6],
        claw: 0.8,
        tail: 0.85,
        swell: 0.1,
      },
    ],
  ]);
  o.flow = -T * 4;
  o.sway = T * 7;
  return o;
}

function risefO(T: number): SgO {
  const o = seq(T, [
    [
      0,
      {
        h: 1.4,
        lean: -0.05,
        hl: [0.8, 2.6, 1.6],
        hr: [0.8, 2.6, 1.6],
        claw: 0.8,
        tail: 0.85,
        swell: 0.1,
      },
    ],
    [
      0.2,
      { h: 0.2, lean: 0.12, hl: [1.2, 1.5, -3.0], hr: [1.3, 1.4, -3.2], claw: 0.5, roll: 0.08 },
    ],
    [0.6, {}],
  ]);
  o.flow = T * 3;
  o.sway = T * 6;
  return o;
}

const SCREAM: Partial<SgO> = {
  h: 1.4,
  lean: -0.32,
  hback: 0.4,
  hl: [-0.6, 3.4, 4.2],
  hr: [-0.4, 3.5, 4.0],
  claw: 0.8,
  flare: 1,
  swell: 0.2,
  lag: 0.3,
};

/** Смерть: крик, осыпается кучей (капюшон — последним), ветер сдувает песок. */
function dieO(T: number, f: number): SgO {
  const o = seq(T, [
    [0, {}],
    [0.1, SCREAM, easeOut],
    [
      0.22,
      {
        h: 0.6,
        lean: -0.1,
        hback: 0.3,
        hl: [-0.2, 3.6, 2.6],
        hr: [-0.2, 3.6, 2.6],
        claw: 0.4,
        melt: 0.22,
      },
    ],
    [
      0.55,
      {
        melt: 1,
        eye: 0,
        hback: -0.4,
        hl: [0.6, 2.8, -1],
        hr: [0.6, 2.8, -1],
        claw: 0,
        hood: 0.85,
        swell: -0.2,
      },
      easeIn,
    ],
    [DIE_T, { melt: 1, eye: 0, spread: 1.35, claw: 0 }],
  ]);
  o.eye = f < 10 ? 1 : f === 11 ? 0.8 : 0;
  o.flow = T * 5;
  return o;
}

function sgPose(anim: string, f: number): SgO {
  const T = tf(f);
  switch (anim) {
    case 'idle': {
      const a = (f / 16) * TAU;
      return {
        ...S0,
        h: 0.6 * Math.sin(a),
        lean: 0.08 + 0.03 * Math.sin(a + 1),
        lag: 0.35 + 0.12 * Math.sin(a - 0.8),
        sway: a,
        swA: 0.6,
        flow: (f / 16) * 2,
        hl: [
          1.0 + 0.4 * Math.sin(a + 0.6),
          0.9 + 0.3 * Math.sin(a),
          -5.0 + 0.5 * Math.sin(a + 0.9),
        ],
        hr: [
          1.0 + 0.4 * Math.sin(a + 2.6),
          0.9 + 0.3 * Math.sin(a + 2),
          -5.0 + 0.5 * Math.sin(a + 2.9),
        ],
        hback: 0.05 * Math.sin(a - 0.5),
      };
    }
    case 'glide': {
      const ph = f / 8;
      const a = ph * TAU;
      return {
        ...S0,
        fx: 0.5,
        h: 0.4 * Math.sin(2 * a),
        lean: 0.18,
        roll: 0.05 * Math.sin(a),
        lag: 1.1 + 0.12 * Math.sin(a),
        sway: a,
        swA: 0.9,
        flow: ph * 2,
        hl: [-2.2 + 0.5 * Math.sin(a), 1.6, -4.4 + 0.4 * Math.sin(a + 1)],
        hr: [-2.2 + 0.5 * Math.sin(a + PI), 1.6, -4.4 + 0.4 * Math.sin(a + 1 + PI)],
        claw: 0.2,
        hback: -0.06,
      };
    }
    case 'claw':
      return clawO(Math.min(T, CLAW_T - 0.005), f);
    case 'clawf':
      return clawfO(T);
    case 'blast':
      return blastO(Math.min(T, BLAST_T - 0.005), f);
    case 'blastf':
      return blastfO(T);
    case 'sink':
      return sinkO(T);
    case 'rise':
      return riseO(T);
    case 'risef':
      return risefO(T);
    case 'flinch': {
      const k = f / 6;
      const b = Math.sin(PI * Math.min(1, k * 1.4)) * (1 - k * 0.5);
      return {
        ...S0,
        fx: -1.4 * b,
        lean: 0.08 - 0.38 * b,
        hback: 0.35 * b,
        h: 0.5 * b,
        swell: -0.15 * b,
        lag: 0.15 + 0.6 * b,
        hl: [1 - 2.4 * b, 0.9 + 1.8 * b, -5 + 4 * b],
        hr: [1 - 2.2 * b, 0.9 + 1.9 * b, -5 + 3.6 * b],
        eye: 1 - 0.4 * b,
        flow: k,
        sway: k * 4,
      };
    }
    case 'die':
      return dieO(T, f);
    case 'sleep': {
      const a = (f / 4) * TAU;
      return {
        ...S0,
        melt: 0.72,
        eye: 0.2,
        h: 0.35 * Math.sin(a),
        hl: [1.4, 0.6, -2.4],
        hr: [1.4, 0.6, -2.4],
        claw: 0,
        hback: -0.35,
        lag: 0,
        swA: 0.2,
      };
    }
    case 'alert': {
      const o = seq(T, [
        [
          0,
          {
            melt: 0.72,
            eye: 0.2,
            hl: [1.4, 0.6, -2.4],
            hr: [1.4, 0.6, -2.4],
            claw: 0,
            hback: -0.35,
          },
        ],
        [
          0.14,
          {
            h: 1.8,
            lean: -0.2,
            hl: [0.2, 3.4, 2.6],
            hr: [0.2, 3.4, 2.6],
            claw: 0.9,
            flare: 1,
            hback: 0.2,
          },
          easeOut,
        ],
        [0.35, {}],
      ]);
      o.flow = T * 4;
      return o;
    }
    case 'drop':
      return {
        ...S0,
        h: 1.0,
        lean: -0.15,
        hl: [-0.2, 2.6, 4.6 - f],
        hr: [-0.2, 2.6, 3.6 + f],
        claw: 0.6,
        tail: 0.35,
        lag: -0.6,
        swA: 0.8,
        sway: f * PI,
        hback: 0.3,
        flow: f * 0.5,
      };
    case 'land': {
      const o = seq(T, [
        [
          0,
          { melt: 0.5, h: -1, hl: [1.6, 3.2, -1.5], hr: [1.6, 3.2, -1.5], claw: 0.4, spread: 1.2 },
        ],
        [0.12, { melt: 0.05, h: 0.8, lean: -0.1 }, easeOut],
        [0.3, {}],
      ]);
      o.flow = T * 4;
      return o;
    }
  }
  return { ...S0 };
}

// ---- Кадр -------------------------------------------------------------------

const KSG = kindOf('sand', 76, 62, 38, 46, 1700);

/** Песчинки падают (фаза `ph` 0…1 — непрерывно от кадра к кадру). */
function drip(
  o: RigOut,
  x: number,
  y: number,
  ph: number,
  n: number,
  len: number,
  seed: number,
  dx = 0,
): void {
  for (let i = 0; i < n; i++) {
    const k = frac(ph + i / n);
    const ox = Math.round((hash(seed, i, 3) - 0.5) * 2.4 + dx * k);
    o.p.set(Math.round(x) + ox, Math.round(y + 1 + k * len), GRAIN[i % GRAIN.length]);
  }
}

/** Экранный «вперёд» стороны (единичный). */
function fwd2(P: Proj2, yaw: number): [number, number] {
  const B = F3.yaw(yaw);
  const [x0, y0] = P(B.p(0, 0, 0));
  const [x1, y1] = P(B.p(4, 0, 0));
  const l = Math.hypot(x1 - x0, y1 - y0) || 1;
  return [(x1 - x0) / l, (y1 - y0) / l];
}

function post(
  anim: string,
  f: number,
  d: number,
  o: RigOut,
  P: Proj2,
  pts: SPts,
  so: SgO | null,
): void {
  const yaw = yawN(d);
  const T = tf(f);
  const [hlx, hly] = P(pts.hl);
  const [hrx, hry] = P(pts.hr);
  // Вспышка глаз.
  if (so && so.flare > 0.3 && so.eye > 0.35 && so.melt < 0.6)
    for (const e of pts.eyes) {
      const [x, y] = P(e);
      spark2(o, Math.round(x), Math.round(y), EYE_HI, 1);
      if (so.flare > 0.7) {
        spark2(o, Math.round(x), Math.round(y) - 1, EYE, 0.6);
        spark2(o, Math.round(x) + (d < 2 || d > 6 ? 1 : -1), Math.round(y), EYE, 0.5);
      }
    }
  if (anim === 'idle') {
    drip(o, hlx, hly, f / 8, 2, 5, 11 + d);
    drip(o, hrx, hry, f / 8 + 0.25, 2, 5, 13 + d);
    const [tx, ty] = P(pts.tail);
    drip(o, tx, ty, f / 8 + 0.5, 1, 2, 15 + d);
  } else if (anim === 'glide') {
    const [ux, uy] = fwd2(P, yaw);
    for (let i = 0; i < 3; i++) {
      const k = frac(f / 8 + i / 3);
      const [x0, y0] = i === 0 ? [hlx, hly] : i === 1 ? [hrx, hry] : P(pts.base);
      o.p.set(
        Math.round(x0 - ux * k * 6),
        Math.round(y0 - uy * k * 4 + k * 3 - (i === 2 ? 2 : 0)),
        GRAIN[i],
      );
    }
  } else if (anim === 'claw' && T > 0.2 && T < 0.48) {
    // Дрожь: с когтей сыплется песок.
    drip(o, hlx, hly, f / 5, 2, 7, 21 + d);
    drip(o, hrx, hry, f / 5 + 0.5, 2, 7, 23 + d);
  } else if (anim === 'clawf' && f <= 1) {
    // След когтей правой руки: дуга взмаха поперёк корпуса — к контакту и дальше.
    const A: SgO = { ...S0, ...SWING };
    const Z = clawfO(0.02);
    const ks = f === 0 ? [0, 0.3, 0.6, 1] : [1, 0];
    const tips: [number, number][] = [];
    const bases: [number, number][] = [];
    for (const k of ks) {
      const q = f === 1 && k === 0 ? pts : ghostRig(mixO(A, Z, k), yaw, new KRig(1));
      tips.push(P(q.tr));
      bases.push(P(vlerp(q.tr, q.chest, 0.5)));
    }
    smear(o, tips, bases, hx('#f6e6b8', 170), 0.3);
    const [x, y] = P(pts.tr);
    spark2(o, Math.round(x), Math.round(y), GRAIN[0], 0.5);
    spray(o.p, x, y, 6, 5, 0.5 + f * 0.4, 31 + d, GRAIN, 2, 0);
  } else if (anim === 'blast' && T > 0.1) {
    // Ком песка в ладонях закручивается и растёт; песок с пола втягивается.
    const [cx, cy] = [(hlx + hrx) / 2, (hly + hry) / 2];
    const R = 1 + 2.4 * sstep(0.1, 0.6, T);
    for (let i = 0; i < 8; i++) {
      const a = T * 16 + (i / 8) * TAU;
      o.p.set(
        Math.round(cx + Math.cos(a) * R),
        Math.round(cy + Math.sin(a) * R * 0.65),
        GRAIN[i % 3],
      );
    }
    o.p.set(Math.round(cx), Math.round(cy), SAND[3]);
    if (R > 2.2) o.p.set(Math.round(cx) + 1, Math.round(cy), SAND[3]);
    const [bx, by] = P(pts.base);
    for (let i = 0; i < 4; i++) {
      const k = frac(T * 2.6 + i / 4);
      const a = hash(d, i, 7) * TAU;
      const rr = (1 - k) * 9;
      o.p.set(
        Math.round(lerp(bx + Math.cos(a) * rr, cx, k * k)),
        Math.round(lerp(by + Math.sin(a) * rr * 0.5, cy, k)),
        GRAIN_D[i % 3],
      );
    }
  } else if (anim === 'blastf' && f <= 5) {
    // Выдох из ладоней: веер песка вперёд (конус дорисовывает зона удара).
    const [ux, uy] = fwd2(P, yaw);
    const [cx, cy] = [(hlx + hrx) / 2, (hly + hry) / 2];
    for (let i = 0; i < 18; i++) {
      const s = hash(d, i, 41);
      const dist = 2 + (f + s * 1.5) * 3.2;
      if (dist > 22) continue;
      const w = (hash(i, d, 43) - 0.5) * dist * 0.75;
      const x = cx + ux * dist - uy * w;
      const y = cy + uy * dist * 0.85 + ux * w * 0.6 + (f > 2 ? (f - 2) * s : 0);
      o.p.set(Math.round(x), Math.round(y), GRAIN[i % 3]);
    }
    if (f <= 1) spark2(o, Math.round(cx + ux * 2), Math.round(cy + uy * 2), SAND[3], 0.4);
  } else if (anim === 'sink') {
    const [bx, by] = P(pts.base);
    spray(o.p, bx, by - 6 + T * 10, 10, 9, 0.3 + T * 2, 51 + d, GRAIN, 4, 2);
  } else if (anim === 'under') {
    // Песок из-под бугра — назад; крошки на гребне.
    const [ux, uy] = fwd2(P, yaw);
    const [bx, by] = P(pts.base);
    for (let i = 0; i < 6; i++) {
      const k = frac(f / 6 + i / 6);
      const s = (hash(d, i, 61) - 0.5) * 6;
      o.p.set(
        Math.round(bx - ux * (5 + k * 7) - uy * s),
        Math.round(by - uy * (4 + k * 5) + ux * s * 0.5 - Math.sin(PI * k) * 3),
        GRAIN[i % 3],
      );
    }
  } else if (anim === 'rise') {
    const [bx, by] = P(pts.base);
    if (f < RISE_HIT) {
      // Бугор дрожит, песок брызжет вверх.
      const k = f / RISE_HIT;
      spray(
        o.p,
        bx,
        by - 2,
        4 + f,
        4 + k * 5,
        0.6 + 0.4 * frac(f / 3),
        71 + d + f,
        GRAIN,
        0,
        3 + k * 4,
      );
    } else {
      // Удар: кольцо песка по полу и фонтан.
      const k = (f - RISE_HIT + 1) / 4;
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * TAU + hash(d, i, 73) * 0.3;
        const rr = (4 + k * 11) * (0.8 + 0.3 * hash(i, d, 74));
        o.p.set(
          Math.round(bx + Math.cos(a) * rr),
          Math.round(by + Math.sin(a) * rr * 0.5),
          GRAIN[i % 3],
        );
      }
      spray(o.p, bx, by - 6, 10, 8, Math.min(1, k * 1.4), 77 + d, GRAIN, 6, 8);
    }
  } else if (anim === 'risef' && f < 7) {
    drip(o, hlx, hly, f / 4, 3, 8, 81 + d);
    drip(o, hrx, hry, f / 4 + 0.3, 3, 8, 83 + d);
  } else if (anim === 'flinch' && f < 3) {
    const [x, y] = P(pts.chest);
    const [ux, uy] = fwd2(P, yaw);
    spray(o.p, x + ux * 2, y + uy * 2, 7, 5, 0.5 + f * 0.3, 91 + d, GRAIN, 2, 1);
  } else if (anim === 'die' && f >= 4) {
    const [bx, by] = P(pts.base);
    const k = (f - 4) / 16;
    spray(o.p, bx, by - 10 + k * 8, 12, 12, 0.3 + k, 101 + d, GRAIN, 5, 2);
    if (f >= 12) spray(o.p, bx, by - 1, 6, 14, k, 103 + d, GRAIN_D, 0, 0);
  } else if (anim === 'land' && f < 5) {
    const [bx, by] = P(pts.base);
    spray(o.p, bx, by, 12, 10, (f + 1) / 5, 111 + d, GRAIN, 2, 1);
  }
}

const sgPic = (anim: string, f: number, d: number): Pic => {
  const yaw = yawN(d);
  if (anim === 'under' || (anim === 'rise' && f < 6)) {
    const r = new KRig(1);
    const T = tf(f);
    const pts =
      anim === 'under'
        ? moundRig({ ph: f / 6, bulge: 0, eyes: 0.7, tr: 0 }, yaw, r)
        : moundRig(
            {
              ph: f / 4,
              bulge: 0.9 * sstep(0, 0.24, T),
              eyes: 1,
              tr: (f % 2 ? 0.35 : -0.35) * sstep(0.04, 0.16, T),
            },
            yaw,
            r,
          );
    return draw(KSG, r, (o, P) => post(anim, f, d, o, P, pts, null));
  }
  const so = sgPose(anim, f);
  const r = new KRig(1 - 0.45 * clamp01(so.melt));
  const pts = ghostRig(so, yaw, r);
  return draw(KSG, r, (o, P) => post(anim, f, d, o, P, pts, so));
};

/** Режимы, где курс держит мозг (`m.face`). */
const TECH = new Set(['windup', 'recover', 'f14_blast', 'f14_sink', 'f14_rise']);

registerMobPainter('f14_sand', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = pose.t;
  const now = pose.now || 0;
  const under = md === 'f14_under';
  const want = TECH.has(md) ? (m.face ?? 0) : headOf(m, under ? 0.3 : 0.4);
  const v = visOf(m, pose, want, md === 'windup' || md === 'f14_blast' ? 16 : under ? 14 : 10);
  const d = sideOf(v);
  const ex: Partial<MobFrame> = { shadow: 5 };
  let anim = 'idle';
  let f = 0;
  let gray = false;
  if (md === 'dying') {
    anim = 'die';
    f = fi(t, 20);
    ex.linger = DIE_T;
    ex.alpha = 1 - sstep(0.68, DIE_T, t);
    ex.still = true;
  } else if (md === 'f14_frozen') {
    gray = true;
    if (m.data?.frame) {
      anim = 'claw';
      f = 9;
    }
    ex.still = true;
  } else if (md === 'windup') {
    anim = 'claw';
    f = fi(t, 14);
    ex.still = true;
  } else if (md === 'recover') {
    ex.still = true;
    if (v.prev === 'f14_blast') {
      anim = 'blastf';
      f = fi(t, 14);
      if (f < 2) {
        ex.sx = 0.94;
        ex.sy = 1.06;
      }
    } else if (v.prev === 'f14_rise') {
      anim = 'risef';
      f = fi(t, 14);
    } else {
      anim = 'clawf';
      f = fi(t, 14);
      if (f < 3) ex.ghost = { every: 0.03, life: 0.12, tint: '#ffe8b0', alpha: 0.22 };
      if (f < 2) {
        ex.sx = 1.07;
        ex.sy = 0.94;
      }
    }
  } else if (md === 'f14_blast') {
    anim = 'blast';
    f = fi(t, 17);
    ex.still = true;
  } else if (md === 'f14_sink') {
    anim = 'sink';
    f = fi(t, 8);
    ex.still = true;
  } else if (under) {
    anim = 'under';
    f = Math.floor(frac(v.dist / 0.9) * 6) % 6;
    ex.still = true;
    ex.shadow = 4;
  } else if (md === 'f14_rise') {
    anim = 'rise';
    f = fi(t, 15);
    ex.still = true;
    if (f === RISE_HIT) {
      ex.sx = 0.9;
      ex.sy = 1.12;
    } else if (f === RISE_HIT + 1) {
      ex.sx = 1.05;
      ex.sy = 0.96;
    }
  } else if (md === 'drop') {
    anim = 'drop';
    f = Math.floor(now * 12 + hash(m.id ?? 0, 5) * 2) % 2;
  } else if (md === 'stun' && v.prev === 'drop') {
    anim = 'land';
    f = fi(t, 7);
    if (f < 3) {
      ex.sx = 1 + 0.12 * (1 - f / 3);
      ex.sy = 1 - 0.14 * (1 - f / 3);
    }
  } else if (md === 'stun' && v.prev === '') {
    // Встаёт из песка там, где пал (зал отмотки): смерть задом наперёд.
    anim = 'die';
    f = 20 - Math.min(4, Math.floor(t * FPS)) * 5;
    ex.still = true;
  } else if (md === 'stun' || hurtAge(v, now) < 0.25) {
    anim = 'flinch';
    f = fi(md === 'stun' ? t : hurtAge(v, now), 5);
  } else if (md === 'sleep') {
    anim = 'sleep';
    f = Math.floor(idlePh(m, pose, 2.4) * 4) % 4;
    ex.shadow = 4;
  } else if (md === 'alert') {
    anim = 'alert';
    f = fi(t, 7);
  } else if (md === 'emerge' || moving(m, 0.4)) {
    anim = 'glide';
    f = Math.floor(frac(v.dist / 1.2) * 8) % 8;
  } else {
    anim = 'idle';
    f = Math.floor(idlePh(m, pose, 1.6) * 16) % 16;
  }
  if (md !== 'dying' && !gray && !under) hurtFx(v, now, 0.8, ex);
  return { ...frameOf(KSG, anim, f, d, pose, () => sgPic(anim, f, d), gray), ...ex };
});

/** Всё, что играет в бою, — во всех 8 сторонах. */
const WARM: [string, number, number[]?][] = [
  ['glide', 8],
  ['idle', 16],
  ['claw', 15],
  ['clawf', 15],
  ['blast', 18],
  ['blastf', 15],
  ['sink', 9],
  ['under', 6],
  ['rise', 16],
  ['risef', 15],
  ['flinch', 6],
  ['die', 21],
  ['sleep', 4],
  ['alert', 8],
  ['drop', 2],
  ['land', 8],
];

regWarm(
  'f14_sand',
  function* () {
    yield* warmAll(KSG, WARM, sgPic);
    yield* warmGray(KSG, [['claw', [9]]]);
  },
  [[KSG, demOf(WARM, sgPic)]],
);
