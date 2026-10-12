// Этаж 14: Заводной солдатик (анимации мобов 14). Оловянный солдатик:
// кивер с латунной бляхой и красным султаном, красный мундир с белой
// перевязью, синие штаны, ружьё со штыком у правого плеча, ЗАВОДНОЙ КЛЮЧ в
// спине. Ходит строевым, ключ крутится в такт шагу; штык — выпад по оси.
//
// Мозг (`f14-brains.ts`, `SOLDIER`): `aim` 0,7 → урон в конце → `recover`
// 0,75 (кадр контакта — первый кадр `recover`, тело само летит выпадом);
// завод кончился или ключ сбит со спины — `f14_unwound` 2,8 (ключ стоит,
// урон ×1,6 — ключ светится) → `f14_rewind` 1,2 (сам себя заводит
// трещоткой); Завод: `f14_statue` (серый, строй смотрит на юг) →
// `f14_waking` 0,8; `f14_frozen` — серый (Стоп-кадр: замер в выпаде).
// Отголосок 15-го этажа (`f15_echo`, мотив 5) рисуется этим же
// рисовальщиком: `windup` 0,9 (удар прикладом о пол, кольцо) → `recover` 0,5.

import { registerMobPainter, registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import {
  F3,
  FPS,
  PI,
  Rig,
  TAU,
  camSide,
  clamp01,
  cog2,
  dirN,
  draw,
  easeBack,
  easeIn,
  easeIn3,
  easeOut,
  fi,
  frameOf,
  gait,
  hash,
  headOf,
  hurtAge,
  hurtFx,
  hx,
  idlePh,
  ik,
  kindOf,
  lerp,
  moving,
  smear,
  smooth,
  spark2,
  spray,
  sstep,
  tn,
  vadd,
  visOf,
  vlerp,
  vmul,
  vnorm,
  warmAll,
  warmGray,
  yawN,
} from './f14-mobkit';
import type { Mat, Pic, Proj2, RGBA, RigOut, V3 } from './f14-mobkit';

const REDC = tn('#3a0a0c', '#6a1418', '#a42228', '#d8484a');
const NAVY = tn('#10142a', '#1e2648', '#34406a', '#5a6aa0');
const SKIN = tn('#8a4a38', '#c88a70', '#f0c0a0', '#ffe4cc');
const HAT = tn('#0e0c12', '#1c1822', '#34303e', '#5a5468');
const PLUME = tn('#5a0c10', '#9e1e26', '#d8484a', '#ff8a7a');
const BELT = tn('#8a8478', '#c8c0b0', '#ece6d8', '#ffffff');
const BOOT = tn('#060508', '#121016', '#262230', '#44404e');
const WOOD = tn('#2a160c', '#5a3218', '#8a5028', '#b87a40');
const STEEL = tn('#2a3038', '#58626e', '#98a4b0', '#e4ecf4');
const BRASS = tn('#3a2410', '#7a5220', '#b8862e', '#f0c860');
const EYE = hx('#ffe08a');
const EYE_OFF = hx('#1a1210');
const CHEEK = hx('#e06060');
const MOUS = hx('#3a2410');
const DUST: RGBA[] = [hx('#6a5a48'), hx('#8a7a64'), hx('#4a3e32')];
const SPARK = hx('#fff4d0');
const SPARK2 = hx('#ffc860');

/** Ружьё: точка хвата `c` (в рамке таза без наклона), курс и подъём, руки вдоль ствола. */
interface Gun {
  c: V3;
  wy: number;
  wp: number;
  hr: number;
  hl: number | null;
}

const lerpGun = (a: Gun, b: Gun, k: number): Gun => ({
  c: vlerp(a.c, b.c, k),
  wy: lerp(a.wy, b.wy, k),
  wp: lerp(a.wp, b.wp, k),
  hr: lerp(a.hr, b.hr, k),
  hl: a.hl === null || b.hl === null ? (k < 0.5 ? a.hl : b.hl) : lerp(a.hl, b.hl, k),
});

// У плеча (строевой шаг), наперевес, отведено назад, выпад, повисло, к ноге,
// над головой и прикладом в пол (отголосок).
const SHOULDER: Gun = { c: [1.5, 4.3, 7.4], wy: 0, wp: 1.42, hr: -6.4, hl: null };
const PORT: Gun = { c: [3.4, 1.5, 4.2], wy: -0.08, wp: 0.07, hr: -4.8, hl: 1.6 };
const BACK: Gun = { c: [0.4, 1.5, 4.8], wy: -0.04, wp: 0.12, hr: -4.8, hl: 1.6 };
const LUNGE: Gun = { c: [8.6, 1.4, 3.2], wy: -0.06, wp: -0.05, hr: -4.8, hl: 1.6 };
const DROOP: Gun = { c: [2.8, 3.8, 3.4], wy: 0.1, wp: 0.95, hr: -6.4, hl: null };
const REST: Gun = { c: [1.6, 4.6, -2.4], wy: 0, wp: 1.5, hr: 5.2, hl: null };
const RAISE: Gun = { c: [2.2, 0.5, 14.5], wy: 0, wp: 1.45, hr: -4.6, hl: -1.2 };
const SLAM: Gun = { c: [5.4, 0.5, -0.6], wy: 0, wp: 1.38, hr: -4.6, hl: -1.2 };

const GUN_BUTT = 7.5;
const GUN_MUZ = 9.4;
const BAYO = 5.8;

interface SoO {
  ph: number;
  step: number;
  fwd: number;
  lift: number;
  crouch: number;
  lean: number;
  roll: number;
  twist: number;
  head: number;
  hturn: number;
  /** Стойка: левая нога вперёд, правая назад. */
  wide: number;
  gun: Gun;
  /** Поворот ключа (рад), ключ вылетел 0…1, ключ светится (слабое место). */
  key: number;
  keyOut: number;
  keyGlow: number;
  /** Султан и фалды отстают (+ назад). */
  plume: number;
  tails: number;
  /** Глаза горят 0…1. */
  lit: number;
  /** Мах свободной (левой) руки: + вперёд. */
  armL: number;
  /** Падает навзничь, рад. */
  fall: number;
  /** Пружина выскочила из спины 0…1. */
  spring: number;
}

const S0: SoO = {
  ph: 0,
  step: 0,
  fwd: 0,
  lift: 0,
  crouch: 0,
  lean: 0.03,
  roll: 0,
  twist: 0,
  head: 0,
  hturn: 0,
  wide: 0,
  gun: SHOULDER,
  key: 0,
  keyOut: 0,
  keyGlow: 0,
  plume: 0,
  tails: 0,
  lit: 1,
  armL: 0,
  fall: 0,
  spring: 0,
};

const LEG = 10.6;
const STRIDE = 7;

/** Призма (кивер): `n` граней от `z0` до `z1` по оси рамки, крышка сверху. */
function prism(
  r: Rig,
  F: F3,
  z0: number,
  z1: number,
  r0: number,
  r1: number,
  n: number,
  m: Mat,
  top: Mat,
): void {
  const ring = (z: number, rad: number) => {
    const out: V3[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + PI / n;
      out.push(F.p(Math.cos(a) * rad, Math.sin(a) * rad, z));
    }
    return out;
  };
  const a = ring(z0, r0);
  const b = ring(z1, r1);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    r.poly([a[i], a[j], b[j], b[i]], m);
  }
  r.poly(b, top);
}

