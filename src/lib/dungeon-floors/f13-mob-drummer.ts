// Барабанщик (анимации мобов 13). Облик прежний: деревянный солдатик в синем
// мундире, красный кивер с золотым околышем, барабан на ремне, две палочки.
//
// Кольцо на сильную долю — трек 24 к/с от времени режима `f13_drum`
// (`f13-brains.ts` барабанщик: удар кольцом — в конце режима, `drumLen` 0,75 с
// или 0,5 с в быструю увертюру; тем же шагом — `recover`, кадр контакта —
// первый кадр `recover`). Дробь нарастает, палочки взлетают крестом над
// кивером, нити вздёргивают куклу на носки — держит; удар обеими в кожу:
// кукла вжимается, кожа вспыхивает, палочки отскакивают и добивают второй
// дробью. Ближний бой (`windup` 0,75): присел, вскинул палочки за голову,
// правую крутанул, держит — выпад обеими в цель, проводка в пол, нити тянут
// назад. В покое отбивает такт игры (`F13_FX.beat`, восьмыми, сильная доля —
// правой с акцентом); маршем — колени вверх, удар на каждый шаг. Помпон на
// кивере и барабан на ремне отстают. 8 честных сторон.

import type { Px } from '../dungeon-art';
import { registerMobPainter, registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import { F13_FX } from './f13-brains';
import {
  INK,
  KNIGHT_BODY,
  P,
  Rig,
  humanoid,
  hx,
  limb,
  onHead,
  v3,
  vadd,
  vnorm,
  vsc,
} from './f13-art';
import type { Body, Joints, Pat, Pose, RGBA, Tone, V3 } from './f13-art';
import {
  PI,
  TAU,
  crawlP,
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
  puff,
  reelP,
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
import type { PKey, Pic, Proj2 } from './f13-mobkit';

// ---- тело (было в `f13-art.ts`) ------------------------------------------------

const band =
  (t0: number, t1: number, T: Tone): Pat =>
  (t) =>
    t >= t0 && t <= t1 ? T : null;

const DRUM_BODY: Body = {
  ...KNIGHT_BODY,
  hip: 8,
  torso: 7,
  waist: 3,
  chest: 3.4,
  head: 3.3,
  T: {
    torso: P.blue,
    arm: P.blue,
    leg: P.cream,
    head: P.skin,
    hand: P.cream,
    foot: P.black,
    joint: P.gold,
    pelvis: P.cream,
  },
  torsoPat: (t, nx) => (Math.abs(nx) < 0.15 && t > 0.2 ? P.gold : null),
  legPat: band(0.6, 1, P.black),
  armPat: band(0.85, 1, P.gold),
};

/**
 * Поза барабанщика: палочки — наклон от «вверх» к «вперёд» в плоскости
 * корпуса (`ls`, `rs`, рад; `tw` — прокрут правой), тяга к коже барабана
 * (`la`, `ra`: 1 — остриё на коже), развал к середине `cn`, крест на коже
 * `cx` (−1 — палочки скрещены), помпон `pl`, барабан на ремне: качнулся
 * вперёд `dz`, вдавлен `dy` (пиксели).
 */
interface DP extends Pose {
  ls: number;
  rs: number;
  tw: number;
  la: number;
  ra: number;
  cn: number;
  cx: number;
  pl: number;
  dz: number;
  dy: number;
}
const D0: DP = {
  ...dangleP(0),
  aL: limb(0.35, 0.22, 1.25),
  aR: limb(0.35, 0.22, 1.25),
  ls: 1.1,
  rs: 1.1,
  tw: 0,
  la: 1,
  ra: 1,
  cn: 0.22,
  cx: 1,
  pl: 0,
  dz: 0,
  dy: 0,
};
const dp = (o: Partial<DP>, b: DP = D0): DP => ({ ...b, ...o });

const W = 0.75;
const WIND_N = 18;
const REC_N = 11;
const DRUM_N = 18;
const DRUMF_N = 12;
const DREC_N = 11;
const HURT_N = 8;
const DIE_N = 21;
const WALK_N = 12;
const STRIDE = 1.4;
const IDLE_N = 16;
const STICK = 6.5;
const DRUM_R = 4.6;
const DRUM_H = 3.6;

// ---- стойка и удары по коже --------------------------------------------------

/** Стойка: палочки на коже. */
const G = dp({});
/** То же после прокрута правой (оборот — тот же рисунок, трек не крутит назад). */
const GT = dp({ tw: TAU });

/** Палочка отбила и поднялась на долю `k` (0 — на коже, 1 — вскинута). */
function lift(q: DP, s: -1 | 1, k: number): void {
  if (k <= 0) return;
  const a = s < 0 ? q.aL : q.aR;
  const l = limb(a.sw + 0.5 * k, a.out, a.bend + 0.3 * k);
  if (s < 0) {
    q.aL = l;
    q.la = q.la * (1 - 0.85 * k);
    q.ls = 0.75;
  } else {
    q.aR = l;
    q.ra = q.ra * (1 - 0.85 * k);
    q.rs = 0.75;
  }
}
/** Высота палочки в такте из восьми кадров после удара. */
const TAP8 = [0, 0.7, 1, 0.85, 0.65, 0.45, 0.25, 0.08];
/** То же для шага (двенадцать кадров). */
const TAP12 = [0, 0.55, 0.9, 1, 0.92, 0.8, 0.66, 0.52, 0.4, 0.28, 0.16, 0.05];

// ---- кольцо на долю ----------------------------------------------------------

/** Дробь: склонился к барабану. */
const RL = dp({ lean: 0.18, sink: 0.7, hp: 0.28, bob: 0.6, pl: 0.12 });
/** Палочки вверх крестом, нити вздёрнули на носки. */
const UP = dp({
  bob: 2.8,
  lean: -0.2,
  hp: -0.3,
  aL: limb(2.75, 0.4, 0.35),
  aR: limb(2.75, 0.4, 0.35),
  ls: -0.2,
  rs: -0.2,
  la: 0,
  ra: 0,
  cn: 0.62,
  toe: 0.55,
  lL: limb(0.12, 0.06, 0.3),
  lR: limb(-0.08, 0.06, 0.25),
  pl: -0.4,
  dz: -0.4,
});
/** Пик: дотянулся, держит. */
const UP2 = dp(
  {
    bob: 3.2,
    lean: -0.26,
    hp: -0.36,
    aL: limb(2.9, 0.42, 0.3),
    aR: limb(2.9, 0.42, 0.3),
    pl: -0.3,
  },
  UP,
);
/** Контакт: обе в кожу, кукла вжалась. */
const DC = dp({
  bob: 0,
  sink: 2.3,
  lean: 0.34,
  hp: 0.42,
  aL: limb(0.42, 0.42, 1.0),
  aR: limb(0.42, 0.42, 1.0),
  la: 1,
  ra: 1,
  toe: 0,
  lL: limb(0.3, 0.12, 0.6),
  lR: limb(0.2, 0.12, 0.55),
  pl: 0.45,
  dz: 0.5,
  dy: -0.7,
});
/** Отскок палочек. */
const DB1 = dp({
  bob: 1.1,
  sink: 0.9,
  lean: 0.2,
  hp: 0.2,
  aL: limb(1.0, 0.36, 1.4),
  aR: limb(1.0, 0.36, 1.4),
  la: 0.15,
  ra: 0.15,
  ls: 0.5,
  rs: 0.5,
  pl: 0.05,
  dz: 0.2,
});
/** Добивка — вторая дробь вполсилы. */
const DB2 = dp(
  { bob: 0.4, sink: 1.2, lean: 0.26, hp: 0.3, la: 1, ra: 1, pl: 0.25, dz: 0.4, dy: -0.3 },
  G,
);

const drumKeys = (T: number): PKey<DP>[] => [
  [0, G],
  [0.3 * T, RL],
  [0.55 * T, UP, easeOut],
  [0.8 * T, UP2, lin],
  [T, DC, easeIn],
];
const DRUM_K = drumKeys(0.75);
const DRUMF_K = drumKeys(0.5);
const DREC: PKey<DP>[] = [
  [0, DC],
  [0.083, DB1, easeOut],
  [0.17, DB2, easeIn],
  [0.25, dp({ la: 0.55, ra: 0.55 }, G)],
  [0.42, G, eBack],
];

/** Кадр трека кольца с дробью поверх (нарастает до подъёма палочек). */
function drumPose(f: number, T: number): DP {
  const t = tf(f);
  const q = { ...track(t, T < 0.6 ? DRUMF_K : DRUM_K) };
  const u = t / T;
  if (u < 0.36) {
    const A = (0.45 + 0.55 * Math.min(1, u / 0.3)) * (1 - sstep(0.3, 0.36, u));
    lift(q, -1, A * [0, 1, 0.55, 0.2][f % 4]);
    lift(q, 1, A * [0.55, 0.2, 0, 1][f % 4]);
  }
  return q;
}

// ---- ближний бой -------------------------------------------------------------

/** Присел, палочки к груди. */
const M1 = dp({
  sink: 1.1,
  lean: 0.22,
  hp: 0.16,
  aL: limb(0.2, 0.3, 0.9),
  aR: limb(0.2, 0.3, 0.9),
  la: 0.55,
  ra: 0.55,
  ls: 0.9,
  rs: 0.9,
  pl: 0.18,
  lL: limb(0.15, 0.06, 0.45),
  lR: limb(-0.12, 0.06, 0.4),
});
/** Нити вздёрнули: палочки за кивером, правая сделала оборот. */
const M2 = dp({
  bob: 2.6,
  lean: -0.26,
  twist: -0.14,
  hp: -0.25,
  aL: limb(2.85, 0.45, 0.95),
  aR: limb(2.95, 0.45, 0.95),
  ls: -0.95,
  rs: -0.95,
  tw: TAU,
  la: 0,
  ra: 0,
  cn: 0.5,
  toe: 0.5,
  lL: limb(0.3, 0.08, 0.6),
  lR: limb(-0.12, 0.08, 0.35),
  pl: -0.38,
  dz: -0.5,
});
/** Пик. */
const M3 = dp(
  {
    bob: 2.9,
    lean: -0.31,
    hp: -0.3,
    aL: limb(2.95, 0.45, 1.0),
    aR: limb(3.05, 0.45, 1.0),
    pl: -0.25,
  },
  M2,
);
/** Контакт: обе палочки в цель, выпад. */
const MC = dp({
  bob: 0,
  sink: 1.6,
  lean: 0.55,
  twist: 0.08,
  hp: 0.3,
  aL: limb(1.5, 0.12, 0.12),
  aR: limb(1.5, 0.12, 0.12),
  ls: 1.95,
  rs: 1.95,
  tw: TAU,
  la: 0,
  ra: 0,
  cn: 0.12,
  toe: 0,
  lL: limb(0.55, 0.1, 0.35),
  lR: limb(-0.45, 0.1, 0.25),
  pl: 0.35,
  dz: 1,
});
/** Проводка: палочки ушли к полу за цель. */
const MF = dp(
  {
    sink: 2.2,
    lean: 0.68,
    hp: 0.38,
    aL: limb(0.95, 0.16, 0.1),
    aR: limb(0.95, 0.16, 0.1),
    ls: 2.55,
    rs: 2.55,
    pl: 0.6,
    dz: 1.4,
  },
  MC,
);
/** Отдача: нити тянут назад. */
const MR = dp({
  bob: 0.8,
  sink: 0.6,
  lean: 0.2,
  hp: 0.14,
  aL: limb(0.5, 0.28, 1.0),
  aR: limb(0.5, 0.28, 1.0),
  la: 0.6,
  ra: 0.6,
  ls: 1.0,
  rs: 1.0,
  tw: TAU,
  pl: 0.05,
  dz: 0.3,
});

const WIND: PKey<DP>[] = [
  [0, G],
  [0.12, M1],
  [0.36, M2, easeOut],
  [0.6, M3, lin],
  [0.75, MC, easeIn],
];
const REC: PKey<DP>[] = [
  [0, MC],
  [0.083, MF, easeOut],
  [0.2, MR],
  [0.42, GT, eBack],
];

// ---- смерть: последний рывок нитей — оседает на барабан, палочки на полу -------

const X1 = dp({
  bob: 3.2,
  hp: -0.55,
  lean: -0.3,
  aL: limb(2.2, 0.7, 0.2),
  aR: limb(2.0, 0.8, 0.3),
  la: 0,
  ra: 0,
  ls: 0.3,
  rs: 0.5,
  lL: limb(0.3, 0.2, 0.5),
  lR: limb(-0.2, 0.15, 0.4),
  toe: 0.7,
  pl: -0.45,
});
const X2 = dp({
  sink: 8,
  bob: 0,
  lean: 1.05,
  side: 0.3,
  hp: 0.75,
  hr: 0.45,
  aL: limb(0.7, 0.9, 0.2),
  aR: limb(0.6, 1.0, 0.3),
  lL: limb(-0.9, 0.5, 0.9),
  lR: limb(1.0, 0.4, 0.6),
  toe: 0,
  la: 0,
  ra: 0,
  pl: 0.6,
  dz: 0.6,
});
const X3 = dp({ sink: 6.8, lean: 0.92, hp: 0.5, pl: 0.25 }, X2);
const DIE: PKey<DP>[] = [
  [0, G],
  [0.08, X1, easeOut],
  [0.4, X2, easeIn],
  [0.48, X3, easeOut],
  [0.58, X2, easeIn],
];

// ---- поза по анимации и кадру ------------------------------------------------

function dPose(anim: string, f: number): DP {
  const t = tf(f);
  switch (anim) {
    case 'drum':
      return drumPose(f, 0.75);
    case 'drumf':
      return drumPose(f, 0.5);
    case 'drec':
      return track(t, DREC);
    case 'wind':
      return track(t, WIND);
    case 'rec':
      return track(t, REC);
    case 'hu': {
      const q = hurtP(G, t) as DP;
      // Палочки взлетают вместе с руками.
      const k = t < 0.05 ? t / 0.05 : 1 - sstep(0.05, 0.3, t);
      return { ...q, la: 1 - 0.9 * k, ra: 1 - 0.9 * k, ls: 0.4, rs: 0.6 };
    }
    case 'die':
      return track(t, DIE);
    case 'reel': {
      const q = reelP(t);
      return dp({
        ...q,
        la: 0,
        ra: 0,
        ls: 0.6 + 0.7 * Math.sin(t * 18),
        rs: 0.8 - 0.7 * Math.sin(t * 15),
      });
    }
    case 'al': {
      const k = Math.sin(PI * Math.min(1, t / 0.35));
      return dp({
        bob: 1 + 2.4 * k,
        hp: 0.08 - 0.35 * k,
        aL: limb(0.35 + 1.3 * k, 0.22 + 0.2 * k, 1.25 - 0.6 * k),
        aR: limb(0.35 + 1.3 * k, 0.22 + 0.2 * k, 1.25 - 0.6 * k),
        la: 1 - k,
        ra: 1 - k,
        ls: 0.3,
        rs: 0.3,
        pl: -0.3 * k,
      });
    }
    case 'walk': {
      // Марш: колени вверх, удар на каждый шаг; барабан и помпон отстают.
      const ph = (f / WALK_N) * TAU;
      const g = gaitP(ph);
      const q = dp({
        ...g,
        lean: 0.06,
        lL: limb(g.lL.sw * (g.lL.sw > 0 ? 1.35 : 0.8), 0.06, g.lL.bend * 1.35),
        lR: limb(g.lR.sw * (g.lR.sw > 0 ? 1.35 : 0.8), 0.06, g.lR.bend * 1.35),
        aL: D0.aL,
        aR: D0.aR,
        pl: -0.18 * Math.abs(Math.sin(ph - 0.7)),
        dz: 0.5 * Math.sin(ph - 0.9),
        dy: -0.5 * Math.abs(Math.sin(ph - 0.6)),
      });
      lift(q, 1, TAP12[(f + 8) % 12]);
      lift(q, -1, TAP12[(f + 2) % 12]);
      return q;
    }
    case 'crawl':
      return dp({ ...crawlP((f / 8) * TAU), la: 0, ra: 0, ls: 1.75, rs: 1.65 });
    case 'lost': {
      const ph = (f / 12) * TAU;
      return dp({
        ...gropeP(ph),
        la: 0,
        ra: 0,
        ls: 1.45 + 0.2 * Math.sin(ph),
        rs: 1.5 - 0.2 * Math.sin(ph),
      });
    }
    case 'sl1': {
      // Спит: нити отпустили, палочки повисли.
      const q = slumpP(1);
      q.bob += f === 1 || f === 2 ? 0.4 : 0;
      return dp({ ...q, la: 0, ra: 0, ls: PI - 0.45, rs: PI - 0.35 });
    }
    case 'sl0': {
      // Оркестр молчит: палочки крестом на коже, голова опущена.
      const q = slumpP(0.6);
      q.bob += f === 1 || f === 2 ? 0.4 : 0;
      return dp({ ...q, aL: limb(0.32, 0.12, 1.0), aR: limb(0.32, 0.12, 1.0), cx: -1 });
    }
  }
  // Покой: такт восьмыми, сильная доля — правой с акцентом.
  const q = dp({ ...dangleP((f / IDLE_N) * TAU), aL: D0.aL, aR: D0.aR });
  q.hp += f % 8 === 0 ? 0.08 : f % 4 === 0 ? 0.04 : 0;
  lift(q, 1, TAP8[f % 8] * (f >= 8 ? 1.3 : 0.75));
  lift(q, -1, TAP8[(f + 4) % 8] * 0.75);
  return q;
}

// ---- рисунок -----------------------------------------------------------------

/** Середина кожи барабана: на ремне перед тазом, на полу — лежит. */
function drumTop(j: Joints, q: DP): V3 {
  const f = vnorm(v3(j.fwd.x, 0, j.fwd.z));
  const c = vadd(j.pelvis, vadd(vsc(f, 4 + q.dz), v3(0, 2.2 + q.dy, 0)));
  if (c.y < DRUM_H) c.y = DRUM_H;
  return c;
}

function stickDir(j: Joints, q: DP, s: -1 | 1, top: V3): V3 {
  const a = s < 0 ? q.ls : q.rs + q.tw;
  const free = vnorm(
    vadd(vadd(vsc(j.up, Math.cos(a)), vsc(j.fwd, Math.sin(a))), vsc(j.right, -s * q.cn)),
  );
  const w = s < 0 ? q.la : q.ra;
  if (w <= 0) return free;
  const ha = s < 0 ? j.haL : j.haR;
  const side = vnorm(v3(j.right.x, 0, j.right.z));
  const tgt = vadd(top, vsc(side, s * 1.4 * q.cx));
  const aim = vnorm(vadd(tgt, vsc(ha, -1)));
  return vnorm(vadd(vsc(free, 1 - w), vsc(aim, w)));
}

const SKIN_HIT = hx('#fff8e0');
const drumPat =
  (hit: boolean) =>
  (u: number, v: number, side: boolean): Tone | RGBA | null =>
    side
      ? Math.floor((u + 1) * 5) % 2
        ? P.gold
        : P.red
      : u * u + v * v > 0.8
        ? P.gold
        : hit
          ? SKIN_HIT
          : P.cream;

interface Built {
  rig: Rig;
  j: Joints;
  top: V3;
  tips: [V3, V3];
}

/** Риг: тело, кивер, барабан, палочки (`drop` — палочки лежат на полу, подскок). */
function drumRig(q: DP, hit = false, drop = -1): Built {
  const rig = new Rig();
  const j = humanoid(rig, DRUM_BODY, q);
  const R = DRUM_BODY.head;
  rig.dot(onHead(j, R, 0.95, -0.35, 0.1), INK, 1);
  rig.dot(onHead(j, R, 0.95, 0.35, 0.1), INK, 1);
  rig.dot(onHead(j, R, 0.98, -0.55, -0.25), P.red[2], 1);
  rig.dot(onHead(j, R, 0.98, 0.55, -0.25), P.red[2], 1);
  // Кивер: козырёк, помпон спереди сверху (отстаёт).
  const hb = onHead(j, R, 0, 0, 0.7);
  const ht = vadd(hb, vsc(j.hUp, 3.4));
  rig.cap(hb, ht, 2.8, 3, P.red, band(0, 0.25, P.gold));
  rig.cap(onHead(j, R, 0.92, -0.5, 0.42), onHead(j, R, 0.92, 0.5, 0.42), 0.45, 0.45, P.black);
  const pp = vadd(vadd(ht, vsc(j.hFwd, 1.5 + q.pl * 1.3)), vsc(j.hUp, 0.9 - Math.abs(q.pl) * 0.4));
  rig.ball(pp, 1.1, P.cream);
  const top = drumTop(j, q);
  rig.disc(top, DRUM_R, DRUM_H, P.red, drumPat(hit));
  const tips: [V3, V3] = [top, top];
  ([-1, 1] as const).forEach((s, i) => {
    const ha = s < 0 ? j.haL : j.haR;
    let a: V3;
    let d: V3;
    if (drop >= 0) {
      // Выпала из руки: лежит у кисти, наискось.
      d = vnorm(v3(s * 0.55 + (s < 0 ? 0.15 : -0.1), 0, 1));
      a = v3(ha.x - d.x * 2, 0.6 + drop, ha.z - d.z * 2);
    } else {
      d = stickDir(j, q, s, top);
      a = vadd(ha, vsc(d, -0.8));
    }
    const tip = vadd(a, vsc(d, STICK + (drop >= 0 ? 0 : 0.8)));
    rig.cap(a, tip, 0.5, 0.42, P.cream);
    rig.ball(tip, 0.85, P.cream);
    tips[i] = tip;
  });
  return { rig, j, top, tips };
}

/** Палочки на экране в момент `ta` трека: [внутренний край, остриё] для левой и правой. */
function sticksAt(q: DP, Pj: Proj2): [number, number, number, number][] {
  const j = humanoid(new Rig(), DRUM_BODY, q);
  const top = drumTop(j, q);
  return ([-1, 1] as const).map((s) => {
    const ha = s < 0 ? j.haL : j.haR;
    const d = stickDir(j, q, s, top);
    const a = Pj(vadd(ha, vsc(d, 2.5)));
    const b = Pj(vadd(ha, vsc(d, STICK)));
    return [a[0], a[1], b[0], b[1]];
  });
}

/** След обеих палочек: от `ta` назад во времени по треку `at`. */
function smear2(lit: () => Px, Pj: Proj2, at: (t: number) => DP, ta: number, a0: number) {
  const L: [number, number, number, number][] = [];
  const Rr: [number, number, number, number][] = [];
  for (let i = 0; i <= 6; i++) {
    const [l, r] = sticksAt(at(ta - i / 96), Pj);
    L.push(l);
    Rr.push(r);
  }
  smearInto(lit(), L, SMEAR_C, a0);
  smearInto(lit(), Rr, SMEAR_C, a0);
}

const SMEAR_C = hx('#fff2cc');
const SPARK_C = hx('#ffffff');
const RING_C = hx('#ffe08a');
const WOOD: readonly RGBA[] = [hx('#c89a5a'), hx('#f0d8a0'), hx('#5a3a1c'), P.blue[2]];

const meleeAt = (ta: number) => (ta < W ? track(ta, WIND) : track(ta - W, REC));
const beatAt = (T: number) => (ta: number) =>
  ta < T ? track(ta, T < 0.6 ? DRUMF_K : DRUM_K) : track(ta - T, DREC);

const K = kindOf('f13_drummer', 64, 60, 32, 46, 1600);

const dPic = (anim: string, f: number, d: number): Pic => {
  const q = dPose(anim, f);
  const yaw = yawN(d);
  const hit = anim === 'drec' && f <= 1;
  const drop = anim === 'die' && f >= 10 ? [1.4, 0.5, 0][Math.min(2, f - 10)] : -1;
  const { rig, j, top, tips } = drumRig(q, hit, drop);
  return draw(K, rig, yaw, (o, Pj, lit) => {
    // Ближний бой: след палочек в разгоне и на контакте, искры на остриях.
    if (anim === 'wind' || anim === 'rec') {
      const ta = anim === 'wind' ? tf(f) : W + tf(f);
      if (ta >= tf(15) && ta <= W + tf(1)) smear2(lit, Pj, meleeAt, ta, ta >= W ? 0.8 : 0.6);
      if (anim === 'rec' && f <= 1)
        for (const tp of tips) {
          const [x, y] = Pj(tp);
          spark(lit(), x, y, SPARK_C, f === 0 ? 1 : 0.6);
        }
    }
    // Кольцо: след палочек вниз, вспышка кожи, волна по ободу.
    if (anim === 'drum' || anim === 'drumf' || anim === 'drec') {
      const T = anim === 'drumf' ? 0.5 : 0.75;
      const ta = anim === 'drec' ? T + tf(f) : tf(f);
      if (ta >= T - tf(2) && ta <= T + tf(1)) smear2(lit, Pj, beatAt(T), ta, ta >= T ? 0.8 : 0.6);
      if (anim === 'drec' && f <= 3) {
        const [cx, cy] = Pj(top);
        const k = f / 3;
        const rx = DRUM_R * (1 + 0.5 * k) + 1;
        const L = lit();
        for (let i = 0; i < 24; i++) {
          const a = (i / 24) * TAU;
          L.set(cx + Math.cos(a) * rx, cy + Math.sin(a) * rx * 0.56, [
            RING_C[0],
            RING_C[1],
            RING_C[2],
            Math.round(255 * (1 - k * 0.7)),
          ]);
        }
        if (f <= 1)
          for (const tp of tips) {
            const [x, y] = Pj(tp);
            spark(L, x, y, SPARK_C, f === 0 ? 1 : 0.6);
          }
      }
    }
    if (anim === 'die' && f >= 9 && f <= 17) {
      const [x, y] = Pj(vadd(j.pelvis, v3(0, -j.pelvis.y, 0)));
      puff(o.px, x, y, (f - 8.5) / 9, 43, WOOD, 9, 9);
    }
  });
};

// ---- рисовальщик -------------------------------------------------------------

const TECH = new Set(['windup', 'recover', 'stun', 'alert', 'f13_drum']);

/** Кадр покоя по такту игры (восьмые, два такта на круг); вне игры — по часам. */
function idleF(now: number, id: number): number {
  const b = F13_FX.beat > 0 ? F13_FX.beat : now / 0.75 + hash(id, 7) * 2;
  return ((Math.floor(b * 8) % IDLE_N) + IDLE_N) % IDLE_N;
}

registerMobPainter('f13_drummer', (m: Mob, pose: MobPose): MobFrame => {
  const md = pose.mode;
  const t = pose.t || 0;
  const now = pose.now || 0;
  const id = m.id ?? 0;
  const crawl = !!m.data?.crawl;
  const want = TECH.has(md) && !crawl ? (m.face ?? 0) : headOf(m);
  const v = visOf(m, pose, want, md === 'windup' ? 6 : 9);
  const d = dirN(v.yaw);
  const fx = Math.cos(v.yaw);
  const fy = Math.sin(v.yaw) * 0.56;
  const ex: Partial<MobFrame> = { shadow: 7 };
  let anim = 'idle';
  let f = 0;
  if (md === 'dying') {
    anim = 'die';
    f = fi(t, DIE_N - 1);
    ex.linger = 0.85;
    ex.alpha = 1 - sstep(0.62, 0.85, t);
    ex.shadow = 7 * (1 - sstep(0.3, 0.7, t));
  } else if (crawl) {
    anim = 'crawl';
    f = Math.floor((v.dist / 0.6) * 8) % 8;
  } else if (md === 'f13_drum') {
    const fast = (m.data?.drumLen ?? 0.75) < 0.6;
    anim = fast ? 'drumf' : 'drum';
    f = fi(t, (fast ? DRUMF_N : DRUM_N) - 1);
  } else if (md === 'recover' && v.prev === 'f13_drum' && t < 0.45) {
    anim = 'drec';
    f = fi(t, DREC_N - 1);
    // Вес: удар в кожу вжимает куклу.
    const k = 1 - sstep(0, 0.14, t);
    ex.sx = 1 + 0.12 * k;
    ex.sy = 1 - 0.12 * k;
  } else if (md === 'windup') {
    anim = 'wind';
    f = fi(t, WIND_N - 1);
    // Перед ударом откачнулся назад, в разгоне — вперёд.
    const back = sstep(0.12, 0.36, t) * (1 - sstep(0.62, W, t));
    ex.dx = -fx * 0.9 * back;
    ex.dy = -fy * 0.9 * back;
  } else if (md === 'recover' && t < 0.45) {
    anim = 'rec';
    f = fi(t, REC_N - 1);
    const k = 1 - sstep(0, 0.16, t);
    ex.sx = 1 + 0.1 * k;
    ex.sy = 1 - 0.1 * k;
    const lunge = 1.5 * (1 - sstep(0.04, 0.3, t));
    ex.dx = fx * lunge;
    ex.dy = fy * lunge;
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
    f = idleF(now, id);
  }
  if (md !== 'dying') hurtFx(v, now, 1.0, ex);
  return { ...frameOf(K, anim, f, d, pose, () => dPic(anim, f, d)), ...ex };
});

registerMobWarm('f13_drummer', function* () {
  yield* warmAll(
    K,
    [
      ['idle', IDLE_N],
      ['walk', WALK_N],
      ['drum', DRUM_N],
      ['drumf', DRUMF_N],
      ['drec', DREC_N],
      ['wind', WIND_N],
      ['rec', REC_N],
      ['hu', HURT_N],
      ['die', DIE_N],
      ['reel', 15],
      ['al', 9],
      // Нити срезаны — ползёт; в темноте ищет; в яме молчит; спит на посту.
      ['crawl', 8],
      ['lost', 12],
      ['sl0', 4],
      ['sl1', 4],
    ],
    dPic,
  );
});
