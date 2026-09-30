// Этаж 6 «Огненный разлом» — рисовальщики: монстры, реквизит, свои клетки
// трёх районов, метки ударов, тело Красного змея, иконки вещей.
//
// Часть монстров — чужие спрайты: огненный дух, пепельный летун и
// жук-огнёвка — из Ninja Adventure (CC0), перекрашенные по ролям в палитру
// этажа (`scripts/dungeon/f6-sheet.py` → `public/dungeon/f6/f6-sheet.png`);
// бесёнок — кадры атласа 0x72 (CC0) с мешком. Остальное рисует код: пиксели
// 16 на клетку, свет сверху-слева, контур тёмный. Все кадры собираются один
// раз и лежат в кеше; лист грузится асинхронно — пока его нет, рисовальщик
// возвращает null (движок рисует запасной вид).

import { Px } from '../dungeon-art';
import {
  frameLRU,
  paintSim,
  registerCellPainter,
  registerItemArt,
  registerMobPainter,
  registerMobWarm,
  registerPropPainter,
  registerShotPainter,
  registerZonePainter,
} from '../dungeon-paint';
import type { CellCtx, MobFrame, MobPose, Sprite } from '../dungeon-paint';
import type { Mob, Shot, Strike, Zone } from '../dungeon-sim';
import { x72 } from '../dungeon-tiles';
import type { X72Name } from '../dungeon-x72-frames';
import { F6_GALLERY, F6_LAKES, F6_MARK, F6_NEST } from './f6';
import { GOLEM, serpentView, WISP } from './f6-brains';

type RGBA = [number, number, number, number];

export const hx = (h: string, a = 255): RGBA => {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255, a];
};
const mixc = (a: RGBA, b: RGBA, k: number): RGBA => [
  Math.round(a[0] + (b[0] - a[0]) * k),
  Math.round(a[1] + (b[1] - a[1]) * k),
  Math.round(a[2] + (b[2] - a[2]) * k),
  Math.round(a[3] + (b[3] - a[3]) * k),
];
const alpha = (c: RGBA, a: number): RGBA => [c[0], c[1], c[2], Math.round(a * 255)];
export const rgba = (c: RGBA, a: number) =>
  `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a)).toFixed(3)})`;

const INK = hx('#150f0b');
const WHITE = hx('#ffffff');
const GOLD = hx('#ffcc40');
export const TAU = Math.PI * 2;

/** Четыре тона формы: тень, основа, свет, блик. */
type Tones = [RGBA, RGBA, RGBA, RGBA];

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

/** Конечность: сужающаяся «капсула» от (x0, y0) до (x1, y1) со светом по нормали. */
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
      if (!inside) continue;
      const col = typeof c === 'function' ? c(x, y) : c;
      // Прозрачный цвет — вырез (фестоны крыла, сколы).
      if (col[3] === 0) clear(p, x, y);
      else p.set(x, y, col);
    }
}

/** Толстая линия. */
export function stroke(p: Px, x0: number, y0: number, x1: number, y1: number, c: RGBA, w = 1): void {
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
        0.5 *
        (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Стереть пиксель (скол, дыра). */
function clear(p: Px, x: number, y: number): void {
  if (x < 0 || y < 0 || x >= p.w || y >= p.h) return;
  p.data[(y * p.w + x) * 4 + 3] = 0;
}

/** Детерминированный шум по трём числам, 0…1. */
export const hash = (a: number, b: number, c = 0) => {
  let h = (a * 374761393 + b * 668265263 + c * 1274126177) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** Сглаженный шум 0…1 по клеткам размера s. */
function noise(x: number, y: number, s: number, seed: number): number {
  const xi = Math.floor(x / s);
  const yi = Math.floor(y / s);
  const fx = x / s - xi;
  const fy = y / s - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi, seed) * (1 - u) + hash(xi + 1, yi, seed) * u;
  const b = hash(xi, yi + 1, seed) * (1 - u) + hash(xi + 1, yi + 1, seed) * u;
  return a * (1 - v) + b * v;
}

// Огонь, лава, пепел, базальт — палитра этажа.
export const FIRE: Tones = [hx('#a8260c'), hx('#ff6a1a'), hx('#ffb030'), hx('#fff2a0')];
const LAVA = {
  deep: hx('#6a1206'),
  dark: hx('#a8240a'),
  mid: hx('#e2480e'),
  hot: hx('#ff8a1e'),
  bright: hx('#ffc440'),
  white: hx('#fff4b0'),
  crust: hx('#2a1210'),
  crustLt: hx('#4a2018'),
};
export const BASALT: Tones = [hx('#1c1618'), hx('#2e2628'), hx('#4a3e3e'), hx('#6e5e5a')];
const OBSID: Tones = [hx('#0e0a12'), hx('#1e1826'), hx('#3a3050'), hx('#8a7cb8')];
const ASH = { dk: hx('#3a3432'), mid: hx('#4e4744'), lt: hx('#6a625c'), hi: hx('#8a8078') };
export const BONE: Tones = [hx('#6a5e50'), hx('#a8987e'), hx('#d4c8ae'), hx('#f2ead4')];

/** Сколько летун «висит» над полом у движка: кадр опускаем на столько же. */
const FLY = 6;

// ---------------------------------------------------------------------------
// Кадр монстра: общий конвейер (облик, вспышка, отражение, кеш).
// ---------------------------------------------------------------------------

type Look = MobPose['look'];

interface Built {
  p: Px;
  /** Середина тела и земля в кадре (смотрит вправо). */
  ax: number;
  ay: number;
  eye: [number, number] | null;
}

const frames = new Map<string, MobFrame>();

function pale(p: Px): Px {
  const tint = hx('#f4ece4');
  const q = new Px(p.w, p.h);
  for (let i = 0; i < p.data.length; i += 4) {
    if (!p.data[i + 3]) continue;
    const l = (p.data[i] + p.data[i + 1] + p.data[i + 2]) / 3;
    const c = mixc([l, l, l, 255], tint, 0.45);
    q.data[i] = c[0];
    q.data[i + 1] = c[1];
    q.data[i + 2] = c[2];
    q.data[i + 3] = p.data[i + 3];
  }
  return q;
}

/** Альбинос — белёсый, элита — золотой кант, удар — белым; смотрит влево — отражение. */
function finish(
  key: string,
  b: Built,
  look: Look,
  flash: boolean,
  left: boolean,
  flip = true,
): MobFrame {
  let p = b.p;
  if (look === 'albino') p = pale(p);
  if (look === 'elite') p.outline(GOLD);
  if (flash) p = p.tint(WHITE, 0.85);
  const mirror = left && flip;
  if (mirror) p = p.flipX();
  const eye = b.eye
    ? ([mirror ? p.w - 1 - b.eye[0] : b.eye[0], b.eye[1]] as [number, number])
    : null;
  const out: MobFrame = { img: p.canvas(), ax: mirror ? p.w - b.ax : b.ax, ay: b.ay, eye };
  frames.set(key, out);
  return out;
}

function frameOf(
  kind: string,
  pose: MobPose,
  anim: string,
  f: number,
  build: () => Built,
): MobFrame {
  const key = `${kind}|${anim}|${f}|${pose.left ? 1 : 0}|${pose.flash ? 1 : 0}|${pose.look}`;
  return frames.get(key) ?? finish(key, build(), pose.look, pose.flash, pose.left);
}

/** Кадр со стороной из листа: четыре стороны, отражать не нужно. */
function frameDir(
  kind: string,
  pose: MobPose,
  anim: string,
  dir: number,
  f: number,
  build: () => Built | null,
): MobFrame | null {
  const key = `${kind}|${anim}|${dir}|${f}|${pose.flash ? 1 : 0}|${pose.look}`;
  const hit = frames.get(key);
  if (hit) return hit;
  const b = build();
  return b ? finish(key, b, pose.look, pose.flash, false, false) : null;
}

/** Звёздочки над головой оглушённого (кадр f из 4). */
function stars(p: Px, cx: number, cy: number, rx: number, f: number): void {
  const c1 = hx('#fff27a');
  const c2 = hx('#ffffff');
  for (let i = 0; i < 3; i++) {
    const a = (f / 4) * TAU + (i / 3) * TAU;
    const x = Math.round(cx + Math.cos(a) * rx);
    const y = Math.round(cy + Math.sin(a) * rx * 0.35);
    p.set(x, y, c2);
    p.set(x - 1, y, c1);
    p.set(x + 1, y, c1);
    p.set(x, y - 1, c1);
    p.set(x, y + 1, c1);
  }
}

/** Язычок пламени высотой h (кадр f) с основанием в (x, y). */
function flame(p: Px, x: number, y: number, h: number, f: number, w = 2.2): void {
  const sway = [0, 1, 0, -1][((f % 4) + 4) % 4];
  for (let i = 0; i < h; i++) {
    const k = i / h;
    const ww = (1 - k) * w + 0.4;
    const cx = x + sway * k * 1.2;
    for (let dx = -Math.ceil(ww); dx <= Math.ceil(ww); dx++) {
      if (Math.abs(dx) > ww) continue;
      const core = Math.abs(dx) / ww;
      const c =
        k > 0.8 ? FIRE[1] : core < 0.35 && k < 0.6 ? FIRE[3] : core < 0.7 ? FIRE[2] : FIRE[1];
      p.set(Math.round(cx + dx), y - i, c);
    }
  }
  if (f % 2) p.set(x + sway, y - h - 1, FIRE[1]);
}

/** Круги лавы по поверхности (для ныряльщиков): кольцо с ярким краем. */
function ripple(p: Px, cx: number, cy: number, rx: number, ry: number, f: number): void {
  const k = 1 + (f % 4) * 0.12;
  const R = rx * k;
  const Q = ry * k;
  for (let a = 0; a < TAU; a += 0.08) {
    const x = Math.round(cx + Math.cos(a) * R);
    const y = Math.round(cy + Math.sin(a) * Q);
    const front = Math.sin(a) > 0;
    p.set(x, y, front ? LAVA.bright : LAVA.hot);
    if (front) p.set(x, y + 1, alpha(LAVA.dark, 0.8));
  }
}

// ---------------------------------------------------------------------------
// Лист чужих спрайтов (Ninja Adventure, перекрашенный): дух, летун, жук.
// Грузится асинхронно; пока нет — рисовальщики отвечают null.
// ---------------------------------------------------------------------------

let sheet: ImageData | null = null;
let sheetLoading = false;

function loadSheet(): void {
  if (sheetLoading || typeof document === 'undefined') return;
  sheetLoading = true;
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d');
    if (!g) return;
    g.drawImage(img, 0, 0);
    sheet = g.getImageData(0, 0, img.width, img.height);
  };
  img.onerror = () => {
    sheetLoading = false;
  };
  img.src = `${import.meta.env.BASE_URL}dungeon/f6/f6-sheet.png`;
}

/** Кадр листа: монстр `k` (0 — дух, 1 — летун, 2 — жук), сторона, кадр шага. */
function sheetPx(k: number, dir: number, f: number): Px | null {
  loadSheet();
  if (!sheet) return null;
  const p = new Px(16, 16);
  const sx = k * 64 + dir * 16;
  const sy = (((f % 4) + 4) % 4) * 16;
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const i = ((sy + y) * sheet.width + sx + x) * 4;
      const d = sheet.data;
      if (!d[i + 3]) continue;
      p.set(x, y, [d[i], d[i + 1], d[i + 2], d[i + 3]]);
    }
  return p;
}

/** Сторона листа по взгляду: 0 — вниз, 1 — вверх, 2 — влево, 3 — вправо. */
function dir4(face: number): number {
  const c = Math.cos(face);
  const s = Math.sin(face);
  if (Math.abs(c) >= Math.abs(s) * 0.9) return c < 0 ? 2 : 3;
  return s > 0 ? 0 : 1;
}

/** Вставить кадр в больший холст (x, y — левый верх). */
function paste(dst: Px, src: Px, ox: number, oy: number): void {
  for (let y = 0; y < src.h; y++)
    for (let x = 0; x < src.w; x++) {
      const i = (y * src.w + x) * 4;
      if (!src.data[i + 3]) continue;
      dst.set(ox + x, oy + y, [src.data[i], src.data[i + 1], src.data[i + 2], src.data[i + 3]]);
    }
}

// ---------------------------------------------------------------------------
// Саламандра: ящерица лавы. 24×16, смотрит вправо, земля — y 14.
// Гребень на спине — язычки огня; брюхо жёлтое; на спине тлеют пятна.
// ---------------------------------------------------------------------------

const SAL = {
  skin: [hx('#2e0a0a'), hx('#6a1812'), hx('#a8301c'), hx('#e0603a')] as Tones,
  belly: [hx('#7a3a10'), hx('#c0702a'), hx('#e8a040'), hx('#ffd880')] as Tones,
  spot: hx('#ffb030'),
  eye: hx('#ffe24a'),
  mouth: hx('#3a0806'),
  glow: hx('#ff9a2a'),
};

interface SalPose {
  bx: number;
  by: number;
  brx: number;
  bry: number;
  hx: number;
  hy: number;
  jaw: number;
  /** Фаза хвоста (волна) и шага. */
  tail: number;
  step: number;
  /** Ноги поджаты (0) или идут (1). */
  gait: number;
  crouch: number;
  closed: boolean;
  frill: number;
  tongue: boolean;
  /** Тело вытянуто в прыжке. */
  leap: boolean;
}

function salPose(anim: string, f: number): SalPose {
  const b: SalPose = {
    bx: 10,
    by: 10.5,
    brx: 5.2,
    bry: 2.6,
    hx: 17,
    hy: 9,
    jaw: 0,
    tail: 0,
    step: 0,
    gait: 0,
    crouch: 0,
    closed: false,
    frill: f,
    tongue: false,
    leap: false,
  };
  switch (anim) {
    case 'idle':
      b.bry += f % 2 ? 0.3 : 0;
      b.hy += f === 1 ? -0.4 : 0;
      b.tongue = f === 2;
      b.tail = f * 0.4;
      break;
    case 'run':
      b.gait = 1;
      b.step = (f / 6) * TAU;
      b.tail = (f / 6) * TAU;
      b.by += f % 3 === 0 ? -0.3 : 0;
      b.hx += 0.5;
      break;
    case 'wind':
      b.crouch = 1.2;
      b.by += 0.8;
      b.hy += 0.4;
      b.hx -= 0.6;
      b.jaw = f ? 1 : 0.6;
      b.tail = f * 0.8;
      break;
    case 'bite':
      b.bx += 1.5;
      b.hx += 3;
      b.hy += 0.4;
      b.jaw = f ? 0.4 : 1;
      b.gait = 1;
      b.step = 1.2;
      break;
    case 'leap':
      b.leap = true;
      b.brx = 6;
      b.bry = 2.2;
      b.by -= 2;
      b.hx += 2;
      b.hy -= 2;
      b.jaw = 0.7;
      b.gait = 1;
      b.step = 2;
      break;
    case 'hurt':
      b.bx -= 1;
      b.hx -= 2;
      b.hy += 0.6;
      b.closed = true;
      b.jaw = 0.4;
      break;
    case 'dead':
      b.by += 1.2;
      b.bry = 2.2;
      b.hy += 3;
      b.hx -= 0.5;
      b.closed = true;
      b.crouch = 2;
      break;
  }
  return b;
}

function paintSal(sp: SalPose, anim: string): Built {
  const W = 26;
  const H = 18;
  const p = new Px(W, H);
  const G = 15;
  const { bx, by, brx, bry } = sp;
  // Хвост: волна за телом, сужается.
  const tailPts: [number, number][] = [];
  for (let i = 0; i <= 5; i++) {
    const k = i / 5;
    const x = bx - brx + 1.2 - k * 9.5;
    const y = by + 0.5 + Math.sin(sp.tail + k * 3.2) * (0.4 + k * 1.3) + (sp.leap ? -k * 1.5 : 0);
    tailPts.push([x, y]);
  }
  const tail = spline(tailPts, 3);
  for (let i = 0; i < tail.length - 1; i++) {
    const k = i / (tail.length - 1);
    const r0 = 2.1 * (1 - k) + 0.45;
    const r1 = 2.1 * (1 - (i + 1) / (tail.length - 1)) + 0.45;
    limb(p, tail[i][0], tail[i][1], tail[i + 1][0], tail[i + 1][1], r0, r1, SAL.skin);
  }
  // Лапы: дальние темнее, ближние поверх тела.
  const leg = (x0: number, far: boolean, ph: number) => {
    const sw = sp.gait ? Math.sin(sp.step + ph) : 0;
    const lift = sp.gait && Math.cos(sp.step + ph) > 0.3 ? 1 : 0;
    const kx = x0 + sw * 1.4 + (far ? 0.5 : 0);
    const fy = sp.leap ? by + 1.5 : G - lift - (far ? 0.4 : 0) - sp.crouch * 0.3;
    const knee: [number, number] = [x0 + (far ? 1.4 : 1.8), by + 1.2 - sp.crouch * 0.2];
    const bias = far ? -0.35 : 0;
    limb(p, x0, by + 0.4, knee[0], knee[1], 1.1, 0.9, SAL.skin, bias);
    limb(p, knee[0], knee[1], kx + (sp.leap ? -2 : 0.6), fy, 0.9, 0.7, SAL.skin, bias);
    // Пальцы.
    p.set(Math.round(kx + 1.4), Math.round(fy), far ? SAL.skin[0] : SAL.skin[1]);
  };
  leg(bx + brx * 0.55, true, Math.PI);
  leg(bx - brx * 0.55, true, 0);
  // Тело: спина — чешуя, брюхо — жёлтое.
  shadeEll(p, bx, by, brx, bry, SAL.skin);
  p.ell(bx + 0.6, by + bry * 0.7, brx * 0.7, bry * 0.32, (x, y) =>
    tone(SAL.belly, 0.55 - (y - by) * 0.18 - Math.abs(x - bx) * 0.04),
  );
  // Шея и голова.
  limb(p, bx + brx - 1.2, by - 0.4, sp.hx - 1.5, sp.hy + 0.4, 2.2, 1.8, SAL.skin);
  leg(bx + brx * 0.55, false, 0);
  leg(bx - brx * 0.55, false, Math.PI);
  shadeEll(p, sp.hx, sp.hy, 3, 2.2, SAL.skin);
  // Морда: верхняя челюсть вперёд, нижняя опускается.
  const jaw = sp.jaw;
  shadeEll(p, sp.hx + 2.4, sp.hy + 0.2 - jaw * 0.4, 2.3, 1.3, SAL.skin);
  if (jaw > 0.05) {
    // Пасть: тёмная, в глубине — жар.
    p.ell(sp.hx + 2.4, sp.hy + 1.5, 2 + jaw * 0.3, 0.6 + jaw * 0.8, SAL.mouth);
    p.set(Math.round(sp.hx + 1.8), Math.round(sp.hy + 1.6), SAL.glow);
    p.set(Math.round(sp.hx + 2.6), Math.round(sp.hy + 1.4 + jaw * 0.5), LAVA.bright);
    shadeEll(p, sp.hx + 2.1, sp.hy + 2 + jaw * 1.1, 2.2, 0.9, SAL.belly, -0.1);
  } else shadeEll(p, sp.hx + 1.8, sp.hy + 1.5, 2.2, 0.8, SAL.belly, -0.1);
  // Пятна на спине тлеют.
  for (const [ox, oy] of [
    [-2.5, -1.2],
    [0, -1.6],
    [2.4, -1.1],
    [-5, 0.2],
  ])
    p.set(Math.round(bx + ox), Math.round(by + oy), SAL.spot);
  p.outline(INK);
  // Гребень: язычки огня вдоль хребта (без контура — светятся сами).
  const f = sp.frill;
  const crest: [number, number][] = [
    [sp.hx - 1.4, sp.hy - 2],
    [bx + 3.5, by - bry - 0.1],
    [bx + 1, by - bry - 0.3],
    [bx - 1.6, by - bry - 0.2],
    [bx - 4, by - bry + 0.4],
  ];
  crest.forEach(([x, y], i) => {
    // Гребень невысокий: главное в силуэте — ящерица, а не костёр.
    const h = [1, 2, 2, 2, 1][i] + ((f + i) % 2);
    if (i === 0 || (anim === 'dead' && i % 2)) return;
    flame(p, Math.round(x), Math.round(y), anim === 'dead' ? 1 : h, f + i, 0.8);
  });
  // Раскалённая полоса по хребту — видна и на тёмной коже.
  for (let k = -4; k <= 3; k++) {
    const x = Math.round(bx + k);
    const y = Math.round(by - bry + 0.8 + Math.abs(k) * 0.08);
    if (p.solid(x, y) && (k + f) % 3 === 0) p.set(x, y, SAL.spot);
  }
  // Язык.
  if (sp.tongue) {
    p.set(Math.round(sp.hx + 4.8), Math.round(sp.hy + 0.9), hx('#ff4a6a'));
    p.set(Math.round(sp.hx + 5.8), Math.round(sp.hy + 0.5), hx('#ff4a6a'));
    p.set(Math.round(sp.hx + 5.8), Math.round(sp.hy + 1.3), hx('#ff4a6a'));
  }
  // Глаз: жёлтый с вертикальным зрачком.
  const ex = Math.round(sp.hx + 0.6);
  const ey = Math.round(sp.hy - 0.8);
  if (sp.closed) {
    p.set(ex, ey, INK);
    p.set(ex + 1, ey, INK);
  } else {
    // Глаз 2×2: жёлтый, зрачок — щель, над ним тёмная надбровная дуга.
    p.set(ex, ey, SAL.eye);
    p.set(ex + 1, ey, INK);
    p.set(ex, ey - 1, SAL.eye);
    p.set(ex + 1, ey - 1, hx('#fff6c0'));
    p.set(ex - 1, ey - 2, SAL.skin[0]);
    p.set(ex, ey - 2, SAL.skin[0]);
    p.set(ex + 1, ey - 2, SAL.skin[0]);
  }
  // Ноздря.
  p.set(Math.round(sp.hx + 4), Math.round(sp.hy - 0.3 - sp.jaw * 0.4), SAL.skin[0]);
  return { p, ax: Math.round(bx), ay: G + 1 - FLY, eye: sp.closed ? null : [ex, ey] };
}

/** Под лавой: над поверхностью — макушка, глаза и гребень, вокруг — круги. */
function paintSalSwim(f: number, half: number): Built {
  const p = new Px(26, 18);
  const cx = 13;
  const cy = 12;
  if (half > 0) {
    // Скользит в лаву / выныривает: видна спина до половины.
    shadeEll(p, cx - 1, cy - 1 * half, 5 * half + 1, 2 * half + 0.8, SAL.skin);
    shadeEll(p, cx + 4, cy - 1.4 * half, 2.4, 1.6, SAL.skin);
    p.outline(INK);
    for (let i = 0; i < 3; i++) flame(p, cx - 3 + i * 3, Math.round(cy - 2 * half - 0.5), 2, f + i, 1);
  } else {
    // Только глаза и гребень над лавой.
    shadeEll(p, cx + 2, cy - 0.3, 2.2, 1, SAL.skin);
    p.outline(INK);
    p.set(cx + 2, cy - 1, SAL.eye);
    p.set(cx + 3, cy - 1, INK);
    for (let i = 0; i < 3; i++) {
      const x = cx - 4 + i * 2;
      const h = 1 + ((f + i) % 3 === 0 ? 1 : 0);
      for (let k = 0; k < h; k++) p.set(x, cy - k, k ? FIRE[2] : FIRE[1]);
    }
  }
  ripple(p, cx, cy + 0.5, 6, 2, f);
  return { p, ax: cx, ay: 16 - FLY, eye: half > 0 ? null : [cx + 2, cy - 1] };
}

registerMobPainter('f6_salamander', (m: Mob, pose: MobPose) => {
  const mode = pose.mode;
  const t = pose.t;
  let anim: string = pose.anim;
  let f = ((pose.frame % 4) + 4) % 4;
  if (mode === 'f6_swim') {
    return frameOf('f6_salamander', pose, 'swim', f, () => paintSalSwim(f, 0));
  }
  if (mode === 'f6_slide') {
    const half = Math.max(0, 1 - t / 0.4);
    const k = Math.round(half * 3);
    return frameOf('f6_salamander', pose, `slide${k}`, f, () => paintSalSwim(f, k / 3));
  }
  if (mode === 'f6_rise') {
    const half = Math.max(0, Math.min(1, (t - 0.35) / 0.37));
    const k = Math.round(half * 3);
    return frameOf('f6_salamander', pose, `rise${k}`, f, () => paintSalSwim(f, k / 3));
  }
  if (mode === 'f6_leap' || mode === 'f6_lunge') {
    anim = 'leap';
    f = Math.floor(t * 12) % 2;
  } else if (mode === 'aim') {
    anim = 'wind';
    f = Math.floor(t * 8) % 2;
  } else if (anim === 'run') f = ((pose.frame % 6) + 6) % 6;
  else if (anim === 'wind' || anim === 'bite') f = Math.min(1, pose.frame);
  return frameOf('f6_salamander', pose, anim, f, () => paintSal(salPose(anim, f), anim));
});

// ---------------------------------------------------------------------------
// Огненный дух — «пламя» Ninja Adventure. Раздувание дорисовано: вокруг —
// венец языков, ядро белеет, к концу — искры и дрожь.
// ---------------------------------------------------------------------------

function paintWisp(dir: number, f: number, swell: number, anim: string): Built | null {
  const base = sheetPx(0, dir, f);
  if (!base) return null;
  const W = 30;
  const H = 30;
  const p = new Px(W, H);
  const ox = 7;
  const oy = 9;
  const cx = ox + 8;
  const cy = oy + 9;
  if (swell > 0) {
    // Венец языков вокруг: растёт с раздуванием, ядро белеет.
    const R = 5 + swell * 6.5;
    const n = 10;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + f * 0.25;
      const x = cx + Math.cos(a) * R * 0.8;
      const y = cy + Math.sin(a) * R * 0.62;
      const h = 2 + Math.round(swell * 4) + ((i + f) % 2);
      flame(p, Math.round(x), Math.round(y + h / 2), h, f + i, 1 + swell * 0.8);
    }
    p.ell(cx, cy, R * 0.7, R * 0.55, alpha(FIRE[1], 0.35 + swell * 0.3));
  }
  let body = base;
  if (swell > 0) body = base.tint(hx('#fff6c8'), 0.15 + swell * 0.55);
  if (anim === 'hurt') body = base.tint(hx('#ffffff'), 0.3);
  paste(p, body, ox + (swell > 0.66 ? (f % 2 ? 1 : -1) : 0), oy);
  if (swell > 0.5) {
    // Искры из раздутого пламени.
    for (let i = 0; i < 6; i++) {
      const a = hash(i, f, 7) * TAU;
      const r = 6 + swell * 7 + hash(i, f, 9) * 3;
      p.set(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r * 0.7), FIRE[3]);
    }
  }
  return { p, ax: cx, ay: oy + 16 - FLY + 1, eye: dir === 1 ? null : [cx - 2, cy - 2] };
}

registerMobPainter('f6_wisp', (m: Mob, pose: MobPose) => {
  const dir = dir4(m.face);
  const f = ((Math.floor(pose.t * 8) % 4) + 4) % 4;
  if (pose.mode === 'f6_swell') {
    const k = Math.min(3, Math.floor((pose.t / WISP.swell) * 4));
    return frameDir('f6_wisp', pose, `swell${k}`, dir, f, () => paintWisp(dir, f, (k + 1) / 4, 'swell'));
  }
  if (pose.mode === 'f6_rise') {
    const k = Math.min(3, Math.floor((pose.t / 0.6) * 4));
    return frameDir('f6_wisp', pose, `rise${k}`, dir, f, () => {
      const b = paintWisp(dir, f, 0, 'idle');
      if (!b) return null;
      // Поднимается из лавы: нижняя часть ещё в огне поверхности.
      const cut = 30 - Math.round(((k + 1) / 4) * 20);
      for (let y = Math.max(0, cut); y < b.p.h; y++) for (let x = 0; x < b.p.w; x++) clear(b.p, x, y);
      ripple(b.p, b.ax, Math.min(b.p.h - 2, cut), 5, 1.6, f);
      return b;
    });
  }
  const anim = pose.anim === 'hurt' ? 'hurt' : 'idle';
  return frameDir('f6_wisp', pose, anim, dir, f, () => paintWisp(dir, f, 0, anim));
});

// ---------------------------------------------------------------------------
// Пепельный летун — «птица» Ninja Adventure в пепле и углях. Пике — крылья
// сложены, за ним — полосы скорости и пепел; сел — крылья опущены.
// ---------------------------------------------------------------------------

function paintBat(dir: number, f: number, anim: string): Built | null {
  const base = sheetPx(1, dir, f);
  if (!base) return null;
  const p = new Px(26, 24);
  const ox = 5;
  const oy = 3;
  let body = base;
  if (anim === 'swoop') {
    // Крылья прижаты: сжимаем кадр по ширине к середине (сложены).
    const q = new Px(16, 16);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const sx = Math.round(8 + (x - 8) * 1.7);
        if (sx < 0 || sx > 15) continue;
        const c = base.get(sx, y);
        if (c[3]) q.set(x, y, c);
      }
    body = q;
    // Полосы скорости позади и угли.
    for (let i = 0; i < 4; i++) {
      const y = oy + 4 + i * 3;
      for (let k = 0; k < 4 + (i % 2) * 2; k++) p.set(ox + 1 - k, y, alpha(ASH.lt, 0.8 - k * 0.15));
    }
    p.set(ox + 2, oy + 14, FIRE[2]);
    p.set(ox - 1, oy + 10, FIRE[1]);
  }
  if (anim === 'perch') {
    // Сел: крылья опущены к земле, чуть ниже.
    const q = new Px(16, 16);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const c = base.get(x, y);
        if (!c[3]) continue;
        const wing = Math.abs(x - 7.5) > 3;
        q.set(x, Math.min(15, y + (wing ? 2 : 1)), c);
      }
    body = q;
  }
  paste(p, body, ox, oy);
  // Глаза — угольки.
  if (dir !== 1) {
    p.set(ox + 6, oy + 3, hx('#ffb040'));
    p.set(ox + 9, oy + 3, hx('#ffb040'));
  }
  const ay = anim === 'perch' ? oy + 17 : oy + 16 - FLY + 1;
  return { p, ax: ox + 8, ay, eye: dir === 1 ? null : [ox + 6, oy + 3] };
}

registerMobPainter('f6_ashbat', (m: Mob, pose: MobPose) => {
  const dir = dir4(m.face);
  const mode = pose.mode;
  if (mode === 'f6_swoop')
    return frameDir('f6_ashbat', pose, 'swoop', dir, 0, () => paintBat(dir, 0, 'swoop'));
  if (mode === 'f6_perch' || pose.anim === 'dead')
    return frameDir('f6_ashbat', pose, 'perch', dir, 2, () => paintBat(dir, 2, 'perch'));
  // Машет крыльями: чаще, когда целится.
  const fps = mode === 'aim' ? 16 : 9;
  const f = ((Math.floor(pose.t * fps + m.id) % 4) + 4) % 4;
  return frameDir('f6_ashbat', pose, 'fly', dir, f, () => paintBat(dir, f, 'fly'));
});

// ---------------------------------------------------------------------------
// Жук-огнёвка — «жук» Ninja Adventure: обугленный панцирь, раскалённые
// полосы; брюшко дышит светом, перед укусом разгорается.
// ---------------------------------------------------------------------------

/** Цвет тлеющих кромок панциря в листе (`f6-sheet.py`, роль «B»). */
const BEETLE_EMBER = hx('#7a2a16');

function paintBeetle(dir: number, f: number, glow: number, anim: string): Built | null {
  const base = sheetPx(2, dir, f);
  if (!base) return null;
  const p = new Px(18, 18);
  let body = base;
  if (glow > 0) {
    // Полосы панциря ярче: перекраска раскалённого.
    body = new Px(16, 16);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const c = base.get(x, y);
        if (!c[3]) continue;
        // Раскаляются только тлеющие кромки панциря — не весь купол.
        const hot = c[0] === BEETLE_EMBER[0] && c[1] === BEETLE_EMBER[1];
        body.set(x, y, hot ? mixc(c, hx('#ff9a38'), glow * 0.85) : c);
      }
  }
  if (anim === 'dead') {
    // На спине: лапки кверху.
    body = new Px(16, 16);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const c = base.get(x, y);
        if (c[3]) body.set(x, 15 - y, mixc(c, hx('#2a1a14'), 0.5));
      }
  }
  // Жуков делаем чуть меньше: пропускаем каждый… нет — пиксели не режем.
  paste(p, body, 1, 1);
  return { p, ax: 9, ay: 16, eye: dir === 1 ? null : [9, 9] };
}

registerMobPainter('f6_beetle', (m: Mob, pose: MobPose) => {
  const dir = dir4(m.face);
  const anim = pose.anim;
  if (anim === 'dead')
    return frameDir('f6_beetle', pose, 'dead', dir, 0, () => paintBeetle(dir, 0, 0, 'dead'));
  const wind = anim === 'wind' || anim === 'bite';
  const speed = Math.hypot(m.vx, m.vy);
  const f = speed > 0.3 ? ((Math.floor(pose.t * 14 + m.id) % 4) + 4) % 4 : 0;
  // Брюшко дышит: три ступени свечения, на замахе — полное.
  const g = wind ? 3 : Math.floor((Math.sin(pose.t * 5 + m.id) * 0.5 + 0.5) * 2.99);
  return frameDir('f6_beetle', pose, `w${g}`, dir, f, () => paintBeetle(dir, f, g / 3, anim));
});

