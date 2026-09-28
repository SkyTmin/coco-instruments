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
  paintSim,
  registerCellPainter,
  registerItemArt,
  registerMobPainter,
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
const WHITE = hx('#ffffff');
const GOLDK = hx('#ffcc40');
const TAU = Math.PI * 2;
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
function stroke(p: Px, x0: number, y0: number, x1: number, y1: number, c: RGBA, w = 1): void {
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
const MOS_A = [hx('#3a2224'), hx('#4e2e2e'), hx('#643c3a')];
const MOS_B = [hx('#4a4e50'), hx('#5c6264'), hx('#727a7a')];
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
const PAPER = [hx('#8a8068'), hx('#b3aa8c'), hx('#d2c9aa'), hx('#ece4c6')];
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
function graniteCell(wx: number, wy: number, v: number): Px {
  const p = new Px(16, 16);
  const off = (wy & 1) * 8;
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const gx = (x + off + wx * 16) & 15;
      const slab = Math.floor((wx * 16 + x + off) / 16) * 31 + Math.floor((wy * 16 + y) / 8) * 17;
      const base = 2 + (hash(slab, 3) < 0.3 ? -1 : hash(slab, 5) > 0.85 ? 1 : 0);
      const n = hash(wx * 16 + x, wy * 16 + y, 11);
      let c = GRANITE[base];
      if (n > 0.93) c = GRANITE[Math.min(4, base + 1)];
      else if (n < 0.07) c = GRANITE[Math.max(0, base - 1)];
      // Швы.
      if (gx === 0 || y === 0 || y === 8) c = GROUT;
      else if (gx === 1 || y === 1 || y === 9) c = mixc(c, GRANITE[4], 0.35);
      p.set(x, y, c);
    }
  // Грязь в швах и затёртая середина.
  const g = vnoise(wx * 16, wy * 16, 24, 7);
  if (g > 0.6)
    for (let i = 0; i < 6; i++) p.set(Math.floor(hash(wx, wy, i) * 16), Math.floor(hash(wy, wx, i + 9) * 16), alpha(hx('#1a1c18'), 0.5));
  if (v % 5 === 0) {
    // Скол на углу плиты.
    const x0 = 2 + (v % 7);
    p.set(x0, 3, GRANITE[0]);
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
      const n = vnoise(wx * 16 + x, wy * 16 + y, 6, 21) * 0.7 + hash(wx * 16 + x, wy * 16 + y, 3) * 0.3;
      p.set(x, y, CONC[n > 0.72 ? 3 : n > 0.48 ? 2 : n > 0.26 ? 1 : 0]);
    }
  // Шов заливки раз в две клетки.
  if (wx % 2 === 0) for (let y = 0; y < 16; y++) p.set(0, y, mixc(CONC[0], INK, 0.3));
  if (wy % 3 === 0) for (let x = 0; x < 16; x++) p.set(x, 0, mixc(CONC[0], INK, 0.3));
  return p;
}

