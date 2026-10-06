// Этаж 8 — Бес-прислужник (анимации мобов 8). Мелкий красный бес с одним
// рогом, хвостом-лопаткой и набедренной повязкой; стайкой петляет, прыгает
// по линии и кусает-полосует когтями. 8 сторон, все рисуются честно.
//
// Метроном мозга (`f8-brains.ts`, `f8_imp`): прицел `aim` 0,42 с (весь —
// подготовка: присел, сжался пружиной, дрожит на пике) → прыжок `leap`
// 0,289 с (урон при касании — когти вытянуты весь полёт, шлейф) → отдых
// 0,55 (приземление со сжатием). Укус `windup` 0,42 с: отпрянул, когти над
// головой, задержка, удар вниз-вперёд — контакт в 0,42 (последний кадр
// замаха и первые кадры отдыха), проводка ниже цели, отдача, возврат.

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
  vlerp,
  vmul,
  vsub,
  warmAll,
  yawN,
  type PKey,
  type Pic,
  type V3,
} from './f8-mobkit';
import { gait, oniBase, oniJoints, oniRig, type OniJ, type OniO, type OniStyle } from './f8-mob-oni';

const ST: OniStyle = {
  skin: tn('#5a1a14', '#8a2a1c', '#b8442a', '#e07048'),
  top: tn('#5a1a14', '#8a2a1c', '#b8442a', '#e07048'),
  pants: tn('#5a1a14', '#8a2a1c', '#b8442a', '#e07048'),
  under: hx('#c8b898'),
  sash: hx('#3a2a1a'),
  hair: null,
  hairKind: 'bald',
  horns: 1,
  horn: tn('#8a7a58', '#c8b888', '#ece0b0', '#fff8d8'),
  eye: hx('#ffd040'),
  leg: 5.6,
  hipW: 1.35,
  torso: 5.0,
  chestW: 2.1,
  chestD: 1.7,
  headR: 3.2,
  arm: 5.2,
  sleeve: 0,
  hakama: false,
  bare: true,
  loin: hx('#d8c8a4'),
  fang: true,
  claw: hx('#f4ead0'),
};

/** Поза беса: тело и хвост (подъём и мах). */
interface ImpO extends OniO {
  tailUp: number;
  tailSw: number;
}

const B0: ImpO = {
  ...oniBase(ST),
  hu: -0.7,
  lean: 0.28,
  hp: -0.2,
  aL: [1.3, -1.1, -3.6],
  aR: [1.1, 1.1, -3.7],
  brow: 0.7,
  tailUp: 0.5,
  tailSw: 0,
};

// ---- Треки действий (время — секунды режима) ------------------------------------------

/** Прицел 0,42: присел, сжался, руки назад, хвост торчком; пик — дрожь. */
const AIM: PKey<ImpO>[] = [
  [0, {}],
  [
    0.14,
    {
      hu: -2.2,
      lean: 0.72,
      hp: -0.55,
      hf: -0.5,
      aL: [-2.6, -1.8, -2.2],
      aR: [-2.8, 1.8, -2.0],
      fL: [1.8, -1.7, 0],
      fR: [-1.2, 1.7, 0],
      mouth: 0.5,
      brow: 1,
      tailUp: 1.2,
    },
    easeOut,
  ],
  [0.3, { hu: -2.7, lean: 0.86, hf: -0.8, mouth: 0.7, tailUp: 1.35 }],
  [0.42, { hu: -2.8, lean: 0.9, hf: -0.85, mouth: 0.8, tailUp: 1.4 }],
];

