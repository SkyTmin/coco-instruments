// Маски Комедии и Трагедии (анимации мобов 13). Облик прежний: летучая
// театральная маска — Комедия золотая с хохочущим ртом и румянцем, Трагедия
// серебряная с опущенным ртом и слезой; у висков ленты. Нитей нет.
//
// Маска — объёмная скорлупа (лоб, нос, скулы, подбородок, толщина), а не
// плоская наклейка: её точки поворачиваются (курс, кивок, крен) и ложатся в
// кадр с буфером глубины, свет сверху-слева. Сзади видно изнанку и прорези.
// Глаза и рот — сквозные прорези; внутри живёт «дух»: зрачки-искры, а в
// технике прорези разгораются (слой поверх темноты). Ленты — цепочка звеньев
// с запаздыванием: висят, вьются, тянутся за полётом, хлещут после удара.
// Маски симметричны: 5 рисуемых сторон, остальные 3 — зеркало (`sx` −1).
//
// Треки 24 к/с от времени режима (`f13-brains.ts`: `melee`, `rangedStep`,
// `maskPre`):
// - Комедия, укус — урон в конце `windup` 0,55 с, кадр контакта — первый
//   кадр `recover`: отпрянула, задрав лицо, хохочет («ха-ха», рот ходит),
//   держит с пылающими прорезями — и клюёт вниз-вперёд, рот захлопнут;
//   проводка ниже цели, отскок с «хе!», возврат с перелётом;
// - Трагедия, хлёст — `windup` 0,6 с: отвернулась, всхлипывает, держит —
//   и хлещет краем маски наотмашь (след по кромке); проводка, возврат;
// - Трагедия, слеза — `aim` 0,6 с, выстрел — первый кадр `recover` после
//   `aim`: поникла, рыдает толчками, в глазах набухают слёзы, вскинула лицо
//   к небу — и всхлип вперёд: слеза срывается (след из глаза), отдача;
// - `f13_heal` 1 с: повернулась к паре, поёт с пылающими прорезями, ленты
//   вверх, к концу — кивок-отдача (лечение пары в конце режима);
// - `f13_broken` до 4 с: треснула, падает навзничь, лежит, вздрагивает; с
//   3,4 с трещины наливаются золотом (кинцуги), встаёт; после — золото гаснет;
// - смерть: в полёте — трещит, падает и разлетается черепками; разбитая на
//   полу (пара тоже разбита) — разлетается там, где лежит;
// - `drop` (Комедия падает со свода) кувырком; приземление — `stun`.

import { Px } from '../dungeon-art';
import { registerMobPainter, registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import { INK, P, hx, mixc, withA } from './f13-art';
import type { RGBA } from './f13-art';
import { F13_FX } from './f13-brains';
import {
  PI,
  TAU,
  angD,
  clamp,
  clamp01,
  dirN,
  eBack,
  easeIn,
  easeOut,
  fi,
  frameOf,
  hash,
  headOf,
  hurtAge,
  hurtFx,
  kindOf,
  lin,
  moving,
  puff,
  smearInto,
  smooth,
  spark,
  sstep,
  tf,
  visOf,
  warmAll,
  yawN,
} from './f13-mobkit';
import type { Ease, Kind, Pic } from './f13-mobkit';

/** Сжатие глубины в кадре — как у `rigProj` (`f13-art.ts`). */
const DEPTH = 0.56;
/** Высота середины маски над полом, пиксели (кадр держит `lift`). */
const LIFT = 22;
const SL_LIFT = 15;
const LIE_LIFT = 5;
/** Толщина скорлупы, шаг точек, звенья лент. */
const TH = 0.9;
const STEP = 0.35;
const SEG = 1.45;
const NR = 9;
/** Рисуемые стороны; 3, 4, 5 — зеркало 1, 0, 7. */
const SIDES = [0, 1, 2, 6, 7] as const;

// ---------------------------------------------------------------------------
// Поза маски: числа, ключи, трек.
// ---------------------------------------------------------------------------

interface MP {
  /** Кивок (+ лицо вверх), крен, поворот от курса, рад. */
  pit: number;
  rol: number;
  yo: number;
  /** Подъём и вынос вперёд, пиксели; раздув. */
  z: number;
  fw: number;
  sc: number;
  /** Рот 0…1, сила гримасы, свет прорезей, зрачки (−1 погасли, 1 вспыхнули), взгляд вбок. */
  mo: number;
  ex: number;
  gl: number;
  pu: number;
  lx: number;
  /** Ленты: тяжесть, след за полётом (− хлещут вперёд), волна, фаза (обороты), распах, вверх. */
  rg: number;
  rt: number;
  ra: number;
  rp: number;
  rf: number;
  ru: number;
  /** Трещины 0…1, золото кинцуги, черепки, слеза в глазу. */
  cr: number;
  ks: number;
  sh: number;
  td: number;
}
type MKey = readonly [number, MP, Ease?];

const M0: MP = {
  pit: 0.1,
  rol: 0,
  yo: 0,
  z: 0,
  fw: 0,
  sc: 1,
  mo: 0.15,
  ex: 0.5,
  gl: 0,
  pu: 0,
  lx: 0,
  rg: 0.8,
  rt: 0.25,
  ra: 0.5,
  rp: 0,
  rf: 0.15,
  ru: 0,
  cr: 0,
  ks: 0,
  sh: 0,
  td: 0,
};
const mp = (o: Partial<MP>, b: MP = M0): MP => ({ ...b, ...o });

function mixM(a: MP, b: MP, k: number): MP {
  if (k === 0) return a;
  if (k === 1) return b;
  const o = { ...a };
  for (const key in b) {
    const n = key as keyof MP;
    o[n] = a[n] + (b[n] - a[n]) * k;
  }
  return o;
}

function mtrack(t: number, keys: readonly MKey[]): MP {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const k1 = keys[i];
    if (t < k1[0]) {
      const k0 = keys[i - 1];
      return mixM(k0[1], k1[1], (k1[2] ?? smooth)((t - k0[0]) / (k1[0] - k0[0])));
    }
  }
  return keys[keys.length - 1][1];
}

// ---------------------------------------------------------------------------
// Скорлупа: форма, рельеф, точки (раз на вид).
// ---------------------------------------------------------------------------

interface MaskPal {
  /** Тона лица, ободка, румянца/дорожки слезы, изнанки, лент. */
  skin: RGBA[];
  rim: RGBA[];
  paint: RGBA[];
  inner: RGBA[];
  rib: RGBA[];
  glow: RGBA;
  pupil: RGBA;
  brow: RGBA;
  lip: RGBA;
  hi: RGBA;
  /** Золото кинцуги. */
  seam: RGBA;
}

interface Mask extends MaskPal {
  name: string;
  tragic: boolean;
  RX: number;
  RY: number;
  /** Замах ближнего боя (`def.windup`), с. */
  W: number;
  /** Точки скорлупы: u, v (вправо маски, вверх), глубина, нормаль, доля радиуса. */
  n: number;
  U: Float32Array;
  V: Float32Array;
  Z: Float32Array;
  NX: Float32Array;
  NY: Float32Array;
  NZ: Float32Array;
  Q: Float32Array;
  /** Трещина: доля раскрытия, с которой точка — трещина (−1 — не трещина). */
  CK: Float32Array;
  /** Черепок точки. */
  SH: Uint8Array;
}

function rxOf(tragic: boolean, RX: number, RY: number, v: number): number {
  const c = clamp01(-v / RY);
  let r = RX * (1 - (tragic ? 0.26 : 0.14) * c * c);
  if (!tragic) r *= 1 + 0.05 * Math.exp(-(((v + 2) / 3) ** 2));
  return r;
}

function depthOf(tragic: boolean, RX: number, RY: number, u: number, v: number): number {
  const rx = rxOf(tragic, RX, RY, v);
  const q = (u / rx) ** 2 + (v / RY) ** 2;
  if (q >= 1) return 0;
  const au = Math.abs(u);
  let w = 4.4 * Math.sqrt(1 - q);
  // Нос, надбровья, подбородок.
  w +=
    1.5 *
    Math.exp(-((u / 1.15) ** 2)) *
    sstep(-3, -1.6, v) *
    (1 - sstep(1.2, 2.8, v)) *
    (0.7 + 0.3 * clamp01((1.5 - v) / 4));
  w += 0.55 * Math.exp(-(((v - 4.3) / 1.1) ** 2)) * (1 - sstep(5, 7.5, au));
  w += 0.5 * Math.exp(-((u / 2.6) ** 2) - ((v + RY * 0.78) / 1.6) ** 2);
  if (!tragic) {
    // Смех поднял скулы.
    w += 1.1 * Math.exp(-(((au - 4.9) / 2) ** 2) - ((v + 1.5) / 1.8) ** 2);
  } else {
    // Впалые щёки, сведённые брови.
    w -= 0.45 * Math.exp(-(((au - 4.4) / 1.8) ** 2) - ((v + 2.6) / 2) ** 2);
    w += 0.5 * Math.exp(-((u / 1.4) ** 2) - ((v - 4.4) / 1) ** 2);
  }
  return w;
}

