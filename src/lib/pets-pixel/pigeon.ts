// Голубь-почтальон — пиксельный питомец по эталону боссов 12–14.
//
// Пухлый сизый городской голубь стоит к нам лицом: круглая голова, оранжевые
// глаза, маленький тёмный клюв с белой восковицей, переливчатый зелёно-
// фиолетовый ворот, светло-серая грудь, на сложенных крыльях по две тёмные
// полосы, розовые лапки. На голове — старый кожаный лётный шлем с ушами и
// очками, через грудь — ремень сумки с письмом, к правой (по кадру) лапке
// красной ниткой привязана свёрнутая записка.
//
// Две полосы, у каждой свой рисунок: малая — рамка 48 (шахта, списки),
// крупная — рамка 112 (карточка, вылупление, Питомник): чешуйки груди и
// ворота, ряды кроющих, швы шлема, стёкла очков, строчка сумки, печать письма.
//
// Анимации 24 к/с по ключам (`kf`). Голова — рывками, как у голубя; ворот
// переливается; шлемные уши, сумка и хвост — с запаздыванием (`spring`).
// Трюк — весточка: записка выскакивает с лапки, голубь ловит её крыльями-
// руками (левое держит край листа, правое — свёрток), разворачивает, читает,
// «!», из-за верхнего края листа выпрыгивает четырёхлистный клевер и падает в
// сумку; голубь сворачивает записку и снова привязывает её к лапке.
//
// Золотой рисуется здесь же (`v` = 1): перо — золото с бронзовой глубиной,
// ворот — изумруд и розовое золото; шлем и сумка остаются кожаными, клевер —
// зелёным. Радужного нет.

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
  LIGHT,
  lerp,
  lerp3,
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
const P_WING = 1;
const P_BREAST = 2;
const P_DARK = 3;
const P_GREEN = 4;
const P_VIOLET = 5;
const P_LEG = 6;
const P_BEAK = 7;
const P_CERE = 8;
const P_LEATHER = 9;
const P_BRASS = 10;
const P_GLASS = 11;
const P_PAPER = 12;
const P_STRING = 13;
const P_MOUTH = 14;

const LEATHER = ramp(
  '#1f120a',
  '#2e1b0f',
  '#402616',
  '#53321d',
  '#673f25',
  '#7c4e2e',
  '#925f39',
  '#a87347',
  '#bd8858',
);
const BRASS = ramp(
  '#2a1a06',
  '#4a300c',
  '#6e4a14',
  '#94661e',
  '#b8862a',
  '#d6a63c',
  '#ecc65c',
  '#f8e090',
  '#fff4c8',
);
// У золотого оправа очков и пряжка медные: латунь на золоте пропадала бы.
const COPPER = ramp(
  '#2a0f08',
  '#4a1c0e',
  '#6e2c16',
  '#934020',
  '#b4562c',
  '#cf6e3c',
  '#e48c56',
  '#f2b082',
  '#fcd6b8',
);
const GLASS = ramp(
  '#0a1c22',
  '#0f2c36',
  '#163e4a',
  '#1f5262',
  '#2a687a',
  '#388094',
  '#4c9aac',
  '#6cb6c6',
  '#a2d8e2',
);
const PAPER = ramp(
  '#5e5442',
  '#7e7258',
  '#9e9070',
  '#bcae8a',
  '#d4c6a2',
  '#e6dabb',
  '#f2e9d2',
  '#faf5e6',
  '#fffdf6',
);
const STRING = ramp('#3a0a0a', '#5c1210', '#821c18', '#a82a22', '#c83e30', '#e05a44', '#f07c62');
const MOUTH = ramp('#1a0610', '#3a0c1c', '#5e1a2c', '#84303e', '#a84a52', '#c8706e');
const CLOVER = ramp(
  '#0c240a',
  '#163c12',
  '#22581c',
  '#2f7426',
  '#3f9032',
  '#54aa42',
  '#70c458',
  '#98dc7c',
  '#c8f0aa',
);

const PAL_V: RGBA[][][] = [
  [
    // Голова, спина, бока: сизое.
    ramp(
      '#171b28',
      '#222838',
      '#2f374a',
      '#3e475d',
      '#4e5871',
      '#5f6a85',
      '#717d98',
      '#8591ab',
      '#9aa6bd',
      '#b2bdd0',
    ),
    // Крыло: светлее и голубее.
    ramp(
      '#1e2331',
      '#2b3243',
      '#3b4357',
      '#4c556c',
      '#5e6882',
      '#717c97',
      '#8592ab',
      '#9aa7be',
      '#b0bccf',
      '#c8d2e0',
    ),
    // Грудь: светло-серая с сиреневым.
    ramp(
      '#3a3f50',
      '#4f5568',
      '#666d81',
      '#7e869a',
      '#979fb2',
      '#afb7c8',
      '#c5ccda',
      '#d8deea',
      '#e9edf5',
    ),
    // Полосы крыла, маховые, кромка хвоста: грифель.
    ramp('#0e1018', '#171a25', '#222634', '#2e3344', '#3b4155', '#4a5166', '#5a627a'),
    // Ворот: зелёный отлив.
    ramp('#0a1a18', '#0e2824', '#143830', '#1b4a3e', '#245e4c', '#2e745a', '#3c8c6a', '#56a682'),
    // Ворот: фиолетовый отлив.
    ramp('#181026', '#221836', '#2e2248', '#3c2c5a', '#4c376c', '#5e4480', '#735496', '#8c68ac'),
    // Лапки: розовые.
    ramp('#3e1418', '#5e2026', '#823036', '#a4444a', '#c45a5e', '#dc7478', '#ec9294', '#f6b4b4'),
    // Клюв и когти: тёмный рог.
    ramp('#0f0c0e', '#1c181b', '#2a2428', '#3a3237', '#4b4248', '#5e555b', '#766c72'),
    // Восковица: белая.
    ramp('#7a766e', '#9c978e', '#bab5ab', '#d2cdc3', '#e4e0d6', '#f2eee6', '#fbf8f2'),
    LEATHER,
    BRASS,
    GLASS,
    PAPER,
    STRING,
    MOUTH,
  ],
  [
    // Золотой: перо — золото, тень — бронза, свет — бледное золото.
    ramp(
      '#2a1804',
      '#42270a',
      '#5e3a0e',
      '#7c5014',
      '#9c681c',
      '#bb8426',
      '#d4a034',
      '#e8bc4c',
      '#f6d673',
      '#fdeca6',
    ),
    ramp(
      '#2e1c06',
      '#48300c',
      '#664612',
      '#86601a',
      '#a67c24',
      '#c49a32',
      '#dab448',
      '#ecca64',
      '#f8e08a',
      '#fff0bc',
    ),
    ramp(
      '#5a4012',
      '#7a5a1c',
      '#9c7a2a',
      '#bc9a3c',
      '#d6b654',
      '#e8cc70',
      '#f4e096',
      '#faefbe',
      '#fff9e2',
    ),
    ramp('#1a0e04', '#2c1806', '#40240a', '#56320e', '#6c4214', '#82541c', '#9a6826'),
    // Ворот золотого: изумруд и розовое золото.
    ramp('#06221a', '#0a3426', '#0e4834', '#145e44', '#1c7654', '#269066', '#36aa7a', '#58c494'),
    ramp('#34120e', '#521e16', '#702c20', '#8e3e2c', '#aa543a', '#c46c4c', '#d88a64', '#eaa882'),
    ramp('#3e1a14', '#5e2a20', '#82402e', '#a4583c', '#c4724c', '#dc8e62', '#eeac80', '#f8cca4'),
    ramp('#140e08', '#241a10', '#36281a', '#4a3a26', '#604e34', '#7a6646', '#968260'),
    ramp('#7a6a48', '#9c8a62', '#bcaa7e', '#d6c69a', '#e8dab4', '#f4ead0', '#fcf6e8'),
    LEATHER,
    COPPER,
    GLASS,
    PAPER,
    STRING,
    MOUTH,
  ],
];
const INK_V: RGBA[] = [hx('#0c0e16'), hx('#1e1004')];
const IRIS_V: RGBA[][] = [
  ramp('#5a1e04', '#9a3a08', '#d4600e', '#f08a24', '#ffb048', '#ffd890'),
  ramp('#5a1404', '#9a2a08', '#d44a0e', '#f0701e', '#ff9a40', '#ffc880'),
];
const WHITE = hx('#fffbe8');
const BANG = hx('#fff2a8');
const ZZ = hx('#dfe4f0');

// ---------------------------------------------------------------------------
// Кадр: холст и рамка тела у двух полос.
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

type Eye = 'open' | 'happy' | 'angry' | 'sleep' | 'wide';

export interface Pose {
  /** Сдвиг вбок, подъём (прыжок); `fz` — лапы идут за телом (1) или стоят (0, шаг). */
  x: number;
  z: number;
  fz: number;
  sq: number;
  lean: number;
  bow: number;
  /** Голова: сдвиг вбок, вперёд (к зрителю), вверх; поворот (+ вправо), кивок (+ вниз), наклон. */
  hx: number;
  hy: number;
  hz: number;
  turn: number;
  nod: number;
  tilt: number;
  /** Клюв: 0 — закрыт, 1 — раскрыт; зоб раздут (воркование, угроза); фаза отлива ворота. */
  beak: number;
  puff: number;
  shim: number;
  /** Крылья: угол руки от «вниз» наружу, веер маховых (левое/правое по кадру). */
  thL: number;
  thR: number;
  fanL: number;
  fanR: number;
  tailFan: number;
  /** Лапки: сдвиг вбок, вперёд, подъём (по кадру левая и правая). */
  fLx: number;
  fLy: number;
  fLz: number;
  fRx: number;
  fRy: number;
  fRz: number;
  eye: Eye;
  blinkL: number;
  blinkR: number;
  /** Куда смотрят зрачки (доли радиуса глаза): + вправо, + вниз. */
  lookX: number;
  lookY: number;
  /** Перо распушено (сон, угроза). */
  fluff: number;
  scale: number;
  /** Шлем сдвинут на глаза (рад); голова спрятана в перо плеча (сон). */
  capTip: number;
  tuck: number;
  /**
   * Крылья-руки держат записку перед грудью (0…1, левое и правое по кадру);
   * `spread` — лист развёрнут (0 — свёрток в обеих, 1 — левое держит край,
   * правое отнесло свёрток); `tie` — правое несёт свёрток к лапке (0 — у
   * груди, 1 — у лапки).
   */
  holdL: number;
  holdR: number;
  spread: number;
  tie: number;
  /** Записка: привязана к лапке (1/0); полёт с лапки в крылья (−1 — нет, иначе доля пути). */
  tied: number;
  fly: number;
  /** Щелчок развязавшейся нитки (−1 — нет, иначе доля). */
  pop: number;
  /** «!» над головой (0…1); клевер: доля пути (−1 — нет); блеск. */
  bang: number;
  clover: number;
  glint: number;
  /** Клевок: лучи (−1 — нет, иначе доля). */
  strike: number;
}

const REST_TH = -0.12;
const REST_FAN = 0.4;
const REST: Pose = {
  x: 0,
  z: 0,
  fz: 1,
  sq: 0,
  lean: 0,
  bow: 0,
  hx: 0,
  hy: 0,
  hz: 0,
  turn: 0,
  nod: 0,
  tilt: 0,
  beak: 0,
  puff: 0,
  shim: 0,
  thL: REST_TH,
  thR: REST_TH,
  fanL: REST_FAN,
  fanR: REST_FAN,
  tailFan: 0,
  fLx: 0,
  fLy: 0,
  fLz: 0,
  fRx: 0,
  fRy: 0,
  fRz: 0,
  eye: 'open',
  blinkL: 0,
  blinkR: 0,
  lookX: 0,
  lookY: 0,
  fluff: 0,
  scale: 1,
  capTip: 0,
  tuck: 0,
  holdL: 0,
  holdR: 0,
  spread: 0,
  tie: 0,
  tied: 1,
  fly: -1,
  pop: -1,
  bang: 0,
  clover: -1,
  glint: 0,
  strike: -1,
};

const loopK = (t: number, T: number, keys: Key[]) => kf(wrap(t, T), keys);
const TAU = Math.PI * 2;
const frac = (v: number) => v - Math.floor(v);

