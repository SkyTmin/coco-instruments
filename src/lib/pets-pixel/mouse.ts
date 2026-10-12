// Мышь-воришка — пиксельный питомец по эталону боссов 12–14.
//
// Светло-серая мышь стоит на задних лапах и смотрит на нас: голова с
// туловище, ОГРОМНЫЕ круглые уши с розовой чашей (левое в кадре надорвано),
// большие блестящие глаза под хитрым веком, розовый нос, длинные усы, два
// резца; рваная бурая пелерина, завязанная у горла (кокетка на плечах, сзади
// и по бокам — до пояса), верёвочный пояс с узлом, длинный розовый хвост
// завитком справа, лагерный жетон на цепочке в левой лапе.
// Читается на 44 px: два огромных круглых уха, большие глаза, розовый нос,
// бурая пелерина, розовый хвост. С кротом (угольный, каска) и хорьком
// (вытянутый, кепка, пальто) не путается.
//
// Две полосы, у каждой свой рисунок: малая — рамка 48 (шахта, списки),
// крупная — рамка 112 (карточка, вылупление, Питомник): ворс, ободок и чаша
// ушей, глаза с бликом и веком, резцы, усы, заплата и строчка на пелерине,
// витая верёвка, звенья цепочки, кирка на жетоне.
//
// Анимации 24 к/с по ключам (`kf`): подготовка → разгон → пик → проводка →
// возврат. Голова, уши, хвост, пелерина и жетон на цепочке — с запаздыванием
// (`spring`). Трюк: принюхалась → заметила жетон на полу (глаза шире, блик НА
// жетоне) → метнулась вниз и назад, правая лапа берёт жетон (кадр касания) →
// подняла, жетон сверкает → сунула под кокетку пелерины (жетон уходит ЗА её
// край — его закрывает сама ткань) → подмигнула.
//
// Золотой рисуется здесь же (`v` = 1) своими палитрами: мех — золото с
// бронзовой глубиной, уши, нос, лапы и хвост — розовое золото, пелерина —
// тёмная бурая кожа, жетон — медь (на золотом меху латунь тонет).

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

const P_FUR = 0;
const P_PINK = 1;
const P_CREAM = 2;
const P_CAPE = 3;
const P_ROPE = 4;
export const P_BRASS = 5;
const P_MOUTH = 6;
const P_TOOTH = 7;

const MOUTH = ramp('#24070a', '#45111a', '#6e2228', '#9a3c40', '#d06a6a', '#ee8f8a');
const TOOTH = ramp('#6e6658', '#968e7e', '#bcb4a2', '#dad4c6', '#eeeae0', '#f9f7f2', '#ffffff');

export const PAL_V: RGBA[][][] = [
  [
    // Светло-серый мех: тёплая тень → серый → почти белый на свету.
    ramp(
      '#262220',
      '#36312e',
      '#47413d',
      '#5a534e',
      '#6d6660',
      '#817973',
      '#958d86',
      '#a8a199',
      '#bbb4ac',
      '#cdc7bf',
      '#dfdad3',
      '#eeebe6',
    ),
    // Розовая кожа: чаша ушей, нос, лапы, хвост.
    ramp(
      '#56202a',
      '#78303a',
      '#9a454c',
      '#b85c60',
      '#cf7476',
      '#e08c8c',
      '#eca4a0',
      '#f5bcb5',
      '#fbd4cc',
      '#ffece6',
    ),
    // Сливочное брюхо и мордочка.
    ramp(
      '#5c5042',
      '#786a58',
      '#94856e',
      '#ae9e86',
      '#c4b59c',
      '#d6c8b0',
      '#e4d9c4',
      '#efe7d8',
      '#f7f2ea',
      '#fffcf6',
    ),
    // Пелерина: бурое сукно.
    ramp(
      '#170f0a',
      '#22170f',
      '#2f2016',
      '#3d2a1d',
      '#4c3625',
      '#5c432f',
      '#6d513a',
      '#806146',
      '#937254',
      '#a78565',
    ),
    // Верёвка пояса.
    ramp('#3a2c1c', '#56432c', '#755e3c', '#957a4e', '#b29662', '#c9ae7a', '#ddc596', '#eedcb8'),
    // Латунь жетона и цепочки.
    ramp(
      '#38260a',
      '#563c10',
      '#765418',
      '#966c20',
      '#b5862c',
      '#cfa03e',
      '#e2b958',
      '#f0d184',
      '#fae8b8',
    ),
    MOUTH,
    TOOTH,
  ],
  [
    // Золотой мех: бронза в тени → золото → бледное золото на свету.
    ramp(
      '#2a1606',
      '#3c2008',
      '#522c0c',
      '#683a10',
      '#7e4a16',
      '#96601e',
      '#ae7626',
      '#c48e32',
      '#d8a640',
      '#e8bf58',
      '#f4d67c',
      '#fce9a8',
    ),
    // Розовое золото: уши, нос, лапы, хвост читаются на золотом меху.
    ramp(
      '#4a1a12',
      '#6e2a1c',
      '#934028',
      '#b25838',
      '#ca7248',
      '#dc8c5c',
      '#e9a672',
      '#f3c08c',
      '#f9d8b0',
      '#fff0dc',
    ),
    // Брюхо и мордочка — бледное золото.
    ramp(
      '#5a4220',
      '#7a5c2c',
      '#9a783c',
      '#b8944e',
      '#d0ae66',
      '#e2c482',
      '#eed8a2',
      '#f6e8c2',
      '#fcf4e0',
      '#fffcf2',
    ),
    // Пелерина — тёмная бурая кожа.
    ramp(
      '#120a06',
      '#1c120c',
      '#281a12',
      '#352318',
      '#432d1f',
      '#523827',
      '#634531',
      '#75533c',
      '#876248',
      '#9b7457',
    ),
    // Верёвка — тёмная бронза (светлая тонула в золотом брюхе).
    ramp('#2a1a0a', '#3e2810', '#563a18', '#6e4c20', '#86602a', '#9c7436', '#b28a48', '#c6a060'),
    // Жетон — медь.
    ramp(
      '#3a1a08',
      '#5c2a0e',
      '#7e3e16',
      '#a05420',
      '#c06c2c',
      '#d8883e',
      '#eaa656',
      '#f6c47c',
      '#fde2b0',
    ),
    MOUTH,
    TOOTH,
  ],
];
const INK_V: RGBA[] = [hx('#0e0b0b'), hx('#1c0e03')];

// ---------------------------------------------------------------------------
// Кадр: холст и рамка тела у двух полос (как у крота).
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

type Eye = 'open' | 'wide' | 'happy' | 'angry' | 'sleep' | 'shut';

export interface Pose {
  /** Вся мышь: сдвиг, прыжок; присед (тело ниже, ступни стоят). */
  x: number;
  y: number;
  z: number;
  cz: number;
  sq: number;
  /** Крен (+ — вправо), наклон вперёд (+), масштаб броска к зрителю. */
  lean: number;
  bow: number;
  scale: number;
  /** Голова: сдвиг, поворот, кивок (+ — вниз), наклон набок. */
  hx: number;
  hy: number;
  hz: number;
  turn: number;
  nod: number;
  tilt: number;
  /** Рот: 0 — закрыт, 1 — настежь; улыбка; нос нюхает (вверх) и водит вбок; усы. */
  jaw: number;
  grin: number;
  sniff: number;
  wig: number;
  whisk: number;
  /** Глаза: вид, веко (0 — открыты, 1 — закрыты; покой — хитрые 0,35), моргание, подмигивание (правый в кадре), взгляд вбок. */
  eye: Eye;
  lid: number;
  blink: number;
  wink: number;
  look: number;
  /** Вдох: грудь раздувается. */
  chest: number;
  /** Уши: повёрнуты наружу (+), прижаты назад, обвисли (сон). */
  earL: number;
  earR: number;
  earB: number;
  earDrop: number;
  /** Лапы: сдвиг кисти от места покоя (в теле; x — наружу у обеих). */
  aLx: number;
  aLy: number;
  aLz: number;
  aRx: number;
  aRy: number;
  aRz: number;
  /** Правая кисть по цели В МИРЕ (трюк), доля 0…1. */
  wk: number;
  wRx: number;
  wRy: number;
  wRz: number;
  /** Когти выпущены. */
  claw: number;
  /** Ступни: сдвиг и подъём. */
  fLy: number;
  fLz: number;
  fRy: number;
  fRz: number;
  /** Сидит свернувшись (сон); пелерина запахнута. */
  sit: number;
  wrap: number;
  /** Хвост: вбок, вверх, завиток. */
  tailSw: number;
  tailUp: number;
  tailCurl: number;
  /** Жетон трюка: −1 — нет, иначе видимость; 0 — на полу, 1 — в лапе; уходит под пелерину. */
  tok: number;
  tokU: number;
  tuck: number;
  /** Блик на жетоне. */
  glint: number;
  /** Искра подмигивания (0…1 после), −1 — нет. */
  spark: number;
  /** Атака: следы когтей (0…1), −1 — нет. */
  swipe: number;
}

const REST: Pose = {
  x: 0,
  y: 0,
  z: 0,
  cz: 0,
  sq: 0,
  lean: 0,
  bow: 0,
  scale: 1,
  hx: 0,
  hy: 0,
  hz: 0,
  turn: 0,
  nod: 0,
  tilt: 0,
  jaw: 0,
  grin: 0.3,
  sniff: 0,
  wig: 0,
  whisk: 0,
  eye: 'open',
  lid: 0.3,
  blink: 0,
  wink: 0,
  look: 0,
  chest: 0,
  earL: 0,
  earR: 0,
  earB: 0,
  earDrop: 0,
  aLx: 0,
  aLy: 0,
  aLz: 0,
  aRx: 0,
  aRy: 0,
  aRz: 0,
  wk: 0,
  wRx: 0,
  wRy: 0,
  wRz: 0,
  claw: 0,
  fLy: 0,
  fLz: 0,
  fRy: 0,
  fRz: 0,
  sit: 0,
  wrap: 0,
  tailSw: 0,
  tailUp: 0,
  tailCurl: 0.5,
  tok: -1,
  tokU: 0,
  tuck: 0,
  glint: 0,
  spark: -1,
  swipe: -1,
};

const loopK = (t: number, T: number, keys: Key[]) => kf(wrap(t, T), keys);
const pos = (v: number) => Math.max(0, v);
const neg = (v: number) => Math.max(0, -v);
const TAU = Math.PI * 2;
const smooth = (u: number) => u * u * (3 - 2 * u);

/** Разовая к концу переходит в позу начала покоя: стык без сдвига. */
function settle(o: Pose, t: number, T: number, span = 0.24): Pose {
  const k = smooth(clamp01((t - (T - span)) / span));
  if (k <= 0) return o;
  const z = idlePose(0);
  const r = { ...o } as unknown as Record<string, number | string>;
  const zz = z as unknown as Record<string, number | string>;
  for (const key of Object.keys(zz)) {
    const a = r[key];
    const b = zz[key];
    if (typeof a === 'number' && typeof b === 'number') r[key] = lerp(a, b, k);
    else if (k >= 0.5) r[key] = b;
  }
  return r as unknown as Pose;
}

// ---------------------------------------------------------------------------
// Скелет в пикселях малой полосы: x — вправо, y — к зрителю, z — вверх.
// Два плана: стоит и сидит, закутавшись (сон).
// ---------------------------------------------------------------------------

