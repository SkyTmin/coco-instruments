// Этаж 13 «Город за стенами» — рисовальщики: исполины (три вида — анфас,
// спиной, в профиль: затылок виден и светится, когда герой за спиной),
// Колосс, ухмылки, вороны, контрабандист; реквизит города (дома, трубы с
// дымом, пожары, пушки, столбы-якоря, набат), свои клетки трёх районов,
// метки ударов и иконки вещей.
//
// Всё нарисовано кодом: пиксели 16 на клетку, свет сверху-слева, контур
// тёмный, палитра — камень и черепица города плюс два акцента этажа:
// огонь пожаров (тёплый) и пар исполинов (белый). Кадры собираются один
// раз и лежат в кеше: рисовать кадр в кадре нельзя.

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
import { F13_BELL, F13_MARK, F13_OUTER, F13_WALL } from './f13';
import { COL, f13State } from './f13-brains';

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

/** Детерминированный шум по двум числам, 0…1. */
const hash = (a: number, b: number, c = 0) => {
  let h = (a * 374761393 + b * 668265263 + c * 1274126177) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

const FIRE = [hx('#7a1806'), hx('#d44a10'), hx('#ff9a2a'), hx('#fff0a0')];

/** Огонь: язык пламени снизу вверх, кадр f меняет рисунок. */
function flame(p: Px, cx: number, by: number, w: number, h: number, f: number, seed = 0): void {
  for (let y = 0; y < h; y++) {
    const k = y / h;
    const half = w * 0.5 * (1 - k * k) * (0.85 + 0.3 * hash(y, f, seed));
    const sway = Math.sin(k * 3 + f * 1.3 + seed) * k * 1.2;
    for (let x = -Math.ceil(half); x <= Math.ceil(half); x++) {
      const e = Math.abs(x) / (half + 0.01);
      if (e > 1) continue;
      const hot = 1 - Math.max(e, k * 0.9);
      const c = hot > 0.62 ? FIRE[3] : hot > 0.38 ? FIRE[2] : hot > 0.15 ? FIRE[1] : FIRE[0];
      p.set(Math.round(cx + x + sway), by - y, c);
    }
  }
  if (hash(f, seed, 3) > 0.4) p.set(Math.round(cx + (hash(f, seed) - 0.5) * w), by - h - 1, FIRE[2]);
}

/** Клуб дыма/пара: мягкие круги, `k` — плотность. */
function cloud(p: Px, cx: number, cy: number, r: number, c: RGBA, seed: number, k = 1): void {
  for (let i = 0; i < 5; i++) {
    const a = hash(i, seed) * TAU;
    const d = r * 0.5 * hash(seed, i, 7);
    const rr = r * (0.45 + 0.3 * hash(i, seed, 3));
    p.ell(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.7, rr, rr * 0.85, alpha(c, (c[3] / 255) * k));
  }
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
  if (flash) p = p.tint(WHITE, 0.8);
  if (left) p = p.flipX();
  const eye = b.eye ? ([left ? p.w - 1 - b.eye[0] : b.eye[0], b.eye[1]] as [number, number]) : null;
  const out: MobFrame = { img: p.canvas(), ax: left ? p.w - b.ax : b.ax, ay: b.ay, eye };
  frames.set(key, out);
  return out;
}

function frameOf(key: string, pose: MobPose, build: () => Built): MobFrame {
  const k = `${key}|${pose.left ? 1 : 0}|${pose.flash ? 1 : 0}|${pose.look}`;
  const hit = frames.get(k);
  if (hit) return hit;
  return finish(k, build(), pose.look, pose.flash, pose.left);
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

/**
 * Смерть исполина: кожа сходит, мясо краснеет, тело оседает и тает паром
 * сверху вниз — кадр k 0…3. Не шум по пикселю (это «сломанный телевизор»),
 * а крупные клубы и ровное таяние.
 */
function evaporate(p: Px, k: number, seed: number): Px {
  if (k <= 0) return p;
  const o = new Px(p.w, p.h);
  let top = p.h;
  let bot = 0;
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++)
      if (p.data[(y * p.w + x) * 4 + 3]) {
        top = Math.min(top, y);
        bot = Math.max(bot, y);
      }
  const hgt = Math.max(1, bot - top);
  // Сверху тает: всё выше линии — пар.
  const melt = top + hgt * (k * 0.22);
  const sink = k;
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      const i = (y * p.w + x) * 4;
      if (!p.data[i + 3]) continue;
      const ty = Math.min(p.h - 1, y + sink);
      if (y < melt) continue;
      let c: RGBA = [p.data[i], p.data[i + 1], p.data[i + 2], 255];
      const burn = Math.min(1, k * 0.3 + (1 - (y - melt) / hgt) * 0.3);
      const l = (c[0] + c[1] + c[2]) / 765;
      c = mixc(c, tone(MUSCLE, l * 1.4), burn);
      // Кость проступает крупными пятнами.
      if (k >= 2 && hash(Math.floor(x / 2), Math.floor(y / 2), seed) < 0.16) c = tone(BONE, l + 0.3);
      o.set(x, ty, c);
    }
  // Клубы пара над тающим.
  const cx = p.w / 2;
  for (let i = 0; i < 3 + k; i++) {
    const x = cx + (hash(i, seed, k) - 0.5) * p.w * 0.6;
    const y = melt + (hash(seed, i, 9) - 0.6) * hgt * 0.35;
    cloud(o, x, y, 2.5 + k + hash(i, k) * 2, alpha(STEAM, 0.8), seed + i * 7 + k, 1);
  }
  return o;
}

const deathK = (pose: MobPose) => (pose.mode === 'dying' ? Math.min(3, Math.floor(pose.t / 0.17)) : 0);

/** Вид по взгляду: анфас (к нам), спиной, в профиль. */
type View = 'front' | 'back' | 'side';
function viewOf(face: number): View {
  const s = Math.sin(face);
  return s > 0.55 ? 'front' : s < -0.55 ? 'back' : 'side';
}

// ---------------------------------------------------------------------------
// Палитры.
// ---------------------------------------------------------------------------

const SKIN = tn('#4a221c', '#8c4c3c', '#c47e62', '#eab08e');
const SKIN_PALE = tn('#4e3a2c', '#8e7458', '#c4a882', '#ecd6ae');
const SKIN_TAN = tn('#3a1e14', '#744430', '#a86a48', '#d6986a');
const SKIN_RED = tn('#3a1612', '#7a3026', '#b0523e', '#dc8466');
const HAIR_BROWN = tn('#1c100a', '#3a2214', '#5a3620', '#7a4e2e');
const HAIR_BLACK = tn('#0c0a0c', '#1c181c', '#302a30', '#48404a');
const HAIR_BLOND = tn('#4a3614', '#8a6a2a', '#c8a048', '#ecd07a');
const PLATE = tn('#3a3430', '#7a7064', '#b8ac98', '#e8ddc8');
const CRYST = tn('#1a3a4a', '#3a7890', '#7ac4dc', '#d8f6ff');
const MUSCLE = tn('#3a0a0c', '#7a1a1a', '#b8382c', '#ea7058');
const SINEW = hx('#f0c8a8');
const BONE = tn('#4a4032', '#8a7c62', '#c4b494', '#f0e6cc');
const TEETH = hx('#f4ecd8');
const MOUTH = hx('#2a0a08');
const NAPE_HOT = hx('#fff4c8');
const NAPE_GLOW = hx('#ff9a3a');
const STEAM = hx('#f6f2ee', 150);

// ---------------------------------------------------------------------------
// Исполин: параметрическая фигура. Анфас — лицо и ухмылка; спиной —
// затылок (светится, когда герой за спиной); в профиль — челюсть и затылок.
// ---------------------------------------------------------------------------

interface GiantLook {
  /** Рост, пиксели (от подошв до макушки). */
  H: number;
  skin: Tones;
  hair: Tones | null;
  hairStyle: 'wild' | 'short' | 'long' | 'bald' | 'bun';
  /** Ширина плеч, живот, длина рук и ног (доли). */
  bulk: number;
  belly: number;
  arms: number;
  legs: number;
  /** Голова: доля роста. */
  head: number;
  grin: number;
  eyes: 'blank' | 'wide' | 'crazy' | 'calm';
  armor?: boolean;
  crystal?: boolean;
  hunch?: number;
}

