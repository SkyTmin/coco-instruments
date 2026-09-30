// Этаж 10 «Трон демона» — рисовальщики: монстры, Король демонов,
// реквизит замка, свои клетки трёх районов, метки ударов, иконки вещей.
//
// Монстры и почти весь реквизит нарисованы кодом: пиксели 16 на клетку,
// свет сверху-слева, контур тёмный, палитра — ступени камня подземелья и
// два акцента этажа: кровь-и-золото (замок) и фиолетово-белая молния.
// Горгулья и статуи (владыка, дьявол, железный страж, латник), кровавый
// фонтан, алтарь пламени и груда черепов — тайлы DCSS (CC0), прогнанные
// через палитру подземелья (`scripts/dungeon/f10.py --sprites` →
// `public/dungeon/f10/sheet.png`, авторы — `CREDITS.txt` там же). Лист
// грузится асинхронно: пока его нет, рисовальщики этих вещей молчат.
// Кровавый фонтан в стене — кадры атласа 0x72 (CC0), он уже в проекте.
//
// Кадры собираются один раз и лежат в кеше: рисовать кадр в кадре нельзя.

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
import type { Mob, Strike, Zone } from '../dungeon-sim';
import { x72 } from '../dungeon-tiles';
import { F10_GALLERY, F10_GATES, F10_MARK, F10_THRONE } from './f10';
import { F10_FX, GUARD, KING } from './f10-brains';

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
const alpha = (c: RGBA, a: number): RGBA => [
  c[0],
  c[1],
  c[2],
  Math.round(Math.max(0, Math.min(1, a)) * 255),
];

const INK = hx('#150f0b');
export const WHITE = hx('#ffffff');
const GOLDK = hx('#ffcc40');
export const TAU = Math.PI * 2;

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
      if (inside) p.set(x, y, typeof c === 'function' ? c(x, y) : c);
    }
}

/** Многоугольник со светом по вертикали/горизонтали (плоская грань). */
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
export function stroke(
  p: Px,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  c: RGBA,
  w = 1,
): void {
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

/** Детерминированный шум по двум числам, 0…1. */
export const hash = (a: number, b: number, c = 0) => {
  let h = (a * 374761393 + b * 668265263 + c * 1274126177) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** Огонь: язык пламени снизу вверх, кадр f меняет рисунок. */
function flame(p: Px, cx: number, by: number, w: number, h: number, f: number, seed = 0): void {
  const F = [hx('#8a1a06'), hx('#e05010'), hx('#ffa030'), hx('#fff0a0')];
  for (let y = 0; y < h; y++) {
    const k = y / h;
    const half = w * 0.5 * (1 - k * k) * (0.85 + 0.3 * hash(y, f, seed));
    const sway = Math.sin(k * 3 + f * 1.3 + seed) * k * 1.2;
    for (let x = -Math.ceil(half); x <= Math.ceil(half); x++) {
      const e = Math.abs(x) / (half + 0.01);
      if (e > 1) continue;
      const hot = 1 - Math.max(e, k * 0.9);
      const c = hot > 0.62 ? F[3] : hot > 0.38 ? F[2] : hot > 0.15 ? F[1] : F[0];
      p.set(Math.round(cx + x + sway), by - y, c);
    }
  }
  // Искры над языком.
  if (hash(f, seed, 3) > 0.4) p.set(Math.round(cx + (hash(f, seed) - 0.5) * w), by - h - 1, F[2]);
}

/** Сдвинуть полосу рядов [y0, y1) по x (для качаний и шага). */
function shiftRows(p: Px, y0: number, y1: number, dx: number): void {
  if (!dx) return;
  const row = new Uint8ClampedArray(p.w * 4);
  for (let y = Math.max(0, y0); y < Math.min(p.h, y1); y++) {
    const o = y * p.w * 4;
    row.set(p.data.subarray(o, o + p.w * 4));
    for (let x = 0; x < p.w; x++) {
      const sx = x - dx;
      const d = o + x * 4;
      if (sx < 0 || sx >= p.w) {
        p.data[d + 3] = 0;
        continue;
      }
      p.data[d] = row[sx * 4];
      p.data[d + 1] = row[sx * 4 + 1];
      p.data[d + 2] = row[sx * 4 + 2];
      p.data[d + 3] = row[sx * 4 + 3];
    }
  }
}

/** Скопировать пиксели в новый холст со сдвигом. */
function copyAt(src: Px, w: number, h: number, ox: number, oy: number): Px {
  const o = new Px(w, h);
  for (let y = 0; y < src.h; y++)
    for (let x = 0; x < src.w; x++) {
      const i = (y * src.w + x) * 4;
      if (!src.data[i + 3]) continue;
      const tx = x + ox;
      const ty = y + oy;
      if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
      const j = (ty * w + tx) * 4;
      o.data[j] = src.data[i];
      o.data[j + 1] = src.data[i + 1];
      o.data[j + 2] = src.data[i + 2];
      o.data[j + 3] = src.data[i + 3];
    }
  return o;
}

// ---------------------------------------------------------------------------
// Лист DCSS: горгулья, статуи, фонтан, алтарь пламени, черепа.
// ---------------------------------------------------------------------------

/** Порядок клеток листа — тот же, что `SHEET` в `scripts/dungeon/f10.py`. */
const F10_SHEET = [
  'devil',
  'lord',
  'iron',
  'polearm',
  'font0',
  'font1',
  'flame0',
  'flame1',
  'skulls',
];

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
  img.src = `${import.meta.env.BASE_URL}dungeon/f10/sheet.png`;
}

const sheetCache = new Map<string, Px>();

/** Спрайт листа 32×32 копией (можно дорисовывать) или null, пока лист не пришёл. */
function sheetPx(name: string): Px | null {
  if (!sheet) {
    loadSheet();
    return null;
  }
  let p = sheetCache.get(name);
  if (!p) {
    const n = F10_SHEET.indexOf(name);
    if (n < 0) return null;
    const sx = (n % 5) * 32;
    const sy = Math.floor(n / 5) * 32;
    p = new Px(32, 32);
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) {
        const i = ((sy + y) * sheet.width + sx + x) * 4;
        const o = (y * 32 + x) * 4;
        p.data[o] = sheet.data[i];
        p.data[o + 1] = sheet.data[i + 1];
        p.data[o + 2] = sheet.data[i + 2];
        p.data[o + 3] = sheet.data[i + 3];
      }
    sheetCache.set(name, p);
  }
  const c = new Px(p.w, p.h);
  c.data.set(p.data);
  return c;
}

// ---------------------------------------------------------------------------
// Кадр монстра: облик, вспышка, отражение, кеш.
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

function frameOf(
  kind: string,
  pose: MobPose,
  anim: string,
  f: number,
  build: () => Built,
): MobFrame {
  const key = `${kind}|${anim}|${f}|${pose.left ? 1 : 0}|${pose.flash ? 1 : 0}|${pose.look}`;
  const hit = frames.get(key);
  if (hit) return hit;
  return finish(key, build(), pose.look, pose.flash, pose.left);
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

/** Смерть: тело оседает и рассыпается пеплом — кадр k 0…3. */
function ashen(p: Px, k: number, seed: number): Px {
  if (k <= 0) return p;
  const o = new Px(p.w, p.h);
  const ember = hx('#ff6a2a');
  const ash = hx('#3a2a28');
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      const i = (y * p.w + x) * 4;
      if (!p.data[i + 3]) continue;
      const r = hash(x, y, seed);
      if (r < k * 0.26) continue;
      const ty = Math.min(p.h - 1, y + Math.floor(k * k * 2 * r));
      const j = (ty * p.w + x) * 4;
      const c: RGBA =
        r < k * 0.34 ? ember : r < k * 0.5 ? ash : [p.data[i], p.data[i + 1], p.data[i + 2], 255];
      o.data[j] = c[0];
      o.data[j + 1] = c[1];
      o.data[j + 2] = c[2];
      o.data[j + 3] = 255;
    }
  return o;
}

/** Номер кадра смерти по времени режима. */
const deathK = (pose: MobPose) =>
  pose.mode === 'dying' ? Math.min(3, Math.floor(pose.t / 0.16)) : 0;

// ---------------------------------------------------------------------------
// Палитры.
// ---------------------------------------------------------------------------

const ARMOR = tn('#141118', '#28222e', '#443a4c', '#6e6278');
const ARMOR_HI = hx('#9a8ca4');
export const GOLD = tn('#5e3a10', '#9a6a1c', '#d8a23a', '#ffe28a');
const RED = tn('#34070b', '#641015', '#9e1e26', '#d8424a');
const SKIN_D = tn('#2e0c12', '#5a1820', '#8a2a2e', '#b84a44');
const HORN = tn('#2a221c', '#5e5040', '#a09076', '#e2d6bc');
export const FIRE = [hx('#8a1a06'), hx('#e05010'), hx('#ffa030'), hx('#fff0a0')];
const EYE = hx('#ff3a20');
const EYE_HI = hx('#ffd0a0');

// ---------------------------------------------------------------------------
// Адский пёс: чёрная шкура, огненная грива и хвост, светящаяся пасть.
// Кадр 26×18, смотрит вправо, земля — ряд 16.
// ---------------------------------------------------------------------------

const HOUND = {
  fur: tn('#0c0a0e', '#1e1820', '#342a34', '#54444e'),
  belly: tn('#2a1414', '#4a2020', '#6a3028', '#8a4a38'),
  claw: hx('#d8c8a8'),
  mouth: hx('#ff7a2a'),
  tooth: hx('#f4ecd8'),
};

interface HoundPose {
  body: number;
  /** Наклон тела: + — зад выше. */
  tilt: number;
  /** Вытянутость (прыжок). */
  stretch: number;
  head: [number, number];
  jaw: number;
  legs: [number, number, number, number];
  tail: number;
  mane: number;
  lie?: boolean;
}

function drawHound(hp: HoundPose): Built {
  const p = new Px(28, 20);
  const G = 17;
  const by = G - 6 + hp.body;
  const s = hp.stretch;
  const hipX = 7 - s;
  const shX = 16 + s;
  const hipY = by + hp.tilt * 0.5;
  const shY = by - hp.tilt * 0.5;
  if (hp.lie) {
    // Лежит на боку: тело вытянуто по земле, лапы в сторону.
    shadeEll(p, 13, G - 3, 8, 2.8, HOUND.fur);
    shadeEll(p, 21, G - 4, 3, 2.4, HOUND.fur);
    for (let i = 0; i < 4; i++) limb(p, 9 + i * 3, G - 2, 11 + i * 3, G, 0.8, 0.6, HOUND.fur);
    p.set(23, G - 4, hx('#3a0a08'));
    p.outline(INK);
    for (let i = 0; i < 4; i++) p.set(8 + i * 3, G - 6 - (i % 2), FIRE[1]);
    return { p, ax: 13, ay: G, eye: null };
  }
  // Задние лапы (дальняя — темнее), передние.
  const leg = (x: number, y: number, a: number, far: boolean) => {
    const t = far ? tn('#08060a', '#141016', '#221c24', '#34303a') : HOUND.fur;
    const kx = x + Math.sin(a) * 2.2;
    const ky = y + 3;
    const fx = x + Math.sin(a) * 3.8 - 0.5;
    limb(p, x, y, kx, ky, 1.5, 1.1, t);
    limb(p, kx, ky, fx, G - 0.5, 1.1, 0.8, t);
    p.set(Math.round(fx + 1), G - 1, HOUND.claw);
  };
  leg(hipX + 1, hipY + 1, hp.legs[1], true);
  leg(shX - 1, shY + 1, hp.legs[3], true);
  // Хвост — огненный хлыст.
  const tx = hipX - 3;
  const ty = hipY - 2 - hp.tail;
  limb(p, hipX, hipY - 1, tx, ty, 1.2, 0.7, HOUND.fur);
  // Тело: бочка с поджарым брюхом.
  limb(p, hipX, hipY, shX, shY, 3.4, 3.8, HOUND.fur, 0.05);
  limb(p, hipX + 2, hipY + 2.2, shX - 2, shY + 2.4, 1.2, 1.5, HOUND.belly);
  // Шея и голова.
  const [hx0, hy0] = hp.head;
  limb(p, shX, shY - 1, hx0 - 1, hy0 + 1, 2.6, 2, HOUND.fur);
  shadeEll(p, hx0, hy0, 3, 2.6, HOUND.fur, 0.05);
  // Морда и пасть.
  limb(p, hx0 + 1, hy0 + 0.5, hx0 + 5, hy0 + 1, 1.8, 1.3, HOUND.fur);
  if (hp.jaw > 0) {
    limb(p, hx0 + 1, hy0 + 2, hx0 + 4.5, hy0 + 2 + hp.jaw, 1.1, 0.8, HOUND.fur);
    for (let x = 0; x < 3; x++) p.set(hx0 + 2 + x, hy0 + 2 + Math.floor(hp.jaw / 2), HOUND.mouth);
  }
  // Рога-уши, загнутые назад.
  limb(p, hx0 - 1, hy0 - 2, hx0 - 4, hy0 - 5, 1, 0.4, HORN);
  limb(p, hx0 + 0.5, hy0 - 2.2, hx0 - 1.5, hy0 - 5.5, 0.9, 0.4, HORN);
  // Ближние лапы.
  leg(hipX, hipY + 1.5, hp.legs[0], false);
  leg(shX, shY + 1.5, hp.legs[2], false);
  p.outline(INK);
  // Грива: язычки пламени по холке и затылку — поверх контура.
  for (let i = 0; i < 6; i++) {
    const k = i / 5;
    const x = Math.round(shX + 1 - k * (shX - hipX + 2));
    const y = Math.round(shY - 3.4 + (hipY - shY) * k * 0.5);
    const hgt = 2 + Math.floor(hash(i, hp.mane) * 3) - (i > 3 ? 1 : 0);
    for (let j = 0; j < hgt; j++) {
      const c = j === 0 ? FIRE[1] : j === hgt - 1 ? FIRE[3] : FIRE[2];
      p.set(x - (j > 1 ? 1 : 0), y - j, c);
    }
  }
  // Огонь на кончике хвоста.
  p.set(Math.round(tx), Math.round(ty) - 1, FIRE[2]);
  p.set(Math.round(tx) - 1, Math.round(ty) - 2, FIRE[3]);
  p.set(Math.round(tx), Math.round(ty), FIRE[1]);
  // Зубы и глаз.
  p.set(hx0 + 4, hy0 + 2, HOUND.tooth);
  p.set(hx0 + 2, hy0 + 2, HOUND.tooth);
  p.set(hx0 + 1, hy0 - 1, EYE);
  p.set(hx0 + 2, hy0 - 1, EYE_HI);
  return { p, ax: 12, ay: G, eye: [hx0 + 2, hy0 - 1] };
}

registerMobPainter('f10_hound', (m: Mob, pose: MobPose) => {
  const mode = pose.mode;
  const f = pose.frame;
  let anim = 'idle';
  let fr = 0;
  let hp: HoundPose;
  const base: HoundPose = {
    body: 0,
    tilt: 0,
    stretch: 0,
    head: [21, 7],
    jaw: 0,
    legs: [0, 0, 0, 0],
    tail: 0,
    mane: 0,
  };
  if (mode === 'dying') {
    anim = 'dead';
    fr = deathK(pose);
    hp = { ...base, lie: true };
  } else if (mode === 'aim') {
    anim = 'aim';
    fr = pose.t < 0.2 ? 0 : 1;
    hp = {
      ...base,
      body: 2,
      tilt: 3,
      head: [22, 9],
      jaw: 1,
      legs: [0.5, 0.5, -0.4, -0.4],
      tail: 3,
      mane: fr,
    };
  } else if (mode === 'pounce') {
    anim = 'pounce';
    fr = Math.floor(pose.t * 10) % 2;
    hp = {
      ...base,
      body: -2,
      tilt: -1,
      stretch: 2,
      head: [24, 5],
      jaw: 3,
      legs: [-1, -1, 1.1, 1.1],
      tail: -1,
      mane: 7 + fr,
    };
  } else if (mode === 'windup') {
    anim = 'wind';
    fr = pose.t < 0.2 ? 0 : 1;
    hp = {
      ...base,
      body: 1,
      tilt: 1,
      head: [20, 8],
      jaw: 2,
      legs: [0.3, 0.3, -0.3, -0.3],
      mane: 2 + fr,
    };
  } else if (mode === 'recover' && pose.t < 0.2) {
    anim = 'bite';
    hp = { ...base, head: [24, 7], jaw: 3, stretch: 1, mane: 4 };
  } else if (pose.anim === 'run') {
    anim = 'run';
    fr = f % 6;
    const ph = (fr / 6) * TAU;
    hp = {
      ...base,
      body: Math.round(Math.sin(ph * 2) * 0.7),
      tilt: Math.sin(ph) * 1.2,
      stretch: Math.sin(ph) * 1,
      head: [21, 7 + Math.round(Math.sin(ph + 1) * 0.7)],
      legs: [
        Math.sin(ph) * 1.1,
        Math.sin(ph + 0.6) * 1.1,
        Math.sin(ph + Math.PI) * 1.1,
        Math.sin(ph + Math.PI + 0.6) * 1.1,
      ],
      tail: Math.round(Math.cos(ph) * 1.2) + 1,
      mane: fr,
    };
  } else if (pose.anim === 'hurt') {
    anim = 'hurt';
    hp = { ...base, body: 1, tilt: -2, head: [19, 6], jaw: 2, mane: 9 };
  } else {
    anim = 'idle';
    fr = f % 4;
    hp = {
      ...base,
      body: fr === 1 || fr === 2 ? 1 : 0,
      head: [21, 7 + (fr === 2 ? 1 : 0)],
      tail: fr % 2,
      mane: fr,
    };
  }
  return frameOf('f10_hound', pose, anim, fr, () => {
    const b = drawHound(hp);
    if (anim === 'dead') b.p = ashen(b.p, fr, m.id % 7);
    return b;
  });
});

// ---------------------------------------------------------------------------
// Демон-страж: чёрные латы с золотой каймой, рогатый шлем, красный
// табар, алебарда. Кадр 40×40, смотрит вправо, земля — ряд 36.
// ---------------------------------------------------------------------------

interface GuardPose {
  /** Угол древка (0 — вправо, −π/2 — вверх). */
  pole: number;
  /** Где рука держит древко (от плеча). */
  grip: [number, number];
  /** На сколько древко выдвинуто вперёд от хвата (выпад). */
  push: number;
  bob: number;
  step: number;
  lean: number;
  swing?: boolean;
  dead?: boolean;
}

/** Алебарда: древко, секира и пика на конце. */
function halberd(p: Px, x: number, y: number, a: number, push: number, glow: boolean): void {
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const bx = x - ux * (10 - push);
  const by = y - uy * (10 - push);
  const tx = x + ux * (12 + push);
  const ty = y + uy * (12 + push);
  stroke(p, bx, by, tx, ty, hx('#3a2418'));
  stroke(p, bx + 0.4, by - 0.3, tx + 0.4, ty - 0.3, hx('#6a4a30'));
  // Окованный подток.
  p.set(Math.round(bx), Math.round(by), GOLD[2]);
  // Пика.
  const px0 = tx + ux * 3.5;
  const py0 = ty + uy * 3.5;
  stroke(p, tx, ty, px0, py0, hx('#b8b0c0'));
  p.set(Math.round(px0), Math.round(py0), WHITE);
  // Лезвие секиры — полумесяц по одну сторону древка.
  const nx = -uy;
  const ny = ux;
  const ax = tx - ux * 1.5;
  const ay = ty - uy * 1.5;
  const blade: [number, number][] = [
    [ax + nx * 0.5, ay + ny * 0.5],
    [ax + nx * 4 - ux * 1.5, ay + ny * 4 - uy * 1.5],
    [ax + nx * 4.5 + ux * 1.5, ay + ny * 4.5 + uy * 1.5],
    [ax + nx * 3 + ux * 3, ay + ny * 3 + uy * 3],
    [ax + nx * 0.5 + ux * 2, ay + ny * 0.5 + uy * 2],
  ];
  poly(p, blade, (px, py) => {
    const e = (px - ax) * nx + (py - ay) * ny;
    return e > 3.4 ? (glow ? hx('#ffd0a0') : hx('#e8e0f0')) : e > 2 ? hx('#a098ac') : hx('#5a5264');
  });
  // Шип обуха.
  p.set(Math.round(ax - nx * 1.5), Math.round(ay - ny * 1.5), hx('#8a8296'));
  p.set(Math.round(ax - nx * 2.5 + ux * 0.5), Math.round(ay - ny * 2.5 + uy * 0.5), hx('#5a5264'));
}

function drawGuard(gp: GuardPose): Built {
  const p = new Px(40, 40);
  const G = 36;
  const cx = 18 + gp.lean;
  const hip = G - 11 + gp.bob;
  const sh = hip - 9;
  if (gp.dead) {
    // Рухнул навзничь: латы, шлем, алебарда рядом.
    halberd(p, 20, G - 2, 0.06, 0, false);
    limb(p, 8, G - 3, 26, G - 3, 3.6, 3.4, ARMOR);
    shadeEll(p, 28, G - 4, 3.2, 2.8, ARMOR);
    limb(p, 27, G - 7, 24, G - 11, 1, 0.5, HORN);
    limb(p, 12, G - 1, 20, G - 1, 1.2, 1.2, RED);
    p.outline(INK);
    return { p, ax: 18, ay: G, eye: null };
  }
  // Древко за спиной, если поднято назад (замах).
  const behind = gp.pole < -Math.PI * 0.6 || gp.pole > Math.PI * 0.8;
  const gx = cx + gp.grip[0];
  const gy = sh + gp.grip[1];
  if (behind) halberd(p, gx, gy, gp.pole, gp.push, !!gp.swing);
  // Ноги: поножи, шаг.
  const legT = tn('#100d12', '#221c26', '#3a3242', '#5a5064');
  const lf = gp.step;
  limb(p, cx - 1, hip, cx - 2 - lf, G - 4, 2, 1.7, legT);
  limb(p, cx - 2 - lf, G - 4, cx - 2 - lf * 1.3, G - 1, 1.6, 1.8, legT);
  limb(p, cx + 2, hip, cx + 3 + lf, G - 4, 2.1, 1.8, ARMOR);
  limb(p, cx + 3 + lf, G - 4, cx + 3 + lf * 1.3, G - 1, 1.7, 1.9, ARMOR);
  p.rect(Math.round(cx + 2 + lf * 1.3), G - 1, Math.round(cx + 5 + lf * 1.3), G - 1, ARMOR[2]);
  // Табар: красное полотнище с золотой каймой между ног.
  poly(
    p,
    [
      [cx - 2, hip - 1],
      [cx + 4, hip - 1],
      [cx + 3.5 + gp.step * 0.5, G - 4],
      [cx - 1.5 + gp.step * 0.5, G - 4],
    ],
    (x, y) => tone(RED, 0.55 - (y - hip) * 0.05 + (x < cx ? -0.2 : 0.1)),
  );
  for (let y = hip; y < G - 4; y++)
    p.set(Math.round(cx + 3.5 + (gp.step * 0.5 * (y - hip)) / 10), y, GOLD[1]);
  p.rect(
    Math.round(cx - 1 + gp.step * 0.5),
    G - 5,
    Math.round(cx + 3 + gp.step * 0.5),
    G - 5,
    GOLD[2],
  );
  // Корпус: кираса, расширенная к плечам.
  polyShade(
    p,
    [
      [cx - 4, sh - 1],
      [cx + 5, sh - 1],
      [cx + 4, hip],
      [cx - 3, hip],
    ],
    ARMOR,
  );
  // Золотая кайма по вороту и поясу, рёбра кирасы.
  p.rect(Math.round(cx - 3), hip - 1, Math.round(cx + 4), hip - 1, GOLD[1]);
  p.set(Math.round(cx + 1), hip - 1, GOLD[3]);
  for (let y = sh + 1; y < hip - 2; y += 2) p.set(Math.round(cx + 1), y, ARMOR[3]);
  // Наплечник: шипастый, с каймой.
  shadeEll(p, cx + 3, sh, 3.2, 2.4, ARMOR, 0.1);
  p.set(Math.round(cx + 3), sh - 3, ARMOR_HI);
  p.set(Math.round(cx + 5), sh - 2, ARMOR_HI);
  for (let x = -2; x <= 3; x++) p.set(Math.round(cx + 3 + x), sh + 2, GOLD[1]);
  // Голова в шлеме, рога вперёд-вверх, красная щель забрала.
  const hdx = cx + 1;
  const hdy = sh - 4;
  shadeEll(p, hdx, hdy, 3.2, 3.4, ARMOR, 0.05);
  limb(p, hdx - 1, hdy - 2, hdx - 4, hdy - 6, 1.2, 0.5, HORN);
  limb(p, hdx + 1.5, hdy - 2.5, hdx + 3, hdy - 7, 1.1, 0.4, HORN);
  // Рука и кулак на древке.
  limb(p, cx + 3, sh + 1, gx, gy, 1.6, 1.3, ARMOR);
  shadeEll(p, gx, gy, 1.5, 1.4, ARMOR, 0.2);
  if (!behind) halberd(p, gx, gy, gp.pole, gp.push, !!gp.swing);
  p.outline(INK);
  // Щель забрала и глаз — поверх контура.
  for (let x = 0; x < 3; x++) p.set(Math.round(hdx + x), Math.round(hdy), hx('#2a0806'));
  p.set(Math.round(hdx + 2), Math.round(hdy), EYE);
  p.set(Math.round(hdx + 1), Math.round(hdy), EYE_HI);
  return { p, ax: 18, ay: G, eye: [Math.round(hdx + 2), Math.round(hdy)] };
}

registerMobPainter('f10_guard', (m: Mob, pose: MobPose) => {
  const mode = pose.mode;
  const f = pose.frame;
  let anim = 'idle';
  let fr = 0;
  let gp: GuardPose = { pole: -1.35, grip: [4, 4], push: 0, bob: 0, step: 0, lean: 0 };
  if (mode === 'dying') {
    anim = 'dead';
    fr = deathK(pose);
    gp = { ...gp, dead: true };
  } else if (mode === 'sweep') {
    // Замах: лезвие уходит за плечо, потом — полукругом вперёд.
    const k = Math.min(1, pose.t / (GUARD.sweepWarn - 0.05));
    anim = 'sweep';
    fr = Math.min(3, Math.floor(k * 4));
    const a = [-1.6, -2.1, -2.5, -2.7][fr];
    gp = {
      pole: a,
      grip: [1, 1],
      push: -2,
      bob: fr > 1 ? 1 : 0,
      step: -1,
      lean: -1,
      swing: fr === 3,
    };
  } else if (mode === 'thrust') {
    const k = Math.min(1, pose.t / (GUARD.thrustWarn - 0.05));
    anim = 'thrust';
    fr = Math.min(2, Math.floor(k * 3));
    gp = {
      pole: -0.05,
      grip: [0, 5],
      push: -3 - fr,
      bob: 0,
      step: -1,
      lean: -1 - (fr > 0 ? 1 : 0),
      swing: fr === 2,
    };
  } else if (mode === 'recover' && pose.t < 0.3) {
    // Следом за ударом: лезвие внизу впереди или древко выброшено.
    anim = 'strike';
    fr = pose.t < 0.14 ? 0 : 1;
    gp = {
      pole: fr ? 0.55 : 0.2,
      grip: [6, 5],
      push: fr ? 2 : 5,
      bob: 1,
      step: 2,
      lean: 2,
      swing: true,
    };
  } else if (mode === 'f10_stand' || mode === 'alertpost') {
    anim = mode === 'alertpost' ? 'alert' : 'stand';
    fr = f % 4;
    gp = {
      pole: -Math.PI / 2 + 0.08,
      grip: [5, 5],
      push: 3,
      bob: fr === 2 ? 1 : 0,
      step: 0,
      lean: 0,
    };
  } else if (pose.anim === 'run') {
    anim = 'run';
    fr = f % 4;
    const s = [2, 0, -2, 0][fr];
    gp = { pole: -0.95, grip: [5, 4], push: 1, bob: fr % 2 ? 0 : 1, step: s, lean: 1 };
  } else if (pose.anim === 'hurt') {
    anim = 'hurt';
    gp = { pole: -1.9, grip: [3, 3], push: 0, bob: 1, step: -1, lean: -2 };
  } else {
    anim = 'idle';
    fr = f % 4;
    gp = { pole: -1.3, grip: [5, 4], push: 1, bob: fr === 1 || fr === 2 ? 1 : 0, step: 0, lean: 0 };
  }
  return frameOf('f10_guard', pose, anim, fr, () => {
    const b = drawGuard(gp);
    if (anim === 'dead') b.p = ashen(b.p, fr, m.id % 5);
    return b;
  });
});

// ---------------------------------------------------------------------------
// Рыцарь ада на коне: вороной конь с огненной гривой и копытами, всадник
// в чёрных латах с рогатым шлемом, копьё. Кадр 44×40, смотрит вправо,
// земля — ряд 37.
// ---------------------------------------------------------------------------

const HORSE = tn('#0a080c', '#1a161e', '#2e2834', '#4a4250');

interface KnightPose {
  /** Ноги коня: фазы четырёх ног (угол размаха). */
  legs: [number, number, number, number];
  body: number;
  /** Дыбы: подъём передка. */
  rear: number;
  /** Голова коня: наклон. */
  neck: number;
  /** Копьё: угол (0 — вперёд). */
  lance: number;
  /** Копьё выдвинуто. */
  push: number;
  mane: number;
  charge?: boolean;
  dizzy?: number;
  dead?: boolean;
}

function drawKnight(kp: KnightPose): Built {
  const p = new Px(46, 42);
  const G = 38;
  const by = G - 12 + kp.body;
  const rear = kp.rear;
  const hipX = 11;
  const shX = 28;
  const hipY = by;
  const shY = by - rear;
  if (kp.dead) {
    // Конь пал на бок, всадник под ним.
    limb(p, 8, G - 4, 30, G - 4, 5, 5.5, HORSE);
    limb(p, 30, G - 5, 38, G - 3, 2.6, 2, HORSE);
    for (let i = 0; i < 4; i++) limb(p, 12 + i * 5, G - 1, 14 + i * 5, G, 1, 0.8, HORSE);
    shadeEll(p, 20, G - 10, 3, 2.6, ARMOR);
    p.outline(INK);
    for (let i = 0; i < 5; i++) p.set(14 + i * 4, G - 9 - (i % 2), FIRE[1]);
    return { p, ax: 20, ay: G, eye: null };
  }
  // Ноги коня: дальние — темнее.
  const leg = (x: number, y: number, a: number, far: boolean, front: boolean) => {
    const t = far ? tn('#060508', '#100e14', '#1c1820', '#2a2630') : HORSE;
    const kx = x + Math.sin(a) * 3.2;
    const ky = y + 5;
    const fx = x + Math.sin(a + (front ? 0.6 : -0.6)) * 4.4;
    const fy = Math.min(G - 1, ky + 5 - Math.max(0, front ? rear * 0.6 : 0));
    limb(p, x, y, kx, ky, 2, 1.4, t);
    limb(p, kx, ky, fx, fy, 1.3, 1.1, t);
    // Копыто горит.
    p.set(Math.round(fx), Math.round(fy) + 1, far ? FIRE[0] : FIRE[1]);
    p.set(Math.round(fx) + 1, Math.round(fy) + 1, far ? FIRE[0] : FIRE[2]);
  };
  leg(hipX + 1, hipY + 3, kp.legs[1], true, false);
  leg(shX - 2, shY + 3, kp.legs[3], true, true);
  // Хвост — пламя.
  for (let i = 0; i < 7; i++) {
    const k = i / 6;
    const x = hipX - 3 - k * 5;
    const y = hipY - 2 + k * 6 + Math.sin(k * 3 + kp.mane) * 1.2;
    const c = k < 0.3 ? FIRE[1] : k < 0.7 ? FIRE[2] : FIRE[3];
    p.ell(x, y, 1.6 - k * 0.8, 1.6 - k * 0.8, c);
  }
  // Туловище коня.
  limb(p, hipX, hipY, shX, shY, 5, 5.6, HORSE, 0.05);
  // Шея и голова.
  const nx = shX + 4;
  const ny = shY - 6 + kp.neck;
  limb(p, shX, shY - 1, nx, ny, 3.6, 2.4, HORSE);
  const hdx = nx + 3;
  const hdy = ny + 1 + kp.neck * 0.5;
  limb(p, nx, ny, hdx + 2, hdy + 2, 2.4, 1.7, HORSE, 0.05);
  // Ухо.
  limb(p, nx, ny - 1.5, nx - 0.5, ny - 4, 0.9, 0.4, HORSE);
  // Сбруя: красный чепрак с золотой каймой.
  poly(
    p,
    [
      [hipX + 3, hipY - 4 + rear * 0.3],
      [shX - 3, shY - 4.5],
      [shX - 3, shY + 3.5],
      [hipX + 3, hipY + 3 + rear * 0.3],
    ],
    (x, y) => tone(RED, 0.6 - (y - hipY) * 0.06 - (x - hipX) * 0.01),
  );
  for (let x = hipX + 3; x <= shX - 3; x++) {
    const y = Math.round(
      hipY + 3 + rear * 0.3 + ((shY - hipY - rear * 0.3) * (x - hipX - 3)) / (shX - hipX - 6),
    );
    p.set(x, y, GOLD[2]);
  }
  // Ближние ноги.
  leg(hipX, hipY + 3.5, kp.legs[0], false, false);
  leg(shX - 1, shY + 3.5, kp.legs[2], false, true);
  // Всадник: ноги в стременах, корпус, шлем с рогами и плюмажем.
  const rx = (hipX + shX) / 2 + 1;
  const ry = (hipY + shY) / 2 - 5;
  limb(p, rx, ry + 3, rx + 2, ry + 9, 1.6, 1.3, ARMOR);
  polyShade(
    p,
    [
      [rx - 3, ry - 8],
      [rx + 4, ry - 8],
      [rx + 3, ry + 3],
      [rx - 3, ry + 3],
    ],
    ARMOR,
  );
  p.rect(rx - 2, ry + 2, rx + 3, ry + 2, GOLD[1]);
  shadeEll(p, rx + 2, ry - 8, 2.8, 2, ARMOR, 0.1);
  const hx0 = rx + 1;
  const hy0 = ry - 12;
  shadeEll(p, hx0, hy0, 2.8, 3, ARMOR, 0.05);
  limb(p, hx0 - 1, hy0 - 2, hx0 - 3, hy0 - 5.5, 1, 0.4, HORN);
  limb(p, hx0 + 1.2, hy0 - 2.2, hx0 + 3, hy0 - 6, 0.9, 0.4, HORN);
  // Копьё: древко чёрное с золотыми кольцами, наконечник светится.
  const la = kp.lance;
  const ux = Math.cos(la);
  const uy = Math.sin(la);
  const gx = rx + 4;
  const gy = ry - 3;
  const L = 22 + kp.push;
  const bx = gx - ux * 7;
  const byy = gy - uy * 7;
  const tx = gx + ux * (L - 7);
  const ty = gy + uy * (L - 7);
  stroke(p, bx, byy, tx, ty, hx('#2a2230'));
  stroke(p, bx + 0.3, byy - 0.4, tx + 0.3, ty - 0.4, hx('#4a4054'));
  for (const k of [0.3, 0.55])
    p.set(Math.round(bx + (tx - bx) * k), Math.round(byy + (ty - byy) * k), GOLD[2]);
  poly(
    p,
    [
      [tx - uy * 1.6, ty + ux * 1.6],
      [tx + ux * 5, ty + uy * 5],
      [tx + uy * 1.6, ty - ux * 1.6],
    ],
    kp.charge ? hx('#ffd0a0') : hx('#c8c0d4'),
  );
  // Рука на копье.
  limb(p, rx + 2, ry - 6, gx, gy, 1.5, 1.2, ARMOR);
  p.outline(INK);
  // Грива — пламя вдоль шеи (поверх контура).
  for (let i = 0; i < 6; i++) {
    const k = i / 5;
    const x = Math.round(shX + 1 + (nx - shX - 1) * k) - 1;
    const y = Math.round(shY - 4 + (ny - shY + 2) * k);
    const hgt = 2 + Math.floor(hash(i, kp.mane) * 3);
    for (let j = 0; j < hgt; j++)
      p.set(x - Math.floor(j / 2), y - j, j === 0 ? FIRE[1] : j === hgt - 1 ? FIRE[3] : FIRE[2]);
  }
  // Глаз коня и щель шлема.
  p.set(Math.round(hdx), Math.round(hdy - 1), EYE);
  p.set(Math.round(hx0 + 1), Math.round(hy0), EYE);
  p.set(Math.round(hx0 + 2), Math.round(hy0), hx('#2a0806'));
  if (kp.charge) {
    // Огненный след за копытами.
    for (let i = 0; i < 6; i++) p.set(2 + i * 2, G - 1 - (i % 2), FIRE[(i % 3) as 0 | 1 | 2]);
  }
  if (kp.dizzy !== undefined) stars(p, hx0, hy0 - 6, 4, kp.dizzy);
  return { p, ax: 20, ay: G, eye: [Math.round(hdx), Math.round(hdy - 1)] };
}

