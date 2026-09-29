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
import type { WorldObj } from '../dungeon-world';
import { F13_BELL, F13_MARK, F13_OUTER, F13_WALL } from './f13';
import { BELL, CANNON, COL, f13State } from './f13-brains';

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
    const hot = p.data[i] > 230 && p.data[i + 1] > 120 && p.data[i + 1] < 215 && p.data[i + 2] < 130;
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
      if (k >= 2 && rel > 0.3 && rel < 0.55 && dx < p.w * 0.2 && dx > 0.6 && (y - top) % 3 === 0) c = tone(BONE, 0.75 - dx / p.w);
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
  for (let x = Math.round(cx - rx + 1); x <= Math.round(cx + rx - 1); x++) p.set(x, Math.round(cy + ry * 0.2), seam);
  if (!side) for (let y = Math.round(cy - ry + 1); y <= Math.round(cy + ry - 1); y++) p.set(Math.round(cx), y, seam);
}

/** Кристальная скорлупа поверх фигуры: голубые грани. */
function crystalShell(p: Px, k: number, seed: number): void {
  // Грани: ближайшая из редких точек-центров даёт плоскость со своим тоном,
  // по краю грани — светлое ребро. Полосами (как было) читалось леденцом.
  const pts: [number, number, number][] = [];
  for (let i = 0; i < 26; i++) pts.push([hash(i, seed, 1) * p.w, hash(seed, i, 2) * p.h, hash(i, seed, 3)]);
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
  bulk: 1.38,
  belly: 0.1,
  arms: 1.14,
  legs: 0.9,
  head: 0.23,
  grin: 1.02,
  eyes: 'blank',
};
const COL_THIN: GiantLook = {
  ...COL_LOOK,
  bulk: 1.08,
  arms: 1.08,
  skin: tn('#240605', '#5e130f', '#9a2c1a', '#e06a30'),
};
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

/**
 * Мясо без кожи — жилами, а не точками: волокна идут косыми нитями только по
 * освещённой стороне (по тени они читаются сыпью). В «Испарении» те же нити
 * горят изнутри.
 */
function fibers(p: Px, from: number, to: number, hot: boolean, f: number): void {
  const sinew = alpha(SINEW, 0.5);
  for (let y = Math.max(0, Math.floor(from)); y < Math.min(p.h, to); y++)
    for (let x = 0; x < p.w; x++) {
      const i = (y * p.w + x) * 4;
      if (p.data[i + 3] < 255) continue;
      const r = p.data[i];
      // Только мышца (красное), не зубы, не кость, не контур.
      if (r < 90 || p.data[i + 1] > 150) continue;
      const lit = r > (hot ? 150 : 170);
      const lane = (x * 2 + Math.floor(y / 3)) % 7;
      if (hot) {
        if (lane === 0 && hash(x, Math.floor(y / 4), 17) > 0.25)
          p.set(x, y, EMBER[(Math.floor(y / 2) + f) % 3 === 0 ? 2 : lit ? 1 : 0]);
      } else if (lit && lane === 0) p.set(x, y, sinew);
    }
}

/** Лицо Колосса: глазницы, горящие зрачки, щёки-волокна, зубы без губ. */
function colFace(p: Px, g: Geo, roar: boolean, phase: number): void {
  const { headCx: cx, headCy: cy, headRx: rx, headRy: ry } = g;
  const sock = hx('#1a0405');
  const pupil = phase >= 3 ? EMBER[2] : hx('#fff2c0');
  // Лоб — кость, чуть светлее мяса.
  for (let x = Math.round(cx - rx * 0.7); x <= Math.round(cx + rx * 0.7); x++) {
    const k = (x - cx) / (rx * 0.7);
    const y0 = Math.round(cy - ry * 0.75 + k * k * ry * 0.3);
    p.set(x, y0, tone(BONE, 0.55 - k * 0.2));
    p.set(x, y0 + 1, tone(BONE, 0.35 - k * 0.2));
  }
  // Глазницы — глубокие, зрачок светится.
  const ey = Math.round(cy - ry * 0.2);
  for (const s of [-1, 1]) {
    const ex = cx + s * rx * 0.42;
    p.ell(ex, ey, 1.9, 1.4, sock);
    p.set(Math.round(ex), ey, pupil);
    if (phase >= 3) p.set(Math.round(ex) - s, ey, EMBER[1]);
  }
  // Нос — две щели.
  p.set(Math.round(cx - 0.6), Math.round(cy + ry * 0.12), sock);
  p.set(Math.round(cx + 0.6), Math.round(cy + ry * 0.12), sock);
  // Щёки — волокна вниз к челюсти.
  for (const s of [-1, 1])
    for (let k = 0; k < 3; k++) {
      const x = Math.round(cx + s * (rx * 0.55 + k));
      stroke(p, x, cy + ry * 0.05, x - s * 0.5, cy + ry * 0.55, tone(MUSCLE, 0.75 - k * 0.15));
    }
  // Зубы без губ: два ряда во всю ширину челюсти.
  const my = Math.round(cy + ry * 0.5);
  const w = rx * 0.82;
  const gap = roar ? 3 : 0;
  for (let x = Math.round(cx - w); x <= Math.round(cx + w); x++) {
    const k = (x - cx) / w;
    const drop = Math.round(k * k * 1.2);
    const tooth = x % 2 === 0 ? TEETH : mixc(TEETH, BONE[1], 0.45);
    // Дёсны — светлое мясо над и под.
    p.set(x, my - 3 + drop, tone(MUSCLE, 0.95));
    p.set(x, my - 2 + drop, tooth);
    p.set(x, my - 1 + drop, tooth);
    for (let y = 0; y <= gap; y++) p.set(x, my + drop + y, MOUTH);
    p.set(x, my + 1 + gap + drop, tooth);
    p.set(x, my + 2 + gap + drop, tooth);
    p.set(x, my + 3 + gap + drop, tone(MUSCLE, 0.9));
  }
}

