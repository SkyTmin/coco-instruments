// Хорёк-шнырь — пиксельный питомец по эталону боссов 12–14.
//
// Кремовый хорёк-фретка стоит столбиком на тёмных задних лапах, анфас:
// длинное тонкое тело, длинная шея; на морде бурые «соболиные капли»
// вокруг глаз-бусин (соединены тонкой перемычкой над носом), над ними белые
// пятна-брови, белая вытянутая морда, розовый нос, маленькие круглые уши с
// белой каймой. Плоская кепка набок, тонкий красный шарф, длинное потёртое
// пальто: под полами — красная подкладка с контрабандой (карманные часы на
// цепочках, ключ, золотой жетон). Тёмный пушистый хвост загибается сбоку.
//
// Две полосы, у каждой свой рисунок: малая — рамка 48 (шахта, списки),
// крупная — рамка 112 (карточка, вылупление, Питомник): ворс, клапаны
// карманов, заплата со стежками, пуговицы, твид кепки, вязка шарфа,
// циферблаты со стрелками, бусины глаз с двумя бликами.
//
// Анимации 24 к/с по ключам (`kf`): подготовка → разгон → пик → проводка →
// возврат. Голова, хвост, концы шарфа, кепка и подол — с запаздыванием
// (`spring`). Трюк — «псст»: глянул влево, вправо, распахнул пальто (часы
// блестят на подкладке), выхватил секундомер, щёлкнул — скорость; пальто
// запахнулось, реквизит растаял и вернулся в покой.
//
// Пальто — эллипсоиды со срезами: спинка срезана спереди (грань среза —
// подкладка, видна в разрезе), полы — ломти от бока до края разреза; полы
// распахиваются поворотом на петле у бока, и их грань среза становится
// подкладкой с контрабандой.
//
// Золотой рисуется здесь же (`v` = 1) своими палитрами: мех — золото с
// бронзой в тени, лапы и хвост — бронза, маска — тёмная бронза; кепка,
// шарф и пальто читаются.

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
const P_DARK = 3;
const P_SKIN = 4;
const P_COAT = 5;
const P_LINING = 6;
const P_CAP = 7;
const P_SCARF = 8;
const P_STEEL = 9;
const P_GOLD = 10;
const P_MOUTH = 11;
const P_BONE = 12;
const P_NOSE = 13;
const P_DIAL = 14;

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
const SCARF = ramp(
  '#2a0806',
  '#4a100c',
  '#6e1a14',
  '#94281e',
  '#b8382a',
  '#d24a36',
  '#e66a50',
  '#f28c70',
);
const DIAL = ramp('#6a6252', '#8c8470', '#b0a892', '#d2cbb6', '#ebe6d6', '#faf8ef');
const CAP = ramp(
  '#16120c',
  '#221b13',
  '#30261b',
  '#3f3324',
  '#4f412e',
  '#605039',
  '#726045',
  '#857253',
  '#988563',
  '#ab9a77',
);

const PAL_V: RGBA[][][] = [
  [
    // Мех: кремовый, тень — песочная, свет — сливочный.
    ramp(
      '#2b2116',
      '#3d3021',
      '#52422e',
      '#69563d',
      '#80694c',
      '#977f5e',
      '#ad9572',
      '#c2ab87',
      '#d4c09e',
      '#e3d3b4',
      '#efe4cb',
      '#f8f1e2',
    ),
    // Белое: морда, брови, кайма ушей.
    ramp(
      '#5a5040',
      '#776c5a',
      '#958a76',
      '#b1a792',
      '#c9c0ab',
      '#dcd5c2',
      '#ebe6d7',
      '#f6f3ea',
      '#fffdf8',
    ),
    // Маска — бурая, светлее глаз-бусин.
    ramp('#1a120c', '#261a12', '#33241a', '#413022', '#503c2c', '#5f4836', '#6f5641', '#80654e'),
    // Тёмное: лапы, хвост.
    ramp(
      '#120c08',
      '#1b130d',
      '#261b13',
      '#32241a',
      '#3f2e21',
      '#4d3929',
      '#5c4532',
      '#6c523c',
      '#7d6048',
    ),
    // Розовое: уши внутри, подушечки.
    ramp('#4a2224', '#683034', '#874244', '#a45652', '#bf6c66', '#d6857c', '#e8a094', '#f4bcb0'),
    // Пальто — оливково-серое, потёртое.
    ramp(
      '#141410',
      '#1d1c16',
      '#27261d',
      '#323024',
      '#3e3c2e',
      '#4b4838',
      '#585543',
      '#66634f',
      '#75725d',
      '#85826c',
      '#96937c',
      '#a8a58f',
    ),
    // Подкладка — тёмно-красная.
    ramp(
      '#1e0606',
      '#320a09',
      '#48100e',
      '#5e1714',
      '#741f1a',
      '#8a2a22',
      '#a0362c',
      '#b54538',
      '#c85848',
    ),
    CAP,
    SCARF,
    STEEL,
    GOLD,
    MOUTH,
    BONE,
    ramp('#5c2a2c', '#7e3a3c', '#a04e4e', '#c06660', '#da8078', '#ec9c92', '#f8bcb2'),
    DIAL,
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
    ramp('#120a04', '#1c1006', '#28170a', '#36200e', '#462a12', '#583618', '#6c441e', '#805224'),
    // Лапы и хвост — бронза.
    ramp(
      '#160c04',
      '#221306',
      '#301b09',
      '#40250d',
      '#513012',
      '#633c17',
      '#77491d',
      '#8b5824',
      '#a06a2e',
    ),
    ramp('#4a2418', '#68321f', '#874429', '#a45934', '#bf7042', '#d68a56', '#e8a670', '#f4c290'),
    // Пальто холоднее — серо-зелёное, чтобы золото не тонуло в оливе.
    ramp(
      '#0e1210',
      '#151a17',
      '#1d241f',
      '#262f29',
      '#303a33',
      '#3b463e',
      '#47534a',
      '#536056',
      '#606e63',
      '#6e7d71',
      '#7d8c80',
      '#8d9c90',
    ),
    ramp(
      '#1c0408',
      '#30080c',
      '#460c12',
      '#5c1218',
      '#721a1e',
      '#882426',
      '#9e3030',
      '#b43e3c',
      '#c8524c',
    ),
    CAP,
    SCARF,
    STEEL,
    GOLD,
    MOUTH,
    BONE,
    ramp('#5c2a20', '#7e3a2a', '#a04e38', '#c0664a', '#da805e', '#ec9c76', '#f8bc96'),
    DIAL,
  ],
];
const INK_V: RGBA[] = [hx('#0e0906'), hx('#1a0d02')];
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
  /** Уши: назад; дёрнуть ухом. */
  earL: number;
  earR: number;
  flL: number;
  flR: number;
  /** Хвост: вбок (+ — наружу), вверх, кончик завивается к телу. */
  tailSw: number;
  tailUp: number;
  tailCurl: number;
  /** Кисти — точки в координатах тела; свисают (+) или подняты когтями (−). */
  hLx: number;
  hLy: number;
  hLz: number;
  hRx: number;
  hRy: number;
  hRz: number;
  droop: number;
  /** Когти (атака). */
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
  /** Нос шевелится (−1…1). */
  sniff: number;
  /** Пальто распахнуто (0…1); блеск часов на подкладке. */
  open: number;
  glint: number;
  /** Секундомер в правой лапе (видимость), нажатие кнопки, круг щелчка (0…1, −1 — нет), стрелка. */
  watch: number;
  press: number;
  click: number;
  hand: number;
  /** Полосы скорости. */
  speed: number;
  /** Кепка: лишний наклон, надвинута на глаза (сон). */
  capT: number;
  capDn: number;
  /** Хватка: лучи удара (0…1), −1 — нет. */
  bite: number;
  curl: number;
  scale: number;
}

/** Кисти в покое: опущены по бокам, у карманов (в координатах тела). */
const HAND0: V3 = [6.4, 2.2, 11.6];

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
  flL: 0,
  flR: 0,
  tailSw: 0,
  tailUp: 0,
  tailCurl: 0.3,
  hLx: -HAND0[0],
  hLy: HAND0[1],
  hLz: HAND0[2],
  hRx: HAND0[0],
  hRy: HAND0[1],
  hRz: HAND0[2],
  droop: 0.3,
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
  sniff: 0,
  open: 0,
  glint: 0,
  watch: 0,
  press: 0,
  click: -1,
  hand: 0,
  speed: 0,
  capT: 0,
  capDn: 0,
  bite: -1,
  curl: 0,
  scale: 1,
};

const loopK = (t: number, T: number, keys: Key[]) => kf(wrap(t, T), keys);
const pos = (v: number) => Math.max(0, v);
const neg = (v: number) => Math.max(0, -v);
const TAU = Math.PI * 2;