// ---------------------------------------------------------------------------
// Лавовый голем: сутулый, из базальтовых плит, кулаки до земли. Между
// плитами тлеют швы; каждая сколотая плита — ещё трещина со светом; без
// корки — жидкое нутро и корка хлопьями. 32×30, смотрит вправо, земля — 28.
// ---------------------------------------------------------------------------

const WHITE_HOT = hx('#fff4b8');
const GL = {
  rock: BASALT,
  rockFar: [hx('#140e10'), hx('#231c1e'), hx('#3a3030'), hx('#584a48')] as Tones,
  molten: [hx('#3a0c08'), hx('#7a1c0e'), hx('#b8381a'), hx('#f07a34')] as Tones,
  seam: [hx('#5a1608'), hx('#c84010'), hx('#ff8a24'), hx('#ffd060')],
  /** Разрыв корки: пар над плечами, пока голем без плит. */
  eye: hx('#ffd040'),
};

interface GolemPose {
  bx: number;
  by: number;
  lean: number;
  /** Кулаки: ближний и дальний (x, y). */
  fx: number;
  fy: number;
  gx: number;
  gy: number;
  /** Ноги: вынос вперёд ближней/дальней. */
  l1: number;
  l2: number;
  lift1: number;
  lift2: number;
  dust: boolean;
  steam: number;
  closed: boolean;
}

function golemPose(anim: string, f: number): GolemPose {
  const b: GolemPose = {
    bx: 13,
    by: 16,
    lean: 0,
    fx: 21,
    fy: 25,
    gx: 8,
    gy: 25,
    l1: 0,
    l2: 0,
    lift1: 0,
    lift2: 0,
    dust: false,
    steam: 0,
    closed: false,
  };
  switch (anim) {
    case 'idle': {
      const k = f % 2 ? 0.5 : 0;
      b.by += k;
      b.fy += k * 0.5;
      b.gy += k * 0.5;
      break;
    }
    case 'run': {
      const s = Math.sin((f / 6) * TAU);
      b.l1 = s * 2;
      b.l2 = -s * 2;
      b.lift1 = s > 0.5 ? 1 : 0;
      b.lift2 = s < -0.5 ? 1 : 0;
      b.by += Math.abs(s) * 0.6;
      b.lean = 0.6;
      b.fx += -s * 1.5;
      b.gx += s * 1.5;
      b.fy -= 1;
      b.gy -= 1;
      break;
    }
    case 'wind':
      // Кулаки над головой, отклонился назад.
      b.lean = -1.2 - f * 0.5;
      b.by -= 1;
      b.fx = 15;
      b.fy = 3 - f;
      b.gx = 10;
      b.gy = 4 - f;
      break;
    case 'bite':
      // Удар: кулаки в земле перед собой, корпус вперёд.
      b.lean = 2.2;
      b.by += 1.5;
      b.fx = 24;
      b.fy = 26;
      b.gx = 21;
      b.gy = 26;
      b.dust = f === 0;
      break;
    case 'hurt':
      b.lean = -1;
      b.closed = true;
      break;
    case 'harden':
      b.steam = f + 1;
      b.by += 0.5;
      break;
  }
  return b;
}

/** Швы плит: одни и те же на всех позах, яркость — по сколам. */
const SEAMS: [number, number][][] = [
  [
    [-6, -2],
    [-2, -1],
    [1, -3],
    [5, -2],
  ],
  [
    [-5, 3],
    [-1, 2],
    [3, 4],
    [6, 3],
  ],
  [
    [-1, -7],
    [0, -3],
    [-1, 2],
    [0, 6],
  ],
  [
    [3, -6],
    [4, -1],
    [6, 1],
  ],
];

function paintGolem(gp: GolemPose, plates: number, anim: string): Built {
  const W = 32;
  const H = 30;
  const p = new Px(W, H);
  const G = 28;
  const molten = plates <= 0;
  const skin = molten ? GL.molten : GL.rock;
  const far = molten ? GL.molten : GL.rockFar;
  const { bx, by, lean } = gp;
  if (anim === 'dead') {
    // Груда базальта, швы гаснут.
    const chunks: [number, number, number, number][] = [
      [10, 24, 4, 3],
      [16, 25, 5, 2.6],
      [22, 25, 3, 2.2],
      [13, 21, 3.4, 2.6],
      [19, 22, 2.6, 2],
    ];
    for (const [x, y, rx, ry] of chunks) shadeEll(p, x, y, rx, ry, GL.rock);
    p.outline(INK);
    for (let i = 0; i < 6; i++)
      p.set(10 + Math.floor(hash(i, 3) * 14), 22 + Math.floor(hash(i, 4) * 5), GL.seam[1]);
    return { p, ax: 16, ay: G + 1, eye: null };
  }
  // Ноги: дальняя темнее.
  const legs = (x: number, fwd: number, lift: number, t: Tones) => {
    limb(p, bx + x, by + 4, bx + x + fwd, G - 1 - lift, 2.6, 2.4, t);
    shadeEll(p, bx + x + fwd + 0.8, G - 0.8 - lift, 2.8, 1.4, t);
  };
  legs(-2.5, gp.l2, gp.lift2, far);
  // Дальняя рука и кулак.
  limb(p, bx - 2 + lean, by - 4, gp.gx, gp.gy - 2, 2.4, 2, far);
  shadeEll(p, gp.gx, gp.gy - 1.5, 2.8, 2.4, far);
  // Корпус: валун с горбом плеч.
  shadeEll(p, bx + lean * 0.5, by, 7.2, 6.4, skin);
  shadeEll(p, bx + 2.5 + lean, by - 4.5, 5.5, 3.8, skin);
  // Голова в плечах.
  shadeEll(p, bx + 5 + lean * 1.4, by - 6.8, 3, 2.4, skin, 0.1);
  legs(2.5, gp.l1, gp.lift1, skin);
  // Ближняя рука.
  limb(p, bx + 5 + lean, by - 3.5, gp.fx, gp.fy - 2, 2.6, 2.2, skin);
  shadeEll(p, gp.fx, gp.fy - 1.5, 3.1, 2.7, skin);
  p.outline(INK);
  // Швы: у целой корки тлеют, сколы — ярче и шире.
  const broken = GOLEM.plates - Math.max(0, plates);
  SEAMS.forEach((seam, k) => {
    const line = spline(
      seam.map(([x, y]) => [bx + lean * 0.5 + x, by + y] as [number, number]),
      4,
    );
    const hot = molten || k < broken;
    const c = molten ? GL.seam[3] : hot ? GL.seam[2] : GL.seam[1];
    line.forEach(([x, y], i) => {
      if (!p.solid(Math.floor(x), Math.floor(y))) return;
      if (!hot && i % 3 === 2) return;
      p.set(Math.floor(x), Math.floor(y), c);
      // Без корки швы — реки жидкого камня: широкие, с жёлтой сердцевиной.
      if (molten) {
        if (p.solid(Math.floor(x) + 1, Math.floor(y))) p.set(Math.floor(x) + 1, Math.floor(y), GL.seam[2]);
        if (i % 2 === 0 && p.solid(Math.floor(x), Math.floor(y) + 1))
          p.set(Math.floor(x), Math.floor(y) + 1, WHITE_HOT);
      } else if (hot && i % 2 === 0) p.set(Math.floor(x), Math.floor(y) + 1, GL.seam[3]);
    });
  });
  // Сколы по краю — у каждой сколотой плиты.
  for (let k = 0; k < broken && !molten; k++) {
    const x = Math.round(bx + [-5, 5, -3, 3][k]);
    const y = Math.round(by + [-4, -6, 4, 1][k]);
    clear(p, x, y);
    clear(p, x + 1, y);
    p.set(x, y + 1, GL.seam[2]);
  }
  if (molten) {
    // Корка хлопьями на жидком теле и капли.
    for (let i = 0; i < 7; i++) {
      const x = Math.round(bx - 5 + hash(i, 11) * 11);
      const y = Math.round(by - 5 + hash(i, 12) * 10);
      if (!p.solid(x, y)) continue;
      p.set(x, y, LAVA.crust);
      p.set(x + 1, y, LAVA.crustLt);
    }
    // Капли жидкого камня с кулаков и под ногами.
    p.set(Math.round(gp.fx), Math.round(gp.fy + 1), LAVA.bright);
    p.set(Math.round(gp.fx) - 1, Math.round(gp.fy + 2), LAVA.hot);
    p.set(Math.round(gp.gx), Math.round(gp.gy + 1), LAVA.hot);
    p.set(Math.round(bx), G - 1, LAVA.hot);
    p.set(Math.round(bx) + 3, G, LAVA.bright);
  }
  // Глаз-щель.
  const ex = Math.round(bx + 6 + lean * 1.4);
  const ey = Math.round(by - 7);
  // Надбровная плита нависает над глазом — у голема появляется «лицо».
  for (let x = ex - 2; x <= ex + 2; x++) if (p.solid(x, ey - 1)) p.set(x, ey - 1, skin[3]);
  if (p.solid(ex + 2, ey)) p.set(ex + 2, ey, INK);
  if (!gp.closed) {
    p.set(ex, ey, GL.eye);
    p.set(ex + 1, ey, molten ? WHITE : GL.eye);
    p.set(ex - 1, ey, INK);
  } else p.set(ex, ey, INK);
  if (gp.dust) for (let i = 0; i < 6; i++) p.set(18 + i * 2, G - (i % 2), alpha(BASALT[3], 0.8));
  if (gp.steam)
    for (let i = 0; i < 8; i++) {
      const x = Math.round(bx - 6 + hash(i, gp.steam) * 13);
      const y = Math.round(by - 8 - hash(i, gp.steam, 2) * 6 - gp.steam);
      p.set(x, y, alpha(hx('#e8e4dc'), 0.7));
    }
  return { p, ax: Math.round(bx), ay: G + 1, eye: gp.closed ? null : [ex, ey] };
}

registerMobPainter('f6_golem', (m: Mob, pose: MobPose) => {
  const plates = Math.max(0, Math.min(GOLEM.plates, m.data?.plates ?? GOLEM.plates));
  const mode = pose.mode;
  const t = pose.t;
  let anim: string = pose.anim;
  let f = ((pose.frame % 4) + 4) % 4;
  if (mode === 'f6_slam') {
    const warn = m.data?.warn ?? GOLEM.slamWarn;
    if (t < warn) {
      anim = 'wind';
      f = t < warn * 0.5 ? 0 : 1;
    } else {
      anim = 'bite';
      f = t < warn + 0.15 ? 0 : 1;
    }
  } else if (mode === 'f6_harden') {
    anim = 'harden';
    f = Math.min(3, Math.floor(t * 3));
  } else if (anim === 'run') f = ((pose.frame % 6) + 6) % 6;
  else if (anim === 'wind' || anim === 'bite') f = Math.min(1, pose.frame);
  const key = `${anim}${plates}`;
  return frameOf('f6_golem', pose, key, f, () => paintGolem(golemPose(anim, f), plates, anim));
});

// ---------------------------------------------------------------------------
// Живая руда: самородок кварца (белые кристаллы) или серебра (жилы), пока
// лежит; проснувшись — на четырёх каменных лапах, глаза в трещине.
// 22×20, смотрит вправо, земля — 17.
// ---------------------------------------------------------------------------

const ORE_ROCK: Tones = [hx('#2e282e'), hx('#4a424a'), hx('#6a5e66'), hx('#8e8088')];
const QUARTZ: Tones = [hx('#9a8aa0'), hx('#d4c8dc'), hx('#f0e8f6'), hx('#ffffff')];
const SILVER: Tones = [hx('#5a6068'), hx('#98a2ac'), hx('#d0d8e0'), hx('#ffffff')];

function paintOre(v: number, anim: string, f: number, sink: number): Built {
  const p = new Px(22, 20);
  const G = 17;
  const awake = anim !== 'hide' && anim !== 'dig';
  const lift = awake ? 2 : 0;
  const hop = anim === 'wake' ? [0, 2, 1, 0][f % 4] : 0;
  const cx = 11 + (anim === 'bite' ? 1.5 : 0);
  const cy = G - 3.2 - lift - hop;
  if (anim === 'dead') {
    // Раскололась: осколки кристаллов и камня.
    for (let i = 0; i < 6; i++) {
      const x = 5 + hash(i, v) * 12;
      const y = G - 1 - hash(i, v, 2) * 3;
      shadeEll(p, x, y, 1.6, 1.2, i % 2 ? ORE_ROCK : v === 11 ? SILVER : QUARTZ);
    }
    p.outline(INK);
    return { p, ax: 11, ay: G + 1, eye: null };
  }
  // Лапы (проснулась).
  if (awake) {
    const run = anim === 'run';
    for (const [lx, ph, fr] of [
      [-3.5, 0, true],
      [3, Math.PI, true],
      [-2, Math.PI, false],
      [4.5, 0, false],
    ] as [number, number, boolean][]) {
      const s = run ? Math.sin((f / 6) * TAU + ph) : 0;
      const up = run && s > 0.4 ? 1 : 0;
      limb(p, cx + lx, cy + 1.5, cx + lx + s * 1.2, G - up, 1.1, 1, ORE_ROCK, fr ? -0.3 : 0);
    }
  }
  // Глыба.
  shadeEll(p, cx, cy, 5.4, 3.8, ORE_ROCK);
  shadeEll(p, cx - 1.8, cy - 1.8, 3, 2.2, ORE_ROCK, 0.1);
  if (v === 11) {
    // Серебро: жилы и самородный комок.
    const vein = spline(
      [
        [cx - 4, cy + 1],
        [cx - 1, cy - 1],
        [cx + 2, cy],
        [cx + 4, cy - 2],
      ],
      4,
    );
    vein.forEach(([x, y]) => p.set(Math.floor(x), Math.floor(y), SILVER[2]));
    shadeEll(p, cx + 1.5, cy - 2.5, 2, 1.6, SILVER);
    shadeEll(p, cx - 3, cy - 2.6, 1.2, 1, SILVER);
  } else {
    // Кварц: шестигранные кристаллы торчат вверх.
    const cr: [number, number, number, number][] = [
      [cx - 2, cy - 2, 1.3, 5],
      [cx + 0.5, cy - 2.5, 1.5, 6.5],
      [cx + 2.8, cy - 1.8, 1.1, 4],
    ];
    for (const [x, y, w, h] of cr) {
      poly(
        p,
        [
          [x - w, y],
          [x - w, y - h + 1],
          [x, y - h],
          [x + w, y - h + 1],
          [x + w, y],
        ],
        (px) => (px < x ? QUARTZ[2] : px > x ? QUARTZ[1] : QUARTZ[3]),
      );
    }
  }
  p.outline(INK);
  // Блеск: бежит по кристаллу.
  if (anim === 'hide' || anim === 'idle') {
    const gx = Math.round(cx - 2 + (f % 4) * 1.5);
    const gy = Math.round(cy - 5 + (f % 2));
    if (p.solid(gx, gy) && f > 0) p.set(gx, gy, WHITE);
  }
  let eye: [number, number] | null = null;
  if (awake) {
    // Трещина-пасть и глаза.
    const open = anim === 'wind' ? 1 : anim === 'bite' ? 2 : 0;
    const mx = Math.round(cx + 3);
    const my = Math.round(cy + 1);
    for (let i = 0; i < 4; i++) p.set(mx - 1 + i, my + (i % 2), INK);
    if (open) {
      p.ell(cx + 3.5, cy + 1.5, 2, open * 0.9, hx('#1a0e14'));
      p.set(mx, my + 1, QUARTZ[3]);
      p.set(mx + 2, my + 1, QUARTZ[3]);
    }
    const ex = Math.round(cx + 2);
    const ey = Math.round(cy - 1);
    if (anim !== 'hurt') {
      p.set(ex, ey, hx('#a8f0ff'));
      p.set(ex + 2, ey, hx('#a8f0ff'));
      eye = [ex, ey];
    } else {
      p.set(ex, ey, INK);
      p.set(ex + 2, ey, INK);
    }
  }
  if (sink > 0) {
    // Зарывается: низ уходит в пол, по краю — крошка.
    const cut = Math.round(G - sink * 6);
    for (let y = cut; y < p.h; y++) for (let x = 0; x < p.w; x++) clear(p, x, y);
    for (let x = 5; x < 17; x += 2) p.set(x, cut, alpha(ASH.mid, 0.9));
  }
  return { p, ax: 11, ay: G + 1, eye };
}

registerMobPainter('f6_ore', (m: Mob, pose: MobPose) => {
  const v = m.data?.v === 11 ? 11 : 10;
  const mode = pose.mode;
  const t = pose.t;
  let anim: string = pose.anim;
  let f = ((pose.frame % 4) + 4) % 4;
  let sink = 0;
  if (mode === 'f6_hide') {
    anim = 'hide';
    // Блеск раз в пару секунд, остальное время — просто камень.
    f = Math.floor((t + m.id * 0.7) * 4) % 10;
    if (f > 3) f = 0;
  } else if (mode === 'f6_wake') {
    anim = 'wake';
    f = Math.min(3, Math.floor(t * 8));
  } else if (mode === 'f6_dig') {
    anim = 'dig';
    sink = Math.min(1, t / 0.6);
    f = Math.round(sink * 3);
    sink = f / 3;
  } else if (anim === 'run') f = ((pose.frame % 6) + 6) % 6;
  else if (anim === 'wind' || anim === 'bite') f = Math.min(1, pose.frame);
  return frameOf(`f6_ore${v}`, pose, anim, f, () => paintOre(v, anim, f, sink));
});

// ---------------------------------------------------------------------------
// Магмовый червь: кольца корки с лавой между ними, пасть — венец клыков.
// Под лавой — только горб и круги. 26×34, «земля» — поверхность лавы.
// ---------------------------------------------------------------------------

const WORM_C: Tones = [hx('#1a1010'), hx('#3a2622'), hx('#5e4238'), hx('#86604c')];

function paintWorm(rise: number, lean: number, open: number, sway: number, f: number): Built {
  const W = 26;
  const H = 34;
  const p = new Px(W, H);
  const S = 30;
  const cx = 12;
  if (rise <= 0) {
    // Горб под поверхностью и круги.
    shadeEll(p, cx, S - 0.5, 3.4, 1.4, WORM_C, 0.1);
    p.outline(INK);
    p.set(cx - 1, S - 1, LAVA.hot);
    p.set(cx + 1, S - 1, LAVA.bright);
    ripple(p, cx, S, 5.5, 1.8, f);
    return { p, ax: cx, ay: S + 1 - FLY, eye: null };
  }
  // Хребет: от поверхности вверх, наклон назад/вперёд и покачивание.
  const len = 20 * rise;
  const pts: [number, number][] = [];
  for (let i = 0; i <= 4; i++) {
    const k = i / 4;
    const bend = lean * k * k * 7 + Math.sin(k * 3 + sway) * 1.2 * k;
    pts.push([cx + bend, S - len * k]);
  }
  const spine = spline(pts, 4);
  // Кольца снизу вверх: корка, между ними светится лава.
  const n = spine.length;
  for (let i = 0; i < n - 1; i++) {
    const k = i / (n - 1);
    const [x, y] = spine[i];
    const r = 3.3 - k * 0.8;
    shadeEll(p, x, y, r, r * 0.8, WORM_C);
  }
  const head = spine[n - 1];
  const hr = 3.2;
  shadeEll(p, head[0], head[1], hr, hr * 0.9, WORM_C, 0.1);
  p.outline(INK);
  // Швы колец — лава.
  for (let i = 2; i < n - 2; i += 3) {
    const [x, y] = spine[i];
    const r = 3.1 - (i / n) * 0.8;
    for (let dx = -Math.floor(r); dx <= Math.floor(r); dx++) {
      if (p.solid(Math.round(x + dx), Math.round(y)))
        p.set(Math.round(x + dx), Math.round(y), Math.abs(dx) < r * 0.5 ? LAVA.bright : LAVA.hot);
    }
  }
  // Пасть: венец клыков, раскрыт на плевке.
  const mx = Math.round(head[0] + 1.4 + open);
  const my = Math.round(head[1] - 0.2);
  if (open > 0) {
    p.ell(mx, my, 1.4 + open * 0.8, 1.2 + open * 0.8, hx('#2a0806'));
    p.ell(mx, my, 0.7 + open * 0.5, 0.6 + open * 0.4, LAVA.bright);
    for (let a = 0; a < 6; a++) {
      const aa = (a / 6) * TAU;
      p.set(
        Math.round(mx + Math.cos(aa) * (1.8 + open * 0.8)),
        Math.round(my + Math.sin(aa) * (1.6 + open * 0.8)),
        BONE[3],
      );
    }
  } else {
    p.set(mx, my, LAVA.hot);
    p.set(mx, my - 1, BONE[2]);
    p.set(mx, my + 1, BONE[2]);
  }
  // Капли лавы стекают с колец.
  for (let i = 0; i < 3; i++) {
    const j = Math.floor(hash(i, f, 3) * (n - 2)) + 1;
    const [x, y] = spine[j];
    p.set(Math.round(x + 3), Math.round(y + 1 + (f % 2)), LAVA.hot);
  }
  ripple(p, cx, S, 5 + rise, 1.6, f);
  return { p, ax: cx, ay: S + 1 - FLY, eye: [mx - 1, my - 1] };
}

registerMobPainter('f6_worm', (m: Mob, pose: MobPose) => {
  const mode = pose.mode;
  const t = pose.t;
  const f = ((Math.floor(t * 7) % 4) + 4) % 4;
  if (mode === 'f6_under' || mode === 'chase')
    return frameOf('f6_worm', pose, 'under', f, () => paintWorm(0, 0, 0, 0, f));
  if (mode === 'f6_surface' || mode === 'f6_sink') {
    const k0 = mode === 'f6_surface' ? t / 0.45 : 1 - t / 0.4;
    const k = Math.max(1, Math.min(4, Math.round(k0 * 4)));
    return frameOf('f6_worm', pose, `rise${k}`, f, () => paintWorm(k / 4, 0, 0, f * 0.8, f));
  }
  if (mode === 'aim') {
    // Откидывается назад, пасть наливается.
    const k = Math.min(2, Math.floor(t * 3));
    return frameOf('f6_worm', pose, `aim${k}`, f, () => paintWorm(1, -0.4 - k * 0.15, 0.4, 0, f));
  }
  if (mode === 'windup' || pose.anim === 'bite') {
    const k = Math.min(1, pose.frame);
    return frameOf('f6_worm', pose, `bite${k}`, 0, () => paintWorm(1, 0.5 + k * 0.3, 1.2, 0, 0));
  }
  if (pose.anim === 'dead')
    return frameOf('f6_worm', pose, 'dead', 0, () => paintWorm(0.4, 0.8, 0, 1, 0));
  // Висит над лавой, качается; только что плюнул — пасть открыта.
  const spat = mode === 'f6_linger' && t < 0.3;
  const k = spat ? 1 : 0;
  return frameOf('f6_worm', pose, `linger${k}`, f, () =>
    paintWorm(1, spat ? 0.6 : 0.1, spat ? 1.2 : 0, (f / 4) * TAU, f),
  );
});

// ---------------------------------------------------------------------------
// Бесёнок-старьёвщик: бес из атласа 0x72 с мешком добычи за спиной.
// ---------------------------------------------------------------------------

const SACK: Tones = [hx('#4a2a14'), hx('#7a4a24'), hx('#a8703a'), hx('#d09a5a')];

function paintImp(run: boolean, f: number, anim: string): Built | null {
  const name = (run ? `imp_run_anim_f${f}` : `imp_idle_anim_f${f}`) as X72Name;
  const base = x72(name);
  if (!base) return null;
  const p = new Px(26, 22);
  // Мешок за спиной — с самого беса, на лямке через плечо, монеты в горловине.
  const sx = 10;
  const sy = 14 + (run && f % 2 ? 1 : 0);
  shadeEll(p, sx, sy, 4.4, 4.2, SACK);
  shadeEll(p, sx + 1.2, sy - 4.2, 1.8, 1.2, SACK);
  p.outline(INK);
  stroke(p, sx - 1, sy - 3, sx + 2, sy - 3, hx('#2a160a'));
  for (const [x, y] of [
    [sx + 1, sy - 6],
    [sx + 2, sy - 6],
    [sx - 1, sy + 1],
  ])
    p.set(x, y, GOLD);
  p.set(sx + 3, sy + 2, hx('#fff4a0'));
  let body = base;
  if (anim === 'hurt') body = base.tint(WHITE, 0.25);
  paste(p, body, 8, 6);
  // Лямка поверх плеча беса.
  stroke(p, sx + 2, sy - 3, sx + 7, sy + 1, hx('#5a3418'));
  return { p, ax: 16, ay: 22, eye: null };
}

registerMobPainter('f6_imp', (m: Mob, pose: MobPose) => {
  const speed = Math.hypot(m.vx, m.vy);
  const run = speed > 0.4;
  const f = ((Math.floor(pose.t * (run ? 12 : 6)) % 4) + 4) % 4;
  const anim = pose.anim === 'hurt' ? 'hurt' : run ? 'run' : 'idle';
  const k = `f6_imp|${anim}|${f}|${pose.left ? 1 : 0}|${pose.flash ? 1 : 0}|${pose.look}`;
  const hit = frames.get(k);
  if (hit) return hit;
  const b = paintImp(run, f, anim);
  return b ? finish(k, b, pose.look, pose.flash, pose.left) : null;
});

// ---------------------------------------------------------------------------
// Красный змей (v2.86 — анимации). Кадр — грудь, шея, рогатая голова,
// крылья и передние лапы; остальное тело змеиное и живёт в мире: зона
// `f6_body` кладёт его кольцами по пути головы, поднимает в небо следом за
// грудью, хлещет хвостом вкруговую в такт удару и хоронит кольцами при
// смерти (ниже).
//
// Поза — риг из чисел (`Rig`). Техника — дорожка ключей рига по времени
// режима на 24 к/с: подготовка → удар → проводка → возврат, кадр контакта
// — ровно в миг урона мозга. Промежуточные позы — интерполяция ключей с
// разгоном и торможением. Ход всего тела (выпад, взлёт, пике, вес) — поля
// кадра dx/dy/sx/sy: кадр не тянется внутри холста. Кадры — в `frameLRU`,
// прогрев — техники первой фазы в обе стороны.
// ---------------------------------------------------------------------------

const SRP = {
  scale: [hx('#3e0a0a'), hx('#861812'), hx('#c8321c'), hx('#f26a3a')] as Tones,
  far: [hx('#2a0606'), hx('#5a100c'), hx('#8a2414'), hx('#b8442a')] as Tones,
  belly: [hx('#7a3e14'), hx('#cc8634'), hx('#f4bc5a'), hx('#ffe6a0')] as Tones,
  wing: [hx('#2a0606'), hx('#5a0e0c'), hx('#8a2014'), hx('#b8402a')] as Tones,
  wingFar: [hx('#1c0404'), hx('#3e0a08'), hx('#5e160e'), hx('#7e2a1c')] as Tones,
  horn: [hx('#4a3a2e'), hx('#9a8a72'), hx('#d4c8b0'), hx('#f6f0e0')] as Tones,
  eye: hx('#ffe24a'),
  mouth: hx('#2a0404'),
  gum: hx('#6a0e0c'),
  tongue: hx('#e0506a'),
  smoke: hx('#b8aca0'),
};

const SFPS = 24;
/** Холст рисования (потом обрезается по рисунку); якорь — земля под грудью. */
const SW = 136;
const SH = 120;
const SAX = 58;
const SAY = 96;

interface Rig {
  /** Грудь: сдвиг от покоя и наклон (+ — вперёд-вниз). */
  bx: number;
  by: number;
  tilt: number;
  /** Голова: центр черепа от якоря и куда морда (0 — вперёд, + — вниз). */
  hx: number;
  hy: number;
  ha: number;
  jaw: number;
  /** Изгиб шеи: + — дугой вперёд, − — выгнута назад. */
  bend: number;
  /** Горло раздуто, жар в горле, пламя из пасти. */
  bulge: number;
  glow: number;
  fire: number;
  /** Крылья: раскрыты, взмах (−1 вниз … 1 вверх), обвисли. */
  ws: number;
  wf: number;
  wd: number;
  /** Лапы: фаза и размах шага, поджаты (полёт), подняты (на дыбах). */
  step: number;
  stepA: number;
  tuck: number;
  paw: number;
  /** Веки, злой прищур, дым из ноздрей (фаза 0…1), язык, звёзды. */
  shut: number;
  angry: number;
  smoke: number;
  tongue: number;
  stars: number;
  /** Смерть: остывание в обсидиан и распад. */
  cool: number;
  crumble: number;
  /** Морда в камне (оглушение). */
  buried: number;
  /** Жилы жара между чешуй (фаза, призыв). */
  heat: number;
}

const REST: Rig = {
  bx: 0,
  by: 0,
  tilt: 0,
  hx: 17,
  hy: -30,
  ha: 0.25,
  jaw: 0,
  bend: 0.15,
  bulge: 0,
  glow: 0.08,
  fire: 0,
  ws: 0.05,
  wf: 0,
  wd: 0,
  step: 0,
  stepA: 0,
  tuck: 0,
  paw: 0,
  shut: 0,
  angry: 0,
  smoke: -1,
  tongue: 0,
  stars: 0,
  cool: 0,
  crumble: 0,
  buried: 0,
  heat: 0,
};

type Ease = (x: number) => number;
const EZ = {
  lin: (x: number) => x,
  /** Разгон — замах, падение. */
  in: (x: number) => x * x,
  in3: (x: number) => x * x * x,
  /** Торможение — удар, выход из рывка. */
  out: (x: number) => 1 - (1 - x) * (1 - x) * (1 - x),
  out2: (x: number) => 1 - (1 - x) * (1 - x),
  io: (x: number) => x * x * (3 - 2 * x),
  /** С перелётом за цель и возвратом. */
  back: (x: number) => {
    const y = x - 1;
    return 1 + 2.7 * y * y * y + 1.7 * y * y;
  },
};

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
/** Доля пути по отрезку времени [a, b]. */
const seg = (t: number, a: number, b: number) => clamp01((t - a) / Math.max(1e-6, b - a));

type Key = [number, Partial<Rig>, Ease?];

/**
 * Дорожка ключей: каждая следующая поза — прошлая плюс изменения; между
 * ключами — кривая следующего ключа (по умолчанию — плавно).
 */
function lane(base: Rig, keys: Key[]): (t: number) => Rig {
  const ts: number[] = [];
  const rs: Rig[] = [];
  const es: Ease[] = [];
  let cur = base;
  for (const [t, part, e] of keys) {
    cur = { ...cur, ...part };
    ts.push(t);
    rs.push(cur);
    es.push(e ?? EZ.io);
  }
  const names = Object.keys(base) as (keyof Rig)[];
  return (x: number) => {
    if (x <= ts[0]) return { ...rs[0] };
    for (let i = 1; i < ts.length; i++) {
      if (x > ts[i]) continue;
      const k = es[i]((x - ts[i - 1]) / Math.max(1e-6, ts[i] - ts[i - 1]));
      const a = rs[i - 1];
      const b = rs[i];
      const o = { ...a };
      for (const n of names) o[n] = a[n] + (b[n] - a[n]) * k;
      return o;
    }
    return { ...rs[rs.length - 1] };
  };
}

/** Смешать две позы. */
function mixRig(a: Rig, b: Rig, k: number): Rig {
  const o = { ...a };
  for (const n of Object.keys(a) as (keyof Rig)[]) o[n] = a[n] + (b[n] - a[n]) * k;
  // Дым — фаза, а не величина: берём ближнюю.
  o.smoke = k < 0.5 ? a.smoke : b.smoke;
  return o;
}

// ---- Рисование рига --------------------------------------------------------

/** Овал под углом со светом по нормали; `pick` может заменить цвет пикселя. */
function shadeEllR(
  p: Px,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rot: number,
  t: Tones,
  bias = 0,
  pick?: (lx: number, ly: number, l: number) => RGBA | null,
): void {
  if (rx <= 0 || ry <= 0) return;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const R = Math.max(rx, ry) + 1;
  const x0 = Math.max(0, Math.floor(cx - R));
  const x1 = Math.min(p.w - 1, Math.ceil(cx + R));
  const y0 = Math.max(0, Math.floor(cy - R));
  const y1 = Math.min(p.h - 1, Math.ceil(cy + R));
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const lx = (dx * c + dy * s) / rx;
      const ly = (-dx * s + dy * c) / ry;
      const d2 = lx * lx + ly * ly;
      if (d2 > 1) continue;
      const nx = lx * c - ly * s;
      const ny = lx * s + ly * c;
      const nz = Math.sqrt(1 - d2);
      const l = nx * LX + ny * LY + nz * LZ + bias;
      const col = pick ? pick(lx, ly, l) : null;
      p.set(x, y, col ?? tone(t, l));
    }
}

