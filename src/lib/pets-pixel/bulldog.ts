// Бульдог Кастет — пиксельный питомец по эталону боссов 12–14.
//
// Коренастый палевый английский бульдог сидит прямо на зрителя: голова шире
// груди и расширяется книзу тяжёлыми белыми брылями, широкий чёрный нос под
// толстой складкой, хмурые морщины на лбу, маленькие уши-«розочки» по углам
// макушки, бульдожий прикус — два нижних клыка торчат вверх. Белая проточина
// и манишка, белые «носочки», кривые передние лапы широко. Чёрный ошейник с
// шипами, стальное кольцо и жетон «17», шипастые напульсники, два пластыря
// крест-накрест на лбу и латунный кастет на правой (по кадру) лапе.
//
// Две полосы, у каждой свой рисунок: малая — рамка 48 (шахта, списки),
// крупная — рамка 112 (карточка, вылупление, Питомник): морщины, складки
// брылей, ноздри, радужка, шипы треугольниками, жетон с номером, дырки
// кастета, точки на пластырях.
//
// Анимации 24 к/с по ключам (`kf`): подготовка → разгон → пик → проводка
// → возврат. Голова, брыли, уши и хвост-обрубок — с запаздыванием (`spring`).
// Трюк: прицеливается к каменному блоку, замах, удар кастетом — блок в щебень
// (вспышка, камни подпрыгивают, пыль), любуется кастетом (блик) → реквизит
// тает и встаёт на места покоя.
//
// Золотой рисуется здесь же (`v` = 1) своими палитрами: палевый мех — золото
// с бронзовой глубиной, белое — бледное золото; нос, клыки, шипы и кастет
// читаются (кастет светлее и белее, чтобы не утонуть в золоте).

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
const P_WHITE = 1;
const P_EAR = 2;
const P_LEATHER = 3;
const P_BRASS = 4;
const P_STEEL = 5;
const P_NOSE = 6;
const P_MOUTH = 7;
const P_TONGUE = 8;
const P_BONE = 9;
const P_PLASTER = 10;
const P_STONE = 11;

const MOUTH = ramp('#16050a', '#300a10', '#4e1218', '#701e22', '#94342f', '#b8504a');
const TONGUE = ramp('#4a1418', '#6e2228', '#94343a', '#ba4c50', '#d86866', '#ee8e88', '#f8b0a8');
const BONE = ramp('#6a6252', '#948c7c', '#bcb4a4', '#dcd6c8', '#f2eee4', '#fffdf6');
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
const PLASTER = ramp('#6a5640', '#8e7658', '#b09774', '#cdb592', '#e2cda9', '#efdfc0', '#f8eed8');

const PAL_V: RGBA[][][] = [
  [
    // Палевый мех: бурая тень → палевый → светлый на свету.
    ramp(
      '#2a170c',
      '#3c2212',
      '#52301a',
      '#683f22',
      '#7e502c',
      '#946238',
      '#a87444',
      '#ba8550',
      '#c9955f',
      '#d6a670',
      '#e2b886',
      '#eccba0',
    ),
    // Белое: проточина, брыли, манишка, носочки (тёплая тень — не серое).
    ramp(
      '#4e3e32',
      '#6e5c4e',
      '#8e7c6c',
      '#ab9a88',
      '#c4b4a2',
      '#d8cab8',
      '#e8dccc',
      '#f3ebdd',
      '#fbf6ec',
    ),
    // Уши-розочки: темнее меха.
    ramp('#1e0f07', '#2e180c', '#422413', '#58321b', '#6e4124', '#84522e', '#9a6438'),
    // Чёрная кожа ошейника и напульсников.
    ramp('#0a0807', '#120e0d', '#1b1615', '#25201e', '#312a27', '#3e3632', '#4e4540'),
    // Латунь кастета.
    ramp('#3a2606', '#5e420e', '#86641e', '#ac8832', '#cfaa4c', '#e6c46a', '#f6de98', '#fff4d2'),
    STEEL,
    // Нос.
    ramp('#070606', '#0f0d0c', '#191615', '#24201e', '#332d2a', '#4a423d'),
    MOUTH,
    TONGUE,
    BONE,
    PLASTER,
    STONE,
  ],
  [
    // Золотой: бронза в тени → золото → бледное золото на свету.
    ramp(
      '#1e1004',
      '#301a06',
      '#46280a',
      '#5c360e',
      '#744814',
      '#8c5c1a',
      '#a67222',
      '#c08c30',
      '#d6a640',
      '#e8c058',
      '#f6d880',
      '#fff0b4',
    ),
    // Белое → бледное золото.
    ramp(
      '#4e3a14',
      '#6c5220',
      '#8c6e30',
      '#aa8c44',
      '#c6aa5c',
      '#dcc478',
      '#ecda98',
      '#f6eabc',
      '#fff8e0',
    ),
    // Уши → тёмная бронза.
    ramp('#1c0e04', '#2c1606', '#40220a', '#56300e', '#6c3e14', '#82501a', '#986222'),
    // Кожа ошейника — тёмная бронзово-чёрная.
    ramp('#0c0804', '#150e06', '#20160a', '#2c1e0e', '#382712', '#463118', '#563e20'),
    // Кастет светлее и белее — не тонет в золоте.
    ramp('#4a3006', '#74500e', '#9e7820', '#c6a038', '#e6c45a', '#f8de86', '#fff2c0', '#ffffff'),
    STEEL,
    ramp('#0c0603', '#170c05', '#231308', '#311c0c', '#432812', '#5a381a'),
    MOUTH,
    TONGUE,
    BONE,
    ramp('#6a5228', '#8e7036', '#b09048', '#ccae60', '#e2c87c', '#f0dc9c', '#faeec4'),
    STONE,
  ],
];
const INK_V: RGBA[] = [hx('#0c0604'), hx('#1a0d02')];

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

type Eye = 'open' | 'happy' | 'angry' | 'sleep' | 'shut' | 'smug';

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
  /** Пасть: 0 — закрыта, 1 — настежь; оскал; язык наружу (кончик — 0.3). */
  jaw: number;
  snarl: number;
  tongue: number;
  /** Уши: прижать (+) и дёрнуть. */
  earL: number;
  earR: number;
  flL: number;
  flR: number;
  /** Обрубок хвоста: виляет. */
  tailSw: number;
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
  /** Вдох: грудь раздувается; фырк: ноздри и пар (0…1, −1 — нет). */
  chest: number;
  snort: number;
  /** Трюк: блок (проявление), секунды от удара и от раскола, щебень и пыль (видимость), блик кастета. */
  block: number;
  hit: number;
  stone: number;
  prop: number;
  glint: number;
  /** Атака: лучи удара кулаком (0…1), −1 — нет. */
  punch: number;
  /** Сон: пузырь из носа (0…1). */
  bubble: number;
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
  snort: -1,
  block: 0,
  hit: -1,
  stone: -1,
  prop: 0,
  glint: -1,
  punch: -1,
  bubble: 0,
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
  // Тяжёлое дыхание: три вдоха на петлю, грудь ходит, голова качается.
  const br = 0.5 - 0.5 * Math.cos(ph * 3);
  o.chest = br;
  o.sq = -0.02 * br;
  o.hz = 0.35 * br;
  o.hy = 0.15 * br;
  // Фырк: голова вздёргивается, ноздри раздуваются, пар.
  const sn = bump(t, 1.42, 1.66);
  o.nod = -0.12 * sn + 0.05 * bump(t, 1.62, 1.86);
  o.snort = t >= 1.44 && t < 1.92 ? (t - 1.44) / 0.48 : -1;
  o.hz += 0.5 * sn;
  // Кончик языка — облизнулся.
  o.tongue =
    0.32 *
    kf(t, [
      [0, 0],
      [2.1, 0],
      [2.24, 1, 'o'],
      [2.5, 1],
      [2.64, 0, 'i'],
    ]);
  o.jaw = (0.12 * o.tongue) / 0.32;
  // Оглядывается вправо и обратно.
  const lk = loopK(t, T, [
    [0, 0],
    [0.3, 0],
    [0.5, 1, 'o'],
    [1.1, 1],
    [1.3, 0, 's'],
    [3, 0],
  ]);
  o.turn = 0.12 * lk;
  o.look = 0.8 * lk;
  o.tilt = 0.04 * Math.sin(ph);
  o.lean = 0.01 * Math.sin(ph);
  o.blink = Math.max(bump(t, 0.12, 0.26), bump(t, 2.72, 2.88));
  o.flL = bump(t, 0.82, 0.96);
  o.flR = bump(t, 2.86, 2.98);
  // Обрубок хвоста виляет: четыре взмаха на петлю.
  o.tailSw = 0.8 * Math.sin(ph * 4);
  return o;
}

