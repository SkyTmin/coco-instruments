// Феникс свободы — пиксельный питомец по эталону боссов 12–14.
//
// Огненная птица анфас: багровое тело, рыже-золотая грудь чешуйками перьев,
// золотой крючковатый клюв, гордые золотые глаза с золотым штрихом от
// уголка, хохолок из пяти перьев-языков, сложенные крылья с маховыми,
// четыре длинных пера хвоста по бокам, на правой лапе — железный браслет
// сломанных кандалов с обрывком цепи. Огонь — форма самих перьев с
// переходом цвета от багрянца к белому кончику, а не факелы на кончиках.
//
// Анимации 24 к/с, каждая — дорожка ключей (`kf`): подготовка → разгон →
// пик → проводка → отдача → возврат. Хохолок, маховые, хвост и цепь — те
// же ключи с запаздыванием (`spring` от позы ведущей части), а не своя
// анимация. Пламя перьев мерцает в своей фазе у каждого пера; у разовых
// анимаций часы пламени сведены так, что последний кадр стыкуется с
// первым кадром покоя.

import type { Px } from '../dungeon-art';
import {
  add,
  axes,
  AX0,
  bezQ,
  bump,
  clamp01,
  dith,
  drawParts,
  hash,
  hx,
  kf,
  lerp,
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
  wrap,
} from './rig';
import type { Frame, Key, Part, RGBA, V3 } from './rig';

// ---------------------------------------------------------------------------
// Палитра: тень → блик, тени уходят в лиловый, блики — в жёлтый.
// ---------------------------------------------------------------------------

const P_BODY = 0;
const P_BELLY = 1;
const P_GOLD = 2;
const P_FIRE = 3;
const P_IRON = 4;
const P_EMBER = 5;
const P_ASH = 6;
const PALS: RGBA[][] = [
  ramp('#3a0a1f', '#661228', '#981a2c', '#c82b2e', '#e8523a', '#fb8a4e'),
  ramp('#7c2416', '#b44a1c', '#e27c28', '#f6ae40', '#ffd878', '#fff1b8'),
  ramp('#4e260a', '#8a5012', '#c88a24', '#eebf44', '#fde68c', '#fffbe0'),
  ramp('#4c0a1c', '#86121f', '#c42c1f', '#ec5e1a', '#ff9324', '#ffc63c', '#ffe98a', '#fffbe6'),
  ramp('#1c1f26', '#343a44', '#535c68', '#7d8894', '#b4bec8'),
  ramp('#1a0a0e', '#3a1214', '#6a1a14', '#b8361a', '#ff7a1e', '#ffd040'),
  ramp('#2a2426', '#4a4244', '#706668', '#9c9294'),
];
const INK = hx('#1a0610');
const WHITE = hx('#fffbe6');
const FIRE = PALS[P_FIRE];
const GOLD = PALS[P_GOLD];

// ---------------------------------------------------------------------------
// Кадр: холст и рамка тела.
// ---------------------------------------------------------------------------

/** Рамка тела (сторона квадрата в пикселях рисунка): по ней игра ставит питомца. */
export const BOX = 48;
/** Холст кадра: рамка тела в середине, вокруг — место для крыльев, прыжка и пламени. */
export const CW = 112;
export const CH = 96;
/** Левый верхний угол рамки тела на холсте. */
export const BX = (CW - BOX) / 2;
export const BY = 34;
/** Начало модели (земля под серединой) на холсте. */
const OX = BX + BOX / 2;
const OY = BY + 45;

export type Anim = 'idle' | 'walk' | 'happy' | 'work' | 'attack' | 'sleep';
export const FPS = 24;
/** Кадров на анимацию. Длительности близки к прежним (покой 3 с, ходьба 1, радость 1,1, трюк 2, атака 0,9, сон 3). */
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
/** Период мерцания пламени — длина покоя: разовая анимация кончается там, где покой начинается. */
const FLICK_T = dur('idle');

// ---------------------------------------------------------------------------
// Поза.
// ---------------------------------------------------------------------------

type Eye = 'open' | 'happy' | 'angry' | 'sleep';

interface Pose {
  /** Сдвиг вбок и подъём от земли (прыжок). */
  x: number;
  z: number;
  /** Сжатие (+) и вытяжение (−). */
  sq: number;
  /** Крен вбок (+ — к правому краю), наклон к зрителю (+). */
  lean: number;
  bow: number;
  /** Голова: сдвиг, поворот (+ вправо), кивок (+ вниз), наклон набок. */
  hx: number;
  hz: number;
  turn: number;
  nod: number;
  tilt: number;
  /** Хохолок: 0 — как есть, 1 — распушён, −1 — опущен. */
  crest: number;
  /** Крылья: угол от «вниз» наружу, веер маховых, обхват к груди (0…1). Левое/правое по кадру. */
  thL: number;
  thR: number;
  fanL: number;
  fanR: number;
  hugL: number;
  hugR: number;
  /** Хвост: подъём кончиков и раскрытие веера. */
  tailUp: number;
  tailFan: number;
  /** Лапы: сдвиг и подъём ступни (по кадру левая и правая). */
  fLx: number;
  fLz: number;
  fRx: number;
  fRz: number;
  eye: Eye;
  /** Моргание 0…1 (1 — закрыт). */
  blink: number;
  beak: number;
  /** Пламя перьев: 0 — угли, 1 — как всегда, 1,6 — вспышка. */
  fire: number;
  /** Трюк: тело охвачено огнём (0…1), масштаб птицы, уголь (0…1), язык пламени (0…1). */
  burn: number;
  scale: number;
  ember: number;
  pillar: number;
  /** Сон: перья распушены. */
  fluff: number;
}

const REST: Pose = {
  x: 0,
  z: 0,
  sq: 0,
  lean: 0,
  bow: 0,
  hx: 0,
  hz: 0,
  turn: 0,
  nod: 0,
  tilt: 0,
  crest: 0,
  thL: 0.8,
  thR: 0.8,
  fanL: 1.2,
  fanR: 1.2,
  hugL: 0,
  hugR: 0,
  tailUp: 0,
  tailFan: 0,
  fLx: 0,
  fLz: 0,
  fRx: 0,
  fRz: 0,
  eye: 'open',
  blink: 0,
  beak: 0,
  fire: 1,
  burn: 0,
  scale: 1,
  ember: 0,
  pillar: 0,
  fluff: 0,
};

/** Ключи, сведённые к петле: значение в T равно значению в 0. */
const loopK = (t: number, T: number, keys: Key[]) => kf(wrap(t, T), keys);

