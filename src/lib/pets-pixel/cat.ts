// Кот Шрам — пиксельный питомец по эталону боссов 12–14.
//
// Большой полосатый кот сидит анфас: серо-бурая шерсть в тёмных полосах,
// «M» на лбу, полосатые щёки, лапы и хвост, светлая манишка; зелёные глаза
// со щелью зрачка под приспущенными веками (довольный, тёртый взгляд),
// зашитый шрам через глаз (справа в кадре, как у туши), надорванное ухо
// (слева в кадре), на шее — полосатый арестантский платок с узлом, на
// передней лапе (слева в кадре) — бинт. Хвост поднят у правого бока крючком.
//
// Две полосы, у каждой свой рисунок: малая — рамка 48 (шахта, списки),
// крупная — рамка 112 (карточка, вылупление, Питомник): «M» буквой, полосы
// тоньше и чаще, пух в ушах, стежки шрама, усы, витки бинта.
//
// Анимации 24 к/с по ключам (`kf`), хвост, голова и хвостики платка — с
// запаздыванием (`spring`). Трюк: подбросил рыбку с лап — она кувыркается и
// в воздухе вспышкой становится золотой монетой, кот ловит её, и веки
// довольно опускаются.
//
// Золотой рисуется здесь же (`v` = 1) своими палитрами: мех — золото,
// полосы — жёлтая бронза, манишка — бледное золото; глаза, шрам и платок
// читаются.

import type { Px } from '../dungeon-art';
import {
  add,
  axes,
  bump,
  clamp01,
  cross,
  dith,
  dot,
  hx,
  kf,
  lerp,
  lerp3,
  LIGHT,
  mixc,
  mul,
  newFrame,
  norm,
  pitchX,
  project,
  ramp,
  rimLight,
  rollY,
  seams,
  seen,
  selOutline,
  spring,
  stamp,
  sub,
  toPx,
  VIEW,
  wrap,
} from './rig';
import type { Frame, Key, Part, RGBA, V3 } from './rig';

// ---------------------------------------------------------------------------
// Палитры (тон — номер ступени; свет, шов и кант сдвигают ступень).
// ---------------------------------------------------------------------------

const P_FUR = 0;
const P_PALE = 1;
const P_STRIPE = 2;
const P_CLOTH = 3;
const P_CBLK = 4;
const P_GOLD = 5;
const P_NOSE = 6;
const P_MOUTH = 7;
const P_BONE = 8;
const P_SKIN = 9;
const P_BAND = 10;
const P_FISH = 11;

const MOUTH = ramp(
  '#16050a',
  '#300a10',
  '#4e1218',
  '#701e22',
  '#94342f',
  '#b8504a',
  '#d8746a',
  '#eb978c',
);
const BONE = ramp('#5e564a', '#8c8474', '#b8b0a0', '#dcd6c8', '#f2eee4', '#fffdf6');
const GOLD = ramp(
  '#3a2006',
  '#5e380c',
  '#865616',
  '#ae7a22',
  '#d29e34',
  '#ecc252',
  '#fadf86',
  '#fff4c6',
);
const BAND = ramp(
  '#59533f',
  '#7b7460',
  '#9d957f',
  '#bcb49d',
  '#d4cdb7',
  '#e7e1cf',
  '#f3eee1',
  '#fbf8f0',
);
const FISH = ramp(
  '#162229',
  '#22343e',
  '#304854',
  '#405d6a',
  '#527381',
  '#668a98',
  '#7ea2ae',
  '#9bbac4',
  '#bed4da',
  '#e0eef0',
);

const PAL_V: RGBA[][][] = [
  [
    // Мех: серо-бурый табби — от тёмной тени к светлому пепельному на свету.
    ramp(
      '#14100c',
      '#201a14',
      '#2c241b',
      '#3a3024',
      '#483c2e',
      '#574a39',
      '#665845',
      '#756651',
      '#85755e',
      '#95856c',
      '#a7977e',
      '#baab93',
    ),
    // Светлое: манишка, морда, подбородок.
    ramp(
      '#423a30',
      '#5e5446',
      '#7c715f',
      '#9a8f7b',
      '#b6ab95',
      '#cdc3ad',
      '#ded6c3',
      '#ebe5d6',
      '#f6f2e8',
    ),
    // Полосы табби: тёмно-бурые.
    ramp('#0f0b08', '#18120d', '#221a13', '#2d2319', '#392d20', '#463828', '#544331', '#634f3a'),
    // Платок: белые полосы…
    ramp(
      '#3a3836',
      '#585653',
      '#787571',
      '#9a9792',
      '#bab7b0',
      '#d6d3cb',
      '#eae8e1',
      '#f7f6f0',
      '#ffffff',
    ),
    // …и чёрные.
    ramp('#090808', '#100f0e', '#181615', '#211f1d', '#2b2826', '#363230', '#423d3a'),
    GOLD,
    // Нос.
    ramp('#5a2826', '#7c3a36', '#9e4f49', '#c0665e', '#d98079', '#e99d95', '#f4bbb3'),
    MOUTH,
    BONE,
    // Кожа в ушах.
    ramp('#4a2a28', '#6c3c39', '#90524c', '#b26a62', '#cc847a', '#e2a298', '#f0bdb3'),
    BAND,
    FISH,
  ],
  [
    // Золотой: бронза в тени → золото → бледное золото на свету.
    ramp(
      '#1a0e04',
      '#2c1806',
      '#40240a',
      '#56320e',
      '#6e4414',
      '#88581a',
      '#a46e22',
      '#c08a30',
      '#d8a844',
      '#ecc662',
      '#fadf8c',
      '#fff2c0',
    ),
    ramp(
      '#4a3410',
      '#6a4c1a',
      '#8c6a28',
      '#ae8a3a',
      '#cca850',
      '#e2c46c',
      '#f0da90',
      '#f8eab6',
      '#fff6dc',
    ),
    // Полосы — жёлтая бронза (красно-бурая читалась шоколадом).
    ramp('#1c1104', '#2a1a06', '#3b250a', '#4d310d', '#603f12', '#734e18', '#875e1e', '#9b7026'),
    ramp(
      '#3e3628',
      '#5c5240',
      '#7c715a',
      '#9e9278',
      '#beb296',
      '#d9ceb2',
      '#ece3cc',
      '#f8f2e2',
      '#fffbf0',
    ),
    ramp('#0e0904', '#160f07', '#20160a', '#2a1e0e', '#352613', '#412f18', '#4e391e'),
    GOLD,
    ramp('#5a2e1c', '#7c4026', '#9e5632', '#c06e40', '#d88a52', '#eaa86a', '#f6c688'),
    MOUTH,
    BONE,
    ramp('#4a2c14', '#6c4020', '#90582c', '#b2723a', '#cc8e4c', '#e2ac64', '#f0c680'),
    BAND,
    FISH,
  ],
];
const INK_V: RGBA[] = [hx('#0e0a07'), hx('#1a0d02')];
const SCAR: RGBA[][] = [
  [hx('#f0b8aa'), hx('#c27a6e'), hx('#4a1e1a')],
  [hx('#ffd0b8'), hx('#d08a62'), hx('#4a2410')],
];

// ---------------------------------------------------------------------------
// Кадр: холст и рамка тела у двух полос (как у лиса).
// ---------------------------------------------------------------------------

export type Res = 's' | 'l';
export interface Canvas {
  box: number;
  cw: number;
  ch: number;
  bx: number;
  by: number;
}
export const RES: Record<Res, Canvas> = {
  s: { box: 48, cw: 128, ch: 104, bx: 40, by: 34 },
  l: { box: 112, cw: 300, ch: 244, bx: 94, by: 80 },
};
const GROUND = 44;
let RR = 1;
let HI = false;
let OX = 0;
let OY = 0;
let V = 0;
let PAL: RGBA[][] = PAL_V[0];

export type Anim = 'idle' | 'walk' | 'happy' | 'work' | 'attack' | 'sleep';
export const FPS = 24;
export const FRAMES: Record<Anim, number> = {
  idle: 72,
  walk: 24,
  happy: 26,
  work: 48,
  attack: 22,
  sleep: 72,
};
const LOOP: Record<Anim, boolean> = {
  idle: true,
  walk: true,
  sleep: true,
  happy: false,
  work: false,
  attack: false,
};
const dur = (a: Anim) => FRAMES[a] / FPS;

// ---------------------------------------------------------------------------
// Поза.
// ---------------------------------------------------------------------------

type Eye = 'open' | 'wide' | 'smug' | 'happy' | 'angry' | 'sleep' | 'shut';

export interface Pose {
  x: number;
  y: number;
  z: number;
  sq: number;
  lean: number;
  bow: number;
  hx: number;
  hy: number;
  hz: number;
  turn: number;
  nod: number;
  tilt: number;
  /** Зад виляет перед прыжком (сдвиг бёдер и хвоста вбок). */
  rump: number;
  /** Пасть: 0 — закрыта, 1 — настежь; оскал; ухмылка (уголки вверх); язык. */
  jaw: number;
  snarl: number;
  grin: number;
  tongue: number;
  /** Уши: 0 — торчком, 1 — прижаты в стороны, < 0 — насторожены вперёд; дёрнуть ухом. */
  earL: number;
  earR: number;
  flL: number;
  flR: number;
  /** Усы: дрогнули (+ вверх). */
  whisk: number;
  /** Хвост: вбок, трубой вверх, крючок кончика сильнее, щелчок кончиком. */
  tailSw: number;
  tailUp: number;
  tailCurl: number;
  tailFl: number;
  /** Передние лапы: вбок, вперёд, вверх; задние — вверх. */
  fLx: number;
  fRx: number;
  fLy: number;
  fRy: number;
  fLz: number;
  fRz: number;
  hLz: number;
  hRz: number;
  eye: Eye;
  blink: number;
  /** Медленное моргание: 0 — веки как всегда (приспущены), 1 — сомкнуты. */
  lid: number;
  /** Куда смотрят зрачки: −1 влево, +1 вправо. */
  look: number;
  /** Вдох: грудь раздувается. */
  chest: number;
  /** Трюк: рыбка и монета (проявление), где летят, кувырок, вспышка, блик. */
  fish: number;
  coin: number;
  ix: number;
  iy: number;
  iz: number;
  spin: number;
  flash: number;
  glint: number;
  /** Атака: когти наружу (0…1), след удара (−1 — нет, иначе ход 0…1). */
  claw: number;
  swipe: number;
  /** Стоит (ходьба) и свернулся (сон): 0 — сидит. */
  stand: number;
  curl: number;
  scale: number;
}

/** Где лапы держат рыбку у груди (пиксели малой полосы, до масштаба). */
const HOLD: V3 = [0, 9.8, 13.0];
/** Верх полёта рыбки — над ушами. */
const APEX = 40;

const REST: Pose = {
  x: 0,
  y: 0,
  z: 0,
  sq: 0,
  lean: 0,
  bow: 0,
  hx: 0,
  hy: 0,
  hz: 0,
  turn: 0,
  nod: 0,
  tilt: 0,
  rump: 0,
  jaw: 0,
  snarl: 0,
  grin: 0.3,
  tongue: 0,
  earL: 0,
  earR: 0,
  flL: 0,
  flR: 0,
  whisk: 0,
  tailSw: 0,
  tailUp: 0,
  tailCurl: 0,
  tailFl: 0,
  fLx: 0,
  fRx: 0,
  fLy: 0,
  fRy: 0,
  fLz: 0,
  fRz: 0,
  hLz: 0,
  hRz: 0,
  eye: 'open',
  blink: 0,
  lid: 0,
  look: 0,
  chest: 0,
  fish: 0,
  coin: 0,
  ix: HOLD[0],
  iy: HOLD[1],
  iz: HOLD[2],
  spin: 0,
  flash: 0,
  glint: 0,
  claw: 0,
  swipe: -1,
  stand: 0,
  curl: 0,
  scale: 1,
};

const loopK = (t: number, T: number, keys: Key[]) => kf(wrap(t, T), keys);
const pos = (v: number) => Math.max(0, v);
const neg = (v: number) => Math.max(0, -v);
const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Дорожки анимаций.
// ---------------------------------------------------------------------------