interface Plan {
  hip: V3;
  foot: V3;
  /** Ступня: 0 — на полу, 1 — подошвой вперёд (сидит). */
  sole: number;
  body: V3;
  chest: V3;
  sh: V3;
  paw: V3;
  head: V3;
  tail: V3[];
}
const STAND: Plan = {
  hip: [2.8, 0.4, 3.8],
  foot: [3.0, 2.0, 0],
  sole: 0,
  body: [0, 0, 8.0],
  chest: [0, 0.5, 12.6],
  sh: [5.0, 0.8, 13.2],
  paw: [6.4, 2.6, 6.8],
  head: [0, 1.0, 21.4],
  // Хвост: из-под пелерины сзади справа по полу вбок и завитком вверх.
  tail: [
    [2.4, -4.2, 3.0],
    [6.2, -4.4, 0.9],
    [10.4, -3.4, 0.8],
    [13.4, -1.8, 2.6],
    [14.6, -1.0, 6.6],
    [14.0, -0.6, 10.4],
    [12.0, -0.4, 12.4],
    [10.4, -0.2, 11.4],
  ],
};
const SIT: Plan = {
  hip: [3.2, 1.2, 2.6],
  foot: [3.4, 5.0, 0.5],
  sole: 1,
  body: [0, 0.4, 6.8],
  chest: [0, 1.2, 10.8],
  sh: [4.8, 1.6, 11.2],
  paw: [2.4, 5.6, 8.8],
  head: [0, 3.0, 17.4],
  // Хвост обнимает перед по полу.
  tail: [
    [2.8, -4.2, 2.2],
    [8.0, -2.6, 0.8],
    [10.4, 2.4, 0.8],
    [8.8, 7.2, 0.8],
    [3.6, 9.2, 0.8],
    [-2.2, 9.0, 0.8],
    [-6.6, 6.8, 0.9],
    [-8.4, 3.6, 1.2],
  ],
};
/** Радиусы яйца-брюха и груди, головы. */
const BODY_R: V3 = [6.6, 5.6, 7.2];
const CHEST_R: V3 = [5.0, 4.5, 4.0];
const HEAD_R: V3 = [7.4, 6.6, 6.4];
/** Длины костей руки и ноги. */
const ARM1 = 4.2;
const ARM2 = 4.0;
const LEG1 = 2.4;
const LEG2 = 2.2;
/** Масштаб модели в рамке: ступни — макушки ушей ~40 пикселей малой полосы. */
const G = 1.15;
/** Кончики пальцев от середины ладони (вдоль предплечья). */
const GRIP = 1.5;
/** Кисть в покое (тело). */
const PAW0 = STAND.paw;

// ---------------------------------------------------------------------------
// Дорожки анимаций.
// ---------------------------------------------------------------------------

/** Покой: дышит, уши подёргиваются, нос и усы, хвост качается, моргает, оглядывается. */
function idlePose(t: number): Pose {
  const T = dur('idle');
  const o: Pose = { ...REST };
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
  o.sq = -0.012 * br;
  o.hz = 0.2 * br;
  o.aLz = 0.25 * br;
  o.aRz = 0.25 * br;
  const sw = Math.sin((t / T) * TAU);
  o.x = 0.3 * sw;
  o.lean = 0.025 * sw;
  o.tilt = -0.02 * sw;
  // Оглядывается: глаза первыми, голова следом — влево, вправо, к нам.
  o.look = kf(t, [
    [0, 0],
    [0.86, 0],
    [0.94, -1, 'o'],
    [1.44, -1],
    [1.56, 1, 's'],
    [2.08, 1],
    [2.2, 0, 's'],
    [T, 0],
  ]);
  o.turn = kf(t, [
    [0, 0],
    [0.92, 0],
    [1.12, -0.26, 'o'],
    [1.48, -0.26],
    [1.76, 0.24, 's'],
    [2.1, 0.24],
    [2.42, 0, 's'],
    [T, 0],
  ]);
  o.tilt += 0.05 * Math.sin((t / T) * TAU * 2) * bump(t, 0.9, 2.45);
  // Нюхает: нос вверх трижды, водит вбок, усы дрожат.
  const sn = bump(t, 0.2, 0.78);
  o.sniff = bump(t, 0.24, 0.36) + bump(t, 0.4, 0.52) + 0.7 * bump(t, 0.56, 0.68);
  o.wig = 0.7 * Math.sin((t - 0.2) * TAU * 3.4) * sn;
  o.whisk = Math.sin((t - 0.2) * TAU * 7) * sn;
  o.nod = -0.06 * sn;
  // Уши подёргиваются по очереди (пружина доиграет дрожь).
  o.earR = 0.32 * bump(t, 0.5, 0.62);
  o.earL = 0.32 * bump(t, 2.5, 2.62) + 0.2 * bump(t, 2.66, 2.76);
  // Моргает.
  o.blink = Math.max(bump(t, 0.34, 0.48), bump(t, 2.72, 2.86));
  // Хвост покачивается, кончик завивается.
  o.tailSw = 0.22 * Math.sin((t / T) * TAU + 0.8);
  o.tailCurl = REST.tailCurl + 0.14 * Math.sin((t / T) * TAU * 2);
  return o;
}

/** Ходьба крадучись на цыпочках: частые шажки, лапки у груди, хвост на весу балансирует. */
function walkPose(t: number): Pose {
  const T = dur('walk');
  const o: Pose = { ...REST };
  const h = wrap(t, T);
  const la = bump(h, 0.02, 0.23) + bump(h, 0.52, 0.73);
  const lb = bump(h, 0.27, 0.48) + bump(h, 0.77, 0.98);
  o.fLz = 1.3 * la ** 0.8;
  o.fLy = 0.5 * la;
  o.fRz = 1.3 * lb ** 0.8;
  o.fRy = 0.5 * lb;
  // Вес — на стоящую ногу: тело над ней, с креном к ней.
  const sw = Math.sin((h / T) * TAU * 2);
  o.x = 0.6 * sw;
  o.lean = 0.06 * sw;
  o.cz = 0.9 - 0.3 * Math.abs(Math.cos((h / T) * TAU * 2));
  o.bow = 0.14;
  o.nod = -0.1;
  o.tilt = -0.04 * sw;
  // Оглядывается на ходу.
  o.turn = 0.16 * Math.sin((h / T) * TAU);
  o.look = Math.sin((h / T) * TAU);
  o.lid = 0.5;
  // Лапки подняты перед грудью и подпрыгивают в такт.
  const bob = 0.3 * Math.cos((h / T) * TAU * 2);
  o.aRx = -2.6;
  o.aRy = 3.0;
  o.aRz = 4.4 + bob;
  o.aLx = -2.6;
  o.aLy = 3.0;
  o.aLz = 4.4 - bob;
  o.tailUp = 0.8;
  o.tailSw = -0.5 * sw;
  o.tailCurl = REST.tailCurl + 0.1 * Math.cos((h / T) * TAU);
  o.chest = 0.2;
  o.whisk = 0.6 * Math.sin((h / T) * TAU * 3);
  return o;
}

/** Радость: два подскока, уши хлопают, глаза «^», хихикает в лапку. */
function happyPose(t: number): Pose {
  const T = dur('happy');
  const o: Pose = { ...REST };
  const rise = kf(t, [
    [0, 0],
    [0.1, -0.35, 'o'],
    [0.26, 1, 'o'],
    [0.36, 0.92],
    [0.48, -0.3, 'i'],
    [0.58, 0.6, 'o'],
    [0.66, 0.55],
    [0.78, -0.15, 'i'],
    [0.9, 0, 'o'],
    [T, 0],
  ]);
  const up = pos(rise);
  const env = 1 - clamp01((t - 0.86) / (T - 0.86));
  o.z = 2.6 * up;
  o.cz = 1.0 * neg(rise);
  o.sq = 0.08 * neg(rise) - 0.025 * up;
  o.fLz = 0.7 * up;
  o.fRz = 0.7 * up;
  // Уши хлопают: вразлёт и обратно (пружина добавит).
  o.earL = o.earR = 0.3 * Math.sin(t * TAU * 4.2) * env;
  // Лапы: вверх буквой V на первом прыжке, потом правая — ко рту (хихикает).
  const cheer = kf(t, [
    [0, 0],
    [0.14, 1, 'o'],
    [0.38, 1],
    [0.52, 0, 's'],
  ]);
  const gig = kf(t, [
    [0, 0],
    [0.44, 0],
    [0.58, 1, 'o'],
    [0.86, 1],
    [1.02, 0, 's'],
  ]);
  o.aLx = 1.8 * cheer;
  o.aLy = 1.6 * cheer;
  o.aLz = 7.6 * cheer;
  o.aRx = 1.8 * cheer + (2.0 - PAW0[0]) * gig;
  o.aRy = 1.6 * cheer + (7.2 - PAW0[1]) * gig;
  o.aRz = 7.6 * cheer + (14.6 - PAW0[2]) * gig;
  // Хихикает: плечи трясутся.
  const shake = Math.sin(t * TAU * 12) * bump(t, 0.56, 0.98);
  o.x = 0.3 * shake;
  o.chest = 0.5 * env + 0.3 * Math.abs(shake);
  o.tilt = 0.08 * Math.sin((t / T) * TAU) * env;
  o.nod = -0.1 * up + 0.08 * gig;
  o.eye = t < 0.94 ? 'happy' : 'open';
  o.grin = lerp(REST.grin, 1, env);
  o.jaw = 0.3 * cheer;
  o.tailUp = 0.8 * env;
  o.tailSw = 0.4 * Math.sin(t * TAU * 2.5) * env;
  o.whisk = 0.8 * Math.sin(t * TAU * 5) * env;
  return settle(o, t, T, 0.2);
}

/**
 * Трюк (2 с): нюхает → заметила жетон на полу перед ступнями (глаза шире,
 * блик на жетоне) → прищурилась, присела → бросок вниз: поклон, присед и крен
 * вправо, правая кисть по цели в мире — пальцы на жетоне (`GRAB`) → назад
 * вверх с жетоном → подняла над плечом, жетон сверкает → лапа к краю кокетки
 * пелерины и вверх под неё: жетон уходит ЗА край (его закрывает ткань,
 * буфер глубины) → подмигнула, искра → лапа на место.
 */
export const SPOT = 0.4;
export const GRAB = 20 / FPS;
const LIFT = 1.0;
const HIGH = 1.08;
const EDGE = 1.44;
export const TUCKED = 1.58;
const WINK = 1.62;
/** Жетон на полу перед правой ступнёй (модель, до `G`): лежит плашмя. */
export const TOK0: V3 = [3.4, 7.6, 0.25];
/** Цели кончиков пальцев правой лапы В МИРЕ (до `G`): жетон держит перед пальцами. */
const W_AIM: V3 = [5.0, 5.6, 8.0];
/** Касание: пальцы на жетоне сверху. */
const TOK_UP = 0.55;
const W_GRAB: V3 = [TOK0[0], TOK0[1], TOK0[2] + TOK_UP];
const W_UP: V3 = [7.4, 6.1, 12.2];
/** Над плечом, сбоку от щеки, под ухом — на фоне пустого. */
const W_HIGH: V3 = [10.4, 4.3, 19.1];
/** Под краем кокетки перед брюхом → вверх в щель между пелериной и грудью. */
const W_EDGE: V3 = [3.0, 5.3, 9.2];
const W_IN: V3 = [3.0, 3.93, 13.2];

