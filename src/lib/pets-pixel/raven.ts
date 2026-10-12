// Ворон-ключник — пиксельный питомец по эталону боссов 12–14.
//
// Крупный ворон смотрит на нас: сине-чёрное перо с фиолетовым и синим
// отливом (свет на чёрном — сдвиг оттенка, а не серый), лохматые перья-
// «бородка» свисают с горла на грудь, тяжёлый тёмный клюв со светлым гребнем
// и щетинками над основанием, взъерошенный хохолок, золотой глаз; на левом
// глазу (справа в кадре) — монокль в золотой оправе на цепочке. Через грудь
// на красном шнурке — кольцо ключей: железный, латунный и золотой. На правой
// лапе (слева в кадре) — золотые кольца. Длинный хвост клином уходит назад
// и вбок, кончик — у пола за правой лапой, из-под крыла.
//
// Две полосы, у каждой свой рисунок: малая — рамка 48 (шахта, списки),
// крупная — рамка 112 (карточка, вылупление, Питомник): ряды перьев, перья
// бородки, щетинки клюва, радужка, оправа и стекло монокля, звенья цепочки,
// бородки ключей, щитки на лапах.
//
// Анимации 24 к/с по ключам (`kf`): подготовка → разгон → пик → проводка →
// возврат. Хохолок, бородка, ключи, хвост и маховые — те же ключи с
// запаздыванием (`spring`). Трюк — замок: на пол падает висячий замок, ворон
// поднимает крылом ключ, подскакивает к замку, вставляет и поворачивает
// ключ — дужка отскакивает, из замка выпрыгивают жетон и монета и летят ему
// в ключи на груди, замок исчезает. Ходьба — шаг вразвалку с подскоком.
//
// Золотой рисуется здесь же (`v` = 1) своими палитрами: перо — золото, тень —
// бронза, свет — бледное золото; клюв, ключи, монокль и глаз читаются.
// Радужного нет.

import type { Px } from '../dungeon-art';
import {
  add,
  axes,
  bezQ,
  bump,
  clamp01,
  cross,
  dith,
  drawParts,
  hash,
  hx,
  kf,
  LIGHT,
  lerp,
  lerp3,
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
  yawZ,
} from './rig';
import type { Frame, Key, Part, RGBA, V3 } from './rig';

// ---------------------------------------------------------------------------
// Палитры (тон — номер ступени; свет, шов и кант сдвигают ступень).
// ---------------------------------------------------------------------------

const P_FEATH = 0;
const P_WING = 1;
const P_BEAK = 2;
const P_LEG = 3;
const P_GOLD = 4;
const P_BRASS = 5;
const P_IRON = 6;
const P_CORD = 7;
const P_TOKEN = 8;
const P_MOUTH = 9;

const GOLD = ramp(
  '#3a2206',
  '#5e3a0c',
  '#875814',
  '#b07c1e',
  '#d4a02c',
  '#ecc040',
  '#f8dc70',
  '#fff2b0',
);
const BRASS = ramp(
  '#2a1d0a',
  '#463212',
  '#654a1c',
  '#866428',
  '#a88236',
  '#c8a24e',
  '#e2c072',
  '#f4dea4',
);
const IRON = ramp(
  '#0e0f12',
  '#1a1c20',
  '#282b30',
  '#383c42',
  '#4c5157',
  '#63696f',
  '#7f858b',
  '#a2a8ad',
  '#c8cdd1',
);
const CORD = ramp('#1e0606', '#360c0c', '#521414', '#6e1e1c', '#8c2c26', '#aa4034', '#c45a48');
const TOKEN = ramp(
  '#0a2a26',
  '#14463f',
  '#1f6458',
  '#2a8f80',
  '#43b09e',
  '#5fd1bd',
  '#8ee6d4',
  '#b8f4e6',
  '#e4fff8',
);
const MOUTH = ramp('#1a0610', '#3a0c1c', '#5e1a2c', '#84303e', '#a84a52', '#c8706e');

const PAL_V: RGBA[][][] = [
  [
    // Перо тела и головы: сине-чёрное — тень фиолетово-чёрная, середина
    // индиго, свет уходит в сиреневый отлив.
    ramp(
      '#07060c',
      '#0c0b15',
      '#12111f',
      '#18182b',
      '#1f2039',
      '#272a49',
      '#30355b',
      '#3b416f',
      '#484e84',
      '#585c9a',
      '#6d6cb2',
      '#8c86cc',
    ),
    // Крыло и хвост: отлив синий, на свету в сталь.
    ramp(
      '#05070c',
      '#090e17',
      '#0e1522',
      '#131d2f',
      '#19263d',
      '#20304d',
      '#283c5f',
      '#314a73',
      '#3c5a88',
      '#496c9e',
      '#5a82b6',
      '#76a0cc',
    ),
    // Клюв: чёрный графит, светлый только гребень.
    ramp(
      '#060509',
      '#0c0b10',
      '#131218',
      '#1b1a22',
      '#24222c',
      '#2e2c38',
      '#3a3846',
      '#4a4858',
      '#605e72',
      '#828098',
    ),
    // Лапы.
    ramp('#0a090b', '#151316', '#211e22', '#2e2a2f', '#3d383e', '#4e484f', '#625b63', '#787079'),
    GOLD,
    BRASS,
    IRON,
    CORD,
    TOKEN,
    MOUTH,
  ],
  [
    // Золотой: бронза в тени → золото → бледное золото на свету.
    ramp(
      '#1c0e03',
      '#2e1805',
      '#432408',
      '#5a320c',
      '#734412',
      '#8e5818',
      '#ab7020',
      '#c88a2c',
      '#e0a83e',
      '#f2c65a',
      '#fde084',
      '#fff4bc',
    ),
    ramp(
      '#1a0c02',
      '#2a1404',
      '#3e1f07',
      '#552c0a',
      '#6e3c0f',
      '#8a5015',
      '#a8661c',
      '#c48026',
      '#dc9e36',
      '#eebc50',
      '#fad676',
      '#fff0ac',
    ),
    ramp(
      '#0c0805',
      '#18100a',
      '#241a10',
      '#322418',
      '#423020',
      '#543e2a',
      '#6a5036',
      '#826646',
      '#9e805c',
      '#bca07a',
    ),
    ramp('#0c0805', '#18100a', '#241a10', '#322418', '#423020', '#543e2a', '#6a5036', '#826646'),
    GOLD,
    BRASS,
    IRON,
    CORD,
    TOKEN,
    MOUTH,
  ],
];
const INK_V: RGBA[] = [hx('#040309'), hx('#1a0d02')];
/** Перо темнее общего света рига: чёрный ворон; золотой — светлее. */
const PLUME_DARK = [0.3, 0.08];
const IRIS_V: RGBA[][] = [
  ramp('#4a3004', '#8a5c0c', '#c8901a', '#eebc34', '#fde27a'),
  ramp('#4a0a06', '#8a1a0c', '#c83a16', '#f06a2a', '#ffa060'),
];
const WHITE = hx('#fffbe8');
const GLASS = hx('#dff2f6');
const ZZ = hx('#dcd6f2');

// ---------------------------------------------------------------------------
// Кадр: холст и рамка тела у двух полос (как у феникса, дракона и волка).
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
const GROUND = 45;
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

type Eye = 'open' | 'happy' | 'angry' | 'sleep';

export interface Pose {
  /** Сдвиг вбок, подъём (прыжок); `fz` — лапы идут за телом (1) или стоят (0, шаг). */
  x: number;
  z: number;
  fz: number;
  sq: number;
  lean: number;
  bow: number;
  /** Голова: сдвиг, поворот (+ вправо), кивок (+ вниз), наклон набок. */
  hx: number;
  hz: number;
  turn: number;
  nod: number;
  tilt: number;
  /** Клюв: 0 — закрыт, 1 — раскрыт. */
  beak: number;
  /** Хохолок: 1 — дыбом, −1 — прижат; бородка: 1 — взъерошена. */
  crest: number;
  hack: number;
  /** Крылья: угол руки от «вниз» наружу, веер маховых (левое/правое по кадру). */
  thL: number;
  thR: number;
  fanL: number;
  fanR: number;
  /** Хвост: подъём, вбок, веер. */
  tailUp: number;
  tailSw: number;
  tailFan: number;
  /** Лапы: сдвиг и подъём (по кадру левая и правая). */
  fLx: number;
  fLz: number;
  fRx: number;
  fRz: number;
  eye: Eye;
  blink: number;
  /** Перо распушено (сон, вдох). */
  fluff: number;
  scale: number;
  /** Блеск монокля (своя фаза), звон ключей (толчок связке). */
  glint: number;
  jingle: number;
  /** Трюк: ключ в правом крыле, его угол, вставлен (0…1), повёрнут (0…1). */
  hold: number;
  keyAng: number;
  keyIn: number;
  keyTurn: number;
  /** Замок: виден (масштаб), высота над полом, дужка открыта (0…1). */
  lock: number;
  lockZ: number;
  shack: number;
  /** Добыча: доля пути жетона и монеты из замка в ключи на груди (−1 — нет). */
  loot: number;
  /** Щелчок замка (вспышка) и удар клювом (звезда у кончика). */
  flash: number;
  peck: number;
}

const REST_TH = -0.16;
const REST_FAN = 0.45;
const REST: Pose = {
  x: 0,
  z: 0,
  fz: 1,
  sq: 0,
  lean: 0,
  bow: 0,
  hx: 0,
  hz: 0,
  turn: 0,
  nod: 0,
  tilt: 0,
  beak: 0,
  crest: 0,
  hack: 0,
  thL: REST_TH,
  thR: REST_TH,
  fanL: REST_FAN,
  fanR: REST_FAN,
  tailUp: 0,
  tailSw: 0,
  tailFan: 0,
  fLx: 0,
  fLz: 0,
  fRx: 0,
  fRz: 0,
  eye: 'open',
  blink: 0,
  fluff: 0,
  scale: 1,
  glint: 0,
  jingle: 0,
  hold: 0,
  keyAng: 0,
  keyIn: 0,
  keyTurn: 0,
  lock: 0,
  lockZ: 0,
  shack: 0,
  loot: -1,
  flash: 0,
  peck: 0,
};

const loopK = (t: number, T: number, keys: Key[]) => kf(wrap(t, T), keys);
const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Дорожки анимаций.
// ---------------------------------------------------------------------------