registerMobPainter('f10_knight', (m: Mob, pose: MobPose) => {
  const mode = pose.mode;
  const f = pose.frame;
  let anim = 'idle';
  let fr = 0;
  const base: KnightPose = {
    legs: [0, 0, 0, 0],
    body: 0,
    rear: 0,
    neck: 0,
    lance: -1.1,
    push: 0,
    mane: 0,
  };
  let kp: KnightPose = base;
  if (mode === 'dying') {
    anim = 'dead';
    fr = deathK(pose);
    kp = { ...base, dead: true };
  } else if (mode === 'f10_fall') {
    anim = 'fall';
    fr = Math.min(4, Math.floor(pose.t / 0.18));
    kp = { ...base, rear: -3, neck: 3, lance: -0.4, legs: [0.8, -0.8, 1, -1], mane: fr };
  } else if (mode === 'aim') {
    // Конь роет копытом, копьё опускается вперёд.
    anim = 'aim';
    fr = Math.floor(pose.t * 8) % 4;
    const k = Math.min(1, pose.t / 0.8);
    kp = {
      ...base,
      rear: fr % 2 ? 2 : 1,
      legs: [0, 0, fr % 2 ? -1.2 : 0.3, 0],
      lance: -1.1 + k * 1.1,
      neck: 1,
      mane: fr,
    };
  } else if (mode === 'charge') {
    anim = 'charge';
    fr = Math.floor(pose.t * 14) % 4;
    const ph = (fr / 4) * TAU;
    kp = {
      ...base,
      legs: [
        Math.sin(ph) * 1.4,
        Math.sin(ph + 0.5) * 1.4,
        Math.sin(ph + Math.PI) * 1.4,
        Math.sin(ph + Math.PI + 0.5) * 1.4,
      ],
      body: fr % 2,
      lance: 0.02,
      push: 4,
      neck: 2,
      mane: 10 + fr,
      charge: true,
    };
  } else if (mode === 'dizzy') {
    anim = 'dizzy';
    fr = Math.floor(pose.t * 6) % 4;
    kp = {
      ...base,
      rear: 4 - (fr % 2),
      neck: -2,
      lance: -1.7,
      legs: [0.4, 0, -1.2, -0.6],
      mane: fr,
      dizzy: fr,
    };
  } else if (mode === 'lance') {
    anim = 'lance';
    fr = pose.t < 0.35 ? 0 : 1;
    kp = { ...base, lance: fr ? 0.1 : -0.3, push: fr ? 6 : -2, neck: 1, mane: fr };
  } else if (mode === 'skid') {
    anim = 'skid';
    kp = { ...base, rear: 3, legs: [0.8, 0.8, -1, -1], lance: -0.5, neck: -1, mane: 3 };
  } else if (pose.anim === 'run') {
    anim = 'run';
    fr = f % 4;
    const ph = (fr / 4) * TAU;
    kp = {
      ...base,
      legs: [
        Math.sin(ph) * 1,
        Math.sin(ph + 0.5) * 1,
        Math.sin(ph + Math.PI) * 1,
        Math.sin(ph + Math.PI + 0.5) * 1,
      ],
      body: fr % 2,
      lance: -0.8,
      mane: fr,
    };
  } else if (pose.anim === 'hurt') {
    anim = 'hurt';
    kp = { ...base, rear: 2, neck: -2, lance: -1.4, mane: 5 };
  } else {
    anim = 'idle';
    fr = f % 4;
    kp = {
      ...base,
      body: fr === 2 ? 1 : 0,
      neck: fr === 1 ? 1 : 0,
      legs: [0, 0, fr === 3 ? 0.4 : 0, 0],
      mane: fr,
    };
  }
  return frameOf('f10_knight', pose, anim, fr, () => {
    const b = drawKnight(kp);
    if (anim === 'dead') b.p = ashen(b.p, fr, m.id % 5);
    if (anim === 'fall') {
      // Уходит в пропасть: ниже и темнее с каждым кадром.
      const q = copyAt(b.p, b.p.w, b.p.h + 16, 0, fr * 4);
      b.p = fr > 1 ? q.tint(hx('#000000'), fr * 0.18) : q;
    }
    return b;
  });
});

// ---------------------------------------------------------------------------
// Суккуба: бледно-сиреневая кожа, чёрные волосы, рожки, крылья летучей
// мыши, хвост с сердцем. Кадр 36×34, смотрит вправо, земля — ряд 31
// (летает: движок поднимает её над тенью).
// ---------------------------------------------------------------------------

const SUC = {
  // Кожа светлее, волосы — белые с лиловым, крылья — малиновые: тёмная
  // суккуба над тёмной бездной сливалась в пятно.
  skin: tn('#5a3458', '#a06c9a', '#d6a8d0', '#f8e2f2'),
  hair: tn('#5a4a6a', '#9a88b0', '#d0c4e0', '#f4eefa'),
  dress: tn('#1a0610', '#420c20', '#6e1634', '#a82850'),
  wing: tn('#2a0a1e', '#521634', '#7e2450', '#b43c74'),
  bone: tn('#3a1a2c', '#6a2c48', '#94405e', '#c05a80'),
  horn: tn('#1a0608', '#3a0c12', '#6a1a22', '#a0303a'),
  lip: hx('#ff5aa0'),
  eye: hx('#ff70d0'),
  heart: hx('#ff4a8a'),
};

interface SucPose {
  /** Взмах крыльев: −1 вниз … 1 вверх. */
  wing: number;
  /** Наклон тела вперёд (пике). */
  lean: number;
  /** Рука: угол от плеча. */
  arm: number;
  /** Голова: запрокинута (смех). */
  head: number;
  legs: number;
  glow?: boolean;
  dead?: boolean;
}

function batWing(
  p: Px,
  sx: number,
  sy: number,
  a: number,
  len: number,
  t: Tones,
  bone: Tones,
  spread = 1,
): void {
  // Три пальца-кости веером, между ними перепонка с зубчатым краем.
  const fingers: [number, number][] = [];
  for (let i = 0; i < 3; i++) {
    const fa = a + (i - 1) * 0.42 * spread;
    const fl = len * (1 - i * 0.12);
    fingers.push([sx + Math.cos(fa) * fl, sy + Math.sin(fa) * fl]);
  }
  const elbow: [number, number] = [
    sx + Math.cos(a - 0.5) * len * 0.45,
    sy + Math.sin(a - 0.5) * len * 0.45,
  ];
  // Перепонка: многоугольник плечо → локоть → кончики → назад к плечу.
  const edge: [number, number][] = [[sx, sy], elbow, ...fingers];
  const low: [number, number] = [
    sx + Math.cos(a + 1.1 * spread) * len * 0.35,
    sy + Math.sin(a + 1.1 * spread) * len * 0.35,
  ];
  poly(p, [...edge, low], (x, y) => {
    const d = Math.hypot(x - sx, y - sy) / len;
    return tone(t, 0.62 - d * 0.5 + ((x + y) % 3 === 0 ? -0.1 : 0));
  });
  // Кости поверх.
  stroke(p, sx, sy, elbow[0], elbow[1], bone[2]);
  for (const [fx, fy] of fingers) stroke(p, elbow[0], elbow[1], fx, fy, bone[1]);
  // Коготь на сгибе.
  p.set(Math.round(elbow[0]), Math.round(elbow[1]) - 1, bone[3]);
}

function drawSuccubus(sp: SucPose): Built {
  const p = new Px(38, 36);
  const G = 31;
  const cx = 17 + sp.lean;
  const hip = G - 10;
  const sh = hip - 7;
  if (sp.dead) {
    batWing(p, 16, G - 5, Math.PI + 0.4, 11, SUC.wing, SUC.bone, 0.7);
    limb(p, 12, G - 3, 24, G - 3, 2.2, 2, SUC.dress);
    shadeEll(p, 25, G - 4, 2.6, 2.4, SUC.skin);
    limb(p, 24, G - 6, 18, G - 5, 1.8, 1, SUC.hair);
    p.outline(INK);
    return { p, ax: 17, ay: G, eye: null };
  }
  // Крылья — за спиной; дальнее чуть выше и темнее.
  const wa = -Math.PI * 0.72 - sp.wing * 0.45 + sp.lean * 0.05;
  batWing(
    p,
    cx - 2,
    sh + 1,
    wa - 0.25,
    13,
    tn('#08040a', '#180a16', '#2a1426', '#401e38'),
    SUC.bone,
    0.9,
  );
  batWing(p, cx - 1, sh + 2, wa + 0.2, 15, SUC.wing, SUC.bone, 1);
  // Хвост с сердцем.
  const tail = spline(
    [
      [cx - 1, hip],
      [cx - 5, hip + 3],
      [cx - 8, hip + 1 - sp.legs],
      [cx - 10, hip - 2],
    ],
    4,
  );
  tail.forEach(([x, y]) => p.set(Math.round(x), Math.round(y), SUC.horn[1]));
  const [tx, ty] = tail[tail.length - 1];
  p.set(Math.round(tx) - 1, Math.round(ty) - 1, SUC.heart);
  p.set(Math.round(tx) + 1, Math.round(ty) - 1, SUC.heart);
  p.set(Math.round(tx), Math.round(ty), SUC.heart);
  p.set(Math.round(tx), Math.round(ty) + 1, hx('#a02058'));
  // Ноги: висят, согнуты; сапоги чёрные.
  const kx = cx + 1 + sp.legs;
  limb(p, cx, hip, kx + 1, hip + 5, 1.6, 1.2, SUC.skin);
  limb(p, kx + 1, hip + 5, kx - 1, G - 1, 1.2, 0.9, SUC.dress);
  limb(p, cx - 1, hip, kx - 1, hip + 5, 1.4, 1.1, tn('#3a2038', '#6a4468', '#9a70a0', '#c098c4'));
  limb(p, kx - 1, hip + 5, kx - 3, G - 2, 1.1, 0.8, tn('#08040a', '#1a0a12', '#2e1422', '#4a2034'));
  // Юбка и корсет.
  poly(
    p,
    [
      [cx - 3, hip - 2],
      [cx + 3, hip - 2],
      [cx + 4, hip + 2],
      [cx - 4, hip + 2],
    ],
    (x) => tone(SUC.dress, x < cx ? 0.3 : 0.6),
  );
  p.rect(cx - 4, hip + 2, cx + 4, hip + 2, hx('#b01c3a'));
  polyShade(
    p,
    [
      [cx - 2, sh],
      [cx + 3, sh],
      [cx + 2.5, hip - 1],
      [cx - 2, hip - 1],
    ],
    SUC.dress,
  );
  // Плечи и грудь — кожа над корсетом.
  shadeEll(p, cx + 0.5, sh + 0.5, 2.6, 1.6, SUC.skin, 0.1);
  // Рука: к губам (поцелуй), вперёд (коготь), на бедро (смех).
  const aa = sp.arm;
  const ex = cx + 2 + Math.cos(aa) * 3;
  const ey = sh + 1 + Math.sin(aa) * 3;
  const hx1 = ex + Math.cos(aa - 0.4) * 3;
  const hy1 = ey + Math.sin(aa - 0.4) * 3;
  limb(p, cx + 2, sh + 1, ex, ey, 1, 0.8, SUC.skin);
  limb(p, ex, ey, hx1, hy1, 0.8, 0.7, SUC.skin);
  // Голова: профиль, волосы назад, рожки.
  const hdx = cx + 1 + Math.round(sp.head * -0.5);
  const hdy = sh - 3;
  // Волосы — длинные пряди за спину.
  for (let i = 0; i < 4; i++) {
    const hair = spline(
      [
        [hdx, hdy - 1],
        [hdx - 3, hdy + 1 + i],
        [hdx - 5 - i, hdy + 5 + i * 1.5],
        [hdx - 6 - i * 1.5, hdy + 9 + i],
      ],
      4,
    );
    hair.forEach(([x, y], n) => p.set(Math.round(x), Math.round(y), SUC.hair[n % 3 === 0 ? 2 : 1]));
  }
  shadeEll(p, hdx, hdy, 2.6, 2.8, SUC.skin, 0.1);
  shadeEll(p, hdx - 1, hdy - 1.2, 2.6, 2.2, SUC.hair, 0);
  limb(p, hdx + 0.5, hdy - 2, hdx + 2, hdy - 5, 0.8, 0.3, SUC.horn);
  limb(p, hdx - 1.2, hdy - 2.2, hdx - 1, hdy - 5.2, 0.7, 0.3, SUC.horn);
  p.outline(INK);
  // Лицо — поверх контура: глаз, губы.
  p.set(Math.round(hdx + 1), Math.round(hdy - sp.head * 0.3), SUC.eye);
  p.set(Math.round(hdx + 2), Math.round(hdy + 1.2), SUC.lip);
  if (sp.glow) {
    // Сердце на ладони — поцелуй вот-вот сорвётся.
    const x = Math.round(hx1) + 1;
    const y = Math.round(hy1) - 1;
    p.set(x - 1, y, SUC.heart);
    p.set(x + 1, y, SUC.heart);
    p.set(x, y + 1, SUC.heart);
    p.set(x, y, hx('#ffc0e0'));
  }
  return { p, ax: 17, ay: G, eye: [Math.round(hdx + 1), Math.round(hdy)] };
}

registerMobPainter('f10_succubus', (m: Mob, pose: MobPose) => {
  const mode = pose.mode;
  const f = pose.frame;
  let anim = 'idle';
  let fr = 0;
  let sp: SucPose = { wing: 0, lean: 0, arm: 1.2, head: 0, legs: 0 };
  const flap = (n: number) => [1, 0.3, -0.8, -0.2][n % 4];
  if (mode === 'dying') {
    anim = 'dead';
    fr = deathK(pose);
    sp = { ...sp, dead: true };
  } else if (mode === 'kiss') {
    anim = 'kiss';
    fr = pose.t < 0.35 ? 0 : 1;
    const wf = Math.floor(pose.t * 10) % 4;
    sp = { wing: flap(wf), lean: 0, arm: fr ? -0.25 : -1.9, head: 0, legs: 0, glow: fr === 1 };
    fr = fr * 4 + wf;
  } else if (mode === 'linger') {
    anim = 'laugh';
    fr = Math.floor(pose.t * 8) % 4;
    sp = { wing: flap(fr), lean: -1, arm: 2.2, head: fr % 2 ? 2 : 1, legs: 1 };
  } else if (mode === 'swoopAim') {
    anim = 'swaim';
    sp = { wing: 1, lean: -1, arm: 0.6, head: 0, legs: -1 };
  } else if (mode === 'swoop') {
    anim = 'swoop';
    fr = Math.floor(pose.t * 12) % 2;
    sp = { wing: fr ? -0.4 : -0.9, lean: 3, arm: 0.1, head: -1, legs: -2 };
  } else if (mode === 'claw') {
    anim = 'claw';
    fr = pose.t < 0.3 ? 0 : 1;
    sp = { wing: 0.5, lean: fr ? 2 : -1, arm: fr ? 0.3 : -1.6, head: 0, legs: 0 };
  } else if (pose.anim === 'hurt') {
    anim = 'hurt';
    sp = { wing: -1, lean: -2, arm: 2.4, head: 2, legs: 1 };
  } else {
    anim = 'fly';
    fr = Math.floor(f * (pose.anim === 'run' ? 0.9 : 0.7)) % 4;
    sp = {
      wing: flap(fr),
      lean: pose.anim === 'run' ? 1 : 0,
      arm: 1.3,
      head: 0,
      legs: fr === 2 ? 1 : 0,
    };
  }
  return frameOf('f10_succubus', pose, anim, fr, () => {
    const b = drawSuccubus(sp);
    if (anim === 'dead') b.p = ashen(b.p, fr, m.id % 5);
    return b;
  });
});

// ---------------------------------------------------------------------------
// Архидемон-маг: рогатый капюшон, лица нет — только глаза, длинная ряса
// с золотой вязью, посох с фиолетовой сферой. Кадр 30×40, земля — ряд 37.
// ---------------------------------------------------------------------------

const MAGE_T = {
  robe: tn('#0e0814', '#1e1228', '#34204a', '#523672'),
  trim: GOLD,
  orb: [hx('#5a2aa0'), hx('#9a5aff'), hx('#d4b0ff'), hx('#ffffff')],
  eye: hx('#c890ff'),
  staff: tn('#0e0a0e', '#221a24', '#3a2e3e', '#5a4a60'),
};

interface MagePose {
  /** Посох: угол. */
  staff: number;
  /** Высота рук (подъём посоха). */
  lift: number;
  orb: number;
  hem: number;
  squash?: number;
  runes?: number;
  dead?: boolean;
}

function drawMage(mp: MagePose): Built {
  const p = new Px(32, 42);
  const G = 38;
  const cx = 14;
  if (mp.dead) {
    polyShade(
      p,
      [
        [4, G - 4],
        [22, G - 6],
        [24, G],
        [3, G],
      ],
      MAGE_T.robe,
    );
    limb(p, 10, G - 2, 28, G - 7, 0.7, 0.6, MAGE_T.staff);
    shadeEll(p, 28, G - 7, 1.6, 1.6, tn('#2a1448', '#4a2a7a', '#6a4aa0', '#9a7ac8'));
    p.outline(INK);
    return { p, ax: 14, ay: G, eye: null };
  }
  const sh = G - 22;
  // Ряса: расширяется книзу, подол колышется.
  const hem = mp.hem;
  poly(
    p,
    [
      [cx - 4, sh],
      [cx + 4, sh],
      [cx + 7 + hem, G],
      [cx - 7 + hem * 0.5, G],
    ],
    (x, y) => {
      const k = (x - cx) / 7;
      const fold = (x + Math.floor(y / 3)) % 5 === 0 ? -0.2 : 0;
      return tone(MAGE_T.robe, 0.5 - k * 0.35 - (y - sh) * 0.008 + fold);
    },
  );
  // Золотая кайма подола и вертикальная вязь.
  for (let x = Math.round(cx - 7 + hem * 0.5); x <= Math.round(cx + 7 + hem); x++)
    p.set(x, G - 1, MAGE_T.trim[2]);
  for (let y = sh + 3; y < G - 1; y++) {
    p.set(cx + 1, y, (y + mp.orb) % 4 === 0 ? MAGE_T.trim[3] : MAGE_T.trim[1]);
    if ((y + 1) % 5 === 0) p.set(cx + 2, y, hx('#b080ff'));
  }
  // Рукав и рука, держащая посох.
  const lift = mp.lift;
  const hx1 = cx + 5;
  const hy1 = sh + 6 - lift;
  limb(p, cx + 2, sh + 2, hx1, hy1, 2.2, 1.6, MAGE_T.robe);
  // Посох.
  const a = mp.staff;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const sx0 = hx1 - ux * 12;
  const sy0 = hy1 - uy * 12;
  const sx1 = hx1 + ux * 10;
  const sy1 = hy1 + uy * 10;
  stroke(p, sx0, sy0, sx1, sy1, MAGE_T.staff[1]);
  stroke(p, sx0 + 0.4, sy0, sx1 + 0.4, sy1, MAGE_T.staff[2]);
  // Когти оправы и сфера.
  const ox = sx1 + ux * 2;
  const oy = sy1 + uy * 2;
  limb(p, sx1, sy1, ox - uy * 1.6, oy + ux * 1.6, 0.6, 0.4, MAGE_T.staff);
  limb(p, sx1, sy1, ox + uy * 1.6, oy - ux * 1.6, 0.6, 0.4, MAGE_T.staff);
  // Капюшон с рогами.
  const hdx = cx + 1;
  const hdy = sh - 3;
  shadeEll(p, hdx, hdy, 3.4, 3.8, MAGE_T.robe, 0.08);
  limb(p, hdx - 1.5, hdy - 2.5, hdx - 5, hdy - 6, 1.3, 0.5, HORN);
  limb(p, hdx + 1.5, hdy - 3, hdx + 3.5, hdy - 7, 1.1, 0.4, HORN);
  // Кисть на посохе.
  shadeEll(p, hx1, hy1, 1.3, 1.2, SKIN_D);
  p.outline(INK);
  // Сфера поверх контура: светится, пульсирует.
  const O = MAGE_T.orb;
  const r = 1.8 + (mp.orb % 2) * 0.4 + (mp.runes ? 0.5 : 0);
  p.ell(ox, oy, r + 0.8, r + 0.8, alpha(O[1], 0.35));
  p.ell(ox, oy, r, r, O[1]);
  p.ell(ox - 0.4, oy - 0.4, r * 0.6, r * 0.6, O[2]);
  p.set(Math.round(ox - 0.8), Math.round(oy - 0.8), O[3]);
  // Лицо — тьма капюшона и два глаза.
  p.ell(hdx + 1.3, hdy + 0.6, 1.8, 2, hx('#050308'));
  p.set(Math.round(hdx + 1), Math.round(hdy + 0.4), MAGE_T.eye);
  p.set(Math.round(hdx + 2.6), Math.round(hdy + 0.4), MAGE_T.eye);
  if (mp.runes) {
    // Руна над головой: кольцо точек крутится.
    for (let i = 0; i < 8; i++) {
      const ra = (i / 8) * TAU + mp.runes * 0.4;
      p.set(
        Math.round(hdx + Math.cos(ra) * 5.5),
        Math.round(hdy - 9 + Math.sin(ra) * 1.8),
        i % 2 ? O[2] : O[3],
      );
    }
  }
  let out = p;
  if (mp.squash) {
    // Уходит вспышкой: сжимается к оси.
    out = new Px(p.w, p.h);
    const k = 1 - mp.squash;
    for (let y = 0; y < p.h; y++)
      for (let x = 0; x < p.w; x++) {
        const sxp = Math.round(cx + (x - cx) / Math.max(0.15, k));
        if (sxp < 0 || sxp >= p.w) continue;
        const i = (y * p.w + sxp) * 4;
        if (!p.data[i + 3]) continue;
        out.set(x, y, [p.data[i], p.data[i + 1], p.data[i + 2], 255]);
      }
    for (let i = 0; i < 6; i++)
      out.set(
        cx + Math.round((hash(i, mp.squash * 10) - 0.5) * 12),
        6 + Math.round(hash(i, 4) * 30),
        O[2],
      );
  }
  return { p: out, ax: 14, ay: G, eye: [Math.round(hdx + 2), Math.round(hdy)] };
}

registerMobPainter('f10_mage', (m: Mob, pose: MobPose) => {
  const mode = pose.mode;
  const f = pose.frame;
  let anim = 'idle';
  let fr = 0;
  let mp: MagePose = { staff: -1.4, lift: 0, orb: 0, hem: 0 };
  if (mode === 'dying') {
    anim = 'dead';
    fr = deathK(pose);
    mp = { ...mp, dead: true };
  } else if (mode === 'cast') {
    anim = 'cast';
    fr = Math.min(5, Math.floor(pose.t / 0.18));
    mp = { staff: -1.57, lift: Math.min(7, fr * 2 + 1), orb: fr, hem: 0, runes: fr + 1 };
  } else if (mode === 'blink') {
    anim = 'blink';
    fr = Math.min(4, Math.floor(pose.t / 0.12));
    mp = { staff: -1.4, lift: 2, orb: fr, hem: 0, squash: fr / 5 };
  } else if (mode === 'recover' && pose.t < 0.35) {
    anim = 'after';
    fr = pose.t < 0.18 ? 0 : 1;
    mp = { staff: -0.9, lift: 3, orb: 2, hem: 1 };
  } else if (pose.anim === 'run') {
    anim = 'run';
    fr = f % 4;
    mp = { staff: -1.2, lift: 0, orb: fr, hem: [1, 0, -1, 0][fr] };
  } else if (pose.anim === 'hurt') {
    anim = 'hurt';
    mp = { staff: -1.9, lift: 1, orb: 1, hem: -1 };
  } else {
    anim = 'idle';
    fr = f % 4;
    mp = { staff: -1.4, lift: fr === 2 ? 1 : 0, orb: fr, hem: fr === 1 ? 1 : 0 };
  }
  return frameOf('f10_mage', pose, anim, fr, () => {
    const b = drawMage(mp);
    if (anim === 'dead') b.p = ashen(b.p, fr, m.id % 5);
    return b;
  });
});

// ---------------------------------------------------------------------------
// Палач: громила в чёрном колпаке, кожаный фартук, в правой руке секира,
// в левой — цепной цеп. Кадр 42×40, земля — ряд 36.
// ---------------------------------------------------------------------------

const EXE = {
  skin: tn('#2e1a18', '#5a3a32', '#84584a', '#a8806a'),
  hood: tn('#060506', '#141014', '#241e24', '#3a323a'),
  apron: tn('#1e120a', '#3a2412', '#5a3a1e', '#7a522e'),
  iron: tn('#1a1a20', '#3a3a44', '#62626e', '#a0a0ac'),
};

interface ExePose {
  /** Секира: угол (−π/2 — вверх). */
  axe: number;
  /** Мяч цепа: угол вокруг кисти и радиус. */
  ball: number;
  ballR: number;
  /** Цеп над головой (вращение). */
  over: boolean;
  bob: number;
  step: number;
  dead?: boolean;
}

function drawExec(ep: ExePose): Built {
  const p = new Px(44, 42);
  const G = 37;
  const cx = 20;
  if (ep.dead) {
    limb(p, 8, G - 4, 28, G - 4, 5, 5, EXE.skin);
    shadeEll(p, 31, G - 5, 3.5, 3.2, EXE.hood);
    limb(p, 12, G - 1, 30, G - 1, 1, 1, EXE.iron);
    p.outline(INK);
    return { p, ax: 20, ay: G, eye: null };
  }
  const hip = G - 10 + ep.bob;
  const sh = hip - 10;
  // Цеп: кисть левой руки (дальней) и мяч.
  const lhx = cx - 5;
  const lhy = sh + 8;
  const bx = ep.over ? cx + Math.cos(ep.ball) * ep.ballR : lhx + Math.cos(ep.ball) * ep.ballR;
  const by = ep.over
    ? sh - 7 + Math.sin(ep.ball) * ep.ballR * 0.35
    : lhy + Math.sin(ep.ball) * ep.ballR;
  const hand: [number, number] = ep.over ? [cx + 1, sh - 7] : [lhx, lhy];
  limb(
    p,
    cx - 3,
    sh + 2,
    hand[0],
    hand[1],
    2.2,
    1.8,
    tn('#1e1210', '#3e2822', '#5e3e32', '#7e5a48'),
  );
  // Цепь — звенья.
  const n = 7;
  for (let i = 1; i <= n; i++) {
    const k = i / n;
    const x = hand[0] + (bx - hand[0]) * k;
    const y = hand[1] + (by - hand[1]) * k + Math.sin(k * Math.PI) * (ep.over ? 0 : 1.5);
    p.set(Math.round(x), Math.round(y), i % 2 ? EXE.iron[2] : EXE.iron[1]);
  }
  // Ноги — толстые, в сапогах.
  const st = ep.step;
  limb(
    p,
    cx - 2,
    hip,
    cx - 3 - st,
    G - 1,
    2.8,
    2.4,
    tn('#100a08', '#24160e', '#3a2616', '#523820'),
  );
  limb(
    p,
    cx + 3,
    hip,
    cx + 4 + st,
    G - 1,
    2.9,
    2.5,
    tn('#1a100a', '#342014', '#4e321e', '#6a482a'),
  );
  // Живот и грудь: голый торс.
  shadeEll(p, cx + 1, hip - 3, 6, 5, EXE.skin, 0.05);
  shadeEll(p, cx, sh + 3, 6.4, 4.4, EXE.skin, 0.12);
  // Фартук.
  poly(
    p,
    [
      [cx - 3, hip - 4],
      [cx + 6, hip - 4],
      [cx + 6 + st * 0.5, G - 3],
      [cx - 2 + st * 0.5, G - 3],
    ],
    (x, y) => tone(EXE.apron, 0.6 - (x - cx) * 0.04 - (y % 4 === 0 ? 0.2 : 0)),
  );
  p.rect(cx - 4, hip - 5, cx + 7, hip - 5, EXE.iron[1]);
  p.rect(cx - 4, hip - 6, cx + 7, hip - 6, EXE.iron[0]);
  // Пряжка — череп; на фартуке — засохшая кровь.
  p.set(cx + 2, hip - 6, hx('#c2b494'));
  p.set(cx + 3, hip - 6, hx('#ece2c6'));
  p.set(cx + 2, hip - 5, hx('#8a7c62'));
  p.set(cx + 3, hip - 5, hx('#8a7c62'));
  for (const [x, y] of [
    [cx + 1, hip + 1],
    [cx + 2, hip + 2],
    [cx + 4, hip],
    [cx - 1, hip + 4],
  ])
    p.set(x + Math.round(st * 0.3), y, hx('#4a0a0e'));
  // Грудь и живот: складка груди, пупок, шрам — голый торс, а не мешок.
  const skinD = mixc(EXE.skin[0], EXE.skin[1], 0.5);
  for (let x = cx - 4; x <= cx + 4; x++)
    if (x !== cx) p.set(x, sh + 5 + (Math.abs(x - cx) > 2 ? 0 : 1), skinD);
  p.set(cx, sh + 3, skinD);
  p.set(cx, sh + 4, skinD);
  p.set(cx + 1, hip - 8, EXE.skin[0]);
  for (let i = 0; i < 4; i++) p.set(cx - 3 + i, sh + 1 + i, hx('#8a4a3a'));
  // Мяч цепа — шипастый.
  shadeEll(p, bx, by, 2.3, 2.3, EXE.iron, 0.1);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    p.set(Math.round(bx + Math.cos(a) * 3), Math.round(by + Math.sin(a) * 3), EXE.iron[3]);
  }
  // Голова в колпаке с прорезями.
  const hdx = cx + 2;
  const hdy = sh - 4;
  shadeEll(p, hdx, hdy + 1, 4, 4.6, EXE.hood, 0.05);
  poly(
    p,
    [
      [hdx - 3, hdy - 2],
      [hdx + 2, hdy - 3],
      [hdx - 1, hdy - 8],
    ],
    EXE.hood[1],
  );
  // Правая рука и секира.
  const a = ep.axe;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const rhx = cx + 6 + ux * 3;
  const rhy = sh + 3 + uy * 3;
  limb(p, cx + 5, sh + 1, rhx, rhy, 2.6, 2.1, EXE.skin);
  // Наруч.
  shadeEll(p, (cx + 5 + rhx) / 2 + 1, (sh + 1 + rhy) / 2, 1.8, 1.6, EXE.iron, 0.1);
  const t0x = rhx - ux * 5;
  const t0y = rhy - uy * 5;
  const t1x = rhx + ux * 10;
  const t1y = rhy + uy * 10;
  stroke(p, t0x, t0y, t1x, t1y, hx('#2a1a10'));
  stroke(p, t0x + 0.4, t0y - 0.3, t1x + 0.4, t1y - 0.3, hx('#5a3a22'));
  // Лезвие — широкий полумесяц.
  const nx = -uy;
  const ny = ux;
  const ax0 = t1x - ux * 1;
  const ay0 = t1y - uy * 1;
  poly(
    p,
    [
      [ax0 - nx * 0.5, ay0 - ny * 0.5],
      [ax0 - nx * 5 - ux * 3, ay0 - ny * 5 - uy * 3],
      [ax0 - nx * 6.5 + ux * 1, ay0 - ny * 6.5 + uy * 1],
      [ax0 - nx * 5 + ux * 4, ay0 - ny * 5 + uy * 4],
      [ax0 - nx * 0.5 + ux * 2.5, ay0 - ny * 0.5 + uy * 2.5],
    ],
    (x, y) => {
      const e = -((x - ax0) * nx + (y - ay0) * ny);
      return e > 5 ? hx('#e0dce8') : e > 3 ? EXE.iron[2] : EXE.iron[1];
    },
  );
  p.outline(INK);
  // Прорези колпака — красные глаза.
  p.set(Math.round(hdx + 1), Math.round(hdy), EYE);
  p.set(Math.round(hdx + 3), Math.round(hdy), EYE);
  p.set(Math.round(hdx + 2), Math.round(hdy), hx('#2a0806'));
  return { p, ax: 20, ay: G, eye: [Math.round(hdx + 3), Math.round(hdy)] };
}

registerMobPainter('f10_exec', (m: Mob, pose: MobPose) => {
  const mode = pose.mode;
  const f = pose.frame;
  let anim = 'idle';
  let fr = 0;
  let ep: ExePose = { axe: -0.7, ball: 1.5, ballR: 5, over: false, bob: 0, step: 0 };
  if (mode === 'dying') {
    anim = 'dead';
    fr = deathK(pose);
    ep = { ...ep, dead: true };
  } else if (mode === 'flail') {
    anim = 'flail';
    fr = Math.floor(pose.t * 12) % 6;
    ep = { axe: 0.4, ball: (fr / 6) * TAU, ballR: 7, over: true, bob: 0, step: 0 };
  } else if (mode === 'chop') {
    anim = 'chop';
    fr = pose.t < 0.6 ? 0 : 1;
    ep = { axe: fr ? -1.95 : -1.75, ball: 1.8, ballR: 5, over: false, bob: fr ? 1 : 0, step: -1 };
  } else if (mode === 'recover' && pose.t < 0.3) {
    anim = 'hit';
    ep = { axe: 0.9, ball: 1.2, ballR: 5, over: false, bob: 2, step: 1 };
  } else if (mode === 'f10_stand' || mode === 'alertpost') {
    anim = 'stand';
    fr = f % 4;
    ep = {
      axe: 1.3,
      ball: 1.57 + Math.sin(fr) * 0.2,
      ballR: 5,
      over: false,
      bob: fr === 2 ? 1 : 0,
      step: 0,
    };
  } else if (pose.anim === 'run') {
    anim = 'run';
    fr = f % 4;
    ep = {
      axe: -0.6,
      ball: 1.57 + [0.4, 0, -0.4, 0][fr],
      ballR: 5,
      over: false,
      bob: fr % 2,
      step: [2, 0, -2, 0][fr],
    };
  } else if (pose.anim === 'hurt') {
    anim = 'hurt';
    ep = { axe: -1.2, ball: 2.2, ballR: 5, over: false, bob: 1, step: -1 };
  } else {
    anim = 'idle';
    fr = f % 4;
    ep = {
      axe: -0.7,
      ball: 1.57 + [0.25, 0.1, -0.15, 0.1][fr],
      ballR: 5,
      over: false,
      bob: fr === 1 || fr === 2 ? 1 : 0,
      step: 0,
    };
  }
  return frameOf('f10_exec', pose, anim, fr, () => {
    const b = drawExec(ep);
    if (anim === 'dead') b.p = ashen(b.p, fr, m.id % 5);
    return b;
  });
});

// ---------------------------------------------------------------------------
// Имп-носильщик: красный бес с мешком золота за плечом. Кадр 22×20,
// земля — ряд 18.
// ---------------------------------------------------------------------------

const IMP = {
  skin: tn('#3a0808', '#7a1814', '#b8322a', '#e8664a'),
  sack: tn('#2a1c0e', '#5a3e1e', '#8a6232', '#b8904e'),
  gold: [hx('#8a5a10'), hx('#e0a830'), hx('#fff0a0')],
};