function workPose(t: number): Pose {
  const o: Pose = { ...REST };
  // Жетон: проявляется на полу (уже лежал), в лапе после касания, уходит под пелерину.
  o.tok = kf(t, [
    [0, 0],
    [0.12, 1, 'l'],
  ]);
  // В лапе с кадра касания; разворачивается лицом к нам за пять кадров.
  o.tokU =
    t >= GRAB
      ? Math.max(
          0.001,
          kf(t, [
            [GRAB, 0],
            [GRAB + 0.2, 1, 'o'],
          ]),
        )
      : 0;
  o.tuck = kf(t, [
    [0, 0],
    [EDGE, 0],
    [TUCKED, 1, 'i'],
  ]);
  if (t >= TUCKED + 0.02) {
    o.tok = -1;
    o.tokU = 0;
    o.tuck = 0;
  }
  // Нюхает, оглядываясь.
  const sn = bump(t, 0.02, 0.4);
  o.sniff = bump(t, 0.06, 0.16) + bump(t, 0.17, 0.27) + 0.8 * bump(t, 0.28, 0.38);
  o.wig = 0.7 * Math.sin(t * TAU * 4) * sn;
  o.whisk = Math.sin(t * TAU * 8) * sn + 0.8 * Math.sin(t * TAU * 9) * bump(t, SPOT, 0.62);
  // Голова: нюхает вверх, оглядывается → заметила: вниз и вправо на жетон.
  const spot = kf(t, [
    [0, 0],
    [SPOT - 0.04, 0],
    [SPOT + 0.06, 1, 'o'],
    [1.0, 1],
    [1.06, 0, 's'],
  ]);
  o.turn = 0.12 * Math.sin(t * TAU * 1.4) * sn + 0.2 * spot;
  o.nod = -0.12 * sn + 0.3 * spot;
  o.look = kf(t, [
    [0, 0],
    [0.12, -1, 'o'],
    [0.26, 1, 's'],
    [SPOT - 0.06, 1],
    [SPOT, 0.6],
  ]);
  if (t >= SPOT) o.look = 0.6 * spot;
  // Уши вперёд-врозь, когда заметила.
  o.earL = o.earR = -0.18 * bump(t, SPOT, 0.8);
  // Присела (замах) → бросок вниз к жетону → назад, выпрямилась.
  const dive = kf(t, [
    [0, 0],
    [0.6, 0],
    [0.68, -0.3, 'o'],
    [GRAB, 1, 'i'],
    [GRAB + 0.04, 1],
    [LIFT, -0.08, 'o'],
    [1.16, 0, 's'],
  ]);
  o.bow = 0.45 * pos(dive) - 0.12 * neg(dive);
  o.cz = 2.0 * pos(dive) + 1.4 * neg(dive);
  o.lean = 0.16 * pos(dive);
  o.x = 1.2 * pos(dive);
  // Голова не валится вслед за поклоном: морда к жетону, лицо видно.
  o.nod -= 0.22 * pos(dive);
  // Правая лапа: к жетону (цели в мире) → вверх над плечом → к краю кокетки → под неё.
  o.wk = kf(t, [
    [0, 0],
    [0.6, 0],
    [0.7, 1, 'o'],
    [1.62, 1],
    [1.86, 0, 's'],
  ]);
  const track: [number, V3, Key[2]][] = [
    [0.66, W_AIM, undefined],
    [0.7, W_AIM, undefined],
    [GRAB, W_GRAB, 'i'],
    [GRAB + 0.04, W_GRAB, undefined],
    [LIFT, W_UP, 'o'],
    [HIGH, W_HIGH, 'o'],
    [1.3, W_HIGH, undefined],
    [EDGE, W_EDGE, 's'],
    [TUCKED, W_IN, 's'],
    [1.66, W_IN, undefined],
  ];
  const col = (j: number) => track.map((r) => [r[0], r[1][j], r[2]] as Key);
  o.wRx = kf(t, col(0));
  o.wRy = kf(t, col(1));
  o.wRz = kf(t, col(2));
  // Левая лапа с цепочкой — назад-наружу для равновесия во время броска.
  o.aLx = 1.6 * pos(dive);
  o.aLy = -2.2 * pos(dive);
  o.aLz = 2.6 * pos(dive);
  // Хвост вверх для равновесия.
  o.tailUp = 0.9 * pos(dive) + 0.4 * bump(t, LIFT, 1.5);
  o.tailSw = -0.3 * pos(dive) + 0.3 * Math.sin(t * TAU * 2) * bump(t, 1.1, 1.9);
  // Держит жетон над плечом — подпрыгнула на носочки.
  o.z = 0.8 * bump(t, HIGH - 0.06, 1.34);
  o.glint = 0.85 * bump(t, SPOT + 0.02, 0.64) + bump(t, HIGH - 0.02, 1.34);
  // Подмигнула.
  o.wink = kf(t, [
    [0, 0],
    [WINK, 0],
    [WINK + 0.05, 1, 'o'],
    [1.84, 1],
    [1.9, 0, 's'],
  ]);
  o.spark = t >= WINK + 0.04 && t < 1.84 ? (t - WINK - 0.04) / 0.18 : -1;
  o.tilt = 0.1 * bump(t, WINK - 0.04, 1.92);
  // Лицо: заметила — глаза шире; замах — хитрый прищур; бросок — шире; восторг; хитро; подмигнула.
  o.eye = t >= SPOT && t < 0.62 ? 'wide' : t >= 0.74 && t < 1.3 ? 'wide' : 'open';
  o.lid = kf(t, [
    [0, REST.lid],
    [0.6, REST.lid],
    [0.66, 0.6, 'o'],
    [0.74, 0.6],
    [1.3, 0.55],
    [1.62, 0.5],
    [1.92, REST.lid, 's'],
  ]);
  o.jaw = 0.32 * bump(t, HIGH - 0.04, 1.34);
  o.grin = REST.grin + 0.7 * bump(t, 0.6, 0.76) + 0.7 * bump(t, HIGH, 1.98);
  o.chest = 0.7 * bump(t, HIGH - 0.06, 1.4) + 0.4 * bump(t, 0.05, 0.4);
  // Тело и лапы приходят в покой; реквизит к концу уже на местах (`tok` −1).
  const r = settle(o, t, dur('work'));
  for (const k of PROPS) (r as unknown as Record<string, number>)[k] = o[k];
  return r;
}
const PROPS = ['tok', 'tokU', 'tuck', 'glint', 'spark'] as const;

/** Атака: присела, лапы с когтями вскинуты у щёк → бросок к зрителю, резцы наголо, лапы крест-накрест вниз → проводка. */
function attackPose(t: number): Pose {
  const T = dur('attack');
  const o: Pose = { ...REST };
  const l = kf(t, [
    [0, 0],
    [0.22, -1, 'o'],
    [0.28, -1.05],
    [0.36, 1, 'i'],
    [0.46, 0.95],
    [0.6, 0.3, 's'],
    [T, 0, 's'],
  ]);
  o.y = 3.6 * pos(l) - 0.6 * neg(l);
  o.scale = 1 + 0.18 * pos(l);
  o.cz = 1.3 * neg(l);
  o.sq = 0.06 * neg(l) + 0.05 * bump(t, 0.5, 0.66);
  o.bow = -0.08 * neg(l) + 0.12 * pos(l);
  // Морда вверх: лицо и резцы к зрителю.
  o.nod = -0.08 * neg(l) - 0.3 * pos(l);
  o.earB = 0.7 * neg(l) + 0.4 * pos(l);
  o.jaw = kf(t, [
    [0, 0],
    [0.2, 0.3],
    [0.3, 0.35],
    [0.36, 1, 'o'],
    [0.47, 1],
    [0.56, 0.2, 'i'],
    [0.7, 0, 's'],
  ]);
  o.eye = t < 0.7 ? 'angry' : 'open';
  o.grin = REST.grin * (1 - bump(t, 0, T));
  // Лапы: вскинуты у щёк когтями вверх → удар вперёд-вниз перед грудью → накрест вниз → на место.
  const W: V3 = [1.0, 1.0, 11.5];
  const S: V3 = [-3.4, 6.0, 6.0];
  const F: V3 = [-4.4, 4.6, 2.0];
  const arm = (j: number, d: number): number =>
    kf(t - d, [
      [0, 0],
      [0.22, W[j], 'o'],
      [0.3, W[j]],
      [0.37, S[j], 'i'],
      [0.41, S[j]],
      [0.54, F[j], 'o'],
      [0.7, F[j] * 0.5],
      [T - 0.04, 0, 's'],
    ]);
  o.aRx = arm(0, 0);
  o.aRy = arm(1, 0);
  o.aRz = arm(2, 0);
  o.aLx = arm(0, 0.03);
  o.aLy = arm(1, 0.03);
  o.aLz = arm(2, 0.03);
  o.swipe = t >= 0.33 && t < 0.58 ? (t - 0.33) / 0.25 : -1;
  o.claw = kf(t, [
    [0, 0],
    [0.2, 0.6],
    [0.34, 1, 'o'],
    [0.56, 1],
    [0.74, 0, 's'],
  ]);
  o.tailUp = 0.6 * bump(t, 0.1, 0.7);
  o.tailSw = 0.5 * Math.sin(((t - 0.3) / 0.2) * TAU) * bump(t, 0.3, 0.8);
  o.turn = 0.14 * Math.sin(((t - 0.52) / 0.16) * TAU) * bump(t, 0.52, 0.76);
  o.chest = 0.8 * bump(t, 0.1, 0.5);
  o.whisk = 0.8 * bump(t, 0.3, 0.6);
  // Атака: следы когтей к концу уже погасли — их не тянем к покою.
  const r = settle(o, t, T, 0.2);
  r.swipe = o.swipe;
  return r;
}