function idlePose(t: number): Pose {
  const T = dur('idle');
  const o: Pose = { ...REST };
  // Дыхание: вдох быстрее выдоха, второй глубже; грудь и перо приподнимаются.
  const br = loopK(t, T, [
    [0, 0],
    [0.15, 0],
    [0.8, 1, 'o'],
    [1.0, 0.95],
    [1.6, 0.05],
    [1.75, 0],
    [2.35, 1.2, 'o'],
    [2.55, 1.15],
    [2.95, 0],
    [T, 0],
  ]);
  o.sq = -0.02 * br;
  o.fluff = 0.3 * br;
  // Склоняет голову набок «с интересом»: вправо, потом влево, и обратно.
  o.tilt = loopK(t, T, [
    [0, 0],
    [0.35, 0],
    [0.52, 0.3, 'o'],
    [0.6, 0.26],
    [1.15, 0.25],
    [1.32, -0.24, 'o'],
    [1.4, -0.2],
    [1.92, -0.19],
    [2.15, 0.03, 'o'],
    [2.28, 0],
    [T, 0],
  ]);
  o.turn = loopK(t, T, [
    [0, 0],
    [0.35, 0],
    [0.52, 0.22, 'o'],
    [1.15, 0.2],
    [1.32, -0.2, 'o'],
    [1.92, -0.18],
    [2.15, 0, 'o'],
    [T, 0],
  ]);
  o.nod = loopK(t, T, [
    [0, 0],
    [0.35, 0],
    [0.5, -0.08, 'o'],
    [0.7, 0.02],
    [1.3, 0],
    [1.42, 0.06],
    [1.92, 0.04],
    [2.15, 0],
    [T, 0],
  ]);
  o.hx = o.turn * 1.0 + o.tilt * 2.4;
  // Встряхнулся: бородка ерошится, тело дрогнуло, ключи звякнули.
  const shk = kf(t, [
    [2.2, 0],
    [2.3, 1, 'o'],
    [2.5, 0.7],
    [2.78, 0, 'i'],
  ]);
  const shiver = shk * Math.sin((t - 2.2) * TAU * 7);
  o.lean = 0.035 * shiver;
  o.hack = shk;
  o.crest = 0.6 * shk + 0.1 * br;
  o.jingle = 0.8 * shiver;
  o.thL = o.thR = REST_TH + 0.12 * shk;
  o.fanL = o.fanR = REST_FAN + 0.2 * shk;
  o.tailUp = 0.25 * shk;
  o.blink = Math.max(bump(t, 0.86, 1.0), bump(t, 2.84, 2.96));
  // Монокль блеснул — своя фаза, не с морганием.
  o.glint = bump(t, 1.55, 1.85);
  return o;
}

function walkPose(t: number): Pose {
  const T = dur('walk');
  const o: Pose = { ...REST };
  const h = wrap(t, T);
  o.fz = 0;
  // Шаг вразвалку с подскоком: 0–0,5 — левая лапа в воздухе, 0,5–1 — правая.
  const sway = loopK(h, T, [
    [0, 0],
    [0.2, 1, 'o'],
    [0.3, 0.95],
    [0.5, 0],
    [0.7, -1, 'o'],
    [0.8, -0.95],
    [1.0, 0],
  ]);
  o.x = -0.7 * sway;
  o.lean = -0.08 * sway;
  const hop = loopK(h, T, [
    [0, 0],
    [0.06, -0.4, 'o'],
    [0.22, 1, 'o'],
    [0.4, 0.15],
    [0.5, 0, 'i'],
    [0.56, -0.4, 'o'],
    [0.72, 1, 'o'],
    [0.9, 0.15],
    [1.0, 0, 'i'],
  ]);
  o.z = 1.5 * hop;
  o.sq = -0.05 * hop;
  const liftL = bump(h, 0.04, 0.46);
  const liftR = bump(h, 0.54, 0.96);
  o.fLz = 2.6 * liftL ** 0.8;
  o.fRz = 2.6 * liftR ** 0.8;
  o.fLx = -0.5 * liftL;
  o.fRx = 0.5 * liftR;
  // Голова кивает в такт и держит горизонт.
  o.nod = 0.1 * hop;
  o.tilt = 0.07 * sway;
  o.hx = 0.5 * sway;
  // Крылья — балансир, хвост — противовес.
  o.thL = REST_TH + 0.06 + 0.16 * Math.max(0, sway);
  o.thR = REST_TH + 0.06 + 0.16 * Math.max(0, -sway);
  o.fanL = o.fanR = REST_FAN + 0.1;
  o.tailSw = -0.5 * sway;
  o.tailUp = 0.3 * hop;
  o.crest = 0.2;
  o.jingle = 0.3 * sway;
  return o;
}

function happyPose(t: number): Pose {
  const o: Pose = { ...REST };
  const T = dur('happy');
  // Присел → толчок → в воздухе крылья вполовину раскрыты, взмах → приземлился.
  o.sq = kf(t, [
    [0, 0],
    [0.16, 0.16, 'o'],
    [0.22, -0.12, 'i'],
    [0.36, -0.05, 'o'],
    [0.62, 0],
    [0.76, -0.05],
    [0.82, 0.14, 'i'],
    [0.92, -0.02, 'o'],
    [1.0, 0.01],
    [T, 0],
  ]);
  o.z = kf(t, [
    [0, 0],
    [0.18, 0],
    [0.44, 7.5, 'o'],
    [0.56, 7.8],
    [0.8, 0, 'i'],
    [T, 0],
  ]);
  o.thL = o.thR = kf(t, [
    [0, REST_TH],
    [0.16, 0.15, 'o'],
    [0.32, 1.12, 'o'],
    [0.44, 0.72, 'i'],
    [0.56, 1.08, 'o'],
    [0.7, 0.9],
    [0.84, 0.5, 'i'],
    [0.96, REST_TH, 'o'],
    [T, REST_TH],
  ]);
  o.fanL = o.fanR = kf(t, [
    [0, REST_FAN],
    [0.32, 1.15, 'o'],
    [0.8, 1.0],
    [0.98, REST_FAN],
  ]);
  o.nod = kf(t, [
    [0, 0],
    [0.16, 0.12, 'o'],
    [0.32, -0.2, 'o'],
    [0.7, -0.12],
    [0.84, 0.08],
    [1.0, 0],
  ]);
  o.tilt = kf(t, [
    [0.3, 0],
    [0.48, 0.14],
    [0.66, -0.1],
    [0.9, 0],
  ]);
  o.crest = kf(t, [
    [0, 0],
    [0.16, -0.3],
    [0.32, 1.1, 'o'],
    [0.8, 0.8],
    [1.0, 0],
  ]);
  o.hack = kf(t, [
    [0.15, 0],
    [0.32, 0.9, 'o'],
    [0.75, 0.6],
    [1.0, 0],
  ]);
  o.tailUp = kf(t, [
    [0.15, 0],
    [0.3, -0.35, 'o'],
    [0.56, 0.4],
    [0.8, 0.5, 'o'],
    [1.0, 0],
  ]);
  o.tailFan = kf(t, [
    [0.15, 0],
    [0.35, 0.9, 'o'],
    [0.85, 0.5],
    [1.0, 0],
  ]);
  o.fLz = o.fRz = kf(t, [
    [0.2, 0],
    [0.4, 2.0, 'o'],
    [0.7, 1.4],
    [0.8, 0, 'i'],
  ]);
  o.eye = t > 0.1 && t < 0.98 ? 'happy' : 'open';
  o.beak = bump(t, 0.3, 0.74) * 0.85;
  // Связка ключей звенит: дёргается за прыжком и бьётся о грудь.
  o.jingle = kf(t, [
    [0.15, 0],
    [0.24, 1.2, 'o'],
    [0.36, -0.9],
    [0.5, 0.8],
    [0.64, -0.6],
    [0.8, 0.9, 'o'],
    [0.92, -0.3],
    [1.04, 0],
  ]);
  return o;
}

/** Трюк: когда ключ входит в скважину (с). */
const T_INS = 0.92;

function workPose(t: number): Pose {
  const o: Pose = { ...REST };
  // 0–0,34 — замок падает на пол справа и подпрыгивает; ворон глядит на него.
  o.lock = kf(t, [
    [0, 0],
    [0.04, 1],
    [1.6, 1],
    [1.66, 1.15, 'o'],
    [1.8, 0, 'i'],
  ]);
  o.lockZ = kf(t, [
    [0, 16],
    [0.2, 0, 'i'],
    [0.27, 1.6, 'o'],
    [0.34, 0, 'i'],
    [1.12, 0],
    [1.18, 1.3, 'o'],
    [1.26, 0, 'i'],
  ]);
  o.turn = kf(t, [
    [0.05, 0],
    [0.22, 0.5, 'o'],
    [0.42, 0.3],
    [0.6, 0.55],
    [1.3, 0.5],
    [1.5, 0.15],
    [1.85, 0, 'o'],
  ]);
  o.tilt = kf(t, [
    [0.1, 0],
    [0.26, 0.22, 'o'],
    [0.45, 0.05],
    [0.96, 0.05],
    [1.12, 0.34, 'o'],
    [1.22, 0.26],
    [1.42, 0],
  ]);
  o.nod = kf(t, [
    [0.15, 0],
    [0.4, -0.28, 'o'],
    [0.55, -0.1],
    [0.84, 0.3],
    [1.14, 0.32],
    [1.24, -0.12, 'o'],
    [1.45, -0.06],
    [1.85, 0],
  ]);
  o.hx = o.turn * 1.2 + o.tilt * 2.2;
  // 0,15–0,45 — поднял правое крыло (справа в кадре) с ключом: блеснул.
  o.hold = t > 0.2 && t < 1.52 ? 1 : 0;
  o.thR = kf(t, [
    [0.15, REST_TH],
    [0.42, 2.5, 'o'],
    [0.55, 2.35],
    [0.84, 0.75, 'i'],
    [0.92, 0.62, 'o'],
    [1.32, 0.62],
    [1.56, REST_TH, 'o'],
  ]);
  o.fanR = kf(t, [
    [0.15, REST_FAN],
    [0.42, 1.0, 'o'],
    [0.84, 0.7],
    [1.4, 0.7],
    [1.6, REST_FAN],
  ]);
  o.thL = kf(t, [
    [0.45, REST_TH],
    [0.58, 0.9, 'o'],
    [0.76, 0.5],
    [0.9, REST_TH + 0.1],
    [1.36, REST_TH + 0.1],
    [1.46, 0.75, 'o'],
    [1.62, REST_TH, 'i'],
  ]);
  o.keyAng = kf(t, [
    [0.15, 2.0],
    [0.42, 2.75, 'o'],
    [0.6, 2.4],
    [0.88, 1.35],
  ]);
  o.glint = bump(t, 0.38, 0.6);
  // 0,45–0,8 — подскок к замку; 0,8–0,92 — наклонился, ключ в скважину.
  o.x = kf(t, [
    [0.45, 0],
    [0.76, 5.5, 'o'],
    [1.34, 5.5],
    [1.66, 0, 'o'],
  ]);
  o.z = kf(t, [
    [0.45, 0],
    [0.6, 4.2, 'o'],
    [0.76, 0, 'i'],
    [1.34, 0],
    [1.48, 3.6, 'o'],
    [1.64, 0, 'i'],
  ]);
  o.sq = kf(t, [
    [0.36, 0],
    [0.45, 0.12, 'o'],
    [0.52, -0.08, 'i'],
    [0.7, 0],
    [0.78, 0.16, 'i'],
    [0.86, 0.12],
    [1.24, 0.12],
    [1.34, 0.14],
    [1.4, -0.06, 'i'],
    [1.6, 0],
    [1.66, 0.1, 'i'],
    [1.8, 0, 'o'],
  ]);
  o.lean = kf(t, [
    [0.7, 0],
    [0.9, 0.2, 'o'],
    [1.26, 0.2],
    [1.42, 0, 'o'],
  ]);
  o.keyIn = kf(t, [
    [0.8, 0],
    [T_INS, 1, 'o'],
    [1.3, 1],
    [1.42, 0, 'i'],
  ]);
  // 0,96–1,12 — повернул ключ (и голову за ним); щёлк — дужка отскочила.
  o.keyTurn = kf(t, [
    [0.96, 0],
    [1.1, 1, 'o'],
  ]);
  o.flash = kf(t, [
    [1.08, 0],
    [1.12, 1, 'o'],
    [1.26, 0, 'i'],
  ]);
  o.shack = kf(t, [
    [1.1, 0],
    [1.17, 1.25, 'o'],
    [1.24, 0.92],
    [1.3, 1.0],
  ]);
  // Замок исчез, ключ убран — их числа к покою (не видно; стык с покоем чистый).
  if (o.lock <= 0 && !o.hold) o.keyAng = o.keyTurn = o.shack = 0;
  // 1,16–1,72 — жетон и монета выпрыгивают и летят в ключи на груди.
  o.loot = t < 1.16 || t > 1.74 ? -1 : (t - 1.16) / 0.58;
  o.eye = t > 1.16 && t < 1.7 ? 'happy' : 'open';
  o.beak = bump(t, 1.2, 1.5) * 0.7;
  o.crest = kf(t, [
    [0.1, 0],
    [0.24, 0.6, 'o'],
    [0.5, 0.3],
    [1.12, 0.3],
    [1.2, 1.0, 'o'],
    [1.5, 0.6],
    [1.9, 0],
  ]);
  o.hack = kf(t, [
    [1.12, 0],
    [1.22, 0.8, 'o'],
    [1.6, 0.3],
    [1.9, 0],
  ]);
  o.jingle = kf(t, [
    [0.45, 0],
    [0.62, 0.6],
    [0.78, -0.5],
    [0.9, 0],
    [1.34, 0],
    [1.5, 0.6],
    [1.64, -0.7],
    [1.76, 0.5],
    [1.88, 0],
  ]);
  o.tailUp = kf(t, [
    [0.45, 0],
    [0.6, -0.3],
    [0.76, 0.35, 'o'],
    [0.95, 0.15],
    [1.34, 0.15],
    [1.48, -0.3],
    [1.66, 0.3, 'o'],
    [1.9, 0],
  ]);
  return o;
}

