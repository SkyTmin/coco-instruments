// Щелкунчик-гвардеец (анимации мобов 13). Облик прежний: деревянный солдатик
// в красном мундире с белой перевязью, синие штаны, чёрный кивер с золотом и
// красным плюмажем, усы и большая челюсть-щипцы с бородой, сабля справа.
//
// Всё — треки 24 к/с от времени режима (`f13-brains.ts`, `f13_nutcracker`):
// - рубка `windup` 0,85 с: сабля с плеча уходит вправо-назад, корпус
//   закручен, челюсть распахнута, левая рука указывает на цель; держит на
//   пике; удар — горизонтальный мах справа налево за три кадра со следом;
//   контакт (первый кадр `recover`) — клинок перед целью и «щёлк» челюсти;
//   проводка за цель, нити тянут вверх, возврат с перелётом;
// - таран: `aim` 1,0 с — «смирно», сабля «подвысь», два строевых притопа,
//   сабля «к атаке» остриём вперёд, присел, роет копытом, дрожит на взводе
//   (последние 0,24 с — блик на острие); `f13_charge` 0,75 с — бег по пути
//   с саблей-штыком, челюсть открыта, плюмаж назад, шлейф; урон — при
//   касании в любом кадре; `recover` после тарана — тормозит каблуками;
//   в стену — `dizzy` 1,3 с: отлетает, кивер набекрень, звёзды кругом,
//   встряхивает головой;
// - смерть: нити рвутся, солдатик вытягивается «смирно» и падает плашмя,
//   как деревянный (весь риг поворачивается вокруг носков), кивер катится.
// Шаг строевой — по пути; сабля «на плече». 8 честных сторон (сабля справа).

