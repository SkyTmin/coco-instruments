// Пиксельные кирки — 17 кирок тем же растром, что питомцы (`pets-pixel/rig.ts`:
// эллипсоиды лучом на пиксель, буфер глубины, свет сверху-слева, тон —
// ступень палитры, контур «по соседу»). Подробности — `.claude/rules/props-picks.md`.
//
// Кирка собрана в СВОИХ осях: O — проушина (там, где рукоять проходит сквозь
// головку), U — вдоль рукояти к навершию, N — вдоль головки, B = U × N —
// толщина. Узоры (прожилки, волокна, ржавчина, вмятины, звёзды) считаются
// от точки в этих осях, поэтому поворачиваются вместе с киркой и не «кипят»
// на стыках звеньев.
//
// Полосы: `spin-<p>` — петля 2 с, честный поворот вокруг рукояти (кадр 0 —
// значок); `forge-r<r>` — сцена выковки по ступеням редкости, метки
// `strike1..3`, `quench`, `reveal`. Всё детерминировано: ни `Math.random`, ни
// времени.

import type { Px } from '../dungeon-art';
import {
  type Frame,
  type Key,
  type RGBA,
  type V3,
  add,
  bump,
  clamp01,
  cross,
  dith,
  dot,
  hash,
  hx,
  kf,
  LIGHT,
  lerp,
  mixc,
  mul,
  newFrame,
  norm,
  project,
  ramp,
  rimLight,
  seams,
  selOutline,
  sub,
  toPx,
  VIEW,
  wrap,
} from '../pets-pixel/rig';
import { RARITIES } from '../rarity';

const CE = VIEW[1];
const SE = VIEW[2];
const TAU = Math.PI * 2;
/** Полувектор «свет + взгляд»: где стоит блик. */
const HV = norm(add(LIGHT, VIEW));

// ---------------------------------------------------------------------------
// Холст: две полосы, как у питомцев.
// ---------------------------------------------------------------------------

export type Res = 's' | 'l';
export interface Canvas {
  /** Рамка вещи (сторона квадрата), в пикселях рисунка. */
  box: number;
  cw: number;
  ch: number;
  /** Угол рамки на холсте. */
  bx: number;
  by: number;
}
export const RES: Record<Res, Canvas> = {
  s: { box: 48, cw: 72, ch: 72, bx: 12, by: 12 },
  l: { box: 112, cw: 168, ch: 168, bx: 28, by: 28 },
};

export const FPS = 24;
/** Петля вращения: 48 кадров, 2 с. */
export const SPIN_N = 48;

// Состояние кадра (рисовальщик однопоточный, как у питомцев).
let RR = 1;
let HI = false;
let OX = 0;
let OY = 0;

// ---------------------------------------------------------------------------
// Палитры: тень холоднее, свет теплее; номер палитры — индекс в `PALS`.
// ---------------------------------------------------------------------------

const PALS: RGBA[][] = [];
function pal(...c: string[]): number {
  PALS.push(ramp(...c));
  return PALS.length - 1;
}
function palRGBA(c: RGBA[]): number {
  PALS.push(c);
  return PALS.length - 1;
}

// Металлы.
const P_IRONR = pal('#1a1216', '#2c2022', '#42302c', '#5a4436', '#745844', '#8e6e54', '#aa8a6c', '#c8a888');
const P_RUST = pal('#36120a', '#58200c', '#823612', '#aa5016', '#cc6e22', '#e69036', '#f6b458');
const P_DSTEEL = pal('#0c0e16', '#171a26', '#242836', '#343a4a', '#474f62', '#5e687c', '#7c889c', '#a2aebc', '#c8d2dc');
const P_STEEL = pal('#121824', '#232c3a', '#384454', '#52606f', '#71818f', '#94a5b4', '#b9c9d6', '#dce8f0', '#ffffff');
const P_GOLD = pal('#2c1406', '#4a2808', '#70400e', '#966014', '#be841c', '#dfa82c', '#f4ca4a', '#fde488', '#fffbe0');
const P_BRASS = pal('#281606', '#462c0c', '#6a4614', '#8e641e', '#b2842a', '#d0a43a', '#e8c458', '#f8e098', '#fffbe8');
const P_SILVER = pal('#1c202c', '#323848', '#4c5466', '#6a7486', '#8c96a8', '#b0bacb', '#d4dce6', '#eef4fa', '#ffffff');
const P_COPPER = pal('#280c08', '#46180e', '#6c2816', '#923e1e', '#b4582a', '#d0783c', '#e89c5a', '#f8c894', '#fff0dc');
const P_WGOLD = pal('#26221a', '#433d2e', '#665e46', '#8c8464', '#b2aa88', '#d6d0b0', '#eeeAd4', '#fffdf2', '#ffffff');
const P_STAR = pal('#05051a', '#0a0c26', '#121838', '#1c244e', '#283466', '#384882', '#4e60a2', '#7486c6', '#a8b8ec');
const P_SPECK = pal('#3a4a8a', '#7088d0', '#a8c0ff', '#e4eeff', '#ffffff');

// Камень и самоцветы.
const P_FLINT = pal('#1c1a20', '#2e2a32', '#433e46', '#5a545c', '#746c72', '#90868a', '#ada2a0', '#cbc0b8', '#e6ddd2');
const P_TURQ = pal('#0a2a30', '#0e4246', '#145e5c', '#1c7e74', '#2a9e8c', '#44bca2', '#70d6ba', '#a8ecd4', '#e0fff4');
const P_MATRIX = pal('#1e140e', '#2e1e14', '#42301e', '#5a4428', '#745a36');
const P_QUARTZ = pal('#241f3c', '#3a3260', '#544c84', '#7068a4', '#9088c2', '#b2acdc', '#d2d0f0', '#eef0fc', '#ffffff');
const P_OPAL = pal('#46425c', '#625e7c', '#86829e', '#aaa8c0', '#cacade', '#e2e4ee', '#f4f4fa', '#ffffff');
const P_OPALF = [
  pal('#d07aa8', '#ffb0d4', '#ffe4f0'),
  pal('#58b888', '#9ceec2', '#dcffee'),
  pal('#6a94e0', '#acccff', '#e2eeff'),
  pal('#d89a58', '#ffcc94', '#fff0dc'),
];
const P_LAPIS = pal('#05072a', '#0a1046', '#121c68', '#1b2a8e', '#2840b0', '#3a5acc', '#5a7ee2', '#8aa8f2', '#c4d4ff');
const P_CALCITE = pal('#7e86a6', '#a6aec8', '#cdd2e4', '#eef0f8');
const P_GARNET = pal('#180206', '#32040c', '#540816', '#780e22', '#9c1832', '#c02a46', '#de4a60', '#f4888e', '#ffd2cc');
const P_SAPPH = pal('#020a28', '#041548', '#08246c', '#0e3894', '#1850bc', '#2c6edc', '#5092f2', '#8cbcff', '#dceeff');
const P_RUBY = pal('#280006', '#48000c', '#720214', '#9c061e', '#c81028', '#ea2a3c', '#ff5a5c', '#ff9c92', '#ffe2da');
const P_DIAM = pal('#183040', '#284a5e', '#3a6a82', '#5690a8', '#7ab6cc', '#a2d8e8', '#caf0f8', '#ecfcff', '#ffffff');
const P_FIRE = [
  pal('#ff6a6a', '#ffd0d0'),
  pal('#ffd84a', '#fff4c0'),
  pal('#5af08a', '#d0ffe0'),
  pal('#5ab4ff', '#d4ecff'),
  pal('#c07aff', '#f0dcff'),
];
const P_RHOD = pal('#380a1c', '#5a1430', '#822446', '#aa385e', '#ca5476', '#e27490', '#f29ab0', '#fcc6d4', '#fff0f4');
const P_MANG = pal('#100608', '#1e0e14', '#2e1820', '#40242e');
const P_CHAR = pal('#1a0630', '#2e0c4e', '#461670', '#602492', '#7c38b2', '#9854ca', '#b678de', '#d4a4f0', '#f2e2ff');
const P_CHARF = pal('#2a0c46', '#b48ce0', '#e4ccf8', '#fbf2ff');
const P_ALEXG = pal('#021a12', '#063422', '#0c4e34', '#146a46', '#1e885a', '#2ea870', '#50c88a', '#88e4ac', '#d4fae4');
const P_ALEXR = pal('#200008', '#3e0214', '#620624', '#880c38', '#ac184c', '#cc2c62', '#e8507e', '#f888a8', '#ffd8e6');

