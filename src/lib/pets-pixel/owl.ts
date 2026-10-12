// Сова-фонарщица — пиксельный питомец по эталону боссов 12–14.
//
// Круглый филин смотрит на нас: большая голова сидит прямо на теле, длинные
// ушные пучки, светлый лицевой диск в два кольца с тёмной каймой и светлой
// «галочкой» бровей над клювом, два ОГРОМНЫХ оранжевых глаза, маленький
// крючковатый клюв, кремовая грудь с редкими тёмными «галочками», крылья в
// пятнах и полосах, пушистые оперённые лапы с тёмными когтями. На лбу на
// ремешке — латунный шахтёрский фонарь.
//
// Две полосы, у каждой свой рисунок: малая — рамка 48 (шахта, списки),
// крупная — рамка 112 (карточка, вылупление, Питомник): радиальные пёрышки
// диска, пестрины темени, ряды кроющих с пятнами, полосы маховых, пух лап.
//
// Анимации 24 к/с по ключам (`kf`). Голова у совы поворачивается сама, тело
// стоит; пучки и крылья — с запаздыванием (`spring`). Трюк — фонарь:
// щёлкнула фонарём, луч метёт пол, в луче блеснул спрятанный кристалл,
// сова подскакивает к нему и поднимает в лапе; реквизит тает, всё на местах
// покоя. Ходьба — вразвалку с подскоком, крылья чуть раскрыты для равновесия.
//
// Золотой рисуется здесь же (`v` = 1): перо — золото, глубина — бронза,
// диск — бледное золото; глаза, клюв, когти и фонарь читаются. Радужного нет.

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
const P_CREAM = 2;
const P_RIM = 3;
const P_BEAK = 4;
const P_BRASS = 5;
const P_STRAP = 6;
const P_GLASS = 7;
const P_LIT = 8;
const P_MOUTH = 9;

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
// У золотой совы корпус фонаря медный: латунь на золоте пропадала.
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
const STRAP = ramp('#1a0f07', '#2c1a0d', '#3e2614', '#52331c', '#674226', '#7d5432', '#94683f');
const GLASS = ramp('#24221a', '#3a382c', '#56523f', '#767056', '#98916f', '#bdb58f', '#e4ddba');
const LIT = ramp('#7a5a10', '#a8801c', '#d4aa30', '#f0cc50', '#fbe27e', '#fff0b0', '#fffbe4');
const MOUTH = ramp('#1a0610', '#3a0c1c', '#5e1a2c', '#84303e', '#a84a52', '#c8706e');
const GEM = ramp(
  '#0b2638',
  '#14405c',
  '#1f5f84',
  '#2c7fa6',
  '#46a2c8',
  '#6fc3e8',
  '#a6e0f6',
  '#dcf6ff',
);

const PAL_V: RGBA[][][] = [
  [
    // Перо головы и спины: тёплое бурое.
    ramp(
      '#1e1108',
      '#2e1a0b',
      '#432611',
      '#5a3417',
      '#72441d',
      '#8a5525',
      '#a1672f',
      '#b67b3c',
      '#c9914f',
      '#dba866',
    ),
    // Крыло: бурое темнее и краснее.
    ramp(
      '#170e07',
      '#241609',
      '#341f0e',
      '#452a14',
      '#56361b',
      '#694322',
      '#7c522b',
      '#916436',
      '#a87a46',
    ),
    // Диск, грудь, лапы: кремовые.
    ramp(
      '#4e3a26',
      '#6e5539',
      '#8e7450',
      '#ad936a',
      '#c7ae84',
      '#dcc79e',
      '#ebdbb8',
      '#f5ead2',
      '#fdf7ea',
    ),
    // Кайма диска: бурая до чёрного.
    ramp('#140c06', '#24160c', '#352214', '#48301c', '#5c3f26', '#704f30'),
    // Клюв и когти: тёмный рог.
    ramp('#120e0c', '#211b18', '#322a25', '#463b33', '#5c4f45', '#776a5e', '#968a7c'),
    BRASS,
    STRAP,
    GLASS,
    LIT,
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
      '#24140a',
      '#3a220c',
      '#553210',
      '#704516',
      '#8c5a1c',
      '#a87224',
      '#c38c30',
      '#daa842',
      '#ecc45e',
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
    ramp('#1a0e04', '#2c1806', '#40240a', '#56320e', '#6c4214', '#82541c'),
    ramp('#140e08', '#241a10', '#36281a', '#4a3a26', '#604e34', '#7a6646', '#968260'),
    COPPER,
    STRAP,
    GLASS,
    LIT,
    MOUTH,
  ],
];
const INK_V: RGBA[] = [hx('#120a05'), hx('#1e1004')];
const IRIS_V: RGBA[][] = [
  ramp('#5a1e04', '#9a3a08', '#d4600e', '#f08a24', '#ffb048', '#ffd890'),
  ramp('#5a1404', '#9a2a08', '#d44a0e', '#f0701e', '#ff9a40', '#ffc880'),
];
const WHITE = hx('#fffbe8');
const BEAM = hx('#fff3b8');
const ZZ = hx('#e8e0cc');

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
  /** Голова: сдвиг, поворот (+ вправо), кивок (+ вниз), наклон набок. */
  hx: number;
  hz: number;
  turn: number;
  nod: number;
  tilt: number;
  /** Клюв: 0 — закрыт, 1 — раскрыт; пучки: 1 — торчком, −1 — прижаты. */
  beak: number;
  ear: number;
  /** Крылья: угол руки от «вниз» наружу, веер маховых (левое/правое по кадру). */
  thL: number;
  thR: number;
  fanL: number;
  fanR: number;
  tailFan: number;
  /** Лапы: сдвиг вбок, вперёд, подъём (по кадру левая и правая); когти растопырены. */
  fLx: number;
  fLy: number;
  fLz: number;
  fRx: number;
  fRy: number;
  fRz: number;
  grip: number;
  eye: Eye;
  blinkL: number;
  blinkR: number;
  /** Перо распушено (сон, угроза). */
  fluff: number;
  scale: number;
  /** Фонарь: горит (0…1), щелчок (0…1), луч виден (0…1) и куда светит по полу. */
  lamp: number;
  click: number;
  beam: number;
  beamX: number;
  /** Кристалл: проявился на полу (0…1), в лапе (0…1), блеск. */
  gem: number;
  held: number;
  glint: number;
  /** Удар когтями: лучи (−1 — нет, иначе доля). */
  strike: number;
}

const REST_TH = -0.1;
const REST_FAN = 0.4;
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
  ear: 0,
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
  grip: 0,
  eye: 'open',
  blinkL: 0,
  blinkR: 0,
  fluff: 0,
  scale: 1,
  lamp: 0,
  click: 0,
  beam: 0,
  beamX: 0,
  gem: 0,
  held: 0,
  glint: 0,
  strike: -1,
};

const loopK = (t: number, T: number, keys: Key[]) => kf(wrap(t, T), keys);
const TAU = Math.PI * 2;

/** Кристалл в трюке: где лежит на полу и куда сова подскакивает. */
const GEM_X = 12.5;
const GEM_Y = 3.4;
const HOP_X = 8.4;

// ---------------------------------------------------------------------------
// Дорожки анимаций.
// ---------------------------------------------------------------------------

