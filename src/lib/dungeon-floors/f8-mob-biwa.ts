// Этаж 8 — Бива-струнник (анимации мобов 8). Прежний облик: сидит в
// сэйдза в лиловом кимоно с бледным исподним, длинные чёрные волосы
// закрывают лицо — сквозь пряди один огромный лиловый глаз; на коленях
// бива (грушевый корпус, короткий гриф с заломленной колковой коробкой),
// в правой руке — веер-плектр бати. Мини-3D (человечек `f8-mob-oni.ts`),
// 8 сторон: не ходит, всё время поворачивается к герою (предел поворота).
//
// Метроном мозга (`f8-brains.ts`, `f8_biwa`, урон — волна в конце
// `f8_vanish`): `f8_play` — играет: такт 1 с (замах → удар по струнам →
// малый удар), голова кивает в такт, волосы и рукава отстают; кольца звука
// от деки. `f8_strum` 0,7 с — стены крыла сдвигаются: тремоло трёх ударов
// и большой удар (0,6). `f8_vanish` 0,5 с — бати вскинут над головой
// (держит), рывок вниз: кадр контакта — первый кадр `f8_gone` (струна
// лопается, волна кольцом). `f8_gone` — рассыпается лиловыми нотами,
// потом пуст; после — собирается из нот на новом месте. Удар героя —
// волосы хлещут, бива прижата; смерть — струны рвутся, клонится ничком,
// бива соскальзывает, тает нотами.