// Дерево рукояти: сосна → чёрное дерево по ступеням редкости.
const P_WOOD = [
  pal('#3a2410', '#5a3a18', '#7c5424', '#9e7034', '#bc8e4a', '#d4ac66', '#e8c88a'),
  pal('#2e1a0c', '#4a2c14', '#6a421e', '#8a5a2a', '#a8763a', '#c4924e', '#dcae68'),
  pal('#22120a', '#3a2012', '#56301a', '#724224', '#8e5630', '#a86e40', '#c28a56'),
  pal('#200a08', '#3a140e', '#561e14', '#722a1a', '#8e3a22', '#aa4e2e', '#c4663e'),
  pal('#160a0a', '#2a1210', '#401c18', '#562822', '#6c362c', '#844838', '#9c5c48'),
  pal('#0e0a0a', '#1c1412', '#2a1e1a', '#3a2a24', '#4c3830', '#60483e', '#76584c'),
  pal('#06060c', '#0e0e16', '#181822', '#24232e', '#32303e', '#444052', '#5c566c'),
];
const P_CLOTH = pal('#2a2620', '#403a30', '#5a5244', '#766c5a', '#928672', '#aea08a');
const P_LEATH = pal('#1e0e06', '#34180a', '#4c2610', '#663618', '#804822', '#9a5e30', '#b47842');
const P_LEATHD = pal('#100808', '#1e0e0c', '#2e1612', '#40201a', '#542c22', '#6a3a2c', '#80483a');
const P_LEATHR = pal('#1a0408', '#30080e', '#4a0e16', '#661620', '#82202c', '#9e2e3a', '#ba404a');
const P_ROPE = pal('#2a2010', '#44361c', '#62502c', '#806a3e', '#9e8654', '#baa26e', '#d4be8c');

// Кузня.
const P_HEAT = pal(
  '#2a0a06', '#4e1008', '#7a1a0a', '#a8280c', '#d23e10', '#f06218',
  '#fc8c28', '#ffb648', '#ffd878', '#fff2b8', '#ffffff',
);
const P_ANVIL = pal('#08080e', '#121219', '#1c1c26', '#282834', '#363644', '#484858', '#5e5e72', '#7a7a90', '#9c9cb2');
const P_HAMMER = P_DSTEEL;

/** Ступень редкости → палитра света (тёмный → цвет → светлый → белый). */
const P_RAR = RARITIES.map((r) => {
  const d = hx(r.dark);
  const c = hx(r.color);
  const l = hx(r.light);
  const w: RGBA = [255, 255, 255, 255];
  return palRGBA([d, mixc(d, c, 0.5), c, mixc(c, l, 0.5), l, mixc(l, w, 0.6), w]);
});
const rcol = (r: number, k: number): RGBA => PALS[P_RAR[r]][Math.max(0, Math.min(6, k))];

const INK: RGBA = hx('#07060a');

// ---------------------------------------------------------------------------
// Шум (детерминированный, от точки в осях кирки).
// ---------------------------------------------------------------------------

function noise3(x: number, y: number, z: number, s: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fy = y - yi;
  const fz = z - zi;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);
  const h = (a: number, b: number, c: number) => hash(xi + a + (zi + c) * 7919, yi + b, s);
  const x00 = lerp(h(0, 0, 0), h(1, 0, 0), ux);
  const x10 = lerp(h(0, 1, 0), h(1, 1, 0), ux);
  const x01 = lerp(h(0, 0, 1), h(1, 0, 1), ux);
  const x11 = lerp(h(0, 1, 1), h(1, 1, 1), ux);
  return lerp(lerp(x00, x10, uy), lerp(x01, x11, uy), uz);
}

/** Ячейки Вороного: расстояние до ближайшей точки, до второй и номер ячейки. */
function cells(x: number, y: number, z: number, s: number): [number, number, number] {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  let d1 = 1e9;
  let d2 = 1e9;
  let id = 0;
  for (let a = -1; a <= 1; a++)
    for (let b = -1; b <= 1; b++)
      for (let c = -1; c <= 1; c++) {
        const cx = xi + a;
        const cy = yi + b;
        const cz = zi + c;
        const k = cx * 73 + cz * 7919;
        const px = cx + hash(k, cy, s);
        const py = cy + hash(k, cy, s + 1);
        const pz = cz + hash(k, cy, s + 2);
        const d = Math.hypot(x - px, y - py, z - pz);
        if (d < d1) {
          d2 = d1;
          d1 = d;
          id = (Math.imul(k, 31) + cy * 977) | 0;
        } else if (d < d2) d2 = d;
      }
  return [d1, d2, id];
}

// ---------------------------------------------------------------------------
// Материалы.
// ---------------------------------------------------------------------------

type Kind =
  | 'rust'
  | 'metal'
  | 'chrome'
  | 'dents'
  | 'star'
  | 'flint'
  | 'stone'
  | 'gem'
  | 'opal'
  | 'wood'
  | 'grip'
  | 'rope'
  | 'hot'
  | 'glow';

interface Mat {
  kind: Kind;
  p: number;
  /** Вторая палитра: прожилки, ржавчина, крап. */
  p2?: number;
  /** Узор камня: 'web' — сетка матрицы, 'marble' — разводы, 'fibre' — волокна, 'fleck' — крап. */
  tex?: 'web' | 'marble' | 'fibre' | 'fleck' | 'none';
  /** Самоцвет: александрит меняет цвет, алмаз даёт «огонь». */
  gem?: 'alex' | 'fire';
  /** Грани не огранкой, а природным кристаллом (неровные сколы). */
  shard?: boolean;
  /** Блеск: 0 — матовый, 1 — лак. */
  gloss?: number;
  seed?: number;
}

const M = (kind: Kind, p: number, o: Partial<Mat> = {}): Mat => ({ kind, p, ...o });

/** Описание кирки: материалы частей. Форма растёт по редкости (`PICKS[i].rarity`). */
interface Spec {
  rar: number;
  head: Mat;
  /** Проушина: у самоцветных — металл оправы. */
  eye: Mat;
  /** Оправа: кольца, навершие, ободки камней. */
  fit: Mat;
  grip: Mat;
  /** Камень в оправе (с эпической). */
  gem?: Mat;
  chip?: boolean;
  rope?: boolean;
  /** Головка толще и грубее (кремень). */
  crude?: boolean;
}