function idlePose(t: number): Pose {
  const T = dur('idle');
  const o: Pose = { ...REST };
  // Дыхание: вдох быстрее выдоха, второй глубже; перо приподнимается.
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
  o.fluff = 0.25 * br;
  // Голова поворачивается сама, тело стоит: рывок вправо, задержка, к нам,
  // рывок влево, задержка, к нам.
  o.turn = loopK(t, T, [
    [0, 0],
    [0.25, 0],
    [0.4, 0.48, 'o'],
    [0.48, 0.45],
    [1.02, 0.44],
    [1.18, -0.03, 'o'],
    [1.26, 0],
    [1.62, 0],
    [1.77, -0.44, 'o'],
    [2.25, -0.41],
    [2.42, 0, 'o'],
    [T, 0],
  ]);
  // Склонила голову набок «с интересом», глядя вправо; и чуть — влево.
  o.tilt = loopK(t, T, [
    [0, 0],
    [0.5, 0],
    [0.66, 0.24, 'o'],
    [0.96, 0.22],
    [1.14, 0],
    [1.82, 0],
    [1.96, -0.12, 'o'],
    [2.22, -0.11],
    [2.4, 0],
    [T, 0],
  ]);
  o.nod = loopK(t, T, [
    [0, 0],
    [0.4, -0.05],
    [1.2, 0],
    [1.77, 0.06],
    [2.4, 0],
    [T, 0],
  ]);
  o.hx = 0.9 * o.tilt;
  // Моргает по очереди: сначала один глаз, потом другой.
  o.blinkL = Math.max(bump(t, 1.3, 1.46), bump(t, 2.62, 2.76));
  o.blinkR = Math.max(bump(t, 1.4, 1.56), bump(t, 2.7, 2.84));
  // Пучки дрогнули на рывках головы; встряхнулась перед вторым вдохом.
  o.ear = 0.2 * bump(t, 0.3, 0.7) - 0.35 * bump(t, 1.95, 2.2);
  const shk = kf(t, [
    [1.9, 0],
    [2.0, 1, 'o'],
    [2.15, 0.6],
    [2.32, 0, 'i'],
  ]);
  o.fluff += 0.5 * shk;
  o.thL = o.thR = REST_TH + 0.06 * shk;
  o.lean = 0.02 * shk * Math.sin((t - 1.9) * TAU * 6);
  // Блик на латуни фонаря — своя фаза.
  o.glint = bump(t, 0.7, 0.98);
  return o;
}

function walkPose(t: number): Pose {
  const T = dur('walk');
  const o: Pose = { ...REST };
  const h = wrap(t, T);
  o.fz = 0;
  // Вразвалку с подскоком: 0–0,5 — левая лапа в воздухе, 0,5–1 — правая.
  const sway = loopK(h, T, [
    [0, 0],
    [0.2, 1, 'o'],
    [0.3, 0.95],
    [0.5, 0],
    [0.7, -1, 'o'],
    [0.8, -0.95],
    [1.0, 0],
  ]);
  o.x = -0.8 * sway;
  o.lean = -0.1 * sway;
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
  o.z = 1.6 * hop;
  o.sq = -0.05 * hop;
  const liftL = bump(h, 0.04, 0.46);
  const liftR = bump(h, 0.54, 0.96);
  o.fLz = 2.4 * liftL ** 0.8;
  o.fRz = 2.4 * liftR ** 0.8;
  o.fLx = -0.6 * liftL;
  o.fRx = 0.6 * liftR;
  // Голова держит горизонт: наклон против крена тела.
  o.nod = 0.08 * hop;
  o.tilt = 0.12 * sway;
  o.hx = 0.4 * sway;
  // Крылья чуть раскрыты для равновесия — сильнее со стороны поднятой лапы.
  o.thL = REST_TH + 0.3 + 0.22 * Math.max(0, sway);
  o.thR = REST_TH + 0.3 + 0.22 * Math.max(0, -sway);
  o.fanL = o.fanR = REST_FAN + 0.15;
  o.ear = 0.25 * hop;
  return o;
}

function happyPose(t: number): Pose {
  const o: Pose = { ...REST };
  const T = dur('happy');
  // Присела → толчок → в воздухе крылья вполовину раскрыты → приземлилась.
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
    [0.44, 6.6, 'o'],
    [0.56, 6.9],
    [0.8, 0, 'i'],
    [T, 0],
  ]);
  o.thL = o.thR = kf(t, [
    [0, REST_TH],
    [0.16, 0.15, 'o'],
    [0.32, 1.1, 'o'],
    [0.44, 0.7, 'i'],
    [0.56, 1.05, 'o'],
    [0.7, 0.86],
    [0.84, 0.45, 'i'],
    [0.96, REST_TH, 'o'],
    [T, REST_TH],
  ]);
  o.fanL = o.fanR = kf(t, [
    [0, REST_FAN],
    [0.32, 1.1, 'o'],
    [0.8, 0.95],
    [0.98, REST_FAN],
  ]);
  o.nod = kf(t, [
    [0, 0],
    [0.16, 0.12, 'o'],
    [0.32, -0.16, 'o'],
    [0.7, -0.1],
    [0.84, 0.06],
    [1.0, 0],
  ]);
  o.tilt = kf(t, [
    [0.3, 0],
    [0.48, 0.16],
    [0.66, -0.12],
    [0.9, 0],
  ]);
  o.ear = kf(t, [
    [0, 0],
    [0.16, -0.3],
    [0.32, 1, 'o'],
    [0.8, 0.8],
    [1.0, 0],
  ]);
  o.fluff = kf(t, [
    [0.1, 0],
    [0.3, 0.5, 'o'],
    [0.8, 0.3],
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
    [0.4, 1.8, 'o'],
    [0.7, 1.3],
    [0.8, 0, 'i'],
  ]);
  o.eye = t > 0.1 && t < 0.98 ? 'happy' : 'open';
  // Ухнула: клюв приоткрыт.
  o.beak = bump(t, 0.3, 0.74) * 0.6;
  return o;
}

/** Трюк: когда сова поднимает кристалл (с). */
const T_GRAB = 1.36;