function drawImp(bob: number, legs: number, coin: number, dead: boolean): Built {
  const p = new Px(22, 22);
  const G = 19;
  if (dead) {
    shadeEll(p, 10, G - 2, 5, 2, IMP.skin);
    shadeEll(p, 15, G - 3, 4, 3, IMP.sack);
    p.outline(INK);
    for (let i = 0; i < 4; i++) p.set(8 + i * 3, G - (i % 2), IMP.gold[1]);
    return { p, ax: 10, ay: G, eye: null };
  }
  const cy = G - 6 + bob;
  // Мешок за плечом — больше самого беса.
  shadeEll(p, 7, cy - 3, 5, 4.4, IMP.sack, 0.05);
  p.set(4, cy - 6, IMP.sack[3]);
  // Ноги, хвост.
  limb(p, 10, cy + 2, 9 - legs, G - 1, 1.1, 0.9, IMP.skin);
  limb(p, 12, cy + 2, 13 + legs, G - 1, 1.1, 0.9, IMP.skin);
  limb(p, 9, cy + 1, 5, cy + 4, 0.7, 0.5, IMP.skin);
  // Тело и голова.
  shadeEll(p, 11, cy, 2.8, 3, IMP.skin, 0.05);
  shadeEll(p, 13, cy - 4, 3.4, 3, IMP.skin, 0.1);
  // Рожки и уши.
  limb(p, 12, cy - 6.5, 10.5, cy - 9, 0.7, 0.3, HORN);
  limb(p, 14.5, cy - 6.5, 15.5, cy - 9, 0.7, 0.3, HORN);
  poly(
    p,
    [
      [16, cy - 5],
      [19, cy - 7],
      [16.5, cy - 3],
    ],
    IMP.skin[2],
  );
  // Рука на горловине мешка.
  limb(p, 11, cy - 1, 8, cy - 6, 0.8, 0.6, IMP.skin);
  p.outline(INK);
  // Ухмылка, глаз, монеты сыплются.
  p.set(15, cy - 5, hx('#ffd040'));
  for (let x = 13; x <= 16; x++) p.set(x, cy - 3, hx('#1a0404'));
  p.set(14, cy - 3, WHITE);
  p.set(16, cy - 3, WHITE);
  const cyy = Math.round(cy - 8 + coin);
  p.set(4, cyy, IMP.gold[1]);
  p.set(5, cyy, IMP.gold[2]);
  p.set(3, Math.round(cy - 1 + coin * 0.5), IMP.gold[1]);
  return { p, ax: 11, ay: G, eye: [15, cy - 5] };
}

registerMobPainter('f10_imp', (m: Mob, pose: MobPose) => {
  const mode = pose.mode;
  if (mode === 'f10_puff') return null;
  let anim = 'run';
  let fr = pose.frame % 4;
  if (mode === 'dying') {
    anim = 'dead';
    fr = deathK(pose);
  } else if (pose.anim === 'idle') {
    anim = 'idle';
  }
  return frameOf('f10_imp', pose, anim, fr, () => {
    const b =
      anim === 'dead'
        ? drawImp(0, 0, 0, true)
        : drawImp([0, -1, 0, -1][fr], anim === 'run' ? [1, 0, -1, 0][fr] : 0, fr, false);
    if (anim === 'dead') b.p = ashen(b.p, fr, m.id % 5);
    return b;
  });
});

// ---------------------------------------------------------------------------
// Горгулья — нарисована кодом (тайл DCSS war_gargoyle — неясной лицензии). Статуя
// и живая — одна картинка: каменная стоит на постаменте с тёмными
// глазами; живая дышит, глаза горят, крылья ходят. Кадр 36×64 (запас на
// прыжок), земля — ряд 60.
// ---------------------------------------------------------------------------

/** Глаза горгульи — две точки (для света в темноте и тления у статуи). */
const gargEyes: [number, number][] = [
  [14, 9],
  [18, 9],
];

let gargCache: Px | null = null;

/**
 * Горгулья 32×32 анфас, как сидит на карнизе: рога, уши, клыкастая пасть,
 * сгорбленные плечи, крылья летучей мыши подняты и раскрыты (столбцы
 * x < 9 и x > 23 — крылья, их двигает `wingShift`), лапы с когтями
 * держат край постамента, ноги поджаты, хвост обвивает. Свет слева-сверху.
 */
function gargBase(): Px {
  if (gargCache) return gargCache;
  const p = new Px(32, 32);
  const SKIN = tn('#141016', '#2a2430', '#453c4c', '#6c6074');
  const DARK = tn('#0e0b10', '#1c1720', '#2e2634', '#453c4c');
  const MEMB = tn('#1a0e14', '#2e1820', '#46242e', '#643844');
  const CLAW = tn('#3a3026', '#6a5c48', '#a8987a', '#dcd0b4');
  // Крылья: кость от плеча к запястью, пальцы веером вниз, перепонка
  // между пальцами с зубчатым краем.
  for (const s of [-1, 1]) {
    const cx = 16;
    const sh: [number, number] = [cx + s * 5, 12];
    const wr: [number, number] = [cx + s * 13, 2];
    const tips: [number, number][] = [
      [cx + s * 15.5, 10],
      [cx + s * 14, 17],
      [cx + s * 10.5, 21],
      [cx + s * 7, 19],
    ];
    // Перепонка: веер от запястья по кончикам, край — дугами внутрь.
    for (let k = 0; k < tips.length; k++) {
      const a = k === 0 ? wr : tips[k - 1];
      const b = tips[k];
      poly(p, [wr, a, [(a[0] + b[0]) / 2 - s * 0.9, (a[1] + b[1]) / 2 - 1.2], b], (x, y) =>
        tone(MEMB, 0.5 - (y - 2) * 0.02 + (s < 0 ? 0.12 : -0.12) + ((x + y) % 5 === 0 ? -0.2 : 0)),
      );
    }
    poly(p, [sh, wr, tips[tips.length - 1], [cx + s * 5, 18]], (x, y) =>
      tone(MEMB, 0.45 - (y - 2) * 0.02 + (s < 0 ? 0.12 : -0.12)),
    );
    // Кость крыла и пальцы — светлые рёбра.
    limb(p, sh[0], sh[1], wr[0], wr[1], 1.3, 0.8, SKIN, 0.1);
    for (const t of tips) limb(p, wr[0], wr[1], t[0], t[1], 0.55, 0.35, DARK, 0.25);
    // Коготь на запястье.
    p.set(Math.round(wr[0] + s * 0.6), wr[1] - 1, CLAW[2]);
  }
  // Хвост: из-за спины направо, кончик — наконечник.
  const tail = spline(
    [
      [19, 26],
      [24, 29],
      [27, 27],
      [28, 23],
    ],
    4,
  );
  tail.forEach(([x, y], n) => {
    const r = 1.3 - (n / tail.length) * 0.8;
    shadeEll(p, x, y, r, r, DARK, 0.1);
  });
  poly(
    p,
    [
      [27, 23],
      [29.5, 20.5],
      [29, 24],
    ],
    DARK[2],
  );
  // Ноги поджаты: бёдра по бокам, ступни с когтями у края.
  for (const s of [-1, 1]) {
    shadeEll(p, 16 + s * 5.5, 24, 3.2, 3.6, SKIN, s < 0 ? 0.05 : -0.1);
    limb(p, 16 + s * 6, 26, 16 + s * 5, 29.5, 1.6, 1.3, SKIN, -0.05);
    for (const dx of [-1, 0, 1]) p.set(16 + s * 5 + dx, 31, CLAW[dx === 0 ? 2 : 1]);
  }
  // Торс: сгорбленный, грудь широкая, живот ребристый.
  shadeEll(p, 16, 18, 5.4, 6, SKIN, 0.05);
  for (const y of [21, 23]) for (let x = 14; x <= 18; x++) if (p.get(x, y)[3]) p.set(x, y, SKIN[1]);
  // Плечи горбом над головой.
  for (const s of [-1, 1]) shadeEll(p, 16 + s * 4.6, 13, 2.8, 2.4, SKIN, s < 0 ? 0.1 : -0.05);
  // Руки: от плеч вниз, лапы держат край постамента.
  for (const s of [-1, 1]) {
    limb(p, 16 + s * 5.5, 14, 16 + s * 4.5, 22, 1.5, 1.2, SKIN, s < 0 ? 0.05 : -0.1);
    limb(p, 16 + s * 4.5, 22, 16 + s * 2.5, 27, 1.2, 1.1, SKIN, -0.05);
    for (const dx of [-1, 0, 1]) {
      p.set(16 + s * 2.5 + dx, 28, CLAW[1]);
      p.set(16 + s * 2.5 + dx, 29, dx ? CLAW[2] : CLAW[3]);
    }
  }
  // Голова: вытянутая морда вниз, уши торчком, рога назад-вверх.
  for (const s of [-1, 1]) {
    // Рог — дугой наружу и вверх.
    const horn = spline(
      [
        [16 + s * 2.5, 6],
        [16 + s * 4.5, 3.5],
        [16 + s * 5, 1],
        [16 + s * 4, -0.5],
      ],
      4,
    );
    horn.forEach(([x, y], n) => {
      const r = 1.2 - (n / horn.length) * 0.8;
      shadeEll(p, x, y, r, r, HORN, s < 0 ? 0.1 : -0.1);
    });
    // Ухо — острый треугольник.
    poly(
      p,
      [
        [16 + s * 3.5, 7],
        [16 + s * 7, 5],
        [16 + s * 4.5, 9],
      ],
      s < 0 ? SKIN[2] : SKIN[1],
    );
  }
  shadeEll(p, 16, 9, 4, 3.6, SKIN, 0.08);
  // Морда и пасть с клыками.
  shadeEll(p, 16, 11.5, 2.8, 2, SKIN, 0.02);
  for (let x = 14; x <= 18; x++) p.set(x, 12, hx('#1a0608'));
  p.set(14, 13, CLAW[3]);
  p.set(18, 13, CLAW[3]);
  p.set(15, 12, CLAW[2]);
  p.set(17, 12, CLAW[2]);
  // Надбровье и ноздри.
  for (let x = 13; x <= 19; x++) if (x !== 16) p.set(x, 8, SKIN[x < 16 ? 3 : 2]);
  p.set(15, 11, INK);
  p.set(17, 11, INK);
  p.outline(INK);
  // Глаза поверх контура — красные угли.
  for (const [x, y] of gargEyes) p.set(x, y, EYE);
  gargCache = p;
  return p;
}

/** Камень: глаза погасли, кожа серее. */
function stoneOf(p: Px, k: number): Px {
  const o = new Px(p.w, p.h);
  for (let i = 0; i < p.data.length; i += 4) {
    if (!p.data[i + 3]) continue;
    const r = p.data[i];
    const g = p.data[i + 1];
    const b = p.data[i + 2];
    const l = r * 0.3 + g * 0.55 + b * 0.15;
    const red = r > 120 && r > g * 2;
    const t = red ? [l * 0.5, l * 0.5, l * 0.55] : [l * 1.05, l * 1.02, l * 0.98];
    o.data[i] = r + (t[0] - r) * k;
    o.data[i + 1] = g + (t[1] - g) * k;
    o.data[i + 2] = b + (t[2] - b) * k;
    o.data[i + 3] = 255;
  }
  return o;
}

/** Сдвинуть столбцы крыльев по вертикали (взмах). */
function wingShift(p: Px, dy: number): Px {
  if (!dy) return p;
  const o = new Px(p.w, p.h);
  o.data.set(p.data);
  const cols = (x: number) => x < 9 || x > 23;
  for (let x = 0; x < p.w; x++) {
    if (!cols(x)) continue;
    for (let y = 0; y < p.h; y++) o.data[(y * p.w + x) * 4 + 3] = 0;
    for (let y = 0; y < 22; y++) {
      const sy = y - dy;
      if (sy < 0 || sy >= p.h) continue;
      const i = (sy * p.w + x) * 4;
      if (!p.data[i + 3]) continue;
      const j = (y * p.w + x) * 4;
      o.data[j] = p.data[i];
      o.data[j + 1] = p.data[i + 1];
      o.data[j + 2] = p.data[i + 2];
      o.data[j + 3] = 255;
    }
    for (let y = 22; y < p.h; y++) {
      const i = (y * p.w + x) * 4;
      if (!p.data[i + 3]) continue;
      o.data[i] = p.data[i];
      o.data[i + 1] = p.data[i + 1];
      o.data[i + 2] = p.data[i + 2];
      o.data[i + 3] = 255;
    }
  }
  return o;
}

/** Трещины с жаром по камню (оживает): доля k 0…1. */
function gargCracks(p: Px, k: number, seed: number): void {
  const hot = [hx('#8a1a06'), hx('#e05010'), hx('#ffa030')];
  for (let n = 0; n < 5; n++) {
    let x = 10 + Math.floor(hash(n, seed) * 12);
    let y = 6 + Math.floor(hash(n, seed, 2) * 18);
    const len = Math.floor(3 + hash(n, seed, 3) * 6 * k);
    for (let i = 0; i < len; i++) {
      if (p.get(x, y)[3]) p.set(x, y, hot[Math.min(2, Math.floor(k * 3))]);
      x += hash(n, i, seed) > 0.5 ? 1 : -1;
      y += hash(i, n, seed) > 0.4 ? 1 : 0;
    }
  }
}

interface GargPose {
  stone: number;
  wing: number;
  bob: number;
  lean: number;
  z: number;
  cracks: number;
  eyes: boolean;
  plinth: boolean;
  dead?: number;
}

function drawGarg(gp: GargPose, seed: number): Built {
  let p = gargBase();
  if (gp.stone > 0) p = stoneOf(p, gp.stone);
  p = wingShift(p, gp.wing);
  if (gp.cracks > 0) gargCracks(p, gp.cracks, seed);
  if (gp.eyes)
    for (const [x, y] of gargEyes) p.set(x, y, gp.stone > 0.5 ? hx('#ff6a3a') : hx('#ff3a2a'));
  else if (gp.stone > 0) for (const [x, y] of gargEyes) p.set(x, y, hx('#1a1418'));
  if (gp.lean) {
    // Наклон вперёд или назад: ряды сверху сдвинуты сильнее.
    for (let y = 0; y < 24; y++) shiftRows(p, y, y + 1, Math.round((gp.lean * (24 - y)) / 24));
  }
  const W = 36;
  const H = 64;
  const G = 60;
  const lift = gp.plinth ? 4 : 0;
  const oy = G - 32 + gp.bob - lift - Math.round(gp.z);
  let out = copyAt(p, W, H, 2, oy);
  if (gp.dead) out = ashen(out, gp.dead, seed);
  const e = gargEyes[0];
  return { p: out, ax: 18, ay: G, eye: gp.eyes ? [e[0] + 3, e[1] + oy] : null };
}

registerMobPainter('f10_gargoyle', (m: Mob, pose: MobPose) => {
  const mode = pose.mode;
  const f = pose.frame;
  let anim = 'idle';
  let fr = 0;
  const base: GargPose = {
    stone: 0,
    wing: 0,
    bob: 0,
    lean: 0,
    z: 0,
    cracks: 0,
    eyes: true,
    plinth: false,
  };
  let gp = base;
  if (mode === 'dying') {
    anim = 'dead';
    fr = deathK(pose);
    gp = { ...base, stone: 0.6, dead: fr, eyes: false };
  } else if (mode === 'f10_stone') {
    anim = 'stone';
    // Живая выдаёт себя: раз в несколько секунд глаза тлеют.
    fr = Math.floor(f / 3) % 7 === 0 ? 1 : 0;
    gp = { ...base, stone: 1, eyes: fr === 1, plinth: true };
  } else if (mode === 'f10_wake') {
    anim = 'wake';
    fr = Math.min(3, Math.floor(pose.t / 0.21));
    gp = {
      ...base,
      stone: 1 - fr * 0.25,
      cracks: (fr + 1) / 4,
      eyes: fr >= 1,
      plinth: fr < 3,
      wing: fr === 3 ? -1 : 0,
    };
  } else if (mode === 'f10_petrify') {
    anim = 'petrify';
    fr = Math.min(3, Math.floor(pose.t / 0.4));
    gp = { ...base, stone: 0.4 + fr * 0.2, cracks: 1 - fr * 0.3, eyes: true };
  } else if (mode === 'leap') {
    anim = 'leap';
    const z = Math.round((m.data.z ?? 0) * 8);
    fr = z;
    gp = { ...base, z: z, wing: -2, lean: 1 };
  } else if (mode === 'claw') {
    anim = 'claw';
    fr = pose.t < 0.3 ? 0 : 1;
    gp = { ...base, lean: fr ? 3 : -2, wing: fr ? 1 : -1 };
  } else if (mode === 'recover' && pose.t < 0.25) {
    anim = 'strike';
    gp = { ...base, lean: 3, bob: 1, wing: 2 };
  } else if (pose.anim === 'run') {
    anim = 'run';
    fr = f % 4;
    gp = { ...base, bob: [0, -1, 0, 1][fr], wing: [0, -1, 0, 1][fr], lean: 1 };
  } else if (pose.anim === 'hurt') {
    anim = 'hurt';
    gp = { ...base, lean: -2, wing: 1 };
  } else {
    anim = 'idle';
    fr = f % 4;
    gp = { ...base, wing: [0, -1, -1, 0][fr], bob: fr === 2 ? 1 : 0 };
  }
  const key = `f10_gargoyle|${anim}|${fr}|${pose.left ? 1 : 0}|${pose.flash ? 1 : 0}|${pose.look}`;
  const hit = frames.get(key);
  if (hit) return hit;
  const b = drawGarg(gp, m.id % 7);
  return finish(key, b, pose.look, pose.flash, pose.left);
});

// ---------------------------------------------------------------------------
// Король демонов (v2.86 — анимация тела). Облик прежний: чёрные латы с
// золотой каймой, багровый плащ, рогатая корона, белые волосы, глаза-угли,
// двуручный чёрный меч с кровавой кромкой; с фазы 2 — крылья.
//
// Тело — риг: поза — набор чисел (таз, наклон, ступни, хват меча, крылья,
// плащ…), техника — ключевые позы по времени с кривыми разгона и
// торможения, кадр — поза в момент `floor(t · 24) / 24`, а кадр, в
// который мозг наносит урон, — ровно в этот миг. Меч живёт в 3D (хват и
// направление клинка), проекция — вид 3/4 сверху: горизонтальное
// рассечение ложится на экран эллипсом, рубка — дугой в плоскости экрана.
// След меча — выборки той же позы в прошлом, полумесяцем.
// На троне, в сценах фаз и в грозе — анфас, в бою — профиль.
// Рисуется в свой быстрый растр (Uint32), кадры — в `frameLRU`, прогрев —
// `registerMobWarm`. Мозг — метроном: тайминги берутся из `KING`.
// ---------------------------------------------------------------------------

const KG = {
  armor: tn('#0e0c12', '#1e1a24', '#363040', '#5e5468'),
  gold: GOLD,
  cape: tn('#2a0408', '#520a10', '#86161c', '#b8282c'),
  capeIn: tn('#120204', '#240408', '#3a080c', '#520c12'),
  hair: tn('#6a6278', '#a8a0b8', '#d4cee0', '#f4f0fa'),
  face: tn('#1a0e10', '#2e1a1c', '#4a2c2c', '#6a4040'),
  wing: tn('#0a0608', '#1a0e14', '#2e1822', '#4a2432'),
  vein: hx('#8a1c26'),
  blade: tn('#0e0c10', '#26222c', '#4a4452', '#8a8296'),
  edge: hx('#ff3a2a'),
  gem: hx('#ff2a2a'),
};

// ---- Быстрый растр: Uint32 поверх `Px` (порядок байт — RGBA в памяти). ----

const c32 = (c: RGBA): number => ((c[3] << 24) | (c[2] << 16) | (c[1] << 8) | c[0]) >>> 0;
type T4 = [number, number, number, number];
const t4 = (t: Tones): T4 => [c32(t[0]), c32(t[1]), c32(t[2]), c32(t[3])];
const lv = (t: T4, l: number): number =>
  l > 0.78 ? t[3] : l > 0.42 ? t[2] : l > 0.02 ? t[1] : t[0];

const K4 = {
  armor: t4(KG.armor),
  armorFar: t4(tn('#08060a', '#141018', '#26202c', '#3a3242')),
  gold: t4(GOLD),
  cape: t4(KG.cape),
  capeIn: t4(KG.capeIn),
  hair: t4(KG.hair),
  face: t4(KG.face),
  wing: t4(KG.wing),
  wingFar: t4(tn('#060406', '#10080c', '#1c0e14', '#2a141c')),
  bone: t4(tn('#2a1a20', '#4a3038', '#6e4a54', '#94707a')),
  boneFar: t4(tn('#1a1016', '#2a1a22', '#3a2630', '#4a3440')),
  blade: t4(KG.blade),
  horn: t4(tn('#0a080a', '#1c181c', '#34303a', '#5a5462')),
  spike: t4(HORN),
};
const C = {
  ink: c32(INK),
  gem: c32(KG.gem),
  gemHi: c32(hx('#ffb0a0')),
  eyeHi: c32(hx('#ffb080')),
  eyeLid: c32(hx('#ff9070')),
  edge: c32(hx('#a0202a')),
  edgeHot: c32(hx('#ff3a2a')),
  edgeWhite: c32(hx('#ffd0a0')),
  rune: c32(hx('#7a1418')),
  runeHot: c32(hx('#ffb080')),
  grip: c32(hx('#2a1a14')),
  vein: c32(KG.vein),
  mouth: c32(hx('#ff5a2a')),
  mouthIn: c32(hx('#3a0404')),
  ember: c32(hx('#ff6a2a')),
  emberHi: c32(hx('#ffc070')),
  ash: c32(hx('#3a2a28')),
  ashLt: c32(hx('#5a4642')),
  arc: c32(hx('#e8dcff')),
  arcMid: c32(hx('#b890ff')),
  arcDim: c32(hx('#6a50c8')),
  smW: c32(hx('#fff4d8')),
  smY: c32(hx('#ffb060')),
  smR: c32(hx('#e8402c')),
  smD: c32(hx('#8a141c')),
};

/** Кадр 96×104, земля — ряд 92, середина тела — 46 (смотрит вправо). */
const KW = 96;
const KH = 104;
const KGY = 92;
const KX0 = 46;

class KB {
  readonly w: number;
  readonly h: number;
  readonly px: Px;
  readonly d: Uint32Array;
  used = false;
  constructor(w = KW, h = KH) {
    this.w = w;
    this.h = h;
    this.px = new Px(w, h);
    this.d = new Uint32Array(this.px.data.buffer, this.px.data.byteOffset, w * h);
  }
  /** Целые координаты. */
  set(x: number, y: number, c: number): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.d[y * this.w + x] = c;
    this.used = true;
  }
  /** Точка детали: округление, как у `Px.set`. */
  put(x: number, y: number, c: number): void {
    this.set(Math.round(x), Math.round(y), c);
  }
  /** Полупрозрачное поверх (для слоя света). */
  mix(x: number, y: number, c: number, a: number): void {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || a <= 0) return;
    const i = y * this.w + x;
    const o = this.d[i];
    const oa = (o >>> 24) / 255;
    const na = Math.min(1, a + oa * (1 - a));
    const k = a / (na || 1);
    const r = (c & 255) * k + (o & 255) * (1 - k);
    const g = ((c >>> 8) & 255) * k + ((o >>> 8) & 255) * (1 - k);
    const bl = ((c >>> 16) & 255) * k + ((o >>> 16) & 255) * (1 - k);
    this.d[i] =
      ((Math.round(na * 255) << 24) |
        (Math.round(bl) << 16) |
        (Math.round(g) << 8) |
        Math.round(r)) >>>
      0;
    this.used = true;
  }
  solid(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h && this.d[y * this.w + x] >>> 24 !== 0;
  }
}

/** Овал с объёмом (свет сверху-слева). */
function kEll(b: KB, cx: number, cy: number, rx: number, ry: number, t: T4, bias = 0): void {
  if (rx <= 0 || ry <= 0) return;
  const y0 = Math.floor(cy - ry - 1);
  const y1 = Math.ceil(cy + ry + 1);
  const x0 = Math.floor(cx - rx - 1);
  const x1 = Math.ceil(cx + rx + 1);
  for (let y = y0; y <= y1; y++) {
    const dy = (y + 0.5 - cy) / ry;
    for (let x = x0; x <= x1; x++) {
      const dx = (x + 0.5 - cx) / rx;
      const q = dx * dx + dy * dy;
      if (q > 1) continue;
      b.set(x, y, lv(t, dx * LX + dy * LY + Math.sqrt(1 - q) * LZ + bias));
    }
  }
}

/** Овал одним цветом. */
function kDisc(b: KB, cx: number, cy: number, rx: number, ry: number, c: number): void {
  for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++)
    for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1) b.set(x, y, c);
    }
}

/** Конечность — сужающаяся капсула со светом по нормали. */
function kCap(
  b: KB,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  r0: number,
  r1: number,
  t: T4,
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
      let k = ((px - x0) * dx + (py - y0) * dy) / L2;
      k = k < 0 ? 0 : k > 1 ? 1 : k;
      const ex = px - (x0 + dx * k);
      const ey = py - (y0 + dy * k);
      const r = r0 + (r1 - r0) * k;
      const d2 = ex * ex + ey * ey;
      if (d2 > r * r) continue;
      const nx = ex / (r || 1);
      const ny = ey / (r || 1);
      b.set(
        x,
        y,
        lv(t, nx * LX + ny * LY + Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny)) * LZ + bias),
      );
    }
}

const XS = new Float64Array(64);
/**
 * Многоугольник построчно: `fn(x, y, xa, xb)` — цвет точки; `xa…xb` — края
 * пролёта в этой строке (складки плаща идут от края, а не от экрана).
 */
function kPoly(
  b: KB,
  pts: number[],
  fn: number | ((x: number, y: number, xa: number, xb: number) => number),
): void {
  const n = pts.length >> 1;
  if (n < 3) return;
  let minY = 1e9;
  let maxY = -1e9;
  for (let i = 0; i < n; i++) {
    const y = pts[i * 2 + 1];
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const ya = Math.max(0, Math.floor(minY));
  const yb = Math.min(b.h - 1, Math.ceil(maxY));
  for (let y = ya; y <= yb; y++) {
    const py = y + 0.5;
    let m = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = pts[i * 2];
      const yi = pts[i * 2 + 1];
      const xj = pts[j * 2];
      const yj = pts[j * 2 + 1];
      if (yi > py !== yj > py && m < 64) XS[m++] = ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    }
    if (m < 2) continue;
    // Сортировка вставками — точек мало.
    for (let i = 1; i < m; i++) {
      const v = XS[i];
      let j = i - 1;
      while (j >= 0 && XS[j] > v) {
        XS[j + 1] = XS[j];
        j--;
      }
      XS[j + 1] = v;
    }
    for (let k = 0; k + 1 < m; k += 2) {
      const xa = XS[k];
      const xb = XS[k + 1];
      // Точка внутри, если её середина между краями.
      const x0 = Math.max(0, Math.ceil(xa - 0.5));
      const x1 = Math.min(b.w - 1, Math.floor(xb - 0.5));
      if (typeof fn === 'number') for (let x = x0; x <= x1; x++) b.set(x, y, fn);
      else for (let x = x0; x <= x1; x++) b.set(x, y, fn(x, y, xa, xb));
    }
  }
}

/** Линия (толщина 1 — пиксели, больше — диски). */
function kLine(b: KB, x0: number, y0: number, x1: number, y1: number, c: number, w = 1): void {
  const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2) + 1;
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    const y = y0 + ((y1 - y0) * i) / n;
    if (w <= 1) b.set(Math.floor(x), Math.floor(y), c);
    else kDisc(b, x, y, w / 2, w / 2, c);
  }
}

/** Контур снаружи фигуры одним проходом. */
function kOutline(b: KB, c: number): void {
  const { w, h, d } = b;
  const add: number[] = [];
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const i = row + x;
      if (d[i] >>> 24) continue;
      if (
        (x > 0 && d[i - 1] >>> 24) ||
        (x < w - 1 && d[i + 1] >>> 24) ||
        (y > 0 && d[i - w] >>> 24) ||
        (y < h - 1 && d[i + w] >>> 24)
      )
        add.push(i);
    }
  }
  for (const i of add) d[i] = c;
}

/** Жар по краю силуэта (слой света): власть, ярость, гроза. */
function kAura(b: KB, lit: KB, k: number): void {
  if (k <= 0.03) return;
  const { w, h, d } = b;
  const deep = c32(hx('#b01818'));
  for (let y = 2; y < h - 2; y++)
    for (let x = 2; x < w - 2; x++) {
      const i = y * w + x;
      if (d[i] >>> 24) continue;
      if (d[i - 1] >>> 24 || d[i + 1] >>> 24 || d[i - w] >>> 24 || d[i + w] >>> 24) {
        lit.mix(x, y, C.edgeHot, 0.62 * k);
        continue;
      }
      if (
        d[i - 2] >>> 24 ||
        d[i + 2] >>> 24 ||
        d[i - 2 * w] >>> 24 ||
        d[i + 2 * w] >>> 24 ||
        d[i - w - 1] >>> 24 ||
        d[i - w + 1] >>> 24 ||
        d[i + w - 1] >>> 24 ||
        d[i + w + 1] >>> 24
      )
        lit.mix(x, y, deep, 0.34 * k);
    }
}

/** Слой поверх другого (непрозрачные точки). */
function kOver(dst: KB, src: KB): void {
  const a = dst.d;
  const s = src.d;
  for (let i = 0; i < s.length; i++) if (s[i] >>> 24) a[i] = s[i];
  if (src.used) dst.used = true;
}

// ---- Геометрия ----

const clampK = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/**
 * Два звена: сустав между `a` и `b` (длины `l1`, `l2`), сгиб — в сторону
 * `pole`. Цель дальше досягаемого — прижимается (кисть не отрывается от
 * рукояти: хват правит вызывающий).
 */
function ik2(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  l1: number,
  l2: number,
  polx: number,
  poly: number,
): [number, number] {
  let dx = bx - ax;
  let dy = by - ay;
  let d = Math.hypot(dx, dy) || 1e-6;
  dx /= d;
  dy /= d;
  d = clampK(d, Math.abs(l1 - l2) + 0.01, l1 + l2 - 0.01);
  const ca = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
  const sa = Math.sqrt(Math.max(0, 1 - ca * ca));
  const e1x = ax + l1 * (dx * ca - dy * sa);
  const e1y = ay + l1 * (dy * ca + dx * sa);
  const e2x = ax + l1 * (dx * ca + dy * sa);
  const e2y = ay + l1 * (dy * ca - dx * sa);
  return (e1x - ax) * polx + (e1y - ay) * poly >= (e2x - ax) * polx + (e2y - ay) * poly
    ? [e1x, e1y]
    : [e2x, e2y];
}

/** Проекция вида 3/4: x — вперёд (вправо), y — вверх, z — к камере (вниз по экрану). */
const PZ = 0.5;
const projX = (x: number) => x;
const projY = (y: number, z: number) => -y + z * PZ;

/** Клинок: хват на экране, единичное направление, длина, глубина. */
interface Blade {
  gx: number;
  gy: number;
  ux: number;
  uy: number;
  len: number;
  /** Куда смотрит клинок по глубине (<0 — от камеры, за телом). */
  z: number;
}

/** Направление клинка по рысканию и тангажу → экран. */
function bladeDir(
  yaw: number,
  pit: number,
  L: number,
): { ux: number; uy: number; len: number; z: number } {
  const cp = Math.cos(pit);
  const x = cp * Math.cos(yaw);
  const y = Math.sin(pit);
  const z = cp * Math.sin(yaw);
  const sx = projX(x);
  const sy = projY(y, z);
  const n = Math.hypot(sx, sy);
  // Клинок в камеру: коротко, но не точкой.
  const len = Math.max(5, L * n);
  return n < 1e-3 ? { ux: 0, uy: 1, len, z } : { ux: sx / n, uy: sy / n, len, z };
}

// ---- Части тела ----

/** Двуручный меч от хвата: рукоять с навершием, золотая гарда, клинок с кровавой кромкой. */
function kSword(b: KB, lit: KB, bl: Blade, glow: number, clipY: number, rage: boolean): void {
  const { gx: x, gy: y, ux, uy, len } = bl;
  const nx = -uy;
  const ny = ux;
  // Рукоять укорачивается вместе с клинком (клинок к камере).
  const hk = clampK(len / 27, 0.35, 1);
  kLine(b, x - ux * 5 * hk, y - uy * 5 * hk, x, y, C.grip);
  kEll(b, x - ux * 6 * hk, y - uy * 6 * hk, 1.3, 1.3, K4.gold, 0.1);
  b.put(x - ux * 6 * hk, y - uy * 6 * hk, C.gem);
  // Гарда — золотые рога поперёк.
  const gw = 4;
  kLine(b, x - nx * gw - ux, y - ny * gw - uy, x + nx * gw - ux, y + ny * gw - uy, K4.gold[2], 1.6);
  b.put(x - nx * gw - ux * 2, y - ny * gw - uy * 2, K4.gold[3]);
  b.put(x + nx * gw - ux * 2, y + ny * gw - uy * 2, K4.gold[3]);
  // Клинок: широкий у гарды, к острию сужается.
  const pts = [
    x + nx * 2.2,
    y + ny * 2.2,
    x + ux * len * 0.8 + nx * 1.8,
    y + uy * len * 0.8 + ny * 1.8,
    x + ux * len,
    y + uy * len,
    x + ux * len * 0.8 - nx * 1.8,
    y + uy * len * 0.8 - ny * 1.8,
    x - nx * 2.2,
    y - ny * 2.2,
  ];
  const hot = glow > 0;
  const edgeC = hot ? (glow > 0.8 ? C.edgeWhite : C.edgeHot) : C.edge;
  const litEdge = glow > 0.25;
  const la = clampK(glow, 0, 1);
  kPoly(b, pts, (px, py) => {
    if (py > clipY) return 0;
    const e = (px + 0.5 - x) * nx + (py + 0.5 - y) * ny;
    const along = ((px - x) * ux + (py - y) * uy) / len;
    if (Math.abs(e) > 1.3) {
      if (litEdge) lit.mix(px, py, rage ? C.smY : C.edgeHot, 0.35 + la * 0.55);
      return edgeC;
    }
    return lv(K4.blade, 0.5 + e * 0.35 - along * 0.2);
  });
  // Вырезанное ниже земли (клинок в полу) — прозрачное.
  // Руны по долу.
  for (let i = 2; i < len * 0.7; i += 3) {
    const rx = x + ux * i;
    const ry = y + uy * i;
    if (ry > clipY) break;
    b.put(rx, ry, glow > 0.5 ? C.runeHot : C.rune);
    if (glow > 0.5) lit.mix(rx, ry, C.runeHot, 0.5 + la * 0.4);
  }
}

