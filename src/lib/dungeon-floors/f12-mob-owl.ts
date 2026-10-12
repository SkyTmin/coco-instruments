// Этаж 12 — Полярная сова (анимации мобов 12). Мозг `f12_owl` (`f12-brains.ts`):
// `f12_perch` — сидит под сводом (недосягаема); увидела героя — `f12_spot`
// 0,7 с (метка-линия ведёт героя до 0,46 с) → `f12_dive` — пике 10,5 кл/с на
// `data.len` клеток, урон при касании → `f12_ground` 1,1 с на снегу (бьют
// ×1,6) → `f12_rise` 0,55 с → `f12_hover` — кружит над героем (недосягаема).
//
// Кадры (24 к/с, 8 честных сторон; высоту полёта ведёт `lift` — без скачков
// между режимами): полёт 12 (взмах с отставанием кистей + планирование, по
// времени, фаза от id) × 3 крена (в поворот круга), насест 8 поз (голова на
// 90°, моргает, ерошится; 6 к/с, фаза от id), высматривание 17 (+6 — снялась
// с насеста): глаза вспыхнули, крылья вверх, замерла на пике, клюв на цель,
// крылья назад; пике 16 — вход, дротик, удар когтями по оставшемуся пути
// (кадр касания — там, где стоял герой), проводка; на снегу 19 — шлепок,
// барахтается со звёздами (окно урона), собирается; взлёт 14, вздрог 5,
// смерть 16 (перья, кувырок, падение с высоты, `linger`).

import type { Px } from '../dungeon-art';
import { registerMobWarm } from '../dungeon-paint';
import type { MobFrame } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import { hash, hx, ramp, TAU } from './f12-rig';
import {
  angD,
  clamp,
  clamp01,
  dirOf,
  easeIn,
  easeOut,
  fi,
  frameOf,
  hurtFx,
  kindOf,
  lerp,
  limb,
  paintMob,
  PI,
  puff,
  smooth,
  speedOf,
  sstep,
  stars,
  tf,
  trk,
  visOf,
  warmAll,
} from './f12-mobkit';
import type { Build, Part, RGBA, Scr, V3 } from './f12-mobkit';

const OWL_F = ramp('#4c566c', '#7e889c', '#b4bccc', '#dee4ec', '#ffffff');
const OWL_SPECK = ramp('#2a3040', '#4a5264', '#7a8296', '#a6aebe', '#d0d6e0');
const FACE = ramp('#7e889c', '#b4bccc', '#dee4ec', '#f4f8fc', '#ffffff');
const BEAK = ramp('#05060a', '#141620', '#262a36', '#3c4050', '#5a6070');
const TALON = ramp('#05060a', '#0e1018', '#1a1c26', '#2a2c36', '#3c3e48');
const EYE = hx('#ffd23a');
const EYE_HOT = hx('#fff6a0');
const SNOWC: RGBA[] = [hx('#eaf4ff'), hx('#c4d6ee'), hx('#ffffff')];
const FEATH: RGBA[] = [hx('#ffffff'), hx('#d0d6e0'), hx('#a6aebe')];

const K = kindOf('f12_owl', { w: 48, h: 48, ox: 24, oy: 31 }, 1250);

/** Высота полёта (`lift`), насеста; тело в кадре — на `Z_AIR`. */
const AIR = 15;
const PERCH = 22;
const Z_AIR = 7;

/** Поза совы: отклонения от полёта. */
interface OwlO {
  /** Центр тела над землёй кадра. */
  z: number;
  /** 1 — сидит стоймя … 0 — тело вдоль полёта. */
  up: number;
  /** Нос вниз (пике, +) / вверх (торможение, −), рад. */
  dive: number;
  /** Крен всей модели (вираж), рад. */
  bank: number;
  /** Крылья: раскрыты 0…1, угол у плеча и отставание кисти (+ вверх), назад 0…1, длина кисти, веер маховых. */
  spread: number;
  th: number;
  lag: number;
  sweep: number;
  span: number;
  fan: number;
  /** Голова: поворот, наклон (+ вверх), подъём. */
  head: number;
  hp: number;
  hz: number;
  /** Хвост: веер 0…1, наклон. */
  tail: number;
  tailP: number;
  /** Лапы: вперёд когтями 0…1 (удар), к земле 0…1, когти раскрыты 0…1. */
  legs: number;
  stand: number;
  claw: number;
  /** Глаза: −1 закрыты, 0 обычные, 1 горят. */
  eye: number;
  /** Перья ерошатся (−1 прижаты … 1), сжатие тела. */
  ruff: number;
  sq: number;
  /** Снег из-под крыльев (доля 0…1), звёзды (фаза), перья (смерть, 0…1). */
  snow?: number;
  stars?: number;
  feath?: number;
  /** Не рисовать ниже снега (лежит, бьётся). */
  clip?: boolean;
}

