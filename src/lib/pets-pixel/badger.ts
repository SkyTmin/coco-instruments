// Барсук-проходчик — пиксельный питомец по эталону боссов 12–14.
//
// Коренастый серый барсук стоит на двух лапах и смотрит на нас: барсучья
// морда — белая полоса посередине от носа до макушки, чёрные полосы через
// глаза к ушам, белые щёки, маленькие круглые уши с белой каймой, тёмный
// нос. Оранжевая каска с очками, сдвинутыми на неё; распахнутый брезентовый
// жилет с накладными карманами и карандашом в нагрудном; чёрные руки и
// ноги, длинные костяные когти. Проходчик — крепкий и надёжный, но милый.
//
// Две полосы, у каждой свой рисунок: малая — рамка 48 (шахта, списки),
// крупная — рамка 112 (карточка, вылупление, Питомник): ткань жилета в
// рубчик и строчка по кромке, клапаны карманов с латунными пуговицами,
// гребень каски, оправа и стёкла очков, белки глаз, ноздри, рот, румянец.
//
// Анимации 24 к/с по ключам (`kf`): подготовка → разгон → пик → проводка
// → возврат. Голова, каска, жилет, карандаш и хвост — с запаздыванием
// (`spring`). Трюк: кайлом дважды бьёт в камень перед собой, камень
// трескается, выскакивает кристалл — барсук ловит его и поднимает к свету;
// очки и кристалл вспыхивают, реквизит тает.
//
// Золотой рисуется здесь же (`v` = 1) своими палитрами: мех — золото с
// бронзовой глубиной, чёрные полосы — тёмная бронза, белое — бледное
// золото; каска, когти и глаза читаются.

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
const P_BLK = 1;
const P_WHT = 2;
const P_HAT = 3;
const P_VEST = 4;
const P_BRASS = 5;
const P_GLASS = 6;
const P_CLAW = 7;
const P_NOSE = 8;
const P_MOUTH = 9;
const P_WOOD = 10;
const P_STEEL = 11;
const P_ROCK = 12;
const P_GEM = 13;
const P_PEN = 14;

const GLASS = ramp('#1e3434', '#2e5452', '#4a7e78', '#73aba2', '#a3d2c8', '#d2eee4', '#fbfff6');
const NOSE = ramp('#080606', '#121010', '#1e1a1a', '#2c2626', '#3e3636', '#5e5252');
const MOUTH = ramp('#24070a', '#45111a', '#6e2228', '#9a3c40', '#d06a6a', '#ee8f8a');
const WOOD = ramp(
  '#2a180a',
  '#422810',
  '#5c3a18',
  '#7a5024',
  '#966834',
  '#b28248',
  '#cc9e64',
  '#e2bc88',
);
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
const GEM = ramp(
  '#1e0a38',
  '#341258',
  '#4e1e80',
  '#6c32a8',
  '#8c4ccc',
  '#ad6ee6',
  '#c996f4',
  '#e2c0fa',
  '#f8eaff',
);
const PEN = ramp('#5a3a08', '#86580e', '#b27c16', '#d6a020', '#ecbc3c', '#f8d66c', '#fff0aa');

const PAL_V: RGBA[][][] = [
  [
    // Серый мех: тёплая тень → серый → светлые кончики.
    ramp(
      '#141211',
      '#1f1c1a',
      '#2b2725',
      '#383331',
      '#46403d',
      '#55504b',
      '#66605a',
      '#787169',
      '#8a837b',
      '#9e978e',
      '#b3aca2',
      '#c9c3b9',
    ),
    // Чёрный мех (полосы, руки, ноги, уши): не уголь — форма читается.
    ramp(
      '#0b0909',
      '#121010',
      '#1a1716',
      '#221e1d',
      '#2b2624',
      '#352f2c',
      '#403835',
      '#4c4440',
      '#5a514c',
    ),
    // Белый мех: полоса, щёки, морда, кайма ушей.
    ramp(
      '#4a4642',
      '#68635d',
      '#8a847c',
      '#aaa49a',
      '#c4beb4',
      '#d8d3ca',
      '#e8e4dc',
      '#f4f1ea',
      '#fffdf8',
    ),
    // Оранжевая каска.
    ramp(
      '#3a1505',
      '#5a220a',
      '#7c3210',
      '#a04418',
      '#c2561f',
      '#dc6a26',
      '#ec8336',
      '#f5a058',
      '#fbc286',
      '#fee2bc',
    ),
    // Брезент жилета.
    ramp(
      '#221d12',
      '#30291a',
      '#413823',
      '#54492e',
      '#675a39',
      '#7a6b45',
      '#8e7d53',
      '#a29062',
      '#b6a476',
      '#cbbb92',
    ),
    ramp('#3a250c', '#5a3c14', '#7a5620', '#9c7030', '#bf9044', '#d8ae5e', '#ecca82', '#fae6b0'),
    GLASS,
    ramp('#4e463a', '#776d5c', '#a09480', '#c6baa2', '#e2d8c0', '#f2ead6', '#fffaee'),
    NOSE,
    MOUTH,
    WOOD,
    STEEL,
    ROCK,
    GEM,
    PEN,
  ],
  [
    // Золотой: бронза в тени → золото → бледное золото на свету.
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
    // Чёрные полосы — тёмная бронза.
    ramp(
      '#1a0f04',
      '#28180a',
      '#38230e',
      '#4a3012',
      '#5c3e16',
      '#704e1c',
      '#866024',
      '#9c742e',
      '#b2883a',
    ),
    // Белое — бледное золото.
    ramp(
      '#6a5222',
      '#8c6e30',
      '#ae8e44',
      '#ccad5c',
      '#e2c878',
      '#f0dc96',
      '#f8eab4',
      '#fdf4d0',
      '#fffbea',
    ),
    // Каска краснее: на золотом меху не тонет.
    ramp(
      '#3a0f04',
      '#5c1a08',
      '#80260c',
      '#a43412',
      '#c44418',
      '#de5820',
      '#ee702e',
      '#f88e48',
      '#fdb06e',
      '#ffd29e',
    ),
    // Жилет — бронзовое сукно, темнее меха.
    ramp(
      '#1c1206',
      '#2a1c0a',
      '#3a280e',
      '#4c3614',
      '#5e441a',
      '#725420',
      '#86642a',
      '#9a7636',
      '#ae8a44',
      '#c2a05a',
    ),
    ramp('#3a220a', '#5e3a10', '#84561a', '#aa7626', '#cc9636', '#e6b650', '#f6d47a', '#fff0b8'),
    GLASS,
    ramp('#5a4a34', '#84725a', '#ac9a7c', '#d0c09e', '#ead9b8', '#f6eccf', '#fffaea'),
    NOSE,
    MOUTH,
    WOOD,
    STEEL,
    ROCK,
    GEM,
    PEN,
  ],
];
const INK_V: RGBA[] = [hx('#0a0807'), hx('#1c0e03')];

// ---------------------------------------------------------------------------
// Кадр: холст и рамка тела у двух полос (как у лиса и паука).
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
  /** Весь барсук: сдвиг, прыжок; присед (тело ниже, ступни стоят). */
  x: number;
  y: number;
  z: number;
  cz: number;
  sq: number;
  /** Крен (+ — вправо), наклон вперёд (+), масштаб броска к зрителю. */
  lean: number;
  bow: number;
  scale: number;
  /** Поворот корпуса вокруг вертикали (+ — передом вправо): трюк, замах к камню. */
  yaw: number;
  /** Голова: сдвиг, поворот, кивок (+ — вниз), наклон набок. */
  hx: number;
  hy: number;
  hz: number;
  turn: number;
  nod: number;
  tilt: number;
  /** Пасть: 0 — закрыта, 1 — настежь; улыбка; нос шевелится (нюхает). */
  jaw: number;
  grin: number;
  sniff: number;
  eye: Eye;
  blink: number;
  /** Дёрнуть ухом. */
  earL: number;
  earR: number;
  /** Вдох: грудь и жилет раздуваются. */
  chest: number;
  /** Лапы-руки: сдвиг кисти от места покоя (в теле). */
  aLx: number;
  aLy: number;
  aLz: number;
  aRx: number;
  aRy: number;
  aRz: number;
  /** Ступни: вбок, вперёд и подъём. */
  fLx: number;
  fRx: number;
  fLy: number;
  fLz: number;
  fRy: number;
  fRz: number;
  /** Хвост: вбок, вверх. */
  tailSw: number;
  tailUp: number;
  /** Каска относительно головы: приподнята, сдвинута на глаза (кивок), набок. */
  hatUp: number;
  hatNod: number;
  hatTilt: number;
  /** Сидит (сон): 0 — стоит. */
  sit: number;
  /**
   * Трюк: камень (видимость), трещина (0, 1, 2 — светится), кайло (видимость; направление
   * рукояти от конца — хвата дальней лапы — к головке, в мире; застряло в камне).
   */
  rock: number;
  crack: number;
  pick: number;
  pdx: number;
  pdy: number;
  pdz: number;
  stuck: number;
  /** Кристалл: −1 — нет, иначе видимость; где он (в мире); блик на нём и на очках. */
  gem: number;
  gx: number;
  gy: number;
  gz: number;
  glint: number;
  gog: number;
  /** Удар кайлом: звезда и осколки (0…1 после удара), −1 — нет. */
  hit: number;
  /** Атака: следы когтей (0…1), −1 — нет. */
  swipe: number;
  /** Когти растопырены и вытянуты (атака). */
  claw: number;
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
  yaw: 0,
  hx: 0,
  hy: 0,
  hz: 0,
  turn: 0,
  nod: 0,
  tilt: 0,
  jaw: 0,
  grin: 0.3,
  sniff: 0,
  eye: 'open',
  blink: 0,
  earL: 0,
  earR: 0,
  chest: 0,
  aLx: 0,
  aLy: 0,
  aLz: 0,
  aRx: 0,
  aRy: 0,
  aRz: 0,
  fLx: 0,
  fRx: 0,
  fLy: 0,
  fLz: 0,
  fRy: 0,
  fRz: 0,
  tailSw: 0,
  tailUp: 0,
  hatUp: 0,
  hatNod: 0,
  hatTilt: 0,
  sit: 0,
  rock: 0,
  crack: 0,
  pick: 0,
  pdx: 0,
  pdy: 0,
  pdz: 1,
  stuck: 0,
  gem: -1,
  gx: 0,
  gy: 0,
  gz: 0,
  glint: 0,
  gog: 0,
  hit: -1,
  swipe: -1,
  claw: 0,
};