function attackPose(t: number): Pose {
  // Замах: откинулся, крылья вверх буквой V, клюв раскрыт → клевок к зрителю
  // (контакт 0,38 с, 9-й кадр), крылья распахнуты в стороны → проводка → покой.
  const o: Pose = { ...REST };
  o.bow = kf(t, [
    [0, 0],
    [0.28, -0.22, 'o'],
    [0.32, -0.24],
    [0.38, 0.42, 'i'],
    [0.5, 0.36, 'o'],
    [0.66, 0.1],
    [0.84, 0],
  ]);
  o.scale = kf(t, [
    [0.3, 1],
    [0.38, 1.14, 'i'],
    [0.52, 1.1],
    [0.78, 1, 'o'],
  ]);
  o.sq = kf(t, [
    [0, 0],
    [0.12, 0.1, 'o'],
    [0.3, -0.08],
    [0.38, 0.12, 'i'],
    [0.5, 0.04, 'o'],
    [0.7, 0],
  ]);
  o.z = kf(t, [
    [0.1, 0],
    [0.3, 1.4, 'o'],
    [0.38, 0, 'i'],
  ]);
  o.thL = o.thR = kf(t, [
    [0, REST_TH],
    [0.12, 1.4, 'o'],
    [0.3, 2.45, 'o'],
    [0.34, 2.5],
    [0.38, 1.6, 'i'],
    [0.5, 1.25, 'o'],
    [0.66, 0.9],
    [0.84, REST_TH],
  ]);
  o.fanL = o.fanR = kf(t, [
    [0, REST_FAN],
    [0.3, 1.3, 'o'],
    [0.42, 1.25],
    [0.6, 0.9],
    [0.84, REST_FAN],
  ]);
  // В ударе клюв смотрит на зрителя (кивок невелик): видно разинутый клюв, а
  // не темя.
  o.nod = kf(t, [
    [0, 0],
    [0.3, -0.3, 'o'],
    [0.38, -0.46, 'i'],
    [0.56, -0.3],
    [0.84, 0],
  ]);
  o.hz = kf(t, [
    [0, 0],
    [0.3, 1.2, 'o'],
    [0.38, -2.4, 'i'],
    [0.56, -1.4],
    [0.84, 0],
  ]);
  o.crest = kf(t, [
    [0, 0],
    [0.3, 1.1, 'o'],
    [0.5, 0.8],
    [0.84, 0],
  ]);
  o.hack = kf(t, [
    [0, 0],
    [0.28, 1, 'o'],
    [0.56, 0.7],
    [0.86, 0],
  ]);
  o.eye = t > 0.05 && t < 0.78 ? 'angry' : 'open';
  o.beak = kf(t, [
    [0.14, 0],
    [0.3, 0.75, 'o'],
    [0.36, 0.6],
    [0.4, 1, 'o'],
    [0.52, 0.85],
    [0.66, 0],
  ]);
  o.peck = kf(t, [
    [0.36, 0],
    [0.39, 1, 'o'],
    [0.54, 0, 'i'],
  ]);
  o.tailFan = kf(t, [
    [0.1, 0],
    [0.3, 0.7, 'o'],
    [0.5, 0.9],
    [0.84, 0],
  ]);
  o.tailUp = kf(t, [
    [0.1, 0],
    [0.3, -0.3],
    [0.42, 0.5, 'o'],
    [0.84, 0],
  ]);
  o.jingle = kf(t, [
    [0.3, 0],
    [0.4, 1.2, 'i'],
    [0.54, -0.8],
    [0.68, 0.4],
    [0.84, 0],
  ]);
  return o;
}

