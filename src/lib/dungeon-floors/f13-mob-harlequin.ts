// Арлекин (анимации мобов 13). Облик прежний: кукла в ромбах, чёрная
// полумаска, колпак с двумя рогами и бубенцами, жабо, деревянный шлепок.
// Нитей нет — свободная кукла-акробат.
//
// Треки 24 к/с от времени режима (`f13-brains.ts` `HARL`, `melee`):
// - шлепок наотмашь — урон в конце `windup` 0,55 с, кадр контакта — первый
//   кадр `recover`: присел с закруткой, подскок «цаплей» (колено вверх,
//   шлепок за спиной, левая рука целит), держит; удар — раскрутка корпуса за
//   три кадра со следом, контакт в выпаде; проводка — шлепок уходит за левое
//   плечо, отскок назад, возврат с перелётом;
// - `f13_dive` 0,45 с — уход в люк: присел, «та-дам!» (руки вверх), солдатиком
//   вниз — то, что ниже пола, срезано кромкой люка; если брат-люк рядом
//   (`m.data.hx2/hy2`), прыжок до него;
// - `f13_pop` 0,75 с — из люка за спиной героя: торчат рожки колпака,
//   выглядывает (голова туда-сюда), ныряет обратно (сжатая пружина), держит —
//   и выстреливает вверх с оборотом, шлепок по кругу; удар движка падает на
//   конец `f13_pop` — кадр контакта — первый кадр `recover` (`prec`):
//   в воздухе звездой, потом приземление с вжатием и поклон;
// - `drop` (выпал со свода) — летит звездой, сгруппировался; `stun` после
//   него — приземление и «та-дам!»;
// - смерть — комичное падение: отброшен, полуоборот на одной ноге, на спину
//   ногами вверх, ноги падают, бубенцы обвисают.
// Бубенцы колпака отстают от головы. Шаг — вприпрыжку, по пути.