/** Кисти — смесь текущих и цели. */
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
  o.sq = -0.015 * br;
  o.hz = 0.25 * br;
  // Ни секунды на месте: резкие взгляды влево, вправо и снова влево.
  o.turn = loopK(t, T, [
    [0, 0],
    [0.3, 0],
    [0.38, -0.4, 'o'],
    [0.74, -0.4],
    [0.82, 0, 'o'],
    [1.6, 0],
    [1.68, 0.4, 'o'],
    [2.0, 0.4],
    [2.08, 0.04, 'o'],
    [2.4, 0.04],
    [2.46, -0.2, 'o'],
    [2.6, -0.2],
    [2.68, 0, 'o'],
    [3, 0],
  ]);
  o.look = Math.max(-1, Math.min(1, o.turn * 2.6));
  o.tilt = 0.12 * o.turn;
  // Столбиком: лапки к груди, нос нюхает воздух.
  const up = loopK(t, T, [
    [0, 0],
    [0.86, 0],
    [1.0, 1, 'o'],
    [1.42, 1],
    [1.58, 0, 's'],
    [3, 0],
  ]);
  hands(o, [-2.0, 4.4, 18.2], [2.0, 4.4, 18.2], up);
  o.droop = lerp(REST.droop, 1, up);
  o.z = 0.5 * up;
  o.nod = -0.1 * up - 0.06 * bump(t, 2.1, 2.46);
  o.sniff = Math.sin(TAU * 10 * t) * (bump(t, 0.9, 1.5) + 0.8 * bump(t, 2.1, 2.46));
  o.flL = bump(t, 0.46, 0.58);
  o.flR = bump(t, 1.86, 1.98) + 0.6 * bump(t, 2.0, 2.1);
  o.blink = Math.max(bump(t, 1.14, 1.28), bump(t, 2.74, 2.88));
  o.x = 0.3 * Math.sin((t / T) * TAU);
  o.lean = 0.016 * Math.sin((t / T) * TAU);
  o.tailSw = 0.22 * Math.sin((t / T) * TAU * 2) + 0.1 * Math.sin((t / T) * TAU);
  o.tailCurl = REST.tailCurl + 0.15 * Math.sin((t / T) * TAU);
  return o;
}

function walkPose(t: number): Pose {
  const T = dur('walk');
  const o: Pose = { ...REST };
  const h = wrap(t, T);
  // Шустрая побежка столбиком: четыре шажка в секунду, пальто болтается.
  const s = wrap(h, T / 2);
  const la = bump(s, 0.01, 0.24);
  const lb = bump(s, 0.26, 0.49);
  o.fLz = 1.7 * la ** 0.8;
  o.fLy = 0.7 * la;
  o.fRz = 1.7 * lb ** 0.8;
  o.fRy = 0.7 * lb;
  const sw = Math.sin((h / T) * TAU * 2);
  o.x = 0.5 * sw;
  o.lean = 0.05 * sw;
  o.z = 0.6 * Math.abs(Math.sin((h / T) * TAU * 2)) - 0.2;
  o.bow = 0.1;
  o.nod = 0.02 + 0.05 * Math.cos((h / T) * 4 * TAU);
  o.tilt = -0.06 * sw;
  o.hx = -0.3 * sw;
  // Лапы отмахивают вразнобой с ногами.
  hands(o, [-6.0, 2.6 + 1.6 * sw, 12.0], [6.0, 2.6 - 1.6 * sw, 12.0], 1);
  o.droop = 0.4;
  o.turn = 0.2 * Math.sin((h / T) * TAU);
  o.look = Math.sin((h / T) * TAU + 0.4);
  o.grin = 0.5;
  o.earL = -0.1;
  o.earR = -0.1;
  // Хвост — противовес корпусу.
  o.tailSw = -0.5 * sw;
  o.tailUp = 0.3;
  o.tailCurl = REST.tailCurl + 0.15 * Math.cos((h / T) * TAU * 2);
  return o;
}

function happyPose(t: number): Pose {
  const T = dur('happy');
  const o: Pose = { ...REST };
  // Боевой танец хорька: спина дугой, три прыжка вбок — влево, вправо, на место.
  const hop = (a: number, b: number, hgt: number) => hgt * bump(t, a, b) ** 0.75;
  o.z = hop(0.04, 0.32, 2.8) + hop(0.34, 0.62, 2.6) + hop(0.64, 0.86, 1.4);
  o.x = kf(t, [
    [0, 0],
    [0.04, 0],
    [0.3, -2.6, 'o'],
    [0.36, -2.6],
    [0.6, 2.6, 'o'],
    [0.66, 2.6],
    [0.86, 0, 'o'],
    [T, 0],
  ]);
  const env = 1 - clamp01((t - 0.86) / (T - 0.86));
  const arch = kf(t, [
    [0, 0],
    [0.08, 1, 'o'],
    [0.84, 1],
    [1.02, 0, 's'],
  ]);
  o.bow = 0.16 * arch;
  o.lean = -0.07 * o.x * arch;
  o.sq = 0.08 * (bump(t, 0.3, 0.4) + bump(t, 0.6, 0.7) + bump(t, 0.84, 0.94)) - 0.04 * o.z;
  o.nod = -0.2 * arch;
  o.tilt = 0.12 * o.x * arch * 0.3;
  o.turn = 0.08 * o.x * arch;
  // Лапки вверх и в стороны, машут вразнобой.
  const fl = Math.sin(TAU * 3.2 * t);
  hands(o, [-7.0, 3.2, 21.6 + 1.6 * fl], [7.0, 3.2, 21.6 - 1.6 * fl], arch);
  o.droop = lerp(REST.droop, -0.4, arch);
  o.earL = -0.25 * env;
  o.earR = -0.25 * env;
  o.eye = t < 0.9 ? 'happy' : 'open';
  o.jaw = 0.42 * env;
  o.grin = lerp(REST.grin, 1, env);
  o.tailSw = 0.6 * Math.sin(TAU * 2.4 * t) * env;
  o.tailUp = 1.0 * env;
  o.tailCurl = REST.tailCurl + 0.3 * env;
  o.capT = 0.1 * Math.sin(TAU * 2 * t) * env;
  return o;
}

/** Угол распахнутых пол (рад) и петля у бока. */
const OPEN_A = 2.85;
const YC = 0.4;
const HINGE = 5.8;

/** Свободный верхний угол полы (у края разреза) — туда тянется лапа. */
function panelCorner(o: Pose, side: number): V3 {
  const hx0 = side * HINGE;
  const p: V3 = [side * 1.9, YC + 0.8, 20.4];
  const th = -side * o.open * OPEN_A;
  const x = p[0] - hx0;
  const y = p[1] - YC;
  return [hx0 + x * Math.cos(th) - y * Math.sin(th), YC + x * Math.sin(th) + y * Math.cos(th), p[2]];
}

/**
 * «Псст» (2 с): глянул влево → вправо → распахнул пальто (часы на подкладке
 * блестят) → правая лапа выхватывает секундомер, пальто запахивается →
 * поднял к уху, щёлк (кольцо, вспышка) → скорость (наклон, полосы) →
 * секундомер тает, лапы в покой.
 */
function workPose(t: number): Pose {
  const o: Pose = { ...REST };
  // Взгляды: влево 0,12–0,4, вправо 0,42–0,7.
  o.turn = kf(t, [
    [0, 0],
    [0.12, 0],
    [0.2, -0.48, 'o'],
    [0.38, -0.48],
    [0.48, 0.48, 'o'],
    [0.66, 0.48],
    [0.74, 0, 'o'],
  ]);
  o.look = Math.max(-1, Math.min(1, o.turn * 2.4));
  const sneak = kf(t, [
    [0, 0],
    [0.12, 1, 'o'],
    [0.7, 1],
    [0.8, 0, 's'],
  ]);
  o.bow = 0.08 * sneak;
  o.nod = 0.12 * sneak;
  o.z = -0.5 * sneak;
  o.eye = sneak > 0.5 ? 'half' : 'open';
  o.earL = 0.3 * sneak;
  o.earR = 0.3 * sneak;
  // Распахнул 0,74–0,86, держит до 1,16, запахнул 1,16–1,32.
  o.open = kf(t, [
    [0, 0],
    [0.74, 0],
    [0.86, 1, 'o'],
    [1.16, 1],
    [1.32, 0, 's'],
  ]);
  o.glint = bump(t, 0.86, 1.22);
  const L0: V3 = [-HAND0[0], HAND0[1], HAND0[2]];
  const wo = clamp01(o.open * 1.4);
  const Lc = panelCorner(o, -1);
  const Rc = panelCorner(o, 1);
  // Правая лапа после пальто: к подкладке (1,24) → вверх к уху (1,42) → щёлк → вниз (1,7–1,92).
  const grab = kf(t, [
    [0, 0],
    [1.14, 0],
    [1.26, 1, 'o'],
    [1.7, 1],
    [1.92, 0, 's'],
  ]);
  const lift = kf(t, [
    [0, 0],
    [1.24, 0],
    [1.42, 1, 'o'],
    [1.66, 1],
    [1.86, 0, 's'],
  ]);
  const Rgrab: V3 = lerp3([3.4, 3.2, 14.6], [6.6, 4.2, 24.6], lift);
  const R: V3 = lerp3(lerp3(HAND0, Rc, wo), Rgrab, grab);
  const L: V3 = lerp3(L0, Lc, wo);
  hands(o, L, R, 1);
  o.droop = lerp(REST.droop, 0, Math.max(wo, grab));
  o.watch = kf(t, [
    [0, 0],
    [1.18, 0],
    [1.26, 1, 'l'],
    [1.7, 1],
    [1.88, 0, 'l'],
  ]);
  o.press = bump(t, 1.42, 1.54);
  o.click = t >= 1.46 && t < 1.78 ? (t - 1.46) / 0.32 : -1;
  o.hand = kf(t, [
    [0, 0],
    [1.47, 0],
    [1.8, 5.5, 'l'],
  ]);
  o.speed = kf(t, [
    [0, 0],
    [1.48, 0],
    [1.56, 1, 'o'],
    [1.74, 1],
    [1.88, 0, 's'],
  ]);
  o.lean += 0.06 * o.speed;
  o.x += 0.7 * o.speed;
  // «Псст»: ухмылка и приоткрытый рот у распахнутого пальто; щёлк — довольный прищур.
  const psst = bump(t, 0.78, 1.26);
  o.grin = REST.grin + 0.6 * psst + 0.5 * bump(t, 1.44, 1.9);
  o.jaw = 0.2 * psst;
  o.tilt = 0.1 * psst - 0.08 * lift;
  o.turn += 0.12 * lift;
  if (t >= 0.86 && t < 1.2) o.eyeR = 'shut';
  if (t >= 1.44 && t < 1.52) o.eye = 'shut';
  else if (t >= 1.52 && t < 1.78) o.eye = 'happy';
  o.flR = 0.6 * bump(t, 1.44, 1.56);
  o.chest = 0.6 * psst;
  o.tailUp = 0.5 * psst + 0.4 * o.speed;
  o.tailSw = 0.5 * Math.sin(TAU * 3 * t) * o.speed - 0.3 * psst;
  o.capT = -0.08 * o.speed;
  // Реквизит растаял — всё на места покоя.
  if (o.watch < 0.01 && t > 1.5) {
    o.click = -1;
    o.hand = 0;
    o.press = 0;
  }
  return o;
}

