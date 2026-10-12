// Волк-вожак — пиксельный питомец по эталону боссов 12–14.
//
// Крупный серый вожак сидит анфас, как изваяние: густая грива-воротник
// вокруг шеи (пучки шерсти лежат черепицей — светлый верх, тёмный клин
// под каждым), пушистые щёки торчат в стороны, бледная маска на морде,
// тёмная полоса со лба на переносицу, бледные пятна над глазами, серая
// морда, большой чёрный нос, янтарные глаза под тяжёлыми бровями. Три
// когтистых шрама на правой щеке (слева в кадре), рваная зарубка на левом
// ухе (справа в кадре). Тяжёлый железный ошейник наполовину утонул в
// гриве; с кольца свисает оборванная цепь (последнее звено разомкнуто),
// сбоку — жестяной жетон с номером. Бледные лапы, пушистый хвост с тёмным
// кончиком поднят сбоку.
//
// Две полосы, у каждой свой рисунок: малая — рамка 48 (шахта, списки),
// крупная — рамка 112 (карточка, вылупление, Питомник): пучки гривы и
// хвоста, звенья цепи с дыркой, номер на жетоне, радужка, шрамы, пальцы.
//
// Анимации 24 к/с по ключам (`kf`): подготовка → разгон → пик → проводка
// → возврат. Голова, грива, хвост, цепь и жетон — те же ключи с
// запаздыванием (`spring`). Трюк — вой: морда вверх, из-за спины встаёт
// полная луна, вой расходится кольцами, потом волк опускает голову и
// смотрит прямо на зрителя. Ходьба — стоя, рысью на зрителя.
//
// Золотой рисуется здесь же (`v` = 1) своими палитрами: шерсть — золото,
// тень — бронза, свет — бледное золото; железо, глаза и нос остаются
// читаемыми. Радужного нет.

import type { Px } from '../dungeon-art';
import {
  add,
  axes,
  bump,
  clamp01,
  cross,
  dith,
  dot,
  drawParts,
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
const P_IRON = 2;
const P_TIN = 3;
const P_NOSE = 4;
const P_MOUTH = 5;
const P_BONE = 6;
const P_EAR = 7;

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
const TIN = ramp('#3a3c38', '#5c5f59', '#80837c', '#a4a79f', '#c4c7bf', '#dee0d9', '#f4f5f0');
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

const PAL_V: RGBA[][][] = [
  [
    // Шерсть: холодная серая тень → тёплый светлый серый.
    ramp(
      '#121114',
      '#1c1b1f',
      '#28272b',
      '#363538',
      '#464446',
      '#585654',
      '#6c6965',
      '#827e78',
      '#99958d',
      '#b1ada4',
      '#c9c5bc',
      '#dfdcd4',
    ),
    // Бледное: маска, щёки, грудь, лапы.
    ramp(
      '#3c3731',
      '#58524a',
      '#756e63',
      '#928a7c',
      '#aea595',
      '#c7beae',
      '#dcd4c5',
      '#ece6da',
      '#f8f4ec',
    ),
    IRON,
    TIN,
    // Нос и подушечки.
    ramp('#070708', '#0f0e10', '#19171a', '#252226', '#353136', '#4a454c'),
    MOUTH,
    BONE,
    // Кожа в ушах.
    ramp('#3a2826', '#5a3e3a', '#7c5850', '#9e766a', '#be9686', '#dab8a8'),
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
    IRON,
    TIN,
    ramp('#0c0603', '#170c05', '#231308', '#311c0c', '#432812', '#5a381a'),
    MOUTH,
    BONE,
    ramp('#4a2a14', '#6c4020', '#90582c', '#b47640', '#d09658', '#e8b878'),
  ],
];
const INK_V: RGBA[] = [hx('#08080b'), hx('#1a0d02')];
const MOON = ramp('#4a4636', '#77705a', '#a9a080', '#cfc6a2', '#e8e0be', '#f6eecf', '#fffbea');
const HOWL: RGBA[] = [hx('#e4eef6'), hx('#9fb2c2'), hx('#5d6f80')];
const SCAR: RGBA[] = [hx('#e8b0a4'), hx('#a8645a'), hx('#6a3430')];

// ---------------------------------------------------------------------------
// Кадр: холст и рамка тела у двух полос (как у феникса и дракона).
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
/** Насколько шерсть темнее общего света рига (серый волк, а не белый). */
const FUR_DARK = 0.2;
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

type Eye = 'open' | 'happy' | 'angry' | 'sleep' | 'shut' | 'stare';

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
  /** Пасть: 0 — закрыта, 1 — настежь; оскал — губа вверх, клыки видны. */
  jaw: number;
  snarl: number;
  tongue: number;
  /** Уши: 0 — торчком, 1 — прижаты назад, < 0 — насторожены вперёд; дёрнуть ухом. */
  earL: number;
  earR: number;
  flL: number;
  flR: number;
  /** Хвост: вбок (+ — наружу) и вверх. */
  tailSw: number;
  tailUp: number;
  /** Передние лапы: подъём и вынос вперёд; задние — подъём. */
  fLz: number;
  fRz: number;
  fLy: number;
  fRy: number;
  hLz: number;
  hRz: number;
  eye: Eye;
  blink: number;
  /** Вдох: грудь и грива раздуваются. */
  chest: number;
  /** Луна за спиной: видимость и подъём (0…1). */
  moon: number;
  moonUp: number;
  /** Вой: секунды от начала (кольца), −1 — нет. */
  howl: number;
  glint: number;
  /** Хватка: челюсти-дуги смыкаются (0…1), −1 — нет. */
  bite: number;
  /** Стоит (ходьба) и свернулся (сон): 0 — сидит. */
  stand: number;
  curl: number;
  scale: number;
}

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
  tongue: 0,
  earL: 0,
  earR: 0,
  flL: 0,
  flR: 0,
  tailSw: 0,
  tailUp: 0,
  fLz: 0,
  fRz: 0,
  fLy: 0,
  fRy: 0,
  hLz: 0,
  hRz: 0,
  eye: 'open',
  blink: 0,
  chest: 0,
  moon: 0,
  moonUp: 0,
  howl: -1,
  glint: 0,
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
  // Два вдоха на петлю, второй мельче; пауза — у начала петли.
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
  o.hz = 0.3 * br;
  // Вожак оглядывается: медленно в сторону — и обратно.
  o.turn = loopK(t, T, [
    [0, 0],
    [0.95, 0],
    [1.35, 0.15, 'o'],
    [1.85, 0.15],
    [2.3, 0],
    [3, 0],
  ]);
  o.tilt = -0.3 * o.turn;
  o.lean = 0.014 * Math.sin((t / T) * TAU);
  o.x = 0.12 * Math.sin((t / T) * TAU);
  // Ухо с зарубкой дёргается дважды; моргание — своя фаза.
  o.flR = bump(t, 1.98, 2.1) + 0.6 * bump(t, 2.12, 2.22);
  o.blink = Math.max(bump(t, 0.52, 0.66), bump(t, 2.58, 2.68), bump(t, 2.74, 2.86));
  o.tailSw = 0.16 * Math.sin((t / T) * TAU);
  return o;
}

function walkPose(t: number): Pose {
  const T = dur('walk');
  const o: Pose = { ...REST };
  const h = wrap(t, T);
  o.stand = 1;
  // Рысь на зрителя: пары накрест — левая передняя с правой задней, потом наоборот.
  const la = bump(h, 0.02, 0.48);
  const lb = bump(h, 0.52, 0.98);
  o.fLz = 2.6 * la ** 0.8;
  o.fLy = 1.1 * la;
  o.hRz = 1.8 * la ** 0.8;
  o.fRz = 2.6 * lb ** 0.8;
  o.fRy = 1.1 * lb;
  o.hLz = 1.8 * lb ** 0.8;
  // Тело уходит на опорную пару, выше всего — посреди шага.
  const sw = Math.sin((h / T) * TAU);
  o.x = 0.55 * sw;
  o.lean = 0.05 * sw;
  o.z = 0.45 * Math.abs(sw) - 0.15;
  o.nod = 0.08 + 0.05 * Math.cos((h / T) * 2 * TAU);
  o.tilt = -0.05 * sw;
  o.hx = -0.25 * sw;
  o.earL = -0.15;
  o.earR = -0.15;
  o.tailSw = -0.55 * sw;
  o.tailUp = 0.15;
  return o;
}

