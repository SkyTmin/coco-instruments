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
import { F13_BELL, F13_MARK, F13_OUTER, F13_WALL } from './f13';
import { BELL, CANNON, COL, f13State } from './f13-brains';

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
const WHITE = hx('#ffffff');
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
  if (hash(f, seed, 3) > 0.4)
    p.set(Math.round(cx + (hash(f, seed) - 0.5) * w), by - h - 1, FIRE[2]);
}

/** Клуб дыма/пара: мягкие круги, `k` — плотность. */
function cloud(p: Px, cx: number, cy: number, r: number, c: RGBA, seed: number, k = 1): void {
  for (let i = 0; i < 5; i++) {
    const a = hash(i, seed) * TAU;
    const d = r * 0.5 * hash(seed, i, 7);
    const rr = r * (0.45 + 0.3 * hash(i, seed, 3));
    p.ell(
      cx + Math.cos(a) * d,
      cy + Math.sin(a) * d * 0.7,
      rr,
      rr * 0.85,
      alpha(c, (c[3] / 255) * k),
    );
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

function frameOf(key: string, pose: MobPose, build: () => Built, ghost = false): MobFrame {
  const k = `${key}|${pose.left ? 1 : 0}|${pose.flash ? 1 : 0}|${pose.look}|${+ghost}`;
  const hit = frames.get(k);
  if (hit) return hit;
  const b = build();
  if (ghost) b.p = seeThrough(b.p);
  return finish(k, b, pose.look, pose.flash, pose.left);
}

/**
 * Герой за спиной исполина — исполин просвечивает: иначе высокая фигура
 * закрывает героя целиком ровно тогда, когда он делает то, чего просит этаж
 * (бьёт в затылок). Светящийся затылок остаётся ярким.
 */
function seeThrough(p: Px): Px {
  const o = new Px(p.w, p.h);
  for (let i = 0; i < p.data.length; i += 4) {
    const a = p.data[i + 3];
    if (!a) continue;
    const hot =
      p.data[i] > 230 && p.data[i + 1] > 120 && p.data[i + 1] < 215 && p.data[i + 2] < 130;
    o.data[i] = p.data[i];
    o.data[i + 1] = p.data[i + 1];
    o.data[i + 2] = p.data[i + 2];
    o.data[i + 3] = hot ? a : Math.round(a * 0.5);
  }
  return o;
}

/** Герой стоит в тени высокой фигуры (севернее, в её силуэте). */
function heroHidden(m: Mob, tall: number): boolean {
  const h = paintSim()?.hero;
  if (!h) return false;
  const dy = m.y - h.y;
  return dy > 0.25 && dy < tall && Math.abs(h.x - m.x) < m.r + 0.7;
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
      // Кость проступает рёбрами: светлые дуги через грудь, хребет посередине.
      const rel = (y - top) / hgt;
      const dx = Math.abs(x - p.w / 2);
      if (k >= 2 && rel > 0.3 && rel < 0.55 && dx < p.w * 0.2 && dx > 0.6 && (y - top) % 3 === 0)
        c = tone(BONE, 0.75 - dx / p.w);
      else if (k >= 2 && rel > 0.3 && rel < 0.62 && dx < 0.6) c = tone(BONE, 0.55);
      o.set(x, ty, c);
    }
  // Клубы пара над тающим — мягкие, без контура.
  const cx = p.w / 2;
  for (let i = 0; i < 3 + k; i++) {
    const x = cx + (hash(i, seed, k) - 0.5) * p.w * 0.6;
    const y = melt + (hash(seed, i, 9) - 0.6) * hgt * 0.35;
    const sc = Math.min(1, hgt / 60);
    puff(o, x, y, (2.5 + k + hash(i, k) * 2) * (0.45 + sc * 0.55), 0.65, seed + i * 7 + k);
  }
  return o;
}

const deathK = (pose: MobPose) =>
  pose.mode === 'dying' ? Math.min(3, Math.floor(pose.t / 0.17)) : 0;

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
function faceFront(
  p: Px,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  lk: GiantLook,
  roar: boolean,
): [number, number] {
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
function hairOn(
  p: Px,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  lk: GiantLook,
  view: View,
  seed: number,
): void {
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
    if (view !== 'front')
      limb(p, cx, cy, cx + (view === 'side' ? -rx : 0), cy + ry * 2.2, rx * 0.9, rx * 0.6, t);
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

function drawGiant(
  lk: GiantLook,
  g: GPose,
  seed: number,
  deco?: (p: Px, geo: Geo) => void,
  post?: (p: Px, geo: Geo) => void,
): Built {
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
    legs.push([
      cx + 1 + leanX * 0.3,
      hipY,
      cx + 1 + sw + g.knee * H * 0.1,
      ay - liftA - g.knee * H * 0.2,
      false,
    ]);
  } else {
    const liftA = g.walk ? Math.max(0, Math.sin(ph)) * 2.2 : 0;
    const liftB = g.walk ? Math.max(0, -Math.sin(ph)) * 2.2 : 0;
    legs.push([cx - hipW, hipY, cx - hipW * 1.25, ay - liftA, false]);
    legs.push([
      cx + hipW,
      hipY,
      cx + hipW * 1.25 + g.knee * 2,
      ay - liftB - g.knee * H * 0.22,
      false,
    ]);
  }
  // Дальняя нога в профиль — темнее, раньше.
  for (const [x0, y0, x1, y1, far] of legs) {
    if (!far) continue;
    joint(p, x0, y0, x1, y1 - 1, legLen, legR0, legR1, dark, 1, -0.1);
    shadeEll(p, x1 + 1, y1 - 0.5, legR1 + 0.8, 1.2, dark);
  }
  // Дальняя рука в профиль.
  const arm = (
    sx: number,
    sy: number,
    tgt: [number, number] | null,
    dflt: [number, number],
    bend: number,
    far: boolean,
  ) => {
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
    shadeEll(
      p,
      cx + leanX * 0.3 + lk.belly,
      hipY - torso * 0.22,
      shW * 0.5 + lk.belly,
      bellyR,
      skin,
      -0.05,
    );
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
    for (let y = Math.round(chestY + 2); y < Math.round(hipY - 2); y++)
      p.set(Math.round(cx), y, lineC);
    stroke(p, cx - shW * 0.6, chestY + torso * 0.42, cx - 1, chestY + torso * 0.48, lineC);
    stroke(p, cx + 1, chestY + torso * 0.48, cx + shW * 0.6, chestY + torso * 0.42, lineC);
    p.set(Math.round(cx), Math.round(hipY - torso * 0.2), tone(skin, 0));
  }
  if (g.view === 'back') {
    for (let y = Math.round(chestY + 1); y < Math.round(hipY - 1); y++)
      p.set(Math.round(cx), y, lineC);
    stroke(p, cx - shW * 0.55, chestY + 3, cx - 2, chestY + torso * 0.4, lineC);
    stroke(p, cx + 2, chestY + torso * 0.4, cx + shW * 0.55, chestY + 3, lineC);
  }
  if (lk.armor) {
    // Латы: грудные пластины, наплечники; со спины — щель по хребту.
    if (g.view !== 'back') {
      polyPlate(
        p,
        cx + leanX * 0.5,
        chestY + torso * 0.3,
        shW * (side ? 0.6 : 0.9),
        torso * 0.36,
        side,
      );
    } else {
      polyPlate(p, cx - shW * 0.45, chestY + torso * 0.3, shW * 0.4, torso * 0.36, true);
      polyPlate(p, cx + shW * 0.45, chestY + torso * 0.3, shW * 0.4, torso * 0.36, true);
      for (let y = Math.round(chestY); y < Math.round(hipY - 2); y++)
        p.set(Math.round(cx), y, hx('#6a2a22'));
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
    if (lk.armor)
      limb(
        p,
        x0,
        y0 + legLen * 0.35,
        (x0 + x1) / 2,
        (y0 + y1) / 2,
        legR0 + 0.3,
        legR1 + 0.3,
        PLATE,
      );
  }
  // --- Руки.
  let hand: [number, number] = [cx, chestY];
  if (side)
    hand = arm(cx + leanX + 1, chestY + 1, g.armL, [0.1 + swingA, 0.95], -1, false) as [
      number,
      number,
    ];
  else {
    arm(cx - shW * 0.95, chestY + 1.5, g.armR, [-0.14 - swingA * 0.3, 0.95], 1, false);
    hand = arm(cx + shW * 0.95, chestY + 1.5, g.armL, [0.14 + swingA * 0.3, 0.95], -1, false) as [
      number,
      number,
    ];
  }
  // --- Шея и голова.
  limb(
    p,
    cx + leanX * 0.8,
    chestY + 1,
    headCx,
    headCy + headRy * 0.6,
    headRx * 0.55,
    headRx * 0.5,
    skin,
  );
  const jawK = side ? 1.05 : 1;
  shadeEll(p, headCx, headCy, headRx, headRy, skin);
  // Челюсть — шире и ниже: ухмылка на пол-лица.
  shadeEll(
    p,
    headCx + (side ? 1 : 0),
    headCy + headRy * 0.35,
    headRx * 0.95 * jawK,
    headRy * 0.72,
    skin,
    -0.05,
  );
  let eye: [number, number] | null = null;
  if (g.view === 'front') {
    eye = faceFront(p, headCx, headCy, headRx, headRy, lk, g.roar);
    hairOn(p, headCx, headCy, headRx, headRy, lk, 'front', seed);
    // Затылок за головой — ореол у шеи, когда герой за спиной.
    if (g.back) {
      p.set(
        Math.round(headCx - headRx - 1),
        Math.round(headCy + headRy * 0.6),
        alpha(NAPE_GLOW, 0.8),
      );
      p.set(
        Math.round(headCx + headRx + 1),
        Math.round(headCy + headRy * 0.6),
        alpha(NAPE_GLOW, 0.8),
      );
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
      stroke(
        p,
        headCx - headRx * 0.5,
        headCy + headRy * 0.35,
        headCx + headRx * 0.5,
        headCy + headRy * 0.35,
        tone(skin, 0.05),
      );
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
    nape(
      p,
      Math.round(headCx - headRx * 0.8),
      Math.round(neckY + 0.5),
      g.back,
      g.cut,
      H > 60 ? 1.6 : 1,
    );
  }
  if (lk.armor && g.view !== 'back') {
    // Шлем-лоб из кости.
    shadeEll(
      p,
      headCx + (side ? 0.5 : 0),
      headCy - headRy * 0.45,
      headRx + 0.4,
      headRy * 0.55,
      PLATE,
    );
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
  const geo: Geo = { cx, ay, hipY, chestY, neckY, headCx, headCy, headRx, headRy, shW, hipW, side };
  deco?.(p, geo);
  p.outline(INK);
  // Поверх контура: пар и свечение не обводятся (обведённый пар — вата).
  post?.(p, geo);
  return { p, ax: Math.round(cx), ay, eye };
}

/** Пластина лат: светлая кость с тёмными швами. */
function polyPlate(p: Px, cx: number, cy: number, rx: number, ry: number, side: boolean): void {
  shadeEll(p, cx, cy, rx, ry, PLATE, 0.05);
  const seam = hx('#4a4238');
  for (let x = Math.round(cx - rx + 1); x <= Math.round(cx + rx - 1); x++)
    p.set(x, Math.round(cy + ry * 0.2), seam);
  if (!side)
    for (let y = Math.round(cy - ry + 1); y <= Math.round(cy + ry - 1); y++)
      p.set(Math.round(cx), y, seam);
}

/** Кристальная скорлупа поверх фигуры: голубые грани. */
function crystalShell(p: Px, k: number, seed: number): void {
  // Грани: ближайшая из редких точек-центров даёт плоскость со своим тоном,
  // по краю грани — светлое ребро. Полосами (как было) читалось леденцом.
  const pts: [number, number, number][] = [];
  for (let i = 0; i < 26; i++)
    pts.push([hash(i, seed, 1) * p.w, hash(seed, i, 2) * p.h, hash(i, seed, 3)]);
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      const i = (y * p.w + x) * 4;
      if (!p.data[i + 3]) continue;
      let d1 = 1e9;
      let d2 = 1e9;
      let tone0 = 0;
      for (const [px, py, t] of pts) {
        const d = (px - x) ** 2 + (py - y) ** 2 * 0.6;
        if (d < d1) {
          d2 = d1;
          d1 = d;
          tone0 = t;
        } else if (d < d2) d2 = d;
      }
      const edge = Math.sqrt(d2) - Math.sqrt(d1) < 0.9;
      const c = edge ? CRYST[3] : tone(CRYST, 0.25 + tone0 * 0.55 - y * 0.004);
      p.set(x, y, alpha(c, 0.4 + 0.5 * k));
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
function giantPose(
  kind: string,
  m: Mob,
  pose: MobPose,
): { g: GPose; key: string; lie: boolean; stars: boolean; hands?: boolean } {
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
      g.armL = [0.9, -0.2 + (Math.floor(t * 9) % 2) * 0.3];
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
    for (let i = -1; i <= 1; i++)
      p.set(Math.round(hx0 + i * 1.3), ay - 1 + (s > 0 ? sy : 0), tone(skin, 0.2));
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
    if (gp.hands)
      return frameOf(`${kind}|hands|${pose.frame % 2}`, pose, () => drawHands(lk, pose.frame));
    if (gp.lie) {
      const cut = gp.g.cut;
      return frameOf(`${kind}|lie|${+cut}|${Math.floor(pose.t * 5) % 4}`, pose, () =>
        drawLying(lk, Math.floor(pose.t * 5) % 4, cut),
      );
    }
    const key = `${kind}|${gp.key}|${+gp.g.back}|${+gp.g.cut}|${+gp.stars}|${seed}`;
    const fr = frameOf(
      key,
      pose,
      () => {
        const b = drawGiant(lk, gp.g, seed);
        if (gp.stars) stars(b.p, b.ax, 3, 5, Math.floor(pose.t * 8) % 4);
        return b;
      },
      heroHidden(m, (lk.H + 8) / 16),
    );
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
  {
    H: 22,
    skin: SKIN,
    hair: HAIR_BROWN,
    hairStyle: 'short',
    bulk: 1.15,
    belly: 1.6,
    arms: 1.05,
    legs: 0.8,
    head: 0.36,
    grin: 1.1,
    eyes: 'wide',
  },
  {
    H: 21,
    skin: SKIN_PALE,
    hair: null,
    hairStyle: 'bald',
    bulk: 1.2,
    belly: 1.8,
    arms: 1,
    legs: 0.78,
    head: 0.38,
    grin: 1.15,
    eyes: 'blank',
  },
  {
    H: 23,
    skin: SKIN_TAN,
    hair: HAIR_BLACK,
    hairStyle: 'wild',
    bulk: 1.05,
    belly: 1.2,
    arms: 1.15,
    legs: 0.85,
    head: 0.34,
    grin: 1.05,
    eyes: 'crazy',
  },
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
// Колосс (v2.87): исполин без кожи — красное мясо, светлые жилы, рёбра, зубы
// без губ, пар из суставов. Облик прежний, движение — новое.
//
// Мини-3D риг: суставы считаются в осях тела (x — вперёд, y — влево, z —
// вверх), части — капсулы и шары в z-буфере, свет сверху-слева по нормали,
// как у прежней фигуры; жилы, рёбра, лицо и затылок — наклейки на
// поверхность. Тело поворачивается непрерывно (румбы по 22,5°, влево —
// зеркалом), голова ведёт взгляд за героем, части опаздывают за корпусом.
// Каждая техника — дорожка ключевых поз на 24 к/с от `pose.t`; кадр
// контакта — ровно в миг урона мозга (первый кадр `recover` после удара).
// Кадры — в `frameLRU`, техники первой фазы греются заранее.
// ---------------------------------------------------------------------------

const EMBER = [hx('#ff5a18'), hx('#ffa030'), hx('#ffe07a')];

/** Пар без контура: три пояса прозрачности — ядро, тело, край. */
function puff(p: Px, cx: number, cy: number, r: number, a: number, seed: number): void {
  const core = hx('#fbf8f4');
  const edge = hx('#c4c8d2');
  for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++)
    for (let x = Math.floor(cx - r * 1.2 - 1); x <= Math.ceil(cx + r * 1.2 + 1); x++) {
      const wob = 0.82 + 0.3 * hash(Math.floor(x / 2), Math.floor(y / 2), seed);
      const d = Math.hypot((x - cx) / 1.2, y - cy) / (r * wob);
      if (d > 1) continue;
      const band = d < 0.45 ? 1 : d < 0.75 ? 0.62 : 0.3;
      p.set(x, y, alpha(mixc(edge, core, 1 - d), a * band));
    }
}

/** Тона тающего Колосса (фаза «Испарение»): мясо темнее, свет — угли. */
const COL_SKIN3 = tn('#240605', '#5e130f', '#9a2c1a', '#e06a30');
const COL_ROCK = tn('#241c18', '#4a3e36', '#766858', '#a8987e');
const COL_DIRT = [hx('#2a1e14'), hx('#4a3826'), hx('#6e5638')];
const COL_SOCKET = hx('#1a0405');
const COL_PUPIL = hx('#fff2c0');
const COL_GUM = tone(MUSCLE, 0.95);
const COL_TOOTH2 = mixc(TEETH, BONE[1], 0.45);
const COL_HALO = hx('#ffb070');

// ---- Векторы и повороты -------------------------------------------------------

type V3 = [number, number, number];
/** Матрица 3×3 по строкам. */
type M3 = number[];

const cClamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const vAdd = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const vSub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vMul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const vDot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vLen = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const vNorm = (a: V3): V3 => vMul(a, 1 / (vLen(a) || 1));
const vLerp = (a: V3, b: V3, k: number): V3 => [
  a[0] + (b[0] - a[0]) * k,
  a[1] + (b[1] - a[1]) * k,
  a[2] + (b[2] - a[2]) * k,
];
const mApp = (m: M3, v: V3): V3 => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];
function mMul(a: M3, b: M3): M3 {
  const o = new Array<number>(9);
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return o;
}
/** Поворот вокруг вертикали: «вперёд» уходит «влево». */
function yawM(a: number): M3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}
/** Наклон: «верх» уходит «вперёд». */
function pitchM(a: number): M3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
}
/** Крен: «верх» уходит «влево». */
function rollM(a: number): M3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [1, 0, 0, 0, c, s, 0, -s, c];
}

/** Две кости: плечо и предплечье (бедро и голень), сгиб — в сторону `pole`. */
function ik2(s: V3, target: V3, l1: number, l2: number, pole: V3): [V3, V3] {
  let d = vSub(target, s);
  let len = vLen(d);
  const max = l1 + l2 - 0.15;
  if (len > max) {
    d = vMul(d, max / len);
    len = max;
  }
  const end = vAdd(s, d);
  const dir = vMul(d, 1 / (len || 1));
  const a = (l1 * l1 - l2 * l2 + len * len) / (2 * (len || 1));
  const hgt = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const perp = vNorm(vSub(pole, vMul(dir, vDot(pole, dir))));
  return [vAdd(vAdd(s, vMul(dir, a)), vMul(perp, hgt)), end];
}

// ---- Поза: каналы рига ----------------------------------------------------------

/**
 * Поза Колосса. Руки: A — правая (ближняя в профиль), B — левая; кисть
 * задаётся от плеча (длина, азимут наружу, возвышение) в осях груди без
 * наклона — опущенная рука висит вниз, как ни гнись, — или прямо точкой на
 * земле (`aw` — доля: ладони в землю). Стопы — в осях корня, `nb`/`fb` —
 * наружу.
 */
interface CRig {
  /** Таз: вперёд, влево, высота над землёй. */
  pa: number;
  pb: number;
  ph: number;
  /** Корпус: наклон вперёд, крен влево, разворот груди влево. */
  lean: number;
  roll: number;
  twist: number;
  /** Вдох, грудь раскрыта (выброс пара), плечи вверх (px). */
  breath: number;
  open: number;
  shr: number;
  /** Голова: вынос вперёд (px), кивок вниз, поворот влево, наклон, пасть. */
  nk: number;
  hp: number;
  hy: number;
  hr: number;
  jaw: number;
  /** Правая кисть: длина, азимут наружу, возвышение, ладонь раскрыта, на земле (доля, точка). */
  ar: number;
  aaz: number;
  ael: number;
  ah: number;
  aw: number;
  agx: number;
  agy: number;
  agz: number;
  /** Левая кисть. */
  br: number;
  baz: number;
  bel: number;
  bh: number;
  bw: number;
  bgx: number;
  bgy: number;
  bgz: number;
  /** Стопы: вперёд, наружу, подъём. */
  na: number;
  nb: number;
  nh: number;
  fa: number;
  fb: number;
  fh: number;
  /** Ход кадра целиком: вперёд, вверх (px), сжатие, наклон. */
  tdx: number;
  tdy: number;
  tsx: number;
  tsy: number;
  trot: number;
  /** Пар из суставов, жар в жилах, свет в груди, вспышка глаз, звёзды. */
  steam: number;
  heat: number;
  glow: number;
  eyes: number;
  stars: number;
  /** Под землёй (px), испарение 0…1, глыба в руках, худоба (фаза 3), кайма, прозрачность. */
  sink: number;
  melt: number;
  rock: number;
  thin: number;
  rim: number;
  alpha: number;
}
type CKey = keyof CRig;

const CREADY: CRig = {
  pa: 0.5,
  pb: 0,
  ph: 29.4,
  lean: 0.1,
  roll: 0,
  twist: 0,
  breath: 0,
  open: 0,
  shr: 0,
  nk: 1.4,
  hp: 0.06,
  hy: 0,
  hr: 0,
  jaw: 0.1,
  ar: 26.5,
  aaz: 0.32,
  ael: -1.3,
  ah: 0.15,
  aw: 0,
  agx: 10,
  agy: 12,
  agz: 0,
  br: 26.5,
  baz: 0.32,
  bel: -1.3,
  bh: 0.15,
  bw: 0,
  bgx: 10,
  bgy: 12,
  bgz: 0,
  na: 1.8,
  nb: 8.6,
  nh: 0,
  fa: -1.8,
  fb: 8.6,
  fh: 0,
  tdx: 0,
  tdy: 0,
  tsx: 1,
  tsy: 1,
  trot: 0,
  steam: 0.35,
  heat: 0,
  glow: 0,
  eyes: 0,
  stars: 0,
  sink: 0,
  melt: 0,
  rock: 0,
  thin: 0,
  rim: 0,
  alpha: 1,
};
const CKEYS = Object.keys(CREADY) as CKey[];

/** Зеркало позы: левое ↔ правое (вторая нога топота, разворот влево). */
function cMirror(r: CRig): CRig {
  return {
    ...r,
    pb: -r.pb,
    roll: -r.roll,
    twist: -r.twist,
    hy: -r.hy,
    hr: -r.hr,
    ar: r.br,
    aaz: r.baz,
    ael: r.bel,
    ah: r.bh,
    aw: r.bw,
    agx: r.bgx,
    agy: r.bgy,
    agz: r.bgz,
    br: r.ar,
    baz: r.aaz,
    bel: r.ael,
    bh: r.ah,
    bw: r.aw,
    bgx: r.agx,
    bgy: r.agy,
    bgz: r.agz,
    na: r.fa,
    nb: r.fb,
    nh: r.fh,
    fa: r.na,
    fb: r.nb,
    fh: r.nh,
  };
}

function cLerp(a: CRig, b: CRig, k: number): CRig {
  const o = { ...a };
  for (const ch of CKEYS) o[ch] = a[ch] + (b[ch] - a[ch]) * k;
  return o;
}

type Ease = (x: number) => number;
const eLin: Ease = (x) => x;
const eIn: Ease = (x) => x * x;
const eIn3: Ease = (x) => x * x * x;
const eOut: Ease = (x) => 1 - (1 - x) * (1 - x);
const eOut3: Ease = (x) => 1 - (1 - x) * (1 - x) * (1 - x);
const eIO: Ease = (x) => (x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) * (1 - x));
const eStep: Ease = (x) => (x < 1 ? 0 : 1);

/** Ключ: время (с), каналы, кривая подхода к ключу (по умолчанию — плавно). */
type CKf = [number, Partial<CRig>, Ease?];

/**
 * Дорожка ключей: каждый канал идёт между ключами, где он задан, по кривой
 * подхода. `lag` — опоздание части (с): голова, вторая рука, пасть.
 */
function cTrack(keys: CKf[], t: number, base: CRig, lag?: Partial<Record<CKey, number>>): CRig {
  const out = { ...base };
  for (const ch of CKEYS) {
    const tt = lag?.[ch] ? Math.max(0, t - lag[ch]!) : t;
    let t0 = 0;
    let v0 = base[ch];
    let t1 = -1;
    let v1 = 0;
    let e: Ease = eIO;
    for (const [kt, kv, ke] of keys) {
      const v = kv[ch];
      if (v === undefined) continue;
      if (kt <= tt) {
        t0 = kt;
        v0 = v;
      } else {
        t1 = kt;
        v1 = v;
        e = ke ?? eIO;
        break;
      }
    }
    out[ch] = t1 < 0 ? v0 : v0 + (v1 - v0) * e(cClamp((tt - t0) / (t1 - t0 || 1), 0, 1));
  }
  return out;
}

/** Опоздания по умолчанию: голова, пасть, плечи и свободная левая рука. */
const CLAG: Partial<Record<CKey, number>> = {
  hp: 0.05,
  hy: 0.06,
  hr: 0.06,
  nk: 0.04,
  jaw: 0.03,
  shr: 0.04,
  baz: 0.05,
  bel: 0.05,
  br: 0.05,
};
/** Обе руки опаздывают (топот, рёв): корпус ведёт, руки догоняют. */
const CLAG2: Partial<Record<CKey, number>> = { ...CLAG, aaz: 0.05, ael: 0.05, ar: 0.05 };

// ---- Скелет ---------------------------------------------------------------------

interface CSk {
  pel: V3;
  waist: V3;
  chest: V3;
  Rp: M3;
  Rw: M3;
  Rc: M3;
  Rh: M3;
  Rj: M3;
  neck: V3;
  head: V3;
  shA: V3;
  shB: V3;
  elA: V3;
  elB: V3;
  wrA: V3;
  wrB: V3;
  hipA: V3;
  hipB: V3;
  knA: V3;
  knB: V3;
  anA: V3;
  anB: V3;
  rock: V3 | null;
}

/** Длины костей (px): бедро, голень, плечо, предплечье. */
const CD = { thigh: 13.4, shin: 12.8, up: 15.2, fore: 14.2 };

function cSkel(r: CRig): CSk {
  const pel: V3 = [r.pa, r.pb, r.ph - r.sink];
  const Rp = mMul(rollM(r.roll * 0.3), yawM(r.twist * 0.12));
  const Rw = mMul(rollM(r.roll * 0.7), mMul(pitchM(r.lean * 0.55), yawM(r.twist * 0.45)));
  const Rc = mMul(rollM(r.roll), mMul(pitchM(r.lean), yawM(r.twist)));
  const waist = vAdd(pel, mApp(Rw, [0, 0, 7.4]));
  const chest = vAdd(waist, mApp(Rc, [0, 0, 8.4]));
  const up = 5.2 + r.shr + r.breath * 0.7;
  const shw = 14.2 - r.thin * 1.6;
  const shA = vAdd(chest, mApp(Rc, [-0.6, -shw, up]));
  const shB = vAdd(chest, mApp(Rc, [-0.6, shw, up]));
  const neck = vAdd(chest, mApp(Rc, [0.4, 0, 9.4 + r.shr * 0.35]));
  // Голова держится ровнее корпуса: морда смотрит вперёд, как ни гнись.
  const Rn = mMul(rollM(r.roll * 0.5), mMul(pitchM(r.lean * 0.5), yawM(r.twist)));
  const Rh = mMul(
    rollM(r.roll * 0.4 + r.hr),
    mMul(pitchM(r.lean * 0.3 + r.hp), yawM(r.twist + r.hy)),
  );
  const head = vAdd(neck, mApp(Rn, [1.2 + r.nk, 0, 7.6]));
  const Rj = mMul(Rh, pitchM(r.jaw * 0.5));
  // Кисти — в осях груди без наклона: висящая рука висит вниз.
  const Ra = yawM(r.twist);
  const polar = (rr: number, az: number, el: number, side: number): V3 =>
    mApp(Ra, [
      rr * Math.cos(el) * Math.cos(az),
      side * rr * Math.cos(el) * Math.sin(az),
      rr * Math.sin(el),
    ]);
  let tA = vAdd(shA, polar(r.ar, r.aaz, r.ael, -1));
  if (r.aw > 0.001) tA = vLerp(tA, [r.agx, -r.agy, r.agz + 3.2], r.aw);
  let tB = vAdd(shB, polar(r.br, r.baz, r.bel, 1));
  if (r.bw > 0.001) tB = vLerp(tB, [r.bgx, r.bgy, r.bgz + 3.2], r.bw);
  const [elA, wrA] = ik2(shA, tA, CD.up, CD.fore, mApp(Rc, [-1, -0.75, -0.45]));
  const [elB, wrB] = ik2(shB, tB, CD.up, CD.fore, mApp(Rc, [-1, 0.75, -0.45]));
  const hipA = vAdd(pel, mApp(Rp, [0, -6.6, -1.5]));
  const hipB = vAdd(pel, mApp(Rp, [0, 6.6, -1.5]));
  const [knA, anA] = ik2(
    hipA,
    [r.na, -r.nb, r.nh + 3 - r.sink],
    CD.thigh,
    CD.shin,
    [1, -0.18, 0.12],
  );
  const [knB, anB] = ik2(hipB, [r.fa, r.fb, r.fh + 3 - r.sink], CD.thigh, CD.shin, [1, 0.18, 0.12]);
  let rock: V3 | null = null;
  if (r.rock > 0.5) rock = vAdd(vLerp(wrA, wrB, 0.5), [0, 0, 5.5]);
  return {
    pel,
    waist,
    chest,
    Rp,
    Rw,
    Rc,
    Rh,
    Rj,
    neck,
    head,
    shA,
    shB,
    elA,
    elB,
    wrA,
    wrB,
    hipA,
    hipB,
    knA,
    knB,
    anA,
    anB,
    rock,
  };
}

// ---- Растр: z-буфер, свет по нормали, наклейки ----------------------------------

/** Холст кадра (потом обрезается по рисунку) и точка ног в нём. */
const CW = 136;
const CH = 136;
const CAX = 68;
const CAY = 118;
/** Ракурс: на сколько пол уходит вниз на клетку «к нам». */
const KP = 0.42;
const KS = Math.sqrt(1 + KP * KP);

const RC = new Uint8ClampedArray(CW * CH * 4);
const RZ = new Float32Array(CW * CH);
const RID = new Uint8Array(CW * CH);
/** Слой поверх темноты: глаза, затылок, угли, свет в груди. */
const RL = new Uint8ClampedArray(CW * CH * 4);

/** Части — для тонкого внутреннего контура (ближняя поверх дальней). */
const CID = { body: 1, head: 2, armA: 3, armB: 4, legA: 5, legB: 6, rock: 7, bone: 8 };

/** Состояние растра на кадр: поворот, срез землёй, жар, испарение. */
const RX = {
  cs: 1,
  sn: 0,
  clip: false,
  heat: 0,
  t: 0,
  melt: -1,
  mz: 999,
  bodyD: 0,
  lit: false,
  /** Скорость волны жара: в петле — целое число волн на круг. */
  wave: 0.9,
};

/** Рамка нарисованного (чистим и обходим только её, а не весь холст). */
const DB = { x0: 0, y0: 0, x1: CW - 1, y1: CH - 1 };
function dbGrow(x0: number, y0: number, x1: number, y1: number): void {
  if (x0 < DB.x0) DB.x0 = Math.max(0, Math.floor(x0));
  if (y0 < DB.y0) DB.y0 = Math.max(0, Math.floor(y0));
  if (x1 > DB.x1) DB.x1 = Math.min(CW - 1, Math.ceil(x1));
  if (y1 > DB.y1) DB.y1 = Math.min(CH - 1, Math.ceil(y1));
}

function rClear(): void {
  if (DB.x1 >= DB.x0)
    for (let y = DB.y0; y <= DB.y1; y++) {
      const a = y * CW + DB.x0;
      const b = y * CW + DB.x1 + 1;
      RC.fill(0, a * 4, b * 4);
      RL.fill(0, a * 4, b * 4);
      RZ.fill(-1e9, a, b);
      RID.fill(0, a, b);
    }
  DB.x0 = CW;
  DB.y0 = CH;
  DB.x1 = -1;
  DB.y1 = -1;
  RX.lit = false;
}

/** Точка тела → экран кадра: x, y и глубина (больше — ближе к нам). */
function cProj(p: V3): [number, number, number] {
  const X = RX.cs * p[0] + RX.sn * p[1];
  const Y = RX.sn * p[0] - RX.cs * p[1];
  return [CAX + X, CAY - p[2] + KP * Y, Y + KP * p[2]];
}

/** Нормаль тела → нормаль экрана (вправо, вниз, к нам). */
function cNorm(n: V3): [number, number, number] {
  const X = RX.cs * n[0] + RX.sn * n[1];
  const Y = RX.sn * n[0] - RX.cs * n[1];
  return [X, (KP * Y - n[2]) / KS, (Y + KP * n[2]) / KS];
}
const cLit = (n: [number, number, number]) => n[0] * LX + n[1] * LY + n[2] * LZ;

/** Высота точки над землёй по пикселю и глубине. */
const cZOf = (y: number, d: number) => (KP * d - (y + 0.5 - CAY)) / (1 + KP * KP);

function rPut(i: number, c: RGBA, z: number, id: number): void {
  const j = i * 4;
  RC[j] = c[0];
  RC[j + 1] = c[1];
  RC[j + 2] = c[2];
  RC[j + 3] = 255;
  RZ[i] = z;
  RID[i] = id;
}

function rMix(i: number, c: RGBA, a: number): void {
  const j = i * 4;
  RC[j] += (c[0] - RC[j]) * a;
  RC[j + 1] += (c[1] - RC[j + 1]) * a;
  RC[j + 2] += (c[2] - RC[j + 2]) * a;
}

/** Свет поверх темноты: не ярче уже лежащего. */
function litPut(x: number, y: number, c: RGBA, a = 1): void {
  if (x < 0 || y < 0 || x >= CW || y >= CH) return;
  const j = (y * CW + x) * 4;
  const na = Math.round(a * 255);
  if (RL[j + 3] >= na) return;
  RL[j] = c[0];
  RL[j + 1] = c[1];
  RL[j + 2] = c[2];
  RL[j + 3] = na;
  RX.lit = true;
  if (x < DB.x0 || x > DB.x1 || y < DB.y0 || y > DB.y1) dbGrow(x, y, x, y);
}

interface CMat {
  t: Tones;
  id: number;
  /** Жилы: зерно полос (0 — без жил) и их наклон вдоль кости. */
  fib: number;
  fa: number;
  /** Плоский цвет (пасть). */
  flat?: RGBA;
  /** Кость: не тает, жил нет. */
  bone?: boolean;
  /** Конечность: в жару по ней вдоль тянется тлеющая жила. */
  vein?: boolean;
  bias: number;
}

/** Пиксель части: свет по нормали, жилы, испарение, срез землёй. */
function cShade(
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number,
  m: CMat,
  e: number,
  k: number,
): void {
  const i = y * CW + x;
  if (z <= RZ[i]) return;
  if (RX.clip && cZOf(y, z) < 0) return;
  if (x < DB.x0 || x > DB.x1 || y < DB.y0 || y > DB.y1) dbGrow(x, y, x, y);
  if (m.flat) {
    rPut(i, m.flat, z, m.id);
    return;
  }
  // Испарение: мясо сходит сверху вниз неровным краем, по кромке — угли.
  if (RX.melt >= 0 && !m.bone) {
    const nse = hash(m.id * 7 + Math.floor(k * 4), Math.floor((e + 1) * 2.5), 5) * 9;
    const over = cZOf(y, z) + nse - RX.mz;
    if (over > 0) return;
    if (over > -3.2) {
      const hot = over > -1.4;
      rPut(i, hot ? EMBER[1] : EMBER[0], z, m.id);
      litPut(x, y, hot ? EMBER[2] : EMBER[0], hot ? 0.85 : 0.5);
      return;
    }
  }
  const l = nx * LX + ny * LY + nz * LZ + m.bias;
  let c = tone(m.t, l);
  if (m.fib) {
    let lane = (e * 2.2 + k * m.fa + m.fib) % 1;
    if (lane < 0) lane += 1;
    if (RX.heat > 0.05) {
      // Жар: по конечности вдоль тянется тлеющая жила (в тени — на свету
      // угли не видны), по ней бежит волна огня: течёт, а не мерцает.
      if (m.vein && Math.abs(Math.abs(e) - 0.46) < 0.14 && l < 0.55) {
        let w = (k * 0.35 - RX.t * RX.wave + m.fib * 3) % 1;
        if (w < 0) w += 1;
        const hot = w < 0.22 ? 2 : w < 0.55 ? 1 : 0;
        const hk = Math.min(1, RX.heat);
        c = mixc(c, EMBER[hot], hk * (hot ? 0.9 : 0.55));
        litPut(x, y, EMBER[hot], (0.15 + 0.25 * hot) * hk);
      }
    } else if (lane < 0.19 && l > 0.3) c = mixc(c, SINEW, l > 0.6 ? 0.55 : 0.32);
  }
  rPut(i, c, z, m.id);
}

/** Шар (части тела, суставы, кулак). */
function rSph(c: V3, r: number, m: CMat): void {
  if (r <= 0.2) return;
  const [cu, cv, cd] = cProj(c);
  const x0 = Math.max(0, Math.floor(cu - r));
  const x1 = Math.min(CW - 1, Math.ceil(cu + r));
  const y0 = Math.max(0, Math.floor(cv - r));
  const y1 = Math.min(CH - 1, Math.ceil(cv + r));
  const bias = m.bias + cClamp((cd - RX.bodyD) / 14, -1, 1) * 0.2;
  const mm = bias === m.bias ? m : { ...m, bias };
  const ca = Math.cos(m.fa * 7);
  const sa = Math.sin(m.fa * 7);
  const r2 = r * r;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cu;
      const dy = y + 0.5 - cv;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const nz = Math.sqrt(1 - d2 / r2);
      const e = (dx * ca + dy * sa) / r;
      const k = (-dx * sa + dy * ca) / r;
      cShade(x, y, cd + nz * r, dx / r, dy / r, nz, mm, e, (k + 1) * 3);
    }
}