const WOOD = (r: number) => M('wood', P_WOOD[r]);
const SPECS: Spec[] = [
  // 0 Ржавая: изъеденное железо, рыжие раковины, сбитое острие, тряпичная обмотка.
  { rar: 0, head: M('rust', P_IRONR, { p2: P_RUST }), eye: M('rust', P_IRONR, { p2: P_RUST }), fit: M('rust', P_IRONR, { p2: P_RUST }), grip: M('grip', P_CLOTH), chip: true },
  // 1 Каменная: кремень со сколами на верёвочной обвязке.
  { rar: 0, head: M('flint', P_FLINT), eye: M('rope', P_ROPE), fit: M('rope', P_ROPE), grip: M('rope', P_ROPE), rope: true, crude: true },
  // 2 Кованая: тёмная сталь во вмятинах от молота.
  { rar: 0, head: M('dents', P_DSTEEL, { gloss: 0.5 }), eye: M('dents', P_DSTEEL, { gloss: 0.5 }), fit: M('metal', P_DSTEEL), grip: M('grip', P_LEATH) },
  // 3 Железная: полированная сталь.
  { rar: 1, head: M('chrome', P_STEEL), eye: M('chrome', P_STEEL), fit: M('metal', P_STEEL, { gloss: 1 }), grip: M('grip', P_LEATH) },
  // 4 Бирюзовая: полированный камень с сеткой бурой матрицы.
  { rar: 1, head: M('stone', P_TURQ, { p2: P_MATRIX, tex: 'web', gloss: 1 }), eye: M('chrome', P_SILVER), fit: M('metal', P_SILVER, { gloss: 1 }), grip: M('grip', P_LEATH) },
  // 5 Кварцевая: гранёный прозрачный кварц.
  { rar: 1, head: M('gem', P_QUARTZ, { shard: true }), eye: M('chrome', P_SILVER), fit: M('metal', P_SILVER, { gloss: 1 }), grip: M('grip', P_LEATH) },
  // 6 Опаловая: молочный опал с игрой цвета.
  { rar: 2, head: M('opal', P_OPAL, { gloss: 1 }), eye: M('chrome', P_GOLD), fit: M('metal', P_GOLD, { gloss: 1 }), grip: M('grip', P_LEATH) },
  // 7 Золотая: золото с бронзовой глубиной, оправа медная (золото на золоте пропадает).
  { rar: 2, head: M('chrome', P_GOLD), eye: M('chrome', P_GOLD), fit: M('metal', P_COPPER, { gloss: 1 }), grip: M('grip', P_LEATHD) },
  // 8 Лазуритовая: синий камень, золотой крап пирита, белые прожилки кальцита.
  { rar: 2, head: M('stone', P_LAPIS, { p2: P_CALCITE, tex: 'fleck', gloss: 1 }), eye: M('chrome', P_GOLD), fit: M('metal', P_GOLD, { gloss: 1 }), grip: M('grip', P_LEATHD) },
  // 9 Гранатовая.
  { rar: 3, head: M('gem', P_GARNET), eye: M('chrome', P_GOLD), fit: M('metal', P_GOLD, { gloss: 1 }), grip: M('grip', P_LEATHD), gem: M('gem', P_GARNET) },
  // 10 Сапфировая.
  { rar: 3, head: M('gem', P_SAPPH), eye: M('chrome', P_SILVER), fit: M('metal', P_SILVER, { gloss: 1 }), grip: M('grip', P_LEATHD), gem: M('gem', P_SAPPH) },
  // 11 Рубиновая.
  { rar: 3, head: M('gem', P_RUBY), eye: M('chrome', P_GOLD), fit: M('metal', P_GOLD, { gloss: 1 }), grip: M('grip', P_LEATHD), gem: M('gem', P_RUBY) },
  // 12 Алмазная: ледяной алмаз с «огнём».
  { rar: 4, head: M('gem', P_DIAM, { gem: 'fire' }), eye: M('chrome', P_WGOLD), fit: M('metal', P_WGOLD, { gloss: 1 }), grip: M('grip', P_LEATHD), gem: M('gem', P_DIAM, { gem: 'fire' }) },
  // 13 Звёздная: тёмная сталь со светящейся россыпью.
  { rar: 4, head: M('star', P_STAR, { p2: P_SPECK }), eye: M('star', P_STAR, { p2: P_SPECK }), fit: M('metal', P_SILVER, { gloss: 1 }), grip: M('grip', P_LEATHD), gem: M('gem', P_SAPPH) },
  // 14 Родонитовая: розовый камень с чёрными прожилками.
  { rar: 5, head: M('stone', P_RHOD, { p2: P_MANG, tex: 'marble', gloss: 1 }), eye: M('chrome', P_GOLD), fit: M('metal', P_GOLD, { gloss: 1 }), grip: M('grip', P_LEATHR), gem: M('gem', P_RUBY) },
  // 15 Чароитовая: фиолетовые волокнистые завитки.
  { rar: 5, head: M('stone', P_CHAR, { p2: P_CHARF, tex: 'fibre', gloss: 1 }), eye: M('chrome', P_SILVER), fit: M('metal', P_SILVER, { gloss: 1 }), grip: M('grip', P_LEATHR), gem: M('gem', P_QUARTZ) },
  // 16 Александритовая: от зелёного к малиновому.
  { rar: 6, head: M('gem', P_ALEXG, { gem: 'alex' }), eye: M('chrome', P_WGOLD), fit: M('metal', P_WGOLD, { gloss: 1 }), grip: M('grip', P_LEATHR), gem: M('gem', P_ALEXG, { gem: 'alex' }) },
];
export const PICK_N = SPECS.length;

// ---------------------------------------------------------------------------
// Положение кирки в мире: оси U, N, B, точка проушины, масштаб.
// ---------------------------------------------------------------------------

interface Pose {
  U: V3;
  N: V3;
  B: V3;
  T: V3;
  s: number;
}

/** Поворот вектора вокруг оси (Родриг). */
function rot(v: V3, k: V3, a: number): V3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const kv = cross(k, v);
  const kd = dot(k, v) * (1 - c);
  return [v[0] * c + kv[0] * s + k[0] * kd, v[1] * c + kv[1] * s + k[1] * kd, v[2] * c + kv[2] * s + k[2] * kd];
}

/** Рукоять на экране — вниз-вправо, головка — вверху слева. */
const HANDLE_A = 0.8;
const U0: V3 = norm([Math.cos(HANDLE_A), 0, -Math.sin(HANDLE_A)]);
const N0: V3 = norm([Math.sin(HANDLE_A), 0, Math.cos(HANDLE_A)]);
/** Наклон: навершие чуть к зрителю. */
const TILT = 0.32;
/** Поворот вокруг рукояти у значка (три четверти). */
export const THETA0 = 0.1;
/** Где проушина в рамке (модельные единицы от середины рамки). */
const EYE_AT: V3 = [-7.8, 0, 8.85];

/** Масштаб модели в рамке: кирка занимает рамку почти целиком. */
const SCALE = 1.22;

function pickPose(theta: number, tilt = TILT, at: V3 = EYE_AT, s = 1): Pose {
  const U = norm(rot(U0, N0, tilt));
  const N = norm(rot(N0, U, theta));
  const B = cross(U, N);
  return { U, N, B, T: mul(at, RR * SCALE), s: s * RR * SCALE };
}