/** Трещины: отрезки в плоскости маски и доля раскрытия, когда они видны. */
const CRACKS: readonly (readonly [number, number, number, number, number, number])[] = [
  [0.4, 10.6, -0.8, 6.2, 0, 0.15],
  [-0.8, 6.2, 0.9, 2.8, 0.15, 0.3],
  [0.9, 2.8, -0.6, -1.5, 0.3, 0.5],
  [-0.6, -1.5, 1.0, -6, 0.5, 0.75],
  [1.0, -6, -0.2, -11, 0.75, 1],
  [-0.8, 6.2, -4.6, 7.9, 0.25, 0.5],
  [0.9, 2.8, 5.6, 3.7, 0.35, 0.6],
  [-0.6, -1.5, -5.8, -4.1, 0.55, 0.8],
  [1.0, -6, 4.7, -7.7, 0.75, 0.95],
];

function crackOf(u: number, v: number): number {
  let best = 0.42;
  let at = -1;
  for (const [x0, y0, x1, y1, p0, p1] of CRACKS) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const s = clamp01(((u - x0) * dx + (v - y0) * dy) / (dx * dx + dy * dy));
    const d = Math.hypot(u - x0 - dx * s, v - y0 - dy * s);
    if (d < best) {
      best = d;
      at = p0 + (p1 - p0) * s;
    }
  }
  return at;
}

function shardOf(u: number, v: number): number {
  const a = Math.atan2(v - 0.6, u + 0.3);
  const r = Math.hypot(u + 0.3, v - 0.6);
  if (r < 2.4 + 0.6 * Math.sin(a * 3)) return 6;
  return ((Math.floor(((a + PI) / TAU) * 6 + 0.12 * Math.sin(r * 1.7)) % 6) + 6) % 6;
}

function makeMask(name: string, tragic: boolean, W: number, pal: MaskPal): Mask {
  const RX = tragic ? 8.6 : 9;
  const RY = tragic ? 11 : 10.5;
  const pts: number[][] = [];
  for (let v = -RY + STEP / 2; v < RY; v += STEP)
    for (let u = -RX - 0.6; u < RX + 0.6; u += STEP) {
      const rx = rxOf(tragic, RX, RY, v);
      const q = (u / rx) ** 2 + (v / RY) ** 2;
      if (q > 1) continue;
      const h = 0.2;
      const w = depthOf(tragic, RX, RY, u, v);
      let gu = (depthOf(tragic, RX, RY, u + h, v) - depthOf(tragic, RX, RY, u - h, v)) / (2 * h);
      let gv = (depthOf(tragic, RX, RY, u, v + h) - depthOf(tragic, RX, RY, u, v - h)) / (2 * h);
      const gl = Math.hypot(gu, gv);
      if (gl > 4) {
        gu *= 4 / gl;
        gv *= 4 / gl;
      }
      const l = Math.hypot(gu, gv, 1);
      pts.push([u, v, w, -gu / l, -gv / l, 1 / l, q, crackOf(u, v), shardOf(u, v)]);
    }
  const n = pts.length;
  const col = (i: number) => Float32Array.from(pts, (p) => p[i]);
  return {
    name,
    tragic,
    RX,
    RY,
    W,
    ...pal,
    n,
    U: col(0),
    V: col(1),
    Z: col(2),
    NX: col(3),
    NY: col(4),
    NZ: col(5),
    Q: col(6),
    CK: col(7),
    SH: Uint8Array.from(pts, (p) => p[8]),
  };
}

const VOID = hx('#0a0610');
const TEAR = hx('#6ac8ff');
const TEAR_HI = hx('#e4f6ff');
const SMEAR_C = hx('#fff4d8');
const SMEAR_T = hx('#d8f0ff');
const SPARK_C = hx('#ffffff');
const WHITE = hx('#ffffff');

const COMEDY = makeMask('f13_comedy', false, 0.55, {
  skin: [...P.gold],
  rim: [P.gold[1], P.gold[2], P.gold[3], mixc(P.gold[3], WHITE, 0.5)],
  paint: P.gold.map((c) => mixc(c, hx('#e8505a'), 0.6)),
  inner: [P.velvet[0], P.velvet[1], P.velvet[2]],
  seam: hx('#fffbe0'),
  rib: [...P.velvet],
  glow: hx('#ff6a28'),
  pupil: hx('#ffd040'),
  brow: hx('#3a2008'),
  lip: hx('#a82434'),
  hi: mixc(P.gold[3], WHITE, 0.6),
});

const TRAGEDY = makeMask('f13_tragedy', true, 0.6, {
  skin: [...P.silver],
  rim: [P.silver[1], P.silver[2], P.silver[3], WHITE],
  paint: P.silver.map((c) => mixc(c, TEAR, 0.6)),
  inner: [hx('#0c1030'), hx('#1c2660'), hx('#30408e')],
  seam: hx('#ffd040'),
  rib: [hx('#0c1030'), hx('#1c2660'), hx('#30408e'), hx('#5a70c8')],
  glow: hx('#40a8ff'),
  pupil: hx('#8ad8ff'),
  brow: hx('#262c3a'),
  lip: hx('#3a3050'),
  hi: WHITE,
});

// ---------------------------------------------------------------------------
// Лицо: прорези, роспись (по точке скорлупы и позе).
// ---------------------------------------------------------------------------

const C_SKIN = 0;
const C_VOID = 1;
const C_PUPIL = 2;
const C_BROW = 3;
const C_PAINT = 4;
const C_LIP = 5;
const C_LINER = 6;
const C_BEAD = 7;
const C_RIM = 9;

/** Прорезь или роспись в точке (u, v); `hole` — сквозная. */
let hole = false;
function faceAt(M: Mask, q: MP, u: number, v: number, rimQ: number): number {
  hole = false;
  const au = Math.abs(u);
  const s = u < 0 ? -1 : 1;
  if (!M.tragic) {
    // Глаза-дуги: смеющийся прищур.
    const x = (au - 3.7) / 2.7;
    if (x > -1 && x < 1) {
      const top = 2.4 + 1.2 * (1 - x * x);
      const th = (0.85 + 1.0 * (1 - x * x)) * (1 - 0.2 * q.ex);
      if (v < top && v > top - th) {
        hole = true;
        if (q.pu >= 0) {
          const r = q.pu > 0.5 ? 1.05 : 0.72;
          if (Math.hypot(u - s * 3.7 - q.lx * 0.6, v - (top - th * 0.5)) < r) return C_PUPIL;
        }
        return C_VOID;
      }
      if (v >= top && v < top + 0.5) return C_LINER;
    }
    const bx = (au - 3.5) / 2.8;
    if (bx > -1 && bx < 1 && Math.abs(v - (5.5 + 0.9 * (1 - bx * bx))) < 0.42) return C_BROW;
    // Рот — широкий полумесяц.
    const mx = u / 5.4;
    if (mx > -1 && mx < 1) {
      const top = -3.8 + 1.9 * mx * mx;
      const th = (0.6 + 2.8 * q.mo) * (1 - mx * mx) ** 0.7;
      if (v < top && v > top - th) {
        hole = true;
        return C_VOID;
      }
      if ((v <= top - th && v > top - th - 0.55) || (v >= top && v < top + 0.4)) return C_LIP;
    }
    if ((au - 5.3) ** 2 + (v + 1.4) ** 2 < 2.1) return C_PAINT;
  } else {
    // Глаза — миндаль, внешние концы опущены.
    const x = (au - 3.5) / 2.2;
    if (x > -1 && x < 1) {
      const vc = 1.6 - (0.45 + 0.25 * q.ex) * x;
      const hth = 0.75 * Math.sqrt(1 - x * x);
      const dv = v - vc;
      if (Math.abs(dv) < hth) {
        hole = true;
        if (q.pu >= 0) {
          const r = q.pu > 0.5 ? 1.05 : 0.72;
          if (Math.hypot(u - s * 3.5 - q.lx * 0.6, dv) < r) return C_PUPIL;
        }
        return C_VOID;
      }
      if (dv >= hth && dv < hth + 0.5) return C_LINER;
    }
    // Слеза на нижнем веке.
    if (q.td > 0.05) {
      const r = 0.45 + 0.85 * q.td;
      if (Math.hypot(au - 3.4, v - (0.3 - 0.8 * q.td)) < r) return C_BEAD;
    }
    const bx = (au - 3.3) / 2.6;
    if (bx > -1 && bx < 1 && Math.abs(v - (4.5 - (0.5 + 0.7 * q.ex) * bx)) < 0.42) return C_BROW;
    if (au < 0.45 && v > 4.2 && v < 5.6 && q.ex > 0.6) return C_BROW;
    // Рот — дуга концами вниз.
    const mx = u / 4.6;
    if (mx > -1 && mx < 1) {
      const vc = -5.7 + 1.5 * (1 - mx * mx);
      const th = (0.5 + 2.4 * q.mo) * (1 - mx * mx) ** 0.7;
      const dv = Math.abs(v - vc);
      if (dv < th / 2) {
        hole = true;
        return C_VOID;
      }
      if (dv < th / 2 + 0.5) return C_LIP;
    }
    // Дорожка слезы.
    const dx = 0.9;
    const dy = -4.8;
    const k = clamp01(((au - 3.6) * dx + (v - 0.6) * dy) / (dx * dx + dy * dy));
    if (Math.hypot(au - 3.6 - dx * k, v - 0.6 - dy * k) < 0.4) return C_PAINT;
  }
  return rimQ > 0.86 ? C_RIM : C_SKIN;
}