function idlePose(t: number): Pose {
  const T = dur('idle');
  const o: Pose = { ...REST };
  // Два вдоха на петлю, второй мельче.
  const br = loopK(t, T, [
    [0, 0],
    [0.15, 0],
    [0.8, 1, 'o'],
    [1.05, 0.95],
    [1.5, 0.05],
    [1.6, 0],
    [2.25, 0.8, 'o'],
    [2.5, 0.75],
    [2.95, 0],
    [3, 0],
  ]);
  o.chest = br;
  o.sq = -0.016 * br;
  o.hz = 0.25 * br;
  // Медленное кошачье моргание: веки сползают, держатся, поднимаются; голова набок.
  o.lid = loopK(t, T, [
    [0, 0],
    [1.2, 0],
    [1.55, 1, 's'],
    [1.85, 1],
    [2.2, 0, 's'],
    [3, 0],
  ]);
  o.tilt =
    0.1 *
    loopK(t, T, [
      [0, 0],
      [1.1, 0],
      [1.55, 1, 's'],
      [1.95, 1],
      [2.4, 0, 's'],
      [3, 0],
    ]);
  o.blink = bump(t, 0.3, 0.46);
  // Глянул вбок: сперва глаза, потом голова — и обратно.
  o.look = loopK(t, T, [
    [0, 0],
    [0.55, 0],
    [0.64, 1, 'o'],
    [0.98, 1],
    [1.08, 0, 's'],
    [3, 0],
  ]);
  o.turn =
    0.1 *
    loopK(t, T, [
      [0, 0],
      [0.6, 0],
      [0.82, 1, 'o'],
      [1.0, 1],
      [1.22, 0, 's'],
      [3, 0],
    ]);
  o.lean = 0.014 * Math.sin((t / T) * TAU);
  o.x = 0.15 * Math.sin((t / T) * TAU);
  // Уши дёргаются, усы шевелятся — каждый в свою фазу.
  o.flL = bump(t, 0.38, 0.5);
  o.flR = bump(t, 2.35, 2.47) + 0.6 * bump(t, 2.49, 2.59);
  o.whisk = bump(t, 0.9, 1.05) - 0.7 * bump(t, 2.62, 2.76);
  // Хвост качается, кончик щёлкает (дальше его ведёт пружина).
  o.tailSw = 0.12 * Math.sin((t / T) * TAU);
  o.tailFl = bump(t, 0.2, 0.34) - 0.8 * bump(t, 1.62, 1.76) + 0.5 * bump(t, 2.74, 2.86);
  return o;
}

function walkPose(t: number): Pose {
  const T = dur('walk');
  const o: Pose = { ...REST };
  const h = wrap(t, T) / T;
  o.stand = 1;
  // Кошачий шаг: лапы по очереди (левая задняя, левая передняя, правая задняя, правая передняя).
  const step = (ph: number) => bump(wrap(h - ph, 1), 0, 0.42) ** 0.8;
  const lh = step(0);
  const lf = step(0.25);
  const rh = step(0.5);
  const rf = step(0.75);
  o.fLz = 2.0 * lf;
  o.fLy = 1.0 * lf;
  o.fRz = 2.0 * rf;
  o.fRy = 1.0 * rf;
  o.hLz = 1.5 * lh;
  o.hRz = 1.5 * rh;
  const sw = Math.sin(h * TAU);
  // Плечи перекатываются, голова низко и ровно — крадётся.
  o.x = 0.35 * sw;
  o.lean = 0.045 * sw;
  o.z = 0.25 * Math.abs(Math.sin(h * TAU * 2));
  o.nod = 0.1 + 0.03 * Math.cos(h * 2 * TAU);
  o.tilt = -0.05 * sw;
  o.hx = -0.25 * sw;
  o.earL = -0.1;
  o.earR = -0.1;
  // Хвост трубой с крючком: качается против плеч, кончик ходит.
  o.tailSw = -0.3 * sw;
  o.tailFl = 0.45 * Math.sin(h * TAU - 1.3);
  o.whisk = 0.2 * Math.cos(h * TAU);
  return o;
}

function happyPose(t: number): Pose {
  const T = dur('happy');
  const o: Pose = { ...REST };
  // Подскок с лапками к груди → месит лапками и мурлычет (мелкая дрожь), хвост трубой.
  const rise = kf(t, [
    [0, 0],
    [0.08, -0.35, 'o'],
    [0.26, 1, 'o'],
    [0.36, 0.9],
    [0.48, -0.25, 'i'],
    [0.58, 0, 'o'],
    [T, 0],
  ]);
  const up = pos(rise);
  const env = 1 - clamp01((t - 0.9) / (T - 0.9));
  o.z = 2.2 * up;
  o.sq = -0.07 * rise;
  o.bow = -0.08 * up;
  o.nod = -0.12 * up;
  o.fLz = 3.2 * up;
  o.fRz = 3.2 * up;
  o.fLy = -0.6 * up;
  o.fRy = -0.6 * up;
  o.fLx = 0.5 * up;
  o.fRx = -0.5 * up;
  // Месит: лапки по очереди давят и поднимаются.
  const kn = bump(t, 0.46, 1.02);
  const ph = Math.sin(((t - 0.46) / 0.27) * TAU);
  o.fLz += 1.5 * pos(ph) * kn;
  o.fLy += 0.5 * pos(ph) * kn;
  o.fRz += 1.5 * neg(ph) * kn;
  o.fRy += 0.5 * neg(ph) * kn;
  // Мурлычет: мелкая дрожь головы и груди.
  const purr = Math.sin(t * TAU * 6) * kn;
  o.hx = 0.3 * purr;
  o.chest = 0.5 * kn;
  o.lean = 0.02 * purr;
  o.eye = t < 0.98 ? 'happy' : 'open';
  o.grin = lerp(REST.grin, 1, env);
  o.jaw = 0.22 * bump(t, 0.1, 0.46);
  o.tilt = 0.12 * Math.sin((t / T) * TAU) * env;
  o.earL = -0.25 * env;
  o.earR = -0.25 * env;
  o.tailUp = env;
  o.tailFl = 0.5 * Math.sin(t * TAU * 3.6) * env;
  o.whisk = 0.6 * bump(t, 0.1, 0.5);
  return o;
}

/**
 * Рыбка в монету (2 с): лапы к груди, на них рыбка → присел и подбросил →
 * рыбка кувыркается вверх, кот следит → над ушами вспышка — монета →
 * падает, вертясь, кот ловит её лапами → веки довольно опускаются, ухмылка,
 * блик на монете → монета тает, лапы на место.
 */
const T_LAUNCH = 0.46;
const T_APEX = 0.8;
const T_CATCH = 1.14;

function workPose(t: number): Pose {
  const o: Pose = { ...REST };
  const reach = kf(t, [
    [0, 0],
    [0.16, 1, 'o'],
    [1.74, 1],
    [1.96, 0, 's'],
  ]);
  // Присел перед броском (−), толкнул вверх (+), хлопок при ловле.
  const dip = kf(t, [
    [0, 0],
    [0.2, 0],
    [0.36, -1, 's'],
    [0.42, -1],
    [0.48, 1, 'o'],
    [0.62, 0, 's'],
    [T_CATCH - 0.04, 0],
    [T_CATCH + 0.06, -0.8, 'o'],
    [T_CATCH + 0.22, 0, 's'],
  ]);
  const holdZ = HOLD[2] + 1.3 * dip;
  // Лапы разведены, пока рыбка в воздухе, — сводятся при ловле.
  const open = kf(t, [
    [0, 0],
    [T_LAUNCH, 0],
    [T_LAUNCH + 0.12, 1, 'o'],
    [T_CATCH - 0.06, 1],
    [T_CATCH + 0.04, 0, 'i'],
  ]);
  for (const side of [-1, 1] as const) {
    const tx = side * (1.7 + 1.3 * open);
    const ty = HOLD[1] - 0.8;
    const tz = holdZ - 0.6 - 1.4 * open;
    const dx = (tx - side * PAW0[0]) * G * reach;
    const dy = (ty - PAW0[1]) * G * reach;
    const dz = (tz - PAW0[2]) * G * reach;
    if (side < 0) {
      o.fLx = dx;
      o.fLy = dy;
      o.fLz = dz;
    } else {
      o.fRx = dx;
      o.fRy = dy;
      o.fRz = dz;
    }
  }
  // Предмет: на лапах → полёт по параболе → в лапах.
  const z0 = HOLD[2] + 1.3 + 0.9;
  const zc = HOLD[2] - 1.04 + 0.7;
  if (t < T_LAUNCH) o.iz = holdZ + 0.9;
  else if (t < T_APEX) o.iz = APEX - (APEX - z0) * ((T_APEX - t) / (T_APEX - T_LAUNCH)) ** 2;
  else if (t < T_CATCH) o.iz = APEX - (APEX - zc) * ((t - T_APEX) / (T_CATCH - T_APEX)) ** 2;
  else o.iz = holdZ + 0.7;
  const fl = clamp01((t - T_LAUNCH) / (T_CATCH - T_LAUNCH));
  o.ix = 2.0 * Math.sin(Math.PI * fl);
  o.iy = HOLD[1] - 0.6 * Math.sin(Math.PI * fl);
  // Рыбка: два кувырка вверх; монета вертится на ребре и встаёт лицом к зрителю.
  if (t < T_APEX) o.spin = TAU * 2 * clamp01((t - T_LAUNCH) / (T_APEX - T_LAUNCH)) ** 0.8;
  else o.spin = TAU * 3 * (1 - (1 - clamp01((t - T_APEX) / (T_CATCH - T_APEX + 0.06))) ** 2);
  o.fish = t < T_APEX + 0.02 ? kf(t, [[0, 0], [0.14, 1, 'l']]) : 0;
  o.coin = t >= T_APEX + 0.02 ? kf(t, [[1.7, 1], [1.92, 0, 'l']]) : 0;
  o.flash = bump(t, 0.74, 0.98);
  o.glint = bump(t, 1.36, 1.6);
  // Тело: присел — бросок с подъёмом груди — хлопок.
  o.sq = 0.05 * neg(dip) - 0.03 * pos(dip);
  o.z = -0.3 * neg(dip);
  o.chest = 0.6 * bump(t, 0.4, 0.7) + 0.5 * bump(t, 1.3, 1.7);
  // Голова: на рыбку у лап → следит за полётом вверх и вниз → довольно набок.
  o.nod = kf(t, [
    [0, 0],
    [0.16, 0.24, 'o'],
    [0.42, 0.28],
    [0.54, 0, 'o'],
    [T_APEX, -0.42, 'o'],
    [0.92, -0.4],
    [T_CATCH, 0.18, 'i'],
    [T_CATCH + 0.12, 0.2],
    [1.42, 0, 's'],
  ]);
  o.hz = -0.25 * pos(o.nod) + 0.6 * neg(o.nod);
  o.hy = 0.3 * pos(o.nod) - 0.3 * neg(o.nod);
  o.tilt =
    0.14 *
    kf(t, [
      [0, 0],
      [1.24, 0],
      [1.42, 1, 'o'],
      [1.78, 1],
      [1.98, 0, 's'],
    ]);
  o.turn = 0.08 * Math.sin(Math.PI * fl);
  o.eye = t > T_LAUNCH - 0.06 && t < T_CATCH + 0.06 ? 'wide' : 'open';
  // Поймал — веки опускаются, ухмылка.
  o.lid = kf(t, [
    [0, 0],
    [T_CATCH + 0.1, 0],
    [1.36, 0.6, 'o'],
    [1.76, 0.6],
    [1.94, 0, 's'],
  ]);
  o.grin =
    REST.grin +
    (1 - REST.grin) *
      kf(t, [
        [0, 0],
        [T_CATCH + 0.08, 0],
        [1.34, 1, 'o'],
        [1.78, 1],
        [1.96, 0, 's'],
      ]);
  o.jaw = 0.25 * bump(t, 0.76, 0.98);
  o.earL = -0.3 * bump(t, 0.44, 1.2) + 0.25 * bump(t, 1.3, 1.9);
  o.earR = o.earL;
  o.flR = bump(t, 0.8, 0.9);
  o.whisk = 0.8 * bump(t, 0.74, 0.98) + 0.5 * bump(t, 1.3, 1.5);
  o.tailFl = 0.9 * bump(t, 0.76, 0.92) - 0.4 * bump(t, 1.5, 1.7);
  o.tailCurl = 0.7 * bump(t, 1.2, 1.98);
  // Монета растаяла — реквизит на места покоя.
  if (o.coin < 0.01 && t > T_APEX) {
    o.ix = REST.ix;
    o.iy = REST.iy;
    o.iz = REST.iz;
    o.spin = 0;
  }
  return o;
}

