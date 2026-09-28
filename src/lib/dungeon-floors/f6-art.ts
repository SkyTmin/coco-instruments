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
  registerCellPainter,
  registerItemArt,
  registerMobPainter,
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
const alpha = (c: RGBA, a: number): RGBA => [c[0], c[1], c[2], Math.round(a * 255)];
const rgba = (c: RGBA, a: number) =>
  `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a)).toFixed(3)})`;

const INK = hx('#150f0b');
const WHITE = hx('#ffffff');
const GOLD = hx('#ffcc40');
const TAU = Math.PI * 2;

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
const hash = (a: number, b: number, c = 0) => {
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
const FIRE: Tones = [hx('#a8260c'), hx('#ff6a1a'), hx('#ffb030'), hx('#fff2a0')];
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
const BASALT: Tones = [hx('#1c1618'), hx('#2e2628'), hx('#4a3e3e'), hx('#6e5e5a')];
const OBSID: Tones = [hx('#0e0a12'), hx('#1e1826'), hx('#3a3050'), hx('#8a7cb8')];
const ASH = { dk: hx('#3a3432'), mid: hx('#4e4744'), lt: hx('#6a625c'), hi: hx('#8a8078') };
const BONE: Tones = [hx('#6a5e50'), hx('#a8987e'), hx('#d4c8ae'), hx('#f2ead4')];

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
// Красный змей. Кадр — грудь, шея, голова с рогами, крылья и передние лапы;
// остальное тело — змеиное, лежит на полу по пути головы (зона `f6_body`
// ниже): так змей изгибается как угодно, а кадры остаются в кеше.
// На земле кадр 76×64 (земля — 60), в небе — 84×92 (земля — 88).
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
};

type WingLook = 'fold' | 'half' | 'spread' | 'droop';

interface SerpPose {
  /** Подъём над землёй (полёт), px. */
  lift: number;
  cx: number;
  cy: number;
  /** Голова: центр черепа, направление морды (0 — вправо, + — вниз). */
  hx: number;
  hy: number;
  ha: number;
  jaw: number;
  wing: WingLook;
  /** Взмах: −1 — крылья вниз, 1 — вверх. */
  flap: number;
  /** Жар в горле 0…1. */
  glow: number;
  closed: boolean;
  stars: number;
  step: number;
  /** Хвост в кадре (в небе). */
  tail: boolean;
  smoke: number;
  /** Пламя изо рта (кадр). */
  fire: number;
}