/** Поза исполина. */
interface GPose {
  view: View;
  /** Фаза шага 0…3 и шагает ли. */
  step: number;
  walk: boolean;
  /** Правая (дальняя в профиль) рука: куда кисть, в долях длины от плеча. */
  armR: [number, number] | null;
  armL: [number, number] | null;
  /** Поднятая нога (топот): 0…1. */
  knee: number;
  /** Наклон корпуса вперёд, пиксели. */
  lean: number;
  /** Приседание (приземление, хват), пиксели. */
  squat: number;
  /** Рот раскрыт (рёв). */
  roar: boolean;
  back: boolean;
  cut: boolean;
  /** Держит глыбу над головой. */
  rock: boolean;
  /** Кристалл поверх (затвердел). */
  shell: number;
}

const GP0: GPose = {
  view: 'front',
  step: 0,
  walk: false,
  armR: null,
  armL: null,
  knee: 0,
  lean: 0,
  squat: 0,
  roar: false,
  back: false,
  cut: false,
  rock: false,
  shell: 0,
};

/** Конечность из двух частей со сгибом (плечо-локоть-кисть). */
function joint(
  p: Px,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  len: number,
  r0: number,
  r1: number,
  t: Tones,
  bend: number,
  bias = 0,
): [number, number] {
  const d = Math.hypot(bx - ax, by - ay) || 1e-3;
  const half = len / 2;
  let ex = (ax + bx) / 2;
  let ey = (ay + by) / 2;
  if (d < len) {
    const h = Math.sqrt(Math.max(0, half * half - (d / 2) * (d / 2)));
    ex += (-(by - ay) / d) * h * bend;
    ey += ((bx - ax) / d) * h * bend;
  }
  const rm = (r0 + r1) / 2;
  limb(p, ax, ay, ex, ey, r0, rm, t, bias);
  limb(p, ex, ey, bx, by, rm, r1, t, bias);
  return [ex, ey];
}

/** Затылок: горячее ядро и ореол, когда герой за спиной; иначе — рубец. */
function nape(p: Px, x: number, y: number, glow: boolean, cut: boolean, big = 1): void {
  if (glow) {
    const R = 2.6 * big;
    for (let dy = -Math.ceil(R + 1); dy <= Math.ceil(R + 1); dy++)
      for (let dx = -Math.ceil(R + 2); dx <= Math.ceil(R + 2); dx++) {
        const d = Math.hypot(dx / 1.3, dy);
        if (d > R + 1) continue;
        if (d > R - 0.6) p.set(x + dx, y + dy, alpha(NAPE_GLOW, 0.55));
        else if (d > R * 0.45) p.set(x + dx, y + dy, mixc(NAPE_GLOW, NAPE_HOT, 0.35));
        else p.set(x + dx, y + dy, NAPE_HOT);
      }
  } else {
    p.set(x - 1, y, hx('#6a2a22'));
    p.set(x, y, hx('#a04a3a'));
    p.set(x + 1, y, hx('#6a2a22'));
  }
  if (cut) {
    stroke(p, x - 3 * big, y - 2 * big, x + 3 * big, y + 2 * big, hx('#fff8f0'));
    p.set(x + 3 * big + 1, y + 2 * big + 1, hx('#e05040'));
    p.set(x - 3 * big - 1, y - 2 * big, hx('#e05040'));
  }
}

/** Лицо анфас: глаза, нос, ухмылка до ушей. */
function faceFront(p: Px, cx: number, cy: number, rx: number, ry: number, lk: GiantLook, roar: boolean): [number, number] {
  const ey = Math.round(cy - ry * 0.15);
  const ex = Math.max(1.4, rx * 0.42);
  // Глазницы.
  for (const s of [-1, 1]) {
    const x = Math.round(cx + s * ex);
    p.set(x, ey, hx('#2a1410'));
    p.set(x - s, ey, hx('#3a1c16'));
    // Зрачок: пустой взгляд — точка света.
    if (lk.eyes === 'crazy') p.set(x + (s > 0 ? 0 : 0), ey - 1, hx('#fff6d0'));
    else p.set(x, ey, lk.eyes === 'calm' ? hx('#6ab8d8') : hx('#fff6d0'));
    if (lk.eyes === 'wide') p.set(x, ey + 1, hx('#2a1410'));
  }
  // Нос — тень.
  p.set(Math.round(cx), Math.round(cy + ry * 0.12), tone(lk.skin, 0.1));
  // Ухмылка до ушей: ряд зубов над тёмной щелью, уголки задраны к щекам.
  const my = cy + ry * 0.46;
  const w = Math.min(rx * 1.02, Math.max(2, rx * lk.grin));
  if (roar) {
    p.ell(cx, my + 0.5, w * 0.6, ry * 0.4, MOUTH);
    for (let x = Math.round(cx - w * 0.5); x <= Math.round(cx + w * 0.5); x++)
      if (x % 2 === 0) p.set(x, Math.round(my - ry * 0.3), TEETH);
  } else {
    const tooth = mixc(TEETH, hx('#b8a888'), 0.45);
    for (let x = Math.round(cx - w); x <= Math.round(cx + w); x++) {
      const k = (x + 0.5 - cx) / w;
      const y = Math.round(my - k * k * ry * 0.34);
      p.set(x, y, MOUTH);
      if (Math.abs(k) < 0.88) p.set(x, y - 1, x % 2 === 0 ? TEETH : tooth);
      p.set(x, y + 1, tone(lk.skin, 0.12));
    }
  }
  return [Math.round(cx - ex), ey];
}

/** Волосы сверху головы. */
function hairOn(p: Px, cx: number, cy: number, rx: number, ry: number, lk: GiantLook, view: View, seed: number): void {
  const t = lk.hair;
  if (!t || lk.hairStyle === 'bald') return;
  const top = cy - ry;
  if (lk.hairStyle === 'wild' || lk.hairStyle === 'short') {
    const spikes = lk.hairStyle === 'wild' ? 1.6 : 0.8;
    for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
      const k = (x + 0.5 - cx) / (rx + 1);
      if (Math.abs(k) > 1) continue;
      const base = cy - Math.sqrt(1 - k * k) * ry;
      const h = (view === 'back' ? ry * 1.1 : ry * 0.55) + hash(x, seed) * spikes;
      for (let y = Math.floor(base - spikes); y <= Math.floor(base + h); y++) {
        const l = 0.8 - (y - base + spikes) / (h + spikes) + k * LX * 0.6;
        p.set(x, y, tone(t, l));
      }
    }
  } else if (lk.hairStyle === 'long') {
    shadeEll(p, cx, top + ry * 0.6, rx + 1, ry * 0.75, t);
    if (view !== 'front') limb(p, cx, cy, cx + (view === 'side' ? -rx : 0), cy + ry * 2.2, rx * 0.9, rx * 0.6, t);
    else {
      limb(p, cx - rx, cy - 1, cx - rx - 0.5, cy + ry * 1.6, 1.2, 0.8, t);
      limb(p, cx + rx, cy - 1, cx + rx + 0.5, cy + ry * 1.6, 1.2, 0.8, t);
    }
  } else if (lk.hairStyle === 'bun') {
    shadeEll(p, cx, top + ry * 0.45, rx + 0.5, ry * 0.6, t);
    shadeEll(p, cx + (view === 'side' ? -rx * 0.8 : 0), top - 0.5, 1.8, 1.5, t, 0.1);
  }
}

/**
 * Исполин целиком. Холст — `W`×(`H`+запас), земля на `ay`. Смотрит вправо
 * (в профиль) — отражает `finish`.
 */
/** Геометрия фигуры — для своих накладок вида (рёбра Колосса, пар). */
interface Geo {
  cx: number;
  ay: number;
  hipY: number;
  chestY: number;
  neckY: number;
  headCx: number;
  headCy: number;
  headRx: number;
  headRy: number;
  shW: number;
  hipW: number;
  side: boolean;
}