const loopK = (t: number, T: number, keys: Key[]) => kf(wrap(t, T), keys);
const pos = (v: number) => Math.max(0, v);
const neg = (v: number) => Math.max(0, -v);
const TAU = Math.PI * 2;
const smooth = (u: number) => u * u * (3 - 2 * u);
/** Поворот вокруг вертикали, + — передом вправо. */
const yawZ0 = (p: V3, a: number): V3 => [
  p[0] * Math.cos(a) + p[1] * Math.sin(a),
  -p[0] * Math.sin(a) + p[1] * Math.cos(a),
  p[2],
];

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
// Два плана: стоит и сидит (сон).
// ---------------------------------------------------------------------------

interface Plan {
  hip: V3;
  foot: V3;
  /** Ступня: 0 — на полу, 1 — подошвой к зрителю (сидит, ноги вперёд). */
  sole: number;
  body: V3;
  sh: V3;
  paw: V3;
  head: V3;
  tail: V3[];
}
const STAND: Plan = {
  hip: [4.0, 0, 6.6],
  foot: [4.5, 1.0, 0],
  sole: 0,
  body: [0, 0, 12.6],
  sh: [7.3, 0.4, 17.4],
  paw: [9.9, 2.4, 8.6],
  head: [0, 1.0, 27.0],
  tail: [
    [4.6, -5.0, 5.0],
    [7.6, -6.2, 3.8],
    [9.8, -6.0, 3.4],
    [11.0, -5.2, 4.2],
  ],
};
const SIT: Plan = {
  hip: [4.6, 1.4, 3.4],
  foot: [5.2, 8.2, 0.6],
  sole: 1,
  body: [0, -0.6, 9.4],
  sh: [7.3, -0.2, 14.2],
  paw: [4.4, 6.4, 8.2],
  head: [0, 1.6, 23.2],
  tail: [
    [5.4, -4.6, 1.6],
    [9.0, -4.4, 1.0],
    [11.6, -3.0, 1.0],
    [12.8, -1.4, 1.6],
  ],
};
/** Радиусы туловища (одна часть: жилет и брюхо выбираются по точке). */
const BODY_R: V3 = [8.6, 6.6, 8.3];
/** Длины костей руки и ноги. */
const ARM1 = 5.6;
const ARM2 = 5.2;
const LEG1 = 3.6;
const LEG2 = 3.4;
/** Масштаб модели в рамке: ступни — макушка каски ~42 пикселя малой полосы. */
const G = 1.1;

/** Кисть правой руки в покое (тело) — для пересчёта целей в сдвиг. */
const PAW0 = STAND.paw;

// ---------------------------------------------------------------------------
// Дорожки анимаций.
// ---------------------------------------------------------------------------

/** Покой: дышит, переминается, жилет качается, моргает, принюхивается, оглядывается. */
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
  o.aLz = 0.25 * br;
  o.aRz = 0.25 * br;
  // Переносит вес с ноги на ногу: одна медленная волна на петлю.
  const sw = Math.sin((t / T) * TAU);
  o.x = 0.45 * sw;
  o.lean = 0.03 * sw;
  o.tilt = -0.025 * sw;
  o.aLx = 0.2 * sw;
  o.aRx = -0.2 * sw;
  // Принюхивается: нос дёргается дважды, голова чуть вверх.
  o.sniff = bump(t, 1.05, 1.2) + bump(t, 1.24, 1.39) + 0.6 * bump(t, 1.41, 1.52);
  o.nod = -0.07 * bump(t, 0.98, 1.62);
  // Оглядывается направо и обратно.
  o.turn = loopK(t, T, [
    [0, 0],
    [1.7, 0],
    [1.95, 0.15, 'o'],
    [2.35, 0.15],
    [2.6, 0, 's'],
    [3, 0],
  ]);
  o.blink = Math.max(bump(t, 0.35, 0.5), bump(t, 2.62, 2.76));
  o.earL = bump(t, 2.0, 2.12);
  o.earR = 0.8 * bump(t, 0.7, 0.8);
  o.tailSw = 0.3 * Math.sin((t / T) * TAU * 2);
  return o;
}

/** Ходьба вразвалку к зрителю: ступня в воздухе или стоит — не скользит. */
function walkPose(t: number): Pose {
  const T = dur('walk');
  const o: Pose = { ...REST };
  const h = wrap(t, T);
  const la = bump(h, 0.02, 0.48);
  const lb = bump(h, 0.52, 0.98);
  o.fLz = 2.0 * la ** 0.8;
  o.fLy = 0.7 * la;
  o.fRz = 2.0 * lb ** 0.8;
  o.fRy = 0.7 * lb;
  // Вес — на стоящую ногу: тело над ней и с креном к ней.
  const sw = Math.sin((h / T) * TAU);
  o.x = 1.0 * sw;
  o.lean = 0.09 * sw;
  o.cz = 0.5 - 0.6 * Math.abs(sw);
  o.tilt = -0.07 * sw;
  o.nod = 0.05 + 0.03 * Math.cos((h / T) * 2 * TAU);
  // Руки — против ног.
  o.aRy = 1.5 * sw;
  o.aLy = -1.5 * sw;
  o.aRz = 0.7 * pos(sw);
  o.aLz = 0.7 * neg(sw);
  o.aLx = 0.5;
  o.aRx = 0.5;
  o.chest = 0.3;
  o.tailSw = -0.8 * sw;
  return o;
}

/** Радость: два подскока, когти вверх, каска подпрыгивает следом. */
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
  o.z = 2.8 * up;
  o.cz = 1.1 * neg(rise);
  o.sq = 0.08 * neg(rise) - 0.04 * up;
  o.fLz = 0.8 * up;
  o.fRz = 0.8 * up;
  const arm = kf(t, [
    [0, 0],
    [0.1, 0.25],
    [0.26, 1, 'o'],
    [0.84, 1],
    [1.02, 0, 's'],
  ]);
  const wig = 0.6 * Math.sin(t * TAU * 4) * arm;
  o.aRx = -1.6 * arm + wig;
  o.aLx = -1.6 * arm - wig;
  o.aRy = -1.0 * arm;
  o.aLy = -1.0 * arm;
  o.aRz = 17.5 * arm;
  o.aLz = 17.5 * arm;
  o.nod = -0.12 * up;
  o.tilt = 0.12 * Math.sin((t / T) * TAU) * env;
  o.eye = t < 0.92 ? 'happy' : 'open';
  o.grin = lerp(REST.grin, 1, env);
  o.jaw = 0.4 * env;
  o.chest = 0.6 * env;
  o.tailSw = 0.9 * Math.sin(TAU * 3.5 * t) * env;
  o.tailUp = 0.7 * env;
  return o;
}

/**
 * Трюк (2 с) — замах кайлом двумя лапами, как на фотографиях Мейбриджа «копает
 * киркой»: камень справа, на длину рукояти и руки. Барсук в два шага (с подъёмом
 * ноги, без скольжения) встаёт к нам боком, передом к камню: ноги широко, ближняя
 * (L в коде, анатомически правая) впереди. Дальняя лапа (R) держит конец рукояти,
 * ближняя — выше по рукояти → замах вверх-назад над ближним плечом: ближняя лапа
 * скользит к головке, корпус выпрямляется, откидывается и скручивается назад →
 * удар: ближняя скользит вниз к дальней, кайло идёт дугой, корпус складывается в
 * поясе, колени пружинят, голова уходит за кайлом, остриё входит в верх камня
 * (звезда, осколки, прищур) → второй замах → удар: кайло застряло, трещина
 * светится → барсук отпускает рукоять, кристалл выскакивает из трещины дугой,
 * дальняя лапа ловит его на полуповороте к нам → лицом к нам поднимает к свету:
 * блик на кристалле и на очках → реквизит тает, всё в покой.
 */
