// Овчарка Верная — пиксельный питомец по эталону боссов 12–14.
//
// Щенок немецкой овчарки сидит по стойке «смирно»: огромные стоячие уши с
// чёрной каймой, чёрная морда и чёрная полоса вверх по лбу, рыжие щёки и
// две рыжие «брови»-точки над глазами, чёрный чепрак на плечах и боках,
// кремовое жабо на груди. Конвойная шлейка из бурой кожи с латунными
// заклёпками и щитком-жетоном на груди, от ошейника тянется цепной поводок
// и лежит на полу. Длинный пушистый хвост на полу, верх хвоста чёрный.
//
// Две полосы, у каждой свой рисунок: малая — рамка 48 (шахта, списки),
// крупная — рамка 112 (карточка, вылупление, Питомник): пух в ушах, пряди
// жабо и хвоста, заклёпки по ремням, звёздочка на щитке, звенья цепи,
// радужка и блик, ноздри.
//
// Анимации 24 к/с по ключам (`kf`): подготовка → разгон → пик → проводка
// → возврат. Голова, уши, хвост и цепь — с запаздыванием (`spring`).
// Трюк — сторожевой лай: уши прижаты → вдох → лай уходит кольцами, пол
// трескается, камешки подпрыгивают → язык наружу, довольна.
//
// Золотой рисуется здесь же (`v` = 1) своими палитрами: рыжий мех — золото,
// чёрное — глубокая бронза; шлейка, щиток и глаза читаются.

import type { Px } from '../dungeon-art';
import {
  add,
  axes,
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
const P_BLACK = 1;
const P_PALE = 2;
const P_LEATHER = 3;
const P_BRASS = 4;
const P_STEEL = 5;
const P_NOSE = 6;
const P_MOUTH = 7;
const P_TONGUE = 8;
const P_BONE = 9;
const P_EARIN = 10;
const P_STONE = 11;

const MOUTH = ramp('#16050a', '#300a10', '#4e1218', '#701e22', '#94342f', '#b8504a');
const TONGUE = ramp('#4a1418', '#6e2228', '#94343a', '#ba4c50', '#d86866', '#ee8e88', '#f8b0a8');
const BONE = ramp('#5e564a', '#8c8474', '#b8b0a0', '#dcd6c8', '#f2eee4', '#fffdf6');
const STEEL = ramp(
  '#1e2226',
  '#33393e',
  '#4a5258',
  '#646e74',
  '#808a90',
  '#9ea6ac',
  '#bcc3c8',
  '#dce1e4',
  '#f4f6f7',
);
const STONE = ramp(
  '#211e1b',
  '#36322e',
  '#4e4943',
  '#68625a',
  '#837d74',
  '#a19b91',
  '#bdb8ae',
  '#d8d4cc',
);
const BRASS = ramp(
  '#3a2606',
  '#5e420e',
  '#86641e',
  '#ac8832',
  '#cfaa4c',
  '#e6c46a',
  '#f6de98',
  '#fff4d2',
);

const PAL_V: RGBA[][][] = [
  [
    // Рыжий мех: бурая тень → рыжий → светлый подпал на свету.
    ramp(
      '#22120a',
      '#331c0e',
      '#472814',
      '#5c351a',
      '#724420',
      '#8a5a2e',
      '#a06c38',
      '#b67e44',
      '#c98f53',
      '#d8a264',
      '#e6b67e',
      '#f2cc9c',
    ),
    // Чёрное: чепрак, морда, полоса на лбу, кайма ушей (тёплое, не серое — не волк).
    ramp('#0b0807', '#130e0c', '#1c1512', '#261d19', '#312620', '#3d3029', '#4b3b32', '#5c4a3e'),
    // Кремовое: жабо, низ щёк, пух в ушах.
    ramp(
      '#4a3a2a',
      '#6a5640',
      '#8c7458',
      '#ae9472',
      '#c9b08c',
      '#dcc6a2',
      '#ead6b0',
      '#f4e6c8',
      '#fcf4e2',
    ),
    // Кожа шлейки.
    ramp(
      '#1c0f07',
      '#2a170c',
      '#3a2112',
      '#4c2c18',
      '#5e381f',
      '#6e4a2c',
      '#845c38',
      '#9a6e46',
      '#b08456',
    ),
    BRASS,
    STEEL,
    // Нос.
    ramp('#070606', '#0f0d0c', '#191615', '#24201e', '#332d2a', '#4a423d'),
    MOUTH,
    TONGUE,
    BONE,
    // Кожа в ушах.
    ramp('#3a2420', '#5a3830', '#7c5244', '#a06e5a', '#c08c74', '#d8a88c', '#ecc6a8'),
    STONE,
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
    // Чёрное → глубокая бронза.
    ramp('#120903', '#1d0f05', '#2a1708', '#38200b', '#47290f', '#573314', '#683e19', '#7c4c20'),
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
    // Кожа темнее и краснее — читается на золоте.
    ramp(
      '#1a0806',
      '#2a0e0a',
      '#3c140e',
      '#4e1c14',
      '#60241a',
      '#742e20',
      '#883a28',
      '#9c4832',
      '#b05a40',
    ),
    ramp('#3a2606', '#5e420e', '#8a6a1c', '#b49030', '#dcb84a', '#f2d470', '#fdeca4', '#fffbe4'),
    STEEL,
    ramp('#0c0603', '#170c05', '#231308', '#311c0c', '#432812', '#5a381a'),
    MOUTH,
    TONGUE,
    BONE,
    ramp('#4a2a14', '#6c4020', '#90582c', '#b47640', '#d09658', '#e8b878', '#f6d49c'),
    STONE,
  ],
];
const INK_V: RGBA[] = [hx('#0c0604'), hx('#1a0d02')];

// ---------------------------------------------------------------------------
// Кадр: холст и рамка тела у двух полос (как у лиса и волка).
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

type Eye = 'open' | 'happy' | 'angry' | 'sleep' | 'shut' | 'wide';

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
  /** Пасть: 0 — закрыта, 1 — настежь; оскал; язык наружу. */
  jaw: number;
  snarl: number;
  tongue: number;
  /** Уши: 0 — торчком, 1 — прижаты назад, < 0 — насторожены вперёд; дёрнуть ухом. */
  earL: number;
  earR: number;
  flL: number;
  flR: number;
  /** Хвост: вбок (+ — вправо по кадру), вверх, кончик завивается вверх. */
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
  blink: number;
  /** Куда смотрят зрачки: −1 влево, +1 вправо. */
  look: number;
  /** Вдох: грудь раздувается. */
  chest: number;
  /** Лай: секунды от лая (−1 — нет); трещины (рост 0…1); видимость трещин и камешков; камешки — секунды от прыжка. */
  bark: number;
  crack: number;
  prop: number;
  stone: number;
  /** Цепь поводка качается сама (вдобавок к запаздыванию за телом). */
  lsw: number;
  /** Хватка: лучи удара (0…1), −1 — нет. */
  bite: number;
  /** Стоит (ходьба) и лежит (сон): 0 — сидит. */
  stand: number;
  lie: number;
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
  tailCurl: 0.2,
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
  look: 0,
  chest: 0,
  bark: -1,
  crack: 0,
  prop: 0,
  stone: -1,
  lsw: 0,
  bite: -1,
  stand: 0,
  lie: 0,
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
  const ph = (t / T) * TAU;
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
  // Насторожилась: голова набок (щенячий наклон), правое ухо вперёд — и обратно.
  const cock = loopK(t, T, [
    [0, 0],
    [0.95, 0],
    [1.16, 1, 'o'],
    [1.78, 1],
    [2.04, 0, 's'],
    [3, 0],
  ]);
  o.tilt = 0.24 * cock;
  o.turn = 0.06 * cock;
  o.hx = 0.35 * cock;
  o.earR = -0.3 * cock;
  o.earL = 0.12 * cock;
  o.look = 0.5 * cock;
  o.lean = 0.014 * Math.sin(ph);
  o.x = 0.15 * Math.sin(ph);
  // Уши дёргаются каждое в свою фазу; моргание.
  o.flL = bump(t, 0.5, 0.62);
  o.flR = bump(t, 2.3, 2.42) + 0.6 * bump(t, 2.46, 2.56);
  o.blink = Math.max(bump(t, 0.28, 0.46), bump(t, 2.62, 2.78));
  // Хвост метёт пол: два взмаха на петлю; цепь качается своим ходом.
  o.tailSw = 0.42 * Math.sin(ph * 2);
  o.tailCurl = REST.tailCurl + 0.12 * Math.sin(ph * 2);
  o.lsw = 0.5 * Math.sin(ph);
  return o;
}