/** Голова: корона-рога, белые волосы, тёмное лицо, глаза-угли. Возвращает глаз. */
function kHead(
  b: KB,
  lit: KB,
  x: number,
  y: number,
  side: boolean,
  tilt: number,
  jaw: number,
  wind: number,
  eyes: number,
  nod = 0,
): [number, number] {
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  const ox = x;
  const oy = y + 1;
  const R = (px: number, py: number): [number, number] => {
    const dx = px - ox;
    const dy = py - oy;
    return [ox + dx * ct - dy * st, oy + dx * st + dy * ct];
  };
  // Волосы — за головой, до лопаток; ветер тянет их назад и вверх.
  for (let i = 0; i < 6; i++) {
    const off = side ? -1 - i * 0.6 : (i - 2.5) * 1.4;
    const wx = side ? -wind * (3 + i * 0.5) : off * wind * 0.4;
    const wy = -wind * (side ? 3 + (i % 3) : 4);
    const hair = spline(
      [
        R(x + off * 0.4, y - 3),
        R(x + off - (side ? 2 : 0) + wx * 0.3, y + 2 + wy * 0.3),
        R(x + off * 1.2 - (side ? 4 : 0) + wx * 0.7, y + 7 + (i % 2) + wy * 0.7),
        R(x + off * 1.3 - (side ? 5 : 0) + wx, y + 11 + (i % 3) + wy),
      ],
      4,
    );
    for (let n = 0; n < hair.length; n++)
      b.put(hair[n][0], hair[n][1], K4.hair[n % 4 === 0 ? 3 : n % 2 ? 2 : 1]);
  }
  const [fx, fy] = R(x, y);
  kEll(b, fx, fy, 3.8, 4.2, K4.face, 0.05);
  // Корона: золотой обод с зубцами.
  for (let dx = -4; dx <= 4; dx++) {
    const [ax, ay] = R(x + dx, y - 3);
    b.put(ax, ay, K4.gold[dx < 0 ? 1 : 2]);
    if (dx % 2 === 0) {
      const [bx2, by2] = R(x + dx, y - 4);
      b.put(bx2, by2, K4.gold[3]);
    }
  }
  const [tx, ty] = R(x, y - 5);
  b.put(tx, ty, K4.gold[3]);
  const [gx2, gy2] = R(x, y - 4);
  b.put(gx2, gy2, C.gem);
  // Рога — большие, изогнутые.
  const horn = (s: number) => {
    const pts = spline(
      [R(x + s * 2.5, y - 3), R(x + s * 6, y - 6), R(x + s * 6.5, y - 11), R(x + s * 4.5, y - 14)],
      4,
    );
    for (let n = 0; n < pts.length; n++) {
      const r = 1.6 * (1 - n / pts.length) + 0.4;
      kEll(b, pts[n][0], pts[n][1], r, r, K4.horn);
    }
  };
  if (side) {
    horn(-1);
    horn(0.6);
  } else {
    horn(-1);
    horn(1);
  }
  // Лицо: глаза и пасть.
  const ex = side ? x + 1.5 : x;
  // Анфас: запрокинул голову — глаза и пасть ближе к короне, опустил — ниже.
  const ey = y + 0.5 - jaw * 1 + (side ? 0 : nod * 1.8);
  const eg = eyes >= 2 ? C.emberHi : C.gem;
  let eye: [number, number];
  if (side) {
    const [e1x, e1y] = R(ex + 1, ey);
    const [e2x, e2y] = R(ex + 2, ey);
    b.put(e1x, e1y, eg);
    b.put(e2x, e2y, C.eyeHi);
    eye = [Math.round(e1x), Math.round(e1y)];
    // Обычный взгляд светит сам движок (`eye`); слой света — когда угли разгораются.
    if (eyes >= 2) {
      lit.mix(e1x, e1y, eg, 0.9);
      lit.mix(e2x, e2y, C.eyeHi, 0.9);
      // Угли разгораются: отсвет и искра назад по ходу головы.
      lit.mix(e2x + 1, e2y, C.ember, 0.45);
      lit.mix(e1x, e1y - 1, C.ember, 0.35);
      if (eyes >= 3) {
        lit.mix(e1x - 1, e1y, C.ember, 0.6);
        lit.mix(e1x - 2, e1y - 1, C.ember, 0.35);
      }
    }
  } else {
    const [l1x, l1y] = R(ex - 1.5, ey);
    const [r1x, r1y] = R(ex + 1.5, ey);
    const [l2x, l2y] = R(ex - 1.5, ey - 1);
    const [r2x, r2y] = R(ex + 1.5, ey - 1);
    b.put(l1x, l1y, eg);
    b.put(r1x, r1y, eg);
    b.put(l2x, l2y, C.eyeLid);
    b.put(r2x, r2y, C.eyeLid);
    eye = [Math.round(l1x), Math.round(l1y)];
    if (eyes >= 2) {
      lit.mix(l1x, l1y, eg, 0.9);
      lit.mix(r1x, r1y, eg, 0.9);
      lit.mix(l2x, l2y, C.ember, 0.5);
      lit.mix(r2x, r2y, C.ember, 0.5);
      if (eyes >= 3) {
        lit.mix(l1x - 1, l1y, C.ember, 0.4);
        lit.mix(r1x + 1, r1y, C.ember, 0.4);
      }
    }
  }
  if (jaw > 0.2) {
    // Пасть: тёмный провал и угли внутри; шире — сильнее рёв.
    const w = jaw > 0.65 ? 2 : 1;
    const hgt = jaw > 0.65 ? 2 : 1;
    const mx = side ? ex + 1.5 : ex;
    for (let dy = 0; dy < hgt; dy++)
      for (let dx = -w; dx <= w - (side ? 1 : 0); dx++) {
        const [px, py] = R(mx + dx, ey + 2.5 + dy);
        const inner = dy > 0 || Math.abs(dx) < w;
        b.put(px, py, inner && jaw > 0.65 ? C.mouthIn : C.mouth);
        if (!inner || jaw <= 0.65) lit.mix(px, py, C.mouth, 0.7);
      }
    if (jaw > 0.65) {
      const [px, py] = R(mx, ey + 3.5);
      lit.mix(px, py, C.ember, 0.8);
    }
  } else if (jaw > 0.05) {
    for (let dx = -1; dx <= 1; dx++) {
      const [px, py] = R(ex + dx + (side ? 1 : 0), ey + 2.5);
      b.put(px, py, C.mouth);
    }
  }
  return eye;
}

/**
 * Крыло: плечо → локоть → запястье, три пальца веером и перепонка с
 * фестонами между ними. `s` — куда раскрывается (+1 вправо, −1 влево),
 * `wf` — взмах (+ вниз), `open` 0 — сложено за спиной, 1 — настежь.
 */
function kWing(
  b: KB,
  rx: number,
  ry: number,
  s: number,
  wf: number,
  open: number,
  L: number,
  far: boolean,
): void {
  const t = far ? K4.wingFar : K4.wing;
  const bone = far ? K4.boneFar : K4.bone;
  const o = clampK(open, 0, 1);
  const a = -Math.PI / 2 + s * (0.55 + 0.25 * o) + s * wf;
  const ex = rx + Math.cos(a) * L * 0.36;
  const ey = ry + Math.sin(a) * L * 0.36;
  // Предплечье: сложенное — назад и вниз вдоль руки, раскрытое — наружу.
  const a2 = a + s * (2.75 - 2.3 * o);
  const wx = ex + Math.cos(a2) * L * 0.34;
  const wy = ey + Math.sin(a2) * L * 0.34;
  const spread = 0.12 + 0.88 * o;
  const tips: number[] = [];
  for (let k = 0; k < 3; k++) {
    const fa = a2 + s * (0.25 + k * 0.62 * spread);
    const fl = L * (0.62 - k * 0.1) * (0.6 + 0.4 * o);
    tips.push(wx + Math.cos(fa) * fl, wy + Math.sin(fa) * fl);
  }
  // Крепление к спине — ниже плеча.
  const bx = rx - s * 1;
  const by = ry + L * (0.22 + 0.12 * o);
  // Перепонка с фестонами: между концами пальцев край прогибается к запястью.
  const mem: number[] = [rx, ry, ex, ey, wx, wy, tips[0], tips[1]];
  for (let k = 0; k < 2; k++) {
    const mx = (tips[k * 2] + tips[k * 2 + 2]) / 2;
    const my = (tips[k * 2 + 1] + tips[k * 2 + 3]) / 2;
    mem.push(mx + (wx - mx) * 0.28, my + (wy - my) * 0.28, tips[k * 2 + 2], tips[k * 2 + 3]);
  }
  const lx = (tips[4] + bx) / 2;
  const ly = (tips[5] + by) / 2;
  mem.push(lx + (wx - lx) * 0.3, ly + (wy - ly) * 0.3, bx, by);
  kPoly(b, mem, (x, y) => {
    const d = Math.hypot(x - rx, y - ry) / L;
    const vein = (((x * 3 + y) % 7) + 7) % 7 === 0 ? -0.15 : 0;
    return lv(t, 0.62 - d * 0.5 + vein);
  });
  // Жилы в перепонке — от запястья к фестонам.
  if (!far)
    for (let k = 0; k < 3; k++) {
      const mx = (wx + tips[k * 2]) / 2 + (bx - wx) * 0.15;
      const my = (wy + tips[k * 2 + 1]) / 2 + (by - wy) * 0.15;
      b.put(mx, my, C.vein);
      b.put((mx + tips[k * 2]) / 2, (my + tips[k * 2 + 1]) / 2, C.vein);
    }
  kCap(b, rx, ry, ex, ey, 1.6, 1.2, bone);
  kCap(b, ex, ey, wx, wy, 1.2, 0.9, bone);
  for (let k = 0; k < 3; k++) kLine(b, wx, wy, tips[k * 2], tips[k * 2 + 1], bone[2]);
  // Коготь на сгибе — вверх.
  kCap(b, wx, wy, wx - s * 0.5, wy - 3, 0.8, 0.3, K4.spike);
}

/** Плоская грань со светом по положению (как `polyShade`). */
function kPolyShade(b: KB, pts: number[], t: T4, bias = 0): void {
  const n = pts.length >> 1;
  let cx = 0;
  let cy = 0;
  let r = 1;
  for (let i = 0; i < n; i++) {
    cx += pts[i * 2];
    cy += pts[i * 2 + 1];
  }
  cx /= n;
  cy /= n;
  for (let i = 0; i < n; i++) r = Math.max(r, Math.hypot(pts[i * 2] - cx, pts[i * 2 + 1] - cy));
  kPoly(b, pts, (x, y) => lv(t, ((x + 0.5 - cx) * LX + (y + 0.5 - cy) * LY) / r + 0.45 + bias));
}

/** Латная ступня: клин носком вперёд (`s` — куда смотрит). */
function kSabaton(b: KB, fx: number, fy: number, s: number, t: T4): void {
  kPoly(
    b,
    [fx - 2 * s, fy - 2.5, fx + 2 * s, fy - 2.5, fx + 5 * s, fy + 0.5, fx - 2.5 * s, fy + 0.5],
    (x, y) => lv(t, 0.55 - (y - fy) * 0.12 + (x - fx) * s * 0.02),
  );
  kLine(b, fx - 2 * s, fy, fx + 4 * s, fy, t[2]);
}

/** Латная перчатка с золотой костяшкой. */
function kFist(b: KB, x: number, y: number, t: T4, gold: boolean): void {
  kEll(b, x, y, 2, 1.8, t, 0.2);
  if (gold) b.put(x + 0.5, y - 1, K4.gold[2]);
}

// ---- След меча: полумесяц по выборкам клинка в прошлом ----

/** `sm[0]` — сейчас, дальше — назад во времени. */
function kSmear(b: KB, lit: KB, sm: Blade[], clipY: number): void {
  const n = sm.length - 1;
  if (n < 1) return;
  const tip = (s: Blade, f: number): [number, number] => [
    s.gx + s.ux * s.len * f,
    s.gy + s.uy * s.len * f,
  ];
  for (let i = n - 1; i >= 0; i--) {
    const A = sm[i];
    const B = sm[i + 1];
    // Клинок за телом — его след тоже там: не рисуем поверх тела.
    if (A.z < -0.45 && B.z < -0.45) continue;
    const [ax, ay] = tip(A, 1);
    const [bx, by] = tip(B, 1);
    if (Math.hypot(ax - bx, ay - by) < 2.2) continue;
    const ka = i / n;
    const kb = (i + 1) / n;
    // Полумесяц: у свежего края полоса во весь клинок, к хвосту — только у острия.
    const fa = 0.36 + 0.5 * ka;
    const fb = 0.36 + 0.5 * kb;
    const [iax, iay] = tip(A, fa);
    const [ibx, iby] = tip(B, fb);
    const age = (ka + kb) / 2;
    const gx = A.gx;
    const gy = A.gy;
    const L = A.len || 1;
    kPoly(b, [iax, iay, ax, ay, bx, by, ibx, iby], (x, y) => {
      if (y > clipY) return b.d[y * b.w + x];
      // Хвост — через точку: тает, а не обрывается.
      if (age > 0.62 && (x + y) % 2) return b.d[y * b.w + x];
      const u = (Math.hypot(x + 0.5 - gx, y + 0.5 - gy) / L - fa) / (1 - fa);
      let c: number;
      if (u > 0.8) c = age < 0.3 ? C.smW : C.smY;
      else if (u > 0.45) c = age < 0.45 ? C.smY : C.smR;
      else c = age < 0.5 ? C.smR : C.smD;
      if (u > 0.45 && age < 0.7)
        lit.mix(x, y, u > 0.8 ? C.smW : C.smY, (0.85 - age) * (u > 0.8 ? 1 : 0.6));
      return c;
    });
  }
}

// ---- Профиль ----

const SK = [
  'bx',
  'by',
  'lean',
  'tw',
  'hd',
  'nfx',
  'nfy',
  'ffx',
  'ffy',
  'gx',
  'gy',
  'gz',
  'yaw',
  'pit',
  'two',
  'ox',
  'oy',
  'ep',
  'glow',
  'clip',
  'pin',
  'pnx',
  'pny',
  'cape',
  'cup',
  'hair',
  'cw',
  'wo',
  'wf',
  'jaw',
  'eyes',
  'lift',
  'fdx',
  'fdy',
  'fsx',
  'fsy',
  'frot',
  'aura',
  'puff',
] as const;
type SKey = (typeof SK)[number];
type SRig = Record<SKey, number>;

/** Стойка: меч в ближней руке остриём вперёд-вниз, вес на обе ноги. */
const KGUARD: SRig = {
  bx: 0,
  by: 0,
  lean: 0.05,
  tw: 0,
  hd: 0,
  nfx: 3.5,
  nfy: 0,
  ffx: -2.5,
  ffy: 0,
  gx: 3,
  gy: -4,
  gz: 2,
  yaw: 0.3,
  pit: -0.82,
  two: 0,
  ox: 1.5,
  oy: 9,
  ep: 1.9,
  glow: 0,
  clip: 0,
  pin: 0,
  pnx: 0,
  pny: 0,
  cape: 0,
  cup: 0,
  hair: 0,
  cw: 0,
  wo: 0.12,
  wf: 0,
  jaw: 0,
  eyes: 1,
  lift: 0,
  fdx: 0,
  fdy: 0,
  fsx: 1,
  fsy: 1,
  frot: 0,
  aura: 0,
  puff: 0,
};

interface SideGeo {
  px: number;
  py: number;
  T: (u: number, v: number) => [number, number];
  sn: [number, number];
  sf: [number, number];
}

function sideGeo(r: SRig): SideGeo {
  const px = KX0 + r.bx;
  const py = KGY - 24 + r.by;
  const cl = Math.cos(r.lean);
  const sl = Math.sin(r.lean);
  const T = (u: number, v: number): [number, number] => [
    px + u * cl + v * sl,
    py + u * sl - v * cl,
  ];
  return { px, py, T, sn: T(3 - r.tw, 13), sf: T(-1 + r.tw * 0.5, 13) };
}

const ARM = 15.2;

/** Клинок в профиль: хват от ближнего плеча, направление — 3D или к точке в полу. */
function sideBlade(r: SRig, g: SideGeo): Blade {
  let gx = projX(r.gx);
  let gy = projY(r.gy, r.gz);
  const d = Math.hypot(gx, gy);
  if (d > ARM - 0.3) {
    gx *= (ARM - 0.3) / d;
    gy *= (ARM - 0.3) / d;
  }
  const x = g.sn[0] + gx;
  const y = g.sn[1] + gy;
  if (r.pin > 0.5) {
    const dx = r.pnx - x;
    const dy = r.pny - y;
    const n = Math.hypot(dx, dy) || 1;
    return { gx: x, gy: y, ux: dx / n, uy: dy / n, len: 27, z: 0 };
  }
  const bd = bladeDir(r.yaw, r.pit, 27);
  return { gx: x, gy: y, ux: bd.ux, uy: bd.uy, len: bd.len, z: bd.z };
}

interface KOpt {
  wings: boolean;
  /** Кромка светится с фазы 1. */
  glow: number;
  rage: boolean;
  smear: Blade[] | null;
  /** Номер кадра — зерно разрядов молнии. */
  arcF?: number;
  /** Молния с неба в острие (кадр удара грозы). */
  bolt?: boolean;
}

interface KOut {
  p: Px;
  lit: Px | null;
  eye: [number, number] | null;
  /** Слой крыльев отдельно (смерть осыпает их раньше тела). */
  wings?: KB | null;
  body?: KB;
  litB?: KB;
  sword?: KB;
}

function sideCape(b: KB, r: SRig, g: SideGeo): void {
  const G = KGY;
  const [ax, ay] = g.T(-3, 16);
  const [bx, by] = g.T(4, 15);
  const back = 9 + r.cape;
  const w1 = Math.sin(r.cw) * (0.8 + Math.abs(r.cape) * 0.12);
  const w2 = Math.sin(r.cw - 1.3) * (1.4 + Math.abs(r.cape) * 0.18);
  const cx = g.px - 1 + r.cup * 0.1;
  const cy = Math.min(G - 1, G - 1 - r.cup * 0.35);
  const dx = g.px - back - 3 + w2 - r.cup * 0.25;
  const dy = G - 2 - r.cup;
  const ex = g.px - back + w1 * 0.6 - r.cup * 0.1;
  const ey = g.py - r.cup * 0.45;
  const edge = spline(
    [
      [dx, dy],
      [ex, ey],
      [ax, ay],
    ],
    5,
  );
  const pts: number[] = [bx, by, cx, cy];
  for (const [x, y] of edge) pts.push(x, y);
  const top = Math.min(ay, by);
  kPoly(b, pts, (x, y, xa) => {
    const s = x - xa;
    const fold = Math.floor(s + (y - top) * 0.22) % 5 === 0 ? -0.25 : 0;
    return lv(K4.cape, 0.6 - (g.px - x) * 0.04 + fold);
  });
  kLine(b, dx, dy, cx, cy, K4.gold[1]);
}

function sideLeg(b: KB, hip: [number, number], fx: number, fy: number, t: T4, near: boolean): void {
  const [kx, ky] = ik2(hip[0], hip[1], fx, fy - 0.5, 11.8, 11.6, 1, -0.25);
  kCap(b, hip[0], hip[1], kx, ky, near ? 3 : 2.8, near ? 2.6 : 2.4, t);
  kCap(b, kx, ky, fx, fy - 1.5, near ? 2.5 : 2.3, near ? 2.7 : 2.5, t);
  kSabaton(b, fx, fy, 1, t);
  if (near) b.put(kx, ky, K4.gold[2]);
}

function paintSide(r: SRig, o: KOpt, split = false): KOut {
  const b = new KB();
  const lit = new KB();
  const wl = split ? new KB() : b;
  const sb = split ? new KB() : b;
  const G = KGY;
  const g = sideGeo(r);
  const bl = sideBlade(r, g);
  const clipY = r.clip > 0.5 ? G + 1 : 1e9;
  const glow = Math.max(r.glow, o.glow);
  const wr = g.T(-3, 13);
  // Дальнее крыло.
  // Дальнее крыло выше и чуть отстаёт — видно из-за ближнего.
  if (o.wings) kWing(wl, wr[0] + 3, wr[1] - 2, -1, r.wf - 0.18, r.wo, 30, true);
  sideCape(b, r, g);
  // Дальняя рука: на рукояти или свободна.
  const tk = clampK(r.two, 0, 1);
  const hx = (g.sf[0] + r.ox) * (1 - tk) + (bl.gx - bl.ux * 3.2) * tk;
  const hy = (g.sf[1] + r.oy) * (1 - tk) + (bl.gy - bl.uy * 3.2) * tk;
  const fe = ik2(g.sf[0], g.sf[1], hx, hy, 7.2, 7.5, -0.3, 1);
  kCap(b, g.sf[0], g.sf[1], fe[0], fe[1], 2.4, 2.1, K4.armorFar);
  kCap(b, fe[0], fe[1], hx, hy, 2.1, 1.9, K4.armorFar);
  kFist(b, hx, hy, K4.armorFar, false);
  // Ноги: дальняя, ближняя.
  sideLeg(b, g.T(-1, 0), KX0 + r.ffx, G - 1 - r.ffy, K4.armorFar, false);
  sideLeg(b, g.T(2, 0), KX0 + r.nfx, G - 1 - r.nfy, K4.armor, true);
  // Набедренник и кираса.
  const skirt = [...g.T(-5, 3), ...g.T(6, 3), ...g.T(7, -3), ...g.T(-5, -3)];
  kPolyShade(b, skirt, K4.armor);
  kLine(b, ...g.T(-5, -3), ...g.T(7, -3), K4.gold[1]);
  kPolyShade(b, [...g.T(-5, 15), ...g.T(7, 14), ...g.T(6, 3), ...g.T(-4, 3)], K4.armor);
  const cu = 5 + r.tw;
  for (let v = 4; v <= 13; v++) b.put(...g.T(cu, v), K4.gold[1]);
  const [gmx, gmy] = g.T(cu, 9);
  kDisc(b, gmx, gmy, 1.2, 1.6, C.gem);
  // Ближнее крыло.
  if (o.wings) kWing(wl, wr[0], wr[1], -1, r.wf, r.wo, 32, false);
  const behind = bl.z < -0.35;
  if (behind) kSword(sb, lit, bl, glow, clipY, o.rage);
  // Наплечник.
  const pu = 2 - r.tw * 1.5;
  const [pax, pay] = g.T(pu, 14);
  kEll(b, pax, pay, 5, 3.6, K4.armor, 0.12);
  for (let i = 0; i < 3; i++) {
    const [s0x, s0y] = g.T(pu - 2 + i * 2.5, 16);
    const [s1x, s1y] = g.T(pu - 3 + i * 2.8, 20 + (i === 1 ? 1 : 0));
    kCap(b, s0x, s0y, s1x, s1y, 0.9, 0.3, K4.spike);
  }
  for (let u = -3; u <= 5; u++) b.put(...g.T(pu + u, 11), K4.gold[2]);
  // Голова: наклон корпуса наполовину гасит шея.
  const [hdx, hdy] = g.T(2, 20);
  const tilt = r.lean * 0.55 + r.hd;
  const eye = kHead(b, lit, hdx, hdy, true, tilt, r.jaw, r.hair, r.eyes);
  // Выдох углями из пасти (после натуги): клуб растёт и уходит вперёд-вверх.
  if (r.puff > 0.02) {
    const ct = Math.cos(tilt);
    const st = Math.sin(tilt);
    const mx = hdx + 4 * ct - 3.5 * st;
    const my = hdy + 1 + 4 * st + 3.5 * ct;
    const k = r.puff;
    for (let i = 0; i < 5; i++) {
      const a = -0.5 + (hash(i, 3, 17) - 0.5) * 1.1;
      const d = 1 + k * (3 + i * 1.2);
      const px = mx + Math.cos(a) * d;
      const py = my + Math.sin(a) * d - k * k * 3;
      lit.mix(px, py, i < 2 ? C.emberHi : C.ember, (1 - k) * 0.85);
    }
  }
  // Ближняя рука с мечом.
  const ee = ik2(g.sn[0], g.sn[1], bl.gx, bl.gy, 7.5, 7.7, Math.cos(r.ep), Math.sin(r.ep));
  kCap(b, g.sn[0], g.sn[1], ee[0], ee[1], 2.5, 2.2, K4.armor);
  kCap(b, ee[0], ee[1], bl.gx, bl.gy, 2.2, 2.0, K4.armor);
  if (!behind) kSword(sb, lit, bl, glow, clipY, o.rage);
  kFist(b, bl.gx, bl.gy, K4.armor, true);
  if (split) {
    kOutline(wl, C.ink);
    return { p: b.px, lit: null, eye, wings: wl, body: b, litB: lit, sword: sb };
  }
  kOutline(b, C.ink);
  kAura(b, lit, r.aura);
  if (o.smear) kSmear(b, lit, o.smear, clipY);
  return { p: b.px, lit: lit.used ? lit.px : null, eye };
}

// ---- Анфас ----

const FK = [
  'sit',
  'by',
  'bow',
  'hd',
  'hs',
  'gx',
  'gy',
  'gz',
  'yaw',
  'pit',
  'ron',
  'lon',
  'rx',
  'ry',
  'lx',
  'ly',
  'glow',
  'clip',
  'cape',
  'cup',
  'hair',
  'cw',
  'wo',
  'wf',
  'jaw',
  'eyes',
  'st',
  'arc',
  'lift',
  'fdx',
  'fdy',
  'fsx',
  'fsy',
  'frot',
  'aura',
  'claw',
] as const;
type FKey = (typeof FK)[number];
type FRig = Record<FKey, number>;

/** На троне: сидит, меч воткнут перед ним, руки на навершии. */
const SEAT: FRig = {
  sit: 1,
  by: 0,
  bow: 0,
  hd: 0,
  hs: 0,
  gx: 0,
  gy: -12,
  gz: 2,
  yaw: 0,
  pit: -Math.PI / 2,
  ron: 1,
  lon: 1,
  rx: 3,
  ry: 9,
  lx: -3,
  ly: 9,
  glow: 0,
  clip: 1,
  cape: 0,
  cup: 0,
  hair: 0,
  cw: 0,
  wo: 0,
  wf: 0,
  jaw: 0,
  eyes: 1,
  st: 0,
  arc: 0,
  lift: 0,
  fdx: 0,
  fdy: 0,
  fsx: 1,
  fsy: 1,
  frot: 0,
  aura: 0,
  claw: 0,
};

/** Стоит лицом к зрителю, меч в правой руке у бедра. */
const FRONT: FRig = {
  ...SEAT,
  sit: 0,
  gx: 12,
  gy: -9,
  gz: 3,
  yaw: 0.25,
  pit: -1.1,
  ron: 1,
  lon: 0,
  lx: -2,
  ly: 12,
  clip: 0,
};

const FCX = 48;

interface FrontGeo {
  hip: number;
  sh: number;
}

function frontGeo(r: FRig): FrontGeo {
  const hip = KGY - 24 + 6 * r.sit + r.by;
  return { hip, sh: hip - 16 + r.bow * 2 };
}

function frontBlade(r: FRig, g: FrontGeo): Blade {
  const x = FCX + projX(r.gx);
  const y = g.sh + 4 + projY(r.gy, r.gz);
  const bd = bladeDir(r.yaw, r.pit, 26);
  return { gx: x, gy: y, ux: bd.ux, uy: bd.uy, len: bd.len, z: bd.z };
}

/** Кисть на рукояти: `k` — от хвата к навершию. */
const onGrip = (bl: Blade, k: number): [number, number] => [bl.gx - bl.ux * k, bl.gy - bl.uy * k];

function paintFront(r: FRig, o: KOpt, split = false): KOut {
  const b = new KB();
  const lit = new KB();
  const wl = split ? new KB() : b;
  const G = KGY;
  const cx = FCX;
  const g = frontGeo(r);
  const { hip, sh } = g;
  const bl = frontBlade(r, g);
  const clipY = r.clip > 0.5 ? G + 1 : 1e9;
  const glow = Math.max(r.glow, o.glow);
  // Крылья — за всем.
  if (o.wings && r.wo > 0.02) {
    const L = 30;
    kWing(wl, cx - 5, sh + 2, -1, r.wf, r.wo, L, false);
    kWing(wl, cx + 5, sh + 2, 1, r.wf, r.wo, L, false);
  }
  // Плащ за спиной: от плеч до земли, расходится; ветер поднимает подол.
  const cw = 12 + r.cape;
  const w1 = Math.sin(r.cw) * 1.2;
  const w2 = Math.sin(r.cw + 1.9) * 1.2;
  const cb = G - 1 - r.cup;
  kPoly(
    b,
    [cx - 9, sh, cx + 9, sh, cx + cw + w1 + r.cup * 0.25, cb, cx - cw + w2 - r.cup * 0.25, cb],
    (x, y, xa) => {
      const k = Math.abs(x - cx) / cw;
      const fold = Math.floor(x - xa + (y - sh) / 5) % 4 === 0 ? -0.25 : 0;
      return lv(K4.capeIn, 0.7 - k * 0.5 + fold);
    },
  );
  kLine(b, cx - cw + w2 - r.cup * 0.25, cb, cx + cw + w1 + r.cup * 0.25, cb, K4.gold[1]);
  // Ноги: сидя — колени к зрителю, стоя — прямо, в стойке — шире.
  for (const s of [-1, 1]) {
    const hx0 = cx + s * 4;
    const fx = cx + s * (5.5 + r.st);
    const fy = G - 1;
    const kxS = cx + s * 5.5;
    const kyS = hip + 1.5;
    const kxT = (hx0 + fx) / 2 + s * r.by * 0.35;
    const kyT = (hip + fy) / 2 + r.by * 0.2;
    const kx = kxS * r.sit + kxT * (1 - r.sit);
    const ky = kyS * r.sit + kyT * (1 - r.sit);
    if (r.sit > 0.5) kEll(b, kx, ky, 4, 3.4, K4.armor, 0.1);
    else kCap(b, hx0, hip, kx, ky, 3, 2.6, K4.armor);
    kCap(b, kx, ky, fx, fy - 1.5, 2.5, 2.7, K4.armor);
    kPoly(b, [fx - 3, fy - 2, fx + 3, fy - 2, fx + 3.5, fy + 0.5, fx - 3.5, fy + 0.5], (x, y) =>
      lv(K4.armor, 0.6 - (y - fy) * 0.1),
    );
    b.put(kx - s * 1, ky - (r.sit > 0.5 ? 2 : 0), K4.gold[2]);
  }
  // Набедренник: пластины с золотой каймой.
  kPoly(b, [cx - 8, hip - 3, cx + 8, hip - 3, cx + 9, hip + 3, cx - 9, hip + 3], (x, y) =>
    lv(K4.armor, 0.55 - (x - cx) * 0.03 - ((((y - hip) % 3) + 3) % 3 === 0 ? 0.25 : 0)),
  );
  kLine(b, cx - 9, hip + 3, cx + 9, hip + 3, K4.gold[1]);
  // Кираса.
  kPolyShade(b, [cx - 9, sh, cx + 9, sh, cx + 7, hip - 2, cx - 7, hip - 2], K4.armor);
  for (let x = -7; x <= 7; x++) b.set(cx + x, Math.round(sh + 1), K4.gold[x < 0 ? 1 : 2]);
  for (let y = Math.round(sh + 2); y < hip - 2; y++) b.set(cx, y, K4.gold[1]);
  kDisc(b, cx, sh + 7, 1.8, 2, C.gem);
  b.put(cx - 1, sh + 6, C.gemHi);
  lit.mix(cx, sh + 7, C.gem, 0.35 + glow * 0.3);
  // Голова.
  const eye = kHead(b, lit, cx, sh - 5 + r.hd * 1.5, false, r.hs, r.jaw, r.hair, r.eyes, r.hd);
  // Руки: правая (экранная правая) держит меч, левая — на рукояти или свободна.
  const rs: [number, number] = [cx + 9, sh + 3];
  const ls: [number, number] = [cx - 9, sh + 3];
  const mixP = (a: [number, number], b: [number, number], k: number): [number, number] => {
    const q = clampK(k, 0, 1);
    return [a[0] + (b[0] - a[0]) * q, a[1] + (b[1] - a[1]) * q];
  };
  const rh = mixP([rs[0] + r.rx, rs[1] + r.ry], onGrip(bl, 1), r.ron);
  const lh = mixP([ls[0] + r.lx, ls[1] + r.ly], onGrip(bl, 3.4), r.lon);
  const re = ik2(rs[0], rs[1], rh[0], rh[1], 7.3, 7.6, 1, 0.6);
  const le = ik2(ls[0], ls[1], lh[0], lh[1], 7.3, 7.6, -1, 0.6);
  kCap(b, ls[0], ls[1], le[0], le[1], 2.5, 2.2, K4.armor);
  kCap(b, le[0], le[1], lh[0], lh[1], 2.2, 2.0, K4.armor);
  kCap(b, rs[0], rs[1], re[0], re[1], 2.5, 2.2, K4.armor);
  kCap(b, re[0], re[1], rh[0], rh[1], 2.2, 2.0, K4.armor);
  kSword(b, lit, bl, glow, clipY, o.rage);
  if (r.arc > 0) kArcs(b, lit, bl, r.arc, o.arcF ?? 0, !!o.bolt);
  // Наплечники — шипастые.
  for (const s of [-1, 1]) {
    kEll(b, cx + s * 9, sh + 1, 5, 3.6, K4.armor, s < 0 ? 0.15 : -0.05);
    for (let i = 0; i < 3; i++)
      kCap(
        b,
        cx + s * (7 + i * 2.5),
        sh - 1,
        cx + s * (7.5 + i * 3),
        sh - 5 - (i === 1 ? 1 : 0),
        0.9,
        0.3,
        K4.spike,
      );
    for (let x = -4; x <= 4; x++) b.put(cx + s * 9 + x, sh + 4, K4.gold[2]);
  }
  // Свободная левая — растопыренные когти (зов, гроза, рёв).
  if (r.lon < 0.5 && r.claw > 0.3)
    for (let i = -1; i <= 1; i++) {
      const dx = lh[0] - ls[0];
      const dy = lh[1] - ls[1];
      const n = Math.hypot(dx, dy) || 1;
      const ux = dx / n;
      const uy = dy / n;
      const cx2 = lh[0] + ux * 1.5 - uy * i * 1.2;
      const cy2 = lh[1] + uy * 1.5 + ux * i * 1.2;
      kCap(
        b,
        cx2,
        cy2,
        cx2 + (ux - uy * i * 0.5) * 2.6 * r.claw,
        cy2 + (uy + ux * i * 0.5) * 2.6 * r.claw,
        0.7,
        0.3,
        K4.spike,
      );
    }
  kFist(b, lh[0], lh[1], K4.armor, true);
  kFist(b, rh[0], rh[1], K4.armor, true);
  if (split) {
    kOutline(b, C.ink);
    kOutline(wl, C.ink);
    return { p: b.px, lit: null, eye, wings: wl, body: b, litB: lit };
  }
  kOutline(b, C.ink);
  kAura(b, lit, r.aura);
  if (o.smear) kSmear(b, lit, o.smear, clipY);
  return { p: b.px, lit: lit.used ? lit.px : null, eye };
}

// ---- Ключи и кривые ----

type Ease = (x: number) => number;
const eLin: Ease = (x) => x;
const eIn: Ease = (x) => x * x;
const eOut: Ease = (x) => 1 - (1 - x) * (1 - x);
const eOut3: Ease = (x) => 1 - (1 - x) * (1 - x) * (1 - x);
const eIO: Ease = (x) => (x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) * (1 - x));

type Key<K extends string> = [number, Partial<Record<K, number>>, Ease?];

/**
 * Ключевые позы: ключ меняет только названные каналы, остальные ДЕРЖАТ
 * значение прошлого ключа (поза не «плывёт» к далёкому ключу). Между
 * ключами — кривая следующего ключа. `lag` — запаздывание частей (плащ,
 * волосы, крылья): они смотрят позу чуть в прошлом.
 */
function track<K extends string>(
  names: readonly K[],
  keys: Key<K>[],
  t: number,
  base: Record<K, number>,
  lag?: Partial<Record<K, number>>,
): Record<K, number> {
  const out = { ...base };
  if (!keys.length) return out;
  for (const ch of names) {
    const tt = lag?.[ch] ? Math.max(0, t - lag[ch]!) : t;
    let pt = keys[0][0];
    let pv = keys[0][1][ch] ?? base[ch];
    let v = pv;
    if (tt > pt) {
      for (let i = 1; i < keys.length; i++) {
        const [kt, kv, ke] = keys[i];
        const cv = kv[ch] ?? pv;
        if (tt < kt) {
          v = STEP.has(ch)
            ? pv
            : pv + (cv - pv) * (ke ?? eIO)(clampK((tt - pt) / (kt - pt || 1), 0, 1));
          break;
        }
        pt = kt;
        pv = cv;
        v = cv;
      }
    }
    out[ch] = v;
  }
  return out;
}

/** Каналы «да/нет» и точки, которые меняются скачком: меч в полу, вторая рука. */
const STEP = new Set<string>(['pin', 'pnx', 'pny', 'clip']);

const SLAG: Partial<SRig> = { cape: 0.07, cup: 0.06, hair: 0.06, wo: 0.03, wf: 0.035, hd: 0.035 };
const FLAG: Partial<FRig> = { cape: 0.07, cup: 0.06, hair: 0.06, wf: 0.035, hs: 0.035 };
const sTrack = (keys: Key<SKey>[], t: number, base = KGUARD) => track(SK, keys, t, base, SLAG);
const fTrack = (keys: Key<FKey>[], t: number, base: FRig) => track(FK, keys, t, base, FLAG);
const blendS = (a: SRig, b: SRig, k: number): SRig => {
  const o = { ...a };
  for (const ch of SK) o[ch] = a[ch] + (b[ch] - a[ch]) * k;
  return o;
};
const blendF = (a: FRig, b: FRig, k: number): FRig => {
  const o = { ...a };
  for (const ch of FK) o[ch] = a[ch] + (b[ch] - a[ch]) * k;
  return o;
};

const FPS = 24;
const F1 = 1 / FPS;

// ---- Тайминги мозга (метроном). `echo` — отголосок на 15-м. ----

interface KT {
  h: number;
  echo: boolean;
}
const tSlash = (k: KT) => KING.slashWarn / k.h;
const tRec = (k: KT) => (k.echo ? 0.6 : 0.75 / k.h);
const tCleave = (k: KT) => KING.cleaveWarn / k.h;
const tStuck = (k: KT) => (k.echo ? 1.35 : KING.stuck / Math.sqrt(k.h));
const tStormCall = (k: KT) => (k.echo ? 0.3 : 0.35);
const tStormEnd = (k: KT) => (k.echo ? 1.65 : KING.storm);
const tLanded = (k: KT) => KING.landed / Math.sqrt(k.h);

// ---- Профиль: покой, шаг ----

