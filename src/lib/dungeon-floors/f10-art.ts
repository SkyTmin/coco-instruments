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
  registerCellPainter,
  registerItemArt,
  registerMobPainter,
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

const INK = hx('#150f0b');
const WHITE = hx('#ffffff');
const GOLDK = hx('#ffcc40');
const TAU = Math.PI * 2;

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

/** Детерминированный шум по двум числам, 0…1. */
const hash = (a: number, b: number, c = 0) => {
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
const F10_SHEET = ['devil', 'lord', 'iron', 'polearm', 'font0', 'font1', 'flame0', 'flame1', 'skulls'];

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
const deathK = (pose: MobPose) => (pose.mode === 'dying' ? Math.min(3, Math.floor(pose.t / 0.16)) : 0);

// ---------------------------------------------------------------------------
// Палитры.
// ---------------------------------------------------------------------------

const ARMOR = tn('#141118', '#28222e', '#443a4c', '#6e6278');
const ARMOR_HI = hx('#9a8ca4');
const GOLD = tn('#5e3a10', '#9a6a1c', '#d8a23a', '#ffe28a');
const RED = tn('#34070b', '#641015', '#9e1e26', '#d8424a');
const SKIN_D = tn('#2e0c12', '#5a1820', '#8a2a2e', '#b84a44');
const HORN = tn('#2a221c', '#5e5040', '#a09076', '#e2d6bc');
const FIRE = [hx('#8a1a06'), hx('#e05010'), hx('#ffa030'), hx('#fff0a0')];
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
    hp = { ...base, body: 2, tilt: 3, head: [22, 9], jaw: 1, legs: [0.5, 0.5, -0.4, -0.4], tail: 3, mane: fr };
  } else if (mode === 'pounce') {
    anim = 'pounce';
    fr = Math.floor(pose.t * 10) % 2;
    hp = { ...base, body: -2, tilt: -1, stretch: 2, head: [24, 5], jaw: 3, legs: [-1, -1, 1.1, 1.1], tail: -1, mane: 7 + fr };
  } else if (mode === 'windup') {
    anim = 'wind';
    fr = pose.t < 0.2 ? 0 : 1;
    hp = { ...base, body: 1, tilt: 1, head: [20, 8], jaw: 2, legs: [0.3, 0.3, -0.3, -0.3], mane: 2 + fr };
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
      legs: [Math.sin(ph) * 1.1, Math.sin(ph + 0.6) * 1.1, Math.sin(ph + Math.PI) * 1.1, Math.sin(ph + Math.PI + 0.6) * 1.1],
      tail: Math.round(Math.cos(ph) * 1.2) + 1,
      mane: fr,
    };
  } else if (pose.anim === 'hurt') {
    anim = 'hurt';
    hp = { ...base, body: 1, tilt: -2, head: [19, 6], jaw: 2, mane: 9 };
  } else {
    anim = 'idle';
    fr = f % 4;
    hp = { ...base, body: fr === 1 || fr === 2 ? 1 : 0, head: [21, 7 + (fr === 2 ? 1 : 0)], tail: fr % 2, mane: fr };
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
  for (let y = hip; y < G - 4; y++) p.set(Math.round(cx + 3.5 + (gp.step * 0.5 * (y - hip)) / 10), y, GOLD[1]);
  p.rect(Math.round(cx - 1 + gp.step * 0.5), G - 5, Math.round(cx + 3 + gp.step * 0.5), G - 5, GOLD[2]);
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
    gp = { pole: a, grip: [1, 1], push: -2, bob: fr > 1 ? 1 : 0, step: -1, lean: -1, swing: fr === 3 };
  } else if (mode === 'thrust') {
    const k = Math.min(1, pose.t / (GUARD.thrustWarn - 0.05));
    anim = 'thrust';
    fr = Math.min(2, Math.floor(k * 3));
    gp = { pole: -0.05, grip: [0, 5], push: -3 - fr, bob: 0, step: -1, lean: -1 - (fr > 0 ? 1 : 0), swing: fr === 2 };
  } else if (mode === 'recover' && pose.t < 0.3) {
    // Следом за ударом: лезвие внизу впереди или древко выброшено.
    anim = 'strike';
    fr = pose.t < 0.14 ? 0 : 1;
    gp = { pole: fr ? 0.55 : 0.2, grip: [6, 5], push: fr ? 2 : 5, bob: 1, step: 2, lean: 2, swing: true };
  } else if (mode === 'f10_stand' || mode === 'alertpost') {
    anim = mode === 'alertpost' ? 'alert' : 'stand';
    fr = f % 4;
    gp = { pole: -Math.PI / 2 + 0.08, grip: [5, 5], push: 3, bob: fr === 2 ? 1 : 0, step: 0, lean: 0 };
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
    const y = Math.round(hipY + 3 + rear * 0.3 + ((shY - hipY - rear * 0.3) * (x - hipX - 3)) / (shX - hipX - 6));
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
  for (const k of [0.3, 0.55]) p.set(Math.round(bx + (tx - bx) * k), Math.round(byy + (ty - byy) * k), GOLD[2]);
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
    for (let j = 0; j < hgt; j++) p.set(x - Math.floor(j / 2), y - j, j === 0 ? FIRE[1] : j === hgt - 1 ? FIRE[3] : FIRE[2]);
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
  const base: KnightPose = { legs: [0, 0, 0, 0], body: 0, rear: 0, neck: 0, lance: -1.1, push: 0, mane: 0 };
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
    kp = { ...base, rear: fr % 2 ? 2 : 1, legs: [0, 0, fr % 2 ? -1.2 : 0.3, 0], lance: -1.1 + k * 1.1, neck: 1, mane: fr };
  } else if (mode === 'charge') {
    anim = 'charge';
    fr = Math.floor(pose.t * 14) % 4;
    const ph = (fr / 4) * TAU;
    kp = {
      ...base,
      legs: [Math.sin(ph) * 1.4, Math.sin(ph + 0.5) * 1.4, Math.sin(ph + Math.PI) * 1.4, Math.sin(ph + Math.PI + 0.5) * 1.4],
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
    kp = { ...base, rear: 4 - (fr % 2), neck: -2, lance: -1.7, legs: [0.4, 0, -1.2, -0.6], mane: fr, dizzy: fr };
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
      legs: [Math.sin(ph) * 1, Math.sin(ph + 0.5) * 1, Math.sin(ph + Math.PI) * 1, Math.sin(ph + Math.PI + 0.5) * 1],
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
    kp = { ...base, body: fr === 2 ? 1 : 0, neck: fr === 1 ? 1 : 0, legs: [0, 0, fr === 3 ? 0.4 : 0, 0], mane: fr };
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
  const elbow: [number, number] = [sx + Math.cos(a - 0.5) * len * 0.45, sy + Math.sin(a - 0.5) * len * 0.45];
  // Перепонка: многоугольник плечо → локоть → кончики → назад к плечу.
  const edge: [number, number][] = [[sx, sy], elbow, ...fingers];
  const low: [number, number] = [sx + Math.cos(a + 1.1 * spread) * len * 0.35, sy + Math.sin(a + 1.1 * spread) * len * 0.35];
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
  batWing(p, cx - 2, sh + 1, wa - 0.25, 13, tn('#08040a', '#180a16', '#2a1426', '#401e38'), SUC.bone, 0.9);
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
    sp = { wing: flap(fr), lean: pose.anim === 'run' ? 1 : 0, arm: 1.3, head: 0, legs: fr === 2 ? 1 : 0 };
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
  for (let x = Math.round(cx - 7 + hem * 0.5); x <= Math.round(cx + 7 + hem); x++) p.set(x, G - 1, MAGE_T.trim[2]);
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
      p.set(Math.round(hdx + Math.cos(ra) * 5.5), Math.round(hdy - 9 + Math.sin(ra) * 1.8), i % 2 ? O[2] : O[3]);
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
      out.set(cx + Math.round((hash(i, mp.squash * 10) - 0.5) * 12), 6 + Math.round(hash(i, 4) * 30), O[2]);
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
  const by = ep.over ? sh - 7 + Math.sin(ep.ball) * ep.ballR * 0.35 : lhy + Math.sin(ep.ball) * ep.ballR;
  const hand: [number, number] = ep.over ? [cx + 1, sh - 7] : [lhx, lhy];
  limb(p, cx - 3, sh + 2, hand[0], hand[1], 2.2, 1.8, tn('#1e1210', '#3e2822', '#5e3e32', '#7e5a48'));
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
  limb(p, cx - 2, hip, cx - 3 - st, G - 1, 2.8, 2.4, tn('#100a08', '#24160e', '#3a2616', '#523820'));
  limb(p, cx + 3, hip, cx + 4 + st, G - 1, 2.9, 2.5, tn('#1a100a', '#342014', '#4e321e', '#6a482a'));
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
  for (let x = cx - 4; x <= cx + 4; x++) if (x !== cx) p.set(x, sh + 5 + (Math.abs(x - cx) > 2 ? 0 : 1), skinD);
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
    ep = { axe: 1.3, ball: 1.57 + Math.sin(fr) * 0.2, ballR: 5, over: false, bob: fr === 2 ? 1 : 0, step: 0 };
  } else if (pose.anim === 'run') {
    anim = 'run';
    fr = f % 4;
    ep = { axe: -0.6, ball: 1.57 + [0.4, 0, -0.4, 0][fr], ballR: 5, over: false, bob: fr % 2, step: [2, 0, -2, 0][fr] };
  } else if (pose.anim === 'hurt') {
    anim = 'hurt';
    ep = { axe: -1.2, ball: 2.2, ballR: 5, over: false, bob: 1, step: -1 };
  } else {
    anim = 'idle';
    fr = f % 4;
    ep = { axe: -0.7, ball: 1.57 + [0.25, 0.1, -0.15, 0.1][fr], ballR: 5, over: false, bob: fr === 1 || fr === 2 ? 1 : 0, step: 0 };
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
  if (gp.eyes) for (const [x, y] of gargEyes) p.set(x, y, gp.stone > 0.5 ? hx('#ff6a3a') : hx('#ff3a2a'));
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
  const base: GargPose = { stone: 0, wing: 0, bob: 0, lean: 0, z: 0, cracks: 0, eyes: true, plinth: false };
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
    gp = { ...base, stone: 1 - fr * 0.25, cracks: (fr + 1) / 4, eyes: fr >= 1, plinth: fr < 3, wing: fr === 3 ? -1 : 0 };
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
// Король демонов. Чёрные латы с золотой каймой, багровый плащ, рогатая
// корона, белые волосы, глаза-угли, двуручный чёрный меч с кровавой
// кромкой; с третьей фазы — крылья. На троне и в переходах фаз — лицом к
// зрителю, в бою — в профиль. Кадр 80×100, земля — ряд 90.
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

/** Двуручный меч: от рукояти по углу, лезвие с кровавой кромкой. */
function kingSword(p: Px, x: number, y: number, a: number, len: number, glow: number): void {
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const nx = -uy;
  const ny = ux;
  // Рукоять и навершие.
  stroke(p, x - ux * 5, y - uy * 5, x, y, hx('#2a1a14'));
  p.ell(x - ux * 6, y - uy * 6, 1.2, 1.2, KG.gold[2]);
  p.set(Math.round(x - ux * 6), Math.round(y - uy * 6), KG.gem);
  // Гарда — золотые рога.
  stroke(p, x - nx * 4 - ux, y - ny * 4 - uy, x + nx * 4 - ux, y + ny * 4 - uy, KG.gold[2], 1.6);
  p.set(Math.round(x - nx * 4 - ux * 2), Math.round(y - ny * 4 - uy * 2), KG.gold[3]);
  p.set(Math.round(x + nx * 4 - ux * 2), Math.round(y + ny * 4 - uy * 2), KG.gold[3]);
  // Клинок: широкий у гарды, к острию сужается.
  const pts: [number, number][] = [
    [x + nx * 2.2, y + ny * 2.2],
    [x + ux * len * 0.8 + nx * 1.8, y + uy * len * 0.8 + ny * 1.8],
    [x + ux * len, y + uy * len],
    [x + ux * len * 0.8 - nx * 1.8, y + uy * len * 0.8 - ny * 1.8],
    [x - nx * 2.2, y - ny * 2.2],
  ];
  poly(p, pts, (px, py) => {
    const e = (px + 0.5 - x) * nx + (py + 0.5 - y) * ny;
    const along = ((px - x) * ux + (py - y) * uy) / len;
    if (Math.abs(e) > 1.3) return glow > 0 ? mixc(KG.edge, hx('#ffd0a0'), glow * 0.5) : hx('#a0202a');
    return tone(KG.blade, 0.5 + e * 0.35 - along * 0.2);
  });
  // Руны по долу.
  for (let i = 2; i < len * 0.7; i += 3)
    p.set(Math.round(x + ux * i), Math.round(y + uy * i), glow > 0.5 ? hx('#ffb080') : hx('#7a1418'));
}

interface KingPose {
  view: 'front' | 'side';
  /** Сидит на троне. */
  sit?: boolean;
  /** Меч: угол и длина; в профиле — от кисти. */
  sword: number;
  /** Кисть: смещение от плеча. */
  hand: [number, number];
  glow: number;
  /** Крылья: 0 — нет, 0…1 раскрыты, взмах. */
  wings: number;
  flap: number;
  step: number;
  bob: number;
  lean: number;
  /** Плащ: колыхание. */
  cape: number;
  /** Поднятая свободная рука (фронт: призыв / раскинутые руки). */
  raise?: number;
  /** Голова запрокинута (рёв). */
  roar?: boolean;
  dead?: boolean;
}

/** Крыло короля: кости и перепонка с кровавыми жилами. */
function kingWing(p: Px, sx: number, sy: number, a: number, len: number, open: number, far: boolean): void {
  const t = far ? tn('#060406', '#10080c', '#1c0e14', '#2a141c') : KG.wing;
  const bone = far ? tn('#1a1016', '#2a1a22', '#3a2630', '#4a3440') : tn('#2a1a20', '#4a3038', '#6e4a54', '#94707a');
  const spread = 0.3 + open * 0.7;
  const elbow: [number, number] = [sx + Math.cos(a - 0.4) * len * 0.42, sy + Math.sin(a - 0.4) * len * 0.42];
  const tips: [number, number][] = [];
  for (let i = 0; i < 4; i++) {
    const fa = a + (i - 0.5) * 0.36 * spread;
    const fl = len * (1 - i * 0.1);
    tips.push([elbow[0] + Math.cos(fa) * fl * 0.62, elbow[1] + Math.sin(fa) * fl * 0.62]);
  }
  const low: [number, number] = [sx + Math.cos(a + 1.2 * spread) * len * 0.3, sy + Math.sin(a + 1.2 * spread) * len * 0.3];
  poly(p, [[sx, sy], elbow, ...tips, low], (x, y) => {
    const d = Math.hypot(x - sx, y - sy) / len;
    return tone(t, 0.6 - d * 0.45 + ((x * 3 + y) % 7 === 0 ? -0.15 : 0));
  });
  // Жилы в перепонке.
  if (!far)
    for (const [tx, ty] of tips.slice(0, 3)) {
      const mx = (elbow[0] + tx) / 2 + (low[0] - elbow[0]) * 0.2;
      const my = (elbow[1] + ty) / 2 + (low[1] - elbow[1]) * 0.2;
      p.set(Math.round(mx), Math.round(my), KG.vein);
      p.set(Math.round((mx + tx) / 2), Math.round((my + ty) / 2), KG.vein);
    }
  limb(p, sx, sy, elbow[0], elbow[1], 1.5, 1.1, bone);
  for (const [tx, ty] of tips) stroke(p, elbow[0], elbow[1], tx, ty, bone[2]);
  // Коготь на сгибе.
  limb(p, elbow[0], elbow[1], elbow[0] - 1, elbow[1] - 3, 0.8, 0.3, HORN);
}

/** Голова: корона-рога, белые волосы, тёмное лицо и глаза-угли. */
function kingHead(p: Px, x: number, y: number, side: boolean, roar: boolean): [number, number] {
  // Волосы — за головой, до лопаток.
  for (let i = 0; i < 6; i++) {
    const off = side ? -1 - i * 0.6 : (i - 2.5) * 1.4;
    const hair = spline(
      [
        [x + off * 0.4, y - 3],
        [x + off - (side ? 2 : 0), y + 2],
        [x + off * 1.2 - (side ? 4 : 0), y + 7 + (i % 2)],
        [x + off * 1.3 - (side ? 5 : 0), y + 11 + (i % 3)],
      ],
      4,
    );
    hair.forEach(([hx0, hy0], n) => p.set(Math.round(hx0), Math.round(hy0), KG.hair[n % 4 === 0 ? 3 : n % 2 ? 2 : 1]));
  }
  shadeEll(p, x, y, 3.8, 4.2, KG.face, 0.05);
  // Корона: золотой обод с зубцами.
  for (let dx = -4; dx <= 4; dx++) {
    p.set(Math.round(x + dx), Math.round(y - 3), KG.gold[dx < 0 ? 1 : 2]);
    if (dx % 2 === 0) p.set(Math.round(x + dx), Math.round(y - 4), KG.gold[3]);
  }
  p.set(Math.round(x), Math.round(y - 5), KG.gold[3]);
  p.set(Math.round(x), Math.round(y - 4), KG.gem);
  // Рога — большие, изогнутые.
  const horn = (s: number) => {
    const pts = spline(
      [
        [x + s * 2.5, y - 3],
        [x + s * 6, y - 6],
        [x + s * 6.5, y - 11],
        [x + s * 4.5, y - 14],
      ],
      4,
    );
    pts.forEach(([hx0, hy0], n) => {
      const r = 1.6 * (1 - n / pts.length) + 0.4;
      shadeEll(p, hx0, hy0, r, r, tn('#0a080a', '#1c181c', '#34303a', '#5a5462'));
    });
  };
  if (side) {
    horn(-1);
    horn(0.6);
  } else {
    horn(-1);
    horn(1);
  }
  // Лицо: тень под короной и глаза.
  const ex = side ? x + 1.5 : x;
  const ey = y + (roar ? -0.5 : 0.5);
  if (side) {
    p.set(Math.round(ex + 1), Math.round(ey), KG.gem);
    p.set(Math.round(ex + 2), Math.round(ey), hx('#ffb080'));
  } else {
    p.set(Math.round(ex - 1.5), Math.round(ey), KG.gem);
    p.set(Math.round(ex + 1.5), Math.round(ey), KG.gem);
    p.set(Math.round(ex - 1.5), Math.round(ey) - 1, hx('#ff9070'));
    p.set(Math.round(ex + 1.5), Math.round(ey) - 1, hx('#ff9070'));
  }
  if (roar) {
    for (let dx = -1; dx <= 1; dx++) p.set(Math.round(ex + dx + (side ? 1 : 0)), Math.round(ey + 2.5), hx('#ff5a2a'));
  }
  return [Math.round(side ? ex + 1 : ex - 1.5), Math.round(ey)];
}

function drawKingFront(kp: KingPose): Built {
  const W = 84;
  const p = new Px(W, 100);
  const G = 90;
  const cx = 42;
  const sit = !!kp.sit;
  const hip = sit ? G - 18 : G - 24 + kp.bob;
  const sh = hip - 16;
  // Крылья — за всем.
  if (kp.wings > 0) {
    const a0 = -Math.PI / 2 - 0.9 * kp.wings - kp.flap * 0.2;
    kingWing(p, cx - 5, sh + 2, a0 - 0.2, 26 * (0.5 + kp.wings * 0.5), kp.wings, false);
    // Правое крыло — зеркально.
    const q = new Px(W, 100);
    kingWing(q, cx - 5, sh + 2, a0 - 0.2, 26 * (0.5 + kp.wings * 0.5), kp.wings, false);
    const qf = q.flipX();
    for (let i = 0; i < qf.data.length; i += 4)
      if (qf.data[i + 3]) {
        p.data[i] = qf.data[i];
        p.data[i + 1] = qf.data[i + 1];
        p.data[i + 2] = qf.data[i + 2];
        p.data[i + 3] = 255;
      }
  }
  // Плащ за спиной: от плеч до земли, расходится.
  const capeW = 12 + (kp.raise ? 2 : 0);
  poly(
    p,
    [
      [cx - 9, sh],
      [cx + 9, sh],
      [cx + capeW + kp.cape, G - 1],
      [cx - capeW + kp.cape, G - 1],
    ],
    (x, y) => {
      const k = Math.abs(x - cx) / capeW;
      const fold = (x + Math.floor((y - sh) / 5)) % 4 === 0 ? -0.25 : 0;
      return tone(KG.capeIn, 0.7 - k * 0.5 + fold);
    },
  );
  for (let x = cx - capeW + Math.round(kp.cape); x <= cx + capeW + Math.round(kp.cape); x++) p.set(x, G - 1, KG.gold[1]);
  if (sit) {
    // Бёдра к зрителю — колени, голени вниз.
    for (const s of [-1, 1]) {
      shadeEll(p, cx + s * 5, hip + 1, 4, 3.4, KG.armor, 0.1);
      limb(p, cx + s * 6, hip + 3, cx + s * 6.5, G - 2, 2.8, 2.4, KG.armor);
      p.rect(cx + s * 6.5 - 3, G - 2, cx + s * 6.5 + 3, G - 1, KG.armor[2]);
      p.set(cx + s * 5, hip - 1, KG.gold[2]);
    }
  } else {
    for (const s of [-1, 1]) {
      const st = s * kp.step;
      limb(p, cx + s * 4, hip, cx + s * 5 + st, G - 7, 3, 2.6, KG.armor);
      limb(p, cx + s * 5 + st, G - 7, cx + s * 5.5 + st, G - 1, 2.5, 2.7, KG.armor);
      p.set(Math.round(cx + s * 5 + st), G - 7, KG.gold[2]);
    }
  }
  // Набедренник: пластины с золотой каймой.
  poly(
    p,
    [
      [cx - 8, hip - 3],
      [cx + 8, hip - 3],
      [cx + 9, hip + 3],
      [cx - 9, hip + 3],
    ],
    (x, y) => tone(KG.armor, 0.55 - (x - cx) * 0.03 - ((y - hip) % 3 === 0 ? 0.25 : 0)),
  );
  p.rect(cx - 9, hip + 3, cx + 9, hip + 3, KG.gold[1]);
  // Кираса.
  polyShade(
    p,
    [
      [cx - 9, sh],
      [cx + 9, sh],
      [cx + 7, hip - 2],
      [cx - 7, hip - 2],
    ],
    KG.armor,
  );
  // Золото по вороту, по середине — камень-сердце.
  for (let x = -7; x <= 7; x++) p.set(cx + x, sh + 1, KG.gold[x < 0 ? 1 : 2]);
  for (let y = sh + 2; y < hip - 2; y++) p.set(cx, y, KG.gold[1]);
  p.ell(cx, sh + 7, 1.8, 2, KG.gem);
  p.set(cx - 1, sh + 6, hx('#ffb0a0'));
  // Наплечники — шипастые.
  for (const s of [-1, 1]) {
    shadeEll(p, cx + s * 9, sh + 1, 5, 3.6, KG.armor, s < 0 ? 0.15 : -0.05);
    for (let i = 0; i < 3; i++) limb(p, cx + s * (7 + i * 2.5), sh - 1, cx + s * (7.5 + i * 3), sh - 5 - (i === 1 ? 1 : 0), 0.9, 0.3, HORN);
    for (let x = -4; x <= 4; x++) p.set(cx + s * 9 + x, sh + 4, KG.gold[2]);
  }
  // Руки и меч.
  const raise = kp.raise ?? 0;
  let eye: [number, number];
  if (sit && raise <= 0) {
    // Меч воткнут перед ним, руки на навершии.
    kingSword(p, cx, hip - 3, Math.PI / 2, 26, kp.glow);
    for (const s of [-1, 1]) limb(p, cx + s * 9, sh + 3, cx + s * 2, hip - 4, 2.4, 2, KG.armor);
    shadeEll(p, cx, hip - 4, 3, 2, KG.armor, 0.2);
    eye = kingHead(p, cx, sh - 5, false, false);
  } else if (raise > 0 && sit) {
    // Зов: правая рука с мечом вверх, левая — на подлокотнике.
    limb(p, cx - 9, sh + 3, cx - 12, hip - 2, 2.4, 2, KG.armor);
    limb(p, cx + 9, sh + 2, cx + 12, sh - 8 * raise, 2.4, 2, KG.armor);
    kingSword(p, cx + 12, sh - 8 * raise, -Math.PI / 2 + 0.1, 26, kp.glow);
    eye = kingHead(p, cx, sh - 5, false, false);
  } else {
    // Стоит лицом к зрителю: руки раскинуты (рёв, крылья) или меч у ноги.
    const spread = raise;
    limb(p, cx - 9, sh + 3, cx - 12 - spread * 5, sh + 10 - spread * 12, 2.4, 2, KG.armor);
    limb(p, cx + 9, sh + 3, cx + 12 + spread * 5, sh + 10 - spread * 12, 2.4, 2, KG.armor);
    kingSword(p, cx + 12 + spread * 5, sh + 10 - spread * 12, Math.PI / 2 - spread * 1.2, 26, kp.glow);
    eye = kingHead(p, cx, sh - 5, false, !!kp.roar);
  }
  p.outline(INK);
  return { p, ax: cx, ay: G, eye };
}

function drawKingSide(kp: KingPose): Built {
  const W = 84;
  const p = new Px(W, 100);
  const G = 90;
  const cx = 40 + kp.lean;
  const hip = G - 24 + kp.bob;
  const sh = hip - 15;
  // Дальнее крыло.
  if (kp.wings > 0) kingWing(p, cx - 3, sh + 2, -Math.PI * 0.72 - kp.flap * 0.35, 30 * (0.55 + kp.wings * 0.45), kp.wings, true);
  // Плащ — назад, по ходу колышется.
  const back = 9 + kp.cape;
  poly(
    p,
    [
      [cx - 3, sh - 1],
      [cx + 4, sh],
      [cx - 1, G - 1],
      [cx - back - 3, G - 2],
      [cx - back, hip],
    ],
    (x, y) => {
      const fold = (x * 2 + Math.floor((y - sh) / 4)) % 5 === 0 ? -0.25 : 0;
      return tone(KG.cape, 0.6 - (cx - x) * 0.04 + fold);
    },
  );
  for (let x = Math.round(cx - back - 3); x <= cx - 1; x++) p.set(x, G - 2, KG.gold[1]);
  // Ноги: шаг.
  const st = kp.step;
  limb(p, cx - 1, hip, cx - 2 - st, G - 8, 2.8, 2.4, tn('#08060a', '#141018', '#26202c', '#3a3242'));
  limb(p, cx - 2 - st, G - 8, cx - 2 - st * 1.2, G - 1, 2.3, 2.5, tn('#08060a', '#141018', '#26202c', '#3a3242'));
  limb(p, cx + 2, hip, cx + 3 + st, G - 8, 3, 2.6, KG.armor);
  limb(p, cx + 3 + st, G - 8, cx + 3 + st * 1.2, G - 1, 2.5, 2.7, KG.armor);
  p.rect(Math.round(cx + 2 + st * 1.2), G - 1, Math.round(cx + 7 + st * 1.2), G - 1, KG.armor[2]);
  p.set(Math.round(cx + 3 + st), G - 8, KG.gold[2]);
  // Набедренник и кираса.
  polyShade(
    p,
    [
      [cx - 5, hip - 3],
      [cx + 6, hip - 3],
      [cx + 7, hip + 3],
      [cx - 5, hip + 3],
    ],
    KG.armor,
  );
  p.rect(cx - 5, hip + 3, cx + 7, hip + 3, KG.gold[1]);
  polyShade(
    p,
    [
      [cx - 5, sh],
      [cx + 7, sh + 1],
      [cx + 6, hip - 3],
      [cx - 4, hip - 3],
    ],
    KG.armor,
  );
  for (let y = sh + 2; y < hip - 3; y++) p.set(cx + 5, y, KG.gold[1]);
  p.ell(cx + 5, sh + 6, 1.2, 1.6, KG.gem);
  // Ближнее крыло сложено за спиной или раскрыто.
  if (kp.wings > 0) kingWing(p, cx - 1, sh + 3, -Math.PI * 0.8 - kp.flap * 0.4, 32 * (0.55 + kp.wings * 0.45), kp.wings, false);
  // Наплечник.
  shadeEll(p, cx + 2, sh + 1, 5, 3.6, KG.armor, 0.12);
  for (let i = 0; i < 3; i++) limb(p, cx + i * 2.5, sh - 1, cx + i * 2.8 - 1, sh - 5 - (i === 1 ? 1 : 0), 0.9, 0.3, HORN);
  for (let x = -3; x <= 5; x++) p.set(cx + 2 + x, sh + 4, KG.gold[2]);
  // Голова в профиль.
  const eye = kingHead(p, cx + 2, sh - 5, true, !!kp.roar);
  // Рука и меч.
  const [hdx, hdy] = kp.hand;
  const gx = cx + 3 + hdx;
  const gy = sh + 4 + hdy;
  limb(p, cx + 3, sh + 2, gx, gy, 2.4, 2, KG.armor);
  shadeEll(p, gx, gy, 2, 1.8, KG.armor, 0.2);
  kingSword(p, gx, gy, kp.sword, 27, kp.glow);
  p.outline(INK);
  return { p, ax: 40, ay: G, eye };
}

registerMobPainter('f10boss', (m: Mob, pose: MobPose) => {
  const mode = pose.mode;
  const f = pose.frame;
  const phase = m.data.phase ?? 0;
  const winged = phase >= 2 ? 1 : 0;
  const z = Math.round((m.data.z ?? 0) * 4) * 4;
  let anim = mode;
  let fr = 0;
  const side: KingPose = {
    view: 'side',
    sword: 0.9,
    hand: [3, 4],
    glow: phase >= 1 ? 0.3 : 0,
    wings: winged * 0.25,
    flap: 0,
    step: 0,
    bob: 0,
    lean: 0,
    cape: 0,
  };
  let kp: KingPose = side;
  switch (mode) {
    case 'f10_throne':
      fr = f % 4;
      kp = { ...side, view: 'front', sit: true, glow: 0, cape: fr === 2 ? 1 : 0, bob: 0 };
      break;
    case 'f10_command':
      fr = Math.min(3, Math.floor(pose.t / 0.25));
      kp = { ...side, view: 'front', sit: true, raise: Math.min(1, pose.t / 0.7), glow: 1, cape: fr % 2 };
      fr = fr * 4 + (Math.floor(pose.t * 8) % 4);
      break;
    case 'f10_rise':
      fr = Math.min(3, Math.floor(pose.t / (KING.rise / 4)));
      kp = { ...side, view: 'front', sit: fr < 2, raise: fr >= 2 ? 0.2 : 0, glow: fr / 3, bob: fr === 2 ? 2 : 0 };
      break;
    case 'f10_unfurl':
      fr = Math.min(3, Math.floor(pose.t / (KING.unfurl / 4)));
      kp = { ...side, view: 'front', wings: (fr + 1) / 4, raise: 0.6 + fr * 0.1, glow: 1, flap: fr % 2 };
      break;
    case 'f10_roar':
      fr = Math.floor(pose.t * 8) % 4;
      kp = { ...side, view: 'front', wings: 1, raise: 1, roar: true, glow: 1, flap: fr % 2 ? 0.6 : -0.3, cape: fr % 2 };
      break;
    case 'slash':
      fr = pose.t < 0.3 ? 0 : 1;
      kp = { ...side, sword: fr ? -2.4 : -1.9, hand: [-3, -6], lean: -2, step: -1, glow: 0.7 };
      break;
    case 'cleave':
      fr = pose.t < 0.35 ? 0 : 1;
      kp = { ...side, sword: fr ? -1.75 : -1.5, hand: [0, -9], lean: -1, step: -1, glow: 0.9 };
      break;
    case 'stuck':
      fr = Math.floor(pose.t * 5) % 2;
      kp = { ...side, sword: 1.2, hand: [6, 9], lean: 3, bob: 3, step: 2, glow: 0.4 + fr * 0.3 };
      break;
    case 'recover':
      fr = pose.t < 0.2 ? 0 : 1;
      kp = fr === 0 ? { ...side, sword: 0.7, hand: [7, 5], lean: 3, step: 2, glow: 0.8 } : { ...side, sword: 0.8, hand: [4, 5] };
      break;
    case 'f10_storm':
      fr = Math.floor(pose.t * 8) % 4;
      kp = { ...side, sword: -1.62, hand: [1, -11], glow: 1, lean: -1, cape: fr % 2 };
      break;
    case 'f10_takeoff':
    case 'f10_air':
      fr = Math.floor(pose.t * 8) % 4;
      kp = { ...side, wings: 1, flap: [1, 0.3, -0.8, -0.2][fr], sword: 0.3, hand: [4, 2], step: -2, lean: 1, cape: 2 };
      break;
    case 'f10_dive':
      kp = { ...side, wings: 1, flap: 1, sword: 1.1, hand: [5, 6], lean: 4, step: -3, glow: 1 };
      break;
    case 'f10_landed':
      fr = Math.floor(pose.t * 4) % 2;
      kp = { ...side, wings: 0.8, flap: -1, sword: 1.35, hand: [7, 10], bob: 4, lean: 3, step: 3, glow: 0.3 };
      break;
    case 'dying':
      fr = deathK(pose);
      kp = { ...side, view: 'front', wings: winged, raise: 0.4, bob: 3, glow: 0, roar: true };
      break;
    default:
      if (pose.anim === 'run') {
        anim = 'walk';
        fr = f % 4;
        kp = { ...side, step: [3, 0, -3, 0][fr], bob: fr % 2 ? 0 : 1, cape: fr % 2 ? 1 : 0 };
      } else {
        anim = 'idle';
        fr = f % 4;
        kp = { ...side, bob: fr === 1 || fr === 2 ? 1 : 0, cape: fr % 2 };
      }
  }
  const zq = mode === 'f10_air' || mode === 'f10_takeoff' || mode === 'f10_dive' ? z : 0;
  const key = `f10boss|${anim}|${fr}|${winged}|${phase >= 1 ? 1 : 0}|${zq}|${pose.left ? 1 : 0}|${pose.flash ? 1 : 0}`;
  const hit = frames.get(key);
  if (hit) return hit;
  const b = kp.view === 'front' ? drawKingFront(kp) : drawKingSide(kp);
  if (mode === 'dying') b.p = ashen(b.p, fr, 3);
  if (zq) {
    // В воздухе: кадр ниже земли на zq — сам король рисуется выше тени.
    b.p = copyAt(b.p, b.p.w, b.p.h + zq, 0, 0);
    b.ay += zq;
  }
  return finish(key, b, 'normal', pose.flash, pose.left);
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

const flashed = (key: string, flash: boolean, make: () => { p: Px; ax: number; ay: number } | null) =>
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
    for (let x = 4; x <= 12; x++) p.set(x, G - 12, hash(x, f) > 0.5 ? hx('#ff6a1a') : hx('#8a1a06'));
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
    for (let y = G - 29; y < G - 23; y++) p.set(15 + Math.round((sw * (y - G + 29)) / 6), y, (y % 2 ? IRON[2] : IRON[1]));
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
      for (let x = 2; x <= 5; x++) p.set(x, y, tone(tn('#1a100a', '#3a2414', '#5a3a1e', '#7a522e'), 0.8 - (x - 2) * 0.25));
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
      for (let k = 0; k < 3; k++) limb(p, cx + s * 13, G - 26 - k * 6, cx + s * 16, G - 28 - k * 6, 0.9, 0.3, stone);
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
      shadeEll(p, cx + s * 12, G - 25, 2.6, 2.4, tn('#4e4234', '#8a7c62', '#c2b494', '#ece2c6'), 0.1);
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
        p.set(x + sx, y, edge ? GOLD[1] : tone(RED, 0.55 - (x - 3) * 0.03 + ((x + y) % 5 === 0 ? -0.15 : 0)));
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
  if (w) for (let x = 0; x < 2; x++) for (let y = 0; y < 16; y++) p.set(x, y, alpha(sh, 0.35 - x * 0.15));
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
      } else
        for (let i = 0; i < 3; i++) stroke(p, 9 + i * 2, 13, 10 + i * 2, 10, bone[1]);
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
      for (let i = 0; i < 4 + v; i++) p.set(Math.floor(hash(i, v, 2) * 16), Math.floor(hash(i, v, 3) * 16), R0);
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
        const [x, y] = side === 'w' ? [0, j] : side === 'e' ? [15, j] : side === 'n' ? [j, 0] : [j, 15];
        p.set(x, y, INK);
        const [x2, y2] = side === 'w' ? [1, j] : side === 'e' ? [14, j] : side === 'n' ? [j, 1] : [j, 14];
        p.set(x2, y2, wood[0]);
      }
      if (post) {
        const [px0, py0] = side === 'w' ? [1, 6] : side === 'e' ? [13, 6] : side === 'n' ? [6, 1] : [6, 13];
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
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, tone(plate, 0.5 - (x + y) * 0.012));
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
        const k = 0.35 + Math.sin((x + (c.wx % 4) * 5) * 0.4) * Math.cos((y + (c.wy % 4) * 3) * 0.35) * 0.25;
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
      for (let x = 0; x < 16; x++) p.set(x, y, tone(Sl, 0.5 + (hash(x, y, gx * 3 + gy) - 0.5) * 0.2));
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
      for (let x = 0; x < 16; x++) p.set(x, y, mixc(T[1], T[2], 0.3 + (hash(x, y, v + 9) > 0.9 ? 0.4 : 0) + (x + y < 10 ? 0.15 : 0)));
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
    for (let i = 0; i < g.length - 1; i++) stroke(p, g[i][0], g[i][1], g[i + 1][0], g[i + 1][1], R0);
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
      for (let x = 0; x < 16; x++) p.set(x, y, tone(STONE, 0.45 + (y < 2 ? 0.2 : 0) - (x > 12 ? 0.2 : 0)));
    for (let x = 0; x < 16; x++) {
      p.set(x, 0, STONE[3]);
      p.set(x, 15, INK);
    }
    const inArch = (x: number, y: number) => x >= 4 && x <= 11 && (y > 5 || Math.abs(x - 7.5) < (y - 1.2) * 1.25) && y <= 13;
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
  const cc: CellCtx = { ...c, mark: best, markAt: (dx, dy) => (dx || dy ? c.markAt(dx, dy) : best) };
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
      if (over.data[i + 3]) q.set((i / 4) % 16, Math.floor(i / 64), [over.data[i], over.data[i + 1], over.data[i + 2], over.data[i + 3]]);
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

type ZoneX = (Zone | Strike) & {
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

const rgba = (c: RGBA, a: number) =>
  `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a)).toFixed(3)})`;

/** Метка удара наливается: `k` 0…1. */
const kOf = (z: ZoneX) => {
  const s = z as Strike;
  if ('warn' in s && typeof s.warn === 'number' && s.warn > 0) return Math.min(1, s.t / s.warn);
  return 1;
};

function cone(g: CanvasRenderingContext2D, x: number, y: number, r: number, a: number, arc: number): void {
  g.beginPath();
  g.moveTo(x, y);
  g.arc(x, y, r, a - arc / 2, a + arc / 2);
  g.closePath();
}

const BLOOD_RED = hx('#e0202a');
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
function bolt(g: CanvasRenderingContext2D, x: number, y: number, h: number, seed: number, a: number): void {
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
    g.fillRect(Math.round((i * 6 + time * 40) % L), Math.round((hash(i, Math.floor(time * 12)) - 0.5) * w * 1.6), 2, 1);
  g.restore();
  if (k > 0.85) {
    const ux = Math.cos(zz.ang ?? 0);
    const uy = Math.sin(zz.ang ?? 0);
    for (let i = 0; i < 3; i++) {
      const t = (i + 0.5) / 3;
      bolt(g, px + ux * L * t, py + uy * L * t, 80, zz.id * 3 + i + Math.floor(time * 30), (k - 0.85) / 0.15);
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
  g.arc(px, py, R + (time * 10) % 2, 0, TAU);
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
    g.fillRect(Math.round(px + Math.cos(a) * z.r * S * 0.6), Math.round(py + Math.sin(a) * z.r * S * 0.4), 1, 1);
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
  for (let i = 0; i < 4; i++) g.fillRect(Math.round(px - 6 + i * 4), Math.round(py - 6 + (1 - k) * 8), 1, 2);
  g.strokeStyle = rgba(hx('#7a7684'), 1 - k);
  g.lineWidth = 1;
  g.strokeRect(Math.round(px - z.r * S), Math.round(py - z.r * S), Math.round(z.r * S * 2), Math.round(z.r * S * 2));
  return true;
});

registerZonePainter('f10_barsfall', (g, z, px, py, S) => {
  const zz = z as Zone;
  const k = Math.min(1, zz.t / zz.life);
  // Решётка рушится сверху: пыль у основания.
  g.fillStyle = rgba(hx('#7a6a5a'), 0.8 * (1 - k));
  for (let i = 0; i < 5; i++) g.fillRect(Math.round(px - 7 + i * 3), Math.round(py + 4 + k * 3), 2, 1);
  void S;
  return true;
});

registerZonePainter('f10_command', (g, z, px, py, S, time) => {
  const zz = z as Zone;
  const k = Math.min(1, zz.t / 0.6);
  const R = z.r * S;
  // Зов трона: красный круг с рогатой короной на помосте — король открыт.
  g.strokeStyle = rgba(BLOOD_RED, 0.5 + 0.4 * Math.sin(time * 10) * 0.5);
  g.lineWidth = 1;
  g.beginPath();
  g.arc(px, py, R * k, 0, TAU);
  g.stroke();
  g.beginPath();
  g.arc(px, py, R * k * 0.7, 0, TAU);
  g.stroke();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + time * 1.5;
    g.fillStyle = rgba(GOLD[3], 0.9);
    g.fillRect(Math.round(px + Math.cos(a) * R * k * 0.85), Math.round(py + Math.sin(a) * R * k * 0.85 * 0.6), 2, 1);
  }
  return true;
});

registerZonePainter('f10_slash', (g, z, px, py, S) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const R = zz.r * S;
  const a = zz.ang ?? 0;
  const arc = zz.arc ?? 2.4;
  cone(g, px, py, R, a, arc);
  g.fillStyle = rgba(BLOOD_RED, 0.14 + 0.3 * k);
  g.fill();
  // Кровавая дуга меча: чем ближе удар, тем ярче кромка.
  g.strokeStyle = rgba(hx('#ff5a3a'), 0.4 + 0.6 * k);
  g.lineWidth = 2;
  g.beginPath();
  g.arc(px, py, R - 1, a - arc / 2, a + arc / 2);
  g.stroke();
  g.lineWidth = 1;
  g.strokeStyle = rgba(WHITE, 0.3 + 0.7 * k);
  g.beginPath();
  g.arc(px, py, R * (0.4 + 0.6 * k), a - arc / 2, a + arc / 2);
  g.stroke();
  return true;
});

registerZonePainter('f10_cleave', (g, z, px, py, S) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const L = zz.r * S;
  const w = (zz.w ?? 0.75) * S;
  g.save();
  g.translate(px, py);
  g.rotate(zz.ang ?? 0);
  g.fillStyle = rgba(BLOOD_RED, 0.14 + 0.32 * k);
  g.fillRect(0, -w, L, w * 2);
  g.fillStyle = rgba(hx('#ff5a3a'), 0.6 + 0.4 * k);
  g.fillRect(0, -1, Math.round(L * k), 2);
  g.fillStyle = rgba(WHITE, 0.3 + 0.5 * k);
  g.fillRect(0, -w, L, 1);
  g.fillRect(0, w - 1, L, 1);
  g.restore();
  return true;
});

registerZonePainter('f10_rift', (g, z, px, py, S, time) => {
  const zz = z as ZoneX;
  const fade = Math.min(1, ((zz as Zone).life - (zz as Zone).t) / 0.8);
  const a = zz.ang ?? 0;
  const L = (zz.len ?? 4) * S;
  // Трещина от меча в плитах, в ней тлеет.
  g.strokeStyle = rgba(hx('#0a0204'), 0.9 * fade);
  g.lineWidth = 2;
  g.beginPath();
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const j = (hash(i, zz.id) - 0.5) * 3;
    const x = px + Math.cos(a) * L * t - Math.sin(a) * j;
    const y = py + Math.sin(a) * L * t + Math.cos(a) * j;
    if (i) g.lineTo(x, y);
    else g.moveTo(x, y);
  }
  g.stroke();
  g.lineWidth = 1;
  g.strokeStyle = rgba(hx('#ff5a1a'), (0.5 + 0.3 * Math.sin(time * 12)) * fade);
  g.stroke();
  return true;
});

