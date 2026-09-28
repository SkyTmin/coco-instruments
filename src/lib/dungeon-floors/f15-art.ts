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
import { F15_GUT, F15_MARK, F15_THROAT, F15_VEINS } from './f15';
import { BREATH, f15View, GUT_VALVE, LEAFLET } from './f15-brains';
import type { Live } from './f15-brains';

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
  /** Пол: четыре тона плоти. */
  floor: Tones;
  /** Борозды между «булыжниками» слизистой. */
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
}

const PAL: Record<Style, Pal> = {
  throat: {
    floor: tn('#3a1822', '#5a2634', '#7a3a4a', '#a45c6a'),
    groove: hx('#200a10'),
    wet: hx('#e8b4c0'),
    top: hx('#12060a'),
    topHi: hx('#200c12'),
    rim: tn('#3a141e', '#6a2a38', '#94485a', '#c87888'),
    face: tn('#2e0c14', '#4e1620', '#72242e', '#9a4048'),
    vein: hx('#e0306a'),
    veinHi: hx('#ffb0cc'),
    veinDark: hx('#5a0c26'),
    band: tn('#6a5a50', '#9a8a78', '#c4b49c', '#ece0c8'),
  },
  gut: {
    floor: tn('#3a1810', '#5a2818', '#7a3c24', '#a46040'),
    groove: hx('#1e0a06'),
    wet: hx('#f0c898'),
    top: hx('#120806'),
    topHi: hx('#221008'),
    rim: tn('#3a1a10', '#6a3420', '#946040', '#c8906a'),
    face: tn('#2a0e0a', '#4a1a12', '#6a2a1c', '#904430'),
    vein: hx('#e0402a'),
    veinHi: hx('#ffc0a0'),
    veinDark: hx('#5a140c'),
    band: tn('#7a5a24', '#a88438', '#d4b060', '#f4dc98'),
  },
  veins: {
    floor: tn('#2a0610', '#480c1c', '#6a1628', '#962a40'),
    groove: hx('#16020a'),
    wet: hx('#ffa0b4'),
    top: hx('#0e0206'),
    topHi: hx('#1c040c'),
    rim: tn('#380a16', '#641426', '#90263c', '#c45468'),
    face: tn('#260610', '#420a18', '#641224', '#8a2236'),
    vein: hx('#ff2440'),
    veinHi: hx('#ffc0c8'),
    veinDark: hx('#600410'),
    band: tn('#8a4a5a', '#b87888', '#dca8b4', '#f8dce0'),
  },
};

const styleOf = (area: string): Style => (area === F15_GUT ? 'gut' : area === F15_VEINS ? 'veins' : 'throat');

// ---------------------------------------------------------------------------
// Большие бесшовные текстуры района (считаются один раз).
// ---------------------------------------------------------------------------

const TEX = 256;

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

/**
 * Слизистая: округлые подушечки (Вороной) разделены влажными бороздами,
 * у каждой — свет сверху-слева и блик; крупные пятна тона — шумом.
 */
function mucosaTex(style: Style): Tex {
  return tex(`mucosa|${style}`, TEX, TEX, (t) => {
    const P = PAL[style];
    const cellSz = style === 'veins' ? 11 : style === 'gut' ? 9 : 7;
    for (let y = 0; y < TEX; y++)
      for (let x = 0; x < TEX; x++) {
        // Вороной с лёгким сдвигом по шуму: подушечки не круглые.
        const wx = x + (tnoise(x, y, 16, TEX, 3) - 0.5) * 6;
        const wy = y + (tnoise(x, y, 16, TEX, 4) - 0.5) * 6;
        const [d1, d2, id] = voro(wx, wy, cellSz, TEX, style.length * 17 + 1);
        const edge = d2 - d1;
        const big = tnoise(x, y, 48, TEX, 9);
        // Высота подушечки: 1 в середине, 0 на борозде.
        const hgt = clamp01(edge / (cellSz * 0.42));
        // Свет по склону: производная высоты — через соседей не считаем,
        // берём направление к центру ячейки.
        const n = hash(id, 3, 5);
        let l = 0.18 + hgt * 0.55 + (big - 0.5) * 0.45 + (n - 0.5) * 0.18;
        // Верх-лево светлее у каждой подушечки.
        const [dd1] = voro(wx + 1.3, wy + 1.3, cellSz, TEX, style.length * 17 + 1);
        if (dd1 < d1 - 0.35) l -= 0.18;
        else if (dd1 > d1 + 0.35) l += 0.12;
        let c = tone(P.floor, l);
        if (edge < 1.1) c = mixc(P.groove, c, edge * 0.35);
        // Влажный блик: редкие точки на макушках подушечек.
        if (hgt > 0.85 && hash(x, y, 11) > 0.93 && big > 0.35) c = mixc(c, P.wet, 0.55);
        t.put(x, y, c);
      }
  });
}

