// Угольный дракон — пиксельный питомец по эталону боссов 12–14.
//
// Маленький дракон сидит анфас, как сторож клада. Угольная чешуя с
// трещинами светящейся лавы (трещины лежат на самих частях — в их
// координатах, контур не «кипит»; у каждой своя фаза мерцания), бледно-
// охряное брюхо пластинами, широкая голова с надбровьями, морда-лопата с
// двумя ноздрями и двумя клыками, большие золотые глаза с вертикальным
// зрачком. Костяные рога загнуты вверх, на левом висит маленькая золотая
// корона и качается от движений головы. Перепончатые «уши»-жабры — веер
// из трёх косточек, гребень шипов на макушке. Крылья летучей мыши за
// плечами: рука от плеча к запястью с когтем, три пальца веером,
// перепонка между ними с вогнутой кромкой. Хвост с пикой свёрнут на
// полу сбоку. С него летят угольки, из ноздрей — дымок.
//
// Две полосы, у каждой свой рисунок: малая — рамка 48 (шахта, списки),
// крупная — рамка 112 (карточка, вылупление, Питомник): чешуя рядами,
// пластины брюха, жилки перепонок, кольца рогов, радужка глаза.
//
// Перепонки и пика хвоста — плоские части (`flat`): многоугольник в
// плоскости крыла с глубиной по плоскости, тон — от света и от места на
// перепонке (светлее у кости, тень в середине — перепонка провисает).
//
// Анимации 24 к/с по ключам (`kf`): подготовка → разгон → пик → проводка
// → возврат. Голова, кончики крыльев, хвост, «уши» и корона — те же ключи
// с запаздыванием (`spring`). Трюк: глубокий вдох (грудь раздувается,
// трещины разгораются) → струя огня на камень → камень от серого к
// красному и белому → оплывает в золотой самородок → дракон сияет,
// самородок с искрой уходит «в рюкзак».
//
// Золотой и радужный рисуются здесь же (`v`): золотой — своими палитрами,
// радужный — перелив оттенка по телу от точки модели (голова — алая,
// грудь — золотая и зелёная, лапы и хвост — синие и лиловые).

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
  drawParts,
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
// Палитры. Три набора: обычный, золотой (v1), радужный (v2: оттенок
// пересчитывается по точке модели, палитра даёт только ступени).
// ---------------------------------------------------------------------------

const P_COAL = 0;
const P_BELLY = 1;
const P_MEMB = 2;
const P_HORN = 3;
const P_GOLD = 4;
const P_LAVA = 5;
const P_WARM = 6;
const P_STONE = 7;
const P_MOUTH = 8;

const STONE = ramp('#17151a', '#28252c', '#3b3740', '#524d57', '#6c6670', '#89838c', '#a7a1a9');
const GOLD0 = ramp('#3e1e06', '#7a4610', '#b8781c', '#e0a830', '#f8d454', '#fff09a', '#fffce0');
const LAVA0 = ramp(
  '#2a0606',
  '#5e0e08',
  '#a0200a',
  '#dc4a10',
  '#ff7e1c',
  '#ffb43a',
  '#ffe070',
  '#fffbd8',
);
const MOUTH = ramp('#16040a', '#380a10', '#621218', '#8e2424', '#bc4440', '#e07a6a');

const PAL_V: RGBA[][][] = [
  [
    // Уголь: почти чёрный с лиловым отливом, блик — тёплый серый.
    ramp(
      '#09080b',
      '#111014',
      '#19171c',
      '#221f26',
      '#2d2931',
      '#3a353e',
      '#4c4550',
      '#675e68',
      '#8a7f86',
    ),
    // Брюхо: бледная охра.
    ramp('#3a2414', '#5c3c1e', '#83602c', '#a98440', '#cba65c', '#e4c584', '#f5e1b0'),
    // Перепонки: тёмный багрянец, к свету — жар.
    ramp('#1c070b', '#360c12', '#561418', '#7c1f1b', '#a23320', '#c4532a', '#e07c3a'),
    // Кость: рога, когти, клыки, косточки «ушей».
    ramp('#2c241e', '#4c4036', '#746452', '#9e8a70', '#c6b394', '#e6dac0', '#faf3e2'),
    GOLD0,
    LAVA0,
    // Тёплый уголь у трещин — отсвет лавы.
    ramp('#1c0a0a', '#30120f', '#481b13', '#622516', '#80311a'),
    STONE,
    MOUTH,
  ],
  [
    // Золотой: бронза → золото.
    ramp(
      '#140a02',
      '#2a1606',
      '#44260a',
      '#62380e',
      '#844e14',
      '#a8681c',
      '#c88a2c',
      '#e2b04c',
      '#f8d87c',
    ),
    ramp('#5a3a10', '#86601c', '#b08c34', '#d2b052', '#ecd078', '#f8e8a8', '#fffbe0'),
    ramp('#3a1604', '#5e2808', '#8a420e', '#b46216', '#d88624', '#f0aa3c', '#fcd060'),
    ramp('#4a3a20', '#74603a', '#a08a5c', '#c8b484', '#e6d6ac', '#f8f0d4', '#fffef4'),
    ramp('#5a1a08', '#8e2a0c', '#c44a14', '#ec7424', '#ffa040', '#ffcc70', '#fff0c0'),
    ramp('#4a2204', '#8a4a08', '#c8800e', '#f0b020', '#ffd648', '#ffec88', '#fff8c8', '#ffffff'),
    ramp('#2a1604', '#40220a', '#5a320e', '#764416', '#94581e'),
    STONE,
    MOUTH,
  ],
];
// Радужный рисуется по обычному набору, потом цвет пересчитывается.
PAL_V.push(PAL_V[0]);
const INK_V: RGBA[] = [hx('#07070b'), hx('#1a0d02'), hx('#120818')];
const SMOKE = ramp('#2e2a2e', '#4a4448', '#6c6468', '#8e8689', '#b0a8aa');

// ---------------------------------------------------------------------------
// Кадр: холст и рамка тела у двух полос (как у феникса).
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
/** Насколько уголь темнее общего света рига. */
const COAL_DARK = 0.15;
let RR = 1;
let HI = false;
let OX = 0;
let OY = 0;
let V = 0;
let PAL: RGBA[][] = PAL_V[0];
const CE = VIEW[1];
const SE = VIEW[2];

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
const FLICK_T = dur('idle');

// ---------------------------------------------------------------------------
// Поза.
// ---------------------------------------------------------------------------

type Eye = 'open' | 'happy' | 'angry' | 'sleep' | 'wide';

export interface Pose {
  x: number;
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
  /** Пасть: 0 — закрыта, 1 — настежь. */
  jaw: number;
  /** Крылья: угол руки от вертикали наружу, веер пальцев (1 — как в покое). */
  thL: number;
  thR: number;
  fanL: number;
  fanR: number;
  /** Хвост: кончик вбок (+ — наружу) и вверх. */
  tailSw: number;
  tailUp: number;
  /** Задние лапы и передние: сдвиг и подъём. */
  fLx: number;
  fLz: number;
  fRx: number;
  fRz: number;
  aLz: number;
  aRz: number;
  aLy: number;
  aRy: number;
  eye: Eye;
  blink: number;
  /** Накал трещин: 0,3 — тлеют во сне, 1 — покой, 2 — вдох перед огнём. */
  glow: number;
  /** Вдох: грудь раздувается. */
  chest: number;
  /** Дым из ноздрей и угольки (0…1). */
  smoke: number;
  /** Струя огня на камень (длина 0…1), вспышка из пасти в атаке. */
  jet: number;
  burst: number;
  /** Камень: есть ли (0…1), высота падения, накал (0…1,4), плавка в самородок. */
  stone: number;
  stoneZ: number;
  heat: number;
  melt: number;
  /** Самородок уходит «в рюкзак»: подъём и масштаб. */
  nugZ: number;
  nugK: number;
  /** Сияние после трюка. */
  shine: number;
  /** Сон: свернулся. */
  curl: number;
  /** Крылья сложены: запястье у плеча, пальцы висят вдоль тела (0…1). */
  fold: number;
  scale: number;
}

const REST: Pose = {
  x: 0,
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
  thL: 0.72,
  thR: 0.72,
  fanL: 1,
  fanR: 1,
  tailSw: 0,
  tailUp: 0,
  fLx: 0,
  fLz: 0,
  fRx: 0,
  fRz: 0,
  aLz: 0,
  aRz: 0,
  aLy: 0,
  aRy: 0,
  eye: 'open',
  blink: 0,
  glow: 1,
  chest: 0,
  smoke: 1,
  jet: 0,
  burst: 0,
  stone: 0,
  stoneZ: 0,
  heat: 0,
  melt: 0,
  nugZ: 0,
  nugK: 1,
  shine: 0,
  curl: 0,
  fold: 0,
  scale: 1,
};

const loopK = (t: number, T: number, keys: Key[]) => kf(wrap(t, T), keys);

// ---------------------------------------------------------------------------
// Дорожки анимаций.
// ---------------------------------------------------------------------------

function idlePose(t: number): Pose {
  const T = dur('idle');
  const o: Pose = { ...REST };
  // Два вдоха на петлю, второй глубже; пауза — у начала петли.
  const br = loopK(t, T, [
    [0, 0],
    [0.15, 0],
    [0.8, 1, 'o'],
    [1.05, 0.95],
    [1.7, 0.05],
    [1.85, 0],
    [2.35, 1.2, 'o'],
    [2.55, 1.15],
    [2.95, 0],
    [T, 0],
  ]);
  o.chest = 0.35 * br;
  o.sq = -0.02 * br;
  o.z = 0.3 * br;
  o.glow = 1 + 0.22 * br;
  o.nod = -0.04 * br;
  // Голова: оглянулся вправо (с перелётом), потом влево, склонил набок.
  o.turn = loopK(t, T, [
    [0, 0],
    [0.45, 0],
    [0.62, 0.36, 'o'],
    [0.7, 0.31],
    [1.2, 0.3],
    [1.34, -0.34, 'o'],
    [1.42, -0.29],
    [2.0, -0.27],
    [2.26, 0.03, 'o'],
    [2.4, 0],
    [T, 0],
  ]);
  o.tilt = loopK(t, T, [
    [0, 0],
    [0.45, 0],
    [0.66, 0.07, 'o'],
    [1.25, 0.05],
    [1.4, -0.06],
    [2.0, -0.05],
    [2.28, 0.14, 'o'],
    [2.62, 0.12],
    [2.9, 0, 'o'],
    [T, 0],
  ]);
  o.nod += loopK(t, T, [
    [0, 0],
    [2.2, 0],
    [2.34, 0.1, 'o'],
    [2.7, 0.06],
    [2.95, 0],
    [T, 0],
  ]);
  o.hx = o.turn * 1.2 + o.tilt * 3;
  o.blink = Math.max(bump(t, 0.95, 1.12), bump(t, 2.46, 2.6), bump(t, 2.64, 2.78) * 0.8);
  // Крылья: потянулся на выдохе — приподнял и развёл пальцы, уронил.
  const shk = kf(t, [
    [1.55, 0],
    [1.72, 1, 'o'],
    [1.9, -0.2, 'i'],
    [2.05, 0.06],
    [2.2, 0],
  ]);
  o.thL = REST.thL - 0.16 * shk - 0.02 * br;
  o.thR = REST.thR - 0.16 * shk - 0.02 * br;
  o.fanL = o.fanR = REST.fanL + 0.14 * shk + 0.02 * br;
  // Хвост: кончик ходит восьмёркой и вздрагивает после потягушек; в начале петли — в нуле,
  // туда же приходят разовые (их ключи кончаются нулём).
  o.tailSw = 0.5 * Math.sin((t / T) * Math.PI * 2) + 0.6 * bump(t, 1.9, 2.4);
  o.tailUp = 0.3 * Math.sin((t / T) * Math.PI * 4);
  return o;
}

