// Скрипач (анимации мобов 13). Облик прежний: кукла в зелёном фраке,
// светлый парик, скрипка у левого плеча, смычок в правой; одна нить.
// Добавлены косица с бантом и фалды фрака — отстают от тела.
//
// Треки 24 к/с от времени режима (`f13-brains.ts` `rangedStep`, `melee`):
// - `aim` 0,7 с — три ноты: устраивает скрипку (подбородок вниз, смычок
//   над струнами), пилит всё быстрее (2,5 → 8 взмахов в секунду), корпус
//   раскачивается; в конце сжимается у колодки — и последним кадром
//   начинает бросок. Ноты вылетают в конце `aim` — кадр выстрела — первый
//   кадр `recover` (`arec`): смычок брошен вверх-вправо, голова запрокинута;
// - ближний удар `windup` 0,7 с — смычок как шпага: салют (скрипка вниз),
//   стойка «ан гард» со скрипкой над головой, взвод назад, держит; выпад —
//   три кадра; кадр контакта — первый кадр `recover`: полный выпад, след и
//   искра на острие; проводка, возврат, скрипка снова к подбородку;
// - ходит по пути (отход и обход героя — тоже лицом по ходу) и играет на
//   ходу, покой — тихо играет, фаза от номера;
// - `drop` — висит на нити, `stun` после него — приземление с вжатием;
// - смерть — нить лопнула: рывок вверх, ноги подломились, сел и упал
//   ничком; скрипка и смычок падают на пол.

