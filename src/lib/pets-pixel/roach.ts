// Таракан-бегун — пиксельный питомец по эталону боссов 12–14.
//
// Каштановый мультяшный таракан-гонщик стоит на задних лапах анфас: круглая
// голова с огромными блестящими глазами и гоночной полосой, два длинных уса
// (левый надломлен у кончика), лётные очки на лбу, за головой — глянцевый
// щиток с бледной каймой, за спиной — надкрылья; светлое сегментированное
// брюшко с приколотым номером «7»; четыре тонкие руки и две ноги с шипами.
//
// Две полосы, у каждой свой рисунок: малая — рамка 48 (шахта, списки),
// крупная — рамка 112 (карточка, вылупление, Питомник): жилки надкрылий,
// сегменты брюшка, шипы ног, членики усов, блики стёкол, булавки номера.
//
// Анимации 24 к/с по ключам (`kf`): подготовка → разгон → пик → проводка
// → возврат. Голова и усы — с запаздыванием (`spring`).
// Трюк — «забег»: правая верхняя рука опускает очки на глаза, низкий старт,
// рывок за край кадра (смаз, линии скорости, пыль со старта), выбегает с
// другой стороны, тормозит юзом (пыль из-под ног, усы по инерции вперёд),
// «класс» большим пальцем с бликом, очки снова на лоб — всё в покой.
//
// Золотой рисуется здесь же (`v` = 1) своими палитрами: панцирь — золото с
// бронзой в тени и ярким бликом, брюшко — бледное золото, ноги — бронза,
// оправа очков — медь; глаза, стёкла и «7» читаются.

import type { Px } from '../dungeon-art';
import {
  add,
  axes,
  bump,
  clamp01,
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
  yawZ,
} from './rig';
import type { Frame, Key, Part, RGBA, V3 } from './rig';

// ---------------------------------------------------------------------------
// Палитры (тон — номер ступени; свет, шов и кант сдвигают ступень).
// ---------------------------------------------------------------------------

const P_SHELL = 0;
const P_BELLY = 1;
const P_LEG = 2;
const P_CLOTH = 3;
const P_RED = 4;
const P_BRASS = 5;
const P_GLASS = 6;
const P_STRAP = 7;
const P_MOUTH = 8;
const P_DUST = 9;
// 10 — сталь булавок (берётся прямо из рампы STEEL).

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
const RED = ramp('#2a0806', '#4a100c', '#6e1a14', '#94281e', '#b8382a', '#d4503c', '#e8745a');
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
const CLOTH = ramp(
  '#5c5650',
  '#7e776e',
  '#a0988e',
  '#bfb8ad',
  '#d8d2c6',
  '#eae5db',
  '#f5f2ea',
  '#fdfbf6',
);
// Стекло очков — тёмная бирюза: светлое читалось бы второй парой глаз.
const GLASS = ramp(
  '#081a1e',
  '#0f2a30',
  '#183e46',
  '#235660',
  '#30707a',
  '#468c94',
  '#64a8ae',
  '#8cc6c8',
  '#bfe4e2',
);
const DUST = ramp(
  '#2e2924',
  '#463f37',
  '#5e554b',
  '#766c60',
  '#8c8275',
  '#a1978a',
  '#b5ac9f',
  '#c8c0b4',
);

const PAL_V: RGBA[][][] = [
  [
    // Панцирь: каштан, тень — тёмно-бурая, блик — светлая охра почти до белого.
    ramp(
      '#1a0804',
      '#280d05',
      '#381306',
      '#4a1a08',
      '#5e220b',
      '#722b0e',
      '#863613',
      '#9a4318',
      '#ad5220',
      '#be642c',
      '#cc7a3e',
      '#d99658',
      '#e8b884',
      '#f8e2c4',
    ),
    // Брюшко: бледный беж.
    ramp(
      '#4c3220',
      '#664630',
      '#805c40',
      '#9a7452',
      '#b28c64',
      '#c6a278',
      '#d6b68e',
      '#e4c9a4',
      '#efdabc',
      '#f8ead4',
    ),
    // Лапы и руки: красно-бурые, светлее панциря в тени — не тонут в тёмном полу.
    ramp(
      '#1c0a05',
      '#2c1108',
      '#3e190b',
      '#52220f',
      '#662c13',
      '#7a3718',
      '#8e441e',
      '#a25226',
      '#b46230',
      '#c4763e',
    ),
    CLOTH,
    RED,
    // Оправа очков — латунь.
    ramp('#3a2006', '#5e380c', '#865616', '#ae7a22', '#d29e34', '#ecc252', '#fadf86', '#fff4c6'),
    GLASS,
    ramp('#100a07', '#1a120d', '#251a13', '#32231a', '#402e22', '#50392b'),
    MOUTH,
    DUST,
    STEEL,
  ],
  [
    // Золотой: бронза в тени → золото → бледное золото в блике.
    ramp(
      '#180c02',
      '#261404',
      '#361e06',
      '#48280a',
      '#5c340e',
      '#704212',
      '#865218',
      '#9c6420',
      '#b47a2a',
      '#c89236',
      '#dcac48',
      '#ecc866',
      '#f8e294',
      '#fff6d4',
    ),
    ramp(
      '#4a3612',
      '#664c1c',
      '#836428',
      '#a07e38',
      '#ba984c',
      '#d0b062',
      '#e2c67e',
      '#efd99c',
      '#f8e8bc',
      '#fff6de',
    ),
    ramp(
      '#140a03',
      '#201005',
      '#2c1708',
      '#3a200c',
      '#4a2a10',
      '#5a3416',
      '#6c401c',
      '#7e4c22',
      '#925a2a',
      '#a66a34',
    ),
    CLOTH,
    RED,
    // Латунь пропала бы на золоте — у золотого оправа медная.
    ramp('#2a0e06', '#4a1c0c', '#6e2c14', '#94401e', '#b8582a', '#d4743c', '#e8945a', '#f6b884'),
    GLASS,
    ramp('#160a04', '#22100a', '#30180e', '#3e2014', '#4e2a1a', '#603622'),
    MOUTH,
    DUST,
    STEEL,
  ],
];
const INK_V: RGBA[] = [hx('#0c0503'), hx('#1a0d02')];
const WHITE = hx('#ffffff');

// ---------------------------------------------------------------------------
// Кадр: холст и рамка тела у двух полос (как у енота).
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
/** Трюк: за краем кадра таракан тает шахматкой (в шахте рамки не видно — резкий срез читался поломкой). */
const WIN0 = 25;
const WIN1 = 33;
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

type Eye = 'open' | 'half' | 'happy' | 'angry' | 'sleep' | 'shut';

export interface Pose {
  x: number;
  y: number;
  z: number;
  sq: number;
  lean: number;
  bow: number;
  /** Поворот всего тела вокруг вертикали (+ — передом вправо): бег вбок. */
  yaw: number;
  hx: number;
  hy: number;
  hz: number;
  turn: number;
  nod: number;
  tilt: number;
  /** Жвалы: 0 — сомкнуты, 1 — настежь; улыбка. */
  jaw: number;
  smile: number;
  /** Очки: 0 — на лбу, 1 — на глазах; правая верхняя рука держит оправу (0…1). */
  gog: number;
  grab: number;
  /** Усы: развести (оба наружу), свой качок левого и правого, вперёд, обвисли (сон). */
  antS: number;
  antL: number;
  antR: number;
  antF: number;
  droop: number;
  /** Кисти: a — верхняя пара, b — нижняя; L/R — левая и правая (в кадре); в координатах тела. */
  aLx: number;
  aLy: number;
  aLz: number;
  aRx: number;
  aRy: number;
  aRz: number;
  bLx: number;
  bLy: number;
  bLz: number;
  bRx: number;
  bRy: number;
  bRz: number;
  /** Большой палец вверх (правая верхняя). */
  thumb: number;
  /** Ступни: вбок (по кадру), вперёд, подъём; насколько ступни едут за телом по x. */
  fLx: number;
  fRx: number;
  fLy: number;
  fRy: number;
  fLz: number;
  fRz: number;
  carry: number;
  /** Бег: фаза цикла ног (рад) и смаз ног (0…1). */
  runPh: number;
  blur: number;
  eye: Eye;
  eyeL: Eye | null;
  eyeR: Eye | null;
  blink: number;
  chest: number;
  /** Отблеск, бегущий по щитку и надкрыльям (−1 — нет, 0…1 — где полоса). */
  shine: number;
  /** Трюк: линии скорости, смаз силуэта, пыль со старта, пыль юза, блик пальца. */
  speed: number;
  streak: number;
  dust1: number;
  dust2: number;
  glint: number;
  /** Хватка: лучи удара (0…1), −1 — нет. */
  bite: number;
  /** Сидит (сон). */
  sit: number;
  scale: number;
}

/** Кисти в покое: верхние — у пояса, нижние — ниже и шире (веером, как в туши). */
const HA: V3 = [8.9, 3.6, 12.2];
const HB: V3 = [12.4, 3.6, 7.6];

const REST: Pose = {
  x: 0,
  y: 0,
  z: 0,
  sq: 0,
  lean: 0,
  bow: 0,
  yaw: 0,
  hx: 0,
  hy: 0,
  hz: 0,
  turn: 0,
  nod: 0,
  tilt: 0,
  jaw: 0,
  smile: 0.5,
  gog: 0,
  grab: 0,
  antS: 0,
  antL: 0,
  antR: 0,
  antF: 0,
  droop: 0,
  aLx: -HA[0],
  aLy: HA[1],
  aLz: HA[2],
  aRx: HA[0],
  aRy: HA[1],
  aRz: HA[2],
  bLx: -HB[0],
  bLy: HB[1],
  bLz: HB[2],
  bRx: HB[0],
  bRy: HB[1],
  bRz: HB[2],
  thumb: 0,
  fLx: 0,
  fRx: 0,
  fLy: 0,
  fRy: 0,
  fLz: 0,
  fRz: 0,
  carry: 0,
  runPh: 0,
  blur: 0,
  eye: 'open',
  eyeL: null,
  eyeR: null,
  blink: 0,
  chest: 0,
  shine: -1,
  speed: 0,
  streak: 0,
  dust1: -1,
  dust2: -1,
  glint: -1,
  bite: -1,
  sit: 0,
  scale: 1,
};