function walkPose(t: number): Pose {
  const T = dur('walk');
  const o: Pose = { ...REST };
  const h = wrap(t, T);
  o.stand = 1;
  // Резвая рысь на зрителя: пары накрест.
  const la = bump(h, 0.02, 0.48);
  const lb = bump(h, 0.52, 0.98);
  o.fLz = 2.6 * la ** 0.8;
  o.fLy = 1.3 * la;
  o.hRz = 1.8 * la ** 0.8;
  o.fRz = 2.6 * lb ** 0.8;
  o.fRy = 1.3 * lb;
  o.hLz = 1.8 * lb ** 0.8;
  const sw = Math.sin((h / T) * TAU);
  const bob = Math.abs(sw);
  o.x = 0.5 * sw;
  o.lean = 0.05 * sw;
  o.z = 0.8 * bob - 0.2;
  o.nod = 0.04 + 0.05 * Math.cos((h / T) * 2 * TAU);
  o.tilt = -0.07 * sw;
  o.hx = -0.25 * sw;
  // Уши подпрыгивают на каждом шаге (запаздывание добавит пружина).
  o.earL = -0.08 + 0.1 * Math.cos((h / T) * 2 * TAU);
  o.earR = -0.08 + 0.1 * Math.cos((h / T) * 2 * TAU + 0.6);
  // Хвост поднят и виляет дважды за шаг; цепь болтается против корпуса.
  o.tailUp = 1;
  o.tailSw = 0.5 * Math.sin((h / T) * 2 * TAU);
  o.tailCurl = 0.35;
  o.lsw = -0.9 * sw;
  o.eye = 'open';
  o.jaw = 0.18;
  o.tongue = 0.6;
  return o;
}

function happyPose(t: number): Pose {
  const T = dur('happy');
  const o: Pose = { ...REST };
  // Два подскока, лапки от пола; хвост виляет; язык наружу.
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
  o.fLz = 3.4 * up;
  o.fRz = 3.4 * up;
  o.fLy = -0.8 * up;
  o.fRy = -0.8 * up;
  o.fLx = 0.5 * up;
  o.fRx = -0.5 * up;
  o.nod = -0.1 * up;
  o.tilt = 0.18 * Math.sin((t / T) * TAU) * env;
  o.earL = 0.35 * env;
  o.earR = 0.35 * env;
  o.eye = t < 0.9 ? 'happy' : 'open';
  o.jaw = 0.42 * env;
  o.tongue = env;
  o.tailSw = 1.0 * Math.sin(TAU * 3.4 * t) * env;
  o.tailUp = 0.5 * env;
  o.tailCurl = lerp(REST.tailCurl, 0.6, env);
  o.lsw = 0.7 * Math.sin(TAU * 1.8 * t) * env;
  return o;
}

/**
 * Сторожевой лай (2 с): уши прижаты, глаза сузились → вдох, голова вверх →
 * лай: голова бросается к зрителю, пасть настежь; кольца уходят, пол
 * трескается, камешки подпрыгивают → довольна: язык наружу, хвост виляет →
 * трещины тают, поза покоя.
 */
const BARK_T = 0.78;

function workPose(t: number): Pose {
  const o: Pose = { ...REST };
  const flat = kf(t, [
    [0, 0],
    [0.2, 0.85, 'o'],
    [1.2, 0.85],
    [1.42, 0, 's'],
  ]);
  o.earL = flat;
  o.earR = flat;
  const inh = kf(t, [
    [0, 0],
    [0.24, 0],
    [0.66, 1, 'o'],
    [0.74, 1.04],
    [0.8, 0, 'i'],
  ]);
  const bk = kf(t, [
    [0, 0],
    [0.72, 0],
    [0.8, 1, 'o'],
    [0.98, 0.95],
    [1.22, 0.1, 's'],
    [1.36, 0, 's'],
  ]);
  const crouch = kf(t, [
    [0, 0],
    [0.2, 1, 'o'],
    [0.7, 0.4],
    [0.8, 0],
  ]);
  o.chest = 1.2 * inh + 0.2 * bk;
  o.sq = -0.05 * inh + 0.04 * crouch + 0.08 * bump(t, 0.78, 1.02);
  // На лае голова вперёд и чуть вверх: открытая пасть смотрит на зрителя.
  o.nod = 0.1 * crouch - 0.3 * inh - 0.14 * bk;
  o.hz = -0.5 * crouch + 0.9 * inh - 0.25 * bk;
  o.hy = -0.3 * crouch - 0.5 * inh + 1.6 * bk;
  o.bow = 0.04 * crouch - 0.05 * inh + 0.04 * bk;
  o.y = 0.7 * bk;
  o.snarl = kf(t, [
    [0, 0],
    [0.14, 0.7, 'o'],
    [0.6, 0.5],
    [0.78, 1],
    [1.04, 0.2],
    [1.2, 0, 's'],
  ]);
  // Довольна: язык наружу, глаза-дуги, хвост виляет.
  const pleased = kf(t, [
    [0, 0],
    [1.24, 0],
    [1.4, 1, 'o'],
    [1.76, 1],
    [1.96, 0, 's'],
  ]);
  o.jaw = Math.max(bk, 0.4 * pleased, 0.1 * crouch);
  o.tongue = pleased;
  o.eye = t < 0.12 ? 'open' : t < 1.26 ? 'angry' : t < 1.84 ? 'happy' : 'open';
  o.tailSw = 0.85 * Math.sin(TAU * 3 * (t - 1.24)) * pleased;
  o.tailUp = 0.4 * pleased;
  o.tilt = 0.14 * pleased * Math.sin(TAU * 0.9 * (t - 1.24));
  o.fLy = -0.3 * crouch;
  o.fRy = -0.3 * crouch;
  // Кольца, трещины, камешки.
  o.prop = kf(t, [
    [0, 0],
    [BARK_T, 0],
    [BARK_T + 0.02, 1],
    [1.6, 1],
    [1.9, 0, 'l'],
  ]);
  o.bark = t >= BARK_T ? t - BARK_T : -1;
  o.crack = kf(t, [
    [0, 0],
    [BARK_T + 0.04, 0],
    [BARK_T + 0.26, 1, 'o'],
  ]);
  o.stone = t >= BARK_T + 0.06 ? t - BARK_T - 0.06 : -1;
  o.lsw = 0.6 * bump(t, 0.78, 1.3) * Math.sin(TAU * 2.4 * (t - 0.78));
  // Трещины растаяли — реквизит на места покоя.
  if (o.prop < 0.01 && t > 1) {
    o.bark = -1;
    o.crack = 0;
    o.stone = -1;
    o.prop = 0;
  }
  return o;
}

function attackPose(t: number): Pose {
  const T = dur('attack');
  const o: Pose = { ...REST };
  // Присела, уши прижаты, оскал → бросок к зрителю, морда на зрителя, пасть
  // настежь (кадры 8–11) → хватка, приземлилась, встряхнула головой → покой.
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
  o.z = -0.6 * neg(l) + 2.0 * air;
  o.bow = 0.1 * neg(l) + 0.04 * pos(l);
  o.nod = 0.22 * neg(l) - 0.32 * pos(l);
  o.hy = 1.5 * pos(l) - 0.4 * neg(l);
  o.hz = 0.4 * pos(l) - 0.9 * neg(l);
  o.jaw = kf(t, [
    [0, 0],
    [0.24, 0.12],
    [0.3, 0.16],
    [0.36, 1, 'o'],
    [0.46, 1],
    [0.51, 0.1, 'i'],
    [0.6, 0.2],
    [0.72, 0, 's'],
  ]);
  o.snarl = kf(t, [
    [0, 0],
    [0.14, 1, 'o'],
    [0.54, 1],
    [0.8, 0, 's'],
  ]);
  const ears = kf(t, [
    [0, 0],
    [0.14, 0.8, 'o'],
    [0.56, 0.8],
    [0.86, 0, 's'],
  ]);
  o.earL = ears;
  o.earR = ears;
  o.eye = t < 0.7 ? 'angry' : 'open';
  o.turn = 0.2 * Math.sin(((t - 0.5) / 0.17) * TAU) * bump(t, 0.5, 0.76);
  o.fLz = 3.0 * air + 0.6 * bump(t, 0.1, 0.28);
  o.fRz = 3.0 * air + 0.6 * bump(t, 0.1, 0.28);
  o.fLy = 2.2 * air;
  o.fRy = 2.2 * air;
  o.fLx = -0.5 * air;
  o.fRx = 0.5 * air;
  o.tailSw = 0.3 * bump(t, 0.4, 0.86);
  o.tailUp = 0.6 * bump(t, 0.1, 0.8);
  o.bite = t >= 0.35 && t < 0.56 ? (t - 0.35) / 0.21 : -1;
  return o;
}