import { registerMobPainter, registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import {
  FIDDLE_BODY,
  INK,
  P,
  Rig,
  humanoid,
  hx,
  limb,
  onHead,
  v3,
  vadd,
  vmix,
  vnorm,
  vsc,
} from './f13-art';
import type { Joints, Limb, Pose, RGBA, Tone, V3 } from './f13-art';
import {
  PI,
  TAU,
  clamp,
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
  lerp,
  moving,
  projOf,
  puff,
  slumpP,
  smearInto,
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
 * Поза скрипача: скрипка у подбородка `vc` (1) или в левой руке за гриф (0),
 * лежит на полу `vf`; смычок на струнах `bw` (1) или свободно — поправка к
 * предплечью (вперёд `bf`, вверх `bu`, вправо `bs`), лежит на полу `bl`;
 * косица `wb` (+ отстаёт назад) / `wu` (+ взлетает), фалды `ct` (+ назад).
 */
interface FP extends Pose {
  vc: number;
  vf?: number;
  bw: number;
  bf: number;
  bu: number;
  bs: number;
  bl?: number;
  wb: number;
  wu: number;
  ct: number;
}

const F0: FP = {
  ...dangleP(0),
  vc: 1,
  bw: 1,
  bf: 0,
  bu: 0,
  bs: 0,
  wb: 0,
  wu: 0,
  ct: 0,
};
const fp = (o: Partial<FP>, b: FP = F0): FP => ({ ...b, ...o });

const W = 0.7;
const AIM = 0.7;
const AIM_N = 17;
const AREC_N = 11;
const WIND_N = 17;
const REC_N = 11;
const DROP_N = 14;
const LAND_N = 5;
const HURT_N = 8;
const DIE_N = 21;
const WALK_N = 12;
const STRIDE = 1.5;
const IDLE_N = 12;
/** Длина скрипки (хвост → завиток) и смычка. */
const VL = 8.4;
const BOW = 10;

// ---- смычок на струнах ----------------------------------------------------------

/** Правая рука: у колодки (k = 0, рука у скрипки) … у острия (k = 1, рука отведена). */
const BOW_IN = limb(1.55, -0.62, 0.7);
const BOW_OUT = limb(1.1, 0.55, 0.2);
const bowK = (k: number): Limb =>
  limb(
    lerp(BOW_IN.sw, BOW_OUT.sw, k),
    lerp(BOW_IN.out, BOW_OUT.out, k),
    lerp(BOW_IN.bend, BOW_OUT.bend, k),
  );
const mixL = (a: Limb, b: Limb, k: number): Limb =>
  limb(lerp(a.sw, b.sw, k), lerp(a.out, b.out, k), lerp(a.bend, b.bend, k));

// ---- игра --------------------------------------------------------------------

/** Играет: скрипка у подбородка, голова склонена к ней, смычок посередине. */
const G = fp({
  bob: 1,
  lean: 0.06,
  hp: 0.18,
  hy: -0.22,
  hr: 0.22,
  aL: limb(1.5, 0.36, 0.25),
  aR: bowK(0.5),
  lL: limb(0.1, 0.08, 0.15),
  lR: limb(-0.1, 0.1, 0.12),
});

// ---- три ноты: устроился, пилит, сжался, бросок ----------------------------------

/** Устроился: подбородок вниз, смычок поднят над струнами — замах. */
const S1 = fp(
  {
    lean: 0.16,
    sink: 0.8,
    hp: 0.32,
    hr: 0.28,
    bw: 0.45,
    aR: limb(1.75, 0.15, 0.9),
    bu: 1.2,
    bs: 0.3,
    wb: 0.25,
    ct: 0.2,
  },
  G,
);
/** Смычок лёг на струны у колодки — сейчас начнёт. */
const S2 = fp({ lean: 0.2, sink: 1, hp: 0.3, hr: 0.25, aR: bowK(0), wb: 0, ct: 0 }, G);
/** Сжался у колодки перед броском: корпус в скрипку, колени. */
const TK = fp(
  {
    lean: 0.28,
    sink: 1.6,
    twist: -0.18,
    hp: 0.4,
    hr: 0.32,
    aR: limb(1.6, -0.62, 0.8),
    wb: -0.2,
    ct: -0.15,
  },
  S2,
);
/** Выстрел: смычок брошен вверх-вправо, голова запрокинута, на носках. */
const FL = fp(
  {
    bob: 2.2,
    sink: 0,
    lean: -0.2,
    twist: 0.15,
    hp: -0.38,
    hy: -0.08,
    hr: 0.1,
    aR: limb(2.3, 0.85, 0.15),
    bw: 0,
    bf: 0.3,
    bu: 1.2,
    bs: 0.8,
    lL: limb(0.45, 0.1, 0.7),
    lR: limb(-0.12, 0.1, 0.1),
    toe: 0.35,
    wb: 0.6,
    wu: 0.55,
    ct: 0.5,
  },
  G,
);
const FL2 = fp(
  { aR: limb(2.45, 0.92, 0.1), hp: -0.42, bob: 1.8, bu: 1.4, wb: 0.2, wu: 0.2, ct: -0.2 },
  FL,
);
const FR1 = fp(
  { aR: bowK(0.8), bw: 0.55, bu: 0.4, bs: 0.3, lean: 0, hp: 0.08, bob: 1.2, wb: -0.2, ct: -0.1 },
  G,
);

const AIM_K: PKey<FP>[] = [
  [0, G],
  [0.1, S1, easeOut],
  [0.16, S2, easeIn],
  [0.54, S2],
  [0.6, TK, easeOut],
  [0.645, TK],
  [AIM + 0.001, FL, easeIn],
];
const AREC_K: PKey<FP>[] = [
  [0, FL],
  [0.1, FL2, easeOut],
  [0.22, FR1],
  [0.42, G, eBack],
];

/** Пилит: фаза взмахов (ускоряется 2,5 → 8 Гц) и вес пилки в позе. */
const SAW0 = 0.14;
const SAW1 = 0.58;
function sawOf(t: number): [number, number] {
  const u = clamp(t - SAW0, 0, SAW1 - SAW0);
  const ph = TAU * (2.5 * u + ((8 - 2.5) / (2 * (SAW1 - SAW0))) * u * u);
  const w = sstep(SAW0, 0.2, t) * (1 - sstep(0.52, SAW1, t));
  return [ph, w];
}

function aimP(t: number): FP {
  const q = track(t, AIM_K);
  const [ph, w] = sawOf(t);
  if (w <= 0) return q;
  const k = 0.5 - 0.5 * Math.cos(ph);
  const s = Math.sin(ph);
  const g = sstep(SAW0, SAW1, t);
  return fp(
    {
      aR: mixL(q.aR, bowK(k), w),
      side: q.side + 0.07 * s * w * (0.5 + g),
      bob: q.bob + 0.7 * Math.abs(s) * w * g,
      hp: q.hp + 0.1 * s * w,
      hr: q.hr + 0.06 * s * w,
      lean: q.lean + 0.08 * g * w,
      wb: q.wb + 0.35 * Math.sin(ph - 1.2) * w,
      wu: q.wu + 0.25 * Math.sin(2 * ph - 2) * w * g,
      ct: q.ct + 0.25 * Math.sin(ph - 1.4) * w,
    },
    q,
  );
}

// ---- шпага-смычок: салют, ан гард, взвод, выпад -------------------------------------

/** Салют: скрипка опущена к бедру, смычок отвесно перед лицом. */
const A1 = fp(
  {
    bob: 1.2,
    lean: -0.04,
    hp: -0.05,
    hy: 0,
    hr: 0,
    vc: 0,
    bw: 0,
    aL: limb(0.05, 0.3, 0.15),
    aR: limb(0.85, -0.25, 1.45),
    bf: -0.2,
    bu: 1.5,
    bs: -0.2,
    lL: limb(0, 0.04, 0.05),
    lR: limb(0, 0.04, 0.05),
    wb: -0.2,
  },
  G,
);
/** Ан гард: присел, правая нога вперёд, смычок на цель, скрипка над головой. */
const A2 = fp(
  {
    bob: 0.4,
    sink: 1.5,
    twist: -0.3,
    lean: 0.08,
    hp: 0.05,
    hy: 0.15,
    aL: limb(-0.45, 0.35, 0.2),
    aR: limb(1.2, 0.3, 0.55),
    bf: 1.2,
    bu: 0.25,
    bs: 0.35,
    lL: limb(-0.35, 0.1, 0.45),
    lR: limb(0.55, 0.12, 0.6),
    wb: 0.2,
    ct: 0.2,
  },
  A1,
);
/** Взвод: вес назад, локоть отведён, острие смотрит в цель. */
const A3 = fp(
  {
    sink: 1.6,
    twist: 0.15,
    lean: -0.12,
    aL: limb(-0.6, 0.4, 0.2),
    aR: limb(0.9, -0.1, 1.1),
    bf: 1.6,
    bu: -0.3,
    bs: -0.2,
    lL: limb(-0.3, 0.1, 0.8),
    lR: limb(0.5, 0.12, 0.7),
    wb: 0.35,
    ct: 0.3,
  },
  A2,
);
/** Держит взвод: чуть подаётся назад, острие дрожит. */
const A3b = fp({ sink: 1.8, lean: -0.16, aR: limb(0.85, -0.1, 1.16), wb: 0.1, ct: 0.1 }, A3);
/** Контакт: полный выпад, рука и смычок в линию, скрипка отброшена назад. */
const C = fp(
  {
    bob: 0,
    sink: 2.2,
    twist: -0.55,
    lean: 0.38,
    hp: 0.1,
    hy: 0,
    aL: limb(-0.9, 0.5, 0.1),
    aR: limb(1.98, 0.5, 0.02),
    bf: 0.3,
    bu: 0.05,
    bs: 0,
    lL: limb(-0.75, 0.08, 0.05),
    lR: limb(1.05, 0.1, 1.0),
    wb: 0.6,
    ct: 0.6,
  },
  A3,
);
/** Проводка: перелёт — ниже, острие клюнуло вниз. */
const FT = fp({ lean: 0.46, sink: 2.6, aR: limb(1.95, 0.5, 0), bu: -0.25, wb: -0.4, ct: -0.3 }, C);
/** Возврат: выпрямился, смычок вверх, скрипка идёт к подбородку. */
const R1 = fp(
  {
    lean: 0.05,
    sink: 1,
    twist: -0.1,
    aR: limb(1.0, 0.1, 1.2),
    bf: 0,
    bu: 1.2,
    vc: 0.5,
    bw: 0.2,
    aL: limb(0.8, 0.3, 0.5),
    lL: limb(-0.1, 0.08, 0.2),
    lR: limb(0.2, 0.1, 0.3),
    wb: 0.25,
    ct: 0.15,
  },
  C,
);

const WIND: PKey<FP>[] = [
  [0, G],
  [0.12, A1, easeOut],
  [0.3, A2],
  [0.46, A3, easeOut],
  [0.58, A3b],
  [W + 0.001, C, easeIn],
];
const REC: PKey<FP>[] = [
  [0, C],
  [0.08, FT, easeOut],
  [0.22, R1],
  [0.44, G, eBack],
];

// ---- со свода и приземление ------------------------------------------------------

/** Висит на нити: голова свесилась, ноги болтаются, скрипку прижал. */
const DP1 = fp({
  ...dangleP(0),
  bob: 2,
  hp: 0.45,
  hr: 0.15,
  toe: 0.7,
  vc: 0.7,
  bw: 0,
  aL: limb(0.9, 0.35, 1.1),
  aR: limb(0.5, 0.5, 0.4),
  bf: 0.2,
  bu: 0.8,
  bs: 0.5,
  lL: limb(0.25, 0.1, 0.3),
  lR: limb(-0.15, 0.1, 0.2),
  wu: 0.6,
  ct: -0.4,
});
const DP2 = fp(
  { lL: limb(-0.2, 0.1, 0.2), lR: limb(0.3, 0.1, 0.4), side: 0.08, wu: 0.8, ct: -0.5 },
  DP1,
);
/** Перед полом: ноги вниз, руки в стороны. */
const DP3 = fp(
  {
    hp: 0.1,
    toe: 0.2,
    aR: limb(0.9, 0.9, 0.2),
    lL: limb(0.15, 0.1, 0.3),
    lR: limb(-0.1, 0.1, 0.3),
    wu: 0.9,
    ct: -0.6,
  },
  DP1,
);
const DROP_K: PKey<FP>[] = [
  [0, DP1],
  [0.2, DP2],
  [0.38, DP1],
  [0.5, DP3, easeOut],
];
/** Приземлился: присел, руки в стороны, косица и фалды упали. */
const LD = fp(
  {
    bob: 0,
    sink: 2.6,
    lean: 0.3,
    hp: 0.3,
    vc: 0.4,
    bw: 0,
    aL: limb(0.9, 0.8, 0.3),
    aR: limb(0.9, 0.9, 0.2),
    bf: 0.3,
    bu: 0.4,
    bs: 0.6,
    lL: limb(0.4, 0.15, 1.0),
    lR: limb(0.3, 0.18, 0.9),
    toe: 0,
    wb: -0.4,
    wu: -0.5,
    ct: -0.5,
  },
  G,
);
const LAND_K: PKey<FP>[] = [
  [0, LD],
  [0.06, LD],
  [0.2, G, easeOut],
];

// ---- смерть: нить лопнула ----------------------------------------------------------

const DH1 = fp(
  {
    bob: 3,
    toe: 0.6,
    lean: -0.3,
    hp: -0.6,
    hr: 0,
    aL: limb(1.9, 0.7, 0.3),
    aR: limb(2.0, 0.8, 0.2),
    vc: 0.4,
    bw: 0,
    bf: 0,
    bu: 1,
    bs: 0.5,
    lL: limb(0.15, 0.1, 0.4),
    lR: limb(-0.1, 0.1, 0.3),
    wb: 0.3,
    wu: 0.8,
    ct: -0.5,
  },
  G,
);
const DH2 = fp(
  {
    bob: 0,
    sink: 4,
    lean: 0.45,
    side: 0.1,
    hp: 0.7,
    hr: 0.3,
    aL: limb(0.3, 0.35, 0.2),
    aR: limb(0.4, 0.4, 0.2),
    vc: 0,
    vf: 0.4,
    bu: -1,
    bl: 0.3,
    lL: limb(0.9, 0.12, 1.7),
    lR: limb(0.8, 0.15, 1.6),
    toe: 0.2,
    wb: -0.3,
    wu: -0.3,
    ct: 0.4,
  },
  DH1,
);
const DH3 = fp(
  {
    sink: 7,
    lean: 0.9,
    side: 0.2,
    hp: 0.9,
    aL: limb(0.4, 0.5, 0.1),
    aR: limb(0.6, 0.5, 0.1),
    vf: 1,
    bl: 1,
    lL: limb(1.4, 0.15, 0.5),
    lR: limb(1.3, 0.2, 0.7),
    wu: -0.8,
    ct: 0.2,
  },
  DH2,
);
const DH4 = fp(
  {
    sink: 8.5,
    lean: 1.35,
    side: 0.45,
    hp: 0.6,
    hr: 0.5,
    aL: limb(1.6, 0.6, 0.1),
    aR: limb(1.2, 0.8, 0.2),
    lL: limb(1.5, 0.2, 0.3),
    lR: limb(1.2, 0.25, 0.6),
    wb: 0.3,
    wu: -0.4,
    ct: -0.3,
  },
  DH3,
);
const DIE: PKey<FP>[] = [
  [0, G],
  [0.05, DH1, easeOut],
  [0.2, DH2, easeIn],
  [0.34, DH3, easeOut],
  [0.48, DH4, easeIn],
  [0.6, fp({ aR: limb(1.3, 0.85, 0.5), ct: 0, wb: 0 }, DH4)],
  [0.7, DH4],
];

// ---- поза по анимации и кадру --------------------------------------------------

function fPose(anim: string, f: number): FP {
  const t = tf(f);
  switch (anim) {
    case 'aim':
      return aimP(t);
    case 'arec':
      return track(t, AREC_K);
    case 'wind':
      return track(t, WIND);
    case 'rec':
      return track(t, REC);
    case 'drop':
      return track(t, DROP_K);
    case 'land':
      return track(t, LAND_K);
    case 'hu': {
      const q = hurtP(G, t) as FP;
      const k = Math.sin(PI * Math.min(1, t / 0.25));
      return {
        ...q,
        bw: 1 - 0.7 * k,
        bu: 0.8 * k,
        bs: 0.6 * k,
        wb: 0.6 * k,
        wu: 0.5 * k,
        ct: 0.5 * k,
      };
    }
    case 'die':
      return track(t, DIE);
    case 'al': {
      // Вздрогнул: смычок взвизгнул вверх, подпрыгнул.
      const k = Math.sin(PI * Math.min(1, t / 0.35));
      return fp(
        {
          bob: 1 + 1.8 * k,
          toe: 0.4 * k,
          hp: 0.18 - 0.5 * k,
          aR: mixL(G.aR, limb(1.9, 0.5, 0.5), k),
          bw: 1 - 0.8 * k,
          bu: 1.0 * k,
          bs: 0.4 * k,
          wu: 0.7 * k,
          ct: -0.3 * k,
        },
        G,
      );
    }
    case 'walk': {
      // Играет на ходу: два коротких взмаха на шаг, фалды и косица отстают.
      const ph = (f / WALK_N) * TAU;
      const s = Math.sin(ph);
      const g = gaitP(ph, 1);
      return fp({
        ...g,
        bob: g.bob + 0.6,
        lean: 0.14,
        hp: G.hp,
        hy: G.hy,
        hr: G.hr + 0.06 * s,
        aL: G.aL,
        aR: bowK(0.5 + 0.32 * Math.sin(2 * ph)),
        wb: 0.4 + 0.25 * Math.sin(2 * ph - 1.2),
        wu: 0.3 * Math.sin(2 * ph - 2),
        ct: 0.45 + 0.3 * Math.sin(2 * ph - 1.4),
      });
    }
    case 'lost': {
      // В темноте: скрипка в опущенной руке, смычком нащупывает пол.
      const ph = (f / 12) * TAU;
      const q = gropeP(ph);
      return fp({
        ...q,
        aL: limb(0.15, 0.25, 0.3),
        aR: limb(0.9, 0.15, 0.1),
        vc: 0,
        bw: 0,
        bf: 0.4,
        bu: -1.3,
        bs: 0.7 * Math.sin(ph),
        wb: 0.15 * Math.sin(ph - 1),
      });
    }
    case 'wait': {
      // Антракт: скрипка у бедра, смычок на плече, кивает.
      const ph = (f / 8) * TAU;
      const q = dangleP(ph);
      return fp({
        ...q,
        hp: 0.1 + 0.1 * Math.sin(ph),
        aL: limb(0.15, 0.2, 0.25),
        aR: limb(0.5, 0.2, 1.7),
        vc: 0,
        bw: 0,
        bf: -1.2,
        bu: 1,
        bs: 0.2,
        wb: 0.1 * Math.sin(ph - 1),
      });
    }
    case 'sl1':
    case 'sl0': {
      const q = slumpP(anim === 'sl1' ? 1 : 0.6);
      q.bob += f === 1 || f === 2 ? 0.4 : 0;
      return fp({
        ...q,
        aL: limb(0.1, 0.15, 0.1),
        aR: limb(0.05, 0.15, 0.1),
        vc: 0,
        bw: 0,
        bf: 0.3,
        bu: -1.4,
        wu: -0.6,
      });
    }
  }
  // Покой: тихо играет — один взмах туда и обратно, качается в такт.
  const ph = (f / IDLE_N) * TAU;
  const s = Math.sin(ph);
  return fp(
    {
      bob: 0.9 + 0.4 * Math.sin(2 * ph),
      side: 0.05 * s,
      lean: 0.06 + 0.03 * s,
      hr: G.hr + 0.06 * s,
      aR: bowK(0.12 + 0.76 * (0.5 - 0.5 * Math.cos(ph))),
      lL: limb(0.1 + 0.04 * s, 0.08, 0.15),
      lR: limb(-0.1 + 0.04 * s, 0.1, 0.12 + 0.08 * Math.max(0, s)),
      wb: 0.2 * Math.sin(ph - 1),
      wu: 0.15 * Math.sin(2 * ph - 1),
      ct: 0.15 * Math.sin(ph - 1.2),
    },
    G,
  );
}

// ---- рисунок -----------------------------------------------------------------

const dot3 = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
const sub = (a: V3, b: V3): V3 => vadd(a, vsc(b, -1));
/** Верх деки: «вверх», без составляющей вдоль скрипки (стоймя — к зрителю). */
function topOf(d: V3, fwd: V3): V3 {
  const up = v3(0, 1, 0);
  const n = sub(up, vsc(d, dot3(up, d)));
  if (Math.hypot(n.x, n.y, n.z) > 0.35) return vnorm(n);
  return vnorm(sub(fwd, vsc(d, dot3(fwd, d))));
}

/** Лак скрипки — рыжий, чтобы не тонул ни во фраке, ни в полу. */
const VARNISH: Tone = [hx('#3a1206'), hx('#7a2e10'), hx('#b8561c'), hx('#f0a050')];
const BOWWOOD: Tone = [hx('#1e0e06'), hx('#3e1c0a'), hx('#5e3014'), hx('#8a4a22')];

const V_FLOOR_T = v3(-4.2, 1.6, 1.2);
const V_FLOOR_D = vnorm(v3(-0.25, 0, 1));
const B_FLOOR_P = v3(3.2, 0.5, -0.5);
const B_FLOOR_D = vnorm(v3(0.15, 0, 1));

/**
 * Вид справа и сзади справа: скрипка на дальнем плече пряталась за головой и
 * рукой со смычком — в этих сторонах она ближе к середине груди (доля по стороне).
 */
const CHEAT = [1, 0.4, 0, 0, 0, 0, 0, 1];
const cheatOf = (q: FP, d: number) => CHEAT[d] * q.vc;
function cheatP(q: FP, k: number): FP {
  return k > 0 ? { ...q, aL: limb(q.aL.sw, q.aL.out - 0.32 * k, q.aL.bend) } : q;
}

/** Скрипка: хвост и направление к завитку (`ck` — доля сдвига к груди). */
function violinOf(j: Joints, q: FP, ck: number): [V3, V3] {
  // У подбородка: от ключицы к левой руке.
  const ch = vadd(
    vadd(vsc(vadd(j.shL, j.neck), 0.5), vsc(j.up, 0.5)),
    vadd(vsc(j.fwd, 1.6), vsc(j.right, 1.1 * ck)),
  );
  const d1 = vnorm(sub(j.haL, ch));
  const t1 = vadd(ch, vsc(d1, -0.8));
  // В руке за гриф: корпус продолжает предплечье.
  const d0 = vsc(j.foreL, -1);
  const t0 = vadd(j.haL, vsc(j.foreL, VL - 0.6));
  let tail = vmix(t0, t1, q.vc);
  let dir = vnorm(vmix(d0, d1, q.vc));
  const vf = q.vf ?? 0;
  if (vf > 0) {
    tail = vmix(tail, V_FLOOR_T, vf);
    dir = vnorm(vmix(dir, V_FLOOR_D, vf));
  }
  return [tail, dir];
}

function violin(rig: Rig, tail: V3, d: V3, fwd: V3): void {
  const n = topOf(d, fwd);
  const at = (k: number, h = 0) => vadd(vadd(tail, vsc(d, k)), vsc(n, h));
  rig.ball(at(1.6), 2.0, VARNISH);
  rig.ball(at(4.0), 1.55, VARNISH);
  rig.cap(at(1.6), at(4.0), 1.45, 1.25, VARNISH);
  // Гриф над декой, завиток.
  rig.cap(at(3.0, 1.3), at(7.6, 0.4), 0.45, 0.4, P.black);
  rig.ball(at(8.0, 0.4), 0.65, VARNISH);
  rig.dot(at(1.2, 1.9), INK, 1);
}

/** Смычок: колодка и направление к острию. */
function bowOf(j: Joints, q: FP, tail: V3, vd: V3): [V3, V3] {
  // На струнах — через подставку.
  const cp = vadd(vadd(tail, vsc(vd, 2.5)), vsc(topOf(vd, j.fwd), 1.6));
  const d1 = vnorm(sub(cp, j.haR));
  const d0 = vnorm(vadd(j.foreR, vadd(vadd(vsc(j.fwd, q.bf), vsc(j.right, q.bs)), v3(0, q.bu, 0))));
  let d = vnorm(vmix(d0, d1, q.bw));
  let frog = j.haR;
  const bl = q.bl ?? 0;
  if (bl > 0) {
    frog = vmix(frog, B_FLOOR_P, bl);
    d = vnorm(vmix(d, B_FLOOR_D, bl));
  }
  return [frog, d];
}

/** Смычок: тёмная трость над светлым волосом — читается и на парике, и на полу. */
function bow(rig: Rig, frog: V3, d: V3, fwd: V3): void {
  const n = vsc(topOf(d, fwd), 0.6);
  rig.cap(vadd(frog, vsc(d, -0.9)), vadd(frog, vsc(d, 0.6)), 0.5, 0.45, P.black);
  rig.cap(vadd(frog, vsc(d, 0.6)), vadd(frog, vsc(d, BOW)), 0.34, 0.3, P.cream);
  rig.cap(
    vadd(vadd(frog, vsc(d, 0.4)), n),
    vadd(vadd(frog, vsc(d, BOW + 0.2)), n),
    0.32,
    0.28,
    BOWWOOD,
  );
}

function fidRig(q0: FP, d: number): { rig: Rig; j: Joints; frog: V3; bd: V3 } {
  const ck = cheatOf(q0, d);
  const q = cheatP(q0, ck);
  const rig = new Rig();
  const j = humanoid(rig, FIDDLE_BODY, q);
  const R = FIDDLE_BODY.head;
  rig.dot(onHead(j, R, 0.95, -0.35, 0.1), INK, 1);
  rig.dot(onHead(j, R, 0.95, 0.35, 0.1), INK, 1);
  rig.dot(onHead(j, R, 0.97, 0, -0.4), P.red[1], 1);
  // Парик: чёлка и косица с чёрным бантом — косица отстаёт от головы.
  rig.cap(onHead(j, R, 0.2, -0.6, 0.7), onHead(j, R, 0.2, 0.6, 0.7), 1.6, 1.6, P.cream);
  const nape = onHead(j, R, -0.92, 0, -0.05);
  const lag = vadd(vsc(j.hFwd, -q.wb * 1.6), v3(0, q.wu * 1.6, 0));
  const mid = vadd(vadd(nape, vadd(vsc(j.hFwd, -1), v3(0, -1.6, 0))), vsc(lag, 0.4));
  const tip = vadd(vadd(mid, vadd(vsc(j.hFwd, -0.5), v3(0, -1.6, 0))), lag);
  rig.cap(nape, mid, 0.85, 0.7, P.cream);
  rig.cap(mid, tip, 0.7, 0.4, P.cream);
  rig.ball(nape, 0.8, P.black);
  // Фалды фрака: висят отвесно, отстают назад при ходьбе и выпаде.
  const flat = vnorm(v3(j.fwd.x, 0, j.fwd.z));
  for (const s of [-1, 1]) {
    const top = vadd(vadd(j.pelvis, vadd(vsc(j.up, 1.4), vsc(j.fwd, -1.3))), vsc(j.right, s * 0.9));
    const end = vadd(
      top,
      vadd(v3(0, -4.2 + Math.abs(q.ct) * 0.6, 0), vsc(flat, -(0.7 + q.ct * 1.7))),
    );
    rig.cap(top, end, 0.95, 0.6, P.green);
  }
  const [tail, vd] = violinOf(j, q, ck);
  violin(rig, tail, vd, j.fwd);
  const [frog, bd] = bowOf(j, q, tail, vd);
  bow(rig, frog, bd, j.fwd);
  return { rig, j, frog, bd };
}

const K = kindOf('f13_fiddler', 60, 56, 30, 44, 1400);

/** Смычок на экране в момент `tt` трека: [у колодки, острие]. */
function bowAt(
  tt: number,
  keys: (tt: number) => FP,
  d: number,
  inner = 3,
): [number, number, number, number] {
  const q0 = keys(tt);
  const ck = cheatOf(q0, d);
  const q = cheatP(q0, ck);
  const j = humanoid(new Rig(), FIDDLE_BODY, q);
  const [tail, vd] = violinOf(j, q, ck);
  const [frog, bd] = bowOf(j, q, tail, vd);
  const Pj = projOf(K, yawN(d));
  const a = Pj(vadd(frog, vsc(bd, inner)));
  const b = Pj(vadd(frog, vsc(bd, BOW)));
  return [a[0], a[1], b[0], b[1]];
}
const meleeAt = (tt: number) => (tt < W ? track(tt, WIND) : track(tt - W, REC));
const shotAt = (tt: number) => (tt < AIM ? aimP(tt) : track(tt - AIM, AREC_K));

const SMEAR_C = hx('#fff2d8');
const SPARK_C = hx('#ffffff');
const ROSIN = hx('#f4ead2');
const DUST: readonly RGBA[] = [P.wood[2], P.wood[3], P.cream[2], P.green[2]];

const fPic = (anim: string, f: number, d: number): Pic => {
  const q = fPose(anim, f);
  const yaw = yawN(d);
  const { rig, j, frog, bd } = fidRig(q, d);
  return draw(K, rig, yaw, (o, Pj, lit) => {
    // Выпад: след острия за три кадра и контакт; искра на острие.
    if (anim === 'wind' || anim === 'rec') {
      const ta = anim === 'wind' ? tf(f) : W + tf(f);
      if (ta >= tf(15) && ta <= W + tf(1)) {
        const segs: [number, number, number, number][] = [];
        for (let i = 0; i <= 6; i++) segs.push(bowAt(ta - i / 96, meleeAt, d));
        smearInto(lit(), segs, SMEAR_C, ta >= W ? 0.8 : 0.55);
      }
      if (anim === 'rec' && f <= 1) {
        const [x, y] = Pj(vadd(frog, vsc(bd, BOW)));
        spark(lit(), x, y, SPARK_C, f === 0 ? 1 : 0.6);
      }
    }
    // Бросок смычка на выстреле.
    if (anim === 'aim' || anim === 'arec') {
      const ta = anim === 'aim' ? tf(f) : AIM + tf(f);
      if (ta >= tf(16) && ta <= AIM + tf(2)) {
        const segs: [number, number, number, number][] = [];
        for (let i = 0; i <= 3; i++) segs.push(bowAt(ta - i / 96, shotAt, d, 7.5));
        smearInto(lit(), segs, SMEAR_C, ta >= AIM ? 0.45 : 0.3);
      }
      // Канифоль пылит из-под смычка, когда пилит быстро.
      if (anim === 'aim' && f >= 8 && f <= 13) {
        const [x, y] = Pj(vadd(frog, vsc(bd, 4)));
        for (let i = 0; i < 3; i++) {
          const a = hash(f, i, 5) * TAU;
          o.px.set(Math.round(x + Math.cos(a) * 2), Math.round(y - 1 - hash(f, i, 9) * 3), ROSIN);
        }
      }
    }
    if (anim === 'die' && f >= 7 && f <= 16) {
      const [x, y] = Pj(vadd(j.pelvis, v3(0, -j.pelvis.y, 0)));
      puff(o.px, x, y, (f - 6.5) / 9.5, 43, DUST, 9, 9);
    }
    if (anim === 'land' && f <= 3) {
      const [x, y] = Pj(v3(0, 0, 0));
      puff(o.px, x, y + 1, (f + 0.5) / 4, 47, DUST, 7, 7);
    }
  });
};

// ---- рисовальщик -------------------------------------------------------------

const TECH = new Set(['windup', 'recover', 'aim', 'stun', 'alert']);

registerMobPainter('f13_fiddler', (m: Mob, pose: MobPose): MobFrame => {
  const md = pose.mode;
  const t = pose.t || 0;
  const now = pose.now || 0;
  const id = m.id ?? 0;
  const want = TECH.has(md) ? (m.face ?? 0) : headOf(m);
  const v = visOf(m, pose, want, md === 'windup' ? 6 : md === 'aim' ? 8 : 10);
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
  } else if (md === 'aim') {
    anim = 'aim';
    f = fi(t, AIM_N - 1);
  } else if (md === 'recover' && v.prev === 'aim' && t < 0.45) {
    anim = 'arec';
    f = fi(t, AREC_N - 1);
    // Выстрел: тянется вверх на носках, отдача назад.
    const k = 1 - sstep(0, 0.12, t);
    ex.sx = 1 - 0.05 * k;
    ex.sy = 1 + 0.07 * k;
    const back = 0.8 * (1 - sstep(0.02, 0.2, t));
    ex.dx = -fx * back;
    ex.dy = -fy * back;
  } else if (md === 'windup') {
    anim = 'wind';
    f = fi(t, WIND_N - 1);
    // Взвод — назад, в выпаде — вперёд.
    const back = sstep(0.3, 0.5, t) * (1 - sstep(0.6, W, t));
    ex.dx = -fx * 1.1 * back;
    ex.dy = -fy * 1.1 * back;
  } else if (md === 'recover' && t < 0.45) {
    anim = 'rec';
    f = fi(t, REC_N - 1);
    const k = 1 - sstep(0, 0.14, t);
    ex.sx = 1 + 0.1 * k;
    ex.sy = 1 - 0.1 * k;
    const lunge = 1.8 * (1 - sstep(0.06, 0.3, t));
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
    f = Math.floor(now * 5 + hash(id, 7) * IDLE_N) % IDLE_N;
  }
  if (md !== 'dying') hurtFx(v, now, 1.3, ex);
  return { ...frameOf(K, anim, f, d, pose, () => fPic(anim, f, d)), ...ex };
});

registerMobWarm('f13_fiddler', function* () {
  yield* warmAll(
    K,
    [
      ['idle', IDLE_N],
      ['walk', WALK_N],
      ['aim', AIM_N],
      ['arec', AREC_N],
      ['wind', WIND_N],
      ['rec', REC_N],
      ['hu', HURT_N],
      ['die', DIE_N],
      ['al', 9],
      // Выпадает со свода (гардероб), в темноте ищет героя, в яме молчит.
      ['drop', DROP_N],
      ['land', LAND_N],
      ['lost', 12],
      ['sl0', 4],
    ],
    fPic,
  );
});