const O0: OwlO = {
  z: Z_AIR,
  up: 0,
  dive: 0,
  bank: 0,
  spread: 1,
  th: 0.1,
  lag: 0,
  sweep: 0.15,
  span: 1,
  fan: 0.5,
  head: 0,
  hp: 0,
  hz: 0,
  tail: 0.5,
  tailP: 0,
  legs: 0,
  stand: 0,
  claw: 0,
  eye: 0,
  ruff: 0,
  sq: 1,
};

const NUM = Object.keys(O0) as (keyof OwlO)[];
/** Смесь поз (числа — линейно; флаги — от `b`). */
function mix(a: OwlO, b: OwlO, k: number): OwlO {
  const o = { ...b };
  for (const n of NUM) (o[n] as number) = lerp(a[n] as number, b[n] as number, k);
  return o;
}

const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const mixV = (a: V3, b: V3, k: number): V3 => [
  lerp(a[0], b[0], k),
  lerp(a[1], b[1], k),
  lerp(a[2], b[2], k),
];
const nrm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
/** Наклон носом вверх (a > 0) в плоскости xz. */
const rotP = (v: V3, a: number): V3 => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [v[0] * c - v[2] * s, v[1], v[0] * s + v[2] * c];
};
/** Поворот вокруг вертикали. */
const rotY = (v: V3, a: number): V3 => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]];
};

/**
 * Пластина вдоль отрезка A→B (длина — `rx`), поперёк — `w`, толщина — `th`;
 * `twist` — поворот пластины вокруг своей длины (сложенное крыло — к боку).
 */
function plate(
  A: V3,
  B: V3,
  w: number,
  th: number,
  R: RGBA[],
  id: number,
  twist = 0,
  fur = 0,
  back: V3 = [0, 0, 0],
): Part {
  const dx = B[0] - A[0];
  const dy = B[1] - A[1];
  const dz = B[2] - A[2];
  const L = Math.hypot(dx, dy, dz) || 1e-3;
  return {
    x: (A[0] + B[0]) / 2 + back[0],
    y: (A[1] + B[1]) / 2 + back[1],
    z: (A[2] + B[2]) / 2 + back[2],
    rx: L / 2 + 0.4,
    ry: w,
    rz: th,
    yaw: Math.atan2(dy, dx),
    pitch: Math.atan2(dz, Math.hypot(dx, dy)),
    roll: twist,
    ramp: R,
    id,
    fur,
  };
}