/** Контур снаружи фигуры — только в рамке рисунка (быстрее полного прохода). */
function outlineIn(p: Px, c: RGBA, x0: number, y0: number, x1: number, y1: number): void {
  const w = p.w;
  const d = p.data;
  const add: number[] = [];
  const X0 = Math.max(0, x0 - 1);
  const Y0 = Math.max(0, y0 - 1);
  const X1 = Math.min(p.w - 1, x1 + 1);
  const Y1 = Math.min(p.h - 1, y1 + 1);
  for (let y = Y0; y <= Y1; y++)
    for (let x = X0; x <= X1; x++) {
      const i = y * w + x;
      if (d[i * 4 + 3]) continue;
      if (
        (x > 0 && d[(i - 1) * 4 + 3]) ||
        (x < w - 1 && d[(i + 1) * 4 + 3]) ||
        (y > 0 && d[(i - w) * 4 + 3]) ||
        (y < p.h - 1 && d[(i + w) * 4 + 3])
      )
        add.push(i);
    }
  for (const i of add) {
    d[i * 4] = c[0];
    d[i * 4 + 1] = c[1];
    d[i * 4 + 2] = c[2];
    d[i * 4 + 3] = 255;
  }
}

/** Рамка непрозрачного: [x0, y0, x1, y1] или null. */
function bboxOf(p: Px): [number, number, number, number] | null {
  let x0 = p.w;
  let y0 = p.h;
  let x1 = -1;
  let y1 = -1;
  const d = p.data;
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      if (!d[(y * p.w + x) * 4 + 3]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  return x1 < 0 ? null : [x0, y0, x1, y1];
}

/** Часть холста рисования — сразу в холст нужного размера (без копии пикселей). */
function canvasOf(p: Px, x0: number, y0: number, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (g) g.putImageData(new ImageData(p.data as Uint8ClampedArray<ArrayBuffer>, p.w, p.h), -x0, -y0, x0, y0, w, h);
  return c;
}

/** Точка, повёрнутая на угол a вокруг (0, 0). */
const rot2 = (x: number, y: number, a: number): [number, number] => [
  x * Math.cos(a) - y * Math.sin(a),
  x * Math.sin(a) + y * Math.cos(a),
];

type P2 = [number, number];

/** Формы крыла от плеча (смотрит вправо, крыло — назад): запястье, три пальца, крепление. */
interface WingShape {
  w: P2;
  tips: [P2, P2, P2];
  att: P2;
}
const WING_FOLD: WingShape = {
  w: [-6, -9],
  tips: [
    [-13, -6],
    [-14, -1],
    [-10, 3],
  ],
  att: [-8, 3],
};
const WING_HALF: WingShape = {
  w: [-8, -13],
  tips: [
    [-17, -16],
    [-19, -8],
    [-14, -1],
  ],
  att: [-11, 4],
};
const WING_SPREAD: WingShape = {
  w: [-13, -8],
  tips: [
    [-28, -13],
    [-30, -2],
    [-22, 8],
  ],
  att: [-12, 4],
};
const WING_DROOP: WingShape = {
  w: [-9, -4],
  tips: [
    [-17, 2],
    [-14, 7],
    [-10, 8],
  ],
  att: [-9, 6],
};

function mixP(a: P2, b: P2, k: number): P2 {
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
}
function mixWing(a: WingShape, b: WingShape, k: number): WingShape {
  return {
    w: mixP(a.w, b.w, k),
    tips: [mixP(a.tips[0], b.tips[0], k), mixP(a.tips[1], b.tips[1], k), mixP(a.tips[2], b.tips[2], k)],
    att: mixP(a.att, b.att, k),
  };
}

/** Крыло: плечо S, запястье, три пальца и перепонка между ними (фестонами). */
function wing2(p: Px, sx: number, sy: number, r: Rig, far: boolean): void {
  const ws = clamp01(r.ws);
  let sh = ws < 0.5 ? mixWing(WING_FOLD, WING_HALF, ws * 2) : mixWing(WING_HALF, WING_SPREAD, (ws - 0.5) * 2);
  if (r.wd > 0) sh = mixWing(sh, WING_DROOP, clamp01(r.wd));
  // Взмах: всё крыло поворачивается у плеча; раскрытое — сильнее.
  const phi = r.wf * (0.35 + ws * 0.6);
  // Дальнее крыло меньше (дальше от глаза) и чуть отстаёт по взмаху.
  const k = far ? 0.88 : 1;
  const tr = (q: P2): P2 => {
    const [x, y] = rot2(q[0] * k, q[1] * k, phi);
    return [sx + x, sy + y];
  };
  const [wx, wy] = tr(sh.w);
  const tips = sh.tips.map(tr) as [P2, P2, P2];
  const att = tr(sh.att);
  const bone = far ? SRP.far : SRP.scale;
  const mem = far ? SRP.wingFar : SRP.wing;
  const fan: P2[] = [[sx, sy], [wx, wy], ...tips, att];
  poly(p, fan, (x, y) => {
    const d = Math.hypot(x - wx, y - wy) / 16;
    return tone(mem, 0.15 + d * 0.5 - (y - wy) * 0.01);
  });
  // Кромка фестонами: вырезы между пальцами.
  for (let i = 0; i < tips.length - 1; i++) {
    const [ax, ay] = tips[i];
    const [bx, by] = tips[i + 1];
    const mx = (ax + bx) / 2 + (wx - (ax + bx) / 2) * 0.22;
    const my = (ay + by) / 2 + (wy - (ay + by) / 2) * 0.22;
    poly(
      p,
      [
        [ax, ay],
        [mx, my],
        [bx, by],
        [(ax + bx) / 2 - (wx - (ax + bx) / 2) * 0.1, (ay + by) / 2 - (wy - (ay + by) / 2) * 0.1],
      ],
      [0, 0, 0, 0],
    );
  }
  // Кости: плечо — запястье, пальцы.
  limb(p, sx, sy, wx, wy, 1.6, 1.2, bone);
  for (const [tx, ty] of tips) limb(p, wx, wy, tx, ty, 0.9, 0.5, bone);
  // Коготь на запястье — вверх от кости.
  p.set(Math.round(wx), Math.round(wy) - 2, SRP.horn[2]);
  p.set(Math.round(wx) + 1, Math.round(wy) - 1, SRP.horn[1]);
}

/** Лапа: плечо → локоть → стопа, локоть назад; три когтя вперёд. */
function leg2(p: Px, hx0: number, hy0: number, fx: number, fy: number, far: boolean): void {
  const L1 = 6.5;
  const L2 = 7;
  const dx = fx - hx0;
  const dy = fy - hy0;
  const d = Math.min(L1 + L2 - 0.01, Math.max(1, Math.hypot(dx, dy)));
  const a = Math.atan2(dy, dx);
  const c = (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d);
  const b = Math.acos(clamp(c, -1, 1));
  // Локоть — назад (к хвосту): берём решение с меньшим x.
  const e1: P2 = [hx0 + Math.cos(a + b) * L1, hy0 + Math.sin(a + b) * L1];
  const e2: P2 = [hx0 + Math.cos(a - b) * L1, hy0 + Math.sin(a - b) * L1];
  const [ex, ey] = e1[0] < e2[0] ? e1 : e2;
  const t = far ? SRP.far : SRP.scale;
  const ffx = hx0 + Math.cos(a) * d;
  const ffy = hy0 + Math.sin(a) * d;
  limb(p, hx0, hy0, ex, ey, 2.7, 2.2, t);
  limb(p, ex, ey, ffx, ffy, 2.1, 1.6, t);
  for (let k = 0; k < 3; k++)
    p.set(Math.round(ffx - 0.5 + k * 1.3), Math.round(ffy + 0.5), SRP.horn[far ? 1 : 2]);
}

/** Струйка дыма: клубы поднимаются и тают, фаза 0…1. */
function puff(p: Px, x: number, y: number, ph: number, lean: number): void {
  for (let i = 0; i < 3; i++) {
    const a = (ph + i * 0.33) % 1;
    const px = x + lean * a * 4 + Math.sin(a * 6 + i) * 0.8;
    const py = y - a * 7;
    const r = 0.6 + a * 1.4;
    p.ell(px, py, r, r * 0.85, alpha(SRP.smoke, 0.75 * (1 - a)));
  }
}

/** Внутренние линии жара: трещины между щитками, светятся (жилы фазы). */
function veinAt(x: number, y: number, seed: number): boolean {
  const n = noise(x, y, 3.2, seed);
  return n > 0.47 && n < 0.53;
}

interface SerpArt {
  img: Px;
  lit: Px;
  eye: [number, number] | null;
}

/** Нарисовать риг в холст SW×SH (якорь SAX, SAY). */
function paintRig(r: Rig): SerpArt {
  const p = new Px(SW, SH);
  const lit = new Px(SW, SH);
  const O = (x: number, y: number): P2 => [SAX + x, SAY + y];
  const ct = Math.cos(r.tilt);
  const st = Math.sin(r.tilt);
  // Точка на груди в её собственных осях.
  const CX = SAX + r.bx;
  const CY = SAY - 12 + r.by;
  const onChest = (x: number, y: number): P2 => [CX + x * ct - y * st, CY + x * st + y * ct];
  const [HX, HY] = O(r.hx, r.hy);
  const ha = r.ha;
  const fx = Math.cos(ha);
  const fy = Math.sin(ha);
  // «Низ» головы: челюсть всегда книзу (голова, повёрнутая назад, — зеркально).
  let nx = -fy;
  let ny = fx;
  if (Math.abs(ha) > 2.1 && ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  const back = Math.abs(ha) > 2.1;
  const heat = clamp01(r.heat);

  // Дальнее крыло и дальняя лапа — за телом.
  const [fsx, fsy] = onChest(5, -7);
  wing2(p, fsx, fsy, r, true);
  // Лапы: где стоят стопы.
  const legFoot = (x: number, ph: number): P2 => {
    const s = Math.sin(r.step + ph);
    const c = Math.cos(r.step + ph);
    let px = SAX + r.bx * 0.4 + x + c * r.stepA;
    let py = SAY - Math.max(0, s) * r.stepA * 0.55;
    const hip = onChest(x - 3, 5);
    // Поджаты в полёте: к брюху.
    px = lerp(px, hip[0] + 3, r.tuck);
    py = lerp(py, hip[1] + 6, r.tuck);
    // На дыбах: передние лапы подняты и загребают воздух.
    const pw = r.paw;
    px = lerp(px, hip[0] + 8 + Math.sin(r.step * 0.5 + ph) * 1.5, pw);
    py = lerp(py, hip[1] + 1 + Math.cos(r.step * 0.5 + ph) * 1.5, pw);
    return [px, py];
  };
  {
    const hip = onChest(3, 4);
    const [fx0, fy0] = legFoot(5, Math.PI);
    leg2(p, hip[0], hip[1], fx0, fy0, true);
  }

  // Шея: от груди к затылку; толщина — к голове тоньше, горло раздувается.
  const [n0x, n0y] = onChest(5, -5);
  const hbx = HX - fx * 3.6;
  const hby = HY - fy * 3.6;
  const vx = hbx - n0x;
  const vy = hby - n0y;
  const vl = Math.hypot(vx, vy) || 1;
  const pfx = -vy / vl;
  const pfy = vx / vl;
  // Изгиб — в сторону «вперёд» для шеи, смотрящей вверх.
  const sgn = pfx >= 0 ? 1 : -1;
  const midx = (n0x + hbx) / 2 + pfx * sgn * r.bend * 7;
  const midy = (n0y + hby) / 2 + pfy * sgn * r.bend * 7;
  const neck = spline(
    [
      [n0x, n0y],
      [midx, midy],
      [hbx, hby],
    ],
    7,
  );
  const neckR = (k: number) =>
    lerp(5.8, 3.4, k) + r.bulge * 2.2 * Math.exp(-((k - 0.32) * (k - 0.32)) / 0.03);

  // Грудь со щитками брюха: полосы в осях груди.
  const drawChest = () => {
    shadeEllR(p, CX, CY, 11, 9, r.tilt, SRP.scale, 0, (lx, ly, l) => {
      // Брюхо — спереди снизу.
      const bx = lx * 11;
      const by = ly * 9;
      if (by > 0.5 && bx > -7 + by * 0.4) {
        const band = Math.floor((by - 0.5) / 1.8);
        const inner = (by - 0.5) / 1.8 - band;
        const edge = inner > 0.72;
        return tone(SRP.belly, l * 0.9 + 0.1 - band * 0.06 - (edge ? 0.35 : 0));
      }
      return null;
    });
  };

  const drawNeck = () => {
    neck.forEach(([x, y], i) => {
      const k = i / (neck.length - 1);
      const rr = neckR(k);
      shadeEll(p, x, y, rr, rr * 0.95, SRP.scale);
    });
    // Брюхо шеи — щитки со стороны горла.
    neck.forEach(([x, y], i) => {
      if (i === 0) return;
      const k = i / (neck.length - 1);
      const rr = neckR(k);
      const [ax, ay] = neck[i - 1];
      const tx = x - ax;
      const ty = y - ay;
      const tl = Math.hypot(tx, ty) || 1;
      let bnx = -ty / tl;
      let bny = tx / tl;
      if (bny < 0 && Math.abs(bnx) < 0.3) {
        bnx = -bnx;
        bny = -bny;
      }
      if (bnx * sgn < -0.2 && !back) {
        bnx = -bnx;
        bny = -bny;
      }
      const c = i % 2 ? SRP.belly[2] : SRP.belly[1];
      p.set(Math.round(x + bnx * rr * 0.6), Math.round(y + bny * rr * 0.6), c);
      if (rr > 4.2) p.set(Math.round(x + bnx * rr * 0.35), Math.round(y + bny * rr * 0.35), SRP.belly[1]);
    });
    // Спинные шипы — с другой стороны.
    neck.forEach(([x, y], i) => {
      if (i === 0 || i % 3 !== 1) return;
      const k = i / (neck.length - 1);
      const rr = neckR(k);
      const [ax, ay] = neck[i - 1];
      const tx = x - ax;
      const ty = y - ay;
      const tl = Math.hypot(tx, ty) || 1;
      let bnx = ty / tl;
      let bny = -tx / tl;
      if (bnx * sgn > 0.2 && !back) {
        bnx = -bnx;
        bny = -bny;
      }
      const bx = x + bnx * rr * 0.75;
      const by = y + bny * rr * 0.75;
      // Шип смотрит наружу и назад, к хвосту.
      const len = 2.6 - k * 1.2;
      const dx = bnx * len - (tx / tl) * len * 0.7;
      const dy = bny * len - (ty / tl) * len * 0.7;
      poly(
        p,
        [
          [bx - (tx / tl) * 1.4, by - (ty / tl) * 1.4],
          [bx + dx, by + dy],
          [bx + (tx / tl) * 1.2, by + (ty / tl) * 1.2],
        ],
        SRP.horn[1],
      );
    });
  };

  // Голова: рога, череп, морда, челюсть, надбровье.
  const snx = HX + fx * 5.2;
  const sny = HY + fy * 5.2;
  const jawA = r.jaw * 0.85;
  // Направление нижней челюсти: от морды к «низу» головы.
  const jcx = fx * Math.cos(jawA) + nx * Math.sin(jawA);
  const jcy = fy * Math.cos(jawA) + ny * Math.sin(jawA);
  const hingeX = HX + fx * 1.2 + nx * 1.9;
  const hingeY = HY + fy * 1.2 + ny * 1.9;
  const jx = hingeX + jcx * 4.1;
  const jy = hingeY + jcy * 4.1;
  const drawHead = () => {
    for (const [off, len] of [
      [-1.2, 9],
      [1.6, 7],
    ] as [number, number][]) {
      const bx = HX - fx * 1.5 - nx * (2.4 + off * 0.2);
      const by = HY - fy * 1.5 - ny * (2.4 + off * 0.2);
      const hornPts = spline(
        [
          [bx, by],
          [bx - fx * len * 0.5 - nx * 3.2, by - fy * len * 0.5 - ny * 3.2],
          [bx - fx * len - nx * (4 + (len > 8 ? 2 : 0)), by - fy * len - ny * (4 + (len > 8 ? 2 : 0))],
        ],
        4,
      );
      hornPts.forEach(([x, y], i) => {
        const rr = 1.5 - (i / hornPts.length) * 1.1;
        shadeEll(p, x, y, rr + 0.2, rr + 0.2, SRP.horn);
      });
    }
    shadeEll(p, HX, HY, 5, 4, SRP.scale);
    if (r.jaw > 0.05) {
      // Пасть между челюстями: тёмная, в глубине — жар.
      poly(
        p,
        [
          [hingeX - fx * 0.5, hingeY - fy * 0.5],
          [snx + fx * 3.4 + nx * 0.8, sny + fy * 3.4 + ny * 0.8],
          [jx + jcx * 3, jy + jcy * 3],
        ],
        SRP.mouth,
      );
    }
    shadeEllR(p, jx, jy, 3.9, 1.5, Math.atan2(jcy, jcx), SRP.belly, -0.1);
    shadeEllR(p, snx, sny, 4.3, 2.6, ha, SRP.scale);
    // Надбровье.
    shadeEllR(p, HX + fx * 1.2 - nx * 2.2, HY + fy * 1.2 - ny * 2.2, 2.6, 1.3, ha, SRP.scale, 0.2);
  };

  const drawNear = () => {
    const hip = onChest(7, 5);
    const [fx1, fy1] = legFoot(10, 0);
    leg2(p, hip[0], hip[1], fx1, fy1, false);
  };
  const [nsx, nsy] = onChest(-1, -6);

  // Порядок: голова, ушедшая далеко назад-вверх, — за грудью.
  const headBehind = HY < CY - 26 && HX < CX + 4;
  if (headBehind) {
    drawNeck();
    drawHead();
    drawChest();
    drawNear();
    wing2(p, nsx, nsy, r, false);
  } else if (back) {
    // Оглянулся через плечо: шея — под крылом, голова — поверх.
    drawChest();
    drawNeck();
    drawNear();
    wing2(p, nsx, nsy, r, false);
    drawHead();
  } else {
    drawChest();
    drawNeck();
    drawHead();
    drawNear();
    wing2(p, nsx, nsy, r, false);
  }

  const bb = bboxOf(p);
  if (bb) outlineIn(p, INK, bb[0], bb[1], bb[2], bb[3]);

  // После контура: зубы, язык, глаз, ноздри, дым, звёзды.
  if (r.jaw > 0.08) {
    for (let k = 0; k < 3; k++) {
      p.set(
        Math.round(snx + fx * (k * 1.4 - 0.8) + nx * 2),
        Math.round(sny + fy * (k * 1.4 - 0.8) + ny * 2),
        SRP.horn[3],
      );
      p.set(
        Math.round(jx + jcx * (k * 1.3 - 0.4) - (-jcy) * 1.3 * (ny >= 0 ? 1 : -1)),
        Math.round(jy + jcy * (k * 1.3 - 0.4) - jcx * 1.3),
        SRP.horn[3],
      );
    }
  }
  if (r.tongue > 0.05 && r.jaw < 0.5) {
    // Раздвоенный язык: из кончика пасти, вперёд.
    const L = 1 + r.tongue * 4.5;
    const tx0 = snx + fx * 4 + nx * 1.4;
    const ty0 = sny + fy * 4 + ny * 1.4;
    for (let i = 0; i <= L; i++) p.set(Math.round(tx0 + fx * i), Math.round(ty0 + fy * i), SRP.tongue);
    const ex = tx0 + fx * L;
    const ey = ty0 + fy * L;
    p.set(Math.round(ex + fx - nx), Math.round(ey + fy - ny), SRP.tongue);
    p.set(Math.round(ex + fx + nx), Math.round(ey + fy + ny), SRP.tongue);
  }
  const ex = Math.round(HX + fx * 1.4 - nx * 1.2);
  const ey = Math.round(HY + fy * 1.4 - ny * 1.2);
  let eye: [number, number] | null = null;
  if (r.shut > 0.6) {
    p.set(ex, ey, INK);
    p.set(ex + (fx >= 0 ? 1 : -1), ey, INK);
  } else {
    const hot = r.angry > 0.5 ? hx('#ff7a20') : hx('#ff8a20');
    p.set(ex, ey, SRP.eye);
    p.set(ex + (fx >= 0 ? 1 : -1), ey, r.shut > 0.3 ? SRP.scale[0] : WHITE);
    p.set(ex, ey + 1, hot);
    if (r.angry > 0.5) p.set(ex - (fx >= 0 ? 1 : -1), ey - 1, INK);
    eye = [ex, ey];
    // Сам глаз светится движком (`eye`); здесь — только злой отсвет.
    if (r.angry > 0.5) lit.set(ex, ey + 1, alpha(hot, 0.8));
  }
  // Ноздря.
  const nosX = snx + fx * 3.4 - nx * 1;
  const nosY = sny + fy * 3.4 - ny * 1;
  p.set(Math.round(nosX), Math.round(nosY), INK);
  if (r.smoke >= 0) puff(p, nosX + fx, nosY - 1, r.smoke, fx >= 0 ? -0.6 : 0.6);

  // Морда в камне: всё, что ниже земли у головы, срезано (и зубы тоже), по
  // краю — вывороченные камешки.
  if (r.buried > 0) {
    const cutY = SAY - 1 + Math.round((1 - r.buried) * 6);
    for (let y = cutY; y < SH; y++)
      for (let x = Math.round(HX - 12); x <= Math.round(HX + 14); x++) clear(p, x, y);
    if (r.buried > 0.4) {
      const bx0 = Math.round(snx);
      for (let i = 0; i < 6; i++) {
        const x = bx0 - 6 + Math.round(hash(i, 3) * 13);
        const y = cutY - (hash(i, 7) < 0.4 ? 1 : 0);
        p.set(x, y, BASALT[hash(i, 9) < 0.5 ? 2 : 3]);
        p.set(x + 1, y, BASALT[1]);
        p.set(x, y + 1, INK);
      }
    }
  }
  // Жар: горло светится сквозь щитки, пасть горит, пламя.
  if (r.glow > 0.22) {
    const n = Math.round(2 + r.glow * 9);
    for (let i = 0; i < n; i++) {
      const k = i / Math.max(1, n - 1);
      const idx = Math.round(k * (neck.length - 1) * 0.9);
      const [x, y] = neck[idx];
      const [ax, ay] = neck[Math.max(0, idx - 1)];
      const tl = Math.hypot(x - ax, y - ay) || 1;
      let bnx = -(y - ay) / tl;
      let bny = (x - ax) / tl;
      if (bnx * sgn < -0.2 && !back) {
        bnx = -bnx;
        bny = -bny;
      }
      const rr = neckR(idx / (neck.length - 1));
      const c = r.glow > 0.7 ? LAVA.white : r.glow > 0.4 ? LAVA.bright : LAVA.hot;
      const a = clamp01(0.35 + r.glow * 0.65);
      lit.set(Math.round(x + bnx * rr * 0.55), Math.round(y + bny * rr * 0.55), alpha(c, a));
      if (r.bulge > 0.3) lit.set(Math.round(x + bnx * rr * 0.3), Math.round(y + bny * rr * 0.3), alpha(LAVA.hot, a * 0.6));
    }
  }
  if (r.jaw > 0.08) {
    const mx = Math.round((snx + jx) / 2 + fx * 0.6);
    const my = Math.round((sny + jy) / 2 + fy * 0.6);
    const hot = r.glow > 0.5 ? LAVA.white : LAVA.hot;
    p.set(mx, my, hot);
    p.set(mx - Math.round(fx), my - Math.round(fy), LAVA.bright);
    lit.set(mx, my, hot);
    lit.set(mx - Math.round(fx), my - Math.round(fy), alpha(LAVA.bright, 0.8));
  }
  if (r.fire > 0.02) {
    // Язык пламени изо рта (струя по полу — у «Техник»): белое у пасти.
    const n = Math.round(4 + r.fire * 6);
    const seed = Math.round(r.fire * 97 + r.hx * 13 + r.hy * 7);
    for (let i = 0; i < n; i++) {
      const d = 3.5 + i * 1.7;
      const wob = (hash(i, seed) - 0.5) * (1 + i * 0.25);
      const x = snx + fx * d + nx * (1.2 + wob);
      const y = sny + fy * d + ny * (1.2 + wob);
      const rr = (0.9 + i * 0.32) * (0.7 + r.fire * 0.3);
      const c = i < 2 ? LAVA.white : i < 4 ? FIRE[3] : i < 7 ? FIRE[2] : FIRE[1];
      lit.ell(x, y, rr, rr * 0.85, alpha(c, 0.95 - i * 0.05));
    }
  }
  if (heat > 0.02) {
    // Жилы жара: между щитками груди и по шее — лава под чешуёй.
    const col = heat > 0.75 ? LAVA.bright : LAVA.hot;
    for (let y = Math.floor(CY - 9); y <= CY + 9; y++)
      for (let x = Math.floor(CX - 11); x <= CX + 11; x++) {
        if (!p.solid(x, y)) continue;
        const lx = ((x - CX) * ct + (y - CY) * st) / 11;
        const ly = (-(x - CX) * st + (y - CY) * ct) / 9;
        if (lx * lx + ly * ly > 0.8) continue;
        if (!veinAt(lx * 11 + 40, ly * 9 + 40, 5)) continue;
        lit.set(x, y, alpha(col, 0.35 + heat * 0.6));
      }
    neck.forEach(([x, y], i) => {
      if (i % 2) return;
      if (hash(i, 17) > 0.25 + heat * 0.5) return;
      lit.set(Math.round(x), Math.round(y), alpha(col, 0.3 + heat * 0.5));
    });
  }
  if (r.stars > 0.02) {
    // Звёзды над головой — кружат (фаза — в `stars` дробью), ближняя крупнее.
    const ph = r.stars * TAU;
    const c1 = hx('#fff27a');
    const c2 = hx('#ffb030');
    for (let i = 0; i < 3; i++) {
      const a = ph + (i / 3) * TAU;
      const x = Math.round(HX + Math.cos(a) * 7.5);
      const y = Math.round(HY - 9 + Math.sin(a) * 2.6);
      const near = Math.sin(a) > -0.2;
      lit.set(x, y, WHITE);
      lit.set(x - 1, y, c1);
      lit.set(x + 1, y, c1);
      lit.set(x, y - 1, c1);
      lit.set(x, y + 1, c1);
      if (near) {
        lit.set(x - 2, y, alpha(c2, 0.8));
        lit.set(x + 2, y, alpha(c2, 0.8));
        lit.set(x, y - 2, alpha(c2, 0.8));
        lit.set(x, y + 2, alpha(c2, 0.8));
      }
    }
  }
  // Смерть: остывает в обсидиан, трещины гаснут, потом рассыпается пеплом.
  if (r.cool > 0 || r.crumble > 0) {
    const d = p.data;
    for (let i = 0; i < d.length; i += 4) {
      if (!d[i + 3]) continue;
      const l = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255;
      const o = tone(COOLED, l * 1.7 - 0.25);
      const k = clamp01(r.cool);
      d[i] = d[i] + (o[0] - d[i]) * k;
      d[i + 1] = d[i + 1] + (o[1] - d[i + 1]) * k;
      d[i + 2] = d[i + 2] + (o[2] - d[i + 2]) * k;
    }
    if (r.crumble > 0) {
      for (let y = 0; y < SH; y++)
        for (let x = 0; x < SW; x++) {
          const i = (y * SW + x) * 4;
          if (!d[i + 3]) continue;
          // Распад сверху вниз и дизером: пепел уходит клочьями.
          const k = r.crumble * 1.6 - (y - (SAY - 40)) / 60;
          if (hash(x >> 1, y >> 1, 31) < k) d[i + 3] = 0;
        }
    }
  }
  return { img: p, lit, eye };
}

// ---- Техники: метроном — мозг (`SERP` в f6-brains.ts, эхо — f15) ---------

/** Тайминги режимов змея при спешке h (эхо на 15-м — свои, без спешки). */
interface SerpT {
  bite: number;
  biteEnd: number;
  lunge: number;
  tail: number;
  tailEnd: number;
  wave: number;
  fireEnd: number;
  waveEnd: number;
  sweep: number;
  span: number;
  sweepEnd: number;
  fan: boolean;
  recover: number;
  dizzy: number;
  follow: number;
  lock: number;
}

const tmCache = new Map<string, SerpT>();
function timing(h: number, echo: boolean): SerpT {
  const key = `${h}|${echo ? 1 : 0}`;
  const hit = tmCache.get(key);
  if (hit) return hit;
  const t: SerpT = echo
    ? {
        bite: 0.67,
        biteEnd: 0.82,
        lunge: 9,
        tail: 0.8,
        tailEnd: 1.5,
        wave: 1.05,
        fireEnd: 1.3,
        waveEnd: 1.35,
        sweep: 1.0,
        span: 0.3,
        sweepEnd: 1.4,
        fan: false,
        recover: 0.6,
        dizzy: 1.1,
        follow: 1.1,
        lock: 0.55,
      }
    : {
        bite: 0.6 / h,
        biteEnd: 0.6 / h + 0.18 + 0.75 / h,
        lunge: 18,
        tail: 0.8 / h,
        tailEnd: 0.8 / h + 0.7,
        wave: 1.05 / h,
        fireEnd: (1.05 + 1.1) / h + 0.12,
        waveEnd: 1.05 / h + 2.22,
        sweep: 1 / h,
        span: 1.2 / h,
        sweepEnd: 1 / h + 1.2 / h + 0.9,
        fan: true,
        recover: 0.6 / h,
        dizzy: 2.1 / Math.max(1, h * 0.95),
        follow: 1.1 / h,
        lock: 0.55,
      };
  tmCache.set(key, t);
  return t;
}

type Tech =
  | 'idle'
  | 'crawl'
  | 'roar'
  | 'bite'
  | 'tail'
  | 'breath'
  | 'sweep'
  | 'takeoff'
  | 'fly'
  | 'mark'
  | 'dive'
  | 'dizzy'
  | 'summon'
  | 'recover'
  | 'death';

/** Откуда пришли в `recover` — чем кончилась техника. */
const FROM: Record<string, number> = {
  f6_bite: 1,
  f6_tail: 2,
  f6_wave: 3,
  f6_sweep: 4,
  dizzy: 5,
  f6_summon: 6,
  roar: 7,
};

interface TCtx {
  h: number;
  tm: SerpT;
  /** Прицел в кадре (смотрит вправо): 0 — вперёд, + — вниз, рад. */
  aim: number;
  /** Вариант: откуда (recover), направление веера (sweep), второй нырок (mark). */
  v: number;
  /** Номер кадра — для дрожи и мерцания (детерминированно). */
  f: number;
}

interface SPose {
  r: Rig;
  /** Сдвиг всего кадра (в кадре, смотрит вправо), сжатие, подъём груди над полом. */
  dx: number;
  dy: number;
  sx: number;
  sy: number;
  lift: number;
  ghost: boolean;
  /** След пасти: точки морды прошлых мгновений (светится). */
  smear?: P2[];
}

const pose0 = (r: Rig): SPose => ({ r, dx: 0, dy: 0, sx: 1, sy: 1, lift: 0, ghost: false });

type TKey = [number, number, Ease?];
/** Одна величина по ключам времени. */
function track(keys: TKey[]): (t: number) => number {
  return (t: number) => {
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      if (t > keys[i][0]) continue;
      const [t0, v0] = keys[i - 1];
      const [t1, v1, e] = keys[i];
      return v0 + (v1 - v0) * (e ?? EZ.io)((t - t0) / Math.max(1e-6, t1 - t0));
    }
    return keys[keys.length - 1][1];
  };
}

/** Взгляд на героя в покое и на ходу: голова выше или ниже. */
function lookAt(r: Rig, lv: number): Rig {
  if (!lv) return r;
  return { ...r, hy: r.hy + lv * 6, hx: r.hx - Math.abs(lv) * 1.5, ha: r.ha + lv * 0.55 };
}

function techIdle(f: number, lv: number): SPose {
  const ph = (f / 24) * TAU;
  const r = { ...REST };
  // Дыхание: грудь поднимается, голова отстаёт, крылья чуть расходятся.
  r.by = -Math.sin(ph) * 0.8;
  r.hy = -30 - Math.sin(ph - 0.7) * 1.1;
  r.hx = 17 + Math.sin(ph + 1.2) * 0.5;
  r.ha = 0.25 + Math.sin(ph - 1.1) * 0.05;
  r.ws = 0.06 + (1 - Math.cos(ph)) * 0.05;
  r.glow = 0.1 + (1 - Math.cos(ph)) * 0.05;
  // Дымок из ноздрей — две струйки на цикл; язык — пробует воздух.
  r.smoke = (f % 12) / 12;
  const tg = [0, 0.6, 1, 0.4, 1, 0.2];
  r.tongue = f >= 9 && f < 15 ? tg[f - 9] : 0;
  r.shut = f === 21 ? 0.5 : f === 22 ? 1 : f === 23 ? 0.5 : 0;
  return pose0(lookAt(r, lv));
}

function techCrawl(f: number, lv: number): SPose {
  const ph = (f / 8) * TAU;
  const r = { ...REST };
  r.bx = Math.sin(ph) * 0.8;
  r.by = 0.4 - Math.abs(Math.cos(ph)) * 0.9;
  r.tilt = 0.07 + Math.sin(ph) * 0.03;
  r.hx = 19 + Math.cos(ph) * 0.8;
  r.hy = -28 + Math.sin(ph * 2) * 0.7;
  r.ha = 0.3 + Math.sin(ph + 0.8) * 0.05;
  r.bend = 0.25 + Math.sin(ph) * 0.35;
  r.step = ph;
  r.stepA = 3.4;
  r.ws = 0.03 + Math.max(0, Math.sin(ph)) * 0.04;
  r.glow = 0.1;
  return pose0(lookAt(r, lv));
}

// Кэш дорожек: ключи зависят от спешки и прицела.
const laneCache = new Map<string, (t: number) => Rig>();
function laneOf(key: string, make: () => (t: number) => Rig): (t: number) => Rig {
  let l = laneCache.get(key);
  if (!l) {
    l = make();
    laneCache.set(key, l);
  }
  return l;
}
const trackCache = new Map<string, (t: number) => number>();
function trackOf(key: string, keys: () => TKey[]): (t: number) => number {
  let l = trackCache.get(key);
  if (!l) {
    l = track(keys());
    trackCache.set(key, l);
  }
  return l;
}

/** Морда (кончик) рига — для следа пасти. */
function snoutOf(r: Rig): P2 {
  return [r.hx + Math.cos(r.ha) * 8.5, r.hy + Math.sin(r.ha) * 8.5];
}

/** Укус: голова откидывается, шея пружиной, бросок, щелчок челюстей в миг урона, трёпка, отпускает. */
function techBite(t: number, c: TCtx): SPose {
  const { tm, aim } = c;
  const T = tm.bite;
  const E = tm.biteEnd;
  const k = `${T}|${E}|${aim}`;
  const ux = Math.cos(aim);
  const uy = Math.sin(aim);
  // Взвод: голова назад и вверх, смотрит на цель; удар: вдоль прицела к земле.
  const coil = { x: 3 - ux * 5, y: -37 + uy * 5 };
  const hit = { x: ux * 29, y: uy * 29 - 10 };
  const haCoil = aim * 0.75 - 0.12;
  const haHit = aim + 0.3 * Math.cos(aim);
  const guard = { x: lerp(hit.x, REST.hx, 0.55), y: lerp(hit.y, REST.hy, 0.55) - 2 };
  const haGuard = lerp(haHit, REST.ha, 0.5);
  const L = laneOf(`bite|${k}`, () =>
    lane(REST, [
      [0, {}],
      [
        0.5 * T,
        {
          hx: coil.x,
          hy: coil.y,
          ha: haCoil,
          bend: -1,
          by: 1.8,
          bx: -2.5,
          tilt: 0.12,
          ws: 0.35,
          wf: 0.5,
          jaw: 0.15,
          angry: 1,
          glow: 0.35,
        },
        EZ.out,
      ],
      [T - 0.1, { hx: coil.x - 0.8, hy: coil.y - 1, jaw: 0.3, by: 2, glow: 0.5 }, EZ.io],
      [
        T - 0.045,
        { hx: lerp(coil.x, hit.x, 0.45), hy: lerp(coil.y, hit.y, 0.45), ha: lerp(haCoil, haHit, 0.5), jaw: 1, bend: -0.3 },
        EZ.in,
      ],
      [T, { hx: hit.x, hy: hit.y, ha: haHit, jaw: 0, bend: 0.05, by: -1, bx: 1.5, tilt: -0.05, ws: 0.2, wf: -0.4, glow: 0.8 }, EZ.in],
      [T + 0.07, { hx: hit.x + ux * 2, hy: hit.y + uy * 2 + 1, jaw: 0 }, EZ.out2],
      [T + 0.18, { hx: hit.x, hy: hit.y, jaw: 0.05, by: 0, bx: 0.5, wf: 0.1 }, EZ.io],
      // Отпустил — голова отскакивает в стойку (не висит вытянутой).
      [
        T + 0.44,
        { hx: guard.x, hy: guard.y, ha: haGuard, jaw: 0.5, bend: -0.35, glow: 0.3, angry: 0.8, ws: 0.15 },
        EZ.out,
      ],
      [E, { hx: guard.x + 1, hy: guard.y - 1.5, ha: haGuard - 0.05, jaw: 0.2, bend: -0.2, angry: 0.5, bx: 0, tilt: 0, glow: 0.15, ws: 0.1, wf: 0 }, EZ.io],
    ]),
  );
  const r = L(t);
  // Сжатая пружина дрожит; после щелчка — трёпка головой.
  if (t > 0.5 * T && t < T - 0.1) r.hx += c.f % 2 ? 0.5 : -0.5;
  if (t > T + 0.02 && t < T + 0.32) r.ha += Math.sin((t - T) * TAU * 11) * 0.2 * (1 - seg(t, T, T + 0.32));
  if (t > T + 0.36) r.smoke = ((t - T - 0.36) * 1.8) % 1;
  const lunge = trackOf(`bitel|${k}|${tm.lunge}`, () => [
    [0, 0],
    [T - 0.1, -3, EZ.out2],
    [T, tm.lunge, EZ.in],
    [T + 0.18, tm.lunge],
    [E, tm.lunge > 12 ? tm.lunge : 0, EZ.io],
  ])(t);
  const ps = pose0(r);
  ps.dx = ux * lunge;
  ps.dy = uy * lunge;
  const sq = seg(t, 0, 0.5 * T) * (1 - seg(t, T - 0.1, T));
  const st = seg(t, T - 0.1, T) * (1 - seg(t, T + 0.1, T + 0.3));
  ps.sx = 1 + sq * 0.035 + st * 0.04;
  ps.sy = 1 - sq * 0.035 - st * 0.02;
  ps.ghost = t > T - 0.1 && t < T + 0.12;
  if (t > T - 0.08 && t < T + 0.06) {
    ps.smear = [];
    for (let i = 1; i <= 4; i++) {
      const q = L(Math.max(0, t - i / 60));
      const [sx, sy] = snoutOf(q);
      // Выпад самого кадра — в следе тоже.
      const lp = trackOf(`bitel|${k}|${tm.lunge}`, () => [])(Math.max(0, t - i / 60));
      ps.smear.push([sx + ux * (lp - lunge), sy + uy * (lp - lunge)]);
    }
  }
  return ps;
}

/** Хвост вкруговую: голова через плечо на героя, хлёст — голова навстречу, крылья для равновесия. */
function techTail(t: number, c: TCtx): SPose {
  const T = c.tm.tail;
  const E = c.tm.tailEnd;
  const L = laneOf(`tail|${T}|${E}`, () =>
    lane(REST, [
      [0, {}],
      [
        0.5 * T,
        { hx: -5, hy: -40, ha: Math.PI - 0.62, bend: -0.5, bx: 1.5, by: 1, ws: 0.45, wf: 0.2, angry: 1, jaw: 0.3, tongue: 0.6, tilt: 0.08, glow: 0.3 },
        EZ.out,
      ],
      [T - 0.07, { hx: -6, hy: -40, ha: Math.PI - 0.55, jaw: 0.45, tongue: 0 }, EZ.io],
      [T + 0.02, { hx: 20, hy: -27, ha: 0.45, bend: 0.05, bx: -2.5, ws: 0.95, wf: -0.6, jaw: 0.75, tilt: -0.05 }, EZ.in],
      [T + 0.2, { hx: 19, hy: -29, ha: 0.3, bx: 0.5, ws: 0.7, wf: 0.35, jaw: 0.3 }, EZ.out],
      [E, { hx: 17, hy: -30, ha: 0.25, bend: 0.15, bx: 0, by: 0, ws: 0.1, wf: 0, jaw: 0, angry: 0.4, tilt: 0, glow: 0.12 }, EZ.io],
    ]),
  );
  const r = L(t);
  // Хвост трещит на взводе — грудь мелко дрожит.
  if (t > 0.5 * T && t < T - 0.07) r.bx += c.f % 2 ? 0.5 : -0.5;
  const ps = pose0(r);
  return ps;
}

/** Точка головы на выдохе в сторону прицела a. */
function breathHead(a: number): { x: number; y: number; ha: number } {
  return { x: 9 + Math.cos(a) * 17, y: -36 + Math.sin(a) * 15, ha: a + 0.62 * Math.cos(a) };
}

/** Волна пламени: встаёт на дыбы, вдох — горло наливается жаром, выброс вперёд-вниз, струя, дым. */
function techBreath(t: number, c: TCtx, T: number, F1: number, E: number): SPose {
  const b = breathHead(c.aim);
  const L = laneOf(`breath|${T}|${F1}|${E}|${c.aim}`, () =>
    lane(REST, [
      [0, {}],
      [
        0.72 * T,
        { by: -7, tilt: -0.3, bx: -2.5, hx: 10, hy: -50, ha: -0.75, bend: -0.7, bulge: 1, glow: 0.8, jaw: 0.3, ws: 0.7, wf: 0.45, paw: 1, angry: 0.6, step: Math.PI },
        EZ.out2,
      ],
      [T - 0.05, { hy: -52, hx: 8.5, glow: 1, jaw: 0.38 }, EZ.io],
      [T, { by: -6, tilt: -0.22, bx: -1, hx: b.x, hy: b.y, ha: b.ha, bend: 0.95, jaw: 1, fire: 1, bulge: 0.85, paw: 0.35, ws: 0.5, wf: 0, step: TAU }, EZ.in],
      [T + 0.1, { bx: -3.5 }, EZ.out2],
      [F1, { bulge: 0.3, glow: 0.55, bx: -2.5, fire: 0.85 }, EZ.lin],
      [F1 + 0.3, { fire: 0, jaw: 0.4, glow: 0.3, bulge: 0 }, EZ.out2],
      [E, { by: 0, tilt: 0, bx: 0, hx: 17, hy: -30, ha: 0.25, bend: 0.15, jaw: 0, ws: 0.08, wf: 0, paw: 0, angry: 0.2, glow: 0.12 }, EZ.io],
    ]),
  );
  const r = L(t);
  if (t < T) r.smoke = (t * 2.2) % 1;
  else if (t > F1) r.smoke = ((t - F1) * 1.6) % 1;
  if (t >= T && t < F1) {
    // Струя бьёт: мерцание пламени и дрожь головы от напора.
    r.fire *= c.f % 2 ? 0.86 : 1;
    r.hx += c.f % 2 ? 0.5 : -0.3;
    r.hy += c.f % 3 === 0 ? 0.5 : 0;
  }
  // Лапы на дыбах перебирают воздух.
  if (t < T) r.step += t * 7;
  const ps = pose0(r);
  // Отдача выдоха: чуть назад.
  ps.dx = -2 * Math.cos(c.aim) * seg(t, T, T + 0.1) * (1 - seg(t, F1, E));
  const rise = seg(t, 0, 0.72 * T) * (1 - seg(t, T - 0.05, T + 0.2));
  ps.sy = 1 + rise * 0.03;
  ps.sx = 1 - rise * 0.02;
  return ps;
}

/** Угол веера в кадре в момент t (сторона и направление — от мозга). */
function fanAim(t: number, c: TCtx): number {
  const k = clamp01((t - c.tm.sweep) / c.tm.span);
  return clamp(c.aim + c.v * (k - 0.5) * 3.3, -1.95, 1.95);
}

/** Пламя веером: голова ведёт струю от края к краю, тело доворачивается следом. */
function techSweep(t: number, c: TCtx): SPose {
  const T = c.tm.sweep;
  const S = c.tm.span;
  const E = c.tm.sweepEnd;
  const a0 = fanAim(T, c);
  const a1 = fanAim(T + S, c);
  const b0 = breathHead(a0);
  const b1 = breathHead(a1);
  const L = laneOf(`sweep|${T}|${S}|${E}|${c.aim}|${c.v}`, () =>
    lane(REST, [
      [0, {}],
      [
        0.72 * T,
        { by: -7, tilt: -0.3, bx: -2.5, hx: 10, hy: -50, ha: -0.75, bend: -0.7, bulge: 1, glow: 0.8, jaw: 0.3, ws: 0.7, wf: 0.45, paw: 1, angry: 0.6, step: Math.PI },
        EZ.out2,
      ],
      [T - 0.05, { hy: -52, hx: 8.5, glow: 1, jaw: 0.38 }, EZ.io],
      [T, { by: -6, tilt: -0.22, bx: -1, hx: b0.x, hy: b0.y, ha: b0.ha, bend: 0.95, jaw: 1, fire: 1, bulge: 0.85, paw: 0.35, ws: 0.55, wf: 0, step: TAU }, EZ.in],
      [T + S, { hx: b1.x, hy: b1.y, ha: b1.ha, bulge: 0.3, glow: 0.6, fire: 0.85 }, EZ.lin],
      [T + S + 0.3, { fire: 0, jaw: 0.4, glow: 0.3, bulge: 0 }, EZ.out2],
      [E, { by: 0, tilt: 0, bx: 0, hx: 17, hy: -30, ha: 0.25, bend: 0.15, jaw: 0, ws: 0.08, wf: 0, paw: 0, angry: 0.2, glow: 0.12 }, EZ.io],
    ]),
  );
  const r = L(t);
  if (t > T && t < T + S) {
    const b = breathHead(fanAim(t, c));
    r.hx = b.x;
    r.hy = b.y;
    r.ha = b.ha;
    // Грудь доворачивает за головой.
    r.bx = -1.5 + Math.cos(fanAim(t, c)) * 1.5;
    r.fire *= c.f % 2 ? 0.86 : 1;
    r.hx += c.f % 2 ? 0.4 : -0.3;
  }
  if (t < T) r.smoke = (t * 2.2) % 1;
  else if (t > T + S) r.smoke = ((t - T - S) * 1.6) % 1;
  if (t < T) r.step += t * 7;
  const ps = pose0(r);
  const rise = seg(t, 0, 0.72 * T) * (1 - seg(t, T - 0.05, T + 0.2));
  ps.sy = 1 + rise * 0.03;
  ps.sx = 1 - rise * 0.02;
  return ps;
}

const TAKEOFF = lane(REST, [
  [0, {}],
  [0.2, { by: 2.5, tilt: 0.12, hx: 21, hy: -24, ha: 0.4, bend: 0.4, ws: 1, wf: 1, angry: 0.6 }, EZ.out],
  [0.34, { by: -1, tilt: 0.05, hx: 22, hy: -30, ha: 0.2, wf: -1, tuck: 0.6 }, EZ.in],
  [0.56, { wf: 1, tuck: 1, hy: -29 }, EZ.io],
  [0.7, { wf: -1 }, EZ.in],
  [0.9, { wf: 0.5, hx: 22, hy: -27, ha: 0.45, bend: 0.35, tilt: 0.08 }, EZ.io],
]);
const TAKEOFF_LIFT = track([
  [0, 0],
  [0.22, 0],
  [0.34, 14, EZ.out2],
  [0.56, 20, EZ.out2],
  [0.7, 32, EZ.out2],
  [0.9, 34, EZ.out2],
]);

/** Взлёт: присел, крылья вверх, два маха — поднимается рывками на каждом ударе вниз. */
function techTakeoff(t: number): SPose {
  const ps = pose0(TAKEOFF(t));
  ps.lift = TAKEOFF_LIFT(t);
  ps.dy = -ps.lift;
  const sq = seg(t, 0, 0.2) * (1 - seg(t, 0.22, 0.3));
  const st = seg(t, 0.24, 0.32) * (1 - seg(t, 0.36, 0.5));
  ps.sx = 1 + sq * 0.08 - st * 0.05;
  ps.sy = 1 - sq * 0.1 + st * 0.08;
  return ps;
}

/** Взмах крыла по фазе удара b (0…1): вниз быстро, вверх медленно; подъём на ударе вниз. */
function beat(b: number, down = 0.4): { wf: number; up: number } {
  if (b < down) {
    const k = EZ.in(b / down);
    return { wf: 1 - 2 * k, up: EZ.out2(b / down) };
  }
  const k = EZ.io((b - down) / (1 - down));
  return { wf: -1 + 2 * k, up: 1 - k };
}

function flyRig(b: number): Rig {
  const { wf } = beat(b);
  return {
    ...REST,
    hx: 22 + Math.sin(b * TAU) * 0.6,
    hy: -27 + Math.cos(b * TAU) * 0.8,
    ha: 0.45,
    bend: 0.35,
    tilt: 0.08,
    ws: 1,
    wf,
    tuck: 1,
    glow: 0.2,
  };
}

function techFly(f: number): SPose {
  const b = (f % 12) / 12;
  const ps = pose0(flyRig(b));
  ps.lift = 34 + beat(b).up * 3;
  ps.dy = -ps.lift;
  return ps;
}

const HOVER_T = 14 / 24;
function hoverRig(b: number): Rig {
  const { wf } = beat(b, 0.45);
  return {
    ...REST,
    hx: 19,
    hy: -22 + Math.cos(b * TAU) * 0.7,
    ha: 1.05,
    bend: 0.7,
    tilt: 0.06,
    ws: 1,
    wf,
    tuck: 1,
    jaw: 0.2,
    angry: 1,
    glow: 0.35,
  };
}

/** Метка: висит над кругом, морда вниз; взвод — выше, крылья вверх; пике — вниз, в миг удара — земля. */
function techMark(t: number, c: TCtx): SPose {
  const F = c.tm.follow;
  const Lk = c.tm.lock;
  const b = ((t / HOVER_T) % 1 + 1) % 1;
  let r = hoverRig(b);
  let lift = 38 + beat(b, 0.45).up * 2.5;
  let sx = 1;
  let sy = 1;
  let ghost = false;
  if (c.v === 1 && t < 0.75) {
    // Второй нырок: из камня — снова вверх, мощным махом.
    const k = seg(t, 0.35, 0.72);
    const up = EZ.out2(k);
    const from: Rig = { ...REST, hx: 19, hy: -6, ha: 1.2, ws: 0.95, wf: -0.75, by: 3, tilt: 0.2, jaw: 0.6, angry: 1 };
    const w = seg(t, 0.35, 0.5);
    const mid: Rig = { ...from, wf: 1, ws: 1, hy: -24, ha: 0.7, by: 0, tilt: 0.05, tuck: 0.5 };
    r = k < 0.35 ? mixRig(from, mid, EZ.out(w)) : mixRig(mid, r, EZ.io(seg(t, 0.47, 0.72)));
    lift = lerp(0, lift, up);
    sx = 1 - 0.05 * Math.sin(k * Math.PI);
    sy = 1 + 0.08 * Math.sin(k * Math.PI);
  }
  if (t >= F) {
    const cock: Rig = { ...r, hx: 17, hy: -31, ha: 0.6, bend: -0.3, jaw: 0.45, wf: 1, ws: 1 };
    const kc = EZ.out(seg(t, F, F + 0.3));
    r = mixRig(r, cock, kc);
    lift = lerp(lift, 48, kc);
    if (t > F + 0.3 && t < F + 0.4) r.hx += c.f % 2 ? 0.4 : -0.4;
    if (t >= F + 0.4) {
      const kp = seg(t, F + 0.4, F + Lk);
      const dive: Rig = { ...r, ws: 0.35, wf: 0.3, ha: 1.25, hx: 18, hy: -16, jaw: 0.95, bend: 0.2, tuck: 0.4 };
      r = mixRig(r, dive, EZ.out2(kp));
      lift = 49 * (1 - EZ.in(kp));
      sx = 1 - 0.14 * EZ.in(kp);
      sy = 1 + 0.22 * EZ.in(kp);
      ghost = true;
    } else lift = Math.max(lift, lerp(48, 49, seg(t, F + 0.3, F + 0.4)));
  }
  const ps = pose0(r);
  ps.lift = lift;
  ps.dy = -lift;
  ps.sx = sx;
  ps.sy = sy;
  ps.ghost = ghost;
  return ps;
}

const DIVE = lane(REST, [
  [0, { hx: 19, hy: -6, ha: 1.25, buried: 0.5, jaw: 0.8, ws: 0.95, wf: -0.75, by: 3, tilt: 0.2, tuck: 0.3, angry: 1 }],
  [0.16, { hy: -4, buried: 0.8, jaw: 0.6, wf: -0.6 }, EZ.out2],
]);
/** Пике: удар о землю — сплющило, крылья распластаны, морда в камне. */
function techDive(t: number): SPose {
  const ps = pose0(DIVE(t));
  const k = EZ.out2(seg(t, 0, 0.16));
  ps.sx = lerp(1.28, 1.14, k);
  ps.sy = lerp(0.74, 0.88, k);
  return ps;
}

const DIZZY_BASE: Rig = {
  ...REST,
  hx: 21,
  hy: -3,
  ha: 1.3,
  buried: 1,
  by: 2.5,
  tilt: 0.28,
  wd: 1,
  ws: 0.4,
  shut: 1,
  jaw: 0.3,
  bend: 0.5,
  glow: 0.05,
};
const DIZ_LOOP = 24;
const DIZ_IN = 8;
const DIZ_OUT = 11;

/** Голова в камне: звёзды, два рывка «вытащить голову», вырвался и тряхнул мордой. */
function techDizzy(t: number, f: number, Td: number): SPose {
  let r: Rig;
  let sx = 1;
  let sy = 1;
  if (f < DIZ_IN) {
    const k = EZ.out2(clamp01(t / (DIZ_IN / SFPS)));
    r = mixRig(DIVE(0.16), DIZZY_BASE, k);
    r.stars = k > 0.4 ? t * 1.2 : 0;
    sx = lerp(1.14, 1, k);
    sy = lerp(0.88, 1, k);
  } else if (f < DIZ_IN + DIZ_LOOP) {
    const q = (f - DIZ_IN) / DIZ_LOOP;
    r = { ...DIZZY_BASE };
    const tug1 = Math.sin(seg(q, 0.08, 0.36) * Math.PI);
    const tug2 = Math.sin(seg(q, 0.55, 0.82) * Math.PI);
    r.bx = -2.5 * tug1 - 1.5 * tug2;
    r.by = 2.5 + 0.8 * tug1;
    r.bend = 0.5 - 0.6 * tug1 - 0.4 * tug2;
    r.wd = 1 - 0.55 * tug2;
    r.wf = 0.5 * tug2;
    r.hy = -3 - tug1 * 0.6;
    r.stars = q;
    r.jaw = 0.3 + 0.2 * tug1;
  } else {
    const tt = (f - DIZ_IN - DIZ_LOOP) / SFPS;
    r = { ...DIZZY_BASE };
    const pull = Math.sin(seg(tt, 0, 0.2) * Math.PI * 0.5);
    r.bx = -3.5 * pull;
    const pop = EZ.out(seg(tt, 0.18, 0.3));
    r = mixRig(r, { ...REST, hx: 18, hy: -26, ha: 0.2, jaw: 0.5, wd: 0.3, ws: 0.3, shut: 0.5, bx: 0.5 }, pop);
    if (tt > 0.3) r.ha += Math.sin((tt - 0.3) * TAU * 7) * 0.3 * (1 - seg(tt, 0.3, 0.45));
    r.stars = pop < 0.5 ? 1 + tt : 0;
    sy = 1 + 0.05 * Math.sin(seg(tt, 0.18, 0.34) * Math.PI);
  }
  void Td;
  const ps = pose0(r);
  ps.sx = sx;
  ps.sy = sy;
  return ps;
}

const ROAR = lane(REST, [
  [0, {}],
  [0.3, { by: -4, tilt: -0.15, hx: 12, hy: -44, ha: -0.4, bend: -0.5, jaw: 0.2, ws: 0.45, wf: 0.4, bulge: 0.6, glow: 0.5, angry: 0.8 }, EZ.out2],
  [0.42, { hx: 22, hy: -47, ha: -0.55, jaw: 1, ws: 1, wf: 0.8, bulge: 0.25, glow: 0.9, paw: 0.7, bend: 0.1 }, EZ.in],
  [1.05, { hx: 23, hy: -46, jaw: 0.95, wf: 0.7 }, EZ.lin],
  [1.4, { ...REST, angry: 0.4 }, EZ.io],
]);

/** Рёв: вдох, пасть настежь, крылья во всю ширь, голова дрожит. */
function techRoar(t: number, f: number): SPose {
  const r = ROAR(t);
  if (t > 0.42 && t < 1.05) {
    r.hx += f % 2 ? 0.8 : -0.8;
    r.hy += (f % 3) - 1;
    r.wf += f % 2 ? 0.06 : -0.06;
    r.smoke = ((t - 0.42) * 2.5) % 1;
  }
  const ps = pose0(r);
  const k = seg(t, 0, 0.3) * (1 - seg(t, 1.05, 1.4));
  ps.sy = 1 + k * 0.03;
  ps.sx = 1 - k * 0.02;
  return ps;
}

const SUMMON = lane(REST, [
  [0, {}],
  [0.45, { by: -8, tilt: -0.35, bx: -1.5, hx: 11, hy: -55, ha: -1.15, bend: -0.4, jaw: 0.5, ws: 0.95, wf: 1, glow: 0.6, heat: 0.5, paw: 1, angry: 0.7 }, EZ.out2],
  [0.82, { glow: 1, heat: 1, jaw: 0.8, hy: -57 }, EZ.io],
  [0.92, { wf: -0.8, heat: 1.5, jaw: 1, ha: -1.3, hy: -58, by: -9 }, EZ.in],
  [1.1, { wf: -0.2, heat: 0.8 }, EZ.out],
  [1.5, { ...REST }, EZ.io],
]);

/** Призыв: встал к небу, жилы разгораются, зов — вспышка, крылья вниз. */
function techSummon(t: number, f: number): SPose {
  const r = SUMMON(t);
  if (t > 0.45 && t < 0.82) r.wf += f % 2 ? 0.08 : -0.08;
  r.step = t * 8;
  const ps = pose0(r);
  const k = seg(t, 0, 0.45) * (1 - seg(t, 1.1, 1.5));
  ps.sy = 1 + k * 0.035;
  ps.sx = 1 - k * 0.02;
  return ps;
}

const DEATH = lane(REST, [
  [0, { jaw: 0.6, angry: 1 }],
  [0.2, { by: -4, tilt: -0.2, hx: 13, hy: -50, ha: -0.9, jaw: 1, ws: 0.9, wf: 0.8, glow: 1, fire: 0.35, bulge: 0.4, bend: -0.5, shut: 0 }, EZ.out2],
  [0.28, { hy: -49, wf: 0.9 }, EZ.io],
  [0.62, { by: 3, tilt: 0.18, hx: 25, hy: -5, ha: 0.35, jaw: 0.35, ws: 0.35, wf: 0, wd: 1, glow: 0.15, fire: 0, bulge: 0, bend: 0.3, shut: 1, paw: 0, heat: 1.2 }, EZ.in],
  [0.7, { by: 3.5, hy: -4 }, EZ.out2],
  [0.85, { heat: 0.9 }, EZ.io],
  [1.12, { cool: 1, heat: 0 }, EZ.io],
  [1.5, { crumble: 1 }, EZ.lin],
]);
const DEATH_N = 36;

/** Смерть: последний рёв, голова падает, жилы вспыхивают и гаснут, остывает камнем, распадается. */
function techDeath(t: number): SPose {
  const ps = pose0(DEATH(t));
  ps.sy = 1 - 0.07 * Math.sin(seg(t, 0.6, 0.76) * Math.PI);
  ps.sx = 1 + 0.05 * Math.sin(seg(t, 0.6, 0.76) * Math.PI);
  return ps;
}

/** Чем кончилась техника: поза, с которой начинается возврат. */
function exitPose(from: number, c: TCtx): Rig {
  const tm = c.tm;
  switch (from) {
    case 1:
      return techBite(tm.biteEnd, c).r;
    case 2:
      return techTail(tm.tailEnd, c).r;
    case 3:
      return techBreath(tm.waveEnd, c, tm.wave, tm.fireEnd, tm.waveEnd).r;
    case 4:
      return tm.fan ? techSweep(tm.sweepEnd, c).r : techBreath(tm.sweepEnd, c, tm.sweep, 1.3, tm.sweepEnd).r;
    case 5:
      return { ...REST, hx: 18, hy: -26, ha: 0.2, jaw: 0.5, wd: 0.3, ws: 0.3, shut: 0.5, bx: 0.5 };
    default:
      return { ...REST };
  }
}

/** Возврат: из конца прошлой техники к покою — с перелётом (укус) или вытряхивая звёзды (оглушение). */
function techRecover(t: number, c: TCtx): SPose {
  const R = c.tm.recover;
  const from = c.v;
  const a = exitPose(from, c);
  const k = seg(t, 0, R);
  const e = from === 1 ? EZ.back(k) : EZ.io(k);
  const r = mixRig(a, REST, e);
  if (from === 3 || from === 4) r.smoke = (t * 1.6) % 1;
  if (from === 5) {
    r.ha += Math.sin(t * TAU * 5) * 0.28 * (1 - k);
    r.shut = lerp(0.5, 0, k);
  }
  if (from === 1) r.smoke = (t * 1.8) % 1;
  return pose0(r);
}

/** Вздрог от удара героя: голова назад, прищур, крылья дёрнулись. */
function flinch(r: Rig, k: number): Rig {
  return {
    ...r,
    hx: r.hx - 3 * k,
    hy: r.hy - 2 * k,
    ha: r.ha - 0.15 * k,
    jaw: Math.max(r.jaw, 0.4 * k),
    shut: Math.max(r.shut, 0.8 * k),
    bx: r.bx - k,
    ws: r.ws + 0.15 * k,
  };
}

// ---- Кадр: запрос → поза → рисунок → кеш -----------------------------------

/** Жилы жара по фазам: чем злее змей, тем больше лавы между чешуй. */
const PH_HEAT = [0, 0.12, 0.42, 0.8];

interface SReq {
  tech: Tech;
  f: number;
  /** Спешка ×100 (фаза). */
  hk: number;
  echo: 0 | 1;
  /** Прицел: корзина по 15°, −6…6. */
  aim: number;
  v: number;
  /** Облик фазы 0…3. */
  ph: number;
  /** Взгляд в покое: −1 вверх, 0, 1 вниз. */
  lv: number;
  side: 0 | 1;
  flash: 0 | 1;
  look: Look;
  /** Вздрог 0…2. */
  fl: number;
}

const AIM_STEP = Math.PI / 12;

function ctxOf(q: SReq): TCtx {
  const h = q.hk / 100;
  return { h, tm: timing(h, !!q.echo), aim: q.aim * AIM_STEP, v: q.v, f: q.f };
}

/** Кадр f техники → время: 24 к/с, а кадр, где урон, — ровно в миг урона. */
function frameTime(f: number, hit: number): number {
  const t = f / SFPS;
  if (hit >= 0 && hit >= t && hit < t + 1 / SFPS) return hit;
  return t;
}

function hitOf(tech: Tech, c: TCtx): number {
  switch (tech) {
    case 'bite':
      return c.tm.bite;
    case 'tail':
      return c.tm.tail;
    case 'breath':
      return c.v === 1 ? c.tm.sweep : c.tm.wave;
    case 'sweep':
      return c.tm.sweep;
    case 'mark':
      return c.tm.follow + c.tm.lock;
    default:
      return -1;
  }
}

/** Сколько кадров у техники (для прогрева и потолка номера). */
function spanOf(tech: Tech, c: TCtx): number {
  const n = (s: number) => Math.ceil(s * SFPS) + 1;
  switch (tech) {
    case 'idle':
      return 24;
    case 'crawl':
      return 8;
    case 'fly':
      return 12;
    case 'roar':
      return n(1.4);
    case 'bite':
      return n(c.tm.biteEnd);
    case 'tail':
      return n(c.tm.tailEnd);
    case 'breath':
      return n(c.v === 1 ? c.tm.sweepEnd : c.tm.waveEnd);
    case 'sweep':
      return n(c.tm.sweepEnd);
    case 'takeoff':
      return n(0.9);
    case 'mark':
      return n(c.tm.follow + c.tm.lock);
    case 'dive':
      return 4;
    case 'dizzy':
      return DIZ_IN + DIZ_LOOP + DIZ_OUT;
    case 'summon':
      return n(1.5);
    case 'recover':
      return n(c.tm.recover);
    case 'death':
      return DEATH_N;
  }
}

function poseOf(q: SReq): SPose {
  const c = ctxOf(q);
  const t = frameTime(q.f, hitOf(q.tech, c));
  switch (q.tech) {
    case 'idle':
      return techIdle(q.f, q.lv);
    case 'crawl':
      return techCrawl(q.f, q.lv);
    case 'fly':
      return techFly(q.f);
    case 'roar':
      return techRoar(t, q.f);
    case 'bite':
      return techBite(t, c);
    case 'tail':
      return techTail(t, c);
    case 'breath':
      return q.v === 1
        ? techBreath(t, c, c.tm.sweep, 1.3, c.tm.sweepEnd)
        : techBreath(t, c, c.tm.wave, c.tm.fireEnd, c.tm.waveEnd);
    case 'sweep':
      return techSweep(t, c);
    case 'takeoff':
      return techTakeoff(t);
    case 'mark':
      return techMark(t, c);
    case 'dive':
      return techDive(t);
    case 'dizzy':
      return techDizzy(t, q.f, c.tm.dizzy);
    case 'summon':
      return techSummon(t, q.f);
    case 'recover':
      return techRecover(t, c);
    case 'death':
      return techDeath(t);
  }
}

interface SFrame {
  fr: MobFrame;
  ps: SPose;
}

const SFR = frameLRU<SFrame>(400);

function mirrorCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const g = c.getContext('2d');
  if (g) {
    g.translate(src.width, 0);
    g.scale(-1, 1);
    g.drawImage(src, 0, 0);
  }
  return c;
}

function flashCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const g = c.getContext('2d');
  if (g) {
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.fillRect(0, 0, c.width, c.height);
  }
  return c;
}

/** След пасти: огненная полоса по прошлым точкам морды (светится). */
function smearInto(lit: Px, pts: P2[], now: P2): void {
  let [px, py] = now;
  pts.forEach(([x, y], i) => {
    const k = 1 - i / pts.length;
    const w = 1.6 * k + 0.4;
    const n = Math.ceil(Math.hypot(x - px, y - py)) + 1;
    for (let j = 0; j <= n; j++) {
      const qx = SAX + px + ((x - px) * j) / n;
      const qy = SAY + py + ((y - py) * j) / n;
      lit.ell(qx, qy, w, w, alpha(k > 0.6 ? LAVA.white : k > 0.3 ? FIRE[2] : FIRE[1], 0.25 + 0.5 * k));
    }
    px = x;
    py = y;
  });
}

/** Кадр без зеркала и вспышки. */
function serpBase(q: SReq): SFrame {
  const key = `b|${q.tech}|${q.f}|${q.hk}|${q.echo}|${q.aim}|${q.v}|${q.ph}|${q.lv}|${q.fl}|${q.look}`;
  const hit = SFR.get(key);
  if (hit) return hit;
  const T0 = performance.now();
  const ps = poseOf(q);
  let r = ps.r;
  if (q.fl) r = flinch(r, q.fl / 2);
  if (!q.echo) r = { ...r, heat: Math.max(r.heat, PH_HEAT[q.ph] ?? 0) };
  const T1 = performance.now();
  const art = paintRig(r);
  const T2 = performance.now();
  if (ps.smear) smearInto(art.lit, ps.smear, snoutOf(r));
  if (q.look === 'elite') art.img.outline(GOLD);
  // Холст — по рисунку: кадры в кеше не держат пустоту.
  const b1 = bboxOf(art.img) ?? [SAX - 1, SAY - 1, SAX + 1, SAY + 1];
  const b2 = bboxOf(art.lit);
  const x0 = Math.min(b1[0], b2 ? b2[0] : 1e9);
  const y0 = Math.min(b1[1], b2 ? b2[1] : 1e9);
  const x1 = Math.max(b1[2], b2 ? b2[2] : -1);
  const y1 = Math.max(b1[3], b2 ? b2[3] : -1, SAY + 1);
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const img = canvasOf(art.img, x0, y0, w, h);
  const lit = b2 ? canvasOf(art.lit, x0, y0, w, h) : null;
  const T3 = performance.now();
  ((globalThis as unknown as { __f6t?: number[][] }).__f6t ??= []).push([T1 - T0, T2 - T1, T3 - T2]);
  const fr: MobFrame = {
    img,
    lit,
    ax: SAX - x0,
    ay: SAY - y0,
    eye: art.eye ? [art.eye[0] - x0, art.eye[1] - y0] : null,
    dx: ps.dx,
    dy: ps.dy,
    sx: ps.sx,
    sy: ps.sy,
    still: true,
    shadow: Math.round(15 - Math.min(6, ps.lift * 0.13)),
  };
  return SFR.set(key, { fr, ps });
}