const toW = (o: Pose, u: number, n: number, b: number): V3 => [
  o.T[0] + (o.U[0] * u + o.N[0] * n + o.B[0] * b) * o.s,
  o.T[1] + (o.U[1] * u + o.N[1] * n + o.B[1] * b) * o.s,
  o.T[2] + (o.U[2] * u + o.N[2] * n + o.B[2] * b) * o.s,
];
const dirW = (o: Pose, d: V3): V3 => [
  o.U[0] * d[0] + o.N[0] * d[1] + o.B[0] * d[2],
  o.U[1] * d[0] + o.N[1] * d[1] + o.B[1] * d[2],
  o.U[2] * d[0] + o.N[2] * d[1] + o.B[2] * d[2],
];

// ---------------------------------------------------------------------------
// Части и растр.
// ---------------------------------------------------------------------------

interface Prim {
  c: V3;
  ax: [V3, V3, V3];
  r: V3;
  m: Mat;
  id: number;
  /** Нормаль трубки: без составляющей вдоль оси (рукоять, плечи головки). */
  tube?: boolean;
  /** Грани самоцвета: 'bar' — призма вдоль оси, 'cab' — огранка камня. */
  facet?: 'bar' | 'cab';
  /** Сдвиг граней призмы (ступенями вдоль плеча — «огранка», а не труба). */
  fz?: number;
  cut?: (qx: number, qy: number, qz: number) => boolean;
  vis?: number;
  pose: Pose;
}

/** Что нашёл луч: всё, что нужно материалу. */
interface Hit {
  P: V3;
  n: V3;
  /** Точка в осях кирки (модельные единицы). */
  u: number;
  nn: number;
  b: number;
  prim: Prim;
  q: V3;
}

let TIME = 0;
/** Номер грани на пиксель (−1 — не грань) и что делать на её кромке (+1 светлее, −1 темнее). */
let FB = new Int32Array(0);
let FE = new Int8Array(0);
let CUR_F = -1;
let CUR_E = 0;
let RAR = 0;
let HOT: { r: number; k: number } | null = null;

function shadeHit(h: Hit): [number, number] {
  const m = h.prim.m;
  const n = h.n;
  const lam = dot(n, LIGHT);
  const sp = dot(n, HV);
  const bounce = Math.max(0, -n[2]) * 0.12;
  const diff = Math.max(0, lam) * 0.62 + 0.16 + bounce;
  const g = m.gloss ?? 0;
  const spec = (sp > 0.965 ? 0.4 : sp > 0.9 ? 0.2 : sp > 0.8 ? 0.06 : 0) * g;
  const { u, nn, b } = h;
  switch (m.kind) {
    case 'metal':
      return [m.p, 0.08 + diff * 0.9 + spec];
    case 'rust': {
      const s = 1.6;
      const v = noise3(u / s, nn / s, b / s, 11) * 0.65 + noise3(u / 0.7, nn / 0.7, b / 0.7, 12) * 0.35;
      const k = 0.04 + diff * 0.9 + (sp > 0.93 ? 0.1 : 0);
      if (v > 0.6) return [m.p2!, k + (v > 0.72 ? -0.18 : 0.04)];
      return [m.p, k + (v < 0.32 ? 0.06 : 0)];
    }
    case 'dents': {
      // Следы молота: мелкие плоские площадки, каждая ловит свет по-своему.
      const sc = HI ? 1.7 : 2.4;
      const [, , id] = cells(u / sc, nn / sc, b / sc, 21);
      const tl: V3 = [hash(id, 1, 5) - 0.5, hash(id, 2, 5) - 0.5, hash(id, 3, 5) - 0.5];
      const nf = norm(add(n, mul(tl, 0.75)));
      const lf = Math.max(0, dot(nf, LIGHT)) * 0.66 + 0.1 + bounce;
      const sf = dot(nf, HV);
      return [m.p, lf + (sf > 0.95 ? 0.3 : sf > 0.88 ? 0.12 : 0)];
    }
    case 'chrome': {
      // Отражение неба: светлый верх, тёмная полоса горизонта, земля посередине.
      const rz = 2 * dot(n, VIEW) * n[2] - VIEW[2];
      const env = rz > 0.42 ? 0.86 : rz > 0.12 ? 0.62 : rz > -0.12 ? 0.16 : rz > -0.5 ? 0.38 : 0.28;
      return [m.p, env * 0.6 + Math.max(0, lam) * 0.32 + (sp > 0.96 ? 0.36 : sp > 0.9 ? 0.16 : 0)];
    }
    case 'star': {
      const k = 0.06 + diff * 0.8 + (sp > 0.95 ? 0.3 : sp > 0.88 ? 0.12 : 0);
      const sc = HI ? 1.25 : 1.7;
      const [d1, , id] = cells(u / sc, nn / sc, b / sc, 31);
      if (hash(id, 1, 7) < 0.42) {
        const ph = hash(id, 2, 7);
        const tw = 0.5 + 0.5 * Math.sin(TAU * (TIME / 2 + ph) * (1 + (id & 1)));
        const rad = (HI ? 0.34 : 0.3) + 0.1 * tw;
        if (d1 < rad) return [m.p2!, 0.45 + 0.55 * tw];
        if (HI && d1 < rad + 0.16 && tw > 0.6) return [m.p2!, 0.25];
      }
      return [m.p, k];
    }
    case 'flint': {
      // Сколы: у каждой раковины своя нормаль, по краю — тёмная кромка.
      const sc = HI ? 1.5 : 2.1;
      const [d1, d2, id] = cells(u / sc, nn / sc, b / sc, 41);
      const tilt: V3 = [hash(id, 1, 9) - 0.5, hash(id, 2, 9) - 0.5, hash(id, 3, 9) - 0.5];
      const nf = norm(add(n, mul(tilt, 1.1)));
      const lf = Math.max(0, dot(nf, LIGHT)) * 0.66 + 0.16 + bounce;
      const edge = d2 - d1 < (HI ? 0.09 : 0.12);
      return [m.p, lf + (edge && HI ? -0.16 : 0) + (dot(nf, HV) > 0.94 ? 0.16 : 0)];
    }
    case 'stone': {
      let k = 0.1 + diff * 0.84 + spec;
      if (m.tex === 'web') {
        const [d1, d2] = cells(u / 3, nn / 3, b / 3, 51);
        if (d2 - d1 < (HI ? 0.07 : 0.09)) return [m.p2!, k * 0.8];
        k += (noise3(u / 1.2, nn / 1.2, b / 1.2, 52) - 0.5) * 0.14;
      } else if (m.tex === 'marble') {
        const w = Math.sin(u * 0.5 + nn * 0.32 + 5 * noise3(u / 3, nn / 3, b / 3, 61));
        if (Math.abs(w) < (HI ? 0.13 : 0.16)) return [m.p2!, k * 0.9];
        if (Math.abs(w) < 0.3) k -= 0.1;
      } else if (m.tex === 'fibre') {
        const w = Math.sin(nn * 0.7 - u * 0.35 + 6 * noise3(u / 3.4, nn / 3.4, b / 3.4, 71));
        if (w > 0.86) return [m.p2!, k + 0.2];
        if (w > 0.6) k += 0.1;
        else if (w < -0.85) k -= 0.12;
      } else if (m.tex === 'fleck') {
        const [d1, , id] = cells(u / 1.3, nn / 1.3, b / 1.3, 81);
        if (hash(id, 4, 3) < 0.3 && d1 < (HI ? 0.24 : 0.3)) return [P_GOLD, 0.3 + diff * 0.45 + spec];
        const w = Math.sin(u * 0.4 - nn * 0.6 + 4 * noise3(u / 3, nn / 3, b / 3, 82));
        if (Math.abs(w) < (HI ? 0.06 : 0.07)) return [m.p2!, k];
      }
      return [m.p, k];
    }
    case 'opal': {
      const k = 0.26 + diff * 0.72 + spec;
      // Игра цвета: у каждой чешуйки своя «нормаль», вспыхивает, когда глядит на свет.
      const sc = HI ? 1.7 : 2.1;
      const [d1, , id] = cells(u / sc, nn / sc, b / sc, 91);
      if (d1 < 0.58) {
        const dn: V3 = norm([hash(id, 1, 2) - 0.5, hash(id, 2, 2) - 0.5, hash(id, 3, 2) - 0.5]);
        const nf = norm(add(n, mul(dn, 1.1)));
        const a = dot(nf, HV);
        const fp = P_OPALF[(id >>> 0) % 4];
        if (a > 0.88) return [fp, 1];
        if (a > 0.76) return [fp, 0.5];
        if (a > 0.68) return [fp, 0];
      }
      return [m.p, k];
    }
    case 'gem':
      return gemShade(h, m);
    case 'wood': {
      const ang = Math.atan2(b, nn);
      const g2 = Math.sin(ang * 3 + 0.5 * Math.sin(u * 0.45) + hash(Math.floor(u / 6), 0, 5) * 2);
      let k = 0.12 + diff * 0.84;
      if (g2 > (HI ? 0.8 : 0.9)) k -= 0.14;
      return [m.p, k];
    }
    case 'grip': {
      const ang = Math.atan2(b, nn);
      const ph = (u - (ang / TAU) * 2.2) / 2.2;
      const fr = ph - Math.floor(ph);
      let k = 0.1 + diff * 0.86 + (sp > 0.94 ? 0.1 : 0);
      if (fr < 0.2) k -= 0.2;
      else if (fr < 0.45) k += 0.08;
      return [m.p, k];
    }
    case 'rope': {
      const a = (u + nn) / 1.25;
      const c = (u - nn) / 1.25;
      const fa = a - Math.floor(a);
      const fc = c - Math.floor(c);
      let k = 0.1 + diff * 0.86;
      if (fa < 0.22 || fc < 0.12) k -= 0.18;
      else if (fa < 0.5) k += 0.06;
      return [m.p, k];
    }
    case 'hot': {
      // Раскалённое: светится само, кромка темнее; `HOT.k` — накал 0…1.
      const heat = HOT ? HOT.k : 1;
      const core = 1 - Math.abs(dot(n, VIEW)) * 0.0;
      const k = heat * 0.78 + Math.max(0, lam) * 0.16 + dot(n, VIEW) * 0.12 - 0.08 + core * 0;
      return [P_HEAT, k];
    }
    case 'glow': {
      const k = 0.44 + Math.max(0, lam) * 0.32 + dot(n, VIEW) * 0.2 + (sp > 0.9 ? 0.2 : 0);
      return [P_RAR[HOT ? HOT.r : RAR], k];
    }
  }
  return [m.p, diff];
}