// ---------------------------------------------------------------------------
// Дорожки анимаций.
// ---------------------------------------------------------------------------

function idlePose(t: number): Pose {
  const T = dur('idle');
  const o: Pose = { ...REST };
  // Дыхание: вдох быстрее выдоха; перо приподнимается.
  const br = loopK(t, T, [
    [0, 0],
    [0.15, 0],
    [0.8, 1, 'o'],
    [1.0, 0.95],
    [1.5, 0.05],
    [1.62, 0],
    [2.7, 0],
    [2.95, 0],
    [T, 0],
  ]);
  o.sq = -0.02 * br;
  o.fluff = 0.22 * br;
  // Ворот переливается: два круга отлива на петлю (шва нет).
  o.shim = (t / T) * 2;
  // Голова — рывками, как у голубя: быстрый поворот, пауза, быстрый поворот.
  o.turn = loopK(t, T, [
    [0, 0],
    [0.3, 0],
    [0.36, 0.34, 'o'],
    [0.78, 0.33],
    [0.84, 0.0, 'o'],
    [1.18, 0],
    [1.24, -0.32, 'o'],
    [1.6, -0.31],
    [1.66, 0, 'o'],
    [T, 0],
  ]);
  o.tilt = loopK(t, T, [
    [0, 0],
    [0.36, 0],
    [0.42, 0.1, 'o'],
    [0.78, 0.1],
    [0.84, 0, 'o'],
    [1.24, 0],
    [1.3, -0.08, 'o'],
    [1.6, -0.08],
    [1.66, 0, 'o'],
    [T, 0],
  ]);
  // Два кивка-клевка воздуха после поворотов.
  const bob = kf(t, [
    [0.9, 0],
    [0.96, 1, 'o'],
    [1.04, 0, 'i'],
    [1.08, 0.7, 'o'],
    [1.16, 0, 'i'],
  ]);
  o.hy = 1.4 * bob;
  o.nod = 0.1 * bob;
  // Воркование: зоб раздувается, поклон, хвост веером, ворот вспыхивает.
  const coo = kf(t, [
    [1.8, 0],
    [2.02, 1, 'o'],
    [2.2, 0.85],
    [2.34, 1, 'o'],
    [2.6, 0, 'i'],
  ]);
  o.puff = coo;
  o.bow = 0.1 * coo;
  o.nod += 0.12 * coo;
  o.hz = -0.6 * coo;
  o.tailFan = 0.45 * coo;
  o.fluff += 0.25 * coo;
  // Моргает обоими: веко снизу у голубя, но мультяшно — сверху.
  o.blinkL = o.blinkR = Math.max(bump(t, 1.12, 1.26), bump(t, 2.74, 2.88));
  // Блик на стекле очков — своя фаза.
  o.glint = bump(t, 0.5, 0.8);
  return o;
}

/** Ходьба: шаг, вес над опорной лапкой, голова стоит и рывком уходит вперёд. */
const W_SWAY = 0.7;
const wSway = (h: number) =>
  loopK(h, 1, [
    [0, 0],
    [0.22, 1, 'o'],
    [0.3, 0.95],
    [0.5, 0],
    [0.72, -1, 'o'],
    [0.8, -0.95],
    [1.0, 0],
  ]);
/** Рывок головы в шаге: доли шага 0,22…0,36; в остальное время голова держится. */
const THR0 = 0.11;
const THR1 = 0.18;

function walkPose(t: number): Pose {
  const T = dur('walk');
  const o: Pose = { ...REST };
  const h = wrap(t, T);
  o.fz = 0;
  // 0–0,5 — левая лапка (по кадру) в воздухе, вес на правой; 0,5–1 — наоборот.
  const liftL = bump(h, 0.05, 0.42);
  const liftR = bump(h, 0.55, 0.92);
  o.fLz = 2.0 * liftL ** 0.8;
  o.fRz = 2.0 * liftR ** 0.8;
  o.fLy = 0.9 * liftL;
  o.fRy = 0.9 * liftR;
  const sway = wSway(h);
  // Вес над опорной: левая поднята → тело и крен вправо.
  o.x = W_SWAY * sway;
  o.lean = 0.06 * sway;
  o.sq = 0.04 * Math.max(bump(h, 0.4, 0.6), bump(h, 0.9, 1.0), bump(h, 0, 0.1));
  // Голова: держится на месте в мире, пока тело качается под ней, потом
  // рывком догоняет (и уходит вперёд-вниз, клюв клюёт воздух).
  const step = Math.floor(h / 0.5);
  const ph = h - step * 0.5;
  const bodyX = (hh: number) => W_SWAY * wSway(wrap(hh, 1));
  let headW: number;
  if (ph < THR0) headW = bodyX(step * 0.5 - 0.5 + THR1);
  else if (ph < THR1) {
    const u = (ph - THR0) / (THR1 - THR0);
    const e = 1 - (1 - u) ** 3;
    headW = lerp(bodyX(step * 0.5 - 0.5 + THR1), bodyX(step * 0.5 + THR1), e);
  } else headW = bodyX(step * 0.5 + THR1);
  o.hx = headW - o.x;
  const fwd = kf(ph, [
    [0, -0.55],
    [THR0, -1.3],
    [THR1, 1.4, 'o'],
    [0.5, -0.55],
  ]);
  o.hy = 1.5 * fwd;
  o.nod = 0.1 * bump(ph, THR0 - 0.01, THR1 + 0.06);
  o.hz = -0.35 * bump(ph, THR0, THR1 + 0.08);
  o.tilt = -0.04 * sway;
  // Ворот переливается от рывков; хвост в такт.
  o.shim = h;
  o.tailFan = 0.12 * Math.abs(sway);
  return o;
}

function happyPose(t: number): Pose {
  const o: Pose = { ...REST };
  const T = dur('happy');
  // Присел → толчок → в воздухе два взмаха → приземлился, воркнул.
  o.sq = kf(t, [
    [0, 0],
    [0.14, 0.14, 'o'],
    [0.22, -0.1, 'i'],
    [0.36, -0.04, 'o'],
    [0.62, 0],
    [0.74, -0.04],
    [0.8, 0.12, 'i'],
    [0.9, -0.02, 'o'],
    [0.98, 0.01],
    [T, 0],
  ]);
  o.z = kf(t, [
    [0, 0],
    [0.18, 0],
    [0.42, 6.0, 'o'],
    [0.52, 6.2],
    [0.78, 0, 'i'],
    [T, 0],
  ]);
  o.thL = o.thR = kf(t, [
    [0, REST_TH],
    [0.14, 0.2, 'o'],
    [0.26, 1.35, 'o'],
    [0.36, 0.5, 'i'],
    [0.48, 1.3, 'o'],
    [0.6, 0.55, 'i'],
    [0.72, 0.95, 'o'],
    [0.86, REST_TH, 'i'],
    [T, REST_TH],
  ]);
  o.fanL = o.fanR = kf(t, [
    [0, REST_FAN],
    [0.26, 1.15, 'o'],
    [0.72, 0.95],
    [0.88, REST_FAN],
  ]);
  o.nod = kf(t, [
    [0, 0],
    [0.14, 0.1, 'o'],
    [0.3, -0.14, 'o'],
    [0.7, -0.08],
    [0.84, 0.06],
    [1.0, 0],
  ]);
  o.tilt = kf(t, [
    [0.3, 0],
    [0.46, 0.12],
    [0.64, -0.1],
    [0.9, 0],
  ]);
  o.fluff = kf(t, [
    [0.1, 0],
    [0.3, 0.4, 'o'],
    [0.8, 0.25],
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
    [0.4, 1.4, 'o'],
    [0.7, 1.0],
    [0.78, 0, 'i'],
  ]);
  o.eye = t > 0.08 && t < 0.98 ? 'happy' : 'open';
  // Воркнул на приземлении: зоб.
  o.puff = bump(t, 0.7, 1.04);
  o.shim = kf(t, [
    [0, 0],
    [1.0, 1],
  ]);
  return o;
}

/** Трюк: моменты (с). */
const T_POP = 0.22;
const T_CATCH = 0.48;
const T_CLOV = 1.06;
const T_BAG = 1.5;
const T_TIE = 1.72;

function workPose(t: number): Pose {
  const o: Pose = { ...REST };
  // 0–0,22 — глянул на лапку, приподнял её и тряхнул: нитка развязалась.
  o.fRz = kf(t, [
    [0.04, 0],
    [0.12, 1.6, 'o'],
    [0.17, 1.1],
    [T_POP, 1.8, 'o'],
    [0.3, 0, 'i'],
    // 1,5–1,86 — лапку подаёт навстречу крыльям, пока к ней привязывают записку.
    [1.5, 0],
    [1.64, 2.8, 'o'],
    [T_TIE + 0.04, 2.8],
    [1.86, 0, 'i'],
  ]);
  o.fRx = 0.35 * Math.sin((t - 0.12) * TAU * 9) * bump(t, 0.12, T_POP + 0.02);
  o.tied = t < T_POP || t >= T_TIE ? 1 : 0;
  o.pop = t >= T_POP && t < T_POP + 0.16 ? (t - T_POP) / 0.16 : -1;
  // 0,22–0,48 — записка летит дугой с лапки в крылья, кувыркаясь.
  o.fly = t >= T_POP && t < T_CATCH ? (t - T_POP) / (T_CATCH - T_POP) : -1;
  // Крылья-руки выходят вперёд и ловят свёрток перед грудью; к лапке его
  // несёт одно правое крыло — левое возвращается к боку.
  o.holdL = kf(t, [
    [0.24, 0],
    [0.44, 1, 'o'],
    [1.5, 1],
    [1.64, 0, 'i'],
  ]);
  o.holdR = kf(t, [
    [0.24, 0],
    [0.44, 1, 'o'],
    [T_TIE + 0.04, 1],
    [1.9, 0, 'i'],
  ]);
  // Пока правая лапка поднята, вес — на левой.
  o.x = kf(t, [
    [1.5, 0],
    [1.64, -0.7, 'o'],
    [T_TIE + 0.04, -0.7],
    [1.9, 0, 'i'],
  ]);
  o.lean = 0.07 * o.x;
  // 0,52–0,74 — разворачивает: левое держит край, правое относит свёрток;
  // 1,36–1,5 — сворачивает обратно.
  o.spread = kf(t, [
    [0.52, 0],
    [0.74, 1, 'o'],
    [1.36, 1],
    [1.5, 0, 'i'],
  ]);
  // 1,5–1,72 — несёт свёрток к лапке (наклоняется), привязывает.
  o.tie = kf(t, [
    [1.5, 0],
    [T_TIE, 1, 's'],
    // Крыло уже отпустило (holdR 0) — сброс к покою не виден.
    [1.9, 1],
    [1.91, 0],
  ]);
  o.bow = kf(t, [
    [0, 0],
    [0.08, 0.08, 'o'],
    [0.26, 0],
    [1.48, 0],
    [1.66, 0.5, 'o'],
    [T_TIE + 0.04, 0.52],
    [1.92, 0, 'i'],
  ]);
  o.sq = kf(t, [
    [1.48, 0],
    [1.66, 0.08, 'o'],
    [T_TIE + 0.04, 0.08],
    [1.92, 0, 'i'],
  ]);
  // Голова: на лапку → следит за запиской вверх → на лист → «!» → за клевером
  // вверх-влево и вниз в сумку → на лапку, пока вяжет → к нам.
  o.turn = kf(t, [
    [0, 0],
    [0.06, 0.3, 'o'],
    [T_POP, 0.26],
    [0.36, 0.06],
    [0.6, 0.06],
    [0.8, 0.18],
    [0.98, 0.12],
    [1.04, 0, 'o'],
    [1.2, -0.36, 'o'],
    [1.4, -0.3],
    [1.5, -0.12],
    [1.62, 0.22, 'o'],
    [T_TIE + 0.04, 0.22],
    [1.9, 0, 'i'],
  ]);
  o.nod = kf(t, [
    [0, 0],
    [0.06, 0.34, 'o'],
    [T_POP, 0.3],
    [0.32, -0.16, 'o'],
    [0.42, 0.02],
    [T_CATCH, 0.2, 'o'],
    [0.76, 0.3],
    [0.98, 0.32],
    [1.02, 0.02, 'o'],
    [1.2, -0.18, 'o'],
    [1.34, -0.1],
    [1.48, 0.28, 'o'],
    [1.62, 0.36],
    [T_TIE + 0.04, 0.32],
    [1.9, 0, 'i'],
  ]);
  o.hy = kf(t, [
    [0.98, 0],
    [1.02, -1.2, 'o'],
    [1.12, 0],
  ]);
  // Читает: зрачки бегут по строчкам слева направо, дважды.
  const rd = clamp01((t - 0.76) / 0.22);
  o.lookX = t > 0.74 && t < 1.0 ? -0.45 + 0.9 * frac(rd * 2) : 0;
  o.lookY = t > 0.5 && t < 1.0 ? 0.35 : 0;
  o.eye = t > 1.0 && t < 1.14 ? 'wide' : t > 1.3 && t < 1.66 ? 'happy' : 'open';
  // «!» над головой.
  o.bang = kf(t, [
    [0.99, 0],
    [1.04, 1, 'o'],
    [1.3, 1],
    [1.42, 0, 'i'],
  ]);
  // Клевер выпрыгивает из-за верхнего края листа и падает в сумку.
  o.clover = t >= T_CLOV && t < T_BAG + 0.06 ? (t - T_CLOV) / (T_BAG - T_CLOV) : -1;
  o.glint = Math.max(bump(t, 1.08, 1.3), bump(t, 1.48, 1.64));
  o.puff = 0.7 * bump(t, 1.3, 1.62);
  o.shim = kf(t, [
    [0, 0],
    [1.9, 1],
  ]);
  return o;
}

