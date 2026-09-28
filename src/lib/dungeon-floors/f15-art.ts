// Этаж 15 «Сердце подземелья», половина «Мир» — рисовальщики: живые
// клетки трёх районов (слизистая Горла, складки и сок Чрева, стенки и
// русла Сосудов), мышечные стены с обломками четырнадцати этажей, живые
// предметы (кромки, сфинктеры, полипы, глаза в стенах, сердечки),
// монстры и подражатели, метки ударов, иконки вещей.
//
// Всё нарисовано кодом: пиксели 16 на клетку, свет сверху-слева, контур
// тёмный. Палитра — плоть подземелья (тёмный кармин, мышца, слизь) и по
// акценту на район: бирюзовая слизь и светящиеся вены Горла, кислотно-
// жёлтый сок Чрева, алая кровь Сосудов. Подражатели — рисовальщики монстров
// прошлых этажей (`MOB_PAINTERS`), перекрашенные в плоть, с наростами и
// лишними глазами: подземелье помнит чудовищ, но собирает их из мяса.
//
// Клетки собираются в кусок карты один раз: пол и стены берут пиксели из
// больших бесшовных текстур района (посчитаны один раз), сверху — стыки по
// соседям. Живое (дыхание, пульс, створки) — предметами и зонами по
// состоянию правил этажа (`f15View(paintSim())`).
//
// Кадры монстров, предметов и зон — из кеша: рисовать кадр в кадре нельзя.

import { Px } from '../dungeon-art';
import {
  MOB_PAINTERS,
  paintSim,
  registerCellPainter,
  registerItemArt,
  registerMobPainter,
  registerPropPainter,
  registerShotPainter,
  registerZonePainter,
} from '../dungeon-paint';
import type { CellCtx, MobFrame, MobPose, Sprite } from '../dungeon-paint';
import type { Mob, Shot, Strike, Zone } from '../dungeon-sim';
import type { WorldObj } from '../dungeon-world';
import { F15_FLOW, F15_GUT, F15_MARK, F15_THROAT, F15_VEINS } from './f15';
import { BREATH, f15View, GUT_VALVE } from './f15-brains';
import type { F15State, Live, LiveKind } from './f15-brains';

type RGBA = [number, number, number, number];