function walkPose(t: number): Pose {
  const T = dur('walk');
  const o: Pose = { ...REST };
  const h = wrap(t, T);
  // Вперевалку: 0–0,5 — левая задняя в воздухе, тело над правой; 0,5–1 — наоборот.
  const sway = loopK(h, T, [
    [0, 0],
    [0.22, 1, 'o'],
    [0.32, 0.95],
    [0.5, 0],
    [0.72, -1, 'o'],
    [0.82, -0.95],
    [1.0, 0],
  ]);
  o.x = 1.1 * sway;
  o.lean = 0.085 * sway;
  const bob = loopK(h, T, [
    [0, -1],
    [0.06, -1.15, 'o'],
    [0.25, 1, 'o'],
    [0.44, 0.1],
    [0.5, -1, 'i'],
    [0.56, -1.15, 'o'],
    [0.75, 1, 'o'],
    [0.94, 0.1],
    [1.0, -1, 'i'],
  ]);
  o.z = 0.55 + 0.6 * bob;
  o.sq = -0.04 * bob;
  // Лапы: поднимается та, с которой тело ушло; передние — накрест задним.
  const liftL = bump(h, 0.04, 0.46);
  const liftR = bump(h, 0.54, 0.96);
  o.fLz = 2.4 * liftL ** 0.8;
  o.fRz = 2.4 * liftR ** 0.8;
  o.fLx = 0.5 * Math.sin(Math.PI * clamp01((h - 0.04) / 0.42)) * 0;
  o.aRz = 2.0 * liftL ** 0.8;
  o.aLz = 2.0 * liftR ** 0.8;
  o.aRy = 0.8 * liftL;
  o.aLy = 0.8 * liftR;
  // Голова держит горизонт, кивает в такт.
  o.tilt = -0.07 * sway;
  o.nod = 0.05 * bob;
  o.hx = -0.5 * sway;
  // Крылья — балансир, хвост метёт против тела.
  o.thL = REST.thL + 0.06 + 0.1 * Math.max(0, sway);
  o.thR = REST.thR + 0.06 + 0.1 * Math.max(0, -sway);
  o.tailSw = -0.9 * sway;
  o.tailUp = 0.25 + 0.15 * bob;
  o.smoke = 0.6;
  return o;
}

function happyPose(t: number): Pose {
  const o: Pose = { ...REST };
  const T = dur('happy');
  // Присел → толчок → в воздухе крылья раскрыл и взмахнул → приземлился.
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
  const flap = kf(t, [
    [0, REST.thL],
    [0.16, 1.05, 'o'],
    [0.3, 0.3, 'o'],
    [0.42, 1.35, 'i'],
    [0.54, 0.45, 'o'],
    [0.7, 0.85],
    [0.82, 1.0, 'i'],
    [0.92, 0.8, 'o'],
    [1.0, REST.thL],
    [T, REST.thL],
  ]);
  o.thL = o.thR = flap;
  o.fanL = o.fanR = kf(t, [
    [0, REST.fanL],
    [0.16, 0.85, 'o'],
    [0.3, 1.3, 'o'],
    [0.85, 1.2],
    [1.0, REST.fanL],
  ]);
  o.nod = kf(t, [
    [0, 0],
    [0.16, 0.12, 'o'],
    [0.3, -0.16, 'o'],
    [0.7, -0.1],
    [0.84, 0.07],
    [1.0, 0],
  ]);
  o.tilt = kf(t, [
    [0.3, 0],
    [0.46, 0.13],
    [0.64, -0.1],
    [0.84, 0.04],
    [1.0, 0],
  ]);
  // Хвост виляет: два маха кончиком.
  o.tailSw = kf(t, [
    [0.12, 0],
    [0.28, 1.4, 'o'],
    [0.46, -1.2],
    [0.64, 1.1],
    [0.82, -0.5],
    [1.0, 0],
  ]);
  o.tailUp = kf(t, [
    [0.15, 0],
    [0.35, 1.2, 'o'],
    [0.8, 0.7],
    [1.0, 0],
  ]);
  o.fLz = o.fRz = kf(t, [
    [0.2, 0],
    [0.4, 1.8, 'o'],
    [0.7, 1.4],
    [0.8, 0, 'i'],
  ]);
  o.aLz = o.aRz = kf(t, [
    [0.18, 0],
    [0.36, 3.2, 'o'],
    [0.66, 2.6],
    [0.8, 0, 'i'],
  ]);
  o.aLy = o.aRy = kf(t, [
    [0.18, 0],
    [0.36, 1.6, 'o'],
    [0.66, 1.2],
    [0.8, 0, 'i'],
  ]);
  o.eye = t > 0.1 && t < 0.98 ? 'happy' : 'open';
  o.jaw = bump(t, 0.26, 0.82) * 0.55;
  o.glow =
    1 +
    kf(t, [
      [0.2, 0],
      [0.44, 0.7, 'o'],
      [0.8, 0.3],
      [1.0, 0],
    ]);
  o.smoke = kf(t, [
    [0, 1],
    [0.1, 0],
    [0.9, 0],
    [T, 1],
  ]);
  return o;
}

/** Камень трюка: слева спереди, на полу. */
const STONE_AT: V3 = [-14.5, 7.5, 0];

function workPose(t: number): Pose {
  const o: Pose = { ...REST };
  const T = dur('work');
  // 0–0,2 с: камень падает слева, дракон глядит на него.
  o.stone = t < 1.95 ? 1 : 0;
  o.stoneZ = kf(t, [
    [0, 16],
    [0.14, 0, 'i'],
    [0.2, 1.1, 'o'],
    [0.26, 0, 'i'],
  ]);
  o.turn = kf(t, [
    [0, 0],
    [0.12, -0.3, 'o'],
    [0.6, -0.26],
    [0.7, -0.36, 'o'],
    [1.12, -0.36],
    [1.3, -0.3],
    [1.5, -0.12],
    [1.66, 0.05],
    [1.84, 0],
  ]);
  // 0,2–0,62: глубокий вдох — голова назад-вверх, грудь раздувается, трещины разгораются.
  o.chest = kf(t, [
    [0.18, 0],
    [0.6, 1, 'o'],
    [0.7, 1.05],
    [1.12, 0.2, 'i'],
    [1.5, 0.1],
    [1.62, 0.6, 'o'],
    [1.8, 0.45],
    [T, 0],
  ]);
  o.sq = kf(t, [
    [0, 0],
    [0.14, 0.06, 'o'],
    [0.26, 0],
    [0.6, -0.06, 'o'],
    [0.7, 0.05, 'i'],
    [0.82, 0],
    [1.6, -0.04],
    [1.8, 0],
  ]);
  o.nod = kf(t, [
    [0, 0],
    [0.14, 0.18, 'o'],
    [0.26, 0.1],
    [0.58, -0.28, 'o'],
    [0.66, -0.3],
    [0.72, 0.32, 'i'],
    [1.1, 0.3],
    [1.3, 0.22],
    [1.5, 0.05],
    [1.66, -0.12, 'o'],
    [1.84, 0],
  ]);
  o.bow = kf(t, [
    [0.55, 0],
    [0.62, -0.08, 'o'],
    [0.72, 0.12, 'i'],
    [1.1, 0.1],
    [1.3, 0],
  ]);
  o.hx = kf(t, [
    [0, 0],
    [0.14, -0.8, 'o'],
    [0.6, -0.4],
    [0.72, -1.8, 'i'],
    [1.1, -1.6],
    [1.5, -0.6],
    [1.84, 0],
  ]);
  o.hz = kf(t, [
    [0.2, 0],
    [0.6, 0.8, 'o'],
    [0.72, -0.6, 'i'],
    [1.1, -0.5],
    [1.4, 0],
  ]);
  o.glow = kf(t, [
    [0, 1],
    [0.2, 1],
    [0.6, 2.3, 'i'],
    [0.72, 2.2],
    [1.1, 1.5],
    [1.45, 1.2],
    [1.56, 2.4, 'o'],
    [1.8, 1.6],
    [T, 1],
  ]);
  o.jaw = kf(t, [
    [0.58, 0],
    [0.68, 1, 'o'],
    [1.06, 0.95],
    [1.16, 0.15, 'i'],
    [1.3, 0],
    [1.56, 0],
    [1.64, 0.4, 'o'],
    [1.82, 0.3],
    [1.96, 0],
  ]);
  o.jet = kf(t, [
    [0.62, 0],
    [0.72, 1, 'o'],
    [1.06, 1],
    [1.14, 0, 'i'],
  ]);
  // Камень: серый → тёмно-красный → алый → белый; оплывает в самородок.
  o.heat = kf(t, [
    [0.66, 0],
    [0.9, 0.55, 'l'],
    [1.1, 1.05],
    [1.22, 1.35, 'o'],
    [1.36, 1.0],
    [1.5, 0.3],
    [1.62, 0],
  ]);
  o.melt = kf(t, [
    [1.08, 0],
    [1.42, 1, 'o'],
  ]);
  // Самородок с искрой уходит «в рюкзак».
  o.nugZ = kf(t, [
    [1.78, 0],
    [1.94, 13, 'o'],
  ]);
  o.nugK = kf(t, [
    [1.8, 1],
    [1.94, 0, 'i'],
  ]);
  o.shine = kf(t, [
    [1.46, 0],
    [1.58, 1, 'o'],
    [1.82, 0.7],
    [T, 0],
  ]);
  o.eye =
    t > 0.6 && t < 1.12
      ? 'angry'
      : t > 1.14 && t < 1.46
        ? 'wide'
        : t > 1.5 && t < 1.88
          ? 'happy'
          : 'open';
  o.thL = o.thR = kf(t, [
    [0, REST.thL],
    [0.2, REST.thL],
    [0.6, 0.5, 'o'],
    [0.72, 0.62, 'i'],
    [1.1, 0.64],
    [1.5, REST.thL],
    [1.58, 0.42, 'o'],
    [1.84, 0.62],
    [T, REST.thL],
  ]);
  o.fanL = o.fanR = kf(t, [
    [0.2, 1],
    [0.6, 1.15],
    [1.1, 1.1],
    [1.5, 1],
    [1.58, 1.25, 'o'],
    [T, 1],
  ]);
  o.tailSw = kf(t, [
    [0.6, 0],
    [0.72, 0.6, 'o'],
    [1.1, 0.4],
    [1.56, 0],
    [1.66, 1.1, 'o'],
    [1.78, -0.6],
    [1.9, 0.2],
    [T, 0],
  ]);
  o.tailUp = kf(t, [
    [1.5, 0],
    [1.62, 1, 'o'],
    [1.9, 0.3],
    [T, 0],
  ]);
  o.smoke = kf(t, [
    [0, 1],
    [0.2, 0],
    [1.14, 0],
    [1.2, 1, 'o'],
    [1.4, 0],
    [1.8, 0],
    [T, 1],
  ]);
  if (!o.stone) {
    // Камень убран — его величины возвращаются к покою (на картинке их уже нет, стык чистый).
    o.melt = REST.melt;
    o.nugZ = REST.nugZ;
    o.nugK = REST.nugK;
  }
  return o;
}