function sleepPose(t: number): Pose {
  const T = dur('sleep');
  const o: Pose = { ...REST };
  // Два вдоха на петлю, второй глубже; выдох длинный.
  const br = loopK(t, T, [
    [0, 0],
    [0.2, 0],
    [0.85, 1, 'o'],
    [1.55, 0.05],
    [1.7, 0],
    [2.35, 1.3, 'o'],
    [2.95, 0],
    [T, 0],
  ]);
  // Нахохлился: перо дыбом, голова втянута, клюв уткнут в бородку.
  o.fluff = 1.3 + 0.25 * br;
  o.sq = 0.12 - 0.03 * br;
  o.hz = -3.4 + 0.3 * br;
  o.nod = 0.55 - 0.04 * br;
  o.turn = 0.28;
  o.tilt = 0.14;
  o.hx = 0.6;
  o.crest = -0.8 + 0.1 * br;
  o.hack = 0.4 + 0.15 * br;
  o.thL = o.thR = REST_TH - 0.04 + 0.02 * br;
  o.fanL = o.fanR = REST_FAN - 0.05;
  o.tailUp = -0.15;
  o.eye = 'sleep';
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
// Скелет (в пикселях малой полосы).
// ---------------------------------------------------------------------------

interface Skel {
  up: (p: V3) => V3;
  body: V3;
  chest: V3;
  head: V3;
  shL: V3;
  shR: V3;
  rump: V3;
  hipL: V3;
  hipR: V3;
  footL: V3;
  footR: V3;
  ring: V3;
  k: number;
}

const BODY0: V3 = [0, -0.6, 14.0];
const HEAD0: V3 = [0, 2.4, 30.2];
/** Масштаб модели в рамке: лапы — макушка хохолка ~42 пикселя малой полосы. */
const G = 1.05;

function skel(o: Pose): Skel {
  const s = o.scale * G;
  const sq = o.sq;
  const up = (p: V3): V3 => {
    let q: V3 = [p[0] * (1 + sq * 0.55), p[1] * (1 + sq * 0.4), p[2] * (1 - sq)];
    q = pitchX(q, o.bow, [0, 0, 6]);
    q = rollY(q, o.lean, [0, 0, 0]);
    q = mul(q, s);
    return add(q, [o.x, 0, o.z]);
  };
  const foot = (side: number, dx: number, dz: number): V3 =>
    add([side * 3.4 * G + dx, 1.5 * G, 0.6 * G + dz], [o.x * o.fz, 0, o.z * o.fz]);
  return {
    up,
    body: up(BODY0),
    chest: up([0, 1.6, 19.2]),
    head: up(add(HEAD0, [o.hx, 0, o.hz])),
    shL: up([-8.0, 1.2, 23.8]),
    shR: up([8.0, 1.2, 23.8]),
    rump: up([0, -3.6, 8.6]),
    hipL: up([-3.0, 0.6, 7.6]),
    hipR: up([3.0, 0.6, 7.6]),
    footL: foot(-1, o.fLx, o.fLz),
    footR: foot(1, o.fRx, o.fRz),
    ring: up([0, 8.4, 12.6]),
    k: s,
  };
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
function headF(o: Pose, S: Skel): HeadF {
  const nb = o.nod + o.bow;
  const tl = o.tilt + o.lean;
  const dir = (v: V3): V3 => rollY(yawZ0(pitchX(v, nb), o.turn), tl);
  // На малой голова крупнее: глаз, монокль и клюв должны поместиться.
  const k = S.k * (HI ? 1.1 : 1.22);
  return { dir, k, at: (p) => add(S.head, mul(dir(p), k)) };
}

// ---------------------------------------------------------------------------
// Детали.
// ---------------------------------------------------------------------------

interface Lag {
  headX: number;
  headZ: number;
  thL: number;
  thR: number;
  rgX: number;
  rgY: number;
  rgZ: number;
  tailSw: number;
  tailUp: number;
}

interface Ctx {
  o: Pose;
  S: Skel;
  h: HeadF;
  lag: Lag;
  t: number;
}

let NEXT_ID = 0;
const nid = () => ++NEXT_ID;

/** Перья рядами (ось 3 — вверх): тёмная дуга внизу каждого, светлый край сверху. */
function scallop(rows: number, cols: number, amp: number, top = 1) {
  return (qx: number, qy: number, qz: number) => {
    const v = (top - qz) * rows * 0.5;
    const row = Math.floor(v);
    const fv = v - row;
    const u = (Math.atan2(qx, qy) / Math.PI) * cols + (row & 1) * 0.5;
    const fu = u - Math.floor(u);
    const edge = (fu - 0.5) ** 2 * 4;
    // Тёмная дуга кончика (U), блик — только на середине пера под дугой ряда выше:
    // светлой полосы поперёк ряда нет, иначе грудь читается «полосатым свитером».
    return fv > 0.8 - edge * 0.6 && fv < 0.98 - edge * 0.6 ? -amp : 0;
  };
}

/**
 * Перо по доле длины `u` (0 — основание, 1 — кончик), а не по звену: иначе блик
 * стержня и тень кончика повторялись на каждом звене и перо шло полосами.
 * Тень одной кромки, светлая кромка другой, стержень (крупная), тёмный кончик.
 */
const featherU = (u: number, qy: number): number =>
  (qy < -0.42 ? -0.16 : qy > 0.55 && u > 0.2 ? 0.1 : 0) +
  (HI && Math.abs(qy) < 0.16 && u < 0.86 ? 0.06 : 0) +
  (u > 0.94 ? -0.06 : 0);
/** Кроющее: круглый кончик обведён тенью — ряд читается чешуёй. */
const covertU = (u: number, qy: number): number =>
  (u > 0.8 || Math.abs(qy) > 0.78 ? -0.13 : u < 0.45 ? 0.05 : 0) +
  (HI && Math.abs(qy) < 0.16 && u < 0.7 ? 0.05 : 0);

/**
 * Редкие перья-«галочки»: тёмная дужка лишь в части ячеек (по шуму) — живот
 * пушистый, а не «полосатый свитер», как у рядов во всю ширину.
 */
function ticks(rows: number, cols: number, amp: number, seed: number, fill = 0.42) {
  return (qx: number, qy: number, qz: number) => {
    const v = (1 - qz) * rows * 0.5;
    const row = Math.floor(v);
    const u = (Math.atan2(qx, qy) / Math.PI) * cols + (row & 1) * 0.5;
    const col = Math.floor(u);
    if (hash(col, row, seed) > fill) return 0;
    const fv = v - row;
    const e = (u - col - 0.5) ** 2 * 4;
    return e < 0.75 && fv > 0.7 - e * 0.45 && fv < 0.9 - e * 0.45 ? -amp : 0;
  };
}

/** Полувектор «свет + взгляд»: блик на чёрном пере стоит там, где он у лака. */
const HV = norm(add(LIGHT, VIEW));
/**
 * Отлив: пятно блика по нормали части (ступенями — пиксель любит плато).
 * `r` — радиусы части, `amt` — на сколько светлее середина пятна.
 */
function gloss(ax: [V3, V3, V3], r: V3, amt: number, lo = 0.8, hi = 0.93) {
  const [e1, e2, e3] = ax;
  return (qx: number, qy: number, qz: number) => {
    const nx = (e1[0] * qx) / r[0] + (e2[0] * qy) / r[1] + (e3[0] * qz) / r[2];
    const ny = (e1[1] * qx) / r[0] + (e2[1] * qy) / r[1] + (e3[1] * qz) / r[2];
    const nz = (e1[2] * qx) / r[0] + (e2[2] * qy) / r[1] + (e3[2] * qz) / r[2];
    const s = (nx * HV[0] + ny * HV[1] + nz * HV[2]) / (Math.hypot(nx, ny, nz) || 1);
    return s > hi ? amt : s > lo ? amt * 0.5 : 0;
  };
}
const texSum =
  (...fs: (Part['tex'] | undefined)[]) =>
  (qx: number, qy: number, qz: number) => {
    let k = 0;
    for (const f of fs) if (f) k += f(qx, qy, qz);
    return k;
  };

interface FOpt {
  id?: number;
  segs?: number;
  tex?: Part['tex'];
  /**
   * Узор по доле длины всей детали (см. `featherU`); `qy`, `qz` — по сечению,
   * без сужения к концам звена (иначе кромка и стержень шли пунктиром).
   */
  utex?: (u: number, qy: number, qz: number) => number;
  bias?: number;
  noSeam?: boolean;
  /** Перекрытие звеньев (доля длины звена): больше — ровнее тон, без колец. */
  over?: number;
}

function profile(wid: number[], u: number): number {
  const wf = wid.length - 1;
  const wi = Math.min(wf - 1, Math.floor(u * wf));
  return lerp(wid[wi], wid[wi + 1], u * wf - wi);
}

/** Звенья детали по кривой `at(u)`: ширина и толщина — профили по длине. */
function chainP(
  out: Part[],
  at: (u: number) => V3,
  wid: number[],
  thick: number | number[],
  nrm: V3,
  pal: number,
  op: FOpt,
  segs: number,
): void {
  const id = op.id ?? nid();
  for (let i = 0; i < segs; i++) {
    const u0 = i / segs;
    const u1 = (i + 1) / segs;
    const p0 = at(u0);
    const p1 = at(u1);
    const d = sub(p1, p0);
    const len = Math.hypot(d[0], d[1], d[2]);
    if (len < 1e-4) continue;
    const um = (u0 + u1) / 2;
    const th = typeof thick === 'number' ? thick : profile(thick, um);
    const r0 = len * (op.over ?? 0.62) + 0.25;
    const ut = op.utex;
    out.push({
      c: mul(add(p0, p1), 0.5),
      ax: axes(d, nrm),
      r: [r0, Math.max(0.35, profile(wid, um)), Math.max(0.35, th)],
      pal,
      id,
      tex: ut
        ? (qx, qy, qz) => {
            const sc = 1 / Math.sqrt(Math.max(0.04, 1 - qx * qx));
            return ut(clamp01(um + (qx * r0) / (len * segs)), qy * sc, qz * sc);
          }
        : op.tex,
      bias: op.bias,
      noSeam: op.noSeam,
    });
  }
}

/** Перо по кривой Безье `a → b → c`. */
function feather(
  out: Part[],
  a: V3,
  b: V3,
  c: V3,
  wid: number[],
  thick: number | number[],
  nrm: V3,
  pal: number,
  op: FOpt = {},
): void {
  chainP(out, (u) => bezQ(a, b, c, u), wid, thick, nrm, pal, op, op.segs ?? 6);
}

/**
 * Прядь — капля остриём к кончику: три эллипсоида убывают от основания (одна
 * деталь, без швов внутри). Бородка, хохолок, щетинки — прядями, а не шарами.
 */
function plume(
  out: Part[],
  base: V3,
  dir: V3,
  nrm: V3,
  len: number,
  wid: number,
  th: number,
  pal: number,
  bias: number,
  tex?: Part['tex'],
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
      tex,
    });
  }
}

/** Направление во фронтальной плоскости: угол от «вниз», наружу на сторону `side`. */
const dirFront = (th: number, side: number, fwd = 0): V3 =>
  norm([side * Math.sin(th), fwd, -Math.cos(th)]);

const COVERT_W = [1.3, 1.9, 2.2, 2.1, 1.5];
const SEC_W = [1.2, 1.7, 1.9, 1.9, 1.8, 1.4, 0.7];
const PRIM_W = [1.0, 1.5, 1.7, 1.75, 1.7, 1.5, 1.1, 0.55];
const TAIL_W = [0.9, 1.3, 1.6, 1.8, 1.9, 1.8, 1.2];
const LA = 8.0;

interface Arm {
  sh: V3;
  A: V3;
  AL: V3;
  N0: V3;
  D: V3;
  DL: V3;
  open: number;
  hand: V3;
}

/** Рука крыла: плечо, направление (и с запаздыванием), плоскость крыла, запястье. */
function armOf(c: Ctx, side: -1 | 1): Arm {
  const { o, S, lag } = c;
  const k = S.k;
  const th = side < 0 ? o.thL : o.thR;
  const thLag = side < 0 ? lag.thL : lag.thR;
  const sh = side < 0 ? S.shL : S.shR;
  const arm = (a: number): V3 => norm(add(rollY(dirFront(a, side), o.lean), [0, 0.2, 0]));
  const A = arm(th);
  const AL = arm(thLag);
  // Плоскость крыла смотрит на зрителя; D — к задней кромке.
  const open = clamp01((th - 0.35) / 0.9);
  // Сложенное крыло прижато к боку (плоскость смотрит вбок — узкая полоса, не
  // «плащ»), раскрытое — в плоскости кадра.
  const N0 = norm([side * lerp(1.5, 0.55, open), 1, 0.1]);
  const D = norm(mul(cross(A, N0), -side));
  const DL = norm(mul(cross(AL, N0), -side));
  return { sh, A, AL, N0, D, DL, open, hand: add(sh, mul(A, LA * k)) };
}

function wing(out: Part[], c: Ctx, side: -1 | 1): void {
  const { o, S } = c;
  const k = S.k;
  const fan = side < 0 ? o.fanL : o.fanR;
  const { sh, A, AL, N0, D, DL, open } = armOf(c, side);
  const fdir = (phi: number, lagged = false): V3 =>
    norm(add(mul(lagged ? DL : D, Math.cos(phi)), mul(lagged ? AL : A, Math.sin(phi))));
  const onArm = (u: number, depth: number): V3 =>
    add(add(sh, mul(A, u * LA * k)), mul(N0, depth * k));
  const wk = HI ? 1 : 1.2;
  const back = (d: number): V3 => mul(VIEW, -d);
  // Сложенное крыло: перья лежат рядом поперёк крыла (D — внутрь и вперёд, к
  // телу), корни у плеча, все вниз — каждое перо видно светлой внешней кромкой,
  // кончики ступенькой. Раскрытое — корни вдоль руки, веер (`open`).
  const fold = 1 - open;
  const rest = (down: number, lat: number, depth: number): V3 =>
    add(add(add(sh, mul(A, down * k)), mul(D, lat * k)), mul(N0, depth * k));
  // Плечо и малые кроющие: округлая «подушка» у шеи, перо рядами.
  const sc = scallop(HI ? 4 : 2, HI ? 3 : 2, 0.08);
  const pax = axes(A, N0);
  const rp: V3 = [lerp(3.6, LA * 0.5 + 1.2, open) * k, lerp(2.9, 2.2, open) * k, 1.7 * k];
  const pg = gloss(pax, rp, 0.14, 0.8, 0.92);
  out.push({
    c: lerp3(rest(2.2, 0.9, 1.4), onArm(0.5, 1.3), open),
    ax: pax,
    r: rp,
    pal: P_WING,
    id: nid(),
    bias: 0.0,
    tex: (qx, qy, qz) => sc(qy, qz, -qx) + pg(qx, qy, qz),
  });
  // Большие кроющие: ряд округлых кончиков поперёк крыла, кончики обведены.
  const nC = HI ? 4 : 3;
  for (let j = 0; j < nC; j++) {
    const q = j / (nC - 1);
    const phi = lerp(1.5 + 0.06 * q, (0.05 + 0.3 * q) * fan, open);
    const rootO = add(add(onArm(0.14 + q * 0.84, 0.5), mul(D, 1.0 * k)), back(-1.4 + j * 1.6));
    const rootR = add(rest(3.4, 2.4 - q * 4.0, 1.0), back(-0.6 + j * 0.3));
    const root = lerp3(rootR, rootO, open);
    const L = lerp(4.6 + q * 0.4, 3.4 + q * 0.8, open) * k;
    const d = fdir(phi);
    feather(
      out,
      root,
      add(root, mul(d, L * 0.5)),
      add(root, mul(d, L)),
      COVERT_W.map((w) => w * k * wk),
      0.6 * k,
      N0,
      P_WING,
      { utex: covertU, segs: 4, bias: 0.05 - 0.04 * fold, over: 1.0 },
    );
  }
  // Второстепенные: в сложенном — внутренняя часть крыла; в раскрытом — от руки.
  const nS = HI ? 5 : 3;
  for (let j = 0; j < nS; j++) {
    const q = j / (nS - 1);
    const phi = lerp(1.55 + 0.02 * q, (0.04 + 0.26 * q) * fan, open);
    const rootO = add(
      add(onArm(0.2 + q * 0.55, -0.9 - q * 0.2), mul(D, 1.3 * k)),
      back(2.4 + j * 1.6),
    );
    const rootR = add(rest(4.0, 2.9 - q * 2.0, -0.2 - q * 0.15), back(0.6 + j * 0.25));
    const root = lerp3(rootR, rootO, open);
    const L = lerp(11.0 + q * 0.6, 7.4 + q * 1.0, open) * k;
    const mid = add(root, mul(fdir(phi), L * 0.55));
    const tip = add(mid, mul(fdir(phi * 1.03, true), L * 0.48));
    feather(
      out,
      root,
      mid,
      tip,
      SEC_W.map((w) => w * k * wk),
      0.7 * k,
      N0,
      P_WING,
      {
        utex: featherU,
        bias: (j % 2 ? -0.02 : 0.01) - 0.06 * fold,
        segs: 7,
        over: 1.1,
      },
    );
  }
  // Маховые: внешняя кромка крыла, длиннее к краю; концы — раздельные «пальцы».
  const nP = HI ? 5 : 3;
  for (let j = 0; j < nP; j++) {
    const q = j / (nP - 1);
    const phi = lerp(1.48 - 0.12 * q, (0.45 + q * 0.85) * fan, open);
    const rootO = add(
      add(onArm(0.72 + q * 0.3, -2.2 - q * 0.3), mul(D, 0.5 * k)),
      back(3.4 + (nS + j) * 1.6),
    );
    const rootR = add(rest(4.6, 0.6 - q * 2.6, -0.6 - q * 0.2), back(1.8 + j * 0.25));
    const root = lerp3(rootR, rootO, open);
    // Сложенное: кончики лесенкой (внутренние длиннее) — внизу 2–3 «пальца».
    const L = lerp(14.0 - q * 2.6 + (j % 2) * 0.5, 9.6 + q * 3.4, open) * k;
    const d = fdir(phi);
    const mid = add(root, mul(d, L * 0.55));
    const tip = add(mid, mul(fdir(phi + 0.05, true), L * 0.5));
    feather(
      out,
      root,
      mid,
      tip,
      PRIM_W.map((w) => w * k * wk),
      0.7 * k,
      N0,
      P_WING,
      {
        utex: featherU,
        bias: -0.03 + (j % 2 ? -0.03 : 0.02) - 0.06 * fold,
        segs: 8,
        over: 1.1,
      },
    );
  }
}