const hx = (h: string, a = 255): RGBA => {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255, a];
};
const mixc = (a: RGBA, b: RGBA, k: number): RGBA => [
  Math.round(a[0] + (b[0] - a[0]) * k),
  Math.round(a[1] + (b[1] - a[1]) * k),
  Math.round(a[2] + (b[2] - a[2]) * k),
  Math.round(a[3] + (b[3] - a[3]) * k),
];
const alpha = (c: RGBA, a: number): RGBA => [c[0], c[1], c[2], Math.round(Math.max(0, Math.min(1, a)) * 255)];
const rgba = (c: RGBA, a: number) =>
  `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

const INK = hx('#150f0b');
const WHITE = hx('#ffffff');
const GOLDK = hx('#ffcc40');
const TAU = Math.PI * 2;
const M = F15_MARK;

/** Четыре тона формы: тень, основа, свет, блик. */
type Tones = [RGBA, RGBA, RGBA, RGBA];
const tn = (a: string, b: string, c: string, d: string): Tones => [hx(a), hx(b), hx(c), hx(d)];

/** Свет сверху-слева-спереди. */
const LX = -0.45;
const LY = -0.72;
const LZ = 0.52;

function tone(t: Tones, l: number): RGBA {
  return l > 0.78 ? t[3] : l > 0.42 ? t[2] : l > 0.02 ? t[1] : t[0];
}

/** Овал с объёмом: цвет по нормали. */
function shadeEll(p: Px, cx: number, cy: number, rx: number, ry: number, t: Tones, bias = 0): void {
  if (rx <= 0 || ry <= 0) return;
  p.ell(cx, cy, rx, ry, (x, y) => {
    const dx = (x + 0.5 - cx) / rx;
    const dy = (y + 0.5 - cy) / ry;
    const nz = Math.sqrt(Math.max(0, 1 - dx * dx - dy * dy));
    return tone(t, dx * LX + dy * LY + nz * LZ + bias);
  });
}

/** Конечность: сужающаяся «капсула» со светом по нормали. */
function limb(
  p: Px,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  r0: number,
  r1: number,
  t: Tones,
  bias = 0,
): void {
  const minX = Math.floor(Math.min(x0 - r0, x1 - r1)) - 1;
  const maxX = Math.ceil(Math.max(x0 + r0, x1 + r1)) + 1;
  const minY = Math.floor(Math.min(y0 - r0, y1 - r1)) - 1;
  const maxY = Math.ceil(Math.max(y0 + r0, y1 + r1)) + 1;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const L2 = dx * dx + dy * dy || 1e-6;
  for (let y = minY; y <= maxY; y++)
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const k = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / L2));
      const cx = x0 + dx * k;
      const cy = y0 + dy * k;
      const r = r0 + (r1 - r0) * k;
      const ex = px - cx;
      const ey = py - cy;
      const d = Math.hypot(ex, ey);
      if (d > r) continue;
      const nx = ex / (r || 1);
      const ny = ey / (r || 1);
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      p.set(x, y, tone(t, nx * LX + ny * LY + nz * LZ + bias));
    }
}

/** Многоугольник заливкой. */
function poly(p: Px, pts: [number, number][], c: RGBA | ((x: number, y: number) => RGBA)): void {
  let minX = 1e9;
  let maxX = -1e9;
  let minY = 1e9;
  let maxY = -1e9;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++)
    for (let x = Math.floor(minX); x <= Math.ceil(maxX); x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i];
        const [xj, yj] = pts[j];
        if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) p.set(x, y, typeof c === 'function' ? c(x, y) : c);
    }
}

/** Многоугольник со светом плоской грани. */
function polyShade(p: Px, pts: [number, number][], t: Tones, bias = 0): void {
  let cx = 0;
  let cy = 0;
  let r = 1;
  for (const [x, y] of pts) {
    cx += x;
    cy += y;
  }
  cx /= pts.length;
  cy /= pts.length;
  for (const [x, y] of pts) r = Math.max(r, Math.hypot(x - cx, y - cy));
  poly(p, pts, (x, y) => tone(t, ((x + 0.5 - cx) * LX + (y + 0.5 - cy) * LY) / r + 0.45 + bias));
}

/** Толстая линия. */
function stroke(p: Px, x0: number, y0: number, x1: number, y1: number, c: RGBA, w = 1): void {
  const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2) + 1;
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    const y = y0 + ((y1 - y0) * i) / n;
    if (w <= 1) p.set(Math.floor(x), Math.floor(y), c);
    else p.ell(x, y, w / 2, w / 2, c);
  }
}

/** Кривая Катмулла — Рома через точки. */
function spline(pts: [number, number][], n = 6): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Детерминированный шум по числам, 0…1. */
const hash = (a: number, b: number, c = 0) => {
  let h = (a * 374761393 + b * 668265263 + c * 1274126177) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** Сглаженный шум по периоду `per` (бесшовный), 0…1. */
function tnoise(x: number, y: number, s: number, per: number, seed: number): number {
  const P = Math.round(per / s);
  const xi = Math.floor(x / s);
  const yi = Math.floor(y / s);
  const fx = x / s - xi;
  const fy = y / s - yi;
  const r = (a: number, b: number) => hash(((a % P) + P) % P, ((b % P) + P) % P, seed);
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = r(xi, yi) * (1 - u) + r(xi + 1, yi) * u;
  const b = r(xi, yi + 1) * (1 - u) + r(xi + 1, yi + 1) * u;
  return a * (1 - v) + b * v;
}

/** Анизотропный шум: свой шаг по x и по y (волокна, струи), бесшовно. */
function tnoise2(x: number, y: number, sx: number, sy: number, per: number, seed: number): number {
  const PX = Math.round(per / sx);
  const PY = Math.max(1, Math.round(per / sy));
  const xi = Math.floor(x / sx);
  const yi = Math.floor(y / sy);
  const fx = x / sx - xi;
  const fy = y / sy - yi;
  const r = (a: number, b: number) => hash(((a % PX) + PX) % PX, ((b % PY) + PY) % PY, seed);
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = r(xi, yi) * (1 - u) + r(xi + 1, yi) * u;
  const b = r(xi, yi + 1) * (1 - u) + r(xi + 1, yi + 1) * u;
  return a * (1 - v) + b * v;
}

/** Бесшовные ячейки Вороного: (расстояние до ближней, до второй, номер). */
function voro(x: number, y: number, cell: number, per: number, seed: number, jit = 0.8): [number, number, number] {
  const P = Math.round(per / cell);
  const cx = Math.floor(x / cell);
  const cy = Math.floor(y / cell);
  let d1 = 1e9;
  let d2 = 1e9;
  let id = 0;
  for (let j = -1; j <= 1; j++)
    for (let i = -1; i <= 1; i++) {
      const gx = cx + i;
      const gy = cy + j;
      const wx = ((gx % P) + P) % P;
      const wy = ((gy % P) + P) % P;
      const px = (gx + 0.5 + (hash(wx, wy, seed) - 0.5) * jit) * cell;
      const py = (gy + 0.5 + (hash(wx, wy, seed + 7) - 0.5) * jit) * cell;
      const d = (x - px) * (x - px) + (y - py) * (y - py);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        id = wy * P + wx;
      } else if (d < d2) d2 = d;
    }
  return [Math.sqrt(d1), Math.sqrt(d2), id];
}

// ---------------------------------------------------------------------------
// Кеши.
// ---------------------------------------------------------------------------

interface Built {
  p: Px;
  ax: number;
  ay: number;
  eye?: [number, number] | null;
}

type Look = MobPose['look'];

const frames = new Map<string, MobFrame>();

/** Альбинос — белёсый, элита — золотой кант, удар — белым. */
function finish(key: string, b: Built, look: Look, flash: boolean, left: boolean): MobFrame {
  let p = b.p;
  if (look === 'albino') {
    const pale = hx('#f4ece4');
    const q = new Px(p.w, p.h);
    for (let i = 0; i < p.data.length; i += 4) {
      if (!p.data[i + 3]) continue;
      const l = (p.data[i] + p.data[i + 1] + p.data[i + 2]) / 3;
      const c = mixc([l, l, l, 255], pale, 0.45);
      q.data[i] = c[0];
      q.data[i + 1] = c[1];
      q.data[i + 2] = c[2];
      q.data[i + 3] = p.data[i + 3];
    }
    p = q;
  }
  if (look === 'elite') p.outline(GOLDK);
  if (flash) p = p.tint(WHITE, 0.85);
  if (left) p = p.flipX();
  const eye = b.eye ? ([left ? p.w - 1 - b.eye[0] : b.eye[0], b.eye[1]] as [number, number]) : null;
  const out: MobFrame = { img: p.canvas(), ax: left ? p.w - b.ax : b.ax, ay: b.ay, eye };
  frames.set(key, out);
  return out;
}

function frameOf(kind: string, pose: MobPose, anim: string, f: number, build: () => Built): MobFrame {
  const key = `${kind}|${anim}|${f}|${pose.left ? 1 : 0}|${pose.flash ? 1 : 0}|${pose.look}`;
  const hit = frames.get(key);
  if (hit) return hit;
  return finish(key, build(), pose.look, pose.flash, pose.left);
}

const sprites = new Map<string, Sprite>();
function sprite(key: string, make: () => { p: Px; ax: number; ay: number } | null): Sprite | null {
  const hit = sprites.get(key);
  if (hit) return hit;
  const b = make();
  if (!b) return null;
  const s: Sprite = { img: b.p.canvas(), ax: b.ax, ay: b.ay };
  sprites.set(key, s);
  return s;
}

const flashed = (key: string, flash: boolean, make: () => { p: Px; ax: number; ay: number } | null) =>
  sprite(`${key}|${flash ? 1 : 0}`, () => {
    const b = make();
    if (!b) return null;
    if (flash) b.p = b.p.tint(WHITE, 0.7);
    return b;
  });

/** Холст-картинка для зон (в игровых пикселях), из кеша. */
const zoneImgs = new Map<string, HTMLCanvasElement>();
function zoneImg(key: string, make: () => Px): HTMLCanvasElement {
  let c = zoneImgs.get(key);
  if (!c) {
    c = make().canvas();
    zoneImgs.set(key, c);
  }
  return c;
}

// ---------------------------------------------------------------------------
// Палитры районов.
// ---------------------------------------------------------------------------

type Style = 'throat' | 'gut' | 'veins';

interface Pal {
  /** Пол: четыре тона плоти (близкие — рисунок держит сглаживание). */
  floor: Tones;
  /** Борозды складок. */
  groove: RGBA;
  /** Влажный блик. */
  wet: RGBA;
  /** Стена: масса сверху, кромка, лицо (мышца). */
  top: RGBA;
  topHi: RGBA;
  rim: Tones;
  face: Tones;
  /** Акцент района: вены, слизь, свет. */
  vein: RGBA;
  veinHi: RGBA;
  veinDark: RGBA;
  /** Особый слой лица стены: хрящ (Горло), жир (Чрево), эластика (Сосуды). */
  band: Tones;
  /** Капилляры по полу и стенам. */
  capil: RGBA;
}

const PAL: Record<Style, Pal> = {
  throat: {
    floor: tn('#3a1822', '#522430', '#6a303c', '#86424c'),
    groove: hx('#1e0a10'),
    wet: hx('#d8a0ac'),
    top: hx('#12060a'),
    topHi: hx('#1e0a10'),
    rim: tn('#3e1620', '#662a36', '#8c4450', '#b86e78'),
    face: tn('#3a1420', '#56202c', '#74303a', '#94464e'),
    vein: hx('#d82e64'),
    veinHi: hx('#ffb0cc'),
    veinDark: hx('#4a0a20'),
    band: tn('#7a4450', '#a86a74', '#cf9aa0', '#f0c8c4'),
    capil: hx('#8a2a48'),
  },
  gut: {
    floor: tn('#3a1612', '#5e2620', '#80382c', '#a4523e'),
    groove: hx('#1a0806'),
    wet: hx('#f0b898'),
    top: hx('#120806'),
    topHi: hx('#1e0e0a'),
    rim: tn('#40180e', '#6e3020', '#9a5036', '#c67c5a'),
    face: tn('#3a140e', '#561e14', '#742c1e', '#96422c'),
    vein: hx('#e0402a'),
    veinHi: hx('#ffc0a0'),
    veinDark: hx('#5a140c'),
    band: tn('#7a5a24', '#a88438', '#d4b060', '#f4dc98'),
    capil: hx('#9a3a24'),
  },
  veins: {
    floor: tn('#2a0810', '#40101c', '#581828', '#742638'),
    groove: hx('#14020a'),
    wet: hx('#ff98ac'),
    top: hx('#0e0206'),
    topHi: hx('#1a040c'),
    rim: tn('#3a0a16', '#621426', '#8c263c', '#bc5266'),
    face: tn('#34081a', '#4e0e22', '#6c182e', '#8e2a40'),
    vein: hx('#ff2440'),
    veinHi: hx('#ffc0c8'),
    veinDark: hx('#600410'),
    band: tn('#7a3a4c', '#a66478', '#cc92a2', '#ecc4ce'),
    capil: hx('#200418'),
  },
};

const styleOf = (area: string): Style => (area === F15_GUT ? 'gut' : area === F15_VEINS ? 'veins' : 'throat');

// ---------------------------------------------------------------------------
// Большие бесшовные текстуры района (считаются один раз). Периоды шума —
// степени двойки: только они делят 256 без остатка, и край не шьётся.
// ---------------------------------------------------------------------------

const TEX = 256;

/** Упорядоченное сглаживание: четыре близких тона вместо полос. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const dith = (x: number, y: number) => (BAYER[((y & 3) << 2) | (x & 3)] + 0.5) / 16 - 0.5;

/** Гребень шума: 1 на линии середины — извилистые борозды без сетки. */
const ridge = (x: number, y: number, s: number, per: number, seed: number) =>
  1 - Math.abs(2 * tnoise(x, y, s, per, seed) - 1);

class Tex {
  readonly w: number;
  readonly h: number;
  readonly d: Uint8ClampedArray;
  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.d = new Uint8ClampedArray(w * h * 4);
  }
  put(x: number, y: number, c: RGBA): void {
    const i = (y * this.w + x) * 4;
    this.d[i] = c[0];
    this.d[i + 1] = c[1];
    this.d[i + 2] = c[2];
    this.d[i + 3] = c[3];
  }
  /** Скопировать клетку текстуры (с заворотом) в пиксели клетки. */
  cell(p: Px, wx: number, wy: number, ox = 0, oy = 0): void {
    const bx = (((wx * 16 + ox) % this.w) + this.w) % this.w;
    const by = (((wy * 16 + oy) % this.h) + this.h) % this.h;
    for (let y = 0; y < 16; y++) {
      const ty = (by + y) % this.h;
      for (let x = 0; x < 16; x++) {
        const tx = (bx + x) % this.w;
        const si = (ty * this.w + tx) * 4;
        const di = (y * 16 + x) * 4;
        p.data[di] = this.d[si];
        p.data[di + 1] = this.d[si + 1];
        p.data[di + 2] = this.d[si + 2];
        p.data[di + 3] = 255;
      }
    }
  }
  at(x: number, y: number): RGBA {
    const tx = ((x % this.w) + this.w) % this.w;
    const ty = ((y % this.h) + this.h) % this.h;
    const i = (ty * this.w + tx) * 4;
    return [this.d[i], this.d[i + 1], this.d[i + 2], 255];
  }
}

const texCache = new Map<string, Tex>();
function tex(key: string, w: number, h: number, make: (t: Tex) => void): Tex {
  let t = texCache.get(key);
  if (!t) {
    t = new Tex(w, h);
    make(t);
    texCache.set(key, t);
  }
  return t;
}

/** Поле значений на всю текстуру (бесшовно, с заворотом при чтении). */
function field(w: number, h: number, f: (x: number, y: number) => number) {
  const a = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = f(x, y);
  return (x: number, y: number) => a[(((y % h) + h) % h) * w + (((x % w) + w) % w)];
}

/**
 * Слизистая Горла: мягкая плоть крупными пятнами тона, редкие извилистые
 * складки (борозда темнее, край под ней ловит свет), бугорки-сосочки и
 * влажные блики. Никакой сетки: ячейки читались мостовой.
 */
function mucosaTex(style: Style): Tex {
  return tex(`mucosa|${style}`, TEX, TEX, (t) => {
    const P = PAL[style];
    const warp = (x: number, y: number): [number, number] => [
      x + (tnoise(x, y, 32, TEX, 3) - 0.5) * 22,
      y + (tnoise(x, y, 32, TEX, 4) - 0.5) * 22,
    ];
    const fold = field(TEX, TEX, (x, y) => {
      const [wx, wy] = warp(x, y);
      return Math.max(ridge(wx, wy, 64, TEX, 6), ridge(wx, wy, 32, TEX, 7) * 0.985);
    });
    const tone0 = field(TEX, TEX, (x, y) => {
      const [wx, wy] = warp(x, y);
      return tnoise(x, y, 64, TEX, 9) * 0.55 + tnoise(wx, wy, 16, TEX, 5) * 0.45;
    });
    for (let y = 0; y < TEX; y++)
      for (let x = 0; x < TEX; x++) {
        const f = fold(x, y);
        const n = tone0(x, y);
        let l = 0.12 + n * 0.62 + dith(x, y) * 0.24;
        // Складка: борозда, над ней тень, под ней свет.
        if (f > 0.965) l = -1;
        else if (fold(x, y - 1) > 0.965 || fold(x, y - 2) > 0.965) l += 0.28;
        else if (fold(x, y + 1) > 0.965) l -= 0.2;
        let c = l < 0 ? P.groove : tone(P.floor, l);
        if (l >= 0) {
          // Сосочки: светлая точка, тень под ней.
          if (hash(x, y, 11) > 0.994) c = P.floor[3];
          else if (hash(x, y - 1, 11) > 0.994) c = P.floor[0];
          // Влажный блик — на светлых буграх.
          else if (n > 0.66 && hash(x >> 1, y, 12) > 0.95) c = mixc(c, P.wet, 0.55);
        }
        t.put(x, y, c);
      }
  });
}

/**
 * Складки желудка: извилины, как у мозга, — валики с круглым верхом,
 * узкие тёмные борозды между ними, свет по склону, влажные блики на гребне.
 */
function rugaeTex(): Tex {
  return tex('rugae', TEX, TEX, (t) => {
    const P = PAL.gut;
    const h = field(TEX, TEX, (x, y) => {
      const wx = x + (tnoise(x, y, 64, TEX, 21) - 0.5) * 40;
      const wy = y + (tnoise(x, y, 32, TEX, 22) - 0.5) * 26;
      return 1 - ridge(wx, wy, 32, TEX, 23);
    });
    for (let y = 0; y < TEX; y++)
      for (let x = 0; x < TEX; x++) {
        const v = h(x, y);
        const slope = v - h(x + 1, y + 1);
        const big = tnoise(x, y, 64, TEX, 24);
        let c: RGBA;
        if (v < 0.07) c = P.groove;
        else {
          const hh = Math.sqrt(Math.min(1, v * 2.2));
          const l = 0.05 + hh * 0.55 + slope * 5 + (big - 0.5) * 0.3 + dith(x, y) * 0.22;
          c = tone(P.floor, l);
          if (hh > 0.9 && slope > 0.01 && hash(x, y >> 1, 25) > 0.55) c = mixc(c, P.wet, 0.5);
        }
        t.put(x, y, c);
      }
  });
}

/**
 * Стенка сосуда: гладкая, тон плывёт крупно, продольные жилки вдоль тока
 * (вверх, к сердцу), редкие ветвящиеся капилляры и блики.
 */
function vesselTex(): Tex {
  return tex('vessel', TEX, TEX, (t) => {
    const P = PAL.veins;
    const cap = field(TEX, TEX, (x, y) => {
      const wx = x + (tnoise(x, y, 32, TEX, 35) - 0.5) * 24;
      const wy = y + (tnoise(x, y, 32, TEX, 36) - 0.5) * 24;
      return Math.max(ridge(wx, wy, 64, TEX, 37), ridge(wx, wy, 32, TEX, 38) * 0.99);
    });
    for (let y = 0; y < TEX; y++)
      for (let x = 0; x < TEX; x++) {
        const wx = x + (tnoise(x, y, 64, TEX, 31) - 0.5) * 16;
        const streak = tnoise2(wx, y, 4, 64, TEX, 32);
        const big = tnoise(x, y, 64, TEX, 33);
        const l = 0.2 + big * 0.5 + (streak - 0.5) * 0.35 + dith(x, y) * 0.22;
        let c = tone(P.floor, l);
        const k = cap(x, y);
        if (k > 0.975) c = mixc(c, P.capil, 0.65);
        else if (cap(x - 1, y) > 0.975) c = mixc(c, P.floor[3], 0.35);
        if (streak > 0.8 && big > 0.55 && hash(x, y >> 2, 34) > 0.6) c = mixc(c, P.wet, 0.3);
        t.put(x, y, c);
      }
  });
}

/** Масса стены сверху: тёмная плоть, складки чуть светлее, без искр. */
function wallTopTex(style: Style): Tex {
  return tex(`top|${style}`, 128, 128, (t) => {
    const P = PAL[style];
    const fold = field(128, 128, (x, y) => {
      const wx = x + (tnoise(x, y, 32, 128, 44) - 0.5) * 20;
      const wy = y + (tnoise(x, y, 32, 128, 45) - 0.5) * 20;
      return ridge(wx, wy, 32, 128, 43);
    });
    for (let y = 0; y < 128; y++)
      for (let x = 0; x < 128; x++) {
        const n = tnoise(x, y, 32, 128, 41) * 0.7 + tnoise(x, y, 8, 128, 42) * 0.3;
        let c = n + dith(x, y) * 0.3 > 0.55 ? P.topHi : P.top;
        const f = fold(x, y);
        if (f > 0.95) c = mixc(P.topHi, P.rim[0], 0.5);
        else if (fold(x, y + 1) > 0.95) c = mixc(P.top, hx('#000000'), 0.5);
        t.put(x, y, c);
      }
  });
}

/**
 * Лицо стены: мышца волокнами сверху вниз, пучки разделены тёмными
 * бороздами, свет сверху; у Горла — хрящевые кольца (выпуклые, розово-
 * костяные, с разрывами), у Чрева — жировые узлы, у Сосудов — полосы
 * эластики и тонкие сосуды. Высота — одна клетка, по ширине бесшовно.
 */
function faceTex(style: Style): Tex {
  return tex(`face|${style}`, TEX, 16, (t) => {
    const P = PAL[style];
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < TEX; x++) {
        const fib = tnoise2(x, y, 2, 16, TEX, 51);
        const bundle = tnoise(x, 0, 8, TEX, 52);
        const big = tnoise(x, 0, 32, TEX, 56);
        const k = y / 15;
        let l = 0.78 - k * 0.62 + (fib - 0.5) * 0.3 + (big - 0.5) * 0.2 + dith(x, y) * 0.2;
        // Край пучка — тёмная борозда, рядом свет.
        const edge = Math.abs(bundle - 0.5);
        if (edge < 0.03) l = -1;
        else if (edge < 0.07) l += bundle > 0.5 ? 0.18 : -0.12;
        let c = l < 0 ? P.groove : tone(P.face, l);
        if (style === 'throat') {
          // Хрящевые кольца: две выпуклые полосы, волной по ±1.
          for (const ry of [6]) {
            const yy = ry + Math.round((tnoise(x, ry, 16, TEX, 57) - 0.5) * 2.4);
            const gap = tnoise(x, ry, 16, TEX, 53) < 0.2;
            if (gap) continue;
            const d = y - yy;
            if (d === 0) c = tone(P.band, 0.9 + dith(x, y) * 0.2);
            else if (d === 1 || d === 2) c = tone(P.band, 0.6 - d * 0.18 + dith(x, y) * 0.2);
            else if (d === 3) c = mixc(c, P.groove, 0.55);
            else if (d === -1) c = mixc(c, P.band[1], 0.35);
          }
        } else if (style === 'gut') {
          // Жировые узлы по верху лица: круглые, с бликом.
          const [d1, , id] = voro(x, y * 1.3, 8, TEX, 54, 0.6);
          const r = 2 + hash(id, 1, 55) * 1.6;
          if (y < 9 && hash(id, 2, 55) > 0.45 && d1 < r) {
            const lz = 0.9 - d1 / r - (y / 9) * 0.3 + dith(x, y) * 0.2;
            c = tone(P.band, lz);
            if (d1 < 0.8 && hash(id, 3, 55) > 0.5) c = P.band[3];
          }
        } else {
          // Эластика: тонкие светлые полосы с волной.
          for (const ry of [4, 10]) {
            const yy = ry + Math.round((tnoise(x, ry, 32, TEX, 58) - 0.5) * 2);
            if (y === yy && tnoise(x, ry, 8, TEX, 55) > 0.3) c = mixc(c, P.band[2], 0.6);
            if (y === yy + 1 && tnoise(x, ry, 8, TEX, 55) > 0.3) c = mixc(c, P.groove, 0.35);
          }
          // Сосудики на стенке: тёмные жилки сверху вниз.
          const v = ridge(x + (tnoise(x, y, 8, TEX, 59) - 0.5) * 6, 0, 32, TEX, 60);
          if (v > 0.97) c = mixc(c, P.capil, 0.7);
        }
        t.put(x, y, c);
      }
  });
}

/** Желудочный сок: жёлто-зелёный, разводы и пузыри. */
function acidTex(): Tex {
  return tex('acid', 128, 128, (t) => {
    const A = tn('#1c2806', '#34500c', '#557414', '#8aa82a');
    for (let y = 0; y < 128; y++)
      for (let x = 0; x < 128; x++) {
        const wx = x + (tnoise(x, y, 32, 128, 61) - 0.5) * 24;
        const wy = y + (tnoise(x, y, 32, 128, 62) - 0.5) * 24;
        const n = tnoise(wx, wy, 16, 128, 63);
        const sw = ridge(wx, wy, 32, 128, 66);
        let c = tone(A, 0.12 + n * 0.55 + dith(x, y) * 0.2);
        if (sw > 0.96) c = mixc(c, A[3], 0.5);
        const [d1] = voro(x, y, 8, 128, 64, 0.9);
        const bub = hash(Math.floor(x / 8), Math.floor(y / 8), 65) > 0.78;
        if (bub && d1 < 1.3) c = mixc(A[3], hx('#e8f890'), 0.35);
        else if (bub && d1 < 2.2) c = mixc(c, A[0], 0.55);
        t.put(x, y, c);
      }
  });
}

/** Кровь русла: тёмная, струи вдоль течения. */
function bloodTex(): Tex {
  return tex('blood', 128, 128, (t) => {
    const B = tn('#1a0206', '#34040c', '#580a16', '#8c1624');
    for (let y = 0; y < 128; y++)
      for (let x = 0; x < 128; x++) {
        const wx = x + (tnoise(x, y, 32, 128, 71) - 0.5) * 12;
        const n = tnoise2(wx, y, 4, 32, 128, 72);
        const big = tnoise(x, y, 32, 128, 73);
        let c = tone(B, 0.08 + n * 0.5 + (big - 0.5) * 0.3 + dith(x, y) * 0.2);
        if (n > 0.82) c = mixc(c, hx('#d83848'), 0.45);
        // Клетки крови: редкие диски.
        if (hash(x >> 1, y >> 1, 74) > 0.985) c = mixc(c, hx('#c02030'), 0.8);
        t.put(x, y, c);
      }
  });
}

// ---------------------------------------------------------------------------
// Клетки районов.
// ---------------------------------------------------------------------------

/** Клетки, собранные по ключу (узор без мировых координат). */
const cells = new Map<string, Px>();
function cellOf(key: string, make: () => Px): Px {
  let p = cells.get(key);
  if (!p) {
    p = make();
    cells.set(key, p);
  }
  return p;
}

const T_WALL = 1;
const T_DEEP = 11;
const T_LIFT = 10;
const T_GATE = 8;
const T_GRATE = 7;
const T_SEAL = 13;

/** Наложить `top` на `p` с прозрачностью. */
function over(p: Px, top: Px): void {
  for (let i = 0; i < top.data.length; i += 4) {
    const a = top.data[i + 3];
    if (!a) continue;
    if (a === 255) {
      p.data[i] = top.data[i];
      p.data[i + 1] = top.data[i + 1];
      p.data[i + 2] = top.data[i + 2];
      p.data[i + 3] = 255;
      continue;
    }
    const k = a / 255;
    p.data[i] += (top.data[i] - p.data[i]) * k;
    p.data[i + 1] += (top.data[i + 1] - p.data[i + 1]) * k;
    p.data[i + 2] += (top.data[i + 2] - p.data[i + 2]) * k;
  }
}

/** Тень у подножия стен (свет сверху-слева): от стены на севере и сбоку. */
function footShade(p: Px, c: CellCtx): void {
  const nW = !c.open(0, -1);
  const wW = !c.open(-1, 0);
  const eW = !c.open(1, 0);
  if (nW)
    for (let x = 0; x < 16; x++) {
      p.set(x, 0, [0, 0, 0, 170]);
      p.set(x, 1, [0, 0, 0, 120]);
      p.set(x, 2, [0, 0, 0, 70]);
      p.set(x, 3, [0, 0, 0, 30]);
    }
  if (wW)
    for (let y = 0; y < 16; y++) {
      p.set(0, y, [0, 0, 0, 90]);
      p.set(1, y, [0, 0, 0, 40]);
    }
  if (eW) for (let y = 0; y < 16; y++) p.set(15, y, [0, 0, 0, 60]);
}

/** Стена в одну клетку толщиной под полом: кромка её верха — на полу. */
function lipOnFloor(p: Px, c: CellCtx, P: Pal): void {
  if (c.open(0, 1) || !c.open(0, 2)) return;
  for (let x = 0; x < 16; x++) {
    const wave = Math.round(Math.sin((c.wx * 16 + x) * 0.45) * 0.6);
    p.set(x, 11 + wave, INK);
    p.set(x, 12 + wave, P.rim[3]);
    p.set(x, 13 + wave, P.rim[2]);
    p.set(x, 14 + wave, P.rim[1]);
    p.set(x, 15, P.rim[0]);
  }
}

/** Пол-плоть района. */
function fleshFloor(c: CellCtx, st: Style): Px {
  const p = new Px(16, 16);
  if (st === 'veins') vesselTex().cell(p, c.wx, c.wy);
  else mucosaTex(st).cell(p, c.wx, c.wy);
  return p;
}

/**
 * Вена по полу: жила к соседним венам, изгиб — по ребру между клетками
 * (изгиб считает клетка с меньшими координатами, и обе рисуют одну кривую).
 */
function veinOver(p: Px, c: CellCtx, P: Pal, node = false): void {
  const isV = (dx: number, dy: number) => {
    const k = c.markAt(dx, dy);
    return k === M.vein || k === M.node;
  };
  const dirs: [number, number][] = [];
  for (const d of [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ] as [number, number][])
    if (isV(d[0], d[1])) dirs.push(d);
  if (!dirs.length) dirs.push([0, -1], [0, 1]);
  const lines: [number, number][][] = [];
  for (const [dx, dy] of dirs) {
    const fwd = dx > 0 || dy > 0;
    const ax = fwd ? c.wx : c.wx + dx;
    const ay = fwd ? c.wy : c.wy + dy;
    const amp = (hash(ax, ay, dx !== 0 ? 301 : 302) - 0.5) * 6;
    const line: [number, number][] = [];
    for (let i = 0; i <= 12; i++) {
      const sN = (i / 12) * 0.5;
      const t = fwd ? sN : 1 - sN;
      const off = amp * Math.sin(Math.PI * t);
      const along = sN * 16;
      line.push([8 + dx * along + (dy !== 0 ? off : 0), 8 + dy * along + (dx !== 0 ? off : 0)]);
    }
    lines.push(line);
  }
  for (const l of lines) for (const [x, y] of l) p.ell(x, y, 1.9, 1.9, alpha(P.veinDark, 0.85));
  for (const l of lines) for (const [x, y] of l) p.ell(x, y, 1.05, 1.05, P.vein);
  for (const l of lines)
    for (let i = 1; i < l.length; i += 4) p.set(Math.floor(l[i][0] - 0.5), Math.floor(l[i][1] - 0.5), P.veinHi);
  if (node) {
    // Узел — утолщение; живой свет даёт предмет поверх.
    p.ell(8, 8, 3.6, 3.2, P.veinDark);
    p.ell(8, 7.8, 2.6, 2.2, P.vein);
    p.ell(7.4, 7.2, 1, 0.8, P.veinHi);
  }
}

/**
 * Течение: ток по клетке (струи вдоль и «ёлочка» по ходу) — видно, куда
 * потащит удар сердца. В Сосудах — кровь мелким слоем, в Чреве — складки.
 */
function flowOver(p: Px, c: CellCtx, st: Style, k: number): void {
  const d = F15_FLOW[k];
  if (!d) return;
  const [fx, fy] = d;
  const veins = st === 'veins';
  const base = veins ? hx('#4a0612') : hx('#3a1408');
  const streakC = veins ? hx('#c42a40') : hx('#c8703a');
  const chev = veins ? hx('#f05a6c') : hx('#e8a060');
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const X = c.wx * 16 + x;
      const Y = c.wy * 16 + y;
      // Вдоль тока и поперёк — в мировых координатах, без швов.
      const a = X * fx + Y * fy;
      const b = X * fy - Y * fx;
      if (veins) p.set(x, y, alpha(base, 0.45));
      const sN = tnoise2(b, a, 2, 24, 1 << 16, 401);
      if (sN > 0.74) p.set(x, y, alpha(streakC, veins ? 0.55 : 0.3));
    }
  // Одна «ёлочка» на клетку через одну — остриём по ходу.
  if (hash(c.wx, c.wy, 77) > 0.5) {
    for (let i = -3; i <= 3; i++) {
      const back = Math.abs(i) * 0.9;
      const x = Math.round(8 + fy * i - fx * back + fx * 2);
      const y = Math.round(8 - fx * i - fy * back + fy * 2);
      p.set(x, y, alpha(chev, veins ? 0.5 : 0.32));
      p.set(x - fx, y - fy, alpha(chev, veins ? 0.25 : 0.15));
    }
  }
}

/** Перемычка из ткани через русло: волокна поперёк, тень к крови. */
function bridgeOver(p: Px, c: CellCtx, P: Pal): void {
  const n = c.markAt(0, -1) === M.blood;
  const s = c.markAt(0, 1) === M.blood;
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const X = c.wx * 16 + x;
      const f = tnoise2(X, y, 16, 2, 1 << 16, 411);
      let l = 0.55 + (f - 0.5) * 0.5 + dith(X, y) * 0.2 - (y / 15) * 0.2;
      if (n && y < 2) l = y === 0 ? -1 : 0.9;
      if (s && y > 12) l = y === 15 ? -1 : 0.05 - (y - 13) * 0.1;
      p.set(x, y, l < 0 ? INK : tone(P.rim, l));
    }
}

/** Жидкость (сок, кровь): своя текстура, край по соседям, берег темнее. */
function liquidCell(c: CellCtx, st: Style, kind: 'acid' | 'blood'): Px {
  const p = new Px(16, 16);
  // Под жидкостью — пол (виден у берега).
  const floor = fleshFloor(c, st);
  const lt = kind === 'acid' ? acidTex() : bloodTex();
  const same = (dx: number, dy: number) => {
    const k = c.markAt(dx, dy);
    return kind === 'acid' ? k === M.acid : k === M.blood;
  };
  const oy = kind === 'blood' ? Math.floor(c.wx * 7) : 0;
  lt.cell(p, c.wx, c.wy, 0, oy);
  // Берег: где сосед не жидкость — скруглённый край с пеной/тёмной кромкой.
  const n = same(0, -1);
  const s = same(0, 1);
  const w = same(-1, 0);
  const e = same(1, 0);
  const edge = kind === 'acid' ? hx('#b8d450') : hx('#6a1020');
  const dark = kind === 'acid' ? hx('#141c04') : hx('#080002');
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const i = (y * 16 + x) * 4;
      // Расстояние до «сухой» стороны.
      let d = 99;
      if (!n) d = Math.min(d, y);
      if (!s) d = Math.min(d, 15 - y);
      if (!w) d = Math.min(d, x);
      if (!e) d = Math.min(d, 15 - x);
      if (!n && !w) d = Math.min(d, Math.hypot(x, y) - 1.5);
      if (!n && !e) d = Math.min(d, Math.hypot(15 - x, y) - 1.5);
      if (!s && !w) d = Math.min(d, Math.hypot(x, 15 - y) - 1.5);
      if (!s && !e) d = Math.min(d, Math.hypot(15 - x, 15 - y) - 1.5);
      const jag = hash(c.wx * 16 + x, c.wy * 16 + y, 81) * 1.2;
      if (d + jag < 1.8) {
        const f = floor.get(x, y);
        p.data[i] = f[0];
        p.data[i + 1] = f[1];
        p.data[i + 2] = f[2];
      } else if (d + jag < 2.6) {
        p.data[i] = edge[0];
        p.data[i + 1] = edge[1];
        p.data[i + 2] = edge[2];
      } else if (d + jag < 4) {
        p.data[i] = (p.data[i] + dark[0]) / 2;
        p.data[i + 1] = (p.data[i + 1] + dark[1]) / 2;
        p.data[i + 2] = (p.data[i + 2] + dark[2]) / 2;
      }
    }
  return p;
}

/** Мелкая жидкость (слизь, мелкий сок, кровь течения) поверх пола пятнами. */
function puddleOver(p: Px, c: CellCtx, same: (k: number) => boolean, col: RGBA, hi: RGBA, a: number): void {
  const n = same(c.markAt(0, -1));
  const s = same(c.markAt(0, 1));
  const w = same(c.markAt(-1, 0));
  const e = same(c.markAt(1, 0));
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      let d = 99;
      if (!n) d = Math.min(d, y);
      if (!s) d = Math.min(d, 15 - y);
      if (!w) d = Math.min(d, x);
      if (!e) d = Math.min(d, 15 - x);
      const jag = tnoise(c.wx * 16 + x, c.wy * 16 + y, 3, 1 << 20, 82) * 2.2;
      if (d + jag < 1.6) continue;
      const rim = d + jag < 2.4;
      const q = tnoise(c.wx * 16 + x, c.wy * 16 + y, 5, 1 << 20, 83);
      p.set(x, y, alpha(rim ? hi : mixc(col, hi, q * 0.35), rim ? Math.min(1, a + 0.25) : a));
      if (!rim && q > 0.82 && hash(x, y, c.wx + c.wy * 7) > 0.8) p.set(x, y, alpha(hi, 0.9));
    }
}

/** Хрящевое кольцо поперёк хода: выпуклый розово-костяной валик. */
function ringOver(p: Px, c: CellCtx, P: Pal): void {
  const B = P.band;
  for (let x = 0; x < 16; x++) {
    const X = c.wx * 16 + x;
    const w = Math.round(Math.sin(X * 0.21) * 0.9 + (tnoise(X, 0, 16, 1 << 16, 91) - 0.5) * 1.4);
    const d = (y: number) => dith(X, y);
    p.set(x, 4 + w, alpha(B[1], 0.45));
    p.set(x, 5 + w, tone(B, 0.95 + d(5)));
    p.set(x, 6 + w, tone(B, 0.75 + d(6) * 0.4));
    p.set(x, 7 + w, tone(B, 0.55 + d(7) * 0.4));
    p.set(x, 8 + w, tone(B, 0.35 + d(8) * 0.4));
    p.set(x, 9 + w, tone(B, 0.1 + d(9) * 0.3));
    p.set(x, 10 + w, alpha(P.groove, 0.7));
    p.set(x, 11 + w, alpha(P.groove, 0.3));
    if (hash(X, c.wy, 92) > 0.8) p.set(x, 6 + w, mixc(B[3], P.wet, 0.4));
  }
}

/** Складки поля: гребни поперёк (течение — стрелки делает живой слой). */
function foldCell(c: CellCtx): Px {
  const p = new Px(16, 16);
  rugaeTex().cell(p, c.wx, c.wy);
  return p;
}

/** Кости, сгустки, сор — мелочь поверх пола. */
function litterOver(p: Px, c: CellCtx, kind: 'bones' | 'gore' | 'debris' | 'scar', st: Style): void {
  const h = (k: number) => hash(c.wx, c.wy, k);
  if (kind === 'bones') {
    const BONE = tn('#6a5e50', '#a89a84', '#d8ccb4', '#f4ecdc');
    const n = 1 + Math.floor(h(1) * 2);
    for (let i = 0; i < n; i++) {
      const x0 = 2 + h(10 + i) * 10;
      const y0 = 3 + h(20 + i) * 9;
      const a = h(30 + i) * TAU;
      const L = 4 + h(40 + i) * 4;
      const x1 = x0 + Math.cos(a) * L;
      const y1 = y0 + Math.sin(a) * L * 0.6;
      limb(p, x0, y0, x1, y1, 0.9, 0.9, BONE);
      shadeEll(p, x0, y0, 1.4, 1.2, BONE);
      shadeEll(p, x1, y1, 1.4, 1.2, BONE);
    }
    if (h(5) > 0.7) {
      // Ребро дугой.
      const pts = spline([
        [3, 12],
        [6, 8],
        [11, 7],
        [14, 9],
      ]);
      for (const [x, y] of pts) p.set(Math.round(x), Math.round(y), BONE[2]);
    }
    return;
  }
  if (kind === 'gore') {
    const G = st === 'gut' ? tn('#3a0e06', '#6a1c10', '#9a3020', '#d05a3a') : tn('#2a0206', '#5a0612', '#8a0e20', '#d02a40');
    const n = 2 + Math.floor(h(2) * 3);
    for (let i = 0; i < n; i++)
      shadeEll(p, 2 + h(50 + i) * 12, 2 + h(60 + i) * 12, 1 + h(70 + i) * 2.2, 0.8 + h(80 + i) * 1.4, G, 0.1);
    return;
  }
  if (kind === 'debris') {
    // Переваренный сор: щепа, кусочки плит, ржавчина, стекло.
    const n = 3 + Math.floor(h(3) * 3);
    const cols = ['#6a4a30', '#8a8a90', '#a05a2a', '#4a6a7a', '#c8b060', '#5a5a60'];
    for (let i = 0; i < n; i++) {
      const x = 1 + Math.floor(h(90 + i) * 13);
      const y = 1 + Math.floor(h(100 + i) * 13);
      const col = hx(cols[Math.floor(h(110 + i) * cols.length)]);
      const w = 1 + Math.floor(h(120 + i) * 2);
      p.rect(x, y, x + w, y + (w > 1 ? 0 : 1), col);
      p.set(x, y, mixc(col, WHITE, 0.35));
      p.set(x + w, y + 1, alpha(INK, 0.6));
    }
    return;
  }
  // Рубец: светлая стянутая ткань.
  const S = tn('#5a3a40', '#8a6068', '#b08890', '#d8b4b8');
  for (let i = 0; i < 3; i++) {
    const y = 3 + i * 4 + Math.floor(h(130 + i) * 2);
    stroke(p, 1, y, 14, y + (h(140 + i) > 0.5 ? 1 : -1), S[1]);
    stroke(p, 2, y - 1, 13, y - 1, S[2]);
  }
}

/** Лицо стены: мышца района; `relic` — обломок прошлого этажа в мясе. */
function wallFace(c: CellCtx, st: Style): Px {
  const P = PAL[st];
  const p = new Px(16, 16);
  faceTex(st).cell(p, c.wx, 0);
  // Верхняя губа лица (продолжает кромку сверху).
  for (let x = 0; x < 16; x++) {
    p.set(x, 0, P.rim[2]);
    if (hash(c.wx * 16 + x, 1, 7) > 0.5) p.set(x, 1, P.rim[1]);
  }
  // Тень у пола и влажный отблеск снизу (пол отражает).
  for (let x = 0; x < 16; x++) {
    p.set(x, 15, mixc(p.get(x, 15), hx('#000000'), 0.55));
    p.set(x, 14, mixc(p.get(x, 14), hx('#000000'), 0.3));
  }
  // Торцы: где сбоку пол — край мышцы скруглён светом/тенью.
  if (c.open(-1, 0)) for (let y = 0; y < 16; y++) {
    p.set(0, y, INK);
    p.set(1, y, P.rim[2]);
    p.set(2, y, mixc(p.get(2, y), P.rim[1], 0.5));
  }
  if (c.open(1, 0)) for (let y = 0; y < 16; y++) {
    p.set(15, y, INK);
    p.set(14, y, P.rim[0]);
  }
  const bl = c.open(-1, 0) && c.open(-1, 1);
  const br = c.open(1, 0) && c.open(1, 1);
  if (bl || br) roundCorners(p, c, st, false, false, bl, br);
  return p;
}

/** Верх массы стены: тёмная плоть и кромки к полу и лицам соседей. */
function wallTop(c: CellCtx, st: Style): Px {
  const P = PAL[st];
  const p = new Px(16, 16);
  wallTopTex(st).cell(p, c.wx, c.wy);
  const oU = c.open(0, -1);
  const oL = c.open(-1, 0);
  const oR = c.open(1, 0);
  // Сосед снизу — лицо стены (за ним пол): кромка по низу.
  const faceD = !c.open(0, 1) && c.open(0, 2);
  const faceL = !oL && c.open(-1, 1);
  const faceR = !oR && c.open(1, 1);
  const R = P.rim;
  const lip = (x: number, y: number, k: number) => p.set(x, y, k > 2.5 ? INK : tone(R, 0.95 - k * 0.3));
  if (faceD)
    for (let x = 0; x < 16; x++) {
      const w = Math.round(Math.sin((c.wx * 16 + x) * 0.45) * 0.6);
      for (let k = 0; k < 4; k++) lip(x, 15 - k + w, 3 - k);
      p.set(x, 11 + w, INK);
    }
  if (oU)
    for (let x = 0; x < 16; x++) {
      const w = Math.round(Math.sin((c.wx * 16 + x) * 0.45) * 0.6);
      for (let k = 0; k < 3; k++) lip(x, k + Math.max(0, w), k);
      p.set(x, 3 + Math.max(0, w), INK);
    }
  const side = (x0: number, dir: number) => {
    for (let y = 0; y < 16; y++) {
      const w = Math.round(Math.sin((c.wy * 16 + y) * 0.5) * 0.6);
      for (let k = 0; k < 3; k++) lip(x0 + dir * (k + Math.max(0, w)), y, k);
      p.set(x0 + dir * (3 + Math.max(0, w)), y, INK);
    }
  };
  if (oL || faceL) side(0, 1);
  if (oR || faceR) side(15, -1);
  // Внешние углы: пол по диагонали.
  if (c.open(-1, -1) && !oU && !oL) {
    p.ell(1, 1, 2.6, 2.6, R[2]);
    p.set(0, 0, R[3]);
  }
  if (c.open(1, -1) && !oU && !oR) {
    p.ell(14.5, 1, 2.6, 2.6, R[1]);
  }
  // Выпуклые углы — скруглены: плоть, а не кирпич. За углом — пол.
  const tl = oU && (oL || faceL);
  const tr = oU && (oR || faceR);
  if (tl || tr) roundCorners(p, c, st, tl, tr, false, false);
  return p;
}

/** Скруглить углы клетки стены: за дугой — пол района, по дуге — губа. */
function roundCorners(p: Px, c: CellCtx, st: Style, tl: boolean, tr: boolean, bl: boolean, br: boolean): void {
  const P = PAL[st];
  const floor = fleshFloor(c, st);
  const R0 = 6;
  const corner = (cx: number, cy: number, sx: number, sy: number) => {
    for (let y = 0; y < R0; y++)
      for (let x = 0; x < R0; x++) {
        const px = sx > 0 ? x : 15 - x;
        const py = sy > 0 ? y : 15 - y;
        const d = Math.hypot(R0 - x - 0.5, R0 - y - 0.5);
        if (d > R0) p.set(px, py, floor.get(px, py));
        else if (d > R0 - 1) p.set(px, py, INK);
        else if (d > R0 - 2.2) p.set(px, py, tone(P.rim, sy > 0 ? 0.9 : 0.25));
      }
    void cx;
    void cy;
  };
  if (tl) corner(0, 0, 1, 1);
  if (tr) corner(15, 0, -1, 1);
  if (bl) corner(0, 15, 1, -1);
  if (br) corner(15, 15, -1, -1);
}

/** Обломок прошлого этажа, вросший в лицо стены (14 видов). */
function relicOver(p: Px, c: CellCtx): void {
  const v = Math.floor(hash(c.wx, c.wy, 201) * 14);
  const k = (a: string) => hx(a);
  switch (v) {
    case 0: {
      // 1 — рельс с костылём.
      p.rect(2, 7, 13, 8, k('#6a6e74'));
      p.rect(2, 7, 13, 7, k('#b4b8bc'));
      p.rect(5, 6, 6, 10, k('#5a3a24'));
      p.set(5, 6, k('#8a5a34'));
      break;
    }
    case 1: {
      // 2 — шляпка гриба с пятнами, светится.
      shadeEll(p, 8, 8, 5, 3, tn('#1a4a4a', '#2a7a6a', '#4ab89a', '#a0ffe0'));
      p.set(6, 7, k('#e0fff4'));
      p.set(10, 8, k('#e0fff4'));
      p.rect(7, 11, 8, 13, k('#c8c0a8'));
      break;
    }
    case 2: {
      // 3 — друза бирюзы.
      polyShade(p, [
        [5, 13],
        [6, 5],
        [8, 3],
        [9, 13],
      ], tn('#0a3a4a', '#1a7a8a', '#40c8d0', '#c0ffff'));
      polyShade(p, [
        [9, 13],
        [11, 6],
        [12, 13],
      ], tn('#0a3a4a', '#1a6a7a', '#30a8b8', '#a0f0f8'));
      break;
    }
    case 3: {
      // 4 — череп.
      shadeEll(p, 8, 7, 4.2, 3.8, tn('#6a5e50', '#a89a84', '#d8ccb4', '#f4ecdc'));
      p.rect(6, 10, 10, 11, k('#a89a84'));
      p.set(6, 7, INK);
      p.set(7, 7, INK);
      p.set(9, 7, INK);
      p.set(10, 7, INK);
      p.set(8, 9, INK);
      break;
    }
    case 4: {
      // 5 — кирпич лабиринта со знаком.
      p.rect(3, 5, 12, 11, k('#6a5a4a'));
      p.rect(3, 5, 12, 5, k('#9a8a70'));
      p.rect(3, 11, 12, 11, k('#3a2e24'));
      p.line(6, 7, 9, 9, k('#e0c060'));
      break;
    }
    case 5: {
      // 6 — обсидиан с лавовой прожилкой.
      polyShade(p, [
        [3, 12],
        [5, 5],
        [11, 4],
        [13, 11],
      ], tn('#08060c', '#1a1620', '#342c40', '#6a5a80'));
      stroke(p, 5, 10, 11, 6, k('#ff6a1a'));
      p.set(8, 8, k('#ffd060'));
      break;
    }
    case 6: {
      // 7 — осколок зеркала.
      polyShade(p, [
        [4, 13],
        [6, 3],
        [12, 6],
        [10, 13],
      ], tn('#5a6a7a', '#8aa0b4', '#c0d8e8', '#ffffff'));
      stroke(p, 6, 11, 10, 5, alpha(WHITE, 0.8));
      break;
    }
    case 7: {
      // 8 — рама сёдзи.
      p.rect(3, 3, 12, 12, k('#e8dcc0'));
      for (const x of [3, 7, 12]) p.rect(x, 3, x, 12, k('#5a3a24'));
      for (const y of [3, 8, 12]) p.rect(3, y, 12, y, k('#5a3a24'));
      p.set(9, 5, alpha(k('#8a0a14'), 0.8));
      break;
    }
    case 8: {
      // 9 — обломок круга-телепорта с руной.
      p.ell(8, 8, 5, 5, k('#2a4a3a'));
      p.ell(8, 8, 3.6, 3.6, k('#16241c'));
      p.line(5, 8, 11, 8, k('#60ffb0'));
      p.line(8, 5, 8, 11, k('#60ffb0'));
      break;
    }
    case 9: {
      // 10 — золотой зубец короны и красный камень.
      polyShade(p, [
        [3, 12],
        [5, 5],
        [8, 9],
        [11, 5],
        [13, 12],
      ], tn('#6a4a10', '#a07a20', '#e0b840', '#fff0a0'));
      shadeEll(p, 8, 11, 1.6, 1.4, tn('#4a0408', '#8a0a14', '#e02030', '#ff9aa0'));
      break;
    }
    case 10: {
      // 11 — лопасть ветряка.
      polyShade(p, [
        [8, 8],
        [3, 4],
        [5, 3],
      ], tn('#5a4a30', '#8a7450', '#b8a070', '#e8d8a8'));
      polyShade(p, [
        [8, 8],
        [13, 12],
        [11, 13],
      ], tn('#5a4a30', '#8a7450', '#b8a070', '#e8d8a8'));
      shadeEll(p, 8, 8, 1.6, 1.6, tn('#4a3a20', '#8a6a30', '#c8a040', '#f0e080'));
      break;
    }
    case 11: {
      // 12 — плитка перрона с синей полосой.
      p.rect(3, 4, 12, 12, k('#d8d8d0'));
      p.rect(3, 8, 12, 9, k('#2a4aa0'));
      p.rect(3, 4, 12, 4, k('#f4f4f0'));
      p.set(7, 4, INK);
      p.set(7, 12, INK);
      break;
    }
    case 12: {
      // 13 — ядро пушки.
      shadeEll(p, 8, 8, 4, 4, tn('#101014', '#26262c', '#44444c', '#8a8a94'));
      break;
    }
    default: {
      // 14 — шестерня.
      const G = tn('#4a3410', '#8a6420', '#c89a38', '#f4d880');
      shadeEll(p, 8, 8, 4.4, 4.4, G);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        p.set(Math.round(8 + Math.cos(a) * 5.2), Math.round(8 + Math.sin(a) * 5.2), G[2]);
      }
      p.ell(8, 8, 1.4, 1.4, G[0]);
    }
  }
  // Мясо затягивает обломок: края — плотью.
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const d = Math.min(x, y, 15 - x, 15 - y);
      if (d < 2 && hash(c.wx * 16 + x, c.wy * 16 + y, 202) > 0.45) p.set(x, y, alpha(hx('#5a1624'), 0.7));
    }
}

/** Сгусток-стена тромба: плотный тёмный комок с прожилками. */
function clotWall(c: CellCtx, face: boolean): Px {
  const p = new Px(16, 16);
  const C = tn('#1a0206', '#3a0410', '#620a1c', '#9a2034');
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const n = tnoise(c.wx * 16 + x, c.wy * 16 + y, 4, 1 << 20, 301);
      p.set(x, y, tone(C, 0.1 + n * 0.8 - (face ? (y / 16) * 0.4 : 0)));
    }
  for (let i = 0; i < 3; i++) {
    const y = 2 + i * 5 + Math.floor(hash(c.wx, c.wy, 302 + i) * 3);
    stroke(p, 0, y, 15, y + 1, alpha(hx('#ff3a50'), 0.5));
  }
  if (face) for (let x = 0; x < 16; x++) p.set(x, 15, alpha(INK, 0.7));
  return p;
}

/** Пол под «живой стенкой»: складка, куда уходит кромка/клапан. */
function socketOver(p: Px, c: CellCtx, P: Pal, kind: number): void {
  if (kind === M.band) {
    // Кромка: влажная борозда у стены, мышца сюда наползает на вдохе.
    for (let y = 0; y < 16; y++) {
      const wallW = !c.open(-1, 0) || c.markAt(-1, 0) === M.band;
      for (let x = 0; x < 16; x++) {
        const t = wallW ? x : 15 - x;
        if ((t + y) % 5 === 0) p.set(x, y, alpha(P.groove, 0.45));
      }
    }
    return;
  }
  // Сфинктер / створка: кольцевые мышцы на полу, радиальные складки.
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      if ((y === 1 || y === 14) && hash(c.wx * 16 + x, y, 311) > 0.25) p.set(x, y, alpha(P.rim[1], 0.8));
      if (x % 4 === (c.wx % 2) * 2 && (y < 3 || y > 12)) p.set(x, y, alpha(P.groove, 0.6));
    }
}

function painter(area: string) {
  const st = styleOf(area);
  const P = PAL[st];
  return (c: CellCtx): Px | null => {
    const t = c.tile;
    if (t === T_LIFT || t === T_GATE || t === T_GRATE || t === T_SEAL) return null;
    // Жидкости (глубина).
    if (t === T_DEEP) {
      if (c.mark === M.blood) return liquidCell(c, st, 'blood');
      return liquidCell(c, st, 'acid');
    }
    // Стены: сгусток, лицо или масса.
    if (t === T_WALL || !(c.open(0, 0) || t === 2 || t === 12 || t === 3 || t === 4 || t === 5)) {
      if (c.mark === M.clotWall) return clotWall(c, c.open(0, 1));
      const face = c.open(0, 1);
      if (!face) return wallTop(c, st);
      const p = wallFace(c, st);
      if (c.mark === M.relic) relicOver(p, c);
      return p;
    }
    // Пол.
    const k = c.mark;
    let p: Px;
    if (k === M.fold || k === M.flowW || k === M.flowS || k === M.flowE || (k === M.flowN && st === 'gut'))
      p = foldCell(c);
    else if (k === M.ring1 || k === M.ring2 || k === M.ring3) {
      p = foldCell(c);
      // Кольца зала: чем глубже к краю, тем темнее — видно, где встанет сок.
      const a = k === M.ring1 ? 0.3 : k === M.ring2 ? 0.18 : 0.08;
      over(p, cellOf(`dim|${Math.round(a * 100)}`, () => {
        const q = new Px(16, 16);
        q.rect(0, 0, 15, 15, alpha(hx('#1a2004'), a));
        return q;
      }));
    } else p = fleshFloor(c, st);
    switch (k) {
      case M.ring:
        ringOver(p, c, P);
        break;
      case M.vein:
        veinOver(p, c, P);
        break;
      case M.node:
        veinOver(p, c, P, true);
        break;
      case M.mucus:
        puddleOver(p, c, (m) => m === M.mucus, hx('#6a9a7a'), hx('#c8f0d0'), 0.62);
        break;
      case M.shallow:
        puddleOver(p, c, (m) => m === M.shallow || m === M.acid, hx('#6a8a14'), hx('#d8f060'), 0.55);
        break;
      case M.acidRise:
        puddleOver(p, c, (m) => m === M.acidRise, hx('#7a9a18'), hx('#e8ff70'), 0.85);
        break;
      case M.flowN:
      case M.flowS:
      case M.flowW:
      case M.flowE:
        flowOver(p, c, st, k);
        break;
      case M.gore:
        litterOver(p, c, 'gore', st);
        break;
      case M.bones:
        litterOver(p, c, 'bones', st);
        break;
      case M.debris:
        litterOver(p, c, 'debris', st);
        break;
      case M.scar:
        litterOver(p, c, 'scar', st);
        break;
      case M.band:
      case M.valve:
      case M.door:
      case M.leaflet:
      case M.lymphDoor:
        socketOver(p, c, P, k);
        break;
      case M.clot:
        puddleOver(p, c, (m) => m === M.clot, hx('#3a0410'), hx('#8a1a2a'), 0.75);
        break;
      case M.vessel:
        bridgeOver(p, c, P);
        break;
    }
    footShade(p, c);
    lipOnFloor(p, c, P);
    return p;
  };
}

registerCellPainter(F15_THROAT, painter(F15_THROAT));
registerCellPainter(F15_GUT, painter(F15_GUT));
registerCellPainter(F15_VEINS, painter(F15_VEINS));

// ---------------------------------------------------------------------------
// Живое: состояние этажа для рисовальщика.
// ---------------------------------------------------------------------------

const view = () => f15View(paintSim());
const ease = (t: number) => {
  const k = clamp01(t);
  return k * k * (3 - 2 * k);
};
const qn = (v: number, n: number) => Math.round(clamp01(v) * n);

/** Удар сердца: 1 в миг удара, гаснет за треть секунды. */
function beatK(time: number): number {
  const S = view();
  const t = S ? S.beatT : time % 1.4;
  return Math.exp(-t * 7);
}

/** Рамка группы клеток клапана: середина и полуразмеры (клетки). */
const groupB = new WeakMap<F15State, Map<number, [number, number, number, number]>>();
function boxOf(S: F15State, l: Live): [number, number, number, number] {
  let m = groupB.get(S);
  if (!m) {
    m = new Map();
    groupB.set(S, m);
  }
  let c = m.get(l.group);
  if (!c) {
    let x0 = 1e9;
    let x1 = -1e9;
    let y0 = 1e9;
    let y1 = -1e9;
    for (const o of S.lives)
      if (o.group === l.group) {
        x0 = Math.min(x0, o.cx);
        x1 = Math.max(x1, o.cx);
        y0 = Math.min(y0, o.cy);
        y1 = Math.max(y1, o.cy);
      }
    c = [(x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2 + 0.5, (y1 - y0) / 2 + 0.5];
    m.set(l.group, c);
  }
  return c;
}

/** Кромка: сколько клеток кромки между этой и стеной и сколько всего. */
const bandGeo = new WeakMap<Live, [number, number]>();
function bandRank(l: Live): [number, number] {
  let g = bandGeo.get(l);
  if (g) return g;
  const sim = paintSim();
  if (!sim) return [0, 1];
  const w = sim.world;
  const x = Math.floor(l.cx);
  const y = Math.floor(l.cy);
  const dir = l.dx >= 0 ? 1 : -1;
  const isB = (xx: number) => xx >= 0 && xx < w.w && w.mark[y * w.w + xx] === M.band;
  let r = 0;
  while (r < 6 && isB(x - dir * (r + 1))) r++;
  let n = r + 1;
  while (n < 8 && isB(x + dir * (n - r))) n++;
  g = [r, n];
  bandGeo.set(l, g);
  return g;
}

// ---------------------------------------------------------------------------
// Живые стенки: кромка Горла, сфинктеры, двери Кривизны, створки сердца,
// дверь Лимфоузла. Мышца выползает со своей стороны на долю клетки: верх —
// светлой плотью с волокнами, торец — к югу, темнее. Всё в кеше по шагу.
// ---------------------------------------------------------------------------

const HMAX = 10;

function slabPx(st: Style, kind: LiveKind, side: number, k: number, trem: number, hot: number): Px {
  const P = PAL[st];
  const p = new Px(16, 16 + HMAX);
  const depth = side < 0 ? 16 : Math.max(2, Math.round(16 * k));
  const H = Math.round(
    kind === 'leaflet' ? 1 + 2 * k : kind === 'band' ? 2 + 8 * k : kind === 'door' ? 3 + 7 * k : 2 + 6 * k,
  );
  let top: Tones = P.rim;
  let face: Tones = P.face;
  let a = 1;
  if (kind === 'lymph') {
    top = tn('#6a7a3a', '#9aaa52', '#c4d27a', '#eef4b0');
    face = tn('#3a4a1c', '#56682a', '#728a38', '#94aa4c');
    a = 0.92;
  } else if (kind === 'leaflet') {
    top = tn('#a86474', '#d4909c', '#f0bcc4', '#fff0f2');
    face = tn('#6a2a3a', '#8a3a4c', '#aa5a6a', '#c87a88');
    a = 0.8;
  } else if (kind === 'door') {
    top = tn('#4a1c14', '#7a3424', '#a4543a', '#d08262');
  }
  // Местные координаты: u — от стены внутрь, v — вдоль стены.
  const xy = (u: number, v: number): [number, number] =>
    side === 0 ? [u, v] : side === 1 ? [15 - u, v] : side === 2 ? [v, u] : side === 3 ? [v, 15 - u] : [u, v];
  const edge = (v: number) =>
    side < 0 || k >= 0.97 ? 16 : Math.min(16, depth + Math.round(Math.sin(v * 0.8 + side * 1.7) * 1.2) + trem);
  const inFoot = (x: number, y: number) => {
    if (x < 0 || x > 15 || y < 0 || y > 15) return false;
    const [u, v] =
      side === 0 ? [x, y] : side === 1 ? [15 - x, y] : side === 2 ? [y, x] : side === 3 ? [15 - y, x] : [x, y];
    return u < edge(v);
  };
  const facesLight = side === 1 || side === 3;
  const hotC = hx('#e0304a');
  // Верх.
  for (let v = 0; v < 16; v++) {
    const e = edge(v);
    for (let u = 0; u < e; u++) {
      const [x, y] = xy(u, v);
      let l = 0.5 + dith(x, y) * 0.22 + (hash(v >> 1, side, 71) - 0.5) * 0.15;
      // Волокна вдоль хода (кромка), складки к центру (сфинктер).
      if (kind === 'band' && (v + (u >> 3)) % 4 === 0) l -= 0.22;
      if ((kind === 'valve' || kind === 'door') && (v * 3 + u) % 7 === 0) l -= 0.25;
      if (kind === 'lymph' && hash(x >> 2, y >> 2, 73) > 0.7 && ((x + y) & 3) === 0) l += 0.3;
      const d = e - u;
      if (d <= 1 && side >= 0) l += facesLight ? 0.35 : -0.3;
      else if (d === 2 && side >= 0) l += facesLight ? 0.12 : -0.1;
      if (u === 0 && side >= 0) l -= 0.15;
      let c = tone(top, l);
      if (hot > 0) c = mixc(c, hotC, hot * (0.25 + 0.2 * (d <= 2 ? 1 : 0)));
      p.set(x, y - H + HMAX, alpha(c, a));
    }
    if (side >= 0 && e < 16) {
      const [x, y] = xy(e, v);
      p.set(x, y - H + HMAX, alpha(INK, 0.85));
    }
  }
  // Торец к югу.
  for (let x = 0; x < 16; x++)
    for (let y = 15; y >= 0; y--) {
      if (!inFoot(x, y) || inFoot(x, y + 1)) continue;
      for (let h = 1; h <= H; h++) {
        const l = 0.55 - (h / H) * 0.5 + dith(x, y + h) * 0.2;
        p.set(x, y - H + h + HMAX, alpha(tone(face, l), a));
      }
      p.set(x, y + HMAX, alpha(INK, 0.7));
      break;
    }
  // Створка сердца: чешуя-полумесяц — свободный край дугой, под ним тень.
  if (kind === 'leaflet' && k >= 0.5) {
    for (let x = 0; x < 16; x++) {
      const y = Math.round(3 + 7 * Math.sin((Math.PI * (x + 0.5)) / 16) * Math.min(1, k));
      p.set(x, y - H + HMAX - 1, alpha(WHITE, 0.7));
      p.set(x, y - H + HMAX, alpha(hx('#fff0f2'), 0.95));
      p.set(x, y - H + HMAX + 1, alpha(hx('#8a3a4c'), 0.6));
      p.set(x, y - H + HMAX + 2, alpha(hx('#8a3a4c'), 0.3));
    }
  }
  // Сомкнувшийся сфинктер — морщинистая точка у середины.
  if ((kind === 'valve' || kind === 'door') && k > 0.9 && side >= 0) {
    const [x, y] = xy(15, 8);
    p.ell(x, y - H + HMAX, 1.6, 1.4, alpha(P.groove, 0.9));
  }
  return p;
}

function livePainter(kind: LiveKind) {
  return (o: WorldObj, time: number, _alive: boolean, flash: boolean): Sprite | null => {
    const S = view();
    const st = styleOf(o.area);
    const l = S?.byObj.get(o.id);
    let k: number;
    let side = 0;
    let trem = 0;
    let hot = 0;
    if (!l || !S) {
      k = kind === 'lymph' ? 1 : 0.15;
    } else {
      const since = time - l.at;
      const tr = kind === 'leaflet' ? 0.12 : 0.28;
      const e = l.closed ? ease(since / tr) : 1 - ease(since / tr);
      // Перед смыканием: набухает, дрожит и краснеет.
      let warn = 0;
      if (!l.closed) {
        if (kind === 'band' && S.relaxed <= time && S.cough.state !== 'on') {
          const b = S.breath;
          if (b >= BREATH.warnAt && b < BREATH.closeAt) warn = (b - BREATH.warnAt) / (BREATH.closeAt - BREATH.warnAt);
        } else if (kind === 'valve') {
          const b = l.area === F15_THROAT ? S.breath : S.digestP;
          const [w0, w1] = l.area === F15_THROAT ? [0.34, BREATH.valveClose] : [GUT_VALVE.open - 0.1, GUT_VALVE.open];
          if (b >= w0 && b < w1) warn = (b - w0) / (w1 - w0);
        }
        if (warn > 0) {
          trem = Math.floor(time * 18) % 2 ? 1 : -1;
          hot = warn;
        }
      }
      // Сколько мышцы наползло от стены (клетки) и чья это доля.
      let D: number;
      let rank: number;
      if (kind === 'band') {
        const [r, n] = bandRank(l);
        side = l.dx >= 0 ? 0 : 1;
        D = 0.4 + warn * 0.35 + (n - 0.4) * e;
        rank = r;
      } else {
        const [cx, cy, hw, hh] = boxOf(S, l);
        const horiz = hw >= hh;
        const half = horiz ? hw : hh;
        side = horiz ? (l.cx <= cx ? 0 : 1) : l.cy <= cy ? 2 : 3;
        rank = half - Math.abs(horiz ? l.cx - cx : l.cy - cy) - 0.5;
        const base = kind === 'lymph' ? 0.2 : 0.3;
        D = base + warn * 0.3 + (half + 0.1 - base) * e;
      }
      k = clamp01(D - rank);
      if (k < 0.08) return null;
    }
    const step = qn(k, 10);
    const hq = qn(hot, 3);
    return flashed(`live|${st}|${kind}|${side}|${step}|${trem}|${hq}`, flash, () => ({
      p: slabPx(st, kind, side, step / 10, trem, hq / 3),
      ax: 8,
      ay: 16 + HMAX,
    }));
  };
}

registerPropPainter('f15_band', livePainter('band'));
registerPropPainter('f15_valve', livePainter('valve'));
registerPropPainter('f15_door', livePainter('door'));
registerPropPainter('f15_leaflet', livePainter('leaflet'));
registerPropPainter('f15_lymphdoor', livePainter('lymph'));

// ---------------------------------------------------------------------------
// На стенах: полипы-светляки, глаза, реснички, артерия.
// ---------------------------------------------------------------------------

const GLOW: Record<Style, Tones> = {
  throat: tn('#0a4a4a', '#1a8a84', '#40d0c0', '#c0fff4'),
  gut: tn('#2a4a0a', '#5a8a14', '#9ad040', '#eaffb0'),
  veins: tn('#3a0a5a', '#6a2a9a', '#b070f0', '#f0d8ff'),
};

registerPropPainter('f15_polyp', (o, time, _a, flash) => {
  const st = styleOf(o.area);
  const f = Math.floor(time * 3 + hash(o.x, o.y, 1) * 8) % 6;
  const v = Math.floor(hash(o.x, o.y, 2) * 3);
  return flashed(`polyp|${st}|${v}|${f}`, flash, () => {
    const P = PAL[st];
    const G = GLOW[st];
    const p = new Px(20, 18);
    const glow = [0.45, 0.6, 0.85, 1, 0.85, 0.6][f];
    const n = 4 + v;
    for (let i = 0; i < n; i++) {
      const bx = 2.5 + (i / (n - 1)) * 15 + (hash(i, v, 17) - 0.5) * 2;
      const by = 16.5;
      const h = 4 + hash(i, v, 18) * 7;
      const sway = Math.sin(time * 1.4 + i * 1.9) * 0.9;
      const tx = bx + sway + (i % 2 ? 0.8 : -0.8);
      const ty = by - h;
      limb(p, bx, by, tx, ty + 1.5, 1.4, 1, P.rim);
      shadeEll(p, tx, ty, 2.6, 2.3, P.rim, 0.1);
      p.ell(tx, ty - 0.3, 1.8, 1.4, mixc(G[2], G[3], glow * 0.7));
      p.ell(tx - 0.4, ty - 0.8, 0.8, 0.6, mixc(G[3], WHITE, glow * 0.8));
    }
    p.outline(alpha(INK, 0.9));
    return { p, ax: 10, ay: 18 };
  });
});

registerPropPainter('f15_walleye', (o, time, _a, flash) => {
  const S = paintSim();
  const st = styleOf(o.area);
  const cx = o.x + 0.5;
  const cy = o.y + 0.5;
  let lx = 0;
  let ly = 0;
  let open = 2;
  if (S) {
    const dx = S.hero.x - cx;
    const dy = S.hero.y - cy;
    const d = Math.hypot(dx, dy);
    if (d < 9) {
      lx = Math.abs(dx) > d * 0.4 ? Math.sign(dx) : 0;
      ly = Math.abs(dy) > d * 0.4 ? Math.sign(dy) : 0;
    } else open = 1;
    if (d > 13) open = 0;
  }
  // Моргает раз в несколько секунд.
  const ph = (time + hash(o.x, o.y, 3) * 7) % 5.3;
  if (ph < 0.14 && open > 0) open = 0;
  return flashed(`weye|${st}|${lx}|${ly}|${open}`, flash, () => {
    const P = PAL[st];
    const p = new Px(16, 16);
    // Веки — складка плоти.
    shadeEll(p, 8, 8, 7, 5.5, P.rim, -0.05);
    if (open > 0) {
      const oh = open === 2 ? 3.4 : 1.6;
      p.ell(8, 8.2, 5.4, oh, hx('#f2e4d4'));
      // Красные жилки белка.
      p.set(3, 8, hx('#c04050'));
      p.set(4, 9, hx('#c04050'));
      p.set(12, 7, hx('#c04050'));
      const ix = 8 + lx * 2;
      const iy = 8.2 + ly * (open === 2 ? 1 : 0.4);
      p.ell(ix, iy, 2.4, Math.min(oh, 2.4), hx('#d8a020'));
      p.ell(ix, iy, 1.2, Math.min(oh, 2.4), hx('#6a3a08'));
      p.rect(Math.round(ix - 0.5), Math.round(iy - Math.min(oh, 2.4) + 0.5), Math.round(ix - 0.5), Math.round(iy + Math.min(oh, 2.4) - 1.5), INK);
      p.set(Math.round(ix - 1.5), Math.round(iy - 1.5), WHITE);
      // Веко сверху отбрасывает тень.
      for (let x = 3; x < 13; x++) p.set(x, Math.round(8.2 - oh), alpha(INK, 0.6));
    } else {
      // Закрыт: шов век с ресницами.
      for (let x = 2; x < 14; x++) {
        const y = 8 + Math.round(Math.sin((x - 2) / 12 * Math.PI) * 1.2);
        p.set(x, y, INK);
        if (x % 3 === 0) p.set(x, y + 1, alpha(INK, 0.7));
      }
    }
    p.outline(alpha(INK, 0.8));
    return { p, ax: 8, ay: 16 };
  });
});

registerPropPainter('f15_tendrils', (o, time, _a, flash) => {
  const st = styleOf(o.area);
  const f = Math.floor(time * 4 + hash(o.x, o.y, 4) * 8) % 4;
  return flashed(`tend|${st}|${f}`, flash, () => {
    const P = PAL[st];
    const p = new Px(16, 22);
    for (let i = 0; i < 6; i++) {
      const x0 = 1.5 + i * 2.6;
      const len = 9 + ((i * 7) % 5) * 1.6;
      const ph = f * (TAU / 4) + i * 1.3;
      const pts: [number, number][] = [];
      for (let s = 0; s <= 4; s++) {
        const t = s / 4;
        pts.push([x0 + Math.sin(ph + t * 2.5) * t * 2.2, 6 + t * len]);
      }
      const line = spline(pts, 4);
      line.forEach(([x, y], j) => {
        const r = 1.1 - (j / line.length) * 0.6;
        p.ell(x, y, r, r, tone(P.rim, 0.7 - (j / line.length) * 0.5));
      });
      const [ex, ey] = line[line.length - 1];
      p.set(Math.floor(ex), Math.floor(ey), P.veinHi);
    }
    // Основание — валик на лице стены.
    for (let x = 0; x < 16; x++) {
      p.set(x, 5, tone(P.rim, 0.8));
      p.set(x, 6, tone(P.rim, 0.5));
      p.set(x, 7, alpha(INK, 0.5));
    }
    return { p, ax: 8, ay: 16 };
  });
});

registerPropPainter('f15_artery', (o, time, _a, flash) => {
  const st = styleOf(o.area);
  const b = beatK(time);
  const s = b > 0.6 ? 2 : b > 0.25 ? 1 : 0;
  const v = Math.floor(hash(o.x, o.y, 5) * 2);
  return flashed(`art|${st}|${s}|${v}`, flash, () => {
    const p = new Px(16, 16);
    const A = tn('#4a0610', '#8a0e20', '#d02838', '#ff8a94');
    const r = 2.2 + s * 0.55;
    const pts = spline(
      v
        ? [
            [-1, 4],
            [5, 7],
            [11, 5],
            [17, 9],
          ]
        : [
            [-1, 10],
            [6, 6],
            [10, 9],
            [17, 6],
          ],
      6,
    );
    for (const [x, y] of pts) p.ell(x, y, r + 0.9, r + 0.9, alpha(INK, 0.85));
    for (const [x, y] of pts) shadeEll(p, x, y, r, r, A, s * 0.08);
    // Ветки-капилляры.
    const [bx, by] = pts[Math.floor(pts.length / 2)];
    stroke(p, bx, by + r, bx - 2, 15, alpha(A[1], 0.9));
    stroke(p, bx + 2, by - r, bx + 5, 1, alpha(A[1], 0.9));
    return { p, ax: 8, ay: 16 };
  });
});

// ---------------------------------------------------------------------------
// На полу: живое.
// ---------------------------------------------------------------------------

const BONE = tn('#6a5e50', '#a89a84', '#d8ccb4', '#f4ecdc');

registerPropPainter('f15_spike', (o, _t, _a, flash) => {
  const v = Math.floor(hash(o.x, o.y, 6) * 3);
  return flashed(`spike|${v}`, flash, () => {
    const p = new Px(12, 16);
    const K = tn('#4a3a34', '#7a665a', '#b09c88', '#e4d4c0');
    const lean = v - 1;
    polyShade(
      p,
      [
        [2, 15],
        [5 + lean * 2, 1],
        [10, 15],
      ],
      K,
    );
    // Кольца роста.
    for (let y = 5; y < 15; y += 3) stroke(p, 3 + (15 - y) * 0.1, y, 9 - (15 - y) * 0.1, y, alpha(K[0], 0.6));
    // Мясо у основания.
    shadeEll(p, 6, 14.5, 5, 1.8, PAL.throat.rim);
    p.outline(INK);
    return { p, ax: 6, ay: 16 };
  });
});

registerPropPainter('f15_rib', (o, _t, _a, flash) => {
  const v = hash(o.x, o.y, 7) > 0.5 ? 1 : 0;
  return flashed(`rib|${v}`, flash, () => {
    const p = new Px(20, 20);
    for (let i = 0; i < 2; i++) {
      const x0 = 3 + i * 7;
      const pts = spline(
        [
          [x0, 19],
          [x0 - 1 + v, 11],
          [x0 + 3, 4],
          [x0 + 8 - v, 3 + i],
        ],
        6,
      );
      pts.forEach(([x, y], j) => limb(p, x, y, x + 0.01, y, 1.8 - j * 0.03, 1.5, BONE));
    }
    shadeEll(p, 7, 18.6, 6, 1.6, PAL.throat.rim);
    shadeEll(p, 14, 18.6, 5, 1.4, PAL.throat.rim);
    p.outline(INK);
    return { p, ax: 10, ay: 20 };
  });
});

registerPropPainter('f15_cyst', (o, time, alive, flash) => {
  if (!alive) return null;
  const f = Math.floor(time * 2 + hash(o.x, o.y, 8) * 4) % 2;
  return flashed(`cyst|${f}`, flash, () => {
    const p = new Px(14, 14);
    const C = tn('#6a3a4a', '#b0708a', '#e0a8bc', '#fff0f4');
    shadeEll(p, 7, 8 - f * 0.3, 5.6 + f * 0.3, 5 - f * 0.3, C);
    // Жидкость внутри: тёмный мениск и пузырь.
    p.ell(7, 10, 4, 2.2, alpha(hx('#8a2a3a'), 0.55));
    p.ell(9, 6, 1, 1, alpha(WHITE, 0.8));
    p.set(4, 6, WHITE);
    stroke(p, 3, 10, 5, 8, alpha(hx('#c83a4a'), 0.6));
    p.outline(INK);
    return { p, ax: 7, ay: 14 };
  });
});

registerPropPainter('f15_eggs', (o, time, alive, flash) => {
  if (!alive) return null;
  const f = Math.floor(time * 3 + hash(o.x, o.y, 9) * 5) % 3;
  return flashed(`eggs|${f}`, flash, () => {
    const p = new Px(16, 12);
    const E = tn('#6a6a3a', '#b0b070', '#dcdca0', '#fbfbe0');
    const spots: [number, number, number][] = [
      [4, 8, 2.6],
      [8, 7, 3],
      [12, 8.5, 2.4],
      [6, 4.5, 2.2],
      [10.5, 4, 2.3],
    ];
    spots.forEach(([x, y, r], i) => {
      shadeEll(p, x, y, r, r * 0.9, E);
      // Зародыш шевелится.
      const w = i === f ? 0.6 : 0;
      p.ell(x + w, y + 0.4, r * 0.45, r * 0.35, alpha(hx('#5a2a1a'), 0.7));
      p.set(Math.floor(x - r * 0.4), Math.floor(y - r * 0.5), WHITE);
    });
    shadeEll(p, 8, 10.6, 7, 1.4, PAL.gut.rim);
    p.outline(INK);
    return { p, ax: 8, ay: 12 };
  });
});

registerPropPainter('f15_clot', (o, _t, _a, flash) => {
  const v = Math.floor(hash(o.x, o.y, 10) * 3);
  return flashed(`clot|${v}`, flash, () => {
    const p = new Px(16, 12);
    const C = tn('#1a0206', '#3a0410', '#6a0a1c', '#b83048');
    shadeEll(p, 8, 7, 6.5, 4.2, C);
    shadeEll(p, 5 + v, 5, 3, 2.4, C, 0.1);
    shadeEll(p, 11 - v, 6, 2.6, 2, C, 0.05);
    // Нити фибрина.
    stroke(p, 2, 9, 5, 6, alpha(hx('#d8b0a0'), 0.55));
    stroke(p, 10, 4, 14, 8, alpha(hx('#d8b0a0'), 0.55));
    p.set(6, 4, hx('#ffc0c8'));
    p.outline(INK);
    return { p, ax: 8, ay: 12 };
  });
});

registerPropPainter('f15_heartpod', (o, time, _a, flash) => {
  const b = beatK(time + hash(o.x, o.y, 11) * 0.12);
  const s = b > 0.55 ? 2 : b > 0.2 ? 1 : 0;
  return flashed(`hpod|${s}`, flash, () => {
    const p = new Px(14, 18);
    const H = tn('#4a0610', '#8a1222', '#d0344a', '#ff9aa8');
    // Стебель.
    limb(p, 7, 17, 7, 10, 1.6, 1.1, PAL.throat.rim);
    const k = 1 + s * 0.08;
    const cy = 6.5;
    shadeEll(p, 5.2, cy, 2.8 * k, 2.6 * k, H, 0.1);
    shadeEll(p, 8.8, cy, 2.8 * k, 2.6 * k, H);
    poly(
      p,
      [
        [2.6 - s * 0.2, cy + 0.6],
        [11.4 + s * 0.2, cy + 0.6],
        [7, 12 + s * 0.3],
      ],
      H[1],
    );
    p.set(4, 5, hx('#ffd0d8'));
    // Сосуды на сердечке.
    stroke(p, 7, 4, 6, 9, alpha(H[0], 0.8));
    shadeEll(p, 7, 17, 3.5, 1, PAL.throat.rim);
    p.outline(INK);
    return { p, ax: 7, ay: 18 };
  });
});

/** Узел вены: светится в такт сердцу, гаснет, если нерв рядом убит. */
registerPropPainter('f15_node', (o, time) => {
  const S = view();
  const node = S?.nodes.find((n) => Math.floor(n.x) === o.x && Math.floor(n.y) === o.y);
  const dim = !!node?.dim;
  const b = dim ? 0 : beatK(time);
  const s = dim ? 0 : b > 0.5 ? 3 : b > 0.2 ? 2 : 1;
  const st = styleOf(o.area);
  return sprite(`node|${st}|${s}`, () => {
    const P = PAL[st];
    const p = new Px(16, 16);
    if (s === 0) {
      p.ell(8, 8, 3, 2.6, P.veinDark);
      p.ell(8, 7.8, 1.8, 1.4, mixc(P.veinDark, P.vein, 0.3));
      return { p, ax: 8, ay: 16 };
    }
    const r = 2.6 + s * 0.6;
    p.ell(8, 8, r + 2.5, r + 2, alpha(P.vein, 0.12 + s * 0.06));
    p.ell(8, 8, r, r * 0.85, P.vein);
    p.ell(7.6, 7.4, r * 0.55, r * 0.45, mixc(P.vein, P.veinHi, 0.5 + s * 0.15));
    p.set(7, 6, WHITE);
    return { p, ax: 8, ay: 16 };
  });
});

// ---------------------------------------------------------------------------
// Переваренное: обломки четырнадцати этажей, затянутые мясом.
// ---------------------------------------------------------------------------

/** Мясо затягивает вещь: плёнка у основания и тяжи. */
function overgrow(p: Px, cx: number, by: number, w: number, st: Style = 'gut'): void {
  const R = PAL[st].rim;
  shadeEll(p, cx, by - 1, w, 2, R, -0.05);
  for (let i = 0; i < 3; i++) {
    const x = cx - w + 1 + i * (w - 1);
    stroke(p, x, by - 1, x + (i - 1), by - 5 - (i % 2) * 2, alpha(R[2], 0.9));
    p.set(Math.floor(x + (i - 1)), by - 6 - (i % 2) * 2, alpha(R[3], 0.9));
  }
}

function relic(key: string, w: number, h: number, draw: (p: Px) => void) {
  return (_o: WorldObj, _t: number, _a: boolean, flash: boolean) =>
    flashed(`relic|${key}`, flash, () => {
      const p = new Px(w, h);
      draw(p);
      p.outline(INK);
      return { p, ax: Math.floor(w / 2), ay: h };
    });
}

registerPropPainter(
  'f15_cart',
  relic('cart', 20, 16, (p) => {
    // Вагонетка Крысиных нор: ржавый короб, накренилась, колесо в мясе.
    const R = tn('#3a2418', '#6a3e24', '#9a5a32', '#c88a50');
    polyShade(p, [
      [2, 5],
      [17, 3],
      [16, 12],
      [4, 13],
    ], R);
    stroke(p, 2, 5, 17, 3, hx('#d8a060'));
    for (const x of [6, 11]) stroke(p, x, 4.5, x + 0.5, 12.5, alpha(R[0], 0.9));
    // Руда пирита сверху.
    shadeEll(p, 8, 3.5, 2, 1.4, tn('#6a5a20', '#a89030', '#e0c850', '#fff0a0'));
    shadeEll(p, 12, 3, 1.6, 1.2, tn('#6a5a20', '#a89030', '#e0c850', '#fff0a0'));
    shadeEll(p, 14, 13, 2.4, 2.4, tn('#1a1a1c', '#3a3a3e', '#6a6a70', '#a0a0a8'));
    overgrow(p, 9, 16, 8);
  }),
);

registerPropPainter('f15_shrooms', (o, time, _a, flash) => {
  const f = Math.floor(time * 1.5 + hash(o.x, o.y, 12) * 4) % 4;
  return flashed(`shroom|${f}`, flash, () => {
    const p = new Px(18, 16);
    const G = tn('#0e3a34', '#1a6a5a', '#3ab898', '#b0ffe0');
    const glow = [0, 1, 2, 1][f] * 0.12;
    const caps: [number, number, number][] = [
      [5, 8, 4],
      [11, 5, 5],
      [15, 10, 3],
    ];
    for (const [x, y, r] of caps) limb(p, x, 15, x, y + 1, 1, 0.8, tn('#6a6254', '#a09888', '#d0c8b8', '#f0ecdc'));
    for (const [x, y, r] of caps) {
      shadeEll(p, x, y, r, r * 0.6, G, glow);
      p.set(x - 1, y - 1, mixc(G[3], WHITE, 0.4 + glow));
      p.set(x + Math.floor(r / 2), y, G[3]);
    }
    overgrow(p, 9, 16, 7);
    p.outline(INK);
    return { p, ax: 9, ay: 16 };
  });
});

registerPropPainter(
  'f15_druse',
  relic('druse', 16, 16, (p) => {
    const T = tn('#0a3a4a', '#1a7a8a', '#40c8d0', '#c0ffff');
    polyShade(p, [
      [3, 15],
      [4, 6],
      [6, 3],
      [8, 15],
    ], T);
    polyShade(p, [
      [7, 15],
      [9, 4],
      [11, 1],
      [12, 15],
    ], T, 0.1);
    polyShade(p, [
      [11, 15],
      [13, 8],
      [14, 15],
    ], T, -0.1);
    stroke(p, 9.5, 4, 10.5, 12, alpha(WHITE, 0.7));
    overgrow(p, 8, 16, 7);
  }),
);

registerPropPainter(
  'f15_skull',
  relic('skull', 18, 16, (p) => {
    shadeEll(p, 9, 7, 6.5, 5.6, BONE);
    shadeEll(p, 9, 11, 4.6, 3, BONE, -0.05);
    p.ell(6.4, 7.5, 1.7, 1.9, INK);
    p.ell(11.6, 7.5, 1.7, 1.9, INK);
    p.set(6, 7, hx('#ff5a3a'));
    p.set(9, 10, INK);
    p.set(8, 10, INK);
    for (let x = 6; x <= 12; x += 2) p.set(x, 13, INK);
    stroke(p, 4, 3, 7, 6, alpha(BONE[0], 0.8));
    overgrow(p, 9, 16, 8);
  }),
);

registerPropPainter('f15_obsidian', (o, time, _a, flash) => {
  const f = Math.floor(time * 2 + hash(o.x, o.y, 13) * 4) % 3;
  return flashed(`obs|${f}`, flash, () => {
    const p = new Px(18, 16);
    polyShade(
      p,
      [
        [2, 15],
        [4, 6],
        [9, 2],
        [15, 5],
        [16, 15],
      ],
      tn('#060408', '#18141e', '#322a3e', '#6a5a80'),
    );
    const lava = [hx('#c83a0a'), hx('#ff6a1a'), hx('#ffb040')][f];
    stroke(p, 5, 13, 9, 7, lava);
    stroke(p, 9, 7, 13, 9, lava);
    p.set(9, 7, hx('#fff0a0'));
    stroke(p, 6, 5, 10, 3, alpha(WHITE, 0.6));
    overgrow(p, 9, 16, 8);
    p.outline(INK);
    return { p, ax: 9, ay: 16 };
  });
});

registerPropPainter(
  'f15_mirror',
  relic('mirror', 14, 20, (p) => {
    // Осколок зеркала в раме — в нём отражается мясо.
    const F = tn('#3a2a14', '#6a5024', '#a88438', '#e8c870');
    poly(p, [
      [2, 19],
      [2, 4],
      [7, 1],
      [12, 5],
      [12, 19],
    ], F[1]);
    poly(p, [
      [3.5, 18],
      [3.5, 5],
      [7, 2.8],
      [10.5, 5.6],
      [10.5, 18],
    ], (x, y) => (y < 9 ? hx('#c89aa8') : y < 13 ? hx('#9a5a6a') : hx('#6a2a3a')));
    stroke(p, 4, 15, 9, 6, alpha(WHITE, 0.75));
    stroke(p, 6, 10, 10.5, 13, INK);
    overgrow(p, 7, 20, 6);
  }),
);

registerPropPainter(
  'f15_shoji',
  relic('shoji', 18, 18, (p) => {
    // Сёдзи Бесконечного замка: рама, бумага порвана, в пятнах.
    const W = hx('#5a3a24');
    poly(p, [
      [2, 17],
      [4, 2],
      [16, 3],
      [15, 17],
    ], hx('#e8dcc0'));
    for (let i = 0; i <= 3; i++) stroke(p, 2 + i * 4.3, 17, 4 + i * 4, 2.3, W);
    for (let i = 0; i <= 3; i++) stroke(p, 2.5, 3 + i * 4.6, 16, 3.5 + i * 4.4, W);
    poly(p, [
      [8, 8],
      [12, 7],
      [11, 12],
      [9, 11],
    ], hx('#2a1a14'));
    p.ell(6, 13, 1.6, 1.2, alpha(hx('#8a0a14'), 0.8));
    overgrow(p, 9, 18, 8);
  }),
);

registerPropPainter('f15_rune', (o, time, _a, flash) => {
  const f = Math.floor(time * 2 + hash(o.x, o.y, 14) * 4) % 4;
  return flashed(`rune|${f}`, flash, () => {
    const p = new Px(18, 14);
    const S = tn('#1a2420', '#34443a', '#5a6e60', '#90a494');
    // Кусок плиты круга Лабиринта гидры.
    polyShade(p, [
      [1, 12],
      [3, 5],
      [15, 3],
      [17, 11],
    ], S);
    const glow = mixc(hx('#20a070'), hx('#a0ffd0'), [0.2, 0.6, 1, 0.6][f]);
    stroke(p, 4, 9, 14, 6, glow);
    stroke(p, 7, 5, 8, 10, glow);
    stroke(p, 11, 4, 12, 9, glow);
    overgrow(p, 9, 14, 8);
    p.outline(INK);
    return { p, ax: 9, ay: 14 };
  });
});

registerPropPainter(
  'f15_blade',
  relic('blade', 12, 22, (p) => {
    // Обломок меча Короля демонов — воткнут остриём.
    const B = tn('#140e18', '#2a2232', '#4a3e58', '#8a7aa0');
    polyShade(p, [
      [4, 20],
      [5, 6],
      [8, 5],
      [8, 20],
    ], B);
    stroke(p, 7.5, 6, 7.5, 19, hx('#c8203a'));
    p.rect(2, 3, 10, 4, hx('#6a5020'));
    p.rect(2, 3, 10, 3, hx('#c8a040'));
    p.rect(5, 0, 6, 2, hx('#3a2a18'));
    overgrow(p, 6, 22, 5);
  }),
);

registerPropPainter(
  'f15_vane',
  relic('vane', 20, 18, (p) => {
    // Лопасть ветряка Небесного архипелага: рейки и полотно.
    const Wd = tn('#4a3420', '#7a5a38', '#a88458', '#dcc090');
    limb(p, 3, 17, 16, 3, 1.2, 1, Wd);
    poly(p, [
      [7, 12],
      [14, 5],
      [18, 8],
      [11, 15],
    ], hx('#e8e0cc'));
    for (let i = 0; i < 3; i++) stroke(p, 9 + i * 2.4, 13 - i * 2.2, 15.5 + i * 0.8, 6.2 + i * 1.1, hx('#a89a80'));
    stroke(p, 12, 12, 15, 9, alpha(hx('#8a2a3a'), 0.7));
    overgrow(p, 6, 18, 5);
  }),
);

registerPropPainter(
  'f15_sign',
  relic('sign', 16, 20, (p) => {
    // Табличка перрона Проклятой станции, погнутая.
    p.rect(7, 8, 8, 19, hx('#5a5a60'));
    p.rect(7, 8, 7, 19, hx('#8a8a90'));
    poly(p, [
      [1, 2],
      [15, 1],
      [15, 8],
      [1, 9],
    ], hx('#f0f0ea'));
    poly(p, [
      [1, 4.2],
      [15, 3.4],
      [15, 5.6],
      [1, 6.4],
    ], hx('#2a4aa0'));
    for (let x = 3; x < 14; x += 2) p.set(x, 7, hx('#1a1a20'));
    stroke(p, 10, 2, 13, 8, alpha(hx('#8a1a2a'), 0.6));
    overgrow(p, 8, 20, 5);
  }),
);

registerPropPainter(
  'f15_cannon',
  relic('cannon', 22, 16, (p) => {
    const Br = tn('#3a2410', '#6a4420', '#a87030', '#e8b060');
    limb(p, 3, 11, 18, 5, 3.6, 2.8, Br);
    p.ell(18.4, 5, 2, 2.2, INK);
    for (const x of [7, 12]) {
      const y = 11 - (x - 3) * 0.4;
      stroke(p, x, y - 3.6, x + 0.6, y + 3.4, Br[3]);
    }
    shadeEll(p, 8, 13, 3, 3, tn('#1a120a', '#3a2a18', '#5a4428', '#8a6a40'));
    overgrow(p, 11, 16, 9);
  }),
);

registerPropPainter(
  'f15_gear',
  relic('gear', 18, 18, (p) => {
    const G = tn('#4a3410', '#8a6420', '#c89a38', '#f4d880');
    shadeEll(p, 9, 9, 6.2, 6.2, G);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU;
      p.ell(9 + Math.cos(a) * 7, 9 + Math.sin(a) * 7, 1.3, 1.3, G[1]);
    }
    p.ell(9, 9, 2.4, 2.4, G[0]);
    p.ell(9, 9, 1.2, 1.2, INK);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + 0.4;
      stroke(p, 9 + Math.cos(a) * 2.6, 9 + Math.sin(a) * 2.6, 9 + Math.cos(a) * 5.4, 9 + Math.sin(a) * 5.4, G[0]);
    }
    overgrow(p, 9, 18, 8);
  }),
);

// ---------------------------------------------------------------------------
// Действия этажа: железа (слизь), нерв (расслабить), зажим вены (Лимфоузел).
// ---------------------------------------------------------------------------

registerPropPainter('f15_gland', (o, time, _a, flash) => {
  const S = view();
  const empty = !!S && (S.glands.get(o.id) ?? -9) > (paintSim()?.time ?? 0);
  const f = empty ? 0 : Math.floor(time * 2 + hash(o.x, o.y, 15) * 4) % 4;
  return flashed(`gland|${empty ? 1 : 0}|${f}`, flash, () => {
    const p = new Px(16, 16);
    const G = empty ? tn('#3a2a14', '#5a4424', '#7a6234', '#9a8248') : tn('#4a5a14', '#7a9a24', '#b0d044', '#eaffa0');
    shadeEll(p, 8, 10, 6, empty ? 3.6 : 5, G);
    if (!empty) {
      // Пора и капля слизи — набухает.
      const d = [0.8, 1.2, 1.6, 1.2][f];
      p.ell(8, 5.6, 1.6, 1.2, hx('#2a3a08'));
      p.ell(8, 4.6 - d * 0.5, d, d, hx('#c8f080'));
      p.set(7, 4 - Math.round(d * 0.5), WHITE);
      p.set(5, 8, hx('#f4ffc0'));
    } else {
      // Сдулась: морщины.
      for (let x = 4; x < 13; x += 2) stroke(p, x, 8, x + 1, 12, alpha(G[0], 0.8));
    }
    shadeEll(p, 8, 14.6, 6.5, 1.4, PAL.throat.rim);
    p.outline(INK);
    return { p, ax: 8, ay: 16 };
  });
});

registerPropPainter('f15_nervecord', (o, time, _a, flash) => {
  const S = view();
  const used = !!S && (S.glands.get(o.id) ?? -9) > (paintSim()?.time ?? 0);
  const f = used ? 0 : Math.floor(time * 6 + hash(o.x, o.y, 16) * 6) % 3;
  return flashed(`ncord|${used ? 1 : 0}|${f}`, flash, () => {
    const p = new Px(14, 22);
    const N = used ? tn('#2a1a3a', '#4a3060', '#6a4a8a', '#8a6aa8') : tn('#3a0a5a', '#7a2ac0', '#c070ff', '#f4dcff');
    // Тяж нерва от пола к стене: натянут (жив) или провис (расслаблен).
    const sag = used ? 3 : 0;
    const pts = spline(
      [
        [3, 21],
        [4 + sag, 14],
        [9, 7 + sag * 0.5],
        [11, 0],
      ],
      6,
    );
    for (const [x, y] of pts) p.ell(x, y, 1.6, 1.6, alpha(INK, 0.9));
    for (const [x, y] of pts) p.ell(x, y, 0.9, 0.9, N[2]);
    // Узелок и искры.
    const [kx, ky] = pts[Math.floor(pts.length / 2)];
    shadeEll(p, kx, ky, 2.6, 2.4, N, 0.1);
    if (!used) {
      const sp = [
        [kx - 3, ky - 2],
        [kx + 3, ky + 1],
        [kx - 1, ky + 3],
      ][f];
      p.set(Math.floor(sp[0]), Math.floor(sp[1]), N[3]);
      p.set(Math.floor(kx - 0.5), Math.floor(ky - 1), WHITE);
    }
    shadeEll(p, 3.5, 20.8, 3, 1.2, PAL.veins.rim);
    return { p, ax: 7, ay: 22 };
  });
});

registerPropPainter('f15_wheel', (o, _t, _a, flash) => {
  const S = view();
  const shut = !!S?.lymphOpen;
  return flashed(`wheel|${shut ? 1 : 0}`, flash, () => {
    const p = new Px(20, 20);
    const V = tn('#1a1440', '#34307a', '#5a5ab8', '#a0a8f0');
    // Вена по полу; зажата — бледная и тонкая посередине.
    for (let x = 0; x < 20; x++) {
      const pinch = shut && Math.abs(x - 10) < 3;
      const r = pinch ? 0.8 : 2;
      p.ell(x + 0.5, 16, r + 0.8, r * 0.8 + 0.8, alpha(INK, 0.9));
    }
    for (let x = 0; x < 20; x++) {
      const pinch = shut && Math.abs(x - 10) < 3;
      shadeEll(p, x + 0.5, 16, pinch ? 0.8 : 2, pinch ? 0.7 : 1.6, pinch ? tn('#6a6a8a', '#9a9ab8', '#c8c8e0', '#f0f0ff') : V);
    }
    // Костяное колесо-ворот на вене: обод, четыре спицы, рукоять.
    const cx = 10;
    const cy = 8.5;
    const a0 = shut ? 0.8 : 0;
    p.ell(cx, cy, 7.2, 7.2, INK);
    p.ell(cx, cy, 6.2, 6.2, BONE[2]);
    p.ell(cx, cy, 4.8, 4.8, BONE[0]);
    p.ell(cx, cy, 4, 4, alpha(hx('#2a0a14'), 1));
    for (let i = 0; i < 4; i++) {
      const a = a0 + (i / 4) * TAU;
      limb(p, cx, cy, cx + Math.cos(a) * 5.4, cy + Math.sin(a) * 5.4, 0.9, 0.9, BONE);
    }
    shadeEll(p, cx, cy, 1.6, 1.6, BONE, 0.2);
    const ha = a0 - 0.8;
    limb(p, cx + Math.cos(ha) * 6, cy + Math.sin(ha) * 6, cx + Math.cos(ha) * 8.2, cy + Math.sin(ha) * 8.2, 1.2, 1.2, BONE);
    p.set(cx - 3, Math.floor(cy - 5), BONE[3]);
    return { p, ax: 10, ay: 20 };
  });
});

// ---------------------------------------------------------------------------
// Монстры «Мира». Кадр — из кеша по (вид, поза, номер); глаз светится.
// ---------------------------------------------------------------------------

const deathK = (pose: MobPose) => (pose.mode === 'dying' ? Math.min(3, Math.floor(pose.t / 0.16)) : 0);
const mod = (a: number, n: number) => ((a % n) + n) % n;

/** Антитело: белковый «Y», кончики-захваты светятся. Кувыркается к цели. */
const AB = tn('#4a5a7a', '#8aa4c8', '#c8dcf4', '#ffffff');
const AB_TIP = tn('#8a2a5a', '#d04a8a', '#ff8ac0', '#ffe0f0');
function paintAntibody(rot: number, spread: number, glow: number, broken: boolean): Built {
  const p = new Px(22, 22);
  const cx = 11;
  const cy = 11;
  const arm = (a: number, L: number, tip: boolean) => {
    const x1 = cx + Math.cos(a) * L;
    const y1 = cy + Math.sin(a) * L * 0.8;
    limb(p, cx, cy, x1, y1, 1.6, 1.2, AB);
    if (tip) {
      shadeEll(p, x1, y1, 1.9, 1.7, AB_TIP, glow * 0.3);
      if (glow > 0.5) p.set(Math.floor(x1 - 0.5), Math.floor(y1 - 1), WHITE);
    }
  };
  const up = rot - Math.PI / 2;
  if (broken) {
    limb(p, 4, 15, 9, 13, 1.4, 1.1, AB);
    limb(p, 13, 16, 18, 14, 1.4, 1.1, AB);
    shadeEll(p, 18, 14, 1.7, 1.5, AB_TIP);
    limb(p, 9, 18, 12, 18, 1.4, 1.1, AB);
  } else {
    arm(up + Math.PI, 4.6, false);
    arm(up - spread, 6.2, true);
    arm(up + spread, 6.2, true);
    shadeEll(p, cx, cy, 2.2, 2, AB, 0.1);
  }
  p.outline(INK);
  return { p, ax: 11, ay: 19, eye: broken ? null : [cx, cy] };
}

registerMobPainter('f15_antibody', (m, pose) => {
  const mode = pose.mode;
  let anim = 'idle';
  let f = 0;
  let rot = 0;
  let spread = 0.62;
  let glow = 0.3;
  let broken = false;
  if (mode === 'dying') {
    anim = 'dead';
    broken = pose.t > 0.12;
  } else if (mode === 'f15_latch') {
    anim = 'latch';
    f = mod(pose.frame, 2);
    spread = 0.28 + f * 0.08;
    glow = 1;
  } else if (mode === 'windup' || pose.anim === 'wind') {
    anim = 'wind';
    f = pose.t < 0.15 ? 0 : 1;
    spread = 0.9 + f * 0.15;
    glow = 0.7 + f * 0.3;
  } else if (mode === 'f15_fling') {
    anim = 'fling';
    f = mod(pose.frame, 4);
    rot = (f * Math.PI) / 2;
  } else if (pose.anim === 'run') {
    anim = 'run';
    f = mod(pose.frame, 6);
    rot = Math.sin((f / 6) * TAU) * 0.45;
    glow = 0.4;
  } else {
    f = mod(pose.frame, 4);
    rot = Math.sin((f / 4) * TAU) * 0.18;
  }
  return frameOf('f15_antibody', pose, anim, f, () => paintAntibody(rot, spread, glow, broken));
});

/** Макрофаг: амёба с ложноножками, ядро-почка и проглоченный сор внутри. */
function paintMacro(ph: number, open: number, squash: number, dead: number): Built {
  const W = 38;
  const H = 34;
  const p = new Px(W, H);
  const cx = 19;
  const cy = 19 - squash * 0.5;
  const R = (open ? 11.5 : 8.2) * (1 - dead * 0.25) + squash * 0.6;
  const pods = [0, 1, 2, 3, 4].map((i) => ({
    a: i * (TAU / 5) + 0.3 + Math.sin(ph * 0.5 + i) * 0.35,
    e: dead ? 0.05 : open ? 0.12 : 0.3 + 0.42 * (0.5 + 0.5 * Math.sin(ph + i * 1.7)),
  }));
  const rAt = (a: number) => {
    let k = 1 + 0.05 * Math.sin(a * 6 + ph);
    for (const q of pods) k += q.e * Math.pow(Math.max(0, Math.cos(a - q.a)), 14);
    return R * k;
  };
  const inside = (x: number, y: number) => {
    const dx = x + 0.5 - cx;
    const dy = (y + 0.5 - cy) / (0.78 - squash * 0.04);
    return Math.hypot(dx, dy) < rAt(Math.atan2(dy, dx));
  };
  const M1 = tn('#8a7a3a', '#c8b870', '#ece0a8', '#fffbe0');
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!inside(x, y)) continue;
      const edge = !inside(x + 1, y) || !inside(x - 1, y) || !inside(x, y + 1) || !inside(x, y - 1);
      const dx = (x + 0.5 - cx) / R;
      const dy = (y + 0.5 - cy) / R;
      let l = 0.42 - dx * 0.22 - dy * 0.32 + dith(x, y) * 0.22;
      if (edge) {
        p.set(x, y, M1[3]);
        continue;
      }
      // Зернистость цитоплазмы.
      if (hash(x, y, 601) > 0.9) l -= 0.3;
      const a = open ? (Math.hypot(dx, dy) < 0.62 ? 0.3 : 0.62) : 0.8;
      p.set(x, y, alpha(tone(M1, l), a));
    }
  if (!dead) {
    // Ядро-почка — внутри, у края; при глотании уходит к стенке.
    const nx = cx - 3 - open * 5 + Math.sin(ph * 0.5) * 1;
    const ny = cy - 1 - open * 3;
    shadeEll(p, nx, ny, 3.6, 2.6, tn('#3a1a5a', '#6a3a9a', '#9a6ac8', '#d8b8f0'));
    p.ell(nx + 1.2, ny + 0.6, 1.4, 1, alpha(hx('#2a0a4a'), 0.8));
    // Пузырьки-вакуоли и проглоченный сор.
    p.ell(cx + 4, cy - 2, 1.6, 1.3, alpha(hx('#f8f0d0'), 0.9));
    p.ell(cx + 1, cy + 3, 1.2, 1, alpha(hx('#f8f0d0'), 0.9));
    if (!open) {
      shadeEll(p, cx + 4, cy + 3, 1.6, 1.2, BONE);
      p.ell(cx - 5, cy + 4, 1.2, 1, hx('#8a1a2a'));
      p.rect(Math.floor(cx), Math.floor(cy + 5), Math.floor(cx + 2), Math.floor(cy + 5), hx('#5a4a3a'));
    }
  }
  p.outline(INK);
  let by = H - 1;
  while (by > 0 && !inside(cx, by)) by--;
  return { p, ax: cx, ay: by + 2, eye: dead ? null : [cx - 3, cy - 1] };
}

registerMobPainter('f15_macro', (m, pose) => {
  const mode = pose.mode;
  let anim = 'idle';
  let f = 0;
  let open = 0;
  let squash = 0;
  let dead = 0;
  if (mode === 'dying') {
    anim = 'dead';
    f = deathK(pose);
    dead = f / 3;
  } else if (mode === 'f15_engulf') {
    anim = 'engulf';
    f = mod(pose.frame, 4);
    open = 1;
  } else if (mode === 'windup' || pose.anim === 'wind') {
    anim = 'wind';
    f = pose.t < 0.2 ? 0 : 1;
    squash = 1 + f;
    open = f * 0.4;
  } else if (mode === 'f15_spit') {
    anim = 'spit';
    f = pose.t < 0.2 ? 0 : 1;
    squash = f ? -1 : 2;
  } else if (pose.anim === 'run') {
    anim = 'run';
    f = mod(pose.frame, 6);
  } else f = mod(pose.frame, 6);
  const ph = (f / 6) * TAU;
  return frameOf('f15_macro', pose, anim, f, () => paintMacro(ph, open, squash, dead));
});

/** Нервный узел: тело нейрона, дендриты по полу, искры по отросткам. */
function paintNerve(glow: number, spark: number, dead: number): Built {
  const W = 30;
  const H = 24;
  const p = new Px(W, H);
  const N = dead ? tn('#2a2a34', '#4a4a58', '#6a6a7a', '#8a8a9a') : tn('#3a0a5a', '#7a2ac0', '#c070ff', '#f4dcff');
  const cx = 15;
  const cy = 12;
  // Дендриты.
  const branches = [
    [-1.2, 11],
    [-0.4, 9],
    [0.5, 10],
    [1.4, 9],
    [2.4, 11],
    [3.2, 8],
  ];
  branches.forEach(([a, L], i) => {
    const x1 = cx + Math.cos(a) * L;
    const y1 = cy + Math.sin(a) * L * 0.55 + 3;
    limb(p, cx, cy + 2, x1, y1, 1.3, 0.5, N);
    const x2 = x1 + Math.cos(a + 0.6) * 3;
    const y2 = y1 + Math.sin(a + 0.6) * 1.8;
    limb(p, x1, y1, x2, y2, 0.6, 0.4, N);
    if (!dead && spark && i % 2 === spark % 2) p.set(Math.floor(x1), Math.floor(y1), N[3]);
  });
  shadeEll(p, cx, cy, 5.2 - dead, 4.6 - dead, N, glow * 0.25);
  if (!dead) {
    p.ell(cx - 0.5, cy - 0.5, 2 + glow, 1.7 + glow * 0.8, mixc(N[2], WHITE, 0.3 + glow * 0.5));
    p.set(cx - 2, cy - 2, WHITE);
  }
  p.outline(INK);
  return { p, ax: cx, ay: H - 3, eye: dead ? null : [cx, cy] };
}

registerMobPainter('f15_nerve', (m, pose) => {
  const mode = pose.mode;
  let anim = 'idle';
  let f = 0;
  let glow = 0.2;
  let spark = 0;
  let dead = 0;
  if (mode === 'dying') {
    anim = 'dead';
    f = deathK(pose);
    dead = 1;
  } else if (mode === 'f15_charge' || pose.anim === 'wind') {
    anim = 'charge';
    f = mod(pose.frame, 3);
    glow = 0.7 + f * 0.15;
    spark = f + 1;
  } else if (mode === 'recover') {
    anim = 'rest';
    glow = 0;
  } else {
    f = mod(pose.frame, 4);
    glow = [0.1, 0.25, 0.4, 0.25][f];
    spark = f === 2 ? 1 : 0;
  }
  return frameOf('f15_nerve', pose, anim, f, () => paintNerve(glow, spark, dead));
});

/** Паразит: клещ-червь с крючьями. Прячется в мясе пола, прыгает, цепляется. */
const PAR = tn('#4a4020', '#8a7a3a', '#c8b460', '#f4e8a0');
function paintParasite(kind: string, f: number): Built {
  const p = new Px(22, 18);
  if (kind === 'burrow') {
    // Бугор плоти ползёт по полу.
    shadeEll(p, 11, 13, 5 + (f % 2) * 0.5, 2.6, PAL.throat.rim, 0.05);
    stroke(p, 8, 12, 13, 12, alpha(INK, 0.6));
    p.outline(alpha(INK, 0.7));
    return { p, ax: 11, ay: 16, eye: null };
  }
  const seg = (x: number, y: number, r: number, b = 0) => shadeEll(p, x, y, r, r * 0.8, PAR, b);
  if (kind === 'exposed') {
    // На спине: брюхо вверх, лапки дёргаются.
    shadeEll(p, 11, 12, 6, 3.6, tn('#6a5a30', '#b0a060', '#e0d49a', '#fffadc'));
    for (let i = 0; i < 3; i++) {
      const x = 7 + i * 4;
      const k = (f + i) % 2 ? 2 : 0;
      stroke(p, x, 10, x - 1 + k, 6, INK);
    }
    p.outline(INK);
    return { p, ax: 11, ay: 16, eye: [15, 12] };
  }
  const stretch = kind === 'leap' ? 1.6 : kind === 'latch' ? 0.7 : 1;
  const lift = kind === 'leap' ? -3 : kind === 'rise' ? -1 : 0;
  // Лапки.
  for (let i = 0; i < 3; i++) {
    const x = 7 + i * 3.4 * stretch;
    const k = kind === 'run' ? ((f + i) % 2 ? 1 : -1) : 0;
    stroke(p, x, 12 + lift, x - 2 + k, 15, INK);
    stroke(p, x, 12 + lift, x + 2 - k, 15.5, INK);
  }
  // Тело: три сегмента, голова с крючьями вперёд (вправо).
  seg(6 + (1 - stretch) * 2, 11 + lift, 3.2);
  seg(10, 11 + lift - (kind === 'latch' ? 1 : 0), 3.6, 0.05);
  const hx0 = 10 + 4 * stretch;
  seg(hx0, 11 + lift, 2.6, 0.1);
  // Жвала.
  const jaw = kind === 'latch' || kind === 'bite' ? 0 : 1;
  stroke(p, hx0 + 2, 10 + lift, hx0 + 4.5, 9 + lift - jaw, hx('#e8d8b0'));
  stroke(p, hx0 + 2, 12 + lift, hx0 + 4.5, 13 + lift + jaw, hx('#e8d8b0'));
  // Полосы сегментов.
  for (const x of [8, 12]) stroke(p, x, 8.5 + lift, x, 13 + lift, alpha(PAR[0], 0.7));
  p.set(Math.floor(hx0 + 1), Math.floor(10 + lift), hx('#ffe86a'));
  p.outline(INK);
  return { p, ax: 11, ay: 16, eye: [Math.floor(hx0 + 1), Math.floor(10 + lift)] };
}

registerMobPainter('f15_parasite', (m, pose) => {
  const mode = pose.mode;
  let kind = 'idle';
  let f = 0;
  if (mode === 'dying') {
    kind = 'exposed';
    f = 0;
  } else if (mode === 'f15_burrow') {
    kind = 'burrow';
    f = mod(pose.frame, 2);
  } else if (mode === 'f15_rise' || pose.anim === 'wind') kind = 'rise';
  else if (mode === 'f15_leap') kind = 'leap';
  else if (mode === 'f15_latch') {
    kind = 'latch';
    f = mod(pose.frame, 2);
  } else if (mode === 'f15_exposed') {
    kind = 'exposed';
    f = mod(pose.frame, 2);
  } else if (pose.anim === 'run') {
    kind = 'run';
    f = mod(pose.frame, 2);
  }
  return frameOf('f15_parasite', pose, kind, f, () => paintParasite(kind, f));
});

/** Кислотный пузырь: плывёт над полом, внутри пузырьки; набухает — к лопанию. */
const ACID = tn('#2a4a08', '#5a8a14', '#9ad030', '#eaffa0');
function paintAcid(f: number, swell: number, dead: number): Built {
  const p = new Px(24, 24);
  const r = 5.4 + swell * 1.6 + (dead ? dead * 2 : 0);
  const cx = 12;
  const cy = 12;
  for (let y = 0; y < 24; y++)
    for (let x = 0; x < 24; x++) {
      const dx = (x + 0.5 - cx) / r;
      const dy = (y + 0.5 - cy) / (r * (1 - swell * 0.06 * ((f % 2) * 2 - 1)));
      const d = dx * dx + dy * dy;
      if (d > 1) continue;
      const rim = d > 0.72;
      const l = rim ? 0.75 : 0.3 - dx * 0.2 - dy * 0.3 + dith(x, y) * 0.2;
      p.set(x, y, alpha(tone(ACID, l + swell * 0.2), dead ? 0.5 * (1 - dead) : rim ? 0.95 : 0.7));
    }
  if (!dead) {
    // Пузырьки внутри поднимаются.
    for (let i = 0; i < 3; i++) {
      const by = cy + 3 - ((f + i * 1.4) % 4) * 1.6;
      const bx = cx - 2 + i * 2;
      p.ell(bx, by, 0.9, 0.9, alpha(ACID[3], 0.9));
    }
    p.ell(cx - r * 0.45, cy - r * 0.45, 1.3, 1, WHITE);
  }
  p.outline(alpha(INK, dead ? 0.3 : 0.9));
  return { p, ax: 12, ay: 21, eye: dead ? null : [cx + 1, cy] };
}

registerMobPainter('f15_acid', (m, pose) => {
  const mode = pose.mode;
  let anim = 'idle';
  let f = mod(pose.frame, 4);
  let swell = 0;
  let dead = 0;
  if (mode === 'dying') {
    anim = 'dead';
    f = deathK(pose);
    dead = f / 3;
  } else if (mode === 'f15_swell' || pose.anim === 'wind') {
    anim = 'swell';
    f = mod(pose.frame, 2);
    swell = Math.min(1, 0.4 + pose.t * 0.8);
  } else if (mode === 'f15_knock') {
    anim = 'knock';
    f = 0;
    swell = 0.3;
  }
  const sw = qn(swell, 3);
  return frameOf('f15_acid', pose, `${anim}${sw}`, f, () => paintAcid(f, sw / 3, dead));
});

/** Кровяной дрон: красный диск с венцом шипов, за ним струя. */
const RBC = tn('#4a0410', '#8a0a1e', '#d02a3a', '#ff9aa4');
function paintDrone(kind: string, f: number): Built {
  const p = new Px(26, 20);
  const cx = kind === 'ram' ? 15 : 13;
  const cy = 10;
  const rx = kind === 'ram' ? 7.5 : 6.2;
  const ry = kind === 'ram' ? 3.6 : 4.4;
  if (kind === 'ram') for (let i = 0; i < 3; i++) stroke(p, 1 + i, cy - 2 + i * 2, 8, cy - 1 + i, alpha(RBC[2], 0.5));
  // Шипы венца.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + f * 0.39;
    stroke(p, cx + Math.cos(a) * rx * 0.8, cy + Math.sin(a) * ry * 0.8, cx + Math.cos(a) * (rx + 2), cy + Math.sin(a) * (ry + 1.6), RBC[1]);
  }
  shadeEll(p, cx, cy, rx, ry, RBC);
  // Двояковогнутый: тёмная ямка в середине.
  p.ell(cx + 0.5, cy + 0.3, rx * 0.45, ry * 0.4, RBC[1]);
  p.ell(cx - rx * 0.4, cy - ry * 0.45, 1.4, 0.8, RBC[3]);
  if (kind === 'aim') p.ell(cx, cy, 1.4, 1.2, hx('#ffe0a0'));
  if (kind === 'dizzy')
    for (let i = 0; i < 3; i++) {
      const a = f * 0.8 + i * 2.1;
      p.set(Math.floor(cx + Math.cos(a) * 7), Math.floor(2 + Math.sin(a) * 1.5), hx('#fff4a0'));
    }
  p.outline(INK);
  return { p, ax: 13, ay: 17, eye: [cx + 2, cy] };
}

registerMobPainter('f15_drone', (m, pose) => {
  const mode = pose.mode;
  let kind = 'idle';
  let f = mod(pose.frame, 4);
  if (mode === 'dying') {
    kind = 'dizzy';
    f = deathK(pose);
  } else if (mode === 'f15_aim' || pose.anim === 'wind') kind = 'aim';
  else if (mode === 'f15_ram') kind = 'ram';
  else if (mode === 'f15_dizzy') kind = 'dizzy';
  return frameOf('f15_drone', pose, kind, f, () => paintDrone(kind, f));
});

/** Личинка: бледный червячок; через время окукливается в кокон. */
function paintLarva(kind: string, f: number): Built {
  const p = new Px(14, 12);
  if (kind === 'cocoon') {
    const C = tn('#4a2a18', '#8a5a34', '#c08a58', '#f0c898');
    shadeEll(p, 7, 7, 4.4 + f * 0.3, 3.4 + f * 0.2, C);
    for (let x = 4; x < 11; x += 2) stroke(p, x, 5, x + 1, 9.5, alpha(C[0], 0.6));
    p.ell(7, 7, 1.4, 1, alpha(hx('#ff6a4a'), 0.3 + f * 0.3));
    p.outline(INK);
    return { p, ax: 7, ay: 11, eye: null };
  }
  const L = tn('#6a5a50', '#b8a898', '#e8dcd0', '#fffaf0');
  for (let i = 0; i < 4; i++) {
    const x = 3 + i * 2.2;
    const y = 7 + Math.sin(f * 1.6 + i * 1.3) * (kind === 'run' ? 1 : 0.5);
    shadeEll(p, x, y, 1.8 - i * 0.1, 1.6, L);
  }
  const hy = 7 + Math.sin(f * 1.6 + 4 * 1.3) * 0.8;
  shadeEll(p, 11.4, hy, 1.8, 1.6, tn('#2a1008', '#5a2010', '#8a3a1a', '#c8603a'));
  p.set(12, Math.floor(hy - 1), hx('#ff6a4a'));
  p.outline(INK);
  return { p, ax: 7, ay: 11, eye: [12, Math.floor(hy - 1)] };
}

registerMobPainter('f15_larva', (m, pose) => {
  const mode = pose.mode;
  let kind = 'idle';
  let f = mod(pose.frame, 4);
  if (mode === 'f15_cocoon') {
    kind = 'cocoon';
    f = mod(pose.frame, 2);
  } else if (mode === 'dying') {
    kind = 'idle';
    f = 0;
  } else if (pose.anim === 'run') kind = 'run';
  return frameOf('f15_larva', pose, kind, f, () => paintLarva(kind, f));
});

/** Смотритель: глаз на мясистом стебле, корни в полу. Зрачок — куда смотрит. */
function paintWatcher(dir: number, kind: string, f: number): Built {
  const W = 22;
  const H = 30;
  const p = new Px(W, H);
  const R = PAL.veins.rim;
  // Корни и стебель.
  for (const [dx, dy] of [
    [-5, 1],
    [5, 1],
    [-3, 2],
    [3, 2.4],
  ])
    limb(p, 11, 26, 11 + dx, 26 + dy, 1.3, 0.6, R);
  const sway = kind === 'scan' ? [0, 1, 0, -1][f] : 0;
  limb(p, 11, 26, 11 + sway, 13, 2.4, 1.8, R);
  // Глазное яблоко.
  const ex = 11 + sway;
  const ey = 10;
  shadeEll(p, ex, ey, 6.4, 6, tn('#8a7a70', '#d8ccc0', '#f4ece4', '#ffffff'));
  // Жилки.
  stroke(p, ex - 6, ey + 1, ex - 3, ey, hx('#c04050'));
  stroke(p, ex + 6, ey - 1, ex + 3, ey + 1, hx('#c04050'));
  if (kind === 'blink') {
    shadeEll(p, ex, ey, 6.4, 6, R);
    for (let x = -5; x <= 5; x++) p.set(Math.floor(ex + x), Math.floor(ey + Math.abs(x) * 0.15), INK);
  } else {
    const a = (dir / 8) * TAU;
    const ix = ex + Math.cos(a) * 2.6;
    const iy = ey + Math.sin(a) * 2.2;
    const hot = kind === 'lock' || kind === 'fire';
    const iris = hot ? tn('#6a0a0a', '#c02010', '#ff6a2a', '#fff0a0') : tn('#4a3a08', '#a08018', '#e0c040', '#fff4a0');
    shadeEll(p, ix, iy, 2.8, 2.6, iris, kind === 'fire' ? 0.4 : 0);
    p.ell(ix, iy, 1.2, kind === 'fire' ? 0.8 : 1.4, INK);
    p.set(Math.floor(ix - 1.5), Math.floor(iy - 1.5), WHITE);
  }
  p.outline(INK);
  const a = (dir / 8) * TAU;
  return { p, ax: 11, ay: 27, eye: kind === 'blink' ? null : [Math.round(ex + Math.cos(a) * 2.6), Math.round(ey + Math.sin(a) * 2.2)] };
}

registerMobPainter('f15_watcher', (m, pose) => {
  const mode = pose.mode;
  let kind = 'scan';
  let f = mod(pose.frame, 4);
  if (mode === 'dying' || mode === 'f15_blink') {
    kind = 'blink';
    f = 0;
  } else if (mode === 'f15_lock') {
    kind = 'lock';
    f = 0;
  } else if (mode === 'f15_fire') {
    kind = 'fire';
    f = 0;
  }
  // Кадр рисуется без зеркала: направление — зрачком (8 сторон).
  let dir = mod(Math.round(((m.face ?? 0) / TAU) * 8), 8);
  if (pose.left) dir = mod(4 - dir, 8);
  return frameOf('f15_watcher', pose, `${kind}${dir}`, f, () => paintWatcher(dir, kind, f));
});

/** Златожил: жук-клещ, спина в золотых жилах и вросших монетах. Удирает. */
function paintGold(kind: string, f: number): Built {
  const p = new Px(18, 16);
  const G = tn('#6a4a10', '#b08420', '#f0c840', '#fff8c0');
  for (let i = 0; i < 3; i++) {
    const x = 6 + i * 3;
    const k = kind === 'run' ? ((f + i) % 2 ? 1.2 : -1.2) : 0;
    stroke(p, x, 11, x - 1.5 + k, 14.5, INK);
    stroke(p, x, 11, x + 1.5 - k, 14.5, INK);
  }
  shadeEll(p, 9, 9, 6.4, 4.8, tn('#3a0a10', '#6a1a24', '#9a3040', '#c86070'));
  // Золотые жилы и монеты на спине.
  stroke(p, 4, 9, 13, 7, G[2]);
  stroke(p, 7, 6, 10, 12, G[1]);
  shadeEll(p, 7, 7, 1.8, 1.4, G);
  shadeEll(p, 11, 9.5, 1.7, 1.3, G);
  shadeEll(p, 9, 5.5, 1.5, 1.1, G);
  shadeEll(p, 15, 9.5, 2.2, 1.9, tn('#2a0a10', '#5a1a24', '#8a3040', '#b86070'));
  const sp = [
    [7, 6],
    [11, 8],
    [9, 4],
  ][f % 3];
  p.set(sp[0], sp[1], WHITE);
  p.set(16, 9, hx('#ffe060'));
  p.outline(INK);
  return { p, ax: 9, ay: 15, eye: [16, 9] };
}

registerMobPainter('f15_gold', (m, pose) => {
  const kind = pose.anim === 'run' ? 'run' : 'idle';
  const f = mod(pose.frame, kind === 'run' ? 2 : 3);
  return frameOf('f15_gold', pose, kind, f, () => paintGold(kind, f));
});

/** Мешок-рождение: полупрозрачный пузырь плоти, в нём тень зародыша. */
function paintSac(swell: number, burst: number, f: number): Built {
  const p = new Px(22, 22);
  const S = tn('#6a2a3a', '#b0607a', '#e0a0b4', '#fff0f4');
  const r = 5.6 + swell * 2.6;
  const cx = 11;
  const cy = 20 - r * 0.85;
  if (burst) {
    // Лопнул: рваная плёнка лепестками и лужа.
    shadeEll(p, 11, 18, 8, 3, tn('#4a0a1a', '#8a2a3a', '#c05060', '#f09aa8'));
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i - 2) * 0.6;
      poly(p, [
        [11 + Math.cos(a - 0.3) * 3, 17],
        [11 + Math.cos(a) * (6 + burst), 17 - 5 - burst],
        [11 + Math.cos(a + 0.3) * 3, 17],
      ], alpha(S[2], 0.85));
    }
    p.outline(INK);
    return { p, ax: 11, ay: 20, eye: null };
  }
  for (let y = 0; y < 22; y++)
    for (let x = 0; x < 22; x++) {
      const dx = (x + 0.5 - cx) / r;
      const dy = (y + 0.5 - cy) / (r * 0.9);
      const d = dx * dx + dy * dy;
      if (d > 1) continue;
      const rim = d > 0.75;
      const l = rim ? 0.72 : 0.35 - dx * 0.2 - dy * 0.3 + dith(x, y) * 0.2;
      p.set(x, y, alpha(tone(S, l), rim ? 1 : 0.82));
    }
  // Зародыш шевелится — тёмный комок.
  const wig = [0, 0.6, 0, -0.6][f];
  p.ell(cx + wig, cy + 0.8, r * 0.42, r * 0.34, alpha(hx('#5a1a2a'), 0.6 + swell * 0.3));
  p.set(Math.floor(cx + wig + 1), Math.floor(cy), alpha(hx('#ff6a4a'), 0.6 + swell * 0.4));
  // Жилки по оболочке.
  stroke(p, cx - r * 0.7, cy + 1, cx - 1, cy - r * 0.6, alpha(hx('#c83a5a'), 0.7));
  stroke(p, cx + r * 0.6, cy + 2, cx + 1, cy - r * 0.5, alpha(hx('#c83a5a'), 0.7));
  p.ell(cx - r * 0.45, cy - r * 0.45, 1.2, 0.9, WHITE);
  // Корень в полу.
  shadeEll(p, 11, 20, r * 0.8, 1.6, PAL.gut.rim);
  p.outline(INK);
  return { p, ax: 11, ay: 21, eye: [Math.floor(cx + 1), Math.floor(cy)] };
}

registerMobPainter('f15_sac', (m, pose) => {
  const mode = pose.mode;
  const s = qn(Number(m.data.s ?? 0), 4);
  let anim = `s${s}`;
  let f = mod(pose.frame, 4);
  let burst = 0;
  if (mode === 'f15_burst' || mode === 'dying') {
    anim = 'burst';
    f = Math.min(2, Math.floor(pose.t / 0.12));
    burst = f + 1;
  }
  return frameOf('f15_sac', pose, anim, f, () => paintSac(s / 4, burst, f));
});

/** Миндалина: бугристая розовая масса с лакунами; плюётся из пор. */
function paintTonsil(open: number, f: number, dead: number): Built {
  const W = 30;
  const H = 26;
  const p = new Px(W, H);
  const T = tn('#5a1a2a', '#9a3a4e', '#d06a7a', '#f8b0b8');
  const lobes: [number, number, number][] = [
    [10, 15, 7],
    [19, 14, 7.5],
    [14, 9, 6.5],
    [22, 18, 5],
    [7, 19, 5],
  ];
  const puff = [0, 0.3, 0.5, 0.3][f];
  for (const [x, y, r] of lobes) shadeEll(p, x, y - dead * 2, r + puff * 0.4 - dead, r * 0.85 - dead, T, -0.02);
  // Лакуны — тёмные ямки; открыты — в них мокрота.
  const pits: [number, number][] = [
    [9, 14],
    [15, 9],
    [19, 13],
    [22, 18],
    [12, 18],
  ];
  pits.forEach(([x, y], i) => {
    const r = 0.9 + open * 0.8;
    p.ell(x, y, r, r * 0.8, hx('#2a0a10'));
    if (open > 0.5 && i % 2 === f % 2) p.ell(x, y - 0.4, r * 0.6, r * 0.5, hx('#d8f0b0'));
  });
  p.ell(12, 8, 1.4, 1, hx('#ffe0e4'));
  shadeEll(p, 15, 23, 12, 2, PAL.throat.rim, -0.1);
  p.outline(INK);
  return { p, ax: 15, ay: 24, eye: null };
}

registerMobPainter('f15_tonsil', (m, pose) => {
  const mode = pose.mode;
  let anim = 'idle';
  let f = mod(pose.frame, 4);
  let open = 0;
  let dead = 0;
  if (mode === 'dying') {
    anim = 'dead';
    f = deathK(pose);
    dead = f;
  } else if (mode === 'f15_spit' || pose.anim === 'wind') {
    anim = 'spit';
    open = 1;
    f = mod(pose.frame, 2);
  }
  return frameOf('f15_tonsil', pose, anim, f, () => paintTonsil(open, f, dead));
});

/** Матка выводка: раздутое брюхо в яйцах, маленькая хитиновая голова. */
function paintMatron(kind: string, f: number): Built {
  const W = 50;
  const H = 38;
  const p = new Px(W, H);
  const Ab = tn('#6a2a34', '#b0606a', '#dc9a9c', '#fcdcd8');
  const Ch = tn('#1a0a0c', '#3a1418', '#6a2a2e', '#a85a5a');
  const rise = kind === 'slam' ? (f === 0 ? -4 : 1) : 0;
  const pulse = kind === 'idle' ? [0, 0.6, 1, 0.6][f] : 0;
  const bx = 19;
  const by = 20 + rise * 0.3;
  const rx = 15.5 + pulse;
  const ry = 11 + pulse * 0.6;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const dx = (x + 0.5 - bx) / rx;
      const dy = (y + 0.5 - by) / ry;
      const d = dx * dx + dy * dy;
      if (d > 1) continue;
      const rim = d > 0.84;
      let l = rim ? 0.82 : 0.4 - dx * 0.25 - dy * 0.35 + dith(x, y) * 0.2;
      // Кольца брюха — дугами, как у личинки, не досками.
      const u = dx * 3.2 + dy * dy * 0.9;
      const fr = u - Math.floor(u);
      if (!rim && fr < 0.1) l -= 0.3;
      else if (!rim && fr < 0.2) l += 0.12;
      p.set(x, y, alpha(tone(Ab, l), rim ? 1 : 0.9));
    }
  // Жилки по брюху.
  stroke(p, bx - 12, by + 3, bx - 4, by - 6, alpha(hx('#b0203a'), 0.7));
  stroke(p, bx - 4, by - 6, bx + 5, by - 8, alpha(hx('#b0203a'), 0.7));
  stroke(p, bx + 2, by + 7, bx + 9, by + 1, alpha(hx('#b0203a'), 0.7));
  // Яйца светятся сквозь оболочку.
  for (let i = 0; i < 8; i++) {
    const ex = bx - 9 + (i % 4) * 5.2 + (i > 3 ? 2.4 : 0);
    const ey = by - 3.5 + Math.floor(i / 4) * 6.5 + ((i * 3) % 2);
    p.ell(ex, ey, 2, 1.6, alpha(hx('#fff4c0'), 0.75));
    p.ell(ex + 0.4, ey + 0.2, 0.9, 0.7, alpha(hx('#c8603a'), 0.8));
  }
  p.ell(bx - rx * 0.45, by - ry * 0.55, 2.4, 1.2, alpha(WHITE, 0.7));
  // Лапки.
  for (let i = 0; i < 3; i++) {
    const x = 31 + i * 3;
    stroke(p, x, 24 + rise, x - 3 + i, 35, Ch[1]);
    stroke(p, x, 24 + rise, x + 3, 34, Ch[1]);
  }
  // Грудь и голова (справа).
  shadeEll(p, 34, 20 + rise, 5.4, 4.6, Ch);
  shadeEll(p, 41, 17 + rise, 4.4, 3.8, Ch, 0.05);
  // Жвала.
  stroke(p, 44, 16 + rise, 47, 13 + rise - (kind === 'slam' ? 1 : 0), hx('#e8d0b0'));
  stroke(p, 44, 19 + rise, 47, 21 + rise, hx('#e8d0b0'));
  p.set(42, 15 + rise, hx('#ffe86a'));
  p.set(40, 16 + rise, hx('#ffe86a'));
  p.outline(INK);
  return { p, ax: 27, ay: 34, eye: [42, 15 + rise] };
}

registerMobPainter('f15_matron', (m, pose) => {
  const mode = pose.mode;
  let kind = 'idle';
  let f = mod(pose.frame, 4);
  if (mode === 'f15_slam' || pose.anim === 'wind') {
    kind = 'slam';
    f = pose.t < 0.6 ? 0 : 1;
  } else if (mode === 'dying') {
    kind = 'idle';
    f = 0;
  }
  return frameOf('f15_matron', pose, kind, f, () => paintMatron(kind, f));
});

// ---------------------------------------------------------------------------
// Подражатели: кадры монстров прошлых этажей, перекрашенные в плоть. Мясо
// подземелья помнит форму — сталь становится костью, шерсть — мышцей, и
// на теле открываются лишние глаза.
// ---------------------------------------------------------------------------

type Grad = [number, RGBA][];
const MIMIC_FLESH: Grad = [
  [0, hx('#1a0408')],
  [0.18, hx('#4a0e1c')],
  [0.38, hx('#8a2a3a')],
  [0.6, hx('#c85a64')],
  [0.8, hx('#eaa4a0')],
  [1, hx('#fff0e4')],
];
const MIMIC_BONE: Grad = [
  [0, hx('#1a0408')],
  [0.2, hx('#4a1a1c')],
  [0.4, hx('#8a4a44')],
  [0.62, hx('#c8a088')],
  [0.82, hx('#ecdcc4')],
  [1, hx('#ffffff')],
];
const MIMIC_BILE: Grad = [
  [0, hx('#10140a')],
  [0.2, hx('#3a1a10')],
  [0.4, hx('#7a3a24')],
  [0.62, hx('#b8704a')],
  [0.8, hx('#d8c060')],
  [1, hx('#f8ffc0')],
];

function grad(g: Grad, l: number): RGBA {
  for (let i = 1; i < g.length; i++)
    if (l <= g[i][0]) {
      const [a, ca] = g[i - 1];
      const [b, cb] = g[i];
      return mixc(ca, cb, (l - a) / (b - a || 1));
    }
  return g[g.length - 1][1];
}

const mimics = new WeakMap<HTMLCanvasElement, MobFrame>();
function mimicFrame(src: MobFrame, g: Grad, eyeC: RGBA, seed: number): MobFrame {
  const hit = mimics.get(src.img);
  if (hit) return hit;
  const w = src.img.width;
  const h = src.img.height;
  const ctx = src.img.getContext('2d');
  const p = new Px(w, h);
  if (ctx) p.data.set(ctx.getImageData(0, 0, w, h).data);
  let minX = w;
  let maxX = 0;
  let minY = h;
  let maxY = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (!p.data[i + 3]) continue;
      const r = p.data[i];
      const gg = p.data[i + 1];
      const b = p.data[i + 2];
      const l = (0.3 * r + 0.55 * gg + 0.15 * b) / 255;
      // Контур остаётся контуром; светящееся — светится своим.
      const sat = Math.max(r, gg, b) - Math.min(r, gg, b);
      let c: RGBA;
      const l2 = Math.min(1, 0.12 + l * 1.3);
      if (l < 0.07) c = [INK[0], INK[1], INK[2], 255];
      else if (sat > 110 && l > 0.45) c = mixc(grad(g, l2), eyeC, 0.3);
      else c = grad(g, l2);
      p.data[i] = c[0];
      p.data[i + 1] = c[1];
      p.data[i + 2] = c[2];
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  // Лишние глаза и жилки — внутри силуэта, в верхней половине.
  if (maxX > minX) {
    const bw = maxX - minX;
    const bh = maxY - minY;
    for (let k = 0; k < 3; k++) {
      const x = Math.floor(minX + bw * (0.3 + hash(seed, k, 1) * 0.45));
      const y = Math.floor(minY + bh * (0.18 + hash(seed, k, 2) * 0.35));
      const i = (y * w + x) * 4;
      if (p.data[i + 3] < 200) continue;
      const j = (y * w + x + 1) * 4;
      if (p.data[j + 3] < 200) continue;
      p.set(x, y, eyeC);
      p.set(x + 1, y, INK);
      p.set(x, y + 1, alpha(INK, 0.6));
    }
    for (let k = 0; k < 2; k++) {
      const x0 = minX + bw * (0.2 + hash(seed, k, 3) * 0.6);
      const y0 = minY + bh * (0.4 + hash(seed, k, 4) * 0.4);
      for (let s = 0; s < 4; s++) {
        const x = Math.floor(x0 + s * 0.8);
        const y = Math.floor(y0 + Math.sin(s + k) * 1.2);
        const i = (y * w + x) * 4;
        if (x >= 0 && y >= 0 && x < w && y < h && p.data[i + 3] > 200) p.set(x, y, hx('#6a0a1c'));
      }
    }
  }
  const out: MobFrame = { img: p.canvas(), ax: src.ax, ay: src.ay, eye: src.eye };
  mimics.set(src.img, out);
  return out;
}

function mimic(srcId: string, g: Grad, eyeC: string, map: (mode: string) => string) {
  const ec = hx(eyeC);
  return (m: Mob, pose: MobPose): MobFrame | null => {
    const src = MOB_PAINTERS.get(srcId);
    if (!src) return null;
    const fr = src(m, { ...pose, mode: map(pose.mode) });
    if (!fr) return null;
    return mimicFrame(fr, g, ec, fr.img.width * 31 + fr.img.height);
  };
}

registerMobPainter('f15_mhound', mimic('f10_hound', MIMIC_FLESH, '#e0ff60', (md) => md));
registerMobPainter(
  'f15_msala',
  mimic('f6_salamander', MIMIC_BILE, '#e0ff60', (md) =>
    md === 'f15_swim'
      ? 'f6_swim'
      : md === 'f15_slide'
        ? 'f6_slide'
        : md === 'f15_rise'
          ? 'f6_rise'
          : md === 'f15_leap'
            ? 'f6_leap'
            : md === 'f15_lunge'
              ? 'f6_lunge'
              : md === 'f15_spit'
                ? 'aim'
                : md,
  ),
);
registerMobPainter(
  'f15_mknight',
  mimic('f4_knight', MIMIC_BONE, '#e0ff60', (md) =>
    md === 'f15_guard'
      ? 'guard'
      : md === 'f15_bash'
        ? 'lunge'
        : md === 'f15_open'
          ? 'open'
          : md === 'windup'
            ? 'aim'
            : md === 'recover'
              ? 'stagger'
              : md,
  ),
);

// ---------------------------------------------------------------------------
// Зоны и удары: метка «чужак», кашель, бурление сока, тромб, взгляд
// смотрителя, слизь-укрытие, лужи; разряд нерва и луч смотрителя.
// ---------------------------------------------------------------------------

type ZX = (Zone | Strike) & Record<string, number | undefined>;
const lifeK = (z: Zone) => clamp01(Math.min(z.t / 0.3, (z.life - z.t) / 0.6));

/** Кольцо метки «чужак» у ног героя: пять засечек, краснеет с тревогой. */
registerZonePainter('f15_alien', (g, z, px, py, _S, time) => {
  const zz = z as ZX;
  const k = (zz.k ?? 0) / 100;
  if (!zz.on || k < 0.02) return true;
  const S = paintSim();
  const hx0 = S ? S.hero.x * 16 - (z.x * 16 - px) : px;
  const hy0 = S ? S.hero.y * 16 - (z.y * 16 - py) : py;
  const col = k < 0.4 ? [255, 220, 120] : k < 0.7 ? [255, 140, 60] : [255, 50, 60];
  const pulse = 0.5 + 0.5 * Math.sin(time * (4 + k * 10));
  g.save();
  g.translate(hx0, hy0 + 3);
  g.scale(1, 0.5);
  for (let i = 0; i < 5; i++) {
    const on = k * 5 > i;
    const a0 = -Math.PI / 2 + (i / 5) * TAU + 0.12;
    g.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${on ? 0.45 + 0.4 * pulse * k : 0.12})`;
    g.lineWidth = on ? 2 : 1;
    g.beginPath();
    g.arc(0, 0, 8, a0, a0 + TAU / 5 - 0.24);
    g.stroke();
  }
  g.restore();
  return true;
});

