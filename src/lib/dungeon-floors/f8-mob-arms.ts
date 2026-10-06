// Этаж 8 — Многорукий (анимации мобов 8). Прежний облик: громадный они с
// бирюзовой кожей, шесть голых рук (три пары), бурая безрукавка, белый пояс,
// бурые хакама, дикая красная грива, два рога, оранжевые глаза. Мини-3D
// (общий человечек `f8-mob-oni.ts` + две лишние пары рук), 8 сторон.
//
// Метроном мозга (`f8-brains.ts`, `f8_arms`): «звезда» `star` 0,95 с —
// весь замах — подготовка: ладони сходятся у груди (вдох, подъём), присед с
// дрожью, руки отводятся назад — и в 0,95 пять ладоней разом бьют лучами
// (углы курса 0, ±72°, ±144° — как конусы `f8_palm`); долгий отдых 1,3 —
// руки висят, тяжело дышит (окно). Хватка `grab` 0,75: правая рука отведена
// с поворотом плеч, бросок вперёд — в 0,75 рука на всю длину (дальше её
// тянет зона `f8_grab` и контакт), отдых 0,7 — рывок на себя кулаком.

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
  ik,
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
import { gait, oniBase, oniRig, type OniJ, type OniO, type OniStyle } from './f8-mob-oni';

const ST: OniStyle = {
  skin: tn('#183640', '#2a5a68', '#46869a', '#7ab8c8'),
  top: tn('#2a1a12', '#46301e', '#644428', '#86603a'),
  pants: tn('#1e1612', '#34261c', '#4a3828', '#645038'),
  under: hx('#e0d8c8'),
  sash: hx('#e8e0c8'),
  hair: tn('#2a0808', '#4a1010', '#6e1a16', '#9a2a20'),
  hairKind: 'wild',
  horns: 2,
  horn: tn('#6a5a3a', '#9a8a5a', '#c8b884', '#f0e4b8'),
  eye: hx('#ff8a30'),
  leg: 9,
  hipW: 2.1,
  torso: 9.4,
  chestW: 3.5,
  chestD: 2.6,
  headR: 3.4,
  arm: 8.2,
  sleeve: 0,
  hakama: true,
  fang: true,
  thick: 1.35,
};
const SKIN = { T: ST.skin };

/** Поза: две лишние пары рук — кисти от своих плеч в осях корпуса. */
interface ArmsO extends OniO {
  mL: V3;
  mR: V3;
  lL: V3;
  lR: V3;
}

/** Плечи (оси корпуса): главная пара — у `oniJoints`, средняя, нижняя. */
const SH_A = (s: number): V3 => [0, s * ST.chestW * 0.92, ST.torso * 0.84];
const SH_M = (s: number): V3 => [0.3, s * ST.chestW * 0.86, ST.torso * 0.62];
const SH_L = (s: number): V3 => [0.4, s * ST.chestW * 0.8, ST.torso * 0.42];
/** Кисть в точку `tgt` (оси корпуса) от плеча `sh`. */
const to = (sh: V3, tgt: V3): V3 => vsub(tgt, sh);
/** Кисть лучом под углом `a` от курса (вправо — плюс) на длину `R`. */
const ray = (a: number, R: number, dz: number): V3 => [Math.cos(a) * R, Math.sin(a) * R, dz];

const B0: ArmsO = {
  ...oniBase(ST),
  hu: -0.6,
  lean: 0.1,
  aL: [1.2, -2.0, -5.6],
  aR: [1.2, 2.0, -5.6],
  mL: [1.8, -2.8, -3.4],
  mR: [1.8, 2.8, -3.4],
  lL: [2.4, -1.4, -3.2],
  lR: [2.4, 1.4, -3.2],
  brow: 0.9,
};

// ---- Треки -----------------------------------------------------------------------------