function serpPose(anim: string, f: number, air: boolean): SerpPose {
  const G = air ? 88 : 60;
  const b: SerpPose = {
    lift: 0,
    cx: 34,
    cy: G - 12,
    hx: 51,
    hy: G - 30,
    ha: 0.25,
    jaw: 0,
    wing: 'fold',
    flap: 0,
    glow: 0,
    closed: false,
    stars: -1,
    step: 0,
    tail: false,
    smoke: -1,
    fire: -1,
  };
  switch (anim) {
    case 'idle':
      b.cy += f % 2 ? 0.5 : 0;
      b.hy += f === 1 || f === 2 ? -0.8 : 0;
      b.smoke = f;
      break;
    case 'run': {
      const s = Math.sin((f / 6) * TAU);
      b.step = (f / 6) * TAU;
      b.hy += s * 1.2;
      b.hx += 1 + Math.cos((f / 6) * TAU) * 0.8;
      b.cy += Math.abs(s) * 0.5;
      break;
    }
    case 'bitewind':
      b.hx = 44;
      b.hy = G - 36;
      b.ha = 0.05;
      b.glow = 0.3;
      b.cy += 1;
      break;
    case 'bite':
      b.hx = 60;
      b.hy = G - 22;
      b.ha = 0.35;
      b.jaw = f ? 0.6 : 1;
      break;
    case 'tail':
      // Голова вполоборота назад, тело прижато.
      b.hx = 40;
      b.hy = G - 26;
      b.ha = Math.PI - 0.5;
      b.cy += 1.5;
      b.wing = 'half';
      break;
    case 'rear':
      // Встаёт на дыбы, горло наливается жаром.
      b.cy -= 2 + f * 2;
      b.hx = 48 - f;
      b.hy = G - 40 - f * 3;
      b.ha = -0.35;
      b.jaw = 0.25 + f * 0.1;
      b.glow = 0.35 + f * 0.3;
      b.wing = f >= 1 ? 'half' : 'fold';
      break;
    case 'breathe':
      b.cy -= 3;
      b.hx = 56;
      b.hy = G - 32;
      b.ha = 0.35;
      b.jaw = 1;
      b.glow = 1;
      b.wing = 'half';
      b.fire = f;
      break;
    case 'roar':
      b.hx = 48;
      b.hy = G - 40;
      b.ha = -0.9;
      b.jaw = f ? 1 : 0.8;
      b.wing = 'half';
      b.glow = 0.4;
      break;
    case 'dizzy':
      // Головой в камень, крылья обвисли.
      b.cy += 2;
      b.hx = 55;
      b.hy = G - 6;
      b.ha = 0.7;
      b.wing = 'droop';
      b.closed = true;
      b.stars = f;
      break;
    case 'hurt':
      b.hx -= 3;
      b.hy -= 2;
      b.ha = -0.1;
      b.closed = true;
      b.jaw = 0.4;
      break;
    case 'takeoff':
      b.lift = f * 5;
      b.cy -= b.lift;
      b.hy -= b.lift + f;
      b.wing = f >= 2 ? 'spread' : 'half';
      b.flap = f % 2 ? 1 : -0.3;
      break;
    case 'fly':
    case 'hover':
    case 'dive': {
      b.lift = 26;
      b.cy = G - 12 - b.lift;
      b.hx = 52;
      b.hy = b.cy - 16;
      b.ha = 0.2;
      b.wing = 'spread';
      b.tail = true;
      b.flap = [1, 0.3, -1, -0.2][f % 4];
      if (anim === 'hover') {
        // Высматривает: морда вниз, к кругу на полу.
        b.hx = 50;
        b.hy = b.cy - 8;
        b.ha = 1.2;
      }
      if (anim === 'dive') {
        b.wing = 'fold';
        b.lift = 12 - f * 6;
        b.cy = G - 12 - b.lift;
        b.hx = 54;
        b.hy = b.cy + 2;
        b.ha = 1.1;
        b.jaw = 0.6;
      }
      break;
    }
    case 'dead':
      b.cy += 4;
      b.hx = 56;
      b.hy = G - 5;
      b.ha = 0.2;
      b.wing = 'droop';
      b.closed = true;
      b.jaw = 0.3;
      break;
  }
  return b;
}

/** Крыло: плечо S, запястье, три пальца и перепонка между ними. */
function wing(p: Px, sx: number, sy: number, look: WingLook, flap: number, far: boolean): void {
  const bone = far ? SRP.far : SRP.scale;
  const mem = far ? SRP.wingFar : SRP.wing;
  let wx: number;
  let wy: number;
  let tips: [number, number][];
  let att: [number, number];
  switch (look) {
    case 'spread': {
      wx = sx - 13;
      wy = sy - 12 + (1 - flap) * 6;
      const up = flap * 6;
      tips = [
        [wx - 14, wy - 4 - up * 0.6],
        [wx - 15, wy + 6 - up * 0.3],
        [wx - 8, wy + 14],
      ];
      att = [sx - 12, sy + 4];
      break;
    }
    case 'half':
      wx = sx - 8;
      wy = sy - 13;
      tips = [
        [wx - 9, wy - 3],
        [wx - 11, wy + 5],
        [wx - 6, wy + 12],
      ];
      att = [sx - 11, sy + 4];
      break;
    case 'droop':
      wx = sx - 9;
      wy = sy - 4;
      tips = [
        [wx - 8, wy + 6],
        [wx - 5, wy + 11],
        [wx - 1, wy + 12],
      ];
      att = [sx - 9, sy + 6];
      break;
    default:
      wx = sx - 6;
      wy = sy - 9;
      tips = [
        [wx - 7, wy + 3],
        [wx - 8, wy + 8],
        [wx - 4, wy + 12],
      ];
      att = [sx - 8, sy + 3];
  }
  // Перепонка: веер от запястья, светлее к краю (просвечивает).
  const fan: [number, number][] = [[sx, sy], [wx, wy], ...tips, att];
  poly(p, fan, (x, y) => {
    const d = Math.hypot(x - wx, y - wy) / 16;
    return tone(mem, 0.15 + d * 0.5 - (y - wy) * 0.01);
  });
  // Кромка перепонки фестонами: вырезы между пальцами.
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
  // Коготь на запястье.
  p.set(Math.round(wx), Math.round(wy) - 2, SRP.horn[2]);
  p.set(Math.round(wx) + 1, Math.round(wy) - 1, SRP.horn[1]);
}