/** Нормаль грани: оснастка по секторам вокруг оси части (+ поясами для кабошона). */
function facetNormal(pr: Prim, q: V3, nW: V3): V3 {
  const [e1, e2, e3] = pr.ax;
  const m1 = q[0] / pr.r[0];
  const m2 = q[1] / pr.r[1];
  const m3 = q[2] / pr.r[2];
  if (pr.facet === 'bar') {
    const K = 6;
    const off = (pr.fz ?? 0) * (Math.PI / K);
    const ph = Math.atan2(m3, m2) - off;
    const ai = Math.round(ph / (TAU / K));
    const a = ai * (TAU / K) + off;
    CUR_F = pr.id * 4096 + (pr.fz ?? 0) * 64 + (((ai % K) + K) % K);
    CUR_E = 1;
    return norm(add(mul(e2, Math.cos(a)), mul(e3, Math.sin(a))));
  }
  if (pr.facet === 'cab') {
    // Стол вдоль третьей оси, венец — восемь граней, павильон — восемь.
    const l = Math.hypot(m1, m2, m3) || 1;
    const z = m3 / l;
    CUR_E = 1;
    if (z > 0.82) {
      CUR_F = pr.id * 4096 + 4000;
      return e3;
    }
    const K = 8;
    const band = z > 0.35 ? 0 : 1;
    const off = band ? Math.PI / K : 0;
    const ph = Math.atan2(m2, m1) - off;
    const ai = Math.round(ph / (TAU / K));
    const a = ai * (TAU / K) + off;
    CUR_F = pr.id * 4096 + 3000 + band * 16 + (((ai % K) + K) % K);
    const el = band ? 0.18 : 0.62;
    const horiz = add(mul(e1, Math.cos(a)), mul(e2, Math.sin(a)));
    return norm(add(mul(horiz, Math.cos(el)), mul(e3, Math.sin(el))));
  }
  return nW;
}

function gemShade(h: Hit, m: Mat): [number, number] {
  let fn = h.prim.facet ? facetNormal(h.prim, h.q, h.n) : h.n;
  if (m.shard) {
    // Природный кристалл: крупные неровные грани, каждая — своя плоскость.
    const sc = HI ? 2.6 : 3.2;
    const [, , id] = cells(h.u / sc, h.nn / sc, h.b / sc, 101);
    const tl: V3 = [hash(id, 1, 4) - 0.5, hash(id, 2, 4) - 0.5, hash(id, 3, 4) - 0.5];
    fn = norm(add(h.n, mul(tl, 1.3)));
    CUR_F = id & 0xffffff;
    CUR_E = 1;
  }
  const lam = dot(fn, LIGHT);
  const sp = dot(fn, HV);
  let p = m.p;
  if (m.gem === 'alex') {
    // Зелёный там, где грань глядит на свет, малиновый — в тени.
    const side = dot(fn, norm([-0.8, 0.35, 0.5]));
    p = side > -0.05 ? P_ALEXG : P_ALEXR;
  }
  // Внутренний свет: грань напротив источника светится — свет прошёл сквозь камень.
  const inner = lam < -0.35 ? 0.42 : lam < -0.1 ? 0.18 : 0;
  // Свечение изнутри по середине плеча (там толще всего).
  const mid = h.prim.facet === 'bar' ? Math.max(0, 1 - Math.hypot(h.q[1], h.q[2]) * 1.15) * 0.12 : 0;
  let k = 0.1 + Math.max(0, lam) * 0.56 + inner + mid;
  if (sp > 0.965) k = 1.05;
  else if (sp > 0.9) k += 0.26;
  if (m.gem === 'fire' && sp > 0.74 && sp < 0.86) {
    const id = Math.round(Math.atan2(fn[2], fn[0]) * 3) + (h.prim.fz ?? 0) * 5;
    return [P_FIRE[((id % 5) + 5) % 5], 0.4];
  }
  return [p, k];
}