function tail(out: Part[], c: Ctx): void {
  const { o, S, lag } = c;
  const k = S.k;
  // Длинный клин: уходит назад-вниз и вбок (вправо по кадру), кончик лежит у
  // пола за правой лапой — из-под крыла видно, что хвост длинный. Середина
  // длиннее краёв, перья веером в плоскости хвоста.
  const n = HI ? 7 : 4;
  const fan = 1 + o.tailFan * 0.6;
  const upv = lag.tailUp;
  const ax = norm([0.74 + lag.tailSw * 0.55, -0.36 - upv * 0.3, -0.62 + upv * 0.9]);
  const nrm: V3 = [0, 1, 0.3];
  const sp = norm(cross(nrm, ax));
  const L0 = 13.2 * k;
  for (let j = 0; j < n; j++) {
    const u = (j / (n - 1)) * 2 - 1;
    const au = Math.abs(u);
    const len = L0 * (1 - 0.3 * au);
    const dir = norm(add(ax, mul(sp, u * 0.2 * fan)));
    const base = add(S.rump, mul(sp, u * 1.4 * k));
    const tip = add(base, mul(dir, len));
    const mid = add(lerp3(base, tip, 0.5), [lag.tailSw * 0.4 * k, 0, 0.3 * k]);
    feather(
      out,
      base,
      mid,
      tip,
      TAIL_W.map((w) => w * k * (HI ? 1 : 1.25)),
      0.6 * k,
      nrm,
      P_WING,
      {
        utex: featherU,
        bias: (j % 2 ? -0.04 : 0.03) - 0.02 * au,
        segs: 6,
        over: 1.1,
      },
    );
  }
}

function legs(out: Part[], c: Ctx): void {
  const { S } = c;
  const k = S.k;
  for (const side of [-1, 1] as const) {
    const hip = side < 0 ? S.hipL : S.hipR;
    const foot = side < 0 ? S.footL : S.footR;
    const d = sub(foot, hip);
    const id = nid();
    // Цевка в щитках.
    out.push({
      c: mul(add(hip, foot), 0.5),
      ax: axes(d, [0, 1, 0]),
      r: [Math.hypot(d[0], d[1], d[2]) * 0.5 + 0.4, 0.95 * k, 0.95 * k],
      pal: P_LEG,
      id,
      tex: (qx) => (Math.floor((qx + 1) * (HI ? 3.5 : 1.6)) & 1 ? -0.1 : 0.04),
    });
    // Пальцы: три вперёд, один назад; когти темнее.
    for (const a of [-0.6, 0, 0.6]) {
      const dir = norm([Math.sin(a) + side * 0.12, Math.cos(a), -0.12]);
      out.push({
        c: add(foot, mul(dir, 1.5 * k)),
        ax: axes(dir, [0, 0, 1]),
        r: [1.6 * k, 0.6 * k, 0.55 * k],
        pal: P_LEG,
        id,
        bias: 0.02,
      });
      out.push({
        c: add(add(foot, mul(dir, 3.0 * k)), [0, 0, -0.25 * k]),
        ax: axes(norm(add(dir, [0, 0, -0.9])), [0, 1, 0]),
        r: [0.75 * k, 0.42 * k, 0.42 * k],
        pal: P_BEAK,
        id: nid(),
        bias: -0.1,
        noSeam: true,
      });
    }
    const bd = norm([side * 0.35, -1, -0.1]);
    out.push({
      c: add(foot, mul(bd, 1.2 * k)),
      ax: axes(bd, [0, 0, 1]),
      r: [1.2 * k, 0.55 * k, 0.5 * k],
      pal: P_LEG,
      id,
      bias: -0.08,
    });
    if (side < 0) {
      // Два золотых кольца на правой лапе (слева в кадре).
      for (const u of HI ? [0.42, 0.62] : [0.5]) {
        out.push({
          c: lerp3(hip, foot, u),
          ax: axes([0, 0, 1], [0, 1, 0]),
          r: [0.5 * k, 1.35 * k, 1.35 * k],
          pal: P_GOLD,
          id: nid(),
          bias: 0.06,
          noSeam: true,
        });
      }
    }
  }
}

function body(out: Part[], c: Ctx): void {
  const { o, S, h } = c;
  const k = S.k;
  const sq = o.sq;
  const fl = o.fluff;
  const ax = axes(rollY([1, 0, 0], o.lean), pitchX([0, 0, 1], o.bow * 0.5));
  // Туловище: крупное, пух живота — редкими галочками, без рядов.
  const rb: V3 = [
    (8.2 + fl) * (1 + sq * 0.55) * k,
    (7.2 + fl * 0.8) * (1 + sq * 0.4) * k,
    (10.0 + fl * 0.5) * (1 - sq) * k,
  ];
  out.push({
    c: S.body,
    ax,
    r: rb,
    pal: P_FEATH,
    id: nid(),
    tex: texSum(HI ? ticks(7, 6, 0.09, 3) : undefined, gloss(ax, rb, 0.1)),
  });
  // Грудь: выпуклая, отлив пятном сверху-слева, перо редкими галочками.
  const rc: V3 = [
    (9.4 + fl * 0.8) * (1 + sq * 0.5) * k,
    (5.6 + fl * 0.5) * k,
    (7.6 + fl * 0.3) * (1 - sq) * k,
  ];
  out.push({
    c: S.chest,
    ax,
    r: rc,
    pal: P_FEATH,
    id: nid(),
    bias: 0.02,
    tex: texSum(HI ? ticks(5, 6, 0.1, 7, 0.5) : undefined, gloss(ax, rc, 0.16, 0.76, 0.9)),
  });
  // Бёдра в перьях — лохматые «штаны».
  for (const side of [-1, 1]) {
    out.push({
      c: S.up([side * 3.2, 1.2, 8.6]),
      ax,
      r: [(2.9 + fl * 0.4) * k, (2.7 + fl * 0.3) * k, 3.4 * (1 - sq) * k],
      pal: P_FEATH,
      id: nid(),
      bias: -0.04,
      tex: HI ? scallop(3, 2.2, 0.08) : undefined,
    });
  }
  // Шея: несёт голову, под бородкой.
  const hb = h.at([0, -0.6, -3.4]);
  const nl = S.up([0, 0.8, 23.4]);
  const nd = sub(hb, nl);
  const len = Math.hypot(nd[0], nd[1], nd[2]);
  out.push({
    c: mul(add(nl, hb), 0.5),
    ax: axes(nd, [0, 1, 0]),
    r: [len * 0.5 + 1.8 * k, 4.3 * k, 4.1 * k],
    pal: P_FEATH,
    id: nid(),
    bias: -0.02,
  });
}

/** Бородка: острые перья свисают с горла на грудь, черепицей. */
function hackles(out: Part[], c: Ctx): void {
  const { o, S, h, lag } = c;
  const k = h.k;
  const n = HI ? 7 : 4;
  const ruf = o.hack;
  const sway = clamp01(Math.abs(lag.headX - S.head[0]) * 0.2) * Math.sign(lag.headX - S.head[0]);
  // Прядь блестит серединой (отлив), кромки темнее: пряди не сливаются с грудью.
  const tex = HI
    ? (qx: number, qy: number) =>
        Math.abs(qy) < 0.28 && qx < 0.5 ? 0.12 : Math.abs(qy) > 0.62 ? -0.1 : 0
    : (_qx: number, qy: number) => (qy > 0.35 ? -0.1 : qy < -0.1 ? 0.06 : 0);
  for (let j = 0; j < n; j++) {
    const u = (j / (n - 1)) * 2 - 1;
    const au = Math.abs(u);
    // Пряди лежат поверх груди: основание впереди горла, направление — вниз-вперёд.
    const base = h.at([u * 3.4, 3.0 - au * 0.9, -3.2 + au * 0.5]);
    const len = (8.4 - au * 2.6) * k * (1 + 0.12 * ruf);
    const dir = norm([u * (0.3 + 0.3 * ruf) - sway * 0.25, 0.5 + 0.28 * ruf, -1]);
    const behind = j % 2 ? -0.5 * k : 0;
    plume(
      out,
      add(base, [0, behind, 0]),
      dir,
      [0, 1, 0.1],
      len,
      (HI ? 1.6 : 1.8) * k,
      1.2 * k,
      P_FEATH,
      0.08 + (j % 2 ? -0.05 : 0.03),
      tex,
    );
  }
}