/** Сон: сидит, закутавшись в пелерину; уши обвисли, хвост вокруг; медленное дыхание. */
function sleepPose(t: number): Pose {
  const T = dur('sleep');
  const o: Pose = { ...REST };
  o.sit = 1;
  o.wrap = 1;
  o.eye = 'sleep';
  o.grin = 0.1;
  const br = loopK(t, T, [
    [0, 0],
    [1.3, 1, 's'],
    [1.55, 1],
    [2.9, 0, 's'],
    [3, 0],
  ]);
  o.chest = br;
  o.cz = -0.25 * br;
  o.bow = 0.14;
  o.nod = 0.2 + 0.03 * br;
  o.tilt = 0.12 - 0.02 * br;
  o.hz = 0.15 * br;
  o.earDrop = 1;
  o.earL = 0.06 * bump(t, 2.1, 2.3);
  o.whisk = 0.5 * bump(t, 1.9, 2.2);
  o.sniff = 0.3 * bump(t, 1.95, 2.15);
  o.aLz = 0.3 * br;
  o.aRz = 0.3 * br;
  o.tailCurl = 0.2;
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
// Скелет.
// ---------------------------------------------------------------------------

function planOf(o: Pose): Plan {
  const k = o.sit;
  const m = (key: 'hip' | 'foot' | 'body' | 'chest' | 'sh' | 'paw' | 'head'): V3 =>
    lerp3(STAND[key], SIT[key], k);
  return {
    hip: m('hip'),
    foot: m('foot'),
    sole: lerp(STAND.sole, SIT.sole, k),
    body: m('body'),
    chest: m('chest'),
    sh: m('sh'),
    paw: m('paw'),
    head: m('head'),
    tail: STAND.tail.map((p, i) => lerp3(p, SIT.tail[i], k)),
  };
}

interface Skel {
  up: (p: V3) => V3;
  pl: Plan;
  k: number;
  bc: V3;
  cc: V3;
  bax: [V3, V3, V3];
  br: V3;
  cr: V3;
  head: V3;
  sh: [V3, V3];
  el: [V3, V3];
  paw: [V3, V3];
  /** Кисть: направление (вдоль предплечья), середина ладони, кончики пальцев (хват). */
  hd: [V3, V3];
  hand: [V3, V3];
  grip: [V3, V3];
  hip: [V3, V3];
  knee: [V3, V3];
  ank: [V3, V3];
  foot: [V3, V3];
}

/** Две кости от `a` к `b`, сустав — в сторону `pole`. */
function ik(a: V3, b: V3, l1: number, l2: number, pole: V3): [V3, V3] {
  const d = sub(b, a);
  const D = Math.hypot(d[0], d[1], d[2]) || 1;
  const e = mul(d, 1 / D);
  const L = Math.max(Math.abs(l1 - l2) + 0.05, Math.min(D, (l1 + l2) * 0.995));
  const x = (l1 * l1 - l2 * l2 + L * L) / (2 * L);
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  const n = norm(sub(pole, mul(e, dot(pole, e))));
  const j = add(add(a, mul(e, x)), mul(n, h));
  return [j, add(j, mul(norm(sub(b, j)), l2))];
}

export function skel(o: Pose): Skel {
  const s = o.scale * G;
  const sq = o.sq;
  const pl = planOf(o);
  const up = (p: V3): V3 => {
    let q: V3 = [p[0] * (1 + sq * 0.5), p[1] * (1 + sq * 0.4), p[2] * (1 - sq)];
    q = pitchX(q, o.bow, [0, 0, 4]);
    q = rollY(q, o.lean, [0, 0, 0]);
    q = mul(q, s);
    return add(q, [o.x, o.y, o.z - o.cz]);
  };
  const lift = Math.max(0, o.z);
  const ch = o.chest;
  const z3: V3 = [0, 0, 0];
  const r: Skel = {
    up,
    pl,
    k: s,
    bc: up(pl.body),
    cc: up(pl.chest),
    bax: axes(rollY([1, 0, 0], o.lean), pitchX([0, 0, 1], o.bow * 0.7)),
    br: mul([BODY_R[0] * (1 + 0.02 * ch), BODY_R[1] * (1 + 0.04 * ch), BODY_R[2]], s),
    cr: mul([CHEST_R[0] * (1 + 0.03 * ch), CHEST_R[1] * (1 + 0.05 * ch), CHEST_R[2]], s),
    head: up(add(pl.head, [o.hx, o.hy, o.hz])),
    sh: [up([-pl.sh[0], pl.sh[1], pl.sh[2]]), up([pl.sh[0], pl.sh[1], pl.sh[2]])],
    el: [z3, z3],
    paw: [
      up([-(pl.paw[0] + o.aLx), pl.paw[1] + o.aLy, pl.paw[2] + o.aLz]),
      up([pl.paw[0] + o.aRx, pl.paw[1] + o.aRy, pl.paw[2] + o.aRz]),
    ],
    hd: [z3, z3],
    hand: [z3, z3],
    grip: [z3, z3],
    hip: [up([-pl.hip[0], pl.hip[1], pl.hip[2]]), up([pl.hip[0], pl.hip[1], pl.hip[2]])],
    knee: [z3, z3],
    ank: [z3, z3],
    foot: [
      [-pl.foot[0] * s, pl.foot[1] * s + o.fLy * G + o.y, pl.foot[2] * s + o.fLz * G + lift],
      [pl.foot[0] * s, pl.foot[1] * s + o.fRy * G + o.y, pl.foot[2] * s + o.fRz * G + lift],
    ],
  };
  /** Рука в точку: запястье (`tip` = 0) или кончики пальцев (`tip` = 1 — кость до них длиннее). */
  const arm = (j: number, want: V3, tip = 0) => {
    const side = j === 0 ? -1 : 1;
    const l2 = (ARM2 + tip * (1.3 + GRIP)) * s;
    // Локоть — наружу и назад.
    const [el, end] = ik(r.sh[j], want, ARM1 * s, l2, norm([side, -0.5, -0.3]));
    const fd = norm(sub(end, el));
    const paw = add(el, mul(fd, ARM2 * s));
    r.el[j] = el;
    r.paw[j] = paw;
    r.hd[j] = fd;
    r.hand[j] = add(paw, mul(fd, 1.3 * s));
    r.grip[j] = add(r.hand[j], mul(fd, GRIP * s));
  };
  for (const j of [0, 1]) {
    const side = j === 0 ? -1 : 1;
    arm(j, r.paw[j]);
    // Щиколотка над ступнёй; колено — вперёд и наружу.
    const ank = add(r.foot[j], mul(lerp3([0, -1.2, 1.1], [0, -1.4, 0.5], pl.sole), s));
    const [kn, an] = ik(r.hip[j], ank, LEG1 * s, LEG2 * s, norm([side * 0.35, 1, 0.2]));
    r.knee[j] = kn;
    r.ank[j] = an;
  }
  // Трюк: кончики пальцев правой лапы — в точку В МИРЕ (жетон на полу, над плечом, под пелериной).
  if (o.wk > 0) {
    arm(1, lerp3(r.grip[1], [o.wRx * G, o.wRy * G, o.wRz * G], o.wk), 1);
  }
  return r;
}

// ---------------------------------------------------------------------------
// Вторичное движение.
// ---------------------------------------------------------------------------

interface Lag {
  headX: number;
  headZ: number;
  /** Уши: добавка к повороту от пружины (дрожь после подёргивания, хлопки в прыжке). */
  earL: number;
  earR: number;
  /** Хвост: добавка вбок и вверх. */
  tailSw: number;
  tailUp: number;
  /** Жетон на цепочке отстаёт от лапы. */
  chX: number;
  chY: number;
  chZ: number;
  /** Пелерина отстаёт от тела. */
  capeX: number;
  capeZ: number;
}

const LAGS = new Map<string, Lag>();

/** Пружины вторичного движения: от начала анимации (разовой) или на две петли назад. */
export function lagOf(a: Anim, t: number): Lag {
  const key = `${a}:${t}`;
  const hit = LAGS.get(key);
  if (hit) return hit;
  const T = dur(a);
  const t0 = LOOP[a] ? t - 2 * T : 0;
  const P = (tt: number) => poseAt(a, LOOP[a] ? wrap(tt, T) : Math.max(0, tt));
  const SK = new Map<number, Skel>();
  const sk = (tt: number) => {
    const q = Math.round(tt * 2400) / 2400;
    let v = SK.get(q);
    if (!v) {
      v = skel(P(q));
      SK.set(q, v);
    }
    return v;
  };
  const env = LOOP[a] ? 1 : clamp01((T - t) / 0.2);
  // Разовая к концу приходит в запаздывание покоя на кадре 0: стык без сдвига.
  const L0 = LOOP[a] ? null : lagOf('idle', 0);
  const S0 = skel(poseAt('idle', 0));
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
  /** Только запаздывание (пружина минус поза) в пределах [lo, hi]. */
  const delta = (
    fn: (tt: number) => number,
    freq: number,
    damp: number,
    lo: number,
    hi: number,
    l0: number,
  ) => {
    const d = Math.max(lo, Math.min(hi, spring(fn, t, t0, freq, damp) - fn(t)));
    return d * env + (L0 ? l0 * (1 - env) : 0);
  };
  const r: Lag = {
    headX: lagged((tt) => sk(tt).head[0], 3.2, 0.32, (L0?.headX ?? 0) - S0.head[0], 1),
    headZ: lagged((tt) => sk(tt).head[2], 3.2, 0.32, (L0?.headZ ?? 0) - S0.head[2], 0.8),
    earL: delta(
      (tt) => P(tt).earL - 0.07 * sk(tt).head[2] + 0.05 * sk(tt).head[0],
      3.4,
      0.12,
      -0.5,
      0.5,
      L0?.earL ?? 0,
    ),
    earR: delta(
      (tt) => P(tt).earR - 0.07 * sk(tt).head[2] - 0.05 * sk(tt).head[0],
      3.6,
      0.12,
      -0.5,
      0.5,
      L0?.earR ?? 0,
    ),
    tailSw: delta((tt) => P(tt).tailSw + 0.12 * sk(tt).bc[0], 1.8, 0.2, -0.6, 0.6, L0?.tailSw ?? 0),
    tailUp: delta((tt) => P(tt).tailUp - 0.08 * sk(tt).bc[2], 2.0, 0.2, -0.5, 0.5, L0?.tailUp ?? 0),
    chX: delta((tt) => sk(tt).hand[0][0], 1.7, 0.1, -2.6, 2.6, L0?.chX ?? 0),
    chY: delta((tt) => sk(tt).hand[0][1], 1.7, 0.1, -2.6, 2.6, L0?.chY ?? 0),
    chZ: delta((tt) => sk(tt).hand[0][2], 2.2, 0.14, -1.5, 1.5, L0?.chZ ?? 0),
    capeX: delta((tt) => sk(tt).bc[0], 2.2, 0.2, -1.6, 1.6, L0?.capeX ?? 0),
    capeZ: delta((tt) => sk(tt).bc[2], 2.4, 0.2, -1.6, 1.6, L0?.capeZ ?? 0),
  };
  LAGS.set(key, r);
  return r;
}

interface HeadF {
  at: (p: V3) => V3;
  dir: (v: V3) => V3;
  k: number;
}

function headF(o: Pose, S: Skel, lag: Lag): HeadF {
  const nb = o.nod + o.bow * 0.85;
  const tl = o.tilt + o.lean;
  const dir = (v: V3): V3 => rollY(yawZ(pitchX(v, nb), o.turn), tl);
  // На малой голова чуть крупнее: глаза, нос и резцы должны поместиться.
  const k = S.k * (HI ? 1.03 : 1.07);
  const hc: V3 = [lag.headX, S.head[1], lag.headZ];
  return { dir, k, at: (p: V3) => add(hc, mul(dir(p), k)) };
}

// ---------------------------------------------------------------------------
// Части.
// ---------------------------------------------------------------------------

interface Ctx {
  a: Anim;
  o: Pose;
  S: Skel;
  h: HeadF;
  lag: Lag;
  t: number;
}

/** Часть с выбором палитры по точке, срезом, изнанкой, проявлением, светом трубы. */
interface PartF extends Part {
  pick?: (qx: number, qy: number, qz: number) => number;
  /** Срез: эту точку наружной стороны не рисовать (тогда видна изнанка, если есть `inner`). */
  cut?: (qx: number, qy: number, qz: number) => boolean;
  /** Изнанка: палитра дальней стороны оболочки (пелерина изнутри). */
  inner?: (qx: number, qy: number, qz: number) => number;
  /** Проявление шахматкой (реквизит тает). */
  vis?: number;
  /** Не ниже пола. */
  floor?: boolean;
  /** Свет трубы: нормаль без составляющей вдоль оси (хвост). */
  tube?: boolean;
}
/** Сдвиг тона, который `pick` возвращает вместе с палитрой. */
let PICK_T = 0;
let NEXT_ID = 0;
const nid = () => ++NEXT_ID;
const BODY_ID = 1;
const HEAD_ID = 2;

/** Прут прямо в кадр (когти, звенья, концы верёвки). */
interface Rod {
  a: V3;
  b: V3;
  w: number;
  pal: number;
  tone: number;
  vis?: number;
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

/** Ворс на крупной: короткие штрихи сверху вниз рядами со сдвигом (по точке на части — не «кипит»). */
function fur(qx: number, qy: number, qz: number): number {
  const r = Math.floor((qz + 2) * 7);
  const u = (qx + 2) * 8 + (r & 1) * 0.5 + qy * 0.7;
  const fu = u - Math.floor(u);
  const fv = (qz + 2) * 7 - r;
  const tick = fu < 0.18 && fv > 0.25 ? -0.07 : fu > 0.55 && fu < 0.7 && fv < 0.4 ? 0.05 : 0;
  const n = hash(Math.floor((qx + 2) * 11), Math.floor((qz + 2) * 13), Math.floor((qy + 2) * 3));
  return tick + (n < 0.1 ? -0.04 : n > 0.94 ? 0.04 : 0);
}

/** Пальцы ступни: тёмные щели спереди (ось 1 — вперёд). */
function toes(qx: number, qy: number, qz: number): number {
  if (qx < 0.35 || qz < -0.4) return 0;
  const u = ((qy + 1) / 2) * (HI ? 4 : 3);
  const fu = u - Math.floor(u);
  return Math.floor(u) > 0 && fu < (HI ? 0.16 : 0.24) ? -0.3 : 0;
}

function legs(out: PartF[], c: Ctx): void {
  const { S, o } = c;
  const k = S.k;
  const sole = S.pl.sole;
  for (const j of [0, 1]) {
    const side = j === 0 ? -1 : 1;
    const lid = nid();
    limb(out, S.hip[j], S.knee[j], 2.3 * k, 2.4 * k, P_FUR, lid, { bias: -0.08 });
    limb(out, S.knee[j], S.ank[j], 1.3 * k, 1.4 * k, P_FUR, lid, { bias: -0.06 });
    // Длинная розовая ступня носком к зрителю; поднятая — носком вниз (на цыпочках).
    const lift = j === 0 ? o.fLz : o.fRz;
    const toe = 0.45 * clamp01(lift);
    const fd = norm(lerp3([side * 0.12, 1, -toe], [side * 0.1, 0.3, 1], sole));
    const fu = norm(lerp3([0, toe, 1], [0, 1, -0.2], sole));
    const fax = axes(fd, fu);
    const fc = add(S.foot[j], mul(lerp3([0, 1.0, 0.75], [0, 0.4, 2.0], sole), k));
    out.push({
      c: fc,
      ax: fax,
      r: [2.9 * k, 1.5 * k, 0.9 * k],
      pal: P_PINK,
      id: nid(),
      bias: -0.04,
      tex: toes,
    });
  }
}

/**
 * Брюхо: серый мех; спереди — сливочный овал; поперёк — витая верёвка пояса
 * (косые пряди по углу вокруг тела, на крупной — тени между прядями).
 */
const BELT_Z = -0.12;
function beltZ(qx: number): number {
  return BELT_Z - 0.05 * (1 - qx * qx);
}
function bellyPick(qx: number, qy: number, qz: number): number {
  PICK_T = 0;
  const zc = beltZ(qx);
  const bw = HI ? 0.075 : 0.09;
  const dz = qz - zc;
  if (Math.abs(dz) < bw) {
    const a = Math.atan2(qx, qy);
    const u = a * (HI ? 7 : 4.5) + (dz / bw) * (HI ? 1.1 : 0.8);
    const fu = u - Math.floor(u);
    PICK_T = fu < 0.22 ? -0.2 : fu > 0.6 ? 0.08 : 0;
    if (Math.abs(dz) > bw * 0.7) PICK_T -= 0.08;
    return P_ROPE;
  }
  if (qy > 0.15) {
    const ex = qx / 0.5;
    const ez = (qz + 0.05) / 0.84;
    if (ex * ex + ez * ez < 1) {
      PICK_T = 0.02 + (HI ? fur(qx * 1.3, qy, qz * 1.3) * 0.7 : 0);
      return P_CREAM;
    }
  }
  if (HI) PICK_T += fur(qx, qy, qz);
  return P_FUR;
}

function torso(out: PartF[], rods: Rod[], c: Ctx): void {
  const { S } = c;
  const k = S.k;
  out.push({
    c: S.bc,
    ax: S.bax,
    r: S.br,
    pal: P_FUR,
    id: BODY_ID,
    bias: -0.06,
    pick: bellyPick,
  });
  out.push({
    c: S.cc,
    ax: S.bax,
    r: S.cr,
    pal: P_FUR,
    id: BODY_ID,
    bias: -0.08,
    tex: HI ? fur : undefined,
  });
  // Узел пояса чуть левее середины и два конца вниз с растрёпанными кончиками.
  const [e1, e2, e3] = S.bax;
  const kq = -0.18;
  const kz = beltZ(kq);
  const ky = Math.sqrt(Math.max(0, 1 - kq * kq - kz * kz));
  const kn = add(
    S.bc,
    add(mul(e1, S.br[0] * kq), add(mul(e2, S.br[1] * ky * 1.02), mul(e3, S.br[2] * kz))),
  );
  out.push({
    c: kn,
    ax: S.bax,
    r: [1.1 * k, 0.8 * k, 0.9 * k],
    pal: P_ROPE,
    id: nid(),
    bias: 0.06,
    tex: (qx, _qy, qz) => (qx * 0.7 + qz > 0.35 ? 0.08 : qx - qz > 0.6 ? -0.12 : 0),
  });
  for (const [dx, len] of [
    [-0.5, 3.0],
    [0.45, 2.3],
  ] as [number, number][]) {
    const a = add(kn, add(mul(e1, dx * k), mul(e2, 0.5 * k)));
    const b = add(a, add(mul(e3, -len * k), add(mul(e1, dx * 0.5 * k), mul(e2, 0.4 * k))));
    rods.push({ a, b, w: HI ? 0.9 : 0.6, pal: P_ROPE, tone: 4 });
    if (HI)
      rods.push({
        a: b,
        b: add(b, add(mul(e3, -0.7 * k), mul(e1, dx * 0.6 * k))),
        w: 0.5,
        pal: P_ROPE,
        tone: 6,
      });
  }
}

/**
 * Пелерина — оболочка вокруг плеч: кокетка (выше края `yokeZ`) кольцом
 * накрывает плечи и верх груди; ниже — только задняя половина, по бокам до
 * пояса, с рваным подолом. Спереди под кокеткой срез — видна изнанка (тёмная)
 * там, где её не закрывает тело. Запахнута (сон) — передний край сходится.
 */
const CAPE_C: V3 = [0, -0.3, 8.4];
const CAPE_R: V3 = [7.9, 7.0, 10.4];
/** Треугольная волна 0…1…0 (рваный край). */
const tri = (u: number) => {
  const f = u - Math.floor(u);
  return f < 0.5 ? f * 2 : 2 - f * 2;
};
function yokeZ(qx: number, qy: number): number {
  const a = Math.atan2(qx, qy);
  return 0.24 - 0.05 * (1 - qx * qx) + 0.07 * tri(a * 2.3 + 0.3);
}
function hemZ(qx: number, qy: number): number {
  const a = Math.atan2(qx, -qy);
  return -0.34 + 0.12 * tri(a * 2.6 + 0.15) + 0.04 * tri(a * 7.1);
}
let WRAP = 0;
/** Завязка у горла (доля радиуса пелерины по высоте). */
const KNOT_QZ = 0.56;
function capeCut(qx: number, qy: number, qz: number): boolean {
  if (qz < hemZ(qx, qy) - 0.12 * WRAP) return true;
  // Спереди от завязки вниз — разрез клином (запахнута — сходится).
  if (qy > 0 && qz < KNOT_QZ && Math.abs(qx) < (KNOT_QZ - qz) * 0.85 * (1 - WRAP)) return true;
  if (qz > yokeZ(qx, qy)) return false;
  // Ниже кокетки — только спина и бока (видны за руками до подола).
  const edge = lerp(0.3, 0.9, WRAP);
  return qy > edge + 0.06 * tri(qz * 3.1);
}
/** Наружная сторона: складки сукна вниз от кокетки, заплата на левом в кадре плече, строчка. */
function capePick(qx: number, qy: number, qz: number): number {
  PICK_T = 0;
  const yz = yokeZ(qx, qy);
  if (qz < yz) {
    // Складки: светлые и тёмные полосы вниз по углу вокруг тела.
    const a = Math.atan2(qx, qy);
    PICK_T = 0.07 * Math.sin(a * (HI ? 7 : 4.5));
  } else if (qz - yz < (HI ? 0.04 : 0.05)) {
    // Край кокетки — светлый кант (сукно загнуто).
    PICK_T = 0.1;
  }
  // Заплата на левом плече: квадрат светлее, на крупной — стежки по краю.
  const px = (qx + 0.5) / 0.17;
  const pz = (qz - 0.44) / 0.14;
  if (qy > 0 && Math.abs(px) < 1 && Math.abs(pz) < 1) {
    PICK_T = 0.2;
    if (HI && (Math.abs(px) > 0.78 || Math.abs(pz) > 0.74)) {
      const st = Math.abs(px) > 0.78 ? pz : px;
      if ((st * 4 + 10) % 1 < 0.5) PICK_T = -0.12;
    }
  }
  if (HI) PICK_T += 0.5 * fur(qx * 1.4, qy, qz * 0.8);
  return P_CAPE;
}
function capeInner(): number {
  PICK_T = -0.22;
  return P_CAPE;
}

/** Оболочка пелерины: середина, оси, радиусы (отстаёт от тела на пружине). */
export function capeFrame(o: Pose, S: Skel, lag: Lag): { c: V3; ax: [V3, V3, V3]; r: V3 } {
  const k = S.k;
  // Качается вбок и вздувается при подъёме/падении (вокруг плеч).
  const sw = -0.05 * lag.capeX;
  const fl = 0.04 * lag.capeZ;
  const piv = S.up([0, 0, 14]);
  const rot = (v: V3) => pitchX(rollY(v, sw), -fl);
  const c0 = S.up(CAPE_C);
  const br = 1 + 0.03 * o.chest;
  return {
    c: add(piv, rot(sub(c0, piv))),
    ax: S.bax.map((e) => rot(e)) as [V3, V3, V3],
    r: [CAPE_R[0] * k * br, CAPE_R[1] * k * br, CAPE_R[2] * k],
  };
}

/** Точка внутри пелерины и спереди её закрывает ткань (кокетка, не разрез): так прячется жетон. */
export function underCape(o: Pose, S: Skel, lag: Lag, p: V3): boolean {
  const F = capeFrame(o, S, lag);
  const d = sub(p, F.c);
  const q = F.ax.map((e, j) => dot(d, e) / F.r[j]);
  if (q[0] * q[0] + q[1] * q[1] + q[2] * q[2] >= 1) return false;
  WRAP = o.wrap;
  const qy = Math.sqrt(Math.max(0, 1 - q[0] * q[0] - q[2] * q[2]));
  return !capeCut(q[0], qy, q[2]);
}

function cape(out: PartF[], rods: Rod[], c: Ctx): void {
  const { S, o, lag } = c;
  const k = S.k;
  const F = capeFrame(o, S, lag);
  const cc = F.c;
  const ax = F.ax;
  out.push({
    c: cc,
    ax,
    r: F.r,
    pal: P_CAPE,
    id: nid(),
    bias: -0.02,
    pick: capePick,
    cut: capeCut,
    inner: capeInner,
  });
  // Завязка у горла: узелок и два шнурка с узелками на концах.
  const [e1, e2, e3] = ax;
  const qz = KNOT_QZ;
  const qy = Math.sqrt(1 - qz * qz);
  const kn = add(cc, add(mul(e2, CAPE_R[1] * k * qy + 0.3 * k), mul(e3, CAPE_R[2] * k * qz)));
  out.push({
    c: kn,
    ax,
    r: [0.95 * k, 0.6 * k, 0.8 * k],
    pal: P_ROPE,
    id: nid(),
    bias: 0.02,
    noSeam: true,
  });
  if (o.wrap < 0.5)
    for (const s of [-1, 1]) {
      const a = add(kn, mul(e1, s * 0.4 * k));
      const b = add(a, add(mul(e3, -0.9 * k), add(mul(e1, s * 1.5 * k), mul(e2, 0.4 * k))));
      rods.push({ a, b, w: HI ? 0.8 : 0.5, pal: P_ROPE, tone: 4 });
    }
}

/** Ладошка: розовая, на крупной — пальцы щелями у кончика. */
function pawPick(qx: number, qy: number, qz: number): number {
  PICK_T = 0;
  if (qx < -0.7) {
    PICK_T = -0.02;
    return P_FUR;
  }
  if (HI && qx > 0.3) {
    const u = ((qy + 1) / 2) * 3;
    const fu = u - Math.floor(u);
    if (Math.floor(u) > 0 && fu < 0.18) PICK_T = -0.2;
  }
  return P_PINK;
}

function arms(out: PartF[], rods: Rod[], c: Ctx): void {
  const { S, o } = c;
  const k = S.k;
  for (const j of [0, 1]) {
    const sh = S.sh[j];
    const el = S.el[j];
    const paw = S.paw[j];
    const aid = nid();
    limb(out, sh, el, 1.45 * k, 1.5 * k, P_FUR, aid, { bias: -0.06, tex: HI ? fur : undefined });
    limb(out, el, paw, 1.25 * k, 1.3 * k, P_FUR, aid, { bias: -0.04, tex: HI ? fur : undefined });
    const fd = S.hd[j];
    const nrm = norm(sub(VIEW, mul(fd, dot(VIEW, fd))));
    out.push({
      c: S.hand[j],
      ax: axes(fd, nrm),
      r: [1.75 * k, 1.35 * k, 1.05 * k],
      pal: P_PINK,
      id: nid(),
      bias: -0.02,
      pick: pawPick,
    });
    // Коготки: выпущены в атаке — короткие светлые прутья от кончиков пальцев.
    if (o.claw > 0.2) {
      const wv = norm([
        nrm[1] * fd[2] - nrm[2] * fd[1],
        nrm[2] * fd[0] - nrm[0] * fd[2],
        nrm[0] * fd[1] - nrm[1] * fd[0],
      ]);
      for (const u of HI ? [-0.9, 0, 0.9] : [-0.7, 0.7]) {
        const b = add(S.hand[j], add(mul(fd, 1.6 * k), mul(wv, u * k)));
        const e = add(b, add(mul(fd, 1.1 * o.claw * k), mul(wv, u * 0.3 * k)));
        rods.push({ a: b, b: e, w: HI ? 0.8 : 0.5, pal: P_TOOTH, tone: 5 });
      }
    }
  }
}

/** Голова: мех; щёки светлее, макушка чуть темнее; на крупной — ворс. */
function headPick(qx: number, qy: number, qz: number): number {
  PICK_T = 0;
  if (qy > 0.45 && qz < 0.05 && Math.abs(qx) > 0.25) PICK_T = 0.05;
  if (HI) PICK_T += fur(qx, qy, qz);
  return P_FUR;
}

/** Кончик носа: блик сверху слева. */
function nosePick(qx: number, qy: number, qz: number): number {
  PICK_T = 0.04;
  if (qz > 0.3 && qx < 0.1 && qy > 0) PICK_T = 0.16;
  return P_PINK;
}

function headParts(out: PartF[], c: Ctx): void {
  const { o, h } = c;
  const k = h.k;
  const hax = axes(h.dir([1, 0, 0]), h.dir([0, 0, 1]));
  out.push({
    c: h.at([0, 0, 0]),
    ax: hax,
    r: mul(HEAD_R, k),
    pal: P_FUR,
    id: HEAD_ID,
    bias: -0.03,
    pick: headPick,
  });
  // Мордочка: сливочная, вперёд-вниз; нос на кончике нюхает вверх и водит вбок.
  const sn = o.sniff;
  const wg = o.wig;
  const mAx = axes(h.dir(pitchX([1, 0, 0], 0.25)), h.dir(pitchX([0, 0, 1], 0.25)));
  out.push({
    c: h.at([wg * 0.12, 4.6, -2.3]),
    ax: mAx,
    r: [3.4 * k, 3.6 * k, 2.7 * k],
    pal: P_CREAM,
    id: HEAD_ID,
    bias: -0.02,
    tex: HI ? (qx, qy, qz) => 0.6 * fur(qx, qy, qz) : undefined,
  });
  out.push({
    c: h.at([wg * 0.45, 7.9, -1.4 + 0.5 * sn]),
    ax: hax,
    r: [(HI ? 1.25 : 1.35) * k, 1.0 * k, (HI ? 1.0 : 1.1) * k],
    pal: P_PINK,
    id: nid(),
    bias: 0.06,
    pick: nosePick,
  });
  // Открытый рот: красный зев под носом, нижняя челюсть, резцы сверху.
  const jw = o.jaw;
  if (jw > 0.06) {
    out.push({
      c: h.at([0, 6.9, -3.9 - 0.5 * jw]),
      ax: mAx,
      r: [1.5 * k, 1.0 * k, (0.5 + 1.0 * jw) * k],
      pal: P_MOUTH,
      id: nid(),
      bias: -0.12,
      noSeam: true,
    });
    out.push({
      c: h.at([0, 5.6, -5.0 - 1.1 * jw]),
      ax: mAx,
      r: [1.9 * k, 1.9 * k, 1.0 * k],
      pal: P_CREAM,
      id: HEAD_ID,
      bias: -0.04,
    });
  }
}

/** Ухо: тонкий диск; спереди — розовая чаша (темнее к верхнему краю), ободок мехом; левое надорвано. */
function earParts(out: PartF[], c: Ctx): void {
  const { o, h, lag } = c;
  const k = h.k;
  for (const side of [-1, 1]) {
    const j = side < 0 ? 0 : 1;
    const twitch = (j === 0 ? o.earL + lag.earL : o.earR + lag.earR) + 0.95 * o.earDrop;
    const back = -0.55 * o.earB + 0.2 * o.earDrop;
    const base: V3 = [side * 4.4, -0.8, 3.6];
    const c0: V3 = [side * 6.5, -0.7, 6.9];
    const rot = (v: V3): V3 => pitchX(rollY(yawZ(v, -side * 0.32), side * twitch), back);
    const ctr = h.at(add(base, rot(sub(c0, base))));
    const ax = axes(h.dir(rot([1, 0, 0])), h.dir(rot([0, 0, 1])));
    const torn = side < 0;
    out.push({
      c: ctr,
      ax,
      r: [5.5 * k, (HI ? 0.75 : 0.9) * k, 5.7 * k],
      pal: P_FUR,
      id: nid(),
      bias: -0.02,
      pick: (qx, qy, qz) => {
        PICK_T = 0;
        const d = qx * qx + (qz + 0.06) * (qz + 0.06);
        if (qy > 0 && d < (HI ? 0.6 : 0.52)) {
          // Чаша: в тени под верхним ободком, светлее книзу; на крупной — прожилка.
          PICK_T = -0.08 - 0.12 * qz + (d > (HI ? 0.48 : 0.4) ? -0.08 : 0);
          if (HI && Math.abs(qx + side * 0.15 * qz) < 0.035 && qz > -0.35 && qz < 0.45)
            PICK_T -= 0.08;
          return P_PINK;
        }
        PICK_T = qy > 0 ? 0.04 : -0.04;
        return P_FUR;
      },
      // Надрыв: треугольный вырез в верхней наружной кромке левого уха.
      cut: torn
        ? (qx, _qy, qz) => {
            const dx = -qx - 0.52;
            const dz = qz - 0.72;
            return dz > -0.3 - Math.abs(dx) * 1.6 && dx * dx + dz * dz < 0.12;
          }
        : undefined,
    });
  }
}

/** Хвост: тонкий розовый, сужается к кончику; на крупной — кольца чешуек. */
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
        (-p0[a] + p2[a]) * t +
        (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * t2 +
        (-p0[a] + 3 * p1[a] - 3 * p2[a] + p3[a]) * t3);
  return r;
}
function tailPts(c: Ctx): V3[] {
  const { o, S, lag } = c;
  const pl = S.pl;
  const root = pl.tail[0];
  const n = pl.tail.length;
  const sw = o.tailSw + lag.tailSw;
  const upA = o.tailUp + lag.tailUp;
  const st = 1 - o.sit;
  const pts = pl.tail.map((p, i) => {
    const u = i / (n - 1);
    let q = sub(p, root);
    q = [q[0] + sw * 2.2 * u * st, q[1] + sw * 1.2 * u * u * st, q[2] + upA * 4.0 * u * st];
    return add(root, q);
  });
  // Завиток: последние точки поворачиваются вокруг третьей с конца.
  const cu = o.tailCurl;
  const piv = pts[n - 3];
  for (let i = n - 2; i < n; i++) {
    const d = sub(pts[i], piv);
    pts[i] = add(piv, rollY(d, -(cu - 0.5) * (i === n - 1 ? 1.0 : 0.5) * st));
  }
  // Корень с телом, остальное — в мире (не задирается поклоном целиком).
  return pts.map((p, i) => {
    const b = S.up(p);
    const w: V3 = mul(p, S.k);
    const u = Math.min(1, i / 2);
    return lerp3(b, add(w, [S.bc[0] * 0.6, 0, 0]), u * 0.6);
  });
}
function tail(out: PartF[], c: Ctx): void {
  const { S } = c;
  const k = S.k;
  const wp = tailPts(c);
  const wid = [0.95, 0.88, 0.78, 0.68, 0.58, 0.5, 0.42, 0.36];
  const segs = HI ? 22 : 14;
  const P: V3[] = [];
  for (let i = 0; i <= segs; i++) P.push(catmull(wp, i / segs));
  const id = nid();
  let s = 0;
  for (let i = 0; i < segs; i++) {
    const p0 = P[i];
    const p1 = P[i + 1];
    const d = sub(p1, p0);
    const len = Math.hypot(d[0], d[1], d[2]);
    if (len < 1e-4) continue;
    const um = (i + 0.5) / segs;
    const w = Math.max(HI ? 0.32 : 0.55, profile(wid, um) * k);
    const r1 = len * 0.55 + 0.3 * k;
    const s0 = s;
    s += len;
    out.push({
      c: mul(add(p0, p1), 0.5),
      ax: axes(d, [0, 0, 1]),
      r: [r1, w, w],
      pal: P_PINK,
      id,
      tube: true,
      bias: -0.06,
      floor: true,
      tex: HI
        ? (qx) => {
            const g = (s0 + (qx + 1) * 0.5 * len) / (1.3 * k);
            return g - Math.floor(g) < 0.2 ? -0.07 : 0;
          }
        : undefined,
    });
  }
}

/** Жетон: латунный диск, кант темнее, середина светлее; на крупной — оттиск кирки. */
function tokenPick(qx: number, _qy: number, qz: number): number {
  const d = qx * qx + qz * qz;
  PICK_T = d > 0.62 ? -0.14 : d < 0.12 ? 0.1 : 0;
  if (HI && d < 0.5) {
    // Кирка: рукоять по диагонали, головка дугой поперёк у верха.
    const a = (qx + qz) * 0.7071;
    const b = (qx - qz) * 0.7071;
    if (Math.abs(b) < 0.09 && a > -0.55 && a < 0.42) PICK_T = -0.2;
    const arc = a - 0.3 + 0.55 * b * b;
    if (Math.abs(arc) < 0.08 && Math.abs(b) < 0.5) PICK_T = -0.2;
  }
  return P_BRASS;
}
const TOK_R = 1.55;
const TOK_T = 0.32;

/** Где жетон трюка и куда смотрит его лицо. */
export function tokAt(o: Pose, S: Skel): { c: V3; n: V3 } | null {
  if (o.tok < 0) return null;
  const floor: V3 = mul(TOK0, G);
  if (o.tokU <= 0) return { c: floor, n: [0, 0, 1] };
  // В пальцах правой лапы: с кадра касания — там, где лежал (пальцы сверху), потом
  // поднимается лицом к зрителю перед кончиками пальцев.
  const u = clamp01(o.tokU);
  const off = lerp3([0, 0, -TOK_UP * G], [0, 0.5 * S.k, 0], u);
  // Под пелерину ложится на грудь: верх назад (по изгибу кокетки).
  const face = lerp3([0.15, 1, 0.2], [0.2, 0.75, 0.65], o.tuck);
  return { c: add(S.grip[1], off), n: norm(lerp3([0, 0, 1], face, u)) };
}

function tokenPart(out: PartF[], c: V3, n: V3, vis: number, k: number): void {
  const e1 = Math.abs(n[2]) > 0.9 ? ([1, 0, 0] as V3) : norm([n[1], -n[0], 0]);
  const up = norm([
    n[1] * e1[2] - n[2] * e1[1],
    n[2] * e1[0] - n[0] * e1[2],
    n[0] * e1[1] - n[1] * e1[0],
  ]);
  out.push({
    c,
    ax: axes(e1, up),
    r: [TOK_R * k, TOK_T * k, TOK_R * k],
    pal: P_BRASS,
    id: nid(),
    bias: 0.08,
    noSeam: true,
    pick: tokenPick,
    vis,
  });
}

/** Жетон на цепочке в левой лапе: висит по отвесу, отстаёт от лапы (пружина). */
const CH_L = 3.4;
function chainGeo(c: Ctx): { top: V3; tok: V3; n: V3 } {
  const { S, lag } = c;
  const k = S.k;
  const top = add(S.hand[0], mul(S.hd[0], 0.9 * k));
  const d = norm([lag.chX * 0.55, lag.chY * 0.55, -CH_L - 0.25 * lag.chZ]);
  const tok = add(top, mul(d, (CH_L + TOK_R) * k));
  // Лицом к зрителю, поворачивается от раскачки.
  const n = norm([0.25 * lag.chX, 1, 0.15]);
  return { top, tok, n };
}
function chain(out: PartF[], rods: Rod[], c: Ctx): void {
  const { S } = c;
  const k = S.k;
  const g = chainGeo(c);
  tokenPart(out, g.tok, g.n, 1, k * 0.9);
  // Звенья: короткие пруты, тон через одно.
  const end = add(g.tok, mul(norm(sub(g.top, g.tok)), TOK_R * 0.9 * k));
  const n = HI ? 6 : 3;
  for (let i = 0; i < n; i++) {
    const a = lerp3(g.top, end, i / n);
    const b = lerp3(g.top, end, (i + 1) / n);
    rods.push({
      a,
      b: lerp3(a, b, 0.86),
      w: HI ? (i & 1 ? 0.55 : 0.95) : 0.5,
      pal: P_BRASS,
      tone: i & 1 ? 4 : 6,
    });
  }
}

// ---------------------------------------------------------------------------
// Свой растр: части с выбором палитры, срезом, изнанкой, проявлением.
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
        const sq = Math.sqrt(disc);
        let t = (-b + sq) / (2 * a);
        const i = py * w + px;
        let qx = q0x + t * qdx;
        let qy = q0y + t * qdy;
        let qz = q0z + t * qdz;
        let back = false;
        if (pt.cut && pt.cut(qx, qy, qz)) {
          if (!pt.inner) continue;
          // Изнанка: дальняя сторона оболочки, если её не срезало.
          t = (-b - sq) / (2 * a);
          qx = q0x + t * qdx;
          qy = q0y + t * qdy;
          qz = q0z + t * qdz;
          if (pt.cut(qx, qy, qz)) continue;
          back = true;
        }
        if (t <= zb[i]) continue;
        if (pt.floor && pt.c[2] + e1[2] * qx * r1 + e2[2] * qy * r2 + e3[2] * qz * r3 < 0) continue;
        if (vis < 1 && !dith(px, py, vis)) continue;
        const ax1 = pt.tube ? 0 : qx / r1;
        let nx = e1[0] * ax1 + (e2[0] * qy) / r2 + (e3[0] * qz) / r3;
        let ny = e1[1] * ax1 + (e2[1] * qy) / r2 + (e3[1] * qz) / r3;
        let nz = e1[2] * ax1 + (e2[2] * qy) / r2 + (e3[2] * qz) / r3;
        if (back) {
          nx = -nx;
          ny = -ny;
          nz = -nz;
        }
        const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        const lam = (nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]) / nl;
        const bounce = Math.max(0, -nz / nl) * 0.14;
        let pal = pt.pal;
        PICK_T = 0;
        if (back && pt.inner) pal = pt.inner(qx, qy, qz);
        else if (pt.pick) pal = pt.pick(qx, qy, qz);
        const N = pals[pal].length;
        let k = Math.max(0, lam * 0.6 + 0.4 + bounce) + PICK_T;
        if (pt.tex && !back) k += pt.tex(qx, qy, qz);
        if (pt.bias) k += pt.bias;
        zb[i] = t;
        f.idb[i] = pt.noSeam ? -2 : pt.id;
        f.pal[i] = pal;
        f.tone[i] = Math.max(0, Math.min(N - 1, Math.round(k * (N - 1))));
      }
    }
  }
}