function attackPose(t: number): Pose {
  // Распушился (зоб, перо, крылья в стороны) → бросок к зрителю, крылья
  // распахнуты, клевок раскрытым клювом (удар 0,34 с) → проводка → покой.
  const o: Pose = { ...REST };
  o.fluff = kf(t, [
    [0, 0],
    [0.24, 1.0, 'o'],
    [0.5, 0.7],
    [0.82, 0],
  ]);
  o.puff = kf(t, [
    [0, 0],
    [0.22, 1, 'o'],
    [0.5, 0.6],
    [0.8, 0],
  ]);
  o.thL = o.thR = kf(t, [
    [0, REST_TH],
    [0.2, 0.75, 'o'],
    [0.28, 0.85],
    [0.34, 1.75, 'o'],
    [0.5, 1.5],
    [0.66, 0.7],
    [0.82, REST_TH, 'i'],
  ]);
  o.fanL = o.fanR = kf(t, [
    [0, REST_FAN],
    [0.24, 0.8, 'o'],
    [0.34, 1.25, 'o'],
    [0.56, 1.0],
    [0.82, REST_FAN],
  ]);
  o.bow = kf(t, [
    [0, 0],
    [0.24, -0.12, 'o'],
    [0.34, 0.22, 'i'],
    [0.5, 0.18, 'o'],
    [0.66, 0.06],
    [0.82, 0],
  ]);
  o.scale = kf(t, [
    [0.26, 1],
    [0.34, 1.18, 'i'],
    [0.5, 1.12],
    [0.76, 1, 'o'],
  ]);
  o.sq = kf(t, [
    [0, 0],
    [0.1, 0.1, 'o'],
    [0.26, -0.06],
    [0.34, 0.08, 'i'],
    [0.5, 0.02, 'o'],
    [0.7, 0],
  ]);
  // Лапки идут вперёд только в воздухе: бросок — подскок, назад — второй
  // подскок (по земле они ехали бы).
  o.z = kf(t, [
    [0.08, 0],
    [0.26, 1.2, 'o'],
    [0.34, 1.6],
    [0.48, 0.5],
    [0.54, 0, 'i'],
    [0.6, 0],
    [0.66, 0.8, 'o'],
    [0.74, 0, 'i'],
  ]);
  // Голова: втянута → выброшена вперёд, клюв к зрителю (голова поднята).
  o.hy = kf(t, [
    [0, 0],
    [0.24, -1.6, 'o'],
    [0.34, 3.6, 'i'],
    [0.5, 2.4],
    [0.8, 0],
  ]);
  o.hz = kf(t, [
    [0, 0],
    [0.24, -0.9, 'o'],
    [0.34, -0.2],
    [0.8, 0],
  ]);
  o.nod = kf(t, [
    [0, 0],
    [0.24, 0.1, 'o'],
    [0.34, -0.34, 'i'],
    [0.52, -0.2],
    [0.82, 0],
  ]);
  o.eye = t > 0.04 && t < 0.74 ? 'angry' : 'open';
  o.beak = kf(t, [
    [0.12, 0],
    [0.26, 0.3, 'o'],
    [0.32, 0.25],
    [0.36, 1, 'o'],
    [0.5, 0.8],
    [0.66, 0],
  ]);
  o.tailFan = kf(t, [
    [0.1, 0],
    [0.28, 0.9, 'o'],
    [0.5, 1],
    [0.82, 0],
  ]);
  o.fLy = o.fRy = kf(t, [
    [0.26, 0],
    [0.34, 2.4, 'o'],
    [0.48, 2.0],
    [0.6, 2.0],
    [0.74, 0, 'i'],
  ]);
  o.strike = t >= 0.34 && t < 0.6 ? (t - 0.34) / 0.26 : -1;
  o.shim = kf(t, [
    [0, 0],
    [0.8, 1],
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
    [2.35, 1.25, 'o'],
    [2.95, 0],
    [T, 0],
  ]);
  // Нахохлился шаром: голова ушла в перо левого плеча, клюв спрятан, шлем
  // съехал на глаза.
  o.fluff = 1.1 + 0.22 * br;
  o.sq = 0.08 - 0.03 * br;
  o.hz = -3.4 + 0.3 * br;
  o.hx = -0.8;
  o.turn = -0.46;
  o.tilt = -0.14;
  o.nod = 0.3 - 0.03 * br;
  o.capTip = 0.16;
  o.tuck = 1;
  o.thL = REST_TH + 0.06 + 0.02 * br;
  o.thR = REST_TH - 0.02 + 0.02 * br;
  o.eye = 'sleep';
  o.shim = (t / T) * 1;
  return o;
}

const POSES: Record<Anim, (t: number) => Pose> = {
  idle: idlePose,
  walk: walkPose,
  happy: happyPose,
  work: workPose,
  attack: attackPose,
  sleep: sleepPose,
};

export function poseAt(a: Anim, t: number): Pose {
  const o = POSES[a](t);
  // Отлив — фаза круга: целое число кругов = ноль (стык с покоем без шва).
  o.shim = frac(o.shim);
  return o;
}

// ---------------------------------------------------------------------------
// Скелет (в пикселях малой полосы).
// ---------------------------------------------------------------------------

interface Skel {
  up: (p: V3) => V3;
  body: V3;
  neck: V3;
  head: V3;
  shL: V3;
  shR: V3;
  rump: V3;
  hipL: V3;
  hipR: V3;
  footL: V3;
  footR: V3;
  k: number;
}

const BODY0: V3 = [0, 0, 14.0];
const NECK0: V3 = [0, 1.4, 23.4];
const HEAD0: V3 = [0, 1.4, 31.0];
const G = 1.0;

function skel(o: Pose): Skel {
  const s = o.scale * G;
  const sq = o.sq;
  const up = (p: V3): V3 => {
    let q: V3 = [p[0] * (1 + sq * 0.5), p[1] * (1 + sq * 0.4), p[2] * (1 - sq)];
    q = pitchX(q, o.bow, [0, 0, 4]);
    q = rollY(q, o.lean, [0, 0, 0]);
    q = mul(q, s);
    return add(q, [o.x, 0, o.z]);
  };
  const foot = (side: number, dx: number, dy: number, dz: number): V3 =>
    add([side * 3.8 * G + dx, 3.4 * G + dy, 0.5 * G + dz], [o.x * o.fz, 0, o.z * o.fz]);
  return {
    up,
    body: up(BODY0),
    neck: up(NECK0),
    head: up(add(HEAD0, [o.hx, o.hy, o.hz])),
    shL: up([-8.3, 0.4, 20.6]),
    shR: up([8.3, 0.4, 20.6]),
    rump: up([0, -6.0, 8.5]),
    hipL: up([-3.6, 2.4, 5.8]),
    hipR: up([3.6, 2.4, 5.8]),
    footL: foot(-1, o.fLx, o.fLy, o.fLz),
    footR: foot(1, o.fRx, o.fRy, o.fRz),
    k: s,
  };
}

/** Голова в своих единицах: полуоси, глаза (доли полуосей). */
const HRX = 7.4;
const HRY = 6.6;
const HRZ = 7.0;
const EYE_X = 0.47;
const EYE_Z = 0.04;

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
  // На малой голова крупнее: глаза и шлем — главное.
  const k = S.k * (HI ? 1.04 : 1.12);
  return { dir, k, at: (p) => add(S.head, mul(dir(p), k)) };
}
/** Шлем: та же голова, сдвинутая на глаза поворотом вокруг середины (сон). */
function capF(o: Pose, h: HeadF): HeadF {
  const dir = (v: V3): V3 => h.dir(pitchX(v, o.capTip));
  return { dir, k: h.k, at: (p) => h.at(pitchX(p, o.capTip, [0, 0, -1.0])) };
}

// ---------------------------------------------------------------------------
// Свой растр: части с выбором палитры по точке, срезом и проявлением.
// ---------------------------------------------------------------------------

interface PartF extends Part {
  pick?: (qx: number, qy: number, qz: number) => number;
  /** Срез: эту точку части не рисовать (шлем — только верх головы). */
  cut?: (qx: number, qy: number, qz: number) => boolean;
  /** Проявление шахматкой. */
  vis?: number;
}
/** Сдвиг тона, который `pick` возвращает вместе с палитрой. */
let PICK_T = 0;

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
        if (vis < 1 && !dith(px, py, vis)) continue;
        const nx = (e1[0] * qx) / r1 + (e2[0] * qy) / r2 + (e3[0] * qz) / r3;
        const ny = (e1[1] * qx) / r1 + (e2[1] * qy) / r2 + (e3[1] * qz) / r3;
        const nz = (e1[2] * qx) / r1 + (e2[2] * qy) / r2 + (e3[2] * qz) / r3;
        const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        const lam = (nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]) / nl;
        const bounce = Math.max(0, -nz / nl) * 0.14;
        let pal = pt.pal;
        PICK_T = 0;
        PX = px;
        PY = py;
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

/**
 * Плоский четырёхугольник o + u·eu + v·ev (u, v ∈ [0, 1]) прямо в кадр с
 * глубиной (лист записки). `shade(u, v)` — сдвиг тона по месту.
 */
function quadF(
  f: Frame,
  o: V3,
  eu: V3,
  ev: V3,
  pal: number,
  id: number,
  shade: (u: number, v: number) => number,
  alt = pal,
): void {
  const P = project(mul(o, RR));
  const U = project(mul(eu, RR));
  const W = project(mul(ev, RR));
  const det = U[0] * W[1] - U[1] * W[0];
  if (Math.abs(det) < 1e-6) return;
  let n = norm(cross(eu, ev));
  if (dot(n, VIEW) < 0) n = mul(n, -1);
  const base = Math.max(0, dot(n, LIGHT) * 0.55 + 0.42);
  const N = PAL[pal].length;
  const xs = [0, U[0], W[0], U[0] + W[0]];
  const ys = [0, U[1], W[1], U[1] + W[1]];
  const X0 = Math.max(0, Math.floor(OX + P[0] + Math.min(...xs)));
  const X1 = Math.min(f.w - 1, Math.ceil(OX + P[0] + Math.max(...xs)));
  const Y0 = Math.max(0, Math.floor(OY + P[1] + Math.min(...ys)));
  const Y1 = Math.min(f.h - 1, Math.ceil(OY + P[1] + Math.max(...ys)));
  for (let py = Y0; py <= Y1; py++)
    for (let px = X0; px <= X1; px++) {
      const sx = px + 0.5 - OX - P[0];
      const sy = py + 0.5 - OY - P[1];
      const u = (sx * W[1] - sy * W[0]) / det;
      const v = (U[0] * sy - U[1] * sx) / det;
      if (u < 0 || u > 1 || v < 0 || v > 1) continue;
      const d = P[2] + u * U[2] + v * W[2];
      const i = py * f.w + px;
      if (d <= f.zb[i]) continue;
      // Тон −5 и ниже — дырка (скруглённый угол); от 50 — вторая палитра (пряжка).
      let sh = shade(u, v);
      if (sh < -5) continue;
      let pl = pal;
      if (sh >= 50) {
        sh -= 100;
        pl = alt;
      }
      const Np = pl === pal ? N : PAL[pl].length;
      f.zb[i] = d;
      f.idb[i] = id;
      f.pal[i] = pl;
      f.tone[i] = Math.max(0, Math.min(Np - 1, Math.round((base + sh) * (Np - 1))));
    }
}

