// Крот-забойщик — пиксельный питомец по эталону боссов 12–14.
//
// Пухлый крот стоит на задних лапах и смотрит на нас: тело-груша без шеи в
// угольном бархатном меху, БОЛЬШОЙ розовый хоботок-нос, крошечные блестящие
// глазки-бусины под полями помятой жёлтой шахтёрской каски с латунным
// фонарём; ОГРОМНЫЕ розовые лапы-лопаты с белыми когтями; кожаный пояс с
// латунной пряжкой и подсумком, над поясом — вытертое пятно на брюшке.
// Читается на 44 px: тёмная груша, розовый нос, жёлтая каска с бликом
// фонаря, две большие розовые лапы. С барсуком не путается: у крота нет
// полос и ушей, морда тёмная, нос и лапы розовые.
//
// Две полосы, у каждой свой рисунок: малая — рамка 48 (шахта, списки),
// крупная — рамка 112 (карточка, вылупление, Питомник): бархат с отливом,
// ноздри, усы, подушечки и пальцы лап, строчка пояса, вмятина каски.
//
// Анимации 24 к/с по ключам (`kf`): подготовка → разгон → пик → проводка →
// возврат. Голова, каска и подсумок — с запаздыванием (`spring`). Трюк:
// фонарь зажигается и светит перед кротом, он роет обеими лапами прямо
// перед собой — куча растёт, комья летят в обе стороны от места, где роют, —
// и выныривает с куском руды в лапах (блик), гордится → фонарь гаснет,
// реквизит тает.
//
// Золотой рисуется здесь же (`v` = 1) своими палитрами: бархат — золото с
// бронзовой глубиной, нос и лапы — розовое золото, каска — светлая эмаль,
// фонарь медный.

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
} from './rig';
import type { Frame, Key, Part, RGBA, V3 } from './rig';

// ---------------------------------------------------------------------------
// Палитры (тон — номер ступени; свет, шов и кант сдвигают ступень).
// ---------------------------------------------------------------------------

const P_FUR = 0;
const P_PINK = 1;
const P_HAT = 2;
const P_BRASS = 3;
const P_GLASS = 4;
const P_LIT = 5;
const P_CLAW = 6;
const P_LEATH = 7;
const P_MOUTH = 8;
const P_DIRT = 9;
const P_ROCK = 10;
const P_ORE = 11;

const GLASS = ramp('#2a2620', '#423c34', '#5e564a', '#7c7364', '#9c9282', '#bcb3a2', '#dcd5c6');
const LIT = ramp('#9a6e1a', '#c89428', '#ecbe44', '#ffdc74', '#fff0aa', '#fffadc', '#ffffff');
const MOUTH = ramp('#24070a', '#45111a', '#6e2228', '#9a3c40', '#d06a6a', '#ee8f8a');
const DIRT = ramp(
  '#1c1209',
  '#2c1d0f',
  '#3f2a16',
  '#553a1f',
  '#6c4b29',
  '#845e36',
  '#9c7448',
  '#b48c5e',
);
const ROCK = ramp(
  '#1c1814',
  '#2a241f',
  '#3a332c',
  '#4c443b',
  '#5f564b',
  '#73695d',
  '#8a7f71',
  '#a29789',
  '#bbb1a3',
);
const ORE = ramp(
  '#0c2430',
  '#14394a',
  '#1e5468',
  '#2f7f9e',
  '#4aa2c0',
  '#6fc0d8',
  '#a2e0ee',
  '#e4fbff',
);

const PAL_V: RGBA[][][] = [
  [
    // Угольный бархат: тёплая тень → серый уголь → серебристый отлив.
    ramp(
      '#100d0d',
      '#171313',
      '#1f1a1a',
      '#282222',
      '#312a2a',
      '#3b3332',
      '#463d3c',
      '#524847',
      '#605553',
      '#706461',
      '#857873',
      '#9e928c',
    ),
    // Розовая кожа: нос, лапы, ступни.
    ramp(
      '#4e1c24',
      '#702a34',
      '#934046',
      '#b2565a',
      '#cb6e6e',
      '#df8784',
      '#eca19c',
      '#f5bab2',
      '#fbd4cb',
      '#fff0ea',
    ),
    // Жёлтая каска.
    ramp(
      '#3a2404',
      '#5a3808',
      '#7c500e',
      '#a06c14',
      '#c4881c',
      '#dea228',
      '#eeb83a',
      '#f8cc5a',
      '#fde08a',
      '#fff4c8',
    ),
    // Латунь фонаря и пряжки.
    ramp('#3a250c', '#5a3c14', '#7a5620', '#9c7030', '#bf9044', '#d8ae5e', '#ecca82', '#fae6b0'),
    GLASS,
    LIT,
    // Когти: слоновая кость.
    ramp('#4e463a', '#776d5c', '#a09480', '#c6baa2', '#e2d8c0', '#f2ead6', '#fffaee'),
    // Кожа пояса и подсумка.
    ramp('#24120a', '#3a1e10', '#542c18', '#6e3c20', '#8a4e2a', '#a46638', '#bc7f4c', '#d29c68'),
    MOUTH,
    DIRT,
    ROCK,
    ORE,
  ],
  [
    // Золотой бархат: бронза в тени → золото → бледное золото на свету.
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
    // Розовое золото: нос и лапы читаются на золотом меху.
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
    // Каска — светлая эмаль: на золоте не тонет.
    ramp(
      '#3a3226',
      '#564c3c',
      '#766a56',
      '#988c76',
      '#b8ad98',
      '#d2c9b6',
      '#e6dfd0',
      '#f2eee4',
      '#faf8f2',
      '#ffffff',
    ),
    // Фонарь и пряжка — медь.
    ramp('#3a1608', '#5c240e', '#7e3618', '#a04c24', '#bc6634', '#d4824a', '#e8a066', '#f6c294'),
    GLASS,
    LIT,
    ramp('#5a4a34', '#84725a', '#ac9a7c', '#d0c09e', '#ead9b8', '#f6eccf', '#fffaea'),
    // Пояс — тёмная бронзовая кожа.
    ramp('#1c0e06', '#2c160a', '#40200e', '#563014', '#6c401c', '#845226', '#9c6632', '#b47e44'),
    MOUTH,
    DIRT,
    ROCK,
    ORE,
  ],
];
const INK_V: RGBA[] = [hx('#0a0807'), hx('#1c0e03')];
/** Свет фонаря. */
const BEAM = hx('#ffe9a0');

// ---------------------------------------------------------------------------
// Кадр: холст и рамка тела у двух полос (как у барсука).
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

type Eye = 'open' | 'wide' | 'happy' | 'angry' | 'sleep' | 'shut' | 'squint';

export interface Pose {
  /** Весь крот: сдвиг, прыжок; присед (тело ниже, ступни стоят). */
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
  /** Пасть: 0 — закрыта, 1 — настежь; улыбка; нос нюхает (вверх) и водит вбок. */
  jaw: number;
  grin: number;
  sniff: number;
  wig: number;
  eye: Eye;
  blink: number;
  /** Вдох: грудь раздувается. */
  chest: number;
  /** Лапы-лопаты: сдвиг кисти от места покоя (в теле; x — наружу у обеих). */
  aLx: number;
  aLy: number;
  aLz: number;
  aRx: number;
  aRy: number;
  aRz: number;
  /** Запястья по целям В МИРЕ (трюк; x — наружу у обеих), доля 0…1. */
  wk: number;
  wLx: number;
  wLy: number;
  wLz: number;
  wRx: number;
  wRy: number;
  wRz: number;
  /** Ладони: 0 — к зрителю (висят, роют), 1 — вверх (держат). */
  palm: number;
  /** Хлопок: лопаты пальцами вверх, ладонями друг к другу (0…1). */
  pray: number;
  /** Ладони поворачиваются вокруг предплечья (лапы разминаются). */
  flexL: number;
  flexR: number;
  /** Когти растопырены и вытянуты. */
  claw: number;
  /** Ступни: сдвиг и подъём. */
  fLy: number;
  fLz: number;
  fRy: number;
  fRz: number;
  /** Каска относительно головы: приподнята, сдвинута на глаза (кивок), набок. */
  hatUp: number;
  hatNod: number;
  hatTilt: number;
  /** Свернулся (сон): 0 — стоит. */
  sit: number;
  /** Фонарь: 0 — погашен, 1 — горит; щелчок (0…1 после), −1 — нет; луч на кучу. */
  lamp: number;
  click: number;
  beam: number;
  /** Трюк: куча (видимость) и её рост 0…1. */
  heap: number;
  hp: number;
  /** Руда: −1 — нет, иначе видимость; 0 — на куче, 1 — в лапах; блик. */
  ore: number;
  oreU: number;
  glint: number;
  /** Хлопок лапами (0…1 после), −1 — нет. */
  clap: number;
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
  eye: 'open',
  blink: 0,
  chest: 0,
  aLx: 0,
  aLy: 0,
  aLz: 0,
  aRx: 0,
  aRy: 0,
  aRz: 0,
  wk: 0,
  wLx: 0,
  wLy: 0,
  wLz: 0,
  wRx: 0,
  wRy: 0,
  wRz: 0,
  palm: 0,
  pray: 0,
  flexL: 0,
  flexR: 0,
  claw: 0,
  fLy: 0,
  fLz: 0,
  fRy: 0,
  fRz: 0,
  hatUp: 0,
  hatNod: 0,
  hatTilt: 0,
  sit: 0,
  lamp: 0,
  click: -1,
  beam: 0,
  heap: 0,
  hp: 0,
  ore: -1,
  oreU: 0,
  glint: 0,
  clap: -1,
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
    else if (k >= 1) r[key] = b;
  }
  return r as unknown as Pose;
}

// ---------------------------------------------------------------------------
// Скелет в пикселях малой полосы: x — вправо, y — к зрителю, z — вверх.
// Два плана: стоит и свернулся (сон).
// ---------------------------------------------------------------------------