function paintSerp(sp: SerpPose, anim: string, air: boolean): Built {
  const W = air ? 84 : 76;
  const H = air ? 92 : 64;
  const G = air ? 88 : 60;
  const p = new Px(W, H);
  const { cx, cy } = sp;
  // Дальнее крыло — за телом.
  wing(p, cx + 5, cy - 7, sp.wing, sp.flap, true);
  // Хвост в кадре (в небе): свисает и закручивается.
  if (sp.tail) {
    const pts = spline(
      [
        [cx - 6, cy + 4],
        [cx - 16, cy + 10],
        [cx - 26, cy + 8],
        [cx - 32, cy + 1],
        [cx - 28, cy - 4],
      ],
      4,
    );
    for (let i = 0; i < pts.length - 1; i++) {
      const k = i / (pts.length - 1);
      const r = 5.5 * (1 - k) + 1;
      shadeEll(p, pts[i][0], pts[i][1], r, r * 0.85, SRP.scale);
      if (i % 3 === 1) p.set(Math.round(pts[i][0]), Math.round(pts[i][1] + r * 0.7), SRP.belly[2]);
    }
  }
  // Дальняя лапа.
  const leg = (x: number, far: boolean, ph: number) => {
    const s = Math.sin(sp.step + ph);
    const lift = sp.lift > 0 ? 3 : 0;
    const fx = cx + x + s * 1.6 + (lift ? 2 : 0);
    const fy = sp.lift > 0 ? cy + 9 : G - 1 - (s > 0.5 ? 1 : 0);
    const t = far ? SRP.far : SRP.scale;
    limb(p, cx + x - 1, cy + 3, fx, fy - 2, 2.4, 1.8, t);
    // Когти.
    for (let k = 0; k < 3; k++) p.set(Math.round(fx - 1 + k * 1.5), Math.round(fy), SRP.horn[far ? 1 : 2]);
  };
  leg(6, true, Math.PI);
  // Грудь: чешуя, брюшные щитки полосами.
  shadeEll(p, cx, cy, 11, 9, SRP.scale);
  for (let i = 0; i < 5; i++) {
    const y = cy + 1 + i * 1.8;
    const w = 7.5 - Math.abs(i - 1.5) * 1.1;
    for (let x = Math.round(cx + 2 - w); x <= Math.round(cx + 2 + w); x++) {
      if (!p.solid(x, Math.round(y))) continue;
      p.set(x, Math.round(y), tone(SRP.belly, 0.7 - i * 0.12));
      if (i < 4) p.set(x, Math.round(y) + 1, tone(SRP.belly, 0.3 - i * 0.08));
    }
  }
  // Шея: от груди к голове, сужается; брюхо шеи — светлое.
  const neck = spline(
    [
      [cx + 5, cy - 5],
      [cx + 9 + (sp.hx - cx - 17) * 0.3, cy - 12 + (sp.hy - cy + 18) * 0.35],
      [sp.hx - Math.cos(sp.ha) * 4, sp.hy - Math.sin(sp.ha) * 3 + 2],
    ],
    6,
  );
  neck.forEach(([x, y], i) => {
    const k = i / (neck.length - 1);
    const r = 5.6 - k * 2;
    shadeEll(p, x, y, r, r * 0.95, SRP.scale);
  });
  neck.forEach(([x, y], i) => {
    const k = i / (neck.length - 1);
    const r = 5.6 - k * 2;
    if (i % 2) p.set(Math.round(x + r * 0.55), Math.round(y + r * 0.5), SRP.belly[2]);
  });
  // Спинные шипы по шее и груди.
  neck.forEach(([x, y], i) => {
    if (i % 3 !== 1) return;
    const k = i / (neck.length - 1);
    const r = 5.6 - k * 2;
    const bx = x - r * 0.45;
    const by = y - r * 0.85;
    poly(
      p,
      [
        [bx - 1.4, by + 1],
        [bx - 2.8, by - 2.6],
        [bx + 1.2, by + 0.4],
      ],
      SRP.horn[1],
    );
  });
  // Голова: череп, морда, челюсть, рога.
  const ca = Math.cos(sp.ha);
  const sa = Math.sin(sp.ha);
  const snx = sp.hx + ca * 5.2;
  const sny = sp.hy + sa * 5.2;
  // Рога — назад и вверх, два.
  for (const [off, len] of [
    [-1.2, 9],
    [1.6, 7],
  ] as [number, number][]) {
    const bx = sp.hx - ca * 1.5 + off * sa * 0.3;
    const by = sp.hy - 2.4 + off * 0.4;
    const pts = spline(
      [
        [bx, by],
        [bx - ca * len * 0.5, by - 3.2],
        [bx - ca * len, by - 4 + (len > 8 ? -2 : 0)],
      ],
      4,
    );
    pts.forEach(([x, y], i) => {
      const r = 1.5 - (i / pts.length) * 1.1;
      shadeEll(p, x, y, r + 0.2, r + 0.2, SRP.horn);
    });
  }
  shadeEll(p, sp.hx, sp.hy, 5, 4, SRP.scale);
  // Челюсть: ниже морды, опускается.
  const jx = snx - ca * 0.6 + -sa * (1.8 + sp.jaw * 2.8);
  const jy = sny + ca * (1.8 + sp.jaw * 2.8) - sa * 0.6;
  if (sp.jaw > 0.05) {
    // Пасть между челюстями: тёмная, в глубине жар.
    poly(
      p,
      [
        [sp.hx + ca * 1.5, sp.hy + 1.2],
        [snx + ca * 3, sny + sa * 3],
        [jx + ca * 2.6, jy + sa * 2.6],
      ],
      SRP.mouth,
    );
  }
  shadeEll(p, jx, jy, 3.6, 1.6, SRP.belly, -0.1);
  shadeEll(p, snx, sny, 4.2, 2.6, SRP.scale);
  // Надбровье.
  shadeEll(p, sp.hx + ca * 1.2, sp.hy - 2.2, 2.6, 1.3, SRP.scale, 0.2);
  // Передняя лапа — поверх груди.
  leg(9, false, 0);
  // Ближнее крыло — вдоль спины.
  wing(p, cx - 1, cy - 6, sp.wing, sp.flap, false);
  p.outline(INK);
  // После контура: зубы, жар в пасти и горле, глаз, ноздри.
  if (sp.jaw > 0.05) {
    for (let k = 0; k < 3; k++) {
      p.set(Math.round(snx + ca * (k * 1.4 - 1)), Math.round(sny + 2 + k * sa * 1.4), SRP.horn[3]);
      p.set(Math.round(jx + ca * (k * 1.3 - 0.5)), Math.round(jy - 1.4), SRP.horn[3]);
    }
    const mx = Math.round((snx + jx) / 2 + ca * 0.6);
    const my = Math.round((sny + jy) / 2 + sa * 0.6);
    p.set(mx, my, sp.glow > 0.5 ? LAVA.white : LAVA.hot);
    p.set(mx - 1, my, LAVA.bright);
  }
  if (sp.glow > 0) {
    // Горло светится сквозь щитки — жар идёт наверх.
    const n = Math.round(3 + sp.glow * 8);
    for (let i = 0; i < n; i++) {
      const k = i / Math.max(1, n - 1);
      const idx = Math.round(k * (neck.length - 1) * 0.9);
      const [x, y] = neck[idx];
      const r = 5.6 - (idx / (neck.length - 1)) * 2;
      const c = sp.glow > 0.7 ? LAVA.white : sp.glow > 0.4 ? LAVA.bright : LAVA.hot;
      p.set(Math.round(x + r * 0.55), Math.round(y + r * 0.45), c);
    }
    p.set(Math.round(cx + 4), Math.round(cy + 1), LAVA.bright);
  }
  const ex = Math.round(sp.hx + ca * 1.4 - sa * 0.4);
  const ey = Math.round(sp.hy - 1.3);
  if (sp.closed) {
    p.set(ex, ey, INK);
    p.set(ex + 1, ey, INK);
  } else {
    p.set(ex, ey, SRP.eye);
    p.set(ex + 1, ey, WHITE);
    p.set(ex, ey + 1, hx('#ff8a20'));
  }
  // Ноздри и дымок.
  p.set(Math.round(snx + ca * 3.4), Math.round(sny - 1), INK);
  if (sp.smoke >= 0) {
    const k = sp.smoke % 4;
    for (let i = 0; i <= k; i++)
      p.set(Math.round(snx + ca * 4 + i * 0.6), Math.round(sny - 2 - i * 1.6), alpha(hx('#b8aca0'), 0.8 - i * 0.18));
  }
  if (sp.fire >= 0) {
    // Язык пламени из пасти (сама струя — зоной на полу).
    for (let i = 0; i < 7; i++) {
      const d = 4 + i * 1.6;
      const x = Math.round(snx + ca * d + (hash(i, sp.fire) - 0.5) * 2);
      const y = Math.round(sny + 1 + sa * d + (hash(i, sp.fire, 3) - 0.5) * 2);
      const c = i < 2 ? LAVA.white : i < 4 ? FIRE[2] : FIRE[1];
      p.ell(x, y, 1 + i * 0.25, 1 + i * 0.2, c);
    }
  }
  if (sp.stars >= 0) stars(p, sp.hx, sp.hy - 7, 5, sp.stars);
  return { p, ax: cx, ay: G + 1, eye: sp.closed ? null : [ex, ey] };
}