registerZonePainter('f10_shock', (g, z, px, py, S) => {
  const k = kOf(z as ZoneX);
  const R = z.r * S;
  g.fillStyle = rgba(BLOOD_RED, 0.1 + 0.2 * k);
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.fill();
  g.strokeStyle = rgba(hx('#ffb080'), 0.4 + 0.6 * k);
  g.lineWidth = 1;
  for (const f of [1, 0.66, 0.33]) {
    g.beginPath();
    g.arc(px, py, R * f * (0.5 + 0.5 * k), 0, TAU);
    g.stroke();
  }
  return true;
});

registerZonePainter('f10_shockring', (g, z, px, py, S) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const R = zz.r * S;
  const w = (zz.w ?? 0.5) * S;
  g.strokeStyle = rgba(hx('#ff7a4a'), 0.2 + 0.3 * k);
  g.lineWidth = w * 2;
  g.beginPath();
  g.arc(px, py, R * (0.4 + 0.6 * k), 0, TAU);
  g.stroke();
  g.strokeStyle = rgba(WHITE, 0.6 + 0.4 * k);
  g.lineWidth = 1;
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.stroke();
  return true;
});

registerZonePainter('f10_divemark', (g, z, px, py, S, time) => {
  const zz = z as ZoneX;
  const R = zz.r * S;
  const locked = !zz.follow;
  // Метка пике: тень крыльев над героем; замерла — налилась красным.
  g.fillStyle = rgba(hx('#000000'), locked ? 0.45 : 0.25);
  g.beginPath();
  g.ellipse(px, py, R, R * 0.55, 0, 0, TAU);
  g.fill();
  g.strokeStyle = rgba(locked ? BLOOD_RED : hx('#ffb080'), locked ? 1 : 0.7);
  g.lineWidth = 1;
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.stroke();
  // Перекрестье — «сюда».
  const s = locked ? 1 : 0.5 + 0.5 * Math.sin(time * 8);
  g.fillStyle = rgba(WHITE, s);
  g.fillRect(Math.round(px - R), Math.round(py), Math.round(R * 2), 1);
  g.fillRect(Math.round(px), Math.round(py - R * 0.6), 1, Math.round(R * 1.2));
  return true;
});