/** Конечность: сужающаяся капсула от a к b. */
function rCap(a: V3, b: V3, ra: number, rb: number, m: CMat): void {
  const [au, av, ad] = cProj(a);
  const [bu, bv, bd] = cProj(b);
  const dx = bu - au;
  const dy = bv - av;
  const L2 = dx * dx + dy * dy || 1e-6;
  const L = Math.sqrt(L2);
  const len3 = vLen(vSub(b, a));
  const rm = Math.max(ra, rb);
  const x0 = Math.max(0, Math.floor(Math.min(au, bu) - rm));
  const x1 = Math.min(CW - 1, Math.ceil(Math.max(au, bu) + rm));
  const y0 = Math.max(0, Math.floor(Math.min(av, bv) - rm));
  const y1 = Math.min(CH - 1, Math.ceil(Math.max(av, bv) + rm));
  const bias = m.bias + cClamp(((ad + bd) / 2 - RX.bodyD) / 14, -1, 1) * 0.2;
  const mm = bias === m.bias ? m : { ...m, bias };
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const k = cClamp(((px - au) * dx + (py - av) * dy) / L2, 0, 1);
      const r = ra + (rb - ra) * k;
      const ex = px - (au + dx * k);
      const ey = py - (av + dy * k);
      const d2 = ex * ex + ey * ey;
      if (d2 > r * r) continue;
      const nz = Math.sqrt(1 - d2 / (r * r));
      const e = (ex * -dy + ey * dx) / (L * r);
      cShade(x, y, ad + (bd - ad) * k + nz * r, ex / r, ey / r, nz, mm, e, k * len3 * 0.11);
    }
}

/**
 * Наклейка на поверхность: видна, если там есть тело и ничто не ближе её
 * больше чем на `tol` (ребро спереди не просвечивает со спины).
 */
function dPut(p: V3, c: RGBA, tol = 2.6, id = 0): [number, number] | null {
  const [u, v, d] = cProj(p);
  const x = Math.floor(u);
  const y = Math.floor(v);
  if (x < 0 || y < 0 || x >= CW || y >= CH) return null;
  const i = y * CW + x;
  if (RZ[i] < -1e8 || RZ[i] > d + tol) return null;
  if (id && RID[i] !== id) return null;
  if (RX.clip && cZOf(y, RZ[i]) < 0) return null;
  if (RX.melt >= 0 && RC[i * 4] > 230 && RC[i * 4 + 1] > 80) return null;
  if (c[3] < 255) rMix(i, c, c[3] / 255);
  else {
    RC[i * 4] = c[0];
    RC[i * 4 + 1] = c[1];
    RC[i * 4 + 2] = c[2];
  }
  return [x, y];
}

/** Тон кости по нормали в точке (наклейка «освещена» как поверхность). */
const boneLit = (n: V3, k = 0) => tone(BONE, 0.3 + cLit(cNorm(n)) * 0.75 + k);

/** Внутренний контур (ближняя часть поверх дальней) и наружный — по буферу. */
function rFinishCol(): Px {
  const p = new Px(CW, CH);
  p.data.set(RC);
  const d = p.data;
  const X0 = Math.max(1, DB.x0);
  const X1 = Math.min(CW - 2, DB.x1);
  const Y0 = Math.max(1, DB.y0);
  const Y1 = Math.min(CH - 2, DB.y1);
  for (let y = Y0; y <= Y1; y++)
    for (let x = X0; x <= X1; x++) {
      const i = y * CW + x;
      const id = RID[i];
      if (!id) continue;
      const z = RZ[i] + 3.2;
      const near = (j: number) => RID[j] !== 0 && RID[j] !== id && RZ[j] > z;
      if (!(near(i - 1) || near(i + 1) || near(i - CW) || near(i + CW))) continue;
      const j = i * 4;
      if (RX.heat > 0.3 && id !== CID.bone) {
        // Жар: шов между частями тела — трещина с углём.
        const c = (x + y) % 3 ? EMBER[0] : EMBER[1];
        d[j] = c[0];
        d[j + 1] = c[1];
        d[j + 2] = c[2];
        litPut(x, y, c, 0.45 * Math.min(1, RX.heat));
        continue;
      }
      d[j] = Math.round(d[j] * 0.42 + INK[0] * 0.58);
      d[j + 1] = Math.round(d[j + 1] * 0.42 + INK[1] * 0.58);
      d[j + 2] = Math.round(d[j + 2] * 0.42 + INK[2] * 0.58);
    }
  dbGrow(DB.x0 - 1, DB.y0 - 1, DB.x1 + 1, DB.y1 + 1);
  const edge: number[] = [];
  for (let y = DB.y0; y <= DB.y1; y++)
    for (let x = DB.x0; x <= DB.x1; x++) {
      const i = y * CW + x;
      if (d[i * 4 + 3]) continue;
      if (
        (x > 0 && d[i * 4 - 1]) ||
        (x < CW - 1 && d[i * 4 + 7]) ||
        (y > 0 && d[(i - CW) * 4 + 3]) ||
        (y < CH - 1 && d[(i + CW) * 4 + 3])
      )
        edge.push(i);
    }
  for (const i of edge) {
    d[i * 4] = INK[0];
    d[i * 4 + 1] = INK[1];
    d[i * 4 + 2] = INK[2];
    d[i * 4 + 3] = 255;
  }
  return p;
}

// ---- Тело ------------------------------------------------------------------------

/** Тона кожи по худобе (фаза 3 и рёв перехода в неё): мясо темнеет, свет — угли. */
function colTones(thin: number): Tones {
  if (thin <= 0.01) return MUSCLE;
  if (thin >= 0.99) return COL_SKIN3;
  return [0, 1, 2, 3].map((i) => mixc(MUSCLE[i], COL_SKIN3[i], thin)) as Tones;
}

const cMat = (t: Tones, id: number, fib: number, fa = 0.6, bias = 0): CMat => ({
  t,
  id,
  fib,
  fa,
  bias,
});

/** Ладонь раскрытая (удар, опора) или кулак. */
function cHand(el: V3, wr: V3, open: number, k: number, m: CMat, flat = 0): void {
  let dir = vNorm(vSub(wr, el));
  if (flat > 0.5 && open >= 0.5) {
    // Опора: ладонь легла на землю — пальцы вперёд по горизонтали.
    const hz: V3 = [dir[0], dir[1], 0];
    dir = vLen(hz) > 0.2 ? vNorm(hz) : [1, 0, 0];
    const base: V3 = [wr[0], wr[1], Math.max(1.6, wr[2] - 1.4)];
    rCap(base, vAdd(base, vMul(dir, 7.6)), 3.9 * k, 2.8 * k, m);
    rSph(base, 3.8 * k, m);
    return;
  }
  if (open < 0.5) {
    rSph(vAdd(wr, vMul(dir, 2.3)), 4.5 * k, m);
    return;
  }
  // Ладонь — широкая лопата пальцев, у запястья — бугор большого пальца.
  rCap(vAdd(wr, vMul(dir, 0.8)), vAdd(wr, vMul(dir, 7.4)), 4.2 * k, 2.9 * k, m);
  rSph(vAdd(wr, vMul(dir, 1.6)), 4.0 * k, m);
}

/**
 * Голова в своих осях: череп, верхняя челюсть, нижняя на шарнире (`HJ`),
 * тёмная пасть за зубами, скулы. Нижняя челюсть задана в закрытом виде и
 * поворачивается вокруг шарнира на `jaw`.
 */
const HJ: V3 = [-1.6, 0, -2.6];
const HSK: V3 = [-0.6, 0, 1.0];
const HR = 8.6;

/** Точка нижней челюсти (в осях головы, закрытая) → тело, с поворотом пасти. */
function jawPt(sk: CSk, p: V3): V3 {
  const hinge = vAdd(sk.head, mApp(sk.Rh, HJ));
  return vAdd(hinge, mApp(sk.Rj, vSub(p, HJ)));
}

/** Голова: череп, челюсти, пасть, скулы. */
function cHead(sk: CSk, T: Tones, kb: number): void {
  const H = sk.head;
  const hp = (x: number, y: number, z: number): V3 => vAdd(H, mApp(sk.Rh, [x, y, z]));
  const mh = cMat(T, CID.head, 0.9, 0.45);
  rSph(hp(HSK[0], HSK[1], HSK[2]), HR * kb, mh);
  rCap(hp(2.6, -3.6, -3.4), hp(2.6, 3.6, -3.4), 5.2 * kb, 5.2 * kb, mh);
  rCap(jawPt(sk, [2.2, -3.3, -7.0]), jawPt(sk, [2.2, 3.3, -7.0]), 4.4 * kb, 4.4 * kb, mh);
  // Пасть — тёмная глубина за зубами: видна, когда челюсть открыта.
  rSph(hp(3.0, 0, -5.8), 4.3 * kb, { ...mh, flat: MOUTH, fib: 0 });
  // Скулы — жгуты мышц от виска вниз, над зубами (в профиль зубы не прячут).
  const cheek = cMat(T, CID.head, 0.3, 0.2, 0.2);
  rCap(hp(4.8, -5.3, 0.6), hp(4.3, -5.9, -2.6), 1.5, 1.3, cheek);
  rCap(hp(4.8, 5.3, 0.6), hp(4.3, 5.9, -2.6), 1.5, 1.3, cheek);
}

/** Лицо наклейками: лобная кость, глазницы со зрачками, ноздри, зубы двумя рядами. */
function cFace(sk: CSk, r: CRig, phase: number): [number, number] | null {
  const H = sk.head;
  const hp = (x: number, y: number, z: number): V3 => vAdd(H, mApp(sk.Rh, [x, y, z]));
  const c0 = hp(HSK[0], HSK[1], HSK[2]);
  const onSkull = (dir: V3, rr = HR): V3 => vAdd(c0, mApp(sk.Rh, vMul(vNorm(dir), rr)));
  // Лоб — кость, чуть светлее мяса: дуга в два ряда над глазами.
  for (let y = -5.6; y <= 5.6; y += 0.4) {
    const k = y / 5.6;
    const z = 3.6 - k * k * 1.5;
    const n = mApp(sk.Rh, vNorm([7, y, z - 1]));
    dPut(onSkull([7, y, z]), boneLit(n, 0.05 - Math.abs(k) * 0.2), 2.4, CID.head);
    dPut(onSkull([7, y, z - 1.1]), boneLit(n, -0.22 - Math.abs(k) * 0.2), 2.4, CID.head);
  }
  let eye: [number, number] | null = null;
  let eyeD = -1e9;
  const hot = phase >= 3 || r.heat > 0.6;
  const pupil = hot ? EMBER[2] : COL_PUPIL;
  for (const s of [-1, 1]) {
    const dir: V3 = [7.1, s * 3.6, 0.6];
    const [u, v, d] = cProj(onSkull(dir));
    const x = Math.floor(u);
    const y = Math.floor(v);
    if (x < 2 || y < 2 || x >= CW - 2 || y >= CH - 2) continue;
    const i = y * CW + x;
    if (RZ[i] < -1e8 || RZ[i] > d + 2.2 || RID[i] !== CID.head) continue;
    // Глазница: тёмный овал; в профиль — уже (поверхность уходит вбок).
    const face = cNorm(mApp(sk.Rh, vNorm(dir)))[2];
    const w = 1.1 + 1.0 * Math.max(0, face);
    for (let yy = -1; yy <= 1; yy++)
      for (let xx = -2; xx <= 2; xx++) {
        if ((xx / w) ** 2 + (yy / 1.35) ** 2 > 1.05) continue;
        const j = (y + yy) * CW + x + xx;
        if (RID[j] === CID.head) RC.set(COL_SOCKET.slice(0, 3), j * 4);
      }
    if (r.melt > 0.5) continue;
    RC.set(pupil.slice(0, 3), i * 4);
    litPut(x, y, pupil, 0.95);
    if (r.eyes > 0.3) {
      // Глаза вспыхнули: крест света вокруг зрачка.
      for (const [ox, oy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ])
        litPut(x + ox, y + oy, hot ? EMBER[1] : hx('#ffd890'), 0.6 * Math.min(1, r.eyes));
    } else if (hot) litPut(x - s, y, EMBER[1], 0.7);
    if (d > eyeD) {
      eyeD = d;
      eye = [x, y];
    }
  }
  // Ноздри — две щели.
  dPut(onSkull([7.6, -0.8, -2.0]), COL_SOCKET, 2.2, CID.head);
  dPut(onSkull([7.6, 0.8, -2.0]), COL_SOCKET, 2.2, CID.head);
  // Зубы без губ: дуга вокруг морды до самых ушей. Верх — дёсны, два ряда,
  // тёмная щель; низ — два ряда и дёсны, на нижней челюсти (ходит с ней).
  const rows = (lower: boolean, zs: [number, RGBA | null][]) => {
    for (let i = 0; i <= 44; i++) {
      const a = -1.55 + (3.1 * i) / 44;
      const lx = 1.8 + 5.7 * Math.cos(a);
      const ly = 7.5 * Math.sin(a);
      for (const [lz, c] of zs) {
        const P = lower ? jawPt(sk, [lx, ly, lz]) : hp(lx, ly, lz);
        const [u, v, d] = cProj(P);
        const x = Math.floor(u);
        const y = Math.floor(v);
        if (x < 0 || y < 0 || x >= CW || y >= CH) continue;
        const j = y * CW + x;
        if (RZ[j] < -1e8 || RZ[j] > d + 2.4 || RID[j] !== CID.head) continue;
        const cc = c ?? (x % 2 === 0 ? TEETH : COL_TOOTH2);
        RC.set(cc.slice(0, 3), j * 4);
      }
    }
  };
  rows(false, [
    [-3.5, COL_GUM],
    [-4.4, null],
    [-5.3, null],
    [-6.1, MOUTH],
  ]);
  rows(true, [
    [-6.9, null],
    [-7.8, null],
    [-8.7, COL_GUM],
  ]);
  return eye;
}

/** Рёбра спереди, грудина, ключицы; со спины — хребет и лопатки. */
function cBones(sk: CSk, r: CRig, kb: number): void {
  const Rc = sk.Rc;
  const cr = (9.2 + r.breath * 0.7 + r.open * 0.6) * kb;
  const half = 6.4 * kb;
  const cc = vAdd(sk.chest, mApp(Rc, [0.8, 0, 0]));
  const surf = (yy: number, zz: number, back = false): [V3, V3] | null => {
    const ex = Math.max(0, Math.abs(yy) - half);
    const xx2 = cr * cr - zz * zz - ex * ex;
    if (xx2 <= 0) return null;
    const lx = (back ? -1 : 1) * (Math.sqrt(xx2) + 0.2);
    const n: V3 = [lx, Math.sign(yy) * ex, zz];
    return [vAdd(cc, mApp(Rc, [lx, yy, zz])), mApp(Rc, vNorm(n))];
  };
  // Свет из груди (выброс пара, испарение): щели между рёбрами — горит
  // нутро, рёбра поверх. Раскрытая грудь — щели шире и ярче.
  const gap = 2.7 + r.open * 0.9;
  if (r.glow > 0.05)
    for (let ri = 0; ri < 4; ri++) {
      const zc = 3.4 - (ri + 0.5) * gap;
      const w = (11.4 - ri * 1.1) * kb;
      const hh = 0.55 + r.open * 0.75;
      for (let zz = zc - hh; zz <= zc + hh + 0.01; zz += 0.5)
        for (let yy = -w; yy <= w; yy += 0.5) {
          if (Math.abs(yy) < 1.4) continue;
          const s = surf(yy, zz - (yy / w) ** 2 * 2.4);
          if (!s) continue;
          const q = 1 - Math.abs(zz - zc) / (hh + 0.3) - (Math.abs(yy) / w) * 0.45;
          const g = cClamp(q * r.glow, 0, 1);
          const c = g > 0.62 ? EMBER[2] : g > 0.32 ? EMBER[1] : EMBER[0];
          const pt = dPut(s[0], c, 2.6, CID.body);
          if (pt) litPut(pt[0], pt[1], c, 0.3 + 0.6 * g);
        }
    }
  // Рёбра: дуги, к бокам загибаются вниз; раскрытая грудь — шире зазоры.
  for (let ri = 0; ri < 5; ri++) {
    const zz = 3.4 - ri * gap;
    const w = (12.6 - ri * 1.1) * kb;
    for (let yy = -w; yy <= w; yy += 0.6) {
      if (Math.abs(yy) < 1.3) continue;
      const s = surf(yy, zz - (yy / w) ** 2 * 2.4);
      if (s) dPut(s[0], boneLit(s[1]), 2.6, CID.body);
    }
  }
  // Грудина и ключицы.
  for (let zz = 5; zz >= -8; zz -= 0.5) {
    const s = surf(0, zz);
    if (s) dPut(s[0], boneLit(s[1], -0.1), 2.6, CID.body);
  }
  for (const sd of [-1, 1])
    for (let k = 0; k <= 1; k += 0.05) {
      const s = surf(sd * (1.5 + k * 11.5), 6.6 - k * 1.2);
      if (s) dPut(s[0], boneLit(s[1], 0.1), 2.6, CID.body);
    }
  // Хребет — позвонки по спине, лопатки — костяные клинья.
  for (let zz = 7.5; zz >= -7; zz -= 2.1) {
    const s = surf(0, zz, true);
    if (!s) continue;
    const at = dPut(s[0], boneLit(s[1], 0.15), 2.6, CID.body);
    if (at) {
      dPut(vAdd(s[0], mApp(Rc, [0, -1, 0])), boneLit(s[1], -0.25), 2.6, CID.body);
      dPut(vAdd(s[0], mApp(Rc, [0, 1, 0])), boneLit(s[1], -0.25), 2.6, CID.body);
    }
  }
  for (let zz = -1; zz >= -8; zz -= 2.1) {
    const P = vAdd(sk.waist, mApp(sk.Rw, [-7.6 * kb, 0, zz + 6]));
    dPut(P, boneLit(mApp(sk.Rw, [-1, 0, 0]), 0.1), 2.8, CID.body);
  }
  // Лопатки: ость наискось к плечу и внутренний край — приглушённо, это рельеф.
  for (const sd of [-1, 1])
    for (let k = 0; k <= 1; k += 0.07) {
      const a = surf(sd * (3.6 + k * 6.4) * kb, 5.4 - k * 0.6, true);
      if (a) dPut(a[0], boneLit(a[1], -0.12), 2.6, CID.body);
      const b = surf(sd * (3.8 + k * 1.4) * kb, 4.6 - k * 7.2, true);
      if (b) dPut(b[0], boneLit(b[1], -0.32), 2.6, CID.body);
    }
}

/** Скелет под мясом (испарение): череп, хребет, рёбра, кости рук и ног. */
function cSkeleton(sk: CSk): void {
  const mb = { ...cMat(BONE, CID.bone, 0), bone: true };
  const H = sk.head;
  const hp = (x: number, y: number, z: number): V3 => vAdd(H, mApp(sk.Rh, [x, y, z]));
  rSph(hp(-0.4, 0, 1.0), 7.4, mb);
  rCap(hp(2.4, -3.0, -3.6), hp(2.4, 3.0, -3.6), 3.8, 3.8, mb);
  rCap(jawPt(sk, [2.0, -2.7, -7.0]), jawPt(sk, [2.0, 2.7, -7.0]), 2.8, 2.8, mb);
  const sock: CMat = { ...mb, flat: COL_SOCKET };
  rSph(hp(5.3, -2.6, 0.4), 1.9, sock);
  rSph(hp(5.3, 2.6, 0.4), 1.9, sock);
  rCap(sk.pel, sk.neck, 1.9, 1.7, mb);
  rCap(sk.neck, hp(-1, 0, -4), 1.6, 1.5, mb);
  // Рёбра — дуги из капсул вокруг груди.
  for (let ri = 0; ri < 5; ri++) {
    const zz = 4 - ri * 2.8;
    const w = 10.5 - ri * 0.8;
    for (const sd of [-1, 1]) {
      let prev: V3 | null = null;
      for (let q = 0; q <= 6; q++) {
        const a = (q / 6) * Math.PI;
        // От хребта сзади, вокруг бока, к грудине спереди; на боку провисает.
        const P = vAdd(
          sk.chest,
          mApp(sk.Rc, [
            -6.5 * Math.cos(a),
            sd * (w * Math.sin(a) + 1.5 * (a / Math.PI)),
            zz - Math.sin(a) * 1.2,
          ]),
        );
        if (prev) rCap(prev, P, 1.05, 1.05, mb);
        prev = P;
      }
    }
  }
  rCap(vAdd(sk.pel, mApp(sk.Rp, [0, -6, 1])), vAdd(sk.pel, mApp(sk.Rp, [0, 6, 1])), 2.6, 2.6, mb);
  for (const [a, b, c] of [
    [sk.shA, sk.elA, sk.wrA],
    [sk.shB, sk.elB, sk.wrB],
    [sk.hipA, sk.knA, sk.anA],
    [sk.hipB, sk.knB, sk.anB],
  ] as [V3, V3, V3][]) {
    rCap(a, b, 1.9, 1.6, mb);
    rCap(b, c, 1.7, 1.4, mb);
    rSph(b, 2.2, mb);
  }
  rCap(sk.shA, sk.shB, 1.5, 1.5, mb);
}

/** Всё тело: ноги, таз, торс, плечи, руки, шея, голова. */
function cBody(sk: CSk, r: CRig): void {
  const T = colTones(r.thin);
  const kb = 1 - r.thin * 0.14;
  const mBody = cMat(T, CID.body, 0.37, 0.5);
  // Ноги.
  for (const [hip, kn, an, sd, id] of [
    [sk.hipA, sk.knA, sk.anA, -1, CID.legA],
    [sk.hipB, sk.knB, sk.anB, 1, CID.legB],
  ] as [V3, V3, V3, number, number][]) {
    const ml: CMat = { ...cMat(T, id, 0.21 + id * 0.11, 0.9), vein: true };
    rCap(hip, kn, 5.4 * kb, 4.4 * kb, ml);
    rSph(vAdd(kn, [0.8, 0, 0.3]), 3.9 * kb, ml);
    // Икра — бугор сзади голени.
    rCap(kn, an, 4.4 * kb, 3.1 * kb, ml);
    rSph(vLerp(kn, an, 0.32), 4.0 * kb, ml);
    const lift = cClamp((an[2] - 3) / 6, 0, 1);
    const heel = vAdd(an, [-1.6, 0, -2.3]);
    const toe = vAdd(an, [5.4 - lift * 1.2, sd * 0.8, -2.5 - lift * 2.2]);
    rCap(heel, toe, 2.9, 2.3, ml);
  }
  // Таз, живот, талия, грудь, спина.
  rCap(
    vAdd(sk.pel, mApp(sk.Rp, [0, -4.6, 1.4])),
    vAdd(sk.pel, mApp(sk.Rp, [0, 4.6, 1.4])),
    6.6 * kb,
    6.6 * kb,
    mBody,
  );
  rSph(vAdd(sk.pel, mApp(sk.Rw, [1.5, 0, 7.6])), 7.9 * kb, mBody);
  rCap(sk.waist, sk.chest, 7.4 * kb, 8.4 * kb, mBody);
  const cr = (9.2 + r.breath * 0.7 + r.open * 0.6) * kb;
  const cc = vAdd(sk.chest, mApp(sk.Rc, [0.8, 0, 0]));
  rCap(
    vAdd(cc, mApp(sk.Rc, [0, -6.4 * kb, 0])),
    vAdd(cc, mApp(sk.Rc, [0, 6.4 * kb, 0])),
    cr,
    cr,
    mBody,
  );
  rCap(
    vAdd(sk.chest, mApp(sk.Rc, [-3, -7.4 * kb, 0.8])),
    vAdd(sk.chest, mApp(sk.Rc, [-3, 7.4 * kb, 0.8])),
    7.6 * kb,
    7.6 * kb,
    mBody,
  );
  // Трапеции — от шеи к плечам: исполин сутулый, шея утоплена.
  rCap(
    vAdd(sk.neck, mApp(sk.Rc, [-1.8, -2.2, -3.2])),
    vAdd(sk.shA, mApp(sk.Rc, [-0.6, 2.6, 1.2])),
    4.6 * kb,
    3.9 * kb,
    mBody,
  );
  rCap(
    vAdd(sk.neck, mApp(sk.Rc, [-1.8, 2.2, -3.2])),
    vAdd(sk.shB, mApp(sk.Rc, [-0.6, -2.6, 1.2])),
    4.6 * kb,
    3.9 * kb,
    mBody,
  );
  // Руки: дельта, плечо, локоть, предплечье, кисть.
  for (const [sh, el, wr, open, sd, id, flat] of [
    [sk.shA, sk.elA, sk.wrA, r.ah, -1, CID.armA, r.aw],
    [sk.shB, sk.elB, sk.wrB, r.bh, 1, CID.armB, r.bw],
  ] as [V3, V3, V3, number, number, number, number][]) {
    const ma: CMat = { ...cMat(T, id, 0.13 + id * 0.17, 0.8), vein: true };
    rSph(vAdd(sh, mApp(sk.Rc, [0, sd * 1.0, 0.7])), 5.9 * kb, ma);
    rCap(sh, el, 5.0 * kb, 4.3 * kb, ma);
    rSph(vLerp(sh, el, 0.45), 4.8 * kb, ma);
    rSph(el, 4.2 * kb, ma);
    rCap(el, wr, 4.6 * kb, 3.5 * kb, ma);
    cHand(el, wr, open, kb, ma, flat);
  }
  // Шея и голова.
  const mh = cMat(T, CID.head, 0.55, 0.4);
  rCap(sk.neck, vAdd(sk.head, mApp(sk.Rh, [-1.4, 0, -5])), 5.4 * kb, 4.7 * kb, mh);
  cHead(sk, T, 1 - r.thin * 0.06);
  if (sk.rock) {
    // Глыба кладки: бурый камень со швами кирпича.
    const mr: CMat = { ...cMat(COL_ROCK, CID.rock, 0), bone: true };
    rSph(sk.rock, 8.6, mr);
    rSph(vAdd(sk.rock, [2.5, -3, 2.5]), 5.2, mr);
  }
}

/** Швы кирпича на глыбе — наклейкой по её поверхности. */
function cRockSeams(c: V3): void {
  const seam = hx('#2a201a');
  for (let zz = -6; zz <= 6; zz += 3)
    for (let a = -1.6; a <= 1.6; a += 0.08) {
      const rr = Math.sqrt(Math.max(0, 74 - zz * zz));
      dPut(vAdd(c, [Math.cos(a) * rr * 0.2, -Math.sin(a) * rr, zz]), seam, 2.6, CID.rock);
      dPut(vAdd(c, [Math.cos(a) * rr, Math.sin(a) * rr * 0.2, zz]), seam, 2.6, CID.rock);
    }
}

/** Затылок: центр и куда смотрит (для свечения поверх темноты). */
interface CNape {
  x: number;
  y: number;
  d: number;
  /** Смотрит к нам (> 0) или от нас. */
  face: number;
}

function cNapeOf(sk: CSk): CNape {
  const P = vAdd(sk.head, mApp(sk.Rh, [-6.1, 0, -5.2]));
  const [x, y, d] = cProj(P);
  const n = cNorm(mApp(sk.Rh, [-1, 0, -0.25]));
  return { x, y, d, face: n[2] };
}

/**
 * Пиксели свечения затылка (индекс·4 + ступень): горит, где его не закрывает
 * ближнее; со спины виден целиком, спереди — ореолом из-за шеи.
 */
function cNapePixels(n: CNape, big: number): Int32Array {
  const out: number[] = [];
  const R = (n.face > -0.15 ? 4.2 : 5.6) * big;
  for (let y = Math.floor(n.y - R - 1); y <= Math.ceil(n.y + R + 1); y++)
    for (let x = Math.floor(n.x - R * 1.3 - 1); x <= Math.ceil(n.x + R * 1.3 + 1); x++) {
      if (x < 0 || y < 0 || x >= CW || y >= CH) continue;
      const dd = Math.hypot((x + 0.5 - n.x) / 1.3, y + 0.5 - n.y);
      if (dd > R + 0.5) continue;
      const i = y * CW + x;
      if (RZ[i] > n.d + 2.4) continue;
      let lv = 0;
      if (n.face > -0.15) lv = dd < R * 0.45 ? 3 : dd < R - 0.6 ? 2 : 1;
      else if (RZ[i] < -1e8) {
        // Спереди затылок не виден — горит каймой вокруг шеи и головы.
        let near = 9;
        for (let yy = -2; yy <= 2; yy++)
          for (let xx = -2; xx <= 2; xx++) {
            const xs = x + xx;
            const ys = y + yy;
            if (xs < 0 || ys < 0 || xs >= CW || ys >= CH) continue;
            if (RID[ys * CW + xs]) near = Math.min(near, Math.max(Math.abs(xx), Math.abs(yy)));
          }
        lv = near <= 1 ? 2 : near <= 2 ? 1 : 0;
      }
      if (lv) out.push(i * 4 + lv);
    }
  return Int32Array.from(out);
}