/** Прыжок 0,289: вытянулся струной, когти вперёд, ноги назад; к концу — ноги под себя. */
const LEAP: PKey<ImpO>[] = carry<ImpO>([
  [
    0,
    {
      hu: 0.4,
      lean: 1.2,
      hp: -0.9,
      hf: 0.6,
      aL: [4.8, -1.0, 0.8],
      aR: [4.8, 1.0, 0.3],
      eL: [0, -1, 1],
      eR: [0, 1, 1],
      fL: [-3.6, -1.1, 2.6],
      fR: [-4.4, 1.1, 3.4],
      mouth: 1,
      brow: 1,
      tailUp: -0.4,
    },
  ],
  [0.17, { lean: 1.1, fL: [-3.0, -1.1, 2.2], fR: [-3.6, 1.1, 2.6] }],
  [0.29, { lean: 0.8, hu: -0.2, fL: [1.2, -1.4, 1.0], fR: [0.4, 1.4, 1.2], aL: [3.8, -1.4, -1.0], aR: [3.8, 1.4, -1.2] }, easeIn],
]);

/** Приземление (отдых после прыжка, 0,55): сжался на четвереньки, встаёт. */
const LAND: PKey<ImpO>[] = [
  [
    0,
    {
      hu: -2.6,
      lean: 0.95,
      hp: -0.6,
      hf: 0.6,
      aL: [3.2, -1.6, -3.4],
      aR: [3.0, 1.6, -3.6],
      fL: [1.6, -1.8, 0],
      fR: [-1.0, 1.8, 0],
      mouth: 0.6,
      tailUp: 1.3,
    },
  ],
  [0.08, { hu: -3.0, lean: 1.0 }, easeOut],
  [0.3, { hu: -1.2, lean: 0.5, mouth: 0.2, tailUp: 0.8 }],
  [0.55, {}],
];

/** Укус-полосование 0,42: отпрянул, когти над головой, задержка, удар — контакт в 0,42. */
const BITE: PKey<ImpO>[] = [
  [0, {}],
  [
    0.2,
    {
      lean: -0.3,
      hf: -1.0,
      hu: -0.2,
      hp: -0.35,
      aL: [0.2, -1.5, 3.4],
      aR: [-0.2, 1.4, 3.8],
      eL: [0, -1, 0.4],
      eR: [0, 1, 0.4],
      fL: [1.6, -1.5, 0],
      fR: [-1.6, 1.5, 0],
      mouth: 0.9,
      brow: 1,
      tailUp: 1.3,
      tailSw: 0.6,
    },
    easeOut,
  ],
  [0.33, { lean: -0.38, hf: -1.2, hu: 0, aL: [-0.4, -1.4, 3.8], aR: [-0.7, 1.4, 4.2] }],
  [
    0.4,
    {
      lean: 0.8,
      hf: 1.3,
      hu: -1.0,
      hp: 0.1,
      aL: [4.2, -0.6, -1.0],
      aR: [4.4, 0.5, -1.8],
      eL: [-1, -1, 0],
      eR: [-1, 1, 0],
      fL: [2.4, -1.5, 0],
      fR: [-1.8, 1.5, 0],
      mouth: 1,
      tailUp: 0.4,
      tailSw: -0.6,
    },
    easeIn,
  ],
  [0.42, {}],
];
/** После укуса (отдых 0,55): держит контакт, проводка ниже цели, отдача, возврат. */
const BITEF: PKey<ImpO>[] = [
  [0, { ...BITE[3][1] }],
  [0.06, { ...BITE[3][1] }],
  [
    0.16,
    {
      lean: 0.95,
      hf: 1.6,
      hu: -1.6,
      hp: 0.2,
      aL: [3.2, -0.4, -3.8],
      aR: [2.8, 0.3, -4.2],
      fL: [2.4, -1.5, 0],
      fR: [-1.8, 1.5, 0],
      mouth: 0.6,
      brow: 1,
      tailUp: 0.2,
      tailSw: -0.9,
    },
    easeOut,
  ],
  [0.3, { lean: 0.15, hf: -0.3, hu: -0.4, mouth: 0.3, tailUp: 0.9, tailSw: 0.3 }],
  [0.55, {}],
];

/** Вздрогнул от удара героя (5 кадров). */
const FLINCH: PKey<ImpO>[] = [
  [0, {}],
  [
    0.05,
    {
      lean: -0.32,
      hf: -0.9,
      hp: -0.45,
      aL: [1.6, -1.8, -0.4],
      aR: [1.8, 1.8, 0.2],
      squint: 1,
      mouth: 0.6,
      tailUp: 1.4,
    },
    easeOut,
  ],
  [0.2, {}],
];