interface Plan {
  hip: V3;
  foot: V3;
  /** Ступня: 0 — на полу, 1 — подошвой к зрителю (сидит, ноги вперёд). */
  sole: number;
  body: V3;
  chest: V3;
  sh: V3;
  paw: V3;
  head: V3;
}
const STAND: Plan = {
  hip: [3.6, 0.6, 4.4],
  foot: [4.2, 1.4, 0],
  sole: 0,
  body: [0, 0, 10.4],
  chest: [0, 0.9, 18.2],
  sh: [7.0, 1.8, 12.8],
  paw: [10.2, 4.8, 8.8],
  head: [0, 1.4, 22.6],
};
const SIT: Plan = {
  hip: [4.2, 1.6, 2.8],
  foot: [4.8, 7.4, 0.6],
  sole: 1,
  body: [0, 0.2, 8.2],
  chest: [0, 1.4, 14.2],
  sh: [6.2, 2.6, 12.2],
  paw: [5.0, 8.2, 5.0],
  head: [0, 2.6, 19.4],
};
/** Радиусы груши: брюхо и верх (одна деталь — шеи не видно), голова. */
const BODY_R: V3 = [9.2, 7.6, 10.8];
const CHEST_R: V3 = [7.0, 6.2, 5.4];
/** Длины костей руки и ноги. */
const ARM1 = 3.1;
const ARM2 = 3.0;
const LEG1 = 2.8;
const LEG2 = 2.6;
/** Масштаб модели в рамке: ступни — макушка каски ~40 пикселей малой полосы. */
const G = 1.1;

/** Куча трюка: прямо перед кротом (в пикселях модели, до `G`). */
const HEAP_Y = 9.0;
const HEAP_R: V3 = [6.6, 4.2, 5.8];
/** Кисть в покое (тело) — для пересчёта целей в сдвиг. */
const PAW0 = STAND.paw;

// ---------------------------------------------------------------------------
// Дорожки анимаций.
// ---------------------------------------------------------------------------

/** Покой: дышит, нос нюхает и водит, лапы разминаются, щурится, каска качается. */
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
  o.sq = -0.014 * br;
  o.hz = 0.22 * br;
  o.aLz = 0.3 * br;
  o.aRz = 0.3 * br;
  // Переносит вес с ноги на ногу: одна медленная волна на петлю.
  const sw = Math.sin((t / T) * TAU);
  o.x = 0.4 * sw;
  o.lean = 0.03 * sw;
  o.tilt = -0.025 * sw;
  o.aLx = 0.15 * sw;
  o.aRx = -0.15 * sw;
  // Нюхает: нос вверх трижды и водит из стороны в сторону.
  const sn = bump(t, 0.85, 1.5);
  o.sniff = bump(t, 0.9, 1.04) + bump(t, 1.08, 1.22) + 0.7 * bump(t, 1.26, 1.4);
  o.wig = 0.8 * Math.sin((t - 0.85) * TAU * 3.2) * sn;
  o.nod = -0.08 * sn;
  o.turn = 0.06 * Math.sin((t - 0.85) * TAU * 1.6) * sn;
  // Лапы разминаются: ладони поворачиваются, когти растопыриваются.
  const fx = bump(t, 1.7, 2.25);
  o.flexL = 0.35 * fx;
  o.flexR = 0.35 * bump(t, 1.82, 2.37);
  o.claw = 0.45 * Math.max(fx, bump(t, 1.82, 2.37));
  // Встряхивает головой — каска качается следом (пружина).
  o.tilt += 0.07 * Math.sin(((t - 2.45) / 0.3) * TAU) * bump(t, 2.45, 2.75);
  // Щурится (крот подслеповат) и моргает.
  o.eye = t >= 1.55 && t < 1.68 ? 'squint' : 'open';
  o.blink = Math.max(bump(t, 0.35, 0.5), bump(t, 2.8, 2.94));
  return o;
}

/** Ходьба вразвалку: ступня в воздухе или стоит — не скользит; лапы качаются. */
function walkPose(t: number): Pose {
  const T = dur('walk');
  const o: Pose = { ...REST };
  const h = wrap(t, T);
  const la = bump(h, 0.02, 0.48);
  const lb = bump(h, 0.52, 0.98);
  o.fLz = 1.6 * la ** 0.8;
  o.fLy = 0.6 * la;
  o.fRz = 1.6 * lb ** 0.8;
  o.fRy = 0.6 * lb;
  // Вес — на стоящую ногу: тело над ней и с креном к ней.
  const sw = Math.sin((h / T) * TAU);
  o.x = 1.0 * sw;
  o.lean = 0.1 * sw;
  o.cz = 0.4 - 0.5 * Math.abs(sw);
  o.tilt = -0.08 * sw;
  o.nod = 0.04 + 0.03 * Math.cos((h / T) * 2 * TAU);
  o.wig = 0.4 * Math.sin((h / T) * 2 * TAU);
  // Лапы-лопаты качаются против ног, ладонями назад-вперёд.
  o.aRy = 1.8 * sw;
  o.aLy = -1.8 * sw;
  o.aRz = 0.8 * pos(sw);
  o.aLz = 0.8 * neg(sw);
  o.flexR = 0.2 * sw;
  o.flexL = -0.2 * sw;
  o.chest = 0.3;
  return o;
}

/** Радость: два подскока, лапы хлопают перед грудью, глаза «^», каска подпрыгивает. */
const CLAPS = [0.3, 0.62];
function happyPose(t: number): Pose {
  const T = dur('happy');
  const o: Pose = { ...REST };
  const rise = kf(t, [
    [0, 0],
    [0.1, -0.35, 'o'],
    [0.28, 1, 'o'],
    [0.38, 0.92],
    [0.52, -0.3, 'i'],
    [0.62, 0.6, 'o'],
    [0.7, 0.55],
    [0.82, -0.15, 'i'],
    [0.94, 0, 'o'],
    [T, 0],
  ]);
  const up = pos(rise);
  const env = 1 - clamp01((t - 0.86) / (T - 0.86));
  o.z = 2.6 * up;
  o.cz = 1.0 * neg(rise);
  o.sq = 0.08 * neg(rise) - 0.025 * up;
  o.fLz = 0.7 * up;
  o.fRz = 0.7 * up;
  // Лапы: врозь → хлоп перед грудью → врозь → хлоп → на место.
  const shut = kf(t, [
    [0, 0],
    [0.12, -0.25, 'o'],
    [0.28, 1, 'i'],
    [0.33, 1],
    [0.46, 0.05, 'o'],
    [0.6, 1, 'i'],
    [0.65, 1],
    [0.84, 0.1, 'o'],
    [1.0, 0, 's'],
  ]);
  const lift = kf(t, [
    [0, 0],
    [0.2, 1, 'o'],
    [0.8, 1],
    [1.02, 0, 's'],
  ]);
  const ax = -7.4 * pos(shut) + 1.6 * neg(shut);
  o.aRx = ax;
  o.aLx = ax;
  o.aRy = 3.4 * lift;
  o.aLy = 3.4 * lift;
  o.aRz = 2.2 * lift;
  o.aLz = 2.2 * lift;
  o.pray = clamp01(lift * 1.1);
  o.clap = -1;
  for (const c of CLAPS) if (t >= c && t < c + 0.16) o.clap = (t - c) / 0.16;
  o.nod = -0.12 * up;
  o.tilt = 0.1 * Math.sin((t / T) * TAU) * env;
  o.eye = t < 0.92 ? 'happy' : 'open';
  o.grin = lerp(REST.grin, 1, env);
  o.jaw = 0.4 * env;
  o.chest = 0.6 * env;
  o.wig = 0.6 * Math.sin(t * TAU * 3) * env;
  return o;
}

/**
 * Трюк (2 с): фонарь щёлкает → крот сгибается к земле перед собой (лапы
 * короткие — без поклона и приседа до земли не достать), фонарь на лбу каски
 * смотрит туда же и светит на кучу → шесть гребков, по очереди правой и
 * левой лопатой: лапа заносится над кучей, загребает когтями и отбрасывает
 * землю в свою сторону — комья срываются с того места кучи, где рыла лапа →
 * куча растёт → в куче блеснула руда, крот принюхался → обе лопаты загребают
 * её снизу → выпрямился и подпрыгнул: руда лежит в сложенных ладонях перед
 * грудью, блик, гордится → фонарь гаснет, руда тает → куча тает, лапы на место.
 */
const STROKES: [number, number][] = [
  [0.24, 1],
  [0.37, -1],
  [0.5, 1],
  [0.63, -1],
  [0.76, 1],
  [0.89, -1],
];
/** Гребок: лапа над кучей → когти в кучу → отбросила вбок → готова. */
const ST_DIG = 0.05;
const ST_THROW = 0.11;
const ST_END = 0.2;
const FIND = 1.04;
const GRAB = 1.14;
const POP = 1.32;
const LAND = 1.42;
const LAMP_ON = 0.08;
const LAMP_OFF = 1.6;
/**
 * Цели запястья В МИРЕ (пиксели модели до `G`, x — наружу): готова, занесена
 * над кучей, когти в куче, отбросила; обе загребли руду, подняли.
 */
const W_READY: V3 = [6.4, 8.0, 10.6];
const W_REACH: V3 = [4.2, 8.6, 12.4];
const W_DIG: V3 = [3.0, 9.0, 8.6];
const W_THROW: V3 = [11.0, 6.6, 11.0];
const W_GRAB: V3 = [2.6, 9.0, 8.2];
const W_LIFT: V3 = [3.0, 8.4, 11.0];
/** Держит руду: запястья перед грудью (в теле), ладони вверх. */
const P_HOLD: V3 = [3.6, 6.2, 11.4];
/** Руда в ладонях: вперёд и вверх от середины между запястьями (в теле). */
const ORE_ON: V3 = [0, 3.4, 2.2];
/** Где роет лапа стороны `s` (для комьев и пятна света). */
const digSpot = (s: number, hp: number): V3 => [
  s * 2.4 * G,
  HEAP_Y * G - 0.4,
  HEAP_R[2] * G * (0.45 + 0.55 * hp) * 0.9,
];