function attackPose(t: number): Pose {
  const T = dur('attack');
  const o: Pose = { ...REST };
  // Присел, зад виляет → прыжок к зрителю, правая лапа взмахом сверху вниз-накрест,
  // когти наружу, пасть настежь с клыками (кадры 8–11) → приземлился → покой.
  const l = kf(t, [
    [0, 0],
    [0.2, -1, 'o'],
    [0.27, -1.05],
    [0.36, 1, 'i'],
    [0.48, 0.95],
    [0.62, 0.3, 's'],
    [T, 0, 's'],
  ]);
  const air = kf(t, [
    [0, 0],
    [0.27, 0],
    [0.38, 1, 'o'],
    [0.47, 0.9],
    [0.57, 0, 'i'],
    [T, 0],
  ]);
  o.y = 3.4 * pos(l) - 0.8 * neg(l);
  o.scale = 1 + 0.18 * pos(l);
  o.sq = 0.12 * neg(l) - 0.05 * air + 0.08 * bump(t, 0.55, 0.7);
  o.z = -0.6 * neg(l) + 1.8 * air;
  o.bow = 0.12 * neg(l) + 0.04 * pos(l);
  o.nod = 0.18 * neg(l) - 0.3 * pos(l);
  o.hy = 1.4 * pos(l) - 0.4 * neg(l);
  o.hz = 0.3 * pos(l) - 0.9 * neg(l);
  o.rump = 0.9 * Math.sin(t * TAU * 7.5) * bump(t, 0.04, 0.27);
  o.jaw = kf(t, [
    [0, 0],
    [0.24, 0.1],
    [0.3, 0.14],
    [0.36, 1, 'o'],
    [0.47, 1],
    [0.52, 0.1, 'i'],
    [0.6, 0.18],
    [0.72, 0, 's'],
  ]);
  o.snarl = kf(t, [
    [0, 0],
    [0.16, 1, 'o'],
    [0.54, 1],
    [0.8, 0, 's'],
  ]);
  o.grin = REST.grin * (1 - bump(t, 0, T));
  // Уши прижаты в стороны в засаде и в броске.
  const ears = kf(t, [
    [0, 0],
    [0.14, 0.6, 'o'],
    [0.56, 0.65],
    [0.86, 0, 's'],
  ]);
  o.earL = ears;
  o.earR = ears;
  o.eye = t < 0.7 ? 'angry' : 'open';
  // Взмах правой (справа в кадре): вверх-наружу → вниз-накрест.
  const sw = kf(t, [
    [0, 0],
    [0.22, 0],
    [0.32, 1, 'o'],
    [0.36, 1],
    [0.46, -1, 'i'],
    [0.56, -0.8],
    [0.82, 0, 's'],
  ]);
  o.fRz = 2.6 * air + 5.0 * pos(sw) + 1.6 * neg(sw);
  o.fRx = 1.6 * pos(sw) - 3.6 * neg(sw);
  o.fRy = 1.6 * air + 1.6 * neg(sw) + 0.8 * pos(sw);
  o.fLz = 2.6 * air + 0.6 * bump(t, 0.1, 0.28);
  o.fLy = 2.4 * air;
  o.fLx = -0.5 * air;
  o.claw = kf(t, [
    [0, 0],
    [0.24, 0],
    [0.3, 1, 'o'],
    [0.58, 1],
    [0.7, 0, 's'],
  ]);
  o.swipe = t >= 0.37 && t < 0.62 ? (t - 0.37) / 0.25 : -1;
  o.tailSw = 0.4 * Math.sin(t * TAU * 7.5) * bump(t, 0.04, 0.27) + 0.3 * bump(t, 0.4, 0.86);
  o.tailUp = 0.6 * bump(t, 0.1, 0.8);
  o.tailFl = 0.7 * bump(t, 0.3, 0.6);
  o.whisk = -0.6 * bump(t, 0.1, 0.7);
  return o;
}

function sleepPose(t: number): Pose {
  const T = dur('sleep');
  const o: Pose = { ...REST };
  o.curl = 1;
  o.eye = 'sleep';
  const br = loopK(t, T, [
    [0, 0],
    [1.3, 1, 's'],
    [1.55, 1],
    [2.9, 0, 's'],
    [3, 0],
  ]);
  o.chest = br;
  o.nod = 0.3 + 0.03 * br;
  o.tilt = 0.2;
  o.hz = 0.3 * br;
  o.sq = -0.06 * br;
  o.tailSw = 0.06 * br;
  o.earL = 0.45;
  o.earR = 0.45;
  o.grin = 0.5;
  // Во сне дёрнул ухом, кончиком хвоста и усами.
  o.flL = 0.6 * bump(t, 2.1, 2.24);
  o.tailFl = 0.5 * bump(t, 0.9, 1.1);
  o.whisk = 0.5 * bump(t, 1.7, 1.85);
  return o;
}

export function poseAt(a: Anim, t: number): Pose {
  switch (a) {
    case 'idle':
      return idlePose(t);
    case 'walk':
      return walkPose(t);
    case 'happy':
      return happyPose(t);
    case 'work':
      return workPose(t);
    case 'attack':
      return attackPose(t);
    case 'sleep':
      return sleepPose(t);
  }
}

// ---------------------------------------------------------------------------
// Скелет (в пикселях малой полосы): три плана — сидит, стоит, свернулся.
// ---------------------------------------------------------------------------

interface Plan {
  body: V3;
  bodyR: V3;
  neck: V3;
  neckR: V3;
  head: V3;
  sh: V3;
  paw: V3;
  haunch: V3;
  haunchR: V3;
  hpaw: V3;
  tail: V3[];
}
/** Лапа сидящего кота в покое. */
const PAW0: V3 = [3.0, 7.8, 1.3];
const SIT: Plan = {
  body: [0, -0.8, 10.2],
  bodyR: [7.2, 5.8, 9.4],
  neck: [0, 0.4, 19.0],
  neckR: [4.6, 4.0, 4.0],
  head: [0, 2.0, 25.2],
  sh: [3.9, 2.8, 14.2],
  paw: PAW0,
  haunch: [6.0, -1.6, 4.8],
  haunchR: [4.2, 5.6, 4.8],
  hpaw: [7.4, 4.0, 0.9],
  // Хвост из-за правого бедра вбок и вверх вдоль тела, кончик крючком внутрь.
  tail: [
    [5.6, -4.0, 2.2],
    [9.0, -2.6, 2.4],
    [11.4, -1.2, 4.4],
    [12.2, -0.6, 8.0],
    [12.0, -0.6, 11.8],
    [10.9, -0.8, 15.0],
    [9.2, -1.0, 17.0],
    [7.8, -0.8, 17.4],
  ],
};
const STAND: Plan = {
  body: [0, -5.6, 13.0],
  bodyR: [5.4, 10.0, 5.6],
  neck: [0, 2.0, 17.6],
  neckR: [4.2, 3.8, 4.2],
  head: [0, 4.6, 23.0],
  sh: [3.4, 3.0, 12.6],
  paw: [3.4, 4.4, 1.0],
  haunch: [4.4, -13.0, 12.0],
  haunchR: [3.4, 4.6, 4.8],
  hpaw: [3.8, -12.0, 1.0],
  // Хвост трубой над спиной, кончик крючком вправо.
  tail: [
    [0.6, -15.0, 15.0],
    [1.2, -15.6, 18.0],
    [2.0, -15.6, 21.0],
    [3.0, -15.0, 24.0],
    [4.2, -14.2, 26.4],
    [5.4, -13.4, 27.6],
    [6.4, -12.8, 27.4],
    [7.0, -12.6, 26.2],
  ],
};
const CURL: Plan = {
  body: [0, -2.0, 5.2],
  bodyR: [9.4, 7.4, 5.2],
  neck: [0, 2.6, 7.8],
  neckR: [4.8, 4.0, 3.8],
  head: [0.4, 6.0, 9.0],
  sh: [3.0, 6.0, 4.0],
  paw: [2.8, 10.2, 1.0],
  haunch: [7.4, -3.0, 4.4],
  haunchR: [4.4, 5.8, 4.2],
  hpaw: [9.6, 4.4, 1.0],
  // Хвост вокруг, кончиком на нос.
  tail: [
    [6.6, -5.0, 2.4],
    [11.0, 0.2, 2.5],
    [10.6, 7.4, 2.8],
    [6.8, 12.6, 4.0],
    [1.6, 14.4, 5.4],
    [-3.2, 14.0, 6.2],
    [-6.4, 12.0, 6.2],
    [-7.4, 9.4, 5.8],
  ],
};

function planOf(o: Pose): Plan {
  const m = (k: keyof Plan): V3 =>
    lerp3(lerp3(SIT[k] as V3, STAND[k] as V3, o.stand), CURL[k] as V3, o.curl);
  return {
    body: m('body'),
    bodyR: m('bodyR'),
    neck: m('neck'),
    neckR: m('neckR'),
    head: m('head'),
    sh: m('sh'),
    paw: m('paw'),
    haunch: m('haunch'),
    haunchR: m('haunchR'),
    hpaw: m('hpaw'),
    tail: SIT.tail.map((p, i) => lerp3(lerp3(p, STAND.tail[i], o.stand), CURL.tail[i], o.curl)),
  };
}

interface Skel {
  up: (p: V3) => V3;
  pl: Plan;
  head: V3;
  shL: V3;
  shR: V3;
  elL: V3;
  elR: V3;
  pawL: V3;
  pawR: V3;
  hpL: V3;
  hpR: V3;
  /** Оси и радиусы туловища (манишка, платок). */
  bc: V3;
  bax: [V3, V3, V3];
  br: V3;
  k: number;
}

/** Масштаб модели в рамке: лапы — кончики ушей ~44 пикселя малой полосы. */
const G = 1.12;

/** Локоть по двум костям: от плеча к лапе, сгиб к `pole`. */
function elbowOf(sh: V3, paw: V3, L: number, pole: V3): V3 {
  const d = sub(paw, sh);
  const D = Math.min(Math.hypot(d[0], d[1], d[2]), 2 * L - 1e-3);
  const e = norm(d);
  const p = norm(sub(pole, mul(e, dot(pole, e))));
  const a = D / 2;
  const hgt = Math.sqrt(Math.max(0, L * L - a * a));
  return add(sh, add(mul(e, a), mul(p, hgt)));
}

function skel(o: Pose): Skel {
  const s = o.scale * G;
  const sq = o.sq;
  const pl = planOf(o);
  const up = (p: V3): V3 => {
    let q: V3 = [p[0] * (1 + sq * 0.5), p[1] * (1 + sq * 0.4), p[2] * (1 - sq)];
    q = pitchX(q, o.bow, [0, 0, 4]);
    q = rollY(q, o.lean, [0, 0, 0]);
    q = mul(q, s);
    return add(q, [o.x, o.y, o.z]);
  };
  // Лапа на полу не едет за телом: x и y — свои, подъём — только у поднятой.
  const lift = Math.max(0, o.z);
  const paw = (side: number, dx: number, dy: number, dz: number): V3 => [
    side * pl.paw[0] * s + o.x * 0.2 + dx,
    pl.paw[1] * s + dy + o.y * 0.6,
    pl.paw[2] * s + dz + lift,
  ];
  const hp = (side: number, dz: number): V3 => [
    side * pl.hpaw[0] * s + o.rump * 0.4,
    pl.hpaw[1] * s + o.y * 0.3,
    pl.hpaw[2] * s + dz + lift * 0.3,
  ];
  const ch = o.chest;
  const shL = up([-pl.sh[0], pl.sh[1], pl.sh[2]]);
  const shR = up([pl.sh[0], pl.sh[1], pl.sh[2]]);
  const pawL = paw(-1, o.fLx, o.fLy, o.fLz);
  const pawR = paw(1, o.fRx, o.fRy, o.fRz);
  // Кость — половина прямой лапы плана с запасом: в покое локоть чуть назад.
  const L = Math.hypot(pl.sh[0] - pl.paw[0], pl.sh[1] - pl.paw[1], pl.sh[2] - pl.paw[2]) * 0.52 * s;
  return {
    up,
    pl,
    head: up(add(pl.head, [o.hx, o.hy, o.hz])),
    shL,
    shR,
    elL: elbowOf(shL, pawL, L, [-0.15, -1, -0.2]),
    elR: elbowOf(shR, pawR, L, [0.15, -1, -0.2]),
    pawL,
    pawR,
    hpL: hp(-1, o.hLz),
    hpR: hp(1, o.hRz),
    bc: up(pl.body),
    bax: axes(rollY([1, 0, 0], o.lean), pitchX([0, 0, 1], o.bow * 0.5)),
    br: mul([pl.bodyR[0] * (1 + 0.03 * ch), pl.bodyR[1] * (1 + 0.04 * ch), pl.bodyR[2]], s),
    k: s,
  };
}