/** Хохолок: несколько взъерошенных острых перьев на макушке, отстают от головы. */
const CREST_L: [number, number, number][] = [
  [0.5, -0.3, 3.0],
  [-0.7, -0.62, 2.4],
  [1.5, -0.12, 2.0],
  [-1.6, -0.9, 1.6],
  [0.0, -0.5, 1.9],
];
const CREST_S: [number, number, number][] = [
  [0.4, -0.3, 2.9],
  [-1.0, -0.7, 2.2],
  [1.3, -0.1, 1.9],
];
function crest(out: Part[], c: Ctx): void {
  const { o, S, h, lag } = c;
  const k = h.k;
  const dx = (lag.headX - S.head[0]) * 0.12;
  const dz = (lag.headZ - S.head[2]) * 0.1;
  const up = o.crest;
  for (const [bx, ang, len] of HI ? CREST_L : CREST_S) {
    const a = ang * (1 + Math.max(0, up) * 0.3);
    const lift = up >= 0 ? 1 : 1 + up * 0.85;
    // Вихор зачёсан назад и набок, разной длины: не «ирокез» гребнем.
    const d = h.dir(
      norm([
        Math.sin(a),
        -1.1 + 0.6 * Math.max(0, up) - (1 - lift) * 1.0,
        Math.cos(a) * 0.75 * lift,
      ]),
    );
    const base = h.at([bx, -1.4, 4.2 - Math.abs(bx) * 0.3]);
    plume(
      out,
      base,
      norm(add(d, [-dx, 0, -dz])),
      h.dir([0, 1, 0]),
      len * k * (1 + 0.25 * Math.max(0, up)),
      1.0 * k,
      0.75 * k,
      P_FEATH,
      0.1,
    );
  }
}

function head(out: Part[], c: Ctx): void {
  const { o, h } = c;
  const k = h.k;
  const ex = h.dir([1, 0, 0]);
  const ey = h.dir([0, 1, 0]);
  const ez = h.dir([0, 0, 1]);
  // Голова: широкая, плоская сверху; лак отлива на темени.
  const hax = axes(ex, ez);
  const rh: V3 = [5.8 * k, 5.4 * k, 4.9 * k];
  out.push({
    c: h.at([0, 0, 0]),
    ax: hax,
    r: rh,
    pal: P_FEATH,
    id: nid(),
    bias: -0.02,
    tex: texSum(HI ? scallop(6, 4, 0.05) : undefined, gloss(hax, rh, 0.18, 0.78, 0.92)),
  });
  // Горло под клювом: отсюда свисает бородка.
  out.push({
    c: h.at([0, 1.4, -2.8]),
    ax: axes(ex, ez),
    r: [3.6 * k, 3.2 * k, 2.6 * k],
    pal: P_FEATH,
    id: nid(),
    bias: -0.03,
  });
  // Тяжёлые надбровья: строгий взгляд; во гневе сведены круче.
  const slant = o.eye === 'angry' ? 0.6 : 0.3;
  for (const side of [-1, 1]) {
    out.push({
      c: h.at([side * 2.8, 3.3, 2.1]),
      ax: axes(h.dir(norm([1, 0, side * slant])), ey),
      r: [2.2 * k, 0.85 * k, 0.95 * k],
      pal: P_FEATH,
      id: nid(),
      bias: -0.12,
      noSeam: true,
    });
  }
  // Клюв: надклювье — широкое у основания, гребень дугой со светлой полосой,
  // крюк на конце темнее; подклювье открывается вниз от угла рта.
  // Гребень — светлая линия по верху (по сечению, сплошная), крюк темнее.
  const ridge = (u: number, qy: number, qz: number) =>
    (qz > 0.5 && Math.abs(qy) < 0.32 ? 0.26 : qz < -0.3 ? -0.08 : 0) + (u > 0.82 ? -0.08 : 0);
  const bid = nid();
  const op = o.beak;
  const hinge: V3 = [0, 3.0, -1.0];
  // Раскрытый клюв: надклювье чуть вверх, подклювье вниз — зев виден анфас.
  const upr = (p: V3): V3 => pitchX(p, -op * 0.3, hinge);
  feather(
    out,
    h.at(upr([0, 4.2, 1.0])),
    h.at(upr([0, 7.6, 0.7])),
    h.at(upr([0, 8.0, -3.4])),
    [2.9, 2.75, 2.45, 2.0, 1.45, 0.9, 0.5].map((w) => w * k),
    [2.2, 2.1, 1.9, 1.6, 1.25, 0.9, 0.6].map((w) => w * k),
    ez,
    P_BEAK,
    { id: bid, utex: ridge, segs: HI ? 7 : 5, bias: -0.34, over: 1.1 },
  );
  const rot = (p: V3): V3 => pitchX(p, op * 0.7, hinge);
  feather(
    out,
    h.at(rot([0, 3.4, -1.2])),
    h.at(rot([0, 6.0, -2.0])),
    h.at(rot([0, 6.8, -3.0])),
    [2.1, 1.9, 1.6, 1.2, 0.6].map((w) => w * k),
    0.9 * k,
    ez,
    P_BEAK,
    { id: nid(), bias: -0.34, segs: HI ? 6 : 4 },
  );
  if (op > 0.15) {
    // Зев: красная глотка между надклювьем и подклювьем — клюв нараспашку
    // читается и анфас.
    out.push({
      c: h.at([0, 5.0, -1.8 - op * 0.9]),
      ax: axes(ey, ez),
      r: [2.8 * k, 1.7 * k, (0.4 + 1.1 * op) * k],
      pal: P_MOUTH,
      id: nid(),
      bias: 0.05,
      noSeam: true,
    });
  }
  // Щетинки над основанием клюва: короткие пряди вперёд по гребню.
  for (const x of HI ? [-1.5, -0.5, 0.5, 1.5] : [-0.9, 0.9]) {
    plume(
      out,
      h.at([x, 3.4, 1.9]),
      h.dir(norm([x * 0.12, 1, -0.35])),
      ez,
      3.2 * k,
      0.9 * k,
      0.7 * k,
      P_FEATH,
      0.0,
    );
  }
}

/** Ключи на кольце: угол от «вниз» (наружу), палитра, длина. */
const KEYS: [number, number, number][] = [
  [-0.5, P_IRON, 4.2],
  [0.04, P_BRASS, 5.0],
  [0.55, P_GOLD, 4.4],
];

/** Ключ: кольцо головки, стержень, бородка сбоку. `turn` — поворот вокруг стержня (0…1). */
function keyParts(out: Part[], top: V3, d: V3, L: number, pal: number, k: number, turn = 0): void {
  const id = nid();
  // Плоскость ключа: лицом к зрителю, при повороте — ребром.
  const side0 = norm(cross(d, [0, 1, 0]));
  const fwd = norm(cross(side0, d));
  const ang = turn * Math.PI * 0.5;
  const side = norm(add(mul(side0, Math.cos(ang)), mul(fwd, Math.sin(ang))));
  const face = norm(cross(d, side));
  const bowR = 1.0 * k;
  const bowC = add(top, mul(d, bowR));
  if (HI) {
    const n = 8;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * TAU;
      const a1 = ((i + 1) / n) * TAU;
      const q0 = add(bowC, add(mul(d, Math.cos(a0) * bowR), mul(side, Math.sin(a0) * bowR)));
      const q1 = add(bowC, add(mul(d, Math.cos(a1) * bowR), mul(side, Math.sin(a1) * bowR)));
      const dd = sub(q1, q0);
      out.push({
        c: mul(add(q0, q1), 0.5),
        ax: axes(dd, face),
        r: [Math.hypot(dd[0], dd[1], dd[2]) * 0.62 + 0.1, 0.42 * k, 0.42 * k],
        pal,
        id,
        bias: 0.05,
        noSeam: true,
      });
    }
  } else {
    out.push({
      c: bowC,
      ax: axes(d, face),
      r: [bowR * 1.05, bowR * 1.05, 0.55 * k],
      pal,
      id,
      bias: 0.08,
      noSeam: true,
    });
  }
  const s0 = add(top, mul(d, 2 * bowR));
  const s1 = add(top, mul(d, L));
  out.push({
    c: mul(add(s0, s1), 0.5),
    ax: axes(d, face),
    r: [(L - 2 * bowR) * 0.5 + 0.2, (HI ? 0.42 : 0.55) * k, 0.45 * k],
    pal,
    id,
    noSeam: true,
  });
  // Бородка: зубцы сбоку у конца стержня.
  const teeth = HI ? [0.55, 1.15] : [0.7];
  for (const u of teeth) {
    out.push({
      c: add(add(s1, mul(d, -u * k)), mul(side, 0.75 * k)),
      ax: axes(side, face),
      r: [0.7 * k, 0.32 * k, 0.4 * k],
      pal,
      id,
      bias: -0.06,
      noSeam: true,
    });
  }
}

function keyRing(out: Part[], c: Ctx): void {
  const { o, S, lag } = c;
  const k = S.k;
  const ring = S.ring;
  // Шнурок: от боков шеи вниз к кольцу (уходит под бородку).
  for (const side of [-1, 1]) {
    const top = S.up([side * 4.6, 4.8, 21.6]);
    const end = add(ring, [side * 0.9 * k, 0, 1.0 * k]);
    const mid = add(lerp3(top, end, 0.5), [side * 0.6 * k, 1.4 * k, -1.2 * k]);
    feather(
      out,
      top,
      mid,
      end,
      [0.5, 0.5, 0.5].map((w) => w * k * (HI ? 1 : 1.15)),
      0.5 * k,
      [0, 1, 0],
      P_CORD,
      {
        segs: HI ? 7 : 5,
        bias: 0.06,
        noSeam: true,
      },
    );
  }
  // Кольцо: железное, лицом к зрителю.
  const rid = nid();
  const rr = 1.3 * k;
  const nRing = HI ? 10 : 6;
  for (let i = 0; i < nRing; i++) {
    const a = (i / nRing) * TAU;
    const a1 = ((i + 1) / nRing) * TAU;
    const p0 = add(ring, [Math.cos(a) * rr, 0, Math.sin(a) * rr]);
    const p1 = add(ring, [Math.cos(a1) * rr, 0, Math.sin(a1) * rr]);
    const d = sub(p1, p0);
    out.push({
      c: mul(add(p0, p1), 0.5),
      ax: axes(d, [0, 1, 0]),
      r: [Math.hypot(d[0], d[1], d[2]) * 0.6 + 0.12, 0.45 * k, 0.45 * k],
      pal: P_IRON,
      id: rid,
      bias: 0.04,
      noSeam: true,
    });
  }
  // Ключи висят с низа кольца и качаются с запаздыванием — каждый по-своему.
  const swX = lag.rgX - ring[0];
  const swY = lag.rgY - ring[1];
  const swZ = lag.rgZ - ring[2];
  KEYS.forEach(([a0, pal, len], j) => {
    const ang = a0 + swX * (0.3 + 0.1 * j) - swZ * 0.04 * (j - 1) + o.jingle * 0.06 * (j - 1);
    const d = norm([Math.sin(ang), 0.12 - swY * 0.15, -Math.cos(ang)]);
    const top = add(ring, mul(norm([Math.sin(a0 * 0.8), 0, -Math.cos(a0 * 0.8)]), rr));
    keyParts(out, add(top, [0, 0.2 * k * (j - 1), 0]), d, len * k, pal, k);
  });
}

// ---------------------------------------------------------------------------
// Трюк: ключ в крыле, замок, жетон и монета.
// ---------------------------------------------------------------------------

/** Замок на полу справа; передняя грань развёрнута к ворону. */
const LOCK0: V3 = [19.0, 3.0, 0];
const LOCK_YAW = 0.55;
const LOCK_K = 1.05;
/** Скважина: точка на передней грани замка (в его координатах). */
const HOLE: V3 = [0, 1.9, 2.4];

