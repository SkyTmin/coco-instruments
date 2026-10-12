// Паук-отмычка — пиксельный питомец по эталону боссов 12–14.
//
// Круглый мохнатый тарантул смотрит на нас и стоит на восьми лапах: сзади
// большой пушистый шар брюшка с рыжим хохолком сверху, спереди голова с
// двумя большими блестящими глазами и четырьмя маленькими над ними,
// пушистые хелицеры с костяными клыками, рыжие кольца на каждом колене,
// лапы аркой расходятся в стороны (колено — самая высокая точка, стопа
// далеко снаружи). Педипальпы держат отмычку и натяжитель.
//
// Две полосы, у каждой свой рисунок: малая — рамка 48 (шахта, списки),
// крупная — рамка 112 (карточка, вылупление, Питомник): шерсть прядями по
// контуру и штрихами по шару, блики глаз, маленькие глаза бусинами, клыки,
// кольца на коленях и у щиколоток.
//
// Лапы — две кости и лапка, колено ставится обратной задачей (IK) от плеча к
// стопе: стопа стоит на полу, тело качается — лапы не скользят. Ходьба —
// чередующиеся четвёрки (L1 R2 L3 R4 / R1 L2 R3 L4). Брюшко и отмычки — с
// запаздыванием (`spring`).
// Трюк: поднимает передние лапы и плетёт между ними паутину; пролетающий
// жетон влипает в неё, паук пляшет.
//
// Золотой рисуется здесь же (`v` = 1) своими палитрами: шерсть — золото с
// бронзовой глубиной, рыжие кольца — медь; глаза и отмычки читаются.

import type { Px } from '../dungeon-art';
import {
  add,
  axes,
  bezQ,
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
import type { Frame, Part, RGBA, V3 } from './rig';

// ---------------------------------------------------------------------------
// Палитры (тон — номер ступени; свет, шов и кант сдвигают ступень).
// ---------------------------------------------------------------------------

const P_FUR = 0;
const P_LEG = 1;
const P_BAND = 2;
const P_FANG = 3;
const P_STEEL = 4;
const P_TOKEN = 5;
const P_MOUTH = 6;

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
const TOKEN = ramp(
  '#0a2a26',
  '#14463f',
  '#1f6458',
  '#2a8f80',
  '#43b09e',
  '#5fd1bd',
  '#8ee6d4',
  '#b8f4e6',
  '#e4fff8',
);
const FANG = ramp('#4e4436', '#7a6e5a', '#a69a82', '#cabfa6', '#e6dcc6', '#f6efe0', '#fffcf4');
const MOUTH = ramp('#14040a', '#2c0a14', '#4a1220', '#6a1e2a', '#8c3036');

const PAL_V: RGBA[][][] = [
  [
    // Шерсть: тёплая бурая тень → бурый → серо-бурые светлые кончики.
    ramp(
      '#0c0807',
      '#140d0b',
      '#1c1310',
      '#251915',
      '#2f201a',
      '#3a2820',
      '#463127',
      '#533b2f',
      '#614638',
      '#715343',
      '#856552',
      '#9e7c66',
    ),
    // Лапы — на ступень темнее тела.
    ramp(
      '#0c0807',
      '#140e0c',
      '#1d1512',
      '#271c18',
      '#31251f',
      '#3c2e26',
      '#48382e',
      '#564338',
      '#665044',
      '#7a6252',
    ),
    // Рыжие кольца на коленях и хохолок.
    ramp(
      '#3a1606',
      '#5a240a',
      '#7c360e',
      '#a04a14',
      '#c45e1c',
      '#e07a2e',
      '#ef9646',
      '#f8b266',
      '#ffd090',
    ),
    FANG,
    STEEL,
    TOKEN,
    MOUTH,
  ],
  [
    // Золотой: бронза в тени → золото → бледное золото на кончиках.
    ramp(
      '#2a1606',
      '#3e2208',
      '#56320c',
      '#6e4612',
      '#885c18',
      '#a2741e',
      '#bc8c28',
      '#d4a636',
      '#e6bf4c',
      '#f4d66c',
      '#fce898',
      '#fff6cc',
    ),
    // Лапы — глубже, бронзовее.
    ramp(
      '#22120a',
      '#341c0a',
      '#4a2a0e',
      '#623a12',
      '#7a4c18',
      '#94621e',
      '#ae7a28',
      '#c69434',
      '#dcae48',
      '#eec864',
    ),
    // Медь вместо рыжего.
    ramp(
      '#2e0e06',
      '#4a180a',
      '#6a2410',
      '#8c3418',
      '#ac4622',
      '#c85c30',
      '#dc7444',
      '#ec9060',
      '#f8b088',
    ),
    FANG,
    STEEL,
    TOKEN,
    MOUTH,
  ],
];
const INK_V: RGBA[] = [hx('#0b0706'), hx('#1c0e03')];
const SILK = hx('#f6f2ea');
const SILK_DIM = hx('#cfc8d8');

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
let SC = 1;
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
  /** Весь паук (лапы следом): сдвиг и прыжок. */
  gx: number;
  gy: number;
  air: number;
  /** Только тело (лапы стоят): сдвиг, присед. */
  bx: number;
  by: number;
  bz: number;
  /** Наклон тела: + — перёд вниз; крен; поворот. */
  pitch: number;
  lean: number;
  turn: number;
  /** Сплющивание при приземлении; масштаб броска к зрителю. */
  sq: number;
  scale: number;
  /** Голова кивает; брюшко дышит и задирается. */
  nod: number;
  abd: number;
  abdUp: number;
  /** Подъём и шаг каждой лапы (L/R, 0 — передняя … 3 — задняя). */
  lL0: number;
  lL1: number;
  lL2: number;
  lL3: number;
  lR0: number;
  lR1: number;
  lR2: number;
  lR3: number;
  yL0: number;
  yL1: number;
  yL2: number;
  yL3: number;
  yR0: number;
  yR1: number;
  yR2: number;
  yR3: number;
  /** Передние лапы вверх (0…1), развести в стороны; кончики описывают круги. */
  raiseL: number;
  raiseR: number;
  spread: number;
  fLx: number;
  fLz: number;
  fRx: number;
  fRz: number;
  /** Все лапы врозь (прыжок) или поджаты под себя (сон). */
  splay: number;
  tuck: number;
  /** Педипальпы вверх (стук отмычками); наклон отмычек наружу. */
  palpL: number;
  palpR: number;
  tlL: number;
  tlR: number;
  /** Хелицеры и клыки: 0 — сомкнуты, 1 — раскрыты. */
  fang: number;
  eye: Eye;
  blink: number;
  /** Паутина (−1 — нет, 0…1 — сплетена), жетон (−1 — нет, 0…1 — летит, 1 — влип), видимость. */
  web: number;
  tok: number;
  prop: number;
  /** Толчок жетона в паутину (ступенька, паутина отвечает пружиной). */
  wob: number;
  /** Укус: лучи (0…1), −1 — нет. */
  bite: number;
}

const REST: Pose = {
  gx: 0,
  gy: 0,
  air: 0,
  bx: 0,
  by: 0,
  bz: 0,
  pitch: 0,
  lean: 0,
  turn: 0,
  sq: 0,
  scale: 1,
  nod: 0,
  abd: 0,
  abdUp: 0,
  lL0: 0,
  lL1: 0,
  lL2: 0,
  lL3: 0,
  lR0: 0,
  lR1: 0,
  lR2: 0,
  lR3: 0,
  yL0: 0,
  yL1: 0,
  yL2: 0,
  yL3: 0,
  yR0: 0,
  yR1: 0,
  yR2: 0,
  yR3: 0,
  raiseL: 0,
  raiseR: 0,
  spread: 0,
  fLx: 0,
  fLz: 0,
  fRx: 0,
  fRz: 0,
  splay: 0,
  tuck: 0,
  palpL: 0,
  palpR: 0,
  tlL: 0,
  tlR: 0,
  fang: 0,
  eye: 'open',
  blink: 0,
  web: -1,
  tok: -1,
  prop: 0,
  wob: 0,
  bite: -1,
};