const HIT1 = 0.5;
const HIT2 = 1.0;
const POP = 1.1;
const CATCH = 1.32;
/** Кайло (единицы модели, ×k): рукоять от конца (хват дальней лапы) до головки, полуширина головки, загиб зубьев. */
const HANDLE = 12.5;
const HEAD_W = 2.6;
const HEAD_B = 0.7;
/** Удар идёт вправо, почти в плоскости кадра; корпус — боком к зрителю (профиль). */
const PSI = 1.42;
const YAW = 1.3;
/** Удар: наклон в поясе, присед, рукоять к земле (рад, вниз). */
const BOW_HIT = 0.5;
const CZ_HIT = 1.2;
const A_HIT = -0.62;
/** Хват при ударе: от середины плеч вперёд по плоскости и вниз (мир). */
const REACH_F = 7.0;
const REACH_Z = 0.8;
/** …и чуть к нам, к ближнему плечу: ближняя рука вытянута почти до конца. */
const REACH_N = 0.7;

const SW_D: V3 = [Math.sin(PSI), Math.cos(PSI), 0];
/** Вбок от плоскости замаха — от нас, к дальнему плечу. */
const SW_L: V3 = [Math.cos(PSI), -Math.sin(PSI), 0];
/** Плоскость замаха → мир: [вдоль к камню, вбок к дальнему плечу, вверх]. */
const sw3 = (v: V3): V3 => add(mul(SW_D, v[0]), add(mul(SW_L, v[1]), [0, 0, v[2]]));
/** Рукоять в миг удара и куда головка шла бы дальше: зуб смотрит по ходу удара. */
const D_HIT: V3 = add(mul(SW_D, Math.cos(A_HIT)), [0, 0, Math.sin(A_HIT)]);
const D_ON: V3 = add(mul(SW_D, Math.cos(A_HIT - 0.9)), [0, 0, Math.sin(A_HIT - 0.9)]);

/** Оси кайла: рукоять `d` и ведущий зуб `n` — поперёк рукояти по ходу удара. */
function pickAxes(dir: V3): [V3, V3] {
  const d = norm(dir);
  const n = norm(sub(D_ON, mul(d, dot(D_ON, d))));
  return [d, n];
}
/** Остриё ведущего зуба от хвата (конца рукояти). */
function pickTip(B: V3, dir: V3, k: number): V3 {
  const [d, n] = pickAxes(dir);
  return add(B, add(mul(d, (HANDLE - HEAD_B) * k), mul(n, HEAD_W * k)));
}

/** Точка мира → координаты тела позы (обратное к `skel().up`): лапа тянется к рукояти. */
function toBody(o: Pose, p: V3): V3 {
  const s = o.scale * G;
  let q = mul(sub(p, [o.x, o.y, o.z - o.cz]), 1 / s);
  q = rollY(q, -o.lean, [0, 0, 0]);
  if (o.yaw) q = yawZ0(q, -o.yaw);
  q = pitchX(q, -o.bow, [0, 0, 4]);
  return [q[0] / (1 + o.sq * 0.5), q[1] / (1 + o.sq * 0.4), q[2] / (1 - o.sq)];
}

export interface HitGeo {
  /** Конец рукояти (хват дальней лапы) в миг удара (мир). */
  B: V3;
  /** Остриё в камне — место удара. */
  T: V3;
  /** Камень: центр и радиусы (мир). */
  rc: V3;
  rr: V3;
  /** Трещина спереди сверху: отсюда выскакивает кристалл. */
  crack: V3;
}
let HIT_G: HitGeo | null = null;
/** Геометрия удара от позы удара: камень кладётся туда, куда достаёт кайло. */
export function hitGeo(): HitGeo {
  if (HIT_G) return HIT_G;
  const S = skel({ ...REST, bow: BOW_HIT, cz: CZ_HIT, yaw: YAW });
  const mid = mul(add(S.sh[0], S.sh[1]), 0.5);
  const B = add(mid, add(mul(SW_D, REACH_F), add(mul(SW_L, -REACH_N), [0, 0, -REACH_Z])));
  const T = pickTip(B, D_HIT, G);
  const rr: V3 = mul([5.4, 4.6, 4.8], G);
  // Остриё входит в верх камня ближе к барсуку, чуть ниже макушки.
  const rc: V3 = [T[0] + SW_D[0] * 1.2, T[1] + SW_D[1] * 1.2, T[2] + 0.5 - rr[2]];
  const crack: V3 = add(rc, [-0.1 * rr[0], 0.72 * rr[1], 0.42 * rr[2]]);
  HIT_G = { B, T, rc, rr, crack };
  return HIT_G;
}

/**
 * Замах по ключам (в плоскости замаха: вдоль к камню, вбок к дальнему плечу, вверх): время;
 * конец рукояти (хват дальней лапы) — сдвиг от него же в миг удара; направление рукояти к головке.
 */
type Ease = 'i' | 'o' | 'l' | 's';
type SwingKey = [number, V3, V3, Ease?];
/** Верх замаха: кисти у ближнего плеча под щекой, кайло вверх-назад за голову. */
const TOP_B: V3 = [-18.5, -0.9, 6.6];
const TOP_D: V3 = [-0.84, -0.2, 0.52];
const TOP2_D: V3 = [-0.9, -0.2, 0.44];
/** Середина удара: кисти под подбородком, кайло вперёд-вверх. */
const MID_B: V3 = [-7.0, -1.2, 3.4];
const MID_D: V3 = [0.71, 0, 0.7];
const SWING: SwingKey[] = [
  [0, [-7.4, -2.0, -0.4], [0.86, 0, -0.5]],
  [0.18, [-7.0, -1.8, -0.6], [0.86, 0, -0.5], 'o'],
  [0.4, TOP_B, TOP_D, 'o'],
  [0.44, add(TOP_B, [-0.4, 0, 0.2]), TOP2_D],
  [0.475, MID_B, MID_D, 'i'],
  [HIT1, [0, 0, 0], [Math.cos(A_HIT), 0, Math.sin(A_HIT)], 'i'],
  [0.56, [-0.5, 0, 1.0], [0.86, 0, -0.42], 'o'],
  [0.66, [-6.0, -1.0, 2.5], [0.9, 0, 0.1]],
  [0.88, TOP_B, TOP_D, 'o'],
  [0.92, add(TOP_B, [-0.4, 0, 0.2]), TOP2_D],
  [0.975, MID_B, MID_D, 'i'],
  [HIT2, [0, 0, 0], [Math.cos(A_HIT), 0, Math.sin(A_HIT)], 'i'],
];
const SLIDE: Key[] = [
  [0, 4.4],
  [0.18, 4.4],
  [0.4, 4.8, 'o'],
  [0.44, 4.8],
  [0.475, 3.2, 'i'],
  [HIT1, 1.3, 'i'],
  [0.56, 1.5],
  [0.66, 3.4],
  [0.88, 4.8, 'o'],
  [0.92, 4.8],
  [0.975, 3.2, 'i'],
  [HIT2, 1.3, 'i'],
];
function swingAt(t: number): { B: V3; d: V3; slide: number } {
  const ch = (f: (r: SwingKey) => number) =>
    kf(
      t,
      SWING.map((r) => [r[0], f(r), r[3]] as Key),
    );
  return {
    B: add(hitGeo().B, sw3([ch((r) => r[1][0]), ch((r) => r[1][1]), ch((r) => r[1][2])])),
    d: norm(sw3([ch((r) => r[2][0]), ch((r) => r[2][1]), ch((r) => r[2][2])])),
    slide: kf(t, SLIDE),
  };
}
/** Кристалл в дальней лапе (R): чуть впереди и выше кисти (мир). */
const GEM_ON: V3 = [0.2, 0.9, 2.6];

/** Лапу в точку мира: сдвиг кисти от места покоя (в теле). */
function reach(o: Pose, j: 0 | 1, w: V3): void {
  const q = toBody(o, w);
  if (j === 0) {
    o.aLx = -q[0] - PAW0[0];
    o.aLy = q[1] - PAW0[1];
    o.aLz = q[2] - PAW0[2];
  } else {
    o.aRx = q[0] - PAW0[0];
    o.aRy = q[1] - PAW0[1];
    o.aRz = q[2] - PAW0[2];
  }
}