/** Прут в кадр с глубиной: малая — линия в пиксель, крупная — толще, сторона к свету светлее. */
function rodF(f: Frame, r: Rod): void {
  const A = project(mul(r.a, RR));
  const B = project(mul(r.b, RR));
  const ax = OX + A[0];
  const ay = OY + A[1];
  const bx = OX + B[0];
  const by = OY + B[1];
  const rad = (r.w * RR) / 2;
  const N = PAL[r.pal].length;
  const vis = r.vis ?? 1;
  const put = (x: number, y: number, d: number, tn: number) => {
    if (x < 0 || y < 0 || x >= f.w || y >= f.h) return;
    if (vis < 1 && !dith(x, y, vis)) return;
    const i = y * f.w + x;
    if (d <= f.zb[i]) return;
    f.zb[i] = d;
    f.pal[i] = r.pal;
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
        lerp(A[2], B[2], u) + 0.8 * RR,
        r.tone,
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
      if (Math.hypot(ex, ey) > rad) continue;
      const side = (-dy * -0.7 + dx * -0.7) / ln;
      const lit = (ex * -dy + ey * dx) / ln;
      const tn = r.tone + (lit * side > 0.15 * rad ? 1 : lit * side < -0.3 * rad ? -2 : 0);
      put(x, y, lerp(A[2], B[2], u) + 0.8 * RR, tn);
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
      if (pl !== P_FUR && pl !== P_PINK && pl !== P_CREAM && pl !== P_CAPE) continue;
      for (const j of [i + w, i + 1]) {
        if (pal[j] === pl && idb[j] === idb[i] && tone[j] === tone[i] - 1 && dith(x, y, 0.28))
          hit.push(j, tone[i]);
      }
    }
  for (let n = 0; n < hit.length; n += 2) f.tone[hit[n]] = hit[n + 1];
}