function digTrack(side: number): [number, V3, Key[2]][] {
  const keys: [number, V3, Key[2]][] = [[0.2, W_READY, undefined]];
  for (const [ts, s] of STROKES) {
    if (s !== side) continue;
    keys.push([ts, W_REACH, 's']);
    keys.push([ts + ST_DIG, W_DIG, 'i']);
    keys.push([ts + ST_THROW, W_THROW, 'o']);
    keys.push([ts + ST_END, W_READY, 's']);
  }
  keys.push([FIND, W_READY, 's']);
  keys.push([GRAB, W_GRAB, 'i']);
  keys.push([1.22, W_LIFT, 'o']);
  return keys;
}
const TRACK_R = digTrack(1);
const TRACK_L = digTrack(-1);
function pawAt(track: [number, V3, Key[2]][], t: number): V3 {
  const col = (j: number) => track.map((r) => [r[0], r[1][j], r[2]] as Key);
  return [kf(t, col(0)), kf(t, col(1)), kf(t, col(2))];
}
/** Момент броска комьев и сторона (для эффектов). */
export const THROWS: [number, number][] = STROKES.map(([ts, s]) => [ts + ST_THROW - 0.03, s]);

function workPose(t: number): Pose {
  const o: Pose = { ...REST };
  o.heap = kf(t, [
    [0, 0],
    [0.2, 1, 'l'],
    [1.7, 1],
    [1.9, 0, 'l'],
  ]);
  o.hp = smooth(clamp01((t - 0.22) / 0.86));
  o.lamp = kf(t, [
    [0, 0],
    [LAMP_ON - 0.02, 0],
    [LAMP_ON + 0.02, 1],
    [LAMP_OFF - 0.02, 1],
    [LAMP_OFF + 0.02, 0],
  ]);
  o.click =
    t >= LAMP_ON && t < LAMP_ON + 0.14
      ? (t - LAMP_ON) / 0.14
      : t >= LAMP_OFF && t < LAMP_OFF + 0.14
        ? (t - LAMP_OFF) / 0.14
        : -1;
  // Луч — на кучу, пока роет и пока ищет руду; выпрямился — фонарь светит вперёд.
  o.beam = kf(t, [
    [0, 0],
    [0.12, 0],
    [0.24, 1, 'o'],
    [GRAB + 0.04, 1],
    [1.26, 0, 'i'],
  ]);
  // Согнулся к куче: поклон и присед (иначе короткие лапы не достают до земли).
  const bend = kf(t, [
    [0, 0],
    [0.06, -0.1, 'o'],
    [0.22, 1, 'o'],
    [GRAB, 1],
    [1.22, 0.9],
    [POP, -0.12, 'o'],
    [LAND, 0, 's'],
  ]);
  let side = 0;
  for (const [ts, s] of STROKES) side += s * bump(t, ts, ts + ST_END);
  o.bow = 0.28 * bend;
  o.cz = 1.8 * pos(bend) + 0.6 * bump(t, GRAB - 0.04, 1.24);
  o.nod = 0.1 * bend - 0.2 * bump(t, 1.34, 1.66);
  o.lean = 0.07 * side;
  o.x = 0.5 * side;
  o.turn = -0.08 * side;
  // Лапы: в покое → к куче (цели в мире) → гребки → загребли руду → к груди.
  const wk = kf(t, [
    [0, 0],
    [0.2, 1, 's'],
    [1.22, 1],
    [POP, 0, 's'],
  ]);
  o.wk = wk;
  const pr = pawAt(TRACK_R, t);
  const pl = pawAt(TRACK_L, t);
  [o.wRx, o.wRy, o.wRz] = pr;
  [o.wLx, o.wLy, o.wLz] = pl;
  const hold = kf(t, [
    [0, 0],
    [1.2, 0],
    [POP, 1, 'o'],
    [1.76, 1],
    [1.96, 0, 's'],
  ]);
  o.aRx = o.aLx = (P_HOLD[0] - PAW0[0]) * hold;
  o.aRy = o.aLy = (P_HOLD[1] - PAW0[1]) * hold;
  o.aRz = o.aLz = (P_HOLD[2] - PAW0[2]) * hold;
  o.palm = kf(t, [
    [0, 0],
    [1.16, 0],
    [1.28, 1, 'o'],
    [1.76, 1],
    [1.96, 0, 's'],
  ]);
  // Вынырнул: прыжок с рудой, приземлился с прижимом.
  const jump = kf(t, [
    [0, 0],
    [1.22, 0],
    [POP, 1, 'o'],
    [LAND, 0, 'i'],
  ]);
  o.z = 2.4 * jump;
  o.sq = 0.06 * bump(t, LAND - 0.02, LAND + 0.12) - 0.03 * jump;
  // Руда: блеснула в куче → обе лопаты загребли → в ладонях перед грудью.
  if (t >= FIND) {
    o.ore = kf(t, [
      [FIND, 0.3],
      [FIND + 0.04, 1],
      [1.62, 1],
      [1.8, 0, 'l'],
    ]);
    o.oreU = kf(t, [
      [GRAB, 0],
      [POP, 1, 'o'],
    ]);
  }
  o.glint = 0.7 * bump(t, FIND, FIND + 0.12) + bump(t, 1.4, 1.64);
  // Лицо: усилие при гребке — прищур; находка — глаза шире, нюхает; гордится.
  let effort = false;
  for (const [ts] of STROKES) if (t >= ts + 0.03 && t < ts + 0.1) effort = true;
  o.eye =
    t >= 1.4 && t < 1.74 ? 'happy' : t >= FIND && t < 1.2 ? 'wide' : effort ? 'squint' : 'open';
  o.sniff = bump(t, FIND, FIND + 0.06) + bump(t, FIND + 0.06, FIND + 0.12);
  o.wig = 0.5 * Math.sin(t * TAU * 6) * bump(t, 0.2, FIND);
  o.jaw = 0.3 * bump(t, 1.4, 1.76);
  o.grin = REST.grin + 0.7 * bump(t, 1.36, 1.9);
  o.chest = 0.8 * bump(t, 1.34, 1.84);
  // Куча растаяла — реквизит на места покоя.
  if (o.heap < 0.01 && t > 1) {
    o.heap = 0;
    o.hp = 0;
    o.ore = -1;
    o.oreU = 0;
    o.glint = 0;
    o.beam = 0;
    o.lamp = 0;
    o.click = -1;
  }
  // Тело и лапы приходят в покой; реквизит тает сам и к концу уже на местах.
  const r = settle(o, t, dur('work'));
  for (const k of PROPS) (r as unknown as Record<string, number>)[k] = o[k];
  return r;
}
const PROPS = ['heap', 'hp', 'ore', 'oreU', 'glint', 'beam', 'lamp', 'click'] as const;

/** Атака: присел, лопаты назад → бросок к зрителю, когти, нос вверх, пасть → проводка. */
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
  o.y = 3.4 * pos(l) - 0.6 * neg(l);
  o.scale = 1 + 0.18 * pos(l);
  o.cz = 1.4 * neg(l);
  o.sq = 0.06 * neg(l) + 0.05 * bump(t, 0.5, 0.66);
  o.bow = -0.1 * neg(l) + 0.1 * pos(l);
  o.nod = -0.06 * neg(l) - 0.3 * pos(l);
  o.hatNod = -0.1 * neg(l);
  o.sniff = 0.8 * pos(l);
  o.jaw = kf(t, [
    [0, 0],
    [0.2, 0.25],
    [0.3, 0.3],
    [0.36, 1, 'o'],
    [0.47, 1],
    [0.56, 0.2, 'i'],
    [0.7, 0, 's'],
  ]);
  o.eye = t < 0.7 ? 'angry' : 'open';
  o.grin = REST.grin * (1 - bump(t, 0, T));
  // Лапы: вверх-назад-наружу → вперёд к зрителю когтями → накрест вниз → на место.
  const W: V3 = [1.6, -3.0, 9.6];
  const S: V3 = [-3.2, 7.2, 8.2];
  const F: V3 = [-5.4, 4.6, 0.6];
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
    [0.2, 0.5],
    [0.34, 1, 'o'],
    [0.56, 1],
    [0.74, 0, 's'],
  ]);
  // Встряхнулся после удара.
  o.turn = 0.16 * Math.sin(((t - 0.52) / 0.16) * TAU) * bump(t, 0.52, 0.76);
  o.chest = 0.8 * bump(t, 0.1, 0.5);
  return o;
}

/** Сон: свернулся, каска съехала на глаза, фонарь чуть тлеет; медленное дыхание. */
function sleepPose(t: number): Pose {
  const T = dur('sleep');
  const o: Pose = { ...REST };
  o.sit = 1;
  o.eye = 'sleep';
  o.grin = 0;
  const br = loopK(t, T, [
    [0, 0],
    [1.3, 1, 's'],
    [1.55, 1],
    [2.9, 0, 's'],
    [3, 0],
  ]);
  o.chest = br;
  o.cz = -0.25 * br;
  o.bow = 0.12;
  o.nod = 0.04 + 0.03 * br;
  o.tilt = 0.14 - 0.02 * br;
  o.hz = 0.15 * br;
  o.hatNod = 0.34;
  o.hatUp = -0.5;
  o.hatTilt = -0.1;
  o.jaw = 0.12 * (1 - br);
  o.sniff = 0.3 * bump(t, 2.1, 2.3);
  o.palm = 0.6;
  o.aLz = 0.3 * br;
  o.aRz = 0.3 * br;
  o.lamp = 0.22 + 0.06 * br;
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
  };
}