/** Покой: дыхание (плечи на пиксель), плащ, волосы, меч покачивается, раз за круг моргает. */
function sIdle(ph: number, rage: boolean): SRig {
  const a = ph * TAU;
  const r = { ...KGUARD };
  // Дыхание — целыми пикселями: плечи, рука и меч поднимаются вместе.
  // Поворотов (голова, клинок) в покое нет: мелкий поворот перерисовывает
  // рога и кромку по-новому, и контур «кипит».
  r.by = Math.round(0.5 - 0.5 * Math.cos(a * 2));
  r.oy = KGUARD.oy + Math.round(Math.sin(a * 2));
  r.cw = a;
  r.cape = 0.6 + 0.6 * Math.sin(a);
  r.hair = 0.15 + 0.12 * Math.sin(a + 1);
  r.wf = 0.05 * Math.sin(a * 2);
  r.wo = KGUARD.wo + 0.04 * Math.sin(a * 2);
  r.eyes = ph > 0.86 && ph < 0.92 ? 0 : rage ? 2 : 1;
  return r;
}

/** Шаг: опорная нога едет назад по земле, переносимая — дугой вперёд; таз ниже на опоре. */
function sWalk(ph: number, rage: boolean): SRig {
  const a = ph * TAU;
  const r = { ...KGUARD };
  const S = 7;
  const foot = (p: number): [number, number] => {
    const q = ((p % 1) + 1) % 1;
    if (q < 0.5) return [S - q * 4 * S + 0.5, 0];
    const k = (q - 0.5) * 2;
    return [-S + k * 2 * S + 0.5, Math.sin(k * Math.PI) * 3.2];
  };
  [r.nfx, r.nfy] = foot(ph);
  [r.ffx, r.ffy] = foot(ph + 0.5);
  r.ffx -= 1;
  r.by = Math.round(Math.cos(a * 2));
  r.lean = 0.14;
  r.gx = KGUARD.gx + 1.3 * Math.sin(a);
  r.gy = KGUARD.gy + 0.6 * Math.cos(a * 2);
  r.pit = -0.72;
  r.ox = KGUARD.ox - 2.2 * Math.sin(a);
  r.cape = 3 + 0.8 * Math.sin(a * 2);
  r.cup = 0.8;
  r.cw = a * 2;
  r.hair = 0.45 + 0.15 * Math.sin(a * 2);
  r.wf = 0.06 * Math.sin(a * 2);
  r.eyes = rage ? 2 : 1;
  return r;
}

// ---- Профиль: рассечение (горизонтальный взмах) ----

function sSlash(t: number, k: KT): SRig {
  const T = tSlash(k);
  const R = tRec(k);
  const keys: Key<SKey>[] = [
    [0, {}],
    // Подхват второй рукой, шаг назад: меч уходит за бедро, корпус отворачивается.
    [
      0.3 * T,
      {
        two: 1,
        gx: -5,
        gy: -2,
        gz: 3,
        yaw: 2.4,
        pit: 0.1,
        lean: -0.1,
        tw: -0.8,
        bx: -2,
        by: 1,
        nfx: 6.5,
        ffx: -5,
        hd: 0.12,
        eyes: 2,
        glow: 0.5,
        cape: 2,
        ep: 2.4,
      },
      eIO,
    ],
    // Пружина: плечи довернуты, клинок накаляется — отсюда ударит.
    [
      T - 4 * F1,
      {
        gx: -7.5,
        gy: -1,
        gz: 3.5,
        yaw: 2.85,
        pit: 0.2,
        lean: -0.17,
        tw: -1.2,
        bx: -3,
        by: 2,
        hd: 0.18,
        eyes: 3,
        glow: 1,
        cape: 3,
      },
      eOut,
    ],
    // Взмах: клинок идёт через сторону камеры вперёд.
    [
      T - 2 * F1,
      { gx: -1, gy: -2, gz: 6, yaw: 1.65, pit: -0.05, lean: 0.02, tw: -0.2, bx: 0, by: 1.5 },
      eIn,
    ],
    [
      T - F1,
      { gx: 6, gy: -2.5, gz: 4.5, yaw: 0.75, pit: -0.15, lean: 0.16, tw: 0.4, bx: 2.5, nfx: 8.5 },
      eLin,
    ],
    // Контакт: выпад на всю руку, клинок впереди.
    [
      T,
      {
        gx: 11,
        gy: -3,
        gz: 1,
        yaw: 0,
        pit: -0.22,
        lean: 0.26,
        tw: 0.8,
        bx: 4.5,
        by: 2.5,
        nfx: 10.5,
        ffx: -5,
        hd: 0.05,
        cape: -1,
        ep: 2.2,
      },
      eOut,
    ],
    // Проводка с перелётом: клинок уходит за дальний бок, корпус проваливается.
    [
      T + 0.1,
      {
        gx: 6,
        gy: -4,
        gz: -4.5,
        yaw: -1.25,
        pit: -0.35,
        lean: 0.34,
        tw: 1.1,
        bx: 5.5,
        by: 3.2,
        cape: -2,
        eyes: 2,
      },
      eOut,
    ],
    [
      T + 0.26,
      {
        gx: 5,
        gy: -5,
        gz: -2.5,
        yaw: -0.8,
        pit: -0.42,
        lean: 0.27,
        tw: 0.8,
        bx: 4.5,
        by: 2.4,
        glow: 0.4,
      },
      eIO,
    ],
    [
      T + R - 0.3,
      {
        gx: 5,
        gy: -5,
        gz: -1.5,
        yaw: -0.55,
        pit: -0.5,
        lean: 0.22,
        by: 2,
        bx: 4,
        eyes: 1,
        glow: 0,
      },
      eIO,
    ],
    [T + R, { ...KGUARD }, eIO],
  ];
  // Выпад: переносимая нога чуть отрывается.
  const r = sTrack(keys, t);
  // Пружина сжата до предела: хват подрагивает — сейчас сорвётся.
  if (t > T - 0.3 && t < T - 4 * F1) r.gy += (hash(Math.floor(t * FPS), 41) - 0.5) * 0.9;
  if (t > T - 2 * F1 && t < T) r.nfy = 1.5;
  // Тяжёлое дыхание на проводке.
  if (t > T + 0.26 && t < T + R - 0.3)
    r.by += Math.round(0.5 - 0.5 * Math.cos((t - T - 0.26) * 11));
  return r;
}

// ---- Профиль: рубка сверху → меч в полу → рывок ----

/** Где клинок входит в пол на кадре контакта. */
function cleavePin(k: KT): [number, number] {
  const r = sTrack(cleaveKeys(k, null), tCleave(k));
  const g = sideGeo(r);
  const bl = sideBlade(r, g);
  const s = (KGY - bl.gy) / (bl.uy || 1e-3);
  return [bl.gx + bl.ux * s, KGY];
}

function cleaveKeys(k: KT, pin: [number, number] | null): Key<SKey>[] {
  const T = tCleave(k);
  const S = tStuck(k);
  const keys: Key<SKey>[] = [
    [0, {}],
    // Собрался: вторая рука на рукоять, присел.
    [
      0.14 * T,
      { two: 1, gx: 3, gy: -5, gz: 2, yaw: 0, pit: -0.4, lean: 0.12, by: 2.5, bx: 0.5, eyes: 2 },
      eIO,
    ],
    // Меч над головой, корпус выгнут назад, на носках.
    [
      0.52 * T,
      {
        gx: -1.5,
        gy: 10.5,
        gz: 1,
        pit: 2.25,
        lean: -0.14,
        by: -1,
        tw: 0.2,
        hd: -0.15,
        nfx: 5,
        ffx: -4,
        glow: 0.8,
        cape: 1.5,
        ep: 0.4,
      },
      eIO,
    ],
    [
      T - 4 * F1,
      {
        gx: -2.5,
        gy: 12,
        pit: 2.6,
        lean: -0.2,
        by: -2,
        hd: -0.22,
        glow: 1,
        eyes: 3,
        cape: 2.5,
        hair: 0.4,
      },
      eOut,
    ],
    // Рубка: через верх — вперёд — в пол.
    [T - 2 * F1, { gx: 3, gy: 12.5, pit: 1.25, lean: 0.02, by: -1.5, hd: -0.05, ep: 0.2 }, eIn],
    [T - F1, { gx: 9, gy: 5, pit: 0.05, lean: 0.28, by: 1.5, bx: 2, nfx: 8, ep: 1.2 }, eLin],
    [
      T,
      {
        gx: 10,
        gy: -8,
        gz: 1,
        pit: -1.02,
        lean: 0.5,
        by: 5.5,
        bx: 3.5,
        nfx: 10,
        ffx: -6,
        hd: 0.28,
        fsx: 1.08,
        fsy: 0.92,
        clip: 1,
        cape: 3,
        cup: 3,
        hair: 0.8,
        ep: 1.9,
      },
      eOut,
    ],
  ];
  if (!pin) return keys;
  const P = { pin: 1, pnx: pin[0], pny: pin[1] };
  keys.push(
    [T + 0.001, P, eLin],
    [T + 0.12, { fsx: 1, fsy: 1, by: 4.5, lean: 0.46, cup: 0, hair: 0.3, glow: 0.6 }, eOut],
  );
  // Три рывка: тянет — клинок качается на острие в полу — срывается обратно.
  const t0 = T + 0.22;
  const tugs = 3;
  const span = (S - 0.42) / tugs;
  for (let i = 0; i < tugs; i++) {
    const a = t0 + i * span;
    const pull = 1 + i * 0.4;
    keys.push(
      [a, { gx: 10, gy: -8, lean: 0.46, by: 4.6, hd: 0.25, eyes: 2, jaw: 0, fdx: 0 }, eIO],
      [
        a + span * 0.45,
        {
          gx: 10 - 2.2 * pull,
          gy: -8 + 1.5 * pull,
          lean: 0.46 - 0.12 * pull,
          by: 4.6 - 0.8 * pull,
          hd: -0.12 * pull,
          eyes: 3,
          jaw: 0.5,
          fdx: -0.5 * pull,
        },
        eOut,
      ],
      [
        a + span * 0.8,
        { gx: 9.7, gy: -8.2, lean: 0.48, by: 4.8, hd: 0.3, eyes: 2, jaw: 0, fdx: 0 },
        eIn,
      ],
    );
  }
  // Последний рывок: упёрся, клинок раскалён — сейчас выдернет.
  keys.push([
    T + S - 0.18,
    { gx: 6.5, gy: -5, lean: 0.28, by: 3.5, hd: 0.05, eyes: 3, glow: 1, bx: 2.5 },
    eIO,
  ]);
  return keys;
}

function sCleave(t: number, k: KT): SRig {
  const T = tCleave(k);
  const S = tStuck(k);
  const R = tRec(k);
  const pin = cleavePin(k);
  const keys = cleaveKeys(k, pin);
  // Угол клинка к полу в последний миг — с него начинается рывок (без скачка).
  const at = sTrack(keys, T + S);
  const g = sideGeo(at);
  const bl = sideBlade(at, g);
  const pp = Math.atan2(-bl.uy, bl.ux);
  keys.push(
    [T + S, { yaw: 0, pit: pp }, eLin],
    [T + S + 0.001, { pin: 0, clip: 0 }, eLin],
    // Рывок: меч вылетает из пола вверх, король отшатывается.
    [
      T + S + 0.1,
      {
        gx: -1,
        gy: 5,
        pit: 1.05,
        lean: -0.06,
        by: 1,
        bx: -1.5,
        fsx: 0.96,
        fsy: 1.04,
        eyes: 2,
        glow: 0.7,
        cup: 2,
      },
      eOut3,
    ],
    // Кладёт на плечо, выдох.
    [
      T + S + 0.32,
      {
        gx: -1.5,
        gy: 1.5,
        pit: 2.45,
        two: 0,
        ox: 2,
        oy: 8,
        lean: 0.02,
        bx: -0.5,
        by: 0.5,
        fsx: 1,
        fsy: 1,
        glow: 0.3,
        cup: 0,
      },
      eIO,
    ],
    [T + S + R, { ...KGUARD }, eIO],
  );
  const r = sTrack(keys, t);
  // Меч над головой: хват подрагивает от напряжения перед рубкой.
  if (t > T - 0.3 && t < T - 4 * F1) r.gx += (hash(Math.floor(t * FPS), 43) - 0.5) * 0.9;
  // Руки дрожат от натуги: сдвиг кисти на пиксель по кадрам рывка.
  if (t > T + 0.2 && t < T + S) r.gy += (hash(Math.floor(t * FPS), 5) - 0.5) * 0.8;
  // После каждого рывка — выдох углями.
  if (t > T + 0.22 && t < T + S - 0.2) {
    const q = ((((t - T - 0.22) / ((S - 0.42) / 3)) % 1) + 1) % 1;
    r.puff = q > 0.5 && q < 0.95 ? (q - 0.5) / 0.45 : 0;
  }
  return r;
}

// ---- Профиль: взлёт, парение, пике, посадка ----

const AIR_H = 48;
const FLAP = 0.46;

/** Взмах: вниз — быстро (0,4 цикла), вверх — медленно и сложив крыло. */
function flap(t: number): { wf: number; wo: number; bob: number } {
  const q = (((t / FLAP) % 1) + 1) % 1;
  if (q < 0.4) {
    const k = eOut(q / 0.4);
    return { wf: -0.9 + 1.85 * k, wo: 1, bob: 3 * k };
  }
  const k = eIO((q - 0.4) / 0.6);
  return { wf: 0.95 - 1.85 * k, wo: 1 - 0.45 * Math.sin(k * Math.PI), bob: 3 * (1 - k) };
}

const AIRPOSE: Partial<SRig> = {
  lean: 0.12,
  nfx: -1,
  nfy: -1,
  ffx: -5,
  ffy: 1,
  gx: 3,
  gy: -6,
  gz: 2,
  yaw: 0.2,
  pit: -1.25,
  two: 0,
  ox: -1,
  oy: 8,
  cup: 6,
  hair: 0.6,
  wo: 1,
  eyes: 2,
};

function sTakeoff(t: number): SRig {
  const keys: Key<SKey>[] = [
    [0, { wo: 0.12 }],
    // Присел, крылья вскинуты — сейчас оттолкнётся.
    [
      0.12,
      {
        by: 4,
        lean: 0.22,
        fsx: 1.1,
        fsy: 0.9,
        wo: 1,
        wf: -1.0,
        gx: 2,
        gy: -6,
        pit: -1.2,
        cape: 1,
        eyes: 2,
        hair: 0.3,
      },
      eOut,
    ],
    // Удар крыльями вниз — толчок.
    [
      0.24,
      {
        by: -2,
        lean: 0.05,
        fsx: 0.93,
        fsy: 1.1,
        wf: 0.95,
        lift: 14,
        nfy: 3,
        ffy: 5,
        ffx: -4,
        cape: -1,
        cup: 7,
        hair: 0.8,
      },
      eOut3,
    ],
    [0.36, { wf: -0.8, lift: 24, fsx: 1, fsy: 1, by: 0, cup: 8, lean: 0.1 }, eIO],
    [0.48, { wf: 0.9, lift: 40 }, eOut],
    [0.6, { ...AIRPOSE, wf: -0.9, lift: AIR_H }, eIO],
  ];
  const r = sTrack(keys, t);
  r.cw = t * 16;
  return r;
}

function sAir(t: number): SRig {
  const lock = KING.airT - KING.lock;
  const fl = flap(t);
  const base = { ...KGUARD, ...AIRPOSE } as SRig;
  base.wf = fl.wf;
  base.wo = fl.wo;
  base.lift = AIR_H + fl.bob;
  base.by = -Math.round(fl.bob * 0.4);
  base.cw = t * 14;
  base.cup = 6 + 1.5 * Math.sin(t * 9);
  base.hair = 0.6 + 0.2 * Math.sin(t * 7);
  if (t < lock) return base;
  // Метка замерла: крылья вверх, меч назад за голову, колени поджаты — сейчас упадёт.
  const from = sAir(lock - 1e-4);
  const keys: Key<SKey>[] = [
    [0, {}],
    [
      0.28,
      {
        wf: -1.15,
        wo: 0.9,
        lift: 56,
        two: 1,
        gx: -3,
        gy: 7,
        gz: 1,
        yaw: 0,
        pit: 1.9,
        lean: -0.12,
        nfy: 7,
        ffy: 7,
        nfx: 3,
        ffx: -2,
        eyes: 3,
        glow: 1,
        cup: 3,
      },
      eOut,
    ],
    [0.55, { wf: -1.25, lift: 58, lean: -0.2, gy: 8, pit: 2.1 }, eIO],
    [KING.lock, { lift: 57, lean: -0.1 }, eIO],
  ];
  const r = track(SK, keys, t - lock, from, SLAG);
  r.cw = t * 14;
  return r;
}

/** Поза пике: тело вытянуто по ходу, крылья назад, меч остриём вниз-вперёд. */
const DIVE: Partial<SRig> = {
  lean: 0.6,
  wf: -1.3,
  wo: 0.55,
  two: 1,
  gx: 8,
  gy: -4,
  gz: 1,
  yaw: 0,
  pit: -1.1,
  nfx: -4,
  nfy: 8,
  ffx: -7,
  ffy: 6,
  cup: 14,
  hair: 1,
  eyes: 3,
  glow: 1,
  fsx: 0.9,
  fsy: 1.12,
};

function sDive(t: number): SRig {
  const k = clampK(t / 0.18, 0, 1);
  // Первые два кадра меч из-за головы рушится вниз (след), дальше — пике.
  const from = sAir(KING.airT - 1e-4);
  const keys: Key<SKey>[] = [
    [0, {}],
    [0.075, { ...DIVE }, eIn],
  ];
  const r = track(SK, keys, t, from);
  r.cw = t * 20;
  r.lift = from.lift * (1 - k * k);
  return r;
}

function sLanded(t: number, k: KT): SRig {
  const L = tLanded(k);
  const tt = t * (1.8 / L);
  const keys: Key<SKey>[] = [
    [
      0,
      {
        by: 10,
        lean: 0.45,
        bx: 2,
        nfx: -5,
        ffx: 7,
        gx: 9,
        gy: -9,
        gz: 1,
        yaw: 0,
        pit: -1.35,
        two: 1,
        clip: 1,
        wo: 1,
        wf: 1.15,
        fsx: 1.16,
        fsy: 0.86,
        cape: 2,
        cup: 10,
        hair: 1,
        eyes: 3,
        hd: 0.3,
        glow: 1,
      },
    ],
    [0.12, { fsx: 1, fsy: 1, by: 9, cup: 2, hair: 0.5 }, eOut],
    [0.4, { cup: 0, hair: 0.2, wf: 1.0, wo: 0.9, eyes: 2, glow: 0.5 }, eIO],
    [1.2, { by: 8.5, wo: 0.45, wf: 0.5, hd: 0.2, eyes: 1 }, eIO],
    // Встаёт, вытаскивая меч.
    [1.42, { by: 3, lean: 0.2, bx: 1, gx: 6, gy: -4, pit: -1.2, nfx: 1, ffx: 4, eyes: 2 }, eOut],
    [1.43, { clip: 0 }, eLin],
    [1.56, { pit: 0.6, gx: 2, gy: 3, two: 0, by: 1, lean: 0.05, bx: 0 }, eOut],
    [1.8, { ...KGUARD }, eIO],
  ];
  const base = { ...KGUARD, wo: 1, wf: 1.15, clip: 1, by: 10 } as SRig;
  const r = track(SK, keys, tt, base, SLAG);
  // Тяжело дышит, стоя на колене: на каждом выдохе — клуб углей из пасти.
  if (tt > 0.2 && tt < 1.25) {
    const ph = (tt - 0.2) * 7;
    r.by += Math.round(0.5 - 0.5 * Math.cos(ph));
    const q = (((ph / TAU) % 1) + 1) % 1;
    r.puff = q < 0.45 ? q / 0.45 : 0;
    r.jaw = q < 0.3 ? 0.4 : 0;
  }
  return r;
}

// ---- Профиль: смерть ----

const DEATH_T = 1.45;

function sDeath(t: number): SRig {
  const keys: Key<SKey>[] = [
    [0, {}],
    // Удар отбрасывает: голова назад, руки врозь.
    [
      0.1,
      {
        lean: -0.3,
        bx: -3,
        by: 1,
        hd: -0.45,
        jaw: 0.8,
        eyes: 3,
        gx: 6,
        gy: -2,
        gz: 3,
        pit: -0.3,
        yaw: 0.6,
        two: 0,
        ox: -4,
        oy: 4,
        fdx: -1.5,
        cape: 3,
        cup: 2,
        hair: 0.6,
        wo: 0.8,
        wf: -0.4,
      },
      eOut,
    ],
    // Падает на колено, опершись на воткнутый меч.
    [
      0.32,
      {
        lean: 0.35,
        by: 9,
        bx: 1,
        nfx: -5,
        ffx: 6,
        hd: 0.55,
        jaw: 0.3,
        eyes: 2,
        gx: 8,
        gy: -10,
        gz: 2,
        yaw: 0,
        pit: -1.35,
        clip: 1,
        ox: 5,
        oy: 6,
        wf: 0.6,
        wo: 0.9,
        cape: 1,
        cup: 0,
        fdx: -0.5,
        fsx: 1.06,
        fsy: 0.94,
      },
      eIn,
    ],
    [0.42, { fsx: 1, fsy: 1, by: 8.5 }, eOut],
    [0.9, { lean: 0.42, hd: 0.65, eyes: 1, wf: 0.95, wo: 0.8, jaw: 0 }, eIO],
    [DEATH_T, { lean: 0.5, hd: 0.72, eyes: 0 }, eLin],
  ];
  return sTrack(keys, t);
}

/**
 * Пепел: крылья осыпаются с концов, потом тело — сверху вниз; крошка
 * падает и ложится горкой, угли летят вверх. Меч остаётся воткнутым.
 */
function crumble(
  out: KOut,
  sword: KB,
  t: number,
  rootX: number,
  rootY: number,
): { p: Px; lit: Px | null } {
  const body = out.body!;
  const wl = out.wings!;
  const litIn = out.litB!;
  const res = new KB();
  const lit = new KB();
  const W = KW;
  const G = KGY;
  // Верх тела — для порядка осыпания.
  let top = KH;
  for (let i = 0; i < body.d.length; i++)
    if (body.d[i] >>> 24) {
      top = Math.floor(i / W);
      break;
    }
  let wmax = 1;
  for (let i = 0; i < wl.d.length; i++)
    if (wl.d[i] >>> 24) {
      const d = Math.hypot((i % W) - rootX, Math.floor(i / W) - rootY);
      if (d > wmax) wmax = d;
    }
  let landed = 0;
  let total = 0;
  const layer = (src: KB, isWing: boolean) => {
    for (let i = 0; i < src.d.length; i++) {
      const c = src.d[i];
      if (!(c >>> 24)) continue;
      const x = i % W;
      const y = Math.floor(i / W);
      total++;
      const n = hash(x, y, 71);
      const tau = isWing
        ? 0.46 + 0.42 * (1 - Math.hypot(x - rootX, y - rootY) / wmax) + n * 0.1
        : 0.82 + 0.42 * clampK((y - top) / Math.max(1, G - top), 0, 1) + n * 0.1;
      // Перед осыпанием: трещины угля по латам.
      if (t < tau) {
        res.d[i] = c;
        if (!isWing && t > 0.55 && hash(x * 3, y * 5, 9) < (t - 0.55) * 0.22) {
          res.d[i] = C.ember;
          lit.mix(x, y, C.ember, 0.75);
        }
        continue;
      }
      const a = t - tau;
      if (a < 0.05) {
        res.set(x, y, C.emberHi);
        lit.mix(x, y, C.ember, 0.9);
        continue;
      }
      if (n < 0.18) {
        // Уголь: вверх и гаснет.
        if (a > 0.4) continue;
        const ux = x + (hash(x, y, 3) - 0.5) * a * 8;
        const uy = y - a * 22 - a * a * 10;
        lit.mix(ux, uy, n < 0.08 ? C.emberHi : C.ember, 0.9 - a * 2);
        continue;
      }
      // Пепел: падает с разгоном и ложится.
      const fy = y + a * 6 + a * a * 55;
      if (fy >= G) {
        landed++;
        continue;
      }
      const fx = x + (hash(x, y, 4) - 0.5) * a * 10;
      res.put(fx, fy, n < 0.5 ? C.ash : C.ashLt);
    }
  };
  layer(wl, true);
  layer(body, false);
  // Горка пепла у колена растёт с упавшим.
  const k = total ? landed / total : 0;
  if (k > 0.02) {
    const hgt = 1 + k * 5;
    const wdt = 5 + k * 10;
    kEll(
      res,
      KX0 + 1,
      G - hgt * 0.5,
      wdt,
      hgt,
      t4(tn('#1a1210', '#2e2220', '#46342e', '#5e4a42')),
      -0.1,
    );
    for (let i = 0; i < 6; i++) {
      const ex = KX0 + 1 + (hash(i, 7, 1) - 0.5) * wdt * 1.6;
      if (hash(i, Math.floor(t * 12), 2) < 0.5) lit.mix(ex, G - hgt * 0.4, C.ember, 0.6);
    }
  }
  // Меч стоит до конца.
  kOver(res, sword);
  kOutline(res, C.ink);
  // Свет углей тела поверх.
  for (let i = 0; i < litIn.d.length; i++) if (litIn.d[i] >>> 24 && t < 0.8) lit.d[i] = litIn.d[i];
  return { p: res.px, lit: lit.used ? lit.px : null };
}

// ---- Анфас: трон, приказ, подъём, гроза, крылья, рёв ----

function fThrone(ph: number): FRig {
  const a = ph * TAU;
  const r = { ...SEAT };
  r.bow = -0.5 * Math.round(0.5 - 0.5 * Math.cos(a * 2));
  r.cw = a;
  r.cape = 0.4 * Math.sin(a);
  r.eyes = ph > 0.88 && ph < 0.93 ? 0 : 1;
  // Барабанит когтями по навершию: два удара за круг.
  const tap = (c: number) => Math.max(0, 1 - Math.abs(ph - c) / 0.035);
  r.ron = 1 - 0.28 * Math.max(tap(0.3), tap(0.38));
  return r;
}

function fCommand(t: number): FRig {
  const keys: Key<FKey>[] = [
    [0, {}],
    // Подался вперёд, упёрся в навершие — сейчас встанет.
    [0.22, { bow: 1, hd: 0.3, eyes: 2, by: 0.5, cape: 1 }, eIO],
    // Встал, меч выдернут из помоста и поднят в правой руке.
    [
      0.55,
      {
        sit: 0,
        bow: 0,
        hd: -0.1,
        by: 0,
        lon: 0,
        gx: 12,
        gy: 7,
        gz: 1,
        yaw: 0.15,
        pit: 1.3,
        clip: 0,
        lx: -4,
        ly: 3,
        eyes: 2,
        cape: 2,
        cup: 1,
        st: 1,
      },
      eOut,
    ],
    // Замах свободной рукой через грудь…
    [0.72, { lx: 6, ly: -4, hs: 0.1, bow: 0.3 }, eOut],
    // …и взмах к дверям: «СТРАЖА!»
    [
      0.8,
      {
        lx: -14,
        ly: 2,
        jaw: 1,
        eyes: 3,
        hs: -0.14,
        hd: -0.2,
        bow: -0.3,
        cape: 4,
        cup: 3,
        hair: 0.8,
        st: 2,
        fsx: 1.04,
        fsy: 0.96,
        aura: 0.6,
        claw: 1,
      },
      eOut3,
    ],
    [0.95, { fsx: 1, fsy: 1, aura: 0.3 }, eOut],
    [1.3, { jaw: 0.6, cape: 2, cup: 1, hair: 0.4, lx: -13, ly: 1, hd: -0.1, bow: 0, aura: 0 }, eIO],
    [2.1, { jaw: 0.1, eyes: 2, lx: -12, ly: 2, cape: 1, cup: 0.5, hair: 0.2 }, eIO],
    // Садится обратно, меч — в помост.
    [
      2.45,
      { sit: 0.35, lx: -4, ly: 8, pit: -1.0, gy: -4, gx: 6, hs: 0, st: 0, hd: 0.1, claw: 0 },
      eIO,
    ],
    [KING.cmd, { ...SEAT }, eIO],
  ];
  const r = fTrack(keys, t, SEAT);
  r.cw = t * 5;
  // Пока ждёт стражу — дышит, рука подрагивает, плащ ходит.
  if (t > 0.95 && t < 2.1) {
    r.by += Math.round(0.5 - 0.5 * Math.cos((t - 0.95) * 6));
    r.ly += Math.sin((t - 0.95) * 6) * 0.6;
  }
  return r;
}

const RISE_HIT = 1.4;

function fRise(t: number, from: FRig | null): FRig {
  const keys: Key<FKey>[] = [
    [0, {}],
    // Удар до засечки: вздрогнул, угли глаз вспыхнули.
    [0.1, { bow: -0.4, hd: -0.3, eyes: 3, fdy: -1, aura: 0.3 }, eOut],
    // Голова падает — поднимается тяжело, опираясь на меч.
    [0.22, { bow: 0.8, hd: 0.35, fdy: 0, sit: 0.6, by: 1 }, eIO],
    [
      0.5,
      {
        sit: 0,
        bow: 0.6,
        hd: 0.3,
        by: 1.5,
        ron: 1,
        lon: 1,
        gx: 0,
        gy: -8,
        gz: 3,
        pit: -Math.PI / 2,
        clip: 1,
        cape: 1.5,
        aura: 0.5,
        glow: 0.4,
      },
      eIO,
    ],
    // Поднимает голову — сила собирается, плащ и волосы встают.
    [
      0.85,
      { bow: 0.2, hd: -0.05, by: 1, eyes: 3, aura: 0.8, cup: 3, hair: 0.6, cape: 2.5, glow: 0.7 },
      eIO,
    ],
    // Выдёргивает меч и заносит над правым плечом.
    [
      1.12,
      {
        lon: 0,
        lx: -6,
        ly: 2,
        gx: 10,
        gy: 10,
        gz: 0,
        yaw: 0,
        pit: 1.35,
        clip: 0,
        bow: -0.4,
        hd: -0.25,
        by: -1,
        jaw: 0.4,
        glow: 1,
        aura: 1,
      },
      eOut,
    ],
    [RISE_HIT - 2 * F1, { gx: 9, gy: 12, pit: 1.85, by: -2, hd: -0.3, lx: -8, ly: -2 }, eOut],
    // Рубит наискось в помост — волна (урон) в этот кадр.
    [
      RISE_HIT,
      {
        gx: -1,
        gy: -8,
        gz: 5,
        yaw: Math.PI / 2 + 0.35,
        pit: -1.1,
        clip: 1,
        by: 4,
        bow: 1,
        hd: 0.35,
        jaw: 1,
        lon: 1,
        fsx: 1.08,
        fsy: 0.9,
        cape: 5,
        cup: 5,
        hair: 1,
        arc: 1,
        aura: 1,
      },
      eIn,
    ],
    [RISE_HIT + 0.1, { fsx: 1, fsy: 1, by: 3, cup: 2, arc: 0.4 }, eOut],
    [1.6, { jaw: 0.2, hair: 0.4, eyes: 2, arc: 0, aura: 0.4, cup: 1 }, eIO],
    // Выпрямился и сошёл с помоста к зрителю (мозг сдвинет его на 0,6 клетки).
    [KING.rise, { ...FRONT, glow: 0.3, eyes: 2, fdy: 9.6, cape: 1, aura: 0 }, eIO],
  ];
  const r = fTrack(keys, t, SEAT);
  r.cw = t * 6;
  // Плечи ходят от тяжёлого дыхания, пока собирается сила.
  if (t > 0.5 && t < 1.05) r.by += Math.round(0.5 - 0.5 * Math.cos((t - 0.5) * 11));
  if (from && t < 0.35) return blendF(from, r, eIO(t / 0.35));
  return r;
}

function fStorm(t: number, k: KT): FRig {
  const Tc = tStormCall(k);
  const Te = tStormEnd(k);
  const keys: Key<FKey>[] = [
    [0, {}],
    // Присел, обе руки на рукояти у правого бедра.
    [
      Tc * 0.55,
      {
        by: 3,
        bow: 0.8,
        hd: 0.3,
        lon: 1,
        gx: 6,
        gy: -8,
        gz: 2,
        yaw: 0.3,
        pit: -1.3,
        eyes: 2,
        glow: 0.6,
        cape: 1,
        aura: 0.3,
      },
      eIO,
    ],
    // Меч — в небо над правым плечом, левая рука вверх.
    [
      Tc - F1,
      {
        by: -1,
        bow: -0.3,
        hd: -0.2,
        lon: 0,
        lx: -4,
        ly: -9,
        gx: 10,
        gy: 9,
        gz: 0,
        yaw: 0,
        pit: 1.35,
        glow: 0.9,
        eyes: 3,
      },
      eOut3,
    ],
    // Молния в клинок.
    [
      Tc,
      {
        by: -2,
        gx: 11,
        gy: 12,
        pit: Math.PI / 2,
        lx: -2,
        ly: -14,
        claw: 1,
        bow: -0.6,
        hd: -0.4,
        jaw: 0.8,
        arc: 1,
        glow: 1,
        cape: 3,
        cup: 3,
        hair: 1,
        fsx: 0.96,
        fsy: 1.06,
        aura: 0.9,
      },
      eOut,
    ],
    [Tc + 0.15, { fsx: 1, fsy: 1, jaw: 0.5, arc: 0.8, aura: 0.6 }, eOut],
    [Te - 0.3, { arc: 0.45, jaw: 0.2, by: -1.5, hair: 0.8, cup: 2, aura: 0.4 }, eIO],
    [Te - 0.14, { arc: 0, aura: 0.1 }, eLin],
    [Te, { ...FRONT, eyes: 2 }, eIO],
  ];
  const r = fTrack(keys, t, FRONT);
  r.cw = t * 9;
  // Держит грозу: тело дрожит от разряда.
  if (t > Tc && t < Te - 0.3) r.fdx += (hash(Math.floor(t * FPS), 21) - 0.5) * 0.9;
  return r;
}

function fUnfurl(t: number): FRig {
  const keys: Key<FKey>[] = [
    [0, { wo: 0, wf: 0.3 }],
    // Сгорбился: из спины рвутся крылья.
    [
      0.28,
      {
        by: 3,
        bow: 1.2,
        hd: 0.4,
        lx: 4,
        ly: 4,
        gx: 8,
        gy: -8,
        pit: -1.3,
        eyes: 2,
        wo: 0.08,
        wf: 0.6,
        cape: 1,
        fsx: 1.05,
        fsy: 0.95,
        aura: 0.4,
      },
      eIO,
    ],
    [
      0.55,
      { by: 1, bow: 0.4, hd: 0.1, wo: 0.4, wf: -0.9, eyes: 3, fsx: 1, fsy: 1, aura: 0.7 },
      eIO,
    ],
    // Настежь, вверх — голова запрокинута.
    [
      0.78,
      {
        by: -1,
        bow: -0.5,
        hd: -0.35,
        wo: 1,
        wf: -0.7,
        jaw: 0.8,
        lx: -13,
        ly: -4,
        gx: 14,
        gy: 2,
        pit: 0.3,
        cape: 3,
        cup: 2,
        hair: 0.6,
        aura: 1,
      },
      eOut,
    ],
    // Первый взмах — ветер.
    [0.95, { wf: 0.7, by: 1, fsx: 1.03, fsy: 0.97, cape: 5, cup: 5, hair: 1 }, eOut3],
    [1.15, { wf: -0.2, wo: 0.95, by: 0, jaw: 0.2, fsx: 1, fsy: 1, cup: 1, aura: 0.3 }, eIO],
    [KING.unfurl, { ...FRONT, wo: 0.7, wf: 0, eyes: 2 }, eIO],
  ];
  const r = fTrack(keys, t, { ...FRONT, wo: 0, wf: 0.3 });
  r.cw = t * 8;
  return r;
}