// ---------------------------------------------------------------------------
// Кадр: скорлупа + ленты в буфер глубины → контур → свет прорезей.
// ---------------------------------------------------------------------------

const LX = -0.45 / 1.0;
const LY = 0.45;
const LU = 0.77;
const LN = Math.hypot(LX, LY, LU);
const L = [LX / LN, LY / LN, LU / LN];
const HN = Math.hypot(L[0], L[1] + 0.77, L[2] + 0.64);
const H = [L[0] / HN, (L[1] + 0.77) / HN, (L[2] + 0.64) / HN];

interface Buf {
  zb: Float32Array;
  la: Float32Array;
  lc: Uint8Array;
}
const BUFS = new Map<number, Buf>();
function bufOf(w: number, h: number): Buf {
  const k = w * 1000 + h;
  let b = BUFS.get(k);
  if (!b) {
    b = { zb: new Float32Array(w * h), la: new Float32Array(w * h), lc: new Uint8Array(w * h) };
    BUFS.set(k, b);
  }
  b.zb.fill(-1e9);
  b.la.fill(0);
  return b;
}

/** Преобразование маски для позы: точка маски → риг (вправо, вверх, вперёд). */
interface Xf {
  cr: number;
  sr: number;
  cp: number;
  sp: number;
  s: number;
  z: number;
  fw: number;
  /** Курс кадра: вправо (rx, ry) и вперёд (fx, fy) на полу. */
  rx: number;
  ry: number;
  fx: number;
  fy: number;
  ax: number;
  ay: number;
}
function xfOf(q: MP, yaw: number, K: Kind): Xf {
  const fx = Math.cos(yaw);
  const fy = Math.sin(yaw);
  return {
    cr: Math.cos(q.rol),
    sr: Math.sin(q.rol),
    cp: Math.cos(q.pit),
    sp: Math.sin(q.pit),
    s: q.sc,
    z: q.z,
    fw: q.fw,
    rx: -fy,
    ry: fx,
    fx,
    fy,
    ax: K.ax,
    ay: K.ay,
  };
}
const OUT = [0, 0, 0];
/** Точка маски → кадр: x, y, глубина (больше — ближе) в `OUT`. */
function projM(X: Xf, u: number, v: number, w: number, up = 0): number[] {
  const x1 = u * X.cr - v * X.sr;
  const y1 = u * X.sr + v * X.cr;
  const y2 = y1 * X.cp + w * X.sp;
  const z2 = -y1 * X.sp + w * X.cp;
  return projR(X, x1 * X.s, y2 * X.s + X.z + up, z2 * X.s + X.fw);
}
/** Точка рига → кадр. */
function projR(X: Xf, x: number, y: number, z: number): number[] {
  const gx = x * X.rx + z * X.fx;
  const gy = x * X.ry + z * X.fy;
  OUT[0] = X.ax + gx;
  OUT[1] = X.ay + gy * DEPTH - y;
  OUT[2] = gy * 0.77 + y * 0.64;
  return OUT;
}
/** Направление маски → риг. */
const DOUT = [0, 0, 0];
function dirM(X: Xf, u: number, v: number, w: number): number[] {
  const x1 = u * X.cr - v * X.sr;
  const y1 = u * X.sr + v * X.cr;
  DOUT[0] = x1;
  DOUT[1] = y1 * X.cp + w * X.sp;
  DOUT[2] = -y1 * X.sp + w * X.cp;
  return DOUT;
}

const shade = (l: number) => (l > 0.9 ? 3 : l > 0.52 ? 2 : l > 0.12 ? 1 : 0);

function setPx(p: Px, i: number, c: RGBA): void {
  const o = i * 4;
  p.data[o] = c[0];
  p.data[o + 1] = c[1];
  p.data[o + 2] = c[2];
  p.data[o + 3] = 255;
}

/** Ленты: цепочка от виска, `floorY` — пол в координатах рига. */
function ribbons(M: Mask, q: MP, X: Xf, p: Px, b: Buf, w: number, h: number, floorY: number): void {
  const rv = 1.8;
  const ru0 = rxOf(M.tragic, M.RX, M.RY, rv) - 0.5;
  for (const s of [-1, 1]) {
    // Узел у виска (с учётом черепков — ленты остаются у своего края).
    let du = 0;
    let dv = 0;
    if (q.sh > 0) {
      const k = s < 0 ? 3 : 0;
      const ak = ((k + 0.5) / 6) * TAU - PI;
      const R = (4.5 + 3.5 * hash(k, 5)) * q.sh;
      du = Math.cos(ak) * R;
      dv = Math.sin(ak) * R;
    }
    const a = projM(X, s * ru0 + du, rv + dv, 0.3);
    const ax = a[0];
    const ay = a[1];
    const ad = a[2];
    const d0 = dirM(X, s * 0.45, 0.05, -1);
    const l0 = Math.hypot(d0[0], d0[1], d0[2]);
    const D0x = d0[0] / l0;
    const D0y = d0[1] / l0;
    const D0z = d0[2] / l0;
    // Риг-точка узла: обратно из кадра не считаем — ведём цепочку в риге.
    const x1 = (s * ru0 + du) * X.cr - (rv + dv) * X.sr;
    const y1 = (s * ru0 + du) * X.sr + (rv + dv) * X.cr;
    let px = x1 * X.s;
    let py = (y1 * X.cp + 0.3 * X.sp) * X.s + X.z;
    let pz = (-y1 * X.sp + 0.3 * X.cp) * X.s + X.fw;
    let dx = D0x;
    let dy = D0y;
    let dz = D0z;
    let sx0 = ax;
    let sy0 = ay;
    let sd0 = ad;
    // Узел — бантик.
    for (const [ox, oy, c] of [
      [0, 0, 3],
      [-1, 0, 2],
      [0, 1, 1],
      [1, 0, 2],
    ] as const) {
      const xi = Math.floor(ax + ox);
      const yi = Math.floor(ay + oy);
      if (xi < 0 || yi < 0 || xi >= w || yi >= h) continue;
      const i = yi * w + xi;
      if (ad + 0.3 <= b.zb[i]) continue;
      b.zb[i] = ad + 0.3;
      b.la[i] = 0;
      setPx(p, i, M.rib[c]);
    }
    for (let n = 1; n <= NR; n++) {
      const k = n / NR;
      const wv = Math.sin(TAU * (q.rp - k * 0.85)) * q.ra;
      const st = 1.3 * (1 - k);
      let tx = D0x * st + s * (q.rf * (0.4 + k) + wv * 0.5);
      let ty = D0y * st - q.rg * (0.3 + 1.1 * k) + q.ru * (0.3 + k) + wv * 0.6;
      let tz = D0z * st - q.rt * (0.3 + 0.9 * k);
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl;
      ty /= tl;
      tz /= tl;
      dx = dx * 0.3 + tx * 0.7;
      dy = dy * 0.3 + ty * 0.7;
      dz = dz * 0.3 + tz * 0.7;
      const dl = Math.hypot(dx, dy, dz) || 1;
      dx /= dl;
      dy /= dl;
      dz /= dl;
      px += dx * SEG;
      py += dy * SEG;
      pz += dz * SEG;
      if (py < floorY + 0.5) py = floorY + 0.5;
      const e = projR(X, px, py, pz);
      const sx1 = e[0];
      const sy1 = e[1];
      const sd1 = e[2];
      // Поперёк звена на экране: светлая кромка — верхняя.
      let nx = -(sy1 - sy0);
      let ny = sx1 - sx0;
      const nl = Math.hypot(nx, ny) || 1;
      nx /= nl;
      ny /= nl;
      if (ny > 0) {
        nx = -nx;
        ny = -ny;
      }
      const wd = 0.55 * (1 - 0.4 * k);
      const fold = n % 4 === 2 && dy > -0.2;
      const steps = Math.max(2, Math.ceil(Math.hypot(sx1 - sx0, sy1 - sy0) / 0.35));
      for (let j = 0; j < steps; j++) {
        const f = (j + 0.5) / steps;
        const cx = sx0 + (sx1 - sx0) * f;
        const cy = sy0 + (sy1 - sy0) * f;
        const cd = sd0 + (sd1 - sd0) * f;
        for (const side of [1, -1]) {
          const xi = Math.floor(cx + nx * wd * side);
          const yi = Math.floor(cy + ny * wd * side);
          if (xi < 0 || yi < 0 || xi >= w || yi >= h) continue;
          const i = yi * w + xi;
          if (cd <= b.zb[i]) continue;
          b.zb[i] = cd;
          b.la[i] = 0;
          setPx(p, i, M.rib[side > 0 ? (fold ? 3 : 2) : k > 0.75 ? 0 : 1]);
        }
      }
      sx0 = sx1;
      sy0 = sy1;
      sd0 = sd1;
    }
  }
}