registerMobPainter('f6boss', (m: Mob, pose: MobPose) => {
  const mode = pose.mode;
  const t = pose.t;
  const haste = m.data?.haste ?? 1;
  let anim = 'idle';
  let f = ((pose.frame % 4) + 4) % 4;
  switch (mode) {
    case 'roar':
    case 'f6_summon':
      anim = 'roar';
      f = Math.floor(t * 8) % 2;
      break;
    case 'f6_bite': {
      const T = 0.6 / haste;
      anim = t < T ? 'bitewind' : 'bite';
      f = t < T + 0.1 ? 0 : 1;
      break;
    }
    case 'f6_tail':
      anim = 'tail';
      f = 0;
      break;
    case 'f6_wave':
    case 'f6_sweep': {
      const T = (mode === 'f6_wave' ? 1.05 : 1) / haste;
      if (t < T) {
        anim = 'rear';
        f = Math.min(2, Math.floor((t / T) * 3));
      } else {
        anim = 'breathe';
        f = Math.floor(t * 14) % 2;
      }
      break;
    }
    case 'f6_takeoff':
      anim = 'takeoff';
      f = Math.min(3, Math.floor((t / 0.9) * 4));
      break;
    case 'f6_fly':
      anim = 'fly';
      f = Math.floor(t * 10) % 4;
      break;
    case 'f6_mark':
      anim = 'hover';
      f = Math.floor(t * 12) % 4;
      break;
    case 'f6_dive':
      anim = 'dive';
      f = Math.min(1, Math.floor(t * 12));
      break;
    case 'dizzy':
      anim = 'dizzy';
      f = Math.floor(t * 6) % 4;
      break;
    default:
      if (pose.anim === 'dead') anim = 'dead';
      else if (pose.anim === 'hurt') anim = 'hurt';
      else if (pose.anim === 'run') {
        anim = 'run';
        f = ((pose.frame % 6) + 6) % 6;
      } else f = ((Math.floor(t * 3) % 4) + 4) % 4;
  }
  const air = anim === 'fly' || anim === 'hover' || anim === 'dive';
  return frameOf('f6boss', pose, anim, f, () => paintSerp(serpPose(anim, f, air), anim, air));
});