const lockAt = (o: Pose, p: V3): V3 =>
  add(add(LOCK0, [0, 0, o.lockZ]), mul(yawZ(p, LOCK_YAW), LOCK_K * G * o.lock));

function heldKey(out: Part[], c: Ctx): void {
  const { o, S } = c;
  if (!o.hold) return;
  const k = S.k;
  const { hand, A } = armOf(c, 1);
  const L = 6.2 * k;
  // В крыле: от запястья по углу `keyAng`; в замке: кончик в скважине.
  const dHold = norm(add(dirFront(o.keyAng, 1, 0.1), mul(A, 0.2)));
  const hole = lockAt({ ...o, lock: 1 }, HOLE);
  const dIn = norm(sub(hole, hand));
  const d = norm(lerp3(dHold, dIn, o.keyIn));
  const topHeld = add(hand, mul(dHold, -1.2 * k));
  const topIn = add(hole, mul(dIn, -L + 0.6 * k));
  keyParts(out, lerp3(topHeld, topIn, o.keyIn), d, L, P_GOLD, k * 1.15, o.keyTurn);
}

function lockParts(out: Part[], c: Ctx): void {
  const { o } = c;
  if (o.lock < 0.02) return;
  const s = LOCK_K * G * o.lock;
  const P = (p: V3) => lockAt(o, p);
  const ex = yawZ([1, 0, 0], LOCK_YAW);
  const id = nid();
  const band = (_qx: number, _qy: number, qz: number) => (qz > 0.72 ? 0.12 : qz < -0.7 ? -0.1 : 0);
  // Корпус: скруглённый брусок из двух эллипсоидов.
  out.push({
    c: P([0, 0, 2.6]),
    ax: axes(ex, [0, 0, 1]),
    r: [3.2 * s, 1.8 * s, 2.5 * s],
    pal: P_BRASS,
    id,
    tex: band,
  });
  out.push({
    c: P([0, 0, 2.6]),
    ax: axes(ex, [0, 0, 1]),
    r: [2.7 * s, 2.0 * s, 2.9 * s],
    pal: P_BRASS,
    id,
    bias: 0.02,
    tex: band,
  });
  // Дужка: полукольцо над корпусом; открытая — подскочила и повернулась на левой ноге.
  const R = 1.9;
  const lift = 1.6 * o.shack;
  const swing = -1.5 * clamp01(o.shack);
  const pivot: V3 = [-R, 0, 0];
  const sh = (p: V3): V3 => add(yawZ(sub(p, pivot), swing), pivot);
  const pts: V3[] = [];
  pts.push([-R, 0, 4.6]);
  pts.push([-R, 0, 5.4 + lift]);
  const nA = HI ? 10 : 6;
  for (let i = 0; i <= nA; i++) {
    const a = Math.PI - (i / nA) * Math.PI;
    pts.push([R * Math.cos(a), 0, 5.4 + lift + R * Math.sin(a)]);
  }
  pts.push([R, 0, 5.4 + lift]);
  pts.push([R, 0, 4.6 + lift]);
  const sid = nid();
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = P(i < 2 ? pts[i] : sh(pts[i]));
    const p1 = P(i + 1 < 2 ? pts[i + 1] : sh(pts[i + 1]));
    const d = sub(p1, p0);
    const len = Math.hypot(d[0], d[1], d[2]);
    if (len < 1e-4) continue;
    out.push({
      c: mul(add(p0, p1), 0.5),
      ax: axes(d, [0, 1, 0]),
      r: [len * 0.62 + 0.15, 0.6 * s, 0.6 * s],
      pal: P_IRON,
      id: sid,
      bias: 0.06,
      noSeam: true,
    });
  }
}

/** Жетон и монета: из замка дугой вверх и в ключи на груди; крутятся. */
function lootPos(c: Ctx, j: number): { p: V3; r: number; spin: number } | null {
  const { o, S } = c;
  if (o.loot < 0) return null;
  const u = clamp01(o.loot - j * 0.08);
  if (u <= 0) return null;
  const start = lockAt(o, [0, 0, 5.2]);
  const peak: V3 = [lerp(start[0], S.ring[0], 0.45) + (j ? 4 : -3), 3, 24 + j * 3];
  const end = add(S.ring, [0, 1, 0]);
  const e = u < 1 ? 1 - (1 - u) ** 1.6 : 1;
  const p = bezQ(start, peak, end, e);
  const r = (u < 0.15 ? u / 0.15 : u > 0.8 ? (1 - u) / 0.2 : 1) * 1.9 * G;
  return { p, r, spin: (c.t * 9 + j * 1.3) % TAU };
}

function lootParts(out: Part[], c: Ctx): void {
  for (const j of [0, 1]) {
    const L = lootPos(c, j);
    if (!L || L.r < 0.3) continue;
    const w = Math.max(0.35, Math.abs(Math.cos(L.spin)));
    out.push({
      c: L.p,
      ax: axes(norm([Math.cos(L.spin), Math.sin(L.spin), 0]), [0, 0, 1]),
      r: [L.r * w + 0.15, 0.45 * G, L.r],
      pal: j ? P_TOKEN : P_GOLD,
      id: nid(),
      bias: 0.12,
      tex: (qx, _qy, qz) => (qx * qx + qz * qz > 0.55 ? -0.1 : qx * qx + qz * qz < 0.12 ? 0.12 : 0),
    });
  }
}

// ---------------------------------------------------------------------------
// Крупная: мягкие переходы тона на пере.
// ---------------------------------------------------------------------------

/**
 * Холодный отсвет по нижнему и правому краю пера: чёрный низ не тонет в
 * тёмной полосе шахты (урок волка). Ступень вверх, но не ниже стальной синевы
 * крыла — тонкая кромка внутри чернильного контура.
 */
function coolRim(f: Frame): void {
  const { w, h, pal, tone } = f;
  const hit: number[] = [];
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (pal[i] !== P_FEATH && pal[i] !== P_WING) continue;
      if (pal[i + 1] < 0 || pal[i + w] < 0 || pal[i + w + 1] < 0) hit.push(i);
    }
  const lo = HI ? 5 : 6;
  for (const i of hit) {
    pal[i] = P_WING;
    tone[i] = Math.min(PAL[P_WING].length - 1, Math.max(lo, tone[i] + 2));
  }
}

function softBands(f: Frame): void {
  const { w, h, pal, tone, idb } = f;
  const hit: number[] = [];
  for (let y = 0; y < h - 1; y++)
    for (let x = 0; x < w - 1; x++) {
      const i = y * w + x;
      const pl = pal[i];
      if (pl !== P_FEATH && pl !== P_WING) continue;
      for (const j of [i + w, i + 1]) {
        if (pal[j] === pl && idb[j] === idb[i] && tone[j] === tone[i] - 1 && dith(x, y, 0.28))
          hit.push(j, tone[i]);
      }
    }
  for (let n = 0; n < hit.length; n += 2) f.tone[hit[n]] = hit[n + 1];
}

// ---------------------------------------------------------------------------
// Поверх кадра: глаза, монокль и цепочка, скважина, блики, звёзды, сон.
// ---------------------------------------------------------------------------

function eyePal(): Record<string, RGBA> {
  const ir = IRIS_V[V];
  const fe = PAL[P_FEATH];
  return {
    K: INK_V[V],
    W: WHITE,
    a: ir[4],
    b: ir[3],
    c: ir[2],
    d: ir[1],
    e: mixc(ir[0], INK_V[V], 0.4),
    L: fe[V ? 3 : 9],
    l: fe[V ? 4 : 7],
    M: fe[V ? 2 : 10],
  };
}
// Малая: глаз 2×2 — золото и зрачок; закрытый — светлая черта (на чёрном тёмная пропадает).
const EYES_S: Record<string, string[]> = {
  open: ['ab', 'bK'],
  half: ['..', 'bK'],
  shut: ['..', 'LL'],
  happy: ['b.', '.b'],
  sleep: ['..', 'MM'],
  angry: ['b.', 'bK'],
};
// Крупная: круглый глаз 5×5 — тёмный ободок, радужка светлее сверху, зрачок, блик.
const EYES_L: Record<string, string[]> = {
  open: ['.eee.', 'eabWe', 'ebKKe', 'ecKce', '.eee.'],
  half: ['.....', 'eeeee', 'ebKKe', 'ecKce', '.eee.'],
  shut: ['.....', '.....', 'LLLLL', '.lll.', '.....'],
  happy: ['.....', '.aaa.', 'b...b', '.....', '.....'],
  sleep: ['.....', '.....', 'M...M', '.MMM.', '.....'],
  angry: ['ee...', 'eeee.', 'ebKWe', 'ecKKe', '.eee.'],
};

interface EyeAt {
  x: number;
  y: number;
  key: string;
}