// ---------------------------------------------------------------------------
// Детали.
// ---------------------------------------------------------------------------

interface Lag {
  headX: number;
  headZ: number;
  turn: number;
  tilt: number;
  thL: number;
  thR: number;
  bodyX: number;
  bodyZ: number;
}

interface Ctx {
  o: Pose;
  S: Skel;
  h: HeadF;
  lag: Lag;
  t: number;
  a: Anim;
}

let NEXT_ID = 0;
const nid = () => ++NEXT_ID;
let HEAD_ID = -1;
let BODY_ID = -1;
let SHIM = 0;

interface FOpt {
  id?: number;
  segs?: number;
  tex?: Part['tex'];
  /** Узор по доле длины всей детали; `qy`, `qz` — по сечению. */
  utex?: (u: number, qy: number, qz: number) => number;
  /** Палитра по доле длины; тон — через `PICK_T`. */
  upick?: (u: number, qy: number, qz: number) => number;
  bias?: number;
  noSeam?: boolean;
  over?: number;
}

function profile(wid: number[], u: number): number {
  const wf = wid.length - 1;
  const wi = Math.min(wf - 1, Math.floor(u * wf));
  return lerp(wid[wi], wid[wi + 1], u * wf - wi);
}

/** Звенья детали по кривой `at(u)`: ширина и толщина — профили по длине. */
function chainP(
  out: PartF[],
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
    const up = op.upick;
    const uq = (qx: number) => clamp01(um + (qx * r0) / (len * segs));
    const sc = (qx: number) => 1 / Math.sqrt(Math.max(0.04, 1 - qx * qx));
    out.push({
      c: mul(add(p0, p1), 0.5),
      ax: axes(d, nrm),
      r: [r0, Math.max(0.35, profile(wid, um)), Math.max(0.35, th)],
      pal,
      id,
      tex: ut ? (qx, qy, qz) => ut(uq(qx), qy * sc(qx), qz * sc(qx)) : op.tex,
      pick: up ? (qx, qy, qz) => up(uq(qx), qy * sc(qx), qz * sc(qx)) : undefined,
      bias: op.bias,
      noSeam: op.noSeam,
    });
  }
}

function feather(
  out: PartF[],
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

/** Расстояние от точки до отрезка (в долях части). */
function segDist(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const u = clamp01(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy));
  return Math.hypot(x - ax - u * dx, y - ay - u * dy);
}

/**
 * Отлив ворота: спереди зелёный, к бокам фиолетовый; граница и косой блик
 * плывут по фазе `SHIM` (узор — от ЛОКАЛЬНЫХ координат части, не «кипит»).
 */
/** Пиксель, который сейчас красит `pick` (для шахматки на кромках). */
let PX = 0;
let PY = 0;
function irid(u: number, v: number): number {
  const s = SHIM * TAU;
  const au = Math.abs(u + 0.08 * Math.sin(s));
  const band = u * 0.7 + v * 0.5 - (frac(SHIM) * 3.0 - 1.5);
  const ab = Math.abs(band);
  const gl = ab < (HI ? 0.08 : 0.12) ? 0.14 : ab < (HI ? 0.18 : 0.24) ? 0.06 : 0;
  // Горло спереди — тёмное сизое (отлив вспыхивает на нём только бликом),
  // зелёный сверху по бокам, фиолетовый ниже: так у сизаря, а не шарф.
  if (au < 0.24 - 0.08 * v) {
    PICK_T = -0.08 + gl;
    return gl > 0.1 ? P_GREEN : P_FUR;
  }
  // Верхняя кромка тает в сизое перо головы шахматкой.
  if (v > 0.78 && ((PX + PY) & 1) === 0) {
    PICK_T = -0.04;
    return P_FUR;
  }
  const pal = v > 0.42 + 0.06 * Math.sin(s * 2 + 1) - 0.15 * (au - 0.5) ? P_GREEN : P_VIOLET;
  PICK_T = gl;
  if (HI) {
    // Чешуйки шейного пера: ряды полукружий.
    const rv = v * 7 + 7;
    const row = Math.floor(rv);
    const cu = u * 6 + (row & 1) * 0.5;
    const fu = frac(cu) - 0.5;
    if (frac(rv) < 0.22 - fu * fu * 0.6) PICK_T -= 0.07;
  }
  return pal;
}

/** Шея: ворот спереди и с боков, сзади — сизое перо. */
function neckPick(qx: number, qy: number, qz: number): number {
  PICK_T = 0;
  if (qy < -0.4) return P_FUR;
  return irid(qx, qz * 0.6 + 0.5);
}

/**
 * Тело: ремень сумки наискось (от правого плеча по кадру к левому бедру),
 * ворот чешуйками спускается на грудь, светлая грудь овалом, сизые бока.
 */
function bodyPick(qx: number, qy: number, qz: number): number {
  PICK_T = 0;
  if (qy > -0.05) {
    const d = segDist(qx, qz, 0.5, 0.88, -0.92, -0.14);
    const w = HI ? 0.058 : 0.072;
    if (d < w) {
      PICK_T = d > w * 0.62 ? -0.1 : 0.02;
      if (HI && d < w * 0.3) {
        const al = (qx - 0.5) * -0.71 + (qz - 0.88) * -0.7;
        if (frac(al * 22) < 0.35) PICK_T -= 0.1;
      }
      return P_LEATHER;
    }
  }
  // Нижняя кромка ворота — кончиками перьев вниз.
  const n = HI ? 6.5 : 3.5;
  const fu = frac(qx * n + 0.5) - 0.5;
  const edge = 0.44 + 0.16 * qx * qx - 0.09 * (1 - 4 * fu * fu);
  if (qz > edge && qy > -0.45) return irid(qx * 0.95, (qz - edge) * 0.6);
  if (qy > 0.02) {
    const cx = Math.floor((qx + 1) * 7);
    const cz = Math.floor((qz + 1) * 6);
    const jag = (hash(cx, cz, 5) - 0.5) * 0.18;
    const e = (qx / 0.66) ** 2 + ((qz + 0.04) / 0.92) ** 2 + jag;
    if (e < 1) {
      PICK_T = qz < -0.35 ? 0.03 : 0;
      if (HI) {
        // Перья груди: редкие дужки, к брюху мельче.
        const rv = (0.6 - qz) * 6;
        const row = Math.floor(rv);
        const cu = (Math.atan2(qx, qy) / Math.PI) * 7 + (row & 1) * 0.5;
        const col = Math.floor(cu);
        const fv = frac(rv);
        const ee = (frac(cu) - 0.5) ** 2 * 4;
        if (hash(col, row, 11) < 0.5 && ee < 0.8 && fv > 0.74 - ee * 0.4 && fv < 0.92 - ee * 0.4)
          PICK_T -= 0.06;
      }
      return P_BREAST;
    }
  }
  if (HI && hash(Math.floor((qx + 1) * 9), Math.floor((qz + 1) * 7), 9) < 0.22) PICK_T = -0.05;
  return P_FUR;
}

function body(out: PartF[], c: Ctx): void {
  const { o, S } = c;
  const k = S.k;
  const sq = o.sq;
  const fl = o.fluff;
  const ax = axes(rollY([1, 0, 0], o.lean), pitchX([0, 0, 1], o.bow * 0.5));
  const rb: V3 = [
    (9.3 + fl) * (1 + sq * 0.5) * k,
    (8.7 + fl * 0.8) * (1 + sq * 0.4) * k,
    (10.8 + fl * 0.5) * (1 - sq) * k,
  ];
  BODY_ID = nid();
  out.push({ c: S.body, ax, r: rb, pal: P_FUR, id: BODY_ID, pick: bodyPick });
  // Шея с воротом — та же деталь для швов (шва между шеей и грудью нет);
  // зоб раздувается вперёд при воркованьи.
  const pf = 1 + 0.2 * o.puff;
  out.push({
    c: add(S.neck, mul([0, 0.9 * o.puff, -0.2 * o.puff], k)),
    ax,
    r: [(5.6 + fl * 0.4) * pf * k, (5.4 + fl * 0.4) * pf * k, 4.2 * (1 + 0.1 * o.puff) * k],
    pal: P_GREEN,
    id: BODY_ID,
    pick: neckPick,
  });
}

/** Голова: сизое перо, на крупной — мелкая чешуя; щёки под глазом светлее. */
function headPick(qx: number, qy: number, qz: number): number {
  PICK_T = 0;
  if (qy > 0.2 && qz < -0.05 && Math.abs(qx) > 0.25 && Math.abs(qx) < 0.62) PICK_T = 0.04;
  if (HI) {
    const rv = (1 - qz) * 6;
    const row = Math.floor(rv);
    const cu = (Math.atan2(qx, qy) / Math.PI) * 9 + (row & 1) * 0.5;
    const fv = frac(rv);
    const ee = (frac(cu) - 0.5) ** 2 * 4;
    if (hash(Math.floor(cu), row, 4) < 0.45 && fv > 0.78 - ee * 0.4 && fv < 0.94 - ee * 0.4)
      PICK_T -= 0.05;
  }
  return P_FUR;
}

function head(out: PartF[], c: Ctx): void {
  const { o, h } = c;
  const k = h.k;
  const ex = h.dir([1, 0, 0]);
  const ez = h.dir([0, 0, 1]);
  const fl = o.fluff * 0.25;
  HEAD_ID = nid();
  out.push({
    c: h.at([0, 0, 0]),
    ax: axes(ex, ez),
    r: [(HRX + fl) * k, (HRY + fl) * k, (HRZ + fl * 0.5) * k],
    pal: P_FUR,
    id: HEAD_ID,
    pick: headPick,
    bias: -0.02,
  });
}

/** Кромка шлема (доля полуоси по высоте): спереди над глазами, к затылку ниже. */
const capEdge = (qx: number, qy: number) =>
  qy > 0 ? 0.3 + 0.1 * qx * qx : 0.3 + 0.5 * qy + 0.1 * qx * qx;
/** Полуоси шлема (на голове с запасом). */
const CRX = HRX + 0.55;
const CRY = HRY + 0.55;
const CRZ = HRZ + 0.5;

/** Кожаный лётный шлем: купол, ремешок очков, на крупной — шов и строчка кромки. */
function capPick(qx: number, qy: number, qz: number): number {
  PICK_T = 0;
  const e = capEdge(qx, qy);
  const sb = 0.62 - 0.06 * qy;
  if (Math.abs(qz - sb) < (HI ? 0.06 : 0.07)) {
    PICK_T = -0.16;
    return P_LEATHER;
  }
  if (qz - e < (HI ? 0.09 : 0.11)) PICK_T = 0.08;
  if (HI) {
    if (Math.abs(qx) < 0.035 && qz > sb + 0.08) PICK_T = -0.1;
    if (qz - e > 0.11 && qz - e < 0.15 && frac(Math.atan2(qx, qy) * 6) < 0.4) PICK_T -= 0.1;
  }
  return P_LEATHER;
}

