// Лис-картёжник — пиксельный питомец по эталону боссов 12–14.
//
// Рыжий лис сидит анфас, обернув лапы пышным хвостом: высокие уши с
// чёрными кончиками и кремовым пухом внутри, белые щёки торчат в стороны
// под хитрыми янтарными глазами (веки приспущены, зрачок — щель), рыжая
// переносица до самого носа, белая грудь, чёрные «носки». Бордовый жилет с
// латунными пуговицами и золотой цепочкой часов, туз червей заткнут за
// правое ухо (справа в кадре). Кончик хвоста белый.
//
// Две полосы, у каждой свой рисунок: малая — рамка 48 (шахта, списки),
// крупная — рамка 112 (карточка, вылупление, Питомник): пух в ушах, пряди
// щёк и хвоста, лацканы и карманы жилета, звенья цепочки и брелок, «A» и
// сердце на карте, щель зрачка, усы.
//
// Анимации 24 к/с по ключам (`kf`): подготовка → разгон → пик → проводка
// → возврат. Голова, хвост, цепочка и карта — с запаздыванием (`spring`).
// Трюк — напёрстки: ящик, три стаканчика, монетка под одним; лис тасует,
// останавливается, поднимает стаканчик — горка монет — и подмигивает.
//
// Золотой рисуется здесь же (`v` = 1) своими палитрами: мех — золото,
// тень — бронза, свет — бледное золото; жилет, карта и глаза читаются.

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
const P_SOCK = 2;
const P_VEST = 3;
const P_GOLD = 4;
const P_NOSE = 5;
const P_MOUTH = 6;
const P_BONE = 7;
// 8 — кожа в ушах (пух рисуется белым плоскостью; номер держит место в палитре).
const P_CARD = 9;
const P_TIN = 10;
const P_WOOD = 11;

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
const CARD = ramp('#5e584c', '#8e8676', '#bcb4a2', '#ddd6c6', '#f1ece0', '#fbf8f0', '#ffffff');
const TIN = ramp(
  '#2a2c2c',
  '#43464a',
  '#5e6266',
  '#7c8084',
  '#9a9ea0',
  '#b8bbbb',
  '#d4d6d4',
  '#ecedea',
);
const WOOD = ramp(
  '#1e1008',
  '#33200f',
  '#4a3018',
  '#644222',
  '#7e562e',
  '#9a6c3c',
  '#b4844c',
  '#cc9e64',
  '#e0ba82',
);
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

const PAL_V: RGBA[][][] = [
  [
    // Мех: бурая тень → рыжий → светлый абрикос на свету.
    ramp(
      '#240b04',
      '#3a1206',
      '#521a08',
      '#6c240a',
      '#88300c',
      '#a53e10',
      '#c04d14',
      '#d65e1a',
      '#e67226',
      '#f18a3a',
      '#f8a658',
      '#fdc584',
    ),
    // Белое: щёки, грудь, кончик хвоста, пух в ушах.
    ramp(
      '#4a3a34',
      '#6a564c',
      '#8c7768',
      '#ae9a88',
      '#cbb9a6',
      '#e0d2c0',
      '#efe5d6',
      '#f8f2e8',
      '#fffcf6',
    ),
    // Чёрные носки, лапы, кончики ушей.
    ramp('#080505', '#110b0a', '#1b1311', '#261b18', '#342520', '#46322a', '#5c4236'),
    // Бордовый жилет.
    ramp(
      '#1c050b',
      '#2e0912',
      '#430e1c',
      '#5a1526',
      '#721d31',
      '#8b273d',
      '#a4344b',
      '#bc495e',
      '#d26a7a',
    ),
    GOLD,
    // Нос.
    ramp('#070708', '#0f0e10', '#19171a', '#252226', '#353136', '#4a454c'),
    MOUTH,
    BONE,
    // Кожа в ушах.
    ramp('#3a2420', '#5a3630', '#7c4c42', '#a06a5c', '#c08c7c', '#dcb0a0'),
    CARD,
    TIN,
    WOOD,
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
    ramp('#120a04', '#1e1206', '#2c1a0a', '#3c240e', '#4e3014', '#623e1a', '#784e22'),
    ramp(
      '#1a0408',
      '#2c0610',
      '#420a1a',
      '#5a1024',
      '#741830',
      '#8e223c',
      '#a8304a',
      '#c0465c',
      '#d66678',
    ),
    GOLD,
    ramp('#0c0603', '#170c05', '#231308', '#311c0c', '#432812', '#5a381a'),
    MOUTH,
    BONE,
    ramp('#4a2a14', '#6c4020', '#90582c', '#b47640', '#d09658', '#e8b878'),
    CARD,
    TIN,
    WOOD,
  ],
];
const INK_V: RGBA[] = [hx('#0c0604'), hx('#1a0d02')];
const HEART: RGBA[] = [hx('#d8322a'), hx('#8e1a16')];
const BLUR = hx('#f4ead8', 170);

// ---------------------------------------------------------------------------
// Кадр: холст и рамка тела у двух полос (как у волка и дракона).
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

type Eye = 'open' | 'wide' | 'happy' | 'angry' | 'sleep' | 'shut' | 'wink';

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
  /** Пасть: 0 — закрыта, 1 — настежь; оскал; ухмылка (уголки вверх). */
  jaw: number;
  snarl: number;
  grin: number;
  tongue: number;
  /** Уши: 0 — торчком, 1 — прижаты назад, < 0 — насторожены вперёд; дёрнуть ухом. */
  earL: number;
  earR: number;
  flL: number;
  flR: number;
  /** Хвост: вбок (+ — наружу), вверх, кончик завивается вверх. */
  tailSw: number;
  tailUp: number;
  tailCurl: number;
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
  /** Свой глаз у каждой стороны (подмигнуть): `null` — как у обоих. */
  eyeL: Eye | null;
  eyeR: Eye | null;
  blink: number;
  /** Куда смотрят зрачки: −1 влево, +1 вправо. */
  look: number;
  /** Вдох: грудь раздувается. */
  chest: number;
  /** Напёрстки: видимость ящика, места трёх стаканчиков, поднят ли один. */
  game: number;
  c0: number;
  c1: number;
  c2: number;
  d0: number;
  d1: number;
  d2: number;
  lift: number;
  liftI: number;
  coin: number;
  pile: number;
  spark: number;
  /** Хватка: челюсти-дуги смыкаются (0…1), −1 — нет. */
  bite: number;
  /** Стоит (ходьба) и свернулся (сон): 0 — сидит. */
  stand: number;
  curl: number;
  scale: number;
}

/** Места стаканчиков на ящике (x малой полосы). */
const SLOT = [-7.0, 0, 7.0];

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
  jaw: 0,
  snarl: 0,
  grin: 0.35,
  tongue: 0,
  earL: 0,
  earR: 0,
  flL: 0,
  flR: 0,
  tailSw: 0,
  tailUp: 0,
  tailCurl: 0,
  fLx: 0,
  fRx: 0,
  fLy: 0,
  fRy: 0,
  fLz: 0,
  fRz: 0,
  hLz: 0,
  hRz: 0,
  eye: 'open',
  eyeL: null,
  eyeR: null,
  blink: 0,
  look: 0,
  chest: 0,
  game: 0,
  c0: SLOT[0],
  c1: SLOT[1],
  c2: SLOT[2],
  d0: 0,
  d1: 0,
  d2: 0,
  lift: 0,
  liftI: -1,
  coin: 0,
  pile: 0,
  spark: 0,
  bite: -1,
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
  // Хитрый взгляд вбок: сперва глаза, потом голова — и обратно.
  o.look = loopK(t, T, [
    [0, 0],
    [0.95, 0],
    [1.08, 1, 'o'],
    [1.85, 1],
    [2.02, 0, 's'],
    [3, 0],
  ]);
  o.turn = loopK(t, T, [
    [0, 0],
    [1.02, 0],
    [1.4, 0.16, 'o'],
    [1.8, 0.16],
    [2.2, 0],
    [3, 0],
  ]);
  o.tilt = -0.32 * o.turn;
  o.lean = 0.016 * Math.sin((t / T) * TAU);
  o.x = 0.2 * Math.sin((t / T) * TAU);
  // Уши дёргаются каждое в свою фазу; моргание — медленное, хитрое.
  o.flL = bump(t, 0.6, 0.72);
  o.flR = bump(t, 2.3, 2.42) + 0.6 * bump(t, 2.44, 2.54);
  o.blink = Math.max(bump(t, 0.32, 0.56), bump(t, 2.62, 2.74));
  // Кончик хвоста завивается вверх и опускается.
  o.tailCurl = loopK(t, T, [
    [0, 0],
    [1.3, 0],
    [1.75, 1, 's'],
    [2.05, 0.9],
    [2.6, 0, 's'],
    [3, 0],
  ]);
  o.tailSw = 0.12 * Math.sin((t / T) * TAU);
  return o;
}