interface Skel {
  up: (p: V3) => V3;
  pl: Plan;
  k: number;
  /** Брюхо и верх груши: центры, оси, радиусы. */
  bc: V3;
  cc: V3;
  bax: [V3, V3, V3];
  br: V3;
  cr: V3;
  head: V3;
  sh: [V3, V3];
  el: [V3, V3];
  paw: [V3, V3];
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
  const r: Skel = {
    up,
    pl,
    k: s,
    bc: up(pl.body),
    cc: up(pl.chest),
    bax: axes(rollY([1, 0, 0], o.lean), pitchX([0, 0, 1], o.bow * 0.5)),
    br: mul([BODY_R[0] * (1 + 0.02 * ch), BODY_R[1] * (1 + 0.04 * ch), BODY_R[2]], s),
    cr: mul([CHEST_R[0] * (1 + 0.03 * ch), CHEST_R[1] * (1 + 0.05 * ch), CHEST_R[2]], s),
    head: up(add(pl.head, [o.hx, o.hy, o.hz])),
    sh: [up([-pl.sh[0], pl.sh[1], pl.sh[2]]), up([pl.sh[0], pl.sh[1], pl.sh[2]])],
    el: [
      [0, 0, 0],
      [0, 0, 0],
    ],
    paw: [
      up([-(pl.paw[0] + o.aLx), pl.paw[1] + o.aLy, pl.paw[2] + o.aLz]),
      up([pl.paw[0] + o.aRx, pl.paw[1] + o.aRy, pl.paw[2] + o.aRz]),
    ],
    hip: [up([-pl.hip[0], pl.hip[1], pl.hip[2]]), up([pl.hip[0], pl.hip[1], pl.hip[2]])],
    knee: [
      [0, 0, 0],
      [0, 0, 0],
    ],
    ank: [
      [0, 0, 0],
      [0, 0, 0],
    ],
    foot: [
      [-pl.foot[0] * s, pl.foot[1] * s + o.fLy * G + o.y, pl.foot[2] * s + o.fLz * G + lift],
      [pl.foot[0] * s, pl.foot[1] * s + o.fRy * G + o.y, pl.foot[2] * s + o.fRz * G + lift],
    ],
  };
  if (o.wk > 0) {
    r.paw[0] = lerp3(r.paw[0], [-o.wLx * G, o.wLy * G, o.wLz * G], o.wk);
    r.paw[1] = lerp3(r.paw[1], [o.wRx * G, o.wRy * G, o.wRz * G], o.wk);
  }
  for (const j of [0, 1]) {
    const side = j === 0 ? -1 : 1;
    // Локоть — наружу и назад.
    const [el, paw] = ik(r.sh[j], r.paw[j], ARM1 * s, ARM2 * s, norm([side, -0.5, -0.3]));
    r.el[j] = el;
    r.paw[j] = paw;
    // Щиколотка над ступнёй (сидит — позади поднятой ступни); колено — вперёд и наружу.
    const ank = add(r.foot[j], mul(lerp3([0, -0.3, 1.3], [0, -1.4, 0.6], pl.sole), s));
    const [kn, an] = ik(r.hip[j], ank, LEG1 * s, LEG2 * s, norm([side * 0.35, 1, 0.2]));
    r.knee[j] = kn;
    r.ank[j] = an;
  }
  return r;
}

/** Точка на поверхности брюха: qx вправо, qz вверх (доли радиусов). */
function torsoAt(S: Skel, qx: number, qz: number, out = 1): V3 {
  const qy = Math.sqrt(Math.max(0, 1 - qx * qx - qz * qz));
  const [e1, e2, e3] = S.bax;
  return add(
    S.bc,
    add(mul(e1, S.br[0] * qx * out), add(mul(e2, S.br[1] * qy * out), mul(e3, S.br[2] * qz * out))),
  );
}

// ---------------------------------------------------------------------------
// Вторичное движение.
// ---------------------------------------------------------------------------

interface Lag {
  headX: number;
  headZ: number;
  /** Каска подскакивает над головой (≥ 0) и кренится за её качанием. */
  hatZ: number;
  hatR: number;
  /** Подсумок отстаёт от туловища. */
  pouch: number;
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
  const sk = (tt: number) => skel(P(tt));
  const env = LOOP[a] ? 1 : clamp01((T - t) / 0.2);
  // Разовая к концу приходит в запаздывание покоя на кадре 0: стык без сдвига.
  const L0 = LOOP[a] ? null : lagOf('idle', 0);
  const S0 = skel(poseAt('idle', 0));
  /** Значение пружины (со сдвигом от позы, ограниченным `cap`). */
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
    hatZ: delta((tt) => sk(tt).head[2], 3.4, 0.2, -0.3, 0.9, L0?.hatZ ?? 0),
    hatR: delta((tt) => sk(tt).head[0] + 6 * P(tt).tilt, 2.6, 0.2, -1.8, 1.8, L0?.hatR ?? 0),
    pouch: delta((tt) => sk(tt).bc[0], 2.0, 0.16, -1.6, 1.6, L0?.pouch ?? 0),
  };
  LAGS.set(key, r);
  return r;
}

interface HeadF {
  at: (p: V3) => V3;
  dir: (v: V3) => V3;
  k: number;
  /** Каска: точка и направление в её осях (центр полей). */
  hat: (p: V3) => V3;
  hdir: (v: V3) => V3;
}
const yawZ0 = (p: V3, a: number): V3 => [
  p[0] * Math.cos(a) + p[1] * Math.sin(a),
  -p[0] * Math.sin(a) + p[1] * Math.cos(a),
  p[2],
];
/** Радиусы головы и центр полей каски в осях головы. */
const HEAD_R: V3 = [6.8, 6.2, 6.0];
const HAT_P: V3 = [0, 0, 3.6];
/** Купол каски (радиусы) и фонарь на его лбу. */
const DOME_R: V3 = [6.9, 6.6, 5.3];
const LAMP_Z = 2.0;
const LAMP_Y = DOME_R[1] * Math.sqrt(1 - (LAMP_Z / DOME_R[2]) ** 2);