const SDX = new Float32Array(7);
const SDY = new Float32Array(7);
const SHOP = new Float32Array(7);

/** Маска в позе `q` курсом `yaw`; `floorY` — пол в риге (для лент и черепков). */
function render(
  M: Mask,
  K: Kind,
  q: MP,
  yaw: number,
  floorY: number,
): { p: Px; lit: Px | null; eye: [number, number] | null } {
  const w = K.w;
  const h = K.h;
  const p = new Px(w, h);
  const b = bufOf(w, h);
  const X = xfOf(q, yaw, K);
  // Черепки: разлёт в плоскости маски и подскок.
  if (q.sh > 0) {
    for (let k = 0; k < 7; k++) {
      const ak = ((k + 0.5) / 6) * TAU - PI;
      const R = k === 6 ? 1 : (4.5 + 3.5 * hash(k, 5)) * q.sh;
      SDX[k] = k === 6 ? 0.6 * q.sh : Math.cos(ak) * R;
      SDY[k] = k === 6 ? -0.8 * q.sh : Math.sin(ak) * R;
      SHOP[k] = (2 + 3 * hash(k, 9)) * Math.sin(PI * clamp01(q.sh * 1.15));
    }
  }
  const { rx, ry, fx, fy, cr, sr, cp, sp } = X;
  const glow = q.gl;
  let anyLit = false;
  for (let i = 0; i < M.n; i++) {
    const u0 = M.U[i];
    const v0 = M.V[i];
    let u = u0;
    let v = v0;
    let up = 0;
    if (q.sh > 0) {
      const k = M.SH[i];
      u += SDX[k];
      v += SDY[k];
      up = SHOP[k];
    }
    // Нормаль: крен, кивок, курс.
    const nx0 = M.NX[i];
    const ny0 = M.NY[i];
    const nz0 = M.NZ[i];
    const nx1 = nx0 * cr - ny0 * sr;
    const ny1 = nx0 * sr + ny0 * cr;
    const ny2 = ny1 * cp + nz0 * sp;
    const nz2 = -ny1 * sp + nz0 * cp;
    const wx = nx1 * rx + nz2 * fx;
    const wy = nx1 * ry + nz2 * fy;
    const front = wy * 0.77 + ny2 * 0.64 > 0;
    const zz = front ? M.Z[i] : M.Z[i] - TH;
    // Точка.
    const x1 = u * cr - v * sr;
    const y1 = u * sr + v * cr;
    const py = (y1 * cp + zz * sp) * X.s + X.z + up;
    const pz = (-y1 * sp + zz * cp) * X.s + X.fw;
    const pxr = x1 * X.s;
    const gx = pxr * rx + pz * fx;
    const gy = pxr * ry + pz * fy;
    const xi = Math.floor(X.ax + gx);
    const yi = Math.floor(X.ay + gy * DEPTH - Math.max(py, floorY + 0.3));
    if (xi < 0 || yi < 0 || xi >= w || yi >= h) continue;
    const dep = gy * 0.77 + py * 0.64;
    const j = yi * w + xi;
    if (dep <= b.zb[j]) continue;
    b.zb[j] = dep;
    b.la[j] = 0;
    // Цвет.
    const ck = M.CK[i];
    const l = front ? wx * L[0] + wy * L[1] + ny2 * L[2] : -(wx * L[0] + wy * L[1] + ny2 * L[2]);
    if (ck >= 0 && ck <= q.cr) {
      if (q.ks > 0.05) {
        setPx(p, j, mixc(INK, M.seam, q.ks));
        b.la[j] = q.ks * 0.9;
        b.lc[j] = 2;
        anyLit = true;
      } else setPx(p, j, INK);
      continue;
    }
    const c = faceAt(M, q, u0, v0, M.Q[i]);
    if (hole) {
      if (!front || c === C_VOID || q.pu < 0) {
        if (front && glow > 0.05) {
          setPx(p, j, mixc(VOID, M.glow, Math.min(1, glow * 1.1)));
          if (glow >= 0.35) {
            b.la[j] = glow * 0.85;
            b.lc[j] = 0;
            anyLit = true;
          }
        } else setPx(p, j, VOID);
      } else {
        setPx(p, j, glow > 0.5 ? WHITE : M.pupil);
        if (glow >= 0.35) {
          b.la[j] = 1;
          b.lc[j] = 3;
          anyLit = true;
        }
      }
      continue;
    }
    if (!front) {
      // Изнанка — бархатная подкладка, по краю — срез скорлупы.
      setPx(p, j, M.Q[i] > 0.88 ? M.skin[l > 0.3 ? 2 : 1] : M.inner[l > 0.45 ? 2 : l > 0 ? 1 : 0]);
      continue;
    }
    const t = shade(l);
    const spec = wx * H[0] + wy * H[1] + ny2 * H[2];
    switch (c) {
      case C_BROW:
        setPx(p, j, M.brow);
        break;
      case C_LIP:
        setPx(p, j, t >= 2 ? mixc(M.lip, WHITE, 0.15) : M.lip);
        break;
      case C_LINER:
        setPx(p, j, M.skin[0]);
        break;
      case C_PAINT:
        setPx(p, j, M.paint[t]);
        break;
      case C_BEAD:
        setPx(p, j, t >= 2 ? TEAR_HI : TEAR);
        if (q.td > 0.4) {
          b.la[j] = 0.5 + 0.5 * q.td;
          b.lc[j] = 1;
          anyLit = true;
        }
        break;
      case C_RIM:
        setPx(p, j, spec > 0.95 ? M.hi : M.rim[t]);
        break;
      default:
        setPx(p, j, spec > 0.975 ? M.hi : M.skin[t]);
    }
  }
  ribbons(M, q, X, p, b, w, h, floorY);
  p.outline(INK);
  let lit: Px | null = null;
  if (anyLit) {
    lit = new Px(w, h);
    const cols = [M.glow, TEAR, M.seam, WHITE];
    for (let j = 0; j < w * h; j++) {
      const a = b.la[j];
      if (a > 0 && p.data[j * 4 + 3]) {
        const c = cols[b.lc[j]];
        const o = j * 4;
        lit.data[o] = c[0];
        lit.data[o + 1] = c[1];
        lit.data[o + 2] = c[2];
        lit.data[o + 3] = Math.round(a * 255);
      }
    }
  }
  // Глаз для движка: зрачок ближнего глаза, если лицо к зрителю.
  let eye: [number, number] | null = null;
  const fd = dirM(X, 0, 0, 1);
  const toCam = (fd[0] * ry + fd[2] * fy) * 0.77 + fd[1] * 0.64;
  if (q.pu >= 0 && q.sh <= 0 && glow < 0.35 && toCam > 0.2) {
    const ex = M.tragic ? 3.5 : 3.7;
    const ev = M.tragic ? 1.6 : 2.6;
    let best = -1e9;
    for (const s of [-1, 1]) {
      const e = projM(X, s * ex + q.lx * 0.6, ev, 3.4);
      const xi = Math.floor(e[0]);
      const yi = Math.floor(e[1]);
      if (xi < 0 || yi < 0 || xi >= w || yi >= h) continue;
      const j = yi * w + xi;
      if (e[2] > best && Math.abs(b.zb[j] - e[2]) < 1.2) {
        best = e[2];
        eye = [xi, yi];
      }
    }
  }
  return { p, lit, eye };
}