const CHEST: V3 = [ST.chestD + 1.6, 0, ST.torso * 0.62];
const gatherAll = (k: number): Partial<ArmsO> => ({
  aL: to(SH_A(-1), vadd(CHEST, [0, -0.4 * k, 0.6])),
  aR: to(SH_A(1), vadd(CHEST, [0, 0.4 * k, 0.6])),
  mL: to(SH_M(-1), vadd(CHEST, [0.2, -0.9 * k, -0.6])),
  mR: to(SH_M(1), vadd(CHEST, [0.2, 0.9 * k, -0.6])),
  lL: to(SH_L(-1), vadd(CHEST, [0, -0.6 * k, -2.2])),
  lR: to(SH_L(1), vadd(CHEST, [0, 0.6 * k, -2.2])),
});
const R5 = (2 * PI) / 5;
/** Пять ладоней лучами + шестая (левая нижняя) — кулак у груди. */
const THRUST: Partial<ArmsO> = {
  hu: -1.4,
  lean: 0.05,
  hp: 0.05,
  aR: ray(R5, 8.2, -1.6),
  aL: ray(-R5, 8.2, -1.6),
  mR: ray(2 * R5, 8.2, -1.2),
  mL: ray(-2 * R5, 8.2, -1.2),
  lR: ray(0, 8.2, -0.8),
  lL: to(SH_L(-1), vadd(CHEST, [-0.4, -0.8, -1.2])),
  mouth: 1,
  brow: 1,
};

