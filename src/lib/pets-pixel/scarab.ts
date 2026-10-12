// Жук-скарабей — пиксельный питомец по эталону боссов 12–14.
//
// Пухлый навозный жук в три четверти к нам, низко на шести лапах: большой
// круглый купол надкрылий со швом посередине — металлический изумруд, к краям
// медь и фиолет, сильный блик полосой и кант; глянцевый переднеспинный щит;
// широкий плоский щиток головы с зубцами («грабли»); круглые глаза с бликом;
// короткие усики с веером-булавой из трёх пластинок, которые раскрываются и
// складываются на пружинах. Передние голени плоские, с зубцами копателя,
// задние длиннее — ими катят шар.
//
// Две полосы своего рисунка: малая — рамка 48 (шахта, списки), крупная —
// рамка 112 (карточка, вылупление, Питомник): бороздки надкрылий, зубцы
// голеней, коготки, пластинки булавы, звёзды на жетонах.
//
// Лапы — две кости и лапка (IK от тазика к стопе). Стопы заданы в позе в
// координатах мира и стоят, пока лапа не шагнёт: шаг идёт по расписанию, лапа
// встаёт туда, где её «дом» в момент приземления, — стопы не скользят.
// Ходьба — треножник (Л1 П2 Л3 / П1 Л2 П3).
//
// Трюк «скатывает в шар всё, что блестит»: блёстки слетаются в шарик, шар
// растёт → жук разворачивается, встаёт на голову и пятится на передних лапах,
// толкая шар средними и задними (шар катится: угол = путь / радиус) → шар
// бьётся о камень, трескается, сыплются жетоны → жук встаёт на лапы, ставит
// лапку на жетон, гордится; реквизит тает, всё в позе покоя.
//
// Золотой рисуется здесь же (`v` = 1): египетский золотой скарабей — золото с
// бронзовой глубиной, бело-золотой блик, лазуритовые глаза и булавы усиков.

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

const P_SHELL = 0;
const P_COPPER = 1;
const P_BODY = 2;
const P_CLUB = 3;
const P_GOLD = 4;
const P_TOKEN = 5;
const P_RUBY = 6;
const P_STONE = 7;
const P_WING = 8;
const P_INNER = 9;
const P_HEAD = 10;