/** Кашель: вдох тянет пылинки вверх, потом волна мокроты идёт вниз по Трахее. */
registerZonePainter('f15_gust', (g, z, px, py, S, time) => {
  const zz = z as ZX;
  const x0 = zz.x0 ?? z.x - 3;
  const x1 = zz.x1 ?? z.x + 3;
  const y0 = zz.y0 ?? z.y - 10;
  const y1 = zz.y1 ?? z.y + 10;
  const inhale = zz.inhale ?? 1.6;
  const speed = zz.speed ?? 19;
  const ox = px - z.x * S;
  const oy = py - z.y * S;
  const W = (x1 - x0) * S;
  if (z.t < inhale) {
    const k = z.t / inhale;
    for (let i = 0; i < 70; i++) {
      const sx = x0 * S + hash(i, 1, 501) * W;
      const span = (y1 - y0) * S;
      const sy = y1 * S - ((hash(i, 2, 501) * span + time * (60 + 160 * k)) % span);
      g.fillStyle = `rgba(255,236,240,${0.15 + 0.35 * k})`;
      g.fillRect(Math.round(ox + sx), Math.round(oy + sy), 1, 3 + Math.round(k * 4));
    }
    return true;
  }
  const front = y0 + (z.t - inhale) * speed;
  const fy = oy + front * S;
  // Пелена за фронтом (выше) и сам фронт — рваная кромка.
  const grad = g.createLinearGradient(0, fy - 5 * S, 0, fy);
  grad.addColorStop(0, 'rgba(240,210,215,0)');
  grad.addColorStop(1, 'rgba(240,210,215,0.42)');
  g.fillStyle = grad;
  g.fillRect(Math.round(ox + x0 * S), Math.round(fy - 5 * S), Math.round(W), Math.round(5 * S));
  g.fillStyle = 'rgba(255,245,245,0.75)';
  for (let x = 0; x < W; x += 2) {
    const j = Math.sin((x + time * 90) * 0.3) * 2 + Math.sin(x * 0.7) * 1.5;
    g.fillRect(Math.round(ox + x0 * S + x), Math.round(fy + j - 2), 2, 3);
  }
  for (let i = 0; i < 40; i++) {
    const sx = x0 * S + hash(i, 3, 502) * W;
    const sy = front * S - hash(i, 4, 502) * 6 * S;
    g.fillStyle = `rgba(230,240,200,${0.3 + hash(i, 5, 502) * 0.4})`;
    g.fillRect(Math.round(ox + sx), Math.round(oy + sy), 1, 5);
  }
  void y1;
  return true;
});