function workPose(t: number): Pose {
  const o: Pose = { ...REST };
  const H = hitGeo();
  o.rock = kf(t, [
    [0, 0],
    [0.16, 1, 'l'],
    [1.72, 1],
    [1.92, 0, 'l'],
  ]);
  o.pick = kf(t, [
    [0, 0],
    [0.04, 0],
    [0.18, 1, 'l'],
    [1.72, 1],
    [1.92, 0, 'l'],
  ]);
  // Стойка: поворот боком — двумя шагами с подъёмом ноги (не скользит): ближняя (L) вперёд и к нам,
  // дальняя (R) назад и от нас; обратно так же.
  const stL = kf(t, [
    [0, 0],
    [0.03, 0],
    [0.16, 1, 'o'],
    [1.44, 1],
    [1.66, 0, 's'],
  ]);
  const stR = kf(t, [
    [0, 0],
    [0.1, 0],
    [0.24, 1, 'o'],
    [1.52, 1],
    [1.76, 0, 's'],
  ]);
  o.fLx = 6.3 * stL;
  o.fLy = 2.6 * stL;
  o.fRx = -5.8 * stR;
  o.fRy = -3.4 * stR;
  o.fLz = 1.4 * (bump(t, 0.03, 0.16) + bump(t, 1.44, 1.66));
  o.fRz = 1.2 * (bump(t, 0.1, 0.24) + bump(t, 1.52, 1.76));
  // Корпус: поворот к камню, в замахе — скрутка дальше; удар — складка в поясе и присед.
  o.yaw = kf(t, [
    [0, 0],
    [0.02, 0],
    [0.24, YAW],
    [0.4, YAW - 0.3, 'o'],
    [0.44, YAW - 0.32],
    [HIT1, YAW, 'i'],
    [0.66, YAW - 0.05],
    [0.88, YAW - 0.3, 'o'],
    [0.92, YAW - 0.32],
    [HIT2, YAW, 'i'],
    [POP, YAW],
    [CATCH, 0.8],
    [1.52, 0.2, 'o'],
    [1.76, 0.12],
  ]);
  o.bow = kf(t, [
    [0, 0],
    [0.18, 0.2, 'o'],
    [0.4, -0.05, 'o'],
    [0.44, -0.06],
    [HIT1, BOW_HIT, 'i'],
    [0.56, BOW_HIT - 0.04, 'o'],
    [0.66, 0.2],
    [0.88, -0.05, 'o'],
    [0.92, -0.06],
    [HIT2, BOW_HIT, 'i'],
    [1.06, BOW_HIT - 0.05, 'o'],
    [POP, BOW_HIT - 0.06],
    [1.2, 0.24, 'o'],
    [CATCH, 0.12, 'o'],
    [1.52, -0.06, 'o'],
    [1.76, -0.06],
  ]);
  o.cz = kf(t, [
    [0, 0],
    [0.18, 0.5, 'o'],
    [0.4, -0.3, 'o'],
    [0.44, -0.3],
    [HIT1, CZ_HIT, 'i'],
    [0.56, CZ_HIT - 0.2, 'o'],
    [0.66, 0.5],
    [0.88, -0.3, 'o'],
    [0.92, -0.3],
    [HIT2, CZ_HIT, 'i'],
    [1.06, CZ_HIT - 0.25, 'o'],
    [POP, CZ_HIT - 0.3],
    [1.2, 0.6, 'o'],
    [CATCH, 0.2, 'o'],
    [1.52, -0.2, 'o'],
    [1.76, 0],
  ]);
  o.lean = kf(t, [
    [0, 0],
    [0.18, 0.03],
    [0.4, -0.06, 'o'],
    [HIT1, 0.05, 'i'],
    [0.66, 0.02],
    [0.88, -0.06, 'o'],
    [HIT2, 0.05, 'i'],
    [POP, 0],
  ]);
  o.sq = 0.06 * Math.max(bump(t, HIT1 - 0.02, HIT1 + 0.1), bump(t, HIT2 - 0.02, HIT2 + 0.1));
  // Кайло: до удара 2 — в лапах по ключам; после — стоит в камне как вошло.
  const sw = swingAt(Math.min(t, HIT2));
  o.pdx = sw.d[0];
  o.pdy = sw.d[1];
  o.pdz = sw.d[2];
  o.stuck = t >= HIT2 ? 1 : 0;
  o.crack = t >= HIT2 ? (t >= HIT2 + 0.03 && t < POP + 0.08 ? 2 : 1) : 0;
  o.hit =
    t >= HIT1 && t < HIT1 + 0.16
      ? (t - HIT1) / 0.16
      : t >= HIT2 && t < HIT2 + 0.16
        ? (t - HIT2) / 0.16
        : -1;
  // Лапы на рукояти. Барсук стоит к нам боком, передом вправо: лапа кадра-справа (+x, `paw[1]`)
  // — дальняя, держит конец рукояти; лапа −x (`paw[0]`) — ближняя, по-настоящему его ПРАВАЯ,
  // скользит: к головке в замахе, вниз к дальней на ударе. Замах — над ближним (правым) плечом.
  const d = sw.d;
  const farW = add(sw.B, mul(d, 0.2 * G));
  const nearW = add(sw.B, mul(d, sw.slide * G));
  const grab = kf(t, [
    [0, 0],
    [0.02, 0],
    [0.18, 1, 'o'],
  ]);
  const rel = kf(t, [
    [0, 0],
    [POP - 0.02, 0],
    [POP + 0.08, 1, 'o'],
  ]);
  const rest = skel({ ...o, aLx: 0, aLy: 0, aLz: 0, aRx: 0, aRy: 0, aRz: 0 });
  // Дальняя (+x) после рывка: к кристаллу (ловит), потом вверх к свету.
  const up0 = rest.up([PAW0[0] - 0.2, PAW0[1] - 0.6, 26.4]);
  const catchW = add(H.crack, [-2.2, 1.6, 9.0]);
  const Rfree: V3 =
    t < CATCH
      ? lerp3(farW, catchW, smooth(clamp01((t - POP + 0.02) / (CATCH - POP + 0.02))))
      : lerp3(catchW, up0, smooth(clamp01((t - CATCH) / 0.2)));
  // Ближняя отпускает и сжимает кулак у пояса.
  const Lfree = rest.up([-PAW0[0] - 0.6, PAW0[1] + 2.0, PAW0[2] + 3.6]);
  reach(o, 0, lerp3(lerp3(rest.paw[0], nearW, grab), Lfree, rel));
  reach(o, 1, lerp3(lerp3(rest.paw[1], farW, grab), Rfree, rel));
  // Кристалл: из трещины дугой в дальнюю лапу, потом в лапе.
  if (t >= POP) {
    o.gem = kf(t, [
      [POP, 0.4],
      [POP + 0.04, 1],
      [1.72, 1],
      [1.92, 0, 'l'],
    ]);
    let g: V3;
    if (t < CATCH) {
      const u = (t - POP) / (CATCH - POP);
      g = lerp3(H.crack, add(catchW, GEM_ON), u);
      g[2] += 10 * u * (1 - u);
    } else g = add(catchW, GEM_ON);
    o.gx = g[0];
    o.gy = g[1];
    o.gz = g[2];
  }
  o.glint = bump(t, 1.5, 1.74);
  o.gog = bump(t, 1.56, 1.76);
  // Голова: корпус боком, морда — на три четверти к нам; на ударе уходит за кайлом вниз.
  o.turn = kf(t, [
    [0, 0],
    [0.02, 0],
    [0.24, -0.32],
    [0.4, -0.36],
    [HIT1, -0.26, 'i'],
    [0.88, -0.36],
    [HIT2, -0.26, 'i'],
    [POP, -0.24],
    [CATCH, -0.1],
    [1.52, 0.1, 'o'],
    [1.76, 0.12],
  ]);
  o.nod = kf(t, [
    [0, 0],
    [0.18, 0.1, 'o'],
    [0.4, -0.06],
    [HIT1, 0.0, 'i'],
    [0.66, 0.08],
    [0.88, -0.06],
    [HIT2, 0.0, 'i'],
    [POP, -0.04],
    [1.24, -0.2, 'o'],
    [CATCH, 0.02],
    [1.52, -0.3, 'o'],
    [1.76, -0.3],
  ]);
  const hold = kf(t, [
    [0, 0],
    [1.36, 0],
    [1.52, 1, 'o'],
    [1.76, 1],
  ]);
  o.tilt = 0.08 * hold;
  const imp = (t >= HIT1 - 0.03 && t < HIT1 + 0.08) || (t >= HIT2 - 0.03 && t < HIT2 + 0.08);
  o.eye =
    t >= 1.4 && t < 1.82
      ? 'happy'
      : t >= POP && t < CATCH + 0.02
        ? 'wide'
        : imp || (t >= HIT2 && t < POP)
          ? 'squint'
          : 'open';
  o.jaw = 0.4 * bump(t, POP, CATCH + 0.04) + 0.3 * bump(t, 1.44, 1.84);
  o.grin = REST.grin + 0.7 * bump(t, 1.38, 1.9);
  o.chest = 0.6 * hold;
  o.tailSw = 0.3 * Math.sin(t * TAU * 1.5) * (1 - hold);
  o.tailUp = 0.5 * hold;
  // Камень растаял — реквизит на места покоя.
  if (o.rock < 0.01 && t > 1) {
    o.rock = 0;
    o.pick = 0;
    o.crack = 0;
    o.stuck = 0;
    o.gem = -1;
    o.gx = o.gy = o.gz = 0;
    o.pdx = REST.pdx;
    o.pdy = REST.pdy;
    o.pdz = REST.pdz;
  }
  // Тело и лапы приходят в покой (с 1,7 с, вместе с таянием реквизита — стык мягче); реквизит тает сам.
  const r = settle(o, t, dur('work'), 0.3);
  for (const k of PROPS) (r as unknown as Record<string, number>)[k] = o[k];
  // Пойманный кристалл — в кисти той позы, что рисуется (и когда лапы уже идут в покой).
  if (r.gem >= 0 && t >= CATCH) {
    const g = add(skel(r).paw[1], GEM_ON);
    r.gx = g[0];
    r.gy = g[1];
    r.gz = g[2];
  }
  return r;
}
const PROPS = [
  'rock',
  'crack',
  'pick',
  'pdx',
  'pdy',
  'pdz',
  'stuck',
  'gem',
  'gx',
  'gy',
  'gz',
  'glint',
  'gog',
  'hit',
] as const;

/** Атака: замах обеими лапами → бросок к зрителю, когти и пасть → проводка. */
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
  o.bow = -0.14 * neg(l) + 0.14 * pos(l);
  o.nod = -0.08 * neg(l) - 0.2 * pos(l);
  o.hatNod = -0.12 * neg(l);
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
  // Лапы: вверх-назад-наружу → вперёд-вниз с когтями → накрест внизу → на место.
  const W: V3 = [1.8, -3.6, 14.6];
  const S: V3 = [0.8, 6.8, 11.6];
  const F: V3 = [-5.4, 4.2, 1.6];
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
  o.tailSw = 0.6 * bump(t, 0.3, 0.8);
  o.tailUp = 0.5 * bump(t, 0.1, 0.8);
  o.chest = 0.8 * bump(t, 0.1, 0.5);
  return o;
}