// ---------------------------------------------------------------------------
// Дорожки анимаций.
// ---------------------------------------------------------------------------

function idlePose(t: number): Pose {
  const T = dur('idle');
  const o: Pose = { ...REST };
  // Дыхание: вдох быстрее выдоха, второй вдох глубже, пауза — у начала петли.
  const br = loopK(t, T, [
    [0, 0],
    [0.15, 0],
    [0.75, 1, 'o'],
    [1.0, 0.95],
    [1.65, 0.05],
    [1.8, 0],
    [2.3, 1.25, 'o'],
    [2.5, 1.2],
    [2.95, 0],
    [T, 0],
  ]);
  o.sq = -0.025 * br;
  o.z = 0.35 * br;
  o.fire = 1 + 0.12 * br;
  // Голова оглядывается: вправо рывком с перелётом, потом влево, потом
  // склоняет набок «с интересом» и возвращается.
  o.turn = loopK(t, T, [
    [0, 0],
    [0.5, 0],
    [0.66, 0.4, 'o'],
    [0.74, 0.34],
    [1.25, 0.32],
    [1.38, -0.36, 'o'],
    [1.46, -0.3],
    [2.05, -0.28],
    [2.3, 0.04, 'o'],
    [2.42, 0],
    [T, 0],
  ]);
  o.tilt = loopK(t, T, [
    [0, 0],
    [0.5, 0],
    [0.7, 0.08, 'o'],
    [1.3, 0.06],
    [1.42, -0.06],
    [2.05, -0.05],
    [2.3, 0.16, 'o'],
    [2.65, 0.14],
    [2.9, 0, 'o'],
    [T, 0],
  ]);
  o.nod = loopK(t, T, [
    [0, 0],
    [0.5, 0],
    [0.62, -0.08, 'o'],
    [0.85, 0],
    [2.2, 0],
    [2.35, 0.1, 'o'],
    [2.7, 0.06],
    [2.95, 0],
    [T, 0],
  ]);
  o.hx = o.turn * 1.2 + o.tilt * 3;
  o.blink = Math.max(bump(t, 0.95, 1.12), bump(t, 2.48, 2.62), bump(t, 2.66, 2.8) * 0.8);
  // Крылья встряхивает на выдохе: приподнял — уронил, маховые доигрывают пружиной.
  const shk = kf(t, [
    [1.6, 0],
    [1.72, 1, 'o'],
    [1.86, -0.25, 'i'],
    [2.0, 0.08],
    [2.12, 0],
  ]);
  o.thL = REST.thL + 0.22 * shk + 0.02 * br;
  o.thR = REST.thR + 0.22 * shk + 0.02 * br;
  o.fanL = o.fanR = REST.fanL + 0.15 * shk;
  o.crest = 0.25 * shk + 0.1 * br;
  o.tailFan = 0.15 * shk;
  return o;
}

function walkPose(t: number): Pose {
  const T = dur('walk');
  const o: Pose = { ...REST };
  const h = wrap(t, T);
  // Шаг: 0–0,5 — левая лапа в воздухе, тело над правой; 0,5–1 — наоборот.
  const sway = loopK(h, T, [
    [0, 0],
    [0.22, 1, 'o'],
    [0.32, 0.95],
    [0.5, 0],
    [0.72, -1, 'o'],
    [0.82, -0.95],
    [1.0, 0],
  ]);
  o.x = -1.3 * sway;
  o.lean = -0.09 * sway;
  // Вес: вниз на постановке лапы, вверх на проносе.
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
  o.z = 0.6 + 0.75 * bob;
  o.sq = -0.05 * bob;
  // Лапы: поднимается та, с которой тело ушло.
  const liftL = bump(h, 0.04, 0.46);
  const liftR = bump(h, 0.54, 0.96);
  o.fLz = 2.6 * liftL ** 0.8;
  o.fRz = 2.6 * liftR ** 0.8;
  o.fLx = -0.6 * liftL;
  o.fRx = 0.6 * liftR;
  // Голова держит горизонт: наклон против крена, лёгкий кивок в такт.
  o.tilt = 0.06 * sway;
  o.nod = 0.06 * bob;
  o.hx = 0.6 * sway;
  // Крылья чуть в стороны — балансир; маховые доигрывают сами.
  o.thL = REST.thL + 0.16 + 0.1 * Math.max(0, -sway);
  o.thR = REST.thR + 0.16 + 0.1 * Math.max(0, sway);
  o.fanL = o.fanR = REST.fanL + 0.1;
  o.tailFan = 0.1;
  o.crest = 0.15;
  return o;
}

function happyPose(t: number): Pose {
  const o: Pose = { ...REST };
  const T = dur('happy');
  // Присел → толчок → в воздухе два взмаха → приземлился → вернулся.
  o.sq = kf(t, [
    [0, 0],
    [0.16, 0.17, 'o'],
    [0.22, -0.14, 'i'],
    [0.36, -0.06, 'o'],
    [0.62, 0],
    [0.76, -0.06],
    [0.82, 0.15, 'i'],
    [0.92, -0.02, 'o'],
    [1.0, 0.01],
    [T, 0],
  ]);
  o.z = kf(t, [
    [0, 0],
    [0.18, 0],
    [0.44, 8.5, 'o'],
    [0.56, 8.8],
    [0.8, 0, 'i'],
    [T, 0],
  ]);
  const flap = kf(t, [
    [0, REST.thL],
    [0.16, 0.75, 'o'],
    [0.3, 2.45, 'o'],
    [0.42, 1.0, 'i'],
    [0.54, 2.3, 'o'],
    [0.68, 1.6],
    [0.8, 1.35, 'i'],
    [0.9, 0.95, 'o'],
    [1.0, REST.thL],
    [T, REST.thL],
  ]);
  o.thL = o.thR = flap;
  o.fanL = o.fanR = kf(t, [
    [0, 1.2],
    [0.16, 0.8, 'o'],
    [0.3, 1.55, 'o'],
    [0.85, 1.45],
    [1.0, 1.2],
  ]);
  o.nod = kf(t, [
    [0, 0],
    [0.16, 0.14, 'o'],
    [0.3, -0.16, 'o'],
    [0.7, -0.1],
    [0.84, 0.08],
    [1.0, 0],
  ]);
  o.tilt = kf(t, [
    [0.3, 0],
    [0.48, 0.12],
    [0.66, -0.08],
    [0.9, 0],
  ]);
  o.crest = kf(t, [
    [0, 0],
    [0.16, -0.3],
    [0.32, 1.1, 'o'],
    [0.8, 0.9],
    [1.0, 0],
  ]);
  o.tailUp = kf(t, [
    [0.15, 0],
    [0.35, 1, 'o'],
    [0.8, 0.6],
    [1.0, 0],
  ]);
  o.tailFan = kf(t, [
    [0.15, 0],
    [0.35, 0.8, 'o'],
    [0.85, 0.5],
    [1.0, 0],
  ]);
  o.fLz = o.fRz = kf(t, [
    [0.2, 0],
    [0.4, 2.2, 'o'],
    [0.7, 1.6],
    [0.8, 0, 'i'],
  ]);
  o.eye = t > 0.1 && t < 0.98 ? 'happy' : 'open';
  o.beak = bump(t, 0.32, 0.72) * 0.9;
  o.fire =
    1 +
    kf(t, [
      [0.2, 0],
      [0.44, 0.6, 'o'],
      [0.75, 0.4],
      [1.0, 0],
    ]);
  return o;
}