function workPose(t: number): Pose {
  const o: Pose = { ...REST };
  // 0–0,3 — вскинула голову и щёлкнула фонарём (вздрогнула, «клик» над ним).
  o.lamp = kf(t, [
    [0.24, 0],
    [0.26, 1, 'l'],
    [1.62, 1],
    [1.72, 0, 'l'],
  ]);
  o.click = t > 0.22 && t < 0.44 ? (t - 0.22) / 0.22 : 0;
  // 0,3–1 — луч метёт пол слева направо, голова ведёт его и смотрит вниз.
  o.beam = kf(t, [
    [0.3, 0],
    [0.42, 1, 'o'],
    [1.02, 1],
    [1.14, 0, 'i'],
  ]);
  o.beamX = kf(t, [
    [0.3, -18],
    [0.45, -17],
    [0.98, GEM_X],
  ]);
  // Луч погас — его точка возвращается к покою (иначе шов с покоем по полю позы).
  if (t > 1.14) o.beamX = REST.beamX;
  o.turn = kf(t, [
    [0, 0],
    [0.3, 0],
    [0.46, -0.42, 'o'],
    [0.98, 0.4],
    [1.08, 0.32],
    [1.3, 0.1],
    [1.45, 0],
  ]);
  o.nod = kf(t, [
    [0, 0],
    [0.14, -0.18, 'o'],
    [0.24, 0.04, 'i'],
    [0.32, 0],
    [0.44, 0.26, 'o'],
    [1.0, 0.3],
    [1.08, 0.12],
    [1.3, 0.14],
    [1.44, -0.12, 'o'],
    [1.62, -0.08],
    [1.8, 0.04],
    [1.94, 0],
  ]);
  // ~0,9 — в луче блеснул кристалл: глаза настежь, пучки торчком.
  o.gem = kf(t, [
    [0.82, 0],
    [0.96, 1, 'o'],
  ]);
  o.glint = Math.max(bump(t, 0.92, 1.14), bump(t, 1.44, 1.62));
  o.eye = t > 0.92 && t < 1.1 ? 'wide' : t > 1.42 && t < 1.64 ? 'happy' : 'open';
  o.ear = kf(t, [
    [0, 0],
    [0.14, 0.4, 'o'],
    [0.3, 0.1],
    [0.9, 0],
    [0.98, 1, 'o'],
    [1.2, 0.6],
    [1.5, 0.8],
    [1.74, 0.2],
    [1.92, 0],
  ]);
  // 1,06–1,3 — подскок к кристаллу; 1,66–1,84 — обратно на место.
  o.x = kf(t, [
    [1.06, 0],
    [1.3, HOP_X],
    [1.66, HOP_X],
    [1.84, 0],
  ]);
  o.z = kf(t, [
    [1.06, 0],
    [1.18, 4.4, 'o'],
    [1.3, 0, 'i'],
    [1.66, 0],
    [1.75, 3.2, 'o'],
    [1.84, 0, 'i'],
  ]);
  o.sq =
    kf(t, [
      [0.18, 0],
      [0.25, 0.07, 'o'],
      [0.34, 0],
    ]) +
    kf(t, [
      [0.98, 0],
      [1.06, 0.12, 'o'],
      [1.12, -0.06],
      [1.26, 0],
      [1.32, 0.1, 'o'],
      [1.42, 0],
      [1.6, 0.08, 'o'],
      [1.67, -0.05],
      [1.8, 0],
      [1.85, 0.06, 'o'],
      [1.93, 0],
    ]);
  o.thL = o.thR = kf(t, [
    [1.04, REST_TH],
    [1.16, 0.95, 'o'],
    [1.3, 0.2],
    [1.38, REST_TH, 'o'],
    [1.62, REST_TH],
    [1.73, 0.8, 'o'],
    [1.83, 0.1],
    [1.92, REST_TH, 'o'],
  ]);
  o.fanL = o.fanR = kf(t, [
    [1.04, REST_FAN],
    [1.16, 0.9, 'o'],
    [1.36, REST_FAN],
    [1.62, REST_FAN],
    [1.73, 0.8, 'o'],
    [1.92, REST_FAN],
  ]);
  // 1,36–1,66 — подняла кристалл в правой лапе (по кадру — правой), стоит на левой.
  o.fRz = kf(t, [
    [1.32, 0],
    [1.46, 11.0, 'o'],
    [1.58, 10.6],
    [1.66, 0, 'i'],
  ]);
  o.fRy = kf(t, [
    [1.32, 0],
    [1.46, 5.4, 'o'],
    [1.58, 5.2],
    [1.66, 0, 'i'],
  ]);
  o.fRx = kf(t, [
    [1.32, 0],
    [1.46, -2.6, 'o'],
    [1.58, -2.4],
    [1.66, 0, 'i'],
  ]);
  o.grip = kf(t, [
    [1.3, 0],
    [1.36, 1, 'o'],
    [1.44, 0.4],
    [1.6, 0.4],
    [1.68, 0],
  ]);
  o.lean = kf(t, [
    [1.34, 0],
    [1.46, -0.07, 'o'],
    [1.58, -0.06],
    [1.68, 0],
  ]);
  o.held =
    t >= T_GRAB
      ? kf(t, [
          [T_GRAB, 1],
          [1.54, 1],
          [1.64, 0, 'l'],
        ])
      : 0;
  if (t >= T_GRAB) o.gem = 0;
  o.beak = 0.35 * bump(t, 1.44, 1.6);
  return o;
}

function attackPose(t: number): Pose {
  // Замах: крылья вверх буквой V, перо дыбом → бросок к зрителю, когти вперёд,
  // клюв раскрыт (удар 0,38 с, 9-й кадр) → проводка → покой.
  const o: Pose = { ...REST };
  o.thL = o.thR = kf(t, [
    [0, REST_TH],
    [0.12, 1.3, 'o'],
    [0.3, 2.35, 'o'],
    [0.34, 2.4],
    [0.38, 1.55, 'i'],
    [0.5, 1.2, 'o'],
    [0.66, 0.8],
    [0.84, REST_TH],
  ]);
  o.fanL = o.fanR = kf(t, [
    [0, REST_FAN],
    [0.3, 1.25, 'o'],
    [0.42, 1.2],
    [0.6, 0.85],
    [0.84, REST_FAN],
  ]);
  o.bow = kf(t, [
    [0, 0],
    [0.28, -0.18, 'o'],
    [0.32, -0.2],
    [0.38, 0.28, 'i'],
    [0.5, 0.24, 'o'],
    [0.66, 0.08],
    [0.84, 0],
  ]);
  o.scale = kf(t, [
    [0.3, 1],
    [0.38, 1.18, 'i'],
    [0.52, 1.12],
    [0.78, 1, 'o'],
  ]);
  o.sq = kf(t, [
    [0, 0],
    [0.12, 0.12, 'o'],
    [0.3, -0.06],
    [0.38, 0.1, 'i'],
    [0.5, 0.03, 'o'],
    [0.7, 0],
  ]);
  o.z = kf(t, [
    [0.1, 0],
    [0.3, 1.6, 'o'],
    [0.38, 2.0],
    [0.5, 0.6],
    [0.62, 0, 'i'],
  ]);
  // В ударе голова поднята: клюв и глаза смотрят на зрителя, а не макушка.
  o.nod = kf(t, [
    [0, 0],
    [0.3, -0.22, 'o'],
    [0.38, -0.34, 'i'],
    [0.56, -0.2],
    [0.84, 0],
  ]);
  o.hz = kf(t, [
    [0, 0],
    [0.3, 0.7, 'o'],
    [0.38, -1.2, 'i'],
    [0.56, -0.6],
    [0.84, 0],
  ]);
  o.ear = kf(t, [
    [0, 0],
    [0.25, -0.6, 'o'],
    [0.5, -0.5],
    [0.84, 0],
  ]);
  o.fluff = kf(t, [
    [0, 0],
    [0.25, 0.9, 'o'],
    [0.5, 0.6],
    [0.84, 0],
  ]);
  o.eye = t > 0.05 && t < 0.76 ? 'angry' : 'open';
  o.beak = kf(t, [
    [0.14, 0],
    [0.3, 0.5, 'o'],
    [0.36, 0.4],
    [0.4, 1, 'o'],
    [0.54, 0.8],
    [0.68, 0],
  ]);
  // Когти вперёд, к зрителю, растопырены.
  const fy = kf(t, [
    [0.26, 0],
    [0.38, 11.5, 'o'],
    [0.52, 10.4],
    [0.7, 0, 'i'],
  ]);
  const fz = kf(t, [
    [0.26, 0],
    [0.38, 12.0, 'o'],
    [0.52, 10.4],
    [0.7, 0, 'i'],
  ]);
  o.fLy = o.fRy = fy;
  o.fLz = o.fRz = fz;
  o.fLx = -0.2 * fy;
  o.fRx = 0.2 * fy;
  o.grip = kf(t, [
    [0.26, 0],
    [0.36, 1, 'o'],
    [0.52, 1],
    [0.62, 0.2],
    [0.72, 0],
  ]);
  o.tailFan = kf(t, [
    [0.1, 0],
    [0.3, 0.7, 'o'],
    [0.5, 0.9],
    [0.84, 0],
  ]);
  o.strike = t >= 0.36 && t < 0.6 ? (t - 0.36) / 0.24 : -1;
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
  // Нахохлилась: перо пухом, голова утонула в плечах, пучки прижаты, фонарь погас.
  o.fluff = 1.2 + 0.25 * br;
  o.sq = 0.1 - 0.03 * br;
  o.hz = -3.0 + 0.3 * br;
  o.nod = 0.16 - 0.03 * br;
  o.tilt = 0.08;
  o.hx = 0.3;
  o.ear = -0.85 + 0.06 * br;
  o.thL = o.thR = REST_TH - 0.04 + 0.02 * br;
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

const BODY0: V3 = [0, 0, 12.4];
const HEAD0: V3 = [0, 0.6, 29.0];
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
    add([side * 3.6 * G + dx, 2.4 * G + dy, 0.5 * G + dz], [o.x * o.fz, 0, o.z * o.fz]);
  return {
    up,
    body: up(BODY0),
    head: up(add(HEAD0, [o.hx, 0, o.hz])),
    shL: up([-7.9, 1.6, 20.8]),
    shR: up([7.9, 1.6, 20.8]),
    rump: up([0, -4.2, 5.4]),
    hipL: up([-3.6, 1.4, 5.6]),
    hipR: up([3.6, 1.4, 5.6]),
    footL: foot(-1, o.fLx, o.fLy, o.fLz),
    footR: foot(1, o.fRx, o.fRy, o.fRz),
    k: s,
  };
}