function drawGiant(lk: GiantLook, g: GPose, seed: number, deco?: (p: Px, geo: Geo) => void): Built {
  const H = lk.H;
  const W = Math.round(H * 0.8 + 6);
  const top = Math.round(H * 0.34) + 4;
  const p = new Px(W, H + top + 3);
  const ay = H + top;
  const cx = W / 2;
  const side = g.view === 'side';
  const bob = g.walk && g.step % 2 === 1 ? 1 : 0;
  const legLen = H * 0.4 * lk.legs;
  const hipY = ay - legLen + g.squat + bob;
  const torso = H * 0.3;
  const hunch = lk.hunch ?? 0;
  const chestY = hipY - torso + hunch * 0.5;
  const headRy = Math.max(3, H * lk.head * 0.5);
  const headRx = headRy * 0.92;
  const neckY = chestY - 1;
  const leanX = side ? g.lean + hunch : 0;
  const headCx = cx + leanX + (side ? 1 : 0) + (side ? hunch * 0.6 : 0);
  const headCy = neckY - headRy + 1 + (side ? hunch * 0.6 : hunch * 0.4);
  const shW = H * 0.16 * lk.bulk;
  const hipW = H * 0.085 * (0.8 + lk.bulk * 0.2);
  const armLen = H * 0.37 * lk.arms;
  const armR0 = Math.max(1.4, H * 0.045 * lk.bulk);
  const armR1 = Math.max(1, armR0 * 0.75);
  const legR0 = Math.max(1.6, H * 0.055 * (0.85 + lk.bulk * 0.2));
  const legR1 = Math.max(1.1, legR0 * 0.7);
  const skin = lk.skin;
  const dark: Tones = [skin[0], skin[0], skin[1], skin[2]];
  // --- Ноги.
  const ph = (g.step / 4) * TAU;
  const legs: [number, number, number, number, boolean][] = [];
  if (side) {
    const sw = g.walk ? Math.sin(ph) * H * 0.12 : 0;
    const liftA = g.walk ? Math.max(0, Math.sin(ph)) * 2 : 0;
    const liftB = g.walk ? Math.max(0, -Math.sin(ph)) * 2 : 0;
    legs.push([cx - 1 + leanX * 0.3, hipY, cx - 1 - sw, ay - liftB, true]);
    legs.push([cx + 1 + leanX * 0.3, hipY, cx + 1 + sw + g.knee * H * 0.1, ay - liftA - g.knee * H * 0.2, false]);
  } else {
    const liftA = g.walk ? Math.max(0, Math.sin(ph)) * 2.2 : 0;
    const liftB = g.walk ? Math.max(0, -Math.sin(ph)) * 2.2 : 0;
    legs.push([cx - hipW, hipY, cx - hipW * 1.25, ay - liftA, false]);
    legs.push([cx + hipW, hipY, cx + hipW * 1.25 + g.knee * 2, ay - liftB - g.knee * H * 0.22, false]);
  }
  // Дальняя нога в профиль — темнее, раньше.
  for (const [x0, y0, x1, y1, far] of legs) {
    if (!far) continue;
    joint(p, x0, y0, x1, y1 - 1, legLen, legR0, legR1, dark, 1, -0.1);
    shadeEll(p, x1 + 1, y1 - 0.5, legR1 + 0.8, 1.2, dark);
  }
  // Дальняя рука в профиль.
  const arm = (sx: number, sy: number, tgt: [number, number] | null, dflt: [number, number], bend: number, far: boolean) => {
    const [tx, ty] = tgt ?? dflt;
    const hx2 = sx + tx * armLen;
    const hy2 = sy + ty * armLen;
    const t = far ? dark : skin;
    const [ex, ey] = joint(p, sx, sy, hx2, hy2, armLen, armR0, armR1, t, bend);
    shadeEll(p, hx2, hy2 + 0.5, armR1 + 0.9, armR1 + 1.1, t, far ? -0.2 : 0);
    if (lk.armor && !far) {
      // Латы на предплечье.
      limb(p, ex, ey, (ex + hx2) / 2, (ey + hy2) / 2, armR0 + 0.4, armR1 + 0.3, PLATE);
    }
    if (lk.crystal && !far) {
      p.set(Math.round(ex), Math.round(ey) - 1, CRYST[3]);
      p.set(Math.round((ex + hx2) / 2), Math.round((ey + hy2) / 2), CRYST[2]);
    }
    return [hx2, hy2];
  };
  const swingA = g.walk ? Math.sin(ph) * 0.18 : 0;
  if (side) arm(cx + leanX - 1, chestY + 1, g.armR, [-0.05 - swingA, 0.95], -1, true);
  // --- Тело.
  const bellyR = torso * 0.42 * (0.8 + lk.belly * 0.5);
  if (side) {
    shadeEll(p, cx + leanX * 0.6, chestY + torso * 0.32, shW * 0.62, torso * 0.42, skin);
    shadeEll(p, cx + leanX * 0.3 + lk.belly, hipY - torso * 0.22, shW * 0.5 + lk.belly, bellyR, skin, -0.05);
  } else {
    shadeEll(p, cx, chestY + torso * 0.32, shW * 0.95, torso * 0.42, skin);
    shadeEll(p, cx, hipY - torso * 0.22, hipW * 1.6 + lk.belly * 1.4, bellyR, skin, -0.05);
    // Плечи.
    shadeEll(p, cx - shW * 0.85, chestY + 1.5, armR0 + 1, armR0 + 0.6, skin);
    shadeEll(p, cx + shW * 0.85, chestY + 1.5, armR0 + 1, armR0 + 0.6, skin);
  }
  // Рельеф: грудь и живот спереди, лопатки и хребет со спины.
  const lineC = tone(skin, 0.05);
  if (g.view === 'front' && !lk.armor) {
    for (let y = Math.round(chestY + 2); y < Math.round(hipY - 2); y++) p.set(Math.round(cx), y, lineC);
    stroke(p, cx - shW * 0.6, chestY + torso * 0.42, cx - 1, chestY + torso * 0.48, lineC);
    stroke(p, cx + 1, chestY + torso * 0.48, cx + shW * 0.6, chestY + torso * 0.42, lineC);
    p.set(Math.round(cx), Math.round(hipY - torso * 0.2), tone(skin, 0));
  }
  if (g.view === 'back') {
    for (let y = Math.round(chestY + 1); y < Math.round(hipY - 1); y++) p.set(Math.round(cx), y, lineC);
    stroke(p, cx - shW * 0.55, chestY + 3, cx - 2, chestY + torso * 0.4, lineC);
    stroke(p, cx + 2, chestY + torso * 0.4, cx + shW * 0.55, chestY + 3, lineC);
  }
  if (lk.armor) {
    // Латы: грудные пластины, наплечники; со спины — щель по хребту.
    if (g.view !== 'back') {
      polyPlate(p, cx + leanX * 0.5, chestY + torso * 0.3, shW * (side ? 0.6 : 0.9), torso * 0.36, side);
    } else {
      polyPlate(p, cx - shW * 0.45, chestY + torso * 0.3, shW * 0.4, torso * 0.36, true);
      polyPlate(p, cx + shW * 0.45, chestY + torso * 0.3, shW * 0.4, torso * 0.36, true);
      for (let y = Math.round(chestY); y < Math.round(hipY - 2); y++) p.set(Math.round(cx), y, hx('#6a2a22'));
    }
    if (!side) {
      shadeEll(p, cx - shW * 0.9, chestY + 1, armR0 + 1.8, armR0 + 1, PLATE);
      shadeEll(p, cx + shW * 0.9, chestY + 1, armR0 + 1.8, armR0 + 1, PLATE);
    } else shadeEll(p, cx + leanX, chestY + 1.5, armR0 + 1.6, armR0 + 1, PLATE);
  }
  // --- Ближняя нога.
  for (const [x0, y0, x1, y1, far] of legs) {
    if (far) continue;
    joint(p, x0, y0, x1, y1 - 1, legLen, legR0, legR1, skin, side ? 1 : 0, 0);
    shadeEll(p, x1 + (side ? 1 : 0), y1 - 0.5, legR1 + 0.9, 1.3, skin);
    if (lk.armor) limb(p, x0, y0 + legLen * 0.35, (x0 + x1) / 2, (y0 + y1) / 2, legR0 + 0.3, legR1 + 0.3, PLATE);
  }
  // --- Руки.
  let hand: [number, number] = [cx, chestY];
  if (side) hand = arm(cx + leanX + 1, chestY + 1, g.armL, [0.1 + swingA, 0.95], -1, false) as [number, number];
  else {
    arm(cx - shW * 0.95, chestY + 1.5, g.armR, [-0.14 - swingA * 0.3, 0.95], 1, false);
    hand = arm(cx + shW * 0.95, chestY + 1.5, g.armL, [0.14 + swingA * 0.3, 0.95], -1, false) as [number, number];
  }
  // --- Шея и голова.
  limb(p, cx + leanX * 0.8, chestY + 1, headCx, headCy + headRy * 0.6, headRx * 0.55, headRx * 0.5, skin);
  const jawK = side ? 1.05 : 1;
  shadeEll(p, headCx, headCy, headRx, headRy, skin);
  // Челюсть — шире и ниже: ухмылка на пол-лица.
  shadeEll(p, headCx + (side ? 1 : 0), headCy + headRy * 0.35, headRx * 0.95 * jawK, headRy * 0.72, skin, -0.05);
  let eye: [number, number] | null = null;
  if (g.view === 'front') {
    eye = faceFront(p, headCx, headCy, headRx, headRy, lk, g.roar);
    hairOn(p, headCx, headCy, headRx, headRy, lk, 'front', seed);
    // Затылок за головой — ореол у шеи, когда герой за спиной.
    if (g.back) {
      p.set(Math.round(headCx - headRx - 1), Math.round(headCy + headRy * 0.6), alpha(NAPE_GLOW, 0.8));
      p.set(Math.round(headCx + headRx + 1), Math.round(headCy + headRy * 0.6), alpha(NAPE_GLOW, 0.8));
      p.set(Math.round(headCx - headRx), Math.round(headCy + headRy * 0.9), NAPE_GLOW);
      p.set(Math.round(headCx + headRx), Math.round(headCy + headRy * 0.9), NAPE_GLOW);
    }
  } else if (g.view === 'back') {
    // Затылок: без лица — волосы на всю голову (у лысых — складка кожи).
    if (lk.hair && lk.hairStyle !== 'bald') {
      shadeEll(p, headCx, headCy - 0.3, headRx + 0.5, headRy * 0.95, lk.hair);
      for (let x = Math.round(headCx - headRx); x <= Math.round(headCx + headRx); x++)
        if (hash(x, seed, 5) > 0.45)
          p.set(x, Math.round(headCy + headRy * 0.72), tone(lk.hair, 0.3));
    } else {
      stroke(p, headCx - headRx * 0.5, headCy + headRy * 0.35, headCx + headRx * 0.5, headCy + headRy * 0.35, tone(skin, 0.05));
    }
    hairOn(p, headCx, headCy, headRx, headRy, lk, 'back', seed);
    // Уши по бокам.
    p.set(Math.round(headCx - headRx), Math.round(headCy), tone(skin, 0.3));
    p.set(Math.round(headCx + headRx), Math.round(headCy), tone(skin, 0.1));
    nape(p, Math.round(headCx), Math.round(neckY + 0.5), g.back, g.cut, H > 60 ? 1.6 : 1);
  } else {
    // Профиль: глаз, нос, ухмылка до уха.
    const fx = headCx + headRx * 0.5;
    const ey = Math.round(headCy - headRy * 0.15);
    p.set(Math.round(fx), ey, hx('#2a1410'));
    p.set(Math.round(fx), ey, lk.eyes === 'calm' ? hx('#6ab8d8') : hx('#fff6d0'));
    eye = [Math.round(fx), ey];
    p.set(Math.round(headCx + headRx + 0.5), Math.round(headCy + 0.5), tone(skin, 0.6));
    const my = Math.round(headCy + headRy * 0.5);
    if (g.roar) p.ell(headCx + headRx * 0.6, my, headRx * 0.45, headRy * 0.3, MOUTH);
    else
      for (let x = Math.round(headCx - headRx * 0.2); x <= Math.round(headCx + headRx + 0.5); x++) {
        p.set(x, my - (x > headCx + headRx * 0.5 ? 0 : 1), MOUTH);
        if (x % 2 === 0) p.set(x, my - (x > headCx + headRx * 0.5 ? 0 : 1) - 1, TEETH);
      }
    p.set(Math.round(headCx - headRx * 0.35), Math.round(headCy), tone(skin, 0.15));
    hairOn(p, headCx, headCy, headRx, headRy, lk, 'side', seed);
    nape(p, Math.round(headCx - headRx * 0.8), Math.round(neckY + 0.5), g.back, g.cut, H > 60 ? 1.6 : 1);
  }
  if (lk.armor && g.view !== 'back') {
    // Шлем-лоб из кости.
    shadeEll(p, headCx + (side ? 0.5 : 0), headCy - headRy * 0.45, headRx + 0.4, headRy * 0.55, PLATE);
    if (g.view === 'front') {
      p.set(Math.round(headCx - headRx * 0.42), Math.round(headCy - headRy * 0.15), hx('#ffb060'));
      p.set(Math.round(headCx + headRx * 0.42), Math.round(headCy - headRy * 0.15), hx('#ffb060'));
    }
  }
  if (g.rock) {
    // Глыба над головой.
    const rx = hand[0];
    const ry = Math.min(hand[1], headCy - headRy - 2);
    shadeEll(p, rx - 1, ry - 3, 5, 4, tn('#1e1a18', '#3e3834', '#66605a', '#8e877e'));
    p.set(Math.round(rx - 2), Math.round(ry - 4), hx('#a8a096'));
  }
  if (g.shell > 0) crystalShell(p, g.shell, seed);
  deco?.(p, { cx, ay, hipY, chestY, neckY, headCx, headCy, headRx, headRy, shW, hipW, side });
  p.outline(INK);
  return { p, ax: Math.round(cx), ay, eye };
}