interface Pts {
  tip: V3;
  base: V3;
  butt: V3;
  key: V3;
  head: V3;
}

/** Каркас солдатика: тело, ружьё, ключ; возвращает точки для 2D (след, искры). */
function soldierRig(o: SoO, yaw: number, r: Rig): Pts {
  const B0 = F3.yaw(yaw);
  // Падение навзничь: всё тело — вокруг пяток.
  const B = o.fall
    ? B0.at(-1.2, 0, 1.3 * Math.sin(o.fall))
        .pitch(-o.fall)
        .at(1.2, 0, 0)
    : B0;
  const cs = camSide(yaw);
  // Таз: высота — по опорной ноге (шаг ножницами поднимает и опускает).
  const offs = [gait(o.ph)[0], gait(o.ph + 0.5)[0]];
  const stance = o.ph % 1 < 0.5 ? offs[0] : offs[1];
  const reach = Math.abs(stance * STRIDE * o.step);
  const hipZ = Math.sqrt(Math.max(1, LEG * LEG - reach * reach)) - o.crouch + o.lift;
  const P = B.at(o.fwd, 0, hipZ).roll(o.roll);
  const T = P.turn(o.twist).pitch(o.lean);
  const G = B.at(o.fwd, 0, hipZ).turn(o.twist * 0.4);
  const red: Mat = { T: REDC };
  const navy: Mat = { T: NAVY };
  const boot: Mat = { T: BOOT, spec: true };
  const brass: Mat = { T: BRASS, spec: true };
  const glove: Mat = { T: BELT };
  // Ноги: прямые, как у оловянного, шаг ножницами; стойка выпада — шире.
  for (const sd of [-1, 1]) {
    const hip = P.p(0, sd * 1.9, 0);
    const [off, rise] = gait(o.ph + (sd > 0 ? 0.5 : 0));
    const stanceF = sd < 0 ? o.wide : -o.wide * 0.8;
    const foot = B.p(o.fwd + off * STRIDE * o.step + stanceF, sd * 2.1, rise * 2.0 * o.step);
    const knee = ik(hip, foot, 5.4, 5.5, B.v(1, sd * 0.1, 0));
    r.cap(hip, knee, 1.6, 1.35, navy);
    const shin = vlerp(knee, foot, 0.45);
    r.cap(knee, shin, 1.35, 1.3, navy);
    r.cap(shin, foot, 1.35, 1.2, boot);
    r.cap(foot, vadd(foot, B.v(2.1, 0, -0.2)), 1.15, 0.95, boot);
  }
  // Таз, фалды, мундир с перевязью.
  r.ell(P, [0, 0, 0.9], [2.2, 2.7, 1.7], navy);
  for (const sd of [-1, 1]) {
    const lag = o.tails;
    r.poly(
      [
        T.p(-2.1, sd * 0.3, 1.8),
        T.p(-2.1, sd * 2.4, 1.8),
        P.p(-2.4 - lag * 1.8, sd * 2.0, -3.8 + lag * 0.9),
        P.p(-2.2 - lag * 1.8, sd * 0.4, -3.4 + lag * 0.9),
      ],
      { T: REDC, bias: -0.1 },
    );
  }
  const coat: Mat = {
    T: REDC,
    pat: (q, l) => {
      // Перевязь крест-накрест и бляха на перекрестье.
      const b1 = Math.abs(q[1] - 0.85 * (q[2] - 0.1));
      const b2 = Math.abs(q[1] + 0.85 * (q[2] - 0.1));
      if (q[0] > 0.35 && Math.abs(q[1]) < 0.2 && Math.abs(q[2] - 0.1) < 0.2)
        return l > 0.5 ? BRASS[3] : BRASS[2];
      if (q[2] > -0.75 && (b1 < 0.17 || b2 < 0.17)) return l > 0.4 ? BELT[2] : BELT[1];
      return null;
    },
  };
  r.ell(T, [0.1, 0, 5.2], [2.5, 3.2, 4.2], coat);
  r.ell(T, [0.1, 0, 1.8], [2.6, 3.0, 0.8], { T: BELT });
  // Эполеты.
  for (const sd of [-1, 1]) r.ell(T, [0, sd * 3.3, 8.4], [1.5, 1.4, 0.75], brass);
  // Голова и кивер.
  r.cap(T.p(0, 0, 8.6), T.p(0.15, 0, 9.8), 1.2, 1.1, { T: SKIN });
  const Hd = T.at(0.3, 0, 11.6).turn(o.hturn).pitch(o.head);
  r.ball(Hd.p(0, 0, 0), 2.7, { T: SKIN });
  for (const sd of [-1, 1]) {
    r.dot(
      Hd.p(2.45, sd * 0.95, -0.1),
      o.lit > 0.5 ? EYE : EYE_OFF,
      o.lit > 0.5 ? o.lit : 0,
      1,
      0.6,
    );
    r.dot(Hd.p(2.1, sd * 1.75, -0.75), CHEEK, 0, 1, 0.5);
  }
  r.line(Hd.p(2.55, -0.9, -0.95), Hd.p(2.55, 0.9, -0.95), MOUS, 0, 0.4);
  r.eye = o.lit > 0.5 ? Hd.p(2.45, cs * 0.95, -0.1) : null;
  const Sh = Hd.at(-0.15, 0, 1.95).pitch(-0.06);
  prism(r, Sh, 0, 6.2, 2.75, 3.0, 8, { T: HAT }, { T: HAT, bias: 0.25 });
  r.ell(Sh, [2.85, 0, 3.3], [0.4, 1.1, 1.2], brass);
  // Козырёк.
  r.poly([Sh.p(2.4, -2.2, 0.3), Sh.p(2.4, 2.2, 0.3), Sh.p(3.4, 1.6, 0.2), Sh.p(3.4, -1.6, 0.2)], {
    T: HAT,
    bias: 0.1,
  });
  // Султан: отстаёт по инерции.
  const pb = Sh.p(1.2, 0, 6.2);
  const pt = vadd(pb, Sh.v(-o.plume * 2.2, 0, 3.6 - Math.abs(o.plume) * 0.6));
  r.cap(pb, pt, 1.05, 0.7, { T: PLUME });
  r.ball(pt, 0.85, { T: PLUME, bias: 0.15 });
  // Ключ в спине: бородка вращается вокруг оси «вперёд».
  const kb = T.at(-2.5, 0, 5.4);
  let keyP: V3;
  if (o.keyOut <= 0) {
    r.cap(kb.p(0, 0, 0), kb.p(-1.9, 0, 0), 0.5, 0.5, brass);
    const K = kb.at(-2.6, 0, 0).roll(o.key);
    const km: Mat = { T: BRASS, spec: true, glow: o.keyGlow * 0.75, bias: o.keyGlow * 0.15 };
    r.ell(K, [0, 1.45, 0], [0.45, 1.3, 0.95], km);
    r.ell(K, [0, -1.45, 0], [0.45, 1.3, 0.95], km);
    r.ball(K.p(0, 0, 0), 0.6, km);
    keyP = K.p(0, 0, 0);
  } else {
    // Вылетел: дугой вверх-назад, кувыркаясь, и на пол.
    const k = o.keyOut;
    const from = kb.p(-2.6, 0, 0);
    const to = B0.p(-9, 2.5 * cs, 0.8);
    const p = vadd(vlerp(from, to, k), [0, 0, Math.sin(PI * k) * 8]);
    const K = F3.yaw(yaw + k * 5, p).roll(o.key + k * 9);
    r.cap(K.p(1.0, 0, 0), K.p(2.9, 0, 0), 0.5, 0.5, brass);
    r.ell(K, [0, 1.45, 0], [0.45, 1.3, 0.95], brass);
    r.ell(K, [0, -1.45, 0], [0.45, 1.3, 0.95], brass);
    keyP = p;
  }
  // Пружина выскочила из спины: завитки.
  if (o.spring > 0) {
    const n = 7;
    let prev = kb.p(0, 0, 0);
    for (let i = 1; i <= n; i++) {
      const u = i / n;
      const a = u * TAU * 2.2;
      const p = kb.p(
        -u * 6 * o.spring,
        Math.cos(a) * 1.3,
        1 + u * 3 * o.spring + Math.sin(a) * 1.3,
      );
      r.cap(prev, p, 0.35, 0.35, brass);
      prev = p;
    }
  }
  // Ружьё.
  const g = o.gun;
  const cw = Math.cos(g.wp);
  const d = vnorm(G.v(cw * Math.cos(g.wy), cw * Math.sin(g.wy), Math.sin(g.wp)));
  const c = G.p(g.c[0], g.c[1], g.c[2]);
  const butt = vadd(c, vmul(d, -GUN_BUTT));
  const wrist = vadd(c, vmul(d, -2.6));
  const muz = vadd(c, vmul(d, GUN_MUZ));
  r.cap(butt, wrist, 1.15, 0.75, { T: WOOD });
  r.cap(wrist, vadd(c, vmul(d, 4.6)), 0.8, 0.75, { T: WOOD });
  r.cap(vadd(c, vmul(d, 2)), muz, 0.55, 0.5, { T: STEEL, bias: -0.1 });
  r.ell(new F3(vadd(c, vmul(d, 4.4)), d, G.s, G.u), [0, 0, 0], [0.35, 0.9, 0.9], brass);
  r.spike(muz, d, BAYO, 0.5, { T: STEEL, spec: true }, 3);
  // Руки: правая — на прикладе, левая — на ложе или машет.
  const shR = T.p(0, 3.3, 7.8);
  const shL = T.p(0, -3.3, 7.8);
  const hR = vadd(c, vmul(d, g.hr));
  const hL =
    g.hl !== null
      ? vadd(c, vmul(d, g.hl))
      : T.p(Math.sin(o.armL) * 7.4, -3.9 - Math.abs(o.armL) * 0.4, 7.8 - Math.cos(o.armL) * 7.4);
  for (const [sh, hd, sd] of [
    [shR, hR, 1],
    [shL, hL, -1],
  ] as [V3, V3, number][]) {
    const el = ik(sh, hd, 4.2, 4.2, T.v(-1, sd * 0.6, -0.2));
    r.cap(sh, el, 1.3, 1.1, red);
    r.cap(el, hd, 1.1, 0.95, red);
    r.ball(hd, 1.05, glove);
  }
  return {
    tip: vadd(muz, vmul(d, BAYO)),
    base: muz,
    butt,
    key: keyP,
    head: Hd.p(0, 0, 0),
  };
}