/** Голова в своих единицах: полуоси, глаза (доли полуосей). */
const HRX = 10.0;
const HRY = 6.8;
const HRZ = 8.0;
const EYE_X = 0.42;
const EYE_Z = -0.04;
const DISC_R = 0.44;

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
  // На малой голова крупнее: глаза — главное в лице совы.
  const k = S.k * (HI ? 1.04 : 1.14);
  return { dir, k, at: (p) => add(S.head, mul(dir(p), k)) };
}

// ---------------------------------------------------------------------------
// Свой растр: части с выбором палитры по точке (диск на голове, грудь).
// ---------------------------------------------------------------------------

interface PartF extends Part {
  pick?: (qx: number, qy: number, qz: number) => number;
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
let HEAD_ID = -1;
let BODY_ID = -1;
let BODY_AX: [V3, V3, V3] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
let BODY_R: V3 = [1, 1, 1];

interface FOpt {
  id?: number;
  segs?: number;
  tex?: Part['tex'];
  /** Узор по доле длины всей детали; `qy`, `qz` — по сечению. */
  utex?: (u: number, qy: number, qz: number) => number;
  /** Палитра по доле длины (пятна на кроющих); тон — через `PICK_T`. */
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

/** Прядь — капля остриём к кончику: три эллипсоида убывают от основания. */
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

/** Направление во фронтальной плоскости: угол от «вниз», наружу на сторону `side`. */
const dirFront = (th: number, side: number, fwd = 0): V3 =>
  norm([side * Math.sin(th), fwd, -Math.cos(th)]);

// Перо крыла: маховые в широких полосах (кроющие с пятнами — на лопасти, `wing`).
const barU = (u: number, qy: number): number =>
  (qy < -0.45 ? -0.14 : qy > 0.55 && u > 0.15 ? 0.08 : 0) +
  (Math.floor(u * (HI ? 6 : 3.5) + 0.3) & 1 ? -0.1 : 0.03) +
  (u > 0.94 ? -0.05 : 0);
const SEC_W = [1.5, 2.1, 2.3, 2.3, 2.2, 1.7, 0.9];
const PRIM_W = [1.2, 1.8, 2.0, 2.05, 2.0, 1.8, 1.3, 0.6];
const TAIL_W = [1.0, 1.5, 1.8, 1.9, 1.8, 1.2];
const LA = 8.2;
/** Длина сложенного крыла (лопасти) от плеча. */
const WING_L = 13.0;

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

function armOf(c: Ctx, side: -1 | 1): Arm {
  const { o, S, lag } = c;
  const k = S.k;
  const th = side < 0 ? o.thL : o.thR;
  const thLag = side < 0 ? lag.thL : lag.thR;
  const sh = side < 0 ? S.shL : S.shR;
  const arm = (a: number): V3 => norm(add(rollY(dirFront(a, side), o.lean), [0, 0.2, 0]));
  const A = arm(th);
  const AL = arm(thLag);
  const open = clamp01((th - 0.35) / 0.9);
  // Сложенное крыло прижато к боку (плоскость смотрит вбок), раскрытое — в плоскости кадра.
  const N0 = norm([side * lerp(1.0, 0.55, open), 1, 0.1]);
  const D = norm(mul(cross(A, N0), -side));
  const DL = norm(mul(cross(AL, N0), -side));
  return { sh, A, AL, N0, D, DL, open, hand: add(sh, mul(A, LA * k)) };
}

function wing(out: PartF[], c: Ctx, side: -1 | 1): void {
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
  const fold = 1 - open;
  const rest = (down: number, lat: number, depth: number): V3 =>
    add(add(add(sh, mul(A, down * k)), mul(D, lat * k)), mul(N0, depth * k));
  // Сложенное крыло — лопасть вдоль бока: сверху кроющие рядами светлых
  // пятен, ниже маховые в широких полосах, пёрышки разделены тёмной чертой.
  // Раскрываясь, лопасть идёт за рукой, из-под неё веером выходят маховые.
  const lax = axes(A, N0);
  const LL = lerp(WING_L, WING_L * 0.78, open) * k;
  const rl: V3 = [LL * 0.5, lerp(4.6, 4.0, open) * k * wk, 2.0 * k];
  const lc = add(add(sh, mul(A, LL * 0.42)), mul(N0, 0.6 * k));
  const nr = HI ? 4 : 2;
  const nc = HI ? 3 : 2;
  out.push({
    c: lc,
    ax: lax,
    r: rl,
    pal: P_WING,
    id: nid(),
    bias: 0.02,
    pick: (qx, qy, qz) => {
      PICK_T = 0;
      const u = (qx + 1) / 2;
      // Кромка лопасти темнее по нижнему краю.
      if (qz < -0.55) PICK_T -= 0.06;
      if (u < 0.52) {
        const v = (u / 0.52) * nr;
        const row = Math.floor(v);
        const fv = v - row;
        const w = (qy + 1) * 0.5 * nc + (row & 1) * 0.5;
        const col = Math.floor(w);
        const fw = w - col - 0.5;
        if (fv > 0.82 - fw * fw * 1.2) PICK_T -= 0.1;
        else if (
          fw * fw + (fv - 0.45) ** 2 < (HI ? 0.06 : 0.09) &&
          hash(col, row, side + 7) < 0.85
        ) {
          PICK_T = -0.14;
          return P_CREAM;
        }
        return P_WING;
      }
      const s = (qy + 1) * 0.5 * (HI ? 5 : 3);
      if (Math.abs(s - Math.round(s)) < (HI ? 0.09 : 0.12) && u > 0.56) PICK_T -= 0.12;
      if (Math.floor((u - 0.52) * (HI ? 13 : 7)) & 1) PICK_T -= 0.09;
      else PICK_T += 0.03;
      if (u > 0.93) PICK_T -= 0.05;
      return P_WING;
    },
  });
  if (open < 0.04) return;
  // Второстепенные.
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
    const L = lerp(10.4 + q * 0.6, 7.6 + q * 1.0, open) * k;
    const mid = add(root, mul(fdir(phi), L * 0.55));
    const tip = add(mid, mul(fdir(phi * 1.03, true), L * 0.48));
    feather(
      out,
      root,
      mid,
      tip,
      SEC_W.map((w) => w * k * wk),
      0.8 * k,
      N0,
      P_WING,
      { utex: barU, bias: (j % 2 ? -0.02 : 0.01) - 0.05 * fold, segs: 7, over: 1.1 },
    );
  }
  // Маховые: внешняя кромка, длиннее к краю.
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
    const L = lerp(12.6 - q * 2.4 + (j % 2) * 0.5, 9.8 + q * 3.4, open) * k;
    const d = fdir(phi);
    const mid = add(root, mul(d, L * 0.55));
    const tip = add(mid, mul(fdir(phi + 0.05, true), L * 0.5));
    feather(
      out,
      root,
      mid,
      tip,
      PRIM_W.map((w) => w * k * wk),
      0.8 * k,
      N0,
      P_WING,
      { utex: barU, bias: -0.03 + (j % 2 ? -0.03 : 0.02) - 0.05 * fold, segs: 8, over: 1.1 },
    );
  }
}