/** Пар из суставов: клубы рождаются у плеч, шеи, локтей, колен и всплывают. */
function cSteam(p: Px, sk: CSk, r: CRig, t: number, cloak: boolean, loop: number): void {
  const amt = r.steam + (cloak ? 0.55 : 0);
  if (amt < 0.05) return;
  const em: [V3, number][] = [
    [vAdd(sk.shA, mApp(sk.Rc, [-1.2, -1.5, 4.5])), 1],
    [vAdd(sk.shB, mApp(sk.Rc, [-1.2, 1.5, 4.5])), 1],
    [vAdd(sk.neck, mApp(sk.Rc, [-4, 0, 1])), 0.8],
    [sk.elA, 0.45],
    [sk.elB, 0.45],
    [sk.knA, 0.35],
    [sk.knB, 0.35],
    [vAdd(sk.chest, mApp(sk.Rc, [-5, -5, -2])), 0.5],
    [vAdd(sk.chest, mApp(sk.Rc, [-5, 5, -2])), 0.5],
  ];
  // В петле (покой, шаг) период кратен её длине: клубы сходятся на стыке.
  const period = loop ? loop / Math.max(1, Math.round(loop / 0.5)) : 0.5;
  const life = 1.05;
  em.forEach(([P, w], e) => {
    const lvl = Math.min(1.25, amt * w);
    if (lvl < 0.18) return;
    const ph = hash(e, 3, 11) * period;
    const [u, v] = cProj(P);
    const n0 = Math.ceil((t - life - ph) / period);
    const n1 = Math.floor((t - ph) / period);
    for (let n = n0; n <= n1; n++) {
      const age = t - ph - n * period;
      if (age < 0 || age >= life) continue;
      const k = age / life;
      const sx = (hash(e, n, 1) - 0.5) * 6;
      const x = u + sx * k + Math.sin(k * 3 + e) * 1.5;
      const y = v - 2 - k * (9 + lvl * 7);
      const rad = (1.8 + k * (3.4 + lvl * 1.6)) * Math.min(1.25, 0.65 + lvl * 0.35);
      dbGrow(x - rad * 1.2 - 2, y - rad - 2, x + rad * 1.2 + 2, y + rad + 2);
      puff(p, x, y, rad, Math.min(0.85, 0.5 * lvl + 0.15) * (1 - k * k), e * 31 + n);
    }
  });
}

/** Земля сыплется с плеч (подъём) и крошка с глыбы: точки падают с разгоном. */
function cCrumbs(p: Px, from: V3[], t: number, n: number, seed: number): void {
  for (let i = 0; i < n; i++) {
    const P = from[i % from.length];
    const [u, v] = cProj(P);
    const t0 = hash(i, seed, 3) * 0.6;
    const age = (((t - t0) % 0.6) + 0.6) % 0.6;
    const x = Math.round(u + (hash(i, seed, 5) - 0.5) * 10 + (hash(i, seed) - 0.5) * age * 8);
    const y = Math.round(v + age * age * 70 + age * 6);
    dbGrow(x, y, x, y);
    p.set(x, y, COL_DIRT[i % 3]);
  }
}

/** Капли — тело течёт (испарение): тлеющие капли срываются вниз. */
function cDrips(p: Px, from: V3[], t: number, n: number): void {
  for (let i = 0; i < n; i++) {
    const P = from[i % from.length];
    const [u, v] = cProj(P);
    const age = (((t + hash(i, 7) * 0.7) % 0.7) + 0.7) % 0.7;
    const x = Math.round(u + (hash(i, 9) - 0.5) * 8);
    const y = Math.round(v + 2 + age * age * 60);
    dbGrow(x, y - 1, x, y);
    p.set(x, y, EMBER[1]);
    p.set(x, y - 1, alpha(EMBER[0], 0.7));
    litPut(x, y, EMBER[2], 0.85);
  }
}

/** След ладони (глыбы): полоса по пути кисти, тает к хвосту, за ближним — нет. */
function cSmear(p: Px, pts: [number, number, number, number][], warm: boolean): void {
  const n = pts.length - 1;
  if (n < 1) return;
  const c0 = warm ? hx('#fff0dc') : hx('#e8dccc');
  const c1 = warm ? hx('#f4a888') : hx('#a89884');
  const c2 = warm ? hx('#c45a40') : hx('#6e6052');
  for (let i = n - 1; i >= 0; i--) {
    const [ax, ay, ad, ar] = pts[i];
    const [bx, by, bd, br] = pts[i + 1];
    const age = (i + 0.5) / n;
    const L = Math.hypot(bx - ax, by - ay);
    if (L < 0.6) continue;
    const steps = Math.ceil(L * 2);
    for (let s = 0; s <= steps; s++) {
      const k = s / steps;
      const cx = ax + (bx - ax) * k;
      const cy = ay + (by - ay) * k;
      const d = ad + (bd - ad) * k;
      const rr = (ar + (br - ar) * k) * (1 - age * 0.55);
      for (let y = Math.floor(cy - rr); y <= Math.ceil(cy + rr); y++)
        for (let x = Math.floor(cx - rr); x <= Math.ceil(cx + rr); x++) {
          if (x < 0 || y < 0 || x >= CW || y >= CH) continue;
          const q = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / (rr || 1);
          if (q > 1) continue;
          const i2 = y * CW + x;
          if (RZ[i2] > d + 1) continue;
          // Хвост — через точку: тает, а не обрывается.
          if (age > 0.6 && (x + y) % 2) continue;
          const c = q < 0.45 && age < 0.4 ? c0 : q < 0.8 && age < 0.75 ? c1 : c2;
          dbGrow(x, y, x, y);
          p.set(x, y, alpha(c, 0.92 - age * 0.5));
        }
    }
  }
}

/** Кайма вокруг силуэта поверх темноты (смена фазы, смертный жар). */
function cRim(p: Px, c: RGBA, a: number): void {
  const d = p.data;
  const X0 = Math.max(2, DB.x0 - 2);
  const X1 = Math.min(CW - 3, DB.x1 + 2);
  const Y0 = Math.max(2, DB.y0 - 2);
  const Y1 = Math.min(CH - 3, DB.y1 + 2);
  for (let y = Y0; y <= Y1; y++)
    for (let x = X0; x <= X1; x++) {
      const i = y * CW + x;
      if (d[i * 4 + 3]) continue;
      let near = 9;
      for (let yy = -2; yy <= 2 && near > 1; yy++)
        for (let xx = -2; xx <= 2; xx++)
          if (d[((y + yy) * CW + x + xx) * 4 + 3])
            near = Math.min(near, Math.abs(xx) + Math.abs(yy));
      if (near > 2) continue;
      litPut(x, y, c, a * (near <= 1 ? 1 : 0.45));
    }
}

// ---- Техники: дорожки ключевых поз --------------------------------------------

const CFPS = 24;
const F1 = 1 / CFPS;

type CTech =
  | 'idle'
  | 'walk'
  | 'turn'
  | 'rise'
  | 'roar'
  | 'swipe'
  | 'stomp'
  | 'back'
  | 'vent'
  | 'quake'
  | 'throw'
  | 'rings'
  | 'kneel'
  | 'death';

/** Что ещё рисовать в кадре, кроме тела. */
interface CPose {
  r: CRig;
  /** След кисти: 'A', 'B', обе, глыба. */
  /** След: буквы — `A`/`B` кисти, `a`/`b` стопы (правая/левая). */
  trail?: string;
  /** Шлейф силуэтов (самые быстрые кадры). */
  ghost?: boolean;
  /** Земля с плеч (подъём), крошка с глыбы, капли (испарение). */
  dirt?: number;
  crumbs?: number;
  drips?: number;
  /** Затылок горит с любой стороны (на коленях). */
  nape?: boolean;
}

/** Длительности мозга: удар в T, отдых R (с поправкой на темп фазы 3). */
function cTimes(tech: CTech, h: number): { T: number; R: number; hits: number[] } {
  const R = 0.85 / h;
  switch (tech) {
    case 'swipe':
      return { T: COL.swipe.warn / h, R, hits: [COL.swipe.warn / h] };
    case 'stomp':
      return { T: COL.stomp.warn / h, R, hits: [COL.stomp.warn / h] };
    case 'back':
      return { T: COL.back.warn, R, hits: [COL.back.warn] };
    case 'vent':
      return { T: COL.vent.warn, R, hits: [COL.vent.warn] };
    case 'quake':
      return { T: COL.quake.warn, R, hits: [COL.quake.warn] };
    case 'throw':
      return { T: COL.throw.windup, R, hits: [COL.throw.windup] };
    case 'rings': {
      const g = COL.rings;
      const hits = g.radii.map((_, i) => g.warn + i * g.gap);
      return { T: hits[hits.length - 1], R, hits };
    }
    default:
      return { T: 0, R: 0, hits: [] };
  }
}

/** Конец разворота (`back`): удар, потом поворот за 0,5 с. */
const BACK_END = COL.back.warn + 0.5;

/** Сколько кадров у техники (24 к/с) и в какие миги удары. */
function cSpan(tech: CTech, h: number): { n: number; hits: number[] } {
  switch (tech) {
    case 'idle':
      return { n: 24, hits: [] };
    case 'walk':
      return { n: 16, hits: [] };
    case 'turn':
      return { n: 12, hits: [] };
    case 'rise':
      return { n: Math.ceil(COL.rise * CFPS), hits: [] };
    case 'roar':
      return { n: Math.ceil(COL.roar * CFPS), hits: [] };
    case 'kneel':
      return { n: Math.ceil(COL.kneel * CFPS), hits: [] };
    case 'death':
      return { n: Math.ceil(COL_DEATH * CFPS), hits: [] };
    case 'back': {
      const { R, hits } = cTimes(tech, h);
      return { n: Math.ceil((BACK_END + R) * CFPS) + 1, hits };
    }
    default: {
      const { T, R, hits } = cTimes(tech, h);
      return { n: Math.ceil((T + R) * CFPS) + 1, hits };
    }
  }
}

/** Время кадра f: 24 к/с, а кадр, в котором удар, — ровно в миг удара. */
function cFrameTime(f: number, hits: number[]): number {
  const t = f / CFPS;
  for (const h of hits) if (h >= t && h < t + F1 - 1e-9) return h;
  return t;
}

const COL_DEATH = 1.6;

/** Дрожь натуги: ±a пикселя через кадр (24 к/с — читается как вибрация). */
const jit = (t: number, a: number) => (Math.floor(t * CFPS) % 2 ? a : -a);

/** Покой: вдох грудью, плечи, голова, руки качаются с опозданием. `u` — 0…1. */
function cIdle(u: number): CPose {
  const r = { ...CREADY };
  const b = u < 0.42 ? eIO(u / 0.42) : 1 - eIO((u - 0.42) / 0.58);
  const a = u * TAU;
  r.breath = b;
  r.shr = b * 0.9;
  r.ph = CREADY.ph + b * 0.45;
  r.lean = CREADY.lean - b * 0.035;
  r.hp = CREADY.hp - b * 0.07;
  r.jaw = CREADY.jaw + (u > 0.46 && u < 0.78 ? 0.14 * Math.sin(((u - 0.46) / 0.32) * Math.PI) : 0);
  r.aaz = CREADY.aaz + 0.05 * Math.sin(a - 0.9);
  r.baz = CREADY.baz + 0.05 * Math.sin(a - 1.2);
  r.ael = CREADY.ael + 0.035 * Math.sin(a - 1.4);
  r.bel = CREADY.bel + 0.035 * Math.sin(a - 1.0);
  r.pb = 0.55 * Math.sin(a);
  r.roll = -0.012 * Math.sin(a + 0.3);
  r.steam = 0.3 + (u > 0.45 && u < 0.85 ? 0.35 : 0);
  return { r };
}

/** Ходьба: тяжёлый шаг — перенос веса, удар стопы, просадка корпуса. `u` — 0…1. */
const WALK_STEP = 15;
function cWalk(u: number): CPose {
  const r = { ...CREADY };
  const S = WALK_STEP;
  const leg = (ph: number): [number, number] => {
    // Опора: стопа едет назад ровно со скоростью хода (не скользит).
    if (ph < 0.5) return [S / 2 - S * (ph / 0.5), 0];
    const k = (ph - 0.5) / 0.5;
    return [-S / 2 + S * eIO(k), Math.sin(k * Math.PI) * 5.2 * (1 - k * 0.25)];
  };
  const [ra, rh] = leg(u);
  const [la, lh] = leg((u + 0.5) % 1);
  r.na = ra + 0.8;
  r.nh = rh;
  r.fa = la + 0.8;
  r.fh = lh;
  r.nb = 8;
  r.fb = 8;
  // Таз: сразу после удара пятки — ниже всего (вес принят), на проходе — выше.
  const w = (u % 0.5) / 0.5;
  const bump = w < 0.1 ? eOut(w / 0.1) : Math.max(0, 1 - eIO((w - 0.1) / 0.5));
  r.ph = CREADY.ph + 0.7 - 3.0 * bump;
  r.tsy = 1 - 0.018 * (w < 0.18 ? Math.sin((w / 0.18) * Math.PI) : 0);
  r.tsx = 1 + 0.012 * (w < 0.18 ? Math.sin((w / 0.18) * Math.PI) : 0);
  const a = u * TAU;
  // Вес над опорной ногой, плечи — встречным разворотом.
  r.pb = -1.7 * Math.sin(a);
  r.roll = -0.045 * Math.sin(a - 0.3);
  r.twist = -0.13 * Math.cos(a);
  r.lean = 0.17 + 0.03 * bump;
  // Руки — против ног (правая вперёд, когда впереди левая нога).
  r.ael = -1.38 - 0.3 * Math.cos(a - 0.35);
  r.bel = -1.38 + 0.3 * Math.cos(a - 0.35);
  r.aaz = 0.3;
  r.baz = 0.3;
  r.ar = 26.8;
  r.br = 26.8;
  // Голова кивает с опозданием на удар стопы.
  const wl = ((((u - 0.06) % 0.5) + 0.5) % 0.5) / 0.5;
  const bl = wl < 0.1 ? eOut(wl / 0.1) : Math.max(0, 1 - eIO((wl - 0.1) / 0.5));
  r.hp = 0.08 + 0.07 * bl;
  r.hy = 0.05 * Math.cos(a);
  r.steam = 0.4;
  return { r };
}

/** Разворот на месте: переступает, голова и плечи ведут, ноги догоняют. */
function cTurn(u: number, dir: number): CPose {
  const r = { ...CREADY };
  const a = u * TAU;
  // Правая стопа переступает в u ∈ [0, 0.42], левая — в [0.5, 0.92].
  const step = (k: number) => (k > 0 && k < 1 ? Math.sin(k * Math.PI) : 0);
  const sA = step(u / 0.42);
  const sB = step((u - 0.5) / 0.42);
  r.nh = sA * 4.2;
  r.fh = sB * 4.2;
  r.na = CREADY.na + dir * sA * 2.5;
  r.fa = CREADY.fa - dir * sB * 2.5;
  r.nb = CREADY.nb + sA * 1.5;
  r.fb = CREADY.fb + sB * 1.5;
  // Приземлился — вес принят: таз проседает сразу после постановки стопы.
  const plant = (p0: number) => {
    const d = (((u - p0) % 1) + 1) % 1;
    return d < 0.22 ? Math.sin((d / 0.22) * Math.PI) : 0;
  };
  r.ph = CREADY.ph - 1.5 * (plant(0.42) + plant(0.92));
  r.pb = (sA - sB) * 1.6;
  r.twist = dir * 0.2;
  r.hy = dir * 0.28;
  r.roll = (sB - sA) * 0.04;
  r.aaz = CREADY.aaz + 0.12 * Math.sin(a);
  r.baz = CREADY.baz - 0.12 * Math.sin(a);
  r.steam = 0.4;
  return { r };
}

/**
 * Ключ удержания: каналы стоят на месте до этого мига. Канал, заданный
 * только в ключе удара (сжатие, ладонь в землю, кайма), иначе полз бы к
 * нему с самого начала техники.
 */
const HOLD = (t: number, ch: Partial<CRig>): CKf => [t, ch, eLin];
/** Каналы «удара» в покое — для ключей удержания перед ударом. */
const QUIET: Partial<CRig> = { tsx: 1, tsy: 1, tdx: 0, tdy: 0, rim: 0, eyes: 0, aw: 0, bw: 0 };

/** Подъём из пара: рука прорывает землю, вторая, опора, голова, колено, встал. */
function cRise(t: number): CPose {
  const keys: CKf[] = [
    [
      0,
      {
        sink: 96,
        ph: 15,
        lean: 0.55,
        hp: -0.15,
        aaz: 0.15,
        ael: 1.2,
        ar: 27,
        ah: 1,
        baz: 0.3,
        bel: -0.6,
        bh: 1,
        na: 6,
        fa: -6,
        steam: 1.1,
        aw: 0,
        bw: 0,
      },
    ],
    [0.32, { sink: 64, ael: 1.38 }, eLin],
    // Правая рука вырывается из земли по локоть и тянется вверх…
    [0.5, { sink: 50, ael: 1.42, aaz: 0.2, aw: 0 }, eOut],
    // …и шлёпает ладонью о землю впереди справа.
    [0.66, { aw: 1, agx: 14, agy: 15, agz: 0, sink: 51 }, eIn],
    [0.7, { sink: 50 }, eOut],
    // Левая тянется вверх.
    [0.84, { bel: 1.38, baz: 0.2, br: 27, sink: 47, bw: 0 }, eOut],
    [0.98, { bw: 1, bgx: 14, bgy: 15, bgz: 0, sink: 48 }, eIn],
    [1.02, { sink: 47 }, eOut],
    // Вытягивает себя: плечи и голова выходят между ладоней.
    [1.3, { sink: 40, lean: 0.62, hp: 0.1, jaw: 0.5 }, eIn],
    [1.65, { sink: 26, lean: 0.48, hp: -0.2, jaw: 0.7, ph: 16 }, eOut],
    // Колено вверх: правая стопа встаёт на землю впереди.
    [1.95, { sink: 9, ph: 17, na: 7, nb: 9, fa: -9, lean: 0.45, jaw: 0.4, aw: 1, bw: 1 }, eIO],
    // Встаёт, руки отрываются от земли.
    [2.12, { sink: 2, aw: 0.6, bw: 0.6, ph: 20 }, eIn],
    [
      2.36,
      {
        sink: 0,
        ph: 29.8,
        lean: 0.06,
        aw: 0,
        bw: 0,
        aaz: 0.55,
        ael: -1.1,
        baz: 0.55,
        bel: -1.1,
        ah: 0.3,
        bh: 0.3,
        na: 3,
        fa: -2,
        hp: -0.12,
        jaw: 0.55,
        steam: 1.2,
      },
      eOut,
    ],
    [2.6, { ...CREADY, steam: 0.8 }, eIO],
  ];
  const r = cTrack(keys, t, CREADY, CLAG);
  return { r, dirt: t > 0.35 && t < 2.3 ? 1 : 0 };
}

/** Рёв (смена фазы): вдох, грудь раздувается, голова назад — и рёв с дрожью. */
function cRoar(t: number, ph: number): CPose {
  const keys: CKf[] = [
    [0, {}],
    // Вдох: грудь раздувается, плечи вверх, кулаки назад, голова запрокинута.
    [
      0.32,
      {
        ...QUIET,
        breath: 1,
        shr: 2.6,
        hp: -0.34,
        lean: -0.1,
        ph: 30.2,
        aaz: 1.1,
        ael: -1.0,
        ar: 23,
        baz: 1.1,
        bel: -1.0,
        br: 23,
        ah: 0,
        bh: 0,
        jaw: 0.2,
        steam: 0.5,
      },
      eIO,
    ],
    // Рёв: рывок вперёд, пасть настежь, руки в стороны, присел.
    [
      0.42,
      {
        breath: 0.6,
        shr: 0.5,
        hp: -0.05,
        nk: 3.4,
        lean: 0.28,
        ph: 26.6,
        jaw: 1,
        aaz: 1.3,
        ael: -0.38,
        ar: 27,
        baz: 1.3,
        bel: -0.38,
        br: 27,
        tsx: 1.045,
        tsy: 0.955,
        eyes: 1,
        steam: 1.5,
        rim: 1,
      },
      eIn,
    ],
    [0.55, { tsx: 1, tsy: 1 }, eOut],
    [1.0, { jaw: 0.95, rim: 0.35, steam: 1.2 }, eLin],
    [1.12, { jaw: 0.55, eyes: 0.4, rim: 0 }, eIO],
    [1.3, { ...CREADY, steam: 0.6 }, eIO],
  ];
  const r = cTrack(keys, t, CREADY, CLAG2);
  // Рёв дрожит: голова и пасть, 4 кадра на 12 к/с.
  if (t > 0.45 && t < 1.08) {
    const q = Math.floor(t * 12) % 4;
    r.hr += [0.05, 0, -0.05, 0][q];
    r.hy += [0, 0.05, 0, -0.05][q];
    r.jaw -= [0, 0.08, 0, 0.08][q];
    r.pb += jit(t, 0.35);
  }
  // Переход в «Испарение»: тело тает прямо во время рёва.
  if (ph === 3) {
    r.thin = cClamp((t - 0.3) / 0.7, 0, 1);
    r.heat = cClamp((t - 0.35) / 0.4, 0, 1);
  }
  if (ph === 1) r.steam += 0.6;
  return { r };
}

/** Ладонь: замах с разворотом плеча на всю метку, хлёст по дуге ровно в T, проводка. */
function cSwipe(t: number, h: number): CPose {
  const { T, R } = cTimes('swipe', h);
  const keys: CKf[] = [
    [0, {}],
    // Предвестие: плечо чуть вперёд и вниз — противоход перед замахом.
    [0.14 * T, { twist: 0.1, ph: 28.4, aaz: 0.25, ael: -1.2, lean: 0.16, ah: 0.4 }, eIO],
    // Замах: левая нога шагает вперёд, правая рука уходит назад-вверх, плечо разворачивается.
    [
      0.44 * T,
      {
        fa: 5,
        fh: 4.5,
        pa: -0.6,
        twist: -0.34,
        aaz: 1.35,
        ael: 0.05,
        ar: 27,
        ah: 0.85,
        lean: 0.02,
      },
      eIO,
    ],
    [
      0.72 * T,
      {
        fa: 10,
        fh: 0,
        pa: -1.8,
        ph: 28.4,
        twist: -0.66,
        lean: -0.12,
        aaz: 2.05,
        ael: 0.55,
        ar: 28.2,
        ah: 1,
        hy: 0.48,
        baz: 0.6,
        bel: -0.42,
        br: 24,
        jaw: 0.28,
      },
      eIO,
    ],
    // Натяжение: дотягивает назад — видно, что сейчас хлестнёт.
    [
      T - 3 * F1,
      { ...QUIET, twist: -0.76, aaz: 2.22, ael: 0.62, lean: -0.15, ph: 28.1, hy: 0.55 },
      eOut,
    ],
    // Хлёст: два кадра по дуге — ладонь проходит перед телом.
    [T - 1.6 * F1, { twist: -0.12, aaz: 1.3, ael: 0.28, ar: 30, lean: 0.1, pa: 1, hy: 0.2 }, eIn],
    [
      T,
      {
        twist: 0.46,
        aaz: 0,
        ael: -0.42,
        ar: 30.6,
        lean: 0.36,
        pa: 3,
        ph: 26,
        hy: -0.12,
        hp: 0.16,
        jaw: 0.78,
        baz: 1.5,
        bel: -0.95,
        br: 25,
        tsx: 1.045,
        tsy: 0.955,
        tdx: 1.5,
      },
      eIn,
    ],
    // Проводка: рука уходит дальше по дуге, корпус доворачивается.
    [
      T + 0.09,
      {
        twist: 0.74,
        aaz: -0.88,
        ael: -0.72,
        lean: 0.43,
        ph: 25.4,
        tsx: 1,
        tsy: 1,
        hy: -0.3,
        tdx: 2,
      },
      eOut,
    ],
    [T + 0.3, { twist: 0.62, aaz: -0.66, ael: -0.78, lean: 0.38, jaw: 0.32, tdx: 1.6 }, eIO],
    // Возврат: рука назад, левая нога приставляется.
    [
      T + R * 0.62,
      {
        twist: 0.14,
        aaz: 0.24,
        ael: -1.18,
        lean: 0.2,
        ph: 28.2,
        fa: 3.5,
        fh: 2.6,
        ah: 0.35,
        pa: 1,
        tdx: 0.6,
        hy: 0,
      },
      eIO,
    ],
    [T + R, CREADY, eIO],
  ];
  const r = cTrack(keys, t, CREADY, { ...CLAG, hy: 0.04 });
  if (t > T - 3 * F1 - 0.12 && t < T - 2 * F1) r.pb += jit(t, 0.3);
  const strike = t > T - 2.2 * F1 && t < T + 0.13;
  return { r, trail: strike ? 'A' : undefined, ghost: t > T - 2 * F1 && t < T + 0.06 };
}

/** Топот: колено медленно вверх, зависание, удар стопой — присед и отдача. */
function cStomp(t: number, h: number, side: number): CPose {
  const { T, R } = cTimes('stomp', h);
  const keys: CKf[] = [
    [0, {}],
    // Вес на левую ногу.
    [
      0.18 * T,
      { pb: 2.9, roll: 0.07, ph: 28.6, lean: 0.14, baz: 0.6, bel: -1.0, aaz: 0.7, ael: -0.9 },
      eIO,
    ],
    // Колено к груди, руки в стороны и чуть вверх (локти согнуты), взгляд — на стопу.
    [
      0.74 * T,
      {
        na: 6,
        nh: 18.5,
        nb: 9.5,
        ph: 29.4,
        lean: -0.1,
        roll: 0.11,
        pb: 3.4,
        aaz: 1.2,
        ael: -0.05,
        ar: 22,
        baz: 1.15,
        bel: -0.2,
        br: 22,
        hp: 0.3,
        jaw: 0.3,
        twist: 0.08,
      },
      eIO,
    ],
    [T - 2.5 * F1, { ...QUIET, nh: 20, na: 6.6, aaz: 1.28, ael: 0.02, lean: -0.12 }, eOut],
    // Удар: стопа падает с разгоном.
    [T - F1, { nh: 6, na: 7.2, lean: 0.12, ph: 27.8, roll: 0.04, pb: 1.5 }, eIn],
    [
      T,
      {
        nh: 0,
        na: 7.6,
        ph: 24.4,
        pb: 0,
        roll: 0,
        lean: 0.32,
        aaz: 0.85,
        ael: -0.75,
        baz: 0.8,
        bel: -0.85,
        hp: 0.34,
        jaw: 0.65,
        tsx: 1.07,
        tsy: 0.925,
      },
      eIn,
    ],
    // Отдача: корпус пружинит вверх и снова оседает.
    [T + 0.07, { ph: 25.8, tsx: 1, tsy: 1.018, lean: 0.25 }, eOut],
    [T + 0.18, { ph: 25.2, tsy: 1, lean: 0.28 }, eIO],
    [
      T + R * 0.55,
      { ph: 28.2, lean: 0.18, na: 5, nh: 2.4, aaz: 0.4, ael: -1.2, baz: 0.4, bel: -1.25 },
      eIO,
    ],
    [T + R, CREADY, eIO],
  ];
  let r = cTrack(keys, t, CREADY, CLAG2);
  if (t > 0.74 * T && t < T - F1) r.pb += jit(t, 0.25);
  if (side) r = cMirror(r);
  const slam = t > T - 2.2 * F1 && t < T + 0.07;
  return {
    r,
    trail: slam ? (side ? 'b' : 'a') : undefined,
    ghost: t > T - 1.5 * F1 && t < T + 0.03,
  };
}

/** Модель поворота мозга в `back`: доля пройденного полуоборота через τ после удара. */
function backTurn(tau: number): number {
  if (tau <= 0) return 0;
  const n = Math.min(40, Math.floor(tau * 60));
  let left = 1;
  for (let i = 1; i <= n; i++) left *= 1 - Math.min(1, i / 30);
  return 1 - left;
}

/**
 * Разворот: рука через грудь — хлёст тыльной стороной за спину (удар в 0,8),
 * потом корпус уводит, ноги переступают — лицом туда, где был затылок.
 * Поворот ног — в рисунке, а не по `face`: он идёт в сторону хлёста всегда.
 */
function cBack(t: number, h: number): CPose & { legs: number } {
  const T = COL.back.warn;
  const { R } = cTimes('back', h);
  const keys: CKf[] = [
    [0, {}],
    // Рука уходит через грудь к левому плечу, корпус закручивается влево.
    [
      0.2,
      {
        twist: 0.35,
        aaz: -0.9,
        ael: -0.42,
        ar: 21,
        ah: 0,
        ph: 28.4,
        lean: 0.18,
        hy: -0.25,
        baz: 0.6,
      },
      eIO,
    ],
    [
      0.58,
      {
        twist: 0.68,
        aaz: -1.4,
        ael: -0.22,
        ar: 18.5,
        ph: 27.6,
        lean: 0.12,
        hy: -0.5,
        pb: 1.5,
        jaw: 0.3,
      },
      eIO,
    ],
    [T - 2.5 * F1, { ...QUIET, twist: 0.76, aaz: -1.5, ael: -0.18, hy: -0.54 }, eOut],
    // Хлёст: корпус раскручивается, тыльная сторона кисти — плоско за спину.
    [T - F1, { twist: -0.4, aaz: 0.9, ael: -0.1, ar: 28, hy: -0.1 }, eIn],
    [
      T,
      {
        twist: -1.5,
        aaz: 2.25,
        ael: -0.18,
        ar: 30,
        lean: 0.22,
        ph: 27.2,
        hy: 0.55,
        jaw: 0.72,
        pb: -1.5,
        tsx: 1.04,
        tsy: 0.965,
      },
      eIn,
    ],
    [T + 0.07, { twist: -2.05, aaz: 1.75, ael: -0.35, tsx: 1, tsy: 1 }, eOut],
    // Корпус довёл — ноги переступают следом (доля поворота ниже).
    [T + 0.22, { twist: -2.75, aaz: 0.9, ael: -0.75, hy: 0.3, lean: 0.25 }, eIO],
    [BACK_END, { twist: -Math.PI, aaz: 0.5, ael: -1.05, hy: 0, lean: 0.22, ph: 27.6 }, eIO],
    [BACK_END + R * 0.6, { aaz: 0.3, ael: -1.25, ph: 28.8, lean: 0.14 }, eIO],
    [BACK_END + R, { twist: -Math.PI }, eIO],
  ];
  const r = cTrack(keys, t, CREADY, CLAG);
  // Ноги: поворот на π в сторону хлёста — его вычитаем из разворота груди.
  const legs = -Math.PI * backTurn(t - T);
  r.twist -= legs;
  // Переступает: правая нога шагает по кругу, пока ноги догоняют.
  const st = cClamp((t - T) / 0.3, 0, 1);
  r.nh += Math.sin(st * Math.PI) * 4;
  r.na += Math.sin(st * Math.PI) * -3;
  const st2 = cClamp((t - T - 0.18) / 0.3, 0, 1);
  r.fh += Math.sin(st2 * Math.PI) * 3.5;
  if (t > 0.58 && t < T - F1) r.pb += jit(t, 0.25);
  const strike = t > T - 1.6 * F1 && t < T + 0.12;
  return { r, legs, trail: strike ? 'A' : undefined, ghost: t > T - 1.5 * F1 && t < T + 0.25 };
}

/** Выброс пара: сжался, обхватил себя, свет в груди копится — и грудь раскрывается. */
function cVent(t: number, h: number): CPose {
  const { T, R } = cTimes('vent', h);
  const keys: CKf[] = [
    [0, {}],
    [
      0.24,
      {
        ph: 27.8,
        lean: 0.32,
        shr: 1.6,
        aaz: -0.95,
        ael: 0.05,
        ar: 17,
        baz: -0.95,
        bel: 0.05,
        br: 17,
        ah: 0,
        bh: 0,
        hp: 0.3,
        glow: 0.3,
        steam: 0.6,
      },
      eIO,
    ],
    [
      T - 2 * F1,
      {
        ...QUIET,
        ph: 26.8,
        lean: 0.42,
        shr: 2.6,
        hp: 0.42,
        aaz: -1.15,
        ael: 0.16,
        baz: -1.15,
        bel: 0.16,
        glow: 1,
        steam: 0.9,
      },
      eIO,
    ],
    // Взрыв: руки настежь, грудь вперёд и раскрыта, голова назад, пар из всех суставов.
    [
      T,
      {
        ph: 30,
        lean: -0.3,
        shr: -1,
        hp: -0.52,
        jaw: 1,
        aaz: 1.75,
        ael: 0.36,
        ar: 30,
        baz: 1.75,
        bel: 0.36,
        br: 30,
        open: 1,
        glow: 1,
        steam: 1.6,
        tsy: 1.05,
        tsx: 0.97,
        tdy: 1.5,
        ah: 1,
        bh: 1,
        eyes: 1,
        rim: 0.7,
      },
      eOut3,
    ],
    [T + 0.1, { ph: 29.4, lean: -0.22, tsy: 1, tsx: 1, tdy: 0.5, aaz: 1.85, ael: 0.42 }, eOut],
    [
      T + 0.36,
      { open: 0.6, glow: 0.5, steam: 1.1, jaw: 0.6, hp: -0.35, rim: 0, eyes: 0.3, tdy: 0 },
      eIO,
    ],
    [T + R, { ...CREADY, steam: 0.6 }, eIO],
  ];
  const r = cTrack(keys, t, CREADY, CLAG2);
  if (t > 0.45 && t < T) r.pb += jit(t, 0.25 + 0.35 * cClamp((t - 0.45) / 0.3, 0, 1));
  return { r, ghost: t >= T && t < T + 0.05 };
}

/** Землетрясение: колено к груди, кулаки сцеплены над головой — удар стопой и кулаками в землю. */
function cQuake(t: number, h: number): CPose {
  const { T, R } = cTimes('quake', h);
  const keys: CKf[] = [
    [0, {}],
    [0.2, { ph: 27.2, lean: 0.25, aaz: 0.5, ael: -0.7, baz: 0.5, bel: -0.7, ah: 0, bh: 0 }, eIO],
    [
      0.75,
      {
        na: 2,
        nb: 14.5,
        nh: 19,
        ph: 29.2,
        pb: 3.4,
        roll: 0.13,
        lean: -0.18,
        aaz: -0.35,
        ael: 1.32,
        ar: 25,
        baz: -0.35,
        bel: 1.36,
        br: 25,
        hp: -0.42,
        jaw: 0.95,
        steam: 0.8,
      },
      eIO,
    ],
    [T - 3 * F1, { ...QUIET, nh: 20.5, ael: 1.42, bel: 1.45, lean: -0.22 }, eOut],
    [T - F1, { nh: 6, ph: 26.4, lean: 0.25, ael: 0.25, bel: 0.3, pb: 1.5, roll: 0.05 }, eIn],
    [
      T,
      {
        nh: 0,
        na: 3,
        nb: 13,
        ph: 21.9,
        pb: 0,
        roll: 0,
        lean: 0.6,
        aw: 1,
        agx: 15,
        agy: 6,
        agz: 0.4,
        bw: 1,
        bgx: 15,
        bgy: 6,
        bgz: 0.4,
        hp: 0.28,
        jaw: 0.75,
        tsx: 1.08,
        tsy: 0.91,
        tdy: -1,
      },
      eIn,
    ],
    [T + 0.08, { ph: 23.4, tsx: 1, tsy: 1.02, tdy: 0 }, eOut],
    [T + 0.25, { ph: 22.9, tsy: 1 }, eIO],
    [
      T + R * 0.6,
      { aw: 0, bw: 0, ph: 27.4, lean: 0.25, aaz: 0.45, ael: -1.1, baz: 0.45, bel: -1.1, nb: 10 },
      eIO,
    ],
    [T + R, CREADY, eIO],
  ];
  const r = cTrack(keys, t, CREADY, { ...CLAG, aw: 0, bw: 0 });
  if (t > 0.75 && t < T - F1) r.pb += jit(t, 0.35);
  const slam = t > T - 2.2 * F1 && t < T + 0.07;
  return {
    r,
    trail: slam ? 'aAB' : undefined,
    ghost: t > T - 1.5 * F1 && t < T + 0.04,
    dirt: t > T && t < T + 0.5 ? 0.5 : 0,
  };
}