function owlBuild(o: OwlO): Build {
  const parts: Part[] = [];
  const bp = -((1 - o.up) * 1.15 + o.dive);
  const E1: V3 = [Math.cos(bp), 0, Math.sin(bp)];
  const E3: V3 = [-Math.sin(bp), 0, Math.cos(bp)];
  const C: V3 = [0, 0, o.z];
  const cb = Math.cos(o.bank);
  const sb = Math.sin(o.bank);
  /** Вираж: точку модели — вокруг оси «вперёд» через центр тела. */
  const B = (q: V3): V3 => {
    const y = q[1];
    const z = q[2] - o.z;
    return [q[0], y * cb - z * sb, o.z + y * sb + z * cb];
  };
  const ell = (c: V3, rx: number, ry: number, rz: number, R: RGBA[], ex: Partial<Part> = {}) => {
    const q = B(c);
    parts.push({
      x: q[0],
      y: q[1],
      z: q[2],
      rx,
      ry,
      rz,
      ramp: R,
      ...ex,
      roll: (ex.roll ?? 0) + o.bank,
    });
  };

  // Тело — яйцо, грудь светлее.
  ell(C, 3.2, 3.2 * (1 + 0.08 * o.ruff), 4.4 * o.sq, OWL_F, { pitch: bp, fur: 0.2, id: 1 });
  ell(add(add(C, E1, 1.3), E3, 0.9), 1.9, 2.5, 2.7 * o.sq, FACE, { pitch: bp, id: 1 });

  // Голова держится ровнее тела.
  const ha = bp * 0.45 + o.hp;
  const N = add(C, E3, 3.4 * o.sq);
  const H = add(add(N, rotP([0.5, 0, 2.2], bp * 0.45)), [0, 0, o.hz]);
  const ch = Math.cos(o.head);
  const sh = Math.sin(o.head);
  const hpt = (x: number, y: number, z: number): V3 => {
    const v = rotP([x, y, z], ha);
    return [H[0] + v[0] * ch - v[1] * sh, H[1] + v[0] * sh + v[1] * ch, H[2] + v[2]];
  };
  ell(H, 2.8, 3.1 * (1 + 0.05 * o.ruff), 2.7, FACE, { yaw: o.head, pitch: ha, fur: 0.06, id: 2 });
  ell(hpt(1.6, 0, -0.2), 0.85, 2.5, 2.1, FACE, { yaw: o.head, pitch: ha, id: 3 });
  ell(hpt(2.6, 0, -0.85), 0.6, 0.5, 0.6, BEAK, { yaw: o.head, pitch: ha, id: 4 });

  // Хвост.
  const tb = add(add(C, E3, -3.4 * o.sq), E1, -0.7);
  const td = rotP(nrm(add(E3, E1, 0.35)), o.tailP);
  const tt = add(tb, td, -2.8);
  parts.push(plate(B(tb), B(tt), 1.2 + 1.3 * o.tail, 0.45, OWL_SPECK, 5, 0, 0.2));

  // Крылья: у плеча — кроющие (белые), кисть и веер маховых (в крапе).
  const s = smooth(o.spread);
  for (const e of [-1, 1]) {
    const S = add(add(add(C, E1, 0.5), E3, 1.7), [0, e * 2.5, 0]);
    const th1 = o.th;
    const th2 = o.th + o.lag;
    const d1 = nrm([-(0.12 + o.sweep * 0.5), e * Math.cos(th1), Math.sin(th1)]);
    const d2 = nrm([-(0.3 + o.sweep * 1.3), e * Math.cos(th2), Math.sin(th2)]);
    const Ws = add(S, d1, 4.8);
    const Ts = add(Ws, d2, 4.4 * o.span);
    const Wf = add(S, rotP([-1.0, e * 0.9, -2.6], bp));
    const Tf = add(Wf, rotP([-2.0, e * 0.2, -2.2], bp));
    const W = mixV(Wf, Ws, s);
    const T = mixV(Tf, Ts, s);
    const tw = (1 - s) * PI * 0.5;
    const id = e < 0 ? 10 : 20;
    parts.push(plate(B(S), B(W), lerp(1.8, 2.5, s), 0.9, OWL_F, id, tw, 0.14, [-0.9 * s, 0, 0]));
    parts.push(
      plate(B(W), B(T), lerp(1.5, 1.9, s), 0.65, OWL_SPECK, id + 1, tw, 0.22, [-0.6 * s, 0, 0]),
    );
    // Маховые веером назад от кисти.
    const dh = nrm([T[0] - W[0], T[1] - W[1], T[2] - W[2]]);
    for (let i = 0; i < 3; i++) {
      const at = mixV(W, T, 0.75 - i * 0.22);
      const dd = rotY(dh, e * (0.12 + (0.25 + i * 0.33) * o.fan) * s);
      const ln = (3.0 - i * 0.3) * lerp(0.7, 1, s);
      parts.push(plate(B(at), B(add(at, dd, ln)), 0.75, 0.42, OWL_SPECK, id + 2 + i, tw, 0.3));
    }
  }

  // Лапы: в полёте спрятаны в пух; стоит — к земле; удар — когтями вперёд.
  if (o.legs > 0.04 || o.stand > 0.04) {
    for (const e of [-1, 1]) {
      const hip = add(add(C, E3, -2.0), [0, e * 1.2, 0]);
      const tuck = add(hip, [0.2, 0, -0.6]);
      const stand: V3 = [0.7, e * 1.4, 0.5];
      const strike = add(hip, [3.6, e * 0.5, -1.6]);
      const foot = mixV(mixV(tuck, stand, o.stand), strike, o.legs);
      const knee = add(mixV(hip, foot, 0.5), [-0.5 + o.legs * 0.3, e * 0.2, 0]);
      const at = parts.length;
      limb(parts, hip, knee, foot, 1.0, 0.7, OWL_F, 30 + (e < 0 ? 0 : 1), 1);
      parts.push({
        x: foot[0] + 0.3,
        y: foot[1],
        z: foot[2],
        rx: 0.8,
        ry: 0.7,
        rz: 0.55,
        ramp: TALON,
        id: 32,
      });
      if (o.claw > 0.3)
        for (const c of [-1, 1])
          parts.push({
            x: foot[0] + 0.7 + o.claw * 0.4,
            y: foot[1] + c * 0.5 * o.claw,
            z: foot[2] - 0.3,
            rx: 0.45,
            ry: 0.3,
            rz: 0.3,
            ramp: TALON,
            id: 32,
          });
      for (let i = at; i < parts.length; i++) {
        const q = B([parts[i].x, parts[i].y, parts[i].z]);
        parts[i].x = q[0];
        parts[i].y = q[1];
        parts[i].z = q[2];
        parts[i].roll = (parts[i].roll ?? 0) + o.bank;
      }
    }
  }

  const eyes =
    o.eye < 0
      ? []
      : [-1, 1].map((e) => {
          const q = B(hpt(2.75, e * 1.1, 0.3));
          return { x: q[0], y: q[1], z: q[2], c: o.eye > 0 ? EYE_HOT : EYE, r: o.eye > 0 ? 1 : 0 };
        });
  const snow = o.snow ?? 0;
  const st = o.stars;
  const fe = o.feath ?? 0;
  const fx = snow > 0 || st !== undefined || fe > 0;
  return {
    parts,
    eyes,
    clip: o.clip ? 0 : undefined,
    extent: fx
      ? [
          [-11, -11, 0],
          [11, 11, 0],
          [0, 0, o.z + 12],
        ]
      : undefined,
    post: fx
      ? (p, scr) => {
          if (snow > 0) puff(p, scr, 0, 0, snow, 16, 10, 7, SNOWC);
          if (st !== undefined) stars(p, scr, H[2] + 4, st, H[0], H[1], 3.5);
          if (fe > 0) feathers(p, scr, fe, o.z, 12, 3);
        }
      : undefined,
  };
}