registerZonePainter('f10_diveland', (g, z, px, py, S) => {
  const k = kOf(z as ZoneX);
  const R = z.r * S;
  g.fillStyle = rgba(BLOOD_RED, 0.2 + 0.35 * k);
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.fill();
  g.strokeStyle = rgba(WHITE, 0.5 + 0.5 * k);
  g.lineWidth = 1;
  g.beginPath();
  g.arc(px, py, R * (1 - k * 0.5), 0, TAU);
  g.stroke();
  return true;
});

registerZonePainter('f10_feather', (g, z, px, py, S, time) => {
  const k = kOf(z as ZoneX);
  const R = z.r * S;
  // Перо пламени падает: метка и само перо над ней.
  g.strokeStyle = rgba(hx('#ff7a2a'), 0.5 + 0.5 * k);
  g.lineWidth = 1;
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.stroke();
  const fy = py - (1 - k) * 40;
  g.fillStyle = rgba(FIRE[2], 1);
  g.fillRect(Math.round(px + Math.sin(time * 9) * 2), Math.round(fy) - 3, 2, 4);
  g.fillStyle = rgba(FIRE[3], 1);
  g.fillRect(Math.round(px + Math.sin(time * 9) * 2), Math.round(fy) - 3, 1, 2);
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

registerZonePainter('f10_redglow', (g, z, px, py, S, time) => {
  // Отсвет жаровен по полу тронного зала (картинка, без действия).
  const R = z.r * S;
  const a = 0.07 + 0.02 * Math.sin(time * 2);
  const grd = g.createRadialGradient(px, py, R * 0.2, px, py, R);
  grd.addColorStop(0, `rgba(160,20,24,${a.toFixed(3)})`);
  grd.addColorStop(1, 'rgba(160,20,24,0)');
  g.fillStyle = grd;
  g.fillRect(px - R, py - R, R * 2, R * 2);
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
  for (const dx of [-6, -3, 0, 3, 6]) g.fillRect(Math.round(px + dx), Math.round(py - (dx === 0 ? 4 : 2)), 1, 2);
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
    for (let x = 0; x < 10; x++) if (Math.hypot(x + 0.5 - 5, y + 0.5 - 5.5) < 2.2) p.data[(y * 10 + x) * 4 + 3] = 0;
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