function toRes(parts: PartF[]): PartF[] {
  if (RR === 1) return parts;
  return parts.map((pt) => ({ ...pt, c: mul(pt.c, RR), r: mul(pt.r, RR) }));
}

// ---------------------------------------------------------------------------
// Поверх кадра: глаза, рот и резцы, усы, румянец, блики, искра, следы когтей, сон.
// ---------------------------------------------------------------------------

function eyePal(): Record<string, RGBA> {
  return {
    K: V === 1 ? hx('#1e1006') : hx('#140e14'),
    W: hx('#ffffff'),
    b: V === 1 ? hx('#6a4418') : hx('#4e4250'),
    d: PAL[P_FUR][2],
  };
}
// Малая: глаз 4×5 — тёмная бусина с бликом, хитрое веко сверху.
const EYES_S: Record<string, string[]> = {
  wide: ['.KK.', 'KWKK', 'KKKK', 'KKbK', '.KK.'],
  open: ['....', 'dddd', 'KWKK', 'KKbK', '.KK.'],
  sly: ['....', '....', 'dddd', 'KWbK', '.KK.'],
  shut: ['....', '....', '....', 'dddd', '....'],
  happy: ['....', '.dd.', 'd..d', '....', '....'],
  sleep: ['....', '....', 'd..d', '.dd.', '....'],
  angry: ['....', 'dd..', 'KKdd', 'KWKK', '.KK.'],
};