function tail(out: PartF[], c: Ctx): void {
  const { o, S } = c;
  const k = S.k;
  // Короткий хвост: веер назад-вниз, из-за лап виден кончик.
  const n = HI ? 5 : 3;
  const fan = 1 + o.tailFan * 0.6;
  const ax = norm([0, -0.55, -0.83]);
  const nrm: V3 = [0, 1, -0.3];
  const sp: V3 = [1, 0, 0];
  for (let j = 0; j < n; j++) {
    const u = (j / (n - 1)) * 2 - 1;
    const au = Math.abs(u);
    const len = 7.6 * k * (1 - 0.25 * au);
    const dir = norm(add(ax, mul(sp, u * 0.3 * fan)));
    const base = add(S.rump, mul(sp, u * 1.6 * k));
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
      { utex: barU, bias: (j % 2 ? -0.04 : 0.02) - 0.02 * au, segs: 5, over: 1.1 },
    );
  }
}

function legs(out: PartF[], c: Ctx): void {
  const { o, S } = c;
  const k = S.k;
  const g = o.grip;
  for (const side of [-1, 1] as const) {
    const hip = side < 0 ? S.hipL : S.hipR;
    const foot = side < 0 ? S.footL : S.footR;
    const id = nid();
    // Оперённая лапа: пух от бедра до пальцев, кремовая, в мелкой ряби.
    const top = hip;
    const bot = add(foot, [0, 0, 1.1 * k]);
    const d = sub(bot, top);
    const len = Math.hypot(d[0], d[1], d[2]);
    out.push({
      c: mul(add(top, bot), 0.5),
      ax: axes(d, [0, 1, 0]),
      r: [len * 0.5 + 1.0 * k, (2.4 + o.fluff * 0.3) * k, (2.2 + o.fluff * 0.3) * k],
      pal: P_CREAM,
      id,
      bias: -0.06,
      tex: HI ? (qx, qy) => (Math.floor((qx + 1) * 4 + qy * 1.4) & 1 ? -0.05 : 0.02) : undefined,
    });
    // Пальцы в пуху: три вперёд; когти — тёмный рог, крючком вниз. В хватке
    // (удар, кристалл) пальцы граблями вниз-в-стороны, когти загнуты внутрь:
    // вытянутые к зрителю, они сжимались в серые чёрточки.
    for (const a0 of [-0.55, 0.05, 0.62]) {
      const a = a0 * side;
      const b = a0 * 1.2 * side;
      const dir = norm(
        lerp3([Math.sin(a), Math.cos(a), -0.1], [Math.sin(b) * 0.9, 0.45, -Math.cos(b)], g),
      );
      out.push({
        c: add(foot, mul(dir, 1.3 * k)),
        ax: axes(dir, [0, 0, 1]),
        r: [1.5 * k, 0.85 * k, 0.8 * k],
        pal: P_CREAM,
        id,
        bias: -0.02 - 0.16 * g,
      });
      const cd = norm(add(dir, [-Math.sin(b) * 0.8 * g, 0.5 * g, -0.9 + 0.3 * g]));
      out.push({
        c: add(add(foot, mul(dir, 2.7 * k)), mul(cd, (0.5 + 0.4 * g) * k)),
        ax: axes(cd, [0, 1, 0]),
        r: [(0.85 + 0.7 * g) * k, (0.45 + 0.15 * g) * k, (0.45 + 0.15 * g) * k],
        pal: P_BEAK,
        id: nid(),
        bias: -0.1 - 0.2 * g,
        noSeam: true,
      });
    }
  }
}

/** Грудь: кремовый овал спереди с рваной кромкой (по ячейкам перьев — не «кипит»). */
function bodyPick(qx: number, qy: number, qz: number): number {
  PICK_T = 0;
  if (qy < -0.1) return P_FUR;
  const cx = Math.floor((qx + 1) * 7);
  const cz = Math.floor((qz + 1) * 6);
  const jag = (hash(cx, cz, 5) - 0.5) * 0.22;
  const e = (qx / 0.64) ** 2 + ((qz + 0.06) / 0.96) ** 2 + jag;
  if (e < 1) {
    // Низ груди светлее, у горла — теплее; полоски брюха — только на крупной.
    PICK_T = qz < -0.3 ? 0.04 : 0;
    if (HI && qz < -0.2 && Math.floor((qz + 1) * 22 + qx * 2) % 3 === 0) PICK_T -= 0.06;
    return P_CREAM;
  }
  // Бок и спина: пестрины на крупной.
  if (HI && hash(Math.floor((qx + 1) * 9), Math.floor((qz + 1) * 7), 9) < 0.25) PICK_T = -0.07;
  return P_FUR;
}

function body(out: PartF[], c: Ctx): void {
  const { o, S } = c;
  const k = S.k;
  const sq = o.sq;
  const fl = o.fluff;
  const ax = axes(rollY([1, 0, 0], o.lean), pitchX([0, 0, 1], o.bow * 0.5));
  const rb: V3 = [
    (10.7 + fl) * (1 + sq * 0.5) * k,
    (8.4 + fl * 0.8) * (1 + sq * 0.4) * k,
    (11.4 + fl * 0.5) * (1 - sq) * k,
  ];
  BODY_ID = nid();
  BODY_AX = ax;
  BODY_R = rb;
  out.push({ c: S.body, ax, r: rb, pal: P_FUR, id: BODY_ID, pick: bodyPick });
}

/** Лицевой диск, брови, ремешок фонаря — всё на одной части головы (поворачивается с ней). */
function headPick(qx: number, qy: number, qz: number): number {
  PICK_T = 0;
  const ax = Math.abs(qx);
  // Ремешок фонаря: обвивает голову над диском, к бокам опускается.
  const sc = 0.72 - 0.22 * qx * qx;
  const sw = HI ? 0.065 : 0.075;
  if (Math.abs(qz - sc) < sw && qy > -0.6) {
    PICK_T = Math.abs(qz - sc) > sw * 0.55 ? -0.08 : 0.02;
    return P_STRAP;
  }
  if (qy > 0.02) {
    // Брови: светлая «галочка» от клюва вверх и в стороны по кромке дисков.
    const bx = [0, 0.12, 0.34, 0.62];
    const bz = [-0.14, 0.24, 0.42, 0.44];
    let bd = 9;
    for (let i = 0; i < 3; i++) {
      const vx = bx[i + 1] - bx[i];
      const vz = bz[i + 1] - bz[i];
      const u = clamp01(((ax - bx[i]) * vx + (qz - bz[i]) * vz) / (vx * vx + vz * vz));
      bd = Math.min(bd, Math.hypot(ax - bx[i] - vx * u, qz - bz[i] - vz * u));
    }
    const bw = (HI ? 0.05 : 0.065) * (1 - 0.3 * clamp01((ax - 0.34) / 0.3));
    if (bd < bw) {
      PICK_T = 0.22;
      return P_CREAM;
    }
    // Диск: два круга вокруг глаз; ближе к глазу — кольцо темнее (два кольца).
    const dl = Math.hypot(ax - EYE_X, qz - EYE_Z) / DISC_R;
    // Подбородок: светлый под клювом между дисками.
    const chin = ax < 0.3 && qz < -0.18 && qz > -0.62;
    if (dl < 1 || chin) {
      if (dl < 0.66) PICK_T = -0.1;
      else if (HI) {
        // Тонкие радиальные пёрышки диска.
        const an = Math.atan2(qz - EYE_Z, ax - EYE_X);
        PICK_T = Math.floor((an / TAU) * 22 + 22) % 2 ? 0.03 : -0.03;
      }
      return P_CREAM;
    }
    // Кайма — снаружи и снизу диска («скобки»), сверху её сменяют брови и лоб.
    const an = Math.atan2(qz - EYE_Z, ax - EYE_X);
    if (dl < 1.26 && qz > -0.66 && an < 1.05 && an > -2.7) {
      PICK_T = dl < 1.12 ? 0 : 0.06;
      return P_RIM;
    }
  }
  // Темя и затылок: перо в тёмных пестринах (на крупной).
  const cw = HI ? 11 : 6;
  const an = (Math.atan2(qx, qy) / Math.PI) * cw + cw;
  const col = Math.floor(an);
  const row = Math.floor((1 - qz) * (HI ? 6 : 3));
  const fu = an - col;
  if (hash(col, row, 3) < (HI ? 0.55 : 0.4) && Math.abs(fu - 0.5) < (HI ? 0.2 : 0.26))
    PICK_T = HI ? -0.12 : -0.08;
  return P_FUR;
}