function walkPose(t: number): Pose {
  const T = dur('walk');
  const o: Pose = { ...REST };
  const h = wrap(t, T);
  o.stand = 1;
  // Лёгкая рысь на зрителя: пары накрест.
  const la = bump(h, 0.02, 0.48);
  const lb = bump(h, 0.52, 0.98);
  o.fLz = 2.4 * la ** 0.8;
  o.fLy = 1.2 * la;
  o.hRz = 1.7 * la ** 0.8;
  o.fRz = 2.4 * lb ** 0.8;
  o.fRy = 1.2 * lb;
  o.hLz = 1.7 * lb ** 0.8;
  const sw = Math.sin((h / T) * TAU);
  o.x = 0.5 * sw;
  o.lean = 0.05 * sw;
  o.z = 0.6 * Math.abs(sw) - 0.15;
  o.nod = 0.06 + 0.05 * Math.cos((h / T) * 2 * TAU);
  o.tilt = -0.06 * sw;
  o.hx = -0.25 * sw;
  o.earL = -0.12;
  o.earR = -0.12;
  // Хвост — противовес: в сторону против корпуса.
  o.tailSw = -0.7 * sw;
  o.tailUp = 0.2;
  o.tailCurl = 0.3 + 0.2 * Math.cos((h / T) * TAU);
  return o;
}

function happyPose(t: number): Pose {
  const T = dur('happy');
  const o: Pose = { ...REST };
  // Два подскока, лапки к груди; хвост метёт; ухмылка до ушей.
  const rise = kf(t, [
    [0, 0],
    [0.1, -0.3, 'o'],
    [0.3, 1, 'o'],
    [0.42, 0.95],
    [0.56, -0.2, 'i'],
    [0.66, 0.55, 'o'],
    [0.76, 0.5],
    [0.88, -0.1, 'i'],
    [1.0, 0, 'o'],
    [T, 0],
  ]);
  const up = pos(rise);
  const env = 1 - clamp01((t - 0.86) / (T - 0.86));
  o.z = 2.2 * up;
  o.sq = -0.07 * rise;
  o.bow = -0.1 * up;
  o.fLz = 3.6 * up;
  o.fRz = 3.6 * up;
  o.fLy = -1.0 * up;
  o.fRy = -1.0 * up;
  o.fLx = 0.6 * up;
  o.fRx = -0.6 * up;
  o.nod = -0.12 * up;
  o.tilt = 0.16 * Math.sin((t / T) * TAU) * env;
  o.earL = -0.3 * env;
  o.earR = -0.3 * env;
  o.eye = t < 0.9 ? 'happy' : 'open';
  o.jaw = 0.3 * env;
  o.grin = lerp(REST.grin, 1, env);
  o.tongue = env;
  o.tailSw = 1.0 * Math.sin(TAU * 3.4 * t) * env;
  o.tailUp = 0.6 * env;
  o.tailCurl = 0.6 * env;
  return o;
}

/**
 * Напёрстки (2 с): ящик со стаканчиками → показал монетку под средним →
 * тасует три раза → стоп, взгляд на зрителя → поднял левый: горка монет,
 * искра → подмигнул с ухмылкой → ящик тает, лапы на место.
 */
const SW: [number, number, number, number][] = [
  // [начало, конец, стаканчик A, стаканчик B] — A и B меняются местами.
  [0.36, 0.56, 0, 1],
  [0.56, 0.76, 1, 2],
  [0.76, 0.98, 0, 2],
];
/** Где стоит каждый стаканчик (номер места) — после всех обменов до момента t. */
function cupsAt(t: number): { x: number[]; d: number[] } {
  const at = [0, 1, 2];
  const x = [SLOT[0], SLOT[1], SLOT[2]];
  const d = [0, 0, 0];
  for (const [t0, t1, a, b] of SW) {
    if (t <= t0) break;
    const u = clamp01((t - t0) / (t1 - t0));
    const e = u * u * (3 - 2 * u);
    const ia = at.indexOf(a);
    const ib = at.indexOf(b);
    if (u < 1) {
      // A проходит спереди, B — сзади.
      x[ia] = lerp(SLOT[a], SLOT[b], e);
      x[ib] = lerp(SLOT[b], SLOT[a], e);
      d[ia] = 1.8 * Math.sin(Math.PI * e);
      d[ib] = -1.8 * Math.sin(Math.PI * e);
    } else {
      at[ia] = b;
      at[ib] = a;
      x[ia] = SLOT[b];
      x[ib] = SLOT[a];
    }
  }
  return { x, d };
}

/** Лапа сидящего лиса в покое — для пересчёта цели в сдвиг. */
const PAW0: V3 = [3.5, 10.2, 5.6];
const CRATE_TOP = 8.4;
const CUP_H = 5.6;
const CUP_Y = 11.2;

function workPose(t: number): Pose {
  const o: Pose = { ...REST };
  o.game = kf(t, [
    [0, 0],
    [0.14, 1, 'l'],
    [1.8, 1],
    [1.96, 0, 'l'],
  ]);
  const { x, d } = cupsAt(t);
  // Стаканчики по номерам: 0 — тот, что стоял слева.
  o.c0 = x[0];
  o.c1 = x[1];
  o.c2 = x[2];
  o.d0 = d[0];
  o.d1 = d[1];
  o.d2 = d[2];
  // Показал монетку под средним (0,14–0,34) и в конце поднял стоящий слева.
  const showUp = bump(t, 0.12, 0.34);
  const endUp = kf(t, [
    [0, 0],
    [1.16, 0],
    [1.3, 1, 'o'],
    [1.62, 1],
    [1.76, 0, 's'],
  ]);
  const leftCup = x.indexOf(Math.min(...x));
  o.liftI = showUp > 0.01 ? 1 : endUp > 0.01 ? leftCup : -1;
  o.lift = showUp > 0.01 ? 3.2 * showUp : 4.0 * endUp;
  o.coin = showUp > 0.01 ? 1 : 0;
  o.pile = endUp > 0.01 ? 1 : 0;
  o.spark = bump(t, 1.28, 1.6);
  // Лапы: на стаканчиках, пока ящик есть. Левая — на левом краю тасовки, правая — на правом.
  const reach = kf(t, [
    [0, 0],
    [0.14, 1, 'o'],
    [1.74, 1],
    [1.94, 0, 's'],
  ]);
  const order = [0, 1, 2].sort((a, b) => x[a] - x[b]);
  // В тасовке лапы ведут ту пару, что меняется; иначе — крайние.
  let pl = order[0];
  let pr = order[2];
  for (const [t0, t1, a, b] of SW)
    if (t > t0 && t < t1) {
      pl = x[a] < x[b] ? a : b;
      pr = pl === a ? b : a;
    }
  if (showUp > 0.01) pr = 1;
  if (endUp > 0.01) pl = leftCup;
  const cupTop = (i: number) =>
    CRATE_TOP + CUP_H + 0.6 + (o.liftI === i ? o.lift : 0) + 0.5 * pos([d[0], d[1], d[2]][i]);
  const tgt = (i: number): V3 => [
    x[i] * G,
    (CUP_Y + [d[0], d[1], d[2]][i] * 0.6 - 0.4) * G,
    cupTop(i) * G,
  ];
  const L = tgt(pl);
  const R = tgt(pr);
  const G0 = G;
  o.fLx = (L[0] + PAW0[0] * G0) * reach;
  o.fLy = (L[1] - PAW0[1] * G0) * reach;
  o.fLz = (L[2] - PAW0[2] * G0) * reach;
  o.fRx = (R[0] - PAW0[0] * G0) * reach;
  o.fRy = (R[1] - PAW0[1] * G0) * reach;
  o.fRz = (R[2] - PAW0[2] * G0) * reach;
  // Голова: смотрит на стаканчики, следит за ними; стоп — взгляд на зрителя;
  // горка — глянул на неё; подмигнул.
  const down = kf(t, [
    [0, 0],
    [0.16, 1, 'o'],
    [0.98, 1],
    [1.1, 0, 's'],
    [1.26, 0],
    [1.36, 0.7, 'o'],
    [1.48, 0.6],
    [1.58, 0, 's'],
  ]);
  o.nod = 0.2 * down;
  o.hz = -0.2 * down;
  o.hy = 0.3 * down;
  o.bow = 0.05 * down;
  const follow = (x[pl] + x[pr]) / 2 / 7;
  o.look = clamp01(Math.abs(follow)) * Math.sign(follow) * (t < 1.0 ? 1 : 0);
  o.turn = 0.1 * o.look * (t < 1.0 ? 1 : 0) - 0.14 * bump(t, 1.28, 1.6);
  o.tilt = 0.08 * Math.sin(t * TAU * 2.5) * bump(t, 0.36, 0.98) + 0.14 * bump(t, 1.56, 1.9);
  o.eye = 'open';
  if (t >= 1.3 && t < 1.56) o.look = -1;
  if (t >= 1.58 && t < 1.86) o.eyeR = 'wink';
  o.grin =
    REST.grin +
    bump(t, 1.04, 1.24) * 0.4 +
    0.65 *
      kf(t, [
        [0, 0],
        [1.54, 0],
        [1.62, 1, 'o'],
        [1.84, 1],
        [1.98, 0, 's'],
      ]);
  o.jaw = 0.14 * bump(t, 1.56, 1.92);
  o.earL = -0.25 * down + 0.15 * bump(t, 0.4, 0.9);
  o.earR = -0.25 * down;
  o.flR = bump(t, 1.6, 1.72);
  o.tailSw = 0.25 * Math.sin(t * TAU * 1.5) * (1 - clamp01((t - 1.6) / 0.4));
  o.tailCurl = 0.6 * bump(t, 1.2, 1.96);
  o.chest = 0.5 * bump(t, 1.0, 1.4);
  // Ящик растаял — реквизит на места покоя (стаканчики после обменов стоят иначе).
  if (o.game < 0.01) {
    o.c0 = REST.c0;
    o.c1 = REST.c1;
    o.c2 = REST.c2;
    o.d0 = o.d1 = o.d2 = 0;
    o.liftI = -1;
    o.lift = 0;
    o.coin = 0;
    o.pile = 0;
  }
  return o;
}