/** Кадр по запросу: зеркало и вспышка удара — из кадра без них. */
function serpFrame(q: SReq): SFrame {
  if (!q.side && !q.flash) return serpBase(q);
  const key = `v|${q.tech}|${q.f}|${q.hk}|${q.echo}|${q.aim}|${q.v}|${q.ph}|${q.lv}|${q.fl}|${q.look}|${q.side}|${q.flash}`;
  const hit = SFR.get(key);
  if (hit) return hit;
  if (q.flash) {
    const src = serpFrame({ ...q, flash: 0 });
    return SFR.set(key, { fr: { ...src.fr, img: flashCanvas(src.fr.img) }, ps: src.ps });
  }
  const b = serpBase({ ...q, side: 0 });
  const w = b.fr.img.width;
  return SFR.set(key, {
    ps: b.ps,
    fr: {
      ...b.fr,
      img: mirrorCanvas(b.fr.img),
      lit: b.fr.lit ? mirrorCanvas(b.fr.lit) : null,
      eye: b.fr.eye ? [w - 1 - b.fr.eye[0], b.fr.eye[1]] : null,
      ax: w - b.fr.ax,
      dx: -(b.fr.dx ?? 0),
    },
  });
}

// ---- Память рисовальщика: сторона, взгляд, откуда пришёл, история груди ----

interface SerpMem {
  side: 0 | 1;
  lv: number;
  mode: string;
  prev: string;
  now: number;
  /** Пройдено ползком, px — шаг лап и волна тела. */
  walk: number;
  /** Где начался укус: выпад кадра гасит настоящий бросок моба. */
  bx0: number;
  by0: number;
  haste: number;
  flareT: number;
  /** Был ли нырок с последнего взлёта — второй взлёт из камня. */
  dived: boolean;
  /** История полёта для тела: [время, подъём]… */
  hist: number[];
  /** Сдвиг груди сейчас (мир, px) — к нему тянется начало тела. */
  cdx: number;
  cdy: number;
  /** На дыбах: насколько поднята грудь (начало тела идёт за ней). */
  rear: number;
  flash: number;
}

const serpMem = new WeakMap<Mob, SerpMem>();
/** Та же память по номеру — телу (зона знает только номер змея). */
const serpMemById = new Map<number, SerpMem>();

function memOf(m: Mob, pose: MobPose): SerpMem {
  let s = serpMem.get(m);
  if (!s) {
    s = {
      side: pose.left ? 1 : 0,
      lv: 0,
      mode: pose.mode,
      prev: '',
      now: pose.now,
      walk: 0,
      bx0: m.x,
      by0: m.y,
      haste: m.data?.haste ?? 1,
      flareT: -9,
      dived: false,
      hist: [],
      cdx: 0,
      cdy: 0,
      rear: 0,
      flash: 0,
    };
    serpMem.set(m, s);
  }
  serpMemById.set(m.id, s);
  if (serpMemById.size > 12) serpMemById.delete(serpMemById.keys().next().value as number);
  if (pose.mode !== s.mode) {
    s.prev = s.mode;
    s.mode = pose.mode;
    if (pose.mode === 'f6_bite') {
      s.bx0 = m.x;
      s.by0 = m.y;
    }
    if (pose.mode === 'f6_dive') s.dived = true;
    if (pose.mode === 'f6_takeoff' || pose.mode === 'chase') s.dived = false;
  }
  const dt = clamp(pose.now - s.now, 0, 0.1);
  s.now = pose.now;
  s.walk += Math.hypot(m.vx ?? 0, m.vy ?? 0) * 16 * dt;
  const hs = m.data?.haste ?? 1;
  if (hs > s.haste + 0.01) s.flareT = pose.now;
  s.haste = hs;
  s.flash = m.flash ?? 0;
  return s;
}

/** Угол в кадре (смотрит вправо) из угла мира и стороны. */
function frameAngle(a: number, side: 0 | 1): number {
  let x = side ? Math.PI - a : a;
  x = Math.atan2(Math.sin(x), Math.cos(x));
  return x;
}

/** Сторона по углу — с запасом, чтобы у вертикали не мигал. */
function sideOf(a: number, prev: 0 | 1): 0 | 1 {
  const c = Math.cos(a);
  if (Math.abs(c) < 0.25) return prev;
  return c < 0 ? 1 : 0;
}

const WALK_STRIDE = 30;

function serpReq(m: Mob, pose: MobPose): { q: SReq; s: SerpMem } {
  const s = memOf(m, pose);
  const echo = m.kind === 'f15b_echo_serpent' ? 1 : 0;
  const h = echo ? 1 : (m.data?.haste ?? 1);
  const hk = Math.round(h * 100);
  const ph = echo ? 0 : h >= 1.24 ? 3 : h >= 1.14 ? 2 : h >= 1.04 ? 1 : 0;
  const t = Math.max(0, pose.t);
  const sim = paintSim();
  const dir = m.dir ?? m.face ?? 0;
  // Куда смотреть: на героя (в покое), по броску (в технике), по полёту.
  const heroA = sim ? Math.atan2(sim.hero.y - m.y, sim.hero.x - m.x) : (m.face ?? 0);
  const q: SReq = {
    tech: 'idle',
    f: 0,
    hk,
    echo,
    aim: 0,
    v: 0,
    ph,
    lv: 0,
    side: s.side,
    // Смерть белым не мигает: копия моба держит последнюю вспышку.
    flash: pose.flash && (pose.mode !== 'dying' || pose.t < 0.08) ? 1 : 0,
    look: pose.look,
    fl: 0,
  };
  const c0: TCtx = { h, tm: timing(h, !!echo), aim: 0, v: 0, f: 0 };
  const at = (tech: Tech, c: TCtx = c0) => Math.min(spanOf(tech, c) - 1, Math.floor(t * SFPS + 1e-6));
  const aimB = (a: number) => clamp(Math.round(frameAngle(a, s.side) / AIM_STEP), -6, 6);
  switch (pose.mode) {
    case 'roar':
      s.side = sideOf(heroA, s.side);
      if (t < 1.4) {
        q.tech = 'roar';
        q.f = at('roar');
      } else {
        q.tech = 'idle';
        q.f = Math.floor(pose.now * 10 + m.id * 3.7) % 24;
      }
      break;
    case 'f6_summon':
      s.side = sideOf(heroA, s.side);
      q.tech = 'summon';
      q.f = at('summon');
      break;
    case 'f6_bite':
      s.side = sideOf(dir, s.side);
      q.tech = 'bite';
      q.aim = aimB(dir);
      q.f = at('bite', { ...c0, aim: q.aim * AIM_STEP });
      break;
    case 'f6_tail':
      q.tech = 'tail';
      q.f = at('tail');
      break;
    case 'f6_wave':
      s.side = sideOf(dir, s.side);
      q.tech = 'breath';
      q.aim = aimB(dir);
      q.f = at('breath');
      break;
    case 'f6_sweep':
      s.side = sideOf(dir, s.side);
      q.aim = aimB(dir);
      if (c0.tm.fan && m.data?.sdir !== undefined) {
        q.tech = 'sweep';
        q.v = (m.data.sdir >= 0 ? 1 : -1) * (s.side ? -1 : 1);
        q.f = at('sweep', { ...c0, v: q.v });
      } else {
        // Эхо: вторая волна полосами, без веера.
        q.tech = 'breath';
        q.v = 1;
        q.f = at('breath', { ...c0, v: 1 });
      }
      break;
    case 'f6_takeoff':
      q.tech = 'takeoff';
      q.f = at('takeoff');
      break;
    case 'f6_fly':
      s.side = sideOf(m.face ?? 0, s.side);
      q.tech = 'fly';
      // Полёт продолжает взмах взлёта: фаза от начала режима.
      q.f = Math.floor(t * SFPS) % 12;
      break;
    case 'f6_mark':
      s.side = sideOf(m.face ?? 0, s.side);
      q.tech = 'mark';
      q.v = s.dived || m.data?.vFrom === 1 ? 1 : 0;
      q.f = at('mark');
      break;
    case 'f6_dive':
      q.tech = 'dive';
      q.f = at('dive');
      break;
    case 'dizzy': {
      q.tech = 'dizzy';
      const Td = c0.tm.dizzy;
      if (t < DIZ_IN / SFPS) q.f = Math.floor(t * SFPS);
      else if (t < Td - DIZ_OUT / SFPS)
        q.f = DIZ_IN + (Math.floor((t - DIZ_IN / SFPS) * SFPS) % DIZ_LOOP);
      else q.f = Math.min(DIZ_IN + DIZ_LOOP + DIZ_OUT - 1, DIZ_IN + DIZ_LOOP + Math.floor((t - (Td - DIZ_OUT / SFPS)) * SFPS));
      break;
    }
    case 'recover': {
      const from = m.data?.vFrom ?? FROM[s.prev] ?? 0;
      if (!from || from === 6 || from === 7) {
        q.tech = 'idle';
        q.f = Math.floor(pose.now * 10 + m.id * 3.7) % 24;
        break;
      }
      q.tech = 'recover';
      q.v = from;
      if (from === 1 || from === 3 || from === 4) q.aim = aimB(dir);
      if (from === 4 && c0.tm.fan && m.data?.sdir !== undefined)
        q.v = 4;
      q.f = at('recover');
      break;
    }
    case 'dying':
      q.tech = 'death';
      q.f = Math.min(DEATH_N - 1, Math.floor(t * SFPS + 1e-6));
      break;
    default: {
      // Покой и ползком: смотрит на героя, голова выше или ниже.
      s.side = sideOf(heroA, s.side);
      const a = frameAngle(heroA, s.side);
      const want = a > 0.62 ? 1 : a < -0.62 ? -1 : 0;
      if (want !== s.lv && Math.abs(a - s.lv * 0.62) > 0.2) s.lv = want;
      q.lv = s.lv;
      const speed = Math.hypot(m.vx ?? 0, m.vy ?? 0);
      if (pose.anim === 'run' || speed > 0.4) {
        q.tech = 'crawl';
        q.f = Math.floor(((s.walk / WALK_STRIDE) % 1) * 8) % 8;
      } else {
        q.tech = 'idle';
        q.f = Math.floor(pose.now * 10 + (m.id ?? 0) * 3.7) % 24;
      }
      const fl = m.flash ?? 0;
      q.fl = fl > 0.07 ? 2 : fl > 0.01 ? 1 : 0;
    }
  }
  q.side = s.side;
  return { q, s };
}

/** Кайма ярости (смена фазы): поверх темноты, 4 ступени. */
const flareCache = new WeakMap<HTMLCanvasElement, HTMLCanvasElement[]>();
function flareOf(img: HTMLCanvasElement, lit: HTMLCanvasElement | null, lvl: number): HTMLCanvasElement {
  let arr = flareCache.get(img);
  if (!arr) {
    arr = [];
    flareCache.set(img, arr);
  }
  const hit = arr[lvl];
  if (hit) return hit;
  const w = img.width;
  const h = img.height;
  const g = img.getContext('2d');
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const og = out.getContext('2d');
  if (!g || !og) return out;
  const src = g.getImageData(0, 0, w, h).data;
  const o = og.createImageData(w, h);
  const a = [0, 0.35, 0.6, 0.85, 1][lvl];
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && src[(y * w + x) * 4 + 3] > 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (solid(x, y)) {
        // Чешуя просвечивает жаром изнутри.
        if (hash(x, y, 11) < 0.12 * a) {
          o.data[i] = 255;
          o.data[i + 1] = 170;
          o.data[i + 2] = 60;
          o.data[i + 3] = Math.round(200 * a);
        }
        continue;
      }
      let d = 9;
      for (let yy = -2; yy <= 2; yy++)
        for (let xx = -2; xx <= 2; xx++) if (solid(x + xx, y + yy)) d = Math.min(d, Math.abs(xx) + Math.abs(yy));
      if (d > 3) continue;
      const k = d <= 1 ? 1 : d === 2 ? 0.55 : 0.25;
      o.data[i] = 255;
      o.data[i + 1] = d <= 1 ? 130 : 70;
      o.data[i + 2] = 30;
      o.data[i + 3] = Math.round(255 * a * k);
    }
  og.putImageData(o, 0, 0);
  if (lit) og.drawImage(lit, 0, 0);
  arr[lvl] = out;
  return out;
}

registerMobPainter('f6boss', (m: Mob, pose: MobPose) => {
  const { q, s } = serpReq(m, pose);
  const { fr, ps } = serpFrame(q);
  const out: MobFrame = { ...fr };
  const sgn = q.side ? -1 : 1;
  // Укус: кадр выбрасывает грудь вперёд раньше моба, моб догоняет броском —
  // сдвиг кадра гасит пройденное, и видимая грудь не прыгает.
  if (q.tech === 'bite' && !q.echo) {
    const c = ctxOf(q);
    const T = c.tm.bite;
    const t = Math.max(0, pose.t);
    const a = m.dir ?? 0;
    const disp = Math.max(0, ((m.x - s.bx0) * Math.cos(a) + (m.y - s.by0) * Math.sin(a)) * 16);
    const vis = Math.hypot(fr.dx ?? 0, fr.dy ?? 0) * (t < T - 0.1 ? -1 : 1);
    let off = vis - disp;
    if (t > T + 0.18) off *= 1 - seg(t, T + 0.18, T + 0.5);
    out.dx = Math.cos(a) * off;
    out.dy = Math.sin(a) * off;
  }
  if (ps.ghost) out.ghost = { every: 0.03, life: 0.2, tint: '#ffa040', alpha: 0.36 };
  if (q.tech === 'death') out.linger = 1.5;
  // Отдача от удара героя: по направлению удара, с возвратом.
  const fl = m.flash ?? 0;
  if (fl > 0 && pose.mode !== 'dying') {
    const sim = paintSim();
    const age = clamp(0.12 - fl, 0, 0.12);
    let ux = -sgn;
    let uy = 0;
    if (sim) {
      const dx = m.x - sim.hero.x;
      const dy = m.y - sim.hero.y;
      const d = Math.hypot(dx, dy) || 1;
      ux = dx / d;
      uy = dy / d;
    }
    const calm = q.tech === 'idle' || q.tech === 'crawl' || q.tech === 'dizzy' || q.tech === 'recover' ? 1 : 0.4;
    const k = Math.sin((age / 0.12) * Math.PI) * 2.2 * calm;
    out.dx = (out.dx ?? 0) + ux * k;
    out.dy = (out.dy ?? 0) + uy * k * 0.6;
    out.sx = (out.sx ?? 1) * (1 - 0.03 * calm * Math.sin((age / 0.12) * Math.PI));
    out.sy = (out.sy ?? 1) * (1 + 0.025 * calm * Math.sin((age / 0.12) * Math.PI));
  }
  // Смена фазы: кайма ярости разгорается и гаснет за 0,8 с.
  const fa = pose.now - s.flareT;
  if (fa >= 0 && fa < 0.8 && pose.mode !== 'dying') {
    const lvl = Math.max(1, Math.min(4, Math.round((1 - Math.abs(fa - 0.25) / 0.55) * 4)));
    out.lit = flareOf(fr.img, fr.lit ?? null, lvl);
  }
  // В небе змей над всем: кадр ещё раз поверх темноты и героя (тело — зона
  // `above`, голова — над ним).
  if (ps.lift > 6 && !q.echo) {
    const key = fr.img;
    let both = overlayCache.get(key);
    if (!both) {
      both = document.createElement('canvas');
      both.width = key.width;
      both.height = key.height;
      const g = both.getContext('2d');
      if (g) {
        g.drawImage(key, 0, 0);
        if (out.lit) g.drawImage(out.lit, 0, 0);
      }
      overlayCache.set(key, both);
    }
    out.lit = both;
  }
  // История груди — телу: подъём и сдвиг (мир, px).
  s.cdx = (out.dx ?? 0);
  s.cdy = (out.dy ?? 0) + ps.lift;
  s.rear = Math.max(0, -ps.r.by) * 0.9;
  const hist = s.hist;
  if (!hist.length || pose.now - hist[hist.length - 2] > 0.012) {
    hist.push(pose.now, ps.lift);
    while (hist.length > 2 && pose.now - hist[0] > 1.2) hist.splice(0, 2);
  }
  return out;
});

const overlayCache = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();

/** Подъём груди в момент `at` (для колец тела с опозданием). */
function liftAt(s: SerpMem | undefined, at: number): number {
  if (!s || !s.hist.length) return 0;
  const h = s.hist;
  if (at >= h[h.length - 2]) return h[h.length - 1];
  for (let i = h.length - 4; i >= 0; i -= 2)
    if (h[i] <= at) {
      const k = (at - h[i]) / Math.max(1e-6, h[i + 2] - h[i]);
      return lerp(h[i + 1], h[i + 3], k);
    }
  return h[1];
}

// Прогрев: первая фаза (без спешки) в обе стороны — всё, что игрок видит в
// первом бою: рёв входа, покой, ползком, укус, хвост, волна, возвраты.
registerMobWarm('f6boss', function* () {
  const base = { hk: 100, echo: 0 as const, v: 0, ph: 0, lv: 0, flash: 0 as const, look: 'normal' as Look, fl: 0 };
  const c = ctxOf({ ...base, tech: 'idle', f: 0, aim: 0, side: 0 });
  const list: [Tech, number, number][] = [
    ['roar', 0, 0],
    ['idle', 0, 0],
    ['crawl', 0, 0],
    ['bite', 0, 0],
    ['bite', 6, 0],
    ['recover', 0, 1],
    ['tail', 0, 0],
    ['recover', 0, 2],
    ['breath', 0, 0],
    ['breath', 6, 0],
    ['recover', 0, 3],
    ['idle', 0, 0],
  ];
  for (const [tech, aim, v] of list) {
    const n = spanOf(tech, { ...c, v });
    for (const side of [0, 1] as const)
      for (let f = 0; f < n; f++) {
        serpFrame({ ...base, tech, f, aim, v, side, lv: tech === 'idle' || tech === 'crawl' ? (aim ? 1 : 0) : 0 });
        yield f;
      }
  }
});

// ---------------------------------------------------------------------------
// Тело змея (зона `f6_body`): кольца по пути головы, от хвоста к груди.
// Одна труба, а не бусы: сперва контур всех колец, потом заливка — внутренние
// швы пропадают; свет — цилиндрический (по нормали поперёк тела), поэтому
// кольца сливаются; край каждой пластины к хвосту — тёмная линия (в ярости —
// лава). Тело ползёт волной по земле (волна стоит на месте, тело скользит по
// ней), поднимается в небо следом за грудью с опозданием к хвосту, хлещет
// хвостом по кругу в такт удару и при смерти оседает кольцами, остывает
// камнем и рассыпается. Спрайты колец — в кеше по радиусу, углу и облику.
// ---------------------------------------------------------------------------

const BODY_LEN = 4.6;
const BODY_S0 = 0.45;
const A16 = 16;

/** Остывший змей — уголь с фиолетовым отливом обсидиана, а не сиреневый. */
const COOLED: Tones = [hx('#0c0a0e'), hx('#1c171e'), hx('#342c36'), hx('#5c4e62')];

/** Облик кольца: 0 — обычный, 1 — вспышка, 2…4 — жилы жара, 5…8 — остывает. */
const ringCache = frameLRU<HTMLCanvasElement>(1600);

const mixT = (a: Tones, b: Tones, k: number): Tones => [
  mixc(a[0], b[0], k),
  mixc(a[1], b[1], k),
  mixc(a[2], b[2], k),
  mixc(a[3], b[3], k),
];

function ringTones(varnt: number): { sc: Tones; bl: Tones; rim: RGBA } {
  if (varnt >= 5) {
    const k = (varnt - 4) / 4;
    return {
      sc: mixT(SRP.scale, COOLED, k),
      bl: mixT(SRP.belly, COOLED, k),
      rim: mixc(mixc(SRP.scale[1], SRP.scale[0], 0.5), k > 0.4 ? hx('#ff6a1a') : COOLED[0], k > 0.4 ? 1 - k : k),
    };
  }
  if (varnt >= 2) {
    const rim = varnt === 2 ? hx('#c0340e') : varnt === 3 ? LAVA.hot : LAVA.bright;
    return { sc: SRP.scale, bl: SRP.belly, rim };
  }
  return { sc: SRP.scale, bl: SRP.belly, rim: mixc(SRP.scale[1], SRP.scale[0], 0.55) };
}

/** Кольцо тела: свет поперёк тела (труба), брюхо к камере, край пластины к хвосту. */
function ringSprite(r: number, a16: number, varnt: number, mode: 0 | 1 | 2): HTMLCanvasElement {
  const key = `${r}|${a16}|${varnt}|${mode}`;
  const hit = ringCache.get(key);
  if (hit) return hit;
  const S = r * 2 + 6;
  const p = new Px(S, S);
  const o = S / 2;
  const a = (a16 / A16) * TAU;
  const tx = Math.cos(a);
  const ty = Math.sin(a);
  const ry = r * 0.88;
  if (mode === 0) {
    p.ell(o, o, r + 1, ry + 1, INK);
  } else {
    const { sc, bl, rim } = ringTones(varnt);
    const horiz = Math.abs(tx);
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const dx = (x + 0.5 - o) / r;
        const dy = (y + 0.5 - o) / ry;
        const d2 = dx * dx + dy * dy;
        if (d2 > 1) continue;
        const al = dx * tx + dy * ty;
        const nx = dx - al * tx;
        const ny = dy - al * ty;
        const nn = Math.min(1, nx * nx + ny * ny);
        const nz = Math.sqrt(1 - nn);
        const l = nx * LX + ny * LY + nz * LZ;
        let c: RGBA;
        const belly = ny > 0.42 && horiz > 0.3 && ny * horiz > 0.3;
        if (belly) c = tone(bl, l + 0.25 - (mode === 2 && al < -0.6 ? 0.3 : 0));
        else if (mode === 2 && al < -0.66 && ny < 0.45 && d2 > 0.1) c = rim;
        else c = tone(sc, l);
        p.set(x, y, c);
      }
    // Вспышка удара — телу слабее, чем груди: длинное белое тело слепит.
    if (varnt === 1) p.data.set(p.tint(WHITE, 0.55).data);
  }
  const c = p.canvas();
  return ringCache.set(key, c);
}

/** Шип хребта: смотрит вверх и назад (к хвосту). */
function spikeSprite(size: number, lean: number, varnt: number): HTMLCanvasElement {
  const key = `sp|${size}|${lean}|${varnt}`;
  const hit = ringCache.get(key);
  if (hit) return hit;
  const p = new Px(9, 9);
  const L = size;
  const col = varnt >= 5 ? mixc(SRP.scale[1], COOLED[2], (varnt - 4) / 4) : SRP.scale[1];
  poly(
    p,
    [
      [3.2, 7.2],
      [4.5 - lean * L * 0.55, 7.4 - L],
      [5.8, 7.2],
    ],
    col,
  );
  // Кончик шипа — кость; у основания — светлый край чешуи.
  p.set(Math.round(4.5 - lean * L * 0.5), Math.round(7.4 - L + 0.6), varnt === 1 ? WHITE : SRP.horn[varnt >= 5 ? 1 : 2]);
  if (L > 2) p.set(Math.round(4.5 - lean * L * 0.25), Math.round(7.4 - L * 0.5), SRP.scale[2]);
  outlineIn(p, INK, 0, 0, 8, 7);
  const c = p.canvas();
  return ringCache.set(key, c);
}

/** Кончик хвоста — лопасть вдоль хвоста (a16 — куда смотрит от тела). */
function tipSprite(a16: number, varnt: number): HTMLCanvasElement {
  const key = `tip|${a16}|${varnt}`;
  const hit = ringCache.get(key);
  if (hit) return hit;
  const p = new Px(15, 15);
  const a = (a16 / A16) * TAU;
  const fx = Math.cos(a);
  const fy = Math.sin(a);
  const nx = -fy;
  const ny = fx;
  const o = 7.5;
  const { sc } = ringTones(varnt);
  poly(
    p,
    [
      [o - fx * 1.5 + nx * 1.6, o - fy * 1.5 + ny * 1.6],
      [o + fx * 1.2 + nx * 3.6, o + fy * 1.2 + ny * 3.6],
      [o + fx * 5.6, o + fy * 5.6],
      [o + fx * 1.2 - nx * 3.6, o + fy * 1.2 - ny * 3.6],
      [o - fx * 1.5 - nx * 1.6, o - fy * 1.5 - ny * 1.6],
    ],
    (x, y) => tone(sc, 0.5 + ((x - o) * LX + (y - o) * LY) * 0.12),
  );
  // Ребро лопасти.
  for (let i = -1; i <= 4; i++) p.set(Math.round(o + fx * i), Math.round(o + fy * i), sc[3]);
  if (varnt === 1) p.data.set(p.tint(WHITE, 0.85).data);
  outlineIn(p, INK, 0, 0, 14, 14);
  const c = p.canvas();
  return ringCache.set(key, c);
}

/** Точка пути головы на расстоянии s клеток и направление к голове; дальше конца — продолжение. */
function alongT(tr: readonly number[], s: number): [number, number, number, number] {
  let acc = 0;
  let lx = tr[0];
  let ly = tr[1];
  let dx = 0;
  let dy = -1;
  for (let i = 0; i + 3 < tr.length; i += 2) {
    const sx = tr[i + 2] - tr[i];
    const sy = tr[i + 3] - tr[i + 1];
    const d = Math.hypot(sx, sy);
    if (d < 1e-6) continue;
    dx = sx / d;
    dy = sy / d;
    if (acc + d >= s) {
      const k = (s - acc) / d;
      return [tr[i] + sx * k, tr[i + 1] + sy * k, -dx, -dy];
    }
    acc += d;
    lx = tr[i + 2];
    ly = tr[i + 3];
  }
  const rest = s - acc;
  return [lx + dx * rest, ly + dy * rest, -dx, -dy];
}

export interface SerpBodyView {
  id: number;
  trail: readonly number[];
  mode: string;
  t: number;
  x: number;
  y: number;
  face: number;
  /** Спешка (фаза), вспышка удара, секунд после смерти (−1 — жив). */
  haste: number;
  flash: number;
  die: number;
  /** Режим до нынешнего — у хвоста продолжение в `recover`. */
  prev?: string;
}

/** Где на теле кольца: шаг — по толщине (тонкий хвост — чаще), пластины и шипы — по длине. */
interface BodySample {
  s: number;
  k: number;
  r: number;
  plate: boolean;
  spike: boolean;
}
const BODY_SAMPLES: BodySample[] = (() => {
  const out: BodySample[] = [];
  let s = BODY_S0;
  let plate = -9;
  let spike = -9;
  while (s <= BODY_S0 + BODY_LEN + 1e-6) {
    const k = (s - BODY_S0) / BODY_LEN;
    const rf = 7 - 5 * Math.pow(k, 1.1);
    const px = s * 16;
    const pl = px - plate >= rf * 0.75 + 1.8;
    if (pl) plate = px;
    const sp = px - spike >= 8.5 && k < 0.88;
    if (sp) spike = px;
    out.push({ s, k, r: Math.max(2, Math.round(rf)), plate: pl, spike: sp });
    s += Math.max(1.3, rf * 0.42) / 16;
  }
  return out;
})();

interface Ring {
  x: number;
  y: number;
  z: number;
  r: number;
  k: number;
  a: number;
  sink: number;
  cool: number;
  gone: number;
  plate: boolean;
  spike: boolean;
  fill?: boolean;
}

/** Хлёст: сколько повернул кончик (рад), вес формы, подъём кончика, скорость (для следа). */
function whipAt(t: number, T: number): { sweep: number; w: number; up: number; fast: number } {
  let sweep = -0.95 * EZ.out(seg(t, 0, 0.9 * T));
  let up = 8 * EZ.out(seg(t, 0.2 * T, 0.9 * T));
  // Взведённый хвост трещит.
  if (t > 0.5 * T && t < T - 0.09) sweep += Math.sin(t * TAU * 15) * 0.07;
  const k = seg(t, T - 0.09, T + 0.1);
  if (k > 0) {
    sweep = lerp(-0.95, TAU + 0.25, EZ.io(k));
    up = 8 * (1 - k) + 2 * k;
  }
  const k2 = seg(t, T + 0.1, T + 0.42);
  if (k2 > 0) {
    sweep = lerp(TAU + 0.25, TAU + 0.85, EZ.out(k2));
    up = 2 * (1 - k2);
  }
  const w = EZ.io(seg(t, 0, 0.45 * T)) * (1 - EZ.io(seg(t, T + 0.4, T + 1.25)));
  const fast = Math.sin(clamp01(k) * Math.PI);
  return { sweep, w, up, fast };
}

/** Кривая Безье второго порядка, выборка по длине: точка на доле u длины. */
function bezierAt(pts: P2[], lens: number[], u: number): P2 {
  const L = lens[lens.length - 1];
  const s = u * L;
  for (let i = 1; i < lens.length; i++)
    if (lens[i] >= s) {
      const k = (s - lens[i - 1]) / Math.max(1e-6, lens[i] - lens[i - 1]);
      return mixP(pts[i - 1], pts[i], k);
    }
  return pts[pts.length - 1];
}