function fRoar(t: number, f: number): FRig {
  const keys: Key<FKey>[] = [
    [0, {}],
    // Вдох: грудь вперёд, голова вниз, крылья прижаты.
    [
      0.35,
      {
        by: 2,
        bow: 1,
        hd: 0.45,
        wo: 0.35,
        wf: 0.3,
        lx: 3,
        ly: 5,
        gx: 6,
        gy: -6,
        pit: -1.2,
        eyes: 2,
        cape: 0,
        aura: 0.3,
      },
      eIO,
    ],
    // Рёв: голова назад, руки и крылья врозь.
    [
      0.5,
      {
        by: -1,
        bow: -0.7,
        hd: -0.5,
        jaw: 1,
        wo: 1,
        wf: -0.5,
        lx: -14,
        ly: -6,
        claw: 1,
        gx: 15,
        gy: 4,
        gz: 1,
        yaw: 0,
        pit: 0.6,
        eyes: 3,
        glow: 1,
        cape: 4,
        cup: 3,
        hair: 1,
        aura: 1,
      },
      eOut3,
    ],
    [1.3, { jaw: 0.9, wf: -0.35, cape: 4, cup: 3, aura: 0.8 }, eLin],
    [KING.roar, { ...FRONT, wo: 0.5, jaw: 0, eyes: 2, aura: 0.3 }, eIO],
  ];
  const r = fTrack(keys, t, { ...FRONT, wo: 0.6 });
  r.cw = t * 12;
  // Дрожь рёва — от шума кадра, а не два кадра по очереди.
  if (t > 0.5 && t < 1.3) {
    r.fdx += (hash(f, 11) - 0.5) * 1.4;
    r.fdy += (hash(f, 12) - 0.5) * 0.8;
    r.aura += (hash(f, 13) - 0.5) * 0.3;
  }
  return r;
}

/** Разряды по клинку и молния сверху в острие (слой света). */
function kArcs(b: KB, lit: KB, bl: Blade, k: number, f: number, strike: boolean): void {
  if (k <= 0) return;
  const tx = bl.gx + bl.ux * bl.len;
  const ty = bl.gy + bl.uy * bl.len;
  const nx = -bl.uy;
  const ny = bl.ux;
  const n = 2 + Math.round(k * 2);
  for (let a = 0; a < n; a++) {
    let px = bl.gx + bl.ux * (3 + hash(f, a, 1) * 6);
    let py = bl.gy + bl.uy * (3 + hash(f, a, 1) * 6);
    const steps = 4 + Math.floor(hash(f, a, 2) * 4);
    for (let s = 0; s < steps; s++) {
      const along = (bl.len / steps) * (0.6 + hash(f, a * 7 + s, 3) * 0.6);
      const side = (hash(f, a * 7 + s, 4) - 0.5) * 6 * k;
      const qx = px + bl.ux * along + nx * side;
      const qy = py + bl.uy * along + ny * side;
      const m = Math.ceil(Math.max(Math.abs(qx - px), Math.abs(qy - py)));
      for (let i = 0; i <= m; i++) {
        const x = px + ((qx - px) * i) / (m || 1);
        const y = py + ((qy - py) * i) / (m || 1);
        lit.mix(x, y, i % 3 ? C.arcMid : C.arc, 0.95);
        if (k > 0.6) lit.mix(x + nx, y + ny, C.arcDim, 0.4);
      }
      px = qx;
      py = qy;
    }
  }
  // Корона искр на острие.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + f * 0.7;
    const r = 1.5 + hash(f, i, 5) * 2.5 * k;
    lit.mix(tx + Math.cos(a) * r, ty + Math.sin(a) * r, C.arc, 0.9);
  }
  lit.mix(tx, ty, C.smW, 1);
  b.put(tx, ty, C.arc);
  if (!strike) return;
  // Молния с неба в острие.
  let x = tx + (hash(f, 9) - 0.5) * 6;
  let y = 0;
  while (y < ty - 1) {
    const ny2 = Math.min(ty, y + 3 + hash(f, y, 6) * 4);
    const nx2 = ny2 >= ty ? tx : x + (hash(f, y, 7) - 0.5) * 5;
    const m = Math.ceil(Math.max(Math.abs(nx2 - x), ny2 - y));
    for (let i = 0; i <= m; i++) {
      const xx = x + ((nx2 - x) * i) / (m || 1);
      const yy = y + ((ny2 - y) * i) / (m || 1);
      lit.mix(xx, yy, C.smW, 1);
      lit.mix(xx - 1, yy, C.arcMid, 0.55);
      lit.mix(xx + 1, yy, C.arcMid, 0.55);
    }
    x = nx2;
    y = ny2;
  }
}

// ---- Кадр: техника + номер → риг → растр → холсты (кеш, зеркало, вспышка) ----

type KTech =
  | 'idle'
  | 'walk'
  | 'slash'
  | 'cleave'
  | 'takeoff'
  | 'air'
  | 'dive'
  | 'landed'
  | 'death'
  | 'throne'
  | 'command'
  | 'rise'
  | 'storm'
  | 'unfurl'
  | 'roar';

const FRONT_TECH: Partial<Record<KTech, boolean>> = {
  throne: true,
  command: true,
  rise: true,
  storm: true,
  unfurl: true,
  roar: true,
};

interface KReq {
  tech: KTech;
  f: number;
  /** Вариант начала (откуда пришли) — только у первых кадров подъёма. */
  v: number;
  hk: number;
  echo: boolean;
  wings: boolean;
  glow: boolean;
  rage: boolean;
  /** Вздрог от удара героя (покой и шаг): 0…2. */
  fl: number;
  flip: boolean;
  flash: boolean;
}

/** Сколько кадров в технике и когда урон (−1 — нет). */
function kSpan(tech: KTech, k: KT): { n: number; hit: number } {
  const n = (s: number) => Math.ceil(s * FPS - 1e-6) + 1;
  switch (tech) {
    case 'idle':
    case 'throne':
      return { n: 24, hit: -1 };
    case 'walk':
      return { n: 8, hit: -1 };
    case 'slash':
      return { n: n(tSlash(k) + tRec(k)), hit: tSlash(k) };
    case 'cleave':
      return { n: n(tCleave(k) + tStuck(k) + tRec(k)), hit: tCleave(k) };
    case 'takeoff':
      return { n: n(0.6), hit: -1 };
    case 'air':
      return { n: n(KING.airT), hit: -1 };
    case 'dive':
      return { n: 5, hit: -1 };
    case 'landed':
      return { n: n(tLanded(k)), hit: -1 };
    case 'death':
      return { n: n(DEATH_T), hit: -1 };
    case 'command':
      return { n: n(KING.cmd), hit: 0.8 };
    case 'rise':
      return { n: n(KING.rise), hit: RISE_HIT };
    case 'storm':
      return { n: n(tStormEnd(k)), hit: tStormCall(k) };
    case 'unfurl':
      return { n: n(KING.unfurl), hit: -1 };
    case 'roar':
      return { n: n(KING.roar), hit: -1 };
  }
}

/** Время кадра: 24 к/с, а кадр, в котором урон, — ровно в миг урона. */
function kTime(f: number, hit: number): number {
  const t = f / FPS;
  if (hit >= 0 && hit >= t && hit < t + F1) return hit;
  return t;
}

function sideAt(tech: KTech, t: number, k: KT, rage: boolean): SRig {
  switch (tech) {
    case 'walk':
      return sWalk(t, rage);
    case 'slash':
      return sSlash(t, k);
    case 'cleave':
      return sCleave(t, k);
    case 'takeoff':
      return sTakeoff(t);
    case 'air':
      return sAir(t);
    case 'dive':
      return sDive(t);
    case 'landed':
      return sLanded(t, k);
    case 'death':
      return sDeath(t);
    default:
      return sIdle(t, rage);
  }
}

function frontAt(tech: KTech, t: number, k: KT, v: number, f: number): FRig {
  switch (tech) {
    case 'command':
      return fCommand(t);
    case 'rise':
      return fRise(t, v > 0 ? fCommand((v - 1) / FPS) : null);
    case 'storm':
      return fStorm(t, k);
    case 'unfurl':
      return fUnfurl(t);
    case 'roar':
      return fRoar(t, f);
    default:
      return fThrone(t);
  }
}

/** Время позы для кадра запроса (петли — фаза 0…1). */
function reqTime(q: KReq, k: KT): number {
  if (q.tech === 'idle' || q.tech === 'throne') return q.f / 24;
  if (q.tech === 'walk') return q.f / 8;
  return kTime(q.f, kSpan(q.tech, k).hit);
}

/** Когда тянется след меча: только удар (и рывок из пола), а не замах. */
function smearWin(tech: KTech, k: KT): [number, number][] {
  switch (tech) {
    case 'slash':
      return [[tSlash(k) - 3.5 * F1, tSlash(k) + 0.14]];
    case 'cleave': {
      const T = tCleave(k);
      const S = tStuck(k);
      return [
        [T - 3.5 * F1, T + 0.1],
        [T + S + 0.01, T + S + 0.2],
      ];
    }
    case 'rise':
      return [[RISE_HIT - 3 * F1, RISE_HIT + 0.1]];
    case 'storm':
      return [[tStormCall(k) - 2.5 * F1, tStormCall(k) + 0.06]];
    case 'dive':
      return [[0, 0.2]];
    default:
      return [];
  }
}

/** Выборки клинка назад во времени, не раньше начала окна следа. */
function smearTimes(tech: KTech, k: KT, t: number): number[] | null {
  for (const [a, b] of smearWin(tech, k)) {
    if (t < a || t > b) continue;
    const out: number[] = [];
    for (let i = 0; i <= 9; i++) {
      const s = t - i / 72;
      if (s < a - 1e-6) break;
      out.push(s);
    }
    return out.length > 1 ? out : null;
  }
  return null;
}

const KFR = frameLRU<MobFrame>(500);

/** Холст из растра, обрезанный по рамке (`x0, y0` — левый верх). */
function cutCanvas(p: Px, x0: number, y0: number, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (g) {
    // Только рамка: строки копируются срезами, без полного холста.
    const img = g.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      const o = ((y0 + y) * p.w + x0) * 4;
      img.data.set(p.data.subarray(o, o + w * 4), y * w * 4);
    }
    g.putImageData(img, 0, 0);
  }
  return c;
}

function bbox(p: Px, box: number[]): void {
  const d = new Uint32Array(p.data.buffer, p.data.byteOffset, p.w * p.h);
  for (let y = 0; y < p.h; y++) {
    const row = y * p.w;
    for (let x = 0; x < p.w; x++)
      if (d[row + x] >>> 24) {
        if (x < box[0]) box[0] = x;
        if (y < box[1]) box[1] = y;
        if (x > box[2]) box[2] = x;
        if (y > box[3]) box[3] = y;
      }
  }
}

/** Кадр без зеркала и вспышки. */
function kingBase(q: KReq): MobFrame {
  const key = `b|${q.tech}|${q.v}|${q.hk}|${q.echo ? 1 : 0}|${q.f}|${q.wings ? 1 : 0}|${q.glow ? 1 : 0}|${q.rage ? 1 : 0}|${q.fl}`;
  const got = KFR.get(key);
  if (got) return got;
  const k: KT = { h: q.hk / 100, echo: q.echo };
  const t = reqTime(q, k);
  const o: KOpt = { wings: q.wings, glow: q.glow ? 0.3 : 0, rage: q.rage, smear: null, arcF: q.f };
  const front = !!FRONT_TECH[q.tech];
  let p: Px;
  let lit: Px | null;
  let eye: [number, number] | null;
  let ax: number;
  let tf: { fdx: number; fdy: number; fsx: number; fsy: number; frot: number; lift: number };
  if (front) {
    const r = frontAt(q.tech, t, k, q.v, q.f);
    if (q.tech === 'throne' && q.fl) {
      r.aura = 1;
      r.eyes = 3;
    }
    const st = smearTimes(q.tech, k, t);
    if (st)
      o.smear = st.map((s, i) => {
        const rr = i ? frontAt(q.tech, s, k, q.v, q.f) : r;
        return frontBlade(rr, frontGeo(rr));
      });
    o.bolt = q.tech === 'storm' && Math.abs(t - tStormCall(k)) < 1e-6;
    const out = paintFront(r, o);
    p = out.p;
    lit = out.lit;
    eye = out.eye;
    ax = FCX;
    tf = r;
  } else {
    const r = sideAt(q.tech, t, k, q.rage);
    // Третья фаза: король горит — жар по краю силуэта, неровный, как пламя.
    if (q.rage && q.tech !== 'death') r.aura = Math.max(r.aura, 0.22 + 0.14 * hash(q.f, 31));
    if (q.fl > 0) {
      const s = q.fl / 2;
      r.lean -= 0.12 * s;
      r.hd -= 0.3 * s;
      r.jaw = Math.max(r.jaw, 0.45 * s);
      r.eyes = 3;
      r.cape += 1.5 * s;
      r.gx -= 1 * s;
    }
    const st = smearTimes(q.tech, k, t);
    if (st)
      o.smear = st.map((s, i) => {
        const rr = i ? sideAt(q.tech, s, k, q.rage) : r;
        return sideBlade(rr, sideGeo(rr));
      });
    if (q.tech === 'death') {
      const out = paintSide(r, o, true);
      const g = sideGeo(r);
      const wr = g.T(-3, 13);
      const c = crumble(out, out.sword!, t, wr[0], wr[1]);
      p = c.p;
      lit = c.lit;
      eye = t < 0.8 ? out.eye : null;
    } else {
      const out = paintSide(r, o);
      p = out.p;
      lit = out.lit;
      eye = out.eye;
    }
    ax = KX0;
    tf = r;
  }
  // Холст — по рамке нарисованного (кадров сотни — память).
  const box = [KW, KH, -1, -1];
  bbox(p, box);
  if (lit) bbox(lit, box);
  if (box[2] < 0) box.splice(0, 4, ax, KGY - 1, ax, KGY);
  const x0 = Math.max(0, box[0] - 1);
  const y0 = Math.max(0, box[1] - 1);
  const w = Math.min(KW, box[2] + 2) - x0;
  const h = Math.min(KH, box[3] + 2) - y0;
  const air = tf.lift;
  const out: MobFrame = {
    img: cutCanvas(p, x0, y0, w, h),
    lit: lit ? cutCanvas(lit, x0, y0, w, h) : null,
    ax: ax - x0,
    ay: KGY - y0,
    eye: eye ? [eye[0] - x0, eye[1] - y0] : null,
    dx: tf.fdx,
    dy: tf.fdy - air,
    sx: tf.fsx,
    sy: tf.fsy,
    rot: tf.frot,
    still: true,
    shadow: (front ? 16 : 15) * (1 - clampK(air / AIR_H, 0, 1.2) * 0.3),
  };
  return KFR.set(key, out);
}