/** Мозаика вестибюля: шахматка красного и серого гранита с каймой. */
function mosaicCell(c: CellCtx): Px {
  const edge = (dx: number, dy: number) => c.markAt(dx, dy) !== MK.mosaic;
  const n = edge(0, -1);
  const s = edge(0, 1);
  const w = edge(-1, 0);
  const e = edge(1, 0);
  const key = `mos|${c.wx & 1}|${c.wy & 1}|${n ? 1 : 0}${s ? 1 : 0}${w ? 1 : 0}${e ? 1 : 0}`;
  return cellOf(key, () => {
    const p = new Px(16, 16);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const qx = Math.floor((c.wx * 16 + x) / 8);
        const qy = Math.floor((c.wy * 16 + y) / 8);
        const dark = (qx + qy) % 2 === 0;
        const pal = dark ? MOS_A : MOS_B;
        const nn = hash(c.wx * 16 + x, c.wy * 16 + y, 5);
        let col = pal[nn > 0.9 ? 2 : nn < 0.12 ? 0 : 1];
        const lx = (c.wx * 16 + x) & 7;
        const ly = (c.wy * 16 + y) & 7;
        if (lx === 0 || ly === 0) col = mixc(col, GROUT, 0.6);
        // Ромб в центре каждой пары квадратов.
        const cx = Math.abs(((c.wx * 16 + x) & 15) - 7.5);
        const cy = Math.abs(((c.wy * 16 + y) & 15) - 7.5);
        if (cx + cy < 3) col = dark ? hx('#8a6a3a') : hx('#9a5a4a');
        p.set(x, y, col);
      }
    // Латунная кайма по краю мозаики.
    const brass = hx('#9a7a3a');
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
function shrineFloor(wx: number, wy: number): Px {
  return cellOf(`sfloor|${wx % 4}|${wy % 4}`, () => {
    const p = new Px(16, 16);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const gx = wx * 16 + x;
        const gy = wy * 16 + y;
        const sx = Math.floor((gx + (Math.floor(gy / 12) % 2) * 9) / 18);
        const sy = Math.floor(gy / 12);
        const base = 2 + (hash(sx, sy, 1) > 0.7 ? 1 : hash(sx, sy, 2) < 0.25 ? -1 : 0);
        let col = SHRINE[base];
        if ((gx + (Math.floor(gy / 12) % 2) * 9) % 18 === 0 || gy % 12 === 0) col = SHRINE[0];
        else if (hash(gx, gy, 3) > 0.94) col = SHRINE[Math.min(4, base + 1)];
        p.set(x, y, col);
      }
    return p;
  });
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
  return cellOf(`dais|${n ? 1 : 0}${s ? 1 : 0}|${c.wx & 1}`, () => {
    const p = new Px(16, 16);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        let col = LACQUER[(c.wx * 16 + x) % 16 < 1 ? 1 : y % 4 === 0 ? 2 : 3];
        if (hash(c.wx * 16 + x, y, 8) > 0.92) col = LACQUER[4];
        p.set(x, y, col);
      }
    if (n) for (let x = 0; x < 16; x++) {
      p.set(x, 0, GOLD[1]);
      p.set(x, 1, GOLD[3]);
    }
    if (s) for (let x = 0; x < 16; x++) {
      p.set(x, 13, GOLD[2]);
      p.set(x, 14, LACQUER[0]);
      p.set(x, 15, INK);
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
  return cellOf(`ground|${wx % 4}|${wy % 4}`, () => {
    const p = new Px(16, 16);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const n = vnoise(wx * 16 + x, wy * 16 + y, 5, 31) * 0.6 + hash(wx * 16 + x, wy * 16 + y, 7) * 0.4;
        p.set(x, y, [hx('#161016'), hx('#201820'), hx('#2a2028'), hx('#372a34')][n > 0.75 ? 3 : n > 0.5 ? 2 : n > 0.25 ? 1 : 0]);
      }
    return p;
  });
}

/** Храм развёрнут: чёрная вода с кровью, кости всплывают. */
function domainCell(c: CellCtx): Px {
  return cellOf(`domain|${c.wx % 4}|${c.wy % 4}`, () => {
    const p = new Px(16, 16);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const n = vnoise(c.wx * 16 + x, c.wy * 16 + y * 1.6, 7, 61);
        let col = mixc(hx('#0a0206'), hx('#3a0610'), n);
        if (n > 0.72) col = hx('#5a0a14');
        if (Math.abs(n - 0.5) < 0.02) col = hx('#7a1a24');
        p.set(x, y, col);
      }
    if (hash(c.wx, c.wy, 4) > 0.8) {
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
      return cellOf(`gran|${c.wx & 1}|${c.wy & 1}|${Math.floor(hash(c.wx, c.wy, 1) * 3)}`, () => graniteCell(c.wx & 1, c.wy & 1, Math.floor(hash(c.wx, c.wy, 1) * 7)));
    return cellOf(`conc|${c.wx % 4}|${c.wy % 3}`, () => concreteCell(c.wx % 4, c.wy % 3));
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
  const wing = alpha(hx('#c8d0c0'), 0.55);
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
  shadeEll(p, cx, cy, 3.2 - fp.spread * 0.2, 2.6, tn('#050504', '#12120e', '#22221a', '#34342a'));
  for (let i = 0; i < 11; i++) {
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
  shadeEll(p, x, y, 1.8 * s, 2.2 * s, FACE);
  p.set(Math.round(x - 0.8 * s), Math.round(y - 0.5 * s), glow ? hx('#ffe0a0') : INK);
  p.set(Math.round(x + 0.8 * s), Math.round(y - 0.5 * s), glow ? hx('#ffe0a0') : INK);
  if (mouth > 0) {
    const h = Math.max(1, Math.round(mouth * 1.6 * s));
    for (let dy = 0; dy < h; dy++) {
      p.set(Math.round(x), Math.round(y + 0.8 * s) + dy, dy === 0 ? INK : hx('#6a0a14'));
      if (s > 1) p.set(Math.round(x) + 1, Math.round(y + 0.8 * s) + dy, INK);
    }
  } else p.set(Math.round(x), Math.round(y + 0.9 * s), shade(FACE[0], 0.7));
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
    limb(p, ox, oy, mx, my, 1.8, 1.4, ARMSKIN);
    limb(p, mx, my, ex, ey, 1.4, 1.2, ARMSKIN);
    p.set(Math.round(mx), Math.round(my), shade(ARMSKIN[1], 0.7));
    // Кисть: ладонь и длинные пальцы веером (или сжатые).
    shadeEll(p, ex, ey, 2.2, 2.2, ARMSKIN, 0.1);
    for (let i = -2; i <= 2; i++) {
      const a = ang + i * (grip ? 0.25 : 0.42);
      const fl = grip ? 2.5 : 4.5 - Math.abs(i) * 0.6;
      stroke(p, ex, ey, ex + Math.cos(a) * fl, ey + Math.sin(a) * fl, ARMSKIN[2], 1);
      p.set(Math.round(ex + Math.cos(a) * fl), Math.round(ey + Math.sin(a) * fl), hx('#1a1a14'));
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
  const p = new Px(22, 26);
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
  // Голова: раскрывается вертикальной пастью.
  shadeEll(p, hx0, hy0, 3.2, 3.4, SKINS);
  if (sp.maw > 0) {
    const w = Math.round(1 + sp.maw * 2);
    for (let y = hy0 - 3; y <= hy0 + 3; y++)
      for (let x = hx0 - w; x <= hx0 + w; x++) {
        const e = Math.abs(x - hx0) / (w + 0.5) + Math.abs(y - hy0) / 4;
        if (e < 1) p.set(x, y, e > 0.72 ? hx('#e8e0d0') : hx('#5a0812'));
      }
    // Зубы по краям разлома.
    for (let y = hy0 - 2; y <= hy0 + 2; y += 2) {
      p.set(hx0 - w, y, hx('#f8f0e0'));
      p.set(hx0 + w, y, hx('#f8f0e0'));
    }
  }
  // Кепка.
  for (let x = hx0 - 3; x <= hx0 + 3; x++) p.set(x, hy0 - 3 - (sp.maw > 0.5 ? 1 : 0), hx('#14161c'));
  p.set(hx0 + 4, hy0 - 2, hx('#14161c'));
  p.outline(INK);
  // Глаза — по бокам пасти.
  p.set(hx0 - 2, hy0 - 1, hx('#ff3a50'));
  p.set(hx0 + 2, hy0 - 1, hx('#ff3a50'));
  return { p, ax: 10, ay: G, eye: [hx0 + 2, hy0 - 1] };
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
// Столб территории и чаша храма. Кадр 14×28, земля — 26.
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

registerMobPainter('f12_pillar', (m: Mob, pose: MobPose) => {
  const bowl = (m.data.bowl ?? 0) > 0;
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
// Двуликий король проклятий. Кадр 56×68, земля — 64. Смотрит вправо.
// Белое кимоно, тёмные хакама, четыре руки, розовые вихры, чёрные полосы
// татуировки. Второе лицо — костяная маска, наросшая на щеку (для зрителя —
// слева): до «ПЛАМЕНИ» глаз маски закрыт. На поясе — рот: раскрывается,
// когда король складывает знак и сидит в храме.
// ---------------------------------------------------------------------------

const K_ROBE = tn('#6e685e', '#b4ac9c', '#dcd5c6', '#f6f2e8');
const K_HAK = tn('#121016', '#221e28', '#342e3c', '#4c4456');
const K_OBI = tn('#0a080c', '#1a141c', '#2a222e', '#443846');
const K_SKIN = tn('#6e4c40', '#9c705c', '#c4967a', '#e4ba9c');
const K_HAIR = tn('#521a28', '#8e3248', '#c0566e', '#ea8aa0');
const K_MASK = tn('#6a6252', '#a09680', '#cfc4a8', '#f0e8d2');
const K_TAT = hx('#120608');
const K_EYE = hx('#ff2030');
const K_GHOST = hx('#ff2a5a');

/** Рука от плеча: локоть и кисть, x — НАРУЖУ от тела. */
type Arm = [number, number, number, number];

interface KingPose {
  body: 'stand' | 'sit' | 'kneel';
  step: number;
  bob: number;
  tilt: number;
  ru: Arm;
  rl: Arm;
  lu: Arm;
  ll: Arm;
  roar: boolean;
  glow: number;
  face2: boolean;
  belly: boolean;
  fx: 'none' | 'cut0' | 'cut1' | 'bow' | 'pyre' | 'sign' | 'claw';
  /** Натяжение тетивы, 0…1. */
  draw: number;
  f: number;
  stars: boolean;
  aura: number;
  ghost: boolean;
}

const A_REST: [Arm, Arm] = [
  [4, 7, 5, 14],
  [3, 6, 4, 12],
];
const A_SIT: [Arm, Arm] = [
  [5, 6, 6, 11],
  [4, 6, 1, 10],
];
const A_LIMP: [Arm, Arm] = [
  [3, 8, 4, 15],
  [2, 7, 2, 13],
];
const A_CLAW0: [Arm, Arm] = [
  [7, -3, 13, -6],
  [7, 3, 13, 5],
];
const A_CLAW1: [Arm, Arm] = [
  [6, 5, 3, 11],
  [5, 6, 1, 11],
];
const A_PYRE: [Arm, Arm] = [
  [5, -4, 8, -10],
  [6, 1, 10, -3],
];
const A_SIGN: [Arm, Arm] = [
  [3, 5, -7, 4],
  [3, 6, -5, 9],
];
const A_CROSS: Arm = [-1, 5, -6, 6];

const kingBase = (): KingPose => ({
  body: 'stand',
  step: 0,
  bob: 0,
  tilt: 0,
  ru: A_REST[0],
  rl: A_REST[1],
  lu: A_REST[0],
  ll: A_REST[1],
  roar: false,
  glow: 0.6,
  face2: false,
  belly: false,
  fx: 'none',
  draw: 0,
  f: 0,
  stars: false,
  aura: 0,
  ghost: false,
});

function kingArm(p: Px, sx: number, sy: number, side: number, a: Arm, upper: boolean, claw: boolean): [number, number] {
  const ex = sx + a[0] * side;
  const ey = sy + a[1];
  const hx0 = sx + a[2] * side;
  const hy0 = sy + a[3];
  if (upper) {
    // Широкий рукав кимоно до локтя.
    limb(p, sx, sy, ex, ey, 3.3, 2.8, K_ROBE);
    limb(p, ex, ey, hx0, hy0, 1.6, 1.3, K_SKIN);
  } else {
    limb(p, sx, sy, ex, ey, 1.9, 1.6, K_SKIN, -0.05);
    limb(p, ex, ey, hx0, hy0, 1.6, 1.25, K_SKIN, -0.05);
  }
  // Полосы татуировки у запястья.
  const dx = hx0 - ex;
  const dy = hy0 - ey;
  const L = Math.hypot(dx, dy) || 1;
  for (const u of [0.55, 0.72]) {
    const bx = ex + dx * u;
    const by = ey + dy * u;
    p.set(bx - (dy / L) * 1.2, by + (dx / L) * 1.2, K_TAT);
    p.set(bx, by, K_TAT);
    p.set(bx + (dy / L) * 1.2, by - (dx / L) * 1.2, K_TAT);
  }
  shadeEll(p, hx0, hy0, 1.7, 1.7, K_SKIN, 0.1);
  if (claw)
    for (let i = -1; i <= 1; i++) {
      const nx = dx / L;
      const ny = dy / L;
      const ox = hx0 + nx * 1.4 - ny * i * 1.2;
      const oy = hy0 + ny * 1.4 + nx * i * 1.2;
      stroke(p, ox, oy, ox + nx * 3, oy + ny * 3, hx('#2a0a10'), 1);
      p.set(ox + nx * 3, oy + ny * 3, hx('#ff5a6a'));
    }
  return [hx0, hy0];
}

function drawKing(kp: KingPose): Built {
  const W = 56;
  const p = new Px(W, 68);
  const G = 64;
  const cx = 28;
  const hipY = (kp.body === 'stand' ? G - 16 : kp.body === 'kneel' ? G - 9 : G - 5) + kp.bob;
  const sy = hipY - 21;
  const headY = sy - 9;
  const hxc = cx + kp.tilt;
  // Аура проклятия — редкие огоньки по кругу.
  if (kp.aura > 0)
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * TAU + kp.f * 0.35;
      const rr = 1 + 0.08 * Math.sin(i * 3 + kp.f);
      const x = cx + Math.cos(a) * 24 * rr;
      const y = hipY - 12 + Math.sin(a) * 26 * rr;
      if (hash(i, kp.f, 5) < 0.55 * kp.aura) p.set(x, y, alpha(K_GHOST, 0.5 + 0.4 * hash(i, kp.f)));
    }
  // Ноги: хакама.
  if (kp.body === 'stand') {
    const s = kp.step;
    polyShade(p, [[cx - 9, hipY - 2], [cx - 1, hipY - 2], [cx - 3 + s * 2, G - 2], [cx - 12 + s * 2, G - 2]], K_HAK, -0.05);
    polyShade(p, [[cx + 1, hipY - 2], [cx + 9, hipY - 2], [cx + 12 - s * 2, G - 2], [cx + 3 - s * 2, G - 2]], K_HAK, 0.05);
    // Складки.
    stroke(p, cx - 5, hipY + 2, cx - 7 + s * 2, G - 4, K_HAK[0], 1);
    stroke(p, cx + 5, hipY + 2, cx + 7 - s * 2, G - 4, K_HAK[0], 1);
    // Босые ступни.
    p.rect(cx - 10 + s * 2, G - 2, cx - 5 + s * 2, G - 1, K_SKIN[1]);
    p.rect(cx + 5 - s * 2, G - 2, cx + 10 - s * 2, G - 1, K_SKIN[1]);
  } else if (kp.body === 'sit') {
    // Скрещённые ноги: широкий подол на полу.
    shadeEll(p, cx, G - 4, 15, 4.5, K_HAK);
    stroke(p, cx - 9, G - 4, cx + 9, G - 3, K_HAK[0], 1);
    p.rect(cx - 12, G - 3, cx - 9, G - 2, K_SKIN[1]);
    p.rect(cx + 9, G - 3, cx + 12, G - 2, K_SKIN[1]);
  } else {
    // На одном колене.
    shadeEll(p, cx - 3, G - 4, 11, 4, K_HAK);
    polyShade(p, [[cx + 2, hipY - 2], [cx + 10, hipY - 2], [cx + 12, G - 3], [cx + 5, G - 3]], K_HAK, 0.05);
    p.rect(cx + 5, G - 2, cx + 11, G - 1, K_SKIN[1]);
  }
  // Кимоно.
  polyShade(p, [[cx - 10, sy - 1], [cx + 10, sy - 1], [cx + 9, hipY], [cx - 9, hipY]], K_ROBE);
  stroke(p, cx - 1, sy + 7, cx - 6, hipY - 1, K_ROBE[0], 1);
  // Ворот буквой V: кожа и тату на груди.
  poly(p, [[cx - 4, sy - 1], [cx + 4, sy - 1], [cx, sy + 8]], K_SKIN[2]);
  stroke(p, cx - 4, sy - 1, cx, sy + 8, K_OBI[2], 1);
  stroke(p, cx + 4, sy - 1, cx, sy + 8, K_OBI[2], 1);
  p.set(cx - 2, sy + 1, K_TAT);
  p.set(cx - 1, sy + 1, K_TAT);
  p.set(cx + 1, sy + 1, K_TAT);
  p.set(cx + 2, sy + 1, K_TAT);
  p.set(cx, sy + 3, K_TAT);
  // Пояс и рот на нём.
  for (let y = hipY - 6; y <= hipY - 2; y++)
    for (let x = cx - 9; x <= cx + 9; x++) p.set(x, y, y === hipY - 6 ? K_OBI[3] : y === hipY - 2 ? K_OBI[0] : K_OBI[1]);
  if (kp.belly) {
    for (let x = cx - 5; x <= cx + 5; x++) for (let y = hipY - 5; y <= hipY - 3; y++) p.set(x, y, y === hipY - 4 ? hx('#ff3a4a') : hx('#8a0a18'));
    for (let x = cx - 5; x <= cx + 5; x += 2) {
      p.set(x, hipY - 5, BONE[3]);
      p.set(x + 1, hipY - 3, BONE[3]);
    }
  } else {
    for (let x = cx - 4; x <= cx + 4; x++) p.set(x, hipY - 4, K_TAT);
    p.set(cx - 5, hipY - 5, K_TAT);
    p.set(cx + 5, hipY - 5, K_TAT);
    p.set(cx - 2, hipY - 3, BONE[2]);
    p.set(cx + 2, hipY - 3, BONE[2]);
  }
  // Узел пояса.
  p.rect(cx + 6, hipY - 3, cx + 8, hipY + 2, K_OBI[2]);
  p.set(cx + 7, hipY + 3, K_OBI[1]);
  // Руки: нижние, потом верхние.
  const claw = kp.fx === 'claw';
  const rl = kingArm(p, cx + 8, sy + 7, 1, kp.rl, false, claw);
  const ll = kingArm(p, cx - 8, sy + 7, -1, kp.ll, false, claw);
  const ru = kingArm(p, cx + 9, sy + 1, 1, kp.ru, true, claw);
  const lu = kingArm(p, cx - 9, sy + 1, -1, kp.lu, true, claw);
  // Шея и голова.
  p.rect(hxc - 2, headY + 5, hxc + 2, sy, K_SKIN[1]);
  shadeEll(p, hxc, headY, 5.6, 6.2, K_SKIN);
  // Второе лицо: костяная маска на щеке.
  shadeEll(p, hxc - 5.6, headY + 0.6, 3, 4.2, K_MASK, 0.05);
  for (let x = Math.round(hxc - 8); x <= Math.round(hxc - 3); x++) p.set(x, headY + 4, x % 2 ? BONE[3] : K_TAT);
  // Вихры: шапка и зубцы.
  p.ell(hxc, headY - 3, 6.4, 4.4, (x, y) =>
    tone(K_HAIR, ((x + 0.5 - hxc) / 6.4) * LX + ((y + 0.5 - (headY - 3)) / 4.4) * LY + 0.5),
  );
  for (let i = -3; i <= 3; i++) {
    const bx = hxc + i * 2;
    const tip = headY - 9 - (i % 2 === 0 ? 2 : 0) - (i === 0 ? 1 : 0);
    polyShade(p, [[bx - 1.6, headY - 4], [bx + 1.6, headY - 4], [bx + i * 0.9, tip]], K_HAIR, 0.1);
  }
  // Лицо: две пары глаз, полосы под глазами, рот.
  const eyeC = kp.glow > 0.8 ? hx('#ff6a70') : K_EYE;
  for (const ex of [hxc - 2, hxc + 2]) {
    p.set(ex - 1, headY, K_TAT);
    p.set(ex, headY, eyeC);
    p.set(ex + (ex > hxc ? 1 : -1), headY - 1, K_TAT);
  }
  p.set(hxc - 3, headY + 2, hx('#8a0a18'));
  p.set(hxc + 3, headY + 2, hx('#8a0a18'));
  for (const s of [-1, 1]) {
    p.set(hxc + s * 4, headY + 1, K_TAT);
    p.set(hxc + s * 5, headY + 1, K_TAT);
    p.set(hxc + s * 4, headY + 3, K_TAT);
  }
  p.set(hxc, headY - 3, K_TAT);
  if (kp.roar) {
    p.rect(hxc - 2, headY + 3, hxc + 2, headY + 5, hx('#5a0a12'));
    p.set(hxc - 1, headY + 3, BONE[3]);
    p.set(hxc + 1, headY + 3, BONE[3]);
    p.set(hxc, headY + 5, BONE[2]);
  } else {
    for (let x = hxc - 2; x <= hxc + 2; x++) p.set(x, headY + 4, K_TAT);
    p.set(hxc + 3, headY + 3, K_TAT);
  }
  // Глаз маски: закрыт щелью или открыт.
  const mx = Math.round(hxc - 6);
  if (kp.face2) {
    p.set(mx, headY, hx('#ff9a40'));
    p.set(mx + 1, headY, K_EYE);
    p.set(mx, headY - 1, K_TAT);
  } else {
    p.set(mx, headY, K_TAT);
    p.set(mx + 1, headY, K_TAT);
  }
  // Приёмы.
  if (kp.fx === 'cut0') {
    // Два пальца вверх — блик.
    p.set(ru[0], ru[1] - 2, WHITE);
    p.set(ru[0], ru[1] - 3, hx('#ffd0d0'));
  }
  if (kp.fx === 'cut1')
    for (let i = 0; i < 3; i++) {
      const ox = ru[0] - 8 + i * 3;
      stroke(p, ox, ru[1] - 12 + i, ox + 7, ru[1] + 2 + i, alpha(WHITE, 0.85 - i * 0.2), 1);
    }
  if (kp.fx === 'bow') {
    // Лук из пламени в передней руке, стрела — от задней.
    const bx = ru[0] + 1;
    const by = ru[1];
    for (let i = -8; i <= 8; i++) {
      const x = bx + 2.2 * Math.cos((i / 8) * (Math.PI / 2)) - 1;
      const c = FIRE[1 + ((i + kp.f) & 1) + (Math.abs(i) < 3 ? 1 : 0)];
      p.set(x, by + i, c);
      if (hash(i, kp.f, 9) > 0.6) p.set(x + 1, by + i, FIRE[3]);
    }
    const pull = lu[0] - 2 * kp.draw;
    stroke(p, bx - 1, by - 8, pull, lu[1], alpha(FIRE[2], 0.8), 1);
    stroke(p, bx - 1, by + 8, pull, lu[1], alpha(FIRE[2], 0.8), 1);
    stroke(p, pull, lu[1], bx + 5, by, FIRE[3], 1);
    flame(p, bx + 6, by + 2, 3, 4, kp.f, FIRE, 2);
  }
  if (kp.fx === 'pyre') for (const [x, y] of [ru, lu, rl, ll]) flame(p, x, y - 1, 4, 6, kp.f, FIRE, x);
  if (kp.fx === 'sign') {
    // Знак храма в сложенных руках.
    const gx = cx;
    const gy = Math.round((ru[1] + rl[1]) / 2);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + kp.f * 0.6;
      p.set(gx + Math.cos(a) * 3, gy + Math.sin(a) * 2, alpha(K_GHOST, 0.9));
    }
    p.set(gx, gy, WHITE);
  }
  p.outline(kp.ghost ? hx('#5a0a1a') : INK);
  if (kp.ghost)
    // Проклятая кромка: недосягаем, пока светится.
    for (let y = 1; y < p.h - 1; y++)
      for (let x = 1; x < p.w - 1; x++) {
        if (p.solid(x, y)) continue;
        if ((p.solid(x - 1, y) || p.solid(x + 1, y) || p.solid(x, y - 1)) && hash(x, y, kp.f) > 0.45)
          p.set(x, y, alpha(K_GHOST, 0.75));
      }
  if (kp.glow > 0.5) glowDot(p, hxc + 2, headY, K_EYE, 1);
  if (kp.face2 && kp.glow > 0.5) glowDot(p, mx + 1, headY, hx('#ff8a40'), 1);
  if (kp.stars) stars(p, hxc, headY - 12, 7, kp.f & 3);
  return { p, ax: cx, ay: G, eye: [hxc + 2, headY] };
}

registerMobPainter('f12boss', (m: Mob, pose: MobPose) => {
  const mode = pose.mode;
  const f = pose.frame;
  const phase = m.data.phase ?? 0;
  const ghost = (m.data.ghost ?? 0) > 0;
  const base = kingBase();
  base.face2 = phase >= 1;
  base.glow = phase >= 3 ? 1 : 0.6;
  base.ghost = ghost;
  let kp: KingPose = base;
  let anim = mode;
  let fr = 0;
  const arms = (a: [Arm, Arm], b: [Arm, Arm] = a) => ({ ru: a[0], rl: a[1], lu: b[0], ll: b[1] });
  switch (mode) {
    case 'f12_intro':
      fr = Math.min(3, Math.floor(pose.t / (KING.intro / 4)));
      kp =
        fr < 2
          ? { ...base, body: 'sit', ...arms(A_SIT), glow: fr ? 0.9 : 0.3, face2: false, aura: fr * 0.5, f: fr }
          : fr === 2
            ? { ...base, body: 'kneel', ...arms(A_LIMP), glow: 1, face2: false, aura: 0.8, f: fr }
            : { ...base, ...arms(A_CLAW0), roar: true, glow: 1, face2: false, aura: 1, f: fr };
      break;
    case 'f12_cut':
      fr = pose.t < KING.cutAim * 0.7 ? 0 : 1;
      kp =
        fr === 0
          ? { ...base, ru: [3, -6, 2, -13], rl: A_CROSS, lu: A_REST[0], ll: A_CROSS, fx: 'cut0', tilt: 1 }
          : { ...base, ru: [7, 0, 13, 6], rl: A_CROSS, lu: A_REST[0], ll: A_CROSS, fx: 'cut1', tilt: 1, step: 1 };
      break;
    case 'f12_cleave':
      fr = pose.t < 0.6 ? 0 : 1;
      kp = fr === 0 ? { ...base, ...arms(A_CLAW0), fx: 'claw', bob: -1 } : { ...base, ...arms(A_CLAW1), fx: 'claw', roar: true, step: 1 };
      break;
    case 'f12_bow': {
      const st = Math.min(2, Math.floor(pose.t / (KING.bowDraw / 3)));
      fr = st * 2 + (f & 1);
      kp = {
        ...base,
        ru: [7, -1, 14, -1],
        lu: [4, 2, -2, 0],
        rl: [5, 4, 8, 9],
        ll: A_REST[1],
        fx: 'bow',
        draw: st / 2,
        f: f & 1,
        glow: 1,
        face2: true,
        step: -1,
      };
      break;
    }
    case 'f12_pyre':
      fr = f & 3;
      kp = { ...base, ...arms(A_PYRE), fx: 'pyre', roar: true, f: fr, glow: 1 };
      break;
    case 'f12_cast':
      fr = (Math.floor(pose.t * 6) & 1) + (pose.t > 1.2 ? 2 : 0);
      kp = { ...base, ...arms(A_SIGN), fx: 'sign', belly: pose.t > 1.2, aura: pose.t > 1.2 ? 1 : 0.5, glow: 1, f: fr };
      break;
    case 'f12_domain':
      fr = f & 3;
      kp = {
        ...base,
        body: 'sit',
        ...arms(A_SIT),
        bob: [0, -1, -1, 0][fr],
        belly: true,
        glow: 1,
        face2: true,
        aura: 1,
        f: fr,
      };
      break;
    case 'f12_broken':
      fr = f & 3;
      kp = { ...base, body: 'kneel', ...arms(A_LIMP), tilt: 2, stars: true, glow: 0.2, f: fr, bob: 1 };
      break;
    case 'f12_trainhit':
      fr = f & 3;
      kp = { ...base, body: 'kneel', ...arms(A_LIMP), tilt: -3, stars: true, glow: 0.2, f: fr, bob: 2 };
      break;
    case 'recover':
      fr = 0;
      kp = { ...base, ...arms(A_LIMP), bob: 1 };
      break;
    case 'dying':
      fr = deathK(pose);
      kp = { ...base, body: 'kneel', ...arms(A_LIMP), roar: true, glow: 0, tilt: 2 };
      anim = 'dead';
      break;
    default:
      if (pose.anim === 'run') {
        anim = 'run';
        fr = f & 3;
        const s = [1, 0, -1, 0][fr];
        kp = {
          ...base,
          step: s,
          bob: fr & 1 ? -1 : 0,
          ru: [4, 7, 5, 14 - 2 * s],
          lu: [4, 7, 5, 14 + 2 * s],
          rl: [3, 6, 4, 12 + s],
          ll: [3, 6, 4, 12 - s],
        };
      } else {
        anim = 'idle';
        fr = f & 3;
        kp = { ...base, bob: fr === 2 ? 1 : 0 };
      }
  }
  const tag = `${anim}|${phase >= 1 ? 1 : 0}${phase >= 3 ? 1 : 0}${ghost ? 1 : 0}`;
  return frameOf('f12boss', pose, tag, fr, () => {
    const b = drawKing(kp);
    if (anim === 'dead') b.p = ashen(b.p, fr, 11, hx('#ff2a4a'));
    return b;
  });
});

// ===========================================================================
// Метки на полу: рельсы, лента, территории, храм, удары короля.
// ===========================================================================

type ZX = (Zone | Strike) & { f12?: unknown; w?: number; ang?: number; arc?: number };

const rgba = (c: RGBA, a: number) =>
  `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a)).toFixed(3)})`;

/** Метка удара наливается: 0…1. */
const kOf = (z: Zone | Strike) => {
  const s = z as Strike;
  if (typeof s.warn === 'number' && s.warn > 0) return Math.min(1, s.t / s.warn);
  return 1;
};

const RED = hx('#ff2a2a');
const AMBER = hx('#ffb030');
const CRIMSON = hx('#ff2a5a');
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

registerZonePainter('f12_grid', (g, z, px, py, S) => {
  const v = (z as ZX).f12 as GridView | undefined;
  const sim = paintSim();
  if (!v || !sim) return true;
  const now = sim.time;
  const warnK = Math.max(0, Math.min(1, 1 - (v.at - now) / KING.gridWarn));
  const cutting = now >= v.at && now < v.at + v.cut;
  if (now >= v.at + v.cut) return true;
  const ks = f12King(sim);
  const wards = ks ? ks.wards : [];
  const R = KING.wardR;
  const sx = (wx: number) => Math.round(px + (wx - z.x) * S);
  const sy = (wy: number) => Math.round(py + (wy - z.y) * S);
  const lines: [boolean, number][] = [];
  for (let x = v.x0 + v.off; x <= v.x1; x += v.step) lines.push([false, x]);
  for (let y = v.y0 + v.off; y <= v.y1; y += v.step) lines.push([true, y]);
  for (const [hz, c] of lines) {
    let segs: [number, number][] = [[hz ? v.x0 : v.y0, hz ? v.x1 : v.y1]];
    for (const w of wards) {
      const d = hz ? Math.abs(w.y - c) : Math.abs(w.x - c);
      if (d >= R) continue;
      const half = Math.sqrt(R * R - d * d);
      const m = hz ? w.x : w.y;
      const out: [number, number][] = [];
      for (const [a, b] of segs) {
        if (m - half > a) out.push([a, Math.min(b, m - half)]);
        if (m + half < b) out.push([Math.max(a, m + half), b]);
      }
      segs = out.filter(([a, b]) => b > a);
    }
    for (const [a, b] of segs) {
      const x0 = hz ? sx(a) : sx(c);
      const y0 = hz ? sy(c) : sy(a);
      const len = hz ? sx(b) - x0 : sy(b) - y0;
      if (cutting) {
        g.fillStyle = rgba(RED, 0.55);
        if (hz) g.fillRect(x0, y0 - 1, len, 3);
        else g.fillRect(x0 - 1, y0, 3, len);
        g.fillStyle = rgba(WHITE, 1);
        if (hz) g.fillRect(x0, y0, len, 1);
        else g.fillRect(x0, y0, 1, len);
      } else {
        g.fillStyle = rgba(RED, 0.18 + 0.6 * warnK);
        if (hz) g.fillRect(x0, y0, len, 1);
        else g.fillRect(x0, y0, 1, len);
        if (warnK > 0.6) {
          g.fillStyle = rgba(RED, (warnK - 0.6) * 0.6);
          if (hz) g.fillRect(x0, y0 - 1, len, 3);
          else g.fillRect(x0 - 1, y0, 3, len);
        }
      }
    }
  }
  return true;
});

registerZonePainter('f12_ward', (g, zz, px, py, S, time) => {
  const z = zz as Zone;
  const k = Math.min(1, z.t / 0.25);
  const a = Math.min(1, (z.life - z.t) / 0.3) * k;
  if (a <= 0) return true;
  const R = z.r * S * (0.4 + 0.6 * k);
  const gold = hx('#ffe08a');
  g.fillStyle = rgba(gold, 0.18 * a);
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.fill();
  g.lineWidth = 1;
  g.strokeStyle = rgba(hx('#fff4c8'), 0.95 * a);
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.stroke();
  g.strokeStyle = rgba(hx('#ffb030'), 0.6 * a);
  g.beginPath();
  g.arc(px, py, Math.max(1, R - 3), 0, TAU);
  g.stroke();
  // Четыре бумажных печати по кругу.
  for (let i = 0; i < 4; i++) {
    const an = time * 0.8 + (i / 4) * TAU;
    const x = Math.round(px + Math.cos(an) * R);
    const y = Math.round(py + Math.sin(an) * R);
    g.fillStyle = rgba(PAPER[3], a);
    g.fillRect(x - 1, y - 2, 3, 5);
    g.fillStyle = rgba(hx('#c01a2a'), a);
    g.fillRect(x, y, 1, 1);
  }
  return true;
});

// --- Жертвенный храм: встаёт из пола позади короля. ---------------------

const SHRINE_W = 96;
const SHRINE_H = 84;

function shrinePx(f: number): Px {
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

const shrineImg: HTMLCanvasElement[] = [];

registerZonePainter('f12_shrine', (g, _z, px, py, _S, time) => {
  const k = F12_FX.domain;
  if (k <= 0) return true;
  const f = Math.floor(time * 3) % 2;
  if (!shrineImg[f]) shrineImg[f] = shrinePx(f).canvas();
  const img = shrineImg[f];
  // Храм встаёт из пола: сначала крыша, потом пасть.
  const hk = Math.max(1, Math.round(SHRINE_H * k));
  g.drawImage(img, 0, 0, SHRINE_W, hk, Math.round(px - SHRINE_W / 2), Math.round(py - hk), SHRINE_W, hk);
  return true;
});

// --- Огонь, лужа слёз, поезд по своим. ----------------------------------

const fireImg: HTMLCanvasElement[] = [];
function fireFrame(f: number): HTMLCanvasElement {
  if (!fireImg[f]) {
    const p = new Px(10, 13);
    flame(p, 5, 12, 7, 10, f, FIRE, 1);
    fireImg[f] = p.canvas();
  }
  return fireImg[f];
}

registerZonePainter('f12_fire', (g, zz, px, py, S, time) => {
  const z = zz as Zone;
  const a = Math.min(1, (z.life - z.t) / 0.6, z.t / 0.15);
  if (a <= 0) return true;
  g.fillStyle = rgba(hx('#ff6a10'), 0.16 * a);
  g.beginPath();
  g.arc(px, py, z.r * S * 0.8, 0, TAU);
  g.fill();
  g.globalAlpha = a;
  for (let i = 0; i < 2; i++) {
    const f = (Math.floor(time * 10) + z.id + i * 2) % 4;
    const ox = i ? 3 : -5;
    const oy = i ? 2 : 0;
    g.drawImage(fireFrame(f), Math.round(px + ox - 5), Math.round(py + oy - 12));
  }
  g.globalAlpha = 1;
  return true;
});

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

registerZonePainter('f12_cut', (g, z, px, py, S) => {
  const s = z as ZX;
  const k = kOf(z);
  const L = s.r * S;
  const w = Math.max(2, (s.w ?? 0.36) * S);
  g.save();
  g.translate(px, py);
  g.rotate(s.ang ?? 0);
  g.fillStyle = rgba(RED, 0.08 + 0.22 * k);
  g.fillRect(0, -w, L, w * 2);
  g.fillStyle = rgba(RED, 0.45 + 0.5 * k);
  g.fillRect(0, -w, L, 1);
  g.fillRect(0, w - 1, L, 1);
  // Разрез проступает от короля к концу линии.
  g.fillStyle = rgba(WHITE, 0.4 + 0.6 * k);
  g.fillRect(0, 0, Math.round(L * k), 1);
  g.fillRect(Math.round(L * k) - 2, -1, 3, 3);
  g.restore();
  return true;
});

registerZonePainter('f12_arrow', (g, z, px, py, S) => {
  const s = z as ZX;
  const L = s.r * S;
  const w = Math.max(2, (s.w ?? 1) * S * 0.5);
  g.save();
  g.translate(px, py);
  g.rotate(s.ang ?? 0);
  g.fillStyle = rgba(hx('#ff6a10'), 0.55);
  g.fillRect(0, -w, L, w * 2);
  g.fillStyle = rgba(hx('#ffd060'), 0.9);
  g.fillRect(0, -2, L, 4);
  g.fillStyle = rgba(WHITE, 1);
  g.fillRect(0, -1, L, 2);
  g.restore();
  return true;
});

registerZonePainter('f12_pyre', (g, z, px, py, S, time) => {
  const k = kOf(z);
  const R = z.r * S;
  g.fillStyle = rgba(hx('#ff3a10'), 0.08 + 0.25 * k);
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.fill();
  g.lineWidth = 1;
  g.strokeStyle = rgba(hx('#ffb040'), 0.5 + 0.5 * k);
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.stroke();
  // Знак огня сжимается к центру; искры поднимаются.
  g.strokeStyle = rgba(hx('#ff6a20'), 0.6 * k);
  g.beginPath();
  g.arc(px, py, R * (1 - 0.6 * k), time * 3, time * 3 + Math.PI * 1.4);
  g.stroke();
  g.fillStyle = rgba(hx('#ffe080'), 0.8 * k);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + z.id;
    const u = (time * 1.4 + i * 0.17) % 1;
    g.fillRect(Math.round(px + Math.cos(a) * R * 0.7), Math.round(py + Math.sin(a) * R * 0.5 - u * 10 * k), 1, 2);
  }
  return true;
});

registerZonePainter('f12_claw', (g, z, px, py, S) => {
  const s = z as ZX;
  const k = kOf(z);
  const R = s.r * S;
  const a = s.ang ?? 0;
  const arc = s.arc ?? 1.9;
  g.fillStyle = rgba(CRIMSON, 0.1 + 0.22 * k);
  g.beginPath();
  g.moveTo(px, py);
  g.arc(px, py, R, a - arc / 2, a + arc / 2);
  g.closePath();
  g.fill();
  // Четыре руки — четыре когтя, дугами.
  g.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    const r = R * (0.45 + i * 0.17);
    g.strokeStyle = rgba(i % 2 ? WHITE : hx('#ffb0c0'), 0.3 + 0.6 * k);
    g.beginPath();
    g.arc(px, py, r, a - arc / 2, a - arc / 2 + arc * k);
    g.stroke();
  }
  return true;
});

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