/** Пластина лат: светлая кость с тёмными швами. */
function polyPlate(p: Px, cx: number, cy: number, rx: number, ry: number, side: boolean): void {
  shadeEll(p, cx, cy, rx, ry, PLATE, 0.05);
  const seam = hx('#4a4238');
  for (let x = Math.round(cx - rx + 1); x <= Math.round(cx + rx - 1); x++) p.set(x, Math.round(cy + ry * 0.2), seam);
  if (!side) for (let y = Math.round(cy - ry + 1); y <= Math.round(cy + ry - 1); y++) p.set(Math.round(cx), y, seam);
}

/** Кристальная скорлупа поверх фигуры: голубые грани. */
function crystalShell(p: Px, k: number, seed: number): void {
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      const i = (y * p.w + x) * 4;
      if (!p.data[i + 3]) continue;
      const f = Math.floor((x + y * 0.5 + seed) / 3) % 3;
      const c = f === 0 ? CRYST[3] : f === 1 ? CRYST[2] : CRYST[1];
      p.set(x, y, alpha(c, 0.35 + 0.5 * k));
    }
}

// ---- Виды исполинов -----------------------------------------------------------

const LOOKS: Record<string, GiantLook> = {
  f13_walker: {
    H: 40,
    skin: SKIN,
    hair: HAIR_BROWN,
    hairStyle: 'wild',
    bulk: 1.22,
    belly: 1.1,
    arms: 1,
    legs: 0.95,
    head: 0.25,
    grin: 1.05,
    eyes: 'blank',
  },
  f13_climber: {
    H: 34,
    skin: SKIN_PALE,
    hair: null,
    hairStyle: 'bald',
    bulk: 0.85,
    belly: 0.1,
    arms: 1.25,
    legs: 0.95,
    head: 0.22,
    grin: 1,
    eyes: 'wide',
  },
  f13_thrower: {
    H: 40,
    skin: SKIN_TAN,
    hair: HAIR_BLACK,
    hairStyle: 'long',
    bulk: 1.3,
    belly: 0.3,
    arms: 1.3,
    legs: 0.85,
    head: 0.19,
    grin: 0.9,
    eyes: 'blank',
    hunch: 3,
  },
  f13_armored: {
    H: 46,
    skin: SKIN_RED,
    hair: null,
    hairStyle: 'bald',
    bulk: 1.35,
    belly: 0.2,
    arms: 1,
    legs: 0.95,
    head: 0.18,
    grin: 0.8,
    eyes: 'blank',
    armor: true,
  },
  f13_abnormal: {
    H: 46,
    skin: SKIN_PALE,
    hair: HAIR_BLOND,
    hairStyle: 'short',
    bulk: 0.72,
    belly: 0,
    arms: 1.2,
    legs: 1.15,
    head: 0.17,
    grin: 1.25,
    eyes: 'crazy',
  },
  f13_crystal: {
    H: 42,
    skin: tn('#4a3a34', '#8c7466', '#c4a894', '#ecd6c2'),
    hair: HAIR_BLOND,
    hairStyle: 'bun',
    bulk: 0.8,
    belly: 0,
    arms: 1.05,
    legs: 1.08,
    head: 0.18,
    grin: 0.55,
    eyes: 'calm',
    crystal: true,
  },
};

