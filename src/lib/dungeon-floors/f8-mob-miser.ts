// Этаж 8 — Бес-казначей (анимации мобов 8). Прежний облик: маленький толстый
// бес с рыже-бурой кожей, в золотисто-буром хаори торговца, с брюшком,
// пучком волос и одним рогом, жёлтые глаза; за спиной мешок с монетами.
// Мини-3D (общий человечек `f8-mob-oni.ts`), 8 сторон, все честные.
//
// Метроном мозга (`f8-brains.ts`, `f8_miser`, урона нет): удирает (`flee`)
// — семенит, прижимая мешок, оглядывается через плечо, монетки сыплются.
// Ныряет в дверь `f8_dive` 0,35 с — прыжок рыбкой, тает в щели (мешок
// последним). `f8_hidden` — его нет. `f8_out` — выглядывает из другой двери.
// Удар героя — монеты брызгают из мешка. Смерть — роняет мешок, золото
// рассыпается, падает навзничь.

import type { Mob } from '../dungeon-sim';
import { registerMobPainter, registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import {
  alphaC,
  carry,
  dirN,
  draw,
  easeIn,
  easeOut,
  emptyFrame,
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
  sstep,
  tn,
  TAU,
  vadd,
  visOf,
  vmul,
  vsub,
  warmAll,
  yawN,
  type PKey,
  type Pic,
  type V3,
} from './f8-mobkit';
import {
  atP,
  gait,
  oniBase,
  oniJoints,
  oniRig,
  type OniJ,
  type OniO,
  type OniStyle,
} from './f8-mob-oni';

const ST: OniStyle = {
  skin: tn('#6a3a1a', '#a0582a', '#c8783a', '#eca058'),
  top: tn('#3a2a0a', '#6a4a14', '#9a7020', '#c89a38'),
  pants: tn('#2a1a14', '#3e281c', '#5a3a26', '#7a5234'),
  under: hx('#e8d8b0'),
  sash: hx('#1a1410'),
  hair: tn('#1a1410', '#2e241c', '#443428', '#5e4a38'),
  hairKind: 'knot',
  horns: 1,
  horn: tn('#8a7a58', '#c8b888', '#ece0b0', '#fff8d8'),
  eye: hx('#ffe040'),
  leg: 4.6,
  hipW: 1.5,
  torso: 5.0,
  chestW: 2.3,
  chestD: 2.0,
  headR: 3.0,
  arm: 4.6,
  sleeve: 1.6,
  hakama: true,
  belly: 2.6,
  fang: true,
};
const SACK = { T: tn('#5a4428', '#8a6a3e', '#b08c56', '#d8b87a') };
const GOLD = { T: tn('#8a5a10', '#d8a020', '#ffd84a', '#fff4b0'), spec: true };
const COIN = hx('#ffd84a');
const COIN_HI = hx('#fff4b0');

/** Поза: тело и мешок (подскок, сорван со спины). */
interface MiO extends OniO {
  /** Мешок: подскок вверх, отрыв от спины (смерть: на полу перед ним). */
  sb: number;
  drop: number;
}

const B0: MiO = {
  ...oniBase(ST),
  hu: -0.3,
  lean: 0.12,
  // Левая держит лямку у плеча, правая — у брюха.
  aL: [0.4, 0.4, -0.6],
  aR: [1.4, 0.9, -2.6],
  brow: 0.2,
  sb: 0,
  drop: 0,
};

// ---- Треки -----------------------------------------------------------------------------

/** Нырок 0,35: присел, прыжок рыбкой вперёд (к двери). */
const DIVE: PKey<MiO>[] = carry<MiO>([
  [0, {}],
  [
    0.08,
    { hu: -1.4, lean: 0.5, aL: [-1.2, -1.6, -1.8], aR: [-1.2, 1.6, -1.8], mouth: 0.6 },
    easeOut,
  ],
  [
    0.25,
    {
      hu: 0.8,
      lean: 1.3,
      hf: 1.8,
      aL: [4.0, -0.6, 1.0],
      aR: [4.0, 0.6, 1.0],
      fL: [-3.0, -1.2, 1.6],
      fR: [-3.4, 1.2, 2.0],
      sb: 1.2,
    },
    easeIn,
  ],
  [0.35, { hu: 0.4, lean: 1.45, hf: 2.4 }],
]);
/** Выглянул из двери 0,5: шаг, оглядка вправо-влево. */
const PEEK: PKey<MiO>[] = carry<MiO>([
  [0, { hy: -0.9, lean: -0.1, hu: -0.6 }],
  [0.18, { hy: 0.9 }],
  [0.36, { hy: -0.4, hu: -0.3 }],
  [0.5, { hy: 0 }],
]);
const FLINCH: PKey<MiO>[] = [
  [0, {}],
  [
    0.05,
    {
      lean: -0.35,
      hf: -0.8,
      hp: -0.4,
      aL: [0.4, -2.0, 1.0],
      aR: [0.6, 2.2, 1.4],
      squint: 1,
      mouth: 1,
      sb: 1.4,
    },
    easeOut,
  ],
  [0.2, {}],
];
/** Смерть 0,8: роняет мешок, отшатнулся, навзничь. */
const DIE: PKey<MiO>[] = carry<MiO>([
  [
    0,
    {
      lean: -0.3,
      hp: -0.4,
      aL: [0.6, -2.2, 1.8],
      aR: [0.8, 2.2, 2.0],
      mouth: 1,
      squint: 1,
      sb: 1.2,
    },
  ],
  [0.14, { drop: 1, lean: -0.6, hf: -1.0 }, easeOut],
  [
    0.36,
    {
      lean: -1.45,
      hf: -2.2,
      hu: -3.2,
      hp: -0.2,
      fL: [2.4, -1.4, 2.0],
      fR: [1.6, 1.4, 2.6],
      aL: [0.6, -3.0, 0.8],
      aR: [0.4, 3.0, 1.0],
    },
    easeIn,
  ],
  [0.44, { hu: -2.7, fL: [2.6, -1.4, 2.6] }, easeOut],
  [0.54, { hu: -3.3, fL: [2.6, -1.4, 1.2], fR: [2.0, 1.4, 1.4], mouth: 0.5 }, easeIn],
  [0.8, { hu: -3.3 }],
]);

// ---- Поза по кадру ---------------------------------------------------------------------

const RUN_N = 8;
const IDLE_N = 12;

function poseAt(anim: string, f: number): [MiO, MiO, V3] {
  const t = (f + 0.5) / FPS;
  const lagT = t - 3 / FPS;
  const at = (keys: PKey<MiO>[], T: number) => sampleKeys(B0, keys, Math.max(0, T));
  switch (anim) {
    case 'idle': {
      // Нервно озирается, потирает руки, мешок поправляет.
      const mk = (q: number): MiO => ({
        ...B0,
        hu: B0.hu + Math.sin(q * 2) * 0.15,
        hy: Math.sin(q) * 0.8,
        aR: [1.8 + Math.sin(q * 4) * 0.3, 0.2, -2.0],
        aL: [1.8 - Math.sin(q * 4) * 0.3, -0.2, -2.0],
        brow: 0,
        mouth: 0.3,
        sb: Math.max(0, Math.sin(q * 2)) * 0.3,
      });
      const q = (f / IDLE_N) * TAU;
      return [mk(q), mk(q - 0.8), [0, 0, 0]];
    }
    case 'run': {
      const mk = (p: number): MiO => {
        const g = gait({ ...B0, lean: 0.35, hu: -0.4 }, ST, p, 3.6, 1.8, 0.4) as MiO;
        // Семенит: подскок дважды за цикл, мешок прыгает следом; оглядка через плечо.
        g.hu += Math.max(0, Math.sin(p * TAU * 2)) * 0.6;
        g.hy = Math.sin(p * TAU * 0.5) > 0.3 ? 1.3 : 0;
        g.aR = [-1.0 + Math.cos(p * TAU) * 1.2, 1.4, -2.0];
        g.mouth = 0.8;
        g.brow = 0;
        g.sb = Math.max(0, Math.sin(p * TAU * 2 - 0.8)) * 1.2;
        return g;
      };
      const ph = f / RUN_N;
      return [mk(ph), mk(ph - 0.14), [-2, 0, 0.5]];
    }
    case 'dive':
      return [at(DIVE, t), at(DIVE, lagT), [-3, 0, 0]];
    case 'peek':
      return [at(PEEK, t), at(PEEK, lagT), [0, 0, 0]];
    case 'flinch':
      return [at(FLINCH, t), at(FLINCH, lagT), [0, 0, 0]];
    case 'die':
      return [at(DIE, t), at(DIE, lagT), [0, 0, 0]];
    case 'stun': {
      const q = (f / 6) * TAU;
      const o: MiO = {
        ...B0,
        lean: 0.1 + Math.sin(q) * 0.12,
        roll: Math.cos(q) * 0.16,
        hr: Math.sin(q) * 0.3,
        hy: Math.cos(q) * 0.4,
        squint: 1,
        mouth: 0.5,
      };
      return [o, o, [0, 0, 0]];
    }
  }
  return [B0, B0, [0, 0, 0]];
}

// ---- Мешок -----------------------------------------------------------------------------

/** Мешок за спиной (или на полу перед ним): холщовый, завязка, монета-знак, золото сверху. */
function sack(r: Rig, J: OniJ, L: OniJ, o: MiO): V3 {
  let c: V3;
  if (o.drop > 0.5) c = J.B.p(4.0, 1.5, 2.4);
  else {
    const back = J.C.p(-ST.chestD - 2.2, 0, ST.torso * 0.55 + o.sb);
    // Отстаёт от спины: мешок догоняет корпус (поза в прошлом).
    c = vadd(
      back,
      vmul(
        vsub(
          L.C.p(-ST.chestD - 2.2, 0, ST.torso * 0.55),
          J.C.p(-ST.chestD - 2.2, 0, ST.torso * 0.55),
        ),
        0.7,
      ),
    );
  }
  const F = atP(J.B, c);
  r.ell(F, [0, 0, 0], [2.6, 2.8, 3.0], {
    ...SACK,
    pat: (q) => (q[0] < -0.55 && Math.abs(q[1]) < 0.35 && Math.abs(q[2]) < 0.35 ? COIN : null),
  });
  r.ell(F, [0, 0, 3.0], [1.4, 1.4, 0.6], GOLD);
  r.cap(vadd(c, [0, 0, 2.6]), vadd(c, [0, 0, 3.4]), 0.55, 0.45, {
    T: tn('#2a1a0a', '#4a3018', '#6a4828', '#8a6038'),
  });
  if (o.drop <= 0.5) r.line(J.shL, vadd(c, J.B.v(0, -1.2, 1.8)), hx('#3a2a14'), 0, 0.4);
  return c;
}

// ---- Кадр ------------------------------------------------------------------------------

const K = kindOf('f8_miser', 44, 40, 22, 30, 1100);

function miserPic(anim: string, f: number, d: number): Pic {
  const yaw = yawN(d);
  const [o, lagO, wind] = poseAt(anim, f);
  const dead = anim === 'die' && f > 8;
  const r = new Rig();
  const J = oniRig(r, o, ST, yaw, { lag: lagO, wind, dead });
  const L = oniJoints(lagO, ST, yaw);
  const sc = sack(r, J, L, o);
  if (dead) r.eye = null;
  return draw(K, r, (p, lit, P) => {
    // Монеты в полёте: точки по дуге со своим зерном.
    const coin = (x: number, y: number, k: number) => {
      const c = k % 2 ? COIN : COIN_HI;
      p.set(Math.floor(x), Math.floor(y), c);
      lit().set(Math.floor(x), Math.floor(y), alphaC(c, 0.6));
    };
    if (anim === 'run' && f % 4 === 1) {
      // Монетка выпала из мешка на бегу.
      const [x, y] = P(vadd(sc, J.B.v(-2, 0, -2)));
      coin(x, y + 2, f);
    }
    if (anim === 'flinch' && f >= 1) {
      // Удар — монеты брызгают из мешка вверх и в стороны.
      const [x, y] = P(vadd(sc, [0, 0, 3]));
      for (let i = 0; i < 5; i++) {
        const a = -PI / 2 + (hash(i, 3) - 0.5) * 2.2;
        const s = 2 + f * (1.5 + hash(i, 5));
        coin(x + Math.cos(a) * s, y + Math.sin(a) * s + f * f * 0.4, i);
      }
    }
    if (anim === 'die' && f >= 3) {
      // Мешок упал — золото рассыпается дугами по полу и остаётся блестеть.
      const k = Math.min(1, (f - 3) / 8);
      for (let i = 0; i < 9; i++) {
        const a = hash(i, 2) * TAU;
        const R = (3 + hash(i, 4) * 8) * easeOut(k);
        const [gx, gy] = P(
          vadd(sc, J.B.v(Math.cos(a) * R, Math.sin(a) * R, -2.2 + Math.sin(PI * k) * 3)),
        );
        coin(gx, gy, i + f);
      }
    }
    if (anim === 'stun') {
      const [hxp, hyp] = P(J.H.p(0, 0, ST.headR * 1.5));
      for (let i = 0; i < 3; i++) {
        const a = (f / 6) * TAU + (i / 3) * TAU;
        const x = Math.floor(hxp + Math.cos(a) * 4);
        const y = Math.floor(hyp - 2 + Math.sin(a) * 1.4);
        lit().set(x, y, hx('#fff27a'));
        p.set(x, y, hx('#ffffff'));
      }
    }
  });
}

registerMobPainter('f8_miser', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = pose.t;
  const now = pose.now || 0;
  const id = m.id ?? 0;
  const v = visOf(m, pose, m.face ?? 0, 16);
  const d = dirN(v.yaw);
  const ex: Partial<MobFrame> = { shadow: 4 };
  let anim = 'idle';
  let f = 0;
  if (md === 'f8_hidden') return { ...emptyFrame(), shadow: 0 };
  if (md === 'dying') {
    anim = 'die';
    f = fi(t, 19);
    ex.linger = 0.85;
    ex.alpha = 1 - sstep(0.62, 0.85, t);
    ex.shadow = 4 * (1 - sstep(0.5, 0.8, t));
    ex.still = true;
  } else if (md === 'f8_dive') {
    anim = 'dive';
    f = fi(t, 8);
    // Тает в щели двери: сжимается по высоте и гаснет.
    const k = sstep(0.15, 0.35, t);
    ex.alpha = 1 - k;
    ex.sy = 1 - k * 0.5;
    ex.still = true;
  } else if (md === 'f8_out') {
    anim = 'peek';
    f = fi(t, 12);
    ex.alpha = 0.25 + 0.75 * easeOut(t / 0.4);
  } else if (md === 'stun') {
    anim = 'stun';
    f = mod(now * 18, 6);
  } else if (hurtF(v, now) >= 0) {
    anim = 'flinch';
    f = hurtF(v, now);
  } else if (moving(m)) {
    anim = 'run';
    // Шаг — по пройденному пути: семенит, цикл 0,55 клетки.
    f = mod((v.dist / 0.55) * RUN_N, RUN_N);
  } else {
    anim = 'idle';
    f = mod((now + hash(id, 7) * 4) * 8, IDLE_N);
  }
  if (md !== 'dying' && md !== 'f8_dive') hurtFx(v, now, 1.4, ex);
  return { ...frameOf(K, anim, f, d, pose, () => miserPic(anim, f, d)), ...ex };
});

registerMobWarm('f8_miser', function* () {
  yield* warmAll(
    K,
    [
      ['run', RUN_N],
      ['idle', IDLE_N],
      ['dive', 9],
      ['peek', 13],
      ['flinch', 5],
      ['stun', 6],
      ['die', 20],
    ],
    miserPic,
  );
});