// ---- Треки ----------------------------------------------------------------

const AIM_T = 0.7;
const SLAM_T = 0.9;
const RUN_T = 0.6;
const DIE_T = 0.85;
const tf = (f: number) => (f + 0.5) / FPS;

/** Подготовка выпада: щелчок наперевес, отвести назад, дрожь пружины. */
function aimO(T: number, f: number): SoO {
  const k1 = sstep(0, 0.14, T);
  const k2 = smooth(sstep(0.14, 0.46, T));
  const hold = sstep(0.46, 0.52, T);
  const tr = (f % 2 ? 1 : -1) * 0.3 * hold;
  const g = lerpGun(lerpGun(SHOULDER, PORT, easeBack(k1)), BACK, k2);
  return {
    ...S0,
    gun: { ...g, c: [g.c[0] + tr, g.c[1], g.c[2] + tr * 0.4] },
    wide: 2.6 * easeOut(k1) + 0.7 * k2,
    crouch: 0.4 * k1 + 0.7 * k2,
    lean: 0.03 + 0.1 * k1 - 0.26 * k2,
    twist: 0.25 * k1 + 0.18 * k2,
    head: -0.08 * k2,
    lift: tr * 0.3,
    key: T * 15,
    plume: -0.5 * Math.sin(PI * k1) + 0.25 * k2,
    tails: 0.3 * k2,
  };
}