function sleepPose(t: number): Pose {
  const T = dur('sleep');
  const o: Pose = { ...REST };
  o.lie = 1;
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
  o.tilt = 0.06;
  o.hz = 0.25 * br;
  o.sq = -0.05 * br;
  o.tailSw = 0.05 * br;
  o.tailCurl = 0.1;
  o.earL = 1.1;
  o.earR = 1.1;
  // Во сне дёргает ушами — каждым в свою пору.
  o.flL = 0.7 * bump(t, 2.0, 2.14);
  o.flR = 0.5 * bump(t, 0.7, 0.82) + 0.4 * bump(t, 0.86, 0.96);
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
// Скелет (в пикселях малой полосы): три плана — сидит, стоит, лежит.
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
  /** Где цепь ложится на пол (у левой лапы) — не едет за телом. */
  floor: V3;
  tail: V3[];
}
const SIT: Plan = {
  body: [0, -0.8, 10.2],
  bodyR: [6.9, 5.6, 8.6],
  neck: [0, 0.6, 17.2],
  neckR: [4.8, 4.2, 4.0],
  head: [0, 1.8, 23.2],
  sh: [4.3, 2.4, 10.6],
  paw: [3.9, 7.6, 1.2],
  haunch: [6.1, -2.2, 5.2],
  haunchR: [4.2, 5.4, 5.0],
  hpaw: [8.2, 3.6, 1.0],
  floor: [-6.6, 7.6, 0.7],
  // Хвост лежит на полу: из-за правого бедра наружу и вперёд, кончик к лапе.
  tail: [
    [5.4, -6.4, 2.2],
    [9.0, -5.4, 1.8],
    [12.4, -3.4, 1.6],
    [15.0, -0.4, 1.6],
    [16.4, 3.0, 1.7],
    [16.6, 6.4, 1.9],
    [15.6, 9.0, 2.4],
    [14.0, 10.6, 3.2],
  ],
};
const STAND: Plan = {
  body: [0, -5.4, 12.4],
  bodyR: [5.6, 9.4, 5.8],
  neck: [0, 1.2, 17.2],
  neckR: [4.4, 3.8, 4.2],
  head: [0, 3.6, 22.6],
  sh: [3.6, 2.4, 11.6],
  paw: [3.6, 3.8, 1.0],
  haunch: [4.4, -12.0, 11.0],
  haunchR: [3.6, 4.8, 5.0],
  hpaw: [4.2, -11.2, 1.0],
  floor: [-6.2, 5.6, 0.7],
  // Хвост поднят: назад-вверх и влево, кончик выглядывает над спиной.
  tail: [
    [0, -14.4, 13.6],
    [-2.2, -15.6, 14.8],
    [-4.4, -16.0, 16.0],
    [-6.4, -15.6, 17.0],
    [-8.0, -14.6, 17.8],
    [-9.2, -13.2, 18.4],
    [-9.8, -11.6, 18.8],
    [-10.0, -10.2, 19.0],
  ],
};
const LIE: Plan = {
  body: [0, -3.6, 5.2],
  bodyR: [7.0, 8.6, 5.0],
  neck: [0, 2.8, 7.4],
  neckR: [4.6, 4.0, 3.6],
  head: [0, 6.4, 7.8],
  sh: [3.8, 3.6, 5.4],
  paw: [3.0, 11.4, 1.0],
  haunch: [7.0, -4.6, 4.4],
  haunchR: [4.4, 5.6, 4.0],
  hpaw: [9.2, 2.0, 1.0],
  floor: [-8.4, 8.6, 0.7],
  tail: [
    [6.0, -9.4, 2.0],
    [9.4, -7.8, 1.8],
    [11.8, -4.8, 1.7],
    [12.8, -1.2, 1.7],
    [12.4, 2.4, 1.8],
    [11.0, 5.4, 2.0],
    [9.0, 7.6, 2.2],
    [6.8, 8.8, 2.5],
  ],
};

function planOf(o: Pose): Plan {
  const m = (k: Exclude<keyof Plan, 'tail'>): V3 =>
    lerp3(lerp3(SIT[k], STAND[k], o.stand), LIE[k], o.lie);
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
    floor: m('floor'),
    tail: SIT.tail.map((p, i) => lerp3(lerp3(p, STAND.tail[i], o.stand), LIE.tail[i], o.lie)),
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
  /** Оси и радиусы туловища (шлейка, жетон). */
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
    br: mul([pl.bodyR[0] * (1 + 0.03 * ch), pl.bodyR[1] * (1 + 0.05 * ch), pl.bodyR[2]], s),
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
  /** Цепь: провис отстаёт от туловища, плюс свой мах. */
  chX: number;
  chY: number;
  lsw: number;
  /** Уши подпрыгивают за головой (разница пружины и позы). */
  earB: number;
}

interface Ctx {
  o: Pose;
  S: Skel;
  h: HeadF;
  lag: Lag;
  t: number;
}

/** Часть с выбором палитры по точке на ней (чепрак, жабо, маска морды). */
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
/** Камешки трюка: их пиксели тают шахматкой вместе с трещинами. */
let STONE_IDS: number[] = [];

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

/** Чепрак на бедре: верх и зад чёрные, перёд рыжий. */
function haunchPick(_qx: number, qy: number, qz: number): number {
  PICK_T = 0;
  const s = (qz - 0.2) * 1.8 + (0.1 - qy) * 1.3;
  if (s > 0.3) {
    PICK_T = s < 0.62 ? 0.1 : 0;
    return P_BLACK;
  }
  if (s > -0.05) PICK_T = -0.1;
  return P_FUR;
}

function legs(out: PartF[], c: Ctx): void {
  const { o, S } = c;
  const k = S.k;
  const pl = S.pl;
  for (const side of [-1, 1] as const) {
    // Бедро: круглое, рыжее, сверху чёрный чепрак.
    const hc = S.up([side * pl.haunch[0], pl.haunch[1], pl.haunch[2]]);
    out.push({
      c: hc,
      ax: axes(rollY([1, 0, 0], side * 0.22 + o.lean), [0, 0, 1]),
      r: mul(pl.haunchR, k),
      pal: P_FUR,
      id: nid(),
      bias: -0.02,
      pick: haunchPick,
      tex: HI ? tufts(5, 3.2, 0.07, 0.9) : undefined,
    });
    const hp = side < 0 ? S.hpL : S.hpR;
    if (o.stand > 0.05) {
      const knee = add(lerp3(hc, hp, 0.5), [0, -1.4 * k, 0]);
      const lid = nid();
      limb(out, add(hc, [0, 0, -2.2 * k]), knee, 2.0 * k, 2.1 * k, P_FUR, lid, { bias: -0.06 });
      limb(out, knee, hp, 1.5 * k, 1.6 * k, P_FUR, lid, { bias: 0.02 });
    }
    // Задняя ступня — крупная, щенячья.
    out.push({
      c: add(hp, [0, 0.4 * k, 0.3 * k]),
      ax: axes(norm([side * 0.3 * (1 - o.stand), 1, 0]), [0, 0, 1]),
      r: [2.7 * k, 2.0 * k, 1.3 * k],
      pal: P_FUR,
      id: nid(),
      bias: 0.06,
      tex: toes(HI ? 4 : 2),
    });
    // Передняя лапа: толстая щенячья колонна, большая лапа.
    const sh = side < 0 ? S.shL : S.shR;
    const paw = side < 0 ? S.pawL : S.pawR;
    const lift = Math.max(0, (side < 0 ? o.fLz : o.fRz) - Math.max(0, o.z));
    const elbow = add(lerp3(sh, paw, 0.5), [side * 0.25 * k, (0.3 + lift * 0.1) * k, 0]);
    const lid = nid();
    limb(out, sh, elbow, 2.05 * k, 2.15 * k, P_FUR, lid, {
      bias: 0.02,
      pick: (_qx, qy) => {
        // Сзади плеча — край чепрака.
        PICK_T = qy < -0.55 ? -0.12 : 0;
        return P_FUR;
      },
    });
    limb(out, elbow, paw, 1.65 * k, 1.75 * k, P_FUR, lid, { bias: 0.08 });
    out.push({
      c: add(paw, [0, 0.5 * k, 0.25 * k]),
      ax: axes(norm([side * 0.06, 1, -lift * 0.1]), [0, 0, 1]),
      r: [2.35 * k, 2.0 * k, 1.3 * k],
      pal: P_FUR,
      id: lid,
      bias: 0.12,
      tex: toes(HI ? 4 : 2),
    });
  }
}