/** Сон: сидит, привалившись; каска съехала на глаза; медленное дыхание. */
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
  o.nod = 0.06 + 0.04 * br;
  o.tilt = 0.14 - 0.02 * br;
  o.hz = 0.15 * br;
  o.hatNod = 0.4;
  o.hatUp = -0.5;
  o.hatTilt = -0.08;
  o.jaw = 0.16 * (1 - br);
  o.aLz = 0.3 * br;
  o.aRz = 0.3 * br;
  o.earL = 0.5 * bump(t, 2.2, 2.34);
  o.tailSw = 0.06 * br;
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
  const m = (key: 'hip' | 'foot' | 'body' | 'sh' | 'paw' | 'head'): V3 =>
    lerp3(STAND[key], SIT[key], k);
  return {
    hip: m('hip'),
    foot: m('foot'),
    sole: lerp(STAND.sole, SIT.sole, k),
    body: m('body'),
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
  /** Туловище: центр, оси, радиусы. */
  bc: V3;
  bax: [V3, V3, V3];
  br: V3;
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
    if (o.yaw) q = yawZ0(q, o.yaw);
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
    bax: o.yaw
      ? axes(rollY(yawZ0([1, 0, 0], o.yaw), o.lean), yawZ0(pitchX([0, 0, 1], o.bow * 0.5), o.yaw))
      : axes(rollY([1, 0, 0], o.lean), pitchX([0, 0, 1], o.bow * 0.5)),
    br: mul([BODY_R[0] * (1 + 0.03 * ch), BODY_R[1] * (1 + 0.05 * ch), BODY_R[2]], s),
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
      [
        -pl.foot[0] * s + o.fLx * G,
        pl.foot[1] * s + o.fLy * G + o.y,
        pl.foot[2] * s + o.fLz * G + lift,
      ],
      [
        pl.foot[0] * s + o.fRx * G,
        pl.foot[1] * s + o.fRy * G + o.y,
        pl.foot[2] * s + o.fRz * G + lift,
      ],
    ],
  };
  // Повёрнутый корпус уносит за собой и направления локтей и коленей.
  const yw = (v: V3): V3 => (o.yaw ? yawZ0(v, o.yaw) : v);
  for (const j of [0, 1]) {
    const side = j === 0 ? -1 : 1;
    // Локоть — наружу и назад.
    const [el, paw] = ik(r.sh[j], r.paw[j], ARM1 * s, ARM2 * s, yw(norm([side, -0.5, -0.4])));
    r.el[j] = el;
    r.paw[j] = paw;
    // Щиколотка над ступнёй (сидит — позади поднятой ступни); колено — вперёд и наружу.
    const ank = add(r.foot[j], mul(lerp3([0, -0.3, 1.5], [0, -1.6, 0.6], pl.sole), s));
    const [kn, an] = ik(r.hip[j], ank, LEG1 * s, LEG2 * s, yw(norm([side * 0.35, 1, 0.2])));
    r.knee[j] = kn;
    r.ank[j] = an;
  }
  return r;
}

/** Точка на поверхности туловища: qx вправо, qz вверх (доли радиусов). */
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
  /** Жилет и карандаш отстают от туловища. */
  vest: number;
  tailSw: number;
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
  const P0 = poseAt('idle', 0);
  const S0 = skel(P0);
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
    hatZ: delta((tt) => sk(tt).head[2], 3.4, 0.2, -0.3, 1.8, L0?.hatZ ?? 0),
    hatR: delta((tt) => sk(tt).head[0], 2.6, 0.2, -1.6, 1.6, L0?.hatR ?? 0),
    vest: delta((tt) => sk(tt).bc[0], 2.0, 0.16, -1.6, 1.6, L0?.vest ?? 0),
    tailSw: lagged((tt) => P(tt).tailSw, 2.2, 0.24, (L0?.tailSw ?? 0) - P0.tailSw),
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
/** Центр полей каски в осях головы. */
const HAT_P: V3 = [0, 0, 4.5];