function happyPose(t: number): Pose {
  const T = dur('happy');
  const o: Pose = { ...REST };
  // Два подскока на задних, передние лапы вверх; к концу — поза покоя.
  const rise = kf(t, [
    [0, 0],
    [0.1, -0.3, 'o'],
    [0.3, 1, 'o'],
    [0.42, 0.95],
    [0.56, -0.2, 'i'],
    [0.66, 0.5, 'o'],
    [0.76, 0.45],
    [0.88, -0.1, 'i'],
    [1.0, 0, 'o'],
    [T, 0],
  ]);
  const up = pos(rise);
  const env = 1 - clamp01((t - 0.86) / (T - 0.86));
  o.z = 1.8 * up;
  o.sq = -0.06 * rise;
  o.bow = -0.12 * up;
  const pad = Math.sin(t * TAU * 3) * up;
  o.fLz = 5.2 * up + 0.9 * pad;
  o.fRz = 5.2 * up - 0.9 * pad;
  o.fLy = 1.6 * up;
  o.fRy = 1.6 * up;
  o.nod = -0.14 * up;
  o.tilt = 0.14 * Math.sin((t / T) * TAU) * env;
  o.earL = -0.3 * env;
  o.earR = -0.3 * env;
  o.eye = t < 0.9 ? 'happy' : 'open';
  o.jaw = 0.34 * env;
  o.tongue = env;
  // Хвост метёт: три с половиной маха, к концу стихает.
  o.tailSw = 0.95 * Math.sin(TAU * 3.4 * t) * env;
  o.tailUp = 0.5 * env;
  return o;
}

function workPose(t: number): Pose {
  const o: Pose = { ...REST };
  // Голову вверх → вой к луне → голову вниз, взгляд прямо на зрителя → покой.
  const up = kf(t, [
    [0, 0],
    [0.12, -0.12, 'o'],
    [0.46, 1, 'o'],
    [1.3, 1],
    [1.52, -0.22, 's'],
    [1.76, -0.16],
    [2.0, 0, 's'],
  ]);
  const vib = Math.sin(t * TAU * 9) * bump(t, 0.6, 1.3);
  o.nod = up > 0 ? -1.05 * up + 0.04 * vib : -0.8 * up;
  o.turn = 0.85 * pos(up);
  o.tilt = -0.22 * pos(up);
  o.hy = -1.0 * pos(up);
  o.hz = 3.4 * pos(up) + 0.5 * neg(up);
  o.sq = -0.05 * pos(up);
  o.bow = -0.05 * pos(up);
  o.chest = kf(t, [
    [0, 0],
    [0.46, 1, 'o'],
    [0.62, 1],
    [1.3, 0.15],
    [1.6, 0],
  ]);
  o.jaw =
    kf(t, [
      [0, 0],
      [0.44, 0],
      [0.58, 0.5, 'o'],
      [1.15, 0.46],
      [1.28, 0.3],
      [1.42, 0, 's'],
    ]) +
    0.05 * vib;
  o.earL = -0.55 * pos(up) - 0.2 * bump(t, 0, 0.3);
  o.earR = o.earL;
  o.eye = t >= 0.42 && t < 1.38 ? 'shut' : t >= 1.44 && t < 1.88 ? 'stare' : 'open';
  // Луна встаёт из-за спины, к концу тает.
  o.moonUp = kf(t, [
    [0, 0],
    [0.08, 0],
    [0.9, 1, 'o'],
    [1.96, 1.05],
    [2, 0],
  ]);
  o.moon = kf(t, [
    [0, 0],
    [0.08, 1, 'l'],
    [1.66, 1],
    [1.96, 0, 'l'],
  ]);
  o.howl = t >= 0.58 && t < 1.9 ? t - 0.58 : -1;
  o.glint = bump(t, 1.54, 1.82);
  o.tailUp = 0.25 * pos(up);
  o.tailSw = 0.12 * Math.sin(t * TAU) * (1 - clamp01((t - 1.6) / 0.4));
  return o;
}

function attackPose(t: number): Pose {
  const T = dur('attack');
  const o: Pose = { ...REST };
  // Замах (присел, голова вниз, оскал) → бросок к зрителю, пасть настежь
  // (кадры 9–10) → хватка, встряхнул → возврат в покой.
  const l = kf(t, [
    [0, 0],
    [0.25, -1, 'o'],
    [0.3, -1.05],
    [0.38, 1, 'i'],
    [0.47, 0.92],
    [0.62, 0.35, 's'],
    [T, 0, 's'],
  ]);
  o.y = 4.2 * pos(l) - 1.2 * neg(l);
  o.scale = 1 + 0.16 * pos(l);
  o.sq = 0.1 * neg(l) - 0.03 * pos(l);
  o.z = -0.5 * neg(l) + 1.2 * pos(l);
  o.bow = 0.1 * neg(l) + 0.22 * pos(l);
  o.nod = 0.36 * neg(l) - 0.34 * pos(l);
  o.hy = 2.8 * pos(l) - 0.8 * neg(l);
  o.hz = -1.4 * pos(l) - 0.9 * neg(l);
  o.jaw = kf(t, [
    [0, 0],
    [0.22, 0.12],
    [0.3, 0.16],
    [0.37, 1, 'o'],
    [0.45, 1],
    [0.5, 0.1, 'i'],
    [0.6, 0.2],
    [0.72, 0, 's'],
  ]);
  o.snarl = kf(t, [
    [0, 0],
    [0.16, 1, 'o'],
    [0.52, 1],
    [0.78, 0, 's'],
  ]);
  const ears = kf(t, [
    [0, 0],
    [0.18, 0.95, 'o'],
    [0.56, 0.95],
    [0.86, 0, 's'],
  ]);
  o.earL = ears;
  o.earR = ears;
  o.eye = t < 0.68 ? 'angry' : 'open';
  // Встряхнул добычу после хватки.
  o.turn = 0.2 * Math.sin(((t - 0.5) / 0.17) * TAU) * bump(t, 0.5, 0.76);
  o.fLz = 2.4 * bump(t, 0.28, 0.6);
  o.fLy = 2.6 * bump(t, 0.28, 0.6);
  o.tailSw = -0.5 * bump(t, 0.05, 0.4) + 0.4 * bump(t, 0.4, 0.86);
  o.tailUp = 0.5 * bump(t, 0.1, 0.8);
  // Хватка: челюсти-дуги смыкаются перед мордой (кадры 9–12).
  o.bite = t >= 0.36 && t < 0.54 ? (t - 0.36) / 0.18 : -1;
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
  o.nod = 0.24 + 0.03 * br;
  o.tilt = 0.16;
  o.hz = 0.35 * br;
  o.sq = -0.06 * br;
  o.tailSw = 0.08 * br;
  o.earL = 0.55;
  o.earR = 0.55;
  // Во сне дёрнул ухом.
  o.flR = 0.6 * bump(t, 2.1, 2.24);
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
  chest: V3;
  chestR: V3;
  neck: V3;
  neckR: V3;
  head: V3;
  sh: V3;
  paw: V3;
  haunch: V3;
  haunchR: V3;
  hpaw: V3;
  /** Кольцо ошейника — откуда свисает цепь. */
  ring: V3;
  tail: V3[];
}
const SIT: Plan = {
  body: [0, -0.6, 11.4],
  bodyR: [7.2, 6.0, 10.0],
  chest: [0, 3.2, 14.0],
  chestR: [4.8, 3.6, 7.2],
  neck: [0, -0.6, 22.2],
  neckR: [10.2, 6.8, 7.6],
  head: [0, 3.4, 31.0],
  sh: [3.7, 4.0, 14.8],
  paw: [3.9, 7.6, 1.0],
  haunch: [7.4, -1.4, 5.8],
  haunchR: [4.6, 6.0, 5.6],
  hpaw: [9.4, 4.6, 1.0],
  ring: [0, 8.6, 20.8],
  tail: [
    [5.2, -5.4, 2.4],
    [9.6, -3.8, 1.9],
    [12.4, -0.4, 1.9],
    [12.6, 3.6, 2.0],
    [10.6, 6.9, 2.2],
    [7.4, 8.6, 2.4],
  ],
};
const STAND: Plan = {
  body: [0, -6.4, 14.4],
  bodyR: [6.0, 11.0, 6.0],
  chest: [0, 3.0, 13.0],
  chestR: [4.8, 3.4, 6.4],
  neck: [0, 1.2, 19.0],
  neckR: [9.4, 6.6, 6.6],
  head: [0, 5.4, 25.2],
  sh: [3.9, 3.0, 14.0],
  paw: [4.1, 4.6, 1.0],
  haunch: [4.6, -14.5, 13.4],
  haunchR: [3.6, 5.0, 5.0],
  hpaw: [4.4, -13.0, 1.0],
  ring: [0, 9.2, 19.4],
  tail: [
    [0, -20, 16.5],
    [1.2, -22.4, 17.0],
    [2.6, -24.2, 15.6],
    [3.8, -25, 13.0],
    [4.8, -25.2, 10.2],
    [5.4, -24.8, 7.4],
  ],
};
const CURL: Plan = {
  body: [0, -2.4, 5.4],
  bodyR: [10.4, 8.4, 5.4],
  chest: [0, 4.0, 4.6],
  chestR: [6.4, 3.6, 4.0],
  neck: [0, 1.6, 8.6],
  neckR: [9.6, 6.2, 5.2],
  head: [0, 6.2, 7.6],
  sh: [3.4, 6.0, 4.2],
  paw: [3.2, 11.6, 1.0],
  haunch: [8.4, -3.0, 4.6],
  haunchR: [4.8, 6.4, 4.6],
  hpaw: [10.6, 4.6, 1.0],
  ring: [0, 9.4, 6.4],
  tail: [
    [6.6, -5, 2.6],
    [11.6, 0.4, 2.6],
    [10.8, 8.0, 3.0],
    [5.6, 13.6, 3.6],
    [-1.2, 15.4, 4.6],
    [-5.2, 14.0, 5.2],
  ],
};