function head(out: PartF[], c: Ctx): void {
  const { o, h } = c;
  const k = h.k;
  const ex = h.dir([1, 0, 0]);
  const ez = h.dir([0, 0, 1]);
  const fl = o.fluff * 0.3;
  HEAD_ID = nid();
  out.push({
    c: h.at([0, 0, 0]),
    ax: axes(ex, ez),
    r: [(HRX + fl) * k, (HRY + fl) * k, (HRZ + fl * 0.5) * k],
    pal: P_FUR,
    id: HEAD_ID,
    pick: headPick,
  });
}

/** Клюв: маленький крючок в «галочке» бровей; раскрытый — красный зев. */
function beak(out: PartF[], c: Ctx): void {
  const { o, h } = c;
  const k = h.k;
  const ey = h.dir([0, 1, 0]);
  const ez = h.dir([0, 0, 1]);
  const op = o.beak;
  const y0 = HRY * 0.9;
  const hinge: V3 = [0, y0, -1.4];
  const ridge = (u: number, qy: number, qz: number) =>
    (qz > 0.4 && Math.abs(qy) < 0.35 ? 0.22 : qz < -0.3 ? -0.06 : 0) + (u > 0.8 ? -0.08 : 0);
  const upr = (p: V3): V3 => pitchX(p, -op * 0.42, hinge);
  feather(
    out,
    h.at(upr([0, y0, -0.2])),
    h.at(upr([0, y0 + 1.7, -0.7])),
    h.at(upr([0, y0 + 1.5, -2.9])),
    [1.5, 1.4, 1.2, 0.95, 0.65, 0.4].map((w) => w * k),
    [1.2, 1.15, 1.0, 0.8, 0.55, 0.35].map((w) => w * k),
    ez,
    P_BEAK,
    { utex: ridge, segs: HI ? 6 : 4, bias: -0.04, over: 1.1 },
  );
  if (op > 0.1) {
    const rot = (p: V3): V3 => pitchX(p, op * 1.0, hinge);
    feather(
      out,
      h.at(rot([0, y0, -1.2])),
      h.at(rot([0, y0 + 1.3, -1.8])),
      h.at(rot([0, y0 + 1.5, -2.6])),
      [1.2, 1.0, 0.8, 0.4].map((w) => w * k),
      0.6 * k,
      ez,
      P_BEAK,
      { bias: -0.1, segs: HI ? 4 : 3 },
    );
    out.push({
      c: h.at([0, y0 + 0.7, -1.5 - op * 0.9]),
      ax: axes(ey, ez),
      r: [2.0 * k, 1.4 * k, (0.4 + 1.2 * op) * k],
      pal: P_MOUTH,
      id: nid(),
      bias: 0.05,
      noSeam: true,
    });
  }
}

/** Ушные пучки: перо с тёмной серединкой и рядом пёрышко короче; качаются на пружинах. */
function tufts(out: PartF[], c: Ctx): void {
  const { o, S, h, lag } = c;
  const k = h.k;
  const e = o.ear;
  const sw = (lag.turn - o.turn) * 0.9 + (lag.tilt - o.tilt) * 1.1 - (lag.headX - S.head[0]) * 0.1;
  const dz = -(lag.headZ - S.head[2]) * 0.1;
  const tex = (_qx: number, qy: number) => (Math.abs(qy) < 0.3 ? -0.12 : qy > 0.6 ? 0.08 : 0);
  const pe = Math.max(0, e);
  const ne = Math.max(0, -e);
  for (const side of [-1, 1]) {
    const base = h.at([side * 0.6 * HRX, -0.8, 0.74 * HRZ]);
    const d = norm(
      add(h.dir(norm([side * (0.4 - 0.12 * pe + 0.7 * ne) + sw, -0.2 - 0.8 * ne, 1 - 0.55 * ne])), [
        0,
        0,
        dz,
      ]),
    );
    const n = h.dir([0, 1, 0]);
    lock(out, base, d, n, 7.4 * k * (1 + 0.12 * pe), 2.4 * k, 1.4 * k, P_FUR, -0.06, tex);
    // Пёрышко у основания с внутренней стороны — пучок, а не рог.
    const b2 = h.at([side * 0.42 * HRX, -0.2, 0.82 * HRZ]);
    const d2 = norm(add(d, h.dir([-side * 0.25, 0, 0])));
    lock(out, b2, d2, n, 4.6 * k * (1 + 0.1 * pe), 1.7 * k, 1.1 * k, P_FUR, -0.08, tex);
  }
}

/** Латунный фонарь на лбу: корпус, стекло (горит — жёлтое), ободок корпуса вокруг. */
let LAMP_AT: V3 = [0, 0, 0];
function lamp(out: PartF[], c: Ctx): void {
  const { o, h } = c;
  const k = h.k;
  const ex = h.dir([1, 0, 0]);
  const ey = h.dir([0, 1, 0]);
  const ez = h.dir([0, 0, 1]);
  const lc = h.at([0, HRY * 0.78 + 0.5, HRZ * 0.6]);
  out.push({
    c: lc,
    ax: axes(ex, ez),
    r: [2.5 * k, 1.9 * k, 2.0 * k],
    pal: P_BRASS,
    id: nid(),
    bias: 0.02,
    tex: (_qx, _qy, qz) => (qz > 0.6 ? 0.06 : 0),
  });
  const gc = add(lc, mul(ey, 1.55 * k));
  LAMP_AT = gc;
  const on = o.lamp > 0.5;
  out.push({
    c: gc,
    ax: axes(ex, ez),
    r: [1.35 * k, 0.55 * k, 1.3 * k],
    pal: on ? P_LIT : P_GLASS,
    id: nid(),
    bias: on ? 0.25 : 0.0,
    noSeam: true,
  });
}

// ---------------------------------------------------------------------------
// Поверх кадра: глаза, грудь в «галочках», луч, кристалл, блики, сон.
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