/** Точка на поверхности туловища спереди: qx вправо, qz вверх (доли радиусов). */
function torsoAt(S: Skel, qx: number, qz: number, out = 1): V3 {
  const qy = Math.sqrt(Math.max(0, 1 - qx * qx - qz * qz));
  const [e1, e2, e3] = S.bax;
  return add(
    S.bc,
    add(mul(e1, S.br[0] * qx * out), add(mul(e2, S.br[1] * qy * out), mul(e3, S.br[2] * qz * out))),
  );
}

interface HeadF {
  at: (p: V3) => V3;
  dir: (v: V3) => V3;
  k: number;
}
const yawZ0 = (p: V3, a: number): V3 => [
  p[0] * Math.cos(a) + p[1] * Math.sin(a),
  -p[0] * Math.sin(a) + p[1] * Math.cos(a),
  p[2],
];
/** Поворот в плоскости кадра (x — вправо, z — вверх), против часовой стрелки. */
const rotXZ = (p: V3, a: number): V3 => [
  p[0] * Math.cos(a) - p[2] * Math.sin(a),
  p[1],
  p[0] * Math.sin(a) + p[2] * Math.cos(a),
];

// ---------------------------------------------------------------------------
// Узоры табби: палитра по точке части (локальные координаты — полосы не «кипят»).
// ---------------------------------------------------------------------------

interface Lag {
  headX: number;
  headZ: number;
  tailSw: number;
  tailUp: number;
  tailCurl: number;
  /** Кончик хвоста: щелчок с перехлёстом. */
  tailFl: number;
  /** Хвостики узла платка отстают от туловища. */
  knot: number;
}

interface Ctx {
  o: Pose;
  S: Skel;
  h: HeadF;
  lag: Lag;
  t: number;
}

/** Часть с выбором палитры по точке на ней (манишка, полосы, платок). */
interface PartF extends Part {
  pick?: (qx: number, qy: number, qz: number) => number;
  /** Свет как у трубы: нормаль без составляющей вдоль оси — звенья хвоста не «бусы». */
  tube?: boolean;
  /** Проявление шахматкой (реквизит тает). */
  vis?: number;
  /** Срез: эту точку части не рисовать (треугольник платка). */
  cut?: (qx: number, qy: number, qz: number) => boolean;
  /** Не ниже пола. */
  floor?: boolean;
}
/** Сдвиг тона, который `pick` возвращает вместе с палитрой. */
let PICK_T = 0;

/** Плоская часть: многоугольник, тон — от света плоскости и от места (u — от `a` к `b` вокруг вершины, r — от вершины к кромке). */
interface Flat {
  pts: V3[];
  apex: V3;
  a: V3;
  b: V3;
  pal: number;
  id: number;
  shade: (u: number, r: number) => number;
}

/** Прут прямо в кадр (когти). */
interface Rod {
  a: V3;
  b: V3;
  w: number;
  pal: number;
  tone: number;
  vis?: number;
}

let NEXT_ID = 0;
const nid = () => ++NEXT_ID;

const frac = (v: number) => v - Math.floor(v);

/** Расстояние от точки до отрезка (в долях части). */
function segDist(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const u = clamp01(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy));
  return Math.hypot(x - ax - u * dx, y - ay - u * dy);
}

/**
 * Череп: «M» на лбу (ломаная из двух «гор» и черта от середины вверх), полосы
 * по темени назад; на малой — три чёрточки.
 */
function skullPick(qx: number, qy: number, qz: number): number {
  PICK_T = 0;
  // Долгота и широта: на лбу они ложатся в кадр почти ровно (qz у макушки сжат).
  const lon = Math.abs(Math.atan2(qx, qy));
  const lat = Math.asin(Math.max(-1, Math.min(1, qz)));
  const w = HI ? 0.1 : 0.12;
  if (qy > -0.2 && lat > 0.3) {
    const dM = Math.min(
      segDist(lon, lat, 0, 0.48, 0.28, 0.8),
      segDist(lon, lat, 0.28, 0.8, 0.54, 0.42),
    );
    if (dM < w) return P_STRIPE;
    // От «M» вверх по темени — три полосы.
    if (lat > 0.6 && lon < w * 0.9) return P_STRIPE;
    if (lat > 0.8 && segDist(lon, lat, 0.28, 0.8, 0.24, 1.6) < w * 0.9) return P_STRIPE;
    if (HI && lat > 0.3 && lat < 0.75 && lon < 0.16) PICK_T = 0.05;
  }
  if (qy <= -0.2) {
    if (frac(qx * (HI ? 4.2 : 2.6) + 0.5) < (HI ? 0.24 : 0.3)) return P_STRIPE;
  }
  return P_FUR;
}

/** Брыли: две-три полосы от уголка глаза вбок-вниз, светлый низ у подушечек. */
function jowlPick(side: number) {
  return (qx: number, qy: number, qz: number) => {
    PICK_T = 0;
    const ow = side * qx;
    const w = HI ? 0.09 : 0.14;
    for (const z0 of HI ? [0.66, 0.3, -0.06] : [0.58, 0.1]) {
      const zz = z0 - 0.32 * (ow - 0.3);
      if (ow > -0.05 && Math.abs(qz - zz) < w) return P_STRIPE;
    }
    if (HI && ow > 0.6) PICK_T = -0.04;
    return P_FUR;
  };
}

/** Бедро: косые полосы-дуги. */
function haunchPick(side: number) {
  return (qx: number, qy: number, qz: number) => {
    PICK_T = 0;
    if (qy < -0.4) return P_FUR;
    const v = (qz * 1.25 + side * qx * 0.85 + 0.25 * qy) * (HI ? 2.2 : 1.5) + 0.3;
    return frac(v) < (HI ? 0.26 : 0.32) ? P_STRIPE : P_FUR;
  };
}

/** Лапа: поперечные полосы только снаружи (как у образцов), `n` полос на кость. */
function legPick(side: number, n: number, u0: number) {
  return (qx: number, qy: number, qz: number) => {
    PICK_T = 0;
    const outw = -side * qy;
    if (outw > -0.3 && qz > -0.6 && frac((qx + 1) * 0.5 * n + u0) < (HI ? 0.3 : 0.36))
      return P_STRIPE;
    return P_FUR;
  };
}

/** Туловище: светлая манишка спереди, по бокам полосы-дуги. */
function torsoPick(qx: number, qy: number, qz: number): number {
  PICK_T = 0;
  const ax0 = Math.abs(qx);
  const bw = 0.24 + 0.1 * clamp01(1 - Math.abs(qz - 0.2) / 0.8);
  if (qy > 0.2 && ax0 < bw && qz > -0.8 && qz < 0.9) {
    if (HI && ax0 > bw - 0.05) PICK_T = -0.05;
    return P_PALE;
  }
  if (ax0 > bw + 0.08 || qy <= 0.2) {
    const v = qz * (HI ? 3.2 : 2.3) + 0.6 * ax0 * ax0 + 0.2;
    if (frac(v) < (HI ? 0.28 : 0.34)) return P_STRIPE;
  }
  return P_FUR;
}

/** Шея: светлое горло спереди (продолжение подбородка), мех сзади. */
function neckPick(qx: number, qy: number, qz: number): number {
  PICK_T = 0;
  if (qy > 0.05 && qz < 0.3 && Math.abs(qx) < 0.7 - 0.25 * qz) return P_PALE;
  return P_FUR;
}

/** Платок: арестантские полосы — по углу (повязка) или поперёк ширины (треугольник). */
function clothPick(n: number, round: boolean) {
  return (qx: number, qy: number, qz: number) => {
    PICK_T = 0;
    const v = round ? (Math.atan2(qx, qy) / Math.PI) * n * 0.5 : (qx + 1) * 0.5 * n;
    const f = frac(v + 0.5);
    if (f < (HI ? 0.38 : 0.45)) return P_CBLK;
    if (HI && f > 0.9) PICK_T = -0.06;
    return P_CLOTH;
  };
}

/** Бинт: витки наискось, между ними шов. */
function bandTex(qx: number, _qy: number, qz: number): number {
  const f = frac((qx + 1) * (HI ? 1.7 : 1.1) + 0.14 * qz);
  return f < (HI ? 0.16 : 0.22) ? -0.4 : 0;
}

/** Пальцы: тёмные щели спереди лапы (ось 1 — вперёд). */
function toes(n: number) {
  return (qx: number, qy: number, qz: number) => {
    if (qx < 0.2 || qz < -0.4) return 0;
    const u = ((qy + 1) / 2) * n;
    const fu = u - Math.floor(u);
    return Math.floor(u) > 0 && fu < (HI ? 0.16 : 0.22) ? -0.3 : 0;
  };
}

// ---------------------------------------------------------------------------
// Части.
// ---------------------------------------------------------------------------

function profile(wid: number[], u: number): number {
  const wf = wid.length - 1;
  const wi = Math.min(wf - 1, Math.floor(u * wf));
  return lerp(wid[wi], wid[wi + 1], u * wf - wi);
}