/** Звезда 0,95: ладони к груди с подъёмом, присед с дрожью, отвод — удар в 0,95. */
const STAR: PKey<ArmsO>[] = carry<ArmsO>([
  [0, {}],
  [0.3, { hu: -0.1, lean: -0.12, hp: -0.25, ...gatherAll(1), mouth: 0.3, squint: 0.4 }, easeOut],
  [0.7, { hu: -1.2, lean: 0.06, hp: 0.05, ...gatherAll(0.6), squint: 0.8 }],
  [
    0.86,
    {
      hu: -1.5,
      aL: [-1.6, -3.4, -2.2],
      aR: [-1.6, 3.4, -2.2],
      mL: [-2.2, -3.6, -1.0],
      mR: [-2.2, 3.6, -1.0],
      lL: [-1.8, -2.6, -2.0],
      lR: [-1.8, 2.6, -2.0],
      mouth: 0.6,
    },
    easeOut,
  ],
  [0.95, THRUST, easeIn],
]);
/** Долгий отдых 1,3: удержание, руки обвисают, дышит, выпрямляется. */
const STARF: PKey<ArmsO>[] = carry<ArmsO>([
  [0, THRUST],
  [0.1, { hu: -1.8, lean: 0.12 }, easeOut],
  [0.35, { hu: -1.5, mouth: 0.6 }],
  [
    0.75,
    {
      hu: -1.2,
      lean: 0.3,
      hp: 0.35,
      aL: [1.4, -2.4, -7.2],
      aR: [1.4, 2.4, -7.2],
      mL: [1.6, -3.0, -5.6],
      mR: [1.6, 3.0, -5.6],
      lL: [2.0, -1.8, -5.0],
      lR: [2.0, 1.8, -5.0],
      mouth: 0.7,
      brow: 0.4,
      squint: 0.6,
    },
  ],
  [1.3, { ...B0 }],
]);
/** Хватка 0,75: правая отведена с поворотом плеч — бросок, рука на всю длину в 0,75. */
const GRAB: PKey<ArmsO>[] = carry<ArmsO>([
  [0, {}],
  [
    0.35,
    {
      twist: -0.55,
      lean: -0.1,
      hu: -0.8,
      aR: [-3.2, 3.0, -1.0],
      mL: [2.2, -3.6, 1.2],
      mR: [1.4, 3.8, 0.8],
      lR: [-1.0, 2.2, -3.0],
      brow: 1,
      squint: 0.5,
    },
    easeOut,
  ],
  [0.62, { twist: -0.65, aR: [-3.6, 2.8, -0.6], hu: -1.0 }],
  [0.75, { twist: 0.5, lean: 0.45, hu: -1.4, hf: 1.6, aR: [8.2, 0.6, -0.8], mouth: 1 }, easeIn],
]);
/** Отдых 0,7 после хватки: рывок на себя кулаком, возврат. */
const GRABF: PKey<ArmsO>[] = carry<ArmsO>([
  [0, { ...GRAB[3][1] }],
  [0.06, { aR: [7.8, 0.6, -0.6] }],
  [0.24, { twist: -0.45, lean: -0.25, hu: -0.5, hf: -0.6, aR: [0.6, 2.8, -1.8], mouth: 0.6 }, easeOut],
  [0.7, { ...B0 }],
]);
const FLINCH: PKey<ArmsO>[] = [
  [0, {}],
  [
    0.05,
    {
      lean: -0.25,
      hf: -0.8,
      hp: -0.4,
      aL: [0.4, -3.6, -1.0],
      aR: [0.4, 3.6, -1.0],
      mL: [0, -4.2, -1.4],
      mR: [0, 4.2, -1.4],
      squint: 1,
      mouth: 0.7,
    },
    easeOut,
  ],
  [0.2, {}],
];
/** Смерть 0,8: руки вразлёт, на колени, ничком, руки раскинуты. */
const DIE: PKey<ArmsO>[] = carry<ArmsO>([
  [
    0,
    {
      lean: -0.35,
      hp: -0.55,
      aL: [0.4, -3.0, 3.6],
      aR: [0.6, 3.0, 4.0],
      mL: [0, -5.2, 1.0],
      mR: [0, 5.2, 1.4],
      lL: [0.6, -4.4, -1.6],
      lR: [0.6, 4.4, -1.4],
      mouth: 1,
      squint: 1,
    },
  ],
  [0.22, { hu: -4.4, lean: 0.25, hp: 0.4, fL: [3.0, -2.0, 0], fR: [2.4, 2.0, 0], aL: [2.0, -3.0, -6.0], aR: [2.0, 3.0, -6.0], mouth: 0.6 }, easeIn],
  [
    0.48,
    {
      hu: -6.4,
      lean: 1.45,
      hf: 2.0,
      hp: 0.2,
      aL: [3.0, -5.0, 1.0],
      aR: [3.0, 5.0, 1.2],
      mL: [1.0, -6.0, 0.6],
      mR: [1.0, 6.0, 0.8],
      lL: [-1.0, -4.6, 0.4],
      lR: [-1.0, 4.6, 0.6],
      fL: [-2.6, -2.0, 0.4],
      fR: [-3.2, 2.0, 0.4],
    },
    easeIn,
  ],
  [0.56, { hu: -5.8 }, easeOut],
  [0.64, { hu: -6.6 }, easeIn],
  [0.8, { hu: -6.6 }],
]);
const SLEEP: ArmsO = {
  ...B0,
  hu: -5.2,
  lean: 0.15,
  hp: 0.6,
  fL: [2.6, -1.0, 0],
  fR: [2.6, 1.0, 0],
  aL: to(SH_A(-1), vadd(CHEST, [-0.2, 1.4, -1.4])),
  aR: to(SH_A(1), vadd(CHEST, [-0.2, -1.4, -1.0])),
  mL: [3.4, -0.6, -4.4],
  mR: [3.4, 0.6, -4.4],
  lL: [3.0, 0.6, -3.6],
  lR: [3.0, -0.6, -3.6],
  shut: 1,
  brow: 0,
};
const FALL: ArmsO = {
  ...B0,
  hu: 0.5,
  lean: -0.15,
  aL: [0.4, -3.2, 3.6],
  aR: [0.4, 3.2, 3.6],
  mL: [0, -5.6, 0.8],
  mR: [0, 5.6, 0.8],
  lL: [0.6, -4.6, -1.0],
  lR: [0.6, 4.6, -1.0],
  fL: [1.6, -2.4, 2.4],
  fR: [-1.2, 2.4, 3.0],
  mouth: 0.8,
};

// ---- Поза по кадру ---------------------------------------------------------------------

const RUN_N = 10;
const IDLE_N = 10;