/** Смерть 0,8: отброшен, падает навзничь, отскок, хвост дёргается, тлеет. */
const DIE: PKey<ImpO>[] = carry<ImpO>([
  [0, { lean: -0.4, hf: -1.2, hp: -0.5, aL: [0.5, -2.4, 2.6], aR: [0.2, 2.4, 3.0], mouth: 1, squint: 1, tailUp: 1.4 }],
  [
    0.32,
    {
      lean: -1.5,
      hf: -2.6,
      hu: -4.2,
      hp: -0.2,
      aL: [1.0, -3.2, 1.6],
      aR: [1.6, 3.0, 2.2],
      fL: [2.8, -1.4, 2.4],
      fR: [1.6, 1.6, 3.4],
      mouth: 0.8,
      tailUp: -0.6,
    },
    easeIn,
  ],
  [0.42, { hu: -3.6, fL: [3.0, -1.4, 3.0], fR: [2.0, 1.6, 4.0], tailUp: 0.2 }, easeOut],
  [0.55, { hu: -4.3, fL: [3.2, -1.5, 1.6], fR: [2.6, 1.6, 2.0], mouth: 0.4, tailUp: -0.7 }],
  [0.8, { hu: -4.4, tailUp: -0.8 }],
]);

/** Сон: сидит на корточках, голову на колени. */
const SLEEP: ImpO = {
  ...B0,
  hu: -3.0,
  lean: 0.95,
  hp: 0.6,
  aL: [2.6, -0.9, -3.4],
  aR: [2.6, 0.9, -3.4],
  fL: [1.0, -1.5, 0],
  fR: [0.6, 1.5, 0],
  shut: 1,
  brow: 0,
  tailUp: -0.6,
  tailSw: 0.5,
};
/** Падает со свода: лапы вверх, хвост трубой. */
const FALL: ImpO = {
  ...B0,
  hu: 0.6,
  lean: -0.2,
  hp: -0.6,
  aL: [0.6, -2.2, 2.6],
  aR: [0.4, 2.2, 2.2],
  eL: [0, -1, 0],
  eR: [0, 1, 0],
  fL: [1.2, -1.6, 2.0],
  fR: [-1.0, 1.6, 2.8],
  mouth: 1,
  squint: 0.6,
  tailUp: 1.5,
};

// ---- Поза по кадру ---------------------------------------------------------------------

const RUN_N = 8;
const IDLE_N = 8;