function walkPose(t: number): Pose {
  const T = dur('walk');
  const o: Pose = { ...REST };
  const h = wrap(t, T);
  o.stand = 1;
  // Вразвалку на зрителя: пары накрест, лапа выносится дугой наружу (кривые лапы).
  const la = bump(h, 0.02, 0.48);
  const lb = bump(h, 0.52, 0.98);
  o.fLz = 3.0 * la ** 0.8;
  o.fLy = 1.6 * la;
  o.fLx = -1.4 * la;
  o.hRz = 1.8 * la ** 0.8;
  o.fRz = 3.0 * lb ** 0.8;
  o.fRy = 1.6 * lb;
  o.fRx = 1.4 * lb;
  o.hLz = 1.8 * lb ** 0.8;
  const sw = Math.sin((h / T) * TAU);
  // Перекат с боку на бок — корпус валится на опорную пару (вес на стоящую лапу).
  o.x = -1.1 * sw;
  o.lean = -0.13 * sw;
  o.z = 0.5 * Math.abs(Math.cos((h / T) * TAU)) - 0.15;
  o.nod = 0.06 + 0.04 * Math.cos((h / T) * 2 * TAU);
  o.tilt = 0.12 * sw;
  o.hx = 0.6 * sw;
  o.turn = 0.07 * sw;
  o.tailSw = 0.9 * Math.sin((h / T) * 2 * TAU);
  o.jaw = 0.2;
  o.tongue = 0.7;
  return o;
}

function happyPose(t: number): Pose {
  const T = dur('happy');
  const o: Pose = { ...REST };
  // Два подскока, лапы от пола, вертит задом, язык наружу.
  const rise = kf(t, [
    [0, 0],
    [0.1, -0.35, 'o'],
    [0.3, 1, 'o'],
    [0.42, 0.95],
    [0.56, -0.25, 'i'],
    [0.66, 0.6, 'o'],
    [0.76, 0.55],
    [0.88, -0.12, 'i'],
    [1.0, 0, 'o'],
    [T, 0],
  ]);
  const up = pos(rise);
  const env = 1 - clamp01((t - 0.86) / (T - 0.86));
  o.z = 2.2 * up;
  o.sq = -0.08 * rise;
  o.fLz = 2.6 * up;
  o.fRz = 2.6 * up;
  o.fLy = -0.6 * up;
  o.fRy = -0.6 * up;
  o.fLx = 0.8 * up;
  o.fRx = -0.8 * up;
  o.nod = -0.1 * up;
  // Зад виляет: корпус вбок и наклон, хвост — быстрее.
  const wig = Math.sin(TAU * 2.6 * t) * env;
  o.x = 0.9 * wig;
  o.lean = -0.08 * wig;
  o.tilt = 0.12 * Math.sin(TAU * 1.3 * t) * env;
  o.eye = t < 0.92 ? 'happy' : 'open';
  o.jaw = 0.45 * env;
  o.tongue = env;
  o.earL = -0.3 * env * up;
  o.earR = -0.3 * env * up;
  o.tailSw = 1.2 * Math.sin(TAU * 4.6 * t) * env;
  return o;
}

/**
 * Трюк (2 с): блок проявляется справа → прицеливается (голова к блоку,
 * прищур) → замах правой → удар кастетом (вспышка, трещины) → блок в щебень:
 * камни подпрыгивают, пыль → любуется кастетом (лапа у морды, блик) →
 * щебень тает, поза покоя.
 */
const HIT_T = 0.98;
const BREAK_T = 1.06;

function workPose(t: number): Pose {
  const o: Pose = { ...REST };
  o.block = kf(t, [
    [0, 0],
    [0.24, 1, 'o'],
  ]);
  // Прицел: голова к блоку, глаза щурятся.
  const aim = kf(t, [
    [0, 0],
    [0.16, 0],
    [0.4, 1, 'o'],
    [0.62, 1],
    [0.74, 0.7],
    [1.0, 0.5],
    [1.3, 0, 's'],
  ]);
  // Замах: корпус от блока, правая назад и вверх.
  const wind = kf(t, [
    [0, 0],
    [0.56, 0],
    [0.84, 1, 'o'],
    [0.9, 1.04],
    [0.96, 0, 'i'],
  ]);
  // Удар: корпус к блоку, лапа вытянута в блок.
  const pn = kf(t, [
    [0, 0],
    [0.88, 0],
    [HIT_T, 1, 'i'],
    [1.1, 0.95],
    [1.34, 0, 's'],
  ]);
  // Любуется кастетом: лапа у груди, голова к ней.
  const adm = kf(t, [
    [0, 0],
    [1.28, 0],
    [1.48, 1, 'o'],
    [1.76, 1],
    [1.96, 0, 's'],
  ]);
  o.turn = 0.34 * aim + 0.18 * pn + 0.04 * adm;
  o.look = Math.min(1, aim + pn) + 0.3 * adm;
  o.nod = 0.1 * aim - 0.08 * wind + 0.06 * pn + 0.2 * adm;
  o.tilt = 0.08 * aim - 0.08 * wind + 0.14 * adm;
  o.lean = -0.14 * wind + 0.13 * pn;
  o.x = -1.4 * wind + 1.8 * pn;
  o.sq = 0.05 * wind - 0.03 * pn;
  o.hx = -0.8 * wind + 1.2 * pn;
  o.fRz = 9.0 * wind + 4.0 * pn + 11.0 * adm;
  o.fRy = -1.4 * wind - 1.6 * pn + 2.6 * adm;
  o.fRx = -4.6 * wind + 5.2 * pn - 5.0 * adm;
  o.fLy = 0.4 * pn;
  o.snarl = Math.max(0.6 * aim, wind, pn);
  o.jaw = 0.3 * pn + 0.3 * adm;
  o.tongue = 0.3 * adm;
  o.eye = t < 0.16 ? 'open' : t < 1.3 ? 'angry' : t < 1.84 ? 'smug' : 'open';
  o.earL = 0.4 * wind;
  o.earR = 0.4 * wind;
  o.tailSw = 0.9 * Math.sin(TAU * 3 * (t - 1.3)) * adm;
  o.hit = t >= HIT_T && t < HIT_T + 0.3 ? t - HIT_T : -1;
  o.stone = t >= BREAK_T ? t - BREAK_T : -1;
  if (t >= BREAK_T) o.block = 0;
  o.prop = kf(t, [
    [0, 0],
    [BREAK_T, 0],
    [BREAK_T + 0.01, 1],
    [1.66, 1],
    [1.92, 0, 'l'],
  ]);
  o.glint = t >= 1.44 && t < 1.78 ? (t - 1.44) / 0.34 : -1;
  // Щебень растаял — реквизит на места покоя.
  if (o.prop < 0.01 && t > 1.5) {
    o.stone = -1;
    o.prop = 0;
    o.block = 0;
  }
  return o;
}