function poseAt(anim: string, f: number): [ArmsO, ArmsO, V3] {
  const t = (f + 0.5) / FPS;
  const lagT = t - 3 / FPS;
  const at = (keys: PKey<ArmsO>[], T: number) => sampleKeys(B0, keys, Math.max(0, T));
  switch (anim) {
    case 'idle': {
      const mk = (q: number): ArmsO => ({
        ...B0,
        hu: B0.hu + Math.sin(q) * 0.3,
        lean: B0.lean + Math.sin(q) * 0.03,
        hy: Math.sin(q * 0.5) * 0.25,
        // Руки шевелятся вразнобой — каждая пара со своим сдвигом.
        aL: [B0.aL[0], B0.aL[1], B0.aL[2] + Math.sin(q) * 0.4],
        aR: [B0.aR[0], B0.aR[1], B0.aR[2] + Math.sin(q + 1) * 0.4],
        mL: [B0.mL[0] + Math.sin(q + 2) * 0.4, B0.mL[1], B0.mL[2] + Math.cos(q + 2) * 0.5],
        mR: [B0.mR[0] + Math.sin(q + 3) * 0.4, B0.mR[1], B0.mR[2] + Math.cos(q + 3) * 0.5],
        lL: [B0.lL[0], B0.lL[1] - Math.sin(q + 4) * 0.4, B0.lL[2]],
        lR: [B0.lR[0], B0.lR[1] + Math.sin(q + 5) * 0.4, B0.lR[2]],
      });
      const q = (f / IDLE_N) * TAU;
      return [mk(q), mk(q - 0.8), [0, 0, 0]];
    }
    case 'run': {
      const mk = (p: number): ArmsO => {
        const g = gait({ ...B0, lean: 0.22, hu: -1.0 }, ST, p, 6.0, 2.0, 0.8) as ArmsO;
        // Тяжёлый шаг: оседает на опорную ногу; пары рук машут вразнобой.
        g.hu -= Math.max(0, Math.cos(p * TAU * 2)) * 0.5;
        const sw = Math.cos(p * TAU);
        g.mL = [B0.mL[0] + sw * 1.4, B0.mL[1], B0.mL[2]];
        g.mR = [B0.mR[0] - sw * 1.4, B0.mR[1], B0.mR[2]];
        g.lL = [B0.lL[0] - sw * 1.0, B0.lL[1], B0.lL[2]];
        g.lR = [B0.lR[0] + sw * 1.0, B0.lR[1], B0.lR[2]];
        return g;
      };
      const ph = f / RUN_N;
      return [mk(ph), mk(ph - 0.12), [-1.5, 0, 0]];
    }
    case 'star': {
      const o = at(STAR, t);
      if (t > 0.5 && t < 0.84) o.hu += f % 2 ? 0.25 : -0.15;
      return [o, at(STAR, lagT), [0, 0, 0]];
    }
    case 'starf':
      return [at(STARF, t), at(STARF, lagT), [0, 0, 0]];
    case 'grab':
      return [at(GRAB, t), at(GRAB, lagT), [0, 0, 0]];
    case 'grabf':
      return [at(GRABF, t), at(GRABF, lagT), [0, 0, 0]];
    case 'flinch':
      return [at(FLINCH, t), at(FLINCH, lagT), [0, 0, 0]];
    case 'die':
      return [at(DIE, t), at(DIE, lagT), [0, 0, 0]];
    case 'stun': {
      const q = (f / 6) * TAU;
      const o: ArmsO = {
        ...B0,
        hu: -1.2,
        lean: 0.12 + Math.sin(q) * 0.1,
        roll: Math.cos(q) * 0.12,
        hr: Math.sin(q) * 0.3,
        hy: Math.cos(q) * 0.3,
        aL: [1.0, -2.6, -6.4],
        aR: [1.0, 2.6, -6.4],
        squint: 1,
        mouth: 0.5,
      };
      return [o, o, [0, 0, 0]];
    }
    case 'sleep': {
      const o: ArmsO = { ...SLEEP, hu: SLEEP.hu + (f % 2 ? 0.3 : 0) };
      return [o, o, [0, 0, 0]];
    }
    case 'alert': {
      const k = clamp01(t / 0.35);
      const o = sampleKeys(SLEEP, [[0, {}], [0.35, { ...B0, mouth: 0.8, brow: 1, shut: 0 }, easeOut]], k * 0.35);
      return [o, o, [0, 0, 0]];
    }
    case 'drop': {
      const w = Math.sin((f / 4) * TAU);
      const o: ArmsO = { ...FALL, mL: [FALL.mL[0], FALL.mL[1], FALL.mL[2] + w * 0.8], mR: [FALL.mR[0], FALL.mR[1], FALL.mR[2] - w * 0.8] };
      return [o, FALL, [0, 0, -2]];
    }
  }
  return [B0, B0, [0, 0, 0]];
}