/** Шлем, уши шлема, очки — всё на рамке шлема (сдвигается на глаза во сне). */
let GOG_AT: V3[] = [];
function cap(out: PartF[], c: Ctx): void {
  const { o, h, lag, S } = c;
  const cf = capF(o, h);
  const k = cf.k;
  const ex = cf.dir([1, 0, 0]);
  const ey = cf.dir([0, 1, 0]);
  const ez = cf.dir([0, 0, 1]);
  out.push({
    c: cf.at([0, -0.25, 0.55]),
    ax: axes(ex, ez),
    r: [CRX * k, CRY * k, CRZ * k],
    pal: P_LEATHER,
    id: nid(),
    pick: capPick,
    cut: (qx, qy, qz) => qz < capEdge(qx, qy),
  });
  // Уши шлема: висят по бокам головы, качаются с запаздыванием.
  const sw = (lag.headX - S.head[0]) * 0.18 + (lag.turn - o.turn) * 0.6 + (lag.tilt - o.tilt) * 0.8;
  const dz = (lag.headZ - S.head[2]) * 0.1;
  for (const side of [-1, 1]) {
    const top = cf.at([side * (HRX + 0.05), -0.4, 0.3 * HRZ]);
    const d = norm(
      add(cf.dir(norm([side * (0.12 + Math.max(0, -dz) * 0.4), 0.05, -1])), [
        sw,
        0,
        Math.max(0, dz),
      ]),
    );
    const L = 4.4 * k;
    out.push({
      c: add(top, mul(d, L * 0.55)),
      ax: axes(d, mul(ex, side)),
      r: [L * 0.62, 2.7 * k, 0.95 * k],
      pal: P_LEATHER,
      id: nid(),
      bias: -0.04,
      tex: (qx, qy) =>
        Math.abs(qy) > 0.78 || qx > 0.82 ? 0.08 : HI && Math.abs(qy) > 0.62 ? -0.06 : 0,
    });
  }
  // Очки на лбу шлема: латунная оправа, тёмное стекло с бликом (светлое
  // стекло читалось бы второй парой глаз).
  GOG_AT = [];
  const rr = HI ? 1.6 : 1.45;
  for (const side of [-1, 1]) {
    const qx = side * 0.36;
    const qz = 0.62;
    const qy = Math.sqrt(1 - qx * qx - qz * qz);
    const pl: V3 = [qx * CRX, -0.25 + qy * CRY, 0.55 + qz * CRZ];
    const nl = cf.dir(norm([qx / CRX, qy / CRY, qz / CRZ]));
    const pc = cf.at(pl);
    out.push({
      c: add(pc, mul(nl, 0.35 * k)),
      ax: axes(ex, nl),
      r: [rr * k, rr * k, 0.7 * k],
      pal: P_BRASS,
      id: nid(),
      bias: 0.02,
      noSeam: true,
    });
    const gc = add(pc, mul(nl, 0.8 * k));
    GOG_AT.push(gc);
    out.push({
      c: gc,
      ax: axes(ex, nl),
      r: [(rr - 0.48) * k, (rr - 0.48) * k, 0.4 * k],
      pal: P_GLASS,
      id: nid(),
      bias: 0.06,
      noSeam: true,
      tex: (qx2, _qy, qz2) => (qx2 < -0.2 && qz2 > 0.2 ? 0.25 : 0),
    });
  }
  // Перемычка очков.
  out.push({
    c: add(cf.at([0, -0.25 + 0.86 * CRY, 0.55 + 0.5 * CRZ]), mul(ey, 0.2 * k)),
    ax: axes(ex, ez),
    r: [0.9 * k, 0.5 * k, 0.45 * k],
    pal: P_BRASS,
    id: nid(),
    noSeam: true,
  });
}

/** Клюв: тонкий тёмный, остриём вперёд-вниз; у основания белая восковица. */
function beak(out: PartF[], c: Ctx): void {
  const { o, h } = c;
  const k = h.k;
  const ey = h.dir([0, 1, 0]);
  const ez = h.dir([0, 0, 1]);
  const op = o.beak;
  const y0 = HRY * 0.84;
  const hinge: V3 = [0, y0, -1.6];
  const ridge = (u: number, qy: number, qz: number) =>
    (qz > 0.4 && Math.abs(qy) < 0.4 ? 0.16 : qz < -0.3 ? -0.06 : 0) + (u > 0.82 ? -0.06 : 0);
  const upr = (p: V3): V3 => pitchX(p, -op * 0.42, hinge);
  feather(
    out,
    h.at(upr([0, y0 - 0.1, -0.9])),
    h.at(upr([0, y0 + 1.3, -1.5])),
    h.at(upr([0, y0 + 1.9, -3.0])),
    [1.35, 1.2, 0.98, 0.72, 0.46, 0.26].map((w) => w * k),
    [0.9, 0.85, 0.74, 0.58, 0.42, 0.28].map((w) => w * k),
    ez,
    P_BEAK,
    { utex: ridge, segs: HI ? 5 : 3, bias: 0.04, over: 1.1 },
  );
  // Восковица: белая шишечка на надклювье у лба.
  out.push({
    c: h.at(upr([0, y0 + 0.3, -0.45])),
    ax: axes(ey, ez),
    r: [0.8 * k, 1.25 * k, 0.62 * k],
    pal: P_CERE,
    id: nid(),
    bias: 0.04,
    noSeam: true,
  });
  if (op > 0.1) {
    const rot = (p: V3): V3 => pitchX(p, op * 0.9, hinge);
    feather(
      out,
      h.at(rot([0, y0, -1.6])),
      h.at(rot([0, y0 + 1.3, -2.0])),
      h.at(rot([0, y0 + 2.0, -2.6])),
      [0.95, 0.8, 0.6, 0.35].map((w) => w * k),
      0.5 * k,
      ez,
      P_BEAK,
      { bias: -0.08, segs: HI ? 4 : 3 },
    );
    out.push({
      c: h.at([0, y0 + 0.8, -1.7 - op * 0.6]),
      ax: axes(ey, ez),
      r: [1.6 * k, 1.0 * k, (0.35 + 0.8 * op) * k],
      pal: P_MOUTH,
      id: nid(),
      bias: 0.05,
      noSeam: true,
    });
  }
}

/** Направление во фронтальной плоскости: угол от «вниз», наружу на сторону `side`. */
const dirFront = (th: number, side: number, fwd = 0): V3 =>
  norm([side * Math.sin(th), fwd, -Math.cos(th)]);

const SEC_W = [1.4, 2.0, 2.2, 2.2, 2.1, 1.6, 0.9];
const PRIM_W = [1.1, 1.7, 1.9, 1.95, 1.9, 1.7, 1.2, 0.55];
const TAIL_W = [1.0, 1.5, 1.8, 1.9, 1.8, 1.2];
const LA = 8.0;
/** Длина сложенного крыла (лопасти) от плеча. */
const WING_L = 14.0;

/** Кисти крыльев-рук (трюк): цели хвата, считаются до крыльев. */
let HANDS: [V3, V3] = [
  [0, 0, 0],
  [0, 0, 0],
];

interface Arm {
  sh: V3;
  A: V3;
  AL: V3;
  N0: V3;
  D: V3;
  DL: V3;
  open: number;
  LL: number;
}

function armOf(c: Ctx, side: -1 | 1): Arm {
  const { o, S, lag } = c;
  const k = S.k;
  const th = side < 0 ? o.thL : o.thR;
  const thLag = side < 0 ? lag.thL : lag.thR;
  const hd = side < 0 ? o.holdL : o.holdR;
  // Крыло-рука: плечо выходит вперёд, лопасть тянется кистью к точке хвата.
  const sh = add(side < 0 ? S.shL : S.shR, mul([side * 0.8, 3.2, -1.0], hd * k));
  const arm = (a: number): V3 => norm(add(rollY(dirFront(a, side), o.lean), [0, 0.2, 0]));
  let A = arm(th);
  let AL = arm(thLag);
  let LL = WING_L * k;
  if (hd > 0.001) {
    const d = sub(HANDS[side < 0 ? 0 : 1], sh);
    const Ah = norm(d);
    A = norm(lerp3(A, Ah, hd));
    AL = norm(lerp3(AL, Ah, hd));
    LL = lerp(LL, Math.hypot(d[0], d[1], d[2]) / 0.9, hd);
  }
  const open = clamp01((th - 0.35) / 0.9) * (1 - hd);
  // Сложенное крыло прижато к боку (плоскость смотрит вбок), раскрытое — в
  // плоскости кадра, рука — наружу-вперёд-вверх.
  const N0r = norm([side * lerp(1.0, 0.55, open), 1, 0.1]);
  const N0 = norm(lerp3(N0r, norm([side * 0.4, 0.8, 0.5]), hd));
  const D = norm(mul(cross(A, N0), -side));
  const DL = norm(mul(cross(AL, N0), -side));
  return { sh, A, AL, N0, D, DL, open, LL };
}

/** Лопасть крыла: кроющие рядами, две тёмные полосы поперёк, грифельные маховые на конце. */
function lobePick(side: number) {
  return (qx: number, qy: number, qz: number): number => {
    PICK_T = 0;
    const u = (qx + 1) / 2;
    if (qz < -0.55) PICK_T -= 0.06;
    const us = u + 0.05 * qy * side;
    if (us > 0.82) {
      const s = (qy + 1) * 0.5 * (HI ? 5 : 3);
      if (Math.abs(s - Math.round(s)) < (HI ? 0.09 : 0.12)) PICK_T -= 0.12;
      PICK_T += 0.12;
      return P_DARK;
    }
    if ((us > 0.5 && us < 0.575) || (us > 0.645 && us < 0.72)) {
      PICK_T = 0.06;
      return P_DARK;
    }
    if (u < 0.5) {
      const nr = HI ? 4 : 2;
      const nc = HI ? 3 : 2;
      const v = (u / 0.5) * nr;
      const row = Math.floor(v);
      const fv = v - row;
      const w = (qy + 1) * 0.5 * nc + (row & 1) * 0.5;
      const fw = w - Math.floor(w) - 0.5;
      if (fv > 0.8 - fw * fw * 1.2) PICK_T -= 0.09;
      else if (fv < 0.3) PICK_T += 0.03;
      return P_WING;
    }
    const s = (qy + 1) * 0.5 * (HI ? 5 : 3);
    if (Math.abs(s - Math.round(s)) < (HI ? 0.09 : 0.12)) PICK_T -= 0.1;
    return P_WING;
  };
}

/** Перо раскрытого крыла: две тёмные полосы у второстепенных, грифельные концы маховых. */
const secPick = (u: number, qy: number): number => {
  PICK_T = qy < -0.45 ? -0.12 : qy > 0.55 && u > 0.15 ? 0.06 : 0;
  if ((u > 0.42 && u < 0.52) || (u > 0.6 && u < 0.7)) return P_DARK;
  return P_WING;
};
const primPick = (u: number, qy: number): number => {
  PICK_T = (qy < -0.45 ? -0.12 : qy > 0.55 && u > 0.15 ? 0.06 : 0) + (u > 0.94 ? -0.06 : 0);
  return u > 0.45 ? P_DARK : P_WING;
};