/** Сок бурлит: пузыри на клетках кольца, которое вот-вот зальёт. */
registerZonePainter('f15_boil', (g, z, px, py, S, time) => {
  const V = view();
  const sim = paintSim();
  const ring = (z as ZX).ring ?? 0;
  const cells = V?.digest.cells[ring];
  if (!cells || !sim) return true;
  const W = sim.world.w;
  const ox = px - z.x * S;
  const oy = py - z.y * S;
  const k = clamp01(z.t / Math.max(0.1, (z as Zone).life));
  const hxp = sim.hero.x;
  const hyp = sim.hero.y;
  for (const i of cells) {
    const cx = i % W;
    const cy = Math.floor(i / W);
    if (Math.abs(cx - hxp) > 14 || Math.abs(cy - hyp) > 18) continue;
    g.fillStyle = `rgba(120,160,20,${0.12 + 0.25 * k})`;
    g.fillRect(Math.round(ox + cx * S), Math.round(oy + cy * S), S, S);
    const ph = (time * 2.5 + hash(cx, cy, 511)) % 1;
    const bx = ox + (cx + 0.2 + hash(cx, cy, 512) * 0.6) * S;
    const by = oy + (cy + 0.2 + hash(cx, cy, 513) * 0.6) * S;
    const r = 1 + ph * 2.5;
    g.strokeStyle = `rgba(220,255,120,${(1 - ph) * (0.5 + 0.5 * k)})`;
    g.lineWidth = 1;
    g.beginPath();
    g.arc(Math.round(bx), Math.round(by), r, 0, TAU);
    g.stroke();
  }
  return true;
});