const GOLD = ramp(
  '#241002',
  '#3e2006',
  '#5e340a',
  '#80500e',
  '#a26c16',
  '#c28a20',
  '#dcaa30',
  '#f0c84c',
  '#fce27e',
  '#fff6c8',
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
const RUBY = ramp(
  '#22040c',
  '#420a18',
  '#661226',
  '#8c1c34',
  '#b42c44',
  '#d8485a',
  '#f07478',
  '#ffaaa4',
  '#ffd8d0',
);
const STONE = ramp(
  '#141110',
  '#221e1c',
  '#322c28',
  '#443c36',
  '#574e46',
  '#6c6258',
  '#82786c',
  '#9c9284',
  '#b8ae9e',
);
const WING = ramp('#241a18', '#3c2e28', '#5a4840', '#7c6658', '#9e8672', '#bea68e', '#dcc8ae', '#f2e6d2');
const INNER = ramp('#0a0608', '#160c0e', '#241416', '#341e1e', '#462a26', '#5a3830');

const PAL_V: RGBA[][][] = [
  [
    // Надкрылья: фиолетовая тень → бирюза → изумруд → светлая зелень → белый блик.
    ramp(
      '#07080f',
      '#141432',
      '#1c2450',
      '#163e5a',
      '#105a5c',
      '#0f7a56',
      '#1c9a52',
      '#3cb856',
      '#7ad468',
      '#c2ee9c',
      '#f4fff0',
    ),
    // Медь на скользящем крае купола (со стороны света).
    ramp(
      '#100608',
      '#2a0e10',
      '#481a14',
      '#6c2c18',
      '#90421c',
      '#b05c22',
      '#cc7a30',
      '#e49c48',
      '#f4c072',
      '#ffe2ac',
      '#fff8ea',
    ),
    // Лапы и брюшко: бронзово-чёрные, тёплый свет сверху.
    ramp(
      '#060508',
      '#100c10',
      '#1a1418',
      '#261c1e',
      '#342624',
      '#44322c',
      '#583f34',
      '#6e503e',
      '#88664c',
      '#a6825e',
    ),
    // Булава усиков: янтарь.
    ramp(
      '#2a1406',
      '#46220a',
      '#683610',
      '#8c4e18',
      '#b06a22',
      '#cc8a30',
      '#e4ac46',
      '#f4cc6c',
      '#fff0b0',
    ),
    GOLD,
    TOKEN,
    RUBY,
    STONE,
    WING,
    INNER,
    // Голова и щиток: медная бронза — тёплые «грабли» перед зелёным щитом.
    ramp(
      '#0e0806',
      '#22120c',
      '#3a2012',
      '#563018',
      '#74441e',
      '#925a26',
      '#b07432',
      '#c89442',
      '#dcb45e',
      '#eed28a',
      '#fff0c4',
    ),
  ],
  [
    // Золотой: бронза в тени → золото → бело-золотой блик.
    ramp(
      '#120802',
      '#261204',
      '#3e1e06',
      '#5c300a',
      '#7c460e',
      '#9c6014',
      '#ba7e1c',
      '#d6a02a',
      '#ecc244',
      '#fae27e',
      '#ffffff',
    ),
    // Край купола — красная бронза (глубина).
    ramp(
      '#100404',
      '#260a06',
      '#40140a',
      '#5e220c',
      '#7e3410',
      '#9e4a16',
      '#ba6420',
      '#d2842e',
      '#e8aa48',
      '#f8d27a',
      '#fff0c0',
    ),
    // Лапы — тёмная бронза.
    ramp(
      '#0a0502',
      '#180c04',
      '#261406',
      '#361e0a',
      '#4a2a0e',
      '#603814',
      '#784a1a',
      '#925e22',
      '#ae782e',
      '#c8963e',
    ),
    // Булава — лазурит.
    ramp(
      '#060a24',
      '#0c1640',
      '#142460',
      '#1c3484',
      '#2648a8',
      '#3462c8',
      '#5082e0',
      '#7aa6f0',
      '#b4d0fa',
    ),
    GOLD,
    TOKEN,
    RUBY,
    STONE,
    WING,
    INNER,
    // Голова и щиток — красная бронза: читаются на золотом щите.
    ramp(
      '#0c0402',
      '#1e0a04',
      '#341408',
      '#4e200c',
      '#6a3010',
      '#884418',
      '#a45a20',
      '#c0782c',
      '#d89a40',
      '#ecc060',
      '#fae49c',
    ),
  ],
];
const INK_V: RGBA[] = [hx('#05060c'), hx('#170b02')];

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

const TAU = Math.PI * 2;
const smooth = (u: number) => u * u * (3 - 2 * u);
const pos = (v: number) => Math.max(0, v);

// ---------------------------------------------------------------------------
// Модель: части в осях тела (x — вправо, y — вперёд, z — вверх), от точки
// опоры тела, в пикселях малой полосы до общего масштаба `KB`.
// ---------------------------------------------------------------------------

const KB = 1.42;
const kb = (v: V3): V3 => [v[0] * KB, v[1] * KB, v[2] * KB];
/** Высота точки опоры тела над землёй. */
const H0 = 6.0 * KB;
/** Поворот покоя: голова вправо-к нам (три четверти). */
const YAW0 = 0.32;
/** Жук стоит чуть глубже: передние лапки не уходят под рамку. */
const ROOT_Y0 = -3.4;

const BELLY_C: V3 = [0, -3.0, -1.8];
const BELLY_R: V3 = [7.2, 10.4, 2.8];
const ELY_C: V3 = [0, -5.0, 2.4];
const ELY_R: V3 = [8.6, 9.6, 7.4];
const PRO_C: V3 = [0, 4.2, 0.8];
const PRO_R: V3 = [7.4, 4.6, 4.3];
const NECK: V3 = [0, 7.6, -0.4];
const HEAD_C: V3 = [0, 9.0, -0.4];
const HEAD_R: V3 = [4.8, 3.4, 2.4];
const CLY_C: V3 = [0, 11.8, -1.4];
const CLY_R: V3 = [7.4, 4.6, 1.1];
const CLY_TILT = 0.22;
const EYE: V3 = [3.2, 11.0, 1.6];
const ANT: V3 = [4.4, 11.6, -0.4];
/** Бороздки надкрылий (крупная). */
const STRIAE = [0.3, 0.55, 0.77];

interface LegDef {
  hip: V3;
  home: V3;
  /** Стойка на голове (передние лапы под головой). */
  hs: V3;
  lf: number;
  lt: number;
  tar: number;
  pole: V3;
}
// Правая сторона (левая — зеркально); k: 0 — передняя, 1 — средняя, 2 — задняя.
const LEG: LegDef[] = [
  {
    hip: [4.0, 6.0, -2.6],
    home: [8.8, 12.0, 0],
    hs: [8.4, 12.6, 0],
    lf: 4.4,
    lt: 4.6,
    tar: 1.6,
    pole: [1, 0.4, 1.1],
  },
  {
    hip: [5.4, 0.2, -3.0],
    home: [11.8, 1.6, 0],
    hs: [11.8, 1.6, 0],
    lf: 4.6,
    lt: 5.0,
    tar: 1.8,
    pole: [1, 0, 1.1],
  },
  {
    hip: [5.0, -5.2, -3.0],
    home: [11.0, -12.0, 0],
    hs: [11.0, -12.0, 0],
    lf: 5.4,
    lt: 6.4,
    tar: 2.0,
    pole: [1, -0.4, 1.1],
  },
];
/** Номер лапы: 0 Л1, 1 П1, 2 Л2, 3 П2, 4 Л3, 5 П3. */
const sideOf = (i: number) => (i % 2 ? 1 : -1);
const kOf = (i: number) => i >> 1;
/** Треножники: Л1 П2 Л3 и П1 Л2 П3. */
const TRI_A = [0, 3, 4];
const TRI_B = [1, 2, 5];

interface Root {
  x: number;
  y: number;
  yaw: number;
}
const ROOT0: Root = { x: 0, y: ROOT_Y0, yaw: YAW0 };

/** Дом стопы в мире при корне `r` (`hs` — стойка на голове). */
function homeW(i: number, r: Root, hs = false): V3 {
  const D = LEG[kOf(i)];
  const h = hs ? D.hs : D.home;
  const p = yawZ([sideOf(i) * h[0] * KB, h[1] * KB, 0], r.yaw);
  return [r.x + p[0], r.y + p[1], 0];
}

// ---------------------------------------------------------------------------
// Поза.
// ---------------------------------------------------------------------------

type Eye = 'open' | 'happy' | 'angry' | 'sleep' | 'wide';
type FootKey = `f${0 | 1 | 2 | 3 | 4 | 5}${'x' | 'y' | 'z'}`;

export interface Pose extends Record<FootKey, number> {
  /** Корень (где стоит, куда смотрит) — к нему привязаны дома стоп. */
  rx: number;
  ry: number;
  yaw: number;
  /** Сдвиг всего жука вместе со стопами (бросок) и прыжок. */
  gx: number;
  gy: number;
  air: number;
  /** Только тело над стопами: сдвиг в осях корня, высота. */
  bx: number;
  by: number;
  bz: number;
  /** Наклон: + — голова вниз; крен; сплющивание; масштаб броска к зрителю. */
  pitch: number;
  lean: number;
  sq: number;
  scale: number;
  /** Голова: кивок (+ вниз) и поворот. */
  nod: number;
  hturn: number;
  /** Дыхание купола (−1…1). */
  breath: number;
  /** Булавы усиков: веер 0…1; усик: −1 — прижат назад, 1 — поднят. */
  fanL: number;
  fanR: number;
  antL: number;
  antR: number;
  /** Надкрылья раскрыты (0…1), крылья жужжат (0…1). */
  ely: number;
  buzz: number;
  eye: Eye;
  blink: number;
  /** Отлив, бегущий по куполу (−2 — нет). */
  shim: number;
  /** Блеск начищенного щитка (−1 — нет). */
  glint: number;
  /** Шар: радиус (−1 — нет), центр, угол качения, трещина (0…1). */
  ballR: number;
  ballX: number;
  ballY: number;
  ballRot: number;
  crack: number;
  /** Камень, реквизит (тает), время с раскола (−1 — нет), пыль и лучи атаки. */
  stone: number;
  prop: number;
  tokT: number;
  dust: number;
  rays: number;
}

const FKEYS = [0, 1, 2, 3, 4, 5].map(
  (i) => [`f${i}x`, `f${i}y`, `f${i}z`] as [FootKey, FootKey, FootKey],
);
function footOf(o: Pose, i: number): V3 {
  const [x, y, z] = FKEYS[i];
  return [o[x], o[y], o[z]];
}
function setFoot(o: Pose, i: number, p: V3): void {
  const [x, y, z] = FKEYS[i];
  o[x] = p[0];
  o[y] = p[1];
  o[z] = p[2];
}
function feetHome(o: Pose, r: Root): void {
  for (let i = 0; i < 6; i++) setFoot(o, i, homeW(i, r));
}

const REST: Pose = (() => {
  const o = {
    rx: ROOT0.x,
    ry: ROOT0.y,
    yaw: YAW0,
    gx: 0,
    gy: 0,
    air: 0,
    bx: 0,
    by: 0,
    bz: 0,
    pitch: 0,
    lean: 0,
    sq: 0,
    scale: 1,
    nod: 0,
    hturn: 0,
    breath: 0,
    fanL: 0.3,
    fanR: 0.3,
    antL: 0,
    antR: 0,
    ely: 0,
    buzz: 0,
    eye: 'open',
    blink: 0,
    shim: -2,
    glint: -1,
    ballR: -1,
    ballX: 0,
    ballY: 0,
    ballRot: 0,
    crack: 0,
    stone: 0,
    prop: 0,
    tokT: -1,
    dust: -1,
    rays: -1,
  } as unknown as Pose;
  feetHome(o, ROOT0);
  return o;
})();

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
// Тело в мире: точка опоры, повороты тела и головы.
// ---------------------------------------------------------------------------

interface BodyF {
  B: V3;
  /** Точка тела (вектор от опоры, уже с KB) → смещение в мире; `Rd` — направление без сплющивания. */
  R: (v: V3) => V3;
  Rd: (v: V3) => V3;
  N: V3;
  HR: (v: V3) => V3;
  HRd: (v: V3) => V3;
  sq: (r: V3) => V3;
}

function bodyFrame(o: Pose): BodyF {
  const off = yawZ([o.bx, o.by, 0], o.yaw);
  const B: V3 = [o.rx + o.gx + off[0], o.ry + o.gy + off[1], H0 + o.bz + o.air];
  const sqv = (v: V3): V3 => [v[0] * (1 + o.sq * 0.35), v[1] * (1 + o.sq * 0.2), v[2] * (1 - o.sq)];
  const Rd = (v: V3): V3 => yawZ(rollY(pitchX(v, o.pitch), o.lean), o.yaw);
  const R = (v: V3): V3 => Rd(sqv(v));
  const N = add(B, R(kb(NECK)));
  const HRd = (v: V3): V3 => Rd(yawZ(pitchX(v, o.nod), o.hturn));
  const HR = (v: V3): V3 => HRd(sqv(v));
  return { B, R, Rd, N, HR, HRd, sq: sqv };
}
/** Точка тела (координаты модели до KB) → мир. */
const bodyAt = (F: BodyF, p: V3): V3 => add(F.B, F.R(kb(p)));
/** Точка головы (координаты модели до KB) → мир. */
const headAt = (F: BodyF, p: V3): V3 => add(F.N, F.HR(kb(sub(p, NECK))));

// ---------------------------------------------------------------------------
// Дорожки анимаций.
// ---------------------------------------------------------------------------

/** Покой: лапы переступают на месте, вес с боку на бок, начищает щиток. */
const TAPS: [number, number, number][] = [
  // лапа, момент, подъём
  [2, 0.45, 1.3],
  [5, 0.95, 1.1],
  [3, 2.3, 1.2],
  [4, 2.72, 1.1],
];
/** Точка щитка, которую начищает правая передняя лапа (координаты головы). */
const GROOM: V3 = [4.6, 13.6, -1.2];

function idlePose(t: number): Pose {
  const T = dur('idle');
  const o: Pose = { ...REST };
  const br = (TAU * t) / 1.5;
  o.breath = Math.sin(br);
  o.bz = 0.2 * Math.sin(br - 0.6);
  o.lean = 0.03 * Math.sin((TAU * t) / T);
  o.bx = 0.35 * Math.sin((TAU * t) / T);
  o.hturn = 0.1 * Math.sin((TAU * t) / T + 1.2);
  o.nod = 0.04 * Math.sin((TAU * t) / T * 2 + 0.3);
  // Веера булав раскрываются и складываются вразнобой.
  o.fanL = 0.3 + 0.32 * pos(Math.sin((TAU * t) / T * 2 + 0.4)) + 0.4 * bump(wrap(t - 0.2, T), 0, 0.5);
  o.fanR = 0.3 + 0.32 * pos(Math.sin((TAU * t) / T * 2 + 2.2)) + 0.4 * bump(wrap(t - 1.6, T), 0, 0.5);
  o.antL = 0.15 * Math.sin((TAU * t) / T + 0.5);
  o.antR = 0.15 * Math.sin((TAU * t) / T + 2.1);
  for (const [i, t0, L] of TAPS) {
    const u = wrap(t - t0, T);
    const b = bump(u, 0, 0.3);
    if (b <= 0) continue;
    const h = homeW(i, ROOT0);
    setFoot(o, i, [h[0], h[1], L * b]);
  }
  // Начищает щиток: лапа к краю щитка, два мазка, потом блеск.
  const gw = clamp01((t - 1.0) / 0.14) * clamp01((1.86 - t) / 0.14);
  if (gw > 0) {
    const F = bodyFrame(o);
    const stroke = Math.sin(TAU * ((t - 1.14) / 0.3));
    const tgt = headAt(F, [GROOM[0] - 0.2 * stroke, GROOM[1] - 1.1 * stroke, GROOM[2] + 0.4]);
    const h = homeW(1, ROOT0);
    const k = smooth(gw);
    setFoot(o, 1, [lerp(h[0], tgt[0], k), lerp(h[1], tgt[1], k), lerp(0, tgt[2], k)]);
    o.nod += 0.08 * k;
    o.hturn += 0.12 * k;
  }
  const gl = (t - 1.84) / 0.36;
  o.glint = gl >= 0 && gl < 1 ? gl : -1;
  o.blink = bump(wrap(t - 2.5, T), 0, 0.2);
  // Отлив бежит по куполу от головы к хвосту раз за петлю.
  const sh = (t - 0.2) / 1.3;
  o.shim = sh >= 0 && sh < 1 ? lerp(1.2, -1.2, sh) : -2;
  return o;
}

/** Ходьба на месте: треножник, стопы в опоре едут назад ровно, тело покачивается. */
function walkPose(t: number): Pose {
  const T = dur('walk');
  const o: Pose = { ...REST };
  const ph = wrap(t, T) / T;
  const fwd = yawZ([0, 1, 0], YAW0);
  for (let i = 0; i < 6; i++) {
    const g = TRI_A.includes(i) ? 0 : 1;
    const u = wrap(ph + g * 0.5, 1);
    const S = [1.7, 1.9, 1.7][kOf(i)] * KB;
    let lift = 0;
    let st: number;
    if (u < 0.5) {
      const w = u / 0.5;
      lift = 1.9 * Math.sin(Math.PI * w);
      st = lerp(-S, S, smooth(w));
    } else st = lerp(S, -S, (u - 0.5) / 0.5);
    const h = homeW(i, ROOT0);
    setFoot(o, i, [h[0] + fwd[0] * st, h[1] + fwd[1] * st, lift]);
  }
  o.bz = 0.3 * Math.cos(TAU * 2 * ph) - 0.1;
  o.lean = 0.045 * Math.sin(TAU * ph);
  o.bx = 0.3 * Math.sin(TAU * ph);
  o.hturn = 0.05 * Math.sin(TAU * ph + 0.6);
  o.breath = 0.5 * Math.sin(TAU * 2 * ph);
  o.fanL = 0.45;
  o.fanR = 0.45;
  o.antL = 0.12 + 0.1 * Math.sin(TAU * 2 * ph + 1);
  o.antR = 0.12 + 0.1 * Math.sin(TAU * 2 * ph + 1.6);
  return o;
}

/** Радость: присел → надкрылья раскрылись, крылья жужжат, подскок → закрыл на приземлении. */
function happyPose(t: number): Pose {
  const T = dur('happy');
  const o: Pose = { ...REST };
  o.bz = kf(t, [
    [0, 0],
    [0.1, -1.4, 'o'],
    [0.18, 0.5],
    [0.6, 0],
    [0.66, -1.0, 'o'],
    [0.78, 0.2],
    [0.9, 0],
  ]);
  o.air = kf(t, [
    [0, 0],
    [0.16, 0],
    [0.38, 6.5, 'o'],
    [0.62, 0, 'i'],
  ]);
  o.sq = kf(t, [
    [0, 0],
    [0.1, 0.1],
    [0.18, -0.06],
    [0.3, 0],
    [0.62, 0],
    [0.66, 0.12],
    [0.78, 0],
  ]);
  o.ely = kf(t, [
    [0, 0],
    [0.08, 0],
    [0.2, 1, 'o'],
    [0.62, 1],
    [0.8, 0, 'i'],
  ]);
  o.buzz = kf(t, [
    [0, 0],
    [0.16, 0],
    [0.22, 1],
    [0.58, 1],
    [0.68, 0],
  ]);
  o.pitch = kf(t, [
    [0, 0],
    [0.1, 0.08],
    [0.3, -0.16],
    [0.6, -0.05],
    [0.7, 0.05],
    [0.85, 0],
  ]);
  o.fanL = kf(t, [
    [0, REST.fanL],
    [0.12, 1],
    [0.8, 1],
    [1.0, REST.fanL],
  ]);
  o.fanR = o.fanL;
  o.antL = kf(t, [
    [0, 0],
    [0.12, 0.75],
    [0.8, 0.75],
    [1.0, 0],
  ]);
  o.antR = o.antL;
  // После приземления — радостное покачивание.
  const d = clamp01((t - 0.7) / 0.05) * clamp01((1.0 - t) / 0.08);
  o.lean = 0.07 * d * Math.sin((TAU * (t - 0.7)) / 0.3);
  o.eye = t > 0.06 && t < T - 0.1 ? 'happy' : 'open';
  return settle(o, t, T);
}

// ---------------------------------------------------------------------------
// Трюк: шар из блёсток.
// ---------------------------------------------------------------------------

/** Лицом влево — собирает шар; спиной к шару — толкает. */
const YAW_G = -1.3;
const YAW_P = YAW_G + Math.PI;
/** Направление «вперёд» при сборе = куда покатится шар. */
const FG: V3 = [Math.sin(YAW_G), Math.cos(YAW_G), 0];
/** Ось качения: шар катится по FG, верх уходит вперёд. */
const AXR: V3 = norm(cross([0, 0, 1], FG));
const D_PUSH = 6;
const BALL_R = 8;
const BALL_R0 = 2.2;
/** Кончик щитка от корня (по оси тела). */
const TIP = (CLY_C[1] + CLY_R[1]) * KB;
/** Где стоит, пока собирает шар (отступил, чтобы толчок вернул его на место). */
const R_G: Root = { x: ROOT0.x - FG[0] * D_PUSH, y: ROOT0.y - FG[1] * D_PUSH, yaw: YAW_G };
const ballAtGather = (r: number): V3 => [
  R_G.x + FG[0] * (TIP + 0.6 + r),
  R_G.y + FG[1] * (TIP + 0.6 + r),
  r,
];
const BALL_E: V3 = add(ballAtGather(BALL_R), mul(FG, D_PUSH));
/** Камень, о который бьётся шар: касание на высоте его середины. */
const STONE_R: V3 = [4.4, 4.0, 5.0];
const STONE_Z = STONE_R[2] * 0.88;
const STONE_D = Math.sqrt(BALL_R * BALL_R - (BALL_R - STONE_Z) ** 2) + STONE_R[0] - 0.2;
const STONE_C: V3 = [BALL_E[0] + FG[0] * STONE_D, BALL_E[1] + FG[1] * STONE_D, STONE_Z];
/** Стойка на голове: наклон, подъём опоры, сдвиг тела назад (к шару). */
const HS_P = 0.36;
const HS_BZ = 2.2;
const HS_BY = -2.2;
const T_BUMP = 1.44;
const T_BURST = 1.52;

/** Корень в трюке: поворот к месту сбора, отступ, разворот, толчок, поворот назад. */
function workRoot(t: number): Root {
  const yaw = kf(t, [
    [0, YAW0],
    [0.03, YAW0],
    [0.28, YAW_G, 'o'],
    [0.64, YAW_G],
    [0.84, YAW_P],
    [1.62, YAW_P],
    [1.8, YAW0],
  ]);
  const u = kf(t, [
    [0, 0],
    [0.05, 0],
    [0.3, 1],
    [1.0, 1],
    [T_BUMP, 0],
  ]);
  return { x: lerp(ROOT0.x, R_G.x, u), y: lerp(ROOT0.y, R_G.y, u), yaw };
}
/** Сколько шар прокатился к моменту `t`. */
const rolled = (t: number) => {
  const r = workRoot(t);
  return D_PUSH - Math.hypot(r.x - ROOT0.x, r.y - ROOT0.y);
};

interface Step {
  i: number;
  a: number;
  b: number;
  h: number;
  hs?: boolean;
  to?: V3;
}
const tri = (g: number[], a: number, b: number, h = 1.6): Step[] =>
  g.map((i) => ({ i, a, b, h }));

/** Блёстки: откуда летят, когда прилипают, что это (0 — монета, 1 — бирюза, 2 — рубин). */
const GLINTS: { from: V3; arr: number; kind: number }[] = [
  { from: [-38, 2, 20], arr: 0.22, kind: 0 },
  { from: [30, 0, 32], arr: 0.27, kind: 1 },
  { from: [-34, -8, 30], arr: 0.32, kind: 0 },
  { from: [32, 6, 24], arr: 0.37, kind: 2 },
  { from: [-40, 8, 12], arr: 0.42, kind: 1 },
  { from: [26, -8, 36], arr: 0.47, kind: 0 },
  { from: [-28, 10, 28], arr: 0.53, kind: 2 },
  { from: [34, 2, 16], arr: 0.58, kind: 0 },
];
const G_FLY = 0.24;
function gatherR(t: number): number {
  if (t < GLINTS[0].arr) return -1;
  let n = 0;
  for (const g of GLINTS) n += smooth(clamp01((t - g.arr) / 0.06));
  return lerp(BALL_R0, BALL_R, clamp01((n - 1) / (GLINTS.length - 1)));
}

/** Жетоны из шара: где коснулись земли, где легли, наклон на земле. */
interface Tok {
  l1: V3;
  t1: number;
  l2: V3;
  t2: number;
  tilt: number;
  spin: number;
}
const TOK_P: V3 = add(homeW(0, ROOT0), [-4.4, 0.4, 0]);
const TOK_SPOTS: [number, number, number, number, number][] = [
  // смещение места касания и места покоя от центра шара (по x, y), наклон
  [6, 8, 7.5, 10, 0.95],
  [-5, 7, -6.5, 9.5, 1.05],
  [10, 3, 12.5, 4.5, 0.9],
  [1, 11, 1.5, 13.5, 1.1],
  [-9, 2, -10.5, 3.5, 1.0],
];
const TOKS: Tok[] = [
  {
    l1: lerp3(BALL_E, TOK_P, 0.72),
    t1: 0.17,
    l2: TOK_P,
    t2: 0.1,
    tilt: 0.55,
    spin: 15,
  },
  ...TOK_SPOTS.map(([x1, y1, x2, y2, tilt], j) => ({
    l1: [BALL_E[0] + x1, BALL_E[1] + y1, 0] as V3,
    t1: 0.15 + 0.02 * j,
    l2: [BALL_E[0] + x2, BALL_E[1] + y2, 0] as V3,
    t2: 0.08 + 0.01 * j,
    tilt,
    spin: 11 + 3 * j,
  })),
];
const TOK_R = 2.4;
const GRAV = 260;
/** Жетон через `tt` с раскола: центр и нормаль. */
function tokAt(k: Tok, tt: number): { p: V3; n: V3 } {
  const restZ = TOK_R * Math.sin(k.tilt) + 0.3;
  const b0: V3 = [BALL_E[0], BALL_E[1], BALL_R * 0.9];
  const nRest = norm([0, Math.sin(k.tilt), Math.cos(k.tilt)]);
  if (tt < k.t1) {
    const u = tt / k.t1;
    const vz = (0.5 * GRAV * k.t1 * k.t1 - (b0[2] - restZ)) / k.t1;
    const z = b0[2] + vz * tt - 0.5 * GRAV * tt * tt;
    const a = k.spin * tt;
    return {
      p: [lerp(b0[0], k.l1[0], u), lerp(b0[1], k.l1[1], u), z],
      n: norm([Math.cos(a), 0.6, Math.sin(a)]),
    };
  }
  const t2 = tt - k.t1;
  if (t2 < k.t2) {
    const u = t2 / k.t2;
    const z = restZ + 0.5 * GRAV * t2 * (k.t2 - t2);
    const a = k.spin * k.t1 + k.spin * 0.6 * t2;
    return {
      p: [lerp(k.l1[0], k.l2[0], u), lerp(k.l1[1], k.l2[1], u), z],
      n: norm(lerp3(norm([Math.cos(a), 0.6, Math.sin(a)]), nRest, smooth(u))),
    };
  }
  return { p: [k.l2[0], k.l2[1], restZ], n: nRest };
}
const TOK_TOP: V3 = add(tokAt(TOKS[0], 1).p, [0, 0, 1.2]);

const WORK_STEPS: Step[] = [
  // Поворот к месту сбора и отступ.
  ...tri(TRI_A, 0.02, 0.09),
  ...tri(TRI_B, 0.09, 0.16),
  ...tri(TRI_A, 0.16, 0.23),
  ...tri(TRI_B, 0.23, 0.3),
  ...tri(TRI_A, 0.3, 0.36),
  // Разворот спиной к шару.
  ...tri(TRI_B, 0.64, 0.69),
  ...tri(TRI_A, 0.69, 0.74),
  ...tri(TRI_B, 0.74, 0.79),
  ...tri(TRI_A, 0.79, 0.84),
  // Передние — в стойку на голове; средние и задние — на шар (поверх расписания).
  { i: 1, a: 0.86, b: 0.93, h: 1.3, hs: true },
  { i: 0, a: 0.9, b: 0.97, h: 1.3, hs: true },
  ...[2, 3, 4, 5].map((i) => ({ i, a: 0.86, b: 1.6, h: 0 })),
  // Пятится на передних.
  { i: 0, a: 1.02, b: 1.09, h: 1.2, hs: true },
  { i: 1, a: 1.09, b: 1.16, h: 1.2, hs: true },
  { i: 0, a: 1.16, b: 1.23, h: 1.2, hs: true },
  { i: 1, a: 1.23, b: 1.3, h: 1.2, hs: true },
  { i: 0, a: 1.3, b: 1.37, h: 1.2, hs: true },
  { i: 1, a: 1.37, b: 1.44, h: 1.2, hs: true },
  { i: 0, a: 1.42, b: 1.48, h: 1.0, hs: true },
  // Слез с головы.
  { i: 1, a: 1.52, b: 1.58, h: 1.2 },
  { i: 0, a: 1.55, b: 1.61, h: 1.2 },
  // Поворот к нам; Л1 — на жетон, потом домой.
  ...tri(TRI_B, 1.62, 1.68),
  ...tri([3, 4], 1.66, 1.72),
  ...tri(TRI_B, 1.72, 1.78),
  { i: 0, a: 1.72, b: 1.79, h: 2.4, to: TOK_TOP },
  ...tri([3, 4], 1.78, 1.84),
  ...tri(TRI_B, 1.8, 1.86),
  { i: 0, a: 1.88, b: 1.95, h: 1.4 },
].sort((p, q) => p.a - q.a);

/** Стопа по расписанию шагов: стоит, пока не шагнёт; встаёт в дом корня на миг приземления. */
function planted(i: number, t: number): V3 {
  let p = homeW(i, workRoot(0));
  for (const st of WORK_STEPS) {
    if (st.i !== i) continue;
    if (t < st.a) break;
    const to = st.to ?? homeW(i, workRoot(st.b), st.hs ?? false);
    if (t < st.b) {
      const u = (t - st.a) / (st.b - st.a);
      const w = smooth(u);
      return [lerp(p[0], to[0], w), lerp(p[1], to[1], w), lerp(p[2], to[2], w) + st.h * Math.sin(Math.PI * u)];
    }
    p = to;
  }
  return p;
}

/** Точка на шаре под лапой `i` (средние — ниже, задние — выше середины). */
function ballContact(i: number, C: V3): V3 {
  const side = yawZ([sideOf(i), 0, 0], YAW_P);
  const back: V3 = [-FG[0], -FG[1], 0];
  const k = kOf(i);
  const n = norm(add(add(mul(back, 0.84), mul(side, k === 2 ? 0.42 : 0.55)), [0, 0, k === 2 ? 0.34 : -0.2]));
  return add(C, mul(n, BALL_R));
}

/** Трюк (2 с): шар из блёсток → стойка на голове, толкает → раскол, жетоны → гордость. */
function workPose(t: number): Pose {
  const T = dur('work');
  const o: Pose = { ...REST };
  const r = workRoot(t);
  o.rx = r.x;
  o.ry = r.y;
  o.yaw = r.yaw;
  o.pitch = kf(t, [
    [0, 0],
    [0.3, 0.06],
    [0.62, 0.06],
    [0.7, 0],
    [0.86, 0],
    [1.0, HS_P, 'o'],
    [1.46, HS_P],
    [T_BURST, HS_P + 0.05],
    [1.6, -0.1, 'i'],
    [1.68, 0.04],
    [1.76, -0.07],
    [1.92, 0],
  ]);
  o.bz = kf(t, [
    [0, 0],
    [0.86, 0],
    [1.0, HS_BZ, 'o'],
    [1.48, HS_BZ],
    [1.6, -0.6, 'i'],
    [1.7, 0],
  ]);
  o.by = kf(t, [
    [0, 0],
    [0.86, 0],
    [1.0, HS_BY],
    [1.48, HS_BY],
    [1.6, 0],
  ]);
  // Толкает: тело подпрыгивает в такт шагам передних лап, покачивается.
  const pw = clamp01((t - 1.0) / 0.04) * clamp01((T_BUMP - t) / 0.04);
  o.bz += 0.28 * pw * Math.abs(Math.sin((TAU * (t - 1.02)) / 0.14));
  o.lean = 0.05 * pw * Math.sin((TAU * (t - 1.02)) / 0.28);
  o.nod = kf(t, [
    [0, 0],
    [0.3, 0.14],
    [0.62, 0.14],
    [0.7, 0],
    [0.86, 0],
    [1.0, 0.18],
    [1.46, 0.18],
    [1.6, 0],
    [1.76, -0.12],
    [1.92, 0],
  ]);
  o.hturn = kf(t, [
    [0, 0],
    [0.2, -0.12],
    [0.35, 0.12],
    [0.5, -0.08],
    [0.62, 0],
  ]);
  o.fanL = kf(t, [
    [0, REST.fanL],
    [0.12, 1],
    [0.64, 1],
    [0.8, 0.6],
    [1.0, 0.25],
    [1.44, 0.25],
    [1.52, 1],
    [1.6, 0.8],
    [1.72, 1],
    [1.88, 1],
    [1.96, REST.fanL],
  ]);
  o.fanR = o.fanL;
  o.antL = kf(t, [
    [0, 0],
    [0.12, 0.4],
    [0.64, 0.4],
    [0.86, 0],
    [1.0, -0.6],
    [1.46, -0.6],
    [1.54, 0.6],
    [1.66, 0.2],
    [1.76, 0.7],
    [1.9, 0.7],
    [1.96, 0],
  ]);
  o.antR = o.antL;
  o.eye =
    t > 0.14 && t < 0.64
      ? 'wide'
      : t >= 1.0 && t < 1.42
        ? 'angry'
        : t >= T_BUMP && t < 1.6
          ? 'wide'
          : t >= 1.76 && t < 1.92
            ? 'happy'
            : 'open';
  // Стопы: по расписанию; средние и задние в стойке — на шаре.
  const gr = gatherR(t);
  const C: V3 =
    t < 1.0
      ? ballAtGather(Math.max(gr, BALL_R0))
      : add(ballAtGather(BALL_R), mul(FG, Math.min(D_PUSH, rolled(t))));
  const hb = smooth(clamp01((t - 0.86) / 0.11)) * smooth(clamp01((1.6 - t) / 0.1));
  for (let i = 0; i < 6; i++) {
    let p = planted(i, t);
    if (i >= 2 && hb > 0) {
      const cp = ballContact(i, C);
      p = lerp3(p, cp, hb);
      p[2] += 1.2 * Math.sin(Math.PI * hb) * (t < 1.2 ? 1 : 0.6);
    }
    // Пока шар растёт, передние лапы похлопывают его по очереди.
    if (i < 2 && gr > 0 && t < 0.64) {
      const pat = i === 0 ? bump(t, 0.3, 0.42) + bump(t, 0.52, 0.63) : bump(t, 0.41, 0.53);
      if (pat > 0) {
        const n = norm(add(sub(p, C), [0, 0, gr * 1.4]));
        p = lerp3(p, add(C, mul(n, gr + 0.2)), pat);
      }
    }
    setFoot(o, i, p);
  }
  // Реквизит.
  if (t < 1.95) {
    o.ballR = t < 1.0 ? gr : BALL_R;
    o.ballX = C[0];
    o.ballY = C[1];
    o.ballRot = t < 1.0 ? 0 : rolled(t) / BALL_R;
  }
  o.crack = t >= T_BURST && t < 1.95 ? clamp01((t - T_BURST) / 0.12) : 0;
  o.stone = kf(t, [
    [0, 0],
    [0.9, 0],
    [1.04, 1],
    [1.8, 1],
    [1.94, 0],
  ]);
  o.prop = t < 1.8 ? 1 : clamp01((1.94 - t) / 0.14);
  o.tokT = t >= T_BURST && t < 1.95 ? t - T_BURST : -1;
  return settle(o, t, T, 0.06);
}

/** Атака: присел, щиток вниз → бросок головой вперёд к зрителю (бульдозер), пыль → назад. */
function attackPose(t: number): Pose {
  const T = dur('attack');
  const o: Pose = { ...REST };
  o.bz = kf(t, [
    [0, 0],
    [0.26, -1.6, 'o'],
    [0.34, 0.3, 'i'],
    [0.5, 0],
    [0.7, 0],
  ]);
  o.pitch = kf(t, [
    [0, 0],
    [0.26, 0.22, 'o'],
    [0.36, 0.3],
    [0.5, 0.12],
    [0.72, 0],
  ]);
  o.by = kf(t, [
    [0, 0],
    [0.26, -1.6, 'o'],
    [0.36, 2.4, 'i'],
    [0.52, 1.2],
    [0.78, 0],
  ]);
  o.yaw = kf(t, [
    [0, YAW0],
    [0.26, YAW0 + 0.1],
    [0.36, 0.16],
    [0.56, 0.2],
    [0.8, YAW0],
  ]);
  o.gy = kf(t, [
    [0, 0],
    [0.28, 0],
    [0.38, 4, 'o'],
    [0.56, 4],
    [0.82, 0],
  ]);
  o.scale = kf(t, [
    [0, 1],
    [0.28, 1],
    [0.38, 1.16, 'o'],
    [0.56, 1.12],
    [0.82, 1],
  ]);
  o.air = kf(t, [
    [0, 0],
    [0.28, 0],
    [0.33, 1.8, 'o'],
    [0.38, 0, 'i'],
  ]);
  o.sq = kf(t, [
    [0, 0],
    [0.24, 0.08],
    [0.36, -0.04],
    [0.4, 0.08],
    [0.52, 0],
  ]);
  o.antL = kf(t, [
    [0, 0],
    [0.2, -1],
    [0.62, -1],
    [0.84, 0],
  ]);
  o.antR = o.antL;
  o.fanL = kf(t, [
    [0, REST.fanL],
    [0.2, 0],
    [0.62, 0],
    [0.84, REST.fanL],
  ]);
  o.fanR = o.fanL;
  // Тряска после удара.
  const sh = bump(t, 0.38, 0.58);
  o.lean = 0.07 * sh * Math.sin((TAU * (t - 0.38)) / 0.08);
  o.dust = t >= 0.36 && t < 0.66 ? clamp01((t - 0.36) / 0.3) : -1;
  o.rays = t >= 0.36 && t < 0.54 ? clamp01((t - 0.36) / 0.18) : -1;
  o.eye = t > 0.04 && t < 0.72 ? 'angry' : 'open';
  return settle(o, t, T, 0.14);
}

/** Сон: прижался боком к своему шару, щиток на земле, усики сложены, дышит. */
const SLEEP_BALL_R = 5.4;
const SLEEP_BALL: V3 = (() => {
  const p = yawZ([12.6 * KB, 3.6 * KB, 0], YAW0);
  return [ROOT0.x + p[0], ROOT0.y + p[1], SLEEP_BALL_R];
})();
function sleepPose(t: number): Pose {
  const T = dur('sleep');
  const o: Pose = { ...REST };
  const br = (TAU * t) / T;
  o.breath = Math.sin(br);
  o.bz = -1.6 + 0.16 * Math.sin(br);
  o.pitch = 0.1;
  o.nod = 0.22;
  o.hturn = 0.1;
  o.antL = -1;
  o.antR = -1;
  o.fanL = 0;
  o.fanR = 0;
  o.eye = 'sleep';
  // Лапы поджаты; правые обнимают шар.
  for (let i = 0; i < 6; i++) {
    const h = homeW(i, ROOT0);
    const c: V3 = [ROOT0.x, ROOT0.y, 0];
    let p = lerp3(c, h, 0.78);
    if (i === 1 || i === 3) {
      const back = norm(sub([ROOT0.x, ROOT0.y, SLEEP_BALL_R], SLEEP_BALL));
      const n = norm(add(back, [0, 0, i === 1 ? 0.55 : -0.05]));
      p = add(SLEEP_BALL, mul(n, SLEEP_BALL_R));
    }
    setFoot(o, i, p);
  }
  o.ballR = SLEEP_BALL_R;
  o.ballX = SLEEP_BALL[0];
  o.ballY = SLEEP_BALL[1];
  o.ballRot = 0.7;
  o.prop = 1;
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
// Лапы: две кости и лапка.
// ---------------------------------------------------------------------------

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
  const end = add(knee, mul(norm(sub(b, knee)), l2));
  return [knee, end];
}

interface Leg {
  i: number;
  s: number;
  k: number;
  hip: V3;
  knee: V3;
  ankle: V3;
  foot: V3;
  out: V3;
}

export function legsOf(o: Pose, F: BodyF): Leg[] {
  const legs: Leg[] = [];
  for (let i = 0; i < 6; i++) {
    const s = sideOf(i);
    const k = kOf(i);
    const D = LEG[k];
    const hip = bodyAt(F, [s * D.hip[0], D.hip[1], D.hip[2]]);
    let foot = add(footOf(o, i), [o.gx, o.gy, o.air * 0.85]);
    const tar = D.tar * KB;
    const toHip = norm(sub(hip, foot));
    const a0 = add(foot, mul(norm(lerp3([0, 0, 1], toHip, 0.4)), tar));
    const pole = norm(F.Rd([s * D.pole[0], D.pole[1], D.pole[2]]));
    const [knee, ankle] = ik(hip, a0, D.lf * KB, D.lt * KB, pole);
    foot = add(ankle, sub(foot, a0));
    legs.push({ i, s, k, hip, knee, ankle, foot, out: norm(F.Rd([s, 0, 0])) });
  }
  return legs;
}

// ---------------------------------------------------------------------------
// Части.
// ---------------------------------------------------------------------------

interface Lag {
  /** Усики отстают от головы; веера булав пружинят. */
  aL: number;
  aR: number;
  fL: number;
  fR: number;
}

interface Ctx {
  a: Anim;
  o: Pose;
  F: BodyF;
  legs: Leg[];
  lag: Lag;
  t: number;
}

/** Часть с выбором палитры по точке, срезом, проявлением и бликом. */
interface PartF extends Part {
  pick?: (qx: number, qy: number, qz: number, n: V3) => number;
  /** Свет как у трубы: нормаль без составляющей вдоль оси — лапы не «бусы». */
  tube?: boolean;
  cut?: { m: V3; d: number; face: (qx: number, qy: number, qz: number) => number };
  /** Проявление шахматкой (0…1). */
  vis?: number;
  /** Пропуск пикселя по точке на части (зубцы щитка). */
  clip?: (qx: number, qy: number, qz: number) => boolean;
  /** Свет: тон = ламберт · k[0] + k[1] (лак — контрастнее). */
  lk?: [number, number];
  /** Добавка тона по нормали в мире (блик, отлив). */
  spec?: (n: V3, qx: number, qy: number, qz: number) => number;
}
/** Сдвиг тона, который `pick` возвращает вместе с палитрой. */
let PICK_T = 0;
let NEXT_ID = 0;
const nid = () => ++NEXT_ID;
let BALL_IDS: number[] = [];
let TOK_IDS: number[] = [];
let SHIM = -2;

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
  hint: V3 = [0, 1, 0],
): void {
  const d = sub(q, p);
  const dl = Math.hypot(d[0], d[1], d[2]) || 1;
  const h = Math.abs(dot(d, hint)) / dl > 0.9 ? (Math.abs(d[2]) / dl > 0.9 ? [1, 0, 0] : [0, 0, 1]) : hint;
  out.push({
    c: mul(add(p, q), 0.5),
    ax: axes(d, h as V3),
    r: [Math.hypot(d[0], d[1], d[2]) * 0.5 + r * 0.5, r, ry],
    pal,
    id,
    ...op,
  });
}