function wing(out: PartF[], c: Ctx, side: -1 | 1): void {
  const { o, S } = c;
  const k = S.k;
  const fan = side < 0 ? o.fanL : o.fanR;
  const hd = side < 0 ? o.holdL : o.holdR;
  const { sh, A, AL, N0, D, DL, open, LL } = armOf(c, side);
  const fdir = (phi: number, lagged = false): V3 =>
    norm(add(mul(lagged ? DL : D, Math.cos(phi)), mul(lagged ? AL : A, Math.sin(phi))));
  const onArm = (u: number, depth: number): V3 =>
    add(add(sh, mul(A, u * LA * k)), mul(N0, depth * k));
  const wk = HI ? 1 : 1.2;
  const back = (d: number): V3 => mul(VIEW, -d);
  const fold = 1 - open;
  const rest = (down: number, lat: number, depth: number): V3 =>
    add(add(add(sh, mul(A, down * k)), mul(D, lat * k)), mul(N0, depth * k));
  const lax = axes(A, N0);
  const L = lerp(LL, LL * 0.78, open);
  const wid = lerp(lerp(4.5, 3.9, open), 3.0, hd) * k * wk;
  out.push({
    c: add(add(sh, mul(A, L * 0.42)), mul(N0, (1.3 - 0.7 * hd) * k)),
    ax: lax,
    r: [L * 0.5, wid, 2.0 * k],
    pal: P_WING,
    id: nid(),
    bias: 0.02,
    pick: lobePick(side),
  });
  if (open < 0.04) return;
  // Второстепенные (с двумя тёмными полосами).
  const nS = HI ? 5 : 3;
  for (let j = 0; j < nS; j++) {
    const q = j / (nS - 1);
    const phi = lerp(1.55 + 0.02 * q, (0.04 + 0.26 * q) * fan, open);
    const rootO = add(
      add(onArm(0.2 + q * 0.55, -0.9 - q * 0.2), mul(D, 1.3 * k)),
      back(2.4 + j * 1.6),
    );
    const rootR = add(rest(4.4, 3.0 - q * 2.2, -0.2 - q * 0.15), back(0.6 + j * 0.25));
    const root = lerp3(rootR, rootO, open);
    const Lf = lerp(10.6 + q * 0.6, 7.6 + q * 1.0, open) * k;
    const mid = add(root, mul(fdir(phi), Lf * 0.55));
    const tip = add(mid, mul(fdir(phi * 1.03, true), Lf * 0.48));
    feather(
      out,
      root,
      mid,
      tip,
      SEC_W.map((w) => w * k * wk),
      0.8 * k,
      N0,
      P_WING,
      { upick: secPick, bias: (j % 2 ? -0.02 : 0.01) - 0.05 * fold, segs: 7, over: 1.1 },
    );
  }
  // Маховые: внешняя кромка, длиннее к краю, грифельные концы.
  const nP = HI ? 5 : 3;
  for (let j = 0; j < nP; j++) {
    const q = j / (nP - 1);
    const phi = lerp(1.48 - 0.12 * q, (0.45 + q * 0.85) * fan, open);
    const rootO = add(
      add(onArm(0.72 + q * 0.3, -2.2 - q * 0.3), mul(D, 0.5 * k)),
      back(3.4 + (nS + j) * 1.6),
    );
    const rootR = add(rest(5.0, 0.6 - q * 2.6, -0.6 - q * 0.2), back(1.8 + j * 0.25));
    const root = lerp3(rootR, rootO, open);
    const Lf = lerp(12.8 - q * 2.4 + (j % 2) * 0.5, 10.0 + q * 3.4, open) * k;
    const d = fdir(phi);
    const mid = add(root, mul(d, Lf * 0.55));
    const tip = add(mid, mul(fdir(phi + 0.05, true), Lf * 0.5));
    feather(
      out,
      root,
      mid,
      tip,
      PRIM_W.map((w) => w * k * wk),
      0.8 * k,
      N0,
      P_WING,
      {
        upick: primPick,
        bias: 0.06 + (j % 2 ? -0.03 : 0.02) - 0.05 * fold,
        segs: 8,
        over: 1.1,
      },
    );
  }
}

function tail(out: PartF[], c: Ctx): void {
  const { o, S } = c;
  const k = S.k;
  // Хвост веером назад-вниз; тёмная кромка на конце.
  const n = HI ? 6 : 4;
  const fan = 1 + o.tailFan * 0.7;
  const ax = norm([0, -0.6, -0.8]);
  const nrm: V3 = [0, 1, -0.3];
  const sp: V3 = [1, 0, 0];
  for (let j = 0; j < n; j++) {
    const u = (j / (n - 1)) * 2 - 1;
    const au = Math.abs(u);
    const len = 9.0 * k * (1 - 0.18 * au);
    const dir = norm(add(ax, mul(sp, u * 0.32 * fan)));
    const base = add(S.rump, mul(sp, u * 1.8 * k));
    const tip = add(base, mul(dir, len));
    feather(
      out,
      base,
      lerp3(base, tip, 0.5),
      tip,
      TAIL_W.map((w) => w * k * (HI ? 1 : 1.2)),
      0.6 * k,
      nrm,
      P_WING,
      {
        upick: (uu, qy) => {
          PICK_T = qy < -0.45 ? -0.1 : 0;
          return uu > 0.76 ? P_DARK : P_WING;
        },
        bias: (j % 2 ? -0.05 : 0.0) - 0.04 * au,
        segs: 5,
        over: 1.1,
      },
    );
  }
}

function legs(out: PartF[], c: Ctx): void {
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
      r: [Math.hypot(d[0], d[1], d[2]) * 0.5 + 0.4, 0.9 * k, 0.9 * k],
      pal: P_LEG,
      id,
      tex: HI ? (qx) => (Math.floor((qx + 1) * 3.5) & 1 ? -0.08 : 0.03) : undefined,
    });
    // Пальцы: три вперёд, один назад; когти тёмные.
    for (const a of [-0.62, 0, 0.62]) {
      const dir = norm([Math.sin(a) + side * 0.12, Math.cos(a), -0.12]);
      out.push({
        c: add(foot, mul(dir, 1.45 * k)),
        ax: axes(dir, [0, 0, 1]),
        r: [1.55 * k, 0.6 * k, 0.55 * k],
        pal: P_LEG,
        id,
        bias: 0.04,
      });
      out.push({
        c: add(add(foot, mul(dir, 2.9 * k)), [0, 0, -0.25 * k]),
        ax: axes(norm(add(dir, [0, 0, -0.9])), [0, 1, 0]),
        r: [0.7 * k, 0.4 * k, 0.4 * k],
        pal: P_BEAK,
        id: nid(),
        bias: -0.06,
        noSeam: true,
      });
    }
    const bd = norm([side * 0.35, -1, -0.1]);
    out.push({
      c: add(foot, mul(bd, 1.1 * k)),
      ax: axes(bd, [0, 0, 1]),
      r: [1.1 * k, 0.55 * k, 0.5 * k],
      pal: P_LEG,
      id,
      bias: -0.06,
    });
  }
}

/** Записка на лапке: где висит свёрток (у правой по кадру лапки, снаружи-спереди). */
function legNote(S: Skel): V3 {
  return add(lerp3(S.hipR, S.footR, 0.5), mul([1.15, 1.0, 0.35], S.k));
}

/** Свёрток: бумажная трубочка с красной ниткой посередине. */
function rollPart(out: PartF[], c: V3, axis: V3, len: number, rad: number, vis = 1): void {
  const k = 1;
  out.push({
    c,
    ax: axes(axis, VIEW),
    r: [len * k, rad * k, rad * k],
    pal: P_PAPER,
    id: nid(),
    bias: 0.06,
    noSeam: true,
    vis,
    pick: (qx, qy, qz) => {
      PICK_T = 0;
      if (Math.abs(qx) < 0.2) return P_STRING;
      if (Math.abs(qx) > 0.86) PICK_T = -0.12;
      // Виток бумаги наискось (на крупной).
      if (HI && Math.abs(frac(qx * 1.2 + Math.atan2(qz, qy) / TAU) - 0.5) < 0.05) PICK_T -= 0.08;
      return P_PAPER;
    },
  });
}

const NOTE_LEN = 1.9;
const NOTE_RAD = 0.95;

/** Записка привязана: свёрток вдоль лапки и петля нитки вокруг обоих. */
function tiedNote(out: PartF[], c: Ctx): void {
  const { S } = c;
  const k = S.k;
  const nc = legNote(S);
  const axis = norm(sub(S.hipR, S.footR));
  rollPart(out, nc, axis, NOTE_LEN * k, NOTE_RAD * k);
  const mid = lerp3(lerp3(S.hipR, S.footR, 0.5), nc, 0.5);
  out.push({
    c: add(mid, [0, 0.2 * k, 0]),
    ax: axes([1, 0, 0], axis),
    r: [2.0 * k, 1.35 * k, 0.32 * k],
    pal: P_STRING,
    id: nid(),
    bias: 0.04,
    noSeam: true,
  });
}

/** Сумка на левом бедре (по кадру): кожаный короб, открыт сверху, ремешок с пряжкой. */
let BAG_C: V3 = [0, 0, 0];
let BAG_AX: [V3, V3, V3] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
/** Полуразмеры сумки: ширина, толщина, высота. */
const BAG_R: V3 = [3.5, 1.5, 2.8];
function satchelGeo(c: Ctx): void {
  const { S, lag } = c;
  const sw = (lag.bodyX - S.body[0]) * 0.35;
  const bz = (lag.bodyZ - S.body[2]) * 0.3;
  BAG_C = add(S.up([-9.2, 5.4, 8.4]), [sw, 0, bz]);
  BAG_AX = axes(norm([1, 0.38, -sw * 0.06]), [0, 0, 1]);
}

function satchel(f: Frame, c: Ctx): void {
  const k = c.S.k;
  const [e1, e2, e3] = BAG_AX;
  const W = BAG_R[0] * k;
  const D = BAG_R[1] * k;
  const H = BAG_R[2] * k;
  const at = (x: number, y: number, z: number): V3 =>
    add(add(add(BAG_C, mul(e1, x)), mul(e2, y)), mul(e3, z));
  const id = nid();
  // Скругление нижних углов (доли стороны).
  const corner = (u: number, v: number, r: number) => {
    const cu = Math.min(u, 1 - u);
    return v < r && cu < r && Math.hypot(r - cu, r - v) > r;
  };
  const rc = HI ? 0.16 : 0.2;
  // Бок к телу (виден краешком).
  quadF(f, at(W, D, -H), mul(e2, -2 * D), mul(e3, 2 * H), P_LEATHER, id, (_u, v) =>
    v > 0.94 ? -0.2 : -0.1,
  );
  // Устье сверху: тёмная внутренность.
  quadF(f, at(-W, -D, H), mul(e1, 2 * W), mul(e2, 2 * D), P_LEATHER, id, (u) =>
    u < 0.04 || u > 0.96 ? -0.05 : -0.42,
  );
  // Лицо сумки: ремешок с пряжкой посередине, строчка по краю (на крупной), кант устья.
  quadF(
    f,
    at(-W, D, -H),
    mul(e1, 2 * W),
    mul(e3, 2 * H),
    P_LEATHER,
    id,
    (u, v) => {
      if (corner(u, v, rc)) return -9;
      let s = 0.04 + 0.08 * v;
      if (v > 0.9) s += 0.1;
      if (Math.abs(u - 0.5) < (HI ? 0.06 : 0.09) && v < 0.9) s -= 0.16;
      const bu = Math.abs(u - 0.5) < (HI ? 0.11 : 0.13) && Math.abs(v - 0.52) < (HI ? 0.1 : 0.14);
      if (bu) return 100 + s;
      if (HI) {
        const m = Math.min(u, 1 - u, v * 0.8, (1 - v) * 1.6);
        if (m > 0.06 && m < 0.09 && frac((u + v) * 11) < 0.5) s += 0.12;
      }
      return s;
    },
    P_BRASS,
  );
  // Письмо стоит у задней стенки и торчит из устья, чуть наискось; сургуч.
  const lu = rollY(e1, -0.18);
  const lv = rollY(e3, -0.18);
  quadF(
    f,
    at(-0.45 * W, 0.15 * D, H - 1.4 * k),
    mul(lu, 1.1 * W),
    mul(lv, 4.4 * k),
    P_PAPER,
    nid(),
    (u, v) => {
      let s = 0.12 + 0.04 * v;
      if (Math.hypot((u - 0.62) * 2.0, (v - 0.78) * 1.4) < (HI ? 0.26 : 0.34)) return 100;
      if (HI && Math.abs(v - (0.95 - Math.abs(u - 0.5) * 0.7)) < 0.05) s -= 0.12;
      if (u < 0.06 || u > 0.94) s -= 0.06;
      return s;
    },
    P_STRING,
  );
}

/** Голова в перо плеча (сон): пушистый вал на левом плече перед клювом. */
function tuckFluff(out: PartF[], c: Ctx): void {
  const { o, S } = c;
  if (o.tuck <= 0.01) return;
  const k = S.k;
  const p = S.up([-5.6, 4.6, 22.8]);
  out.push({
    c: p,
    ax: axes([1, 0, -0.35], [0, 0.4, 1]),
    r: [5.2 * k * o.tuck, 3.6 * k, 3.4 * k],
    pal: P_WING,
    id: nid(),
    bias: 0.0,
    pick: (qx, qy, qz) => {
      PICK_T = 0;
      const rv = (1 - qz) * 2.5;
      const cu = qx * 3 + (Math.floor(rv) & 1) * 0.5;
      const fu = frac(cu) - 0.5;
      if (frac(rv) > 0.78 - fu * fu * 1.2) PICK_T -= 0.09;
      return qz < -0.2 && qy > 0.3 ? P_GREEN : P_WING;
    },
  });
}