/** Рёбра анфас, хребет и лопатки со спины. */
function colBones(p: Px, g: Geo, view: View): void {
  if (view === 'front') {
    for (let r = 0; r < 5; r++) {
      const y = g.chestY + 3 + r * 3;
      const w = g.shW * (0.74 - r * 0.07);
      for (let x = Math.round(g.cx - w); x <= Math.round(g.cx + w); x++) {
        if (Math.abs(x - g.cx) < 1.5) continue;
        const k = (x - g.cx) / w;
        const c = tone(BONE, 0.72 - Math.abs(k) * 0.35);
        p.set(x, Math.round(y + k * k * 2.5), c);
      }
    }
    // Грудина.
    for (let y = Math.round(g.chestY + 2); y < Math.round(g.chestY + 16); y++) p.set(Math.round(g.cx), y, tone(BONE, 0.5));
  } else if (view === 'back') {
    // Хребет — позвонки, лопатки — кость.
    for (let y = Math.round(g.neckY + 2); y < Math.round(g.hipY - 1); y += 2) {
      p.set(Math.round(g.cx), y, tone(BONE, 0.75));
      p.set(Math.round(g.cx) - 1, y, tone(BONE, 0.35));
      p.set(Math.round(g.cx) + 1, y, tone(BONE, 0.35));
    }
    for (const s of [-1, 1]) {
      const x0 = g.cx + s * g.shW * 0.3;
      const x1 = g.cx + s * g.shW * 0.72;
      stroke(p, x0, g.chestY + 3, x1, g.chestY + 4, tone(BONE, 0.6));
      stroke(p, x0, g.chestY + 3, x0 + s * 1.5, g.chestY + 11, tone(BONE, 0.45));
      stroke(p, x1, g.chestY + 4, x0 + s * 1.5, g.chestY + 11, tone(BONE, 0.3));
    }
  } else {
    for (let r = 0; r < 4; r++) stroke(p, g.cx - 3, g.chestY + 4 + r * 3, g.cx + 4, g.chestY + 5 + r * 3, tone(BONE, 0.55));
    // Хребет по спине.
    for (let y = Math.round(g.neckY + 2); y < Math.round(g.hipY - 1); y += 2) p.set(Math.round(g.cx - g.shW * 0.5), y, tone(BONE, 0.6));
  }
}

interface ColLook {
  phase: number;
  view: View;
  f: number;
  back: boolean;
  cut: boolean;
  cloaked: boolean;
  roar: boolean;
  kneel: boolean;
  rock: boolean;
}

function colDeco(c: ColLook) {
  return (p: Px, g: Geo) => {
    fibers(p, g.chestY - 2, g.ay + 1, c.phase >= 3, c.f);
    colBones(p, g, c.view);
    if (c.view === 'front') colFace(p, g, c.roar, c.phase);
    else if (c.view === 'side') {
      // Профиль: зубы без губ до самого уха.
      const my = Math.round(g.headCy + g.headRy * 0.5);
      for (let x = Math.round(g.headCx - g.headRx * 0.3); x <= Math.round(g.headCx + g.headRx + 0.5); x++) {
        p.set(x, my - 1, x % 2 ? TEETH : mixc(TEETH, BONE[1], 0.45));
        p.set(x, my + 1 + (c.roar ? 2 : 0), x % 2 ? mixc(TEETH, BONE[1], 0.45) : TEETH);
      }
      p.set(Math.round(g.headCx + g.headRx * 0.5), Math.round(g.headCy - g.headRy * 0.2), c.phase >= 3 ? EMBER[2] : hx('#fff2c0'));
    }
    if (c.rock) {
      // Глыба кладки над головой: бурый камень с кирпичными швами.
      const rx = g.headCx;
      const ry = g.headCy - g.headRy - 7;
      shadeEll(p, rx, ry, 9, 6.5, tn('#241c18', '#4a3e36', '#766858', '#a8987e'));
      const seam = hx('#2a201a');
      for (let y = Math.round(ry - 4); y <= Math.round(ry + 4); y += 3) {
        for (let x = Math.round(rx - 7); x <= Math.round(rx + 7); x++) if (p.solid(x, y)) p.set(x, y, seam);
        const off = (y / 3) % 2 ? 0 : 2;
        for (let x = Math.round(rx - 6 + off); x <= Math.round(rx + 6); x += 4)
          for (let yy = y + 1; yy < y + 3; yy++) if (p.solid(x, yy)) p.set(x, yy, seam);
      }
    }
  };
}

/** После контура: затылок, пар, звёзды. */
function colPost(c: ColLook) {
  return (p: Px, g: Geo) => {
    const nx = g.side ? g.headCx - g.headRx * 0.8 : g.headCx;
    if (c.kneel) {
      // Склонил голову — затылок открыт сверху, видно с любой стороны.
      const ny = c.view === 'back' ? g.neckY + 0.5 : g.headCy - g.headRy - 1;
      nape(p, Math.round(nx), Math.round(ny), true, c.cut, 2);
      stars(p, Math.round(g.headCx), Math.round(g.headCy - g.headRy - 7), 9, c.f);
    } else if (c.cloaked && c.view !== 'front') {
      // Плащ пара закрывает затылок — крюк за спину, чтобы сорвать.
      puff(p, nx, g.neckY - 1, 7, 0.95, c.f + 40);
    } else if (c.view === 'front' && c.back) {
      // Ты за спиной: затылок горит ореолом по обе стороны шеи.
      for (const s of [-1, 1])
        for (let k = 0; k < 4; k++)
          p.set(
            Math.round(g.headCx + s * (g.headRx + 1 + k * 0.4)),
            Math.round(g.headCy + g.headRy * 0.6 + k),
            alpha(NAPE_GLOW, 0.95 - k * 0.2),
          );
    }
    // Пар из плеч — редкими клубами, выше в «Испарении».
    const n = c.cloaked ? 5 : c.phase >= 3 ? 4 : 2;
    for (let i = 0; i < n; i++) {
      const s = i % 2 ? 1 : -1;
      const x = g.cx + s * g.shW * (0.6 + hash(i, c.f) * 0.5);
      const rise = ((c.f + i * 2) % 4) * 2.5;
      const y = g.chestY - 3 - rise - hash(c.f, i, 3) * 4;
      puff(p, x, y, 2.4 + hash(i, c.f, 5) * 2 + rise * 0.3, (c.cloaked ? 0.75 : 0.55) * (1 - rise / 14), i * 13 + c.f);
    }
  };
}

