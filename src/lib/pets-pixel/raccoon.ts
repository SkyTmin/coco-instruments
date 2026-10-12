// Енот-медвежатник — пиксельный питомец по эталону боссов 12–14.
//
// Пухлый серый енот стоит на задних лапах анфас: чёрная бандитская маска
// поперёк глаз, над ней белые брови, под ней белая морда с чёрным носом,
// по бокам белые «бакенбарды» торчат вбок и вниз; круглые уши с белой
// каймой и тёмной серединой; большой полосатый хвост загибается вверх
// справа (в кадре). Медвежатник: мягкие кожаные перчатки, стетоскоп на
// шее (тёмные трубки, стальная головка на животе), поперёк живота — скрутка
// с инструментами: красная и синяя отвёртки, напильник, отмычка, латунная
// пряжка.
//
// Две полосы, у каждой свой рисунок: малая — рамка 48 (шахта, списки),
// крупная — рамка 112 (карточка, вылупление, Питомник): пряди шерсти на
// макушке и щеках, кольца хвоста с ворсом, швы перчаток, стежки скрутки,
// насечка напильника, крючок отмычки, радужка с бликом, ноздри и рот «ω».
//
// Анимации 24 к/с по ключам (`kf`): подготовка → разгон → пик → проводка
// → возврат. Голова, хвост и головка стетоскопа — с запаздыванием (`spring`).
// Трюк — «вскрыть валун как сейф»: приложил стетоскоп к валуну, слушает
// (уши поворачиваются, глаза прикрыты), стукнул молоточком — валун
// разваливается на половинки, внутри блестит руда; реквизит тает и
// возвращается в покой.
//
// Золотой рисуется здесь же (`v` = 1) своими палитрами: мех — золото с
// бронзой в тени, маска — тёмная бронза, кольца хвоста — бронза; глаза,
// стетоскоп и перчатки читаются.

import type { Px } from '../dungeon-art';
import {
  add,
  axes,
  bezQ,
  bump,
  clamp01,
  cross,
  dith,
  dot,
  hash,
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
const P_MASK = 2;
const P_SKIN = 3;
const P_GLOVE = 4;
const P_LEATHER = 5;
const P_STEEL = 6;
const P_RUBBER = 7;
const P_BRASS = 8;
const P_RED = 9;
const P_BLUE = 10;
const P_MOUTH = 11;
const P_BONE = 12;
const P_STONE = 13;
const P_ORE = 14;
const P_WOOD = 15;
const P_NOSE = 16;

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
const STEEL = ramp(
  '#24272a',
  '#3a3f44',
  '#535a60',
  '#6e767c',
  '#8a9298',
  '#a6adb2',
  '#c2c8cc',
  '#dde2e4',
  '#f4f7f8',
);
const RUBBER = ramp('#0e0f11', '#17191c', '#212428', '#2c3035', '#393e44', '#494f56', '#5c636b');
const RED = ramp('#2a0806', '#4a100c', '#6e1a14', '#94281e', '#b8382a', '#d4503c', '#e8745a');
const BLUE = ramp('#08142a', '#0e2242', '#16345e', '#22487c', '#305e9a', '#4678b4', '#6496cc');
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
// Камень холоднее меха: серо-синий, чтобы валун не сливался с енотом.
const STONE = ramp(
  '#16191d',
  '#21262b',
  '#2e343a',
  '#3d444b',
  '#4d555d',
  '#5f6770',
  '#727b84',
  '#878f98',
  '#9ca4ac',
  '#b2b9c0',
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

const PAL_V: RGBA[][][] = [
  [
    // Мех: тёплый серый, тень бурая, свет — пепельный.
    ramp(
      '#17140f',
      '#221e19',
      '#2e2923',
      '#3b352e',
      '#49423a',
      '#585047',
      '#685f55',
      '#797064',
      '#8b8275',
      '#9e9588',
      '#b2a99c',
      '#c6bfb3',
    ),
    // Белое: брови, морда, щёки, живот, кайма ушей.
    ramp(
      '#4a453f',
      '#68625a',
      '#878076',
      '#a59e93',
      '#c0b9ae',
      '#d6d0c5',
      '#e7e2d8',
      '#f3efe7',
      '#fcfaf5',
    ),
    // Маска, кольца хвоста, середина ушей.
    ramp('#0b0908', '#141110', '#1d1917', '#27221f', '#322c28', '#3f3833', '#4d453f'),
    // Тёмная кожа лап.
    ramp('#141110', '#1e1a18', '#2a2522', '#36302c', '#433b36', '#524842', '#625650', '#74675f'),
    // Перчатки — мягкая коричневая кожа.
    ramp(
      '#20120a',
      '#321c10',
      '#462816',
      '#5a341e',
      '#704228',
      '#865232',
      '#9a643e',
      '#ae784e',
      '#c08e62',
    ),
    // Скрутка — кожа темнее и краснее.
    ramp('#1c0e06', '#2c160a', '#3e200f', '#522a14', '#66361a', '#7c4422', '#92542c', '#a86838'),
    STEEL,
    RUBBER,
    GOLD,
    RED,
    BLUE,
    MOUTH,
    BONE,
    STONE,
    GOLD,
    WOOD,
    ramp('#060505', '#0e0c0c', '#181514', '#24201e', '#332d2a', '#463e3a'),
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
    // Маска — тёмная бронза.
    ramp('#120a04', '#1c1006', '#28170a', '#36200e', '#462a12', '#583618', '#6c441e'),
    ramp('#140c06', '#20140a', '#2e1c0e', '#3e2612', '#4e3018', '#603c1e', '#744a26', '#88582e'),
    // Перчатки темнее и краснее — читаются на золоте.
    ramp(
      '#1e0c06',
      '#2e140a',
      '#421e10',
      '#582816',
      '#6e341c',
      '#844226',
      '#9a5232',
      '#b06640',
      '#c47c52',
    ),
    ramp('#180a04', '#261008', '#36180c', '#482010', '#5a2a16', '#6e361c', '#844424', '#98542e'),
    STEEL,
    RUBBER,
    GOLD,
    RED,
    BLUE,
    MOUTH,
    BONE,
    STONE,
    GOLD,
    WOOD,
    ramp('#0a0603', '#140c06', '#1e140a', '#2a1c0e', '#382612', '#4a3218'),
  ],
];
const INK_V: RGBA[] = [hx('#0b0806'), hx('#1a0d02')];
const WHITE = hx('#ffffff');

// ---------------------------------------------------------------------------
// Кадр: холст и рамка тела у двух полос (как у волка и лиса).
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

type Eye = 'open' | 'half' | 'happy' | 'angry' | 'sleep' | 'shut' | 'wide';

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
  /** Пасть: 0 — закрыта, 1 — настежь; оскал; улыбка. */
  jaw: number;
  snarl: number;
  grin: number;
  /** Уши: поворот вбок (+ — наружу, «прислушался»), назад; дёрнуть ухом. */
  earL: number;
  earR: number;
  turnL: number;
  turnR: number;
  flL: number;
  flR: number;
  /** Хвост: вбок (+ — наружу), вверх, кончик завивается к голове. */
  tailSw: number;
  tailUp: number;
  tailCurl: number;
  /** Кисти (в перчатках) — точки в координатах тела; поворот кисти вниз. */
  hLx: number;
  hLy: number;
  hLz: number;
  hRx: number;
  hRy: number;
  hRz: number;
  droop: number;
  /** Когти из перчаток (атака). */
  claws: number;
  /** Ступни: подъём и шаг вперёд. */
  fLz: number;
  fRz: number;
  fLy: number;
  fRy: number;
  eye: Eye;
  eyeL: Eye | null;
  eyeR: Eye | null;
  blink: number;
  /** Куда смотрят зрачки: −1 влево, +1 вправо. */
  look: number;
  chest: number;
  /** Трюк: валун (видимость), раскол (0 — целый, 1 — половинки), трещина. */
  rock: number;
  split: number;
  crack: number;
  /** Головка стетоскопа в левой руке (0…1); молоточек: видимость, угол. */
  bell: number;
  ham: number;
  hamA: number;
  /** Удар (искра), блеск руды, «слушает» — волны звука. */
  tap: number;
  glint: number;
  ticks: number;
  /** Хватка: лучи удара (0…1), −1 — нет. */
  bite: number;
  curl: number;
  scale: number;
}

/** Кисти в покое: опущены по бокам, у пояса (в координатах тела). */
const HAND0: V3 = [9.2, 3.6, 8.8];

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
  grin: 0.3,
  earL: 0,
  earR: 0,
  turnL: 0,
  turnR: 0,
  flL: 0,
  flR: 0,
  tailSw: 0,
  tailUp: 0,
  tailCurl: 0.25,
  hLx: -HAND0[0],
  hLy: HAND0[1],
  hLz: HAND0[2],
  hRx: HAND0[0],
  hRy: HAND0[1],
  hRz: HAND0[2],
  droop: 0,
  claws: 0,
  fLz: 0,
  fRz: 0,
  fLy: 0,
  fRy: 0,
  eye: 'open',
  eyeL: null,
  eyeR: null,
  blink: 0,
  look: 0,
  chest: 0,
  rock: 0,
  split: 0,
  crack: 0,
  bell: 0,
  ham: 0,
  hamA: 0,
  tap: 0,
  glint: 0,
  ticks: -1,
  bite: -1,
  curl: 0,
  scale: 1,
};

const loopK = (t: number, T: number, keys: Key[]) => kf(wrap(t, T), keys);
const pos = (v: number) => Math.max(0, v);
const neg = (v: number) => Math.max(0, -v);
const TAU = Math.PI * 2;