// ---------------------------------------------------------------------------
// Треки.
// ---------------------------------------------------------------------------

const IDLE_N = 16;
const FLY_N = 12;
const REC_N = 11;
const AIM = 0.6;
const AIM_N = 15;
const AREC_N = 11;
const HEAL_N = 24;
const BRK = 0.6;
const BRK_N = 15;
const LIE_N = 12;
const RISE0 = 3.4;
const RISE_N = 15;
const MEND = 0.42;
const MEND_N = 10;
const DIE_N = 20;
const DIE2_N = 15;
const HURT_N = 8;
const AL_N = 9;
const LOST_N = 12;
const SL_N = 8;
const DROP_N = 14;
const LAND_N = 5;
const windN = (M: Mask) => Math.floor(M.W * 24 + 1e-6) + 1;

/** Покой своей маски. */
const baseOf = (M: Mask): MP =>
  M.tragic ? mp({ pit: 0.02, mo: 0.12, td: 0.2, rg: 1.0, ra: 0.4 }) : M0;

// Комедия: укус с хохотом.
const C_B = M0;
const C_WIND: MKey[] = [
  [0, C_B],
  [
    0.1,
    mp({
      pit: 0.45,
      fw: -2.5,
      z: 1.5,
      mo: 0.7,
      ex: 1,
      gl: 0.2,
      rt: -0.2,
      ra: 0.6,
      rp: 0.3,
      rf: 0.3,
    }),
    easeOut,
  ],
  [
    0.34,
    mp({
      pit: 0.45,
      fw: -2.6,
      z: 1.5,
      mo: 0.75,
      ex: 1,
      gl: 0.3,
      rt: -0.25,
      ra: 0.6,
      rp: 1,
      rf: 0.35,
    }),
    lin,
  ],
  [
    0.44,
    mp({
      pit: 0.55,
      fw: -3.2,
      z: 2,
      sc: 1.08,
      mo: 1,
      ex: 1,
      gl: 1,
      pu: 1,
      rt: -0.4,
      rf: 0.45,
      rp: 1.2,
      ra: 0.3,
    }),
  ],
  [
    0.55,
    mp({
      pit: 0,
      fw: 4,
      z: -1,
      sc: 1.16,
      mo: 0.1,
      ex: 1,
      gl: 1,
      rt: 0.9,
      rf: 0.2,
      rp: 1.5,
      ra: 0.4,
    }),
    easeIn,
  ],
];
const C_REC: MKey[] = [
  [
    0,
    mp({
      pit: -0.05,
      fw: 4.5,
      z: -1.2,
      sc: 1.2,
      mo: 0,
      ex: 1,
      gl: 0.8,
      rt: 1.2,
      rf: 0.1,
      rp: 1.6,
      ra: 0.3,
    }),
  ],
  [
    0.07,
    mp({
      pit: -0.12,
      fw: 5,
      sc: 1.12,
      z: -1.5,
      mo: 0.05,
      ex: 1,
      gl: 0.4,
      rt: -0.6,
      rf: 0.3,
      rp: 1.8,
      ra: 0.5,
    }),
    easeOut,
  ],
  [0.2, mp({ pit: 0.25, fw: 0.5, z: 1, mo: 0.6, ex: 1, rt: 0.2, rp: 2.1 }), smooth],
  [0.45, mp({ rp: 3 }), eBack],
];

// Трагедия: волчок — отвернулась, всхлипывает, держит и крутится на месте,
// ленты хлещут по кругу (контакт — лицо снова к цели, ленты на вылете).
const T_B = baseOf(TRAGEDY);
const tp = (o: Partial<MP>) => mp(o, T_B);
const T_WIND: MKey[] = [
  [0, T_B],
  [
    0.14,
    tp({
      yo: 0.6,
      rol: 0.15,
      pit: -0.12,
      mo: 0.6,
      ex: 1,
      td: 0.4,
      rt: 0.6,
      rg: 0.6,
      ra: 0.3,
      rp: 0.3,
    }),
    easeOut,
  ],
  [
    0.4,
    tp({
      yo: 0.85,
      rol: 0.2,
      pit: -0.15,
      mo: 0.8,
      ex: 1,
      td: 0.6,
      gl: 0.5,
      rt: 0.8,
      rg: 0.5,
      ra: 0.3,
      rp: 0.8,
    }),
    lin,
  ],
  [
    0.44,
    tp({
      yo: 0.9,
      rol: 0.2,
      pit: -0.1,
      mo: 0.9,
      ex: 1,
      td: 0.6,
      gl: 1,
      pu: 1,
      rt: 0.9,
      rf: 0.2,
      rg: 0.5,
      rp: 1,
    }),
  ],
  [
    AIM,
    tp({
      yo: 0.25 - TAU,
      rol: -0.1,
      fw: 2,
      mo: 0.7,
      ex: 1,
      gl: 1,
      rt: -0.2,
      rf: 1.3,
      rg: 0,
      ra: 0.2,
      rp: 1.3,
    }),
    easeIn,
  ],
];
const T_REC: MKey[] = [
  [
    0,
    tp({
      yo: 0.05 - TAU,
      fw: 2.5,
      mo: 0.6,
      ex: 1,
      gl: 0.8,
      rf: 1.4,
      rg: 0,
      rt: -0.3,
      ra: 0.2,
      rp: 1.4,
    }),
  ],
  [
    0.1,
    tp({ yo: -0.35 - TAU, fw: 2, mo: 0.5, ex: 1, gl: 0.3, rf: 0.8, rg: 0.3, rt: -0.6, rp: 1.7 }),
    easeOut,
  ],
  [0.26, tp({ yo: 0.1 - TAU, mo: 0.3, ex: 0.8, rp: 2.2 }), smooth],
  [0.45, tp({ yo: -TAU, rp: 3 }), eBack],
];
// Трагедия: слеза.
const T_AIM: MKey[] = [
  [0, T_B],
  [0.12, tp({ pit: -0.22, z: -1, mo: 0.3, ex: 1, td: 0.25, rg: 1.1, ra: 0.25, rp: 0.3 }), easeOut],
  [
    0.4,
    tp({ pit: -0.22, z: -1, mo: 0.5, ex: 1, td: 0.8, gl: 0.35, rg: 1.1, ra: 0.25, rp: 0.9 }),
    lin,
  ],
  [
    0.54,
    tp({ pit: 0.35, z: 1.5, mo: 0.95, ex: 1, gl: 1, td: 1, pu: 1, ru: 0.6, rg: 0.4, rp: 1.2 }),
  ],
  [AIM, tp({ pit: -0.2, fw: 1.5, mo: 0.8, ex: 1, gl: 1, td: 1, rp: 1.4 }), easeIn],
];
const T_AREC: MKey[] = [
  [0, tp({ pit: -0.12, fw: 1.5, mo: 0.7, ex: 1, gl: 0.6, td: 0, rt: 0.7, rp: 1.5 })],
  [0.08, tp({ pit: 0.2, fw: -1.5, z: 1, mo: 0.4, ex: 1, gl: 0.2, td: 0, rp: 1.7 }), easeOut],
  [0.25, tp({ pit: 0, mo: 0.2, ex: 0.8, td: 0.1, rp: 2.2 }), smooth],
  [0.45, tp({ rp: 3 }), eBack],
];

function healK(B: MP): MKey[] {
  const o = (x: Partial<MP>) => mp(x, B);
  return [
    [0, B],
    [
      0.16,
      o({ z: 3, pit: 0.2, mo: 0.6, gl: 0.6, ex: 1, ru: 0.3, rg: 0.1, ra: 0.6, rp: 0.5, rf: 0.7 }),
      easeOut,
    ],
    [
      0.84,
      o({ z: 3, pit: 0.2, mo: 0.6, gl: 0.8, ex: 1, ru: 0.3, rg: 0.1, ra: 0.6, rp: 3.5, rf: 0.7 }),
      lin,
    ],
    [0.94, o({ z: 1.5, pit: -0.3, mo: 0.8, gl: 1, ex: 1, ru: 0.2, rt: 0.6, rp: 4 })],
    [1, o({ z: 1, pit: -0.15, mo: 0.4, gl: 0.5, rp: 4.2 }), easeOut],
  ];
}
const HEAL = [healK(C_B), healK(T_B)];