/** Бросок: нагнулся, выломал глыбу, поднял над головой — бросок с отдачей. */
function cThrow(t: number, h: number): CPose {
  const { T, R } = cTimes('throw', h);
  const keys: CKf[] = [
    [0, {}],
    [
      0.3,
      {
        ph: 20.4,
        lean: 0.78,
        pa: 1,
        aw: 1,
        agx: 13,
        agy: 3.5,
        agz: 1,
        bw: 1,
        bgx: 13,
        bgy: 3.5,
        bgz: 1,
        hp: 0.35,
        na: 4,
        fa: -4,
        ah: 1,
        bh: 1,
        rock: 0,
      },
      eIO,
    ],
    [0.31, { rock: 1 }, eStep],
    // Выламывает: рывок вверх, глыба отрывается от земли.
    [0.47, { ph: 22.9, lean: 0.55, agz: 8, bgz: 8, agx: 12, bgx: 12, hp: 0.2, jaw: 0.55 }, eOut],
    // Над головой: прогнулся назад, вес на задней ноге, левая — вперёд.
    [
      0.86,
      {
        ph: 30,
        lean: -0.3,
        pa: -2,
        aw: 0,
        bw: 0,
        aaz: 0.1,
        ael: 1.42,
        ar: 24,
        baz: 0.1,
        bel: 1.42,
        br: 24,
        hp: -0.3,
        jaw: 0.6,
        fa: 7,
        na: -3,
      },
      eIO,
    ],
    [T - 2 * F1, { ...QUIET, lean: -0.37, ael: 1.5, bel: 1.5, pa: -2.4, rock: 1 }, eOut],
    // Бросок: руки хлещут вперёд, глыба уходит ровно в T.
    [T - F1, { lean: 0.05, ael: 1.0, bel: 1.0, pa: 0.5, ar: 28, br: 28 }, eIn],
    [T, { rock: 0 }, eStep],
    [
      T,
      {
        lean: 0.34,
        pa: 3,
        ph: 27.4,
        ael: 0.3,
        bel: 0.3,
        aaz: 0.15,
        baz: 0.15,
        ar: 30,
        br: 30,
        jaw: 0.85,
        hp: 0.05,
        tsx: 1.03,
        tsy: 0.97,
        tdx: 2,
      },
      eIn,
    ],
    [T + 0.1, { lean: 0.46, ael: -0.35, bel: -0.35, ph: 26.6, tsx: 1, tsy: 1, tdx: 2.5 }, eOut],
    [T + R * 0.6, { lean: 0.25, ael: -1.0, bel: -1.0, ph: 28.4, fa: 3, fh: 2, tdx: 1 }, eIO],
    [T + R, CREADY, eIO],
  ];
  const r = cTrack(keys, t, CREADY, { ...CLAG, aw: 0, bw: 0, baz: 0, bel: 0, br: 0 });
  if (t > 0.3 && t < 0.47) r.pb += jit(t, 0.3);
  const thr = t > T - 2 * F1 && t < T + 0.1;
  return {
    r,
    trail: thr ? 'AB' : undefined,
    ghost: t > T - 1.5 * F1 && t < T + 0.05,
    crumbs: t > 0.31 && t < T ? 1 : 0,
  };
}

/** Кольца испарения: руки в стороны ладонями вверх, тело дрожит и течёт, удар — с каждым кольцом. */
function cRings(t: number, h: number): CPose {
  const { T, R, hits } = cTimes('rings', h);
  const keys: CKf[] = [
    [0, {}],
    [
      0.32,
      {
        aaz: 1.2,
        ael: -0.05,
        ar: 28,
        baz: 1.2,
        bel: -0.05,
        br: 28,
        ah: 1,
        bh: 1,
        hp: -0.3,
        jaw: 0.8,
        lean: -0.05,
        ph: 28.9,
        heat: 1,
        steam: 0.9,
      },
      eIO,
    ],
    HOLD(hits[0] - 0.06, { ...QUIET, ael: 0.08, bel: 0.08, hp: -0.38, breath: 0.2 }),
  ];
  for (const hi of hits) {
    keys.push([
      hi,
      { breath: 1, tsy: 0.95, tsx: 1.04, ph: 27.8, open: 0.55, glow: 0.8, eyes: 1 },
      eIn,
    ]);
    keys.push([
      hi + 0.12,
      { breath: 0.25, tsy: 1, tsx: 1, ph: 28.9, open: 0, glow: 0.25, eyes: 0.2 },
      eOut,
    ]);
  }
  keys.push([
    T + R * 0.5,
    { aaz: 0.6, ael: -0.9, baz: 0.6, bel: -0.9, hp: 0.1, jaw: 0.3, heat: 1 },
    eIO,
  ]);
  keys.push([T + R, { ...CREADY, heat: 1 }, eIO]);
  const r = cTrack(keys, t, CREADY, CLAG2);
  r.thin = 1;
  if (t > 0.3 && t < T) r.pb += jit(t, 0.3);
  return { r, drips: t > 0.25 && t < T + 0.3 ? 1 : 0 };
}

/** На коленях: ядро бьёт — колени подламываются, ладони в землю, дышит, встаёт с усилием. */
function cKneel(t: number): CPose {
  const down = {
    ph: 14.8,
    lean: 0.64,
    na: -11,
    nb: 8,
    nh: 0,
    fa: -11.5,
    fb: 8,
    fh: 0,
    aw: 1,
    agx: 12.5,
    agy: 16,
    agz: 0,
    bw: 1,
    bgx: 12.5,
    bgy: 16,
    bgz: 0,
    hp: 0.8,
    nk: 3,
    ah: 1,
    bh: 1,
  };
  const keys: CKf[] = [
    [0, {}],
    // Ядро: корпус дёргает назад, голову запрокидывает, руки отбрасывает.
    [
      0.08,
      {
        tdx: -3,
        hp: -0.4,
        jaw: 0.9,
        aaz: 1.5,
        ael: -0.75,
        baz: 1.3,
        bel: -0.8,
        lean: -0.15,
        twist: 0.25,
        eyes: 1,
      },
      eOut,
    ],
    [0.2, { tdx: -2, ph: 24.4, lean: 0.12 }, eIO],
    // Колени бьют в землю.
    HOLD(0.4, { ...QUIET, tdx: -0.5 }),
    [
      0.46,
      {
        ph: 14.8,
        lean: 0.32,
        na: -11,
        nb: 8,
        fa: -11.5,
        fb: 8,
        tdx: 0,
        twist: 0,
        hp: 0.3,
        aaz: 0.3,
        ael: -1.3,
        baz: 0.3,
        bel: -1.3,
        tsx: 1.06,
        tsy: 0.94,
        eyes: 0,
      },
      eIn,
    ],
    HOLD(0.5, { aw: 0, bw: 0 }),
    // Ладони шлёпают о землю, голова повисает.
    [0.58, { ...down, ph: 13.8, tsx: 1, tsy: 1 }, eIn],
    [0.7, { ...down }, eOut],
    [2.55, { ...down }, eLin],
    // Встаёт: правая стопа вперёд, колено вверх, отталкивается руками.
    [2.82, { na: 6, nb: 9, nh: 3, ph: 16.4, lean: 0.55, hp: 0.4 }, eIO],
    [2.92, { nh: 0 }, eIn],
    [
      3.2,
      {
        ph: 26.4,
        lean: 0.24,
        aw: 0,
        bw: 0,
        na: 4,
        fa: -6,
        fh: 2,
        hp: 0.05,
        nk: 1.4,
        aaz: 0.6,
        ael: -1.0,
        baz: 0.6,
        bel: -1.0,
        ah: 0.3,
        bh: 0.3,
      },
      eIO,
    ],
    [COL.kneel, CREADY, eIO],
  ];
  const r = cTrack(keys, t, CREADY, { ...CLAG, aw: 0, bw: 0 });
  // Тяжело дышит на четвереньках: спина ходит, голова качается.
  if (t > 0.7 && t < 2.75) {
    const b = 0.5 - 0.5 * Math.cos((t - 0.7) * TAU * 0.9);
    r.breath = b;
    r.ph += b * 0.8;
    r.lean -= b * 0.04;
    r.hp += 0.06 * Math.sin((t - 0.7) * TAU * 0.45);
    r.steam = 0.5 + b * 0.4;
    r.stars = 1;
  }
  return { r, nape: t > 0.42 && t < 2.95 };
}

/** Смерть: удар, колени подламываются, мясо испаряется — кости проступают, оседает. */
function cDeath(t: number): CPose {
  const kneel = { ph: 14.4, na: -11, nb: 8, fa: -11.5, fb: 8 };
  const keys: CKf[] = [
    [
      0,
      {
        hp: -0.55,
        jaw: 1,
        lean: -0.2,
        aaz: 1.4,
        ael: 0.2,
        baz: 1.4,
        bel: 0.2,
        ar: 29,
        br: 29,
        eyes: 1,
        heat: 1,
        steam: 1.6,
        tdx: -2,
        glow: 0.8,
        rim: 1,
      },
      eOut,
    ],
    [0.14, { hp: -0.68, rim: 0.6 }, eLin],
    HOLD(0.4, { tsx: 1, tsy: 1 }),
    [
      0.5,
      {
        ...kneel,
        lean: 0.25,
        aaz: 0.4,
        ael: -1.2,
        baz: 0.4,
        bel: -1.2,
        hp: 0.4,
        jaw: 0.5,
        tdx: 0,
        melt: 0.3,
        tsx: 1.05,
        tsy: 0.95,
        rim: 0.15,
        eyes: 0,
      },
      eIn,
    ],
    [0.6, { tsx: 1, tsy: 1, rim: 0 }, eOut],
    [1.05, { lean: 0.5, hp: 0.7, melt: 0.86, ph: 12.9, steam: 1.8 }, eIO],
    [COL_DEATH, { lean: 0.95, ph: 7.4, melt: 1, sink: 7, steam: 1.2 }, eIn],
  ];
  const r = cTrack(keys, t, CREADY, CLAG2);
  r.thin = 1;
  r.alpha = t > 1.2 ? cClamp(1 - (t - 1.2) / (COL_DEATH - 1.2), 0, 1) : 1;
  return { r, drips: t < 1.2 ? 1 : 0 };
}

/** Поза кадра — чистая функция техники, времени, темпа и варианта. */
function cPoseAt(tech: CTech, t: number, h: number, v: number): CPose & { legs?: number } {
  switch (tech) {
    case 'idle':
      return cIdle(t);
    case 'walk':
      return cWalk(t);
    case 'turn':
      return cTurn(t, v ? -1 : 1);
    case 'rise':
      return cRise(t);
    case 'roar':
      return cRoar(t, v);
    case 'swipe':
      return cSwipe(t, h);
    case 'stomp':
      return cStomp(t, h, v);
    case 'back':
      return cBack(t, h);
    case 'vent':
      return cVent(t, h);
    case 'quake':
      return cQuake(t, h);
    case 'throw':
      return cThrow(t, h);
    case 'rings':
      return cRings(t, h);
    case 'kneel':
      return cKneel(t);
    case 'death':
      return cDeath(t);
  }
}

// ---- Кадр: запрос, сборка, кеш -----------------------------------------------------

/** Запрос кадра — всё, от чего зависит картинка (ключ кеша). */
interface CReq {
  tech: CTech;
  f: number;
  /** Вариант: сторона топота, фаза рёва, направление разворота на месте. */
  v: number;
  /** Темп ×100 (фаза 3 — быстрее). */
  hk: number;
  /** Румб тела: −4…4 по 22,5° (0 — профиль вправо, 4 — к нам, −4 — спиной). */
  yq: number;
  /** Облик: 0 — обычный, 1 — в плаще пара, 3 — тает. */
  ph: number;
  /** Взгляд за героем: −2…2. */
  lk: number;
  /** Вздрог от удара героя: 0; 1–2 — в лоб и бок; 3–4 — в затылок. */
  fl: number;
  /** Смешивание с прошлой позой: ступень 1…4 и откуда (ключ позы). */
  bl: number;
  bs: string;
}

const cKeyOf = (q: CReq) =>
  `${q.tech}|${q.f}|${q.v}|${q.hk}|${q.yq}|${q.ph}|${q.lk}|${q.fl}|${q.bl}|${q.bs}`;
/** Ключ позы без смешивания — от него смешивают следующую технику. */
const cSrcOf = (q: CReq) => `${q.tech}|${q.f}|${q.v}|${q.hk}|${q.lk}|${q.fl}|${q.ph}`;

/** Время позы кадра (петли — доля круга 0…1). */
function cReqTime(q: CReq): number {
  switch (q.tech) {
    case 'idle':
      return q.f / 24;
    case 'walk':
      return q.f / 16;
    case 'turn':
      return q.f / 12;
    default:
      return cFrameTime(q.f, cSpan(q.tech, q.hk / 100).hits);
  }
}

/** Длина петли в секундах (для пара, чтобы клубы сходились на стыке). */
const LOOP_S: Partial<Record<CTech, number>> = { idle: 2.4, walk: 1.6, turn: 1.2 };

/** Поза запроса: техника, взгляд, вздрог (без смешивания). */
function cPoseOf(q: CReq): CPose & { legs?: number } {
  const ps = cPoseAt(q.tech, cReqTime(q), q.hk / 100, q.v);
  const r = ps.r;
  if (q.lk) {
    r.hy += q.lk * 0.26;
    r.twist += q.lk * 0.07;
  }
  if (q.fl) {
    const k = q.fl === 2 || q.fl === 4 ? 1 : 0.55;
    if (q.fl >= 3) {
      // В затылок: голова дёргается вниз-вперёд, плечи к ушам, пасть настежь.
      r.hp += 0.34 * k;
      r.nk += 2 * k;
      r.lean += 0.1 * k;
      r.shr += 2.4 * k;
      r.jaw = Math.max(r.jaw, 0.7 * k);
      r.aaz += 0.25 * k;
      r.baz += 0.25 * k;
      r.eyes = Math.max(r.eyes, k);
    } else {
      // В лоб и бок: едва поводит головой — «лоб не берёт».
      r.hp -= 0.08 * k;
      r.hy += 0.06 * k;
      r.shr += 0.8 * k;
      r.jaw += 0.1 * k;
    }
  }
  // «Испарение»: тощий и тлеет (рёв перехода тает сам — у него своя дорожка).
  if (q.ph === 3 && !(q.tech === 'roar' && q.v === 3)) {
    r.thin = Math.max(r.thin, 1);
    r.heat = Math.max(r.heat, 0.85);
  }
  return ps;
}

/** Готовый кадр: картинка, свет, затылок (для свечения), поза (для смешивания). */
interface CFrame {
  fr: MobFrame;
  /** Свечение затылка и разруб (пиксели обрезанного кадра: индекс·4 + ступень). */
  nape: Int32Array;
  cut: Int32Array;
  r: CRig;
  ghost: boolean;
}

const CFR = frameLRU<CFrame>(330);
/** Варианты: вспышка, просвет, свет затылка. */
const CVAR = frameLRU<HTMLCanvasElement>(90);
/** Сколько кадров нарисовано и во что это обошлось (замер стенда). */
export const COL_STATS = { built: 0, ms: 0, max: 0, ph: {} as Record<string, number> };
const cMark = (name: string, t: number) => {
  const n = performance.now();
  COL_STATS.ph[name] = (COL_STATS.ph[name] ?? 0) + n - t;
  return n;
};

function cCanvas(
  src: Uint8ClampedArray,
  x0: number,
  y0: number,
  w: number,
  h: number,
): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (g) {
    const img = g.createImageData(w, h);
    for (let y = 0; y < h; y++)
      img.data.set(src.subarray(((y0 + y) * CW + x0) * 4, ((y0 + y) * CW + x0 + w) * 4), y * w * 4);
    g.putImageData(img, 0, 0);
  }
  return c;
}

/** Нарисовать кадр запроса (без зеркала, вспышки, просвета, свечения затылка). */
function cBuild(q: CReq, r: CRig, ps: CPose & { legs?: number }): CFrame {
  const t0 = performance.now();
  const h = q.hk / 100;
  const time = cReqTime(q);
  const loop = LOOP_S[q.tech] ?? 0;
  const st = loop ? time * loop : time;
  rClear();
  let tm = cMark('clear', t0);
  const yaw = q.yq * (Math.PI / 8) + (ps.legs ?? 0);
  RX.cs = Math.cos(yaw);
  RX.sn = Math.sin(yaw);
  RX.clip = r.sink > 0.01;
  RX.heat = r.heat;
  RX.t = st;
  RX.wave = loop ? Math.max(1, Math.round(0.9 * loop)) / loop : 0.9;
  RX.melt = r.melt > 0.001 ? r.melt : -1;
  RX.mz = 74 - r.melt * 86;
  const sk = cSkel(r);
  RX.bodyD = cProj(sk.chest)[2];
  if (RX.melt >= 0) cSkeleton(sk);
  tm = cMark('pre', tm);
  cBody(sk, r);
  tm = cMark('body', tm);
  if (sk.rock) cRockSeams(sk.rock);
  const kb = 1 - r.thin * 0.14;
  cBones(sk, r, kb);
  // Коленные чашечки — кость спереди колена.
  for (const kn of [sk.knA, sk.knB]) dPut(vAdd(kn, [4.2, 0, 0.6]), tone(BONE, 0.6), 2.4);
  tm = cMark('bones', tm);
  const eye = cFace(sk, r, q.ph);
  const nape = cNapeOf(sk);
  const napePx = cNapePixels(nape, ps.nape ? 1.9 : 1.6);
  tm = cMark('face', tm);
  const p = rFinishCol();
  if (r.rim > 0.02)
    cRim(p, q.ph === 3 || q.v === 3 ? EMBER[1] : q.v === 1 ? hx('#eef4ff') : COL_HALO, r.rim);
  tm = cMark('finish', tm);
  // След: кисти в прошлые мгновения, по свежести.
  if (ps.trail) {
    const tr: Record<string, [number, number, number, number][]> = { A: [], B: [], a: [], b: [] };
    for (let i = 0; i <= 9; i++) {
      const s = time - i / 96;
      if (s < 0) break;
      const pp = i === 0 ? ps : cPoseAt(q.tech, s, h, q.v);
      const sk2 = i === 0 ? sk : cSkel(pp.r);
      const y2 = q.yq * (Math.PI / 8) + (pp.legs ?? 0);
      RX.cs = Math.cos(y2);
      RX.sn = Math.sin(y2);
      for (const [arm, el, wr, open] of [
        ['A', sk2.elA, sk2.wrA, pp.r.ah],
        ['B', sk2.elB, sk2.wrB, pp.r.bh],
      ] as ['A' | 'B', V3, V3, number][]) {
        if (!ps.trail.includes(arm)) continue;
        const dir = vNorm(vSub(wr, el));
        const [u, v, d] = cProj(vAdd(wr, vMul(dir, open > 0.5 ? 4 : 2.3)));
        tr[arm].push([u, v, d, open > 0.5 ? 4.6 : 4.4]);
      }
      // Стопа: падает с разгоном — след тянется над ней.
      for (const [ft, an] of [
        ['a', sk2.anA],
        ['b', sk2.anB],
      ] as [string, V3][]) {
        if (!ps.trail.includes(ft)) continue;
        const [u, v, d] = cProj(vAdd(an, [1.6, 0, -1.2]));
        tr[ft].push([u, v, d, 3.6]);
      }
    }
    RX.cs = Math.cos(yaw);
    RX.sn = Math.sin(yaw);
    for (const k of ['A', 'B', 'a', 'b'])
      if (tr[k].length > 1) cSmear(p, tr[k], k === k.toUpperCase());
  }
  if (ps.dirt) cCrumbs(p, [sk.shA, sk.shB, vAdd(sk.head, [0, 0, 6]), sk.chest], time, 14, 3);
  if (ps.crumbs && sk.rock) cCrumbs(p, [vAdd(sk.rock, [0, 0, -7])], time, 6, 9);
  if (ps.drips) cDrips(p, [sk.wrA, sk.wrB, sk.elA, sk.elB, sk.chest, sk.head], st, 7);
  tm = cMark('fx', tm);
  cSteam(p, sk, r, st, q.ph === 1, loop);
  tm = cMark('steam', tm);
  if (r.stars > 0.05) {
    const [u, v] = cProj(vAdd(sk.head, [0, 0, 10]));
    const sp = new Px(CW, CH);
    stars(sp, Math.round(u), Math.round(v), 9, Math.floor(time * 8) % 4);
    for (let i = 0; i < sp.data.length; i += 4)
      if (sp.data[i + 3]) {
        const j = i / 4;
        litPut(j % CW, Math.floor(j / CW), [sp.data[i], sp.data[i + 1], sp.data[i + 2], 255]);
      }
  }
  tm = cMark('fx2', tm);
  // Рамка рисунка: тело, свет, пар (рамка росла по ходу рисования) и затылок.
  let x0 = DB.x0;
  let y0 = DB.y0;
  let x1 = DB.x1;
  let y1 = DB.y1;
  const pd = p.data;
  for (let k = 0; k < napePx.length; k++) {
    const i = napePx[k] >> 2;
    const x = i % CW;
    const y = Math.floor(i / CW);
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  if (x1 < 0) {
    x0 = CAX;
    y0 = CAY;
    x1 = CAX;
    y1 = CAY;
  }
  const w = x1 - x0 + 1;
  const hh = y1 - y0 + 1;
  tm = cMark('bbox', tm);
  const img = cCanvas(pd, x0, y0, w, hh);
  const lit = RX.lit ? cCanvas(RL, x0, y0, w, hh) : null;
  // Пиксели затылка — в рамку обрезанного кадра.
  const nape2 = new Int32Array(napePx.length);
  for (let k = 0; k < napePx.length; k++) {
    const i = napePx[k] >> 2;
    nape2[k] = (((Math.floor(i / CW) - y0) * w + (i % CW) - x0) << 2) | (napePx[k] & 3);
  }
  const cut: number[] = [];
  if (nape.face > -0.15) {
    const big = 1.6;
    const add = (x: number, y: number, lv: number) => {
      const xx = Math.floor(x) - x0;
      const yy = Math.floor(y) - y0;
      if (xx >= 0 && yy >= 0 && xx < w && yy < hh) cut.push(((yy * w + xx) << 2) | lv);
    };
    for (let s = -1; s <= 1; s += 0.08) add(nape.x + s * 3 * big, nape.y + s * 2 * big, 1);
    add(nape.x + 3 * big + 1, nape.y + 2 * big + 1, 2);
    add(nape.x - 3 * big - 1, nape.y - 2 * big, 2);
  }
  // Ход кадра: вперёд по взгляду, вверх, сжатие, наклон (в профиль).
  const fr: MobFrame = {
    img,
    ax: CAX - x0,
    ay: CAY - y0,
    eye: eye ? [eye[0] - x0, eye[1] - y0] : null,
    lit,
    dx: r.tdx * Math.cos(yaw),
    dy: r.tdx * Math.sin(yaw) * KP - r.tdy,
    sx: r.tsx,
    sy: r.tsy,
    rot: r.trot * Math.cos(yaw),
    still: true,
    shadow: Math.round(24 * cClamp(1 - r.sink / 70, 0, 1) * (1 - r.melt * 0.5)),
  };
  if (r.alpha < 0.999) fr.alpha = Math.max(0, r.alpha);
  cMark('canvas', tm);
  const dt = performance.now() - t0;
  COL_STATS.built++;
  COL_STATS.ms += dt;
  COL_STATS.max = Math.max(COL_STATS.max, dt);
  return { fr, nape: nape2, cut: Int32Array.from(cut), r, ghost: !!ps.ghost };
}

function cMirrorCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
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

function cMirrorIdx(a: Int32Array, w: number): Int32Array {
  const o = new Int32Array(a.length);
  for (let k = 0; k < a.length; k++) {
    const i = a[k] >> 2;
    const x = i % w;
    const y = Math.floor(i / w);
    o[k] = ((y * w + (w - 1 - x)) << 2) | (a[k] & 3);
  }
  return o;
}

/** Кадр по запросу (без зеркала) — из кеша или нарисовать. */
function cBase(q: CReq, blendFrom: CRig | null): CFrame {
  const key = 'b|' + cKeyOf(q);
  const hit = CFR.get(key);
  if (hit) return hit;
  const ps = cPoseOf(q);
  let r = ps.r;
  if (q.bl && blendFrom) r = cLerp(blendFrom, r, eIO(q.bl / 5));
  return CFR.set(key, cBuild(q, r, { ...ps, r }));
}

/** Кадр в зеркале (смотрит влево). */
function cFlipped(q: CReq, blendFrom: CRig | null): CFrame {
  const key = 'm|' + cKeyOf(q);
  const hit = CFR.get(key);
  if (hit) return hit;
  const b = cBase(q, blendFrom);
  const w = b.fr.img.width;
  return CFR.set(key, {
    ...b,
    fr: {
      ...b.fr,
      img: cMirrorCanvas(b.fr.img),
      lit: b.fr.lit ? cMirrorCanvas(b.fr.lit) : null,
      eye: b.fr.eye ? [w - 1 - b.fr.eye[0], b.fr.eye[1]] : null,
      ax: w - b.fr.ax,
      dx: -(b.fr.dx ?? 0),
      rot: -(b.fr.rot ?? 0),
    },
    nape: cMirrorIdx(b.nape, w),
    cut: cMirrorIdx(b.cut, w),
  });
}

/** Свет кадра со свечением затылка (герой за спиной) и разрубом. */
function cNapeLit(key: string, cf: CFrame, glow: boolean, cut: boolean): HTMLCanvasElement | null {
  const base = cf.fr.lit ?? null;
  if ((!glow || !cf.nape.length) && (!cut || !cf.cut.length)) return base;
  const k = `n|${key}|${+glow}|${+cut}`;
  const hit = CVAR.get(k);
  if (hit) return hit;
  const w = cf.fr.img.width;
  const h = cf.fr.img.height;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) return base;
  if (base) g.drawImage(base, 0, 0);
  const id = g.getImageData(0, 0, w, h);
  const put = (i: number, col: RGBA, a: number) => {
    const j = i * 4;
    if (j < 0 || j >= id.data.length) return;
    const na = Math.round(a * 255);
    if (id.data[j + 3] > na) return;
    id.data[j] = col[0];
    id.data[j + 1] = col[1];
    id.data[j + 2] = col[2];
    id.data[j + 3] = na;
  };
  if (glow)
    for (let q = 0; q < cf.nape.length; q++) {
      const i = cf.nape[q] >> 2;
      const lv = cf.nape[q] & 3;
      if (lv === 3) put(i, NAPE_HOT, 1);
      else if (lv === 2) put(i, mixc(NAPE_GLOW, NAPE_HOT, 0.35), 1);
      else put(i, NAPE_GLOW, 0.55);
    }
  if (cut)
    for (let q = 0; q < cf.cut.length; q++)
      put(cf.cut[q] >> 2, (cf.cut[q] & 3) === 2 ? hx('#e05040') : hx('#fff8f0'), 1);
  g.putImageData(id, 0, 0);
  return CVAR.set(k, c);
}