function attackPose(t: number): Pose {
  const T = dur('attack');
  const o: Pose = { ...REST };
  // Голову вниз, плечи вверх → бросок к зрителю: лоб и кулак вперёд, прикус
  // с клыками наружу (кадры 8–11) → осел, встряхнулся → покой.
  const l = kf(t, [
    [0, 0],
    [0.2, -1, 'o'],
    [0.26, -1.05],
    [0.36, 1, 'i'],
    [0.48, 0.95],
    [0.62, 0.3, 's'],
    [T, 0, 's'],
  ]);
  const fist = kf(t, [
    [0, 0],
    [0.28, 0],
    [0.36, 1, 'o'],
    [0.48, 1],
    [0.64, 0, 's'],
  ]);
  o.y = 3.2 * pos(l) - 0.6 * neg(l);
  o.scale = 1 + 0.16 * pos(l);
  o.sq = 0.1 * neg(l) + 0.07 * bump(t, 0.55, 0.7);
  o.z = -0.5 * neg(l) + 0.8 * pos(l);
  o.bow = 0.12 * neg(l) + 0.04 * pos(l);
  o.nod = 0.2 * neg(l) - 0.16 * pos(l);
  o.hy = 1.4 * pos(l) - 0.5 * neg(l);
  o.hz = -1.2 * neg(l);
  o.jaw = kf(t, [
    [0, 0],
    [0.24, 0.1],
    [0.36, 0.7, 'o'],
    [0.48, 0.7],
    [0.6, 0.1, 'i'],
    [0.74, 0, 's'],
  ]);
  o.snarl = kf(t, [
    [0, 0],
    [0.14, 1, 'o'],
    [0.54, 1],
    [0.8, 0, 's'],
  ]);
  o.earL = 0.6 * bump(t, 0.05, 0.8);
  o.earR = o.earL;
  o.eye = t < 0.7 ? 'angry' : 'open';
  o.turn = 0.18 * Math.sin(((t - 0.52) / 0.16) * TAU) * bump(t, 0.52, 0.76);
  // Кулак с кастетом: назад в замахе, к зрителю на ударе.
  o.fRz = 3.0 * neg(l) + 12.5 * fist;
  o.fRy = -1.4 * neg(l) + 6.5 * fist;
  o.fRx = -1.0 * neg(l) - 3.6 * fist;
  o.fLz = 0.6 * bump(t, 0.1, 0.3);
  o.tailSw = 0.6 * bump(t, 0.4, 0.86);
  o.punch = t >= 0.34 && t < 0.56 ? (t - 0.34) / 0.22 : -1;
  return o;
}

function sleepPose(t: number): Pose {
  const T = dur('sleep');
  const o: Pose = { ...REST };
  o.lie = 1;
  o.eye = 'sleep';
  const br = 0.5 - 0.5 * Math.cos((t / T) * TAU);
  o.chest = br;
  o.nod = 0.18 + 0.03 * br;
  o.tilt = 0.08;
  o.hz = 0.3 * br;
  o.sq = -0.04 * br;
  o.bubble = br;
  o.jaw = 0.04;
  o.earL = 0.3;
  o.earR = 0.3;
  o.flR = 0.6 * bump(t, 0.9, 1.04);
  o.tailSw = 0.2 * Math.sin((t / T) * TAU * 2);
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
  tail: V3;
}
const SIT: Plan = {
  body: [0, -1.0, 10.0],
  bodyR: [9.6, 7.4, 10.0],
  neck: [0, 1.0, 18.6],
  neckR: [8.2, 6.2, 4.4],
  head: [0, 2.6, 27.6],
  sh: [8.0, 3.0, 13.0],
  paw: [9.4, 7.6, 1.3],
  haunch: [8.6, -2.6, 5.4],
  haunchR: [5.0, 6.2, 5.2],
  hpaw: [11.4, 3.4, 1.0],
  tail: [6.4, -8.2, 8.6],
};
const STAND: Plan = {
  body: [0, -4.8, 11.2],
  bodyR: [9.6, 10.6, 7.6],
  neck: [0, 2.4, 17.6],
  neckR: [7.8, 5.8, 4.6],
  head: [0, 5.6, 25.8],
  sh: [7.4, 3.2, 11.0],
  paw: [8.8, 5.0, 1.2],
  haunch: [7.6, -11.6, 10.6],
  haunchR: [4.4, 5.0, 5.0],
  hpaw: [8.2, -11.0, 1.0],
  tail: [3.0, -14.4, 13.6],
};
const LIE: Plan = {
  body: [0, -3.4, 6.2],
  bodyR: [11.4, 10.0, 6.2],
  neck: [0, 3.0, 8.4],
  neckR: [8.2, 6.0, 4.0],
  head: [0, 7.6, 10.2],
  sh: [7.8, 4.6, 5.2],
  paw: [6.4, 12.2, 1.0],
  haunch: [10.0, -5.4, 4.6],
  haunchR: [5.2, 6.4, 4.4],
  hpaw: [12.6, 1.6, 1.0],
  tail: [6.8, -11.6, 5.4],
};

function planOf(o: Pose): Plan {
  const m = (k: keyof Plan): V3 => lerp3(lerp3(SIT[k], STAND[k], o.stand), LIE[k], o.lie);
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
    tail: m('tail'),
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
  /** Оси и радиусы туловища (манишка, жетон). */
  bc: V3;
  bax: [V3, V3, V3];
  br: V3;
  k: number;
}

/** Масштаб модели в рамке: лапы — макушка ~43 пикселя малой полосы. */
const G = 1.1;

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
    side * pl.hpaw[0] * s + o.x * 0.1,
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
    br: mul([pl.bodyR[0] * (1 + 0.04 * ch), pl.bodyR[1] * (1 + 0.06 * ch), pl.bodyR[2]], s),
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