function headF(o: Pose, S: Skel, lag: Lag): HeadF {
  const nb = o.nod + o.bow;
  const tl = o.tilt + o.lean;
  const dir = (v: V3): V3 => rollY(yawZ0(pitchX(v, nb), o.turn), tl);
  // На малой голова чуть крупнее: глазки, нос и фонарь должны поместиться.
  const k = S.k * (HI ? 1.04 : 1.1);
  const hc: V3 = [lag.headX, S.head[1], lag.headZ];
  const at = (p: V3) => add(hc, mul(dir(p), k));
  const hn = o.hatNod;
  const ht = o.hatTilt - 0.1 * lag.hatR;
  const hup = o.hatUp + lag.hatZ / k;
  const hrot = (v: V3): V3 => rollY(pitchX(v, hn), ht);
  return {
    dir,
    k,
    at,
    hat: (p) => at(add(add(HAT_P, hrot(p)), [0, 0, hup])),
    hdir: (v) => dir(hrot(v)),
  };
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

/** Часть с выбором палитры по точке на ней (пояс, морда, каска, лапы). */
interface PartF extends Part {
  pick?: (qx: number, qy: number, qz: number) => number;
  /** Проявление шахматкой (реквизит тает). */
  vis?: number;
  /** Срез: эту точку части не рисовать (купол каски без нижней половины). */
  cut?: (qx: number, qy: number, qz: number) => boolean;
  /** Не ниже пола (куча). */
  floor?: boolean;
  /** Бархатный отлив: блик по полувектору света и взгляда. */
  gloss?: number;
}
/** Сдвиг тона, который `pick` возвращает вместе с палитрой. */
let PICK_T = 0;
let NEXT_ID = 0;
const nid = () => ++NEXT_ID;
/** Номер груши (брюхо, верх, голова): шва между ними нет — шеи не видно. */
const BODY_ID = 1;
/** Где фонарь (стекло) в кадре — для света. */
let LAMP_AT: V3 = [0, 0, 0];
/** Куда смотрит фонарь (единичный вектор, вперёд от стекла). */
let LAMP_DIR: V3 = [0, 1, 0];

/** Прут прямо в кадр (когти). */
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

/** Пальцы: тёмные щели спереди (ось 1 — вперёд). */
function toes(n: number) {
  return (qx: number, qy: number, qz: number) => {
    if (qx < 0.25 || qz < -0.4) return 0;
    const u = ((qy + 1) / 2) * n;
    const fu = u - Math.floor(u);
    return Math.floor(u) > 0 && fu < (HI ? 0.16 : 0.24) ? -0.3 : 0;
  };
}

/**
 * Бархат на крупной: короткие штрихи ворса сверху вниз рядами со сдвигом и
 * редкая рябь (по точке на части — не «кипит»).
 */
function velvet(qx: number, qy: number, qz: number): number {
  const r = Math.floor((qz + 2) * 8);
  const u = (qx + 2) * 9 + (r & 1) * 0.5;
  const fu = u - Math.floor(u);
  const fv = (qz + 2) * 8 - r;
  const tick = fu < 0.2 && fv > 0.3 ? -0.06 : fu > 0.55 && fu < 0.7 && fv < 0.35 ? 0.045 : 0;
  const n = hash(Math.floor((qx + 2) * 11), Math.floor((qz + 2) * 13), Math.floor((qy + 2) * 3));
  return tick + (n < 0.1 ? -0.04 : n > 0.94 ? 0.04 : 0);
}

function legs(out: PartF[], rods: Rod[], c: Ctx): void {
  const { S } = c;
  const k = S.k;
  const sole = S.pl.sole;
  for (const j of [0, 1]) {
    const side = j === 0 ? -1 : 1;
    const lid = nid();
    limb(out, S.hip[j], S.knee[j], 2.6 * k, 2.6 * k, P_FUR, lid, { bias: -0.1, gloss: 0.15 });
    limb(out, S.knee[j], S.ank[j], 2.0 * k, 2.1 * k, P_FUR, lid, { bias: -0.08 });
    // Ступня: розовая, носком к зрителю; свернулся — подошвой к зрителю.
    const fd = norm(lerp3([side * 0.18, 1, 0], [side * 0.12, 0.25, 1], sole));
    const fu = norm(lerp3([0, 0, 1], [0, 1, -0.2], sole));
    const fax = axes(fd, fu);
    const fc = add(S.foot[j], mul(lerp3([0, 0.8, 1.0], [0, 0.4, 2.2], sole), k));
    const fid = nid();
    out.push({
      c: fc,
      ax: fax,
      r: [2.6 * k, 2.1 * k, 1.15 * k],
      pal: P_PINK,
      id: fid,
      bias: -0.06,
      tex: toes(HI ? 4 : 3),
    });
    // Коготки на пальцах: короткие, вперёд и вниз.
    const tip = add(fc, mul(fax[0], 2.2 * k));
    for (const u of HI ? [-1.0, 0, 1.0] : [-0.7, 0.7]) {
      const b = add(tip, add(mul(fax[1], u * k), mul(fax[2], 0.2 * k)));
      rods.push({
        a: b,
        b: add(b, add(mul(fax[0], 0.9 * k), mul(fax[2], -0.45 * k))),
        w: HI ? 0.7 : 0.5,
        pal: P_CLAW,
        tone: 4,
      });
    }
  }
}

/**
 * Брюхо: угольный бархат; пояс поперёк низа (кожа, на крупной — строчка по
 * кромкам), латунная пряжка посередине; над поясом слева в кадре — вытертое
 * светлое пятно.
 */
const BELT_Z = -0.4;
function beltZ(qx: number): number {
  return BELT_Z - 0.06 * (1 - qx * qx);
}
function bellyPick(qx: number, qy: number, qz: number): number {
  PICK_T = 0;
  const zc = beltZ(qx);
  const bw = HI ? 0.085 : 0.1;
  const dz = qz - zc;
  if (Math.abs(dz) < bw) {
    // Пряжка: латунная рамка, тёмная середина, язычок.
    if (qy > 0 && Math.abs(qx) < 0.15 && Math.abs(dz) < bw + 0.035) {
      const inner = Math.abs(qx) < (HI ? 0.085 : 0.07) && Math.abs(dz) < bw - (HI ? 0.035 : 0.04);
      if (inner && Math.abs(qx) > (HI ? 0.018 : 0.025)) {
        PICK_T = -0.3;
        return P_LEATH;
      }
      PICK_T = qx < -0.04 && dz > 0 ? 0.12 : 0.02;
      return P_BRASS;
    }
    const edge = Math.abs(dz) > bw - (HI ? 0.03 : 0.035);
    if (edge) PICK_T = dz > 0 ? 0.1 : -0.12;
    if (HI && !edge && Math.abs(Math.abs(dz) - (bw - 0.045)) < 0.012 && ((qx * 30 + 50) % 1) < 0.5)
      PICK_T = 0.16;
    return P_LEATH;
  }
  if (qy > 0 && qz > zc) {
    if (qy > 0 && Math.abs(qx) < 0.15 && Math.abs(dz) < bw + 0.035) {
      PICK_T = 0.04;
      return P_BRASS;
    }
    // Вытертое пятно над поясом: мех светлее, край неровный.
    const px = (qx + 0.32) / 0.2;
    const pz = (qz - zc - 0.21) / 0.17;
    const jit = hash(Math.floor((qx + 2) * 24), Math.floor((qz + 2) * 24), 3) * 0.35;
    if (px * px + pz * pz < 1 - jit) {
      PICK_T = 0.2 + (HI ? velvet(qx * 2, qy, qz * 2) * 1.5 : 0);
      return P_FUR;
    }
  }
  if (qz < zc) PICK_T = -0.03;
  if (HI) PICK_T += velvet(qx, qy, qz);
  return P_FUR;
}

function torso(out: PartF[], c: Ctx): void {
  const { S, lag } = c;
  const k = S.k;
  const bid = BODY_ID;
  out.push({
    c: S.bc,
    ax: S.bax,
    r: S.br,
    pal: P_FUR,
    id: bid,
    bias: -0.11,
    pick: bellyPick,
    gloss: 0.22,
  });
  out.push({
    c: S.cc,
    ax: S.bax,
    r: S.cr,
    pal: P_FUR,
    id: bid,
    bias: -0.1,
    gloss: 0.22,
    tex: HI ? velvet : undefined,
  });
  // Подсумок на правом в кадре боку, под поясом; качается за телом.
  const sw = 0.08 * lag.pouch;
  const qx = 0.68;
  const pc = torsoAt(S, qx, beltZ(qx) - 0.2, 0.96);
  const nrm = norm(sub(pc, S.bc));
  const tg = norm([nrm[1], -nrm[0], 0]);
  out.push({
    c: add(pc, mul(nrm, 0.6 * k)),
    ax: axes(tg, rollY([0, 0, 1], sw)),
    r: [2.4 * k, 1.3 * k, 2.2 * k],
    pal: P_LEATH,
    id: nid(),
    bias: 0.04,
    pick: (px, py, pz) => {
      PICK_T = 0;
      if (py < 0) return P_LEATH;
      // Клапан: верхняя половина, кромка темнее; латунная кнопка.
      if (Math.abs(px) < 0.2 && Math.abs(pz - 0.12) < 0.2 && py > 0.5) {
        PICK_T = 0.06;
        return P_BRASS;
      }
      if (pz > 0.05) {
        PICK_T = pz < (HI ? 0.13 : 0.16) ? -0.22 : 0.04;
        return P_LEATH;
      }
      if (HI && Math.abs(px) > 0.82) PICK_T = 0.1;
      return P_LEATH;
    },
  });
}

/** Ладонь-лопата: розовая, подушечка и пальцы; у запястья — меховая манжета. */
function pawPick(qx: number, qy: number, qz: number): number {
  PICK_T = 0;
  if (qx < -0.62) {
    PICK_T = -0.02;
    return P_FUR;
  }
  if (qz < -0.25) {
    PICK_T = -0.08;
    return P_PINK;
  }
  // Пальцы у кончика: щели между ними.
  if (qx > 0.42) {
    const u = ((qy + 1) / 2) * (HI ? 5 : 3);
    const fu = u - Math.floor(u);
    if (Math.floor(u) > 0 && fu < (HI ? 0.14 : 0.2)) PICK_T = -0.22;
    return P_PINK;
  }
  // Подушечка посередине ладони.
  if (HI && qz > 0.3) {
    const d = ((qx + 0.05) / 0.32) ** 2 + (qy / 0.42) ** 2;
    if (d < 1) PICK_T = d > 0.7 ? -0.12 : -0.05;
  }
  return P_PINK;
}

function arms(out: PartF[], rods: Rod[], c: Ctx): void {
  const { S, o } = c;
  const k = S.k;
  const cl = 1 + 0.5 * o.claw;
  const sp = 1 + 0.3 * o.claw;
  for (const j of [0, 1]) {
    const side = j === 0 ? -1 : 1;
    const sh = S.sh[j];
    const el = S.el[j];
    const paw = S.paw[j];
    const aid = nid();
    limb(out, sh, el, 2.6 * k, 2.7 * k, P_FUR, aid, { bias: -0.08, gloss: 0.18 });
    limb(out, el, paw, 2.4 * k, 2.5 * k, P_FUR, aid, { bias: -0.06, gloss: 0.18 });
    // Лопата: висит вниз-наружу (роет — тянется за предплечьем), ладонь к зрителю;
    // держит руду — ладони вверх и к середине.
    const fa = norm(sub(paw, el));
    const hang = norm(lerp3([side * 0.32, 0.3, -0.9], [-side * 0.5, 0.85, 0.12], o.palm));
    const hang2 = norm(lerp3(hang, [side * 0.16, 0.35, 0.92], o.pray));
    const fd = norm(add(mul(fa, 0.45 * (1 - o.pray)), mul(hang2, 0.55 + 0.45 * o.pray)));
    const flex = j === 0 ? o.flexL : o.flexR;
    const n0 = norm(lerp3([side * 0.42, 0.9, 0.12], [-side * 0.15, -0.1, 1], o.palm));
    const n1 = norm(lerp3(n0, [-side * 0.6, 0.78, 0.1], o.pray));
    let nrm = norm(sub(n1, mul(fd, dot(n1, fd))));
    const wv0 = norm([
      nrm[1] * fd[2] - nrm[2] * fd[1],
      nrm[2] * fd[0] - nrm[0] * fd[2],
      nrm[0] * fd[1] - nrm[1] * fd[0],
    ]);
    // Поворот ладони вокруг предплечья.
    const cf = Math.cos(flex * side);
    const sf = Math.sin(flex * side);
    nrm = norm(add(mul(nrm, cf), mul(wv0, sf)));
    const wv = norm([
      nrm[1] * fd[2] - nrm[2] * fd[1],
      nrm[2] * fd[0] - nrm[0] * fd[2],
      nrm[0] * fd[1] - nrm[1] * fd[0],
    ]);
    const pc = add(paw, mul(fd, 1.7 * k));
    out.push({
      c: pc,
      ax: axes(fd, nrm),
      r: [3.8 * k, 4.2 * k, 1.4 * k],
      pal: P_PINK,
      id: nid(),
      bias: -0.05,
      pick: pawPick,
    });
    // Когти: широкие белые, от кончиков пальцев вниз, загнуты к ладони.
    const us = HI ? [-2.6, -1.3, 0, 1.3, 2.6] : [-2.2, 0, 2.2];
    for (const u of us) {
      const along = 3.3 - 0.2 * Math.abs(u);
      const b = add(pc, add(mul(fd, along * k), mul(wv, u * 0.98 * sp * k)));
      const m = add(
        b,
        add(mul(fd, 1.5 * cl * k), add(mul(wv, u * 0.12 * o.claw * k), mul(nrm, 0.25 * k))),
      );
      const e = add(
        m,
        add(mul(fd, 0.9 * cl * k), add(mul(wv, u * 0.12 * o.claw * k), mul(nrm, 0.65 * cl * k))),
      );
      rods.push({ a: b, b: m, w: HI ? 1.3 : 0.5, pal: P_CLAW, tone: 4 });
      rods.push({ a: m, b: e, w: HI ? 0.9 : 0.5, pal: P_CLAW, tone: 5 });
    }
  }
}

/** Голова: бархат; под полями каски тень; щёки у носа чуть светлее. */
function headPick(qx: number, qy: number, qz: number): number {
  PICK_T = 0;
  if (qz > 0.4 && qy > -0.2) PICK_T = -0.1;
  else if (qy > 0.55 && qz < 0.1 && Math.abs(qx) < 0.62) PICK_T = 0.04;
  if (HI) PICK_T += velvet(qx, qy, qz);
  return P_FUR;
}

/** Кончик носа: темнее, сверху блик. */
function tipPick(qx: number, qy: number, qz: number): number {
  PICK_T = -0.1;
  if (qy > 0.2 && qz > 0.35 && qx < 0.2) PICK_T = 0.08;
  return P_PINK;
}

function headParts(out: PartF[], c: Ctx): void {
  const { o, h } = c;
  const k = h.k;
  const ex = h.dir([1, 0, 0]);
  const ez = h.dir([0, 0, 1]);
  const hax = axes(ex, ez);
  // Голова — продолжение груши: тот же номер, что у тела (шва нет), шеи не видно.
  out.push({
    c: h.at([0, 0, 0]),
    ax: hax,
    r: mul(HEAD_R, k),
    pal: P_FUR,
    id: BODY_ID,
    bias: -0.08,
    pick: headPick,
    gloss: 0.2,
  });
  // Хоботок: большой розовый, чуть вниз; нюхает — кончик вверх, водит вбок.
  const sn = o.sniff;
  const wg = o.wig;
  const pa = 0.22 - 0.16 * sn;
  const sax = axes(h.dir(pitchX([1, 0, 0], pa)), h.dir(pitchX([0, 0, 1], pa)));
  out.push({
    c: h.at([wg * 0.25, 6.4, -1.5]),
    ax: sax,
    r: [2.4 * k, 2.9 * k, 2.0 * k],
    pal: P_PINK,
    id: nid(),
    bias: 0.02,
  });
  const tax = axes(
    h.dir(pitchX([1, 0, 0], pa - 0.1 * sn)),
    h.dir(pitchX([0, 0, 1], pa - 0.1 * sn)),
  );
  out.push({
    c: h.at([wg * 0.55, 8.9, -2.0 + 0.45 * sn]),
    ax: tax,
    r: [2.1 * k, 0.95 * k, 1.75 * k],
    pal: P_PINK,
    id: nid(),
    bias: 0.04,
    pick: tipPick,
  });
  // Пасть под носом.
  const jw = o.jaw;
  const max = axes(h.dir(pitchX([1, 0, 0], 0.3)), h.dir(pitchX([0, 0, 1], 0.3)));
  if (jw > 0.06) {
    out.push({
      c: h.at([0, 6.2, -4.1 - 0.4 * jw]),
      ax: max,
      r: [1.7 * k, 1.1 * k, (0.4 + 1.0 * jw) * k],
      pal: P_MOUTH,
      id: nid(),
      bias: -0.15,
      noSeam: true,
    });
    if (jw > 0.25)
      out.push({
        c: h.at([0, 6.6, -4.5 - 0.8 * jw]),
        ax: max,
        r: [1.2 * k, 0.8 * k, 0.6 * k],
        pal: P_MOUTH,
        id: nid(),
        bias: 0.45,
        noSeam: true,
      });
    out.push({
      c: h.at([0, 5.4, -4.6 - 1.1 * jw]),
      ax: max,
      r: [2.0 * k, 2.0 * k, 1.1 * k],
      pal: P_FUR,
      id: BODY_ID,
      bias: -0.04,
    });
    if (jw > 0.45)
      for (const s of [-1, 1])
        out.push({
          c: h.at([s * 0.55, 7.0, -3.7]),
          ax: axes(h.dir([0, 0.15, -1]), h.dir([0, 1, 0])),
          r: [(HI ? 0.7 : 0.9) * k, 0.35 * k, 0.35 * k],
          pal: P_CLAW,
          id: nid(),
          bias: 0.2,
          noSeam: true,
        });
  }
  hatParts(out, c);
}

/** Каска: гребень посередине светлее, вмятина справа сверху (тень и светлый край). */
function domePick(qx: number, qy: number, qz: number): number {
  PICK_T = 0;
  const ax0 = Math.abs(qx);
  if (qz > 0.15 && ax0 < 0.085) PICK_T = 0.12;
  else if (HI && qz > 0.15 && ax0 < 0.14) PICK_T = -0.06;
  const dx = qx - 0.46;
  const dz = qz - 0.5;
  const d = Math.hypot(dx, dz);
  if (qy > -0.2 && d < (HI ? 0.13 : 0.12)) PICK_T = dx + dz < 0 ? -0.13 : 0.04;
  else if (qy > -0.2 && d < (HI ? 0.17 : 0.16) && dx + dz > 0) PICK_T = 0.12;
  // Царапины на крупной.
  if (HI && qy > 0 && Math.abs(qz - 0.3 - 0.4 * (qx + 0.6)) < 0.02 && qx > -0.62 && qx < -0.3)
    PICK_T = 0.16;
  return P_HAT;
}

function hatParts(out: PartF[], c: Ctx): void {
  const { o, h } = c;
  const k = h.k;
  const hax = axes(h.hdir([1, 0, 0]), h.hdir([0, 0, 1]));
  out.push({
    c: h.hat([0, -0.3, 0]),
    ax: hax,
    r: mul(DOME_R, k),
    pal: P_HAT,
    id: nid(),
    bias: 0.02,
    pick: domePick,
    cut: (_qx, _qy, qz) => qz < 0,
  });
  out.push({
    c: h.hat([0, 0.8, -0.15]),
    ax: hax,
    r: [8.2 * k, 8.6 * k, 0.75 * k],
    pal: P_HAT,
    id: nid(),
    bias: -0.03,
  });
  // Фонарь: латунный корпус на лбу каски, стекло к зрителю.
  const ly = LAMP_Y - 0.3;
  const lid = nid();
  out.push({
    c: h.hat([0, ly + 0.4, LAMP_Z]),
    ax: hax,
    r: [2.15 * k, 1.4 * k, 2.0 * k],
    pal: P_BRASS,
    id: lid,
    bias: 0.1,
    tex: (_qx, _qy, qz) => (qz > 0.6 ? 0.08 : 0),
  });
  const gc = h.hat([0, ly + 1.6, LAMP_Z]);
  LAMP_AT = gc;
  LAMP_DIR = h.hdir([0, 1, 0]);
  const on = o.lamp > 0.05;
  out.push({
    c: gc,
    ax: hax,
    r: [1.2 * k, 0.45 * k, 1.15 * k],
    pal: on ? P_LIT : P_GLASS,
    id: nid(),
    bias: on ? -0.55 + 0.8 * o.lamp : 0,
    noSeam: true,
    // Блик на стекле сверху слева — видно и у погашенного.
    tex: (qx, _qy, qz) => (qx < -0.1 && qz > 0.15 ? (on ? 0.2 : 0.5) : 0),
  });
}

/** Куча земли перед кротом: растёт; комки — пятнами тона. */
function heapParts(out: PartF[], c: Ctx): void {
  const { o } = c;
  const vis = o.heap;
  const g = 0.45 + 0.55 * o.hp;
  const tex = (qx: number, qy: number, qz: number) => {
    const n = hash(Math.floor((qx + 2) * (HI ? 7 : 3.5)), Math.floor((qz + qy + 4) * (HI ? 6 : 3)), 5);
    return n < 0.28 ? -0.1 : n > 0.82 ? 0.07 : 0;
  };
  out.push({
    c: mul([0, HEAP_Y, 0], G),
    ax: axes([1, 0, 0], [0, 0, 1]),
    r: mul(HEAP_R, G * g),
    pal: P_DIRT,
    id: nid(),
    tex,
    vis,
    floor: true,
  });
  if (o.hp > 0.3) {
    const g2 = smooth(clamp01((o.hp - 0.3) / 0.7));
    for (const s of [-1, 1])
      out.push({
        c: mul([s * 5.0, HEAP_Y - 0.8, 0], G),
        ax: axes([1, -0.2 * s, 0], [0, 0, 1]),
        r: mul([2.6, 2.2, 1.8], G * g2),
        pal: P_DIRT,
        id: nid(),
        bias: -0.04,
        tex,
        vis,
        floor: true,
      });
  }
}

/** Где руда: на верхушке кучи → в лапах (над серединой между кистями). */
function oreAt(c: Ctx): V3 {
  const { o, S } = c;
  const g = 0.45 + 0.55 * o.hp;
  const top: V3 = [0, HEAP_Y * G + 1.2, HEAP_R[2] * G * g + 0.4];
  const mid = mul(add(S.paw[0], S.paw[1]), 0.5);
  const held = add(mid, mul(ORE_ON, S.k));
  const u = o.oreU;
  const p = lerp3(top, held, u);
  p[2] += 3 * u * (1 - u);
  return p;
}

// ---------------------------------------------------------------------------
// Свой растр: части с выбором палитры, срезом, проявлением и отливом; когти; руда.
// ---------------------------------------------------------------------------

const CE = VIEW[1];
const SE = VIEW[2];
const HALF = norm(add(LIGHT, VIEW));

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
        if (pt.floor && pt.c[2] + e1[2] * qx * r1 + e2[2] * qy * r2 + e3[2] * qz * r3 < 0) continue;
        if (vis < 1 && !dith(px, py, vis)) continue;
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
        if (pt.gloss) {
          const sp = Math.max(0, (nx * HALF[0] + ny * HALF[1] + nz * HALF[2]) / nl);
          k += pt.gloss * sp ** 10;
        }
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

/** Внутри многоугольника (экранные точки относительно центра). */
function inPoly(P: [number, number][], dx: number, dy: number): boolean {
  let inside = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, yi] = P[i];
    const [xj, yj] = P[j];
    if (yi > dy !== yj > dy && dx < ((xj - xi) * (dy - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Кусок руды: серый ком (свет слева сверху) с голубыми кристаллами наружу. */
const ORE_LUMP: [number, number][] = [
  [-2.5, 0.3],
  [-1.9, -1.2],
  [-0.5, -1.7],
  [1.2, -1.5],
  [2.4, -0.4],
  [2.1, 1.3],
  [0.3, 2.0],
  [-1.8, 1.6],
];
/** Кристаллы: основание (x, y), угол, длина, полуширина. */
const ORE_XTAL: [number, number, number, number, number][] = [
  [-0.7, -1.0, -1.95, 2.9, 0.75],
  [0.8, -0.9, -1.2, 2.3, 0.65],
  [1.7, 0.2, -0.35, 1.5, 0.5],
];
function oreDraw(f: Frame, c: V3, vis: number): void {
  const [sx, sy, sd] = project(mul(c, RR));
  const s = RR * G * (HI ? 1.0 : 1.05);
  const lump = ORE_LUMP.map(([x, y]) => [x * s, y * s] as [number, number]);
  const xt = ORE_XTAL.map(([x, y, a, L, wd]) => {
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const bx = x * s;
    const by = y * s;
    const poly: [number, number][] = [
      [bx - uy * wd * s, by + ux * wd * s],
      [bx + ux * L * 0.75 * s - uy * wd * s, by + uy * L * 0.75 * s + ux * wd * s],
      [bx + ux * L * s, by + uy * L * s],
      [bx + ux * L * 0.75 * s + uy * wd * s, by + uy * L * 0.75 * s - ux * wd * s],
      [bx + uy * wd * s, by - ux * wd * s],
    ];
    return { poly, ux, uy, bx, by };
  });
  const R = 5 * s;
  const X0 = Math.max(0, Math.floor(OX + sx - R));
  const X1 = Math.min(f.w - 1, Math.ceil(OX + sx + R));
  const Y0 = Math.max(0, Math.floor(OY + sy - R));
  const Y1 = Math.min(f.h - 1, Math.ceil(OY + sy + R));
  const NR = PAL[P_ROCK].length;
  const NO = PAL[P_ORE].length;
  for (let py = Y0; py <= Y1; py++)
    for (let px = X0; px <= X1; px++) {
      const dx = px + 0.5 - OX - sx;
      const dy = py + 0.5 - OY - sy;
      let pal = -1;
      let tn = 0;
      for (const x of xt) {
        if (!inPoly(x.poly, dx, dy)) continue;
        // Грань к свету светлее; ребро посередине — самое светлое.
        const across = (dx - x.bx) * -x.uy + (dy - x.by) * x.ux;
        pal = P_ORE;
        tn = 4 + (across < -0.25 * s ? 1 : across > 0.3 * s ? -1 : 2);
        break;
      }
      if (pal < 0 && inPoly(lump, dx, dy)) {
        pal = P_ROCK;
        const l = (-dx - dy) / (2.4 * s);
        tn = 5 + (l > 0.35 ? 1 : l < -0.4 ? -2 : l < 0 ? -1 : 0);
        const n = hash(Math.floor(dx / Math.max(1, s * 0.8)), Math.floor(dy / Math.max(1, s * 0.8)), 9);
        if (n > 0.86) {
          pal = P_ORE;
          tn = 5;
        }
      }
      if (pal < 0) continue;
      if (vis < 1 && !dith(px, py, vis)) continue;
      const i = py * f.w + px;
      const d = sd + 2 * RR;
      if (d <= f.zb[i]) continue;
      f.zb[i] = d;
      f.pal[i] = pal;
      f.tone[i] = Math.max(0, Math.min((pal === P_ORE ? NO : NR) - 1, tn));
      f.idb[i] = -2;
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
      if (pl !== P_FUR && pl !== P_PINK && pl !== P_HAT && pl !== P_LEATH && pl !== P_DIRT)
        continue;
      for (const j of [i + w, i + 1]) {
        if (pal[j] === pl && idb[j] === idb[i] && tone[j] === tone[i] - 1 && dith(x, y, 0.28))
          hit.push(j, tone[i]);
      }
    }
  for (let n = 0; n < hit.length; n += 2) f.tone[hit[n]] = hit[n + 1];
}

/** Пятно света фонаря на куче: земля светлеет (до вывода в цвет). */
function lightPool(f: Frame, c: Ctx): void {
  const { o } = c;
  if (o.beam <= 0.05 || o.heap <= 0.01) return;
  const [tx, ty] = scr(beamTarget(c));
  const rx = (HI ? 13 : 6) * (0.6 + 0.4 * o.hp);
  const ry = (HI ? 6 : 3) * (0.6 + 0.4 * o.hp);
  for (let y = Math.floor(ty - ry); y <= Math.ceil(ty + ry); y++)
    for (let x = Math.floor(tx - rx); x <= Math.ceil(tx + rx); x++) {
      if (x < 0 || y < 0 || x >= f.w || y >= f.h) continue;
      const i = y * f.w + x;
      if (f.pal[i] !== P_DIRT) continue;
      const d = ((x + 0.5 - tx) / rx) ** 2 + ((y + 0.5 - ty) / ry) ** 2;
      if (d >= 1) continue;
      const inc = d < 0.35 ? 2 : 1;
      if (o.beam < 0.5 && !dith(x, y, o.beam * 2)) continue;
      f.tone[i] = Math.min(PAL[P_DIRT].length - 1, f.tone[i] + inc);
    }
}

function toRes(parts: PartF[]): PartF[] {
  if (RR === 1) return parts;
  return parts.map((pt) => ({ ...pt, c: mul(pt.c, RR), r: mul(pt.r, RR) }));
}

// ---------------------------------------------------------------------------
// Поверх кадра: глазки, ноздри, рот, усы, свет фонаря, комья, блики, сон.
// ---------------------------------------------------------------------------

function eyePal(): Record<string, RGBA> {
  return {
    K: INK_V[V],
    W: hx('#ffffff'),
    d: V === 1 ? hx('#8a5a1c') : hx('#6e6462'),
    k: PAL[P_FUR][3],
    l: V === 1 ? hx('#4a2c0c') : hx('#bdb2aa'),
  };
}
// Малая: бусина 2×2 с бликом.
const EYES_S: Record<string, string[]> = {
  open: ['WK', 'KK'],
  half: ['..', 'KK'],
  shut: ['..', 'll'],
  sleep: ['..', 'll'],
  squint: ['..', 'll'],
  happy: ['.l.', 'l.l'],
  wide: ['WKK', 'KKK'],
  angry: ['K.', 'WK'],
};
// Крупная: бусина 4×4 с бликом и отсветом.
const EYES_L: Record<string, string[]> = {
  open: ['.KK.', 'KWKK', 'KKKd', '.KK.'],
  half: ['....', 'kkkk', 'KKKd', '.KK.'],
  shut: ['....', '....', 'l..l', '.ll.'],
  sleep: ['....', '....', 'l..l', '.ll.'],
  happy: ['....', '.ll.', 'l..l', '....'],
  squint: ['....', 'llll', '.KK.', '....'],
  wide: ['.KKK.', 'KWKKK', 'KWKKK', 'KKKKd', '.KKK.'],
  angry: ['K...', 'KKK.', 'KWKK', '.KKd'],
};
/** У этих глаз стороны разные (наклон века); у круглых блик слева у обоих — свет один. */
const EYE_FLIP = new Set(['angry']);

function face(p: Px, f: Frame, c: Ctx): void {
  const { o, h } = c;
  const ep = eyePal();
  for (const side of [-1, 1] as const) {
    const at = seen(f, mul(h.at([side * 3.0, 5.6, 0.7]), RR), OX, OY, 2.4 * RR);
    if (!at) continue;
    let key: string = o.eye;
    if (key === 'open' || key === 'angry' || key === 'wide') {
      if (o.blink > 0.7) key = 'shut';
      else if (o.blink > 0.25) key = 'half';
    }
    const rows = HI ? EYES_L[key] : EYES_S[key];
    const flip = side > 0 && EYE_FLIP.has(key);
    stamp(p, rows, ep, at[0] - (rows[0].length >> 1), at[1] - (rows.length >> 1), flip);
  }
  // Ноздри на кончике носа (малая — одна тёмная точка).
  const sn = o.sniff;
  const wg = o.wig;
  const nose = PAL[P_PINK];
  if (HI) {
    for (const side of [-1, 1]) {
      const at = seen(
        f,
        mul(h.at([wg * 0.55 + side * 0.8, 9.75, -2.25 + 0.45 * sn]), RR),
        OX,
        OY,
        1.6 * RR,
      );
      if (at) {
        p.set(at[0], at[1], nose[1]);
        p.set(at[0], at[1] + 1, nose[2]);
      }
    }
  } else {
    const at = seen(f, mul(h.at([wg * 0.55, 9.7, -2.5 + 0.45 * sn]), RR), OX, OY, 1.6 * RR);
    if (at) p.set(at[0], at[1], nose[2]);
  }
  if (!HI) return;
  // Усы: по три с каждой стороны от носа, светлые, чуть вниз.
  const wh = V === 1 ? hx('#fff2c8', 200) : hx('#cfc4bc', 190);
  for (const side of [-1, 1]) {
    const at = seen(f, mul(h.at([side * 1.9 + wg * 0.3, 7.6, -1.9]), RR), OX, OY, 2.2 * RR);
    if (!at) continue;
    for (const [dy, len] of [
      [-1.2, 9],
      [0.3, 10],
      [1.8, 8],
    ]) {
      for (let s = 2; s <= len; s++) {
        const X = at[0] + side * s;
        const Y = Math.round(at[1] + dy * (s / len) * 1.6 + (s * s) / 60);
        p.set(X, Y, s > len - 2 ? [wh[0], wh[1], wh[2], 110] : wh);
      }
    }
  }
  // Рот (крупная): под носом «v» и уголки.
  if (o.jaw < 0.1) {
    const ink = mixc(PAL[P_FUR][1], INK_V[V], 0.5);
    const gr = o.grin;
    const pts: V3[] = [
      [0, 7.3, -3.9],
      [-0.6, 7.0, -4.2],
      [0.6, 7.0, -4.2],
      [-1.2, 6.6, -4.1 + 0.35 * gr],
      [1.2, 6.6, -4.1 + 0.35 * gr],
    ];
    for (const q of pts) {
      const at = seen(f, mul(h.at(q), RR), OX, OY, 1.6 * RR);
      if (at) p.set(at[0], at[1], ink);
    }
  }
  // Румянец на щеках.
  const blush = V === 1 ? hx('#f2a878', 200) : hx('#e48a8e', 170);
  for (const side of [-1, 1]) {
    const at = seen(f, mul(h.at([side * 4.4, 5.0, -1.5]), RR), OX, OY, 1.6 * RR);
    if (!at) continue;
    for (let y = 0; y < 2; y++)
      for (let x = -1; x <= 1; x++) if ((x + y) & 1 || x === 0) p.set(at[0] + x, at[1] + y, blush);
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
/** Куда светит фонарь, пока роет: на землю перед лапами. */
function beamTarget(c: Ctx): V3 {
  const g = 0.45 + 0.55 * c.o.hp;
  return [0, HEAP_Y * G + 1.2, HEAP_R[2] * G * g * 0.55];
}

/**
 * Свет фонаря. Фонарь — на лбу каски, СПЕРЕДИ: ореол и конус луча ложатся
 * поверх тела полупрозрачно (нос и лапы под светом видны), за силуэтом —
 * гуще. Конус идёт от стекла к пятну на куче.
 */
function lampFx(p: Px, mask: Uint8Array, c: Ctx): void {
  const { o } = c;
  const [lx, ly] = scr(LAMP_AT);
  if (o.lamp > 0.05) {
    const R = (HI ? 8 : 3.6) * (0.5 + 0.5 * o.lamp);
    const n = Math.ceil(R);
    for (let dy = -n; dy <= n; dy++)
      for (let dx = -n; dx <= n; dx++) {
        const X = Math.floor(lx) + dx;
        const Y = Math.floor(ly) + dy;
        if (X < 0 || Y < 0 || X >= p.w || Y >= p.h) continue;
        const d = Math.hypot(X + 0.5 - lx, Y + 0.5 - ly) / R;
        if (d >= 1) continue;
        const body = mask[Y * p.w + X] ? 0.45 : 1;
        p.set(X, Y, [BEAM[0], BEAM[1], BEAM[2], Math.round(130 * (1 - d) * o.lamp * body)]);
      }
  }
  if (o.beam > 0.02) {
    const [tx, ty] = scr(beamTarget(c));
    const srx = (HI ? 12 : 5.5) * o.beam * (0.6 + 0.4 * o.hp);
    const ax = tx - lx;
    const ay = ty - ly;
    const L = Math.hypot(ax, ay) || 1;
    const ux = ax / L;
    const uy = ay / L;
    const X0 = Math.max(0, Math.floor(Math.min(lx, tx - srx)) - 1);
    const X1 = Math.min(p.w - 1, Math.ceil(Math.max(lx, tx + srx)) + 1);
    const Y0 = Math.max(0, Math.floor(Math.min(ly, ty)) - 1);
    const Y1 = Math.min(p.h - 1, Math.ceil(Math.max(ly, ty)) + 1);
    for (let Y = Y0; Y <= Y1; Y++)
      for (let X = X0; X <= X1; X++) {
        const dx = X + 0.5 - lx;
        const dy = Y + 0.5 - ly;
        const u = (dx * ux + dy * uy) / L;
        if (u <= 0.04 || u > 1) continue;
        const v = Math.abs(dx * uy - dy * ux);
        const half = lerp(0.8, srx, u);
        if (v >= half) continue;
        // Поверх тела — легко (свет прозрачный), над фоном — гуще; к краю мягче.
        const core = v < half * 0.4 ? 1 : 0.7;
        const body = mask[Y * p.w + X] ? 0.75 : 1;
        const a = (95 + 60 * (1 - u)) * core * body * o.beam;
        if (a < 8) continue;
        p.set(X, Y, [BEAM[0], BEAM[1], BEAM[2], Math.round(a)]);
      }
  }
  if (o.click >= 0) {
    const r0 = (HI ? 6 : 3) + o.click * (HI ? 4 : 2);
    const Lr = HI ? 4 : 2;
    const col = hx('#fff4dc');
    for (const a of [-Math.PI / 2 - 0.8, -Math.PI / 2, -Math.PI / 2 + 0.8]) {
      for (let d = 0; d <= Lr; d += 0.5) {
        const X = Math.round(lx + Math.cos(a) * (r0 + d) - 0.5);
        const Y = Math.round(ly + Math.sin(a) * (r0 + d) - 0.5);
        if (X < 0 || Y < 0 || X >= p.w || Y >= p.h || mask[Y * p.w + X]) continue;
        if (!dith(X, Y, 1.2 - o.click)) continue;
        p.set(X, Y, col);
      }
    }
  }
}

/**
 * Комья: каждый гребок срывает три кома с того места на куче, где загребла
 * лапа, и бросает их в сторону этой лапы; упавшие лежат на полу до конца.
 */
const CLODS: V3[] = [
  [24, 2, 15],
  [31, -2, 10],
  [17, 4, 20],
];
const GRAV = 120;
function clods(p: Px, c: Ctx): void {
  const { o, t } = c;
  if (c.a !== 'work' || o.heap <= 0.01) return;
  const dk = PAL[P_DIRT];
  for (const [th, s] of THROWS) {
    const dt = t - th;
    if (dt <= 0) continue;
    // Откуда: то место кучи, где рыла лапа этой стороны.
    const src = digSpot(s, o.hp);
    CLODS.forEach((v, n) => {
      const vz = v[2];
      const land = (vz + Math.sqrt(vz * vz + 2 * GRAV * src[2])) / GRAV;
      const tt = Math.min(dt, land);
      const q: V3 = [
        src[0] + s * v[0] * tt,
        src[1] + v[1] * tt,
        Math.max(0, src[2] + vz * tt - 0.5 * GRAV * tt * tt),
      ];
      const [x, y] = scr(q);
      const X = Math.round(x);
      const Y = Math.round(y);
      const sz = HI ? (n === 1 ? 2 : 3) : n === 2 ? 1 : 2;
      const lying = dt >= land;
      for (let yy = 0; yy < sz; yy++)
        for (let xx = 0; xx < sz; xx++) {
          if (lying && yy === 0 && sz > 1 && (xx === 0 || xx === sz - 1)) continue;
          if (o.heap < 1 && !dith(X + xx, Y + yy, o.heap)) continue;
          const tn = yy === 0 ? (xx === 0 ? 6 : 5) : yy === sz - 1 ? 2 : 4;
          p.set(X + xx - (sz >> 1), Y + yy - (sz >> 1), dk[tn]);
        }
    });
  }
}

/** Блик на руде (находка — малый, в лапах — крупный). */
function oreFx(p: Px, c: Ctx): void {
  const { o } = c;
  if (o.glint <= 0.05 || o.ore < 0) return;
  const q = oreAt(c);
  const [x, y] = scr(add(q, [-0.9 * G, 0, 1.9 * G]));
  const L = Math.round(o.glint * (HI ? 6 : 3));
  if (L >= 1) star(p, Math.round(x), Math.round(y), L, hx('#ffffff'), hx('#c8f4ff', 230));
}

/** Хлопок: короткие светлые штрихи по бокам от сомкнутых лап — по пустому. */
function clapFx(p: Px, mask: Uint8Array, c: Ctx): void {
  const { o, S } = c;
  if (o.clap < 0) return;
  const mid = mul(add(S.paw[0], S.paw[1]), 0.5);
  const [cx, cy] = scr(add(mid, mul([0, 0, 2.2], S.k)));
  const col = hx('#fff4dc');
  const r0 = (HI ? 9 : 5) + o.clap * (HI ? 6 : 3);
  const Lr = HI ? 4 : 2;
  for (const a of [-2.5, -1.95, -1.2, -0.64]) {
    for (let d = 0; d <= Lr; d += 0.5) {
      const X = Math.round(cx + Math.cos(a) * (r0 + d) - 0.5);
      const Y = Math.round(cy + Math.sin(a) * (r0 + d) - 0.5);
      if (X < 0 || Y < 0 || X >= p.w || Y >= p.h || mask[Y * p.w + X]) continue;
      if (!dith(X, Y, 1.2 - o.clap)) continue;
      p.set(X, Y, col);
    }
  }
}

/** Следы когтей: три дуги у каждой лапы — только по пустому, лицо не перечёркивают. */
function swipeFx(p: Px, mask: Uint8Array, c: Ctx): void {
  const { o, S } = c;
  const u = o.swipe;
  const col = hx('#fff4dc');
  const dim = hx('#f0c070', 220);
  const vis = u < 0.55 ? 1.1 : (1 - u) / 0.45;
  const span = Math.min(1, u * 1.8);
  for (const j of [0, 1]) {
    const side = j === 0 ? -1 : 1;
    const [cx, cy] = scr(S.sh[j]);
    for (let n = 0; n < 3; n++) {
      const R = (10.5 + n * 1.6) * RR * S.k;
      const a0 = -1.25;
      const a1 = a0 + 2.0 * span;
      for (let a = a0; a <= a1; a += 0.5 / R) {
        const ang = side > 0 ? a : Math.PI - a;
        const x = Math.round(cx + Math.cos(ang) * R);
        const y = Math.round(cy + Math.sin(ang) * R);
        if (x < 0 || y < 0 || x >= p.w || y >= p.h || mask[y * p.w + x]) continue;
        const tail = (a - a0) / Math.max(1e-3, a1 - a0);
        if (!dith(x, y, vis * (0.35 + 0.75 * tail))) continue;
        p.set(x, y, tail > 0.55 ? col : dim);
      }
    }
  }
}

/** Сон: буквы «z» поднимаются из-под каски и тают. */
const Z_S = ['zzz', '.z.', 'zzz'];
const Z_L = ['zzzz', '..z.', '.z..', 'zzzz'];
function zzz(p: Px, mask: Uint8Array, c: Ctx): void {
  const { h, t } = c;
  const col = hx('#f4ead8');
  for (let j = 0; j < 2; j++) {
    const u = wrap(t / 1.5 + j * 0.5, 1);
    const [x0, y0] = scr(h.at([6.5 + 3.5 * u, 0, 7 + 9 * u]));
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
export function moleFrame(a: Anim, i: number, res: Res = 's', v = 0): Px {
  const cv = RES[res];
  RR = cv.box / RES.s.box;
  HI = res === 'l';
  OX = cv.bx + cv.box / 2;
  OY = cv.by + GROUND * RR;
  V = v === 1 ? 1 : 0;
  NEXT_ID = 1;
  const t = i / FPS;
  const o = poseAt(a, t);
  const S = skel(o);
  const lag = lagOf(a, t);
  const c: Ctx = { a, o, S, h: headF(o, S, lag), lag, t };
  PAL = PAL_V[V];
  const f = newFrame(cv.cw, cv.ch);
  const parts: PartF[] = [];
  const rods: Rod[] = [];
  legs(parts, rods, c);
  torso(parts, c);
  arms(parts, rods, c);
  headParts(parts, c);
  if (o.heap > 0.01) heapParts(parts, c);
  drawPartsF(f, toRes(parts), PAL, OX, OY);
  for (const r of rods) rodF(f, r);
  if (o.ore >= 0.01) oreDraw(f, oreAt(c), o.ore);
  seams(f, 1.2 * RR, 1);
  rimLight(
    f,
    PAL,
    (pl) =>
      pl !== P_MOUTH && pl !== P_GLASS && pl !== P_LIT && pl !== P_ORE && pl !== P_CLAW,
  );
  lightPool(f, c);
  if (HI) softBands(f);
  const p = toPx(f, PAL);
  selOutline(p, INK_V[V], 0.8);
  const mask = new Uint8Array(p.w * p.h);
  for (let j = 0; j < mask.length; j++) mask[j] = p.data[j * 4 + 3] > 0 ? 1 : 0;
  face(p, f, c);
  clods(p, c);
  lampFx(p, mask, c);
  oreFx(p, c);
  if (o.clap >= 0) clapFx(p, mask, c);
  if (o.swipe >= 0) swipeFx(p, mask, c);
  if (a === 'sleep') zzz(p, mask, c);
  return p;
}