function cFlash(key: string, img: HTMLCanvasElement): HTMLCanvasElement {
  const k = 'f|' + key;
  const hit = CVAR.get(k);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d');
  if (g) {
    g.drawImage(img, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = 'rgba(255,255,255,0.8)';
    g.fillRect(0, 0, c.width, c.height);
  }
  return CVAR.set(k, c);
}

/** Герой за ним — тело просвечивает (затылок горит в слое света). */
function cSeeThrough(key: string, img: HTMLCanvasElement): HTMLCanvasElement {
  const k = 'h|' + key;
  const hit = CVAR.get(k);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d');
  if (g) {
    g.globalAlpha = 0.5;
    g.drawImage(img, 0, 0);
  }
  return CVAR.set(k, c);
}

// ---- Рисовальщик: режим мозга → техника и кадр ------------------------------------

/** Что рисовальщик помнит о Колоссе между кадрами (только для рисунка). */
interface CMem {
  flip: boolean;
  yq: number;
  lk: number;
  mode: string;
  prev: string;
  /** Режим только что сменился (первый кадр нового режима). */
  enter: boolean;
  side: number;
  walk: number;
  turnA: number;
  turnV: number;
  face: number;
  now: number;
  /** Разворот: румб и зеркало на старте (держатся до конца отдыха). */
  byq: number;
  bflip: boolean;
  /** Смешивание: техника сменилась — первые 0,2 с из прошлой позы. */
  tech: string;
  rig: CRig | null;
  src: string;
  bFrom: CRig | null;
  bSrc: string;
  bAt: number;
}
const COLMEM = new WeakMap<Mob, CMem>();

const wrapA = (a: number) => {
  let d = a % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};

const FROM_CODE: Record<string, number> = {
  swipe: 1,
  stomp: 2,
  back: 3,
  vent: 4,
  quake: 5,
  throw: 6,
  rings: 7,
};
const CODE_FROM: CTech[] = ['idle', 'swipe', 'stomp', 'back', 'vent', 'quake', 'throw', 'rings'];

function cMemOf(m: Mob, pose: MobPose, face: number): { s: CMem; fresh: boolean } {
  let s = COLMEM.get(m);
  const fresh = !s;
  const c = Math.cos(face);
  if (!s) {
    s = {
      flip: c < 0,
      yq: 0,
      lk: 0,
      mode: pose.mode,
      prev: '',
      enter: true,
      side: 0,
      walk: 0,
      turnA: 0,
      turnV: 0,
      face,
      now: pose.now,
      byq: 0,
      bflip: false,
      tech: '',
      rig: null,
      src: '',
      bFrom: null,
      bSrc: '',
      bAt: -9,
    };
    COLMEM.set(m, s);
  } else s.enter = false;
  const dt = cClamp(pose.now - s.now, 0, 0.1);
  s.now = pose.now;
  // Зеркало — с запасом: анфас и со спины не мигает влево-вправо.
  if (c < -0.15) s.flip = true;
  else if (c > 0.15) s.flip = false;
  const df = wrapA(face - s.face);
  s.face = face;
  s.turnA += Math.abs(df);
  if (dt > 0) s.turnV += (df / dt - s.turnV) * Math.min(1, dt * 8);
  s.walk += Math.hypot(m.vx, m.vy) * 16 * dt;
  if (pose.mode !== s.mode) {
    s.prev = s.mode;
    s.mode = pose.mode;
    s.enter = true;
  }
  return { s, fresh };
}

/** Режим мозга → запрос кадра. */
function colReq(m: Mob, pose: MobPose): { q: CReq; s: CMem; flip: boolean } {
  const face = m.data.vFace ?? m.face;
  const { s, fresh } = cMemOf(m, pose, face);
  const sim = paintSim();
  const phase = m.data.phase ?? 0;
  const h = phase >= 3 ? 1.2 : 1;
  // Румб в зеркальной половине (лицом вправо): ψ ∈ [−π/2, π/2].
  const psi = wrapA(s.flip ? Math.PI - face : face);
  if (fresh || Math.abs(psi - s.yq * (Math.PI / 8)) > Math.PI / 16 + 0.05)
    s.yq = cClamp(Math.round(psi / (Math.PI / 8)), -4, 4);
  const cloaked = phase === 1 && !((m.data.bareT ?? 0) > 0);
  const q: CReq = {
    tech: 'idle',
    f: 0,
    v: 0,
    hk: Math.round(h * 100),
    yq: s.yq,
    ph: phase >= 3 ? 3 : cloaked ? 1 : 0,
    lk: 0,
    fl: 0,
    bl: 0,
    bs: '',
  };
  let flip = s.flip;
  const t = Math.max(0, pose.t);
  const setTech = (tc: CTech, tau: number, v = 0) => {
    q.tech = tc;
    q.v = v;
    q.f = Math.min(cSpan(tc, h).n - 1, Math.floor(tau * CFPS + 1e-6));
  };
  const mode = pose.mode;
  // Разворот держит румб и зеркало старта — тело крутится в рисунке, а не по `face`.
  const lockBack = () => {
    q.yq = s.byq;
    flip = s.bflip;
  };
  // Взгляд на старте разворота. Подсказка листа (`vFace`) — это и есть старт;
  // в игре мозг уже повернул взгляд после удара (на π к концу).
  const backStart = (turned: number) => {
    const f0 = m.data.vFace !== undefined ? face : face + Math.PI * turned;
    s.bflip = Math.cos(f0) < 0;
    s.byq = cClamp(Math.round(wrapA(s.bflip ? Math.PI - f0 : f0) / (Math.PI / 8)), -4, 4);
  };
  let from = 0;
  if (mode === 'recover') from = m.data.vFrom ?? (fresh ? 0 : (FROM_CODE[s.prev] ?? 0));
  if (mode === 'rise') setTech('rise', t);
  else if (mode === 'roar') setTech('roar', t, phase);
  else if (mode === 'swipe') setTech('swipe', t);
  else if (mode === 'stomp') {
    // Нога — со стороны героя (в миг начала): справа — A, слева — B; в зеркале — наоборот.
    if (s.enter || fresh) {
      let v = m.data.vSide ?? 0;
      if (m.data.vSide === undefined && sim) {
        const rel = wrapA(Math.atan2(sim.hero.y - m.y, sim.hero.x - m.x) - m.face);
        v = rel > 0 !== s.flip ? 0 : 1;
      }
      s.side = v;
    }
    setTech('stomp', t, s.side);
  } else if (mode === 'back') {
    // До удара взгляд не меняется (мозг крутит после 0,8 с).
    if (s.enter || fresh) backStart(backTurn(t - COL.back.warn));
    lockBack();
    setTech('back', t);
  } else if (mode === 'vent' || mode === 'quake' || mode === 'throw' || mode === 'rings')
    setTech(mode, t);
  else if (mode === 'kneel') setTech('kneel', t);
  else if (mode === 'dying') setTech('death', t);
  else if (from) {
    const tc = CODE_FROM[from];
    if (tc === 'back') {
      // Отдых после разворота: память пуста (лист, или рисовальщик пропустил
      // разворот) — значит, мозг уже довернул взгляд на π.
      if (fresh || s.prev !== 'back') backStart(1);
      lockBack();
    }
    setTech(tc, (tc === 'back' ? BACK_END : cTimes(tc, h).T) + t, tc === 'stomp' ? s.side : 0);
  } else {
    // Ходьба, разворот на месте или покой; голова ведёт взгляд за героем.
    const speed = Math.hypot(m.vx, m.vy);
    if (pose.anim === 'run' || speed > 0.25) {
      const d = fresh ? pose.now * speed * 16 : s.walk;
      q.tech = 'walk';
      q.f = Math.floor(((d / (WALK_STEP * 2) + (flip ? 0.5 : 0)) % 1) * 16) % 16;
    } else if (m.data.vTurn !== undefined || (!fresh && Math.abs(s.turnV) > 0.3)) {
      // Разворот на месте (подсказка листа `vTurn` — направление; в игре её нет).
      const tv = m.data.vTurn ?? s.turnV;
      const ta = m.data.vTurn !== undefined ? pose.now * 0.9 : s.turnA;
      q.tech = 'turn';
      q.v = tv > 0 !== flip ? 1 : 0;
      q.f = Math.floor(((ta / 0.9) % 1) * 12) % 12;
    } else {
      q.tech = 'idle';
      q.f = Math.floor(pose.now * 10 + m.id * 3.7) % 24;
    }
    if (sim) {
      let rel = wrapA(Math.atan2(sim.hero.y - m.y, sim.hero.x - m.x) - m.face);
      if (flip) rel = -rel;
      // rel > 0 — герой справа от взгляда; поворот головы вправо — со знаком минус.
      const tgt = cClamp(-rel / 0.38, -2, 2);
      if (Math.abs(tgt - s.lk) > 0.75) s.lk = Math.round(tgt);
      q.lk = s.lk;
      // Вздрог от удара героя — в покое и на ходу.
      const fl = m.flash ?? 0;
      if (fl > 0.01) {
        const back = Math.abs(wrapA(Math.atan2(sim.hero.y - m.y, sim.hero.x - m.x) - m.face));
        q.fl = (fl > 0.07 ? 2 : 1) + (back > 2.05 ? 2 : 0);
      }
    }
    // Подсказка листа: вздрог без героя рядом.
    if (m.data.vFl !== undefined) q.fl = m.data.vFl;
  }
  // Смешивание: техника сменилась — 0,2 с из прошлой позы (без рывка ног и рук).
  const tKey = `${q.tech}|${q.v}`;
  if (!fresh && s.tech && tKey !== s.tech && s.rig && s.src) {
    s.bFrom = s.rig;
    s.bSrc = s.src;
    s.bAt = pose.now;
  }
  s.tech = tKey;
  const since = pose.now - s.bAt;
  if (s.bFrom && since < 0.2 && q.tech !== 'rise') {
    q.bl = Math.min(4, 1 + Math.floor((since / 0.2) * 4));
    q.bs = s.bSrc;
  }
  return { q, s, flip };
}

registerMobPainter('f13boss', (m, pose) => {
  const { q, s, flip } = colReq(m, pose);
  const key = cKeyOf(q);
  const cf = flip ? cFlipped(q, s.bFrom) : cBase(q, s.bFrom);
  s.rig = cf.r;
  // Смешанная поза сама источником не бывает: цепочка ключей росла бы без конца.
  s.src = q.bl ? '' : cSrcOf(q);
  const fkey = `${key}|${+flip}`;
  const out: MobFrame = { ...cf.fr };
  // Затылок: герой за спиной — горит; на коленях — горит с любой стороны.
  const kneelNape = q.tech === 'kneel' && q.f > 10 && q.f < 70;
  const back = (m.data.back ?? 0) > 0 || kneelNape;
  const cut = (m.data.cut ?? 0) > 0.12;
  out.lit = cNapeLit(fkey, cf, back, cut);
  // Вспышка удара героя (смерть белым не мигает).
  const flash = pose.flash && (pose.mode !== 'dying' || pose.t < 0.1);
  let img = cf.fr.img;
  if (flash) img = cFlash(fkey, img);
  if (heroHidden(m, 5.4) && pose.mode !== 'dying') img = cSeeThrough(`${fkey}|${+flash}`, img);
  out.img = img;
  if (q.tech === 'death') out.linger = COL_DEATH;
  // Шлейф — на самых быстрых кадрах хлёста, броска, удара.
  if (cf.ghost) out.ghost = { every: 0.03, life: 0.16, tint: '#ffd8c0', alpha: 0.2 };
  // Отдача от удара героя: по направлению удара, с возвратом.
  const fl = m.flash ?? 0;
  if (fl > 0 && pose.mode !== 'dying') {
    const sim = paintSim();
    const age = cClamp(0.12 - fl, 0, 0.12);
    let ux = flip ? 1 : -1;
    let uy = 0;
    if (sim) {
      const dx = m.x - sim.hero.x;
      const dy = m.y - sim.hero.y;
      const d = Math.hypot(dx, dy) || 1;
      ux = dx / d;
      uy = dy / d;
    }
    const big = q.fl >= 3 ? 1.6 : 1;
    const loose = q.tech === 'idle' || q.tech === 'walk' || q.tech === 'turn' ? 1 : 0.4;
    const k = Math.sin((age / 0.12) * Math.PI) * 1.6 * big * loose;
    out.dx = (out.dx ?? 0) + ux * k;
    out.dy = (out.dy ?? 0) + uy * k * 0.6;
  }
  return out;
});

/**
 * Замер стенда: собрать кадры техник заново (кеш сбрасывается) и вернуть
 * минимум, медиану и p90 времени нового кадра, мс. Игра это не зовёт.
 */
export function colBench(reps = 1): { min: number; med: number; p90: number; n: number } {
  const base: CReq = {
    tech: 'idle',
    f: 0,
    v: 0,
    hk: 100,
    yq: 2,
    ph: 0,
    lk: 0,
    fl: 0,
    bl: 0,
    bs: '',
  };
  const ts: number[] = [];
  for (let rep = 0; rep < reps; rep++)
    for (const [tech, step] of [
      ['idle', 3],
      ['walk', 2],
      ['swipe', 3],
      ['stomp', 4],
      ['vent', 5],
    ] as [CTech, number][]) {
      const n = cSpan(tech, 1).n;
      for (let f = 0; f < n; f += step) {
        CFR.clear();
        const t0 = performance.now();
        cBase({ ...base, tech, f }, null);
        ts.push(performance.now() - t0);
      }
    }
  ts.sort((a, b) => a - b);
  return {
    min: ts[0],
    med: ts[Math.floor(ts.length / 2)],
    p90: ts[Math.floor(ts.length * 0.9)],
    n: ts.length,
  };
}

// Прогрев: всё, что игрок увидит в первом бою (покой, шаг, ладонь, топот,
// разворот; подъём анфас — последним: он нужен первым, а кеш вытесняет
// давно сделанное). Зеркало и вторая нога дорисуются на лету (зеркало —
// копия холста). Всего 285 кадров при кеше на 330.
registerMobWarm('f13boss', function* () {
  const base: CReq = {
    tech: 'idle',
    f: 0,
    v: 0,
    hk: 100,
    yq: 0,
    ph: 0,
    lk: 0,
    fl: 0,
    bl: 0,
    bs: '',
  };
  const list: [CTech, number, number, boolean][] = [
    ['idle', 0, 0, false],
    ['walk', 0, 0, false],
    ['idle', 0, 4, false],
    ['walk', 0, 4, false],
    ['swipe', 0, 0, false],
    ['stomp', 0, 0, false],
    ['back', 0, 0, false],
    ['rise', 0, 4, false],
  ];
  for (const [tech, v, yq, both] of list) {
    const n = cSpan(tech, 1).n;
    for (let f = 0; f < n; f++) {
      const q = { ...base, tech, v, yq, f };
      cBase(q, null);
      yield f;
      if (both) {
        cFlipped(q, null);
        yield f;
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Ползун: на четвереньках, голова у самой земли, длинные руки вместо
// передних лап. Затылок — на загривке, его видно сверху со спины.
// ---------------------------------------------------------------------------

const CRAWL_SKIN = tn('#3e2a22', '#7a5644', '#b08a6a', '#d8b490');

function drawCrawler(
  view: View,
  step: number,
  mode: string,
  back: boolean,
  cut: boolean,
  t: number,
): Built {
  const W = 40;
  const p = new Px(W, 30);
  const ay = 27;
  const cx = W / 2;
  const S = CRAWL_SKIN;
  const dark: Tones = [S[0], S[0], S[1], S[2]];
  const HAIR = HAIR_BLACK;
  const ph = ((step + 0.5) / 4) * TAU;
  const lunge = mode === 'lunge';
  const aim = mode === 'lungeAim';
  const low = aim ? 2 : 0;
  void t;
  if (view === 'side') {
    // Тело вдоль, голова вправо.
    const sw = Math.sin(ph) * 3;
    // Дальние конечности.
    limb(p, cx - 7, ay - 9 + low, cx - 9 - sw, ay - 1, 2, 1.5, dark);
    limb(p, cx + 6, ay - 10 + low, cx + 10 + sw + (lunge ? 5 : 0), ay - 1, 1.8, 1.3, dark);
    shadeEll(p, cx - 2, ay - 10 + low, 11, 5, S);
    shadeEll(p, cx - 9, ay - 9 + low, 5, 4.5, S, -0.05);
    // Хребет.
    for (let x = Math.round(cx - 10); x < Math.round(cx + 6); x += 2)
      p.set(x, Math.round(ay - 14 + low), tone(S, 0.1));
    // Ближние.
    limb(p, cx - 7, ay - 8 + low, cx - 5 + sw, ay - 1, 2.2, 1.6, S);
    limb(p, cx + 6, ay - 9 + low, cx + 8 - sw + (lunge ? 6 : 0), ay - 1, 2, 1.4, S);
    // Голова низко впереди — огромная, с копной волос.
    const hx0 = cx + 12 + (lunge ? 3 : 0);
    const hy0 = ay - 7 + low;
    shadeEll(p, hx0, hy0, 5.5, 5, S);
    shadeEll(p, hx0 - 1.2, hy0 - 3, 5, 3, HAIR);
    for (let x = Math.round(hx0 - 2); x <= Math.round(hx0 + 5); x++) {
      p.set(x, Math.round(hy0 + 2), MOUTH);
      if (x % 2 === 0) p.set(x, Math.round(hy0 + 1), TEETH);
    }
    if (aim || lunge) p.ell(hx0 + 3, hy0 + 2.5, 2, 1.5, MOUTH);
    p.set(Math.round(hx0 + 2), Math.round(hy0 - 1), hx('#fff6d0'));
    nape(p, Math.round(cx + 6), Math.round(ay - 13 + low), back, cut);
    p.outline(INK);
    return { p, ax: Math.round(cx), ay, eye: [Math.round(hx0 + 2), Math.round(hy0 - 1)] };
  }
  if (view === 'front') {
    // Ползёт к нам: зад горбом за плечами, голова ниже плеч между руками.
    const liftL = Math.max(0, Math.sin(ph)) * 3;
    const liftR = Math.max(0, -Math.sin(ph)) * 3;
    shadeEll(p, cx, ay - 20 + low, 6, 4, dark);
    shadeEll(p, cx, ay - 16 + low, 8.5, 5, S, 0.05);
    for (const s of [-1, 1]) {
      const lift = s < 0 ? liftL : liftR;
      const spread = lunge ? 14 : 12.5;
      limb(p, cx + s * 7, ay - 14 + low, cx + s * spread, ay - 1 - lift, 2.4, 1.7, S);
      shadeEll(p, cx + s * spread, ay - 1 - lift, 2.3, 1.3, S);
      shadeEll(p, cx + s * 6.5, ay - 14 + low, 4.2, 3.6, S);
    }
    const hy0 = ay - 8 + low + (lunge ? 2 : 0);
    shadeEll(p, cx, hy0, 6.5, 5.5, S);
    // Копна волос сверху — человеческое в нечеловеческом.
    shadeEll(p, cx, hy0 - 4, 6.2, 2.6, HAIR);
    for (let x = Math.round(cx - 6); x <= Math.round(cx + 6); x += 2)
      p.set(x, Math.round(hy0 - 1.5 + (x % 4 === 0 ? 1 : 0)), HAIR[1]);
    // Глаза навыкате и пасть до ушей.
    for (const s of [-1, 1]) {
      p.ell(cx + s * 2.6, hy0 - 0.5, 1.4, 1.2, hx('#f4ecdc'));
      p.set(Math.round(cx + s * 2.6), Math.round(hy0 - 0.5), hx('#1a0a06'));
    }
    const open = aim || lunge ? 2 : 0;
    for (let x = Math.round(cx - 5); x <= Math.round(cx + 5); x++) {
      const k = (x - cx) / 5;
      const y = Math.round(hy0 + 2.5 - k * k * 2);
      for (let o = 0; o <= open; o++) p.set(x, y + o, MOUTH);
      if (Math.abs(k) < 0.9) {
        p.set(x, y - 1, x % 2 ? TEETH : mixc(TEETH, hx('#b8a888'), 0.4));
        if (open) p.set(x, y + open + 1, x % 2 ? mixc(TEETH, hx('#b8a888'), 0.4) : TEETH);
      }
    }
    p.outline(INK);
    return { p, ax: Math.round(cx), ay, eye: [Math.round(cx - 2.6), Math.round(hy0 - 0.5)] };
  }
  // Уползает от нас: зад, колени в землю, ступни пятками вверх; вдали — плечи,
  // между ними загривок с затылком, над ним макушка.
  const liftL = Math.max(0, Math.sin(ph)) * 2;
  const liftR = Math.max(0, -Math.sin(ph)) * 2;
  shadeEll(p, cx, ay - 22 + low, 4.8, 3.4, HAIR);
  for (const s of [-1, 1]) {
    limb(p, cx + s * 6, ay - 17 + low, cx + s * 11, ay - 12, 2.2, 1.6, dark);
    shadeEll(p, cx + s * 5.5, ay - 18 + low, 4, 3.2, S, 0.05);
  }
  shadeEll(p, cx, ay - 13, 8.5, 5.5, S);
  for (let y = Math.round(ay - 17); y < ay - 9; y += 2) p.set(Math.round(cx), y, tone(S, 0.12));
  for (const s of [-1, 1]) {
    const lift = s < 0 ? liftL : liftR;
    limb(p, cx + s * 4, ay - 8, cx + s * 8, ay - 1 - lift, 2.6, 2, S);
    shadeEll(p, cx + s * 3.6, ay - 8, 4.6, 4, S, -0.05);
    // Ступня пяткой к нам.
    shadeEll(
      p,
      cx + s * 5.5,
      ay - 2.5 - lift,
      1.8,
      1.4,
      tn('#5a3a2a', '#a07a5a', '#d0aa84', '#f0d0a8'),
    );
  }
  nape(p, Math.round(cx), Math.round(ay - 19 + low), back, cut);
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
  const p = new Px(22, 20);
  const ay = 17;
  const cx = 11;
  const B = CROW_T;
  const sleep = mode === 'sleep';
  const swoop = mode === 'swoop';
  const by = sleep ? ay - 3 : ay - 8;
  // Крыло: основание на спине, кончик — веер маховых.
  const wingAt = (dy: number, near: boolean) => {
    const t = near ? B : ([B[0], B[0], B[1], B[2]] as Tones);
    const tipX = cx - 3;
    const tipY = by + dy;
    poly(
      p,
      [
        [cx - 2, by - 0.5],
        [cx + 2.5, by - 0.5],
        [tipX + 1, tipY],
        [tipX - 3, tipY + (dy < 0 ? 1.5 : -1.5)],
      ],
      t[2],
    );
    // Маховые — зубцами по заднему краю.
    for (let i = 0; i < 4; i++) {
      const k = i / 3;
      const x = tipX - 3 + k * 4.5;
      const y = tipY + (dy < 0 ? 1.5 : -1.5) * (1 - k) + (by - tipY) * k * 0.35;
      p.set(Math.round(x - 1), Math.round(y + (dy < 0 ? 1 : -1)), t[1]);
    }
    stroke(p, cx + 1.5, by - 0.5, tipX + 1, tipY, t[3]);
  };
  const FR = [
    [-8, -5],
    [-5, 3],
    [-1, 6],
    [-5, 3],
  ];
  if (!sleep && !swoop) wingAt(FR[wing % 4][0], false);
  // Хвост клином.
  poly(
    p,
    [
      [cx - 3, by],
      [cx - 8, by - 1 + (sleep ? 2 : 0)],
      [cx - 8, by + 2],
    ],
    B[1],
  );
  shadeEll(p, cx, by, swoop ? 4.8 : 4, 2.6, B);
  shadeEll(p, cx + 3.8, by - 1.6, 2.2, 2, B, 0.05);
  // Клюв и глаз.
  p.set(cx + 6, by - 1, hx('#6a6470'));
  p.set(cx + 7, by - 1, hx('#9a94a0'));
  p.set(cx + 6, by, hx('#4a4450'));
  p.set(cx + 4, by - 2, hx('#ffcc40'));
  if (swoop) {
    // Пике: крылья сложены назад.
    poly(
      p,
      [
        [cx - 3, by - 1.5],
        [cx + 3, by - 1.5],
        [cx - 7, by + 0.5],
      ],
      B[2],
    );
    stroke(p, cx + 2, by - 1.5, cx - 6, by, B[3]);
  } else if (!sleep) wingAt(FR[wing % 4][1], true);
  else {
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
  const ph = ((step + 0.5) / 4) * TAU;
  const sw = run ? Math.sin(ph) * 2.5 : 0;
  const PANTS = tn('#141014', '#2a2228', '#3e343a', '#56484e');
  // Ноги.
  limb(p, cx - 1, ay - 6, cx - 1 - sw, ay - 0.5 - (run && sw < 0 ? 1 : 0), 1.2, 1, PANTS);
  limb(p, cx + 1, ay - 6, cx + 1 + sw, ay - 0.5 - (run && sw > 0 ? 1 : 0), 1.2, 1, PANTS);
  // Мешок за спиной, золото блестит из горловины.
  shadeEll(p, cx - 4, ay - 10, 3.8, 4, SACK);
  stroke(p, cx - 6, ay - 13, cx - 2, ay - 13, SACK[0]);
  p.set(cx - 5, ay - 14, hx('#ffd040'));
  p.set(cx - 3, ay - 14, hx('#fff2a0'));
  // Плащ.
  poly(
    p,
    [
      [cx - 2.5, ay - 13],
      [cx + 3, ay - 13],
      [cx + 3.8, ay - 5],
      [cx - 3, ay - 5],
    ],
    (x, y) => tone(CLOAK, 0.62 - (x - cx) * 0.07 - (y - (ay - 13)) * 0.03),
  );
  // Пояс с мотком верёвки.
  stroke(p, cx - 2.5, ay - 7, cx + 3.5, ay - 7, hx('#2a1c10'));
  p.ell(cx + 2.5, ay - 7, 1.3, 1.1, hx('#b89a62'));
  p.set(Math.round(cx + 2.5), ay - 7, hx('#6a5030'));
  // Шарф.
  stroke(p, cx - 2, ay - 12.5, cx + 3, ay - 12.5, hx('#8a2a20'));
  // Капюшон: круглый, лицо в тени, два огонька глаз.
  shadeEll(p, cx + 0.5, ay - 15.5, 3.4, 3.2, CLOAK);
  p.ell(cx + 1.6, ay - 15, 1.7, 1.5, hx('#120c08'));
  p.set(cx + 1, ay - 15, hx('#ffd040'));
  p.set(cx + 2, ay - 15, hx('#ffd040'));
  if (mode === 'zip') {
    // Крюкомёт вверх, трос натянут.
    stroke(p, cx + 3, ay - 12, cx + 7, ay - 20, hx('#8a8490'));
    p.set(cx + 7, ay - 21, hx('#c4c8cc'));
    p.set(cx + 6, ay - 21, hx('#c4c8cc'));
  } else {
    p.set(cx + 3, ay - 9, hx('#8a8f94'));
    p.set(cx + 4, ay - 9, hx('#c4c8cc'));
  }
  p.outline(INK);
  return { p, ax: cx, ay, eye: [cx + 1, ay - 15] };
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

// ---------------------------------------------------------------------------
// Клетки города: брусчатка, площадь, мозаика арены, доски, камень Стены;
// провал в сток, канал, обрыв; фасады фахверка, черепичные крыши, горелые
// дома, Великая стена, ворота, колокольня, лавки. Рисунок по МИРОВЫМ
// координатам — камни и черепица не рвутся на стыке клеток.
// ---------------------------------------------------------------------------

const MK = F13_MARK;
const COBBLE = tn('#29231f', '#4a413a', '#6c6158', '#92867a');
const PLAZA = tn('#3a322a', '#6a5d4c', '#9a896e', '#c6b392');
const ASHT = tn('#141211', '#282422', '#3c3632', '#58504a');
const PLANK = tn('#24160c', '#553820', '#855c36', '#ae824e');
const GRANITE = tn('#20232a', '#3c4149', '#5c626b', '#838a93');
const MORTAR = hx('#1a1613');
const PLASTER = tn('#4a3e30', '#8a7658', '#b8a07a', '#dcc8a0');
const TIMBER = tn('#170e08', '#34200f', '#523420', '#724c2c');
const FOUND = tn('#24211e', '#403b36', '#5e5750', '#7e766c');
const WALLST = tn('#27272a', '#46464a', '#6a6864', '#938e86');
const ROOFS: Tones[] = [
  tn('#341208', '#682816', '#9c4426', '#c8683a'),
  tn('#171b23', '#2c3440', '#48525f', '#697584'),
  tn('#26170d', '#4a2e1c', '#6e4629', '#94663e'),
];
const CHAR = tn('#0c0908', '#1c1512', '#2e2420', '#443630');
const WATER = tn('#06121a', '#0e2632', '#1a4050', '#3a6e7e');
const MOSS = hx('#4a5a2a');

const DEEP_MARKS: Set<number> = new Set([MK.proval, MK.canal, MK.drop, MK.rift]);
const FLOOR_BASE: number[] = [MK.cobble, MK.plaza, MK.rampart, MK.planks, MK.mosaic, MK.ash];

/** Клетка 16×16 с пикселем по мировым координатам. */
function cellOf(c: CellCtx, f: (X: number, Y: number, x: number, y: number) => RGBA | null): Px {
  const p = new Px(16, 16);
  const X0 = c.wx * 16;
  const Y0 = c.wy * 16;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, f(X0 + x, Y0 + y, x, y));
  return p;
}

/**
 * Брусчатка — квадратные шашки 5×5 со швом, ряды вразбежку, углы скруглены
 * швом: иначе мостовая читается кирпичной стеной (так и было в первом круге).
 */
function cobbleAt(X: number, Y: number, t: Tones = COBBLE, seed = 0): RGBA {
  const r = Math.floor(Y / 5);
  const off = r % 2 ? 3 : 0;
  const u = X + off;
  const s = Math.floor(u / 5);
  const lx = u - s * 5;
  const ly = Y - r * 5;
  const h = hash(s, r, 13 + seed);
  // Шов: песок с тенью.
  if (ly === 4 || lx === 4) return hash(X, Y, 3) < 0.25 ? mixc(MORTAR, hx('#4a3e30'), 0.5) : MORTAR;
  // Скруглённые углы.
  if ((lx === 0 || lx === 3) && (ly === 0 || ly === 3)) return mixc(MORTAR, tone(t, 0.3), 0.5);
  let l = 0.36 + h * 0.34;
  if (ly === 0 || lx === 0) l += 0.16;
  if (ly === 3 || lx === 3) l -= 0.14;
  if (hash(X, Y, 7) < 0.06) l -= 0.1;
  const c = tone(t, l);
  // Камни разные: одни теплее, другие серо-синие.
  const hue = hash(r, s, 29 + seed);
  if (hue < 0.25) return mixc(c, hx('#5a6470'), 0.22);
  if (hue > 0.8) return mixc(c, hx('#7a5a40'), 0.2);
  return c;
}

/** Плиты площади 8×8, через одну — тёмные в шахматку. */
function plazaAt(X: number, Y: number): RGBA {
  const sx = Math.floor(X / 8);
  const sy = Math.floor(Y / 8);
  const lx = X - sx * 8;
  const ly = Y - sy * 8;
  if (lx === 0 || ly === 0) return tone(PLAZA, 0.08);
  const dark = (sx + sy) % 2 === 0;
  let l = (dark ? 0.4 : 0.6) + hash(sx, sy, 3) * 0.14;
  if (ly === 1) l += 0.1;
  if (lx === 7 || ly === 7) l -= 0.08;
  if (hash(X, Y, 5) < 0.06) l -= 0.1;
  return tone(PLAZA, l);
}

/** Середина площади Колосса (буква `K`) — для кругов мозаики. */
let mosaicMid: [number, number] | null = null;
function mosaicCenter(): [number, number] | null {
  if (mosaicMid) return mosaicMid;
  const sim = paintSim();
  const k = sim?.world.objs.find((o) => o.kind === 'boss');
  if (!k) return null;
  mosaicMid = [k.x * 16 + 8, k.y * 16 + 8];
  return mosaicMid;
}

/**
 * Мозаика площади Колосса: круги вокруг его места — роза ветров из смальты
 * 2×2. Без вылазки (обложка) — ромбы по клеткам.
 */
function mosaicRadial(X: number, Y: number, c: [number, number]): RGBA {
  const grout = X % 3 === 2 || Y % 3 === 2;
  const dx = X - c[0];
  const dy = (Y - c[1]) * 1.12;
  const d = Math.hypot(dx, dy) / 16;
  const a = Math.atan2(dy, dx);
  const ring = Math.floor(d / 1.5);
  // Лучи розы: восемь, через один длинные.
  const ray = Math.abs(Math.sin(a * 4));
  const ray8 = Math.abs(Math.sin(a * 8));
  let col: RGBA;
  if (d < 1.2) col = MOSAIC_C[3];
  else if (d < 5 && ray < 0.22 * (1 - d / 5) + 0.04) col = MOSAIC_C[3];
  else if (d < 3.5 && ray8 < 0.12) col = MOSAIC_C[2];
  else if (Math.abs(d - Math.round(d / 1.5) * 1.5) < 0.12) col = MOSAIC_C[1];
  else col = ring % 2 ? MOSAIC_C[4] : mixc(MOSAIC_C[4], MOSAIC_C[2], 0.28);
  if (d > 9 && d < 9.4) col = MOSAIC_C[5];
  const j = (hash(Math.floor(X / 3), Math.floor(Y / 3), 21) - 0.5) * 0.18;
  const c1 = mixc(col, j > 0 ? WHITE : INK, Math.abs(j));
  return grout ? mixc(c1, INK, 0.22) : c1;
}

/** Мозаика площади Колосса: ромб терракоты на кремовом, кайма сланцем. */
const MOSAIC_C = [
  hx('#2a2420'),
  hx('#4a5a6a'),
  hx('#9a4a2e'),
  hx('#b8903e'),
  hx('#d8c8a0'),
  hx('#6a2a1e'),
];
function mosaicAt(X: number, Y: number): RGBA {
  // Смальта 2×2 со швом.
  const tx = Math.floor(X / 2);
  const ty = Math.floor(Y / 2);
  if (X % 2 === 1 && Y % 2 === 1) return mixc(MOSAIC_C[0], MOSAIC_C[4], 0.25);
  const cx = (tx % 8) - 3.5;
  const cy = (ty % 8) - 3.5;
  const d = Math.abs(cx) + Math.abs(cy);
  let c: RGBA;
  if (d < 1.2) c = MOSAIC_C[3];
  else if (d < 2.6) c = MOSAIC_C[2];
  else if (d < 3.4) c = MOSAIC_C[5];
  else if (Math.abs(cx) > 3 || Math.abs(cy) > 3) c = MOSAIC_C[1];
  else c = MOSAIC_C[4];
  const j = (hash(tx, ty, 21) - 0.5) * 0.16;
  return mixc(c, j > 0 ? WHITE : INK, Math.abs(j));
}

function rampartAt(X: number, Y: number): RGBA {
  const r = Math.floor(Y / 8);
  const off = r % 2 ? 8 : 0;
  const sx = Math.floor((X + off) / 16);
  const lx = (X + off) % 16;
  const ly = Y % 8;
  if (lx === 0 || ly === 0) return tone(GRANITE, 0.05);
  let l = 0.44 + hash(sx, r, 31) * 0.2;
  if (ly === 1) l += 0.12;
  if (ly === 7) l -= 0.1;
  if (hash(X >> 1, Y >> 1, 9) < 0.08) l -= 0.1;
  return tone(GRANITE, l);
}

function planksAt(X: number, Y: number, vertical: boolean): RGBA {
  const a = vertical ? X : Y;
  const b = vertical ? Y : X;
  const board = Math.floor(a / 4);
  const la = a - board * 4;
  const seg = Math.floor((b + hash(board, 3) * 24) / 24);
  const lb = Math.floor(b + hash(board, 3) * 24) % 24;
  if (la === 0) return tone(PLANK, 0.02);
  if (lb === 0) return tone(PLANK, 0.1);
  let l = 0.42 + hash(board, seg, 7) * 0.24;
  if (la === 1) l += 0.12;
  if (la === 3) l -= 0.1;
  if ((lb === 2 || lb === 21) && la === 2) return hx('#2a221c');
  if (hash(a, Math.floor(b / 3), 11) < 0.1) l -= 0.08;
  return tone(PLANK, l);
}

/** Какой пол под буквой движка (лифт, сундук, столб): по соседям. */
function baseOf(c: CellCtx): number {
  if (FLOOR_BASE.includes(c.mark)) return c.mark;
  const cnt = new Map<number, number>();
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      let m = c.markAt(dx, dy);
      if (m >= MK.pWalker && m <= MK.pCrawler) m = MK.cobble;
      if (
        m === MK.pad ||
        m === MK.drain ||
        m === MK.crack ||
        m === MK.blood ||
        m === MK.weeds ||
        m === MK.rubble
      )
        m = MK.cobble;
      if (m === MK.breach || m === MK.crater || m === MK.sealed) m = MK.cobble;
      if (m === MK.scorch || m === MK.cracking) m = MK.mosaic;
      if (m === MK.vent || m === MK.fault) m = MK.mosaic;
      if (!FLOOR_BASE.includes(m)) continue;
      cnt.set(m, (cnt.get(m) ?? 0) + 1);
    }
  let best = 0;
  let bn = 0;
  for (const [m, n] of cnt)
    if (n > bn) {
      best = m;
      bn = n;
    }
  return best;
}

function floorBase(c: CellCtx, base: number): Px | null {
  switch (base) {
    case MK.plaza:
      return cellOf(c, (X, Y) => plazaAt(X, Y));
    case MK.mosaic: {
      const mid = mosaicCenter();
      return cellOf(c, (X, Y) => (mid ? mosaicRadial(X, Y, mid) : mosaicAt(X, Y)));
    }
    case MK.rampart:
      return cellOf(c, (X, Y) => rampartAt(X, Y));
    case MK.planks:
      return cellOf(c, (X, Y) => planksAt(X, Y, false));
    case MK.ash:
      return cellOf(c, (X, Y) => {
        const b = cobbleAt(X, Y, ASHT, 3);
        const h = hash(X, Y, 44);
        if (h < 0.012) return hx('#ff7a2a');
        if (h < 0.08) return mixc(b, hx('#8a8078'), 0.4);
        return b;
      });
    case MK.cobble:
      return cellOf(c, (X, Y) => cobbleAt(X, Y));
    default:
      return null;
  }
}

/** Мелочь поверх пола: одна функция на камни, кровь, траву, трещины. */
function scatter(p: Px, c: CellCtx, kind: number): void {
  const s = c.wx * 7919 + c.wy * 104729;
  if (kind === MK.rubble || kind === MK.breach || kind === MK.sealed) {
    const n = kind === MK.rubble ? 3 : 6;
    for (let i = 0; i < n; i++) {
      const x = 2 + hash(i, s) * 12;
      const y = 3 + hash(s, i) * 11;
      const r = 1 + hash(i, s, 3) * (kind === MK.rubble ? 1.4 : 2.2);
      const brick = hash(i, s, 5) < 0.35;
      const t = brick ? tn('#3a1a12', '#6e3222', '#9a4a32', '#c06a4a') : COBBLE;
      shadeEll(p, x, y, r + 0.4, r, t);
      p.set(Math.round(x + r * 0.4), Math.round(y + r), INK);
    }
    if (kind === MK.sealed) {
      // Валун вбит в пролом: трещины от него.
      shadeEll(p, 8, 8, 6, 5, tn('#221e1a', '#443c34', '#6e6254', '#988a76'));
      stroke(p, 3, 10, 6, 7, hx('#2a241e'));
      stroke(p, 11, 5, 13, 3, hx('#2a241e'));
    }
  } else if (kind === MK.blood) {
    const n = 2 + Math.floor(hash(s, 4) * 3);
    for (let i = 0; i < n; i++) {
      const x = 3 + hash(i, s, 9) * 10;
      const y = 3 + hash(s, i, 9) * 10;
      const r = 1 + hash(i, s, 2) * 2;
      p.ell(x, y, r * 1.3, r, alpha(hx('#5a0e0c'), 0.85));
      p.set(Math.round(x - r * 0.4), Math.round(y - r * 0.3), alpha(hx('#8a1a14'), 0.9));
      if (hash(i, s, 6) < 0.6) stroke(p, x + r, y, x + r + 2, y + 1, alpha(hx('#5a0e0c'), 0.7));
    }
  } else if (kind === MK.crack || kind === MK.cracking || kind === MK.fault) {
    // Трещина тянется к соседу с той же трещиной — сеть по полу.
    const same = (dx: number, dy: number) => {
      const m = c.markAt(dx, dy);
      return m === MK.crack || m === MK.cracking || m === MK.fault || m === MK.rift;
    };
    const hot = kind === MK.cracking;
    const col = hot ? hx('#ff8a2a') : kind === MK.fault ? hx('#1a0c08') : hx('#1c1814');
    const ends: [number, number][] = [];
    if (same(-1, 0)) ends.push([0, 7 + Math.round(hash(c.wx, c.wy) * 2)]);
    if (same(1, 0)) ends.push([15, 7 + Math.round(hash(c.wx + 1, c.wy) * 2)]);
    if (same(0, -1)) ends.push([7 + Math.round(hash(c.wx, c.wy, 1) * 2), 0]);
    if (same(0, 1)) ends.push([7 + Math.round(hash(c.wx, c.wy + 1, 1) * 2), 15]);
    if (!ends.length)
      ends.push([2 + Math.round(hash(s, 1) * 4), 3], [12, 12 + Math.round(hash(s, 2) * 2)]);
    const mx = 6 + hash(s, 7) * 4;
    const my = 6 + hash(s, 8) * 4;
    for (const [ex, ey] of ends) {
      const k1x = (ex + mx) / 2 + (hash(ex, ey, s) - 0.5) * 3;
      const k1y = (ey + my) / 2 + (hash(ey, ex, s) - 0.5) * 3;
      stroke(p, mx, my, k1x, k1y, col);
      stroke(p, k1x, k1y, ex, ey, col);
      if (hot) {
        stroke(p, mx + 1, my, k1x + 1, k1y, alpha(hx('#ffd07a'), 0.8));
      } else if (kind === MK.fault) stroke(p, mx, my + 1, k1x, k1y + 1, alpha(hx('#3a2a20'), 0.8));
    }
  } else if (kind === MK.weeds) {
    for (let i = 0; i < 5; i++) {
      const x = Math.round(1 + hash(i, s, 1) * 14);
      const y = Math.round(3 + hash(s, i, 1) * 12);
      const g1 = hash(i, s) < 0.5 ? hx('#4a6a2a') : hx('#6a8a3a');
      p.set(x, y, g1);
      p.set(x - 1, y - 1, g1);
      p.set(x + 1, y - 1, hx('#3a5020'));
      p.set(x, y - 2, hx('#8aa84a'));
    }
  } else if (kind === MK.drain) {
    // Решётка стока: рама и прутья, под ними темнота.
    p.rect(3, 4, 12, 11, hx('#0a0806'));
    for (let x = 3; x <= 12; x++) {
      p.set(x, 3, hx('#5a5550'));
      p.set(x, 12, hx('#2a2622'));
    }
    for (let y = 3; y <= 12; y++) {
      p.set(2, y, hx('#4a4540'));
      p.set(13, y, hx('#2a2622'));
    }
    for (let x = 4; x <= 11; x += 2)
      for (let y = 4; y <= 11; y++) p.set(x, y, y === 4 ? hx('#8a847c') : hx('#4a4642'));
  } else if (kind === MK.crater) {
    p.ell(8, 8.5, 7, 5.5, hx('#1a1410'));
    p.ell(8, 8, 5.5, 4, hx('#0e0a08'));
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU + hash(i, s) * 0.5;
      const x = 8 + Math.cos(a) * 7.2;
      const y = 8.5 + Math.sin(a) * 5.8;
      p.set(Math.round(x), Math.round(y), tone(COBBLE, 0.7));
      p.set(Math.round(x + Math.cos(a)), Math.round(y + Math.sin(a)), tone(COBBLE, 0.4));
    }
    p.set(6, 7, hx('#ff6a1a'));
    p.set(9, 9, hx('#c04a14'));
  } else if (kind === MK.vent) {
    // Отдушина арены: чугунный круг, под ним — жар.
    p.ell(8, 8, 6.5, 5.5, hx('#1a0c06'));
    p.ell(8, 8.3, 4.5, 3.6, hx('#6a2410'));
    p.ell(8, 8.6, 2.8, 2, hx('#ff8a2a'));
    p.ell(8, 8.6, 1.4, 1, hx('#ffe07a'));
    for (let x = 3; x <= 13; x += 2)
      for (let y = 3; y <= 13; y++) {
        const d = Math.hypot((x - 8) / 6.5, (y - 8) / 5.5);
        if (d < 1) p.set(x, y, y < 8 ? hx('#5a534c') : hx('#2e2a26'));
      }
    for (let a = 0; a < 24; a++) {
      const t = (a / 24) * TAU;
      p.set(
        Math.round(8 + Math.cos(t) * 6.5),
        Math.round(8 + Math.sin(t) * 5.5),
        Math.sin(t) < 0 ? hx('#8a847c') : hx('#2a2622'),
      );
    }
  } else if (kind === MK.pad) {
    // Площадка крюка: клёпаный лист с шевроном — сюда тянет трос.
    p.rect(3, 3, 12, 12, hx('#3a3a3e'));
    for (let x = 3; x <= 12; x++) {
      p.set(x, 3, hx('#7a7a80'));
      p.set(x, 12, hx('#1e1e22'));
    }
    for (let y = 3; y <= 12; y++) {
      p.set(3, y, hx('#6a6a70'));
      p.set(12, y, hx('#1e1e22'));
    }
    for (const [x, y] of [
      [4, 4],
      [11, 4],
      [4, 11],
      [11, 11],
    ])
      p.set(x, y, hx('#a8a8b0'));
    const Y = hx('#d8a030');
    for (let i = 0; i < 4; i++) {
      p.set(5 + i, 6 + i, Y);
      p.set(10 - i, 6 + i, Y);
    }
    for (let i = 0; i < 3; i++) {
      p.set(6 + i, 6 + i - 2, alpha(Y, 0.7));
      p.set(9 - i, 6 + i - 2, alpha(Y, 0.7));
    }
  } else if (kind === MK.scorch) {
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const d = Math.hypot(x - 7.5, y - 7.5) / 8;
        if (d < 1 && hash(x, y, s) < 1 - d * 0.7)
          p.set(x, y, alpha(hx('#0e0806'), 0.75 * (1 - d * 0.5)));
      }
    for (let i = 0; i < 4; i++)
      p.set(Math.round(3 + hash(i, s) * 10), Math.round(3 + hash(s, i) * 10), hx('#ff6a1a'));
  }
}

// --- Глубина.

function deepCell(c: CellCtx): Px {
  const up = !DEEP_MARKS.has(c.markAt(0, -1));
  const lf = !DEEP_MARKS.has(c.markAt(-1, 0));
  const rt = !DEEP_MARKS.has(c.markAt(1, 0));
  const kind = c.mark;
  return cellOf(c, (X, Y, x, y) => {
    if (kind === MK.canal) {
      // Набережная — гранит, потом вода с отблесками.
      if (up && y < 5)
        return y === 4 ? hx('#0a1418') : tone(GRANITE, 0.62 - y * 0.08 + hash(X >> 2, 5) * 0.08);
      if (lf && x < 1) return tone(GRANITE, 0.25);
      if (rt && x > 14) return tone(GRANITE, 0.2);
      const ripple = Math.sin(X * 0.45 + Y * 0.9) + Math.sin(X * 0.13 - Y * 0.37);
      let l = 0.32 + (up ? (y - 5) * 0.012 : 0);
      if (ripple > 1.5) l += 0.3;
      else if (ripple > 1.1) l += 0.15;
      return tone(WATER, l);
    }
    if (kind === MK.drop) {
      // Обрыв со Стены: кладка уходит вниз, внизу темнота поля.
      if (up && y < 9) {
        const r = Math.floor(y / 3);
        const sx = Math.floor((X + (r % 2 ? 4 : 0)) / 8);
        if (y % 3 === 0 || (X + (r % 2 ? 4 : 0)) % 8 === 0) return tone(WALLST, 0.12 - y * 0.012);
        return tone(WALLST, 0.46 - y * 0.05 + hash(sx, r) * 0.08);
      }
      return mixc(hx('#07080a'), hx('#14100c'), hash(X >> 2, Y >> 2, 3) * 0.6);
    }
    if (kind === MK.rift) {
      // Разлом арены: чёрная щель, по краям — жар.
      const edge = Math.min(lf ? x : 99, rt ? 15 - x : 99, up ? y : 99);
      if (edge < 1) return hx('#ffb040');
      if (edge < 3) return mixc(hx('#ff5a18'), hx('#2a0806'), edge / 3);
      return hash(X, Y, 3) < 0.03 ? hx('#ff6a1a') : hx('#0a0302');
    }
    // Провал в сток: слои мостовой и земли, ниже — тьма и вода далеко внизу.
    if (up && y < 10) {
      if (y < 2) return cobbleAt(X, Y);
      if (y < 4)
        return tone(
          tn('#1e1812', '#3a2e22', '#5a4632', '#7a6044'),
          0.5 - (y - 2) * 0.15 + hash(X, 2) * 0.1,
        );
      const band = Math.floor((y - 4) / 2);
      return tone(
        tn('#0e0b09', '#1e1914', '#302820', '#44382c'),
        0.6 - band * 0.18 + hash(X >> 1, band, 4) * 0.12,
      );
    }
    if (lf && x < 2) return mixc(tone(COBBLE, 0.15), hx('#050404'), x / 2);
    if (rt && x > 13) return mixc(tone(COBBLE, 0.1), hx('#050404'), (15 - x) / 2);
    // Далеко внизу — сток: тёмная вода с редкой рябью, у края светлее.
    const far = up ? Math.min(1, (y - 10) / 6) : 1;
    const ripple = Math.sin(X * 0.3 + Y * 0.8) + Math.sin(X * 0.11 - Y * 0.23);
    if (far > 0.5 && ripple > 1.75 && hash(X >> 2, Y >> 1, 12) < 0.35) return hx('#1a2c32');
    return mixc(hx('#0c0b0a'), hx('#081014'), far);
  });
}

// --- Стены.

/**
 * Крыша: черепица рядами по 4 точки, у каждой черепицы низ скруглён тенью,
 * ряды вразбежку; блоки домов разного цвета, между ними — ендова.
 */
function roofAt(X: number, Y: number, eave: number, burnt: boolean): RGBA {
  const bx = Math.floor(X / 96);
  const by = Math.floor(Y / 80);
  const t = burnt ? CHAR : ROOFS[Math.floor(hash(bx, by, 17) * ROOFS.length)];
  const lx = X - bx * 96;
  const ly = Y - by * 80;
  if (lx === 0) return tone(t, 0.02);
  if (lx === 1) return tone(t, 0.75);
  if (ly < 3) return ly === 0 ? tone(t, 0.1) : ly === 1 ? tone(t, 0.9) : tone(t, 0.55);
  const row = Math.floor(Y / 4);
  const tx = X + (row % 2 ? 2 : 0);
  const col = Math.floor(tx / 4);
  const lt = tx - col * 4;
  const ry = Y - row * 4;
  const h = hash(col, row, 5);
  let l = 0.46 + h * 0.18;
  // Верх черепицы в тени предыдущего ряда, низ скруглён.
  if (ry === 0) l -= 0.22;
  if (ry === 3 && (lt === 0 || lt === 3)) l -= 0.3;
  else if (ry === 3) l += 0.06;
  if (lt === 0 && ry < 2) l -= 0.16;
  if (lt === 1 && ry > 0) l += 0.1;
  // Скат к нам освещён сверху-слева.
  l += (48 - Math.abs(lx - 48)) / 500;
  if (eave >= 0) l -= 0.16 * (1 - eave / 16);
  if (burnt) {
    const hole = hash(Math.floor(X / 5), Math.floor(Y / 4), 23);
    if (hole < 0.18) return (X + Y) % 4 === 0 ? hx('#3a2418') : hx('#070504');
    if (hole < 0.2) return hx('#ff6a1a');
  } else if (h > 0.985) return mixc(tone(t, l), MOSS, 0.4);
  return tone(t, l);
}

function facadeAt(c: CellCtx, x: number, y: number, kind: number): RGBA {
  const burnt = kind === MK.burnt;
  const h = hash(c.wx, c.wy, 29);
  // Карниз: тень от черепицы.
  if (y < 2) return y === 0 ? tone(burnt ? CHAR : ROOFS[0], 0.3) : hx('#120c08');
  // Цоколь — камень.
  if (y >= 13) {
    const lx = (c.wx * 16 + x + (y === 14 ? 3 : 0)) % 6;
    if (y === 13 || lx === 0) return tone(FOUND, 0.15);
    return tone(FOUND, 0.5 + hash(Math.floor((c.wx * 16 + x) / 6), y, 3) * 0.2);
  }
  // Фахверк: стойки по краям клетки, балка посередине, раскос в каждом третьем.
  const wood = burnt ? CHAR : TIMBER;
  const wall = burnt ? tn('#1a1512', '#3a302a', '#564a40', '#6e6054') : PLASTER;
  if (x === 0 || x === 15) return tone(wood, x === 0 ? 0.55 : 0.3);
  if (y === 7) return tone(wood, 0.45);
  if (h < 0.3 && y < 7 && Math.abs(x - 1 - (y - 2) * 2.2) < 1) return tone(wood, 0.4);
  // Окно без света или дверь.
  if (kind === MK.house && h > 0.55 && h < 0.8 && x >= 5 && x <= 10 && y >= 3 && y <= 6) {
    if (x === 5 || x === 10) return tone(TIMBER, 0.5);
    return y === 3 ? tone(TIMBER, 0.3) : hx('#0c0a0a');
  }
  if (kind === MK.house && h >= 0.8 && x >= 5 && x <= 10 && y >= 8) {
    if (y === 8 && (x === 5 || x === 10)) return tone(PLASTER, 0.5);
    if (x === 5 || x === 10) return tone(TIMBER, 0.2);
    return tone(PLANK, 0.35 + (x % 2 ? 0.1 : 0) + (x === 9 && y === 11 ? 0.4 : 0));
  }
  if (burnt) {
    // Сажа снизу вверх и выбитое окно с жаром.
    if (x >= 5 && x <= 10 && y >= 3 && y <= 6) return h < 0.5 ? hx('#ff6a1a') : hx('#2a0c06');
    const soot = hash(c.wx * 16 + x, y >> 1, 3) < 0.4 + (13 - y) * 0.03;
    return tone(wall, soot ? 0.15 : 0.45);
  }
  let l = 0.52 + hash(c.wx * 16 + x, y, 41) * 0.08;
  if (y === 2) l -= 0.2;
  if (x === 1) l += 0.08;
  return tone(wall, l);
}

function shopAt(c: CellCtx, x: number, y: number): RGBA {
  const h = hash(c.wx, c.wy, 5);
  const stripe = [hx('#9a2a1e'), hx('#2a5a7a'), hx('#4a6a2a')][Math.floor(h * 3)];
  if (y < 2) return hx('#120c08');
  if (y < 7) {
    // Навес полосами, фестоны внизу.
    if (y === 6 && x % 4 === 2) return hx('#0c0808');
    const on = Math.floor((c.wx * 16 + x) / 3) % 2 === 0;
    const base = on ? stripe : hx('#d8ccb0');
    return mixc(base, INK, y === 2 ? 0.2 : (y - 2) * 0.05);
  }
  if (y < 13) {
    if (y === 7) return hx('#0a0806');
    // Прилавок: ящики и товар.
    if (y >= 10) return tone(PLANK, y === 10 ? 0.7 : 0.4);
    const k = hash(c.wx * 16 + x, 4, 9);
    if (k < 0.25) return hx('#c8902a');
    if (k < 0.4) return hx('#8a2a1a');
    if (k < 0.5) return hx('#5a7a2a');
    return hx('#1a1210');
  }
  return tone(FOUND, y === 13 ? 0.15 : 0.5);
}

function greatWallAt(X: number, Y: number, y: number, face: boolean, kind: number): RGBA {
  if (!face) {
    // Верх Стены: ровная кладка плитами вразбежку, мох по швам. Яркость у
    // плит почти одна — иначе верх читался россыпью светлых кирпичей.
    const r = Math.floor(Y / 8);
    const off = r % 2 ? 8 : 0;
    const sx = Math.floor((X + off) / 16);
    if ((X + off) % 16 === 0 || Y % 8 === 0)
      return hash(X, Y, 2) < 0.2 ? mixc(tone(WALLST, 0.14), MOSS, 0.5) : tone(WALLST, 0.14);
    let l = 0.3 + hash(sx, r, 7) * 0.05 + (hash(X, Y, 3) - 0.5) * 0.06;
    if (Y % 8 === 1) l += 0.06;
    return tone(WALLST, l);
  }
  if (kind === MK.parapet) {
    // Зубцы: чередование, в проёме видно небо (тьму).
    const merlon = Math.floor(X / 5) % 2 === 0;
    if (!merlon && y < 7) return y === 6 ? tone(WALLST, 0.2) : hx('#0a0a0c');
    if (merlon && y === 0) return tone(WALLST, 0.85);
  }
  // Тёсаный камень 8×5 вразбежку, мох у низа, потёки.
  const r = Math.floor(Y / 5);
  const off = r % 2 ? 4 : 0;
  const bx = Math.floor((X + off) / 8);
  if (Y % 5 === 0 || (X + off) % 8 === 0) return tone(WALLST, 0.12);
  let l = 0.42 + hash(bx, r, 3) * 0.2;
  if (Y % 5 === 1) l += 0.12;
  if (hash(X, r, 17) < 0.05) l -= 0.15;
  if (y > 12 && hash(X, Y, 5) < 0.35) return mixc(tone(WALLST, l), MOSS, 0.6);
  if ((X * 7) % 23 === 0 && y > 4) return tone(WALLST, l - 0.18);
  return tone(WALLST, l);
}

function gateAt(X: number, x: number, y: number, topOfGate: boolean): RGBA {
  // Ворота: доски, железные полосы с заклёпками, над ними арка.
  if (topOfGate && y < 4) return y === 3 ? tone(WALLST, 0.2) : tone(WALLST, 0.55 - y * 0.08);
  if (y % 6 === 4 || y % 6 === 5) {
    if (y % 6 === 4 && X % 5 === 2) return hx('#b0aaa0');
    return y % 6 === 4 ? hx('#4a4642') : hx('#2a2826');
  }
  const b = Math.floor(X / 4);
  if (X % 4 === 0) return tone(PLANK, 0.08);
  return tone(PLANK, 0.3 + hash(b, 3) * 0.14 + (x % 4 === 1 ? 0.08 : 0));
}

function towerAt(X: number, Y: number, x: number, y: number, face: boolean): RGBA {
  if (!face) {
    // Шатёр колокольни — сланец чешуёй.
    const row = Math.floor(Y / 3);
    const tx = X + (row % 2 ? 2 : 0);
    let l = 0.4 + hash(tx >> 2, row, 3) * 0.14;
    if (Y % 3 === 2) l -= 0.2;
    return tone(ROOFS[1], l);
  }
  // Круглая кладка: камень плотнее, бойница посередине клетки.
  if ((X >> 4) % 3 === 1 && x >= 7 && x <= 8 && y >= 4 && y <= 10) return hx('#0a0806');
  const r = Math.floor(Y / 4);
  const off = r % 2 ? 3 : 0;
  if (Y % 4 === 0 || (X + off) % 6 === 0) return tone(WALLST, 0.1);
  return tone(WALLST, 0.46 + hash((X + off) >> 3, r, 11) * 0.16 - Math.abs(x - 7.5) * 0.008);
}

function wallCellOf(c: CellCtx): Px | null {
  const kind = c.mark;
  const face = c.open(0, 1) && !DEEP_MARKS.has(c.markAt(0, 1));
  const sideL = c.open(-1, 0) && !DEEP_MARKS.has(c.markAt(-1, 0));
  const sideR = c.open(1, 0) && !DEEP_MARKS.has(c.markAt(1, 0));
  const eaveRow = !face && c.open(0, 2) ? 1 : -1;
  const p = cellOf(c, (X, Y, x, y) => {
    switch (kind) {
      case MK.house:
      case MK.burnt:
        if (face) return facadeAt(c, x, y, kind);
        return roofAt(X, Y, eaveRow > 0 ? y : -1, kind === MK.burnt);
      case MK.window:
        return face ? facadeAt(c, x, y, MK.window) : roofAt(X, Y, -1, false);
      case MK.shop:
        return face ? shopAt(c, x, y) : roofAt(X, Y, -1, false);
      case MK.wall:
      case MK.parapet:
        return greatWallAt(X, Y, y, face, kind);
      case MK.gate:
        return gateAt(X, x, y, c.markAt(0, -1) !== MK.gate);
      case MK.tower:
        return towerAt(X, Y, x, y, face);
      default:
        return null;
    }
  });
  // Торец дома к улице: тёмная грань.
  if (!face && (kind === MK.house || kind === MK.burnt)) {
    for (let y = 0; y < 16; y++) {
      if (sideL) p.set(0, y, hx('#0e0a08'));
      if (sideR) p.set(15, y, hx('#0e0a08'));
    }
    // Свес над фасадом: тень ложится на верх фасада ниже.
    if (eaveRow > 0) for (let x = 0; x < 16; x++) p.set(x, 15, hx('#0c0806'));
  }
  if (face && (kind === MK.wall || kind === MK.parapet || kind === MK.tower)) {
    if (sideL) for (let y = 0; y < 16; y++) p.set(0, y, tone(WALLST, 0.7));
    if (sideR) for (let y = 0; y < 16; y++) p.set(15, y, tone(WALLST, 0.08));
  }
  return p;
}

const DIRT = tn('#1e150f', '#3a2a1e', '#56402e', '#735840');

/**
 * Шов «мостовая — земля» в Предполье: у края, где за клеткой голая земля,
 * камни выбиты неровно, между ними земля. Иначе дорога лежала ровными
 * прямоугольниками, как ковёр.
 */
function frayToDirt(p: Px, c: CellCtx): void {
  const dirt = (dx: number, dy: number) => c.open(dx, dy) && c.markAt(dx, dy) === 0;
  const L = dirt(-1, 0);
  const R = dirt(1, 0);
  const U = dirt(0, -1);
  const D = dirt(0, 1);
  if (!L && !R && !U && !D) return;
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const d = Math.min(L ? x : 99, R ? 15 - x : 99, U ? y : 99, D ? 15 - y : 99);
      if (d > 5) continue;
      // Выбиты целые камни (по шашке 5×5), а не пиксели.
      const X = c.wx * 16 + x;
      const Y = c.wy * 16 + y;
      const r = Math.floor(Y / 5);
      const sId = Math.floor((X + (r % 2 ? 3 : 0)) / 5);
      if (hash(sId, r, 57) < 0.75 - d * 0.14)
        p.set(x, y, tone(DIRT, 0.45 + hash(X >> 1, Y >> 1, 3) * 0.2));
    }
}

function f13Cell(c: CellCtx, area: string): Px | null {
  // Глубина.
  if (DEEP_MARKS.has(c.mark)) return deepCell(c);
  // Стены.
  if (c.mark >= MK.house && c.mark <= MK.window) return wallCellOf(c);
  if (c.mark === 0 && !c.open(0, 0)) return null;
  // Пол: основа по своей метке или по соседям, сверху — мелочь.
  let base = baseOf(c);
  if (!base) {
    // Двор без метки — плиты; у подвала и стока (стены без метки) — земля движка.
    let cellar = false;
    for (let dy = -1; dy <= 1 && !cellar; dy++)
      for (let dx = -1; dx <= 1; dx++)
        if ((dx || dy) && !c.open(dx, dy) && c.markAt(dx, dy) === 0) cellar = true;
    // Предполье у Стены — голая земля движка (поле боя, а не площадь).
    if (cellar || area === F13_WALL) return null;
    base = MK.plaza;
  }
  const p = floorBase(c, base);
  if (!p) return null;
  if (area === F13_WALL && base === MK.cobble) frayToDirt(p, c);
  if (!FLOOR_BASE.includes(c.mark) && c.mark) scatter(p, c, c.mark);
  return p;
}

registerCellPainter(F13_OUTER, (c) => f13Cell(c, F13_OUTER));
registerCellPainter(F13_WALL, (c) => f13Cell(c, F13_WALL));
registerCellPainter(F13_BELL, (c) => f13Cell(c, F13_BELL));

// ---------------------------------------------------------------------------
// Реквизит города. Основание предмета — на 4 точки выше низа картинки,
// картинка встаёт низом на низ своей клетки. Живое (огонь, вода, пар,
// бельё, колокол, пушка) — кадрами по времени, у каждого предмета своя фаза.
// ---------------------------------------------------------------------------

const PROPS = new Map<string, Sprite>();

function spr(
  key: string,
  w: number,
  h: number,
  draw: (p: Px) => void,
  ay = h,
  ax = Math.floor(w / 2),
): Sprite {
  const hit = PROPS.get(key);
  if (hit) return hit;
  const p = new Px(w, h);
  draw(p);
  const s: Sprite = { img: p.canvas(), ax, ay };
  PROPS.set(key, s);
  return s;
}

/** Та же картинка белой вспышкой (удар по ящику). */
function sprFlash(
  key: string,
  w: number,
  h: number,
  flash: boolean,
  draw: (p: Px) => void,
  ay = h,
): Sprite {
  return spr(
    `${key}|${+flash}`,
    w,
    h,
    (p) => {
      draw(p);
      if (flash) {
        const q = p.tint(WHITE, 0.75);
        p.data.set(q.data);
      }
    },
    ay,
  );
}

const phaseOf = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1000;
};
const frameAt = (o: WorldObj, time: number, n: number, fps: number) =>
  Math.floor(time * fps + phaseOf(o.id) * n) % n;

/** Тень под предметом. */
function shadowOn(p: Px, cx: number, cy: number, rx: number, ry = rx * 0.35): void {
  p.ell(cx, cy, rx, ry, alpha(hx('#000000'), 0.35));
}

const IRON = tn('#16161a', '#34343a', '#5a5a62', '#8e8e98');
const BRONZE = tn('#2a1a08', '#6a4418', '#a8742e', '#e0b060');
const STONE = tn('#24211e', '#48423c', '#6e665c', '#9a9084');
const ROPE = tn('#3a2a14', '#6e5430', '#a08050', '#c8aa74');
const FLAME = FIRE;

// --- Столб-якорь и тумба с кольцом: крюк. Готов — по кольцу бежит блик.

function hookReady(o: WorldObj): number {
  const sim = paintSim();
  const st = sim ? f13State(sim) : undefined;
  const hk = st?.hooks.find((h) => h.obj.id === o.id);
  return hk ? hk.cd : 0;
}

function ringGlint(p: Px, cx: number, cy: number, r: number, f: number, on: boolean): void {
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU;
    const x = Math.round(cx + Math.cos(a) * r);
    const y = Math.round(cy + Math.sin(a) * r * 0.8);
    p.set(x, y, Math.sin(a) < 0 ? IRON[3] : IRON[1]);
  }
  if (!on) return;
  const a = (f / 6) * TAU;
  p.set(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r * 0.8), hx('#fff4c0'));
  p.set(
    Math.round(cx + Math.cos(a + 0.4) * r),
    Math.round(cy + Math.sin(a + 0.4) * r * 0.8),
    hx('#ffcc40'),
  );
}