// ---- Лишние руки -----------------------------------------------------------------------

/** Рука от плеча `sh` (мир) к кисти; локоть — наружу-назад. */
function limb(r: Rig, sh: V3, want: V3, pole: V3): V3 {
  const th = ST.thick ?? 1;
  const a1 = ST.arm * 0.5;
  const a2 = ST.arm * 0.52;
  const d = vsub(want, sh);
  const l = Math.hypot(d[0], d[1], d[2]);
  const ha = l <= a1 + a2 ? want : vadd(sh, vmul(d, (a1 + a2) / l));
  const el = ik(sh, ha, a1, a2, pole);
  r.cap(sh, el, 1.05 * th, 0.9 * th, SKIN);
  r.cap(el, ha, 0.9 * th, 0.78 * th, SKIN);
  r.ball(ha, 1.0 * th, SKIN);
  return ha;
}

function extraArms(r: Rig, J: OniJ, o: ArmsO): V3[] {
  const C = J.C;
  const hands: V3[] = [];
  for (const s of [-1, 1]) {
    const shM = C.p(...SH_M(s));
    const shL = C.p(...SH_L(s));
    const m = s < 0 ? o.mL : o.mR;
    const l = s < 0 ? o.lL : o.lR;
    hands.push(limb(r, shM, vadd(shM, C.v(m[0], m[1], m[2])), C.v(-1, s * 0.8, -0.2)));
    hands.push(limb(r, shL, vadd(shL, C.v(l[0], l[1], l[2])), C.v(-1, s * 0.6, -0.6)));
  }
  return hands;
}

// ---- Кадр ------------------------------------------------------------------------------

const K = kindOf('f8_arms', 84, 72, 42, 54, 1400);

function armsPic(anim: string, f: number, d: number): Pic {
  const yaw = yawN(d);
  const [o, lagO, wind] = poseAt(anim, f);
  const dead = anim === 'die' && f > 8;
  const r = new Rig();
  const J = oniRig(r, o, ST, yaw, { lag: lagO, wind, dead });
  const hands = extraArms(r, J, o);
  if (dead) r.eye = null;
  return draw(K, r, (p, lit, P) => {
    // Удар звездой: белые дуги ладоней у кистей на контакте.
    const hit = (anim === 'star' && f >= 22) || (anim === 'starf' && f <= 2);
    if (hit) {
      const L = lit();
      const k = anim === 'star' ? 0 : f / 3;
      for (const h of [J.haL, J.haR, hands[0], hands[2], hands[3]]) {
        const [x, y] = P(h);
        const R = 2 + k * 3;
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * TAU;
          L.set(Math.floor(x + Math.cos(a) * R), Math.floor(y + Math.sin(a) * R * 0.7), alphaC(hx('#e8fbff'), 0.9 - k * 0.5));
        }
      }
    }
    if (anim === 'star' && f >= 7 && f <= 20) {
      // Набор: ладони у груди светятся всё ярче.
      const [x, y] = P(J.C.p(...CHEST));
      const k = (f - 7) / 13;
      const L = lit();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU + f * 0.4;
        const R = 3 - k * 1.5;
        L.set(Math.floor(x + Math.cos(a) * R), Math.floor(y + Math.sin(a) * R), alphaC(hx('#a8f0ff'), 0.4 + 0.6 * k));
      }
    }
    if (anim === 'stun') {
      const [hxp, hyp] = P(J.H.p(0, 0, ST.headR * 1.7));
      for (let i = 0; i < 3; i++) {
        const a = (f / 6) * TAU + (i / 3) * TAU;
        const x = Math.floor(hxp + Math.cos(a) * 5);
        const y = Math.floor(hyp - 2 + Math.sin(a) * 1.6);
        lit().set(x, y, hx('#fff27a'));
        p.set(x, y, hx('#ffffff'));
      }
    }
    if (anim === 'die' && f >= 11 && f <= 17) {
      // Грохнулся ничком — пыль в стороны.
      const k = (f - 11) / 6;
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU + hash(i, 2);
        const [x, y] = P(J.B.p(4 + Math.cos(a) * (5 + k * 7), Math.sin(a) * (5 + k * 7), 0.5 + k * 1.5));
        p.set(Math.floor(x), Math.floor(y), alphaC(hx('#8a7a68'), 0.8 - k * 0.6));
      }
    }
  });
}