/** Поза вида по режиму ИИ. */
function giantPose(kind: string, m: Mob, pose: MobPose): { g: GPose; key: string; lie: boolean; stars: boolean; hands?: boolean } {
  const view = viewOf(m.face);
  const back = (m.data.back ?? 0) > 0;
  const cut = (m.data.cut ?? 0) > 0.12;
  const g: GPose = { ...GP0, view, back, cut };
  const t = pose.t;
  let key = pose.mode;
  let lie = false;
  let st = false;
  const run = pose.anim === 'run';
  switch (pose.mode) {
    case 'swipe':
    case 'kick': {
      const k = Math.min(1, t / 0.8);
      if (k < 0.85) {
        g.armL = view === 'side' ? [-0.7, -0.5] : [0.9, -0.6];
        g.lean = -1;
        key = 'sw0';
      } else {
        g.armL = view === 'side' ? [0.95, 0.2] : [-0.6, 0.5];
        g.lean = 2;
        key = 'sw1';
      }
      if (pose.mode === 'kick') {
        g.knee = k > 0.7 ? 1 : 0.4;
        key = `kick${k > 0.7 ? 1 : 0}`;
      }
      break;
    }
    case 'stomp':
      g.knee = t < 0.6 ? 1 : 0;
      g.squat = t < 0.6 ? 0 : 2;
      g.armR = [-0.5, 0.6];
      g.armL = [0.5, 0.6];
      key = `st${t < 0.6 ? 0 : 1}`;
      break;
    case 'grab':
      g.armL = view === 'side' ? [0.95, 0.35] : [0.25, 1];
      g.armR = view === 'side' ? null : [-0.2, 0.9];
      g.lean = 3;
      g.squat = 2;
      key = 'grab';
      break;
    case 'spin':
      g.armL = view === 'side' ? [-0.9, 0.1] : [-0.95, 0.1];
      g.armR = [0.9, 0.1];
      g.lean = -2;
      key = `spin${t < 0.4 ? 0 : 1}`;
      break;
    case 'throw':
      g.armL = [0.1, -0.95];
      g.armR = [-0.1, -0.95];
      g.rock = true;
      g.lean = -1;
      key = 'thr';
      break;
    case 'aim':
      g.lean = 4;
      g.squat = 2;
      g.armL = [0.5, 0.7];
      key = 'aim';
      break;
    case 'charge':
      g.lean = 5;
      g.walk = true;
      g.step = Math.floor(t * 12) % 4;
      g.armL = [0.8, 0.4];
      key = `ch${g.step}`;
      break;
    case 'dizzy':
      st = true;
      g.squat = 3;
      g.armL = [0.4, 0.9];
      g.armR = [-0.4, 0.9];
      key = 'dz';
      break;
    case 'down':
      lie = true;
      key = 'down';
      break;
    case 'getup':
      g.squat = 5;
      g.lean = 3;
      g.armL = [0.4, 1];
      g.armR = [-0.4, 1];
      key = 'gu';
      break;
    case 'leapAim':
      g.squat = 4;
      g.armL = [-0.6, 0.6];
      g.armR = [0.6, 0.6];
      key = 'la';
      break;
    case 'air':
      g.knee = 0.7;
      g.armL = [0.8, -0.6];
      g.armR = [-0.8, -0.6];
      key = `air${Math.min(3, Math.floor(t / 0.15))}`;
      break;
    case 'twitch':
      g.armL = [0.9, -0.2 + ((Math.floor(t * 9) % 2) * 0.3)];
      g.lean = -2;
      g.roar = true;
      key = `tw${Math.floor(t * 9) % 2}`;
      break;
    case 'harden':
      g.shell = Math.min(1, t / 0.6);
      g.armL = [0.2, -0.3];
      g.armR = [-0.2, -0.3];
      key = `hd${Math.floor(g.shell * 3)}`;
      break;
    case 'shatter':
      g.shell = 1;
      g.armL = [0.9, -0.4];
      g.armR = [-0.9, -0.4];
      key = 'sh';
      break;
    case 'bare':
      g.roar = true;
      st = Math.floor(t * 6) % 2 === 0;
      g.squat = 1;
      key = `br${st ? 1 : 0}`;
      break;
    case 'climb':
      key = 'climb';
      return { g, key, lie: false, stars: false, hands: true };
    case 'recover':
      g.lean = 1;
      key = 'rec';
      break;
    case 'march':
    case 'stalk':
    case 'wander':
    case 'home':
    default:
      if (run || Math.hypot(m.vx, m.vy) > 0.3) {
        g.walk = true;
        g.step = Math.floor(pose.frame / 2) % 4;
        key = `w${g.step}`;
      } else {
        g.step = 0;
        key = `i${Math.floor(pose.frame / 3) % 2}`;
        g.squat = key === 'i1' ? 1 : 0;
      }
  }
  return { g, key: `${view}|${key}`, lie, stars: st };
}

/** Лежащий исполин (пушка его свалила): затылок наверху, светится. */
function drawLying(lk: GiantLook, seed: number, cut: boolean): Built {
  const H = lk.H;
  const W = Math.round(H * 1.3);
  const p = new Px(W, Math.round(H * 0.5) + 6);
  const ay = p.h - 2;
  const cx = W / 2;
  const skin = lk.skin;
  // Ноги влево, голова вправо; лежит ничком — спина к нам.
  limb(p, cx - H * 0.05, ay - 4, cx - H * 0.5, ay - 3, H * 0.06, H * 0.045, skin);
  limb(p, cx - H * 0.05, ay - 2, cx - H * 0.48, ay - 1, H * 0.06, H * 0.045, skin, -0.1);
  shadeEll(p, cx + H * 0.08, ay - 4.5, H * 0.2, H * 0.1, skin);
  limb(p, cx + H * 0.1, ay - 7, cx + H * 0.36, ay - 9, H * 0.04, H * 0.035, skin);
  limb(p, cx + H * 0.14, ay - 1.5, cx + H * 0.42, ay - 1, H * 0.04, H * 0.035, skin, -0.1);
  shadeEll(p, cx + H * 0.34, ay - 5, H * 0.1, H * 0.09, skin);
  hairOn(p, cx + H * 0.37, ay - 5.5, H * 0.09, H * 0.085, lk, 'back', seed);
  nape(p, Math.round(cx + H * 0.26), Math.round(ay - 6), true, cut);
  stars(p, cx + H * 0.34, ay - H * 0.2, 4, seed % 4);
  p.outline(INK);
  return { p, ax: Math.round(cx), ay, eye: null };
}

/** Стенолаз висит на зубцах: над камнем голова и пальцы. */
function drawHands(lk: GiantLook, f: number): Built {
  const H = lk.H;
  const W = Math.round(H * 0.8);
  const p = new Px(W, 22);
  const ay = 20;
  const cx = W / 2;
  const skin = lk.skin;
  const sy = f % 2;
  // Пальцы вцепились в кромку: две кисти.
  for (const s of [-1, 1]) {
    const hx0 = cx + s * W * 0.28;
    shadeEll(p, hx0, ay - 3 + (s > 0 ? sy : 0), 3, 2, skin);
    for (let i = -1; i <= 1; i++) p.set(Math.round(hx0 + i * 1.3), ay - 1 + (s > 0 ? sy : 0), tone(skin, 0.2));
  }
  // Макушка и глаза над кромкой.
  shadeEll(p, cx, ay - 4 - sy, 4.5, 4, skin);
  p.set(Math.round(cx - 2), ay - 5 - sy, hx('#fff6d0'));
  p.set(Math.round(cx + 2), ay - 5 - sy, hx('#fff6d0'));
  p.outline(INK);
  return { p, ax: Math.round(cx), ay, eye: [Math.round(cx - 2), ay - 5 - sy] };
}

function giantPainter(kind: string) {
  const lk = LOOKS[kind];
  return (m: Mob, pose: MobPose): MobFrame | null => {
    const seed = m.id % 5;
    const dk = deathK(pose);
    if (pose.mode === 'dying') {
      const view = viewOf(m.face);
      return frameOf(`${kind}|die|${view}|${dk}`, pose, () => {
        const b = drawGiant(lk, { ...GP0, view, squat: dk * 2, lean: dk }, seed);
        return { ...b, p: evaporate(b.p, dk, seed) };
      });
    }
    const gp = giantPose(kind, m, pose);
    if (gp.hands) return frameOf(`${kind}|hands|${pose.frame % 2}`, pose, () => drawHands(lk, pose.frame));
    if (gp.lie) {
      const cut = gp.g.cut;
      return frameOf(`${kind}|lie|${+cut}|${Math.floor(pose.t * 5) % 4}`, pose, () => drawLying(lk, Math.floor(pose.t * 5) % 4, cut));
    }
    const key = `${kind}|${gp.key}|${+gp.g.back}|${+gp.g.cut}|${+gp.stars}|${seed}`;
    const fr = frameOf(key, pose, () => {
      const b = drawGiant(lk, gp.g, seed);
      if (gp.stars) stars(b.p, b.ax, 3, 5, Math.floor(pose.t * 8) % 4);
      return b;
    });
    return fr;
  };
}