const LIE_P = (B: MP) =>
  mp({ cr: 1, pit: PI / 2 - 0.05, pu: -1, mo: 0.5, rg: 1.4, ra: 0.08, rt: 0, rf: 0.3 }, B);
function brkK(B: MP): MKey[] {
  const o = (x: Partial<MP>) => mp(x, B);
  return [
    [0, o({ cr: 0.3, pit: 0.35, rol: 0.25, z: 1, mo: 0.6, pu: -1, rt: -0.4, rf: 0.5, rp: 0.2 })],
    [0.08, o({ cr: 1, pit: 0.6, rol: 0.35, mo: 0.6, pu: -1, rp: 0.4, ru: 0.5, rg: 0 }), easeOut],
    [0.38, o({ cr: 1, pit: 1.45, rol: 0.15, pu: -1, mo: 0.5, ru: 1, rg: 0, rp: 1 }), easeIn],
    [0.46, o({ cr: 1, pit: 1.38, rol: 0.1, pu: -1, mo: 0.5, rg: 1, rf: 0.3, rp: 1.1 }), easeOut],
    [0.56, LIE_P(B), easeIn],
  ];
}
const BRK_K = [brkK(C_B), brkK(T_B)];
function riseK(B: MP): MKey[] {
  const o = (x: Partial<MP>) => mp(x, B);
  return [
    [0, LIE_P(B)],
    [0.15, mp({ ks: 0.7, gl: 0.2 }, LIE_P(B))],
    [0.35, o({ cr: 1, ks: 1, pit: 1.0, gl: 0.5, pu: 0, mo: 0.4, ru: 0.6, rg: 0.3, rp: 0.6 })],
    [0.6, o({ cr: 1, ks: 1, pit: 0.1, gl: 0.6, pu: 1, mo: 0.6, rp: 1 }), easeOut],
  ];
}
const RISE_K = [riseK(C_B), riseK(T_B)];
function mendK(B: MP): MKey[] {
  const o = (x: Partial<MP>) => mp(x, B);
  return [
    [0, o({ cr: 1, ks: 1, pit: 0.1, gl: 0.6, pu: 1, mo: 0.6, rp: 1 })],
    [0.12, o({ cr: 1, ks: 0.8, rol: 0.15, gl: 0.3, mo: 0.5, ru: 0.6, rp: 1.4 }), easeOut],
    [MEND, o({ cr: 0, ks: 0, rp: 2 }), eBack],
  ];
}
const MEND_K = [mendK(C_B), mendK(T_B)];
function dieK(B: MP): MKey[] {
  const o = (x: Partial<MP>) => mp(x, B);
  return [
    [0, o({ cr: 0.4, pit: 0.4, rol: 0.3, mo: 0.8, pu: -1, rt: -0.5, rf: 0.6 })],
    [0.1, o({ cr: 1, pit: 0.8, rol: 0.4, mo: 0.8, pu: -1, rt: -0.3, rf: 0.6, rp: 0.3 }), easeOut],
    [0.36, o({ cr: 1, pit: PI / 2 + 0.2, rol: 0.2, mo: 0.6, pu: -1, ru: 1, rg: 0, rp: 1 }), easeIn],
    [0.4, o({ cr: 1, pit: PI / 2, mo: 0.6, pu: -1, rg: 1.4, ra: 0.1, rp: 1.1 })],
    [0.7, o({ cr: 1, pit: PI / 2, mo: 0.6, pu: -1, sh: 1, rg: 1.4, ra: 0, rp: 1.1 }), easeOut],
  ];
}
const DIE_K = [dieK(C_B), dieK(T_B)];
function die2K(B: MP): MKey[] {
  return [
    [0, LIE_P(B)],
    [0.06, mp({ pit: PI / 2 - 0.15, sh: 0.15 }, LIE_P(B))],
    [0.4, mp({ sh: 1, ra: 0 }, LIE_P(B)), easeOut],
  ];
}
const DIE2_K = [die2K(C_B), die2K(T_B)];
function hurtK(B: MP): MKey[] {
  const o = (x: Partial<MP>) => mp(x, B);
  return [
    [0, o({ pit: 0.45, rol: 0.12, z: 1, mo: 0.6, pu: -1, rt: -0.5, rf: 0.4 })],
    [
      0.06,
      o({ pit: 0.5, rol: 0.14, z: 1.2, mo: 0.65, pu: -1, rt: -0.4, rf: 0.45, rp: 0.2 }),
      easeOut,
    ],
    [0.33, mp({ rp: 1 }, B), eBack],
  ];
}
const HURT_K = [hurtK(C_B), hurtK(T_B)];
function alK(B: MP): MKey[] {
  const o = (x: Partial<MP>) => mp(x, B);
  return [
    [0, B],
    [0.06, o({ z: 3, pit: 0.25, pu: 1, gl: 0.5, mo: 0.6, ru: 0.8, rg: 0, rp: 0.2 }), easeOut],
    [0.35, mp({ rp: 1 }, B), eBack],
  ];
}
const AL_K = [alK(C_B), alK(T_B)];
const DROP_K: MKey[] = [
  [0, mp({ pit: -1.2, mo: 0.9, ex: 1, gl: 0.3, ru: 1.2, rg: 0, rt: 0, rp: 0 })],
  [0.45, mp({ pit: -1.2 + TAU, mo: 0.9, ex: 1, gl: 0.3, ru: 1.2, rg: 0, rt: 0, rp: 1.5 }), lin],
  [0.55, mp({ pit: 0.1 + TAU, mo: 0.8, ex: 1, ru: 0.8, rg: 0, rp: 1.8 }), easeOut],
];
const LAND_K: MKey[] = [
  [0, mp({ z: -3, pit: -0.2, mo: 0.8, ex: 1, ru: 0.6, rg: 0, pu: 1, rp: 0 })],
  [0.08, mp({ z: 1, pit: 0.2, mo: 0.7, ex: 1, rg: 1.2, rp: 0.4 }), easeOut],
  [0.2, mp({ rp: 1 }), eBack],
];

/** Хохот («ха-ха») и всхлипы — добавка поверх трека. */
function laugh(q: MP, t: number, a: number, b: number, amp: number): MP {
  const env = sstep(a, a + 0.04, t) * (1 - sstep(b - 0.04, b, t));
  if (env <= 0) return q;
  const s = Math.sin((TAU * (t - a)) / 0.125) * env * amp;
  return {
    ...q,
    rol: q.rol + 0.06 * s,
    z: q.z + 0.9 * Math.abs(s),
    mo: clamp01(q.mo + 0.25 * s),
    pit: q.pit + 0.04 * s,
  };
}
function sob(q: MP, t: number, a: number, b: number): MP {
  const env = sstep(a, a + 0.04, t) * (1 - sstep(b - 0.04, b, t));
  if (env <= 0) return q;
  const s = Math.max(0, Math.sin((TAU * (t - a)) / 0.14)) ** 2 * env;
  return { ...q, z: q.z - 0.9 * s, pit: q.pit - 0.07 * s, mo: clamp01(q.mo + 0.2 * s) };
}

const meleeAt = (M: Mask, tt: number): MP =>
  M.tragic
    ? tt < M.W
      ? laugh(mtrack(tt, T_WIND), tt, 0.14, 0.4, 0.5)
      : mtrack(tt - M.W, T_REC)
    : tt < M.W
      ? biteOpen(laugh(mtrack(tt, C_WIND), tt, 0.1, 0.34, 1), tt)
      : mtrack(tt - M.W, C_REC);
/** Комедия держит пасть открытой весь бросок — захлопывает в контакте. */
function biteOpen(q: MP, tt: number): MP {
  return tt < 0.44 ? q : { ...q, mo: 1 };
}