import type { Mob } from '../dungeon-sim';
import type { Px } from '../dungeon-art';
import { registerMobPainter, registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import {
  alphaC,
  clamp,
  clamp01,
  dirN,
  draw,
  easeIn,
  easeOut,
  emptyFrame,
  F3,
  fi,
  frameOf,
  hash,
  hurtF,
  hurtFx,
  hx,
  kindOf,
  lerp,
  mod,
  PI,
  Rig,
  sstep,
  TAU,
  tn,
  trk,
  vadd,
  visOf,
  vmul,
  vnorm,
  vsub,
  warmAll,
  yawN,
  type Key,
  type Mat,
  type Pic,
  type Proj2,
  type V3,
} from './f8-mobkit';
import { oniBase, oniJoints, oniRig, type OniJ, type OniO, type OniStyle } from './f8-mob-oni';

const ST: OniStyle = {
  skin: tn('#4e4458', '#766c82', '#9a90a6', '#bcb2c6'),
  top: tn('#2a1a3a', '#4a2e62', '#6e4a8e', '#9a78b8'),
  pants: tn('#221630', '#3a2652', '#583c78', '#7a5c9c'),
  under: hx('#e0dcea'),
  sash: hx('#1a1020'),
  hair: tn('#060608', '#101016', '#1c1c26', '#2e2e3e'),
  hairKind: 'long',
  horns: 0,
  horn: tn('#000000', '#000000', '#000000', '#000000'),
  eye: hx('#b07aff'),
  leg: 7.0,
  hipW: 1.5,
  torso: 6.4,
  chestW: 2.3,
  chestD: 1.7,
  headR: 2.8,
  arm: 6.6,
  sleeve: 1.5,
  hakama: true,
};

const K = kindOf('f8_biwa', 64, 66, 32, 48, 1100);

const WOOD = { T: tn('#3a200e', '#62381a', '#8a5428', '#b0743a') } as Mat;
const BOARD = { T: tn('#4a3018', '#76522c', '#9c7040', '#b88a52') } as Mat;
const DARKW = { T: tn('#1e120a', '#3a2414', '#58381e', '#7a5030') } as Mat;
const BACHI = { T: tn('#5a5244', '#9a9078', '#c8bea2', '#e4dcc4') } as Mat;
const PEG = { T: tn('#9a8a6a', '#d8c8a0', '#f4e0b0', '#fff8e0') } as Mat;
const HAIR = ST.hair!;
const STR = hx('#9a8a6c');
const STR_HOT = hx('#e8d0ff');
const NOTE = hx('#d8b8ff');
const NOTE2 = hx('#9a6ae0');
const EYE_W = hx('#f4f0ff');
const EYE_I = hx('#8a4ad8');

// ---- Поза ------------------------------------------------------------------------------------------

/** Сэйдза: таз на пятках, стопы под собой, корпус чуть вперёд, голова склонена. */
const SEIZA: OniO = {
  ...oniBase(ST),
  hu: -4.0,
  lean: 0.12,
  hp: 0.28,
  fL: [-1.6, -1.5, 0],
  fR: [-1.6, 1.5, 0],
  brow: 0,
  shut: 1,
};

/** Рисунок кадра: поза тела, ход бати, свет струн, кольца звука. */
interface Bw {
  o: OniO;
  /** Ход бати: 0 — над струнами, 0,5 — удар по струнам, 1 — проводка; < 0 — вскинут. */
  sp: number;
  /** Бива: сдвиг и наклон (смерть — соскальзывает). */
  bx: number;
  bs: number;
  bu: number;
  broll: number;
  bpitch: number;
  /** Струны: свет (удар), лопнувшая струна 0/1 и её хлёст 0…1. */
  hot: number;
  snap: number;
  /** Кольца звука: возраст последних ударов (с), до трёх. */
  rings: number[];
  /** Глаз: раскрыт 0…1,3; свет. */
  eye: number;
  /** Рассыпается / собирается нотами 0…1 (1 — весь ушёл). */
  melt: number;
  /** Пряди вбок (хлещут при ударе), оси головы. */
  whip: number;
  dead: boolean;
}

const B0 = (): Bw => ({
  o: { ...SEIZA },
  sp: 0.85,
  bx: 0,
  bs: 0,
  bu: 0,
  broll: 0,
  bpitch: 0,
  hot: 0,
  snap: 0,
  rings: [],
  eye: 1,
  melt: 0,
  whip: 0,
  dead: false,
});

/** Такт игры 1 с: замах → удар (0,22) → малый замах → малый удар (0,7). */
const PLAY_SP: Key[] = [
  [0, 0.88],
  [0.14, 0.02, easeOut],
  [0.25, 1.0, easeIn],
  [0.52, 0.9],
  [0.6, 0.32, easeOut],
  [0.72, 0.98, easeIn],
  [1.0, 0.88],
];
const PLAY_HIT = [0.215, 0.69];
/** Тремоло (стены крыла едут): три быстрых удара и большой в 0,6. */
const STRUM_SP: Key[] = [
  [0, 0.88],
  [0.1, 0.0, easeOut],
  [0.16, 0.95, easeIn],
  [0.22, 0.3],
  [0.28, 0.95, easeIn],
  [0.34, 0.3],
  [0.4, 0.95, easeIn],
  [0.52, -0.45, easeOut],
  [0.6, 1.1, easeIn],
  [0.7, 0.95],
];
const STRUM_HIT = [0.135, 0.255, 0.375, 0.57];
/** Обрыв струны: замах над головой 0…0,35, держит, рывок вниз к 0,5. */
const VAN_SP: Key[] = [
  [0, 0.88],
  [0.32, -0.62, easeOut],
  [0.43, -0.66],
  [0.5, 0.62, easeIn],
];

const hitAge = (hits: number[], t: number) =>
  hits
    .map((h) => t - h)
    .filter((a) => a >= 0 && a < 0.45)
    .slice(-3);

const tAt = (f: number) => (f + 0.5) / 24;

function shot(anim: string, f: number): [Bw, Bw] {
  const t = tAt(f);
  return [shotAt(anim, f, t), shotAt(anim, f, t - 3 / 24)];
}

/** Свет струн: сразу после удара — ярко, гаснет за 0,25 с. */
const hotOf = (hits: number[], t: number) =>
  hits.reduce((a, h) => (t >= h && t - h < 0.25 ? Math.max(a, 1 - (t - h) / 0.25) : a), 0);

function shotAt(anim: string, f: number, t: number): Bw {
  const b = B0();
  const o = b.o;
  if (anim === 'play' || anim === 'appear') {
    const tt = anim === 'appear' ? 0.9 : ((t % 1) + 1) % 1;
    b.sp = trk(tt, PLAY_SP);
    const near = Math.min(...PLAY_HIT.map((h) => Math.abs(tt - h)));
    const kick = Math.max(0, 1 - near / 0.08);
    o.hp = SEIZA.hp + 0.12 * kick;
    o.lean = SEIZA.lean + 0.05 * kick;
    o.roll = 0.04 * Math.sin(tt * TAU);
    b.hot = hotOf(PLAY_HIT, tt);
    b.rings = hitAge(PLAY_HIT, tt);
    if (anim === 'appear') b.melt = 1 - easeOut(t / 0.29);
    return b;
  }
  if (anim === 'strum') {
    b.sp = trk(t, STRUM_SP);
    const near = Math.min(...STRUM_HIT.map((h) => Math.abs(t - h)));
    const kick = Math.max(0, 1 - near / 0.06);
    o.hp = SEIZA.hp - 0.1 + 0.16 * kick;
    o.lean = SEIZA.lean + 0.08 * kick - sstep(0.4, 0.52, t) * 0.12 * (1 - sstep(0.56, 0.62, t));
    o.twist = 0.12 * Math.sin(t * 30) * (1 - sstep(0.4, 0.5, t));
    b.hot = Math.max(0.3, hotOf(STRUM_HIT, t));
    b.rings = hitAge(STRUM_HIT, t);
    b.eye = 1.15;
    return b;
  }
  if (anim === 'vanish') {
    b.sp = trk(t, VAN_SP);
    const up = sstep(0.0, 0.35, t) * (1 - sstep(0.43, 0.5, t));
    o.lean = SEIZA.lean - 0.2 * up + 0.1 * sstep(0.45, 0.5, t);
    o.hp = SEIZA.hp - 0.35 * up;
    o.hu = SEIZA.hu + 0.6 * up;
    // Струна натянута: горит, дрожит.
    b.hot = 0.4 + 0.6 * sstep(0.2, 0.45, t);
    b.eye = 1 + 0.3 * up;
    b.whip = 0.1 * Math.sin(t * 60) * up;
    return b;
  }
  if (anim === 'gone') {
    // Контакт: струна лопнула, волна, тает нотами.
    b.sp = 0.62 + 0.3 * easeOut(t / 0.1);
    o.lean = SEIZA.lean + 0.1;
    b.hot = 1 - t / 0.25;
    b.snap = 1;
    b.rings = [t, t + 0.12];
    b.melt = sstep(0.04, 0.24, t);
    b.eye = 1.3;
    return b;
  }
  if (anim === 'flinch') {
    // Удар героя: голову откидывает, пряди хлещут, биву прижимает к себе.
    const j = Math.sin(PI * clamp01(t / 0.2));
    o.lean = SEIZA.lean - 0.25 * j;
    o.hp = SEIZA.hp - 0.4 * j;
    o.roll = 0.12 * j;
    b.sp = 0.9;
    b.bx = -0.6 * j;
    b.whip = j;
    b.eye = 1 - 0.8 * j;
    return b;
  }
  if (anim === 'stun') {
    o.roll = 0.14 * Math.sin((f / 6) * TAU);
    o.hp = SEIZA.hp + 0.25;
    b.sp = 1.1;
    b.eye = 0.4;
    return b;
  }
  if (anim === 'die') {
    // 0–0,25: струны рвутся (хлёст), корпус вздрагивает назад; 0,25–0,6:
    // клонится ничком, бива соскальзывает вбок; 0,55–0,85: тает нотами.
    const back = Math.sin(PI * clamp01(t / 0.2));
    const fall = easeIn(clamp01((t - 0.18) / 0.36));
    o.lean = SEIZA.lean - 0.2 * back + 1.25 * fall;
    o.hu = SEIZA.hu - 1.3 * fall;
    o.hf = 1.4 * fall;
    o.hp = SEIZA.hp + 0.5 * fall;
    // Валится вперёд и набок — волосы ложатся веером, а не столбом.
    o.roll = -0.75 * fall;
    o.hy = 0.6 * fall;
    b.sp = 0.95 + 0.4 * fall;
    b.bs = 2.4 * fall;
    b.bx = 1.2 * fall;
    b.bu = -3.4 * fall;
    b.broll = 1.25 * fall;
    b.bpitch = 0.4 * fall;
    b.snap = t > 0.04 ? 1 : 0;
    b.hot = 1 - sstep(0.05, 0.3, t);
    b.eye = t < 0.15 ? 1.3 : 1 - sstep(0.2, 0.45, t);
    b.melt = sstep(0.58, 0.85, t);
    b.dead = t > 0.3;
    return b;
  }
  return b;
}

// ---- Бива и руки --------------------------------------------------------------------------------

/** Рамка бивы в мире: деком вперёд, гриф вверх-влево-назад. */
function biwaFrame(J: OniJ, b: Bw): F3 {
  return J.B.at(3.2 + b.bx, 1.3 + b.bs, 4.6 + b.bu)
    .roll(-0.38 + b.broll)
    .pitch(-0.22 + b.bpitch);
}

/** Кромка бати по ходу удара — точка в осях бивы. */
function edgeAt(sp: number): V3 {
  if (sp < 0) {
    const k = clamp01(-sp / 0.66);
    return [lerp(1.8, 2.1, k), lerp(2.3, 2.8, k), lerp(0.4, 8.6, k)];
  }
  const k = clamp01(sp);
  // Дуга: сверху справа → по струнам → вниз влево; ближе всего к деке на 0,5.
  const a = lerp(-0.2, 1.2, k);
  return [1.3 + 0.5 * Math.abs(k - 0.5), lerp(2.3, -0.5, k), 0.4 - 3.2 * k + 0.3 * Math.sin(a)];
}

/** Мировая точка → кисть в осях корпуса от плеча (как ждёт `oniRig`). */
function toArm(J: OniJ, sh: V3, w: V3): V3 {
  const d = vsub(w, sh);
  const C = J.C;
  return [
    d[0] * C.f[0] + d[1] * C.f[1] + d[2] * C.f[2],
    d[0] * C.s[0] + d[1] * C.s[1] + d[2] * C.s[2],
    d[0] * C.u[0] + d[1] * C.u[1] + d[2] * C.u[2],
  ];
}

/** Кисти на гриф и бати: поза с руками. */
function solve(b: Bw, yaw: number): OniO {
  const J = oniJoints(b.o, ST, yaw);
  const W = biwaFrame(J, b);
  const lh = W.p(0.6, -0.4, 5.4);
  const e = W.p(...edgeAt(b.sp));
  const rh = vadd(e, W.v(0.8, 1.6, 1.5));
  return {
    ...b.o,
    aL: toArm(J, J.shL, lh),
    aR: toArm(J, J.shR, rh),
    eL: [-1, -1, -0.2],
    eR: [-0.4, 1, -0.3],
  };
}

function biwa(r: Rig, W: F3, b: Bw): { strings: [V3, V3][]; bridge: V3 } {
  // Грушевый корпус: низ шире.
  r.ell(W, [0, 0, -1.0], [1.05, 3.2, 2.9], WOOD);
  r.ell(W, [0, 0, 1.3], [0.85, 2.1, 2.5], WOOD);
  r.ell(W, [0.45, 0, -0.6], [0.66, 2.9, 3.2], BOARD);
  // Лунки-резонаторы и подгрудник (фукудзю).
  r.dot(W.p(1.02, -0.9, 1.0), hx('#2a1408'), 0, 1, 0.5);
  r.dot(W.p(1.02, 0.9, 1.0), hx('#2a1408'), 0, 1, 0.5);
  const bridge = W.p(1.05, 0, -2.0);
  r.cap(W.p(1.0, -1.3, -2.0), W.p(1.0, 1.3, -2.0), 0.36, 0.36, DARKW);
  // Гриф и заломленная колковая коробка с колками.
  r.cap(W.p(0.25, 0, 2.6), W.p(0.25, 0, 6.6), 0.66, 0.55, WOOD);
  r.cap(W.p(0.25, 0, 6.6), W.p(-1.7, 0, 7.5), 0.55, 0.42, DARKW);
  for (const s of [-1, 1])
    for (const k of [0.3, 0.75])
      r.cap(
        W.p(lerp(-0.1, -1.4, k), s * 0.4, lerp(6.8, 7.3, k)),
        W.p(lerp(-0.1, -1.4, k), s * 1.3, lerp(6.8, 7.3, k)),
        0.22,
        0.2,
        PEG,
      );
  const strings: [V3, V3][] = [];
  // Четыре струны в масштабе кадра — две линии (крайние пары).
  for (let i = 0; i < 2; i++) {
    const x = i ? 0.55 : -0.55;
    strings.push([W.p(1.1, x, -2.0), W.p(0.9, x * 0.4, 6.6)]);
  }
  // В кадре видна одна струна (остальные сливаются с грифом); после удара
  // она горит и гаснет за 0,25 с.
  if (!b.snap) {
    const glow = b.hot > 0.05 ? b.hot * 0.8 : 0;
    r.line(W.p(1.12, 0.2, -2.0), W.p(0.92, 0.08, 6.6), glow > 0.45 ? STR_HOT : STR, glow, 0.6);
  }
  return { strings, bridge };
}

/** Бати: веер из кисти к кромке. */
function bachi(r: Rig, W: F3, J: OniJ, sp: number): V3 {
  const e = W.p(...edgeAt(sp));
  const ed = vnorm(W.v(0, 0.55, 0.85));
  const h = J.haR;
  const a = vadd(e, vmul(ed, 1.1));
  const c = vadd(e, vmul(ed, -1.1));
  const m = vadd(h, vmul(vsub(e, h), 0.25));
  r.poly([m, a, c], BACHI, 0.4);
  r.cap(h, m, 0.45, 0.4, DARKW);
  return e;
}

/** Завеса волос перед лицом — сквозь пряди один глаз. */
function curtain(r: Rig, J: OniJ, b: Bw): void {
  const R = ST.headR;
  const H = J.H;
  const open = clamp(b.eye, 0, 1.3);
  const wx = b.whip * 0.6;
  const mat: Mat = {
    T: ST.hair!,
    pat: (q) => {
      if (q[0] > 0.45 && open > 0.15 && !b.dead) {
        const ey = (q[1] - 0.36 - wx * 0.2) / 0.3;
        const ez = (q[2] - 0.34) / (0.2 * Math.min(1, open));
        const d = ey * ey + ez * ez;
        if (d <= 1) {
          // Прядь поперёк глаза — «сквозь волосы».
          if (Math.abs(q[1] - 0.2) < 0.045) return null;
          const iy = (q[1] - 0.36) / 0.14;
          const iz = (q[2] - 0.33) / 0.17;
          const di = iy * iy + iz * iz;
          if (di < 0.22) return hx('#120818');
          if (di <= 1) return EYE_I;
          return EYE_W;
        }
      }
      // Блик пряди — полосой.
      if (q[2] > 0.45 && q[2] < 0.6 && Math.abs(q[1]) < 0.7) return HAIR[2];
      return null;
    },
    gpat: (q) => {
      if (q[0] <= 0.45 || open <= 0.15 || b.dead) return 0;
      const iy = (q[1] - 0.36) / 0.16;
      const iz = (q[2] - 0.33) / 0.2;
      return iy * iy + iz * iz <= 1 ? 0.85 : 0;
    },
  };
  r.ell(H, [R * 0.55, wx, -R * 0.35], [R * 0.48, R * 0.86, R * 1.2], mat);
  // Пряди до груди — отстают и хлещут.
  for (const s of [-1, 1]) {
    const a = H.p(R * 0.6, s * R * 0.7, -R * 0.9);
    const tip = H.p(R * 0.75 + b.whip * 0.8, s * R * 0.8 + wx * 2, -R * 2.3);
    r.cap(a, tip, R * 0.3, R * 0.14, { T: HAIR });
  }
  r.eye = open > 0.15 && !b.dead ? H.p(R * 1.05, R * 0.36, R * 0.05) : null;
}

// ---- Кадр ---------------------------------------------------------------------------------------------

function ringArc(
  p: Px,
  lit: () => Px,
  x: number,
  y: number,
  R: number,
  a: number,
  f: number,
): void {
  for (let i = 0; i < 9; i++) {
    const th = -PI * 0.85 + (i / 8) * PI * 0.7 + f;
    const px = x + Math.cos(th) * R;
    const py = y + Math.sin(th) * R * 0.6;
    p.set(Math.floor(px), Math.floor(py), alphaC(NOTE, a));
    lit().set(Math.floor(px), Math.floor(py), alphaC(NOTE2, a * 0.8));
  }
}

function note(p: Px, lit: () => Px, x: number, y: number, a: number): void {
  const c = alphaC(NOTE, a);
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  p.set(xi, yi, c);
  p.set(xi + 1, yi, c);
  p.set(xi + 1, yi - 1, c);
  p.set(xi + 1, yi - 2, c);
  p.set(xi + 2, yi - 2, c);
  lit().set(xi, yi, alphaC(NOTE2, a));
}

function biwaPic(anim: string, f: number, d: number): Pic {
  const yaw = yawN(d);
  const [b, lag] = shot(anim, f);
  const o = solve(b, yaw);
  const lagO = solve(lag, yaw);
  const r = new Rig();
  const J = oniRig(r, o, ST, yaw, { lag: lagO, dead: b.dead });
  const W = biwaFrame(J, b);
  const { strings, bridge } = biwa(r, W, b);
  bachi(r, W, J, b.sp);
  curtain(r, J, b);
  return draw(K, r, (p: Px, lit: () => Px, P: Proj2) => {
    const [bx, by] = P(bridge);
    // Кольца звука от деки.
    for (const age of b.rings) {
      const k = clamp01(age / 0.45);
      ringArc(
        p,
        lit,
        bx,
        by - 1,
        3 + 9 * easeOut(k),
        0.8 * (1 - k),
        hash(Math.round(age * 24), 3) * 0.3,
      );
    }
    // Лопнувшая струна: хлещет петлёй от подгрудника.
    if (b.snap) {
      const [x0, y0] = P(strings[1][0]);
      const [x1, y1] = P(strings[1][1]);
      for (let i = 1; i <= 8; i++) {
        const k = i / 8;
        const wv = Math.sin(k * PI * 2 + f) * 3 * (1 - k);
        const x = lerp(x0, (x0 + x1) / 2, k) + wv;
        const y = lerp(y0, (y0 + y1) / 2, k) - k * 2;
        p.set(Math.floor(x), Math.floor(y), STR_HOT);
        lit().set(Math.floor(x), Math.floor(y), alphaC(NOTE, 0.8));
      }
    }
    // Рассыпается / собирается нотами: пиксели гаснут шахматкой по зерну,
    // ноты всплывают.
    if (b.melt > 0) {
      for (let y = 0; y < p.h; y++)
        for (let x = 0; x < p.w; x++) {
          const i = (y * p.w + x) * 4;
          if (!p.data[i + 3]) continue;
          const h = hash(x, y, 17) * 0.75 + (1 - y / p.h) * 0.25;
          if (h < b.melt) p.data[i + 3] = 0;
          else if (h < b.melt + 0.08) {
            p.data[i] = NOTE[0];
            p.data[i + 1] = NOTE[1];
            p.data[i + 2] = NOTE[2];
          }
        }
      const [cx, cy] = P(J.C.p(0, 0, 2));
      for (let i = 0; i < 6; i++) {
        const k = clamp01(b.melt * 1.2 - hash(i, 5) * 0.3);
        if (k <= 0 || k >= 1) continue;
        note(p, lit, cx + (hash(i, 7) - 0.5) * 16, cy + 6 - k * 22 - hash(i, 9) * 4, 1 - k * 0.7);
      }
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
  });
}

// ---- Рисовальщик ----------------------------------------------------------------------------------------

const PLAY_N = 24;
const STRUM_N = 17;
const VAN_N = 12;
const GONE_N = 6;
const APPEAR_N = 7;
const DIE_N = 20;

registerMobPainter('f8_biwa', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = pose.t;
  const now = pose.now || 0;
  const id = m.id ?? 0;
  const v = visOf(m, pose, m.face ?? 0, 4);
  const d = dirN(v.yaw);
  const ex: Partial<MobFrame> = { shadow: 5, still: true };
  let anim: string;
  let f: number;
  if (md === 'dying') {
    anim = 'die';
    f = fi(t, DIE_N - 1);
    ex.linger = 0.85;
    ex.shadow = 5 * (1 - sstep(0.55, 0.8, t));
  } else if (md === 'f8_gone') {
    if (t >= GONE_N / 24) return emptyFrame();
    anim = 'gone';
    f = fi(t, GONE_N - 1);
    ex.shadow = 0;
  } else if (md === 'f8_vanish') {
    anim = 'vanish';
    f = fi(t, VAN_N - 1);
  } else if (md === 'f8_strum') {
    anim = 'strum';
    f = fi(t, STRUM_N - 1);
  } else if (md === 'stun') {
    anim = 'stun';
    f = mod(now * 24, 6);
  } else if (hurtF(v, now) >= 0) {
    anim = 'flinch';
    f = hurtF(v, now);
  } else if (v.prev === 'f8_gone' && t < APPEAR_N / 24) {
    anim = 'appear';
    f = fi(t, APPEAR_N - 1);
  } else {
    anim = 'play';
    // Такт от времени рендера, фаза — от id: соседние бивы не в унисон.
    f = mod((now + hash(id, 7)) * 24, PLAY_N);
  }
  if (md !== 'dying' && md !== 'f8_gone') hurtFx(v, now, 1.2, ex);
  return { ...frameOf(K, anim, f, d, pose, () => biwaPic(anim, f, d)), ...ex };
});

registerMobWarm('f8_biwa', function* () {
  yield* warmAll(
    K,
    [
      ['play', PLAY_N],
      ['strum', STRUM_N],
      ['vanish', VAN_N],
      ['gone', GONE_N],
      ['appear', APPEAR_N],
      ['flinch', 5],
      ['stun', 6],
      ['die', DIE_N],
    ],
    biwaPic,
  );
});