for (const k of Object.keys(LOOKS)) registerMobPainter(k, giantPainter(k));

// Аномальный в прыжке — выше земли: кадр сдвинут вверх.
const abnormalBase = giantPainter('f13_abnormal');
registerMobPainter('f13_abnormal', (m, pose) => {
  const fr = abnormalBase(m, pose);
  if (!fr || pose.mode !== 'air') return fr;
  const z = Math.round((m.data.z ?? 0) * 14);
  return { ...fr, ay: fr.ay + z };
});

// ---------------------------------------------------------------------------
// Ухмылка: мелкий исполин — голова в треть роста, пузо, ухмылка до ушей.
// ---------------------------------------------------------------------------

const GRIN_LOOKS: GiantLook[] = [
  { H: 22, skin: SKIN, hair: HAIR_BROWN, hairStyle: 'short', bulk: 1.15, belly: 1.6, arms: 1.05, legs: 0.8, head: 0.36, grin: 1.1, eyes: 'wide' },
  { H: 21, skin: SKIN_PALE, hair: null, hairStyle: 'bald', bulk: 1.2, belly: 1.8, arms: 1, legs: 0.78, head: 0.38, grin: 1.15, eyes: 'blank' },
  { H: 23, skin: SKIN_TAN, hair: HAIR_BLACK, hairStyle: 'wild', bulk: 1.05, belly: 1.2, arms: 1.15, legs: 0.85, head: 0.34, grin: 1.05, eyes: 'crazy' },
];

registerMobPainter('f13_grin', (m, pose) => {
  const v = m.id % GRIN_LOOKS.length;
  const lk = GRIN_LOOKS[v];
  const dk = deathK(pose);
  const view = viewOf(m.face);
  if (pose.mode === 'dying')
    return frameOf(`grin|${v}|die|${view}|${dk}`, pose, () => {
      const b = drawGiant(lk, { ...GP0, view, squat: dk }, v);
      return { ...b, p: evaporate(b.p, dk, v) };
    });
  const back = (m.data.cut ?? 0) > 0;
  const g: GPose = { ...GP0, view, cut: back };
  let key = 'i';
  if (pose.mode === 'windup') {
    // Тянется руками и разевает рот.
    g.armL = view === 'side' ? [0.9, -0.1] : [0.5, -0.2];
    g.armR = view === 'side' ? null : [-0.5, -0.2];
    g.roar = true;
    g.lean = 1;
    key = 'wu';
  } else if (pose.mode === 'recover' && pose.t < 0.2) {
    g.lean = 3;
    g.squat = 1;
    g.armL = view === 'side' ? [0.95, 0.3] : [0.3, 0.8];
    key = 'bt';
  } else if (pose.anim === 'hurt' || pose.mode === 'stun') {
    g.squat = 1;
    g.roar = true;
    key = 'hu';
  } else if (pose.anim === 'run') {
    g.walk = true;
    g.step = pose.frame % 4;
    key = `w${g.step}`;
  } else if (pose.mode === 'sleep') {
    g.squat = 3;
    key = 'sl';
  } else key = `i${Math.floor(pose.frame / 3) % 2}`;
  return frameOf(`grin|${v}|${view}|${key}|${+back}`, pose, () => drawGiant(lk, g, v));
});

// ---------------------------------------------------------------------------
// Колосс: исполин без кожи — красное мясо, светлые жилы, рёбра, зубы без
// губ, пар из плеч. Тает по фазам: в «Паре» окутан белым, в «Испарении»
// худеет и светится изнутри, как угли.
// ---------------------------------------------------------------------------

const COL_LOOK: GiantLook = {
  H: 76,
  skin: MUSCLE,
  hair: null,
  hairStyle: 'bald',
  bulk: 1.35,
  belly: 0.15,
  arms: 1.12,
  legs: 0.92,
  head: 0.19,
  grin: 1.02,
  eyes: 'blank',
};
const COL_THIN: GiantLook = { ...COL_LOOK, bulk: 1.05, arms: 1.05, skin: tn('#2a0806', '#6a1612', '#a8321e', '#f07a3a') };

/** Жилы, рёбра, череп и пар поверх мяса. */
function colDeco(phase: number, view: View, f: number, back: boolean, cut: boolean, cloaked: boolean) {
  return (p: Px, g: Geo) => {
    const sinew = alpha(SINEW, 0.55);
    // Жилы вдоль мышц: светлые штрихи сверху вниз.
    for (let y = Math.round(g.chestY + 2); y < g.ay - 2; y++)
      for (let x = 0; x < p.w; x++) {
        const i = (y * p.w + x) * 4;
        if (!p.data[i + 3] || p.data[i] < 100) continue;
        if ((x * 3 + Math.floor(y / 3)) % 7 === 0) p.set(x, y, sinew);
      }
    // Рёбра — белые дуги на груди (анфас) или спине.
    if (!g.side) {
      const bone = view === 'back' ? tone(BONE, 0.3) : tone(BONE, 0.6);
      for (let r = 0; r < 4; r++) {
        const y = g.chestY + 4 + r * 3;
        const w = g.shW * (0.72 - r * 0.07);
        for (let x = Math.round(g.cx - w); x <= Math.round(g.cx + w); x++) {
          if (Math.abs(x - g.cx) < 1.2) continue;
          const k = (x - g.cx) / w;
          p.set(x, Math.round(y + k * k * 2), bone);
        }
      }
    } else {
      for (let r = 0; r < 4; r++) stroke(p, g.cx - 3, g.chestY + 4 + r * 3, g.cx + 4, g.chestY + 5 + r * 3, tone(BONE, 0.5));
    }
    // Череп: скулы и зубы без губ — два ряда.
    if (view === 'front') {
      const my = g.headCy + g.headRy * 0.46;
      for (let x = Math.round(g.headCx - g.headRx * 0.95); x <= Math.round(g.headCx + g.headRx * 0.95); x++) {
        p.set(x, Math.round(my - 1), x % 2 ? TEETH : mixc(TEETH, BONE[1], 0.4));
        p.set(x, Math.round(my + 1), x % 2 ? mixc(TEETH, BONE[1], 0.4) : TEETH);
        p.set(x, Math.round(my), MOUTH);
      }
      p.set(Math.round(g.headCx - g.headRx * 0.8), Math.round(g.headCy + 1), tone(BONE, 0.7));
      p.set(Math.round(g.headCx + g.headRx * 0.8), Math.round(g.headCy + 1), tone(BONE, 0.7));
    }
    // Испарение: угли в прожилках.
    if (phase >= 3)
      for (let y = 0; y < p.h; y++)
        for (let x = 0; x < p.w; x++) {
          const i = (y * p.w + x) * 4;
          if (!p.data[i + 3]) continue;
          if (hash(x, y, 71) < 0.05) p.set(x, y, hash(x, y, f) < 0.5 ? hx('#ffb040') : hx('#ff6a20'));
        }
    // Пар из плеч и головы: клубы по кадру.
    const n = cloaked ? 7 : phase >= 3 ? 5 : 3;
    for (let i = 0; i < n; i++) {
      const s = i % 2 ? 1 : -1;
      const x = g.cx + s * g.shW * (0.5 + hash(i, f) * 0.6);
      const y = g.chestY - 2 - hash(f, i, 3) * 10 - ((f + i) % 4) * 2;
      cloud(p, x, y, 3 + hash(i, f, 5) * 3, alpha(STEAM, cloaked ? 0.9 : 0.7), i * 13 + f, 1);
    }
    // Плащ пара: затылок закрыт белым.
    if (cloaked && view !== 'front') {
      const nx = g.side ? g.headCx - g.headRx * 0.8 : g.headCx;
      cloud(p, nx, g.neckY, 6, alpha(STEAM, 0.95), f + 40, 1);
    } else if (view !== 'front') {
      nape(p, Math.round(g.side ? g.headCx - g.headRx * 0.8 : g.headCx), Math.round(g.neckY + 0.5), back, cut, 1.8);
    }
    if (view === 'front' && back) {
      // Затылок за головой светится — видно и спереди, что ты за спиной.
      for (const s of [-1, 1])
        for (let k = 0; k < 3; k++)
          p.set(Math.round(g.headCx + s * (g.headRx + 1 + k * 0.5)), Math.round(g.headCy + g.headRy * 0.7 + k), alpha(NAPE_GLOW, 0.9 - k * 0.2));
    }
  };
}

