// Мох-пружина (анимации мобов 11): шар мха с глазами на латунной пружине, на
// макушке цветок. Скачет к герою — каждый скачок: сжатие, толчок, полёт,
// посадка; 8 сторон честно (мини-3D риг), морда спереди.
//
// Метроном — `f11-brains.ts` (`f11_moss`, `MOSS`):
// - `f11_hide` — кочка мха в земле (призрак), изредка выглядывают глаза;
// - `f11_pop` 0,45 с — кочка дрожит, шар выстреливает из земли, оседает;
// - `chase` — скачки по пройденному пути (подскок — сдвигом кадра, тень на полу);
// - `f11_crouch` 0,4 с — замах: пружина сжимается до упора, дрожь;
// - `f11_jump` 0,8 с — прыжок к метке; высота нарисована сдвигом кадра (рендер
//   `data.z` не знает), перед посадкой пружина тянется вниз; урон — в миг
//   посадки, кадр контакта — первый кадр следующего режима (`land`);
// - `f11_tired` 1,5 с — сплющен, пружина обвисла, пыхтит, пот (окно ×1,5);
// - удар героя — вздрог 5 кадров; смерть 0,85 с: пружина отскакивает и
//   ложится, шар падает, сдувается, мох осыпается, цветок слетает.

import { registerMobPainter, registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import { MOSS as AI } from './f11-brains';
import {
  F3,
  FPS,
  KRig,
  PI,
  TAU,
  camSide,
  clamp01,
  dirN,
  draw,
  easeOut,
  fi,
  frameOf,
  hash,
  headOf,
  hurtAge,
  hurtFx,
  hx,
  kindOf,
  lerp,
  moving,
  put,
  spray,
  sstep,
  tf,
  tn,
  trk,
  vadd,
  vlerp,
  vmul,
  vnorm,
  visOf,
  warmAll,
  yawN,
} from './f11-mobkit';
import type { Pic, RGBA, RigOut, Tones, V3 } from './f11-mobkit';
import type { Mat } from './f15-rig';

const MOSS = tn('#26492a', '#36633a', '#4f8446', '#76ad58');
const MOSS_L = tn('#2e5a30', '#447a40', '#62a052', '#94c870');
const BRASS = tn('#5a3c14', '#a07a30', '#d0a84a', '#f4d884');
const FOOTC = tn('#2e2416', '#4a3a24', '#6a5434', '#8a744c');
const SOIL: RGBA[] = [hx('#4a3a28'), hx('#6a5238'), hx('#3a2c1e')];
const BITS: RGBA[] = [MOSS[1], MOSS[2], MOSS_L[2], MOSS[0]];
const PETAL = hx('#f4f0ea');
const PETALS = tn('#b8b0a8', '#d8d0c8', '#f4f0ea', '#ffffff');
const PINKS = tn('#a04060', '#c86080', '#e888a8', '#f8b8cc');
const EYEW = tn('#b8b8a8', '#d8d8c8', '#f4f4ea', '#ffffff');
const INK = hx('#150f0b');
const PUPIL = tn('#0a0806', '#150f0b', '#2a2018', '#4a3a2c');
const MOUTH = tn('#2a0c0c', '#3a1414', '#5a2020', '#7a3030');
const SWEAT = hx('#9ad0f0');

const R = 6; // радиус шара
const RC = 2.4; // радиус витка пружины
const FOOT = 0.9; // высота подставки
const HOP_H = 5; // подскок шага, пикс
const JUMP_H = 20; // высота прыжка, пикс

const band = (T: Tones, l: number): RGBA =>
  l > 0.78 ? T[3] : l > 0.38 ? T[2] : l > -0.02 ? T[1] : T[0];

/** Мох пятнами: тон по свету со сдвигом по крупному шуму на теле. */
const mossMat = (T: Tones): Mat => ({
  T,
  pat: (q, l) => {
    const n = hash(
      Math.floor(q[0] * 3.2 + 9),
      Math.floor(q[1] * 3.2 + 9),
      Math.floor(q[2] * 3.2 + 9),
    );
    return band(T, l + (n - 0.5) * 0.5);
  },
});
const MOSS_M = mossMat(MOSS);
const TUFT_M = mossMat(MOSS_L);

interface MoO {
  /** Длина пружины, пикс. */
  L: number;
  /** Шар впереди подставки (по курсу) и вбок, пикс. */
  lean: number;
  side: number;
  /** Масштаб шара: по горизонтали и по высоте. */
  sx: number;
  sy: number;
  /** Наклон шара мордой вниз и вбок, рад. */
  pitch: number;
  roll: number;
  /** Шар выше (без пружины — над полом), пикс. */
  bz: number;
  /** 0…1 — ушёл в землю кочкой. */
  mound: number;
  /** Глаза: 0 открыты, 1 злые, 2 закрыты, 3 зажмурены, 4 крестики, 5 спрятаны. */
  eyes: number;
  /** Рот: 0 черта, 1 открыт, 2 оскал. */
  mouth: number;
  /** Зрачки вниз 0…1. */
  look: number;
  /** Цветок клонится 0…1. */
  droop: number;
  /** Смерть: пружина оторвалась (шар лежит на полу) и ложится 0…1. */
  det: number;
  cfall: number;
  /** Цветок слетел 0…1 (лежит на полу). */
  fall: number;
}
const M0: MoO = {
  L: 5,
  lean: 0,
  side: 0,
  sx: 1,
  sy: 1,
  pitch: 0,
  roll: 0,
  bz: 0,
  mound: 0,
  eyes: 0,
  mouth: 0,
  look: 0,
  droop: 0.3,
  det: 0,
  cfall: 0,
  fall: 0,
};

/** Кочки мха на шаре — точки на единичной сфере (без морды). */
const TUFTS: { q: V3; r: number; l: boolean }[] = (() => {
  const out: { q: V3; r: number; l: boolean }[] = [];
  for (let i = 0; out.length < 11 && i < 60; i++) {
    const a = hash(i, 3, 41) * TAU;
    const z = -0.35 + hash(i, 4, 42) * 1.3;
    const c = Math.sqrt(Math.max(0, 1 - z * z));
    const q: V3 = [Math.cos(a) * c, Math.sin(a) * c, Math.min(1, z)];
    if (q[0] > 0.1 && Math.abs(q[1]) < 0.85 && q[2] < 0.8 && q[2] > -0.75) continue; // морда
    if (out.some((o) => Math.hypot(o.q[0] - q[0], o.q[1] - q[1], o.q[2] - q[2]) < 0.55)) continue;
    out.push({ q, r: 1.35 + hash(i, 5, 43) * 0.55, l: hash(i, 6, 44) < 0.5 });
  }
  return out;
})();

/** Пружина: спираль из капсул от `a` к `b` (мир). */
function coil(r: KRig, a: V3, b: V3, turns: number, m: Mat): void {
  const ax = vnorm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
  const ref: V3 = Math.abs(ax[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const c1 = vnorm([
    ax[1] * ref[2] - ax[2] * ref[1],
    ax[2] * ref[0] - ax[0] * ref[2],
    ax[0] * ref[1] - ax[1] * ref[0],
  ]);
  const c2: V3 = [
    ax[1] * c1[2] - ax[2] * c1[1],
    ax[2] * c1[0] - ax[0] * c1[2],
    ax[0] * c1[1] - ax[1] * c1[0],
  ];
  const n = Math.round(turns * 9);
  let prev: V3 | null = null;
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    const th = k * turns * TAU + 0.6;
    const p = vadd(vlerp(a, b, k), vadd(vmul(c1, Math.cos(th) * RC), vmul(c2, Math.sin(th) * RC)));
    if (prev) r.cap(prev, p, 0.62, 0.62, m);
    prev = p;
  }
}

/** Точка на поверхности шара спереди: вбок `s`, вверх `u` (в долях радиуса). */
function face(o: MoO, s: number, u: number, out = 0): V3 {
  const a = R * o.sx;
  const c = R * o.sy;
  const k = 1 - (s / a) ** 2 - (u / c) ** 2;
  return [a * Math.sqrt(Math.max(0.05, k)) + out, s, u];
}

function mossRig(o: MoO, yaw: number): KRig {
  const r = new KRig(1);
  const B = F3.yaw(yaw);
  const brass: Mat = { T: BRASS, spec: true };
  // Подставка и пружина (под землёй — не рисуем).
  r.ell(B, [0, 0, 0.45], [RC + 0.7, RC + 0.7, 0.45], { T: FOOTC });
  let zc = FOOT + o.L + R * o.sy + o.bz;
  if (o.det > 0) zc = R * o.sy + o.bz;
  zc = lerp(zc, 0.4, o.mound);
  if (o.mound < 0.5) {
    if (o.det > 0) {
      // Оторвалась: ложится назад, за спину.
      const base: V3 = [0, 0, lerp(FOOT, RC + 0.3, o.cfall)];
      const ang = o.cfall * PI * 0.5;
      const L = 7;
      const top: V3 = [-Math.sin(ang) * L, 0, base[2] + Math.cos(ang) * L];
      coil(r, B.p(...base), B.p(...top), 2.5, brass);
    } else {
      const bot = zc - R * o.sy * 0.8;
      coil(r, B.p(0, 0, FOOT), B.p(o.lean, o.side, Math.max(FOOT + 0.4, bot)), 2.5, brass);
    }
  }
  // Шар.
  const Bf = B.at(o.lean, o.side, zc).pitch(o.pitch).roll(o.roll);
  const a = R * o.sx;
  const c = R * o.sy;
  // Ушёл в землю: срезаем всё ниже пола (шар не наклонён).
  const cut = o.mound > 0 || zc - c < 0 ? (q: V3) => zc + q[2] * c < 0.3 : undefined;
  r.ell(Bf, [0, 0, 0], [a, a, c], MOSS_M, cut);
  // Кочки мха — ломают круглый силуэт.
  for (const t of TUFTS) {
    const p = Bf.p(t.q[0] * a * 0.9, t.q[1] * a * 0.9, t.q[2] * c * 0.9);
    if (p[2] < 0.8) continue;
    r.ball(p, t.r * (0.85 + 0.15 * o.sx), t.l ? TUFT_M : MOSS_M);
  }
  // Травинки на макушке.
  for (let i = 0; i < 3; i++) {
    const s = (i - 1) * 1.8;
    const b = Bf.p(-1.2 + i * 0.8, s, c * 0.92);
    r.spike(
      b,
      Bf.v(-0.2 - o.droop * 0.3, s * 0.2, 1),
      2.4 + (i % 2),
      0.45,
      { T: MOSS_L, bias: 0.15 },
      3,
    );
  }
  // Цветок: стебель и венчик; клонится, на смерти слетает на пол.
  {
    const st = Bf.p(-1.0, 1.4, c * 0.96);
    let fl = vadd(st, Bf.v(0.6 * o.droop, 0.3 * o.droop, 1.6 - o.droop * 0.6));
    if (o.fall > 0) fl = vlerp(fl, B.p(-2, 6, 0.6), easeOut(o.fall));
    if (o.fall < 0.3) r.line(st, fl, MOSS[1]);
    const P = o.fall > 0 ? F3.yaw(yaw) : Bf;
    for (const [df, ds] of [
      [0.9, 0],
      [-0.9, 0],
      [0, 0.9],
      [0, -0.9],
    ])
      r.ball(vadd(fl, P.v(df, ds, 0)), 0.75, { T: PETALS, bias: 0.3 });
    r.ball(vadd(fl, [0, 0, 0.3]), 0.6, { T: PINKS, bias: 0.3 });
  }
  // Морда: глаза, брови, рот.
  if (o.eyes !== 5) {
    const eu = lerp(0.8, 3.1, o.mound) * o.sy;
    for (const sd of [-1, 1]) {
      const e = face(o, sd * 2.3, eu, 0.1);
      if (o.eyes <= 1) {
        r.ball(Bf.p(...e), 1.55, { T: EYEW, bias: 0.35 });
        const pu = eu - 0.25 - o.look * 0.6;
        const pp = Bf.p(e[0] + 1.25, sd * 2.0, pu);
        r.ball(pp, 0.72, { T: PUPIL, bias: 0.5 });
        if (sd === camSide(yaw)) r.eye = pp;
      } else {
        const p0 = face(o, sd * 1.1, eu, 0.15);
        const p1 = face(o, sd * 2.9, eu + (o.eyes === 3 ? 0.7 : 0), 0.15);
        if (o.eyes === 4) {
          const q0 = face(o, sd * 1.1, eu + 0.9, 0.15);
          const q1 = face(o, sd * 2.9, eu - 0.9, 0.15);
          const w0 = face(o, sd * 1.1, eu - 0.9, 0.15);
          const w1 = face(o, sd * 2.9, eu + 0.9, 0.15);
          r.line(Bf.p(...q0), Bf.p(...q1), INK, 0, 0.9);
          r.line(Bf.p(...w0), Bf.p(...w1), INK, 0, 0.9);
        } else r.line(Bf.p(...p0), Bf.p(...p1), INK, 0, 0.9);
      }
      if (o.eyes === 1 || o.eyes === 3) {
        // Брови: внутренний край ниже — злость.
        const b0 = face(o, sd * 0.9, eu + 1.5, 0.2);
        const b1 = face(o, sd * 3.0, eu + 2.3, 0.2);
        r.line(Bf.p(...b0), Bf.p(...b1), INK, 0, 0.9);
      }
    }
    if (o.mound < 0.5) {
      const mu = -1.6 * o.sy;
      if (o.mouth === 0) {
        r.line(Bf.p(...face(o, -1.0, mu, 0.1)), Bf.p(...face(o, 1.0, mu, 0.1)), INK, 0, 0.9);
      } else {
        const m = face(o, 0, mu, -0.6);
        r.ell(Bf, m, [0.7, o.mouth === 2 ? 1.5 : 1.1, o.mouth === 2 ? 0.7 : 1.0], {
          T: MOUTH,
          bias: 0.2,
        });
        if (o.mouth === 2)
          for (const s of [-0.8, 0, 0.8])
            r.dot(Bf.p(...face(o, s, mu + 0.45, 0.15)), PETAL, 0, 1, 1);
      }
    }
  }
  return r;
}

// ---------------------------------------------------------------------------
// Дорожки
// ---------------------------------------------------------------------------

function idleO(f: number): MoO {
  const a = (f / 8) * TAU;
  const s = Math.sin(a);
  return {
    ...M0,
    L: 5 + 0.8 * s,
    sx: 1 + 0.045 * s,
    sy: 1 - 0.05 * s,
    lean: 0.5 * Math.sin(a + 1.2),
    pitch: 0.05 * Math.sin(a + 2),
    droop: 0.3 + 0.25 * Math.sin(a - 1),
    eyes: f === 6 ? 2 : 0,
  };
}

/** Подскок шага: доля фазы `f/8` → высота, пикс. */
const hopH = (f: number) => {
  const u = f / 8;
  return u > 0.2 && u < 0.88 ? Math.sin((PI * (u - 0.2)) / 0.68) * HOP_H : 0;
};

function hopO(f: number): MoO {
  const u = f / 8;
  return {
    ...M0,
    L: trk(u, [
      [0, 1.8],
      [0.125, 3.2],
      [0.25, 7],
      [0.5, 5],
      [0.75, 6.5],
      [0.875, 3.6],
      [1, 1.8],
    ]),
    sx: trk(u, [
      [0, 1.2],
      [0.125, 1.06],
      [0.25, 0.9],
      [0.5, 0.98],
      [0.75, 0.95],
      [0.875, 1.05],
      [1, 1.2],
    ]),
    sy: trk(u, [
      [0, 0.82],
      [0.125, 0.94],
      [0.25, 1.14],
      [0.5, 1.02],
      [0.75, 1.06],
      [0.875, 0.96],
      [1, 0.82],
    ]),
    lean: trk(u, [
      [0, 0],
      [0.25, 1.6],
      [0.5, 1.0],
      [0.75, -0.8],
      [1, 0],
    ]),
    pitch: trk(u, [
      [0, 0.12],
      [0.25, -0.05],
      [0.5, 0.15],
      [0.875, 0.05],
      [1, 0.12],
    ]),
    droop: trk(u, [
      [0, 0.7],
      [0.25, 0],
      [0.75, 0.4],
      [1, 0.7],
    ]),
    eyes: 1,
    mouth: 2,
  };
}

function crouchO(T: number): MoO {
  const k = easeOut(T / 0.24);
  const tr = T > 0.24 ? (Math.floor(T * FPS) % 2 ? 1 : -1) : 0;
  return {
    ...M0,
    L: lerp(5, 1.2, k) + tr * 0.3,
    sx: lerp(1, 1.3, k) + tr * 0.03,
    sy: lerp(1, 0.72, k),
    lean: lerp(0, -0.8, k),
    side: tr * 0.25,
    pitch: trk(T, [
      [0, 0],
      [0.1, -0.12],
      [0.3, 0.18],
    ]),
    eyes: 1,
    mouth: 2,
    look: 0.4,
    droop: 0.3 + k * 0.6,
  };
}

function jumpO(T: number): MoO {
  const k = T / AI.air;
  return {
    ...M0,
    L: trk(k, [
      [0, 1.2],
      [0.1, 10],
      [0.22, 7],
      [0.5, 3.5],
      [0.75, 4],
      [0.95, 8],
    ]),
    sx: trk(k, [
      [0, 1.3],
      [0.1, 0.82],
      [0.3, 0.95],
      [0.5, 1.02],
      [0.8, 0.96],
      [1, 0.94],
    ]),
    sy: trk(k, [
      [0, 0.72],
      [0.1, 1.28],
      [0.3, 1.08],
      [0.5, 0.98],
      [0.8, 1.08],
    ]),
    lean: trk(k, [
      [0, -0.8],
      [0.1, 1.8],
      [0.4, 2.2],
      [0.6, 0.5],
      [0.85, -1.4],
      [1, -1],
    ]),
    pitch: trk(k, [
      [0, 0.18],
      [0.12, -0.1],
      [0.45, 0.35],
      [0.8, 0.45],
      [1, 0.3],
    ]),
    eyes: 1,
    mouth: k > 0.7 ? 1 : 2,
    look: trk(k, [
      [0, 0.3],
      [0.5, 1],
    ]),
    droop: trk(k, [
      [0, 0.7],
      [0.12, 0],
      [0.5, 0.3],
      [0.9, 0],
    ]),
  };
}

/** Посадка (кадр 0 — контакт, урон): сплющен в блин, отскок, оседание. */
function landO(f: number): MoO {
  return {
    ...M0,
    L: [1.0, 1.3, 3.8, 7, 6.2, 4.6, 5.3, 5][f],
    sx: [1.45, 1.36, 1.08, 0.9, 0.95, 1.05, 1.0, 1][f],
    sy: [0.6, 0.68, 0.92, 1.12, 1.06, 0.96, 1.01, 1][f],
    pitch: [0.3, 0.2, 0, -0.08, 0.04, 0.06, 0, 0][f],
    lean: [-0.5, -0.3, 0.3, 0.4, 0, -0.2, 0, 0][f],
    eyes: f < 2 ? 3 : 1,
    mouth: f < 2 ? 1 : 2,
    droop: [1, 0.9, 0.2, 0, 0.3, 0.5, 0.4, 0.3][f],
  };
}

function tiredO(f: number): MoO {
  const s = Math.sin((f / 8) * TAU);
  return {
    ...M0,
    L: 2.2 + 0.25 * s,
    sx: 1.14 + 0.04 * s,
    sy: 0.84 - 0.05 * s,
    pitch: 0.32,
    roll: 0.14,
    side: 1.2,
    lean: 0.6,
    eyes: 2,
    mouth: f % 4 < 2 ? 1 : 0,
    look: 1,
    droop: 1,
  };
}

function popO(T: number): MoO {
  const sh = T < 0.12 ? (Math.floor(T * FPS) % 2 ? 0.6 : -0.6) : 0;
  return {
    ...M0,
    mound: trk(T, [
      [0.1, 1],
      [0.14, 0.3],
      [0.18, 0],
    ]),
    L: trk(T, [
      [0.1, 0.5],
      [0.14, 3],
      [0.2, 9],
      [0.27, 2.6],
      [0.33, 5.2],
      [0.4, 4.4],
      [0.45, 5],
    ]),
    sx:
      trk(T, [
        [0, 1.25],
        [0.1, 1.32],
        [0.14, 0.9],
        [0.2, 0.84],
        [0.27, 1.18],
        [0.33, 0.96],
        [0.4, 1.03],
        [0.45, 1],
      ]) +
      Math.abs(sh) * 0.04,
    sy: trk(T, [
      [0, 0.85],
      [0.1, 0.78],
      [0.14, 1.2],
      [0.2, 1.22],
      [0.27, 0.84],
      [0.33, 1.05],
      [0.4, 0.98],
      [0.45, 1],
    ]),
    side: sh,
    eyes: T < 0.12 ? 2 : 1,
    mouth: T < 0.12 ? 0 : 2,
    droop: trk(T, [
      [0.12, 0.2],
      [0.2, 0],
      [0.27, 0.9],
      [0.4, 0.3],
    ]),
  };
}

function hideO(f: number): MoO {
  const s = Math.sin((f / 8) * TAU);
  return {
    ...M0,
    mound: 1,
    sx: 1.28 + 0.03 * s,
    sy: 0.82 + 0.03 * s,
    eyes: f === 3 || f === 4 ? 0 : 5,
    droop: 0.2 + 0.2 * s,
  };
}

function flinchO(f: number): MoO {
  return {
    ...M0,
    lean: [-1.8, -1.2, 0.7, -0.2, 0][f],
    sx: [1.22, 1.12, 0.94, 1.03, 1][f],
    sy: [0.8, 0.88, 1.08, 0.98, 1][f],
    pitch: [-0.25, -0.15, 0.1, 0, 0][f],
    L: [3.6, 3.8, 6, 5.2, 5][f],
    eyes: f < 3 ? 3 : 1,
    mouth: f < 3 ? 1 : 2,
    droop: [1, 0.8, 0, 0.4, 0.3][f],
  };
}

function dieO(f: number): MoO {
  const att = f < 5;
  return {
    ...M0,
    L: [2.5, 2.2, 3.5, 7, 9][Math.min(4, f)],
    det: att ? 0 : 1,
    bz: att ? [0, 0, 0, 0.5, 1.5][f] : [9, 8, 6, 3, 0, 1.6, 2, 1, 0][Math.min(8, f - 5)],
    sx: [
      1.25, 1.18, 0.95, 0.88, 0.9, 0.95, 1, 0.97, 0.95, 1.3, 1.08, 0.98, 1.1, 1.18, 1.22, 1.26, 1.3,
      1.33, 1.35, 1.36,
    ][f],
    sy: [
      0.78, 0.84, 1.1, 1.18, 1.15, 1.08, 1, 1.04, 1.06, 0.7, 0.92, 1.02, 0.9, 0.84, 0.78, 0.72,
      0.66, 0.62, 0.58, 0.56,
    ][f],
    lean: att
      ? [-1.5, -1.2, 0, 0.5, 0.5][f]
      : trk(f, [
          [5, 0.5],
          [9, 2.5],
          [13, 3.2],
        ]),
    side: att
      ? 0
      : -trk(f, [
          [8, 0],
          [13, 1.2],
        ]),
    cfall: att
      ? 0
      : trk(f, [
          [5, 0.2],
          [9, 1],
        ]),
    roll: trk(f, [
      [8, 0],
      [13, -0.55],
    ]),
    pitch: att ? 0 : 0.2,
    eyes: f < 3 ? 3 : 4,
    mouth: 1,
    droop: 1,
    fall: trk(f, [
      [5, 0],
      [9, 1],
    ]),
  };
}

function mossPose(anim: string, f: number): MoO {
  switch (anim) {
    case 'hop':
      return hopO(f);
    case 'hide':
      return hideO(f);
    case 'pop':
      return popO(tf(f));
    case 'crouch':
      return crouchO(tf(f));
    case 'jump':
      return jumpO(tf(f));
    case 'land':
      return landO(f);
    case 'tired':
      return tiredO(f);
    case 'flinch':
      return flinchO(f);
    case 'die':
      return dieO(f);
  }
  return idleO(f);
}

// ---------------------------------------------------------------------------
// Кадры и рисовальщик
// ---------------------------------------------------------------------------

const MK = kindOf('moss', 48, 48, 24, 40, 1400);

const mossPic = (anim: string, f: number, d: number): Pic => {
  const o0 = mossPose(anim, f);
  const yaw = yawN(d);
  return draw(MK, mossRig(o0, yaw), (o: RigOut, P2) => {
    const B = F3.yaw(yaw);
    if (anim === 'pop' && f >= 3 && f <= 9) {
      // Земля и клочья мха из кочки.
      const [x, y] = P2([0, 0, 1]);
      spray(o.p, x, y, 12, 10, (f - 2) / 7, 61, [...SOIL, ...BITS], 9, 7);
    }
    if (anim === 'land' && f <= 4) {
      // Пыль кольцом от удара.
      const [x, y] = P2([0, 0, 0.5]);
      spray(o.p, x, y, 14, 12, (f + 1) / 5, 71 + (f >> 1), [...SOIL, MOSS[2]], 0, 1.5);
    }
    if (anim === 'tired') {
      // Пот: две капли слетают с макушки по очереди.
      for (const k of [0, 1]) {
        const g = (f + k * 4) % 8;
        if (g > 4) continue;
        const sd = k ? 1 : -1;
        const p = P2(B.p(0.5, sd * (4 + g * 0.6), 11.5 - g * 1.3 + g * g * 0.1));
        o.p.set(p[0], p[1], SWEAT);
        if (g < 3) o.p.set(p[0], p[1] - 1, SWEAT);
      }
    }
    if (anim === 'flinch' && f <= 1) {
      const [x, y] = P2(B.p(0, 0, 9));
      spray(o.p, x, y, 5, 7, (f + 1) / 2, 23 + f, BITS, 3, 2);
    }
    if (anim === 'die' && f >= 9) {
      // Мох осыпается с сдувшегося шара.
      const [x, y] = P2(B.p(0, -3, 3));
      spray(o.p, x, y, 12, 11, Math.min(1, (f - 8) / 9), 37, BITS, 5, 3);
    }
  });
};

registerMobPainter('f11_moss', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = pose.t;
  const now = pose.now || 0;
  const id = m.id ?? 0;
  const tx = m.data?.tx;
  const ty = m.data?.ty;
  const aimed =
    (md === 'f11_crouch' || md === 'f11_jump') &&
    typeof tx === 'number' &&
    typeof ty === 'number' &&
    Math.hypot(tx - m.x, ty - m.y) > 0.05;
  const want = aimed
    ? Math.atan2(ty - m.y, tx - m.x)
    : md === 'chase'
      ? headOf(m, 0.5)
      : (m.face ?? 0);
  const v = visOf(m, pose, want, md === 'f11_jump' ? 6 : 9);
  const d = dirN(v.yaw);
  const ex: Partial<MobFrame> = { shadow: 5.5 };
  const ph = hash(id, 11);
  let anim = 'idle';
  let f = 0;
  let dark = 0;
  const landing = (md === 'chase' || md === 'f11_tired') && v.prev === 'f11_jump' && t < 8 / FPS;
  if (md === 'dying') {
    f = fi(t, 19);
    anim = 'die';
    ex.linger = 0.85;
    ex.alpha = 1 - sstep(0.68, 0.85, t);
  } else if (md === 'f11_hide' || md === 'sleep') {
    f = Math.floor(now * 2.2 + ph * 8) % 8;
    anim = 'hide';
    ex.shadow = 0;
  } else if (md === 'f11_pop' || md === 'alert') {
    f = fi(md === 'alert' ? t * (0.45 / 0.35) : t, 10);
    anim = 'pop';
  } else if (md === 'f11_crouch') {
    f = fi(t, 9);
    anim = 'crouch';
    ex.shadow = 6.5;
  } else if (md === 'f11_jump') {
    f = fi(t, 19);
    anim = 'jump';
    const s = Math.sin(PI * clamp01(tf(f) / AI.air));
    ex.dy = -s * JUMP_H;
    ex.shadow = 5.5 - 2.5 * s;
  } else if (landing) {
    f = fi(t, 7);
    anim = 'land';
    ex.shadow = 7 - f * 0.2;
  } else if (md === 'f11_tired') {
    f = Math.floor(now * 5 + ph * 8) % 8;
    anim = 'tired';
    ex.shadow = 6.5;
  } else if (md === 'emerge' || md === 'drop') {
    const k = clamp01(t / (md === 'emerge' ? 0.45 : 0.55));
    f = Math.floor(now * 6 + ph * 8) % 8;
    dark = md === 'emerge' ? 3 - Math.min(3, Math.floor(k * 4)) : 0;
  } else if (md === 'stun' || hurtAge(v, now) < 0.2) {
    f = fi(md === 'stun' ? t : hurtAge(v, now), 4);
    anim = 'flinch';
  } else if (moving(m, 0.5)) {
    // Скачок на ~1,1 клетки пути.
    f = Math.floor((v.dist / 1.1 + ph) * 8) % 8;
    anim = 'hop';
    const h = hopH(f);
    ex.dy = -h;
    ex.shadow = 5.5 - 0.2 * h;
  } else {
    f = Math.floor(now * 6 + ph * 8) % 8;
  }
  if (md !== 'dying') hurtFx(v, now, 1.2, ex);
  return put(
    frameOf(MK, anim, f, d, pose, (dd) => mossPic(anim, f, dd), dark),
    ex,
  );
});

registerMobWarm('f11_moss', function* () {
  yield* warmAll(
    MK,
    [
      ['idle', 8],
      ['hop', 8],
      ['hide', 8],
      ['pop', 11],
      ['crouch', 10],
      ['jump', 20],
      ['land', 8],
      ['tired', 8],
      ['flinch', 5],
      ['die', 20],
    ],
    mossPic,
  );
});