/** Крупная: глаз эллипсом — ободок, тёмная радужка, отсвет снизу справа, блик, веко с ресницей. */
function eyeL(
  p: Px,
  cx: number,
  cy: number,
  side: number,
  mode: string,
  lid: number,
  ep: Record<string, RGBA>,
): void {
  const d = ep.d;
  if (mode === 'happy' || mode === 'sleep' || mode === 'shut') {
    const rx = 3.6;
    for (let x = -4; x <= 4; x++) {
      const u = x / rx;
      if (Math.abs(u) > 1.12) continue;
      const yy =
        mode === 'happy'
          ? cy - 0.6 + Math.abs(u) * 2.2
          : mode === 'sleep'
            ? cy + 0.2 + (1 - u * u) * 1.6
            : cy + 1.2 + u * u * 0.6;
      p.set(cx + x, Math.round(yy), d);
      if (Math.abs(x) <= 3) p.set(cx + x, Math.round(yy) + 1, d);
    }
    return;
  }
  const wide = mode === 'wide';
  const rx = wide ? 4.3 : 4.0;
  const ry = wide ? 5.2 : 4.8;
  const slant = mode === 'angry' ? 0.42 : 0;
  const L = mode === 'angry' ? 0.38 : lid;
  const top = cy - ry + 2 * ry * L;
  const lidAt = (dx: number) => top + slant * dx * -side;
  for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++)
    for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const e = (dx / rx) ** 2 + (dy / ry) ** 2;
      if (e > 1) continue;
      if (y + 0.5 < lidAt(dx)) continue;
      // Нижнее веко чуть приподнято — хитрый прищур (кроме «шире»).
      if (!wide && dy > ry * 0.72) continue;
      let col = ep.K;
      if (e < 0.72) col = mixc(ep.K, ep.b, 0.25);
      if (e < 0.72 && dx > 0.1 * rx && dy > 0.2 * ry && e > 0.18) col = ep.b;
      p.set(x, y, col);
    }
  // Блик: под веком, сверху слева; второй маленький — снизу справа.
  const gy = Math.max(Math.round(lidAt(-1.6) + 1), Math.round(cy - 2.4));
  const gx = Math.round(cx - 1.9);
  if (gy <= cy + 1) {
    p.set(gx, gy, ep.W);
    p.set(gx + 1, gy, ep.W);
    p.set(gx, gy + 1, ep.W);
    p.set(gx + 1, gy + 1, mixc(ep.W, ep.K, 0.25));
  }
  p.set(Math.round(cx + 1.4), Math.round(cy + 2.2), mixc(ep.W, ep.b, 0.3));
  // Веко: линия по краю и ресница у наружного угла.
  if (L > 0.05 || slant) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = x + 0.5 - cx;
      if (Math.abs(dx) > rx + 0.2) continue;
      const ly = Math.round(lidAt(dx) - 0.5);
      const e = (dx / rx) ** 2 + ((ly + 0.5 - cy) / ry) ** 2;
      if (e > 1.15) continue;
      p.set(x, ly, d);
    }
  }
  const oxe = Math.round(cx + side * (rx + 0.6));
  const oye = Math.round(lidAt(side * rx) - (L > 0.05 ? 0.5 : 2));
  p.set(oxe, oye, d);
  p.set(oxe + side, oye - 1, d);
}