function colPose(m: Mob, pose: MobPose): { g: GPose; key: string } {
  const view = viewOf(m.face);
  const back = (m.data.back ?? 0) > 0 || pose.mode === 'kneel';
  const cut = (m.data.cut ?? 0) > 0.12;
  const g: GPose = { ...GP0, view, back, cut };
  const t = pose.t;
  let key = pose.mode;
  switch (pose.mode) {
    case 'swipe': {
      const k = t / COL.swipe.warn;
      g.armL = k < 0.8 ? (view === 'side' ? [-0.8, -0.5] : [0.95, -0.55]) : view === 'side' ? [0.95, 0.25] : [-0.7, 0.45];
      g.lean = k < 0.8 ? -2 : 4;
      key = `sw${k < 0.8 ? 0 : 1}`;
      break;
    }
    case 'stomp':
    case 'quake': {
      const w = pose.mode === 'quake' ? COL.quake.warn : COL.stomp.warn;
      const up = t < w - 0.1;
      g.knee = up ? 1 : 0;
      g.squat = up ? 0 : 4;
      g.armL = pose.mode === 'quake' && up ? [0.5, -0.9] : [0.55, 0.55];
      g.armR = pose.mode === 'quake' && up ? [-0.5, -0.9] : [-0.55, 0.55];
      g.roar = pose.mode === 'quake';
      key = `${pose.mode}${up ? 0 : 1}`;
      break;
    }
    case 'back':
      g.armL = view === 'side' ? [-0.95, 0] : [-0.95, 0.15];
      g.armR = [0.95, 0.1];
      g.lean = -3;
      key = `bk${t < COL.back.warn ? 0 : 1}`;
      break;
    case 'vent':
      g.armL = [0.95, -0.2];
      g.armR = [-0.95, -0.2];
      g.roar = true;
      key = 'vent';
      break;
    case 'throw':
      g.armL = [-0.2, -0.95];
      g.rock = true;
      g.lean = -2;
      key = 'thr';
      break;
    case 'rings':
      g.armL = [0.9, 0.3];
      g.armR = [-0.9, 0.3];
      g.roar = true;
      key = 'rings';
      break;
    case 'roar':
    case 'rise':
      g.roar = true;
      g.armL = [0.7, 0.2];
      g.armR = [-0.7, 0.2];
      g.lean = -1;
      key = 'roar';
      break;
    case 'kneel':
      g.squat = 16;
      g.lean = 5;
      g.armL = [0.5, 0.9];
      g.armR = [-0.5, 0.9];
      key = 'kneel';
      break;
    case 'recover':
      g.lean = 2;
      key = 'rec';
      break;
    default:
      if (pose.anim === 'run' || Math.hypot(m.vx, m.vy) > 0.25) {
        g.walk = true;
        g.step = Math.floor(pose.frame / 3) % 4;
        key = `w${g.step}`;
      } else key = `i${Math.floor(pose.frame / 4) % 2}`;
  }
  return { g, key: `${view}|${key}` };
}

registerMobPainter('f13boss', (m, pose) => {
  const phase = m.data.phase ?? 0;
  const cloaked = phase === 1 && !((m.data.bareT ?? 0) > 0);
  const lk = phase >= 3 ? COL_THIN : COL_LOOK;
  const f = Math.floor(pose.frame / 2) % 4;
  const dk = deathK(pose);
  if (pose.mode === 'dying') {
    const view = viewOf(m.face);
    return frameOf(`col|die|${view}|${dk}`, pose, () => {
      const b = drawGiant(lk, { ...GP0, view, squat: dk * 5, roar: true }, 3, colDeco(3, view, dk, false, false, false));
      return { ...b, p: evaporate(b.p, dk, 3) };
    });
  }
  const { g, key } = colPose(m, pose);
  const k = `col|${key}|${phase >= 3 ? 3 : 0}|${+cloaked}|${+g.back}|${+g.cut}|${f}`;
  const fr = frameOf(k, pose, () => {
    const b = drawGiant(lk, g, 3, colDeco(phase, g.view, f, g.back, g.cut, cloaked));
    if (pose.mode === 'kneel') stars(b.p, b.ax, 24, 8, f);
    return b;
  });
  // Встаёт из пара: сперва видно только верх.
  if (pose.mode === 'rise') {
    const k2 = Math.min(1, pose.t / COL.rise);
    return { ...fr, ay: fr.ay - Math.round((1 - k2) * 24) };
  }
  return fr;
});

// ---------------------------------------------------------------------------
// Ползун: на четвереньках, голова у самой земли, длинные руки вместо
// передних лап. Затылок — на загривке, его видно сверху со спины.
// ---------------------------------------------------------------------------

const CRAWL_SKIN = tn('#3e2a22', '#7a5644', '#b08a6a', '#d8b490');

function drawCrawler(view: View, step: number, mode: string, back: boolean, cut: boolean, t: number): Built {
  const W = 40;
  const p = new Px(W, 30);
  const ay = 27;
  const cx = W / 2;
  const S = CRAWL_SKIN;
  const dark: Tones = [S[0], S[0], S[1], S[2]];
  const ph = (step / 4) * TAU;
  const lunge = mode === 'lunge';
  const aim = mode === 'lungeAim';
  const low = aim ? 2 : 0;
  if (view === 'side') {
    // Тело вдоль, голова вправо.
    const sw = Math.sin(ph) * 3;
    // Дальние конечности.
    limb(p, cx - 7, ay - 9 + low, cx - 9 - sw, ay - 1, 2, 1.5, dark);
    limb(p, cx + 6, ay - 10 + low, cx + 10 + sw + (lunge ? 5 : 0), ay - 1, 1.8, 1.3, dark);
    shadeEll(p, cx - 2, ay - 10 + low, 11, 5, S);
    shadeEll(p, cx - 9, ay - 9 + low, 5, 4.5, S, -0.05);
    // Хребет.
    for (let x = Math.round(cx - 10); x < Math.round(cx + 6); x += 2) p.set(x, Math.round(ay - 14 + low), tone(S, 0.1));
    // Ближние.
    limb(p, cx - 7, ay - 8 + low, cx - 5 + sw, ay - 1, 2.2, 1.6, S);
    limb(p, cx + 6, ay - 9 + low, cx + 8 - sw + (lunge ? 6 : 0), ay - 1, 2, 1.4, S);
    // Голова низко впереди — огромная.
    const hx0 = cx + 12 + (lunge ? 3 : 0);
    const hy0 = ay - 7 + low;
    shadeEll(p, hx0, hy0, 5.5, 5, S);
    for (let x = Math.round(hx0 - 2); x <= Math.round(hx0 + 5); x++) {
      p.set(x, Math.round(hy0 + 2), MOUTH);
      if (x % 2 === 0) p.set(x, Math.round(hy0 + 1), TEETH);
    }
    if (aim || lunge) p.ell(hx0 + 3, hy0 + 2.5, 2, 1.5, MOUTH);
    p.set(Math.round(hx0 + 2), Math.round(hy0 - 2), hx('#fff6d0'));
    nape(p, Math.round(cx + 6), Math.round(ay - 13 + low), back, cut);
    p.outline(INK);
    return { p, ax: Math.round(cx), ay, eye: [Math.round(hx0 + 2), Math.round(hy0 - 2)] };
  }
  if (view === 'front') {
    const sw = Math.sin(ph) * 1.5;
    shadeEll(p, cx, ay - 10 + low, 9, 6, S);
    limb(p, cx - 7, ay - 11 + low, cx - 12 - sw, ay - 1, 2.2, 1.6, S);
    limb(p, cx + 7, ay - 11 + low, cx + 12 + sw, ay - 1, 2.2, 1.6, S);
    const hy0 = ay - 6 + low + (lunge ? 2 : 0);
    shadeEll(p, cx, hy0, 6.5, 5.5, S);
    for (let x = Math.round(cx - 5); x <= Math.round(cx + 5); x++) {
      const k = (x - cx) / 5;
      const y = Math.round(hy0 + 2 - k * k * 2);
      p.set(x, y, MOUTH);
      if (Math.abs(k) < 0.9) p.set(x, y - 1, x % 2 ? TEETH : mixc(TEETH, hx('#b8a888'), 0.4));
    }
    p.set(Math.round(cx - 2.5), Math.round(hy0 - 2.5), hx('#fff6d0'));
    p.set(Math.round(cx + 2.5), Math.round(hy0 - 2.5), hx('#fff6d0'));
    p.outline(INK);
    return { p, ax: Math.round(cx), ay, eye: [Math.round(cx - 2.5), Math.round(hy0 - 2.5)] };
  }
  // Сзади: зад, ноги, загривок с затылком.
  const sw = Math.sin(ph) * 1.5;
  limb(p, cx - 6, ay - 12, cx - 11 + sw, ay - 1, 2.2, 1.6, S);
  limb(p, cx + 6, ay - 12, cx + 11 - sw, ay - 1, 2.2, 1.6, S);
  shadeEll(p, cx, ay - 12 + low, 9, 6.5, S);
  shadeEll(p, cx, ay - 17 + low, 6, 3.5, S, 0.1);
  for (let y = Math.round(ay - 18); y < ay - 7; y += 2) p.set(Math.round(cx), y, tone(S, 0.1));
  nape(p, Math.round(cx), Math.round(ay - 19 + low), back, cut);
  void t;
  p.outline(INK);
  return { p, ax: Math.round(cx), ay, eye: null };
}