function mirrorK(src: HTMLCanvasElement): HTMLCanvasElement {
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

function flashK(src: HTMLCanvasElement): HTMLCanvasElement {
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

function kingFrame(q: KReq): MobFrame {
  if (!q.flip && !q.flash) return kingBase(q);
  const key = `v|${q.tech}|${q.v}|${q.hk}|${q.echo ? 1 : 0}|${q.f}|${q.wings ? 1 : 0}|${q.glow ? 1 : 0}|${q.rage ? 1 : 0}|${q.fl}|${q.flip ? 1 : 0}|${q.flash ? 1 : 0}`;
  const got = KFR.get(key);
  if (got) return got;
  if (q.flash) {
    const src = kingFrame({ ...q, flash: false });
    return KFR.set(key, { ...src, img: flashK(src.img) });
  }
  const b = kingBase({ ...q, flip: false });
  const w = b.img.width;
  return KFR.set(key, {
    ...b,
    img: mirrorK(b.img),
    lit: b.lit ? mirrorK(b.lit) : null,
    eye: b.eye ? [w - 1 - b.eye[0], b.eye[1]] : null,
    ax: w - b.ax,
    dx: -(b.dx ?? 0),
    rot: -(b.rot ?? 0),
  });
}

// ---- Рисовальщик: режим мозга → техника и кадр; память о прошлом режиме. ----

interface KMem {
  mode: string;
  prev: string;
  lastT: number;
  prevT: number;
  walk: number;
  now: number;
  flip: boolean;
}
const kMem = new WeakMap<Mob, KMem>();

function kMemOf(m: Mob, pose: MobPose): { s: KMem; fresh: boolean } {
  let s = kMem.get(m);
  const fresh = !s;
  if (!s) {
    s = {
      mode: pose.mode,
      prev: '',
      lastT: pose.t,
      prevT: 0,
      walk: 0,
      now: pose.now,
      flip: pose.left,
    };
    kMem.set(m, s);
  }
  if (pose.mode !== s.mode) {
    s.prev = s.mode;
    s.prevT = s.lastT;
    s.mode = pose.mode;
  }
  s.lastT = pose.t;
  const dt = clampK(pose.now - s.now, 0, 0.1);
  s.now = pose.now;
  s.walk += Math.hypot(m.vx ?? 0, m.vy ?? 0) * 16 * dt;
  return { s, fresh };
}

const WALK_STRIDE = 28;

function kingReq(m: Mob, pose: MobPose): KReq {
  const { s, fresh } = kMemOf(m, pose);
  const echo = m.kind !== 'f10boss';
  const phase = m.data?.phase ?? 0;
  const h = echo ? 1 : phase >= 3 ? 1.3 : phase >= 2 ? 1.15 : 1;
  const k: KT = { h, echo };
  const t = Math.max(0, pose.t);
  const q: KReq = {
    tech: 'idle',
    f: 0,
    v: 0,
    hk: Math.round(h * 100),
    echo,
    wings: !echo && phase >= 2,
    glow: phase >= 1,
    rage: !echo && phase >= 3,
    fl: 0,
    flip: pose.left,
    // Смерть белым не мигает: копия убранного моба держит последнюю вспышку.
    flash: pose.flash && (pose.mode !== 'dying' || pose.t < 0.08),
  };
  const at = (tech: KTech, tt: number) => {
    q.tech = tech;
    q.f = Math.min(kSpan(tech, k).n - 1, Math.floor(tt * FPS + 1e-6));
  };
  switch (pose.mode) {
    case 'f10_throne':
      q.tech = 'throne';
      q.f = Math.floor(pose.now * 10 + (m.id ?? 0) * 3.7) % 24;
      q.flip = false;
      // Удар по сидящему отбивает тьма: не белая вспышка, а жар по силуэту.
      if ((m.flash ?? 0) > 0) {
        q.fl = 1;
        q.flash = false;
      }
      break;
    case 'f10_command':
      at('command', t);
      q.flip = false;
      break;
    case 'f10_rise': {
      at('rise', t);
      // Подъём прерывает приказ: первые кадры — из той позы, где его застал.
      const hint = m.data?.vCmd;
      const cmdT = hint !== undefined ? hint : s.prev === 'f10_command' ? s.prevT : -1;
      if (q.f < 9 && cmdT >= 0)
        q.v = Math.min(kSpan('command', k).n - 1, Math.floor(cmdT * FPS)) + 1;
      q.flip = false;
      break;
    }
    case 'f10_storm':
      at('storm', t);
      q.flip = false;
      break;
    case 'f10_unfurl':
      at('unfurl', t);
      q.flip = false;
      break;
    case 'f10_roar':
      at('roar', t);
      q.flip = false;
      break;
    case 'slash':
      at('slash', t);
      break;
    case 'cleave':
      at('cleave', t);
      break;
    case 'stuck':
      at('cleave', tCleave(k) + t);
      break;
    case 'recover': {
      const hint = m.data?.vFrom;
      const from = hint ?? (s.prev === 'slash' ? 1 : s.prev === 'stuck' ? 2 : 0);
      if (from === 1) at('slash', tSlash(k) + t);
      else if (from === 2) at('cleave', tCleave(k) + tStuck(k) + t);
      else q.tech = 'idle';
      break;
    }
    case 'f10_takeoff':
      at('takeoff', t);
      break;
    case 'f10_air':
      at('air', t);
      // В воздухе смотрит туда, куда летит.
      if (Math.abs(m.vx ?? 0) > 0.6) s.flip = (m.vx ?? 0) < 0;
      else if (fresh) s.flip = pose.left;
      q.flip = s.flip;
      break;
    case 'f10_dive': {
      at('dive', t);
      const ddx = (m.data?.dx ?? m.x) - (m.data?.sx ?? m.x);
      if (Math.abs(ddx) > 0.2) s.flip = ddx < 0;
      q.flip = s.flip;
      break;
    }
    case 'f10_landed':
      at('landed', t);
      q.flip = s.flip;
      break;
    case 'dying':
      at('death', t);
      break;
    default:
      if (pose.anim === 'run' || Math.hypot(m.vx ?? 0, m.vy ?? 0) > 0.4) {
        q.tech = 'walk';
        const d = fresh ? pose.now * Math.hypot(m.vx ?? 0, m.vy ?? 0) * 16 : s.walk;
        q.f = Math.floor(((d / WALK_STRIDE) % 1) * 8) % 8;
      } else {
        q.tech = 'idle';
        q.f = Math.floor(pose.now * 10 + (m.id ?? 0) * 3.7) % 24;
      }
      const fl = m.flash ?? 0;
      q.fl = fl > 0.07 ? 2 : fl > 0.01 ? 1 : 0;
  }
  if (pose.mode !== 'f10_air' && pose.mode !== 'f10_dive' && pose.mode !== 'f10_landed')
    s.flip = q.flip;
  return q;
}

registerMobPainter('f10boss', (m: Mob, pose: MobPose) => {
  const q = kingReq(m, pose);
  const fr = kingFrame(q);
  const out: MobFrame = { ...fr };
  const k: KT = { h: q.hk / 100, echo: q.echo };
  const t = Math.max(0, pose.t);
  // Шлейф: пике, толчок взлёта, взмах меча.
  if (q.tech === 'dive') out.ghost = { every: 0.025, life: 0.22, tint: '#c01c2a', alpha: 0.42 };
  else if (q.tech === 'takeoff' && t > 0.14 && t < 0.5)
    out.ghost = { every: 0.045, life: 0.2, tint: '#7a1422', alpha: 0.28 };
  else if (q.tech === 'slash' || q.tech === 'cleave') {
    const T = q.tech === 'slash' ? tSlash(k) : tCleave(k);
    const tt = q.f / FPS;
    if (tt > T - 3.5 * F1 && tt < T + F1)
      out.ghost = { every: 0.03, life: 0.14, tint: '#8a1020', alpha: 0.22 };
  }
  if (q.tech === 'death') out.linger = DEATH_T;
  // Высота полёта — плавно по времени режима, а не ступеньками кадров 24 к/с:
  // тень и мир движутся на каждом кадре экрана, король — вместе с ними.
  if (q.tech === 'takeoff' || q.tech === 'air' || q.tech === 'dive') {
    const lq = sideAt(q.tech, reqTime(q, k), k, false).lift;
    const le = sideAt(q.tech, Math.min(t, kSpan(q.tech, k).n / FPS), k, false).lift;
    out.dy = (out.dy ?? 0) + lq - le;
  }
  // В воздухе: крен вперёд по скорости полёта (только трансформ, кадр тот же).
  if (q.tech === 'air') {
    const v = Math.min(7, Math.hypot(m.vx ?? 0, m.vy ?? 0));
    out.rot = (out.rot ?? 0) + v * 0.024 * (q.flip ? -1 : 1);
  }
  // Смерть гаснет в самом конце.
  if (q.tech === 'death' && t > DEATH_T - 0.15) out.alpha = clampK((DEATH_T - t) / 0.15, 0, 1);
  // Отдача от удара героя: по направлению удара, с возвратом.
  const fl = m.flash ?? 0;
  if (fl > 0 && pose.mode !== 'dying') {
    const sim = paintSim();
    const age = clampK(0.12 - fl, 0, 0.12);
    let ux = q.flip ? 1 : -1;
    let uy = 0;
    if (sim) {
      const dx = m.x - sim.hero.x;
      const dy = m.y - sim.hero.y;
      const d = Math.hypot(dx, dy) || 1;
      ux = dx / d;
      uy = dy / d;
    }
    const soft =
      q.tech === 'idle' || q.tech === 'walk' || q.tech === 'landed' || q.tech === 'command';
    const kk = Math.sin((age / 0.12) * Math.PI) * (soft ? 2.2 : 0.9);
    out.dx = (out.dx ?? 0) + ux * kk;
    out.dy = (out.dy ?? 0) + uy * kk * 0.6;
  }
  return out;
});

// Прогрев: первый бой — трон, приказ, подъём (анфас), потом профиль фазы 1.
registerMobWarm('f10boss', function* () {
  const base = {
    v: 0,
    hk: 100,
    echo: false,
    wings: false,
    rage: false,
    fl: 0,
    flip: false,
    flash: false,
  };
  const list: [KTech, boolean][] = [
    ['throne', false],
    ['command', false],
    ['rise', true],
    ['idle', true],
    ['walk', true],
    ['slash', true],
    ['cleave', true],
    ['storm', true],
  ];
  for (const [tech, glow] of list) {
    const n = kSpan(tech, { h: 1, echo: false }).n;
    const front = !!FRONT_TECH[tech];
    for (let f = 0; f < n; f++) {
      kingBase({ ...base, tech, f, glow });
      yield f;
      // Профиль — в обе стороны (зеркало из готового кадра, дёшево).
      if (!front) {
        kingFrame({ ...base, tech, f, glow, flip: true });
        yield f;
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Реквизит замка. Живое (огонь, фонтаны, знамёна, цепи, молнии в окнах)
// перещёлкивает кадры по времени; всё собирается один раз на кадр.
// ---------------------------------------------------------------------------

const props = new Map<string, Sprite>();

function sprite(key: string, make: () => { p: Px; ax: number; ay: number } | null): Sprite | null {
  const hit = props.get(key);
  if (hit) return hit;
  const b = make();
  if (!b) return null;
  const s: Sprite = { img: b.p.canvas(), ax: b.ax, ay: b.ay };
  props.set(key, s);
  return s;
}

const flashed = (
  key: string,
  flash: boolean,
  make: () => { p: Px; ax: number; ay: number } | null,
) =>
  sprite(`${key}|${flash ? 1 : 0}`, () => {
    const b = make();
    if (!b) return null;
    if (flash) b.p = b.p.tint(WHITE, 0.7);
    return b;
  });

const STONE = tn('#141016', '#262028', '#3c3440', '#5a4e5c');
const IRON = tn('#16141a', '#2e2a34', '#4a4652', '#7a7684');

/** Постамент горгульи: низкий, с золотым пояском. 20×14, земля — ряд 13. */
function plinthPx(p: Px, cx: number, G: number): void {
  poly(
    p,
    [
      [cx - 8, G - 5],
      [cx + 8, G - 5],
      [cx + 8, G],
      [cx - 8, G],
    ],
    (x, y) => tone(STONE, 0.5 - (x - cx) * 0.03 - (y - G + 5) * 0.06),
  );
  // Верхняя грань — светлее, на ней стоит статуя.
  p.rect(cx - 8, G - 7, cx + 8, G - 6, STONE[2]);
  p.rect(cx - 7, G - 8, cx + 7, G - 8, STONE[3]);
  p.rect(cx - 8, G - 4, cx + 8, G - 4, GOLD[1]);
  for (let x = cx - 6; x <= cx + 6; x += 4) p.set(x, G - 4, GOLD[3]);
}

registerPropPainter('f10_plinth', () =>
  sprite('plinth', () => {
    const p = new Px(20, 14);
    plinthPx(p, 10, 13);
    p.outline(INK);
    return { p, ax: 10, ay: 13 };
  }),
);

registerPropPainter('f10_gargstatue', () =>
  sprite('gargstatue', () => {
    const s = stoneOf(gargBase(), 1);
    for (const [x, y] of gargEyes) s.set(x, y, hx('#1a1418'));
    const p = new Px(36, 46);
    plinthPx(p, 18, 45);
    const top = copyAt(s, 36, 46, 2, 45 - 32 - 4 - 2);
    for (let i = 0; i < top.data.length; i += 4)
      if (top.data[i + 3]) {
        p.data[i] = top.data[i];
        p.data[i + 1] = top.data[i + 1];
        p.data[i + 2] = top.data[i + 2];
        p.data[i + 3] = 255;
      }
    p.outline(INK);
    return { p, ax: 18, ay: 45 };
  }),
);

/** Статуя с листа DCSS: 32×32, основание — нижний ряд. */
function sheetStatue(name: string) {
  return () =>
    sprite(`st_${name}`, () => {
      const p = sheetPx(name);
      if (!p) return null;
      return { p, ax: 16, ay: 31 };
    });
}
registerPropPainter('f10_devil', sheetStatue('devil'));
registerPropPainter('f10_lord', sheetStatue('lord'));
registerPropPainter('f10_iron', sheetStatue('iron'));
registerPropPainter('f10_polearm', sheetStatue('polearm'));
registerPropPainter('f10_skulls', sheetStatue('skulls'));

registerPropPainter('f10_bloodfont', (o, time) => {
  // Кровь бьёт из пасти горгульи: два кадра листа и капли поверх.
  const f = Math.floor(time * 3 + o.x) % 2;
  const d = Math.floor(time * 8 + o.y) % 4;
  return sprite(`font|${f}|${d}`, () => {
    const p = sheetPx(f ? 'font1' : 'font0');
    if (!p) return null;
    const drops = [hx('#d6302e'), hx('#ff5a46')];
    p.set(15, 12 + d, drops[d % 2]);
    p.set(16, 16 + ((d + 2) % 4), drops[(d + 1) % 2]);
    return { p, ax: 16, ay: 31 };
  });
});

registerPropPainter('f10_flamealtar', (o, time) => {
  const f = Math.floor(time * 6 + o.x) % 2;
  const e = Math.floor(time * 10 + o.x * 3) % 6;
  return sprite(`flamealt|${f}|${e}`, () => {
    const p = sheetPx(f ? 'flame1' : 'flame0');
    if (!p) return null;
    // Искры над алтарём.
    p.set(10 + e * 2, 6 - (e % 3), FIRE[2]);
    p.set(20 - e, 3 + (e % 2), FIRE[3]);
    return { p, ax: 16, ay: 31 };
  });
});

registerPropPainter('f10_brazier', (o, time) => {
  const f = Math.floor(time * 10 + o.x * 1.7) % 8;
  return sprite(`brazier|${f}`, () => {
    const p = new Px(16, 26);
    const G = 25;
    // Тренога: три ноги, чаша с углями.
    for (const [x0, x1] of [
      [3, 6],
      [13, 10],
      [8, 8],
    ])
      stroke(p, x0, G, x1, G - 9, IRON[x0 === 8 ? 1 : 2]);
    shadeEll(p, 8, G - 10, 6, 2.4, IRON, 0.1);
    p.rect(3, G - 11, 13, G - 11, GOLD[1]);
    for (let x = 4; x <= 12; x += 2) p.set(x, G - 11, GOLD[3]);
    // Угли.
    for (let x = 4; x <= 12; x++)
      p.set(x, G - 12, hash(x, f) > 0.5 ? hx('#ff6a1a') : hx('#8a1a06'));
    p.outline(INK);
    flame(p, 8, G - 13, 8, 10, f, o.x);
    return { p, ax: 8, ay: G };
  });
});

registerPropPainter('f10_candles', (o, time) => {
  const f = Math.floor(time * 8 + o.y) % 4;
  return sprite(`candles|${f}`, () => {
    const p = new Px(14, 24);
    const G = 23;
    // Золотой канделябр на три свечи.
    stroke(p, 7, G, 7, G - 12, GOLD[1]);
    stroke(p, 6.5, G, 6.5, G - 12, GOLD[2]);
    p.rect(4, G, 10, G, GOLD[1]);
    p.rect(5, G - 1, 9, G - 1, GOLD[2]);
    stroke(p, 2, G - 12, 12, G - 12, GOLD[2]);
    stroke(p, 2, G - 12, 2, G - 14, GOLD[1]);
    stroke(p, 12, G - 12, 12, G - 14, GOLD[1]);
    for (const x of [2, 7, 12]) {
      const h = x === 7 ? 5 : 4;
      p.rect(x, G - 13 - h, x, G - 13, hx('#e8dcc8'));
      if (x === 7) p.rect(x - 1, G - 17, x - 1, G - 14, hx('#b8aa94'));
    }
    p.outline(INK);
    for (const [x, h] of [
      [2, 4],
      [7, 5],
      [12, 4],
    ] as [number, number][]) {
      const fy = G - 14 - h;
      p.set(x, fy, FIRE[2]);
      p.set(x, fy - 1, f % 2 ? FIRE[3] : FIRE[2]);
      if ((f + x) % 3) p.set(x + (f === 1 ? 1 : 0), fy - 2, FIRE[3]);
    }
    return { p, ax: 7, ay: G };
  });
});

registerPropPainter('f10_column', () =>
  sprite('column', () => {
    // Колонна чёрного мрамора с золотой капителью. 18×46.
    const p = new Px(18, 46);
    const G = 45;
    const shaft = tn('#0e0c12', '#1e1a24', '#322c3a', '#4e4658');
    for (let y = G - 38; y <= G - 5; y++)
      for (let x = 3; x <= 14; x++) {
        const k = (x - 3) / 11;
        const flute = (x - 3) % 3 === 0 ? -0.2 : 0;
        const vein = hash(x, Math.floor(y / 3), 9) > 0.93 ? 0.3 : 0;
        p.set(x, y, tone(shaft, 0.75 - k * 0.8 + flute + vein));
      }
    // База и капитель: ступени с золотом.
    p.rect(1, G - 4, 16, G, STONE[1]);
    p.rect(1, G - 4, 16, G - 4, STONE[3]);
    p.rect(2, G - 5, 15, G - 5, GOLD[2]);
    p.rect(1, G - 42, 16, G - 39, STONE[1]);
    p.rect(1, G - 42, 16, G - 42, STONE[3]);
    p.rect(2, G - 38, 15, G - 38, GOLD[2]);
    for (let x = 3; x <= 14; x += 3) p.set(x, G - 38, GOLD[3]);
    // Резьба: рогатый череп на капители.
    p.set(8, G - 41, GOLD[3]);
    p.set(9, G - 41, GOLD[3]);
    p.set(6, G - 42, GOLD[2]);
    p.set(11, G - 42, GOLD[2]);
    p.outline(INK);
    return { p, ax: 9, ay: G };
  }),
);

registerPropPainter('f10_urn', (o, _t, _alive, flash) =>
  flashed(`urn|${(o.x + o.y) % 2}`, flash, () => {
    const p = new Px(14, 16);
    const G = 15;
    const glaze = tn('#0a080c', '#1c1620', '#342a3a', '#5a4c62');
    shadeEll(p, 7, G - 5, 5, 5, glaze, 0.1);
    p.rect(4, G - 12, 10, G - 10, glaze[1]);
    p.rect(3, G - 13, 11, G - 13, glaze[2]);
    p.rect(3, G - 6, 11, G - 6, GOLD[(o.x + o.y) % 2 ? 2 : 1]);
    p.rect(5, G, 9, G, glaze[1]);
    p.set(5, G - 8, WHITE);
    p.outline(INK);
    return { p, ax: 7, ay: G };
  }),
);

registerPropPainter('f10_coffer', (_o, _t, _alive, flash) =>
  flashed('coffer', flash, () => {
    const p = new Px(16, 14);
    const G = 13;
    const wood = tn('#2a0c0c', '#4a1614', '#6a2420', '#8a3a2e');
    polyShade(
      p,
      [
        [1, G - 7],
        [15, G - 7],
        [15, G],
        [1, G],
      ],
      wood,
    );
    shadeEll(p, 8, G - 7, 7, 3, wood, 0.15);
    for (const x of [3, 12]) p.rect(x, G - 9, x + 1, G, IRON[2]);
    p.rect(1, G - 6, 15, G - 6, IRON[1]);
    p.rect(7, G - 7, 9, G - 4, GOLD[2]);
    p.set(8, G - 5, INK);
    p.outline(INK);
    return { p, ax: 8, ay: G };
  }),
);

registerPropPainter('f10_pike', (o) =>
  sprite(`pike|${(o.x * 3 + o.y) % 3}`, () => {
    // Череп на пике — у ворот.
    const p = new Px(10, 26);
    const G = 25;
    stroke(p, 5, G, 5, G - 18, hx('#3a2418'));
    stroke(p, 5.4, G, 5.4, G - 18, hx('#5a3a22'));
    const v = (o.x * 3 + o.y) % 3;
    const bone = tn('#4e4234', '#8a7c62', '#c2b494', '#ece2c6');
    shadeEll(p, 5, G - 19, 3.2, 3, bone, 0.1);
    p.rect(3, G - 17, 7, G - 16, bone[1]);
    p.outline(INK);
    p.set(4, G - 19, INK);
    p.set(6, G - 19, INK);
    p.set(5, G - 17, INK);
    if (v === 1) p.set(2, G - 21, hx('#2a1418'));
    if (v === 2) p.set(5, G - 23, hx('#8a1c22'));
    return { p, ax: 5, ay: G };
  }),
);

registerPropPainter('f10_heroes', (o) =>
  sprite(`heroes|${(o.x + o.y * 7) % 3}`, () => {
    // Кости героев: шлем, щит, сломанный меч, рёбра. 20×12.
    const v = (o.x + o.y * 7) % 3;
    const p = new Px(22, 12);
    const G = 11;
    const bone = tn('#4e4234', '#8a7c62', '#c2b494', '#ece2c6');
    const steel = tn('#2a2a30', '#5a5a64', '#8a8a96', '#c8c8d4');
    // Рёбра дугами.
    for (let i = 0; i < 4; i++) stroke(p, 6 + i * 2, G - 1, 7 + i * 2, G - 5, bone[2]);
    stroke(p, 5, G - 3, 14, G - 3, bone[1]);
    // Шлем героя.
    shadeEll(p, v === 1 ? 16 : 4, G - 3, 3, 2.6, steel, 0.1);
    // Щит или меч.
    if (v === 0) {
      shadeEll(p, 17, G - 2, 3.4, 2.2, tn('#1a2a4a', '#2a4a7a', '#4a6aa0', '#8aa0d0'));
      p.set(17, G - 2, GOLD[2]);
    } else {
      stroke(p, 9, G - 1, 20, G - 5, steel[2]);
      p.set(20, G - 5, steel[3]);
      stroke(p, 10, G - 3, 11, G + 0, GOLD[1]);
    }
    // Череп.
    shadeEll(p, v === 2 ? 17 : 11, G - 5, 2.2, 2, bone, 0.1);
    p.outline(INK);
    p.set(v === 2 ? 17 : 11, G - 5, INK);
    return { p, ax: 11, ay: G };
  }),
);

registerPropPainter('f10_cage', (o, time) => {
  // Клетка висельника качается на цепи.
  const f = Math.floor(time * 2 + o.x) % 4;
  return sprite(`cage|${f}`, () => {
    const p = new Px(22, 34);
    const G = 33;
    // Столб и перекладина.
    stroke(p, 4, G, 4, G - 30, hx('#2a1810'));
    stroke(p, 4.5, G, 4.5, G - 30, hx('#4a2c1a'));
    stroke(p, 4, G - 30, 16, G - 30, hx('#3a2216'));
    const sw = [0, 1, 0, -1][f];
    // Цепь.
    for (let y = G - 29; y < G - 23; y++)
      p.set(15 + Math.round((sw * (y - G + 29)) / 6), y, y % 2 ? IRON[2] : IRON[1]);
    // Клетка: прутья и скелет внутри.
    const cx = 15 + sw;
    const top = G - 23;
    for (let y = top; y < top + 14; y++)
      for (let x = cx - 4; x <= cx + 4; x++) {
        const edge = y === top || y === top + 13 || y === top + 6;
        if (edge || (x - cx + 4) % 2 === 0) p.set(x, y, edge ? IRON[2] : IRON[1]);
      }
    shadeEll(p, cx, top + 4, 1.6, 1.6, tn('#4e4234', '#8a7c62', '#c2b494', '#ece2c6'));
    stroke(p, cx, top + 6, cx, top + 11, hx('#c2b494'));
    p.outline(INK);
    p.set(cx - 1, top + 4, INK);
    return { p, ax: 4, ay: G };
  });
});

registerPropPainter('f10_post', () =>
  sprite('post', () => {
    // Столб псарни: кольцо, к нему цепь.
    const p = new Px(8, 18);
    const G = 17;
    for (let y = G - 14; y <= G; y++)
      for (let x = 2; x <= 5; x++)
        p.set(x, y, tone(tn('#1a100a', '#3a2414', '#5a3a1e', '#7a522e'), 0.8 - (x - 2) * 0.25));
    p.rect(1, G - 15, 6, G - 14, IRON[2]);
    p.outline(INK);
    p.set(6, G - 9, IRON[3]);
    p.set(7, G - 8, IRON[2]);
    return { p, ax: 4, ay: G };
  }),
);

registerPropPainter('f10_throne', () =>
  sprite('throne', () => {
    // Трон лицом к зрителю: высокая спинка с шипами и рогами, золото,
    // багровый бархат, подлокотники с черепами. 44×56, земля — ряд 55.
    const p = new Px(46, 58);
    const G = 57;
    const cx = 23;
    const stone = tn('#0a080c', '#18141c', '#2c2632', '#4a4254');
    // Спинка.
    poly(
      p,
      [
        [cx - 13, G - 20],
        [cx - 13, G - 44],
        [cx - 7, G - 52],
        [cx, G - 56],
        [cx + 7, G - 52],
        [cx + 13, G - 44],
        [cx + 13, G - 20],
      ],
      (x, y) => tone(stone, 0.55 - Math.abs(x - cx) * 0.03 - (y < G - 44 ? -0.1 : 0)),
    );
    // Бархат спинки.
    poly(
      p,
      [
        [cx - 8, G - 22],
        [cx - 8, G - 42],
        [cx, G - 49],
        [cx + 8, G - 42],
        [cx + 8, G - 22],
      ],
      (x, y) => tone(RED, 0.5 - Math.abs(x - cx) * 0.05 + ((x + y) % 4 === 0 ? -0.15 : 0)),
    );
    // Золотая кайма и знак — рогатая корона.
    for (let y = G - 42; y <= G - 22; y++) {
      p.set(cx - 9, y, GOLD[1]);
      p.set(cx + 9, y, GOLD[2]);
    }
    for (let i = 0; i <= 8; i++) {
      p.set(cx - 8 + i, G - 42 - Math.round(i * 0.85), GOLD[2]);
      p.set(cx + 8 - i, G - 42 - Math.round(i * 0.85), GOLD[2]);
    }
    for (let x = -3; x <= 3; x++) p.set(cx + x, G - 34, GOLD[2]);
    p.set(cx - 3, G - 36, GOLD[3]);
    p.set(cx, G - 37, GOLD[3]);
    p.set(cx + 3, G - 36, GOLD[3]);
    p.set(cx, G - 35, hx('#ff2a2a'));
    // Рога на верхушке спинки.
    for (const s of [-1, 1]) {
      const pts = spline(
        [
          [cx + s * 10, G - 46],
          [cx + s * 15, G - 50],
          [cx + s * 16, G - 55],
          [cx + s * 13, G - 57],
        ],
        4,
      );
      pts.forEach(([x, y], n) => {
        const r = 2 * (1 - n / pts.length) + 0.5;
        shadeEll(p, x, y, r, r, HORN);
      });
      // Шипы по краю спинки.
      for (let k = 0; k < 3; k++)
        limb(p, cx + s * 13, G - 26 - k * 6, cx + s * 16, G - 28 - k * 6, 0.9, 0.3, stone);
    }
    // Сиденье, подлокотники с черепами, ступени.
    polyShade(
      p,
      [
        [cx - 14, G - 20],
        [cx + 14, G - 20],
        [cx + 14, G - 10],
        [cx - 14, G - 10],
      ],
      stone,
    );
    p.rect(cx - 9, G - 20, cx + 9, G - 17, RED[2]);
    p.rect(cx - 9, G - 17, cx + 9, G - 16, RED[1]);
    for (const s of [-1, 1]) {
      p.rect(cx + s * 12 - 2, G - 24, cx + s * 12 + 2, G - 12, stone[2]);
      shadeEll(
        p,
        cx + s * 12,
        G - 25,
        2.6,
        2.4,
        tn('#4e4234', '#8a7c62', '#c2b494', '#ece2c6'),
        0.1,
      );
    }
    p.rect(cx - 16, G - 9, cx + 16, G - 5, stone[1]);
    p.rect(cx - 16, G - 9, cx + 16, G - 9, stone[3]);
    p.rect(cx - 18, G - 4, cx + 18, G, stone[1]);
    p.rect(cx - 18, G - 4, cx + 18, G - 4, stone[3]);
    p.rect(cx - 16, G - 6, cx + 16, G - 6, GOLD[1]);
    p.outline(INK);
    // Глазницы черепов светятся.
    for (const s of [-1, 1]) {
      p.set(cx + s * 12 - 1, G - 25, hx('#ff3a20'));
      p.set(cx + s * 12 + 1, G - 25, hx('#ff3a20'));
    }
    return { p, ax: cx, ay: G };
  }),
);

// --- Настенное: витраж (вспышки молний), знамя, цепи, бра, фонтан.

/** Молния за окном: вспышка раз в несколько секунд, у каждого окна своя. */
function windowFlash(x: number, time: number): number {
  const storm = F10_FX.storm - (typeof performance !== 'undefined' ? performance.now() / 1000 : 0);
  if (storm > 0) return Math.floor(time * 20) % 3 ? 2 : 1;
  const slot = Math.floor(time / 6.5 + hash(x, 3) * 3);
  const t0 = hash(slot, x % 5, 11) * 5;
  const t = time - (slot - hash(x, 3) * 3) * 6.5;
  const d = t - t0;
  if (d > 0 && d < 0.07) return 2;
  if (d > 0.14 && d < 0.24) return 1;
  return 0;
}

registerPropPainter('f10_window', (o, time) => {
  const fl = windowFlash(o.x, time);
  if (!fl) return null;
  return sprite(`winflash|${fl}|${o.x % 3}`, () => {
    // Свет молнии сквозь стёкла: белое с фиолетовым по стеклу окна.
    const p = new Px(16, 16);
    const c = fl === 2 ? hx('#ffffff', 200) : hx('#d8c8ff', 130);
    for (let y = 3; y <= 13; y++)
      for (let x = 5; x <= 10; x++) {
        const arch = y > 5 || Math.abs(x - 7.5) < (y - 1.5) * 1.2;
        if (arch && (x + y) % (fl === 2 ? 1 : 2) === 0) p.set(x, y, c);
      }
    return { p, ax: 8, ay: 16 };
  });
});

registerPropPainter('f10_banner', (o, time) => {
  const f = Math.floor(time * 2.2 + o.x * 0.7) % 3;
  return sprite(`banner|${f}`, () => {
    // Знамя: красное полотнище, золотая кайма, чёрная рогатая корона.
    const p = new Px(16, 22);
    const top = 3;
    p.rect(2, top, 13, top, GOLD[2]);
    p.set(1, top, GOLD[3]);
    p.set(14, top, GOLD[3]);
    const wave = [0, 1, 0][f];
    for (let y = top + 1; y <= top + 16; y++) {
      const sx = Math.round(Math.sin((y - top) * 0.45 + f * 1.3) * 0.6);
      for (let x = 3; x <= 12; x++) {
        const edge = x === 3 || x === 12;
        p.set(
          x + sx,
          y,
          edge ? GOLD[1] : tone(RED, 0.55 - (x - 3) * 0.03 + ((x + y) % 5 === 0 ? -0.15 : 0)),
        );
      }
    }
    // Хвост полотнища — два язычка.
    for (let x = 3; x <= 12; x++) {
      const y = top + 17 + (x < 8 ? x - 3 : 12 - x) * 0.5 + wave;
      p.set(x, Math.round(y), RED[1]);
    }
    // Знак: корона с рогами.
    const cx = 7;
    const cy = top + 8;
    p.rect(cx - 2, cy, cx + 3, cy + 1, INK);
    p.set(cx - 2, cy - 1, INK);
    p.set(cx + 0, cy - 2, INK);
    p.set(cx + 1, cy - 2, INK);
    p.set(cx + 3, cy - 1, INK);
    p.set(cx - 3, cy - 3, HORN[1]);
    p.set(cx + 4, cy - 3, HORN[1]);
    p.set(cx + 0, cy + 3, GOLD[2]);
    p.set(cx + 1, cy + 3, GOLD[2]);
    p.outline(INK);
    return { p, ax: 8, ay: 22 };
  });
});

registerPropPainter('f10_chains', (o, time) => {
  const f = Math.floor(time * 1.6 + o.x) % 4;
  return sprite(`chains|${f}`, () => {
    // Цепи с кандалами на стене — качаются.
    const p = new Px(16, 18);
    const sw = [0, 1, 0, -1][f];
    for (const [x0, len] of [
      [4, 10],
      [11, 13],
    ] as [number, number][]) {
      p.set(x0, 2, IRON[3]);
      for (let i = 0; i < len; i++) {
        const x = x0 + Math.round((sw * i) / len);
        p.set(x, 3 + i, i % 2 ? IRON[1] : IRON[2]);
      }
      const x = x0 + sw;
      const y = 3 + len;
      p.rect(x - 1, y, x + 1, y + 1, IRON[2]);
      p.set(x, y + 1, INK);
    }
    return { p, ax: 8, ay: 18 };
  });
});

registerPropPainter('f10_sconce', (o, time) => {
  const f = Math.floor(time * 10 + o.x) % 6;
  return sprite(`sconce|${f}`, () => {
    const p = new Px(16, 18);
    // Железное бра: держатель и чаша.
    stroke(p, 8, 16, 8, 11, IRON[2]);
    p.rect(5, 10, 11, 10, IRON[2]);
    p.rect(6, 11, 10, 11, IRON[1]);
    p.set(8, 16, GOLD[2]);
    p.outline(INK);
    flame(p, 8, 9, 6, 7, f, o.x);
    return { p, ax: 8, ay: 18 };
  });
});

registerPropPainter('f10_wallfont', (_o, time) => {
  const f = Math.floor(time * 6) % 3;
  return sprite(`wallfont|${f}`, () => {
    const p = x72(`wall_fountain_mid_red_anim_f${f}` as Parameters<typeof x72>[0]);
    if (!p) return null;
    return { p: p.tint(hx('#200a10'), 0.25), ax: 8, ay: 16 };
  });
});

registerPropPainter('f10_basin', (_o, time) => {
  const f = Math.floor(time * 6) % 3;
  return sprite(`basin|${f}`, () => {
    const p = x72(`wall_fountain_basin_red_anim_f${f}` as Parameters<typeof x72>[0]);
    if (!p) return null;
    return { p: p.tint(hx('#200a10'), 0.2), ax: 8, ay: 16 };
  });
});

// ---------------------------------------------------------------------------
// Клетки трёх районов. Кешируются по виду и соседям: кусок карты
// собирается один раз.
// ---------------------------------------------------------------------------

const cells = new Map<string, Px>();
function cellOf(key: string, make: () => Px): Px {
  let p = cells.get(key);
  if (!p) {
    p = make();
    cells.set(key, p);
  }
  return p;
}

const MK = F10_MARK;

/** Тень у подножия стен на своих (непрозрачных) клетках. */
function wallShade(p: Px, n: boolean, w: boolean, e: boolean): void {
  const sh = hx('#050204');
  if (n)
    for (let y = 0; y < 3; y++)
      for (let x = 0; x < 16; x++) p.set(x, y, alpha(sh, 0.55 - y * 0.16));
  if (w)
    for (let x = 0; x < 2; x++)
      for (let y = 0; y < 16; y++) p.set(x, y, alpha(sh, 0.35 - x * 0.15));
  if (e) for (let x = 14; x < 16; x++) for (let y = 0; y < 16; y++) p.set(x, y, alpha(sh, 0.22));
}

const edgesOf = (c: CellCtx) => ({ n: !c.open(0, -1), w: !c.open(-1, 0), e: !c.open(1, 0) });

function carpetCell(c: CellCtx, area: string): Px {
  const same = (dx: number, dy: number) => {
    const k = c.markAt(dx, dy);
    return k === MK.carpet;
  };
  const N = same(0, -1);
  const S = same(0, 1);
  const Wd = same(-1, 0);
  const E = same(1, 0);
  const { n, w, e } = edgesOf(c);
  const deep = area === F10_THRONE;
  // Знак — только внутри дорожки (не у каймы), косой сеткой через две
  // клетки: на узкой дорожке — по оси раз в три ряда, на широкой — узор.
  const motif = N && S && Wd && E && (c.wx + c.wy) % 3 === 0 ? 1 : 0;
  return cellOf(`carpet|${area}|${+N}${+S}${+Wd}${+E}|${+n}${+w}${+e}|${motif}`, () => {
    const p = new Px(16, 16);
    const R = deep ? tn('#2a0408', '#58080e', '#8a121a', '#bc2a2e') : RED;
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        // Бархат: ровный тон, ворс — едва заметными вертикальными полосами.
        const nap = x % 4 === 1 ? -0.05 : x % 4 === 3 ? 0.04 : 0;
        const k = 0.36 + nap + (hash(x, y, 77) - 0.5) * 0.08;
        p.set(x, y, mixc(R[1], R[2], Math.max(0, Math.min(1, k * 1.4))));
      }
    if (motif) {
      // Ромб золотой нитью с тёмной серединой — рогатая корона дома.
      const cx = 7.5;
      const cy = 7.5;
      for (let y = 2; y <= 13; y++)
        for (let x = 2; x <= 13; x++) {
          const d = Math.abs(x - cx) + Math.abs(y - cy);
          if (d > 5.6 && d < 6.6) p.set(x, y, (x + y) % 2 ? GOLD[1] : GOLD[2]);
          else if (d < 5.6) p.set(x, y, mixc(p.get(x, y), R[0], 0.45));
        }
      p.set(7, 6, GOLD[2]);
      p.set(8, 6, GOLD[2]);
      p.set(6, 8, GOLD[1]);
      p.set(9, 8, GOLD[1]);
      p.set(7, 8, GOLD[3]);
      p.set(8, 8, GOLD[3]);
      p.set(5, 6, GOLD[1]);
      p.set(10, 6, GOLD[1]);
    }
    // Кайма: золотая тесьма там, где ковёр кончается.
    const trim = (x: number, y: number, k: number) => p.set(x, y, k ? GOLD[2] : GOLD[1]);
    if (!Wd)
      for (let y = 0; y < 16; y++) {
        p.set(0, y, INK);
        trim(1, y, y % 3);
        p.set(2, y, R[0]);
      }
    if (!E)
      for (let y = 0; y < 16; y++) {
        p.set(15, y, INK);
        trim(14, y, y % 3);
        p.set(13, y, R[0]);
      }
    if (!N)
      for (let x = 0; x < 16; x++) {
        p.set(x, 0, INK);
        trim(x, 1, x % 3);
      }
    if (!S)
      for (let x = 0; x < 16; x++) {
        p.set(x, 15, INK);
        trim(x, 14, x % 3);
        // Бахрома.
        if (x % 2) p.set(x, 15, GOLD[1]);
      }
    wallShade(p, n, w, e);
    return p;
  });
}

function marbleCell(c: CellCtx, area: string): Px {
  const { n, w, e } = edgesOf(c);
  const light = area === F10_GALLERY && (c.wx + c.wy) % 2 === 1;
  const v = Math.floor(hash(c.wx, c.wy, 21) * 6);
  return cellOf(`marble|${area}|${+light}|${v}|${+n}${+w}${+e}`, () => {
    const p = new Px(16, 16);
    const M = light
      ? tn('#241f2c', '#342e3e', '#463f52', '#6a6078')
      : area === F10_THRONE
        ? tn('#08060a', '#131017', '#1d1822', '#2e2834')
        : tn('#0a080e', '#15121a', '#211c28', '#342c3c');
    // Облако по плите: мягкий переход тона, без зерна (зерно читалось
    // помехами телевизора).
    const ox = hash(v, 3) * 16;
    const oy = hash(v, 4) * 16;
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const cloud = Math.sin((x + ox) * 0.45) * Math.cos((y + oy) * 0.38) * 0.5 + 0.5;
        const k = 0.25 + cloud * 0.45 - (x + y) * 0.008 + (hash(x, y, v) > 0.94 ? 0.12 : 0);
        p.set(x, y, mixc(M[1], M[2], Math.max(0, Math.min(1, k))));
      }
    // Жила — у каждой третьей плиты, тонкая и приглушённая.
    const vein = area === F10_THRONE ? mixc(GOLD[0], M[1], 0.4) : mixc(M[3], M[2], 0.45);
    const vein2 = area === F10_THRONE ? mixc(GOLD[1], M[2], 0.25) : mixc(M[3], M[2], 0.2);
    if (v < 2) {
      let x = hash(v, 1, 3) * 16;
      let y = Math.floor(hash(v, 2, 3) * 6);
      const end = y + 6 + Math.floor(hash(v, 5, 3) * 6);
      while (y < Math.min(16, end)) {
        p.set(Math.floor(x), Math.floor(y), (y | 0) % 6 ? vein : vein2);
        y += 1;
        x += (hash(Math.floor(y), v, 3) - 0.5) * 2.2 + (v % 2 ? 0.5 : -0.5);
        if (x < 0 || x > 15) break;
      }
    }
    // Шов плит и блик полировки.
    for (let i = 0; i < 16; i++) {
      p.set(i, 0, M[0]);
      p.set(0, i, M[0]);
    }
    for (let i = 1; i < 4; i++) p.set(i, 4 - i, mixc(p.get(i, 4 - i), M[3], 0.35));
    wallShade(p, n, w, e);
    return p;
  });
}

function scatterCell(c: CellCtx, kind: number): Px {
  const v = Math.floor(hash(c.wx, c.wy, 31 + kind) * 4);
  return cellOf(`scatter|${kind}|${v}`, () => {
    const p = new Px(16, 16);
    const bone = tn('#4e4234', '#8a7c62', '#c2b494', '#ece2c6');
    if (kind === MK.bones) {
      // Кости: бедренная, пара рёбер, осколок черепа.
      const a = v * 0.8;
      const x0 = 4 + v;
      const y0 = 5 + ((v * 3) % 5);
      limb(p, x0, y0, x0 + Math.cos(a) * 7, y0 + Math.sin(a) * 3, 0.7, 0.7, bone);
      p.ell(x0, y0, 1.2, 1.2, bone[2]);
      p.ell(x0 + Math.cos(a) * 7, y0 + Math.sin(a) * 3, 1.2, 1.2, bone[2]);
      if (v % 2) {
        shadeEll(p, 11, 11, 2, 1.8, bone, 0.1);
        p.set(10, 11, INK);
        p.set(12, 11, INK);
      } else for (let i = 0; i < 3; i++) stroke(p, 9 + i * 2, 13, 10 + i * 2, 10, bone[1]);
      p.outline(alpha(INK, 0.8));
    } else if (kind === MK.blood) {
      // Засохшая кровь: неровное пятно тёмно-бурым, от него потёк; у
      // половины клеток — только брызги. Яркие круглые лужи читались
      // цветами на полу.
      const R0 = hx('#240608', 200);
      const R1 = hx('#3a0a0c', 220);
      if (v < 2) {
        const cx = 5 + v * 4;
        const cy = 6 + v * 3;
        for (let y = 0; y < 16; y++)
          for (let x = 0; x < 16; x++) {
            const d = Math.hypot((x - cx) / 3.2, (y - cy) / 2.2) + (hash(x, y, v + 5) - 0.5) * 0.7;
            if (d < 1) p.set(x, y, d < 0.55 ? R1 : R0);
          }
        // Потёк вниз-вправо.
        for (let i = 0; i < 4; i++) p.set(cx + 2 + i, cy + 2 + (i >> 1), R0);
      }
      for (let i = 0; i < 4 + v; i++)
        p.set(Math.floor(hash(i, v, 2) * 16), Math.floor(hash(i, v, 3) * 16), R0);
    } else if (kind === MK.soot) {
      for (let y = 0; y < 16; y++)
        for (let x = 0; x < 16; x++) {
          const d = Math.hypot(x - 8, (y - 8) * 1.3) / 8;
          if (d < 1 && hash(x, y, v) > d * 0.7) p.set(x, y, alpha(hx('#080406'), 0.55 * (1 - d)));
        }
    } else if (kind === MK.crack) {
      let x = 2 + v * 3;
      let y = 1;
      while (y < 15) {
        p.set(x, y, hx('#050304'));
        if (hash(x, y, v) > 0.7) p.set(x + 1, y, hx('#050304'));
        y += 1;
        x += hash(y, v, 5) > 0.5 ? 1 : -1;
      }
    } else if (kind === MK.straw) {
      const S = [hx('#5a4418'), hx('#8a6a28'), hx('#b8943e')];
      for (let i = 0; i < 12; i++) {
        const x = hash(i, v, 1) * 14;
        const y = hash(i, v, 2) * 14;
        const a = hash(i, v, 3) * TAU;
        stroke(p, x, y, x + Math.cos(a) * 4, y + Math.sin(a) * 2, S[i % 3]);
      }
    } else if (kind === MK.glass) {
      // Битое стекло витражей: осколки цвета стёкол, искорки.
      const G = [hx('#8a1c26'), hx('#5a2a9a'), hx('#c89a2a'), hx('#2a5a8a')];
      for (let i = 0; i < 6; i++) {
        const x = Math.floor(hash(i, v, 6) * 14) + 1;
        const y = Math.floor(hash(i, v, 7) * 14) + 1;
        p.set(x, y, G[i % 4]);
        p.set(x + 1, y, alpha(G[i % 4], 0.7));
        if (i % 2) p.set(x, y - 1, hx('#ffffff', 200));
      }
    } else if (kind === MK.post) {
      // Пост стража: кованый круг в полу.
      p.ell(8, 9, 5, 3, alpha(GOLD[0], 0.9));
      p.ell(8, 9, 4, 2.2, alpha(hx('#1a1410'), 1));
      p.set(4, 9, GOLD[2]);
      p.set(12, 9, GOLD[2]);
      p.set(8, 7, GOLD[3]);
    } else if (kind === MK.expost) {
      // Место палача: плаха оставила лужу.
      p.ell(8, 9, 6, 3.4, hx('#2a0608'));
      p.ell(7, 8.5, 4, 2, hx('#4a0a10'));
      p.set(6, 8, hx('#6a1218'));
    } else if (kind === MK.kpost) {
      // Выжженные подковы — здесь стоял конь.
      for (const [x, y] of [
        [4, 5],
        [10, 9],
      ]) {
        p.ell(x + 1, y + 1, 2, 1.6, hx('#140806'));
        p.set(x + 1, y + 1, hx('#8a2a0a'));
      }
    }
    return p;
  });
}

function bridgeCell(c: CellCtx): Px {
  const isB = (k: number) => k === MK.bridge || k === MK.kpost || k === MK.cracking;
  const ns = isB(c.markAt(0, -1)) || isB(c.markAt(0, 1));
  const ew = isB(c.markAt(-1, 0)) || isB(c.markAt(1, 0));
  const vertical = ns && !(ew && !ns);
  const dW = !c.open(-1, 0) || c.markAt(-1, 0) === MK.abyss || c.markAt(-1, 0) === MK.fallen;
  const dE = !c.open(1, 0) || c.markAt(1, 0) === MK.abyss || c.markAt(1, 0) === MK.fallen;
  const dN = c.markAt(0, -1) === MK.abyss || c.markAt(0, -1) === MK.fallen;
  const dS = c.markAt(0, 1) === MK.abyss || c.markAt(0, 1) === MK.fallen;
  const v = c.wy % 2;
  const post = (vertical ? c.wy : c.wx) % 3 === 0;
  return cellOf(`bridge|${+vertical}|${+dW}${+dE}${+dN}${+dS}|${v}|${+post}`, () => {
    const p = new Px(16, 16);
    const wood = tn('#1a0e0a', '#34200e', '#52361c', '#6e4c2a');
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        // Доски поперёк хода, щели между ними.
        const along = vertical ? y : x;
        const across = vertical ? x : y;
        const plank = Math.floor((along + v * 2) / 4);
        const gap = (along + v * 2) % 4 === 3;
        const grain = hash(plank, Math.floor(across / 3), 4) > 0.8 ? -0.15 : 0;
        p.set(x, y, gap ? hx('#080404') : tone(wood, 0.55 + grain + (hash(plank, 9) - 0.5) * 0.3));
      }
    // Железные полосы и заклёпки.
    const band = (i: number) => {
      for (let j = 0; j < 16; j++) p.set(vertical ? i : j, vertical ? j : i, IRON[1]);
      for (let j = 1; j < 16; j += 4) p.set(vertical ? i : j, vertical ? j : i, IRON[3]);
    };
    band(3);
    band(12);
    // Край над пропастью: брус, столбик и провис цепи.
    const railSide = (side: 'w' | 'e' | 'n' | 's') => {
      for (let j = 0; j < 16; j++) {
        const [x, y] =
          side === 'w' ? [0, j] : side === 'e' ? [15, j] : side === 'n' ? [j, 0] : [j, 15];
        p.set(x, y, INK);
        const [x2, y2] =
          side === 'w' ? [1, j] : side === 'e' ? [14, j] : side === 'n' ? [j, 1] : [j, 14];
        p.set(x2, y2, wood[0]);
      }
      if (post) {
        const [px0, py0] =
          side === 'w' ? [1, 6] : side === 'e' ? [13, 6] : side === 'n' ? [6, 1] : [6, 13];
        p.rect(px0, py0, px0 + 1, py0 + 2, IRON[2]);
        p.set(px0, py0, IRON[3]);
      }
    };
    if (dW) railSide('w');
    if (dE) railSide('e');
    if (dN) railSide('n');
    if (dS) railSide('s');
    return p;
  });
}

function abyssCell(c: CellCtx, fallen: boolean): Px {
  const pit = (dx: number, dy: number) => {
    const k = c.markAt(dx, dy);
    return k === MK.abyss || k === MK.fallen;
  };
  const n = !pit(0, -1);
  const w = !pit(-1, 0);
  const e = !pit(1, 0);
  const s = !pit(0, 1);
  const gx = ((c.wx % 4) + 4) % 4;
  const gy = ((c.wy % 4) + 4) % 4;
  const chain = n && hash(c.wx, 7, 3) > 0.6;
  return cellOf(`abyss|${+n}${+w}${+e}${+s}|${gx}${gy}|${+chain}|${+fallen}`, () => {
    const p = new Px(16, 16);
    // Пустота: глубоко внизу тлеет — мягкие пятна жара, сшитые между
    // клетками (период 4 клетки). Искр нет: россыпь точек на чёрном
    // читалась звёздным небом.
    const deep = hx('#040103');
    const glow = hx('#2a060a');
    const glow2 = hx('#4a0e0a');
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const X = (gx * 16 + x) / 64;
        const Y = (gy * 16 + y) / 64;
        const a = Math.sin(X * TAU + 0.6) * Math.cos(Y * TAU) * 0.5 + 0.5;
        const b = Math.sin((X + Y) * TAU * 2 + 1.3) * 0.5 + 0.5;
        const k = Math.max(0, a * 0.8 + b * 0.25 - 0.45);
        let col = mixc(deep, glow, Math.min(1, k * 1.6));
        if (k > 0.42) col = mixc(col, glow2, Math.min(1, (k - 0.42) * 2));
        // Дизеринг по краю пятна — пиксель-арт, без градиента.
        if ((x + y) % 2 === 0 && k > 0.2 && k < 0.26) col = deep;
        p.set(x, y, col);
      }
    if (n) {
      // Северная стенка: слои породы уходят вниз и тонут в темноте.
      const rock = tn('#140c0e', '#281a1c', '#3e2a2a', '#5a403c');
      for (let y = 0; y < 12; y++) {
        const k = y / 12;
        for (let x = 0; x < 16; x++) {
          const layer = (y + Math.floor(hash(Math.floor(x / 4), gx, 5) * 3)) % 4 === 0;
          const c0 = tone(rock, layer ? 0.1 : 0.6 - k * 0.6 + (hash(x, y, gx) - 0.5) * 0.2);
          p.set(x, y, mixc(c0, hx('#050103'), Math.min(1, k * k * 1.2)));
        }
      }
      for (let x = 0; x < 16; x++) {
        p.set(x, 0, fallen ? hx('#7a5a4a') : hx('#9a7a6a'));
        p.set(x, 1, INK);
      }
      if (fallen)
        for (let x = 1; x < 15; x += 3) {
          p.set(x, 2, hx('#4a3430'));
          p.set(x + 1, 3, hx('#2a1c1a'));
        }
      if (chain) {
        // Цепь свисает в бездну.
        const x = 4 + Math.floor(hash(gx, 2) * 8);
        for (let y = 2; y < 15; y++) p.set(x, y, y % 2 ? IRON[1] : IRON[2]);
      }
    }
    if (w) for (let y = n ? 2 : 0; y < 16; y++) p.set(0, y, hx('#3a2828'));
    if (e) for (let y = n ? 2 : 0; y < 16; y++) p.set(15, y, hx('#1a1012'));
    if (s)
      for (let x = 0; x < 16; x++) {
        p.set(x, 15, hx('#6a4c42'));
        p.set(x, 14, INK);
      }
    return p;
  });
}

const cracked = new Map<Px, Map<number, Px>>();
function crackingCell(c: CellCtx, area: string): Px {
  const v = Math.floor(hash(c.wx, c.wy, 51) * 4);
  // Пол под трещинами — тот же, что был (мост или мрамор), кеш — по нему.
  const base = baseUnder(c, area) ?? (area === F10_GATES ? bridgeCell(c) : marbleCell(c, area));
  let m = cracked.get(base);
  if (!m) cracked.set(base, (m = new Map()));
  let q = m.get(v);
  if (q) return q;
  q = new Px(16, 16);
  q.data.set(base.data);
  // Раскалённые трещины: пол вот-вот уйдёт.
  const hot = [hx('#5a0a04'), hx('#e04010'), hx('#ffb040')];
  for (let n = 0; n < 3; n++) {
    let x = 2 + Math.floor(hash(n, v, 1) * 12);
    let y = 0;
    while (y < 16) {
      q.set(x, y, hot[1]);
      if (y % 3 === 0) q.set(x, y, hot[2]);
      q.set(x + 1, y, hot[0]);
      y += 1;
      x += hash(n, y, v) > 0.5 ? 1 : -1;
      x = Math.max(0, Math.min(15, x));
    }
  }
  m.set(v, q);
  return q;
}

function spikeCell(c: CellCtx): Px {
  const { n, w, e } = edgesOf(c);
  return cellOf(`spike|${+n}${+w}${+e}`, () => {
    // Решётка шипов: тёмная плита, прорези — острия прячутся внутри.
    const p = new Px(16, 16);
    const plate = tn('#16121a', '#2a2430', '#403846', '#5a5060');
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) p.set(x, y, tone(plate, 0.5 - (x + y) * 0.012));
    for (let i = 0; i < 16; i++) {
      p.set(i, 0, INK);
      p.set(0, i, INK);
      p.set(i, 1, plate[3]);
    }
    for (const x of [3, 7, 11])
      for (const y of [4, 10]) {
        p.rect(x, y, x + 1, y + 2, hx('#050304'));
        p.set(x, y + 2, hx('#8a8a96'));
      }
    wallShade(p, n, w, e);
    return p;
  });
}

function daisCell(c: CellCtx): Px {
  const S = c.markAt(0, 1) !== MK.dais;
  const N = c.markAt(0, -1) !== MK.dais;
  const Wd = c.markAt(-1, 0) !== MK.dais;
  const E = c.markAt(1, 0) !== MK.dais;
  return cellOf(`dais|${+S}${+N}${+Wd}${+E}|${c.wx % 4}|${c.wy % 4}`, () => {
    // Помост: багрово-чёрный мрамор, ступень с золотой кромкой.
    const p = new Px(16, 16);
    const D = tn('#12060a', '#1e0910', '#2c0d16', '#4e1a26');
    // Багровый мрамор помоста: плиты 16×16 с тёмным швом, ровный тон.
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const k =
          0.35 +
          Math.sin((x + (c.wx % 4) * 5) * 0.4) * Math.cos((y + (c.wy % 4) * 3) * 0.35) * 0.25;
        p.set(x, y, mixc(D[1], D[2], Math.max(0, Math.min(1, k))));
      }
    for (let i = 0; i < 16; i++) {
      p.set(i, 15, D[0]);
      p.set(15, i, D[0]);
    }
    if (N) for (let x = 0; x < 16; x++) p.set(x, 0, D[3]);
    if (Wd) for (let y = 0; y < 16; y++) p.set(0, y, D[3]);
    if (E) for (let y = 0; y < 16; y++) p.set(15, y, D[0]);
    if (S) {
      // Ступень вниз: кромка, подступёнок в тени.
      for (let x = 0; x < 16; x++) {
        p.set(x, 11, GOLD[x % 4 === 0 ? 3 : 2]);
        p.set(x, 12, D[1]);
        p.set(x, 13, D[0]);
        p.set(x, 14, hx('#08030a'));
        p.set(x, 15, hx('#08030a'));
      }
    }
    return p;
  });
}

function stormCell(c: CellCtx): Px {
  const { n, w, e } = edgesOf(c);
  const gx = c.wx % 3;
  const gy = c.wy % 3;
  return cellOf(`storm|${gx}${gy}|${+n}${+w}${+e}`, () => {
    // Пол Витражного зала: тёмный сланец, решётка из фиолетовых линий —
    // по ней бьёт гроза (клетки 3×3), в узлах — золото.
    const p = new Px(16, 16);
    const Sl = tn('#0a0810', '#15121c', '#221c2c', '#342a42');
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++)
        p.set(x, y, tone(Sl, 0.5 + (hash(x, y, gx * 3 + gy) - 0.5) * 0.2));
    const line = hx('#3a2458');
    const line2 = hx('#5a3a8a');
    if (gx === 0) for (let y = 0; y < 16; y++) p.set(0, y, y % 4 ? line : line2);
    if (gy === 0) for (let x = 0; x < 16; x++) p.set(x, 0, x % 4 ? line : line2);
    if (gx === 0 && gy === 0) {
      p.rect(0, 0, 1, 1, GOLD[2]);
      p.set(0, 0, GOLD[3]);
    }
    // Знак молнии посреди блока.
    if (gx === 1 && gy === 1)
      for (const [x, y] of [
        [9, 3],
        [8, 5],
        [7, 7],
        [9, 7],
        [8, 9],
        [7, 11],
      ])
        p.set(x, y, hx('#4a2e72'));
    wallShade(p, n, w, e);
    return p;
  });
}

