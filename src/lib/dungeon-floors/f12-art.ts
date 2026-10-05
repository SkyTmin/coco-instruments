// Этаж 12 «Проклятая станция» — рисовальщики: клетки трёх районов (плитка,
// гранит, рельсы, эскалаторы, тоннели, святилище), реквизит станции и
// храма, монстры, поезд, Двуликий король, метки ударов, иконки вещей.
//
// Всё нарисовано кодом (чужих картинок нет): пиксели 16 на клетку, свет
// сверху-слева, контур тёмный, палитра — ступени камня подземелья и два
// акцента этажа: неоновая бирюза станции и проклятый пурпур/кармин.
// Районам дан `paintAll`: пол и лица стен станции — свои целиком, чтобы
// под буквами движка не оставалось чужих плит.
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
import type { WorldObj } from '../dungeon-world';
import { F12_HALL, F12_MARK, F12_PLAT, F12_SHRINE } from './f12';
import { CAR_LEN, F12_FX, KING, f12King } from './f12-brains';
import type { EscView, GridView, TerrView, TrackView } from './f12-brains';

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
const shade = (c: RGBA, k: number): RGBA => [
  Math.max(0, Math.min(255, Math.round(c[0] * k))),
  Math.max(0, Math.min(255, Math.round(c[1] * k))),
  Math.max(0, Math.min(255, Math.round(c[2] * k))),
  c[3],
];

const INK = hx('#150f0b');
export const WHITE = hx('#ffffff');
const GOLDK = hx('#ffcc40');
export const TAU = Math.PI * 2;
const MK = F12_MARK;

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

/** Многоугольник со светом по нормали грани. */
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
export function stroke(p: Px, x0: number, y0: number, x1: number, y1: number, c: RGBA, w = 1): void {
  const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2) + 1;
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    const y = y0 + ((y1 - y0) * i) / n;
    if (w <= 1) p.set(Math.floor(x), Math.floor(y), c);
    else p.ell(x, y, w / 2, w / 2, c);
  }
}

/** Детерминированный шум по числам, 0…1. */
const hash = (a: number, b: number, c = 0) => {
  let h = (a * 374761393 + b * 668265263 + c * 1274126177) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** Сглаженный шум по клеткам мира (стыки без шва). */
function vnoise(x: number, y: number, s: number, seed: number): number {
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

/** Огонь: язык пламени снизу вверх, кадр f меняет рисунок. */
function flame(p: Px, cx: number, by: number, w: number, h: number, f: number, pal: RGBA[], seed = 0): void {
  for (let y = 0; y < h; y++) {
    const k = y / h;
    const half = w * 0.5 * (1 - k * k) * (0.85 + 0.3 * hash(y, f, seed));
    const sway = Math.sin(k * 3 + f * 1.3 + seed) * k * 1.2;
    for (let x = -Math.ceil(half); x <= Math.ceil(half); x++) {
      const e = Math.abs(x) / (half + 0.01);
      if (e > 1) continue;
      const hot = 1 - Math.max(e, k * 0.9);
      const c = hot > 0.62 ? pal[3] : hot > 0.38 ? pal[2] : hot > 0.15 ? pal[1] : pal[0];
      p.set(Math.round(cx + x + sway), by - y, c);
    }
  }
  if (hash(f, seed, 3) > 0.4) p.set(Math.round(cx + (hash(f, seed) - 0.5) * w), by - h - 1, pal[2]);
}

const FIRE = [hx('#8a1a06'), hx('#e05010'), hx('#ffa030'), hx('#fff0a0')];
const VFIRE = [hx('#3a0a4a'), hx('#8a2ab0'), hx('#d070ff'), hx('#fff0ff')];
const GFIRE = [hx('#0a3a2a'), hx('#1a8a5a'), hx('#6affb0'), hx('#e8fff0')];

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

/** Наложить `src` на `dst` с учётом прозрачности. */
function over(dst: Px, src: Px, ox = 0, oy = 0): void {
  for (let y = 0; y < src.h; y++)
    for (let x = 0; x < src.w; x++) {
      const i = (y * src.w + x) * 4;
      const a = src.data[i + 3];
      if (!a) continue;
      dst.set(x + ox, y + oy, [src.data[i], src.data[i + 1], src.data[i + 2], a]);
    }
}

/** Прозрачность всего холста ×k (призрак). */
function fade(p: Px, k: number): Px {
  const o = new Px(p.w, p.h);
  o.data.set(p.data);
  for (let i = 3; i < o.data.length; i += 4) o.data[i] = Math.round(o.data[i] * k);
  return o;
}

/** Стереть пиксель (set с прозрачным ничего не меняет). */
function clr(p: Px, x: number, y: number): void {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || y < 0 || x >= p.w || y >= p.h) return;
  p.data[(y * p.w + x) * 4 + 3] = 0;
}

/** Мини-шрифт 3×5 (кириллица и цифры) — надписи станции. */
const FONT: Record<string, string[]> = {
  П: ['###', '#.#', '#.#', '#.#', '#.#'],
  Р: ['##.', '#.#', '##.', '#..', '#..'],
  О: ['.#.', '#.#', '#.#', '#.#', '.#.'],
  К: ['#.#', '#.#', '##.', '#.#', '#.#'],
  Л: ['.##', '#.#', '#.#', '#.#', '#.#'],
  Я: ['.##', '#.#', '.##', '#.#', '#.#'],
  Т: ['###', '.#.', '.#.', '.#.', '.#.'],
  А: ['.#.', '#.#', '###', '#.#', '#.#'],
  С: ['.##', '#..', '#..', '#..', '.##'],
  Е: ['###', '#..', '##.', '#..', '###'],
  В: ['##.', '#.#', '##.', '#.#', '##.'],
  Х: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  Д: ['.#.', '#.#', '#.#', '###', '#.#'],
  М: ['#.#', '###', '#.#', '#.#', '#.#'],
  Н: ['#.#', '#.#', '###', '#.#', '#.#'],
  Ы: ['#.#', '#.#', '###', '#.#', '###'],
  Ж: ['#.#', '###', '.#.', '###', '#.#'],
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['##.', '..#', '.#.', '#..', '###'],
  '3': ['##.', '..#', '.#.', '..#', '##.'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '##.', '..#', '##.'],
  '7': ['###', '..#', '.#.', '.#.', '.#.'],
  '9': ['###', '#.#', '###', '..#', '##.'],
  ' ': ['...', '...', '...', '...', '...'],
  '→': ['...', '.#.', '###', '.#.', '...'],
};

function text(p: Px, s: string, x: number, y: number, c: RGBA): number {
  let cx = x;
  for (const ch of s) {
    const g = FONT[ch] ?? FONT[' '];
    for (let r = 0; r < 5; r++) for (let k = 0; k < 3; k++) if (g[r][k] === '#') p.set(cx + k, y + r, c);
    cx += 4;
  }
  return cx;
}

// ---------------------------------------------------------------------------
// Кеш кадров монстров.
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

function frameOf(kind: string, pose: MobPose, anim: string, f: number, build: () => Built, left = pose.left): MobFrame {
  const key = `${kind}|${anim}|${f}|${left ? 1 : 0}|${pose.flash ? 1 : 0}|${pose.look}`;
  const hit = frames.get(key);
  if (hit) return hit;
  return finish(key, build(), pose.look, pose.flash, left);
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

/** Смерть проклятия: тело оседает чёрным пеплом с тлеющими искрами. */
function ashen(p: Px, k: number, seed: number, ember = hx('#ff3a6a')): Px {
  if (k <= 0) return p;
  const o = new Px(p.w, p.h);
  const ash = hx('#1a1018');
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      const i = (y * p.w + x) * 4;
      if (!p.data[i + 3]) continue;
      const r = hash(x, y, seed);
      if (r < k * 0.26) continue;
      const ty = Math.min(p.h - 1, y + Math.floor(k * k * 2 * r));
      const j = (ty * p.w + x) * 4;
      const c: RGBA = r < k * 0.33 ? ember : r < k * 0.55 ? ash : [p.data[i], p.data[i + 1], p.data[i + 2], 255];
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
// Палитры станции и храма.
// ---------------------------------------------------------------------------

/** Гранит пола: светлые плиты с серо-зелёной тенью. */
const GRANITE = [hx('#3e4541'), hx('#555d57'), hx('#6c756d'), hx('#838c82'), hx('#98a095')];
const GROUT = hx('#2c312e');
const CONC = [hx('#30332f'), hx('#3d403c'), hx('#4b4e49'), hx('#595c56')];
const YELLOW = [hx('#6a5210'), hx('#9a7a18'), hx('#c8a024'), hx('#e8cc4a')];
const BALLAST = [hx('#1e1c1a'), hx('#2a2724'), hx('#36322e'), hx('#443f39'), hx('#534d45')];
const SLEEPER = [hx('#1c130e'), hx('#2a1c14'), hx('#3a281c'), hx('#4c3626')];
const RAIL = { side: hx('#2a2e32'), top: hx('#7c868e'), shine: hx('#c4ccd2'), rust: hx('#5a3a26') };
const STEEL = [hx('#23272b'), hx('#363b41'), hx('#4e555c'), hx('#6e767e'), hx('#9aa3aa')];
const CERAMIC = [hx('#57574b'), hx('#76735f'), hx('#918c75'), hx('#aaa48a'), hx('#c2bb9e')];
const TUNNEL = [hx('#1b1d1f'), hx('#26292b'), hx('#323538'), hx('#3f4246'), hx('#4d5155')];
const SHRINE = [hx('#1c141e'), hx('#271c2b'), hx('#33263a'), hx('#403049'), hx('#50405a')];
const LACQUER = [hx('#2a080c'), hx('#4e1016'), hx('#781a1e'), hx('#a52a26'), hx('#d04a36')];
const GOLD = [hx('#5e4210'), hx('#8a6a1a'), hx('#c09a30'), hx('#f0d060')];
export const PAPER = [hx('#8a8068'), hx('#b3aa8c'), hx('#d2c9aa'), hx('#ece4c6')];
const CURSE = [hx('#2a0e30'), hx('#55206a'), hx('#8e3aa8'), hx('#d27aff')];
const BLOODC = [hx('#2a0408'), hx('#4a0a12'), hx('#7a1420'), hx('#b02030')];
const NEON = { teal: hx('#5affe0'), tealD: hx('#1a8a7a'), pink: hx('#ff5ab0'), pinkD: hx('#8a2060') };
const BONE = [hx('#6a6050'), hx('#9a8e76'), hx('#c4b89a'), hx('#e8dec0')];

// ---------------------------------------------------------------------------
// Клетки. Кусок карты собирается один раз: всё здесь — из кеша по ключу.
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

/** Тень у стен: сверху — от стены, сбоку — узкая. */
function wallShade(p: Px, n: boolean, w: boolean, e: boolean): void {
  if (n)
    for (let x = 0; x < 16; x++) {
      p.set(x, 0, [0, 0, 0, 120]);
      p.set(x, 1, [0, 0, 0, 80]);
      p.set(x, 2, [0, 0, 0, 40]);
    }
  if (w)
    for (let y = 0; y < 16; y++) {
      p.set(0, y, [0, 0, 0, 90]);
      p.set(1, y, [0, 0, 0, 40]);
    }
  if (e) for (let y = 0; y < 16; y++) p.set(15, y, [0, 0, 0, 60]);
}

/** Край тонкой стены снизу — её верх ложится на пол (как у движка). */
function rimBelow(p: Px): void {
  for (let x = 0; x < 16; x++) {
    p.set(x, 13, hx('#15171a'));
    p.set(x, 14, hx('#23262a'));
    p.set(x, 15, hx('#30343a'));
  }
}

const edgesOf = (c: CellCtx) => ({
  n: !c.open(0, -1),
  w: !c.open(-1, 0),
  e: !c.open(1, 0),
  rim: !c.open(0, 1) && c.open(0, 2),
});

/** Гранитная плита: две плиты 16×8 со сдвигом, прожилки, выщербины. */
/**
 * Пол станции: большие полированные плиты гранита 2×2 клетки, серые и
 * розоватые в шахматку (как в старом метро), тонкий шов только по краю
 * плиты, зерно камня мелкое и тихое, мягкий блик по диагонали плиты.
 * `ix`, `iy` — клетка внутри плиты (0/1), `tone` — какой камень.
 */
const GRAN_T: [number, number, number][] = [
  [104, 110, 106],
  [112, 100, 96],
];
function graniteCell(ix: number, iy: number, v: number, tone = 0): Px {
  const p = new Px(16, 16);
  const [r0, g0, b0] = GRAN_T[tone & 1];
  const vk = 1 + ((v % 7) - 3) * 0.012;
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const lx = ix * 16 + x;
      const ly = iy * 16 + y;
      // Блик: свет сверху-слева, к дальнему углу плиты тише.
      const sheen = 1.07 - ((lx + ly) / 62) * 0.14;
      const n = hash(lx + tone * 40, ly + v * 7, 11);
      let k = vk * sheen * (0.95 + n * 0.08);
      if (n > 0.965) k *= 1.16;
      else if (n < 0.04) k *= 0.8;
      let c: RGBA = [Math.min(255, r0 * k), Math.min(255, g0 * k), Math.min(255, b0 * k), 255];
      // Шов по краю плиты и светлая фаска под ним.
      if (lx === 0 || ly === 0) c = GROUT;
      else if (lx === 1 || ly === 1) c = mixc(c, WHITE, 0.12);
      else if (lx === 31 || ly === 31) c = mixc(c, INK, 0.18);
      p.set(x, y, c);
    }
  if (v % 5 === 0) {
    // Скол на углу плиты.
    const x0 = 3 + (v % 7);
    p.set(x0, 3, mixc(GROUT, WHITE, 0.2));
    p.set(x0 + 1, 3, GRANITE[1]);
    p.set(x0, 4, GRANITE[1]);
  }
  return p;
}

/** Бетон служебных ходов. */
function concreteCell(wx: number, wy: number): Px {
  const p = new Px(16, 16);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const n = tnoise((wx & 3) * 16 + x, (wy & 3) * 16 + y, 8, 64, 21) * 0.7 + hash(wx * 16 + x, wy * 16 + y, 3) * 0.3;
      p.set(x, y, CONC[n > 0.72 ? 3 : n > 0.48 ? 2 : n > 0.26 ? 1 : 0]);
    }
  // Шов заливки раз в две клетки.
  if (wx % 2 === 0) for (let y = 0; y < 16; y++) p.set(0, y, mixc(CONC[0], INK, 0.3));
  if (wy % 2 === 0) for (let x = 0; x < 16; x++) p.set(x, 0, mixc(CONC[0], INK, 0.3));
  return p;
}

/**
 * Мозаика вестибюля: тёмно-вишнёвое поле, на каждой плите 2×2 клетки —
 * восьмилучевая звезда охрой в тонком кремовом круге, по углам — сланцевые
 * четверти. Смальта сеткой 4 px — видно, что набрано, но без шахматки.
 */
function mosaicCell(c: CellCtx): Px {
  const edge = (dx: number, dy: number) => c.markAt(dx, dy) !== MK.mosaic;
  const n = edge(0, -1);
  const s = edge(0, 1);
  const w = edge(-1, 0);
  const e = edge(1, 0);
  const key = `mos|${c.wx & 1}|${c.wy & 1}|${n ? 1 : 0}${s ? 1 : 0}${w ? 1 : 0}${e ? 1 : 0}`;
  return cellOf(key, () => {
    const p = new Px(16, 16);
    const field = [hx('#301a1d'), hx('#3a2024'), hx('#44282b')];
    const ochre = [hx('#6e5226'), hx('#8c6c38'), hx('#a8864c')];
    const slate = [hx('#2a3a3c'), hx('#3a4e50'), hx('#4a6062')];
    const cream = hx('#d8ccb0');
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const lx = (c.wx & 1) * 16 + x;
        const ly = (c.wy & 1) * 16 + y;
        const dx = lx + 0.5 - 16;
        const dy = ly + 0.5 - 16;
        const r = Math.hypot(dx, dy);
        const a = Math.atan2(dy, dx);
        const nn = hash(lx >> 1, ly >> 1, 5);
        const t = nn > 0.8 ? 2 : nn < 0.2 ? 0 : 1;
        let col = field[t];
        const star = 6.2 + 3 * Math.max(Math.cos(a * 4), Math.cos(a * 4 + Math.PI) * 0.5);
        const corner = Math.min(
          Math.hypot(lx + 0.5, ly + 0.5),
          Math.hypot(32 - lx - 0.5, ly + 0.5),
          Math.hypot(lx + 0.5, 32 - ly - 0.5),
          Math.hypot(32 - lx - 0.5, 32 - ly - 0.5),
        );
        if (r < 2.6) col = hx('#7a1c24');
        else if (r < star) col = ochre[t];
        else if (Math.abs(r - 13.2) < 0.6) col = cream;
        else if (corner < 6.5) col = corner > 5.5 ? cream : slate[t];
        // Швы смальты.
        if (lx % 4 === 0 || ly % 4 === 0) col = mixc(col, INK, 0.22);
        p.set(x, y, col);
      }
    // Латунная кайма по краю мозаики.
    const brass = hx('#a88438');
    const brassD = hx('#5a4420');
    for (let i = 0; i < 16; i++) {
      if (n) {
        p.set(i, 0, brassD);
        p.set(i, 1, brass);
      }
      if (s) {
        p.set(i, 15, brassD);
        p.set(i, 14, brass);
      }
      if (w) {
        p.set(0, i, brassD);
        p.set(1, i, brass);
      }
      if (e) {
        p.set(15, i, brassD);
        p.set(14, i, brass);
      }
    }
    return p;
  });
}

/** Тактильная полоса у края платформы: жёлтые рифы; край — обрыв к путям. */
function edgeCell(c: CellCtx): Px {
  const southRail = c.markAt(0, 1) === MK.railN || c.markAt(0, 1) === MK.crossN || c.markAt(0, 1) === MK.tunnelN;
  const northRail = c.markAt(0, -1) === MK.railS || c.markAt(0, -1) === MK.crossS || c.markAt(0, -1) === MK.tunnelS;
  const key = `edge|${southRail ? 1 : 0}${northRail ? 1 : 0}|${c.wx & 1}`;
  return cellOf(key, () => {
    const p = graniteCell(c.wx & 1, 3, 1);
    // Бетонный борт платформы.
    const lipY = southRail ? 12 : 2;
    for (let x = 0; x < 16; x++) {
      for (let y = 0; y < 16; y++) {
        const inStrip = southRail ? y >= 4 && y <= 10 : y >= 5 && y <= 11;
        if (!inStrip) continue;
        const bump = (x % 3 === 1 && y % 3 === (southRail ? 2 : 0)) as boolean;
        p.set(x, y, bump ? YELLOW[3] : (x + y) % 7 === 0 ? YELLOW[1] : YELLOW[2]);
      }
      if (southRail) {
        // Край платформы и её лицевой борт вниз, к путям.
        p.set(x, lipY - 1, hx('#b8bcb2'));
        p.set(x, lipY, hx('#8a8e86'));
        p.set(x, lipY + 1, hx('#4a4d49'));
        p.set(x, lipY + 2, hx('#303230'));
        p.set(x, 15, hx('#1a1b1a'));
      } else {
        p.set(x, 0, hx('#1a1b1a'));
        p.set(x, 1, hx('#6a6e66'));
        p.set(x, lipY, hx('#b8bcb2'));
      }
    }
    return p;
  });
}

/** Путь: щебень, шпалы, рельсы (и контактный рельс под кожухом). */
function railCell(c: CellCtx, north: boolean, cross: boolean, tunnel: boolean): Px {
  const key = `rail|${north ? 1 : 0}|${cross ? 1 : 0}|${tunnel ? 1 : 0}|${c.wx % 7}|${c.wy & 1}`;
  return cellOf(key, () => {
    const p = new Px(16, 16);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const n = hash(c.wx * 16 + x, c.wy * 16 + y, 17);
        const k = n > 0.8 ? 4 : n > 0.55 ? 3 : n > 0.3 ? 2 : n > 0.12 ? 1 : 0;
        p.set(x, y, BALLAST[k]);
      }
    // Шпалы — поперёк обоих рядов.
    for (let x = 0; x < 16; x++) {
      const gx = (c.wx * 16 + x) % 7;
      if (gx > 3) continue;
      const y0 = north ? 3 : 0;
      const y1 = north ? 15 : 12;
      for (let y = y0; y <= y1; y++) p.set(x, y, SLEEPER[gx === 0 ? 3 : gx === 3 ? 0 : 1 + ((y + x) % 2)]);
    }
    if (cross) {
      // Настил переезда: доски вдоль.
      for (let y = north ? 2 : 0; y < (north ? 16 : 14); y++)
        for (let x = 0; x < 16; x++) {
          const b = Math.floor(y / 3);
          const c2 = y % 3 === 2 ? SLEEPER[0] : SLEEPER[2 + ((b + x + c.wx) % 7 === 0 ? 1 : 0)];
          p.set(x, y, c2);
        }
    }
    // Рельс: тёмный бок, светлая головка, блик.
    const ry = north ? 6 : 9;
    for (let x = 0; x < 16; x++) {
      p.set(x, ry - 1, RAIL.top);
      p.set(x, ry, (c.wx * 16 + x) % 14 === 0 ? RAIL.shine : RAIL.top);
      p.set(x, ry + 1, RAIL.side);
      p.set(x, ry + 2, alpha(INK, 0.6));
      if (hash(c.wx * 16 + x, ry, 4) > 0.9) p.set(x, ry + 1, RAIL.rust);
    }
    if (north && !cross) {
      // Контактный рельс под жёлтым кожухом — у северного края.
      for (let x = 0; x < 16; x++) {
        p.set(x, 0, hx('#4a3a12'));
        p.set(x, 1, hx('#8a7020'));
        p.set(x, 2, hx('#2a2010'));
        if ((c.wx * 16 + x) % 14 === 0) p.set(x, 3, hx('#6a6060'));
      }
    }
    if (tunnel) for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, [0, 0, 0, 30]);
    return p;
  });
}

/** Тоннель в темноту: рельсы уходят во тьму. */
function tunnelDeepCell(c: CellCtx, north: boolean): Px {
  const key = `tdeep|${north ? 1 : 0}|${c.wx % 7}`;
  return cellOf(key, () => {
    const p = railCell({ ...c, markAt: () => 0 } as CellCtx, north, false, false);
    const q = new Px(16, 16);
    q.data.set(p.data);
    for (let i = 0; i < q.data.length; i += 4) {
      q.data[i] = Math.round(q.data[i] * 0.28);
      q.data[i + 1] = Math.round(q.data[i + 1] * 0.3);
      q.data[i + 2] = Math.round(q.data[i + 2] * 0.34);
    }
    return q;
  });
}

/** Щебень у рельсов в тоннеле (обочина). */
function ballastCell(c: CellCtx): Px {
  const e = edgesOf(c);
  const key = `bal|${c.wx % 3}|${c.wy % 2}|${e.n ? 1 : 0}${e.rim ? 1 : 0}`;
  return cellOf(key, () => {
    const p = new Px(16, 16);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const n = hash(c.wx * 16 + x, c.wy * 16 + y, 29);
        const k = n > 0.85 ? 4 : n > 0.6 ? 3 : n > 0.35 ? 2 : n > 0.15 ? 1 : 0;
        p.set(x, y, BALLAST[k]);
      }
    // Кабельный лоток вдоль стены.
    if (e.n)
      for (let x = 0; x < 16; x++) {
        p.set(x, 2, hx('#101214'));
        p.set(x, 3, hx('#20262a'));
      }
    wallShade(p, e.n, false, false);
    if (e.rim) rimBelow(p);
    return p;
  });
}

/** Ниша в стене тоннеля: бетон, жёлто-чёрный край, лампа. */
function nicheCell(c: CellCtx): Px {
  const w = !c.open(-1, 0) || c.markAt(-1, 0) !== MK.niche;
  const key = `niche|${w ? 1 : 0}|${c.markAt(1, 0) === MK.niche ? 1 : 0}`;
  return cellOf(key, () => {
    const p = concreteCell(3, 5);
    for (let x = 0; x < 16; x++) {
      const stripe = Math.floor((x + 13) / 3) % 2 === 0;
      p.set(x, 15, stripe ? YELLOW[3] : INK);
      p.set(x, 14, stripe ? YELLOW[2] : hx('#202020'));
    }
    wallShade(p, true, w, c.markAt(1, 0) !== MK.niche);
    // Белая стрелка «укрытие».
    p.set(7, 7, hx('#e8e8d8'));
    p.set(8, 7, hx('#e8e8d8'));
    p.set(7, 8, hx('#e8e8d8'));
    p.set(8, 8, hx('#e8e8d8'));
    return p;
  });
}

/** Эскалатор: ступени с рифлением, боковые щиты; гребёнка на краю. */
function escCell(c: CellCtx, kind: number): Px {
  const wl = c.markAt(-1, 0) !== kind;
  const wr = c.markAt(1, 0) !== kind;
  const key = `esc|${kind}|${wl ? 1 : 0}${wr ? 1 : 0}|${c.wy % 2}`;
  return cellOf(key, () => {
    const p = new Px(16, 16);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const ly = (c.wy * 16 + y) % 8;
        let col = ly === 0 ? STEEL[0] : ly === 1 ? STEEL[4] : ly < 4 ? STEEL[3] : STEEL[2];
        if (x % 2 === 0 && ly > 1) col = shade(col, 0.82);
        p.set(x, y, col);
      }
    // Жёлтая кромка ступени.
    for (let x = 0; x < 16; x++) for (const y of [1, 9]) p.set(x, (y + (c.wy % 2) * 0) % 16, YELLOW[kind === MK.esc0 ? 1 : 2]);
    // Щиты балюстрады.
    if (wl) for (let y = 0; y < 16; y++) {
      p.set(0, y, hx('#1a1c1e'));
      p.set(1, y, hx('#8a9098'));
    }
    if (wr) for (let y = 0; y < 16; y++) {
      p.set(15, y, hx('#1a1c1e'));
      p.set(14, y, hx('#5a6068'));
    }
    if (kind === MK.esc0)
      // Стоит: пыль и мусор на ступенях.
      for (let i = 0; i < 5; i++) p.set(2 + Math.floor(hash(c.wx, c.wy, i) * 12), Math.floor(hash(c.wy, c.wx, i) * 16), alpha(hx('#2a2622'), 0.8));
    return p;
  });
}

/** Гребёнка эскалатора: латунная пластина с зубцами. */
function combCell(c: CellCtx): Px {
  const up = c.markAt(0, 1) === MK.escN || c.markAt(0, 1) === MK.escS || c.markAt(0, 1) === MK.esc0;
  return cellOf(`comb|${up ? 1 : 0}|${c.wx & 1}`, () => {
    const p = graniteCell(c.wx & 1, 2, 3);
    const y0 = up ? 6 : 0;
    for (let y = y0; y < y0 + 10; y++)
      for (let x = 0; x < 16; x++) {
        const t = up ? y - y0 : y0 + 9 - y;
        let col = t < 2 ? hx('#5a4a20') : hx('#b89a3a');
        if ((x % 2 === 0 && t > 6) || (x + y) % 5 === 0) col = hx('#d8ba4a');
        if (t > 7 && x % 2 === 1) col = STEEL[1];
        p.set(x, y, col);
      }
    return p;
  });
}

/** Жёлто-чёрная штриховка — «не заходить». */
function hatchCell(c: CellCtx): Px {
  return cellOf(`hatch|${c.wx % 2}`, () => {
    const p = concreteCell(c.wx % 2, 1);
    for (let y = 2; y < 14; y++)
      for (let x = 2; x < 14; x++) p.set(x, y, Math.floor((x + y + c.wx * 16) / 3) % 2 === 0 ? YELLOW[2] : hx('#1a1a18'));
    return p;
  });
}

/** Решётка стока. */
function grateCell(c: CellCtx): Px {
  return cellOf(`grate|${c.wx & 1}`, () => {
    const p = graniteCell(c.wx & 1, c.wy & 1, 2);
    for (let y = 4; y < 12; y++)
      for (let x = 4; x < 12; x++) p.set(x, y, (x % 2 === 0 ? STEEL[1] : hx('#08090a')));
    for (let x = 3; x < 13; x++) {
      p.set(x, 3, STEEL[3]);
      p.set(x, 12, STEEL[0]);
    }
    return p;
  });
}

/** Пятно поверх пола: кровь, копоть, течь, трещины. */
function stainOver(base: Px, kind: number, wx: number, wy: number): Px {
  const p = new Px(16, 16);
  p.data.set(base.data);
  const cx = 5 + hash(wx, wy, 1) * 6;
  const cy = 5 + hash(wx, wy, 2) * 6;
  if (kind === MK.blood) {
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const d = Math.hypot(x - cx, (y - cy) * 1.3) / 5 + (hash(x, y, wx + wy) - 0.5) * 0.5;
        if (d < 1) p.set(x, y, d < 0.45 ? BLOODC[2] : d < 0.75 ? BLOODC[1] : alpha(BLOODC[0], 0.8));
      }
    // Брызги и отпечаток ладони проклятия.
    for (let i = 0; i < 5; i++) p.set(Math.floor(hash(wx, i, 7) * 16), Math.floor(hash(wy, i, 8) * 16), BLOODC[1]);
    p.set(Math.round(cx) + 3, Math.round(cy) - 3, CURSE[2]);
  } else if (kind === MK.soot) {
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const d = Math.hypot(x - cx, y - cy) / 7 + (hash(x, y, 9) - 0.5) * 0.4;
        if (d < 1) p.set(x, y, [10, 10, 12, Math.round((1 - d) * 190)]);
      }
  } else if (kind === MK.wet) {
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const d = Math.hypot(x - cx, (y - cy) * 1.5) / 6;
        if (d < 1) p.set(x, y, d > 0.85 ? alpha(hx('#6a8a90'), 0.5) : alpha(hx('#10181c'), 0.55));
      }
    p.set(Math.round(cx) - 1, Math.round(cy) - 1, hx('#a8c8d0'));
  } else if (kind === MK.crack) {
    let x = cx;
    let y = 1;
    for (let i = 0; i < 16; i++) {
      p.set(Math.round(x), Math.round(y), INK);
      p.set(Math.round(x) + 1, Math.round(y), alpha(hx('#9aa294'), 0.6));
      x += (hash(i, wx, wy) - 0.5) * 2;
      y += 1;
    }
    for (let i = 0; i < 5; i++) p.set(Math.round(cx) + i, Math.round(cy) + (i % 2), INK);
  }
  return p;
}

// ---------------------------------------------------------------------------
// Лица стен: плитка, мозаика, название, обделка тоннеля, плакаты, офуда,
// портал, вагон, трещина, балюстрада, касса, храм.
// ---------------------------------------------------------------------------

/** Верхняя кромка лица стены (как у движка: светлый срез камня). */
function capRim(p: Px, pal: RGBA[]): void {
  for (let x = 0; x < 16; x++) {
    p.set(x, 0, pal[1]);
    p.set(x, 1, pal[4] ?? pal[3]);
    p.set(x, 2, pal[3]);
    p.set(x, 3, pal[0]);
  }
}

/** Плиточная стена: мелкий кафель, тёмный плинтус, выбитые плитки. */
function tileFace(wx: number, wy: number, v: number): Px {
  const p = new Px(16, 16);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const row = Math.floor((y - 4) / 3);
      const off = row % 2 ? 2 : 0;
      const gx = (x + off + wx * 16) % 4;
      const gy = (y - 4) % 3;
      const tileId = Math.floor((x + off + wx * 16) / 4) * 13 + row * 7 + wy * 3;
      let c = CERAMIC[hash(tileId, 1) > 0.8 ? 4 : hash(tileId, 2) < 0.15 ? 2 : 3];
      if (gx === 0 || gy === 0) c = CERAMIC[0];
      // Выбитая плитка.
      if (hash(tileId, 9, v) > 0.94 && gx && gy) c = hx('#3a3a30');
      p.set(x, y, c);
    }
  capRim(p, CERAMIC);
  // Плинтус и грязь снизу.
  for (let x = 0; x < 16; x++) {
    p.set(x, 13, hx('#3a3a32'));
    p.set(x, 14, hx('#2a2a24'));
    p.set(x, 15, hx('#1a1a16'));
    if (hash(wx * 16 + x, wy, 3) > 0.7) p.set(x, 12, mixc(CERAMIC[2], hx('#3a3424'), 0.5));
  }
  return p;
}

/** Мозаичное панно: латунная рама, сюжет из смальты (поезд и звёзды). */
function mosaicFace(c: CellCtx): Px {
  let run = 0;
  while (c.markAt(-run - 1, 0) === MK.wMosaic) run++;
  const idx = run % 2;
  return cellOf(`qface|${idx}|${c.markAt(1, 0) === MK.wMosaic ? 1 : 0}`, () => {
    const p = tileFace(0, 0, 0);
    const sm = [hx('#2a3a6a'), hx('#3a5a9a'), hx('#c8a040'), hx('#a03030'), hx('#e8e0c8'), hx('#1a2a4a')];
    for (let y = 4; y < 13; y++)
      for (let x = 0; x < 16; x++) {
        const gx = x + idx * 16;
        let col = sm[(gx * 3 + y * 5) % 7 === 0 ? 5 : 0];
        // Серп луны, звёзды, силуэт поезда по низу.
        if (Math.hypot(gx - 8, y - 7) < 3 && Math.hypot(gx - 9.5, y - 6.5) > 2.2) col = sm[2];
        if ((gx * 7 + y * 11) % 23 === 0) col = sm[4];
        if (y > 9 && gx > 12 && gx < 30) col = y === 10 ? sm[3] : sm[1];
        if (y === 11 && gx > 12 && gx < 30 && gx % 4 === 0) col = sm[4];
        p.set(x, y, col);
      }
    const fr = hx('#b08a3a');
    const frD = hx('#5a4418');
    for (let x = 0; x < 16; x++) {
      p.set(x, 4, fr);
      p.set(x, 12, frD);
    }
    if (idx === 0) for (let y = 4; y < 13; y++) p.set(0, y, fr);
    if (c.markAt(1, 0) !== MK.wMosaic) for (let y = 4; y < 13; y++) p.set(15, y, frD);
    return p;
  });
}

/** Название станции: тёмная плита, белые буквы «ПРОКЛЯТАЯ». */
function nameFace(c: CellCtx): Px {
  let run = 0;
  while (c.markAt(-run - 1, 0) === MK.wName) run++;
  let len = run + 1;
  while (c.markAt(len - run, 0) === MK.wName) len++;
  return cellOf(`name|${run}|${len}`, () => {
    const p = tileFace(run, 0, 0);
    const W = len * 16;
    const plate = new Px(W, 16);
    for (let y = 4; y < 12; y++)
      for (let x = 1; x < W - 1; x++) plate.set(x, y, y === 4 ? hx('#3a4a6a') : y === 11 ? hx('#0a0e18') : hx('#141c30'));
    const word = len >= 3 ? 'ПРОКЛЯТАЯ' : 'ВЫХОД';
    const tw = word.length * 4 - 1;
    text(plate, word, Math.floor((W - tw) / 2), 6, hx('#f0ecd8'));
    // Сажа, трещина через плиту и кровавый потёк — станция не жилая.
    plate.set(Math.floor(W * 0.6), 5, hx('#7a1420'));
    plate.set(Math.floor(W * 0.6), 6, hx('#7a1420'));
    plate.set(Math.floor(W * 0.6), 7, hx('#4a0a12'));
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const i = (y * W + x + run * 16) * 4;
      if (plate.data[i + 3]) p.set(x, y, [plate.data[i], plate.data[i + 1], plate.data[i + 2], 255]);
    }
    return p;
  });
}

/** Обделка тоннеля: бетонные тюбинги, болты, кабели. */
function tunnelFace(wx: number, v: number): Px {
  return cellOf(`tface|${wx % 3}|${v % 2}`, () => {
    const p = new Px(16, 16);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const n = hash(wx * 16 + x, y, 41);
        let c = TUNNEL[n > 0.8 ? 3 : n > 0.4 ? 2 : 1];
        if ((wx * 16 + x) % 12 === 0) c = TUNNEL[0];
        if ((wx * 16 + x) % 12 === 1) c = TUNNEL[4];
        p.set(x, y, c);
      }
    capRim(p, TUNNEL);
    // Болты у стыков.
    for (let y of [6, 11]) {
      const bx = (12 - ((wx * 16) % 12)) % 12;
      if (bx < 15) {
        p.set(bx + 2, y, hx('#6a6660'));
        p.set(bx + 2, y + 1, hx('#1a1a18'));
      }
    }
    // Кабели на кронштейнах.
    for (let x = 0; x < 16; x++) {
      const sag = Math.round(Math.sin(((wx * 16 + x) / 24) * Math.PI) * 1);
      p.set(x, 8 + sag, hx('#0c0c0e'));
      p.set(x, 9 + sag, hx('#1e1a14'));
      p.set(x, 10, hx('#26221c'));
    }
    for (let x = 0; x < 16; x++) {
      p.set(x, 14, TUNNEL[0]);
      p.set(x, 15, hx('#0c0d0e'));
    }
    if (v % 2) for (let y = 11; y < 14; y++) p.set(9, y, alpha(hx('#2a3a30'), 0.8));
    return p;
  });
}

/** Плакаты на плиточной стене: реклама с лицами — глаза следят. */
function posterFace(c: CellCtx): Px {
  const v = Math.floor(hash(c.wx, c.wy, 5) * 3);
  return cellOf(`poster|${v}|${c.wx & 1}`, () => {
    const p = tileFace(c.wx & 1, 0, 0);
    const paper = PAPER;
    const x0 = 2;
    const x1 = 13;
    for (let y = 4; y < 13; y++)
      for (let x = x0; x <= x1; x++) p.set(x, y, paper[(x + y) % 9 === 0 ? 1 : 2]);
    if (v === 0) {
      // Лицо с огромной улыбкой: «Улыбнитесь — вас видят».
      shadeEll(p, 7.5, 8, 3.2, 3.6, tn('#8a6a58', '#b8927a', '#d8b69a', '#f0d8c0'));
      p.set(6, 7, INK);
      p.set(9, 7, INK);
      for (let x = 5; x <= 10; x++) p.set(x, 10, x === 5 || x === 10 ? INK : hx('#a02020'));
      text(p, 'М', 11, 5, hx('#c02020'));
    } else if (v === 1) {
      // Схема линий.
      for (let x = x0 + 1; x < x1; x++) p.set(x, 7, hx('#c02828'));
      for (let y = 5; y < 12; y++) p.set(8, y, hx('#2a5aa0'));
      for (const [x, y] of [[4, 7], [8, 7], [11, 7], [8, 5], [8, 10]] as [number, number][]) {
        p.set(x, y, WHITE);
        p.set(x, y + 1, INK);
      }
    } else {
      // Пропавший человек — лицо затёрто.
      for (let y = 5; y < 10; y++) for (let x = 5; x < 11; x++) p.set(x, y, hx('#3a3a3a'));
      p.set(6, 7, hx('#ff2a2a'));
      p.set(9, 7, hx('#ff2a2a'));
      for (let x = 4; x < 12; x++) p.set(x, 11, hx('#2a2a2a'));
    }
    // Оторванный угол и скрепка.
    p.set(x1, 4, CERAMIC[3]);
    p.set(x1 - 1, 4, paper[0]);
    p.set(x1, 5, paper[0]);
    p.set(x0 + 1, 4, STEEL[3]);
    return p;
  });
}

/** Офуда: полосы бумаги с красными знаками — стена запечатана. */
function ofudaFace(c: CellCtx, onRock: boolean): Px {
  const v = Math.floor(hash(c.wx, c.wy, 13) * 4);
  return cellOf(`ofuda|${v}|${onRock ? 1 : 0}`, () => {
    const p = onRock ? shrineFace(c.wx, c.wy, 0) : tileFace(c.wx, c.wy, 0);
    for (let s = 0; s < 3; s++) {
      const x0 = 1 + s * 5 + (v % 2);
      const top = 3 + ((v + s) % 3);
      const tilt = ((v + s) % 3) - 1;
      for (let y = top; y < 14; y++)
        for (let x = 0; x < 3; x++) {
          const xx = x0 + x + Math.round(((y - top) / 10) * tilt);
          p.set(xx, y, PAPER[x === 0 ? 1 : 3]);
        }
      // Знак: столбик штрихов кармином.
      for (let y = top + 2; y < 12; y += 2) p.set(x0 + 1 + Math.round(((y - top) / 10) * tilt), y, hx('#a01420'));
      p.set(x0 + 1, top + 1, hx('#d02a3a'));
      // Опалённый край.
      p.set(x0, 13, hx('#3a2a1a'));
      p.set(x0 + 2, 13, hx('#5a3a1a'));
    }
    return p;
  });
}

/** Портал тоннеля: свод и темнота. */
function portalFace(c: CellCtx): Px {
  return cellOf(`portal|${c.wx % 2}`, () => {
    const p = tunnelFace(c.wx, 0);
    const q = new Px(16, 16);
    q.data.set(p.data);
    for (let y = 5; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const k = (y - 5) / 11;
        q.set(x, y, [4, 5, 6, Math.round(160 + 90 * k)]);
      }
    for (let x = 0; x < 16; x++) {
      q.set(x, 4, hx('#5a5e62'));
      q.set(x, 5, hx('#2a2c2e'));
    }
    return q;
  });
}

/** Стоящий вагон депо: борт с окнами и дверями или крыша. */
function carCell(c: CellCtx): Px {
  const face = c.open(0, 1);
  const l = c.markAt(-1, 0) !== MK.wCar;
  const r = c.markAt(1, 0) !== MK.wCar;
  let run = 0;
  while (c.markAt(-run - 1, 0) === MK.wCar) run++;
  return cellOf(`car|${face ? 1 : 0}|${l ? 1 : 0}${r ? 1 : 0}|${run % 3}`, () => {
    const p = new Px(16, 16);
    const body = [hx('#1e2a36'), hx('#2c3e50'), hx('#3a5268'), hx('#5a7890')];
    if (!face) {
      // Крыша: светлая, с вентиляцией.
      for (let y = 0; y < 16; y++)
        for (let x = 0; x < 16; x++) {
          let col = STEEL[y < 2 ? 1 : y > 13 ? 2 : 3];
          if (y > 5 && y < 10 && (x + run * 16) % 12 < 5) col = STEEL[1];
          p.set(x, y, col);
        }
      if (l) for (let y = 0; y < 16; y++) p.set(0, y, INK);
      if (r) for (let y = 0; y < 16; y++) p.set(15, y, INK);
      return p;
    }
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        let col = body[y < 2 ? 3 : y < 11 ? 2 : 1];
        if (y === 11 || y === 12) col = hx('#b8b0a0');
        if (y >= 14) col = hx('#0a0c0e');
        p.set(x, y, col);
      }
    // Окна (тёмные, пыльные) и двери.
    const k = run % 3;
    if (k === 1) {
      for (let y = 2; y < 13; y++) {
        p.set(3, y, INK);
        p.set(12, y, INK);
        p.set(7, y, hx('#141c24'));
        p.set(8, y, hx('#141c24'));
      }
      for (let y = 3; y < 8; y++) for (const x of [5, 6, 9, 10]) p.set(x, y, hx('#101820'));
    } else {
      for (let y = 3; y < 9; y++)
        for (let x = 2; x < 14; x++) {
          const g = y === 3 ? hx('#3a4a58') : hx('#0e1620');
          p.set(x, y, (x === 7 || x === 8) ? body[1] : g);
        }
      // Силуэт в окне: кто-то сидит в пустом вагоне.
      if (hash(c.wx, c.wy, 2) > 0.5) {
        p.set(10, 5, hx('#2a3040'));
        p.set(10, 6, hx('#2a3040'));
        p.set(10, 4, hx('#ff3a3a'));
      }
    }
    if (l) for (let y = 0; y < 16; y++) p.set(0, y, INK);
    if (r) for (let y = 0; y < 16; y++) p.set(15, y, INK);
    return p;
  });
}

/** Трещина длиннорукого: плитка расколота, внутри — чернота. */
function armFace(c: CellCtx): Px {
  const face = c.open(0, 1);
  return cellOf(`arm|${face ? 1 : 0}|${c.wx % 2}`, () => {
    const p = face ? tileFace(c.wx, c.wy, 3) : new Px(16, 16);
    if (!face) for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, hx('#16181a'));
    const pts: [number, number][] = [
      [7, 2],
      [9, 5],
      [6, 8],
      [10, 11],
      [8, 15],
    ];
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      stroke(p, x0, y0, x1, y1, hx('#050506'), 3);
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      stroke(p, x0 + 1.5, y0, x1 + 1.5, y1, alpha(CERAMIC[4], 0.7), 1);
    }
    // Отколотые плитки вокруг.
    p.set(4, 6, hx('#3a3a30'));
    p.set(12, 9, hx('#3a3a30'));
    p.set(5, 12, hx('#3a3a30'));
    return p;
  });
}

/** Балюстрада эскалатора: чёрный поручень, светлые щиты. */
function balusCell(c: CellCtx): Px {
  const face = c.open(0, 1);
  const top = !c.open(0, -1) && c.markAt(0, -1) !== MK.wBalus;
  return cellOf(`balus|${face ? 1 : 0}|${top ? 1 : 0}|${c.markAt(-1, 0) === MK.wBalus ? 1 : 0}`, () => {
    const p = new Px(16, 16);
    const leftHalf = c.markAt(1, 0) === MK.wBalus;
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        // Деревянная крышка, по краям — поручни.
        let col = hx('#4a2e1c');
        if ((leftHalf && x < 3) || (!leftHalf && x > 12)) col = hx('#0c0c0e');
        else if ((leftHalf && x === 3) || (!leftHalf && x === 12)) col = hx('#3a3a40');
        else col = y % 6 === 0 ? hx('#3a2414') : x % 5 === 0 ? hx('#5a3a24') : hx('#6a4630');
        p.set(x, y, col);
      }
    if (face)
      for (let x = 0; x < 16; x++)
        for (let y = 10; y < 16; y++) p.set(x, y, y < 12 ? hx('#2a2c30') : hx('#101114'));
    return p;
  });
}

/** Кассовое окно: плитка, светлое окошко с решёткой, табличка. */
function kassaFace(c: CellCtx): Px {
  return cellOf(`kassa|${c.wx % 2}`, () => {
    const p = tileFace(c.wx, c.wy, 1);
    for (let y = 4; y < 12; y++)
      for (let x = 3; x < 13; x++) p.set(x, y, y < 6 ? hx('#e8d8a0') : hx('#b89a58'));
    for (let x = 3; x < 13; x++) if (x % 2 === 0) for (let y = 6; y < 12; y++) p.set(x, y, hx('#4a4030'));
    for (let x = 2; x < 14; x++) {
      p.set(x, 3, STEEL[3]);
      p.set(x, 12, STEEL[1]);
    }
    text(p, 'КАССА', 1, 13 - 5, hx('#2a1a10'));
    return p;
  });
}

/** Храмовая стена: тёмный камень, лакированные брусья, резьба. */
function shrineFace(wx: number, wy: number, v: number): Px {
  const p = new Px(16, 16);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const n = hash(wx * 16 + x, wy * 16 + y, 55);
      let col = SHRINE[n > 0.85 ? 4 : n > 0.5 ? 3 : 2];
      const bx = (wx * 16 + x) % 8;
      const by = y % 5;
      if (bx === 0 || by === 0) col = SHRINE[1];
      p.set(x, y, col);
    }
  capRim(p, SHRINE);
  // Лакированный брус и столбы.
  for (let x = 0; x < 16; x++) {
    p.set(x, 4, LACQUER[1]);
    p.set(x, 5, LACQUER[3]);
    p.set(x, 6, LACQUER[2]);
  }
  if ((wx + v) % 3 === 0)
    for (let y = 4; y < 16; y++) {
      p.set(7, y, LACQUER[2]);
      p.set(8, y, LACQUER[1]);
      p.set(6, y, LACQUER[4]);
    }
  // Резной оскал в камне.
  if ((wx * 5 + wy) % 7 === 2) {
    p.set(11, 10, INK);
    p.set(13, 10, INK);
    for (let x = 10; x < 15; x++) p.set(x, 12, x % 2 ? BONE[3] : INK);
  }
  return p;
}

/** Замок на проходе турникетов (час пик): красные створки. */
function lockedCell(c: CellCtx): Px {
  return cellOf(`locked|${c.wx & 1}`, () => {
    const p = graniteCell(c.wx & 1, c.wy & 1, 3);
    for (let y = 4; y < 14; y++) {
      p.set(3, y, STEEL[1]);
      p.set(12, y, STEEL[1]);
    }
    for (let x = 3; x < 13; x++) {
      p.set(x, 6, hx('#d02a2a'));
      p.set(x, 7, hx('#8a1414'));
      p.set(x, 10, hx('#d02a2a'));
      p.set(x, 11, hx('#8a1414'));
    }
    p.set(7, 4, hx('#ff4a3a'));
    p.set(8, 4, hx('#ff4a3a'));
    return p;
  });
}

// --- Святилище ---------------------------------------------------------------

/** Камень святилища: большие старые плиты, трещины, мох тьмы. */
/**
 * Плиты неровного камня на торе 64×64 (4×4 клетки): рисунок стыкуется сам с
 * собой на любом сдвиге, ключ кеша — клетка внутри тора.
 */
const FLAG_SEEDS: [number, number][] = (() => {
  const out: [number, number][] = [];
  for (let gy = 0; gy < 3; gy++)
    for (let gx = 0; gx < 3; gx++)
      out.push([gx * 21.3 + 4 + hash(gx, gy, 71) * 12, gy * 21.3 + 4 + hash(gy, gx, 72) * 12]);
  return out;
})();

function flagstone(ix: number, iy: number, pal: RGBA[], seed: number): Px {
  const p = new Px(16, 16);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const px = ix * 16 + x + 0.5;
      const py = iy * 16 + y + 0.5;
      let d1 = 1e9;
      let d2 = 1e9;
      let best = 0;
      let bx = 0;
      let by = 0;
      FLAG_SEEDS.forEach(([sx, sy], i) => {
        for (const ox of [-64, 0, 64])
          for (const oy of [-64, 0, 64]) {
            const d = Math.hypot(px - sx - ox, py - sy - oy);
            if (d < d1) {
              d2 = d1;
              d1 = d;
              best = i;
              bx = sx + ox;
              by = sy + oy;
            } else if (d < d2) d2 = d;
          }
      });
      const edge = d2 - d1;
      const t = 1 + (hash(best, seed, 3) > 0.66 ? 1 : hash(best, seed, 4) < 0.3 ? -1 : 0);
      let col = pal[t + 1];
      const n = hash(Math.floor(px), Math.floor(py), seed + 9);
      if (n > 0.95) col = pal[Math.min(pal.length - 1, t + 2)];
      else if (n < 0.06) col = pal[t];
      if (edge < 1.3) col = pal[0];
      else if (edge < 2.6) {
        // Фаска: сверху-слева камень светлее, снизу-справа темнее.
        const lit = (px - bx) * LX + (py - by) * LY > 0;
        col = lit ? mixc(col, pal[pal.length - 1], 0.35) : mixc(col, pal[0], 0.35);
      }
      p.set(x, y, col);
    }
  return p;
}

function shrineFloor(wx: number, wy: number): Px {
  return cellOf(`sfloor|${wx & 3}|${wy & 3}`, () => flagstone(wx & 3, wy & 3, SHRINE, 5));
}

/** Кости на камне. */
function bonesOver(base: Px, wx: number, wy: number): Px {
  const p = new Px(16, 16);
  p.data.set(base.data);
  const v = Math.floor(hash(wx, wy, 3) * 3);
  const bone = (x0: number, y0: number, x1: number, y1: number) => {
    stroke(p, x0, y0, x1, y1, BONE[2], 1);
    p.set(x0, y0, BONE[3]);
    p.set(x1, y1, BONE[3]);
    p.set(x0 + 1, y0, BONE[1]);
  };
  bone(2, 5 + v, 9, 7);
  bone(8, 11, 13, 9 - v);
  if (v === 1) {
    // Череп.
    shadeEll(p, 11, 5, 2.5, 2.2, [BONE[0], BONE[1], BONE[2], BONE[3]]);
    p.set(10, 5, INK);
    p.set(12, 5, INK);
    p.set(11, 7, INK);
  }
  return p;
}

/** Руны на полу: светящийся пурпурный росчерк. */
function runeOver(base: Px, wx: number, wy: number): Px {
  const p = new Px(16, 16);
  p.data.set(base.data);
  const v = Math.floor(hash(wx, wy, 4) * 4);
  const pts: [number, number][][] = [
    [[3, 3], [12, 12], [3, 12], [12, 3]],
    [[8, 2], [8, 14], [3, 8], [13, 8]],
    [[3, 4], [8, 12], [13, 4], [3, 4]],
    [[4, 3], [12, 3], [8, 13], [4, 3]],
  ];
  const ptsV = pts[v];
  for (let i = 0; i < ptsV.length - 1; i++) {
    const [x0, y0] = ptsV[i];
    const [x1, y1] = ptsV[i + 1];
    stroke(p, x0, y0, x1, y1, CURSE[3], 1);
  }
  p.set(8, 8, hx('#ffffff'));
  return p;
}

/** Помост: красный лак, золотые накладки. */
function daisCell(c: CellCtx): Px {
  const n = c.markAt(0, -1) !== MK.dais;
  const s = c.markAt(0, 1) !== MK.dais;
  const w = c.markAt(-1, 0) !== MK.dais;
  const e = c.markAt(1, 0) !== MK.dais;
  return cellOf(`dais|${n ? 1 : 0}${s ? 1 : 0}${w ? 1 : 0}${e ? 1 : 0}|${c.wx % 3}|${c.wy & 1}`, () => {
    // Помост: тёмные лакированные доски — красные метки ударов на нём
    // обязаны читаться, поэтому сам он почти чёрный.
    const wood = [hx('#140a0c'), hx('#1e0f12'), hx('#2a1418'), hx('#3a1c20')];
    const p = new Px(16, 16);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const gy = (c.wy & 1) * 16 + y;
        const board = Math.floor(gy / 4);
        const gx = (c.wx % 3) * 16 + x;
        const t = hash(board, Math.floor((gx + board * 13) / 24), 2) > 0.5 ? 2 : 1;
        let col = wood[t];
        if (gy % 4 === 0) col = wood[0];
        else if ((gx + board * 13) % 24 === 0) col = wood[0];
        else if (hash(gx, gy, 8) > 0.9) col = wood[t + 1];
        p.set(x, y, col);
      }
    for (let i = 0; i < 16; i++) {
      if (n) {
        p.set(i, 0, GOLD[1]);
        p.set(i, 1, GOLD[3]);
      }
      if (s) {
        p.set(i, 14, GOLD[2]);
        p.set(i, 15, INK);
      }
      if (w) p.set(0, i, GOLD[1]);
      if (e) p.set(15, i, GOLD[1]);
    }
    return p;
  });
}

/** Провал: тьма с обломанным краем. */
function abyssCell(c: CellCtx): Px {
  const n = c.open(0, -1) && c.markAt(0, -1) !== MK.abyss;
  return cellOf(`abyss|${n ? 1 : 0}|${c.wx & 3}`, () => {
    const p = new Px(16, 16);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const k = n ? Math.max(0, 1 - y / 8) : 0;
        p.set(x, y, mixc(hx('#030204'), hx('#1a0e1c'), k * 0.8));
      }
    if (n)
      for (let x = 0; x < 16; x++) {
        const d = 1 + Math.floor(hash(c.wx * 16 + x, 1, 2) * 3);
        for (let y = 0; y < d; y++) p.set(x, y, SHRINE[y === d - 1 ? 1 : 2]);
        p.set(x, d, INK);
      }
    // Далёкие огоньки внизу.
    if (hash(c.wx, c.wy, 9) > 0.7) p.set(4 + Math.floor(hash(c.wy, c.wx, 3) * 8), 9, alpha(CURSE[3], 0.5));
    return p;
  });
}

/** Земля провала: тёмная, сыпучая. */
function groundCell(wx: number, wy: number): Px {
  const ix = wx & 3;
  const iy = wy & 3;
  return cellOf(`ground|${ix}|${iy}`, () => {
    const p = new Px(16, 16);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const n = tnoise(ix * 16 + x, iy * 16 + y, 8, 64, 31) * 0.6 + hash(ix * 16 + x, iy * 16 + y, 7) * 0.4;
        p.set(x, y, [hx('#161016'), hx('#201820'), hx('#2a2028'), hx('#372a34')][n > 0.75 ? 3 : n > 0.5 ? 2 : n > 0.25 ? 1 : 0]);
      }
    return p;
  });
}

/** Храм развёрнут: чёрная вода с кровью, кости всплывают. */
/** Сглаженный шум на торе `per` пикселей (решётка шага `sc`) — стыкуется сам с собой. */
function tnoise(x: number, y: number, sc: number, per: number, seed: number): number {
  const n = per / sc;
  const xi = Math.floor(x / sc);
  const yi = Math.floor(y / sc);
  const fx = x / sc - xi;
  const fy = y / sc - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const h = (a: number, b: number) => hash(((a % n) + n) % n, ((b % n) + n) % n, seed);
  const a = h(xi, yi) * (1 - u) + h(xi + 1, yi) * u;
  const b = h(xi, yi + 1) * (1 - u) + h(xi + 1, yi + 1) * u;
  return a * (1 - v) + b * v;
}

/** Храм развёрнут: чёрная кровь, по ней идёт рябь; изредка всплывают кости. */
function domainCell(c: CellCtx): Px {
  const ix = c.wx & 3;
  const iy = c.wy & 3;
  return cellOf(`domain|${ix}|${iy}`, () => {
    const p = new Px(16, 16);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const lx = ix * 16 + x;
        const ly = iy * 16 + y;
        const n = tnoise(lx, ly, 16, 64, 61);
        const m = tnoise(lx, ly, 8, 64, 62);
        let col = mixc(hx('#0a0205'), hx('#22060c'), n);
        // Рябь: волнистые полосы света вдоль ряда.
        const wave = Math.sin(ly * 0.9 + m * 7 + n * 3);
        if (wave > 0.93) col = hx('#4a0c16');
        else if (wave > 0.82) col = mixc(col, hx('#3a0810'), 0.6);
        if (hash(lx, ly, 63) > 0.992) col = hx('#8a2030');
        p.set(x, y, col);
      }
    if (hash(ix, iy, 4) > 0.8) {
      stroke(p, 3, 9, 9, 7, BONE[1], 1);
      p.set(3, 9, BONE[3]);
      p.set(9, 7, BONE[2]);
    }
    return p;
  });
}

// ---------------------------------------------------------------------------
// Рисовальщик районов.
// ---------------------------------------------------------------------------

const T_WALL = 1;
const T_CRACK = 6;
const T_DEEP = 11;

function stationFloor(c: CellCtx, area: string): Px {
  const e = edgesOf(c);
  const k = c.mark;
  // База: плитка станции / бетон служебных ходов / камень святилища.
  const granite = (m: number) =>
    m === MK.tile || m === MK.sleepPost || m === MK.eyePost || m === MK.guardPost || m === MK.dollPost || m === MK.mosaic;
  // Пятно (кровь, сажа, лужа, трещина) лежит на полу соседей: на плитке —
  // плиткой, в служебном ходу — бетоном.
  const stainy = k === MK.blood || k === MK.soot || k === MK.wet || k === MK.crack || k === MK.bones || k === MK.rune;
  const onGranite =
    stainy && [c.markAt(-1, 0), c.markAt(1, 0), c.markAt(0, -1), c.markAt(0, 1)].filter(granite).length >= 2;
  const baseOf = (): Px => {
    if (area === F12_SHRINE) return k === MK.ballast || k === MK.edge ? shrineFloor(c.wx, c.wy) : c.tile === 2 && k === 0 ? groundCell(c.wx, c.wy) : shrineFloor(c.wx, c.wy);
    if (granite(k) || onGranite)
    {
      // Плита — 2×2 клетки: камень и оттенок общие на плиту.
      const sx = c.wx >> 1;
      const sy = c.wy >> 1;
      const tone = (sx + sy) & 1;
      const v = Math.floor(hash(sx, sy, 1) * 7);
      return cellOf(`gran|${c.wx & 1}|${c.wy & 1}|${tone}|${v}`, () => graniteCell(c.wx & 1, c.wy & 1, v, tone));
    }
    return cellOf(`conc|${c.wx & 3}|${c.wy & 3}`, () => concreteCell(c.wx & 3, c.wy & 3));
  };
  let p: Px;
  switch (k) {
    case MK.mosaic:
      p = mosaicCell(c);
      break;
    case MK.edge:
      return edgeCell(c);
    case MK.railN:
    case MK.railS:
      return railCell(c, k === MK.railN, false, area === F12_PLAT && (c.markAt(0, k === MK.railN ? -1 : 1) === MK.ballast));
    case MK.crossN:
    case MK.crossS:
      return railCell(c, k === MK.crossN, true, false);
    case MK.escN:
    case MK.escS:
    case MK.esc0:
      return escCell(c, k);
    case MK.comb:
      return combCell(c);
    case MK.hatch:
      return hatchCell(c);
    case MK.grate:
      return grateCell(c);
    case MK.ballast:
      return ballastCell(c);
    case MK.niche:
      return nicheCell(c);
    case MK.dais:
      return daisCell(c);
    case MK.domain:
      return domainCell(c);
    case MK.linePost:
      // Пост обходчика: у путей — щебень, в ходу — бетон.
      if ([c.markAt(-1, 0), c.markAt(1, 0), c.markAt(0, -1), c.markAt(0, 1)].includes(MK.ballast)) return ballastCell(c);
      p = baseOf();
      break;
    default:
      p = baseOf();
  }
  if (k === MK.blood || k === MK.soot || k === MK.wet || k === MK.crack)
    p = cellOf(`stain|${k}|${area === F12_SHRINE ? 1 : onGranite ? 2 : 0}|${c.wx % 5}|${c.wy % 5}`, () => stainOver(baseOf(), k, c.wx, c.wy));
  if (k === MK.bones) p = cellOf(`bones|${area === F12_SHRINE ? 1 : onGranite ? 2 : 0}|${c.wx % 6}|${c.wy % 6}`, () => bonesOver(baseOf(), c.wx, c.wy));
  if (k === MK.rune) p = cellOf(`rune|${area === F12_SHRINE ? 1 : onGranite ? 2 : 0}|${c.wx % 4}|${c.wy % 4}`, () => runeOver(baseOf(), c.wx, c.wy));
  if (k === MK.shrine) p = shrineFloor(c.wx, c.wy);
  if (!e.n && !e.w && !e.e && !e.rim) return p;
  return cellOf(`${keyOfPx(p)}|sh${e.n ? 1 : 0}${e.w ? 1 : 0}${e.e ? 1 : 0}${e.rim ? 1 : 0}`, () => {
    const q = new Px(16, 16);
    q.data.set(p.data);
    wallShade(q, e.n, e.w, e.e);
    if (e.rim) rimBelow(q);
    return q;
  });
}

/** Ключ кеша для готового холста — по ссылке (холсты клеток постоянные). */
const pxKeys = new WeakMap<Px, number>();
let pxN = 0;
function keyOfPx(p: Px): string {
  let k = pxKeys.get(p);
  if (k === undefined) {
    k = ++pxN;
    pxKeys.set(p, k);
  }
  return `px${k}`;
}

function stationWall(c: CellCtx, area: string): Px | null {
  const face = c.open(0, 1);
  const k = c.mark;
  switch (k) {
    case MK.wCar:
      return carCell(c);
    case MK.wBalus:
      return balusCell(c);
    case MK.locked:
      return lockedCell(c);
  }
  if (!face) return null;
  switch (k) {
    case MK.wTile:
      return cellOf(`tile|${c.wx % 4}|${c.wy % 2}`, () => tileFace(c.wx % 4, c.wy % 2, 0));
    case MK.wMosaic:
      return mosaicFace(c);
    case MK.wName:
      return nameFace(c);
    case MK.wTunnel:
      return tunnelFace(c.wx, c.wy);
    case MK.wPoster:
      return posterFace(c);
    case MK.wOfuda:
      return ofudaFace(c, area === F12_SHRINE);
    case MK.wPortal:
      return portalFace(c);
    case MK.wArm:
      return armFace(c);
    case MK.wKassa:
      return kassaFace(c);
    case MK.wShrine:
      return cellOf(`shr|${c.wx % 6}|${c.wy % 2}`, () => shrineFace(c.wx % 6, c.wy % 2, 0));
    case MK.wFix: {
      // Под часами, неоном и лампой — стена соседей.
      const nb = c.markAt(-1, 0) || c.markAt(1, 0);
      if (nb === MK.wTunnel || area === F12_PLAT && (c.markAt(0, 1) === MK.ballast || c.markAt(0, 1) === MK.niche))
        return tunnelFace(c.wx, c.wy);
      if (area === F12_SHRINE) return cellOf(`shr|${c.wx % 6}|${c.wy % 2}`, () => shrineFace(c.wx % 6, c.wy % 2, 0));
      return cellOf(`tile|${c.wx % 4}|${c.wy % 2}`, () => tileFace(c.wx % 4, c.wy % 2, 0));
    }
    case MK.domainWall:
      return cellOf(`dwall|${c.wx % 4}`, () => {
        const p = shrineFace(c.wx, 0, 1);
        for (let y = 7; y < 14; y++) for (let x = 0; x < 16; x++) if ((x + y) % 4 === 0) p.set(x, y, BLOODC[2]);
        return p;
      });
  }
  // Лицо стены без метки (нора, шахта, трещина, плакат-заготовка) — по району.
  if (c.tile === T_WALL || c.tile === T_CRACK) {
    if (area === F12_SHRINE) return cellOf(`shr|${c.wx % 6}|${c.wy % 2}`, () => shrineFace(c.wx % 6, c.wy % 2, 0));
    const tunnel = c.markAt(-1, 0) === MK.wTunnel || c.markAt(1, 0) === MK.wTunnel;
    return tunnel ? tunnelFace(c.wx, c.wy) : cellOf(`tile|${c.wx % 4}|${c.wy % 2}`, () => tileFace(c.wx % 4, c.wy % 2, 0));
  }
  return null;
}

function f12Cell(c: CellCtx, area: string): Px | null {
  if (c.tile === T_DEEP) {
    if (c.mark === MK.tunnelN || c.mark === MK.tunnelS) return tunnelDeepCell(c, c.mark === MK.tunnelN);
    if (c.mark === MK.abyss) return abyssCell(c);
    return null;
  }
  if (c.tile === T_WALL || c.tile === T_CRACK) return stationWall(c, area);
  return stationFloor(c, area);
}

registerCellPainter(F12_HALL, (c) => f12Cell(c, F12_HALL));
registerCellPainter(F12_PLAT, (c) => f12Cell(c, F12_PLAT));
registerCellPainter(F12_SHRINE, (c) => f12Cell(c, F12_SHRINE));

// ---------------------------------------------------------------------------
// Реквизит станции и храма. Спрайт стоит на нижнем крае своей клетки.
// ---------------------------------------------------------------------------

const props = new Map<string, Sprite>();

function sprite(key: string, make: () => { p: Px; ax: number; ay: number } | null): Sprite | null {
  let s = props.get(key);
  if (!s) {
    const r = make();
    if (!r) return null;
    s = { img: r.p.canvas(), ax: r.ax, ay: r.ay };
    props.set(key, s);
  }
  return s;
}

const flashed = (key: string, flash: boolean, make: () => { p: Px; ax: number; ay: number } | null) =>
  sprite(`${key}|${flash ? 1 : 0}`, () => {
    const r = make();
    if (!r) return null;
    return flash ? { ...r, p: r.p.tint(WHITE, 0.8) } : r;
  });

/** Тень предмета на полу. */
function floorShadow(p: Px, cx: number, by: number, rx: number): void {
  for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
    const k = 1 - Math.abs(x + 0.5 - cx) / (rx + 0.5);
    if (k <= 0) continue;
    p.set(x, by, [0, 0, 0, Math.round(110 * k)]);
    p.set(x, by - 1, [0, 0, 0, Math.round(50 * k)]);
  }
}

/** Светлый «блик» свечения вокруг точки (без фильтров — пикселями). */
function glowDot(p: Px, x: number, y: number, c: RGBA, r = 2): void {
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      const d = Math.hypot(dx, dy);
      if (d > r + 0.3) continue;
      p.set(x + dx, y + dy, alpha(c, 0.55 * (1 - d / (r + 0.5))));
    }
  p.set(x, y, WHITE);
}

const inDark = (o: WorldObj) => {
  const d = F12_FX.dark;
  return !!d && o.x >= d[0] && o.x <= d[2] && o.y >= d[1] && o.y <= d[3];
};

// --- Турникет: стальная тумба, триподы, табло со стрелкой. ---------------

function turnstilePx(red: boolean): Px {
  const p = new Px(16, 20);
  floorShadow(p, 8, 19, 6);
  // Тумба.
  polyShade(p, [[5, 6], [11, 6], [11, 18], [5, 18]], [STEEL[1], STEEL[2], STEEL[3], STEEL[4]]);
  for (let y = 7; y < 18; y++) p.set(10, y, STEEL[1]);
  // Крышка и табло.
  for (let x = 4; x <= 12; x++) {
    p.set(x, 5, STEEL[4]);
    p.set(x, 6, STEEL[3]);
  }
  for (let x = 6; x <= 9; x++) for (let y = 8; y <= 10; y++) p.set(x, y, hx('#0a0c0e'));
  const lamp = red ? hx('#ff3a2a') : hx('#4aff7a');
  if (red) {
    p.set(7, 9, lamp);
    p.set(8, 9, lamp);
    p.set(6, 8, lamp);
    p.set(9, 10, lamp);
  } else {
    p.set(6, 9, lamp);
    p.set(7, 9, lamp);
    p.set(8, 9, lamp);
    p.set(8, 8, lamp);
    p.set(8, 10, lamp);
  }
  // Жетоноприёмник.
  p.set(8, 13, hx('#c8a040'));
  p.set(8, 14, hx('#0a0a0a'));
  // Трипод — штанги в проход.
  for (let i = 0; i < 3; i++) {
    const y = 11 + i * 2;
    stroke(p, 11, y, 15, y - 1 + i, STEEL[4], 1);
  }
  p.set(11, 12, STEEL[0]);
  p.outline(INK);
  return p;
}

registerPropPainter('f12_turnstile', (o) => {
  const sim = paintSim();
  const w = sim?.world;
  const red = !!w && w.mark[o.y * w.w + o.x + 1] === MK.locked;
  return sprite(`turn|${red ? 1 : 0}`, () => ({ p: turnstilePx(red), ax: 8, ay: 20 }));
});

// --- Скамья: деревянные рейки на чугунных ногах. ---------------------------

registerPropPainter('f12_bench', (o) =>
  sprite(`bench|${o.x % 2}`, () => {
    const p = new Px(18, 14);
    floorShadow(p, 9, 13, 8);
    const wood = [hx('#2a1a10'), hx('#4a2e1c'), hx('#6a4428'), hx('#8a5c36')];
    // Спинка.
    for (let x = 1; x < 17; x++) {
      p.set(x, 2, wood[3]);
      p.set(x, 3, wood[2]);
      p.set(x, 5, wood[3]);
      p.set(x, 6, wood[1]);
    }
    // Сиденье.
    for (let x = 0; x < 18; x++) {
      p.set(x, 8, wood[3]);
      p.set(x, 9, wood[2]);
      p.set(x, 10, wood[1]);
    }
    // Ноги.
    for (const x of [2, 15]) for (let y = 2; y < 13; y++) p.set(x, y, hx('#1a1a1c'));
    for (const x of [2, 15]) p.set(x, 12, STEEL[2]);
    // Царапина-надпись.
    if (o.x % 2) {
      p.set(7, 9, wood[0]);
      p.set(8, 9, wood[0]);
      p.set(10, 9, wood[0]);
    }
    p.outline(INK);
    return { p, ax: 9, ay: 14 };
  }),
);

// --- Автомат с газировкой: светится, мигает неон. --------------------------

function sodaPx(f: number, dark: boolean): Px {
  const p = new Px(16, 26);
  floorShadow(p, 8, 25, 7);
  polyShade(p, [[2, 3], [14, 3], [14, 24], [2, 24]], tn('#4a0e12', '#7a1a1e', '#a0282a', '#c84a40'));
  // Стекло с бутылками.
  const lit = !dark && f !== 3;
  for (let y = 6; y < 17; y++)
    for (let x = 4; x < 11; x++) {
      const shelf = (y - 6) % 4 === 3;
      let c = lit ? hx('#2a4a4a') : hx('#141c1c');
      if (!shelf && x % 2 === 0) c = lit ? [hx('#5affe0'), hx('#ffd04a'), hx('#ff6a7a')][((x + y) >> 1) % 3] : hx('#20282a');
      if (shelf) c = STEEL[2];
      p.set(x, y, c);
    }
  // Панель, монетоприёмник, лоток.
  for (let y = 6; y < 17; y++) p.set(12, y, STEEL[3]);
  p.set(12, 9, hx('#c8a040'));
  p.set(12, 12, lit ? hx('#ff3a3a') : hx('#3a0a0a'));
  for (let x = 4; x < 12; x++) {
    p.set(x, 19, hx('#0a0a0a'));
    p.set(x, 20, hx('#1a1a1a'));
  }
  // Вывеска сверху.
  for (let x = 3; x < 14; x++) for (let y = 3; y < 5; y++) p.set(x, y, lit ? NEON.teal : NEON.tealD);
  p.outline(INK);
  if (lit) glowDot(p, 8, 4, NEON.teal, 2);
  return p;
}

registerPropPainter('f12_soda', (o, time, _alive, flash) => {
  const dark = inDark(o);
  const f = dark ? 0 : hash(Math.floor(time * 6), o.x, o.y) > 0.93 ? 3 : 0;
  return flashed(`soda|${f}|${dark ? 1 : 0}`, flash, () => ({ p: sodaPx(f, dark), ax: 8, ay: 26 }));
});

// --- Билетный автомат: синий экран с бегущей строкой. -----------------------

registerPropPainter('f12_ticketer', (o, time) => {
  const dark = inDark(o);
  const f = dark ? 9 : Math.floor(time * 4) % 6;
  return sprite(`tick|${f}`, () => {
    const p = new Px(14, 22);
    floorShadow(p, 7, 21, 6);
    polyShade(p, [[2, 4], [12, 4], [12, 20], [2, 20]], [STEEL[1], STEEL[2], STEEL[3], STEEL[4]]);
    for (let y = 6; y < 12; y++)
      for (let x = 4; x < 11; x++) {
        let c = f === 9 ? hx('#0a0e14') : hx('#1a3a7a');
        if (f !== 9 && y === 7 + (f % 4)) c = hx('#7ab8ff');
        if (f !== 9 && y === 10 && (x + f) % 3 === 0) c = hx('#e8f0ff');
        p.set(x, y, c);
      }
    for (let y = 13; y < 17; y++) for (let x = 4; x < 9; x++) p.set(x, y, (x + y) % 2 ? STEEL[4] : STEEL[1]);
    p.set(10, 14, hx('#0a0a0a'));
    p.set(10, 15, hx('#c8a040'));
    for (let x = 3; x < 12; x++) p.set(x, 4, hx('#2a5ab0'));
    p.outline(INK);
    return { p, ax: 7, ay: 22 };
  });
});

// --- Колонна станции: облицовка мрамором, капитель. -------------------------

registerPropPainter('f12_column', (o) =>
  sprite(`col|${(o.x + o.y) % 2}`, () => {
    const p = new Px(14, 40);
    floorShadow(p, 7, 39, 6);
    const marble = tn('#3a3a3c', '#5a5a5e', '#7e7e84', '#a4a4aa');
    for (let y = 4; y < 37; y++)
      for (let x = 3; x < 11; x++) {
        const l = (x - 3) / 7;
        let c = l < 0.2 ? marble[3] : l < 0.5 ? marble[2] : l < 0.85 ? marble[1] : marble[0];
        // Прожилки.
        if (Math.abs(Math.sin(y * 0.4 + x * 0.9 + o.x) - 0.6) < 0.08) c = marble[3];
        p.set(x, y, c);
      }
    // Капитель и база — латунь.
    for (let x = 1; x < 13; x++) {
      p.set(x, 2, GOLD[3]);
      p.set(x, 3, GOLD[2]);
      p.set(x, 4, GOLD[1]);
      p.set(x, 36, GOLD[2]);
      p.set(x, 37, GOLD[1]);
      p.set(x, 38, GOLD[0]);
    }
    // Кровавая ладонь — на одной из двух.
    if ((o.x + o.y) % 2)
      for (const [x, y] of [[6, 20], [7, 19], [8, 20], [7, 21], [7, 22], [5, 19], [9, 19]] as [number, number][])
        p.set(x, y, BLOODC[2]);
    p.outline(INK);
    return { p, ax: 7, ay: 40 };
  }),
);

// --- Урна. -----------------------------------------------------------------

registerPropPainter('f12_bin', (_o, _t, _alive, flash) =>
  flashed('bin', flash, () => {
    const p = new Px(10, 12);
    floorShadow(p, 5, 11, 4);
    shadeEll(p, 5, 7, 3.6, 4, [STEEL[0], STEEL[1], STEEL[2], STEEL[3]]);
    for (let x = 2; x < 9; x++) p.set(x, 3, STEEL[4]);
    p.set(4, 4, hx('#e8e0c8'));
    p.set(6, 3, hx('#b0a080'));
    p.outline(INK);
    return { p, ax: 5, ay: 12 };
  }),
);

// --- Семафор: столб, три линзы; горит та, что по расписанию. ----------------

function semaphorePx(sig: number, blink: boolean): Px {
  const p = new Px(10, 28);
  floorShadow(p, 5, 27, 3);
  for (let y = 10; y < 27; y++) {
    p.set(4, y, STEEL[2]);
    p.set(5, y, STEEL[1]);
  }
  for (let x = 2; x < 8; x++) {
    p.set(x, 26, STEEL[3]);
    p.set(x, 25, STEEL[2]);
  }
  // Голова с тремя линзами и козырьками.
  for (let y = 0; y < 12; y++) for (let x = 2; x < 8; x++) p.set(x, y, hx('#101214'));
  const lens = (y: number, on: boolean, c: RGBA, off: RGBA) => {
    p.set(4, y, on ? c : off);
    p.set(5, y, on ? c : off);
    p.set(4, y + 1, on ? c : off);
    p.set(5, y + 1, on ? mixc(c, WHITE, 0.4) : off);
    p.set(3, y - 1, hx('#2a2c2e'));
    p.set(6, y - 1, hx('#2a2c2e'));
  };
  const red = sig === 2 || sig === 3;
  const yel = sig === 1;
  const grn = sig === 0 || (sig === 4 && blink);
  lens(2, red && (sig !== 3 || blink), hx('#ff2a1a'), hx('#3a0a08'));
  lens(5, yel, hx('#ffc020'), hx('#3a2a08'));
  lens(8, grn, hx('#3aff6a'), hx('#0a2a12'));
  p.outline(INK);
  if (red && (sig !== 3 || blink)) glowDot(p, 5, 3, hx('#ff4a2a'), 2);
  if (yel) glowDot(p, 5, 6, hx('#ffc020'), 2);
  if (grn) glowDot(p, 5, 9, hx('#3aff6a'), 2);
  return p;
}

registerPropPainter('f12_semaphore', (o, time) => {
  const sig = F12_FX.sig.get(`${o.x},${o.y}`) ?? 0;
  const blink = Math.floor(time * 4) % 2 === 0;
  return sprite(`sem|${sig}|${blink ? 1 : 0}`, () => ({ p: semaphorePx(sig, blink), ax: 5, ay: 28 }));
});

// --- Сигнал на стене тоннеля. -----------------------------------------------

registerPropPainter('f12_signal', (o, time) => {
  const sig = F12_FX.sig.get(`${o.x},${o.y}`) ?? 0;
  const blink = Math.floor(time * 4) % 2 === 0;
  return sprite(`wsig|${sig}|${blink ? 1 : 0}`, () => {
    const p = new Px(10, 16);
    for (let y = 3; y < 11; y++) for (let x = 2; x < 8; x++) p.set(x, y, hx('#0c0d0e'));
    const red = sig >= 2 && (sig !== 3 || blink);
    const grn = sig === 0 || (sig === 4 && blink) || sig === 1;
    const rc = red ? hx('#ff2a1a') : hx('#3a0a08');
    const gc = grn ? (sig === 1 ? hx('#ffc020') : hx('#3aff6a')) : hx('#0a2a12');
    p.set(4, 5, rc);
    p.set(5, 5, rc);
    p.set(4, 8, gc);
    p.set(5, 8, gc);
    for (let y = 11; y < 14; y++) p.set(5, y, STEEL[1]);
    p.outline(INK);
    if (red) glowDot(p, 5, 5, hx('#ff3a2a'), 2);
    if (grn) glowDot(p, 5, 8, sig === 1 ? hx('#ffc020') : hx('#3aff6a'), 2);
    return { p, ax: 5, ay: 16 };
  });
});

// --- Каменный фонарь: огонь в окошке дрожит. ---------------------------------

registerPropPainter('f12_lantern', (o, time) => {
  const f = Math.floor(time * 7 + o.x) % 4;
  return sprite(`lant|${f}`, () => {
    const p = new Px(14, 22);
    floorShadow(p, 7, 21, 5);
    const st = tn('#2a2430', '#453c4c', '#625670', '#86789a');
    polyShade(p, [[4, 16], [10, 16], [11, 20], [3, 20]], st);
    polyShade(p, [[6, 11], [8, 11], [8, 16], [6, 16]], st);
    polyShade(p, [[3, 6], [11, 6], [11, 11], [3, 11]], st);
    for (let y = 7; y < 10; y++) for (let x = 5; x < 10; x++) p.set(x, y, hx('#1a0c06'));
    flame(p, 7, 9, 3, 3, f, FIRE, o.x);
    polyShade(p, [[1, 6], [7, 1], [13, 6]], st);
    p.set(7, 0, st[3]);
    p.outline(INK);
    glowDot(p, 7, 8, hx('#ffb040'), 2);
    return { p, ax: 7, ay: 22 };
  });
});

// --- Ворота-тории: красный лак, чёрная перекладина, офуда треплет. -----------

registerPropPainter('f12_torii', (_o, time) => {
  const f = Math.floor(time * 3) % 4;
  return sprite(`torii|${f}`, () => {
    const p = new Px(44, 34);
    // Столбы.
    for (const x0 of [8, 34]) {
      polyShade(p, [[x0, 7], [x0 + 3, 7], [x0 + 3, 33], [x0, 33]], [LACQUER[0], LACQUER[2], LACQUER[3], LACQUER[4]]);
      for (let x = x0 - 1; x < x0 + 5; x++) {
        p.set(x, 32, hx('#1a1012'));
        p.set(x, 33, hx('#0a0608'));
      }
    }
    // Нижняя перекладина и верхняя (касаги) с загнутыми концами.
    for (let x = 6; x < 39; x++) {
      p.set(x, 11, LACQUER[3]);
      p.set(x, 12, LACQUER[1]);
    }
    for (let x = 0; x < 44; x++) {
      const lift = x < 4 ? 4 - x : x > 39 ? x - 39 : 0;
      p.set(x, 3 - Math.min(2, lift), hx('#1a1416'));
      p.set(x, 4 - Math.min(2, lift), hx('#2a2226'));
      p.set(x, 5, LACQUER[2]);
      p.set(x, 6, LACQUER[1]);
    }
    // Табличка по центру.
    for (let y = 6; y < 11; y++) for (let x = 19; x < 25; x++) p.set(x, y, hx('#101010'));
    p.set(21, 7, GOLD[3]);
    p.set(22, 8, GOLD[3]);
    p.set(21, 9, GOLD[2]);
    // Офуда на верёвке: колышется.
    for (let x = 10; x < 34; x += 4) {
      const sway = Math.round(Math.sin(f * 1.6 + x) * 1);
      for (let y = 13; y < 18; y++) p.set(x + (y > 15 ? sway : 0), y, PAPER[y === 13 ? 1 : 3]);
      p.set(x + sway, 16, hx('#b01a20'));
    }
    for (let x = 9; x < 35; x++) p.set(x, 13, hx('#6a5a40'));
    p.outline(INK);
    return { p, ax: 22, ay: 34 };
  });
});

// --- Свечи: воск, наплывы, пламя. -------------------------------------------

registerPropPainter('f12_candles', (o, time) => {
  const f = Math.floor(time * 8 + o.y) % 4;
  return sprite(`cand|${f}|${o.x % 2}`, () => {
    const p = new Px(14, 14);
    floorShadow(p, 7, 13, 6);
    const wax = tn('#8a806a', '#c0b69a', '#e0d8bc', '#f8f2e0');
    const set: [number, number][] = o.x % 2 ? [[3, 6], [6, 8], [9, 5], [11, 9]] : [[2, 8], [5, 5], [8, 7], [11, 6]];
    set.forEach(([x, h], i) => {
      polyShade(p, [[x, 13 - h], [x + 1, 13 - h], [x + 1, 12], [x, 12]], wax);
      p.set(x, 13 - h + 1, wax[3]);
      flame(p, x + 0.5, 12 - h, 2, 3, (f + i) % 4, FIRE, x);
    });
    // Натёкший воск.
    for (let x = 1; x < 13; x++) p.set(x, 12, wax[1]);
    p.outline(INK);
    return { p, ax: 7, ay: 14 };
  });
});

// --- Груда костей. -----------------------------------------------------------

registerPropPainter('f12_bonepile', (o) =>
  sprite(`bpile|${o.x % 3}`, () => {
    const p = new Px(16, 12);
    floorShadow(p, 8, 11, 7);
    const b = [BONE[0], BONE[1], BONE[2], BONE[3]] as Tones;
    for (let i = 0; i < 6; i++) {
      const x0 = 2 + hash(o.x, i, 1) * 10;
      const y0 = 5 + hash(o.y, i, 2) * 5;
      limb(p, x0, y0, x0 + 3 + hash(i, o.x) * 3, y0 - 1 + hash(i, o.y) * 2, 0.8, 0.8, b);
    }
    shadeEll(p, 8, 5, 3, 2.6, b);
    p.set(7, 5, INK);
    p.set(9, 5, INK);
    p.set(8, 7, INK);
    p.outline(INK);
    return { p, ax: 8, ay: 12 };
  }),
);

// --- Жертвенник: каменный стол, чаша тёмной жидкости, дым курильницы. --------

registerPropPainter('f12_altar', (o, time) => {
  const f = Math.floor(time * 4 + o.x) % 6;
  return sprite(`altar|${f}`, () => {
    const p = new Px(20, 26);
    floorShadow(p, 10, 25, 9);
    const st = tn('#1e1822', '#342a3a', '#4a3e54', '#66587a');
    polyShade(p, [[2, 13], [18, 13], [17, 24], [3, 24]], st);
    for (let x = 1; x < 19; x++) {
      p.set(x, 12, st[3]);
      p.set(x, 13, st[2]);
    }
    // Резьба: пасть.
    for (let x = 6; x < 14; x++) p.set(x, 19, x % 2 ? BONE[2] : INK);
    p.set(7, 16, hx('#ff2a3a'));
    p.set(12, 16, hx('#ff2a3a'));
    // Чаша.
    shadeEll(p, 10, 11, 4, 1.8, tn('#3a2a10', '#6a4a1a', '#a07a2a', '#e0c060'));
    for (let x = 8; x < 13; x++) p.set(x, 11, BLOODC[2]);
    // Дым вверх.
    for (let i = 0; i < 6; i++) {
      const y = 9 - i * 1.5 - (f % 3) * 0.5;
      const x = 10 + Math.sin(i * 0.9 + f * 0.7) * (1 + i * 0.4);
      if (y < 0) continue;
      p.set(Math.round(x), Math.round(y), alpha(hx('#9a8aa0'), 0.6 - i * 0.08));
    }
    p.outline(INK);
    return { p, ax: 10, ay: 26 };
  });
});

// --- Упор в конце пути: бело-красный щит. ------------------------------------

registerPropPainter('f12_buffer', () =>
  sprite('buffer', () => {
    const p = new Px(16, 16);
    floorShadow(p, 8, 15, 7);
    for (let y = 4; y < 15; y++) {
      p.set(2, y, STEEL[2]);
      p.set(13, y, STEEL[1]);
    }
    for (let y = 3; y < 9; y++)
      for (let x = 2; x < 14; x++) p.set(x, y, Math.floor((x + y) / 2) % 2 ? hx('#e8e0d0') : hx('#c02020'));
    stroke(p, 3, 9, 7, 14, STEEL[1], 1);
    stroke(p, 12, 9, 9, 14, STEEL[1], 1);
    p.outline(INK);
    return { p, ax: 8, ay: 16 };
  }),
);

// --- Кабельный барабан. -------------------------------------------------------

registerPropPainter('f12_drum', (_o, _t, _alive, flash) =>
  flashed('drum', flash, () => {
    const p = new Px(14, 14);
    floorShadow(p, 7, 13, 6);
    const wood = tn('#2a1a10', '#4a2e1c', '#6a4428', '#8a5c36');
    shadeEll(p, 7, 7, 6, 6, wood);
    shadeEll(p, 7, 7, 3.5, 3.5, tn('#0a0a0a', '#1a1a1e', '#2a2a30', '#3a3a44'));
    shadeEll(p, 7, 7, 1.4, 1.4, wood);
    for (let a = 0; a < 6; a++) p.set(Math.round(7 + Math.cos(a) * 5), Math.round(7 + Math.sin(a) * 5), wood[0]);
    p.outline(INK);
    return { p, ax: 7, ay: 14 };
  }),
);

// --- Искрящий кабель: оборванный, бьёт искрами. ------------------------------

registerPropPainter('f12_spark', (o, time) => {
  const f = Math.floor(time * 10 + o.x) % 8;
  return sprite(`spark|${f}`, () => {
    const p = new Px(14, 20);
    // Кабель свисает со свода.
    for (let y = 0; y < 14; y++) {
      const x = 7 + Math.round(Math.sin(y * 0.4) * 1.5);
      p.set(x, y, hx('#0e0e10'));
      p.set(x + 1, y, hx('#222226'));
    }
    const on = f < 3;
    if (on) {
      const c = [hx('#fff8c0'), hx('#a8e0ff'), hx('#ffffff')];
      for (let i = 0; i < 6; i++) {
        const a = hash(f, i, 3) * TAU;
        const r = 1 + hash(i, f) * 4;
        p.set(Math.round(8 + Math.cos(a) * r), Math.round(14 + Math.sin(a) * r * 0.7), c[i % 3]);
      }
      glowDot(p, 8, 14, hx('#a8e0ff'), 2);
    }
    p.set(8, 14, on ? WHITE : hx('#6a4a2a'));
    return { p, ax: 7, ay: 20 };
  });
});

// --- Дрезина. -------------------------------------------------------------------

registerPropPainter('f12_handcar', () =>
  sprite('handcar', () => {
    const p = new Px(22, 16);
    floorShadow(p, 11, 15, 10);
    polyShade(p, [[2, 8], [20, 8], [20, 12], [2, 12]], tn('#2a1a10', '#4a2e1c', '#6a4428', '#8a5c36'));
    for (const x of [5, 17]) shadeEll(p, x, 13, 2.2, 2.2, [STEEL[0], STEEL[1], STEEL[2], STEEL[3]]);
    // Коромысло насоса.
    stroke(p, 11, 8, 11, 3, STEEL[2], 1);
    stroke(p, 5, 2, 17, 4, STEEL[3], 1);
    p.set(5, 2, hx('#c02020'));
    p.set(17, 4, hx('#c02020'));
    p.outline(INK);
    return { p, ax: 11, ay: 16 };
  }),
);

// --- Газетный киоск: стекло, журналы, вывеска. -------------------------------

registerPropPainter('f12_kiosk', (o) => {
  const dark = inDark(o);
  return sprite(`kiosk|${dark ? 1 : 0}`, () => {
    const p = new Px(18, 26);
    floorShadow(p, 9, 25, 8);
    polyShade(p, [[1, 6], [17, 6], [17, 24], [1, 24]], [STEEL[0], STEEL[1], STEEL[2], STEEL[3]]);
    for (let y = 8; y < 18; y++)
      for (let x = 3; x < 15; x++) {
        const mag = [hx('#c04040'), hx('#3a6ab0'), hx('#d8c040'), hx('#e8e0d0'), hx('#40a060')][(x * 3 + (y >> 2)) % 5];
        p.set(x, y, dark ? shade(mag, 0.35) : mag);
      }
    for (let x = 3; x < 15; x++) {
      p.set(x, 12, STEEL[1]);
      p.set(x, 18, STEEL[3]);
    }
    // Вывеска «ПРЕССА».
    for (let x = 0; x < 18; x++) for (let y = 1; y < 6; y++) p.set(x, y, hx('#1a2a5a'));
    text(p, 'ПРЕ', 3, 1, dark ? hx('#5a6a8a') : hx('#f0f0e0'));
    p.outline(INK);
    return { p, ax: 9, ay: 26 };
  });
});

// --- Стрелочный рычаг (действие): переведён — ручка лежит. -------------------

registerPropPainter('f12_lever', (_o, time) => {
  const thrown = F12_FX.lever > F12_FX.time;
  const blink = Math.floor(time * 3) % 2 === 0;
  return sprite(`lever|${thrown ? 1 : 0}|${blink ? 1 : 0}`, () => {
    const p = new Px(16, 22);
    floorShadow(p, 8, 21, 6);
    polyShade(p, [[3, 14], [13, 14], [13, 20], [3, 20]], [STEEL[0], STEEL[1], STEEL[2], STEEL[3]]);
    // Рукоять: стоит или брошена.
    const [tx, ty] = thrown ? [14, 12] : [5, 2];
    stroke(p, 8, 15, tx, ty, STEEL[3], 2);
    for (let i = 0; i < 3; i++) p.set(tx + (thrown ? -i : i), ty + (thrown ? 0 : i), i % 2 ? WHITE : hx('#c02020'));
    // Лампа на коробе: мигает, пока рычаг можно тронуть.
    p.set(11, 16, !thrown && blink ? hx('#ffd040') : hx('#5a4a10'));
    for (let x = 4; x < 12; x++) p.set(x, 18, x % 2 ? YELLOW[2] : INK);
    p.outline(INK);
    if (!thrown && blink) glowDot(p, 11, 16, hx('#ffd040'), 1);
    return { p, ax: 8, ay: 22 };
  });
});

// --- Колокол дежурной (действие): столбик, красная кнопка, звонок. -----------

registerPropPainter('f12_bell', (_o, time) => {
  const blink = Math.floor(time * 2.5) % 2 === 0;
  return sprite(`bell|${blink ? 1 : 0}`, () => {
    const p = new Px(12, 24);
    floorShadow(p, 6, 23, 4);
    for (let y = 6; y < 23; y++) {
      p.set(5, y, STEEL[3]);
      p.set(6, y, STEEL[1]);
    }
    polyShade(p, [[2, 7], [10, 7], [10, 14], [2, 14]], tn('#3a0a0a', '#7a1a1a', '#a82a24', '#d04a3a'));
    shadeEll(p, 6, 10, 2, 2, tn('#5a4410', '#9a7a20', '#d8b040', '#fff0a0'));
    // Звонок сверху.
    shadeEll(p, 6, 4, 3, 2.4, tn('#5a4410', '#9a7a20', '#d8b040', '#fff0a0'));
    p.set(6, 1, STEEL[2]);
    p.outline(INK);
    if (blink) glowDot(p, 6, 10, hx('#ffd060'), 1);
    return { p, ax: 6, ay: 24 };
  });
});

// --- Настенное: часы, неон, лампа, щиток, торшер балюстрады. -----------------

registerPropPainter('f12_clock', (o, time) => {
  // Часы станции идут, но не туда: стрелка минут бежит, часовая — назад.
  const m = Math.floor(time / 1.2 + o.x) % 12;
  const hh = (12 - (Math.floor(time / 9) % 12)) % 12;
  return sprite(`clock|${m}|${hh}`, () => {
    const p = new Px(14, 16);
    shadeEll(p, 7, 7, 5.5, 5.5, [STEEL[0], STEEL[1], STEEL[3], STEEL[4]]);
    shadeEll(p, 7, 7, 4.2, 4.2, tn('#b8b0a0', '#d8d0c0', '#ece6d8', '#fffcf0'));
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      p.set(Math.round(7 + Math.cos(a) * 3.6), Math.round(7 + Math.sin(a) * 3.6), hx('#4a4038'));
    }
    const am = (m / 12) * TAU - Math.PI / 2;
    const ah = (hh / 12) * TAU - Math.PI / 2;
    stroke(p, 7, 7, 7 + Math.cos(am) * 3.6, 7 + Math.sin(am) * 3.6, INK, 1);
    stroke(p, 7, 7, 7 + Math.cos(ah) * 2.2, 7 + Math.sin(ah) * 2.2, hx('#8a1414'), 1);
    p.set(7, 7, hx('#8a1414'));
    p.outline(INK);
    return { p, ax: 7, ay: 16 };
  });
});

registerPropPainter('f12_neon', (o, time) => {
  const dark = inDark(o);
  const f = dark ? 2 : hash(Math.floor(time * 8), o.x, o.y) > 0.9 ? 1 : 0;
  const kind = (o.x + o.y) % 2;
  return sprite(`neon|${kind}|${f}`, () => {
    const p = new Px(16, 16);
    const on = f === 0;
    const c = kind ? NEON.pink : NEON.teal;
    const d = kind ? NEON.pinkD : NEON.tealD;
    const col = on ? c : f === 1 ? mixc(c, d, 0.6) : shade(d, 0.5);
    // Буква «М» метро или стрелка «выход».
    const pts: [number, number][][] = kind
      ? [
          [[3, 11], [3, 4], [8, 9], [13, 4], [13, 11]],
        ]
      : [
          [[2, 8], [12, 8]],
          [[9, 5], [12, 8], [9, 11]],
        ];
    for (const line of pts)
      for (let i = 0; i < line.length - 1; i++) stroke(p, line[i][0], line[i][1], line[i + 1][0], line[i + 1][1], col, 1);
    if (on) {
      const glow = new Px(16, 16);
      for (let y = 0; y < 16; y++)
        for (let x = 0; x < 16; x++) {
          if (p.solid(x, y)) continue;
          let n = 0;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (p.solid(x + dx, y + dy)) n++;
          if (n) glow.set(x, y, alpha(c, 0.35));
        }
      over(glow, p);
      return { p: glow, ax: 8, ay: 16 };
    }
    return { p, ax: 8, ay: 16 };
  });
});

registerPropPainter('f12_tube', (o, time) => {
  const dark = inDark(o);
  const f = dark ? 2 : hash(Math.floor(time * 10), o.x * 3, o.y) > 0.95 ? 1 : 0;
  return sprite(`tube|${f}`, () => {
    const p = new Px(16, 16);
    for (let x = 1; x < 15; x++) {
      p.set(x, 5, STEEL[1]);
      p.set(x, 6, f === 2 ? hx('#3a4044') : f === 1 ? hx('#9ab0b0') : hx('#f0fff8'));
      p.set(x, 7, f === 2 ? hx('#2a2e30') : hx('#b8d8d0'));
    }
    p.set(1, 6, STEEL[0]);
    p.set(14, 6, STEEL[0]);
    if (f === 0) for (let x = 2; x < 14; x++) p.set(x, 8, alpha(hx('#c8f0e8'), 0.35));
    return { p, ax: 8, ay: 16 };
  });
});

registerPropPainter('f12_breaker', (_o, time) => {
  const sim = paintSim();
  const dark = !!F12_FX.dark && !!sim;
  const blink = Math.floor(time * 3) % 2 === 0;
  return sprite(`brk|${dark ? 1 : 0}|${blink ? 1 : 0}`, () => {
    const p = new Px(14, 16);
    polyShade(p, [[2, 2], [12, 2], [12, 13], [2, 13]], [STEEL[0], STEEL[1], STEEL[2], STEEL[3]]);
    for (let x = 3; x < 12; x++) p.set(x, 3, YELLOW[2]);
    // Молния-знак.
    stroke(p, 8, 5, 6, 8, INK, 1);
    stroke(p, 6, 8, 8, 8, INK, 1);
    stroke(p, 8, 8, 6, 11, INK, 1);
    // Рубильник: вниз — нет света.
    stroke(p, 10, 8, 10, dark ? 11 : 5, STEEL[4], 1);
    p.set(10, dark ? 11 : 5, hx('#c02020'));
    const led = dark ? (blink ? hx('#ff3a2a') : hx('#5a0a0a')) : hx('#3aff6a');
    p.set(4, 11, led);
    p.outline(INK);
    if (dark && blink) glowDot(p, 4, 11, hx('#ff3a2a'), 1);
    return { p, ax: 7, ay: 16 };
  });
});

registerPropPainter('f12_torch', (o) => {
  const dark = inDark(o);
  return sprite(`torch|${dark ? 1 : 0}`, () => {
    const p = new Px(10, 30);
    // Бронзовый стебель над балюстрадой.
    for (let y = 8; y < 26; y++) {
      p.set(4, y, GOLD[2]);
      p.set(5, y, GOLD[1]);
    }
    for (let x = 2; x < 8; x++) p.set(x, 26, GOLD[1]);
    // Плафон — матовый цилиндр.
    for (let y = 0; y < 8; y++)
      for (let x = 2; x < 8; x++) p.set(x, y, dark ? hx('#5a5040') : x === 3 ? hx('#fff8e0') : hx('#f0d898'));
    for (let x = 2; x < 8; x++) {
      p.set(x, 0, GOLD[3]);
      p.set(x, 7, GOLD[2]);
    }
    p.outline(INK);
    if (!dark) glowDot(p, 5, 4, hx('#ffe0a0'), 2);
    return { p, ax: 5, ay: 30 };
  });
});

// ===========================================================================
// Монстры. Кадр смотрит вправо; «земля» — ряд `ay`.
// ===========================================================================

// ---------------------------------------------------------------------------
// Рой мух: облако чёрных мух вокруг сгустка с зелёным глазом.
// Кадр 22×18, земля — ряд 17 (летает: движок поднимет выше).
// ---------------------------------------------------------------------------

interface FlyPose {
  /** Радиус облака. */
  spread: number;
  /** Сдвиг облака вперёд (укус). */
  lunge: number;
  f: number;
  /** Смерть: мухи падают, 0…3. */
  fall: number;
  glow: number;
}

function drawFlies(fp: FlyPose): Built {
  const p = new Px(22, 18);
  const cx = 10 + fp.lunge;
  const cy = 8;
  const body = hx('#0e0e0a');
  const wing = alpha(hx('#e4ecd8'), 0.8);
  if (fp.fall > 0) {
    for (let i = 0; i < 10; i++) {
      const x = Math.round(3 + hash(i, 1) * 16);
      const y = Math.round(Math.min(16, 6 + hash(i, 2) * 6 + fp.fall * 3));
      p.set(x, y, body);
      p.set(x + 1, y, body);
    }
    return { p, ax: 11, ay: 17, eye: null };
  }
  // Сгусток: мухи вповалку.
  shadeEll(p, cx, cy, 3.8 - fp.spread * 0.2, 3, tn('#050504', '#12120e', '#22221a', '#3a3a2a'));
  for (let i = 0; i < 15; i++) {
    const a = hash(i, 5) * TAU + fp.f * (0.9 + hash(i, 6) * 0.6) * (i % 2 ? 1 : -1);
    const r = fp.spread * (0.55 + hash(i, 7) * 0.55);
    const x = Math.round(cx + Math.cos(a) * r * 1.3);
    const y = Math.round(cy + Math.sin(a) * r * 0.8);
    p.set(x, y, body);
    p.set(x + 1, y, body);
    if ((fp.f + i) % 2) {
      p.set(x, y - 1, wing);
      p.set(x + 1, y - 1, wing);
    }
  }
  p.outline(alpha(INK, 0.7));
  // Трупная дымка вокруг роя — чтобы рой читался на тёмном полу (за мухами).
  p.ell(cx, cy, 7, 5, (x, y) => (p.solid(x, y) ? p.get(x, y) : alpha(hx('#7aa04a'), 0.16)));
  // Глаз проклятия в сгустке.
  const eye = hx('#c8ff5a');
  p.set(Math.round(cx) + 1, cy - 1, fp.glow > 0.5 ? WHITE : eye);
  p.set(Math.round(cx) + 2, cy - 1, eye);
  return { p, ax: 11, ay: 17, eye: [Math.round(cx) + 1, cy - 1] };
}

registerMobPainter('f12_flies', (m: Mob, pose: MobPose) => {
  const f = pose.frame % 6;
  let anim = 'idle';
  let fr = f;
  let fp: FlyPose = { spread: 5, lunge: 0, f, fall: 0, glow: 0 };
  if (pose.mode === 'dying') {
    anim = 'dead';
    fr = Math.min(3, Math.floor(pose.t / 0.15) + 1);
    fp = { ...fp, fall: fr };
  } else if (pose.mode === 'windup') {
    anim = 'wind';
    fr = f % 2;
    fp = { ...fp, spread: 2.5, glow: 1 };
  } else if (pose.mode === 'recover' && pose.t < 0.2) {
    anim = 'bite';
    fr = 0;
    fp = { ...fp, spread: 3.5, lunge: 4 };
  } else if (pose.anim === 'hurt') {
    anim = 'hurt';
    fr = f % 2;
    fp = { ...fp, spread: 7 };
  }
  return frameOf('f12_flies', pose, anim, fr, () => drawFlies(fp));
  void m;
});

// ---------------------------------------------------------------------------
// Многоликий: глыба плоти, в которую вросли лица. Кадр 32×32, земля — 30.
// ---------------------------------------------------------------------------

const FLESH = tn('#3a2c38', '#5e4a5a', '#83697c', '#a68c9e');
const FACE = tn('#8a7a70', '#b8a494', '#d8c6b4', '#f0e2d0');

interface FacePose {
  bob: number;
  lean: number;
  arms: number;
  mouth: number;
  step: number;
  slam?: boolean;
}

function faceAt(p: Px, x: number, y: number, s: number, mouth: number, glow: boolean): void {
  shadeEll(p, x, y, 2 * s, 2.4 * s, FACE);
  // Глазницы и брови домиком — лица страдают; в крике глаза горят.
  const ey = y - 0.6 * s;
  for (const sx of [-1, 1]) {
    const ex = x + sx * 0.9 * s;
    p.set(ex, ey, glow ? hx('#ffe0a0') : INK);
    if (s >= 1.2) p.set(ex + sx * 0.6, ey, glow ? hx('#ff9a50') : INK);
    p.set(ex + sx * 0.7 * s, ey - 1, shade(FACE[0], 0.75));
  }
  if (mouth > 0) {
    const mh = Math.max(1.2, mouth * 1.8 * s);
    const mw = Math.max(0.9, 0.6 * s + mouth * 0.5);
    p.ell(x, y + 1.1 * s + mh * 0.3, mw, mh * 0.6, INK);
    if (mh > 1.6) p.ell(x, y + 1.2 * s + mh * 0.38, mw * 0.55, mh * 0.34, hx('#8a0a1a'));
  } else {
    p.set(x - 0.6, y + 1.1 * s, shade(FACE[0], 0.6));
    p.set(x + 0.6, y + 1.1 * s, shade(FACE[0], 0.6));
  }
}

function drawManyface(fp: FacePose): Built {
  const p = new Px(32, 32);
  const G = 30;
  const cx = 15 + fp.lean;
  const cy = 18 + fp.bob;
  // Ноги-тумбы.
  limb(p, cx - 4, cy + 6, cx - 5 - fp.step, G - 1, 2.6, 2.2, FLESH);
  limb(p, cx + 4, cy + 6, cx + 5 + fp.step, G - 1, 2.6, 2.2, FLESH);
  // Дальняя рука.
  const ay = fp.slam ? cy - 12 : cy - 2 + fp.arms * -6;
  limb(p, cx - 7, cy - 3, cx - 11, ay + 6, 2.4, 2, tn('#2a1e28', '#4a3a48', '#6a5666', '#8a7486'));
  // Тело: бугристая глыба.
  shadeEll(p, cx, cy, 10, 10.5, FLESH);
  shadeEll(p, cx - 4, cy - 6, 5, 4.5, FLESH, 0.1);
  shadeEll(p, cx + 5, cy - 5, 4.5, 4, FLESH, 0.05);
  // Лица по телу.
  const glow = fp.mouth > 0.5;
  faceAt(p, cx + 3, cy - 7, 1.35, fp.mouth, glow);
  faceAt(p, cx - 4, cy - 4, 1, fp.mouth * 0.8, glow);
  faceAt(p, cx + 6, cy + 1, 1, fp.mouth, glow);
  faceAt(p, cx - 2, cy + 3, 1.1, fp.mouth * 0.9, glow);
  faceAt(p, cx - 7, cy + 2, 0.8, fp.mouth * 0.6, glow);
  // Ближняя рука с кулачищем.
  const hx0 = fp.slam ? cx + 5 : cx + 10;
  const hy0 = fp.slam ? cy - 13 : cy + 3 - fp.arms * 6;
  limb(p, cx + 8, cy - 3, hx0, hy0, 2.6, 2.4, FLESH);
  shadeEll(p, hx0, hy0, 3, 2.6, FLESH, 0.08);
  p.outline(INK);
  return { p, ax: cx, ay: G, eye: [Math.round(cx + 3 + 1.1), Math.round(cy - 7 - 0.7)] };
}

registerMobPainter('f12_manyface', (m: Mob, pose: MobPose) => {
  const mode = pose.mode;
  const f = pose.frame;
  let anim = 'idle';
  let fr = 0;
  let fp: FacePose = { bob: 0, lean: 0, arms: 0, mouth: 0, step: 0 };
  if (mode === 'dying') {
    anim = 'dead';
    fr = deathK(pose);
    fp = { ...fp, bob: 3, mouth: 1 };
  } else if (mode === 'f12_slam') {
    anim = 'slam';
    fr = pose.t < 0.5 ? 0 : 1;
    fp = { ...fp, slam: true, bob: fr ? -1 : 1, lean: -1, mouth: 0.4 };
  } else if (mode === 'recover' && pose.t < 0.25) {
    anim = 'hit';
    fp = { ...fp, bob: 2, lean: 2, arms: -1, mouth: 0.6 };
  } else if (mode === 'f12_scream') {
    anim = 'scream';
    fr = Math.min(2, Math.floor(pose.t / 0.35));
    fp = { ...fp, bob: -fr, mouth: 0.4 + fr * 0.3, arms: 0.8 };
  } else if (mode === 'f12_after') {
    anim = 'after';
    fr = Math.floor(pose.t * 5) % 2;
    fp = { ...fp, bob: 2, mouth: 0.5 + fr * 0.3, arms: -0.5, lean: 1 };
  } else if (pose.anim === 'run') {
    anim = 'run';
    fr = f % 4;
    fp = { ...fp, bob: fr % 2 ? -1 : 0, lean: fr < 2 ? 1 : -1, step: fr === 0 ? 2 : fr === 2 ? -2 : 0 };
  } else if (pose.anim === 'hurt') {
    anim = 'hurt';
    fp = { ...fp, bob: 1, lean: -2, mouth: 0.6 };
  } else {
    fr = f % 4;
    fp = { ...fp, bob: fr === 1 || fr === 2 ? 1 : 0, mouth: fr === 3 ? 0.2 : 0 };
  }
  return frameOf('f12_manyface', pose, anim, fr, () => {
    const b = drawManyface(fp);
    if (anim === 'dead') b.p = ashen(b.p, fr, m.id % 7);
    return b;
  });
});

// ---------------------------------------------------------------------------
// Длиннорукий: из трещины — рука через проход. Кадр строится вокруг трещины.
// ---------------------------------------------------------------------------

const ARMSKIN = tn('#3e4a3e', '#63705e', '#8a987e', '#b0bca0');

function drawLongarm(len: number, ang: number, open: number, grip: boolean, limp: boolean): { p: Px; ox: number; oy: number } {
  // Холст с запасом во все стороны: начало руки — в центре.
  const R = Math.ceil(len * 16) + 14;
  const S = R * 2 + 2;
  const p = new Px(S, S);
  const ox = R + 1;
  const oy = R + 1;
  // Глаза и пасть в трещине.
  for (const dx of [-2, 2]) {
    p.set(ox + dx, oy - 3, hx('#ff3a2a'));
    p.set(ox + dx, oy - 2, hx('#7a0a0a'));
  }
  if (open > 0) for (let x = -3; x <= 3; x++) p.set(ox + x, oy + 1, x % 2 ? hx('#e8e0d0') : INK);
  if (len > 0.05) {
    const L = len * 16;
    const ex = ox + Math.cos(ang) * L;
    const ey = oy + Math.sin(ang) * L;
    // Локоть — лишний сустав, рука гнётся не туда.
    const mx = ox + Math.cos(ang) * L * 0.5 + Math.cos(ang + Math.PI / 2) * (limp ? 1 : 3);
    const my = oy + Math.sin(ang) * L * 0.5 + Math.sin(ang + Math.PI / 2) * (limp ? 1 : 3);
    limb(p, ox, oy, mx, my, 2.7, 2.1, ARMSKIN);
    limb(p, mx, my, ex, ey, 2.1, 1.6, ARMSKIN);
    shadeEll(p, mx, my, 2.4, 2.4, ARMSKIN, -0.1);
    // Жилы вдоль руки.
    for (let k = 0.15; k < 0.95; k += 0.14) {
      const x = ox + (ex - ox) * k + Math.cos(ang + Math.PI / 2) * 0.8;
      const y = oy + (ey - oy) * k + Math.sin(ang + Math.PI / 2) * 0.8;
      p.set(Math.round(x), Math.round(y), shade(ARMSKIN[0], 0.8));
    }
    // Кисть: широкая ладонь и длинные пальцы веером (или сжатые).
    shadeEll(p, ex, ey, 3.2, 3, ARMSKIN, 0.1);
    for (let i = -2; i <= 2; i++) {
      const a = ang + i * (grip ? 0.28 : 0.45);
      const fl = grip ? 3.2 : 6.5 - Math.abs(i) * 0.8;
      const sx = ex + Math.cos(a) * 2;
      const sy = ey + Math.sin(a) * 2;
      limb(p, sx, sy, sx + Math.cos(a) * fl, sy + Math.sin(a) * fl, 0.9, 0.7, ARMSKIN, 0.1);
      p.set(Math.round(sx + Math.cos(a) * (fl + 0.6)), Math.round(sy + Math.sin(a) * (fl + 0.6)), hx('#d8d0b8'));
    }
  }
  p.outline(INK);
  return { p, ox, oy };
}

registerMobPainter('f12_longarm', (m: Mob, pose: MobPose) => {
  const wx = m.data.wx ?? m.x;
  const wy = m.data.wy ?? m.y - 1;
  // Начало руки — у края стены в сторону пола.
  const bx = (wx + (m.hx - wx) * 0.45 - m.x) * 16;
  const by = (wy + (m.hy - wy) * 0.45 - m.y) * 16;
  const mode = pose.mode;
  let len = 0;
  let open = 0;
  let grip = false;
  let limp = false;
  let ang = m.data.ang ?? Math.atan2(m.hy - wy, m.hx - wx);
  if (mode === 'aim') {
    len = Math.min(1.1, pose.t * 1.6);
    open = 0.5;
  } else if (mode === 'f12_maul') {
    len = Math.max(0.5, Math.hypot(m.hx - wx, m.hy - wy) * 0.7);
    ang = Math.atan2(m.hy - wy, m.hx - wx);
    grip = true;
    open = 1;
  } else if (mode === 'f12_reach') {
    len = Math.max(0.6, 4.4 * (1 - Math.max(0, pose.t - 1.2) / 0.5));
    limp = true;
    open = 0.3;
  } else if (mode === 'dying') {
    len = 2;
    limp = true;
  }
  const la = Math.round((ang / TAU) * 16) & 15;
  const ll = Math.round(len * 3);
  const qa = (la / 16) * TAU;
  const key = `${la}|${ll}|${open > 0.6 ? 2 : open > 0 ? 1 : 0}|${grip ? 1 : 0}|${limp ? 1 : 0}`;
  const fr = frameOf('f12_longarm', { ...pose, left: false }, key, mode === 'dying' ? deathK(pose) : 0, () => {
    const { p, ox, oy } = drawLongarm(ll / 3, qa, open, grip, limp);
    const b: Built = { p, ax: ox, ay: oy, eye: [ox + 2, oy - 3] };
    if (mode === 'dying') b.p = ashen(b.p, deathK(pose), m.id % 5);
    return b;
  });
  // Кадр привязан к трещине: сдвигаем опору к точке моба.
  return { img: fr.img, ax: fr.ax - bx, ay: fr.ay - by - 2, eye: fr.eye };
});

// ---------------------------------------------------------------------------
// Спящий пассажир: сидит, сгорбившись; проснулся — голова раскрывается пастью.
// Кадр 20×26, земля — 24.
// ---------------------------------------------------------------------------

const COAT = tn('#1c2028', '#2c3240', '#3e4658', '#56607a');
const SKINS = tn('#5a524c', '#847a70', '#a89c90', '#c8bcae');

interface SleepPose {
  sit: boolean;
  /** Пасть: 0 — лицо, 1 — раскрыта. */
  maw: number;
  head: [number, number];
  crouch: number;
  legs: [number, number];
  arms: number;
  lunge?: boolean;
  z?: number;
}

function drawSleeper(sp: SleepPose): Built {
  const p = new Px(26, 26);
  const G = 24;
  if (sp.sit) {
    // Сидит на полу у скамьи, колени к груди, голова на коленях.
    limb(p, 8, G - 3, 14, G - 6, 2.2, 1.8, COAT);
    limb(p, 14, G - 6, 15, G - 1, 1.6, 1.4, COAT);
    shadeEll(p, 8, G - 8, 4, 5, COAT);
    limb(p, 9, G - 11, 13, G - 7, 1.4, 1.2, COAT);
    const [hx0, hy0] = sp.head;
    shadeEll(p, hx0, hy0, 3, 3, SKINS);
    // Кепка козырьком вниз.
    for (let x = hx0 - 3; x <= hx0 + 3; x++) {
      p.set(x, hy0 - 3, hx('#14161c'));
      p.set(x, hy0 - 2, hx('#22262e'));
    }
    p.set(hx0 + 3, hy0 - 1, hx('#14161c'));
    p.set(hx0 + 4, hy0 - 1, hx('#14161c'));
    // Газета на коленях.
    for (let x = 11; x < 16; x++) p.set(x, G - 7, hx('#d8d0b8'));
    p.outline(INK);
    // «З-з-з» — пар дыхания.
    if (sp.z !== undefined) {
      const zy = hy0 - 6 - sp.z;
      p.set(hx0 + 4, zy, alpha(hx('#c8d0e0'), 0.8));
      p.set(hx0 + 5, zy, alpha(hx('#c8d0e0'), 0.8));
      p.set(hx0 + 5, zy + 1, alpha(hx('#c8d0e0'), 0.8));
      p.set(hx0 + 4, zy + 2, alpha(hx('#c8d0e0'), 0.8));
      p.set(hx0 + 5, zy + 2, alpha(hx('#c8d0e0'), 0.8));
    }
    return { p, ax: 10, ay: G, eye: null };
  }
  const c = sp.crouch;
  const hipY = G - 9 + c;
  // Ноги.
  limb(p, 9, hipY, 8 + sp.legs[0] * 2, G - 1, 1.6, 1.3, COAT, -0.1);
  limb(p, 11, hipY, 12 + sp.legs[1] * 2, G - 1, 1.6, 1.3, COAT);
  // Полы пальто.
  poly(p, [[7, hipY - 2], [13, hipY - 2], [15 + c * 0.5, hipY + 4], [5, hipY + 4]], COAT[1]);
  // Туловище, сгорбленное вперёд.
  limb(p, 10, hipY, 12 + c * 0.8, hipY - 7 + c * 0.5, 3.2, 3, COAT);
  // Руки длинные, висят до земли.
  limb(p, 12, hipY - 6, 16 + sp.arms * 2, hipY + 2 - sp.arms * 2, 1.3, 1.1, COAT);
  const [hx0, hy0] = sp.head;
  // Голова: раскалывается вертикальной пастью — половины расходятся.
  const spread = Math.round(sp.maw * 1.2);
  shadeEll(p, hx0, hy0, 3.2 + spread, 3.4, SKINS);
  if (sp.maw > 0) {
    const w = 0.5 + sp.maw * 1.5;
    for (let y = hy0 - 3; y <= hy0 + 3; y++) {
      const half = w * (1 - Math.abs(y - hy0) / 3.8);
      const x0 = Math.round(hx0 - half);
      const x1 = Math.round(hx0 + half);
      for (let x = x0; x <= x1; x++) p.set(x, y, hx('#2e050c'));
      // Зубы по краям разлома — через ряд, навстречу друг другу.
      if ((y - hy0 + 4) % 2 === 0 && x1 > x0) {
        p.set(x0, y, hx('#f0e8d8'));
        p.set(x1, y, hx('#f0e8d8'));
      }
    }
    p.set(hx0, hy0 + 1, hx('#9a1428'));
  }
  // Кепка.
  for (let x = hx0 - 3 - spread; x <= hx0 + 3 + spread; x++) p.set(x, hy0 - 3 - (sp.maw > 0.5 ? 1 : 0), hx('#14161c'));
  p.set(hx0 + 4 + spread, hy0 - 2, hx('#14161c'));
  p.outline(INK);
  // Глаза — на разошедшихся половинах.
  p.set(hx0 - 2 - spread, hy0 - 1, hx('#ff3a50'));
  p.set(hx0 + 2 + spread, hy0 - 1, hx('#ff3a50'));
  return { p, ax: 10, ay: G, eye: [hx0 + 2 + spread, hy0 - 1] };
}

registerMobPainter('f12_sleeper', (m: Mob, pose: MobPose) => {
  const mode = pose.mode;
  const f = pose.frame;
  let anim = 'idle';
  let fr = 0;
  const base: SleepPose = { sit: false, maw: 1, head: [13, 8], crouch: 0, legs: [0, 0], arms: 0 };
  let sp = base;
  if (mode === 'f12_doze') {
    anim = 'doze';
    fr = Math.floor(pose.t * 1.2) % 4;
    sp = { ...base, sit: true, maw: 0, head: [11, 15 + (fr === 2 ? 1 : 0)], z: fr };
  } else if (mode === 'f12_wake') {
    anim = 'wake';
    fr = Math.min(2, Math.floor(pose.t / 0.25));
    sp = { ...base, maw: fr / 2, head: [12, 12 - fr * 2], crouch: 4 - fr * 2 };
  } else if (mode === 'dying') {
    anim = 'dead';
    fr = deathK(pose);
    sp = { ...base, crouch: 3, maw: 0.6 };
  } else if (mode === 'aim') {
    anim = 'aim';
    fr = pose.t < 0.3 ? 0 : 1;
    sp = { ...base, crouch: 4, head: [15, 11], arms: 1, legs: [-1, 1] };
  } else if (mode === 'f12_lunge') {
    anim = 'lunge';
    sp = { ...base, crouch: 2, head: [18, 10], arms: 2, legs: [-2, 2] };
  } else if (mode === 'recover') {
    anim = 'rec';
    fr = pose.t < 0.3 ? 0 : 1;
    sp = { ...base, crouch: 3, head: [14, 11], maw: 0.7 };
  } else if (pose.anim === 'run') {
    anim = 'run';
    fr = f % 6;
    const ph = (fr / 6) * TAU;
    sp = { ...base, crouch: 2 + Math.round(Math.sin(ph * 2)), head: [14, 9 + Math.round(Math.sin(ph * 2))], legs: [Math.sin(ph), -Math.sin(ph)], arms: Math.sin(ph) * 0.6 };
  } else if (pose.anim === 'hurt') {
    anim = 'hurt';
    sp = { ...base, crouch: 1, head: [11, 8], maw: 0.8 };
  } else {
    fr = f % 4;
    sp = { ...base, crouch: 1 + (fr === 2 ? 1 : 0), head: [13, 8 + (fr === 2 ? 1 : 0)] };
  }
  return frameOf('f12_sleeper', pose, anim, fr, () => {
    const b = drawSleeper(sp);
    if (anim === 'dead') b.p = ashen(b.p, fr, m.id % 7);
    return b;
  });
});

// ---------------------------------------------------------------------------
// Глаз на своде: жилы сверху, глазное яблоко; взгляд ходит за `face`.
// Кадр 22×30, земля — 28 (летун: висит выше).
// ---------------------------------------------------------------------------

function drawEye(open: number, px: number, py: number, spot: boolean, tears: number, f: number): Built {
  const p = new Px(22, 30);
  const cx = 11;
  const cy = 18;
  // Жилы со свода.
  for (let i = -2; i <= 2; i++) {
    const x0 = cx + i * 3;
    for (let y = 0; y < cy - 4; y++) {
      const x = x0 + Math.round(Math.sin(y * 0.5 + i + f * 0.3) * 1) - Math.round((i * y) / 10);
      p.set(x, y, i % 2 ? hx('#3a0a14') : hx('#5a1420'));
    }
  }
  // Веко-плоть.
  shadeEll(p, cx, cy, 7.5, 6.5, tn('#3a1418', '#6a2830', '#8a4048', '#a86068'));
  if (open > 0) {
    const ry = 5.2 * open;
    p.ell(cx, cy, 6, ry, (x, y) => {
      const d = Math.hypot(x + 0.5 - cx, (y + 0.5 - cy) * 1.2);
      return d > 4.8 ? hx('#d8c0b8') : hx('#f0e8e0');
    });
    // Прожилки.
    for (let i = 0; i < 5; i++) {
      const a = hash(i, 3) * TAU;
      for (let r = 3; r < 6; r++) p.set(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r * 0.8), spot ? hx('#d01020') : hx('#c05060'));
    }
    // Радужка и зрачок.
    const ix = cx + px * 2.2;
    const iy = cy + py * 1.6 * open;
    p.ell(ix, iy, 2.6, 2.6 * Math.min(1, open * 1.2), spot ? hx('#e02020') : hx('#d09a20'));
    p.ell(ix, iy, spot ? 0.8 : 1.4, (spot ? 0.8 : 1.4) * Math.min(1, open * 1.3), INK);
    p.set(Math.round(ix) - 1, Math.round(iy) - 1, WHITE);
  } else {
    for (let x = cx - 5; x <= cx + 5; x++) p.set(x, cy, INK);
    for (let x = cx - 4; x <= cx + 4; x += 2) p.set(x, cy + 1, hx('#2a0a0e'));
  }
  if (tears > 0)
    for (let i = 0; i < 3; i++) {
      const y = cy + 5 + ((tears * 3 + i * 2) % 6);
      p.set(cx - 3 + i * 3, y, hx('#6ab0ff'));
    }
  p.outline(INK);
  return { p, ax: cx, ay: 28, eye: open > 0 ? [cx, cy] : null };
}

registerMobPainter('f12_eye', (m: Mob, pose: MobPose) => {
  const mode = pose.mode;
  const f = pose.frame % 4;
  let open = 1;
  let spot = false;
  let tears = 0;
  let anim = mode;
  if (mode === 'f12_shut' || mode === 'stun') {
    open = 0;
    anim = 'shut';
  } else if (mode === 'f12_spot') spot = true;
  else if (mode === 'f12_blink') {
    open = Math.floor(pose.t * 3) % 2 ? 0.35 : 0.8;
    tears = Math.floor(pose.t * 6) % 3 + 1;
  } else if (mode === 'dying') {
    open = 0.5;
    anim = 'dead';
  }
  // Взгляд — по `face` моба, в 8 сторон.
  const a8 = Math.round((m.face / TAU) * 8) & 7;
  const qa = (a8 / 8) * TAU;
  const px = open ? Math.cos(qa) : 0;
  const py = open ? Math.sin(qa) : 0;
  const fr = anim === 'dead' ? deathK(pose) : f;
  const key = `${anim}|${a8}|${Math.round(open * 4)}|${tears}`;
  return frameOf('f12_eye', { ...pose, left: false }, key, fr, () => {
    const b = drawEye(open, px, py, spot, tears, f);
    if (anim === 'dead') b.p = ashen(b.p, fr, m.id % 5);
    return b;
  });
});

// ---------------------------------------------------------------------------
// Кукла-заклинатель: фарфоровое лицо в трещинах, чёлка, красное кимоно,
// булавки. Кадр 16×24, земля — 22.
// ---------------------------------------------------------------------------

const PORC = tn('#9a948c', '#c8c2b8', '#e8e4dc', '#fbfaf6');
const KIMONO = tn('#3a0a10', '#6a1420', '#9a2230', '#c8403e');

interface DollPose {
  bob: number;
  tilt: number;
  arms: number;
  cast: number;
  legs: number;
  dazed?: boolean;
}

function drawDoll(dp: DollPose): Built {
  const p = new Px(18, 26);
  const G = 22;
  const cx = 8;
  const top = 6 + dp.bob;
  // Ножки-чурбачки.
  p.rect(cx - 2 + dp.legs, G - 3, cx - 1 + dp.legs, G - 1, PORC[1]);
  p.rect(cx + 1 - dp.legs, G - 3, cx + 2 - dp.legs, G - 1, PORC[1]);
  // Кимоно — колокол.
  polyShade(p, [[cx - 2, top + 6], [cx + 2, top + 6], [cx + 5, G - 3], [cx - 5, G - 3]], KIMONO);
  for (let x = cx - 3; x <= cx + 3; x++) p.set(x, top + 9, GOLD[2]);
  for (let x = cx - 3; x <= cx + 3; x++) p.set(x, top + 10, GOLD[1]);
  // Руки-рукава.
  const ay = top + 8 - dp.arms * 5 - dp.cast * 4;
  limb(p, cx - 2, top + 7, cx - 5, ay + 2, 1.3, 1.1, KIMONO);
  limb(p, cx + 2, top + 7, cx + 5, ay + 2, 1.3, 1.1, KIMONO);
  p.set(cx - 5, ay + 1, PORC[2]);
  p.set(cx + 5, ay + 1, PORC[2]);
  // Голова: наклон — сдвиг и поворот чёлки.
  const hx0 = cx + dp.tilt;
  const hy0 = top + 2;
  shadeEll(p, hx0, hy0, 3.4, 3.2, PORC);
  // Чёлка и каре.
  for (let x = hx0 - 4; x <= hx0 + 4; x++)
    for (let y = hy0 - 4; y <= hy0 + 3; y++) {
      const e = Math.hypot((x - hx0) / 4.2, (y - hy0 + 0.5) / 4.2);
      if (e > 1) continue;
      if (y < hy0 - 1 || Math.abs(x - hx0) > 2.6) p.set(x, y, y < hy0 - 2 ? hx('#1a1418') : hx('#0c0a0e'));
    }
  // Трещина по лицу.
  p.set(hx0 + 1, hy0, hx('#4a3a3a'));
  p.set(hx0 + 2, hy0 + 1, hx('#4a3a3a'));
  // Булавки.
  stroke(p, cx + 2, top + 12, cx + 6, top + 10, STEEL[4], 1);
  p.set(cx + 6, top + 10, hx('#ff5a8a'));
  stroke(p, cx - 1, top + 14, cx - 5, top + 15, STEEL[4], 1);
  p.set(cx - 5, top + 15, hx('#e8e0d0'));
  p.outline(INK);
  // Глаза — чёрные бусины, при колдовстве горят.
  const ec = dp.cast > 0 ? hx('#e070ff') : hx('#1a0a1a');
  p.set(hx0 - 1, hy0, ec);
  p.set(hx0 + 1, hy0, ec);
  if (dp.cast > 0) {
    // Нити от пальцев вверх.
    for (let i = 0; i < 6; i++) {
      p.set(cx - 5, ay - i, alpha(hx('#d27aff'), 0.8 - i * 0.1));
      p.set(cx + 5, ay - i, alpha(hx('#d27aff'), 0.8 - i * 0.1));
    }
  }
  if (dp.dazed) stars(p, hx0, top - 3, 4, Math.floor(dp.bob * 4) & 3);
  return { p, ax: cx, ay: G, eye: [hx0 + 1, hy0] };
}

registerMobPainter('f12_doll', (m: Mob, pose: MobPose) => {
  const mode = pose.mode;
  const f = pose.frame;
  let anim = 'idle';
  let fr = 0;
  let dp: DollPose = { bob: 0, tilt: 0, arms: 0, cast: 0, legs: 0 };
  if (mode === 'dying') {
    anim = 'dead';
    fr = deathK(pose);
    dp = { ...dp, tilt: 2, bob: 2 };
  } else if (mode === 'cast') {
    anim = 'cast';
    fr = Math.floor(pose.t * 6) % 3;
    dp = { ...dp, cast: 1, bob: -1 - (fr % 2), tilt: fr === 1 ? 1 : -1 };
  } else if (mode === 'aim') {
    anim = 'aim';
    fr = pose.t < 0.4 ? 0 : 1;
    dp = { ...dp, arms: 1, tilt: 1 };
  } else if (mode === 'f12_dazed') {
    anim = 'daze';
    fr = Math.floor(pose.t * 4) % 4;
    dp = { ...dp, tilt: 3, bob: 1, arms: -0.4, dazed: true };
  } else if (pose.anim === 'run') {
    anim = 'run';
    fr = f % 4;
    // Дёрганая походка: голова дёргается не в такт.
    dp = { ...dp, bob: fr % 2 ? -1 : 0, tilt: fr === 1 ? 1 : fr === 3 ? -1 : 0, legs: fr < 2 ? 1 : -1 };
  } else if (pose.anim === 'hurt') {
    anim = 'hurt';
    dp = { ...dp, tilt: -2, bob: 1 };
  } else {
    fr = f % 4;
    dp = { ...dp, tilt: fr === 3 ? 2 : 0, bob: fr === 1 ? -1 : 0 };
  }
  return frameOf('f12_doll', pose, anim, fr, () => {
    const b = drawDoll(dp);
    if (anim === 'dead') b.p = ashen(b.p, fr, m.id % 7, hx('#ffffff'));
    return b;
  });
});

// ---------------------------------------------------------------------------
// Оживший плакат: на стене — плакат с лицом; отлипает; летит бумажным
// человеком; смят в ком. Кадр 20×34, земля — 32.
// ---------------------------------------------------------------------------

function posterSheet(p: Px, x0: number, y0: number, w: number, h: number, skew: number, eyes: RGBA): void {
  for (let y = 0; y < h; y++) {
    const sx = Math.round((skew * y) / h);
    for (let x = 0; x < w; x++) {
      let c = PAPER[(x + y) % 7 === 0 ? 1 : 2];
      if (y === 0 || x === 0) c = PAPER[3];
      if (x === w - 1 || y === h - 1) c = PAPER[0];
      p.set(x0 + x + sx, y0 + y, c);
    }
  }
  // Напечатанная фигура: голова, улыбка, плечи в синем пиджаке.
  const cx = x0 + Math.floor(w / 2) + Math.round(skew / 2);
  shadeEll(p, cx, y0 + 4, 2.6, 2.8, tn('#8a6a58', '#b8927a', '#d8b69a', '#f0d8c0'));
  for (let x = cx - 3; x <= cx + 3; x++) for (let y = y0 + 7; y < y0 + Math.min(h - 1, 12); y++) p.set(x, y, hx('#2a4a8a'));
  p.set(cx - 1, y0 + 4, eyes);
  p.set(cx + 1, y0 + 4, eyes);
  for (let x = cx - 2; x <= cx + 2; x++) p.set(x, y0 + 6, x === cx - 2 || x === cx + 2 ? INK : hx('#b02020'));
  // Надпись.
  if (h > 13) for (let x = x0 + 1; x < x0 + w - 1; x++) if (x % 2) p.set(x + Math.round(skew), y0 + h - 3, hx('#c02020'));
}

function drawPoster(stage: string, f: number): Built {
  const p = new Px(20, 34);
  const G = 32;
  const eyes = hx('#ff5a30');
  if (stage === 'flat') {
    // Плакат на стене — над полом, на лице стены.
    posterSheet(p, 4, 2, 11, 15, 0, f % 8 === 0 ? INK : eyes);
    return { p, ax: 10, ay: G, eye: null };
  }
  if (stage === 'peel') {
    // Отклеивается: низ уже на полу, верх ещё держится.
    posterSheet(p, 4, 2 + f * 4, 11, 15 - f * 2, f * 2, eyes);
    p.outline(INK);
    return { p, ax: 10, ay: G, eye: null };
  }
  if (stage === 'ball') {
    shadeEll(p, 10, G - 4, 4.5, 4, [PAPER[0], PAPER[1], PAPER[2], PAPER[3]]);
    for (let i = 0; i < 6; i++) p.set(7 + Math.floor(hash(i, 3) * 7), G - 7 + Math.floor(hash(i, 4) * 6), PAPER[0]);
    p.set(11, G - 5, eyes);
    p.outline(INK);
    return { p, ax: 10, ay: G, eye: [11, G - 5] };
  }
  if (stage === 'lie') {
    for (let y = G - 3; y < G; y++) for (let x = 3; x < 17; x++) p.set(x, y, PAPER[y === G - 3 ? 3 : 2]);
    p.set(8, G - 2, eyes);
    p.outline(INK);
    return { p, ax: 10, ay: G, eye: null };
  }
  // Летит бумажным человеком: лист, ноги-лоскуты, руки-лезвия.
  const skew = stage === 'cut' ? 3 : Math.round(Math.sin(f * 1.3) * 2);
  posterSheet(p, 5, 9, 10, 17, skew, eyes);
  // Руки-лезвия.
  const arm = stage === 'cut' ? (f % 2 ? -1 : 1) : 0;
  stroke(p, 15 + skew, 17, 19, 14 - arm * 4, PAPER[3], 1);
  stroke(p, 5, 17, 2, 19 + arm * 2, PAPER[2], 1);
  // Ноги-лоскуты.
  for (let y = 26; y < G; y++) {
    p.set(7 + Math.round(Math.sin(y + f) * 0.8), y, PAPER[1]);
    p.set(12 + Math.round(Math.cos(y + f) * 0.8), y, PAPER[1]);
  }
  p.outline(INK);
  return { p, ax: 10, ay: G, eye: [10 + Math.round(skew / 2) + 1, 13] };
}

registerMobPainter('f12_poster', (m: Mob, pose: MobPose) => {
  const mode = pose.mode;
  const f = pose.frame;
  let stage = 'fly';
  let fr = f % 4;
  if (mode === 'f12_flat') {
    stage = 'flat';
    fr = Math.floor(pose.t * 2) % 8;
  } else if (mode === 'f12_peel') {
    stage = 'peel';
    fr = Math.min(2, Math.floor(pose.t / 0.2));
  } else if (mode === 'f12_crumple') {
    stage = 'ball';
    fr = 0;
  } else if (mode === 'f12_return') {
    stage = 'lie';
    fr = 0;
  } else if (mode === 'f12_cuts') {
    stage = 'cut';
    fr = Math.floor(pose.t / 0.12) % 2;
  } else if (mode === 'dying') {
    stage = 'ball';
    fr = deathK(pose);
  }
  return frameOf('f12_poster', pose, stage, fr, () => {
    const b = drawPoster(stage, fr);
    if (mode === 'dying') b.p = ashen(b.p, fr, m.id % 5, hx('#ff8a3a'));
    return b;
  }, stage === 'flat' || stage === 'peel' ? false : pose.left);
});

// ---------------------------------------------------------------------------
// Турникетный страж: стальная тумба-туловище, табло-лицо, триподы-руки,
// щит «вход запрещён». Кадр 32×32, земля — 30.
// ---------------------------------------------------------------------------

interface GatePose {
  bob: number;
  lean: number;
  step: number;
  spin: number;
  out: number;
  face: 'eyes' | 'x' | 'q';
}

function tripod(p: Px, x: number, y: number, spin: number, out: number, far: boolean): void {
  const c = far ? STEEL[2] : STEEL[4];
  for (let i = 0; i < 3; i++) {
    const a = spin + (i / 3) * TAU;
    const l = 3 + out * 3;
    stroke(p, x, y, x + Math.cos(a) * l, y + Math.sin(a) * l * 0.7, c, 1);
  }
  shadeEll(p, x, y, 1.6, 1.6, [STEEL[0], STEEL[1], STEEL[2], STEEL[3]]);
}

function drawGate(gp: GatePose): Built {
  const p = new Px(34, 32);
  const G = 30;
  const cx = 16 + gp.lean;
  const top = 6 + gp.bob;
  // Ноги.
  polyShade(p, [[cx - 6 - gp.step, G - 7], [cx - 2 - gp.step, G - 7], [cx - 2 - gp.step, G - 1], [cx - 7 - gp.step, G - 1]], [STEEL[0], STEEL[1], STEEL[2], STEEL[3]]);
  polyShade(p, [[cx + 2 + gp.step, G - 7], [cx + 6 + gp.step, G - 7], [cx + 7 + gp.step, G - 1], [cx + 2 + gp.step, G - 1]], [STEEL[0], STEEL[1], STEEL[2], STEEL[3]]);
  // Дальний трипод.
  tripod(p, cx - 8, top + 10, -gp.spin, gp.out, true);
  // Туловище-тумба.
  polyShade(p, [[cx - 7, top + 3], [cx + 7, top + 3], [cx + 7, G - 6], [cx - 7, G - 6]], [STEEL[1], STEEL[2], STEEL[3], STEEL[4]]);
  for (let y = top + 4; y < G - 6; y++) p.set(cx + 6, y, STEEL[1]);
  // Щит спереди: красный круг «нет входа».
  shadeEll(p, cx + 3, top + 13, 3.6, 3.6, tn('#5a0a0a', '#a01414', '#d02a2a', '#ff5a4a'));
  for (let x = cx + 1; x <= cx + 5; x++) p.set(x, top + 13, WHITE);
  // Голова-табло.
  polyShade(p, [[cx - 5, top - 3], [cx + 6, top - 3], [cx + 6, top + 3], [cx - 5, top + 3]], [STEEL[0], STEEL[1], STEEL[2], STEEL[3]]);
  for (let x = cx - 3; x <= cx + 5; x++) for (let y = top - 2; y <= top + 2; y++) p.set(x, y, hx('#08090a'));
  // Жетоноприёмник.
  p.set(cx - 3, top + 7, GOLD[3]);
  p.set(cx - 3, top + 8, INK);
  // Ближний трипод.
  tripod(p, cx + 9, top + 9, gp.spin, gp.out, false);
  p.outline(INK);
  const red = hx('#ff2a2a');
  if (gp.face === 'eyes') {
    p.set(cx, top, red);
    p.set(cx + 1, top, red);
    p.set(cx + 3, top, red);
    p.set(cx + 4, top, red);
  } else if (gp.face === 'x') {
    for (const ox of [0, 3]) {
      p.set(cx + ox, top - 1, red);
      p.set(cx + ox + 1, top, red);
      p.set(cx + ox, top + 1, red);
      p.set(cx + ox + 2, top - 1, red);
      p.set(cx + ox + 2, top + 1, red);
    }
  } else {
    p.set(cx + 1, top - 1, hx('#ffd040'));
    p.set(cx + 2, top, hx('#ffd040'));
    p.set(cx + 1, top + 1, hx('#ffd040'));
    p.set(cx + 4, top + 1, hx('#ffd040'));
  }
  return { p, ax: cx, ay: G, eye: [cx + 3, top] };
}

registerMobPainter('f12_turnstile', (m: Mob, pose: MobPose) => {
  const mode = pose.mode;
  const f = pose.frame;
  let anim = 'idle';
  let fr = 0;
  let gp: GatePose = { bob: 0, lean: 0, step: 0, spin: 0.3, out: 0, face: 'eyes' };
  if (mode === 'dying') {
    anim = 'dead';
    fr = deathK(pose);
    gp = { ...gp, bob: 2, face: 'x' };
  } else if (mode === 'f12_post') {
    anim = 'post';
    fr = Math.floor(pose.t * 1.5) % 2;
    gp = { ...gp, face: fr ? 'eyes' : 'x' };
  } else if (mode === 'windup') {
    anim = 'wind';
    fr = Math.floor(pose.t * 10) % 3;
    gp = { ...gp, spin: fr * 0.7, out: 0.6, lean: -1 };
  } else if (mode === 'recover' && pose.t < 0.25) {
    anim = 'swing';
    gp = { ...gp, spin: 1.2, out: 1, lean: 2 };
  } else if (mode === 'f12_aim') {
    anim = 'aim';
    fr = pose.t < 0.4 ? 0 : 1;
    gp = { ...gp, lean: -2, bob: 1, out: 0.3, face: 'x' };
  } else if (mode === 'charge') {
    anim = 'charge';
    fr = f % 2;
    gp = { ...gp, lean: 3, bob: fr, step: fr ? 2 : -2, out: 0.2, face: 'x' };
  } else if (mode === 'dizzy') {
    anim = 'dizzy';
    fr = Math.floor(pose.t * 5) % 4;
    gp = { ...gp, lean: fr % 2 ? -1 : 1, bob: 1, face: 'q' };
  } else if (pose.anim === 'run') {
    anim = 'run';
    fr = f % 4;
    gp = { ...gp, bob: fr % 2, step: fr < 2 ? 1 : -1, spin: 0.3 + fr * 0.15 };
  } else if (pose.anim === 'hurt') {
    anim = 'hurt';
    gp = { ...gp, lean: -2, face: 'x' };
  } else {
    fr = f % 2;
    gp = { ...gp, bob: fr };
  }
  return frameOf('f12_turnstile', pose, anim, fr, () => {
    const b = drawGate(gp);
    if (anim === 'dizzy') stars(b.p, b.ax + 1, 2, 5, fr);
    if (anim === 'dead') b.p = ashen(b.p, fr, m.id % 7, hx('#ff8a2a'));
    return b;
  });
});

// ---------------------------------------------------------------------------
// Путевой обходчик: жилет, каска, красный фонарь, лом; лицо — тьма.
// Кадр 22×26, земля — 24.
// ---------------------------------------------------------------------------

const VEST = tn('#5a2a0a', '#8a4414', '#b0601e', '#d88a3a');
const OVERALL = tn('#141618', '#22262a', '#343a40', '#4a525a');

interface LinePose {
  bob: number;
  legs: [number, number];
  lamp: [number, number];
  bar: number;
  lean: number;
}

function drawLineman(lp: LinePose, f: number): Built {
  const p = new Px(24, 28);
  const G = 26;
  const cx = 11 + lp.lean;
  const hip = G - 9 + lp.bob;
  // Ноги.
  limb(p, cx - 1, hip, cx - 2 + lp.legs[0] * 2, G - 1, 1.6, 1.4, OVERALL, -0.1);
  limb(p, cx + 1, hip, cx + 2 + lp.legs[1] * 2, G - 1, 1.6, 1.4, OVERALL);
  // Туловище: комбинезон и жилет с полосами.
  limb(p, cx, hip, cx + 0.5, hip - 7, 3.3, 3.1, VEST);
  for (let x = cx - 3; x <= cx + 3; x++) {
    p.set(x, hip - 4, hx('#d8d8c8'));
    p.set(x, hip - 2, hx('#b8b8a8'));
  }
  // Лом в дальней руке.
  const ba = -0.6 - lp.bar * 1.8;
  limb(p, cx - 2, hip - 6, cx - 4, hip - 3, 1.1, 1, OVERALL);
  stroke(p, cx - 4, hip - 3, cx - 4 + Math.cos(ba) * 9, hip - 3 + Math.sin(ba) * 9, STEEL[3], 1);
  // Голова: каска, лицо в тени.
  shadeEll(p, cx + 1, hip - 11, 2.8, 2.8, tn('#0a0808', '#141010', '#201818', '#2a2020'));
  for (let x = cx - 2; x <= cx + 4; x++) {
    p.set(x, hip - 13, hx('#d8c030'));
    p.set(x, hip - 14, hx('#f0e070'));
  }
  p.set(cx + 5, hip - 12, hx('#b09020'));
  // Ближняя рука с фонарём.
  const [lx, ly] = lp.lamp;
  limb(p, cx + 2, hip - 6, cx + lx, hip + ly, 1.1, 1, OVERALL);
  const fy = hip + ly + 1;
  p.rect(cx + lx - 1, fy, cx + lx + 1, fy + 3, f % 3 === 2 ? hx('#a01010') : hx('#ff3020'));
  p.set(cx + lx, fy - 1, STEEL[2]);
  p.outline(INK);
  glowDot(p, cx + lx, fy + 1, hx('#ff4020'), 2);
  // Глаза в тени — оранжевые угли.
  p.set(cx + 1, hip - 11, hx('#ff8a3a'));
  p.set(cx + 3, hip - 11, hx('#ff8a3a'));
  return { p, ax: cx, ay: G, eye: [cx + 3, hip - 11] };
}

registerMobPainter('f12_lineman', (m: Mob, pose: MobPose) => {
  const mode = pose.mode;
  const f = pose.frame;
  let anim = 'idle';
  let fr = f % 3;
  let lp: LinePose = { bob: 0, legs: [0, 0], lamp: [5, -2], bar: 0, lean: 0 };
  if (mode === 'dying') {
    anim = 'dead';
    fr = deathK(pose);
    lp = { ...lp, bob: 2, lamp: [5, 2] };
  } else if (mode === 'f12_wave') {
    anim = 'wave';
    fr = Math.floor(pose.t * 6) % 4;
    const a = [-2.2, -1.4, -0.8, -1.4][fr];
    lp = { ...lp, lamp: [Math.round(Math.cos(a) * 7), Math.round(-6 + Math.sin(a) * 6)] };
  } else if (mode === 'windup') {
    anim = 'wind';
    fr = pose.t < 0.35 ? 0 : 1;
    lp = { ...lp, bar: 1, lean: -1 };
  } else if (mode === 'recover' && pose.t < 0.2) {
    anim = 'hit';
    lp = { ...lp, bar: -0.4, lean: 2 };
  } else if (pose.anim === 'run' || mode === 'f12_patrol') {
    anim = 'run';
    fr = f % 4;
    const s = Math.sin((fr / 4) * TAU);
    lp = { ...lp, legs: [s, -s], bob: fr % 2 ? -1 : 0, lamp: [5, -2 + Math.round(s)] };
  } else if (pose.anim === 'hurt') {
    anim = 'hurt';
    lp = { ...lp, lean: -2 };
  }
  return frameOf('f12_lineman', pose, anim, fr, () => {
    const b = drawLineman(lp, fr);
    if (anim === 'dead') b.p = ashen(b.p, fr, m.id % 7, hx('#ff6a2a'));
    return b;
  });
});

// ---------------------------------------------------------------------------
// Безбилетник: капюшон, кеды, мешок с монетами. Кадр 18×22, земля — 20.
// ---------------------------------------------------------------------------

const HOOD = tn('#1a1c22', '#2e323c', '#464c5a', '#626a7c');

function drawDodger(legs: number, bob: number, hop: number, coin: number): Built {
  const p = new Px(20, 24);
  const G = 22 - hop;
  const cx = 8;
  const hip = G - 7 + bob;
  limb(p, cx, hip, cx - 1 + legs * 2, G - 1, 1.4, 1.2, tn('#141820', '#222a3a', '#34405a', '#4a5a7a'));
  limb(p, cx + 1, hip, cx + 2 - legs * 2, G - 1, 1.4, 1.2, tn('#141820', '#222a3a', '#34405a', '#4a5a7a'));
  p.set(cx - 1 + legs * 2, G, WHITE);
  p.set(cx + 2 - legs * 2, G, WHITE);
  limb(p, cx, hip, cx + 1, hip - 6, 2.8, 2.6, HOOD);
  // Мешок через плечо.
  shadeEll(p, cx - 4, hip - 6, 4, 4.2, tn('#4a3218', '#7a5428', '#a07438', '#c89a50'));
  p.set(cx - 5, hip - 9, hx('#3a2410'));
  p.set(cx - 3, hip - 10, GOLD[3]);
  p.set(cx - 2, hip - 9, coin ? WHITE : GOLD[3]);
  shadeEll(p, cx + 2, hip - 9, 2.6, 2.6, HOOD);
  p.set(cx + 4, hip - 9, hx('#0a0a0e'));
  p.outline(INK);
  p.set(cx + 3, hip - 9, hx('#ffd040'));
  return { p, ax: cx, ay: 22, eye: [cx + 3, hip - 9] };
}

registerMobPainter('f12_dodger', (m: Mob, pose: MobPose) => {
  const f = pose.frame % 6;
  const mode = pose.mode;
  let anim = 'run';
  let fr = f;
  let dd = { legs: Math.sin((f / 6) * TAU), bob: f % 3 === 0 ? -1 : 0, hop: 0, coin: f % 3 };
  if (mode === 'dying') {
    anim = 'dead';
    fr = deathK(pose);
    dd = { legs: 0, bob: 2, hop: 0, coin: 0 };
  } else if (pose.anim === 'hurt') {
    anim = 'hurt';
    dd = { legs: 0.5, bob: 1, hop: 0, coin: 1 };
  } else if (pose.anim === 'idle') {
    anim = 'idle';
    fr = f % 2;
    dd = { legs: 0, bob: fr, hop: 0, coin: fr };
  }
  // Перемахивает через турникеты: подпрыгивает раз в полсекунды бега.
  if (anim === 'run' && Math.floor(pose.t * 2) % 3 === 0) dd.hop = 3;
  return frameOf('f12_dodger', pose, `${anim}${dd.hop}`, fr, () => {
    const b = drawDodger(dd.legs, dd.bob, dd.hop, dd.coin);
    if (anim === 'dead') b.p = ashen(b.p, fr, m.id % 7, GOLD[3]);
    return b;
  });
});

// ---------------------------------------------------------------------------
// Столб территории (и прежняя чаша — `bowlFrame` ниже). Кадр 14×28, земля — 26.
// ---------------------------------------------------------------------------

function drawPillar(rise: number, f: number, bowl: boolean): Built {
  const p = new Px(16, 30);
  const G = 28;
  if (bowl) {
    const st = tn('#1e1822', '#342a3a', '#4a3e54', '#66587a');
    polyShade(p, [[5, G - 12], [11, G - 12], [12, G], [4, G]], st);
    shadeEll(p, 8, G - 13, 6, 2.4, st, 0.1);
    for (let x = 3; x <= 13; x++) p.set(x, G - 13, BLOODC[2]);
    if (rise >= 1) flame(p, 8, G - 14, 7, 9, f, VFIRE, 3);
    // Черепа по кругу постамента.
    for (const x of [6, 10]) {
      p.set(x, G - 7, BONE[3]);
      p.set(x, G - 6, INK);
    }
    p.outline(INK);
    return { p, ax: 8, ay: G, eye: null };
  }
  const h = Math.round(22 * Math.min(1, rise));
  const top = G - h;
  for (let y = top; y < G; y++) {
    p.set(6, y, hx('#1a0e10'));
    p.set(7, y, hx('#2a1418'));
    p.set(8, y, hx('#3a1c20'));
    p.set(9, y, hx('#1a0e10'));
  }
  // Верёвка и офуда.
  if (h > 10) {
    for (let x = 4; x < 12; x++) p.set(x, top + 5, hx('#8a7a50'));
    for (const [x, d] of [[5, 0], [10, 1]] as [number, number][]) {
      const sway = (f + d) % 2;
      for (let y = top + 6; y < top + 12; y++) p.set(x + (y > top + 9 ? sway : 0), y, PAPER[3]);
      p.set(x, top + 8, hx('#c01a2a'));
    }
  }
  // Руна сверху — светится.
  if (h > 18) {
    p.set(7, top + 1, hx('#ff5ab0'));
    p.set(8, top + 1, hx('#ff5ab0'));
    p.set(7, top + 2, hx('#ffb0e0'));
    p.set(8, top + 3, hx('#ff5ab0'));
  }
  p.outline(INK);
  if (h > 18) glowDot(p, 8, top + 2, hx('#ff5ab0'), 2);
  return { p, ax: 8, ay: G, eye: h > 18 ? [8, top + 2] : null };
}

// --- Чаша храма (v2.87): огонь дышит, от удара плещет, разбита — осколки. ---
// Кадр 44×40, земля — ряд 36, середина — 22. Огонь — в слое света.

const BOWL_ST = tn('#1e1822', '#342a3a', '#4a3e54', '#66587a');
const BOWL_W = 44;
const BOWL_H = 40;
const BOWL_G = 36;
const BOWL_X = 22;
const BOWL_BREAK = 0.9;
const bowlFr = frameLRU<MobFrame>(120);
/** Когда чашу ударили в последний раз (по времени рендера) — плеск длиннее вспышки. */
const bowlHit = new Map<number, { fl: number; at: number; now: number }>();

interface BowlQ {
  /** 0…1 — встаёт из пола. */
  rise: number;
  /** Высота огня (дыхание). */
  fh: number;
  fi: number;
  /** Плеск после удара, 0…1 по времени; −1 — нет. */
  sp: number;
  /** Раскол, 0…1 по времени; −1 — цела. */
  brk: number;
}

function drawBowl(q: BowlQ): { p: Px; lit: Px } {
  const p = new Px(BOWL_W, BOWL_H);
  const lit = new Px(BOWL_W, BOWL_H);
  const cx = BOWL_X;
  const G = BOWL_G;
  // Встаёт из пола: всё ниже на недоросшую часть, ниже земли — срезано.
  const sink = Math.round((1 - q.rise) * 15);
  const rimY = G - 13 + sink;
  if (q.brk < 0.15) {
    polyShade(p, [[cx - 3, rimY + 1], [cx + 3, rimY + 1], [cx + 4, G + sink], [cx - 4, G + sink]], BOWL_ST);
    shadeEll(p, cx, rimY, 6, 2.4, BOWL_ST, 0.1);
    for (let x = cx - 5; x <= cx + 5; x++) p.set(x, rimY, BLOODC[2]);
    for (const x of [cx - 2, cx + 2]) {
      p.set(x, rimY + 6, BONE[3]);
      p.set(x, rimY + 7, INK);
    }
    if (q.brk >= 0) {
      // Трещины перед расколом.
      stroke(p, cx - 1, rimY - 1, cx + 1, rimY + 4, INK, 1);
      stroke(p, cx + 3, rimY, cx + 2, rimY + 3, INK, 1);
    }
    for (let y = G + 1; y < BOWL_H; y++) for (let x = 0; x < BOWL_W; x++) clr(p, x, y);
    p.outline(INK);
    for (let y = G + 1; y < BOWL_H; y++) for (let x = 0; x < BOWL_W; x++) clr(p, x, y);
  } else {
    // Раскол: обломки разлетаются, падают и лежат; постамент — пенёк.
    const tb = (q.brk - 0.15) * BOWL_BREAK;
    polyShade(p, [[cx - 3, G - 5], [cx - 1, G - 7], [cx + 2, G - 6], [cx + 3, G - 4], [cx + 4, G], [cx - 4, G]], BOWL_ST);
    for (let i = 0; i < 9; i++) {
      const s0 = (i / 8) * 2 - 1;
      const vx = s0 * 42 + (hash(i, 7) - 0.5) * 16;
      const vy = -46 - hash(i, 3) * 40;
      const x = cx + s0 * 5 + vx * tb;
      const y = Math.min(G - 1, rimY - 1 + vy * tb + 0.5 * 300 * tb * tb);
      const c = i % 3 === 0 ? BONE[2] : BOWL_ST[i % 2 ? 2 : 1];
      p.rect(Math.round(x), Math.round(y), Math.round(x) + 1, Math.round(y) + (i % 2), c);
    }
    p.outline(INK);
  }
  // Огонь: дышит, от удара плещет через край.
  const lift = q.sp >= 0 ? Math.round(Math.sin(Math.min(1, q.sp * 2.5) * Math.PI) * 4) : 0;
  if (q.rise >= 0.98 && q.brk < 0.15) {
    flame(lit, cx, rimY - 1, 8, q.fh + lift + (q.brk >= 0 ? 4 : 0), q.fi, VFIRE, 3);
    glowDot(lit, cx, rimY - 2, VFIRE[2], 2);
  } else if (q.rise > 0.7 && q.brk < 0) {
    // Вспыхивает, едва вышла из пола.
    flame(lit, cx, rimY - 1, 6, Math.round((q.rise - 0.7) * 20), q.fi, VFIRE, 3);
  }
  if (q.sp >= 0 && q.sp < 1 && q.brk < 0) {
    // Капли проклятого огня летят через край и гаснут на полу.
    const tt = q.sp * 0.45;
    for (let i = 0; i < 6; i++) {
      const sd = i % 2 ? 1 : -1;
      const vx = sd * (14 + i * 4);
      const vy = -34 - (i % 3) * 10;
      const x = cx + sd * 4 + vx * tt;
      const y = Math.min(G, rimY - 2 + vy * tt + 0.5 * 260 * tt * tt);
      lit.set(x, y, alpha(VFIRE[y >= G ? 1 : 2], 1 - q.sp));
      if (y < G) lit.set(x, y - 1, alpha(VFIRE[3], 0.7 * (1 - q.sp)));
    }
  }
  if (q.brk >= 0) {
    // Огонь выплёскивается и растекается лужей, гаснет.
    const k = Math.max(0, 1 - q.brk);
    if (q.brk < 0.3) glowDot(lit, cx, rimY - 4, WHITE, 3);
    for (let i = 0; i < 5; i++) {
      const x = cx + (i - 2) * 3 + Math.round((hash(i, 5) - 0.5) * 2);
      const h = Math.round((2 + hash(i, q.fi) * 3) * k);
      if (h > 0) flame(lit, x, G, 3, h, q.fi + i, VFIRE, i);
    }
    for (let x = cx - 7; x <= cx + 7; x++) lit.set(x, G, alpha(VFIRE[1], 0.6 * k));
  }
  return { p, lit };
}

function bowlFrame(m: Mob, pose: MobPose): MobFrame {
  const now = pose.now;
  // Удар: вспышка движка коротка (0,12 с) — плеск держим по своим часам.
  let h = bowlHit.get(m.id);
  if (!h || now < h.now - 1e-3) h = { fl: 0, at: -9, now };
  if ((m.flash ?? 0) > h.fl + 1e-3) h.at = now;
  h.fl = m.flash ?? 0;
  h.now = now;
  bowlHit.set(m.id, h);
  const dead = pose.mode === 'dying' || pose.mode === 'escape';
  const q: BowlQ = {
    rise: pose.mode === 'f12_rise' ? Math.round(Math.min(1, pose.t / 0.55) * 12) / 12 : 1,
    fh: 9 + Math.round(Math.sin(now * 2.6 + m.id) * 1.6),
    fi: Math.floor(now * 10 + m.id) % 8,
    sp: now - h.at < 0.45 ? Math.floor(((now - h.at) / 0.45) * 11) / 11 : -1,
    brk: dead ? Math.min(1, Math.floor((pose.t / BOWL_BREAK) * 22) / 22) : -1,
  };
  const fl = pose.flash && !dead;
  const key = `${q.rise}|${q.fh}|${q.fi}|${q.sp}|${q.brk}|${fl ? 1 : 0}`;
  let fr = bowlFr.get(key);
  if (!fr) {
    const d = drawBowl(q);
    const img = fl ? d.p.tint(WHITE, 0.85) : d.p;
    fr = bowlFr.set(key, {
      img: img.canvas(),
      lit: d.lit.canvas(),
      ax: BOWL_X,
      ay: BOWL_G,
      eye: null,
      still: true,
      shadow: q.brk >= 0.15 ? 0 : 6,
      linger: dead ? BOWL_BREAK : undefined,
    });
  }
  // От удара чаша вздрагивает.
  if (q.sp >= 0 && q.sp < 0.3 && q.brk < 0) return { ...fr, dx: q.sp < 0.15 ? 1 : -1 };
  return fr;
}

registerMobPainter('f12_pillar', (m: Mob, pose: MobPose) => {
  const bowl = (m.data.bowl ?? 0) > 0;
  if (bowl) return bowlFrame(m, pose);
  const rise = pose.mode === 'f12_rise' ? Math.min(1, pose.t / 0.55) : 1;
  const rf = Math.round(rise * 4);
  const f = pose.frame % 4;
  const anim = pose.mode === 'dying' || pose.mode === 'escape' ? 'dead' : bowl ? 'bowl' : 'pole';
  const fr = anim === 'dead' ? Math.min(3, Math.floor(pose.t / 0.12)) : f;
  return frameOf('f12_pillar', { ...pose, left: false }, `${anim}${rf}`, fr, () => {
    const b = drawPillar(rise, f, bowl);
    if (anim === 'dead') b.p = ashen(b.p, fr, m.id % 5, hx('#ff5ab0'));
    return b;
  });
});

// ---------------------------------------------------------------------------
// Поезд: вагон 5 клеток (80 px) — крыша сверху, борт с окнами, тележки.
// Голова (вагон 0) — кабина, фары. Призрак — бледный и полупрозрачный.
// ---------------------------------------------------------------------------

const TRAIN_W = CAR_LEN * 16;
const TRAIN_H = 46;

function drawCar(head: boolean, dirRight: boolean, ghost: boolean, flick: number, doors: boolean): Px {
  const p = new Px(TRAIN_W, TRAIN_H);
  const body = ghost ? tn('#7a9a8a', '#a8c8b8', '#c8e8d8', '#eafff4') : tn('#1a2838', '#2a4058', '#3c5a78', '#5a7c9c');
  const roof = ghost ? tn('#8aa89a', '#b0d0c0', '#d0ecdf', '#f0fff8') : [STEEL[1], STEEL[2], STEEL[3], STEEL[4]] as Tones;
  const R0 = 4;
  const R1 = 18;
  const S1 = 40;
  // Крыша: вид сверху на глубину пути.
  for (let y = R0; y < R1; y++)
    for (let x = 2; x < TRAIN_W - 2; x++) {
      const l = (y - R0) / (R1 - R0);
      let c = l < 0.15 ? roof[3] : l < 0.7 ? roof[2] : roof[1];
      // Вентиляция и токоприёмник.
      if (y > 8 && y < 13 && (x % 26 > 8 && x % 26 < 17)) c = roof[0];
      if (y === 10 && x % 26 > 9 && x % 26 < 16) c = roof[3];
      p.set(x, y, c);
    }
  // Борт.
  for (let y = R1; y < S1; y++)
    for (let x = 2; x < TRAIN_W - 2; x++) {
      let c = body[y < R1 + 2 ? 3 : y < 30 ? 2 : 1];
      if (y === 31 || y === 32) c = ghost ? hx('#e8fff0') : hx('#c8c0a8');
      if (y === 33) c = ghost ? hx('#5a8a70') : hx('#8a7a5a');
      p.set(x, y, c);
    }
  // Двери и окна.
  const lit = ghost ? hx('#c8ffe0') : flick ? hx('#f0d890') : hx('#ffe6a0');
  const doorAt = [14, 56];
  for (const dx of doorAt) {
    for (let y = R1 + 1; y < S1 - 1; y++) {
      p.set(dx, y, INK);
      p.set(dx + 9, y, INK);
      for (let x = dx + 1; x < dx + 9; x++) {
        if (doors) p.set(x, y, y > 33 ? hx('#0a0806') : hx('#050404'));
        else if (y > R1 + 2 && y < 29 && x !== dx + 4 && x !== dx + 5) p.set(x, y, lit);
        else if (x === dx + 4 || x === dx + 5) p.set(x, y, body[0]);
      }
    }
  }
  const winAt = head ? [26, 38] : [2 + 4, 26, 38, 68];
  for (const wx0 of winAt) {
    if (wx0 < 4 || wx0 > TRAIN_W - 12) continue;
    for (let y = R1 + 3; y < 29; y++)
      for (let x = wx0; x < wx0 + 9; x++) {
        let c = y === R1 + 3 ? body[0] : lit;
        p.set(x, y, c);
      }
    // Силуэты пассажиров: кто-то смотрит красными глазами.
    const n = Math.floor(hash(wx0, head ? 1 : 2, ghost ? 3 : 4) * 3);
    for (let i = 0; i < n; i++) {
      const sx = wx0 + 2 + i * 3;
      for (let y = 23; y < 29; y++) p.set(sx, y, ghost ? hx('#4a7a6a') : hx('#2a1e1a'));
      p.set(sx, 22, ghost ? hx('#4a7a6a') : hx('#2a1e1a'));
      p.set(sx + 1, 23, ghost ? hx('#4a7a6a') : hx('#2a1e1a'));
      if ((i + wx0) % 5 === 0) p.set(sx, 23, hx('#ff2a2a'));
    }
  }
  // Кабина: скруглённый нос, лобовое стекло, фары.
  if (head) {
    const nx = dirRight ? TRAIN_W - 3 : 2;
    const sgn = dirRight ? -1 : 1;
    for (let y = R0; y < S1 + 2; y++)
      for (let k = 0; k < 14; k++) {
        const x = nx + sgn * k;
        const round = y < R0 + 4 ? 4 - (y - R0) : 0;
        if (k < round) clr(p, x, y);
      }
    // Лобовое стекло.
    for (let y = R1 + 2; y < 28; y++)
      for (let k = 2; k < 10; k++) p.set(nx + sgn * k, y, ghost ? hx('#1a3a30') : hx('#0a1420'));
    for (let k = 2; k < 10; k++) p.set(nx + sgn * k, R1 + 2, ghost ? hx('#8affc0') : hx('#6a8aaa'));
    // Табло маршрута.
    for (let k = 3; k < 12; k++) for (let y = R0 + 7; y < R0 + 11; y++) p.set(nx + sgn * k, y, hx('#0a0a0a'));
    for (let k = 4; k < 11; k += 2) p.set(nx + sgn * k, R0 + 9, ghost ? hx('#6affb0') : hx('#ff8a2a'));
    // Фары.
    for (const y of [34, 35]) {
      p.set(nx + sgn * 1, y, WHITE);
      p.set(nx + sgn * 2, y, hx('#fff6c8'));
    }
  } else {
    // Сцепка на хвосте.
    const tx = dirRight ? 1 : TRAIN_W - 2;
    for (let y = 33; y < 37; y++) p.set(tx, y, STEEL[0]);
  }
  // Тележки и колёса.
  for (const bx of [14, TRAIN_W - 18]) {
    for (let y = S1; y < TRAIN_H - 2; y++) for (let x = bx - 2; x < bx + 10; x++) p.set(x, y, hx('#0c0d0e'));
    for (const wx0 of [bx, bx + 7]) {
      p.ell(wx0 + 1, TRAIN_H - 4, 2.4, 2.2, hx('#1a1c1e'));
      p.set(wx0 + 1, TRAIN_H - 5, STEEL[3]);
    }
  }
  p.outline(INK);
  if (head) {
    const nx = dirRight ? TRAIN_W - 2 : 1;
    glowDot(p, nx, 34, ghost ? hx('#9affc8') : hx('#fff0b0'), 2);
  }
  return ghost ? fade(p, 0.72) : p;
}

registerMobPainter('f12_train', (m: Mob, pose: MobPose) => {
  const head = (m.data.car ?? 0) === 0;
  const dirRight = (m.data.dir ?? 1) > 0;
  const ghost = (m.data.spirit ?? 0) > 0;
  const doors = (m.data.stop ?? 0) > 0;
  const flick = (pose.frame >> 3) % 2;
  const key = `car|${head ? 1 : 0}|${dirRight ? 1 : 0}|${ghost ? 1 : 0}|${flick}|${doors ? 1 : 0}`;
  let fr = frames.get(key);
  if (!fr) {
    const p = drawCar(head, dirRight, ghost, flick, doors);
    fr = { img: p.canvas(), ax: TRAIN_W / 2, ay: TRAIN_H - 2, eye: head ? [dirRight ? TRAIN_W - 3 : 2, 34] : null };
    frames.set(key, fr);
  }
  return fr;
});

// ---------------------------------------------------------------------------
// Двуликий король проклятий (v2.87 — анимация тела). Анфас, смотрит вправо.
// Белое кимоно с рукавами-фурисодэ, тёмные хакама, четыре руки (верхняя
// пара режет, нижняя держит знак и пояс), розовые вихры, чёрные полосы
// татуировки. Второе лицо — костяная маска, наросшая на щеку (для зрителя —
// слева): до «ПЛАМЕНИ» её глаз закрыт. На поясе — рот.
//
// Тело — риг: поза — набор чисел (таз, наклон, колени и ступни, локти и
// кисти четырёх рук, лицо, пояс, пламя…). Техника — ключевые позы по
// времени с кривыми разгона и торможения; кадр — поза в момент
// `floor(t · 24) / 24`, и кадр контакта совпадает с уроном мозга. Рукава и
// вихры догоняют тело пружиной, посчитанной по позам в прошлом (кадр
// остаётся функцией времени), след руки — выборки той же позы в прошлом.
// Светится (глаза, пламя, следы, знак, кромка) — слой `lit`. Кадры — в
// `frameLRU`, прогрев — `registerMobWarm`. Мозг — метроном: тайминги
// берутся из `KING`.
// ---------------------------------------------------------------------------

const K_ROBE = tn('#6e685e', '#b4ac9c', '#dcd5c6', '#f6f2e8');
const K_HAK = tn('#121016', '#221e28', '#342e3c', '#4c4456');
const K_OBI = tn('#0a080c', '#1a141c', '#2a222e', '#443846');
const K_SKIN = tn('#6e4c40', '#9c705c', '#c4967a', '#e4ba9c');
const K_HAIR = tn('#4a1a26', '#7e3044', '#a84c62', '#d27a8e');
const K_MASK = tn('#6a6252', '#a09680', '#cfc4a8', '#f0e8d2');
const K_TAT = hx('#120608');
const K_EYE = hx('#ff2030');
const K_GHOST = hx('#ff2a5a');
const K_MOUTH = hx('#5a0a12');
const K_GUM = hx('#8a0a18');
const K_TONGUE = hx('#d0404e');
const K_PINK = hx('#ffb0b8');
const K_CUT = [hx('#ffffff'), hx('#ffd0d8'), hx('#ff4a62'), hx('#8a0a22')];
const K_ASH = [hx('#120a10'), hx('#2a1e24'), hx('#3e3036')];

const KFPS = 24;
const KF = 1 / KFPS;
const kc = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

type KEase = (x: number) => number;
const kLin: KEase = (x) => x;
const kIn: KEase = (x) => x * x;
const kOut: KEase = (x) => 1 - (1 - x) * (1 - x);
const kOut3: KEase = (x) => 1 - (1 - x) * (1 - x) * (1 - x);
const kIO: KEase = (x) => (x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) * (1 - x));
/** С перелётом за цель и возвратом (жетон, рывок руки, удар головы). */
const kBack: KEase = (x) => 1 + 2.7 * (x - 1) ** 3 + 1.7 * (x - 1) ** 2;

// ---- Каналы рига ----------------------------------------------------------

const KCH = [
  // Тело: сдвиг таза, высота таза над землёй, плечи вбок, сутулость, вдох, поворот.
  'bx', 'by', 'hip', 'lean', 'bend', 'br', 'tw',
  // Ноги: колено и ступня — от середины тела по x, высота над землёй по y.
  'lkx', 'lky', 'lfx', 'lfy', 'rkx', 'rky', 'rfx', 'rfy',
  // Голова: сдвиг, взгляд вбок, кивок, рот, глаза; маска: глаз, оскал, трещины.
  'hx', 'hy', 'look', 'nod', 'jaw', 'eyes', 'm2', 'mjaw', 'crack', 'mb',
  // Четыре руки: локоть и кисть от плеча (x — НАРУЖУ), вид кисти, за спиной.
  'ruex', 'ruey', 'ruhx', 'ruhy', 'ruk', 'rub',
  'rlex', 'rley', 'rlhx', 'rlhy', 'rlk',
  'luex', 'luey', 'luhx', 'luhy', 'luk', 'lub',
  'llex', 'lley', 'llhx', 'llhy', 'llk',
  // Свет и приёмы.
  'aura', 'flare', 'glow', 'belly', 'fing', 'claw', 'bow', 'draw', 'arrow', 'rel',
  'pyre', 'crawl', 'sign', 'palm', 'stars', 'click', 'baim',
  // Общий ход кадра (трансформ движка).
  'fdx', 'fdy', 'fsx', 'fsy', 'frot', 'air',
] as const;
type KC = (typeof KCH)[number];
type KR = Record<KC, number>;
type K4 = 'ru' | 'rl' | 'lu' | 'll';
const K4S: K4[] = ['rl', 'll', 'ru', 'lu'];

/**
 * Скачком, а не плавно: вид кисти (кулак, коготь, два пальца, знак), рука
 * за спиной, звёзды, ступень трещины маски. Полуоткрытый кулак на
 * промежуточном кадре читался бы как сбой.
 */
const KSTEP = new Set<string>(['ruk', 'rlk', 'luk', 'llk', 'rub', 'lub', 'stars', 'crack']);

/** Виды кисти. */
const HK = { open: 0, fist: 1, claw: 2, two: 3, palm: 4, sign: 5, grip: 6 } as const;

/** Боевая стойка: верхние руки свободно, нижняя правая на поясе, левая — знак у груди. */
const KB0: KR = {
  bx: 0, by: 0, hip: 16, lean: 0, bend: 0, br: 0, tw: 0,
  lkx: -7, lky: 8, lfx: -7.5, lfy: 0, rkx: 7, rky: 8, rfx: 7.5, rfy: 0,
  hx: 0, hy: 0, look: 0, nod: 0, jaw: 0, eyes: 1, m2: 0, mjaw: 0, crack: 0, mb: 0,
  ruex: 4, ruey: 7, ruhx: 5, ruhy: 14, ruk: HK.open, rub: 0,
  rlex: 4, rley: 6, rlhx: -1, rlhy: 12, rlk: HK.fist,
  luex: 4, luey: 7, luhx: 5, luhy: 14, luk: HK.open, lub: 0,
  llex: 4, lley: 5, llhx: -5, llhy: 4, llk: HK.two,
  aura: 0, flare: 0, glow: 0.6, belly: 0, fing: 0, claw: 0, bow: 0, draw: 0, arrow: 0, rel: 0,
  pyre: 0, crawl: 0, sign: 0, palm: 0, stars: 0, click: 0, baim: 0,
  fdx: 0, fdy: 0, fsx: 1, fsy: 1, frot: 0, air: 0,
};

/** Сидит на помосте, скрестив ноги: верхние — знак храма, нижние — на коленях. */
const KSIT: Partial<KR> = {
  hip: 5, lkx: -14, lky: 3, lfx: 4, lfy: 1.5, rkx: 14, rky: 3, rfx: -4, rfy: 1.5,
  ruex: 4, ruey: 7, ruhx: -8, ruhy: 3, ruk: HK.sign,
  luex: 4, luey: 7, luhx: -8, luhy: 3, luk: HK.sign,
  rlex: 6, rley: 8, rlhx: 6, rlhy: 15, rlk: HK.palm,
  llex: 6, lley: 8, llhx: 6, llhy: 15, llk: HK.palm,
};

/** На одном колене: левое на земле, правое поднято, рука на нём. */
const KKNEEL: Partial<KR> = {
  hip: 9, bend: 1, lkx: -7, lky: 1.5, lfx: -3, lfy: 3, rkx: 8, rky: 9.5, rfx: 8.5, rfy: 0,
  ruex: 3, ruey: 8, ruhx: 4, ruhy: 15, ruk: HK.open,
  rlex: 3, rley: 5, rlhx: 1, rlhy: 9, rlk: HK.open,
  luex: 3, luey: 8, luhx: 4, luhy: 15, luk: HK.open,
  llex: 3, lley: 7, llhx: 3, llhy: 13, llk: HK.open,
};

type KKey = [number, Partial<KR>, KEase?];

/**
 * Ключевые позы: ключ меняет только названные каналы, остальные ДЕРЖАТ
 * значение прошлого ключа. Между ключами — кривая следующего ключа.
 */
function kTrack(keys: KKey[], t: number, base: KR): KR {
  const out = { ...base };
  if (!keys.length) return out;
  for (const ch of KCH) {
    let pt = keys[0][0];
    let pv = keys[0][1][ch] ?? base[ch];
    let v = pv;
    if (t > pt) {
      for (let i = 1; i < keys.length; i++) {
        const [kt, kv, ke] = keys[i];
        const cv = kv[ch] ?? pv;
        if (t < kt) {
          v = KSTEP.has(ch) ? pv : pv + (cv - pv) * (ke ?? kIO)(kc((t - pt) / (kt - pt || 1), 0, 1));
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

const kStepE: KEase = () => 0;

/**
 * Те же ключи, собранные один раз: у каждого канала — свои отрезки
 * (откуда, куда, кривая). Поза в миг t — один проход по каналам без
 * перебора ключей и без новых массивов: пружины рукавов и следы рук берут
 * десятки поз на кадр.
 */
function kCompile(keys: KKey[], base: KR): (t: number) => KR {
  const v0: number[] = [];
  const segs: [number, number, number, number, KEase][][] = [];
  for (const ch of KCH) {
    const step = KSTEP.has(ch);
    let pv = keys[0][1][ch] ?? base[ch];
    v0.push(pv);
    const list: [number, number, number, number, KEase][] = [];
    for (let i = 1; i < keys.length; i++) {
      const cv = keys[i][1][ch];
      if (cv === undefined || cv === pv) continue;
      list.push([keys[i - 1][0], keys[i][0], pv, cv, step ? kStepE : (keys[i][2] ?? kIO)]);
      pv = cv;
    }
    segs.push(list);
  }
  const n = KCH.length;
  return (t: number) => {
    const out = {} as KR;
    for (let c = 0; c < n; c++) {
      let v = v0[c];
      const list = segs[c];
      for (let i = 0; i < list.length; i++) {
        const sg = list[i];
        if (t >= sg[1]) {
          v = sg[3];
          continue;
        }
        if (t > sg[0]) v = sg[2] + (sg[3] - sg[2]) * sg[4]((t - sg[0]) / (sg[1] - sg[0] || 1));
        break;
      }
      out[KCH[c]] = v;
    }
    return out;
  };
}

// ---- Геометрия ------------------------------------------------------------

/** Рабочий холст: 100×100, земля — ряд 86, середина тела — 50. Кадр режется по рамке. */
const KW = 100;
const KH = 100;
const KGY = 86;
const KCX = 50;

interface KGeo {
  cx: number;
  hipY: number;
  sy: number;
  L: number;
  hcx: number;
  hcy: number;
  S: Record<K4, [number, number]>;
  E: Record<K4, [number, number]>;
  H: Record<K4, [number, number]>;
}

const armCh = (a: K4, s: 'ex' | 'ey' | 'hx' | 'hy' | 'k') => `${a}${s}` as KC;

function kGeo(r: KR): KGeo {
  const cx = KCX + Math.round(r.bx);
  const hipY = KGY - Math.round(r.hip + r.by);
  const sy = hipY - 21 + Math.round(r.bend) - Math.round(r.br);
  const L = Math.round(r.lean);
  const S = {} as Record<K4, [number, number]>;
  const E = {} as Record<K4, [number, number]>;
  const H = {} as Record<K4, [number, number]>;
  for (const a of K4S) {
    const side = a[0] === 'r' ? 1 : -1;
    const up = a[1] === 'u';
    const sx = up ? cx + L + 9 * side : cx + Math.round(L * 0.6) + 8 * side;
    const syy = up ? sy + 1 : sy + 7;
    S[a] = [sx, syy];
    E[a] = [sx + r[armCh(a, 'ex')] * side, syy + r[armCh(a, 'ey')]];
    H[a] = [sx + r[armCh(a, 'hx')] * side, syy + r[armCh(a, 'hy')]];
  }
  return { cx, hipY, sy, L, hcx: cx + L + Math.round(r.hx), hcy: sy - 9 + Math.round(r.hy), S, E, H };
}

// ---- Вторичное движение: рукава и вихры догоняют тело ------------------

interface KSec {
  /** Конец свисающего рукава от точки подвеса (верхние руки). */
  ru: [number, number];
  lu: [number, number];
  /** Вихры: наклон и подъём. */
  hs: number;
  hl: number;
}

/** Сколько свисает рукав под предплечьем, px. */
const DRAPE = 4;

/** Где подвешен рукав: на предплечье у локтя (плюс общий ход кадра). */
function hangOf(g: KGeo, r: KR, a: 'ru' | 'lu'): [number, number] {
  const [sx, sy] = g.S[a];
  const [ex, ey] = g.E[a];
  return [sx + (ex - sx) * 0.75 + r.fdx, sy + (ey - sy) * 0.75 + 1 + r.fdy];
}

/**
 * Пружина по прошлым позам: конец рукава и вихры отстают от тела и
 * доигрывают после остановки. Считается от `t − 0,45 с` до `t` шагом 1/40 —
 * кадр остаётся функцией времени (тот же t — те же пиксели).
 */
function kSecAt(at: (t: number) => KR, t: number, t0 = -1e9): KSec {
  const start = Math.max(t0, t - 0.45);
  const n = Math.max(1, Math.round((t - start) * 40));
  const dt = (t - start) / n;
  const r0 = at(start);
  const g0 = kGeo(r0);
  const pts = { ru: hangOf(g0, r0, 'ru'), lu: hangOf(g0, r0, 'lu') };
  const st = {
    ru: { x: pts.ru[0], y: pts.ru[1] + DRAPE, vx: 0, vy: 0 },
    lu: { x: pts.lu[0], y: pts.lu[1] + DRAPE, vx: 0, vy: 0 },
  };
  const hd0: [number, number] = [g0.hcx + r0.fdx, g0.hcy + r0.fdy];
  const hair = { x: hd0[0], y: hd0[1], vx: 0, vy: 0 };
  let last: { g: KGeo; r: KR } = { g: g0, r: r0 };
  for (let i = 1; i <= n; i++) {
    const s = start + i * dt;
    const r = at(s);
    const g = kGeo(r);
    last = { g, r };
    for (const a of ['ru', 'lu'] as const) {
      const [mx, my] = hangOf(g, r, a);
      const q = st[a];
      // Ткань: тянется к свисающему положению, гасится, не длиннее рукава.
      const ax = 210 * (mx - q.x) - 15 * q.vx;
      const ay = 210 * (my + DRAPE - q.y) - 15 * q.vy + 40;
      q.vx += ax * dt;
      q.vy += ay * dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      const dx = q.x - mx;
      const dy = q.y - my;
      const d = Math.hypot(dx, dy);
      if (d > 7) {
        q.x = mx + (dx / d) * 7;
        q.y = my + (dy / d) * 7;
      }
    }
    const hx0 = g.hcx + r.fdx;
    const hy0 = g.hcy + r.fdy;
    const ax = 420 * (hx0 - hair.x) - 24 * hair.vx;
    const ay = 420 * (hy0 - hair.y) - 24 * hair.vy;
    hair.vx += ax * dt;
    hair.vy += ay * dt;
    hair.x += hair.vx * dt;
    hair.y += hair.vy * dt;
  }
  const out: KSec = { ru: [0, DRAPE], lu: [0, DRAPE], hs: 0, hl: 0 };
  for (const a of ['ru', 'lu'] as const) {
    const [mx, my] = hangOf(last.g, last.r, a);
    out[a] = [kc(st[a].x - mx, -6, 6), kc(st[a].y - my, -3, 7)];
  }
  const hx1 = last.g.hcx + last.r.fdx;
  const hy1 = last.g.hcy + last.r.fdy;
  out.hs = kc((hair.x - hx1) * 0.8, -2.5, 2.5);
  out.hl = kc((hy1 - hair.y) * 0.6, -1.5, 2.5);
  return out;
}

// ---- Рисунок тела ---------------------------------------------------------

/** Что видно поверх позы: следы рук, разрез в воздухе, кромка, смерть. */
interface KOpt {
  /** Номер кадра — мерцание огня и ауры. */
  fi: number;
  edge: boolean;
  rage: boolean;
  sec: KSec;
  /** Следы рук: точки от нового к старому, ширина, вид. */
  smears: KSmear[];
  /** Разрез в воздухе после взмаха. */
  trail: KTrail | null;
  /** Маску не рисовать (смерть — она падает отдельно). */
  noMask?: boolean;
  /** Время для звёзд (кружат плавно). */
  st: number;
}

interface KSmear {
  pts: [number, number][];
  w: number;
  kind: 'cut' | 'claw' | 'fire';
}

interface KTrail {
  pts: [number, number][];
  /** Разрыв когтями: несколько прямых борозд вместо дуги взмаха. */
  tear?: [number, number, number, number][];
  /** Сколько прошло после контакта, с. */
  age: number;
  /** Разрезов подряд и через сколько каждый. */
  n: number;
  gap: number;
}

/** Штанина хакама: отрезок полосой, шире книзу, складка по середине. */
function kSeg(p: Px, x0: number, y0: number, x1: number, y1: number, w0: number, w1: number, bias: number): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L;
  const ny = dx / L;
  polyShade(
    p,
    [
      [x0 + nx * w0, y0 + ny * w0],
      [x1 + nx * w1, y1 + ny * w1],
      [x1 - nx * w1, y1 - ny * w1],
      [x0 - nx * w0, y0 - ny * w0],
    ],
    K_HAK,
    bias,
  );
}

function kLegs(p: Px, g: KGeo, r: KR): void {
  const legs: [number, number, number, number, number][] = [
    [1, r.rkx, r.rky, r.rfx, r.rfy],
    [-1, r.lkx, r.lky, r.lfx, r.lfy],
  ];
  // Сидит, скрестив ноги: левая голень ложится поверх правой.
  for (const [side, kx0, ky0, fx0, fy0] of legs) {
    const hx0 = g.cx + 5 * side;
    const hy0 = g.hipY - 1;
    const kx = g.cx + kx0;
    const ky = KGY - ky0;
    const fx = g.cx + fx0;
    const fy = KGY - fy0;
    const bias = side < 0 ? -0.05 : 0.05;
    kSeg(p, hx0, hy0, kx, ky, 4.4, 4, bias);
    kSeg(p, kx, ky, fx, fy - 1.5, 4, 4.8, bias);
    shadeEll(p, kx, ky, 4, 4, K_HAK, bias - 0.05);
    // Складка штанины — от пояса к подолу.
    stroke(p, hx0 + side, hy0 + 3, kx + side * 0.5, ky, K_HAK[0], 1);
    if (fy - ky > 3) stroke(p, kx + side * 0.5, ky, fx + side, fy - 3, K_HAK[0], 1);
  }
  for (const [side, , ky0, fx0, fy0] of legs) {
    const fx = g.cx + fx0;
    const fy = KGY - fy0;
    // Босая ступня под подолом — только когда голень стоит.
    if (fy0 < 2.5 && (KGY - ky0) < fy - 3) {
      p.rect(Math.round(fx - 2.5), Math.round(fy - 1), Math.round(fx + 2.5), Math.round(fy), K_SKIN[1]);
      p.set(Math.round(fx + 2.5 * side), Math.round(fy - 1), K_SKIN[2]);
    }
  }
  // Сидит: подошвы поверх бёдер.
  if (r.hip < 8)
    for (const fx0 of [r.lfx, r.rfx]) {
      const fx = Math.round(g.cx + fx0);
      p.rect(fx - 1, KGY - 4, fx + 2, KGY - 3, K_SKIN[1]);
      p.set(fx, KGY - 4, K_SKIN[2]);
    }
}

function kTorso(p: Px, lit: Px, g: KGeo, r: KR): void {
  const { cx, hipY, sy } = g;
  const tl = cx + g.L;
  polyShade(p, [[tl - 10, sy - 1], [tl + 10, sy - 1], [cx + 9, hipY], [cx - 9, hipY]], K_ROBE);
  stroke(p, tl - 1, sy + 7, cx - 6, hipY - 1, K_ROBE[0], 1);
  // Ворот буквой V: кожа и татуировка на груди.
  const vx = tl + Math.round(r.tw * 1.5);
  poly(p, [[vx - 4, sy - 1], [vx + 4, sy - 1], [vx, sy + 8]], K_SKIN[2]);
  stroke(p, vx - 4, sy - 1, vx, sy + 8, K_OBI[2], 1);
  stroke(p, vx + 4, sy - 1, vx, sy + 8, K_OBI[2], 1);
  for (const x of [-2, -1, 1, 2]) p.set(vx + x, sy + 1, K_TAT);
  p.set(vx, sy + 3, K_TAT);
  // Пояс.
  for (let y = hipY - 6; y <= hipY - 2; y++)
    for (let x = cx - 9; x <= cx + 9; x++) p.set(x, y, y === hipY - 6 ? K_OBI[3] : y === hipY - 2 ? K_OBI[0] : K_OBI[1]);
  kBelly(p, lit, cx, hipY - 4, r.belly, r.glow);
  // Узел пояса.
  const kx = cx + 6 + Math.round(r.tw);
  p.rect(kx, hipY - 3, kx + 2, hipY + 2, K_OBI[2]);
  p.set(kx + 1, hipY + 3, K_OBI[1]);
}

/** Рот на поясе: сомкнут (зубы видны) → раскрыт с языком и красным светом изнутри. */
function kBelly(p: Px, lit: Px, cx: number, my: number, b: number, glow: number): void {
  if (b >= 0.12 && b < 0.3) {
    // Губы чуть разошлись: тёмная щель, зубы рядом.
    for (let x = cx - 4; x <= cx + 4; x++) p.set(x, my, K_MOUTH);
    for (let x = cx - 3; x <= cx + 3; x += 2) p.set(x, my, BONE[3]);
    p.set(cx - 5, my - 1, K_TAT);
    p.set(cx + 5, my - 1, K_TAT);
    p.set(cx + 1, my + 1, K_TONGUE);
    return;
  }
  if (b < 0.12) {
    for (let x = cx - 4; x <= cx + 4; x++) p.set(x, my, K_TAT);
    p.set(cx - 5, my - 1, K_TAT);
    p.set(cx + 5, my - 1, K_TAT);
    p.set(cx - 2, my + 1, BONE[2]);
    p.set(cx + 2, my + 1, BONE[2]);
    return;
  }
  const oh = 1 + Math.round(b * 4);
  const top = my - Math.floor(oh / 2) - 1;
  const bot = top + oh + 1;
  for (let y = top; y <= bot; y++) {
    const u = (y - (top + bot) / 2) / ((bot - top) / 2 + 0.6);
    const hw = Math.round(5.5 * Math.sqrt(Math.max(0, 1 - u * u * 0.55)));
    for (let x = cx - hw; x <= cx + hw; x++) {
      const edge = y === top || y === bot;
      let c: RGBA = edge ? K_TAT : y > bot - 2 && b > 0.5 && Math.abs(x - cx) < 3 ? K_TONGUE : y - top < 2 ? K_MOUTH : K_GUM;
      // Зубы по губам: через пиксель.
      if (y === top + 1 && (x + cx) % 2 === 0) c = BONE[3];
      if (y === bot - 1 && (x + cx) % 2 === 1 && !(b > 0.5 && Math.abs(x - cx) < 3)) c = BONE[2];
      p.set(x, y, c);
    }
  }
  if (b > 0.3) {
    const a = 0.35 + 0.45 * Math.min(1, glow);
    for (let x = cx - 2; x <= cx + 2; x++) lit.set(x, my, alpha(hx('#ff3a4a'), a * (1 - Math.abs(x - cx) * 0.15)));
    if (b > 0.7) lit.set(cx, my + 1, alpha(hx('#ff8a6a'), a));
  }
}

const K_RIM = hx('#6a6358');
const K_EDGE_INK = hx('#3a0610');

/** Тень вокруг конечности — только там, где под ней уже что-то нарисовано. */
function limbRim(p: Px, x0: number, y0: number, x1: number, y1: number, r0: number, r1: number, c: RGBA): void {
  const minX = Math.floor(Math.min(x0 - r0, x1 - r1)) - 2;
  const maxX = Math.ceil(Math.max(x0 + r0, x1 + r1)) + 2;
  const minY = Math.floor(Math.min(y0 - r0, y1 - r1)) - 2;
  const maxY = Math.ceil(Math.max(y0 + r0, y1 + r1)) + 2;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const L2 = dx * dx + dy * dy || 1e-6;
  for (let y = minY; y <= maxY; y++)
    for (let x = minX; x <= maxX; x++) {
      if (!p.solid(x, y)) continue;
      const k = Math.max(0, Math.min(1, ((x + 0.5 - x0) * dx + (y + 0.5 - y0) * dy) / L2));
      const d = Math.hypot(x + 0.5 - (x0 + dx * k), y + 0.5 - (y0 + dy * k));
      if (d <= r0 + (r1 - r0) * k + 1) p.set(x, y, c);
    }
}

/** Рука от плеча: рукав (у верхних), предплечье, татуировка, кисть нужного вида. */
function kArm(p: Px, lit: Px, g: KGeo, r: KR, a: K4): void {
  const [sx, sy] = g.S[a];
  const [ex, ey] = g.E[a];
  const [hx0, hy0] = g.H[a];
  const up = a[1] === 'u';
  const k = r[armCh(a, 'k')];
  // Внутренний контур: где рука лежит на теле, её обводит тень — руки не
  // сливаются с кимоно и друг с другом (скрещённые читаются крестом).
  if (up) {
    limbRim(p, sx, sy, ex, ey, 3.3, 2.8, K_RIM);
    limbRim(p, ex, ey, hx0, hy0, 1.6, 1.3, K_SKIN[0]);
    limb(p, sx, sy, ex, ey, 3.3, 2.8, K_ROBE);
    limb(p, ex, ey, hx0, hy0, 1.6, 1.3, K_SKIN);
  } else {
    limbRim(p, sx, sy, ex, ey, 1.9, 1.6, K_SKIN[0]);
    limbRim(p, ex, ey, hx0, hy0, 1.6, 1.25, K_SKIN[0]);
    limb(p, sx, sy, ex, ey, 1.9, 1.6, K_SKIN, -0.05);
    limb(p, ex, ey, hx0, hy0, 1.6, 1.25, K_SKIN, -0.05);
  }
  const dx = hx0 - ex;
  const dy = hy0 - ey;
  const L = Math.hypot(dx, dy) || 1;
  const nx = dx / L;
  const ny = dy / L;
  for (const u of up ? [0.55, 0.72] : [0.6]) {
    const bx = ex + dx * u;
    const by = ey + dy * u;
    p.set(bx - ny * 1.2, by + nx * 1.2, K_TAT);
    p.set(bx, by, K_TAT);
    p.set(bx + ny * 1.2, by - nx * 1.2, K_TAT);
  }
  switch (k) {
    case HK.sign:
      return;
    case HK.fist:
    case HK.grip:
      shadeEll(p, hx0, hy0, 1.9, 1.8, K_SKIN, 0.05);
      p.set(hx0 + nx * 1.2, hy0 + ny * 1.2, K_SKIN[0]);
      return;
    case HK.palm:
      shadeEll(p, hx0 + nx * 0.6, hy0 + ny * 0.6, 2.3, 1.4, K_SKIN, 0.1);
      return;
    case HK.claw: {
      shadeEll(p, hx0, hy0, 1.7, 1.7, K_SKIN, 0.1);
      for (let i = -1; i <= 1; i++) {
        const ox = hx0 + nx * 1.4 - ny * i * 1.2;
        const oy = hy0 + ny * 1.4 + nx * i * 1.2;
        stroke(p, ox, oy, ox + nx * 3, oy + ny * 3, hx('#2a0a10'), 1);
        p.set(ox + nx * 3, oy + ny * 3, hx('#ff5a6a'));
        if (r.claw > 0.05) lit.set(ox + nx * 3, oy + ny * 3, alpha(K_PINK, 0.4 + 0.6 * r.claw));
      }
      return;
    }
    case HK.two: {
      shadeEll(p, hx0, hy0, 1.7, 1.7, K_SKIN, 0.1);
      // Указательный и средний: у верхних — продолжение предплечья (ведут
      // взмах), у нижних — вверх (знак у живота).
      const fx = up ? nx : 0;
      const fy = up ? ny : -1;
      for (const j of [-0.55, 0.55]) {
        const ox = hx0 + fx * 1.2 - fy * j;
        const oy = hy0 + fy * 1.2 + fx * j;
        stroke(p, ox, oy, ox + fx * 3.2, oy + fy * 3.2, K_SKIN[2], 1);
      }
      p.set(hx0 + fx * 4.4, hy0 + fy * 4.4, K_SKIN[3]);
      if (r.fing > 0.02 && up) {
        const tx = Math.round(hx0 + nx * 4.6);
        const ty = Math.round(hy0 + ny * 4.6);
        const rad = r.fing > 0.66 ? 2 : 1;
        glowDot(lit, tx, ty, r.fing > 0.85 ? K_PINK : K_EYE, rad);
        if (r.fing > 0.85) {
          // Накал: искры по кругу у кончика.
          for (let i = 0; i < 3; i++) {
            const an = (i / 3) * TAU + r.fing * 9;
            lit.set(tx + Math.round(Math.cos(an) * 3), ty + Math.round(Math.sin(an) * 3), alpha(WHITE, 0.8));
          }
        }
      }
      return;
    }
    default:
      shadeEll(p, hx0, hy0, 1.7, 1.7, K_SKIN, 0.1);
  }
}

/** Рукав-фурисодэ: свисает под предплечьем и отстаёт от руки. */
function kDrape(p: Px, g: KGeo, r: KR, a: 'ru' | 'lu', d: [number, number]): void {
  const [mx, my] = hangOf(g, r, a);
  const x0 = mx - r.fdx;
  const y0 = my - r.fdy;
  const x1 = x0 + d[0];
  const y1 = y0 + d[1];
  limbRim(p, x0, y0, x1, y1, 2.5, 2, K_RIM);
  limb(p, x0, y0, x1, y1, 2.5, 2, K_ROBE, -0.08);
  // Край рукава — тень.
  p.set(x1 + (d[0] > 0 ? 1 : -1), y1 + 1, K_ROBE[0]);
  p.set(x1, y1 + 2, K_ROBE[0]);
}

/** Знак храма: сцепленные кисти, два пальца вверх; нижние — кулак в ладони. */
function kSignHands(p: Px, lit: Px, g: KGeo, r: KR, fi: number): void {
  if (r.ruk === HK.sign && r.luk === HK.sign) {
    const x = Math.round((g.H.ru[0] + g.H.lu[0]) / 2);
    const y = Math.round((g.H.ru[1] + g.H.lu[1]) / 2);
    // Ладони сложены стоймя, пальцы сцеплены, два пальца вверх.
    limbRim(p, x, y - 4, x, y + 1, 2.6, 2.6, K_SKIN[0]);
    shadeEll(p, x - 1, y, 1.9, 2.7, K_SKIN, 0.12);
    shadeEll(p, x + 1, y, 1.9, 2.7, K_SKIN, -0.05);
    stroke(p, x, y - 1, x, y + 2, K_SKIN[0], 1);
    for (const dx of [-2, 2]) p.set(x + dx, y - 1, K_TAT);
    p.set(x - 2, y + 1, K_SKIN[0]);
    p.set(x + 2, y + 1, K_SKIN[0]);
    stroke(p, x - 1, y - 3, x - 1, y - 7, K_SKIN[2], 1);
    stroke(p, x, y - 3, x, y - 7, K_SKIN[1], 1);
    p.set(x - 1, y - 8, K_SKIN[3]);
    if (r.sign > 0.02) {
      const R = 2.5 + r.sign * 2.5;
      for (let i = 0; i < 8; i++) {
        const an = (i / 8) * TAU + fi * 0.26;
        lit.set(x + Math.cos(an) * R, y - 3 + Math.sin(an) * R * 0.8, alpha(K_GHOST, 0.5 + 0.45 * r.sign));
      }
      glowDot(lit, x - 1, y - 8, K_GHOST, r.sign > 0.6 ? 2 : 1);
    }
  } else if (r.ruk === HK.sign || r.luk === HK.sign) {
    const a = r.ruk === HK.sign ? 'ru' : 'lu';
    shadeEll(p, g.H[a][0], g.H[a][1], 1.8, 1.8, K_SKIN, 0.05);
  }
  if (r.rlk === HK.sign && r.llk === HK.sign) {
    const x = Math.round((g.H.rl[0] + g.H.ll[0]) / 2);
    const y = Math.round((g.H.rl[1] + g.H.ll[1]) / 2);
    shadeEll(p, x, y, 2.8, 2, K_SKIN, 0);
    p.set(x - 1, y, K_SKIN[0]);
    p.set(x + 1, y, K_SKIN[0]);
    if (r.sign > 0.3) glowDot(lit, x, y, K_GHOST, 1);
  } else if (r.rlk === HK.sign || r.llk === HK.sign) {
    const a = r.rlk === HK.sign ? 'rl' : 'll';
    shadeEll(p, g.H[a][0], g.H[a][1], 1.8, 1.8, K_SKIN, 0.05);
  }
  if (r.click > 0.02) {
    // Щелчок знака: вспышка и кольцо в сцепленных руках.
    let n = 0;
    let x = 0;
    let y = 0;
    for (const a of K4S)
      if (r[armCh(a, 'k')] === HK.sign) {
        x += g.H[a][0];
        y += g.H[a][1];
        n++;
      }
    if (n) {
      x = Math.round(x / n);
      y = Math.round(y / n);
      glowDot(lit, x, y, K_PINK, 1 + Math.round(r.click * 2));
      const R = 3 + (1 - r.click) * 6;
      for (let i = 0; i < 10; i++) {
        const an = (i / 10) * TAU;
        lit.set(x + Math.cos(an) * R, y + Math.sin(an) * R * 0.8, alpha(WHITE, r.click * 0.9));
      }
    }
  }
}

/** Голова: шея, лицо, вихры, татуировка, глаза, рот; маска — второе лицо. */
function kHead(p: Px, lit: Px, g: KGeo, r: KR, o: KOpt): void {
  const hxc = g.hcx;
  const headY = g.hcy;
  const lk = Math.round(r.look);
  const nd = Math.round(r.nod);
  p.rect(hxc - 2, headY + 5, hxc + 2, g.sy, K_SKIN[1]);
  shadeEll(p, hxc, headY, 5.2, 6, K_SKIN);
  // Вихры: шапка до бровей, зубцы вверх и в стороны — гнутся отставая.
  p.ell(hxc, headY - 4, 6.2, 3.6, (x, y) =>
    tone(K_HAIR, ((x + 0.5 - hxc) / 6.2) * LX + ((y + 0.5 - (headY - 4)) / 3.6) * LY + 0.5),
  );
  const hs = o.sec.hs;
  const hl = o.sec.hl;
  for (let i = -3; i <= 3; i++) {
    const bx = hxc + i * 2;
    const tip = headY - 10 - (i % 2 === 0 ? 2 : 0) - (i === 0 ? 1 : 0) - hl * (0.6 + Math.abs(i) * 0.1);
    const tx = bx + i * 1.1 + hs * (0.5 + Math.abs(i) * 0.15);
    polyShade(p, [[bx - 1.6, headY - 5], [bx + 1.6, headY - 5], [tx, tip]], K_HAIR, 0.1);
  }
  for (const s of [-1, 1]) {
    p.set(hxc + s * 5, headY - 2, K_HAIR[1]);
    p.set(hxc + s * 5, headY - 1, K_HAIR[0]);
  }
  // Лоб: чёрная полоса под чёлкой.
  for (let x = hxc - 3; x <= hxc + 3; x++) p.set(x + lk, headY - 2 + nd, x === hxc ? K_SKIN[2] : K_TAT);
  // Глаза: косые, красные, тяжёлое веко; под ними — вторая пара.
  const eyeC = r.glow > 0.8 || r.eyes > 2.5 ? hx('#ff6a70') : K_EYE;
  for (const s of [-1, 1]) {
    const ex = hxc + s * 2 + lk;
    const ey = headY + nd;
    if (r.eyes < 0.5) {
      p.set(ex, ey, K_TAT);
      p.set(ex + s, ey, K_TAT);
      p.set(ex - s, ey, K_TAT);
    } else {
      p.set(ex, ey, eyeC);
      p.set(ex + s, ey, K_TAT);
      p.set(ex, ey - 1, K_TAT);
      p.set(ex - s, ey - 1, K_TAT);
      if (r.eyes > 1.5) p.set(ex - s, ey, eyeC);
    }
    p.set(ex + s, ey + 1, r.eyes > 2.5 ? hx('#ff3040') : hx('#b01020'));
    p.set(hxc + s * 4, headY + 2, K_TAT);
    p.set(hxc + s * 5, headY + 2, K_TAT);
    p.set(hxc + s * 4, headY + 3, K_TAT);
    if (r.eyes > 0.5 && r.glow > 0.5) {
      lit.set(ex, ey, eyeC);
      if (r.eyes > 1.5) lit.set(ex - s, ey, alpha(eyeC, 0.85));
    }
  }
  if (r.eyes > 0.5 && (r.glow > 0.8 || r.eyes > 2.5))
    for (const s of [-1, 1]) glowDot(lit, hxc + s * 2 + lk, headY + nd, K_EYE, r.eyes > 2.5 ? 2 : 1);
  // Рот: ухмылка → оскал зубами → рёв.
  const my = headY + 3 + nd;
  const mx = hxc + lk;
  if (r.jaw < 0.25) {
    for (let x = mx - 2; x <= mx + 1; x++) p.set(x, my + 1, K_TAT);
    p.set(mx + 2, my, K_TAT);
  } else if (r.jaw < 0.62) {
    for (let x = mx - 2; x <= mx + 2; x++) {
      p.set(x, my, K_TAT);
      p.set(x, my + 1, x % 2 ? BONE[2] : BONE[3]);
      p.set(x, my + 2, K_TAT);
    }
    p.set(mx - 3, my, K_TAT);
    p.set(mx + 3, my, K_TAT);
  } else {
    const h = r.jaw > 0.9 ? 3 : 2;
    p.rect(mx - 2, my, mx + 2, my + h, K_MOUTH);
    for (const x of [mx - 2, mx, mx + 2]) p.set(x, my, BONE[3]);
    p.set(mx - 1, my + h, BONE[2]);
    p.set(mx + 1, my + h, BONE[2]);
    if (r.glow > 0.8) lit.set(mx, my + 1, alpha(hx('#ff4a3a'), 0.6));
  }
  if (!o.noMask) kMask(p, lit, hxc - 6 + Math.round(r.look * 0.5), headY + 0.8 + nd * 0.5, r);
}

/** Маска — второе лицо: свой глаз, свои зубы, трещины после храма. */
function kMask(p: Px, lit: Px, mcx: number, my: number, r: KR): void {
  shadeEll(p, mcx, my, 2.8, 4, K_MASK, 0.05);
  const mx = Math.round(mcx);
  const ey = Math.round(my - 0.8);
  p.set(mx + 2, ey - 2, K_MASK[1]);
  if (r.m2 > 0.66) {
    p.set(mx, ey, hx('#ffb040'));
    p.set(mx - 1, ey, K_EYE);
    p.set(mx, ey - 1, K_TAT);
    p.set(mx - 1, ey + 1, K_TAT);
    lit.set(mx, ey, hx('#ffb040'));
    lit.set(mx - 1, ey, alpha(K_EYE, 0.8));
    if (r.glow > 0.5) glowDot(lit, mx, ey, hx('#ff8a40'), r.m2 > 1.2 ? 2 : 1);
  } else if (r.m2 > 0.25) {
    // Приоткрыт: щёлочка света.
    p.set(mx - 1, ey, K_TAT);
    p.set(mx, ey, hx('#ff8a40'));
    p.set(mx + 1, ey + 1, K_MASK[0]);
    lit.set(mx, ey, alpha(hx('#ffb040'), 0.8));
  } else {
    p.set(mx - 1, ey, K_TAT);
    p.set(mx, ey, K_TAT);
    p.set(mx + 1, ey + 1, K_MASK[0]);
  }
  // Зубы маски: сомкнуты или разведены оскалом.
  const ty = ey + 3;
  const gap = Math.round(r.mjaw * 2);
  for (let x = mx - 2; x <= mx + 1; x++) p.set(x, ty, x % 2 ? BONE[3] : K_TAT);
  if (gap > 0) {
    for (let x = mx - 2; x <= mx + 1; x++) {
      p.set(x, ty + 1, K_MOUTH);
      if (gap > 1) p.set(x, ty + 2, x % 2 ? K_TAT : BONE[2]);
    }
    if (r.glow > 0.7) lit.set(mx - 1, ty + 1, alpha(hx('#ff6a30'), 0.55));
  } else p.set(mx - 1, ty + 1, K_TAT);
  // Трещины: ступень 1 — шов, 2 — ветка, 3 — скол.
  if (r.crack >= 1) {
    p.set(mx + 1, ey - 3, K_TAT);
    p.set(mx + 1, ey - 2, K_TAT);
    p.set(mx, ey - 1, K_TAT);
  }
  if (r.crack >= 2) {
    p.set(mx - 1, ey + 1, K_TAT);
    p.set(mx - 2, ey + 2, K_TAT);
    p.set(mx + 2, ey + 1, K_TAT);
  }
  if (r.crack >= 3) {
    clr(p, mx - 3, ey - 2);
    clr(p, mx - 2, ey - 3);
    p.set(mx - 2, ey - 2, K_MASK[0]);
  }
  if (r.mb > 0.02) {
    // Глаз маски распахнулся: вспышка.
    glowDot(lit, mx, ey, hx('#ffb040'), 2 + Math.round(r.mb * 2));
    for (let i = 0; i < 6; i++) {
      const an = (i / 6) * TAU;
      const d = 3 + r.mb * 4;
      lit.set(mx + Math.cos(an) * d, ey + Math.sin(an) * d, alpha(hx('#ffd080'), 0.9 * r.mb));
    }
  }
}

/** Аура — язычки проклятого пламени по кругу у пола; задние — за телом. */
const K_CFIRE = [hx('#5a0a1e'), hx('#c0143a'), hx('#ff3a64'), hx('#ffd0dc')];

/** Язык проклятого пламени: основание шире, сердцевина светлее, верх качается. */
function kTongue(dst: Px, cx: number, by: number, h: number, f: number, seed: number, mask: Px | null, a: number): void {
  for (let y = 0; y < h; y++) {
    const k = y / h;
    const half = 1.5 * (1 - k * k) + 0.15;
    const sway = Math.round(Math.sin(k * 3 + f * 0.9 + seed) * k * 1.4);
    for (let x = -1; x <= 1; x++) {
      if (Math.abs(x) > half) continue;
      const hot = 1 - Math.max(Math.abs(x) / (half + 0.6), k);
      const c = hot > 0.6 ? K_CFIRE[3] : hot > 0.36 ? K_CFIRE[2] : hot > 0.14 ? K_CFIRE[1] : K_CFIRE[0];
      const px = cx + x + sway;
      const py = by - y;
      if (mask && mask.solid(px, py)) continue;
      dst.set(px, py, alpha(c, a));
    }
  }
}

/**
 * Аура — язычки проклятого пламени по кругу у пола. Задние рисуются после
 * контура только в пустоте (за телом, без обводки), передние — в свете.
 */
function kAura(p: Px, lit: Px, g: KGeo, r: KR, fi: number, back: boolean): void {
  const k = Math.min(1, r.aura + r.flare);
  if (k <= 0.05) return;
  const R = 19 + r.flare * 4;
  for (let i = 0; i < 14; i++) {
    if (hash(i, 3) > k) continue;
    const a = (i / 14) * TAU + fi * 0.13;
    const isBack = Math.sin(a) < 0;
    if (isBack !== back) continue;
    const x = Math.round(g.cx + Math.cos(a) * R);
    const y = Math.round(KGY - 2 + Math.sin(a) * 5);
    const hgt = 4 + ((i * 7 + (fi >> 1)) % 3) + Math.round(r.flare * 3);
    if (back) kTongue(p, x, y, hgt, fi, i, p, 0.75);
    else kTongue(lit, x, y, hgt, fi, i, null, 0.95);
  }
}

/** Следы: лента от нового к старому — белая сердцевина, багровый край. */
function kSmearDraw(lit: Px, s: KSmear): void {
  const n = s.pts.length;
  if (n < 2) return;
  const pal = s.kind === 'fire' ? [hx('#fff0a0'), hx('#ffa030'), hx('#e05010'), hx('#8a1a06')] : K_CUT;
  for (let pass = 0; pass < 2; pass++)
    for (let i = n - 1; i > 0; i--) {
      const [x0, y0] = s.pts[i - 1];
      const [x1, y1] = s.pts[i];
      const k = (i - 1) / (n - 1);
      const w = Math.max(1, s.w * (1 - k * 0.7));
      if (s.kind === 'claw') {
        // Три борозды когтей.
        const dx = x1 - x0;
        const dy = y1 - y0;
        const L = Math.hypot(dx, dy) || 1;
        const nx = -dy / L;
        const ny = dx / L;
        if (pass) continue;
        for (const j of [-2, 0, 2]) {
          const c = k < 0.25 ? pal[0] : k < 0.55 ? pal[1] : alpha(pal[2], 0.9 - k * 0.6);
          stroke(lit, x0 + nx * j, y0 + ny * j, x1 + nx * j, y1 + ny * j, c, 1);
        }
        continue;
      }
      if (pass === 0) stroke(lit, x0, y0, x1, y1, alpha(k < 0.5 ? pal[2] : pal[3], 0.9 - k * 0.55), w + 1);
      else if (k < 0.55) stroke(lit, x0, y0, x1, y1, k < 0.2 ? pal[0] : pal[1], Math.max(1, w - 1));
    }
}

/** Разрез в воздухе: тонкая нить по пути взмаха, расходится надвое и гаснет. */
function kTrailDraw(lit: Px, tr: KTrail): void {
  if (tr.tear) {
    // Крест когтями: по три борозды на линию, расходятся, осыпаются, гаснут.
    const age = tr.age;
    if (age < 0 || age > 0.26) return;
    const a = 1 - age / 0.26;
    for (const [x0, y0, x1, y1] of tr.tear) {
      const L = Math.hypot(x1 - x0, y1 - y0) || 1;
      const nx = -(y1 - y0) / L;
      const ny = (x1 - x0) / L;
      const sp = 2 + age * 8;
      for (const j of [-1, 0, 1]) {
        const c = age < 0.03 && j === 0 ? WHITE : j === 0 ? K_CUT[1] : K_CUT[2];
        // Борозда чуть выгнута — коготь идёт дугой.
        let px0 = x0 + nx * j * sp;
        let py0 = y0 + ny * j * sp;
        for (let i = 1; i <= 8; i++) {
          const u = i / 8;
          const bow = Math.sin(u * Math.PI) * 2;
          const px1 = x0 + (x1 - x0) * u + nx * (j * sp + bow);
          const py1 = y0 + (y1 - y0) * u + ny * (j * sp + bow);
          stroke(lit, px0, py0, px1, py1, alpha(c, a * (0.55 + 0.45 * u)), 1);
          px0 = px1;
          py0 = py1;
        }
      }
      if (age > 0.06)
        for (let i = 0; i < 5; i++) {
          const u = hash(i, Math.round(x0), 31);
          lit.set(x0 + (x1 - x0) * u + (hash(i, 2) - 0.5) * 4, y0 + (y1 - y0) * u + age * age * 110, alpha(K_PINK, a));
        }
    }
    return;
  }
  const pts = tr.pts;
  if (pts.length < 2) return;
  const [ax, ay] = pts[0];
  const [bx, by] = pts[pts.length - 1];
  const L = Math.hypot(bx - ax, by - ay) || 1;
  const nx = -(by - ay) / L;
  const ny = (bx - ax) / L;
  for (let j = 0; j < tr.n; j++) {
    const age = tr.age - j * tr.gap;
    if (age < 0 || age > 0.36) continue;
    const a = 1 - age / 0.36;
    const off = j * 3;
    const split = age * 9;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      if (age < 0.07)
        stroke(lit, x0 + nx * off, y0 + ny * off, x1 + nx * off, y1 + ny * off, alpha(WHITE, a), 1);
      else
        for (const s of [-1, 1]) {
          const d = off + s * split * 0.5;
          stroke(lit, x0 + nx * d, y0 + ny * d, x1 + nx * d, y1 + ny * d, alpha(s < 0 ? K_CUT[1] : K_CUT[2], a * 0.9), 1);
        }
    }
    // Осколки разреза осыпаются.
    if (age > 0.05)
      for (let i = 0; i < 4; i++) {
        const u = hash(i, j, 77);
        const [px0, py0] = pts[Math.floor(u * (pts.length - 1))];
        lit.set(px0 + nx * off + (hash(i, j, 3) - 0.5) * 4, py0 + ny * off + age * age * 90 + i, alpha(K_PINK, a));
      }
  }
}

/** Лук из пламени: дуга растёт из кулака, тетива к руке, стрела накаляется. */
function kBowDraw(lit: Px, g: KGeo, r: KR, fi: number): void {
  if (r.bow <= 0.02) return;
  const [bx, by] = g.H.ru;
  const half = 10;
  const n = Math.round(9 * Math.min(1, r.bow));
  // Оси лука: вдоль выстрела и поперёк; рукоять в кулаке, плечи загибаются к лучнику.
  const ax = Math.cos(r.baim);
  const ay = Math.sin(r.baim);
  const P = (along: number, across: number): [number, number] => [bx + ax * along - ay * across, by + ay * along + ax * across];
  const bend = Math.min(1, r.draw) * 3;
  for (let i = -n; i <= n; i++) {
    const u = i / 9;
    const [x, y] = P(3.6 * (Math.cos(u * (Math.PI / 2)) - 1) - bend * u * u, u * half);
    const hot = Math.abs(i) < 3 ? 3 : 1 + ((i + fi) & 1);
    lit.set(x, y, FIRE[r.rel > 0.5 ? 3 : hot]);
    const [x2, y2] = P(3.6 * (Math.cos(u * (Math.PI / 2)) - 1) - bend * u * u + 1, u * half);
    lit.set(x2, y2, FIRE[1]);
    if (r.bow > 0.6 && (i + fi) % 4 === 0) {
      const [x3, y3] = P(3.6 * (Math.cos(u * (Math.PI / 2)) - 1) - bend * u * u + 2, u * half - 1);
      lit.set(x3, y3, alpha(FIRE[2], 0.8));
    }
  }
  if (n < 9) return;
  const back = 3.6 + bend;
  const t0 = P(-back, -half);
  const t1 = P(-back, half);
  const strC = alpha(hx('#ffe0a0'), 0.85);
  if (r.draw > 0.02) {
    const [dx0, dy0] = g.H.rl;
    // Тетива на полном натяге дрожит.
    const jit = r.draw > 0.95 ? (fi % 2 ? 1 : 0) : 0;
    stroke(lit, t0[0], t0[1], dx0 - ay * jit, dy0 - ax * jit, strC, 1);
    stroke(lit, t1[0], t1[1], dx0 + ay * jit, dy0 + ax * jit, strC, 1);
    if (r.arrow > 0.02) {
      // Стрела: древко огнём от руки за лук, наконечник добела.
      const [hx1, hy1] = P(7, 0);
      stroke(lit, dx0, dy0, hx1, hy1, FIRE[r.arrow > 0.7 ? 3 : 2], 1);
      if (r.arrow > 0.4) stroke(lit, dx0 + ay, dy0 - ax, hx1 - ax * 2 + ay, hy1 - ay * 2 - ax, alpha(FIRE[1], 0.7), 1);
      flame(lit, Math.round(dx0), Math.round(dy0 + 1), 3, 3 + Math.round(r.arrow * 3), fi, FIRE, 5);
      glowDot(lit, Math.round(hx1), Math.round(hy1), r.arrow > 0.8 ? WHITE : FIRE[2], r.arrow > 0.8 ? 3 : r.arrow > 0.4 ? 2 : 1);
    }
  } else {
    // Спущена: тетива бьётся и гаснет.
    const amp = r.rel * 2.5 * (fi % 2 ? 1 : -1);
    const [mx, my] = P(-back - amp, 0);
    stroke(lit, t0[0], t0[1], mx, my, strC, 1);
    stroke(lit, mx, my, t1[0], t1[1], strC, 1);
  }
  if (r.rel > 0.3) {
    const [gx0, gy0] = P(2, 0);
    glowDot(lit, Math.round(gx0), Math.round(gy0), WHITE, 3);
  }
  // Распад лука: угли от дуги.
  if (r.bow < 0.99 && r.rel < 0.1 && r.draw < 0.02)
    for (let i = 0; i < 6; i++) {
      const u = hash(i, fi >> 2, 9) * 2 - 1;
      const [x, y] = P(3 * (Math.cos(u * 1.5) - 1) + hash(i, 4) * 2, u * half);
      lit.set(x, y + (1 - r.bow) * 6 * hash(i, 7), alpha(FIRE[2], r.bow));
    }
}

/** Огонь ползёт по рукам к ладоням; ладони на земле светят в пол. */
function kPyreDraw(lit: Px, g: KGeo, r: KR, fi: number): void {
  if (r.pyre > 0.02) {
    for (const a of K4S) {
      const [sx, sy] = g.S[a];
      const [ex, ey] = g.E[a];
      const [hx0, hy0] = g.H[a];
      const at = (u: number): [number, number] =>
        u < 0.5
          ? [sx + (ex - sx) * u * 2, sy + (ey - sy) * u * 2]
          : [ex + (hx0 - ex) * (u - 0.5) * 2, ey + (hy0 - ey) * (u - 0.5) * 2];
      for (let j = 0; j < 4; j++) {
        const u = r.crawl - j * 0.12;
        if (u < 0 || u > 1) continue;
        const [x, y] = at(u);
        const s = 1 - j * 0.2;
        flame(lit, Math.round(x), Math.round(y), 3 * s + 1, Math.round((3 + r.pyre * 3) * s), fi + j, FIRE, a.length + j);
      }
      if (r.crawl > 0.9) {
        flame(lit, Math.round(hx0), Math.round(hy0), 4, Math.round(4 + r.pyre * 4), fi, FIRE, hx0);
        glowDot(lit, Math.round(hx0), Math.round(hy0 - 2), FIRE[2], 1);
      }
    }
  }
  if (r.palm > 0.02)
    for (const a of ['rl', 'll'] as K4[]) {
      const [hx0] = g.H[a];
      const y = KGY - 1;
      for (let dx = -5; dx <= 5; dx++) {
        const k = (1 - Math.abs(dx) / 5.5) * r.palm;
        lit.set(hx0 + dx, y, alpha(FIRE[2], 0.75 * k));
        if (Math.abs(dx) < 3) lit.set(hx0 + dx, y - 1, alpha(FIRE[3], 0.6 * k));
      }
      // Трещинки света от ладони.
      for (let i = 0; i < 3; i++) {
        const dir = (i - 1) * 0.9 + (a === 'rl' ? 0.3 : -0.3);
        const len = 3 + r.palm * 4;
        stroke(lit, hx0, y, hx0 + Math.sin(dir) * len, y + 1 - Math.abs(Math.cos(dir)) * 0.5, alpha(FIRE[1], 0.7 * r.palm), 1);
      }
    }
}

/** Звёзды кружат над головой оглушённого. */
function kStarsDraw(lit: Px, g: KGeo, t: number): void {
  for (let i = 0; i < 3; i++) {
    const a = t * 5.2 + (i / 3) * TAU;
    const x = Math.round(g.hcx + Math.cos(a) * 8);
    const y = Math.round(g.hcy - 14 + Math.sin(a) * 2.5);
    const far = Math.sin(a) < 0;
    const c1 = alpha(hx('#fff27a'), far ? 0.55 : 1);
    lit.set(x, y, far ? alpha(WHITE, 0.6) : WHITE);
    lit.set(x - 1, y, c1);
    lit.set(x + 1, y, c1);
    lit.set(x, y - 1, c1);
    lit.set(x, y + 1, c1);
  }
}

/** Пиксели холста 32-битными словами (байты в памяти — RGBA). */
const u32 = (p: Px) => new Uint32Array(p.data.buffer, p.data.byteOffset, p.w * p.h);
const c32k = (c: RGBA) => ((c[3] << 24) | (c[2] << 16) | (c[1] << 8) | c[0]) >>> 0;

/** Рамка непрозрачного [x0, y0, x1, y1]; пусто — x1 < 0. */
function kBoxOf(p: Px): number[] {
  const d = u32(p);
  const w = p.w;
  let x0 = w;
  let y0 = p.h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < p.h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++)
      if (d[row + x] >>> 24) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
  }
  return [x0, y0, x1, y1];
}

/** Контур снаружи фигуры — только в пределах рамки рисунка. */
function kOutline(p: Px, c: RGBA): void {
  const [bx0, by0, bx1, by1] = kBoxOf(p);
  if (bx1 < 0) return;
  const d = u32(p);
  const w = p.w;
  const h = p.h;
  const cv = c32k(c);
  const add: number[] = [];
  for (let y = Math.max(0, by0 - 1); y <= Math.min(h - 1, by1 + 1); y++)
    for (let x = Math.max(0, bx0 - 1); x <= Math.min(w - 1, bx1 + 1); x++) {
      const i = y * w + x;
      if (d[i] >>> 24) continue;
      if ((x > 0 && d[i - 1] >>> 24) || (x < w - 1 && d[i + 1] >>> 24) || (y > 0 && d[i - w] >>> 24) || (y < h - 1 && d[i + w] >>> 24))
        add.push(i);
    }
  for (const i of add) d[i] = cv;
}

/** Кромка недосягаемости: пиксели вокруг силуэта через один, медленно бегут. */
function kEdge(p: Px, lit: Px, fi: number): void {
  const ph = (fi >> 2) & 1;
  const [bx0, by0, bx1, by1] = kBoxOf(p);
  if (bx1 < 0) return;
  const d = u32(p);
  const w = p.w;
  const ec = alpha(K_GHOST, 0.42);
  for (let y = Math.max(1, by0 - 1); y <= Math.min(p.h - 2, by1 + 1); y++)
    for (let x = Math.max(1, bx0 - 1); x <= Math.min(w - 2, bx1 + 1); x++) {
      const i = y * w + x;
      if (d[i] >>> 24 || (x + y + ph) % 2) continue;
      if (d[i - 1] >>> 24 || d[i + 1] >>> 24 || d[i - w] >>> 24 || d[i + w] >>> 24) lit.set(x, y, ec);
    }
}

/** Тело целиком: позы, затем контур, затем свет. */
function kPaint(r: KR, o: KOpt): { p: Px; lit: Px; g: KGeo } {
  const p = new Px(KW, KH);
  const lit = new Px(KW, KH);
  const g = kGeo(r);
  // Рука за спиной (замах за голову): рукав и рука — до тела.
  for (const a of ['ru', 'lu'] as const)
    if (r[a === 'ru' ? 'rub' : 'lub'] > 0.5) {
      kDrape(p, g, r, a, o.sec[a]);
      kArm(p, lit, g, r, a);
    }
  kLegs(p, g, r);
  kTorso(p, lit, g, r);
  kArm(p, lit, g, r, 'rl');
  kArm(p, lit, g, r, 'll');
  for (const a of ['ru', 'lu'] as const)
    if (r[a === 'ru' ? 'rub' : 'lub'] <= 0.5) {
      kDrape(p, g, r, a, o.sec[a]);
      kArm(p, lit, g, r, a);
    }
  kSignHands(p, lit, g, r, o.fi);
  kHead(p, lit, g, r, o);
  kOutline(p, o.edge ? K_EDGE_INK : INK);
  // Свет — поверх контура: светящееся тушью не обводится.
  if (o.edge) kEdge(p, lit, o.fi);
  kAura(p, lit, g, r, o.fi, true);
  kAura(p, lit, g, r, o.fi, false);
  for (const s of o.smears) kSmearDraw(lit, s);
  if (o.trail) kTrailDraw(lit, o.trail);
  kBowDraw(lit, g, r, o.fi);
  kPyreDraw(lit, g, r, o.fi);
  if (r.stars > 0.5) kStarsDraw(lit, g, o.st);
  if (o.rage) {
    // Третья фаза: татуировка тлеет.
    const d = u32(p);
    const tat = c32k(K_TAT);
    const tc = alpha(hx('#ff2a4a'), 0.45);
    const [bx0, by0, bx1, by1] = kBoxOf(p);
    for (let y = by0; y <= by1; y++)
      for (let x = bx0; x <= bx1; x++)
        if (d[y * p.w + x] === tat && (x * 7 + y * 3 + (o.fi >> 1)) % 3 === 0) lit.set(x, y, tc);
  }
  return { p, lit, g };
}

// ---- Техники: ключевые позы по времени (метроном — `KING`) -------------

interface KT {
  /** Спешка третьей фазы. */
  h: number;
  /** Стойка с поправками фазы (маска, глаза, аура, трещины). */
  b: KR;
  /** Разрезов в «Рассечении». */
  n: number;
  /** Куда кувыркается сбитый поездом: ±1. */
  dir: number;
  /** Куда бьёт (рад, в кадре «смотрит вправо»): 0 — вбок, +π/2 — вниз, −π/2 — вверх. */
  aim: number;
}

const tCut = (k: KT) => KING.cutAim / k.h;
const tCutEnd = (k: KT) => tCut(k) + 0.1 + 0.9 / k.h;
const tClaw = (k: KT) => 0.62 / k.h;
const tCross = (k: KT) => KING.cleaveWarn / k.h;
const tCleaveEnd = (k: KT) => tCross(k) + 0.1 + 0.9 / k.h;
const tBow = (k: KT) => KING.bowDraw / k.h;
const tBowEnd = (k: KT) => tBow(k) + 0.9 / k.h;
/** Столбы: режим 0,7 с, дальше король встаёт уже в погоне. */
const PYRE_T = 0.7;
const PYRE_END = 1.15;
/** Сетка храма: метка → разрез → возврат в знак. */
const GRID_T = KING.gridWarn;
const GRID_END = KING.gridWarn + KING.gridCut + 0.45;
/** Разрезы с помоста: первая линия через 0,9 с. */
const DCUT_T = 0.9;
const DCUT_END = 1.3;
const DSIT_END = 0.5;
const DEATH_T = 1.45;
/** Шаг: 8 кадров на 26 px пути. */
const K_STRIDE = 26;
const RUN_T = K_STRIDE / (2.6 * 16);

/** Храм: верхние — знак у груди, нижние — кулак в ладони у живота. */
const KSIT2: Partial<KR> = {
  ...KSIT,
  rlex: 3, rley: 6, rlhx: -7, rlhy: 4, rlk: HK.sign,
  llex: 3, lley: 6, llhx: -7, llhy: 4, llk: HK.sign,
};

function kIdle(ph: number, b: KR): KR {
  const r = { ...b };
  const a = ph * TAU;
  // Дыхание — целыми пикселями: плечи и руки поднимаются вместе.
  r.br = Math.round(0.5 - 0.5 * Math.cos(a));
  // Кулаки верхних рук сжимаются по очереди — хрустит костяшками.
  if (ph > 0.62 && ph < 0.71) r.ruk = HK.fist;
  if (ph > 0.12 && ph < 0.21) r.luk = HK.fist;
  // Глаза моргают, глаз маски — в свой черёд: у второго лица своя жизнь.
  if (ph > 0.87 && ph < 0.92) r.eyes = 0;
  if (b.m2 > 0.5) {
    if (ph > 0.37 && ph < 0.42) r.m2 = 0.4;
    if ((ph > 0.54 && ph < 0.59) || (ph > 0.66 && ph < 0.71)) r.mjaw = 1;
  }
  // Взгляд в сторону, рот на поясе облизывается.
  if (ph > 0.54 && ph < 0.79) r.look = 1;
  if (ph > 0.27 && ph < 0.36) r.belly = 0.2;
  return r;
}

function kRun(ph: number, b: KR): KR {
  const r = { ...b };
  const s = Math.sin(ph * TAU);
  const up = Math.max(0, s);
  const dn = Math.max(0, -s);
  // Таз переносится на опорную ногу; ступни при этом стоят на месте.
  r.bx = Math.round(s * 0.9);
  r.lfy = up * 4;
  r.lky = 8 + up * 3;
  r.lkx = -7 - up * 1.2 - r.bx;
  r.lfx = -7.5 + up * 0.8 - r.bx;
  r.rfy = dn * 4;
  r.rky = 8 + dn * 3;
  r.rkx = 7 + dn * 1.2 - r.bx;
  r.rfx = 7.5 - dn * 0.8 - r.bx;
  // Таз выше всего, когда нога проходит под телом.
  r.by = Math.round(Math.abs(s));
  r.lean = 1;
  r.look = 1;
  // Верхние руки — навстречу ногам, рукава отстают; нижние держат знак и пояс.
  r.ruhx = 5 + s * 2;
  r.ruhy = 14 - s * 2.5;
  r.ruex = 4 + s * 0.8;
  r.luhx = 5 - s * 2;
  r.luhy = 14 + s * 2.5;
  r.luex = 4 - s * 0.8;
  return r;
}

function kIntro(k: KT): (t: number) => KR {
  const b = k.b;
  const sit: Partial<KR> = { ...KSIT, nod: 1, hy: 1, eyes: 0, m2: 0, aura: 0.15, glow: 0.3 };
  const keys: KKey[] = [
    [0, sit],
    [0.5, { aura: 0.3, br: 1 }, kIO],
    [0.6, { br: 0 }, kIO],
    // Глаза открываются: вспышка, голова поднимается.
    [0.68, { eyes: 3, nod: 0, hy: 0, glow: 1, aura: 0.6, flare: 0.5 }, kOut],
    [0.95, { flare: 0, aura: 0.5, eyes: 2 }, kIO],
    // Ладони в колени, кисти расцепились; таз вверх, ноги расплетаются.
    [1.12, {
      hip: 9, bend: 2, nod: 1, lkx: -11, lky: 6, lfx: -6, lfy: 0, rkx: 11, rky: 6, rfx: 6, rfy: 0,
      ruk: HK.open, luk: HK.open, ruhx: -6, luhx: -6, ruhy: 4, luhy: 4,
      rlex: 5, rley: 7, rlhx: 4, rlhy: 13, llex: 5, lley: 7, llhx: 4, llhy: 13,
    }, kIO],
    // Встал во весь рост, руки разведены.
    [1.45, {
      hip: 16, bend: 0, nod: 0, br: 1, lkx: -7, lky: 8, lfx: -7.5, rkx: 7, rky: 8, rfx: 7.5,
      rlex: 4, rley: 6, rlhx: -1, rlhy: 12, rlk: HK.fist, llex: 4, lley: 5, llhx: -5, llhy: 4, llk: HK.two,
      ruex: 7, ruey: 2, ruhx: 13, ruhy: 3, luex: 7, luey: 2, luhx: 13, luhy: 3,
    }, kOut],
    // Разминает шею.
    [1.65, { hx: 1, ruhy: 1, luhy: 1 }, kIO],
    [1.82, { hx: -1, br: 0 }, kIO],
    // Оскал: челюсть, аура вспыхивает, наклон вперёд, когти.
    [2.0, {
      hx: 0, jaw: 1, eyes: 3, lean: 1, bend: 1, flare: 1, aura: 1, claw: 0.7,
      ruex: 6, ruey: 4, ruhx: 11, ruhy: 8, ruk: HK.claw, luex: 6, luey: 4, luhx: 11, luhy: 8, luk: HK.claw,
    }, kBack],
    [2.3, { jaw: 0.5, flare: 0.3, claw: 0.3 }, kIO],
    [KING.intro, { ...b }, kIO],
  ];
  return kCompile(keys, b);
}

/**
 * Рассечение: знак двумя пальцами → пружина → взмах ровно в первую линию.
 * Взмах идёт туда, куда легли линии: вбок, вниз (герой ниже) или вверх.
 * Выпад вперёд (`fdx`) поворачивает к цели `kRigFn`.
 */
function kCut(k: KT): (t: number) => KR {
  const T = tCut(k);
  const b = k.b;
  const v = k.aim > 0.9 ? 1 : k.aim < -0.9 ? -1 : 0;
  const cross: Partial<KR> = {
    rlex: -1, rley: 5, rlhx: -6, rlhy: 6, rlk: HK.fist, llex: -1, lley: 5, llhx: -6, llhy: 7, llk: HK.fist,
  };
  const keys: KKey[] =
    v < 0
      ? [
          [0, {}],
          // Снизу вверх: два пальца у бедра, присел — рубит над собой.
          [0.22 * T, { ...cross, ruex: 5, ruey: 6, ruhx: 6, ruhy: 12, ruk: HK.two, luex: 5, luey: 5, luhx: 9, luhy: 9, look: 0, nod: -1, jaw: 0.35, fing: 0.3, eyes: 2 }, kOut],
          [0.6 * T, { ruex: 5, ruey: 7, ruhx: 3, ruhy: 14, hip: 15, bend: 1, fing: 0.65, rfx: 8.5, rkx: 8, lfx: -8, lkx: -8 }, kIO],
          [T - 4 * KF, { ruex: 4, ruey: 7, ruhx: -1, ruhy: 15, hip: 14.5, bend: 1.5, lean: -1, fing: 1, eyes: 3, jaw: 0.5 }, kOut],
          [T - 2 * KF, { ruex: 8, ruey: 3, ruhx: 10, ruhy: 5, hip: 15.5, bend: 0, lean: 0 }, kIn],
          [T - KF, { ruex: 8, ruey: -2, ruhx: 12, ruhy: -5, hip: 16.5, by: 0.5 }, kLin],
          [T, { ruex: 5, ruey: -6, ruhx: 6, ruhy: -15, hip: 16.5, by: 1, lean: 1, fdx: 1.5, fing: 0.45, jaw: 0.85, nod: -1, luex: 6, luey: 3, luhx: 11, luhy: 6 }, kLin],
          [T + 0.12, { ruex: 3, ruey: -7, ruhx: 0, ruhy: -17, by: 1, fdx: 2, fing: 0, jaw: 0.5 }, kOut],
          [T + 0.35, { ruex: 4, ruey: -5, ruhx: 3, ruhy: -12, by: 0, hip: 16, br: 1 }, kIO],
          [T + 0.55, { br: 0 }, kIO],
          [tCutEnd(k), { ...b }, kIO],
        ]
      : [
          [0, {}],
          // Знак: два пальца у лица, левая верхняя отведена, нижние крест-накрест.
          [0.22 * T, { ...cross, ruex: 6, ruey: -5, ruhx: 4, ruhy: -13, ruk: HK.two, luex: 5, luey: 6, luhx: 9, luhy: 11, lean: -0.5, look: v ? 0 : 1, jaw: 0.35, fing: 0.3, eyes: 2 }, kOut],
          // Выше головы, вытянулся; ноги шире.
          [0.6 * T, { ruex: 4, ruey: -7, ruhx: 2, ruhy: -15, bend: -1, fing: 0.65, rfx: 8.5, rkx: 7.5, lfx: -8, lkx: -7.5 }, kIO],
          // Пружина: кисть заведена за плечо, корпус откинут.
          [T - 4 * KF, { ruex: 7, ruey: -5, ruhx: 2, ruhy: -15, lean: -2, tw: -0.6, fing: 1, eyes: 3, jaw: 0.5, hx: -1, bend: 0 }, kOut],
          // Взмах.
          ...(v > 0
            ? ([
                // Вниз, к герою под ногами: рука идёт перед грудью, корпус кланяется.
                [T - 2 * KF, { ruex: 8, ruey: -5, ruhx: 9, ruhy: -8, lean: -1, tw: 0 }, kIn],
                [T - KF, { ruex: 7, ruey: 0, ruhx: 5, ruhy: 2, lean: 0.5, hx: 0, nod: 1 }, kLin],
                [T, { ruex: 5, ruey: 4, ruhx: -1, ruhy: 12, lean: 1, bend: 2, hip: 15, fdx: 1.5, fing: 0.45, jaw: 0.85, nod: 1, luex: 6, luey: 3, luhx: 11, luhy: 6 }, kLin],
                [T + 0.12, { ruex: 4, ruey: 6, ruhx: -5, ruhy: 15, bend: 3, hip: 14.5, fdx: 2, fing: 0, jaw: 0.5 }, kOut],
              ] as KKey[])
            : ([
                [T - 2 * KF, { ruex: 8, ruey: -5, ruhx: 11, ruhy: -11, lean: -1, tw: 0 }, kIn],
                [T - KF, { ruex: 8, ruey: -2, ruhx: 15, ruhy: -1, lean: 0.5, tw: 0.4, hx: 0 }, kLin],
                // Контакт: рука вытянута вперёд-вниз, шаг вперёд.
                [T, { ruex: 8, ruey: 1, ruhx: 14, ruhy: 7, lean: 2, tw: 0.6, rfx: 10, rkx: 9, fdx: 1.5, fing: 0.45, jaw: 0.85, hx: 1, luex: 6, luey: 3, luhx: 11, luhy: 6 }, kLin],
                // Проводка с перелётом: кисть проходит через тело вниз, корпус проваливается.
                [T + 0.12, { ruex: 6, ruey: 6, ruhx: 2, ruhy: 13, lean: 3, bend: 2, hip: 15, fdx: 2, fing: 0, jaw: 0.5 }, kOut],
              ] as KKey[])),
          [T + 0.35, { ruex: 5, ruey: 7, ruhx: 3, ruhy: 14, lean: v ? 1 : 2, bend: 1.5, br: 1, nod: 0 }, kIO],
          [T + 0.55, { br: 0 }, kIO],
          [tCutEnd(k), { ...b }, kIO],
        ];
  return kCompile(keys, b);
}

function kCleave(k: KT): (t: number) => KR {
  const Tc = tClaw(k);
  const X = tCross(k);
  const b = k.b;
  const keys: KKey[] = [
    [0, {}],
    // Вскинул верхние руки когтями вверх, нижние — кулаки у бёдер; присел, вдох.
    [0.32 * Tc, {
      hip: 14.5, lkx: -8.5, rkx: 8.5, lky: 7, rky: 7, lfx: -9, rfx: 9,
      ruex: 6, ruey: -5, ruhx: 9, ruhy: -13, ruk: HK.claw, luex: 6, luey: -5, luhx: 9, luhy: -13, luk: HK.claw,
      rlex: 4, rley: 5, rlhx: 3, rlhy: 10, rlk: HK.fist, llex: 4, lley: 5, llhx: 3, llhy: 10, llk: HK.fist,
      claw: 0.4, eyes: 2, nod: -1, jaw: 0.5, br: 1, lean: -0.5,
    }, kOut],
    // Пружина: когти выше и шире, таз ниже, накал.
    [Tc - 3 * KF, {
      hip: 13, ruex: 5, ruey: -7, ruhx: 8, ruhy: -16, luex: 5, luey: -7, luhx: 8, luhy: -16,
      claw: 1, eyes: 3, jaw: 0.7, lean: -1.5, fdx: -1,
    }, kIO],
    // Крест-накрест: обе руки рвут вниз через тело — следы скрещиваются.
    [Tc - 2 * KF, { ruex: 8, ruey: -4, ruhx: 6, ruhy: -10, luex: 8, luey: -4, luhx: 6, luhy: -10, nod: 0, lean: 0, hip: 14.5, br: 0 }, kIn],
    [Tc - KF, { ruex: 5, ruey: 2, ruhx: -2, ruhy: -1, luex: 5, luey: 2, luhx: -2, luhy: -1, lean: 1.5, fdx: 1.5 }, kLin],
    [Tc, {
      ruex: 2, ruey: 6, ruhx: -11, ruhy: 9, luex: 2, luey: 6, luhx: -11, luhy: 10, lean: 2.5, hip: 14, bend: 1,
      fdx: 3, jaw: 1, claw: 0.7, rlhx: 6, rlhy: 12, llhx: 6, llhy: 12, rfx: 9.5, lfx: -9.5,
    }, kLin],
    // Проводка: руки скрещены внизу, корпус догоняет.
    [Tc + 0.1, { ruhx: -12, ruhy: 12, luhx: -12, luhy: 13, fdx: 3.5, lean: 2, hip: 13.5, bend: 1.5, claw: 0.4 }, kOut],
    // Щелчок: крест рвётся наружу — под героем крест.
    [X - 2 * KF, {
      ruk: HK.fist, luk: HK.fist, claw: 0, ruex: 3, ruey: 6, ruhx: -9, ruhy: 10, luex: 3, luey: 6, luhx: -9, luhy: 11, jaw: 0.4,
    }, kIO],
    [X, { ruex: 7, ruey: 4, ruhx: 12, ruhy: 10, luex: 7, luey: 4, luhx: 12, luhy: 11, jaw: 0.8, by: 1, hip: 15 }, kOut],
    [X + 0.12, { by: 0 }, kIO],
    [X + 0.3, { fdx: 1, lean: 1, hip: 16, bend: 0, br: 1 }, kIO],
    [X + 0.5, { br: 0 }, kIO],
    [tCleaveEnd(k), { ...b }, kIO],
  ];
  return kCompile(keys, b);
}

/** Локоть по плечу и кисти: две кости по 8 px, сгиб наружу и вниз. */
function kElbow(sx: number, sy: number, hx0: number, hy0: number, side: number): [number, number] {
  const a = 8;
  const dx = hx0 - sx;
  const dy = hy0 - sy;
  const d = Math.hypot(dx, dy) || 1e-3;
  const dc = Math.min(d, 2 * a - 0.3);
  const ux = dx / d;
  const uy = dy / d;
  const along = dc / 2;
  const h = Math.sqrt(Math.max(0, a * a - along * along));
  let px = -uy;
  let py = ux;
  if (px * side + py * 0.5 < 0) {
    px = -px;
    py = -py;
  }
  return [sx + ux * along + px * h, sy + uy * along + py * h];
}

/**
 * Лук целится в героя: кисти, что держат лук и тетиву, поворачиваются вокруг
 * груди на угол прицела (каждая — с того мига, как взялась), локти
 * сгибаются заново. Лук рисуется в том же повороте (`baim`).
 */
function kAimBow(r: KR, th: number, w: Record<K4, number>): void {
  if (!th) return;
  const g = kGeo(r);
  const cx = g.cx + g.L + 2;
  const cy = g.sy + 1;
  for (const a of K4S) {
    const wa = w[a];
    if (wa <= 0) continue;
    const side = a[0] === 'r' ? 1 : -1;
    const [sx, sy] = g.S[a];
    const [hx0, hy0] = g.H[a];
    const an = th * wa;
    const c = Math.cos(an);
    const sn = Math.sin(an);
    const nx = cx + (hx0 - cx) * c - (hy0 - cy) * sn;
    const ny = cy + (hx0 - cx) * sn + (hy0 - cy) * c;
    const [ex, ey] = kElbow(sx, sy, nx, ny, side);
    r[armCh(a, 'hx')] = (nx - sx) * side;
    r[armCh(a, 'hy')] = ny - sy;
    r[armCh(a, 'ex')] = (ex - sx) * side;
    r[armCh(a, 'ey')] = ey - sy;
  }
  r.baim = th * w.ru;
}

function kBow(k: KT): (t: number) => KR {
  const T = tBow(k);
  const A = T - 0.45;
  const b = k.b;
  const keys: KKey[] = [
    [0, {}],
    // Пламя собирается в кулаке; стойка шире, взгляд на цель.
    [0.16 * T, { ruex: 7, ruey: 0, ruhx: 9, ruhy: -3, ruk: HK.grip, bow: 0.3, lfx: -9.5, lkx: -8.5, rfx: 9.5, rkx: 8.5, lean: -0.5, look: 1, hx: 1, eyes: 2 }, kOut],
    // Правая нижняя берёт тетиву у лука.
    [0.26 * T, { bow: 1, rlex: 7, rley: -1, rlhx: 9, rlhy: -6, rlk: HK.fist, arrow: 0.1 }, kIO],
    // Ступень 1: натяг на треть.
    [0.4 * T, { rlex: 6, rley: 1, rlhx: 2, rlhy: -6, draw: 0.4, arrow: 0.25, lean: -1 }, kOut],
    // Ступень 2: левая верхняя ложится на тетиву.
    [0.48 * T, { luex: -3, luey: 4, luhx: -11, luhy: -1, luk: HK.fist }, kIO],
    [0.6 * T, { rlex: 3, rley: 0, rlhx: -4, rlhy: -6, luhx: -11, luhy: -2, draw: 0.75, arrow: 0.55, lean: -1.5, tw: 0.4, glow: 1, flare: 0.2 }, kOut],
    // Ступень 3: левая нижняя — полный натяг тремя руками; маска скалится.
    [0.68 * T, { llex: -2, lley: 3, llhx: -7, llhy: -3, llk: HK.fist }, kIO],
    [A, {
      rlex: -1, rley: -2, rlhx: -9, rlhy: -6, luhx: -7, luhy: -3, llhx: -5, llhy: -4,
      draw: 1, arrow: 1, lean: -2, tw: 0.7, jaw: 0.35, mjaw: 1, m2: 1.5, flare: 0.4, eyes: 3,
    }, kOut],
    // Замер: прицел пойман.
    [T - KF, { jaw: 0.5 }, kLin],
    // Выстрел: тетива сорвалась, руки разлетелись, отдача корпусом назад.
    [T, {
      draw: 0, rel: 1, arrow: 0, rlex: 2, rley: -4, rlhx: -6, rlhy: -11, luex: 5, luey: -3, luhx: 6, luhy: -8,
      llex: 4, lley: 0, llhx: 6, llhy: -2, lean: -3, fdx: -2.5, jaw: 0.95, flare: 0.8,
    }, kLin],
    [T + 0.12, { rel: 0.3, lean: -2.5, fdx: -2, flare: 0.3 }, kOut],
    [T + 0.3, { rel: 0, bow: 0.55, lean: -1, fdx: -0.5, jaw: 0.4, mjaw: 0.5 }, kIO],
    [T + 0.5, {
      bow: 0, ruex: 4, ruey: 7, ruhx: 5, ruhy: 14, ruk: HK.open, luex: 4, luey: 7, luhx: 5, luhy: 14, luk: HK.open,
      rlex: 4, rley: 6, rlhx: -1, rlhy: 12, llex: 4, lley: 5, llhx: -5, llhy: 4, llk: HK.two, m2: 1,
    }, kIO],
    [tBowEnd(k), { ...b }, kIO],
  ];
  const ev = kCompile(keys, b);
  if (!k.aim) return ev;
  // Кто когда взялся за лук и тетиву; после выстрела руки возвращаются.
  const on = (t: number, a0: number, a1: number) => kc((t - a0) / (a1 - a0), 0, 1);
  const off = (t: number) => 1 - kOut(kc((t - T - 0.3) / 0.2, 0, 1));
  return (t: number) => {
    const r = ev(t);
    const o = off(t);
    kAimBow(r, k.aim, {
      ru: kOut(on(t, 0, 0.16 * T)) * o,
      rl: on(t, 0.16 * T, 0.26 * T) * o,
      lu: on(t, 0.4 * T, 0.48 * T) * o,
      ll: on(t, 0.6 * T, 0.68 * T) * o,
    });
    return r;
  };
}

function kPyre(k: KT): (t: number) => KR {
  const b = k.b;
  const keys: KKey[] = [
    [0, {}],
    // Вдох: четыре руки вверх, огонь вспыхивает у плеч и ползёт по рукам.
    [0.15, {
      ruex: 5, ruey: -4, ruhx: 8, ruhy: -11, ruk: HK.palm, luex: 5, luey: -4, luhx: 8, luhy: -11, luk: HK.palm,
      rlex: 6, rley: 0, rlhx: 11, rlhy: -4, rlk: HK.palm, llex: 6, lley: 0, llhx: 11, llhy: -4, llk: HK.palm,
      nod: -1, jaw: 0.75, eyes: 3, glow: 1, pyre: 0.4, crawl: 0.15, by: 1,
    }, kOut],
    [0.3, { pyre: 1, crawl: 1, ruhy: -12, luhy: -12, by: 1.5 }, kIO],
    // Удар ладонями в землю: глубокий присед.
    [0.375, {
      by: 0, hip: 6, bend: 3, lkx: -11, lky: 7.5, lfx: -9.5, rkx: 11, rky: 7.5, rfx: 9.5,
      ruex: 6, ruey: 7, ruhx: 9, ruhy: 14, luex: 6, luey: 7, luhx: 9, luhy: 14,
      rlex: 6, rley: 7, rlhx: 6, rlhy: 16, llex: 6, lley: 7, llhx: 6, llhy: 16,
      nod: 1, jaw: 1, palm: 1, fsx: 1.07, fsy: 0.93,
    }, kIn],
    [0.46, { fsx: 1, fsy: 1, palm: 0.8, jaw: 0.6 }, kOut],
    [PYRE_T, { pyre: 0.5, palm: 0.6 }, kIO],
    // Встаёт (уже в погоне): угли осыпаются с пальцев.
    [PYRE_END, { ...b }, kIO],
  ];
  return kCompile(keys, b);
}

function kCast(k: KT): (t: number) => KR {
  const b = k.b;
  const keys: KKey[] = [
    [0, {}],
    // Скользит к помосту: ступни над полом, рукава назад.
    [0.15, {
      by: 2, lfy: 2, rfy: 2, lky: 9, rky: 9, lean: -1, nod: 1, eyes: 3, glow: 1, aura: 0.4,
      ruex: 5, ruey: 6, ruhx: 9, ruhy: 11, luex: 5, luey: 6, luhx: 9, luhy: 11,
    }, kOut],
    [0.6, { by: 2.5 }, kIO],
    [0.75, { by: 0, lfy: 0, rfy: 0, lky: 8, rky: 8, lean: 0, fsx: 1.05, fsy: 0.95 }, kIn],
    [0.9, { fsx: 1, fsy: 1, ruex: 4, ruey: 7, ruhx: 5, ruhy: 14, luex: 4, luey: 7, luhx: 5, luhy: 14 }, kOut],
    [1.2, { aura: 0.45 }, kIO],
    // Руки складываются в знак по одной: щелчок — свет.
    [1.45, { rlex: 3, rley: 6, rlhx: -7, rlhy: 4, rlk: HK.sign, sign: 0.3, aura: 0.55 }, kOut],
    [1.7, { llex: 3, lley: 6, llhx: -7, llhy: 4, llk: HK.sign, sign: 0.45, belly: 0.3, aura: 0.7 }, kOut],
    [1.95, { ruex: 4, ruey: 7, ruhx: -8, ruhy: 3, ruk: HK.sign, sign: 0.65, belly: 0.6, aura: 0.85, nod: 0 }, kOut],
    [2.2, { luex: 4, luey: 7, luhx: -8, luhy: 3, luk: HK.sign, sign: 1, belly: 1, aura: 1, mjaw: 1 }, kOut],
    // Последнее усилие: голова назад, всё горит.
    [2.45, { nod: -1, hy: -1, jaw: 0.75, flare: 0.6, br: 1 }, kIO],
    [KING.cast, { flare: 1 }, kIn],
  ];
  const ev = kCompile(keys, b);
  // Каждая рука встала в знак — щелчок света; в конце — самый сильный.
  const clicks = [1.45, 1.7, 1.95, 2.2, KING.cast - 0.05];
  return (t: number) => {
    const r = ev(t);
    let c = 0;
    for (let i = 0; i < clicks.length; i++) {
      const x = t - clicks[i];
      const v = x < -0.04 || x > 0.14 ? 0 : x < 0 ? (x + 0.04) / 0.04 : 1 - x / 0.14;
      c = Math.max(c, v * (i === clicks.length - 1 ? 1 : 0.7));
    }
    r.click = c;
    return r;
  };
}

/** Храм: сидит в знаке, дышит, рот на поясе открыт. */
function kMed(ph: number, k: KT): KR {
  const r = { ...k.b, ...KSIT2, aura: 1, sign: 0.7, belly: 0.75, glow: 1, m2: 1 } as KR;
  const a = ph * TAU;
  r.br = Math.round(0.5 - 0.5 * Math.cos(a));
  r.belly = r.br ? 1 : 0.75;
  r.sign = r.br ? 0.9 : 0.7;
  if (ph > 0.6 && ph < 0.66) r.m2 = 0.4;
  if (ph > 0.25 && ph < 0.5) r.mjaw = 1;
  return r;
}

function kDsit(k: KT): (t: number) => KR {
  const from = kCast(k)(KING.cast);
  const keys: KKey[] = [
    [0, {}],
    [0.06, { flare: 0.6 }, kOut],
    [0.3, { ...KSIT2, nod: 0, hy: 0, jaw: 0.6, fsx: 1.06, fsy: 0.93, aura: 1 }, kIn],
    [DSIT_END, { fsx: 1, fsy: 1, flare: 0, jaw: 0, sign: 0.7, br: 0, belly: 0.75 }, kOut],
  ];
  return kCompile(keys, from);
}

/** Сетка храма: ладони чертят линии, замах вверх, приговор вниз — ровно в разрез. */
function kDgrid(k: KT): (t: number) => KR {
  const med = kMed(0, k);
  const keys: KKey[] = [
    [0, {}],
    [0.18, {
      eyes: 3, nod: -1, ruk: HK.open, luk: HK.open, ruex: 6, ruey: -2, ruhx: 5, ruhy: -9,
      luex: 6, luey: -2, luhx: 5, luhy: -9, sign: 0.4, jaw: 0.3,
    }, kOut],
    [0.7, { ruex: 8, ruey: -1, ruhx: 14, ruhy: -4, luex: 8, luey: -1, luhx: 14, luhy: -4, ruk: HK.two, luk: HK.two, fing: 0.6 }, kIO],
    [GRID_T - 3 * KF, { ruex: 6, ruey: -6, ruhx: 9, ruhy: -14, luex: 6, luey: -6, luhx: 9, luhy: -14, fing: 1, mjaw: 1, flare: 0.3 }, kOut],
    [GRID_T, {
      ruex: 8, ruey: 2, ruhx: 14, ruhy: 9, luex: 8, luey: 2, luhx: 14, luhy: 9,
      jaw: 1, belly: 1, fsy: 0.96, fsx: 1.03, flare: 0.9, nod: 0, fing: 0.5,
    }, kIn],
    [GRID_T + 0.18, { fsy: 1, fsx: 1, fing: 0 }, kOut],
    [GRID_T + KING.gridCut, { flare: 0.3, jaw: 0.6 }, kIO],
    [GRID_END, { ...med }, kIO],
  ];
  return kCompile(keys, med);
}

/** Разрезы с помоста: правая верхняя выходит из знака, два пальца — взмах. */
function kDcut(k: KT): (t: number) => KR {
  const med = kMed(0, k);
  const keys: KKey[] = [
    [0, {}],
    [0.14, { ruk: HK.two, ruex: 6, ruey: -5, ruhx: 4, ruhy: -13, fing: 0.3, eyes: 2 }, kOut],
    [DCUT_T - 3 * KF, { ruex: 3, ruey: -8, ruhx: -2, ruhy: -14, fing: 1, jaw: 0.4 }, kIO],
    [DCUT_T, { ruex: 8, ruey: 1, ruhx: 14, ruhy: 6, fing: 0.4, jaw: 0.8 }, kIn],
    [DCUT_T + 0.15, { ruex: 6, ruey: 6, ruhx: 3, ruhy: 12, fing: 0, jaw: 0.3 }, kOut],
    [DCUT_END, { ...med }, kIO],
  ];
  return kCompile(keys, med);
}

function kBroken(k: KT): (t: number) => KR {
  const b = k.b;
  const from = { ...b, ...KSIT2, aura: 1, sign: 0.7, belly: 1, glow: 1, m2: 1, crack: 0 } as KR;
  const keys: KKey[] = [
    [0, {}],
    // Храм рухнул: рывок, голова назад, крик; маска трескается.
    [0.12, {
      hip: 10, by: 1, hy: -2, nod: -1, jaw: 1, eyes: 3, crack: 1, sign: 0, aura: 0.3, flare: 0.8,
      ruk: HK.open, luk: HK.open, rlk: HK.open, llk: HK.open,
      ruex: 7, ruey: -2, ruhx: 12, ruhy: -6, luex: 7, luey: -2, luhx: 12, luhy: -6,
      rlex: 6, rley: 2, rlhx: 11, rlhy: 4, llex: 6, lley: 2, llhx: 11, llhy: 4,
      lkx: -10, lky: 6, rkx: 10, rky: 6, lfx: -6, rfx: 6, lfy: 0, rfy: 0,
    }, kOut],
    [0.2, { crack: 2 }, kLin],
    [0.28, { crack: 3, flare: 0 }, kLin],
    // Оседает на колено.
    [0.42, { ...KKNEEL, by: 0, hy: 2, nod: 1, jaw: 0.4, eyes: 2, belly: 0.4, fsx: 1.07, fsy: 0.92, glow: 0.3, mjaw: 0, m2: 0.4, aura: 0 }, kIn],
    [0.55, { fsx: 1, fsy: 1, stars: 1 }, kOut],
    [3.45, { stars: 1 }, kLin],
    // Мотает головой, приходит в себя.
    [3.6, { stars: 0, hy: 0, nod: 0, hx: 1, eyes: 1 }, kIO],
    [3.72, { hx: -1 }, kIO],
    [3.82, { hx: 0, eyes: 2, glow: 0.8, m2: 1 }, kIO],
    [KING.broken, { ...b, crack: 3 }, kIO],
  ];
  const ev = kCompile(keys, from);
  return (t: number) => {
    const r = ev(t);
    // Тяжело дышит: плечи ходят, рот на поясе хватает воздух.
    if (t > 0.55 && t < 3.6) {
      const a = ((t - 0.55) / 0.6) * TAU;
      r.br = Math.round(0.5 - 0.5 * Math.cos(a));
      r.belly = r.br ? 0.55 : 0.25;
      r.hy += Math.round(Math.sin(a * 0.5));
    }
    return r;
  };
}

function kTrain(k: KT): (t: number) => KR {
  const b = k.b;
  const d = k.dir;
  const curled: Partial<KR> = {
    hip: 12, lkx: -6, lky: 13, lfx: -5, lfy: 7, rkx: 6, rky: 13, rfx: 5, rfy: 7,
    ruex: 2, ruey: 5, ruhx: -7, ruhy: 1, luex: 2, luey: 5, luhx: -7, luhy: 1,
    rlex: 2, rley: 4, rlhx: -6, rlhy: 6, llex: 2, lley: 4, llhx: -6, llhy: 7,
    ruk: HK.fist, luk: HK.fist, rlk: HK.fist, llk: HK.fist, nod: 1, eyes: 3, jaw: 1,
  };
  const keys: KKey[] = [
    [0, { jaw: 1, eyes: 3, hy: -1, lean: -2 }],
    // Кувырок вбок: поджался, оборот в воздухе.
    [0.08, { ...curled, frot: d * 1.3, air: 9, hy: 0, lean: 0 }, kOut],
    [0.3, { frot: d * TAU * 0.86, air: 9 }, kLin],
    // Упал на колено, сплющился.
    [0.42, { ...KKNEEL, frot: d * TAU, air: 0, fsx: 1.12, fsy: 0.86, jaw: 0.5, eyes: 2, nod: 1, hy: 2 }, kIn],
    [0.54, { fsx: 1, fsy: 1, stars: 1 }, kOut],
    [1.9, { stars: 1 }, kLin],
    [2.05, { stars: 0, hy: 0, nod: 0, hx: 1 }, kIO],
    [KING.trainStun, { ...b, frot: d * TAU }, kIO],
  ];
  const ev = kCompile(keys, b);
  return (t: number) => {
    const r = ev(t);
    if (t > 0.54 && t < 2.0) {
      const a = ((t - 0.54) / 0.55) * TAU;
      r.br = Math.round(0.5 - 0.5 * Math.cos(a));
      r.hx += Math.round(Math.sin(a * 0.5));
    }
    return r;
  };
}

function kDeath(k: KT): (t: number) => KR {
  const b = k.b;
  const keys: KKey[] = [
    [0, {}],
    // Добит: голова назад, крик, руки вразлёт.
    [0.08, {
      hy: -2, nod: -1, jaw: 1, eyes: 3, glow: 1, lean: -1, flare: 1, mjaw: 1,
      ruex: 7, ruey: -3, ruhx: 13, ruhy: -8, ruk: HK.claw, luex: 7, luey: -3, luhx: 13, luhy: -8, luk: HK.claw,
      rlex: 6, rley: 1, rlhx: 11, rlhy: 1, rlk: HK.open, llex: 6, lley: 1, llhx: 11, llhy: 1, llk: HK.open,
    }, kOut],
    // Колени подламываются.
    [0.3, { hip: 11, lkx: -8, lky: 4, rkx: 8, rky: 4, lfx: -5, rfx: 5, lfy: 2, rfy: 2, flare: 0.4, lean: 0 }, kIO],
    // На коленях, голова упала.
    [0.5, {
      hip: 8, bend: 2, lkx: -7, lky: 1.5, rkx: 7, rky: 1.5, lfx: -3, lfy: 3, rfx: 3, rfy: 3,
      hy: 2, nod: 2, jaw: 0.3, eyes: 0, glow: 0, flare: 0, aura: 0, mjaw: 0, m2: 0,
      ruex: 3, ruey: 8, ruhx: 4, ruhy: 15, ruk: HK.open, luex: 3, luey: 8, luhx: 4, luhy: 15, luk: HK.open,
      rlex: 3, rley: 7, rlhx: 3, rlhy: 13, llex: 3, lley: 7, llhx: 3, llhy: 13, fsx: 1.04, fsy: 0.95,
    }, kIn],
    [0.6, { fsx: 1, fsy: 1 }, kOut],
  ];
  return kCompile(keys, b);
}

/** Смена фазы поверх любой позы. 1 — глаз маски распахивается; 3 — рёв. */
function kOverlay(r: KR, ov: number, t: number): KR {
  if (ov === 1) {
    const keys: KKey[] = [
      [0, { m2: 0, mb: 0, mjaw: 0 }],
      [0.1, { hx: r.hx - 1 }, kOut],
      [0.22, { m2: 0.4, hx: r.hx }, kIO],
      [0.34, { m2: 1.5, mb: 1, mjaw: 1, eyes: 2 }, kOut],
      [0.7, { mb: 0.2 }, kIO],
      [0.9, { m2: 1, mb: 0, mjaw: 0, eyes: r.eyes }, kIO],
    ];
    return kTrack(keys, t, r);
  }
  const keys: KKey[] = [
    [0, {}],
    [0.14, { jaw: 1, eyes: 3, flare: 1, br: 1, glow: 1, nod: -1 }, kOut],
    [0.55, { jaw: 1, flare: 0.8 }, kLin],
    [0.8, { jaw: r.jaw, flare: r.flare, br: r.br, nod: r.nod }, kIO],
  ];
  return kTrack(keys, t, r);
}

// ---- Смерть: пепел снизу вверх, маска падает последней ---------------------

const K_EMBER = hx('#ff3a6a');
/** Маска отрывается в этот миг смерти. */
const MASK_OFF = 0.6;

/** Тело осыпается: сверху вниз пиксели вспыхивают углём, пепел оседает кучкой. */
function kCrumble(p: Px, lit: Px, t: number): Px {
  if (t < MASK_OFF) return p;
  let y0 = KH;
  let y1 = 0;
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++)
      if (p.data[(y * p.w + x) * 4 + 3]) {
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        break;
      }
  const o = new Px(p.w, p.h);
  const span = Math.max(1, y1 - y0);
  const fade = t > 1.2 ? Math.max(0, 1 - (t - 1.2) / 0.22) : 1;
  for (let y = y0; y <= y1; y++)
    for (let x = 0; x < p.w; x++) {
      const i = (y * p.w + x) * 4;
      if (!p.data[i + 3]) continue;
      const ts = MASK_OFF + ((y - y0) / span) * 0.46 + hash(x, y, 5) * 0.12;
      if (t < ts) {
        o.data[i] = p.data[i];
        o.data[i + 1] = p.data[i + 1];
        o.data[i + 2] = p.data[i + 2];
        o.data[i + 3] = p.data[i + 3];
        continue;
      }
      const a = t - ts;
      const r = hash(x, y, 9);
      if (a < 0.05) {
        o.set(x, y, K_ASH[2]);
        lit.set(x, y, alpha(hx('#ff6a4a'), 0.9));
        continue;
      }
      if (r < 0.17) {
        // Уголёк уходит вверх и гаснет.
        if (a < 0.5)
          lit.set(x + (hash(x, y, 2) - 0.5) * a * 12, y - a * 20 - a * a * 10, alpha(r < 0.06 ? hx('#ffc080') : K_EMBER, 1 - a / 0.5));
      } else if (fade > 0) {
        // Пепел оседает в кучку у ног.
        const yy = Math.min(KGY - (hash(x, y, 4) < 0.4 ? 1 : 0), y + a * a * 170);
        o.set(x + (hash(x, y, 2) - 0.5) * a * 7, yy, alpha(K_ASH[Math.floor(hash(x, y, 6) * 3)], fade));
      }
    }
  return o;
}

/** Повернуть маленький холст и положить в точку (ближайший пиксель). */
function kBlitRot(dst: Px, src: Px, cx: number, cy: number, ang: number, a: number): void {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const R = Math.ceil(Math.hypot(src.w, src.h) / 2) + 1;
  const ox = src.w / 2;
  const oy = src.h / 2;
  for (let y = -R; y <= R; y++)
    for (let x = -R; x <= R; x++) {
      const u = Math.floor(x * c + y * s + ox);
      const v = Math.floor(-x * s + y * c + oy);
      if (u < 0 || v < 0 || u >= src.w || v >= src.h) continue;
      const i = (v * src.w + u) * 4;
      if (!src.data[i + 3]) continue;
      dst.set(Math.round(cx + x), Math.round(cy + y), [src.data[i], src.data[i + 1], src.data[i + 2], Math.round(src.data[i + 3] * a)]);
    }
}

/** Маска отрывается от лица, падает с оборотом, подскакивает, лежит, раскалывается и гаснет последней. */
function kMaskFall(p: Px, t: number, k: KT): void {
  if (t < MASK_OFF) return;
  const r0 = kRigFn('death', k)(MASK_OFF);
  const g0 = kGeo(r0);
  const mx0 = g0.hcx - 6 + Math.round(r0.look * 0.5);
  const my0 = g0.hcy + 0.8 + Math.round(r0.nod) * 0.5;
  const tt = t - MASK_OFF;
  const floorY = KGY - 2;
  const G = 360;
  const tl = Math.sqrt((2 * Math.max(1, floorY - my0)) / G);
  let x: number;
  let y: number;
  let ang: number;
  if (tt < tl) {
    x = mx0 - tt * 12;
    y = my0 + 0.5 * G * tt * tt;
    ang = -tt * 7;
  } else {
    const tb = tt - tl;
    const k1 = Math.min(1, tb / 0.18);
    x = mx0 - tl * 12 - k1 * 3;
    y = floorY - Math.sin(k1 * Math.PI) * 3;
    ang = -tl * 7 + (-Math.PI / 2 + tl * 7) * kOut(k1);
  }
  const m = new Px(9, 11);
  shadeEll(m, 4.5, 5.5, 2.9, 4.1, K_MASK, 0.05);
  m.set(4, 5, K_TAT);
  m.set(3, 5, K_TAT);
  for (let xx = 2; xx <= 5; xx++) m.set(xx, 8, xx % 2 ? BONE[3] : K_TAT);
  m.set(5, 2, K_TAT);
  m.set(5, 3, K_TAT);
  m.set(4, 4, K_TAT);
  m.set(3, 6, K_TAT);
  if (t > 1.12) for (let yy = 1; yy < 10; yy++) clr(m, 4 + (yy % 2), yy);
  m.outline(INK);
  const a = t > 1.3 ? Math.max(0, 1 - (t - 1.3) / 0.15) : 1;
  kBlitRot(p, m, x, y, ang, a);
}

// ---- Кадр: режим мозга → техника, кадр; кеш, зеркало, вспышка ----------

type KTech =
  | 'idle' | 'run' | 'intro' | 'cut' | 'cleave' | 'bow' | 'pyre' | 'cast'
  | 'dsit' | 'dmed' | 'dgrid' | 'dcut' | 'broken' | 'train' | 'death';

interface KQ {
  tech: KTech;
  f: number;
  hk: number;
  p1: boolean;
  rage: boolean;
  crack: number;
  edge: boolean;
  /** Вздрог от удара героя: 0, 1, 2 (в покое и на ходу). */
  fl: number;
  /** Смена фазы поверх позы (1 или 3) и её кадр. */
  ov: number;
  of: number;
  dir: number;
  /** Угол удара шагом 30°: −3…3. */
  aim: number;
  flip: boolean;
  flash: boolean;
}

const LOOPS: Partial<Record<KTech, number>> = { idle: 24, dmed: 24, run: 8 };
const fr1 = (x: number) => ((x % 1) + 1) % 1;

function kCtx(q: KQ): KT {
  const b = { ...KB0 };
  b.m2 = q.p1 ? 1 : 0;
  b.glow = q.rage ? 1 : 0.6;
  b.aura = q.rage ? 0.3 : 0;
  b.crack = q.crack;
  return { h: q.hk / 100, b, n: q.rage ? 5 : 3, dir: q.dir, aim: (q.aim * Math.PI) / 6 };
}

/** Длительность техники и её такт (сетка кадров выровнена так, что такт — ровно кадр). */
function kSpan(tech: KTech, k: KT): { dur: number; beat: number } {
  switch (tech) {
    case 'intro':
      return { dur: KING.intro, beat: 0 };
    case 'cut':
      return { dur: tCutEnd(k), beat: tCut(k) };
    case 'cleave':
      return { dur: tCleaveEnd(k), beat: tClaw(k) };
    case 'bow':
      return { dur: tBowEnd(k), beat: tBow(k) };
    case 'pyre':
      return { dur: PYRE_END, beat: 0 };
    case 'cast':
      return { dur: KING.cast, beat: 0 };
    case 'dsit':
      return { dur: DSIT_END, beat: 0 };
    case 'dgrid':
      return { dur: GRID_END, beat: GRID_T };
    case 'dcut':
      return { dur: DCUT_END, beat: DCUT_T };
    case 'broken':
      return { dur: KING.broken, beat: 0 };
    case 'train':
      return { dur: KING.trainStun, beat: 0 };
    case 'death':
      return { dur: DEATH_T, beat: 0 };
    default:
      return { dur: 1, beat: 0 };
  }
}

const kDelta = (beat: number) => beat - Math.floor(beat * KFPS + 1e-6) / KFPS;

function kCount(tech: KTech, k: KT): number {
  const lp = LOOPS[tech];
  if (lp) return lp;
  const { dur, beat } = kSpan(tech, k);
  return Math.floor((dur - kDelta(beat)) * KFPS + 1e-6) + 1;
}

/**
 * Номер кадра техники в миг `t` режима. Кадр стоит полкадра до своей
 * выборки и полкадра после: кадр контакта центрирован на миге урона.
 */
function kFrameAt(tech: KTech, k: KT, t: number): number {
  const d = kDelta(kSpan(tech, k).beat);
  return kc(Math.floor((t - d) * KFPS + 0.5 + 1e-6), 0, kCount(tech, k) - 1);
}

/** Когда снят кадр f. */
function kTimeOf(tech: KTech, f: number, k: KT): number {
  if (tech === 'idle' || tech === 'dmed') return f / 10;
  if (tech === 'run') return (f / 8) * RUN_T;
  return Math.max(0, f / KFPS + kDelta(kSpan(tech, k).beat));
}

const KFN = new Map<string, (t: number) => KR>();

/** Поза техники как функция времени; собирается один раз на технику и фазу. */
function kRigFn(tech: KTech, k: KT): (t: number) => KR {
  const key = `${tech}|${k.h}|${k.b.m2}|${k.b.glow}|${k.b.aura}|${k.b.crack}|${k.dir}|${k.aim}`;
  const got = KFN.get(key);
  if (got) return got;
  let fn: (t: number) => KR;
  switch (tech) {
    case 'idle':
      fn = (t) => kIdle(fr1(t / 2.4), k.b);
      break;
    case 'run':
      fn = (t) => kRun(fr1(t / RUN_T), k.b);
      break;
    case 'dmed':
      fn = (t) => kMed(fr1(t / 2.4), k);
      break;
    case 'intro':
      fn = kIntro(k);
      break;
    case 'cut':
      fn = kCut(k);
      break;
    case 'cleave':
      fn = kCleave(k);
      break;
    case 'bow':
      fn = kBow(k);
      break;
    case 'pyre':
      fn = kPyre(k);
      break;
    case 'cast':
      fn = kCast(k);
      break;
    case 'dsit':
      fn = kDsit(k);
      break;
    case 'dgrid':
      fn = kDgrid(k);
      break;
    case 'dcut':
      fn = kDcut(k);
      break;
    case 'broken':
      fn = kBroken(k);
      break;
    case 'train':
      fn = kTrain(k);
      break;
    case 'death':
      fn = kDeath(k);
      break;
  }
  if ((tech === 'cut' || tech === 'cleave' || tech === 'bow') && k.aim) {
    // Выпад и отдача — по направлению удара, а не только вбок.
    const raw = fn;
    const c = Math.cos(k.aim);
    const sn = Math.sin(k.aim);
    fn = (t) => {
      const r = raw(t);
      const v = r.fdx;
      r.fdx = v * c;
      r.fdy += v * sn;
      return r;
    };
  }
  KFN.set(key, fn);
  return fn;
}

/** Путь кисти назад во времени, в координатах текущего кадра. */
function kPath(at: (t: number) => KR, a: K4, t: number, from: number, now: KR, step = 1 / 72): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= 12; i++) {
    const s = t - i * step;
    if (s < from - 1e-6) break;
    const r = i ? at(s) : now;
    const g = kGeo(r);
    out.push([g.H[a][0] + r.fdx - now.fdx, g.H[a][1] + r.fdy - now.fdy]);
  }
  return out;
}

function kSmearsOf(tech: KTech, t: number, k: KT, at: (t: number) => KR, r: KR): KSmear[] {
  const win = (a: number, b: number) => t >= a && t <= b;
  if (tech === 'cut') {
    const T = tCut(k);
    if (win(T - 2 * KF, T + 2 * KF)) return [{ pts: kPath(at, 'ru', t, T - 2 * KF, r), w: 3, kind: 'cut' }];
  }
  if (tech === 'cleave') {
    const T = tClaw(k);
    if (win(T - 2 * KF, T))
      return (['ru', 'lu'] as K4[]).map((a) => ({ pts: kPath(at, a, t, T - 2 * KF, r), w: 2, kind: 'claw' as const }));
  }
  if (tech === 'dgrid' && win(GRID_T - 3 * KF, GRID_T + KF))
    return (['ru', 'lu'] as K4[]).map((a) => ({ pts: kPath(at, a, t, GRID_T - 3 * KF, r), w: 3, kind: 'cut' as const }));
  if (tech === 'dcut' && win(DCUT_T - 3 * KF, DCUT_T + 2 * KF))
    return [{ pts: kPath(at, 'ru', t, DCUT_T - 3 * KF, r), w: 3, kind: 'cut' }];
  return [];
}

function kTrailOf(tech: KTech, t: number, k: KT, at: (t: number) => KR, r: KR): KTrail | null {
  if (tech === 'cleave') {
    const Tc = tClaw(k);
    if (t < Tc || t > Tc + 0.28) return null;
    // Две косые борозды через грудь — от вскинутых когтей до скрещённых рук.
    const rc = at(Tc);
    const g = kGeo(rc);
    const ox = rc.fdx - r.fdx;
    const oy = rc.fdy - r.fdy;
    const cx = g.cx + g.L + ox;
    const cy = g.sy + 1 + oy;
    return {
      pts: [],
      tear: [
        [cx + 16, cy - 9, cx - 12, cy + 15],
        [cx - 16, cy - 9, cx + 12, cy + 15],
      ],
      age: t - Tc,
      n: 1,
      gap: 0,
    };
  }
  let T = -1;
  let n = 3;
  let gap = 0.07;
  if (tech === 'cut') {
    T = tCut(k);
    n = k.n;
    gap = 0.07 / k.h;
  } else if (tech === 'dcut') T = DCUT_T;
  if (T < 0 || t < T || t > T + gap * (n - 1) + 0.4) return null;
  // Разрез — дуга взмаха вокруг контакта, продлённая за концы: воздух
  // рассечён дальше, чем прошла рука. В координатах текущего кадра.
  const rc = at(T + KF);
  const pts = kPath(at, 'ru', T + KF, T - 2 * KF, rc, 1 / 48).map(([x, y]) => [x + rc.fdx - r.fdx, y + rc.fdy - r.fdy] as [number, number]);
  if (pts.length >= 2) {
    const ext = (a: [number, number], b: [number, number]): [number, number] => {
      const dx = a[0] - b[0];
      const dy = a[1] - b[1];
      const d = Math.hypot(dx, dy) || 1;
      return [a[0] + (dx / d) * 5, a[1] + (dy / d) * 5];
    };
    pts.unshift(ext(pts[0], pts[1]));
    pts.push(ext(pts[pts.length - 1], pts[pts.length - 2]));
  }
  return { pts, age: t - T, n, gap };
}

const KFR = frameLRU<MobFrame>(440);

function kKey(q: KQ, v: boolean): string {
  const s = `${q.tech}|${q.f}|${q.hk}|${q.p1 ? 1 : 0}${q.rage ? 1 : 0}${q.crack}${q.edge ? 1 : 0}|${q.fl}|${q.ov}:${q.of}|${q.tech === 'train' ? q.dir : 0}|${q.aim}`;
  return v ? `v|${s}|${q.flip ? 1 : 0}${q.flash ? 1 : 0}` : `b|${s}`;
}

/** Рамка нарисованного (по обоим слоям). */
function kBox(p: Px, box: number[]): void {
  const [x0, y0, x1, y1] = kBoxOf(p);
  if (x1 < 0) return;
  if (x0 < box[0]) box[0] = x0;
  if (y0 < box[1]) box[1] = y0;
  if (x1 > box[2]) box[2] = x1;
  if (y1 > box[3]) box[3] = y1;
}

function kCanvas(p: Px, x0: number, y0: number, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (g) {
    const img = g.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      const o = ((y0 + y) * p.w + x0) * 4;
      img.data.set(p.data.subarray(o, o + w * 4), y * w * 4);
    }
    g.putImageData(img, 0, 0);
  }
  return c;
}

/** Кадр без зеркала и вспышки. */
function kingBuilt(q: KQ): MobFrame {
  const key = kKey(q, false);
  const got = KFR.get(key);
  if (got) return got;
  const k = kCtx(q);
  const at = kRigFn(q.tech, k);
  const t = kTimeOf(q.tech, q.f, k);
  let r = at(t);
  if (q.ov) r = kOverlay(r, q.ov, q.of / KFPS);
  if (q.fl) {
    // Вздрог: голова назад, плечи вверх, оскал сквозь зубы.
    r.hy -= q.fl;
    r.br = 1;
    r.eyes = Math.max(r.eyes, 2);
    r.jaw = Math.max(r.jaw, 0.4);
    r.lean -= q.fl * 0.5;
  }
  const loop = !!LOOPS[q.tech];
  const sec = kSecAt(at, t, loop ? -1e9 : 0);
  if (q.tech === 'idle' || q.tech === 'dmed') sec.hs += Math.round(Math.sin((t / 2.4) * TAU + 1)) * 0.6;
  const o: KOpt = {
    fi: q.f,
    edge: q.edge,
    rage: q.rage,
    sec,
    smears: kSmearsOf(q.tech, t, k, at, r),
    trail: kTrailOf(q.tech, t, k, at, r),
    noMask: q.tech === 'death' && t >= MASK_OFF,
    st: t,
  };
  const painted = kPaint(r, o);
  let p = painted.p;
  const lit = painted.lit;
  const g = painted.g;
  let eye: [number, number] | null = [g.hcx + 2 + Math.round(r.look), g.hcy + Math.round(r.nod)];
  if (q.tech === 'death') {
    p = kCrumble(p, lit, t);
    kMaskFall(p, t, k);
    if (t > 0.45) eye = null;
  }
  const box = [KW, KH, -1, -1];
  kBox(p, box);
  const litBox = [KW, KH, -1, -1];
  kBox(lit, litBox);
  const hasLit = litBox[2] >= 0;
  if (hasLit) {
    box[0] = Math.min(box[0], litBox[0]);
    box[1] = Math.min(box[1], litBox[1]);
    box[2] = Math.max(box[2], litBox[2]);
    box[3] = Math.max(box[3], litBox[3]);
  }
  if (box[2] < 0) box.splice(0, 4, KCX, KGY - 1, KCX, KGY);
  const x0 = Math.max(0, box[0] - 1);
  const y0 = Math.max(0, box[1] - 1);
  const w = Math.min(KW, box[2] + 2) - x0;
  const h = Math.min(KH, box[3] + 2) - y0;
  // Наклон движок делает вокруг ног; кувырок — вокруг середины тела.
  const rot = Math.atan2(Math.sin(r.frot), Math.cos(r.frot));
  const C = 20;
  const cdx = rot ? -C * Math.sin(rot) : 0;
  const cdy = rot ? -C + C * Math.cos(rot) : 0;
  const out: MobFrame = {
    img: kCanvas(p, x0, y0, w, h),
    lit: hasLit ? kCanvas(lit, x0, y0, w, h) : null,
    ax: KCX - x0,
    ay: KGY - y0,
    eye: eye ? [eye[0] - x0, eye[1] - y0] : null,
    dx: r.fdx + cdx,
    dy: r.fdy - r.air + cdy,
    sx: r.fsx,
    sy: r.fsy,
    rot,
    still: true,
    shadow: Math.round((r.hip < 8 ? 17 : 14) * (1 - Math.min(0.5, r.air / 24))),
  };
  if (q.tech === 'death') out.linger = DEATH_T;
  return KFR.set(key, out);
}

function kMirror(src: HTMLCanvasElement): HTMLCanvasElement {
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

function kWhite(src: HTMLCanvasElement): HTMLCanvasElement {
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

function kingFrame(q: KQ): MobFrame {
  if (!q.flip && !q.flash) return kingBuilt(q);
  const key = kKey(q, true);
  const got = KFR.get(key);
  if (got) return got;
  if (q.flash) {
    const src = kingFrame({ ...q, flash: false });
    return KFR.set(key, { ...src, img: kWhite(src.img) });
  }
  const b = kingBuilt({ ...q, flip: false });
  const w = b.img.width;
  return KFR.set(key, {
    ...b,
    img: kMirror(b.img),
    lit: b.lit ? kMirror(b.lit) : null,
    eye: b.eye ? [w - 1 - b.eye[0], b.eye[1]] : null,
    ax: w - b.ax,
    dx: -(b.dx ?? 0),
    rot: -(b.rot ?? 0),
  });
}

// ---- Память о прошлом режиме (стол, шаг, смена фазы, кувырок) ----------

interface KMem {
  mode: string;
  prev: string;
  now: number;
  walk: number;
  phase: number;
  phAt: number;
  phTo: number;
  dir: number;
}
const kMem = new Map<number, KMem>();

function kMemOf(m: Mob, pose: MobPose): { s: KMem; fresh: boolean } {
  let s = kMem.get(m.id);
  const fresh = !s || pose.now < s.now - 1e-3 || pose.now - s.now > 3;
  if (!s || fresh) {
    s = { mode: pose.mode, prev: '', now: pose.now, walk: 0, phase: m.data.phase ?? 0, phAt: -1e9, phTo: 0, dir: 1 };
    kMem.set(m.id, s);
  }
  if (pose.mode !== s.mode) {
    s.prev = s.mode;
    s.mode = pose.mode;
  }
  const dt = kc(pose.now - s.now, 0, 0.1);
  s.now = pose.now;
  s.walk += Math.hypot(m.vx ?? 0, m.vy ?? 0) * 16 * dt;
  const ph = m.data.phase ?? 0;
  if (ph > s.phase) {
    s.phAt = pose.now;
    s.phTo = ph;
  }
  s.phase = ph;
  if (pose.mode === 'f12_trainhit' && pose.t < 0.2 && Math.abs(m.ky ?? 0) > 1) s.dir = Math.sign(m.ky);
  return { s, fresh };
}

function kingReq(m: Mob, pose: MobPose): KQ {
  const { s, fresh } = kMemOf(m, pose);
  const phase = m.data.phase ?? 0;
  const mode = pose.mode;
  const q: KQ = {
    tech: 'idle',
    f: 0,
    hk: phase >= 3 ? 130 : 100,
    p1: phase >= 1,
    rage: phase >= 3,
    crack: phase >= 2 && mode !== 'f12_cast' && mode !== 'f12_domain' ? 3 : 0,
    edge: (m.data.ghost ?? 0) > 0,
    fl: 0,
    ov: 0,
    of: 0,
    dir: m.data.vKy ? Math.sign(m.data.vKy) : s.dir,
    aim: 0,
    flip: pose.left,
    // Смерть белым не мигает: копия убранного моба держит последнюю вспышку.
    flash: pose.flash && (mode !== 'dying' || pose.t < 0.08),
  };
  // Угол на цель в кадре «смотрит вправо» (зеркало сделает кадр): шагом 30°.
  const aimOf = (a: number) => {
    const th = Math.atan2(Math.sin(a), Math.abs(Math.cos(a)));
    return kc(Math.round(th / (Math.PI / 6)), -3, 3);
  };
  const vAim = m.data.vAim;
  if (mode === 'f12_cut' || mode === 'f12_cleave' || mode === 'f12_bow' || mode === 'recover')
    q.aim = aimOf(vAim ?? (mode === 'f12_bow' || (mode === 'recover' && (m.data.bowCd ?? 0) > 5) ? (m.data.ang ?? m.face) : m.face));
  const k = kCtx(q);
  const t = Math.max(0, pose.t);
  const at = (tech: KTech, tt: number) => {
    q.tech = tech;
    q.f = kFrameAt(tech, k, tt);
  };
  switch (mode) {
    case 'f12_intro':
      at('intro', t);
      q.flip = false;
      break;
    case 'f12_cut':
      at('cut', t);
      break;
    case 'f12_cleave':
      at('cleave', t);
      break;
    case 'f12_bow':
      at('bow', Math.min(t, tBow(k) - 1e-3));
      break;
    case 'f12_pyre':
      at('pyre', t);
      break;
    case 'f12_cast':
      at('cast', t);
      q.flip = false;
      break;
    case 'f12_domain': {
      q.flip = false;
      if (t < DSIT_END) {
        at('dsit', t);
        break;
      }
      const sim = paintSim();
      const ks = sim ? f12King(sim) : null;
      const tg = sim && ks && ks.cutAt > 0 ? sim.time - (ks.cutAt - KING.gridWarn) : -1;
      const tc = 4.2 - (m.data.cutCd ?? 0);
      const sg = m.data.vSheetGrid ? fr1((t - DSIT_END) / (GRID_END + 0.4)) * (GRID_END + 0.4) : -1;
      const sc = m.data.vSheetCut ? fr1((t - DSIT_END) / (DCUT_END + 0.4)) * (DCUT_END + 0.4) : -1;
      if (tg >= 0 && tg < GRID_END) at('dgrid', tg);
      else if (sg >= 0 && sg < GRID_END) at('dgrid', sg);
      else if (ks && tc >= 0 && tc < DCUT_END) at('dcut', tc);
      else if (sc >= 0 && sc < DCUT_END) at('dcut', sc);
      else {
        q.tech = 'dmed';
        q.f = Math.floor(pose.now * 10 + (m.id ?? 0) * 3.7) % 24;
      }
      break;
    }
    case 'f12_broken':
      at('broken', t);
      q.flip = false;
      break;
    case 'f12_trainhit':
      at('train', t);
      break;
    case 'recover': {
      // Чем кончился удар — по откату мозга: стрела ставит 6–8,5, рассечение 3,2.
      if ((m.data.bowCd ?? 0) > 5) at('bow', tBow(k) + t);
      else if ((m.data.cutCd ?? 0) > 2.25) at('cut', tCut(k) + 0.1 + t);
      else at('cleave', tCross(k) + 0.1 + t);
      break;
    }
    case 'dying':
      at('death', t);
      break;
    default: {
      // Только что был столб пламени — встаёт из приседа.
      const tp = (7.5 - (m.data.pyreCd ?? 0)) / k.h;
      if ((s.prev === 'f12_pyre' || (tp > PYRE_T - 0.05 && tp < PYRE_END)) && t < PYRE_END - PYRE_T) {
        at('pyre', PYRE_T + t);
        break;
      }
      const sp = Math.hypot(m.vx ?? 0, m.vy ?? 0);
      if (pose.anim === 'run' || sp > 0.4) {
        q.tech = 'run';
        const d = fresh ? pose.now * sp * 16 : s.walk;
        q.f = Math.floor(fr1(d / K_STRIDE) * 8) % 8;
      } else {
        q.tech = 'idle';
        q.f = Math.floor(pose.now * 10 + (m.id ?? 0) * 3.7) % 24;
      }
      const fl = m.flash ?? 0;
      q.fl = fl > 0.07 ? 2 : fl > 0.01 ? 1 : 0;
    }
  }
  // Смена фазы: глаз маски распахивается (1), рёв (3) — поверх позы.
  const pa = m.data.vSheetPh ? t : pose.now - s.phAt;
  const pto = m.data.vSheetPh ? phase : s.phTo;
  if (mode !== 'dying' && (pto === 1 || pto === 3) && pa >= 0 && pa < (pto === 1 ? 0.9 : 0.8)) {
    q.ov = pto;
    q.of = Math.floor(pa * KFPS);
  }
  return q;
}

registerMobPainter('f12boss', (m: Mob, pose: MobPose) => {
  const q = kingReq(m, pose);
  const fr = kingFrame(q);
  const out: MobFrame = { ...fr };
  const k = kCtx(q);
  const t = kTimeOf(q.tech, q.f, k);
  // Шлейф: рывок когтей, взмах, отдача лука, кувырок, скольжение к помосту.
  if (q.tech === 'cleave' && t > tClaw(k) - 3 * KF && t < tClaw(k) + 2 * KF)
    out.ghost = { every: 0.03, life: 0.16, tint: '#c0103a', alpha: 0.35 };
  else if (q.tech === 'cut' && t > tCut(k) - 2 * KF && t < tCut(k) + KF)
    out.ghost = { every: 0.03, life: 0.12, tint: '#ff4a62', alpha: 0.22 };
  else if (q.tech === 'bow' && t >= tBow(k) && t < tBow(k) + 0.14)
    out.ghost = { every: 0.03, life: 0.16, tint: '#ff8a30', alpha: 0.3 };
  else if (q.tech === 'train' && t > 0.02 && t < 0.42)
    out.ghost = { every: 0.025, life: 0.2, tint: '#ffffff', alpha: 0.35 };
  else if (q.tech === 'cast' && t > 0.1 && t < 0.72)
    out.ghost = { every: 0.05, life: 0.3, tint: '#ff2a5a', alpha: 0.3 };
  // Отдача от удара героя: по направлению удара, с возвратом.
  const fl = m.flash ?? 0;
  if (fl > 0 && pose.mode !== 'dying' && q.tech !== 'dmed' && q.tech !== 'dsit') {
    const sim = paintSim();
    const age = kc(0.12 - fl, 0, 0.12);
    let ux = q.flip ? 1 : -1;
    let uy = 0;
    if (sim) {
      const dx = m.x - sim.hero.x;
      const dy = m.y - sim.hero.y;
      const d = Math.hypot(dx, dy) || 1;
      ux = dx / d;
      uy = dy / d;
    }
    const soft = q.tech === 'idle' || q.tech === 'run' || q.tech === 'broken' || q.tech === 'train';
    const kk = Math.sin((age / 0.12) * Math.PI) * (soft ? 2.2 : 0.9);
    out.dx = (out.dx ?? 0) + ux * kk;
    out.dy = (out.dy ?? 0) + uy * kk * 0.6;
  }
  return out;
});

// Прогрев: первый бой — пробуждение, покой, шаг, рассечение и расщепление в обе стороны.
registerMobWarm('f12boss', function* () {
  const base: KQ = {
    tech: 'intro', f: 0, hk: 100, p1: false, rage: false, crack: 0, edge: false,
    fl: 0, ov: 0, of: 0, dir: 1, aim: 0, flip: false, flash: false,
  };
  const list: [KTech, boolean, boolean][] = [
    ['intro', true, false],
    ['idle', false, true],
    ['run', false, true],
    ['cut', false, true],
    ['cleave', false, true],
  ];
  for (const [tech, edge, both] of list) {
    const n = kCount(tech, kCtx({ ...base, tech }));
    for (let f = 0; f < n; f++) {
      kingBuilt({ ...base, tech, f, edge });
      yield f;
      if (both) {
        kingFrame({ ...base, tech, f, edge, flip: true });
        yield f;
      }
    }
  }
});

// ===========================================================================
// Метки на полу: рельсы, лента, территории, храм, удары короля.
// ===========================================================================

export type ZX = (Zone | Strike) & { f12?: unknown; w?: number; ang?: number; arc?: number };

export const rgba = (c: RGBA, a: number) =>
  `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a)).toFixed(3)})`;

/** Метка удара наливается: 0…1. */
export const kOf = (z: Zone | Strike) => {
  const s = z as Strike;
  if (typeof s.warn === 'number' && s.warn > 0) return Math.min(1, s.t / s.warn);
  return 1;
};

export const RED = hx('#ff2a2a');
const AMBER = hx('#ffb030');
export const CRIMSON = hx('#ff2a5a');
const VIOLET = hx('#c050ff');

// --- Рельсы: путь предупреждает о поезде. -------------------------------

registerZonePainter('f12_rails', (g, z, px, py, S, time) => {
  const v = (z as ZX).f12 as TrackView | undefined;
  if (!v || v.sig === 0) return true;
  const X0 = Math.round(px + (v.x0 - z.x) * S);
  const X1 = Math.round(px + (v.x1 - z.x) * S);
  const top = Math.round(py + (v.y - v.pad - z.y) * S);
  const bot = Math.round(py + (v.y + 2 + v.pad - z.y) * S);
  const ry = Math.round(py + (v.y - z.y) * S);
  if (v.sig === 4) {
    // Стрелка увела поезда — зелёный пунктир по оси пути.
    g.fillStyle = rgba(hx('#5aff8a'), 0.4);
    const off = (time * 12) % 12;
    for (let x = X0 + off; x < X1 - 5; x += 12) g.fillRect(Math.round(x), ry + S - 1, 5, 2);
    return true;
  }
  const col = v.ghost ? hx('#5affb0') : v.sig === 1 ? AMBER : RED;
  const hz = v.sig === 1 ? 1.6 : v.sig === 2 ? 4.5 : 2;
  const pulse = 0.5 + 0.5 * Math.sin(time * hz * TAU);
  g.fillStyle = rgba(col, v.sig === 1 ? 0.05 + 0.07 * pulse : v.sig === 2 ? 0.12 + 0.16 * pulse : 0.07);
  g.fillRect(X0, top, X1 - X0, bot - top);
  // Кромки полосы — бегущий пунктир по ходу поезда.
  g.fillStyle = rgba(col, 0.35 + 0.45 * pulse);
  const ph = (((time * (v.sig === 2 ? 40 : 18) * v.dir) % 12) + 12) % 12;
  for (let x = X0 - 12 + ph; x < X1; x += 12) {
    const a = Math.max(X0, Math.round(x));
    const b = Math.min(X1, Math.round(x) + 6);
    if (b <= a) continue;
    g.fillRect(a, top, b - a, 1);
    g.fillRect(a, bot - 1, b - a, 1);
  }
  if (v.sig === 3) return true;
  // Рельсы гудят: по головкам бегут блики навстречу поезду.
  const L = X1 - X0;
  const spd = v.sig === 1 ? 9 : 20;
  for (let i = 0; i < 3; i++) {
    const u = (((time * spd * S + (i * L) / 3) % L) + L) % L;
    const gx = Math.round(v.dir > 0 ? X0 + u : X1 - u);
    for (const yy of [ry + 5, ry + S + 8]) {
      g.fillStyle = rgba(WHITE, 0.85);
      g.fillRect(gx - 2, yy, 5, 1);
      g.fillStyle = rgba(col, 0.6);
      g.fillRect(gx - 2 - 6 * v.dir, yy, 5, 1);
    }
  }
  if (v.sig === 2) {
    // Шевроны по оси: куда пойдёт состав.
    const step = 3 * S;
    const off = (((time * 6 * S * v.dir) % step) + step) % step;
    g.fillStyle = rgba(col, 0.55 + 0.4 * pulse);
    const cy = ry + S;
    for (let x = X0 + off - step; x < X1; x += step) {
      const xx = Math.round(x);
      if (xx < X0 + 4 || xx > X1 - 4) continue;
      for (let k = 0; k < 4; k++) {
        const dx = v.dir > 0 ? k : -k;
        g.fillRect(xx + dx, cy - 4 + k, 2, 1);
        g.fillRect(xx + dx, cy + 3 - k, 2, 1);
      }
    }
  }
  return true;
});

// --- Эскалатор: ступени едут. -------------------------------------------

registerZonePainter('f12_esc', (g, z, px, py, S, time) => {
  const v = (z as ZX).f12 as EscView | undefined;
  if (!v || !v.dir) return true;
  const X0 = Math.round(px + (v.x0 - z.x) * S) + 2;
  const X1 = Math.round(px + (v.x1 - z.x) * S) - 2;
  const Y0 = Math.round(py + (v.y0 - z.y) * S);
  const Y1 = Math.round(py + (v.y1 - z.y) * S);
  const ph = (((time * v.speed * S * v.dir) % 8) + 8) % 8;
  g.fillStyle = rgba(STEEL[2], 1);
  g.fillRect(X0, Y0, X1 - X0, Y1 - Y0);
  for (let y = Y0 - 8 + ph; y < Y1; y += 8) {
    const yy = Math.round(y);
    const rows: [number, RGBA][] = [
      [0, STEEL[0]],
      [1, YELLOW[2]],
      [2, STEEL[4]],
      [3, STEEL[3]],
    ];
    for (const [dy, c] of rows) {
      if (yy + dy < Y0 || yy + dy >= Y1) continue;
      g.fillStyle = rgba(c, 1);
      g.fillRect(X0, yy + dy, X1 - X0, 1);
    }
  }
  // Рифление ступеней.
  g.fillStyle = 'rgba(0,0,0,0.18)';
  for (let x = X0 + 1; x < X1; x += 2) g.fillRect(x, Y0, 1, Y1 - Y0);
  // Стрелки хода.
  g.fillStyle = rgba(YELLOW[3], 0.5);
  const cx = Math.round((X0 + X1) / 2);
  const st = 2 * S;
  const off = (((time * v.speed * S * v.dir) % st) + st) % st;
  for (let y = Y0 - st + off; y < Y1; y += st) {
    const yy = Math.round(y);
    if (yy < Y0 + 3 || yy > Y1 - 4) continue;
    for (let k = 0; k < 3; k++) {
      const dy = v.dir > 0 ? k : -k;
      g.fillRect(cx - 3 + k, yy + dy, 1, 1);
      g.fillRect(cx + 2 - k, yy + dy, 1, 1);
    }
  }
  return true;
});

// --- Территория: круг с рунами, метка на герое. -------------------------

registerZonePainter('f12_domain', (g, z, px, py, S, time) => {
  const v = (z as ZX).f12 as TerrView | undefined;
  if (!v) return true;
  const open = Math.min(1, v.age / 0.5);
  const e = 1 - (1 - open) * (1 - open);
  const fk = v.broken > 0 ? Math.max(0, 1 - v.broken) : 1;
  if (fk <= 0) return true;
  const R = v.r * S * (0.2 + 0.8 * e);
  const col = v.kind === 'doll' ? VIOLET : CRIMSON;
  g.fillStyle = rgba(col, 0.08 * fk);
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.fill();
  g.lineWidth = 1;
  g.strokeStyle = rgba(col, 0.8 * fk);
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.stroke();
  g.strokeStyle = rgba(col, 0.35 * fk);
  g.beginPath();
  g.arc(px, py, Math.max(1, R - 4), 0, TAU);
  g.stroke();
  // Руны между двумя кольцами ползут по кругу; разбитая — трещит.
  const n = Math.max(8, Math.round(R / 5));
  g.fillStyle = rgba(col, 0.9 * fk);
  for (let i = 0; i < n; i++) {
    if (v.broken > 0 && hash(i, Math.floor(time * 20)) < v.broken) continue;
    const a = time * 0.35 + (i / n) * TAU;
    const x = Math.round(px + Math.cos(a) * (R - 2));
    const y = Math.round(py + Math.sin(a) * (R - 2));
    g.fillRect(x - 1, y, 3, 1);
    if (i % 3 === 0) g.fillRect(x, y - 1, 1, 3);
  }
  return true;
});

registerZonePainter('f12_mark', (g, z, px, py, S, time) => {
  const v = (z as ZX).f12 as TerrView | undefined;
  if (!v) return true;
  const c = v.charge;
  const blink = v.hold && Math.floor(time * 12) % 2 === 0;
  const col = blink ? WHITE : v.kind === 'doll' ? VIOLET : CRIMSON;
  const cy = Math.round(py - 7);
  // Уголки прицела сходятся, пока метка наливается.
  const R = Math.round(S * (1.25 - 0.55 * c));
  g.fillStyle = rgba(col, 0.45 + 0.55 * c);
  for (const [sx, sy] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    const x = Math.round(px + sx * R);
    const y = cy + sy * R;
    g.fillRect(sx < 0 ? x : x - 3, y, 4, 1);
    g.fillRect(x, sy < 0 ? y : y - 3, 1, 4);
  }
  // Кольцо заполнения.
  g.lineWidth = 1;
  g.strokeStyle = rgba(col, 0.85);
  g.beginPath();
  g.arc(px, cy, 9, -Math.PI / 2, -Math.PI / 2 + TAU * c);
  g.stroke();
  if (c > 0.85) {
    g.fillStyle = rgba(WHITE, (c - 0.85) * 6);
    g.fillRect(Math.round(px) - 4, cy, 9, 1);
    g.fillRect(Math.round(px), cy - 4, 1, 9);
  }
  return true;
});

// --- Фары поезда: сноп света по путям. ----------------------------------

registerZonePainter('f12_beam', (g, z, px, py, S) => {
  const v = (z as ZX).f12 as { dir: number; ghost: boolean } | undefined;
  if (!v) return true;
  const L = 7 * S;
  const x0 = px + v.dir * 2;
  const x1 = x0 + v.dir * L;
  const c = v.ghost ? '140,255,190' : '255,236,170';
  const grad = g.createLinearGradient(x0, 0, x1, 0);
  grad.addColorStop(0, `rgba(${c},0.34)`);
  grad.addColorStop(0.5, `rgba(${c},0.12)`);
  grad.addColorStop(1, `rgba(${c},0)`);
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(x0, py - 13);
  g.lineTo(x1, py - 24);
  g.lineTo(x1, py + 14);
  g.lineTo(x0, py - 6);
  g.closePath();
  g.fill();
  g.fillStyle = `rgba(${c},0.5)`;
  g.fillRect(Math.round(Math.min(x0, x0 + v.dir * S * 2)), Math.round(py - 10), S * 2, 1);
  return true;
});

// --- Храм: сетка разрезов и круги-обереги. ------------------------------

// --- Жертвенный храм: встаёт из пола позади короля. ---------------------

export const SHRINE_W = 96;
export const SHRINE_H = 84;

export function shrinePx(f: number): Px {
  const p = new Px(SHRINE_W, SHRINE_H);
  const cx = SHRINE_W / 2;
  const G = SHRINE_H - 2;
  const wood = tn('#1a0a0c', '#2e1014', '#4a181c', '#6a2426');
  const tile = tn('#0e0c12', '#1c1822', '#2a2432', '#3c3446');
  // Стена-тело.
  polyShade(p, [[16, 34], [80, 34], [82, G - 8], [14, G - 8]], [SHRINE[1], SHRINE[2], SHRINE[3], SHRINE[4]], -0.1);
  for (let x = 18; x < 80; x += 6) for (let y = 36; y < G - 9; y++) p.set(x, y, SHRINE[0]);
  // Столбы из лака.
  for (const x0 of [12, 78]) polyShade(p, [[x0, 30], [x0 + 6, 30], [x0 + 6, G - 6], [x0, G - 6]], wood);
  // Пасть вместо дверей.
  const my = 58;
  p.ell(cx, my, 17, 12.5, (x, y) => {
    const d = Math.hypot((x + 0.5 - cx) / 17, (y + 0.5 - my) / 12.5);
    const hot = 1 - d;
    return hot > 0.55 ? (f ? hx('#ff7a4a') : hx('#ff5a3a')) : hot > 0.3 ? hx('#c01a24') : hot > 0.1 ? hx('#6a0a14') : hx('#2a0408');
  });
  // Клыки сверху и снизу.
  for (let i = -6; i <= 6; i++) {
    const tx = cx + i * 2.5;
    const topY = my - 12.5 * Math.sqrt(Math.max(0, 1 - ((tx - cx) / 17) ** 2));
    const botY = my + 12.5 * Math.sqrt(Math.max(0, 1 - ((tx - cx) / 17) ** 2));
    const L = 4 - Math.abs(i) * 0.35;
    poly(p, [[tx - 1.1, topY - 0.5], [tx + 1.1, topY - 0.5], [tx, topY + L]], BONE[i % 2 ? 2 : 3]);
    poly(p, [[tx - 1.1, botY + 0.5], [tx + 1.1, botY + 0.5], [tx, botY - L]], BONE[i % 2 ? 3 : 2]);
  }
  // Глаза храма над пастью.
  for (const s of [-1, 1]) {
    poly(p, [[cx + s * 7, 42], [cx + s * 15, 39], [cx + s * 14, 43]], f ? hx('#ffd0a0') : hx('#ff4a3a'));
    p.set(cx + s * 11, 41, WHITE);
  }
  // Нижний карниз и кости у подножия.
  for (let x = 10; x < 86; x++) {
    p.set(x, G - 8, wood[3]);
    p.set(x, G - 7, wood[1]);
  }
  for (let i = 0; i < 11; i++) {
    const bx = 12 + i * 7 + (i % 2) * 2;
    const by = G - 3 - (i % 3);
    shadeEll(p, bx, by, 3, 2.6, [BONE[0], BONE[1], BONE[2], BONE[3]], 0.1);
    p.set(bx - 1, by, INK);
    p.set(bx + 1, by, INK);
  }
  // Нижний ярус крыши: изогнутые карнизы.
  poly(p, [[2, 22], [10, 31], [86, 31], [94, 22], [84, 27], [12, 27]], wood[2]);
  polyShade(p, [[12, 27], [84, 27], [74, 18], [22, 18]], tile);
  for (let x = 12; x < 85; x++) p.set(x, 27, LACQUER[3]);
  for (let x = 24; x < 74; x += 4) for (let y = 19; y < 27; y++) p.set(x + Math.round((y - 19) * 0.2 * Math.sign(x - cx)), y, tile[0]);
  // Верхний ярус.
  poly(p, [[16, 12], [22, 19], [74, 19], [80, 12], [72, 16], [24, 16]], wood[2]);
  polyShade(p, [[24, 16], [72, 16], [62, 7], [34, 7]], tile);
  for (let x = 24; x < 73; x++) p.set(x, 16, LACQUER[3]);
  // Конёк: золотые рога.
  for (const s of [-1, 1]) {
    stroke(p, cx + s * 12, 7, cx + s * 16, 1, GOLD[2], 2);
    p.set(cx + s * 16, 1, GOLD[3]);
  }
  p.rect(cx - 12, 6, cx + 12, 7, GOLD[1]);
  shadeEll(p, cx, 5, 3, 3, tn('#5e4210', '#8a6a1a', '#c09a30', '#f0d060'));
  // Бумажные ленты-сидэ под карнизом.
  for (const x of [20, 34, 62, 76]) {
    for (let y = 32; y < 38; y++) p.set(x + ((y + f) % 3 === 0 ? 1 : 0), y, PAPER[3]);
    p.set(x, 35, hx('#c01a2a'));
  }
  p.outline(INK);
  return p;
}

export const shrineImg: HTMLCanvasElement[] = [];

// --- Огонь, лужа слёз, поезд по своим. ----------------------------------

const fireImg: HTMLCanvasElement[] = [];
export function fireFrame(f: number): HTMLCanvasElement {
  if (!fireImg[f]) {
    const p = new Px(10, 13);
    flame(p, 5, 12, 7, 10, f, FIRE, 1);
    fireImg[f] = p.canvas();
  }
  return fireImg[f];
}

registerZonePainter('f12_tearpool', (g, zz, px, py, S, time) => {
  const z = zz as Zone;
  const a = Math.min(1, (z.life - z.t) / 0.6, z.t / 0.2);
  if (a <= 0) return true;
  const R = z.r * S;
  g.fillStyle = rgba(hx('#4a0610'), 0.55 * a);
  g.beginPath();
  g.ellipse(px, py, R, R * 0.7, 0, 0, TAU);
  g.fill();
  g.fillStyle = rgba(hx('#a01a2a'), 0.5 * a);
  g.beginPath();
  g.ellipse(px - 1, py - 1, R * 0.7, R * 0.45, 0, 0, TAU);
  g.fill();
  const rk = (time * 0.8 + z.id * 0.3) % 1;
  g.strokeStyle = rgba(hx('#ff6a7a'), 0.4 * a * (1 - rk));
  g.lineWidth = 1;
  g.beginPath();
  g.ellipse(px, py, R * rk, R * rk * 0.7, 0, 0, TAU);
  g.stroke();
  return true;
});

registerZonePainter('f12_trainhit', () => true);

// --- Удары жителей: крик многоликого, порезы плаката. -------------------

registerZonePainter('f12_scream', (g, z, px, py, S, time) => {
  const s = z as ZX;
  const k = kOf(z);
  const R = s.r * S;
  const w = Math.max(1, (s.w ?? 0.3) * S);
  g.lineWidth = 1;
  g.strokeStyle = rgba(hx('#ff5ab0'), 0.15 + 0.3 * k);
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.stroke();
  // Кольцо толстеет к удару и дрожит.
  const j = k > 0.8 ? Math.sin(time * 60) : 0;
  g.lineWidth = Math.max(1, Math.round(w * k));
  g.strokeStyle = rgba(hx('#ffb0e0'), 0.2 + 0.6 * k);
  g.beginPath();
  g.arc(px, py, R + j, 0, TAU);
  g.stroke();
  g.lineWidth = 1;
  return true;
});

registerZonePainter('f12_papercut', (g, z, px, py, S) => {
  const s = z as ZX;
  const k = kOf(z);
  const R = s.r * S;
  const a = s.ang ?? 0;
  const arc = s.arc ?? 0.6;
  g.fillStyle = rgba(PAPER[2], 0.08 + 0.2 * k);
  g.beginPath();
  g.moveTo(px, py);
  g.arc(px, py, R, a - arc / 2, a + arc / 2);
  g.closePath();
  g.fill();
  // Лезвие-лист бежит по оси.
  g.strokeStyle = rgba(WHITE, 0.4 + 0.6 * k);
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(px, py);
  g.lineTo(px + Math.cos(a) * R * k, py + Math.sin(a) * R * k);
  g.stroke();
  g.strokeStyle = rgba(hx('#c01a2a'), 0.5 * k);
  g.beginPath();
  g.arc(px, py, R, a - arc / 2, a + arc / 2);
  g.stroke();
  return true;
});

// --- Удары короля. ------------------------------------------------------

// ===========================================================================
// Снаряды: кровавая слеза глаза, иглы куклы.
// ===========================================================================

registerShotPainter('f12_tear', (_s, time) => {
  const f = Math.floor(time * 8) % 2;
  return sprite(`tear|${f}`, () => {
    const p = new Px(8, 10);
    const T = tn('#4a0610', '#8a1020', '#c8283a', '#ff8a9a');
    shadeEll(p, 4, 6.2, 2.6, 2.8, T);
    poly(p, [[2.4, 5], [5.6, 5], [4, 1]], T[2]);
    p.set(3, 5, f ? WHITE : T[3]);
    p.outline(INK);
    return { p, ax: 4, ay: 9 };
  });
});

registerShotPainter('f12_needle', (s) => {
  const a = Math.atan2(s.vy, s.vx);
  const b = ((Math.round((a / TAU) * 8) % 8) + 8) % 8;
  return sprite(`needle|${b}`, () => {
    const p = new Px(11, 11);
    const an = (b / 8) * TAU;
    const dx = Math.cos(an);
    const dy = Math.sin(an);
    stroke(p, 5.5 - dx * 4, 5.5 - dy * 4, 5.5 + dx * 4, 5.5 + dy * 4, STEEL[4], 1);
    p.set(5.5 + dx * 4, 5.5 + dy * 4, WHITE);
    // Красная нить с ушка.
    p.set(5.5 - dx * 5, 5.5 - dy * 5 + 1, hx('#e0203a'));
    p.set(5.5 - dx * 4 - dy, 5.5 - dy * 4 + dx, hx('#e0203a'));
    return { p, ax: 5, ay: 6 };
  });
});

// ===========================================================================
// Вещи рюкзака (10×10).
// ===========================================================================

registerItemArt('f12mat', () => {
  // Проклятый жетон: латунная монета с «М» и пурпурной трещиной.
  const p = new Px(10, 10);
  shadeEll(p, 5, 5, 4.2, 4.2, tn('#6a4a10', '#a07a20', '#d0a838', '#f8e070'));
  p.ell(5, 5, 2.6, 2.6, hx('#8a6418'));
  for (const [x, y] of [
    [3, 6],
    [3, 5],
    [3, 4],
    [4, 4],
    [5, 5],
    [6, 4],
    [7, 4],
    [7, 5],
    [7, 6],
  ])
    p.set(x, y, hx('#f8e070'));
  p.set(6, 2, hx('#c050ff'));
  p.set(6, 3, hx('#8a2ab0'));
  p.set(7, 3, hx('#c050ff'));
  p.outline(INK);
  return p;
});

registerItemArt('f12_talisman', () => {
  // Обгоревший талисман: бумага, красная печать, чёрный край.
  const p = new Px(10, 10);
  p.rect(3, 1, 6, 9, PAPER[3]);
  p.rect(6, 1, 6, 9, PAPER[1]);
  for (let y = 3; y < 8; y++) p.set(4 + (y % 2), y, hx('#c01a2a'));
  p.rect(4, 7, 5, 8, hx('#c01a2a'));
  for (const x of [3, 4, 5, 6]) p.set(x, 1, hash(x, 1) > 0.5 ? hx('#2a1a10') : hx('#ff7a20'));
  p.set(5, 0, hx('#ffb040'));
  p.outline(INK);
  return p;
});

registerItemArt('f12_lens', () => {
  // Линза глаза: мутное стекло с красной радужкой.
  const p = new Px(10, 10);
  shadeEll(p, 5, 5, 4.2, 3.8, tn('#3a4a4e', '#6a8084', '#a0b4b4', '#e0f0ec'));
  p.ell(5, 5.4, 1.8, 1.8, hx('#8a1020'));
  p.set(5, 5, INK);
  p.set(3, 3, WHITE);
  p.outline(INK);
  return p;
});

registerItemArt('f12_finger', () => {
  // Палец проклятия: сухой, чёрный, с длинным ногтем и красной нитью.
  const p = new Px(10, 10);
  limb(p, 2, 8, 7, 3, 1.6, 1.2, tn('#140a0c', '#2a161a', '#442428', '#6a3a3c'));
  stroke(p, 7, 3, 9, 1, hx('#d8c8a8'), 1);
  p.set(4, 6, hx('#e0203a'));
  p.set(5, 6, hx('#e0203a'));
  p.set(4, 7, hx('#e0203a'));
  p.outline(INK);
  return p;
});

registerItemArt('f12_mask', () => {
  // Двуликая маска: кость; слева улыбка, справа открытый глаз.
  const p = new Px(10, 10);
  shadeEll(p, 5, 5, 4.4, 4.4, K_MASK);
  for (let y = 1; y < 9; y++) p.set(5, y, hash(5, y) > 0.5 ? K_TAT : K_MASK[0]);
  p.set(2, 4, K_TAT);
  p.set(3, 4, K_TAT);
  for (let x = 2; x <= 4; x++) p.set(x, 7, K_TAT);
  p.set(2, 6, K_TAT);
  p.set(7, 4, K_EYE);
  p.set(8, 4, K_TAT);
  for (let x = 6; x <= 8; x++) p.set(x, 7, x % 2 ? BONE[3] : K_TAT);
  p.outline(INK);
  return p;
});

registerItemArt('f12_snack', () => {
  // Пирожок из буфета.
  const p = new Px(10, 10);
  shadeEll(p, 5, 6, 4.4, 2.8, tn('#6a3a10', '#a8601c', '#d8903a', '#f4c870'));
  for (let x = 2; x <= 8; x += 2) p.set(x, 4 + (x % 4 === 0 ? 0 : 1), hx('#6a3a10'));
  p.outline(INK);
  return p;
});

registerItemArt('f12_stew', () => {
  // Тушёнка обходчика: банка с синей этикеткой.
  const p = new Px(10, 10);
  polyShade(p, [[2, 3], [8, 3], [8, 9], [2, 9]], [STEEL[1], STEEL[2], STEEL[3], STEEL[4]]);
  p.rect(2, 5, 8, 7, hx('#2a4a8a'));
  p.set(4, 6, hx('#e8d8a0'));
  p.set(5, 6, hx('#e8d8a0'));
  p.rect(2, 2, 8, 2, STEEL[4]);
  p.outline(INK);
  return p;
});