function planOf(o: Pose): Plan {
  const m = (k: keyof Plan): V3 =>
    lerp3(lerp3(SIT[k] as V3, STAND[k] as V3, o.stand), CURL[k] as V3, o.curl);
  return {
    body: m('body'),
    bodyR: m('bodyR'),
    chest: m('chest'),
    chestR: m('chestR'),
    neck: m('neck'),
    neckR: m('neckR'),
    head: m('head'),
    sh: m('sh'),
    paw: m('paw'),
    haunch: m('haunch'),
    haunchR: m('haunchR'),
    hpaw: m('hpaw'),
    ring: m('ring'),
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
  ring: V3;
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
  // Стоящая лапа не едет за телом: x и y — свои, подъём — только у поднятой.
  const lift = Math.max(0, o.z);
  const paw = (side: number, dy: number, dz: number): V3 => [
    side * pl.paw[0] * s + o.x * 0.2,
    pl.paw[1] * s + dy + o.y * 0.6,
    pl.paw[2] * s + dz + lift,
  ];
  const hp = (side: number, dz: number): V3 => [
    side * pl.hpaw[0] * s,
    pl.hpaw[1] * s + o.y * 0.3,
    pl.hpaw[2] * s + dz + lift * 0.3,
  ];
  return {
    up,
    pl,
    head: up(add(pl.head, [o.hx, o.hy, o.hz])),
    shL: up([-pl.sh[0], pl.sh[1], pl.sh[2]]),
    shR: up([pl.sh[0], pl.sh[1], pl.sh[2]]),
    pawL: paw(-1, o.fLy, o.fLz),
    pawR: paw(1, o.fRy, o.fRz),
    hpL: hp(-1, o.hLz),
    hpR: hp(1, o.hRz),
    ring: up(pl.ring),
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

// ---------------------------------------------------------------------------
// Узоры: шерсть пучками.
// ---------------------------------------------------------------------------

/**
 * Пучки шерсти черепицей (ось 3 — вверх): каждый пучок — острый кончик
 * вниз, светлый верх слева, тёмный клин под кончиком и между соседями.
 * Ряды сдвинуты на полпучка.
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

// ---------------------------------------------------------------------------
// Части.
// ---------------------------------------------------------------------------

interface Lag {
  headX: number;
  headZ: number;
  ruffZ: number;
  tailSw: number;
  tailUp: number;
  chX: number;
  chY: number;
  chZ: number;
  tgX: number;
  tgY: number;
  tgZ: number;
}

interface Ctx {
  o: Pose;
  S: Skel;
  h: HeadF;
  lag: Lag;
  t: number;
}

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
  out: Part[],
  p: V3,
  q: V3,
  r: number,
  ry: number,
  pal: number,
  id: number,
  op: Partial<Part> = {},
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

function legs(out: Part[], c: Ctx): void {
  const { o, S } = c;
  const k = S.k;
  const pl = S.pl;
  for (const side of [-1, 1] as const) {
    // Бедро: толстое, круглое «окорочко» сидящего зверя.
    const hc = S.up([side * pl.haunch[0], pl.haunch[1], pl.haunch[2]]);
    out.push({
      c: hc,
      ax: axes(rollY([1, 0, 0], side * 0.22 + o.lean), [0, 0, 1]),
      r: mul(pl.haunchR, k),
      pal: P_FUR,
      id: nid(),
      bias: -0.03,
      tex: HI ? tufts(5, 3.2, 0.09, 0.9) : undefined,
    });
    // Задняя лапа: у стоящего — голень от бедра к ступне.
    const hp = side < 0 ? S.hpL : S.hpR;
    if (o.stand > 0.05) {
      const knee = add(lerp3(hc, hp, 0.5), [0, -1.4 * k, 0]);
      const lid = nid();
      limb(out, add(hc, [0, 0, -2.4 * k]), knee, 2.0 * k, 2.2 * k, P_FUR, lid, { bias: -0.06 });
      limb(out, knee, hp, 1.5 * k, 1.6 * k, P_PALE, lid, { bias: -0.08 });
    }
    // Задняя ступня: длинная, носком вперёд и чуть наружу.
    const fid = nid();
    out.push({
      c: add(hp, [0, 0.4 * k, 0.25 * k]),
      ax: axes(norm([side * 0.3 * (1 - o.stand), 1, 0]), [0, 0, 1]),
      r: [3.0 * k, 2.1 * k, 1.35 * k],
      pal: P_PALE,
      id: fid,
      bias: -0.2,
      tex: toes(HI ? 4 : 2),
    });
    // Передняя лапа: плечо → локоть → кисть на полу; бледная, «носок» светлее.
    const sh = side < 0 ? S.shL : S.shR;
    const paw = side < 0 ? S.pawL : S.pawR;
    const lift = Math.max(0, (side < 0 ? o.fLz : o.fRz) - Math.max(0, o.z));
    const elbow = add(lerp3(sh, paw, 0.5), [side * 0.2 * k, (0.4 + lift * 0.45) * k, 0]);
    const lid = nid();
    limb(out, sh, elbow, 2.1 * k, 2.3 * k, P_PALE, lid, { bias: -0.08 });
    limb(out, elbow, paw, 1.8 * k, 1.9 * k, P_PALE, lid, { bias: -0.02 });
    out.push({
      c: add(paw, [0, 0.5 * k, 0.25 * k]),
      ax: axes(norm([side * 0.06, 1, -lift * 0.12]), [0, 0, 1]),
      r: [2.6 * k, 2.2 * k, 1.35 * k],
      pal: P_PALE,
      id: lid,
      bias: 0.02,
      tex: toes(HI ? 4 : 2),
    });
    if (HI) {
      // Когти: тёмные капли на кончиках пальцев.
      for (const a of [-0.45, -0.15, 0.15, 0.45]) {
        out.push({
          c: add(paw, [(a * 3.4 + side * 0.1) * k, 2.9 * k, -0.15 * k]),
          ax: axes(norm([a * 0.3, 1, -0.6]), [0, 0, 1]),
          r: [0.7 * k, 0.4 * k, 0.4 * k],
          pal: P_NOSE,
          id: nid(),
          bias: 0.35,
          noSeam: true,
        });
      }
    }
  }
}

/** Пальцы: тёмные щели спереди лапы (ось 1 — вперёд). */
function toes(n: number) {
  return (qx: number, qy: number, qz: number) => {
    if (qx < 0.2 || qz < -0.4) return 0;
    const u = ((qy + 1) / 2) * n;
    const fu = u - Math.floor(u);
    return Math.floor(u) > 0 && fu < (HI ? 0.16 : 0.22) ? -0.26 : 0;
  };
}

function torso(out: Part[], c: Ctx): void {
  const { o, S } = c;
  const k = S.k;
  const pl = S.pl;
  const ch = o.chest;
  const ax = axes(rollY([1, 0, 0], o.lean), pitchX([0, 0, 1], o.bow * 0.5));
  // Туловище: тёмная спина и бока (чепрак), почти всё закрыто гривой и бёдрами.
  out.push({
    c: S.up(pl.body),
    ax,
    r: [pl.bodyR[0] * (1 + 0.03 * ch) * k, pl.bodyR[1] * k, pl.bodyR[2] * (1 + 0.02 * ch) * k],
    pal: P_FUR,
    id: nid(),
    bias: -0.1,
    tex: HI ? tufts(7, 5, 0.07) : undefined,
  });
  // Бледная грудь: пряди вниз.
  out.push({
    c: S.up(add(pl.chest, [0, 0.4 * ch, 0])),
    ax,
    r: [pl.chestR[0] * (1 + 0.05 * ch) * k, pl.chestR[1] * (1 + 0.12 * ch) * k, pl.chestR[2] * k],
    pal: P_PALE,
    id: nid(),
    bias: -0.05,
    tex: tufts(HI ? 7 : 3, HI ? 4 : 2.2, HI ? 0.1 : 0.08),
  });
}

/**
 * Грива: серое облако от щёк до середины груди (голова сидит в нём), по
 * бокам спадает на плечи; спереди — бледный нагрудник; по нижней кромке и
 * по бокам — пряди остриём вниз (выпуклые «облака», не пила).
 */
function ruff(out: Part[], c: Ctx): void {
  const { o, S, lag } = c;
  const k = S.k;
  const pl = S.pl;
  const ch = o.chest;
  const dz = lag.ruffZ - S.up(pl.neck)[2];
  // Шея тянется за головой (вой): грива поднимается вслед.
  const R = (p: V3): V3 => add(S.up(p), [0, 0.4 * o.hy, dz + 0.55 * o.hz]);
  const ax = axes(rollY([1, 0, 0], o.lean), pitchX([0, 0, 1], o.bow * 0.5));
  const ry = 1 + 0.05 * ch;
  const nr = pl.neckR;
  const nc = pl.neck;
  out.push({
    c: R(nc),
    ax,
    r: [nr[0] * ry * k, nr[1] * ry * k, nr[2] * k],
    pal: P_FUR,
    id: nid(),
    bias: 0.02,
    tex: tufts(HI ? 5 : 3.5, HI ? 5 : 3.4, HI ? 0.13 : 0.11, 1.05),
  });
  // Грива спадает на плечи.
  for (const side of [-1, 1]) {
    out.push({
      c: R([side * nr[0] * 0.58, nc[1] + 0.6, nc[2] - nr[2] * 0.62]),
      ax: axes(rollY([1, 0, 0], o.lean - side * 0.25), [0, 0, 1]),
      r: [3.6 * k, 4.6 * k, 5.0 * k],
      pal: P_FUR,
      id: nid(),
      bias: -0.02,
      tex: tufts(HI ? 6 : 3, HI ? 4 : 2, HI ? 0.14 : 0.1),
    });
  }
  // Бледный нагрудник под ошейником.
  out.push({
    c: R([0, nc[1] + 4.6, nc[2] - 5.0]),
    ax,
    r: [5.0 * ry * k, 3.1 * ry * k, 5.4 * k],
    pal: P_PALE,
    id: nid(),
    bias: -0.08,
    tex: tufts(HI ? 6 : 2.5, HI ? 3.5 : 1.8, HI ? 0.13 : 0.1, 1.1),
  });
  // Пряди по кромке гривы розеткой: снизу — вниз (бледные посередине), по
  // бокам — наружу и вниз, выше — к ушам. Второй, внутренний ряд короче и
  // ложится на концы ошейника.
  const rows: [number, number, number, number][] = HI
    ? [
        [9, 1, 0, 0],
        [5, 0.72, 0.9, 0.5],
      ]
    : [
        [7, 1, 0, 0],
        [4, 0.7, 0.9, 0.5],
      ];
  for (const [n, kl, dy, sh] of rows) {
    for (let i = 0; i < n; i++) {
      const a = lerp(-2.05, 2.05, (i + sh) / (n - 1 + sh * 2));
      if (kl < 1 && Math.abs(a) < 0.7) continue;
      const sa = Math.sin(a);
      const ca = Math.cos(a);
      const pale = Math.abs(a) < 0.42 && kl === 1;
      const base: V3 = [
        nr[0] * 0.7 * kl * sa,
        nc[1] + dy + nr[1] * (0.82 * Math.max(0, ca) + 0.12),
        nc[2] - 0.8 - nr[2] * 0.72 * kl * ca,
      ];
      const dir = norm([sa, 0.25 * Math.max(0, ca), -ca - 0.6]);
      lock(
        out,
        R(base),
        dir,
        [0, 1, 0],
        (HI ? 5.0 : 4.8) * kl * k,
        (HI ? 2.4 : 2.8) * k,
        1.8 * k,
        pale ? P_PALE : P_FUR,
        pale ? -0.1 : 0.03 - (kl < 1 ? 0.04 : 0),
        undefined,
      );
    }
  }
}

/** Точка на ошейнике: θ от правого края (0) через перёд (π/2) к левому (π). */
function collarPt(S: Skel, th: number): V3 {
  const pl = S.pl;
  const zc = pl.ring[2] + 1.7;
  const yc = pl.ring[1] - 7.0;
  return S.up([6.6 * Math.cos(th), yc + 6.9 * Math.sin(th), zc - 0.7 * Math.sin(th)]);
}

function collar(out: Part[], c: Ctx): void {
  const { S } = c;
  const k = S.k;
  // Тяжёлый железный ошейник: по бокам тонет в гриве; заклёпки на крупной.
  const id = nid();
  const segs = HI ? 14 : 9;
  for (let i = 0; i < segs; i++) {
    const t0 = lerp(0.9 * Math.PI, 0.1 * Math.PI, i / segs);
    const t1 = lerp(0.9 * Math.PI, 0.1 * Math.PI, (i + 1) / segs);
    const p0 = collarPt(S, t0);
    const p1 = collarPt(S, t1);
    const d = sub(p1, p0);
    const rivet = HI && i % 2 === 1;
    out.push({
      c: mul(add(p0, p1), 0.5),
      ax: axes(d, [0, 0, 1]),
      r: [Math.hypot(d[0], d[1], d[2]) * 0.62 + 0.2, 1.1 * k, 1.25 * k],
      pal: P_IRON,
      id,
      bias: -0.1,
      tex: rivet
        ? (qx, qy, qz) => (qx * qx + qz * qz < 0.16 && qy > 0.5 ? 0.32 : qz < -0.62 ? -0.12 : 0)
        : (_qx, _qy, qz) => (qz < -0.62 ? -0.12 : 0),
    });
  }
}

/** Цепь: кольцо ошейника и обрывок из звеньев; последнее разомкнуто. */
function chainParts(out: Part[], c: Ctx): void {
  const { S, lag } = c;
  const k = S.k;
  const ring = S.ring;
  // Кольцо: тор лицом к зрителю.
  const rid = nid();
  const rr = 1.25 * k;
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
      r: [Math.hypot(d[0], d[1], d[2]) * 0.6 + 0.12, 0.5 * k, 0.5 * k],
      pal: P_IRON,
      id: rid,
      bias: -0.04,
      noSeam: true,
    });
  }
  // Обрывок цепи маятником: конец запаздывает за кольцом (пружина).
  const top = add(ring, [0, 0.2 * k, -rr]);
  const L = 7.4 * k;
  const end0: V3 = [lag.chX, lag.chY + 0.5 * k, lag.chZ - L];
  const dir = norm(sub(end0, top));
  const end = add(top, mul(dir, L));
  const mid = add(top, mul(norm(add(mul(dir, 0.5), [0, 0.1, -0.5])), L * 0.5));
  const at = (u: number): V3 => {
    const v = 1 - u;
    return add(add(mul(top, v * v), mul(mid, 2 * u * v)), mul(end, u * u));
  };
  const n = 4;
  const ll = L / n;
  for (let j = 0; j < n; j++) {
    const u0 = j / n;
    const u1 = (j + 1) / n;
    const p0 = at(u0);
    const p1 = at(u1);
    const d = norm(sub(p1, p0));
    const cc = mul(add(p0, p1), 0.5);
    const face = j % 2 === 1;
    // Плоскость звена: у «лицом» — поперёк взгляда, у «ребром» — вдоль.
    const across = face ? norm(cross(d, [0, 1, 0])) : [0, 1, 0];
    const lid = nid();
    if (!HI) {
      out.push({
        c: cc,
        ax: axes(d, across as V3),
        r: [ll * 0.62, (face ? 0.85 : 0.55) * k, (face ? 0.55 : 0.85) * k],
        pal: P_IRON,
        id: lid,
        bias: face ? 0.0 : -0.12,
        noSeam: true,
      });
      continue;
    }
    // Крупная: звено — овальное кольцо из восьми долек, у последнего — разрыв.
    const broken = j === n - 1;
    const ax2 = across as V3;
    const A = ll * 0.62;
    const B = 0.95 * k;
    const segs = 10;
    for (let s = 0; s < segs; s++) {
      if (broken && (s === 6 || s === 7)) continue;
      const a0 = (s / segs) * TAU;
      const a1 = ((s + 1) / segs) * TAU;
      const q0 = add(cc, add(mul(d, Math.cos(a0) * A), mul(ax2, Math.sin(a0) * B)));
      const q1 = add(cc, add(mul(d, Math.cos(a1) * A), mul(ax2, Math.sin(a1) * B)));
      const dd = sub(q1, q0);
      out.push({
        c: mul(add(q0, q1), 0.5),
        ax: axes(dd, face ? [0, 1, 0] : [1, 0, 0]),
        r: [Math.hypot(dd[0], dd[1], dd[2]) * 0.62 + 0.1, 0.42 * k, 0.42 * k],
        pal: P_IRON,
        id: lid,
        bias: face ? 0.0 : -0.1,
        noSeam: true,
      });
    }
  }
}