// Тело змея на полу: по пути головы, от хвоста к груди. Кольца — готовые
// спрайты по радиусу (кеш), шипы через одно, брюхо светлее снизу.
const segCache = new Map<string, HTMLCanvasElement>();

function segSprite(r: number, spike: boolean, tip: boolean): HTMLCanvasElement {
  const key = `${r}|${spike ? 1 : 0}|${tip ? 1 : 0}`;
  let c = segCache.get(key);
  if (c) return c;
  const S = r * 2 + 8;
  const p = new Px(S, S);
  const o = S / 2;
  shadeEll(p, o, o, r, r * 0.86, SRP.scale);
  // Брюхо видно снизу: полоса щитков.
  for (let x = Math.round(o - r * 0.7); x <= Math.round(o + r * 0.7); x++) {
    const y = Math.round(o + r * 0.62);
    if (p.solid(x, y)) p.set(x, y, SRP.belly[2]);
    if (p.solid(x, y + 1)) p.set(x, y + 1, SRP.belly[1]);
  }
  if (spike)
    poly(
      p,
      [
        [o - 1.6, o - r * 0.7],
        [o - 0.4, o - r * 0.8 - Math.max(2, r * 0.45)],
        [o + 1.4, o - r * 0.7],
      ],
      SRP.horn[1],
    );
  if (tip) {
    // Кончик хвоста — наконечник-лопасть.
    poly(
      p,
      [
        [o - 3, o],
        [o, o - 3],
        [o + 3, o],
        [o, o + 2],
      ],
      SRP.scale[2],
    );
  }
  p.outline(INK);
  c = p.canvas();
  segCache.set(key, c);
  return c;
}

/** Точка на пути головы на расстоянии `s` клеток по дуге. */
function along(tr: readonly number[], s: number): [number, number] | null {
  let acc = 0;
  for (let i = 0; i + 3 < tr.length; i += 2) {
    const d = Math.hypot(tr[i + 2] - tr[i], tr[i + 3] - tr[i + 1]);
    if (acc + d >= s) {
      const k = d > 0 ? (s - acc) / d : 0;
      return [tr[i] + (tr[i + 2] - tr[i]) * k, tr[i + 1] + (tr[i + 3] - tr[i + 1]) * k];
    }
    acc += d;
  }
  return null;
}