function attackPose(t: number): Pose {
  // Замах: встал на дыбы, крылья вверх, пасть набирает жар → удар (кадр 9,
  // 0,375 с): бросок вперёд-вниз, пасть настежь, вспышка огня, крылья
  // распахнуты в стороны во всю ширину → проводка: пламя в дым → возврат.
  const o: Pose = { ...REST };
  o.bow = kf(t, [
    [0, 0],
    [0.28, -0.2, 'o'],
    [0.33, -0.22],
    [0.38, 0.3, 'i'],
    [0.5, 0.26, 'o'],
    [0.66, 0.08],
    [0.84, 0],
  ]);
  o.sq = kf(t, [
    [0, 0],
    [0.12, 0.08, 'o'],
    [0.3, -0.08],
    [0.38, 0.1, 'i'],
    [0.5, 0.03, 'o'],
    [0.7, 0],
  ]);
  o.z = kf(t, [
    [0.1, 0],
    [0.3, 1.4, 'o'],
    [0.38, 0, 'i'],
  ]);
  o.thL = o.thR = kf(t, [
    [0, REST.thL],
    [0.12, 0.85, 'o'],
    [0.3, 0.28, 'o'],
    [0.34, 0.25],
    [0.38, 1.3, 'i'],
    [0.5, 1.4, 'o'],
    [0.66, 1.05],
    [0.84, REST.thL],
  ]);
  o.fanL = o.fanR = kf(t, [
    [0, 1],
    [0.3, 1.25, 'o'],
    [0.38, 1.3],
    [0.55, 1.15],
    [0.84, 1],
  ]);
  // Голова: замах назад-вверх, в ударе — вперёд к зрителю, мордой прямо (пасть видна).
  o.nod = kf(t, [
    [0, 0],
    [0.3, -0.3, 'o'],
    [0.38, -0.16, 'i'],
    [0.5, -0.12],
    [0.66, 0.04],
    [0.84, 0],
  ]);
  o.hy = kf(t, [
    [0, 0],
    [0.3, -1.4, 'o'],
    [0.38, 3.0, 'i'],
    [0.5, 2.6],
    [0.7, 0.6],
    [0.84, 0],
  ]);
  o.tilt = kf(t, [
    [0.4, 0],
    [0.5, 0.1],
    [0.6, -0.08],
    [0.72, 0.03],
    [0.84, 0],
  ]);
  o.hz = kf(t, [
    [0, 0],
    [0.3, 1.2, 'o'],
    [0.38, -1.2, 'i'],
    [0.6, -0.6],
    [0.84, 0],
  ]);
  o.jaw = kf(t, [
    [0.14, 0],
    [0.3, 0.45, 'o'],
    [0.37, 1, 'i'],
    [0.5, 1],
    [0.62, 0.2],
    [0.72, 0],
  ]);
  o.burst = kf(t, [
    [0.34, 0],
    [0.38, 1, 'o'],
    [0.5, 0.85],
    [0.62, 0, 'i'],
  ]);
  o.glow = kf(t, [
    [0, 1],
    [0.3, 2.0, 'i'],
    [0.38, 2.4],
    [0.6, 1.4],
    [0.84, 1],
  ]);
  o.chest = kf(t, [
    [0.05, 0],
    [0.3, 0.9, 'o'],
    [0.4, 0.1, 'i'],
    [0.84, 0],
  ]);
  o.eye = t > 0.05 && t < 0.78 ? 'angry' : 'open';
  // Правая передняя — когтями в удар.
  o.aRz = kf(t, [
    [0.1, 0],
    [0.3, 4.5, 'o'],
    [0.38, 1.0, 'i'],
    [0.5, 0, 'o'],
  ]);
  o.aRy = kf(t, [
    [0.1, 0],
    [0.3, 1.0, 'o'],
    [0.38, 3.2, 'i'],
    [0.6, 0.8],
    [0.84, 0],
  ]);
  o.tailSw = kf(t, [
    [0.1, 0],
    [0.3, -0.7, 'o'],
    [0.42, 1.2, 'i'],
    [0.6, 0.4],
    [0.84, 0],
  ]);
  o.tailUp = kf(t, [
    [0.1, 0],
    [0.3, 0.9],
    [0.45, 0.4],
    [0.84, 0],
  ]);
  o.smoke = kf(t, [
    [0, 1],
    [0.08, 0],
    [0.5, 0],
    [0.62, 1, 'o'],
    [0.75, 0.4],
    [0.917, 1],
  ]);
  return o;
}

function sleepPose(t: number): Pose {
  const T = dur('sleep');
  const o: Pose = { ...REST };
  const br = loopK(t, T, [
    [0, 0],
    [0.2, 0],
    [0.9, 1, 'o'],
    [1.6, 0.05],
    [1.75, 0],
    [2.4, 1.25, 'o'],
    [2.95, 0],
    [T, 0],
  ]);
  // Осел «буханкой», голова свесилась на грудь набок, лапы вместе, хвост кольцом спереди.
  o.curl = 1;
  o.chest = 0.3 * br;
  o.sq = 0.13 - 0.025 * br;
  o.z = -0.5 + 0.18 * br;
  o.bow = 0.06;
  o.hy = 1.6;
  o.hz = -5.6 + 0.3 * br;
  o.nod = 0.34 - 0.03 * br;
  o.tilt = 0.24;
  o.turn = -0.12;
  o.hx = -1.2;
  // Крылья сложены: запястье у плеча, пальцы висят вдоль боков.
  o.fold = 1;
  o.thL = o.thR = 0.32 - 0.02 * br;
  o.eye = 'sleep';
  o.glow = 0.34 + 0.14 * br;
  o.smoke = 1;
  o.tailSw = 0.12 * Math.sin((t / T) * Math.PI * 2);
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
  shoulderL: V3;
  shoulderR: V3;
  wingL: V3;
  wingR: V3;
  rump: V3;
  footL: V3;
  footR: V3;
  pawL: V3;
  pawR: V3;
  k: number;
}

const BODY0: V3 = [0, 0, 11.2];
const HEAD0: V3 = [0, 2.8, 29.0];
/** Масштаб модели в рамке: лапы — кончики рогов ~44 пикселя малой полосы. */
const G = 0.95;