/** Кисти — смесь покоя и цели. */
function hands(o: Pose, L: V3, R: V3, k: number): void {
  o.hLx = lerp(o.hLx, L[0], k);
  o.hLy = lerp(o.hLy, L[1], k);
  o.hLz = lerp(o.hLz, L[2], k);
  o.hRx = lerp(o.hRx, R[0], k);
  o.hRy = lerp(o.hRy, R[1], k);
  o.hRz = lerp(o.hRz, R[2], k);
}

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
  o.sq = -0.018 * br;
  o.hz = 0.3 * br;
  // Потирает перчатки перед животом — «сейчас вскроем».
  const rub = loopK(t, T, [
    [0, 0],
    [0.95, 0],
    [1.22, 1, 'o'],
    [1.9, 1],
    [2.22, 0, 's'],
    [3, 0],
  ]);
  const ph = Math.sin(TAU * 4 * (t - 1.22)) * bump(t, 1.12, 2.0);
  hands(o, [-1.9, 9.0, 10.6 + 0.7 * ph], [1.9, 9.0, 10.6 - 0.7 * ph], rub);
  o.hLx += 0.35 * ph * rub;
  o.hRx += 0.35 * ph * rub;
  o.droop = 0.2 * rub;
  o.grin = REST.grin + 0.5 * rub;
  o.eye = rub > 0.5 ? 'half' : 'open';
  o.nod = 0.06 * rub;
  o.tilt = 0.08 * rub;
  // Глянул вбок до и после.
  o.look = loopK(t, T, [
    [0, 0],
    [2.35, 0],
    [2.45, 1, 'o'],
    [2.8, 1],
    [2.9, 0, 's'],
    [3, 0],
  ]);
  o.turn = 0.12 * o.look;
  o.lean = 0.014 * Math.sin((t / T) * TAU);
  o.x = 0.2 * Math.sin((t / T) * TAU);
  o.flL = bump(t, 0.55, 0.68);
  o.flR = bump(t, 2.3, 2.42) + 0.6 * bump(t, 2.44, 2.54);
  o.blink = Math.max(bump(t, 0.3, 0.46), bump(t, 2.6, 2.74));
  o.tailSw = 0.16 * Math.sin((t / T) * TAU);
  o.tailCurl = REST.tailCurl + 0.2 * Math.sin((t / T) * TAU * 2);
  return o;
}

function walkPose(t: number): Pose {
  const T = dur('walk');
  const o: Pose = { ...REST };
  const h = wrap(t, T);
  // Крадётся на цыпочках: присел, лапки подняты перед грудью и свисают.
  const la = bump(h, 0.02, 0.48);
  const lb = bump(h, 0.52, 0.98);
  o.fLz = 2.0 * la ** 0.8;
  o.fLy = 0.8 * la;
  o.fRz = 2.0 * lb ** 0.8;
  o.fRy = 0.8 * lb;
  const sw = Math.sin((h / T) * TAU);
  o.x = 0.6 * sw;
  o.lean = 0.05 * sw;
  o.z = 0.5 * Math.abs(Math.sin((h / T) * TAU)) - 0.7;
  o.sq = 0.03;
  o.bow = 0.08;
  o.nod = 0.05 + 0.04 * Math.cos((h / T) * 2 * TAU);
  o.tilt = -0.06 * sw;
  o.hx = -0.3 * sw;
  hands(o, [-3.6, 8.2, 15.4 + 0.5 * lb], [3.6, 8.2, 15.4 + 0.5 * la], 1);
  o.droop = 1;
  o.look = Math.sin((h / T) * TAU + 0.6);
  o.turn = 0.1 * o.look;
  o.eye = 'open';
  o.grin = 0.5;
  o.earL = -0.1;
  o.earR = -0.1;
  // Хвост — противовес корпусу.
  o.tailSw = -0.6 * sw;
  o.tailUp = 0.25;
  o.tailCurl = 0.3 + 0.2 * Math.cos((h / T) * TAU);
  return o;
}

function happyPose(t: number): Pose {
  const T = dur('happy');
  const o: Pose = { ...REST };
  // Два подскока, хлопки перчатками над животом, хвост трубой.
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
  o.z = 2.4 * up;
  o.sq = -0.07 * rise;
  o.bow = -0.08 * up;
  o.fLz = 0.6 * up;
  o.fRz = 0.6 * up;
  // Хлопки: кисти сходятся и расходятся трижды.
  const clap = 0.5 - 0.5 * Math.cos(TAU * 3 * clamp01(t / 0.86));
  const arms = kf(t, [
    [0, 0],
    [0.12, 1, 'o'],
    [0.84, 1],
    [1.04, 0, 's'],
  ]);
  const gx = lerp(5.4, 1.2, clap);
  hands(o, [-gx, 8.4, 16.4 + 0.8 * clap], [gx, 8.4, 16.4 + 0.8 * clap], arms);
  o.nod = -0.12 * up;
  o.tilt = 0.14 * Math.sin((t / T) * TAU) * env;
  o.earL = -0.2 * env;
  o.earR = -0.2 * env;
  o.eye = t < 0.9 ? 'happy' : 'open';
  o.jaw = 0.32 * env;
  o.grin = lerp(REST.grin, 1, env);
  o.tailSw = 0.5 * Math.sin(TAU * 2.6 * t) * env;
  o.tailUp = 0.9 * env;
  o.tailCurl = REST.tailCurl + 0.3 * env;
  return o;
}

/**
 * Валун «как сейф» (2 с): валун проявляется перед енотом → левая рука
 * прикладывает головку стетоскопа, енот слушает (голова набок, глаза
 * прикрыты, уши поворачиваются, от головки — волны) → правая достаёт
 * молоточек, замах → тук: искра, трещина → валун разваливается на
 * половинки, руда блестит → енот доволен → реквизит тает, всё в покой.
 */
const ROCK_C: V3 = [0, 9.8, 4.6];
const ROCK_R: V3 = [9.2, 5.6, 5.4];
/** Где головка стетоскопа касается валуна (спереди сверху слева). */
const BELL_AT: V3 = [-3.7, 13.6, 7.9];
/** Куда бьёт молоточек (верх валуна у середины). */
const TAP_AT: V3 = [0.5, 11.1, 9.8];

/** Точка модели → координаты тела позы (обратное к `skel().up`): рука тянется в точку мира. */
function toBody(o: Pose, p: V3): V3 {
  const s = o.scale * G;
  let q = mul(sub(p, [o.x, o.y, o.z]), 1 / s);
  q = rollY(q, -o.lean, [0, 0, 0]);
  q = pitchX(q, -o.bow, [0, 0, 3]);
  return [q[0] / (1 + o.sq * 0.5), q[1] / (1 + o.sq * 0.4), q[2] / (1 - o.sq)];
}

function workPose(t: number): Pose {
  const o: Pose = { ...REST };
  o.rock = kf(t, [
    [0, 0],
    [0.16, 1, 'l'],
    [1.66, 1],
    [1.9, 0, 'l'],
  ]);
  // Наклон к валуну и обратно.
  const lean = kf(t, [
    [0, 0],
    [0.24, 1, 'o'],
    [0.86, 1],
    [1.0, 0.5, 's'],
    [1.2, 0.7, 'o'],
    [1.36, 0.2, 's'],
    [1.7, 0, 's'],
  ]);
  o.bow = 0.2 * lean;
  o.z = -0.4 * lean;
  // Левая рука с головкой стетоскопа: к валуну 0,12–0,32, обратно 0,86–1,02.
  o.bell = kf(t, [
    [0, 0],
    [0.12, 0],
    [0.32, 1, 'o'],
    [0.86, 1],
    [1.02, 0, 's'],
  ]);
  const L0: V3 = [-HAND0[0], HAND0[1], HAND0[2]];
  const Lw = lerp3(L0, add(BELL_AT, [-1.8, -2.6, 3.8]), o.bell);
  // Правая (точки мира): к скрутке (0,9) → замах (1,04) → удар (1,12) → отскок → доволен.
  const strike = add(TAP_AT, [4.06, -1.68, 4.24]);
  const path = (j: number) =>
    kf(t, [
      [0, HAND0[j]],
      [0.8, HAND0[j]],
      [0.9, [6.6, 7.6, 9.6][j], 'o'],
      [1.04, [7.8, 5.0, 21.0][j], 'o'],
      [1.12, strike[j], 'i'],
      [1.2, [5.4, 10.0, 15.4][j], 'o'],
      [1.4, [5.6, 8.8, 13.6][j]],
      [1.62, [6.8, 7.0, 11.6][j]],
      [1.9, HAND0[j], 's'],
    ]);
  const Rw: V3 = [path(0), path(1), path(2)];
  const Lb = toBody(o, Lw);
  const Rb = toBody(o, Rw);
  hands(o, Lb, Rb, 1);
  o.ham = kf(t, [
    [0, 0],
    [0.88, 0],
    [0.98, 1, 'l'],
    [1.44, 1],
    [1.62, 0, 'l'],
  ]);
  // Угол молоточка: вверх (замах) → влево-вниз (удар).
  o.hamA = kf(t, [
    [0, 0.6],
    [0.9, 0.6],
    [1.04, -0.15, 'o'],
    [1.12, 2.05, 'i'],
    [1.2, 1.8, 'o'],
    [1.44, 1.2],
    [1.62, 0.8],
  ]);
  o.tap = bump(t, 1.1, 1.3);
  o.crack = kf(t, [
    [0, 0],
    [1.11, 0],
    [1.16, 1, 'o'],
  ]);
  o.split = kf(t, [
    [0, 0],
    [1.18, 0],
    [1.34, 1.08, 'o'],
    [1.42, 1, 's'],
  ]);
  o.glint = bump(t, 1.3, 1.78);
  // Слушает: голова к валуну, глаза прикрыты, уши поворачиваются по очереди.
  const listen = kf(t, [
    [0, 0],
    [0.3, 1, 'o'],
    [0.84, 1],
    [0.96, 0, 's'],
  ]);
  o.ticks = t > 0.36 && t < 0.86 ? 1 : -1;
  o.tilt = -0.2 * listen;
  o.nod = 0.22 * lean + 0.06 * listen;
  o.turn = -0.12 * listen;
  o.hx = -0.8 * listen;
  o.hz = -0.6 * lean;
  o.turnL = 1.0 * bump(t, 0.36, 0.66) + 0.5 * bump(t, 0.62, 0.86);
  o.turnR = 0.9 * bump(t, 0.5, 0.84);
  o.flL = 0.5 * bump(t, 0.7, 0.78);
  o.eye = listen > 0.3 ? 'half' : 'open';
  // Удар — зажмурился; раскол — радость.
  if (t >= 1.08 && t < 1.2) o.eye = 'shut';
  const glad = kf(t, [
    [0, 0],
    [1.26, 0],
    [1.36, 1, 'o'],
    [1.72, 1],
    [1.92, 0, 's'],
  ]);
  if (t >= 1.3 && t < 1.8) o.eye = 'happy';
  o.grin = REST.grin + 0.7 * glad;
  o.jaw = 0.22 * glad;
  o.earL += -0.3 * glad;
  o.earR += -0.3 * glad;
  o.tailUp = 0.7 * glad;
  o.tailSw = 0.4 * Math.sin(TAU * 2.5 * t) * glad;
  o.tailCurl = REST.tailCurl + 0.2 * glad;
  o.look = -0.6 * listen;
  o.chest = 0.5 * bump(t, 0.98, 1.12);
  // Реквизит растаял — всё на места покоя (половинки, трещина, молоточек).
  if (o.rock < 0.01) {
    o.split = 0;
    o.crack = 0;
    o.glint = 0;
    o.tap = 0;
    o.ham = 0;
    o.hamA = REST.hamA;
    o.bell = 0;
    o.ticks = -1;
  }
  return o;
}

