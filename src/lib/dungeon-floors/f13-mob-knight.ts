// Рыцарь-марионетка (анимации мобов 13). Облик прежний: деревянная кукла в
// серебряных латах, красный плюмаж, круглый щит слева, меч справа.
//
// Рубка сверху — трек 24 к/с от времени режима (`f13-brains.ts` `melee`:
// урон в конце `windup` 0,72 с, тем же шагом — `recover`; кадр контакта —
// первый кадр `recover`). Замах: нити поддёргивают куклу (приседает — и её
// вздёргивает вверх, ноги повисли), меч уходит за голову, держит на пике;
// удар — разгоном за три кадра со следом, контакт с приседом и вжатием,
// проводка — клинок в пол (щепа и пыль), отдача — нити тянут вверх, возврат
// с перелётом. Плюмаж отстаёт. Шаг — по пути, 12 кадров на 1,5 клетки.

import { registerMobPainter, registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
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
  vmix,
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

/** Поза рыцаря: + меч (поправка к предплечью: вперёд `sf`, вверх `su`), плюмаж `pl`. */
interface KP extends Pose {
  sf: number;
  su: number;
  pl: number;
}
const K0: KP = { ...dangleP(0), sf: 0.6, su: 0.6, pl: 0 };
const kp = (o: Partial<KP>, b: KP = K0): KP => ({ ...b, ...o });

const W = 0.72;
const WIND_N = 18;
const REC_N = 11;
const HURT_N = 8;
const DIE_N = 21;
const WALK_N = 12;
const STRIDE = 1.5;
const IDLE_N = 8;
const SWORD = 10;

// ---- ключи рубки ------------------------------------------------------------

/** Стойка: как покой на нитях, меч вперёд-вниз. */
const G = kp({});
/** Предзамах: присел, меч опустил — собирается. */
const A1 = kp({
  bob: 0.2,
  sink: 0.9,
  lean: 0.22,
  twist: 0.18,
  hp: 0.18,
  aR: limb(0.3, 0.22, 0.75),
  aL: limb(0.45, 0.3, 0.8),
  lL: limb(0.15, 0.06, 0.4),
  lR: limb(-0.1, 0.06, 0.35),
  sf: 0.9,
  su: 0.1,
  pl: 0.18,
});
/** Нити вздёрнули: меч за головой, корпус откинут, ноги повисли. */
const A2 = kp({
  bob: 2.6,
  lean: -0.22,
  twist: -0.5,
  side: -0.05,
  hp: -0.25,
  aR: limb(2.85, 0.28, 0.85),
  aL: limb(1.15, 0.4, 0.75),
  lL: limb(0.3, 0.08, 0.6),
  lR: limb(-0.12, 0.08, 0.35),
  toe: 0.5,
  sf: -0.7,
  su: 0.1,
  pl: -0.35,
});
/** Пик: держит, дотягивает — нить звенит. */
const A3 = kp({ twist: -0.6, lean: -0.27, bob: 2.9, aR: limb(2.98, 0.28, 0.92), pl: -0.2 }, A2);
/** Контакт: клинок в цели, кукла упала на ногу, вжалась. */
const C = kp({
  bob: 0,
  sink: 1.6,
  lean: 0.5,
  twist: 0.45,
  side: 0.06,
  hp: 0.3,
  aR: limb(1.25, 0.2, 0.2),
  aL: limb(0.15, 0.55, 0.5),
  lL: limb(0.55, 0.1, 0.35),
  lR: limb(-0.45, 0.1, 0.25),
  toe: 0,
  sf: 0.7,
  su: -0.5,
  pl: 0.3,
});
/** Проводка: клинок ушёл в пол за цель. */
const FT = kp(
  {
    sink: 2.3,
    lean: 0.62,
    twist: 0.55,
    hp: 0.38,
    aR: limb(0.75, 0.2, 0.1),
    sf: 0.5,
    su: -0.9,
    pl: 0.6,
  },
  C,
);
/** Отдача: нити тянут вверх. */
const R1 = kp({
  bob: 0.8,
  sink: 0.7,
  lean: 0.25,
  twist: 0.2,
  hp: 0.15,
  aR: limb(0.6, 0.18, 0.4),
  aL: limb(0.3, 0.3, 0.5),
  lL: limb(0.25, 0.06, 0.3),
  lR: limb(-0.2, 0.06, 0.25),
  sf: 0.6,
  su: 0.1,
  pl: 0.05,
});

const WIND: PKey<KP>[] = [
  [0, G],
  [0.12, A1],
  [0.4, A2, easeOut],
  [0.6, A3, lin],
  [0.73, C, easeIn],
];
const REC: PKey<KP>[] = [
  [0, C],
  [0.083, FT, easeOut],
  [0.2, R1],
  [0.42, G, eBack],
];

// ---- смерть: нити дёрнули в последний раз и лопнули — кукла осыпается ----------

const D1 = kp({
  bob: 3.2,
  hp: -0.55,
  lean: -0.3,
  aL: limb(2.1, 0.7, 0.2),
  aR: limb(1.9, 0.8, 0.3),
  lL: limb(0.3, 0.2, 0.5),
  lR: limb(-0.2, 0.15, 0.4),
  toe: 0.7,
  pl: -0.4,
  su: 0.8,
});
const D2 = kp({
  sink: 8,
  bob: 0,
  lean: 1.1,
  side: 0.5,
  hp: 0.6,
  hr: 0.6,
  aL: limb(0.4, 1.4, 0.1),
  aR: limb(0.6, 1.3, 0.4),
  lL: limb(-0.9, 0.5, 0.9),
  lR: limb(1.0, 0.4, 0.6),
  toe: 0,
  pl: 0.6,
  sf: 1.2,
  su: -0.6,
});
const D3 = kp({ sink: 6.6, lean: 0.98, hp: 0.42, pl: 0.2 }, D2);
const DIE: PKey<KP>[] = [
  [0, G],
  [0.08, D1, easeOut],
  [0.4, D2, easeIn],
  [0.48, D3, easeOut],
  [0.58, D2, easeIn],
];

// ---- поза по анимации и кадру ------------------------------------------------

function kPose(anim: string, f: number): KP {
  const t = tf(f);
  switch (anim) {
    case 'wind':
      return track(t, WIND);
    case 'rec':
      return track(t, REC);
    case 'hu':
      return hurtP(G, t) as KP;
    case 'die':
      return track(t, DIE);
    case 'reel':
      return kp(reelP(t));
    case 'al': {
      const k = Math.sin(Math.PI * Math.min(1, t / 0.35));
      return kp({
        bob: 1 + 2.4 * k,
        hp: -0.3 * k,
        aL: limb(0.5 * k, 0.12 + 0.5 * k, 0.4),
        aR: limb(0.5 * k, 0.12 + 0.5 * k, 0.4),
        pl: -0.3 * k,
      });
    }
    case 'walk': {
      const ph = (f / WALK_N) * TAU;
      const g = gaitP(ph);
      // Меч держит перед собой: рука ходит вполсилы.
      g.aR = limb(0.2 + g.aR.sw * 0.4, 0.18, 0.5);
      return kp({ ...g, pl: -0.12 * Math.abs(Math.sin(ph)) });
    }
    case 'crawl':
      return kp(crawlP((f / 8) * TAU));
    case 'lost':
      return kp(gropeP((f / 12) * TAU));
    case 'wait': {
      const q = dangleP((f / 8) * TAU);
      // Курит в кулуарах: рука к лицу, меч остриём вниз.
      q.aR = limb(1.4, 0.3, 1.9);
      q.hp = -0.15;
      return kp({ ...q, sf: 0.2, su: -1.6 });
    }
    case 'sl1':
    case 'sl0': {
      const q = slumpP(anim === 'sl1' ? 1 : 0.6);
      q.bob += f === 1 || f === 2 ? 0.4 : 0;
      return kp(q);
    }
  }
  return kp(dangleP((f / IDLE_N) * TAU));
}

// ---- рисунок -----------------------------------------------------------------

const SHIELD = (_t: number, nx: number, ny: number): Tone | null =>
  Math.abs(nx) < 0.18 || Math.abs(ny) < 0.18 ? P.gold : Math.hypot(nx, ny) > 0.82 ? P.gold : null;

const swordDir = (j: Joints, q: KP): V3 =>
  vnorm(vadd(j.foreR, vadd(vsc(j.fwd, q.sf), v3(0, q.su, 0))));

function sword(rig: Rig, hand: V3, dir: V3): void {
  const tip = vadd(hand, vsc(dir, SWORD));
  const guardA = vadd(hand, vsc(dir, 1.2));
  rig.cap(vadd(hand, vsc(dir, -1.4)), hand, 0.55, 0.55, P.wood);
  rig.cap(guardA, tip, 0.85, 0.35, P.silver);
  const side = vnorm(v3(-dir.z, 0, dir.x));
  rig.cap(vadd(guardA, vsc(side, -1.6)), vadd(guardA, vsc(side, 1.6)), 0.5, 0.5, P.gold);
}

function knightRig(q: KP): { rig: Rig; j: Joints } {
  const rig = new Rig();
  const j = humanoid(rig, KNIGHT_BODY, q);
  const R = KNIGHT_BODY.head;
  // Шлем: забрало с прорезью, плюмаж (отстаёт от головы).
  rig.dot(onHead(j, R, 0.98, -0.35, 0.05), INK, 1);
  rig.dot(onHead(j, R, 0.98, 0.35, 0.05), INK, 1);
  rig.dot(onHead(j, R, 0.98, 0, 0.05), INK, 1);
  rig.cap(
    onHead(j, R, 0.1, 0, 0.95),
    onHead(j, R, -1.2 + q.pl * 1.4, 0, 1.4 + q.pl * 0.4),
    1.1,
    0.7,
    P.red,
  );
  // Наплечники.
  rig.ball(vadd(j.shL, v3(0, 0.6, 0)), 1.7, P.silver);
  rig.ball(vadd(j.shR, v3(0, 0.6, 0)), 1.7, P.silver);
  // Меч и щит.
  sword(rig, j.haR, swordDir(j, q));
  rig.ball(vadd(vmix(j.elL, j.haL, 0.6), vsc(j.right, -1)), 3.3, P.red, SHIELD);
  return { rig, j };
}

/** Клинок на экране в момент `ta` от начала замаха: [внутренний край, конец]. */
function bladeAt(ta: number, Pj: Proj2): [number, number, number, number] {
  const q = ta < W ? track(ta, WIND) : track(ta - W, REC);
  const j = humanoid(new Rig(), KNIGHT_BODY, q);
  const d = swordDir(j, q);
  const a = Pj(vadd(j.haR, vsc(d, 3)));
  const b = Pj(vadd(j.haR, vsc(d, SWORD)));
  return [a[0], a[1], b[0], b[1]];
}

const SMEAR_C = hx('#fff2cc');
const SPARK_C = hx('#ffffff');
const WOOD: readonly RGBA[] = [hx('#c89a5a'), hx('#f0d8a0'), hx('#5a3a1c'), P.silver[2]];

const K = kindOf('f13_knight', 64, 60, 32, 48, 1200);

const kPic = (anim: string, f: number, d: number): Pic => {
  const q = kPose(anim, f);
  const yaw = yawN(d);
  const { rig, j } = knightRig(q);
  return draw(K, rig, yaw, (o, Pj, lit) => {
    // След клинка: три кадра разгона и контакт.
    const ta = anim === 'wind' ? tf(f) : anim === 'rec' ? W + tf(f) : -1;
    if (ta >= tf(15) && ta <= W + tf(1)) {
      const segs: [number, number, number, number][] = [];
      for (let i = 0; i <= 6; i++) segs.push(bladeAt(ta - i / 96, Pj));
      smearInto(lit(), segs, SMEAR_C, ta >= W ? 0.8 : 0.6);
    }
    if (anim === 'rec') {
      const tip = vadd(j.haR, vsc(swordDir(j, q), SWORD));
      const [x, y] = Pj(tip);
      // Контакт: искра на острие; потом щепа и пыль из-под клинка.
      if (f <= 1) spark(lit(), x, y, SPARK_C, f === 0 ? 1 : 0.6);
      if (f >= 1 && f <= 6) {
        const [fx, fy] = Pj(v3(tip.x, 0, tip.z));
        puff(o.px, fx, fy, (f - 0.5) / 6.5, 17, WOOD, 7, 6);
      }
    }
    if (anim === 'die' && f >= 9 && f <= 17) {
      const [x, y] = Pj(vadd(j.pelvis, v3(0, -j.pelvis.y, 0)));
      puff(o.px, x, y, (f - 8.5) / 9, 31, WOOD, 9, 9);
    }
  });
};

// ---- рисовальщик -------------------------------------------------------------

const TECH = new Set(['windup', 'recover', 'stun', 'alert']);

registerMobPainter('f13_knight', (m: Mob, pose: MobPose): MobFrame => {
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
  } else if (md === 'windup') {
    anim = 'wind';
    f = fi(t, WIND_N - 1);
    // Перед ударом кукла отклоняется назад, в разгоне — вперёд.
    const back = sstep(0.12, 0.4, t) * (1 - sstep(0.6, 0.72, t));
    ex.dx = -fx * 0.8 * back;
    ex.dy = -fy * 0.8 * back;
  } else if (md === 'recover' && t < 0.45) {
    anim = 'rec';
    f = fi(t, REC_N - 1);
    // Вес: приземление на удар — вжатие и выпад, потом обратно.
    const k = 1 - sstep(0, 0.16, t);
    ex.sx = 1 + 0.1 * k;
    ex.sy = 1 - 0.1 * k;
    const lunge = 1.4 * (1 - sstep(0.04, 0.3, t));
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
  if (md !== 'dying') hurtFx(v, now, 1.2, ex);
  return { ...frameOf(K, anim, f, d, pose, () => kPic(anim, f, d)), ...ex };
});

registerMobWarm('f13_knight', function* () {
  yield* warmAll(
    K,
    [
      ['idle', IDLE_N],
      ['walk', WALK_N],
      ['wind', WIND_N],
      ['rec', REC_N],
      ['hu', HURT_N],
      ['die', DIE_N],
      ['reel', 15],
      ['al', 9],
    ],
    kPic,
  );
});