const loopK = (t: number, T: number, keys: Key[]) => kf(wrap(t, T), keys);
const pos = (v: number) => Math.max(0, v);
const neg = (v: number) => Math.max(0, -v);
const TAU = Math.PI * 2;

type HandKey = 'aL' | 'aR' | 'bL' | 'bR';
const HAND_KEYS: HandKey[] = ['aL', 'aR', 'bL', 'bR'];

/** Кисть — смесь текущей и цели. */
function setH(o: Pose, h: HandKey, p: V3, k: number): void {
  const r = o as unknown as Record<string, number>;
  r[h + 'x'] = lerp(r[h + 'x'], p[0], k);
  r[h + 'y'] = lerp(r[h + 'y'], p[1], k);
  r[h + 'z'] = lerp(r[h + 'z'], p[2], k);
}
function handOf(o: Pose, h: HandKey): V3 {
  const r = o as unknown as Record<string, number>;
  return [r[h + 'x'], r[h + 'y'], r[h + 'z']];
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
    [0.85, 1, 'o'],
    [1.05, 0.95],
    [1.5, 0.05],
    [1.6, 0],
    [2.25, 0.8, 'o'],
    [2.5, 0.75],
    [2.95, 0],
    [3, 0],
  ]);
  o.chest = br;
  o.sq = -0.02 * br;
  o.hz = 0.3 * br;
  // Верхние руки потирают друг друга перед грудью (по-мушиному), глаза хитро прикрыты.
  const rub = loopK(t, T, [
    [0, 0],
    [0.85, 0],
    [1.1, 1, 'o'],
    [1.65, 1],
    [1.9, 0, 's'],
    [3, 0],
  ]);
  const ph = Math.sin(TAU * 5 * (t - 1.1)) * bump(t, 1.0, 1.75);
  setH(o, 'aL', [-1.7 + 0.5 * ph, 8.6, 18.0 + 0.4 * ph], rub);
  setH(o, 'aR', [1.7 + 0.5 * ph, 8.6, 18.0 - 0.4 * ph], rub);
  o.eye = rub > 0.6 ? 'half' : 'open';
  o.smile = REST.smile + 0.4 * rub;
  o.nod = 0.05 * rub;
  // Нижние руки барабанят по бокам брюшка по очереди.
  const drum = loopK(t, T, [
    [0, 0],
    [1.95, 0],
    [2.1, 1, 'o'],
    [2.65, 1],
    [2.85, 0, 's'],
    [3, 0],
  ]);
  const w = bump(t, 2.05, 2.75);
  const tL = pos(Math.sin(TAU * 6 * (t - 2.1))) * w;
  const tR = pos(-Math.sin(TAU * 6 * (t - 2.1))) * w;
  setH(o, 'bL', [-6.6 - 1.1 * tL, 5.6, 9.2 + 0.3 * tL], drum);
  setH(o, 'bR', [6.6 + 1.1 * tR, 5.6, 9.2 + 0.3 * tR], drum);
  // Глянул вбок.
  const look = loopK(t, T, [
    [0, 0],
    [2.2, 0],
    [2.3, 1, 'o'],
    [2.6, 1],
    [2.7, 0, 's'],
    [3, 0],
  ]);
  o.turn = 0.16 * look;
  o.tilt = 0.06 * look;
  o.lean = 0.014 * Math.sin((t / T) * TAU);
  o.x = 0.2 * Math.sin((t / T) * TAU);
  o.blink = Math.max(bump(t, 0.35, 0.5), bump(t, 2.8, 2.94));
  // Усы качаются каждый в своей фазе и дёргаются.
  o.antL = 0.07 * Math.sin((t / T) * TAU * 2) + 0.22 * bump(t, 1.95, 2.12);
  o.antR = 0.07 * Math.sin((t / T) * TAU * 2 + 1.9) + 0.26 * bump(t, 0.68, 0.84);
  o.antF = 0.05 * Math.sin((t / T) * TAU + 0.6);
  o.shine = t >= 1.15 && t < 1.85 ? (t - 1.15) / 0.7 : -1;
  return o;
}

function walkPose(t: number): Pose {
  const T = dur('walk');
  const o: Pose = { ...REST };
  const u = wrap(t, T) / T;
  // Семенит: четыре шага за секунду, ступня на полу стоит, поднятая — над своим следом.
  const la = bump(u, 0.01, 0.24) + bump(u, 0.51, 0.74);
  const lb = bump(u, 0.26, 0.49) + bump(u, 0.76, 0.99);
  o.fLz = 1.7 * la ** 0.8;
  o.fLy = 0.5 * la;
  o.fRz = 1.7 * lb ** 0.8;
  o.fRy = 0.5 * lb;
  const sw = Math.sin(u * TAU * 2);
  o.x = 0.35 * sw;
  o.lean = 0.05 * sw;
  o.z = -0.25 + 0.45 * Math.abs(sw);
  o.bow = 0.06;
  o.nod = 0.03 * Math.cos(u * TAU * 4);
  o.tilt = -0.05 * sw;
  // Руки работают накрест: верхняя левая вперёд — с нижней правой.
  const p = Math.sin(u * TAU * 2);
  setH(o, 'aL', [-8.4, 4.6 + 3.4 * p, 14.4 + 1.0 * p], 1);
  setH(o, 'aR', [8.4, 4.6 - 3.4 * p, 14.4 - 1.0 * p], 1);
  setH(o, 'bL', [-11.0, 3.8 - 2.6 * p, 8.4], 1);
  setH(o, 'bR', [11.0, 3.8 + 2.6 * p, 8.4], 1);
  o.smile = 0.75;
  o.antL = 0.06 * Math.sin(u * TAU * 2 + 0.4);
  o.antR = 0.06 * Math.sin(u * TAU * 2 + 2.0);
  o.antF = -0.12;
  return o;
}

function happyPose(t: number): Pose {
  const T = dur('happy');
  const o: Pose = { ...REST };
  // Два победных подскока, все четыре руки вверх.
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
  o.z = 2.6 * up;
  o.sq = -0.07 * rise;
  o.fLz = 0.5 * up;
  o.fRz = 0.5 * up;
  const arms = kf(t, [
    [0, 0],
    [0.12, 1, 'o'],
    [0.84, 1],
    [1.04, 0, 's'],
  ]);
  const wv = Math.sin(TAU * 3 * t) * env;
  // Верхние — «V» вверх-наружу мимо щитка (рука короткая: выше ушей не дотянуть).
  setH(o, 'aL', [-11.0 - 0.4 * wv, 3.6, 25.4 + 0.5 * wv], arms);
  setH(o, 'aR', [11.0 - 0.4 * wv, 3.6, 25.4 - 0.5 * wv], arms);
  setH(o, 'bL', [-13.2, 3.0, 17.2 - 0.6 * wv], arms);
  setH(o, 'bR', [13.2, 3.0, 17.2 + 0.6 * wv], arms);
  o.nod = -0.1 * up;
  o.tilt = 0.12 * Math.sin((t / T) * TAU) * env;
  o.eye = t < 0.9 ? 'happy' : 'open';
  o.jaw = 0.32 * env;
  o.smile = lerp(REST.smile, 1, env);
  o.antS = 0.22 * env;
  return o;
}

/** Где по x бежит таракан в трюке, «без обёртки»: растёт всё время забега (для пружин усов). */
function runV(t: number): number {
  return kf(t, [
    [0, 0],
    [0.52, 0],
    [0.74, 44, 'i'],
    [0.92, 116, 'l'],
    [1.2, 162, 'o'],
    [1.45, 160, 's'],
  ]);
}
/** Ушёл за правый край на 0,83 с — выходит слева (сдвиг на 160 делается, пока его не видно). */
const WRAP_T = 0.83;
const WRAP_X = 160;
const drawnX = (t: number) => (t < WRAP_T ? runV(t) : runV(t) - WRAP_X);

/**
 * Забег (2 с): очки на глаза (правая верхняя рука тянет оправу вниз, голова
 * кивает навстречу) → низкий старт (присел, развернулся вправо) → рывок за
 * правый край (ноги смазаны, смаз силуэта, линии скорости, пыль со старта) →
 * выбегает слева → юз до остановки (ноги вперёд, корпус назад, пыль из-под
 * ступней, усы по инерции вперёд) → «класс» правой верхней, блик → очки на
 * лоб той же рукой → покой.
 */