registerPropPainter('f13_hook', (o, time) => {
  const on = hookReady(o) <= 0;
  const f = on ? frameAt(o, time, 6, 6) : 0;
  return spr(`hook|${+on}|${f}`, 16, 30, (p) => {
    shadowOn(p, 8, 26, 6);
    // Столб: брус с железными бандажами.
    for (let y = 6; y < 26; y++)
      for (let x = 6; x <= 9; x++)
        p.set(x, y, tone(TIMBER, x === 6 ? 0.8 : x === 9 ? 0.25 : 0.55 - (y % 7 === 0 ? 0.2 : 0)));
    for (const y of [10, 18, 24])
      for (let x = 5; x <= 10; x++) p.set(x, y, x < 7 ? IRON[3] : IRON[2]);
    // Шапка и кольцо с тросом.
    p.rect(5, 4, 10, 6, IRON[2]);
    for (let x = 5; x <= 10; x++) p.set(x, 4, IRON[3]);
    ringGlint(p, 8, 3, 3, f, on);
    // Моток троса у подножия.
    p.ell(8, 25, 4, 1.6, ROPE[1]);
    for (let x = 5; x <= 11; x += 2) p.set(x, 25, ROPE[3]);
    // Флажок: жёлтый — готов, серый — трос сматывается.
    const fl = on ? hx('#e0a030') : hx('#6a6660');
    p.rect(10, 7, 13, 9, fl);
    p.set(13, 8, alpha(fl, 0.6));
    p.outline(INK);
  });
});

registerPropPainter('f13_hookc', (o, time) => {
  const on = hookReady(o) <= 0;
  const f = on ? frameAt(o, time, 6, 6) : 0;
  return spr(`hookc|${+on}|${f}`, 16, 22, (p) => {
    shadowOn(p, 8, 18, 6);
    // Гранитная тумба.
    for (let y = 8; y < 18; y++)
      for (let x = 3; x <= 12; x++) {
        const l = 0.62 - (x - 3) * 0.05 + (y === 8 ? 0.2 : 0) - (hash(x, y, 3) < 0.1 ? 0.1 : 0);
        p.set(x, y, tone(GRANITE, l));
      }
    p.ell(7.5, 8, 4.8, 1.8, tone(GRANITE, 0.8));
    // Железный оголовок и большое кольцо сверху — сюда цепляется кошка.
    p.rect(5, 6, 10, 7, IRON[2]);
    ringGlint(p, 7.5, 3.5, 3.2, f, on);
    // Цепь свисает по боку.
    for (let i = 0; i < 5; i++) p.set(12 + (i % 2), 8 + i * 2, IRON[i % 2 ? 1 : 3]);
    p.outline(INK);
  });
});

// --- Пушка: смотрит, куда её навела Стена (угол из правил этажа).

function cannonState(o: WorldObj): { ang: number; since: number } {
  const sim = paintSim();
  const st = sim ? f13State(sim) : undefined;
  const c = st?.cannons.find((k) => k.obj.id === o.id);
  if (!c) return { ang: Math.PI / 2, since: 99 };
  return { ang: c.ang, since: c.reload > 0 ? CANNON.reload - c.reload : 99 };
}

function drawCannon(p: Px, dir: 'down' | 'up' | 'side', kick: number, smoke: number): void {
  shadowOn(p, 12, 21, 9, 2.6);
  const wheel = (cx: number, cy: number, r: number) => {
    p.ell(cx, cy, r, r, TIMBER[1]);
    p.ell(cx, cy, r - 1, r - 1, TIMBER[2]);
    p.set(Math.round(cx), Math.round(cy), IRON[3]);
    for (let a = 0; a < 4; a++)
      p.set(
        Math.round(cx + Math.cos(a * 1.57) * (r - 1)),
        Math.round(cy + Math.sin(a * 1.57) * (r - 1)),
        TIMBER[0],
      );
  };
  if (dir === 'side') {
    // Лафет, два колеса, ствол вправо.
    poly(
      p,
      [
        [4, 16],
        [16, 14],
        [17, 18],
        [4, 20],
      ],
      (x) => tone(PLANK, 0.5 - x * 0.01),
    );
    wheel(8 - kick, 18, 3.4);
    const bx = 3 - kick;
    for (let x = bx; x < bx + 18; x++) {
      const r = 2.6 - (x - bx) * 0.05;
      for (let y = Math.round(13 - r); y <= Math.round(13 + r); y++) {
        const l = 0.75 - Math.abs(y - (13 - r * 0.4)) * 0.18;
        p.set(x, y, tone(BRONZE, l));
      }
    }
    for (const x of [bx + 3, bx + 9, bx + 16])
      for (let y = 10; y <= 16; y++) if (p.solid(x, y)) p.set(x, y, BRONZE[1]);
    p.ell(bx + 1, 13, 1.6, 1.6, BRONZE[2]);
    p.set(bx + 17, 12, hx('#0a0806'));
    p.set(bx + 17, 13, hx('#0a0806'));
    wheel(15 - kick, 18, 3.4);
    if (smoke > 0)
      for (let i = 0; i < 3; i++)
        cloud(
          p,
          bx + 21 + i * 1.5,
          12 - i * 2,
          2 + smoke * 1.5,
          alpha(hx('#d8d4cc'), 0.5 * smoke),
          i + 3,
          1,
        );
  } else if (dir === 'down') {
    // Жерло к нам: круг ствола, колёса по бокам.
    wheel(4, 17, 3.6);
    wheel(20, 17, 3.6);
    p.rect(6, 14, 18, 19, tone(PLANK, 0.45));
    const y0 = 11 + kick;
    p.ell(12, y0, 5, 4.6, BRONZE[1]);
    p.ell(11.5, y0 - 0.6, 4.2, 3.8, BRONZE[2]);
    p.ell(11.2, y0 - 1, 1.6, 1.2, BRONZE[3]);
    p.ell(12, y0 + 0.4, 2.6, 2.4, hx('#0a0604'));
    for (let a = 0; a < 16; a++) {
      const t = (a / 16) * TAU;
      p.set(Math.round(12 + Math.cos(t) * 3.2), Math.round(y0 + 0.4 + Math.sin(t) * 3), BRONZE[3]);
    }
    if (smoke > 0)
      for (let i = 0; i < 3; i++)
        cloud(
          p,
          9 + i * 3,
          y0 + 7 + i,
          2 + smoke * 1.5,
          alpha(hx('#d8d4cc'), 0.45 * smoke),
          i + 7,
          1,
        );
  } else {
    // От нас: казённик с шишкой, ствол уходит вверх.
    wheel(4, 17, 3.6);
    wheel(20, 17, 3.6);
    p.rect(6, 14, 18, 19, tone(PLANK, 0.45));
    for (let y = 2 + kick; y <= 16; y++) {
      const r = 2.6 + (y - 2) * 0.1;
      for (let x = Math.round(12 - r); x <= Math.round(12 + r); x++)
        p.set(x, y, tone(BRONZE, 0.75 - Math.abs(x - 11) * 0.12));
    }
    p.ell(12, 17, 2, 1.6, BRONZE[3]);
    if (smoke > 0)
      for (let i = 0; i < 3; i++)
        cloud(p, 10 + i * 2, 1 + i, 2 + smoke, alpha(hx('#d8d4cc'), 0.45 * smoke), i + 5, 1);
  }
  p.outline(INK);
}