function catmull(pts: V3[], u: number): V3 {
  const n = pts.length;
  const f = clamp01(u) * (n - 1);
  const i = Math.min(n - 2, Math.floor(f));
  const t = f - i;
  const p0 = pts[Math.max(0, i - 1)];
  const p1 = pts[i];
  const p2 = pts[i + 1];
  const p3 = pts[Math.min(n - 1, i + 2)];
  const t2 = t * t;
  const t3 = t2 * t;
  const r: V3 = [0, 0, 0];
  for (let a = 0; a < 3; a++)
    r[a] =
      0.5 *
      (2 * p1[a] +
        (p2[a] - p0[a]) * t +
        (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * t2 +
        (3 * p1[a] - p0[a] - 3 * p2[a] + p3[a]) * t3);
  return r;
}

/** Колонна из двух точек: одна часть вдоль отрезка. */
function limb(
  out: PartF[],
  p: V3,
  q: V3,
  r: number,
  ry: number,
  pal: number,
  id: number,
  op: Partial<PartF> = {},
): void {
  const d = sub(q, p);
  out.push({
    c: mul(add(p, q), 0.5),
    ax: axes(d, [0, 1, 0]),
    r: [Math.hypot(d[0], d[1], d[2]) * 0.5 + r * 0.5, r, ry],
    pal,
    id,
    ...op,
  });
}

/**
 * Прядь — капля остриём к кончику: три эллипсоида убывают от основания
 * (одна деталь, без швов внутри).
 */
function lockF(
  out: PartF[],
  base: V3,
  dir: V3,
  nrm: V3,
  len: number,
  wid: number,
  th: number,
  pal: number,
  bias: number,
  op: Partial<PartF> = {},
  id = nid(),
): void {
  const ax = axes(dir, nrm);
  for (const [u, rl, rw, db] of [
    [0.3, 0.4, 1, 0.05],
    [0.62, 0.28, 0.68, -0.02],
    [0.86, 0.17, 0.36, -0.1],
  ] as [number, number, number, number][]) {
    out.push({
      c: add(base, mul(dir, len * u)),
      ax,
      r: [len * rl, wid * rw, th * Math.max(0.5, rw)],
      pal,
      id,
      bias: bias + db,
      ...op,
    });
  }
}

function legs(out: PartF[], c: Ctx): void {
  const { o, S } = c;
  const k = S.k;
  const pl = S.pl;
  for (const side of [-1, 1] as const) {
    // Бедро: круглое, в косых полосах.
    const hc = S.up([side * pl.haunch[0] + o.rump, pl.haunch[1], pl.haunch[2]]);
    out.push({
      c: hc,
      ax: axes(rollY([1, 0, 0], side * 0.22 + o.lean), [0, 0, 1]),
      r: mul(pl.haunchR, k),
      pal: P_FUR,
      id: nid(),
      bias: -0.02,
      pick: haunchPick(side),
    });
    const hp = side < 0 ? S.hpL : S.hpR;
    if (o.stand > 0.05) {
      const knee = add(lerp3(hc, hp, 0.5), [0, -1.4 * k, 0]);
      const lid = nid();
      limb(out, add(hc, [0, 0, -2.2 * k]), knee, 1.8 * k, 2.0 * k, P_FUR, lid, {
        bias: -0.06,
        pick: legPick(side, 2, 0.3),
      });
      limb(out, knee, hp, 1.3 * k, 1.4 * k, P_FUR, lid, { bias: 0.04, pick: legPick(side, 2, 0) });
    }
    // Задняя ступня.
    out.push({
      c: add(hp, [0, 0.4 * k, 0.25 * k]),
      ax: axes(norm([side * 0.3 * (1 - o.stand), 1, 0]), [0, 0, 1]),
      r: [2.4 * k, 1.7 * k, 1.15 * k],
      pal: P_FUR,
      id: nid(),
      bias: 0.06,
      tex: toes(HI ? 4 : 2),
    });
    // Передняя лапа: плечо → локоть → лапка; на левой (слева в кадре) — бинт.
    const sh = side < 0 ? S.shL : S.shR;
    const paw = side < 0 ? S.pawL : S.pawR;
    const el = side < 0 ? S.elL : S.elR;
    const lid = nid();
    limb(out, sh, el, 1.95 * k, 2.0 * k, P_FUR, lid, { bias: 0.02, pick: legPick(side, 2, 0.15) });
    limb(out, el, paw, 1.55 * k, 1.6 * k, P_FUR, lid, {
      bias: 0.08,
      pick: legPick(side, HI ? 3 : 2, 0.55),
    });
    if (side < 0)
      limb(out, lerp3(el, paw, 0.3), lerp3(el, paw, 0.7), 1.85 * k, 1.9 * k, P_BAND, nid(), {
        bias: -0.02,
        tex: bandTex,
      });
    out.push({
      c: add(paw, [0, 0.5 * k, 0.15 * k]),
      ax: axes(norm([side * 0.06, 1, 0]), [0, 0, 1]),
      r: [2.0 * k, 1.8 * k, 1.15 * k],
      pal: P_FUR,
      id: lid,
      bias: 0.12,
      tex: toes(HI ? 4 : 2),
    });
  }
}

function torso(out: PartF[], c: Ctx): void {
  const { o, S } = c;
  out.push({
    c: S.bc,
    ax: S.bax,
    r: S.br,
    pal: P_FUR,
    id: nid(),
    bias: -0.02,
    pick: torsoPick,
  });
  const pl = S.pl;
  const k = S.k;
  const ch = o.chest;
  out.push({
    c: S.up(pl.neck),
    ax: S.bax,
    r: [pl.neckR[0] * k * (1 + 0.03 * ch), pl.neckR[1] * k, pl.neckR[2] * k],
    pal: P_FUR,
    id: nid(),
    bias: 0.02,
    pick: neckPick,
  });
}

/** Платок: повязка на шее, треугольник на груди, узел слева с двумя хвостиками. */
function kerchief(out: PartF[], c: Ctx): void {
  const { o, S, lag } = c;
  const pl = S.pl;
  const k = S.k;
  out.push({
    c: S.up(add(pl.neck, [0, 0.3, -1.7])),
    ax: S.bax,
    r: [pl.neckR[0] * 1.08 * k, pl.neckR[1] * 1.12 * k, 1.5 * k],
    pal: P_CLOTH,
    id: nid(),
    bias: 0.02,
    pick: clothPick(HI ? 9 : 5, true),
  });
  if (o.curl < 0.5) {
    const fc = torsoAt(S, 0, 0.52, 1.0);
    out.push({
      c: add(fc, mul(S.bax[1], 1.1 * k)),
      ax: S.bax,
      r: [4.4 * k, 1.1 * k, 4.0 * k],
      pal: P_CLOTH,
      id: nid(),
      bias: 0.06,
      pick: clothPick(HI ? 5 : 2.5, false),
      cut: (qx, _qy, qz) => qz > 0.95 || Math.abs(qx) > (qz + 1) * 0.5,
    });
  }
  const kn = S.up(add(pl.neck, [-3.6, 3.6, -2.4]));
  const kid = nid();
  out.push({
    c: kn,
    ax: S.bax,
    r: [1.5 * k, 1.2 * k, 1.3 * k],
    pal: P_CLOTH,
    id: kid,
    bias: 0.1,
    pick: clothPick(HI ? 4 : 2, false),
  });
  for (const [dx, dz, len] of [
    [-0.7, -1, 3.4],
    [0.05, -1, 2.8],
  ]) {
    const d = norm([dx + lag.knot * 0.6, 0.35, dz]);
    lockF(out, add(kn, mul(d, 0.5 * k)), d, [0, 1, 0], len * k, 1.2 * k, 0.6 * k, P_CLOTH, 0.08, {
      pick: clothPick(HI ? 3 : 1.5, false),
    });
  }
}

/** Хвост: кольца-полосы по длине дуги, тёмный кончик, крючок и щелчок кончиком. */
function tail(out: PartF[], c: Ctx): void {
  const { o, S, lag } = c;
  const k = S.k;
  const pl = S.pl;
  const n = pl.tail.length;
  const root = add(pl.tail[0], [o.rump, 0, 0]);
  const sw = lag.tailSw;
  const upA = lag.tailUp * (1 - o.stand) * (1 - o.curl);
  const pts = pl.tail.map((p, i) => {
    const u = i / (n - 1);
    let q = sub(add(p, [o.rump, 0, 0]), root);
    q = rotXZ(q, sw * 0.3 * u);
    q = [q[0] - upA * 2.4 * u * u, q[1] + upA * 0.6 * u, q[2] + upA * 3.2 * u * u];
    return add(root, q);
  });
  // Крючок кончика: последние точки поворачиваются вокруг четвёртой с конца.
  const cu = lag.tailCurl * 0.5 + lag.tailFl * 0.55;
  if (Math.abs(cu) > 0.005) {
    const piv = pts[n - 4];
    for (let i = n - 3; i < n; i++) pts[i] = add(piv, rotXZ(sub(pts[i], piv), cu * ((i - (n - 4)) / 3)));
  }
  const wp = pts.map((p) => S.up(p));
  const segs = HI ? 16 : 11;
  const P: V3[] = [];
  for (let i = 0; i <= segs; i++) P.push(catmull(wp, i / segs));
  const lens = P.slice(1).map((p, i) => Math.hypot(...sub(p, P[i])));
  const Lt = lens.reduce((s, v) => s + v, 0) || 1;
  const wid = [1.75, 1.7, 1.65, 1.6, 1.55, 1.5, 1.45, 1.35];
  const id = nid();
  let acc = 0;
  for (let i = 0; i < segs; i++) {
    const d = sub(P[i + 1], P[i]);
    const len = lens[i];
    if (len < 1e-4) continue;
    const um = (acc + len / 2) / Lt;
    acc += len;
    const half = len * 0.55 + 0.3 * k;
    const w = profile(wid, um) * k;
    out.push({
      c: mul(add(P[i], P[i + 1]), 0.5),
      ax: axes(d, [0, 0, 1]),
      r: [half, w, w * 0.92],
      pal: P_FUR,
      id,
      bias: 0.02,
      tube: true,
      pick: (qx) => {
        PICK_T = 0;
        const u = um + (qx * half) / Lt;
        if (u > 0.88) return P_STRIPE;
        return u > 0.1 && frac(u * 6.2 + 0.1) < 0.42 ? P_STRIPE : P_FUR;
      },
    });
  }
}

function headParts(out: PartF[], flats: Flat[], c: Ctx): void {
  const { o, h } = c;
  const k = h.k;
  const ex = h.dir([1, 0, 0]);
  const ey = h.dir([0, 1, 0]);
  const ez = h.dir([0, 0, 1]);
  const hax = axes(ex, ez);
  out.push({
    c: h.at([0, 0, 0.6]),
    ax: hax,
    r: [4.6 * k, 4.0 * k, 4.1 * k],
    pal: P_FUR,
    id: nid(),
    bias: 0.04,
    pick: skullPick,
  });
  const pid = nid();
  for (const side of [-1, 1]) {
    // Брыли старого кота: широкие щёки в полосах.
    out.push({
      c: h.at([side * 3.2, 1.5, -1.0]),
      ax: hax,
      r: [2.8 * k, 2.5 * k, 2.3 * k],
      pal: P_FUR,
      id: nid(),
      bias: 0.04,
      pick: jowlPick(side),
    });
    // Бакенбарды: пучки торчат в стороны и чуть вниз.
    for (const [cx, cy, cz, len, wd, dx, dz] of [
      [5.3, 0.6, -1.7, 2.4, 1.5, 1, -0.5],
      ...(HI
        ? [
            [4.9, 0.8, -2.8, 2.0, 1.2, 0.8, -0.95],
            [5.6, 0.4, -0.5, 1.8, 1.1, 1, -0.12],
          ]
        : []),
    ] as number[][]) {
      lockF(
        out,
        h.at([side * cx, cy, cz]),
        h.dir(norm([side * dx, 0.1, dz])),
        ey,
        len * k,
        wd * k,
        1.2 * k,
        P_FUR,
        0.02,
      );
    }
    // Подушечки усов — светлые.
    out.push({
      c: h.at([side * 1.1, 3.95, -1.5]),
      ax: hax,
      r: [1.4 * k, 1.25 * k, 1.15 * k],
      pal: P_PALE,
      id: pid,
      bias: 0.06,
    });
  }
  // Нос — розовый.
  out.push({
    c: h.at([0, 4.55, -0.5]),
    ax: hax,
    r: [0.85 * k, 0.55 * k, 0.55 * k],
    pal: P_NOSE,
    id: nid(),
    bias: 0.06,
    noSeam: true,
  });
  // Нижняя челюсть, пасть, язык, клыки.
  const jw = o.jaw;
  const sn = o.snarl;
  const piv: V3 = [0, 1.0, -2.0];
  const ja = jw * 0.75;
  const jd = (p: V3): V3 => add(piv, pitchX(sub(p, piv), ja));
  const jax = axes(h.dir(pitchX([1, 0, 0], ja)), h.dir(pitchX([0, 0, 1], ja)));
  out.push({
    c: h.at(jd([0, 3.4, -2.55])),
    ax: jax,
    r: [1.15 * k, 1.0 * k, 0.85 * k],
    pal: P_PALE,
    id: nid(),
    bias: -0.06,
  });
  if (jw > 0.05 || sn > 0.3) {
    out.push({
      c: h.at([0, 3.5, -2.3 - jw * 0.55]),
      ax: hax,
      r: [1.45 * k, 1.2 * k, (0.35 + jw * 0.85) * k],
      pal: P_MOUTH,
      id: nid(),
      bias: -0.2,
      noSeam: true,
    });
    out.push({
      c: h.at(jd([0, 3.6, -2.4])),
      ax: jax,
      r: [1.0 * k, 1.0 * k, 0.4 * k],
      pal: P_MOUTH,
      id: nid(),
      bias: sn > 0.3 ? -0.04 : 0.22,
      noSeam: true,
    });
  }
  if (jw > 0.25 || sn > 0.5) {
    for (const side of [-1, 1]) {
      out.push({
        c: h.at([side * 0.8, 4.75, -2.3 - 0.2 * jw + 0.1 * sn]),
        ax: axes(h.dir([0, 0.1, -1]), ey),
        r: [(HI ? 0.8 : 1.1) * k, (HI ? 0.36 : 0.42) * k, (HI ? 0.36 : 0.42) * k],
        pal: P_BONE,
        id: nid(),
        bias: 0.1,
        noSeam: true,
      });
      if (jw > 0.3)
        out.push({
          c: h.at(jd([side * 0.7, 4.3, -2.5])),
          ax: axes(h.dir(pitchX([0, 0.1, 1], ja)), ey),
          r: [(HI ? 0.7 : 0.95) * k, (HI ? 0.32 : 0.4) * k, 0.34 * k],
          pal: P_BONE,
          id: nid(),
          bias: 0.05,
          noSeam: true,
        });
    }
  }
  ears(flats, c);
}

/** Уши: торчком, треугольные, розовые внутри, светлый пух у основания; левое надорвано. */
function ears(flats: Flat[], c: Ctx): void {
  const { o, h } = c;
  for (const side of [-1, 1] as const) {
    const back = side < 0 ? o.earL : o.earR;
    const fl = side < 0 ? o.flL : o.flR;
    const base: V3 = [side * 3.3, -0.5, 2.8];
    const rot = (p: V3): V3 => {
      let q = sub(p, base);
      q = pitchX(q, 0.45 * neg(back) - 0.3 * pos(back) - 0.3 * fl);
      q = rollY(q, side * (0.1 + 0.95 * pos(back) + 0.45 * fl));
      return h.at(add(q, base));
    };
    const bin: V3 = [side * 1.3, -0.4, 3.7];
    const bout: V3 = [side * 5.2, -0.4, 1.6];
    const tip: V3 = [side * 4.5, -0.8, 9.0];
    let pts: V3[] = [bin, tip, bout];
    if (side < 0) {
      // Надорванное: треугольная выемка на внешней кромке.
      const mid = mul(add(bin, add(tip, bout)), 1 / 3);
      pts = [
        bin,
        tip,
        lerp3(tip, bout, 0.3),
        lerp3(lerp3(tip, bout, 0.41), mid, 0.34),
        lerp3(tip, bout, 0.52),
        bout,
      ];
    }
    flats.push({
      pts: pts.map(rot),
      apex: rot(tip),
      a: rot(bin),
      b: rot(bout),
      pal: P_FUR,
      id: nid(),
      shade: (u, r) => -0.1 * (1 - r) - (u < 0.08 || u > 0.92 ? 0.1 : 0) + 0.06,
    });
    const lift: V3 = [0, 0.35, 0];
    const iTip = add(lerp3(tip, mul(add(bin, bout), 0.5), 0.3), lift);
    const iIn = add(lerp3(bin, bout, 0.22), [0, 0.35, 0.6]);
    const iOut = add(lerp3(bin, bout, 0.7), [0, 0.35, 0.45]);
    flats.push({
      pts: [iIn, iTip, iOut].map(rot),
      apex: rot(iTip),
      a: rot(iIn),
      b: rot(iOut),
      pal: P_SKIN,
      id: nid(),
      shade: (u, r) =>
        -0.36 * (1 - r) ** 1.5 +
        0.04 -
        (HI && r > 0.4 && Math.abs(frac(u * 4 + r * 1.2) - 0.5) < 0.08 ? 0.1 : 0),
    });
    // Пух у основания — светлый клин от внутреннего края.
    const l2: V3 = [0, 0.55, 0];
    const f0 = add(lerp3(bin, bout, 0.12), add(l2, [0, 0, 0.5]));
    const f1 = add(lerp3(iIn, iTip, HI ? 0.62 : 0.5), l2);
    const f2 = add(lerp3(bin, bout, 0.42), add(l2, [0, 0, 0.3]));
    flats.push({
      pts: [f0, f1, f2].map(rot),
      apex: rot(f1),
      a: rot(f0),
      b: rot(f2),
      pal: P_PALE,
      id: nid(),
      shade: (_u, r) => 0.08 - 0.2 * (1 - r),
    });
  }
}

/** Рыбка и монета (трюк): части с глубиной, тают шахматкой. */
function propParts(out: PartF[], c: Ctx): void {
  const { o } = c;
  const g = G;
  const P: V3 = [o.ix * g, o.iy * g, o.iz * g];
  if (o.fish > 0.01) {
    // Кувырок в плоскости кадра: голова рыбки — по оси 1.
    const a = o.spin;
    const e1: V3 = [Math.cos(a), 0, Math.sin(a)];
    const e3: V3 = [-Math.sin(a), 0, Math.cos(a)];
    const ax = axes(e1, e3);
    const id = nid();
    out.push({
      c: P,
      ax,
      r: [2.7 * g, 0.85 * g, 1.2 * g],
      pal: P_FISH,
      id,
      bias: 0.08,
      vis: o.fish,
      noSeam: true,
      tex: (qx, _qy, qz) =>
        (qz < -0.35 ? 0.14 : qz > 0.45 ? -0.12 : 0) +
        (HI && qx > -0.6 && qx < 0.4 && frac(qx * 4) < 0.2 && qz > -0.3 ? -0.1 : 0),
    });
    // Хвост-плавник: две лопасти.
    for (const s of [-1, 1]) {
      const d = norm(add(mul(e1, -1), mul(e3, s * 0.85)));
      out.push({
        c: add(P, add(mul(e1, -2.9 * g), mul(d, 0.9 * g))),
        ax: axes(d, [0, 1, 0]),
        r: [1.1 * g, 0.5 * g, 0.3 * g],
        pal: P_FISH,
        id,
        bias: -0.16,
        vis: o.fish,
        noSeam: true,
      });
    }
    // Спинной плавник.
    out.push({
      c: add(P, mul(e3, 1.05 * g)),
      ax: axes(e1, e3),
      r: [1.1 * g, 0.3 * g, 0.5 * g],
      pal: P_FISH,
      id,
      bias: -0.12,
      vis: o.fish,
      noSeam: true,
    });
  }
  if (o.coin > 0.01) {
    // Монета вертится на ребре вокруг вертикали.
    const s = o.spin;
    const e1: V3 = [Math.cos(s), -Math.sin(s), 0];
    const r = 1.75 * g;
    out.push({
      c: P,
      ax: axes(e1, [0, 0, 1]),
      r: [r, 0.42 * g, r],
      pal: P_GOLD,
      id: nid(),
      bias: 0.1,
      vis: o.coin,
      noSeam: true,
      tex: (qx, _qy, qz) => {
        const rr = qx * qx + qz * qz;
        if (rr > (HI ? 0.62 : 0.7)) return -0.2;
        if (HI && rr < 0.18) return 0.1;
        return 0;
      },
    });
  }
}

/** Когти наружу: три костяных коготка из передней части каждой лапки. */
function claws(f: Frame, c: Ctx): void {
  const { o, S } = c;
  const k = S.k;
  for (const side of [-1, 1] as const) {
    const paw = side < 0 ? S.pawL : S.pawR;
    const tipC = add(paw, [0, 2.0 * k, 0.05 * k]);
    for (const j of [-1, 0, 1]) {
      const a = add(tipC, [j * 0.8 * k, 0, 0]);
      const len = (HI ? 1.5 : 1.6) * o.claw * k;
      const b = add(a, mul(norm([j * 0.35, 1, -0.5]), len));
      rodF(f, { a, b, w: HI ? 0.55 : 0.5, pal: P_BONE, tone: 4 });
    }
  }
}

// ---------------------------------------------------------------------------
// Свой растр: части с выбором палитры и срезом, плоские части, прутья.
// ---------------------------------------------------------------------------

const CE = VIEW[1];
const SE = VIEW[2];

function drawPartsF(f: Frame, parts: PartF[], pals: RGBA[][], ox: number, oy: number): void {
  const { w, h, zb } = f;
  for (const pt of parts) {
    const [e1, e2, e3] = pt.ax;
    const [r1, r2, r3] = pt.r;
    if (r1 <= 0.05 || r2 <= 0.05 || r3 <= 0.05) continue;
    const [scx, scy] = project(pt.c);
    const sy1 = e1[1] * SE - e1[2] * CE;
    const sy2 = e2[1] * SE - e2[2] * CE;
    const sy3 = e3[1] * SE - e3[2] * CE;
    const RX = Math.sqrt((r1 * e1[0]) ** 2 + (r2 * e2[0]) ** 2 + (r3 * e3[0]) ** 2) + 1;
    const RY = Math.sqrt((r1 * sy1) ** 2 + (r2 * sy2) ** 2 + (r3 * sy3) ** 2) + 1;
    const x0 = Math.max(0, Math.floor(ox + scx - RX));
    const x1 = Math.min(w - 1, Math.ceil(ox + scx + RX));
    const y0 = Math.max(0, Math.floor(oy + scy - RY));
    const y1 = Math.min(h - 1, Math.ceil(oy + scy + RY));
    if (x0 > x1 || y0 > y1) continue;
    const qdx = dot(VIEW, e1) / r1;
    const qdy = dot(VIEW, e2) / r2;
    const qdz = dot(VIEW, e3) / r3;
    const a = qdx * qdx + qdy * qdy + qdz * qdz;
    const vis = pt.vis ?? 1;
    for (let py = y0; py <= y1; py++) {
      const sy = py + 0.5 - oy;
      const dy0 = sy * SE - pt.c[1];
      const dz0 = -sy * CE - pt.c[2];
      for (let px = x0; px <= x1; px++) {
        const dx0 = px + 0.5 - ox - pt.c[0];
        const q0x = (dx0 * e1[0] + dy0 * e1[1] + dz0 * e1[2]) / r1;
        const q0y = (dx0 * e2[0] + dy0 * e2[1] + dz0 * e2[2]) / r2;
        const q0z = (dx0 * e3[0] + dy0 * e3[1] + dz0 * e3[2]) / r3;
        const b = 2 * (q0x * qdx + q0y * qdy + q0z * qdz);
        const cc = q0x * q0x + q0y * q0y + q0z * q0z - 1;
        const disc = b * b - 4 * a * cc;
        if (disc < 0) continue;
        const t = (-b + Math.sqrt(disc)) / (2 * a);
        const i = py * w + px;
        if (t <= zb[i]) continue;
        const qx = q0x + t * qdx;
        const qy = q0y + t * qdy;
        const qz = q0z + t * qdz;
        if (pt.cut && pt.cut(qx, qy, qz)) continue;
        if (pt.floor && pt.c[2] + e1[2] * qx * r1 + e2[2] * qy * r2 + e3[2] * qz * r3 < 0) continue;
        if (vis < 1 && !dith(px, py, vis)) continue;
        const nx = (e1[0] * qx) / r1 + (e2[0] * qy) / r2 + (e3[0] * qz) / r3;
        const ny = (e1[1] * qx) / r1 + (e2[1] * qy) / r2 + (e3[1] * qz) / r3;
        const nz = (e1[2] * qx) / r1 + (e2[2] * qy) / r2 + (e3[2] * qz) / r3;
        const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        const lam = (nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]) / nl;
        const bounce = Math.max(0, -nz / nl) * 0.14;
        let pal = pt.pal;
        PICK_T = 0;
        if (pt.pick) pal = pt.pick(qx, qy, qz);
        const N = pals[pal].length;
        let k = Math.max(0, lam * 0.6 + 0.4 + bounce) + PICK_T;
        if (pt.tex) k += pt.tex(qx, qy, qz);
        if (pt.bias) k += pt.bias;
        zb[i] = t;
        f.idb[i] = pt.noSeam ? -2 : pt.id;
        f.pal[i] = pal;
        f.tone[i] = Math.max(0, Math.min(N - 1, Math.round(k * (N - 1))));
      }
    }
  }
}

