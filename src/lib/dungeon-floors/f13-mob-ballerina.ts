// Балерина-волчок (анимации мобов 13). Облик прежний: фарфоровая кукла в
// розовой пачке, пучок волос, на одной нити.
//
// Треки 24 к/с от времени режима (`f13-brains.ts` `SPIN`, `melee`):
// - удар ногой — гран батман: деми-плие, ножка в ретире, выброс вперёд;
//   урон в конце `windup` 0,6 с, кадр контакта — первый кадр `recover`;
//   проводка — нога выше головы, приземление в плие, возврат;
// - `f13_plie` 0,6 с — подготовка к туру: глубокое плие с закруткой корпуса;
// - `f13_spin` 2,5 с — фуэте на пуанте: свой курс 14 рад/с (лицо мозга в
//   волчке — курс погони), руки в стороны со следом, пачка трепещет;
// - `dizzy` 1,8 с — голова кругом, звёздочки над головой;
// - смерть — «умирающий лебедь»: нить дёрнула вверх и отпустила.
// Шаг — па-де-бурре на пуантах, по пути.

import { registerMobPainter, registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import {
  BALL_BODY,
  INK,
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
import type { Joints, Pose, RGBA, Tone, V3 } from './f13-art';
import {
  TAU,
  dangleP,
  crawlP,
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

/** Поза балерины: + пачка (`tu` — раскрытие, 0…1) и вытянутая стопа ударной ноги `pt`. */
interface BP extends Pose {
  tu: number;
  pt: number;
}

const W = 0.6;
const WIND_N = 15;
const REC_N = 11;
const PLIE_N = 15;
const SPIN_N = 4;
const DZ_N = 12;
const HURT_N = 8;
const DIE_N = 21;
const WALK_N = 12;
const STRIDE = 1.2;
const IDLE_N = 8;
const SPIN_W = 14;

/** Руки «овалом» (подготовительная позиция), на полупальцах. */
const oval = (q: Pose): BP => ({
  ...q,
  aL: limb(0.9 + q.aL.sw * 0.3, 0.6, 1.1),
  aR: limb(0.9 + q.aR.sw * 0.3, 0.6, 1.1),
  bob: q.bob + 1.2,
  toe: 1.0,
  tu: 0,
  pt: 0,
});
const B0: BP = oval(dangleP(0));
const bp = (o: Partial<BP>, b: BP = B0): BP => ({ ...b, ...o });

// ---- гран батман (удар) --------------------------------------------------------

const G = B0;
/** Деми-плие, руки раскрываются во вторую позицию. */
const A1 = bp({
  bob: 0.4,
  sink: 1.5,
  lean: 0.12,
  hp: 0.12,
  aL: limb(0.25, 1.25, 0.25),
  aR: limb(0.25, 1.25, 0.25),
  lL: limb(0.3, 0.45, 0.85),
  lR: limb(0.3, 0.45, 0.85),
  toe: 0.2,
});
/** Нить вздёрнула на пуант, ножка в ретире, корпус закручен. */
const A2 = bp({
  bob: 2.2,
  lean: -0.15,
  twist: -0.3,
  hp: -0.15,
  aL: limb(1.9, 0.9, 0.5),
  aR: limb(2.3, 0.6, 0.6),
  lL: limb(0.02, 0.04, 0),
  lR: limb(1.35, 0.3, 1.5),
  toe: 1.2,
  tu: 0.2,
});
const A3 = bp({ bob: 2.5, lean: -0.2, twist: -0.42, lR: limb(1.5, 0.28, 1.75) }, A2);
/** Контакт: нога выброшена вперёд выше пояса, руки вразлёт. */
const C = bp({
  bob: 1.8,
  sink: 0,
  lean: -0.32,
  twist: 0.3,
  hp: -0.1,
  aL: limb(2.5, 0.75, 0.15),
  aR: limb(0.9, 1.35, 0.1),
  lL: limb(-0.05, 0.03, 0),
  lR: limb(1.8, 0.04, 0),
  toe: 1.2,
  tu: 0.5,
  pt: 1,
});
/** Проводка: нога выше головы, нить тянет вверх. */
const FT = bp({ bob: 2.6, lean: -0.42, hp: -0.2, lR: limb(2.35, 0.06, 0), tu: 0.6 }, C);
/** Приземление в плие. */
const R1 = bp({
  bob: 0.3,
  sink: 1.3,
  lean: 0.15,
  twist: 0.1,
  hp: 0.15,
  aL: limb(0.6, 1.0, 0.4),
  aR: limb(0.5, 1.1, 0.4),
  lL: limb(0.25, 0.4, 0.8),
  lR: limb(0.35, 0.4, 0.8),
  toe: 0.2,
  tu: 0.3,
  pt: 0,
});

const WIND: PKey<BP>[] = [
  [0, G],
  [0.1, A1, easeOut],
  [0.34, A2, easeOut],
  [0.5, A3, lin],
  [0.61, C, easeIn],
];
const REC: PKey<BP>[] = [
  [0, C],
  [0.083, FT, easeOut],
  [0.21, R1, easeIn],
  [0.42, G, eBack],
];

// ---- плие перед туром и сам тур -----------------------------------------------

const P1 = bp({
  bob: 0.6,
  sink: 1.2,
  aL: limb(0.3, 1.3, 0.2),
  aR: limb(0.3, 1.3, 0.2),
  lL: limb(0.3, 0.45, 0.8),
  lR: limb(0.3, 0.45, 0.8),
  toe: 0.1,
});
const P2 = bp({
  bob: 0,
  sink: 2.8,
  lean: 0.1,
  hp: 0.1,
  twist: -0.55,
  aL: limb(0.2, 1.4, 0.2),
  aR: limb(1.3, 0.5, 1.2),
  lL: limb(0.4, 0.55, 1.1),
  lR: limb(0.4, 0.55, 1.1),
  toe: 0,
  tu: 0.1,
});
const P3 = bp({ sink: 3.1, twist: -0.68, lean: 0.14, hp: 0.14 }, P2);
/** Поза тура: пуант, ножка в ретире, руки в стороны — лезвия волчка. */
const S = bp({
  bob: 2.6,
  sink: 0,
  lean: 0,
  twist: 0,
  hp: -0.08,
  aL: limb(0.25, 1.4, 0.25),
  aR: limb(0.25, 1.4, 0.25),
  lL: limb(0, 0.02, 0),
  lR: limb(1.2, 0.6, 1.6),
  toe: 1.25,
  tu: 1,
});
const PLIE: PKey<BP>[] = [
  [0, G],
  [0.12, P1, easeOut],
  [0.38, P2, easeOut],
  [0.52, P3, lin],
  [0.62, S, easeIn],
];

// ---- смерть: «умирающий лебедь» -------------------------------------------------

const D1 = bp({
  bob: 3.2,
  hp: -0.5,
  lean: -0.25,
  aL: limb(2.9, 0.35, 0.6),
  aR: limb(2.8, 0.4, 0.6),
  lR: limb(0.3, 0.15, 0.4),
  toe: 1.3,
  tu: 0.4,
});
const D2 = bp({
  bob: 0,
  sink: 4,
  lean: 0.45,
  hp: 0.5,
  hr: 0.3,
  aL: limb(0.6, 1.2, 0.4),
  aR: limb(0.4, 1.3, 0.5),
  lL: limb(0.6, 0.35, 1.4),
  lR: limb(0.7, 0.3, 1.6),
  toe: 0.4,
  tu: 0.2,
});
/** Сидит на полу: ножка вытянута, руки-крылья легли вдоль неё, голова к колену. */
const D3 = bp({
  sink: 7.6,
  lean: 1.0,
  side: 0.12,
  hp: 0.7,
  hr: 0.35,
  aL: limb(1.35, 0.35, 0.2),
  aR: limb(1.25, 0.3, 0.25),
  lL: limb(1.5, 0.2, 0),
  lR: limb(1.2, 0.6, 2.6),
  toe: 0.9,
  tu: 0,
});
const D4 = bp({ sink: 7.0, lean: 0.9, hp: 0.55 }, D3);
const DIE: PKey<BP>[] = [
  [0, G],
  [0.08, D1, easeOut],
  [0.3, D2, easeIn],
  [0.48, D3, easeIn],
  [0.55, D4, easeOut],
  [0.62, D3, easeIn],
];

// ---- поза по анимации и кадру ------------------------------------------------

function bPose(anim: string, f: number): BP {
  const t = tf(f);
  switch (anim) {
    case 'wind':
      return track(t, WIND);
    case 'rec':
      return track(t, REC);
    case 'plie':
      return track(t, PLIE);
    case 'spin': {
      // Пачка трепещет, руки чуть «дышат».
      const s = Math.sin((f / SPIN_N) * TAU);
      return bp({ bob: S.bob + 0.3 * s, aL: limb(0.25 + 0.1 * s, 1.4, 0.25) }, S);
    }
    case 'dz': {
      // Голова кругом: корпус описывает круг, руки ловят равновесие (2 Гц).
      const ph = (f / DZ_N) * TAU;
      const s = Math.sin(ph);
      const c = Math.cos(ph);
      return bp({
        bob: 0.4,
        toe: 0.2,
        tu: 0.15,
        side: 0.22 * s,
        lean: 0.12 * c,
        hr: 0.35 * Math.sin(ph + 1),
        hy: 0.4 * c,
        aL: limb(0.3 + 0.3 * c, 1.0 + 0.3 * s, 0.3),
        aR: limb(0.3 - 0.3 * c, 1.1 - 0.3 * s, 0.4),
        lL: limb(0.15 * s, 0.25, 0.3),
        lR: limb(-0.15 * s, 0.25, 0.3),
      });
    }
    case 'hu':
      return hurtP(G, t) as BP;
    case 'die':
      return track(t, DIE);
    case 'reel':
      return bp({ ...reelP(t), toe: 0.6 });
    case 'al': {
      const k = Math.sin(Math.PI * Math.min(1, t / 0.35));
      return bp({
        bob: G.bob + 2 * k,
        hp: -0.3 * k,
        aL: limb(0.9 + 1.4 * k, 0.6, 1.1 - 0.6 * k),
        aR: limb(0.9 + 1.4 * k, 0.6, 1.1 - 0.6 * k),
        toe: 1.0 + 0.2 * k,
      });
    }
    case 'walk': {
      // Па-де-бурре: мелкий частый шаг на пуантах, руки держат овал.
      const ph = (f / WALK_N) * TAU;
      const g = oval(gaitP(ph, 0.55));
      return { ...g, bob: g.bob + 0.4, toe: 1.15, lean: 0.08 };
    }
    case 'crawl':
      return bp({ ...crawlP((f / 8) * TAU), toe: 0.5 });
    case 'lost':
      return bp({ ...gropeP((f / 12) * TAU), toe: 1.0 });
    case 'wait': {
      // Разминается у кулисы: рука на «станке», ножка тянется назад.
      const s = Math.sin((f / 8) * TAU);
      return bp({
        aL: limb(1.2, 0.9, 0.9),
        aR: limb(0.6, 1.2, 0.3),
        lR: limb(-0.5 - 0.2 * s, 0.1, 0),
        lean: 0.12 + 0.05 * s,
        hp: -0.1,
      });
    }
    case 'sl1':
    case 'sl0': {
      const q = slumpP(anim === 'sl1' ? 1 : 0.6);
      q.bob += f === 1 || f === 2 ? 0.4 : 0;
      return bp({ ...q, toe: 0.3 });
    }
  }
  const q = oval(dangleP((f / IDLE_N) * TAU));
  // Голова чуть наклонена — позирует.
  q.hr += 0.12;
  return q;
}

// ---- рисунок -----------------------------------------------------------------

const TUTU =
  (k: number) =>
  (u: number, v: number, side: boolean): Tone => {
    if (side) return P.pink;
    const a = Math.atan2(v, u);
    const r = Math.hypot(u, v);
    return Math.floor(a * 4 + r * 3 + k * 3) % 2 === 0 ? P.pink : P.porcelain;
  };

function balRig(q: BP, f = 0): { rig: Rig; j: Joints } {
  const rig = new Rig();
  const j = humanoid(rig, BALL_BODY, q);
  const R = BALL_BODY.head;
  rig.dot(onHead(j, R, 0.95, -0.35, 0.1), INK, 1);
  rig.dot(onHead(j, R, 0.95, 0.35, 0.1), INK, 1);
  rig.dot(onHead(j, R, 0.98, -0.5, -0.3), P.pink[2], 1);
  rig.dot(onHead(j, R, 0.98, 0.5, -0.3), P.pink[2], 1);
  // Пучок волос.
  rig.ball(onHead(j, R, -0.4, 0, 0.9), 1.6, P.wood);
  rig.dot(onHead(j, R, 0.3, 0, 1.0), P.gold[3], 1);
  // Пачка: в туре раскрывается шире и тоньше.
  const tu = vadd(j.pelvis, vsc(j.up, 1.2 + 0.3 * q.tu));
  rig.disc(tu, 7.2 + 1.6 * q.tu, 1.6 - 0.6 * q.tu, P.pink, TUTU(f));
  // Вытянутый носок ударной ноги.
  if (q.pt > 0.05) {
    const d = vnorm(vadd(j.anR, vsc(j.knR, -1)));
    rig.cap(j.anR, vadd(j.anR, vsc(d, 1.7 * q.pt)), 0.85, 0.5, P.pink);
  }
  return { rig, j };
}

/** Нога на экране в момент `ta` от начала замаха: [голень, носок]. */
function legAt(ta: number, Pj: Proj2): [number, number, number, number] {
  const q = ta < W ? track(ta, WIND) : track(ta - W, REC);
  const j = humanoid(new Rig(), BALL_BODY, q);
  const toe = vadd(j.anR, vsc(vnorm(vadd(j.anR, vsc(j.knR, -1))), 1.7));
  const a = Pj(vadd(j.knR, vsc(vadd(j.anR, vsc(j.knR, -1)), 0.3)));
  const b = Pj(toe);
  return [a[0], a[1], b[0], b[1]];
}

const SMEAR_C = hx('#ffe6f0');
const SPARK_C = hx('#ffffff');
const STAR_C = hx('#ffe08a');
const CHIPS: readonly RGBA[] = [P.porcelain[2], P.porcelain[3], P.pink[2], P.porcelain[1]];

const K = kindOf('f13_ballerina', 64, 62, 32, 50, 1300);

const bPic = (anim: string, f: number, d: number): Pic => {
  const q = bPose(anim, f);
  const yaw = yawN(d);
  const { rig, j } = balRig(q, f);
  return draw(K, rig, yaw, (o, Pj, lit) => {
    // След ноги: разгон и контакт.
    const ta = anim === 'wind' ? tf(f) : anim === 'rec' ? W + tf(f) : -1;
    if (ta >= tf(12) && ta <= W + tf(1)) {
      const segs: [number, number, number, number][] = [];
      for (let i = 0; i <= 6; i++) segs.push(legAt(ta - i / 96, Pj));
      smearInto(lit(), segs, SMEAR_C, ta >= W ? 0.75 : 0.55);
    }
    if (anim === 'rec' && f === 0) {
      const toe = vadd(j.anR, vsc(vnorm(vadd(j.anR, vsc(j.knR, -1))), 1.7));
      const [x, y] = Pj(toe);
      spark(lit(), x, y, SPARK_C, 1);
    }
    if (anim === 'spin') {
      // Руки-лезвия: след по кругу за кистями (курс назад, против вращения).
      for (const [el, ha] of [
        [j.elL, j.haL],
        [j.elR, j.haR],
      ] as [V3, V3][]) {
        const segs: [number, number, number, number][] = [];
        for (let i = 0; i <= 5; i++) {
          const Pq = i === 0 ? Pj : projOf(K, yaw - i * 0.16);
          const a = Pq(el);
          const b = Pq(vadd(ha, vsc(vnorm(vadd(ha, vsc(el, -1))), 1)));
          segs.push([a[0], a[1], b[0], b[1]]);
        }
        smearInto(o.px, segs, SMEAR_C, 0.5);
      }
    }
    if (anim === 'dz') {
      // Звёздочки кружат над головой.
      const [cx, cy] = Pj(vadd(j.head, vsc(j.hUp, BALL_BODY.head * 1.7)));
      for (let i = 0; i < 3; i++) {
        const a = (f / DZ_N) * TAU + (i * TAU) / 3;
        spark(lit(), cx + Math.cos(a) * 4.5, cy + Math.sin(a) * 1.6, STAR_C, i === 0 ? 1 : 0.7);
      }
    }
    if (anim === 'die' && f >= 10 && f <= 18) {
      const [x, y] = Pj(vadd(j.pelvis, v3(0, -j.pelvis.y, 0)));
      puff(o.px, x, y, (f - 9.5) / 9.5, 43, CHIPS, 8, 8);
    }
  });
};

// ---- рисовальщик -------------------------------------------------------------

const TECH = new Set(['windup', 'recover', 'stun', 'alert', 'f13_plie', 'dizzy']);

registerMobPainter('f13_ballerina', (m: Mob, pose: MobPose): MobFrame => {
  const md = pose.mode;
  const t = pose.t || 0;
  const now = pose.now || 0;
  const id = m.id ?? 0;
  const crawl = !!m.data?.crawl;
  const want = TECH.has(md) && !crawl ? (m.face ?? 0) : headOf(m);
  const v = visOf(m, pose, want, md === 'windup' || md === 'f13_plie' ? 6 : 10);
  let d = dirN(v.yaw);
  const fx = Math.cos(v.yaw);
  const fy = Math.sin(v.yaw) * 0.56;
  const ex: Partial<MobFrame> = { shadow: 6 };
  let anim = 'idle';
  let f = 0;
  if (md === 'dying') {
    anim = 'die';
    f = fi(t, DIE_N - 1);
    ex.linger = 0.85;
    ex.alpha = 1 - sstep(0.62, 0.85, t);
    ex.shadow = 6 * (1 - sstep(0.3, 0.7, t));
  } else if (crawl) {
    anim = 'crawl';
    f = Math.floor((v.dist / 0.6) * 8) % 8;
  } else if (md === 'f13_spin') {
    // Свой курс волчка: лицо мозга здесь — курс погони.
    anim = 'spin';
    f = Math.floor(now * 24) % SPIN_N;
    v.yaw = hash(id, 5) * TAU + SPIN_W * t;
    d = dirN(v.yaw);
    ex.ghost = { every: 0.05, life: 0.18, tint: '#ffc8e0', alpha: 0.5 };
    ex.still = true;
  } else if (md === 'f13_plie') {
    anim = 'plie';
    f = fi(t, PLIE_N - 1);
    ex.still = true;
  } else if (md === 'windup') {
    anim = 'wind';
    f = fi(t, WIND_N - 1);
    const back = sstep(0.1, 0.34, t) * (1 - sstep(0.5, 0.6, t));
    ex.dx = -fx * 0.6 * back;
    ex.dy = -fy * 0.6 * back;
  } else if (md === 'recover' && t < 0.45) {
    anim = 'rec';
    f = fi(t, REC_N - 1);
    const lunge = 1.2 * (1 - sstep(0.04, 0.3, t));
    ex.dx = fx * lunge;
    ex.dy = fy * lunge;
    // Приземление после батмана — вжатие.
    const k = Math.sin(Math.PI * Math.min(1, Math.max(0, (t - 0.12) / 0.14)));
    ex.sx = 1 + 0.06 * k;
    ex.sy = 1 - 0.06 * k;
  } else if (md === 'dizzy') {
    anim = 'dz';
    f = Math.floor(t * 24) % DZ_N;
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
  // В туре неуязвима — удар звенит, кукла не вздрагивает.
  if (md !== 'dying' && md !== 'f13_spin') hurtFx(v, now, 1.4, ex);
  return { ...frameOf(K, anim, f, d, pose, () => bPic(anim, f, d)), ...ex };
});

registerMobWarm('f13_ballerina', function* () {
  yield* warmAll(
    K,
    [
      ['idle', IDLE_N],
      ['walk', WALK_N],
      ['wind', WIND_N],
      ['rec', REC_N],
      ['plie', PLIE_N],
      ['spin', SPIN_N],
      ['dz', DZ_N],
      ['hu', HURT_N],
      ['die', DIE_N],
      ['reel', 15],
      ['al', 9],
      ['lost', 12],
    ],
    bPic,
  );
});