function workPose(t: number): Pose {
  const T = dur('work');
  const o: Pose = { ...REST };
  // Очки.
  o.gog = kf(t, [
    [0, 0],
    [0.12, 0],
    [0.27, 1, 's'],
    [1.7, 1],
    [1.84, 0, 's'],
    [T, 0],
  ]);
  const g1 = kf(t, [
    [0, 0],
    [0.03, 0],
    [0.12, 1, 'o'],
    [0.27, 1],
    [0.36, 0, 's'],
  ]);
  const g2 = kf(t, [
    [0, 0],
    [1.6, 0],
    [1.69, 1, 'o'],
    [1.84, 1],
    [1.94, 0, 's'],
  ]);
  o.grab = Math.max(g1, g2);
  o.nod = 0.3 * bump(t, 0.02, 0.32) + 0.26 * bump(t, 1.6, 1.94);
  // Старт.
  const crouch = kf(t, [
    [0, 0],
    [0.32, 0],
    [0.48, 1, 'o'],
    [0.56, 0.6],
    [0.7, 0.3],
    [1.2, 0.3],
    [1.3, 0, 's'],
  ]);
  o.yaw = kf(t, [
    [0, 0],
    [0.34, 0],
    [0.5, 0.75, 'o'],
    [1.26, 0.75],
    [1.44, 0, 's'],
  ]);
  o.sq = 0.1 * crouch;
  o.z = -0.9 * crouch;
  o.bow = 0.22 * crouch;
  // Бег: ноги по кругу 7 раз в секунду, смазаны; ступни едут вместе с телом.
  const run = kf(t, [
    [0, 0],
    [0.46, 0],
    [0.54, 1, 'o'],
    [1.12, 1],
    [1.24, 0, 's'],
  ]);
  o.runPh = TAU * 7 * clamp01((t - 0.46) / 0.78) * 0.78;
  o.blur = run;
  o.carry = kf(t, [
    [0, 0],
    [0.46, 0],
    [0.52, 1],
    [1.45, 1],
    [1.55, 0],
  ]);
  for (const side of [-1, 1]) {
    const ph = o.runPh + (side < 0 ? 0 : Math.PI);
    const dx = 2.2 * Math.sin(ph) * run;
    const lz = 1.5 * pos(Math.cos(ph)) * run;
    if (side < 0) {
      o.fLx = dx;
      o.fLz = lz;
    } else {
      o.fRx = dx;
      o.fRz = lz;
    }
  }
  o.x = drawnX(t);
  // Руки: на старте — как у бегуна, в беге — работают часто.
  const pump = Math.sin(o.runPh) * run;
  setH(o, 'aL', [-7.6, 7.8, 16.2], crouch);
  setH(o, 'aR', [8.6, 0.6, 14.4], crouch);
  setH(o, 'aL', [-8.2, 4.4 + 3.6 * pump, 15.0], run);
  setH(o, 'aR', [8.2, 4.4 - 3.6 * pump, 15.0], run);
  setH(o, 'bL', [-11.0, 3.4 - 2.8 * pump, 9.0], run);
  setH(o, 'bR', [11.0, 3.4 + 2.8 * pump, 9.0], run);
  o.speed = kf(t, [
    [0, 0],
    [0.52, 0],
    [0.6, 1, 'o'],
    [0.76, 1],
    [0.9, 0.3],
    [0.93, 1],
    [1.12, 1],
    [1.26, 0, 's'],
  ]);
  o.streak = kf(t, [
    [0, 0],
    [0.54, 0],
    [0.64, 1, 'o'],
    [0.95, 1],
    [1.1, 0.8],
    [1.2, 0, 's'],
  ]);
  o.dust1 = t >= 0.5 && t < 1.04 ? (t - 0.5) / 0.54 : -1;
  // Юз: ступни упёрлись вперёд (по ходу), корпус откинут назад.
  const skid = kf(t, [
    [0, 0],
    [1.1, 0],
    [1.18, 1, 'o'],
    [1.36, 1],
    [1.5, 0, 's'],
  ]);
  o.lean = -0.18 * skid;
  o.fLx += 1.6 * skid;
  o.fRx += 1.6 * skid;
  o.dust2 = t >= 1.12 && t < 1.64 ? (t - 1.12) / 0.52 : -1;
  setH(o, 'aL', [-10.6, 2.6, 18.4], skid);
  setH(o, 'aR', [10.8, 4.0, 13.0], skid);
  setH(o, 'bL', [-12.6, 2.6, 12.0], skid);
  setH(o, 'bR', [12.4, 3.6, 6.8], skid);
  // «Класс»: правая верхняя кулаком вверх у плеча, блик на пальце.
  o.thumb = kf(t, [
    [0, 0],
    [1.4, 0],
    [1.48, 1, 'o'],
    [1.58, 1],
    [1.64, 0, 's'],
  ]);
  setH(o, 'aR', [9.4, 6.2, 22.6], o.thumb);
  o.glint = t >= 1.47 && t < 1.64 ? (t - 1.47) / 0.17 : -1;
  const joy = bump(t, 1.38, 1.7);
  o.eye = t >= 1.42 && t < 1.64 ? 'happy' : 'open';
  o.smile = REST.smile + 0.5 * joy;
  o.tilt = 0.1 * joy;
  o.antF = -0.3 * crouch + 0.15 * joy;
  o.antS = 0.12 * joy;
  return o;
}

/** Взмах верхней руки в броске (0 — замах, 1 — у середины живота); `j` — 0 правая, 1 левая. */
function swipeU(t: number, j: number): number {
  const d = 0.045 * j;
  return kf(t, [
    [0.3 + d, 0],
    [0.42 + d, 1, 'o'],
  ]);
}
/** Путь кисти при взмахе (координаты тела): дуга сверху-снаружи вперёд и вниз к середине. */
function swipePath(side: number, u: number): V3 {
  const a: V3 = [side * 10.6, 0.8, 25.2];
  const b: V3 = [side * 7.8, 8.6, 22.4];
  const e: V3 = [side * 1.6, 7.2, 15.0];
  const v = 1 - u;
  return [0, 1, 2].map((i) => v * v * a[i] + 2 * v * u * b[i] + u * u * e[i]) as V3;
}

function attackPose(t: number): Pose {
  const T = dur('attack');
  const o: Pose = { ...REST };
  // Присел, руки замахнулись → бросок к зрителю, жвалы настежь, четыре руки
  // режут накрест (кадры 8–11), усы вперёд → приземлился, тряхнул головой.
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
  o.z = -0.8 * neg(l) + 1.8 * air;
  o.bow = 0.14 * neg(l) + 0.06 * pos(l);
  o.nod = 0.12 * neg(l) - 0.2 * pos(l);
  o.x = 0.3 * Math.sin(t * TAU * 9) * bump(t, 0.04, 0.27);
  const crouch = neg(l);
  const strike = pos(l);
  // Руки: подняты в замах → верхние режут сверху-снаружи вниз к середине (правая
  // первой), нижние выбрасываются вперёд → возврат в покой.
  const eng = kf(t, [
    [0, 0],
    [0.2, 1, 'o'],
    [0.56, 1],
    [0.84, 0, 's'],
  ]);
  const uR = swipeU(t, 0);
  const uL = swipeU(t, 1);
  setH(o, 'aR', swipePath(1, uR), eng);
  setH(o, 'aL', swipePath(-1, uL), eng);
  const ub = kf(t, [
    [0.33, 0],
    [0.43, 1, 'o'],
  ]);
  setH(o, 'bL', lerp3([-12.8, 0.4, 13.4], [-10.6, 8.8, 11.2], ub), eng);
  setH(o, 'bR', lerp3([12.8, 0.4, 13.4], [10.6, 8.8, 11.2], ub), eng);
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
  o.smile = REST.smile * (1 - bump(t, 0, T));
  o.eye = t < 0.7 ? 'angry' : 'open';
  o.antF = 0.9 * strike - 0.45 * crouch;
  o.antS = 0.18 * crouch;
  o.turn = 0.18 * Math.sin(((t - 0.5) / 0.17) * TAU) * bump(t, 0.5, 0.76);
  o.fLz = 0.8 * air;
  o.fRz = 0.8 * air;
  o.bite = t >= 0.35 && t < 0.56 ? (t - 0.35) / 0.21 : -1;
  return o;
}