registerPropPainter('f13_cannon', (o) => {
  const { ang, since } = cannonState(o);
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const dir = Math.abs(c) > Math.abs(s) ? 'side' : s > 0 ? 'down' : 'up';
  const left = dir === 'side' && c < 0;
  const kick = since < 0.25 ? 2 : since < 0.5 ? 1 : 0;
  const smoke = since < 2 ? Math.max(0, Math.round((1 - since / 2) * 3) / 3) : 0;
  return spr(
    `cannon|${dir}|${+left}|${kick}|${smoke}`,
    24,
    26,
    (p) => {
      const q = new Px(24, 26);
      drawCannon(q, dir, kick, smoke);
      p.data.set((left ? q.flipX() : q).data);
    },
    24,
  );
});

// --- Валун на лебёдке: сброшен — на месте только помост.

registerPropPainter('f13_boulder', (o, time) => {
  const sim = paintSim();
  const used = !!(sim && f13State(sim)?.boulder?.used);
  const f = used ? 0 : frameAt(o, time, 2, 1.2);
  return spr(`boulder|${+used}|${f}`, 26, 30, (p) => {
    shadowOn(p, 13, 26, 11, 3);
    // Помост и стойки лебёдки.
    p.rect(2, 22, 23, 26, tone(PLANK, 0.45));
    for (let x = 2; x <= 23; x += 4) p.set(x, 23, PLANK[0]);
    for (const x of [2, 22])
      for (let y = 4; y < 24; y++) p.set(x, y, tone(TIMBER, 0.6 - (x > 10 ? 0.25 : 0)));
    for (let x = 2; x <= 22; x++) p.set(x, 4, tone(TIMBER, 0.7));
    if (!used) {
      // Цепи держат глыбу.
      for (let y = 5; y < 12; y++) {
        p.set(7, y, IRON[(y + f) % 2 ? 1 : 3]);
        p.set(18, y, IRON[(y + f + 1) % 2 ? 1 : 3]);
      }
      shadeEll(p, 12.5, 16, 9, 7.5, STONE);
      for (let i = 0; i < 6; i++)
        p.set(Math.round(8 + hash(i, 5) * 9), Math.round(12 + hash(5, i) * 8), STONE[0]);
      stroke(p, 6, 14, 10, 18, STONE[1]);
      stroke(p, 15, 11, 18, 15, STONE[1]);
    } else {
      for (const x of [7, 18]) for (let y = 5; y < 9 + (x % 3); y++) p.set(x, y, IRON[2]);
    }
    p.outline(INK);
  });
});

// --- Набат: бронзовый колокол на раме; ударили — качается.

registerPropPainter('f13_bell', (o, time) => {
  const sim = paintSim();
  const bell = sim ? f13State(sim)?.bell : null;
  const swing =
    bell && bell.cd > BELL.cd - 2.5 ? (Math.sin(time * 9) * (bell.cd - (BELL.cd - 2.5))) / 2.5 : 0;
  const k = Math.round(swing * 3);
  const f = frameAt(o, time, 4, 3);
  return spr(`bell|${k}|${f}`, 28, 36, (p) => {
    shadowOn(p, 14, 32, 12, 3);
    // Рама из брусьев.
    for (const x of [3, 24])
      for (let y = 6; y < 33; y++) p.set(x, y, tone(TIMBER, x < 10 ? 0.65 : 0.3));
    for (const x of [4, 23])
      for (let y = 6; y < 33; y++) p.set(x, y, tone(TIMBER, x < 10 ? 0.45 : 0.2));
    for (let x = 2; x <= 25; x++) {
      p.set(x, 5, tone(TIMBER, 0.75));
      p.set(x, 6, tone(TIMBER, 0.4));
    }
    stroke(p, 5, 10, 9, 6, TIMBER[2]);
    stroke(p, 22, 10, 18, 6, TIMBER[2]);
    // Колокол: юбка с кромкой, отлив.
    const cx = 14 + k * 1.3;
    const top = 8;
    for (let y = 0; y < 17; y++) {
      const t = y / 16;
      const half = 3 + t * t * 6.5 + (y > 14 ? 1 : 0);
      for (let x = Math.round(cx - half); x <= Math.round(cx + half); x++) {
        const u = (x - cx) / half;
        let l = 0.62 - u * 0.4 + (y > 14 ? 0.15 : 0);
        if (Math.abs(u + 0.45) < 0.12) l += 0.3;
        p.set(x, top + y + Math.round(-u * k * 0.8), tone(BRONZE, l));
      }
    }
    p.rect(Math.round(cx) - 1, 6, Math.round(cx) + 1, 8, IRON[2]);
    // Язык под колоколом.
    p.ell(cx - k * 0.8, top + 18, 1.3, 1.3, IRON[1]);
    // Верёвка к земле.
    for (let y = top + 19; y < 32; y++)
      p.set(Math.round(cx + 5 - k * 0.3 + Math.sin(y * 0.6 + f) * 0.4), y, ROPE[2]);
    p.outline(INK);
  });
});

// --- Фонтан: чаша, струи, вода живая.

registerPropPainter('f13_fountain', (o, time) => {
  const f = frameAt(o, time, 4, 6);
  return spr(`fountain|${f}`, 36, 34, (p) => {
    shadowOn(p, 18, 29, 17, 3.5);
    // Чаша: кромка камня, вода внутри.
    p.ell(18, 24, 16, 6.5, STONE[1]);
    p.ell(18, 23, 15.5, 6, STONE[3]);
    p.ell(18, 23.5, 13.5, 4.8, hx('#1a3a4a'));
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * TAU + f * 0.35;
      const r = 5 + ((i * 3 + f) % 8);
      p.set(
        Math.round(18 + Math.cos(a) * r),
        Math.round(23.5 + Math.sin(a) * r * 0.34),
        hx('#4a8aa0'),
      );
    }
    // Передняя стенка чаши — под кромкой.
    for (let x = 3; x <= 33; x++) {
      const u = (x - 18) / 15.5;
      if (Math.abs(u) > 1) continue;
      const y0 = Math.round(23 + Math.sqrt(1 - u * u) * 6);
      for (let y = y0; y < y0 + 3; y++) p.set(x, y, tone(STONE, 0.45 - u * 0.2 - (y - y0) * 0.08));
    }
    // Столп и верхняя чаша.
    for (let y = 8; y < 23; y++)
      for (let x = 16; x <= 19; x++) p.set(x, y, tone(STONE, x === 16 ? 0.8 : 0.45));
    p.ell(18, 9, 6, 2, STONE[2]);
    p.ell(18, 8.5, 5, 1.4, hx('#2a5a6a'));
    // Струи дугой в чашу.
    const W = hx('#bfe6f0');
    for (let i = 0; i < 2; i++) {
      const s = i ? 1 : -1;
      for (let t = 0; t < 1; t += 0.07) {
        const x = 18 + s * (3 + t * 8);
        const y = 7 - Math.sin(t * Math.PI) * 2.5 + t * t * 14;
        if ((Math.floor(t * 14) + f) % 3 === 0) continue;
        p.set(Math.round(x), Math.round(y), alpha(W, 0.85));
      }
    }
    for (let i = 0; i < 3; i++) p.set(17 + i, 5 - ((f + i) % 3), W);
    p.outline(INK);
  });
});

// --- Мёртвые, вещи улиц.

registerPropPainter('f13_corpse', (o) => {
  const v = Math.floor(phaseOf(o.id) * 2);
  return spr(`corpse|${v}`, 22, 14, (p) => {
    // Солдат в тёмно-зелёном плаще ничком, рядом клинок.
    p.ell(11, 10, 10, 3, alpha(hx('#3a0808'), 0.7));
    const CL = tn('#101810', '#1e2e1c', '#34482e', '#4e6644');
    poly(
      p,
      [
        [3, 8],
        [15, 6],
        [17, 10],
        [4, 11],
      ],
      (x, y) => tone(CL, 0.6 - (y - 6) * 0.08 + x * 0.005),
    );
    shadeEll(p, 17.5, 7.5, 2.2, 2, SKIN);
    p.set(18, 6, HAIR_BROWN[2]);
    p.set(17, 6, HAIR_BROWN[1]);
    limb(p, 4, 9, 1, 11, 1.2, 1, tn('#1a1410', '#3a2e24', '#5a4a3a', '#7a6650'));
    if (v) stroke(p, 8, 12, 18, 11, hx('#b8c0c8'));
    else stroke(p, 5, 3, 12, 4, hx('#b8c0c8'));
    p.outline(INK);
  });
});

registerPropPainter('f13_well', () =>
  spr('well', 20, 28, (p) => {
    shadowOn(p, 10, 24, 9, 2.6);
    // Кольцо сруба из камня, крыша на двух стойках, ведро.
    for (const x of [3, 16])
      for (let y = 4; y < 20; y++) p.set(x, y, tone(TIMBER, x < 10 ? 0.6 : 0.3));
    poly(
      p,
      [
        [1, 6],
        [10, 1],
        [19, 6],
        [17, 7],
        [3, 7],
      ],
      (x, y) => tone(ROOFS[0], 0.7 - y * 0.06 - (x > 10 ? 0.15 : 0)),
    );
    p.ell(10, 20, 8, 3.5, STONE[1]);
    for (let y = 17; y < 24; y++)
      for (let x = 2; x <= 18; x++) {
        const u = (x - 10) / 8;
        if (Math.abs(u) > 1) continue;
        const l = 0.62 - u * 0.25 - ((x + (y % 2) * 2) % 4 === 0 ? 0.2 : 0);
        p.set(x, y, tone(STONE, l));
      }
    p.ell(10, 17.5, 6.5, 2.4, hx('#060808'));
    for (let x = 4; x <= 15; x++) p.set(x, 9, ROPE[1]);
    for (let y = 9; y < 13; y++) p.set(10, y, ROPE[2]);
    p.rect(8, 13, 12, 15, tone(PLANK, 0.5));
    p.outline(INK);
  }),
);

registerPropPainter('f13_stall', (o, time) => {
  const f = frameAt(o, time, 2, 1.6);
  const v = Math.floor(phaseOf(o.id) * 3);
  return spr(`stall|${v}|${f}`, 24, 26, (p) => {
    shadowOn(p, 12, 22, 11, 2.6);
    const stripe = [hx('#9a2a1e'), hx('#2a5a7a'), hx('#8a6a1a')][v];
    for (const x of [2, 21])
      for (let y = 6; y < 22; y++) p.set(x, y, tone(TIMBER, x < 10 ? 0.6 : 0.3));
    // Навес.
    for (let y = 2; y < 8; y++)
      for (let x = 0; x < 24; x++) {
        const on = Math.floor(x / 3) % 2 === 0;
        p.set(
          x,
          y + (f && x % 6 < 3 && y === 7 ? 1 : 0),
          mixc(on ? stripe : hx('#e0d4b8'), INK, (y - 2) * 0.05),
        );
      }
    for (let x = 1; x < 24; x += 3) p.set(x, 8 + f, mixc(stripe, INK, 0.3));
    // Прилавок и товар: яблоки, хлеб, кувшины.
    p.rect(3, 15, 20, 20, tone(PLANK, 0.45));
    for (let x = 3; x <= 20; x++) p.set(x, 15, tone(PLANK, 0.75));
    for (let i = 0; i < 6; i++) {
      const x = 4 + i * 3;
      const c = [hx('#b8201a'), hx('#c8902a'), hx('#6a8a2a')][(i + v) % 3];
      p.ell(x, 13.5, 1.3, 1.2, c);
      p.set(x - 1, 13, mixc(c, WHITE, 0.4));
    }
    p.outline(INK);
  });
});

registerPropPainter('f13_cart', (o) => {
  const v = Math.floor(phaseOf(o.id) * 2);
  return spr(`cart|${v}`, 26, 20, (p) => {
    shadowOn(p, 13, 17, 12, 2.4);
    // Кузов, оглобли, колёса; на борту — бочки или мешки.
    p.rect(3, 8, 20, 13, tone(PLANK, 0.5));
    for (let x = 3; x <= 20; x++) p.set(x, 8, tone(PLANK, 0.8));
    for (let x = 3; x <= 20; x += 4) for (let y = 9; y <= 13; y++) p.set(x, y, PLANK[1]);
    stroke(p, 20, 11, 25, 13, TIMBER[2]);
    stroke(p, 20, 12, 25, 14, TIMBER[1]);
    for (const cx of [6, 17]) {
      p.ell(cx, 15, 3.5, 3.5, TIMBER[1]);
      p.ell(cx, 15, 2.4, 2.4, TIMBER[2]);
      p.set(cx, 15, IRON[3]);
    }
    if (v) {
      shadeEll(p, 8, 5, 3, 3.5, PLANK);
      shadeEll(p, 14, 5, 3, 3.5, PLANK);
      for (const x of [8, 14]) {
        p.set(x - 3, 4, IRON[2]);
        p.set(x + 2, 4, IRON[1]);
      }
    } else {
      shadeEll(p, 8, 6, 4, 2.6, tn('#4a3a20', '#7a6440', '#a8905e', '#c8b07e'));
      shadeEll(p, 15, 5.5, 4, 2.6, tn('#4a3a20', '#7a6440', '#a8905e', '#c8b07e'));
    }
    p.outline(INK);
  });
});

registerPropPainter('f13_skull', () =>
  spr('skull', 24, 20, (p) => {
    shadowOn(p, 12, 17, 11, 2.6);
    // Череп исполина, вросший в мостовую: глазницы, скула, зубы.
    shadeEll(p, 12, 9, 10, 8, BONE);
    shadeEll(p, 12, 14, 7.5, 3.5, BONE, -0.05);
    p.ell(8, 9, 2.6, 2.4, hx('#120c08'));
    p.ell(16, 9, 2.6, 2.4, hx('#120c08'));
    p.set(12, 12, hx('#120c08'));
    p.set(11, 12, hx('#2a2018'));
    for (let x = 7; x <= 17; x++) {
      p.set(x, 15, x % 2 ? BONE[3] : BONE[2]);
      p.set(x, 16, hx('#1a120c'));
    }
    stroke(p, 5, 4, 8, 6, BONE[1]);
    // Мостовая вокруг, вывернутые камни.
    for (const [x, y] of [
      [2, 17],
      [21, 16],
      [4, 18],
    ])
      shadeEll(p, x, y, 1.6, 1.2, COBBLE);
    p.outline(INK);
  }),
);

registerPropPainter('f13_hand', (o, time) => {
  const f = frameAt(o, time, 4, 4);
  return spr(`hand|${f}`, 18, 28, (p) => {
    shadowOn(p, 9, 24, 8, 2.4);
    // Кисть исполина из-под обломков: пальцы вверх, мясо парит.
    const S = SKIN_RED;
    limb(p, 9, 24, 9, 14, 3.4, 3, S);
    shadeEll(p, 9, 13, 4.2, 3.4, S);
    for (let i = 0; i < 4; i++) {
      const x = 6 + i * 2;
      limb(p, x, 12, x - 1 + i * 0.6, 4 + Math.abs(i - 1.5), 1, 0.8, S);
    }
    limb(p, 12, 14, 15, 10, 1.1, 0.9, S);
    for (let i = 0; i < 5; i++) shadeEll(p, 2 + i * 3.5, 24 - (i % 2), 2.2, 1.6, COBBLE);
    p.outline(INK);
    for (let i = 0; i < 2; i++)
      puff(p, 6 + i * 6, 5 - ((f + i * 2) % 4) * 1.2, 2 + ((f + i) % 3) * 0.6, 0.55, f + i * 3);
  });
});

registerPropPainter('f13_statue', () =>
  spr('statue', 20, 46, (p) => {
    shadowOn(p, 10, 42, 9, 2.6);
    // Постамент с карнизом.
    for (let y = 30; y < 43; y++)
      for (let x = 3; x <= 16; x++)
        p.set(x, y, tone(PLAZA, (y === 30 ? 0.85 : 0.55) - (x - 3) * 0.02 - (y === 35 ? 0.2 : 0)));
    for (let x = 2; x <= 17; x++) p.set(x, 29, tone(PLAZA, 0.9));
    // Каменный страж: плащ до пят, ладони на навершии меча остриём вниз.
    const B = tn('#2e2a26', '#57504a', '#827a70', '#aca296');
    poly(
      p,
      [
        [5.5, 29],
        [14.5, 29],
        [12.8, 12],
        [7.2, 12],
      ],
      (x, y) => tone(B, 0.66 - (x - 5.5) * 0.05 - (y - 12) * 0.004),
    );
    // Наплечники и шлем с гребнем.
    shadeEll(p, 7, 12.5, 2.2, 1.6, B);
    shadeEll(p, 13, 12.5, 2.2, 1.6, B);
    shadeEll(p, 10, 9, 2.7, 3, B);
    for (let y = 5; y < 8; y++) p.set(10, y, B[1]);
    p.set(9, 9, B[0]);
    p.set(11, 9, B[0]);
    // Меч: гарда у груди, клинок до постамента.
    stroke(p, 10, 16, 10, 28, tone(B, 0.95));
    stroke(p, 11, 17, 11, 27, tone(B, 0.4));
    stroke(p, 7.5, 16, 12.5, 16, tone(B, 0.85));
    shadeEll(p, 10, 15, 1.4, 1.2, B);
    // Потёки и мох.
    for (let i = 0; i < 4; i++)
      stroke(p, 6.5 + i * 2, 20 + i, 6.5 + i * 2, 24 + i, alpha(hx('#1e1a16'), 0.35));
    p.set(6, 28, MOSS);
    p.set(14, 27, MOSS);
    p.outline(INK);
  }),
);

registerPropPainter('f13_laundry', (o, time) => {
  const f = frameAt(o, time, 3, 3);
  const v = Math.floor(phaseOf(o.id) * 3);
  return spr(
    `laundry|${v}|${f}`,
    18,
    30,
    (p) => {
      // Верёвка через улицу над головой; бельё полощется.
      for (let x = 0; x < 18; x++)
        p.set(x, 3 + Math.round(Math.sin((x / 17) * Math.PI) * 2), ROPE[1]);
      const cloth = [hx('#d8d0c0'), hx('#8a3a2a'), hx('#3a5a7a'), hx('#c8b060')];
      for (let i = 0; i < 3; i++) {
        const x0 = 2 + i * 5;
        const c = cloth[(i + v) % 4];
        const y0 = 4 + Math.round(Math.sin(((x0 + 2) / 17) * Math.PI) * 2);
        const sway = ((f + i) % 3) - 1;
        for (let y = 0; y < 7 + (i % 2) * 2; y++)
          for (let x = 0; x < 4; x++)
            p.set(x0 + x + (y > 3 ? sway : 0), y0 + y, mixc(c, INK, x === 3 ? 0.3 : y * 0.03));
      }
      p.outline(INK);
    },
    30,
  );
});

registerPropPainter('f13_crystal', (o, time) => {
  const f = frameAt(o, time, 6, 5);
  return spr(`crystal|${f}`, 18, 26, (p) => {
    shadowOn(p, 9, 22, 8, 2.4);
    // Друза: три грани-призмы, свет бежит снизу вверх.
    const prism = (cx: number, by: number, h: number, w: number, lean: number) => {
      for (let y = 0; y < h; y++) {
        const t = y / h;
        const half = w * (1 - Math.max(0, t - 0.7) * 3.2);
        for (let x = -Math.ceil(half); x <= Math.ceil(half); x++) {
          if (Math.abs(x) > half) continue;
          const shine = Math.abs(t - (1 - f / 5)) < 0.08;
          const l = 0.45 + (x < 0 ? 0.25 : -0.1) + (shine ? 0.45 : 0);
          p.set(Math.round(cx + x + lean * t), by - y, tone(CRYST, l));
        }
      }
    };
    prism(6, 22, 11, 2.2, -3);
    prism(12, 22, 12, 2.2, 3);
    prism(9, 22, 18, 3, 0);
    p.outline(INK);
    p.set(8, 7, WHITE);
  });
});

registerPropPainter('f13_tree', (o, time) => {
  const f = frameAt(o, time, 4, 3);
  return spr(`tree|${f}`, 26, 34, (p) => {
    shadowOn(p, 13, 30, 9, 2.4);
    // Обгоревшее дерево: ствол и голые ветви, угли в коре.
    limb(p, 13, 30, 12, 12, 2.6, 1.6, CHAR);
    const br: [number, number, number, number][] = [
      [12, 16, 5, 7],
      [12, 14, 20, 6],
      [12, 20, 4, 15],
      [13, 19, 21, 14],
      [12, 12, 10, 3],
      [5, 7, 3, 3],
      [20, 6, 23, 2],
    ];
    for (const [a, b, c, d] of br) limb(p, a, b, c, d, 1, 0.6, CHAR);
    for (let i = 0; i < 5; i++) {
      const on = (i + f) % 4 !== 0;
      p.set(12 + (i % 2), 18 + i * 2, on ? hx('#ff6a1a') : hx('#7a2a0a'));
    }
    p.outline(INK);
  });
});

registerPropPainter('f13_balls', () =>
  spr('balls', 16, 16, (p) => {
    shadowOn(p, 8, 13, 7, 2);
    // Пирамида ядер.
    const ball = (x: number, y: number) => {
      shadeEll(p, x, y, 2, 2, IRON);
      p.set(Math.round(x - 1), Math.round(y - 1), IRON[3]);
    };
    for (let i = 0; i < 3; i++) ball(4 + i * 4, 11);
    for (let i = 0; i < 2; i++) ball(6 + i * 4, 8);
    ball(8, 5);
    p.outline(INK);
  }),
);

registerPropPainter('f13_debris', (o, time) => {
  const f = frameAt(o, time, 4, 3);
  const v = Math.floor(phaseOf(o.id) * 2);
  return spr(`debris|${v}|${f}`, 24, 26, (p) => {
    shadowOn(p, 12, 22, 11, 2.4);
    // Балки крест-накрест, кирпич, черепица; над завалом тянется дым.
    for (let i = 0; i < 6; i++)
      shadeEll(
        p,
        4 + hash(i, v) * 16,
        18 + hash(v, i) * 4,
        2 + hash(i, v, 3),
        1.6,
        i % 2 ? COBBLE : tn('#3a1a12', '#6e3222', '#9a4a32', '#c06a4a'),
      );
    limb(p, 3, 20, 20, 12, 1.4, 1.2, v ? CHAR : TIMBER);
    limb(p, 6, 12, 21, 20, 1.3, 1.1, TIMBER);
    for (let i = 0; i < 3; i++) p.set(8 + i * 4, 14 + (i % 2), ROOFS[0][2]);
    p.outline(INK);
    puff(p, 13 + ((f % 2) - 0.5), 8 - f * 1.5, 2.4 + f * 0.4, 0.4, f);
  });
});

registerPropPainter('f13_crane', (o, time) => {
  const sw = Math.sin(time * 1.3 + phaseOf(o.id) * 6);
  const k = Math.round(sw * 2);
  return spr(`crane|${k}`, 30, 48, (p) => {
    shadowOn(p, 8, 44, 7, 2.4);
    // Мачта, стрела, трос с крюком качается.
    for (let y = 4; y < 45; y++) {
      p.set(6, y, tone(TIMBER, 0.65));
      p.set(7, y, tone(TIMBER, 0.45));
      p.set(8, y, tone(TIMBER, 0.25));
      if (y % 6 === 0) stroke(p, 5, y, 9, y + 3, TIMBER[1]);
    }
    for (let x = 4; x < 28; x++) {
      p.set(x, 5, tone(TIMBER, 0.7));
      p.set(x, 6, tone(TIMBER, 0.35));
    }
    stroke(p, 8, 14, 20, 6, TIMBER[2]);
    p.ell(7, 36, 3, 2, TIMBER[1]);
    // Блок на конце стрелы и барабан лебёдки у мачты.
    p.ell(26, 7, 1.8, 1.8, IRON[2]);
    p.set(26, 7, IRON[0]);
    p.ell(11, 36, 2.6, 2.6, TIMBER[2]);
    for (let i = 0; i < 4; i++) p.set(9 + i, 36, ROPE[2]);
    // Трос с грузом — ящик качается.
    const hx0 = 26 + k;
    for (let y = 9; y < 24; y++) p.set(Math.round(26 + (k * (y - 9)) / 15), y, ROPE[2]);
    for (let y = 24; y < 31; y++)
      for (let x = -3; x <= 3; x++) {
        const edge = Math.abs(x) === 3 || y === 24 || y === 30;
        p.set(hx0 + x, y, tone(PLANK, edge ? 0.3 : 0.6 - (y % 3 === 0 ? 0.12 : 0)));
      }
    p.outline(INK);
  });
});

registerPropPainter('f13_roost', () =>
  spr('roost', 18, 34, (p) => {
    shadowOn(p, 9, 30, 6, 2);
    // Сухой шест с перекладиной и гнездом — насест ворон.
    limb(p, 9, 30, 9, 6, 1.4, 1, CHAR);
    stroke(p, 2, 10, 16, 8, CHAR[2]);
    stroke(p, 2, 11, 16, 9, CHAR[1]);
    p.ell(9, 5, 4, 2, tn('#1a120a', '#3a2814', '#5a4020', '#7a5a30')[1]);
    for (let i = 0; i < 6; i++) p.set(5 + i * 1.5, 4 + (i % 2), hx('#6a5030'));
    // Перья и помёт у подножия.
    for (let i = 0; i < 4; i++)
      p.set(4 + i * 3, 29 + (i % 2), i % 2 ? hx('#e8e4dc') : hx('#1a171e'));
    p.outline(INK);
  }),
);

registerPropPainter('f13_lamp', (o, time) => {
  const f = frameAt(o, time, 4, 7);
  return spr(`lamp|${f}`, 12, 32, (p) => {
    shadowOn(p, 6, 28, 4, 1.4);
    for (let y = 8; y < 29; y++) {
      p.set(5, y, IRON[2]);
      p.set(6, y, IRON[1]);
    }
    p.rect(4, 27, 7, 28, IRON[1]);
    // Фонарь: рама и огонь, пламя дрожит.
    p.rect(2, 2, 9, 8, IRON[1]);
    p.rect(3, 3, 8, 7, hx('#ffd27a'));
    p.rect(4, 4 + (f % 2), 7, 6, hx('#fff2c0'));
    p.set(5 + (f === 2 ? 1 : 0), 5, WHITE);
    for (let x = 1; x <= 10; x++) p.set(x, 1, IRON[2]);
    p.set(5, 0, IRON[2]);
    p.set(6, 0, IRON[2]);
    p.outline(INK);
  });
});

registerPropPainter('f13_candles', (o, time) => {
  const f = frameAt(o, time, 4, 8);
  return spr(`candles|${f}`, 16, 14, (p) => {
    // Память павшим: свечи, цветы, дощечка.
    p.rect(9, 3, 13, 8, tone(PLANK, 0.5));
    p.set(10, 5, INK);
    p.set(11, 5, INK);
    p.set(12, 5, INK);
    for (let i = 0; i < 4; i++) {
      const x = 2 + i * 3;
      const h = 3 + (i % 2);
      for (let y = 0; y < h; y++) p.set(x, 11 - y, hx('#e8dcc0'));
      const fl = (f + i) % 4;
      p.set(x, 11 - h, fl === 3 ? FLAME[1] : FLAME[2]);
      p.set(x, 10 - h, fl % 2 ? FLAME[3] : FLAME[2]);
    }
    p.set(6, 12, hx('#c83a3a'));
    p.set(7, 12, hx('#e8e0d0'));
    p.set(12, 11, hx('#c83a3a'));
    p.outline(INK);
  });
});

registerPropPainter('f13_bonfire', (o, time) => {
  const f = frameAt(o, time, 4, 8);
  return spr(`bonfire|${f}`, 18, 26, (p) => {
    shadowOn(p, 9, 22, 8, 2.4);
    // Кольцо камней, поленья шалашом, огонь.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      shadeEll(p, 9 + Math.cos(a) * 6.5, 20 + Math.sin(a) * 2.2, 1.6, 1.2, STONE);
    }
    limb(p, 4, 21, 12, 16, 1, 0.9, TIMBER);
    limb(p, 14, 21, 6, 16, 1, 0.9, TIMBER);
    flame(p, 9, 20, 8, 13 + (f % 2) * 2, f, 3);
    for (let i = 0; i < 3; i++) p.set(6 + ((f * 3 + i * 5) % 7), 4 + ((f + i * 2) % 5), FLAME[2]);
  });
});

// --- Бьётся: ящики, мешки, бочка, сено.

registerPropPainter('f13_crates', (o, _t, _a, flash) =>
  sprFlash(`crates|${Math.floor(phaseOf(o.id) * 2)}`, 16, 22, flash, (p) => {
    shadowOn(p, 8, 18, 7, 2);
    const box = (x0: number, y0: number, s: number) => {
      for (let y = 0; y < s; y++)
        for (let x = 0; x < s; x++) {
          const edge = x === 0 || y === 0 || x === s - 1 || y === s - 1;
          const diag = Math.abs(x - y) < 1 || Math.abs(x - (s - 1 - y)) < 1;
          p.set(
            x0 + x,
            y0 + y,
            tone(PLANK, edge ? 0.3 : diag ? 0.45 : 0.62 - (y % 3 === 0 ? 0.1 : 0)),
          );
        }
    };
    box(1, 9, 9);
    box(7, 11, 8);
    box(4, 2, 7);
    p.outline(INK);
  }),
);

registerPropPainter('f13_sandbags', (_o, _t, _a, flash) =>
  sprFlash('sandbags', 18, 16, flash, (p) => {
    shadowOn(p, 9, 13, 8, 2);
    const S = tn('#3a3220', '#6a5a3a', '#968058', '#bca67a');
    for (let r = 0; r < 3; r++)
      for (let i = 0; i < 4 - (r === 2 ? 1 : 0); i++) {
        const x = 3 + i * 4 + (r % 2) * 2;
        const y = 11 - r * 3;
        shadeEll(p, x, y, 2.4, 1.6, S);
        p.set(x - 2, y, S[0]);
      }
    p.outline(INK);
  }),
);

registerPropPainter('f13_barrel', (_o, _t, _a, flash) =>
  sprFlash('barrel', 12, 18, flash, (p) => {
    shadowOn(p, 6, 15, 5, 1.6);
    for (let y = 3; y < 15; y++) {
      const half = 4 + Math.sin(((y - 3) / 11) * Math.PI) * 0.8;
      for (let x = Math.round(6 - half); x <= Math.round(6 + half); x++) {
        const u = (x - 6) / half;
        let l = 0.58 - u * 0.3;
        if (y === 5 || y === 12) l = 0.2;
        p.set(x, y, y === 5 || y === 12 ? tone(IRON, 0.5 - u * 0.3) : tone(PLANK, l));
      }
    }
    p.ell(6, 3, 4, 1.4, tone(PLANK, 0.7));
    p.set(6, 3, INK);
    p.outline(INK);
  }),
);

registerPropPainter('f13_hay', (_o, _t, _a, flash) =>
  sprFlash('hay', 16, 14, flash, (p) => {
    shadowOn(p, 8, 11, 7, 2);
    const H = tn('#5a4a1a', '#9a8030', '#c8aa4a', '#e8d27a');
    for (let y = 3; y < 12; y++)
      for (let x = 1; x < 15; x++) {
        const l =
          0.55 +
          (y === 3 ? 0.3 : 0) -
          x * 0.015 +
          (hash(x, y, 2) < 0.3 ? 0.12 : 0) -
          (hash(x, y, 5) < 0.15 ? 0.2 : 0);
        p.set(x, y, tone(H, l));
      }
    for (const x of [5, 10]) for (let y = 3; y < 12; y++) p.set(x, y, hx('#5a3a1a'));
    p.outline(INK);
  }),
);

// --- На стенах: окна, пожар, трубы, знамёна, факелы.

registerPropPainter('f13_window', (o, time) => {
  const f = frameAt(o, time, 6, 2);
  const flick = f === 3 ? 1 : 0;
  return spr(`window|${flick}`, 16, 16, (p) => {
    // Окно в свету: рама, переплёт, занавеска.
    p.rect(4, 3, 11, 10, TIMBER[1]);
    p.rect(5, 4, 10, 9, flick ? hx('#e8b050') : hx('#ffd27a'));
    p.rect(6, 5, 9, 8, flick ? hx('#ffd27a') : hx('#fff0b8'));
    for (let y = 4; y <= 9; y++) p.set(7, y, TIMBER[1]);
    for (let x = 5; x <= 10; x++) p.set(x, 6, TIMBER[1]);
    for (let y = 4; y <= 9; y++) p.set(5, y, hx('#b84a2a'));
    p.rect(3, 10, 12, 11, TIMBER[2]);
    for (let x = 4; x < 12; x += 2) p.set(x, 12, alpha(hx('#ffd27a'), 0.35));
  });
});

registerPropPainter('f13_fire', (o, time) => {
  const f = frameAt(o, time, 4, 9);
  return spr(
    `fire|${f}`,
    20,
    38,
    (p) => {
      // Горит крыша: языки выше конька, дым над ними.
      flame(p, 10, 30, 14, 20 + (f % 2) * 3, f, 1);
      flame(p, 5, 31, 6, 10, f + 1, 2);
      flame(p, 15, 31, 7, 12, f + 2, 5);
      for (let i = 0; i < 2; i++) puff(p, 9 + i * 3, 7 - ((f + i * 2) % 4), 3 + i, 0.4, f + i);
      for (let i = 0; i < 3; i++)
        p.set(4 + ((f * 5 + i * 6) % 12), 4 + ((f * 3 + i * 4) % 10), FLAME[3]);
    },
    34,
  );
});