/** Выпад (кадр 0 — контакт) и возврат: отдача, к плечу. */
function thrustO(T: number): SoO {
  const kL = T < 0.13 ? 1 : 1 - smooth(sstep(0.13, 0.42, T));
  const kS = smooth(sstep(0.42, 0.68, T));
  const over = T < 0.13 ? Math.sin((T / 0.13) * PI) * 0.7 : 0;
  const g0 = lerpGun(lerpGun(PORT, LUNGE, kL), SHOULDER, kS);
  return {
    ...S0,
    gun: { ...g0, c: [g0.c[0] + over, g0.c[1], g0.c[2]] },
    wide: 4.6 * kL + 2.4 * (1 - kL) * (1 - kS),
    fwd: 2.2 * kL,
    crouch: 1.3 * kL + 0.4 * (1 - kL) * (1 - kS),
    lean: 0.36 * kL + 0.1 * (1 - kL) * (1 - kS),
    twist: 0.08 * kL + 0.25 * (1 - kL) * (1 - kS),
    head: -0.24 * kL,
    key: AIM_T * 15 + T * 6,
    plume: 0.7 * kL - 0.25 * Math.sin(PI * sstep(0.13, 0.5, T)),
    tails: 0.9 * kL,
  };
}

/** Отголосок: ружьё над головой, дрожь, удар прикладом о пол (контакт — конец). */
function slamO(T: number, f: number): SoO {
  const up = smooth(sstep(0, 0.5, T));
  const hold = sstep(0.5, 0.56, T) * (1 - sstep(0.76, 0.78, T));
  const down = easeIn3(sstep(0.76, SLAM_T, T));
  const tr = (f % 2 ? 1 : -1) * 0.3 * hold;
  const g = lerpGun(lerpGun(SHOULDER, RAISE, up), SLAM, down);
  return {
    ...S0,
    gun: { ...g, c: [g.c[0], g.c[1], g.c[2] + tr] },
    lean: -0.12 * up + 0.4 * down,
    crouch: -0.3 * up + 2.0 * down,
    lift: 0.6 * up * (1 - down),
    head: -0.2 * up + 0.3 * down,
    wide: 1.6 * up,
    key: T * 18,
    plume: -0.3 * up + 0.6 * down,
    tails: 0.4 * down,
  };
}
function slamFO(T: number): SoO {
  const back = smooth(sstep(0.1, 0.4, T));
  const o = slamO(SLAM_T - 0.001, 0);
  return {
    ...o,
    gun: lerpGun(SLAM, SHOULDER, back),
    lean: lerp(0.4, 0.03, back),
    crouch: lerp(2.0, 0, back) - 0.5 * Math.sin(PI * sstep(0.25, 0.45, T)),
    head: lerp(0.3, 0, back),
    wide: lerp(1.6, 0, back),
    key: SLAM_T * 18 + T * 5,
    plume: lerp(0.6, 0, back) - 0.3 * Math.sin(PI * back),
    tails: lerp(0.4, 0, back),
  };
}