/** Туловище: чёрный чепрак на спине и боках, рыжая грудь, кремовое жабо посередине. */
function bodyPick(qx: number, qy: number, qz: number): number {
  PICK_T = 0;
  const ax0 = Math.abs(qx);
  const s = (0.25 - qy) * 2.6 + qz * 1.2;
  // Крупная: шерсть пучками черепицей и на рыжем, и на чепраке.
  const fur = HI ? tufts(7, 7, 0.05, 1.05)(qx, qy, qz) : 0;
  if (s > 0.25) {
    PICK_T = (s < 0.6 ? 0.1 : 0) + fur * 1.6;
    return P_BLACK;
  }
  if (s > -0.15) {
    PICK_T = -0.1 + fur;
    return P_FUR;
  }
  const bw = 0.3 + 0.14 * clamp01(qz + 0.3);
  if (qy > 0.5 && ax0 < bw && qz > -0.75) {
    if (HI) PICK_T = tufts(6, 5, 0.06, 1.0)(qx, qy, qz);
    return P_PALE;
  }
  PICK_T = fur;
  return P_FUR;
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
    pick: bodyPick,
  });
  // Шея: спереди рыжая с кремовым горлом, загривок чёрный.
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
      const s = (0.1 - qy) * 2.4 + qz * 0.6;
      if (s > 0.3) return P_BLACK;
      if (s > 0) {
        PICK_T = -0.08;
        return P_FUR;
      }
      if (qy > 0.45 && Math.abs(qx) < 0.5) {
        if (HI) PICK_T = tufts(5, 4, 0.07, 1.05)(qx, qy, qz);
        return P_PALE;
      }
      return P_FUR;
    },
  });
  // Кремовое жабо: пряди с горла вниз на грудь.
  const qs = HI ? [-0.26, -0.13, 0, 0.13, 0.26] : [-0.2, 0, 0.2];
  for (const qx of qs) {
    const base = torsoAt(S, qx, 0.52 - 0.1 * Math.abs(qx), 1.0);
    lock(
      out,
      base,
      norm([qx * 0.5, 0.4, -1]),
      [0, 1, 0.2],
      (HI ? 3.4 : 3.4) * k * (1 - 0.6 * Math.abs(qx)),
      (HI ? 1.4 : 1.6) * k,
      1.1 * k,
      P_PALE,
      0.06 - 0.04 * Math.abs(qx),
    );
  }
}

/** Ремень по поверхности туловища: отрезки-плашки по точкам (qx, qz). */
function strap(out: PartF[], S: Skel, pts: [number, number][], segs: number): V3[] {
  const k = S.k;
  const id = nid();
  const at = (u: number): V3 => {
    const f = clamp01(u) * (pts.length - 1);
    const i = Math.min(pts.length - 2, Math.floor(f));
    const t = f - i;
    return torsoAt(S, lerp(pts[i][0], pts[i + 1][0], t), lerp(pts[i][1], pts[i + 1][1], t), 1.04);
  };
  const line: V3[] = [];
  for (let i = 0; i < segs; i++) {
    const p0 = at(i / segs);
    const p1 = at((i + 1) / segs);
    const d = sub(p1, p0);
    const nrm = norm(sub(mul(add(p0, p1), 0.5), S.bc));
    out.push({
      c: mul(add(p0, p1), 0.5),
      ax: axes(d, nrm),
      r: [Math.hypot(d[0], d[1], d[2]) * 0.62 + 0.15, (HI ? 0.95 : 1.0) * k, 0.55 * k],
      pal: P_LEATHER,
      id,
      bias: 0.02,
      // Кромки ремня темнее — строчка.
      tex: HI ? (_qx, qy) => (Math.abs(qy) > 0.62 ? -0.12 : 0) : undefined,
    });
    line.push(p0);
  }
  line.push(at(1));
  return line;
}

/** Точка ошейника вокруг основания шеи: th = 0 — справа, π/2 — спереди. */
function collarPt(S: Skel, th: number): V3 {
  const pl = S.pl;
  return S.up([
    5.0 * Math.cos(th),
    pl.neck[1] + 4.5 * Math.sin(th),
    pl.neck[2] - 2.1 - 0.7 * Math.sin(th),
  ]);
}
/** Кольцо поводка на ошейнике — слева по кадру. */
const RING_TH = 0.72 * Math.PI;

/** Где у шлейки щиток: схождение ремней на груди. */
const BADGE: [number, number] = [0, -0.06];

function harness(out: PartF[], c: Ctx): { straps: V3[][]; collar: V3[] } {
  const { S } = c;
  const k = S.k;
  const straps: V3[][] = [];
  if (c.o.lie < 0.5) {
    // Игрек: с плеч к щитку, от щитка вниз по груди между лап.
    for (const side of [-1, 1]) {
      straps.push(
        strap(
          out,
          S,
          [
            [side * 0.74, 0.5],
            [side * 0.52, 0.36],
            [side * 0.25, 0.14],
            [BADGE[0], BADGE[1]],
          ],
          HI ? 9 : 5,
        ),
      );
    }
    straps.push(
      strap(
        out,
        S,
        [
          [BADGE[0], BADGE[1]],
          [0, -0.4],
          [0, -0.78],
        ],
        HI ? 6 : 3,
      ),
    );
  }
  // Ошейник: толстая кожа вокруг шеи, по бокам уходит в шерсть.
  const id = nid();
  const segs = HI ? 14 : 9;
  const collar: V3[] = [];
  for (let i = 0; i < segs; i++) {
    const t0 = lerp(0.95 * Math.PI, 0.05 * Math.PI, i / segs);
    const t1 = lerp(0.95 * Math.PI, 0.05 * Math.PI, (i + 1) / segs);
    const p0 = collarPt(S, t0);
    const p1 = collarPt(S, t1);
    const d = sub(p1, p0);
    out.push({
      c: mul(add(p0, p1), 0.5),
      ax: axes(d, [0, 0, 1]),
      r: [Math.hypot(d[0], d[1], d[2]) * 0.62 + 0.2, 1.0 * k, (HI ? 1.2 : 1.25) * k],
      pal: P_LEATHER,
      id,
      bias: 0.02,
      tex: (_qx, _qy, qz) => (qz < -0.62 ? -0.14 : qz > 0.6 ? 0.06 : 0),
    });
    collar.push(mul(add(p0, p1), 0.5));
  }
  return { straps, collar };
}