registerPropPainter('f13_chimney', (o, time) => {
  const f = frameAt(o, time, 4, 3);
  return spr(
    `chimney|${f}`,
    16,
    36,
    (p) => {
      // Кирпичная труба на крыше и дым столбом.
      for (let y = 18; y < 30; y++)
        for (let x = 5; x <= 10; x++) {
          const brick = y % 3 === 0 || (x + (Math.floor(y / 3) % 2) * 2) % 4 === 0;
          p.set(
            x,
            y,
            brick
              ? hx('#3a1a12')
              : tone(tn('#3a1a12', '#6e3222', '#9a4a32', '#c06a4a'), 0.6 - (x - 5) * 0.08),
          );
        }
      p.rect(4, 17, 11, 18, tone(STONE, 0.7));
      p.outline(INK);
      for (let i = 0; i < 4; i++) {
        const t = ((f + i) % 4) / 4 + i * 0.0;
        puff(
          p,
          7.5 + Math.sin(i * 1.7 + f) * 1.2 + i * 0.6,
          15 - i * 4 - t * 3,
          2 + i * 0.7,
          0.55 - i * 0.1,
          f + i * 7,
        );
      }
    },
    30,
  );
});

registerPropPainter('f13_banner', (o, time) => {
  const f = frameAt(o, time, 3, 3);
  return spr(
    `banner|${f}`,
    12,
    18,
    (p) => {
      // Знамя города на Стене: две башни в щите.
      for (let x = 1; x <= 10; x++) p.set(x, 1, IRON[2]);
      for (let y = 2; y < 16; y++)
        for (let x = 2; x <= 9; x++) {
          const tail = y > 12 && Math.abs(x - 5.5) < (y - 12) * 1.2;
          if (tail) continue;
          const wave = Math.round(Math.sin(y * 0.6 + f * 2) * 0.6);
          p.set(
            x + (y > 6 ? wave : 0),
            y,
            tone(tn('#2a0806', '#5a140e', '#8a2418', '#b8402a'), 0.55 - (x - 2) * 0.05),
          );
        }
      // Герб: стена с тремя зубцами и воротами.
      const G = hx('#d8b050');
      for (let x = 3; x <= 8; x++) for (let y = 7; y <= 10; y++) p.set(x, y, G);
      for (const x of [3, 5, 7]) p.set(x + (x === 7 ? 1 : 0), 6, G);
      p.set(5, 10, hx('#5a140e'));
      p.set(6, 10, hx('#5a140e'));
      p.set(5, 9, hx('#5a140e'));
      p.set(6, 9, hx('#5a140e'));
      p.outline(INK);
    },
    14,
  );
});

registerPropPainter('f13_torch', (o, time) => {
  const f = frameAt(o, time, 4, 10);
  return spr(
    `torch|${f}`,
    10,
    18,
    (p) => {
      p.rect(4, 10, 5, 15, TIMBER[2]);
      p.rect(3, 12, 6, 13, IRON[2]);
      flame(p, 4.5, 10, 5, 7 + (f % 2), f, 4);
    },
    14,
  );
});

// ---------------------------------------------------------------------------
// Метки ударов и облака. Язык этажа: исполин бьёт красным, «горит» к удару;
// крюк, трос, пушка и набат — золото и сталь (это твоё); пар — белый.
// ---------------------------------------------------------------------------

export type ZoneX = (Zone | Strike) & {
  ang?: number;
  len?: number;
  arc?: number;
  w?: number;
  tx?: number;
  ty?: number;
  mob?: number;
  k?: number;
};

export const rgba = (c: RGBA, a: number) =>
  `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
export const RED = hx('#e8402a');
const HOT = hx('#ffd27a');
const GOLD = hx('#f0b040');
const STEEL = hx('#e8eef4');
export const STEAMC = hx('#f4f1ec');

/** Доля метки 0…1 (удар — по `warn`; облако — по своему `warn`). */
export const kOf = (z: ZoneX) => {
  const w = (z as Strike).warn;
  if (typeof w === 'number' && w > 0) return Math.min(1, z.t / w);
  return 1;
};
/** Облако тает к концу жизни. */
export const fadeOf = (z: ZoneX) => {
  const life = (z as Zone).life;
  if (typeof life !== 'number') return 1;
  return Math.max(0, Math.min(1, (life - z.t) / 0.5));
};

function conePath(
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

function ringPath(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  r0: number,
  r1: number,
  a?: number,
  arc?: number,
): void {
  g.beginPath();
  if (a === undefined || arc === undefined || arc >= TAU - 0.01) {
    g.arc(x, y, r1, 0, TAU);
    g.arc(x, y, Math.max(0, r0), 0, TAU, true);
  } else {
    g.arc(x, y, r1, a - arc / 2, a + arc / 2);
    g.arc(x, y, Math.max(0, r0), a + arc / 2, a - arc / 2, true);
    g.closePath();
  }
}

/** Пиксельная пыль по кругу: квадратики 2×2, сдвиг по времени. */
export function specks(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  n: number,
  color: RGBA,
  a: number,
  time: number,
  seed: number,
): void {
  g.fillStyle = rgba(color, a);
  for (let i = 0; i < n; i++) {
    const ang = hash(i, seed) * TAU + time * (0.4 + hash(seed, i) * 0.6);
    const rr = r * (0.2 + 0.8 * ((hash(i, seed, 3) + time * 0.3) % 1));
    g.fillRect(Math.round(x + Math.cos(ang) * rr), Math.round(y + Math.sin(ang) * rr * 0.8), 2, 2);
  }
}

/** Клубы пара/пыли: мягкие круги, поднимаются. */
export function billow(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: RGBA,
  a: number,
  t: number,
  seed: number,
  rise = 6,
  n = 5,
): void {
  for (let i = 0; i < n; i++) {
    const ph = (t * 0.8 + hash(i, seed)) % 1;
    const ang = hash(seed, i, 2) * TAU;
    const d = r * 0.55 * hash(i, seed, 5);
    const cx = x + Math.cos(ang) * d;
    const cy = y + Math.sin(ang) * d * 0.6 - ph * rise;
    const rr = r * (0.28 + 0.3 * ph);
    g.fillStyle = rgba(color, a * (1 - ph) * 0.9);
    g.beginPath();
    g.arc(Math.round(cx), Math.round(cy), rr, 0, TAU);
    g.fill();
  }
}

// --- Удары исполинов.

registerZonePainter('f13_palm', (g, z, px, py, S) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const R = zz.r * S;
  const a = zz.ang ?? 0;
  const arc = zz.arc ?? 1.6;
  conePath(g, px, py, R, a, arc);
  g.fillStyle = rgba(RED, 0.1 + 0.28 * k);
  g.fill();
  // Ладонь: край дуги наливается от одного края к другому — видно, куда метёт.
  g.strokeStyle = rgba(HOT, 0.4 + 0.6 * k);
  g.lineWidth = 2;
  g.beginPath();
  g.arc(px, py, R - 1, a - arc / 2, a - arc / 2 + arc * k);
  g.stroke();
  // Пять пальцев — штрихи вдоль удара.
  g.lineWidth = 1;
  g.strokeStyle = rgba(RED, 0.35 + 0.5 * k);
  for (let i = 0; i < 5; i++) {
    const aa = a - arc * 0.3 + (i / 4) * arc * 0.6;
    g.beginPath();
    g.moveTo(px + Math.cos(aa) * R * 0.45, py + Math.sin(aa) * R * 0.45);
    g.lineTo(px + Math.cos(aa) * R * (0.45 + 0.5 * k), py + Math.sin(aa) * R * (0.45 + 0.5 * k));
    g.stroke();
  }
  return true;
});

registerZonePainter('f13_backhand', (g, z, px, py, S) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const R = zz.r * S;
  const a = zz.ang ?? 0;
  const arc = zz.arc ?? 2.2;
  conePath(g, px, py, R, a, arc);
  g.fillStyle = rgba(RED, 0.1 + 0.26 * k);
  g.fill();
  // Наотмашь: стрелка бежит по дуге в обратную сторону.
  g.strokeStyle = rgba(HOT, 0.45 + 0.55 * k);
  g.lineWidth = 2;
  g.beginPath();
  g.arc(px, py, R * 0.8, a + arc / 2 - arc * k, a + arc / 2);
  g.stroke();
  const ea = a + arc / 2 - arc * k;
  g.fillStyle = rgba(HOT, 0.5 + 0.5 * k);
  g.fillRect(
    Math.round(px + Math.cos(ea) * R * 0.8) - 1,
    Math.round(py + Math.sin(ea) * R * 0.8) - 1,
    3,
    3,
  );
  return true;
});

export function stompRing(
  g: CanvasRenderingContext2D,
  zz: ZoneX,
  px: number,
  py: number,
  S: number,
  col: RGBA,
  crack: boolean,
): void {
  const k = kOf(zz);
  const R = zz.r * S;
  // Ширина кольца у движка — в обе стороны от радиуса (`|d − r| < w`).
  const W = (zz.w ?? 0.6) * S * 2;
  ringPath(g, px, py, R - W / 2, R + W / 2, zz.ang, zz.arc);
  g.fillStyle = rgba(col, 0.1 + 0.3 * k);
  g.fill();
  g.strokeStyle = rgba(col, 0.45 + 0.5 * k);
  g.lineWidth = 1;
  g.stroke();
  // Волна сходится к кольцу: внутренняя граница — где безопасно.
  g.strokeStyle = rgba(HOT, 0.25 + 0.6 * k);
  g.beginPath();
  const rr = (R + W / 2) * (1.35 - 0.35 * k);
  if (zz.arc !== undefined && zz.ang !== undefined)
    g.arc(px, py, rr, zz.ang - zz.arc / 2, zz.ang + zz.arc / 2);
  else g.arc(px, py, rr, 0, TAU);
  g.stroke();
  if (!crack) return;
  g.strokeStyle = rgba(hx('#1a0c08'), 0.5 * k);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + zz.id;
    if (
      zz.arc !== undefined &&
      zz.ang !== undefined &&
      Math.abs(((a - zz.ang + Math.PI * 3) % TAU) - Math.PI) > zz.arc / 2
    )
      continue;
    g.beginPath();
    g.moveTo(px + Math.cos(a) * (R - W / 2), py + Math.sin(a) * (R - W / 2));
    g.lineTo(
      px + Math.cos(a + 0.12) * (R + (W / 2) * k),
      py + Math.sin(a + 0.12) * (R + (W / 2) * k),
    );
    g.stroke();
  }
}

registerZonePainter('f13_stomp', (g, z, px, py, S) => {
  stompRing(g, z as ZoneX, px, py, S, RED, true);
  return true;
});
registerZonePainter('f13_shards', (g, z, px, py, S, time) => {
  const zz = z as ZoneX;
  stompRing(g, zz, px, py, S, hx('#6ae0f0'), false);
  // Осколки дрожат на кольце.
  const k = kOf(zz);
  g.fillStyle = rgba(hx('#d8f6ff'), 0.5 + 0.5 * k);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU + Math.sin(time * 20 + i) * 0.05;
    const r = zz.r * S;
    g.fillRect(Math.round(px + Math.cos(a) * r), Math.round(py + Math.sin(a) * r), 1, 2);
  }
  return true;
});

registerZonePainter('f13_grab', (g, z, px, py, S) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const R = zz.r * S;
  // Тень ладони сверху: растёт и темнеет, пальцы сжимаются к центру.
  g.fillStyle = rgba(hx('#000000'), 0.15 + 0.4 * k);
  g.beginPath();
  g.ellipse(px, py, R * (0.5 + 0.5 * k), R * (0.35 + 0.35 * k), 0, 0, TAU);
  g.fill();
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI * 0.85 + (i / 4) * Math.PI * 0.7;
    const r0 = R * (1.4 - 0.7 * k);
    g.fillRect(
      Math.round(px + Math.cos(a) * r0) - 1,
      Math.round(py + Math.sin(a) * r0 * 0.7) - 1,
      3,
      3,
    );
  }
  g.strokeStyle = rgba(RED, 0.45 + 0.55 * k);
  g.lineWidth = 1;
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.stroke();
  return true;
});

registerZonePainter('f13_land', (g, z, px, py, S) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const R = zz.r * S;
  // Прыгун в воздухе: тень растёт туда, где он сядет.
  g.fillStyle = rgba(hx('#000000'), 0.12 + 0.4 * k);
  g.beginPath();
  g.ellipse(px, py, R * (0.3 + 0.7 * k), R * (0.2 + 0.45 * k), 0, 0, TAU);
  g.fill();
  g.strokeStyle = rgba(RED, 0.4 + 0.6 * k);
  g.lineWidth = 1;
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.stroke();
  return true;
});

registerZonePainter('f13_kick', (g, z, px, py, S) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const L = zz.r * S;
  const w = (zz.w ?? 0.5) * S;
  g.save();
  g.translate(px, py);
  g.rotate(zz.ang ?? 0);
  g.fillStyle = rgba(RED, 0.12 + 0.3 * k);
  g.fillRect(0, -w, L, w * 2);
  g.fillStyle = rgba(HOT, 0.4 + 0.6 * k);
  g.fillRect(0, -w, Math.round(L * k), 1);
  g.fillRect(0, w - 1, Math.round(L * k), 1);
  // Шевроны вдоль удара.
  for (let x = 4; x < L * k; x += 7) {
    g.fillRect(Math.round(x), -2, 1, 1);
    g.fillRect(Math.round(x) + 1, -1, 1, 2);
    g.fillRect(Math.round(x), 1, 1, 1);
  }
  g.restore();
  return true;
});

// --- Пыль, пар, дым.

registerZonePainter('f13_dust', (g, z, px, py, S, time) => {
  const zz = z as ZoneX;
  const life = (zz as Zone).life ?? 1;
  const t = zz.t / life;
  const R = zz.r * S * (0.5 + t * 0.7);
  billow(g, px, py, R, hx('#b8a890'), 0.55 * (1 - t), t, zz.id, 4, 6);
  void time;
  return true;
});

registerZonePainter('f13_evap', (g, z, px, py, S) => {
  const zz = z as ZoneX;
  const life = (zz as Zone).life ?? 3;
  const t = zz.t / life;
  const R = zz.r * S;
  // Тело тает паром: белые клубы столбом, выше и прозрачнее к концу.
  billow(g, px, py - R * 0.3, R, STEAMC, 0.65 * (1 - t * 0.8), zz.t * 0.6, zz.id, R * 1.6, 7);
  billow(
    g,
    px,
    py - R * 0.8,
    R * 0.7,
    hx('#d8d4d0'),
    0.45 * (1 - t),
    zz.t * 0.5 + 0.3,
    zz.id + 3,
    R * 2,
    5,
  );
  return true;
});
registerZonePainter('f13_evapbig', (g, z, px, py, S) => {
  const zz = z as ZoneX;
  const life = (zz as Zone).life ?? 5;
  const t = zz.t / life;
  const R = zz.r * S;
  billow(g, px, py - R * 0.4, R, STEAMC, 0.7 * (1 - t * 0.7), zz.t * 0.5, zz.id, R * 2.2, 10);
  billow(
    g,
    px,
    py - R * 1.2,
    R * 0.8,
    hx('#e0dcd8'),
    0.5 * (1 - t),
    zz.t * 0.4 + 0.5,
    zz.id + 7,
    R * 2.6,
    7,
  );
  // Угли в пару — Колосс выгорает изнутри.
  specks(g, px, py - R * 0.5, R * 0.8, 10, hx('#ff8a2a'), 0.8 * (1 - t), zz.t, zz.id);
  return true;
});

registerZonePainter('f13_smoke', (g, z, px, py, S) => {
  const zz = z as ZoneX;
  const R = zz.r * S;
  billow(g, px, py, R, hx('#4a4642'), 0.7 * fadeOf(zz), zz.t * 0.35, zz.id, 3, 8);
  billow(g, px, py, R * 0.7, hx('#6a6660'), 0.5 * fadeOf(zz), zz.t * 0.3 + 0.5, zz.id + 2, 4, 5);
  return true;
});

// --- Трос, пушка, валун, набат.

registerZonePainter('f13_rope', (g, z, px, py, S) => {
  const zz = z as ZoneX;
  const sim = paintSim();
  if (!sim) return true;
  // Конец троса — у кольца цели; другой — у героя или контрабандиста.
  let ax = zz.x;
  let ay = zz.y;
  let bx: number;
  let by: number;
  if ((zz.mob ?? -1) < 0) {
    bx = sim.hero.x;
    by = sim.hero.y - 0.55;
  } else {
    const m = sim.mobs.find((q) => q.id === zz.mob);
    if (!m) return true;
    ax = zz.tx ?? zz.x;
    ay = zz.ty ?? zz.y;
    bx = m.x;
    by = m.y - 0.6;
  }
  const X0 = px + (ax - zz.x) * S;
  const Y0 = py + (ay - zz.y) * S - 10;
  const X1 = px + (bx - zz.x) * S;
  const Y1 = py + (by - zz.y) * S;
  // Тень героя на земле, пока летит.
  const st = f13State(sim);
  if ((zz.mob ?? -1) < 0 && st?.shadow) {
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath();
    g.ellipse(px + (st.shadow[0] - zz.x) * S, py + (st.shadow[1] - zz.y) * S, 5, 2, 0, 0, TAU);
    g.fill();
  }
  const sag = Math.min(8, Math.hypot(X1 - X0, Y1 - Y0) * 0.06);
  const n = Math.max(6, Math.round(Math.hypot(X1 - X0, Y1 - Y0) / 2));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = X0 + (X1 - X0) * t;
    const y = Y0 + (Y1 - Y0) * t + Math.sin(t * Math.PI) * sag;
    g.fillStyle = i % 3 === 0 ? rgba(STEEL, 0.95) : rgba(hx('#8a8478'), 0.95);
    g.fillRect(Math.round(x), Math.round(y), 1, 1);
  }
  // Кошка на конце.
  g.fillStyle = rgba(STEEL, 1);
  g.fillRect(Math.round(X0) - 1, Math.round(Y0) - 1, 3, 1);
  g.fillRect(Math.round(X0) - 1, Math.round(Y0), 1, 2);
  g.fillRect(Math.round(X0) + 1, Math.round(Y0), 1, 2);
  return true;
});

registerZonePainter('f13_lane', (g, z, px, py, S, time) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const L = zz.r * S;
  // Полоса у движка — `w` в обе стороны от оси.
  const w = (zz.w ?? 0.9) * S;
  g.save();
  g.translate(px, py);
  g.rotate(zz.ang ?? 0);
  // Своя пушка — золото: этим ты бьёшь исполинов.
  g.fillStyle = rgba(GOLD, 0.08 + 0.2 * k);
  g.fillRect(0, -w, L, w * 2);
  g.fillStyle = rgba(GOLD, 0.5 + 0.5 * k);
  for (let x = (time * 90) % 10; x < L; x += 10) g.fillRect(Math.round(x), -1, 4, 2);
  g.fillRect(0, -Math.round(w), L, 1);
  g.fillRect(0, Math.round(w) - 1, L, 1);
  g.restore();
  return true;
});

registerZonePainter('f13_ball', (g, z, px, py, S) => {
  const zz = z as ZoneX;
  const a = zz.ang ?? 0;
  const L = (zz.len ?? 10) * S;
  const k = zz.k ?? 0.45;
  const u = Math.min(1, zz.t / k);
  const x = px + Math.cos(a) * L * u;
  const y = py + Math.sin(a) * L * u - Math.sin(u * Math.PI) * 6;
  if (u < 1) {
    // Ядро и огненный след.
    for (let i = 1; i < 6; i++) {
      const b = Math.max(0, u - i * 0.03);
      g.fillStyle = rgba(hx('#ff9a3a'), 0.6 - i * 0.1);
      g.fillRect(
        Math.round(px + Math.cos(a) * L * b) - 1,
        Math.round(py + Math.sin(a) * L * b - Math.sin(b * Math.PI) * 6) - 1,
        3,
        3,
      );
    }
    g.fillStyle = '#16161a';
    g.beginPath();
    g.arc(Math.round(x), Math.round(y), 2.5, 0, TAU);
    g.fill();
    g.fillStyle = '#8e8e98';
    g.fillRect(Math.round(x) - 1, Math.round(y) - 2, 1, 1);
  } else {
    // Взрыв в конце.
    const t = (zz.t - k) / 0.4;
    g.fillStyle = rgba(HOT, 0.9 * (1 - t));
    g.beginPath();
    g.arc(Math.round(x), Math.round(y), 4 + t * 10, 0, TAU);
    g.fill();
    billow(g, x, y, 10 + t * 8, hx('#9a948a'), 0.6 * (1 - t), t, zz.id, 6, 6);
  }
  return true;
});

registerZonePainter('f13_muzzle', (g, z, px, py, S) => {
  const zz = z as ZoneX;
  const life = (zz as Zone).life ?? 0.9;
  const t = zz.t / life;
  if (zz.t < 0.12) {
    g.fillStyle = rgba(HOT, 0.95);
    g.beginPath();
    g.arc(px, py, zz.r * S * 0.7, 0, TAU);
    g.fill();
    g.fillStyle = rgba(WHITE, 0.9);
    g.beginPath();
    g.arc(px, py, zz.r * S * 0.35, 0, TAU);
    g.fill();
  }
  billow(g, px, py, zz.r * S * (0.7 + t), hx('#d8d4cc'), 0.6 * (1 - t), t, zz.id, 10, 6);
  return true;
});

registerZonePainter('f13_roll', (g, z, px, py, S) => {
  const zz = z as ZoneX;
  const life = (zz as Zone).life ?? 1;
  const u = Math.min(1, zz.t / life);
  const e = u * u;
  const x = px + ((zz.tx ?? zz.x) - zz.x) * S * e;
  const y = py + ((zz.ty ?? zz.y) - zz.y) * S * e - 8;
  // Катится глыба: тень, камень, полосы вращения, пыль следом.
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.beginPath();
  g.ellipse(Math.round(x), Math.round(y + 8), 9, 3, 0, 0, TAU);
  g.fill();
  g.fillStyle = '#6e665c';
  g.beginPath();
  g.arc(Math.round(x), Math.round(y), 8, 0, TAU);
  g.fill();
  g.fillStyle = '#48423c';
  g.beginPath();
  g.arc(Math.round(x) + 2, Math.round(y) + 2, 6, 0, TAU);
  g.fill();
  g.strokeStyle = '#24211e';
  g.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    const a = zz.t * 12 + i * 2.1;
    g.beginPath();
    g.moveTo(x + Math.cos(a) * 3, y + Math.sin(a) * 3);
    g.lineTo(x + Math.cos(a) * 7, y + Math.sin(a) * 7);
    g.stroke();
  }
  billow(g, px + (x - px) * 0.7, py + (y - py) * 0.7 + 8, 8, hx('#b8a890'), 0.5, u, zz.id, 3, 4);
  return true;
});

registerZonePainter('f13_crush', () => true);

registerZonePainter('f13_bellwave', (g, z, px, py, S) => {
  const zz = z as ZoneX;
  const life = (zz as Zone).life ?? 0.9;
  const t = zz.t / life;
  const R = zz.r * S;
  // Звон кольцами: золото расходится от колокола.
  g.lineWidth = 2;
  for (let i = 0; i < 3; i++) {
    const tt = t - i * 0.15;
    if (tt <= 0 || tt >= 1) continue;
    g.strokeStyle = rgba(GOLD, 0.8 * (1 - tt));
    g.beginPath();
    g.ellipse(px, py, R * tt, R * tt * 0.7, 0, 0, TAU);
    g.stroke();
  }
  return true;
});

// --- Пожар, балки, обломки, завал.

const FLAME_SPR = new Map<number, HTMLCanvasElement>();
function flameImg(f: number): HTMLCanvasElement {
  let c = FLAME_SPR.get(f);
  if (!c) {
    const p = new Px(14, 18);
    flame(p, 7, 17, 11, 14 + (f % 2) * 2, f, 2);
    c = p.canvas();
    FLAME_SPR.set(f, c);
  }
  return c;
}

registerZonePainter('f13_fire', (g, z, px, py, S, time) => {
  const zz = z as ZoneX;
  const warn = (zz as Zone).warn ?? 0;
  if (zz.t < warn) {
    const k = zz.t / warn;
    g.fillStyle = rgba(hx('#ff6a1a'), 0.15 + 0.3 * k);
    g.beginPath();
    g.arc(px, py, zz.r * S, 0, TAU);
    g.fill();
    return true;
  }
  const fade = fadeOf(zz);
  g.globalAlpha = fade;
  g.fillStyle = rgba(hx('#ff5a18'), 0.22);
  g.beginPath();
  g.ellipse(px, py + 2, zz.r * S, zz.r * S * 0.55, 0, 0, TAU);
  g.fill();
  const f = Math.floor(time * 9 + zz.id) % 4;
  g.drawImage(flameImg(f), Math.round(px - 7), Math.round(py - 14));
  g.globalAlpha = 1;
  return true;
});

registerZonePainter('f13_beam', (g, z, px, py, S) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const R = zz.r * S;
  // Горящая балка падает с крыши: тень растёт, балка летит сверху.
  g.fillStyle = rgba(hx('#000000'), 0.15 + 0.35 * k);
  g.fillRect(Math.round(px - R), Math.round(py - 2), Math.round(R * 2), 4);
  g.strokeStyle = rgba(RED, 0.4 + 0.6 * k);
  g.lineWidth = 1;
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.stroke();
  const drop = (1 - k * k) * 48;
  g.fillStyle = '#3a2416';
  g.fillRect(Math.round(px - R * 0.9), Math.round(py - drop - 3), Math.round(R * 1.8), 3);
  g.fillStyle = '#ff8a2a';
  g.fillRect(Math.round(px - R * 0.9), Math.round(py - drop - 4), Math.round(R * 1.8), 1);
  return true;
});

registerZonePainter('f13_debris', (g, z, px, py, S) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const R = zz.r * S;
  g.fillStyle = rgba(hx('#000000'), 0.12 + 0.35 * k);
  g.beginPath();
  g.ellipse(px, py, R * (0.4 + 0.6 * k), R * (0.25 + 0.4 * k), 0, 0, TAU);
  g.fill();
  g.strokeStyle = rgba(RED, 0.35 + 0.6 * k);
  g.lineWidth = 1;
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.stroke();
  // Кусок Стены в воздухе — виден только в последнюю треть.
  if (k > 0.66) {
    const drop = (1 - (k - 0.66) / 0.34) * 40;
    g.fillStyle = '#6a6864';
    g.fillRect(Math.round(px - 5), Math.round(py - drop - 8), 10, 7);
    g.fillStyle = '#46464a';
    g.fillRect(Math.round(px - 5), Math.round(py - drop - 2), 10, 1);
    g.fillRect(Math.round(px), Math.round(py - drop - 8), 1, 6);
  }
  return true;
});

const RUBBLE_SPR = new Map<number, HTMLCanvasElement>();
registerZonePainter('f13_rubble', (g, z, px, py, S) => {
  const zz = z as ZoneX;
  const v = zz.id % 3;
  let c = RUBBLE_SPR.get(v);
  if (!c) {
    const p = new Px(24, 16);
    for (let i = 0; i < 7; i++)
      shadeEll(
        p,
        4 + hash(i, v) * 16,
        5 + hash(v, i) * 8,
        1.6 + hash(i, v, 3) * 1.8,
        1.3 + hash(i, v, 4),
        i % 3 ? COBBLE : STONE,
      );
    p.outline(INK);
    c = p.canvas();
    RUBBLE_SPR.set(v, c);
  }
  g.globalAlpha = fadeOf(zz);
  const sc = Math.min(1.4, (zz.r * S) / 12);
  g.drawImage(
    c,
    Math.round(px - 12 * sc),
    Math.round(py - 8 * sc),
    Math.round(24 * sc),
    Math.round(16 * sc),
  );
  g.globalAlpha = 1;
  return true;
});

// ---------------------------------------------------------------------------
// Снаряды: камни метателя, осыпь, глыба Колосса — кувыркаются.
// ---------------------------------------------------------------------------

function rockSprite(key: string, r: number, masonry: boolean, f: number): Sprite {
  return spr(
    `${key}|${f}`,
    Math.ceil(r * 2 + 4),
    Math.ceil(r * 2 + 4),
    (p) => {
      const c = r + 2;
      shadeEll(
        p,
        c,
        c,
        r,
        r * 0.88,
        masonry ? tn('#241c18', '#4a3e36', '#766858', '#a8987e') : STONE,
      );
      const a = (f / 4) * TAU;
      for (let i = 0; i < 3; i++) {
        const aa = a + i * 2.1;
        stroke(
          p,
          c + Math.cos(aa) * r * 0.2,
          c + Math.sin(aa) * r * 0.2,
          c + Math.cos(aa) * r * 0.8,
          c + Math.sin(aa) * r * 0.8,
          masonry ? hx('#2a201a') : STONE[0],
        );
      }
      p.outline(INK);
    },
    Math.ceil(r * 2 + 2),
    Math.ceil(r + 2),
  );
}

registerShotPainter('f13_rock', (s, time) =>
  rockSprite('rock', 3.4, false, Math.floor(time * 10 + s.id) % 4),
);
registerShotPainter('f13_pebble', (s, time) =>
  rockSprite('pebble', 2, false, Math.floor(time * 12 + s.id) % 4),
);
registerShotPainter('f13_boulder', (s, time) =>
  rockSprite('boulderShot', 6.5, true, Math.floor(time * 8 + s.id) % 4),
);

// ---------------------------------------------------------------------------
// Вещи этажа.
// ---------------------------------------------------------------------------

registerItemArt('f13mat', () => {
  // Жила исполина: красное волокно в светлой оболочке, тлеет.
  const p = new Px(12, 12);
  for (let i = 0; i < 12; i++) {
    const t = i / 11;
    const x = 2 + t * 8;
    const y = 9 - Math.sin(t * Math.PI) * 5;
    p.ell(x, y, 1.6, 1.6, tone(MUSCLE, 0.6 + Math.sin(i) * 0.15));
  }
  for (let i = 0; i < 10; i += 2) p.set(3 + i * 0.8, 8 - Math.sin((i / 10) * Math.PI) * 5, SINEW);
  p.outline(INK);
  p.set(6, 3, hx('#ffd07a'));
  return p;
});
registerItemArt('f13_tooth', () => {
  const p = new Px(12, 12);
  poly(
    p,
    [
      [3, 2],
      [9, 2],
      [8, 8],
      [7, 11],
      [5, 11],
      [4, 8],
    ],
    (x) => tone(BONE, 0.85 - (x - 3) * 0.08),
  );
  stroke(p, 6, 3, 6, 9, BONE[1]);
  p.outline(INK);
  return p;
});
registerItemArt('f13_plate', () => {
  const p = new Px(12, 12);
  shadeEll(p, 6, 6, 5, 4.5, PLATE, 0.05);
  stroke(p, 2, 6, 10, 6, hx('#4a4238'));
  stroke(p, 5, 2, 7, 10, hx('#4a4238'));
  p.outline(INK);
  return p;
});
registerItemArt('f13_shard', () => {
  const p = new Px(12, 12);
  poly(
    p,
    [
      [6, 0],
      [9, 5],
      [7, 11],
      [4, 11],
      [3, 5],
    ],
    (x) => tone(CRYST, x < 6 ? 0.85 : 0.45),
  );
  stroke(p, 6, 1, 5, 10, CRYST[3]);
  p.outline(INK);
  return p;
});
registerItemArt('f13_feather', () => {
  const p = new Px(12, 12);
  // Перо: светлый стержень, опахало шире к середине, синий отлив.
  for (let i = 0; i < 9; i++) {
    const x = 2 + i;
    const y = 10 - i;
    const w = i < 2 ? 0 : i > 7 ? 1 : 2;
    for (let k = 1; k <= w; k++) {
      p.set(x - k, y - k + 1, i % 2 ? CROW_T[2] : hx('#3a4460'));
      p.set(x + k - 1, y + k, CROW_T[1]);
    }
    p.set(x, y, hx('#8a8490'));
  }
  p.outline(INK);
  return p;
});
registerItemArt('f13_rope', () => {
  const p = new Px(12, 12);
  // Бухта троса: три витка кольцом.
  for (let r = 0; r < 3; r++)
    for (let a = 0; a < 24; a++) {
      const t = (a / 24) * TAU;
      const c = Math.sin(t) < 0 ? ROPE[3 - (r === 2 ? 1 : 0)] : ROPE[1];
      p.set(
        Math.round(6 + Math.cos(t) * (3 + r * 0.7)),
        Math.round(7 + Math.sin(t) * (2.4 + r * 0.5)),
        c,
      );
    }
  p.set(10, 2, IRON[3]);
  p.set(9, 3, IRON[3]);
  p.set(11, 3, IRON[2]);
  p.outline(INK);
  return p;
});
registerItemArt('f13_heart', () => {
  // Сердце Колосса: раскалённый ком в сетке жил.
  const p = new Px(12, 12);
  shadeEll(p, 6, 6.5, 5, 4.6, tn('#3a0806', '#8a1a10', '#e04a1a', '#ffb040'));
  for (let i = 0; i < 4; i++) stroke(p, 2 + i * 2, 3, 3 + i * 2, 10, alpha(SINEW, 0.6));
  p.ell(5, 5, 1.4, 1.2, hx('#fff0a0'));
  p.outline(INK);
  return p;
});
registerItemArt('f13_ration', () => {
  const p = new Px(12, 12);
  p.rect(2, 4, 9, 9, tn('#3a2a14', '#6e5430', '#a08050', '#c8aa74')[2]);
  for (let x = 2; x <= 9; x++) p.set(x, 4, hx('#e8d8b0'));
  stroke(p, 2, 6, 9, 6, hx('#5a3a1a'));
  p.set(5, 7, hx('#8a2a1a'));
  p.outline(INK);
  return p;
});
registerItemArt('f13_crowmeat', () => {
  const p = new Px(12, 12);
  shadeEll(p, 5, 6, 3.6, 3, tn('#3a1008', '#7a2a18', '#b0503a', '#d88060'));
  stroke(p, 7, 8, 10, 10, BONE[2]);
  p.set(10, 11, BONE[3]);
  p.set(11, 10, BONE[3]);
  p.outline(INK);
  return p;
});