function drawFlats(f: Frame, flats: Flat[]): void {
  const { w, h, zb } = f;
  for (const fl of flats) {
    const P = fl.pts.map((p) => project(mul(p, RR)));
    const [ax, ay, ad] = project(mul(fl.apex, RR));
    const [bx1, by1, bd1] = project(mul(fl.a, RR));
    const [bx2, by2, bd2] = project(mul(fl.b, RR));
    const det = (bx1 - ax) * (by2 - ay) - (bx2 - ax) * (by1 - ay);
    let dA = 0;
    let dB = 0;
    if (Math.abs(det) > 1e-6) {
      dA = ((bd1 - ad) * (by2 - ay) - (bd2 - ad) * (by1 - ay)) / det;
      dB = ((bx1 - ax) * (bd2 - ad) - (bx2 - ax) * (bd1 - ad)) / det;
    }
    let n = norm(cross(sub(fl.a, fl.apex), sub(fl.b, fl.apex)));
    if (dot(n, VIEW) < 0) n = mul(n, -1);
    const lam = dot(n, LIGHT);
    const base = Math.max(0, lam * 0.55 + 0.4);
    const N = PAL[fl.pal].length;
    let x0 = 1e9;
    let x1 = -1e9;
    let y0 = 1e9;
    let y1 = -1e9;
    for (const [sx, sy] of P) {
      x0 = Math.min(x0, sx);
      x1 = Math.max(x1, sx);
      y0 = Math.min(y0, sy);
      y1 = Math.max(y1, sy);
    }
    const X0 = Math.max(0, Math.floor(OX + x0));
    const X1 = Math.min(w - 1, Math.ceil(OX + x1));
    const Y0 = Math.max(0, Math.floor(OY + y0));
    const Y1 = Math.min(h - 1, Math.ceil(OY + y1));
    const ua = Math.atan2(by1 - ay, bx1 - ax);
    let ub = Math.atan2(by2 - ay, bx2 - ax) - ua;
    while (ub > Math.PI) ub -= 2 * Math.PI;
    while (ub < -Math.PI) ub += 2 * Math.PI;
    const la = Math.hypot(bx1 - ax, by1 - ay);
    const lb = Math.hypot(bx2 - ax, by2 - ay);
    for (let py = Y0; py <= Y1; py++) {
      const sy = py + 0.5 - OY;
      for (let px = X0; px <= X1; px++) {
        const sx = px + 0.5 - OX;
        let inside = false;
        for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
          const [xi, yi] = P[i];
          const [xj, yj] = P[j];
          if (yi > sy !== yj > sy && sx < ((xj - xi) * (sy - yi)) / (yj - yi) + xi)
            inside = !inside;
        }
        if (!inside) continue;
        const d = ad + dA * (sx - ax) + dB * (sy - ay);
        const i = py * w + px;
        if (d <= zb[i]) continue;
        let an = Math.atan2(sy - ay, sx - ax) - ua;
        while (an > Math.PI) an -= 2 * Math.PI;
        while (an < -Math.PI) an += 2 * Math.PI;
        const u = clamp01(an / ub);
        const r = clamp01(Math.hypot(sx - ax, sy - ay) / Math.max(1e-3, lerp(la, lb, u)));
        zb[i] = d;
        f.idb[i] = fl.id;
        f.pal[i] = fl.pal;
        f.tone[i] = Math.max(0, Math.min(N - 1, Math.round((base + fl.shade(u, r)) * (N - 1))));
      }
    }
  }
}