function skel(o: Pose): Skel {
  const s = o.scale * G;
  const sq = o.sq;
  const up = (p: V3): V3 => {
    let q: V3 = [p[0] * (1 + sq * 0.55), p[1] * (1 + sq * 0.4), p[2] * (1 - sq)];
    q = pitchX(q, o.bow, [0, 0, 4]);
    q = rollY(q, o.lean, [0, 0, 0]);
    q = mul(q, s);
    return add(q, [o.x, 0, o.z]);
  };
  // Стоящая лапа не едет за телом: x — свой, подъём — только у поднятой.
  const curl = o.curl;
  const foot = (side: number, dx: number, dz: number): V3 => [
    side * (7.4 + 0.8 * curl) * s + dx,
    (5.8 - 0.6 * curl) * s,
    0.9 * s + dz + Math.max(0, o.z),
  ];
  const paw = (side: number, dy: number, dz: number): V3 => [
    side * (4.6 - 1.6 * curl) * s + o.x * 0.25,
    (7.4 + 0.8 * curl) * s + dy,
    0.9 * s + dz + Math.max(0, o.z),
  ];
  return {
    up,
    body: up(BODY0),
    head: up(add(HEAD0, [o.hx, o.hy, o.hz])),
    shoulderL: up([-5.4, 3.0, 17.6]),
    shoulderR: up([5.4, 3.0, 17.6]),
    wingL: up([-4.4, -3.6, 18.8]),
    wingR: up([4.4, -3.6, 18.8]),
    rump: up([0, -5.2, 5.0]),
    footL: foot(-1, o.fLx, o.fLz),
    footR: foot(1, o.fRx, o.fRz),
    pawL: paw(-1, o.aLy, o.aLz),
    pawR: paw(1, o.aRy, o.aRz),
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
  // На малой голова чуть крупнее: глаза, ноздри и клыки должны поместиться.
  const k = S.k * (HI ? 1.0 : 1.1);
  return { dir, k, at: (p) => add(S.head, mul(dir(p), k)) };
}

// ---------------------------------------------------------------------------
// Узоры: чешуя, пластины брюха, трещины лавы.
// ---------------------------------------------------------------------------

/** Чешуя рядами (ось 3 — вверх): светлая дуга сверху чешуйки, тёмная снизу. */
function scales(rows: number, cols: number, amp: number) {
  return (qx: number, qy: number, qz: number) => {
    const v = (1 - qz) * rows * 0.5;
    const row = Math.floor(v);
    const fv = v - row;
    const u = (Math.atan2(qx, qy) / Math.PI) * cols + (row & 1) * 0.5;
    const fu = u - Math.floor(u);
    const edge = (fu - 0.5) ** 2 * 4;
    return fv > 0.78 - edge * 0.5 ? -amp : fv < 0.22 && edge < 0.6 ? amp * 0.6 : 0;
  };
}

/** Пластины брюха поперёк: тёмный шов под каждой, светлая губа сверху; к краям изгиб. */
function plates(rows: number, top = 1, curve = 0.22) {
  return (qx: number, _qy: number, qz: number) => {
    const v = (top - qz + curve * qx * qx) * rows * 0.5;
    const row = Math.floor(v);
    const fv = v - row;
    if (row < 0) return 0;
    return fv > (HI ? 0.84 : 0.7) ? -0.24 : fv < (HI ? 0.2 : 0.3) ? 0.07 : 0;
  };
}

/** Трещина — ломаная на передней стороне части, в её координатах (qx, qz). */
type Crack = [number, number][];
interface CrackSet {
  c: V3;
  ax: [V3, V3, V3];
  r: V3;
  lines: Crack[];
  seed: number;
}
/** Части с трещинами этого кадра: номер части → её место и трещины (в пикселях модели). */
const CRK = new Map<number, CrackSet>();

let NEXT_ID = 0;
const nid = () => ++NEXT_ID;

function cracked(pt: Part, lines: Crack[], seed: number): Part {
  CRK.set(pt.id, { c: pt.c, ax: pt.ax, r: pt.r, lines, seed });
  return pt;
}

// ---------------------------------------------------------------------------
// Части.
// ---------------------------------------------------------------------------

interface Lag {
  headX: number;
  headZ: number;
  thL: number;
  thR: number;
  tailX: number;
  tailZ: number;
  turn: number;
}

interface Ctx {
  o: Pose;
  S: Skel;
  h: HeadF;
  lag: Lag;
  tau: number;
}

/** Плоская часть: многоугольник, тон — от света плоскости и от места (u — угол от `a` к `b` вокруг вершины, r — от вершины к кромке). */
interface Flat {
  pts: V3[];
  apex: V3;
  a: V3;
  b: V3;
  pal: number;
  id: number;
  shade: (u: number, r: number) => number;
  /** Лава по плоскости (жилка пики): ступень лавы или −1. */
  vein?: (u: number, r: number) => number;
}

function profile(wid: number[], u: number): number {
  const wf = wid.length - 1;
  const wi = Math.min(wf - 1, Math.floor(u * wf));
  return lerp(wid[wi], wid[wi + 1], u * wf - wi);
}

interface COpt {
  id?: number;
  lit?: number;
  tex?: Part['tex'];
  bias?: number;
  noSeam?: boolean;
}

/** Звенья по кривой `at(u)`: одна деталь — один номер, швов внутри нет. */
function chain(
  out: Part[],
  at: (u: number) => V3,
  wid: number[],
  thick: number | number[],
  nrm: V3,
  pal: number,
  along: [number, number] | null,
  segs: number,
  op: COpt = {},
): number {
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
    const w = Math.max(0.3, profile(wid, um));
    const th = typeof thick === 'number' ? thick : Math.max(0.3, profile(thick, um));
    out.push({
      c: mul(add(p0, p1), 0.5),
      ax: axes(d, nrm),
      r: [len * 0.62 + 0.2, w, th],
      pal,
      id,
      along: along ? [lerp(along[0], along[1], u0), lerp(along[0], along[1], u1)] : undefined,
      lit: op.lit ?? 1,
      tex: op.tex,
      bias: op.bias,
      noSeam: op.noSeam,
    });
  }
  return id;
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

/** Мерцание: своя фаза у каждого, частоты — целое число кругов за петлю. */
function flick(tau: number, seed: number): number {
  const ph = hash(seed, 7, 3);
  const ph2 = hash(seed, 11, 5);
  const u = (tau / PER) * Math.PI * 2;
  const n1 = Math.max(1, Math.round((3 * PER) / FLICK_T));
  const n2 = Math.max(n1 + 1, Math.round((7 * PER) / FLICK_T));
  return 0.6 * Math.sin(u * n1 + ph * 6.283) + 0.4 * Math.sin(u * n2 + ph2 * 6.283);
}
let PER = FLICK_T;

/** Кромка перепонки X → Y, провисшая к вершине: точки без концов. */
function sag(X: V3, Y: V3, apex: V3, k: number, n: number): V3[] {
  const m = mul(add(X, Y), 0.5);
  const inw = norm(sub(apex, m));
  const L = Math.hypot(...sub(Y, X));
  const out: V3[] = [];
  for (let i = 1; i < n; i++) {
    const u = i / n;
    out.push(add(lerp3(X, Y, u), mul(inw, L * k * Math.sin(Math.PI * u))));
  }
  return out;
}

/** Тон перепонки: светлее у вершины и у косточек, провисшая середина в тени, кромка темнее. */
function membShade(u: number, r: number): number {
  const mid = Math.sin(Math.PI * clamp01(u));
  let k = 0.1 * (1 - r) - 0.16 * mid * r - (r > 0.86 ? 0.08 : 0);
  if (u < 0.07 || u > 0.93) k -= 0.1;
  if (HI && Math.abs(u - 0.5) < 0.035 && r > 0.2 && r < 0.88) k -= 0.1;
  return k;
}

function wing(out: Part[], flats: Flat[], c: Ctx, side: -1 | 1): void {
  const { o, S, lag } = c;
  const k = S.k;
  const th = side < 0 ? o.thL : o.thR;
  const thl = side < 0 ? lag.thL : lag.thR;
  const fan = side < 0 ? o.fanL : o.fanR;
  const R = side < 0 ? S.wingL : S.wingR;
  // Плоскость крыла почти фронтальная, внешний край чуть отведён назад.
  const N0 = norm([side * 0.28, 1, 0.08]);
  const armDir = (a: number): V3 => {
    const A = norm(rollY([side * Math.sin(a), 0, Math.cos(a)], o.lean));
    // Убрать из руки составляющую вдоль нормали — рука лежит в плоскости.
    return norm(sub(A, mul(N0, dot(A, N0))));
  };
  const A = armDir(th);
  const AL = armDir(thl);
  const down = (a: V3): V3 => {
    let D = norm(cross(N0, a));
    if (D[0] * side - D[2] < 0) D = mul(D, -1);
    return D;
  };
  const D = down(A);
  const DL = down(AL);
  const LA = 10.6 * k * (1 - 0.42 * o.fold);
  const elbow = add(add(R, mul(A, LA * 0.48)), mul(D, 1.1 * k));
  const W = add(R, mul(A, LA));
  // Рука: две кости, к запястью тоньше; вдоль — жилка лавы.
  const aid = nid();
  for (const [p, q, rr] of [
    [R, elbow, 1.55],
    [elbow, W, 1.2],
  ] as [V3, V3, number][]) {
    const d = sub(q, p);
    const pt: Part = {
      c: mul(add(p, q), 0.5),
      ax: axes(d, N0),
      r: [Math.hypot(...d) * 0.5 + 0.7 * k, rr * k, rr * k],
      pal: P_COAL,
      id: aid,
      bias: 0.04,
    };
    out.push(pt);
  }
  // Коготь на запястье.
  out.push({
    c: add(W, mul(A, 1.3 * k)),
    ax: axes(norm(add(A, mul(D, -0.4))), N0),
    r: [1.1 * k, 0.5 * k, 0.5 * k],
    pal: P_HORN,
    id: nid(),
    along: [0.45, 0.85],
    noSeam: true,
  });
  // Пальцы: веер от запястья, кончики отстают пружиной.
  const PH = [0.5, 1.2, 1.9];
  const FOLD = [2.62, 2.8, 2.98];
  const LEN = [9.0, 9.4, 7.8];
  const tips: V3[] = [];
  for (let j = 0; j < 3; j++) {
    const phi = lerp(PH[j] * fan, FOLD[j], o.fold);
    const dNow = norm(add(mul(A, Math.cos(phi)), mul(D, Math.sin(phi))));
    const dLag = norm(add(mul(AL, Math.cos(phi)), mul(DL, Math.sin(phi))));
    const L = LEN[j] * k;
    const mid = add(W, mul(dNow, L * 0.5));
    const tip = add(mid, mul(dLag, L * 0.5));
    tips.push(tip);
    chain(
      out,
      (u) => bezQ(W, add(mid, mul(D, 0.3 * k)), tip, u),
      [0.75 * k, 0.55 * k, 0.35 * k],
      0.5 * k,
      N0,
      P_COAL,
      null,
      4,
      { bias: 0.1, lit: 1 },
    );
  }
  // Перепонки: между пальцами и от последнего пальца к спине.
  const B = S.up([side * 6.6, -4.4, 8.2]);
  const back = mul(VIEW, -0.6 * k);
  const fl = (pts: V3[], a: V3, b: V3) =>
    flats.push({
      pts: pts.map((p) => add(p, back)),
      apex: add(W, back),
      a: add(a, back),
      b: add(b, back),
      pal: P_MEMB,
      id: nid(),
      shade: membShade,
    });
  fl([W, tips[0], ...sag(tips[0], tips[1], W, 0.2, 6), tips[1]], tips[0], tips[1]);
  fl([W, tips[1], ...sag(tips[1], tips[2], W, 0.2, 6), tips[2]], tips[1], tips[2]);
  fl([W, tips[2], ...sag(tips[2], B, W, 0.16, 7), B, R], tips[2], B);
}

/** Хвост: от крестца вправо по полу, кольцом вперёд; пика поднята. Кончик отстаёт пружиной. */
function tail(out: Part[], flats: Flat[], c: Ctx): void {
  const { o, S, lag } = c;
  const k = S.k;
  const base = S.up([3.0, -5.8, 3.6]);
  const sw = o.tailSw + (lag.tailX - S.body[0]) * 0.35;
  const lift = o.tailUp + Math.max(-0.5, (lag.tailZ - S.body[2]) * 0.25);
  const cu = o.curl;
  // Точки на полу (не за телом: хвост лежит).
  const pts: V3[] = [
    base,
    [lerp(10.5, 9, cu) * k + o.x * 0.5, lerp(-5.2, -2, cu) * k, 1.9 * k],
    [lerp(15.6, 12.5, cu) * k + o.x * 0.25, lerp(-0.8, 4.5, cu) * k, 1.6 * k],
    [lerp(16.6, 8.5, cu) * k + sw * 0.6, lerp(4.0, 10.2, cu) * k, 1.6 * k],
    [lerp(14.2, 1.5, cu) * k + sw * 1.3, lerp(7.4, 11.4, cu) * k, (1.9 + lift * 0.8) * k],
    [
      lerp(13.4, -2.5, cu) * k + sw * 2.0,
      lerp(7.8, 11.0, cu) * k,
      (lerp(5.6, 2.2, cu) + lift * 2.2) * k,
    ],
  ];
  // В прыжке хвост поднимается с телом, кончик отстаёт.
  const jz = Math.max(0, o.z);
  if (jz > 0)
    for (let i = 1; i < pts.length; i++) {
      const u = i / (pts.length - 1);
      const zz = jz * (1 - 0.3 * u) + Math.min(0, lag.tailZ - S.body[2]) * 0.7 * u;
      pts[i] = [pts[i][0], pts[i][1], Math.max(pts[i][2], pts[i][2] + zz)];
    }
  const at = (u: number) => catmull(pts, u);
  const W = [3.4, 3.1, 2.7, 2.2, 1.7, 1.25, 0.9].map((w) => w * k);
  const tid = chain(
    out,
    at,
    W,
    W.map((w) => w * 0.9),
    [0, 0, 1],
    P_COAL,
    null,
    15,
    {
      tex: HI ? scales(3, 3, 0.07) : undefined,
    },
  );
  // Шипы по хребту хвоста — костяные.
  const nsp = HI ? 4 : 2;
  for (let j = 0; j < nsp; j++) {
    const u = 0.2 + (j / nsp) * 0.55;
    const p = at(u);
    const w = profile(W, u);
    out.push({
      c: add(p, [0, 0, w * 0.85 + 0.5 * k]),
      ax: axes([0, 0, 1], [0, 1, 0]),
      r: [1.0 * k * (1 - u * 0.5), 0.45 * k, 0.45 * k],
      pal: P_HORN,
      id: tid,
      along: [0.3, 0.8],
      noSeam: true,
    });
  }
  // Пика: плоский ромб с выемкой, смотрит вдоль хвоста и вверх.
  const tip = at(1);
  const dir = norm(add(sub(tip, at(0.92)), [0, 0, 0.9]));
  const perp = norm(cross(dir, [0, 1, 0.1]));
  const L = 5.4 * k;
  const Wd = 2.7 * k;
  const p0 = add(tip, mul(dir, -0.4 * k));
  const apex = add(tip, mul(dir, L));
  const wl = add(add(tip, mul(dir, L * 0.36)), mul(perp, -Wd));
  const wr = add(add(tip, mul(dir, L * 0.36)), mul(perp, Wd));
  const notchL = add(add(tip, mul(dir, -0.2 * k)), mul(perp, -0.9 * k));
  const notchR = add(add(tip, mul(dir, -0.2 * k)), mul(perp, 0.9 * k));
  flats.push({
    pts: [p0, notchL, wl, apex, wr, notchR],
    apex: p0,
    a: wl,
    b: wr,
    // Красная перепонка, как у туши: угольная с жилкой лавы читалась цифрой «1».
    pal: P_MEMB,
    id: nid(),
    shade: (u, r) =>
      0.16 -
      0.14 * r +
      (u < 0.5 ? 0.07 : -0.05) -
      (HI && Math.abs(u - 0.5) < 0.05 && r < 0.75 ? 0.12 : 0),
  });
}

function legs(out: Part[], c: Ctx): void {
  const { o, S } = c;
  const k = S.k;
  for (const side of [-1, 1] as const) {
    // Бедро: толстое, «штаны» сидящего зверя.
    const thigh = S.up([side * 7.0, 1.0, 5.4 - o.curl * 0.6]);
    cracked(
      pushP(out, {
        c: thigh,
        ax: axes(rollY([1, 0, 0], side * 0.25 + o.lean), [0, 0, 1]),
        r: [4.5 * k, 5.6 * k, 4.9 * k],
        pal: P_COAL,
        id: nid(),
        tex: HI ? scales(5, 3.2, 0.12) : undefined,
      }),
      side < 0
        ? [
            [
              [-0.3, 0.66],
              [-0.12, 0.5],
              [-0.22, 0.36],
              [-0.02, 0.22],
            ],
          ]
        : [
            [
              [0.32, 0.62],
              [0.14, 0.48],
              [0.26, 0.32],
              [0.1, 0.16],
            ],
            ...(HI
              ? ([
                  [
                    [0.26, 0.32],
                    [0.44, 0.26],
                  ],
                ] as Crack[])
              : []),
          ],
      10 + side,
    );
    // Задняя ступня с тремя пальцами и когтями.
    const foot = side < 0 ? S.footL : S.footR;
    const fid = nid();
    out.push({
      c: foot,
      ax: axes([1, 0, 0], [0, 0, 1]),
      r: [2.8 * k, 3.2 * k, 1.45 * k],
      pal: P_COAL,
      id: fid,
      bias: 0.02,
    });
    for (const a of [-0.55, 0, 0.55]) {
      const dir = norm([Math.sin(a) + side * 0.15, Math.cos(a), -0.05]);
      out.push({
        c: add(foot, mul(dir, 2.4 * k)),
        ax: axes(dir, [0, 0, 1]),
        r: [1.4 * k, 0.85 * k, 0.85 * k],
        pal: P_COAL,
        id: fid,
        bias: 0.05,
      });
      out.push({
        c: add(add(foot, mul(dir, 3.6 * k)), [0, 0, -0.2 * k]),
        ax: axes(norm(add(dir, [0, 0, -0.6])), [0, 0, 1]),
        r: [0.8 * k, 0.45 * k, 0.45 * k],
        pal: P_HORN,
        id: nid(),
        along: [0.5, 0.9],
        noSeam: true,
      });
    }
    // Передняя лапа: плечо → локоть → кисть на полу.
    const sh = side < 0 ? S.shoulderL : S.shoulderR;
    const paw = side < 0 ? S.pawL : S.pawR;
    const elbow = lerp3(
      S.up([side * 6.2, 4.6, 10.4]),
      add(paw, [side * 1.2 * k, -1.0 * k, 6 * k]),
      0.35,
    );
    const lid = nid();
    for (const [p, q, rr] of [
      [sh, elbow, 2.3],
      [elbow, paw, 1.75],
    ] as [V3, V3, number][]) {
      const d = sub(q, p);
      out.push({
        c: mul(add(p, q), 0.5),
        ax: axes(d, [0, 1, 0]),
        r: [Math.hypot(...d) * 0.5 + 0.6 * k, rr * k, rr * k],
        pal: P_COAL,
        id: lid,
        bias: 0.03,
      });
    }
    out.push({
      c: add(paw, [0, 0.3 * k, 0.3 * k]),
      ax: axes([1, 0, 0], [0, 0, 1]),
      r: [2.1 * k, 2.4 * k, 1.35 * k],
      pal: P_COAL,
      id: lid,
      bias: 0.05,
    });
    for (const a of [-0.5, 0, 0.5]) {
      const dir = norm([Math.sin(a), Math.cos(a), -0.1]);
      out.push({
        c: add(add(paw, mul(dir, 2.3 * k)), [0, 0, -0.1 * k]),
        ax: axes(norm(add(dir, [0, 0, -0.5])), [0, 0, 1]),
        r: [0.7 * k, 0.4 * k, 0.4 * k],
        pal: P_HORN,
        id: nid(),
        along: [0.5, 0.9],
        noSeam: true,
      });
    }
  }
}

function pushP(out: Part[], pt: Part): Part {
  out.push(pt);
  return pt;
}

function body(out: Part[], c: Ctx): void {
  const { o, S } = c;
  const k = S.k;
  const sq = o.sq;
  const ch = o.chest;
  const ax = axes(rollY([1, 0, 0], o.lean), pitchX([0, 0, 1], o.bow * 0.5));
  // Туловище грушей: плечи уже, бока и таз шире.
  cracked(
    pushP(out, {
      c: S.body,
      ax,
      r: [
        (8.0 + 0.5 * ch) * (1 + sq * 0.55) * k,
        (6.6 + 0.7 * ch) * (1 + sq * 0.4) * k,
        10.2 * (1 - sq) * k,
      ],
      pal: P_COAL,
      id: nid(),
      tex: HI ? scales(9, 5, 0.12) : undefined,
    }),
    [
      [
        [-0.42, 0.84],
        [-0.6, 0.64],
        [-0.52, 0.46],
        [-0.72, 0.28],
      ],
      [
        [-0.6, 0.64],
        [-0.8, 0.62],
      ],
      [
        [0.48, 0.8],
        [0.64, 0.58],
        [0.58, 0.38],
        [0.76, 0.16],
      ],
    ],
    20,
  );
  out.push({
    c: S.up([0, -0.8, 5.8]),
    ax,
    r: [9.4 * (1 + sq * 0.5) * k, 7.4 * k, 6.0 * (1 - sq) * k],
    pal: P_COAL,
    id: nid(),
    tex: HI ? scales(4, 5, 0.12) : undefined,
  });
  // Брюхо пластинами: выпирает вперёд, на вдохе — сильнее.
  out.push({
    c: S.up([0, 3.9 + 0.5 * ch, 10.8]),
    ax,
    r: [(5.4 + 0.45 * ch) * k, (3.4 + 0.55 * ch) * k, (9.2 + 0.3 * ch) * (1 - sq) * k],
    pal: P_BELLY,
    id: nid(),
    tex: plates(HI ? 9 : 4, 0.98),
    bias: -0.02,
  });
  // Шея: короткая, толстая; пластины горла продолжают брюхо.
  out.push({
    c: S.up([0, 1.6, 21.0]),
    ax,
    r: [5.2 * k, 4.8 * k, 4.6 * k],
    pal: P_COAL,
    id: nid(),
    tex: HI ? scales(4, 4, 0.12) : undefined,
  });
  out.push({
    c: S.up([0, 4.4, 20.2]),
    ax,
    r: [2.8 * k, 1.8 * k, 4.8 * k],
    pal: P_BELLY,
    id: nid(),
    tex: plates(HI ? 4 : 2, 0.98, 0.15),
    bias: -0.05,
  });
}

/** Точки рога в координатах головы (для правого; левый — зеркально). */
const HORN_PTS: V3[] = [
  [3.3, -0.8, 3.6],
  [5.1, -1.6, 5.9],
  [6.3, -2.4, 8.6],
  [6.0, -3.0, 11.4],
  [4.9, -3.2, 13.0],
];

function head(out: Part[], c: Ctx): void {
  const { o, h } = c;
  const k = h.k;
  const ex = h.dir([1, 0, 0]);
  const ey = h.dir([0, 1, 0]);
  const ez = h.dir([0, 0, 1]);
  const hax = axes(ex, ez);
  // Череп: широкий, плоский сверху.
  cracked(
    pushP(out, {
      c: h.at([0, 0, 0.2]),
      ax: hax,
      r: [6.3 * k, 5.4 * k, 5.0 * k],
      pal: P_COAL,
      id: nid(),
      bias: 0.05,
      tex: HI ? scales(6, 5, 0.12) : undefined,
    }),
    [
      [
        [0.18, 0.5],
        [0.3, 0.66],
        [0.22, 0.8],
        [0.34, 0.92],
      ],
      ...(HI
        ? ([
            [
              [-0.5, 0.62],
              [-0.62, 0.76],
            ],
          ] as Crack[])
        : []),
    ],
    30,
  );
  // Скулы-брыли: голова шире книзу.
  for (const side of [-1, 1]) {
    out.push({
      c: h.at([side * 4.5, 1.4, -1.9]),
      ax: hax,
      r: [2.8 * k, 3.0 * k, 2.7 * k],
      pal: P_COAL,
      id: nid(),
      bias: -0.02,
    });
  }
  // Надбровные дуги: строгость взгляду; во гневе круче.
  const slant = o.eye === 'angry' ? 0.6 : o.eye === 'wide' ? 0.1 : 0.32;
  for (const side of [-1, 1]) {
    out.push({
      c: h.at([side * 2.8, 4.1, 2.0 - (o.eye === 'angry' ? 0.3 : 0)]),
      ax: axes(h.dir(norm([1, 0, side * slant])), ey),
      r: [2.5 * k, 1.2 * k, 1.05 * k],
      pal: P_COAL,
      id: nid(),
      bias: 0.06,
      noSeam: true,
    });
  }
  // Переносица и морда-лопата.
  out.push({
    c: h.at([0, 3.8, 0.4]),
    ax: hax,
    r: [2.5 * k, 3.0 * k, 1.8 * k],
    pal: P_COAL,
    id: nid(),
    bias: 0.02,
  });
  const sid = nid();
  out.push({
    c: h.at([0, 5.1, -1.5]),
    ax: hax,
    r: [4.6 * k, 3.6 * k, 2.6 * k],
    pal: P_COAL,
    id: sid,
    bias: 0.12,
    tex: HI ? (qx, _qy, qz) => (qz > 0.55 && Math.abs(qx) < 0.5 ? 0.06 : 0) : undefined,
  });
  // Нижняя челюсть: поворачивается вниз от шарнира под ушами.
  const jw = o.jaw;
  const piv: V3 = [0, 0.4, -2.4];
  const jd = (p: V3): V3 => add(piv, pitchX(sub(p, piv), jw * 0.62));
  const jax = axes(h.dir(pitchX([1, 0, 0], jw * 0.62)), h.dir(pitchX([0, 0, 1], jw * 0.62)));
  out.push({
    c: h.at(jd([0, 4.2, -3.9])),
    ax: jax,
    r: [4.1 * k, 3.4 * k, 1.6 * k],
    pal: P_COAL,
    id: nid(),
    bias: -0.04,
  });
  // Подбородок пластинами брюха.
  out.push({
    c: h.at(jd([0, 4.3, -4.6])),
    ax: jax,
    r: [3.0 * k, 2.8 * k, 1.0 * k],
    pal: P_BELLY,
    id: nid(),
    bias: -0.12,
  });
  if (jw > 0.05) {
    // Пасть: тёмное нёбо, язык.
    out.push({
      c: h.at([0, 4.6, -2.9 - jw * 0.6]),
      ax: hax,
      r: [3.4 * k, 2.8 * k, (0.5 + jw * 1.1) * k],
      pal: P_MOUTH,
      id: nid(),
      bias: -0.15,
      noSeam: true,
    });
    out.push({
      c: h.at(jd([0, 4.8, -3.0])),
      ax: jax,
      r: [2.0 * k, 2.4 * k, 0.6 * k],
      pal: P_MOUTH,
      id: nid(),
      bias: 0.2,
      noSeam: true,
    });
  }
  // Клыки: два, из-под верхней губы вниз поверх нижней.
  for (const side of [-1, 1]) {
    out.push({
      c: h.at([side * 1.9, 7.2, -3.6]),
      ax: axes(h.dir([0, 0.15, -1]), ey),
      r: [(HI ? 1.1 : 1.15) * k, 0.5 * k, 0.5 * k],
      pal: P_HORN,
      id: nid(),
      along: [0.85, 0.55],
      noSeam: true,
    });
  }
  horns(out, c);
  frills(out, c);
  crest(out, c);
}

function horns(out: Part[], c: Ctx): void {
  const { h } = c;
  const k = h.k;
  for (const side of [-1, 1]) {
    const pts = HORN_PTS.map((p) => h.at([side * p[0], p[1], p[2]]));
    chain(
      out,
      (u) => catmull(pts, u),
      [1.7, 1.45, 1.15, 0.85, 0.55, 0.25].map((w) => w * k),
      [1.5, 1.3, 1.05, 0.8, 0.5, 0.25].map((w) => w * k),
      h.dir([0, 1, 0]),
      P_HORN,
      [0.3, 0.92],
      HI ? 10 : 6,
      { lit: 1, tex: HI ? (qx) => (Math.floor((qx + 1) * 2.2) & 1 ? -0.05 : 0) : undefined },
    );
    if (side < 0) crown(c, pts);
  }
}

/** Корона клада: где висит на левом роге (точка модели) и куда качнулась. */
let CROWN: { at: V3; swing: number } | null = null;
function crown(c: Ctx, pts: V3[]): void {
  const { lag, S, o } = c;
  // Маятник: отставание головы по x и поворот.
  const swing = (lag.headX - S.head[0]) * 0.35 + (lag.turn - o.turn) * 1.6 - o.tilt * 2;
  CROWN = { at: catmull(pts, 0.3), swing };
}

/** Корона рисуется значком поверх: так зубцы и камни читаются и на малой. */
const CROWN_S: string[] = ['a.b.c', 'abwbc', 'brbrd'];
const CROWN_L: string[] = [
  '.w..w..c.',
  '.a..b..c.',
  'aa.abc.cc',
  'aabbbbccd',
  'arbbrbcrd',
  'bbbccccdd',
];

function crownStamp(p: Px, f: Frame): void {
  if (!CROWN) return;
  const at = seen(f, mul(CROWN.at, RR), OX, OY, 3 * RR);
  if (!at) return;
  const g = PAL[P_GOLD];
  const pal: Record<string, RGBA> = {
    w: g[6],
    a: g[5],
    b: g[4],
    c: g[3],
    d: g[2],
    r: V === 2 ? hx('#3ad0ff') : hx('#e8283a'),
  };
  const rows = HI ? CROWN_L : CROWN_S;
  const tilt = Math.max(-1, Math.min(1, Math.round(CROWN.swing)));
  const W = rows[0].length;
  const H = rows.length;
  const x0 = at[0] - Math.floor(W / 2) - (HI ? 1 : 0);
  const y0 = at[1] - (HI ? 3 : 1);
  const mask = new Set<number>();
  const cells: [number, number, RGBA][] = [];
  for (let y = 0; y < H; y++) {
    const sh = Math.round(((tilt - 0.5) * (H - 1 - y)) / (HI ? 3 : 2));
    for (let x = 0; x < W; x++) {
      const col = pal[rows[y][x]];
      if (!col) continue;
      const X = x0 + x + sh;
      const Y = y0 + y;
      mask.add(Y * 4096 + X);
      cells.push([X, Y, col]);
    }
  }
  // Тёмная обводка короны: отделяет её от светлого рога.
  for (const [X, Y] of cells)
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const k = (Y + dy) * 4096 + X + dx;
      if (!mask.has(k)) {
        mask.add(k);
        p.set(X + dx, Y + dy, INK_V[V]);
      }
    }
  for (const [X, Y, col] of cells) p.set(X, Y, col);
}