// ---------------------------------------------------------------------------
// Записка в трюке: полёт с лапки, свёрток и лист в крыльях, путь клевера.
// ---------------------------------------------------------------------------

/** Где крылья ловят свёрток (перед грудью, под клювом) и наклон листа к глазам. */
const CATCH: V3 = [0, 10.4, 15.4];
const TILT = 0.3;
const PAPER_UP: V3 = [0, -Math.sin(TILT), Math.cos(TILT)];
/** Лицо листа к зрителю (оборот; читаемая сторона смотрит на голубя). */
const PAPER_N: V3 = [0, Math.cos(TILT), Math.sin(TILT)];

interface NoteG {
  /** Свёрток: середина, ось, радиус; виден ли (в полёте или в крыльях). */
  roll: V3;
  axis: V3;
  rad: number;
  show: boolean;
  /** Лист: левый край и свёрток по x от точки хвата; середина хвата. */
  xl: number;
  xr: number;
  C: V3;
  sheet: boolean;
}
let NOTE: NoteG = {
  roll: [0, 0, 0],
  axis: [0, 0, 1],
  rad: 1,
  show: false,
  xl: 0,
  xr: 0,
  C: [0, 0, 0],
  sheet: false,
};
let POP_S: Skel | null = null;

function noteGeo(c: Ctx): void {
  const { o, S } = c;
  const k = S.k;
  const C = S.up(CATCH);
  const u = o.spread;
  const xl = -0.7 - 3.4 * u;
  const xr = 0.7 + 5.4 * u;
  const chestRoll = add(C, [xr * k, 0, 0]);
  const legAxis = norm(sub(S.hipR, S.footR));
  const te = o.tie;
  const roll = lerp3(chestRoll, legNote(S), te);
  const axis = norm(lerp3(PAPER_UP, legAxis, te));
  HANDS = [add(C, mul([xl - 0.5, 0.9, -0.1], k)), add(roll, mul([1.0, 0.9, 0.2], k))];
  NOTE = {
    roll,
    axis,
    rad: NOTE_RAD * (1 - 0.3 * u),
    show: o.holdR > 0.5 && o.tied < 0.5 && o.fly < 0,
    xl,
    xr,
    C,
    sheet: u > 0.02 && o.tied < 0.5 && o.fly < 0,
  };
  if (o.fly >= 0) {
    // Полёт: дугой с лапки (где была в миг щелчка) в руки, кувырок в плоскости кадра.
    POP_S ??= skel(workPose(T_POP));
    const P0 = legNote(POP_S);
    const P1 = add(S.up(CATCH), [0.7 * k, 0, 0]);
    const ctl = add(lerp3(P0, P1, 0.5), [-1.0, 1.0, 15.0]);
    const f = o.fly;
    const a = f * TAU;
    const ax0 = norm(lerp3(norm(sub(POP_S.hipR, POP_S.footR)), PAPER_UP, f));
    const axr: V3 = [
      ax0[0] * Math.cos(a) + ax0[2] * Math.sin(a),
      ax0[1],
      -ax0[0] * Math.sin(a) + ax0[2] * Math.cos(a),
    ];
    NOTE = { ...NOTE, roll: bezQ(P0, ctl, P1, f), axis: axr, rad: NOTE_RAD, show: true };
  }
}

function noteParts(out: PartF[], c: Ctx): void {
  const k = c.S.k;
  if (!NOTE.show) return;
  rollPart(out, NOTE.roll, NOTE.axis, NOTE_LEN * k, NOTE.rad * k);
}

/** Лист между левой рукой (край) и свёртком: оборот к нам, сквозь бумагу — строчки. */
function sheetQuad(f: Frame, c: Ctx): void {
  if (!NOTE.sheet) return;
  const k = c.S.k;
  const { C, xl, xr } = NOTE;
  const o0 = add(add(C, [xl * k, 0, 0]), mul(PAPER_UP, -NOTE_LEN * k * 0.98));
  const eu: V3 = [(xr - xl) * k, 0, 0];
  const ev = mul(PAPER_UP, 2 * NOTE_LEN * k * 0.98);
  quadF(f, o0, eu, ev, P_PAPER, nid(), (u, v) => {
    let s = 0.1 - 0.06 * v;
    if (u < 0.05) s -= 0.06;
    if (HI && v > 0.2 && v < 0.84 && u > 0.12 && u < 0.88) {
      const row = (v - 0.2) / 0.16;
      if (frac(row) < 0.3 && hash(Math.floor(u * 9), Math.floor(row), 3) < 0.8) s -= 0.07;
    }
    return s;
  });
}

/** Клевер: из-за верхнего края листа вверх, дугой влево мимо щеки, вниз в сумку. */
function cloverAt(c: Ctx, s: number): { p: V3; spin: number; roll: number; sz: number } {
  const { S } = c;
  const k = S.k;
  const C = NOTE.C;
  const mid = (NOTE.xl + NOTE.xr) * 0.5;
  const P0 = add(add(C, [mid * k, 0, 0]), add(mul(PAPER_N, -0.9 * k), mul(PAPER_UP, 0.4 * k)));
  const P1 = add(
    add(C, [(mid - 0.6) * k, 0, 0]),
    add(mul(PAPER_UP, (NOTE_LEN + 2.6) * k), mul(PAPER_N, 0.8 * k)),
  );
  const P2 = S.up([-12.6, 9.0, 31.0]);
  const P3 = add(BAG_C, [0, -0.2 * k, (BAG_R[2] + 2.0) * k]);
  const P4 = add(BAG_C, [0, -0.3 * k, 0.4 * k]);
  let p: V3;
  if (s < 0.2) p = lerp3(P0, P1, 1 - (1 - s / 0.2) ** 2);
  else if (s < 0.62) p = bezQ(P1, S.up([-8.5, 12.5, 31.5]), P2, (s - 0.2) / 0.42);
  else if (s < 0.88) {
    const u = (s - 0.62) / 0.26;
    p = bezQ(P2, [P3[0] - 1.5, P3[1], P2[2] + 1.5], P3, u * u);
  } else p = lerp3(P3, P4, (s - 0.88) / 0.12);
  return {
    p,
    spin: s * Math.PI * 2,
    roll: -s * Math.PI * 1.2,
    sz: s < 0.14 ? 0.5 + 0.5 * (s / 0.14) : 1,
  };
}

// ---------------------------------------------------------------------------
// Поверх кадра: глаза, клевер, «!», щелчок нитки, блики, клевок, сон.
// ---------------------------------------------------------------------------

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

const scr = (q: V3): [number, number] => {
  const [sx, sy] = project(mul(q, RR));
  return [OX + sx, OY + sy];
};

/** Глаз: оранжевая радужка, зрачок, блик, тёмный ободок; веко сверху. */
function eyes(p: Px, f: Frame, c: Ctx): void {
  const { o, h } = c;
  const ir = IRIS_V[V];
  const ink = INK_V[V];
  const lid = PAL[P_FUR][6];
  const lidD = PAL[P_FUR][4];
  const qy = Math.sqrt(1 - EYE_X * EYE_X - EYE_Z * EYE_Z);
  for (const side of [-1, 1] as const) {
    const ep = h.at([side * EYE_X * HRX, qy * HRY, EYE_Z * HRZ]);
    const at = seen(f, mul(ep, RR), OX, OY, 2.0 * RR);
    if (!at) continue;
    const [cx, cy] = scr(ep);
    const facing = clamp01(dot(norm(h.dir([side * 0.35, 1, 0])), VIEW) / 0.94);
    const sxk = Math.max(0.5, facing ** 0.7);
    let R = HI ? 3.0 : 1.5;
    if (o.eye === 'wide') R *= 1.15;
    const blink = side < 0 ? o.blinkL : o.blinkR;
    const n = Math.ceil(R + 2);
    const X0 = Math.floor(cx);
    const Y0 = Math.floor(cy);
    for (let dy = -n; dy <= n; dy++)
      for (let dx = -n; dx <= n; dx++) {
        const X = X0 + dx;
        const Y = Y0 + dy;
        if (X < 0 || Y < 0 || X >= f.w || Y >= f.h) continue;
        if (f.idb[Y * f.w + X] !== HEAD_ID) continue;
        const px = (X + 0.5 - cx) / sxk;
        const py = Y + 0.5 - cy;
        const d = Math.hypot(px, py);
        if (o.eye === 'happy') {
          if (Math.abs(d - R * 0.8) < (HI ? 0.75 : 0.62) && py < (HI ? -0.2 : 0.3))
            p.set(X, Y, ink);
          continue;
        }
        if (o.eye === 'sleep') {
          if (Math.abs(d - R * 0.8) < (HI ? 0.75 : 0.62) && py > (HI ? 0.3 : -0.3))
            p.set(X, Y, ink);
          continue;
        }
        const ring = HI ? 1.0 : 0.6;
        if (d > R + ring) continue;
        let lidY = -R - 1 + (2 * R + 1) * blink;
        if (o.eye === 'angry') lidY = Math.max(lidY, -R * 0.25 - side * px * 0.6);
        if (py < lidY) {
          p.set(X, Y, py > lidY - (HI ? 1.0 : 0.8) ? lidD : lid);
          continue;
        }
        if (py < lidY + (HI ? 1.0 : 0.8) && lidY > -R) {
          p.set(X, Y, ink);
          continue;
        }
        if (d > R) {
          p.set(X, Y, ink);
          continue;
        }
        // Зрачок (бегает по строчкам при чтении), радужка светлее книзу, блик.
        const pr = R * (o.eye === 'wide' ? 0.36 : 0.48);
        const ppx = px - o.lookX * R * 0.45;
        const ppy = py - o.lookY * R * 0.4;
        if (Math.hypot(ppx, ppy) < pr) {
          p.set(X, Y, ink);
        } else {
          const vv = py / R;
          const tone = vv < -0.5 ? 2 : vv < 0.0 ? 3 : 4;
          p.set(X, Y, ir[HI && d > R - 0.9 ? tone - 1 : tone]);
        }
        const gx = -0.4 * R;
        const gy = -0.42 * R;
        if (
          HI
            ? Math.abs(px - gx) < 0.9 && Math.abs(py - gy) < 0.9
            : px > gx - 0.7 && px < gx + 0.5 && py > gy - 0.7 && py < gy + 0.5
        )
          p.set(X, Y, WHITE);
      }
  }
}