/** Перья: брызгами от тела, планируют вниз, покачиваясь. */
function feathers(p: Px, scr: Scr, k: number, z: number, n: number, seed: number): void {
  if (k <= 0 || k >= 1) return;
  for (let i = 0; i < n; i++) {
    const a = hash(i, seed, 601) * TAU;
    const r = (3 + hash(i, seed, 602) * 6) * easeOut(k * 1.6);
    const zz = z + (hash(i, seed, 603) - 0.3) * 7 * easeOut(k * 2) - k * k * 5;
    const sw = Math.sin(k * 9 + i) * 1.2;
    const [x, y] = scr(Math.cos(a) * r + sw, Math.sin(a) * r, zz);
    const c = FEATH[i % 3];
    const al = k > 0.6 ? Math.round((255 * (1 - k)) / 0.4) : 255;
    const col: RGBA = [c[0], c[1], c[2], al];
    p.set(x, y, col);
    if (i % 3 === 0) p.set(x + 1, y, col);
  }
}

// ---------------------------------------------------------------------------
// Позы.
// ---------------------------------------------------------------------------

/** Полёт: цикл 12 кадров — планирование, подъём, гребок вниз, возврат. */
function fly(f: number, bank: number): OwlO {
  const k = f / 12;
  return {
    ...O0,
    th: trk(k, [
      [0, 0.1],
      [0.17, 0.14],
      [0.33, 0.95, easeOut],
      [0.6, -0.55, easeIn],
      [0.8, 0.45],
      [1, 0.1],
    ]),
    lag: trk(k, [
      [0, 0],
      [0.17, 0.02],
      [0.33, -0.45],
      [0.45, 0.15],
      [0.6, 0.4],
      [0.8, -0.4],
      [1, 0],
    ]),
    span: trk(k, [
      [0, 1],
      [0.17, 1],
      [0.33, 0.78],
      [0.5, 1],
      [0.6, 1],
      [0.8, 0.8],
      [1, 1],
    ]),
    sweep: trk(k, [
      [0, 0.15],
      [0.33, 0.45],
      [0.6, 0.05],
      [0.8, 0.4],
      [1, 0.15],
    ]),
    fan: trk(k, [
      [0, 0.5],
      [0.33, 0.35],
      [0.6, 1],
      [0.8, 0.6],
      [1, 0.5],
    ]),
    z:
      Z_AIR +
      trk(k, [
        [0, 0],
        [0.33, -0.6],
        [0.6, 0.9],
        [0.8, 0.3],
        [1, 0],
      ]),
    tailP: trk(k, [
      [0, 0],
      [0.33, 0.12],
      [0.6, -0.12],
      [1, 0],
    ]),
    bank: -bank * 0.38,
    head: bank * 0.3,
  };
}

const PERCH0: OwlO = {
  ...O0,
  z: 4.6,
  up: 1,
  spread: 0,
  th: 0,
  sweep: 0,
  fan: 0,
  tail: 0.15,
  stand: 1,
  claw: 0.4,
};
/** Насест: 8 поз; порядок — `PERCH_SEQ` (6 к/с). */
function perch(i: number): OwlO {
  switch (i) {
    case 1:
      return { ...PERCH0, head: 0.75 };
    case 2:
      return { ...PERCH0, head: 1.45, hp: 0.05 };
    case 3:
      return { ...PERCH0, head: -0.75 };
    case 4:
      return { ...PERCH0, head: -1.45, hp: 0.05 };
    case 5:
      return { ...PERCH0, eye: -1 };
    case 6:
      return { ...PERCH0, ruff: 1, sq: 1.06, spread: 0.08, hz: -0.4 };
    case 7:
      return { ...PERCH0, ruff: 0.5, sq: 1.03, head: 0.15, hz: -0.2, spread: 0.04 };
    default:
      return PERCH0;
  }
}
const PERCH_SEQ = [
  0, 0, 0, 0, 5, 0, 0, 1, 2, 2, 2, 2, 2, 1, 0, 0, 0, 6, 7, 6, 7, 0, 0, 0, 3, 4, 4, 4, 4, 3, 0, 5, 0,
  0, 0, 0,
];