registerMobPainter('f8_arms', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = pose.t;
  const now = pose.now || 0;
  const id = m.id ?? 0;
  const v = visOf(m, pose, m.face ?? 0, 6);
  const d = dirN(v.yaw);
  const ex: Partial<MobFrame> = { shadow: 8 };
  const data = (m.data ?? {}) as Record<string, number>;
  let anim = 'idle';
  let f = 0;
  if (md === 'dying') {
    anim = 'die';
    f = fi(t, 19);
    ex.linger = 0.85;
    ex.alpha = 1 - sstep(0.64, 0.85, t);
    ex.shadow = 8 * (1 - sstep(0.55, 0.8, t));
    ex.still = true;
  } else if (md === 'star') {
    anim = 'star';
    f = fi(t, 22);
    ex.still = true;
  } else if (md === 'grab') {
    anim = 'grab';
    f = fi(t, 17);
    ex.still = true;
  } else if (md === 'recover') {
    if (data.long || v.prev === 'star') {
      anim = 'starf';
      f = fi(t, 31);
    } else {
      anim = 'grabf';
      f = fi(t, 16);
    }
    if (f <= 1) {
      ex.sx = 1.06;
      ex.sy = 0.95;
    }
    ex.still = true;
  } else if (md === 'stun') {
    if (v.prev === 'drop' && t < 0.12) {
      anim = 'starf';
      f = 3;
      ex.sx = 1.2 - t;
      ex.sy = 0.8 + t;
    } else {
      anim = 'stun';
      f = mod(now * 14, 6);
    }
  } else if (md === 'drop') {
    anim = 'drop';
    f = mod(now * 10 + id, 4);
  } else if (md === 'sleep') {
    anim = 'sleep';
    f = mod(now * 1.0 + hash(id, 3) * 2, 2);
  } else if (md === 'alert') {
    anim = 'alert';
    f = fi(t, 8);
  } else if (hurtF(v, now) >= 0 && !moving(m)) {
    anim = 'flinch';
    f = hurtF(v, now);
  } else if (moving(m)) {
    anim = 'run';
    // Шаг — по пройденному пути: цикл (два шага) — 1,1 клетки.
    f = mod((v.dist / 1.1) * RUN_N, RUN_N);
  } else {
    anim = 'idle';
    f = mod((now + hash(id, 7) * 4) * 5, IDLE_N);
  }
  if (md === 'f8_out') ex.alpha = 0.25 + 0.75 * easeOut(t / 0.4);
  if (md !== 'dying') hurtFx(v, now, 1.0, ex);
  return { ...frameOf(K, anim, f, d, pose, () => armsPic(anim, f, d)), ...ex };
});

registerMobWarm('f8_arms', function* () {
  yield* warmAll(
    K,
    [
      ['run', RUN_N],
      ['idle', IDLE_N],
      ['star', 23],
      ['starf', 32],
      ['grab', 18],
      ['grabf', 17],
      ['flinch', 5],
      ['stun', 6],
      ['die', 20],
      ['drop', 4],
    ],
    armsPic,
  );
});