function attackPose(t: number): Pose {
  const T = dur('attack');
  const o: Pose = { ...REST };
  // Присел, лапы с когтями к плечам → бросок к зрителю, когти и пасть
  // (кадры 8–11) → приземлился, отряхнулся → покой.
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
  o.y = 3.4 * pos(l) - 0.6 * neg(l);
  o.scale = 1 + 0.18 * pos(l);
  o.sq = 0.12 * neg(l) - 0.05 * air + 0.08 * bump(t, 0.55, 0.7);
  o.z = -0.8 * neg(l) + 2.0 * air;
  o.bow = 0.12 * neg(l) + 0.06 * pos(l);
  o.nod = 0.16 * neg(l) - 0.2 * pos(l);
  o.hy = 1.0 * pos(l);
  o.hz = -0.6 * neg(l);
  o.x = 0.3 * Math.sin(t * TAU * 9) * bump(t, 0.04, 0.27);
  // Лапы: в присяде у плеч, в броске — вперёд и в стороны, когти веером.
  const crouch = neg(l);
  const strike = pos(l);
  hands(o, [-5.6, 7.4, 17.6], [5.6, 7.4, 17.6], crouch);
  hands(o, [-9.6, 8.6, 23.4], [9.6, 8.6, 23.4], strike);
  o.claws = clamp01(crouch * 0.5 + strike * 1.3);
  o.droop = 0.3 * crouch - 1.0 * strike;
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
  const ears = kf(t, [
    [0, 0],
    [0.14, 0.4, 'o'],
    [0.28, 0.5],
    [0.36, 0.8, 'o'],
    [0.56, 0.7],
    [0.86, 0, 's'],
  ]);
  o.earL = ears;
  o.earR = ears;
  o.eye = t < 0.7 ? 'angry' : 'open';
  o.turn = 0.2 * Math.sin(((t - 0.5) / 0.17) * TAU) * bump(t, 0.5, 0.76);
  o.fLz = 0.8 * air;
  o.fRz = 0.8 * air;
  o.tailSw = 0.5 * Math.sin(t * TAU * 9) * bump(t, 0.04, 0.27) + 0.4 * bump(t, 0.4, 0.86);
  o.tailUp = 0.8 * bump(t, 0.1, 0.8);
  o.tailCurl = REST.tailCurl + 0.3 * bump(t, 0.3, 0.8);
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
  o.nod = 0.12 + 0.03 * br;
  o.tilt = 0.14;
  o.hz = 0.25 * br;
  o.sq = -0.05 * br;
  o.tailSw = 0.05 * br;
  o.earL = 0.35;
  o.earR = 0.35;
  hands(o, [-3.0, 8.8, 4.4], [3.0, 8.8, 4.4], 1);
  o.droop = 0.6;
  o.grin = 0.2;
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
// Скелет (в пикселях малой полосы): стоит и свернулся (сон).
// ---------------------------------------------------------------------------

interface Plan {
  body: V3;
  bodyR: V3;
  chest: V3;
  chestR: V3;
  head: V3;
  sh: V3;
  hip: V3;
  hipR: V3;
  foot: V3;
  tail: V3[];
}
const STAND: Plan = {
  body: [0, 0.2, 9.2],
  bodyR: [9.2, 7.0, 8.4],
  chest: [0, -0.2, 15.6],
  chestR: [6.8, 5.6, 5.8],
  head: [0, 1.4, 27.0],
  sh: [6.2, 1.0, 16.6],
  hip: [4.6, 1.2, 4.2],
  hipR: [3.2, 3.4, 3.4],
  // Ступни выставлены вперёд из-под живота: глядя сверху, иначе их не видно.
  foot: [4.4, 4.6, 0],
  // Хвост: из-за правого бока вбок и вверх, кончик к плечу.
  tail: [
    [5.0, -4.6, 4.2],
    [9.6, -4.2, 4.4],
    [13.4, -3.2, 7.6],
    [14.8, -2.6, 12.0],
    [14.0, -2.2, 16.4],
    [11.8, -2.0, 19.6],
  ],
};
const CURL: Plan = {
  body: [0, -1.0, 5.6],
  bodyR: [10.4, 7.8, 5.8],
  chest: [0, 1.0, 8.4],
  chestR: [7.6, 6.0, 4.8],
  head: [0, 4.0, 13.4],
  sh: [6.4, 3.0, 8.8],
  hip: [6.0, -1.4, 3.6],
  hipR: [3.4, 3.8, 3.2],
  foot: [6.6, 2.4, 0],
  // Хвост вокруг перёд, кончиком на нос.
  tail: [
    [6.0, -4.6, 3.0],
    [11.2, -0.2, 3.0],
    [10.4, 6.6, 4.0],
    [5.8, 11.4, 6.8],
    [0.0, 13.4, 9.0],
    [-6.4, 11.6, 9.6],
  ],
};

function planOf(o: Pose): Plan {
  const m = (k: keyof Plan): V3 => lerp3(STAND[k] as V3, CURL[k] as V3, o.curl);
  return {
    body: m('body'),
    bodyR: m('bodyR'),
    chest: m('chest'),
    chestR: m('chestR'),
    head: m('head'),
    sh: m('sh'),
    hip: m('hip'),
    hipR: m('hipR'),
    foot: m('foot'),
    tail: STAND.tail.map((p, i) => lerp3(p, CURL.tail[i], o.curl)),
  };
}

interface Skel {
  up: (p: V3) => V3;
  pl: Plan;
  head: V3;
  shL: V3;
  shR: V3;
  handL: V3;
  handR: V3;
  footL: V3;
  footR: V3;
  /** Оси и радиусы туловища (скрутка, стетоскоп). */
  bc: V3;
  cc: V3;
  bax: [V3, V3, V3];
  br: V3;
  cr: V3;
  k: number;
}

/** Масштаб модели в рамке: ступни — кончики ушей ~42 пикселя малой полосы. */
const G = 1.0;

function skel(o: Pose): Skel {
  const s = o.scale * G;
  const sq = o.sq;
  const pl = planOf(o);
  const up = (p: V3): V3 => {
    let q: V3 = [p[0] * (1 + sq * 0.5), p[1] * (1 + sq * 0.4), p[2] * (1 - sq)];
    q = pitchX(q, o.bow, [0, 0, 3]);
    q = rollY(q, o.lean, [0, 0, 0]);
    q = mul(q, s);
    return add(q, [o.x, o.y, o.z]);
  };
  // Ступня на полу не едет за телом: подъём — только у поднятой.
  const lift = Math.max(0, o.z);
  const foot = (side: number, dy: number, dz: number): V3 => [
    side * pl.foot[0] * s + o.x * 0.2,
    pl.foot[1] * s + dy + o.y,
    pl.foot[2] * s + dz + lift,
  ];
  const ch = o.chest;
  return {
    up,
    pl,
    head: up(add(pl.head, [o.hx, o.hy, o.hz])),
    shL: up([-pl.sh[0], pl.sh[1], pl.sh[2]]),
    shR: up([pl.sh[0], pl.sh[1], pl.sh[2]]),
    handL: up([o.hLx, o.hLy, o.hLz]),
    handR: up([o.hRx, o.hRy, o.hRz]),
    footL: foot(-1, o.fLy, o.fLz),
    footR: foot(1, o.fRy, o.fRz),
    bc: up(pl.body),
    cc: up(add(pl.chest, [0, 0.2 * ch, 0])),
    bax: axes(rollY([1, 0, 0], o.lean), pitchX([0, 0, 1], o.bow)),
    br: mul([pl.bodyR[0] * (1 + 0.02 * ch), pl.bodyR[1] * (1 + 0.03 * ch), pl.bodyR[2]], s),
    cr: mul([pl.chestR[0] * (1 + 0.03 * ch), pl.chestR[1] * (1 + 0.05 * ch), pl.chestR[2]], s),
    k: s,
  };
}

/** Точка тела спереди на высоте `z` и сдвиге `x` (координаты тела): ближняя из груди и живота. */
function frontAt(S: Skel, x: number, z: number, out = 0.4): V3 {
  const pl = S.pl;
  let best: V3 | null = null;
  for (const [c, r] of [
    [pl.body, pl.bodyR],
    [pl.chest, pl.chestR],
  ] as [V3, V3][]) {
    const qx = x / r[0];
    const qz = (z - c[2]) / r[2];
    const e = 1 - qx * qx - qz * qz;
    if (e <= 0) continue;
    const y = c[1] + r[1] * Math.sqrt(e);
    if (!best || y > best[1]) best = [x, y, z];
  }
  return S.up(add(best ?? [x, pl.body[1] + pl.bodyR[1] * 0.3, z], [0, out, 0]));
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

/** Пальцы: тёмные щели спереди (ось 1 — вперёд). */
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
  /** Головка стетоскопа отстаёт от туловища. */
  bellX: number;
  bellZ: number;
}

interface Ctx {
  o: Pose;
  S: Skel;
  h: HeadF;
  lag: Lag;
  t: number;
}

/** Часть с выбором палитры по точке, светом трубы, срезом и проявлением. */
interface PartF extends Part {
  pick?: (qx: number, qy: number, qz: number) => number;
  /** Свет как у трубы: нормаль без составляющей вдоль оси — звенья хвоста не «бусы». */
  tube?: boolean;
  /** Срез: остаётся m·q ≤ d (q — точка единичной сферы части); грань среза — `face`. */
  cut?: { m: V3; d: number; face: (qx: number, qy: number, qz: number) => number };
  /** Проявление шахматкой (реквизит тает). */
  vis?: number;
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
/** Номера частей валуна — трещина рисуется только по ним. */
let ROCK_IDS: number[] = [];

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

/** Две кости от `a` к `b`, локоть — в сторону `pole`. */
function ik(a: V3, b: V3, l1: number, l2: number, pole: V3): [V3, V3] {
  const d = sub(b, a);
  const D = Math.hypot(d[0], d[1], d[2]) || 1;
  const e = mul(d, 1 / D);
  const L = Math.max(Math.abs(l1 - l2) + 0.05, Math.min(D, (l1 + l2) * 0.995));
  const x = (l1 * l1 - l2 * l2 + L * L) / (2 * L);
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  const n = norm(sub(pole, mul(e, dot(pole, e))));
  const knee = add(add(a, mul(e, x)), mul(n, h));
  const end = add(knee, mul(norm(sub(b, knee)), l2));
  return [knee, end];
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
    const foot = side < 0 ? S.footL : S.footR;
    const lift = Math.max(0, side < 0 ? o.fLz : o.fRz);
    const fwd = side < 0 ? o.fLy : o.fRy;
    // Бедро — круглое, серое; с поднятой ступнёй колено идёт вверх и вперёд.
    const hip = S.up([side * pl.hip[0], pl.hip[1], pl.hip[2]]);
    const hc = add(hip, [0, 0.4 * lift + 0.4 * fwd, 0.5 * lift]);
    out.push({
      c: hc,
      ax: axes(rollY([1, 0, 0], side * 0.2 + o.lean), [0, 0, 1]),
      r: mul(pl.hipR, k),
      pal: P_FUR,
      id: nid(),
      bias: -0.03,
      tex: HI ? tufts(5, 3.2, 0.07, 0.9) : undefined,
    });
    // Голень — короткая, тёмная кожа.
    const ank = add(foot, [0, -0.3 * k, 1.1 * k]);
    limb(out, add(hc, [0, 0.4 * k, -1.6 * k]), ank, 1.45 * k, 1.5 * k, P_SKIN, nid(), {
      bias: 0.06,
    });
    // Ступня — тёмная, пальцы вперёд.
    out.push({
      c: add(foot, [0, 0.7 * k, 0.9 * k]),
      ax: axes(norm([side * 0.28, 1, 0]), [0, 0, 1]),
      r: [2.5 * k, 1.9 * k, 1.1 * k],
      pal: P_SKIN,
      id: nid(),
      bias: 0.1,
      tex: toes(HI ? 4 : 2),
    });
  }
}

/** Перчатка: варежка вдоль предплечья, большой палец внутрь, манжета, швы пальцев. */
function glove(out: PartF[], c: Ctx, side: number, elb: V3, wr: V3): void {
  const { o, S } = c;
  const k = S.k;
  const d0 = norm(sub(wr, elb));
  const dr = o.droop;
  // droop > 0 — кисть свисает; < 0 — поднята когтями вверх-наружу.
  const dir = norm(
    dr >= 0 ? lerp3(d0, [0, 0.35, -1], dr * 0.7) : lerp3(d0, [side * 0.35, 0.25, 1], -dr),
  );
  const id = nid();
  // Манжета — светлее и шире.
  out.push({
    c: add(wr, mul(dir, 0.2 * k)),
    ax: axes(dir, [0, 1, 0]),
    r: [0.9 * k, 2.15 * k, 2.15 * k],
    pal: P_GLOVE,
    id,
    bias: 0.12,
  });
  out.push({
    c: add(wr, mul(dir, 1.9 * k)),
    ax: axes(dir, [side * 0.2, 1, 0]),
    r: [2.2 * k, 2.0 * k, 1.75 * k],
    pal: P_GLOVE,
    id,
    bias: 0.06,
    tex: (qx, qy, qz) => {
      // Пальцы: швы по кончику (крупная — три, малая — один).
      if (qx < 0.25) return 0;
      const u = ((qy + 1) / 2) * (HI ? 4 : 2);
      const fu = u - Math.floor(u);
      if (Math.floor(u) > 0 && fu < (HI ? 0.13 : 0.2) && qz > -0.6) return -0.22;
      return 0;
    },
  });
  // Большой палец — внутрь, к животу.
  const inward: V3 = [-side, 0.4, 0];
  out.push({
    c: add(add(wr, mul(dir, 1.3 * k)), mul(norm(inward), 1.7 * k)),
    ax: axes(norm(add(dir, mul(inward, 0.6))), [0, 1, 0]),
    r: [1.25 * k, 0.95 * k, 0.95 * k],
    pal: P_GLOVE,
    id,
    bias: 0.1,
  });
  // Когти — из кончиков, веером.
  if (o.claws > 0.05) {
    for (const a of [-0.5, 0, 0.5]) {
      const cd = norm(rollY(dir, a * side + 0.0));
      const base = add(
        add(wr, mul(dir, 3.6 * k)),
        mul([cd[0] - dir[0], 0, cd[2] - dir[2]], 1.6 * k),
      );
      out.push({
        c: add(base, mul(cd, 0.7 * k * o.claws)),
        ax: axes(cd, [0, 1, 0]),
        r: [(HI ? 0.95 : 1.1) * k * o.claws, (HI ? 0.36 : 0.45) * k, (HI ? 0.36 : 0.45) * k],
        pal: P_BONE,
        id: nid(),
        bias: 0.1,
        noSeam: true,
      });
    }
  }
}

function arms(out: PartF[], c: Ctx): void {
  const { o, S } = c;
  const k = S.k;
  for (const side of [-1, 1] as const) {
    const sh = side < 0 ? S.shL : S.shR;
    const hand = side < 0 ? S.handL : S.handR;
    // Локоть — наружу и назад; во сне — вниз.
    const pole = norm(lerp3([side * 0.8, -0.5, -0.45], [side * 0.5, -0.2, -1], o.curl));
    const [elb, wr] = ik(sh, hand, 5.8 * k, 5.6 * k, pole);
    const id = nid();
    limb(out, sh, elb, 2.0 * k, 2.05 * k, P_FUR, id, {
      bias: 0.0,
      tex: HI ? tufts(4, 2.4, 0.06, 1) : undefined,
    });
    limb(out, elb, wr, 1.8 * k, 1.85 * k, P_FUR, id, { bias: 0.03 });
    glove(out, c, side, elb, wr);
  }
}

/** Скрутка поперёк живота: середина провисает. */
const bandC = (qx: number) => -0.25 + 0.1 * qx * qx;
const BAND_H = 0.165;
/** Инструменты в петлях скрутки: x (координаты тела), что это. */
const TOOLS: [number, 'red' | 'file' | 'pick' | 'blue'][] = [
  [-5.2, 'red'],
  [-3.0, 'file'],
  [3.0, 'pick'],
  [5.2, 'blue'],
];

/**
 * Живот: светлое брюшко овалом спереди; поперёк — кожаная скрутка с
 * латунной пряжкой посередине, петлями под инструменты и стежками (крупная).
 */
function bellyPick(qx: number, qy: number, qz: number): number {
  PICK_T = 0;
  const bc = bandC(qx);
  const dz = qz - bc;
  if (Math.abs(dz) < BAND_H && qy > -0.3) {
    const ax0 = Math.abs(qx);
    if (ax0 < (HI ? 0.1 : 0.12) && qy > 0.5) {
      // Пряжка: рамка светлая, внутри тёмная (крупная — и язычок).
      if (HI) {
        const inner = ax0 < 0.06 && Math.abs(dz) < BAND_H - 0.06;
        if (inner) {
          PICK_T = Math.abs(qx) < 0.012 ? 0.1 : -0.42;
          return P_BRASS;
        }
      }
      PICK_T = 0.08;
      return P_BRASS;
    }
    if (Math.abs(dz) > BAND_H - (HI ? 0.035 : 0.05)) PICK_T = -0.14;
    else if (
      HI &&
      Math.abs(Math.abs(dz) - (BAND_H - 0.07)) < 0.012 &&
      ((qx * 40 + 100) | 0) % 2 === 0
    )
      PICK_T = 0.12;
    // Петли под инструменты — тёмные полоски поверх скрутки.
    if (qy > 0.2)
      for (const [x] of TOOLS) {
        const tx = x / STAND.bodyR[0];
        if (Math.abs(qx - tx) < (HI ? 0.06 : 0.07) && dz > -0.02) PICK_T -= 0.16;
      }
    return P_LEATHER;
  }
  // Светлое брюшко.
  const bx = qx / 0.6;
  const bz = (qz + 0.02) / 0.82;
  const e = bx * bx + bz * bz;
  if (qy > 0.25 && e < 1) {
    if (HI && e > 0.82 && dith(Math.round(qx * 60), Math.round(qz * 60), (e - 0.82) / 0.18)) {
      PICK_T = -0.02;
      return P_FUR;
    }
    PICK_T = -0.3 + (HI ? tufts(7, 5, 0.05, 0.8)(qx, qy, qz) : 0);
    return P_PALE;
  }
  if (HI) PICK_T = tufts(6, 4, 0.07, 1)(qx, qy, qz);
  return P_FUR;
}

function chestPick(qx: number, qy: number, qz: number): number {
  PICK_T = HI ? tufts(4, 4, 0.07, 1)(qx, qy, qz) : 0;
  return P_FUR;
}

function torso(out: PartF[], c: Ctx): void {
  const { S } = c;
  const id = nid();
  out.push({ c: S.bc, ax: S.bax, r: S.br, pal: P_FUR, id, bias: -0.02, pick: bellyPick });
  out.push({ c: S.cc, ax: S.bax, r: S.cr, pal: P_FUR, id, bias: 0.0, pick: chestPick });
}

/** Хвост: пышный, в кольцах — тёмные и светлые полосы поперёк, кончик тёмный. */
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
    q = rollY(q, -sw * 0.3 * u * (1 - o.curl));
    q = [q[0] + sw * 1.6 * u * u * (1 - o.curl), q[1], q[2] + upA * 3.0 * u * u * (1 - o.curl)];
    return add(root, q);
  });
  // Кончик загибается к голове: последние точки поворачиваются вокруг третьей с конца.
  if (cu > 0.01 && o.curl < 0.5) {
    const piv = pts[n - 3];
    for (let i = n - 2; i < n; i++) {
      const d = sub(pts[i], piv);
      pts[i] = add(piv, rollY(d, cu * (i === n - 1 ? 0.7 : 0.35)));
    }
  }
  const wp = pts.map((p) => S.up(p));
  const wid = [1.9, 2.7, 3.2, 3.3, 3.1, 2.7, 2.0];
  const segs = HI ? 16 : 11;
  // Длина дуги — для колец.
  const L: number[] = [0];
  const P: V3[] = [];
  for (let i = 0; i <= segs; i++) P.push(catmull(wp, i / segs));
  for (let i = 1; i <= segs; i++) L.push(L[i - 1] + Math.hypot(...sub(P[i], P[i - 1])));
  const total = L[segs] || 1;
  // Пять тёмных колец и тёмный кончик; у корня — светлое.
  const ring = (s: number, fz: number) => {
    const u = s / total;
    if (u > 0.88) return true;
    if (u < 0.1) return false;
    const f = (u - 0.1) / 0.78;
    const g = f * 5 + fz;
    return g - Math.floor(g) > 0.5;
  };
  const id = nid();
  for (let i = 0; i < segs; i++) {
    const p0 = P[i];
    const p1 = P[i + 1];
    const d = sub(p1, p0);
    const len = Math.hypot(d[0], d[1], d[2]);
    if (len < 1e-4) continue;
    const um = (i + 0.5) / segs;
    const w = profile(wid, um) * k;
    const r1 = len * 0.55 + 0.4 * k;
    const sc = (L[i] + L[i + 1]) / 2;
    out.push({
      c: mul(add(p0, p1), 0.5),
      ax: axes(d, [0, 0, 1]),
      r: [r1, w, w * 0.9],
      pal: P_FUR,
      id,
      tube: true,
      pick: (qx, qy, qz) => {
        // Ворс по кромке кольца: граница чуть рвётся по окружности (крупная).
        const fz = HI ? 0.07 * Math.sin(Math.atan2(qy, qz) * 5 + i) : 0;
        if (ring(sc + qx * r1, fz)) {
          PICK_T = 0.12;
          return P_MASK;
        }
        PICK_T =
          0.06 +
          (HI && (Math.atan2(qy, qz) * 4.5 + qx * 0.5 + i * 0.3 + 20) % 1 < 0.15 ? -0.08 : 0);
        return P_FUR;
      },
    });
  }
  // Пряди по наружной кромке — пышность (крупная), цвет кольца под основанием.
  if (HI) {
    const nl = 7;
    for (let j = 0; j < nl; j++) {
      const u = lerp(0.2, 0.86, j / (nl - 1));
      const p = catmull(wp, u);
      const tg = norm(sub(catmull(wp, Math.min(1, u + 0.04)), catmull(wp, Math.max(0, u - 0.04))));
      const outN = norm(cross(tg, [0, 1, 0]));
      const side = outN[0] > 0 ? outN : mul(outN, -1);
      const dir = norm(add(tg, mul(side, 0.55)));
      const w = profile(wid, u) * k;
      const s = total * u;
      const dark = ring(s, 0);
      lock(
        out,
        add(p, mul(side, 0.5 * w)),
        dir,
        [0, 1, 0],
        3.4 * k,
        w * 0.55,
        w * 0.45,
        dark ? P_MASK : P_FUR,
        dark ? 0.1 : 0.04,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Голова: маска, брови, морда, бакенбарды, уши.
// ---------------------------------------------------------------------------

/** Кусочно-линейная функция по узлам [x, y] (x растёт). */
function pw(keys: [number, number][], x: number): number {
  if (x <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++)
    if (x < keys[i][0]) {
      const [x0, y0] = keys[i - 1];
      const [x1, y1] = keys[i];
      return lerp(y0, y1, (x - x0) / (x1 - x0));
    }
  return keys[keys.length - 1][1];
}
/** Маска поперёк глаз: верх и низ полосы по |qx| черепа; у носа уже, к щекам уходит вниз. */
const maskTop = (a: number) =>
  pw(
    [
      [0, 0.27],
      [0.2, 0.35],
      [0.4, 0.43],
      [0.6, 0.41],
      [0.8, 0.26],
      [0.97, 0.0],
    ],
    a,
  );
const maskBot = (a: number) =>
  pw(
    [
      [0, -0.06],
      [0.2, -0.2],
      [0.4, -0.3],
      [0.6, -0.42],
      [0.8, -0.56],
      [0.97, -0.46],
    ],
    a,
  );

/** Череп: серый мех, чёрная маска, белые брови, тёмная полоса по лбу, белый низ морды. */
function skullPick(qx: number, qy: number, qz: number): number {
  PICK_T = 0;
  const a = Math.abs(qx);
  const top = maskTop(a);
  const bot = maskBot(a);
  if (qy > -0.2 && a < 0.97 && qz < top && qz > bot) {
    // Край маски у щёк — тон мягче (крупная), внутри — ровная чернь.
    PICK_T = HI && qz > top - 0.05 ? 0.08 : 0;
    return P_MASK;
  }
  if (qy > 0) {
    // Белые брови над маской.
    const bw = 0.17 - 0.5 * (a - 0.42) ** 2;
    if (qz >= top && qz < top + bw && a > 0.13 && a < 0.7) {
      PICK_T = HI ? (qz > top + bw - 0.05 ? -0.1 : 0.03) : 0.02;
      return P_PALE;
    }
    // Тёмная полоса по лбу — от переносицы вверх.
    if (a < 0.13 - 0.04 * clamp01(qz - top) && qz >= top - 0.02) {
      PICK_T = -0.3;
      return P_FUR;
    }
    // Белый низ у морды и подбородок; щёки — светло-серые.
    if (qz <= bot && a < 0.42) {
      PICK_T = HI ? tufts(6, 5, 0.05, 0)(qx, qy, qz) : 0;
      return P_PALE;
    }
    if (qz <= bot && a < 0.95) {
      PICK_T = 0.1 + (HI ? tufts(6, 5, 0.06, 0)(qx, qy, qz) : 0);
      return P_FUR;
    }
  }
  if (HI) PICK_T = tufts(5, 4, 0.08, 1.02)(qx, qy, qz);
  return P_FUR;
}

function headParts(out: PartF[], flats: Flat[], c: Ctx): void {
  const { o, h } = c;
  const k = h.k;
  const ex = h.dir([1, 0, 0]);
  const ey = h.dir([0, 1, 0]);
  const ez = h.dir([0, 0, 1]);
  const hax = axes(ex, ez);
  out.push({
    c: h.at([0, 0, 0]),
    ax: hax,
    r: [8.0 * k, 6.6 * k, 7.0 * k],
    pal: P_FUR,
    id: nid(),
    bias: 0.04,
    pick: skullPick,
  });
  // Белые щёки снизу по бокам — голова шире книзу.
  for (const side of [-1, 1]) {
    out.push({
      c: h.at([side * 4.9, 2.4, -3.2]),
      ax: hax,
      r: [3.3 * k, 2.8 * k, 2.5 * k],
      pal: P_FUR,
      id: nid(),
      bias: 0.1,
      tex: HI ? tufts(4, 3, 0.06, 0.6) : undefined,
    });
    // Бакенбарды: торчат вбок и вниз из-под маски.
    for (const [cx, cy, cz, len, wd, dx, dz] of [
      [6.9, 0.8, -2.2, 3.6, 2.1, 1, -0.42],
      [5.6, 1.8, -4.0, 3.0, 1.8, 0.8, -0.95],
      ...(HI ? [[7.4, 0.0, -0.6, 2.6, 1.5, 1, -0.08]] : []),
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
        0.0,
      );
    }
  }
  // Морда: белая, острая, чуть вниз; на крупной — серая полоска по спинке носа.
  const sid = nid();
  const sn = o.snarl;
  const max = axes(h.dir(pitchX([1, 0, 0], 0.22)), h.dir(pitchX([0, 0, 1], 0.22)));
  out.push({
    c: h.at([0, 5.4, -2.5]),
    ax: max,
    r: [2.7 * k, 3.1 * k, 2.1 * k],
    pal: P_PALE,
    id: sid,
    bias: 0.02,
    tex: (qx, qy, qz) => {
      if (HI && Math.abs(qx) < 0.18 && qz > 0.45 && qy < 0.75) return -0.16;
      if (sn > 0.2 && qz > 0.2 && qy > 0.1 && (qy * (HI ? 6 : 3)) % 1 < 0.25) return -0.18 * sn;
      return 0;
    },
  });
  // Чёрный нос на кончике.
  out.push({
    c: h.at([0, 8.1, -1.7]),
    ax: max,
    r: [1.35 * k, 0.95 * k, 0.95 * k],
    pal: P_NOSE,
    id: nid(),
    bias: 0.08,
    noSeam: true,
  });
  // Нижняя челюсть.
  const jw = o.jaw;
  const piv: V3 = [0, 1.6, -3.6];
  const ja = jw * 0.7;
  const jd = (p: V3): V3 => add(piv, pitchX(sub(p, piv), ja));
  const jax = axes(h.dir(pitchX([1, 0, 0], ja + 0.2)), h.dir(pitchX([0, 0, 1], ja + 0.2)));
  out.push({
    c: h.at(jd([0, 4.8, -4.0])),
    ax: jax,
    r: [1.7 * k, 2.4 * k, 0.9 * k],
    pal: P_PALE,
    id: nid(),
    bias: -0.12,
  });
  if (jw > 0.05 || sn > 0.3) {
    out.push({
      c: h.at([0, 5.2, -3.6 - jw * 0.5]),
      ax: max,
      r: [1.6 * k, 2.4 * k, (0.4 + jw * 0.95) * k],
      pal: P_MOUTH,
      id: nid(),
      bias: -0.2,
      noSeam: true,
    });
    out.push({
      c: h.at(jd([0, 5.3, -3.7])),
      ax: jax,
      r: [1.1 * k, 2.0 * k, 0.45 * k],
      pal: P_MOUTH,
      id: nid(),
      bias: sn > 0.3 ? -0.06 : 0.25,
      noSeam: true,
    });
  }
  // Клычки, когда пасть открыта.
  if (jw > 0.25 || sn > 0.4) {
    for (const side of [-1, 1]) {
      out.push({
        c: h.at([side * 1.0, 7.3, -3.6 - 0.25 * o.jaw + 0.15 * sn]),
        ax: axes(h.dir([0, 0.12, -1]), ey),
        r: [(HI ? 0.8 : 1.1) * k, (HI ? 0.36 : 0.45) * k, (HI ? 0.36 : 0.45) * k],
        pal: P_BONE,
        id: nid(),
        bias: 0.1,
        noSeam: true,
      });
    }
  }
  ears(flats, c);
}

/** Уши: круглые, белая кайма, тёмная середина; поворачиваются вбок, дёргаются. */
function ears(flats: Flat[], c: Ctx): void {
  const { o, h } = c;
  for (const side of [-1, 1] as const) {
    const back = side < 0 ? o.earL : o.earR;
    const fl = side < 0 ? o.flL : o.flR;
    const tn = side < 0 ? o.turnL : o.turnR;
    const base: V3 = [side * 4.9, -1.2, 4.4];
    const rot = (p: V3): V3 => {
      let q = sub(p, base);
      q = yawZ0(q, side * 1.05 * tn);
      q = pitchX(q, -0.8 * back - 0.3 * fl);
      q = rollY(q, side * (0.32 + 0.45 * fl + 0.2 * Math.max(0, back)));
      return h.at(add(q, base));
    };
    const ring = (rx: number, rz: number, dz: number, dy: number): V3[] => {
      const pts: V3[] = [];
      for (let j = 0; j <= 8; j++) {
        const a = (Math.PI * j) / 8;
        pts.push([base[0] + rx * Math.cos(a), base[1] + dy, base[2] + dz + rz * Math.sin(a)]);
      }
      return pts;
    };
    const outer = ring(2.5, 4.6, 0, 0);
    flats.push({
      pts: outer.map(rot),
      apex: rot(outer[4]),
      a: rot(outer[0]),
      b: rot(outer[8]),
      pal: P_PALE,
      id: nid(),
      shade: (_u, r) => -0.06 - 0.12 * (1 - r) ** 2,
    });
    const inner = ring(1.45, 3.1, 0.3, 0.35);
    flats.push({
      pts: inner.map(rot),
      apex: rot(inner[4]),
      a: rot(inner[0]),
      b: rot(inner[8]),
      pal: P_MASK,
      id: nid(),
      shade: (u, r) => 0.18 * r + (HI && Math.abs(u - 0.5) < 0.12 && r > 0.3 ? 0.12 : 0),
    });
  }
}

// ---------------------------------------------------------------------------
// Стетоскоп, валун.
// ---------------------------------------------------------------------------

/** Головка стетоскопа: в покое на животе, в трюке — в левой руке. */
function bellPos(c: Ctx): V3 {
  const { o, S, lag } = c;
  const rest = add(frontAt(S, 0, 12.0, 0.7), [
    (lag.bellX - S.bc[0]) * 0.9,
    0,
    (lag.bellZ - S.bc[2]) * 0.6,
  ]);
  if (o.bell <= 0.001) return rest;
  return lerp3(rest, mul(BELL_AT, G), o.bell);
}

function bellParts(out: PartF[], c: Ctx): void {
  const { o, S } = c;
  if (o.curl > 0.5) return;
  const k = S.k;
  const p = bellPos(c);
  // Лицом к зрителю, в руке — к валуну (вниз).
  // В руке — по нормали валуна (прижата к нему, видна спереди овалом).
  const fwd = norm(lerp3([0, 1, 0.1], [-0.24, 0.7, 0.67], o.bell));
  const ax = axes([1, 0, 0], fwd);
  out.push({
    c: add(p, mul(fwd, -0.25 * k)),
    ax,
    r: [1.75 * k, 1.75 * k, 0.55 * k],
    pal: P_RUBBER,
    id: nid(),
    bias: 0.1,
    noSeam: true,
  });
  out.push({
    c: p,
    ax,
    r: [1.4 * k, 1.4 * k, 0.6 * k],
    pal: P_STEEL,
    id: nid(),
    bias: 0.12,
    noSeam: true,
    tex: (qx, qy) => {
      const e = qx * qx + qy * qy;
      if (!HI) return e < 0.2 ? 0.12 : 0;
      if (e < 0.12) return 0.18;
      if (e < 0.4) return -0.2;
      return 0;
    },
  });
}

/** Наружная корка валуна: пятна, светлые крапины, слой. */
function stoneTex(qx: number, qy: number, qz: number): number {
  const u = Math.atan2(qx, qy) * (HI ? 4.2 : 2.6);
  const v = qz * (HI ? 5 : 3);
  const cu = Math.floor(u);
  const cv = Math.floor(v);
  const hh = hash(cu, cv, 31);
  let d = 0;
  if (hh > 0.62) d -= 0.1;
  else if (hh < 0.18) d += 0.06;
  if (HI && Math.abs(qz - 0.1 - 0.2 * qx) < 0.03) d -= 0.12;
  if (HI && hash(Math.floor(u * 3), Math.floor(v * 3), 5) > 0.93) d += 0.12;
  return d;
}

/** Грань раскола: светлый камень по кромке, в середине — тёмная жеода с самородками руды. */
function oreFace(_qx: number, qy: number, qz: number): number {
  const e = qy * qy + qz * qz;
  if (e > 0.78) {
    PICK_T = -0.06;
    return P_STONE;
  }
  const n = HI ? 4.4 : 2.6;
  const gu = (qy + 1) * n;
  const gv = (qz + 1) * n;
  const cu = Math.floor(gu);
  const cv = Math.floor(gv);
  const fu = gu - cu - 0.5;
  const fv = gv - cv - 0.5;
  const r = fu * fu + fv * fv;
  const rich = e < 0.45 ? 0.3 : 0.62;
  if (hash(cu, cv, 11) > rich && r < (HI ? 0.15 : 0.2)) {
    PICK_T = fu + fv < -0.2 ? 0.2 : fu + fv > 0.25 ? -0.12 : 0.04;
    return P_ORE;
  }
  if (e < 0.45) {
    PICK_T = -0.2 + (HI && hash(Math.floor(gu * 2), Math.floor(gv * 2), 3) > 0.85 ? 0.16 : 0);
    return P_STONE;
  }
  PICK_T = 0.14;
  return P_STONE;
}

function rockParts(out: PartF[], c: Ctx): void {
  const { o } = c;
  if (o.rock < 0.01) return;
  ROCK_IDS = [];
  const g = G;
  const C: V3 = mul(ROCK_C, g);
  const Rr: V3 = mul(ROCK_R, g);
  if (o.split < 0.02) {
    const id = nid();
    ROCK_IDS.push(id);
    out.push({
      c: C,
      ax: axes([1, 0, 0.06], [0, 0, 1]),
      r: Rr,
      pal: P_STONE,
      id,
      bias: -0.02,
      tex: stoneTex,
      vis: o.rock,
    });
    return;
  }
  const sp = o.split;
  for (const side of [-1, 1] as const) {
    const b = 0.22 * Math.min(1, sp);
    const cr = 0.42 * sp;
    const e1 = rollY([Math.cos(b), -side * Math.sin(b), 0], side * cr);
    const e3 = rollY([0, 0, 1], side * cr);
    const id = nid();
    ROCK_IDS.push(id);
    out.push({
      c: add(C, [side * 3.6 * sp * g, 0.4 * sp * g, -0.8 * sp * g]),
      ax: axes(e1, e3),
      r: Rr,
      pal: P_STONE,
      id,
      bias: -0.02,
      tex: stoneTex,
      vis: o.rock,
      cut: { m: [side < 0 ? 1 : -1, 0, 0], d: 0, face: oreFace },
    });
  }
  // Сердцевина — самородки руды между половинками.
  const gk = clamp01(sp * 1.6);
  for (const [x, y, z, r] of [
    [0, 10.4, 2.6, 2.5],
    [-1.9, 11.4, 1.6, 1.7],
    [1.9, 11.0, 1.5, 1.6],
    [0.6, 11.8, 4.9, 1.5],
    [-0.9, 12.6, 3.4, 1.2],
  ]) {
    out.push({
      c: [x * g, y * g, z * g],
      ax: axes([1, 0.2 * x, 0.1], [0, 0.3, 1]),
      r: [r * gk * g, r * 0.85 * gk * g, r * 0.8 * gk * g],
      pal: P_ORE,
      id: nid(),
      bias: 0.06,
      vis: o.rock,
      tex: (qx, qy, qz) => (HI && qx - qz > 0.7 ? 0.14 : HI && qx + qy * 0.3 < -0.6 ? -0.12 : 0),
      noSeam: true,
    });
  }
}

// ---------------------------------------------------------------------------
// Свой растр: части с выбором палитры, срезом и проявлением; плоские части; прутья.
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
    const cut = pt.cut;
    // Грань среза в координатах модели: градиент m·q.
    let cn: V3 = [0, 0, 0];
    let cmd = 0;
    if (cut) {
      cn = norm(add(add(mul(e1, cut.m[0] / r1), mul(e2, cut.m[1] / r2)), mul(e3, cut.m[2] / r3)));
      cmd = cut.m[0] * qdx + cut.m[1] * qdy + cut.m[2] * qdz;
    }
    const vis = pt.vis ?? 1;
    for (let py = y0; py <= y1; py++) {
      const sy = py + 0.5 - oy;
      const dy0 = sy * SE - pt.c[1];
      const dz0 = -sy * CE - pt.c[2];
      for (let px = x0; px <= x1; px++) {
        if (vis < 1 && !dith(px, py, vis)) continue;
        const dx0 = px + 0.5 - ox - pt.c[0];
        const q0x = (dx0 * e1[0] + dy0 * e1[1] + dz0 * e1[2]) / r1;
        const q0y = (dx0 * e2[0] + dy0 * e2[1] + dz0 * e2[2]) / r2;
        const q0z = (dx0 * e3[0] + dy0 * e3[1] + dz0 * e3[2]) / r3;
        const b = 2 * (q0x * qdx + q0y * qdy + q0z * qdz);
        const cc = q0x * q0x + q0y * q0y + q0z * q0z - 1;
        const disc = b * b - 4 * a * cc;
        if (disc < 0) continue;
        let t = (-b + Math.sqrt(disc)) / (2 * a);
        let onCut = false;
        if (cut) {
          const m0 = cut.m[0] * q0x + cut.m[1] * q0y + cut.m[2] * q0z;
          if (m0 + t * cmd > cut.d) {
            // Ближняя точка отрезана: видна грань среза, если она внутри.
            if (cmd <= 0) continue;
            const tp = (cut.d - m0) / cmd;
            const t1 = (-b - Math.sqrt(disc)) / (2 * a);
            if (tp < t1) continue;
            t = tp;
            onCut = true;
          }
        }
        const i = py * w + px;
        if (t <= zb[i]) continue;
        const qx = q0x + t * qdx;
        const qy = q0y + t * qdy;
        const qz = q0z + t * qdz;
        let pal = pt.pal;
        let k: number;
        PICK_T = 0;
        if (onCut && cut) {
          pal = cut.face(qx, qy, qz);
          const lam = dot(cn, LIGHT);
          k = Math.max(0, lam * 0.55 + 0.45) + PICK_T;
        } else {
          const ax1 = pt.tube ? 0 : qx / r1;
          const nx = e1[0] * ax1 + (e2[0] * qy) / r2 + (e3[0] * qz) / r3;
          const ny = e1[1] * ax1 + (e2[1] * qy) / r2 + (e3[1] * qz) / r3;
          const nz = e1[2] * ax1 + (e2[2] * qy) / r2 + (e3[2] * qz) / r3;
          const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
          const lam = (nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]) / nl;
          const bounce = Math.max(0, -nz / nl) * 0.14;
          if (pt.pick) pal = pt.pick(qx, qy, qz);
          k = Math.max(0, lam * 0.6 + 0.4 + bounce) + PICK_T;
          if (pt.tex) k += pt.tex(qx, qy, qz);
        }
        if (pt.bias) k += pt.bias;
        const N = pals[pal].length;
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
 * Прут прямо в кадр (с глубиной): малая — линия в пиксель, крупная — толще,
 * светлая сторона к свету. `vis` — шахматка проявления.
 */
function rod(f: Frame, a: V3, b: V3, wid: number, pal: number, tone: number, vis = 1): void {
  const A = project(mul(a, RR));
  const Bp = project(mul(b, RR));
  const ax = OX + A[0];
  const ay = OY + A[1];
  const bx = OX + Bp[0];
  const by = OY + Bp[1];
  const rad = (wid * RR) / 2;
  const N = PAL[pal].length;
  const put = (x: number, y: number, d: number, tn: number) => {
    if (x < 0 || y < 0 || x >= f.w || y >= f.h) return;
    if (vis < 1 && !dith(x, y, vis)) return;
    const i = y * f.w + x;
    if (d <= f.zb[i]) return;
    f.zb[i] = d;
    f.pal[i] = pal;
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
        lerp(A[2], Bp[2], u) + 0.8 * RR,
        tone,
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
      const dist = Math.hypot(ex, ey);
      if (dist > rad) continue;
      // Сторона к свету (вверх-влево) светлее.
      const side = (-dy * -0.7 + dx * -0.7) / ln;
      const lit = (ex * -dy + ey * dx) / ln;
      const tn = tone + (lit * side > 0.15 * rad ? 1 : lit * side < -0.3 * rad ? -2 : 0);
      put(x, y, lerp(A[2], Bp[2], u) + 0.8 * RR, tn);
    }
}

/** Ломаная из прутьев по точкам. */
function rods(f: Frame, pts: V3[], wid: number, pal: number, tone: number, vis = 1): void {
  for (let i = 0; i + 1 < pts.length; i++) rod(f, pts[i], pts[i + 1], wid, pal, tone, vis);
}

/** Трубки стетоскопа: от шеи по груди к развилке, от неё — к головке. */
function stethoscope(f: Frame, c: Ctx): void {
  const { o, S } = c;
  if (o.curl > 0.5) return;
  const wid = HI ? 1.0 : 0.7;
  const tn = HI ? 3 : 4;
  const Y = frontAt(S, 0, 14.0, 0.7);
  for (const side of [-1, 1]) {
    const N0 = frontAt(S, side * 4.6, 20.6, 0.5);
    const M0 = frontAt(S, side * 6.3, 17.4, 0.6);
    const J0 = frontAt(S, side * 2.2, 14.6, 0.7);
    const pts: V3[] = [];
    const n = HI ? 12 : 7;
    for (let i = 0; i <= n; i++) pts.push(catmull([N0, M0, J0, Y], i / n));
    rods(f, pts, wid, P_RUBBER, tn);
  }
  // Ствол к головке: провисает, когда головка в руке.
  const B = bellPos(c);
  const mid = add(lerp3(Y, B, 0.5), [0, 0.6 * o.bell, -1.6 * o.bell]);
  const pts: V3[] = [];
  const n = HI ? 10 : 5;
  for (let i = 0; i <= n; i++) pts.push(bezQ(Y, mid, B, i / n));
  rods(f, pts, wid, P_RUBBER, tn);
}

/** Инструменты в петлях скрутки: отвёртки (красная, синяя), напильник, отмычка. */
function tools(f: Frame, c: Ctx): void {
  const { o, S } = c;
  if (o.curl > 0.5) return;
  const pl = S.pl;
  for (const [x, kind] of TOOLS) {
    const qx = x / pl.bodyR[0];
    const zTop = pl.body[2] + pl.bodyR[2] * (bandC(qx) + BAND_H);
    const base = frontAt(S, x, zTop - 0.6, 0.55);
    const tip = frontAt(S, x, zTop + (kind === 'pick' ? 3.0 : kind === 'file' ? 2.8 : 2.4), 0.55);
    if (kind === 'red' || kind === 'blue') {
      const pal = kind === 'red' ? P_RED : P_BLUE;
      rod(f, base, tip, HI ? 1.6 : 1.0, pal, HI ? 4 : 5);
      if (HI) {
        // Кант на ручке и стальной хвостик под ней.
        const mid = lerp3(base, tip, 0.45);
        rod(f, mid, lerp3(mid, tip, 0.12), 1.7, pal, 2);
      }
    } else if (kind === 'file') {
      rod(f, base, tip, HI ? 1.1 : 0.7, P_STEEL, HI ? 5 : 6);
      if (HI) {
        // Насечка — тёмные риски поперёк.
        for (let j = 1; j < 5; j++) {
          const p = lerp3(base, tip, j / 5.5);
          rod(f, add(p, [-0.35, 0.05, 0]), add(p, [0.35, 0.05, 0.12]), 0.4, P_STEEL, 3);
        }
      }
    } else {
      rod(f, base, tip, 0.6, P_STEEL, HI ? 6 : 7);
      // Крючок отмычки — наружу.
      const hook = add(tip, [0.9, 0.1, -0.5]);
      rod(f, tip, hook, 0.6, P_STEEL, HI ? 6 : 7);
    }
  }
}

/** Молоточек в правой руке: деревянная ручка, стальной боёк поперёк. */
function hammerAt(c: Ctx): { grip: V3; head: V3; d: V3; n: V3 } {
  const { o, S } = c;
  const a = o.hamA;
  const d = norm([-Math.sin(a), 0.3, Math.cos(a)]);
  const n: V3 = [Math.cos(a), 0, Math.sin(a)];
  const grip = add(S.handR, mul(d, 0.8 * S.k));
  const head = add(grip, mul(d, 5.0 * S.k));
  return { grip, head, d, n };
}

function hammer(f: Frame, c: Ctx): void {
  const { o, S } = c;
  if (o.ham < 0.02) return;
  const { grip, head, n } = hammerAt(c);
  const k = S.k;
  rod(f, grip, head, HI ? 0.9 : 0.7, P_WOOD, HI ? 5 : 6, o.ham);
  rod(
    f,
    add(head, mul(n, -1.9 * k)),
    add(head, mul(n, 1.6 * k)),
    HI ? 1.7 : 1.4,
    P_STEEL,
    HI ? 5 : 6,
    o.ham,
  );
}

/** Крупная: редкая шахматка на границе двух ступеней одной части — мягкий переход. */
function softBands(f: Frame): void {
  const { w, h, pal, tone, idb } = f;
  const hit: number[] = [];
  for (let y = 0; y < h - 1; y++)
    for (let x = 0; x < w - 1; x++) {
      const i = y * w + x;
      const pl = pal[i];
      if (pl !== P_FUR && pl !== P_PALE && pl !== P_STONE && pl !== P_GLOVE) continue;
      for (const j of [i + w, i + 1]) {
        if (pal[j] === pl && idb[j] === idb[i] && tone[j] === tone[i] - 1 && dith(x, y, 0.28))
          hit.push(j, tone[i]);
      }
    }
  for (let n = 0; n < hit.length; n += 2) f.tone[hit[n]] = hit[n + 1];
}

// ---------------------------------------------------------------------------
// Поверх кадра: глаза, нос, рот, трещина, искры, волны, сон.
// ---------------------------------------------------------------------------

function eyePal(): Record<string, RGBA> {
  // У золотого маска — бронза: радужка янтарная, иначе глаз тонет.
  const iris =
    V === 1
      ? ramp('#2a1004', '#5a2a08', '#8a4a10', '#c07a20', '#eaa840')
      : ramp('#140a04', '#2a1810', '#4a2c18', '#6a4426', '#8a5c34');
  const pale = PAL[P_PALE];
  return {
    K: INK_V[V],
    W: hx('#fffbf0'),
    w: hx('#d8d2c4'),
    a: iris[4],
    b: iris[3],
    c: iris[2],
    d: iris[1],
    e: iris[0],
    l: pale[5],
    m: pale[3],
  };
}
// Малая: глаз 2×2 — блик и карий; закрытые — светлой чертой (на чёрной маске тёмная пропадёт).
const EYES_S: Record<string, string[]> = {
  open: ['Wb', 'cd'],
  openL: ['bW', 'dc'],
  wide: ['Wb', 'cd'],
  half: ['..', 'Wc'],
  shut: ['..', 'll'],
  happy: ['.l.', 'l.l'],
  sleep: ['...', 'lll'],
  angry: ['W.', 'cd'],
};
// Крупная: круглая бусина 5×5, два блика, низ светлее; веки — светлой дугой.
const EYES_L: Record<string, string[]> = {
  open: ['.ddd.', 'dWWcd', 'dWbcd', 'dbaWd', '.ccc.'],
  openL: ['.ddd.', 'dcWWd', 'dcbWd', 'dWabd', '.ccc.'],
  wide: ['.ddd.', 'dWWcd', 'dWbcd', 'dbaWd', '.ccc.'],
  half: ['.....', '.mmm.', 'dWbcd', 'dbaWd', '.ccc.'],
  shut: ['.....', '.....', 'm...m', '.lll.', '.....'],
  happy: ['.....', '.lll.', 'l...l', '.....', '.....'],
  sleep: ['.....', '.....', 'l...l', '.lll.', '.....'],
  angry: ['.....', 'mm...', 'dWmm.', 'dbaWd', '.ccc.'],
};

function face(p: Px, f: Frame, c: Ctx): void {
  const { o, h } = c;
  const ep = eyePal();
  for (const side of [-1, 1] as const) {
    const at = seen(f, mul(h.at([side * 3.3, 6.0, 0.9]), RR), OX, OY, 2.4 * RR);
    if (!at) continue;
    let key: string = (side < 0 ? o.eyeL : o.eyeR) ?? o.eye;
    if (key === 'open' || key === 'angry' || key === 'wide') {
      if (o.blink > 0.7) key = 'shut';
      else if (o.blink > 0.25) key = 'half';
    }
    if (key === 'open' && o.look < -0.4) key = 'openL';
    const rows = HI ? EYES_L[key] : EYES_S[key];
    const wdt = rows[0].length;
    const flip = side > 0 && (key === 'angry' || key === 'half');
    if (HI) stamp(p, rows, ep, at[0] - 2, at[1] - 2, flip);
    else stamp(p, rows, ep, at[0] - (wdt === 3 ? 1 : side < 0 ? 1 : 0), at[1] - 1, flip);
  }
  // Нос: блик (крупная — и ноздри).
  const nose = seen(f, mul(h.at([0, 8.95, -1.3]), RR), OX, OY, 1.6 * RR);
  if (nose) {
    const nl = PAL[P_NOSE];
    if (HI) {
      p.set(nose[0] - 1, nose[1] - 1, nl[5]);
      p.set(nose[0], nose[1] - 1, nl[4]);
      p.set(nose[0] - 1, nose[1] + 1, INK_V[V]);
      p.set(nose[0] + 1, nose[1] + 1, INK_V[V]);
    } else p.set(nose[0], nose[1] - 1, nl[5]);
  }
  // Рот «ω» (крупная): от носа вниз и двумя дугами.
  if (HI && o.jaw < 0.12 && o.snarl < 0.3) {
    const ink = mixc(PAL[P_PALE][1], INK_V[V], 0.45);
    const gr = o.grin;
    const pts: V3[] = [
      [0, 8.3, -2.6],
      [0, 8.1, -3.0],
      [-0.6, 7.8, -3.35],
      [0.6, 7.8, -3.35],
      [-1.25, 7.4, -3.2 + 0.2 * gr],
      [1.25, 7.4, -3.2 + 0.2 * gr],
      [-1.8, 6.9, -2.9 + 0.35 * gr],
      [1.8, 6.9, -2.9 + 0.35 * gr],
    ];
    for (const q of pts) {
      const at = seen(f, mul(h.at(q), RR), OX, OY, 1.6 * RR);
      if (at) p.set(at[0], at[1], ink);
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

/** Трещина по целому валуну: зигзаг от места удара вниз. */
function crack(p: Px, f: Frame, c: Ctx): void {
  const { o } = c;
  if (o.crack < 0.02 || o.split > 0.02 || o.rock < 0.5) return;
  const g = G;
  const col = PAL[P_STONE][1];
  const n = HI ? 40 : 16;
  for (let s = 0; s <= n; s++) {
    const u = (s / n) * o.crack;
    const qz = 0.98 - 1.25 * u;
    const qx = 0.07 * Math.sin(u * 19) + 0.02;
    const qy = Math.sqrt(Math.max(0, 1 - qx * qx - qz * qz));
    const w: V3 = [
      (ROCK_C[0] + qx * ROCK_R[0]) * g,
      (ROCK_C[1] + qy * ROCK_R[1]) * g,
      (ROCK_C[2] + qz * ROCK_R[2]) * g,
    ];
    const at = seen(f, mul(w, RR), OX, OY, 2 * RR);
    if (!at) continue;
    const i = at[1] * f.w + at[0];
    if (!ROCK_IDS.includes(f.idb[i])) continue;
    p.set(at[0], at[1], col);
  }
}

/** Искры: удар молоточка, блеск руды на гранях раскола. */
function sparks(p: Px, c: Ctx): void {
  const { o, t } = c;
  if (o.tap > 0.05 && o.ham > 0.5) {
    const { head, n } = hammerAt(c);
    const tipp = add(head, mul(n, -1.9 * c.S.k));
    const [sx, sy] = project(mul(tipp, RR));
    const L = Math.round(o.tap * (HI ? 5 : 2.4));
    if (L >= 1)
      star(p, Math.round(OX + sx), Math.round(OY + sy + RR), L, WHITE, hx('#ffe08a', 220));
  }
  if (o.glint > 0.05 && o.split > 0.3) {
    const g = G;
    for (const [side, dz, ph] of [
      [-1, 0.6, 0],
      [1, -0.4, 0.33],
      [-1, -1.4, 0.66],
    ] as [number, number, number][]) {
      const u = wrap(t * 2.2 + ph, 1);
      const L = Math.round(bump(u, 0, 0.6) * o.glint * (HI ? 4 : 2));
      if (L < 1) continue;
      const w: V3 = [(side * 1.4 + 0.3 * dz) * g, 12.6 * g, (4.6 + dz) * g];
      const [sx, sy] = project(mul(w, RR));
      star(p, Math.round(OX + sx), Math.round(OY + sy), L, WHITE, hx('#ffe08a', 220));
    }
  }
}

/** Слушает: от головки к валуну расходятся волны — по пустому фону. */
function ticks(p: Px, mask: Uint8Array, c: Ctx): void {
  const { o, t } = c;
  if (o.ticks < 0) return;
  const B = bellPos(c);
  const [bx, by] = project(mul(B, RR));
  const col = hx('#f4ead8');
  for (const t0 of [0.38, 0.54, 0.7]) {
    const u = (t - t0) / 0.3;
    if (u < 0 || u > 1) continue;
    const r = (2.4 + 5 * u) * RR;
    for (let a = -2.75; a <= -1.85; a += 0.5 / r) {
      const x = Math.round(OX + bx + Math.cos(a) * r);
      const y = Math.round(OY + by + Math.sin(a) * r);
      if (x < 0 || y < 0 || x >= p.w || y >= p.h || mask[y * p.w + x]) continue;
      if (!dith(x, y, 1.1 - u)) continue;
      p.set(x, y, col);
    }
  }
}

/** Хватка: лучи удара расходятся от морды — только по пустому фону. */
function snap(p: Px, mask: Uint8Array, c: Ctx): void {
  const { o, h } = c;
  const u = o.bite;
  const [sx, sy] = project(mul(h.at([0, 8.6, -2.4]), RR));
  const mx = OX + sx;
  const my = OY + sy;
  const col = hx('#fff4dc');
  const dim = hx('#f0c070');
  const vis = u < 0.6 ? 1.1 : (1 - u) / 0.4;
  const r0 = (HI ? 17 : 8.5) + u * (HI ? 8 : 4);
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
    const [sx, sy] = project(mul(h.at([5 + 3.5 * u, 0, 6 + 9 * u]), RR));
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
    // Голова отстаёт от шеи не больше чем на шаг (иначе в прыжке висит в воздухе).
    headX: lagged((tt) => sk(tt).head[0], 3.2, 0.32, (L0?.headX ?? 0) - S0.head[0], 1),
    headZ: lagged((tt) => sk(tt).head[2], 3.2, 0.32, (L0?.headZ ?? 0) - S0.head[2], 0.8),
    tailSw: lagged(
      (tt) => P(tt).tailSw + sk(tt).bc[0] * 0.08,
      2.0,
      0.22,
      (L0?.tailSw ?? 0) - P0.tailSw - S0.bc[0] * 0.08,
    ),
    tailUp: lagged(
      (tt) => P(tt).tailUp - 0.06 * sk(tt).bc[2],
      2.4,
      0.28,
      (L0?.tailUp ?? 0) - P0.tailUp + 0.06 * S0.bc[2],
    ),
    tailCurl: lagged((tt) => P(tt).tailCurl, 2.0, 0.35, (L0?.tailCurl ?? 0) - P0.tailCurl),
    bellX: lagged((tt) => sk(tt).bc[0], 1.8, 0.14, (L0?.bellX ?? 0) - S0.bc[0]),
    bellZ: lagged((tt) => sk(tt).bc[2], 2.0, 0.16, (L0?.bellZ ?? 0) - S0.bc[2]),
  };
  LAGS.set(key, r);
  return r;
}

function headF(o: Pose, S: Skel, lag: Lag): HeadF {
  const nb = o.nod + o.bow;
  const tl = o.tilt + o.lean;
  const dir = (v: V3): V3 => rollY(yawZ0(pitchX(v, nb), o.turn), tl);
  const k = S.k * (HI ? 1.0 : 1.04);
  const hc: V3 = [lag.headX, S.head[1], lag.headZ];
  return { dir, k, at: (p) => add(hc, mul(dir(p), k)) };
}

function toRes(parts: PartF[]): PartF[] {
  if (RR === 1) return parts;
  return parts.map((pt) => ({ ...pt, c: mul(pt.c, RR), r: mul(pt.r, RR) }));
}

/** Кадр `i` анимации `a` полосы `res`, вариант окраса `v` (0 — обычный, 1 — золотой). */
export function raccoonFrame(a: Anim, i: number, res: Res = 's', v = 0): Px {
  const cv = RES[res];
  RR = cv.box / RES.s.box;
  HI = res === 'l';
  OX = cv.bx + cv.box / 2;
  OY = cv.by + GROUND * RR;
  V = v === 1 ? 1 : 0;
  NEXT_ID = 0;
  ROCK_IDS = [];
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
  arms(parts, c);
  headParts(parts, flats, c);
  bellParts(parts, c);
  rockParts(parts, c);
  drawPartsF(f, toRes(parts), PAL, OX, OY);
  drawFlats(f, flats);
  tools(f, c);
  stethoscope(f, c);
  hammer(f, c);
  seams(f, 1.2 * RR, 1);
  rimLight(f, PAL, (pl) => pl !== P_MOUTH && pl !== P_NOSE && pl !== P_MASK && pl !== P_RUBBER);
  if (HI) softBands(f);
  const p = toPx(f, PAL);
  selOutline(p, INK_V[V], 0.8);
  const mask = new Uint8Array(p.w * p.h);
  for (let j = 0; j < mask.length; j++) mask[j] = p.data[j * 4 + 3] > 0 ? 1 : 0;
  face(p, f, c);
  crack(p, f, c);
  sparks(p, c);
  ticks(p, mask, c);
  if (a === 'sleep') zzz(p, mask, c);
  if (o.bite >= 0) snap(p, mask, c);
  return p;
}