/** Завод кончился: ключ замедляется и встаёт, корпус оседает тремя рывками. */
function sagOf(T: number): number {
  const s =
    (sstep(0.06, 0.12, T) + sstep(0.2, 0.26, T) + sstep(0.36, 0.44, T)) / 3 +
    0.06 * Math.sin(PI * sstep(0.44, 0.58, T));
  return s;
}
function slumpO(sag: number, glow: number): SoO {
  return {
    ...S0,
    gun: lerpGun(SHOULDER, DROOP, sag),
    head: 0.8 * sag,
    lean: 0.03 + 0.32 * sag,
    crouch: 1.4 * sag,
    roll: 0.06 * sag,
    armL: 0.1 * sag,
    lit: sag > 0.6 ? 0 : 1,
    plume: -0.5 * sag,
    keyGlow: glow,
  };
}
const KEY_STOP = PI / 2;
function rundownO(T: number): SoO {
  const k = clamp01(T / 0.5);
  const o = slumpO(sagOf(T), sstep(0.3, 0.6, T));
  // Ключ катится и встаёт бородкой поперёк — видно, что стоит.
  o.key = KEY_STOP - (1 - k) * (1 - k) * 3;
  return o;
}
function slumpLoop(f: number): SoO {
  const a = (f / 12) * TAU;
  const o = slumpO(1, 0.75 + 0.25 * Math.cos(a));
  o.roll += 0.03 * Math.sin(a);
  o.head += 0.05 * Math.sin(a + 1);
  o.key = KEY_STOP;
  return o;
}