/** «Уши»-жабры: веер из трёх косточек с перепонкой; трепещут от поворотов головы. */
const frillFlats: Flat[] = [];
function frills(out: Part[], c: Ctx): void {
  const { h, o, lag } = c;
  const k = h.k;
  const flut = (o.turn - lag.turn) * 1.4 + (c.S.head[2] - lag.headZ) * 0.15;
  for (const side of [-1, 1] as const) {
    const root = h.at([side * 5.6, -0.4, -0.4]);
    const dirs: V3[] = [
      [side * 1, -0.4, 0.95 + flut * 0.6],
      [side * 1, -0.35, 0.3 + flut * 0.4],
      [side * 0.95, -0.25, -0.3 + flut * 0.25],
    ];
    const lens = [4.4, 4.8, 3.6];
    const tips = dirs.map((d, j) => h.at(add([side * 5.6, -0.4, -0.4], mul(norm(d), lens[j]))));
    for (const tp of tips) {
      chain(
        out,
        (u) => lerp3(root, tp, u),
        [0.5 * k, 0.32 * k, 0.2 * k],
        0.4 * k,
        h.dir([0, 1, 0]),
        P_COAL,
        null,
        3,
        { lit: 1, bias: 0.12 },
      );
    }
    const back = mul(VIEW, -0.4 * k);
    for (let j = 0; j < 2; j++)
      frillFlats.push({
        pts: [root, tips[j], ...sag(tips[j], tips[j + 1], root, 0.22, 5), tips[j + 1]].map((p) =>
          add(p, back),
        ),
        apex: add(root, back),
        a: add(tips[j], back),
        b: add(tips[j + 1], back),
        pal: P_MEMB,
        id: nid(),
        shade: (u, r) => membShade(u, r) + 0.14,
      });
  }
}