import { registerMobPainter, registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import { INK, P, Rig, humanoid, hx, limb, onHead, v3, vadd, vmix, vnorm, vsc } from './f13-art';
import type { Body, Joints, Pose, RGBA, Tone, V3 } from './f13-art';
import {
  PI,
  TAU,
  clamp01,
  crawlP,
  dangleP,
  dirN,
  dizzyP,
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
  puff,
  reelP,
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
import type { PKey, Pic, Proj2 } from './f13-mobkit';

// ---- тело --------------------------------------------------------------------

const NUT_BODY: Body = {
  hip: 10,
  torso: 8.5,
  waist: 3.2,
  chest: 4.2,
  neck: 0.6,
  head: 4.6,
  shW: 4.4,
  upper: 4.6,
  fore: 4.2,
  armR: 1.5,
  hand: 1.5,
  hipW: 2,
  thigh: 5,
  shin: 5,
  legR: 1.6,
  foot: 2.4,
  T: {
    torso: P.red,
    arm: P.red,
    leg: P.blue,
    head: P.cream,
    hand: P.cream,
    foot: P.black,
    joint: P.gold,
    pelvis: P.blue,
  },
  torsoPat: (t, nx) =>
    Math.abs(nx + (t - 0.5) * 1.2) < 0.16 || Math.abs(nx - (t - 0.5) * 1.2) < 0.16
      ? P.cream
      : t < 0.12
        ? P.gold
        : null,
  legPat: (t) => (t >= 0.62 ? P.black : null),
  joints: true,
};

/**
 * Поза щелкунчика: + сабля (поправка к предплечью: вперёд `sf`, вверх `su`,
 * вправо `sr`), челюсть `jw` (0 — сомкнута, 1 — распахнута), плюмаж `pl`
 * (− назад), кивер `hk` (наклон: − набекрень назад), падение `fall` (рад,
 * весь риг вокруг носков), кивер слетел `hat` (0…1).
 */
interface NP extends Pose {
  sf: number;
  su: number;
  sr: number;
  jw: number;
  pl: number;
  hk: number;
  fall: number;
  hat: number;
}
const N0: NP = {
  ...dangleP(0),
  aR: limb(0.15, 0.45, 1.5),
  sf: -1.2,
  su: 1.4,
  sr: 0.9,
  jw: 0,
  pl: 0,
  hk: 0,
  fall: 0,
  hat: 0,
};
const np = (o: Partial<NP>, b: NP = N0): NP => ({ ...b, ...o });

const W = 0.85;
const WIND_N = 21;
const REC_N = 11;
const AIM_N = 24;
const CHG_N = 8;
const CSTRIDE = 2.4;
const SKID_N = 11;
const DZ_N = 24;
const HURT_N = 10;
const DIE_N = 21;
const WALK_N = 12;
const STRIDE = 1.6;
const IDLE_N = 12;
const DROP_N = 14;
const LAND_N = 10;
const SABER = 13;

// ---- рубка -------------------------------------------------------------------

/** «На плече»: сабля торчит вверх у правого плеча. */
const G = np({});
/** Предзамах: сабля снята с плеча вправо-назад, присел, челюсть приоткрыта. */
const A1 = np({
  sink: 0.9,
  bob: 0.6,
  lean: 0.12,
  twist: 0.35,
  hp: -0.15,
  hy: -0.3,
  aR: limb(0.7, 0.9, 0.5),
  aL: limb(0.6, 0.25, 0.4),
  lL: limb(0.25, 0.08, 0.25),
  lR: limb(-0.2, 0.08, 0.35),
  sf: -0.8,
  su: 0.6,
  sr: 0.2,
  jw: 0.35,
  pl: 0.15,
});
/** Взвод: корпус закручен вправо, сабля за плечом, левая — на цель, пасть настежь. */
const A2 = np({
  bob: 1.8,
  sink: 0,
  lean: -0.05,
  twist: 0.75,
  side: -0.06,
  hp: -0.35,
  hy: -0.65,
  aR: limb(1.1, 1.25, 0.7),
  aL: limb(1.35, 0.15, 0.2),
  lL: limb(0.35, 0.1, 0.3),
  lR: limb(-0.3, 0.1, 0.5),
  toe: 0.35,
  sf: -1.0,
  su: 0.9,
  sr: 0.5,
  jw: 1,
  pl: -0.3,
});
/** Пик: дотягивает — нить звенит. */
const A3 = np(
  { twist: 0.84, bob: 2.1, hp: -0.42, hy: -0.72, aR: limb(1.15, 1.32, 0.72), pl: -0.2 },
  A2,
);
/** Контакт: мах справа налево, клинок перед целью, челюсть — щёлк. */
const C = np({
  bob: 0,
  sink: 1.2,
  lean: 0.15,
  twist: -0.6,
  side: 0.05,
  hp: -0.1,
  hy: 0.5,
  aR: limb(1.9, -0.35, 0.05),
  aL: limb(0.2, 0.7, 0.6),
  lL: limb(0.55, 0.1, 0.4),
  lR: limb(-0.5, 0.1, 0.2),
  toe: 0,
  sf: 0.2,
  su: 0,
  sr: -0.6,
  jw: 0,
  pl: 0.4,
});
/** Проводка: клинок ушёл влево за цель. */
const FT = np(
  {
    sink: 1.7,
    lean: 0.25,
    twist: -0.95,
    hp: 0,
    hy: 0.75,
    aR: limb(1.7, -0.85, 0.1),
    sf: -0.3,
    su: -0.2,
    sr: -0.6,
    jw: 0.15,
    pl: 0.7,
  },
  C,
);
/** Отдача: нити тянут вверх, сабля возвращается к плечу. */
const R1 = np({
  bob: 1,
  sink: 0.4,
  lean: 0.15,
  twist: -0.3,
  hp: 0.1,
  hy: 0.25,
  aR: limb(0.9, 0.3, 0.9),
  aL: limb(0.3, 0.3, 0.4),
  lL: limb(0.3, 0.06, 0.3),
  lR: limb(-0.25, 0.06, 0.3),
  sf: 0.3,
  su: 0.8,
  sr: 0,
  jw: 0.35,
  pl: 0.1,
});

const WIND: PKey<NP>[] = [
  [0, G],
  [0.14, A1],
  [0.42, A2, easeOut],
  [0.68, A3, lin],
  [W, C, easeIn],
];
const REC: PKey<NP>[] = [
  [0, C],
  [0.1, FT, easeOut],
  [0.22, R1],
  [0.3, np({ jw: 0 }, R1)],
  [0.44, G, eBack],
];

// ---- таран: прицел, бег, торможение, удар о стену ------------------------------------

/** «Смирно»: пятки вместе, сабля «подвысь» перед лицом. */
const AT = np({
  bob: 1.6,
  hp: -0.1,
  aR: limb(0.9, 0.05, 1.3),
  aL: limb(0, 0.06, 0.08),
  lL: limb(0, 0.03, 0.05),
  lR: limb(0, 0.03, 0.05),
  sf: 0.15,
  su: 2,
  sr: -0.15,
});
const ST1 = np({ lL: limb(1.1, 0.05, 1.4), bob: 1.1, aL: limb(-0.3, 0.06, 0.08) }, AT);
const ST2 = np({ lR: limb(1.1, 0.05, 1.4), bob: 1.1, aL: limb(0.3, 0.06, 0.08) }, AT);
/** «К атаке»: сабля остриём вперёд, присел, левая нога вперёд. */
const LO = np({
  bob: 0,
  sink: 2.2,
  lean: 0.45,
  twist: -0.2,
  hp: -0.45,
  hy: 0.2,
  aR: limb(2.0, 0.1, 0.05),
  aL: limb(-0.5, 0.3, 0.6),
  lL: limb(0.45, 0.08, 0.6),
  lR: limb(-0.55, 0.08, 0.3),
  sf: 1,
  su: 0,
  sr: -0.1,
  jw: 0.6,
  pl: -0.2,
});
const LOS = np({ lR: limb(-0.15, 0.08, 0.9) }, LO);
const LO2 = np({ lean: 0.55, sink: 2.6, jw: 1, hp: -0.55, aR: limb(2.1, 0.1, 0.05) }, LO);
const LO3 = np({ lean: 0.6, sink: 2.8, aR: limb(2.15, 0.1, 0.05) }, LO2);
const AIM: PKey<NP>[] = [
  [0, G],
  [0.06, np({ jw: 0.6 }, AT), easeOut],
  [0.12, AT],
  [0.2, ST1, easeOut],
  [0.27, np({ jw: 0.3 }, AT), easeIn],
  [0.36, ST2, easeOut],
  [0.44, AT, easeIn],
  [0.6, LO],
  [0.67, LOS, easeOut],
  [0.75, LO, easeIn],
  [0.88, LO2],
  [1, LO3, lin],
];

/** Бег тарана: сабля-штык вперёд, пасть открыта, плюмаж назад. */
function chargeP(f: number): NP {
  const ph = (f / CHG_N) * TAU;
  const s = Math.sin(ph);
  const c = Math.cos(ph);
  return np({
    bob: Math.abs(s) * 2.2,
    sink: 1.2,
    lean: 0.6,
    twist: -0.15 + 0.08 * s,
    side: 0.04 * s,
    hp: -0.55,
    hy: 0.15 - 0.08 * s,
    aR: limb(2.17, 0.05, 0),
    aL: limb(-0.4 - 0.7 * s, 0.3, 0.9),
    lL: limb(1.0 * s, 0.08, 0.3 + 1.3 * Math.max(0, -c)),
    lR: limb(-1.0 * s, 0.08, 0.3 + 1.3 * Math.max(0, c)),
    toe: 0.2,
    sf: 1.2,
    su: -0.05,
    sr: -0.1,
    jw: 0.85,
    pl: -0.95,
  });
}

/** Тормозит каблуками: корпус назад, голову бросило вперёд, кивер съехал. */
const SK1 = np({
  bob: 0,
  sink: 2.2,
  lean: -0.35,
  twist: 0.1,
  hp: 0.25,
  aR: limb(1.6, 0.4, 0.2),
  aL: limb(1.0, 1.0, 0.3),
  lL: limb(0.85, 0.1, 0.05),
  lR: limb(-0.1, 0.1, 1.0),
  toe: -0.3,
  sf: 0.4,
  su: 0.6,
  sr: 0,
  jw: 0.9,
  pl: 0.8,
  hk: 0.25,
});
const SK2 = np({ lean: -0.2, sink: 1.6, hp: 0.15, jw: 0.5, pl: 0.3, hk: 0.15 }, SK1);
const SKID: PKey<NP>[] = [
  [0, SK1],
  [0.12, SK2],
  [0.26, np({ bob: 0.7, jw: 0, hk: 0 }, R1)],
  [0.44, G, eBack],
];

/** Отлетел от стены: голова назад, руки вразлёт, кивер набекрень. */
const IM1 = np({
  bob: 1.5,
  lean: -0.55,
  hp: -0.7,
  aL: limb(1.4, 1.2, 0.2),
  aR: limb(1.2, 1.1, 0.3),
  lL: limb(0.4, 0.15, 0.3),
  lR: limb(0.1, 0.15, 0.5),
  toe: 0.5,
  sf: 0.2,
  su: 1,
  sr: 0.3,
  jw: 1,
  pl: 0.6,
  hk: -0.5,
});
const IM2 = np({ bob: 0, sink: 2.4, lean: -0.2, hp: -0.2, toe: 0, jw: 0.8, hk: -0.38 }, IM1);
const IMPACT: PKey<NP>[] = [
  [0, IM1],
  [0.1, IM2, easeOut],
  [0.33, dzP(0), smooth],
];
/** Голова кругом: челюсть отвисла, сабля волочится, кивер набекрень. */
function dzP(ph: number): NP {
  const q = dizzyP(ph);
  return np({
    ...q,
    sink: 0.8,
    aR: limb(0.35, 0.55, 0.2),
    sf: 0.6,
    su: -0.9,
    sr: 0.1,
    jw: 0.65 + 0.15 * Math.sin(ph * 9),
    pl: 0.3 * Math.sin(ph * 7),
    hk: -0.28 + 0.06 * Math.sin(ph * 9),
  });
}
/** Номер уникального кадра «головы кругом» по кадру режима (1,3 с). */
function dzIndex(f: number): number {
  if (f < 8) return f;
  if (f < 28) return 8 + ((f - 8) % 12);
  return 20 + Math.min(3, f - 28);
}
function dzPose(u: number): NP {
  if (u < 8) return track(tf(u), IMPACT);
  if (u < 20) return dzP(1 / 3 + ((u - 8) / 12) * ((TAU * 2) / 7));
  // Встряхнул головой — кивер на место, челюсть щёлк.
  const k = (u - 19) / 4;
  const b = dzP(1 / 3);
  return np(
    {
      ...track(k, [
        [0, b],
        [1, G, eBack],
      ] as PKey<NP>[]),
      hy: 0.6 * Math.sin(k * PI * 3) * (1 - k),
    },
    G,
  );
}

// ---- выпал с вешалки (гардероб) и приземлился ------------------------------------

const DR1 = np({
  bob: 2,
  hp: -0.4,
  aL: limb(2.6, 0.5, 0.3),
  aR: limb(2.4, 0.6, 0.4),
  lL: limb(0.1, 0.04, 0.1),
  lR: limb(-0.05, 0.04, 0.1),
  toe: 0.7,
  sf: 0.2,
  su: 1.2,
  sr: 0.4,
  jw: 1,
  pl: 0.8,
});
const DR2 = np({ aL: limb(1.8, 1.1, 0.3), aR: limb(1.7, 1.2, 0.4), hp: -0.2, pl: 0.5 }, DR1);
const DR3 = np({ lL: limb(0.6, 0.12, 1.1), lR: limb(0.5, 0.12, 1.0), toe: 0.2, jw: 0.6 }, DR2);
const DROP: PKey<NP>[] = [
  [0, DR1],
  [0.3, DR2],
  [0.5, DR3],
];
const LD1 = np({
  bob: 0,
  sink: 3.6,
  lean: 0.35,
  hp: 0.3,
  aL: limb(0.6, 0.9, 0.4),
  aR: limb(0.7, 1.0, 0.6),
  lL: limb(0.7, 0.2, 1.4),
  lR: limb(0.6, 0.2, 1.3),
  toe: 0,
  sf: 0.4,
  su: 0.4,
  sr: 0.4,
  jw: 0,
  pl: 0.7,
  hk: 0.35,
});
const LAND: PKey<NP>[] = [
  [0, DR3],
  [0.04, LD1, easeOut],
  [0.14, np({ sink: 2.6, hk: 0.45, pl: 0.2 }, LD1)],
  [0.26, np({ bob: 1.6, sink: 0, jw: 0.5, hk: 0 }, AT), easeOut],
  [0.4, G, eBack],
];

// ---- смерть: нити лопнули — вытянулся «смирно» и упал плашмя ---------------------

const D1 = np({
  bob: 3.2,
  hp: -0.5,
  lean: -0.25,
  aL: limb(2.0, 0.6, 0.2),
  aR: limb(2.2, 0.7, 0.3),
  lL: limb(0.3, 0.15, 0.4),
  lR: limb(-0.2, 0.12, 0.3),
  toe: 0.6,
  sf: 0.3,
  su: 1,
  sr: 0.3,
  jw: 1,
  pl: -0.4,
});
const D2 = np({
  bob: 0,
  sink: 0.4,
  hp: 0,
  aL: limb(0, 0.08, 0),
  aR: limb(0, 0.1, 0.05),
  lL: limb(0, 0.03, 0),
  lR: limb(0, 0.03, 0),
  sf: 0.15,
  su: -1,
  sr: 0,
  jw: 1,
  pl: 0.2,
});
const FALL_END = PI / 2;
const DIE: PKey<NP>[] = [
  [0, G],
  [0.07, D1, easeOut],
  [0.22, D2, easeIn],
  [0.55, np({ fall: FALL_END, pl: 0.9, hat: 0.5 }, D2), easeIn],
  [0.6, np({ fall: FALL_END - 0.16, pl: 0.5, hat: 0.75 }, D2), easeOut],
  [0.66, np({ fall: FALL_END, pl: 0.7, hat: 0.95, jw: 0.7 }, D2), easeIn],
  [0.85, np({ fall: FALL_END, pl: 0.7, hat: 1, jw: 0.7 }, D2)],
];

// ---- поза по анимации и кадру ----------------------------------------------------

function marchP(f: number): NP {
  const ph = (f / WALK_N) * TAU;
  const s = Math.sin(ph);
  const c = Math.cos(ph);
  const g = gaitP(ph, 1.1);
  // Строевой: колено выше, левая рука — по струнке, сабля на плече.
  g.lean = 0.05;
  g.lL = limb(0.7 * s, 0.05, 0.15 + 0.85 * Math.max(0, -c));
  g.lR = limb(-0.7 * s, 0.05, 0.15 + 0.85 * Math.max(0, c));
  g.aL = limb(-0.55 * s, 0.1, 0.08);
  g.aR = N0.aR;
  return np({ ...g, pl: -0.15 * Math.abs(s) });
}

function nPose(anim: string, f: number): NP {
  const t = tf(f);
  switch (anim) {
    case 'wind':
      return track(t, WIND);
    case 'rec':
      return track(t, REC);
    case 'aim':
      return track(t, AIM);
    case 'chg':
      return chargeP(f);
    case 'skid':
      return track(t, SKID);
    case 'dz':
      return dzPose(f);
    case 'hu': {
      const b = hurtP(G, t) as NP;
      const k = Math.sin(PI * clamp01(t / 0.25));
      return np(
        {
          jw: 0.7 * k,
          hk: -0.25 * k,
          pl: 0.5 * k,
          sf: -1.2 + 0.8 * k,
          su: 1.4 - 0.4 * k,
          sr: 0.9 - 0.6 * k,
        },
        b,
      );
    }
    case 'die':
      return track(t, DIE);
    case 'drop':
      return track(t, DROP);
    case 'land':
      return track(t, LAND);
    case 'reel': {
      const k = Math.sin(clamp01(t / 0.6) * PI);
      return np({
        ...reelP(t),
        aR: limb(0.6 * k + 0.4, 1.1 * k + 0.2, 0.6),
        sf: 0.3,
        su: 1,
        sr: 0.4,
        jw: k,
        hk: -0.3 * k,
        pl: 0.5 * Math.sin(t * 13),
      });
    }
    case 'al': {
      const k = Math.sin(PI * Math.min(1, t / 0.35));
      return np({
        ...AT,
        bob: 1 + 2 * k,
        hp: -0.25 * k,
        aR: limb(0.15 + 0.75 * k, 0.45 - 0.4 * k, 1.5 - 0.2 * k),
        sf: -1.2 + 1.35 * k,
        sr: 0.9 - 1.05 * k,
        su: 1.4 + 0.6 * k,
        jw: t < 0.12 ? 0.8 * Math.sin(PI * (t / 0.12)) : 0,
        pl: -0.3 * k,
      });
    }
    case 'walk':
      return marchP(f);
    case 'crawl': {
      const q = crawlP((f / 8) * TAU);
      return np({ ...q, sf: 0.8, su: -0.6, sr: 0.2, jw: 0.5, hk: 0.2 });
    }
    case 'lost': {
      const q = gropeP((f / 12) * TAU);
      // Ощупью: сабля вперёд, челюсть клацает.
      return np({
        ...q,
        aR: limb(1.4, 0.15, 0.15),
        sf: 1,
        su: 0,
        sr: 0,
        jw: f % 6 < 2 ? 0.6 : 0,
      });
    }
    case 'wait': {
      // Колет орех: левая рука ко рту, челюсть — щёлк.
      const q = dangleP((f / 8) * TAU);
      q.aL = limb(1.3, 0.3, 1.6);
      q.hp = 0.05;
      return np({ ...q, aR: N0.aR, jw: f === 2 || f === 3 ? 0.8 : 0 });
    }
    case 'sl1':
    case 'sl0': {
      const q = slumpP(anim === 'sl1' ? 1 : 0.6);
      q.bob += f === 1 || f === 2 ? 0.4 : 0;
      return np({ ...q, aR: limb(0.1, 0.15, 0.2), sf: 0.4, su: -1, sr: 0, jw: 0.45 });
    }
  }
  // Покой: покачивается на нитях, сабля на плече, изредка клацает челюстью.
  const q = dangleP((f / IDLE_N) * TAU);
  return np({
    ...q,
    aR: N0.aR,
    jw: f === 8 ? 0.7 : f === 9 ? 0.25 : 0,
    pl: 0.1 * Math.sin((f / IDLE_N) * TAU - 1),
  });
}

// ---- рисунок -------------------------------------------------------------------------

const WHITE = hx('#ffffff');
const GOLD_BAND: (t: number) => Tone | null = (t) => (t <= 0.18 ? P.gold : null);

const saberDir = (j: Joints, q: NP): V3 =>
  vnorm(vadd(vadd(j.foreR, vsc(j.fwd, q.sf)), vadd(vsc(j.up, q.su), vsc(j.right, q.sr))));

function saber(rig: Rig, hand: V3, dir: V3): void {
  const tip = vadd(hand, vsc(dir, SABER));
  const guardA = vadd(hand, vsc(dir, 1.2));
  rig.cap(vadd(hand, vsc(dir, -1.6)), hand, 0.55, 0.55, P.brass);
  rig.cap(guardA, tip, 0.85, 0.3, P.silver);
  const side = vnorm(v3(-dir.z, 0, dir.x));
  rig.cap(vadd(guardA, vsc(side, -1.4)), vadd(guardA, vsc(side, 1.4)), 0.5, 0.5, P.gold);
}

/** Кивер: чёрный цилиндр с золотым околышем, кокардой и плюмажем. */
function shako(rig: Rig, b: V3, top: V3, fwd: V3, pl: number): void {
  const up = vnorm(vadd(top, vsc(b, -1)));
  rig.cap(b, top, 3.6, 3.9, P.black, GOLD_BAND);
  rig.ball(vadd(top, vsc(fwd, 2.6)), 1.2, P.gold);
  const tipP = vadd(top, vadd(vsc(up, 3 - Math.abs(pl) * 0.9), vsc(fwd, -1 + pl * 2.6)));
  rig.cap(top, tipP, 1.4, 0.6, P.red);
}

/** Где кивер на голове: основание, верх, «вперёд» (с наклоном `hk`). */
function hatOn(j: Joints, q: NP): [V3, V3, V3] {
  const R = NUT_BODY.head;
  const c = Math.cos(q.hk);
  const s = Math.sin(q.hk);
  const up = vadd(vsc(j.hUp, c), vsc(j.hFwd, s));
  const fwd = vadd(vsc(j.hFwd, c), vsc(j.hUp, -s));
  const b = vadd(onHead(j, R, -0.05, 0, 0.75), vsc(j.hFwd, q.hk * 1.4));
  return [b, vadd(b, vsc(up, 7)), fwd];
}

/** Поворот всего рига: падение вперёд вокруг носков (ось «вправо» модели). */
type Pts = { a?: V3; b?: V3; c?: V3; p?: V3[] };
function toppler(a: number): (v: V3) => V3 {
  const zp = 2 + 2.6 * Math.min(1, a / FALL_END);
  const c = Math.cos(a);
  const s = Math.sin(a);
  return (v) => {
    const z = v.z - zp;
    return v3(v.x, v.y * c - z * s, zp + z * c + v.y * s);
  };
}
function topple(rig: Rig, a: number): void {
  const rot = toppler(a);
  for (const p of rig.prims as unknown as Pts[]) {
    if (p.a) p.a = rot(p.a);
    if (p.b) p.b = rot(p.b);
    if (p.c) p.c = rot(p.c);
    if (p.p) p.p = p.p.map(rot);
  }
}

function nutRig(q: NP): { rig: Rig; j: Joints } {
  const rig = new Rig();
  const j = humanoid(rig, NUT_BODY, q);
  const R = NUT_BODY.head;
  // Лицо: глаза с бликом, усы, челюсть-щипцы с бородой (опускается вниз-назад).
  rig.dot(onHead(j, R, 0.92, -0.38, 0.2), INK, 1);
  rig.dot(onHead(j, R, 0.92, 0.38, 0.2), INK, 1);
  rig.dot(onHead(j, R, 0.95, -0.38, 0.32), WHITE, 1);
  rig.cap(onHead(j, R, 1, -0.5, -0.12), onHead(j, R, 1, 0.5, -0.12), 0.8, 0.8, P.black);
  const o = q.jw;
  if (o > 0.12) {
    // Пасть: темнота и зубы.
    rig.dot(onHead(j, R, 1.0, 0, -0.38 - o * 0.22), INK, o > 0.5 ? 2 : 1);
    if (o > 0.4) {
      rig.dot(onHead(j, R, 1.03, -0.22, -0.3), WHITE, 1);
      rig.dot(onHead(j, R, 1.03, 0.22, -0.3), WHITE, 1);
    }
  }
  const jawA = vadd(onHead(j, R, 0.55 + o * 0.08, 0, -0.55), vsc(j.hUp, -o * 2.4));
  rig.cap(vadd(jawA, vsc(j.hRight, -2.5)), vadd(jawA, vsc(j.hRight, 2.5)), 2.2, 2.2, P.cream);
  rig.cap(vadd(jawA, vsc(j.hUp, -1.6)), vadd(jawA, vsc(j.hUp, -4)), 2.2, 0.8, P.porcelain);
  // Эполеты и пуговицы.
  rig.disc(vadd(j.shL, v3(0, 0.8, 0)), 2.2, 0.8, P.gold);
  rig.disc(vadd(j.shR, v3(0, 0.8, 0)), 2.2, 0.8, P.gold);
  for (let k = 0; k < 3; k++)
    rig.dot(
      vadd(vmix(j.pelvis, j.chest, 0.3 + k * 0.25), vsc(j.fwd, NUT_BODY.chest * 0.95)),
      P.gold[3],
      1,
    );
  saber(rig, j.haR, saberDir(j, q));
  const [hb, ht, hf] = hatOn(j, q);
  if (q.hat <= 0) shako(rig, hb, ht, hf, q.pl);
  if (q.fall) topple(rig, q.fall);
  if (q.hat > 0) {
    // Кивер слетел и катится вперёд, ложится набок.
    const rot = toppler(q.fall);
    const k = smooth(q.hat);
    const hop = 5 * Math.sin(PI * Math.min(1, q.hat * 1.2));
    const lb = v3(-3.5, 3.7, 31);
    const lt = v3(3.5, 3.7, 31);
    const b = vadd(vmix(rot(hb), lb, k), v3(0, hop, 0));
    const t = vadd(vmix(rot(ht), lt, k), v3(0, hop, 0));
    shako(rig, b, t, vnorm(vmix(rot(vadd(hb, hf)), v3(0, 1, 0), k)), q.pl * (1 - k));
  }
  return { rig, j };
}

/** Клинок на экране в момент `ta` от начала замаха: [внутренний край, конец]. */
function bladeAt(ta: number, Pj: Proj2): [number, number, number, number] {
  const q = ta < W ? track(ta, WIND) : track(ta - W, REC);
  const j = humanoid(new Rig(), NUT_BODY, q);
  const d = saberDir(j, q);
  const a = Pj(vadd(j.haR, vsc(d, 3)));
  const b = Pj(vadd(j.haR, vsc(d, SABER)));
  return [a[0], a[1], b[0], b[1]];
}

const SMEAR_C = hx('#fff2cc');
const SPARK_C = hx('#ffffff');
const STAR_C = hx('#ffe060');
const DUST: readonly RGBA[] = [hx('#c89a5a'), hx('#f0d8a0'), hx('#5a3a1c'), P.silver[2]];

const K = kindOf('f13_nutcracker', 88, 84, 44, 58, 1900);

/** Точка пола под ступнёй. */
const footAt = (Pj: Proj2, an: V3): [number, number] => Pj(v3(an.x, 0, an.z));

const nPic = (anim: string, f: number, d: number): Pic => {
  const q = nPose(anim, f);
  const yaw = yawN(d);
  const { rig, j } = nutRig(q);
  return draw(K, rig, yaw, (o, Pj, lit) => {
    // След сабли: три кадра маха и контакт.
    const ta = anim === 'wind' ? tf(f) : anim === 'rec' ? W + tf(f) : -1;
    if (ta >= tf(18) && ta <= W + 1e-6) {
      const segs: [number, number, number, number][] = [];
      for (let i = 0; i <= 4; i++) segs.push(bladeAt(ta - i / 120, Pj));
      smearInto(lit(), segs, SMEAR_C, ta >= W ? 0.8 : 0.6);
    }
    const tip = vadd(j.haR, vsc(saberDir(j, q), SABER));
    if (anim === 'rec' && f <= 1) {
      // Контакт: искра на клинке и «щёлк» челюсти.
      const [x, y] = Pj(tip);
      spark(lit(), x, y, SPARK_C, f === 0 ? 1 : 0.6);
      const [mx, my] = Pj(onHead(j, NUT_BODY.head, 1.05, 0, -0.45));
      spark(lit(), mx, my, STAR_C, f === 0 ? 0.9 : 0.5);
    }
    if (anim === 'wind' && f >= 12 && f <= 16 && f % 2 === 0) {
      // Держит на пике: блик бежит по клинку.
      const [x, y] = Pj(vadd(j.haR, vsc(saberDir(j, q), 6 + (f - 12) * 1.6)));
      spark(lit(), x, y, SPARK_C, 0.7);
    }
    if (anim === 'aim') {
      if (f >= 18) {
        // На взводе: блик на острие пульсирует.
        const [x, y] = Pj(tip);
        spark(lit(), x, y, SPARK_C, f % 2 ? 0.55 : 1);
      }
      if (f >= 6 && f <= 9) {
        const [x, y] = footAt(Pj, j.anL);
        puff(o.px, x, y, (f - 5.5) / 4.5, 41, DUST, 5, 4);
      }
      if (f >= 10 && f <= 13) {
        const [x, y] = footAt(Pj, j.anR);
        puff(o.px, x, y, (f - 9.5) / 4.5, 43, DUST, 5, 4);
      }
      if (f >= 16 && f <= 19) {
        const [x, y] = footAt(Pj, j.anR);
        puff(o.px, x, y, (f - 15.5) / 4.5, 47, DUST, 6, 5);
      }
    }
    if (anim === 'chg' && (f % 4 === 1 || f % 4 === 2)) {
      // Пыль из-под толчковой ноги.
      const [x, y] = footAt(Pj, f < 4 ? j.anR : j.anL);
      puff(o.px, x, y, (f % 4) / 3, 53 + f, DUST, 5, 4);
    }
    if (anim === 'skid' && f <= 7) {
      const [x, y] = footAt(Pj, j.anL);
      puff(o.px, x, y, (f + 0.5) / 8, 59, DUST, 9, 8);
    }
    if (anim === 'dz') {
      if (f <= 1) {
        // Лбом о стену: искры перед кивером.
        const [x, y] = Pj(vadd(onHead(j, NUT_BODY.head, 1.2, 0, 0.9), vsc(j.fwd, 1.5)));
        spark(lit(), x, y, SPARK_C, f === 0 ? 1 : 0.6);
        spark(lit(), x + 3, y - 2, STAR_C, f === 0 ? 0.8 : 0.4);
      } else if (f >= 6 && f <= 21) {
        // Звёзды кругом над кивером.
        const [hb, ht] = hatOn(j, q);
        const c = Pj(vadd(ht, vsc(vnorm(vadd(ht, vsc(hb, -1))), 1.5)));
        const a0 = ((f - 6) / 12) * TAU;
        const k = f < 8 ? (f - 5) / 3 : f > 19 ? (22 - f) / 3 : 1;
        for (let i = 0; i < 3; i++) {
          const a = a0 + (i * TAU) / 3;
          spark(lit(), c[0] + Math.cos(a) * 6, c[1] + Math.sin(a) * 2.2, STAR_C, 0.9 * k);
        }
      }
    }
    if (anim === 'land' && f <= 5) {
      const [x, y] = Pj(v3(0, 0, 0));
      puff(o.px, x, y, (f + 0.5) / 6, 61, DUST, 9, 8);
    }
    if (anim === 'die' && f >= 13 && f <= 19) {
      // Плашмя о сцену: пыль вдоль тела.
      const rot = toppler(FALL_END);
      for (const [zz, s] of [
        [12, 67],
        [24, 71],
      ] as const) {
        const p = rot(v3(0, zz, 0));
        const [x, y] = Pj(v3(p.x, 0, p.z));
        puff(o.px, x, y, (f - 12.5) / 7.5, s, DUST, 6, 7);
      }
    }
  });
};

// ---- рисовальщик -----------------------------------------------------------------------

const TECH = new Set(['windup', 'recover', 'stun', 'alert', 'aim', 'f13_charge', 'dizzy', 'drop']);
const GHOST = { every: 0.035, life: 0.16, tint: '#ff4a3a', alpha: 0.35 };

registerMobPainter('f13_nutcracker', (m: Mob, pose: MobPose): MobFrame => {
  const md = pose.mode;
  const t = pose.t || 0;
  const now = pose.now || 0;
  const id = m.id ?? 0;
  const crawl = !!m.data?.crawl;
  const want = TECH.has(md) && !crawl ? (m.face ?? 0) : headOf(m);
  const v = visOf(m, pose, want, md === 'windup' ? 6 : md === 'f13_charge' ? 14 : 10);
  const d = dirN(v.yaw);
  const fx = Math.cos(v.yaw);
  const fy = Math.sin(v.yaw) * 0.56;
  const ex: Partial<MobFrame> = { shadow: 8 };
  let anim = 'idle';
  let f = 0;
  if (md === 'dying') {
    anim = 'die';
    f = fi(t, DIE_N - 1);
    ex.linger = 0.85;
    ex.alpha = 1 - sstep(0.66, 0.85, t);
    ex.shadow = 8 * (1 - sstep(0.25, 0.5, t));
    // Удар о сцену плашмя.
    const k = Math.sin(PI * clamp01((t - 0.55) / 0.1));
    ex.sy = 1 - 0.08 * k;
    ex.sx = 1 + 0.05 * k;
  } else if (crawl) {
    anim = 'crawl';
    f = Math.floor((v.dist / 0.6) * 8) % 8;
  } else if (md === 'windup') {
    anim = 'wind';
    f = fi(t, WIND_N - 1);
    // Перед махом отклоняется назад, в махе — вперёд; на пике дрожит.
    const back = sstep(0.14, 0.42, t) * (1 - sstep(0.68, W, t));
    const tr = t >= 0.5 && t < 0.68 ? (Math.floor(t * 24) % 2 ? 0.35 : -0.35) : 0;
    ex.dx = -fx * 0.9 * back + tr * fy;
    ex.dy = -fy * 0.9 * back;
  } else if (md === 'recover' && v.prev === 'f13_charge' && t < 0.45) {
    anim = 'skid';
    f = fi(t, SKID_N - 1);
    const k = 1 - sstep(0, 0.12, t);
    ex.sx = 1 + 0.08 * k;
    ex.sy = 1 - 0.08 * k;
    if (t < 0.1) ex.ghost = GHOST;
  } else if (md === 'recover' && t < 0.45) {
    anim = 'rec';
    f = fi(t, REC_N - 1);
    // Вес: мах тянет вперёд — вжатие и выпад, потом обратно.
    const k = 1 - sstep(0, 0.16, t);
    ex.sx = 1 + 0.1 * k;
    ex.sy = 1 - 0.1 * k;
    const lunge = 1.6 * (1 - sstep(0.04, 0.3, t));
    ex.dx = fx * lunge;
    ex.dy = fy * lunge;
  } else if (md === 'aim') {
    anim = 'aim';
    f = fi(t, AIM_N - 1);
    // Притопы — вжатие; на взводе — дрожь поперёк хода.
    const st = Math.max(
      Math.sin(PI * clamp01((t - 0.25) / 0.08)),
      Math.sin(PI * clamp01((t - 0.42) / 0.08)),
    );
    ex.sx = 1 + 0.06 * st;
    ex.sy = 1 - 0.06 * st;
    if (t >= 0.76) {
      const tr = Math.floor(now * 30) % 2 ? 0.4 : -0.4;
      ex.dx = -Math.sin(v.yaw) * tr;
      ex.dy = Math.cos(v.yaw) * 0.56 * tr;
    }
  } else if (md === 'f13_charge') {
    anim = 'chg';
    f = Math.floor((v.dist / CSTRIDE) * CHG_N) % CHG_N;
    ex.ghost = GHOST;
    // Рывок с места: вытянулся вперёд.
    const k = 1 - sstep(0, 0.12, t);
    ex.sx = 1 - 0.06 * k;
    ex.sy = 1 + 0.06 * k;
  } else if (md === 'dizzy') {
    anim = 'dz';
    f = dzIndex(fi(t, 31));
    // Отскок от стены и приземление на каблуки.
    const back = 2.4 * Math.sin(PI * clamp01(t / 0.3));
    ex.dx = -fx * back;
    ex.dy = -fy * back;
    const land = Math.sin(PI * clamp01((t - 0.08) / 0.14));
    ex.sx = 1 + 0.1 * land;
    ex.sy = 1 - 0.1 * land;
  } else if (md === 'drop') {
    anim = 'drop';
    f = fi(t, DROP_N - 1);
  } else if (md === 'stun' && v.prev === 'drop') {
    anim = 'land';
    f = fi(t, LAND_N - 1);
    const k = 1 - sstep(0, 0.14, t);
    ex.sx = 1 + 0.14 * k;
    ex.sy = 1 - 0.14 * k;
  } else if (md === 'stun') {
    anim = 'hu';
    f = fi(t, HURT_N - 1);
  } else if (md === 'f13_reel') {
    anim = 'reel';
    f = fi(t, 14);
  } else if (md === 'sleep' || md === 'f13_hush') {
    anim = md === 'sleep' ? 'sl1' : 'sl0';
    f = Math.floor(now * 2 + id) % 4;
  } else if (md === 'f13_lost') {
    anim = 'lost';
    f = Math.floor(now * 5 + id) % 12;
  } else if (md === 'f13_wait') {
    anim = 'wait';
    f = Math.floor(now * 2 + id) % 8;
  } else if (hurtAge(v, now) < HURT_N / 24) {
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
  if (md !== 'dying' && md !== 'f13_charge') hurtFx(v, now, 1, ex);
  return { ...frameOf(K, anim, f, d, pose, () => nPic(anim, f, d)), ...ex };
});

registerMobWarm('f13_nutcracker', function* () {
  yield* warmAll(
    K,
    [
      ['idle', IDLE_N],
      ['walk', WALK_N],
      ['wind', WIND_N],
      ['rec', REC_N],
      ['aim', AIM_N],
      ['chg', CHG_N],
      ['skid', SKID_N],
      ['dz', DZ_N],
      ['hu', HURT_N],
      ['die', DIE_N],
      ['reel', 15],
      ['al', 9],
      // Нити срезаны в бою — ползёт; в темноте — ищет героя.
      ['crawl', 8],
      ['lost', 12],
    ],
    nPic,
  );
  // Гардероб: падает с вешалки лицом на восток (`face` 0 у нового моба).
  yield* warmAll(
    K,
    [
      ['drop', DROP_N],
      ['land', LAND_N],
    ],
    nPic,
    [0],
  );
});