/** Сам себя заводит: ключ щёлкает назад трещоткой, корпус выпрямляется рывками. */
function rewindO(T: number): SoO {
  let clicks = 0;
  for (let i = 0; i < 6; i++) clicks += sstep(0.08 + i * 0.13, 0.12 + i * 0.13, T);
  const sag = 1 - clicks / 6;
  const jerk = Math.sin(PI * ((((T - 0.08) / 0.13) % 1) + 1)) * 0.04 * (T < 0.86 ? 1 : 0);
  const o = slumpO(sag, 1 - sstep(1.1, 1.2, T));
  const up = easeBack(sstep(0.95, 1.12, T));
  o.gun = lerpGun(lerpGun(SHOULDER, DROOP, sag), SHOULDER, up);
  o.key = KEY_STOP - (clicks * PI) / 3;
  o.lit = T > 0.92 && !(T > 0.98 && T < 1.03) ? 1 : 0;
  o.lift = 1.2 * Math.sin(PI * sstep(1.0, 1.16, T)) + jerk;
  o.crouch += 0.6 * Math.sin(PI * sstep(1.12, 1.2, T));
  return o;
}

/** Строй оживает: глаза мигают, ключ трогается, голова оглядывается, прыжок. */
function wakeO(T: number): SoO {
  const lit = T < 0.15 ? 0 : T < 0.2 ? 1 : T < 0.24 ? 0 : 1;
  return {
    ...S0,
    lit,
    key: 6 * sstep(0.2, 0.8, T) * T,
    hturn: 0.45 * Math.sin(PI * sstep(0.28, 0.6, T)),
    head: -0.1 * Math.sin(PI * sstep(0.28, 0.5, T)),
    lift: 1.6 * Math.sin(PI * sstep(0.5, 0.64, T)),
    crouch: 0.8 * Math.sin(PI * sstep(0.64, 0.76, T)),
    plume: 0.4 * Math.sin(PI * sstep(0.5, 0.76, T)),
  };
}

/** Навзничь: прямой, как доска; отскок, ключ вылетает, пружина наружу. */
function dieO(T: number): SoO {
  const hit = Math.sin(PI * sstep(0, 0.1, T));
  const top = easeIn(sstep(0.06, 0.42, T));
  const bounce =
    0.2 * Math.sin(PI * sstep(0.42, 0.56, T)) + 0.06 * Math.sin(PI * sstep(0.56, 0.64, T));
  return {
    ...S0,
    fall: (PI / 2) * top - bounce,
    lean: -0.15 * hit,
    head: -0.3 * hit,
    lit: T < 0.42 ? 1 : 0,
    keyOut: sstep(0.42, 0.78, T),
    key: T * 10,
    spring: easeOut(sstep(0.44, 0.58, T)),
    plume: 0.6 * top,
    tails: -0.4 * top,
    armL: -0.3 * top,
  };
}

function soPose(anim: string, f: number): SoO {
  const T = tf(f);
  switch (anim) {
    case 'stand': {
      const a = (f / 16) * TAU;
      return {
        ...S0,
        key: (f / 16) * PI,
        roll: 0.03 * Math.sin(a),
        head: 0.04 * Math.sin(a + 0.6),
        plume: 0.18 * Math.sin(a - 0.8),
        tails: 0.1 * Math.sin(a - 0.5),
        armL: 0.06 * Math.sin(a),
        lift: f % 4 === 0 ? -0.2 : 0,
      };
    }
    case 'march': {
      const ph = f / 8;
      return {
        ...S0,
        ph,
        step: 1,
        lean: 0.08,
        roll: 0.05 * Math.sin(ph * TAU),
        key: ph * PI,
        armL: -0.62 * Math.cos(ph * TAU),
        plume: 0.3 + 0.14 * Math.sin((ph - 0.1) * 2 * TAU),
        tails: 0.45 + 0.15 * Math.sin((ph - 0.15) * 2 * TAU),
        head: 0.03 * Math.sin(ph * 2 * TAU),
      };
    }
    case 'aim':
      return aimO(Math.min(T, AIM_T - 0.005), f);
    case 'thrust':
      return thrustO(T);
    case 'slam':
      return slamO(Math.min(T, SLAM_T - 0.005), f);
    case 'slamf':
      return slamFO(T);
    case 'rundown':
      return rundownO(T);
    case 'slump':
      return slumpLoop(f);
    case 'rewind':
      return rewindO(T);
    case 'waking':
      return wakeO(T);
    case 'attn':
      return { ...S0, lit: 0, lean: 0, key: 0.4 };
    case 'flinch': {
      const k = f / 8;
      const b = Math.sin(PI * Math.min(1, k * 1.3)) * (1 - k * 0.6);
      const g = SHOULDER;
      return {
        ...S0,
        lean: -0.35 * b,
        head: -0.5 * b,
        twist: -0.2 * b,
        crouch: 0.5 * b,
        gun: { ...g, c: [g.c[0] - 1.4 * b, g.c[1], g.c[2]], wp: g.wp + 0.25 * b },
        key: 0.3 * Math.sin(k * 9),
        plume: 0.7 * b,
        tails: -0.4 * b,
        armL: 0.5 * b,
      };
    }
    case 'die':
      return dieO(T);
    case 'sleep': {
      const a = (f / 4) * TAU;
      return {
        ...S0,
        gun: REST,
        head: 0.6 + 0.03 * Math.sin(a),
        lean: 0.12,
        crouch: 0.4,
        lit: 0,
        roll: 0.02 * Math.sin(a),
        key: KEY_STOP,
        plume: -0.3,
      };
    }
    case 'alert': {
      const k = easeBack(sstep(0, 0.6, T / 0.35));
      return {
        ...S0,
        gun: lerpGun(REST, SHOULDER, k),
        head: lerp(0.6, 0, k),
        lean: lerp(0.12, 0.03, k),
        crouch: lerp(0.4, 0, k),
        lit: T > 0.08 ? 1 : 0,
        lift: 1.2 * Math.sin(PI * sstep(0.1, 0.3, T)),
        key: KEY_STOP + T * 12,
        plume: 0.5 * Math.sin(PI * sstep(0.08, 0.35, T)),
      };
    }
    case 'drop':
      return { ...S0, plume: -0.6, tails: -0.6, armL: 0.9, lift: 0.4 };
    case 'land': {
      const s = Math.sin(PI * sstep(0, 0.2, T)) - 0.25 * Math.sin(PI * sstep(0.2, 0.33, T));
      return {
        ...S0,
        crouch: 1.8 * s,
        lean: 0.12 * s,
        head: 0.2 * s,
        plume: 0.8 * s,
        tails: 0.5 * s,
        armL: 0.5 * s,
        key: T * 8,
      };
    }
  }
  return { ...S0 };
}