/** Поза и поза «в прошлом» (для отстающих частей) по ключу кадра. */
function poseAt(anim: string, f: number): [ImpO, ImpO, V3] {
  const t = (f + 0.5) / FPS;
  const lagT = t - 3 / FPS;
  const at = (keys: PKey<ImpO>[], T: number) => sampleKeys(B0, keys, Math.max(0, T));
  switch (anim) {
    case 'idle': {
      const ph = (f / IDLE_N) * TAU;
      const mk = (p: number): ImpO => ({
        ...B0,
        hu: B0.hu + Math.sin(p) * 0.3,
        lean: B0.lean + Math.sin(p) * 0.04,
        hy: Math.sin(p * 0.5) * 0.25,
        aL: [B0.aL[0] + Math.sin(p) * 0.3, B0.aL[1], B0.aL[2] + Math.sin(p) * 0.4],
        aR: [B0.aR[0] - Math.sin(p) * 0.3, B0.aR[1], B0.aR[2] + Math.cos(p) * 0.4],
        tailSw: Math.sin(p) * 0.8,
        tailUp: 0.6 + Math.cos(p) * 0.2,
      });
      return [mk(ph), mk(ph - 0.9), [0, 0, 0]];
    }
    case 'run': {
      const ph = f / RUN_N;
      const mk = (p: number): ImpO => {
        const g = gait({ ...B0, lean: 0.5, hp: -0.35, hu: -0.4 }, ST, p, 4.6, 2.2, 1.2) as ImpO;
        g.hu += Math.max(0, Math.sin(p * TAU * 2)) * 0.6;
        g.tailSw = Math.sin(p * TAU) * 0.7;
        g.tailUp = 0.2;
        return g;
      };
      return [mk(ph), mk(ph - 0.14), [-2.5, 0, 0.6]];
    }
    case 'aim': {
      const o = at(AIM, t);
      // Дрожь пружины на пике — сам рисунок, а не дрожь движка.
      if (t > 0.3) o.hu += f % 2 ? 0.25 : -0.15;
      return [o, at(AIM, lagT), [0, 0, 0]];
    }
    case 'leap':
      return [at(LEAP, t), at(LEAP, lagT), [-3.5, 0, 0.8]];
    case 'land':
      return [at(LAND, t), at(LAND, lagT), [0, 0, 0]];
    case 'bite':
      return [at(BITE, t), at(BITE, lagT), [0, 0, 0]];
    case 'bitef':
      return [at(BITEF, t), at(BITEF, lagT), [0, 0, 0]];
    case 'flinch':
      return [at(FLINCH, t), at(FLINCH, lagT), [0, 0, 0]];
    case 'stun': {
      // Шатается по кругу, голова мотается (6 кадров на круг).
      const p = (f / 6) * TAU;
      const o: ImpO = {
        ...B0,
        lean: 0.1 + Math.sin(p) * 0.12,
        roll: Math.cos(p) * 0.16,
        hp: -0.1,
        hr: Math.sin(p) * 0.3,
        hy: Math.cos(p) * 0.3,
        aL: [0.6, -1.9, -3.0],
        aR: [0.6, 1.9, -3.1],
        squint: 1,
        mouth: 0.4,
        tailUp: -0.2,
        tailSw: Math.sin(p) * 0.6,
      };
      return [o, o, [0, 0, 0]];
    }
    case 'die':
      return [at(DIE, t), at(DIE, lagT), [0, 0, 0]];
    case 'sleep': {
      const o: ImpO = { ...SLEEP, hu: SLEEP.hu + (f % 2 ? 0.3 : 0) };
      return [o, o, [0, 0, 0]];
    }
    case 'alert': {
      const k = clamp01(t / 0.35);
      const o = sampleKeys(SLEEP, [[0, {}], [0.35, { ...B0, mouth: 0.8, brow: 1, tailUp: 1.4 }, easeOut]], k * 0.35);
      return [o, o, [0, 0, 0]];
    }
    case 'drop': {
      const w = Math.sin((f / 4) * TAU);
      const o: ImpO = {
        ...FALL,
        aL: [FALL.aL[0], FALL.aL[1] - w * 0.5, FALL.aL[2] + w * 0.6],
        aR: [FALL.aR[0], FALL.aR[1] + w * 0.5, FALL.aR[2] - w * 0.6],
        fL: [FALL.fL[0] + w * 0.6, FALL.fL[1], FALL.fL[2]],
        fR: [FALL.fR[0] - w * 0.6, FALL.fR[1], FALL.fR[2]],
      };
      return [o, FALL, [0, 0, -2]];
    }
  }
  return [B0, B0, [0, 0, 0]];
}

// ---- Хвост ----------------------------------------------------------------------------