function sleepPose(t: number): Pose {
  const T = dur('sleep');
  const o: Pose = { ...REST };
  // Сидит, ссутулившись, очки на глазах, усы обвисли.
  o.sit = 1;
  o.z = -2.6;
  o.eye = 'sleep';
  o.gog = 1;
  o.droop = 1;
  const br = loopK(t, T, [
    [0, 0],
    [1.3, 1, 's'],
    [1.55, 1],
    [2.9, 0, 's'],
    [3, 0],
  ]);
  o.chest = br;
  o.nod = 0.2 + 0.04 * br;
  o.tilt = 0.12;
  o.bow = 0.1;
  o.hz = -0.3 + 0.25 * br;
  o.sq = -0.04 * br;
  setH(o, 'aL', [-1.6, 7.4, 13.0], 1);
  setH(o, 'aR', [2.6, 7.2, 12.2], 1);
  setH(o, 'bL', [-11.0, 3.4, 3.9], 1);
  setH(o, 'bR', [11.0, 3.4, 3.9], 1);
  o.smile = 0.3;
  o.antL = 0.04 * br;
  o.antR = -0.03 * br;
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
// Скелет (в пикселях малой полосы): стоит и сидит (сон).
// ---------------------------------------------------------------------------

interface Plan {
  body: V3;
  bodyR: V3;
  head: V3;
  shA: V3;
  shB: V3;
  hip: V3;
  foot: V3;
}
const STAND: Plan = {
  body: [0, 0.6, 12.4],
  bodyR: [9.0, 5.8, 9.0],
  head: [0, 1.6, 28.6],
  shA: [6.0, 1.2, 18.4],
  shB: [8.2, 1.6, 13.0],
  hip: [3.4, 1.2, 5.4],
  foot: [5.0, 2.8, 0],
};
const SIT: Plan = {
  body: [0, 0.6, 12.4],
  bodyR: [9.2, 6.0, 8.8],
  head: [0, 2.6, 27.8],
  shA: [6.0, 1.2, 18.4],
  shB: [8.2, 1.6, 13.0],
  hip: [3.8, 1.8, 5.4],
  foot: [5.8, 7.6, 0],
};

function planOf(o: Pose): Plan {
  const m = (k: keyof Plan): V3 => lerp3(STAND[k], SIT[k], o.sit);
  return {
    body: m('body'),
    bodyR: m('bodyR'),
    head: m('head'),
    shA: m('shA'),
    shB: m('shB'),
    hip: m('hip'),
    foot: m('foot'),
  };
}

interface Skel {
  up: (p: V3) => V3;
  dir: (v: V3) => V3;
  pl: Plan;
  head: V3;
  /** Плечи и кисти: aL, aR, bL, bR. */
  sh: V3[];
  hand: V3[];
  hip: V3[];
  foot: V3[];
  bc: V3;
  bax: [V3, V3, V3];
  br: V3;
  k: number;
}

/** Масштаб модели в рамке: ступни — макушка ~37 пикселей малой полосы, усы — до ~45. */
const G = 1.0;

function bodyUp(o: Pose): (p: V3) => V3 {
  const s = o.scale * G;
  const sq = o.sq;
  return (p: V3): V3 => {
    let q: V3 = [p[0] * (1 + sq * 0.5), p[1] * (1 + sq * 0.4), p[2] * (1 - sq)];
    q = pitchX(q, o.bow, [0, 0, 3]);
    q = rollY(q, o.lean, [0, 0, 0]);
    q = yawZ(q, o.yaw);
    q = mul(q, s);
    return add(q, [o.x, o.y, o.z]);
  };
}

/** Голова без скелета целиком (для пружин): быстро. */
function headPos(o: Pose): V3 {
  const pl = planOf(o);
  return bodyUp(o)(add(pl.head, [o.hx, o.hy, o.hz]));
}

/** Точка мира → координаты тела позы (обратное к `up`): рука тянется в точку. */
function toBody(o: Pose, p: V3): V3 {
  const s = o.scale * G;
  let q = mul(sub(p, [o.x, o.y, o.z]), 1 / s);
  q = yawZ(q, -o.yaw);
  q = rollY(q, -o.lean, [0, 0, 0]);
  q = pitchX(q, -o.bow, [0, 0, 3]);
  return [q[0] / (1 + o.sq * 0.5), q[1] / (1 + o.sq * 0.4), q[2] / (1 - o.sq)];
}

function skel(o: Pose): Skel {
  const s = o.scale * G;
  const pl = planOf(o);
  const up = bodyUp(o);
  const dir = (v: V3): V3 => yawZ(rollY(pitchX(v, o.bow), o.lean), o.yaw);
  // Ступня на полу не едет за телом (кроме бега и юза — `carry`); подъём — только у поднятой.
  const lift = Math.max(0, o.z);
  const foot = (side: number, dx: number, dy: number, dz: number): V3 => {
    const p = yawZ([side * pl.foot[0], pl.foot[1] + dy, 0], o.yaw);
    return [p[0] * s + o.x * o.carry + dx, p[1] * s + o.y, dz + lift];
  };
  const ch = o.chest;
  return {
    up,
    dir,
    pl,
    head: up(add(pl.head, [o.hx, o.hy, o.hz])),
    sh: [
      up([-pl.shA[0], pl.shA[1], pl.shA[2]]),
      up([pl.shA[0], pl.shA[1], pl.shA[2]]),
      up([-pl.shB[0], pl.shB[1], pl.shB[2]]),
      up([pl.shB[0], pl.shB[1], pl.shB[2]]),
    ],
    hand: HAND_KEYS.map((k) => up(handOf(o, k))),
    hip: [up([-pl.hip[0], pl.hip[1], pl.hip[2]]), up([pl.hip[0], pl.hip[1], pl.hip[2]])],
    foot: [foot(-1, o.fLx, o.fLy, o.fLz), foot(1, o.fRx, o.fRy, o.fRz)],
    bc: up(add(pl.body, [0, 0.2 * ch, 0])),
    bax: axes(dir([1, 0, 0]), dir([0, 0, 1])),
    br: mul([pl.bodyR[0] * (1 + 0.02 * ch), pl.bodyR[1] * (1 + 0.04 * ch), pl.bodyR[2]], s),
    k: s,
  };
}

interface HeadF {
  at: (p: V3) => V3;
  dir: (v: V3) => V3;
  k: number;
}

// ---------------------------------------------------------------------------
// Части.
// ---------------------------------------------------------------------------

interface Lag {
  /** Голова отстаёт от тела (смещение). */
  hX: number;
  hZ: number;
  /** Кончики усов отстают от головы (смещение кончика). */
  aX: number;
  aY: number;
  aZ: number;
}

interface Ctx {
  o: Pose;
  S: Skel;
  h: HeadF;
  lag: Lag;
  t: number;
}

/** Часть с выбором палитры по точке, светом трубы и проявлением. */
interface PartF extends Part {
  pick?: (qx: number, qy: number, qz: number) => number;
  /** Свет как у трубы: нормаль без составляющей вдоль оси. */
  tube?: boolean;
  /** Проявление шахматкой (пыль тает, смаз ног). */
  vis?: number;
}
/** Сдвиг тона, который `pick` возвращает вместе с палитрой. */
let PICK_T = 0;

let NEXT_ID = 0;
const nid = () => ++NEXT_ID;
/** Номера рук и ног: вокруг них по дальним частям — тёмная кромка (руки не тонут в надкрыльях). */
const LIMB_IDS = new Set<number>();
const lid = () => {
  const id = nid();
  LIMB_IDS.add(id);
  return id;
};

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

/** Полувектор «свет + взгляд»: блик лака стоит там, где он у глянцевого панциря. */
const HV = norm(add(LIGHT, VIEW));
/** Блик ступенями по нормали части (пиксель любит плато): `amt` — насколько светлее середина. */
function gloss(ax: [V3, V3, V3], r: V3, amt: number, lo = 0.8, hi = 0.93, streak = 0) {
  const [e1, e2, e3] = ax;
  return (qx0: number, qy: number, qz: number) => {
    // `streak` гасит составляющую вдоль первой оси: блик тянется полосой вдоль пластины.
    const qx = qx0 * (1 - streak);
    const nx = (e1[0] * qx) / r[0] + (e2[0] * qy) / r[1] + (e3[0] * qz) / r[2];
    const ny = (e1[1] * qx) / r[0] + (e2[1] * qy) / r[1] + (e3[1] * qz) / r[2];
    const nz = (e1[2] * qx) / r[0] + (e2[2] * qy) / r[1] + (e3[2] * qz) / r[2];
    const s = (nx * HV[0] + ny * HV[1] + nz * HV[2]) / (Math.hypot(nx, ny, nz) || 1);
    return s > hi ? amt : s > lo ? amt * 0.45 : 0;
  };
}
/** Бегущий отблеск: косая полоса по пластине (`sp` — где она, −1 — нет). */
function shineBand(sp: number, a: number, b: number) {
  if (sp < 0) return (_qx: number, _qz: number) => 0;
  const at = lerp(-1.5, 1.5, sp);
  return (qx: number, qz: number) => {
    const d = Math.abs(a * qx + b * qz - at);
    return d < 0.1 ? 0.3 : d < 0.2 ? 0.12 : 0;
  };
}

/** Надкрылья: два плоских овала за спиной, низ разведён наружу; жилка вдоль, кромка светлее, блик. */
function wings(out: PartF[], c: Ctx): void {
  const { o, S } = c;
  const k = S.k;
  for (const side of [-1, 1]) {
    const ax = axes(S.dir(norm([side * 0.17, 0, 1])), S.dir([side, -0.25, 0]));
    const r: V3 = [10.6 * k, 2.4 * k, 6.0 * k];
    const gl = gloss(ax, r, 0.3, 0.93, 0.975, 0.85);
    const sh = shineBand(o.shine, 0.7, side * 0.5);
    out.push({
      c: S.up([side * 5.4, -3.8, 12.0]),
      ax,
      r,
      pal: P_SHELL,
      id: nid(),
      bias: -0.24,
      tex: (qx, qy, qz) => {
        let d = gl(qx, qy, qz) + sh(qx, qz);
        // Жилки вдоль (крупная — две), наружная кромка светлее; блик — полосой вдоль
        // видимой наружной части (у левого, к свету, ярче).
        const w = side * qz;
        if (w > 0.48 && w < (HI ? 0.62 : 0.66) && qx > -0.4 && qx < 0.72)
          d += side < 0 ? 0.42 : 0.22;
        if (Math.abs(w - 0.3 - 0.08 * qx) < (HI ? 0.06 : 0.09) && qx > -0.85) d -= 0.16;
        if (HI && Math.abs(w + 0.25 - 0.05 * qx) < 0.05 && qx > -0.7 && qx < 0.8) d -= 0.12;
        if (w > 0.86) d += 0.08;
        return d;
      },
    });
  }
}

/** Щиток (переднеспинка) за головой: широкая глянцевая пластина, кайма бледная, по центру тёмные пятна. */
function shield(out: PartF[], c: Ctx): void {
  const { o, S } = c;
  const k = S.k;
  const ax = axes(S.dir([1, 0, 0]), S.dir([0, -Math.sin(0.3), Math.cos(0.3)]));
  const r: V3 = [13.4 * k, 2.4 * k, 5.6 * k];
  const gl = gloss(ax, r, 0.3, 0.93, 0.975, 0.8);
  const sh = shineBand(o.shine, 0.75, -0.66);
  out.push({
    c: S.up([0, -3.2, 24.8]),
    ax,
    r,
    pal: P_SHELL,
    id: nid(),
    bias: -0.3,
    pick: (qx, qy, qz) => {
      PICK_T = 0;
      const rr = qx * qx + qz * qz;
      // Кайма — узкая и тёмно-охристая: широкая бледная читалась капюшоном.
      if (rr > (HI ? 0.955 : 0.94) && qy > -0.2) {
        PICK_T = -0.32;
        return P_BELLY;
      }
      if (
        HI &&
        ((qx - 0.32) ** 2 + (qz - 0.05) ** 2 < 0.05 || (qx + 0.32) ** 2 + (qz - 0.05) ** 2 < 0.05)
      )
        PICK_T = -0.12;
      return P_SHELL;
    },
    tex: (qx, qy, qz) => {
      let d = gl(qx, qy, qz) + sh(qx, qz);
      // Блик — дугой по верху каждой лопасти (видна сбоку от головы).
      const ax0 = Math.abs(qx);
      if (
        ax0 > 0.6 &&
        ax0 < 0.92 &&
        qz > 0.28 - 0.25 * (ax0 - 0.6) &&
        qz < 0.44 - 0.25 * (ax0 - 0.6)
      )
        d += qx < 0 ? 0.42 : 0.24;
      return d;
    },
  });
}

/** Брюшко: светлый овал спереди с сегментами, на нём номер — белая тряпица. */
const BIB_X = 0.4;
const BIB_Z0 = 0.06;
const BIB_Z1 = 0.6;
function bodyPick(qx: number, qy: number, qz: number): number {
  PICK_T = 0;
  if (qy > 0.3 && Math.abs(qx) < BIB_X && qz > BIB_Z0 && qz < BIB_Z1) {
    const ex = BIB_X - Math.abs(qx);
    const ez = Math.min(qz - BIB_Z0, BIB_Z1 - qz);
    if (ex < (HI ? 0.04 : 0.06) || ez < (HI ? 0.04 : 0.05)) PICK_T = -0.14;
    else if (HI && ((qx * 40 + qz * 40 + 200) | 0) % 3 === 0) PICK_T = -0.04;
    return P_CLOTH;
  }
  const bx = qx / 0.76;
  const bz = (qz + 0.02) / 0.95;
  const e = bx * bx + bz * bz;
  if (qy > 0.12 && e < 1) {
    // Сегменты — дуги, провисшие к середине.
    const v = (qz + 0.07 * (1 - (qx * qx) / 0.58) + 1) * (HI ? 4.2 : 2.8);
    const fv = v - Math.floor(v);
    if (fv < (HI ? 0.13 : 0.2)) PICK_T = -0.2;
    else if (HI && fv < 0.24) PICK_T = 0.04;
    if (e > 0.86) PICK_T -= 0.08;
    return P_BELLY;
  }
  PICK_T = -0.06;
  return P_SHELL;
}

function body(out: PartF[], c: Ctx): void {
  const { S } = c;
  out.push({ c: S.bc, ax: S.bax, r: S.br, pal: P_SHELL, id: nid(), bias: 0.0, pick: bodyPick });
}

/** Ноги: бедро наружу, голень с шипами, лапка вперёд с коготком. */
function legGeo(
  S: Skel,
  side: number,
  foot: V3,
  yaw: number,
): { hip: V3; knee: V3; ank: V3; toe: V3 } {
  const k = S.k;
  const hip = S.hip[side < 0 ? 0 : 1];
  const off = (p: V3): V3 => mul(yawZ(p, yaw), k);
  const ank = add(foot, off([side * 0.1, -1.0, 1.1]));
  const toe = add(foot, off([side * 0.5, 1.7, 0.3]));
  const [knee] = ik(hip, ank, 3.3 * k, 3.6 * k, norm([side, 0.3, 0.6]));
  return { hip, knee, ank, toe };
}

function legParts(out: PartF[], g: { hip: V3; knee: V3; ank: V3; toe: V3 }, k: number, vis = 1) {
  const id = lid();
  limb(out, g.hip, g.knee, 1.25 * k, 1.2 * k, P_LEG, id, { tube: true, bias: 0.06, vis });
  limb(out, g.knee, g.ank, 0.95 * k, 0.9 * k, P_LEG, lid(), { tube: true, bias: 0.1, vis });
  limb(out, g.ank, g.toe, 0.72 * k, 0.6 * k, P_LEG, lid(), { tube: true, bias: 0.14, vis });
}

function legs(out: PartF[], c: Ctx): void {
  const { o, S } = c;
  const k = S.k;
  for (const side of [-1, 1]) {
    const foot = S.foot[side < 0 ? 0 : 1];
    legParts(out, legGeo(S, side, foot, o.yaw), k);
    // Смаз ног в беге: та же нога на четверть круга раньше — шахматкой.
    if (o.blur > 0.05) {
      const ph = o.runPh + (side < 0 ? 0 : Math.PI) - Math.PI / 2;
      const dx = 2.2 * Math.sin(ph) * o.blur;
      const lz = 1.5 * pos(Math.cos(ph)) * o.blur;
      const f2: V3 = [foot[0] - (side < 0 ? o.fLx : o.fRx) + dx, foot[1], Math.max(0, o.z) + lz];
      legParts(out, legGeo(S, side, f2, o.yaw), k, 0.42 * o.blur);
    }
  }
}

/** Шипы на голенях — тонкие прутья наружу-вниз. */
function spines(f: Frame, c: Ctx): void {
  const { o, S } = c;
  for (const side of [-1, 1]) {
    const g = legGeo(S, side, S.foot[side < 0 ? 0 : 1], o.yaw);
    const d = norm(sub(g.ank, g.knee));
    const out0: V3 = [side, 0.15, 0.1];
    const n = norm(sub(out0, mul(d, dot(out0, d))));
    const us = HI ? [0.28, 0.5, 0.72, 0.9] : [0.4, 0.78];
    for (const u of us) {
      const b = add(lerp3(g.knee, g.ank, u), mul(n, 0.7 * S.k));
      const tip = add(b, mul(norm(add(n, mul(d, 0.7))), (HI ? 1.2 : 1.1) * S.k));
      rod(f, b, tip, HI ? 0.8 : 0.6, P_LEG, HI ? 6 : 7);
    }
    if (HI) {
      const d1 = norm(sub(g.knee, g.hip));
      const n1 = norm(sub([side, 0, 0.6], mul(d1, dot([side, 0, 0.6], d1))));
      const b = add(lerp3(g.hip, g.knee, 0.6), mul(n1, 1.0 * S.k));
      rod(f, b, add(b, mul(norm(add(n1, mul(d1, 0.6))), 1.2 * S.k)), 0.8, P_LEG, 6);
    }
  }
}

/** Где держать оправу очков (правое стекло, снизу снаружи) — в координатах головы. */
function rimGrip(gog: number): V3 {
  const { c, n } = lensAt(1, gog);
  return add(add(c, [1.5, 0.3, -1.6]), mul(n, 1.0));
}

function arms(out: PartF[], c: Ctx): void {
  const { o, S, h } = c;
  const k = S.k;
  for (let j = 0; j < 4; j++) {
    const side = j % 2 === 0 ? -1 : 1;
    const upper = j < 2;
    const sh = S.sh[j];
    let hand = S.hand[j];
    // Правая верхняя держит оправу очков: цель — точка оправы в мире (голова кивает навстречу).
    if (j === 1 && o.grab > 0.001) {
      const grip = S.up(toBody(o, h.at(rimGrip(o.gog))));
      hand = lerp3(hand, grip, o.grab);
    }
    const pole = upper
      ? norm(lerp3([side * 1, -0.5, 0.1], [side * 0.6, 0.2, -1], o.sit))
      : norm(lerp3([side * 0.85, -0.35, -0.45], [side * 0.5, -0.2, 0.6], o.sit));
    const l1 = (upper ? 4.6 : 4.2) * k;
    const l2 = (upper ? 4.4 : 4.0) * k;
    const [elb, wr] = ik(sh, hand, l1, l2, pole);
    const id = lid();
    limb(out, sh, elb, (upper ? 1.15 : 1.05) * k, (upper ? 1.15 : 1.05) * k, P_LEG, id, {
      tube: true,
      bias: 0.1,
    });
    limb(out, elb, wr, (upper ? 1.0 : 0.95) * k, (upper ? 1.0 : 0.95) * k, P_LEG, id, {
      tube: true,
      bias: 0.14,
    });
    // Кисть-лапка: шарик, на крупной — два пальца-коготка.
    const d = norm(sub(wr, elb));
    const hc = add(wr, mul(d, 0.7 * k));
    const hid = lid();
    out.push({
      c: hc,
      ax: axes(d, [0, 1, 0]),
      r: [1.55 * k, 1.35 * k, 1.35 * k],
      pal: P_LEG,
      id: hid,
      bias: 0.18,
    });
    if (j === 1 && o.thumb > 0.05) {
      // Кулак, большой палец вверх.
      out.push({
        c: add(hc, [0.2 * k, 0.3 * k, 1.6 * k * o.thumb]),
        ax: axes([0, 0.15, 1], [0, 1, 0]),
        r: [1.05 * k * o.thumb, 0.6 * k, 0.6 * k],
        pal: P_LEG,
        id: hid,
        bias: 0.2,
      });
    } else if (HI) {
      for (const a of [-0.45, 0.45]) {
        const fd = norm(rollY(d, a * side));
        out.push({
          c: add(hc, mul(fd, 1.4 * k)),
          ax: axes(fd, [0, 1, 0]),
          r: [0.75 * k, 0.42 * k, 0.42 * k],
          pal: P_LEG,
          id: hid,
          bias: 0.08,
        });
      }
    }
  }
}

/** Где кисть с поднятым пальцем: кончик пальца (для блика). */
function thumbTip(c: Ctx): V3 {
  const { o, S } = c;
  const k = S.k;
  const sh = S.sh[1];
  const pole = norm(lerp3([1, -0.5, 0.1], [0.6, 0.2, -1], o.sit));
  const [elb, wr] = ik(sh, S.hand[1], 4.6 * k, 4.4 * k, pole);
  const d = norm(sub(wr, elb));
  const hc = add(wr, mul(d, 0.7 * k));
  return add(hc, [0.2 * k, 0.3 * k, 2.7 * k * o.thumb]);
}

// ---------------------------------------------------------------------------
// Голова.
// ---------------------------------------------------------------------------

const HEAD_R: V3 = [9.0, 7.4, 8.2];
/** Очки: угол над осью взгляда (на лбу — 0,95, на глазах — 0,1). */
const gogTheta = (g: number) => lerp(0.95, 0.1, g);
let STRAP_TH = 0.95;

/** Стекло очков на голове: центр и нормаль (координаты головы). */
function lensAt(side: number, gog: number): { c: V3; n: V3 } {
  const th = gogTheta(gog);
  const x = side * 3.4;
  const f = Math.sqrt(1 - (x / HEAD_R[0]) ** 2);
  const p: V3 = [x, HEAD_R[1] * f * Math.cos(th), HEAD_R[2] * f * Math.sin(th)];
  const n = norm([p[0] / HEAD_R[0] ** 2, p[1] / HEAD_R[1] ** 2, p[2] / HEAD_R[2] ** 2]);
  return { c: add(p, mul(n, 0.55)), n };
}

/** Череп: каштан с бликом, белая гоночная полоса с красной каймой, ремешок очков. */
function skullPick(qx: number, qy: number, qz: number): number {
  PICK_T = 0;
  const ax0 = Math.abs(qx);
  // Ремешок — кольцо через ось x под углом очков.
  const sb = -Math.sin(STRAP_TH) * qy + Math.cos(STRAP_TH) * qz;
  if (Math.abs(sb) < (HI ? 0.1 : 0.13) && ax0 > 0.6) {
    PICK_T = HI && Math.abs(sb) > 0.06 ? -0.12 : 0;
    return P_STRAP;
  }
  if (qz > 0.28 && qy > -0.6) {
    if (ax0 < (HI ? 0.1 : 0.12)) {
      PICK_T = 0.02;
      return P_CLOTH;
    }
    if (ax0 < (HI ? 0.17 : 0.2)) return P_RED;
  }
  return P_SHELL;
}

function headParts(out: PartF[], c: Ctx): void {
  const { o, h } = c;
  const k = h.k;
  const hax = axes(h.dir([1, 0, 0]), h.dir([0, 0, 1]));
  const hr = mul(HEAD_R, k);
  const gl = gloss(hax, hr, 0.36, 0.87, 0.95);
  STRAP_TH = gogTheta(o.gog);
  out.push({
    c: h.at([0, 0, 0]),
    ax: hax,
    r: hr,
    pal: P_SHELL,
    id: nid(),
    bias: -0.06,
    pick: skullPick,
    tex: (qx, qy, qz) => gl(qx, qy, qz),
  });
  // Мордочка — бледный овал под глазами.
  const mid = nid();
  out.push({
    c: h.at([0, 6.0, -3.6]),
    ax: hax,
    r: [3.4 * k, 1.9 * k, 2.4 * k],
    pal: P_BELLY,
    id: mid,
    bias: 0.0,
  });
  // Пасть, когда жвалы разошлись.
  const jw = o.jaw;
  if (jw > 0.08) {
    out.push({
      c: h.at([0, 7.0, -5.0 - 0.3 * jw]),
      ax: hax,
      r: [2.2 * k, 1.0 * k, (0.5 + 1.5 * jw) * k],
      pal: P_MOUTH,
      id: nid(),
      bias: -0.05,
      noSeam: true,
    });
  }
  // Жвалы: два крючка под мордочкой, расходятся наружу.
  for (const side of [-1, 1]) {
    const base: V3 = [side * 2.1, 7.5, -5.4];
    const d = norm(lerp3([-side * 0.35, 0.4, -1], [side * 1.0, 0.45, -0.4], jw));
    const inw: V3 = [-side * 0.6, 0.2, 0];
    const id = nid();
    out.push({
      c: h.at(add(base, mul(d, 0.8))),
      ax: axes(h.dir(d), h.dir([0, 1, 0])),
      r: [(1.15 + 0.35 * jw) * k, 0.8 * k, 0.8 * k],
      pal: P_LEG,
      id,
      bias: -0.22,
    });
    out.push({
      c: h.at(add(add(base, mul(d, 1.9 + 0.5 * jw)), mul(inw, 0.5 + 0.4 * jw))),
      ax: axes(h.dir(norm(add(d, inw))), h.dir([0, 1, 0])),
      r: [(0.85 + 0.3 * jw) * k, 0.5 * k, 0.5 * k],
      pal: P_LEG,
      id,
      bias: -0.3,
    });
  }
}

/** Очки: два стекла в оправе и перемычка; на лбу или на глазах. */
function goggles(out: PartF[], c: Ctx): void {
  const { o, h } = c;
  const k = h.k;
  const gid = nid();
  for (const side of [-1, 1]) {
    const { c: lc, n } = lensAt(side, o.gog);
    out.push({
      c: h.at(lc),
      ax: axes(h.dir([1, 0, 0]), h.dir(n)),
      r: [2.5 * k, 2.5 * k, 0.9 * k],
      pal: P_BRASS,
      id: gid,
      bias: 0.06,
      pick: (qx, qy) => {
        PICK_T = 0;
        const r = Math.hypot(qx, qy);
        if (r < (HI ? 0.7 : 0.62)) {
          // Блик сверху слева (ось 2 смотрит вниз).
          const gl = qx < -0.08 && qy < -0.08 && r > 0.2 && r < 0.52;
          PICK_T = -0.06 + (gl ? 0.5 : 0) + (HI && qx > 0.3 && qy > 0.3 && r < 0.6 ? 0.2 : 0);
          return P_GLASS;
        }
        PICK_T = HI && r > 0.9 ? -0.1 : 0.04;
        return P_BRASS;
      },
    });
  }
  const th = gogTheta(o.gog);
  const bn = norm([0, Math.cos(th) / HEAD_R[1], Math.sin(th) / HEAD_R[2]]);
  const bp: V3 = [0, HEAD_R[1] * Math.cos(th), HEAD_R[2] * Math.sin(th)];
  out.push({
    c: h.at(add(bp, mul(bn, 0.5))),
    ax: axes(h.dir([1, 0, 0]), h.dir(bn)),
    r: [1.3 * k, 0.6 * k, 0.55 * k],
    pal: P_BRASS,
    id: gid,
    bias: 0.04,
  });
}

/** Усы: от макушки вверх и вбок, левый надломлен у кончика; качаются, отстают, обвисают. */
function antPts(c: Ctx, side: number): V3[] {
  const { o, h, lag } = c;
  const s = side;
  const B: V3 = [s * 2.0, 1.0, 8.0];
  const P: V3[] = [
    [0, 0, 0],
    [s * 0.8, 0.8, 3.6],
    [s * 3.4, 0.6, 7.0],
    [s * 6.8, 0.0, 8.0],
    [s * 10.4, -0.6, 7.9],
  ];
  if (s < 0) P[4] = add(P[3], [s * 1.5, 0.5, -2.8]);
  const sp = (s < 0 ? o.antL : o.antR) + o.antS + 1.0 * o.droop;
  const out: V3[] = [];
  const n = P.length - 1;
  P.forEach((p, i) => {
    const u = i / n;
    let q = rollY(p, s * sp);
    q = pitchX(q, o.antF + 0.45 * o.droop);
    q = add(q, [0, 0, -2.6 * o.droop * u * u]);
    const w = h.at(add(B, q));
    const lu = u ** 1.6;
    out.push(add(w, [lag.aX * lu, lag.aY * lu, lag.aZ * lu]));
  });
  return out;
}

function antennae(f: Frame, c: Ctx): void {
  for (const side of [-1, 1]) {
    const P = antPts(c, side);
    const n = HI ? 30 : 16;
    const pts: V3[] = [];
    for (let i = 0; i <= n; i++) {
      // Левый надломлен: последний отрезок — прямой (без сглаживания).
      const u = i / n;
      if (side < 0 && u > 0.75) pts.push(lerp3(P[3], P[4], (u - 0.75) / 0.25));
      else pts.push(catmull(side < 0 ? P.slice(0, 4) : P, side < 0 ? u / 0.75 : u));
    }
    for (let i = 0; i < n; i++) {
      const u = i / n;
      const wid = HI ? (u < 0.25 ? 1.8 : 1.4) : 0.7;
      // Членики на крупной — каждый третий отрезок светлее.
      const tone = HI && i % 3 === 0 && u > 0.1 ? 8 : 7;
      rod(f, pts[i], pts[i + 1], wid, P_SHELL, tone);
    }
  }
}

/** Пыль: клубы со светом сверху-слева, растут и тают. */
function dust(out: PartF[], c: Ctx): void {
  const { o, S } = c;
  if (o.dust1 >= 0) {
    // Со старта: ступни оттолкнулись — пыль назад (влево) и вверх.
    const u = o.dust1;
    const grow = clamp01(u / 0.12);
    for (let i = 0; i < 5; i++) {
      const bx = [-1.5, 1.8, -4.2, 3.6, 0.2][i];
      const by = [2.8, 3.6, 1.6, 2.0, 4.6][i];
      const rr = (1.2 + 2.6 * u) * (0.8 + 0.4 * hash(i, 7, 3)) * grow;
      out.push({
        c: [bx - (2.0 + 6.0 * u) * (0.5 + 0.12 * i), by + 0.6 * u, rr * 0.75 + 1.4 * u],
        ax: [
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
        ],
        r: [rr, rr * 0.9, rr * 0.8],
        pal: P_DUST,
        id: nid(),
        noSeam: true,
        bias: 0.06,
        vis: 1.05 - u ** 1.3,
      });
    }
  }
  if (o.dust2 >= 0) {
    // Юз: из-под ступней — вперёд по ходу (вправо) и вверх.
    const u = o.dust2;
    const grow = clamp01(u / 0.1);
    for (let i = 0; i < 6; i++) {
      const ft = S.foot[i % 2];
      const rr = (0.9 + 2.2 * u) * (0.75 + 0.5 * hash(i, 11, 5)) * grow;
      const sx = (1.4 + 5.5 * u) * (0.6 + 0.25 * Math.floor(i / 2));
      out.push({
        c: [ft[0] + 1.5 + sx, ft[1] + 0.8 + 0.6 * (i % 3), rr * 0.7 + 1.2 * u * (1 + (i % 2))],
        ax: [
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
        ],
        r: [rr, rr * 0.9, rr * 0.8],
        pal: P_DUST,
        id: nid(),
        noSeam: true,
        bias: 0.08,
        vis: 1.05 - u ** 1.2,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Свой растр: части с выбором палитры и проявлением; прутья.
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
        const t = (-b + Math.sqrt(disc)) / (2 * a);
        const i = py * w + px;
        if (t <= zb[i]) continue;
        const qx = q0x + t * qdx;
        const qy = q0y + t * qdy;
        const qz = q0z + t * qdz;
        let pal = pt.pal;
        PICK_T = 0;
        const ax1 = pt.tube ? 0 : qx / r1;
        const nx = e1[0] * ax1 + (e2[0] * qy) / r2 + (e3[0] * qz) / r3;
        const ny = e1[1] * ax1 + (e2[1] * qy) / r2 + (e3[1] * qz) / r3;
        const nz = e1[2] * ax1 + (e2[2] * qy) / r2 + (e3[2] * qz) / r3;
        const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        const lam = (nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]) / nl;
        const bounce = Math.max(0, -nz / nl) * 0.14;
        if (pt.pick) pal = pt.pick(qx, qy, qz);
        let k = Math.max(0, lam * 0.6 + 0.4 + bounce) + PICK_T;
        if (pt.tex) k += pt.tex(qx, qy, qz);
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

/**
 * Прут прямо в кадр (с глубиной): малая — линия в пиксель, крупная — толще,
 * светлая сторона к свету.
 */
function rod(f: Frame, a: V3, b: V3, wid: number, pal: number, tone: number): void {
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
      const side = (-dy * -0.7 + dx * -0.7) / ln;
      const lit = (ex * -dy + ey * dx) / ln;
      const tn = tone + (lit * side > 0.15 * rad ? 1 : lit * side < -0.3 * rad ? -2 : 0);
      put(x, y, lerp(A[2], Bp[2], u) + 0.8 * RR, tn);
    }
}

/** Тёмная кромка вокруг рук и ног по дальним частям (надкрылья, брюшко). */
function limbEdge(f: Frame, steps: number): void {
  const { w, h, idb, zb, tone, pal } = f;
  const hit: number[] = [];
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (pal[i] < 0 || LIMB_IDS.has(idb[i])) continue;
      for (const j of [i - 1, i + 1, i - w, i + w]) {
        if (LIMB_IDS.has(idb[j]) && zb[j] - zb[i] > 1.2 * RR) {
          hit.push(i);
          break;
        }
      }
    }
  for (const i of hit) tone[i] = Math.max(0, tone[i] - steps);
}

function softBands(f: Frame): void {
  const { w, h, pal, tone, idb } = f;
  const hit: number[] = [];
  for (let y = 0; y < h - 1; y++)
    for (let x = 0; x < w - 1; x++) {
      const i = y * w + x;
      const pl = pal[i];
      if (pl !== P_SHELL && pl !== P_BELLY && pl !== P_DUST && pl !== P_LEG) continue;
      for (const j of [i + w, i + 1]) {
        if (pal[j] === pl && idb[j] === idb[i] && tone[j] === tone[i] - 1 && dith(x, y, 0.28))
          hit.push(j, tone[i]);
      }
    }
  for (let n = 0; n < hit.length; n += 2) f.tone[hit[n]] = hit[n + 1];
}

// ---------------------------------------------------------------------------
// Поверх кадра: глаза, рот, румянец, номер, смаз, линии скорости, блик, лучи, сон.
// ---------------------------------------------------------------------------

function eyePal(glass: boolean, closed: boolean): Record<string, RGBA> {
  if (glass) {
    // За стеклом: тёмный зрачок и блик видны, ободок — само стекло; закрытые — светлой чертой.
    return closed
      ? { k: GLASS[7] }
      : { d: hx('#06121a'), c: hx('#0c2028'), m: hx('#24505a'), W: hx('#eafcff'), w: GLASS[7] };
  }
  return {
    k: hx('#120604'),
    d: hx('#22100a'),
    c: hx('#3a1e12'),
    m: hx('#6c4028'),
    W: hx('#fffdf6'),
    w: hx('#d8cfc0'),
  };
}
// Малая: глаз 4×5 — блик сверху-слева, отсвет снизу.
const EYES_S: Record<Eye, string[]> = {
  open: ['.kk.', 'kWdk', 'kddk', 'kdmk', '.kk.'],
  half: ['....', 'kkkk', 'kWdk', 'kdmk', '.kk.'],
  shut: ['....', '....', '....', 'kkkk', '....'],
  happy: ['....', '.kk.', 'k..k', '....', '....'],
  sleep: ['....', '....', 'k..k', '.kk.', '....'],
  angry: ['k...', 'kkk.', 'kWdk', 'kdmk', '.kk.'],
};
// Крупная: огромный глянцевый глаз 10×11 — ободок, два блика, светлее книзу.
const EYES_L: Record<Eye, string[]> = {
  open: [
    '...kkkk...',
    '.kkddddkk.',
    '.kWWddddk.',
    'kWWWdddddk',
    'kWWddddddk',
    'kdddddddck',
    'kddddddcck',
    'kdddddccmk',
    '.kdddccmwk',
    '.kkccccmk.',
    '...kkkk...',
  ],
  half: [
    '..........',
    '..........',
    '..........',
    'kkkkkkkkkk',
    'kWWddddddk',
    'kdddddddck',
    'kddddddcck',
    'kdddddccmk',
    '.kdddccmwk',
    '.kkccccmk.',
    '...kkkk...',
  ],
  shut: [
    '..........',
    '..........',
    '..........',
    '..........',
    '..........',
    'kk......kk',
    '.kkkkkkkk.',
    '..........',
    '..........',
    '..........',
    '..........',
  ],
  happy: [
    '..........',
    '..........',
    '...kkkk...',
    '..kk..kk..',
    '.kk....kk.',
    'kk......kk',
    '..........',
    '..........',
    '..........',
    '..........',
    '..........',
  ],
  sleep: [
    '..........',
    '..........',
    '..........',
    '..........',
    'k........k',
    'kk......kk',
    '.kkkkkkkk.',
    '..........',
    '..........',
    '..........',
    '..........',
  ],
  angry: [
    '..........',
    '..........',
    'kkk.......',
    'kWkkkkk...',
    'kWWddddkkk',
    'kdddddddck',
    'kddddddcck',
    'kdddddccmk',
    '.kdddccmwk',
    '.kkccccmk.',
    '...kkkk...',
  ],
};

function face(p: Px, f: Frame, c: Ctx): void {
  const { o, h } = c;
  const glass = o.gog > 0.55;
  for (const side of [-1, 1] as const) {
    const at = seen(f, mul(h.at([side * 3.6, 6.9, 0.4]), RR), OX, OY, 2.8 * RR);
    if (!at) continue;
    let key: Eye = (side < 0 ? o.eyeL : o.eyeR) ?? o.eye;
    if (key === 'open' || key === 'angry') {
      if (o.blink > 0.7) key = 'shut';
      else if (o.blink > 0.25) key = 'half';
    }
    const closed = key === 'shut' || key === 'happy' || key === 'sleep';
    const ep = eyePal(glass, closed);
    const rows = HI ? EYES_L[key] : EYES_S[key];
    const flip = side > 0 && key === 'angry';
    stamp(p, rows, ep, at[0] - (HI ? 5 : 2), at[1] - (HI ? 5 : 2), flip);
  }
  // Румянец снаружи под глазами.
  const pink = V === 1 ? hx('#f0a070') : hx('#e07a6a');
  for (const side of [-1, 1]) {
    const bl = seen(f, mul(h.at([side * 6.3, 5.0, -2.5]), RR), OX, OY, 2 * RR);
    if (!bl || o.eye === 'angry') continue;
    if (HI) stamp(p, ['.pp.', 'pppp'], { p: pink }, bl[0] - 2, bl[1] - 1);
    else p.set(bl[0], bl[1], pink);
  }
  // Улыбка на мордочке (пасть закрыта).
  if (o.jaw < 0.2) {
    const ink = mixc(PAL[P_BELLY][1], INK_V[V], 0.4);
    const m = seen(f, mul(h.at([0, 7.9, -3.7]), RR), OX, OY, 2 * RR);
    if (m) {
      const sm = o.smile;
      if (HI) {
        const half = 3;
        for (let dx = -half; dx <= half; dx++) {
          const dy = Math.round(-sm * 1.6 * (1 - (dx * dx) / (half * half)));
          p.set(m[0] + dx, m[1] - dy, ink);
        }
      } else if (sm > 0.65) {
        p.set(m[0] - 2, m[1] - 1, ink);
        p.set(m[0] - 1, m[1], ink);
        p.set(m[0], m[1], ink);
        p.set(m[0] + 1, m[1] - 1, ink);
      } else {
        p.set(m[0] - 1, m[1], ink);
        p.set(m[0], m[1], ink);
      }
    }
  }
}

/** Номер «7» — только по пикселям тряпицы; на крупной — булавки по верхним углам. */
const SEVEN_S = ['rrr', '..r', '.r.', '.r.'];
const SEVEN_L = ['rrrrrr', 'rRRRrR', '....rR', '...rR.', '...rR.', '..rR..', '..rR..', '..rR..'];
function bib(p: Px, f: Frame, c: Ctx): void {
  const { S } = c;
  const r = S.br;
  const onBody = (qx: number, qz: number): V3 => {
    const qy = Math.sqrt(Math.max(0, 1 - qx * qx - qz * qz));
    const [e1, e2, e3] = S.bax;
    return add(S.bc, add(add(mul(e1, qx * r[0]), mul(e2, qy * r[1])), mul(e3, qz * r[2])));
  };
  const mid = (BIB_Z0 + BIB_Z1) / 2;
  const at = seen(f, mul(onBody(0, mid), RR), OX, OY, 3 * RR);
  if (!at) return;
  const pal = { r: RED[4], R: RED[2] };
  const rows = HI ? SEVEN_L : SEVEN_S;
  const x0 = at[0] - (HI ? 3 : 1);
  const y0 = at[1] - (HI ? 4 : 2);
  for (let y = 0; y < rows.length; y++)
    for (let x = 0; x < rows[y].length; x++) {
      const col = pal[rows[y][x] as 'r' | 'R'];
      if (!col) continue;
      const X = x0 + x;
      const Y = y0 + y;
      if (X < 0 || Y < 0 || X >= f.w || Y >= f.h) continue;
      if (f.pal[Y * f.w + X] !== P_CLOTH) continue;
      p.set(X, Y, col);
    }
  if (HI) {
    for (const side of [-1, 1]) {
      const pin = seen(f, mul(onBody(side * (BIB_X - 0.07), BIB_Z1 - 0.07), RR), OX, OY, 3 * RR);
      if (!pin) continue;
      const i = pin[1] * f.w + pin[0];
      if (f.pal[i] !== P_CLOTH) continue;
      p.set(pin[0] - side, pin[1] + 1, STEEL[6]);
      p.set(pin[0], pin[1], STEEL[7]);
      p.set(pin[0] + side, pin[1] - 1, PAL[P_BRASS][5]);
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

/** Смаз: силуэт тянется назад (влево — бежит вправо) по пустому фону, редея. */
function smear(p: Px, f: Frame, amt: number): void {
  const L = Math.round(amt * (HI ? 16 : 7));
  if (L < 1) return;
  const src = new Uint8ClampedArray(p.data);
  const { w, h } = p;
  for (let y = 0; y < h; y++)
    for (let x = 1; x < w; x++) {
      const i = y * w + x;
      if (src[i * 4 + 3] === 0 || src[(i - 1) * 4 + 3] !== 0) continue;
      if (f.pal[i] === P_DUST) continue;
      const col: RGBA = [src[i * 4], src[i * 4 + 1], src[i * 4 + 2], 255];
      const dim = mixc(col, INK_V[V], 0.3);
      for (let d = 1; d <= L; d++) {
        const X = x - d;
        if (X < 0 || src[(y * w + X) * 4 + 3] !== 0) break;
        if (!dith(X, y, (1 - d / (L + 1)) * 0.8)) continue;
        p.set(X, y, dim);
      }
    }
}

/** Линии скорости: за спиной (слева от бегущего вправо), только по пустому фону. */
function speedLines(p: Px, c: Ctx): void {
  const { o, t } = c;
  const col = hx('#f4ead8');
  const dim = hx('#b8ae9c');
  const rows: [number, number][] = [
    [6, 10],
    [12, 7],
    [18, 12],
    [26, 8],
  ];
  const hidden = Math.abs(o.x) > WIN1 + 8;
  for (const [z, len] of rows) {
    const y = Math.round(OY - z * CE * RR);
    if (y < 0 || y >= p.h) continue;
    let x0 = -1;
    if (!hidden) {
      for (let x = 0; x < p.w; x++)
        if (p.data[(y * p.w + x) * 4 + 3] > 0) {
          x0 = x;
          break;
        }
      if (x0 < 0) continue;
    } else if (t < 0.9) x0 = Math.round(OX + WIN1 * RR);
    else continue;
    const L = Math.round(len * RR * o.speed);
    const gap = Math.round(2 * RR);
    for (let d = 0; d < L; d++) {
      const X = x0 - gap - d;
      if (X < 0) break;
      const i = y * p.w + X;
      if (p.data[i * 4 + 3] > 0) continue;
      if (!dith(X, y, 1.1 - d / L)) continue;
      p.set(X, y, d < L * 0.4 ? col : dim);
      if (HI && d < L * 0.6 && p.data[(i + p.w) * 4 + 3] === 0) p.set(X, y + 1, dim);
    }
  }
}

/** Блик на поднятом пальце. */
function glintFx(p: Px, c: Ctx): void {
  const { o } = c;
  if (o.glint < 0 || o.thumb < 0.3) return;
  const tip = thumbTip(c);
  const [sx, sy] = project(mul(tip, RR));
  const L = Math.round(bump(o.glint, 0, 1) * (HI ? 5 : 2.4));
  if (L >= 1) star(p, Math.round(OX + sx), Math.round(OY + sy), L, WHITE, hx('#ffe08a', 220));
}

/** Хватка: лучи удара расходятся от жвал — только по пустому фону (вокруг силуэта). */
function snap(p: Px, mask: Uint8Array, c: Ctx): void {
  const { o, h } = c;
  const u = o.bite;
  const [sx, sy] = project(mul(h.at([0, 7.6, -5.0]), RR));
  const mx = OX + sx;
  const my = OY + sy;
  const col = hx('#fff4dc');
  const dim = hx('#f0c070');
  const vis = u < 0.6 ? 1.1 : (1 - u) / 0.4;
  const r0 = (HI ? 26 : 12) + u * (HI ? 8 : 4);
  const L = HI ? 7 : 3.5;
  for (const a of [-2.6, -2.05, -1.57, -1.09, -0.54, 0.0, 0.5, 2.64, 3.14]) {
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

/** Следы когтей: светлая дуга по пути кончиков верхних кистей за последние ~0,07 с.
 * Кисти впереди тела — след рисуется поверх тела; хвост дуги тает шахматкой. */
function slashFx(p: Px, c: Ctx): void {
  const { S, t } = c;
  const col = hx('#fff4dc');
  const dim = hx('#f0c070');
  const k = S.k;
  for (let j = 0; j < 2; j++) {
    const side = j === 0 ? 1 : -1;
    const u1 = swipeU(t, j);
    const u0 = swipeU(t - 0.07, j);
    if (u1 - u0 < 0.04) continue;
    const sh = S.sh[j === 0 ? 1 : 0];
    const pole = norm([side, -0.5, 0.1]);
    const N = HI ? 16 : 9;
    let prev: [number, number] | null = null;
    for (let n = 0; n <= N; n++) {
      const hand = S.up(swipePath(side, lerp(u0, u1, n / N)));
      const [elb, wr] = ik(sh, hand, 4.6 * k, 4.4 * k, pole);
      const tip = add(wr, mul(norm(sub(wr, elb)), 2.2 * k));
      const [sx, sy] = project(mul(tip, RR));
      const cur: [number, number] = [OX + sx, OY + sy];
      if (prev) {
        const steps =
          Math.ceil(Math.max(Math.abs(cur[0] - prev[0]), Math.abs(cur[1] - prev[1])) * 2) + 1;
        for (let q = 0; q <= steps; q++) {
          const f = (n - 1 + q / steps) / N;
          const x = Math.round(lerp(prev[0], cur[0], q / steps) - 0.5);
          const y = Math.round(lerp(prev[1], cur[1], q / steps) - 0.5);
          if (x < 0 || y < 0 || x >= p.w || y >= p.h || !dith(x, y, 0.2 + 0.95 * f)) continue;
          const cc = f > 0.55 ? col : dim;
          p.set(x, y, cc);
          if (HI && f > 0.3 && y + 1 < p.h) p.set(x, y + 1, f > 0.7 ? col : dim);
        }
      }
      prev = cur;
    }
  }
}

/** Сон: буквы «z» поднимаются над головой и тают. */
const Z_S = ['zzz', '.z.', 'zzz'];
const Z_M = ['zzzz', '..z.', '.z..', 'zzzz'];
const Z_L = ['zzzzzz', '....zz', '...zz.', '..zz..', '.zz...', 'zzzzzz'];
const Z_XL = ['zzzzzzz', 'zzzzzzz', '....zz.', '...zz..', '..zz...', 'zzzzzzz', 'zzzzzzz'];
function zzz(p: Px, mask: Uint8Array, c: Ctx): void {
  const { h, t } = c;
  const col = hx('#f4ead8');
  for (let j = 0; j < 2; j++) {
    const u = wrap(t / 1.5 + j * 0.5, 1);
    // От макушки справа вверх — в мире (голова кивнула, её «верх» смотрит на зрителя).
    const [sx, sy] = project(mul(add(h.at([6, 0, 6]), [2.5 + 4 * u, 0, 3 + 10 * u]), RR));
    const x0 = Math.round(OX + sx);
    const y0 = Math.round(OY + sy);
    const rows = HI ? (u > 0.45 ? Z_XL : Z_L) : u > 0.45 ? Z_M : Z_S;
    for (let y = 0; y < rows.length; y++)
      for (let x = 0; x < rows[y].length; x++) {
        if (rows[y][x] !== 'z') continue;
        const X = x0 + x;
        const Y = y0 + y;
        if (X < 0 || Y < 0 || X >= p.w || Y >= p.h || mask[Y * p.w + X]) continue;
        if (!dith(X, Y, 1.2 * Math.min(1, (1 - u) * 2.5) * Math.min(1, u * 6))) continue;
        p.set(X, Y, col);
      }
  }
}

/** Трюк: за краем «окна» таракан тает шахматкой — в шахте рамки нет, резкий срез читался поломкой. */
function windowClip(p: Px): void {
  const w0 = WIN0 * RR;
  const w1 = WIN1 * RR;
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      const d = Math.abs(x + 0.5 - OX);
      if (d <= w0) continue;
      if (d < w1 && dith(x, y, 1 - (d - w0) / (w1 - w0))) continue;
      p.data[(y * p.w + x) * 4 + 3] = 0;
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
  // В трюке x «оборачивается» за краем: пружинам — непрерывный ход забега.
  const hp = (tt: number): V3 => {
    const o = P(tt);
    const q = headPos(o);
    return a === 'work' ? [q[0] - o.x + runV(Math.max(0, tt)), q[1], q[2]] : q;
  };
  const env = LOOP[a] ? 1 : clamp01((T - t) / 0.2);
  // Разовая к концу приходит не в чистую позу, а в запаздывание покоя на кадре 0: стык без сдвига.
  const L0 = LOOP[a] ? null : lagOf('idle', 0);
  const d = (fn: (tt: number) => number, freq: number, damp: number, off: number, cap: number) => {
    const now = fn(t);
    const v = Math.max(-cap, Math.min(cap, spring(fn, t, t0, freq, damp) - now));
    return v * env + (L0 ? off * (1 - env) : 0);
  };
  const r: Lag = {
    hX: d((tt) => hp(tt)[0], 3.2, 0.32, L0?.hX ?? 0, 1),
    hZ: d((tt) => hp(tt)[2], 3.2, 0.32, L0?.hZ ?? 0, 0.8),
    aX: d((tt) => hp(tt)[0], 2.0, 0.16, L0?.aX ?? 0, 3.4),
    aY: d((tt) => hp(tt)[1], 2.2, 0.18, L0?.aY ?? 0, 2.6),
    aZ: d((tt) => hp(tt)[2], 2.4, 0.18, L0?.aZ ?? 0, 2.4),
  };
  LAGS.set(key, r);
  return r;
}

function headF(o: Pose, S: Skel, lag: Lag): HeadF {
  const nb = o.nod + o.bow;
  const tl = o.tilt + o.lean;
  const dir = (v: V3): V3 => yawZ(rollY(yawZ(pitchX(v, nb), o.turn), tl), o.yaw);
  const k = S.k * (HI ? 1.0 : 1.04);
  const hc: V3 = [S.head[0] + lag.hX, S.head[1], S.head[2] + lag.hZ];
  return { dir, k, at: (p) => add(hc, mul(dir(p), k)) };
}

function toRes(parts: PartF[]): PartF[] {
  if (RR === 1) return parts;
  return parts.map((pt) => ({ ...pt, c: mul(pt.c, RR), r: mul(pt.r, RR) }));
}

/** Кадр `i` анимации `a` полосы `res`, вариант окраса `v` (0 — обычный, 1 — золотой). */
export function roachFrame(a: Anim, i: number, res: Res = 's', v = 0): Px {
  const cv = RES[res];
  RR = cv.box / RES.s.box;
  HI = res === 'l';
  OX = cv.bx + cv.box / 2;
  OY = cv.by + GROUND * RR;
  V = v === 1 ? 1 : 0;
  NEXT_ID = 0;
  LIMB_IDS.clear();
  const t = i / FPS;
  const o = poseAt(a, t);
  const S = skel(o);
  const lag = lagOf(a, t);
  const c: Ctx = { o, S, h: headF(o, S, lag), lag, t };
  PAL = PAL_V[V];
  const f = newFrame(cv.cw, cv.ch);
  const parts: PartF[] = [];
  wings(parts, c);
  shield(parts, c);
  legs(parts, c);
  body(parts, c);
  arms(parts, c);
  headParts(parts, c);
  goggles(parts, c);
  dust(parts, c);
  drawPartsF(f, toRes(parts), PAL, OX, OY);
  antennae(f, c);
  spines(f, c);
  seams(f, 1.2 * RR, 1);
  limbEdge(f, 2);
  rimLight(f, PAL, (pl) => pl !== P_MOUTH && pl !== P_GLASS && pl !== P_DUST);
  if (HI) softBands(f);
  const p = toPx(f, PAL);
  selOutline(p, INK_V[V], 0.8);
  face(p, f, c);
  bib(p, f, c);
  if (o.streak > 0.02) smear(p, f, o.streak);
  if (o.speed > 0.02) speedLines(p, c);
  glintFx(p, c);
  if (a === 'attack') slashFx(p, c);
  const mask = new Uint8Array(p.w * p.h);
  for (let j = 0; j < mask.length; j++) mask[j] = p.data[j * 4 + 3] > 0 ? 1 : 0;
  if (a === 'sleep') zzz(p, mask, c);
  if (o.bite >= 0) snap(p, mask, c);
  if (a === 'work') windowClip(p);
  return p;
}