function vaultCell(c: CellCtx): Px {
  const { n, w, e } = edgesOf(c);
  const v = Math.floor(hash(c.wx, c.wy, 61) * 8);
  return cellOf(`vault|${v}|${+n}${+w}${+e}`, () => {
    // Пол сокровищницы: чёрный камень, швы плит с тусклой латунью, монеты
    // в щелях — редко. Яркая сетка через полклетки читалась миллиметровкой.
    const p = new Px(16, 16);
    const T = tn('#08060a', '#14101a', '#1e1826', '#302838');
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++)
        p.set(
          x,
          y,
          mixc(T[1], T[2], 0.3 + (hash(x, y, v + 9) > 0.9 ? 0.4 : 0) + (x + y < 10 ? 0.15 : 0)),
        );
    const seam = mixc(GOLD[0], T[1], 0.45);
    for (let i = 0; i < 16; i++) {
      p.set(i, 0, seam);
      p.set(0, i, seam);
    }
    p.set(0, 0, GOLD[1]);
    if (v === 1) {
      p.ell(11, 12, 1.4, 1, GOLD[2]);
      p.set(11, 11, GOLD[3]);
    }
    if (v === 3) {
      p.ell(4, 4, 1.4, 1, GOLD[1]);
      p.set(5, 3, GOLD[3]);
    }
    wallShade(p, n, w, e);
    return p;
  });
}

function grateCell(c: CellCtx): Px {
  return cellOf(`grate|${c.wx % 2}`, () => {
    // Решётка над жаром: прутья, под ними тлеют угли.
    const p = new Px(16, 16);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const k = hash(x, y, c.wx % 2);
        p.set(x, y, k > 0.7 ? hx('#e04010') : k > 0.4 ? hx('#8a1a06') : hx('#3a0804'));
      }
    for (let i = 0; i < 16; i++) {
      for (const j of [0, 4, 8, 12]) {
        p.set(j, i, IRON[1]);
        p.set(j + 1, i, IRON[2]);
        p.set(i, j, IRON[1]);
      }
    }
    for (let i = 0; i < 16; i++) {
      p.set(i, 0, INK);
      p.set(0, i, INK);
    }
    return p;
  });
}

function runeCell(c: CellCtx): Px {
  const v = Math.floor(hash(c.wx, c.wy, 71) * 5);
  return cellOf(`rune|${v}`, () => {
    // Руна круга призыва: высечена в камне тонко и тускло, тлеет одним-двумя
    // пикселями. Крупные яркие знаки читались буквами («Z», «И»).
    const p = new Px(16, 16);
    const cut = hx('#120a1c', 220);
    const R0 = hx('#3a2260');
    const R1 = hx('#8a5ad0');
    const glyphs: [number, number][][] = [
      [
        [6, 5],
        [6, 11],
        [9, 8],
        [6, 8],
      ],
      [
        [5, 11],
        [8, 5],
        [11, 11],
        [6, 9],
      ],
      [
        [8, 4],
        [8, 12],
        [5, 7],
        [11, 7],
      ],
      [
        [5, 5],
        [11, 5],
        [8, 9],
        [8, 12],
      ],
      [
        [6, 5],
        [10, 5],
        [10, 11],
        [6, 11],
      ],
    ];
    const g = glyphs[v];
    // Круг вокруг знака — дуга, а не рамка.
    for (let a = 0; a < 24; a++) {
      const t = (a / 24) * TAU;
      if (a % 6 === 5) continue;
      p.set(Math.round(8 + Math.cos(t) * 6), Math.round(8 + Math.sin(t) * 6), cut);
    }
    for (let i = 0; i < g.length - 1; i++)
      stroke(p, g[i][0], g[i][1], g[i + 1][0], g[i + 1][1], R0);
    p.set(g[0][0], g[0][1], R1);
    if (v % 2) p.set(g[g.length - 1][0], g[g.length - 1][1], R1);
    return p;
  });
}

/** Настенное: витраж, выбитое окно, резная арка, стена черепов, решётка. */
function windowFace(c: CellCtx, broken: boolean): Px | null {
  if (!c.open(0, 1)) return null;
  const v = c.wx % 3;
  return cellOf(`window|${+broken}|${v}`, () => {
    const p = new Px(16, 16);
    // Каменное обрамление стрельчатого окна.
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++)
        p.set(x, y, tone(STONE, 0.45 + (y < 2 ? 0.2 : 0) - (x > 12 ? 0.2 : 0)));
    for (let x = 0; x < 16; x++) {
      p.set(x, 0, STONE[3]);
      p.set(x, 15, INK);
    }
    const inArch = (x: number, y: number) =>
      x >= 4 && x <= 11 && (y > 5 || Math.abs(x - 7.5) < (y - 1.2) * 1.25) && y <= 13;
    const panes = [
      [hx('#8a1c26'), hx('#c8323a')],
      [hx('#4a2a8a'), hx('#7a4ac8')],
      [hx('#a07018'), hx('#e8b040')],
      [hx('#1a3a6a'), hx('#3a6aa8')],
    ];
    for (let y = 1; y < 15; y++)
      for (let x = 3; x <= 12; x++) {
        if (!inArch(x, y)) continue;
        if (broken) {
          // Осколки по краю рамы, за ними — ночь.
          const edge = !inArch(x - 1, y) || !inArch(x + 1, y) || !inArch(x, y - 1);
          p.set(x, y, edge && hash(x, y, 3) > 0.4 ? panes[(x + y) % 4][0] : hx('#08060e'));
          if (!edge && hash(x, y, 9) > 0.93) p.set(x, y, hx('#3a2a5a'));
          continue;
        }
        // Свинцовые переплёты, стёкла в узор по варианту окна.
        const lead = x === 7 || x === 8 || y === 9 || (y === 5 && x > 4 && x < 11);
        if (lead) {
          p.set(x, y, hx('#16101a'));
          continue;
        }
        const pi = (Math.floor(x / 4) + Math.floor(y / 4) + v) % 4;
        const lit = (x + y) % 3 === 0 || x < 6;
        p.set(x, y, panes[pi][lit ? 1 : 0]);
      }
    // Подоконник.
    p.rect(3, 14, 12, 14, STONE[2]);
    return p;
  });
}

function archFace(c: CellCtx): Px | null {
  if (!c.open(0, 1)) return null;
  const v = c.wx % 4;
  return cellOf(`arch|${v}`, () => {
    // Резной камень Врат: блоки, в каждом четвёртом — рогатый череп.
    const p = new Px(16, 16);
    const A = tn('#140a0c', '#2a1618', '#442628', '#64403c');
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const seam = y === 7 || y === 15 || (x + (y > 7 ? 8 : 0)) % 16 === 0;
        p.set(x, y, seam ? A[0] : tone(A, 0.6 - (y % 8) * 0.06));
      }
    if (v === 1) {
      shadeEll(p, 8, 4, 2.6, 2.2, tn('#3a2a26', '#6a5448', '#9a8270', '#c2ae96'));
      p.set(7, 4, INK);
      p.set(9, 4, INK);
      limb(p, 6, 2, 3, 0, 0.7, 0.3, HORN);
      limb(p, 10, 2, 13, 0, 0.7, 0.3, HORN);
    }
    for (let x = 0; x < 16; x++) p.set(x, 11, v === 2 ? GOLD[1] : A[3]);
    return p;
  });
}

function skullFace(c: CellCtx): Px | null {
  if (!c.open(0, 1)) return null;
  const v = c.wx % 2;
  return cellOf(`skulls|${v}`, () => {
    const p = new Px(16, 16);
    const bone = tn('#3a3026', '#6a5c48', '#9a8a6c', '#c8b894');
    p.rect(0, 0, 15, 15, hx('#0e0a08'));
    for (let r = 0; r < 3; r++)
      for (let k = 0; k < 3; k++) {
        const x = 2.5 + k * 5.5 + (r % 2 ? 2.5 : 0) - v * 1.5;
        const y = 3 + r * 5;
        if (x > 15) continue;
        shadeEll(p, x, y, 2.4, 2.2, bone, 0.1);
        p.set(Math.round(x - 1), Math.round(y), INK);
        p.set(Math.round(x + 1), Math.round(y), INK);
        p.set(Math.round(x), Math.round(y + 2), INK);
      }
    return p;
  });
}

const barred = new Map<Px, Px>();
function barsCell(c: CellCtx, area: string): Px {
  // Решётка на двери сокровищницы: пол виден между прутьями.
  const base = baseUnder(c, area) ?? vaultCell(c);
  let p = barred.get(base);
  if (p) return p;
  p = new Px(16, 16);
  p.data.set(base.data);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, alpha(hx('#000000'), 0.3));
  for (const x of [1, 5, 9, 13]) {
    for (let y = 0; y < 16; y++) {
      p.set(x, y, IRON[2]);
      p.set(x + 1, y, IRON[1]);
    }
    p.set(x, 15, IRON[3]);
  }
  for (const y of [3, 11]) for (let x = 0; x < 16; x++) p.set(x, y, IRON[1]);
  barred.set(base, p);
  return p;
}

/** Пол под россыпью: вид большинства соседей (мост, ковёр, мрамор…). */
function baseUnder(c: CellCtx, area: string): Px | null {
  const count = new Map<number, number>();
  for (const [dx, dy] of [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ]) {
    const k = c.markAt(dx, dy);
    if (k === MK.bridge || k === MK.carpet || k === MK.marble || k === MK.storm || k === MK.vault)
      count.set(k, (count.get(k) ?? 0) + 1);
  }
  let best = 0;
  let bn = 0;
  for (const [k, n] of count)
    if (n > bn) {
      bn = n;
      best = k;
    }
  if (bn < 2 && !(bn === 1 && best === MK.bridge)) return null;
  const cc: CellCtx = {
    ...c,
    mark: best,
    markAt: (dx, dy) => (dx || dy ? c.markAt(dx, dy) : best),
  };
  if (best === MK.bridge) return bridgeCell(cc);
  if (best === MK.carpet) return carpetCell(cc, area);
  if (best === MK.marble) return marbleCell(cc, area);
  if (best === MK.storm) return stormCell(cc);
  return vaultCell(cc);
}

const layered = new Map<Px, Map<Px, Px>>();
/** Россыпь поверх пола соседей — иначе под костями на мосту была дыра в полу. */
function onBase(c: CellCtx, area: string, over: Px): Px {
  const base = baseUnder(c, area);
  if (!base) return over;
  let m = layered.get(base);
  if (!m) layered.set(base, (m = new Map()));
  let q = m.get(over);
  if (!q) {
    q = new Px(16, 16);
    q.data.set(base.data);
    for (let i = 0; i < over.data.length; i += 4)
      if (over.data[i + 3])
        q.set((i / 4) % 16, Math.floor(i / 64), [
          over.data[i],
          over.data[i + 1],
          over.data[i + 2],
          over.data[i + 3],
        ]);
    m.set(over, q);
  }
  return q;
}

function f10Cell(c: CellCtx, area: string): Px | null {
  switch (c.mark) {
    case MK.carpet:
      return carpetCell(c, area);
    case MK.marble:
      return marbleCell(c, area);
    case MK.bones:
    case MK.blood:
    case MK.soot:
    case MK.crack:
    case MK.straw:
    case MK.glass:
    case MK.post:
    case MK.expost:
    case MK.kpost:
      if (c.mark === MK.kpost && area === F10_GALLERY) return marbleCell(c, area);
      return onBase(c, area, scatterCell(c, c.mark));
    case MK.bridge:
      return bridgeCell(c);
    case MK.abyss:
      return abyssCell(c, false);
    case MK.fallen:
      return abyssCell(c, true);
    case MK.cracking:
      return crackingCell(c, area);
    case MK.spike:
      return spikeCell(c);
    case MK.dais:
      return daisCell(c);
    case MK.rune:
      return runeCell(c);
    case MK.storm:
      return stormCell(c);
    case MK.vault:
      return vaultCell(c);
    case MK.grate:
      return grateCell(c);
    case MK.window:
      return windowFace(c, false);
    case MK.broken:
      return windowFace(c, true);
    case MK.arch:
      return archFace(c);
    case MK.skulls:
      return skullFace(c);
    case MK.bars:
      return barsCell(c, area);
    default:
      return null;
  }
}

registerCellPainter(F10_GATES, (c) => f10Cell(c, F10_GATES));
registerCellPainter(F10_GALLERY, (c) => f10Cell(c, F10_GALLERY));
registerCellPainter(F10_THRONE, (c) => f10Cell(c, F10_THRONE));

// ---------------------------------------------------------------------------
// Метки ударов, лужи и картинки на полу.
// ---------------------------------------------------------------------------

export type ZoneX = (Zone | Strike) & {
  ang?: number;
  len?: number;
  arc?: number;
  mx?: number;
  my?: number;
  px?: number;
  py?: number;
  follow?: number;
  w?: number;
};

export const rgba = (c: RGBA, a: number) =>
  `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a)).toFixed(3)})`;

/** Метка удара наливается: `k` 0…1. */
export const kOf = (z: ZoneX) => {
  const s = z as Strike;
  if ('warn' in s && typeof s.warn === 'number' && s.warn > 0) return Math.min(1, s.t / s.warn);
  return 1;
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

export const BLOOD_RED = hx('#e0202a');
const STEEL = hx('#f0e8ff');
const VIOLET = hx('#b890ff');

registerZonePainter('f10_sweep', (g, z, px, py, S) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const R = zz.r * S;
  const a = zz.ang ?? 0;
  const arc = zz.arc ?? 2;
  cone(g, px, py, R, a, arc);
  g.fillStyle = rgba(BLOOD_RED, 0.12 + 0.26 * k);
  g.fill();
  // Дуга лезвия ползёт по краю к удару.
  g.strokeStyle = rgba(STEEL, 0.35 + 0.6 * k);
  g.lineWidth = 1;
  g.beginPath();
  g.arc(px, py, R, a - arc / 2, a - arc / 2 + arc * k);
  g.stroke();
  g.strokeStyle = rgba(BLOOD_RED, 0.6 + 0.4 * k);
  g.beginPath();
  g.arc(px, py, R * 0.4, a - arc / 2, a + arc / 2);
  g.stroke();
  return true;
});

registerZonePainter('f10_thrust', (g, z, px, py, S) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const L = zz.r * S;
  const w = (zz.w ?? 0.36) * S;
  g.save();
  g.translate(px, py);
  g.rotate(zz.ang ?? 0);
  g.fillStyle = rgba(BLOOD_RED, 0.14 + 0.3 * k);
  g.fillRect(0, -w, L, w * 2);
  // Остриё бежит к концу линии.
  g.fillStyle = rgba(STEEL, 0.5 + 0.5 * k);
  g.fillRect(Math.round(L * k) - 3, -1, 3, 2);
  g.fillStyle = rgba(STEEL, 0.4 + 0.4 * k);
  g.fillRect(0, -w, L, 1);
  g.fillRect(0, w - 1, L, 1);
  g.restore();
  return true;
});

registerZonePainter('f10_land', (g, z, px, py, S, time) => {
  const k = kOf(z as ZoneX);
  const R = z.r * S;
  // Тень горгульи растёт над меткой: сюда упадёт камень.
  g.fillStyle = rgba(hx('#000000'), 0.15 + 0.35 * k);
  g.beginPath();
  g.ellipse(px, py, R * (0.3 + 0.7 * k), R * (0.3 + 0.7 * k) * 0.6, 0, 0, TAU);
  g.fill();
  g.strokeStyle = rgba(BLOOD_RED, 0.5 + 0.5 * k);
  g.lineWidth = 1;
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.stroke();
  // Трещины по кругу.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.3;
    g.beginPath();
    g.moveTo(px + Math.cos(a) * R * 0.5, py + Math.sin(a) * R * 0.5);
    g.lineTo(px + Math.cos(a + 0.2) * R * k, py + Math.sin(a + 0.2) * R * k);
    g.stroke();
  }
  void time;
  return true;
});

registerZonePainter('f10_claws', (g, z, px, py, S) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const R = zz.r * S;
  const a = zz.ang ?? 0;
  const arc = zz.arc ?? 1.8;
  cone(g, px, py, R, a, arc);
  g.fillStyle = rgba(BLOOD_RED, 0.12 + 0.25 * k);
  g.fill();
  // Три когтя — три полосы в конусе.
  g.strokeStyle = rgba(STEEL, 0.4 + 0.6 * k);
  g.lineWidth = 1;
  for (let i = -1; i <= 1; i++) {
    const aa = a + i * 0.35;
    g.beginPath();
    g.moveTo(px + Math.cos(aa) * R * 0.35, py + Math.sin(aa) * R * 0.35);
    g.lineTo(px + Math.cos(aa) * R * (0.35 + 0.65 * k), py + Math.sin(aa) * R * (0.35 + 0.65 * k));
    g.stroke();
  }
  return true;
});

/** Молния: зигзаг с неба в точку. */
function bolt(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  h: number,
  seed: number,
  a: number,
): void {
  const pts: [number, number][] = [];
  const n = 7;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push([x + (i === n ? 0 : (hash(i, seed) - 0.5) * 10), y - h * (1 - t)]);
  }
  g.lineWidth = 3;
  g.strokeStyle = rgba(VIOLET, 0.55 * a);
  g.beginPath();
  pts.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)));
  g.stroke();
  g.lineWidth = 1;
  g.strokeStyle = rgba(WHITE, a);
  g.stroke();
}

registerZonePainter('f10_bolt', (g, z, px, py, S, time) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const R = zz.r * S;
  // Метка: круг, в нём сходятся искры; в последний миг — молния.
  g.fillStyle = rgba(VIOLET, 0.08 + 0.22 * k);
  g.beginPath();
  g.arc(px, py, R * k, 0, TAU);
  g.fill();
  g.strokeStyle = rgba(VIOLET, 0.45 + 0.5 * k);
  g.lineWidth = 1;
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.stroke();
  g.fillStyle = rgba(WHITE, 0.6 + 0.4 * k);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + time * 3;
    const r = R * (1 - ((time * 1.5 + i * 0.2) % 1));
    g.fillRect(Math.round(px + Math.cos(a) * r), Math.round(py + Math.sin(a) * r), 1, 1);
  }
  if (k > 0.82) bolt(g, px, py, 90, zz.id + Math.floor(time * 30), (k - 0.82) / 0.18);
  return true;
});

registerZonePainter('f10_bolt_line', (g, z, px, py, S, time) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const L = zz.r * S;
  const w = (zz.w ?? 1) * S;
  g.save();
  g.translate(px, py);
  g.rotate(zz.ang ?? 0);
  g.fillStyle = rgba(VIOLET, 0.1 + 0.22 * k);
  g.fillRect(0, -w, L, w * 2);
  g.fillStyle = rgba(VIOLET, 0.5 + 0.5 * k);
  g.fillRect(0, -w, L, 1);
  g.fillRect(0, w - 1, L, 1);
  // Разряды бегают по полосе.
  g.fillStyle = rgba(WHITE, 0.7);
  for (let i = 0; i < L / 6; i++)
    g.fillRect(
      Math.round((i * 6 + time * 40) % L),
      Math.round((hash(i, Math.floor(time * 12)) - 0.5) * w * 1.6),
      2,
      1,
    );
  g.restore();
  if (k > 0.85) {
    const ux = Math.cos(zz.ang ?? 0);
    const uy = Math.sin(zz.ang ?? 0);
    for (let i = 0; i < 3; i++) {
      const t = (i + 0.5) / 3;
      bolt(
        g,
        px + ux * L * t,
        py + uy * L * t,
        80,
        zz.id * 3 + i + Math.floor(time * 30),
        (k - 0.85) / 0.15,
      );
    }
  }
  return true;
});

registerZonePainter('f10_bolt_ring', (g, z, px, py, S, time) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const R = zz.r * S;
  const w = (zz.w ?? 0.8) * S;
  g.strokeStyle = rgba(VIOLET, 0.12 + 0.25 * k);
  g.lineWidth = w * 2;
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.stroke();
  g.strokeStyle = rgba(WHITE, 0.4 + 0.5 * k);
  g.lineWidth = 1;
  g.beginPath();
  g.arc(px, py, R + ((time * 10) % 2), 0, TAU);
  g.stroke();
  return true;
});

registerZonePainter('f10_sigil', (g, z, px, py, S, time) => {
  const zz = z as ZoneX;
  const R = zz.r * S;
  const locked = !zz.follow;
  // Печать архидемона: кольцо с руной крутится под ногами.
  g.strokeStyle = rgba(locked ? WHITE : VIOLET, locked ? 0.9 : 0.7);
  g.lineWidth = 1;
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.stroke();
  g.beginPath();
  for (let i = 0; i <= 5; i++) {
    const a = time * 2 + (i * 2 * TAU) / 5;
    const x = px + Math.cos(a) * R * 0.8;
    const y = py + Math.sin(a) * R * 0.8 * 0.7;
    if (i) g.lineTo(x, y);
    else g.moveTo(x, y);
  }
  g.stroke();
  g.fillStyle = rgba(VIOLET, 0.12 + (locked ? 0.2 : 0));
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.fill();
  return true;
});

registerZonePainter('f10_blinkmark', (g, z, px, py, S, time) => {
  const zz = z as Zone;
  const k = Math.min(1, zz.t / zz.life);
  // Куда маг выйдет из вспышки: кольцо сжимается к точке.
  g.strokeStyle = rgba(VIOLET, 0.8);
  g.lineWidth = 1;
  g.beginPath();
  g.arc(px, py, z.r * S * (1.4 - k), 0, TAU);
  g.stroke();
  g.fillStyle = rgba(WHITE, 0.8);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + time * 5;
    g.fillRect(
      Math.round(px + Math.cos(a) * z.r * S * 0.6),
      Math.round(py + Math.sin(a) * z.r * S * 0.4),
      1,
      1,
    );
  }
  return true;
});

registerZonePainter('f10_chop', (g, z, px, py, S) => {
  const k = kOf(z as ZoneX);
  const R = z.r * S;
  // Тень секиры падает на круг.
  g.fillStyle = rgba(BLOOD_RED, 0.14 + 0.3 * k);
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.fill();
  g.strokeStyle = rgba(STEEL, 0.4 + 0.6 * k);
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(px - R * k, py);
  g.lineTo(px + R * k, py);
  g.stroke();
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.stroke();
  return true;
});

registerZonePainter('f10_flail', (g, z, px, py, S, time) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const R = zz.r * S;
  const w = (zz.w ?? 0.7) * S;
  // Кольцо цепа: безопасно внутри и снаружи.
  g.strokeStyle = rgba(BLOOD_RED, 0.14 + 0.28 * k);
  g.lineWidth = w * 2;
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.stroke();
  g.lineWidth = 1;
  g.strokeStyle = rgba(STEEL, 0.4 + 0.5 * k);
  g.beginPath();
  g.arc(px, py, R - w, 0, TAU);
  g.stroke();
  g.beginPath();
  g.arc(px, py, R + w, 0, TAU);
  g.stroke();
  // Шар бежит по кольцу — быстрее к удару.
  const a = time * (4 + 10 * k);
  g.fillStyle = rgba(STEEL, 0.9);
  g.fillRect(Math.round(px + Math.cos(a) * R) - 1, Math.round(py + Math.sin(a) * R) - 1, 3, 3);
  return true;
});

registerZonePainter('f10_puff', (g, z, px, py, S) => {
  const zz = z as Zone;
  const k = Math.min(1, zz.t / zz.life);
  g.fillStyle = rgba(hx('#3a2a30'), 0.7 * (1 - k));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    const r = z.r * S * (0.3 + k);
    g.beginPath();
    g.arc(px + Math.cos(a) * r * 0.6, py - 3 + Math.sin(a) * r * 0.4 - k * 6, 3 + k * 2, 0, TAU);
    g.fill();
  }
  g.fillStyle = rgba(GOLD[3], 1 - k);
  g.fillRect(Math.round(px), Math.round(py - 4 - k * 8), 1, 1);
  return true;
});

registerZonePainter('f10_chain', (g, z, px, py, S) => {
  const zz = z as ZoneX;
  if (zz.mx === undefined || zz.my === undefined) return true;
  // Цепь от столба к ошейнику: звенья, провис к земле.
  const x1 = zz.mx * S - (zz.x * S - px);
  const y1 = zz.my * S - (zz.y * S - py);
  const d = Math.hypot(x1 - px, y1 - py);
  const n = Math.max(3, Math.round(d / 2));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = px + (x1 - px) * t;
    const y = py - 5 + (y1 - py + 3) * t + Math.sin(t * Math.PI) * Math.max(0, 6 - d * 0.1);
    g.fillStyle = i % 2 ? 'rgba(122,118,132,1)' : 'rgba(74,70,82,1)';
    g.fillRect(Math.round(x), Math.round(y), 1, 1);
  }
  return true;
});

registerZonePainter('f10_spikewarn', (g, z, px, py, S) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const L = zz.r * S;
  const w = (zz.w ?? 0.5) * S;
  // Прорези раскаляются, из них показываются острия.
  g.fillStyle = rgba(hx('#ff4a28'), 0.12 + 0.35 * k);
  g.fillRect(Math.round(px), Math.round(py - w), Math.round(L), Math.round(w * 2));
  g.fillStyle = rgba(hx('#c8c8d4'), 1);
  const h = Math.round(k * 2);
  if (h)
    for (let x = 3; x < L; x += 4) {
      g.fillRect(Math.round(px + x), Math.round(py - 4 - h), 1, h);
      g.fillRect(Math.round(px + x), Math.round(py + 2 - h), 1, h);
    }
  return true;
});

registerZonePainter('f10_spikes', (g, z, px, py) => {
  const zz = z as Zone;
  const warn = zz.warn ?? 0;
  if (zz.t < warn) return true;
  const t = (zz.t - warn) / zz.life;
  const h = Math.round((t < 0.12 ? t / 0.12 : 1 - Math.max(0, t - 0.6) / 0.4) * 9);
  if (h <= 0) return true;
  // Шипы из прорезей: широкие у основания, игла на конце.
  for (const dx of [-5, -1, 3])
    for (const dy of [-4, 2]) {
      const x = Math.round(px + dx);
      const y = Math.round(py + dy);
      for (let k = 0; k < h; k++) {
        const w = k < h * 0.4 ? 1 : 0;
        g.fillStyle = k === h - 1 ? 'rgba(255,255,255,1)' : 'rgba(40,40,46,1)';
        g.fillRect(x - w, y - k, 1 + w * 2, 1);
        if (k < h - 1) {
          g.fillStyle = 'rgba(206,210,220,1)';
          g.fillRect(x, y - k, 1, 1);
        }
      }
    }
  return true;
});

registerZonePainter('f10_mend', (g, z, px, py, S) => {
  const zz = z as Zone;
  const k = Math.min(1, zz.t / zz.life);
  // Доски возвращаются: золотистая пыль и звенья цепей.
  g.fillStyle = rgba(GOLD[2], 1 - k);
  for (let i = 0; i < 4; i++)
    g.fillRect(Math.round(px - 6 + i * 4), Math.round(py - 6 + (1 - k) * 8), 1, 2);
  g.strokeStyle = rgba(hx('#7a7684'), 1 - k);
  g.lineWidth = 1;
  g.strokeRect(
    Math.round(px - z.r * S),
    Math.round(py - z.r * S),
    Math.round(z.r * S * 2),
    Math.round(z.r * S * 2),
  );
  return true;
});

registerZonePainter('f10_barsfall', (g, z, px, py, S) => {
  const zz = z as Zone;
  const k = Math.min(1, zz.t / zz.life);
  // Решётка рушится сверху: пыль у основания.
  g.fillStyle = rgba(hx('#7a6a5a'), 0.8 * (1 - k));
  for (let i = 0; i < 5; i++)
    g.fillRect(Math.round(px - 7 + i * 3), Math.round(py + 4 + k * 3), 2, 1);
  void S;
  return true;
});

registerZonePainter('f10_glass', (g, z, px, py, S, time) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const R = z.r * S;
  // Стекло витража летит сверху: тень и цветные осколки.
  g.fillStyle = rgba(hx('#000000'), 0.15 + 0.3 * k);
  g.beginPath();
  g.ellipse(px, py, R * k, R * k * 0.6, 0, 0, TAU);
  g.fill();
  const cols = [hx('#c8323a'), hx('#7a4ac8'), hx('#e8b040'), hx('#3a6aa8')];
  for (let i = 0; i < 4; i++) {
    g.fillStyle = rgba(cols[(i + zz.id) % 4], 0.9);
    const x = px + (hash(i, zz.id) - 0.5) * R * 1.5;
    const y = py - (1 - k) * 50 + (hash(i, zz.id, 2) - 0.5) * 6;
    g.fillRect(Math.round(x), Math.round(y), 2, 1 + (i % 2));
  }
  void time;
  return true;
});

registerZonePainter('f10_emblem', (g, z, px, py, S) => {
  // Герб перед помостом: рогатая корона золотом в чёрном мраморе.
  const R = z.r * S;
  g.strokeStyle = 'rgba(168,112,32,0.55)';
  g.lineWidth = 1;
  g.beginPath();
  g.ellipse(px, py, R, R * 0.55, 0, 0, TAU);
  g.stroke();
  g.beginPath();
  g.ellipse(px, py, R * 0.8, R * 0.44, 0, 0, TAU);
  g.stroke();
  g.fillStyle = 'rgba(216,162,58,0.6)';
  g.fillRect(Math.round(px - 6), Math.round(py), 13, 2);
  for (const dx of [-6, -3, 0, 3, 6])
    g.fillRect(Math.round(px + dx), Math.round(py - (dx === 0 ? 4 : 2)), 1, 2);
  g.fillStyle = 'rgba(200,30,30,0.7)';
  g.fillRect(Math.round(px), Math.round(py - 1), 1, 1);
  return true;
});

// ---------------------------------------------------------------------------
// Снаряд: поцелуй суккубы — сердце летит медленно, пульсирует.
// ---------------------------------------------------------------------------

registerShotPainter('f10_heart', (_s, time) => {
  const f = Math.floor(time * 8) % 2;
  return sprite(`heart|${f}`, () => {
    const p = new Px(11, 10);
    const H = [hx('#8a1040'), hx('#e0306a'), hx('#ff7aa8'), hx('#ffd0e0')];
    const r = f ? 2.6 : 2.3;
    p.ell(3.5, 3.5, r, r, H[1]);
    p.ell(7.5, 3.5, r, r, H[1]);
    poly(
      p,
      [
        [1, 4],
        [10, 4],
        [5.5, 9],
      ],
      H[1],
    );
    p.ell(3, 3, 1.2, 1, H[2]);
    p.set(3, 2, H[3]);
    p.outline(hx('#3a0418'));
    return { p, ax: 5, ay: 5 };
  });
});

// ---------------------------------------------------------------------------
// Иконки вещей 10×10.
// ---------------------------------------------------------------------------

registerItemArt('f10mat', () => {
  // Адский обсидиан: чёрный скол с фиолетовой кромкой.
  const p = new Px(10, 10);
  poly(
    p,
    [
      [2, 8],
      [4, 1.5],
      [8, 3],
      [8.5, 7],
      [5, 9],
    ],
    (x, y) => tone(tn('#0a060e', '#1e1428', '#3a2850', '#8a70c0'), 0.9 - (x + y) * 0.08),
  );
  stroke(p, 4, 2, 5, 8, hx('#4a3868'));
  p.outline(INK);
  p.set(4, 2, WHITE);
  return p;
});

registerItemArt('f10_claw', () => {
  const p = new Px(10, 10);
  const pts = spline(
    [
      [2, 8.5],
      [4, 6],
      [6.5, 4],
      [8, 1.5],
    ],
    4,
  );
  pts.forEach(([x, y], i) => {
    const r = 1.8 * (1 - i / pts.length) + 0.4;
    shadeEll(p, x, y, r, r, STONE, 0.2);
  });
  p.outline(INK);
  p.set(8, 1, hx('#ff3a2a'));
  return p;
});

registerItemArt('f10_shoe', () => {
  const p = new Px(10, 10);
  for (let a = 0.2; a < Math.PI - 0.2; a += 0.12) {
    const x = 5 + Math.cos(a) * 3.4;
    const y = 4 + Math.sin(a) * 3.8;
    p.ell(x, y, 1.1, 1.1, tone(IRON, 0.8 - a * 0.2));
  }
  p.outline(INK);
  for (const [x, y] of [
    [2, 5],
    [8, 5],
  ])
    p.set(x, y, FIRE[2]);
  p.set(5, 8, FIRE[3]);
  return p;
});

registerItemArt('f10_silk', () => {
  const p = new Px(10, 10);
  const pts = spline(
    [
      [1, 7],
      [3, 3],
      [6, 6],
      [9, 2],
    ],
    5,
  );
  pts.forEach(([x, y], i) => {
    p.set(Math.round(x), Math.round(y), i % 3 ? hx('#b040a0') : hx('#ff90e0'));
    p.set(Math.round(x), Math.round(y) + 1, hx('#6a1a5a'));
  });
  p.outline(INK);
  return p;
});

registerItemArt('f10_sigil', () => {
  const p = new Px(10, 10);
  p.ell(5, 5.5, 3.6, 3.6, GOLD[2]);
  p.ell(5, 5.5, 2.2, 2.2, [0, 0, 0, 0]);
  for (let y = 0; y < 10; y++)
    for (let x = 0; x < 10; x++)
      if (Math.hypot(x + 0.5 - 5, y + 0.5 - 5.5) < 2.2) p.data[(y * 10 + x) * 4 + 3] = 0;
  shadeEll(p, 5, 2.2, 1.8, 1.6, tn('#3a1a6a', '#6a3aaa', '#a070ff', '#e0d0ff'));
  p.outline(INK);
  p.set(4, 5, GOLD[3]);
  return p;
});

registerItemArt('f10_crown', () => {
  const p = new Px(10, 10);
  p.rect(1, 6, 8, 8, GOLD[2]);
  p.rect(1, 8, 8, 8, GOLD[1]);
  for (const x of [1, 4, 7]) p.rect(x, 4, x + 1, 5, GOLD[2]);
  limb(p, 1.5, 5, 0.5, 1, 0.8, 0.3, tn('#0a080a', '#1c181c', '#34303a', '#5a5462'));
  limb(p, 7.5, 5, 8.5, 1, 0.8, 0.3, tn('#0a080a', '#1c181c', '#34303a', '#5a5462'));
  p.outline(INK);
  p.set(4, 7, hx('#ff2a2a'));
  p.set(5, 7, hx('#ff9a8a'));
  p.set(2, 6, GOLD[3]);
  return p;
});

registerItemArt('f10_hellmeat', () => {
  const p = new Px(10, 10);
  shadeEll(p, 4.5, 5.5, 3.6, 3, tn('#3a0c0a', '#6a1a14', '#9a2e20', '#c8543a'));
  limb(p, 6.5, 3.5, 8.5, 1.5, 0.8, 0.8, tn('#4e4234', '#8a7c62', '#c2b494', '#ece2c6'));
  p.outline(INK);
  p.set(3, 4, FIRE[1]);
  p.set(5, 6, FIRE[2]);
  return p;
});

registerItemArt('f10_heart', () => {
  const p = new Px(10, 10);
  shadeEll(p, 5, 5.5, 3.6, 3.4, tn('#2a0406', '#5a0a10', '#8a141c', '#c02a2e'));
  limb(p, 4, 2.5, 3, 0.5, 0.8, 0.5, tn('#2a0406', '#5a0a10', '#8a141c', '#c02a2e'));
  p.outline(INK);
  for (const [x, y] of [
    [4, 5],
    [5, 6],
    [6, 5],
  ])
    p.set(x, y, hx('#ff5a2a'));
  return p;
});