function workPose(t: number): Pose {
  // Трюк «сгорает и возрождается» (2 с): обнял себя крыльями и раскалился →
  // вспыхнул языком пламени → прогорел в уголёк → уголёк дышит → треснул,
  // столб огня → из него встаёт птица с распахнутыми крыльями → сложилась.
  const o: Pose = { ...REST };
  const T = dur('work');
  o.hugL = o.hugR = kf(t, [
    [0, 0],
    [0.24, 1, 'o'],
    [1.3, 1],
    // Птица невидима (уголь в столбе огня) — крылья раскрываются «за кадром».
    [1.34, 0],
  ]);
  o.thL = o.thR = kf(t, [
    [0, REST.thL],
    [0.24, 0.6, 'o'],
    [1.3, 0.6],
    [1.46, 2.55, 'o'],
    [1.62, 2.1],
    [1.74, 2.25],
    [1.92, REST.thL, 'i'],
    [T, REST.thL],
  ]);
  o.fanL = o.fanR = kf(t, [
    [0, 1.2],
    [0.24, 0.45],
    [1.3, 0.45],
    [1.46, 1.65, 'o'],
    [1.75, 1.5],
    [1.92, 1.2],
  ]);
  o.sq = kf(t, [
    [0, 0],
    [0.24, 0.12, 'o'],
    [0.3, -0.1, 'i'],
    [0.42, -0.2],
    [1.3, 0.2],
    [1.42, -0.18, 'o'],
    [1.56, 0.04],
    [1.66, 0],
    [1.88, 0.06],
    [1.96, 0, 'o'],
  ]);
  o.nod = kf(t, [
    [0, 0],
    [0.24, 0.3, 'o'],
    [0.45, 0.3],
    [1.4, 0.2],
    [1.55, -0.18, 'o'],
    [1.8, -0.1],
    [1.95, 0],
  ]);
  o.eye = t < 0.12 || t > 1.62 ? 'open' : t > 1.42 ? 'happy' : 'sleep';
  o.burn = kf(t, [
    [0.12, 0],
    [0.3, 0.55, 'i'],
    [0.42, 1, 'o'],
    [1.3, 1],
    [1.5, 0.45, 'o'],
    [1.66, 0],
  ]);
  o.scale = kf(t, [
    [0.36, 1],
    [0.55, 0.95],
    [0.95, 0.12, 'i'],
    [1.34, 0.12],
    [1.48, 1.06, 'o'],
    [1.6, 0.98],
    [1.7, 1],
  ]);
  o.ember = kf(t, [
    [0.82, 0],
    [0.96, 1, 'o'],
    [1.32, 1],
    [1.4, 0, 'i'],
  ]);
  o.pillar = kf(t, [
    [0.3, 0],
    [0.46, 1, 'o'],
    [0.62, 0.85],
    [0.98, 0, 'i'],
    [1.3, 0],
    [1.36, 1.25, 'o'],
    [1.5, 0.6],
    [1.64, 0, 'i'],
  ]);
  o.z = kf(t, [
    [1.4, 0],
    [1.56, 3.2, 'o'],
    [1.76, 2.6],
    [1.9, 0, 'i'],
  ]);
  o.crest = kf(t, [
    [0, 0],
    [0.24, -0.4],
    [1.44, -0.3],
    [1.58, 1.3, 'o'],
    [1.82, 1],
    [1.98, 0],
  ]);
  o.tailUp = kf(t, [
    [1.42, 0],
    [1.58, 1, 'o'],
    [1.84, 0.7],
    [1.98, 0],
  ]);
  o.tailFan = kf(t, [
    [0, 0],
    [0.24, -0.4],
    [1.4, -0.4],
    [1.58, 1, 'o'],
    [1.86, 0.6],
    [1.98, 0],
  ]);
  o.fire = kf(t, [
    [0, 1],
    [0.24, 1.3],
    [1.42, 1.3],
    [1.58, 1.7, 'o'],
    [1.84, 1.3],
    [1.98, 1],
  ]);
  o.beak = bump(t, 1.5, 1.78) * 0.7;
  return o;
}

function attackPose(t: number): Pose {
  // Замах вверх-назад → удар крыльями вниз-вперёд (контакт 0,375 с, 9-й
  // кадр) → проводка крест-накрест → возврат.
  const o: Pose = { ...REST };
  const T = dur('attack');
  o.bow = kf(t, [
    [0, 0],
    [0.28, -0.2, 'o'],
    [0.34, -0.22],
    [0.39, 0.3, 'i'],
    [0.5, 0.36, 'o'],
    [0.66, 0.12],
    [0.84, 0],
  ]);
  o.sq = kf(t, [
    [0, 0],
    [0.12, 0.08, 'o'],
    [0.3, -0.1],
    [0.39, 0.13, 'i'],
    [0.5, 0.05, 'o'],
    [0.7, 0],
  ]);
  o.z = kf(t, [
    [0.1, 0],
    [0.3, 1.6, 'o'],
    [0.39, 0, 'i'],
  ]);
  const wing = kf(t, [
    [0, REST.thL],
    [0.1, 1.0, 'o'],
    [0.3, 2.6, 'o'],
    [0.35, 2.65],
    [0.39, 1.0, 'i'],
    [0.5, 0.45, 'o'],
    [0.66, 0.75],
    [0.84, REST.thL],
  ]);
  o.thL = o.thR = wing;
  o.hugL = o.hugR = kf(t, [
    [0.33, 0],
    [0.39, 0.45, 'i'],
    [0.5, 0.95, 'o'],
    [0.64, 0.6],
    [0.84, 0],
  ]);
  o.fanL = o.fanR = kf(t, [
    [0, 1.2],
    [0.3, 1.55, 'o'],
    [0.39, 1.0],
    [0.55, 0.7],
    [0.84, 1.2],
  ]);
  o.nod = kf(t, [
    [0, 0],
    [0.3, -0.14, 'o'],
    [0.39, 0.22, 'i'],
    [0.6, 0.12],
    [0.84, 0],
  ]);
  o.crest = kf(t, [
    [0, 0],
    [0.3, 1.1, 'o'],
    [0.5, 0.8],
    [0.84, 0],
  ]);
  o.eye = t > 0.05 && t < 0.78 ? 'angry' : 'open';
  o.beak = kf(t, [
    [0.2, 0],
    [0.34, 1, 'o'],
    [0.46, 1],
    [0.6, 0],
  ]);
  o.fire = kf(t, [
    [0, 1],
    [0.3, 1.3],
    [0.39, 1.8, 'i'],
    [0.6, 1.3],
    [0.84, 1],
  ]);
  o.tailFan = kf(t, [
    [0.1, 0],
    [0.3, 0.6, 'o'],
    [0.5, 0.9],
    [0.84, 0],
  ]);
  o.tailUp = kf(t, [
    [0.1, 0],
    [0.3, 0.7],
    [0.45, 0.2],
    [0.84, 0],
  ]);
  void T;
  return o;
}