function attackPose(t: number): Pose {
  const T = dur('attack');
  const o: Pose = { ...REST };
  // Присел низко, лапы к груди → бросок к зрителю, когти и пасть
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
  o.sq = 0.16 * neg(l) - 0.05 * air + 0.08 * bump(t, 0.55, 0.7);
  o.z = -1.2 * neg(l) + 2.0 * air;
  o.bow = 0.16 * neg(l) + 0.06 * pos(l);
  o.nod = 0.1 * neg(l) - 0.24 * pos(l);
  o.hy = 1.0 * pos(l);
  o.hz = -1.0 * neg(l);
  o.x = 0.3 * Math.sin(t * TAU * 9) * bump(t, 0.04, 0.27);
  const crouch = neg(l);
  const strike = pos(l);
  hands(o, [-3.4, 5.4, 17.0], [3.4, 5.4, 17.0], crouch);
  hands(o, [-6.8, 8.6, 22.0], [6.8, 8.6, 22.0], strike);
  o.claws = clamp01(crouch * 0.5 + strike * 1.3);
  o.droop = lerp(REST.droop, 0.6, crouch) - 1.3 * strike;
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
    [0.14, 0.5, 'o'],
    [0.28, 0.6],
    [0.36, 0.9, 'o'],
    [0.56, 0.8],
    [0.86, 0, 's'],
  ]);
  o.earL = ears;
  o.earR = ears;
  o.eye = t < 0.7 ? 'angry' : 'open';
  o.turn = 0.2 * Math.sin(((t - 0.5) / 0.17) * TAU) * bump(t, 0.5, 0.76);
  o.fLz = 0.8 * air;
  o.fRz = 0.8 * air;
  o.tailSw = 0.5 * Math.sin(t * TAU * 9) * bump(t, 0.04, 0.27) + 0.4 * bump(t, 0.4, 0.86);
  o.tailUp = 0.9 * bump(t, 0.1, 0.8);
  o.tailCurl = REST.tailCurl + 0.3 * bump(t, 0.3, 0.8);
  o.bite = t >= 0.35 && t < 0.56 ? (t - 0.35) / 0.21 : -1;
  return o;
}

function sleepPose(t: number): Pose {
  const T = dur('sleep');
  const o: Pose = { ...REST };
  o.curl = 1;
  o.eye = 'sleep';
  o.capDn = 1;
  const br = loopK(t, T, [
    [0, 0],
    [1.3, 1, 's'],
    [1.55, 1],
    [2.9, 0, 's'],
    [3, 0],
  ]);
  o.chest = br;
  o.nod = 0.1 + 0.03 * br;
  o.tilt = 0.18;
  o.hz = 0.25 * br;
  o.sq = -0.04 * br;
  o.tailSw = 0.05 * br;
  o.tailCurl = 0;
  o.earL = 0.4;
  o.earR = 0.4;
  hands(o, [-2.2, 6.6, 7.6], [2.2, 6.6, 7.6], 1);
  o.droop = 0.9;
  o.grin = 0.2;
  // Во сне дёрнул ухом и носом.
  o.flL = 0.6 * bump(t, 2.1, 2.24);
  o.sniff = 0.6 * Math.sin(TAU * 8 * t) * bump(t, 0.5, 0.8);
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
// Скелет (в пикселях малой полосы): стоит столбиком и свернулся (сон).
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
  hip: V3;
  hipR: V3;
  foot: V3;
  /** Пальто: верх (плечи) и подол; низ подола; разрез — полуширина у плеч и прирост книзу. */
  coatU: V3;
  coatUR: V3;
  coatL: V3;
  coatLR: V3;
  hem: number;
  gap: number;
  gapK: number;
  /** Шарф: середина кольца. */
  scarf: V3;
  tail: V3[];
}
const STAND: Plan = {
  body: [0, 0.6, 12.6],
  bodyR: [4.3, 4.2, 7.8],
  chest: [0, 0.4, 20.0],
  chestR: [4.3, 3.9, 5.0],
  neck: [0, 0.9, 25.6],
  neckR: [2.5, 2.5, 4.2],
  head: [0, 1.6, 31.8],
  sh: [4.4, 0.0, 22.0],
  hip: [3.0, 0.6, 5.6],
  hipR: [2.4, 2.6, 2.8],
  // Ступни выставлены вперёд из-под подола: глядя сверху, иначе их не видно.
  foot: [2.8, 3.0, 0],
  coatU: [0, -0.3, 19.6],
  coatUR: [5.5, 4.8, 6.2],
  coatL: [0, -0.3, 10.4],
  coatLR: [6.2, 5.3, 9.8],
  hem: 3.6,
  gap: 1.5,
  gapK: 0.1,
  scarf: [0, 0.9, 24.6],
  // Хвост: из-под пальто справа вбок и вверх крючком.
  tail: [
    [3.4, -3.6, 4.8],
    [7.6, -3.0, 3.6],
    [10.8, -2.0, 5.0],
    [12.2, -1.4, 8.4],
    [11.6, -1.0, 11.6],
    [9.6, -0.8, 12.8],
  ],
};
const CURL: Plan = {
  body: [0, -0.4, 5.0],
  bodyR: [8.4, 6.6, 5.0],
  chest: [0, 0.6, 7.0],
  chestR: [6.8, 5.6, 4.2],
  neck: [0, 2.6, 8.6],
  neckR: [3.0, 3.0, 3.0],
  head: [0, 5.0, 11.6],
  sh: [5.4, 1.6, 8.6],
  hip: [5.2, -1.0, 3.2],
  hipR: [2.6, 2.8, 2.6],
  foot: [5.4, 1.8, 0],
  coatU: [0, -0.4, 7.4],
  coatUR: [8.6, 7.0, 4.6],
  coatL: [0, -0.4, 4.6],
  coatLR: [9.6, 7.6, 4.8],
  hem: 0.3,
  gap: 0,
  gapK: 0,
  scarf: [0, 2.6, 8.4],
  // Хвост кольцом вокруг пальто спереди.
  tail: [
    [6.0, -4.0, 2.6],
    [10.0, -0.6, 2.4],
    [9.4, 4.6, 2.6],
    [5.0, 7.6, 2.6],
    [-0.6, 8.4, 2.8],
    [-6.0, 7.0, 3.0],
  ],
};

function planOf(o: Pose): Plan {
  const m = (k: keyof Plan): V3 => lerp3(STAND[k] as V3, CURL[k] as V3, o.curl);
  return {
    body: m('body'),
    bodyR: m('bodyR'),
    chest: m('chest'),
    chestR: m('chestR'),
    neck: m('neck'),
    neckR: m('neckR'),
    head: m('head'),
    sh: m('sh'),
    hip: m('hip'),
    hipR: m('hipR'),
    foot: m('foot'),
    coatU: m('coatU'),
    coatUR: m('coatUR'),
    coatL: m('coatL'),
    coatLR: m('coatLR'),
    hem: lerp(STAND.hem, CURL.hem, o.curl),
    gap: lerp(STAND.gap, CURL.gap, o.curl),
    gapK: lerp(STAND.gapK, CURL.gapK, o.curl),
    scarf: m('scarf'),
    tail: STAND.tail.map((p, i) => lerp3(p, CURL.tail[i], o.curl)),
  };
}

interface Skel {
  up: (p: V3) => V3;
  /** Направление в координатах тела → кадр. */
  dir: (v: V3) => V3;
  pl: Plan;
  head: V3;
  shL: V3;
  shR: V3;
  handL: V3;
  handR: V3;
  footL: V3;
  footR: V3;
  bc: V3;
  cc: V3;
  nc: V3;
  bax: [V3, V3, V3];
  br: V3;
  cr: V3;
  k: number;
}

/** Масштаб модели в рамке: ступни — макушка кепки ~38 пикселей малой полосы. */
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
  const dir = (v: V3): V3 => rollY(pitchX(v, o.bow), o.lean);
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
    dir,
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
    nc: up(add(pl.neck, [0, 0, 0.3 * o.hz])),
    bax: [dir([1, 0, 0]), dir([0, 1, 0]), dir([0, 0, 1])],
    br: mul([pl.bodyR[0] * (1 + 0.02 * ch), pl.bodyR[1] * (1 + 0.03 * ch), pl.bodyR[2]], s),
    cr: mul([pl.chestR[0] * (1 + 0.03 * ch), pl.chestR[1] * (1 + 0.05 * ch), pl.chestR[2]], s),
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
  /** Концы шарфа и подол отстают от груди и живота; кепка — от головы. */
  scarfX: number;
  scarfZ: number;
  hemX: number;
  capX: number;
}

interface Ctx {
  o: Pose;
  S: Skel;
  h: HeadF;
  lag: Lag;
  t: number;
}

/** Срез: остаётся m·q ≤ d (q — точка единичной сферы части); видимая грань — `face`. */
interface Cut {
  m: V3;
  d: number;
  face?: (qx: number, qy: number, qz: number) => number;
}