/** Хвост-лопатка: три звена от крестца, мах и подъём; кончик тянется за позой в прошлом. */
function tail(r: Rig, J: OniJ, L: OniJ, o: ImpO, lagO: ImpO, wind: V3): void {
  const m = { T: ST.skin };
  const root = J.C.p(-ST.chestD * 0.85, 0, 0.5);
  const drag = vadd(vmul(vsub(L.P, J.P), 0.9), J.B.v(wind[0] * 0.4, wind[1] * 0.4, wind[2] * 0.4));
  // Звенья цепочкой: каждое загибается вверх сильнее прошлого (S-изгиб), мах —
  // вокруг вертикали; дальние звенья берут мах и подъём из позы в прошлом.
  const step = (from: V3, pitch: number, sw: number, len: number, k: number): V3 =>
    vadd(
      vadd(from, J.B.v(-Math.cos(pitch) * Math.cos(sw) * len, Math.sin(sw) * len, Math.sin(pitch) * len)),
      vmul(drag, k),
    );
  const up0 = o.tailUp;
  const up1 = (o.tailUp + lagO.tailUp) / 2;
  const up2 = lagO.tailUp;
  const a = step(root, -0.55 + up0 * 0.25, o.tailSw * 0.5, 1.9, 0.25);
  const b = step(a, 0.1 + up1 * 0.45, ((o.tailSw + lagO.tailSw) / 2) * 0.8, 1.8, 0.35);
  const c = step(b, 0.75 + up2 * 0.45, lagO.tailSw * 1.0, 1.6, 0.45);
  r.cap(root, a, 0.55, 0.45, m);
  r.cap(a, b, 0.45, 0.38, m);
  r.cap(b, c, 0.38, 0.3, m);
  // Лопатка — плоский наконечник поперёк конца.
  const dir = vsub(c, b);
  const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const u: V3 = [dir[0] / l, dir[1] / l, dir[2] / l];
  const side = J.B.s;
  const tip = vadd(c, vmul(u, 1.7));
  r.poly([vadd(c, vmul(side, 1.1)), tip, vadd(c, vmul(side, -1.1)), vadd(c, vmul(u, 0.4))], {
    T: ST.skin,
    bias: 0.1,
  });
}

// ---- Кадр ------------------------------------------------------------------------------

const K = kindOf('f8_imp', 40, 36, 20, 28, 1300);

function impPic(anim: string, f: number, d: number): Pic {
  const [o, lagO, wind] = poseAt(anim, f);
  const r = new Rig();
  const yaw = yawN(d);
  const J = oniRig(r, o, ST, yaw, { lag: lagO, wind, dead: anim === 'die' && f > 7 });
  const L = oniJoints(lagO, ST, yaw);
  tail(r, J, L, o, lagO, wind);
  if (anim === 'die' && f > 7) r.eye = null;
  return draw(K, r, (p, lit, P) => {
    // След когтей на ударе: три дуги по пути кисти за последние кадры.
    const slash = (anim === 'bite' && f >= 9) || (anim === 'bitef' && f <= 2);
    if (slash) {
      const pts: [number, number][] = [];
      const t1 = anim === 'bite' ? (f + 0.5) / FPS : 0.42 + (f + 0.5) / FPS;
      for (let i = 0; i <= 4; i++) {
        const tt = t1 - (4 - i) * 0.018;
        const oo = tt <= 0.42 ? sampleKeys(B0, BITE, tt) : sampleKeys(B0, BITEF, tt - 0.42);
        const jj = oniJoints(oo, ST, yaw);
        pts.push(P(vlerp(jj.haR, jj.haL, 0.3)));
      }
      const L2 = lit();
      for (let k = -1; k <= 1; k++)
        smear(
          L2,
          pts.map(([x, y]) => [x + k * 0.8, y + k * 1.2] as [number, number]),
          hx('#ffb070'),
          hx('#fff4d0'),
          1,
        );
    }
    if (anim === 'stun') {
      // Звёзды над головой.
      const [hxp, hyp] = P(J.H.p(0, 0, ST.headR * 1.4));
      for (let i = 0; i < 3; i++) {
        const a = (f / 6) * TAU + (i / 3) * TAU;
        const x = hxp + Math.cos(a) * 4;
        const y = hyp - 2 + Math.sin(a) * 1.4;
        lit().set(Math.floor(x), Math.floor(y), hx('#fff27a'));
        p.set(Math.floor(x), Math.floor(y), hx('#ffffff'));
      }
    }
    if (anim === 'die' && f >= 12) {
      // Тлеет: угольки поднимаются от тела.
      const k = (f - 12) / 7;
      for (let i = 0; i < 6; i++) {
        const [bx, by] = P(J.C.p(0, (hash(i, 3) - 0.5) * 6, 1 + hash(i, 5) * 4));
        const y = by - k * (4 + hash(i, 7) * 6);
        lit().set(Math.floor(bx + (hash(i, 9) - 0.5) * 3), Math.floor(y), alphaC(hx(i % 2 ? '#ff8a30' : '#ffd060'), 1 - k * 0.6));
      }
    }
  });
}