/** Полувектор «свет + взгляд»: блик там, где он у лака. */
const HV = norm(add(LIGHT, VIEW));
/** Лак: тело купола темнее, свет держат блик и кант. */
const SHELL_LK: [number, number] = [0.74, 0.12];
/** Блик купола — сверху-слева: полоса вдоль купола видна над переднеспинкой. */
const HV_DOME = norm([-0.42, 0.3, 0.86]);
const HEAD_LK: [number, number] = [0.7, 0.14];
/** Блик полосой: составляющая нормали вдоль `along` гасится — пятно тянется вдоль купола. */
function streak(n: V3, along: V3, damp: number, hv: V3 = HV): number {
  const m = norm(sub(n, mul(along, dot(n, along) * damp)));
  const s = dot(m, hv);
  return s > 0.99 ? 0.42 : s > 0.962 ? 0.24 : s > 0.915 ? 0.1 : 0;
}
/** Палитра купола: шов, бороздки (крупная), медь на скользящем крае к свету. */
function shellPick(edge: number, seam: boolean) {
  return (qx: number, _qy: number, qz: number, n: V3): number => {
    PICK_T = 0;
    if (seam && Math.abs(qx) < (HI ? 0.045 : 0.055) && qz > -0.15) {
      PICK_T = HI ? -0.34 : -0.4;
      return P_SHELL;
    }
    if (seam && qx < 0 && qz > -0.15 && -qx < (HI ? 0.085 : 0.11)) PICK_T = 0.1;
    if (seam && HI)
      for (const sx of STRIAE) if (Math.abs(Math.abs(qx) - sx) < 0.02 && qz > -0.35) PICK_T = -0.08;
    if (dot(n, VIEW) < edge && dot(n, LIGHT) > -0.05) return P_COPPER;
    return P_SHELL;
  };
}
function elySpec(along: V3) {
  return (n: V3, _qx: number, qy: number, qz: number): number => {
    let k = streak(n, along, 0.8, HV_DOME);
    if (SHIM > -1.5 && qz > 0.15 && Math.abs(qy - SHIM) < 0.12 && dot(n, LIGHT) > -0.1)
      k += HI ? 0.12 : 0.1;
    return k;
  };
}