/** Тромб: там, где встанет пробка, — тёмная пульсирующая полоса и нити. */
registerZonePainter('f15_clotwarn', (g, z, px, py, S, time) => {
  const zz = z as ZX;
  const x0 = zz.x0 ?? z.x - 2;
  const x1 = zz.x1 ?? z.x + 2;
  const ox = px - z.x * S;
  const k = clamp01(z.t / Math.max(0.1, (z as Zone).life));
  const top = Math.round(py - S / 2);
  const pulse = 0.5 + 0.5 * Math.sin(time * 16);
  g.fillStyle = `rgba(90,0,20,${0.25 + 0.4 * k})`;
  g.fillRect(Math.round(ox + x0 * S), top, Math.round((x1 - x0) * S), S);
  g.strokeStyle = `rgba(255,70,90,${0.35 + 0.5 * pulse})`;
  g.lineWidth = 1;
  g.strokeRect(Math.round(ox + x0 * S) + 0.5, top + 0.5, Math.round((x1 - x0) * S) - 1, S - 1);
  g.strokeStyle = `rgba(230,200,190,${0.3 + 0.4 * k})`;
  for (let i = 0; i < (x1 - x0) * 3; i++) {
    const x = ox + x0 * S + hash(i, 1, 521) * (x1 - x0) * S;
    g.beginPath();
    g.moveTo(Math.round(x), top + 1);
    g.lineTo(Math.round(x + (hash(i, 2, 521) - 0.5) * 8), top + S - 1);
    g.stroke();
  }
  return true;
});