/** Прут в кадр с глубиной: малая — линия в пиксель, крупная — толще, сторона к свету светлее. */
function rodF(f: Frame, r: Rod): void {
  const A = project(mul(r.a, RR));
  const B = project(mul(r.b, RR));
  const ax = OX + A[0];
  const ay = OY + A[1];
  const bx = OX + B[0];
  const by = OY + B[1];
  const rad = (r.w * RR) / 2;
  const N = PAL[r.pal].length;
  const vis = r.vis ?? 1;
  const put = (x: number, y: number, d: number, tn: number) => {
    if (x < 0 || y < 0 || x >= f.w || y >= f.h) return;
    if (vis < 1 && !dith(x, y, vis)) return;
    const i = y * f.w + x;
    if (d <= f.zb[i]) return;
    f.zb[i] = d;
    f.pal[i] = r.pal;
    f.tone[i] = Math.max(0, Math.min(N - 1, tn));
    f.idb[i] = -2;
  };
  if (rad < 0.9) {
    const n = Math.max(1, Math.round(Math.max(Math.abs(bx - ax), Math.abs(by - ay))));
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      put(
        Math.floor(lerp(ax, bx, u)),
        Math.floor(lerp(ay, by, u)),
        lerp(A[2], B[2], u) + 0.8 * RR,
        r.tone,
      );
    }
    return;
  }
  const x0 = Math.floor(Math.min(ax, bx) - rad - 1);
  const x1 = Math.ceil(Math.max(ax, bx) + rad + 1);
  const y0 = Math.floor(Math.min(ay, by) - rad - 1);
  const y1 = Math.ceil(Math.max(ay, by) + rad + 1);
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy || 1;
  const ln = Math.sqrt(l2);
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5 - ax;
      const py = y + 0.5 - ay;
      const u = clamp01((px * dx + py * dy) / l2);
      const ex = px - u * dx;
      const ey = py - u * dy;
      if (Math.hypot(ex, ey) > rad) continue;
      const side = (-dy * -0.7 + dx * -0.7) / ln;
      const lit = (ex * -dy + ey * dx) / ln;
      const tn = r.tone + (lit * side > 0.15 * rad ? 1 : lit * side < -0.3 * rad ? -2 : 0);
      put(x, y, lerp(A[2], B[2], u) + 0.8 * RR, tn);
    }
}


/** Крупная: редкая шахматка на границе двух ступеней одной части — мягкий переход. */
function softBands(f: Frame): void {
  const { w, h, pal, tone, idb } = f;
  const hit: number[] = [];
  for (let y = 0; y < h - 1; y++)
    for (let x = 0; x < w - 1; x++) {
      const i = y * w + x;
      const pl = pal[i];
      if (pl !== P_FUR && pl !== P_PALE && pl !== P_CLOTH) continue;
      for (const j of [i + w, i + 1]) {
        if (pal[j] === pl && idb[j] === idb[i] && tone[j] === tone[i] - 1 && dith(x, y, 0.28))
          hit.push(j, tone[i]);
      }
    }
  for (let n = 0; n < hit.length; n += 2) f.tone[hit[n]] = hit[n + 1];
}

// ---------------------------------------------------------------------------
// Поверх кадра: глаза, нос, рот, шрам, усы, вспышка, след удара, сон.
// ---------------------------------------------------------------------------

function eyePal(): Record<string, RGBA> {
  const iris =
    V === 1
      ? ramp('#0a3020', '#0e5a34', '#1c8a4a', '#46b86a', '#94e2a0')
      : ramp('#18300a', '#2e5a10', '#4f8a1c', '#7fb636', '#b8dc6c');
  const fur = PAL[P_FUR];
  return {
    K: INK_V[V],
    W: hx('#fffbe8'),
    o: mixc(fur[1], INK_V[V], 0.4),
    p: PAL[P_PALE][5],
    a: iris[4],
    b: iris[3],
    c: iris[2],
    d: iris[1],
  };
}
// Малая: глаз 3×3 — веко сверху тёмной чертой, зелень, зрачок-щель на два ряда.
const EYES_S: Record<string, string[]> = {
  open: ['ooo', 'aKb', 'bKc'],
  openL: ['ooo', 'Kab', 'Kbc'],
  openR: ['ooo', 'abK', 'bcK'],
  wide: ['bab', 'aKb', 'bKc'],
  smug: ['...', 'ooo', 'bKc'],
  shut: ['...', '...', 'ooo'],
  happy: ['.o.', 'o.o', '...'],
  sleep: ['...', 'o.o', '.o.'],
  angry: ['o..', 'ooo', 'aKc'],
};
// Крупная: лимон 9×7 — веко срезает верх (довольный прищур), щель зрачка, блик.
const EYES_L: Record<string, string[]> = {
  open: ['..ooooo..', '.oooooooo', 'odccKccdo', 'oabbKbbco', '.oWbKbco.', '..ooooo..', '...ppp...'],
  openL: ['..ooooo..', '.oooooooo', 'odKcccddo', 'oaKbbbbco', '.oKWbbco.', '..ooooo..', '...ppp...'],
  openR: ['..ooooo..', '.oooooooo', 'odcccKcdo', 'oabbbKbco', '.oWbbKco.', '..ooooo..', '...ppp...'],
  wide: ['..ooooo..', '.oabbbbo.', 'oabbKbbco', 'oaWbKbbco', 'obbbKbcco', '.obcKcco.', '..ooooo..'],
  smug: ['.........', '.........', '.oooooooo', 'oodcKcdoo', '.oabKbco.', '..ooooo..', '...ppp...'],
  shut: ['.........', '.........', '.........', 'o.......o', '.ooooooo.', '.........', '.........'],
  happy: ['.........', '...ooo...', '..oo.oo..', '.oo...oo.', 'oo.....oo', '.........', '.........'],
  sleep: ['.........', '.........', '.........', '.........', 'oo.....oo', '.ooooooo.', '.........'],
  angry: ['.........', 'ooo......', 'oooooo...', 'oddcKoooo', '.oabKbco.', '..ooooo..', '...ppp...'],
};

function face(p: Px, f: Frame, c: Ctx): void {
  const { o, h } = c;
  const ep = eyePal();
  for (const side of [-1, 1] as const) {
    const at = seen(f, mul(h.at([side * 2.3, 3.4, 1.3]), RR), OX, OY, 2.4 * RR);
    if (!at) continue;
    let key: string = o.eye;
    if (key === 'open' || key === 'wide' || key === 'angry') {
      const l = Math.max(o.blink, o.lid);
      if (l > 0.75) key = 'shut';
      else if (l > 0.3) key = 'smug';
    }
    if (key === 'open' && Math.abs(o.look) > 0.4) key = o.look > 0 ? 'openR' : 'openL';
    const flip = side > 0;
    // Зеркальный глаз: «влево/вправо» зрачка — по кадру, а не по стороне.
    if (flip && (key === 'openR' || key === 'openL')) key = key === 'openR' ? 'openL' : 'openR';
    if (HI) stamp(p, EYES_L[key], ep, at[0] - 4, at[1] - 3, flip);
    else stamp(p, EYES_S[key], ep, at[0] - 1, at[1] - 1, flip);
  }
  // Нос (крупная): розовый треугольник с бликом.
  const nose = seen(f, mul(h.at([0, 5.0, -0.45]), RR), OX, OY, 1.8 * RR);
  if (nose && HI) {
    const nl = PAL[P_NOSE];
    stamp(p, ['hnnnd', '.nnd.', '..d..'], { h: nl[6], n: nl[4], d: nl[2] }, nose[0] - 2, nose[1] - 1);
  }
  // Рот (крупная): от носа вниз и двумя дугами «ω»; с `grin` уголки выше.
  if (HI && o.jaw < 0.12 && o.snarl < 0.3) {
    const ink = mixc(PAL[P_PALE][1], INK_V[V], 0.5);
    const gr = o.grin;
    const pts: V3[] = [
      [0, 4.9, -1.25],
      [0, 4.9, -1.55],
      [-0.45, 4.9, -1.85],
      [0.45, 4.9, -1.85],
      [-0.9, 4.8, -1.95 + 0.1 * gr],
      [0.9, 4.8, -1.95 + 0.1 * gr],
      [-1.35, 4.6, -1.8 + 0.35 * gr],
      [1.35, 4.6, -1.8 + 0.35 * gr],
    ];
    for (const q of pts) {
      const at = seen(f, mul(h.at(q), RR), OX, OY, 1.8 * RR);
      if (at) p.set(at[0], at[1], ink);
    }
  }
}

/** Шрам через глаз справа в кадре: от брови на щёку; на крупной — стежки поперёк. */
function scar(p: Px, f: Frame, c: Ctx): void {
  const { h, o } = c;
  if (o.curl > 0.5 && !HI) return;
  const a = seen(f, mul(h.at([1.85, 2.9, 3.1]), RR), OX, OY, 2.4 * RR);
  const b = seen(f, mul(h.at([3.0, 4.0, -1.5]), RR), OX, OY, 2.4 * RR);
  if (!a || !b) return;
  const col = SCAR[V];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const steps = Math.max(Math.abs(dx), Math.abs(dy), 1);
  for (let s = 0; s <= steps; s++) {
    const x = Math.round(a[0] + (dx * s) / steps);
    const y = Math.round(a[1] + (dy * s) / steps);
    p.set(x, y, col[0]);
    if (HI) p.set(x + 1, y, col[1]);
  }
  if (!HI) return;
  const L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L;
  const ny = dx / L;
  for (const u of [0.12, 0.3, 0.72, 0.9]) {
    const cx = a[0] + dx * u + 0.5;
    const cy = a[1] + dy * u;
    for (const d of [-2, -1, 2, 3]) p.set(Math.round(cx + nx * d), Math.round(cy + ny * d), col[2]);
  }
}