/** Клевер-четырёхлистник: листья-сердечки крестом, черенок; вертится. Глубина — по кадру. */
function clover(p: Px, f: Frame, c: Ctx): void {
  const { o } = c;
  if (o.clover < 0 || o.clover > 1) return;
  const { p: q, spin, roll, sz } = cloverAt(c, o.clover);
  const [cx, cy] = scr(q);
  const dep = project(mul(q, RR))[2];
  const s = (HI ? 3.0 : 1.25) * sz;
  // Поворот вокруг стебля — лёгкий: ребром клевер превращался в огурец.
  const sxk = 0.68 + 0.32 * Math.abs(Math.cos(spin));
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  const leaf = (x: number, y: number): number => {
    // −1 — мимо, иначе 2·номер листа (+1 — жилка).
    for (let j = 0; j < 4; j++) {
      const a = Math.PI / 4 + (j * Math.PI) / 2;
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      const along = x * ux + y * uy;
      const across = -x * uy + y * ux;
      // Сердечко: две доли у кончика, клин к середине.
      const r = 0.82 * s;
      const c1 = Math.hypot(along - 1.45 * s, across - 0.5 * s);
      const c2 = Math.hypot(along - 1.45 * s, across + 0.5 * s);
      const wedge =
        along > 0.15 * s && along < 1.5 * s && Math.abs(across) < (along / (1.5 * s)) * 1.05 * s;
      if (c1 < r || c2 < r || wedge)
        return j * 2 + (HI && Math.abs(across) < 0.35 && along > 0.9 * s ? 1 : 0);
    }
    return -1;
  };
  const stem = (x: number, y: number) =>
    x > -0.2 * s && x < 2.2 * s && Math.abs(y - x * 0.9) < (HI ? 0.55 : 0.5) && y > 0;
  const n = Math.ceil(3.2 * s) + 2;
  const X0 = Math.round(cx);
  const Y0 = Math.round(cy);
  const tol = 0.8 * RR;
  const inside = (X: number, Y: number) => {
    const lx = (X + 0.5 - cx) / sxk;
    const ly = Y + 0.5 - cy;
    const x = lx * cr + ly * sr;
    const y = -lx * sr + ly * cr;
    const l = leaf(x, y);
    return l >= 0 ? l : stem(lx, ly) ? 8 : -1;
  };
  const G = CLOVER;
  for (let dy = -n; dy <= n; dy++)
    for (let dx = -n; dx <= n; dx++) {
      const X = X0 + dx;
      const Y = Y0 + dy;
      if (X < 0 || Y < 0 || X >= p.w || Y >= p.h) continue;
      const i = Y * f.w + X;
      if (f.pal[i] >= 0 && f.zb[i] > dep + tol) continue;
      const kind = inside(X, Y);
      if (kind >= 0) {
        const lx = X + 0.5 - cx;
        const ly = Y + 0.5 - cy;
        // Шов между листьями — тёмный крест: без него четыре листа сливались в шар.
        let seam = false;
        if (kind < 8)
          for (const [ax, ay] of [
            [1, 0],
            [0, 1],
          ]) {
            const nb = inside(X + ax, Y + ay);
            if (nb >= 0 && nb < 8 && nb >> 1 !== kind >> 1) seam = true;
          }
        let tone =
          kind === 8
            ? 3
            : seam
              ? 2
              : kind & 1
                ? 4
                : lx + ly < -0.5 * s
                  ? 7
                  : lx + ly < 1.2 * s
                    ? 6
                    : 5;
        if (sxk < 0.75 && tone > 4) tone -= 1;
        p.set(X, Y, G[tone]);
      } else if (
        inside(X - 1, Y) >= 0 ||
        inside(X + 1, Y) >= 0 ||
        inside(X, Y - 1) >= 0 ||
        inside(X, Y + 1) >= 0
      )
        p.set(X, Y, G[1]);
    }
  // Искры вокруг клевера, пока он летит.
  if (o.clover > 0.08 && o.clover < 0.8) {
    for (let j = 0; j < 3; j++) {
      const a = o.clover * 9 + j * 2.1;
      const rr = (HI ? 9 : 4.2) + (HI ? 2 : 1) * Math.sin(o.clover * 20 + j);
      const x = Math.round(cx + Math.cos(a) * rr);
      const y = Math.round(cy + Math.sin(a) * rr);
      const tw = Math.sin(o.clover * 26 + j * 1.7);
      if (tw < -0.2) continue;
      star(p, x, y, HI ? (tw > 0.5 ? 2 : 1) : tw > 0.6 ? 1 : 0, WHITE, G[7]);
    }
  }
}

/** Вспышка у сумки, когда клевер упал внутрь; блик на стекле очков. */
function glints(p: Px, c: Ctx): void {
  const { o, a, t } = c;
  if (o.glint < 0.3) return;
  if (a === 'work' && t > 1.4) {
    const [x, y] = scr(add(BAG_C, [0.5, 0, (BAG_R[2] + 1.6) * c.S.k]));
    star(
      p,
      Math.round(x),
      Math.round(y),
      HI ? Math.round(1 + 3 * o.glint) : o.glint > 0.6 ? 2 : 1,
      WHITE,
      CLOVER[7],
    );
    return;
  }
  if (a === 'work') return;
  const g = GOG_AT[0];
  if (!g) return;
  const [x, y] = scr(g);
  const L = HI ? Math.round(1 + 2 * o.glint) : o.glint > 0.6 ? 1 : 0;
  star(
    p,
    Math.round(x - (HI ? 1.5 : 0.5)),
    Math.round(y - (HI ? 1.5 : 0.5)),
    L,
    WHITE,
    PAL[P_GLASS][8],
  );
}

/** «!» над головой справа — только по пустому фону, с тёмной обводкой. */
const BANG_S = ['x', 'x', 'x', '.', 'x'];
const BANG_L = ['xxx', 'xxx', 'xxx', 'xxx', 'xxx', '.x.', '...', 'xxx', 'xxx'];
function bang(p: Px, mask: Uint8Array, c: Ctx): void {
  const { o, h } = c;
  // Шахматкой «!» гас грязными точками контура — исчезает целиком.
  if (o.bang < 0.4) return;
  const [hxp, hyp] = scr(h.at([HRX * 0.95, 0, HRZ * 1.05]));
  const rows = HI ? BANG_L : BANG_S;
  const x0 = Math.round(hxp + (HI ? 4 : 2));
  const y0 = Math.round(hyp - rows.length - (HI ? 3 : 1) - (1 - o.bang) * (HI ? 4 : 2));
  const ink = INK_V[V];
  const on = (x: number, y: number) =>
    y >= 0 && y < rows.length && x >= 0 && x < rows[0].length && rows[y][x] === 'x';
  for (let y = -1; y <= rows.length; y++)
    for (let x = -1; x <= rows[0].length; x++) {
      const X = x0 + x;
      const Y = y0 + y;
      if (X < 0 || Y < 0 || X >= p.w || Y >= p.h || mask[Y * p.w + X]) continue;
      if (on(x, y)) p.set(X, Y, BANG);
      else if (on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1)) p.set(X, Y, ink);
    }
}

/** Щелчок: нитка развязалась у лапки — короткие лучи от узла. */
function popFx(p: Px, c: Ctx): void {
  const { o } = c;
  if (o.pop < 0) return;
  POP_S ??= skel(workPose(T_POP));
  const [x, y] = scr(legNote(POP_S));
  const r0 = (HI ? 3 : 1.5) + o.pop * (HI ? 5 : 2.5);
  const L = HI ? 3 : 1.5;
  for (let j = 0; j < 6; j++) {
    const a = (j / 6) * TAU + 0.3;
    for (let d = 0; d <= L; d += 0.5) {
      const X = Math.round(x + Math.cos(a) * (r0 + d) - 0.5);
      const Y = Math.round(y + Math.sin(a) * (r0 + d) - 0.5);
      if (!dith(X, Y, 1.2 - o.pop)) continue;
      p.set(X, Y, j % 2 ? STRING[5] : WHITE);
    }
  }
}

/** Клевок: лучи от клюва — только по пустому фону. */
function strikeFx(p: Px, mask: Uint8Array, c: Ctx): void {
  const { o, h } = c;
  const u = o.strike;
  if (u < 0) return;
  const [mx, my] = scr(h.at([0, HRY + 2.0, -1.8]));
  const col = hx('#fff4dc');
  const dim = hx('#f0c070');
  const vis = u < 0.6 ? 1.1 : (1 - u) / 0.4;
  const r0 = (HI ? 12 : 5) + u * (HI ? 12 : 5);
  const L = HI ? 7 : 3.5;
  for (const a of [-2.6, -2.0, -1.1, -0.5, 0.2, 2.9, 2.2]) {
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    for (let d = 0; d <= L; d += 0.5) {
      const X = Math.round(mx + ca * (r0 + d) - 0.5);
      const Y = Math.round(my + sa * (r0 + d) - 0.5);
      if (X < 0 || Y < 0 || X >= p.w || Y >= p.h || mask[Y * p.w + X]) continue;
      if (!dith(X, Y, vis)) continue;
      p.set(X, Y, d < L * 0.5 ? col : dim);
    }
  }
}

/** Сон: буквы «z» поднимаются над головой и тают. */
const Z_S = ['zzz', '.z.', 'zzz'];
const Z_L = ['zzzz', '..z.', '.z..', 'zzzz'];
const Z_L2 = ['zzzzz', '...z.', '..z..', '.z...', 'zzzzz'];
function zzz(p: Px, mask: Uint8Array, c: Ctx): void {
  const { S, t } = c;
  for (let j = 0; j < 2; j++) {
    const u = wrap(t / 1.5 + j * 0.5, 1);
    const [sx, sy] = project(mul(add(S.head, [4 + 3.5 * u, 0, 7 + 9 * u]), RR));
    const x0 = Math.round(OX + sx);
    const y0 = Math.round(OY + sy);
    const rows = HI ? (u > 0.45 ? Z_L2 : Z_L) : Z_S;
    for (let y = 0; y < rows.length; y++)
      for (let x = 0; x < rows[y].length; x++) {
        if (rows[y][x] !== 'z') continue;
        const X = x0 + x;
        const Y = y0 + y;
        if (X < 0 || Y < 0 || X >= p.w || Y >= p.h || mask[Y * p.w + X]) continue;
        if (!dith(X, Y, Math.min(1, 1.8 * (1 - u)) * Math.min(1, u * 5))) continue;
        p.set(X, Y, ZZ);
      }
  }
}

function softBands(f: Frame): void {
  const { w, h, pal, tone, idb } = f;
  const hit: number[] = [];
  for (let y = 0; y < h - 1; y++)
    for (let x = 0; x < w - 1; x++) {
      const i = y * w + x;
      const pl = pal[i];
      if (pl !== P_FUR && pl !== P_WING && pl !== P_BREAST) continue;
      for (const j of [i + w, i + 1]) {
        if (pal[j] === pl && idb[j] === idb[i] && tone[j] === tone[i] - 1 && dith(x, y, 0.28))
          hit.push(j, tone[i]);
      }
    }
  for (let n = 0; n < hit.length; n += 2) f.tone[hit[n]] = hit[n + 1];
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
    headX: lagged((tt) => sk(tt).head[0], 3.0, 0.24, (L0?.headX ?? 0) - S0.head[0], 2.5),
    headZ: lagged((tt) => sk(tt).head[2], 3.0, 0.24, (L0?.headZ ?? 0) - S0.head[2], 2.5),
    turn: lagged((tt) => P(tt).turn, 3.4, 0.22, (L0?.turn ?? 0) - P0.turn, 0.5),
    tilt: lagged((tt) => P(tt).tilt, 3.0, 0.24, (L0?.tilt ?? 0) - P0.tilt, 0.4),
    thL: lagged((tt) => P(tt).thL, 4.0, 0.36, (L0?.thL ?? 0) - P0.thL),
    thR: lagged((tt) => P(tt).thR, 4.0, 0.36, (L0?.thR ?? 0) - P0.thR),
    bodyX: lagged((tt) => sk(tt).body[0], 2.6, 0.2, (L0?.bodyX ?? 0) - S0.body[0], 2.0),
    bodyZ: lagged((tt) => sk(tt).body[2], 2.6, 0.2, (L0?.bodyZ ?? 0) - S0.body[2], 2.0),
  };
  LAGS.set(key, r);
  return r;
}

function toRes(parts: PartF[]): PartF[] {
  if (RR === 1) return parts;
  return parts.map((pt) => ({ ...pt, c: mul(pt.c, RR), r: mul(pt.r, RR) }));
}

/** Кадр `i` анимации `a` полосы `res`, вариант окраса `v` (0 — обычный, 1 — золотой). */
export function pigeonFrame(a: Anim, i: number, res: Res = 's', v = 0): Px {
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
  const c: Ctx = { o, S, h: headF(o, S), lag, t, a };
  SHIM = o.shim;
  noteGeo(c);
  const parts: PartF[] = [];
  tail(parts, c);
  legs(parts, c);
  if (o.tied > 0.5) tiedNote(parts, c);
  body(parts, c);
  head(parts, c);
  cap(parts, c);
  beak(parts, c);
  satchelGeo(c);
  tuckFluff(parts, c);
  wing(parts, c, -1);
  wing(parts, c, 1);
  noteParts(parts, c);
  const f = newFrame(cv.cw, cv.ch);
  drawPartsF(f, toRes(parts), PAL, OX, OY);
  satchel(f, c);
  sheetQuad(f, c);
  seams(f, 1.2 * RR, 1);
  rimLight(f, PAL, (pl) => pl !== P_MOUTH && pl !== P_GLASS && pl !== P_STRING);
  if (HI) softBands(f);
  const p = toPx(f, PAL);
  selOutline(p, INK_V[V], 0.8);
  const mask = new Uint8Array(p.w * p.h);
  for (let j = 0; j < mask.length; j++) mask[j] = p.data[j * 4 + 3] > 0 ? 1 : 0;
  eyes(p, f, c);
  popFx(p, c);
  clover(p, f, c);
  glints(p, c);
  bang(p, mask, c);
  strikeFx(p, mask, c);
  if (a === 'sleep') zzz(p, mask, c);
  return p;
}