/** Часть с выбором палитры по точке, светом трубы, срезами и проявлением. */
interface PartF extends Part {
  pick?: (qx: number, qy: number, qz: number) => number;
  /** Свет как у трубы: нормаль без составляющей вдоль оси — звенья хвоста не «бусы». */
  tube?: boolean;
  cuts?: Cut[];
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
    // Бедро — тёмное (видно в разрезе пальто); с поднятой ступнёй колено вверх и вперёд.
    const hip = S.up([side * pl.hip[0], pl.hip[1], pl.hip[2]]);
    const hc = add(hip, [0, 0.4 * lift + 0.4 * fwd, 0.5 * lift]);
    out.push({
      c: hc,
      ax: axes(rollY([1, 0, 0], side * 0.2 + o.lean), [0, 0, 1]),
      r: mul(pl.hipR, k),
      pal: P_DARK,
      id: nid(),
      bias: 0.02,
      tex: HI ? tufts(5, 3.2, 0.07, 0.9) : undefined,
    });
    // Голень — тонкая, тёмная.
    const ank = add(foot, [0, -0.3 * k, 1.0 * k]);
    limb(out, add(hc, [0, 0.4 * k, -1.4 * k]), ank, 1.25 * k, 1.3 * k, P_DARK, nid(), {
      bias: 0.06,
    });
    // Ступня — тёмная, пальцы вперёд.
    out.push({
      c: add(foot, [0, 0.8 * k, 0.8 * k]),
      ax: axes(norm([side * 0.25, 1, 0]), [0, 0, 1]),
      r: [2.2 * k, 1.6 * k, 0.95 * k],
      pal: P_DARK,
      id: nid(),
      bias: 0.12,
      tex: toes(HI ? 4 : 2),
    });
  }
}