/** Усы: светлые нити от подушечек в стороны; на малой — только за силуэтом. */
function whiskers(p: Px, mask: Uint8Array, c: Ctx): void {
  const { o, h } = c;
  if (o.curl > 0.5 && !HI) return;
  const col = V === 1 ? hx('#fff2d0') : hx('#efe9dc');
  for (const side of [-1, 1] as const) {
    const [sx, sy] = project(mul(h.at([side * 2.0, 4.6, -1.6]), RR));
    const x0 = OX + sx;
    const y0 = OY + sy;
    for (const a of [-0.3, -0.06, 0.18]) {
      const ang = a - 0.16 * o.whisk + 0.1 * o.tilt * side;
      const L = HI ? 17 : 8;
      for (let d = HI ? 4 : 1; d <= L; d++) {
        const x = Math.round(x0 + side * Math.cos(ang) * d);
        const y = Math.round(y0 + Math.sin(ang) * d + 0.012 * d * d * (HI ? 1 : 2));
        if (x < 0 || y < 0 || x >= p.w || y >= p.h) continue;
        if (!HI && mask[y * p.w + x]) continue;
        if (HI && d > L - 4 && !dith(x, y, (L - d + 1) / 5)) continue;
        const e = p.get(x, y);
        p.set(x, y, e[3] > 0 ? mixc(e, col, 0.55) : col);
      }
    }
  }
}

function star(p: Px, x: number, y: number, L: number, col: RGBA, arm: RGBA): void {
  p.set(x, y, col);
  for (let d = 1; d <= L; d++) {
    const cc = d === 1 ? col : arm;
    p.set(x - d, y, cc);
    p.set(x + d, y, cc);
    p.set(x, y - d, cc);
    p.set(x, y + d, cc);
  }
}

/** Трюк поверх кадра: глаз рыбки, вспышка превращения, блик на монете. */
function propFx(p: Px, f: Frame, c: Ctx): void {
  const { o } = c;
  const P: V3 = [o.ix * G, o.iy * G, o.iz * G];
  if (o.fish > 0.5) {
    const e1: V3 = [Math.cos(o.spin), 0, Math.sin(o.spin)];
    const e3: V3 = [-Math.sin(o.spin), 0, Math.cos(o.spin)];
    const at = seen(f, mul(add(P, add(mul(e1, 1.7 * G), mul(e3, 0.25 * G))), RR), OX, OY, 2 * RR);
    if (at) p.set(at[0], at[1], INK_V[V]);
  }
  if (o.flash > 0.05) {
    const [sx, sy] = project(mul(P, RR));
    const x = Math.round(OX + sx);
    const y = Math.round(OY + sy);
    const L = Math.round(o.flash * (HI ? 11 : 5));
    star(p, x, y, L, hx('#ffffff'), hx('#ffe9a0', 230));
    const R = (HI ? 7 : 3) + o.flash * (HI ? 9 : 4);
    for (let j = 0; j < 8; j++) {
      const a = (j / 8) * TAU + 0.39;
      const px = Math.round(x + Math.cos(a) * R);
      const py = Math.round(y + Math.sin(a) * R);
      p.set(px, py, hx('#fff4c8'));
      if (HI) p.set(px + 1, py, hx('#ffd86a', 220));
    }
  }
  if (o.glint > 0.05 && o.coin > 0.5) {
    const [sx, sy] = project(mul(add(P, [0.9 * G, 0.6 * G, 1.0 * G]), RR));
    const L = Math.round(o.glint * (HI ? 4 : 2));
    if (L >= 1)
      star(p, Math.round(OX + sx), Math.round(OY + sy), L, hx('#ffffff'), hx('#ffe08a', 220));
  }
}

/** След когтей: три дуги сверху-справа вниз-налево — только по пустому фону. */
function slash(p: Px, mask: Uint8Array, c: Ctx): void {
  const { o, h } = c;
  const u = o.swipe;
  const [sx, sy] = project(mul(h.at([0, 2, -1]), RR));
  const cx = OX + sx;
  const cy = OY + sy;
  const s = RR;
  const head = Math.min(1, u * 2.2);
  const tl = Math.max(0, u * 2.2 - 1.1);
  const vis = u < 0.6 ? 1.1 : (1 - u) / 0.4;
  const core = hx('#fffaf0');
  const dim = hx('#f0c070');
  for (const off of [-1, 0, 1]) {
    const ox = off * 3.2 * s;
    const oy = off * 2.6 * s;
    const P0: [number, number] = [cx + 15 * s + ox, cy - 15 * s + oy];
    const P1: [number, number] = [cx + 3 * s + ox, cy + 1 * s + oy];
    const P2: [number, number] = [cx - 13 * s + ox, cy + 14 * s + oy];
    const n = Math.round(40 * s);
    for (let i = 0; i <= n; i++) {
      const tt = i / n;
      if (tt > head || tt < tl) continue;
      const m = 1 - tt;
      const x = Math.round(m * m * P0[0] + 2 * m * tt * P1[0] + tt * tt * P2[0]);
      const y = Math.round(m * m * P0[1] + 2 * m * tt * P1[1] + tt * tt * P2[1]);
      if (x < 0 || y < 0 || x >= p.w || y >= p.h || mask[y * p.w + x]) continue;
      if (!dith(x, y, vis)) continue;
      p.set(x, y, head - tt < 0.25 ? core : dim);
    }
  }
}

/** Сон: буквы «z» поднимаются над головой и тают. */
const Z_S = ['zzz', '.z.', 'zzz'];
const Z_L = ['zzzz', '..z.', '.z..', 'zzzz'];
function zzz(p: Px, mask: Uint8Array, c: Ctx): void {
  const { h, t } = c;
  const col = hx('#f4ead8');
  for (let j = 0; j < 2; j++) {
    const u = wrap(t / 1.5 + j * 0.5, 1);
    const [sx, sy] = project(mul(h.at([3.5 + 3.5 * u, 0, 5 + 9 * u]), RR));
    const x0 = Math.round(OX + sx);
    const y0 = Math.round(OY + sy);
    const rows = HI && u > 0.3 ? Z_L : Z_S;
    for (let y = 0; y < rows.length; y++)
      for (let x = 0; x < rows[y].length; x++) {
        if (rows[y][x] !== 'z') continue;
        const X = x0 + x;
        const Y = y0 + y;
        if (X < 0 || Y < 0 || X >= p.w || Y >= p.h || mask[Y * p.w + X]) continue;
        if (!dith(X, Y, 1.2 * (1 - u) * Math.min(1, u * 6))) continue;
        p.set(X, Y, col);
      }
  }
}

// ---------------------------------------------------------------------------
// Кадр.
// ---------------------------------------------------------------------------

const LAGS = new Map<string, Lag>();

/** Пружины вторичного движения: от начала анимации (разовой) или на две петли назад. */
export function lagOf(a: Anim, t: number): Lag {
  const key = `${a}:${t}`;
  const hit = LAGS.get(key);
  if (hit) return hit;
  const T = dur(a);
  const t0 = LOOP[a] ? t - 2 * T : 0;
  const P = (tt: number) => poseAt(a, LOOP[a] ? wrap(tt, T) : Math.max(0, tt));
  const sk = (tt: number) => skel(P(tt));
  const env = LOOP[a] ? 1 : clamp01((T - t) / 0.2);
  // Разовая к концу приходит не в чистую позу, а в запаздывание покоя на кадре 0: стык без сдвига.
  const L0 = LOOP[a] ? null : lagOf('idle', 0);
  const P0 = poseAt('idle', 0);
  const S0 = skel(P0);
  const lagged = (
    fn: (tt: number) => number,
    freq: number,
    damp: number,
    off: number,
    cap = Infinity,
  ) => {
    const now = fn(t);
    const d = Math.max(-cap, Math.min(cap, spring(fn, t, t0, freq, damp) - now));
    return now + d * env + (L0 ? off * (1 - env) : 0);
  };
  const knotFn = (tt: number) => sk(tt).bc[0] * 0.5 + P(tt).lean * 4 + P(tt).tilt * 1.5;
  const r: Lag = {
    // Голова отстаёт от шеи не больше чем на шаг (лис: в броске шея тянулась столбом).
    headX: lagged((tt) => sk(tt).head[0], 3.2, 0.32, (L0?.headX ?? 0) - S0.head[0], 1),
    headZ: lagged((tt) => sk(tt).head[2], 3.2, 0.32, (L0?.headZ ?? 0) - S0.head[2], 0.8),
    tailSw: lagged(
      (tt) => P(tt).tailSw + sk(tt).head[0] * 0.05,
      2.2,
      0.24,
      (L0?.tailSw ?? 0) - P0.tailSw - S0.head[0] * 0.05,
    ),
    tailUp: lagged((tt) => P(tt).tailUp, 2.4, 0.3, (L0?.tailUp ?? 0) - P0.tailUp),
    tailCurl: lagged((tt) => P(tt).tailCurl, 2.0, 0.35, (L0?.tailCurl ?? 0) - P0.tailCurl),
    tailFl: lagged((tt) => P(tt).tailFl, 2.8, 0.14, (L0?.tailFl ?? 0) - P0.tailFl),
    knot: 0,
  };
  const kNow = knotFn(t);
  const kLag = (spring(knotFn, t, t0, 1.8, 0.16) - kNow) * env + (L0 ? L0.knot * (1 - env) : 0);
  r.knot = Math.max(-1, Math.min(1, kLag));
  LAGS.set(key, r);
  return r;
}

function headF(o: Pose, S: Skel, lag: Lag): HeadF {
  const nb = o.nod + o.bow;
  const tl = o.tilt + o.lean;
  const dir = (v: V3): V3 => rollY(yawZ0(pitchX(v, nb), o.turn), tl);
  // На малой голова крупнее: глаза, нос и пасть должны поместиться.
  const k = S.k * (HI ? 1.14 : 1.3);
  const hc: V3 = [lag.headX, S.head[1], lag.headZ];
  return { dir, k, at: (p) => add(hc, mul(dir(p), k)) };
}

function toRes(parts: PartF[]): PartF[] {
  if (RR === 1) return parts;
  return parts.map((pt) => ({ ...pt, c: mul(pt.c, RR), r: mul(pt.r, RR) }));
}

/** Кадр `i` анимации `a` полосы `res`, вариант окраса `v` (0 — обычный, 1 — золотой). */
export function catFrame(a: Anim, i: number, res: Res = 's', v = 0): Px {
  const cv = RES[res];
  RR = cv.box / RES.s.box;
  HI = res === 'l';
  OX = cv.bx + cv.box / 2;
  OY = cv.by + GROUND * RR;
  V = v === 1 ? 1 : 0;
  NEXT_ID = 0;
  const t = i / FPS;
  const o = poseAt(a, t);
  const S = skel(o);
  const lag = lagOf(a, t);
  const c: Ctx = { o, S, h: headF(o, S, lag), lag, t };
  PAL = PAL_V[V];
  const f = newFrame(cv.cw, cv.ch);
  const parts: PartF[] = [];
  const flats: Flat[] = [];
  tail(parts, c);
  legs(parts, c);
  torso(parts, c);
  kerchief(parts, c);
  headParts(parts, flats, c);
  propParts(parts, c);
  drawPartsF(f, toRes(parts), PAL, OX, OY);
  drawFlats(f, flats);
  if (o.claw > 0.02) claws(f, c);
  seams(f, 1.2 * RR, 1);
  rimLight(f, PAL, (pl) => pl !== P_MOUTH && pl !== P_NOSE && pl !== P_CBLK);
  if (HI) softBands(f);
  const p = toPx(f, PAL);
  selOutline(p, INK_V[V], 0.8);
  const mask = new Uint8Array(p.w * p.h);
  for (let j = 0; j < mask.length; j++) mask[j] = p.data[j * 4 + 3] > 0 ? 1 : 0;
  whiskers(p, mask, c);
  scar(p, f, c);
  face(p, f, c);
  propFx(p, f, c);
  if (a === 'sleep') zzz(p, mask, c);
  if (o.swipe >= 0) slash(p, mask, c);
  return p;
}