const INNER_FACE = (qx: number, qy: number) => {
  PICK_T = (hash(Math.floor(qx * 6 + 9), Math.floor(qy * 6 + 9), 5) - 0.5) * 0.1;
  return P_INNER;
};

function bodyParts(out: PartF[], c: Ctx): void {
  const { o, F } = c;
  const ax: [V3, V3, V3] = [F.Rd([1, 0, 0]), F.Rd([0, 1, 0]), F.Rd([0, 0, 1])];
  out.push({
    c: bodyAt(F, BELLY_C),
    ax,
    r: F.sq(kb(BELLY_R)),
    pal: P_BODY,
    id: nid(),
    bias: -0.14,
  });
  // Надкрылья: купол дышит; в радости раскрываются двумя половинками.
  const br = 1 + 0.03 * o.breath;
  const er: V3 = [ELY_R[0] * (1 + 0.008 * o.breath), ELY_R[1], ELY_R[2] * br];
  const ec: V3 = [ELY_C[0], ELY_C[1], ELY_C[2] + (br - 1) * ELY_R[2] * 0.6];
  const elyId = nid();
  if (o.ely <= 0.01) {
    out.push({
      c: bodyAt(F, ec),
      ax,
      r: F.sq(kb(er)),
      pal: P_SHELL,
      id: elyId,
      lk: SHELL_LK,
      pick: shellPick(0.3, true),
      spec: elySpec(ax[1]),
      bias: -0.14,
    });
  } else {
    for (const s of [-1, 1]) {
      const e = o.ely;
      const hg: V3 = [s * 1.2, ELY_C[1] + ELY_R[1] * 0.78, ELY_C[2] + ELY_R[2] * 0.55];
      const turn = (v: V3): V3 => pitchX(rollY(v, -s * 0.95 * e), 0.42 * e);
      const cc = add(hg, turn(sub(ec, hg)));
      const hax: [V3, V3, V3] = [F.Rd(turn([1, 0, 0])), F.Rd(turn([0, 1, 0])), F.Rd(turn([0, 0, 1]))];
      out.push({
        c: bodyAt(F, cc),
        ax: hax,
        r: F.sq(kb(er)),
        pal: P_SHELL,
        id: nid(),
        lk: SHELL_LK,
        pick: shellPick(0.3, false),
        spec: elySpec(hax[1]),
        bias: -0.14,
        cut: { m: [s < 0 ? 1 : -1, 0, 0], d: 0, face: INNER_FACE },
      });
    }
  }
  // Переднеспинка: свой глянцевый щит, тёмная кромка спереди.
  const proPick = shellPick(0.42, false);
  out.push({
    c: bodyAt(F, PRO_C),
    ax,
    r: F.sq(kb(PRO_R)),
    pal: P_SHELL,
    id: nid(),
    lk: SHELL_LK,
    pick: (qx, qy, qz, n) => {
      const p = proPick(qx, qy, qz, n);
      if (qy > 0.82 && qz > -0.4) PICK_T -= 0.12;
      PICK_T -= 0.05;
      return p;
    },
    spec: (n) => streak(n, ax[0], 0.3),
    bias: -0.1,
  });
  // Голова и щиток с зубцами.
  const hax: [V3, V3, V3] = [F.HRd([1, 0, 0]), F.HRd([0, 1, 0]), F.HRd([0, 0, 1])];
  out.push({
    c: headAt(F, HEAD_C),
    ax: hax,
    r: F.sq(kb(HEAD_R)),
    pal: P_HEAD,
    id: nid(),
    lk: HEAD_LK,
    bias: -0.08,
  });
  // Глаза — бугорки по бокам макушки: на них штамп глаза.
  for (const s of [-1, 1])
    out.push({
      c: headAt(F, [s * EYE[0], EYE[1] - 0.5, EYE[2] - 0.6]),
      ax: hax,
      r: [1.7 * KB, 1.6 * KB, 1.5 * KB],
      pal: P_BODY,
      id: nid(),
      bias: -0.1,
      noSeam: true,
    });
  const tilt = (v: V3) => pitchX(v, CLY_TILT);
  const cax: [V3, V3, V3] = [F.HRd(tilt([1, 0, 0])), F.HRd(tilt([0, 1, 0])), F.HRd(tilt([0, 0, 1]))];
  const nT = HI ? 6 : 4;
  const dA = HI ? 0.36 : 0.5;
  const cid = nid();
  out.push({
    c: headAt(F, CLY_C),
    ax: cax,
    r: F.sq(kb(CLY_R)),
    pal: P_HEAD,
    id: cid,
    lk: HEAD_LK,
    bias: -0.12,
    // Выемки между зубцами по переднему краю.
    clip: (qx, qy) => {
      const rr = Math.hypot(qx, qy);
      if (qy <= 0 || rr < 0.8) return false;
      const a = Math.atan2(qx, qy) / dA + (nT - 1) / 2;
      const f = a - Math.floor(a);
      return Math.abs(f - 0.5) < 0.17 && a > 0 && a < nT - 1;
    },
    tex: HI
      ? (qx, qy) => {
          const a = Math.atan2(qx, qy) / dA + (nT - 1) / 2;
          const f = a - Math.floor(a);
          return qy > 0.1 && Math.abs(f - 0.5) < 0.08 ? -0.08 : 0;
        }
      : undefined,
  });
  for (let j = 0; j < nT; j++) {
    const a = (j - (nT - 1) / 2) * dA;
    const p: V3 = [
      CLY_C[0] + CLY_R[0] * Math.sin(a) * 0.92,
      CLY_C[1] + CLY_R[1] * Math.cos(a) * 0.92,
      CLY_C[2],
    ];
    const d = norm(F.HRd(tilt([Math.sin(a) * 0.8, Math.cos(a), -0.15])));
    const tl = (HI ? 1.0 : 1.1) * KB;
    out.push({
      c: add(headAt(F, add(p, tilt([0, 0, 0]))), mul(d, tl * 0.55)),
      ax: axes(d, F.HRd([0, 0, 1])),
      r: [tl, (HI ? 0.6 : 0.7) * KB, (HI ? 0.5 : 0.6) * KB],
      pal: P_HEAD,
      id: cid,
      bias: -0.12,
    });
  }
}