/**
 * Прядь — капля остриём к кончику: три эллипсоида убывают от основания
 * (одна деталь, без швов внутри). Пушистое делается прядями, а не шарами:
 * шар читается «облаком», прядь — шерстью.
 */
function lock(
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

function tail(out: Part[], c: Ctx): void {
  const { o, S, lag } = c;
  const k = S.k;
  const pl = S.pl;
  const root = pl.tail[0];
  // Хвост качается от корня: вбок (запаздывание) и вверх.
  const sw = lag.tailSw;
  const upA = lag.tailUp;
  const pts = pl.tail.map((p, i) => {
    const u = i / (pl.tail.length - 1);
    let q = sub(p, root);
    q = rollY(q, -sw * 0.55 * u * (1 - o.curl));
    q = [q[0] + sw * 2.6 * u * u * (1 - o.curl), q[1], q[2] + upA * 3.0 * u * u];
    return S.up(add(root, q));
  });
  // Стержень хвоста: длинные звенья, тоньше прядей.
  const wid = [1.6, 2.6, 3.0, 3.0, 2.6, 1.2];
  const segs = 5;
  const id = nid();
  for (let i = 0; i < segs; i++) {
    const u0 = i / segs;
    const u1 = (i + 1) / segs;
    const p0 = catmull(pts, u0);
    const p1 = catmull(pts, u1);
    const d = sub(p1, p0);
    const len = Math.hypot(d[0], d[1], d[2]);
    if (len < 1e-4) continue;
    const um = (u0 + u1) / 2;
    const w = profile(wid, um) * k;
    out.push({
      c: mul(add(p0, p1), 0.5),
      ax: axes(d, [0, 1, 0]),
      r: [len * 0.7 + 0.5, w, w * 0.92],
      pal: P_FUR,
      id,
      bias: um > 0.8 ? -0.3 : -0.04,
    });
  }
  // Пряди черепицей к кончику, верхней кромкой; кончик тёмный.
  const n = HI ? 5 : 3;
  for (let j = 0; j < n; j++) {
    const u = lerp(0.14, 0.72, j / (n - 1));
    const p = catmull(pts, u);
    const tg = norm(sub(catmull(pts, Math.min(1, u + 0.05)), catmull(pts, Math.max(0, u - 0.05))));
    // Веер вверх от хвоста (поперёк хода): пряди ложатся верхней кромкой.
    const upN = norm(sub([0, 0, 1], mul(tg, tg[2])));
    const dir = norm(add(tg, mul(upN, 0.35)));
    const w = profile([2.2, 3.0, 3.2, 3.0, 2.6, 1.8], u) * k;
    lock(
      out,
      add(p, mul(upN, 0.6 * k)),
      dir,
      upN,
      (HI ? 6.0 : 6.4) * k,
      w,
      w * 0.85,
      P_FUR,
      u > 0.7 ? -0.12 : 0.04 - j * 0.015,
    );
  }
  // Тёмный кончик.
  const tip = catmull(pts, 0.84);
  const tdir = norm(sub(catmull(pts, 1), catmull(pts, 0.78)));
  lock(out, tip, tdir, [0, 0, 1], 4.8 * k, 2.1 * k, 1.9 * k, P_FUR, -0.34);
}

/** Узор черепа: тёмная полоса со лба на переносицу, бледные пятна над глазами, тёмная макушка. */
function skullTex(qx: number, qy: number, qz: number): number {
  if (qy < 0.05) return qz > 0.5 ? -0.08 : 0;
  const ax0 = Math.abs(qx);
  if (ax0 < 0.13 + 0.15 * qz && qz > -0.25) return -0.22;
  if ((ax0 - 0.42) ** 2 + (qz - 0.34) ** 2 < (HI ? 0.014 : 0.02)) return 0.34;
  if (qz > 0.55) return -0.08;
  // Крупная: короткие светлые штрихи шерсти на лбу.
  if (HI && qz > 0.3 && ax0 > 0.2 && (qx * 7 + (qz > 0.5 ? 0.5 : 0) + 10) % 1 < 0.2) return 0.07;
  return 0;
}

function headParts(out: Part[], flats: Flat[], c: Ctx): void {
  const { o, h } = c;
  const k = h.k;
  const ex = h.dir([1, 0, 0]);
  const ey = h.dir([0, 1, 0]);
  const ez = h.dir([0, 0, 1]);
  const hax = axes(ex, ez);
  out.push({
    c: h.at([0, 0, 0.8]),
    ax: hax,
    r: [4.9 * k, 4.4 * k, 4.6 * k],
    pal: P_FUR,
    id: nid(),
    bias: 0.02,
    tex: skullTex,
  });
  // Щёки — бледная маска; пушистые пучки торчат наружу и вниз.
  for (const side of [-1, 1]) {
    out.push({
      c: h.at([side * 3.0, 3.0, -2.3]),
      ax: hax,
      r: [2.4 * k, 2.2 * k, 2.1 * k],
      pal: P_PALE,
      id: nid(),
      bias: -0.08,
    });
    out.push({
      c: h.at([side * 3.9, 1.3, -1.2]),
      ax: hax,
      r: [2.6 * k, 2.4 * k, 2.6 * k],
      pal: P_FUR,
      id: nid(),
      bias: 0.04,
    });
    for (const [cx, cy, cz, len, wd, dx, dz] of [
      [4.0, 1.0, -0.6, 4.4, 2.4, 1, -0.45],
      [3.5, 1.5, -2.6, 3.8, 2.1, 0.75, -1],
      ...(HI ? [[4.2, 0.3, 1.3, 3.2, 1.9, 1, 0.12]] : []),
    ] as number[][]) {
      lock(
        out,
        h.at([side * cx, cy, cz]),
        h.dir(norm([side * dx, 0.1, dz])),
        ey,
        len * k,
        wd * k,
        1.5 * k,
        P_FUR,
        0.08,
        undefined,
      );
    }
  }
  // Тяжёлые брови: внутренний конец ниже — строгий взгляд; в гневе круче.
  const slant = o.eye === 'angry' ? 0.6 : o.eye === 'stare' ? 0.42 : 0.3;
  for (const side of [-1, 1]) {
    out.push({
      c: h.at([side * 2.3, 3.9, 2.05 - (o.eye === 'angry' ? 0.25 : 0)]),
      ax: axes(h.dir(norm([1, 0, side * slant])), ey),
      r: [2.1 * k, 0.95 * k, 0.8 * k],
      pal: P_FUR,
      id: nid(),
      bias: -0.06,
      noSeam: true,
    });
  }
  // Переносица (продолжение тёмной полосы) и серая морда — скат вниз к носу.
  out.push({
    c: h.at([0, 4.1, 0.5]),
    ax: hax,
    r: [1.55 * k, 2.4 * k, 1.5 * k],
    pal: P_FUR,
    id: nid(),
    bias: -0.1,
  });
  const sid = nid();
  const sn = o.snarl;
  const max = axes(h.dir(pitchX([1, 0, 0], 0.42)), h.dir(pitchX([0, 0, 1], 0.42)));
  out.push({
    c: h.at([0, 5.6, -1.9]),
    ax: max,
    r: [2.25 * k, 3.3 * k, 1.9 * k],
    pal: P_FUR,
    id: sid,
    bias: 0.12,
    // Оскал: складки на морде.
    tex:
      sn > 0.2
        ? (_qx, qy, qz) => (qz > 0.2 && qy > 0.2 && (qy * (HI ? 6 : 3)) % 1 < 0.25 ? -0.18 * sn : 0)
        : undefined,
  });
  // Бледные губы по бокам морды; в оскале губа поднята.
  for (const side of [-1, 1]) {
    out.push({
      c: h.at([side * 1.3, 5.9, -3.0 + 0.35 * sn]),
      ax: max,
      r: [1.35 * k, 2.2 * k, 1.1 * k],
      pal: P_PALE,
      id: sid,
      bias: -0.04,
    });
  }
  // Большой чёрный нос.
  out.push({
    c: h.at([0, 7.9, -2.9]),
    ax: max,
    r: [1.45 * k, 1.0 * k, 1.05 * k],
    pal: P_NOSE,
    id: nid(),
    bias: 0.08,
    noSeam: true,
  });
  // Нижняя челюсть поворачивается вниз от шарнира у щёк.
  const jw = o.jaw;
  const piv: V3 = [0, 1.2, -3.4];
  const ja = jw * 0.72;
  const jd = (p: V3): V3 => add(piv, pitchX(sub(p, piv), ja));
  const jax = axes(h.dir(pitchX([1, 0, 0], ja)), h.dir(pitchX([0, 0, 1], ja)));
  out.push({
    c: h.at(jd([0, 5.0, -4.5])),
    ax: jax,
    r: [1.8 * k, 2.5 * k, 1.0 * k],
    pal: P_PALE,
    id: nid(),
    bias: -0.14,
  });
  if (jw > 0.05 || sn > 0.3) {
    // Пасть: тёмное нёбо, язык.
    out.push({
      c: h.at([0, 5.3, -3.9 - jw * 0.5]),
      ax: hax,
      r: [1.85 * k, 2.4 * k, (0.45 + jw * 1.0) * k],
      pal: P_MOUTH,
      id: nid(),
      bias: -0.2,
      noSeam: true,
    });
    out.push({
      c: h.at(jd([0, 5.5, -3.95])),
      ax: jax,
      r: [1.3 * k, 2.1 * k, 0.5 * k],
      pal: P_MOUTH,
      id: nid(),
      bias: sn > 0.3 ? -0.06 : 0.22,
      noSeam: true,
    });
  }
  if (o.tongue > 0.05 && jw > 0.1) {
    // Язык свисает из пасти (радость).
    out.push({
      c: h.at(jd([0.3, 6.6, -5.0 - 0.6 * o.tongue])),
      ax: axes(h.dir(pitchX([1, 0, 0], ja)), h.dir(pitchX([0, 0.5, 1], ja))),
      r: [1.0 * k, 1.1 * k, (0.8 + 0.6 * o.tongue) * k],
      pal: P_MOUTH,
      id: nid(),
      bias: 0.3,
      noSeam: true,
    });
  }
  // Клыки: верхние — вниз из-под губы, нижние — вверх, когда пасть открыта.
  if (jw > 0.08 || sn > 0.2) {
    for (const side of [-1, 1]) {
      out.push({
        c: h.at([side * 1.1, 6.9, -3.95 + 0.2 * sn]),
        ax: axes(h.dir([0, 0.12, -1]), ey),
        r: [(HI ? 0.95 : 1.3) * k, (HI ? 0.42 : 0.5) * k, (HI ? 0.42 : 0.5) * k],
        pal: P_BONE,
        id: nid(),
        bias: 0.1,
        noSeam: true,
      });
      if (jw > 0.3) {
        out.push({
          c: h.at(jd([side * 0.95, 6.2, -4.1])),
          ax: axes(h.dir(pitchX([0, 0.1, 1], ja)), ey),
          r: [(HI ? 0.85 : 1.1) * k, (HI ? 0.38 : 0.48) * k, 0.4 * k],
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

/** Уши: высокие треугольники; на левом (справа в кадре) — рваная зарубка. */
function ears(flats: Flat[], c: Ctx): void {
  const { o, h } = c;
  for (const side of [-1, 1] as const) {
    const back = side < 0 ? o.earL : o.earR;
    const fl = side < 0 ? o.flL : o.flR;
    const base: V3 = [side * 3.3, -0.6, 3.8];
    const rot = (p: V3): V3 => {
      let q = sub(p, base);
      q = pitchX(q, -0.95 * back - 0.4 * fl);
      q = rollY(q, side * (0.1 + 0.55 * fl + 0.3 * Math.max(0, back)));
      return h.at(add(q, base));
    };
    const bin: V3 = [side * 1.5, -0.2, 4.4];
    const bout: V3 = [side * 5.6, -0.2, 2.0];
    const tip: V3 = [side * 4.5, -0.9, 10.6];
    let outer: V3[] = [bin, tip, bout];
    if (side > 0) {
      // Зарубка на наружной кромке, ближе к кончику.
      const e = sub(bout, tip);
      const inw: V3 = norm([-e[2], 0, e[0]]);
      const n1 = add(tip, mul(e, 0.2));
      const n2 = add(add(tip, mul(e, 0.34)), mul(inw, -1.7));
      const n3 = add(tip, mul(e, 0.48));
      outer = [bin, tip, n1, n2, n3, bout];
    }
    flats.push({
      pts: outer.map(rot),
      apex: rot(tip),
      a: rot(bin),
      b: rot(bout),
      pal: P_FUR,
      id: nid(),
      // Кончик и кромки темнее, к основанию светлее.
      shade: (u, r) =>
        -0.36 * (1 - r) ** 2 - (u < 0.1 || u > 0.9 ? 0.1 : 0) + 0.04 - (r > 0.9 ? 0.06 : 0),
    });
    // Внутри уха — кожа и светлые волоски.
    const iTip = lerp3(tip, mul(add(bin, bout), 0.5), 0.24);
    const iIn = add(lerp3(bin, bout, 0.22), [0, 0.35, 0.5]);
    const iOut = add(lerp3(bin, bout, 0.78), [0, 0.35, 0.3]);
    const lift: V3 = [0, 0.35, 0];
    flats.push({
      pts: [iIn, add(iTip, lift), iOut].map(rot),
      apex: rot(add(iTip, lift)),
      a: rot(iIn),
      b: rot(iOut),
      pal: P_EAR,
      id: nid(),
      shade: (u, r) =>
        -0.2 * (1 - r) + (HI && r > 0.45 && Math.abs(u - 0.38) < 0.08 ? 0.22 : 0) - 0.04,
    });
  }
}

// ---------------------------------------------------------------------------
// Плоские части (уши) и мягкие переходы тона.
// ---------------------------------------------------------------------------

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

/** Крупная: редкая шахматка на границе двух ступеней одной части — мягкий переход. */
function softBands(f: Frame): void {
  const { w, h, pal, tone, idb } = f;
  const hit: number[] = [];
  for (let y = 0; y < h - 1; y++)
    for (let x = 0; x < w - 1; x++) {
      const i = y * w + x;
      const pl = pal[i];
      if (pl !== P_FUR && pl !== P_PALE) continue;
      for (const j of [i + w, i + 1]) {
        if (pal[j] === pl && idb[j] === idb[i] && tone[j] === tone[i] - 1 && dith(x, y, 0.28))
          hit.push(j, tone[i]);
      }
    }
  for (let n = 0; n < hit.length; n += 2) f.tone[hit[n]] = hit[n + 1];
}

// ---------------------------------------------------------------------------
// Поверх кадра: глаза, нос, рот, шрамы, жетон, луна, кольца воя, сон.
// ---------------------------------------------------------------------------

function eyePal(): Record<string, RGBA> {
  const iris =
    V === 1
      ? ramp('#5e1206', '#9c2a0a', '#d84e16', '#f8822e', '#ffb866')
      : ramp('#4e2604', '#8e520a', '#cc8414', '#f0b02c', '#ffd772');
  const fur = PAL[P_FUR];
  return {
    K: INK_V[V],
    W: hx('#fffbe8'),
    o: fur[1],
    m: fur[3],
    a: iris[4],
    b: iris[3],
    c: iris[2],
    d: iris[1],
    l: fur[2],
  };
}
// Малая: глаз 3×2 — тёмный внешний угол выше (миндаль), янтарь, зрачок.
const EYES_S: Record<string, string[]> = {
  open: ['oaK', '.cb'],
  half: ['ooo', '.cK'],
  shut: ['...', 'ooo'],
  stare: ['ooK', '.cb'],
  happy: ['.o.', 'o.o'],
  sleep: ['...', 'ooo'],
  angry: ['oo.', '.bK'],
};
// Крупная: миндалевидный глаз 8×5, наружный угол выше; зрачок, блик, тёмный ободок.
const EYES_L: Record<string, string[]> = {
  open: ['ooo.....', 'oaaWKo..', '.obbKKo.', '..occcoo', '...oooo.'],
  half: ['........', 'oooooo..', '.ooooKo.', '..occcoo', '...oooo.'],
  shut: ['........', '........', 'oo......', '.ooooooo', '...mmmm.'],
  stare: ['........', 'ooooooo.', '.oaWKbo.', '..occcoo', '...oooo.'],
  happy: ['........', '..oooo..', '.o....o.', 'o......o', '........'],
  sleep: ['........', '........', 'o.......', '.oo...oo', '...ooo..'],
  angry: ['........', 'oooo....', '.oooooo.', '..obKKoo', '...oooo.'],
};

function face(p: Px, f: Frame, c: Ctx): void {
  const { o, h } = c;
  const ep = eyePal();
  for (const side of [-1, 1] as const) {
    const at = seen(f, mul(h.at([side * 2.3, 4.25, 1.0]), RR), OX, OY, 2.4 * RR);
    if (!at) continue;
    let key: string = o.eye;
    if (key === 'open' || key === 'angry' || key === 'stare') {
      if (o.blink > 0.75) key = 'shut';
      else if (o.blink > 0.3) key = 'half';
    }
    const flip = side > 0;
    if (HI) stamp(p, EYES_L[key], ep, at[0] - (flip ? 3 : 4), at[1] - 2, flip);
    else stamp(p, EYES_S[key], ep, at[0] - (flip ? 1 : 1), at[1] - 1, flip);
    if (o.glint > 0.3 && key === 'stare') {
      // Блеск во взгляде: на малой — одна белая точка, на крупной — звёздочка.
      if (HI) {
        const g = Math.round(o.glint * 2.4);
        if (g >= 1)
          star(p, at[0] + (flip ? 1 : -1), at[1] - 1, g, hx('#ffffff'), hx('#ffe6a0', 200));
      } else if (o.glint > 0.5) p.set(at[0] + (flip ? 0 : 1), at[1] - 1, hx('#ffffff'));
    }
  }
  // Нос: блик и ноздри (крупная).
  const nose = seen(f, mul(h.at([0, 8.75, -2.55]), RR), OX, OY, 1.6 * RR);
  if (nose) {
    const nl = PAL[P_NOSE];
    if (HI) {
      p.set(nose[0] - 1, nose[1] - 1, nl[5]);
      p.set(nose[0], nose[1] - 1, nl[4]);
      p.set(nose[0] - 2, nose[1] + 1, INK_V[V]);
      p.set(nose[0] + 2, nose[1] + 1, INK_V[V]);
    } else {
      p.set(nose[0], nose[1] - 1, nl[5]);
    }
  }
  // Рот закрыт: от носа вниз и в стороны (крупная).
  if (HI && o.jaw < 0.12 && o.snarl < 0.3) {
    const ink = mixc3(PAL[P_PALE][1], INK_V[V], 0.5);
    const pts: V3[] = [
      [0, 8.05, -3.8],
      [0, 7.9, -4.15],
      [0, 7.7, -4.45],
      [-0.6, 7.55, -4.6],
      [0.6, 7.55, -4.6],
      [-1.2, 7.2, -4.6],
      [1.2, 7.2, -4.6],
      [-1.75, 6.75, -4.45],
      [1.75, 6.75, -4.45],
    ];
    for (const q of pts) {
      const at = seen(f, mul(h.at(q), RR), OX, OY, 1.6 * RR);
      if (at) p.set(at[0], at[1], ink);
    }
  }
  scars(p, f, c);
}

function mixc3(a: RGBA, b: RGBA, k: number): RGBA {
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
    255,
  ];
}

/** Три шрама когтей на правой щеке (слева в кадре): светлая полоса, тёмный край снизу. */
function scars(p: Px, f: Frame, c: Ctx): void {
  const { h } = c;
  const n = HI ? 3 : 2;
  for (let j = 0; j < n; j++) {
    const off = HI ? j * 0.75 : j * 1.1;
    const a = seen(f, mul(h.at([-4.3 + off, 3.0, -0.3]), RR), OX, OY, 2.2 * RR);
    const b = seen(f, mul(h.at([-3.4 + off, 3.8, -2.9]), RR), OX, OY, 2.2 * RR);
    if (!a || !b) continue;
    const steps = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
    for (let s = 0; s <= steps; s++) {
      const u = steps ? s / steps : 0;
      const x = Math.round(lerp(a[0], b[0], u));
      const y = Math.round(lerp(a[1], b[1], u));
      if (p.get(x, y)[3] < 200) continue;
      p.set(x, y, SCAR[!HI || s === 0 || s === steps ? 1 : 0]);
      if (HI && s > 0 && s < steps && p.get(x + 1, y)[3] > 200) p.set(x + 1, y, SCAR[2]);
    }
  }
}

// Жетон: малая — 2×2 жести в тёмной рамке; крупная — 7×9, дырка и номер «7».
const TAG_S = ['sW', 'st'];
const TAG_L = [
  '..KKK..',
  '.KsosK.',
  'KsWsssK',
  'KsDDDsK',
  'KsssDtK',
  'KssDstK',
  'KssDstK',
  'KsttttK',
  '.KKKKK.',
];

function tag(p: Px, f: Frame, c: Ctx): void {
  const { S, lag } = c;
  const k = S.k;
  const A = add(collarPt(S, 0.33 * Math.PI), [0, 0.6 * k, -1.0 * k]);
  const L = 2.2 * k;
  const d = norm(sub([lag.tgX, lag.tgY + 0.3 * k, lag.tgZ - L], A));
  const C = add(A, mul(d, L));
  const at = seen(f, mul(C, RR), OX, OY, 2.6 * RR);
  if (!at) return;
  const tp = PAL[P_TIN];
  const pal: Record<string, RGBA> = {
    K: IRON[1],
    s: tp[4],
    t: tp[2],
    W: tp[6],
    o: IRON[2],
    D: tp[1],
  };
  if (HI) {
    // Проволока от ошейника.
    const a2 = seen(f, mul(A, RR), OX, OY, 3 * RR);
    if (a2) {
      const steps = Math.max(Math.abs(at[0] - a2[0]), Math.abs(at[1] - 4 - a2[1]));
      for (let s = 0; s <= steps; s++) {
        const u = steps ? s / steps : 0;
        p.set(Math.round(lerp(a2[0], at[0], u)), Math.round(lerp(a2[1], at[1] - 4, u)), IRON[2]);
      }
    }
    stamp(p, TAG_L, pal, at[0] - 3, at[1] - 4);
  } else stamp(p, TAG_S, pal, at[0] - 1, at[1] - 1);
}

/** Полная луна за спиной: кратеры шахматкой, свет сверху-слева, тёмный ободок. */
function moon(p: Px, mask: Uint8Array, o: Pose): void {
  const R = 8.6 * RR;
  const [sx, sy] = project(mul([10, -30, 8 + 36 * o.moonUp], RR));
  const cx = OX + sx;
  const cy = OY + sy;
  const craters: [number, number, number][] = HI
    ? [
        [-0.35, -0.2, 0.22],
        [0.3, 0.35, 0.16],
        [0.42, -0.4, 0.1],
        [-0.2, 0.5, 0.12],
        [0.05, -0.02, 0.07],
      ]
    : [
        [-0.32, -0.15, 0.26],
        [0.32, 0.36, 0.2],
      ];
  for (let y = Math.floor(cy - R - 2); y <= Math.ceil(cy + R + 2); y++)
    for (let x = Math.floor(cx - R - 2); x <= Math.ceil(cx + R + 2); x++) {
      if (x < 0 || y < 0 || x >= p.w || y >= p.h) continue;
      if (mask[y * p.w + x]) continue;
      const dx = (x + 0.5 - cx) / R;
      const dy = (y + 0.5 - cy) / R;
      const d = Math.hypot(dx, dy);
      if (d > 1 + 1.6 / R) continue;
      if (d > 1) {
        // Ореол: одно кольцо полупрозрачного света.
        if (dith(x, y, 0.5 * o.moon)) p.set(x, y, [MOON[3][0], MOON[3][1], MOON[3][2], 120]);
        continue;
      }
      if (!dith(x, y, o.moon * 1.02)) continue;
      let tn = 4;
      const lit = -(dx * 0.62 + dy * 0.78);
      if (d > 0.55 && lit > 0.3) tn = 5;
      if (d > 0.62 && lit < -0.35) tn = 3;
      if (d < 0.3 && lit > 0) tn = 5;
      for (const [cx2, cy2, cr] of craters) {
        const e = Math.hypot(dx - cx2, dy - cy2) / cr;
        if (e < 1) tn = e > 0.7 && dx - cx2 + dy - cy2 < 0 ? 2 : dith(x, y, 0.8) ? 3 : 4;
      }
      if (d > 1 - 1.05 / R) tn = Math.min(tn, 2);
      if (o.moon < 0.7) tn = Math.max(1, tn - 1);
      p.set(x, y, MOON[tn]);
    }
}

/** Вой: дуги расходятся от пасти к луне и тают шахматкой. */
function rings(p: Px, mask: Uint8Array, c: Ctx): void {
  const { o } = c;
  // Кольца идут из пасти в позе воя и не едут за головой, когда она опускается.
  const o2 = poseAt('work', 0.9);
  const S2 = skel(o2);
  const h = headF(o2, S2, { ...c.lag, headX: S2.head[0], headZ: S2.head[2] });
  const [sx, sy] = project(mul(h.at([0, 8.0, -3.9]), RR));
  const mx = OX + sx;
  const my = OY + sy;
  for (let j = 0; j < 3; j++) {
    const u = (o.howl - j * 0.2) / 0.6;
    if (u <= 0 || u >= 1) continue;
    const R = (3.5 + 17 * u) * RR;
    const span = 0.5 + 0.25 * u;
    const dir = -Math.PI / 2 + 0.3;
    const fade = u < 0.55 ? 1.1 : (1 - u) / 0.45;
    const step = 0.4 / R;
    for (const [dr, col] of HI
      ? ([
          [0, 0],
          [-1, 1],
        ] as [number, number][])
      : ([[0, 0]] as [number, number][])) {
      for (let a = dir - span; a <= dir + span; a += step) {
        const x = Math.round(mx + (R + dr) * Math.cos(a) - 0.5);
        const y = Math.round(my + (R + dr) * Math.sin(a) - 0.5);
        if (x < 0 || y < 0 || x >= p.w || y >= p.h) continue;
        if (mask[y * p.w + x]) continue;
        const edge = 1 - Math.abs(a - dir) / span;
        if (!dith(x, y, fade * Math.min(1, edge * 3))) continue;
        const onMoon = p.get(x, y)[3] > 200;
        // На луне кольцо светлее её самой, иначе читается трещиной.
        p.set(x, y, onMoon ? hx('#ffffff') : HOWL[col]);
      }
    }
  }
}

/** Хватка: две светлые дуги с зубцами смыкаются линзой перед пастью. */
function chomp(p: Px, c: Ctx): void {
  const { o, h } = c;
  const u = o.bite;
  const [sx, sy] = project(mul(h.at([0, 9.4, -3.6]), RR));
  const mx = Math.round(OX + sx);
  const my = Math.round(OY + sy);
  const W = HI ? 10 : 5;
  const gap = (1 - u) ** 1.5 * (HI ? 9 : 4.5);
  const bulge = HI ? 4 : 2;
  const col = hx('#fff4dc');
  const dim = hx('#d6c39a');
  const vis = u < 0.75 ? 1.1 : (1 - u) / 0.25;
  for (let dx = -W; dx <= W; dx++) {
    const e = 1 - (dx / W) ** 2;
    const yy = Math.round(gap + e * bulge);
    for (const s of [-1, 1]) {
      const x = mx + dx;
      const y = my + s * yy;
      if (!dith(x, y, vis)) continue;
      p.set(x, y, col);
      // Зубцы внутрь линзы.
      if ((dx + W) % (HI ? 3 : 2) === 1 && Math.abs(dx) < W - 1) p.set(x, y - s, dim);
    }
  }
}

/** Сон: буквы «z» поднимаются над головой и тают. */
const Z_S = ['zzz', '.z.', 'zzz'];
const Z_L = ['zzzz', '..z.', '.z..', 'zzzz'];
function zzz(p: Px, mask: Uint8Array, c: Ctx): void {
  const { h, t } = c;
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
        p.set(X, Y, HOWL[0]);
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
  const lagged = (fn: (tt: number) => number, freq: number, damp: number, off: number) => {
    const now = fn(t);
    return now + (spring(fn, t, t0, freq, damp) - now) * env + (L0 ? off * (1 - env) : 0);
  };
  const neckZ = (S: Skel) => S.up(S.pl.neck)[2];
  const tagA = (S: Skel) => collarPt(S, 0.33 * Math.PI);
  const r: Lag = {
    headX: lagged((tt) => sk(tt).head[0], 3.2, 0.32, (L0?.headX ?? 0) - S0.head[0]),
    headZ: lagged((tt) => sk(tt).head[2], 3.2, 0.32, (L0?.headZ ?? 0) - S0.head[2]),
    ruffZ: lagged((tt) => neckZ(sk(tt)), 3.6, 0.28, (L0?.ruffZ ?? 0) - neckZ(S0)),
    tailSw: lagged(
      (tt) => P(tt).tailSw + sk(tt).head[0] * 0.05,
      2.2,
      0.24,
      (L0?.tailSw ?? 0) - P0.tailSw - S0.head[0] * 0.05,
    ),
    tailUp: lagged((tt) => P(tt).tailUp, 2.4, 0.3, (L0?.tailUp ?? 0) - P0.tailUp),
    chX: lagged((tt) => sk(tt).ring[0], 1.7, 0.14, (L0?.chX ?? 0) - S0.ring[0]),
    chY: lagged((tt) => sk(tt).ring[1], 1.7, 0.14, (L0?.chY ?? 0) - S0.ring[1]),
    chZ: lagged((tt) => sk(tt).ring[2], 1.9, 0.18, (L0?.chZ ?? 0) - S0.ring[2]),
    tgX: lagged((tt) => tagA(sk(tt))[0], 2.4, 0.16, (L0?.tgX ?? 0) - tagA(S0)[0]),
    tgY: lagged((tt) => tagA(sk(tt))[1], 2.4, 0.16, (L0?.tgY ?? 0) - tagA(S0)[1]),
    tgZ: lagged((tt) => tagA(sk(tt))[2], 2.6, 0.2, (L0?.tgZ ?? 0) - tagA(S0)[2]),
  };
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

function toRes(parts: Part[]): Part[] {
  if (RR === 1) return parts;
  return parts.map((pt) => ({ ...pt, c: mul(pt.c, RR), r: mul(pt.r, RR) }));
}

/** Кадр `i` анимации `a` полосы `res`, вариант окраса `v` (0 — обычный, 1 — золотой). */
export function wolfFrame(a: Anim, i: number, res: Res = 's', v = 0): Px {
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
  const parts: Part[] = [];
  const flats: Flat[] = [];
  tail(parts, c);
  legs(parts, c);
  torso(parts, c);
  ruff(parts, c);
  collar(parts, c);
  chainParts(parts, c);
  headParts(parts, flats, c);
  // Шерсть темнее общего света рига: серый волк, блики — только по верхним кромкам.
  for (const pt of parts) if (pt.pal === P_FUR) pt.bias = (pt.bias ?? 0) - FUR_DARK;
  drawParts(f, toRes(parts), PAL, OX, OY);
  drawFlats(f, flats);
  seams(f, 1.2 * RR, 1);
  rimLight(f, PAL, (pl) => pl !== P_MOUTH && pl !== P_NOSE);
  if (HI) softBands(f);
  const p = toPx(f, PAL);
  selOutline(p, INK_V[V], 0.8);
  const mask = new Uint8Array(p.w * p.h);
  for (let j = 0; j < mask.length; j++) mask[j] = p.data[j * 4 + 3] > 0 ? 1 : 0;
  face(p, f, c);
  tag(p, f, c);
  if (o.moon > 0.01) moon(p, mask, o);
  if (o.howl >= 0) rings(p, mask, c);
  if (a === 'sleep') zzz(p, mask, c);
  if (o.bite >= 0) chomp(p, c);
  return p;
}