// ---- Кадр -----------------------------------------------------------------

const KS = kindOf('soldier', 72, 64, 36, 42, 1800);

function post(anim: string, f: number, d: number, o: RigOut, P: Proj2, pts: Pts): void {
  const yaw = yawN(d);
  if (anim === 'thrust' && f <= 2) {
    // След штыка: от отведённого назад к выпаду; искра на острие.
    const r0 = new Rig();
    const back = soldierRig(aimO(AIM_T - 0.01, 16), yaw, r0);
    const tips = [P(back.tip), P(pts.tip)];
    const bases = [P(back.base), P(pts.base)];
    smear(o, tips, bases, hx('#f4f0e4', f === 0 ? 210 : 120), 0.45);
    if (f <= 1) {
      const [x, y] = P(pts.tip);
      spark2(o, x, y, SPARK);
      spark2(o, x + 1, y, SPARK2, 0.8);
      spark2(o, x - 1, y, SPARK2, 0.8);
      spark2(o, x, y - 1, SPARK2, 0.7);
      if (f === 0) {
        spark2(o, x + 2, y - 1, SPARK2, 0.5);
        spark2(o, x - 2, y + 1, SPARK2, 0.5);
      }
    }
  }
  if (anim === 'slamf' && f < 8) {
    const [x, y] = P(pts.butt);
    spray(o.p, x, y, 12, 9, (f + 2) / 9, 31 + d, DUST, 1.5, 3);
    if (f < 2) {
      spark2(o, x, y, SPARK);
      spark2(o, x - 1, y, SPARK2, 0.7);
      spark2(o, x + 1, y, SPARK2, 0.7);
    }
  }
  if (anim === 'aim' && f >= 11) {
    // Пружина натянута: искорка у ключа.
    const [x, y] = P(pts.key);
    if (f % 3 === 0) spark2(o, x, y - 2, SPARK2, 0.6);
  }
  if (anim === 'rewind') {
    // Щелчок трещотки: искорка у ключа на каждом рывке.
    const T = tf(f);
    for (let i = 0; i < 6; i++)
      if (Math.abs(T - (0.1 + i * 0.13)) < 0.025) {
        const [x, y] = P(pts.key);
        spark2(o, x, y - 2, SPARK);
        spark2(o, x + 1, y - 3, SPARK2, 0.7);
      }
  }
  if (anim === 'land' && f < 6) {
    const [x, y] = P([0, 0, 0]);
    spray(o.p, x, y + 1, 10, 8, (f + 1) / 6, 17 + d, DUST, 1, 1.5);
  }
  if (anim === 'die' && f >= 10) {
    // Шестерёнки и винтики сыплются из спины.
    const k = (f - 10) / 10;
    for (let i = 0; i < 4; i++) {
      const a = hash(d, i, 5) * TAU;
      const dist = (4 + hash(d, i, 6) * 7) * easeOut(k);
      const [x0, y0] = P(pts.key);
      const x = x0 + Math.cos(a) * dist;
      const y = y0 + Math.sin(a) * dist * 0.55 - Math.sin(PI * Math.min(1, k * 1.4)) * 5 + k * 4;
      if (i < 2) cog2(o.p, x, y, 1.9, 6, k * 6 + i, BRASS);
      else spark2(o, Math.round(x), Math.round(y), i === 2 ? STEEL[3] : BRASS[3], 0);
    }
  }
}

