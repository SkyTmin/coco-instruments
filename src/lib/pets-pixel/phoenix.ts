// Феникс свободы — пиксельный питомец по эталону боссов 12–14.
//
// Огненная птица анфас, как на гербе. Стать орла, а не цыплёнка: узкое
// багровое туловище и «штаны» на бёдрах, золотая грудь рядами чешуек-перьев,
// длинная шея с золотым горлом, небольшая голова с надбровьями, золотой
// крючковатый клюв (восковица, блик по гребню, ноздри, тёмный крюк), глаза с
// радужкой и бликом, золотой штрих от уголка. Хохолок — пять лент-языков с
// завитками. Крылья приподняты и раскрыты рядами: багровые малые кроющие в
// чешуйках, золотые большие кроющие, огненные второстепенные и маховые — у
// каждого пера блик стержня и тень кромки. Хвост — четыре длинных пера-ленты
// стекают в стороны и вниз до земли, на концах «глазки» и завитки, с лент
// срываются языки пламени. Лапы в щитках, четыре пальца с тёмными когтями,
// на правой — браслет сломанных кандалов с обрывком цепи. Огонь — форма
// самих перьев (багрянец у основания → белый жар к кончику), не факелы.
//
// Две полосы, у каждой свой рисунок (не копия уменьшением): малая — рамка
// 48, для шахты и списков, перьев меньше и они крупнее; крупная — рамка 112
// (тело ~96 пикселей) для карточки, вылупления и Питомника: все ряды перьев,
// чешуйки, радужка, ноздри, мягкие переходы тона, звёздочки искр. Модель
// общая — в пикселях малой полосы; крупная — та же модель ×112/48 (`RR`) с
// подробностями (`HI`).
//
// Анимации 24 к/с, каждая — дорожка ключей (`kf`): подготовка → разгон →
// пик → проводка → отдача → возврат. Хохолок, маховые, хвост и цепь — те же
// ключи с запаздыванием (`spring` от позы ведущей части). Пламя перьев
// мерцает в своей фазе у каждого пера, по хвостовым лентам бежит волна; у
// разовых анимаций часы пламени сведены так, что последний кадр стыкуется с
// первым кадром покоя.
//
// Трюк «сгорает и возрождается» — по раскадровке: обнял себя крыльями →
// огонь съедает его снизу вверх (ниже кромки — уголь с тлеющими трещинами)
// → осыпается кучкой пепла → в пепле дышит уголёк, жар нарастает → из
// кучки поднимается тёмный силуэт в огненных крапинах → вспышка → птица в
// цвете расправляет крылья и складывает их.