function colPose(m: Mob, pose: MobPose): { g: GPose; key: string } {
  const view = viewOf(m.face);
  const back = (m.data.back ?? 0) > 0;
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
      g.armL = view === 'side' ? [0.1, -0.98] : [-0.3, -0.95];
      g.armR = view === 'side' ? [-0.1, -0.98] : [0.3, -0.95];
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
      // На колено, ладони в землю, голова вниз.
      g.squat = 17;
      g.lean = 6;
      g.armL = view === 'side' ? [0.75, 0.75] : [0.45, 0.85];
      g.armR = view === 'side' ? [0.55, 0.8] : [-0.45, 0.85];
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

/** Срезать низ кадра на `cut` точек и опустить — фигура встаёт из земли. */
function fromGround(b: Built, cut: number): Built {
  if (cut <= 0) return b;
  const o = new Px(b.p.w, b.p.h);
  for (let y = 0; y < b.ay - cut; y++)
    for (let x = 0; x < b.p.w; x++) {
      const i = (y * b.p.w + x) * 4;
      if (!b.p.data[i + 3]) continue;
      o.set(x, y + cut, [b.p.data[i], b.p.data[i + 1], b.p.data[i + 2], b.p.data[i + 3]]);
    }
  // Земля расходится: пар по кромке.
  for (let i = 0; i < 5; i++) puff(o, b.ax + (i - 2) * 7, b.ay - 2, 4 + (i % 2) * 2, 0.8, i * 5 + cut);
  return { ...b, p: o };
}

registerMobPainter('f13boss', (m, pose) => {
  const phase = m.data.phase ?? 0;
  const cloaked = phase === 1 && !((m.data.bareT ?? 0) > 0);
  const lk = phase >= 3 ? COL_THIN : COL_LOOK;
  const f = Math.floor(pose.frame / 2) % 4;
  const dk = deathK(pose);
  const view = viewOf(m.face);
  if (pose.mode === 'dying') {
    return frameOf(`col|die|${view}|${dk}`, pose, () => {
      const c: ColLook = { phase: 3, view, f: dk, back: false, cut: false, cloaked: false, roar: true, kneel: false, rock: false };
      const b = drawGiant(lk, { ...GP0, view, squat: dk * 5, roar: true, lean: dk * 2 }, 3, colDeco(c));
      return { ...b, p: evaporate(b.p, dk, 3) };
    });
  }
  const { g, key } = colPose(m, pose);
  const c: ColLook = {
    phase,
    view: g.view,
    f,
    back: g.back,
    cut: g.cut,
    cloaked,
    roar: g.roar,
    kneel: pose.mode === 'kneel',
    rock: pose.mode === 'throw',
  };
  const rise = pose.mode === 'rise' ? Math.min(5, Math.floor((pose.t / COL.rise) * 6)) : 5;
  const k = `col|${key}|${phase >= 3 ? 3 : 0}|${+cloaked}|${+g.back}|${+g.cut}|${f}|${rise}`;
  return frameOf(
    k,
    pose,
    () => {
      const b = drawGiant(lk, g, 3, colDeco(c), colPost(c));
      return rise < 5 ? fromGround(b, Math.round((1 - rise / 5) * 60)) : b;
    },
    heroHidden(m, 5.4),
  );
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
    for (let x = Math.round(cx - 10); x < Math.round(cx + 6); x += 2) p.set(x, Math.round(ay - 14 + low), tone(S, 0.1));
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
    for (let x = Math.round(cx - 6); x <= Math.round(cx + 6); x += 2) p.set(x, Math.round(hy0 - 1.5 + (x % 4 === 0 ? 1 : 0)), HAIR[1]);
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
    shadeEll(p, cx + s * 5.5, ay - 2.5 - lift, 1.8, 1.4, tn('#5a3a2a', '#a07a5a', '#d0aa84', '#f0d0a8'));
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
    poly(p, [
      [cx - 2, by - 0.5],
      [cx + 2.5, by - 0.5],
      [tipX + 1, tipY],
      [tipX - 3, tipY + (dy < 0 ? 1.5 : -1.5)],
    ], t[2]);
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
  poly(p, [
    [cx - 3, by],
    [cx - 8, by - 1 + (sleep ? 2 : 0)],
    [cx - 8, by + 2],
  ], B[1]);
  shadeEll(p, cx, by, swoop ? 4.8 : 4, 2.6, B);
  shadeEll(p, cx + 3.8, by - 1.6, 2.2, 2, B, 0.05);
  // Клюв и глаз.
  p.set(cx + 6, by - 1, hx('#6a6470'));
  p.set(cx + 7, by - 1, hx('#9a94a0'));
  p.set(cx + 6, by, hx('#4a4450'));
  p.set(cx + 4, by - 2, hx('#ffcc40'));
  if (swoop) {
    // Пике: крылья сложены назад.
    poly(p, [
      [cx - 3, by - 1.5],
      [cx + 3, by - 1.5],
      [cx - 7, by + 0.5],
    ], B[2]);
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
  poly(p, [
    [cx - 2.5, ay - 13],
    [cx + 3, ay - 13],
    [cx + 3.8, ay - 5],
    [cx - 3, ay - 5],
  ], (x, y) => tone(CLOAK, 0.62 - (x - cx) * 0.07 - (y - (ay - 13)) * 0.03));
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
const MOSAIC_C = [hx('#2a2420'), hx('#4a5a6a'), hx('#9a4a2e'), hx('#b8903e'), hx('#d8c8a0'), hx('#6a2a1e')];
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
      if (m === MK.pad || m === MK.drain || m === MK.crack || m === MK.blood || m === MK.weeds || m === MK.rubble) m = MK.cobble;
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
    if (!ends.length) ends.push([2 + Math.round(hash(s, 1) * 4), 3], [12, 12 + Math.round(hash(s, 2) * 2)]);
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
    for (let x = 4; x <= 11; x += 2) for (let y = 4; y <= 11; y++) p.set(x, y, y === 4 ? hx('#8a847c') : hx('#4a4642'));
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
    for (let x = 3; x <= 13; x += 2) for (let y = 3; y <= 13; y++) {
      const d = Math.hypot((x - 8) / 6.5, (y - 8) / 5.5);
      if (d < 1) p.set(x, y, y < 8 ? hx('#5a534c') : hx('#2e2a26'));
    }
    for (let a = 0; a < 24; a++) {
      const t = (a / 24) * TAU;
      p.set(Math.round(8 + Math.cos(t) * 6.5), Math.round(8 + Math.sin(t) * 5.5), Math.sin(t) < 0 ? hx('#8a847c') : hx('#2a2622'));
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
        if (d < 1 && hash(x, y, s) < 1 - d * 0.7) p.set(x, y, alpha(hx('#0e0806'), 0.75 * (1 - d * 0.5)));
      }
    for (let i = 0; i < 4; i++) p.set(Math.round(3 + hash(i, s) * 10), Math.round(3 + hash(s, i) * 10), hx('#ff6a1a'));
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
      if (up && y < 5) return y === 4 ? hx('#0a1418') : tone(GRANITE, 0.62 - y * 0.08 + hash(X >> 2, 5) * 0.08);
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
      if (y < 4) return tone(tn('#1e1812', '#3a2e22', '#5a4632', '#7a6044'), 0.5 - (y - 2) * 0.15 + hash(X, 2) * 0.1);
      const band = Math.floor((y - 4) / 2);
      return tone(tn('#0e0b09', '#1e1914', '#302820', '#44382c'), 0.6 - band * 0.18 + hash(X >> 1, band, 4) * 0.12);
    }
    if (lf && x < 2) return mixc(tone(COBBLE, 0.15), hx('#050404'), x / 2);
    if (rt && x > 13) return mixc(tone(COBBLE, 0.1), hx('#050404'), (15 - x) / 2);
    // Далеко внизу — сток: тёмная вода с редкой рябью, у края светлее.
    const far = up ? Math.min(1, (y - 10) / 6) : 1;
    const ripple = Math.sin(X * 0.3 + Y * 0.8) + Math.sin(X * 0.11 - Y * 0.23);
    if (far > 0.5 && ripple > 1.75 && hash(X >> 2, Y >> 1, 12) < 0.35) return hx('#1a2c32');
    return mixc(hx('#0c0b0a'), hx('#081014'), far) ;
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
    if ((X + off) % 16 === 0 || Y % 8 === 0) return hash(X, Y, 2) < 0.2 ? mixc(tone(WALLST, 0.14), MOSS, 0.5) : tone(WALLST, 0.14);
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
      if (hash(sId, r, 57) < 0.75 - d * 0.14) p.set(x, y, tone(DIRT, 0.45 + hash(X >> 1, Y >> 1, 3) * 0.2));
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
      for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && !c.open(dx, dy) && c.markAt(dx, dy) === 0) cellar = true;
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

function spr(key: string, w: number, h: number, draw: (p: Px) => void, ay = h, ax = Math.floor(w / 2)): Sprite {
  const hit = PROPS.get(key);
  if (hit) return hit;
  const p = new Px(w, h);
  draw(p);
  const s: Sprite = { img: p.canvas(), ax, ay };
  PROPS.set(key, s);
  return s;
}

/** Та же картинка белой вспышкой (удар по ящику). */
function sprFlash(key: string, w: number, h: number, flash: boolean, draw: (p: Px) => void, ay = h): Sprite {
  return spr(`${key}|${+flash}`, w, h, (p) => {
    draw(p);
    if (flash) {
      const q = p.tint(WHITE, 0.75);
      p.data.set(q.data);
    }
  }, ay);
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
  p.set(Math.round(cx + Math.cos(a + 0.4) * r), Math.round(cy + Math.sin(a + 0.4) * r * 0.8), hx('#ffcc40'));
}

registerPropPainter('f13_hook', (o, time) => {
  const on = hookReady(o) <= 0;
  const f = on ? frameAt(o, time, 6, 6) : 0;
  return spr(`hook|${+on}|${f}`, 16, 30, (p) => {
    shadowOn(p, 8, 26, 6);
    // Столб: брус с железными бандажами.
    for (let y = 6; y < 26; y++)
      for (let x = 6; x <= 9; x++) p.set(x, y, tone(TIMBER, x === 6 ? 0.8 : x === 9 ? 0.25 : 0.55 - (y % 7 === 0 ? 0.2 : 0)));
    for (const y of [10, 18, 24]) for (let x = 5; x <= 10; x++) p.set(x, y, x < 7 ? IRON[3] : IRON[2]);
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
    for (let a = 0; a < 4; a++) p.set(Math.round(cx + Math.cos(a * 1.57) * (r - 1)), Math.round(cy + Math.sin(a * 1.57) * (r - 1)), TIMBER[0]);
  };
  if (dir === 'side') {
    // Лафет, два колеса, ствол вправо.
    poly(p, [
      [4, 16],
      [16, 14],
      [17, 18],
      [4, 20],
    ], (x) => tone(PLANK, 0.5 - x * 0.01));
    wheel(8 - kick, 18, 3.4);
    const bx = 3 - kick;
    for (let x = bx; x < bx + 18; x++) {
      const r = 2.6 - (x - bx) * 0.05;
      for (let y = Math.round(13 - r); y <= Math.round(13 + r); y++) {
        const l = 0.75 - Math.abs(y - (13 - r * 0.4)) * 0.18;
        p.set(x, y, tone(BRONZE, l));
      }
    }
    for (const x of [bx + 3, bx + 9, bx + 16]) for (let y = 10; y <= 16; y++) if (p.solid(x, y)) p.set(x, y, BRONZE[1]);
    p.ell(bx + 1, 13, 1.6, 1.6, BRONZE[2]);
    p.set(bx + 17, 12, hx('#0a0806'));
    p.set(bx + 17, 13, hx('#0a0806'));
    wheel(15 - kick, 18, 3.4);
    if (smoke > 0) for (let i = 0; i < 3; i++) cloud(p, bx + 21 + i * 1.5, 12 - i * 2, 2 + smoke * 1.5, alpha(hx('#d8d4cc'), 0.5 * smoke), i + 3, 1);
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
    if (smoke > 0) for (let i = 0; i < 3; i++) cloud(p, 9 + i * 3, y0 + 7 + i, 2 + smoke * 1.5, alpha(hx('#d8d4cc'), 0.45 * smoke), i + 7, 1);
  } else {
    // От нас: казённик с шишкой, ствол уходит вверх.
    wheel(4, 17, 3.6);
    wheel(20, 17, 3.6);
    p.rect(6, 14, 18, 19, tone(PLANK, 0.45));
    for (let y = 2 + kick; y <= 16; y++) {
      const r = 2.6 + (y - 2) * 0.1;
      for (let x = Math.round(12 - r); x <= Math.round(12 + r); x++) p.set(x, y, tone(BRONZE, 0.75 - Math.abs(x - 11) * 0.12));
    }
    p.ell(12, 17, 2, 1.6, BRONZE[3]);
    if (smoke > 0) for (let i = 0; i < 3; i++) cloud(p, 10 + i * 2, 1 + i, 2 + smoke, alpha(hx('#d8d4cc'), 0.45 * smoke), i + 5, 1);
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
  return spr(`cannon|${dir}|${+left}|${kick}|${smoke}`, 24, 26, (p) => {
    const q = new Px(24, 26);
    drawCannon(q, dir, kick, smoke);
    p.data.set((left ? q.flipX() : q).data);
  }, 24);
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
    for (const x of [2, 22]) for (let y = 4; y < 24; y++) p.set(x, y, tone(TIMBER, 0.6 - (x > 10 ? 0.25 : 0)));
    for (let x = 2; x <= 22; x++) p.set(x, 4, tone(TIMBER, 0.7));
    if (!used) {
      // Цепи держат глыбу.
      for (let y = 5; y < 12; y++) {
        p.set(7, y, IRON[(y + f) % 2 ? 1 : 3]);
        p.set(18, y, IRON[(y + f + 1) % 2 ? 1 : 3]);
      }
      shadeEll(p, 12.5, 16, 9, 7.5, STONE);
      for (let i = 0; i < 6; i++) p.set(Math.round(8 + hash(i, 5) * 9), Math.round(12 + hash(5, i) * 8), STONE[0]);
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
  const swing = bell && bell.cd > BELL.cd - 2.5 ? Math.sin(time * 9) * (bell.cd - (BELL.cd - 2.5)) / 2.5 : 0;
  const k = Math.round(swing * 3);
  const f = frameAt(o, time, 4, 3);
  return spr(`bell|${k}|${f}`, 28, 36, (p) => {
    shadowOn(p, 14, 32, 12, 3);
    // Рама из брусьев.
    for (const x of [3, 24]) for (let y = 6; y < 33; y++) p.set(x, y, tone(TIMBER, x < 10 ? 0.65 : 0.3));
    for (const x of [4, 23]) for (let y = 6; y < 33; y++) p.set(x, y, tone(TIMBER, x < 10 ? 0.45 : 0.2));
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
    for (let y = top + 19; y < 32; y++) p.set(Math.round(cx + 5 - k * 0.3 + Math.sin(y * 0.6 + f) * 0.4), y, ROPE[2]);
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
      p.set(Math.round(18 + Math.cos(a) * r), Math.round(23.5 + Math.sin(a) * r * 0.34), hx('#4a8aa0'));
    }
    // Передняя стенка чаши — под кромкой.
    for (let x = 3; x <= 33; x++) {
      const u = (x - 18) / 15.5;
      if (Math.abs(u) > 1) continue;
      const y0 = Math.round(23 + Math.sqrt(1 - u * u) * 6);
      for (let y = y0; y < y0 + 3; y++) p.set(x, y, tone(STONE, 0.45 - u * 0.2 - (y - y0) * 0.08));
    }
    // Столп и верхняя чаша.
    for (let y = 8; y < 23; y++) for (let x = 16; x <= 19; x++) p.set(x, y, tone(STONE, x === 16 ? 0.8 : 0.45));
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
    poly(p, [
      [3, 8],
      [15, 6],
      [17, 10],
      [4, 11],
    ], (x, y) => tone(CL, 0.6 - (y - 6) * 0.08 + x * 0.005));
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
    for (const x of [3, 16]) for (let y = 4; y < 20; y++) p.set(x, y, tone(TIMBER, x < 10 ? 0.6 : 0.3));
    poly(p, [
      [1, 6],
      [10, 1],
      [19, 6],
      [17, 7],
      [3, 7],
    ], (x, y) => tone(ROOFS[0], 0.7 - y * 0.06 - (x > 10 ? 0.15 : 0)));
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
    for (const x of [2, 21]) for (let y = 6; y < 22; y++) p.set(x, y, tone(TIMBER, x < 10 ? 0.6 : 0.3));
    // Навес.
    for (let y = 2; y < 8; y++)
      for (let x = 0; x < 24; x++) {
        const on = Math.floor(x / 3) % 2 === 0;
        p.set(x, y + (f && x % 6 < 3 && y === 7 ? 1 : 0), mixc(on ? stripe : hx('#e0d4b8'), INK, (y - 2) * 0.05));
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
    for (let i = 0; i < 2; i++) puff(p, 6 + i * 6, 5 - ((f + i * 2) % 4) * 1.2, 2 + ((f + i) % 3) * 0.6, 0.55, f + i * 3);
  });
});

registerPropPainter('f13_statue', () =>
  spr('statue', 20, 46, (p) => {
    shadowOn(p, 10, 42, 9, 2.6);
    // Постамент с карнизом.
    for (let y = 30; y < 43; y++)
      for (let x = 3; x <= 16; x++) p.set(x, y, tone(PLAZA, (y === 30 ? 0.85 : 0.55) - (x - 3) * 0.02 - (y === 35 ? 0.2 : 0)));
    for (let x = 2; x <= 17; x++) p.set(x, 29, tone(PLAZA, 0.9));
    // Каменный страж: плащ до пят, ладони на навершии меча остриём вниз.
    const B = tn('#2e2a26', '#57504a', '#827a70', '#aca296');
    poly(p, [
      [5.5, 29],
      [14.5, 29],
      [12.8, 12],
      [7.2, 12],
    ], (x, y) => tone(B, 0.66 - (x - 5.5) * 0.05 - (y - 12) * 0.004));
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
    for (let i = 0; i < 4; i++) stroke(p, 6.5 + i * 2, 20 + i, 6.5 + i * 2, 24 + i, alpha(hx('#1e1a16'), 0.35));
    p.set(6, 28, MOSS);
    p.set(14, 27, MOSS);
    p.outline(INK);
  }),
);

registerPropPainter('f13_laundry', (o, time) => {
  const f = frameAt(o, time, 3, 3);
  const v = Math.floor(phaseOf(o.id) * 3);
  return spr(`laundry|${v}|${f}`, 18, 30, (p) => {
    // Верёвка через улицу над головой; бельё полощется.
    for (let x = 0; x < 18; x++) p.set(x, 3 + Math.round(Math.sin((x / 17) * Math.PI) * 2), ROPE[1]);
    const cloth = [hx('#d8d0c0'), hx('#8a3a2a'), hx('#3a5a7a'), hx('#c8b060')];
    for (let i = 0; i < 3; i++) {
      const x0 = 2 + i * 5;
      const c = cloth[(i + v) % 4];
      const y0 = 4 + Math.round(Math.sin(((x0 + 2) / 17) * Math.PI) * 2);
      const sway = ((f + i) % 3) - 1;
      for (let y = 0; y < 7 + (i % 2) * 2; y++)
        for (let x = 0; x < 4; x++) p.set(x0 + x + (y > 3 ? sway : 0), y0 + y, mixc(c, INK, x === 3 ? 0.3 : y * 0.03));
    }
    p.outline(INK);
  }, 30);
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
      shadeEll(p, 4 + hash(i, v) * 16, 18 + hash(v, i) * 4, 2 + hash(i, v, 3), 1.6, i % 2 ? COBBLE : tn('#3a1a12', '#6e3222', '#9a4a32', '#c06a4a'));
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
    for (let i = 0; i < 4; i++) p.set(4 + i * 3, 29 + (i % 2), i % 2 ? hx('#e8e4dc') : hx('#1a171e'));
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
          p.set(x0 + x, y0 + y, tone(PLANK, edge ? 0.3 : diag ? 0.45 : 0.62 - (y % 3 === 0 ? 0.1 : 0)));
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
        const l = 0.55 + (y === 3 ? 0.3 : 0) - x * 0.015 + (hash(x, y, 2) < 0.3 ? 0.12 : 0) - (hash(x, y, 5) < 0.15 ? 0.2 : 0);
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
  return spr(`fire|${f}`, 20, 38, (p) => {
    // Горит крыша: языки выше конька, дым над ними.
    flame(p, 10, 30, 14, 20 + (f % 2) * 3, f, 1);
    flame(p, 5, 31, 6, 10, f + 1, 2);
    flame(p, 15, 31, 7, 12, f + 2, 5);
    for (let i = 0; i < 2; i++) puff(p, 9 + i * 3, 7 - ((f + i * 2) % 4), 3 + i, 0.4, f + i);
    for (let i = 0; i < 3; i++) p.set(4 + ((f * 5 + i * 6) % 12), 4 + ((f * 3 + i * 4) % 10), FLAME[3]);
  }, 34);
});

registerPropPainter('f13_chimney', (o, time) => {
  const f = frameAt(o, time, 4, 3);
  return spr(`chimney|${f}`, 16, 36, (p) => {
    // Кирпичная труба на крыше и дым столбом.
    for (let y = 18; y < 30; y++)
      for (let x = 5; x <= 10; x++) {
        const brick = (y % 3 === 0 || (x + (Math.floor(y / 3) % 2) * 2) % 4 === 0);
        p.set(x, y, brick ? hx('#3a1a12') : tone(tn('#3a1a12', '#6e3222', '#9a4a32', '#c06a4a'), 0.6 - (x - 5) * 0.08));
      }
    p.rect(4, 17, 11, 18, tone(STONE, 0.7));
    p.outline(INK);
    for (let i = 0; i < 4; i++) {
      const t = ((f + i) % 4) / 4 + i * 0.0;
      puff(p, 7.5 + Math.sin(i * 1.7 + f) * 1.2 + i * 0.6, 15 - i * 4 - t * 3, 2 + i * 0.7, 0.55 - i * 0.1, f + i * 7);
    }
  }, 30);
});

registerPropPainter('f13_banner', (o, time) => {
  const f = frameAt(o, time, 3, 3);
  return spr(`banner|${f}`, 12, 18, (p) => {
    // Знамя города на Стене: две башни в щите.
    for (let x = 1; x <= 10; x++) p.set(x, 1, IRON[2]);
    for (let y = 2; y < 16; y++)
      for (let x = 2; x <= 9; x++) {
        const tail = y > 12 && Math.abs(x - 5.5) < (y - 12) * 1.2;
        if (tail) continue;
        const wave = Math.round(Math.sin(y * 0.6 + f * 2) * 0.6);
        p.set(x + (y > 6 ? wave : 0), y, tone(tn('#2a0806', '#5a140e', '#8a2418', '#b8402a'), 0.55 - (x - 2) * 0.05));
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
  }, 14);
});

registerPropPainter('f13_torch', (o, time) => {
  const f = frameAt(o, time, 4, 10);
  return spr(`torch|${f}`, 10, 18, (p) => {
    p.rect(4, 10, 5, 15, TIMBER[2]);
    p.rect(3, 12, 6, 13, IRON[2]);
    flame(p, 4.5, 10, 5, 7 + (f % 2), f, 4);
  }, 14);
});

// ---------------------------------------------------------------------------
// Метки ударов и облака. Язык этажа: исполин бьёт красным, «горит» к удару;
// крюк, трос, пушка и набат — золото и сталь (это твоё); пар — белый.
// ---------------------------------------------------------------------------

type ZoneX = (Zone | Strike) & { ang?: number; len?: number; arc?: number; w?: number; tx?: number; ty?: number; mob?: number; k?: number };

const rgba = (c: RGBA, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
const RED = hx('#e8402a');
const HOT = hx('#ffd27a');
const GOLD = hx('#f0b040');
const STEEL = hx('#e8eef4');
const STEAMC = hx('#f4f1ec');

/** Доля метки 0…1 (удар — по `warn`; облако — по своему `warn`). */
const kOf = (z: ZoneX) => {
  const w = (z as Strike).warn;
  if (typeof w === 'number' && w > 0) return Math.min(1, z.t / w);
  return 1;
};
/** Облако тает к концу жизни. */
const fadeOf = (z: ZoneX) => {
  const life = (z as Zone).life;
  if (typeof life !== 'number') return 1;
  return Math.max(0, Math.min(1, (life - z.t) / 0.5));
};

function conePath(g: CanvasRenderingContext2D, x: number, y: number, r: number, a: number, arc: number): void {
  g.beginPath();
  g.moveTo(x, y);
  g.arc(x, y, r, a - arc / 2, a + arc / 2);
  g.closePath();
}

function ringPath(g: CanvasRenderingContext2D, x: number, y: number, r0: number, r1: number, a?: number, arc?: number): void {
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
function specks(g: CanvasRenderingContext2D, x: number, y: number, r: number, n: number, color: RGBA, a: number, time: number, seed: number): void {
  g.fillStyle = rgba(color, a);
  for (let i = 0; i < n; i++) {
    const ang = hash(i, seed) * TAU + time * (0.4 + hash(seed, i) * 0.6);
    const rr = r * (0.2 + 0.8 * ((hash(i, seed, 3) + time * 0.3) % 1));
    g.fillRect(Math.round(x + Math.cos(ang) * rr), Math.round(y + Math.sin(ang) * rr * 0.8), 2, 2);
  }
}

/** Клубы пара/пыли: мягкие круги, поднимаются. */
function billow(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: RGBA, a: number, t: number, seed: number, rise = 6, n = 5): void {
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
  g.fillRect(Math.round(px + Math.cos(ea) * R * 0.8) - 1, Math.round(py + Math.sin(ea) * R * 0.8) - 1, 3, 3);
  return true;
});

function stompRing(g: CanvasRenderingContext2D, zz: ZoneX, px: number, py: number, S: number, col: RGBA, crack: boolean): void {
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
  if (zz.arc !== undefined && zz.ang !== undefined) g.arc(px, py, rr, zz.ang - zz.arc / 2, zz.ang + zz.arc / 2);
  else g.arc(px, py, rr, 0, TAU);
  g.stroke();
  if (!crack) return;
  g.strokeStyle = rgba(hx('#1a0c08'), 0.5 * k);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + zz.id;
    if (zz.arc !== undefined && zz.ang !== undefined && Math.abs(((a - zz.ang + Math.PI * 3) % TAU) - Math.PI) > zz.arc / 2) continue;
    g.beginPath();
    g.moveTo(px + Math.cos(a) * (R - W / 2), py + Math.sin(a) * (R - W / 2));
    g.lineTo(px + Math.cos(a + 0.12) * (R + W / 2 * k), py + Math.sin(a + 0.12) * (R + W / 2 * k));
    g.stroke();
  }
}

registerZonePainter('f13_stomp', (g, z, px, py, S) => {
  stompRing(g, z as ZoneX, px, py, S, RED, true);
  return true;
});
registerZonePainter('f13_foot', (g, z, px, py, S) => {
  stompRing(g, z as ZoneX, px, py, S, RED, true);
  return true;
});
registerZonePainter('f13_steamring', (g, z, px, py, S, time) => {
  const zz = z as ZoneX;
  stompRing(g, zz, px, py, S, hx('#ffb080'), false);
  const k = kOf(zz);
  if (k > 0.6) specks(g, px, py, zz.r * S, 18, STEAMC, (k - 0.6) * 2, time, zz.id);
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
    g.fillRect(Math.round(px + Math.cos(a) * r0) - 1, Math.round(py + Math.sin(a) * r0 * 0.7) - 1, 3, 3);
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
  billow(g, px, py - R * 0.8, R * 0.7, hx('#d8d4d0'), 0.45 * (1 - t), zz.t * 0.5 + 0.3, zz.id + 3, R * 2, 5);
  return true;
});
registerZonePainter('f13_evapbig', (g, z, px, py, S) => {
  const zz = z as ZoneX;
  const life = (zz as Zone).life ?? 5;
  const t = zz.t / life;
  const R = zz.r * S;
  billow(g, px, py - R * 0.4, R, STEAMC, 0.7 * (1 - t * 0.7), zz.t * 0.5, zz.id, R * 2.2, 10);
  billow(g, px, py - R * 1.2, R * 0.8, hx('#e0dcd8'), 0.5 * (1 - t), zz.t * 0.4 + 0.5, zz.id + 7, R * 2.6, 7);
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

registerZonePainter('f13_cloak', (g, z, px, py, S, time) => {
  const zz = z as ZoneX;
  const R = zz.r * S;
  const sim = paintSim();
  const col = sim?.mobs.find((m) => m.kind === 'f13boss');
  // Сорван крюком — плащ редеет, затылок виден.
  const bare = (col?.data.bareT ?? 0) > 0;
  const a0 = (bare ? 0.12 : 0.34) * fadeOf(zz);
  // Туман у ног — плотный, кольцом.
  g.fillStyle = rgba(STEAMC, a0 * 0.7);
  g.beginPath();
  g.ellipse(px, py, R * 1.1, R * 0.5, 0, 0, TAU);
  g.fill();
  // Клубы по всему росту: поднимаются и кружат вокруг тела.
  for (let i = 0; i < 14; i++) {
    const ph = (time * 0.35 + i / 14) % 1;
    const a = (i / 14) * TAU + time * 0.6;
    const x = px + Math.cos(a) * R * (0.7 + 0.25 * Math.sin(i))
    const y = py + Math.sin(a) * R * 0.35 - ph * 70;
    const rr = 5 + ph * 7 + (i % 3);
    g.fillStyle = rgba(STEAMC, a0 * (1 - ph * 0.7));
    g.beginPath();
    g.arc(Math.round(x), Math.round(y), rr, 0, TAU);
    g.fill();
  }
  return true;
});

registerZonePainter('f13_heat', (g, z, px, py, S, time) => {
  const zz = z as ZoneX;
  const R = zz.r * S;
  // Жар вокруг: оранжевое кольцо дрожит, угли взлетают.
  g.strokeStyle = rgba(hx('#ff6a1a'), 0.3 + 0.12 * Math.sin(time * 7));
  g.lineWidth = 2;
  g.beginPath();
  g.ellipse(px, py, R, R * 0.6, 0, 0, TAU);
  g.stroke();
  g.fillStyle = rgba(hx('#ff5a18'), 0.1 * fadeOf(zz));
  g.fill();
  specks(g, px, py - 6, R, 12, hx('#ffb040'), 0.8 * fadeOf(zz), time, zz.id);
  return true;
});

registerZonePainter('f13_jet', (g, z, px, py, S, time) => {
  const zz = z as ZoneX;
  const warn = (zz as Zone).warn ?? 0;
  const R = zz.r * S;
  if (zz.t < warn) {
    // Отдушина раскаляется: кольцо и шипение.
    const k = zz.t / warn;
    g.strokeStyle = rgba(hx('#ff8a2a'), 0.4 + 0.6 * k);
    g.lineWidth = 1;
    g.beginPath();
    g.arc(px, py, R, 0, TAU);
    g.stroke();
    g.fillStyle = rgba(hx('#ff6a1a'), 0.12 + 0.25 * k);
    g.fill();
    specks(g, px, py, R * 0.6, 6, STEAMC, 0.5 * k, time, zz.id);
    return true;
  }
  // Столб пара.
  const t = (zz.t - warn) / Math.max(0.1, ((zz as Zone).life ?? 1.2) - warn);
  for (let i = 0; i < 7; i++) {
    const h = i * 6 + ((time * 40) % 6);
    const rr = R * (0.45 + i * 0.08);
    g.fillStyle = rgba(STEAMC, (0.6 - i * 0.07) * (1 - t * 0.6));
    g.beginPath();
    g.arc(Math.round(px + Math.sin(i + time * 5) * 1.5), Math.round(py - h), rr, 0, TAU);
    g.fill();
  }
  return true;
});

registerZonePainter('f13_ventburst', (g, z, px, py, S, time) => {
  const zz = z as ZoneX;
  const warn = (zz as Zone).warn ?? 0;
  const R = zz.r * S;
  if (zz.t < warn) {
    const k = zz.t / warn;
    g.fillStyle = rgba(hx('#ffb080'), 0.08 + 0.2 * k);
    g.beginPath();
    g.arc(px, py, R, 0, TAU);
    g.fill();
    g.strokeStyle = rgba(STEAMC, 0.4 + 0.6 * k);
    g.lineWidth = 1;
    g.stroke();
    g.beginPath();
    g.arc(px, py, R * k, 0, TAU);
    g.stroke();
    return true;
  }
  const t = (zz.t - warn) / Math.max(0.1, ((zz as Zone).life ?? 2) - warn);
  billow(g, px, py, R * (0.8 + t * 0.4), STEAMC, 0.55 * (1 - t), time * 0.8, zz.id, 8, 12);
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
  for (let x = ((time * 90) % 10); x < L; x += 10) g.fillRect(Math.round(x), -1, 4, 2);
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
      g.fillRect(Math.round(px + Math.cos(a) * L * b) - 1, Math.round(py + Math.sin(a) * L * b - Math.sin(b * Math.PI) * 6) - 1, 3, 3);
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
      shadeEll(p, 4 + hash(i, v) * 16, 5 + hash(v, i) * 8, 1.6 + hash(i, v, 3) * 1.8, 1.3 + hash(i, v, 4), i % 3 ? COBBLE : STONE);
    p.outline(INK);
    c = p.canvas();
    RUBBLE_SPR.set(v, c);
  }
  g.globalAlpha = fadeOf(zz);
  const sc = Math.min(1.4, (zz.r * S) / 12);
  g.drawImage(c, Math.round(px - 12 * sc), Math.round(py - 8 * sc), Math.round(24 * sc), Math.round(16 * sc));
  g.globalAlpha = 1;
  return true;
});

// ---------------------------------------------------------------------------
// Снаряды: камни метателя, осыпь, глыба Колосса — кувыркаются.
// ---------------------------------------------------------------------------

function rockSprite(key: string, r: number, masonry: boolean, f: number): Sprite {
  return spr(`${key}|${f}`, Math.ceil(r * 2 + 4), Math.ceil(r * 2 + 4), (p) => {
    const c = r + 2;
    shadeEll(p, c, c, r, r * 0.88, masonry ? tn('#241c18', '#4a3e36', '#766858', '#a8987e') : STONE);
    const a = (f / 4) * TAU;
    for (let i = 0; i < 3; i++) {
      const aa = a + i * 2.1;
      stroke(p, c + Math.cos(aa) * r * 0.2, c + Math.sin(aa) * r * 0.2, c + Math.cos(aa) * r * 0.8, c + Math.sin(aa) * r * 0.8, masonry ? hx('#2a201a') : STONE[0]);
    }
    p.outline(INK);
  }, Math.ceil(r * 2 + 2), Math.ceil(r + 2));
}

registerShotPainter('f13_rock', (s, time) => rockSprite('rock', 3.4, false, Math.floor(time * 10 + s.id) % 4));
registerShotPainter('f13_pebble', (s, time) => rockSprite('pebble', 2, false, Math.floor(time * 12 + s.id) % 4));
registerShotPainter('f13_boulder', (s, time) => rockSprite('boulderShot', 6.5, true, Math.floor(time * 8 + s.id) % 4));

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
  poly(p, [
    [3, 2],
    [9, 2],
    [8, 8],
    [7, 11],
    [5, 11],
    [4, 8],
  ], (x) => tone(BONE, 0.85 - (x - 3) * 0.08));
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
  poly(p, [
    [6, 0],
    [9, 5],
    [7, 11],
    [4, 11],
    [3, 5],
  ], (x) => tone(CRYST, x < 6 ? 0.85 : 0.45));
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
      p.set(Math.round(6 + Math.cos(t) * (3 + r * 0.7)), Math.round(7 + Math.sin(t) * (2.4 + r * 0.5)), c);
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