registerMobPainter('f13_crawler', (m, pose) => {
  const view = viewOf(m.face);
  const back = (m.data.back ?? 0) > 0;
  const cut = (m.data.cut ?? 0) > 0.12;
  const dk = deathK(pose);
  if (pose.mode === 'dying')
    return frameOf(`crawl|die|${view}|${dk}`, pose, () => {
      const b = drawCrawler(view, 0, 'x', false, false, 0);
      return { ...b, p: evaporate(b.p, dk, 2) };
    });
  const moving = pose.anim === 'run' || Math.hypot(m.vx, m.vy) > 0.4;
  const step = moving || pose.mode === 'lunge' ? pose.frame % 4 : 0;
  const md = pose.mode === 'lunge' || pose.mode === 'lungeAim' ? pose.mode : 'x';
  const down = pose.mode === 'down' || pose.mode === 'recover';
  return frameOf(`crawl|${view}|${step}|${md}|${+back}|${+cut}|${+down}`, pose, () => {
    const b = drawCrawler(view, step, md, back || down, cut, pose.t);
    if (down) stars(b.p, b.ax, 6, 5, pose.frame % 4);
    return b;
  });
});

// ---------------------------------------------------------------------------
// Ворона: чёрная, с серым клювом; машет крыльями, пикирует сложив их.
// ---------------------------------------------------------------------------

const CROW_T = tn('#08070a', '#1a171e', '#2e2a34', '#4a4452');

function drawCrow(wing: number, mode: string): Built {
  const p = new Px(20, 16);
  const ay = 14;
  const cx = 10;
  const B = CROW_T;
  const sleep = mode === 'sleep';
  const swoop = mode === 'swoop';
  const by = sleep ? ay - 3 : ay - 7;
  // Хвост клином.
  poly(p, [
    [cx - 3, by],
    [cx - 8, by - 1 + (sleep ? 2 : 0)],
    [cx - 8, by + 2],
  ], B[1]);
  shadeEll(p, cx, by, swoop ? 4.5 : 3.8, 2.6, B);
  shadeEll(p, cx + 3.6, by - 1.6, 2.1, 1.9, B, 0.05);
  // Клюв.
  p.set(cx + 6, by - 1, hx('#6a6470'));
  p.set(cx + 7, by - 1, hx('#8a8490'));
  p.set(cx + 6, by, hx('#4a4450'));
  p.set(cx + 4, by - 2, hx('#ffcc40'));
  if (!sleep && !swoop) {
    // Крыло: вверх / в стороны / вниз.
    const wy = [-6, -2, 2, -2][wing % 4];
    poly(p, [
      [cx - 2, by - 1],
      [cx + 2, by - 1],
      [cx - 1 + (wy < 0 ? 1 : 0), by + wy],
      [cx - 6, by + wy + (wy < 0 ? 2 : -1)],
    ], B[2]);
    for (let i = 0; i < 3; i++) p.set(cx - 5 + i * 2, by + wy + (wy < 0 ? 1 : -1), B[3]);
  } else if (swoop) {
    poly(p, [
      [cx - 3, by - 1],
      [cx + 2, by - 1],
      [cx - 5, by + 1],
    ], B[2]);
  } else {
    // Спит на насесте: лапки.
    p.set(cx - 1, ay - 1, hx('#3a3440'));
    p.set(cx + 1, ay - 1, hx('#3a3440'));
  }
  p.outline(INK);
  return { p, ax: cx, ay, eye: [cx + 4, by - 2] };
}

registerMobPainter('f13_crow', (m, pose) => {
  const dk = deathK(pose);
  if (pose.mode === 'dying')
    return frameOf(`crow|die|${dk}`, pose, () => {
      const b = drawCrow(1, 'sleep');
      return { ...b, p: evaporate(b.p, dk, 1) };
    });
  const mode = pose.mode === 'sleep' ? 'sleep' : pose.mode === 'swoop' ? 'swoop' : 'fly';
  const wing = mode === 'fly' ? Math.floor(pose.frame * 1.5) % 4 : 0;
  return frameOf(`crow|${mode}|${wing}`, pose, () => drawCrow(wing, mode));
});

// ---------------------------------------------------------------------------
// Контрабандист: плащ с капюшоном, мешок за спиной, крюкомёт на поясе.
// ---------------------------------------------------------------------------

const CLOAK = tn('#1a1612', '#3a3024', '#5e4c36', '#86704e');
const SACK = tn('#4a3418', '#7a5a2a', '#a8823e', '#d4ae62');

function drawSmuggler(step: number, mode: string): Built {
  const p = new Px(20, 22);
  const ay = 20;
  const cx = 9;
  const run = mode === 'run';
  const ph = (step / 4) * TAU;
  const sw = run ? Math.sin(ph) * 2.5 : 0;
  // Ноги.
  limb(p, cx - 1, ay - 6, cx - 1 - sw, ay - 0.5, 1.2, 1, tn('#141014', '#2a2228', '#3e343a', '#56484e'));
  limb(p, cx + 1, ay - 6, cx + 1 + sw, ay - 0.5, 1.2, 1, tn('#141014', '#2a2228', '#3e343a', '#56484e'));
  // Мешок за спиной.
  shadeEll(p, cx - 3.5, ay - 10, 3.6, 3.8, SACK);
  p.set(cx - 4, ay - 13, hx('#ffd040'));
  p.set(cx - 2, ay - 12, hx('#ffe890'));
  // Плащ.
  poly(p, [
    [cx - 2.5, ay - 13],
    [cx + 3, ay - 13],
    [cx + 3.5, ay - 5],
    [cx - 3, ay - 5],
  ], (x, y) => tone(CLOAK, 0.6 - (x - cx) * 0.08 - (y - (ay - 13)) * 0.03));
  // Капюшон, под ним — глаза.
  shadeEll(p, cx + 0.5, ay - 15, 3.2, 3, CLOAK);
  p.set(cx + 2, ay - 15, hx('#ffd040'));
  p.set(cx + 1, ay - 14, hx('#2a1c10'));
  // Крюкомёт: в руке трос, если летит.
  if (mode === 'zip') {
    stroke(p, cx + 3, ay - 12, cx + 7, ay - 20, hx('#8a8490'));
    p.set(cx + 7, ay - 21, hx('#c4c8cc'));
  } else {
    p.set(cx + 3, ay - 8, hx('#8a8f94'));
    p.set(cx + 4, ay - 8, hx('#c4c8cc'));
  }
  p.outline(INK);
  return { p, ax: cx, ay, eye: [cx + 2, ay - 15] };
}

registerMobPainter('f13_smuggler', (m, pose) => {
  const dk = deathK(pose);
  if (pose.mode === 'dying')
    return frameOf(`smug|die|${dk}`, pose, () => {
      const b = drawSmuggler(0, 'idle');
      return { ...b, p: evaporate(b.p, dk, 4) };
    });
  const mode = pose.mode === 'zip' ? 'zip' : pose.anim === 'run' ? 'run' : 'idle';
  const step = mode === 'run' ? pose.frame % 4 : 0;
  return frameOf(`smug|${mode}|${step}`, pose, () => drawSmuggler(step, mode));
});

// @@ART3@@