/** Нарисовать тело змея: g — контекст пола, (px, py) — точка змея на экране. */
export function drawSerpentBody(
  g: CanvasRenderingContext2D,
  v: SerpBodyView,
  px: number,
  py: number,
  S: number,
  time: number,
): void {
  const mem = serpMemById.get(v.id);
  const now = mem?.now ?? time;
  const K = g.getTransform().a || 1;
  const q = (n: number) => Math.round(n * K) / K;
  const tr = v.trail.length >= 4 ? v.trail : [v.x, v.y, v.x, v.y - 1];
  const walk = (mem?.walk ?? 0) / 16;
  const crawl = v.mode === 'chase' || v.mode === 'recover' || v.mode === 'roar';
  const h = v.haste;
  const ph = h >= 1.24 ? 3 : h >= 1.14 ? 2 : h >= 1.04 ? 1 : 0;
  // Хлёст хвостом: в самом режиме и в возврате после него.
  const T = 0.8 / h;
  let wt = -1;
  if (v.mode === 'f6_tail') wt = v.t;
  else if (v.mode === 'recover' && v.prev === 'f6_tail') wt = T + 0.7 + v.t;
  const whip = wt >= 0 ? whipAt(wt, T) : null;
  const cdx = mem?.cdx ?? 0;
  const cdy = mem?.cdy ?? 0;
  const rearNow = mem?.rear ?? 0;
  // Форма хлёста: от основания у груди к кончику по кругу — дуга, отстающая
  // от кончика; кольца — по её длине (тело не растягивается бусами).
  let wpts: P2[] = [];
  let wlen: number[] = [];
  let thT = 0;
  let sd = 1;
  if (whip) {
    const b = alongT(tr, 0.7);
    const e = alongT(tr, 3.2);
    const thB = Math.atan2(b[1] - v.y, b[0] - v.x);
    const thT0 = Math.atan2(e[1] - v.y, e[0] - v.x);
    // Взвод — в сторону камеры: хвост виден, а не за спиной.
    sd = Math.sin(thT0 - 0.95) > Math.sin(thT0 + 0.95) ? 1 : -1;
    thT = thT0 + sd * whip.sweep;
    const B: P2 = [v.x + Math.cos(thB) * 0.6, v.y + Math.sin(thB) * 0.6 * 0.86];
    const P: P2 = [v.x + Math.cos(thT) * 2.3, v.y + Math.sin(thT) * 2.3 * 0.86];
    // Хвост отстаёт от кончика тем сильнее, чем быстрее хлёст.
    const ca = thT - sd * (0.55 + 1.2 * whip.fast);
    const cr = 2.15 + 0.55 * whip.fast;
    const C: P2 = [v.x + Math.cos(ca) * cr, v.y + Math.sin(ca) * cr * 0.86];
    let acc = 0;
    for (let i = 0; i <= 20; i++) {
      const u = i / 20;
      const pt: P2 = [
        (1 - u) * (1 - u) * B[0] + 2 * u * (1 - u) * C[0] + u * u * P[0],
        (1 - u) * (1 - u) * B[1] + 2 * u * (1 - u) * C[1] + u * u * P[1],
      ];
      if (i) acc += Math.hypot(pt[0] - wpts[i - 1][0], pt[1] - wpts[i - 1][1]);
      wpts.push(pt);
      wlen.push(acc);
    }
  }
  const rings: Ring[] = [];
  for (const smp of BODY_SAMPLES) {
    const { s, k } = smp;
    let [x, y, tx, ty] = alongT(tr, s);
    // Волна ползка стоит на земле: тело скользит по ней.
    const amp = (crawl ? 0.26 : 0.12) * clamp01((k - 0.02) / 0.3);
    const wv = Math.sin((s + walk) * 3.9) * amp + (crawl ? 0 : Math.sin(time * 1.3 - k * 5) * 0.05 * k);
    x += -ty * wv;
    y += tx * wv;
    // Начало тела тянется за грудью (выпад, отдача).
    const att = 1 - EZ.io(clamp01((s - BODY_S0) / 1.3));
    x += (cdx / 16) * att;
    y += (cdy / 16) * att;
    let z = 0;
    if (mem) {
      // В небо — за грудью, с опозданием к хвосту; на дыбах — только начало.
      // Вверх тело отрывается медленно, кольцо за кольцом; вниз (пике)
      // падает за грудью быстро — не стоит башней.
      const lagged = Math.min(liftAt(mem, now - k * 0.55), liftAt(mem, now - k * 0.2));
      z = lagged * (1 - 0.3 * k);
      z = Math.max(z, rearNow * att);
      if (lagged > 8) z += Math.sin(time * 5.5 - k * 6) * 2.4 * k;
    }
    if (whip && wpts.length) {
      const [wx, wy] = bezierAt(wpts, wlen, k);
      const w = whip.w * clamp01(k * 1.8);
      x = lerp(x, wx, w);
      y = lerp(y, wy, w);
      z += whip.up * k * k * w;
    }
    let sink = 0;
    let cool = 0;
    let gone = 0;
    if (v.die >= 0) {
      const d0 = 0.12 + (1 - k) * 0.42;
      sink = EZ.out(seg(v.die, d0, d0 + 0.22));
      cool = seg(v.die, 0.3 + (1 - k) * 0.3, 0.75 + (1 - k) * 0.3);
      gone = seg(v.die, 1.0 + (1 - k) * 0.22, 1.45 + (1 - k) * 0.18);
      z = z * (1 - sink) - sink * 1.2;
    }
    rings.push({ x, y, z, r: smp.r, k, a: 0, sink, cool, gone, plate: smp.plate, spike: smp.spike });
  }
  // Касательная — к голове, в экранных осях (с высотой).
  const scr = (rg: Ring): P2 => [rg.x * S, rg.y * S - rg.z];
  for (let i = 0; i < rings.length; i++) {
    const [ax, ay] = scr(rings[Math.max(0, i - 1)]);
    const [bx, by] = scr(rings[Math.min(rings.length - 1, i + 1)]);
    rings[i].a = Math.atan2(ay - by, ax - bx);
  }
  // Разрыв между соседними кольцами (быстрый подъём, пике) — досыпаем
  // промежуточные: тело тянется, но не рвётся на бусы.
  const all: Ring[] = [];
  for (let i = 0; i < rings.length; i++) {
    const rg = rings[i];
    if (i > 0) {
      const pr = rings[i - 1];
      const [ax, ay] = scr(pr);
      const [bx, by] = scr(rg);
      const gap = Math.hypot(bx - ax, by - ay);
      const lim = Math.min(pr.r, rg.r) * 0.8;
      const n = Math.min(12, Math.ceil(gap / lim) - 1);
      for (let j = 1; j <= n; j++) {
        const u = j / (n + 1);
        all.push({
          ...pr,
          x: lerp(pr.x, rg.x, u),
          y: lerp(pr.y, rg.y, u),
          z: lerp(pr.z, rg.z, u),
          r: Math.round(lerp(pr.r, rg.r, u)),
          plate: false,
          spike: false,
          fill: true,
        });
      }
    }
    all.push(rg);
  }
  const sx = (rg: Ring) => px + (rg.x - v.x) * S;
  const sy = (rg: Ring) => py + (rg.y - v.y) * S;
  const vflash = v.flash > 0.05 && v.die < 0;
  const heatV = ph >= 3 ? 4 : ph >= 2 ? 3 : 0;
  const summon = v.mode === 'f6_summon' ? Math.sin(seg(v.t, 0.4, 1.2) * Math.PI) : 0;
  const varOf = (rg: Ring) => {
    if (vflash) return 1;
    if (rg.cool > 0) return 5 + Math.min(3, Math.floor(rg.cool * 3.999));
    if (summon > 0.5) return 4;
    if (summon > 0.15) return Math.max(heatV, 3);
    return heatV;
  };
  // Тень — одна заливка на всё тело: без тёмных пятен в перекрытиях.
  g.fillStyle = 'rgba(0,0,0,0.26)';
  g.beginPath();
  for (const rg of rings) {
    if (rg.gone >= 1) continue;
    const hz = Math.max(0, rg.z);
    const rx = rg.r * (1.05 - Math.min(0.45, hz / 70));
    const X = q(sx(rg));
    const Y = q(sy(rg) + 1);
    g.moveTo(X + rx, Y);
    g.ellipse(X, Y, rx, Math.max(1, rx * 0.38), 0, 0, TAU);
  }
  g.fill();
  const a16Of = (a: number) => ((Math.round((a / TAU) * A16) % A16) + A16) % A16;
  const drawRing = (rg: Ring, mode: 0 | 1 | 2) => {
    if (rg.gone >= 1) return;
    const img = ringSprite(rg.r, a16Of(rg.a), varOf(rg), mode);
    const o = img.width / 2;
    const X = sx(rg);
    const Y = sy(rg) - rg.z - rg.r * 0.55;
    if (rg.gone > 0) g.globalAlpha = 1 - rg.gone;
    if (rg.sink > 0) {
      // Осело: сплющено к земле.
      const k = 1 - rg.sink * 0.28;
      g.drawImage(img, q(X - o), q(Y - o + (1 - k) * o), img.width, img.height * k);
    } else g.drawImage(img, q(X - o), q(Y - o));
    g.globalAlpha = 1;
  };
  for (let i = all.length - 1; i >= 0; i--) drawRing(all[i], 0);
  for (let i = all.length - 1; i >= 0; i--) drawRing(all[i], all[i].plate ? 2 : 1);
  // Шипы хребта — поверх, от хвоста к груди.
  for (let i = rings.length - 1; i >= 1; i--) {
    const rg = rings[i];
    // Гребень виден сбоку; на теле, уходящем от камеры, шипы читались бы каплями.
    if (!rg.spike || rg.gone >= 1 || Math.abs(Math.cos(rg.a)) < 0.7) continue;
    const size = Math.max(2, Math.round(rg.r * 0.55 + 0.6));
    const lean = Math.cos(rg.a) >= 0 ? 1 : -1;
    const vr = varOf(rg);
    const img = spikeSprite(size, lean * 0.6, vr === 1 ? 1 : vr >= 5 ? vr : 0);
    const X = sx(rg);
    const Y = sy(rg) - rg.z - rg.r * 0.55 - rg.r * 0.62 * (1 - rg.sink * 0.3);
    if (rg.gone > 0) g.globalAlpha = 1 - rg.gone;
    g.drawImage(img, q(X - 4.5), q(Y - 7.4));
    g.globalAlpha = 1;
  }
  // Лопасть на кончике.
  {
    const rg = rings[rings.length - 1];
    if (rg.gone < 1) {
      const a = rg.a + Math.PI;
      const img = tipSprite(a16Of(a), varOf(rg));
      const X = sx(rg) + Math.cos(a) * 2;
      const Y = sy(rg) - rg.z - rg.r * 0.55 + Math.sin(a) * 2;
      if (rg.gone > 0) g.globalAlpha = 1 - rg.gone;
      g.drawImage(img, q(X - 7.5), q(Y - 7.5));
      g.globalAlpha = 1;
    }
  }
  // След хвоста по кругу: дуга там, где прошёл кончик (оружие змея).
  if (whip && whip.fast > 0.05) {
    const cx = px;
    const cy = py - 3;
    const back = Math.min(2.6, 1.3 + whip.fast * 1.6);
    const R0 = 1.5 * S;
    const R1 = 2.5 * S;
    const n = 16;
    for (let j = 0; j < n; j++) {
      const f0 = j / n;
      const f1 = (j + 1) / n;
      const a0 = thT - sd * back * f0;
      const a1 = thT - sd * back * f1;
      const al = (1 - f0) * 0.78 * whip.fast;
      g.fillStyle =
        f0 < 0.12
          ? `rgba(255,246,200,${al})`
          : f0 < 0.45
            ? `rgba(255,176,64,${al})`
            : `rgba(214,58,20,${al * 0.8})`;
      // Серп: к концу следа уже — тает к центру.
      const r0 = lerp(R0, R1 - 4, f0 * 0.6);
      g.beginPath();
      g.moveTo(cx + Math.cos(a0) * R1, cy + Math.sin(a0) * R1 * 0.86);
      g.lineTo(cx + Math.cos(a1) * R1, cy + Math.sin(a1) * R1 * 0.86);
      g.lineTo(cx + Math.cos(a1) * r0, cy + Math.sin(a1) * r0 * 0.86);
      g.lineTo(cx + Math.cos(a0) * r0, cy + Math.sin(a0) * r0 * 0.86);
      g.closePath();
      g.fill();
    }
  }
  // Пепел над остывающими кольцами — вверх и тает.
  if (v.die > 0.5) {
    for (let i = 0; i < rings.length; i += 2) {
      const rg = rings[i];
      if (rg.cool < 0.3 || rg.gone >= 1) continue;
      const a = (((v.die * 1.3 + hash(i, 5)) % 1) + 1) % 1;
      g.fillStyle = a < 0.5 ? `rgba(255,150,60,${0.7 * (1 - a)})` : `rgba(90,82,80,${0.8 * (1 - a)})`;
      g.fillRect(q(sx(rg) + (hash(i, 9) - 0.5) * rg.r * 2), q(sy(rg) - rg.r - a * 14), 1, 1);
    }
  }
}

registerZonePainter('f6_body', (g, z, px, py, S, time) => {
  const zz = z as Zone & { mob?: number; vDie?: number };
  const id = zz.mob ?? -1;
  const sv = serpentView(id);
  if (!sv) return true;
  const sim = paintSim();
  const m = sim?.mobs.find((x) => x.id === id);
  const mem = serpMemById.get(id);
  drawSerpentBody(
    g,
    {
      id,
      trail: sv.trail,
      mode: sv.mode,
      t: sv.t,
      x: zz.x,
      y: zz.y,
      face: sv.face,
      haste: m?.data?.haste ?? mem?.haste ?? 1,
      flash: m?.flash ?? 0,
      die: zz.vDie !== undefined ? zz.t - zz.vDie : -1,
      prev: mem?.prev,
    },
    px,
    py,
    S,
    time,
  );
  return true;
});

// ---------------------------------------------------------------------------
// Реквизит этажа. Живые (кадры по времени): пузырь лавы, лавопад, котёл,
// костёр, друза кварца, жаровня, яйцо змея. Остальное — статично.
// Спрайт ставится основанием на низ своей клетки (`ay` — от верха спрайта).
// ---------------------------------------------------------------------------

const sprites = new Map<string, Sprite>();
const spriteOf = (key: string, make: () => Sprite): Sprite => {
  let s = sprites.get(key);
  if (!s) {
    s = make();
    sprites.set(key, s);
  }
  return s;
};
const flashed = (p: Px, flash: boolean) => (flash ? p.tint(WHITE, 0.85) : p);

// Пузырь на лаве: вздувается, лопается брызгами, круги расходятся.
registerPropPainter('f6_bubble', (o, time) => {
  const ph = hash(o.x, o.y, 21) * 6;
  const f = Math.floor(time * 5 + ph) % 8;
  const v = Math.floor(hash(o.x, o.y, 22) * 2);
  return spriteOf(`bubble|${v}|${f}`, () => {
    const p = new Px(16, 16);
    const cx = 8 + (v ? 1 : -1);
    const cy = 9;
    if (f <= 3) {
      // Растёт: корка купола, щель света сверху.
      const r = 1.2 + f * 0.9;
      p.ell(cx, cy, r + 0.6, r * 0.7 + 0.4, LAVA.dark);
      p.ell(cx, cy - 0.3, r, r * 0.6, f === 3 ? LAVA.bright : LAVA.hot);
      p.set(cx - 1, Math.round(cy - r * 0.5), LAVA.white);
      if (f >= 2) p.set(cx + 1, Math.round(cy - r * 0.3), LAVA.white);
    } else if (f === 4) {
      // Лопнул: брызги вверх.
      for (let i = 0; i < 7; i++) {
        const a = -Math.PI * (0.1 + (i / 6) * 0.8);
        const d = 2 + hash(i, v) * 3;
        p.set(Math.round(cx + Math.cos(a) * d), Math.round(cy - 1 + Math.sin(a) * d * 1.4), i % 2 ? LAVA.bright : LAVA.white);
      }
      p.ell(cx, cy, 2.6, 1.2, LAVA.hot);
    } else if (f <= 6) {
      // Круги расходятся.
      const r = 2 + (f - 4) * 1.6;
      for (let a = 0; a < TAU; a += 0.2)
        p.set(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r * 0.45), f === 5 ? LAVA.bright : LAVA.hot);
    }
    return { img: p.canvas(), ax: 8, ay: 16 };
  });
});

// Лавопад: лава стекает по лицу стены полосами и копится лужицей у подножия.
registerPropPainter('f6_lavafall', (o, time) => {
  const f = Math.floor(time * 10 + hash(o.x, o.y) * 4) % 4;
  return spriteOf(`fall|${f}`, () => {
    const p = new Px(16, 20);
    for (let y = 2; y < 17; y++) {
      const w = 3 + Math.round(Math.sin(y * 0.7) * 0.6) + (y > 12 ? 1 : 0);
      for (let x = 8 - w; x <= 8 + w - 1; x++) {
        const band = (y - f * 2 + 16 + Math.floor(Math.abs(x - 8) * 0.8)) % 5;
        const edge = x === 8 - w || x === 8 + w - 1;
        const c = edge ? LAVA.dark : band === 0 ? LAVA.white : band < 2 ? LAVA.bright : band < 4 ? LAVA.hot : LAVA.mid;
        p.set(x, y, c);
      }
    }
    // Исток: пролом в кромке стены.
    p.ell(8, 2, 3.5, 1.2, LAVA.crust);
    p.ell(8, 2.4, 2.4, 0.7, LAVA.bright);
    // Лужица и брызги у подножия.
    p.ell(8, 17.5, 6, 1.8, LAVA.dark);
    p.ell(8, 17.2, 4.6, 1.2, LAVA.hot);
    p.set(4 + f, 15, LAVA.white);
    p.set(12 - f, 16, LAVA.bright);
    return { img: p.canvas(), ax: 8, ay: 16 };
  });
});

// Базальтовый столб: шестигранная призма, три видимые грани, крышка.
registerPropPainter('f6_column', (o) => {
  const v = Math.floor(hash(o.x, o.y, 23) * 3);
  return spriteOf(`column|${v}`, () => {
    const h = 26 + v * 3;
    const p = new Px(14, h + 4);
    const top = 3;
    const faces: [number, number, Tones, number][] = [
      [2, 5, BASALT, 0.75],
      [5, 9, BASALT, 0.45],
      [9, 12, BASALT, 0.1],
    ];
    for (const [x0, x1, t, l] of faces)
      for (let y = top + 2; y < h + 2; y++)
        for (let x = x0; x < x1; x++) {
          const crack = (y + x * 3 + v * 5) % 11 === 0;
          p.set(x, y, tone(t, l - (y > h - 2 ? 0.4 : 0) - (crack ? 0.5 : 0)));
        }
    // Крышка-шестигранник.
    poly(
      p,
      [
        [2, top + 2],
        [4, top],
        [10, top],
        [12, top + 2],
        [10, top + 4],
        [4, top + 4],
      ],
      (x, y) => tone(BASALT, 0.95 - (x - 2) * 0.05 - (y - top) * 0.08),
    );
    // Рёбра призмы: тёмная щель между гранями и светлая кромка на ребре
    // к свету — без них столб читался чёрным монолитом.
    for (let y = top + 3; y < h + 2; y++) {
      p.set(5, y, BASALT[0]);
      p.set(9, y, BASALT[0]);
      p.set(2, y, BASALT[3]);
      p.set(6, y, tone(BASALT, 0.7));
    }
    // Кромка крышки — светлая, как скол стекла.
    for (let x = 4; x <= 9; x++) p.set(x, top, hx('#8a7a74'));
    p.set(3, top + 1, hx('#8a7a74'));
    p.set(2, top + 2, hx('#8a7a74'));
    // Поперечные сколы — столб сложен из барабанов.
    for (const yy of [top + 9 + v, top + 17 + v]) {
      for (let x = 2; x < 12; x++) p.set(x, yy, BASALT[0]);
      for (let x = 2; x < 5; x++) p.set(x, yy + 1, BASALT[3]);
    }
    p.outline(INK);
    // Отсвет лавы снизу на правой грани и у подножия.
    for (let y = h - 6; y < h + 2; y++) p.set(11, y, alpha(LAVA.hot, 0.25 + (y - h + 6) * 0.08));
    for (let x = 9; x < 12; x++) p.set(x, h + 1, alpha(LAVA.hot, 0.45));
    return { img: p.canvas(), ax: 7, ay: h + 2 };
  });
});

// Ребро великана: дуга кости из пепла.
registerPropPainter('f6_ribs', (o) => {
  const v = Math.floor(hash(o.x, o.y, 24) * 2);
  return spriteOf(`rib|${v}`, () => {
    const p = new Px(14, 28);
    const pts = spline(
      [
        [v ? 3 : 11, 27],
        [v ? 4 : 10, 16],
        [7, 7],
        [v ? 12 : 2, 2],
      ],
      6,
    );
    pts.forEach(([x, y], i) => {
      const k = i / (pts.length - 1);
      const r = 2 - k * 1.1;
      shadeEll(p, x, y, r + 0.3, r + 0.3, BONE);
    });
    p.outline(INK);
    // Трещины и пепел у основания.
    p.set(v ? 4 : 10, 20, BONE[0]);
    p.set(7, 11, BONE[0]);
    for (let x = 1; x < 13; x++) if (x % 3 !== 0) p.set(x, 27, alpha(ASH.lt, 0.8));
    return { img: p.canvas(), ax: 7, ay: 28 };
  });
});

// Череп зверя: длинный, с рогом и зубами, наполовину в пепле.
registerPropPainter('f6_skull', () =>
  spriteOf('skull', () => {
    const p = new Px(32, 22);
    shadeEll(p, 12, 11, 9, 6.5, BONE);
    shadeEll(p, 22, 13, 8, 4, BONE);
    shadeEll(p, 28, 14, 3.5, 3, BONE);
    // Рог назад.
    const horn = spline(
      [
        [8, 6],
        [4, 2],
        [1, 3],
      ],
      4,
    );
    horn.forEach(([x, y], i) => shadeEll(p, x, y, 1.8 - i * 0.12, 1.8 - i * 0.12, BONE));
    p.outline(INK);
    // Глазница, ноздря, зубы.
    p.ell(14, 9, 2.6, 2, hx('#1a1410'));
    p.set(13, 8, hx('#3a0c08'));
    p.ell(27, 12, 1.2, 0.8, hx('#1a1410'));
    for (let x = 18; x <= 28; x += 2) {
      p.set(x, 17, BONE[3]);
      p.set(x, 18, BONE[2]);
    }
    // Пепел занёс низ.
    for (let x = 2; x < 31; x++) {
      const h = 2 + Math.round(noise(x, 0, 4, 5) * 3);
      for (let y = 21 - h; y < 22; y++) p.set(x, y, tone([ASH.dk, ASH.mid, ASH.lt, ASH.hi], 0.5 - (y - 17) * 0.1));
    }
    return { img: p.canvas(), ax: 16, ay: 22 };
  }),
);

registerPropPainter('f6_bones', (o) => {
  const v = Math.floor(hash(o.x, o.y, 25) * 3);
  return spriteOf(`bones|${v}`, () => {
    const p = new Px(18, 12);
    const bone = (x0: number, y0: number, x1: number, y1: number) => {
      stroke(p, x0, y0, x1, y1, BONE[2], 2);
      shadeEll(p, x0, y0, 1.3, 1.1, BONE);
      shadeEll(p, x1, y1, 1.3, 1.1, BONE);
    };
    if (v === 0) {
      bone(2, 9, 10, 7);
      bone(8, 10, 15, 8);
      shadeEll(p, 13, 5, 2.6, 2.2, BONE);
    } else if (v === 1) {
      bone(3, 6, 13, 9);
      for (let i = 0; i < 3; i++) stroke(p, 5 + i * 3, 4, 6 + i * 3, 9, BONE[1]);
    } else {
      shadeEll(p, 6, 7, 3, 2.6, BONE);
      bone(9, 9, 16, 7);
    }
    p.outline(INK);
    if (v !== 1) {
      p.set(v ? 5 : 12, v ? 7 : 5, hx('#1a1410'));
    }
    return { img: p.canvas(), ax: 9, ay: 12 };
  });
});

// Палатка искателей: полотно с полосой, порванный полог, колышки, пепел.
registerPropPainter('f6_tent', (o) => {
  const v = Math.floor(hash(o.x, o.y, 26) * 2);
  return spriteOf(`tent|${v}`, () => {
    const p = new Px(26, 22);
    const cloth: Tones = v
      ? [hx('#4a3a24'), hx('#7a6440'), hx('#a88c5c'), hx('#ccb488')]
      : [hx('#4a2420'), hx('#7a3a30'), hx('#a45a44'), hx('#c8806a')];
    // Скат: светлый слева, тёмный справа.
    poly(
      p,
      [
        [2, 20],
        [12, 3],
        [13, 20],
      ],
      (x, y) => tone(cloth, 0.7 - (y - 3) * 0.01),
    );
    poly(
      p,
      [
        [12, 3],
        [24, 20],
        [13, 20],
      ],
      (x) => tone(cloth, 0.25 - (x - 12) * 0.01),
    );
    // Полоса по полотну.
    for (let y = 8; y < 20; y++) {
      const x = Math.round(12 - (y - 3) * 0.55);
      p.set(x + 3, y, tone(cloth, 0.9));
    }
    // Вход — тёмный треугольник, полог откинут.
    poly(
      p,
      [
        [9, 20],
        [12, 10],
        [15, 20],
      ],
      hx('#140c08'),
    );
    poly(
      p,
      [
        [15, 20],
        [12, 10],
        [18, 18],
      ],
      tone(cloth, 0.4),
    );
    p.outline(INK);
    // Шест и верёвки, колышки.
    stroke(p, 12, 1, 12, 4, hx('#5a3a20'));
    p.set(1, 21, hx('#8a6a40'));
    p.set(25, 21, hx('#8a6a40'));
    // Пепел на скате.
    for (let i = 0; i < 6; i++) p.set(5 + i * 3, 12 + (i % 3) * 2, alpha(ASH.lt, 0.85));
    return { img: p.canvas(), ax: 13, ay: 21 };
  });
});

// Лежак и мешок: скатка, котомка, сковорода.
registerPropPainter('f6_bedroll', (o) => {
  const v = Math.floor(hash(o.x, o.y, 27) * 2);
  return spriteOf(`bed|${v}`, () => {
    const p = new Px(20, 12);
    const roll: Tones = [hx('#2a3a44'), hx('#3e5a66'), hx('#5a7e8a'), hx('#86a8b0')];
    limb(p, 2, 8, 12, 8, 2.4, 2.4, roll);
    for (const x of [5, 9]) stroke(p, x, 6, x, 10, hx('#6a4a2a'));
    shadeEll(p, 15.5, 6.5, 3, 3.4, SACK);
    shadeEll(p, 15.5, 3.4, 1.6, 0.9, SACK);
    p.outline(INK);
    if (v) {
      // Сковородка на мешке — отсылка к повару отряда.
      p.ell(15, 9, 2.4, 1.2, hx('#3a3a40'));
      stroke(p, 17, 9, 19, 10, hx('#2a1a10'));
    }
    return { img: p.canvas(), ax: 10, ay: 12 };
  });
});

// Котёл над огнём на треноге: варево булькает, пар, половник.
registerPropPainter('f6_cauldron', (_o, time) => {
  const f = Math.floor(time * 7) % 4;
  return spriteOf(`cauldron|${f}`, () => {
    const p = new Px(22, 28);
    const iron: Tones = [hx('#141416'), hx('#2a2a30'), hx('#4a4a54'), hx('#7a7a86')];
    // Тренога.
    stroke(p, 3, 26, 11, 6, hx('#3a2412'), 2);
    stroke(p, 19, 26, 11, 6, hx('#3a2412'), 2);
    stroke(p, 11, 6, 11, 10, hx('#5a5a60'));
    // Огонь под котлом.
    flame(p, 9, 26, 5, f, 2);
    flame(p, 13, 26, 4, f + 1, 1.8);
    // Котёл.
    shadeEll(p, 11, 17, 7, 5.5, iron);
    p.ell(11, 12.5, 6.4, 1.8, iron[0]);
    p.outline(INK);
    // Варево: рыжее, пузыри по кадрам.
    p.ell(11, 12.6, 5.4, 1.2, hx('#a8581e'));
    p.set(8 + f, 12, hx('#e8964a'));
    p.set(13 - (f % 2), 13, hx('#e8964a'));
    // Половник.
    stroke(p, 14, 12, 18, 6, hx('#8a8a92'));
    p.set(18, 5, hx('#c8c8d0'));
    // Пар.
    for (let i = 0; i < 4; i++) {
      const y = 9 - i * 2 - (f % 2);
      p.set(8 + ((i + f) % 3) * 2, y, alpha(hx('#e8e0d4'), 0.7 - i * 0.12));
    }
    return { img: p.canvas(), ax: 11, ay: 27 };
  });
});

// Костёр в кольце камней.
registerPropPainter('f6_campfire', (_o, time) => {
  const f = Math.floor(time * 8) % 4;
  return spriteOf(`fire|${f}`, () => {
    const p = new Px(18, 18);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU;
      shadeEll(p, 9 + Math.cos(a) * 6, 13 + Math.sin(a) * 2.6, 1.6, 1.2, BASALT);
    }
    const wood: Tones = [hx('#2a160c'), hx('#50301a'), hx('#744a2a'), hx('#96643a')];
    limb(p, 4, 14, 14, 11, 1.2, 1, wood);
    limb(p, 4, 11, 14, 14, 1.2, 1, wood);
    p.outline(INK);
    flame(p, 9, 13, 8, f, 2.6);
    flame(p, 6, 13, 4, f + 2, 1.4);
    flame(p, 12, 13, 5, f + 1, 1.6);
    return { img: p.canvas(), ax: 9, ay: 16 };
  });
});

// Меч искателя в пепле, на гарде — выгоревшая лента.
registerPropPainter('f6_sword', (o) => {
  const v = Math.floor(hash(o.x, o.y, 28) * 2);
  return spriteOf(`sword|${v}`, () => {
    const p = new Px(14, 22);
    const steel: Tones = [hx('#4a4e54'), hx('#7e868e'), hx('#b4bcc4'), hx('#e8eef2')];
    const lean = v ? 1 : -1;
    limb(p, 7 + lean * 2, 6, 7 - lean, 19, 1.2, 0.9, steel);
    stroke(p, 3 + lean * 2, 7, 11 + lean * 2, 6, hx('#8a6a30'), 2);
    stroke(p, 7 + lean * 2.4, 6, 7 + lean * 3, 2, hx('#4a2a18'), 2);
    p.set(Math.floor(7 + lean * 3), 1, GOLD);
    // Лента.
    stroke(p, 9 + lean * 2, 7, 12 + lean, 11, hx('#8a2a1a'));
    for (let x = 3; x < 12; x++) p.set(x, 20 + (x % 2), ASH.lt);
    p.outline(INK);
    return { img: p.canvas(), ax: 7, ay: 21 };
  });
});

// Пепельный нанос.
registerPropPainter('f6_ashpile', (o) => {
  const v = Math.floor(hash(o.x, o.y, 29) * 3);
  return spriteOf(`ash|${v}`, () => {
    const p = new Px(18, 10);
    const t: Tones = [ASH.dk, ASH.mid, ASH.lt, ASH.hi];
    shadeEll(p, 9, 8, 7 - v, 3.2, t);
    shadeEll(p, 6 + v * 2, 6, 3, 2.2, t, 0.1);
    // Уголёк в пепле.
    p.set(10 + v, 7, LAVA.hot);
    return { img: p.canvas(), ax: 9, ay: 10 };
  });
});

// Друза кварца: искра бежит по граням.
registerPropPainter('f6_quartz', (o, time) => {
  const f = Math.floor(time * 3 + hash(o.x, o.y) * 8) % 8;
  const v = Math.floor(hash(o.x, o.y, 30) * 2);
  return spriteOf(`quartz|${v}|${f}`, () => {
    const p = new Px(16, 20);
    shadeEll(p, 8, 17, 6, 2.6, ORE_ROCK);
    const cr: [number, number, number, number][] = v
      ? [
          [5, 17, 1.5, 9],
          [8.5, 17, 1.8, 13],
          [12, 17, 1.3, 7],
        ]
      : [
          [4.5, 17, 1.3, 7],
          [8, 17, 1.7, 11],
          [11, 17, 1.5, 9],
        ];
    for (const [x, y, w, h] of cr)
      poly(
        p,
        [
          [x - w, y],
          [x - w, y - h + 1.5],
          [x, y - h],
          [x + w, y - h + 1.5],
          [x + w, y],
        ],
        (px) => (px < x ? QUARTZ[2] : px > x ? QUARTZ[1] : QUARTZ[3]),
      );
    p.outline(INK);
    if (f < 4) {
      const [x, , , h] = cr[f % 3];
      p.set(Math.round(x), Math.round(17 - h + 2 + f), WHITE);
      p.set(Math.round(x) + 1, Math.round(17 - h + 2 + f), alpha(WHITE, 0.6));
    }
    return { img: p.canvas(), ax: 8, ay: 19 };
  });
});

// Серебряная жила в камне.
registerPropPainter('f6_silver', () =>
  spriteOf('silver', () => {
    const p = new Px(16, 14);
    shadeEll(p, 8, 9, 6.5, 4.4, ORE_ROCK);
    shadeEll(p, 6, 6, 3.4, 2.4, ORE_ROCK, 0.1);
    const vein = spline(
      [
        [3, 10],
        [6, 7],
        [9, 9],
        [13, 6],
      ],
      4,
    );
    vein.forEach(([x, y]) => {
      p.set(Math.floor(x), Math.floor(y), SILVER[2]);
      p.set(Math.floor(x), Math.floor(y) + 1, SILVER[0]);
    });
    shadeEll(p, 10, 5.5, 1.6, 1.3, SILVER);
    p.outline(INK);
    p.set(10, 5, WHITE);
    return { img: p.canvas(), ax: 8, ay: 13 };
  }),
);

