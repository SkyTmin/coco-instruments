// Этаж 8 — Демон-мечник (анимации мобов 8). Они-самурай прежнего облика:
// серо-лиловая кожа, рог, чёрный хвост волос, тёмно-синее кимоно с золотым
// гербом на спине, серые хакама, красный оби, катана в правой руке, ножны у
// левого бедра. 8 сторон, все честные.
//
// Метроном мозга (`f8-brains.ts`, `f8_blade`): держит 2,4–3,4 клетки и кружит
// (лицом по ходу), ближе — пятится лицом к герою (шаг назад — по пути).
// Прицел `aim` 0,62 с (первый) / 0,36 (следующие в серии): весь — подготовка:
// присел, клинок отведён к бедру, левая ладонь целит; второй прицел — из позы
// выпада. Выпад `lunge` ≤ 0,283 с — урон при касании весь выпад: тело
// струной, клинок вперёд, шлейф. Серия кончилась — долгий отдых 1,15 (главное
// окно): тормозит, остриё в пол, плечи ходят. Рубка `windup` 0,5: катана над
// головой двумя руками, задержка, удар — контакт в 0,5 (первый кадр отдыха),
// проводка в пол, возврат.

import type { Mob } from '../dungeon-sim';
import { registerMobPainter, registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import {
  alphaC,
  carry,
  clamp01,
  dirN,
  draw,
  easeIn,
  easeOut,
  fi,
  frameOf,
  FPS,
  hash,
  hurtF,
  hurtFx,
  hx,
  kindOf,
  mod,
  moving,
  PI,
  Rig,
  sampleKeys,
  smear,
  sstep,
  tn,
  TAU,
  vadd,
  visOf,
  vmul,
  vnorm,
  vsub,
  warmAll,
  yawN,
  type PKey,
  type Pic,
  type V3,
} from './f8-mobkit';
import { gait, oniBase, oniJoints, oniRig, type OniJ, type OniO, type OniStyle } from './f8-mob-oni';

const ST: OniStyle = {
  skin: tn('#4a4252', '#7a7084', '#aaa0b4', '#d8d0e0'),
  top: tn('#0e1220', '#1c2238', '#2e3a5e', '#4a5888'),
  pants: tn('#1e1e26', '#30303a', '#4a4a58', '#6a6a7c'),
  under: hx('#e0d8c8'),
  sash: hx('#8a1a18'),
  hair: tn('#08080e', '#14141e', '#24243a', '#3a3a54'),
  hairKind: 'tail',
  horns: 1,
  horn: tn('#7a6a58', '#b8a88e', '#e0d4bc', '#fff6e0'),
  eye: hx('#ff4a3a'),
  leg: 7.2,
  hipW: 1.5,
  torso: 6.6,
  chestW: 2.5,
  chestD: 1.9,
  headR: 2.9,
  arm: 6.6,
  sleeve: 2.4,
  hakama: true,
  fang: true,
  crest: hx('#e8b84a'),
};

/** Поза мечника: катана — направление в осях корпуса, вторая рука на рукояти. */
interface BladeO extends OniO {
  /** Куда смотрит клинок (оси курса, без наклона корпуса: вперёд, вправо, вверх). */
  kd: V3;
  /** Левая рука на рукояти 0…1. */
  two: number;
  /** Катана брошена: воткнута в пол перед телом (смерть). */
  free: number;
}

const B0: BladeO = {
  ...oniBase(ST),
  hu: -0.5,
  lean: 0.16,
  aR: [2.2, 1.5, -3.6],
  aL: [0.9, -1.0, -3.8],
  eL: [-1, -0.6, 0],
  kd: [0.85, 0.3, -0.45],
  two: 0,
  free: 0,
  brow: 0.8,
};

// ---- Треки действий (время — секунды режима) ------------------------------------------

/** Первый прицел 0,62: присел, клинок к бедру остриём к цели, левая ладонь вперёд. */
const AIM: PKey<BladeO>[] = carry<BladeO>([
  [0, {}],
  [
    0.2,
    {
      hu: -1.7,
      lean: 0.5,
      hf: -0.6,
      twist: -0.45,
      aR: [-1.6, 1.7, -2.6],
      kd: [1, 0.05, 0.08],
      aL: [3.6, -0.7, -0.9],
      fL: [2.4, -1.5, 0],
      fR: [-2.6, 1.5, 0],
      brow: 1,
      squint: 0.5,
    },
    easeOut,
  ],
  [0.5, { hu: -2.1, lean: 0.62, hf: -0.9, twist: -0.55, aR: [-2.3, 1.6, -2.3], aL: [3.9, -0.6, -0.5] }],
  [0.62, { hu: -2.2, lean: 0.64, mouth: 0.4 }],
]);

/** Выпад: тело струной, рука с катаной вперёд до упора, левая назад, ноги врозь. */
const LUNGE_O: Partial<BladeO> = {
  hu: -1.9,
  lean: 0.9,
  hf: 2.0,
  twist: 0.45,
  hp: -0.5,
  aR: [6.0, 0.5, 0.2],
  kd: [1, -0.02, 0.02],
  aL: [-3.2, -2.0, -2.4],
  fL: [4.4, -1.3, 0.9],
  fR: [-4.8, 1.4, 0.2],
  mouth: 0.7,
  brow: 1,
  squint: 0.3,
};
const LUNGE: PKey<BladeO>[] = [
  [0, LUNGE_O],
  [0.28, { ...LUNGE_O, hu: -1.6 }],
];

/** Второй прицел 0,36 — из выпада: тормозит, разворот, снова клинок к бедру. */
const AIM2: PKey<BladeO>[] = carry<BladeO>([
  [0, LUNGE_O],
  [0.1, { hu: -2.3, lean: 0.55, hf: 0.6, aR: [1.4, 1.6, -2.2], kd: [0.9, 0.2, -0.2] }, easeOut],
  [0.3, { ...AIM[2][1], hf: -0.6 }],
  [0.36, { ...AIM[3][1] }],
]);

/** Рубка 0,5: катана над головой двумя руками, задержка, удар — контакт в 0,5. */
const CHOP: PKey<BladeO>[] = carry<BladeO>([
  [0, {}],
  [
    0.22,
    {
      hu: -0.4,
      lean: -0.22,
      aR: [0.7, 0.5, 4.3],
      kd: [-0.75, 0.05, 0.65],
      two: 1,
      fL: [2.1, -1.5, 0],
      fR: [-1.7, 1.5, 0],
      brow: 1,
    },
    easeOut,
  ],
  [0.42, { lean: -0.32, hu: -0.7, aR: [-0.1, 0.4, 4.7], kd: [-0.92, 0, 0.38], mouth: 0.5 }],
  [0.47, { lean: 0.15, hu: -0.9, aR: [3.6, 0.3, 3.0], kd: [0.55, 0, 0.83] }, easeIn],
  [0.5, { lean: 0.5, hu: -1.9, hf: 1.2, aR: [5.0, 0.2, -1.0], kd: [0.85, -0.05, -0.52], mouth: 1 }, easeIn],
]);

/** Проводка после рубки 0,55: клинок в пол, задержка, возврат. */
const CHOPF: PKey<BladeO>[] = carry<BladeO>([
  [0, { ...CHOP[4][1] }],
  [0.08, { lean: 0.62, hu: -2.3, hf: 1.4, aR: [3.8, 0, -3.4], kd: [0.5, -0.25, -0.82], two: 1 }, easeOut],
  [0.3, { lean: 0.55, hu: -2.1, mouth: 0.3, two: 0.6 }],
  [0.55, { ...B0 }],
]);

/** Долгий отдых после серии: тормозит, остриё в пол, тяжело дышит, выпрямляется. */
const TIRE: PKey<BladeO>[] = carry<BladeO>([
  [0, LUNGE_O],
  [0.12, { hu: -2.6, lean: 0.6, hf: 0.8, aR: [3.6, 1.2, -2.8], kd: [0.6, 0.1, -0.78] }, easeOut],
  [
    0.3,
    {
      hu: -1.4,
      lean: 0.45,
      hf: 0,
      twist: 0,
      hp: 0.35,
      aR: [2.6, 1.4, -3.9],
      kd: [0.35, 0.15, -0.92],
      aL: [1.6, -1.2, -3.0],
      fL: [1.2, -1.6, 0],
      fR: [-1.0, 1.6, 0],
      mouth: 0.5,
      brow: 0.5,
      squint: 0.6,
    },
  ],
]);

/** Вздрогнул от удара героя (5 кадров). */
const FLINCH: PKey<BladeO>[] = [
  [0, {}],
  [
    0.05,
    {
      lean: -0.3,
      hf: -1.0,
      hp: -0.45,
      aR: [1.0, 2.2, -2.0],
      kd: [0.4, 0.6, 0.5],
      aL: [1.4, -2.0, -1.0],
      squint: 1,
      mouth: 0.6,
    },
    easeOut,
  ],
  [0.2, {}],
];

/** Смерть 0,8: отпрянул, рухнул на колени, катана воткнута в пол, падает ничком. */
const DIE: PKey<BladeO>[] = carry<BladeO>([
  [0, { lean: -0.4, hp: -0.55, hf: -0.8, aR: [1.4, 2.3, -1.8], aL: [1.0, -2.2, -1.6], mouth: 1, squint: 1 }],
  [
    0.18,
    {
      hu: -4.4,
      lean: 0.3,
      hp: 0.55,
      hf: 0.4,
      aR: [3.0, 1.2, -3.8],
      kd: [0.12, 0.08, -1],
      aL: [1.8, -1.5, -3.6],
      fL: [2.8, -1.6, 0],
      fR: [2.2, 1.6, 0],
      mouth: 0.6,
    },
    easeIn,
  ],
  [0.38, { lean: 0.55, hp: 0.9, hu: -4.6, mouth: 0.3 }],
  [0.42, { free: 1 }],
  [
    0.6,
    {
      lean: 1.5,
      hu: -5.8,
      hf: 1.6,
      hp: 0.3,
      aR: [2.2, 3.0, -0.6],
      aL: [2.6, -3.0, -0.4],
      fL: [-2.2, -1.6, 0.3],
      fR: [-2.8, 1.6, 0.3],
    },
    easeIn,
  ],
  [0.8, { hu: -6.0 }],
]);

/** Сон: сидит в сэйдза, катана поперёк колен, голова склонена. */
const SLEEP: BladeO = {
  ...B0,
  hu: -4.0,
  lean: 0.12,
  hp: 0.65,
  aR: [2.0, 0.9, -3.5],
  aL: [2.0, -0.9, -3.5],
  kd: [0.05, -1, 0.05],
  fL: [-1.6, -1.5, 0],
  fR: [-1.6, 1.5, 0],
  shut: 1,
  brow: 0,
};
/** Падает со свода: руки вверх, катана над головой. */
const FALL: BladeO = {
  ...B0,
  hu: 0.6,
  lean: -0.15,
  hp: -0.5,
  aR: [0.6, 2.4, 3.2],
  kd: [-0.2, 0.4, 0.9],
  aL: [0.4, -2.6, 2.4],
  fL: [1.6, -1.8, 2.4],
  fR: [-1.2, 1.8, 3.2],
  mouth: 0.8,
};

// ---- Поза по кадру ---------------------------------------------------------------------

const RUN_N = 8;
const IDLE_N = 8;
/** Долгий отдых кадрами: торможение 8, дыхание кольцом 8, подъём 5. */
const TIRE_N = 21;

function poseAt(anim: string, f: number): [BladeO, BladeO, V3] {
  const t = (f + 0.5) / FPS;
  const lagT = t - 3 / FPS;
  const at = (keys: PKey<BladeO>[], T: number) => sampleKeys(B0, keys, Math.max(0, T));
  switch (anim) {
    case 'idle': {
      const ph = (f / IDLE_N) * TAU;
      const mk = (p: number): BladeO => ({
        ...B0,
        hu: B0.hu + Math.sin(p) * 0.22,
        lean: B0.lean + Math.sin(p) * 0.03,
        hy: Math.sin(p * 0.5) * 0.2,
        aR: [B0.aR[0], B0.aR[1], B0.aR[2] + Math.sin(p) * 0.25],
        kd: [B0.kd[0], B0.kd[1] + Math.sin(p) * 0.08, B0.kd[2] + Math.cos(p) * 0.06],
      });
      return [mk(ph), mk(ph - 0.9), [-0.4 + Math.sin(ph) * 0.4, 0, 0]];
    }
    case 'run': {
      const ph = f / RUN_N;
      const mk = (p: number): BladeO => {
        const g = gait({ ...B0, lean: 0.38, hp: -0.25, hu: -0.7 }, ST, p, 6.4, 2.0, 1.1) as BladeO;
        // Правая держит катану низко за спиной — машет меньше, клинок едет следом.
        const sw = Math.cos(p * TAU);
        g.aR = [-1.0 - sw * 0.6, 1.9, -3.3];
        g.kd = [-0.82, 0.3, -0.42];
        g.aL = [g.aL[0], -1.2, g.aL[2] + 0.6];
        return g;
      };
      return [mk(ph), mk(ph - 0.14), [-2.6, 0, 0.6]];
    }
    case 'aim': {
      const o = at(AIM, t);
      // Дрожь натянутой пружины на пике прицела — рисунок, а не дрожь движка.
      if (t > 0.45) o.hu += f % 2 ? 0.2 : -0.12;
      return [o, at(AIM, lagT), [0, 0, 0]];
    }
    case 'aim2': {
      const o = at(AIM2, t);
      if (t > 0.26) o.hu += f % 2 ? 0.2 : -0.12;
      return [o, at(AIM2, lagT), [-1.5, 0, 0]];
    }
    case 'lunge':
      return [at(LUNGE, t), at(LUNGE, t), [-4.5, 0, 0.6]];
    case 'chop':
      return [at(CHOP, t), at(CHOP, lagT), [0, 0, 0]];
    case 'chopf':
      return [at(CHOPF, t), at(CHOPF, lagT), [0, 0, 0]];
    case 'tire': {
      if (f < 8) return [at(TIRE, t), at(TIRE, lagT), [-1.5 * (1 - f / 8), 0, 0]];
      if (f < 16) {
        // Дыхание: плечи и клинок ходят, голова кивает (кольцо 8 кадров).
        const p = ((f - 8) / 8) * TAU;
        const o0 = at(TIRE, 0.3);
        const mk = (q: number): BladeO => ({
          ...o0,
          hu: o0.hu + Math.sin(q) * 0.35,
          lean: o0.lean + Math.sin(q) * 0.07,
          hp: o0.hp + Math.sin(q) * 0.12,
          aL: [o0.aL[0], o0.aL[1], o0.aL[2] + Math.sin(q) * 0.3],
        });
        return [mk(p), mk(p - 0.8), [0, 0, 0]];
      }
      const k = (f - 15) / 5;
      const o = sampleKeys(B0, [[0, at(TIRE, 0.3)], [1, {}, easeOut]], k);
      return [o, o, [0, 0, 0]];
    }
    case 'flinch':
      return [at(FLINCH, t), at(FLINCH, lagT), [0, 0, 0]];
    case 'stun': {
      // Шатается по кругу, катана остриём в пол, голова мотается (6 кадров).
      const p = (f / 6) * TAU;
      const o: BladeO = {
        ...B0,
        lean: 0.12 + Math.sin(p) * 0.1,
        roll: Math.cos(p) * 0.14,
        hu: -0.9,
        hp: 0.1,
        hr: Math.sin(p) * 0.3,
        hy: Math.cos(p) * 0.3,
        aR: [1.8, 1.8, -3.8],
        kd: [0.2, 0.2, -0.95],
        aL: [0.8, -2.0, -3.0],
        squint: 1,
        mouth: 0.4,
      };
      return [o, o, [0, 0, 0]];
    }
    case 'die':
      return [at(DIE, t), at(DIE, lagT), [0, 0, 0]];
    case 'sleep': {
      const o: BladeO = { ...SLEEP, hu: SLEEP.hu + (f % 2 ? 0.25 : 0) };
      return [o, o, [0, 0, 0]];
    }
    case 'alert': {
      const k = clamp01(t / 0.35);
      const o = sampleKeys(SLEEP, [[0, {}], [0.35, { ...B0, mouth: 0.7, brow: 1, shut: 0 }, easeOut]], k * 0.35);
      return [o, o, [0, 0, 0]];
    }
    case 'drop': {
      const w = Math.sin((f / 4) * TAU);
      const o: BladeO = {
        ...FALL,
        aL: [FALL.aL[0], FALL.aL[1] - w * 0.5, FALL.aL[2] + w * 0.5],
        fL: [FALL.fL[0] + w * 0.5, FALL.fL[1], FALL.fL[2]],
        fR: [FALL.fR[0] - w * 0.5, FALL.fR[1], FALL.fR[2]],
      };
      return [o, FALL, [0, 0, -2.5]];
    }
  }
  return [B0, B0, [0, 0, 0]];
}

// ---- Катана --------------------------------------------------------------------------

const STEEL = { T: tn('#3a404c', '#7c8698', '#c4ccd8', '#ffffff'), spec: true };
const HANDLE = { T: tn('#140c10', '#2a1a20', '#3c2830', '#5a4048') };
const SAYA = { T: tn('#120a0e', '#24141a', '#3a2028', '#5a3440'), spec: true };
const TSUBA = hx('#d8a840');
const EDGE = hx('#f4f8ff');

/** Левая рука на рукояти: кисть ставится по катане (доля `two`). */
function solve(o: BladeO, yaw: number): BladeO {
  if (o.two <= 0.01 || o.free > 0.5) return o;
  const J = oniJoints(o, ST, yaw);
  const d = vnorm(J.B.v(o.kd[0], o.kd[1], o.kd[2]));
  const want = vsub(vadd(J.haR, vmul(d, -1.5)), J.shL);
  const C = J.C;
  const loc: V3 = [
    want[0] * C.f[0] + want[1] * C.f[1] + want[2] * C.f[2],
    want[0] * C.s[0] + want[1] * C.s[1] + want[2] * C.s[2],
    want[0] * C.u[0] + want[1] * C.u[1] + want[2] * C.u[2],
  ];
  const k = o.two;
  return {
    ...o,
    aL: [o.aL[0] + (loc[0] - o.aL[0]) * k, o.aL[1] + (loc[1] - o.aL[1]) * k, o.aL[2] + (loc[2] - o.aL[2]) * k],
  };
}

/** Рукоять, цуба и клинок; вернёт [основание клинка, остриё] (мир). */
function katana(r: Rig, J: OniJ, o: BladeO): [V3, V3] {
  let grip: V3;
  let d: V3;
  if (o.free > 0.5) {
    grip = J.B.p(3.6, 1.1, 3.4);
    d = vnorm(J.B.v(0.18, 0.1, -1));
  } else {
    grip = J.haR;
    d = vnorm(J.B.v(o.kd[0], o.kd[1], o.kd[2]));
  }
  const butt = vadd(grip, vmul(d, -2.4));
  const guard = vadd(grip, vmul(d, 1.0));
  const tip = vadd(guard, vmul(d, o.free > 0.5 ? 7.2 : 10.5));
  r.cap(butt, guard, 0.55, 0.55, HANDLE);
  r.dot(guard, TSUBA, 0, 1, 0.8);
  // Клинок — узкая грань с режущей кромкой; изгиб — кончик чуть назад.
  const up = Math.abs(d[2]) < 0.9 ? J.B.u : J.B.f;
  const e = vnorm([d[1] * up[2] - d[2] * up[1], d[2] * up[0] - d[0] * up[2], d[0] * up[1] - d[1] * up[0]]);
  const base1 = vadd(guard, vmul(e, 0.5));
  const mid = vadd(vadd(guard, vmul(d, 6)), vmul(e, 0.35));
  r.poly([base1, mid, tip, vadd(guard, vmul(e, -0.3))], STEEL);
  r.line(vadd(guard, vmul(e, 0.45)), vadd(tip, vmul(e, 0.1)), EDGE, 0, 0.7);
  return [guard, tip];
}

/** Ножны у левого бедра. */
function saya(r: Rig, J: OniJ): void {
  const a = J.C.p(1.4, -ST.hipW - 0.5, 0.9);
  const b = J.C.p(-4.2, -ST.hipW - 0.9, -1.4);
  r.cap(a, b, 0.5, 0.45, SAYA);
}

// ---- Кадр ------------------------------------------------------------------------------

const K = kindOf('f8_blade', 64, 56, 32, 42, 1700);

/** Остриё катаны в миг `t` действия (для смаза по пути клинка). */
function tipAt(keys: PKey<BladeO>[], t: number, yaw: number): V3 {
  const o = solve(sampleKeys(B0, keys, Math.max(0, t)), yaw);
  const J = oniJoints(o, ST, yaw);
  const d = vnorm(J.B.v(o.kd[0], o.kd[1], o.kd[2]));
  return vadd(J.haR, vmul(d, 11));
}

function bladePic(anim: string, f: number, d: number): Pic {
  const yaw = yawN(d);
  const [o0, lag0, wind] = poseAt(anim, f);
  const o = solve(o0, yaw);
  const lagO = solve(lag0, yaw);
  const dead = anim === 'die' && f > 6;
  const r = new Rig();
  const J = oniRig(r, o, ST, yaw, { lag: lagO, wind, dead });
  saya(r, J);
  const [, tip] = katana(r, J, o);
  if (dead) r.eye = null;
  return draw(K, r, (p, lit, P) => {
    // Смаз клинка: дуга острия за последние кадры рубки — и в первые кадры проводки.
    const chop = (anim === 'chop' && f >= 10) || (anim === 'chopf' && f <= 2);
    if (chop) {
      // Дуга — только сам мах (с 0,43), частыми точками: иначе ломаная углами.
      const t1 = anim === 'chop' ? (f + 0.5) / FPS : 0.5 + (f + 0.5) / FPS;
      const t0 = Math.max(0.43, t1 - 0.12);
      const pts: [number, number][] = [];
      for (let i = 0; i <= 10; i++) {
        const tt = t0 + ((t1 - t0) * i) / 10;
        pts.push(P(tt <= 0.5 ? tipAt(CHOP, tt, yaw) : tipAt(CHOPF, tt - 0.5, yaw)));
      }
      const L2 = lit();
      smear(L2, pts, hx('#a8c4ff'), hx('#ffffff'), 2);
      smear(p, pts, alphaC(hx('#dfe8ff'), 0.85), hx('#ffffff'), 1);
    }
    if (anim === 'lunge') {
      // Росчерк выпада: светлая черта от острия назад вдоль пути.
      const [tx, ty] = P(tip);
      const [bx, by] = P(vadd(tip, J.B.v(-9, 0, 0)));
      smear(lit(), [
        [bx, by],
        [tx, ty],
      ], hx('#9cb8ff'), hx('#ffffff'), 1);
    }
    if (anim === 'stun') {
      const [hxp, hyp] = P(J.H.p(0, 0, ST.headR * 1.5));
      for (let i = 0; i < 3; i++) {
        const a = (f / 6) * TAU + (i / 3) * TAU;
        const x = Math.floor(hxp + Math.cos(a) * 4.5);
        const y = Math.floor(hyp - 2 + Math.sin(a) * 1.5);
        lit().set(x, y, hx('#fff27a'));
        p.set(x, y, hx('#ffffff'));
      }
    }
    if (anim === 'die' && f >= 11) {
      // Распадается чёрным пеплом с красными искрами — от тела вверх.
      const k = (f - 11) / 8;
      for (let i = 0; i < 9; i++) {
        const [bx, by] = P(J.C.p((hash(i, 2) - 0.5) * 3, (hash(i, 3) - 0.5) * 6, 1 + hash(i, 5) * 5));
        const x = Math.floor(bx + (hash(i, 9) - 0.5) * 4 + k * (hash(i, 4) - 0.3) * 6);
        const y = Math.floor(by - k * (5 + hash(i, 7) * 8));
        if (i % 3 === 0) lit().set(x, y, alphaC(hx('#ff5030'), 1 - k * 0.7));
        else p.set(x, y, alphaC(hx('#1a1420'), 1 - k * 0.8));
      }
    }
  });
}

registerMobPainter('f8_blade', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = pose.t;
  const now = pose.now || 0;
  const id = m.id ?? 0;
  const v = visOf(m, pose, m.face ?? 0, md === 'aim' || md === 'lunge' ? 30 : 11);
  const d = dirN(v.yaw);
  const ex: Partial<MobFrame> = { shadow: 5 };
  let anim = 'idle';
  let f = 0;
  const data = (m.data ?? {}) as Record<string, number>;
  if (md === 'dying') {
    anim = 'die';
    f = fi(t, 19);
    ex.linger = 0.85;
    ex.alpha = 1 - sstep(0.62, 0.85, t);
    ex.shadow = 5 * (1 - sstep(0.5, 0.8, t));
    ex.still = true;
  } else if (md === 'aim') {
    if (data.next) {
      anim = 'aim2';
      f = fi(t, 8);
    } else {
      anim = 'aim';
      f = fi(t, 14);
    }
    ex.still = true;
  } else if (md === 'lunge') {
    anim = 'lunge';
    f = fi(t, 6);
    ex.still = true;
    ex.ghost = { every: 0.025, life: 0.14, tint: '#6080ff', alpha: 0.3 };
  } else if (md === 'windup') {
    anim = 'chop';
    f = fi(t, 11);
    ex.still = true;
  } else if (md === 'recover') {
    if (data.long) {
      anim = 'tire';
      const k = t * FPS;
      f = k < 8 ? Math.floor(k) : t < 0.95 ? 8 + mod(k - 8, 8) : 16 + Math.min(4, Math.floor((t - 0.95) * FPS));
      if (f <= 1) {
        ex.sx = 1.1;
        ex.sy = 0.92;
      }
    } else {
      anim = 'chopf';
      f = fi(t, 13);
      if (f <= 1) {
        ex.sx = 1.06;
        ex.sy = 0.95;
      }
    }
    ex.still = true;
  } else if (md === 'stun') {
    if (v.prev === 'drop' && t < 0.12) {
      anim = 'chopf';
      f = 2;
      ex.sx = 1.2 - t;
      ex.sy = 0.8 + t;
    } else {
      anim = 'stun';
      f = mod(now * 18, 6);
    }
  } else if (md === 'drop') {
    anim = 'drop';
    f = mod(now * 12 + id, 4);
  } else if (md === 'sleep') {
    anim = 'sleep';
    f = mod(now * 1.2 + hash(id, 3) * 2, 2);
  } else if (md === 'alert') {
    anim = 'alert';
    f = fi(t, 8);
    ex.dy = -Math.sin(PI * clamp01(t / 0.35)) * 2;
  } else if (hurtF(v, now) >= 0 && !moving(m)) {
    anim = 'flinch';
    f = hurtF(v, now);
  } else if (moving(m)) {
    anim = 'run';
    // Шаг — по пройденному пути (пятится — фаза идёт назад): цикл 0,9 клетки.
    f = mod((v.dist / 0.9) * RUN_N, RUN_N);
  } else {
    anim = 'idle';
    f = mod((now + hash(id, 7) * 4) * 6, IDLE_N);
  }
  if (md === 'f8_out') ex.alpha = 0.25 + 0.75 * easeOut(t / 0.4);
  if (md !== 'dying') hurtFx(v, now, 1.2, ex);
  return { ...frameOf(K, anim, f, d, pose, () => bladePic(anim, f, d)), ...ex };
});

registerMobWarm('f8_blade', function* () {
  yield* warmAll(
    K,
    [
      ['run', RUN_N],
      ['idle', IDLE_N],
      ['aim', 15],
      ['aim2', 9],
      ['lunge', 7],
      ['tire', TIRE_N],
      ['chop', 12],
      ['chopf', 14],
      ['flinch', 5],
      ['stun', 6],
      ['die', 20],
      ['drop', 4],
    ],
    bladePic,
  );
});