function sleepPose(t: number): Pose {
  const T = dur('sleep');
  const o: Pose = { ...REST };
  // Два вдоха на петлю, второй глубже; выдох длинный, пауза у начала.
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
  o.fluff = 1 + 0.12 * br;
  o.sq = 0.1 - 0.03 * br;
  o.z = 0.25 * br;
  o.hz = -3.4 + 0.35 * br;
  o.nod = 0.42 - 0.04 * br;
  o.tilt = 0.1;
  o.hx = 0.6;
  o.crest = -0.85 + 0.08 * br;
  o.thL = o.thR = 0.3;
  o.fanL = o.fanR = 0.42;
  o.tailUp = -0.35;
  o.tailFan = -0.3;
  o.eye = 'sleep';
  o.fire = 0.4 + 0.08 * br;
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
// Скелет: где что стоит при данной позе.
// ---------------------------------------------------------------------------

interface Skel {
  /** Точка модели верхней части тела → кадр модели (сжатие, наклон, крен, прыжок, масштаб). */
  up: (p: V3) => V3;
  body: V3;
  head: V3;
  shoulderL: V3;
  shoulderR: V3;
  rump: V3;
  hipL: V3;
  hipR: V3;
  footL: V3;
  footR: V3;
  k: number;
}

const BODY0: V3 = [0, 0, 12.5];
const HEAD0: V3 = [0, 1.2, 25];

function skel(o: Pose): Skel {
  const s = o.scale;
  const sq = o.sq;
  const up = (p: V3): V3 => {
    let q: V3 = [p[0] * (1 + sq * 0.55), p[1] * (1 + sq * 0.4), p[2] * (1 - sq)];
    q = pitchX(q, o.bow, [0, 0, 5]);
    q = rollY(q, o.lean, [0, 0, 0]);
    q = mul(q, s);
    return add(q, [o.x, 0, o.z]);
  };
  const footL: V3 = add([-4.3 * s + o.fLx, 2.3 * s, 0.6 * s + o.fLz], [o.x * 0.15, 0, o.z]);
  const footR: V3 = add([4.3 * s + o.fRx, 2.3 * s, 0.6 * s + o.fRz], [o.x * 0.15, 0, o.z]);
  return {
    up,
    body: up(BODY0),
    head: up(add(HEAD0, [o.hx, 0, o.hz])),
    shoulderL: up([-8.0, 1.2, 19]),
    shoulderR: up([8.0, 1.2, 19]),
    rump: up([0, -4.5, 6]),
    hipL: up([-3.9, 1.6, 4.4]),
    hipR: up([3.9, 1.6, 4.4]),
    footL,
    footR,
    k: s,
  };
}

// ---------------------------------------------------------------------------
// Детали.
// ---------------------------------------------------------------------------

/** Чешуйки перьев на груди и кроющих: тёмная дуга внизу каждой чешуйки. */
function scallop(rows: number, cols: number, amp: number, top = 1) {
  return (qx: number, qy: number, qz: number) => {
    const v = (top - qz) * rows * 0.5;
    const row = Math.floor(v);
    const fv = v - row;
    const u = (Math.atan2(qx, qy) / Math.PI) * cols + (row & 1) * 0.5;
    const fu = u - Math.floor(u);
    const edge = (fu - 0.5) ** 2 * 4;
    return fv > 0.8 - edge * 0.45 ? -amp : row > 0 && fv < 0.18 ? amp * 0.5 : 0;
  };
}

let NEXT_ID = 0;
const nid = () => ++NEXT_ID;

/**
 * Перо-язык: стержень по кривой Безье `a → b → c`, ширина по профилю
 * (`wid` — доли пути 0…1), тон вдоль — `along` (огонь от основания к
 * кончику). Звенья одного пера — один номер: швов внутри пера нет.
 */
function feather(
  out: Part[],
  a: V3,
  b: V3,
  c: V3,
  wid: number[],
  thick: number,
  nrm: V3,
  pal: number,
  along: [number, number],
  lit = 0.7,
  id = nid(),
  segs = 7,
  /** Изгиб «волной»: середина первой половины уходит на `bend`, второй — обратно (язык пламени). */
  bend: V3 | null = null,
  /** Огонь разгорается к кончику: доля пути в степени `apow`. */
  apow = 1,
): void {
  const at = (u: number): V3 => {
    const q = bezQ(a, b, c, u);
    return bend ? add(q, mul(bend, Math.sin(Math.PI * 2 * u) * 0.5)) : q;
  };
  for (let i = 0; i < segs; i++) {
    const u0 = i / segs;
    const u1 = (i + 1) / segs;
    const p0 = at(u0);
    const p1 = at(u1);
    const mid = mul(add(p0, p1), 0.5);
    const d = sub(p1, p0);
    const len = Math.hypot(d[0], d[1], d[2]);
    if (len < 1e-4) continue;
    const um = (u0 + u1) / 2;
    const wf = wid.length - 1;
    const wi = Math.min(wf - 1, Math.floor(um * wf));
    const w = lerp(wid[wi], wid[wi + 1], um * wf - wi);
    out.push({
      c: mid,
      ax: axes(d, nrm),
      r: [len * 0.62 + 0.25, Math.max(0.35, w), thick],
      pal,
      id,
      along: [lerp(along[0], along[1], u0 ** apow), lerp(along[0], along[1], u1 ** apow)],
      lit,
    });
  }
}

/** Мерцание пера: своя фаза у каждого, частоты — целые числа кругов за петлю покоя. */
function flick(tau: number, seed: number): number {
  const ph = hash(seed, 7, 3);
  const ph2 = hash(seed, 11, 5);
  const u = (tau / PER) * Math.PI * 2;
  // Целое число кругов на петлю: ~1,7 и 3 Гц и в покое (3 с), и в ходьбе (1 с).
  const n1 = Math.max(1, Math.round((5 * PER) / FLICK_T));
  const n2 = Math.max(n1 + 1, Math.round((9 * PER) / FLICK_T));
  return 0.6 * Math.sin(u * n1 + ph * 6.283) + 0.4 * Math.sin(u * n2 + ph2 * 6.283);
}

/** Период мерцания и искр: петля ходьбы короче покоя, иначе на её стыке шов. */
let PER = FLICK_T;

/** Направление во фронтальной плоскости: угол от «вниз», наружу на сторону `side`. */
const dirFront = (th: number, side: number, fwd = 0): V3 =>
  norm([side * Math.sin(th), fwd, -Math.cos(th)]);

const FEATHER_W = [1.2, 2.0, 2.4, 2.4, 2.0, 1.2, 0.3];
const PLUME_W = [0.6, 0.9, 1.4, 2.0, 2.6, 2.7, 2.2, 1.2, 0.25];
const CREST_W = [0.55, 1.1, 1.35, 1.2, 0.8, 0.25];
const TONGUE_W = [1.8, 2.8, 3.0, 2.4, 1.5, 0.6, 0.15];

interface Ctx {
  o: Pose;
  S: Skel;
  /** Запаздывания вторичного движения (уже посчитанные пружиной). */
  lag: {
    headX: number;
    headZ: number;
    thL: number;
    thR: number;
    rootX: number;
    rootZ: number;
    footX: number;
  };
  tau: number;
}

function wing(out: Part[], c: Ctx, side: -1 | 1): void {
  const { o, S, lag } = c;
  const k = S.k;
  const hug = side < 0 ? o.hugL : o.hugR;
  // Обхват: крыло уходит вперёд и внутрь, к груди.
  const th = lerp(side < 0 ? o.thL : o.thR, -0.6, hug);
  const thLag = lerp(side < 0 ? lag.thL : lag.thR, -0.6, hug);
  const fan = side < 0 ? o.fanL : o.fanR;
  const sh = add(side < 0 ? S.shoulderL : S.shoulderR, [
    -side * hug * 2 * k,
    hug * 7 * k,
    -hug * 2 * k,
  ]);
  const tw = (a: number): V3 =>
    norm(add(rollY(dirFront(a, side), o.lean), [0, 0.2 + hug * 0.25, 0]));
  const dW = tw(th);
  const nrm = norm([side * 0.25 * (1 - hug), 1, 0.25]);
  // Плечо — багровое, кроющие — рыжие с чешуйками: дуга от плеча к запястью,
  // переход от тела к пламени маховых (бледное золото читалось «кулаками»).
  out.push({
    c: add(sh, mul(dW, 2.8 * k)),
    ax: axes(dW, nrm),
    r: [4.6 * k, 3.8 * k, 2.4 * k],
    pal: P_BODY,
    id: nid(),
    bias: 0.06,
  });
  const gid = nid();
  for (let g = 0; g < 2; g++) {
    out.push({
      c: add(add(sh, mul(dW, (5.2 + g * 2.6) * k)), mul(nrm, (1.1 - g * 0.3) * k)),
      ax: axes(dW, nrm),
      r: [(3.4 - g * 0.6) * k, (3.3 - g * 0.5) * k, 1.4 * k],
      pal: P_BELLY,
      id: gid,
      tex: scallop(3, 2, 0.2),
      bias: -0.3 - g * 0.06,
    });
  }
  // Маховые веером: верхние (передний край) длиннее, нижние — короче, к телу.
  // Кончик отстаёт от взмаха пружиной и колышется языком пламени.
  const lens = [8.4, 9, 8.8, 8.2, 7.3, 6.3];
  const nF = lens.length;
  for (let j = 0; j < nF; j++) {
    const off = fan * (0.5 - j / (nF - 1));
    const a0 = th + off;
    const a1 = thLag + off * 1.06;
    const root = add(add(sh, mul(dW, (8.4 - j * 1.25) * k)), mul(nrm, -0.3 * j * k));
    const fl = 1 + 0.09 * (o.fire - 1) + 0.05 * o.fire * flick(c.tau, 20 + j + side * 10);
    const L = lens[j] * k * fl;
    const mid = add(root, mul(tw(a0), L * 0.55));
    const tip = add(mid, mul(tw(a1 + side * 0.1), L * 0.5));
    const d = tw(a0);
    const perp: V3 = [d[2], 0, -d[0]];
    const wave = (j % 2 ? 1 : -1) * (0.7 + 0.35 * flick(c.tau, 160 + j + side * 7)) * k;
    feather(
      out,
      root,
      mid,
      tip,
      FEATHER_W.map((w) => w * k),
      0.75 * k,
      nrm,
      P_FIRE,
      [0.1 + j * 0.03, Math.min(1, 0.8 + 0.12 * o.fire)],
      0.75,
      nid(),
      7,
      mul(perp, wave),
      1.5,
    );
  }
}

function tail(out: Part[], c: Ctx): void {
  const { o, S, lag } = c;
  const k = S.k;
  // Хвост — два длинных пера на сторону: от крестца назад-вниз, по полу в
  // стороны, кончик загибается вверх языком. Отстаёт от корпуса пружиной.
  const swayX = (lag.rootX - o.x) * 0.9;
  const swayZ = (lag.rootZ - o.z) * 0.7;
  const fan = 1 + o.tailFan * 0.22;
  for (const side of [-1, 1] as const) {
    for (let j = 0; j < 2; j++) {
      const outer = j === 0;
      const base = add(S.rump, [side * (outer ? 2.4 : 1.2) * k, 0, (outer ? 0.8 : -1.2) * k]);
      const fl = 1 + 0.08 * (o.fire - 1) + 0.06 * o.fire * flick(c.tau, 40 + j + side * 3);
      const tipRel: V3 = outer
        ? [side * 18 * fan, -3, 5.5 + o.tailUp * 6]
        : [side * 15 * fan, -2.5, -2.2 + o.tailUp * 4];
      const ctlRel: V3 = outer ? [side * 12.5, -5, -3.6] : [side * 8, -4, -3.8];
      const tip = add(add(base, mul(tipRel, k * fl)), [swayX * (outer ? 1 : 0.7), 0, swayZ]);
      const ctl = add(add(base, mul(ctlRel, k)), [swayX * 0.4, 0, swayZ * 0.4]);
      const wave = side * (outer ? 1.4 : -1) * (1 + 0.35 * flick(c.tau, 140 + j + side * 5)) * k;
      feather(
        out,
        base,
        ctl,
        tip,
        PLUME_W.map((w) => w * k * (outer ? 1 : 0.8)),
        0.8 * k,
        norm([side * 0.2, 1, 0.4]),
        P_FIRE,
        [0.08, Math.min(1, 0.86 + 0.1 * o.fire)],
        0.6,
        nid(),
        9,
        [0, 0, wave],
        1.5,
      );
    }
  }
}

function crest(out: Part[], c: Ctx): void {
  const { o, S, lag } = c;
  const k = S.k;
  const H = S.head;
  // Хохолок отстаёт от головы: ведущая — голова, кончики — пружина.
  const dx = (lag.headX - H[0]) * 0.8;
  const dz = (lag.headZ - H[2]) * 0.6;
  const up = o.crest;
  const feathers: [number, number, number][] = [
    // смещение основания по x, наклон наружу, длина
    [-3.4, -0.75, 4.6],
    [-1.8, -0.36, 6.8],
    [0, 0, 8.4],
    [1.8, 0.36, 6.8],
    [3.4, 0.75, 4.6],
  ];
  for (let j = 0; j < feathers.length; j++) {
    const [bx, lean, len0] = feathers[j];
    const spread = lean * (1 + up * 0.35);
    const ang = spread + o.tilt + o.lean;
    const base = add(H, [
      (bx * 0.9 + o.turn * 3) * k,
      -1.6 * k,
      6.4 * k + Math.abs(bx) * -0.35 * k,
    ]);
    const fl = 1 + 0.08 * (o.fire - 1) + 0.07 * o.fire * flick(c.tau, 60 + j);
    const L = len0 * k * (1 + up * 0.22) * fl * (up < 0 ? 1 + up * 0.25 : 1);
    // Опущенный хохолок клонится назад-вниз.
    const back = up < 0 ? -up : 0;
    const dir = norm([Math.sin(ang), -0.35 - back * 1.4, Math.cos(ang) * (1 - back * 0.6)]);
    const mid = add(base, mul(dir, L * 0.55));
    const tip = add(add(base, mul(dir, L)), [dx + Math.sin(ang) * 1.2, -back * 2, dz]);
    feather(
      out,
      base,
      mid,
      tip,
      CREST_W.map((w) => w * k),
      0.8 * k,
      [0, 1, 0.2],
      P_FIRE,
      [0.42, Math.min(1, 0.9 + 0.08 * o.fire)],
      0.6,
      nid(),
      6,
    );
  }
}

function legs(out: Part[], c: Ctx): void {
  const { S, lag } = c;
  const k = S.k;
  for (const side of [-1, 1] as const) {
    const hip = side < 0 ? S.hipL : S.hipR;
    const foot = side < 0 ? S.footL : S.footR;
    const d = sub(foot, hip);
    const id = nid();
    out.push({
      c: mul(add(hip, foot), 0.5),
      ax: axes(d, [0, 1, 0]),
      r: [Math.hypot(d[0], d[1], d[2]) * 0.5 + 0.4, 1.25 * k, 1.25 * k],
      pal: P_GOLD,
      id,
      bias: -0.12,
      tex: (qx) => (Math.floor((qx + 1) * 2.2) & 1 ? -0.12 : 0),
    });
    // Пальцы: три вперёд.
    for (const a of [-0.65, 0, 0.65]) {
      const dir = norm([Math.sin(a) + side * 0.15, Math.cos(a), -0.15]);
      out.push({
        c: add(foot, mul(dir, 1.6 * k)),
        ax: axes(dir, [0, 0, 1]),
        r: [1.7 * k, 0.75 * k, 0.65 * k],
        pal: P_GOLD,
        id,
        bias: -0.05,
      });
    }
    if (side < 0) {
      // Браслет сломанных кандалов и обрывок цепи — отстаёт пружиной.
      const cuff = lerp3c(hip, foot, 0.55);
      out.push({ c: cuff, ax: AX0, r: [2.0 * k, 2.0 * k, 0.95 * k], pal: P_IRON, id: nid() });
      const sw = (lag.footX - foot[0]) * 0.8;
      let p = add(cuff, [-1.6 * k, 1.4 * k, -0.4 * k]);
      for (let i = 0; i < 2; i++) {
        const q = add(p, [(-1.3 + sw * 0.6) * k, 0.3 * k, -0.9 * k]);
        const dd = sub(q, p);
        out.push({
          c: mul(add(p, q), 0.5),
          ax: axes(dd, i ? [1, 0, 0] : [0, 1, 0]),
          r: [1.0 * k, 0.55 * k, 0.45 * k],
          pal: P_IRON,
          id: nid(),
          bias: 0.08,
        });
        p = q;
      }
    }
  }
}
const lerp3c = (a: V3, b: V3, t: number): V3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/** Палитра тела в огне: от своей к огню. */
function burnPal(burn: number): RGBA[][] {
  if (burn <= 0) return PALS;
  const F = FIRE;
  const toFire = (r: RGBA[], lo: number, hi: number) =>
    r.map((col, i) =>
      mixc(col, F[Math.round(lo + (i / (r.length - 1)) * (hi - lo))], clamp01(burn * 1.15)),
    );
  return PALS.map((r, i) =>
    i === P_BODY ? toFire(r, 2, 5) : i === P_BELLY || i === P_GOLD ? toFire(r, 3, 6) : r,
  );
}

function body(out: Part[], c: Ctx): void {
  const { o, S } = c;
  const k = S.k;
  const sq = o.sq;
  const fl = o.fluff;
  out.push({
    c: S.body,
    ax: axes(rollY([1, 0, 0], o.lean), [0, 0, 1]),
    r: [
      (9.6 + fl) * (1 + sq * 0.55) * k,
      (8 + fl * 0.8) * (1 + sq * 0.4) * k,
      (10.6 + fl * 0.4) * (1 - sq) * k,
    ],
    pal: P_BODY,
    id: nid(),
    tex: scallop(6, 3.2, 0.1),
  });
  out.push({
    c: S.up([0, 3.9 + fl * 0.6, 11.2]),
    ax: axes(rollY([1, 0, 0], o.lean), pitchX([0, 0, 1], o.bow)),
    r: [(6.6 + fl * 0.8) * (1 + sq * 0.5) * k, 4.8 * k, (8.4 + fl * 0.3) * (1 - sq) * k],
    pal: P_BELLY,
    id: nid(),
    tex: scallop(4, 3.2, 0.16, 0.95),
    bias: -0.08,
  });
  // Голова чуть шире тела сверху — «пухлый» силуэт.
  const H = S.head;
  out.push({
    c: H,
    ax: axes(rollY([1, 0, 0], o.tilt + o.lean), [0, 0, 1]),
    r: [8.4 * k, 7.8 * k, 7.8 * k],
    pal: P_BODY,
    id: nid(),
    bias: -0.04,
    tex: scallop(5, 3.4, 0.07),
  });
  // Клюв: верхний крючком, нижний открывается.
  const fwd = norm(pitchX(yawZ0([0, 1, 0], o.turn), o.nod + o.bow + 0.38));
  const bb = add(H, mul(norm(pitchX(yawZ0([0, 1, 0], o.turn), o.nod + o.bow + 0.3)), 7.0 * k));
  const beakId = nid();
  out.push({
    c: add(bb, mul(fwd, 1.1 * k)),
    ax: axes(fwd, [0, 0, 1]),
    r: [2.7 * k, 2.4 * k, 1.7 * k],
    pal: P_GOLD,
    id: beakId,
    bias: -0.12,
  });
  out.push({
    c: add(bb, add(mul(fwd, 2.6 * k), [0, 0, -1.3 * k])),
    ax: axes(norm(add(fwd, [0, 0, -1])), [0, 1, 0]),
    r: [1.4 * k, 1.1 * k, 0.9 * k],
    pal: P_GOLD,
    id: beakId,
    bias: -0.3,
  });
  if (o.beak > 0.05) {
    const low = norm(pitchX(fwd, 0.5 * o.beak));
    out.push({
      c: add(bb, add(mul(low, 1.4 * k), [0, 0, -1.4 * k - o.beak * 0.8])),
      ax: axes(low, [0, 0, 1]),
      r: [2.0 * k, 1.6 * k, 0.9 * k],
      pal: P_GOLD,
      id: nid(),
      bias: -0.15,
    });
  }
}
const yawZ0 = (p: V3, a: number): V3 => [
  p[0] * Math.cos(a) + p[1] * Math.sin(a),
  -p[0] * Math.sin(a) + p[1] * Math.cos(a),
  p[2],
];

/** Языки пламени трюка: обнимают тело, тянутся вверх, мерцают. */
function tongues(out: Part[], c: Ctx, amt: number, cx: number, top: number, wide: number): void {
  if (amt <= 0.01) return;
  // Два ряда: задний выше и шире (силуэт пламени), передний ниже (тело в огне).
  const rows: [number, number, number, number][] = [
    // y, сколько, высота, ширина ряда
    [-5, 4, 1.15, 1],
    [8, 5, 0.75, 0.8],
  ];
  let seed = 90;
  for (const [y, n, hk, wk] of rows) {
    for (let j = 0; j < n; j++) {
      const u = j / (n - 1) - 0.5;
      const fl = flick(c.tau, seed++);
      const base: V3 = [cx + u * wide * wk, y, 1.5 + (0.5 - Math.abs(u)) * 3];
      const h = top * hk * amt * (1 - Math.abs(u) * 0.8) * (1 + 0.14 * fl);
      const tip: V3 = add(base, [u * wide * 0.25 + fl * 1.6, 0, h]);
      const mid: V3 = add(base, [u * wide * 0.3 - fl * 0.9, 0, h * 0.5]);
      feather(
        out,
        base,
        mid,
        tip,
        TONGUE_W.map((w) => w * (0.7 + amt * 0.5) * (1 - Math.abs(u) * 0.3) * (wide / 16)),
        2.2,
        [0, 1, 0],
        P_FIRE,
        [0.45, 1],
        0.25,
        nid(),
        7,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Глаза.
// ---------------------------------------------------------------------------

const EYE_PAL: Record<string, RGBA> = {
  K: INK,
  W: WHITE,
  o: GOLD[3],
};
const EYES: Record<string, string[]> = {
  open: ['.KK.', 'oKWo', 'oKKo', '.oo.'],
  half: ['....', '.KK.', 'oKKo', '.oo.'],
  shut: ['....', '....', 'KKKK', '....'],
  happy: ['....', '.KK.', 'K..K', '....'],
  sleep: ['....', '....', 'K..K', '.KK.'],
  angry: ['K...', 'oKK.', 'oKWK', '.oo.'],
};

function eyes(p: Px, f: Frame, c: Ctx): void {
  const { o, S } = c;
  if (o.scale < 0.5 || o.burn > 0.6) return;
  const H = S.head;
  const R = 7.8 * S.k;
  for (const side of [-1, 1] as const) {
    const yaw = side * 0.5 + o.turn;
    const el = 0.2 - (o.nod + o.bow) * 0.9;
    let pt: V3 = add(H, [
      Math.sin(yaw) * Math.cos(el) * R * 1.04,
      Math.cos(yaw) * Math.cos(el) * R,
      Math.sin(el) * R,
    ]);
    pt = rollY(pt, o.tilt + o.lean, H);
    const at = seen(f, pt, OX, OY, 2.2);
    if (!at) continue;
    let key: string = o.eye;
    if (key === 'open' || key === 'angry') {
      if (o.blink > 0.75) key = 'shut';
      else if (o.blink > 0.3) key = 'half';
    }
    const rows = EYES[key];
    const flip = side > 0;
    const x0 = at[0] - (flip ? 1 : 2);
    const y0 = at[1] - 2;
    stamp(p, rows, EYE_PAL, x0, y0, flip);
    // Золотой штрих от наружного уголка глаза вниз (как у сокола).
    if (key !== 'sleep' && key !== 'happy' && key !== 'shut') {
      const sx = flip ? x0 + 4 : x0 - 1;
      p.set(sx, y0 + 3, GOLD[4]);
      p.set(sx + (flip ? 1 : -1), y0 + 4, GOLD[3]);
    }
  }
}

// ---------------------------------------------------------------------------
// Искры и пепел.
// ---------------------------------------------------------------------------

/** Угольки от перьев: рождаются по расписанию петли, летят вверх, гаснут ступенями огня. */
function sparks(p: Px, c: Ctx, n: number, life: number, origin: (j: number) => V3, rise = 9): void {
  for (let j = 0; j < n; j++) {
    const born = ((j / n) * FLICK_T + hash(j, 3, 9) * 0.3) * (PER / FLICK_T);
    const age = wrap(c.tau - born, PER);
    if (age > life) continue;
    const u = age / life;
    const o = origin(j);
    const drift = Math.sin(u * 5 + j) * 1.3;
    const pt: V3 = add(o, [drift + (hash(j, 5, 1) - 0.5) * 3 * u, 0, rise * u + 1.5 * u * u]);
    const [sx, sy] = project(pt);
    const col = FIRE[Math.max(2, Math.round(7 - u * 5))];
    p.set(Math.floor(OX + sx), Math.floor(OY + sy), col);
  }
}

// ---------------------------------------------------------------------------
// Кадр.
// ---------------------------------------------------------------------------

/** Пружины вторичного движения: от начала анимации (разовой) или на две петли назад. */
export function lagOf(a: Anim, t: number): Ctx['lag'] {
  const T = dur(a);
  const t0 = LOOP[a] ? t - 2 * T : 0;
  const P = (tt: number) => poseAt(a, LOOP[a] ? wrap(tt, T) : Math.max(0, tt));
  const sk = (tt: number) => skel(P(tt));
  // Конец разовой анимации: запаздывание гаснет, кадр садится на покой.
  const env = LOOP[a] ? 1 : clamp01((T - t) / 0.18);
  const lagged = (fn: (tt: number) => number, freq: number, damp: number) => {
    const now = fn(t);
    return now + (spring(fn, t, t0, freq, damp) - now) * env;
  };
  return {
    headX: lagged((tt) => sk(tt).head[0], 3.4, 0.32),
    headZ: lagged((tt) => sk(tt).head[2], 3.0, 0.3),
    thL: lagged((tt) => P(tt).thL, 4.2, 0.38),
    thR: lagged((tt) => P(tt).thR, 4.2, 0.38),
    rootX: lagged((tt) => sk(tt).body[0], 2.2, 0.28),
    rootZ: lagged((tt) => sk(tt).body[2], 2.4, 0.3),
    footX: lagged((tt) => sk(tt).footL[0], 2.6, 0.22),
  };
}

/** Кадр `i` анимации `a` на холсте CW×CH; рамка тела — (BX, BY, BOX). */
export function phoenixFrame(a: Anim, i: number): Px {
  NEXT_ID = 0;
  const T = dur(a);
  const t = i / FPS;
  const o = poseAt(a, t);
  const S = skel(o);
  // Часы мерцания: у петель — своё время, у разовых — отсчёт к началу покоя
  // (последний кадр мерцает так же, как кадр перед первым кадром покоя).
  PER = a === 'walk' ? T : FLICK_T;
  const tau = LOOP[a] ? t : wrap(t - T, FLICK_T);
  const c: Ctx = { o, S, lag: lagOf(a, t), tau };
  const parts: Part[] = [];
  const birdOn = o.scale > 0.16;
  if (birdOn) {
    tail(parts, c);
    legs(parts, c);
    body(parts, c);
    wing(parts, c, -1);
    wing(parts, c, 1);
    crest(parts, c);
  }
  // Трюк: столб пламени вокруг тела, уголь.
  if (o.pillar > 0.01) tongues(parts, c, o.pillar, o.x, 30 * Math.min(1.2, o.pillar), 18);
  if (o.ember > 0.01) {
    // Кучка пепла под углем: от неё птица и восстаёт.
    parts.push({
      c: [0, 1.5, 0.4],
      ax: AX0,
      r: [9.5 * o.ember, 7 * o.ember, 1.8 * o.ember],
      pal: P_ASH,
      id: nid(),
      bias: 0.1,
      tex: (qx, qy) => (Math.sin(qx * 9 + qy * 5) > 0.6 ? -0.25 : 0),
    });
    const eg = 0.5 + 0.5 * Math.sin((t - 0.96) * 2 * Math.PI * 2.6);
    parts.push({
      c: [0, 2, 3.8 * o.ember],
      ax: AX0,
      r: [7 * o.ember, 5.6 * o.ember, 4.6 * o.ember],
      pal: P_EMBER,
      id: nid(),
      bias: -0.1 + 0.25 * eg,
      tex: (qx, qy, qz) => {
        // Трещины угля светятся: полосы по точке на угле.
        const v = Math.abs(Math.sin(qx * 4.1 + qz * 2.3) + Math.sin(qy * 3.7 - qz * 3.1));
        return v < 0.35 ? 0.55 * eg + 0.15 : 0;
      },
    });
  }
  const pals = burnPal(o.burn);
  const f = newFrame(CW, CH);
  drawParts(f, parts, pals, OX, OY);
  seams(f, 1.4, 1);
  rimLight(f, pals, (pl) => pl !== P_FIRE && pl !== P_EMBER);
  const p = toPx(f, pals);
  selOutline(p, INK, o.burn > 0.5 || !birdOn ? 0.6 : 0.8);
  if (birdOn) eyes(p, f, c);
  // Угольки: от хвоста и хохолка всегда, в трюке — гуще.
  const nsp = a === 'sleep' || a === 'walk' ? 2 : 4;
  sparks(p, c, nsp, 0.8, (j) =>
    j % 2
      ? add(S.head, [((j % 3) - 1) * 3, -1, 13 * S.k])
      : add(S.rump, [(j % 4 < 2 ? -1 : 1) * 17, -3, 9]),
  );
  if (o.burn > 0.2 || o.ember > 0.2) {
    sparks(
      p,
      { ...c, tau: c.tau * 2.0 },
      8,
      0.6,
      (j) => [((j % 5) - 2) * 3.2, 1, 6 + (j % 3) * 4],
      14,
    );
  }
  // Пепел оседает, пока птица прогорает.
  if (a === 'work' && t > 0.7 && t < 1.25) {
    for (let j = 0; j < 7; j++) {
      const u = clamp01((t - 0.7 - j * 0.04) / 0.5);
      if (u <= 0 || u >= 1) continue;
      const pt: V3 = [((j % 7) - 3) * 3.3 + Math.sin(u * 6 + j) * 1.5, 1, 22 - j * 1.5 - u * 16];
      const [sx, sy] = project(pt);
      const x = Math.floor(OX + sx);
      const y = Math.floor(OY + sy);
      if (dith(x, y, 1 - u * 0.6)) p.set(x, y, PALS[P_ASH][3 - Math.min(3, Math.floor(u * 4))]);
    }
  }
  return p;
}