/** Поза кадра `f` действия `anim`. */
function poseOf(M: Mask, anim: string, f: number): MP {
  const B = M.tragic ? T_B : C_B;
  const ix = M.tragic ? 1 : 0;
  const tt = tf(f);
  switch (anim) {
    case 'idle': {
      const ph = f / IDLE_N;
      const sw = Math.sin(TAU * ph);
      return mp(
        {
          rol: (M.tragic ? 0.05 : 0.07) * sw,
          pit: B.pit + 0.05 * Math.cos(TAU * ph),
          rp: ph,
          mo: M.tragic
            ? 0.12 + 0.05 * Math.sin(TAU * ph * 4)
            : 0.15 + 0.3 * Math.max(0, Math.sin(TAU * ph * 2)) ** 6,
          td: M.tragic ? 0.2 + 0.1 * Math.sin(TAU * ph) : 0,
          lx: 0.4 * Math.sin(TAU * ph * 2 + 1),
        },
        B,
      );
    }
    case 'fly': {
      const ph = f / FLY_N;
      return mp(
        {
          pit: -0.22,
          rol: 0.05 * Math.sin(TAU * ph),
          rt: 0.9,
          rg: 0.6,
          ra: 1.0,
          rp: ph,
          rf: 0.05,
          z: 0.5 * Math.sin(TAU * ph),
        },
        B,
      );
    }
    case 'wind':
      return meleeAt(M, tt);
    case 'rec':
      return meleeAt(M, M.W + tt);
    case 'aim':
      return sob(mtrack(tt, T_AIM), tt, 0.12, 0.4);
    case 'arec':
      return mtrack(tt, T_AREC);
    case 'heal': {
      const q = mtrack(tt, HEAL[ix]);
      const e = sstep(0.16, 0.24, tt) * (1 - sstep(0.8, 0.86, tt));
      return {
        ...q,
        rol: q.rol + 0.06 * Math.sin(TAU * tt * 1.5) * e,
        z: q.z + 0.6 * Math.sin(TAU * tt * 1.5) * e,
        gl: clamp01(q.gl + 0.15 * Math.sin(TAU * tt * 2.5) * e),
      };
    }
    case 'brk':
      return mtrack(tt, BRK_K[ix]);
    case 'lie': {
      const q = LIE_P(B);
      // Раз в цикл вздрагивает: «ещё жива».
      const tw = f === 7 ? 1 : f === 8 ? -0.6 : f === 9 ? 0.25 : 0;
      return { ...q, rol: q.rol + 0.12 * tw, pit: q.pit - 0.08 * Math.abs(tw), rp: f / LIE_N };
    }
    case 'rise': {
      const q = mtrack(tt, RISE_K[ix]);
      const tr = 1 - sstep(0.15, 0.3, tt);
      return { ...q, rol: q.rol + 0.06 * Math.sin((TAU * tt) / 0.125) * tr };
    }
    case 'mend':
      return mtrack(tt, MEND_K[ix]);
    case 'die':
      return mtrack(tt, DIE_K[ix]);
    case 'die2':
      return mtrack(tt, DIE2_K[ix]);
    case 'hu':
      return mtrack(tt, HURT_K[ix]);
    case 'al':
      return mtrack(tt, AL_K[ix]);
    case 'lost': {
      const ph = f / LOST_N;
      const s = Math.sin(TAU * ph);
      return mp(
        { yo: 0.55 * s, lx: s, pit: B.pit - 0.12, rol: 0.05 * Math.cos(TAU * ph), rp: ph, ra: 0.4 },
        B,
      );
    }
    case 'sl': {
      const ph = f / SL_N;
      return mp(
        {
          pit: -0.3 + 0.05 * Math.sin(TAU * ph),
          pu: -1,
          mo: M.tragic ? 0.08 : 0.1 + 0.08 * Math.sin(TAU * ph),
          rg: 1.2,
          ra: 0.15,
          rp: ph,
          rt: 0.05,
          rf: 0.05,
        },
        B,
      );
    }
    case 'drop':
      return mtrack(tt, DROP_K);
    case 'land':
      return mtrack(tt, LAND_K);
  }
  return B;
}

/** Высота середины маски над полом для кадров у пола (лежит, падает, встаёт). */
function liftOf(anim: string, f: number): number {
  const tt = tf(f);
  switch (anim) {
    case 'brk': {
      const fall = easeIn((tt - 0.08) / 0.3);
      const hop = tt > 0.38 ? 2.5 * Math.sin(PI * clamp01((tt - 0.38) / 0.18)) : 0;
      return LIFT + (LIE_LIFT - LIFT) * fall + hop;
    }
    case 'lie':
    case 'die2':
      return LIE_LIFT;
    case 'rise':
      return LIE_LIFT + (LIFT - LIE_LIFT) * smooth((tt - 0.15) / 0.45);
    case 'die': {
      const fall = easeIn((tt - 0.06) / 0.3);
      const hop = tt > 0.36 ? 1.5 * Math.sin(PI * clamp01((tt - 0.36) / 0.12)) : 0;
      return LIFT + (LIE_LIFT - LIFT) * fall + hop;
    }
  }
  return LIFT;
}
const LOW = new Set(['brk', 'lie', 'rise', 'die', 'die2']);

// ---------------------------------------------------------------------------
// Кадр с послесловием: след удара, искра, слеза, пыль.
// ---------------------------------------------------------------------------

const DUST: readonly RGBA[] = [P.porcelain[2], P.porcelain[1], P.porcelain[3]];

function maskPic(M: Mask, K: Kind, anim: string, f: number, d: number): Pic {
  const q = poseOf(M, anim, f);
  const base = yawN(d);
  const yaw = base + q.yo;
  const lift = LOW.has(anim) ? liftOf(anim, f) : LIFT;
  const floorY = -(lift - 2);
  const o = render(M, K, q, yaw, floorY);
  const lit = () => (o.lit ??= new Px(K.w, K.h));
  // След: укус Комедии — подбородок; волчок Трагедии — концы лент.
  if (anim === 'wind' || anim === 'rec') {
    const ta = anim === 'wind' ? tf(f) : M.W + tf(f);
    const a = M.W - (M.tragic ? 0.1 : 0.09);
    if (ta >= a && ta <= M.W + tf(M.tragic ? 2 : 1)) {
      for (const s of M.tragic ? [-1, 1] : [0]) {
        const segs: [number, number, number, number][] = [];
        for (let i = 0; i <= 6; i++) {
          const qq = meleeAt(M, ta - i / 96);
          const X = xfOf(qq, base + qq.yo, K);
          const c = M.tragic ? projM(X, s * M.RX, 1.8, 0) : projM(X, 0, 0, 1);
          const cx = c[0];
          const cy = c[1];
          const e = M.tragic ? projM(X, s * (M.RX + 9), 0.5, -2.5) : projM(X, 0, -M.RY - 1, 2);
          segs.push([cx, cy, e[0], e[1]]);
        }
        smearInto(
          lit(),
          segs,
          M.tragic ? SMEAR_T : SMEAR_C,
          (ta >= M.W ? 0.8 : 0.55) * (M.tragic ? 0.7 : 1),
        );
      }
    }
    if (anim === 'rec' && f <= 1) {
      const X = xfOf(q, yaw, K);
      for (const s of M.tragic ? [-1, 1] : [0]) {
        const e = M.tragic ? projM(X, s * (M.RX + 9), 0.5, -2.5) : projM(X, 0, -M.RY - 0.5, 2.5);
        spark(lit(), e[0], e[1], SPARK_C, (f === 0 ? 1 : 0.6) * (M.tragic ? 0.8 : 1));
      }
    }
  }
  // Слеза сорвалась: брызги из глаз вперёд (дальше её ведёт снаряд).
  if (anim === 'arec' && f <= 3) {
    const X = xfOf(q, yaw, K);
    for (const s of [-1, 1]) {
      const e0 = projM(X, s * 3.4, 0.2, 3.6);
      const x0 = e0[0];
      const y0 = e0[1];
      const d0 = e0[2];
      for (let j = 0; j < 3; j++) {
        const e1 = projR(X, s * (3 - j * 0.6), -1 - f * 0.8 - j * 0.6, 5 + f * 4 - j * 2.2);
        const x1 = e1[0];
        const y1 = e1[1];
        // За маской брызг не видно.
        if (e1[2] < d0 - 2 && Math.abs(x1 - x0) < 6) continue;
        const a = (1 - f / 4) * (1 - j * 0.25);
        lit().set(x1, y1, withA(j === 0 ? TEAR_HI : TEAR, a));
        o.p.set(x1, y1, j === 0 ? TEAR_HI : TEAR);
        if (j === 0 && f <= 1) {
          lit().set(x1 + 1, y1, withA(TEAR, a * 0.8));
          o.p.set(x1 + 1, y1, TEAR);
        }
      }
    }
  }
  // Пыль у пола: удар о сцену, разлёт черепков.
  if (anim === 'brk' || anim === 'die' || anim === 'die2') {
    const X = xfOf(q, yaw, K);
    const g = projR(X, 0, floorY, 0);
    const t0 = anim === 'brk' ? 0.36 : anim === 'die' ? 0.34 : 0;
    const k = (tf(f) - t0) / 0.3;
    puff(o.p, g[0], g[1], k, anim === 'brk' ? 51 : 53, DUST, 8, 8);
  }
  return { p: o.p, lit: o.lit, ax: K.ax, ay: K.ay, eye: o.eye };
}