function eyes(p: Px, f: Frame, c: Ctx): (EyeAt | null)[] {
  const { o, h } = c;
  const ep = eyePal();
  const res: (EyeAt | null)[] = [];
  for (const side of [-1, 1] as const) {
    const ep3 = mul(h.at([side * 2.9, 3.85, 1.0]), RR);
    const at = seen(f, ep3, OX, OY, 2.4 * RR);
    if (!at) {
      // Глаз за основанием клюва (голова вполоборота): монокль всё равно
      // висит перед ним — без него это другой ворон.
      const [sx, sy] = project(ep3);
      const front = h.dir([0, 1, 0])[1] > 0.4 && o.eye !== 'sleep';
      res.push(
        side > 0 && front ? { x: Math.floor(OX + sx), y: Math.floor(OY + sy), key: 'hid' } : null,
      );
      continue;
    }
    let key: string = o.eye;
    if (key === 'open' || key === 'angry') {
      if (o.blink > 0.75) key = 'shut';
      else if (o.blink > 0.3) key = 'half';
    }
    const flip = side > 0;
    if (HI) stamp(p, EYES_L[key], ep, at[0] - 2, at[1] - 2, flip);
    else stamp(p, EYES_S[key], ep, at[0] - (flip ? 0 : 1), at[1] - 1, flip);
    res.push({ x: at[0], y: at[1], key });
  }
  return res;
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

/** Монокль: золотая оправа вокруг левого глаза (справа в кадре), стекло, цепочка к шнурку. */
function monocle(p: Px, f: Frame, c: Ctx, eye: EyeAt | null): void {
  const { o, S, lag } = c;
  if (!eye) return;
  const gp = PAL[P_GOLD];
  const R = HI ? 5.3 : 2.5;
  const cx = eye.x + 0.5;
  const cy = eye.y + 0.5;
  const ink = INK_V[V];
  const n = Math.ceil(R + 2);
  for (let dy = -n; dy <= n; dy++)
    for (let dx = -n; dx <= n; dx++) {
      const X = eye.x + dx;
      const Y = eye.y + dy;
      const px = X + 0.5 - cx;
      const py = Y + 0.5 - cy;
      const d = Math.hypot(px, py);
      // Свет сверху-слева: оправа светлее там, темнее снизу-справа.
      const lit = (-px - py) / Math.max(1e-3, d * Math.SQRT2);
      if (Math.abs(d - R) <= (HI ? 0.75 : 0.62)) {
        const tone = Math.max(1, Math.min(gp.length - 1, Math.round(4.6 + 2.2 * lit)));
        p.set(X, Y, gp[tone]);
      } else if (HI && d > R + 0.75 && d <= R + 1.6) {
        if (p.get(X, Y)[3] > 200) p.set(X, Y, mixc(ink, gp[1], 0.25));
      } else if (d < R - 0.6) {
        if (p.get(X, Y)[3] < 200) continue;
        // Стекло: лёгкий голубой налёт и косой блик сверху-слева.
        const streak = HI ? Math.abs(px + py + R * 0.75) < 0.8 && d < R - 1.2 : false;
        p.set(X, Y, [GLASS[0], GLASS[1], GLASS[2], streak ? 150 : HI ? 46 : 40]);
      }
    }
  if (o.glint > 0.3) {
    const g = HI ? Math.round(1 + o.glint * 2.4) : o.glint > 0.6 ? 1 : 0;
    star(p, Math.round(cx - R * 0.6), Math.round(cy - R * 0.6), g, WHITE, gp[6]);
  }
  // Цепочка: от низа оправы снаружи провисает к шнурку на груди; качается за головой.
  const a0 = Math.PI * 0.32;
  const x0 = cx + Math.cos(a0) * (R + 0.4);
  const y0 = cy + Math.sin(a0) * (R + 0.4);
  const anchor = seen(f, mul(S.up([3.4, 7.2, 17.4]), RR), OX, OY, 4 * RR);
  if (!anchor) return;
  const sway = (lag.headX - S.head[0]) * 0.8 * RR;
  const sag = (HI ? 6 : 2.6) + Math.abs(anchor[0] - x0) * 0.15;
  const mx = (x0 + anchor[0]) / 2 + 2 * RR * 0.6 - sway;
  const my = Math.max(y0, anchor[1]) + sag;
  const N = Math.max(4, Math.round(Math.hypot(anchor[0] - x0, anchor[1] - y0) * 1.4));
  let prev: [number, number] | null = null;
  for (let s = 0; s <= N; s++) {
    const u = s / N;
    const v = 1 - u;
    const x = Math.round(v * v * x0 + 2 * u * v * mx + u * u * anchor[0]);
    const y = Math.round(v * v * y0 + 2 * u * v * my + u * u * anchor[1]);
    if (prev && prev[0] === x && prev[1] === y) continue;
    prev = [x, y];
    const link = HI ? Math.floor(s / 2) % 2 : s % 2;
    p.set(x, y, link ? gp[3] : gp[6]);
    if (HI && !link) p.set(x, y + 1, gp[2]);
  }
}

/** Скважина на передней грани замка. */
function keyhole(p: Px, f: Frame, c: Ctx): void {
  const { o } = c;
  if (o.lock < 0.5) return;
  const at = seen(f, mul(lockAt(o, HOLE), RR), OX, OY, 2.5 * RR);
  if (!at) return;
  const K = mixc(INK_V[0], PAL[P_BRASS][0], 0.3);
  if (HI) stamp(p, ['.KK.', 'KKKK', '.KK.', '.KK.', '.KK.'], { K }, at[0] - 1, at[1] - 2);
  else stamp(p, ['K', 'K'], { K }, at[0], at[1] - 1);
}

/** Сон: буквы «z» поднимаются над головой и тают. */
const Z_S = ['zzz', '.z.', 'zzz'];
const Z_L = ['zzzz', '..z.', '.z..', 'zzzz'];
function zzz(p: Px, mask: Uint8Array, c: Ctx): void {
  const { h, t } = c;
  for (let j = 0; j < 2; j++) {
    const u = wrap(t / 1.5 + j * 0.5, 1);
    const [sx, sy] = project(mul(h.at([3.5 + 3.5 * u, 0, 6 + 9 * u]), RR));
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
        p.set(X, Y, ZZ);
      }
  }
}

/** Блики и звёзды: ключ поднят, щелчок замка, добыча в ключах, удар клювом, звон связки. */
function sparkles(p: Px, f: Frame, c: Ctx, mask: Uint8Array): void {
  const { o, S, h } = c;
  const gp = PAL[P_GOLD];
  const px = (q: V3): [number, number] => {
    const [sx, sy] = project(mul(q, RR));
    return [Math.round(OX + sx), Math.round(OY + sy)];
  };
  if (o.hold && o.glint > 0.3) {
    const { hand } = armOf(c, 1);
    const tip = add(hand, mul(norm(dirFront(o.keyAng, 1, 0.1)), 5 * S.k));
    const [x, y] = px(tip);
    star(p, x, y, HI ? Math.round(1 + 3 * o.glint) : o.glint > 0.6 ? 2 : 1, WHITE, gp[6]);
  }
  if (o.flash > 0.2) {
    const [x, y] = px(lockAt(o, [0, 0, 5.4]));
    const L = Math.round((HI ? 5 : 2) * o.flash);
    star(p, x, y - Math.round(2 * RR), L, WHITE, gp[5]);
  }
  for (const j of [0, 1]) {
    const L = lootPos(c, j);
    if (!L) continue;
    const u = clamp01(o.loot - j * 0.08);
    if (u > 0.82 && u < 0.98) {
      const [x, y] = px(add(S.ring, [0, 2, 0]));
      star(p, x + (j ? 1 : -1) * Math.round(RR), y, HI ? 3 : 1, WHITE, j ? TOKEN[6] : gp[6]);
    }
  }
  // Замок исчез: пыль-искры разлетаются.
  if (o.lock > 0.02 && o.lock < 0.9) {
    const [x, y] = px(lockAt({ ...o, lock: 1 }, [0, 0, 3]));
    const r = Math.round((1 - o.lock) * (HI ? 9 : 4));
    for (let a = 0; a < 6; a++) {
      const an = (a / 6) * TAU + 0.3;
      p.set(
        x + Math.round(Math.cos(an) * r),
        y + Math.round(Math.sin(an) * r),
        a % 2 ? gp[6] : WHITE,
      );
    }
  }
  if (o.peck > 0.2) {
    const [x, y] = px(h.at([0, 8.8, -3.8]));
    const L = Math.round((HI ? 6 : 2) * o.peck);
    star(p, x, y + Math.round(RR), L, WHITE, hx('#ffe6a0'));
  }
  // Звон: короткие светлые чёрточки по бокам связки.
  const jg = Math.abs(o.jingle);
  if (jg > 0.45) {
    const [x, y] = px(add(S.ring, [0, 2, -2.5 * S.k]));
    const dx = Math.round((HI ? 9 : 5) + jg);
    const col = mixc(gp[6], WHITE, 0.5);
    for (const s of [-1, 1]) {
      const X = x + s * dx;
      if (mask[y * p.w + X]) continue;
      p.set(X, y, col);
      p.set(X + s, y - 1, col);
      if (HI) {
        p.set(X + s * 2, y - 2, col);
        p.set(X, y + 3, col);
        p.set(X + s, y + 3, col);
      }
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
  // Разовая к концу приходит в запаздывание покоя на кадре 0: стык без сдвига.
  const L0 = LOOP[a] ? null : lagOf('idle', 0);
  const P0 = poseAt('idle', 0);
  const S0 = skel(P0);
  const lagged = (fn: (tt: number) => number, freq: number, damp: number, off: number) => {
    const now = fn(t);
    return now + (spring(fn, t, t0, freq, damp) - now) * env + (L0 ? off * (1 - env) : 0);
  };
  const rgX = (tt: number) => sk(tt).ring[0] + P(tt).jingle * 1.4;
  const r: Lag = {
    headX: lagged((tt) => sk(tt).head[0], 3.0, 0.3, (L0?.headX ?? 0) - S0.head[0]),
    headZ: lagged((tt) => sk(tt).head[2], 3.0, 0.3, (L0?.headZ ?? 0) - S0.head[2]),
    thL: lagged((tt) => P(tt).thL, 4.0, 0.36, (L0?.thL ?? 0) - P0.thL),
    thR: lagged((tt) => P(tt).thR, 4.0, 0.36, (L0?.thR ?? 0) - P0.thR),
    rgX: lagged(rgX, 2.0, 0.14, (L0?.rgX ?? 0) - rgX(0) * 0 - S0.ring[0] - P0.jingle * 1.4),
    rgY: lagged((tt) => sk(tt).ring[1], 2.0, 0.16, (L0?.rgY ?? 0) - S0.ring[1]),
    rgZ: lagged((tt) => sk(tt).ring[2], 2.2, 0.18, (L0?.rgZ ?? 0) - S0.ring[2]),
    tailSw: lagged((tt) => P(tt).tailSw, 2.2, 0.26, (L0?.tailSw ?? 0) - P0.tailSw),
    tailUp: lagged((tt) => P(tt).tailUp, 2.4, 0.3, (L0?.tailUp ?? 0) - P0.tailUp),
  };
  LAGS.set(key, r);
  return r;
}

function toRes(parts: Part[]): Part[] {
  if (RR === 1) return parts;
  return parts.map((pt) => ({ ...pt, c: mul(pt.c, RR), r: mul(pt.r, RR) }));
}

/** Кадр `i` анимации `a` полосы `res`, вариант окраса `v` (0 — обычный, 1 — золотой). */
export function ravenFrame(a: Anim, i: number, res: Res = 's', v = 0): Px {
  const cv = RES[res];
  RR = cv.box / RES.s.box;
  HI = res === 'l';
  OX = cv.bx + cv.box / 2;
  OY = cv.by + GROUND * RR;
  V = v === 1 ? 1 : 0;
  PAL = PAL_V[V];
  NEXT_ID = 0;
  const t = i / FPS;
  const o = poseAt(a, t);
  const S = skel(o);
  const lag = lagOf(a, t);
  const c: Ctx = { o, S, h: headF(o, S), lag, t };
  const parts: Part[] = [];
  tail(parts, c);
  legs(parts, c);
  body(parts, c);
  hackles(parts, c);
  keyRing(parts, c);
  head(parts, c);
  crest(parts, c);
  wing(parts, c, -1);
  wing(parts, c, 1);
  heldKey(parts, c);
  lockParts(parts, c);
  lootParts(parts, c);
  // Перо темнее общего света рига: чёрный ворон, отлив — по верхним кромкам.
  for (const pt of parts)
    if (pt.pal === P_FEATH || pt.pal === P_WING) pt.bias = (pt.bias ?? 0) - PLUME_DARK[V];
  const f = newFrame(cv.cw, cv.ch);
  drawParts(f, toRes(parts), PAL, OX, OY);
  seams(f, 1.2 * RR, 1);
  rimLight(f, PAL, (pl) => pl !== P_MOUTH);
  // Второй кант по перу: чёрный силуэт не тонет на буром полу шахты.
  rimLight(f, PAL, (pl) => pl === P_FEATH || pl === P_WING);
  if (V === 0) coolRim(f);
  if (HI) softBands(f);
  const p = toPx(f, PAL);
  selOutline(p, INK_V[V], 0.8);
  const mask = new Uint8Array(p.w * p.h);
  for (let j = 0; j < mask.length; j++) mask[j] = p.data[j * 4 + 3] > 0 ? 1 : 0;
  keyhole(p, f, c);
  const ey = eyes(p, f, c);
  monocle(p, f, c, ey[1]);
  sparkles(p, f, c, mask);
  if (a === 'sleep') zzz(p, mask, c);
  return p;
}