/** Цепной поводок: кольцо на ошейнике → свисает → лежит на полу петлёй. */
function chainParts(out: PartF[], c: Ctx): void {
  const { o, S, lag } = c;
  const k = S.k;
  const ring = add(collarPt(S, RING_TH), [-0.5 * k, 0.6 * k, -0.9 * k]);
  // Кольцо: тор лицом к зрителю.
  const rid = nid();
  const rr = 0.95 * k;
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
      r: [Math.hypot(d[0], d[1], d[2]) * 0.6 + 0.12, 0.42 * k, 0.42 * k],
      pal: P_STEEL,
      id: rid,
      bias: 0.02,
      noSeam: true,
    });
  }
  // Путь цепи: свисает с кольца (провис отстаёт и качается), дальше по полу.
  const top = add(ring, [0, 0, -rr]);
  const F0: V3 = [S.pl.floor[0] * G + o.x * 0.3, S.pl.floor[1] * G + o.y * 0.2, S.pl.floor[2] * k];
  const F1: V3 = add(F0, [-2.4 * G, 3.6 * G, 0]);
  const F2: V3 = add(F1, [-3.6 * G, 0.6 * G, 0]);
  const sw = (lag.chX - S.bc[0]) * 1.2 + lag.lsw * 1.5;
  const sy = (lag.chY - S.bc[1]) * 0.8;
  const M = add(lerp3(top, F0, 0.5), [sw - 1.0 * k, 0.8 * k + sy, -0.6 * k]);
  // Звенья кладутся от точки касания пола в обе стороны: на полу они не ползут,
  // а длина провиса меняется у кольца.
  const hang: V3[] = [];
  const nh = 16;
  for (let i = 0; i <= nh; i++) {
    const u = 1 - i / nh;
    const v = 1 - u;
    hang.push(add(add(mul(top, v * v), mul(M, 2 * u * v)), mul(F0, u * u)));
  }
  const floor: V3[] = [F0];
  for (let i = 1; i <= 8; i++) floor.push(lerp3(F0, F1, i / 8));
  for (let i = 1; i <= 8; i++) floor.push(lerp3(F1, F2, i / 8));
  const ll = (HI ? 1.5 : 1.8) * k;
  const link = (p0: V3, p1: V3, face: boolean) => {
    const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
    const d = norm(sub(p1, p0));
    const cc = mul(add(p0, p1), 0.5);
    const flat = Math.abs(d[2]) < 0.5;
    // Плоскость звена: у «лицом» — поперёк взгляда (на полу — плашмя), у «ребром» — вдоль.
    const across: V3 = face
      ? flat
        ? norm(cross(d, [0, 0, 1]))
        : norm(cross(d, [0, 1, 0]))
      : flat
        ? [0, 0, 1]
        : [0, 1, 0];
    const lid = nid();
    if (!HI) {
      out.push({
        c: cc,
        ax: axes(d, across),
        r: [L * 0.62, (face ? 0.8 : 0.5) * k, (face ? 0.5 : 0.8) * k],
        pal: P_STEEL,
        id: lid,
        bias: face ? 0.04 : -0.1,
        noSeam: true,
      });
      return;
    }
    // Крупная: звено — овальное кольцо из долек.
    const A = L * 0.62;
    const B = 0.85 * k;
    const segs = 10;
    for (let s = 0; s < segs; s++) {
      const a0 = (s / segs) * TAU;
      const a1 = ((s + 1) / segs) * TAU;
      const q0 = add(cc, add(mul(d, Math.cos(a0) * A), mul(across, Math.sin(a0) * B)));
      const q1 = add(cc, add(mul(d, Math.cos(a1) * A), mul(across, Math.sin(a1) * B)));
      const dd = sub(q1, q0);
      out.push({
        c: mul(add(q0, q1), 0.5),
        ax: axes(dd, cross(d, across)),
        r: [Math.hypot(dd[0], dd[1], dd[2]) * 0.62 + 0.1, 0.38 * k, 0.38 * k],
        pal: P_STEEL,
        id: lid,
        bias: face ? 0.04 : -0.08,
        noSeam: true,
      });
    }
  };
  const lay = (path: V3[], odd: number, toEnd: boolean) => {
    const cum = [0];
    for (let i = 1; i < path.length; i++) {
      const d = sub(path[i], path[i - 1]);
      cum.push(cum[i - 1] + Math.hypot(d[0], d[1], d[2]));
    }
    const total = cum[cum.length - 1];
    const at = (s: number): V3 => {
      let i = 1;
      while (i < cum.length - 1 && cum[i] < s) i++;
      const u = clamp01((s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]));
      return lerp3(path[i - 1], path[i], u);
    };
    const n = Math.floor(total / ll);
    for (let j = 0; j < n; j++) link(at(j * ll), at((j + 1) * ll), (j + odd) % 2 === 1);
    // Последнее неполное звено — у кольца: до самого верха.
    if (toEnd && total - n * ll > ll * 0.35)
      link(at(n * ll), path[path.length - 1], (n + odd) % 2 === 1);
  };
  lay(floor, 0, false);
  lay(hang, 1, true);
  // На конце — кожаная петля-ручка: лежит краем на полу, приподнята к зрителю.
  const hid = nid();
  const hr = 1.5 * k;
  const tl = 0.75;
  const hc = add(F2, [-hr * 1.1, 0.2 * k, hr * Math.sin(tl) * 0.9]);
  const nh2 = HI ? 12 : 7;
  for (let i = 0; i < nh2; i++) {
    const a = (i / nh2) * TAU;
    const a1 = ((i + 1) / nh2) * TAU;
    const ring = (b: number): V3 => [
      Math.cos(b) * hr * 1.2,
      Math.sin(b) * hr * Math.cos(tl),
      Math.sin(b) * hr * Math.sin(tl) * 0.9,
    ];
    const p0 = add(hc, ring(a));
    const p1 = add(hc, ring(a1));
    const d = sub(p1, p0);
    out.push({
      c: mul(add(p0, p1), 0.5),
      ax: axes(d, [0, -Math.sin(tl), Math.cos(tl)]),
      r: [Math.hypot(d[0], d[1], d[2]) * 0.6 + 0.12, 0.6 * k, 0.45 * k],
      pal: P_LEATHER,
      id: hid,
      bias: 0.06,
    });
  }
}

/** Хвост: верх чёрный, низ рыжий, кончик чёрный. */
function tail(out: PartF[], c: Ctx): void {
  const { o, S, lag } = c;
  const k = S.k;
  const pl = S.pl;
  const root = pl.tail[0];
  const n = pl.tail.length;
  const sw = lag.tailSw;
  const upA = lag.tailUp;
  const cu = lag.tailCurl;
  const flat = 1 - o.stand;
  const pts = pl.tail.map((p, i) => {
    const u = i / (n - 1);
    let q = sub(p, root);
    // На полу хвост метёт вбок (поворот вокруг корня), стоя — машет.
    q = yawZ0(q, -sw * 0.32 * u * flat);
    q = [q[0] + sw * 2.2 * u * u * o.stand, q[1], q[2] + upA * 2.6 * u * u];
    return add(root, q);
  });
  // Кончик приподнимается: последние точки вверх.
  if (cu > 0.01) {
    for (let i = n - 3; i < n; i++) {
      const w = (i - (n - 4)) / 3;
      pts[i] = add(pts[i], [0, 0, cu * 2.6 * w * w]);
    }
  }
  const wp = pts.map((p) => S.up(p));
  // Пышный хвост: толще к середине, к кончику кистью.
  const wid = [1.4, 2.0, 2.4, 2.6, 2.6, 2.5, 2.2, 1.5];
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
    const tip = um > 0.84;
    out.push({
      c: mul(add(p0, p1), 0.5),
      ax: axes(d, [0, 0, 1]),
      r: [len * 1.1 + 0.6 * k, w, w * 0.85],
      pal: P_FUR,
      id,
      bias: 0.02,
      tube: true,
      pick: (_qx, qy, qz) => {
        PICK_T = 0;
        if (tip) return P_BLACK;
        // Верх хвоста чёрный (со стороны спины), к рыжему — ступень светлее.
        const s = qz * 1.2 - qy * 0.3 - 0.35;
        if (s > 0.25) {
          PICK_T = s < 0.45 ? 0.12 : 0;
          return P_BLACK;
        }
        if (s > 0.05) PICK_T = -0.1;
        return P_FUR;
      },
      tex: HI ? tailTex(i) : undefined,
    });
  }
  // Пряди по хвосту — пышность, острия к кончику.
  const nl = HI ? 5 : 3;
  for (let j = 0; j < nl; j++) {
    const u = lerp(0.3, 0.8, j / (nl - 1));
    const p = catmull(wp, u);
    const tg = norm(sub(catmull(wp, Math.min(1, u + 0.05)), catmull(wp, Math.max(0, u - 0.05))));
    const upN = norm(sub([0, 0, 1], mul(tg, tg[2])));
    const dir = norm(add(tg, mul(upN, 0.25)));
    const w = profile([2.2, 2.8, 3.0, 2.9, 2.6, 2.0], u) * k;
    lock(
      out,
      add(p, mul(upN, 0.3 * k)),
      dir,
      upN,
      (HI ? 5.0 : 5.4) * k,
      w * 0.8,
      w * 0.6,
      P_FUR,
      0.04 - j * 0.01,
      {
        pick: (_qx, qy, qz) => {
          PICK_T = 0;
          // Прядь: верх чёрный, бока рыжие.
          return qz * 1.1 - qy * 0.3 > 0.45 ? P_BLACK : P_FUR;
        },
      },
    );
  }
  // Кончик кистью.
  const tp = catmull(wp, 0.9);
  const tdir = norm(sub(catmull(wp, 1), catmull(wp, 0.82)));
  lock(out, tp, tdir, [0, 0, 1], 3.6 * k, 2.0 * k, 1.8 * k, P_BLACK, 0.08);
}

/** Хвост на крупной: пряди вдоль хвоста — тёмные бороздки, светлый верх. */
function tailTex(seg: number) {
  return (qx: number, qy: number, qz: number) => {
    const a = Math.atan2(qy, qz) / Math.PI;
    const f = (a * 5 + qx * 0.35 + seg * 0.37 + 20) % 1;
    if (f < 0.16) return -0.08;
    if (f > 0.55 && f < 0.66 && qz > 0.2) return 0.06;
    return 0;
  };
}

/**
 * Череп: чёрная шапочка на макушке уходит полосой вниз по лбу к морде,
 * тёмная маска вокруг глаз, над глазами две рыжие точки, щёки рыжие,
 * низ щёк кремовый, затылок чёрный.
 */
function skullPick(qx: number, qy: number, qz: number): number {
  PICK_T = 0;
  const ax0 = Math.abs(qx);
  if (qy < -0.15) return P_BLACK;
  const px = (ax0 - 0.4) / 0.16;
  const pz = (qz - 0.44) / 0.11;
  if (qy > 0 && px * px + pz * pz < 1) {
    PICK_T = 0.06;
    return P_FUR;
  }
  const cap = qz > 0.56 + 0.16 * ax0;
  const streak = qz > -0.3 && ax0 < 0.1 + 0.18 * clamp01((0.56 - qz) / 0.8);
  if (cap || streak) return P_BLACK;
  const ex = (ax0 - 0.42) / 0.3;
  const ez = (qz - 0.3) / 0.34;
  if (qy > 0 && ex * ex + ez * ez < 1) {
    PICK_T = ez < -0.4 ? 0.14 : 0.08;
    return P_BLACK;
  }
  if (qz < -0.42 && ax0 < 0.6) return P_PALE;
  PICK_T = (qy < 0.15 ? -0.08 : 0) + (HI ? tufts(6, 6, 0.05, 0.95)(qx, qy, qz) : 0);
  return P_FUR;
}