// ---------------------------------------------------------------------------
// Рисовальщики.
// ---------------------------------------------------------------------------

const TECH = new Set(['windup', 'recover', 'aim', 'stun', 'alert', 'f13_broken', 'dying', 'drop']);

const pairOf = (m: Mob): Mob | undefined => {
  const id = m.data?.pair;
  if (id === undefined || id < 0) return undefined;
  return F13_FX.mobs.find((x) => x.id === id && x !== m);
};

function painter(M: Mask, K: Kind) {
  return (m: Mob, pose: MobPose): MobFrame => {
    const md = pose.mode;
    const t = pose.t || 0;
    const now = pose.now || 0;
    const id = m.id ?? 0;
    let want = TECH.has(md) ? (m.face ?? 0) : headOf(m);
    if (md === 'f13_heal') {
      const p = pairOf(m);
      if (p) want = Math.atan2(p.y - (m.y ?? 0), p.x - (m.x ?? 0));
    }
    const v = visOf(m, pose, want, md === 'windup' || md === 'aim' ? 7 : 9);
    const d = dirN(v.yaw);
    const mir = d >= 3 && d <= 5;
    const ds = mir ? (12 - d) % 8 : d;
    const fx = Math.cos(v.yaw);
    const fy = Math.sin(v.yaw) * 0.56;
    const bob = 1.2 * Math.sin(now * 2.4 + hash(id, 3) * TAU);
    const ex: Partial<MobFrame> = { shadow: 5, lift: LIFT + bob };
    let anim = 'idle';
    let f = 0;
    let low = false;
    if (md === 'dying') {
      low = true;
      if (v.prev === 'f13_broken') {
        anim = 'die2';
        f = fi(t, DIE2_N - 1);
        ex.linger = 0.7;
        ex.alpha = 1 - sstep(0.45, 0.7, t);
      } else {
        anim = 'die';
        f = fi(t, DIE_N - 1);
        ex.linger = 0.85;
        ex.alpha = 1 - sstep(0.62, 0.85, t);
      }
    } else if (md === 'f13_broken') {
      low = true;
      if (t < BRK) {
        anim = 'brk';
        f = fi(t, BRK_N - 1);
      } else if (t < RISE0) {
        anim = 'lie';
        f = Math.floor((t - BRK) * 6) % LIE_N;
      } else {
        anim = 'rise';
        f = fi(t - RISE0, RISE_N - 1);
      }
    } else if (md === 'chase' && v.prev === 'f13_broken' && t < MEND) {
      anim = 'mend';
      f = fi(t, MEND_N - 1);
    } else if (md === 'f13_heal') {
      anim = 'heal';
      f = fi(t, HEAL_N - 1);
    } else if (md === 'aim' && M.tragic) {
      anim = 'aim';
      f = fi(t, AIM_N - 1);
      // Всхлип вперёд в срыве слезы.
      const k = sstep(0.54, AIM, t);
      ex.dx = fx * 0.8 * k;
      ex.dy = fy * 0.8 * k;
    } else if (md === 'recover' && v.prev === 'aim' && t < 0.45) {
      anim = 'arec';
      f = fi(t, AREC_N - 1);
      const k = 1 - sstep(0, 0.1, t);
      ex.sx = 1 - 0.06 * k;
      ex.sy = 1 + 0.08 * k;
      const back = sstep(0, 0.06, t) * (1 - sstep(0.1, 0.3, t));
      ex.dx = -fx * 1.2 * back;
      ex.dy = -fy * 1.2 * back;
    } else if (md === 'windup') {
      anim = 'wind';
      f = fi(t, windN(M) - 1);
      const back = sstep(0.04, 0.2, t) * (1 - sstep(M.W - 0.1, M.W, t));
      ex.dx = -fx * 1.2 * back;
      ex.dy = -fy * 1.2 * back;
    } else if (md === 'recover' && t < 0.45) {
      anim = 'rec';
      f = fi(t, REC_N - 1);
      const k = 1 - sstep(0, 0.12, t);
      ex.sx = 1 + 0.12 * k;
      ex.sy = 1 - 0.1 * k;
      const lunge = 1.6 * (1 - sstep(0.04, 0.26, t));
      ex.dx = fx * lunge;
      ex.dy = fy * lunge;
    } else if (md === 'drop') {
      anim = 'drop';
      f = fi(t, DROP_N - 1);
      // В падении движок подъём не применяет: держим высоту сами.
      ex.dy = -LIFT;
    } else if (md === 'stun' && v.prev === 'drop') {
      anim = 'land';
      f = fi(t, LAND_N - 1);
      const k = 1 - sstep(0, 0.12, t);
      ex.sx = 1 + 0.12 * k;
      ex.sy = 1 - 0.12 * k;
    } else if (md === 'stun' || md === 'f13_reel') {
      anim = 'hu';
      f = fi(t, HURT_N - 1);
    } else if (md === 'sleep' || md === 'f13_wait' || md === 'f13_hush') {
      anim = 'sl';
      f = Math.floor(now * 2 + hash(id, 5) * SL_N) % SL_N;
      ex.lift = SL_LIFT + 0.8 * Math.sin(now * 1.3 + hash(id, 3) * TAU);
      ex.shadow = 6;
    } else if (md === 'f13_lost') {
      anim = 'lost';
      f = Math.floor(now * 5 + hash(id, 7) * LOST_N) % LOST_N;
    } else if (hurtAge(v, now) < 0.33) {
      anim = 'hu';
      f = fi(hurtAge(v, now), HURT_N - 1);
    } else if (md === 'alert') {
      anim = 'al';
      f = fi(t, AL_N - 1);
      if (v.prev === 'sleep' || v.prev === 'f13_wait')
        ex.lift = SL_LIFT + (LIFT - SL_LIFT) * easeOut(t / 0.25) + bob;
    } else if (moving(m, 0.4)) {
      anim = 'fly';
      f = Math.floor(now * 14 + hash(id, 7) * FLY_N) % FLY_N;
      // Крен в поворот.
      ex.rot = clamp(angD(want, v.yaw) * 0.35, -0.2, 0.2);
    } else {
      f = Math.floor(now * 10 + hash(id, 7) * IDLE_N) % IDLE_N;
    }
    if (low) {
      ex.lift = liftOf(anim, f);
      ex.shadow = 4 + 2 * clamp01((LIFT - (ex.lift ?? LIFT)) / (LIFT - LIE_LIFT));
    }
    if (md !== 'dying' && md !== 'f13_broken') hurtFx(v, now, 1.4, ex);
    const fr = frameOf(K, anim, f, ds, pose, () => maskPic(M, K, anim, f, ds));
    if (mir) ex.sx = -(ex.sx ?? 1);
    return { ...fr, ...ex };
  };
}

function warmList(M: Mask): [string, number][] {
  const l: [string, number][] = [
    ['idle', IDLE_N],
    ['fly', FLY_N],
    ['wind', windN(M)],
    ['rec', REC_N],
    ['hu', HURT_N],
    ['al', AL_N],
    ['heal', HEAL_N],
    ['brk', BRK_N],
    ['lie', LIE_N],
    ['rise', RISE_N],
    ['mend', MEND_N],
    ['die', DIE_N],
    ['die2', DIE2_N],
    ['lost', LOST_N],
    ['sl', SL_N],
  ];
  if (M.tragic) l.push(['aim', AIM_N], ['arec', AREC_N]);
  // Комедия выпадает со свода (антракт без света).
  else l.push(['drop', DROP_N], ['land', LAND_N]);
  return l;
}

for (const M of [COMEDY, TRAGEDY]) {
  const n = warmList(M).reduce((s, [, k]) => s + k, 0) * SIDES.length;
  const K = kindOf(M.name, 60, 60, 30, 30, Math.ceil(n * 1.15));
  registerMobPainter(M.name, painter(M, K));
  registerMobWarm(M.name, function* () {
    yield* warmAll(K, warmList(M), (a, f, d) => maskPic(M, K, a, f, d), SIDES);
  });
}