/** Высмотрела: 0,7 с от вспышки глаз до крыльев назад (пике — в 0,7). */
function spot(f: number): OwlO {
  const t = tf(f);
  const hold = t > 0.42 && t < 0.6 ? (f % 2 ? 0.05 : -0.05) : 0;
  return {
    ...O0,
    th:
      trk(t, [
        [0, 0.3],
        [0.12, 0.5],
        [0.4, 0.8, easeOut],
        [0.58, 0.75],
        [0.7, 0.6, easeIn],
      ]) + hold,
    lag:
      trk(t, [
        [0, 0],
        [0.12, -0.3],
        [0.4, 0.15],
        [0.58, 0.2],
        [0.7, -0.1],
      ]) - hold,
    span: trk(t, [
      [0, 0.9],
      [0.4, 1],
      [0.58, 1],
      [0.7, 0.8],
    ]),
    sweep: trk(t, [
      [0, 0.2],
      [0.4, 0],
      [0.58, 0.05],
      [0.7, 0.7, easeIn],
    ]),
    fan: trk(t, [
      [0, 0.5],
      [0.4, 1],
      [0.6, 1],
      [0.7, 0.4],
    ]),
    dive: trk(t, [
      [0, 0],
      [0.4, -0.1],
      [0.46, -0.05],
      [0.58, 0.25],
      [0.7, 0.55, easeIn],
    ]),
    up: trk(t, [
      [0.08, 0],
      [0.4, 0.45, easeOut],
      [0.5, 0.42],
      [0.66, 0, easeIn],
    ]),
    hp: trk(t, [
      [0, 0.1],
      [0.46, 0],
      [0.58, -0.35],
      [0.7, -0.45],
    ]),
    eye: t > 0.04 ? 1 : 0,
    z:
      Z_AIR +
      trk(t, [
        [0, 0],
        [0.4, 0.6],
        [0.7, 0],
      ]),
    tail: trk(t, [
      [0, 0.5],
      [0.4, 1],
      [0.7, 0.3],
    ]),
    ruff: trk(t, [
      [0, 0.3],
      [0.12, -0.4],
    ]),
  };
}

/** Пике: поза дротика. */
const DART: OwlO = {
  ...O0,
  th: 0.2,
  lag: -0.05,
  spread: 0.45,
  sweep: 1,
  span: 0.55,
  fan: 0,
  dive: 0.95,
  hp: -0.25,
  tail: 0,
  eye: 1,
  ruff: -0.5,
};
/** Пике: 0–2 вход, 3–4 дротик, 5–10 удар (10 — касание), 11–15 проводка. */
function dive(f: number): OwlO {
  if (f <= 2) return mix(spot(16), DART, (f + 1) / 3);
  if (f <= 4) return { ...DART, th: DART.th + (f === 3 ? 0.06 : -0.06), lag: f === 3 ? -0.1 : 0 };
  if (f <= 10) {
    const s = (f - 5) / 5;
    return {
      ...DART,
      dive: lerp(0.95, -0.45, easeOut(s)),
      spread: lerp(0.45, 1, easeOut(s)),
      th: trk(s, [
        [0, 0.2],
        [0.6, 1.0],
        [1, 1.2],
      ]),
      lag: trk(s, [
        [0, -0.05],
        [0.6, -0.3],
        [1, 0.1],
      ]),
      sweep: lerp(1, -0.15, easeOut(s)),
      span: lerp(0.55, 1, s),
      fan: s,
      legs: trk(s, [
        [0, 0],
        [0.4, 0.3],
        [1, 1, easeOut],
      ]),
      claw: s > 0.5 ? 1 : 0,
      hp: lerp(-0.25, -0.45, s),
      tail: s,
      ruff: 0,
    };
  }
  const u = (f - 10) / 5;
  return {
    ...DART,
    dive: lerp(-0.45, -0.2, u),
    spread: 1,
    th: trk(u, [
      [0, 1.2],
      [0.4, -0.45, easeIn],
      [1, -0.2],
    ]),
    lag: trk(u, [
      [0, 0.3],
      [0.4, 0.4],
      [1, -0.2],
    ]),
    sweep: 0.05,
    span: 1,
    fan: 1,
    legs: trk(u, [
      [0, 1],
      [0.4, 0.8],
      [1, 0.4],
    ]),
    claw: 0,
    hp: -0.35,
    tail: 1,
    z: lerp(Z_AIR, 4.2, u),
    ruff: 0.3,
  };
}