function headParts(out: PartF[], flats: Flat[], c: Ctx): void {
  const { o, h } = c;
  const k = h.k;
  const ex = h.dir([1, 0, 0]);
  const ey = h.dir([0, 1, 0]);
  const ez = h.dir([0, 0, 1]);
  const hax = axes(ex, ez);
  // Череп: круглый, щенячий.
  out.push({
    c: h.at([0, 0, 0.9]),
    ax: hax,
    r: [5.0 * k, 4.3 * k, 4.5 * k],
    pal: P_FUR,
    id: nid(),
    bias: 0.04,
    pick: skullPick,
  });
  for (const side of [-1, 1]) {
    // Пухлые рыжие щёки, низ кремовый.
    out.push({
      c: h.at([side * 3.3, 1.6, -1.0]),
      ax: hax,
      r: [2.5 * k, 2.3 * k, 2.2 * k],
      pal: P_FUR,
      id: nid(),
      bias: 0.06,
      pick: (_qx, _qy, qz) => {
        PICK_T = 0;
        return qz < -0.35 ? P_PALE : P_FUR;
      },
    });
    if (HI) {
      // Пряди на щеках — наружу и вниз.
      lock(
        out,
        h.at([side * 4.3, 1.0, -1.2]),
        h.dir(norm([side, 0.1, -0.5])),
        ey,
        2.6 * k,
        1.4 * k,
        1.0 * k,
        P_FUR,
        0.06,
      );
    }
  }
  // Морда: короткая, широкая, чёрная; переносица чуть светлее.
  const sid = nid();
  const sn = o.snarl;
  const max = axes(h.dir(pitchX([1, 0, 0], 0.22)), h.dir(pitchX([0, 0, 1], 0.22)));
  out.push({
    c: h.at([0, 4.2, -1.3]),
    ax: max,
    r: [2.3 * k, 2.8 * k, 1.9 * k],
    pal: P_BLACK,
    id: sid,
    bias: 0.12,
    tex: (qx, qy, qz) => {
      if (qz > 0.5 && Math.abs(qx) < 0.45) return 0.1;
      if (sn > 0.2 && qz > 0.2 && qy > 0.1 && (qy * (HI ? 6 : 3)) % 1 < 0.25) return -0.16 * sn;
      return 0;
    },
  });
  // Губы по бокам морды; в оскале губа поднята.
  for (const side of [-1, 1]) {
    out.push({
      c: h.at([side * 1.2, 4.4, -2.4 + 0.3 * sn]),
      ax: max,
      r: [1.3 * k, 2.2 * k, 1.0 * k],
      pal: P_BLACK,
      id: sid,
      bias: -0.02,
    });
  }
  // Нос: крупный, чёрный, на кончике.
  out.push({
    c: h.at([0, 6.8, -0.7]),
    ax: max,
    r: [1.45 * k, 0.95 * k, 1.05 * k],
    pal: P_NOSE,
    id: nid(),
    bias: -0.05,
  });
  // Нижняя челюсть.
  const jw = o.jaw;
  const piv: V3 = [0, 1.6, -2.6];
  const ja = jw * 0.72;
  const jd = (p: V3): V3 => add(piv, pitchX(sub(p, piv), ja));
  const jax = axes(h.dir(pitchX([1, 0, 0], ja + 0.2)), h.dir(pitchX([0, 0, 1], ja + 0.2)));
  out.push({
    c: h.at(jd([0, 4.0, -3.0])),
    ax: jax,
    r: [1.6 * k, 2.3 * k, 0.9 * k],
    pal: P_BLACK,
    id: nid(),
    bias: -0.04,
  });
  if (jw > 0.05 || sn > 0.3) {
    out.push({
      c: h.at([0, 4.5, -2.75 - jw * 0.55]),
      ax: max,
      r: [1.6 * k, 2.4 * k, (0.4 + jw * 1.0) * k],
      pal: P_MOUTH,
      id: nid(),
      bias: -0.2,
      noSeam: true,
    });
    out.push({
      c: h.at(jd([0, 4.6, -2.95])),
      ax: jax,
      r: [1.15 * k, 2.0 * k, 0.45 * k],
      pal: P_MOUTH,
      id: nid(),
      bias: sn > 0.3 ? -0.06 : 0.22,
      noSeam: true,
    });
  }
  if (o.tongue > 0.05 && jw > 0.1) {
    // Язык наружу: свисает из пасти, розовый.
    const tg = o.tongue;
    out.push({
      c: h.at(jd([0.15, 5.6, -3.4 - 0.9 * tg])),
      ax: axes(h.dir(pitchX([1, 0, 0], ja)), h.dir(pitchX([0, 0.6, 1], ja))),
      r: [1.0 * k, 1.0 * k, (0.8 + 0.9 * tg) * k],
      pal: P_TONGUE,
      id: nid(),
      bias: 0.12,
      noSeam: true,
      tex: (qx) => (HI && Math.abs(qx) < 0.14 ? -0.12 : 0),
    });
  }
  // Клыки: верхние — вниз, нижние — вверх, когда пасть открыта.
  if (jw > 0.25 || sn > 0.2) {
    for (const side of [-1, 1]) {
      out.push({
        c: h.at([side * 0.95, 6.1, -2.95 - 0.25 * jw + 0.15 * sn]),
        ax: axes(h.dir([0, 0.12, -1]), ey),
        r: [(HI ? 0.85 : 1.15) * k, (HI ? 0.36 : 0.45) * k, (HI ? 0.36 : 0.45) * k],
        pal: P_BONE,
        id: nid(),
        bias: 0.1,
        noSeam: true,
      });
      if (jw > 0.3) {
        out.push({
          c: h.at(jd([side * 0.9, 5.4, -3.15])),
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

/** Уши: огромные треугольники торчком — чёрная кайма, внутри кожа и кремовый пух у основания. */
function ears(flats: Flat[], c: Ctx): void {
  const { o, h, lag } = c;
  for (const side of [-1, 1] as const) {
    const b0 = side < 0 ? o.earL : o.earR;
    // Прижатые уши не подпрыгивают — пружина только у стоячих.
    const back = b0 + lag.earB * (1 - clamp01(Math.abs(b0)));
    const fl = side < 0 ? o.flL : o.flR;
    const base: V3 = [side * 3.4, -0.4, 3.0];
    const rot = (p: V3): V3 => {
      let q = sub(p, base);
      q = pitchX(q, -1.25 * back - 0.35 * fl);
      q = rollY(q, side * (0.1 + 0.45 * fl + 0.3 * Math.max(0, back)));
      return h.at(add(q, base));
    };
    const bin: V3 = [side * 1.3, -0.2, 4.0];
    const bout: V3 = [side * 6.5, -0.2, 1.2];
    const tip: V3 = [side * 5.6, -0.8, 13.4];
    flats.push({
      pts: [bin, tip, bout].map(rot),
      apex: rot(tip),
      a: rot(bin),
      b: rot(bout),
      pal: P_BLACK,
      id: nid(),
      shade: (u, r) => 0.06 - 0.06 * (1 - r) - (u < 0.08 || u > 0.92 ? 0.06 : 0),
    });
    // Внутри — кожа уха, к кончику глубже и темнее.
    const lift: V3 = [0, 0.35, 0];
    const iTip = add(lerp3(tip, mul(add(bin, bout), 0.5), 0.2), lift);
    const iIn = add(lerp3(bin, bout, 0.14), [0, 0.35, 0.5]);
    const iOut = add(lerp3(bin, bout, 0.84), [0, 0.35, 0.4]);
    flats.push({
      pts: [iIn, iTip, iOut].map(rot),
      apex: rot(iTip),
      a: rot(iIn),
      b: rot(iOut),
      pal: P_EARIN,
      id: nid(),
      shade: (u, r) =>
        -0.5 * (1 - r) ** 1.4 +
        0.04 -
        (HI && r > 0.3 && r < 0.8 && Math.abs(((u * 4 + r * 1.2) % 1) - 0.5) < 0.08 ? 0.1 : 0),
    });
    // Кремовый пух у основания — по внутренней кромке.
    const fIn = add(lerp3(bin, tip, 0.06), [0, 0.6, 0.3]);
    const fTop = add(lerp3(bin, tip, 0.42), [side * 0.5, 0.6, 0]);
    const fOut = add(lerp3(bin, bout, 0.46), [0, 0.6, 0.6]);
    flats.push({
      pts: [fIn, fTop, fOut].map(rot),
      apex: rot(fTop),
      a: rot(fIn),
      b: rot(fOut),
      pal: P_PALE,
      id: nid(),
      shade: (u, r) =>
        -0.12 * (1 - r) + (HI && Math.abs(((u * 5 + r * 0.6) % 1) - 0.5) < 0.12 ? -0.14 : 0.02),
    });
  }
}

/** Камешки трюка: подпрыгивают из трещины, падают, отскакивают, лежат. */
const STONES: [number, number, number, number, number, number][] = [
  // x, y на полу; скорость вбок, вперёд, вверх; размер.
  [-2.6, 15.0, -8, 1, 54, 1.1],
  [2.4, 15.6, 9, 2, 60, 1.3],
  [-7.0, 14.6, -6, 0.5, 46, 0.9],
  [6.8, 14.8, 7, 1, 50, 1.0],
  [0.2, 16.4, 1, 2, 64, 0.8],
];
const GRAV = 210;

function stoneParts(out: PartF[], c: Ctx): void {
  const { o } = c;
  if (o.stone < 0 || o.prop < 0.01) return;
  const k = G;
  STONES.forEach(([x, y, vx, vy, vz, r], j) => {
    const t1 = (2 * vz) / GRAV;
    const tau = o.stone - j * 0.012;
    if (tau < 0) return;
    let z: number;
    let tt: number;
    if (tau < t1) {
      z = vz * tau - 0.5 * GRAV * tau * tau;
      tt = tau;
    } else {
      // Отскок: треть скорости.
      const b = tau - t1;
      const v2 = vz * 0.3;
      const t2 = (2 * v2) / GRAV;
      z = b < t2 ? v2 * b - 0.5 * GRAV * b * b : 0;
      tt = t1 + Math.min(b, t2);
    }
    const id = nid();
    STONE_IDS.push(id);
    const spin = tt * 9 + j;
    out.push({
      c: [(x + vx * tt * 0.6) * k, (y + vy * tt * 0.6) * k, (z + r * 0.7) * k],
      ax: axes([Math.cos(spin), 0, Math.sin(spin)], [0, 1, 0]),
      r: [r * 1.2 * k, r * k, r * 0.85 * k],
      pal: P_STONE,
      id,
      bias: 0.02,
      tex: (qx, qy, qz) => (qx + qz > 0.9 ? 0.12 : qy < -0.2 ? -0.08 : 0),
    });
  });
}

// ---------------------------------------------------------------------------
// Свой растр: части с выбором палитры, плоские части.
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

/** Крупная: редкая шахматка на границе двух ступеней одной части — мягкий переход. */
function softBands(f: Frame): void {
  const { w, h, pal, tone, idb } = f;
  const hit: number[] = [];
  for (let y = 0; y < h - 1; y++)
    for (let x = 0; x < w - 1; x++) {
      const i = y * w + x;
      const pl = pal[i];
      if (pl !== P_FUR && pl !== P_PALE && pl !== P_BLACK) continue;
      for (const j of [i + w, i + 1]) {
        if (pal[j] === pl && idb[j] === idb[i] && tone[j] === tone[i] - 1 && dith(x, y, 0.28))
          hit.push(j, tone[i]);
      }
    }
  for (let n = 0; n < hit.length; n += 2) f.tone[hit[n]] = hit[n + 1];
}

// ---------------------------------------------------------------------------
// Поверх кадра: глаза, нос, щиток, заклёпки, кольца лая, трещины, сон.
// ---------------------------------------------------------------------------

function eyePal(): Record<string, RGBA> {
  return {
    k: hx('#120a06'),
    K: hx('#060303'),
    W: hx('#fffbe8'),
    b: V === 1 ? hx('#a8642a') : hx('#9a5a26'),
    c: V === 1 ? hx('#5a2e10') : hx('#4a2810'),
    e: V === 1 ? hx('#fff0c0') : hx('#f2e4c8'),
  };
}
// Малая: глаз — бусина 2×2 с бликом сверху-слева (у обоих глаз блик слева: свет один).
const EYES_S: Record<string, string[]> = {
  open: ['Wc', 'cc'],
  half: ['kk', 'cc'],
  shut: ['..', 'ee'],
  happy: ['.e.', 'e.e'],
  sleep: ['...', 'eee'],
  angry: ['kk', 'Wc'],
};
// Крупная: круглый щенячий глаз 6×5 — ободок, радужка, зрачок, блик.
const EYES_L: Record<string, string[]> = {
  open: ['.kkkk.', 'kWWbck', 'kWKKck', 'kbKKck', '.kcck.'],
  half: ['......', '.kkkk.', 'kkkkkk', 'kbKKck', '.kcck.'],
  shut: ['......', '......', 'e....e', '.eeee.', '......'],
  happy: ['......', '..ee..', '.e..e.', 'e....e', '......'],
  sleep: ['......', '......', 'e....e', '.eeee.', '......'],
  angry: ['kk....', 'kkkk..', 'kWbkkk', 'kbKKck', '.kcck.'],
};
/** Разные стороны у этих глаз (бровь, дуги); у круглых блик слева у обоих. */
const EYE_FLIP = new Set(['angry']);

function face(p: Px, f: Frame, c: Ctx): void {
  const { o, h } = c;
  const ep = eyePal();
  for (const side of [-1, 1] as const) {
    const at = seen(f, mul(h.at([side * 2.25, 3.55, 1.2]), RR), OX, OY, 2.4 * RR);
    if (!at) continue;
    let key: string = o.eye;
    if (key === 'open' || key === 'angry' || key === 'wide') {
      if (key === 'wide') key = 'open';
      if (o.blink > 0.7) key = 'shut';
      else if (o.blink > 0.25) key = 'half';
    }
    const flip = side > 0 && EYE_FLIP.has(key);
    const rows = HI ? EYES_L[key] : EYES_S[key];
    const wdt = rows[0].length;
    // Зрачки смотрят вбок: сдвиг на пиксель у крупной.
    const lk = HI && key === 'open' ? Math.round(o.look) : 0;
    stamp(p, rows, ep, at[0] - Math.floor(wdt / 2) + lk, at[1] - (HI ? 2 : 1), flip);
  }
  // Нос: блик (крупная — и ноздри).
  const nose = seen(f, mul(h.at([0, 7.55, -0.5]), RR), OX, OY, 1.6 * RR);
  if (nose) {
    const nl = PAL[P_NOSE];
    if (HI) {
      p.set(nose[0] - 1, nose[1] - 1, nl[5]);
      p.set(nose[0], nose[1] - 1, nl[4]);
      p.set(nose[0] - 2, nose[1] + 1, INK_V[V]);
      p.set(nose[0] + 1, nose[1] + 1, INK_V[V]);
    } else p.set(nose[0], nose[1] - 1, nl[5]);
  }
}

const BADGE_S = ['bWb', 'bbd', '.d.'];
const BADGE_L = [
  'KKKKKKKKK',
  'KWWWWWWbK',
  'KWbbSbbdK',
  'KWbSSSbdK',
  'KWSSSSSdK',
  'KWbSSSbdK',
  'KWbSbSbdK',
  '.KbbbbdK.',
  '..KbbdK..',
  '...KdK...',
  '....K....',
];

/** Щиток на схождении ремней и латунные заклёпки по ремням и ошейнику (крупная). */
function badge(p: Px, f: Frame, c: Ctx, hs: { straps: V3[][]; collar: V3[] }): void {
  const { S, o } = c;
  const br = PAL[P_BRASS];
  const rivet = (q: V3) => {
    const at = seen(f, mul(q, RR), OX, OY, 1.6 * RR);
    if (!at) return;
    p.set(at[0], at[1], br[6]);
    p.set(at[0] + 1, at[1] + 1, br[2]);
  };
  if (HI) {
    for (const line of hs.straps) for (let j = 2; j < line.length - 2; j += 3) rivet(line[j]);
    for (let j = 1; j < hs.collar.length; j += 3) rivet(hs.collar[j]);
  } else {
    for (const j of [2, hs.collar.length - 3]) {
      const at = seen(f, mul(hs.collar[j], RR), OX, OY, 1.6 * RR);
      if (at) p.set(at[0], at[1], br[6]);
    }
  }
  if (o.lie > 0.5) return;
  const q = torsoAt(S, BADGE[0], BADGE[1], 1.1);
  const at = seen(f, mul(q, RR), OX, OY, 3 * RR);
  if (!at) return;
  const pal: Record<string, RGBA> = {
    K: br[1],
    W: br[7],
    S: br[6],
    b: br[4],
    d: br[2],
  };
  if (HI) stamp(p, BADGE_L, pal, at[0] - 4, at[1] - 4);
  else stamp(p, BADGE_S, pal, at[0] - 1, at[1] - 1);
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

const RING = [hx('#fff4dc'), hx('#f0c070', 210)];

/** Лай: кольца расходятся от пасти куполом и тают; ниже пола не идут. */
function rings(p: Px, mask: Uint8Array, c: Ctx): void {
  const { o } = c;
  // Кольца идут из пасти в позе лая и не едут за головой.
  const o2 = poseAt('work', BARK_T + 0.08);
  const S2 = skel(o2);
  const h = headF(o2, S2, { ...c.lag, headX: S2.head[0], headZ: S2.head[2] });
  const [sx, sy] = project(mul(h.at([0, 7.2, -2.8]), RR));
  const mx = OX + sx;
  const my = OY + sy;
  const floorY = OY + 3 * RR;
  for (let j = 0; j < 3; j++) {
    const u = (o.bark - j * 0.1) / 0.62;
    if (u <= 0 || u >= 1) continue;
    const R = (5 + 22 * u) * RR;
    const span = 0.55 + 0.2 * u;
    const fade = u < 0.5 ? 1.1 : (1 - u) / 0.5;
    const step = 0.4 / R;
    const lines: [number, number][] = HI
      ? [
          [0, 0],
          [-1, 1],
        ]
      : [[0, 0]];
    // Звук лая — дуги по обе стороны пасти («(( ))»), шире к краю.
    for (const dir of [0, Math.PI])
      for (const [dr, col] of lines) {
        for (let a = dir - span; a <= dir + span; a += step) {
          const x = Math.round(mx + (R + dr) * Math.cos(a) - 0.5);
          const y = Math.round(my + (R + dr) * Math.sin(a) - 0.5);
          if (x < 0 || y < 0 || x >= p.w || y >= p.h || y > floorY) continue;
          if (mask[y * p.w + x]) continue;
          const edge = 1 - Math.abs(a - dir) / span;
          if (!dith(x, y, fade * Math.min(1, edge * 3))) continue;
          p.set(x, y, RING[col]);
        }
      }
  }
}

/** Трещины в полу перед лапами: от точки удара лучами с изломами, на крупной — светлая кромка. */
const CRACKS: [number, number][] = [
  [0.08, 17],
  [0.55, 10],
  [1.25, 7],
  [1.9, 8],
  [2.6, 10],
  [3.08, 18],
  [-0.3, 9],
  [3.42, 8],
];
const CRACK_CORE = [hx('#241a14'), hx('#2a1a0a')];
const CRACK_LIP = [hx('#a89c8a'), hx('#c8b07a')];

function cracks(p: Px, mask: Uint8Array, c: Ctx): void {
  const { o } = c;
  const C: V3 = [0, 15.5 * G, 0];
  const core = CRACK_CORE[V];
  const lip = CRACK_LIP[V];
  const drawn = new Uint8Array(p.w * p.h);
  const plot = (q: V3) => {
    const [sx, sy] = project(mul(q, RR));
    const x = Math.round(OX + sx - 0.5);
    const y = Math.round(OY + sy - 0.5);
    if (x < 0 || y < 1 || x >= p.w || y >= p.h) return;
    const i = y * p.w + x;
    if (mask[i] || !dith(x, y, o.prop * 1.05)) return;
    p.set(x, y, core);
    drawn[i] = 1;
    if (HI && !mask[i - p.w] && !drawn[i - p.w]) p.set(x, y - 1, lip);
    // Крупная: щель неровной толщины — снизу ещё пиксель через раз.
    if (HI && y + 1 < p.h && !mask[i + p.w] && hash(x, y, 3) < 0.45) {
      p.set(x, y + 1, core);
      drawn[i + p.w] = 1;
    }
  };
  const branch = (from: V3, ang: number, len: number, seed: number, sub2: boolean) => {
    let q = from;
    let a = ang;
    const n = Math.floor(len * o.crack);
    const stepL = HI ? 0.5 : 1;
    for (let s = 0; s < n / stepL; s++) {
      if (s % Math.round(2 / stepL) === 0) a = ang + (hash(seed, s >> 1, 7) - 0.5) * 0.9;
      const nq: V3 = add(q, [Math.cos(a) * stepL, Math.sin(a) * stepL, 0]);
      plot(nq);
      q = nq;
      if (sub2 && Math.abs(s * stepL - len * 0.45) < stepL * 0.5) {
        const side = hash(seed, 3, 9) > 0.5 ? 1 : -1;
        branch(q, ang + side * 0.7, len * 0.4, seed + 17, false);
      }
    }
  };
  CRACKS.forEach(([ang, len], j) => branch(C, ang, len, j * 31 + 5, j % 2 === 0));
}

/** Хватка: лучи удара расходятся от морды — только по пустому фону. */
function snap(p: Px, mask: Uint8Array, c: Ctx): void {
  const { o, h } = c;
  const u = o.bite;
  const [sx, sy] = project(mul(h.at([0, 8.0, -2.0]), RR));
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
    const [sx, sy] = project(mul(h.at([4.5 + 3.5 * u, 0, 6 + 9 * u]), RR));
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
    // Голова отстаёт от шеи не больше чем на шаг (как у лиса: иначе в броске шея тянется столбом).
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
    chY: lagged((tt) => sk(tt).bc[1], 1.8, 0.16, (L0?.chY ?? 0) - S0.bc[1]),
    lsw: lagged((tt) => P(tt).lsw, 1.4, 0.15, (L0?.lsw ?? 0) - P0.lsw),
    earB: 0,
  };
  // Уши подпрыгивают за головой: только запаздывание (разница пружины и позы).
  const earFn = (tt: number) => sk(tt).head[2];
  const eNow = earFn(t);
  const eLag = (spring(earFn, t, t0, 3.0, 0.2) - eNow) * env;
  r.earB = Math.max(-0.35, Math.min(0.35, -0.2 * eLag)) + (L0 ? L0.earB * (1 - env) : 0);
  LAGS.set(key, r);
  return r;
}

function headF(o: Pose, S: Skel, lag: Lag): HeadF {
  const nb = o.nod + o.bow;
  const tl = o.tilt + o.lean;
  const dir = (v: V3): V3 => rollY(yawZ0(pitchX(v, nb), o.turn), tl);
  // Голова щенка крупная; на малой ещё крупнее: глаза, нос и пасть должны поместиться.
  const k = S.k * (HI ? 1.16 : 1.32);
  const hc: V3 = [lag.headX, S.head[1], lag.headZ];
  return { dir, k, at: (p) => add(hc, mul(dir(p), k)) };
}

function toRes(parts: PartF[]): PartF[] {
  if (RR === 1) return parts;
  return parts.map((pt) => ({ ...pt, c: mul(pt.c, RR), r: mul(pt.r, RR) }));
}

/** Кадр `i` анимации `a` полосы `res`, вариант окраса `v` (0 — обычный, 1 — золотой). */
export function shepherdFrame(a: Anim, i: number, res: Res = 's', v = 0): Px {
  const cv = RES[res];
  RR = cv.box / RES.s.box;
  HI = res === 'l';
  OX = cv.bx + cv.box / 2;
  OY = cv.by + GROUND * RR;
  V = v === 1 ? 1 : 0;
  NEXT_ID = 0;
  STONE_IDS = [];
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
  const hs = harness(parts, c);
  chainParts(parts, c);
  headParts(parts, flats, c);
  stoneParts(parts, c);
  drawPartsF(f, toRes(parts), PAL, OX, OY);
  drawFlats(f, flats);
  if (STONE_IDS.length && o.prop < 1) {
    // Камешки тают шахматкой вместе с трещинами.
    for (let j = 0; j < f.w * f.h; j++) {
      if (!STONE_IDS.includes(f.idb[j])) continue;
      if (dith(j % f.w, Math.floor(j / f.w), o.prop)) continue;
      f.pal[j] = -1;
      f.idb[j] = -1;
    }
  }
  seams(f, 1.2 * RR, 1);
  rimLight(f, PAL, (pl) => pl !== P_MOUTH && pl !== P_NOSE && pl !== P_TONGUE);
  if (HI) softBands(f);
  const p = toPx(f, PAL);
  selOutline(p, INK_V[V], 0.8);
  const mask = new Uint8Array(p.w * p.h);
  for (let j = 0; j < mask.length; j++) mask[j] = p.data[j * 4 + 3] > 0 ? 1 : 0;
  face(p, f, c);
  badge(p, f, c, hs);
  if (o.crack > 0 && o.prop > 0) cracks(p, mask, c);
  if (o.bark >= 0) rings(p, mask, c);
  if (a === 'sleep') zzz(p, mask, c);
  if (o.bite >= 0) snap(p, mask, c);
  return p;
}