import type { Px } from '../dungeon-art';
import {
  add,
  axes,
  AX0,
  bezQ,
  bump,
  clamp01,
  cross,
  dith,
  drawParts,
  hash,
  hx,
  kf,
  lerp,
  lerp3,
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
// Палитры: по 5–8 ступеней, тени уходят в багрянец и лиловый, блики — в
// золото и бледно-жёлтый.
// ---------------------------------------------------------------------------

const P_BODY = 0;
const P_BELLY = 1;
const P_GOLD = 2;
const P_FIRE = 3;
const P_IRON = 4;
const P_EMBER = 5;
const P_ASH = 6;
const P_HORN = 7;
const P_CHAR = 8;
const PALS: RGBA[][] = [
  // Тело.
  ramp('#2a0a26', '#4e0f2c', '#7a1730', '#a82430', '#d0402f', '#ec6a3a', '#ff9a52'),
  // Грудь, горло, большие кроющие.
  ramp('#6a1e1c', '#9c3a1a', '#d0661e', '#f0962e', '#fdc04a', '#ffe08a', '#fff4c8'),
  // Клюв и лапы.
  ramp('#4e260a', '#8a5012', '#c88a24', '#eebf44', '#fde68c', '#fffbe0'),
  // Огонь перьев: багрянец → белый жар.
  ramp('#4c0a1c', '#86121f', '#c42c1f', '#ec5e1a', '#ff9324', '#ffc63c', '#ffe98a', '#fffbe6'),
  // Железо кандалов.
  ramp('#1c1f26', '#343a44', '#535c68', '#7d8894', '#b4bec8'),
  // Уголёк.
  ramp('#1a0a0e', '#3a1214', '#6a1a14', '#b8361a', '#ff7a1e', '#ffd040'),
  // Пепел.
  ramp('#2a2426', '#4a4244', '#706668', '#9c9294'),
  // Когти: тёмный рог.
  ramp('#1a1016', '#3a2426', '#5e3c34', '#8a5a44', '#b88a5c'),
  // Уголь прогоревшего тела.
  ramp('#0e0608', '#1e0c0e', '#2e1412', '#40201a', '#5a2c1e'),
];
/** Тёмный силуэт, что встаёт из пепла. */
const SIL = ramp('#0c0509', '#190810', '#280d16', '#3a121e');
const INK = hx('#1a0610');
const WHITE = hx('#fffbe6');
const FIRE = PALS[P_FIRE];
const GOLD = PALS[P_GOLD];

// ---------------------------------------------------------------------------
// Кадр: холст и рамка тела у двух полос.
// ---------------------------------------------------------------------------

export type Res = 's' | 'l';
export interface Canvas {
  /** Рамка тела (сторона квадрата в пикселях рисунка): по ней игра ставит питомца. */
  box: number;
  /** Холст кадра: рамка тела в середине, вокруг — место для крыльев, прыжка и пламени. */
  cw: number;
  ch: number;
  /** Левый верхний угол рамки тела на холсте. */
  bx: number;
  by: number;
}
export const RES: Record<Res, Canvas> = {
  s: { box: 48, cw: 128, ch: 104, bx: 40, by: 34 },
  l: { box: 112, cw: 300, ch: 244, bx: 94, by: 80 },
};
export const BOX = RES.s.box;
/** Земля — на столько пикселей малой полосы ниже верха рамки. */
const GROUND = 45;
/** Масштаб полосы (1 — малая, 112/48 — крупная), подробности, начало модели на холсте. */
let RR = 1;
let HI = false;
let OX = 0;
let OY = 0;
/** cos угла камеры: высота модели → строки кадра. */
const CE = -project([0, 0, 1])[1];

export type Anim = 'idle' | 'walk' | 'happy' | 'work' | 'attack' | 'sleep';
export const FPS = 24;
/** Кадров на анимацию: покой 3 с, ходьба 1, радость 1,1, трюк 2, атака 0,9, сон 3. */
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
  /** Крылья: угол руки от «вниз» наружу, веер перьев, обхват к груди (0…1). Левое/правое по кадру. */
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
  /** Трюк: кромка огня снизу вверх (0…1), языки на кромке, масштаб птицы. */
  front: number;
  blaze: number;
  scale: number;
  /** Кучка пепла, уголёк в ней, силуэт из пепла, вспышка, столб пламени. */
  ash: number;
  ember: number;
  sil: number;
  flash: number;
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
  // Покой: крылья приподняты и раскрыты, как на гербе, — видны ряды перьев.
  thL: 2.2,
  thR: 2.2,
  fanL: 1,
  fanR: 1,
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
  front: 0,
  blaze: 0,
  scale: 1,
  ash: 0,
  ember: 0,
  sil: 0,
  flash: 0,
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
  o.thL = REST.thL + 0.22 * shk + 0.03 * br;
  o.thR = REST.thR + 0.22 * shk + 0.03 * br;
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
  // Крылья — балансир: та, что над поднятой лапой, выше; маховые доигрывают сами.
  o.thL = REST.thL + 0.1 + 0.14 * Math.max(0, -sway);
  o.thR = REST.thR + 0.1 + 0.14 * Math.max(0, sway);
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
    [0.8, 1.1, 'i'],
    [0.9, 1.0, 'o'],
    [1.0, REST.thL],
    [T, REST.thL],
  ]);
  o.thL = o.thR = flap;
  o.fanL = o.fanR = kf(t, [
    [0, REST.fanL],
    [0.16, 0.8, 'o'],
    [0.3, 1.4, 'o'],
    [0.85, 1.3],
    [1.0, REST.fanL],
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
  const o: Pose = { ...REST };
  // 0–0,2 с — подготовка: сжался, обнял себя крыльями, хохолок вниз, глаза закрыл.
  o.hugL = o.hugR = kf(t, [
    [0, 0],
    [0.2, 0.8, 'o'],
    [1.0, 0.8],
    [1.36, 0.8],
    [1.58, 0.8],
    [1.68, 0, 'o'],
  ]);
  o.thL = o.thR = kf(t, [
    [0, REST.thL],
    [0.2, 0.75, 'o'],
    [1.58, 0.75],
    [1.7, 2.5, 'o'],
    [1.8, 2.3],
    [2.0, REST.thL],
  ]);
  o.fanL = o.fanR = kf(t, [
    [0, REST.fanL],
    [0.2, 0.55],
    [1.58, 0.55],
    [1.7, 1.45, 'o'],
    [1.82, 1.35],
    [2.0, REST.fanL],
  ]);
  o.sq = kf(t, [
    [0, 0],
    [0.2, 0.12, 'o'],
    [0.72, 0.1],
    [0.98, 0.4, 'i'],
    [1.36, 0.4],
    [1.4, 0.12],
    [1.58, 0.04],
    [1.7, -0.14, 'o'],
    [1.84, 0.05],
    [1.95, 0, 'o'],
  ]);
  o.nod = kf(t, [
    [0, 0],
    [0.2, 0.25, 'o'],
    [1.58, 0.28],
    [1.7, -0.2, 'o'],
    [1.86, -0.06],
    [2.0, 0],
  ]);
  o.eye = t < 0.14 || t > 1.86 ? 'open' : t > 1.64 ? 'happy' : 'sleep';
  // 0,2–0,72 — кромка огня поднимается от лап к хохолку; ниже неё — уголь.
  o.front = kf(t, [
    [0.2, 0],
    [0.72, 1],
    [1.3, 1],
    [1.32, 0],
  ]);
  o.blaze = kf(t, [
    [0.18, 0],
    [0.3, 0.8, 'o'],
    [0.72, 1],
    [0.9, 0.35],
    [0.98, 0, 'i'],
  ]);
  // 0,72–0,98 — прогоревшая птица осыпается в кучку пепла.
  o.scale = kf(t, [
    [0.72, 1],
    [0.98, 0.12, 'i'],
    [1.36, 0.17],
    [1.6, 1.04, 'o'],
    [1.72, 1.0],
  ]);
  o.ash = kf(t, [
    [0.7, 0],
    [0.98, 1, 'o'],
    [1.4, 1],
    [1.62, 0, 'i'],
  ]);
  // 0,9–1,4 — уголёк в пепле дышит, жар нарастает перед вспышкой.
  o.ember = kf(t, [
    [0.9, 0],
    [1.0, 1, 'o'],
    [1.32, 1],
    [1.4, 0, 'i'],
  ]);
  // 1,36–1,6 — из кучки встаёт тёмный силуэт; 1,58–1,7 — вспышка, птица в цвете.
  o.sil = kf(t, [
    [1.3, 0],
    [1.34, 1],
    [1.58, 1],
    [1.68, 0, 'i'],
  ]);
  o.flash = kf(t, [
    [1.56, 0],
    [1.62, 1, 'o'],
    [1.76, 0, 'i'],
  ]);
  o.pillar = kf(t, [
    [1.56, 0],
    [1.62, 1.2, 'o'],
    [1.74, 0.5],
    [1.88, 0, 'i'],
  ]);
  // 1,7–2 — расправил крылья высоко, подпрыгнул, сложил.
  o.z = kf(t, [
    [1.62, 0],
    [1.74, 3, 'o'],
    [1.86, 2.4],
    [1.97, 0, 'i'],
  ]);
  o.crest = kf(t, [
    [0, 0],
    [0.2, -0.5],
    [1.6, -0.5],
    [1.72, 1.3, 'o'],
    [1.88, 0.9],
    [2.0, 0],
  ]);
  o.tailUp = kf(t, [
    [1.62, 0],
    [1.74, 1, 'o'],
    [1.9, 0.6],
    [2.0, 0],
  ]);
  o.tailFan = kf(t, [
    [0, 0],
    [0.2, -0.4],
    [1.6, -0.4],
    [1.74, 1, 'o'],
    [1.92, 0.5],
    [2.0, 0],
  ]);
  o.fire = kf(t, [
    [0, 1],
    [0.2, 1.3],
    [1.58, 1.3],
    [1.68, 1.8, 'o'],
    [1.9, 1.3],
    [2.0, 1],
  ]);
  o.beak = bump(t, 1.66, 1.88) * 0.7;
  return o;
}

function attackPose(t: number): Pose {
  // Замах вверх-назад → удар крыльями вниз-вперёд (контакт 0,375 с, 9-й
  // кадр) → проводка крест-накрест → возврат.
  const o: Pose = { ...REST };
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
    [0.1, 1.6, 'o'],
    [0.3, 2.6, 'o'],
    [0.35, 2.65],
    [0.39, 1.0, 'i'],
    [0.5, 0.45, 'o'],
    [0.66, 0.85],
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
    [0, REST.fanL],
    [0.3, 1.45, 'o'],
    [0.39, 1.0],
    [0.55, 0.7],
    [0.84, REST.fanL],
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
  o.hz = -4.2 + 0.35 * br;
  o.nod = 0.5 - 0.04 * br;
  o.tilt = 0.12;
  o.hx = 0.6;
  o.crest = -0.85 + 0.08 * br;
  // Сон: крылья сложены вдоль тела плащом.
  o.thL = o.thR = 0.32 + 0.02 * br;
  o.fanL = o.fanR = 0.45;
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
// Скелет: где что стоит при данной позе (в пикселях малой полосы).
// ---------------------------------------------------------------------------

interface Skel {
  /** Точка модели верхней части тела → кадр модели (сжатие, наклон, крен, прыжок, масштаб). */
  up: (p: V3) => V3;
  body: V3;
  chest: V3;
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

const BODY0: V3 = [0, 0.4, 14.6];
const HEAD0: V3 = [0, 3.0, 31.6];
/**
 * Масштаб модели в рамке: тело (лапы — макушка хохолка) занимает ~5/6 рамки,
 * как у соседей по отряду; хвост и крылья могут выходить за неё.
 */
const G = 0.84;

function skel(o: Pose): Skel {
  const s = o.scale * G;
  const sq = o.sq;
  const up = (p: V3): V3 => {
    let q: V3 = [p[0] * (1 + sq * 0.55), p[1] * (1 + sq * 0.4), p[2] * (1 - sq)];
    q = pitchX(q, o.bow, [0, 0, 5]);
    q = rollY(q, o.lean, [0, 0, 0]);
    q = mul(q, s);
    return add(q, [o.x, 0, o.z]);
  };
  const foot = (side: number, dx: number, dz: number): V3 =>
    add([side * 3.3 * s + dx, 2.6 * s, 0.7 * s + dz], [o.x * 0.15, 0, o.z]);
  return {
    up,
    body: up(BODY0),
    chest: up([0, 3.1, 16.4]),
    head: up(add(HEAD0, [o.hx, 0, o.hz])),
    shoulderL: up([-5.6, 1.0, 21.8]),
    shoulderR: up([5.6, 1.0, 21.8]),
    rump: up([0, -4.4, 8.6]),
    hipL: up([-3.0, 1.6, 5.6]),
    hipR: up([3.0, 1.6, 5.6]),
    footL: foot(-1, o.fLx, o.fLz),
    footR: foot(1, o.fRx, o.fRz),
    k: s,
  };
}

/** Голова: точка в её координатах (вперёд +y, вверх +z, в единицах модели) → кадр модели. */
interface HeadF {
  at: (p: V3) => V3;
  dir: (v: V3) => V3;
  /** Масштаб головы: на малой голова крупнее — иначе глаза и клюв не помещаются. */
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
  const k = S.k * (HI ? 1 : 1.2);
  return { dir, k, at: (p) => add(S.head, mul(dir(p), k)) };
}

// ---------------------------------------------------------------------------
// Детали.
// ---------------------------------------------------------------------------

/** Чешуйки перьев на теле (ось части 3 — вверх): тёмная дуга внизу каждой чешуйки. */
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

/** Чешуйки на плоскости: `u` — поперёк рядов (−1…1, ряды растут к +1), `v` — вдоль ряда. */
function scales2(rows: number, cols: number, amp: number) {
  return (u: number, v: number) => {
    const r = (u + 1) * rows * 0.5;
    const row = Math.floor(r);
    const fr = r - row;
    const cc = (v + 1) * cols * 0.5 + (row & 1) * 0.5;
    const fc = cc - Math.floor(cc);
    const edge = (fc - 0.5) ** 2 * 4;
    return fr > 0.78 - edge * 0.45 ? -amp : fr < 0.2 ? amp * 0.5 : 0;
  };
}

/** Перо: блик стержня по середине (на крупной) и тень одной кромки — перья ряда не сливаются. */
const featherTex = (qx: number, qy: number): number =>
  (qy < -0.5 ? -0.15 : 0) + (HI && Math.abs(qy) < 0.17 && qx > -0.8 ? 0.08 : 0);

let NEXT_ID = 0;
const nid = () => ++NEXT_ID;

interface FOpt {
  lit?: number;
  id?: number;
  segs?: number;
  /** Изгиб «волной»: середина первой половины уходит на `bend`, второй — обратно (язык пламени). */
  bend?: V3 | null;
  /** Огонь разгорается к кончику: доля пути в степени `apow`. */
  apow?: number;
  tex?: Part['tex'];
  bias?: number;
}

/** Профиль ширины `wid` (доли пути 0…1) в точке `u`. */
function profile(wid: number[], u: number): number {
  const wf = wid.length - 1;
  const wi = Math.min(wf - 1, Math.floor(u * wf));
  return lerp(wid[wi], wid[wi + 1], u * wf - wi);
}

/** Звенья пера по кривой `at(u)`: одно перо — один номер, швов внутри пера нет. */
function chain(
  out: Part[],
  at: (u: number) => V3,
  wid: number[],
  thick: number,
  nrm: V3,
  pal: number,
  along: [number, number],
  op: FOpt,
  segs: number,
): void {
  const id = op.id ?? nid();
  const apow = op.apow ?? 1;
  for (let i = 0; i < segs; i++) {
    const u0 = i / segs;
    const u1 = (i + 1) / segs;
    const p0 = at(u0);
    const p1 = at(u1);
    const d = sub(p1, p0);
    const len = Math.hypot(d[0], d[1], d[2]);
    if (len < 1e-4) continue;
    out.push({
      c: mul(add(p0, p1), 0.5),
      ax: axes(d, nrm),
      r: [len * 0.62 + 0.25, Math.max(0.35, profile(wid, (u0 + u1) / 2)), thick],
      pal,
      id,
      along: [lerp(along[0], along[1], u0 ** apow), lerp(along[0], along[1], u1 ** apow)],
      lit: op.lit ?? 0.7,
      tex: op.tex,
      bias: op.bias,
    });
  }
}

/** Перо-язык: стержень по кривой Безье `a → b → c`, тон вдоль — `along`. */
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
  op: FOpt = {},
): void {
  const bend = op.bend ?? null;
  const at = (u: number): V3 => {
    const q = bezQ(a, b, c, u);
    return bend ? add(q, mul(bend, Math.sin(Math.PI * 2 * u) * 0.5)) : q;
  };
  chain(out, at, wid, thick, nrm, pal, along, op, op.segs ?? 7);
}

/** Точка сплайна Катмулла — Рома через `pts` (u = 0…1 на всю ленту). */
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

/** Лента по точкам (хвост, хохолок): завитки и изгибы, которых не даёт Безье. */
function strand(
  out: Part[],
  pts: V3[],
  wid: number[],
  thick: number,
  nrm: V3,
  pal: number,
  along: [number, number],
  op: FOpt = {},
): void {
  chain(out, (u) => catmull(pts, u), wid, thick, nrm, pal, along, op, op.segs ?? (pts.length - 1) * 3);
}

/** Мерцание пера: своя фаза у каждого, частоты — целые числа кругов за петлю. */
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

const COVERT_W = [1.3, 1.9, 2.1, 1.8, 1.0];
const SEC_W = [1.1, 1.6, 1.8, 1.85, 1.8, 1.5, 0.8];
const PRIM_W = [1.0, 1.5, 1.75, 1.85, 1.85, 1.75, 1.45, 0.9];
const PLUME_W = [0.5, 0.8, 1.2, 1.6, 2.1, 2.3, 1.7, 0.9, 0.45];
const CREST_W = [0.55, 1.1, 1.4, 1.35, 1.1, 0.75, 0.35];
const TONGUE_W = [1.8, 2.8, 3.0, 2.4, 1.5, 0.6, 0.15];

interface Lag {
  headX: number;
  headZ: number;
  thL: number;
  thR: number;
  rootX: number;
  rootZ: number;
  /** Кончики хвоста: пружина медленнее, чем у середины пера. */
  tailX: number;
  tailZ: number;
  footX: number;
}

interface Ctx {
  o: Pose;
  S: Skel;
  h: HeadF;
  /** Запаздывания вторичного движения (уже посчитанные пружиной). */
  lag: Lag;
  tau: number;
}

function wing(out: Part[], c: Ctx, side: -1 | 1): void {
  const { o, S, lag } = c;
  const k = S.k;
  const hug = side < 0 ? o.hugL : o.hugR;
  const th = side < 0 ? o.thL : o.thR;
  const thLag = side < 0 ? lag.thL : lag.thR;
  const fan = side < 0 ? o.fanL : o.fanR;
  const sh = add(side < 0 ? S.shoulderL : S.shoulderR, [
    -side * hug * 2.2 * k,
    hug * 6 * k,
    -hug * 1.5 * k,
  ]);
  // Рука: во фронтальной плоскости (чуть вперёд), при обхвате — к груди.
  const HUG = norm([-side * 0.55, 1, -0.35]);
  const arm = (a: number): V3 =>
    norm(lerp3(norm(add(rollY(dirFront(a, side), o.lean), [0, 0.22, 0])), HUG, hug));
  const A = arm(th);
  const AL = arm(thLag);
  // Плоскость крыла смотрит на зрителя; D — к задней кромке (вниз у раскрытого).
  const N0 = norm([side * 0.22 * (1 - hug), 1, 0.15]);
  const D = norm(mul(cross(A, N0), -side));
  const DL = norm(mul(cross(AL, N0), -side));
  // Сложенное крыло — перья вдоль руки; раскрытое — веером вниз и наружу.
  const open = clamp01((th - 0.3) / 0.9) * (1 - hug * 0.5);
  const fdir = (phi: number, lagged = false): V3 =>
    norm(add(mul(lagged ? DL : D, Math.cos(phi)), mul(lagged ? AL : A, Math.sin(phi))));
  const LA = 8.4;
  const onArm = (u: number, depth: number): V3 =>
    add(add(sh, mul(A, u * LA * k)), mul(N0, depth * k));
  // На малой полосе перьев меньше, и они шире.
  const wk = HI ? 1 : 1.2;
  const sc = scales2(2, 4, 0.1);
  // Перья ряда лежат черепицей: каждое следующее — глубже на шов (вдоль
  // взгляда, на кадре не сдвигается), и по кромке ближнего ложится тень.
  const back = (d: number): V3 => mul(VIEW, -d);
  // Рука и малые кроющие: багровая дуга в чешуйках от плеча к запястью.
  out.push({
    c: onArm(0.48, 1.4),
    ax: axes(A, N0),
    r: [(LA * 0.56 + 1.7) * k, 2.5 * k, 1.8 * k],
    pal: P_BODY,
    id: nid(),
    bias: 0.04,
    tex: HI ? (qx, qy) => sc(side < 0 ? -qy : qy, qx) : undefined,
  });
  // Большие кроющие: ряд золотых перьев под рукой.
  const nC = HI ? 7 : 4;
  for (let j = 0; j < nC; j++) {
    const q = j / (nC - 1);
    const u = 0.1 + q * 0.9;
    const phi = lerp(1.42, (0.05 + 0.3 * q) * fan, open);
    const root = add(add(onArm(u, 0.4), mul(D, 1.3 * k)), back(-1.5 + j * 1.7));
    const L = (3.6 + q * 1.4) * k;
    const d = fdir(phi);
    feather(
      out,
      root,
      add(root, mul(d, L * 0.5)),
      add(root, mul(d, L)),
      COVERT_W.map((w) => w * k * wk),
      0.6 * k,
      N0,
      P_BELLY,
      [0.36, 0.86],
      { lit: 0.9, tex: featherTex, segs: 4 },
    );
  }
  // Второстепенные: огненные, висят от руки вниз; кончики отстают пружиной.
  const nS = HI ? 6 : 3;
  for (let j = 0; j < nS; j++) {
    const q = j / (nS - 1);
    const u = 0.05 + q * 0.6;
    const phi = lerp(1.42, 0.16 * q * fan, open);
    const root = add(add(onArm(u, -0.9 - q * 0.2), mul(D, 1.7 * k)), back(2.5 + j * 1.7));
    const fl = 1 + 0.06 * (o.fire - 1) + 0.04 * o.fire * flick(c.tau, 20 + j + side * 10);
    const L = (7 + q * 0.8) * k * fl;
    const mid = add(root, mul(fdir(phi), L * 0.55));
    const tip = add(mid, mul(fdir(phi * 1.05, true), L * 0.48));
    feather(
      out,
      root,
      mid,
      tip,
      SEC_W.map((w) => w * k * wk),
      0.7 * k,
      N0,
      P_FIRE,
      [0.08, Math.min(0.66, 0.5 + 0.08 * o.fire)],
      { lit: 0.75, tex: featherTex, apow: 1.3 },
    );
  }
  // Маховые: веер от запястья — внутренние вниз, внешние длиннее и наружу.
  const nP = HI ? 7 : 4;
  for (let j = 0; j < nP; j++) {
    const q = j / (nP - 1);
    const u = 0.68 + q * 0.34;
    const phi = lerp(1.45, (0.32 + q * 0.95) * fan, open);
    const root = add(add(onArm(u, -2.3 - q * 0.3), mul(D, 0.5 * k)), back(3.5 + (nS + j) * 1.7));
    const fl = 1 + 0.08 * (o.fire - 1) + 0.05 * o.fire * flick(c.tau, 40 + j + side * 10);
    const L = (9.2 + q * 4.2) * k * fl;
    const d = fdir(phi);
    const mid = add(root, mul(d, L * 0.55));
    const tip = add(mid, mul(fdir(phi + 0.06, true), L * 0.5));
    const perp = norm(cross(d, N0));
    const wave = (j % 2 ? 1 : -1) * (0.45 + 0.3 * flick(c.tau, 160 + j + side * 7)) * k;
    feather(
      out,
      root,
      mid,
      tip,
      PRIM_W.map((w) => w * k * wk),
      0.7 * k,
      N0,
      P_FIRE,
      [0.2 + q * 0.05, Math.min(0.97, 0.8 + 0.1 * o.fire)],
      { lit: 0.8, tex: featherTex, apow: 1.5, bend: mul(perp, wave), segs: 8 },
    );
  }
}

/** Хвост: перья-ленты от крестца (для правой стороны; левая — зеркально), в единицах модели. */
const PLUMES: { p: V3[]; w: number }[] = [
  // Внешние: за лапами вниз до земли и завитком наружу-вверх.
  {
    p: [
      [1.0, -1.5, 0.2],
      [4.5, -4.5, -3.5],
      [8.5, -6, -7],
      [12.5, -6.2, -8],
      [16.5, -6, -6.6],
      [18, -5.6, -3.4],
      [16.4, -5.2, -1.6],
      [14.6, -5, -2.8],
    ],
    w: 1,
  },
  // Внутренние: короче, ближе к лапам.
  {
    p: [
      [0.5, -1.8, -0.6],
      [2.6, -5, -4.8],
      [5, -6.6, -7.8],
      [8, -6.8, -8.4],
      [10.6, -6.4, -7],
      [11.4, -6, -4.8],
      [10, -5.6, -3.6],
      [8.8, -5.4, -4.6],
    ],
    w: 0.82,
  },
];

function tail(out: Part[], c: Ctx): void {
  const { o, S, lag } = c;
  const k = S.k;
  // Четыре ленты стекают в стороны и вниз до земли и завиваются кверху.
  // Вторичное движение в два звена: середина отстаёт одной пружиной, кончик —
  // второй, медленнее; по ленте бежит волна (целое число кругов за петлю).
  const b = S.body;
  const midX = (lag.rootX - b[0]) * 0.8;
  const midZ = (lag.rootZ - b[2]) * 0.8;
  const tipX = (lag.tailX - b[0]) * 1.25;
  const tipZ = (lag.tailZ - b[2]) * 1.25;
  const fan = 1 + o.tailFan * 0.22;
  const up = o.tailUp;
  const nw = Math.max(1, Math.round((4 * PER) / FLICK_T));
  for (const side of [-1, 1] as const) {
    for (let j = 0; j < PLUMES.length; j++) {
      const { p, w } = PLUMES[j];
      const seed = j * 2 + (side > 0 ? 1 : 0);
      const n = p.length;
      const fl = 1 + 0.06 * (o.fire - 1) + 0.04 * o.fire * flick(c.tau, 40 + seed);
      const pts = p.map((q, i): V3 => {
        const u = i / (n - 1);
        const ph = (2 * Math.PI * nw * c.tau) / PER - u * 3.2 + seed * 1.7;
        const wv = Math.sin(ph) * 0.9 * u * u;
        const rel: V3 = [
          side * (q[0] * fan * fl + Math.cos(ph) * 0.35 * u),
          q[1],
          q[2] + up * 6 * u * u + wv,
        ];
        const lw = 1 + (PLUMES.length - 1 - j) * 0.12;
        const lx = lerp(midX, tipX, u) * u * lw;
        const lz = lerp(midZ, tipZ, u) * u * lw;
        return add(add(S.rump, mul(rel, k)), [lx, 0, lz]);
      });
      strand(
        out,
        pts,
        PLUME_W.map((x) => x * k * w),
        0.8 * k,
        [0, 1, 0.25],
        P_FIRE,
        [0.12 + j * 0.04, Math.min(1, 0.84 + 0.1 * o.fire)],
        { lit: 0.6, segs: HI ? 26 : 16, apow: 1.2, tex: featherTex },
      );
      // «Глазок» на конце ленты: багровая середина в золотом кольце.
      const eu = 0.7;
      const ec = catmull(pts, eu);
      const et = sub(catmull(pts, eu + 0.04), catmull(pts, eu - 0.04));
      out.push({
        c: add(ec, [0, 0.9 * k, 0]),
        ax: axes(et, [0, 1, 0.25]),
        r: [2.1 * k * w, 1.75 * k * w, 0.5 * k],
        pal: P_FIRE,
        id: nid(),
        noSeam: true,
        tex: (qx, qy) => {
          const rho = Math.hypot(qx, qy);
          return rho < 0.42 ? -0.62 : rho < 0.74 ? 0.12 : -0.2;
        },
      });
      // Языки пламени срываются с ленты вверх.
      for (const lu of HI ? [0.3, 0.5] : [0.42]) {
        const base = add(catmull(pts, lu), [0, 0.4 * k, 0.6 * k]);
        const f2 = flick(c.tau, 300 + seed * 3 + lu * 10);
        const L = (2.6 + 1.1 * f2) * k * o.fire;
        const dir = norm([side * (0.45 + 0.2 * f2), 0.1, 1]);
        feather(
          out,
          base,
          add(base, mul(dir, L * 0.5)),
          add(base, add(mul(dir, L), [side * f2 * 0.6 * k, 0, 0])),
          TONGUE_W.map((x) => x * 0.42 * k),
          0.6 * k,
          [0, 1, 0],
          P_FIRE,
          [0.5, 1],
          { lit: 0.3, segs: 5 },
        );
      }
    }
  }
}

const CREST: [number, number, number, number, number][] = [
  // основание по x, наклон наружу, длина, завиток (−1 — влево, +1 — вправо), ширина
  [0, 0.08, 10.2, 1, 0.95],
  [-1.5, -0.45, 8, -1, 0.85],
  [1.5, 0.45, 8, 1, 0.85],
  [-2.7, -1.0, 4.4, -1, 0.65],
  [2.7, 1.0, 4.4, 1, 0.65],
];

function crest(out: Part[], c: Ctx): void {
  const { o, S, lag, h } = c;
  const k = h.k;
  // Хохолок отстаёт от головы: ведущая — голова, кончики — пружина.
  const dx = (lag.headX - S.head[0]) * 0.8;
  const dz = (lag.headZ - S.head[2]) * 0.6;
  const up = o.crest;
  const back = up < 0 ? -up : 0;
  // На малой — три ленты: пять сливались в метёлку.
  for (let j = 0; j < (HI ? CREST.length : 3); j++) {
    const [bx, ang0, len0, curl, wk] = CREST[j];
    const ang = ang0 * (1 + up * 0.3);
    const fl = 1 + 0.08 * (o.fire - 1) + 0.07 * o.fire * flick(c.tau, 60 + j);
    const L = len0 * (1 + up * 0.18) * fl * (up < 0 ? 1 + up * 0.3 : 1);
    // В координатах головы: вверх и наружу, опущенный — назад; завиток — вбок.
    const d = norm([Math.sin(ang), -0.3 - back * 1.3, Math.cos(ang) * (1 - back * 0.5)]);
    const sd: V3 = [Math.cos(ang) * curl, 0, -Math.sin(ang) * curl];
    const base: V3 = [bx, -1.0, 3.7 - Math.abs(bx) * 0.3];
    const sway = flick(c.tau, 80 + j) * 0.05;
    const P = (al: number, ac: number): V3 =>
      add(add(base, mul(d, al * L)), mul(sd, (ac + sway * al) * L));
    const loc = [P(0, 0), P(0.34, -0.04), P(0.66, 0.0), P(0.88, 0.12), P(0.94, 0.28), P(0.82, 0.36)];
    const pts = loc.map((q, i) => add(h.at(q), mul([dx, 0, dz], (i / (loc.length - 1)) ** 1.5)));
    strand(
      out,
      pts,
      CREST_W.map((w) => w * k * wk),
      0.75 * k,
      h.dir([0, 1, 0.3]),
      P_FIRE,
      [0.38, Math.min(1, 0.92 + 0.08 * o.fire)],
      { lit: 0.6, segs: HI ? 15 : 10, apow: 1.2, tex: featherTex },
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
    // Цевка в поперечных щитках.
    out.push({
      c: mul(add(hip, foot), 0.5),
      ax: axes(d, [0, 1, 0]),
      r: [Math.hypot(d[0], d[1], d[2]) * 0.5 + 0.4, 1.05 * k, 1.05 * k],
      pal: P_GOLD,
      id,
      bias: -0.1,
      tex: (qx) => (Math.floor((qx + 1) * (HI ? 3 : 1.6)) & 1 ? -0.12 : 0),
    });
    // Пальцы: три вперёд, один назад; когти — тёмный рог, загнуты вниз.
    for (const a of [-0.62, 0, 0.62]) {
      const dir = norm([Math.sin(a) + side * 0.12, Math.cos(a), -0.12]);
      out.push({
        c: add(foot, mul(dir, 1.5 * k)),
        ax: axes(dir, [0, 0, 1]),
        r: [1.6 * k, 0.65 * k, 0.6 * k],
        pal: P_GOLD,
        id,
        bias: -0.04,
      });
      out.push({
        c: add(add(foot, mul(dir, 3.0 * k)), [0, 0, -0.25 * k]),
        ax: axes(norm(add(dir, [0, 0, -0.9])), [0, 1, 0]),
        r: [0.8 * k, 0.45 * k, 0.45 * k],
        pal: P_HORN,
        id: nid(),
        bias: 0.1,
        noSeam: true,
      });
    }
    const bd = norm([side * 0.35, -1, -0.1]);
    out.push({
      c: add(foot, mul(bd, 1.2 * k)),
      ax: axes(bd, [0, 0, 1]),
      r: [1.2 * k, 0.6 * k, 0.55 * k],
      pal: P_GOLD,
      id,
      bias: -0.1,
    });
    if (side < 0) {
      // Браслет сломанных кандалов и обрывок цепи — отстаёт пружиной.
      const cuff = lerp3(hip, foot, 0.5);
      out.push({ c: cuff, ax: AX0, r: [1.9 * k, 1.9 * k, 0.9 * k], pal: P_IRON, id: nid() });
      const sw = (lag.footX - foot[0]) * 0.8;
      let p = add(cuff, [-1.5 * k, 1.3 * k, -0.4 * k]);
      for (let i = 0; i < 2; i++) {
        const q = add(p, [(-1.2 + sw * 0.6) * k, 0.3 * k, -0.85 * k]);
        out.push({
          c: mul(add(p, q), 0.5),
          ax: axes(sub(q, p), i ? [1, 0, 0] : [0, 1, 0]),
          r: [0.95 * k, 0.5 * k, 0.42 * k],
          pal: P_IRON,
          id: nid(),
          bias: 0.08,
        });
        p = q;
      }
    }
  }
}

function body(out: Part[], c: Ctx): void {
  const { o, S, h } = c;
  const k = S.k;
  const sq = o.sq;
  const fl = o.fluff;
  const ax = axes(rollY([1, 0, 0], o.lean), pitchX([0, 0, 1], o.bow * 0.5));
  // Туловище орла: узкое, вытянутое; на крупной — перья чешуйками.
  out.push({
    c: S.body,
    ax,
    r: [
      (6.2 + fl) * (1 + sq * 0.55) * k,
      (5.8 + fl * 0.8) * (1 + sq * 0.4) * k,
      (10 + fl * 0.4) * (1 - sq) * k,
    ],
    pal: P_BODY,
    id: nid(),
    tex: HI ? scallop(8, 4.4, 0.07) : undefined,
  });
  // Грудь: золотые чешуйки рядами, нижние темнее.
  out.push({
    c: S.chest,
    ax,
    r: [(4.2 + fl * 0.8) * (1 + sq * 0.5) * k, (3.4 + fl * 0.4) * k, (7.8 + fl * 0.3) * (1 - sq) * k],
    pal: P_BELLY,
    id: nid(),
    tex: HI ? scallop(7, 4.6, 0.14, 0.95) : scallop(3, 2.4, 0.15, 0.95),
    bias: -0.05,
  });
  // Бёдра в перьях — «штаны» орла.
  for (const side of [-1, 1]) {
    out.push({
      c: S.up([side * 3.0, 1.3, 7.0]),
      ax,
      r: [(2.8 + fl * 0.5) * k, (2.7 + fl * 0.4) * k, 3.6 * (1 - sq) * k],
      pal: P_BODY,
      id: nid(),
      bias: -0.03,
      tex: HI ? scallop(3, 2.2, 0.1) : undefined,
    });
  }
  // Шея: длинная, несёт голову; горло — золотой полосой от груди к клюву.
  const hb = h.at([0, -0.4, -3.2]);
  const nl = S.up([0, 1.2, 22.6]);
  const nd = sub(hb, nl);
  const len = Math.hypot(nd[0], nd[1], nd[2]);
  const nax = axes(nd, [0, 1, 0]);
  const nsc = scales2(4, 3, 0.08);
  out.push({
    c: mul(add(nl, hb), 0.5),
    ax: nax,
    r: [len * 0.5 + 1.8 * k, 3.9 * k, 3.8 * k],
    pal: P_BODY,
    id: nid(),
    tex: HI ? (qx, qy) => nsc(-qx, qy) : undefined,
  });
  const tsc = scales2(5, 2.5, 0.12);
  out.push({
    c: add(mul(add(nl, hb), 0.5), mul(nax[2], 2.3 * k)),
    ax: nax,
    r: [len * 0.5 + 1.2 * k, 2.4 * k, 1.8 * k],
    pal: P_BELLY,
    id: nid(),
    bias: -0.02,
    tex: HI ? (qx, qy) => tsc(-qx, qy) : undefined,
  });
}

function head(out: Part[], c: Ctx): void {
  const { o, h } = c;
  const k = h.k;
  const ex = h.dir([1, 0, 0]);
  const ey = h.dir([0, 1, 0]);
  const ez = h.dir([0, 0, 1]);
  // Голова орла: небольшая, вытянута вперёд.
  out.push({
    c: h.at([0, 0, 0]),
    ax: axes(ex, ez),
    r: [4.3 * k, 4.8 * k, 4.2 * k],
    pal: P_BODY,
    id: nid(),
    bias: -0.02,
    tex: HI ? scallop(5, 4, 0.06) : undefined,
  });
  // Щёки и горло — золото груди поднимается до клюва.
  out.push({
    c: h.at([0, 2.2, -2.4]),
    ax: axes(ex, ez),
    r: [3.0 * k, 2.6 * k, 2.3 * k],
    pal: P_BELLY,
    id: nid(),
    bias: -0.04,
  });
  // Надбровья: строгий взгляд; во гневе сведены круче.
  const slant = o.eye === 'angry' ? 0.65 : 0.35;
  for (const side of [-1, 1]) {
    out.push({
      c: h.at([side * 2.1, 3.6, 1.8]),
      ax: axes(h.dir(norm([1, 0, side * slant])), ey),
      r: [2.0 * k, 0.8 * k, 1.0 * k],
      pal: P_BODY,
      id: nid(),
      bias: -0.18,
      noSeam: true,
    });
  }
  // Клюв: восковица светлее, гребень с бликом, крюк темнее.
  const bid = nid();
  const ridge = (_qx: number, qy: number, qz: number) => (qz > 0.55 && Math.abs(qy) < 0.45 ? 0.16 : 0);
  out.push({
    c: h.at([0, 4.1, -0.6]),
    ax: axes(h.dir(norm([0, 1, -0.15])), ez),
    r: [1.5 * k, 1.5 * k, 1.3 * k],
    pal: P_GOLD,
    id: bid,
    bias: -0.04,
    tex: ridge,
  });
  out.push({
    c: h.at([0, 5.6, -1.25]),
    ax: axes(h.dir(norm([0, 1, -0.35])), ez),
    r: [1.9 * k, 1.25 * k, 1.1 * k],
    pal: P_GOLD,
    id: bid,
    tex: ridge,
  });
  out.push({
    c: h.at([0, 6.6, -2.6]),
    ax: axes(h.dir(norm([0, 0.3, -1])), ey),
    r: [1.5 * k, 0.85 * k, 0.8 * k],
    pal: P_GOLD,
    id: bid,
    bias: -0.3,
  });
  if (o.beak > 0.05) {
    out.push({
      c: h.at([0, 4.6, -2.6 - o.beak * 0.9]),
      ax: axes(h.dir(norm([0, 1, -0.3 - o.beak * 0.5])), ez),
      r: [1.5 * k, 1.05 * k, 0.7 * k],
      pal: P_GOLD,
      id: nid(),
      bias: -0.12,
    });
  }
}

/** Языки пламени: обнимают тело, тянутся вверх, мерцают. `z0` — высота основания. */
function tongues(
  out: Part[],
  c: Ctx,
  amt: number,
  cx: number,
  top: number,
  wide: number,
  z0 = 0,
): void {
  if (amt <= 0.01) return;
  // Два ряда: задний выше и шире (силуэт пламени), передний ниже.
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
      const base: V3 = [cx + u * wide * wk, y, z0 + 1.5 + (0.5 - Math.abs(u)) * 3];
      const ht = top * hk * amt * (1 - Math.abs(u) * 0.8) * (1 + 0.14 * fl);
      const tip: V3 = add(base, [u * wide * 0.25 + fl * 1.6, 0, ht]);
      const mid: V3 = add(base, [u * wide * 0.3 - fl * 0.9, 0, ht * 0.5]);
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
        { lit: 0.25 },
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Огонь трюка: кромка, уголь, силуэт.
// ---------------------------------------------------------------------------

/** Палитры кадра: силуэт из пепла темнеет, во вспышке всё светится огнём. */
function palsFor(o: Pose): RGBA[][] {
  if (o.sil <= 0 && o.flash <= 0) return PALS;
  return PALS.map((r, pl) =>
    r.map((col, i) => {
      const u = i / (r.length - 1);
      let cc = col;
      if (o.sil > 0 && pl !== P_ASH && pl !== P_EMBER)
        cc = mixc(cc, SIL[Math.round(u * (SIL.length - 1))], o.sil);
      if (o.flash > 0) cc = mixc(cc, FIRE[Math.min(7, 5 + Math.round(u * 2))], o.flash * 0.85);
      return cc;
    }),
  );
}

/** Кромка огня на строке `yLine`: ниже — уголь с тлеющими трещинами (остывают книзу), на кромке — огонь, над ней — накал. */
function burnFront(f: Frame, yLine: number, tau: number): void {
  const { w, h, pal, tone } = f;
  const band = 1.5 * RR;
  const step = Math.floor(tau * 12);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const pl = pal[i];
      if (pl < 0) continue;
      const N = PALS[pl].length;
      const cx = x / RR;
      const cy = y / RR;
      const yl =
        yLine +
        Math.sin(cx * 0.8 + tau * 9) * 1.2 * RR +
        (hash(Math.floor(cx), step, 3) - 0.5) * 1.6 * RR;
      const d = y - yl;
      if (d > band) {
        const glow = clamp01(1 - (d - band) / (16 * RR));
        const v = Math.abs(Math.sin(cx * 0.9 + Math.sin(cy * 0.55) * 2.2) + Math.sin(cy * 1.05 - cx * 0.35));
        if (v < 0.3 && glow > 0.08) {
          pal[i] = P_EMBER;
          tone[i] = Math.min(5, 1 + Math.round(glow * 4.4));
        } else {
          pal[i] = P_CHAR;
          tone[i] = Math.min(4, Math.round((tone[i] / (N - 1)) * 3 + glow * 1.2));
        }
      } else if (d > -band) {
        pal[i] = P_FIRE;
        tone[i] = 5 + Math.floor(hash(x, y, step) * 3);
      } else if (d > -band * 3) {
        tone[i] = Math.min(N - 1, tone[i] + 1);
      }
    }
}

/** Крапины огня на силуэте: мерцают ячейками в пиксель малой полосы. */
function speckles(p: Px, f: Frame, amt: number, tau: number): void {
  const step = Math.floor(tau * 12);
  for (let y = 0; y < f.h; y++)
    for (let x = 0; x < f.w; x++) {
      const pl = f.pal[y * f.w + x];
      if (pl < 0 || pl === P_ASH || pl === P_EMBER) continue;
      const hv = hash(Math.floor(x / RR), Math.floor(y / RR), step);
      if (hv < amt * 0.16) p.set(x, y, FIRE[hv < amt * 0.05 ? 7 : 5]);
    }
}

/** Мягкие переходы тона на крупной: редкая шахматка на границе ступеней тела и груди. */
function softBands(f: Frame): void {
  const { w, h, pal, tone, idb } = f;
  const hit: number[] = [];
  for (let y = 0; y < h - 1; y++)
    for (let x = 0; x < w - 1; x++) {
      const i = y * w + x;
      const pl = pal[i];
      if (pl !== P_BODY && pl !== P_BELLY) continue;
      for (const j of [i + w, i + 1]) {
        if (pal[j] === pl && idb[j] === idb[i] && tone[j] === tone[i] - 1 && dith(x, y, 0.28))
          hit.push(j, tone[i]);
      }
    }
  for (let n = 0; n < hit.length; n += 2) tone[hit[n]] = hit[n + 1];
}

// ---------------------------------------------------------------------------
// Глаза.
// ---------------------------------------------------------------------------

const EYE_PAL_S: Record<string, RGBA> = { K: INK, W: WHITE, o: GOLD[3] };
const EYES_S: Record<string, string[]> = {
  // Малая: бусина 2×2 с бликом, золото — с наружной стороны (голова в 9 пикселей).
  open: ['oKW', 'oKK'],
  half: ['...', 'oKK'],
  shut: ['...', 'KKK'],
  happy: ['.K.', 'K.K'],
  sleep: ['...', 'KKK'],
  angry: ['...', 'oKW'],
};
const EYE_PAL_L: Record<string, RGBA> = {
  K: INK,
  W: WHITE,
  o: hx('#2a0814'),
  a: GOLD[4],
  b: GOLD[2],
};
const EYES_L: Record<string, string[]> = {
  // Крупная: тёмное кольцо, золотая радужка, зрачок, блик.
  // Верх века прямой — взгляд строгий, а не круглый «совиный».
  open: ['ooooo', 'oaKWo', 'obKKo', '.ooo.'],
  half: ['.....', 'ooooo', 'obKKo', '.ooo.'],
  shut: ['.....', '.....', 'ooooo', '.....'],
  happy: ['.....', '.ooo.', 'o...o', '.....'],
  sleep: ['.....', '.....', 'o...o', '.ooo.'],
  angry: ['.....', 'ooooo', 'oaKWo', '.ooo.'],
};

function eyes(p: Px, f: Frame, c: Ctx, glow: boolean): void {
  const { o, h } = c;
  if (o.scale < 0.5) return;
  for (const side of [-1, 1] as const) {
    const at = seen(f, mul(h.at([side * 2.5, 3.85, 0.7]), RR), OX, OY, 2.2 * RR);
    if (!at) continue;
    if (glow) {
      // Силуэт из пепла смотрит угольками.
      p.set(at[0], at[1], FIRE[6]);
      if (HI) p.set(at[0] + (side < 0 ? 1 : -1), at[1], FIRE[5]);
      continue;
    }
    let key: string = o.eye;
    if (key === 'open' || key === 'angry') {
      if (o.blink > 0.75) key = 'shut';
      else if (o.blink > 0.3) key = 'half';
    }
    const flip = side > 0;
    if (HI) {
      const x0 = at[0] - 2;
      const y0 = at[1] - 2;
      stamp(p, EYES_L[key], EYE_PAL_L, x0, y0, flip);
      // Разрез клюва уходит под глаз тёмной чертой.
      const g = seen(f, mul(h.at([side * 1.7, 4.1, -1.5]), RR), OX, OY, 2 * RR);
      if (g) {
        p.set(g[0], g[1], GOLD[0]);
        p.set(g[0] + side, g[1] - 1, GOLD[1]);
      }
      // Золотой штрих от наружного уголка вниз (как у сокола).
      if (key !== 'sleep' && key !== 'happy' && key !== 'shut') {
        const sx = flip ? x0 + 5 : x0 - 1;
        const dx = flip ? 1 : -1;
        p.set(sx, y0 + 3, GOLD[4]);
        p.set(sx, y0 + 4, GOLD[3]);
        p.set(sx + dx, y0 + 5, GOLD[3]);
      }
    } else {
      const x0 = at[0] - (flip ? 0 : 2);
      const y0 = at[1] - 1;
      stamp(p, EYES_S[key], EYE_PAL_S, x0, y0, flip);
      if (key !== 'sleep' && key !== 'happy' && key !== 'shut')
        p.set(flip ? x0 + 2 : x0, y0 + 2, GOLD[3]);
    }
  }
  // Ноздри на восковице — только на крупной.
  if (HI)
    for (const side of [-1, 1]) {
      const at = seen(f, mul(h.at([side * 0.7, 5.3, 0.25]), RR), OX, OY, 1.6 * RR);
      if (at) p.set(at[0], at[1], GOLD[1]);
    }
}

// ---------------------------------------------------------------------------
// Искры и пепел.
// ---------------------------------------------------------------------------

/** Угольки: рождаются по расписанию петли, летят вверх, гаснут ступенями огня; на крупной молодые — звёздочкой. */
function sparks(
  p: Px,
  c: Ctx,
  n: number,
  life: number,
  origin: (j: number) => V3,
  rise = 9,
): void {
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
    p.set(x, y, FIRE[Math.max(2, Math.round(7 - u * 5))]);
    if (HI && u < 0.5) {
      const arm = FIRE[Math.max(2, Math.round(5 - u * 5))];
      p.set(x - 1, y, arm);
      p.set(x + 1, y, arm);
      p.set(x, y - 1, arm);
      p.set(x, y + 1, arm);
    }
  }
}

// ---------------------------------------------------------------------------
// Кадр.
// ---------------------------------------------------------------------------

/** Пружины вторичного движения: от начала анимации (разовой) или на две петли назад. */
export function lagOf(a: Anim, t: number): Lag {
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
    tailX: lagged((tt) => sk(tt).body[0], 1.5, 0.22),
    tailZ: lagged((tt) => sk(tt).body[2], 1.6, 0.24),
    footX: lagged((tt) => sk(tt).footL[0], 2.6, 0.22),
  };
}

/** Модель → полоса: части в пикселях малой полосы растягиваются на `RR`. */
function toRes(parts: Part[]): Part[] {
  if (RR === 1) return parts;
  return parts.map((pt) => ({ ...pt, c: mul(pt.c, RR), r: mul(pt.r, RR) }));
}

/** Кадр `i` анимации `a` полосы `res` на холсте `RES[res]`. */
export function phoenixFrame(a: Anim, i: number, res: Res = 's'): Px {
  const cv = RES[res];
  RR = cv.box / RES.s.box;
  HI = res === 'l';
  OX = cv.bx + cv.box / 2;
  OY = cv.by + GROUND * RR;
  NEXT_ID = 0;
  const T = dur(a);
  const t = i / FPS;
  const o = poseAt(a, t);
  const S = skel(o);
  // Часы мерцания: у петель — своё время, у разовых — отсчёт к началу покоя
  // (последний кадр мерцает так же, как кадр перед первым кадром покоя).
  PER = a === 'walk' ? T : FLICK_T;
  const tau = LOOP[a] ? t : wrap(t - T, FLICK_T);
  const c: Ctx = { o, S, h: headF(o, S), lag: lagOf(a, t), tau };
  const pals = palsFor(o);
  const f = newFrame(cv.cw, cv.ch);
  const birdOn = o.scale > 0.16;
  if (birdOn) {
    const bird: Part[] = [];
    tail(bird, c);
    legs(bird, c);
    body(bird, c);
    head(bird, c);
    wing(bird, c, -1);
    wing(bird, c, 1);
    crest(bird, c);
    drawParts(f, toRes(bird), pals, OX, OY);
  }
  // Трюк: кромка огня поднимается по птице; языки — на кромке.
  let zF = 0;
  if (birdOn && o.front > 0) {
    let top = 0;
    while (top < f.h - 1 && !f.pal.subarray(top * f.w, (top + 1) * f.w).some((v) => v >= 0)) top++;
    const yLine = lerp(OY + 3 * RR, top - 2 * RR, o.front);
    burnFront(f, yLine, tau);
    zF = (OY - yLine) / (RR * CE);
  }
  const fx: Part[] = [];
  if (o.blaze > 0.01)
    tongues(fx, c, o.blaze, o.x, 8 + 6 * o.blaze, 15 * Math.max(0.5, o.scale), zF - 3);
  if (o.pillar > 0.01) tongues(fx, c, o.pillar, o.x, 30 * Math.min(1.2, o.pillar), 18);
  // `charge` — нарастание жара угля перед вспышкой.
  const charge =
    a === 'work'
      ? kf(t, [
          [1.06, 0],
          [1.33, 1, 'i'],
          [1.38, 0],
        ])
      : 0;
  if (o.ash > 0.01) {
    // Кучка пепла: из неё птица и восстаёт.
    fx.push({
      c: [0, 1.5, 0.4],
      ax: AX0,
      r: [9.5 * o.ash, 7 * o.ash, 1.9 * o.ash],
      pal: P_ASH,
      id: nid(),
      bias: 0.1,
      tex: (qx, qy) => (Math.sin(qx * 9 + qy * 5) > 0.6 ? -0.25 : 0),
    });
  }
  if (o.ember > 0.01) {
    // Уголь живёт: дышит жаром (пульс размера и накала), а перед вспышкой
    // жар нарастает — пульс чаще, уголь раздувается, по нему бегут языки.
    const dt = Math.max(0, t - 1.08);
    const eg = 0.5 + 0.5 * Math.sin(2 * Math.PI * (2.6 * (t - 0.96) + 4.2 * dt * dt));
    const es = o.ember * (1 + 0.08 * eg + 0.32 * charge);
    fx.push({
      c: [0, 2, 3.8 * es],
      ax: AX0,
      r: [7 * es, 5.6 * es, 4.6 * es],
      pal: P_EMBER,
      id: nid(),
      bias: -0.12 + 0.28 * eg + 0.4 * charge,
      tex: (qx, qy, qz) => {
        // Трещины угля светятся.
        const v = Math.abs(Math.sin(qx * 4.1 + qz * 2.3) + Math.sin(qy * 3.7 - qz * 3.1));
        return v < 0.35 + 0.25 * charge ? 0.55 * eg + 0.15 + 0.3 * charge : 0;
      },
    });
    if (o.ember > 0.4) tongues(fx, c, 0.22 + 0.55 * charge, 0, 6 + 10 * charge, 8 + 3 * charge);
  }
  if (fx.length) drawParts(f, toRes(fx), pals, OX, OY);
  seams(f, 1.4 * RR, 1);
  rimLight(f, pals, (pl) => pl !== P_FIRE && pl !== P_EMBER && pl !== P_CHAR);
  if (HI) softBands(f);
  const p = toPx(f, pals);
  selOutline(p, INK, o.front > 0.5 || o.sil > 0.5 || !birdOn ? 0.6 : 0.8);
  if (birdOn && o.front < 0.62 && o.flash < 0.5) eyes(p, f, c, o.sil > 0.5);
  if (birdOn && o.sil > 0.3) speckles(p, f, o.sil * (0.35 + 0.65 * clamp01((t - 1.36) / 0.22)), tau);
  // Угольки: от хохолка и концов хвоста всегда, в трюке — гуще.
  const nsp = a === 'sleep' || a === 'walk' ? 2 : 4;
  if (birdOn && o.front <= 0)
    sparks(p, c, nsp, 0.8, (j) =>
      j % 2
        ? add(S.head, [((j % 3) - 1) * 3, -1, 11 * S.k])
        : add(S.rump, [(j % 4 < 2 ? -1 : 1) * 19 * S.k, -5, 0]),
    );
  if (o.blaze > 0.2) {
    sparks(
      p,
      { ...c, tau: c.tau * 2.0 },
      8,
      0.6,
      (j) => [((j % 5) - 2) * 3.2 + o.x, 1, zF + (j % 3) * 2],
      14,
    );
  }
  if (o.ember > 0.2) {
    // Искры от угля вверх: гуще и выше, пока жар нарастает.
    sparks(
      p,
      { ...c, tau: c.tau * 1.8 },
      7,
      0.55,
      (j) => [((j % 3) - 1) * 2.4, 2, 5 + 4 * o.ember],
      11 + 7 * charge,
    );
  }
  // Пепел осыпается, пока прогоревшая птица оседает.
  if (a === 'work' && t > 0.7 && t < 1.25) {
    for (let j = 0; j < (HI ? 12 : 7); j++) {
      const u = clamp01((t - 0.7 - (j % 7) * 0.04) / 0.5);
      if (u <= 0 || u >= 1) continue;
      const pt: V3 = [
        ((j % 7) - 3) * 3.3 + (j >= 7 ? 1.6 : 0) + Math.sin(u * 6 + j) * 1.5,
        1,
        22 - (j % 7) * 1.5 - u * 16,
      ];
      const [sx, sy] = project(mul(pt, RR));
      const x = Math.floor(OX + sx);
      const y = Math.floor(OY + sy);
      if (dith(x, y, 1 - u * 0.6)) p.set(x, y, PALS[P_ASH][3 - Math.min(3, Math.floor(u * 4))]);
    }
  }
  return p;
}