registerZonePainter('f6_body', (g, z, px, py, S, time) => {
  const v = serpentView((z as Zone & { mob?: number }).mob ?? -1);
  if (!v) return true;
  const air = v.mode === 'f6_fly' || v.mode === 'f6_mark' || v.mode === 'f6_dive';
  if (air || v.mode === 'f6_takeoff') return true;
  const fade = v.mode === 'dying' ? Math.max(0, 1 - Math.max(0, v.t - 0.35) / 0.35) : 1;
  if (fade <= 0) return true;
  const N = 26;
  const pts: [number, number, number][] = [];
  if (v.mode === 'f6_tail') {
    // Хвост хлещет кругом: тело кольцом вокруг змея, кольцо вращается.
    const a0 = v.t * 9;
    for (let i = 0; i < N; i++) {
      const k = i / (N - 1);
      const a = a0 + k * TAU * 0.95;
      const R = 0.9 + k * 1.3;
      pts.push([v.x + Math.cos(a) * R, v.y + Math.sin(a) * R * 0.8, k]);
    }
  } else {
    const raw: [number, number, number][] = [];
    for (let i = 0; i < N; i++) {
      const k = i / (N - 1);
      const q = along(v.trail, 0.5 + k * 4.6);
      if (!q) break;
      raw.push([q[0], q[1], k]);
    }
    // Ползёт волной: смещение ПОПЕРЁК пути, бежит от головы к хвосту и к
    // хвосту растёт. Без него прямой путь давал прямое тело — «шест».
    const crawl = v.mode === 'chase' || v.mode === 'recover' || v.mode === 'roar';
    for (let i = 0; i < raw.length; i++) {
      const [x, y, k] = raw[i];
      const a = raw[Math.max(0, i - 1)];
      const b = raw[Math.min(raw.length - 1, i + 1)];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const l = Math.hypot(dx, dy) || 1;
      const amp = (crawl ? 0.34 : 0.16) * (0.25 + k * 0.75);
      const w = Math.sin(time * (crawl ? 5 : 2) - k * 8.5) * amp;
      pts.push([x - (dy / l) * w, y + (dx / l) * w, k]);
    }
  }
  g.globalAlpha = fade;
  // Тень под телом.
  g.fillStyle = 'rgba(0,0,0,0.28)';
  for (const [x, y, k] of pts) {
    const r = (7 - k * 5) * 1.1;
    g.beginPath();
    g.ellipse(px + (x - z.x) * S, py + (y - z.y) * S + r * 0.7, r, r * 0.35, 0, 0, TAU);
    g.fill();
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    const [x, y, k] = pts[i];
    const r = Math.max(2, Math.round(7 - k * 5));
    const img = segSprite(r, i % 3 === 1 && k < 0.85, i === pts.length - 1 && k > 0.9);
    g.drawImage(
      img,
      Math.round(px + (x - z.x) * S - img.width / 2),
      Math.round(py + (y - z.y) * S - img.height / 2 - r * 0.6),
    );
  }
  g.globalAlpha = 1;
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

type ZoneX = (Zone | Strike) & {
  ang?: number;
  len?: number;
  arc?: number;
  sweep?: number;
  band?: number;
  w?: number;
};

/** Насколько налилась метка удара (0…1); у лужи — 1. */
const kOf = (z: ZoneX) => {
  const s = z as Strike;
  if ('warn' in s && typeof s.warn === 'number' && s.warn > 0) return Math.min(1, s.t / s.warn);
  return 1;
};

/** Жизнь лужи после предупреждения: 0…1 (1 — только загорелась). */
const lifeOf = (z: Zone) => {
  const warn = z.warn ?? 0;
  if (z.t < warn) return -1;
  return 1 - (z.t - warn) / Math.max(0.01, z.life);
};

function cone(
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
function tongues(
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

// Волна пламени: полоса через арену. Пока метка — по полу бежит огненная
// жилка (ярче к удару); когда ударила — стена огня (зона `f6_waveflame`).
registerZonePainter('f6_wave', (g, z, px, py, S, time) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const a = zz.ang ?? 0;
  const L = zz.r * S;
  const w = (zz.w ?? 0.6) * S;
  g.save();
  g.translate(px, py);
  g.rotate(a);
  g.fillStyle = rgba(FIRE[0], 0.12 + 0.28 * k);
  g.fillRect(0, -w, L, w * 2);
  // Кромки полосы — чёткие: видно, где просвет.
  g.fillStyle = rgba(FIRE[2], 0.35 + 0.55 * k);
  g.fillRect(0, -w, L, 1);
  g.fillRect(0, w - 1, L, 1);
  // Жилка по оси: бежит к удару.
  g.fillStyle = rgba(FIRE[3], 0.3 + 0.6 * k);
  const n = Math.floor(L / 3);
  for (let i = 0; i < n; i++) {
    if ((i + Math.floor(time * 20)) % 4 > Math.floor(k * 4)) continue;
    g.fillRect(i * 3, -0.5, 2, 1);
  }
  g.restore();
  return true;
});

registerZonePainter('f6_waveflame', (g, z, px, py, S, time) => {
  const zz = z as Zone & { ang?: number; len?: number };
  const l = lifeOf(zz);
  if (l < 0) return true;
  const a = zz.ang ?? 0;
  const L = (zz.len ?? 20) * S;
  const x0 = px - (Math.cos(a) * L) / 2;
  const y0 = py - (Math.sin(a) * L) / 2;
  const x1 = px + (Math.cos(a) * L) / 2;
  const y1 = py + (Math.sin(a) * L) / 2;
  g.strokeStyle = rgba(FIRE[1], 0.5 * l);
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
  tongues(g, x0, y0, x1, y1, Math.floor(L / 4), 9 * l + 3, time, Math.min(1, l * 1.6), zz.id);
  return true;
});

// Пламя веером: сектор метки, края ярче; порядок — по времени удара.
registerZonePainter('f6_sweep', (g, z, px, py, S, time) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const R = zz.r * S;
  const a = zz.ang ?? 0;
  const arc = zz.arc ?? 0.5;
  cone(g, px, py, R, a, arc);
  g.fillStyle = rgba(FIRE[0], 0.1 + 0.3 * k);
  g.fill();
  g.strokeStyle = rgba(FIRE[2], 0.25 + 0.6 * k);
  g.lineWidth = 1;
  g.beginPath();
  g.arc(px, py, R * (0.3 + 0.7 * k), a - arc / 2, a + arc / 2);
  g.stroke();
  g.fillStyle = rgba(FIRE[3], 0.5 * k);
  for (let i = 0; i < 4; i++) {
    const t = (time * 1.4 + i * 0.25) % 1;
    const aa = a + (hash(i, zz.id) - 0.5) * arc;
    g.fillRect(Math.round(px + Math.cos(aa) * R * t), Math.round(py + Math.sin(aa) * R * t), 1, 1);
  }
  return true;
});

// Струя пламени изо рта: комья огня, у пасти белые, к краю красные.
registerZonePainter('f6_breath', (g, z, px, py, S, time) => {
  const zz = z as ZoneX & Zone;
  const t = Math.min(1, zz.t / Math.max(0.01, zz.life));
  const R = zz.r * S;
  let a = zz.ang ?? 0;
  const arc = zz.sweep ? 0.5 : 0.6;
  // Веер: струя поворачивается за время жизни.
  if (zz.sweep) a += zz.sweep * (t - 0.5) * 3.3;
  const reach = Math.min(1, t * 5);
  const fade = t < 0.75 ? 1 : 1 - (t - 0.75) / 0.25;
  const seed = Math.floor(time * 24);
  for (let i = 0; i < 24; i++) {
    const k = (i + 0.5) / 24;
    const d = R * k * reach;
    const spread = (hash(i, seed) - 0.5) * arc * (0.3 + k * 0.7);
    const x = px + Math.cos(a + spread) * d;
    const y = py - 8 + Math.sin(a + spread) * d;
    const r = 1.4 + k * 3.4 + hash(i, seed, 2) * 1.2;
    const col = k < 0.2 ? FIRE[3] : k < 0.5 ? FIRE[2] : k < 0.8 ? FIRE[1] : FIRE[0];
    g.fillStyle = rgba(col, 0.88 * fade);
    g.beginPath();
    g.arc(Math.round(x), Math.round(y), r, 0, TAU);
    g.fill();
  }
  return true;
});

// Бросок головой: полоса с «зубами» на конце.
registerZonePainter('f6_bite', (g, z, px, py, S) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const a = zz.ang ?? 0;
  const L = zz.r * S;
  const w = (zz.w ?? 0.7) * S;
  g.save();
  g.translate(px, py);
  g.rotate(a);
  g.fillStyle = rgba(hx('#c81a10'), 0.14 + 0.3 * k);
  g.fillRect(0, -w, L, w * 2);
  // Клыки на конце — где сомкнутся челюсти.
  g.fillStyle = rgba(BONE[3], 0.4 + 0.6 * k);
  for (let i = -2; i <= 2; i++) {
    g.fillRect(Math.round(L - 4 + Math.abs(i)), Math.round(i * (w / 2.5)) - 1, 3, 2);
  }
  g.strokeStyle = rgba(FIRE[2], 0.4 + 0.6 * k);
  g.lineWidth = 1;
  g.strokeRect(0, -w, L * k, w * 2);
  g.restore();
  return true;
});

// Хвост вкруговую: кольцо штрихов вращается.
registerZonePainter('f6_tail', (g, z, px, py, S, time) => {
  const k = kOf(z as ZoneX);
  const R = z.r * S;
  g.fillStyle = rgba(hx('#a01810'), 0.1 + 0.24 * k);
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.fill();
  g.strokeStyle = rgba(hx('#ffc890'), 0.4 + 0.6 * k);
  g.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    const a0 = time * 7 * (0.5 + k) + (i / 6) * TAU;
    g.beginPath();
    g.arc(px, py, R, a0, a0 + 0.5);
    g.stroke();
  }
  return true;
});