/** Усики: стебелёк из двух звеньев и булава — три пластинки веером. */
/** Усик: основание, локоть, начало булавы, оси веера. */
function antGeo(o: Pose, F: BodyF, lag: Lag, s: number) {
  const up = (s < 0 ? o.antL : o.antR) + (s < 0 ? lag.aL : lag.aR);
  const fan = clamp01((s < 0 ? o.fanL : o.fanR) + (s < 0 ? lag.fL : lag.fR));
  const base = headAt(F, [s * ANT[0], ANT[1], ANT[2]]);
  const dRest: V3 = [s * 0.86, 0.12, 0.48];
  const dUp: V3 = [s * 0.4, 0.0, 0.92];
  const dBack: V3 = [s * 0.55, -0.7, 0.35];
  const dl = up >= 0 ? lerp3(dRest, dUp, Math.min(1, up)) : lerp3(dRest, dBack, Math.min(1, -up));
  const d = norm(F.HRd(dl));
  const elbow = add(base, mul(d, 2.1 * KB));
  const d2 = norm(add(d, F.HRd([s * 0.1, 0.15, -0.2 * (1 - Math.abs(up))])));
  const tip = add(elbow, mul(d2, 1.4 * KB));
  const upv = F.HRd([0, 0, 1]);
  const u = norm(sub(upv, mul(d2, dot(upv, d2))));
  const nf = norm(cross(d2, u));
  return { fan, base, elbow, tip, d2, u, nf };
}