function headF(o: Pose, S: Skel, lag: Lag): HeadF {
  const nb = o.nod + o.bow;
  const tl = o.tilt + o.lean;
  const dir = (v: V3): V3 => rollY(yawZ0(pitchX(v, nb), o.turn + o.yaw), tl);
  // На малой голова чуть крупнее: глаза, нос и полосы должны поместиться.
  const k = S.k * (HI ? 1.06 : 1.12);
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

/** Часть с выбором палитры по точке на ней (жилет, морда, каска). */
interface PartF extends Part {
  pick?: (qx: number, qy: number, qz: number) => number;
  /** Проявление шахматкой (реквизит тает). */
  vis?: number;
  /** Срез: эту точку части не рисовать (купол каски без нижней половины). */
  cut?: (qx: number, qy: number, qz: number) => boolean;
  /** Не ниже пола (камень). */
  floor?: boolean;
}
/** Сдвиг тона, который `pick` возвращает вместе с палитрой. */
let PICK_T = 0;
let NEXT_ID = 0;
const nid = () => ++NEXT_ID;
/** Распах жилета отстаёт от туловища (доля радиуса). */
let VEST_SW = 0;

/** Прут прямо в кадр (кайло, когти, карандаш). */
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

function legs(out: PartF[], rods: Rod[], c: Ctx): void {
  const { S } = c;
  const k = S.k;
  const sole = S.pl.sole;
  for (const j of [0, 1]) {
    const side = j === 0 ? -1 : 1;
    const lid = nid();
    limb(out, S.hip[j], S.knee[j], 2.5 * k, 2.6 * k, P_BLK, lid, { bias: 0.02 });
    limb(out, S.knee[j], S.ank[j], 2.2 * k, 2.3 * k, P_BLK, lid, { bias: 0.04 });
    // Ступня: длинная, носком к зрителю; сидя — подошвой к зрителю.
    // Носки — за корпусом наполовину: стойка в замахе.
    const fy = (v: V3): V3 => (c.o.yaw ? yawZ0(v, 0.85 * c.o.yaw) : v);
    const fd = fy(norm(lerp3([side * 0.14, 1, 0], [side * 0.12, 0.25, 1], sole)));
    const fu = norm(lerp3([0, 0, 1], [0, 1, -0.2], sole));
    const fax = axes(fd, fu);
    const fc = add(S.foot[j], mul(fy(lerp3([0, 0.9, 1.15], [0, 0.4, 2.5], sole)), k));
    out.push({
      c: fc,
      ax: fax,
      r: [3.1 * k, 2.4 * k, 1.35 * k],
      pal: P_BLK,
      id: lid,
      bias: 0.06,
      tex: toes(HI ? 4 : 3),
    });
    // Когти на пальцах: короткие, вперёд и вниз.
    const tip = add(fc, mul(fax[0], 2.6 * k));
    for (const u of HI ? [-1.1, 0, 1.1] : [-0.85, 0.85]) {
      const b = add(tip, add(mul(fax[1], u * k), mul(fax[2], 0.3 * k)));
      rods.push({
        a: b,
        b: add(b, add(mul(fax[0], 1.3 * k), mul(fax[2], -0.55 * k))),
        w: HI ? 0.8 : 0.5,
        pal: P_CLAW,
        tone: 4,
      });
    }
  }
}

/** Мех на крупной: короткие штрихи сверху вниз (по точке на части — не «кипит»). */
function furTicks(qx: number, qz: number): number {
  const r = Math.floor((qz + 2) * 7);
  const u = (qx + 2) * 8 + (r & 1) * 0.5;
  const fu = u - Math.floor(u);
  const fv = (qz + 2) * 7 - r;
  return fu < 0.22 && fv > 0.35 ? -0.07 : fu > 0.6 && fu < 0.75 && fv < 0.4 ? 0.05 : 0;
}

/**
 * Туловище: распахнутый брезентовый жилет одной частью — в распахе серое
 * брюхо, кромки полочек светлее (крупная — строчка), подол темнее, ниже —
 * серые бёдра; накладные карманы с клапаном и латунной пуговицей, слева
 * нагрудный карман (в нём карандаш); крупная — ткань в рубчик.
 */
function vestPick(qx: number, qy: number, qz: number): number {
  PICK_T = 0;
  const ax0 = Math.abs(qx);
  if (qz > 0.8 && ax0 < 0.42) return P_FUR;
  const hem = -0.56 - 0.1 * (qy > 0 ? clamp01(1 - ax0 / 0.55) : 0);
  if (qz < hem) {
    PICK_T = -0.03 + (HI ? furTicks(qx, qz) : 0);
    return P_FUR;
  }
  const gx = qx - VEST_SW;
  const gw = 0.13 + 0.15 * clamp01((qz + 0.2) / 1.0);
  if (qy > 0 && Math.abs(gx) < gw) {
    PICK_T = -0.08 + (HI ? furTicks(qx, qz) : 0);
    return P_FUR;
  }
  if (qy > 0 && Math.abs(gx) < gw + (HI ? 0.08 : 0.1)) {
    PICK_T = 0.1;
    if (HI && (qz * 11 + 20) % 1 < 0.45 && Math.abs(gx) > gw + 0.035) PICK_T = 0.2;
    return P_VEST;
  }
  if (qz < hem + 0.07) PICK_T = -0.1;
  if (qy > 0) {
    // Накладные карманы внизу с обеих сторон.
    const px = ax0 - 0.49;
    const pz = qz + 0.28;
    if (Math.abs(px) < 0.19 && Math.abs(pz) < 0.19) {
      if (pz > 0.06) {
        if (Math.abs(px) < 0.05 && Math.abs(pz - 0.1) < 0.06) {
          PICK_T = 0.05;
          return P_BRASS;
        }
        PICK_T = pz < 0.1 ? -0.26 : -0.06;
        return P_VEST;
      }
      PICK_T = Math.abs(px) > 0.15 || pz < -0.15 ? -0.2 : 0.06;
      return P_VEST;
    }
    // Нагрудный карман слева в кадре.
    if (qx < 0) {
      const bx = qx + 0.47;
      const bz = qz - 0.32;
      if (Math.abs(bx) < 0.15 && Math.abs(bz) < 0.14) {
        PICK_T = Math.abs(bx) > 0.11 || bz < -0.1 ? -0.12 : bz > 0.08 ? -0.07 : 0.04;
        return P_VEST;
      }
    }
    if (HI && (qx * 9 + qz * 9 + 40) % 1 < 0.12) PICK_T -= 0.04;
  }
  return P_VEST;
}

function torso(out: PartF[], rods: Rod[], c: Ctx): void {
  const { S, lag } = c;
  const k = S.k;
  out.push({
    c: S.bc,
    ax: S.bax,
    r: S.br,
    pal: P_VEST,
    id: nid(),
    bias: -0.02,
    pick: vestPick,
  });
  // Карандаш в нагрудном кармане: качается за жилетом.
  const base = torsoAt(S, -0.47, 0.44, 1.0);
  const d = norm([-0.22 + 0.1 * lag.vest, 0.3, 1]);
  const top = add(base, mul(d, 2.6 * k));
  const tip = add(top, mul(d, 0.8 * k));
  rods.push({ a: base, b: top, w: HI ? 1.0 : 0.5, pal: P_PEN, tone: 4 });
  rods.push({ a: top, b: tip, w: HI ? 0.7 : 0.5, pal: P_WOOD, tone: 6 });
  if (HI) rods.push({ a: tip, b: add(tip, mul(d, 0.35 * k)), w: 0.5, pal: P_NOSE, tone: 3 });
}

function arms(out: PartF[], rods: Rod[], c: Ctx): void {
  const { S, o } = c;
  const k = S.k;
  const cl = 1 + 0.55 * o.claw;
  const sp = 1 + 0.35 * o.claw;
  for (const j of [0, 1]) {
    const sh = S.sh[j];
    const el = S.el[j];
    const paw = S.paw[j];
    const aid = nid();
    out.push({
      c: sh,
      ax: axes([1, 0, 0], [0, 0, 1]),
      r: [2.3 * k, 2.3 * k, 2.4 * k],
      pal: P_BLK,
      id: aid,
      bias: 0.04,
    });
    const ft = HI
      ? (qx: number, _qy: number, qz: number) => furTicks(qz * 0.6, qx * 0.9)
      : undefined;
    limb(out, sh, el, 2.2 * k, 2.3 * k, P_BLK, aid, { bias: 0.04, tex: ft });
    limb(out, el, paw, 2.0 * k, 2.1 * k, P_BLK, aid, { bias: 0.06, tex: ft });
    const fd = norm(sub(paw, el));
    let lat: V3 = [fd[2], 0, -fd[0]];
    if (Math.hypot(lat[0], lat[2]) < 0.25) lat = [1, 0, 0];
    lat = norm(lat);
    const fw = norm([
      lat[1] * fd[2] - lat[2] * fd[1],
      lat[2] * fd[0] - lat[0] * fd[2],
      lat[0] * fd[1] - lat[1] * fd[0],
    ]);
    const pc = add(paw, mul(fd, 0.8 * k));
    out.push({
      c: pc,
      ax: axes(fd, fw),
      r: [2.2 * k, 2.1 * k, 1.9 * k],
      pal: P_BLK,
      id: aid,
      bias: 0.1,
      tex: toes(HI ? 4 : 3),
    });
    // Когти: три длинных костяных, загнуты к зрителю.
    for (const u of HI ? [-1.15, 0, 1.15] : [-1.0, 0, 1.0]) {
      const b = add(pc, add(mul(fd, 1.7 * k), add(mul(lat, u * sp * k), mul(fw, 0.5 * k))));
      const m = add(
        b,
        add(mul(fd, 1.4 * cl * k), add(mul(lat, u * 0.3 * o.claw * k), mul(fw, 0.3 * k))),
      );
      const e = add(
        m,
        add(mul(fd, 1.0 * cl * k), add(mul(lat, u * 0.3 * o.claw * k), mul(fw, 0.7 * cl * k))),
      );
      rods.push({ a: b, b: m, w: HI ? 0.9 : 0.5, pal: P_CLAW, tone: 4 });
      rods.push({ a: m, b: e, w: HI ? 0.7 : 0.5, pal: P_CLAW, tone: 5 });
    }
  }
}

function tail(out: PartF[], c: Ctx): void {
  const { S, o, lag } = c;
  const k = S.k;
  const pts = S.pl.tail.map((p, i) => {
    const u = i / (S.pl.tail.length - 1);
    return S.up([p[0] + lag.tailSw * 1.8 * u * u, p[1], p[2] + o.tailUp * 2.4 * u * u]);
  });
  const id = nid();
  const rad = [2.0, 1.8, 1.5, 1.0];
  for (let i = 0; i < pts.length - 1; i++)
    limb(out, pts[i], pts[i + 1], rad[i] * k, rad[i] * 0.9 * k, P_FUR, id, {
      bias: 0.02 * i,
    });
}

/**
 * Морда барсука: белая полоса посередине, чёрные полосы от носа через глаза к
 * ушам, белые щёки; затылок серый; под полями каски — тень.
 */
function headPick(qx: number, qy: number, qz: number): number {
  PICK_T = 0;
  if (qy < -0.3) return P_FUR;
  const ax0 = Math.abs(qx);
  const sh = qz > 0.42 ? -0.1 : 0;
  const bw = 0.13 + 0.05 * clamp01(qz + 0.3);
  if (ax0 < bw) {
    PICK_T = sh + (HI && ax0 > bw - 0.05 ? -0.04 : 0);
    return P_WHT;
  }
  const cc = 0.27 + 0.44 * (qz + 0.45);
  const hw = 0.2 + 0.05 * qz;
  if (qz > -0.66 && ax0 > cc - hw && ax0 < cc + hw) {
    PICK_T = sh + (HI && ax0 > cc + hw - 0.05 ? 0.05 : 0);
    return P_BLK;
  }
  if (qy < -0.05 && qz > 0.1) return P_FUR;
  PICK_T = sh;
  return P_WHT;
}

/** Морда: белая, по бокам полосы доходят до носа. */
function muzzlePick(qx: number, qy: number, qz: number): number {
  PICK_T = 0;
  if (Math.abs(qx) > 0.62 && qz > -0.1 && qy < 0.55) {
    PICK_T = 0.04;
    return P_BLK;
  }
  return P_WHT;
}

/** Каска: гребень посередине светлее, ремешок очков вокруг. */
function domePick(qx: number, qy: number, qz: number): number {
  PICK_T = 0;
  if (Math.abs(qz - 0.37) < 0.075) {
    PICK_T = 0.14;
    return P_BLK;
  }
  const ax0 = Math.abs(qx);
  if (qz > 0.15 && ax0 < 0.085) PICK_T = 0.12;
  else if (HI && qz > 0.15 && ax0 < 0.14) PICK_T = -0.06;
  return P_HAT;
}

/** Линза очков: латунная оправа, стекло; блик сверху слева. */
function lensPick(qx: number, qy: number): number {
  PICK_T = 0;
  const r = Math.hypot(qx, qy);
  if (r < (HI ? 0.6 : 0.5)) {
    PICK_T = -0.14 + (qx < -0.15 && qy > 0.15 ? 0.45 : 0);
    return P_GLASS;
  }
  PICK_T = HI && r > 0.9 ? -0.08 : 0.04;
  return P_BRASS;
}

function headParts(out: PartF[], c: Ctx): void {
  const { o, h } = c;
  const k = h.k;
  const ex = h.dir([1, 0, 0]);
  const ez = h.dir([0, 0, 1]);
  const hax = axes(ex, ez);
  out.push({
    c: h.at([0, 0, 0]),
    ax: hax,
    r: [8.2 * k, 7.0 * k, 7.0 * k],
    pal: P_WHT,
    id: nid(),
    bias: 0.02,
    pick: headPick,
  });
  // Морда чуть вниз; нос на кончике (нюхает — нос вверх).
  const sn = o.sniff;
  const max = axes(h.dir(pitchX([1, 0, 0], 0.3)), h.dir(pitchX([0, 0, 1], 0.3)));
  const mid = nid();
  out.push({
    c: h.at([0, 5.6, -2.8 + 0.12 * sn]),
    ax: max,
    r: [2.9 * k, 2.8 * k, 2.1 * k],
    pal: P_WHT,
    id: mid,
    bias: 0.04,
    pick: muzzlePick,
  });
  out.push({
    c: h.at([0, 8.3, -2.1 + 0.32 * sn]),
    ax: max,
    r: [1.55 * k, 0.95 * k, 1.05 * k],
    pal: P_NOSE,
    id: nid(),
    bias: 0.1,
    noSeam: true,
  });
  const jw = o.jaw;
  if (jw > 0.06) {
    out.push({
      c: h.at([0, 7.0, -4.2 - 0.4 * jw]),
      ax: max,
      r: [1.7 * k, 1.2 * k, (0.4 + 1.1 * jw) * k],
      pal: P_MOUTH,
      id: nid(),
      bias: -0.15,
      noSeam: true,
    });
    if (jw > 0.25)
      out.push({
        c: h.at([0, 7.4, -4.6 - 0.9 * jw]),
        ax: max,
        r: [1.2 * k, 0.8 * k, 0.6 * k],
        pal: P_MOUTH,
        id: nid(),
        bias: 0.45,
        noSeam: true,
      });
    out.push({
      c: h.at([0, 6.0, -4.6 - 1.2 * jw]),
      ax: max,
      r: [2.0 * k, 2.0 * k, 1.1 * k],
      pal: P_WHT,
      id: mid,
      bias: -0.06,
    });
    if (jw > 0.45)
      for (const side of [-1, 1])
        out.push({
          c: h.at([side * 1.05, 7.9, -4.0]),
          ax: axes(h.dir([0, 0.15, -1]), h.dir([0, 1, 0])),
          r: [(HI ? 0.8 : 1.0) * k, 0.4 * k, 0.4 * k],
          pal: P_CLAW,
          id: nid(),
          bias: 0.2,
          noSeam: true,
        });
  }
  // Уши: маленькие круглые, белая кайма; дёргаются.
  for (const side of [-1, 1]) {
    const fl = side < 0 ? o.earL : o.earR;
    const base: V3 = [side * 8.5, -0.8, 2.3];
    const e1 = rollY(norm([1, -side * 0.6, 0]), side * 0.35 * fl);
    const e3 = rollY([0, 0, 1], side * 0.35 * fl);
    out.push({
      c: h.at(base),
      ax: axes(h.dir(e1), h.dir(e3)),
      r: [2.4 * k, 1.0 * k, 2.4 * k],
      pal: P_BLK,
      id: nid(),
      bias: 0.02,
      pick: (qx, _qy, qz) => {
        PICK_T = 0;
        if (qx * qx + qz * qz > 0.42 && qz > -0.3) return P_WHT;
        PICK_T = -0.06;
        return P_BLK;
      },
    });
  }
  hatParts(out, c);
}

/** Каска: купол без нижней половины, поля, очки на ремешке. */
function hatParts(out: PartF[], c: Ctx): void {
  const { h } = c;
  const k = h.k;
  const hax = axes(h.hdir([1, 0, 0]), h.hdir([0, 0, 1]));
  out.push({
    c: h.hat([0, -0.3, 0]),
    ax: hax,
    r: [8.0 * k, 7.6 * k, 6.2 * k],
    pal: P_HAT,
    id: nid(),
    bias: 0.02,
    pick: domePick,
    cut: (_qx, _qy, qz) => qz < 0,
  });
  out.push({
    c: h.hat([0, 0.9, -0.15]),
    ax: hax,
    r: [9.5 * k, 9.9 * k, 0.8 * k],
    pal: P_HAT,
    id: nid(),
    bias: -0.03,
  });
  const gid = nid();
  for (const side of [-1, 1]) {
    const lx = side * 2.8;
    const lz = 2.3;
    const ly = -0.3 + 7.6 * Math.sqrt(Math.max(0, 1 - (lx / 8) ** 2 - (lz / 6.2) ** 2)) + 0.25;
    const nrm = norm([lx / 64, (ly + 0.3) / 57.8, lz / 38.4]);
    out.push({
      c: h.hat([lx, ly, lz]),
      ax: axes(h.hdir([1, 0, 0]), h.hdir(nrm)),
      r: [1.9 * k, 1.9 * k, 0.75 * k],
      pal: P_BRASS,
      id: gid,
      bias: 0.06,
      pick: lensPick,
    });
  }
  out.push({
    c: h.hat([0, 7.2, 2.3]),
    ax: hax,
    r: [1.1 * k, 0.5 * k, 0.45 * k],
    pal: P_BRASS,
    id: gid,
    bias: 0.04,
  });
}

/**
 * Камень: валун впереди справа, на длину рукояти и руки, и голыш у его подножия; трещина
 * от места удара вниз по передней стороне (светится лиловым, когда кристалл рвётся наружу).
 */
function rockParts(out: PartF[], c: Ctx): void {
  const { o } = c;
  const H = hitGeo();
  const vis = o.rock;
  const cr = o.crack;
  const tex = (qx: number, qy: number, qz: number) => {
    const n = hash(Math.floor((qx + 2) * (HI ? 6 : 3)), Math.floor((qz + 2) * (HI ? 6 : 3)), 7);
    return n < 0.25 ? -0.08 : n > 0.85 ? 0.05 : 0;
  };
  out.push({
    c: H.rc,
    ax: axes([1, 0.15, 0], [0, 0, 1]),
    r: H.rr,
    pal: P_ROCK,
    id: nid(),
    tex,
    vis,
    floor: true,
    pick: (qx, qy, qz) => {
      PICK_T = 0;
      if (cr < 0.5 || qy < -0.2 || qz < -0.2) return P_ROCK;
      const cx = -0.14 + 0.1 * Math.sin(qz * 9);
      const d = Math.abs(qx - cx);
      if (cr > 1.5 && d < (HI ? 0.045 : 0.06)) {
        PICK_T = 0.2;
        return P_GEM;
      }
      if (d < (HI ? 0.08 : 0.07)) PICK_T = -0.45;
      return P_ROCK;
    },
  });
  out.push({
    c: add(H.rc, mul([-4.4, 2.6, (-0.4 * H.rr[2]) / G + 0.2], G)),
    ax: axes([1, -0.3, 0], [0.2, 0, 1]),
    r: mul([2.4, 2.2, 2.1], G),
    pal: P_ROCK,
    id: nid(),
    bias: -0.04,
    tex,
    vis,
    floor: true,
  });
}

/**
 * Кайло: рукоять от хвата дальней лапы (или как вошло в камень), головка поперёк рукояти
 * в плоскости замаха, ведущий зуб — по ходу удара.
 */
function pickRods(rods: Rod[], c: Ctx): void {
  const { o, S } = c;
  const [d, n] = pickAxes([o.pdx, o.pdy, o.pdz]);
  const k = o.stuck ? G : S.k;
  const grip = o.stuck ? hitGeo().B : sub(S.paw[1], mul(d, 0.2 * k));
  const vis = o.pick;
  const end = add(grip, mul(d, HANDLE * k));
  rods.push({
    a: sub(grip, mul(d, 0.9 * k)),
    b: end,
    w: HI ? 1.1 : 0.5,
    pal: P_WOOD,
    tone: HI ? 4 : 6,
    vis,
  });
  for (const s of [-1, 1]) {
    const mid = add(end, add(mul(n, s * HEAD_W * 0.55 * k), mul(d, 0.25 * k)));
    const tip = add(end, add(mul(n, s * HEAD_W * k), mul(d, -HEAD_B * k)));
    rods.push({ a: end, b: mid, w: HI ? 1.3 : 1.9, pal: P_STEEL, tone: HI ? 5 : 6, vis });
    rods.push({ a: mid, b: tip, w: HI ? 0.9 : 0.5, pal: P_STEEL, tone: HI ? 6 : 7, vis });
  }
  rods.push({
    a: sub(end, mul(d, 0.6 * k)),
    b: add(end, mul(d, 0.5 * k)),
    w: HI ? 1.6 : 0.6,
    pal: P_STEEL,
    tone: 3,
    vis,
  });
}

// ---------------------------------------------------------------------------
// Свой растр: части с выбором палитры, срезом и проявлением; пруты; кристалл.
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

/** Кристалл: шестигранник гранями (левая и верхние светлее), светлое ребро посередине. */
function gemDraw(f: Frame, c: V3, vis: number): void {
  const [sx, sy, sd] = project(mul(c, RR));
  const s = RR * G;
  const hh = 2.7 * s;
  const ww = 1.7 * s;
  const P: [number, number][] = [
    [0, -hh],
    [ww, -0.32 * hh],
    [0.72 * ww, 0.5 * hh],
    [0, hh],
    [-0.72 * ww, 0.5 * hh],
    [-ww, -0.32 * hh],
  ];
  const N = PAL[P_GEM].length;
  const X0 = Math.max(0, Math.floor(OX + sx - ww - 1));
  const X1 = Math.min(f.w - 1, Math.ceil(OX + sx + ww + 1));
  const Y0 = Math.max(0, Math.floor(OY + sy - hh - 1));
  const Y1 = Math.min(f.h - 1, Math.ceil(OY + sy + hh + 1));
  for (let py = Y0; py <= Y1; py++)
    for (let px = X0; px <= X1; px++) {
      const dx = px + 0.5 - OX - sx;
      const dy = py + 0.5 - OY - sy;
      let inside = false;
      for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
        const [xi, yi] = P[i];
        const [xj, yj] = P[j];
        if (yi > dy !== yj > dy && dx < ((xj - xi) * (dy - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (!inside) continue;
      if (vis < 1 && !dith(px, py, vis)) continue;
      const i = py * f.w + px;
      const d = sd + 2 * RR;
      if (d <= f.zb[i]) continue;
      const crown = dy < -0.32 * hh + Math.abs(dx) * 0.2;
      let tn = 5 + (dx < -0.35 ? 1 : dx > 0.45 ? -1 : 0) + (crown ? 1 : dy > 0.4 * hh ? -1 : 0);
      if (Math.abs(dx) < (HI ? 0.6 : 0.5) && dy < 0.3 * hh) tn += 2;
      f.zb[i] = d;
      f.pal[i] = P_GEM;
      f.tone[i] = Math.max(0, Math.min(N - 1, tn));
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
      if (pl !== P_FUR && pl !== P_WHT && pl !== P_VEST && pl !== P_HAT && pl !== P_BLK) continue;
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
// Поверх кадра: глаза, нос, рот, румянец, искры, следы когтей, сон.
// ---------------------------------------------------------------------------

function eyePal(): Record<string, RGBA> {
  const iris =
    V === 1
      ? ramp('#5a2a06', '#8a4a0c', '#b8741a', '#e0a030', '#f8d070')
      : ramp('#2a1608', '#4a2a12', '#6b4a2e', '#93704a', '#c09a6c');
  return {
    K: INK_V[V],
    W: hx('#ffffff'),
    w: V === 1 ? hx('#fff6dc') : hx('#f2eee6'),
    b: iris[3],
    d: iris[2],
    k: PAL[P_BLK][2],
    l: PAL[P_WHT][5],
  };
}
// Малая: бусина 2×2 с бликом — на чёрной полосе светлая радужка.
const EYES_S: Record<string, string[]> = {
  open: ['Wb', 'bd'],
  half: ['kk', 'Wb'],
  shut: ['..', 'll'],
  sleep: ['..', 'll'],
  squint: ['..', 'll'],
  happy: ['.l.', 'l.l'],
  wide: ['.w.', 'wKw', '.w.'],
  angry: ['W.', 'bd'],
};
// Крупная: белок кольцом, радужка, зрачок, блик (как у туши).
const EYES_L: Record<string, string[]> = {
  open: ['.www.', 'wWbbw', 'wbKdw', 'wdddw', '.www.'],
  half: ['.....', 'kkkkk', 'wbKdw', 'wdddw', '.www.'],
  shut: ['.....', '.....', 'l...l', '.lll.', '.....'],
  sleep: ['.....', '.....', 'l...l', '.lll.', '.....'],
  happy: ['.....', '.lll.', 'l...l', '.....', '.....'],
  squint: ['l....', '.ll..', '...l.', '.ll..', 'l....'],
  wide: ['.www.', 'wWwww', 'wwKww', 'wwwww', '.www.'],
  angry: ['ww...', 'wWbk.', 'wbKdk', 'wddKw', '.www.'],
};
/** У этих глаз стороны разные (наклон века); у круглых блик слева у обоих — свет один. */
const EYE_FLIP = new Set(['angry', 'squint']);

function face(p: Px, f: Frame, c: Ctx): void {
  const { o, h } = c;
  const ep = eyePal();
  for (const side of [-1, 1] as const) {
    const at = seen(f, mul(h.at([side * 4.0, 6.1, 0.3]), RR), OX, OY, 2.4 * RR);
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
  // Нос: блик сверху слева (крупная — и ноздри).
  const nl = PAL[P_NOSE];
  const gl = seen(f, mul(h.at([-0.55, 9.05, -1.35 + 0.32 * o.sniff]), RR), OX, OY, 1.6 * RR);
  if (gl) {
    p.set(gl[0], gl[1], nl[5]);
    if (HI) p.set(gl[0] + 1, gl[1], nl[4]);
  }
  if (HI)
    for (const side of [-1, 1]) {
      const at = seen(
        f,
        mul(h.at([side * 0.65, 9.0, -2.45 + 0.32 * o.sniff]), RR),
        OX,
        OY,
        1.6 * RR,
      );
      if (at) p.set(at[0], at[1], INK_V[V]);
    }
  if (!HI) return;
  // Рот (крупная): от носа вниз и уголками вверх.
  if (o.jaw < 0.1) {
    const ink = mixc(PAL[P_WHT][1], INK_V[V], 0.4);
    const gr = o.grin;
    const pts: V3[] = [
      [0, 8.3, -3.3],
      [0, 8.1, -3.7],
      [-0.6, 7.9, -4.0],
      [0.6, 7.9, -4.0],
      [-1.25, 7.5, -3.95 + 0.35 * gr],
      [1.25, 7.5, -3.95 + 0.35 * gr],
    ];
    for (const q of pts) {
      const at = seen(f, mul(h.at(q), RR), OX, OY, 1.6 * RR);
      if (at) p.set(at[0], at[1], ink);
    }
  }
  // Румянец на белых щеках.
  const blush = V === 1 ? hx('#f2a878') : hx('#eaa2a0');
  for (const side of [-1, 1]) {
    const at = seen(f, mul(h.at([side * 5.3, 4.8, -1.9]), RR), OX, OY, 1.6 * RR);
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
  return [Math.round(OX + sx), Math.round(OY + sy)];
};

/** Трюк поверх кадра: искры удара, осколки, блики на кристалле и очках. */
const CHIPS: V3[] = [
  [-9, 3, 15],
  [8, 4, 17],
  [-3, 6, 21],
  [5, 2, 12],
];
function workFx(p: Px, c: Ctx): void {
  const { o, h, t } = c;
  const white = hx('#ffffff');
  const warm = hx('#ffe08a', 230);
  if (o.hit >= 0) {
    const [x, y] = scr(hitGeo().T);
    star(p, x, y - 1, Math.round((1 - o.hit) * (HI ? 6 : 3)) + 1, white, warm);
  }
  if (c.a === 'work' && o.rock > 0.01) {
    const rk = PAL[P_ROCK];
    const T0 = hitGeo().T;
    for (const th of [HIT1, HIT2]) {
      const dt = t - th;
      if (dt <= 0 || dt > 0.34) continue;
      CHIPS.forEach((v, n) => {
        const q: V3 = [
          T0[0] + v[0] * dt,
          T0[1] + v[1] * dt,
          T0[2] + v[2] * dt - 0.5 * 90 * dt * dt,
        ];
        if (q[2] < 0) return;
        const [x, y] = scr(q);
        const s = HI ? 2 : 1;
        for (let yy = 0; yy < s; yy++)
          for (let xx = 0; xx < s; xx++) p.set(x + xx, y + yy, rk[n & 1 ? 7 : 6]);
        p.set(x, y + s, rk[2]);
      });
    }
  }
  if (o.glint > 0.05 && o.gem >= 0) {
    const [x, y] = scr(add([o.gx, o.gy, o.gz], [-0.7 * G, 0, 1.5 * G]));
    const L = Math.round(o.glint * (HI ? 6 : 3));
    if (L >= 1) star(p, x, y, L, white, hx('#e8ccff', 230));
  }
  if (o.gog > 0.05) {
    const lx = -2.8;
    const ly = -0.3 + 7.6 * Math.sqrt(1 - (lx / 8) ** 2 - (2.3 / 6.2) ** 2) + 0.9;
    const [x, y] = scr(h.hat([lx - 0.5, ly, 2.8]));
    const L = Math.round(o.gog * (HI ? 5 : 2));
    if (L >= 1) star(p, x, y, L, white, warm);
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
    const [x0, y0] = scr(h.at([6 + 3.5 * u, 0, 6 + 9 * u]));
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

/** Кадр `i` анимации `a` полосы `res`, вариант окраса `v` (0 — обычный, 1 — золотой). */
export function badgerFrame(a: Anim, i: number, res: Res = 's', v = 0): Px {
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
  const c: Ctx = { a, o, S, h: headF(o, S, lag), lag, t };
  PAL = PAL_V[V];
  VEST_SW = lag.vest * 0.045;
  const f = newFrame(cv.cw, cv.ch);
  const parts: PartF[] = [];
  const rods: Rod[] = [];
  tail(parts, c);
  legs(parts, rods, c);
  torso(parts, rods, c);
  arms(parts, rods, c);
  headParts(parts, c);
  if (o.rock > 0.01) rockParts(parts, c);
  drawPartsF(f, toRes(parts), PAL, OX, OY);
  if (o.pick > 0.01) pickRods(rods, c);
  for (const r of rods) rodF(f, r);
  if (o.gem >= 0.01) gemDraw(f, [o.gx, o.gy, o.gz], o.gem);
  seams(f, 1.2 * RR, 1);
  rimLight(
    f,
    PAL,
    (pl) => pl !== P_MOUTH && pl !== P_NOSE && pl !== P_GLASS && pl !== P_GEM && pl !== P_CLAW,
  );
  if (HI) softBands(f);
  const p = toPx(f, PAL);
  selOutline(p, INK_V[V], 0.8);
  const mask = new Uint8Array(p.w * p.h);
  for (let j = 0; j < mask.length; j++) mask[j] = p.data[j * 4 + 3] > 0 ? 1 : 0;
  face(p, f, c);
  workFx(p, c);
  if (o.swipe >= 0) swipeFx(p, mask, c);
  if (a === 'sleep') zzz(p, mask, c);
  return p;
}