/** На снегу 1,1 с: 0–3 шлепок, 4–9 барахтается (петля), 10–18 собирается. */
function ground(f: number): OwlO {
  const G: OwlO = {
    ...O0,
    up: 0.35,
    dive: 0.15,
    spread: 1,
    span: 1,
    sweep: 0.1,
    fan: 1,
    tail: 1,
    stand: 0.4,
    clip: true,
  };
  if (f <= 3) {
    const u = f / 3;
    return {
      ...G,
      z: trk(u, [
        [0, 3.6],
        [0.34, 2.0],
        [1, 2.4],
      ]),
      sq: trk(u, [
        [0, 0.8],
        [0.34, 0.72],
        [1, 0.85],
      ]),
      th: trk(u, [
        [0, 0.2],
        [0.34, -0.3],
        [1, -0.2],
      ]),
      lag: -0.1,
      hp: -0.3,
      eye: f < 2 ? -1 : 0,
      snow: (f + 1) / 4.5,
    };
  }
  if (f <= 9) {
    const a = ((f - 4) / 6) * TAU;
    return {
      ...G,
      z: 2.6 + 0.3 * Math.sin(2 * a),
      sq: 0.88,
      up: 0.4,
      spread: 0.95,
      th: 0.05 + 0.3 * Math.sin(a),
      lag: -0.25 * Math.cos(a),
      head: 0.45 * Math.sin(a),
      hz: 0.3 * Math.abs(Math.sin(a)),
      stars: (f - 4) / 6,
    };
  }
  const u = (f - 10) / 8;
  return {
    ...G,
    spread: lerp(0.95, 0.35, smooth(u)),
    th: lerp(0.05, 0.5, u),
    up: lerp(0.4, 0.75, u),
    z: trk(u, [
      [0, 2.6],
      [0.6, 3.4],
      [1, 2.9],
    ]),
    sq: trk(u, [
      [0, 0.9],
      [0.6, 1.02],
      [1, 0.86],
    ]),
    stand: 1,
    hp: lerp(-0.1, 0.15, u),
    tail: lerp(1, 0.5, u),
  };
}

/** Взлёт 0,55 с: толчок лапами, два сильных взмаха, тело ложится в полёт. */
function rise(f: number): OwlO {
  const t = tf(f);
  const flap = t >= 0.08;
  const ph = flap ? ((t - 0.08) / 0.235) % 1 : 0;
  return {
    ...O0,
    up: lerp(0.75, 0, sstep(0, 0.45, t)),
    z: trk(t, [
      [0, 2.9],
      [0.1, 4.6],
      [0.55, Z_AIR],
    ]),
    sq: trk(t, [
      [0, 0.86],
      [0.08, 1.1],
      [0.2, 1],
    ]),
    stand: lerp(1, 0, sstep(0.08, 0.25, t)),
    spread: lerp(0.35, 1, sstep(0, 0.1, t)),
    th: flap
      ? trk(ph, [
          [0, 1.1],
          [0.5, -0.55, easeIn],
          [1, 1.0],
        ])
      : lerp(0.5, 1.1, t / 0.08),
    lag: flap
      ? trk(ph, [
          [0, -0.3],
          [0.3, 0.4],
          [0.5, 0.3],
          [0.75, -0.5],
          [1, -0.3],
        ])
      : 0,
    span: flap ? (ph > 0.55 ? 0.8 : 1) : 0.9,
    sweep: flap && ph > 0.55 ? 0.4 : 0.1,
    fan: 1,
    tail: 0.8,
    hp: 0.1,
    snow: t < 0.3 ? 0.1 + t / 0.33 : 0,
    clip: t < 0.2,
  };
}

/** Вздрог: крылья смяло, голова в плечи — и обратно в полёт. */
function flinch(f: number): OwlO {
  const k = f / 4;
  return mix(
    {
      ...O0,
      th: 0.9,
      lag: -0.4,
      span: 0.6,
      spread: 0.7,
      sweep: 0.6,
      hz: -0.8,
      hp: -0.3,
      ruff: 1,
      bank: 0.3,
      eye: -1,
    },
    O0,
    easeOut(k),
  );
}