// Пике: тень змея растёт в круге, крест прицела.
registerZonePainter('f6_dive', (g, z, px, py, S, time) => {
  const k = kOf(z as ZoneX);
  const R = z.r * S;
  g.fillStyle = rgba(hx('#200404'), 0.2 + 0.4 * k);
  g.beginPath();
  g.ellipse(px, py, R * (0.3 + 0.7 * k), R * (0.2 + 0.5 * k), 0, 0, TAU);
  g.fill();
  g.strokeStyle = rgba(FIRE[1], 0.6 + 0.4 * k);
  g.lineWidth = 1;
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.stroke();
  const d = R * (1.3 - 0.4 * k);
  g.strokeStyle = rgba(FIRE[2], 0.5 + 0.5 * Math.sin(time * 20));
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    g.beginPath();
    g.moveTo(px + dx * d, py + dy * d * 0.8);
    g.lineTo(px + dx * (d - 4), py + dy * (d - 4) * 0.8);
    g.stroke();
  }
  return true;
});

// Удар пике: кольцо огня и камни.
registerZonePainter('f6_impact', (g, z, px, py, S) => {
  const zz = z as Zone;
  const t = Math.min(1, zz.t / Math.max(0.01, zz.life));
  const R = zz.r * S * (0.5 + t);
  g.strokeStyle = rgba(FIRE[2], 1 - t);
  g.lineWidth = 3 * (1 - t) + 1;
  g.beginPath();
  g.ellipse(px, py, R, R * 0.7, 0, 0, TAU);
  g.stroke();
  g.fillStyle = rgba(BASALT[2], 1 - t);
  for (let i = 0; i < 10; i++) {
    const a = hash(i, zz.id) * TAU;
    const d = R * (0.4 + hash(i, zz.id, 2) * 0.6);
    g.fillRect(Math.round(px + Math.cos(a) * d), Math.round(py + Math.sin(a) * d * 0.7 - t * 8), 2, 2);
  }
  return true;
});

// Угли с неба: метка — круг, в неё падает уголёк с хвостом.
registerZonePainter('f6_ember', (g, z, px, py, S) => {
  const k = kOf(z as ZoneX);
  const R = z.r * S;
  g.fillStyle = rgba(FIRE[0], 0.12 + 0.25 * k);
  g.beginPath();
  g.ellipse(px, py, R, R * 0.8, 0, 0, TAU);
  g.fill();
  g.strokeStyle = rgba(FIRE[2], 0.4 + 0.5 * k);
  g.lineWidth = 1;
  g.stroke();
  // Уголёк падает сверху: высота убывает к удару.
  const h = (1 - k) * 60;
  g.fillStyle = rgba(FIRE[1], 0.8);
  g.fillRect(Math.round(px) - 1, Math.round(py - h - 6), 3, 6);
  g.fillStyle = rgba(FIRE[3], 1);
  g.fillRect(Math.round(px), Math.round(py - h - 1), 1, 2);
  return true;
});

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
function riseMark(g: CanvasRenderingContext2D, zz: Zone, px: number, py: number, S: number, time: number, big: boolean) {
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

registerZonePainter('f6_crack', (g, z, px, py, S, time) => {
  riseMark(g, z as Zone, px, py, S, time, true);
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