// Обсидиановая жеода: чёрное стекло, в сколе — фиолетовые кристаллы.
registerPropPainter('f6_geode', (o, _time, _alive, flash) => {
  const v = Math.floor(hash(o.x, o.y, 31) * 2);
  return spriteOf(`geode|${v}|${flash ? 1 : 0}`, () => {
    let p = new Px(16, 14);
    shadeEll(p, 8, 8, 6, 4.8, OBSID);
    // Скол: тёмная полость с друзой.
    p.ell(v ? 6 : 10, 7, 2.6, 2, hx('#1a1030'));
    for (let i = 0; i < 4; i++)
      p.set((v ? 5 : 9) + (i % 2), 6 + (i >> 1), i % 2 ? hx('#b08aff') : hx('#e0d0ff'));
    p.outline(INK);
    // Стеклянный блик.
    stroke(p, v ? 10 : 4, 5, v ? 12 : 6, 4, OBSID[3]);
    p = flashed(p, flash);
    return { img: p.canvas(), ax: 8, ay: 13 };
  });
});

// Ящик припасов: доски, верёвка, клеймо отряда.
registerPropPainter('f6_crate', (o, _time, _alive, flash) => {
  const v = Math.floor(hash(o.x, o.y, 32) * 2);
  return spriteOf(`crate|${v}|${flash ? 1 : 0}`, () => {
    let p = new Px(16, 16);
    const wood: Tones = [hx('#3a2412'), hx('#6a4424'), hx('#946236'), hx('#b8844c')];
    for (let y = 4; y < 15; y++)
      for (let x = 2; x < 14; x++) {
        const seam = y === 9 || x === 2 || x === 13;
        p.set(x, y, tone(wood, (seam ? 0.1 : 0.55) - (x - 2) * 0.02));
      }
    for (let x = 2; x < 14; x++) p.set(x, 3, wood[3]);
    // Верёвка крестом.
    stroke(p, 2, 4, 13, 14, hx('#c8b080'));
    stroke(p, 13, 4, 2, 14, hx('#c8b080'));
    p.outline(INK);
    if (v) {
      // Опалённый угол.
      for (let y = 10; y < 15; y++) for (let x = 10; x < 14; x++) if ((x + y) % 2) p.set(x, y, hx('#1a100a'));
    }
    p = flashed(p, flash);
    return { img: p.canvas(), ax: 8, ay: 15 };
  });
});

// Базальтовая жаровня: чаша на ножке, огонь.
registerPropPainter('f6_brazier', (o, time) => {
  const f = Math.floor(time * 8 + hash(o.x, o.y) * 4) % 4;
  return spriteOf(`brazier|${f}`, () => {
    const p = new Px(14, 24);
    limb(p, 7, 22, 7, 15, 1.6, 1.3, BASALT);
    shadeEll(p, 7, 22.5, 3.6, 1.3, BASALT);
    shadeEll(p, 7, 14, 5.6, 2.8, BASALT);
    p.outline(INK);
    p.ell(7, 12.8, 4.4, 1.2, LAVA.dark);
    p.set(5, 13, LAVA.bright);
    p.set(9, 13, LAVA.hot);
    flame(p, 7, 13, 8, f, 2.4);
    flame(p, 4, 13, 4, f + 1, 1.2);
    flame(p, 10, 13, 5, f + 3, 1.3);
    return { img: p.canvas(), ax: 7, ay: 23 };
  });
});

// Яйцо змея: чешуйчатое, трещины светятся и дышат.
registerPropPainter('f6_egg', (o, time) => {
  const ph = hash(o.x, o.y, 33) * TAU;
  const f = Math.floor((Math.sin(time * 2.4 + ph) * 0.5 + 0.5) * 3.99);
  return spriteOf(`egg|${f}`, () => {
    const p = new Px(14, 18);
    const shell: Tones = [hx('#2a0808'), hx('#5a1410'), hx('#8a2a1a'), hx('#c05a3a')];
    shadeEll(p, 7, 10, 5.2, 7, shell);
    // Чешуя дугами.
    for (let y = 5; y < 16; y += 3)
      for (let x = 3 + ((y / 3) % 2); x < 12; x += 3) p.set(x, y, shell[0]);
    p.outline(INK);
    // Трещины со светом изнутри.
    const glow = [LAVA.dark, LAVA.mid, LAVA.hot, LAVA.bright][f];
    const crack = spline(
      [
        [4, 6],
        [6, 9],
        [5, 12],
        [8, 14],
      ],
      4,
    );
    crack.forEach(([x, y]) => p.set(Math.floor(x), Math.floor(y), glow));
    p.set(9, 7, glow);
    p.set(10, 8, glow);
    return { img: p.canvas(), ax: 7, ay: 17 };
  });
});

// Скорлупа вылупившихся.
registerPropPainter('f6_shell', (o) => {
  const v = Math.floor(hash(o.x, o.y, 34) * 2);
  return spriteOf(`shell|${v}`, () => {
    const p = new Px(18, 10);
    const shell: Tones = [hx('#2a0808'), hx('#5a1410'), hx('#8a2a1a'), hx('#c05a3a')];
    // Половинка — чаша, зубчатый край.
    shadeEll(p, 7, 7, 5, 3, shell);
    for (let x = 2; x <= 12; x += 2) clear(p, x, 4 + (x % 4 === 0 ? 1 : 0));
    p.ell(7, 5.6, 3.6, 1, hx('#e8c8a0'));
    // Осколки.
    shadeEll(p, 14, 8, 1.6, 1, shell);
    if (v) shadeEll(p, 2, 9, 1.4, 0.8, shell);
    p.outline(INK);
    return { img: p.canvas(), ax: 8, ay: 10 };
  });
});

// ---------------------------------------------------------------------------
// Свои клетки. У каждого района — свой рисовальщик и своя палитра:
//   галереи — лава старая, в корке, пепла много;
//   озёра — лава жидкая и яркая, мосты из обсидиана;
//   гнездо — лава багровая, кольца зала извержения, чешуя пола арены.
// Лава, корка и пепел — окна одной бесшовной текстуры 64×64 (узор идёт
// через клетки без стыков, а кеш — по окну и соседям).
// ---------------------------------------------------------------------------

type Style = 'gallery' | 'lakes' | 'nest';

interface StyleDef {
  lava: RGBA[];
  /** Пороги рампы лавы: чем выше, тем темнее лава. */
  ramp: number[];
  raft: number;
  seam: RGBA[];
  plate: Tones;
  ash: number;
}

const STYLES: Record<Style, StyleDef> = {
  gallery: {
    lava: [hx('#4a0c06'), hx('#8a1c08'), hx('#c8360c'), hx('#f0641a'), hx('#ffa42c'), hx('#ffe08a')],
    ramp: [0.3, 0.5, 0.68, 0.84, 0.95],
    raft: 0.55,
    seam: [hx('#5a1206'), hx('#b8300c'), hx('#ff7a1e'), hx('#ffc048')],
    plate: [hx('#161012'), hx('#241a1a'), hx('#382a28'), hx('#503c36')],
    ash: 1,
  },
  lakes: {
    lava: [hx('#7a1606'), hx('#c0300a'), hx('#ee5210'), hx('#ff8a1e'), hx('#ffc440'), hx('#fff4b0')],
    ramp: [0.22, 0.4, 0.58, 0.78, 0.92],
    raft: 0.63,
    seam: [hx('#6a1606'), hx('#d8420e'), hx('#ff9a24'), hx('#ffe07a')],
    plate: [hx('#1a1012'), hx('#2a1a1a'), hx('#402a26'), hx('#5a3e34')],
    ash: 0.7,
  },
  nest: {
    lava: [hx('#3a0406'), hx('#7a0c0c'), hx('#b81a10'), hx('#e8401a'), hx('#ff8a30'), hx('#ffd070')],
    ramp: [0.26, 0.46, 0.64, 0.82, 0.94],
    raft: 0.59,
    seam: [hx('#4a0808'), hx('#a81810'), hx('#f0501a'), hx('#ffb040')],
    plate: [hx('#140c0e'), hx('#221418'), hx('#361e22'), hx('#4e2c2c')],
    ash: 0.5,
  },
};

/** Бесшовный шум: решётка заворачивается через `P` узлов. */
function tnoise(x: number, y: number, s: number, P: number, seed: number): number {
  const xi = Math.floor(x / s);
  const yi = Math.floor(y / s);
  const fx = x / s - xi;
  const fy = y / s - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const w = (a: number) => ((a % P) + P) % P;
  const a = hash(w(xi), w(yi), seed) * (1 - u) + hash(w(xi + 1), w(yi), seed) * u;
  const b = hash(w(xi), w(yi + 1), seed) * (1 - u) + hash(w(xi + 1), w(yi + 1), seed) * u;
  return a * (1 - v) + b * v;
}

const TEX = 64;
const texCache = new Map<string, Px>();

/** Лава — период 128 (восемь клеток), чтобы узор не повторялся на глаз.
 * Тёмная основа, по ней тонкие жилы течения (изолинии шума), плоты корки с
 * тлеющей кромкой и редкие белые пятна жара. Жёлтого мало: ярко — только
 * там, где лава течёт. */
const LTEX = 256;
function lavaTex(style: Style): Px {
  const key = `lava|${style}`;
  let t = texCache.get(key);
  if (t) return t;
  const sd = STYLES[style];
  t = new Px(LTEX, LTEX);
  for (let y = 0; y < LTEX; y++)
    for (let x = 0; x < LTEX; x++) {
      const n1 = tnoise(x, y, 64, 4, 11);
      const n2 = tnoise(x, y, 16, 16, 12);
      const n3 = tnoise(x, y, 4, 64, 14);
      // Плоты — шум, искривлённый другим шумом: без прямых полос решётки.
      const wx2 = x + (n2 - 0.5) * 24;
      const wy2 = y + (n1 - 0.5) * 24;
      const raft = tnoise(wx2, wy2, 32, 8, 13) * 0.62 + tnoise(x, y, 8, 32, 15) * 0.24 + n3 * 0.14;
      if (raft > sd.raft) {
        const edge = raft < sd.raft + 0.025;
        const lit = raft > sd.raft + 0.1 && n3 > 0.6;
        t.set(x, y, edge ? sd.lava[2] : lit ? LAVA.crustLt : LAVA.crust);
        continue;
      }
      // Течение: изолинии медленного шума, сдвинутые мелким.
      const v = n1 * 0.6 + n2 * 0.4;
      const f = (v * 6 + n3 * 0.35) % 1;
      const vein = Math.abs(f - 0.5);
      let k = v > 0.6 ? 2 : v > 0.36 ? 1 : 0;
      // Жилы рвутся: течение видно пятнами, а не контурной картой.
      if (vein < 0.06 && n2 > 0.38) k = Math.max(k, 3);
      if (vein < 0.03 && n2 > 0.45) k = 4;
      if (n3 > 0.9 && n2 > 0.6) k = 5;
      // Возле плота лава темнеет: корка остужает.
      if (raft > sd.raft - 0.05 && k < 3) k = Math.max(0, k - 1);
      t.set(x, y, sd.lava[k]);
    }
  texCache.set(key, t);
  return t;
}

/** Корка: плиты (ячейки Вороного) и горящие швы между ними. */
function crustTex(style: Style, hot = 0, cold = false): Px {
  const key = `crust|${style}|${hot}|${cold ? 1 : 0}`;
  let t = texCache.get(key);
  if (t) return t;
  const sd0 = STYLES[style];
  // Холодная корка — пол логова: древнее застывшее озеро, швы еле тлеют.
  const sd = cold
    ? {
        ...sd0,
        seam: [hx('#140606'), hx('#2a0a08'), hx('#4a140e'), hx('#6a2012')] as RGBA[],
        plate: [hx('#141012'), hx('#221a1c'), hx('#322628'), hx('#463634')] as Tones,
      }
    : sd0;
  const pts: [number, number][] = [];
  for (let i = 0; i < 14; i++) pts.push([hash(i, 1, 41) * TEX, hash(i, 2, 41) * TEX]);
  t = new Px(TEX, TEX);
  for (let y = 0; y < TEX; y++)
    for (let x = 0; x < TEX; x++) {
      let d1 = 1e9;
      let d2 = 1e9;
      for (const [px, py] of pts)
        for (let oy = -1; oy <= 1; oy++)
          for (let ox = -1; ox <= 1; ox++) {
            const d = Math.hypot(x + 0.5 - px - ox * TEX, y + 0.5 - py - oy * TEX);
            if (d < d1) {
              d2 = d1;
              d1 = d;
            } else if (d < d2) d2 = d;
          }
      const gap = d2 - d1;
      if (gap < 1.4) {
        const c = gap < 0.55 ? sd.seam[hot ? 3 : 2] : sd.seam[hot ? 2 : 1];
        t.set(x, y, c);
        continue;
      }
      // Плита: светлее к центру ячейки (выпуклая), по краю — темнее.
      const n = tnoise(x, y, 4, 16, 42);
      let l = 0.55 - Math.min(1, gap / 9) * -0.2 + (n - 0.5) * 0.5 - (d1 / 14) * 0.4;
      if (hot) l -= 0.15;
      const base = tone(sd.plate, l);
      t.set(x, y, hot && gap < 2.4 ? mixc(base, sd.seam[1], 0.5) : base);
    }
  texCache.set(key, t);
  return t;
}

/** Пепел: тонкий налёт с рябью барханов, полупрозрачный — пол
 * просвечивает. Тёмный: светлый пепел читался снегом и забивал всё. */
function ashTex(): Px {
  const key = 'ash';
  let t = texCache.get(key);
  if (t) return t;
  t = new Px(TEX, TEX);
  for (let y = 0; y < TEX; y++)
    for (let x = 0; x < TEX; x++) {
      const n = tnoise(x, y, 16, 4, 51);
      const m = tnoise(x, y, 4, 16, 53);
      // Рябь — изолинии шума, а не синус: полосы не выстраиваются в ряд.
      const r = Math.abs(((n * 5 + m * 0.4) % 1) - 0.5);
      // Гребни ряби — рваные и редкие, основное — зернистая пыль.
      const ridge = r < 0.045 && m > 0.45;
      const g = hash(x, y, 54);
      const c = ridge ? (g < 0.5 ? ASH.hi : ASH.lt) : g < 0.3 ? ASH.lt : m > 0.55 ? ASH.mid : ASH.dk;
      const a = 0.14 + n * 0.28 + (ridge ? 0.12 : 0);
      t.set(x, y, alpha(c, a));
      if (hash(x, y, 52) < 0.015) t.set(x, y, alpha(hx('#1a1412'), 0.7));
    }
  texCache.set(key, t);
  return t;
}

/** Окно текстуры 16×16 по мировой клетке. */
function windowOf(t: Px, wx: number, wy: number): Px {
  const p = new Px(16, 16);
  const n = t.w / 16;
  const ox = (((wx % n) + n) % n) * 16;
  const oy = (((wy % n) + n) % n) * 16;
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const i = ((oy + y) * t.w + ox + x) * 4;
      p.data.set(t.data.subarray(i, i + 4), (y * 16 + x) * 4);
    }
  return p;
}

const cells = new Map<string, Px>();
const cellOf = (key: string, make: () => Px): Px => {
  let c = cells.get(key);
  if (!c) {
    c = make();
    cells.set(key, c);
  }
  return c;
};

const isLavaMark = (m: number) => m === F6_MARK.lava;

/** Лава: окно текстуры + берега там, где сосед — не лава. Берег рваный
 * (глубина — по бесшовному шуму от мировых координат, стык клеток без
 * шва), выпуклые углы скруглены, у самой кромки — тонкая полоса жара. */
function lavaCell(c: CellCtx, style: Style): Px {
  const lava = (dx: number, dy: number) => isLavaMark(c.markAt(dx, dy));
  const n = !lava(0, -1);
  const e = !lava(1, 0);
  const s = !lava(0, 1);
  const w = !lava(-1, 0);
  // Вогнутые углы: соседи по сторонам — лава, по диагонали — нет.
  const nw = !n && !w && !lava(-1, -1);
  const ne = !n && !e && !lava(1, -1);
  const sw = !s && !w && !lava(-1, 1);
  const se = !s && !e && !lava(1, 1);
  const mask =
    (n ? 1 : 0) | (e ? 2 : 0) | (s ? 4 : 0) | (w ? 8 : 0) | (nw ? 16 : 0) | (ne ? 32 : 0) | (sw ? 64 : 0) | (se ? 128 : 0);
  const P = LTEX / 16;
  const ox = ((c.wx % P) + P) % P;
  const oy = ((c.wy % P) + P) % P;
  return cellOf(`lava|${style}|${ox}|${oy}|${mask}`, () => {
    const p = windowOf(lavaTex(style), c.wx, c.wy);
    const sd = STYLES[style];
    const rock = sd.plate;
    // Глубина берега в пикселях от края клетки: 0 — лава.
    const depth = (x: number, y: number): number => {
      let d = -99;
      const gx = ox * 16 + x;
      const gy = oy * 16 + y;
      const nx = (v: number, seed: number) => 1.6 + tnoise(v, seed, 8, 16, 64 + seed) * 3.4;
      if (n) d = Math.max(d, nx(gx, 1) - y);
      if (s) d = Math.max(d, nx(gx, 2) - (15 - y));
      if (w) d = Math.max(d, nx(gy, 3) - x);
      if (e) d = Math.max(d, nx(gy, 4) - (15 - x));
      // Выпуклые углы (две стороны берега) скругляются дугой.
      const corner = (cx: number, cy: number, on: boolean) => {
        if (!on) return;
        const r = 5.5 - Math.hypot(x - cx, y - cy);
        d = Math.max(d, r);
      };
      corner(0, 0, n && w);
      corner(15, 0, n && e);
      corner(0, 15, s && w);
      corner(15, 15, s && e);
      // Вогнутые углы: маленький мыс камня.
      const cape = (cx: number, cy: number, on: boolean) => {
        if (!on) return;
        d = Math.max(d, 3.2 - Math.hypot(x - cx, y - cy));
      };
      cape(0, 0, nw);
      cape(15, 0, ne);
      cape(0, 15, sw);
      cape(15, 15, se);
      return d;
    };
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const d = depth(x, y);
        if (d <= -1.2) continue;
        if (d <= 0) {
          // Кромка лавы у берега — яркая нить жара.
          p.set(x, y, d > -0.6 ? sd.lava[4] : sd.lava[3]);
          continue;
        }
        // Берег: корка у воды, дальше — камень; северный — светлее (лицо).
        const top = n && y < 8;
        const col = d < 1.2 ? LAVA.crustLt : d < 2.4 ? LAVA.crust : top ? rock[2] : rock[1];
        p.set(x, y, col);
      }
    return p;
  });
}

/** Край, рваный к соседям другого вида: стираем пиксели у кромки. */
function fringe(p: Px, c: CellCtx, keep: (m: number) => boolean, seed: number, depth: number, fade = false): void {
  const sides: [number, number][] = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ];
  for (const [dx, dy] of sides) {
    if (keep(c.markAt(dx, dy))) continue;
    for (let i = 0; i < 16; i++) {
      const d = Math.round(hash(i, c.wx * 7 + c.wy, seed + dx * 3 + dy) * depth);
      for (let k = 0; k <= d; k++) {
        const x = dx === 1 ? 15 - k : dx === -1 ? k : i;
        const y = dy === 1 ? 15 - k : dy === -1 ? k : i;
        if (fade && k === d) {
          const col = p.get(x, y);
          if (col[3]) p.data[(y * 16 + x) * 4 + 3] = Math.round(col[3] * 0.5);
        } else clear(p, x, y);
      }
    }
  }
}

const sideMask = (c: CellCtx, keep: (m: number) => boolean) =>
  (keep(c.markAt(0, -1)) ? 0 : 1) |
  (keep(c.markAt(1, 0)) ? 0 : 2) |
  (keep(c.markAt(0, 1)) ? 0 : 4) |
  (keep(c.markAt(-1, 0)) ? 0 : 8);

function crustCell(c: CellCtx, style: Style, hot = 0): Px {
  const keep = (m: number) =>
    m === F6_MARK.crust || m === F6_MARK.lava || m === F6_MARK.hotcrust || m === F6_MARK.cooled;
  const mask = sideMask(c, keep);
  const ox = ((c.wx % 4) + 4) % 4;
  const oy = ((c.wy % 4) + 4) % 4;
  return cellOf(`crust|${style}|${hot}|${ox}|${oy}|${mask}`, () => {
    const p = windowOf(crustTex(style, hot), c.wx, c.wy);
    fringe(p, c, keep, 71, 2.4);
    return p;
  });
}

function cooledCell(c: CellCtx): Px {
  const ox = ((c.wx % 4) + 4) % 4;
  const oy = ((c.wy % 4) + 4) % 4;
  return cellOf(`cooled|${ox}|${oy}`, () => {
    // Свежий обсидиан: чёрное стекло, в швах ещё тлеет.
    const src = windowOf(crustTex('nest'), c.wx, c.wy);
    const p = new Px(16, 16);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const col = src.get(x, y);
        const seam = col[0] > 120 && col[1] < 120;
        const n = hash(x + c.wx * 16, y + c.wy * 16, 81);
        p.set(x, y, seam ? (n < 0.3 ? hx('#7a1a0c') : OBSID[0]) : n < 0.08 ? OBSID[2] : OBSID[1]);
      }
    // Стеклянные блики наискосок.
    for (let k = 0; k < 5; k++) p.set((k * 3 + ox * 4) % 16, (k * 2 + oy * 5) % 16, OBSID[3]);
    return p;
  });
}

function ashCell(c: CellCtx, style: Style): Px {
  const keep = (m: number) => m === F6_MARK.ash;
  const mask = sideMask(c, keep);
  const ox = ((c.wx % 4) + 4) % 4;
  const oy = ((c.wy % 4) + 4) % 4;
  return cellOf(`ash|${style}|${ox}|${oy}|${mask}`, () => {
    const p = windowOf(ashTex(), c.wx, c.wy);
    const k = STYLES[style].ash;
    if (k < 1) for (let i = 3; i < p.data.length; i += 4) p.data[i] = Math.round(p.data[i] * k);
    fringe(p, c, keep, 72, 3.2, true);
    return p;
  });
}

function sootCell(c: CellCtx): Px {
  const v = Math.floor(hash(c.wx, c.wy, 73) * 4);
  return cellOf(`soot|${v}`, () => {
    const p = new Px(16, 16);
    // Копоть пятнами и обугленные щепки.
    for (let i = 0; i < 3; i++) {
      const x = 3 + hash(i, v, 74) * 10;
      const y = 3 + hash(i, v, 75) * 10;
      const r = 2 + hash(i, v, 76) * 3;
      p.ell(x, y, r, r * 0.7, alpha(hx('#0e0a0a'), 0.35));
      p.ell(x, y, r * 0.5, r * 0.35, alpha(hx('#0e0a0a'), 0.35));
    }
    for (let i = 0; i < 3; i++) {
      const x = Math.floor(hash(i, v, 77) * 14) + 1;
      const y = Math.floor(hash(i, v, 78) * 14) + 1;
      p.set(x, y, hx('#1a1210'));
      p.set(x + 1, y, hx('#2a1c16'));
    }
    if (v === 2) p.set(8, 9, alpha(LAVA.hot, 0.8));
    return p;
  });
}

/** Трещина со светом снизу: соединяется с соседними трещинами. */
function fissureCell(c: CellCtx, style: Style): Px {
  const f = (dx: number, dy: number) => c.markAt(dx, dy) === F6_MARK.fissure;
  const mask = (f(0, -1) ? 1 : 0) | (f(1, 0) ? 2 : 0) | (f(0, 1) ? 4 : 0) | (f(-1, 0) ? 8 : 0);
  const v = Math.floor(hash(c.wx, c.wy, 79) * 3);
  return cellOf(`fis|${style}|${mask}|${v}`, () => {
    const p = new Px(16, 16);
    const sd = STYLES[style];
    const ends: [number, number][] = [];
    if (mask & 1) ends.push([8, -1]);
    if (mask & 2) ends.push([16, 8]);
    if (mask & 4) ends.push([8, 16]);
    if (mask & 8) ends.push([-1, 8]);
    if (!ends.length) {
      ends.push(v ? [1, 3] : [2, 13]);
      ends.push(v ? [14, 12] : [14, 4]);
    }
    const mid: [number, number] = [7 + v, 8 - v];
    const paths = ends.map((e) =>
      spline(
        [
          mid,
          [(mid[0] + e[0]) / 2 + (hash(e[0], e[1], v) - 0.5) * 4, (mid[1] + e[1]) / 2 + (hash(e[1], e[0], v) - 0.5) * 4],
          e,
        ],
        6,
      ),
    );
    // Ореол, тёмные края, горящая сердцевина.
    for (const path of paths)
      for (const [x, y] of path) p.ell(x, y, 2, 1.6, alpha(sd.seam[1], 0.25));
    for (const path of paths)
      for (const [x, y] of path) {
        p.set(Math.floor(x) - 1, Math.floor(y), hx('#140806'));
        p.set(Math.floor(x) + 1, Math.floor(y), hx('#140806'));
      }
    for (const path of paths)
      path.forEach(([x, y], i) => p.set(Math.floor(x), Math.floor(y), i % 3 === 0 ? sd.seam[3] : sd.seam[2]));
    return p;
  });
}

/** Жерло гейзера: вал вокруг, чёрная дыра с жаром, сера. */
function ventCell(c: CellCtx): Px {
  const v = Math.floor(hash(c.wx, c.wy, 80) * 2);
  return cellOf(`vent|${v}`, () => {
    const p = new Px(16, 16);
    shadeEll(p, 8, 8.5, 6.4, 5.2, BASALT, 0.1);
    p.ell(8, 8.6, 3.8, 3, hx('#0e0808'));
    p.ell(8, 9.2, 1.8, 1.2, LAVA.dark);
    p.set(8, 9, LAVA.hot);
    // Сера и накипь по валу.
    for (let i = 0; i < 9; i++) {
      const a = hash(i, v, 81) * TAU;
      const r = 4.6 + hash(i, v, 82) * 2.2;
      p.set(Math.round(8 + Math.cos(a) * r), Math.round(8.5 + Math.sin(a) * r * 0.8), i % 3 ? hx('#c8bc40') : hx('#f0e070'));
    }
    return p;
  });
}

/** Обсидиановый мост: плиты стекла, к лаве — кромка с отсветом снизу. */
function bridgeCell(c: CellCtx): Px {
  const lava = (dx: number, dy: number) => isLavaMark(c.markAt(dx, dy));
  const mask = (lava(0, -1) ? 1 : 0) | (lava(1, 0) ? 2 : 0) | (lava(0, 1) ? 4 : 0) | (lava(-1, 0) ? 8 : 0);
  const v = Math.floor(hash(c.wx, c.wy, 83) * 3);
  const row = ((c.wy % 2) + 2) % 2;
  return cellOf(`bridge|${mask}|${v}|${row}`, () => {
    const p = new Px(16, 16);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const n = hash(x + v * 16, y, 84);
        const streak = (x + y * 2 + v * 3) % 13 === 0;
        p.set(x, y, streak ? OBSID[2] : n < 0.1 ? OBSID[0] : OBSID[1]);
      }
    // Швы плит поперёк моста.
    for (let x = 0; x < 16; x++) {
      p.set(x, row ? 3 : 11, OBSID[0]);
      p.set(x, row ? 4 : 12, OBSID[2]);
    }
    // Блик на стекле.
    stroke(p, 3 + v, 6, 7 + v, 5, OBSID[3]);
    if (mask & 8)
      for (let y = 0; y < 16; y++) {
        p.set(0, y, LAVA.hot);
        p.set(1, y, OBSID[0]);
        p.set(2, y, OBSID[3]);
      }
    if (mask & 2)
      for (let y = 0; y < 16; y++) {
        p.set(15, y, LAVA.bright);
        p.set(14, y, hx('#5a1a14'));
        p.set(13, y, OBSID[0]);
      }
    if (mask & 1)
      for (let x = 0; x < 16; x++) {
        p.set(x, 0, LAVA.hot);
        p.set(x, 1, OBSID[3]);
      }
    if (mask & 4)
      for (let x = 0; x < 16; x++) {
        p.set(x, 15, LAVA.bright);
        p.set(x, 14, OBSID[0]);
      }
    return p;
  });
}

/** Кольца зала извержения: тонкие швы по границам колец, копоть. */
function rimCell(c: CellCtx): Px {
  const k = c.mark;
  const other = (dx: number, dy: number) => c.markAt(dx, dy) !== k;
  const mask = (other(0, -1) ? 1 : 0) | (other(1, 0) ? 2 : 0) | (other(0, 1) ? 4 : 0) | (other(-1, 0) ? 8 : 0);
  const v = Math.floor(hash(c.wx, c.wy, 85) * 3);
  return cellOf(`rim|${k}|${mask}|${v}`, () => {
    const p = new Px(16, 16);
    const glow = k === F6_MARK.rim1 ? LAVA.mid : k === F6_MARK.rim2 ? LAVA.dark : LAVA.deep;
    const seam = (x: number, y: number) => {
      p.set(x, y, glow);
    };
    for (let i = 0; i < 16; i++) {
      const j = Math.round(hash(i, v, 86) * 1.2);
      if (mask & 1) seam(i, j);
      if (mask & 4) seam(i, 15 - j);
      if (mask & 8) seam(j, i);
      if (mask & 2) seam(15 - j, i);
    }
    // Мелкие трещинки внутри кольца и копоть.
    for (let i = 0; i < 3; i++) {
      const x = 2 + Math.floor(hash(i, v, 87) * 12);
      const y = 2 + Math.floor(hash(i, v, 88) * 12);
      p.set(x, y, alpha(hx('#0e0808'), 0.7));
      p.set(x + 1, y + (i % 2), alpha(glow, 0.8));
    }
    p.ell(8, 8, 5, 4, alpha(hx('#0e0a0a'), 0.12));
    return p;
  });
}

/** Пол арены: полированный базальт с мозаикой чешуи, плиты 2×2 клетки. */
function arenaCell(c: CellCtx): Px {
  const wallN = !c.open(0, -1);
  const wallW = !c.open(-1, 0);
  const wallE = !c.open(1, 0);
  const ox = ((c.wx % 4) + 4) % 4;
  const oy = ((c.wy % 4) + 4) % 4;
  // Редкие чешуйки змея, вплавленные в корку (ключ кеша их покрывает).
  const scale = hash(c.wx, c.wy, 87) < 0.18;
  const x0 = 4 + Math.floor(hash(c.wx, c.wy, 86) * 8);
  const y0 = 5 + Math.floor(hash(c.wx, c.wy, 85) * 6);
  const sk = scale ? `${x0}.${y0}` : '-';
  return cellOf(`arena|${ox}|${oy}|${wallN ? 1 : 0}${wallW ? 1 : 0}${wallE ? 1 : 0}|${sk}`, () => {
    // Пол логова — дно древнего лавового озера: крупные остывшие плиты,
    // швы еле тлеют. Чешуйчатая кладка читалась кирпичом, её сменила корка.
    const p = windowOf(crustTex('nest', 0, true), c.wx, c.wy);
    if (scale) {
      p.ell(x0, y0, 2.2, 1.6, hx('#5a1a12'));
      p.ell(x0, y0 - 0.4, 1.4, 0.9, hx('#8a3020'));
      p.set(x0 - 1, y0 - 1, hx('#c05a3a'));
    }
    if (wallN)
      for (let y = 0; y < 3; y++) for (let x = 0; x < 16; x++) p.set(x, y, mixc(p.get(x, y), hx('#050303'), 0.55 - y * 0.15));
    if (wallW) for (let x = 0; x < 2; x++) for (let y = 0; y < 16; y++) p.set(x, y, mixc(p.get(x, y), hx('#050303'), 0.4 - x * 0.15));
    if (wallE) for (let x = 14; x < 16; x++) for (let y = 0; y < 16; y++) p.set(x, y, mixc(p.get(x, y), hx('#050303'), 0.25));
    return p;
  });
}

/** Лицо стены: столбчатый базальт (вертикальные грани, поперечные сколы). */
function basaltWall(c: CellCtx): Px | null {
  if (!c.open(0, 1)) return null;
  const v = ((c.wx % 3) + 3) % 3;
  return cellOf(`basalt|${v}`, () => {
    const p = new Px(16, 16);
    const cols = [0, 4, 8, 12];
    for (const x0 of cols) {
      const brk = 7 + ((x0 + v * 3) % 5);
      for (let y = 5; y < 16; y++)
        for (let x = x0; x < x0 + 4; x++) {
          const l = x === x0 ? 0.8 : x === x0 + 3 ? 0.05 : 0.45;
          const c2 = y === brk ? BASALT[0] : tone(BASALT, l - (y - 5) * 0.02);
          p.set(x, y, alpha(c2, 0.9));
        }
    }
    return p;
  });
}

/** Лицо стены: магмовая жила ветвится и светится. */
function veinWall(c: CellCtx, style: Style): Px | null {
  const face = c.open(0, 1);
  const v = Math.floor(hash(c.wx, c.wy, 90) * 3);
  return cellOf(`vein|${style}|${face ? 1 : 0}|${v}`, () => {
    const p = new Px(16, 16);
    const sd = STYLES[style];
    if (!face) {
      for (let i = 0; i < 4; i++)
        p.set(Math.floor(hash(i, v, 91) * 16), Math.floor(hash(i, v, 92) * 16), sd.seam[2]);
      return p;
    }
    const main = spline(
      [
        [4 + v * 3, 5],
        [7, 9],
        [5 + v, 12],
        [8, 16],
      ],
      5,
    );
    const br = spline(
      [
        [7, 9],
        [11, 10],
        [14, 7 + v],
      ],
      4,
    );
    for (const path of [main, br])
      for (const [x, y] of path) p.ell(x, y, 1.6, 1.3, alpha(sd.seam[1], 0.4));
    for (const path of [main, br])
      path.forEach(([x, y], i) => p.set(Math.floor(x), Math.floor(y), i % 2 ? sd.seam[3] : sd.seam[2]));
    return p;
  });
}