/** Усики: стебелёк из двух звеньев и булава — три пластинки веером. */
function antennae(out: PartF[], c: Ctx): void {
  const { o, F, lag } = c;
  for (const s of [-1, 1]) {
    const { fan, base, elbow, tip, d2, u, nf } = antGeo(o, F, lag, s);
    const sid = nid();
    limb(out, base, elbow, HI ? 0.42 : 0.5, HI ? 0.42 : 0.5, P_BODY, sid, { tube: true, bias: 0.1 });
    limb(out, elbow, tip, HI ? 0.38 : 0.45, HI ? 0.38 : 0.45, P_BODY, sid, { tube: true, bias: 0.12 });
    const L = (HI ? 2.9 : 3.0) * KB;
    for (const j of [-1, 0, 1]) {
      const a = j * (0.12 + 0.55 * fan);
      const dj = norm(add(mul(d2, Math.cos(a)), mul(u, Math.sin(a))));
      out.push({
        c: add(tip, mul(dj, L * 0.5)),
        ax: axes(dj, nf),
        r: [L * 0.5, (HI ? 0.8 : 0.9) * KB, 0.42 * KB],
        pal: P_CLUB,
        id: nid(),
        bias: 0.06 - Math.abs(j) * 0.04,
        noSeam: !HI,
      });
    }
  }
}

function legParts(out: PartF[], c: Ctx): void {
  for (const L of c.legs) {
    const fr = (L.k === 2 ? 1.55 : 1.6) * KB;
    const idF = nid();
    limb(out, L.hip, L.knee, fr, fr * 0.9, P_BODY, idF, { tube: true, bias: -0.04 });
    const d = norm(sub(L.ankle, L.knee));
    if (L.k === 0) {
      // Передняя голень — плоская лопатка с зубцами по наружному краю.
      limb(out, L.knee, L.ankle, 1.65 * KB, 0.8 * KB, P_BODY, nid(), { bias: 0.02 }, L.out);
      const e2 = norm(cross(L.out, d));
      const nTe = HI ? 3 : 1;
      for (let j = 0; j < nTe; j++) {
        const u = HI ? 0.45 + 0.22 * j : 0.8;
        const b = add(lerp3(L.knee, L.ankle, u), mul(e2, -1.1 * KB));
        const td = norm(add(mul(L.out, 0.7), add(mul(e2, -0.6), mul(d, 0.35))));
        out.push({
          c: add(b, mul(td, 0.5 * KB)),
          ax: axes(td, [0, 0, 1]),
          r: [0.8 * KB, 0.45 * KB, 0.45 * KB],
          pal: P_BODY,
          id: nid(),
          bias: 0.08,
          noSeam: true,
        });
      }
    } else {
      const tr = (L.k === 2 ? 1.2 : 1.25) * KB;
      limb(out, L.knee, L.ankle, tr, tr * 0.9, P_BODY, nid(), { tube: true, bias: 0 });
      if (HI) {
        // Шипики на голени.
        for (const u of [0.35, 0.7]) {
          const sv = norm(add(L.out, [0, 0, 0.5]));
          const hv = norm(sub(sv, mul(d, dot(sv, d))));
          const b = add(lerp3(L.knee, L.ankle, u), mul(hv, tr * 0.8));
          const td = norm(add(hv, mul(d, 0.6)));
          out.push({
            c: add(b, mul(td, 0.45 * KB)),
            ax: axes(td, [0, 0, 1]),
            r: [0.6 * KB, 0.3 * KB, 0.3 * KB],
            pal: P_BODY,
            id: nid(),
            bias: 0.12,
            noSeam: true,
          });
        }
      }
    }
    // Лапка и коготок.
    limb(out, L.ankle, L.foot, (HI ? 0.5 : 0.6) * KB, (HI ? 0.5 : 0.6) * KB, P_BODY, nid(), {
      tube: true,
      bias: 0.04,
    });
    if (HI) {
      const fd = norm(sub(L.foot, L.ankle));
      out.push({
        c: add(L.foot, mul(fd, 0.3)),
        ax: axes(fd, [0, 0, 1]),
        r: [0.55 * KB, 0.35 * KB, 0.35 * KB],
        pal: P_BODY,
        id: nid(),
        bias: -0.1,
        noSeam: true,
      });
    }
  }
}