/** Короткая шерсть (крупная): редкие штрихи вниз по поверхности, без «кипения» — от локальных координат. */
function shortFur(n: number, amp: number) {
  return (qx: number, qy: number, qz: number) => {
    const u = (Math.atan2(qx, qy) / Math.PI) * n;
    const v = qz * n * 0.9;
    const cu = Math.floor(u);
    const cv = Math.floor(v + (cu & 1) * 0.5);
    const h = hash(cu, cv, 41);
    const fu = u - cu;
    if (h < 0.42 && Math.abs(fu - 0.5) < 0.12) return -amp;
    if (h > 0.86 && Math.abs(fu - 0.3) < 0.1) return amp * 0.6;
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
  /** Брыли: отстают от головы по вертикали. */
  jowl: number;
  tailSw: number;
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

/** Часть с выбором палитры по точке на ней (манишка, проточина, носки). */
interface PartF extends Part {
  pick?: (qx: number, qy: number, qz: number) => number;
  /** Свет как у трубы: нормаль без составляющей вдоль оси — обрубок хвоста не «бусы». */
  tube?: boolean;
  /** Проявление шахматкой (щебень тает). */
  vis?: number;
  /** Не ниже пола (камни). */
  floor?: boolean;
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

/** Точки для значков поверх кадра: напульсники, кастет, ошейник. */
interface Marks {
  cuffs: { side: number; front: V3; out: V3 }[];
  knuck: V3 | null;
  collar: V3[];
  ring: V3 | null;
}
let MK: Marks = { cuffs: [], knuck: null, collar: [], ring: null };

function legs(out: PartF[], c: Ctx): void {
  const { o, S } = c;
  const k = S.k;
  const pl = S.pl;
  for (const side of [-1, 1] as const) {
    // Бедро: круглое, палевое, торчит по бокам за передними лапами.
    const hc = S.up([side * pl.haunch[0], pl.haunch[1], pl.haunch[2]]);
    out.push({
      c: hc,
      ax: axes(rollY([1, 0, 0], side * 0.25 + o.lean), [0, 0, 1]),
      r: mul(pl.haunchR, k),
      pal: P_FUR,
      id: nid(),
      bias: -0.02,
      tex: HI ? shortFur(9, 0.06) : undefined,
    });
    const hp = side < 0 ? S.hpL : S.hpR;
    if (o.stand > 0.05) {
      const knee = add(lerp3(hc, hp, 0.5), [side * 0.8 * k, -1.2 * k, 0]);
      const lid = nid();
      limb(out, add(hc, [0, 0, -2.0 * k]), knee, 2.6 * k, 2.6 * k, P_FUR, lid, { bias: -0.06 });
      limb(out, knee, hp, 2.0 * k, 2.0 * k, P_FUR, lid, {
        bias: 0.02,
        pick: (qx) => (qx > 0.2 ? P_WHITE : P_FUR),
      });
    }
    // Задняя ступня — белый носочек, носком наружу.
    out.push({
      c: add(hp, [0, 0.5 * k, 0.35 * k]),
      ax: axes(norm([side * 0.45 * (1 - o.stand), 1, 0]), [0, 0, 1]),
      r: [2.8 * k, 2.2 * k, 1.4 * k],
      pal: P_WHITE,
      id: nid(),
      bias: 0.04,
      tex: toes(HI ? 4 : 2),
    });
    // Передняя лапа: кривая — локоть наружу, толстое предплечье, белый носок.
    const sh = side < 0 ? S.shL : S.shR;
    const paw = side < 0 ? S.pawL : S.pawR;
    const lift = Math.max(0, (side < 0 ? o.fLz : o.fRz) - Math.max(0, o.z));
    const bow = 1.7 * (1 - 0.5 * clamp01(lift / 4));
    const elbow = add(lerp3(sh, paw, 0.48), [side * bow * k, (0.2 + lift * 0.12) * k, 0]);
    const lid = nid();
    limb(out, sh, elbow, 3.4 * k, 3.4 * k, P_FUR, lid, {
      bias: 0.02,
      tex: HI ? shortFur(7, 0.05) : undefined,
    });
    limb(out, elbow, paw, 2.9 * k, 3.0 * k, P_FUR, lid, {
      bias: 0.08,
      // Носок: нижняя половина предплечья белая.
      pick: (qx) => {
        PICK_T = 0;
        return qx > 0.05 ? P_WHITE : P_FUR;
      },
    });
    // Шипастый напульсник поверх предплечья.
    const fa = sub(paw, elbow);
    const cu = add(elbow, mul(fa, 0.4));
    const fax = axes(fa, [0, 1, 0]);
    out.push({
      c: cu,
      ax: fax,
      r: [1.0 * k, 3.3 * k, 3.4 * k],
      pal: P_LEATHER,
      id: nid(),
      bias: 0.06,
      tex: (qx) => (Math.abs(qx) > 0.6 ? -0.08 : 0),
    });
    const fwd = norm(sub(fax[1], mul(fax[0], dot(fax[1], fax[0]))));
    MK.cuffs.push({
      side,
      front: add(cu, mul(add(fwd, [0, 0, 0.15]), 3.3 * k)),
      out: add(cu, add(mul([side, 0, 0], 3.4 * k), [0, 0.6 * k, 0])),
    });
    // Лапа: широкая, белая, пальцы.
    const pc = add(paw, [0, 0.5 * k, 0.3 * k]);
    const pax = axes(norm([side * 0.16, 1, -lift * 0.1]), [0, 0, 1]);
    out.push({
      c: pc,
      ax: pax,
      r: [3.0 * k, 2.6 * k, 1.6 * k],
      pal: P_WHITE,
      id: lid,
      bias: 0.12,
      tex: toes(HI ? 4 : 2),
    });
    // Кастет — на правой по кадру: поверх пальцев.
    if (side > 0) MK.knuck = add(pc, add(mul(pax[0], 2.4 * k), mul(pax[2], 1.0 * k)));
  }
}

/** Туловище: палевые бока, белая манишка книзу шире. */
function bodyPick(qx: number, qy: number, qz: number): number {
  PICK_T = 0;
  const ax0 = Math.abs(qx);
  const bw = 0.34 + 0.16 * clamp01(0.4 - qz);
  if (qy > 0.3 && ax0 < bw && qz > -0.9) {
    PICK_T = HI ? shortFur(10, 0.04)(qx, qy, qz) : 0;
    return P_WHITE;
  }
  PICK_T = (qy < 0 ? -0.05 : 0) + (HI ? shortFur(10, 0.06)(qx, qy, qz) : 0);
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
  // Шея: толстая, спереди белое горло.
  const pl = S.pl;
  const k = S.k;
  const ch = o.chest;
  out.push({
    c: S.up(pl.neck),
    ax: S.bax,
    r: [pl.neckR[0] * k * (1 + 0.04 * ch), pl.neckR[1] * k, pl.neckR[2] * k],
    pal: P_FUR,
    id: nid(),
    bias: 0.02,
    pick: (qx, qy) => {
      PICK_T = 0;
      if (qy > 0.4 && Math.abs(qx) < 0.5) return P_WHITE;
      if (qy < 0) PICK_T = -0.06;
      return P_FUR;
    },
  });
}

/** Точка ошейника вокруг основания шеи: th = 0 — справа, π/2 — спереди. */
function collarPt(S: Skel, th: number): V3 {
  const pl = S.pl;
  return S.up([
    pl.neckR[0] * 0.98 * Math.cos(th),
    pl.neck[1] + pl.neckR[1] * 0.98 * Math.sin(th),
    pl.neck[2] - 2.0 - 0.6 * Math.sin(th),
  ]);
}

function collar(out: PartF[], c: Ctx): void {
  const { S } = c;
  const k = S.k;
  const id = nid();
  const segs = HI ? 16 : 10;
  for (let i = 0; i < segs; i++) {
    const t0 = lerp(0.97 * Math.PI, 0.03 * Math.PI, i / segs);
    const t1 = lerp(0.97 * Math.PI, 0.03 * Math.PI, (i + 1) / segs);
    const p0 = collarPt(S, t0);
    const p1 = collarPt(S, t1);
    const d = sub(p1, p0);
    out.push({
      c: mul(add(p0, p1), 0.5),
      ax: axes(d, [0, 0, 1]),
      r: [Math.hypot(d[0], d[1], d[2]) * 0.62 + 0.2, 1.1 * k, (HI ? 1.35 : 1.4) * k],
      pal: P_LEATHER,
      id,
      bias: 0.06,
      // Кромки ремня: верх светлее, низ темнее.
      tex: (_qx, _qy, qz) => (qz < -0.6 ? -0.1 : qz > 0.55 ? 0.1 : 0),
    });
    MK.collar.push(add(mul(add(p0, p1), 0.5), [0, 1.0 * k, -1.2 * k]));
  }
  MK.ring = add(collarPt(S, Math.PI / 2), [0, 1.0 * k, -1.6 * k]);
}

/** Обрубок хвоста: выглядывает справа из-за бедра, виляет. */
function tail(out: PartF[], c: Ctx): void {
  const { S, lag } = c;
  const k = S.k;
  const root = S.up(S.pl.tail);
  const sw = lag.tailSw;
  let dir: V3 = norm([0.8, -0.15, 0.6]);
  dir = norm(add(dir, [0, 0, 0.35 * sw]));
  dir = norm(add(dir, [0.2 * sw, 0.25 * sw, 0]));
  const id = nid();
  const n = 3;
  let p = root;
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n;
    const d = norm(add(dir, [0, 0, 0.5 * u]));
    const q = add(p, mul(d, 1.2 * k));
    out.push({
      c: lerp3(p, q, 0.5),
      ax: axes(d, [0, 0, 1]),
      r: [1.3 * k, (1.7 - 0.4 * u) * k, (1.6 - 0.4 * u) * k],
      pal: P_FUR,
      id,
      bias: 0.02 - 0.06 * u,
      tube: true,
    });
    p = q;
  }
}

/**
 * Череп: палевый, белая проточина от макушки книзу шире, низ морды белый;
 * на крупной — хмурые морщины меж бровей и складки над бровями.
 */
function skullPick(qx: number, qy: number, qz: number): number {
  PICK_T = 0;
  const ax0 = Math.abs(qx);
  let wr = 0;
  if (HI && qy > 0.3) {
    // Три коротких морщины меж бровей (хмурый лоб) и дуги над бровями.
    for (const cx of [-0.15, 0, 0.15]) {
      const zc = 0.3 + Math.abs(cx) * 0.6;
      if (Math.abs(qx - cx - (qz - zc) * 0.25 * Math.sign(cx)) < 0.028 && Math.abs(qz - zc) < 0.11)
        wr = -0.22;
    }
    const arc = 0.56 - 0.5 * (ax0 - 0.36) * (ax0 - 0.36);
    if (ax0 > 0.2 && ax0 < 0.62 && Math.abs(qz - arc) < 0.026) wr = -0.16;
  }
  const blaze = qy > 0 && qz < 0.94 && ax0 < 0.09 + 0.22 * clamp01((0.4 - qz) / 1.0);
  if (blaze || (qz < -0.42 && qy > 0.2)) {
    PICK_T = wr;
    return P_WHITE;
  }
  PICK_T = wr + (qy < -0.2 ? -0.06 : 0) + (HI ? shortFur(12, 0.05)(qx, qy, qz) : 0);
  return P_FUR;
}

function headParts(out: PartF[], flats: Flat[], c: Ctx): void {
  const { o, h, lag } = c;
  const k = h.k;
  const ez = h.dir([0, 0, 1]);
  const ex = h.dir([1, 0, 0]);
  const ey = h.dir([0, 1, 0]);
  const hax = axes(ex, ez);
  // Череп: широкий и плоский сверху — шире груди.
  out.push({
    c: h.at([0, -0.8, 2.2]),
    ax: hax,
    r: [10.2 * k, 7.0 * k, 6.6 * k],
    pal: P_FUR,
    id: nid(),
    bias: 0.04,
    pick: skullPick,
  });
  const jl = lag.jowl;
  for (const side of [-1, 1]) {
    // Скулы: палевые, на уровне глаз.
    out.push({
      c: h.at([side * 7.6, 1.4, 0.2]),
      ax: hax,
      r: [3.9 * k, 3.8 * k, 3.7 * k],
      pal: P_FUR,
      id: nid(),
      bias: 0.04,
      tex: HI ? shortFur(8, 0.05) : undefined,
    });
    // Брови: тяжёлые валики, внутренний конец ниже — хмурый взгляд.
    out.push({
      c: h.at([side * 4.3, 5.5, 3.3]),
      ax: axes(h.dir(norm([side, 0, 0.5])), h.dir([0, 0.3, 1])),
      r: [3.1 * k, 1.3 * k, 1.0 * k],
      pal: P_FUR,
      id: nid(),
      bias: 0.02,
      pick: (_qx, _qy, qz) => {
        PICK_T = qz < -0.25 ? -0.3 : 0;
        return P_FUR;
      },
    });
    // Брыли: белые, висят ниже пасти — голова шире книзу; отстают от головы.
    out.push({
      c: h.at([side * 5.6, 3.8, -4.4 - jl]),
      ax: hax,
      r: [5.7 * k * (1 + 0.04 * o.chest + 0.08 * o.lie), 4.2 * k, (5.0 + 0.35 * jl) * k],
      pal: P_WHITE,
      id: nid(),
      bias: 0.08,
      pick: (qx, qy, qz) => {
        PICK_T = 0;
        // Верх брылей снаружи — палевый (как скулы).
        if (side * qx > 0.5 && qz > 0.15) return P_FUR;
        // Складка от носа вниз мимо углов пасти.
        if (
          HI &&
          qy > 0.45 &&
          Math.abs(side * qx + 0.2 - 0.42 * qz) < 0.07 &&
          qz > -0.55 &&
          qz < 0.7
        )
          PICK_T = -0.2;
        return P_WHITE;
      },
    });
  }
  // Переносица меж брылей под складкой.
  out.push({
    c: h.at([0, 5.4, -1.4]),
    ax: hax,
    r: [3.2 * k, 2.2 * k, 2.6 * k],
    pal: P_WHITE,
    id: nid(),
    bias: 0.1,
  });
  // Толстая складка над носом: светлый валик, над ним тёмная морщина.
  out.push({
    c: h.at([0, 6.4, 1.2]),
    ax: hax,
    r: [3.9 * k, 1.3 * k, 1.0 * k],
    pal: P_WHITE,
    id: nid(),
    bias: 0.14,
    tex: (_qx, _qy, qz) => (qz < -0.55 ? -0.2 : 0),
  });
  // Нос: широкий, чёрный; на фырке ноздри раздуваются.
  const fl = o.snort >= 0 ? bump(o.snort, 0, 0.5) : 0;
  out.push({
    c: h.at([0, 7.4, -0.8]),
    ax: hax,
    r: [(3.0 + 0.35 * fl) * k, 1.4 * k, (1.6 + 0.1 * fl) * k],
    pal: P_NOSE,
    id: nid(),
    bias: -0.05,
  });
  // Нижняя челюсть: прикус — подбородок выдаётся вперёд.
  const jw = o.jaw;
  const piv: V3 = [0, 2.0, -5.0];
  const ja = jw * 0.6;
  const jd = (p: V3): V3 => add(piv, pitchX(sub(p, piv), ja));
  const jax = axes(h.dir(pitchX([1, 0, 0], ja)), h.dir(pitchX([0, 0, 1], ja)));
  out.push({
    c: h.at(jd([0, 6.6, -7.6])),
    ax: jax,
    r: [4.0 * k, 2.8 * k, 1.8 * k],
    pal: P_WHITE,
    id: nid(),
    bias: 0.02,
    // Нижняя губа — тёмная кромка сверху.
    tex: (_qx, qy, qz) => (qz > 0.5 && qy > 0.2 ? -0.32 : 0),
  });
  // Щель пасти между брылями и подбородком (на оскале и в атаке — шире).
  const gap = 0.35 + 1.4 * jw + 0.2 * o.snarl;
  out.push({
    c: h.at([0, 7.0, -6.0 - 0.6 * jw]),
    ax: hax,
    r: [3.6 * k, 1.6 * k, gap * k],
    pal: jw > 0.15 ? P_MOUTH : P_NOSE,
    id: nid(),
    bias: jw > 0.15 ? -0.1 : -0.2,
    noSeam: true,
  });
  if (o.tongue > 0.05) {
    const tg = o.tongue;
    out.push({
      c: h.at(jd([0.8, 9.5, -6.4 - 1.5 * tg])),
      ax: axes(h.dir(pitchX([1, 0, 0], ja)), h.dir(pitchX([0, 0.5, 1], ja))),
      r: [1.5 * k, 0.9 * k, (0.5 + 1.0 * tg) * k],
      pal: P_TONGUE,
      id: nid(),
      bias: 0.12,
      noSeam: true,
      tex: (qx) => (HI && Math.abs(qx) < 0.14 ? -0.12 : 0),
    });
  }
  // Нижние клыки торчат вверх поверх верхней губы всегда (прикус); в атаке — длиннее.
  for (const side of [-1, 1]) {
    const L = (HI ? 1.35 : 1.5) + 0.4 * o.snarl;
    out.push({
      c: h.at(jd([side * 2.4, 8.4, -5.4 + 0.3 * o.snarl])),
      ax: axes(h.dir(pitchX([0, 0.1, 1], ja)), ey),
      r: [L * k, (HI ? 0.6 : 0.7) * k, 0.6 * k],
      pal: P_BONE,
      id: nid(),
      bias: 0.14,
      noSeam: true,
    });
  }
  ears(flats, c);
}

/** Уши-«розочки»: маленький загнутый лоскут по углам макушки, загиб темнее. */
function ears(flats: Flat[], c: Ctx): void {
  const { o, h, lag } = c;
  for (const side of [-1, 1] as const) {
    const b0 = side < 0 ? o.earL : o.earR;
    const back = b0 + lag.earB * (1 - clamp01(Math.abs(b0)));
    const fl = side < 0 ? o.flL : o.flR;
    const base: V3 = [side * 7.4, -1.4, 6.2];
    const rot = (p: V3): V3 => {
      let q = sub(p, base);
      q = pitchX(q, -0.7 * back - 0.3 * fl);
      q = rollY(q, side * (0.35 * fl - 0.25 * back));
      return h.at(add(q, base));
    };
    const bi: V3 = [side * 6.4, -0.8, 7.6];
    const top: V3 = [side * 9.6, 0.0, 8.2];
    const tip: V3 = [side * 12.4, 0.8, 5.6];
    const bo: V3 = [side * 9.8, 0.4, 3.8];
    flats.push({
      pts: [bi, top, tip, bo].map(rot),
      apex: rot(tip),
      a: rot(bi),
      b: rot(bo),
      pal: P_EAR,
      id: nid(),
      shade: (u, r) => 0.1 - 0.12 * (1 - r) + (u < 0.1 ? 0.06 : 0),
    });
    // Загиб: тёмная изнанка вдоль верхней кромки.
    const fi = lerp3(bi, top, 0.15);
    const ft = add(lerp3(top, tip, 0.7), [0, 0.3, -0.6]);
    const fm = add(lerp3(bi, tip, 0.5), [0, 0.45, -0.5]);
    flats.push({
      pts: [fi, top, ft, fm].map(rot),
      apex: rot(ft),
      a: rot(fi),
      b: rot(fm),
      pal: P_EAR,
      id: nid(),
      shade: (_u, r) => -0.34 + 0.1 * r,
    });
  }
}

// ---------------------------------------------------------------------------
// Трюк: каменный блок и щебень.
// ---------------------------------------------------------------------------

const BLK = { x0: 13.4, x1: 23.4, yb: -1.0, yf: 7.0, zt: 10.6 };
/** Палитра, которую выбирает тон грани (`quadP`). */
let QPAL = P_STONE;

/**
 * Грань блока: параллелограмм O + s·E1 + t·E2 (s, t ∈ [0, 1]), глубина по
 * плоскости, тон — `tone(s, t)` (номер ступени; палитру можно сменить в `QPAL`).
 */
function quadP(
  f: Frame,
  O: V3,
  E1: V3,
  E2: V3,
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
      QPAL = P_STONE;
      const tn = tone(s, t);
      const N = PAL[QPAL].length;
      f.zb[i] = d;
      f.idb[i] = id;
      f.pal[i] = QPAL;
      f.tone[i] = Math.max(0, Math.min(N - 1, Math.round(tn)));
    }
}

/** Вкрапления руды на передней грани (s, t, радиус в пикселях малой). */
const ORE: [number, number, number][] = [
  [0.26, 0.7, 0.9],
  [0.7, 0.36, 0.75],
  [0.44, 0.2, 0.55],
  [0.82, 0.8, 0.5],
];

function blockDraw(f: Frame, o: Pose): void {
  const { x0, x1, yb, yf, zt } = BLK;
  const W = x1 - x0;
  const id = nid();
  const cell = HI ? 1 / RR : 1;
  const grain = (a: number, b: number) => hash(Math.floor(a / cell), Math.floor(b / cell), 13);
  const cracked = o.hit >= 0;
  // Верх: светлее, пятна, кромка к зрителю — кант.
  quadP(f, [x0, yb, zt], [W, 0, 0], [0, yf - yb, 0], id, o.block, (s, t) => {
    let k = 5.6 - 0.5 * t;
    const g = grain(s * W, t * (yf - yb));
    if (g < 0.16) k -= 1;
    else if (g > 0.9) k += 0.6;
    if (t > 0.86) k += 0.8;
    return k;
  });
  // Перёд: камень с крапом, тёмный низ, вкрапления руды, трещины после удара.
  quadP(f, [x0, yf, 0], [W, 0, 0], [0, 0, zt], id + 1, o.block, (s, t) => {
    const x = s * W;
    const z = t * zt;
    let k = 3.9 + 0.5 * t - 0.3 * s;
    const g = grain(x, z);
    if (g < 0.2) k -= 1;
    else if (g > 0.88) k += 0.8;
    if (t < 0.1) k -= 0.8;
    if (s < (HI ? 0.04 : 0.08)) k += 0.7;
    for (const [os, ot, r] of ORE) {
      const d = Math.hypot((s - os) * W, (t - ot) * zt);
      if (d < r) {
        QPAL = P_BRASS;
        return d < r * 0.45 ? 6 : 4;
      }
    }
    if (cracked) {
      // Трещины лучами от места удара (левый край, повыше).
      const cx = 0.6;
      const cz = 0.62 * zt;
      const dx = x - cx;
      const dz = z - cz;
      const a = Math.atan2(dz, dx);
      const rr = Math.hypot(dx, dz);
      for (const ra of [-1.0, -0.35, 0.25, 0.85, 1.4]) {
        let da = a - ra - 0.25 * Math.sin(rr * 1.7 + ra * 3);
        while (da > Math.PI) da -= TAU;
        while (da < -Math.PI) da += TAU;
        if (Math.abs(da) * rr < (HI ? 0.32 : 0.5) && rr < 8) return 1;
      }
    }
    return k;
  });
  NEXT_ID = Math.max(NEXT_ID, id + 1);
}

/** Куски блока: разлетаются из блока, падают, отскакивают, лежат щебнем. */
const STONES: [number, number, number, number, number, number, number, number][] = [
  // x, y, z начала; скорость вбок, вперёд, вверх; размер; руда (1).
  [15.0, 3.6, 6.0, -10, 6, 46, 1.8, 0],
  [19.6, 4.0, 7.0, 10, 3, 54, 2.0, 0],
  [17.6, 5.0, 3.0, 2, 12, 30, 1.8, 1],
  [21.6, 2.8, 3.2, 16, -2, 36, 1.6, 0],
  [14.4, 5.4, 2.4, -6, 9, 26, 1.4, 0],
  [18.4, 2.0, 8.4, 5, -4, 60, 1.3, 0],
  [16.8, 4.4, 1.4, 0, 2, 0, 2.5, 0],
  [20.4, 4.8, 1.2, 1, 1, 0, 2.2, 0],
  [22.6, 1.0, 5.0, 12, -6, 40, 1.2, 0],
];
const GRAV = 210;

function stoneParts(out: PartF[], c: Ctx): void {
  const { o } = c;
  if (o.stone < 0 || o.prop < 0.01) return;
  STONES.forEach(([x, y, z0, vx, vy, vz, r, ore], j) => {
    const tau = o.stone - j * 0.01;
    if (tau < 0) return;
    // Полёт до пола: z0 + vz·τ − g·τ²/2 = r·0.7.
    const zr = r * 0.6;
    const disc = vz * vz + 2 * GRAV * (z0 - zr);
    const t1 = (vz + Math.sqrt(Math.max(0, disc))) / GRAV;
    let z: number;
    let tt: number;
    if (tau < t1) {
      z = z0 + vz * tau - 0.5 * GRAV * tau * tau;
      tt = tau;
    } else {
      const b = tau - t1;
      const v2 = Math.max(0, (GRAV * t1 - vz) * 0.25);
      const t2 = (2 * v2) / GRAV;
      z = zr + (b < t2 ? v2 * b - 0.5 * GRAV * b * b : 0);
      tt = t1 + Math.min(b, t2);
    }
    const spin = tt * 8 + j * 1.3;
    out.push({
      c: [(x + vx * tt * 0.55) * G, (y + vy * tt * 0.55) * G, z * G],
      ax: axes([Math.cos(spin), 0.3 * Math.sin(j), Math.sin(spin)], [0, 1, 0]),
      r: [r * 1.2 * G, r * G, r * 0.8 * G],
      pal: ore ? P_BRASS : P_STONE,
      id: nid(),
      bias: ore ? 0.06 : 0.02,
      floor: true,
      vis: o.prop,
      tex: (qx, qy, qz) =>
        qx + qz > 0.9 ? 0.12 : qy < -0.2 ? -0.08 : hash(j, 0, 3) > 0.5 && qx < -0.6 ? -0.1 : 0,
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
        if (pt.floor && pt.c[2] + e1[2] * qx * r1 + e2[2] * qy * r2 + e3[2] * qz * r3 < 0) continue;
        if (vis < 1 && !dith(px, py, vis)) continue;
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
      if (pl !== P_FUR && pl !== P_WHITE && pl !== P_EAR) continue;
      for (const j of [i + w, i + 1]) {
        if (pal[j] === pl && idb[j] === idb[i] && tone[j] === tone[i] - 1 && dith(x, y, 0.28))
          hit.push(j, tone[i]);
      }
    }
  for (let n = 0; n < hit.length; n += 2) f.tone[hit[n]] = hit[n + 1];
}

// ---------------------------------------------------------------------------
// Поверх кадра: глаза, нос, пластыри, шипы, жетон, кастет, вспышка, пыль, сон.
// ---------------------------------------------------------------------------

function eyePal(): Record<string, RGBA> {
  return {
    k: V === 1 ? hx('#2a1606') : hx('#26120a'),
    K: hx('#070403'),
    W: hx('#fffbe8'),
    b: V === 1 ? hx('#9a6a2a') : hx('#8a5428'),
    c: V === 1 ? hx('#55300e') : hx('#4a2810'),
    f: PAL[P_FUR][7],
    F: PAL[P_FUR][5],
  };
}
// Малая: глаз — бусина 2×2, блик сверху-слева у обоих (свет один).
const EYES_S: Record<string, string[]> = {
  open: ['Fk', 'Wc'],
  half: ['FF', 'Fc'],
  shut: ['..', 'kk'],
  happy: ['.k.', 'k.k'],
  sleep: ['...', 'kkk'],
  angry: ['k.', 'Wc'],
  smug: ['FF', 'Wc'],
};
// Крупная: глаз 6×5 под тяжёлым веком — ободок, радужка, зрачок, блик.
const EYES_L: Record<string, string[]> = {
  open: ['kkk...', 'kFFkkk', 'kWWKck', 'kbKKck', '.kcck.'],
  half: ['......', '.kkkk.', 'kFFFFk', 'kbKKck', '.kcck.'],
  shut: ['......', '......', 'k....k', '.kkkk.', '......'],
  happy: ['......', '..kk..', '.k..k.', 'k....k', '......'],
  sleep: ['......', '......', 'kk..kk', '..kk..', '......'],
  angry: ['kk....', 'kkkk..', 'kWbkkk', 'kbKKck', '.kcck.'],
  smug: ['......', '.kkkk.', 'kFFFFk', 'kWKKck', '.kcck.'],
};
/** Разные стороны у этих глаз (бровь); у круглых блик слева у обоих. */
const EYE_FLIP = new Set(['angry', 'open']);

const PLAST_S = ['p.p', '.P.', 'p.p'];
const PLAST_L = [
  'dp.....pd',
  'pPp...pPp',
  '.pPp.pPp.',
  '..pPWPp..',
  '...WWW...',
  '..pPWPp..',
  '.pPp.pPp.',
  'pPp...pPp',
  'dp.....pd',
];

function face(p: Px, f: Frame, c: Ctx): void {
  const { o, h } = c;
  const ep = eyePal();
  for (const side of [-1, 1] as const) {
    const at = seen(f, mul(h.at([side * 4.1, 5.8, 1.7]), RR), OX, OY, 2.4 * RR);
    if (!at) continue;
    let key: string = o.eye;
    if (key === 'open' || key === 'angry' || key === 'smug') {
      if (o.blink > 0.7) key = 'shut';
      else if (o.blink > 0.25) key = 'half';
    }
    const flip = side > 0 && EYE_FLIP.has(key);
    const rows = HI ? EYES_L[key] : EYES_S[key];
    const wdt = rows[0].length;
    // Зрачки смотрят вбок: сдвиг на пиксель у крупной.
    const lk = HI && (key === 'open' || key === 'smug') ? Math.round(o.look) : 0;
    stamp(p, rows, ep, at[0] - Math.floor(wdt / 2) + lk, at[1] - (HI ? 2 : 1), flip);
  }
  // Нос: блик; крупная — ноздри и бороздка вниз.
  const nose = seen(f, mul(h.at([0, 8.6, -0.4]), RR), OX, OY, 1.6 * RR);
  if (nose) {
    const nl = PAL[P_NOSE];
    const ink = INK_V[V];
    if (HI) {
      p.set(nose[0] - 2, nose[1] - 2, nl[5]);
      p.set(nose[0] - 1, nose[1] - 2, nl[4]);
      p.set(nose[0] - 3, nose[1] - 1, nl[4]);
      const fl = o.snort >= 0 ? bump(o.snort, 0, 0.5) : 0;
      for (const s of [-1, 1]) {
        const x = nose[0] + s * (fl > 0.4 ? 4 : 3);
        p.set(x, nose[1] + 1, ink);
        p.set(x - s, nose[1] + 1, ink);
        p.set(x, nose[1] + 2, ink);
        if (fl > 0.4) p.set(x - s, nose[1] + 2, ink);
      }
      p.set(nose[0], nose[1] + 2, ink);
      p.set(nose[0], nose[1] + 3, ink);
    } else p.set(nose[0] - 1, nose[1] - 1, nl[5]);
  }
  // Малая: кончики нижних клыков — по белому пикселю (прикус читается в 44).
  if (!HI) {
    const bn = PAL[P_BONE];
    for (const side of [-1, 1]) {
      const q = h.at([side * 2.4, 8.7, -4.3 + 0.3 * o.snarl + 0.6 * o.jaw]);
      const at = seen(f, mul(q, RR), OX, OY, 1.6);
      if (at) p.set(at[0], at[1], bn[5]);
    }
  }
  // Два пластыря крест-накрест на лбу (слева по кадру).
  const pl = seen(f, mul(h.at([-5.2, 4.2, 5.6]), RR), OX, OY, 2 * RR);
  if (pl) {
    const pp = PAL[P_PLASTER];
    const pal: Record<string, RGBA> = { p: pp[4], P: pp[5], W: pp[6], d: pp[2] };
    if (HI) stamp(p, PLAST_L, pal, pl[0] - 4, pl[1] - 4);
    else stamp(p, PLAST_S, pal, pl[0] - 1, pl[1] - 1);
  }
}

const SPIKE_L = ['WSd', 'WSd', '.S.', '.d.'];
const RING_L = ['.sss.', 's...s', 's...s', '.sss.'];
const TAG_L = [
  '..dSSSd..',
  '.dSWWSSd.',
  'dSWkSkkkd',
  'dSWkSSSkd',
  'dSSkSSkSd',
  'dSSkSSkSd',
  '.dSkSkSd.',
  '..dSSSd..',
];
const STUD_L = ['Ws', 'sd'];
const CSPIKE_L = ['Ss..', 'WSSd', 'sd..'];
const KN_S = ['WbWb', 'dbdb'];
const KN_L = [
  '.WW.Wb.Wb.bb.',
  'WkkWkkbkkbkkb',
  'bkkbkkbkkbkkd',
  'bbbbbbbbbbbbd',
  '.dbbbbbbbbbd.',
  '..ddddddddd..',
];

function sparkle(p: Px, x: number, y: number, R: number, u: number): void {
  const core = hx('#fffbe8');
  const ray = hx('#ffe9a0');
  p.set(x, y, core);
  for (let d = 1; d <= R; d++) {
    const c = d <= Math.max(1, R * 0.4) ? core : ray;
    if (!dith(x + d, y, 1.2 - (d / (R + 1)) * u)) continue;
    p.set(x + d, y, c);
    p.set(x - d, y, c);
    p.set(x, y + d, c);
    p.set(x, y - d, c);
  }
  if (R >= 4) {
    const dg = Math.floor(R * 0.45);
    for (let d = 1; d <= dg; d++)
      for (const [sx, sy] of [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ])
        p.set(x + sx * d, y + sy * d, d === 1 ? core : ray);
  }
}

function gear(p: Px, f: Frame, c: Ctx): void {
  const { o } = c;
  const st = PAL[P_STEEL];
  const sp: Record<string, RGBA> = { W: st[8], S: st[6], s: st[5], d: st[3], k: st[2] };
  // Шипы по нижней кромке ошейника.
  MK.collar.forEach((q, j) => {
    if (!HI && j % 2 === 0) return;
    if (HI && j % 2 === 1) return;
    const at = seen(f, mul(q, RR), OX, OY, 1.8 * RR);
    if (!at) return;
    if (HI) stamp(p, SPIKE_L, sp, at[0] - 1, at[1]);
    else {
      p.set(at[0], at[1], st[7]);
      p.set(at[0], at[1] + 1, st[4]);
    }
  });
  // Кольцо и жетон «17» под горлом.
  if (MK.ring && o.lie < 0.5) {
    const at = seen(f, mul(MK.ring, RR), OX, OY, 2.2 * RR);
    if (at) {
      if (HI) {
        stamp(p, RING_L, sp, at[0] - 2, at[1] - 1);
        stamp(p, TAG_L, sp, at[0] - 4, at[1] + 2);
      } else {
        p.set(at[0], at[1], st[6]);
        stamp(p, ['WS', 'Sd'], sp, at[0] - 1, at[1] + 1);
      }
    }
  }
  // Напульсники: заклёпки спереди и шип наружу.
  for (const cf of MK.cuffs) {
    const fr = seen(f, mul(cf.front, RR), OX, OY, 2 * RR);
    if (fr) {
      if (HI) {
        stamp(p, STUD_L, sp, fr[0] - 3, fr[1] - 1);
        stamp(p, STUD_L, sp, fr[0] + 2, fr[1] - 1);
      } else p.set(fr[0], fr[1], st[7]);
    }
    const ot = seen(f, mul(cf.out, RR), OX, OY, 3 * RR);
    if (ot) {
      if (HI) stamp(p, CSPIKE_L, sp, cf.side > 0 ? ot[0] : ot[0] - 3, ot[1] - 1, cf.side < 0);
      else p.set(ot[0] + cf.side, ot[1], st[6]);
    }
  }
  // Кастет на правой лапе.
  if (MK.knuck) {
    const at = seen(f, mul(MK.knuck, RR), OX, OY, 2.6 * RR);
    if (at) {
      const br = PAL[P_BRASS];
      const kp: Record<string, RGBA> = { W: br[7], b: br[5], d: br[2], k: hx('#2a1606') };
      if (HI) stamp(p, KN_L, kp, at[0] - 6, at[1] - 2);
      else stamp(p, KN_S, kp, at[0] - 2, at[1] - 1);
      if (o.glint >= 0) {
        const u = o.glint;
        const R = Math.round(
          (HI ? 6 : 2.4) * Math.sin(Math.PI * clamp01(u * 2 - (u > 0.5 ? 1 : 0))),
        );
        if (R > 0) sparkle(p, at[0] + (HI ? 6 : 2), at[1] - (HI ? 3 : 1), R, 0.3);
      }
    }
  }
}

/** Вспышка удара о блок. */
function flash(p: Px, c: Ctx): void {
  const { o } = c;
  if (o.hit < 0 || o.hit > 0.22 || !MK.knuck) return;
  const [sx, sy] = project(mul(add(MK.knuck, [1.6, 0, 0.6]), RR));
  const u = o.hit / 0.22;
  const R = Math.round((HI ? 11 : 5) * (1 - 0.55 * u));
  sparkle(p, Math.round(OX + sx), Math.round(OY + sy), R, u);
}

const DUST = [hx('#ddd6c8'), hx('#aaa294'), hx('#7c766c')];
const PUFFS: [number, number, number, number][] = [
  // x, y, z, задержка
  [13.4, 6.8, 0.8, 0],
  [17.0, 8.0, 1.2, 0.04],
  [21.6, 6.4, 1.0, 0.08],
  [18.6, 2.6, 4.0, 0.02],
  [12.0, 4.2, 2.4, 0.1],
];

/** Пыль от раскола: клубы растут и тают, только по фону и камню (питомца не пачкает). */
function dust(p: Px, f: Frame, mask: Uint8Array, c: Ctx): void {
  const { o } = c;
  if (o.stone < 0 || o.stone > 0.75) return;
  for (const [x, y, z, dl] of PUFFS) {
    const u = (o.stone - dl) / 0.65;
    if (u <= 0 || u >= 1) continue;
    const [sx, sy] = project(mul([x, y, z + 2.2 * u], RR));
    const cx = OX + sx;
    const cy = OY + sy;
    const R = (1.4 + 3.4 * Math.sqrt(u)) * RR;
    const vis = (u < 0.3 ? 1 : (1 - u) / 0.7) * o.prop;
    for (let py = Math.floor(cy - R); py <= Math.ceil(cy + R); py++)
      for (let px = Math.floor(cx - R); px <= Math.ceil(cx + R); px++) {
        if (px < 0 || py < 0 || px >= p.w || py >= p.h) continue;
        const dx = px + 0.5 - cx;
        const dy = py + 0.5 - cy;
        const d = Math.hypot(dx, dy) / R;
        if (d > 1) continue;
        const i = py * p.w + px;
        if (mask[i] && f.pal[i] !== P_STONE) continue;
        if (!dith(px, py, vis * (1.7 - d * 1.1))) continue;
        const lit = -dx - dy;
        p.set(px, py, DUST[lit > R * 0.3 ? 0 : lit > -R * 0.4 ? 1 : 2]);
      }
  }
}

/** Фырк: два клубка пара из ноздрей вниз-в стороны. */
function puff(p: Px, c: Ctx): void {
  const { o, h } = c;
  if (o.snort < 0) return;
  const u = o.snort;
  const col = hx('#f2eee6');
  for (const s of [-1, 1]) {
    const [sx, sy] = project(mul(h.at([s * (1.4 + 3.2 * u), 9.4, -1.6 - 2.4 * u]), RR));
    const cx = OX + sx;
    const cy = OY + sy;
    const R = (0.7 + 1.3 * u) * RR;
    for (let py = Math.floor(cy - R); py <= Math.ceil(cy + R); py++)
      for (let px = Math.floor(cx - R); px <= Math.ceil(cx + R); px++) {
        if (px < 0 || py < 0 || px >= p.w || py >= p.h) continue;
        if (Math.hypot(px + 0.5 - cx, py + 0.5 - cy) > R) continue;
        if (!dith(px, py, 0.9 * (1 - u))) continue;
        p.set(px, py, col);
      }
  }
}

/** Сон: пузырь из левой ноздри растёт на вдохе и опадает. */
function bubble(p: Px, c: Ctx): void {
  const { o, h } = c;
  const r = (0.8 + 1.7 * o.bubble) * RR;
  const [sx, sy] = project(mul(h.at([-1.6, 9.0, -1.2]), RR));
  const cx = OX + sx - r * 0.9;
  const cy = OY + sy + r * 0.25;
  const rim = hx('#cfe6ef');
  const fill = hx('#e6f2f6');
  const W = hx('#ffffff');
  for (let py = Math.floor(cy - r - 1); py <= Math.ceil(cy + r + 1); py++)
    for (let px = Math.floor(cx - r - 1); px <= Math.ceil(cx + r + 1); px++) {
      if (px < 0 || py < 0 || px >= p.w || py >= p.h) continue;
      const d = Math.hypot(px + 0.5 - cx, py + 0.5 - cy);
      if (d > r + 0.5) continue;
      if (d > r - (HI ? 1.2 : 0.8)) p.set(px, py, rim);
      else if (d > r - (HI ? 2.4 : 1.2) && px + py < cx + cy - r * 0.6) p.set(px, py, fill);
    }
  const hlx = Math.round(cx - r * 0.45);
  const hly = Math.round(cy - r * 0.45);
  p.set(hlx, hly, W);
  if (HI && r > 4) {
    p.set(hlx + 1, hly, W);
    p.set(hlx, hly + 1, W);
  }
}

/** Атака: лучи удара от кулака — только по пустому фону. */
function punchRays(p: Px, mask: Uint8Array, c: Ctx): void {
  const { o } = c;
  if (!MK.knuck) return;
  const u = o.punch;
  const [sx, sy] = project(mul(MK.knuck, RR));
  const mx = OX + sx;
  const my = OY + sy;
  const col = hx('#fff4dc');
  const dim = hx('#f0c070');
  const vis = u < 0.6 ? 1.1 : (1 - u) / 0.4;
  const r0 = (HI ? 14 : 7) + u * (HI ? 9 : 4.5);
  const L = HI ? 8 : 4;
  for (const a of [-2.4, -1.57, -1.0, -0.45, 0.1, 0.6, 1.1]) {
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
  // Вспышка на кастете — поверх всего: удар читается и на груди.
  if (u < 0.55) sparkle(p, Math.round(mx), Math.round(my), Math.round((HI ? 9 : 4) * (1 - u)), u);
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
    headX: lagged((tt) => sk(tt).head[0], 3.4, 0.34, (L0?.headX ?? 0) - S0.head[0], 1),
    headZ: lagged((tt) => sk(tt).head[2], 3.4, 0.34, (L0?.headZ ?? 0) - S0.head[2], 0.8),
    jowl: 0,
    tailSw: lagged((tt) => P(tt).tailSw, 3.0, 0.22, (L0?.tailSw ?? 0) - P0.tailSw),
    earB: 0,
  };
  // Брыли и уши — только запаздывание за головой (разница пружины и позы).
  const hz = (tt: number) => sk(tt).head[2];
  const zNow = hz(t);
  const jLag = (zNow - spring(hz, t, t0, 2.6, 0.18)) * env;
  r.jowl = Math.max(-1.2, Math.min(1.2, 0.7 * jLag)) + (L0 ? L0.jowl * (1 - env) : 0);
  const eLag = (spring(hz, t, t0, 3.0, 0.2) - zNow) * env;
  r.earB = Math.max(-0.35, Math.min(0.35, -0.2 * eLag)) + (L0 ? L0.earB * (1 - env) : 0);
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
export function bulldogFrame(a: Anim, i: number, res: Res = 's', v = 0): Px {
  const cv = RES[res];
  RR = cv.box / RES.s.box;
  HI = res === 'l';
  OX = cv.bx + cv.box / 2;
  OY = cv.by + GROUND * RR;
  V = v === 1 ? 1 : 0;
  NEXT_ID = 0;
  MK = { cuffs: [], knuck: null, collar: [], ring: null };
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
  collar(parts, c);
  headParts(parts, flats, c);
  stoneParts(parts, c);
  drawPartsF(f, toRes(parts), PAL, OX, OY);
  drawFlats(f, flats);
  if (o.block > 0.01) blockDraw(f, o);
  seams(f, 1.2 * RR, 1);
  rimLight(f, PAL, (pl) => pl !== P_MOUTH && pl !== P_NOSE && pl !== P_TONGUE);
  if (HI) softBands(f);
  const p = toPx(f, PAL);
  selOutline(p, INK_V[V], 0.8);
  const mask = new Uint8Array(p.w * p.h);
  for (let j = 0; j < mask.length; j++) mask[j] = p.data[j * 4 + 3] > 0 ? 1 : 0;
  face(p, f, c);
  gear(p, f, c);
  dust(p, f, mask, c);
  flash(p, c);
  puff(p, c);
  if (a === 'sleep') bubble(p, c);
  if (o.punch >= 0) punchRays(p, mask, c);
  return p;
}