/** Гребень: шипы на макушке между рогами. */
function crest(out: Part[], c: Ctx): void {
  const { h } = c;
  const k = h.k;
  const sp: [number, number, number, number][] = HI
    ? [
        [0, -0.4, 5.0, 2.4],
        [0, -2.6, 4.6, 2.0],
        [0, -4.4, 3.6, 1.6],
      ]
    : [
        [0, -0.6, 5.0, 2.2],
        [0, -3.0, 4.4, 1.7],
      ];
  for (const [x, y, z, L] of sp) {
    const base = h.at([x, y, z]);
    const d = h.dir(norm([0, -0.35, 1]));
    out.push({
      c: add(base, mul(d, L * 0.45 * k)),
      ax: axes(d, h.dir([0, 1, 0])),
      r: [L * 0.6 * k, 0.75 * k, 0.6 * k],
      pal: P_HORN,
      id: nid(),
      along: [0.25, 0.75],
      noSeam: true,
    });
  }
}

// ---------------------------------------------------------------------------
// Камень, самородок, огонь.
// ---------------------------------------------------------------------------

/** Палитра камня: серый → тёмно-красный → алый → белый; плавка — в жидкое золото. */
function stonePal(heat: number, melt: number): RGBA[] {
  return STONE.map((col, i) => {
    const u = i / (STONE.length - 1);
    let cc = col;
    const h1 = clamp01(heat / 0.55);
    const h2 = clamp01((heat - 0.55) / 0.5);
    const h3 = clamp01((heat - 1.05) / 0.3);
    cc = mixc(cc, LAVA0[Math.min(7, 1 + Math.round(u * 3))], h1 * 0.85);
    cc = mixc(cc, LAVA0[Math.min(7, 3 + Math.round(u * 3))], h2);
    cc = mixc(cc, LAVA0[Math.min(7, 6 + Math.round(u))], h3);
    // Плавка: к жидкому золоту, остывает в самородок.
    const g = GOLD0[Math.min(6, Math.round(u * 6))];
    cc = mixc(cc, g, clamp01(melt * 1.4) * clamp01(1 - heat * 0.6 + melt * 0.6));
    return cc;
  });
}

function stoneParts(out: Part[], c: Ctx): void {
  const { o } = c;
  if (o.stone <= 0) return;
  const m = o.melt;
  const S = STONE_AT;
  // Камень (m = 0) → оплывший жидкий ком (m = 0,5) → самородок из трёх комков (m = 1).
  const sk = m >= 1 ? o.nugK : 1;
  if (sk <= 0.02) return;
  const zz = o.stoneZ + (m >= 1 ? o.nugZ : 0);
  const sag = bump(m, 0, 1);
  const nug = clamp01((m - 0.5) / 0.5);
  const lumps: [V3, V3, V3][] = [
    // центр, радиусы камня, радиусы самородка
    [
      [0, 0, 2.5],
      [3.3, 2.9, 2.6],
      [2.5, 2.2, 1.8],
    ],
    [
      [-1.5, 0.4, 4.6],
      [2.0, 1.8, 1.5],
      [1.6, 1.4, 1.3],
    ],
    [
      [1.6, 0.6, 1.4],
      [1.5, 1.4, 1.2],
      [1.3, 1.2, 1.0],
    ],
  ];
  lumps.forEach(([cc, rs, rn], j) => {
    const r = lerp3(rs, rn, nug);
    const flat = 1 - 0.45 * sag;
    out.push({
      c: [
        S[0] + cc[0] * (1 + 0.3 * sag) * sk,
        S[1] + cc[1],
        (cc[2] * lerp(1, 0.8, nug) * flat + zz) * sk + (m >= 1 ? 0 : 0),
      ],
      ax: axes([1, 0, 0.12 * (1 - m) * (j ? -1 : 1)], [0, 0, 1]),
      r: [r[0] * (1 + 0.3 * sag) * sk, r[1] * (1 + 0.15 * sag) * sk, r[2] * flat * sk],
      pal: P_STONE,
      id: nid(),
      bias: nug * 0.06,
      tex:
        m < 0.4
          ? (qx, qy, qz) =>
              Math.sin(qx * 4.2 + qz * 2.6 + qy + j) > 0.72 ? -0.14 : qz > 0.6 ? 0.08 : 0
          : (qx, _qy, qz) => (qz > 0.45 && qx < 0.1 ? 0.16 : qz < -0.4 ? -0.1 : 0),
    });
  });
  if (sag > 0.15) {
    // Лужица расплава под комом.
    out.push({
      c: [S[0], S[1] + 0.6, 0.35],
      ax: axes([1, 0, 0], [0, 0, 1]),
      r: [4.6 * sag, 3.4 * sag, 0.45],
      pal: P_STONE,
      id: nid(),
      bias: 0.1,
    });
  }
}

/** Струя огня из пасти на камень: от белого у пасти к рыжему у камня, волной. */
function jetParts(out: Part[], c: Ctx): void {
  const { o, h } = c;
  if (o.jet <= 0.01) return;
  const mouth = h.at([0, 8.4, -3.6]);
  const target: V3 = [STONE_AT[0] + 1.6, STONE_AT[1] - 1.5, 5.0];
  const ctrl = add(lerp3(mouth, target, 0.5), [0, 1.5, 2.2]);
  const n = HI ? 16 : 11;
  const len = o.jet;
  for (let i = 0; i < n; i++) {
    const u = (i / (n - 1)) * len;
    const p = bezQ(mouth, ctrl, target, u);
    const fl = flick(c.tau * 3, 300 + i);
    const r = (0.9 + 2.0 * u) * (1 + 0.15 * fl);
    const wob: V3 = [0, 0, Math.sin(u * 9 - c.tau * 40) * 0.5 * u];
    out.push({
      c: add(p, wob),
      ax: axes(sub(target, mouth), [0, 0, 1]),
      r: [r * 1.2, r * 0.9, r * 0.8],
      pal: P_LAVA,
      id: 900,
      along: [0.95 - u * 0.4, 0.95 - u * 0.4],
      lit: 0.2,
      noSeam: true,
    });
  }
  if (len > 0.9) {
    // Пламя облизывает камень.
    for (let j = 0; j < 3; j++) {
      const s = j - 1;
      const fl = flick(c.tau * 2, 340 + j);
      const base: V3 = [STONE_AT[0] + s * 2.4, STONE_AT[1] - 2.2, 3.0];
      const top = add(base, [s * 1.2 + fl * 0.9, 0, 4.5 + fl * 1.0 - Math.abs(s) * 1.2]);
      chain(
        out,
        (u) => bezQ(base, add(lerp3(base, top, 0.5), [-fl * 0.6, 0, 0]), top, u),
        [1.4, 1.6, 1.0, 0.3],
        1.0,
        [0, 1, 0],
        P_LAVA,
        [0.55, 0.95],
        5,
        { id: 901, lit: 0.2, noSeam: true },
      );
    }
  }
}