/** Складки желудка: извилистые валики с глубокими бороздами. */
function rugaeTex(): Tex {
  return tex('rugae', TEX, TEX, (t) => {
    const P = PAL.gut;
    for (let y = 0; y < TEX; y++)
      for (let x = 0; x < TEX; x++) {
        const wx = x + (tnoise(x, y, 32, TEX, 21) - 0.5) * 26;
        const wy = y + (tnoise(x, y, 24, TEX, 22) - 0.5) * 10;
        const s = Math.sin((wy / TEX) * TAU * 18 + Math.sin((wx / TEX) * TAU * 3) * 1.4);
        const ridge = (s + 1) / 2;
        const sl = Math.cos((wy / TEX) * TAU * 18 + Math.sin((wx / TEX) * TAU * 3) * 1.4);
        let l = 0.1 + ridge * 0.7 - sl * 0.25 + (tnoise(x, y, 40, TEX, 23) - 0.5) * 0.35;
        if (ridge < 0.12) l = -0.1;
        let c = tone(P.floor, l);
        if (ridge > 0.9 && hash(x, y, 24) > 0.9) c = mixc(c, P.wet, 0.5);
        t.put(x, y, c);
      }
  });
}

/** Стенка сосуда: гладкая, с продольными прожилками и бликом. */
function vesselTex(): Tex {
  return tex('vessel', TEX, TEX, (t) => {
    const P = PAL.veins;
    for (let y = 0; y < TEX; y++)
      for (let x = 0; x < TEX; x++) {
        const wx = x + (tnoise(x, y, 40, TEX, 31) - 0.5) * 18;
        const streak = tnoise(wx, y * 0.25, 6, TEX, 32);
        const big = tnoise(x, y, 64, TEX, 33);
        let l = 0.25 + (streak - 0.5) * 0.5 + (big - 0.5) * 0.55;
        const [d1, d2] = voro(x, y, 22, TEX, 34);
        if (d2 - d1 < 1.2) l -= 0.25;
        let c = tone(P.floor, l);
        if (streak > 0.78 && big > 0.5) c = mixc(c, P.wet, 0.3);
        t.put(x, y, c);
      }
  });
}

/** Масса стены сверху: тёмная плоть в складках. */
function wallTopTex(style: Style): Tex {
  return tex(`top|${style}`, 128, 128, (t) => {
    const P = PAL[style];
    for (let y = 0; y < 128; y++)
      for (let x = 0; x < 128; x++) {
        const n = tnoise(x, y, 12, 128, 41) * 0.6 + tnoise(x, y, 5, 128, 42) * 0.4;
        const [d1, d2] = voro(x, y, 14, 128, 43);
        let c = n > 0.62 ? P.topHi : P.top;
        if (d2 - d1 < 1) c = mixc(P.top, hx('#000000'), 0.4);
        t.put(x, y, c);
      }
  });
}

/**
 * Лицо стены: мышечные волокна сверху вниз, поперечные складки; у Горла —
 * хрящевые кольца, у Чрева — жировые узлы, у Сосудов — полосы эластики.
 * Высота — одна клетка (16), по ширине бесшовно.
 */
function faceTex(style: Style): Tex {
  return tex(`face|${style}`, TEX, 16, (t) => {
    const P = PAL[style];
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < TEX; x++) {
        const fib = tnoise(x * 1.0, y * 0.18, 3, TEX, 51);
        const big = tnoise(x, 0, 28, TEX, 52);
        // Выпуклость лица: свет сверху, тень у пола.
        const k = y / 15;
        let l = 0.62 - k * 0.55 + (fib - 0.5) * 0.5 + (big - 0.5) * 0.25;
        if (y <= 1) l += 0.2;
        let c = tone(P.face, l);
        // Тёмные борозды между пучками волокон.
        if (fib < 0.22) c = mixc(c, P.groove, 0.6);
        // Особый слой.
        if (style === 'throat') {
          // Хрящевые кольца: светлые полосы поперёк, выпуклые.
          const ringY = [4, 10];
          for (const ry of ringY)
            if (y === ry || y === ry + 1) {
              const lr = y === ry ? 0.8 : 0.45;
              const gap = tnoise(x, ry, 9, TEX, 53) < 0.25;
              if (!gap) c = tone(P.band, lr + (fib - 0.5) * 0.3);
            } else if (y === ry + 2 && tnoise(x, ry, 9, TEX, 53) >= 0.25) c = mixc(c, P.groove, 0.5);
        } else if (style === 'gut') {
          // Жировые узлы по верху лица.
          const blob = tnoise(x, y, 5, TEX, 54);
          if (y < 7 && blob > 0.58) c = tone(P.band, 0.3 + (blob - 0.58) * 3 - k);
        } else {
          // Эластика: тонкие светлые полосы по длине.
          if ((y === 3 || y === 8 || y === 12) && tnoise(x, y, 7, TEX, 55) > 0.35)
            c = mixc(c, P.band[1], 0.55);
        }
        t.put(x, y, c);
      }
  });
}