const LEAP_T = 2.6 / 9;

registerMobPainter('f8_imp', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = pose.t;
  const now = pose.now || 0;
  const id = m.id ?? 0;
  const v = visOf(m, pose, m.face ?? 0, 14);
  const d = dirN(v.yaw);
  const ex: Partial<MobFrame> = { shadow: 4 };
  let anim = 'idle';
  let f = 0;
  if (md === 'dying') {
    anim = 'die';
    f = fi(t, 19);
    ex.linger = 0.85;
    ex.alpha = 1 - sstep(0.6, 0.85, t);
    ex.shadow = 4 * (1 - sstep(0.5, 0.8, t));
    ex.still = true;
  } else if (md === 'aim') {
    anim = 'aim';
    f = fi(t, 10);
    ex.still = true;
  } else if (md === 'leap') {
    anim = 'leap';
    f = fi(t, 6);
    const k = clamp01(t / LEAP_T);
    ex.dy = -Math.sin(PI * k) * 7;
    ex.shadow = 4 - Math.sin(PI * k) * 1.5;
    ex.still = true;
    ex.ghost = { every: 0.03, life: 0.16, tint: '#ff6a3a', alpha: 0.32 };
  } else if (md === 'windup') {
    anim = 'bite';
    f = fi(t, 10);
    ex.still = true;
  } else if (md === 'recover') {
    if (v.prev === 'leap') {
      anim = 'land';
      f = fi(t, 13);
      if (f <= 1) {
        ex.sx = 1.16;
        ex.sy = 0.84;
      }
    } else {
      anim = 'bitef';
      f = fi(t, 13);
      if (f <= 1) {
        ex.sx = 1.08;
        ex.sy = 0.93;
      }
    }
    ex.still = true;
  } else if (md === 'stun') {
    if (v.prev === 'drop' && t < 0.12) {
      anim = 'land';
      f = fi(t, 2);
      ex.sx = 1.2 - t;
      ex.sy = 0.8 + t;
    } else {
      anim = 'stun';
      f = mod(now * 20, 6);
    }
  } else if (md === 'drop') {
    anim = 'drop';
    f = mod(now * 14 + id, 4);
  } else if (md === 'sleep') {
    anim = 'sleep';
    f = mod(now * 1.4 + hash(id, 3) * 2, 2);
  } else if (md === 'alert') {
    anim = 'alert';
    f = fi(t, 8);
    ex.dy = -Math.sin(PI * clamp01(t / 0.35)) * 3;
  } else if (hurtF(v, now) >= 0 && !moving(m)) {
    anim = 'flinch';
    f = hurtF(v, now);
  } else if (moving(m)) {
    anim = 'run';
    // Шаг — по пройденному пути: цикл (два шага) — 0,6 клетки.
    f = mod((v.dist / 0.6) * RUN_N, RUN_N);
  } else {
    anim = 'idle';
    f = mod((now + hash(id, 7) * 4) * 8, IDLE_N);
  }
  if (md === 'f8_out') {
    // Из двери: проявляется из темноты проёма.
    ex.alpha = 0.25 + 0.75 * easeOut(t / 0.4);
  }
  if (md !== 'dying') hurtFx(v, now, 1.4, ex);
  return { ...frameOf(K, anim, f, d, pose, () => impPic(anim, f, d)), ...ex };
});

registerMobWarm('f8_imp', function* () {
  yield* warmAll(
    K,
    [
      ['run', RUN_N],
      ['idle', IDLE_N],
      ['aim', 11],
      ['leap', 7],
      ['land', 14],
      ['bite', 11],
      ['bitef', 14],
      ['flinch', 5],
      ['stun', 6],
      ['die', 20],
      ['drop', 4],
    ],
    impPic,
  );
});