/** Вспышка огня в атаке: веер языков из-под нижней челюсти вниз и в стороны, к зрителю; пасть видна. */
function burstParts(out: Part[], c: Ctx): void {
  const { o, h } = c;
  if (o.burst <= 0.01) return;
  const b = o.burst;
  const root = h.at([0, 9.6, -6.0]);
  const n = HI ? 7 : 5;
  for (let j = 0; j < n; j++) {
    const q = j / (n - 1) - 0.5;
    const fl = flick(c.tau * 3, 400 + j);
    const ang = q * 2.4;
    const d = norm([Math.sin(ang) * 1.1, 0.75, -Math.cos(ang) * 0.9]);
    const L = (11 - Math.abs(q) * 5) * b * (1 + 0.12 * fl);
    const tip = add(root, mul(d, L));
    const mid = add(add(root, mul(d, L * 0.5)), [fl * 0.8, 0, 0.4]);
    chain(
      out,
      (u) => bezQ(root, mid, tip, u),
      [1.0, 2.2, 2.4, 1.6, 0.5].map((w) => w * (1 - Math.abs(q) * 0.4)),
      1.6,
      [0, 1, 0],
      P_LAVA,
      [0.97, 0.45],
      6,
      { id: 902, lit: 0.15, noSeam: true },
    );
  }
}

// ---------------------------------------------------------------------------
// Плоские части в кадр, трещины, радуга.
// ---------------------------------------------------------------------------

function drawFlats(f: Frame, flats: Flat[]): void {
  const { w, h, zb } = f;
  for (const fl of flats) {
    const P = fl.pts.map((p) => project(mul(p, RR)));
    const [ax, ay, ad] = project(mul(fl.apex, RR));
    const [bx1, by1, bd1] = project(mul(fl.a, RR));
    const [bx2, by2, bd2] = project(mul(fl.b, RR));
    // Глубина по плоскости через вершину и две точки кромки.
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
        const vt = fl.vein ? fl.vein(u, r) : -1;
        if (vt >= 0) {
          f.pal[i] = P_LAVA;
          f.tone[i] = -100 - fl.id; // трещина-жилка: накал задаст проход трещин
          continue;
        }
        f.pal[i] = fl.pal;
        f.tone[i] = Math.max(0, Math.min(N - 1, Math.round((base + fl.shade(u, r)) * (N - 1))));
      }
    }
  }
}

/** Точка модели (в пикселях полосы) за пикселем кадра. */
function worldAt(f: Frame, x: number, y: number): V3 {
  const sx = x + 0.5 - OX;
  const sy = y + 0.5 - OY;
  const t = f.zb[y * f.w + x];
  return [sx, sy * SE + t * CE, -sy * CE + t * SE];
}

/** Трещины лавы: пиксели части у ломаной — лава, вокруг (на крупной) — тёплый уголь. */
function lavaCracks(f: Frame, c: Ctx): void {
  const { w, h, pal, tone, idb } = f;
  const g = c.o.glow;
  const halo = HI ? 1.9 : g > 1.6 ? 1.15 : 0;
  const core = HI ? 0.62 : 0.5;
  const lt = PAL[P_LAVA].length - 1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      // Жилка пики хвоста: накал как у трещин.
      if (pal[i] === P_LAVA && tone[i] <= -100) {
        const gl = g * (0.66 + 0.2 * flick(c.tau, 77));
        tone[i] = Math.max(1, Math.min(lt, Math.round(1.6 + gl * 3.6)));
        continue;
      }
      if (pal[i] !== P_COAL) continue;
      const cs = CRK.get(idb[i]);
      if (!cs) continue;
      const W = worldAt(f, x, y);
      const cc = mul(cs.c, RR);
      const d = sub(W, cc);
      const [e1, e2, e3] = cs.ax;
      const r1 = cs.r[0] * RR;
      const r3 = cs.r[2] * RR;
      const qx = dot(d, e1) / r1;
      const qy = dot(d, e2) / (cs.r[1] * RR);
      const qz = dot(d, e3) / r3;
      if (qy < -0.1) continue;
      let best = 1e9;
      let bestLine = 0;
      let bestS = 0;
      cs.lines.forEach((ln, li) => {
        for (let s = 0; s + 1 < ln.length; s++) {
          const [ax0, az0] = ln[s];
          const [ax1, az1] = ln[s + 1];
          const vx = (ax1 - ax0) * r1;
          const vz = (az1 - az0) * r3;
          const px = (qx - ax0) * r1;
          const pz = (qz - az0) * r3;
          const L2 = vx * vx + vz * vz || 1;
          const tt = clamp01((px * vx + pz * vz) / L2);
          const dd = Math.hypot(px - vx * tt, pz - vz * tt);
          if (dd < best) {
            best = dd;
            bestLine = li;
            bestS = (s + tt) / (ln.length - 1);
          }
        }
      });
      const fl = flick(c.tau, cs.seed * 7 + bestLine);
      const gl = g * (0.62 + 0.24 * fl) * (0.8 + 0.2 * Math.sin(Math.PI * bestS));
      if (best < core) {
        pal[i] = P_LAVA;
        tone[i] = Math.max(1, Math.min(lt, Math.round(1.4 + gl * 3.9)));
      } else if (best < halo) {
        pal[i] = P_WARM;
        const wn = PAL[P_WARM].length - 1;
        tone[i] = Math.max(
          0,
          Math.min(wn, Math.round(tone[i] * 0.35 + gl * 1.6 - (best - core) * 0.6)),
        );
      }
    }
}

/** Мягкие переходы на крупной: редкая шахматка на стыке ступеней угля и брюха. */
function softBands(f: Frame): void {
  const { w, h, pal, tone, idb } = f;
  const hit: number[] = [];
  for (let y = 0; y < h - 1; y++)
    for (let x = 0; x < w - 1; x++) {
      const i = y * w + x;
      const pl = pal[i];
      if (pl !== P_COAL && pl !== P_BELLY && pl !== P_MEMB) continue;
      for (const j of [i + w, i + 1]) {
        if (pal[j] === pl && idb[j] === idb[i] && tone[j] === tone[i] - 1 && dith(x, y, 0.28))
          hit.push(j, tone[i]);
      }
    }
  for (let n = 0; n < hit.length; n += 2) f.tone[hit[n]] = hit[n + 1];
}

function hsl(hh: number, s: number, l: number): RGBA {
  const h6 = (((hh % 1) + 1) % 1) * 6;
  const cch = (1 - Math.abs(2 * l - 1)) * s;
  const xx = cch * (1 - Math.abs((h6 % 2) - 1));
  const m = l - cch / 2;
  const [r, g, b] =
    h6 < 1
      ? [cch, xx, 0]
      : h6 < 2
        ? [xx, cch, 0]
        : h6 < 3
          ? [0, cch, xx]
          : h6 < 4
            ? [0, xx, cch]
            : h6 < 5
              ? [xx, 0, cch]
              : [cch, 0, xx];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255), 255];
}

/** Радужный: оттенок от точки модели (голова алая → грудь золотая и зелёная → лапы синие и лиловые). */
function rainbow(p: Px, f: Frame, o: Pose): void {
  const { w, h, pal, tone } = f;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const pl = pal[i];
      if (pl < 0 || pl === P_STONE || pl === P_MOUTH || pl === P_GOLD) continue;
      // Пламя (струя, языки у камня, вспышка атаки) остаётся огнём — розовое пятно читалось брюхом.
      // (части пламени без шва — в буфере номер −2).
      if (pl === P_LAVA && f.idb[i] === -2) continue;
      const W = mul(worldAt(f, x, y), 1 / RR);
      const hz = (W[2] - o.z) / G;
      const hxx = (W[0] - o.x) / G;
      // Оттенок ступенями (14 на круг): радуга лентами, как в пиксельной палитре, и полоса легче.
      const hue = Math.round((0.0 + (29 - hz) * 0.025 + hxx * 0.004) * 14) / 14;
      const u = tone[i] / (PAL[pl].length - 1);
      let col: RGBA;
      if (pl === P_COAL) col = hsl(hue, 0.78, 0.17 + u * 0.5);
      else if (pl === P_MEMB) col = hsl(hue + 0.08, 0.85, 0.24 + u * 0.48);
      else if (pl === P_BELLY) col = hsl(hue + 0.04, 0.7, 0.5 + u * 0.42);
      else if (pl === P_HORN) col = hsl(hue + 0.5, 0.35, 0.55 + u * 0.42);
      else if (pl === P_WARM) col = hsl(hue + 0.15, 0.85, 0.3 + u * 0.2);
      else col = hsl(hue + 0.45, 0.9, 0.55 + u * 0.42);
      p.set(x, y, col);
    }
}

// ---------------------------------------------------------------------------
// Глаза, ноздри, дым, угольки, звёзды.
// ---------------------------------------------------------------------------

function eyePal(): Record<string, RGBA> {
  const iris = V === 1 ? ramp('#5a0a08', '#a01810', '#e03a1c', '#ff7a40', '#ffc090') : null;
  const g = PAL[P_GOLD];
  return {
    K: INK_V[V],
    W: hx('#fffbe6'),
    o: PAL[P_COAL][0],
    a: iris ? iris[4] : g[5],
    b: iris ? iris[3] : g[4],
    c: iris ? iris[2] : g[3],
    d: iris ? iris[1] : g[2],
    l: PAL[P_HORN][4],
  };
}
// Малая: глаз 3×3 — золото, вертикальный зрачок, блик (голова ~14 пикселей).
const EYES_S: Record<string, string[]> = {
  open: ['aKW', 'bKb', 'cKc'],
  half: ['ooo', 'bKb', 'cKc'],
  shut: ['...', 'lll', '...'],
  wide: ['aKW', 'bKb', 'cKc'],
  happy: ['.l.', 'l.l', '...'],
  sleep: ['...', 'l.l', '.l.'],
  angry: ['oo.', 'bKW', 'cKc'],
};
// Крупная: глаз 6×5 — тёмный ободок, радужка светлее книзу, щель зрачка, блик.
const EYES_L: Record<string, string[]> = {
  // 7×6: зрачок по центру, радужка в три ступени — глаз держит морду, как у туши.
  open: ['.ooooo.', 'obbKWbo', 'oaaKaao', 'oaaKaao', 'occKcco', '.oddoo.'],
  wide: ['.ooooo.', 'obbKWbo', 'oaaKaao', 'oaaKaao', 'oaaKaao', '.occco.'],
  half: ['.......', 'ooooooo', 'oaaKaao', 'oaaKaao', 'occKcco', '.oddoo.'],
  shut: ['.......', '.......', 'ollllll', '.ooooo.', '.......', '.......'],
  happy: ['.......', '.lllll.', 'lo...ol', 'o.....o', '.......', '.......'],
  sleep: ['.......', '.......', 'o.....o', 'lo...ol', '.lllll.', '.ooooo.'],
  angry: ['ooo....', 'ooooooo', 'obbKWbo', 'oaaKaao', 'occKcco', '.ooooo.'],
};