type LegKey = 'lL0' | 'lL1' | 'lL2' | 'lL3' | 'lR0' | 'lR1' | 'lR2' | 'lR3';
type StrideKey = 'yL0' | 'yL1' | 'yL2' | 'yL3' | 'yR0' | 'yR1' | 'yR2' | 'yR3';
const liftKey = (s: number, k: number) => `l${s < 0 ? 'L' : 'R'}${k}` as LegKey;
const strideKey = (s: number, k: number) => `y${s < 0 ? 'L' : 'R'}${k}` as StrideKey;

const TAU = Math.PI * 2;
const smooth = (u: number) => u * u * (3 - 2 * u);

/** Разовая к концу переходит в позу начала покоя: стык без сдвига. */
function settle(o: Pose, t: number, T: number, span = 0.22): Pose {
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
// Дорожки анимаций.
// ---------------------------------------------------------------------------

/** Покой: лапы по очереди переступают, пальпы стучат отмычками, брюшко дышит. */
const TAPS: [number, number, number, number, number][] = [
  // сторона, лапа, момент, подъём, шаг
  [-1, 1, 0.2, 1.7, 0.7],
  [1, 2, 0.7, 1.5, -0.5],
  [-1, 3, 1.15, 1.3, 0.4],
  [1, 0, 1.55, 1.3, 0.6],
  [-1, 2, 1.95, 1.5, -0.5],
  [1, 1, 2.3, 1.7, 0.6],
  [1, 3, 2.62, 1.3, 0.4],
  [-1, 0, 2.85, 1.2, 0.5],
];

function idlePose(t: number): Pose {
  const T = dur('idle');
  const o: Pose = { ...REST };
  const br = TAU * (t / 1.5);
  o.abd = 0.035 * Math.sin(br);
  o.bz = 0.32 * Math.sin(br - 0.7);
  o.lean = 0.025 * Math.sin((TAU * t) / T);
  o.turn = 0.035 * Math.sin((TAU * t) / T + 1.1);
  for (const [s, k, t0, L, dy] of TAPS) {
    const u = wrap(t - t0, T);
    const b = bump(u, 0, 0.4);
    o[liftKey(s, k)] = L * b;
    o[strideKey(s, k)] = dy * b;
  }
  // Пальпы: двойной стук левой, потом правой.
  const tap = (t0: number) => {
    const u = wrap(t - t0, T);
    return bump(u, 0, 0.16) + bump(u, 0.2, 0.36);
  };
  o.palpL = 0.55 * tap(0.5);
  o.palpR = 0.55 * tap(1.9);
  o.blink = bump(wrap(t - 2.35, T), 0, 0.2);
  return o;
}

/** Ходьба: чередующиеся четвёрки, тело качается дважды за круг. */
function walkPose(t: number): Pose {
  const T = dur('walk');
  const o: Pose = { ...REST };
  const ph = wrap(t, T) / T;
  for (const s of [-1, 1])
    for (let k = 0; k < 4; k++) {
      const g = (k + (s > 0 ? 1 : 0)) % 2;
      const u = wrap(ph + g * 0.5, 1);
      const S = k === 0 ? 1.6 : 1.3;
      let lift = 0;
      let st = 0;
      if (u < 0.5) {
        const w = u / 0.5;
        lift = (k === 0 ? 2.8 : 2.4) * Math.sin(Math.PI * w);
        st = lerp(-S, S, smooth(w));
      } else st = lerp(S, -S, (u - 0.5) / 0.5);
      o[liftKey(s, k)] = lift;
      o[strideKey(s, k)] = st;
    }
  o.bz = 0.45 * Math.cos(TAU * 2 * ph) - 0.15;
  o.lean = 0.05 * Math.sin(TAU * ph);
  o.bx = 0.45 * Math.sin(TAU * ph);
  o.turn = 0.03 * Math.sin(TAU * ph + 0.6);
  o.abd = 0.015 * Math.cos(TAU * 2 * ph);
  o.palpL = 0.25 * pos(Math.sin(TAU * ph));
  o.palpR = 0.25 * pos(-Math.sin(TAU * ph));
  return o;
}
const pos = (v: number) => Math.max(0, v);

/** Радость: присед → прыжок, лапы врозь → приземление → пляска на месте. */
function happyPose(t: number): Pose {
  const T = dur('happy');
  const o: Pose = { ...REST };
  o.bz = kf(t, [
    [0, 0],
    [0.12, -2.2, 'o'],
    [0.2, 0.4],
    [0.52, 0],
    [0.58, -1.6, 'o'],
    [0.7, 0.2],
    [0.84, -0.6],
    [0.98, 0],
  ]);
  o.air = kf(t, [
    [0, 0],
    [0.15, 0],
    [0.33, 7, 'o'],
    [0.53, 0, 'i'],
  ]);
  o.splay = kf(t, [
    [0, 0],
    [0.15, 0],
    [0.3, 1, 'o'],
    [0.46, 0.7],
    [0.58, 0],
  ]);
  o.sq = kf(t, [
    [0, 0],
    [0.12, 0.12],
    [0.19, -0.08],
    [0.32, 0],
    [0.53, 0],
    [0.58, 0.14],
    [0.7, 0],
  ]);
  o.pitch = kf(t, [
    [0, 0],
    [0.12, 0.06],
    [0.28, -0.1],
    [0.53, 0.04],
    [0.66, 0],
  ]);
  // Пляска: крен и сдвиг из стороны в сторону, лапы переступают.
  const d = clamp01((t - 0.6) / 0.06) * clamp01((0.98 - t) / 0.1);
  const u = (t - 0.6) / 0.38;
  o.lean = 0.12 * d * Math.sin(TAU * u);
  o.bx = 1.3 * d * Math.sin(TAU * u);
  for (const s of [-1, 1])
    for (let k = 1; k < 4; k++) {
      const g = (k + (s > 0 ? 1 : 0)) % 2;
      o[liftKey(s, k)] = 1.6 * d * pos(Math.sin(TAU * (u * 2 + g * 0.5)));
    }
  // Передние лапы машут вверх в прыжке и в пляске.
  o.raiseL = kf(t, [
    [0, 0],
    [0.16, 0],
    [0.32, 0.55, 'o'],
    [0.52, 0.15],
    [0.62, 0],
  ]);
  o.raiseR = o.raiseL;
  o.palpL = kf(t, [
    [0, 0],
    [0.16, 0],
    [0.3, 1],
    [0.52, 0.2],
    [0.66, 0.6],
    [0.8, 0.1],
    [0.92, 0.6],
    [1.02, 0],
  ]);
  o.palpR = kf(t, [
    [0, 0],
    [0.16, 0],
    [0.3, 1],
    [0.52, 0.2],
    [0.72, 0.6],
    [0.86, 0.1],
    [0.98, 0.5],
    [1.06, 0],
  ]);
  o.fang = 0.3 * bump(t, 0.15, 0.9);
  o.eye = t > 0.08 && t < T - 0.08 ? 'happy' : 'open';
  return settle(o, t, T);
}

/** Трюк: лапы вверх → плетёт паутину → жетон влипает → пляшет → паутина тает. */
const STICK_T = 1.3;
function workPose(t: number): Pose {
  const T = dur('work');
  const o: Pose = { ...REST };
  o.raiseL = kf(t, [
    [0, 0],
    [0.3, 1, 'o'],
    [1.62, 1],
    [1.92, 0],
  ]);
  o.raiseR = kf(t, [
    [0, 0],
    [0.06, 0],
    [0.36, 1, 'o'],
    [1.62, 1],
    [1.95, 0],
  ]);
  o.pitch = kf(t, [
    [0, 0],
    [0.32, -0.1],
    [1.62, -0.1],
    [1.95, 0],
  ]);
  o.nod = kf(t, [
    [0, 0],
    [0.32, -0.08],
    [1.1, -0.08],
    [1.2, 0.02],
    [1.62, 0],
  ]);
  o.bz = kf(t, [
    [0, 0],
    [0.3, 0.8],
    [1.62, 0.8],
    [1.95, 0],
  ]);
  // Плетёт: кончики передних лап описывают круги навстречу друг другу.
  const sp = clamp01((t - 0.34) / 0.08) * clamp01((1.08 - t) / 0.08);
  const ang = (TAU * (t - 0.34)) / 0.24;
  o.fLx = 1.3 * sp * Math.cos(ang);
  o.fLz = 1.3 * sp * Math.sin(ang);
  o.fRx = -1.3 * sp * Math.cos(ang + Math.PI);
  o.fRz = 1.3 * sp * Math.sin(ang + Math.PI);
  o.palpL = sp * (0.5 + 0.35 * Math.sin(ang * 2));
  o.palpR = sp * (0.5 - 0.35 * Math.sin(ang * 2));
  o.web = t < 0.3 ? -1 : t < 1.97 ? clamp01((t - 0.32) / 0.72) : -1;
  // Жетон летит справа дугой и влипает в середину.
  o.tok = t < 1.02 || t >= 1.97 ? -1 : clamp01((t - 1.02) / (STICK_T - 1.02));
  o.wob = t >= STICK_T && t < 1.97 ? 1 : 0;
  o.prop = t < 0.3 ? 0 : t < 1.68 ? 1 : t < 1.97 ? clamp01((1.94 - t) / 0.26) : 0;
  // Остальные лапы шире и ниже: упор, и поднятые лапы не тонут в их коленях.
  o.splay = kf(t, [
    [0, 0],
    [0.3, 0.75],
    [1.62, 0.75],
    [1.95, 0],
  ]);
  // Пляска: подскоки, крен, лапы переступают.
  const d = clamp01((t - 1.36) / 0.06) * clamp01((1.72 - t) / 0.06);
  const u = (t - 1.36) / 0.36;
  o.air += 1.8 * d * Math.abs(Math.sin(TAU * u));
  o.lean = 0.1 * d * Math.sin(TAU * u);
  o.bx = 0.9 * d * Math.sin(TAU * u);
  for (const s of [-1, 1])
    for (let k = 1; k < 4; k++) {
      const g = (k + (s > 0 ? 1 : 0)) % 2;
      o[liftKey(s, k)] = 1.4 * d * pos(Math.sin(TAU * (u * 2 + g * 0.5)));
    }
  o.eye = t > 1.0 && t < STICK_T ? 'wide' : t >= 1.36 && t < 1.86 ? 'happy' : 'open';
  return settle(o, t, T, 0.1);
}

/** Атака: на дыбы, лапы врозь, клыки открыты → бросок к зрителю → назад. */
function attackPose(t: number): Pose {
  const T = dur('attack');
  const o: Pose = { ...REST };
  o.pitch = kf(t, [
    [0, 0],
    [0.27, -0.34, 'o'],
    [0.35, 0.14, 'i'],
    [0.5, 0.06],
    [0.72, 0],
  ]);
  o.by = kf(t, [
    [0, 0],
    [0.27, -2.2, 'o'],
    [0.35, 0.5, 'i'],
    [0.55, 0],
  ]);
  o.bz = kf(t, [
    [0, 0],
    [0.27, 2.2, 'o'],
    [0.35, -1.2, 'i'],
    [0.5, -0.3],
    [0.7, 0],
  ]);
  o.raiseL = kf(t, [
    [0, 0],
    [0.24, 1, 'o'],
    [0.29, 1],
    [0.36, 0.1, 'i'],
    [0.5, 0],
  ]);
  o.raiseR = o.raiseL;
  o.spread = kf(t, [
    [0, 0],
    [0.24, 1, 'o'],
    [0.36, 1],
    [0.5, 0],
  ]);
  o.gy = kf(t, [
    [0, 0],
    [0.28, 0],
    [0.36, 4.5, 'o'],
    [0.56, 4.5],
    [0.82, 0],
  ]);
  o.scale = kf(t, [
    [0, 1],
    [0.28, 1],
    [0.36, 1.18, 'o'],
    [0.56, 1.12],
    [0.82, 1],
  ]);
  o.air = kf(t, [
    [0, 0],
    [0.28, 0],
    [0.32, 2.4, 'o'],
    [0.37, 0, 'i'],
  ]);
  o.sq = kf(t, [
    [0, 0],
    [0.36, 0],
    [0.4, 0.1],
    [0.5, 0],
  ]);
  o.fang = kf(t, [
    [0, 0],
    [0.2, 0.6],
    [0.33, 1],
    [0.5, 1],
    [0.62, 0.2],
    [0.78, 0],
  ]);
  o.palpL = kf(t, [
    [0, 0],
    [0.2, 1],
    [0.34, 0.6],
    [0.55, 0],
  ]);
  o.palpR = o.palpL;
  o.abdUp = kf(t, [
    [0, 0],
    [0.27, -0.1],
    [0.36, 0.12],
    [0.55, 0],
  ]);
  o.bite = t >= 0.34 && t < 0.56 ? clamp01((t - 0.34) / 0.2) : -1;
  o.eye = t > 0.04 && t < 0.72 ? 'angry' : 'open';
  return settle(o, t, T, 0.14);
}

/** Сон: лапы поджаты под себя, тело на полу, глаза закрыты, медленное дыхание. */
function sleepPose(t: number): Pose {
  const T = dur('sleep');
  const o: Pose = { ...REST };
  const br = (TAU * t) / T;
  o.tuck = 1;
  o.bz = -4.2 + 0.22 * Math.sin(br);
  o.abd = 0.04 * Math.sin(br);
  o.pitch = 0.08;
  o.nod = 0.06;
  o.palpL = -0.6;
  o.palpR = -0.6;
  o.tlL = -0.95;
  o.tlR = 0.95;
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
// Скелет: тело, голова, брюшко, восемь лап (IK), педипальпы.
// ---------------------------------------------------------------------------

/** Центр тела в покое; всё тело задано от него. */
const B0: V3 = [0, -2, 11];
const HEAD_L: V3 = [0, 3, 0];
const HEAD_R: V3 = [8.5, 7.5, 7];
const ABD_L: V3 = [0, -8, 6];
const ABD_R: V3 = [12.5, 11, 11];
/** Стебелёк — ось, вокруг которой брюшко задирается. */
const PED_L: V3 = [0, -4, 1];

// Правая сторона (левая — зеркально): плечо, колено, стопа в покое.
const HIP: V3[] = [
  [4.2, 4.2, 8.6],
  [5.6, 1.6, 9.4],
  [5.6, -1.6, 9.4],
  [4.6, -4.2, 9.6],
];
const KNEE: V3[] = [
  [10.5, 8.0, 15.5],
  [14.5, 3.5, 19.5],
  [16.0, -3.0, 20.0],
  [14.5, -10.0, 18.5],
];
const FOOT: V3[] = [
  [15.0, 11.0, 0],
  [22.5, 5.0, 0],
  [23.5, -5.0, 0],
  [21.0, -14.0, 0],
];
const TAR = 3.0;
const UP: V3 = [0, 0, 1];

function ankleOf(hip: V3, foot: V3, straight: number): V3 {
  const toHip = norm(sub(hip, foot));
  return add(foot, mul(norm(lerp3(UP, toHip, 0.4 + 0.6 * straight)), TAR));
}
const LF: number[] = [];
const LT: number[] = [];
const POLE: V3[] = [];
for (let k = 0; k < 4; k++) {
  const an = ankleOf(HIP[k], FOOT[k], 0);
  LF.push(Math.hypot(...sub(KNEE[k], HIP[k])));
  LT.push(Math.hypot(...sub(an, KNEE[k])));
  POLE.push(norm(sub(KNEE[k], mul(add(HIP[k], an), 0.5))));
}

/** Две кости от `a` к `b`, колено — в сторону `pole`. */
function ik(a: V3, b: V3, l1: number, l2: number, pole: V3): [V3, V3] {
  const d = sub(b, a);
  const D = Math.hypot(d[0], d[1], d[2]) || 1;
  const e = mul(d, 1 / D);
  const L = Math.max(Math.abs(l1 - l2) + 0.05, Math.min(D, (l1 + l2) * 0.995));
  const x = (l1 * l1 - l2 * l2 + L * L) / (2 * L);
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  const n = norm(sub(pole, mul(e, dot(pole, e))));
  const knee = add(add(a, mul(e, x)), mul(n, h));
  // Не достаёт — щиколотка там, куда дотянулась голень.
  const end = add(knee, mul(norm(sub(b, knee)), l2));
  return [knee, end];
}

interface Leg {
  s: number;
  k: number;
  hip: V3;
  knee: V3;
  ankle: V3;
  foot: V3;
  raised: number;
}

interface Skel {
  B: V3;
  rot: (v: V3) => V3;
  hc: V3;
  hrot: (v: V3) => V3;
  hk: number;
  abd: V3;
  arot: (v: V3) => V3;
  abdS: number;
  legs: Leg[];
}

interface Lag {
  /** Брюшко отстаёт от тела. */
  abX: number;
  abZ: number;
  /** Отмычки качаются за пальпами. */
  pkL: number;
  pkR: number;
  /** Паутина дрожит от жетона. */
  wob: number;
}

const bodyAt = (o: Pose): V3 => [B0[0] + o.bx + o.gx, B0[1] + o.by + o.gy, B0[2] + o.bz + o.air];

export function skel(o: Pose, lag: Lag): Skel {
  const B = bodyAt(o);
  const sqv = (v: V3): V3 => [v[0] * (1 + o.sq * 0.4), v[1] * (1 + o.sq * 0.3), v[2] * (1 - o.sq)];
  const rot = (v: V3): V3 => yawZ(rollY(pitchX(sqv(v), o.pitch), o.lean), o.turn);
  const hc = add(B, rot(HEAD_L));
  const hrot = (v: V3): V3 => rot(pitchX(v, o.nod));
  const hk = HI ? 1 : 1.08;
  const arot = (v: V3): V3 => rot(pitchX(v, o.abdUp));
  const abd = add(add(B, rot(add(PED_L, pitchX(sub(ABD_L, PED_L), o.abdUp)))), [
    (lag.abX - B[0]) * 0.8,
    0,
    (lag.abZ - B[2]) * 0.7,
  ]);
  const legs: Leg[] = [];
  for (const s of [-1, 1])
    for (let k = 0; k < 4; k++) {
      const H = HIP[k];
      const hip = add(B, rot(sub([H[0] * s, H[1], H[2]], B0)));
      const F = FOOT[k];
      const dir = norm([F[0] - H[0], F[1] - H[1], 0]);
      const out = o.splay * 3.5 - o.tuck * 5;
      let foot: V3 = [
        F[0] * s + dir[0] * s * out,
        F[1] + dir[1] * out + o[strideKey(s, k)],
        o[liftKey(s, k)],
      ];
      let raised = 0;
      if (k === 0) {
        raised = s < 0 ? o.raiseL : o.raiseR;
        if (raised > 0) {
          const tgt: V3 = [s * (15 + o.spread * 4), 9 + o.spread * 2, 36 - o.spread * 13];
          foot = lerp3(foot, tgt, raised);
        }
        foot = add(foot, s < 0 ? [o.fLx, 0, o.fLz] : [o.fRx, 0, o.fRz]);
      }
      // Весь паук: сдвиг и прыжок (в воздухе лапы чуть свисают).
      foot = add(foot, [o.gx, o.gy, o.air * 0.82]);
      const ankle0 = ankleOf(hip, foot, raised);
      let pole: V3 = [POLE[k][0] * s, POLE[k][1], POLE[k][2]];
      pole = lerp3(pole, [s, 0.15, -0.2], raised);
      // Поджатая: колено в сторону и назад, низко — не «клетка» вокруг тела.
      pole = lerp3(pole, [s, -0.75, 0.15], o.tuck);
      // Поднятая лапа чуть тянется (мультяшно): иначе кончик не выходит из-за брюшка.
      const st = 1 + 0.12 * raised;
      const [knee, ankle] = ik(hip, ankle0, LF[k] * st, LT[k] * st, norm(pole));
      foot = add(ankle, sub(foot, ankle0));
      legs.push({ s, k, hip, knee, ankle, foot, raised });
    }
  return { B, rot, hc, hrot, hk, abd, arot, abdS: 1 + o.abd, legs };
}

// ---------------------------------------------------------------------------
// Части.
// ---------------------------------------------------------------------------

interface Ctx {
  o: Pose;
  S: Skel;
  lag: Lag;
  t: number;
}

/** Часть с выбором палитры по точке на ней (хохолок, кольца коленей). */
interface PartF extends Part {
  pick?: (qx: number, qy: number, qz: number) => number;
  /** Свет как у трубы: нормаль без составляющей вдоль оси — лапы не «бусы». */
  tube?: boolean;
}
/** Сдвиг тона, который `pick` возвращает вместе с палитрой. */
let PICK_T = 0;

let NEXT_ID = 0;
const nid = () => ++NEXT_ID;
let PROP_IDS: number[] = [];

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

/** Прядь: капля остриём к кончику, кончик светлее (волоски со светлыми концами). */
function hair(
  out: PartF[],
  base: V3,
  dir: V3,
  len: number,
  wid: number,
  pal: number,
  bias: number,
  tipLit = 0.12,
  id = nid(),
): void {
  const ax = axes(dir, VIEW);
  for (const [u, rl, rw, db] of [
    [0.3, 0.42, 1, 0],
    [0.62, 0.3, 0.64, tipLit * 0.5],
    [0.86, 0.18, 0.34, tipLit],
  ] as [number, number, number, number][]) {
    out.push({
      c: add(base, mul(dir, len * u)),
      ax,
      r: [len * rl, wid * rw, wid * Math.max(0.5, rw)],
      pal,
      id,
      bias: bias + db,
    });
  }
}

/**
 * Волоски от ЛОКАЛЬНЫХ координат части (контур не «кипит»): тёмная масса, по
 * ней короткие пряди вдоль меридианов от макушки, кончик пряди светлее.
 */
function furTex(n: number, m: number, amp: number, seed: number) {
  return (qx: number, qy: number, qz: number) => {
    const lat = (Math.acos(Math.max(-1, Math.min(1, qz))) / Math.PI) * m;
    const j = Math.floor(lat);
    const fl = lat - j;
    const lon = (Math.atan2(qx, qy) / TAU + 0.5) * n + (j & 1) * 0.5;
    const i = Math.floor(lon);
    const fo = lon - i;
    const h = hash(i, j, seed);
    const off = 0.3 + 0.4 * hash(i, j, seed + 1);
    if (h > 0.42 && Math.abs(fo - off) < 0.2 && fl > 0.12 && fl < 0.95)
      return amp * (0.35 + 0.65 * fl);
    return h < 0.2 ? -amp * 0.45 : -amp * 0.1;
  };
}

/** Точка опоры эллипсоида в направлении `d` (на контуре, если `d` поперёк взгляда). */
function support(r: V3, d: V3): V3 {
  const q: V3 = [d[0] * r[0] * r[0], d[1] * r[1] * r[1], d[2] * r[2] * r[2]];
  const l = Math.sqrt(d[0] ** 2 * r[0] ** 2 + d[1] ** 2 * r[1] ** 2 + d[2] ** 2 * r[2] ** 2) || 1;
  return mul(q, 1 / l);
}
/** Направление в плоскости кадра: 0 — вправо, π/2 — вверх. */
const SCR_UP: V3 = [0, -VIEW[2], VIEW[1]];
const scrDir = (phi: number): V3 => add(mul([1, 0, 0], Math.cos(phi)), mul(SCR_UP, Math.sin(phi)));

/** Пряди по контуру шара (в его покое) — локальные основания и направления. */
function rimHairs(r: V3, n: number, a0: number, a1: number, seed: number) {
  const res: { b: V3; d: V3; L: number }[] = [];
  for (let j = 0; j < n; j++) {
    const phi = lerp(a0, a1, (j + 0.5) / n) + (hash(j, 3, seed) - 0.5) * 0.12;
    const d = scrDir(phi);
    const b = mul(support(r, d), 0.9);
    const dd = norm(add(d, [0, -0.3, -0.12]));
    res.push({ b, d: dd, L: j % 2 ? 0.7 : 1 });
  }
  return res;
}
const ABD_HAIR = {
  s: rimHairs(ABD_R, 15, -0.42, Math.PI + 0.42, 5),
  l: rimHairs(ABD_R, 38, -0.55, Math.PI + 0.55, 9),
};
const HEAD_HAIR = {
  s: rimHairs(HEAD_R, 7, 0.25, Math.PI - 0.25, 11),
  l: rimHairs(HEAD_R, 14, 0.15, Math.PI - 0.15, 13),
};

function abdPick(qx: number, qy: number, qz: number): number {
  PICK_T = 0;
  const e = qz * 0.9 + qy * 0.4 - qx * qx * 0.9;
  const n = (hash(Math.floor(qx * 9 + 20), Math.floor(qy * 9 + 20), 17) - 0.5) * 0.1;
  if (e + n > 0.8) {
    PICK_T = e > 0.93 ? 0.04 : -0.06;
    return P_BAND;
  }
  return P_FUR;
}

function abdomen(out: PartF[], c: Ctx): void {
  const { S } = c;
  const r = mul(ABD_R, S.abdS);
  const ax = [S.arot([1, 0, 0]), S.arot([0, 1, 0]), S.arot([0, 0, 1])] as [V3, V3, V3];
  out.push({
    c: S.abd,
    ax,
    r,
    pal: P_FUR,
    id: nid(),
    pick: abdPick,
    tex: HI ? furTex(60, 15, 0.26, 3) : furTex(26, 7, 0.14, 3),
    bias: -0.13,
  });
  // Пряди по контуру: обрывистый край шара.
  for (const h of HI ? ABD_HAIR.l : ABD_HAIR.s) {
    const b = add(S.abd, S.arot(mul(h.b, S.abdS)));
    const d = S.arot(h.d);
    const L = (HI ? 2.9 : 2.6) * h.L;
    hair(out, b, d, L, HI ? 0.62 : 0.95, P_FUR, -0.1, 0.26);
  }
  // Рыжий хохолок: пучок прядей торчком на макушке брюшка.
  const top = add(S.abd, S.arot([0, ABD_R[1] * 0.3 * S.abdS, ABD_R[2] * 0.93 * S.abdS]));
  const n = HI ? 9 : 5;
  for (let j = 0; j < n; j++) {
    const u = (j + 0.5) / n - 0.5;
    const d = norm(S.arot([u * 1.6, 0.25 - Math.abs(u) * 0.3, 1]));
    const b = add(top, S.arot([u * 6, -Math.abs(u) * 1.5, -0.6]));
    hair(out, b, d, (HI ? 2.4 : 2.2) * (j % 2 ? 0.75 : 1), HI ? 0.8 : 0.95, P_BAND, -0.05, 0.12);
  }
}

function head(out: PartF[], c: Ctx): void {
  const { o, S } = c;
  const k = S.hk;
  const ax = [S.hrot([1, 0, 0]), S.hrot([0, 1, 0]), S.hrot([0, 0, 1])] as [V3, V3, V3];
  const at = (p: V3): V3 => add(S.hc, S.hrot(mul(p, k)));
  out.push({
    c: S.hc,
    ax,
    r: mul(HEAD_R, k),
    pal: P_FUR,
    id: nid(),
    tex: HI ? furTex(40, 10, 0.24, 7) : furTex(18, 5, 0.1, 7),
    bias: -0.08,
  });
  for (const h of HI ? HEAD_HAIR.l : HEAD_HAIR.s) {
    hair(out, at(h.b), S.hrot(h.d), (HI ? 1.7 : 1.9) * h.L, HI ? 0.65 : 0.85, P_FUR, -0.04, 0.2);
  }
  // Хелицеры: два пушистых бугра под глазами; раскрываясь, расходятся.
  const f = o.fang;
  for (const s of [-1, 1]) {
    out.push({
      c: at([s * (2.4 + f * 0.9), 6.1 + f * 0.6, -2.6 - f * 0.4]),
      ax: [
        S.hrot(rollY([1, 0, 0], s * f * 0.25)),
        S.hrot([0, 1, 0]),
        S.hrot(rollY([0, 0, 1], s * f * 0.25)),
      ],
      r: mul([2.6, 2.4, 3.1], k),
      pal: P_FUR,
      id: nid(),
      tex: HI ? furTex(20, 6, 0.2, 21 + s) : undefined,
      bias: -0.02,
    });
    // Клыки: костяной коготь вниз и внутрь; раскрытый — длиннее и врозь.
    const fb = at([s * (1.9 + f * 1.3), 7.6 + f * 0.8, -5.0 - f * 0.4]);
    const fd = norm(S.hrot([-s * (0.7 - f * 1.3), 0.3 + f * 0.25, -1]));
    hair(out, fb, fd, (1.9 + f * 1.6) * k, (HI ? 0.62 : 0.7) * k, P_FANG, 0.02, -0.12);
  }
  // Пасть между хелицерами — видна, когда раскрыты.
  if (f > 0.25) {
    out.push({
      c: at([0, 5.8, -3.6]),
      ax,
      r: mul([0.4 + f * 1.3, 1.2, 1.4 + f * 0.8], k),
      pal: P_MOUTH,
      id: nid(),
      noSeam: true,
      bias: -0.2,
    });
  }
}

/** Кольцо колена (начало голени) и светлое кольцо у щиколотки. */
function shinPick(qx: number): number {
  PICK_T = 0;
  if (qx < -0.58) {
    PICK_T = qx < -0.8 ? -0.05 : 0.04;
    return P_BAND;
  }
  if (HI && qx > 0.56 && qx < 0.72) {
    PICK_T = -0.08;
    return P_BAND;
  }
  return P_LEG;
}

function legParts(out: PartF[], c: Ctx): void {
  const { S } = c;
  for (const L of S.legs) {
    const fr = L.k === 0 ? 1.55 : L.k === 3 ? 1.35 : 1.45;
    const tr = fr * 0.86;
    const idF = nid();
    // Поднятая лапа ближе к нам — на ступень светлее, не тонет в коленях соседей.
    const lb = L.raised * 0.08;
    limb(out, L.hip, L.knee, fr, fr * 0.92, P_LEG, idF, { tube: true, bias: -0.02 + lb });
    limb(out, L.knee, L.ankle, tr, tr * 0.92, P_LEG, nid(), {
      tube: true,
      bias: lb,
      pick: (qx) => shinPick(qx),
    });
    limb(out, L.ankle, L.foot, tr * 0.72, tr * 0.7, P_LEG, nid(), { tube: true, bias: -0.06 });
    // Волоски торчат из лапы наружу.
    const segs: [V3, V3, number[], number][] = [
      [L.hip, L.knee, HI ? [0.45, 0.7, 0.9] : [0.7], fr],
      [L.knee, L.ankle, HI ? [0.3, 0.55, 0.8] : [0.45], tr],
    ];
    for (const [p, q, us, rr] of segs) {
      const d = norm(sub(q, p));
      const sv: V3 = [L.s, 0, 0.55];
      const h = norm(sub(sv, mul(d, dot(sv, d))));
      for (const u of us) {
        const b = add(lerp3(p, q, u), mul(h, rr * 0.55));
        hair(
          out,
          b,
          norm(add(h, mul(d, 0.45))),
          HI ? 1.5 : 1.7,
          HI ? 0.5 : 0.62,
          P_LEG,
          0.06,
          0.12,
        );
      }
    }
  }
}

/** Педипальпы: короткие лапки у морды; кончики держат отмычку и натяжитель. */
function palpAt(c: Ctx, s: number): { base: V3; joint: V3; tip: V3 } {
  const { o, S } = c;
  const k = S.hk;
  const lift = s < 0 ? o.palpL : o.palpR;
  const at = (p: V3): V3 => add(S.hc, S.hrot(mul(p, k)));
  const base = at([s * 4.3, 4.6, -3.2]);
  const joint = at([s * 6.4, 7.6, -2.6 + lift * 1.2]);
  const tip = at([s * 6.6, 9.6, -4.6 + lift * 2.6]);
  return { base, joint, tip };
}

function palpParts(out: PartF[], c: Ctx): void {
  for (const s of [-1, 1]) {
    const { base, joint, tip } = palpAt(c, s);
    limb(out, base, joint, 1.15, 1.05, P_LEG, nid(), { tube: true, bias: 0.04 });
    limb(out, joint, tip, 1.0, 0.95, P_LEG, nid(), {
      tube: true,
      pick: (qx) => {
        PICK_T = 0;
        return qx < -0.45 ? P_BAND : P_LEG;
      },
    });
  }
}

/** Отмычка (справа) и натяжитель (слева): стальные прутья от кончиков пальп. */
function toolLines(c: Ctx): { a: V3; b: V3; w: number; tone: number }[] {
  const { o, lag } = c;
  const res: { a: V3; b: V3; w: number; tone: number }[] = [];
  for (const s of [-1, 1]) {
    const { tip } = palpAt(c, s);
    const sway = (s < 0 ? lag.pkL + o.tlL : lag.pkR + o.tlR) + o.lean;
    const d = norm(rollY([s * 0.3, 0.12, 1], sway));
    const a = add(tip, [0, 0.5, 0.2]);
    const L = s > 0 ? 7.6 : 6.6;
    const b = add(a, mul(d, L));
    res.push({ a, b, w: 0.9, tone: 7 });
    if (HI) res.push({ a: add(a, mul(d, -0.3)), b: add(a, mul(d, 2.4)), w: 1.5, tone: 4 });
    if (s > 0) {
      // Крючок отмычки: загнут наружу и вверх.
      const hk = rollY([1.25, 0, 0.55], sway);
      res.push({ a: b, b: add(b, hk), w: 0.9, tone: 7 });
    } else {
      // Натяжитель: буква «Г» наружу.
      const hk = rollY([-2.2, 0, -0.2], sway);
      res.push({ a: b, b: add(b, hk), w: 0.9, tone: 6 });
    }
  }
  return res;
}

/** Стальной прут прямо в кадр (с глубиной): малая — линия в пиксель, крупная — толще, блик сверху. */
function rod(f: Frame, a: V3, b: V3, wid: number, tone: number): void {
  const K = RR * SC;
  const A = project(mul(a, K));
  const Bp = project(mul(b, K));
  const ax = OX + A[0];
  const ay = OY + A[1];
  const bx = OX + Bp[0];
  const by = OY + Bp[1];
  const rad = (wid * K) / 2;
  const N = PAL[P_STEEL].length;
  const put = (x: number, y: number, d: number, tn: number) => {
    if (x < 0 || y < 0 || x >= f.w || y >= f.h) return;
    const i = y * f.w + x;
    if (d <= f.zb[i]) return;
    f.zb[i] = d;
    f.pal[i] = P_STEEL;
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
        lerp(A[2], Bp[2], u) + 0.8 * K,
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
      // Сторона к свету (вверх-влево) светлее.
      const side = (-dy * -0.7 + dx * -0.7) / ln;
      const lit = (ex * -dy + ey * dx) / ln;
      const tn = tone + (lit * side > 0.15 * rad ? 1 : lit * side < -0.3 * rad ? -2 : 0);
      put(x, y, lerp(A[2], Bp[2], u) + 0.8 * K, tn);
    }
}

/** Жетон: летит справа дугой, крутится; влип — в середине паутины. */
function tokenAt(c: Ctx): { p: V3; spin: number } | null {
  const { o, t } = c;
  if (o.tok < 0) return null;
  const W = webCenter(c);
  const start: V3 = [34, 6, 30];
  const peak: V3 = [18, 8, 36];
  const u = o.tok;
  const e = 1 - (1 - u) ** 1.5;
  const p = u < 1 ? bezQ(start, peak, W, e) : W;
  return { p: add(p, [0, 0.6, 0]), spin: u < 1 ? (t * 13) % TAU : 0.35 };
}

function tokenParts(out: PartF[], c: Ctx): void {
  const T = tokenAt(c);
  if (!T) return;
  const w = Math.max(0.35, Math.abs(Math.cos(T.spin)));
  const r = 2.3;
  const id = nid();
  PROP_IDS.push(id);
  out.push({
    c: T.p,
    ax: axes(norm([Math.cos(T.spin), Math.sin(T.spin), 0]), [0, 0, 1]),
    r: [r * w + 0.15, 0.5, r],
    pal: P_TOKEN,
    id,
    bias: 0.1,
    noSeam: true,
    tex: (qx, _qy, qz) => (qx * qx + qz * qz > 0.55 ? -0.12 : qx * qx + qz * qz < 0.12 ? 0.14 : 0),
  });
}

// ---------------------------------------------------------------------------
// Свой растр: части с выбором палитры.
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

/** Крупная: редкая шахматка на границе двух ступеней одной части — мягкий переход. */
function softBands(f: Frame): void {
  const { w, h, pal, tone, idb } = f;
  const hit: number[] = [];
  for (let y = 0; y < h - 1; y++)
    for (let x = 0; x < w - 1; x++) {
      const i = y * w + x;
      const pl = pal[i];
      if (pl !== P_FUR && pl !== P_LEG) continue;
      for (const j of [i + w, i + 1]) {
        if (pal[j] === pl && idb[j] === idb[i] && tone[j] === tone[i] - 1 && dith(x, y, 0.28))
          hit.push(j, tone[i]);
      }
    }
  for (let n = 0; n < hit.length; n += 2) f.tone[hit[n]] = hit[n + 1];
}

// ---------------------------------------------------------------------------
// Поверх кадра: глаза, румянец, паутина, лучи укуса, сон.
// ---------------------------------------------------------------------------

function eyePal(): Record<string, RGBA> {
  return {
    k: hx('#0a0710'),
    K: hx('#0a0710'),
    c: hx('#1c1630'),
    m: hx('#3a2f60'),
    l: hx('#6c5ea2'),
    W: hx('#ffffff'),
    w: hx('#cfc6ec'),
    e: V === 1 ? hx('#fff2c8') : hx('#eadcc6'),
    p: V === 1 ? hx('#e07a52') : hx('#c86a58'),
    q: V === 1 ? hx('#c45c3c') : hx('#a4524a'),
  };
}
// Малая: глаз — бусина 4×4, блик сверху-слева, отсвет снизу-справа.
const EYES_S: Record<string, string[]> = {
  open: ['.kk.', 'kWck', 'kcmk', '.kk.'],
  half: ['....', 'kkkk', 'kcmk', '.kk.'],
  shut: ['....', '....', 'eeee', '....'],
  happy: ['....', '.ee.', 'e..e', '....'],
  sleep: ['....', 'e..e', '.ee.', '....'],
  angry: ['k...', 'kkk.', 'kWck', '.kk.'],
};
// Крупная: большой стеклянный глаз 9×9 — ободок, глубина, два блика, отсвет.
const EYES_L: Record<string, string[]> = {
  open: [
    '..kkkkk..',
    '.kWWccck.',
    'kWWWcccck',
    'kWWcccccK',
    'kcccccmck',
    'kccccmmck',
    'kccmmlwck',
    '.kcmmlck.',
    '..kkkkk..',
  ],
  half: [
    '.........',
    '.........',
    '..kkkkk..',
    'kkkkkkkkk',
    'kcccccmck',
    'kccccmmck',
    'kccmmlwck',
    '.kcmmlck.',
    '..kkkkk..',
  ],
  shut: [
    '.........',
    '.........',
    '.........',
    '.........',
    'e.......e',
    '.eeeeeee.',
    '.........',
    '.........',
    '.........',
  ],
  happy: [
    '.........',
    '.........',
    '...eee...',
    '..e...e..',
    '.e.....e.',
    'e.......e',
    '.........',
    '.........',
    '.........',
  ],
  sleep: [
    '.........',
    '.........',
    '.........',
    'e.......e',
    '.e.....e.',
    '..eeeee..',
    '.........',
    '.........',
    '.........',
  ],
  angry: [
    'kk.......',
    'kkkk.....',
    'kkkkkkk..',
    'kWWccckkK',
    'kWWcccccK',
    'kccccmmck',
    'kccmmlwck',
    '.kcmmlck.',
    '..kkkkk..',
  ],
};
/** У этих глаз стороны разные (наклон века); у круглых блик слева у обоих — свет один. */
const EYE_FLIP = new Set(['angry']);
const SMALL_L = ['.k.', 'kWk', '.k.'];

function face(p: Px, f: Frame, c: Ctx): void {
  const { o, S } = c;
  const ep = eyePal();
  const at = (q: V3): V3 => mul(add(S.hc, S.hrot(mul(q, S.hk))), RR * SC);
  for (const side of [-1, 1] as const) {
    const e = seen(f, at([side * 3.0, 6.7, 1.8]), OX, OY, 2.2 * RR);
    if (!e) continue;
    let key: string = o.eye;
    if (key === 'open' || key === 'angry' || key === 'wide') {
      if (key === 'wide') key = 'open';
      if (o.blink > 0.7) key = 'shut';
      else if (o.blink > 0.25) key = 'half';
    }
    const rows = HI ? EYES_L[key] : EYES_S[key];
    const wdt = rows[0].length;
    const flip = side > 0 && EYE_FLIP.has(key);
    stamp(p, rows, ep, e[0] - Math.floor(wdt / 2), e[1] - Math.floor(rows.length / 2), flip);
    // Румянец под глазом.
    const bl = seen(f, at([side * 5.4, 5.3, -0.9]), OX, OY, 2.2 * RR);
    if (bl && o.eye !== 'angry') {
      if (HI) stamp(p, ['.pp.', 'pqqp'], ep, bl[0] - 2, bl[1] - 1);
      else p.set(bl[0], bl[1], ep.q);
    }
  }
  // Четыре маленьких глаза над большими (во сне закрыты).
  if (o.eye !== 'sleep' && o.blink < 0.5) {
    for (const [x, y, z] of [
      [-1.3, 6.0, 4.6],
      [1.3, 6.0, 4.6],
      [-3.9, 5.1, 4.1],
      [3.9, 5.1, 4.1],
    ] as V3[]) {
      const e = seen(f, at([x, y, z]), OX, OY, 2 * RR);
      if (!e) continue;
      if (HI) stamp(p, SMALL_L, ep, e[0] - 1, e[1] - 1);
      else if (Math.abs(x) < 2) p.set(e[0], e[1], ep.w);
    }
  }
}

/** Паутина между поднятыми лапами: спицы, потом спираль от середины. */
const WEB_L: V3 = [0, 11.5, 17];
const WEB_RX = 11;
function webCenter(c: Ctx): V3 {
  const { S, lag } = c;
  return add(add(S.B, S.rot(WEB_L)), [0, -lag.wob * 1.6, -lag.wob * 1.2]);
}

function web(p: Px, f: Frame, c: Ctx): void {
  const { o, S } = c;
  const w = o.web;
  const L = S.legs.find((l) => l.s < 0 && l.k === 0)!;
  const R = S.legs.find((l) => l.s > 0 && l.k === 0)!;
  const C = webCenter(c);
  const K = RR * SC;
  const NS = 8;
  // Концы спиц по эллипсу; боковые — на кончиках поднятых лап.
  const ends: V3[] = [];
  for (let j = 0; j < NS; j++) {
    const a = (j / NS) * TAU;
    const rr = WEB_RX * (0.9 + 0.14 * hash(j, 1, 31));
    ends.push(add(C, S.rot([Math.cos(a) * rr, 0, Math.sin(a) * rr * 0.86])));
  }
  ends[1] = lerp3(ends[1], R.foot, R.raised);
  ends[3] = lerp3(ends[3], L.foot, L.raised);
  const line = (a: V3, b: V3, col: RGBA) => {
    const A = project(mul(a, K));
    const B = project(mul(b, K));
    const ax = OX + A[0];
    const ay = OY + A[1];
    const bx = OX + B[0];
    const by = OY + B[1];
    const n = Math.max(1, Math.round(Math.max(Math.abs(bx - ax), Math.abs(by - ay))));
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const x = Math.floor(lerp(ax, bx, u));
      const y = Math.floor(lerp(ay, by, u));
      if (x < 0 || y < 0 || x >= p.w || y >= p.h) continue;
      const j = y * p.w + x;
      const d = lerp(A[2], B[2], u);
      if (f.pal[j] >= 0 && f.zb[j] > d + 0.6 * K) continue;
      if (!dith(x, y, o.prop * 1.02)) continue;
      p.set(x, y, col);
    }
  };
  const sp = clamp01(w / 0.45);
  for (let j = 0; j < NS; j++) line(C, lerp3(C, ends[j], sp), SILK);
  // Спираль: кольца по спицам, каждое — от середины наружу.
  const rings = 4;
  for (let r = 1; r <= rings; r++) {
    const k0 = 0.45 + (r - 1) * 0.12;
    const g = clamp01((w - k0) / 0.12);
    if (g <= 0) continue;
    const fr = r / (rings + 0.6);
    const segs = Math.round(NS * g);
    for (let j = 0; j < segs; j++) {
      const a = lerp3(C, ends[j], fr);
      const b = lerp3(C, ends[(j + 1) % NS], fr);
      line(a, b, r % 2 ? SILK_DIM : SILK);
    }
  }
}

/** Укус: короткие лучи от клыков — только по пустому. */
function snap(p: Px, mask: Uint8Array, c: Ctx): void {
  const { o, S } = c;
  const K = RR * SC;
  const m = project(mul(add(S.hc, S.hrot(mul([0, 8, -6], S.hk))), K));
  const cx = OX + m[0];
  const cy = OY + m[1];
  const g = o.bite;
  const col = mixc(hx('#fff6e0'), hx('#f0c070'), g);
  for (const a of [-2.6, -2.1, -1.57, -1.05, -0.55, 0.5, 1.0, 2.15, 2.65]) {
    const r0 = (HI ? 14 : 7) + g * (HI ? 10 : 5);
    const r1 = r0 + (HI ? 7 : 3) * (1 - g * 0.6);
    const n = Math.ceil(r1 - r0) + 1;
    for (let i = 0; i <= n; i++) {
      const rr = lerp(r0, r1, i / n);
      const x = Math.round(cx + Math.cos(a) * rr);
      const y = Math.round(cy + Math.sin(a) * rr * 0.85);
      if (x < 0 || y < 0 || x >= p.w || y >= p.h || mask[y * p.w + x]) continue;
      p.set(x, y, col);
      if (HI) {
        const x2 = x + (Math.abs(Math.sin(a)) > 0.7 ? 1 : 0);
        const y2 = y + (Math.abs(Math.sin(a)) > 0.7 ? 0 : 1);
        if (!mask[y2 * p.w + x2]) p.set(x2, y2, col);
      }
    }
  }
}

/** Искра на жетоне, когда влип. */
function spark(p: Px, c: Ctx): void {
  const { o, t } = c;
  if (o.tok < 1 || o.prop <= 0) return;
  const T = tokenAt(c);
  if (!T) return;
  const g = clamp01((t - STICK_T) / 0.3);
  if (g >= 1) return;
  const K = RR * SC;
  const pr = project(mul(T.p, K));
  const x = Math.round(OX + pr[0] + 3 * K);
  const y = Math.round(OY + pr[1] - 3 * K);
  const L = Math.round((HI ? 4 : 2) * (1 - g * 0.5));
  const w = hx('#ffffff');
  const a = hx('#e4fff8');
  p.set(x, y, w);
  for (let d = 1; d <= L; d++) {
    const cc = d === 1 ? w : a;
    p.set(x - d, y, cc);
    p.set(x + d, y, cc);
    p.set(x, y - d, cc);
    p.set(x, y + d, cc);
  }
}

/** Сон: буквы «z» поднимаются над головой и тают. */
const Z_S = ['zzz', '.z.', 'zzz'];
const Z_L = ['zzzz', '..z.', '.z..', 'zzzz'];
function zzz(p: Px, mask: Uint8Array, c: Ctx): void {
  const { S, t } = c;
  const col = hx('#f4ead8');
  for (let j = 0; j < 2; j++) {
    const u = wrap(t / 1.5 + j * 0.5, 1);
    const [sx, sy] = project(mul(add(S.hc, [6 + 4 * u, 0, 10 + 10 * u]), RR));
    const x0 = Math.round(OX + sx);
    const y0 = Math.round(OY + sy);
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

const LAGS = new Map<string, Lag>();

/** Пружины вторичного движения: от начала анимации (разовой) или на две петли назад. */
export function lagOf(a: Anim, t: number): Lag {
  const key = `${a}:${t}`;
  const hit = LAGS.get(key);
  if (hit) return hit;
  const T = dur(a);
  const t0 = LOOP[a] ? t - 2 * T : 0;
  const P = (tt: number) => poseAt(a, LOOP[a] ? wrap(tt, T) : Math.max(0, tt));
  const env = LOOP[a] ? 1 : clamp01((T - t) / 0.2);
  const L0 = LOOP[a] ? null : lagOf('idle', 0);
  const P0 = poseAt('idle', 0);
  const B0p = bodyAt(P0);
  const lagged = (fn: (tt: number) => number, freq: number, damp: number, off: number) => {
    const now = fn(t);
    const d = spring(fn, t, t0, freq, damp) - now;
    return now + d * env + (L0 ? off * (1 - env) : 0);
  };
  const r: Lag = {
    abX: lagged((tt) => bodyAt(P(tt))[0], 2.6, 0.22, (L0?.abX ?? 0) - B0p[0]),
    abZ: lagged((tt) => bodyAt(P(tt))[2], 2.8, 0.2, (L0?.abZ ?? 0) - B0p[2]),
    pkL: 0,
    pkR: 0,
    wob: 0,
  };
  // Отмычки качаются за пальпами (только запаздывание), паутина дрожит от жетона.
  const sw = (fn: (tt: number) => number, freq: number, damp: number, k: number, cap: number) => {
    const d = (spring(fn, t, t0, freq, damp) - fn(t)) * env;
    return Math.max(-cap, Math.min(cap, d * k));
  };
  r.pkL =
    sw((tt) => P(tt).palpL * 2 + bodyAt(P(tt))[2] * 0.3, 3.2, 0.16, -0.32, 0.5) +
    (L0 ? L0.pkL * (1 - env) : 0);
  r.pkR =
    sw((tt) => P(tt).palpR * 2 + bodyAt(P(tt))[2] * 0.3, 3.0, 0.16, 0.32, 0.5) +
    (L0 ? L0.pkR * (1 - env) : 0);
  r.wob = sw((tt) => P(tt).wob, 3.4, 0.14, -1, 1) + (L0 ? L0.wob * (1 - env) : 0);
  LAGS.set(key, r);
  return r;
}

function toRes(parts: PartF[]): PartF[] {
  const K = RR * SC;
  if (K === 1) return parts;
  return parts.map((pt) => ({ ...pt, c: mul(pt.c, K), r: mul(pt.r, K) }));
}

/** Кадр `i` анимации `a` полосы `res`, вариант окраса `v` (0 — обычный, 1 — золотой). */
export function spiderFrame(a: Anim, i: number, res: Res = 's', v = 0): Px {
  const cv = RES[res];
  RR = cv.box / RES.s.box;
  HI = res === 'l';
  OX = cv.bx + cv.box / 2;
  OY = cv.by + GROUND * RR;
  V = v === 1 ? 1 : 0;
  NEXT_ID = 0;
  PROP_IDS = [];
  const t = i / FPS;
  const o = poseAt(a, t);
  SC = o.scale;
  const lag = lagOf(a, t);
  const S = skel(o, lag);
  const c: Ctx = { o, S, lag, t };
  PAL = PAL_V[V];
  const f = newFrame(cv.cw, cv.ch);
  const parts: PartF[] = [];
  abdomen(parts, c);
  head(parts, c);
  legParts(parts, c);
  palpParts(parts, c);
  tokenParts(parts, c);
  drawPartsF(f, toRes(parts), PAL, OX, OY);
  for (const r of toolLines(c)) rod(f, r.a, r.b, r.w, r.tone);
  if (PROP_IDS.length && o.prop < 1) {
    // Жетон тает шахматкой вместе с паутиной.
    for (let j = 0; j < f.w * f.h; j++) {
      if (!PROP_IDS.includes(f.idb[j])) continue;
      if (dith(j % f.w, Math.floor(j / f.w), o.prop)) continue;
      f.pal[j] = -1;
      f.idb[j] = -1;
      f.zb[j] = -1e9;
    }
  }
  seams(f, 1.2 * RR, 1);
  rimLight(f, PAL, (pl) => pl === P_FUR || pl === P_LEG || pl === P_BAND);
  if (HI) softBands(f);
  const p = toPx(f, PAL);
  selOutline(p, INK_V[V], 0.8);
  const mask = new Uint8Array(p.w * p.h);
  for (let j = 0; j < mask.length; j++) mask[j] = p.data[j * 4 + 3] > 0 ? 1 : 0;
  face(p, f, c);
  if (o.web >= 0 && o.prop > 0) web(p, f, c);
  spark(p, c);
  if (o.bite >= 0) snap(p, mask, c);
  if (a === 'sleep') zzz(p, mask, c);
  return p;
}