import { registerMobPainter, registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import type { Px } from '../dungeon-art';
import { HARL_BODY, P, Rig, humanoid, hx, limb, onHead, v3, vadd, vnorm, vsc } from './f13-art';
import type { Joints, Pose, RGBA, V3 } from './f13-art';
import {
  PI,
  TAU,
  dangleP,
  dirN,
  draw,
  eBack,
  easeIn,
  easeOut,
  fi,
  frameOf,
  gaitP,
  gropeP,
  hash,
  headOf,
  hurtAge,
  hurtFx,
  hurtP,
  kindOf,
  lin,
  moving,
  projOf,
  puff,
  slumpP,
  smearInto,
  smooth,
  spark,
  sstep,
  tf,
  track,
  visOf,
  warmAll,
  yawN,
} from './f13-mobkit';
import type { PKey, Pic } from './f13-mobkit';

/**
 * Поза арлекина: + шлепок (поправка к предплечью: вперёд `sf`, вверх `su`,
 * вправо `ss`), бубенцы колпака: `hb` — отстают назад (+) / летят вперёд (−),
 * `hu` — взлетают (+) / обвисают (−).
 */
interface HP extends Pose {
  sf: number;
  su: number;
  ss: number;
  hb: number;
  hu: number;
  /** Шлепок выпал из руки и лёг на пол (0…1). */
  sl?: number;
}
const H0: HP = { ...dangleP(0), sf: 0.6, su: 0.3, ss: 0, hb: 0, hu: 0 };
const hp = (o: Partial<HP>, b: HP = H0): HP => ({ ...b, ...o });

const W = 0.55;
const WIND_N = 14;
const REC_N = 11;
const DIVE = 0.45;
const DIVE_N = 11;
const POP = 0.75;
const POP_N = 18;
const PREC_N = 11;
const DROP_N = 14;
const LAND_N = 5;
const HURT_N = 8;
const DIE_N = 21;
const WALK_N = 12;
const STRIDE = 1.8;
const IDLE_N = 12;
const STICK = 8;
/** Кромка люка: ниже анкера на столько пикселей — уже под полом. */
const LIP = 4;

// ---- стойка и шлепок ---------------------------------------------------------

/** Стойка: пружинит, шлепок вперёд-вверх, левая рука на бедре. */
const G = hp({
  bob: 1,
  lean: 0.08,
  aR: limb(0.35, 0.22, 0.7),
  aL: limb(0.15, 0.35, 0.9),
  lL: limb(0.12, 0.1, 0.2),
  lR: limb(-0.08, 0.12, 0.15),
  sf: 0.7,
  su: 0.5,
});
/** Присел с закруткой: шлепок опустил назад-вниз — собирается. */
const A1 = hp(
  {
    sink: 1.5,
    bob: 0.2,
    lean: 0.28,
    twist: -0.45,
    hp: 0.12,
    hy: 0.3,
    aR: limb(-0.5, 0.45, 0.5),
    aL: limb(0.5, 0.4, 0.5),
    lL: limb(0.35, 0.08, 0.7),
    lR: limb(-0.25, 0.1, 0.6),
    sf: -0.8,
    su: -0.5,
    ss: 0.3,
    hb: 0.3,
  },
  G,
);
/** Подскок «цаплей»: колено вверх, шлепок высоко над правым плечом, левая рука целит. */
const A2 = hp(
  {
    bob: 2.4,
    sink: 0,
    lean: -0.18,
    twist: -0.6,
    side: -0.08,
    hy: 0.45,
    hp: -0.15,
    aR: limb(2.7, 0.6, 0.7),
    aL: limb(1.4, 0.3, 0.1),
    lL: limb(1.0, 0.1, 1.5),
    lR: limb(-0.05, 0.08, 0.1),
    toe: 0.35,
    sf: -0.4,
    su: 0.9,
    ss: 0.5,
    hb: 0.55,
    hu: 0.3,
  },
  G,
);
/** Пик: дотягивает шлепок назад, бубенцы успокаиваются. */
const A3 = hp(
  { twist: -0.7, lean: -0.24, bob: 2.6, aR: limb(2.85, 0.6, 0.8), sf: -0.6, hy: 0.5, hb: 0.3, hu: 0.1 },
  A2,
);
/** Контакт: выпад, шлепок наискось вниз через цель. */
const C = hp(
  {
    bob: 0,
    sink: 1.6,
    lean: 0.42,
    twist: 0.5,
    side: 0.06,
    hy: -0.25,
    hp: 0.2,
    aR: limb(1.15, 0.15, 0.15),
    aL: limb(-0.4, 0.7, 0.3),
    lL: limb(0.7, 0.08, 0.35),
    lR: limb(-0.55, 0.1, 0.3),
    toe: 0,
    sf: 0.8,
    su: -0.7,
    ss: -0.5,
    hb: -0.5,
    hu: -0.1,
  },
  G,
);
/** Проводка: шлепок ушёл вниз, к левому бедру. */
const FT = hp(
  {
    twist: 0.9,
    lean: 0.52,
    sink: 2,
    hy: -0.5,
    aR: limb(0.7, -0.15, 0.3),
    sf: 0.3,
    su: -0.8,
    ss: -1.2,
    hb: -0.8,
  },
  C,
);
/** Отскок назад: шлепок на плечо. */
const R1 = hp(
  {
    bob: 2.2,
    lean: -0.1,
    twist: 0.25,
    aR: limb(0.6, 0.3, 1.0),
    aL: limb(0.3, 0.5, 0.6),
    lL: limb(0.2, 0.06, 0.5),
    lR: limb(-0.15, 0.06, 0.6),
    toe: 0.35,
    sf: 0.3,
    su: 0.9,
    hb: 0.4,
    hu: 0.4,
  },
  G,
);

const WIND: PKey<HP>[] = [
  [0, G],
  [0.1, A1, easeOut],
  [0.28, A2, easeOut],
  [0.42, A3, lin],
  [W + 0.001, C, easeIn],
];
const REC: PKey<HP>[] = [
  [0, C],
  [0.1, FT, easeOut],
  [0.24, R1],
  [0.44, G, eBack],
];

// ---- люк: уход и выход ---------------------------------------------------------

/** Присел перед прыжком в люк. */
const DV1 = hp(
  {
    sink: 2.6,
    bob: 0,
    lean: 0.35,
    hp: 0.2,
    aL: limb(-0.7, 0.35, 0.2),
    aR: limb(-0.7, 0.35, 0.3),
    lL: limb(0.45, 0.06, 0.9),
    lR: limb(0.4, 0.06, 0.9),
    sf: -0.8,
    su: -0.4,
    ss: 0.2,
    hb: 0.3,
  },
  G,
);
/** «Та-дам!»: руки вверх, ноги вместе, носки вниз. */
const DV2 = hp(
  {
    sink: 0,
    bob: 3,
    lean: -0.08,
    hp: -0.25,
    aL: limb(2.7, 0.55, 0.1),
    aR: limb(2.7, 0.55, 0.15),
    lL: limb(0.05, 0.02, 0.05),
    lR: limb(-0.02, 0.02, 0.05),
    toe: 0.7,
    sf: 0,
    su: 1.2,
    ss: 0,
    hb: -0.2,
    hu: -0.6,
  },
  G,
);
/** Солдатиком в люк: бубенцы взлетают последними. */
const DV3 = hp(
  { sink: 32, bob: 0, aL: limb(2.9, 0.3, 0), aR: limb(2.9, 0.3, 0), hu: 1, hb: 0 },
  DV2,
);
const DIVE_K: PKey<HP>[] = [
  [0, G],
  [0.08, DV1, easeOut],
  [0.2, DV2, easeOut],
  [0.25, hp({ bob: 2.6, hu: -0.2 }, DV2), lin],
  [DIVE, DV3, easeIn],
];

/** Сидит в люке: руки на кромке, шлепок торчит вверх. */
const PH = hp(
  {
    sink: 34,
    bob: 0,
    lean: 0.05,
    aL: limb(1.5, 0.5, 0.9),
    aR: limb(1.5, 0.5, 0.9),
    lL: limb(0.1, 0.05, 0.2),
    lR: limb(-0.05, 0.05, 0.2),
    sf: 0,
    su: 1,
    ss: 0,
  },
  G,
);
/** Выстрелил из люка: звездой, шлепок вбок — круг по месту. */
const SPRING = hp(
  {
    sink: 0,
    bob: 4,
    lean: -0.1,
    hp: -0.3,
    aL: limb(1.0, 1.4, 0.1),
    aR: limb(0.4, 1.45, 0.05),
    lL: limb(0.1, 0.35, 0.2),
    lR: limb(0.1, 0.35, 0.2),
    toe: 0.5,
    sf: 0,
    su: 0,
    ss: 1.4,
    hb: 0.5,
    hu: -0.6,
  },
  G,
);
const POP_K: PKey<HP>[] = [
  [0, PH],
  [0.1, hp({ sink: 26, hu: -0.2 }, PH)],
  [0.2, hp({ sink: 24, hb: 0.2 }, PH)],
  [0.32, hp({ sink: 16, hy: -0.6, hp: -0.1 }, PH)],
  [0.44, hp({ sink: 16, hy: 0.6, hp: -0.1 }, PH)],
  [0.56, hp({ sink: 22, hy: 0, hb: -0.3, hu: 0.5 }, PH), easeOut],
  [0.62, hp({ sink: 22.5, hb: -0.1, hu: 0.3 }, PH), lin],
  [POP + 0.001, SPRING, easeIn],
];
/** После выхода: зависает звездой, приземляется, кланяется. */
const LAND = hp(
  {
    bob: 0,
    sink: 2.5,
    lean: 0.3,
    hp: 0.1,
    aL: limb(0.6, 1.1, 0.3),
    aR: limb(0.6, 1.0, 0.4),
    lL: limb(0.4, 0.15, 0.8),
    lR: limb(0.35, 0.15, 0.8),
    toe: 0,
    sf: 0.5,
    su: 0,
    ss: 0.6,
    hb: -0.4,
    hu: -0.3,
  },
  G,
);
const BOW = hp(
  {
    sink: 0.6,
    bob: 0.6,
    lean: 0.6,
    hp: 0.15,
    aR: limb(0.6, 1.1, 0.3),
    aL: limb(-0.5, 0.4, 0.4),
    lL: limb(0.35, 0.06, 0.2),
    lR: limb(-0.3, 0.06, 0.3),
    sf: 0,
    su: 0.2,
    ss: 1.2,
    hb: -0.6,
    hu: -0.5,
  },
  G,
);
const PREC_K: PKey<HP>[] = [
  [0, SPRING],
  [0.08, hp({ bob: 3, aL: limb(1.1, 1.5, 0.1), aR: limb(0.5, 1.5, 0.05), hb: 0.2 }, SPRING)],
  [0.2, LAND, easeIn],
  [0.3, BOW, easeOut],
  [0.44, G, eBack],
];

/** Оборот выхода из люка: от `f13_pop` 0,64 с до `recover` 0,19 с. */
const popSpin = (tt: number) => TAU * smooth((tt - 0.64) / 0.3);

// ---- выпал со свода, приземлился ---------------------------------------------

const DR1 = hp(
  {
    bob: 2,
    lean: -0.1,
    hp: -0.3,
    aL: limb(2.4, 0.9, 0.2),
    aR: limb(2.2, 1.0, 0.3),
    lL: limb(0.3, 0.35, 0.6),
    lR: limb(-0.2, 0.3, 0.5),
    toe: 0.6,
    sf: 0.2,
    su: 1,
    ss: 0.4,
    hu: 0.9,
  },
  G,
);
const DR2 = hp(
  {
    aL: limb(2.0, 1.2, 0.5),
    aR: limb(2.6, 0.8, 0.1),
    lL: limb(-0.2, 0.3, 0.4),
    lR: limb(0.4, 0.35, 0.7),
    hu: 0.7,
  },
  DR1,
);
const TUCK = hp(
  {
    lean: 0.15,
    aL: limb(1.2, 0.6, 0.4),
    aR: limb(1.0, 0.7, 0.5),
    lL: limb(0.9, 0.15, 1.2),
    lR: limb(0.85, 0.15, 1.2),
    toe: 0.2,
    hu: 1,
  },
  DR1,
);
const DROP_K: PKey<HP>[] = [
  [0, DR1],
  [0.18, DR2],
  [0.34, DR1],
  [0.48, TUCK, easeOut],
];
const LD = hp(
  {
    sink: 3,
    bob: 0,
    lean: 0.45,
    hp: 0.3,
    aL: limb(0.5, 1.2, 0.3),
    aR: limb(0.4, 1.2, 0.4),
    lL: limb(0.6, 0.2, 1.1),
    lR: limb(0.55, 0.2, 1.1),
    hu: -0.6,
    hb: -0.3,
  },
  G,
);
const TADA = hp(
  {
    bob: 1.6,
    lean: -0.1,
    hp: -0.2,
    aL: limb(2.6, 0.6, 0.1),
    aR: limb(2.5, 0.6, 0.2),
    sf: 0,
    su: 1.2,
    hu: 0.3,
    toe: 0.3,
  },
  G,
);
const LAND_K: PKey<HP>[] = [
  [0, LD],
  [0.2, TADA, easeOut],
];

// ---- смерть: отброшен, полуоборот, на спину ногами вверх ----------------------

const DH1 = hp(
  {
    lean: -0.45,
    hp: -0.5,
    bob: 2,
    aL: limb(2.2, 0.8, 0.2),
    aR: limb(1.9, 0.9, 0.3),
    lL: limb(0.5, 0.2, 0.5),
    lR: limb(-0.2, 0.15, 0.3),
    toe: 0.5,
    sf: 0,
    su: 1.2,
    hb: 0.6,
    hu: 0.7,
  },
  G,
);
const DH2 = hp(
  {
    lean: -0.55,
    side: 0.25,
    bob: 0.8,
    sink: 1.5,
    aL: limb(1.2, 1.4, 0.2),
    aR: limb(0.9, 1.3, 0.3),
    lL: limb(0.9, 0.1, 0.3),
    lR: limb(-0.1, 0.1, 0.2),
    hb: -0.5,
    hu: 0.2,
  },
  DH1,
);
const DH3 = hp(
  {
    sink: 8,
    bob: 0,
    lean: -1.35,
    side: 0.1,
    hp: 0.3,
    aL: limb(1.6, 1.4, 0.1),
    aR: limb(1.8, 1.3, 0.2),
    lL: limb(2.1, 0.2, 0.3),
    lR: limb(1.7, 0.25, 0.6),
    toe: 0.3,
    sf: 0.8,
    su: -0.4,
    ss: 0.5,
    sl: 1,
    hb: 0.3,
    hu: -0.8,
  },
  DH2,
);
const DH4 = hp(
  { lL: limb(1.55, 0.25, 0.1), lR: limb(1.45, 0.3, 0.3), hp: 0.45, hu: -0.9, hb: 0 },
  DH3,
);
const DIE: PKey<HP>[] = [
  [0, G],
  [0.06, DH1, easeOut],
  [0.3, DH2],
  [0.44, DH3, easeIn],
  [0.54, DH4, easeOut],
  [0.6, hp({ lL: limb(1.5, 0.25, 0.15), hp: 0.5 }, DH4)],
];
/** Полуоборот на одной ноге перед падением. */
const dieSpin = (t: number) => PI * smooth((t - 0.08) / 0.3);

// ---- поза по анимации и кадру --------------------------------------------------

function hPose(anim: string, f: number): HP {
  const t = tf(f);
  switch (anim) {
    case 'wind':
      return track(t, WIND);
    case 'rec':
      return track(t, REC);
    case 'dive':
      return track(t, DIVE_K);
    case 'pop':
      return track(t, POP_K);
    case 'prec':
      return track(t, PREC_K);
    case 'drop':
      return track(t, DROP_K);
    case 'land':
      return track(t, LAND_K);
    case 'hu': {
      const q = hurtP(G, t) as HP;
      const k = Math.sin(PI * Math.min(1, t / 0.25));
      return { ...q, hb: 0.7 * k, hu: 0.5 * k };
    }
    case 'die':
      return track(t, DIE);
    case 'al': {
      const k = Math.sin(PI * Math.min(1, t / 0.35));
      return hp(
        {
          bob: 1 + 2.6 * k,
          hp: -0.3 * k,
          aL: limb(0.6 * k, 0.15 + 0.6 * k, 0.4),
          aR: limb(0.6 * k, 0.15 + 0.6 * k, 0.5),
          hu: 0.8 * k,
          su: 0.5 + 0.5 * k,
        },
        G,
      );
    }
    case 'walk': {
      // Вприпрыжку: подскок на каждом шаге, колени выше, шлепок у плеча.
      const ph = (f / WALK_N) * TAU;
      const s = Math.sin(ph);
      const g = gaitP(ph, 1.15);
      g.bob = Math.abs(s) * 2.6;
      g.lean = 0.22;
      g.aL = limb(-0.7 * s, 0.35, 0.5);
      g.aR = limb(0.4 + 0.3 * s, 0.25, 0.9);
      return hp({
        ...g,
        sf: 0.5,
        su: 0.8,
        ss: 0,
        hb: 0.35 + 0.25 * Math.sin(2 * ph - 1.2),
        hu: 0.45 * Math.sin(2 * ph - 2.2),
      });
    }
    case 'lost': {
      const q = gropeP((f / 12) * TAU);
      return hp({ ...q, aR: limb(0.8, 0.3, 0.6), sf: 0.8, su: 0.2 });
    }
    case 'wait': {
      // Антракт: курит в кулисах, шлепок опущен.
      const q = dangleP((f / 8) * TAU);
      q.aR = limb(1.4, 0.3, 1.9);
      q.hp = -0.15;
      return hp({ ...q, sf: 0.2, su: -1.6, hu: -0.4 });
    }
    case 'sl1':
    case 'sl0': {
      const q = slumpP(anim === 'sl1' ? 1 : 0.6);
      q.bob += f === 1 || f === 2 ? 0.4 : 0;
      return hp({ ...q, sf: 0.6, su: -1, hu: -0.8 });
    }
  }
  // Покой: пружинит на носках, постукивает шлепком по плечу, кивает в такт.
  const ph = (f / IDLE_N) * TAU;
  const s = Math.sin(ph);
  const q = dangleP(ph);
  return hp({
    ...q,
    bob: 0.9 + 0.6 * Math.sin(2 * ph),
    hy: 0.25 * s,
    aR: limb(0.3 + 0.1 * s, 0.5, 2.2 - 0.15 * s),
    aL: limb(0.1, 0.55, 1.4),
    sf: -1.6,
    su: 0.6 + 0.2 * s,
    ss: 0.4,
    hb: 0.25 * Math.sin(ph - 0.9),
    hu: 0.25 * Math.sin(2 * ph - 1),
  });
}

/** Сколько надо повернуть рисунок сверх стороны (оборот выхода, полуоборот смерти). */
function spinOf(anim: string, f: number): number {
  if (anim === 'pop') return popSpin(tf(f));
  if (anim === 'prec') return popSpin(POP + tf(f));
  if (anim === 'die') return dieSpin(tf(f));
  return 0;
}

// ---- рисунок -----------------------------------------------------------------

const FLOOR_DIR = vnorm(v3(0.75, -0.08, 0.6));
const stickDir = (j: Joints, q: HP): V3 => {
  const d = vnorm(vadd(j.foreR, vadd(vadd(vsc(j.fwd, q.sf), vsc(j.right, q.ss)), v3(0, q.su, 0))));
  const k = q.sl ?? 0;
  return k > 0 ? vnorm(vadd(vsc(d, 1 - k), vsc(FLOOR_DIR, k))) : d;
};

/** Шлепок «батоккио»: чёрная рукоять, две деревянные планки. */
function stick(rig: Rig, hand: V3, dir: V3): void {
  rig.cap(vadd(hand, vsc(dir, -1.2)), vadd(hand, vsc(dir, 1.2)), 0.55, 0.55, P.black);
  rig.cap(vadd(hand, vsc(dir, 1.2)), vadd(hand, vsc(dir, STICK)), 0.75, 1.15, P.wood);
}

function harlRig(q: HP): { rig: Rig; j: Joints } {
  const rig = new Rig();
  const j = humanoid(rig, HARL_BODY, q);
  const R = HARL_BODY.head;
  // Чёрная полумаска, улыбка.
  rig.cap(onHead(j, R, 0.92, -0.45, 0.15), onHead(j, R, 0.92, 0.45, 0.15), 0.9, 0.9, P.black);
  rig.dot(onHead(j, R, 1, -0.35, 0.18), P.gold[3], 1);
  rig.dot(onHead(j, R, 1, 0.35, 0.18), P.gold[3], 1);
  rig.dot(onHead(j, R, 1, 0, -0.45), P.red[2], 1);
  // Колпак с двумя рогами и бубенцами — концы отстают от головы.
  const top = onHead(j, R, 0, 0, 0.8);
  const lag = vadd(vsc(j.hFwd, -q.hb * 1.8), v3(0, q.hu * 1.8, 0));
  for (const s of [-1, 1]) {
    const mid = vadd(vadd(top, vadd(vsc(j.hRight, s * 3.2), vsc(j.hUp, 2.4))), vsc(lag, 0.35));
    const tip = vadd(vadd(mid, vadd(vsc(j.hRight, s * 2), vsc(j.hUp, -2.2))), lag);
    rig.cap(top, mid, 2, 1.2, s < 0 ? P.red : P.black);
    rig.cap(mid, tip, 1.2, 0.6, s < 0 ? P.red : P.black);
    rig.ball(tip, 1.1, P.gold);
  }
  // Воротник-жабо.
  rig.disc(vadd(j.neck, v3(0, -0.6, 0)), 3.4, 0.6, P.porcelain, (u, v) =>
    Math.floor(Math.atan2(v, u) * 3) % 2 ? P.porcelain : P.cream,
  );
  stick(rig, j.haR, stickDir(j, q));
  return { rig, j };
}

/** Шлепок на экране в момент `tt` трека: [внутренний край, конец]. */
function stickAt(
  tt: number,
  keys: (tt: number) => HP,
  yaw: number,
): [number, number, number, number] {
  const q = keys(tt);
  const j = humanoid(new Rig(), HARL_BODY, q);
  const d = stickDir(j, q);
  const Pj = projOf(K, yaw);
  const a = Pj(vadd(j.haR, vsc(d, 2.5)));
  const b = Pj(vadd(j.haR, vsc(d, STICK)));
  return [a[0], a[1], b[0], b[1]];
}
const meleeAt = (tt: number) => (tt < W ? track(tt, WIND) : track(tt - W, REC));
const popAt = (tt: number) => (tt < POP ? track(tt, POP_K) : track(tt - POP, PREC_K));

/** Всё, что ниже кромки люка, — под полом: срезать, по срезу — тёмная кромка. */
function cutFloor(p: Px | null, yc: number, rim: RGBA | null): void {
  if (!p) return;
  const { w, h, data } = p;
  if (yc >= h) return;
  const y0 = Math.max(0, yc);
  data.fill(0, y0 * w * 4, h * w * 4);
  if (!rim || y0 < 1) return;
  for (let x = 0, i = (y0 - 1) * w * 4; x < w; x++, i += 4) if (data[i + 3]) data.set(rim, i);
}

const SMEAR_C = hx('#ffe6c8');
const SPARK_C = hx('#ffffff');
const VELVET: readonly RGBA[] = [P.red[2], hx('#2a1420'), P.gold[2], hx('#c89a5a')];
const RIM = hx('#1a0c08');

const K = kindOf('f13_harlequin', 60, 58, 30, 46, 1500);

const hPic = (anim: string, f: number, d: number): Pic => {
  const q = hPose(anim, f);
  const yaw = yawN(d) + spinOf(anim, f);
  const { rig, j } = harlRig(q);
  return draw(K, rig, yaw, (o, Pj, lit) => {
    // След шлепка: раскрутка удара и контакт; оборот выхода из люка.
    if (anim === 'wind' || anim === 'rec') {
      const ta = anim === 'wind' ? tf(f) : W + tf(f);
      if (ta >= tf(11) && ta <= W + tf(1)) {
        const segs: [number, number, number, number][] = [];
        for (let i = 0; i <= 6; i++) segs.push(stickAt(ta - i / 96, meleeAt, yaw));
        smearInto(lit(), segs, SMEAR_C, ta >= W ? 0.8 : 0.6);
      }
      if (anim === 'rec' && f <= 1) {
        const [x, y] = Pj(vadd(j.haR, vsc(stickDir(j, q), STICK)));
        spark(lit(), x, y, SPARK_C, f === 0 ? 1 : 0.6);
      }
    }
    if (anim === 'pop' || anim === 'prec') {
      const tt = anim === 'pop' ? tf(f) : POP + tf(f);
      if (tt >= tf(16) && tt <= POP + tf(3)) {
        const base = yawN(d);
        const segs: [number, number, number, number][] = [];
        for (let i = 0; i <= 8; i++) {
          const ts = tt - i / 96;
          segs.push(stickAt(ts, popAt, base + popSpin(ts)));
        }
        smearInto(lit(), segs, SMEAR_C, tt >= POP ? 0.8 : 0.55);
      }
      // Щепа из люка, когда выстрелил.
      if (tt >= tf(16) && tt <= POP + tf(4)) {
        const [x, y] = Pj(v3(0, 0, 0));
        puff(o.px, x, y + 2, (tt - tf(15.5)) / 0.28, 41, VELVET, 9, 9);
      }
    }
    if (anim === 'die' && f >= 10 && f <= 17) {
      const [x, y] = Pj(vadd(j.pelvis, v3(0, -j.pelvis.y, 0)));
      puff(o.px, x, y, (f - 9.5) / 8.5, 37, VELVET, 9, 9);
    }
    // Ниже кромки люка — под полом.
    if ((anim === 'dive' && f >= 6) || anim === 'pop') {
      cutFloor(o.px, K.ay + LIP, RIM);
      cutFloor(o.lit, K.ay + LIP, null);
    }
  });
};

// ---- рисовальщик -------------------------------------------------------------

const TECH = new Set(['windup', 'recover', 'stun', 'alert', 'f13_dive', 'f13_pop']);
const TS = 16;

registerMobPainter('f13_harlequin', (m: Mob, pose: MobPose): MobFrame => {
  const md = pose.mode;
  const t = pose.t || 0;
  const now = pose.now || 0;
  const id = m.id ?? 0;
  // Люк, куда нырнёт (рядом брат-люк — прыгает к нему).
  const hx2 = md === 'f13_dive' ? (m.data?.hx2 ?? m.x ?? 0) - (m.x ?? 0) : 0;
  const hy2 = md === 'f13_dive' ? (m.data?.hy2 ?? m.y ?? 0) - (m.y ?? 0) : 0;
  const far = Math.hypot(hx2, hy2) > 0.3;
  const want =
    md === 'f13_dive' && far
      ? Math.atan2(hy2, hx2)
      : TECH.has(md)
        ? (m.face ?? 0)
        : headOf(m);
  const v = visOf(m, pose, want, md === 'windup' ? 6 : 10);
  // В люке разворачивается невидимо — выглядывает уже к герою.
  if (md === 'f13_pop' && t < 0.3) v.yaw = want;
  const d = dirN(v.yaw);
  const fx = Math.cos(v.yaw);
  const fy = Math.sin(v.yaw) * 0.56;
  const ex: Partial<MobFrame> = { shadow: 5 };
  let anim = 'idle';
  let f = 0;
  if (md === 'dying') {
    anim = 'die';
    f = fi(t, DIE_N - 1);
    ex.linger = 0.85;
    ex.alpha = 1 - sstep(0.62, 0.85, t);
    ex.shadow = 5 * (1 - sstep(0.3, 0.7, t));
  } else if (md === 'f13_dive') {
    anim = 'dive';
    f = fi(t, DIVE_N - 1);
    // Подскок «та-дам!» и прыжок к люку; в люке тени нет.
    const leap = smooth((t - 0.06) / 0.16);
    ex.dx = hx2 * TS * leap;
    ex.dy = hy2 * TS * leap - 5 * Math.sin(PI * Math.min(1, Math.max(0, (t - 0.08) / 0.2)));
    ex.shadow = 5 * (1 - sstep(0.18, 0.3, t));
  } else if (md === 'f13_pop') {
    anim = 'pop';
    f = fi(t, POP_N - 1);
    ex.shadow = 5 * sstep(0.62, 0.75, t);
    // Пружина: дрожит перед выстрелом, вытягивается в выстреле.
    if (t >= 0.56 && t < 0.62) ex.dx = (Math.floor(t * 48) % 2 ? 0.5 : -0.5) * fx;
    if (t >= 0.62) {
      const k = sstep(0.62, 0.75, t);
      ex.sx = 1 - 0.08 * k;
      ex.sy = 1 + 0.12 * k;
      ex.dy = -3 * k;
      ex.ghost = { every: 0.04, life: 0.2, tint: '#ff7088', alpha: 0.4 };
    }
  } else if (md === 'recover' && v.prev === 'f13_pop' && t < 0.45) {
    anim = 'prec';
    f = fi(t, PREC_N - 1);
    // Висит звездой и падает; приземление — вжатие.
    const fall = easeIn(t / 0.2);
    ex.dy = -5 * (1 - fall);
    const st = 1 - sstep(0, 0.1, t);
    const land = Math.sin(PI * Math.min(1, Math.max(0, (t - 0.17) / 0.12)));
    ex.sx = (1 - 0.06 * st) * (1 + 0.12 * land);
    ex.sy = (1 + 0.1 * st) * (1 - 0.12 * land);
    if (t < 0.12) ex.ghost = { every: 0.04, life: 0.2, tint: '#ff7088', alpha: 0.4 };
  } else if (md === 'windup') {
    anim = 'wind';
    f = fi(t, WIND_N - 1);
    // Отскок перед ударом, в раскрутке — вперёд.
    const back = sstep(0.06, 0.28, t) * (1 - sstep(0.45, W, t));
    ex.dx = -fx * 1.1 * back;
    ex.dy = -fy * 1.1 * back;
  } else if (md === 'recover' && t < 0.45) {
    anim = 'rec';
    f = fi(t, REC_N - 1);
    const k = 1 - sstep(0, 0.14, t);
    ex.sx = 1 + 0.1 * k;
    ex.sy = 1 - 0.1 * k;
    const lunge = 1.6 * (1 - sstep(0.04, 0.26, t));
    ex.dx = fx * lunge;
    ex.dy = fy * lunge;
  } else if (md === 'drop') {
    anim = 'drop';
    f = fi(t, DROP_N - 1);
  } else if (md === 'stun' && v.prev === 'drop') {
    anim = 'land';
    f = fi(t, LAND_N - 1);
    const k = 1 - sstep(0, 0.14, t);
    ex.sx = 1 + 0.14 * k;
    ex.sy = 1 - 0.14 * k;
  } else if (md === 'stun' || md === 'f13_reel') {
    anim = 'hu';
    f = fi(t, HURT_N - 1);
  } else if (md === 'sleep' || md === 'f13_hush') {
    anim = md === 'sleep' ? 'sl1' : 'sl0';
    f = Math.floor(now * 2 + id) % 4;
  } else if (md === 'f13_lost') {
    anim = 'lost';
    f = Math.floor(now * 5 + id) % 12;
  } else if (md === 'f13_wait') {
    anim = 'wait';
    f = Math.floor(now * 2 + id) % 8;
  } else if (hurtAge(v, now) < 0.3) {
    anim = 'hu';
    f = fi(hurtAge(v, now), HURT_N - 1);
  } else if (md === 'alert') {
    anim = 'al';
    f = fi(t, 8);
  } else if (moving(m, 0.4)) {
    anim = 'walk';
    f = Math.floor((v.dist / STRIDE) * WALK_N) % WALK_N;
  } else {
    f = Math.floor(now * 6 + hash(id, 7) * IDLE_N) % IDLE_N;
  }
  if (md !== 'dying' && md !== 'f13_dive' && md !== 'f13_pop') hurtFx(v, now, 1.3, ex);
  return { ...frameOf(K, anim, f, d, pose, () => hPic(anim, f, d)), ...ex };
});

registerMobWarm('f13_harlequin', function* () {
  yield* warmAll(
    K,
    [
      ['idle', IDLE_N],
      ['walk', WALK_N],
      ['wind', WIND_N],
      ['rec', REC_N],
      ['dive', DIVE_N],
      ['pop', POP_N],
      ['prec', PREC_N],
      ['hu', HURT_N],
      ['die', DIE_N],
      ['al', 9],
      // Выпадают со свода в бою (оркестр), в темноте ищут героя.
      ['drop', DROP_N],
      ['land', LAND_N],
      ['lost', 12],
    ],
    hPic,
  );
});