/** Лицо стены под лавопадом: тёмный жёлоб, края в отсвете. */
function fallWall(c: CellCtx): Px | null {
  if (!c.open(0, 1)) return null;
  return cellOf('fallwall', () => {
    const p = new Px(16, 16);
    for (let y = 3; y < 16; y++) {
      for (let x = 3; x < 13; x++) p.set(x, y, alpha(hx('#0a0404'), 0.7));
      p.set(3, y, LAVA.dark);
      p.set(12, y, LAVA.hot);
    }
    return p;
  });
}

/** Цвет, которым порода этажа ложится на общую стену: у каждого района свой. */
const WALL_WASH: Record<Style, { face: RGBA; top: RGBA; glow: number }> = {
  gallery: { face: hx('#1e0e0c'), top: hx('#0e0808'), glow: 0.16 },
  lakes: { face: hx('#2c0e08'), top: hx('#140604'), glow: 0.26 },
  nest: { face: hx('#2a0608'), top: hx('#120404'), glow: 0.2 },
};

/** Общая стена под породой этажа. Лицо: тёмная вулканическая порода,
 * столбчатая отдельность (вертикальные трещины базальта) и отсвет лавы с
 * пола у подножия. Верх: гасим светлую кромку до тёмной — светлая кромка
 * читалась кирпичной кладкой. Поверх общей стены, поэтому полупрозрачно. */
function rockWall(c: CellCtx, style: Style): Px {
  const face = c.open(0, 1);
  const v = Math.floor(hash(c.wx, c.wy, 95) * 4);
  return cellOf(`rock|${style}|${face ? 1 : 0}|${v}`, () => {
    const p = new Px(16, 16);
    const W = WALL_WASH[style];
    if (!face) {
      for (let y = 0; y < 16; y++)
        for (let x = 0; x < 16; x++) p.set(x, y, alpha(W.top, 0.5));
      // Редкие угли в породе.
      if (v === 1) p.set(5 + v * 2, 9, alpha(LAVA.hot, 0.5));
      return p;
    }
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) p.set(x, y, alpha(W.face, 0.4));
    // Столбчатая отдельность: вертикальные швы с кромкой к свету.
    for (const x0 of [2 + v, 7 + (v % 2), 12 - (v % 3)]) {
      const y0 = 3 + ((x0 * 7 + v) % 4);
      for (let y = y0; y < 15; y++) {
        p.set(x0, y, alpha(hx('#080404'), 0.6));
        p.set(x0 + 1, y, alpha(hx('#6a3a30'), 0.3));
      }
      // Поперечный скол столба.
      const yb = y0 + 5 + (v % 3);
      if (yb < 15) for (let x = x0 - 2; x < x0; x++) if (x >= 0) p.set(x, yb, alpha(hx('#080404'), 0.5));
    }
    // Отсвет лавы с пола у подножия.
    for (let y = 12; y < 16; y++) {
      const a = W.glow * ((y - 11) / 4);
      for (let x = 0; x < 16; x++) {
        const c0 = p.get(x, y);
        p.set(x, y, c0[3] ? mixc(c0, LAVA.hot, a * 1.5) : alpha(LAVA.hot, a));
      }
    }
    return p;
  });
}

/** Две клетки в одну: `top` поверх `base`. */
function over(key: string, base: Px, top: Px | null): Px {
  if (!top) return base;
  return cellOf(key, () => {
    const p = new Px(16, 16);
    p.data.set(base.data);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const t = top.get(x, y);
        if (!t[3]) continue;
        const b = p.get(x, y);
        if (!b[3] || t[3] === 255) p.set(x, y, t);
        else {
          const a = t[3] / 255;
          const ab = a + (b[3] / 255) * (1 - a);
          const mix = (i: number) => Math.round((t[i] * a + b[i] * (b[3] / 255) * (1 - a)) / ab);
          p.set(x, y, [mix(0), mix(1), mix(2), Math.round(ab * 255)]);
        }
      }
    return p;
  });
}

function painter(style: Style) {
  return (c: CellCtx): Px | null => {
    switch (c.mark) {
      case F6_MARK.lava:
        return lavaCell(c, style);
      case F6_MARK.crust:
        return crustCell(c, style);
      case F6_MARK.hotcrust:
        return crustCell(c, style, 1);
      case F6_MARK.cooled:
        return cooledCell(c);
      case F6_MARK.ash:
        return ashCell(c, style);
      case F6_MARK.soot:
        return sootCell(c);
      case F6_MARK.fissure: {
        const f = fissureCell(c, style);
        // В арене трещина — поверх мозаики, а не голого пола.
        const arena = [
          [0, -1],
          [1, 0],
          [0, 1],
          [-1, 0],
        ].some(([dx, dy]) => c.markAt(dx, dy) === F6_MARK.arena);
        if (style !== 'nest' || !arena) return f;
        return cellOf(`fisA|${c.wx}|${c.wy}`, () => {
          const base = arenaCell({ ...c, mark: F6_MARK.arena });
          const p = new Px(16, 16);
          p.data.set(base.data);
          for (let i = 0; i < f.data.length; i += 4)
            if (f.data[i + 3]) p.set((i / 4) % 16, Math.floor(i / 64), [f.data[i], f.data[i + 1], f.data[i + 2], f.data[i + 3]]);
          return p;
        });
      }
      case F6_MARK.vent:
        return ventCell(c);
      case F6_MARK.bridge:
        return bridgeCell(c);
      case F6_MARK.rim1:
      case F6_MARK.rim2:
      case F6_MARK.rim3:
        return rimCell(c);
      case F6_MARK.arena:
        return arenaCell(c);
      case F6_MARK.rock:
        return rockWall(c, style);
      case F6_MARK.basalt:
        return over(`bw|${style}|${c.wx}|${c.wy}`, rockWall(c, style), basaltWall(c));
      case F6_MARK.vein:
        return over(`vw|${style}|${c.wx}|${c.wy}`, rockWall(c, style), veinWall(c, style));
      case F6_MARK.fall:
        return over(`fw|${style}|${c.wx}|${c.wy}`, rockWall(c, style), fallWall(c));
      default:
        return null;
    }
  };
}

registerCellPainter(F6_GALLERY, painter('gallery'));
registerCellPainter(F6_LAKES, painter('lakes'));
registerCellPainter(F6_NEST, painter('nest'));

// ---------------------------------------------------------------------------
// Метки ударов, лужи и эффекты. Рисуются прямо на полу контекстом в игровых
// пикселях; метка удара наливается к моменту удара (`k`).
// ---------------------------------------------------------------------------

export type ZoneX = (Zone | Strike) & {
  ang?: number;
  len?: number;
  arc?: number;
  sweep?: number;
  band?: number;
  w?: number;
};

/** Насколько налилась метка удара (0…1); у лужи — 1. */
export const kOf = (z: ZoneX) => {
  const s = z as Strike;
  if ('warn' in s && typeof s.warn === 'number' && s.warn > 0) return Math.min(1, s.t / s.warn);
  return 1;
};

/** Жизнь лужи после предупреждения: 0…1 (1 — только загорелась). */
export const lifeOf = (z: Zone) => {
  const warn = z.warn ?? 0;
  if (z.t < warn) return -1;
  return 1 - (z.t - warn) / Math.max(0.01, z.life);
};

export function cone(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  a: number,
  arc: number,
): void {
  g.beginPath();
  g.moveTo(x, y);
  g.arc(x, y, r, a - arc / 2, a + arc / 2);
  g.closePath();
}

/** Язычки огня вдоль отрезка — общий приём для волны и луж. */
export function tongues(
  g: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  n: number,
  h: number,
  time: number,
  a: number,
  seed: number,
): void {
  for (let i = 0; i < n; i++) {
    const k = (i + 0.5) / n;
    const x = x0 + (x1 - x0) * k;
    const y = y0 + (y1 - y0) * k;
    const hh = h * (0.6 + 0.4 * Math.abs(Math.sin(time * 9 + i * 1.7 + seed)));
    g.fillStyle = rgba(FIRE[1], 0.85 * a);
    g.fillRect(Math.round(x) - 1, Math.round(y - hh), 3, Math.round(hh));
    g.fillStyle = rgba(FIRE[2], 0.9 * a);
    g.fillRect(Math.round(x), Math.round(y - hh * 0.8), 1, Math.round(hh * 0.8));
    if ((i + Math.floor(time * 6)) % 3 === 0) {
      g.fillStyle = rgba(FIRE[3], a);
      g.fillRect(Math.round(x), Math.round(y - hh - 2), 1, 1);
    }
  }
}

// Горящая лужа: оранжевое озерцо, язычки по краю, гаснет к концу.
registerZonePainter('f6_firepool', (g, z, px, py, S, time) => {
  const zz = z as Zone;
  const l = lifeOf(zz);
  const R = zz.r * S;
  if (l < 0) {
    g.strokeStyle = rgba(FIRE[1], 0.6);
    g.beginPath();
    g.ellipse(px, py, R, R * 0.7, 0, 0, TAU);
    g.stroke();
    return true;
  }
  const a = Math.min(1, l * 3);
  g.fillStyle = rgba(LAVA.dark, 0.55 * a);
  g.beginPath();
  g.ellipse(px, py, R, R * 0.7, 0, 0, TAU);
  g.fill();
  g.fillStyle = rgba(LAVA.hot, 0.5 * a);
  g.beginPath();
  g.ellipse(px, py, R * 0.65, R * 0.45, 0, 0, TAU);
  g.fill();
  for (let i = 0; i < 6; i++) {
    const aa = (i / 6) * TAU + zz.id;
    const x = px + Math.cos(aa) * R * 0.7;
    const y = py + Math.sin(aa) * R * 0.5;
    tongues(g, x, y, x + 1, y, 1, 5 * a + 1, time, a, i + zz.id);
  }
  return true;
});

registerZonePainter('f6_footprint', (g, z, px, py) => {
  const l = lifeOf(z as Zone);
  if (l < 0) return true;
  g.fillStyle = rgba(LAVA.hot, 0.7 * l);
  g.fillRect(Math.round(px) - 2, Math.round(py) - 1, 4, 2);
  g.fillStyle = rgba(LAVA.bright, 0.8 * l);
  g.fillRect(Math.round(px) - 1, Math.round(py) - 1, 2, 1);
  return true;
});

// Удар голема: трещины бегут из центра, по краю — пыль.
registerZonePainter('f6_slam', (g, z, px, py, S) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const R = z.r * S;
  g.fillStyle = rgba(hx('#8a1a0c'), 0.1 + 0.25 * k);
  g.beginPath();
  g.ellipse(px, py, R, R * 0.8, 0, 0, TAU);
  g.fill();
  g.strokeStyle = rgba(hx('#1a0806'), 0.5 + 0.4 * k);
  g.lineWidth = 1;
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU + hash(i, zz.id) * 0.6;
    g.beginPath();
    g.moveTo(px, py);
    const r = R * k * (0.7 + hash(i, zz.id, 2) * 0.3);
    g.lineTo(px + Math.cos(a) * r, py + Math.sin(a) * r * 0.8);
    g.stroke();
  }
  g.strokeStyle = rgba(FIRE[2], 0.4 + 0.6 * k);
  g.beginPath();
  g.ellipse(px, py, R, R * 0.8, 0, 0, TAU);
  g.stroke();
  return true;
});

// Взрыв духа: кольцо огня расходится, вспышка.
registerZonePainter('f6_blast', (g, z, px, py, S) => {
  const zz = z as Zone;
  const t = Math.min(1, zz.t / Math.max(0.01, zz.life));
  const R = zz.r * S * (0.4 + t * 0.8);
  g.fillStyle = rgba(FIRE[3], 0.7 * (1 - t));
  g.beginPath();
  g.arc(px, py, R * 0.6, 0, TAU);
  g.fill();
  g.strokeStyle = rgba(FIRE[1], 1 - t);
  g.lineWidth = 4 * (1 - t) + 1;
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.stroke();
  return true;
});

// Погасший дух: дымок и искры.
registerZonePainter('f6_snuff', (g, z, px, py) => {
  const zz = z as Zone;
  const t = Math.min(1, zz.t / Math.max(0.01, zz.life));
  for (let i = 0; i < 8; i++) {
    const a = hash(i, zz.id) * TAU;
    const d = 2 + t * 10;
    g.fillStyle = i % 2 ? rgba(FIRE[3], 1 - t) : rgba(hx('#8a8078'), 0.7 * (1 - t));
    g.fillRect(Math.round(px + Math.cos(a) * d), Math.round(py - 6 + Math.sin(a) * d - t * 6), 1, 1);
  }
  return true;
});

// Угольки лопнувшей огнёвки.
registerZonePainter('f6_embers', (g, z, px, py, S, time) => {
  const zz = z as Zone;
  const l = lifeOf(zz);
  const R = zz.r * S;
  if (l < 0) {
    g.fillStyle = rgba(FIRE[3], 0.9);
    g.fillRect(Math.round(px) - 1, Math.round(py) - 1, 2, 2);
    return true;
  }
  for (let i = 0; i < 8; i++) {
    const a = hash(i, zz.id) * TAU;
    const d = R * (0.3 + hash(i, zz.id, 3) * 0.7);
    const blink = (Math.floor(time * 10) + i) % 3 ? 1 : 0.5;
    g.fillStyle = rgba(i % 3 ? FIRE[2] : FIRE[3], l * blink);
    g.fillRect(Math.round(px + Math.cos(a) * d), Math.round(py + Math.sin(a) * d * 0.7), 1, 1);
  }
  return true;
});

// Облако пепла: серые клубы, медленно расползаются и оседают.
registerZonePainter('f6_ashcloud', (g, z, px, py, S) => {
  const zz = z as Zone;
  const t = Math.min(1, zz.t / Math.max(0.01, zz.life));
  const R = zz.r * S * (0.7 + t * 0.5);
  const a = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
  for (let i = 0; i < 4; i++) {
    const aa = hash(i, zz.id) * TAU;
    g.fillStyle = rgba(i % 2 ? ASH.mid : ASH.lt, 0.35 * a);
    g.beginPath();
    g.arc(px + Math.cos(aa) * R * 0.4, py - 3 + Math.sin(aa) * R * 0.3 - t * 3, R * 0.6, 0, TAU);
    g.fill();
  }
  return true;
});

// Всплеск лавы: капли дугами, кольцо.
registerZonePainter('f6_splash', (g, z, px, py, S) => {
  const zz = z as Zone;
  const t = Math.min(1, zz.t / Math.max(0.01, zz.life));
  for (let i = 0; i < 9; i++) {
    const a = hash(i, zz.id) * TAU;
    const d = t * S * (0.6 + hash(i, zz.id, 2) * 0.6);
    const h = Math.sin(t * Math.PI) * 10 * (0.5 + hash(i, zz.id, 4) * 0.5);
    g.fillStyle = rgba(i % 3 ? LAVA.bright : LAVA.white, 1 - t * 0.6);
    g.fillRect(Math.round(px + Math.cos(a) * d), Math.round(py + Math.sin(a) * d * 0.6 - h), 1, 1);
  }
  g.strokeStyle = rgba(LAVA.hot, 1 - t);
  g.lineWidth = 1;
  g.beginPath();
  g.ellipse(px, py, zz.r * S * (0.4 + t), zz.r * S * (0.2 + t * 0.5), 0, 0, TAU);
  g.stroke();
  return true;
});

// Плевок червя: пока летит — место падения; упал — лужа лавы.
registerZonePainter('f6_lavapool', (g, z, px, py, S, time) => {
  const zz = z as Zone;
  const l = lifeOf(zz);
  const R = zz.r * S;
  if (l < 0) {
    const k = zz.t / Math.max(0.01, zz.warn ?? 1);
    g.fillStyle = rgba(FIRE[0], 0.12 + 0.25 * k);
    g.beginPath();
    g.ellipse(px, py, R, R * 0.75, 0, 0, TAU);
    g.fill();
    g.strokeStyle = rgba(FIRE[2], 0.5 + 0.5 * k);
    g.lineWidth = 1;
    g.stroke();
    return true;
  }
  const a = Math.min(1, l * 3);
  g.fillStyle = rgba(LAVA.crust, 0.7 * a);
  g.beginPath();
  g.ellipse(px, py, R, R * 0.72, 0, 0, TAU);
  g.fill();
  g.fillStyle = rgba(LAVA.hot, 0.85 * a);
  g.beginPath();
  g.ellipse(px, py, R * 0.78, R * 0.52, 0, 0, TAU);
  g.fill();
  g.fillStyle = rgba(LAVA.bright, 0.9 * a);
  for (let i = 0; i < 3; i++) {
    const aa = time * 1.5 + i * 2.1 + zz.id;
    g.fillRect(Math.round(px + Math.cos(aa) * R * 0.4), Math.round(py + Math.sin(aa) * R * 0.25), 2, 1);
  }
  return true;
});

// Ряд гейзерного поля: трещина пара от стены до стены, налитая к удару.
registerZonePainter('f6_steam', (g, z, px, py, S, time) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const L = zz.r * S;
  const w = (zz.w ?? 0.42) * S;
  // Полоса ряда пульсирует всё чаще и гуще — видно издалека, куда не вставать.
  const pulse = 0.75 + 0.25 * Math.sin(time * (6 + k * 14));
  g.fillStyle = rgba(FIRE[1], (0.16 + 0.34 * k) * pulse);
  g.fillRect(Math.round(px), Math.round(py - w), Math.round(L), Math.round(w * 2));
  g.fillStyle = rgba(FIRE[2], 0.35 + 0.5 * k);
  g.fillRect(Math.round(px), Math.round(py - w), Math.round(L), 1);
  g.fillRect(Math.round(px), Math.round(py + w) - 1, Math.round(L), 1);
  g.fillStyle = rgba(FIRE[3], 0.5 + 0.5 * k);
  g.fillRect(Math.round(px), Math.round(py), Math.round(L), 1);
  // Пар сочится вдоль трещины.
  g.fillStyle = rgba(hx('#f0ece4'), 0.3 + 0.5 * k);
  for (let i = 0; i < L / 5; i++) {
    const t = (time * 2 + hash(i, zz.id) * 3) % 1;
    g.fillRect(Math.round(px + i * 5 + 2), Math.round(py - 2 - t * 6 * k), 1, 1);
  }
  return true;
});

// Жерло: копит пар (метка), потом бьёт столбом огня и пара вверх.
registerZonePainter('f6_geyser', (g, z, px, py, S, time) => {
  const zz = z as Zone;
  const l = lifeOf(zz);
  const R = zz.r * S;
  if (l < 0) {
    const k = zz.t / Math.max(0.01, zz.warn ?? 1);
    g.fillStyle = rgba(FIRE[1], 0.15 + 0.35 * k);
    g.beginPath();
    g.ellipse(px, py, R * (0.5 + 0.5 * k), R * 0.8 * (0.5 + 0.5 * k), 0, 0, TAU);
    g.fill();
    g.strokeStyle = rgba(FIRE[3], 0.4 + 0.6 * k);
    g.lineWidth = 1;
    g.beginPath();
    g.ellipse(px, py, R, R * 0.8, 0, 0, TAU);
    g.stroke();
    g.fillStyle = rgba(hx('#f0ece4'), 0.5 * k);
    for (let i = 0; i < 3; i++)
      g.fillRect(Math.round(px - 2 + i * 2), Math.round(py - 3 - ((time * 8 + i) % 4) * k * 2), 1, 1);
    return true;
  }
  // Столб: у основания огонь, выше — пар; к концу опадает.
  const H = S * 3.4 * Math.min(1, l * 2.5);
  const a = Math.min(1, l * 2);
  for (let i = 0; i < 20; i++) {
    const k = i / 19;
    const y = py - k * H;
    const r = 3 + k * 6 + Math.sin(time * 20 + i) * 0.8;
    const col = k < 0.3 ? FIRE[2] : k < 0.5 ? FIRE[3] : hx('#e8e4dc');
    g.fillStyle = rgba(col, (k < 0.5 ? 0.9 : 0.6 * (1 - k)) * a);
    g.beginPath();
    g.arc(Math.round(px + Math.sin(k * 6 + time * 8) * 1.5), Math.round(y), r, 0, TAU);
    g.fill();
  }
  return true;
});

// Мост трескается: сетка трещин наливается, снизу проступает жар.
registerZonePainter('f6_crumble', (g, z, px, py, S) => {
  const zz = z as Zone;
  const warn = zz.warn ?? 0.7;
  const k = Math.min(1, zz.t / warn);
  const h = S / 2;
  g.fillStyle = rgba(LAVA.hot, 0.15 + 0.4 * k);
  g.fillRect(Math.round(px - h), Math.round(py - h), S, S);
  g.strokeStyle = rgba(LAVA.bright, 0.5 + 0.5 * k);
  g.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    const a = hash(i, zz.id) * TAU;
    g.beginPath();
    g.moveTo(px, py);
    g.lineTo(px + Math.cos(a) * h * k * 1.2, py + Math.sin(a) * h * k * 1.2);
    g.stroke();
  }
  if (zz.t > warn) {
    // Плита уходит вниз: обломки.
    const t = (zz.t - warn) / Math.max(0.01, zz.life);
    g.fillStyle = rgba(OBSID[2], 1 - t);
    for (let i = 0; i < 5; i++)
      g.fillRect(Math.round(px - h + hash(i, zz.id, 5) * S), Math.round(py - h + hash(i, zz.id, 6) * S + t * 6), 2, 2);
  }
  return true;
});

// Лава поднимается: по клетке бегут трещины, из них сочится жар.
export function riseMark(g: CanvasRenderingContext2D, zz: Zone, px: number, py: number, S: number, time: number, big: boolean) {
  const warn = zz.warn ?? 1.4;
  const k = Math.min(1, zz.t / warn);
  const h = S / 2;
  const pulse = 0.5 + 0.5 * Math.sin(time * (8 + k * 12));
  // Клетка налита целиком: кольцо, куда придёт лава, читается сплошной
  // полосой, а не россыпью значков.
  g.fillStyle = rgba(big ? hx('#b81a10') : hx('#a8300c'), (0.28 + 0.42 * k) * (0.75 + 0.25 * pulse));
  g.fillRect(Math.round(px - h), Math.round(py - h), S, S);
  // Ближе к удару — жар ровнее и ярче; клетки кольца сливаются в полосу.
  g.fillStyle = rgba(LAVA.hot, (0.06 + 0.3 * k * k) * pulse);
  g.fillRect(Math.round(px - h), Math.round(py - h), S, S);
  // Сквозь пол сочится жар: пузырьки вспухают и лопаются, чаще к концу.
  const n = big ? 4 : 3;
  for (let i = 0; i < n; i++) {
    const ph = (time * (1.2 + k * 2.5) + hash(i, zz.id, 7)) % 1;
    const bx = px - h + 3 + hash(i, zz.id, Math.floor(time * (1.2 + k * 2.5) + hash(i, zz.id, 7))) * (S - 6);
    const by = py - h + 3 + hash(i, zz.id, 9 + Math.floor(time * (1.2 + k * 2.5) + hash(i, zz.id, 7))) * (S - 6);
    const r = ph < 0.8 ? 1 + ph * 2 : 1;
    g.fillStyle = rgba(ph < 0.8 ? LAVA.bright : LAVA.white, (0.5 + 0.5 * k) * (ph < 0.8 ? 1 : 1 - (ph - 0.8) * 5));
    g.fillRect(Math.round(bx - r / 2), Math.round(by - r / 2), Math.max(1, Math.round(r)), Math.max(1, Math.round(r)));
  }
}

registerZonePainter('f6_rise', (g, z, px, py, S, time) => {
  riseMark(g, z as Zone, px, py, S, time, false);
  return true;
});

// Петарда беса: красная палочка с горящим фитилём.
registerZonePainter('f6_cracker', (g, z, px, py, S, time) => {
  const k = kOf(z as ZoneX);
  const R = z.r * S;
  g.strokeStyle = rgba(FIRE[2], 0.35 + 0.6 * k);
  g.lineWidth = 1;
  g.beginPath();
  g.ellipse(px, py, R, R * 0.8, 0, 0, TAU);
  g.stroke();
  g.fillStyle = rgba(hx('#c8201a'), 1);
  g.fillRect(Math.round(px) - 1, Math.round(py) - 4, 3, 5);
  g.fillStyle = rgba(hx('#f0e0a0'), 1);
  g.fillRect(Math.round(px) - 1, Math.round(py) - 4, 3, 1);
  if (Math.floor(time * 16) % 2) {
    g.fillStyle = rgba(FIRE[3], 1);
    g.fillRect(Math.round(px) + 1, Math.round(py) - 6 + Math.round(k * 2), 1, 1);
  }
  return true;
});

// Мозаика под логовом: змей свернулся кольцом, красное на чёрном, золото.
let emblemImg: HTMLCanvasElement | null = null;
registerZonePainter('f6_emblem', (g, _z, px, py) => {
  if (!emblemImg) {
    const W = 72;
    const H = 52;
    const p = new Px(W, H);
    const cx = W / 2;
    const cy = H / 2;
    const red = hx('#6a1410', 220);
    const redLt = hx('#9a2418', 220);
    const gold = hx('#a8823a', 230);
    const goldLt = hx('#dcb862', 230);
    const dk = hx('#140a0a', 200);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const dx = (x + 0.5 - cx) / 34;
        const dy = (y + 0.5 - cy) / 24;
        const d = Math.hypot(dx, dy);
        if (d > 1) continue;
        const c = d > 0.94 ? dk : d > 0.88 ? ((x + y) % 3 ? gold : goldLt) : d > 0.84 ? dk : null;
        if (c) p.set(x, y, c);
      }
    // Змей кольцом: тело по спирали, голова к центру.
    for (let i = 0; i < 90; i++) {
      const k = i / 89;
      const a = k * TAU * 1.15 + 0.4;
      const r = 0.72 - k * 0.42;
      const x = cx + Math.cos(a) * r * 34;
      const y = cy + Math.sin(a) * r * 24;
      const w = 3.2 - k * 1.6;
      p.ell(x, y, w, w * 0.8, (i >> 2) % 2 ? red : redLt);
      if (i % 6 === 0) p.set(Math.round(x), Math.round(y), goldLt);
    }
    // Голова в середине: клин и глаз.
    const hxp = cx + 3;
    const hyp = cy - 1;
    p.ell(hxp, hyp, 5, 3.4, redLt);
    p.ell(hxp + 4, hyp + 0.5, 3, 2, red);
    p.set(Math.round(hxp + 1), Math.round(hyp - 1), goldLt);
    p.set(Math.round(hxp + 2), Math.round(hyp - 1), goldLt);
    emblemImg = p.canvas();
  }
  g.drawImage(emblemImg, Math.round(px - 36), Math.round(py - 26));
  return true;
});

// ---------------------------------------------------------------------------
// Снаряд: плевок лавы — ком с коркой, внутри горит, за ним капли.
// ---------------------------------------------------------------------------

registerShotPainter('f6_glob', (_s: Shot, time) => {
  const f = Math.floor(time * 12) % 4;
  return spriteOf(`glob|${f}`, () => {
    const p = new Px(12, 12);
    p.ell(6, 6, 4, 3.6, LAVA.crust);
    p.ell(6 + (f % 2 ? 0.5 : -0.5), 5.6, 2.8, 2.4, LAVA.hot);
    p.ell(5.4, 5, 1.2, 1, LAVA.white);
    p.outline(INK);
    p.set(2 + f, 10, LAVA.bright);
    return { img: p.canvas(), ax: 6, ay: 6 };
  });
});

// ---------------------------------------------------------------------------
// Иконки вещей 10×10.
// ---------------------------------------------------------------------------

function meatIcon(meat: Tones, bone: boolean, char = false): Px {
  const p = new Px(10, 10);
  shadeEll(p, 4.5, 5.5, 3.6, 3, meat);
  if (bone) {
    limb(p, 6.5, 3.5, 8.5, 1.5, 0.8, 0.8, BONE);
    p.set(9, 1, BONE[3]);
    p.set(8, 0, BONE[3]);
  }
  if (char) {
    p.set(3, 4, hx('#2a1008'));
    p.set(5, 6, hx('#2a1008'));
  }
  p.outline(INK);
  return p;
}

registerItemArt('f6mat', () => {
  // Обсидиан: скол чёрного стекла с фиолетовым бликом.
  const p = new Px(10, 10);
  poly(
    p,
    [
      [1, 8],
      [3, 2],
      [7, 1],
      [9, 5],
      [6, 9],
    ],
    (x, y) => tone(OBSID, 0.9 - (x + y) * 0.07),
  );
  p.outline(INK);
  stroke(p, 3, 3, 6, 2, OBSID[3]);
  return p;
});
registerItemArt('f6_scale', () => {
  // Чешуйка саламандры: щиток с килем, светлый край сверху, тлеющий кант.
  const p = new Px(10, 10);
  poly(
    p,
    [
      [5, 0.5],
      [9.4, 3.5],
      [8.4, 7.5],
      [5, 9.6],
      [1.6, 7.5],
      [0.6, 3.5],
    ],
    (x, y) => tone(SAL.skin, 0.95 - y * 0.08 - Math.abs(x - 5) * 0.05),
  );
  for (let y = 2; y < 9; y++) p.set(5, y, SAL.skin[0]);
  p.set(4, 2, SAL.skin[3]);
  p.set(3, 3, SAL.skin[3]);
  p.outline(INK);
  p.set(5, 9, SAL.spot);
  p.set(4, 8, SAL.spot);
  return p;
});
registerItemArt('f6_cinder', () => {
  const p = new Px(10, 10);
  flame(p, 5, 8, 7, 1, 2.6);
  p.outline(hx('#2a0c06'));
  return p;
});
registerItemArt('f6_core', () => {
  // Сердцевина голема: чёрная корка, сквозь трещины — жидкий свет.
  const p = new Px(10, 10);
  shadeEll(p, 5, 5, 4.2, 4.2, [hx('#140a0a'), hx('#2a1612'), hx('#4a2a22'), hx('#6a3e30')]);
  const cracks: [number, number][][] = [
    [
      [5, 5],
      [3, 3],
      [2, 2],
    ],
    [
      [5, 5],
      [7, 4],
      [8, 2],
    ],
    [
      [5, 5],
      [5, 7],
      [6, 9],
    ],
  ];
  for (const c of cracks) for (const [x, y] of c) p.set(x, y, LAVA.hot);
  p.set(5, 5, LAVA.white);
  p.set(4, 5, LAVA.bright);
  p.set(5, 4, LAVA.bright);
  p.outline(INK);
  return p;
});
registerItemArt('f6_ash', () => {
  // Пепельное перо: стержень наискосок, опахало по обе стороны, кончик тлеет.
  const p = new Px(10, 10);
  const ash: Tones = [hx('#4a4440'), hx('#7a726a'), hx('#a8a098'), hx('#d0c8bc')];
  for (let i = 0; i <= 7; i++) {
    const x = 2 + i * 0.85;
    const y = 8.5 - i;
    const w = i < 1 ? 0 : i > 6 ? 0.8 : 1.6;
    for (let k = -w; k <= w; k += 0.5) {
      const px = Math.round(x + k * 0.7);
      const py = Math.round(y + k * 0.7);
      p.set(px, py, tone(ash, 0.75 - Math.abs(k) * 0.2 - (k > 0 ? 0.2 : 0)));
    }
  }
  p.outline(INK);
  for (let i = 0; i <= 7; i++) p.set(Math.round(2 + i * 0.85), Math.round(8.5 - i), ash[3]);
  p.set(8, 1, FIRE[2]);
  p.set(9, 0, FIRE[1]);
  return p;
});
registerItemArt('f6_fang', () => {
  const p = new Px(10, 10);
  const line = spline(
    [
      [2, 1],
      [4, 4],
      [6, 7],
      [8.5, 9],
    ],
    4,
  );
  line.forEach(([x, y], i) => {
    const k = i / (line.length - 1);
    shadeEll(p, x, y, 1.9 - k * 1.4, 1.9 - k * 1.4, BONE);
  });
  p.outline(INK);
  p.set(2, 1, hx('#8a1a10'));
  p.set(3, 1, hx('#c8341c'));
  return p;
});
registerItemArt('f6_tail', () => {
  // Хвост саламандры на кости, запечён.
  const p = meatIcon(SAL.skin, true, true);
  p.set(3, 6, SAL.belly[2]);
  return p;
});
registerItemArt('f6_bug', () => {
  const p = new Px(10, 10);
  shadeEll(p, 5, 5.5, 3.6, 2.8, [hx('#1a100c'), hx('#3a2418'), hx('#6a4226'), hx('#9a6a3a')]);
  for (let i = 0; i < 3; i++) {
    p.set(2 + i * 3, 9, hx('#2a1a10'));
  }
  p.outline(INK);
  p.set(4, 4, FIRE[2]);
  return p;
});
registerItemArt('f6_dragon', () =>
  meatIcon([hx('#6a1410'), hx('#b8301c'), hx('#e8683a'), hx('#ffb07a')], true, true),
);