/** Смерть 0,67 с: перья, кувырок в воздухе, плашмя на снег, крылья раскинуты. */
function die(f: number): OwlO {
  const t = tf(f);
  const fall = t < 0.42;
  return {
    ...O0,
    eye: -1,
    feath: clamp01(t / 0.62),
    ruff: 1,
    th: trk(t, [
      [0, 1.0],
      [0.12, 0.9],
      [0.3, 0.3],
      [0.42, 0.1],
      [0.48, -0.35],
      [0.67, -0.25],
    ]),
    lag: trk(t, [
      [0, -0.4],
      [0.3, 0.3],
      [0.48, -0.25],
      [0.67, -0.1],
    ]),
    span: trk(t, [
      [0, 0.7],
      [0.42, 1],
    ]),
    spread: trk(t, [
      [0, 0.85],
      [0.3, 0.75],
      [0.48, 1],
    ]),
    sweep: trk(t, [
      [0, 0.3],
      [0.48, 0.15],
    ]),
    head: trk(t, [
      [0, -0.6],
      [0.42, -0.2],
      [0.55, 0.9],
    ]),
    hp: trk(t, [
      [0, 0.4],
      [0.42, -0.2],
      [0.55, -0.35],
    ]),
    up: fall ? 0.2 : 0.1,
    dive: fall ? 0.4 : 0.2,
    // Кувырок через крыло за падение — и плашмя.
    bank: trk(t, [
      [0.1, 0],
      [0.42, TAU, easeIn],
    ]),
    z: trk(t, [
      [0, Z_AIR],
      [0.42, 3, easeIn],
      [0.48, 1.6],
      [0.67, 1.9],
    ]),
    sq: t > 0.42 && t < 0.5 ? 0.78 : t >= 0.5 ? 0.86 : 1,
    snow: t >= 0.42 && t < 0.6 ? 0.15 + (t - 0.42) / 0.22 : 0,
    tail: 1,
    legs: fall ? 0.3 : 0,
    claw: 0,
    clip: !fall,
  };
}

function pose(anim: string, f: number): OwlO {
  switch (anim) {
    case 'fly':
      return fly(f, 0);
    case 'flyP':
      return fly(f, 1);
    case 'flyN':
      return fly(f, -1);
    case 'perch':
      return perch(f);
    case 'spotP':
      return mix(PERCH0, spot(f), smooth((f + 1) / 6));
    case 'spot':
      return spot(f);
    case 'dive':
      return dive(f);
    case 'ground':
      return ground(f);
    case 'rise':
      return rise(f);
    case 'flinch':
      return flinch(f);
    default:
      return die(f);
  }
}

const N: Record<string, number> = {
  fly: 12,
  flyP: 12,
  flyN: 12,
  perch: 8,
  spotP: 6,
  spot: 17,
  dive: 16,
  ground: 19,
  rise: 14,
  flinch: 5,
  die: 16,
};
const build = (anim: string, f: number) => owlBuild(pose(anim, f));

const DIE = 0.85;
/** Касание в пике: центр совы ближе r + r героя + 0,2 к точке, где стоял герой. */
const REACH = 0.34 + 0.3 + 0.2;
/** Метка ведёт на 1,5 клетки за героя (`len` = путь + 1,5). */
const OVER = 1.5;

/** Своё на моба: высота полёта (без скачков между режимами) и вираж. */
interface OwlS {
  mode: string;
  from: number;
  lift: number;
  now: number;
  ang: number;
  rate: number;
  bank: number;
}
const OS = new WeakMap<Mob, OwlS>();

function owlState(m: Mob, mode: string, now: number): OwlS {
  let s = OS.get(m);
  if (!s) {
    const from = mode === 'f12_perch' ? PERCH : mode === 'f12_dive' ? AIR + 3.2 : AIR;
    s = { mode, from, lift: from, now, ang: NaN, rate: 0, bank: 0 };
    OS.set(m, s);
  } else if (s.mode !== mode) {
    s.from = s.lift;
    s.mode = mode;
  }
  return s;
}

/** Вираж по скорости поворота курса (с гистерезисом). */
function bankOf(s: OwlS, m: Mob, now: number): number {
  const sp = speedOf(m);
  const dt = clamp(now - s.now, 0, 0.1);
  if (sp > 0.6) {
    const a = Math.atan2(m.vy, m.vx);
    if (!Number.isNaN(s.ang) && dt > 0) {
      const r = angD(a, s.ang) / dt;
      s.rate += (r - s.rate) * Math.min(1, dt / 0.2);
    }
    s.ang = a;
  } else {
    s.rate *= 1 - Math.min(1, dt / 0.2);
    s.ang = NaN;
  }
  s.now = now;
  if (s.bank === 0) {
    if (s.rate > 0.45) s.bank = 1;
    else if (s.rate < -0.45) s.bank = -1;
  } else if (s.rate * s.bank < 0.2) s.bank = 0;
  return s.bank;
}

const DIVE_GHOST = { every: 0.03, life: 0.16, tint: '#e8f4ff', alpha: 0.4 };