/** Глаз: огромная оранжевая радужка, зрачок, блик, тёмный ободок; веко сверху. */
function eyes(p: Px, f: Frame, c: Ctx): void {
  const { o, h } = c;
  const ir = IRIS_V[V];
  const ink = INK_V[V];
  const lid = PAL[P_CREAM][5];
  const lidD = PAL[P_CREAM][3];
  const qy = Math.sqrt(1 - EYE_X * EYE_X - EYE_Z * EYE_Z);
  for (const side of [-1, 1] as const) {
    const ep = h.at([side * EYE_X * HRX, qy * HRY, EYE_Z * HRZ]);
    const at = seen(f, mul(ep, RR), OX, OY, 2.2 * RR);
    if (!at) continue;
    const [cx, cy] = scr(ep);
    const facing = clamp01(dot(norm(h.dir([side * 0.3, 1, 0])), VIEW) / 0.96);
    const sxk = Math.max(0.45, facing ** 0.7);
    let R = HI ? 5.8 : 2.5;
    if (o.eye === 'wide') R *= 1.08;
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
        const ring = HI ? 1.15 : 0.85;
        if (o.eye === 'happy') {
          // «^»: дуга сверху.
          if (Math.abs(d - R * 0.72) < (HI ? 0.75 : 0.6) && py < (HI ? -0.4 : 0.2))
            p.set(X, Y, ink);
          continue;
        }
        if (o.eye === 'sleep') {
          // Закрытые глаза — две изогнутые черты «‿».
          if (Math.abs(d - R * 0.78) < (HI ? 0.75 : 0.62) && py > (HI ? 0.4 : -0.2))
            p.set(X, Y, ink);
          continue;
        }
        if (d > R + ring) continue;
        // Веко: сверху вниз при моргании; во гневе — косо, ниже к клюву.
        let lidY = -R - 1 + (2 * R + 1) * blink;
        if (o.eye === 'angry') lidY = Math.max(lidY, -R * 0.3 - side * px * 0.55);
        if (py < lidY) {
          p.set(X, Y, py > lidY - (HI ? 1.0 : 0.8) ? lidD : lid);
          continue;
        }
        if (py < lidY + (HI ? 1.0 : 0.9) && lidY > -R) {
          p.set(X, Y, ink);
          continue;
        }
        if (d > R) {
          p.set(X, Y, ink);
          continue;
        }
        // Зрачок (уже при «настежь»), радужка светлее книзу, блик сверху-слева.
        const pr = R * (o.eye === 'wide' ? 0.38 : 0.5);
        const ppx = px - side * 0.1 * R;
        if (Math.hypot(ppx, py) < pr) {
          p.set(X, Y, ink);
        } else {
          const v = py / R;
          const tone = v < -0.5 ? 1 : v < -0.05 ? 2 : v < 0.45 ? 3 : 4;
          p.set(X, Y, ir[HI && d > R - 0.9 ? tone - 1 : tone]);
        }
        const gx = -0.42 * R;
        const gy = -0.42 * R;
        if (
          HI
            ? Math.abs(px - gx) < 1.1 && Math.abs(py - gy) < 1.1
            : px > gx - 0.8 && px < gx + 0.7 && py > gy - 0.8 && py < gy + 0.7
        )
          p.set(X, Y, WHITE);
        if (HI && Math.abs(px - 0.36 * R) < 0.6 && Math.abs(py - 0.3 * R) < 0.6) p.set(X, Y, ir[5]);
      }
  }
}

/**
 * Тёмные «галочки» по груди: редкие, в шахматном порядке, привязаны к телу.
 * Вверху — гуще, темнее и с пестринами-чёрточками, к брюху — мельче и реже:
 * одинаковая сетка «галочек» читалась бы свитером.
 */
const CHEV_S: [number, number, number][] = [
  [-0.3, 0.52, 0],
  [0.3, 0.52, 0],
  [0, 0.3, 0],
  [-0.42, 0.14, 0],
  [0.42, 0.14, 0],
  [-0.18, -0.08, 0],
  [0.2, -0.1, 0],
  [0, -0.36, 1],
];
const CHEV_L: [number, number, number][] = [
  [-0.4, 0.66, 2],
  [-0.12, 0.7, 2],
  [0.14, 0.68, 2],
  [0.4, 0.65, 2],
  [-0.27, 0.52, 0],
  [0.03, 0.5, 0],
  [0.31, 0.53, 0],
  [-0.47, 0.36, 0],
  [-0.15, 0.32, 0],
  [0.17, 0.34, 0],
  [0.47, 0.37, 0],
  [-0.32, 0.14, 0],
  [0.02, 0.14, 1],
  [0.33, 0.12, 0],
  [-0.48, -0.04, 1],
  [-0.15, -0.06, 0],
  [0.19, -0.05, 1],
  [0.48, -0.03, 1],
  [-0.3, -0.25, 1],
  [0.04, -0.27, 1],
  [0.33, -0.24, 1],
  [-0.12, -0.46, 1],
  [0.2, -0.45, 1],
];
const V_S = [
  ['x.x', '.x.'],
  ['x.x', '.x.'],
  ['x', 'x'],
];
const V_L = [
  ['x...x', 'xx.xx', '.xxx.', '..x..'],
  ['x.x', '.x.'],
  ['x', 'x', 'x'],
];
function chevrons(p: Px, f: Frame, c: Ctx): void {
  const { S } = c;
  const [e1, e2, e3] = BODY_AX;
  const fur = PAL[P_FUR];
  for (const [qx, qz, kind] of HI ? CHEV_L : CHEV_S) {
    const qy = Math.sqrt(Math.max(0, 1 - qx * qx - qz * qz));
    const pt = add(
      S.body,
      add(add(mul(e1, qx * BODY_R[0]), mul(e2, qy * BODY_R[1])), mul(e3, qz * BODY_R[2])),
    );
    const at = seen(f, mul(pt, RR), OX, OY, 1.0 * RR);
    if (!at) continue;
    const rows = (HI ? V_L : V_S)[kind];
    const x0 = at[0] - Math.floor(rows[0].length / 2);
    // Вверху темнее, к брюху светлее.
    const dark = qz > 0.4 ? 5 : qz > -0.1 ? 4 : 3;
    for (let y = 0; y < rows.length; y++)
      for (let x = 0; x < rows[y].length; x++) {
        if (rows[y][x] !== 'x') continue;
        const X = x0 + x;
        const Y = at[1] + y;
        const i = Y * f.w + X;
        if (f.idb[i] !== BODY_ID || f.pal[i] !== P_CREAM) continue;
        p.set(X, Y, fur[Math.max(1, Math.min(5, f.tone[i] - dark))]);
      }
  }
}

/** Луч фонаря: конус от стекла к пятну на полу — только по пустому фону. */
function beam(p: Px, mask: Uint8Array, c: Ctx): void {
  const { o } = c;
  if (o.beam <= 0.02) return;
  const [lx, ly] = scr(LAMP_AT);
  const [tx, ty] = scr([o.beamX, GEM_Y, 0]);
  const srx = (HI ? 11 : 5) * o.beam;
  const sry = HI ? 3.2 : 1.6;
  const ax = tx - lx;
  const ay = ty - ly;
  const L = Math.hypot(ax, ay) || 1;
  const ux = ax / L;
  const uy = ay / L;
  const xs = [lx, tx - srx, tx + srx];
  const ys = [ly, ty - sry, ty + sry];
  const X0 = Math.max(0, Math.floor(Math.min(...xs)) - 1);
  const X1 = Math.min(p.w - 1, Math.ceil(Math.max(...xs)) + 1);
  const Y0 = Math.max(0, Math.floor(Math.min(...ys)) - 1);
  const Y1 = Math.min(p.h - 1, Math.ceil(Math.max(...ys)) + 1);
  for (let Y = Y0; Y <= Y1; Y++)
    for (let X = X0; X <= X1; X++) {
      if (mask[Y * p.w + X]) continue;
      const dx = X + 0.5 - lx;
      const dy = Y + 0.5 - ly;
      const u = (dx * ux + dy * uy) / L;
      const v = Math.abs(dx * uy - dy * ux);
      const spot = ((X + 0.5 - tx) / Math.max(0.5, srx)) ** 2 + ((Y + 0.5 - ty) / sry) ** 2;
      let a = 0;
      const half = lerp(0.7, srx * 0.9, u);
      if (spot < 1) a = 200 - 70 * spot;
      else if (u > 0 && u < 1 && v < half) a = (v < half * 0.35 ? 120 : 82) + 40 * (1 - u);
      if (a <= 0) continue;
      p.set(X, Y, [BEAM[0], BEAM[1], BEAM[2], Math.round(a * o.beam)]);
    }
}