const soPic = (anim: string, f: number, d: number): Pic => {
  const o0 = soPose(anim, f);
  const yaw = yawN(d);
  const r = new Rig();
  const pts = soldierRig(o0, yaw, r);
  return draw(KS, r, (o, P) => post(anim, f, d, o, P, pts));
};

/** Режимы, где курс держит мозг (`m.face`), а не скорость. */
const TECH = new Set(['aim', 'recover', 'windup', 'f14_unwound', 'f14_rewind', 'f14_waking']);

registerMobPainter('f14_soldier', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = pose.t;
  const now = pose.now || 0;
  const want = TECH.has(md) || md.startsWith('f14_') ? (m.face ?? 0) : headOf(m);
  const v = visOf(m, pose, want, md === 'aim' ? 14 : 9);
  const d = dirN(v.yaw);
  const ex: Partial<MobFrame> = { shadow: 6 };
  let anim = 'stand';
  let f = 0;
  let gray = false;
  if (md === 'dying') {
    f = fi(t, 20);
    anim = 'die';
    ex.linger = DIE_T;
    ex.alpha = 1 - sstep(0.7, DIE_T, t);
    ex.still = true;
  } else if (md === 'f14_statue' || md === 'f14_frozen') {
    gray = true;
    if (m.data?.frame) {
      anim = 'thrust';
      f = 2;
    } else anim = 'attn';
    ex.still = true;
  } else if (md === 'aim') {
    f = fi(t, 16);
    anim = 'aim';
    ex.still = true;
  } else if (md === 'recover' && v.prev === 'windup') {
    f = fi(t, 11);
    anim = 'slamf';
    ex.still = true;
    if (f < 2) {
      ex.sx = 1.06;
      ex.sy = 0.92;
    }
  } else if (md === 'recover') {
    f = fi(t, 17);
    anim = 'thrust';
    ex.still = true;
    if (f < 3) ex.ghost = { every: 0.03, life: 0.12, tint: '#ffe0a0', alpha: 0.22 };
    if (f < 2) {
      ex.sx = 1.05;
      ex.sy = 0.95;
    }
  } else if (md === 'windup') {
    f = fi(t, 21);
    anim = 'slam';
    ex.still = true;
  } else if (md === 'f14_unwound') {
    if (t < RUN_T) {
      f = fi(t, 14);
      anim = 'rundown';
    } else {
      f = Math.floor(idlePh(m, pose, 1.2) * 12) % 12;
      anim = 'slump';
    }
    ex.still = true;
  } else if (md === 'f14_rewind') {
    f = fi(t, 28);
    anim = 'rewind';
    ex.still = true;
  } else if (md === 'f14_waking') {
    f = fi(t, 19);
    anim = 'waking';
    ex.still = true;
  } else if (md === 'drop') {
    anim = 'drop';
  } else if (md === 'stun' && v.prev === 'drop') {
    f = fi(t, 7);
    anim = 'land';
    if (f < 3) {
      ex.sx = 1 + 0.08 * (1 - f / 3);
      ex.sy = 1 - 0.1 * (1 - f / 3);
    }
  } else if (md === 'stun' || hurtAge(v, now) < 0.2) {
    f = fi(md === 'stun' ? t : hurtAge(v, now), 7);
    anim = 'flinch';
  } else if (md === 'sleep') {
    f = Math.floor(idlePh(m, pose, 2.4) * 4) % 4;
    anim = 'sleep';
  } else if (md === 'alert') {
    f = fi(t, 7);
    anim = 'alert';
  } else if (moving(m, 0.5)) {
    f = Math.floor(((((v.dist / 0.875) % 1) + 1) % 1) * 8) % 8;
    anim = 'march';
  } else {
    f = Math.floor(idlePh(m, pose, 1.6) * 16) % 16;
    anim = 'stand';
  }
  if (md !== 'dying' && !gray) hurtFx(v, now, 0.9, ex);
  return { ...frameOf(KS, anim, f, d, pose, () => soPic(anim, f, d), gray), ...ex };
});

/** Что играет в бою на этом этаже — греется целиком (отголосок 15-го — нет). */
const WARM: [string, number, number[]?][] = [
  ['stand', 16],
  ['march', 8],
  ['aim', 17],
  ['thrust', 18],
  ['flinch', 8],
  ['rundown', 15],
  ['slump', 12],
  ['rewind', 29],
  ['die', 21],
  ['sleep', 4],
  ['alert', 8],
  ['drop', 1],
  ['land', 8],
  ['attn', 1, [2]],
  ['waking', 20, [2]],
];

registerMobWarm('f14_soldier', function* () {
  yield* warmAll(KS, WARM, soPic);
  yield* warmGray(KS, [
    ['attn', [0], [2]],
    ['thrust', [2]],
  ]);
});