/** Желудочный сок: жёлто-зелёный, с разводами и пузырями. */
function acidTex(): Tex {
  return tex('acid', 128, 128, (t) => {
    const A = tn('#2a3a08', '#4a6a10', '#7a9a1c', '#c4e040');
    for (let y = 0; y < 128; y++)
      for (let x = 0; x < 128; x++) {
        const wx = x + (tnoise(x, y, 20, 128, 61) - 0.5) * 20;
        const wy = y + (tnoise(x, y, 20, 128, 62) - 0.5) * 20;
        const n = tnoise(wx, wy, 10, 128, 63);
        let c = tone(A, 0.1 + n * 0.7);
        const [d1] = voro(x, y, 9, 128, 64, 0.9);
        const bub = hash(Math.floor(x / 9), Math.floor(y / 9), 65) > 0.72;
        if (bub && d1 < 1.6) c = A[3];
        else if (bub && d1 < 2.4) c = mixc(c, A[0], 0.6);
        t.put(x, y, c);
      }
  });
}

/** Кровь русла: тёмная, струи вдоль течения (вверх — к сердцу). */
function bloodTex(): Tex {
  return tex('blood', 128, 128, (t) => {
    const B = tn('#1c0206', '#3a040c', '#6a0a18', '#b01828');
    for (let y = 0; y < 128; y++)
      for (let x = 0; x < 128; x++) {
        const wx = x + (tnoise(x, y, 24, 128, 71) - 0.5) * 10;
        const n = tnoise(wx, y * 0.3, 5, 128, 72);
        const big = tnoise(x, y, 32, 128, 73);
        let c = tone(B, 0.05 + n * 0.55 + (big - 0.5) * 0.3);
        if (n > 0.8) c = mixc(c, hx('#e04050'), 0.5);
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

/** Вена по полу: светящаяся жила к соседним венам. */
function veinOver(p: Px, c: CellCtx, P: Pal, node = false): void {
  const isV = (dx: number, dy: number) => {
    const k = c.markAt(dx, dy);
    return k === M.vein || k === M.node;
  };
  const dirs: [number, number][] = [];
  if (isV(0, -1)) dirs.push([0, -1]);
  if (isV(0, 1)) dirs.push([0, 1]);
  if (isV(-1, 0)) dirs.push([-1, 0]);
  if (isV(1, 0)) dirs.push([1, 0]);
  if (!dirs.length) dirs.push([0, -1], [0, 1]);
  const wob = (t: number) => Math.round(Math.sin(t * 0.7 + c.wx * 1.3 + c.wy * 0.9) * 1.2);
  for (const [dx, dy] of dirs) {
    for (let s = 0; s <= 8; s++) {
      const x = dx ? 8 + dx * s : 7 + wob(s + c.wy * 16);
      const y = dy ? 8 + dy * s : 7 + wob(s + c.wx * 16);
      p.set(x - 1, y, P.veinDark);
      p.set(x + 1, y + 1, P.veinDark);
      p.set(x, y, P.vein);
      p.set(x, y + 1, mixc(P.vein, P.veinDark, 0.5));
      if (s % 3 === 1) p.set(x, y, P.veinHi);
    }
  }
  if (node) {
    // Узел — утолщение (светится предметом поверх).
    p.ell(8, 8, 3.2, 2.8, P.veinDark);
    p.ell(8, 7.6, 2.2, 1.8, P.vein);
    p.set(7, 7, P.veinHi);
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
  const edge = kind === 'acid' ? hx('#e8f870') : hx('#ff5a6a');
  const dark = kind === 'acid' ? hx('#1a2404') : hx('#0e0104');
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

/** Хрящевое кольцо поперёк хода: светлый выпуклый валик. */
function ringOver(p: Px, c: CellCtx, P: Pal): void {
  const B = P.band;
  for (let x = 0; x < 16; x++) {
    const w = Math.round(Math.sin((c.wx * 16 + x) * 0.3) * 0.5);
    p.set(x, 5 + w, B[3]);
    p.set(x, 6 + w, B[2]);
    p.set(x, 7 + w, B[2]);
    p.set(x, 8 + w, B[1]);
    p.set(x, 9 + w, B[0]);
    p.set(x, 10 + w, alpha(INK, 0.55));
    if (hash(c.wx * 16 + x, c.wy, 91) > 0.86) p.set(x, 6 + w, P.wet);
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
  return p;
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
        if (st === 'veins')
          puddleOver(p, c, (m) => m >= M.flowN && m <= M.flowE, hx('#6a0a18'), hx('#e0304a'), 0.7);
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
        litterOver(p, c, 'scar', st);
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

// Потом: живые предметы, монстры, зоны (ниже).
void mixc;
void rgba;
void clamp01;
void limb;
void BREATH;
void GUT_VALVE;
void LEAFLET;
void f15View;
void paintSim;
void MOB_PAINTERS;
void registerItemArt;
void registerMobPainter;
void registerPropPainter;
void registerShotPainter;
void registerZonePainter;
void frameOf;
void flashed;
void zoneImg;
export type { Built, Live, Mob, Shot, Strike, Zone };