paintMob('f12_owl', (m, p) => {
  const mode = p.mode;
  const t = p.t || 0;
  const now = p.now || 0;
  const id = m.id ?? 0;
  const sp = speedOf(m);
  const air = mode === 'f12_hover' || mode === 'chase' || mode === 'f12_rise';
  const want = (mode === 'f12_dive' || air) && sp > 0.6 ? Math.atan2(m.vy, m.vx) : (m.face ?? 0);
  const v = visOf(m, p, want, mode === 'f12_dive' ? 40 : mode === 'f12_spot' ? 14 : 5);
  const s = owlState(m, mode, now);
  const ex: Partial<MobFrame> = { still: true };
  let anim = 'fly';
  let f = 0;
  let lift = AIR;
  if (mode === 'dying') {
    anim = 'die';
    f = fi(t, N.die - 1);
    lift = s.from * (1 - easeIn(clamp01(t / 0.42)));
    if (t >= 0.42 && t < 0.52) {
      const q = 1 - (t - 0.42) / 0.1;
      ex.sx = 1 + 0.14 * q;
      ex.sy = 1 - 0.12 * q;
    }
    ex.alpha = 1 - sstep(0.62, DIE, t);
    ex.linger = DIE;
  } else if (mode === 'f12_perch') {
    anim = 'perch';
    f = PERCH_SEQ[Math.floor(now * 6 + hash(id, 17) * PERCH_SEQ.length) % PERCH_SEQ.length];
    lift = PERCH;
    ex.alpha = 0.92;
  } else if (mode === 'f12_spot') {
    f = fi(t, N.spot - 1);
    anim = v.prev === 'f12_perch' && f < N.spotP ? 'spotP' : 'spot';
    const L0 = s.from;
    const top = Math.max(L0, AIR) + 3;
    lift = trk(t, [
      [0, L0],
      [0.4, top, easeOut],
      [0.58, top + 0.4],
      [0.7, top - 0.8, easeIn],
    ]);
    // Отпрянула на пике — и подалась вперёд к пике.
    const back = trk(t, [
      [0.3, 0],
      [0.5, -1],
      [0.7, 1, easeIn],
    ]);
    ex.dx = Math.cos(v.yaw) * back;
    ex.dy = Math.sin(v.yaw) * back * 0.6;
  } else if (mode === 'f12_dive') {
    anim = 'dive';
    const len = m.data?.len ?? 8;
    const run = t * 10.5;
    const tc = (len - OVER - REACH - run) / 10.5;
    if (tc > 0.25) f = t < 0.125 ? fi(t, 2) : 3 + (fi(t, 999) % 2);
    else if (tc > 0) f = 5 + Math.min(5, Math.floor((0.25 - tc) * 24));
    else f = 11 + Math.min(4, Math.floor(-tc * 24));
    const hitAt = Math.max(0.5, len - OVER - REACH);
    lift =
      run < hitAt
        ? lerp(s.from, 2, run / hitAt)
        : lerp(2, 0, clamp01((run - hitAt) / (OVER + REACH)));
    ex.ghost = DIVE_GHOST;
  } else if (mode === 'f12_ground') {
    anim = 'ground';
    f = t < 0.17 ? fi(t, 3) : t < 0.75 ? 4 + (fi(t - 0.17, 999) % 6) : 10 + fi(t - 0.75, 8);
    lift = 0;
    if (t < 0.1) {
      const q = 1 - t / 0.1;
      ex.sx = 1 + 0.16 * q;
      ex.sy = 1 - 0.14 * q;
    }
  } else if (mode === 'f12_rise') {
    anim = 'rise';
    f = fi(t, N.rise - 1);
    lift = trk(t, [
      [0, 0],
      [0.1, 0.5],
      [0.55, AIR, easeOut],
    ]);
  } else if (mode === 'stun') {
    anim = 'flinch';
    f = fi(t, N.flinch - 1);
    lift = s.lift;
  } else {
    const b = bankOf(s, m, now);
    anim = b > 0 ? 'flyP' : b < 0 ? 'flyN' : 'fly';
    f = Math.floor(now * 24 + hash(id, 7) * 12) % 12;
    lift = AIR + Math.sin(now * 1.7 + id) * 0.8;
  }
  s.lift = lift;
  ex.lift = lift;
  ex.shadow = mode === 'f12_perch' ? 2.5 : 6.5 - 3 * clamp01(lift / 18);
  const fr = frameOf(K, anim, f, dirOf(v.yaw), p, () => build(anim, f));
  if (mode !== 'dying') hurtFx(v, now, mode === 'f12_ground' ? 2 : 1.6, ex);
  return { ...fr, ...ex };
});

registerMobWarm('f12_owl', () => warmAll(K, Object.entries(N) as [string, number][], build));