/** Кристалл: голубой шестигранник с гранями (левая светлее), острым верхом и бликом. */
function gemAt(p: Px, cx: number, cy: number, vis: number): void {
  if (vis <= 0.02) return;
  const s = HI ? 2.2 : 1;
  const poly: [number, number][] = [
    [-1.7, 0],
    [-1.9, -3.0],
    [0, -5.4],
    [1.9, -3.0],
    [1.7, 0],
  ].map(([x, y]) => [x * s, y * s] as [number, number]);
  const inside = (x: number, y: number) => {
    let ins = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i];
      const [xj, yj] = poly[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins;
    }
    return ins;
  };
  const n = Math.ceil(6 * s);
  const X0 = Math.round(cx);
  const Y0 = Math.round(cy);
  for (let dy = -n; dy <= 1; dy++)
    for (let dx = -n; dx <= n; dx++) {
      const x = dx + 0.5 - (cx - X0);
      const y = dy + 0.5 - (cy - Y0);
      if (!dith(X0 + dx, Y0 + dy, vis * 1.05)) continue;
      if (inside(x, y)) {
        const top = y < -3.0 * s;
        let tone = x < -0.5 * s ? 5 : x > 0.6 * s ? 3 : 4;
        if (top) tone += x < 0.3 * s ? 2 : 1;
        if (HI && Math.abs(x + 0.9 * s) < 0.5 && y > -2.8 * s && y < -0.8 * s) tone = 7;
        p.set(X0 + dx, Y0 + dy, GEM[Math.min(7, tone)]);
      } else {
        const near = inside(x - 1, y) || inside(x + 1, y) || inside(x, y - 1) || inside(x, y + 1);
        if (near) p.set(X0 + dx, Y0 + dy, GEM[0]);
      }
    }
}

function gemFx(p: Px, c: Ctx): void {
  const { o, S } = c;
  if (o.gem > 0.02) {
    const [x, y] = scr([GEM_X, GEM_Y, 0]);
    gemAt(p, x, y, o.gem);
    if (o.glint > 0.3) {
      const [gx, gy] = scr([GEM_X + 0.6, GEM_Y, 5.6]);
      star(
        p,
        Math.round(gx),
        Math.round(gy),
        HI ? Math.round(1 + 3 * o.glint) : o.glint > 0.6 ? 2 : 1,
        WHITE,
        GEM[6],
      );
    }
  }
  if (o.held > 0.02) {
    const q = add(S.footR, [0, 0.6 * S.k, 1.4 * S.k]);
    const [x, y] = scr(q);
    gemAt(p, x, y, o.held);
    if (o.glint > 0.3) {
      const [gx, gy] = scr(add(q, [0.8, 0, 5.4 * S.k]));
      star(
        p,
        Math.round(gx),
        Math.round(gy),
        HI ? Math.round(1 + 3 * o.glint) : o.glint > 0.6 ? 2 : 1,
        WHITE,
        GEM[6],
      );
    }
  }
}

/** Фонарь: ореол, когда горит; щелчок; блик латуни. */
function lampFx(p: Px, mask: Uint8Array, c: Ctx): void {
  const { o } = c;
  const [lx, ly] = scr(LAMP_AT);
  if (o.lamp > 0.05) {
    const R = HI ? 7.5 : 3.4;
    const n = Math.ceil(R);
    for (let dy = -n; dy <= n; dy++)
      for (let dx = -n; dx <= n; dx++) {
        const X = Math.floor(lx) + dx;
        const Y = Math.floor(ly) + dy;
        if (X < 0 || Y < 0 || X >= p.w || Y >= p.h || mask[Y * p.w + X]) continue;
        const d = Math.hypot(X + 0.5 - lx, Y + 0.5 - ly) / R;
        if (d >= 1) continue;
        p.set(X, Y, [BEAM[0], BEAM[1], BEAM[2], Math.round(120 * (1 - d) * o.lamp)]);
      }
  }
  if (o.click > 0) {
    const r0 = (HI ? 6 : 3) + o.click * (HI ? 4 : 2);
    const L = HI ? 4 : 2;
    const col = hx('#fff4dc');
    for (const a of [-Math.PI / 2 - 0.7, -Math.PI / 2, -Math.PI / 2 + 0.7]) {
      for (let d = 0; d <= L; d += 0.5) {
        const X = Math.round(lx + Math.cos(a) * (r0 + d) - 0.5);
        const Y = Math.round(ly + Math.sin(a) * (r0 + d) - 0.5);
        if (X < 0 || Y < 0 || X >= p.w || Y >= p.h || mask[Y * p.w + X]) continue;
        if (!dith(X, Y, 1.2 - o.click)) continue;
        p.set(X, Y, col);
      }
    }
  }
  if (o.glint > 0.3 && o.gem <= 0.02 && o.held <= 0.02) {
    const L = HI ? Math.round(1 + 2.4 * o.glint) : o.glint > 0.6 ? 1 : 0;
    star(p, Math.round(lx - (HI ? 3 : 1)), Math.round(ly - (HI ? 3 : 1.5)), L, WHITE, BRASS[7]);
  }
}

/** Удар когтями: лучи от лап — только по пустому фону. */
function strikeFx(p: Px, mask: Uint8Array, c: Ctx): void {
  const { o, S } = c;
  const u = o.strike;
  if (u < 0) return;
  const [mx, my] = scr(S.body);
  const col = hx('#fff4dc');
  const dim = hx('#f0c070');
  const vis = u < 0.6 ? 1.1 : (1 - u) / 0.4;
  const r0 = (HI ? 33 : 15) + u * (HI ? 9 : 4);
  const L = HI ? 7 : 3.5;
  for (const a of [-2.75, -2.3, -0.84, -0.39, 0.3, 2.84, 1.9, 1.24]) {
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
  const { h, t } = c;
  for (let j = 0; j < 2; j++) {
    const u = wrap(t / 1.5 + j * 0.5, 1);
    const [sx, sy] = project(mul(h.at([5 + 3.5 * u, 0, 8 + 9 * u]), RR));
    const x0 = Math.round(OX + sx);
    const y0 = Math.round(OY + sy);
    // Крупная «z» растёт по пути; редкая шахматка только на появлении и уходе
    // (сплошь сквозь шахматку буквы читались точками).
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
      if (pl !== P_FUR && pl !== P_WING && pl !== P_CREAM) continue;
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
  };
  LAGS.set(key, r);
  return r;
}

function toRes(parts: PartF[]): PartF[] {
  if (RR === 1) return parts;
  return parts.map((pt) => ({ ...pt, c: mul(pt.c, RR), r: mul(pt.r, RR) }));
}

/** Кадр `i` анимации `a` полосы `res`, вариант окраса `v` (0 — обычный, 1 — золотой). */
export function owlFrame(a: Anim, i: number, res: Res = 's', v = 0): Px {
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
  const parts: PartF[] = [];
  tail(parts, c);
  legs(parts, c);
  body(parts, c);
  head(parts, c);
  beak(parts, c);
  tufts(parts, c);
  lamp(parts, c);
  wing(parts, c, -1);
  wing(parts, c, 1);
  const f = newFrame(cv.cw, cv.ch);
  drawPartsF(f, toRes(parts), PAL, OX, OY);
  seams(f, 1.2 * RR, 1);
  rimLight(f, PAL, (pl) => pl !== P_MOUTH && pl !== P_LIT && pl !== P_GLASS);
  if (HI) softBands(f);
  const p = toPx(f, PAL);
  selOutline(p, INK_V[V], 0.8);
  const mask = new Uint8Array(p.w * p.h);
  for (let j = 0; j < mask.length; j++) mask[j] = p.data[j * 4 + 3] > 0 ? 1 : 0;
  chevrons(p, f, c);
  beam(p, mask, c);
  eyes(p, f, c);
  lampFx(p, mask, c);
  gemFx(p, c);
  strikeFx(p, mask, c);
  if (a === 'sleep') zzz(p, mask, c);
  return p;
}