function rasterPrims(f: Frame, prims: Prim[]): void {
  const { w, h, zb } = f;
  for (const pt of prims) {
    const [e1, e2, e3] = pt.ax;
    const [r1, r2, r3] = pt.r;
    if (r1 <= 0.05 || r2 <= 0.05 || r3 <= 0.05) continue;
    const [scx, scy] = project(pt.c);
    const sy1 = e1[1] * SE - e1[2] * CE;
    const sy2 = e2[1] * SE - e2[2] * CE;
    const sy3 = e3[1] * SE - e3[2] * CE;
    const RX = Math.sqrt((r1 * e1[0]) ** 2 + (r2 * e2[0]) ** 2 + (r3 * e3[0]) ** 2) + 1;
    const RY = Math.sqrt((r1 * sy1) ** 2 + (r2 * sy2) ** 2 + (r3 * sy3) ** 2) + 1;
    const x0 = Math.max(0, Math.floor(OX + scx - RX));
    const x1 = Math.min(w - 1, Math.ceil(OX + scx + RX));
    const y0 = Math.max(0, Math.floor(OY + scy - RY));
    const y1 = Math.min(h - 1, Math.ceil(OY + scy + RY));
    if (x0 > x1 || y0 > y1) continue;
    const qdx = dot(VIEW, e1) / r1;
    const qdy = dot(VIEW, e2) / r2;
    const qdz = dot(VIEW, e3) / r3;
    const a = qdx * qdx + qdy * qdy + qdz * qdz;
    const vis = pt.vis ?? 1;
    const o = pt.pose;
    for (let py = y0; py <= y1; py++) {
      const sy = py + 0.5 - OY;
      const dy0 = sy * SE - pt.c[1];
      const dz0 = -sy * CE - pt.c[2];
      for (let px = x0; px <= x1; px++) {
        const sx = px + 0.5 - OX;
        const dx0 = sx - pt.c[0];
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
        if (vis < 1 && !dith(px, py, vis)) continue;
        const k1 = pt.tube ? 0 : qx / r1;
        let nx = e1[0] * k1 + (e2[0] * qy) / r2 + (e3[0] * qz) / r3;
        let ny = e1[1] * k1 + (e2[1] * qy) / r2 + (e3[1] * qz) / r3;
        let nz = e1[2] * k1 + (e2[2] * qy) / r2 + (e3[2] * qz) / r3;
        const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        nx /= nl;
        ny /= nl;
        nz /= nl;
        const P: V3 = [sx, sy * SE + t * CE, -sy * CE + t * SE];
        const d = sub(P, o.T);
        const hit: Hit = {
          P,
          n: [nx, ny, nz],
          u: dot(d, o.U) / o.s,
          nn: dot(d, o.N) / o.s,
          b: dot(d, o.B) / o.s,
          prim: pt,
          q: [qx * r1, qy * r2, qz * r3],
        };
        CUR_F = -1;
        CUR_E = 0;
        const [pl, k] = shadeHit(hit);
        FB[i] = CUR_F;
        FE[i] = CUR_E;
        const N = PALS[pl].length;
        zb[i] = t;
        f.idb[i] = pt.id;
        f.pal[i] = pl;
        f.tone[i] = Math.max(0, Math.min(N - 1, Math.round(k * (N - 1))));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Кирка: части по форме ступени.
// ---------------------------------------------------------------------------

/** Форма головки: модельные единицы (пиксели малой полосы). */
const W_ARM = 18.5;
const CURVE = 5.2;
const H0 = 3.1;
const T0 = 2.3;
const L_HANDLE = 33;
const RH = 1.4;

interface PickOpt {
  /** Материал вместо всех (раскалённая заготовка, силуэт ступени). */
  all?: Mat;
  vis?: number;
  /** Доля рукояти (0 — нет, 1 — вся): рукоять «вырастает» из проушины. */
  handle?: number;
}

/** Точка оси плеча: v ∈ [0, 1] от проушины к острию. */
function armAt(side: number, v: number, W: number, curve: number): [number, number] {
  return [curve * v * v, side * W * v];
}

function buildPick(sp: Spec, o: Pose, opt: PickOpt = {}): Prim[] {
  const out: Prim[] = [];
  const all = opt.all;
  const vis = opt.vis;
  const R = sp.rar;
  const mat = (m: Mat) => all ?? m;
  const part = (
    cl: V3,
    axl: [V3, V3, V3],
    r: V3,
    m: Mat,
    id: number,
    extra: Partial<Prim> = {},
  ): void => {
    out.push({
      c: toW(o, cl[0], cl[1], cl[2]),
      ax: [norm(dirW(o, axl[0])), norm(dirW(o, axl[1])), norm(dirW(o, axl[2]))],
      r: mul(r, o.s),
      m: mat(m),
      id,
      vis,
      pose: o,
      ...extra,
    });
  };
  const crude = !!sp.crude;
  const W = crude ? W_ARM * 0.86 : W_ARM;
  const curve = crude ? CURVE * 0.6 : CURVE;
  const h0 = crude ? H0 * 1.22 : H0;
  const t0 = crude ? T0 * 1.25 : T0;
  const gemHead = sp.head.kind === 'gem';

  // Плечи головки.
  for (const side of [-1, 1]) {
    const chip = sp.chip && side > 0;
    const Wl = chip ? W * 0.84 : W;
    const K = HI ? 18 : 13;
    for (let k = 0; k < K; k++) {
      const v = (k + 0.5) / K;
      const [u, n] = armAt(side, v, Wl, curve);
      const tl = norm([2 * curve * v, side * Wl, 0]);
      const e3: V3 = [0, 0, 1];
      const e2 = cross(e3, tl);
      const taper = 1 - 0.78 * v ** 1.5;
      const hU = h0 * taper * (chip ? 1 + 0.25 * v : 1);
      const tB = t0 * (1 - 0.66 * v ** 1.5);
      const zone = Math.floor(v * 3);
      const cut =
        chip && k >= K - 2
          ? (qx: number, qy: number) => qx > 0.1 && qy * side > 0.25
          : undefined;
      part([u, n, 0], [tl, e2, e3], [(Wl / K) * 1.5, hU, tB], sp.head, 1, {
        tube: true,
        facet: gemHead ? 'bar' : undefined,
        fz: zone + (side > 0 ? 1 : 0),
        cut,
      });
    }
    if (!chip) {
      // Острие: вытянутая капля на конце.
      const v = 0.985;
      const [u, n] = armAt(side, v, Wl, curve);
      const tl = norm([2 * curve * v, side * Wl, 0]);
      const e2 = cross([0, 0, 1], tl);
      part([u, n, 0], [tl, e2, [0, 0, 1]], [crude ? 1.6 : 2.1, crude ? 0.9 : 0.62, 0.55], sp.head, 1, {
        facet: gemHead ? 'bar' : undefined,
        fz: 3,
      });
    }
  }

  // Проушина (у самоцветной — оправа из металла, у кремня — обвязка).
  if (sp.rope) {
    part([0.2, 0, 0], [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [h0 * 1.25, 3.2, t0 * 1.18], sp.eye, 2);
    for (const s of [-1, 1]) {
      const d = norm([1, s * 1.1, 0]);
      part([0.3, 0, 0], [d, cross([0, 0, 1], d), [0, 0, 1]], [h0 * 1.55, 0.95, t0 * 1.3], sp.eye, 2);
    }
  } else {
    part([0, 0, 0], [[0, 1, 0], [1, 0, 0], [0, 0, 1]], [gemHead ? 3.3 : 2.9, h0 * 1.3, t0 * 1.22], sp.eye, 2, {
      tube: sp.eye.kind !== 'rust' && sp.eye.kind !== 'dents',
    });
  }

  // Кольца у проушины — с редкой; у божественной по два.
  if (R >= 2) {
    const vs = R >= 6 ? [0.2, 0.31] : [0.21];
    for (const side of [-1, 1])
      for (const v of vs) {
        const [u, n] = armAt(side, v, W, curve);
        const tl = norm([2 * curve * v, side * W, 0]);
        const e2 = cross([0, 0, 1], tl);
        const taper = 1 - 0.78 * v ** 1.5;
        part([u, n, 0], [tl, e2, [0, 0, 1]], [0.62, h0 * taper * 1.2, t0 * (1 - 0.66 * v ** 1.5) * 1.24], sp.fit, 3);
      }
  }

  // Камень в оправе на щеке проушины — с эпической (с обеих сторон).
  if (R >= 3 && sp.gem) {
    for (const s of [-1, 1]) {
      const bz = s * t0 * 1.22 * 0.86;
      part([0, 0, bz], [[1, 0, 0], [0, 1, 0], [0, 0, s]], [1.95, 1.75, 0.7], sp.fit, 4);
      part([0, 0, bz + s * 0.45], [[1, 0, 0], [0, 1, 0], [0, 0, s]], [1.45, 1.3, 0.75], sp.gem, 5, {
        facet: 'cab',
      });
    }
  }

  // Рукоять: торец над обухом, ствол, обмотка, навершие.
  const hk = opt.handle ?? 1;
  const top = -h0 * 1.3 - (sp.rope ? 0.6 : 1.1);
  const bot = lerp(0, L_HANDLE, hk);
  if (hk > 0) {
    const step = HI ? 0.9 : 1.2;
    for (let u = top; u < bot; u += step) {
      const uu = Math.min(u + step / 2, bot);
      part([uu, 0, 0], [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [step * 1.6, RH + 0.12 * (uu / L_HANDLE), RH + 0.12 * (uu / L_HANDLE)], WOOD(R), 6, {
        tube: true,
      });
    }
    // Клин в торце (с эпической — металлическая шляпка).
    if (R >= 3) part([top + 0.2, 0, 0], [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [0.9, RH + 0.35, RH + 0.35], sp.fit, 7);
    // Обмотка.
    const g0 = L_HANDLE - 11.5;
    const g1 = L_HANDLE - 1.6;
    if (hk >= 1 || bot > g0)
      for (let u = g0; u < Math.min(g1, bot); u += 0.9) {
        part([u + 0.45, 0, 0], [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [1.4, RH + 0.42, RH + 0.42], sp.grip, 8, {
          tube: true,
        });
      }
    if (hk >= 1) {
      // Навершие: у простых — голый торец, с необычной — колпачок оправы.
      if (R >= 1 || sp.chip)
        part([L_HANDLE + 0.3, 0, 0], [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [1.15, RH + 0.6, RH + 0.6], sp.chip ? sp.head : sp.fit, 9);
      if (R >= 4 && sp.gem)
        part([L_HANDLE + 1.7, 0, 0], [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [1.35, 1.35, 1.2], sp.gem, 10, {
          facet: 'cab',
        });
    }
    // Лангеты: стальные полосы по щекам рукояти (с мифической).
    if (R >= 5) {
      const l0 = h0 * 1.1;
      const l1 = Math.min(10.5, bot);
      if (l1 > l0)
        for (const s of [-1, 1])
          part([(l0 + l1) / 2, 0, s * (RH + 0.02)], [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [(l1 - l0) / 2 + 0.8, 0.62, 0.36], sp.fit, 11);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Кадр кирки и эффекты.
// ---------------------------------------------------------------------------

function setRes(res: Res): Canvas {
  const cv = RES[res];
  RR = cv.box / RES.s.box;
  HI = res === 'l';
  OX = cv.bx + cv.box / 2;
  OY = cv.by + cv.box / 2;
  return cv;
}

/** Новый кадр и буфер граней под него. */
function pickFrame(w: number, h: number): Frame {
  FB = new Int32Array(w * h).fill(-1);
  FE = new Int8Array(w * h);
  return newFrame(w, h);
}

/** Кромки граней самоцвета: пиксель у границы двух граней — на ступень светлее. */
function facetEdges(f: Frame): void {
  const { w, h, tone, pal } = f;
  const hit: number[] = [];
  for (let y = 1; y < h; y++)
    for (let x = 1; x < w; x++) {
      const i = y * w + x;
      const g = FB[i];
      if (g < 0 || !FE[i]) continue;
      const a = FB[i - w];
      const b = FB[i - 1];
      if ((a >= 0 && a !== g && pal[i - w] >= 0) || (b >= 0 && b !== g && pal[i - 1] >= 0)) hit.push(i);
    }
  for (const i of hit) tone[i] = Math.max(0, Math.min(PALS[pal[i]].length - 1, tone[i] + FE[i]));
}

function renderPick(f: Frame, sp: Spec, o: Pose, opt: PickOpt = {}): void {
  rasterPrims(f, buildPick(sp, o, opt));
}

/** Кадр → пиксели: швы, кант, контур. */
function finish(f: Frame): Px {
  facetEdges(f);
  seams(f, 1.6 * RR, 1);
  rimLight(f, PALS);
  const p = toPx(f, PALS);
  selOutline(p, INK, 0.8);
  return p;
}

/** Точка мира → пиксель холста и глубина. */
function scr(P: V3): [number, number, number] {
  const [x, y, d] = project(P);
  return [OX + x, OY + y, d];
}

/** Видна ли точка (не закрыта киркой). */
function visible(f: Frame, x: number, y: number, d: number): boolean {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  if (xi < 0 || yi < 0 || xi >= f.w || yi >= f.h) return false;
  const i = yi * f.w + xi;
  return f.pal[i] < 0 || f.zb[i] < d;
}

function putPx(p: Px, x: number, y: number, c: RGBA): void {
  p.set(Math.floor(x), Math.floor(y), c);
}

/** Звёздочка-блик: крест с ярким центром; `s` — длина луча в пикселях. */
function sparkle(p: Px, x: number, y: number, s: number, core: RGBA, arm: RGBA): void {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  if (s <= 0) return;
  p.set(xi, yi, core);
  for (let k = 1; k <= s; k++) {
    const c = k === s ? arm : k === 1 ? core : arm;
    p.set(xi + k, yi, c);
    p.set(xi - k, yi, c);
    p.set(xi, yi + k, c);
    p.set(xi, yi - k, c);
  }
  if (s >= 3) {
    p.set(xi + 1, yi + 1, arm);
    p.set(xi - 1, yi - 1, arm);
    p.set(xi + 1, yi - 1, arm);
    p.set(xi - 1, yi + 1, arm);
  }
}

/** Блики на плечах: точки в осях кирки, вспыхивают по очереди. */
const GLINTS: [number, number, number, number][] = [
  // u, n, b, фаза
  [CURVE * 0.81, W_ARM * 0.9, 0, 0.1],
  [CURVE * 0.36, -W_ARM * 0.6, 0, 0.55],
  [-H0 * 0.6, 0, 0, 0.32],
  [L_HANDLE + 1, 0, 0, 0.78],
];

function drawGlints(f: Frame, p: Px, o: Pose, rar: number, t: number, T: number): void {
  const n = rar >= 3 ? 4 : rar >= 2 ? 3 : 2;
  for (let k = 0; k < n; k++) {
    const g = GLINTS[k];
    const ph = wrap(t / T - g[3], 1);
    const life = 0.16;
    if (ph > life) continue;
    const a = Math.sin((ph / life) * Math.PI);
    const P = toW(o, g[0], g[1], g[2]);
    const [x, y, d] = scr(P);
    if (!visible(f, x, y, d - 3 * RR)) continue;
    const s = Math.round(a * (HI ? 3 + (rar >= 4 ? 1 : 0) : 1 + (rar >= 4 ? 1 : 0)));
    sparkle(p, x, y, s, [255, 255, 255, 255], rcol(rar, 3));
  }
}

/** Искорки ауры: поднимаются от головки вверх по миру, гаснут шахматкой. */
function drawAura(f: Frame, p: Px, o: Pose, rar: number, t: number, T: number): void {
  const n = rar >= 5 ? 14 : rar >= 4 ? 11 : rar >= 3 ? 9 : 6;
  for (let k = 0; k < n; k++) {
    const per = T / (1 + (k % 3 === 0 ? 1 : 0) + (rar >= 5 ? 1 : 0));
    const ph = wrap(t / per + hash(k, 1, 77), 1);
    // Точка рождения на головке: в осях кирки (поворачивается с ней).
    const side = k % 2 ? 1 : -1;
    const v = 0.15 + 0.8 * hash(k, 2, 77);
    const [u, nn] = armAt(side, v, W_ARM, CURVE);
    const b = (hash(k, 3, 77) - 0.5) * 2 * T0;
    const P0 = toW(o, u - H0 * 0.8, nn, b);
    const rise = ph * 11 * RR;
    const drift = Math.sin(TAU * (ph + hash(k, 4, 77))) * 1.4 * RR;
    const P: V3 = [P0[0] + drift, P0[1], P0[2] + rise];
    const [x, y, d] = scr(P);
    if (!visible(f, x, y, d)) continue;
    const fade = 1 - ph;
    if (!dith(Math.floor(x), Math.floor(y), Math.min(1, fade * 1.6))) continue;
    const c = ph < 0.3 ? rcol(rar, 5) : ph < 0.65 ? rcol(rar, 4) : rcol(rar, 2);
    putPx(p, x, y, c);
    if (HI && ph < 0.45) {
      putPx(p, x + 1, y, rcol(rar, 3));
      putPx(p, x, y + 1, rcol(rar, 2));
    }
  }
}

/** Огоньки на орбите вокруг рукояти (с легендарной): за киркой прячутся. */
function drawOrbit(f: Frame, p: Px, o: Pose, rar: number, t: number, T: number): void {
  const n = rar >= 6 ? 6 : rar >= 5 ? 5 : 3;
  const U = o.U;
  // Плоскость орбиты — поперёк рукояти, у головки.
  const c0 = toW(o, 6, 0, 0);
  const a1 = norm(cross(U, [0, 1, 0]));
  const a2 = norm(cross(U, a1));
  const rad = (W_ARM + 4) * RR;
  for (let k = 0; k < n; k++) {
    const ring = rar >= 5 ? k % 2 : 0;
    const dir = ring ? -1 : 1;
    const base = (k / n) * TAU;
    for (let tr = HI ? 4 : 2; tr >= 0; tr--) {
      const ang = base + dir * TAU * ((t - tr * (HI ? 0.022 : 0.035)) / T);
      const tilt = ring ? 0.5 : 0;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      const v1 = rot(a1, U, tilt);
      const v2 = rot(a2, U, tilt);
      const P: V3 = add(c0, add(mul(v1, ca * rad), mul(v2, sa * rad * (ring ? 0.8 : 1))));
      const Pz: V3 = add(P, mul(U, Math.sin(ang * 2 + k) * 3 * RR));
      const [x, y, d] = scr(Pz);
      if (!visible(f, x, y, d)) continue;
      const c = tr === 0 ? [255, 255, 255, 255] as RGBA : rcol(rar, tr <= 1 ? 4 : 2);
      if (tr > 0 && !dith(Math.floor(x), Math.floor(y), 1 - tr * 0.18)) continue;
      putPx(p, x, y, c);
      if (tr === 0) {
        putPx(p, x + 1, y, rcol(rar, 4));
        putPx(p, x - 1, y, rcol(rar, 4));
        putPx(p, x, y + 1, rcol(rar, 4));
        putPx(p, x, y - 1, rcol(rar, 4));
      }
    }
  }
}

/** Нимб божественной: кольцо поперёк рукояти над обухом; дальняя половина — за киркой. */
function drawHalo(f: Frame, p: Px, o: Pose, rar: number, t: number, T: number): void {
  const c0 = toW(o, -H0 * 1.3 - 6.5, 0, 0);
  const a1 = norm(cross(o.U, [0, 1, 0]));
  const a2 = norm(cross(o.U, a1));
  const rad = 7.2 * RR;
  const n = Math.round(rad * 7);
  const pulse = 0.5 + 0.5 * Math.sin((TAU * t) / T);
  for (let k = 0; k < n; k++) {
    const ang = (k / n) * TAU;
    const P = add(c0, add(mul(a1, Math.cos(ang) * rad), mul(a2, Math.sin(ang) * rad)));
    const [x, y, d] = scr(P);
    if (!visible(f, x, y, d)) continue;
    // Бегущий блик по кольцу.
    const hot = Math.cos(ang - (TAU * t) / T) > 0.92;
    putPx(p, x, y, hot ? [255, 255, 255, 255] : rcol(rar, pulse > 0.5 ? 4 : 3));
  }
}

/** Ореол ступени снаружи контура: шахматкой, в цвет редкости (с эпической). */
function rimGlow(p: Px, rar: number, k: number): void {
  const { w, h, data } = p;
  const add2: [number, number][] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 0) continue;
      let nb = false;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        if (data[(yy * w + xx) * 4 + 3] > 200) nb = true;
      }
      if (nb) add2.push([x, y]);
    }
  const c = rcol(rar, 2);
  const a = Math.round(255 * k);
  for (const [x, y] of add2) p.set(x, y, [c[0], c[1], c[2], a]);
}

// ---------------------------------------------------------------------------
// Вращение: петля 2 с.
// ---------------------------------------------------------------------------

/**
 * Угол поворота вокруг рукояти: полный оборот за петлю, но витрина
 * задерживается на трёх четвертях (θ0 и θ0 + π) и быстро проходит торец.
 */
export function spinAngle(ph: number): number {
  const u = 2 * ph;
  return THETA0 + Math.PI * (u - (0.7 * Math.sin(TAU * u)) / TAU);
}

function spinFrame(pick: number, i: number, res: Res): Px {
  const cv = setRes(res);
  const sp = SPECS[pick];
  const T = SPIN_N / FPS;
  const t = i / FPS;
  TIME = t;
  RAR = sp.rar;
  HOT = null;
  const th = spinAngle(i / SPIN_N);
  const o = pickPose(th);
  const f = pickFrame(cv.cw, cv.ch);
  renderPick(f, sp, o);
  const p = finish(f);
  const r = sp.rar;
  if (r >= 3) rimGlow(p, r, r >= 5 ? 0.55 : 0.4);
  if (r >= 6) drawHalo(f, p, o, r, t, T);
  if (r >= 2) drawAura(f, p, o, r, t, T);
  if (r >= 4) drawOrbit(f, p, o, r, t, T);
  if (r >= 1) drawGlints(f, p, o, r, t, T);
  return p;
}

// ---------------------------------------------------------------------------
// Полосы.
// ---------------------------------------------------------------------------

export interface Strip {
  frames: number;
  fps: number;
  loop: boolean;
  marks?: Record<string, number>;
}

export const STRIPS: Record<string, Strip> = {};
for (let k = 0; k < PICK_N; k++) STRIPS[`spin-${k}`] = { frames: SPIN_N, fps: FPS, loop: true };

export function frame(name: string, i: number, res: Res): Px {
  const m = /^spin-(\d+)$/.exec(name);
  if (m) return spinFrame(Number(m[1]), i, res);
  throw new Error(`кирки: нет полосы ${name}`);
}

// Пока не нужны (кузня) — чтобы линтер не ругался на импорт.
void kf;
void bump;
void clamp01;
void P_ANVIL;
void P_HAMMER;
export type { Key };