/** Лапка: тёмная, узкая, пальцы вниз; когти — веером (атака). */
function paw(out: PartF[], c: Ctx, side: number, elb: V3, wr: V3): void {
  const { o, S } = c;
  const k = S.k;
  const d0 = norm(sub(wr, elb));
  const dr = o.droop;
  const dir = norm(
    dr >= 0 ? lerp3(d0, [0, 0.35, -1], dr * 0.7) : lerp3(d0, [side * 0.35, 0.25, 1], -dr),
  );
  const id = nid();
  out.push({
    c: add(wr, mul(dir, 1.2 * k)),
    ax: axes(dir, [side * 0.2, 1, 0]),
    r: [1.55 * k, 1.25 * k, 1.0 * k],
    pal: P_DARK,
    id,
    bias: 0.12,
    tex: (qx, qy, qz) => {
      if (qx < 0.3) return 0;
      const u = ((qy + 1) / 2) * (HI ? 4 : 2);
      const fu = u - Math.floor(u);
      if (Math.floor(u) > 0 && fu < (HI ? 0.14 : 0.2) && qz > -0.6) return -0.22;
      return 0;
    },
  });
  if (o.claws > 0.05) {
    for (const a of [-0.5, 0, 0.5]) {
      const cd = norm(rollY(dir, a * side));
      const base = add(
        add(wr, mul(dir, 2.4 * k)),
        mul([cd[0] - dir[0], 0, cd[2] - dir[2]], 1.2 * k),
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
    const [elb, wr] = ik(sh, hand, 5.6 * k, 5.4 * k, pole);
    const id = nid();
    // Рукава пальто; на запястье — отвёрнутый обшлаг.
    limb(out, sh, elb, 1.75 * k, 1.8 * k, P_COAT, id, {
      bias: 0.02,
      tex: HI ? sleeveTex : undefined,
    });
    limb(out, elb, lerp3(elb, wr, 0.86), 1.6 * k, 1.65 * k, P_COAT, id, { bias: 0.04 });
    const cd = norm(sub(wr, elb));
    out.push({
      c: add(wr, mul(cd, -0.5 * k)),
      ax: axes(cd, [0, 1, 0]),
      r: [0.75 * k, 1.85 * k, 1.85 * k],
      pal: P_COAT,
      id,
      bias: 0.12,
    });
    paw(out, c, side, elb, wr);
  }
}

/** Рукав (крупная): складки поперёк у локтя и твидовая крапина. */
function sleeveTex(qx: number, qy: number, qz: number): number {
  let d = 0;
  if (qx > 0.55 && Math.abs(((qx * 9 + qz * 0.6) % 1) - 0.5) < 0.12) d -= 0.07;
  const hh = hash(Math.floor(qx * 14), Math.floor(Math.atan2(qy, qz) * 5), 7);
  if (hh > 0.9) d += 0.05;
  return d;
}

/** Тело: кремовое, брюшко светлее (видно в разрезе пальто). */
function bodyPick(qx: number, qy: number, qz: number): number {
  PICK_T = 0;
  if (qy > 0.4 && Math.abs(qx) < 0.5) {
    PICK_T = -0.2 + (HI ? tufts(7, 5, 0.05, 0.9)(qx, qy, qz) : 0);
    return P_PALE;
  }
  if (HI) PICK_T = tufts(6, 4, 0.07, 1)(qx, qy, qz);
  return P_FUR;
}

function torso(out: PartF[], c: Ctx): void {
  const { S } = c;
  const id = nid();
  out.push({ c: S.bc, ax: S.bax, r: S.br, pal: P_FUR, id, bias: -0.02, pick: bodyPick });
  out.push({ c: S.cc, ax: S.bax, r: S.cr, pal: P_FUR, id, bias: 0.0, pick: bodyPick });
  out.push({
    c: S.nc,
    ax: S.bax,
    r: mul(S.pl.neckR, S.k),
    pal: P_FUR,
    id,
    bias: 0.04,
    tex: HI ? tufts(4, 4, 0.06, 1) : undefined,
  });
}

// ---------------------------------------------------------------------------
// Пальто: спинка (подкладка в разрезе) и полы (распахиваются на петле у бока).
// ---------------------------------------------------------------------------

/** Контрабанда на подкладке пол: x, z — в координатах тела до поворота полы. */
const LOOT: { x: number; z: number; r: number; kind: 'watch' | 'coin' | 'key' }[] = [
  { x: -4.3, z: 19.4, r: 1.4, kind: 'watch' },
  { x: -5.0, z: 14.4, r: 1.25, kind: 'watch' },
  { x: -3.5, z: 10.4, r: 1.1, kind: 'coin' },
  { x: -4.9, z: 6.6, r: 1.15, kind: 'watch' },
  { x: 4.5, z: 18.6, r: 1.35, kind: 'watch' },
  { x: 4.1, z: 13.2, r: 0.8, kind: 'key' },
  { x: 4.8, z: 8.2, r: 1.3, kind: 'watch' },
];

/** Подкладка: складки, кромка ткани по краю, на полах — часы, жетон, ключ, кармашки. */
function liningFace(C: V3, R: V3, loot: boolean) {
  return (qx: number, qy: number, qz: number): number => {
    const X = C[0] + qx * R[0];
    const Z = C[2] + qz * R[2];
    const e = qx * qx + qy * qy + qz * qz;
    if (e > (HI ? 0.9 : 0.86)) {
      PICK_T = 0.05;
      return P_COAT;
    }
    if (!loot) {
      PICK_T = -0.28;
      return P_LINING;
    }
    for (const it of LOOT) {
      const dx = X - it.x;
      const dz = Z - it.z;
      if (it.kind === 'key') {
        // Ключ: кольцо, стержень вниз, бородка.
        const ring = Math.hypot(dx, dz - 0.6);
        if (ring < 0.75 && ring > (HI ? 0.36 : 0.0)) {
          PICK_T = dx + dz > 0.6 ? 0.1 : -0.06;
          return P_STEEL;
        }
        if (Math.abs(dx) < (HI ? 0.2 : 0.3) && dz < -0.1 && dz > -2.2) {
          PICK_T = 0.04;
          return P_STEEL;
        }
        if (dz < -1.5 && dz > -2.2 && dx > 0 && dx < 0.75 && (!HI || dz < -1.95 || dz > -1.75)) {
          PICK_T = -0.04;
          return P_STEEL;
        }
        continue;
      }
      const d = Math.hypot(dx, dz);
      if (d < it.r) {
        const rim = HI ? 0.4 : 0.55;
        if (it.kind === 'coin' || d > it.r - rim) {
          PICK_T = dx - dz < -0.3 ? 0.12 : dx - dz > 0.5 ? -0.1 : 0;
          if (it.kind === 'coin' && HI && Math.abs(d - it.r * 0.55) < 0.12) PICK_T -= 0.14;
          return P_GOLD;
        }
        PICK_T = 0;
        if (HI) {
          // Стрелки и центр.
          const a = Math.atan2(dx, dz);
          if (d < 0.18) {
            PICK_T = -0.5;
            return P_DARK;
          }
          const ah = Math.abs(a - 0.5 - it.x) % TAU;
          if ((Math.abs(a) < 0.16 && d < it.r * 0.55) || (ah < 0.25 && d < it.r * 0.4)) {
            PICK_T = -0.5;
            return P_DARK;
          }
        }
        return P_DIAL;
      }
      // Ушко и цепочка вверх к кармашку.
      if (dz > it.r - 0.1 && dz < it.r + 0.45 && Math.abs(dx) < 0.32) {
        PICK_T = 0.06;
        return P_GOLD;
      }
      if (HI && dz > it.r + 0.4 && dz < it.r + 1.7) {
        const cx = it.x + (it.x < 0 ? 1 : -1) * 0.5 * (dz - it.r - 0.4);
        if (Math.abs(X - cx) < 0.17 && ((Z * 6) | 0) % 2 === 0) {
          PICK_T = 0.04;
          return P_GOLD;
        }
      }
      // Кармашек над вещью — тёмная строчка.
      if (HI && Math.abs(dz - it.r - 1.8) < 0.16 && Math.abs(dx) < 1.5) {
        PICK_T = -0.24;
        return P_LINING;
      }
    }
    PICK_T = HI ? 0.06 * Math.sin(X * 2.4) - 0.04 : -0.04;
    return P_LINING;
  };
}

/** Сукно пальто: лацканы, кромка разреза, карманы с клапанами, заплата, пуговицы, подол. */
function coatPick(C: V3, R: V3, pl: Plan) {
  return (qx: number, qy: number, qz: number): number => {
    const X = C[0] + qx * R[0];
    const Y = C[1] + qy * R[1];
    const Z = C[2] + qz * R[2];
    PICK_T = 0;
    const ax = Math.abs(X);
    const g = pl.gap + pl.gapK * (22 - Z);
    const edge = ax - g;
    const front = Y > 1.2;
    if (front && Z > 16.4 && edge < 0.8 + 0.3 * (Z - 16.4)) {
      // Лацкан светлее; по его кромке — строчка.
      PICK_T = 0.12;
      if (HI && Math.abs(edge - (0.8 + 0.3 * (Z - 16.4))) < 0.22) PICK_T = -0.06;
      return P_COAT;
    }
    if (front && edge < 0.45) {
      PICK_T = -0.1;
      return P_COAT;
    }
    // Пуговицы на правой поле у края.
    if (front && X > 0)
      for (const bz of [14.6, 11.0]) {
        const d = Math.hypot(edge - 0.95, Z - bz);
        if (d < (HI ? 0.48 : 0.55)) {
          PICK_T = HI && d < 0.2 ? 0.3 : 0.12;
          return P_DARK;
        }
      }
    // Карманы с клапанами.
    if (front && ax > 2.9 && ax < 6.0 && Z > 7.0 && Z < 9.2) {
      if (Z < 7.5) PICK_T = -0.24;
      else PICK_T = 0.07 + (HI && Z > 8.9 ? 0.05 : 0) + (HI && ax > 5.7 ? -0.1 : 0);
      return P_COAT;
    }
    // Заплата на левой поле (потёртое пальто).
    if (front && X < -2.9 && X > -5.6 && Z > 11.6 && Z < 14.0) {
      PICK_T = 0.1;
      if (HI && (Math.abs(X + 2.9) < 0.2 || Math.abs(X + 5.6) < 0.2 || Math.abs(Z - 14.0) < 0.2))
        PICK_T = ((X * 5 + Z * 5) | 0) % 2 === 0 ? -0.16 : 0.18;
      return P_COAT;
    }
    if (Z < pl.hem + 0.55) PICK_T -= 0.1;
    if (HI) {
      const hh = hash(Math.floor(qx * 22), Math.floor(qz * 30), 3);
      if (hh > 0.88) PICK_T += 0.05;
      else if (hh < 0.08) PICK_T -= 0.05;
      // Складки — косые тени на подоле.
      if (Z < 11 && Math.abs(((X * 0.7 - Z * 0.25 + 40) % 2.6) - 1.3) < 0.14) PICK_T -= 0.07;
    }
    return P_COAT;
  };
}

/** Пальто в кадр: часть плана `p` → мир (с поворотом полы `side` на петле и качанием подола). */
function coatXf(c: Ctx, side: number, lower: boolean) {
  const { o, S, lag } = c;
  const roll = lower ? Math.max(-0.14, Math.min(0.14, (lag.hemX - S.bc[0]) * 0.07)) : 0;
  const th = side === 0 ? 0 : -side * o.open * OPEN_A;
  const hx0 = side * HINGE * lerp(1, 1.3, o.curl);
  const ct = Math.cos(th);
  const st = Math.sin(th);
  const pt = (p: V3): V3 => {
    let q = p;
    if (th !== 0) {
      const x = q[0] - hx0;
      const y = q[1] - YC;
      q = [hx0 + x * ct - y * st, YC + x * st + y * ct, q[2]];
    }
    if (roll !== 0) q = rollY(q, roll, [0, 0, 18]);
    return S.up(q);
  };
  const dir = (v: V3): V3 => {
    let q = v;
    if (th !== 0) q = [v[0] * ct - v[1] * st, v[0] * st + v[1] * ct, v[2]];
    if (roll !== 0) q = rollY(q, roll);
    return S.dir(q);
  };
  return { pt, dir };
}

function coat(out: PartF[], c: Ctx): void {
  const { S } = c;
  const pl = S.pl;
  const k = S.k;
  const id = nid();
  for (const lower of [false, true]) {
    const C = lower ? pl.coatL : pl.coatU;
    const R = lower ? pl.coatLR : pl.coatUR;
    const hemCut: Cut = { m: [0, 0, -R[2]], d: C[2] - pl.hem };
    // Спинка — чуть меньше; срез спереди — подкладка (тёмная, в тени).
    const Rb = mul(R, 0.96);
    const xb = coatXf(c, 0, lower);
    out.push({
      c: xb.pt(C),
      ax: [xb.dir([1, 0, 0]), xb.dir([0, 1, 0]), xb.dir([0, 0, 1])],
      r: mul(Rb, k),
      pal: P_COAT,
      id,
      bias: -0.06,
      pick: coatPick(C, Rb, pl),
      cuts: [
        { m: [0, Rb[1], 0], d: YC - C[1], face: liningFace(C, Rb, false) },
        { m: [0, 0, -Rb[2]], d: C[2] - pl.hem },
      ],
    });
    for (const side of [-1, 1]) {
      // Пола: от бока до края разреза (разрез шире книзу), только передняя половина.
      const gk = pl.gapK;
      const gapCut: Cut = {
        m: [-side * R[0], 0, -gk * R[2]],
        d: -(pl.gap + 22 * gk) + side * C[0] + gk * C[2],
        face: liningFace(C, R, true),
      };
      const xf = coatXf(c, side, lower);
      out.push({
        c: xf.pt(C),
        ax: [xf.dir([1, 0, 0]), xf.dir([0, 1, 0]), xf.dir([0, 0, 1])],
        r: mul(R, k),
        pal: P_COAT,
        id: nid(),
        bias: 0,
        pick: coatPick(C, R, pl),
        cuts: [{ m: [0, -R[1], 0], d: C[1] - YC, face: liningFace(C, R, true) }, gapCut, hemCut],
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Шарф: кольцо вокруг шеи, узел слева, два конца по груди.
// ---------------------------------------------------------------------------

function scarfTex(i: number) {
  return (qx: number, qy: number, qz: number) => {
    if (!HI) return 0;
    // Вязка: поперечные рубчики.
    const u = qx * 2.2 + i * 0.5;
    return Math.abs((u % 1) - 0.5) < 0.12 ? -0.08 : Math.atan2(qy, qz) > 1.2 ? -0.05 : 0;
  };
}

function tubeSeg(
  out: PartF[],
  P: V3[],
  wid: (u: number) => number,
  pal: number,
  id: number,
  bias: number,
  tex?: (i: number) => Part['tex'],
): void {
  const n = P.length - 1;
  for (let i = 0; i < n; i++) {
    const d = sub(P[i + 1], P[i]);
    const len = Math.hypot(d[0], d[1], d[2]);
    if (len < 1e-4) continue;
    const w = wid((i + 0.5) / n);
    out.push({
      c: mul(add(P[i], P[i + 1]), 0.5),
      ax: axes(d, [0, 1, 0]),
      r: [len * 0.55 + 0.3 * w, w, w * 0.85],
      pal,
      id,
      tube: true,
      bias,
      tex: tex ? tex(i) : undefined,
    });
  }
}

function scarf(out: PartF[], c: Ctx): void {
  const { o, S, lag } = c;
  const k = S.k;
  const pl = S.pl;
  const sc = pl.scarf;
  // Кольцо: спереди ниже, сзади выше; рисуется целиком — заднюю половину прячет шея.
  const ring: V3[] = [];
  const nR = HI ? 20 : 14;
  for (let j = 0; j <= nR; j++) {
    const a = (j / nR) * TAU;
    const fy = Math.sin(a);
    ring.push(
      S.up([
        sc[0] + 3.5 * Math.cos(a),
        sc[1] + 3.2 * fy,
        sc[2] - 0.5 * fy + 0.15 * Math.cos(2 * a),
      ]),
    );
  }
  const id = nid();
  tubeSeg(out, ring, () => 1.25 * k, P_SCARF, id, 0.04, scarfTex);
  // Узел слева спереди.
  const knot = S.up(add(sc, [-1.5, 3.2, -0.7]));
  out.push({
    c: knot,
    ax: S.bax,
    r: [1.45 * k, 1.1 * k, 1.25 * k],
    pal: P_SCARF,
    id: nid(),
    bias: 0.1,
    tex: HI ? (qx, _qy, qz) => (Math.abs(qx + qz * 0.4) < 0.14 ? -0.12 : 0) : undefined,
  });
  if (o.curl > 0.6) return;
  // Концы: свисают по груди, качаются за грудью с запаздыванием.
  const swX = (lag.scarfX - S.cc[0]) * 0.9;
  const swZ = Math.max(-1.5, Math.min(1.5, (lag.scarfZ - S.cc[2]) * 0.6));
  for (const [dx, len, wd] of [
    [-1.2, 7.4, 1.05],
    [0.5, 5.2, 0.95],
  ] as [number, number, number][]) {
    const pts: V3[] = [];
    const n = HI ? 8 : 5;
    for (let j = 0; j <= n; j++) {
      const u = j / n;
      const z = sc[2] - 1.0 - len * u;
      const sway = u * u;
      pts.push(
        add(S.up([sc[0] + dx * (1 + 0.8 * u) - 0.4 * u, sc[1] + 4.0 + 0.9 * u, z + 0.4 * swZ * sway]), [
          swX * sway,
          0,
          0,
        ]),
      );
    }
    const eid = nid();
    tubeSeg(out, pts, (u) => wd * k * (1 - 0.15 * u), P_SCARF, eid, 0.06, scarfTex);
    // Бахрома на конце (крупная): тёмные рубчики.
    if (HI) {
      const tip = pts[n];
      const dd = norm(sub(pts[n], pts[n - 1]));
      for (const f of [-0.6, 0, 0.6]) {
        const b = add(tip, [f * k, 0.2, 0]);
        out.push({
          c: add(b, mul(dd, 0.6 * k)),
          ax: axes(dd, [0, 1, 0]),
          r: [0.7 * k, 0.28 * k, 0.28 * k],
          pal: P_SCARF,
          id: eid,
          bias: -0.12,
          noSeam: true,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Хвост: тёмный, пушистый, крючком вверх.
// ---------------------------------------------------------------------------

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
    q = [q[0] + sw * 1.6 * u * u * (1 - o.curl), q[1], q[2] + upA * 3.2 * u * u * (1 - o.curl)];
    return add(root, q);
  });
  // Кончик загибается к телу: последние точки поворачиваются вокруг третьей с конца.
  if (Math.abs(cu) > 0.01 && o.curl < 0.5) {
    const piv = pts[n - 3];
    for (let i = n - 2; i < n; i++) {
      const d = sub(pts[i], piv);
      pts[i] = add(piv, rollY(d, cu * (i === n - 1 ? 0.7 : 0.35)));
    }
  }
  const wp = pts.map((p) => S.up(p));
  const wid = [1.3, 1.9, 2.3, 2.45, 2.3, 1.9, 1.2];
  const segs = HI ? 16 : 11;
  const P: V3[] = [];
  for (let i = 0; i <= segs; i++) P.push(catmull(wp, i / segs));
  const id = nid();
  for (let i = 0; i < segs; i++) {
    const p0 = P[i];
    const p1 = P[i + 1];
    const d = sub(p1, p0);
    const len = Math.hypot(d[0], d[1], d[2]);
    if (len < 1e-4) continue;
    const um = (i + 0.5) / segs;
    const w = profile(wid, um) * k;
    out.push({
      c: mul(add(p0, p1), 0.5),
      ax: axes(d, [0, 0, 1]),
      r: [len * 0.55 + 0.4 * k, w, w * 0.9],
      pal: P_DARK,
      id,
      tube: true,
      bias: 0.06,
      tex: HI
        ? (qx, qy, qz) => ((Math.atan2(qy, qz) * 4.5 + qx * 0.5 + i * 0.3 + 20) % 1 < 0.15 ? -0.08 : 0)
        : undefined,
    });
  }
  // Пряди по наружной кромке — пышность (крупная).
  if (HI) {
    const nl = 7;
    for (let j = 0; j < nl; j++) {
      const u = lerp(0.22, 0.88, j / (nl - 1));
      const p = catmull(wp, u);
      const tg = norm(sub(catmull(wp, Math.min(1, u + 0.04)), catmull(wp, Math.max(0, u - 0.04))));
      const outN = norm(cross(tg, [0, 1, 0]));
      const side = outN[0] > 0 ? outN : mul(outN, -1);
      const dir = norm(add(tg, mul(side, 0.55)));
      const w = profile(wid, u) * k;
      lock(out, add(p, mul(side, 0.5 * w)), dir, [0, 1, 0], 3.0 * k, w * 0.5, w * 0.42, P_DARK, 0.1);
    }
  }
}

// ---------------------------------------------------------------------------
// Голова: соболиные капли, белые брови и морда, нос, уши, кепка.
// ---------------------------------------------------------------------------

/** Скулы и макушка — крем; капли маски вокруг глаз, перемычка над носом, белое над и под маской. */
function facePick(X: number, Y: number, Z: number): number {
  PICK_T = 0;
  const ax = Math.abs(X);
  if (Y > 0.6) {
    // Капля: круг вокруг глаза, хвостик вниз-наружу к щеке; капли не сходятся.
    const dx = ax - 3.1;
    const dz = Z - 0.3;
    const u = dx * 0.86 - dz * 0.5;
    const v = dx * 0.5 + dz * 0.86;
    const e = (u / (u > 0 ? 2.3 : 1.7)) ** 2 + (v / 1.45) ** 2;
    if (e < 1) {
      PICK_T = HI && e > 0.78 ? 0.1 : 0;
      return P_MASK;
    }
    // Светлая проточина между каплями — от морды на лоб.
    if (ax < 1.25 - 0.1 * Z && Z > -0.6) {
      PICK_T = HI ? 0.02 - 0.04 * clamp01(Z / 3) : 0;
      return P_PALE;
    }
    // Белые брови над каплями.
    if (v > 0.4 && e < 2.3 && ax > 1.2) {
      PICK_T = HI ? (e > 2.0 ? -0.08 : 0.02) : 0;
      return P_PALE;
    }
    // Белая морда и подбородок; щёки по бокам — крем.
    if (Z < -0.5 - 0.12 * ax && ax < 3.2) {
      PICK_T = HI ? tufts(6, 5, 0.05, 0)(X / 6, Y / 5, Z / 4.8) : 0;
      return P_PALE;
    }
  }
  PICK_T = -0.12 * clamp01((Z - 1.5) / 3) + (HI ? tufts(5, 4, 0.08, 1.02)(X / 6, Y / 5, Z / 4.8) : 0);
  return P_FUR;
}

/** Выбор по маске для части головы с центром `C`, радиусами `R`, осями `E` (в осях головы). */
function headPick(
  C: V3,
  R: V3,
  E: [V3, V3, V3] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
) {
  return (qx: number, qy: number, qz: number): number => {
    const a = qx * R[0];
    const b = qy * R[1];
    const cc = qz * R[2];
    return facePick(
      C[0] + E[0][0] * a + E[1][0] * b + E[2][0] * cc,
      C[1] + E[0][1] * a + E[1][1] * b + E[2][1] * cc,
      C[2] + E[0][2] * a + E[1][2] * b + E[2][2] * cc,
    );
  };
}

function headParts(out: PartF[], flats: Flat[], c: Ctx): void {
  const { o, h } = c;
  const k = h.k;
  const ex = h.dir([1, 0, 0]);
  const ey = h.dir([0, 1, 0]);
  const ez = h.dir([0, 0, 1]);
  const hax = axes(ex, ez);
  const SK: V3 = [5.3, 4.9, 4.6];
  out.push({
    c: h.at([0, 0, 0]),
    ax: hax,
    r: mul(SK, k),
    pal: P_FUR,
    id: nid(),
    bias: 0.04,
    pick: headPick([0, 0, 0], SK),
  });
  // Скулы — голова шире книзу, клином к морде.
  for (const side of [-1, 1]) {
    const C: V3 = [side * 2.9, 2.4, -2.0];
    const R: V3 = [2.6, 2.6, 2.4];
    out.push({
      c: h.at(C),
      ax: hax,
      r: mul(R, k),
      pal: P_FUR,
      id: nid(),
      bias: 0.08,
      pick: headPick(C, R),
    });
    // Пряди щёк вбок (крупная).
    if (HI)
      lock(
        out,
        h.at([side * 4.5, 1.4, -2.2]),
        h.dir(norm([side, 0.1, -0.6])),
        ey,
        1.7 * k,
        1.1 * k,
        0.9 * k,
        P_FUR,
        -0.02,
      );
  }
  // Морда: белая, вытянутая, чуть вниз.
  const mA = 0.2;
  const max = axes(h.dir([1, 0, 0]), h.dir(pitchX([0, 0, 1], mA)));
  const sn = o.snarl;
  out.push({
    c: h.at([0, 4.8, -1.8]),
    ax: max,
    r: [2.2 * k, 3.2 * k, 1.9 * k],
    pal: P_PALE,
    id: nid(),
    bias: 0.04,
    tex: (qx, qy, qz) => {
      if (sn > 0.2 && qz > 0.2 && qy > 0.1 && (qy * (HI ? 6 : 3)) % 1 < 0.25) return -0.18 * sn;
      // Подушечки усов — точки (крупная).
      if (HI && qy > 0.3 && Math.abs(qx) > 0.45 && qz < 0.1 && qz > -0.5) {
        const g = ((qx + 2) * 7) % 1;
        const gz = ((qz + 2) * 5) % 1;
        if (g < 0.22 && gz < 0.3) return -0.16;
      }
      return 0;
    },
  });
  // Розовый нос на кончике, шевелится.
  out.push({
    c: h.at([0, 7.0 + 0.12 * Math.abs(o.sniff), -0.9 + 0.32 * o.sniff]),
    ax: max,
    r: [1.15 * k, 0.8 * k, 0.85 * k],
    pal: P_NOSE,
    id: nid(),
    bias: 0.1,
    noSeam: true,
  });
  // Нижняя челюсть.
  const jw = o.jaw;
  const piv: V3 = [0, 1.6, -2.8];
  const ja = jw * 0.7;
  const jd = (p: V3): V3 => add(piv, pitchX(sub(p, piv), ja));
  const jax = axes(h.dir(pitchX([1, 0, 0], ja + 0.2)), h.dir(pitchX([0, 0, 1], ja + 0.2)));
  out.push({
    c: h.at(jd([0, 4.0, -3.1])),
    ax: jax,
    r: [1.5 * k, 2.2 * k, 0.85 * k],
    pal: P_PALE,
    id: nid(),
    bias: -0.12,
  });
  if (jw > 0.05 || sn > 0.3) {
    out.push({
      c: h.at([0, 4.6, -2.8 - jw * 0.5]),
      ax: max,
      r: [1.4 * k, 2.2 * k, (0.35 + jw * 0.9) * k],
      pal: P_MOUTH,
      id: nid(),
      bias: -0.2,
      noSeam: true,
    });
    out.push({
      c: h.at(jd([0, 4.6, -2.9])),
      ax: jax,
      r: [1.0 * k, 1.8 * k, 0.42 * k],
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
        c: h.at([side * 0.9, 6.3, -2.8 - 0.25 * o.jaw + 0.15 * sn]),
        ax: axes(h.dir([0, 0.12, -1]), ey),
        r: [(HI ? 0.8 : 1.05) * k, (HI ? 0.34 : 0.45) * k, (HI ? 0.34 : 0.45) * k],
        pal: P_BONE,
        id: nid(),
        bias: 0.1,
        noSeam: true,
      });
    }
  }
  ears(flats, c);
  cap(out, c);
}

/** Уши: маленькие, круглые, низко по бокам; белая кайма, розовое внутри. */
function ears(flats: Flat[], c: Ctx): void {
  const { o, h } = c;
  for (const side of [-1, 1] as const) {
    const back = side < 0 ? o.earL : o.earR;
    const fl = side < 0 ? o.flL : o.flR;
    const base: V3 = [side * 4.6, -0.8, 1.6];
    const rot = (p: V3): V3 => {
      let q = sub(p, base);
      q = pitchX(q, -0.8 * back - 0.3 * fl);
      q = rollY(q, side * (0.85 + 0.4 * fl + 0.2 * Math.max(0, back)));
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
    const outer = ring(2.3, 2.6, 0, 0);
    flats.push({
      pts: outer.map(rot),
      apex: rot(outer[4]),
      a: rot(outer[0]),
      b: rot(outer[8]),
      pal: P_PALE,
      id: nid(),
      shade: (_u, r) => -0.08 - 0.12 * (1 - r) ** 2,
    });
    const inner = ring(1.35, 1.65, 0.25, 0.35);
    flats.push({
      pts: inner.map(rot),
      apex: rot(inner[4]),
      a: rot(inner[0]),
      b: rot(inner[8]),
      pal: P_SKIN,
      id: nid(),
      shade: (u, r) => -0.2 + 0.16 * r + (HI && Math.abs(u - 0.5) < 0.12 && r > 0.3 ? 0.1 : 0),
    });
  }
}

/** Кепка: плоская тулья с нависающим передом, короткий козырёк; набок над левым (в кадре) ухом. */
function cap(out: PartF[], c: Ctx): void {
  const { o, h, lag } = c;
  const k = h.k;
  const capLag = Math.max(-0.12, Math.min(0.12, (lag.capX - c.S.head[0]) * 0.05));
  const roll = -0.22 + o.capT - capLag;
  const pitch = 0.06 + 0.46 * o.capDn;
  const lift = -1.2 * o.capDn;
  const PV: V3 = [0, 0, 2.6];
  const cp = (p: V3): V3 => h.at(add(rollY(pitchX(p, pitch, PV), roll, PV), [0, 0, lift]));
  const cd = (v: V3): V3 => h.dir(rollY(pitchX(v, pitch), roll));
  const cax = axes(cd([1, 0, 0]), cd([0, 0, 1]));
  const id = nid();
  out.push({
    c: cp([-0.4, 0.4, 3.7]),
    ax: cax,
    r: [5.9 * k, 6.0 * k, 2.8 * k],
    pal: P_CAP,
    id,
    bias: 0.02,
    cuts: [{ m: [0, 0, -1], d: 0.2 }],
    pick: (qx, qy, qz) => {
      PICK_T = 0;
      if (qz < 0.05) PICK_T = -0.08;
      if (HI) {
        // Клинья тульи от пуговки и твидовая крапина.
        const a = Math.atan2(qx, qy) / TAU + 0.5;
        if (qz > 0.25 && (a * 8 + 0.5) % 1 < 0.07) PICK_T -= 0.12;
        const hh = hash(Math.floor(qx * 18), Math.floor(qy * 18), 11 + Math.floor(qz * 6));
        if (hh > 0.86) PICK_T += 0.06;
        else if (hh < 0.1) PICK_T -= 0.05;
      }
      return P_CAP;
    },
  });
  // Козырёк — короткий, чуть вниз; снизу темнее.
  out.push({
    c: cp([-0.3, 6.6, 3.15]),
    ax: axes(cd([1, 0, 0]), cd(pitchX([0, 0, 1], 0.2))),
    r: [4.2 * k, 1.9 * k, 0.5 * k],
    pal: P_CAP,
    id: nid(),
    bias: -0.06,
    tex: (_qx, qy, qz) => (qz < -0.3 ? -0.12 : HI && Math.abs(qy - 0.55) < 0.1 ? -0.08 : 0),
  });
  if (HI)
    out.push({
      c: cp([0, 1.2, 6.45]),
      ax: cax,
      r: [0.75 * k, 0.75 * k, 0.45 * k],
      pal: P_CAP,
      id: nid(),
      bias: 0.12,
      noSeam: true,
    });
}

// ---------------------------------------------------------------------------
// Секундомер.
// ---------------------------------------------------------------------------

function watchAt(c: Ctx): V3 {
  const { S } = c;
  return add(S.handR, mul([-0.3, 1.4, 1.9], S.k));
}

function stopwatch(out: PartF[], c: Ctx): void {
  const { o, S } = c;
  if (o.watch < 0.02) return;
  const k = S.k;
  const p = watchAt(c);
  const ax = axes([1, 0, 0], [0, 0, 1]);
  const vis = o.watch;
  const hand = o.hand;
  out.push({
    c: p,
    ax,
    r: [2.0 * k, 0.75 * k, 2.0 * k],
    pal: P_STEEL,
    id: nid(),
    bias: 0.06,
    vis,
    noSeam: true,
    pick: (qx, qy, qz) => {
      PICK_T = 0;
      const e = qx * qx + qz * qz;
      if (qy > 0 && e < (HI ? 0.6 : 0.5)) {
        if (HI) {
          const a = Math.atan2(qx, qz);
          const d = Math.sqrt(e);
          // Риски по кругу и стрелка.
          if (d > 0.6 && (((a / TAU) * 12 + 120) % 1) < 0.14) {
            PICK_T = -0.4;
            return P_DIAL;
          }
          const da = Math.abs(((a - hand + Math.PI * 3) % TAU) - Math.PI);
          if (da < 0.2 && d < 0.66) {
            PICK_T = -0.7;
            return P_DARK;
          }
        } else if (e < 0.08) {
          PICK_T = -0.6;
          return P_DARK;
        }
        PICK_T = 0.06;
        return P_DIAL;
      }
      return P_STEEL;
    },
  });
  // Головка с кнопкой и ушко.
  const top = add(p, [0, 0, (2.35 - 0.35 * o.press) * k]);
  out.push({
    c: top,
    ax,
    r: [0.6 * k, 0.6 * k, 0.55 * k],
    pal: P_STEEL,
    id: nid(),
    bias: 0.1,
    vis,
    noSeam: true,
  });
  if (HI)
    out.push({
      c: add(top, [0, 0, 0.9 * k]),
      ax,
      r: [0.85 * k, 0.4 * k, 0.6 * k],
      pal: P_STEEL,
      id: nid(),
      bias: 0.14,
      vis,
      noSeam: true,
    });
}

// ---------------------------------------------------------------------------
// Свой растр: части с выбором палитры, срезами и проявлением; плоские части.
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
    const cuts = pt.cuts ?? [];
    // Грани срезов в координатах модели: градиент m·q; скорость m·q вдоль луча.
    const cn: V3[] = cuts.map((cu) =>
      norm(add(add(mul(e1, cu.m[0] / r1), mul(e2, cu.m[1] / r2)), mul(e3, cu.m[2] / r3))),
    );
    const cmd = cuts.map((cu) => cu.m[0] * qdx + cu.m[1] * qdy + cu.m[2] * qdz);
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
        const sq = Math.sqrt(disc);
        let t = (-b + sq) / (2 * a);
        let tf = (-b - sq) / (2 * a);
        let hit = -1;
        let gone = false;
        for (let j = 0; j < cuts.length; j++) {
          const cu = cuts[j];
          const m0 = cu.m[0] * q0x + cu.m[1] * q0y + cu.m[2] * q0z;
          const cm = cmd[j];
          if (Math.abs(cm) < 1e-9) {
            if (m0 > cu.d) {
              gone = true;
              break;
            }
            continue;
          }
          const tp = (cu.d - m0) / cm;
          if (cm > 0) {
            if (tp < t) {
              t = tp;
              hit = j;
            }
          } else if (tp > tf) tf = tp;
        }
        if (gone || t < tf) continue;
        const i = py * w + px;
        if (t <= zb[i]) continue;
        const qx = q0x + t * qdx;
        const qy = q0y + t * qdy;
        const qz = q0z + t * qdz;
        let pal = pt.pal;
        let k: number;
        PICK_T = 0;
        if (hit >= 0) {
          const face = cuts[hit].face;
          if (face) pal = face(qx, qy, qz);
          const lam = dot(cn[hit], LIGHT);
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

/** Крупная: редкая шахматка на границе двух ступеней одной части — мягкий переход. */
function softBands(f: Frame): void {
  const { w, h, pal, tone, idb } = f;
  const hit: number[] = [];
  for (let y = 0; y < h - 1; y++)
    for (let x = 0; x < w - 1; x++) {
      const i = y * w + x;
      const pl = pal[i];
      if (pl !== P_FUR && pl !== P_PALE && pl !== P_COAT && pl !== P_DARK && pl !== P_CAP) continue;
      for (const j of [i + w, i + 1]) {
        if (pal[j] === pl && idb[j] === idb[i] && tone[j] === tone[i] - 1 && dith(x, y, 0.28))
          hit.push(j, tone[i]);
      }
    }
  for (let n = 0; n < hit.length; n += 2) f.tone[hit[n]] = hit[n + 1];
}

// ---------------------------------------------------------------------------
// Поверх кадра: глаза, нос, рот, блеск часов, щелчок, скорость, сон, хватка.
// ---------------------------------------------------------------------------

function eyePal(): Record<string, RGBA> {
  const m = PAL[P_MASK];
  return {
    k: INK_V[V],
    W: hx('#fffbf0'),
    g: hx('#b8b0a4'),
    m: m[5],
    l: m[7],
  };
}
// Малая: бусина 2×2 — блик и чернь; закрытые — тёмной чертой (маска бурая, черта видна).
const EYES_S: Record<string, string[]> = {
  open: ['Wk', 'kk'],
  openL: ['kW', 'kk'],
  wide: ['Wk', 'kk'],
  half: ['mm', 'Wk'],
  shut: ['..', 'kk'],
  happy: ['.k.', 'k.k'],
  sleep: ['...', 'kkk'],
  angry: ['k.', 'Wk'],
};
// Крупная: круглая бусина 5×5, два блика; веки — бурой маской.
const EYES_L: Record<string, string[]> = {
  open: ['.kkk.', 'kWWkk', 'kWkkk', 'kkkgk', '.kkk.'],
  openL: ['.kkk.', 'kkWWk', 'kkkWk', 'kgkkk', '.kkk.'],
  wide: ['.kkk.', 'kWWkk', 'kWkkk', 'kkkgk', '.kkk.'],
  half: ['.....', 'mmmmm', 'kWWkk', 'kkkgk', '.kkk.'],
  shut: ['.....', '.....', 'kkkkk', '.lll.', '.....'],
  happy: ['.....', '..k..', '.k.k.', 'k...k', '.....'],
  sleep: ['.....', '.....', 'k...k', '.kkk.', '.....'],
  angry: ['.....', 'kk...', 'kWkk.', 'kkkgk', '.kkk.'],
};

function face(p: Px, f: Frame, c: Ctx): void {
  const { o, h } = c;
  const ep = eyePal();
  for (const side of [-1, 1] as const) {
    const at = seen(f, mul(h.at([side * 2.7, 4.7, 0.7]), RR), OX, OY, 2.4 * RR);
    if (!at) continue;
    let key: string = (side < 0 ? o.eyeL : o.eyeR) ?? o.eye;
    if (key === 'open' || key === 'angry' || key === 'wide') {
      if (o.blink > 0.7) key = 'shut';
      else if (o.blink > 0.25) key = 'half';
    }
    if (key === 'open' && o.look < -0.4) key = 'openL';
    const rows = HI ? EYES_L[key] : EYES_S[key];
    const wdt = rows[0].length;
    const flip = side > 0 && key === 'angry';
    if (HI) stamp(p, rows, ep, at[0] - 2, at[1] - 2, flip);
    else stamp(p, rows, ep, at[0] - (wdt === 3 ? 1 : side < 0 ? 1 : 0), at[1] - 1, flip);
  }
  // Нос: блик (крупная — и ноздри).
  const nose = seen(f, mul(h.at([0, 7.8, -0.5 + 0.32 * o.sniff]), RR), OX, OY, 1.6 * RR);
  if (nose) {
    const nl = PAL[P_NOSE];
    if (HI) {
      p.set(nose[0] - 1, nose[1] - 1, nl[6]);
      p.set(nose[0], nose[1] - 1, nl[5]);
      p.set(nose[0] - 1, nose[1] + 1, nl[1]);
      p.set(nose[0] + 1, nose[1] + 1, nl[1]);
    } else p.set(nose[0], nose[1] - 1, nl[6]);
  }
  // Рот (крупная): от носа вниз и короткой улыбкой.
  if (HI && o.jaw < 0.12 && o.snarl < 0.3) {
    const ink = mixc(PAL[P_PALE][1], INK_V[V], 0.4);
    const gr = o.grin;
    const pts: V3[] = [
      [0, 7.0, -1.75],
      [0, 6.9, -2.1],
      [-0.55, 6.7, -2.35 + 0.1 * gr],
      [0.55, 6.7, -2.35 + 0.1 * gr],
      [-1.1, 6.35, -2.25 + 0.3 * gr],
      [1.1, 6.35, -2.25 + 0.3 * gr],
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

/** Часы на подкладке блестят по очереди, пока пальто распахнуто. */
function glints(p: Px, c: Ctx): void {
  const { o, t } = c;
  if (o.glint < 0.05 || o.open < 0.6) return;
  let n = 0;
  for (const it of LOOT) {
    if (it.kind === 'key') continue;
    const side = it.x < 0 ? -1 : 1;
    const u = wrap(t * 2.6 + n * 0.37, 1);
    n++;
    const L = Math.round(bump(u, 0, 0.5) * o.glint * (HI ? 4 : 2));
    if (L < 1) continue;
    const xf = coatXf(c, side, it.z < 15);
    const w = xf.pt([it.x - 0.4, YC, it.z + 0.4]);
    const [sx, sy] = project(mul(w, RR));
    star(p, Math.round(OX + sx), Math.round(OY + sy), L, WHITE, hx('#ffe08a', 220));
  }
}

/** Щелчок секундомера: вспышка у кнопки и расходящееся кольцо — по пустому фону. */
function clickRing(p: Px, mask: Uint8Array, c: Ctx): void {
  const { o, S } = c;
  if (o.click < 0 || o.watch < 0.3) return;
  const u = o.click;
  const P = watchAt(c);
  const [cx, cy] = project(mul(P, RR));
  const X = OX + cx;
  const Y = OY + cy;
  const col = hx('#fff4dc');
  if (u < 0.3) {
    const [tx, ty] = project(mul(add(P, [0, 0, 2.6 * S.k]), RR));
    star(p, Math.round(OX + tx), Math.round(OY + ty), HI ? 4 : 2, WHITE, hx('#ffe08a', 230));
  }
  const r = (3.2 + 6 * u) * RR;
  for (let a = 0; a < TAU; a += 0.5 / r) {
    const x = Math.round(X + Math.cos(a) * r);
    const y = Math.round(Y + Math.sin(a) * r);
    if (x < 0 || y < 0 || x >= p.w || y >= p.h || mask[y * p.w + x]) continue;
    if (!dith(x, y, 1.15 - u)) continue;
    p.set(x, y, col);
  }
  // Риски «тик» по кругу.
  if (u < 0.6)
    for (const a of [-2.4, -1.57, -0.7, 0.3]) {
      for (let d = 0; d <= (HI ? 3 : 1.5); d += 0.5) {
        const rr = r + (HI ? 3 : 1.5) + d;
        const x = Math.round(X + Math.cos(a) * rr);
        const y = Math.round(Y + Math.sin(a) * rr);
        if (x < 0 || y < 0 || x >= p.w || y >= p.h || mask[y * p.w + x]) continue;
        p.set(x, y, hx('#ffe08a'));
      }
    }
}

/** Скорость: полосы слева, по пустому фону, бегут влево. */
function speedLines(p: Px, mask: Uint8Array, c: Ctx): void {
  const { o, S, t } = c;
  if (o.speed < 0.05) return;
  const col = hx('#f4ead8');
  const dim = hx('#c8bca8');
  const ys = [26, 21, 16, 11, 7];
  ys.forEach((z, j) => {
    const [, sy] = project(mul(S.up([0, 0, z]), RR));
    const y = Math.round(OY + sy);
    const [lx] = project(mul(S.up([-7.4, 0, z]), RR));
    const shift = ((t * 30 + j * 3.7) % 6) * RR;
    const L = (4 + 3 * ((j * 7) % 3)) * RR * o.speed;
    const x0 = Math.round(OX + lx - 2 * RR - shift);
    for (let d = 0; d < L; d++) {
      const x = x0 - d;
      if (x < 0 || y < 0 || x >= p.w || y >= p.h || mask[y * p.w + x]) continue;
      if (!dith(x, y, (1 - d / L) * 1.2)) continue;
      p.set(x, y, d < L * 0.4 ? col : dim);
    }
  });
}

/** Хватка: лучи удара расходятся от морды — только по пустому фону. */
function snap(p: Px, mask: Uint8Array, c: Ctx): void {
  const { o, h } = c;
  const u = o.bite;
  const [sx, sy] = project(mul(h.at([0, 7.6, -2.0]), RR));
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
    headX: lagged((tt) => sk(tt).head[0], 3.4, 0.32, (L0?.headX ?? 0) - S0.head[0], 1),
    headZ: lagged((tt) => sk(tt).head[2], 3.4, 0.32, (L0?.headZ ?? 0) - S0.head[2], 0.8),
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
    scarfX: lagged((tt) => sk(tt).cc[0], 2.2, 0.16, (L0?.scarfX ?? 0) - S0.cc[0]),
    scarfZ: lagged((tt) => sk(tt).cc[2], 2.4, 0.18, (L0?.scarfZ ?? 0) - S0.cc[2]),
    hemX: lagged((tt) => sk(tt).bc[0], 2.0, 0.22, (L0?.hemX ?? 0) - S0.bc[0]),
    capX: lagged((tt) => sk(tt).head[0], 2.6, 0.24, (L0?.capX ?? 0) - S0.head[0]),
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
export function ferretFrame(a: Anim, i: number, res: Res = 's', v = 0): Px {
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
  coat(parts, c);
  scarf(parts, c);
  arms(parts, c);
  headParts(parts, flats, c);
  stopwatch(parts, c);
  drawPartsF(f, toRes(parts), PAL, OX, OY);
  drawFlats(f, flats);
  seams(f, 1.2 * RR, 1);
  rimLight(f, PAL, (pl) => pl !== P_MOUTH && pl !== P_NOSE && pl !== P_MASK && pl !== P_DIAL);
  if (HI) softBands(f);
  const p = toPx(f, PAL);
  selOutline(p, INK_V[V], 0.8);
  const mask = new Uint8Array(p.w * p.h);
  for (let j = 0; j < mask.length; j++) mask[j] = p.data[j * 4 + 3] > 0 ? 1 : 0;
  face(p, f, c);
  glints(p, c);
  clickRing(p, mask, c);
  speedLines(p, mask, c);
  if (a === 'sleep') zzz(p, mask, c);
  if (o.bite >= 0) snap(p, mask, c);
  return p;
}