/** Крылья в радости: перепонки из-под надкрылий, размыты взмахом (три положения шахматкой). */
function wings(out: PartF[], c: Ctx): void {
  const { o, F, t } = c;
  if (o.buzz <= 0) return;
  for (const s of [-1, 1]) {
    const base = bodyAt(F, [s * 4.0, -1.0, 4.6]);
    const ph = Math.sin(TAU * 7 * t + (s > 0 ? 0.6 : 0));
    for (const j of [-1, 0, 1]) {
      const flap = 0.38 * j + 0.15 * ph;
      const dl = norm([s * 0.92, -0.5, 0.35 + flap]);
      const d = norm(F.Rd(dl));
      const len = 9.4 * KB * o.buzz;
      out.push({
        c: add(base, mul(d, len * 0.5)),
        ax: axes(d, F.Rd([0, 0, 1])),
        r: [len * 0.5, 3.0 * KB, 0.3 * KB],
        pal: P_WING,
        id: nid(),
        bias: 0.1,
        vis: j === 0 ? 0.6 : 0.34,
        noSeam: true,
        tex: (_qx, qy) => (Math.abs(qy) < 0.06 || Math.abs(qy - 0.45) < 0.05 ? -0.15 : 0),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Реквизит: шар, половинки, камень, жетоны, блёстки.
// ---------------------------------------------------------------------------

/** Поворот вокруг оси качения (правило правой руки). */
function rotA(v: V3, a: number): V3 {
  const cs = Math.cos(a);
  const sn = Math.sin(a);
  const kv = cross(AXR, v);
  const d = dot(AXR, v) * (1 - cs);
  return [
    v[0] * cs + kv[0] * sn + AXR[0] * d,
    v[1] * cs + kv[1] * sn + AXR[1] * d,
    v[2] * cs + kv[2] * sn + AXR[2] * d,
  ];
}
/** Шар из добычи: ячейки золота, бирюзы и рубина в СВОИХ координатах шара — катятся с ним. */
function ballPick(qx: number, qy: number, qz: number): number {
  const M = HI ? 7 : 4;
  const lat = (Math.acos(Math.max(-1, Math.min(1, qz))) / Math.PI) * M;
  const j = Math.min(M - 1, Math.floor(lat));
  const fl = lat - j;
  const nl = Math.max(3, Math.round(M * 2 * Math.sin(((j + 0.5) / M) * Math.PI)));
  const lon = (Math.atan2(qy, qx) / TAU + 0.5) * nl + (j & 1) * 0.5;
  const i = Math.floor(lon);
  const fo = lon - i;
  const h = hash(i, j, 41);
  PICK_T = (hash(i, j, 43) - 0.5) * 0.16;
  if (HI && (fl < 0.1 || fo < 0.1)) PICK_T = -0.16;
  return h < 0.58 ? P_GOLD : h < 0.8 ? P_TOKEN : h < 0.9 ? P_RUBY : P_GOLD;
}
/** Блик шара стоит к свету, а не катится. */
const ballSpec = (n: V3) => {
  const s = dot(n, HV);
  return s > 0.975 ? 0.42 : s > 0.91 ? 0.18 : 0;
};
const BALL_AX0: [V3, V3, V3] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

function ballParts(out: PartF[], c: Ctx): void {
  const { o } = c;
  if (o.ballR <= 0 || o.prop <= 0) return;
  const C: V3 = [o.ballX, o.ballY, o.ballR];
  const vis = o.prop;
  if (o.crack <= 0) {
    const id = nid();
    BALL_IDS.push(id);
    out.push({
      c: C,
      ax: BALL_AX0.map((v) => rotA(v, o.ballRot)) as [V3, V3, V3],
      r: [o.ballR, o.ballR, o.ballR],
      pal: P_GOLD,
      id,
      pick: ballPick,
      spec: ballSpec,
      bias: -0.06,
      vis,
      noSeam: true,
    });
    return;
  }
  // Раскол: передняя половина валится на камень, задняя откатывается к жуку.
  const cr = o.crack;
  for (const s of [-1, 1]) {
    const tl = s > 0 ? 0.32 * cr : -0.55 * cr;
    const e1 = rotA(FG, tl);
    const e3 = rotA([0, 0, 1], tl);
    const e2 = cross(e3, e1);
    const id = nid();
    BALL_IDS.push(id);
    out.push({
      c: add(C, add(mul(FG, s > 0 ? 0.5 * cr : -2.4 * cr), [0, 0, -0.6 * cr])),
      ax: [e1, e2, e3],
      r: [o.ballR, o.ballR, o.ballR],
      pal: P_GOLD,
      id,
      pick: ballPick,
      spec: ballSpec,
      bias: -0.06,
      vis,
      noSeam: true,
      cut: {
        m: [s < 0 ? 1 : -1, 0, 0],
        d: 0,
        face: (_qx, qy, qz) => {
          const h = hash(Math.floor(qy * 3 + 9), Math.floor(qz * 3 + 9), 77);
          PICK_T = -0.12;
          return h < 0.45 ? P_TOKEN : P_GOLD;
        },
      },
    });
  }
}

function stoneParts(out: PartF[], c: Ctx): void {
  const { o } = c;
  if (o.stone <= 0) return;
  // Камень вздрагивает от удара шара.
  const jolt = 0.6 * bump(c.t, T_BUMP, T_BUMP + 0.08);
  out.push({
    c: add(STONE_C, mul(FG, jolt)),
    ax: axes(FG, [0, 0, 1]),
    r: STONE_R,
    pal: P_STONE,
    id: nid(),
    bias: -0.04,
    vis: o.stone,
    tex: (qx, qy, qz) => {
      const h = hash(Math.floor(qx * 5 + 9), Math.floor(qz * 5 + 9), Math.floor(qy * 3 + 4));
      const cr = Math.abs(qx * 0.8 - qz + 0.15) < 0.05 && qy > 0 ? -0.18 : 0;
      return (h - 0.5) * 0.12 + cr;
    },
  });
}

function tokenParts(out: PartF[], c: Ctx): void {
  const { o } = c;
  if (o.tokT < 0 || o.prop <= 0) return;
  for (const k of TOKS.slice(0, HI ? TOKS.length : 5)) {
    const { p, n } = tokAt(k, o.tokT);
    const id = nid();
    TOK_IDS.push(id);
    out.push({
      c: p,
      ax: axes(n[2] > 0.99 ? [1, 0, 0] : norm(cross([0, 0, 1], n)), n),
      r: [TOK_R, TOK_R, 0.55],
      pal: P_TOKEN,
      id,
      bias: 0.08,
      vis: o.prop,
      noSeam: true,
      tex: (qx, qy) => (qx * qx + qy * qy > 0.62 ? -0.14 : 0),
    });
  }
}

/** Блёстки, летящие к шару: монеты крутятся, осколки бирюзы и рубина. */
function glintParts(out: PartF[], c: Ctx): void {
  const { a, t } = c;
  if (a !== 'work' || t > 0.66) return;
  for (const g of GLINTS) {
    const u = (t - (g.arr - G_FLY)) / G_FLY;
    if (u < 0 || u >= 1) continue;
    const r = Math.max(gatherR(t), BALL_R0);
    const C = ballAtGather(r);
    const toS = norm(sub(g.from, C));
    const end = add(C, mul(toS, r * 0.9));
    const mid = add(lerp3(g.from, end, 0.5), [0, 0, 9]);
    const e = 1 - (1 - u) ** 1.6;
    const v = 1 - e;
    const p: V3 = [
      v * v * g.from[0] + 2 * e * v * mid[0] + e * e * end[0],
      v * v * g.from[1] + 2 * e * v * mid[1] + e * e * end[1],
      v * v * g.from[2] + 2 * e * v * mid[2] + e * e * end[2],
    ];
    const sp = 14 * t + g.arr * 9;
    if (g.kind === 0) {
      const n = norm([Math.cos(sp), 0.5, Math.sin(sp)]);
      out.push({
        c: p,
        ax: axes(norm(cross([0, 0, 1], n)), n),
        r: [1.5, 1.5, 0.4],
        pal: P_GOLD,
        id: nid(),
        bias: 0.12,
        noSeam: true,
      });
    } else {
      out.push({
        c: p,
        ax: axes([Math.cos(sp), Math.sin(sp), 0.4], [0, 0, 1]),
        r: [1.2, 0.85, 0.75],
        pal: g.kind === 1 ? P_TOKEN : P_RUBY,
        id: nid(),
        bias: 0.12,
        noSeam: true,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Свой растр: части с выбором палитры, срезом, проявлением, бликом.
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
    const cut = pt.cut;
    let cn: V3 = [0, 0, 0];
    let cmd = 0;
    if (cut) {
      cn = norm(add(add(mul(e1, cut.m[0] / r1), mul(e2, cut.m[1] / r2)), mul(e3, cut.m[2] / r3)));
      cmd = cut.m[0] * qdx + cut.m[1] * qdy + cut.m[2] * qdz;
    }
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
        let t = (-b + Math.sqrt(disc)) / (2 * a);
        let onCut = false;
        if (cut) {
          const m0 = cut.m[0] * q0x + cut.m[1] * q0y + cut.m[2] * q0z;
          if (m0 + t * cmd > cut.d) {
            if (cmd <= 0) continue;
            const tp = (cut.d - m0) / cmd;
            const t1 = (-b - Math.sqrt(disc)) / (2 * a);
            if (tp < t1) continue;
            t = tp;
            onCut = true;
          }
        }
        const i = py * w + px;
        if (t <= zb[i]) continue;
        const qx = q0x + t * qdx;
        const qy = q0y + t * qdy;
        const qz = q0z + t * qdz;
        if (pt.clip && !onCut && pt.clip(qx, qy, qz)) continue;
        let pal = pt.pal;
        let k: number;
        PICK_T = 0;
        if (onCut && cut) {
          pal = cut.face(qx, qy, qz);
          const lam = dot(cn, LIGHT);
          k = Math.max(0, lam * 0.55 + 0.45) + PICK_T;
        } else {
          const ax1 = pt.tube ? 0 : qx / r1;
          const nx = e1[0] * ax1 + (e2[0] * qy) / r2 + (e3[0] * qz) / r3;
          const ny = e1[1] * ax1 + (e2[1] * qy) / r2 + (e3[1] * qz) / r3;
          const nz = e1[2] * ax1 + (e2[2] * qy) / r2 + (e3[2] * qz) / r3;
          const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
          const n: V3 = [nx / nl, ny / nl, nz / nl];
          const lam = dot(n, LIGHT);
          const bounce = Math.max(0, -n[2]) * 0.14;
          if (pt.pick) pal = pt.pick(qx, qy, qz, n);
          const lk = pt.lk ?? [0.6, 0.4];
          k = Math.max(0, lam * lk[0] + lk[1] + bounce) + PICK_T;
          if (pt.tex) k += pt.tex(qx, qy, qz);
          if (pt.spec) k += pt.spec(n, qx, qy, qz);
        }
        if (pt.bias) k += pt.bias;
        const N = pals[pal].length;
        zb[i] = t;
        f.idb[i] = pt.noSeam ? -2 - pt.id : pt.id;
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
      if (pl !== P_SHELL && pl !== P_BODY && pl !== P_HEAD) continue;
      for (const j of [i + w, i + 1]) {
        if (pal[j] === pl && idb[j] === idb[i] && tone[j] === tone[i] - 1 && dith(x, y, 0.28))
          hit.push(j, tone[i]);
      }
    }
  for (let n = 0; n < hit.length; n += 2) f.tone[hit[n]] = hit[n + 1];
}

/** Радужный кант купола снизу-справа: тёмная сторона не тонет в тёмном фоне шахты. */
function iriRim(f: Frame): void {
  const { w, h, pal, tone } = f;
  const hit: number[] = [];
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (pal[i] !== P_SHELL) continue;
      if (pal[i + w] < 0 || pal[i + 1] < 0) hit.push(i);
    }
  for (const i of hit) tone[i] = Math.min(PAL[P_SHELL].length - 1, Math.max(tone[i] + 2, 4));
}

// ---------------------------------------------------------------------------
// Поверх кадра: глаза, искры, трещина, звёзды жетонов, пыль, лучи, сон.
// ---------------------------------------------------------------------------

function eyePal(): Record<string, RGBA> {
  return V === 1
    ? { k: hx('#0a0a1e'), c: hx('#1c3c8c'), m: hx('#3c6ad0'), W: hx('#ffffff') }
    : { k: hx('#0a0608'), c: hx('#2c1e24'), m: hx('#56414a'), W: hx('#ffffff') };
}
const EYES_S: Record<string, string[]> = {
  open: ['Wk', 'kc'],
  half: ['..', 'kk'],
  shut: ['..', 'kk'],
  happy: ['.k.', 'k.k'],
  sleep: ['k.k', '.k.'],
  angry: ['kk', 'Wk'],
};
const EYES_L: Record<string, string[]> = {
  open: ['.kkk.', 'kWWck', 'kWcck', 'kccmk', '.kkk.'],
  half: ['.....', 'kkkkk', 'kWcck', 'kccmk', '.kkk.'],
  shut: ['.....', '.....', 'kkkkk', '.....', '.....'],
  happy: ['.....', '..k..', '.k.k.', 'k...k', '.....'],
  sleep: ['.....', '.....', 'k...k', '.kkk.', '.....'],
  angry: ['kk...', 'kkkk.', 'kWcck', 'kccmk', '.kkk.'],
};

function eyes(p: Px, f: Frame, c: Ctx): void {
  const { o, F } = c;
  const ep = eyePal();
  const K = RR * SC;
  for (const s of [-1, 1]) {
    const e = seen(f, mul(headAt(F, [s * EYE[0], EYE[1], EYE[2]]), K), OX, OY, 2.0 * RR);
    if (!e) continue;
    let key: string = o.eye;
    if (key === 'wide') key = 'open';
    if (key === 'open' || key === 'angry') {
      if (o.blink > 0.7) key = 'shut';
      else if (o.blink > 0.25) key = 'half';
    }
    const rows = HI ? EYES_L[key] : EYES_S[key];
    const wd = rows[0].length;
    stamp(p, rows, ep, e[0] - Math.floor(wd / 2), e[1] - Math.floor(rows.length / 2), s > 0 && key === 'angry');
  }
}

/** Искра-звезда: середина белая, лучи — `arm`. */
function star(p: Px, x: number, y: number, L: number, arm: RGBA, core: RGBA = hx('#ffffff')): void {
  p.set(x, y, core);
  for (let d = 1; d <= L; d++) {
    const cc = d === 1 ? core : arm;
    p.set(x - d, y, cc);
    p.set(x + d, y, cc);
    p.set(x, y - d, cc);
    p.set(x, y + d, cc);
  }
}
const scr = (q: V3): [number, number] => {
  const pr = project(mul(q, RR * SC));
  return [Math.round(OX + pr[0]), Math.round(OY + pr[1])];
};

/** Блёстки на шаре катятся вместе с ним; искры прилипания; блеск щитка; гордость. */
function sparkles(p: Px, f: Frame, c: Ctx): void {
  const { o, F, t, a } = c;
  const gold = hx('#fff2b0');
  if (o.ballR > 0 && o.prop > 0.5) {
    const C: V3 = [o.ballX, o.ballY, o.ballR];
    const pts: V3[] = [
      [0.6, 0.5, 0.62],
      [-0.5, 0.7, 0.5],
      [0.1, 0.9, -0.2],
      [-0.7, 0.1, 0.7],
      [0.8, -0.2, 0.3],
    ].map((v) => norm(v as V3));
    const halves = o.crack > 0;
    pts.forEach((v, j) => {
      if (halves) return;
      const d = rotA(v, o.ballRot);
      if (dot(d, VIEW) < 0.35) return;
      const tw = 0.5 + 0.5 * Math.sin(TAU * (t * 2.5 + j * 0.37));
      if (tw < 0.45) return;
      const q = add(C, mul(d, o.ballR));
      const e = seen(f, mul(q, RR * SC), OX, OY, 1.6 * RR);
      if (!e) return;
      if (HI) star(p, e[0], e[1], tw > 0.8 ? 2 : 1, gold);
      else p.set(e[0], e[1], tw > 0.8 ? hx('#ffffff') : gold);
    });
  }
  if (a === 'work') {
    // Блёстка прилипла — искра.
    for (const g of GLINTS) {
      const u = (t - g.arr) / 0.1;
      if (u < 0 || u >= 1) continue;
      const r = Math.max(gatherR(t), BALL_R0);
      const C = ballAtGather(r);
      const q = add(C, mul(norm(sub(g.from, C)), r));
      const [x, y] = scr(q);
      star(p, x, y, Math.round((HI ? 3 : 2) * (1 - u * 0.5)), gold);
    }
    // Удар о камень — вспышка в точке касания.
    const ub = (t - T_BUMP) / 0.1;
    if (ub >= 0 && ub < 1) {
      const q = add(BALL_E, add(mul(FG, BALL_R * 0.9), [0, 0, STONE_Z - BALL_R]));
      const [x, y] = scr(q);
      star(p, x, y, Math.round((HI ? 5 : 3) * (1 - ub * 0.4)), hx('#fff6d8'));
    }
    // Гордость: искра на жетоне под лапкой.
    const up = (t - 1.8) / 0.14;
    if (up >= 0 && up < 1) {
      const [x, y] = scr(add(TOK_P, [0, 0, 2.6]));
      star(p, x + (HI ? 4 : 2), y - (HI ? 6 : 3), HI ? 2 : 1, hx('#e4fff8'));
    }
  }
  if (o.glint >= 0) {
    const q = mul(headAt(F, GROOM), RR * SC);
    const e = seen(f, q, OX, OY, 2 * RR);
    if (e) star(p, e[0], e[1] - (HI ? 1 : 0), Math.round((HI ? 3 : 2) * Math.sin(Math.PI * o.glint) + 0.4), gold);
  }
}

/** Трещина по шару перед расколом — только по пикселям шара. */
function crackLines(p: Px, f: Frame, c: Ctx): void {
  const { o, t } = c;
  const u = (t - (T_BUMP + 0.02)) / (T_BURST - T_BUMP - 0.02);
  if (u < 0 || u >= 1 || o.ballR <= 0) return;
  const C: V3 = [o.ballX, o.ballY, o.ballR];
  const a = add(C, add(mul(FG, o.ballR * 0.8), [0, 2, -o.ballR * 0.35]));
  const b = add(C, [0, o.ballR * 0.6, o.ballR * 0.8]);
  const [ax, ay] = scr(a);
  const [bx, by] = scr(b);
  const n = Math.max(1, Math.round(Math.max(Math.abs(bx - ax), Math.abs(by - ay)) * Math.min(1, u * 1.6)));
  const col = hx('#1a0c02');
  const L = Math.max(Math.abs(bx - ax), Math.abs(by - ay)) || 1;
  for (let i = 0; i <= n; i++) {
    const k = i / L;
    const zig = (i % 4 < 2 ? 1 : -1) * (HI ? 1 : 0.5);
    const x = Math.round(lerp(ax, bx, k) + zig);
    const y = Math.round(lerp(ay, by, k));
    if (x < 0 || y < 0 || x >= p.w || y >= p.h) continue;
    if (!BALL_IDS.includes(-2 - f.idb[y * p.w + x])) continue;
    p.set(x, y, col);
  }
}

/** Звезда жетона (крупная) — только по пикселям самого жетона, если он к нам лицом. */
function tokenStars(p: Px, f: Frame, c: Ctx): void {
  const { o } = c;
  if (o.tokT < 0 || o.prop < 0.5) return;
  const pale = hx('#e8fff8');
  const list = TOKS.slice(0, HI ? TOKS.length : 5);
  list.forEach((k, j) => {
    const { p: q, n } = tokAt(k, o.tokT);
    if (dot(n, VIEW) < 0.45) return;
    const [x, y] = scr(add(q, mul(n, 0.4)));
    const id = TOK_IDS[j];
    const put = (xx: number, yy: number) => {
      if (xx < 0 || yy < 0 || xx >= p.w || yy >= p.h) return;
      if (f.idb[yy * p.w + xx] !== -2 - id) return;
      p.set(xx, yy, pale);
    };
    if (HI) {
      for (const [dx, dy] of [
        [0, -2],
        [0, -1],
        [-2, 0],
        [-1, 0],
        [0, 0],
        [1, 0],
        [2, 0],
        [0, 1],
        [-1, 2],
        [1, 2],
      ])
        put(x + dx, y + dy);
    } else put(x, y);
  });
}

/** Пыль: плотные клубочки, свет сверху-слева, только по пустому. */
function puff(p: Px, mask: Uint8Array, cx: number, cy: number, rad: number, k: number): void {
  const lt = hx('#a89880');
  const dk = hx('#76685a');
  const R = Math.ceil(rad);
  for (let y = -R; y <= R; y++)
    for (let x = -R; x <= R; x++) {
      if (x * x + y * y > rad * rad) continue;
      const X = Math.round(cx + x);
      const Y = Math.round(cy + y);
      if (X < 0 || Y < 0 || X >= p.w || Y >= p.h || mask[Y * p.w + X]) continue;
      if (!dith(X, Y, k)) continue;
      p.set(X, Y, x + y < 0 ? lt : dk);
    }
}

function dust(p: Px, mask: Uint8Array, c: Ctx): void {
  const { o, F, t, a } = c;
  const K = RR * SC;
  if (a === 'work') {
    // Шар катится — пыль из-под него назад и вверх; удар о камень — облачко.
    for (const t0 of [1.04, 1.13, 1.22, 1.31, 1.4, T_BUMP, T_BUMP + 0.02]) {
      const u = (t - t0) / 0.24;
      if (u < 0 || u >= 1) continue;
      const atStone = t0 >= T_BUMP;
      const C = add(ballAtGather(BALL_R), mul(FG, Math.min(D_PUSH, rolled(t0))));
      const base = atStone
        ? add(BALL_E, add(mul(FG, BALL_R * 0.7), [t0 > T_BUMP ? 0 : 0, t0 > T_BUMP ? 3 : -2, 0]))
        : add(C, add(mul(FG, -BALL_R * 0.35), [0, 1.5, 0]));
      const q = add(base, add(mul(FG, atStone ? 1.5 * u : -2.5 * u), [0, 0, 1 + 3 * u]));
      const [x, y] = scr(q);
      puff(p, mask, x, y, (HI ? 2.4 : 1.2) * K * (0.8 + 0.8 * u), 1.1 * (1 - u));
    }
  }
  if (o.dust >= 0) {
    // Атака: щиток врезается в землю — пыль в стороны.
    const q0 = headAt(F, [0, CLY_C[1] + CLY_R[1], CLY_C[2]]);
    const g: V3 = [q0[0], q0[1], 0];
    const u = o.dust;
    for (const [dx, dy, dz, rr] of [
      [-7, 1, 2, 1.3],
      [7, 2, 2.5, 1.4],
      [-3, 4, 4, 1.1],
      [4, 4, 5, 1.0],
      [0, 3, 1, 1.5],
    ]) {
      const q = add(g, [dx * (0.4 + u), dy * u, 1 + dz * u]);
      const [x, y] = scr(q);
      puff(p, mask, x, y, (HI ? 2.2 : 1.1) * rr * K * (0.7 + 0.8 * u), 1.15 * (1 - u));
    }
  }
}

/** Удар щитком: короткие лучи — только по пустому. */
function rays(p: Px, mask: Uint8Array, c: Ctx): void {
  const { o, F } = c;
  const [cx, cy] = scr(headAt(F, [0, CLY_C[1] + CLY_R[1] + 1, CLY_C[2]]));
  const g = o.rays;
  const col = mixc(hx('#fff6e0'), hx('#f0c070'), g);
  for (const an of [-2.7, -2.2, -1.57, -0.95, -0.45, 0.4, 2.75]) {
    const r0 = (HI ? 16 : 8) + g * (HI ? 10 : 5);
    const r1 = r0 + (HI ? 7 : 3) * (1 - g * 0.6);
    const n = Math.ceil(r1 - r0) + 1;
    for (let i = 0; i <= n; i++) {
      const rr = lerp(r0, r1, i / n);
      const x = Math.round(cx + Math.cos(an) * rr);
      const y = Math.round(cy + Math.sin(an) * rr * 0.85);
      if (x < 0 || y < 0 || x >= p.w || y >= p.h || mask[y * p.w + x]) continue;
      p.set(x, y, col);
      if (HI && !mask[y * p.w + x + 1]) p.set(x + 1, y, col);
    }
  }
}

/** Сон: буквы «z» поднимаются над головой и тают. */
const Z_S = ['zzz', '.z.', 'zzz'];
const Z_L = ['zzzz', '..z.', '.z..', 'zzzz'];
function zzz(p: Px, mask: Uint8Array, c: Ctx): void {
  const { F, t } = c;
  const col = hx('#f4ead8');
  for (let j = 0; j < 2; j++) {
    const u = wrap(t / 1.5 + j * 0.5, 1);
    const [x0, y0] = scr(add(F.N, [-4 - 4 * u, 0, 10 + 10 * u]));
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
  const sw = (fn: (tt: number) => number, freq: number, damp: number, k: number, cap: number) => {
    const d = (spring(fn, t, t0, freq, damp) - fn(t)) * env;
    return Math.max(-cap, Math.min(cap, d * k));
  };
  // Высота головы: тело вверх — усики отстают вниз, и наоборот.
  const headZ = (tt: number) => {
    const o = P(tt);
    return o.bz + o.air - 7 * o.pitch + 3 * o.nod;
  };
  const r: Lag = {
    aL: sw(headZ, 3.0, 0.2, -0.22, 0.6) + (L0 ? L0.aL * (1 - env) : 0),
    aR: sw(headZ, 3.5, 0.2, -0.22, 0.6) + (L0 ? L0.aR * (1 - env) : 0),
    fL: sw((tt) => P(tt).fanL, 4.2, 0.24, 1, 0.3) + (L0 ? L0.fL * (1 - env) : 0),
    fR: sw((tt) => P(tt).fanR, 3.8, 0.24, 1, 0.3) + (L0 ? L0.fR * (1 - env) : 0),
  };
  LAGS.set(key, r);
  return r;
}

function toRes(parts: PartF[]): PartF[] {
  const K = RR * SC;
  if (K === 1) return parts;
  return parts.map((pt) => ({ ...pt, c: mul(pt.c, K), r: mul(pt.r, K) }));
}

/** Кадр `i` анимации `a` полосы `res`, вариант окраса `v` (0 — обычный, 1 — золотой). */
export function scarabFrame(a: Anim, i: number, res: Res = 's', v = 0): Px {
  const cv = RES[res];
  RR = cv.box / RES.s.box;
  HI = res === 'l';
  OX = cv.bx + cv.box / 2;
  OY = cv.by + GROUND * RR;
  V = v === 1 ? 1 : 0;
  NEXT_ID = 0;
  BALL_IDS = [];
  TOK_IDS = [];
  const t = i / FPS;
  const o = poseAt(a, t);
  SC = o.scale;
  SHIM = o.shim;
  const lag = lagOf(a, t);
  const F = bodyFrame(o);
  const legs = legsOf(o, F);
  const c: Ctx = { a, o, F, legs, lag, t };
  PAL = PAL_V[V];
  const f = newFrame(cv.cw, cv.ch);
  const parts: PartF[] = [];
  bodyParts(parts, c);
  antennae(parts, c);
  legParts(parts, c);
  wings(parts, c);
  ballParts(parts, c);
  stoneParts(parts, c);
  tokenParts(parts, c);
  glintParts(parts, c);
  drawPartsF(f, toRes(parts), PAL, OX, OY);
  seams(f, 1.2 * RR, 1);
  rimLight(f, PAL, (pl) => pl === P_SHELL || pl === P_COPPER || pl === P_BODY || pl === P_HEAD);
  iriRim(f);
  if (HI) softBands(f);
  const p = toPx(f, PAL);
  selOutline(p, INK_V[V], 0.8);
  const mask = new Uint8Array(p.w * p.h);
  for (let j = 0; j < mask.length; j++) mask[j] = p.data[j * 4 + 3] > 0 ? 1 : 0;
  eyes(p, f, c);
  crackLines(p, f, c);
  tokenStars(p, f, c);
  sparkles(p, f, c);
  dust(p, mask, c);
  if (o.rays >= 0) rays(p, mask, c);
  if (a === 'sleep') zzz(p, mask, c);
  return p;
}

/** Отладка: ключевые точки позы в мире. */
export function DBG(o: Pose): Record<string, V3> {
  const F = bodyFrame(o);
  const L = legsOf(o, F);
  const r: Record<string, V3> = {
    elyC: bodyAt(F, ELY_C),
    proC: bodyAt(F, PRO_C),
    head: headAt(F, HEAD_C),
    clyTip: headAt(F, [0, CLY_C[1] + CLY_R[1], CLY_C[2]]),
    eyeR: headAt(F, EYE),
    eyeL: headAt(F, [-EYE[0], EYE[1], EYE[2]]),
    antL: headAt(F, [-ANT[0], ANT[1], ANT[2]]),
    antR: headAt(F, ANT),
    antTipL: antGeo(o, F, lagOf('idle', 0), -1).tip,
    antTipR: antGeo(o, F, lagOf('idle', 0), 1).tip,
    antElL: antGeo(o, F, lagOf('idle', 0), -1).elbow,
    ballC: [o.ballX, o.ballY, o.ballR],
  };
  for (const l of L) r['foot' + l.i] = l.foot;
  return r;
}