function eyes(p: Px, f: Frame, c: Ctx): void {
  const { o, h } = c;
  const ep = eyePal();
  for (const side of [-1, 1] as const) {
    const at = seen(f, mul(h.at([side * 2.75, 4.4, 0.7]), RR), OX, OY, 2.4 * RR);
    if (!at) continue;
    let key: string = o.eye;
    if (key === 'open' || key === 'angry' || key === 'wide') {
      if (o.blink > 0.75) key = 'shut';
      else if (o.blink > 0.3) key = 'half';
    }
    const flip = side > 0;
    if (HI) stamp(p, EYES_L[key], ep, at[0] - 3, at[1] - 2, flip);
    else stamp(p, EYES_S[key], ep, at[0] - 1, at[1] - 1, flip);
  }
  // Ноздри: тёмные, на вдохе внутри тлеет.
  const lava = PAL[P_LAVA];
  for (const side of [-1, 1]) {
    const at = seen(f, mul(h.at([side * 1.45, 7.9, 0.6]), RR), OX, OY, 1.8 * RR);
    if (!at) continue;
    const hot = o.glow > 1.5 || o.jet > 0.1;
    if (HI) {
      p.set(at[0], at[1], INK_V[V]);
      p.set(at[0] + side, at[1], INK_V[V]);
      p.set(at[0], at[1] + 1, hot ? lava[5] : PAL[P_COAL][1]);
    } else {
      p.set(at[0], at[1], hot ? lava[4] : INK_V[V]);
    }
  }
}

/** Дымок из ноздрей: клубы на выдохе уходят вверх и в стороны, тают шахматкой. */
function smoke(p: Px, c: Ctx, amt: number): void {
  if (amt <= 0.02) return;
  const { h } = c;
  const n = c.o.curl > 0.5 ? 2 : 3;
  // Выше ноздрей дым идёт ЗА головой: поверх морды он закрывал глаза.
  const body = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < p.w && y < p.h && p.data[(y * p.w + x) * 4 + 3] > 0;
  const mask = new Uint8Array(p.w * p.h);
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) mask[y * p.w + x] = body(x, y) ? 1 : 0;
  for (const side of [-1, 1]) {
    const nose = h.at([side * 1.45, 8.2, 0.4]);
    for (let j = 0; j < n; j++) {
      const born = (j / n + (side > 0 ? 0.17 : 0)) * PER;
      const life = PER * (c.o.curl > 0.5 ? 0.55 : 0.45);
      const age = wrap(c.tau - born, PER);
      if (age > life) continue;
      const u = age / life;
      const pt: V3 = add(nose, [
        side * (1.6 + 6.5 * u) + Math.sin(u * 5 + j) * 0.6,
        0.5,
        1.6 + 9.5 * u - 2 * u * u,
      ]);
      const [sx, sy] = project(mul(pt, RR));
      const cx = OX + sx;
      const cy = OY + sy;
      // Клуб растёт и светлеет к краю силуэта головы: серый на сером не читался (2–6 пикселей на малой).
      const rad = (1.0 + 2.1 * u) * RR * (HI ? 0.85 : 1);
      const dens = amt * (1 - 0.85 * u);
      const tone = Math.max(0, Math.min(4, Math.round(4.2 - u * 2.6)));
      for (let y = Math.floor(cy - rad); y <= Math.ceil(cy + rad); y++)
        for (let x = Math.floor(cx - rad); x <= Math.ceil(cx + rad); x++) {
          const dd = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / rad;
          if (dd > 1) continue;
          if (!dith(x, y, dens * (1.1 - dd * 0.6))) continue;
          if (u > 0.16 && x >= 0 && y >= 0 && x < p.w && y < p.h && mask[y * p.w + x]) continue;
          p.set(x, y, SMOKE[dd < 0.5 ? tone : Math.max(0, tone - 1)]);
        }
    }
  }
}

/** Угольки: рождаются по расписанию петли, летят вверх, гаснут ступенями лавы. */
function embers(
  p: Px,
  c: Ctx,
  n: number,
  life: number,
  origin: (j: number) => V3,
  rise = 10,
): void {
  const lava = PAL[P_LAVA];
  for (let j = 0; j < n; j++) {
    const born = ((j / n) * FLICK_T + hash(j, 3, 9) * 0.3) * (PER / FLICK_T);
    const age = wrap(c.tau - born, PER);
    if (age > life) continue;
    const u = age / life;
    const o = origin(j);
    const drift = Math.sin(u * 5 + j) * 1.3;
    const pt: V3 = add(o, [drift + (hash(j, 5, 1) - 0.5) * 3 * u, 0, rise * u + 1.5 * u * u]);
    const [sx, sy] = project(mul(pt, RR));
    const x = Math.floor(OX + sx);
    const y = Math.floor(OY + sy);
    p.set(x, y, lava[Math.max(2, Math.round(7 - u * 5))]);
    if (HI && u < 0.35) p.set(x, y + 1, lava[Math.max(1, Math.round(4 - u * 5))]);
  }
}

/** Звезда-блик: крест из пикселей, длина лучей 1…3. */
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
  const env = LOOP[a] ? 1 : clamp01((T - t) / 0.18);
  // Разовая к концу приходит не в чистую позу, а в запаздывание покоя на кадре 0: стык без сдвига.
  const L0 = LOOP[a] ? null : lagOf('idle', 0);
  const P0 = poseAt('idle', 0);
  const S0 = skel(P0);
  const lagged = (fn: (tt: number) => number, freq: number, damp: number, off: number) => {
    const now = fn(t);
    return now + (spring(fn, t, t0, freq, damp) - now) * env + (L0 ? off * (1 - env) : 0);
  };
  const r: Lag = {
    headX: lagged((tt) => sk(tt).head[0], 3.0, 0.3, (L0?.headX ?? 0) - S0.head[0]),
    headZ: lagged((tt) => sk(tt).head[2], 3.0, 0.3, (L0?.headZ ?? 0) - S0.head[2]),
    thL: lagged((tt) => P(tt).thL, 3.6, 0.34, (L0?.thL ?? 0) - P0.thL),
    thR: lagged((tt) => P(tt).thR, 3.6, 0.34, (L0?.thR ?? 0) - P0.thR),
    tailX: lagged((tt) => sk(tt).body[0], 1.6, 0.24, (L0?.tailX ?? 0) - S0.body[0]),
    tailZ: lagged((tt) => sk(tt).body[2], 1.7, 0.26, (L0?.tailZ ?? 0) - S0.body[2]),
    turn: lagged((tt) => P(tt).turn, 2.6, 0.22, (L0?.turn ?? 0) - P0.turn),
  };
  LAGS.set(key, r);
  return r;
}

function toRes(parts: Part[]): Part[] {
  if (RR === 1) return parts;
  return parts.map((pt) => ({ ...pt, c: mul(pt.c, RR), r: mul(pt.r, RR) }));
}

/** Кадр `i` анимации `a` полосы `res`, вариант окраса `v` (0 — обычный, 1 — золотой, 2 — радужный). */
export function dragonFrame(a: Anim, i: number, res: Res = 's', v = 0): Px {
  const cv = RES[res];
  RR = cv.box / RES.s.box;
  HI = res === 'l';
  OX = cv.bx + cv.box / 2;
  OY = cv.by + GROUND * RR;
  V = v;
  NEXT_ID = 0;
  CRK.clear();
  frillFlats.length = 0;
  CROWN = null;
  const T = dur(a);
  const t = i / FPS;
  const o = poseAt(a, t);
  const S = skel(o);
  PER = a === 'walk' ? T : FLICK_T;
  const tau = LOOP[a] ? t : wrap(t - T, FLICK_T);
  const c: Ctx = { o, S, h: headF(o, S), lag: lagOf(a, t), tau };
  PAL = PAL_V[v].slice();
  PAL[P_STONE] = stonePal(o.heat, o.melt);
  const f = newFrame(cv.cw, cv.ch);
  const parts: Part[] = [];
  const flats: Flat[] = [];
  tail(parts, flats, c);
  legs(parts, c);
  body(parts, c);
  head(parts, c);
  wing(parts, flats, c, -1);
  wing(parts, flats, c, 1);
  stoneParts(parts, c);
  // Уголь темнее общего света рига: блики остаются только на верхних кромках.
  for (const pt of parts) if (pt.pal === P_COAL) pt.bias = (pt.bias ?? 0) - COAL_DARK;
  drawParts(f, toRes(parts), PAL, OX, OY);
  drawFlats(f, flats);
  drawFlats(f, frillFlats);
  const fx: Part[] = [];
  jetParts(fx, c);
  burstParts(fx, c);
  if (fx.length) drawParts(f, toRes(fx), PAL, OX, OY);
  lavaCracks(f, c);
  seams(f, 1.4 * RR, 1);
  rimLight(f, PAL, (pl) => pl !== P_LAVA && pl !== P_WARM && pl !== P_MOUTH);
  // Отсвет снизу-справа по углю: тёмный силуэт не тонет в тёмном фоне.
  rimLight(f, PAL, (pl) => pl === P_COAL, 'br');
  if (HI) softBands(f);
  const p = toPx(f, PAL);
  if (v === 2) rainbow(p, f, o);
  selOutline(p, INK_V[v], 0.8);
  eyes(p, f, c);
  crownStamp(p, f);
  smoke(p, c, o.smoke);
  // Угольки: с плеч и спины, гуще при накале.
  const lava = PAL[P_LAVA];
  const nsp = a === 'sleep' ? 1 : a === 'walk' ? 2 : 3;
  embers(p, c, nsp, 0.9, (j) =>
    add(S.body, [((j % 3) - 1) * 6 * S.k, -2, (6 + (j % 2) * 3) * S.k]),
  );
  // Камень раскалён — искры с него.
  if (o.heat > 0.4 && o.stone > 0)
    embers(
      p,
      { ...c, tau: c.tau * 2 },
      5,
      0.5,
      (j) => [STONE_AT[0] + ((j % 3) - 1) * 2, STONE_AT[1], 3],
      8,
    );
  // Самородок блестит; дракон сияет — звёзды вокруг.
  const gold = PAL[P_GOLD];
  if (o.melt >= 1 && o.nugK > 0) {
    const tw = Math.max(bump(t, 1.44, 1.62), bump(t, 1.64, 1.8), bump(t, 1.82, 1.96));
    if (tw > 0.2) {
      const [sx, sy] = project(mul([STONE_AT[0] - 1.2, STONE_AT[1], 4.4 + o.nugZ], RR));
      star(
        p,
        Math.floor(OX + sx),
        Math.floor(OY + sy),
        Math.round(tw * (HI ? 3 : 2)),
        gold[6],
        gold[4],
      );
    }
  }
  if (o.shine > 0.05) {
    for (let j = 0; j < 6; j++) {
      const ph = wrap(t * 2.2 + j / 6, 1);
      const L = Math.round(bump(ph, 0, 1) * o.shine * (HI ? 3 : 1.6));
      if (L < 1) continue;
      const ang = j * 1.047 + 0.4;
      const pt: V3 = add(S.body, [Math.cos(ang) * 17 * S.k, 4, 12 + Math.sin(ang) * 13 * S.k]);
      const [sx, sy] = project(mul(pt, RR));
      star(p, Math.floor(OX + sx), Math.floor(OY + sy), L, gold[6], lava[5]);
    }
  }
  return p;
}