function attackPose(t: number): Pose {
  const T = dur('attack');
  const o: Pose = { ...REST };
  // Присел, уши торчком, зад виляет (лис «мышкует») → бросок к зрителю,
  // морда на зрителя, пасть настежь (кадры 8–11) → хватка, приземлился,
  // встряхнул головой → покой.
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
  o.y = 3.6 * pos(l) - 0.8 * neg(l);
  o.scale = 1 + 0.2 * pos(l);
  o.sq = 0.12 * neg(l) - 0.05 * air + 0.08 * bump(t, 0.55, 0.7);
  o.z = -0.6 * neg(l) + 2.2 * air;
  o.bow = 0.1 * neg(l) + 0.04 * pos(l);
  o.nod = 0.2 * neg(l) - 0.3 * pos(l);
  o.hy = 1.6 * pos(l) - 0.4 * neg(l);
  o.hz = 0.4 * pos(l) - 0.9 * neg(l);
  o.x = 0.35 * Math.sin(t * TAU * 9) * bump(t, 0.04, 0.27);
  o.jaw = kf(t, [
    [0, 0],
    [0.24, 0.1],
    [0.3, 0.14],
    [0.36, 1, 'o'],
    [0.46, 1],
    [0.51, 0.1, 'i'],
    [0.6, 0.2],
    [0.72, 0, 's'],
  ]);
  o.snarl = kf(t, [
    [0, 0],
    [0.16, 1, 'o'],
    [0.54, 1],
    [0.8, 0, 's'],
  ]);
  o.grin = REST.grin * (1 - bump(t, 0, T));
  // Уши: в засаде насторожены вперёд, в броске прижаты.
  const ears = kf(t, [
    [0, 0],
    [0.14, -0.35, 'o'],
    [0.28, -0.3],
    [0.36, 0.7, 'o'],
    [0.56, 0.7],
    [0.86, 0, 's'],
  ]);
  o.earL = ears;
  o.earR = ears;
  o.eye = t < 0.7 ? 'angry' : 'open';
  // Встряхнул добычу после хватки.
  o.turn = 0.2 * Math.sin(((t - 0.5) / 0.17) * TAU) * bump(t, 0.5, 0.76);
  o.fLz = 3.2 * air + 0.8 * bump(t, 0.1, 0.28);
  o.fRz = 3.2 * air + 0.8 * bump(t, 0.1, 0.28);
  o.fLy = 2.4 * air;
  o.fRy = 2.4 * air;
  o.fLx = -0.6 * air;
  o.fRx = 0.6 * air;
  o.tailSw = 0.5 * Math.sin(t * TAU * 9) * bump(t, 0.04, 0.27) + 0.4 * bump(t, 0.4, 0.86);
  o.tailUp = 0.7 * bump(t, 0.1, 0.8);
  o.tailCurl = 0.5 * bump(t, 0.3, 0.8);
  o.bite = t >= 0.35 && t < 0.56 ? (t - 0.35) / 0.21 : -1;
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
  o.tilt = 0.18;
  o.hz = 0.3 * br;
  o.sq = -0.06 * br;
  o.tailSw = 0.06 * br;
  o.earL = 0.6;
  o.earR = 0.6;
  // Во сне дёрнул ухом.
  o.flL = 0.6 * bump(t, 2.1, 2.24);
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
const SIT: Plan = {
  body: [0, -0.6, 10.6],
  bodyR: [6.8, 5.2, 9.4],
  neck: [0, 0.6, 19.4],
  neckR: [4.4, 3.8, 4.4],
  head: [0, 2.4, 26.0],
  sh: [3.8, 3.4, 14.4],
  paw: PAW0,
  haunch: [6.0, -1.6, 5.0],
  haunchR: [3.8, 5.2, 4.8],
  hpaw: [8.4, 4.0, 1.0],
  // Хвост обнимает лапы: из-за правого бедра вокруг перёд налево, кончик вверх.
  tail: [
    [6.4, -2.0, 2.4],
    [8.4, 3.2, 2.5],
    [5.6, 8.6, 2.7],
    [0.0, 10.6, 2.9],
    [-5.4, 9.4, 3.2],
    [-9.0, 6.0, 4.2],
    [-10.4, 2.4, 6.4],
    [-9.6, -0.2, 9.0],
  ],
};
const STAND: Plan = {
  body: [0, -6.0, 13.6],
  bodyR: [5.0, 10.0, 5.2],
  neck: [0, 1.6, 18.4],
  neckR: [4.0, 3.6, 4.2],
  head: [0, 4.8, 24.4],
  sh: [3.4, 3.0, 13.2],
  paw: [3.6, 4.4, 1.0],
  haunch: [4.2, -13.5, 12.6],
  haunchR: [3.2, 4.6, 4.6],
  hpaw: [4.0, -12.4, 1.0],
  // Хвост — противовес: назад и влево, кончик выглядывает сбоку.
  tail: [
    [0, -15.5, 14.0],
    [-1.4, -17.6, 13.4],
    [-3.2, -19.2, 12.0],
    [-5.0, -20.0, 10.4],
    [-6.6, -20.2, 8.8],
    [-7.8, -19.8, 7.4],
    [-8.6, -19.0, 6.4],
    [-9.0, -18.0, 5.6],
  ],
};
const CURL: Plan = {
  body: [0, -2.4, 5.0],
  bodyR: [9.2, 7.4, 5.0],
  neck: [0, 2.4, 7.8],
  neckR: [4.6, 4.0, 3.8],
  head: [0.6, 6.4, 8.6],
  sh: [3.0, 6.0, 4.0],
  paw: [2.8, 11.0, 1.0],
  haunch: [7.4, -3.0, 4.4],
  haunchR: [4.4, 5.8, 4.2],
  hpaw: [9.6, 4.4, 1.0],
  // Хвост вокруг, кончиком на нос.
  tail: [
    [6.6, -5.0, 2.4],
    [11.0, 0.2, 2.5],
    [10.4, 7.6, 2.6],
    [6.4, 13.0, 2.7],
    [0.6, 15.6, 2.8],
    [-4.4, 15.4, 3.2],
    [-7.4, 12.8, 3.8],
    [-8.0, 9.8, 4.6],
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
  pawL: V3;
  pawR: V3;
  hpL: V3;
  hpR: V3;
  /** Оси и радиусы туловища (жилет, пуговицы, цепочка). */
  bc: V3;
  bax: [V3, V3, V3];
  br: V3;
  k: number;
}

/** Масштаб модели в рамке: лапы — кончики ушей ~44 пикселя малой полосы. */
const G = 0.98;

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
    side * pl.hpaw[0] * s,
    pl.hpaw[1] * s + o.y * 0.3,
    pl.hpaw[2] * s + dz + lift * 0.3,
  ];
  const ch = o.chest;
  return {
    up,
    pl,
    head: up(add(pl.head, [o.hx, o.hy, o.hz])),
    shL: up([-pl.sh[0], pl.sh[1], pl.sh[2]]),
    shR: up([pl.sh[0], pl.sh[1], pl.sh[2]]),
    pawL: paw(-1, o.fLx, o.fLy, o.fLz),
    pawR: paw(1, o.fRx, o.fRy, o.fRz),
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

// ---------------------------------------------------------------------------
// Узоры.
// ---------------------------------------------------------------------------

/**
 * Пучки шерсти черепицей (ось 3 — вверх): каждый пучок — острый кончик
 * вниз, светлый верх слева, тёмный клин под кончиком. Ряды сдвинуты.
 */
function tufts(rows: number, cols: number, amp: number, top = 1) {
  return (qx: number, qy: number, qz: number) => {
    const v = (top - qz) * rows * 0.5;
    if (v < 0) return 0;
    const row = Math.floor(v);
    const fv = v - row;
    const u = (Math.atan2(qx, qy) / Math.PI) * cols + (row & 1) * 0.5;
    const fu = u - Math.floor(u);
    const d = Math.abs(fu - 0.5) * 2;
    const edge = 1 - 0.6 * d;
    if (fv > edge) return fv - edge < 0.22 ? -amp : -amp * 0.55;
    if (fv < 0.3 && fu < 0.5) return amp * 0.45;
    return 0;
  };
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

interface Lag {
  headX: number;
  headZ: number;
  tailSw: number;
  tailUp: number;
  tailCurl: number;
  /** Цепочка часов: провис отстаёт от туловища. */
  chX: number;
  chZ: number;
  /** Карта за ухом качается за головой. */
  card: number;
}

interface Ctx {
  o: Pose;
  S: Skel;
  h: HeadF;
  lag: Lag;
  t: number;
}

/** Часть с выбором палитры по точке на ней (жилет, белая грудь). */
interface PartF extends Part {
  pick?: (qx: number, qy: number, qz: number) => number;
  /** Свет как у трубы: нормаль без составляющей вдоль оси — звенья хвоста не «бусы». */
  tube?: boolean;
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

let NEXT_ID = 0;
const nid = () => ++NEXT_ID;
let CARD_ID = -1;

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
function lock(
  out: PartF[],
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

function legs(out: PartF[], c: Ctx): void {
  const { o, S } = c;
  const k = S.k;
  const pl = S.pl;
  for (const side of [-1, 1] as const) {
    // Бедро: круглое, рыжее, светлее сверху.
    const hc = S.up([side * pl.haunch[0], pl.haunch[1], pl.haunch[2]]);
    out.push({
      c: hc,
      ax: axes(rollY([1, 0, 0], side * 0.22 + o.lean), [0, 0, 1]),
      r: mul(pl.haunchR, k),
      pal: P_FUR,
      id: nid(),
      bias: -0.02,
      tex: HI ? tufts(5, 3.2, 0.08, 0.9) : undefined,
    });
    const hp = side < 0 ? S.hpL : S.hpR;
    if (o.stand > 0.05) {
      const knee = add(lerp3(hc, hp, 0.5), [0, -1.4 * k, 0]);
      const lid = nid();
      limb(out, add(hc, [0, 0, -2.2 * k]), knee, 1.8 * k, 2.0 * k, P_FUR, lid, { bias: -0.06 });
      limb(out, knee, hp, 1.3 * k, 1.4 * k, P_SOCK, lid, { bias: 0.1 });
    }
    // Задняя ступня — чёрная.
    out.push({
      c: add(hp, [0, 0.4 * k, 0.25 * k]),
      ax: axes(norm([side * 0.3 * (1 - o.stand), 1, 0]), [0, 0, 1]),
      r: [2.6 * k, 1.8 * k, 1.2 * k],
      pal: P_SOCK,
      id: nid(),
      bias: 0.1,
      tex: toes(HI ? 4 : 2),
    });
    // Передняя лапа: рыжее плечо → чёрный «носок» от локтя → лапка.
    const sh = side < 0 ? S.shL : S.shR;
    const paw = side < 0 ? S.pawL : S.pawR;
    const lift = Math.max(0, (side < 0 ? o.fLz : o.fRz) - Math.max(0, o.z));
    const elbow = add(lerp3(sh, paw, 0.5), [side * 0.25 * k, (0.3 + lift * 0.1) * k, 0]);
    const lid = nid();
    limb(out, sh, elbow, 1.75 * k, 1.9 * k, P_FUR, lid, { bias: 0.04 });
    limb(out, elbow, paw, 1.4 * k, 1.5 * k, P_SOCK, lid, { bias: 0.12 });
    out.push({
      c: add(paw, [0, 0.4 * k, 0.2 * k]),
      ax: axes(norm([side * 0.06, 1, -lift * 0.1]), [0, 0, 1]),
      r: [2.0 * k, 1.75 * k, 1.15 * k],
      pal: P_SOCK,
      id: lid,
      bias: 0.16,
      tex: toes(HI ? 4 : 2),
    });
  }
}

/**
 * Туловище в жилете: бордовый спереди и по бокам, в вырезе — белая грудь,
 * над жилетом — рыжие плечи; лацканы светлее, кромка выреза темнее;
 * снизу — уголки полочек; на крупной — карманы и ткань в рубчик.
 */
function vestPick(qx: number, qy: number, qz: number): number {
  PICK_T = 0;
  const ax0 = Math.abs(qx);
  if (qz > 0.6) {
    if (qy > 0.25 && ax0 < 0.48) return P_PALE;
    return P_FUR;
  }
  // Низ жилета: уголки полочек спереди ниже, чем сбоку.
  const hem = -0.62 - 0.16 * clamp01(1 - ax0 / 0.5) * (qy > 0 ? 1 : 0);
  if (qz < hem) return P_FUR;
  if (qy > 0) {
    // Вырез: от верхней пуговицы буквой V вверх.
    const hw = 0.03 + 0.42 * clamp01((qz + 0.04) / 0.64) ** 1.3;
    if (qz > -0.04 && ax0 < hw) {
      PICK_T = HI && (qx * 9 + qz * 3 + 10) % 1 < 0.14 && qz < 0.45 ? -0.05 : 0;
      return P_PALE;
    }
    if (qz > -0.04 && ax0 < hw + (HI ? 0.13 : 0.16)) {
      PICK_T = ax0 < hw + 0.04 ? -0.12 : 0.14;
      return P_VEST;
    }
    if (qz < hem + 0.07) PICK_T = 0.1;
    if (HI) {
      // Карманы-«листочки».
      if (Math.abs(qz + 0.32) < 0.035 && ax0 > 0.3 && ax0 < 0.6) PICK_T = -0.26;
      else if ((qx * 14 + qz * 14 + 40) % 1 < 0.18) PICK_T += -0.05;
    }
  }
  return P_VEST;
}

function torso(out: PartF[], c: Ctx): void {
  const { o, S } = c;
  out.push({
    c: S.bc,
    ax: S.bax,
    r: S.br,
    pal: P_VEST,
    id: nid(),
    bias: -0.02,
    pick: vestPick,
  });
  // Шея: белое горло спереди (продолжение щёк), рыжий загривок.
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
    pick: (qx, qy, qz) => {
      PICK_T = 0;
      if (qy > 0.05 && Math.abs(qx) < 0.82 - 0.3 * qz) {
        if (HI) PICK_T = tufts(5, 4, 0.08, 1.05)(qx, qy, qz);
        return P_PALE;
      }
      return P_FUR;
    },
  });
  // Латунные пуговицы под вырезом.
  const btn = HI ? [-0.14, -0.34, -0.54] : [-0.2, -0.5];
  for (const qz of btn) {
    out.push({
      c: torsoAt(S, 0, qz, 1.0),
      ax: S.bax,
      r: [(HI ? 0.5 : 0.6) * k, 0.45 * k, (HI ? 0.5 : 0.55) * k],
      pal: P_GOLD,
      id: nid(),
      bias: 0.12,
      noSeam: true,
    });
  }
}

function tail(out: PartF[], c: Ctx): void {
  const { o, S, lag } = c;
  const k = S.k;
  const pl = S.pl;
  const root = pl.tail[0];
  const n = pl.tail.length;
  const sw = lag.tailSw;
  const upA = lag.tailUp;
  const cu = lag.tailCurl;
  const pts = pl.tail.map((p, i) => {
    const u = i / (n - 1);
    let q = sub(p, root);
    q = rollY(q, -sw * 0.35 * u * (1 - o.curl));
    q = [q[0] + sw * 2.0 * u * u * (1 - o.curl), q[1], q[2] + upA * 2.6 * u * u];
    return add(root, q);
  });
  // Кончик завивается вверх: последние точки поворачиваются вокруг предпоследней.
  if (cu > 0.01) {
    const piv = pts[n - 3];
    for (let i = n - 2; i < n; i++) {
      const d = sub(pts[i], piv);
      const a = cu * (i === n - 1 ? 0.9 : 0.45);
      // Поворот в вертикальной плоскости хода: вверх и внутрь (к телу).
      const hor = norm([d[0], d[1], 0]);
      const L = Math.hypot(d[0], d[1]);
      const nh = L * Math.cos(a) - d[2] * Math.sin(a);
      const nz = L * Math.sin(a) + d[2] * Math.cos(a);
      pts[i] = add(piv, [hor[0] * nh, hor[1] * nh, nz]);
    }
  }
  const wp = pts.map((p) => S.up(p));
  // Пышный хвост: толще к середине, к кончику сужается; кончик белый.
  const wid = [1.4, 2.2, 2.9, 3.3, 3.5, 3.5, 3.2, 2.2];
  const segs = HI ? 14 : 10;
  const id = nid();
  for (let i = 0; i < segs; i++) {
    const u0 = i / segs;
    const u1 = (i + 1) / segs;
    const p0 = catmull(wp, u0);
    const p1 = catmull(wp, u1);
    const d = sub(p1, p0);
    const len = Math.hypot(d[0], d[1], d[2]);
    if (len < 1e-4) continue;
    const um = (u0 + u1) / 2;
    const w = profile(wid, um) * k;
    const tip = um > 0.8;
    out.push({
      c: mul(add(p0, p1), 0.5),
      ax: axes(d, [0, 0, 1]),
      r: [len * 1.1 + 0.6 * k, w, w * 0.88],
      pal: tip ? P_PALE : P_FUR,
      id,
      bias: tip ? -0.02 : 0.02,
      tex: HI ? tailTex(i) : undefined,
      tube: true,
    });
  }
  // Пряди по верху хвоста — пышность, острия к кончику.
  const nl = HI ? 5 : 3;
  for (let j = 0; j < nl; j++) {
    const u = lerp(0.3, 0.78, j / (nl - 1));
    const p = catmull(wp, u);
    const tg = norm(sub(catmull(wp, Math.min(1, u + 0.05)), catmull(wp, Math.max(0, u - 0.05))));
    const upN = norm(sub([0, 0, 1], mul(tg, tg[2])));
    const dir = norm(add(tg, mul(upN, 0.3)));
    const w = profile([2.2, 3.0, 3.2, 3.2, 3.0, 2.4], u) * k;
    lock(
      out,
      add(p, mul(upN, 0.35 * k)),
      dir,
      upN,
      (HI ? 5.2 : 5.6) * k,
      w * 0.9,
      w * 0.7,
      u > 0.78 ? P_PALE : P_FUR,
      0.06 - j * 0.01,
    );
  }
  // Белый кончик кистью.
  const tp = catmull(wp, 0.9);
  const tdir = norm(sub(catmull(wp, 1), catmull(wp, 0.82)));
  lock(out, tp, tdir, [0, 0, 1], 4.0 * k, 2.2 * k, 2.0 * k, P_PALE, 0.04);
}

/** Хвост на крупной: пряди вдоль хвоста — тёмные бороздки, светлый верх. */
function tailTex(seg: number) {
  return (qx: number, qy: number, qz: number) => {
    const a = Math.atan2(qy, qz) / Math.PI;
    const f = (a * 5 + qx * 0.35 + seg * 0.37 + 20) % 1;
    if (f < 0.16) return -0.09;
    if (f > 0.55 && f < 0.66 && qz > 0.2) return 0.06;
    return 0;
  };
}

/** Узор черепа: светлая переносица между глаз, темнее к макушке, штрихи шерсти. */
function skullTex(qx: number, qy: number, qz: number): number {
  if (qy < 0) return qz > 0.5 ? -0.06 : -0.03;
  const ax0 = Math.abs(qx);
  if (ax0 < 0.16 && qz > -0.25 && qz < 0.45) return 0.07;
  if (qz > 0.66) return -0.05;
  if (HI && qz > 0.2 && ax0 > 0.22 && (qx * 7 + (qz > 0.5 ? 0.5 : 0) + 10) % 1 < 0.2) return 0.07;
  return 0;
}

function headParts(out: PartF[], flats: Flat[], c: Ctx): void {
  const { o, h } = c;
  const k = h.k;
  const ex = h.dir([1, 0, 0]);
  const ey = h.dir([0, 1, 0]);
  const ez = h.dir([0, 0, 1]);
  const hax = axes(ex, ez);
  out.push({
    c: h.at([0, 0, 0.8]),
    ax: hax,
    r: [4.5 * k, 4.0 * k, 4.2 * k],
    pal: P_FUR,
    id: nid(),
    bias: 0.04,
    tex: skullTex,
  });
  for (const side of [-1, 1]) {
    // Рыжая скула над белой щекой.
    out.push({
      c: h.at([side * 3.5, 1.2, 0.1]),
      ax: hax,
      r: [2.3 * k, 2.2 * k, 2.3 * k],
      pal: P_FUR,
      id: nid(),
      bias: 0.06,
    });
    // Белая щека и пряди — торчат в стороны и вниз под глазами.
    out.push({
      c: h.at([side * 2.9, 2.2, -1.7]),
      ax: hax,
      r: [2.4 * k, 2.1 * k, 1.7 * k],
      pal: P_PALE,
      id: nid(),
      bias: -0.04,
    });
    for (const [cx, cy, cz, len, wd, dx, dz] of [
      [3.9, 1.1, -1.2, 3.2, 1.9, 1, -0.28],
      [3.4, 1.6, -2.3, 2.6, 1.6, 1, -0.62],
      ...(HI ? [[4.2, 0.5, -0.2, 2.4, 1.4, 1, -0.05]] : []),
    ] as number[][]) {
      lock(
        out,
        h.at([side * cx, cy, cz]),
        h.dir(norm([side * dx, 0.1, dz])),
        ey,
        len * k,
        wd * k,
        1.3 * k,
        P_PALE,
        0.04,
        undefined,
      );
    }
  }
  // Морда: узкая, рыжая переносица до самого носа; по бокам — тёмная «слеза».
  const sid = nid();
  const sn = o.snarl;
  const max = axes(h.dir(pitchX([1, 0, 0], 0.32)), h.dir(pitchX([0, 0, 1], 0.32)));
  out.push({
    c: h.at([0, 4.7, -1.2]),
    ax: max,
    r: [1.6 * k, 3.4 * k, 1.45 * k],
    pal: P_FUR,
    id: sid,
    bias: 0.08,
    tex: (qx, qy, qz) => {
      if (Math.abs(qx) > 0.55 && qz > -0.3 && qy < 0.5) return -0.2;
      if (sn > 0.2 && qz > 0.2 && qy > 0.1 && (qy * (HI ? 6 : 3)) % 1 < 0.25) return -0.18 * sn;
      return 0;
    },
  });
  // Белые губы по бокам морды; в оскале губа поднята.
  for (const side of [-1, 1]) {
    out.push({
      c: h.at([side * 1.0, 5.0, -2.35 + 0.3 * sn + 0.15 * o.grin]),
      ax: max,
      r: [1.15 * k, 2.5 * k, 0.95 * k],
      pal: P_PALE,
      id: sid,
      bias: -0.02,
    });
  }
  // Чёрный нос на кончике.
  out.push({
    c: h.at([0, 7.7, -2.0]),
    ax: max,
    r: [1.05 * k, 0.8 * k, 0.85 * k],
    pal: P_NOSE,
    id: nid(),
    bias: 0.08,
    noSeam: true,
  });
  // Нижняя челюсть.
  const jw = o.jaw;
  const piv: V3 = [0, 1.4, -3.0];
  const ja = jw * 0.7;
  const jd = (p: V3): V3 => add(piv, pitchX(sub(p, piv), ja));
  const jax = axes(h.dir(pitchX([1, 0, 0], ja + 0.2)), h.dir(pitchX([0, 0, 1], ja + 0.2)));
  out.push({
    c: h.at(jd([0, 4.6, -3.2])),
    ax: jax,
    r: [1.35 * k, 2.4 * k, 0.8 * k],
    pal: P_PALE,
    id: nid(),
    bias: -0.12,
  });
  if (jw > 0.05 || sn > 0.3) {
    out.push({
      c: h.at([0, 5.0, -2.95 - jw * 0.5]),
      ax: max,
      r: [1.45 * k, 2.4 * k, (0.4 + jw * 0.95) * k],
      pal: P_MOUTH,
      id: nid(),
      bias: -0.2,
      noSeam: true,
    });
    out.push({
      c: h.at(jd([0, 5.1, -3.0])),
      ax: jax,
      r: [1.0 * k, 2.0 * k, 0.45 * k],
      pal: P_MOUTH,
      id: nid(),
      bias: sn > 0.3 ? -0.06 : 0.22,
      noSeam: true,
    });
  }
  if (o.tongue > 0.05 && jw > 0.1) {
    out.push({
      c: h.at(jd([0.2, 6.0, -3.9 - 0.5 * o.tongue])),
      ax: axes(h.dir(pitchX([1, 0, 0], ja)), h.dir(pitchX([0, 0.5, 1], ja))),
      r: [0.85 * k, 1.0 * k, (0.7 + 0.5 * o.tongue) * k],
      pal: P_MOUTH,
      id: nid(),
      bias: 0.3,
      noSeam: true,
    });
  }
  // Клыки: верхние — вниз, нижние — вверх, когда пасть открыта.
  if (jw > 0.25 || sn > 0.2) {
    for (const side of [-1, 1]) {
      out.push({
        c: h.at([side * 0.8, 7.55, -3.3 - 0.25 * o.jaw + 0.15 * sn]),
        ax: axes(h.dir([0, 0.12, -1]), ey),
        r: [(HI ? 0.85 : 1.2) * k, (HI ? 0.38 : 0.45) * k, (HI ? 0.38 : 0.45) * k],
        pal: P_BONE,
        id: nid(),
        bias: 0.1,
        noSeam: true,
      });
      if (jw > 0.3) {
        out.push({
          c: h.at(jd([side * 0.75, 5.8, -3.25])),
          ax: axes(h.dir(pitchX([0, 0.1, 1], ja)), ey),
          r: [(HI ? 0.75 : 1.0) * k, (HI ? 0.34 : 0.42) * k, 0.36 * k],
          pal: P_BONE,
          id: nid(),
          bias: 0.05,
          noSeam: true,
        });
      }
    }
  }
  ears(flats, c);
}

/** Уши: высокие треугольники — рыжие, с чёрным кончиком, внутри кремовый пух; за правым — туз. */
function ears(flats: Flat[], c: Ctx): void {
  const { o, h, lag } = c;
  for (const side of [-1, 1] as const) {
    const back = side < 0 ? o.earL : o.earR;
    const fl = side < 0 ? o.flL : o.flR;
    const base: V3 = [side * 3.0, -0.6, 3.4];
    const rot = (p: V3): V3 => {
      let q = sub(p, base);
      q = pitchX(q, -0.95 * back - 0.4 * fl);
      q = rollY(q, side * (0.14 + 0.5 * fl + 0.3 * Math.max(0, back)));
      return h.at(add(q, base));
    };
    const bin: V3 = [side * 0.9, -0.3, 4.5];
    const bout: V3 = [side * 6.0, -0.3, 1.5];
    const tip: V3 = [side * 4.6, -0.9, 12.8];
    flats.push({
      pts: [bin, tip, bout].map(rot),
      apex: rot(tip),
      a: rot(bin),
      b: rot(bout),
      pal: P_FUR,
      id: nid(),
      shade: (u, r) => -0.1 * (1 - r) - (u < 0.08 || u > 0.92 ? 0.1 : 0) + 0.08,
    });
    // Внутри — кремовый пух, глубже к кончику темнеет.
    const lift: V3 = [0, 0.35, 0];
    const iTip = add(lerp3(tip, mul(add(bin, bout), 0.5), 0.3), lift);
    const iIn = add(lerp3(bin, bout, 0.24), [0, 0.35, 0.6]);
    const iOut = add(lerp3(bin, bout, 0.76), [0, 0.35, 0.4]);
    flats.push({
      pts: [iIn, iTip, iOut].map(rot),
      apex: rot(iTip),
      a: rot(iIn),
      b: rot(iOut),
      pal: P_PALE,
      id: nid(),
      shade: (u, r) =>
        -0.42 * (1 - r) ** 1.5 +
        0.02 -
        (HI && r > 0.35 && r < 0.85 && Math.abs(((u * 5 + r * 1.5) % 1) - 0.5) < 0.1 ? 0.12 : 0),
    });
    // Чёрный кончик — по краю спинки уха.
    const tk = 0.4;
    const t1 = add(tip, [0, 0.5, 0]);
    flats.push({
      pts: [t1, add(lerp3(tip, bout, tk), [0, 0.5, 0]), add(lerp3(tip, bin, tk), [0, 0.5, 0])].map(
        rot,
      ),
      apex: rot(t1),
      a: rot(add(lerp3(tip, bin, tk), [0, 0.5, 0])),
      b: rot(add(lerp3(tip, bout, tk), [0, 0.5, 0])),
      pal: P_SOCK,
      id: nid(),
      shade: (_u, r) => 0.1 + 0.15 * (1 - r),
    });
    if (side > 0) {
      // Туз червей за ухом: торчит наружу-вверх из-за кромки, качается за головой.
      const cc: V3 = [6.0, -1.5, 6.2];
      const a0 = 0.38 + lag.card;
      const cw = 1.75;
      const chh = 2.4;
      const corner = (sx: number, sz: number): V3 =>
        rot(add(cc, rollY([sx * cw, 0, sz * chh], a0)));
      const p0 = corner(-1, -1);
      const p1 = corner(1, -1);
      const p2 = corner(1, 1);
      const p3 = corner(-1, 1);
      CARD_ID = nid();
      flats.push({
        pts: [p0, p1, p2, p3],
        apex: p0,
        a: p1,
        b: p3,
        pal: P_CARD,
        id: CARD_ID,
        shade: () => 0.25,
      });
      CARD_AX = [p0, sub(p1, p0), sub(p3, p0)];
    }
  }
}
/** Карта: угол и две кромки (для узора поверх). */
let CARD_AX: [V3, V3, V3] | null = null;

// ---------------------------------------------------------------------------
// Свой растр: части с выбором палитры, плоские части, ящик и стаканчики.
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
        const ax1 = pt.tube ? 0 : qx / r1;
        const nx = e1[0] * ax1 + (e2[0] * qy) / r2 + (e3[0] * qz) / r3;
        const ny = e1[1] * ax1 + (e2[1] * qy) / r2 + (e3[1] * qz) / r3;
        const nz = e1[2] * ax1 + (e2[2] * qy) / r2 + (e3[2] * qz) / r3;
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

/**
 * Грань ящика: параллелограмм O + s·E1 + t·E2 (s, t ∈ [0, 1]), глубина по
 * плоскости, тон — `tone(s, t)` (номер ступени). `vis` — шахматка проявления.
 */
function quad(
  f: Frame,
  O: V3,
  E1: V3,
  E2: V3,
  pal: number,
  id: number,
  vis: number,
  tone: (s: number, t: number) => number,
): void {
  const [ox, oy, od] = project(mul(O, RR));
  const [ax, ay, ad] = project(mul(E1, RR));
  const [bx, by, bd] = project(mul(E2, RR));
  const det = ax * by - bx * ay;
  if (Math.abs(det) < 1e-6) return;
  const xs = [0, ax, bx, ax + bx];
  const ys = [0, ay, by, ay + by];
  const X0 = Math.max(0, Math.floor(OX + ox + Math.min(...xs)));
  const X1 = Math.min(f.w - 1, Math.ceil(OX + ox + Math.max(...xs)));
  const Y0 = Math.max(0, Math.floor(OY + oy + Math.min(...ys)));
  const Y1 = Math.min(f.h - 1, Math.ceil(OY + oy + Math.max(...ys)));
  const N = PAL[pal].length;
  for (let py = Y0; py <= Y1; py++)
    for (let px = X0; px <= X1; px++) {
      const dx = px + 0.5 - OX - ox;
      const dy = py + 0.5 - OY - oy;
      const s = (dx * by - bx * dy) / det;
      const t = (ax * dy - dx * ay) / det;
      if (s < 0 || s > 1 || t < 0 || t > 1) continue;
      if (vis < 1 && !dith(px, py, vis)) continue;
      const d = od + s * ad + t * bd;
      const i = py * f.w + px;
      if (d <= f.zb[i]) continue;
      f.zb[i] = d;
      f.idb[i] = id;
      f.pal[i] = pal;
      f.tone[i] = Math.max(0, Math.min(N - 1, Math.round(tone(s, t))));
    }
}

/** Ящик-стол: крышка и передняя стенка из досок, тёмные стойки, гвозди. */
function crate(f: Frame, o: Pose): void {
  const g = G;
  const x0 = -13.5 * g;
  const x1 = 13.5 * g;
  const yb = 7.0 * g;
  const yf = 15.6 * g;
  const zt = CRATE_TOP * g;
  const plank = HI ? 3 : 2;
  const id = nid();
  // Крышка: доски вдоль, светлее; кромка спереди — кант.
  quad(f, [x0, yb, zt], [x1 - x0, 0, 0], [0, yf - yb, 0], P_WOOD, id, o.game, (s, t) => {
    const fr = (t * plank) % 1;
    let k = 6.2 - 0.6 * t;
    if (fr < (HI ? 0.12 : 0.2) && t > 0.05) k -= 1.4;
    if (t > 0.92) k += 1;
    if (HI && (s * 23 + Math.floor(t * plank) * 0.37) % 1 < 0.05) k -= 0.8;
    return k;
  });
  // Передняя стенка: две доски, по краям стойки, гвозди.
  quad(f, [x0, yf, 0], [x1 - x0, 0, 0], [0, 0, zt], P_WOOD, id + 1, o.game, (s, t) => {
    const W = x1 - x0;
    const sx = s * W;
    let k = 4.4;
    if (sx < 2.2 * g || sx > W - 2.2 * g) k = 3.2;
    else if (Math.abs(t - 0.5) < (HI ? 0.06 : 0.09)) k = 2.2;
    else if (HI && (t * 9 + Math.sin(s * 17) * 0.4) % 1 < 0.12) k = 3.8;
    if (t > 0.9) k -= 0.8;
    if (HI) {
      for (const nx of [1.1 * g, W - 1.1 * g])
        for (const nt of [0.25, 0.75])
          if (Math.abs(sx - nx) < 0.5 && Math.abs(t - nt) < 0.07) k = 1.2;
    }
    return k;
  });
  NEXT_ID = Math.max(NEXT_ID, id + 1);
}

/**
 * Стаканчик донышком вверх: усечённый конус лицом к зрителю, тон —
 * цилиндрический свет, два пояска, светлая кромка внизу.
 */
function cup(f: Frame, cx: number, cy: number, z0: number, vis: number): void {
  const X = cx * RR;
  const Yc = cy * RR;
  const Z0 = z0 * RR;
  const H = CUP_H * G * RR;
  const rb = 2.6 * G * RR;
  const rt = 1.8 * G * RR;
  const id = nid();
  const N = PAL[P_TIN].length;
  // Наклон стенки: нормаль чуть смотрит вверх.
  const nzc = (rb - rt) / H;
  const top = Yc * SE - (Z0 + H) * CE - rt * SE - 1;
  const bot = (Yc + rb) * SE - Z0 * CE + 1;
  for (
    let py = Math.max(0, Math.floor(OY + top));
    py <= Math.min(f.h - 1, Math.ceil(OY + bot));
    py++
  )
    for (let px = Math.floor(OX + X - rb - 1); px <= Math.ceil(OX + X + rb + 1); px++) {
      if (px < 0 || px >= f.w) continue;
      const sx = px + 0.5 - OX - X;
      const sy = py + 0.5 - OY;
      // Точка передней стенки на этой строке: радиус зависит от высоты — два шага уточнения.
      let r = rb;
      let z = Z0;
      let c = 0;
      let s = 0;
      for (let it = 0; it < 3; it++) {
        s = sx / r;
        if (Math.abs(s) > 1) break;
        c = Math.sqrt(1 - s * s);
        z = ((Yc + r * c) * SE - sy) / CE;
        r = lerp(rb, rt, clamp01((z - Z0) / H));
      }
      s = sx / r;
      const t = (z - Z0) / H;
      let d: number;
      let k: number;
      if (Math.abs(s) <= 1 && t >= 0 && t <= 1) {
        c = Math.sqrt(1 - s * s);
        d = (Yc + r * c) * CE + z * SE;
        const nl = Math.hypot(s, c, nzc);
        const lam = (-0.58 * s + 0.52 * c + 0.66 * nzc) / nl;
        k = (lam * 0.55 + 0.42) * (N - 1);
        if (Math.abs(t - 0.24) < (HI ? 0.045 : 0.07) || Math.abs(t - 0.8) < (HI ? 0.04 : 0.06))
          k -= 1.6;
        if (t < (HI ? 0.07 : 0.12)) k += 1.2;
      } else {
        // Донышко сверху: диск на верхней кромке.
        const zt = Z0 + H;
        const y = (sy + zt * CE) / SE;
        const e = sx * sx + (y - Yc) * (y - Yc);
        if (e > rt * rt) continue;
        d = y * CE + zt * SE;
        k = N - 2 - (e > rt * rt * 0.55 ? 1 : 0);
      }
      if (vis < 1 && !dith(px, py, vis)) continue;
      const i = py * f.w + px;
      if (d <= f.zb[i]) continue;
      f.zb[i] = d;
      f.idb[i] = id;
      f.pal[i] = P_TIN;
      f.tone[i] = Math.max(0, Math.min(N - 1, Math.round(k)));
    }
}

/** Монета — плоский золотой диск. */
function coinPart(out: PartF[], p: V3, r: number): void {
  out.push({
    c: p,
    ax: axes([1, 0, 0], [0, 0.35, 1]),
    r: [r, r, 0.45 * G],
    pal: P_GOLD,
    id: nid(),
    bias: 0.08,
    tex: (qx, qy) => (HI && qx * qx + qy * qy > 0.55 ? -0.18 : 0),
    noSeam: true,
  });
}

function gameParts(out: PartF[], c: Ctx): void {
  const { o } = c;
  const g = G;
  const xs = [o.c0, o.c1, o.c2];
  if (o.liftI < 0 || o.lift < 0.3) return;
  const x = xs[o.liftI] * g;
  const y = CUP_Y * g;
  const z = CRATE_TOP * g;
  if (o.coin) coinPart(out, [x, y, z + 0.45 * g], 1.1 * g);
  if (o.pile) {
    for (const [dx, dy, dz] of [
      [-1.5, 0.3, 0],
      [0, 0.6, 0],
      [1.5, 0.3, 0],
      [-0.75, 0.1, 0.9],
      [0.75, 0.2, 0.9],
      [0, 0, 1.8],
    ])
      coinPart(out, [x + dx * g, y + dy * g, z + (0.45 + dz) * g], 1.05 * g);
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
      if (pl !== P_FUR && pl !== P_PALE && pl !== P_VEST) continue;
      for (const j of [i + w, i + 1]) {
        if (pal[j] === pl && idb[j] === idb[i] && tone[j] === tone[i] - 1 && dith(x, y, 0.28))
          hit.push(j, tone[i]);
      }
    }
  for (let n = 0; n < hit.length; n += 2) f.tone[hit[n]] = hit[n + 1];
}

// ---------------------------------------------------------------------------
// Поверх кадра: глаза, нос, рот, карта, цепочка, искры, сон.
// ---------------------------------------------------------------------------

function eyePal(): Record<string, RGBA> {
  const iris =
    V === 1
      ? ramp('#3e0e06', '#7a1e0a', '#c03c12', '#ec6a24', '#ffa45a')
      : ramp('#4a2a02', '#8a5806', '#c8920e', '#f0c024', '#ffe27a');
  const fur = PAL[P_FUR];
  return {
    K: INK_V[V],
    W: hx('#fffbe8'),
    o: fur[1],
    m: fur[5],
    n: fur[7],
    a: iris[4],
    b: iris[3],
    c: iris[2],
    d: iris[1],
  };
}
// Малая: глаз 3×2 — приспущенное веко сверху, янтарь, зрачок-щель.
const EYES_S: Record<string, string[]> = {
  open: ['ooo', 'aKb'],
  openL: ['ooo', 'Kab'],
  openR: ['ooo', 'abK'],
  wide: ['oKo', 'aKb'],
  half: ['ooo', 'ooo'],
  shut: ['...', 'ooo'],
  happy: ['.o.', 'o.o'],
  wink: ['...', 'ooo'],
  sleep: ['...', 'ooo'],
  angry: ['oo.', 'bKo'],
};
// Крупная: миндаль 8×5, внешний угол выше; веко на треть, щель зрачка, блик.
const EYES_L: Record<string, string[]> = {
  open: ['oo......', '.oooooo.', '.nmmmmoo', '..abKbo.', '...cKco.', '....oo..'],
  openL: ['oo......', '.oooooo.', '.nmmmmoo', '..Kbabo.', '...Kcco.', '....oo..'],
  openR: ['oo......', '.oooooo.', '.nmmmmoo', '..abbKo.', '...ccKo.', '....oo..'],
  wide: ['ooo.....', '.ooooooo', '.oaaWKbo', '..abKbco', '...cKco.', '....oo..'],
  half: ['oo......', '.oooooo.', '.nmmmmoo', '..nmmmo.', '...ooKo.', '....oo..'],
  shut: ['........', 'oo......', '.oo.....', '..ooooo.', '...mmmm.', '........'],
  happy: ['........', '..oooo..', '.o....o.', 'o......o', '........', '........'],
  wink: ['........', '........', '..oooo..', '.o....o.', 'o......o', '........'],
  sleep: ['........', '........', 'o.......', '.oo...oo', '...ooo..', '........'],
  angry: ['........', 'oo......', '.oooo...', '.oabKooo', '..cKKbo.', '...ooo..'],
};

function face(p: Px, f: Frame, c: Ctx): void {
  const { o, h } = c;
  const ep = eyePal();
  for (const side of [-1, 1] as const) {
    const at = seen(f, mul(h.at([side * 2.2, 3.85, 1.05]), RR), OX, OY, 2.4 * RR);
    if (!at) continue;
    let key: string = (side < 0 ? o.eyeL : o.eyeR) ?? o.eye;
    if (key === 'open' || key === 'angry' || key === 'wide') {
      if (o.blink > 0.7) key = 'shut';
      else if (o.blink > 0.25) key = 'half';
    }
    if (key === 'open' && Math.abs(o.look) > 0.4) key = o.look > 0 ? 'openR' : 'openL';
    const flip = side > 0;
    // Зеркальный глаз: «влево/вправо» зрачка — по кадру, а не по стороне.
    if (flip && (key === 'openR' || key === 'openL')) key = key === 'openR' ? 'openL' : 'openR';
    if (HI) stamp(p, EYES_L[key], ep, at[0] - (flip ? 3 : 4), at[1] - 3, flip);
    else stamp(p, EYES_S[key], ep, at[0] - 1, at[1] - 1, flip);
  }
  // Нос: блик (крупная — и ноздри).
  const nose = seen(f, mul(h.at([0, 8.45, -1.65]), RR), OX, OY, 1.6 * RR);
  if (nose) {
    const nl = PAL[P_NOSE];
    if (HI) {
      p.set(nose[0] - 1, nose[1] - 1, nl[5]);
      p.set(nose[0], nose[1] - 1, nl[4]);
      p.set(nose[0] - 1, nose[1] + 1, INK_V[V]);
      p.set(nose[0] + 1, nose[1] + 1, INK_V[V]);
    } else p.set(nose[0], nose[1] - 1, nl[5]);
  }
  // Рот (крупная): от носа вниз и уголками вверх — ухмылка; с `grin` уголки выше.
  if (HI && o.jaw < 0.12 && o.snarl < 0.3) {
    const ink = mixc3(PAL[P_PALE][1], INK_V[V], 0.5);
    const gr = o.grin;
    const pts: V3[] = [
      [0, 8.0, -2.85],
      [0, 7.85, -3.2],
      [-0.55, 7.6, -3.45],
      [0.55, 7.6, -3.45],
      [-1.15, 7.2, -3.4 + 0.25 * gr],
      [1.15, 7.2, -3.4 + 0.35 * gr],
      [-1.6, 6.7, -3.1 + 0.45 * gr],
      [1.6, 6.7, -3.0 + 0.6 * gr],
    ];
    for (const q of pts) {
      const at = seen(f, mul(h.at(q), RR), OX, OY, 1.6 * RR);
      if (at) p.set(at[0], at[1], ink);
    }
  }
}

function mixc3(a: RGBA, b: RGBA, k: number): RGBA {
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
    255,
  ];
}

/** Узор карты поверх её пикселей: кромка, сердце посередине, «A» в углу (крупная). */
function cardFace(p: Px, f: Frame): void {
  if (!CARD_AX) return;
  const [O, E1, E2] = CARD_AX;
  const [ox, oy] = project(mul(O, RR));
  const [ax, ay] = project(mul(E1, RR));
  const [bx, by] = project(mul(E2, RR));
  const det = ax * by - bx * ay;
  if (Math.abs(det) < 1e-6) return;
  const cp = PAL[P_CARD];
  for (let i = 0; i < f.w * f.h; i++) {
    if (f.idb[i] !== CARD_ID) continue;
    const px = i % f.w;
    const py = (i - px) / f.w;
    const dx = px + 0.5 - OX - ox;
    const dy = py + 0.5 - OY - oy;
    const s = (dx * by - bx * dy) / det;
    const t = (ax * dy - dx * ay) / det;
    // Сердце: s, t — от нижнего левого угла; t вверх.
    const hx0 = (s - 0.5) * (HI ? 3.3 : 2.9);
    const hy0 = (t - 0.45) * (HI ? 3.0 : 2.6);
    const q = hx0 * hx0 + hy0 * hy0 - 1;
    const inHeart = q * q * q - hx0 * hx0 * hy0 * hy0 * hy0 < 0;
    if (inHeart) p.set(px, py, HEART[!HI || hy0 > -0.4 ? 0 : 1]);
    else if (HI && (s < 0.1 || s > 0.9 || t < 0.07 || t > 0.93)) p.set(px, py, cp[3]);
  }
  if (HI) {
    // «A» в верхнем левом углу.
    const at = project(mul(add(O, add(mul(E1, 0.22), mul(E2, 0.8))), RR));
    stamp(
      p,
      ['.r.', 'r.r', 'rrr', 'r.r'],
      { r: HEART[0] },
      Math.round(OX + at[0]) - 1,
      Math.round(OY + at[1]) - 2,
    );
  }
}

/** Цепочка часов от средней пуговицы к левому карману, брелок качается. */
function watchChain(p: Px, f: Frame, c: Ctx): void {
  const { S, lag, o } = c;
  if (o.curl > 0.5) return;
  const B = torsoAt(S, 0, HI ? -0.34 : -0.35, 1.04);
  const K = torsoAt(S, -0.3, -0.22, 1.04);
  const sx = (lag.chX - S.bc[0]) * 1.1;
  const sz = (lag.chZ - S.bc[2]) * 0.6;
  const M = add(lerp3(B, K, 0.5), [sx, 0.5 * S.k, -2.3 * S.k + sz]);
  const at = (u: number): V3 => {
    const v = 1 - u;
    return add(add(mul(B, v * v), mul(M, 2 * u * v)), mul(K, u * u));
  };
  const gp = GOLD;
  const n = HI ? 26 : 10;
  let last: [number, number] | null = null;
  let j = 0;
  for (let s = 0; s <= n; s++) {
    const q = seen(f, mul(at(s / n), RR), OX, OY, 2.2 * RR);
    if (!q) continue;
    if (last && last[0] === q[0] && last[1] === q[1]) continue;
    last = q;
    p.set(q[0], q[1], HI ? (j++ % 2 ? gp[3] : gp[6]) : gp[6]);
  }
  // Брелок-часики под провисом: качается за туловищем.
  const low = at(0.5);
  const fob = add(low, [sx * 0.8, 0.3 * S.k, -1.3 * S.k]);
  const q = seen(f, mul(fob, RR), OX, OY, 2.6 * RR);
  if (!q) return;
  if (HI) {
    const a = seen(f, mul(low, RR), OX, OY, 2.6 * RR);
    if (a)
      for (let y = a[1] + 1; y < q[1] - 1; y++)
        p.set(Math.round(lerp(a[0], q[0], (y - a[1]) / Math.max(1, q[1] - a[1]))), y, gp[4]);
    stamp(
      p,
      ['.KK.', 'KggK', 'KgGK', '.KK.'],
      { K: gp[2], g: gp[5], G: gp[7] },
      q[0] - 1,
      q[1] - 1,
    );
  } else {
    p.set(q[0], q[1], gp[6]);
    p.set(q[0], q[1] + 1, gp[4]);
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

/** Напёрстки поверх кадра: линии скорости у стаканчиков, искра над горкой. */
function gameFx(p: Px, mask: Uint8Array, c: Ctx): void {
  const { o, t } = c;
  const xs = [o.c0, o.c1, o.c2];
  const dt = 1 / 48;
  const prev = poseAt('work', Math.max(0, t - dt));
  const px = [prev.c0, prev.c1, prev.c2];
  for (let i = 0; i < 3; i++) {
    const v = (xs[i] - px[i]) / dt;
    if (Math.abs(v) < 20) continue;
    const dir = Math.sign(v);
    const ds = [o.d0, o.d1, o.d2][i];
    const [sx, sy] = project(mul([xs[i] * G, (CUP_Y + ds) * G, (CRATE_TOP + CUP_H * 0.5) * G], RR));
    const x0 = Math.round(OX + sx - dir * 3.4 * RR);
    const y0 = Math.round(OY + sy);
    const rows = HI ? [-4, 0, 4] : [-2, 1];
    for (const dy of rows) {
      const L = (HI ? 7 : 3) + (dy === 0 ? 2 : 0);
      for (let s = 0; s < L; s++) {
        const x = x0 - dir * s;
        const y = y0 + dy;
        if (x < 0 || y < 0 || x >= p.w || y >= p.h || mask[y * p.w + x]) continue;
        if (!dith(x, y, 1 - s / L + 0.15)) continue;
        p.set(x, y, BLUR);
      }
    }
  }
  if (o.spark > 0.05 && o.liftI >= 0) {
    const [sx, sy] = project(
      mul([xs[o.liftI] * G + 2.4 * G, CUP_Y * G, (CRATE_TOP + 3.4) * G], RR),
    );
    const L = Math.round(o.spark * (HI ? 4 : 2));
    if (L >= 1)
      star(p, Math.round(OX + sx), Math.round(OY + sy), L, hx('#ffffff'), hx('#ffe08a', 220));
  }
}

/** Хватка: лучи удара расходятся от морды — только по пустому фону, лицо не перечёркивают. */
function snap(p: Px, mask: Uint8Array, c: Ctx): void {
  const { o, h } = c;
  const u = o.bite;
  const [sx, sy] = project(mul(h.at([0, 8.6, -2.4]), RR));
  const mx = OX + sx;
  const my = OY + sy;
  const col = hx('#fff4dc');
  const dim = hx('#f0c070');
  const vis = u < 0.6 ? 1.1 : (1 - u) / 0.4;
  const r0 = (HI ? 15 : 7.5) + u * (HI ? 8 : 4);
  const L = HI ? 7 : 3.5;
  for (const a of [-2.6, -2.05, -1.57, -1.09, -0.54, 0.4, 2.74]) {
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    for (let d = 0; d <= L; d += 0.5) {
      const x = Math.round(mx + ca * (r0 + d) - 0.5);
      const y = Math.round(my + sa * (r0 + d) - 0.5);
      if (x < 0 || y < 0 || x >= p.w || y >= p.h || mask[y * p.w + x]) continue;
      if (!dith(x, y, vis)) continue;
      p.set(x, y, d < L * 0.5 ? col : dim);
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
  const r: Lag = {
    // Голова отстаёт от шеи не больше чем на шаг: в броске пружина оставляла её
    // в воздухе после приземления — шея вытягивалась белым столбом.
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
    chX: lagged((tt) => sk(tt).bc[0], 1.6, 0.12, (L0?.chX ?? 0) - S0.bc[0]),
    chZ: lagged((tt) => sk(tt).bc[2], 1.8, 0.16, (L0?.chZ ?? 0) - S0.bc[2]),
    card: 0,
  };
  // Карта за ухом: только запаздывание за качанием головы (разница пружины и позы).
  const cardFn = (tt: number) => 0.3 * sk(tt).head[0] + 0.9 * P(tt).tilt + 0.5 * P(tt).turn;
  const cNow = cardFn(t);
  const cLag = (spring(cardFn, t, t0, 2.4, 0.18) - cNow) * env + (L0 ? L0.card * (1 - env) : 0);
  r.card = Math.max(-0.5, Math.min(0.5, cLag));
  LAGS.set(key, r);
  return r;
}

function headF(o: Pose, S: Skel, lag: Lag): HeadF {
  const nb = o.nod + o.bow;
  const tl = o.tilt + o.lean;
  const dir = (v: V3): V3 => rollY(yawZ0(pitchX(v, nb), o.turn), tl);
  // На малой голова чуть крупнее: глаза, нос и пасть должны поместиться.
  const k = S.k * (HI ? 1.14 : 1.3);
  const hc: V3 = [lag.headX, S.head[1], lag.headZ];
  return { dir, k, at: (p) => add(hc, mul(dir(p), k)) };
}

function toRes(parts: PartF[]): PartF[] {
  if (RR === 1) return parts;
  return parts.map((pt) => ({ ...pt, c: mul(pt.c, RR), r: mul(pt.r, RR) }));
}

/** Кадр `i` анимации `a` полосы `res`, вариант окраса `v` (0 — обычный, 1 — золотой). */
export function foxFrame(a: Anim, i: number, res: Res = 's', v = 0): Px {
  const cv = RES[res];
  RR = cv.box / RES.s.box;
  HI = res === 'l';
  OX = cv.bx + cv.box / 2;
  OY = cv.by + GROUND * RR;
  V = v === 1 ? 1 : 0;
  NEXT_ID = 0;
  CARD_ID = -1;
  CARD_AX = null;
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
  headParts(parts, flats, c);
  if (o.game > 0.01) gameParts(parts, c);
  drawPartsF(f, toRes(parts), PAL, OX, OY);
  drawFlats(f, flats);
  if (o.game > 0.01) {
    crate(f, o);
    const xs = [o.c0, o.c1, o.c2];
    const ds = [o.d0, o.d1, o.d2];
    for (let j = 0; j < 3; j++)
      cup(
        f,
        xs[j] * G,
        (CUP_Y + ds[j]) * G,
        (CRATE_TOP + (o.liftI === j ? o.lift : 0) + 0.5 * pos(ds[j])) * G,
        o.game,
      );
  }
  seams(f, 1.2 * RR, 1);
  rimLight(f, PAL, (pl) => pl !== P_MOUTH && pl !== P_NOSE && pl !== P_CARD);
  if (HI) softBands(f);
  const p = toPx(f, PAL);
  selOutline(p, INK_V[V], 0.8);
  const mask = new Uint8Array(p.w * p.h);
  for (let j = 0; j < mask.length; j++) mask[j] = p.data[j * 4 + 3] > 0 ? 1 : 0;
  cardFace(p, f);
  face(p, f, c);
  watchChain(p, f, c);
  if (o.game > 0.01) gameFx(p, mask, c);
  if (a === 'sleep') zzz(p, mask, c);
  if (o.bite >= 0) snap(p, mask, c);
  return p;
}