/** Взгляд смотрителя: бледный конус; впился — красный и уже. */
registerZonePainter('f15_gaze', (g, z, px, py, S) => {
  const zz = z as ZX;
  const sim = paintSim();
  const m = sim?.mobs.find((x) => x.id === zz.mob);
  if (!m || m.mode === 'dying' || m.mode === 'f15_blink') return true;
  const ox = px - z.x * S;
  const oy = py - z.y * S;
  const cx = ox + m.x * S;
  const cy = oy + m.y * S - 10;
  const a = zz.ang ?? 0;
  const arc = (zz.arc ?? 1) * (zz.lock ? 0.35 : 1);
  const L = (zz.len ?? 8) * S;
  const k = zz.k ?? 0.3;
  const grad = g.createRadialGradient(cx, cy, 2, cx, cy, L);
  const col = zz.lock ? '255,70,40' : '255,230,140';
  grad.addColorStop(0, `rgba(${col},${0.22 * k + 0.05})`);
  grad.addColorStop(1, `rgba(${col},0)`);
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(cx, cy);
  g.arc(cx, cy, L, a - arc / 2, a + arc / 2);
  g.closePath();
  g.fill();
  return true;
});

/** Слизь железы: герой в плёнке — зеленоватый отлив и капли. */
registerZonePainter('f15_coat', (g, z, px, py, S, time) => {
  const sim = paintSim();
  if (!sim) return true;
  const ox = px - z.x * S;
  const oy = py - z.y * S;
  const hxp = ox + sim.hero.x * S;
  const hyp = oy + sim.hero.y * S;
  const k = lifeK(z as Zone);
  g.save();
  g.translate(hxp, hyp);
  g.fillStyle = `rgba(170,230,140,${0.18 * k})`;
  g.beginPath();
  g.ellipse(0, -5, 8, 11, 0, 0, TAU);
  g.fill();
  g.strokeStyle = `rgba(210,255,180,${0.45 * k})`;
  g.lineWidth = 1;
  g.beginPath();
  g.ellipse(0, -5, 8, 11, 0, -2.4 + Math.sin(time * 2) * 0.3, -0.6);
  g.stroke();
  for (let i = 0; i < 3; i++) {
    const ph = (time * 0.8 + i / 3) % 1;
    g.fillStyle = `rgba(200,255,160,${(1 - ph) * 0.7 * k})`;
    g.fillRect(Math.round(-5 + i * 5), Math.round(-8 + ph * 12), 1, 2);
  }
  g.restore();
  return true;
});