function face(p: Px, f: Frame, mask: Uint8Array, c: Ctx): void {
  const { o, h } = c;
  const ep = eyePal();
  const lk = o.look;
  for (const side of [-1, 1] as const) {
    const at = seen(f, mul(h.at([side * 3.0, 5.9, 0.9]), RR), OX, OY, 2.4 * RR);
    if (!at) continue;
    let key: string = o.eye;
    let lid = o.lid;
    if (side > 0 && o.wink > 0.5) key = 'happy';
    else if (key === 'open' || key === 'wide' || key === 'angry') {
      lid = Math.max(lid, o.blink);
      if (o.blink > 0.75) key = 'shut';
    }
    const sx = Math.round(lk * (HI ? 1.4 : 0.6));
    if (HI) {
      if (key === 'open' && lid > 0.92) key = 'shut';
      eyeL(p, at[0] + sx, at[1], side, key, key === 'wide' ? 0 : lid, ep);
    } else {
      if (key === 'open')
        key = lid < 0.15 ? 'wide' : lid < 0.45 ? 'open' : lid < 0.9 ? 'sly' : 'shut';
      const rows = EYES_S[key];
      const flip = side > 0 && key === 'angry';
      stamp(p, rows, ep, at[0] - 2 + sx, at[1] - 3, flip);
    }
  }
  const ink = mixc(PAL[P_CREAM][1], INK_V[V], 0.55);
  // Нос: ноздри (крупная).
  if (HI) {
    for (const side of [-1, 1]) {
      const at = seen(
        f,
        mul(h.at([o.wig * 0.45 + side * 0.55, 8.6, -1.75 + 0.5 * o.sniff]), RR),
        OX,
        OY,
        1.6 * RR,
      );
      if (at) p.set(at[0], at[1], PAL[P_PINK][2]);
    }
  }
  // Рот «ω» и резцы (закрытый рот), иначе резцы сверху зева.
  const jw = o.jaw;
  const mouth = h.at([0, 7.15, -3.15]);
  const mAt = seen(f, mul(mouth, RR), OX, OY, 1.8 * RR);
  const tooth = PAL[P_TOOTH];
  if (mAt) {
    const [mx, my] = mAt;
    if (jw < 0.1) {
      if (HI) {
        // «ω»: от носа вниз, две дуги в стороны, уголки чуть вверх от улыбки.
        p.set(mx, my - 2, ink);
        p.set(mx, my - 1, ink);
        // Ухмылка: правый в кадре уголок выше всегда, левый — когда рада.
        for (const s of [-1, 1]) {
          const lift = s > 0 ? (o.grin > 0.2 ? 1 : 0) : o.grin > 0.6 ? 1 : 0;
          p.set(mx + s, my, ink);
          p.set(mx + 2 * s, my, ink);
          p.set(mx + 3 * s, my - lift, ink);
          if (s > 0 && o.grin > 0.6) p.set(mx + 4, my - 2, ink);
        }
        // Резцы: две пластинки 2×3 с тёмным зазором и краем.
        for (const s of [-1, 1]) {
          const x0 = s < 0 ? mx - 2 : mx + 1;
          for (let y = 1; y <= 3; y++)
            for (let x = 0; x < 2; x++) p.set(x0 + x, my + y, tooth[y === 3 ? 4 : 6]);
          p.set(s < 0 ? mx - 3 : mx + 3, my + 2, ink);
        }
        p.set(mx, my + 1, ink);
        p.set(mx, my + 2, ink);
        p.set(mx - 2, my + 4, ink);
        p.set(mx - 1, my + 4, ink);
        p.set(mx + 1, my + 4, ink);
        p.set(mx + 2, my + 4, ink);
      } else {
        // Малая: тёмная чёрточка и под ней два белых резца.
        p.set(mx - 1, my, ink);
        p.set(mx, my, ink);
        p.set(mx - 1, my + 1, tooth[6]);
        p.set(mx, my + 1, tooth[6]);
        p.set(mx - 1, my + 2, ink);
        p.set(mx, my + 2, ink);
      }
    } else {
      // Открыт: резцы торчат сверху зева.
      const tw = HI ? 2 : 1;
      const th = HI ? 3 : 2;
      for (const s of [-1, 1]) {
        const x0 = s < 0 ? mx - tw : mx;
        for (let y = 0; y < th; y++)
          for (let x = 0; x < tw; x++) p.set(x0 + x, my + y, tooth[y === th - 1 ? 4 : 6]);
      }
      if (HI) {
        p.set(mx, my, ink);
        p.set(mx, my + 1, ink);
      }
    }
  }
  // Усы: по три с каждой стороны от мордочки, длинные; поверх меха — полупрозрачно.
  const wd = V === 1 ? hx('#5a3a14') : hx('#57504b');
  const wl = V === 1 ? hx('#fff2c8') : hx('#ece6de');
  for (const side of [-1, 1]) {
    const at = seen(f, mul(h.at([side * 2.6, 6.2, -2.0]), RR), OX, OY, 2.2 * RR);
    if (!at) continue;
    const set = HI
      ? [
          [-0.34, 15],
          [0.0, 16],
          [0.3, 14],
        ]
      : [
          [-0.3, 7],
          [0.25, 7],
        ];
    for (const [sl0, len] of set) {
      const sl = sl0 + 0.12 * o.whisk * (sl0 < 0 ? 1 : -1);
      for (let s = 1; s <= len; s++) {
        const X = at[0] + side * s;
        const Y = Math.round(at[1] + sl * s + (s * s) / (HI ? 70 : 30));
        if (X < 0 || Y < 0 || X >= p.w || Y >= p.h) continue;
        const body = mask[Y * p.w + X];
        const fade = s > len - 2 ? 0.55 : 1;
        if (body) {
          if (!HI && s < 4) continue;
          p.set(X, Y, [wd[0], wd[1], wd[2], Math.round((HI ? 150 : 90) * fade)]);
        } else p.set(X, Y, [wl[0], wl[1], wl[2], Math.round(200 * fade)]);
      }
    }
  }
  // Румянец на щеках.
  const blush = V === 1 ? hx('#f2a070', 170) : hx('#ec8c92', 150);
  for (const side of [-1, 1]) {
    const at = seen(f, mul(h.at([side * 4.6, 5.0, -0.9]), RR), OX, OY, 1.6 * RR);
    if (!at) continue;
    const n = HI ? 2 : 1;
    for (let y = 0; y < (HI ? 2 : 1); y++)
      for (let x = -n; x <= n; x++)
        if (!HI || (x + y) & 1 || x === 0) p.set(at[0] + x, at[1] + y, blush);
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
const scr = (q: V3): [number, number] => {
  const [sx, sy] = project(mul(q, RR));
  return [OX + sx, OY + sy];
};

/** Блик на самом жетоне (на полу — меньше, в поднятой лапе — крупный); не виден — нет блика. */
function glintFx(p: Px, f: Frame, c: Ctx): void {
  const { o, S } = c;
  if (o.glint <= 0.05) return;
  const T = tokAt(o, S);
  if (!T) return;
  const q = add(T.c, mul(norm([-0.6, 0.2, 0.75]), 0.8 * S.k));
  const at = seen(f, mul(T.c, RR), OX, OY, 2.5 * RR);
  if (!at) return;
  const [x, y] = scr(q);
  const L = Math.round(o.glint * (HI ? 7 : 3) * (o.tokU > 0.5 ? 1 : 0.7));
  if (L < 1) return;
  const X = Math.round(x);
  const Y = Math.round(y);
  star(p, X, Y, L, hx('#ffffff'), hx('#fff1c4', 230));
  // Косые лучики покороче.
  const dl = Math.floor(L / 2);
  for (let d = 1; d <= dl; d++)
    for (const [sx, sy] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ])
      p.set(X + sx * d, Y + sy * d, hx('#fff6dc', d === dl ? 150 : 220));
}

/** Искра подмигивания у правого в кадре глаза — по пустому, мимо лица. */
function sparkFx(p: Px, mask: Uint8Array, c: Ctx): void {
  const { o, h } = c;
  const u = o.spark;
  const [x, y] = scr(h.at([9.6, 4.6, 2.6]));
  const L = Math.round((HI ? 4 : 2) * Math.sin(Math.PI * clamp01(u)) + 0.4);
  if (L < 1) return;
  const col = hx('#fff4dc');
  const X = Math.round(x);
  const Y = Math.round(y);
  for (const [dx, dy] of [
    [0, 0],
    ...[1, 2, 3, 4, 5].slice(0, L).flatMap((d) => [
      [d, 0],
      [-d, 0],
      [0, d],
      [0, -d],
    ]),
  ]) {
    const xx = X + dx;
    const yy = Y + dy;
    if (xx < 0 || yy < 0 || xx >= p.w || yy >= p.h || mask[yy * p.w + xx]) continue;
    p.set(xx, yy, col);
  }
}

/** Следы когтей: три косые царапины у каждой лапы сверху-снаружи вниз-внутрь — только по пустому. */
function swipeFx(p: Px, mask: Uint8Array, c: Ctx): void {
  const { o, S } = c;
  const u = o.swipe;
  const col = hx('#fff4dc');
  const dim = hx('#f0c070', 220);
  const vis = u < 0.55 ? 1.1 : (1 - u) / 0.45;
  const span = Math.min(1, u * 2.2);
  const k = RR * S.k;
  for (const j of [0, 1]) {
    const side = j === 0 ? -1 : 1;
    const [sx, sy] = scr(S.sh[j]);
    const dx = -side * 0.62;
    const dy = 1;
    const dl = Math.hypot(dx, dy);
    for (let n = 0; n < 3; n++) {
      const x0 = sx + side * (8.5 + n * 2.0) * k;
      const y0 = sy - (9 - n * 1.0) * k;
      const L = 17 * k * span;
      for (let s = 0; s <= L; s += 0.5) {
        const v = s / (17 * k);
        const bend = Math.sin(Math.PI * v) * 1.6 * k;
        const x = Math.round(x0 + (dx / dl) * s + side * bend);
        const y = Math.round(y0 + (dy / dl) * s);
        if (x < 0 || y < 0 || x >= p.w || y >= p.h || mask[y * p.w + x]) continue;
        const tl = s / Math.max(1e-3, L);
        if (!dith(x, y, vis * (0.35 + 0.75 * tl))) continue;
        p.set(x, y, tl > 0.5 ? col : dim);
      }
    }
  }
}

/** Сон: буквы «z» поднимаются над головой (вверх в мире) и тают. */
const Z_S = ['zzz', '.z.', 'zzz'];
const Z_L = ['zzzzz', '...z.', '..z..', '.z...', 'zzzzz'];
function zzz(p: Px, mask: Uint8Array, c: Ctx): void {
  const { h, t } = c;
  const col = hx('#f4ead8');
  const base = h.at([5.5, 0, 6]);
  for (let j = 0; j < 2; j++) {
    const u = wrap(t / 1.5 + j * 0.5, 1);
    const [x0, y0] = scr(add(base, [3.5 * u * G, 0, (5 + 9 * u) * G]));
    const rows = HI && u > 0.3 ? Z_L : Z_S;
    for (let y = 0; y < rows.length; y++)
      for (let x = 0; x < rows[y].length; x++) {
        if (rows[y][x] !== 'z') continue;
        const X = Math.round(x0) + x;
        const Y = Math.round(y0) + y;
        if (X < 0 || Y < 0 || X >= p.w || Y >= p.h || mask[Y * p.w + X]) continue;
        if (!dith(X, Y, 1.2 * (1 - u) * Math.min(1, u * 6))) continue;
        p.set(X, Y, col);
      }
  }
}

// ---------------------------------------------------------------------------
// Кадр.
// ---------------------------------------------------------------------------

/** Кадр `i` анимации `a` полосы `res`, вариант окраса `v` (0 — обычный, 1 — золотой). */
export function mouseFrame(a: Anim, i: number, res: Res = 's', v = 0): Px {
  const cv = RES[res];
  RR = cv.box / RES.s.box;
  HI = res === 'l';
  OX = cv.bx + cv.box / 2;
  OY = cv.by + GROUND * RR;
  V = v === 1 ? 1 : 0;
  NEXT_ID = 2;
  const t = i / FPS;
  const o = poseAt(a, t);
  const S = skel(o);
  const lag = lagOf(a, t);
  const c: Ctx = { a, o, S, h: headF(o, S, lag), lag, t };
  PAL = PAL_V[V];
  WRAP = o.wrap;
  const f = newFrame(cv.cw, cv.ch);
  const parts: PartF[] = [];
  const rods: Rod[] = [];
  tail(parts, c);
  legs(parts, c);
  torso(parts, rods, c);
  cape(parts, rods, c);
  arms(parts, rods, c);
  headParts(parts, c);
  earParts(parts, c);
  chain(parts, rods, c);
  const T = tokAt(o, S);
  if (T) tokenPart(parts, T.c, T.n, Math.min(1, o.tok), S.k);
  drawPartsF(f, toRes(parts), PAL, OX, OY);
  for (const r of rods) rodF(f, r);
  seams(f, 1.2 * RR, 1);
  rimLight(f, PAL, (pl) => pl !== P_MOUTH && pl !== P_TOOTH);
  if (HI) softBands(f);
  const p = toPx(f, PAL);
  selOutline(p, INK_V[V], 0.8);
  const mask = new Uint8Array(p.w * p.h);
  for (let j = 0; j < mask.length; j++) mask[j] = p.data[j * 4 + 3] > 0 ? 1 : 0;
  face(p, f, mask, c);
  glintFx(p, f, c);
  if (o.spark >= 0) sparkFx(p, mask, c);
  if (o.swipe >= 0) swipeFx(p, mask, c);
  if (a === 'sleep') zzz(p, mask, c);
  return p;
}