/** Лужа: неровное пятно с кромкой и пузырями. */
function puddle(color: [number, number, number], rim: [number, number, number], bubbles: boolean) {
  return (g: CanvasRenderingContext2D, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const zz = z as Zone;
    const warn = zz.warn ?? 0;
    const k = zz.t < warn ? zz.t / Math.max(0.01, warn) : lifeK(zz);
    const R = zz.r * S * (zz.t < warn ? 0.4 + 0.6 * k : 1);
    g.save();
    g.translate(Math.round(px), Math.round(py));
    g.scale(1, 0.62);
    g.beginPath();
    for (let i = 0; i <= 16; i++) {
      const a = (i / 16) * TAU;
      const r = R * (0.84 + 0.16 * Math.sin(a * 3 + zz.id));
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i) g.lineTo(x, y);
      else g.moveTo(x, y);
    }
    g.closePath();
    g.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},${0.5 * k})`;
    g.fill();
    g.strokeStyle = `rgba(${rim[0]},${rim[1]},${rim[2]},${0.7 * k})`;
    g.lineWidth = 1.4;
    g.stroke();
    if (bubbles)
      for (let i = 0; i < 4; i++) {
        const ph = (time * 1.6 + i * 0.27 + zz.id * 0.13) % 1;
        const a = hash(zz.id, i, 531) * TAU;
        const r = R * 0.6 * hash(zz.id, i, 532);
        g.strokeStyle = `rgba(${rim[0]},${rim[1]},${rim[2]},${(1 - ph) * 0.8 * k})`;
        g.beginPath();
        g.arc(Math.cos(a) * r, Math.sin(a) * r, 0.8 + ph * 2, 0, TAU);
        g.stroke();
      }
    g.restore();
    return true;
  };
}

registerZonePainter('f15_acidpool', puddle([110, 160, 20], [220, 255, 110], true));
registerZonePainter('f15_bilepool', puddle([150, 140, 20], [240, 230, 110], true));
registerZonePainter('f15_slime', puddle([190, 220, 170], [240, 255, 230], false));

/** Добивание своими — без рисунка. */
registerZonePainter('f15_crush', () => true);

/** Ком мокроты падает: тень растёт, сверху летит сам ком. */
registerZonePainter('f15_phlegm', (g, z, px, py, S) => {
  const st = z as Strike;
  const k = clamp01(st.t / Math.max(0.01, st.warn));
  const R = st.r * S;
  g.fillStyle = `rgba(20,30,10,${0.15 + 0.3 * k})`;
  g.beginPath();
  g.ellipse(Math.round(px), Math.round(py), R * (0.4 + 0.6 * k), R * 0.5 * (0.4 + 0.6 * k), 0, 0, TAU);
  g.fill();
  g.strokeStyle = `rgba(220,250,190,${0.3 + 0.5 * k})`;
  g.lineWidth = 1;
  g.beginPath();
  g.ellipse(Math.round(px), Math.round(py), R, R * 0.5, 0, 0, TAU);
  g.stroke();
  const gy = py - (1 - k) * 36;
  g.fillStyle = 'rgba(220,245,200,0.95)';
  g.beginPath();
  g.ellipse(Math.round(px), Math.round(gy - 3), 3, 3.6, 0, 0, TAU);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.fillRect(Math.round(px - 1), Math.round(gy - 5), 1, 1);
  return true;
});

/** Линия удара от точки: общая для разряда и луча. */
function lineShape(g: CanvasRenderingContext2D, st: Strike, px: number, py: number, S: number) {
  const L = st.r * S;
  const a = st.ang ?? 0;
  return { x1: px + Math.cos(a) * L, y1: py + Math.sin(a) * L, L, a };
}

/** Разряд нерва: дрожащая фиолетовая нить, к удару — ломаная молния. */
registerZonePainter('f15_zap', (g, z, px, py, S, time) => {
  const st = z as Strike;
  const k = clamp01(st.t / Math.max(0.01, st.warn));
  const { L, a } = lineShape(g, st, px, py, S);
  const n = Math.max(3, Math.round(L / 6));
  const nx = -Math.sin(a);
  const ny = Math.cos(a);
  g.strokeStyle = `rgba(200,120,255,${0.25 + 0.55 * k})`;
  g.lineWidth = k > 0.8 ? 2 : 1;
  g.beginPath();
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const j = i === 0 || i === n ? 0 : (hash(i, Math.floor(time * 20), 541) - 0.5) * (2 + k * 6);
    const x = px + Math.cos(a) * L * t + nx * j;
    const y = py + Math.sin(a) * L * t + ny * j;
    if (i) g.lineTo(x, y);
    else g.moveTo(x, y);
  }
  g.stroke();
  if (k > 0.8) {
    g.strokeStyle = 'rgba(255,240,255,0.8)';
    g.lineWidth = 1;
    g.stroke();
  }
  return true;
});

/** Луч смотрителя: тонкая наводка краснеет и толстеет к выстрелу. */
registerZonePainter('f15_beam', (g, z, px, py, S, time) => {
  const st = z as Strike;
  const k = clamp01(st.t / Math.max(0.01, st.warn));
  const { x1, y1 } = lineShape(g, st, px, py - 10, S);
  const flick = 0.75 + 0.25 * Math.sin(time * 40);
  g.lineCap = 'round';
  g.strokeStyle = `rgba(255,${Math.round(200 - 160 * k)},60,${(0.2 + 0.5 * k) * flick})`;
  g.lineWidth = 1 + k * 4;
  g.beginPath();
  g.moveTo(px, py - 10);
  g.lineTo(x1, y1 + 10);
  g.stroke();
  if (k > 0.7) {
    g.strokeStyle = `rgba(255,250,220,${(k - 0.7) * 3})`;
    g.lineWidth = 1;
    g.stroke();
  }
  g.lineCap = 'butt';
  return true;
});

// ---------------------------------------------------------------------------
// Снаряды: плевок желчи (подражатель-саламандра), ком мокроты (миндалина).
// ---------------------------------------------------------------------------

function glob(key: string, G: Tones) {
  return (_s: Shot, time: number): Sprite | null => {
    const f = Math.floor(time * 10) % 3;
    return sprite(`${key}|${f}`, () => {
      const p = new Px(10, 10);
      shadeEll(p, 5, 5, 3.2 + (f === 1 ? 0.4 : 0), 3.2 - (f === 1 ? 0.4 : 0), G);
      p.set(3, 3, WHITE);
      p.set(7 - f, 8, alpha(G[3], 0.8));
      p.outline(alpha(INK, 0.9));
      return { p, ax: 5, ay: 8 };
    });
  };
}
registerShotPainter('f15_spit', glob('spit', tn('#3a3a08', '#8a8a14', '#cad040', '#f8ffa0')));
registerShotPainter('f15_phlegm', glob('phl', tn('#5a6a4a', '#a0b890', '#d8ecc8', '#ffffff')));

// ---------------------------------------------------------------------------
// Вещи: мясо и материалы «Мира» (10×10).
// ---------------------------------------------------------------------------

registerItemArt('f15_offal', () => {
  const p = new Px(10, 10);
  const O = tn('#5a2a2a', '#9a5a5a', '#c89090', '#f0c8c0');
  const pts = spline(
    [
      [2, 7],
      [2, 3],
      [5, 2],
      [7, 4],
      [5, 6],
      [8, 8],
    ],
    4,
  );
  for (const [x, y] of pts) shadeEll(p, x, y, 1.4, 1.4, O);
  p.outline(INK);
  return p;
});

registerItemArt('f15_heartlet', () => {
  const p = new Px(10, 10);
  const H = tn('#4a0610', '#8a1222', '#d0344a', '#ff9aa8');
  shadeEll(p, 3.6, 4, 2.2, 2.2, H, 0.1);
  shadeEll(p, 6.4, 4, 2.2, 2.2, H);
  poly(p, [
    [1.4, 4.5],
    [8.6, 4.5],
    [5, 9],
  ], H[1]);
  p.set(3, 3, hx('#ffd0d8'));
  p.outline(INK);
  return p;
});

registerItemArt('f15_tissue', () => {
  const p = new Px(10, 10);
  polyShade(p, [
    [1, 7],
    [2, 2],
    [8, 1],
    [9, 7],
    [5, 9],
  ], PAL.throat.rim);
  stroke(p, 2, 6, 8, 3, hx('#d82e64'));
  p.set(4, 3, hx('#f0c0c8'));
  p.outline(INK);
  return p;
});

registerItemArt('f15_lymph', () => {
  const p = new Px(10, 10);
  const L = tn('#5a6a2a', '#a0b050', '#d8e490', '#fbffe0');
  poly(p, [
    [5, 1],
    [8, 6],
    [2, 6],
  ], L[2]);
  shadeEll(p, 5, 6.5, 3, 2.6, L);
  p.set(4, 5, WHITE);
  p.outline(INK);
  return p;
});

registerItemArt('f15_bile', () => {
  const p = new Px(10, 10);
  const B = tn('#3a3a08', '#7a8414', '#bcc838', '#f4ff9a');
  poly(p, [
    [5, 0.5],
    [8, 6],
    [2, 6],
  ], B[2]);
  shadeEll(p, 5, 6.5, 3, 2.6, B);
  p.set(4, 5, WHITE);
  p.outline(INK);
  return p;
});

registerItemArt('f15_nerve', () => {
  const p = new Px(10, 10);
  const N = tn('#3a0a5a', '#7a2ac0', '#c070ff', '#f4dcff');
  const pts = spline(
    [
      [1, 8],
      [3, 3],
      [6, 7],
      [8, 2],
    ],
    5,
  );
  for (const [x, y] of pts) shadeEll(p, x, y, 1.1, 1.1, N, 0.1);
  p.set(8, 2, WHITE);
  p.outline(INK);
  return p;
});

registerItemArt('f15_lens', () => {
  const p = new Px(10, 10);
  shadeEll(p, 5, 5, 4, 4, tn('#6a7a8a', '#b0c4d4', '#e0f0f8', '#ffffff'));
  p.ell(5, 5, 2.2, 2.2, hx('#d8a020'));
  p.ell(5, 5, 1, 1, INK);
  p.set(3, 3, WHITE);
  p.outline(INK);
  return p;
});

registerItemArt('f15_plasma', () => {
  const p = new Px(10, 10);
  shadeEll(p, 5, 5, 3.8, 3.6, tn('#3a0410', '#7a0a1e', '#c82838', '#ff9aa4'));
  p.ell(6, 6, 1.2, 1, alpha(hx('#ffe0a0'), 0.7));
  p.set(3, 3, WHITE);
  p.outline(INK);
  return p;
});

registerItemArt('f15_mold', () => {
  const p = new Px(10, 10);
  // Слепок: маска из плоти с пустыми глазницами.
  shadeEll(p, 5, 5, 4, 4.4, tn('#6a3a3a', '#b07a70', '#dcaca0', '#f8dcd0'));
  p.ell(3.4, 4.4, 1, 1.2, INK);
  p.ell(6.6, 4.4, 1, 1.2, INK);
  stroke(p, 3.5, 7.2, 6.5, 7.2, hx('#5a1a1a'));
  p.set(3, 4, hx('#e0ff60'));
  p.outline(INK);
  return p;
});
