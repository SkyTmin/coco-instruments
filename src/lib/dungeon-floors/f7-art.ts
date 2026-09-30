// Этаж 7 «Зеркальный лабиринт» — рисовальщики: монстры, реквизит, свои
// клетки трёх районов, метки ударов, снаряды, иконки вещей.
//
// Откуда картинки:
//   • Отражение и Отражение героя — ЛИСТ САМОГО ГЕРОЯ (Ninja Adventure,
//     CC0, `public/dungeon/na/`) в его нынешнем снаряжении: отражение ростом
//     с героя, босс — вдвое крупнее (Scale2x, затем трещины, грани и блики
//     в полный пиксель, чтобы не было «крупного пикселя»). Перекраска —
//     холодное стекло, лицо — светящиеся прорези;
//   • стеклянный голем — тайл DCSS `crystal_guardian` (CC0), перекрашен в
//     стекло этажа и разрезан на части для кадров (`scripts/dungeon/f7.py
//     --sprites` → `public/dungeon/f7/golem.png`), трещины рисует код;
//   • остальное рисует код: пиксели 16 на клетку, свет сверху-слева, контур
//     тёмный. Палитра — камень 0x72 + холодное стекло + фиолетовый акцент;
//     позолота рам — приглушённая, это материал дворца, а не акцент.
//
// Кадры собираются один раз и лежат в кеше: ключ — вид, поза, кадр, сторона,
// вспышка, облик (и ступень снаряжения у отражений).

import { Px } from '../dungeon-art';
import { heroSprite } from '../dungeon-sprites';
import type { Dir4 } from '../dungeon-sprites';
import { floorCell, wallCell } from '../dungeon-tiles';
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
import type { Mob, Sim, Strike, Zone } from '../dungeon-sim';
import { F7_CRYSTAL, F7_GALLERY, F7_HALL, F7_MARK } from './f7';
import { BOSS, F7_VIEW } from './f7-brains';

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
const css = (c: RGBA, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

const INK = hx('#10101a');
const WHITE = hx('#ffffff');
const GOLD = hx('#ffcc40');
export const TAU = Math.PI * 2;
export const TS = 16;
export const MAP_W = 64;

/** Четыре тона формы: тень, основа, свет, блик. */
type Tones = [RGBA, RGBA, RGBA, RGBA];

/** Стекло этажа: густая тень → блик. */
const GL: Tones = [hx('#28395a'), hx('#4a78a2'), hx('#88badc'), hx('#e2f6ff')];
/** Серебро зеркальной амальгамы. */
const SILV: Tones = [hx('#394252'), hx('#667588'), hx('#a9b8cb'), hx('#eef4fc')];
/** Позолота рам (приглушённая). */
const GILT: Tones = [hx('#4a3216'), hx('#86602a'), hx('#c29a48'), hx('#f2dc98')];
/** Фиолетовый акцент «той стороны». */
const VIO: Tones = [hx('#2a1c4c'), hx('#583c9c'), hx('#9a7ae2'), hx('#dccaff')];
const CYAN = hx('#9aeaff');
const CYAN_HOT = hx('#e0fbff');

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

/** Конечность-капсула от (x0, y0) до (x1, y1) со светом по нормали. */
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

/** Линия (толщиной w). */
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

/** Детерминированный шум по трём числам, 0…1. */
const hash = (a: number, b: number, c = 0) => {
  let h = (a * 374761393 + b * 668265263 + c * 1274126177) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** Наложить `src` на `dst` со сдвигом (прозрачное не трогает). */
function over(dst: Px, src: Px, ox: number, oy: number, k = 1): void {
  for (let y = 0; y < src.h; y++)
    for (let x = 0; x < src.w; x++) {
      const i = (y * src.w + x) * 4;
      const a = src.data[i + 3];
      if (!a) continue;
      dst.set(x + ox, y + oy, [src.data[i], src.data[i + 1], src.data[i + 2], Math.round(a * k)]);
    }
}

/** Помножить прозрачность всего кадра. */
function fade(p: Px, k: number): Px {
  const o = new Px(p.w, p.h);
  o.data.set(p.data);
  for (let i = 3; i < o.data.length; i += 4) o.data[i] = Math.round(o.data[i] * k);
  return o;
}

/** Холст → пиксели. */
function fromCanvas(c: HTMLCanvasElement): Px {
  const p = new Px(c.width, c.height);
  const g = c.getContext('2d');
  if (g) p.data.set(g.getImageData(0, 0, c.width, c.height).data);
  return p;
}

// ---------------------------------------------------------------------------
// Снаряжение героя — для отражений. Рисовальщику симуляция не видна, поэтому
// ступень берётся из стора (ленивым импортом: статический замкнул бы
// модули). Пока стор не пришёл — Сполох, ступень 8.
// ---------------------------------------------------------------------------

let gearGet: (() => { robe: number; weapon: number }) | null = null;
let gearAsked = false;

function heroGear(): { robe: number; weapon: number } {
  if (!gearAsked && typeof window !== 'undefined') {
    gearAsked = true;
    void import('../../store')
      .then((S) => {
        gearGet = () => {
          const g = S.useFinanceStore.getState().dungeon?.gear;
          return { robe: g?.robe?.tier ?? 8, weapon: g?.weapon?.tier ?? 8 };
        };
      })
      .catch(() => undefined);
  }
  return gearGet?.() ?? { robe: 8, weapon: 8 };
}

const dirOf = (face: number): Dir4 => {
  const c = Math.cos(face);
  const s = Math.sin(face);
  return Math.abs(c) > Math.abs(s) * 1.1 ? (c < 0 ? 'left' : 'right') : s < 0 ? 'up' : 'down';
};

// ---------------------------------------------------------------------------
// Кадр монстра: общий конвейер (облик, вспышка, отражение, кеш).
// ---------------------------------------------------------------------------

type Look = MobPose['look'];

interface Built {
  p: Px;
  ax: number;
  ay: number;
  eye: [number, number] | null;
}

const frames = new Map<string, MobFrame>();

function finish(key: string, b: Built, look: Look, flash: boolean, left: boolean): MobFrame {
  let p = b.p;
  if (look === 'albino') {
    const pale = hx('#f4f2ff');
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
  if (look === 'elite') p.outline(GOLD);
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
  build: () => Built | null,
  mirror = true,
): MobFrame | null {
  const left = mirror && pose.left;
  const key = `${kind}|${anim}|${f}|${left ? 1 : 0}|${pose.flash ? 1 : 0}|${pose.look}`;
  const hit = frames.get(key);
  if (hit) return hit;
  const b = build();
  if (!b) return null;
  return finish(key, b, pose.look, pose.flash, left);
}

/** Разлёт осколками: кадр `p`, разрезанный клиньями, разлетается от середины (k 0…1). */
function shatter(p: Px, cx: number, cy: number, k: number, seed: number): Px {
  const o = new Px(p.w, p.h);
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      const i = (y * p.w + x) * 4;
      if (!p.data[i + 3]) continue;
      // Осколок — клин вокруг середины (по углу), свой сдвиг и падение.
      const a = Math.atan2(y + 0.5 - cy, x + 0.5 - cx);
      const wedge = Math.floor(((a + Math.PI) / TAU) * 7 + hash(seed, Math.floor(y / 4)) * 0.8) % 7;
      const wa = ((wedge + 0.5) / 7) * TAU - Math.PI;
      const sp = 3 + hash(seed, wedge) * 5;
      const nx = Math.round(x + Math.cos(wa) * sp * k);
      const ny = Math.round(y + Math.sin(wa) * sp * k + k * k * 6);
      if (nx < 0 || ny < 0 || nx >= o.w || ny >= o.h) continue;
      const c: RGBA = [
        p.data[i],
        p.data[i + 1],
        p.data[i + 2],
        Math.round(p.data[i + 3] * (1 - k * 0.8)),
      ];
      // Грань осколка светлеет: стекло ловит свет, падая.
      o.set(nx, ny, (x + y + wedge) % 5 === 0 ? mixc(c, alpha(CYAN_HOT, c[3] / 255), 0.6) : c);
    }
  return o;
}

// ---------------------------------------------------------------------------
// Перекраска листа героя в холодное стекло.
// ---------------------------------------------------------------------------

/** Лестница зеркального серебра (отражение — светлее и прозрачнее, босс —
 *  глубже, с фиолетом в тени). Первый заход клал героя в тёмно-синее, и на
 *  тёмном полу он читался звёздным пятном, а не рыцарем. */
const ECHO_RAMP = ['#223258', '#3a5a8e', '#5e88bc', '#90b8e0', '#c6e2f6', '#f0faff'].map((c) =>
  hx(c),
);
const BOSS_RAMP = ['#262a5c', '#3e5298', '#6488c8', '#9cc2ea', '#d0e8fa', '#f8fdff'].map((c) =>
  hx(c),
);

/**
 * Лист героя → зеркальное стекло. Яркость РАСТЯГИВАЕТСЯ по фигуре (у
 * тёмных комплектов она сидела в нижней трети, и всё уходило в одну тень),
 * чёрный контур и прорезь забрала остаются чернилами, тёплое (кожа,
 * отделка) — чуть светлее: стекло подсвечено изнутри. Сверху —
 * две косые полосы блика, как на зеркале.
 */
function glassify(src: Px, ramp: RGBA[], ink: RGBA, sheen = 0, top = 0.72, lift = 0.3): Px {
  const o = new Px(src.w, src.h);
  const lumOf = (i: number) => 0.3 * src.data[i] + 0.55 * src.data[i + 1] + 0.15 * src.data[i + 2];
  let lo = 255;
  let hi = 0;
  for (let i = 0; i < src.data.length; i += 4) {
    if (!src.data[i + 3]) continue;
    const l = lumOf(i);
    if (l < 34) continue;
    lo = Math.min(lo, l);
    hi = Math.max(hi, l);
  }
  // Растяжка мягкая: половина — по фигуре, половина — по общей шкале, иначе
  // светлая кайма плаща заливала белым весь низ, и отражение читалось черепом.
  // Внутри силуэта: все соседи на два пикселя — непрозрачные и не контур.
  const solidLit = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= src.w || y >= src.h) return false;
    const j = (y * src.w + x) * 4;
    return src.data[j + 3] > 0 && lumOf(j) >= 34;
  };
  const inner = (x: number, y: number) =>
    solidLit(x - 2, y) && solidLit(x + 2, y) && solidLit(x, y - 2) && solidLit(x, y + 2);
  const span = Math.max(24, hi - lo) * 0.5 + 110;
  lo = lo * 0.5 + 17;
  const n = ramp.length;
  for (let y = 0; y < src.h; y++)
    for (let x = 0; x < src.w; x++) {
      const i = (y * src.w + x) * 4;
      if (!src.data[i + 3]) continue;
      const l = lumOf(i);
      if (l < 34) {
        o.set(x, y, ink);
        continue;
      }
      const warm = src.data[i] > src.data[i + 2] + 40 ? 0.12 : 0;
      let k = Math.round(((l - lo) / span) * (n - 1) * top + lift + warm * n);
      // Блик: две косые полосы через фигуру — только ВНУТРИ силуэта (на
      // кромке полоса выгрызала край, и шлем обрастал «ушами»).
      if (sheen && inner(x, y)) {
        const d = x - y * 0.9;
        const s0 = src.w * 0.28;
        if (Math.abs(d - s0) < sheen * 0.5) k += 2;
        else if (Math.abs(d - s0 - sheen * 2.2) < sheen * 0.35) k += 1;
      }
      o.set(x, y, ramp[Math.max(0, Math.min(n - 1, k))]);
    }
  // Кант холодного света справа — фигура отделяется от тёмного пола.
  const isInk = (c: RGBA) => c[0] === ink[0] && c[1] === ink[1] && c[2] === ink[2];
  for (let y = 0; y < o.h; y++)
    for (let x = o.w - 1; x > 0; x--) {
      if (!o.solid(x, y)) continue;
      for (let k = 0; k < 3 && x - k >= 0; k++) {
        const c = o.get(x - k, y);
        if (!o.solid(x - k, y) || isInk(c)) continue;
        o.set(x - k, y, mixc(c, ramp[n - 2], 0.55));
        break;
      }
      break;
    }
  return o;
}

/** Кадр героя нужной ступени, стороны и строки листа — пикселями (или null). */
function heroPx(tier: number, dir: Dir4, row: number): Px | null {
  const c = heroSprite(tier, dir, row);
  return c ? fromCanvas(c) : null;
}

/** Трещины отражения: ломаные поверх стекла (тёмная черта, светлый край). */
function crackLines(p: Px, lines: [number, number][][], dark: RGBA, lit: RGBA): void {
  for (const ln of lines)
    for (let i = 0; i + 1 < ln.length; i++) {
      const [x0, y0] = ln[i];
      const [x1, y1] = ln[i + 1];
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
      for (let k = 0; k <= n; k++) {
        const x = Math.round(x0 + ((x1 - x0) * k) / n);
        const y = Math.round(y0 + ((y1 - y0) * k) / n);
        if (!p.solid(x, y)) continue;
        p.set(x, y, dark);
        if (p.solid(x - 1, y - 1)) p.set(x - 1, y - 1, lit);
      }
    }
}

// ---------------------------------------------------------------------------
// Отражение: сам герой в его снаряжении, из тёмного стекла, ростом с героя.
// Повторяет взмах — в руке стеклянный клинок.
// ---------------------------------------------------------------------------

/** Клинок-капсула под любым углом (растеризуется, а не вращается картинка). */
function glassBlade(
  p: Px,
  x: number,
  y: number,
  ang: number,
  len: number,
  w: number,
  hot = 0,
): void {
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  const tx = x + ux * len;
  const ty = y + uy * len;
  const t: Tones = hot
    ? [hx('#5a86c0'), hx('#9ccaf0'), hx('#dff4ff'), WHITE]
    : [hx('#34507c'), hx('#6c9ccc'), hx('#b8e0f8'), hx('#f4fcff')];
  limb(p, x + ux * 1.5, y + uy * 1.5, tx, ty, w, 0.5, t, 0.2);
  // Кромка: светлая линия вдоль лезвия.
  stroke(p, x + ux * 2 - uy * 0.6, y + uy * 2 + ux * 0.6, tx - uy * 0.2, ty + ux * 0.2, t[3]);
  // Гарда и рукоять.
  stroke(
    p,
    x - uy * (w + 1.5),
    y + ux * (w + 1.5),
    x + uy * (w + 1.5),
    y - ux * (w + 1.5),
    GILT[2],
  );
  stroke(p, x - ux * 2, y - uy * 2, x, y, GILT[0]);
}

/** Одна короткая трещина сбоку — забрало (Т-прорезь) должно читаться. */
const ECHO_CRACK: [number, number][][] = [
  [
    [12, 9],
    [11, 11],
    [12, 13],
  ],
];

function paintEcho(
  tier: number,
  dir: Dir4,
  row: number,
  blade: number,
  step: number,
): Built | null {
  const src = heroPx(tier, dir, row);
  if (!src) return null;
  const body = glassify(src, ECHO_RAMP, INK, 1.6, 0.9, 0.95);
  crackLines(body, ECHO_CRACK, hx('#16203a'), hx('#e8f8ff'));
  // Прорези лица светятся (как глаза отражения в темноте).
  const eyes = dir === 'down' ? [6, 9] : dir === 'left' ? [5] : dir === 'right' ? [10] : [];
  for (const ex of eyes) body.set(ex, 7, CYAN_HOT);
  const p = new Px(26, 22);
  // Клинок: за спиной, если смотрит вверх.
  const ang =
    dir === 'down' ? Math.PI / 2 : dir === 'up' ? -Math.PI / 2 : dir === 'left' ? Math.PI : 0;
  const hand: [number, number] =
    dir === 'down' ? [16, 17] : dir === 'up' ? [10, 12] : dir === 'left' ? [8, 14] : [17, 14];
  if (blade && dir === 'up')
    glassBlade(p, hand[0], hand[1], ang + (blade > 1 ? 0 : -0.9), 8, 1.1, blade > 1 ? 1 : 0);
  over(p, body, 5, 5);
  if (blade && dir !== 'up')
    glassBlade(p, hand[0], hand[1], ang + (blade > 1 ? 0 : -0.9), 8, 1.1, blade > 1 ? 1 : 0);
  p.outline(alpha(INK, 0.55));
  // Отражение чуть прозрачно: сквозь него угадывается пол.
  for (let i = 3; i < p.data.length; i += 4) if (p.data[i] === 255) p.data[i] = 232;
  // Выход из зеркала: проявляется снизу вверх рябью.
  let q = p;
  if (step < 4) {
    q = new Px(p.w, p.h);
    const cut = Math.round(p.h * (1 - (step + 1) / 5));
    for (let y = 0; y < p.h; y++)
      for (let x = 0; x < p.w; x++) {
        const i = (y * p.w + x) * 4;
        if (!p.data[i + 3]) continue;
        if (y < cut && (x + y + step) % 3) continue;
        const c: RGBA = [p.data[i], p.data[i + 1], p.data[i + 2], y < cut ? 110 : 255];
        q.set(x, y, c);
      }
  }
  return {
    p: q,
    ax: 13,
    ay: 21,
    eye: dir === 'up' ? null : [dir === 'down' ? 11 : dir === 'left' ? 10 : 15, 12],
  };
}

registerMobPainter('f7_echo', (m: Mob, pose: MobPose) => {
  const tier = heroGear().robe;
  const dir = dirOf(m.face);
  let row = 0;
  let blade = 0;
  let anim: string = pose.anim;
  let step = 4;
  if (pose.mode === 'f7_step') {
    step = Math.min(3, Math.floor((pose.t / 0.5) * 4));
    anim = `step${step}`;
  } else if (pose.mode === 'copy') {
    row = 4;
    blade = pose.t > 0.28 ? 2 : 1;
    anim = `copy${blade}`;
  } else if (pose.anim === 'run') row = pose.frame % 4;
  else if (pose.anim === 'wind' || pose.anim === 'bite') {
    row = 4;
    blade = pose.anim === 'bite' ? 2 : 1;
  } else if (pose.anim === 'dead') {
    const k = Math.min(3, Math.floor(pose.t / 0.16));
    return frameOf(
      `f7_echo${tier}${dir}`,
      pose,
      'dead',
      k,
      () => {
        const b = paintEcho(tier, dir, 0, 0, 4);
        if (!b) return null;
        return { ...b, p: shatter(b.p, 13, 13, (k + 1) / 4, 7) };
      },
      false,
    );
  } else if (pose.anim === 'sleep') row = 0;
  else row = Math.floor(pose.frame / 3) % 2 ? 2 : 0;
  return frameOf(
    `f7_echo${tier}${dir}`,
    pose,
    anim,
    row * 10 + blade,
    () => paintEcho(tier, dir, row, blade, step),
    false,
  );
});

// ---------------------------------------------------------------------------
// Отражение героя (босс), v2.86 — движение. Облик прежний: лист героя ×2
// (Scale2x), холодное стекло, фиолетовая сердцевина, трещины по фазам. Но
// фигура теперь — риг:
//   • тело гнёт карта «присед — наклон — шлем»: выборка из фигуры ×4 (два
//     прохода Scale2x), как RotSprite — пиксель остаётся пикселем, палитра
//     та же, контур не «кипит»;
//   • рука с клинком рисуется кодом от плеча, клинок идёт по дуге, как меч
//     героя (подготовка ease-in, удар ease-out, проводка с перелётом);
//   • след-серп — площадь, выметенная клинком за последние кадры (по той же
//     кривой, что сам клинок), поверх темноты;
//   • всё — от времени режима мозга на 24 к/с; мозг — метроном: кадр
//     контакта — ровно тот, в котором мозг наносит урон.
// Копии (Отблески) — те же кадры, но без трещин: трещины — это удары
// героя, их носит только настоящее. Тень у всех одна (настоящую выдаёт
// тень от люстры, `f7_trueshadow`).
// ---------------------------------------------------------------------------

/** Трещины босса по фазам (координаты — в фигуре 32×32). */
const BOSS_CRACKS: [number, number][][][] = [
  [],
  [
    [
      [8, 9],
      [13, 14],
      [12, 19],
      [16, 24],
    ],
  ],
  [
    [
      [22, 8],
      [19, 13],
      [21, 17],
    ],
    [
      [10, 22],
      [7, 27],
    ],
  ],
  [
    [
      [15, 4],
      [16, 9],
      [14, 12],
    ],
    [
      [24, 20],
      [20, 23],
      [22, 28],
    ],
    [
      [5, 14],
      [9, 17],
    ],
  ],
];

/** Паутина смерти: лучи от сердцевины к краям фигуры (растут по кадрам). */
const DEATH_WEB: [number, number][][] = (() => {
  const out: [number, number][][] = [];
  for (let i = 0; i < 8; i++) {
    const a0 = (i / 8) * TAU + hash(i, 41) * 0.5;
    const pts: [number, number][] = [[16, 24]];
    let a = a0;
    let r = 0;
    for (let s = 0; s < 3; s++) {
      r += 4.5 + hash(i, s, 7) * 3.5;
      a += (hash(i, s, 9) - 0.5) * 0.7;
      pts.push([16 + Math.cos(a) * r * 1.05, 24 + Math.sin(a) * r * 1.2]);
    }
    out.push(pts);
  }
  return out;
})();

// ---- Время, кривые, риг -----------------------------------------------------

const RFPS = 24;
type Ease = (x: number) => number;
const eIn: Ease = (x) => x * x;
const eOut: Ease = (x) => 1 - (1 - x) * (1 - x);
const eOut3: Ease = (x) => 1 - (1 - x) * (1 - x) * (1 - x);
const eIO: Ease = (x) => (x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) * (1 - x));
const cl = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const sstep = (a: number, b: number, x: number) => {
  const k = cl((x - a) / (b - a));
  return k * k * (3 - 2 * k);
};

/**
 * Поза отражения. Угол клинка `b` — от взгляда (по часовой — плюс);
 * всё в пикселях кадра. `lean` — вперёд(+)/назад, `tilt` — крен на экране,
 * `crouch` — присед (минус — вытянулся), `hx/hy` — шлем отдельно от тела
 * (запаздывает), `arm/lift/hf/hl` — рука: вынос вдоль клинка, подъём,
 * вперёд и поперёк, `fwd/hop` — ход всего тела (кадром движка), `vis` —
 * сколько отражения по эту сторону зеркала, `seam/pane` — само зеркало.
 */
interface BRig {
  row: number;
  lean: number;
  tilt: number;
  crouch: number;
  hx: number;
  hy: number;
  b: number;
  arm: number;
  lift: number;
  hf: number;
  hl: number;
  len: number;
  hot: number;
  eyes: number;
  core: number;
  gz: number;
  fwd: number;
  hop: number;
  sq: number;
  vis: number;
  seam: number;
  pane: number;
  /** Клинок перед телом (1) или за ним (−1); 0 — по углу. */
  front: number;
}
type RigCh = Exclude<keyof BRig, 'row'>;
const RIG0: BRig = {
  row: 0,
  lean: 0,
  tilt: 0,
  crouch: 0,
  hx: 0,
  hy: 0,
  b: 0,
  arm: 5,
  lift: 0,
  hf: 0,
  hl: 0,
  len: 17,
  hot: 0,
  eyes: 0.55,
  core: 0.4,
  gz: 0,
  fwd: 0,
  hop: 0,
  sq: 0,
  vis: 1,
  seam: 0,
  pane: 0,
  front: 0,
};
const RIG_CH = (Object.keys(RIG0) as (keyof BRig)[]).filter((k) => k !== 'row') as RigCh[];
/**
 * Ключ: время (с), каналы, кривая ПОДХОДА к ключу (по умолчанию — плавно) и
 * `spin` — угол клинка как есть (полный оборот мельницы). Без него угол
 * берётся ближайшим по модулю оборота к прошлому ключу: клинок не крутит
 * лишний оборот, переходя в соседнюю позу через «длинную» сторону.
 */
type BKey = [number, Partial<BRig>, Ease?, boolean?];

/** Дорожка ключей: каждый канал — между ключами, где он задан; строка листа — дискретно. */
function trackB(keys0: BKey[], t: number, base: BRig): BRig {
  const out = { ...base };
  let prevB = base.b;
  const keys = keys0.map((k): BKey => {
    const b = k[1].b;
    if (b === undefined) return k;
    // Разворот больше ~206° — почти наверняка «не в ту сторону»; меньше —
    // как задумано (замах через спину тоже бывает).
    const v = k[3] || Math.abs(b - prevB) < 3.6 ? b : b + TAU * Math.round((prevB - b) / TAU);
    prevB = v;
    return v === b ? k : [k[0], { ...k[1], b: v }, k[2]];
  });
  for (const ch of RIG_CH) {
    let t0 = 0;
    let v0 = base[ch];
    let t1 = -1;
    let v1 = 0;
    let e: Ease = eIO;
    for (const [kt, kv, ke] of keys) {
      const v = kv[ch];
      if (v === undefined) continue;
      if (kt <= t) {
        t0 = kt;
        v0 = v;
      } else {
        t1 = kt;
        v1 = v;
        e = ke ?? eIO;
        break;
      }
    }
    out[ch] = t1 < 0 ? v0 : v0 + (v1 - v0) * e(cl((t - t0) / (t1 - t0 || 1)));
  }
  for (const [kt, kv] of keys) if (kv.row !== undefined && kt <= t) out.row = kv.row;
  return out;
}

/** Три стороны рисуются, левая — зеркало правой. */
type BDir = 'down' | 'up' | 'right';

/** Что нужно технике: сторона, взгляд (правый эквивалент), темп фазы. */
interface BCtx {
  dir: BDir;
  phi: number;
  /** Темп: 1 / 1,12 / 1,22 по фазам, у копии ×0,82. */
  hs: number;
  /** Замахи копии ×1,15. */
  cw: number;
  /** Отдых после удара (`m.data.rec`), с до деления на темп. */
  rec: number;
}

/** Низкая стойка: клинок у бедра остриём вперёд-вниз. */
const GUARD_B: Record<BDir, number> = { right: 0.75, down: -0.55, up: -2.59 };
/** Клинок опущен к полу сбоку (взгляд). */
const LOW_B: Record<BDir, number> = { right: 1.95, down: -0.3, up: -2.85 };
/** Остриём в пол (оглушение). */
const DROOP_B: Record<BDir, number> = { right: 1.25, down: -0.12, up: -3.0 };
/** Клинок стоймя перед собой (стойка, салют, шаг в зеркало). */
const vertB = (c: BCtx) => -Math.PI / 2 - c.phi;

/** Плечо руки с клинком в фигуре 32×32. */
const SHOULDER: Record<BDir, [number, number]> = {
  right: [19.5, 21.5],
  down: [22.5, 22.5],
  up: [9.5, 22.5],
};

/** Тот же угол `v` по модулю оборота, ближайший к `ref`. */
const nearB = (v: number, ref: number) => v + TAU * Math.round((ref - v) / TAU);

/** Стойка «готов». */
const ready = (c: BCtx): BRig => ({ ...RIG0, b: GUARD_B[c.dir] });

// ---- Техники: поза во времени ------------------------------------------------

/** Что ещё рисовать поверх позы. */
interface BFx {
  /** След-серп: окно, с (0 — нет). */
  smear?: number;
  /** Тяжёлый след: шире и двойной. */
  heavy?: boolean;
  /** Сила следа 0…1 (гаснет в проводке). */
  sk?: number;
  /** Клинок вспыхивает белым (миг контакта) 0…1. */
  bflash?: number;
  /** Кольцо набора вокруг тела 0…1 — как у тяжёлого удара героя. */
  ring?: number;
  /** Отбив: стекло защиты вспыхивает белым 0…1. */
  pflash?: number;
  /** Блик на острие перед ударом 0…1 — «сейчас ударит». */
  glint?: number;
  /** Искры набора, стекающие к клинку 0…1. */
  motes?: number;
  /** Искра отбива (звон стойки) 0…1. */
  spark?: number;
  /** Полосы скорости 0…1. */
  streak?: number;
  /** Звёзды оглушения: фаза 0…1. */
  stars?: number;
  /** Дрожь, пиксели (сдвигом кадра). */
  tremble?: number;
  /** Блик, бегущий по стеклу (позиция полосы). */
  sheen?: number;
  /** Паутина трещин смерти 0…6. */
  web?: number;
  /** Свет изнутри (перед раскалом) 0…1. */
  inner?: number;
}
interface BTech {
  r: BRig;
  fx: BFx;
}

/** Взмахи серии: замах, контакт, перелёт (от взгляда), подъём руки, присед. */
const SWING = [
  { W: -2.1, C: 0.86, over: 0.55, liftW: 11, liftC: 0, crW: 1.8, sw: 0.12, hfW: 0, fr: 1 },
  { W: 2.5, C: -0.86, over: -0.5, liftW: -2, liftC: 2, crW: 1.4, sw: 0.1, hfW: -2, fr: 0 },
  { W: -2.35, C: 1.15, over: 0.25, liftW: 13, liftC: -3, crW: 2.6, sw: 0.13, hfW: 0, fr: 1 },
];
const comboT = (k: number, c: BCtx) => (BOSS.combo[k] / c.hs) * c.cw;
const followT = (c: BCtx) => 0.1 / c.hs;

/** Взмах k серии: [0, T], контакт — ровно в T. */
function techSwing(k: number, t: number, c: BCtx): BTech {
  const T = comboT(k, c);
  // Обратный взмах анфас заводится влево (за голову — не видно).
  const S = k === 1 && c.dir === 'down' ? { ...SWING[1], W: 1.75 } : SWING[k];
  const sw = Math.min(S.sw, T * 0.34);
  const tB = T - sw;
  const tA = tB * 0.42;
  const base = k === 0 ? ready(c) : techFollow(k - 1, followT(c), c).r;
  const keys: BKey[] = [
    [
      tA,
      {
        b: S.W * 0.86,
        lift: S.liftW * 0.8,
        arm: 4.2,
        lean: -0.1,
        crouch: S.crW * 0.7,
        hy: 0.4,
        eyes: 0.85,
        fwd: -0.8,
        hot: 0.3,
        hf: S.hfW,
        front: S.fr,
        row: 0,
      },
      eIO,
    ],
    [
      tB,
      {
        b: S.W,
        lift: S.liftW,
        arm: 4,
        lean: -0.17,
        crouch: S.crW,
        hy: 0.8,
        eyes: 1,
        hot: 1,
        fwd: -1.3,
        hf: S.hfW,
        front: S.fr,
      },
      eIO,
    ],
    [
      T,
      {
        b: S.C,
        lift: S.liftC,
        arm: 7,
        lean: 0.2,
        crouch: 0.3,
        hy: -0.6,
        fwd: 2.6,
        hot: 1,
        hf: 0,
        front: 0,
        row: 0,
      },
      eOut3,
      true,
    ],
  ];
  if (k === 2) {
    // Финал серии — с подскоком: вниз, вверх (вытянулся), приземление = удар.
    keys.splice(
      0,
      2,
      [
        tA * 0.55,
        { crouch: 3, lean: -0.08, b: S.W * 0.5, lift: 3, eyes: 0.9, front: 1, row: 0 },
        eOut,
      ],
      [tA, { crouch: -1.2, hop: 5, b: S.W * 0.9, lift: S.liftW * 0.9, lean: -0.14, hy: 0.6 }, eOut],
      [
        tB,
        { hop: 5.6, crouch: -0.8, b: S.W, lift: S.liftW, lean: -0.18, eyes: 1, hot: 1, front: 1 },
        eIO,
      ],
    );
    keys[keys.length - 1][1] = { ...keys[keys.length - 1][1], hop: 0, crouch: 2.4 };
  }
  const r = trackB(keys, cl(t, 0, T), base);
  // След — только у удара (замах — подготовка, он без следа).
  const fx: BFx = { smear: t >= tB - 0.02 ? 0.08 : 0, heavy: k === 2 };
  // Блик на острие за два кадра до удара — «сейчас».
  if (t >= tB - 2 / RFPS && t < tB) fx.glint = 1 - (tB - t) * RFPS * 0.35;
  return { r, fx };
}

/** Проводка взмаха k: перелёт за точку контакта и торможение. */
function techFollow(k: number, t: number, c: BCtx): BTech {
  if (t < 0) return techSwing(k, comboT(k, c) + t, c);
  const S = SWING[k];
  const d = followT(c);
  const base = techSwing(k, comboT(k, c), c).r;
  const r = trackB(
    [
      [
        d,
        {
          b: S.C + S.over,
          lift: S.liftC - 1,
          arm: 6,
          lean: 0.12,
          crouch: 0.9,
          hy: 0.2,
          fwd: 3,
          hot: 0.4,
        },
        eOut,
      ],
    ],
    cl(t, 0, d),
    base,
  );
  return {
    r,
    fx: { smear: 0.08, heavy: k === 2, sk: 1 - 0.65 * (t / d), bflash: t < 0.02 ? 1 : 0 },
  };
}

/** Тяжёлый: шаг назад, клинок за плечо, набор, взрыв — дуга 3,8. */
function techHeavy(t: number, c: BCtx): BTech {
  const T = (BOSS.heavy / c.hs) * c.cw;
  const sw = 0.1;
  const tB = T - sw;
  const r = trackB(
    [
      [
        T * 0.16,
        {
          fwd: -3,
          crouch: 1.3,
          lean: -0.12,
          b: -2.45,
          lift: 11,
          arm: 4,
          hy: 0.6,
          eyes: 0.8,
          core: 0.7,
          hot: 0.2,
          front: 1,
          row: 0,
        },
        eOut,
      ],
      [
        T * 0.78,
        { fwd: -3.4, crouch: 2.4, lean: -0.22, b: -2.7, lift: 12, hot: 1, core: 1, eyes: 1, hy: 1 },
        eIO,
      ],
      [tB, { fwd: -4, crouch: 3.2, lean: -0.3, b: -2.95, lift: 13 }, eIn],
      [
        T,
        {
          fwd: 4.5,
          crouch: -0.8,
          lean: 0.36,
          b: 1.8,
          lift: -1,
          arm: 8,
          hy: -1,
          len: 18,
          front: 0,
          row: 0,
        },
        eOut3,
        true,
      ],
    ],
    cl(t, 0, T),
    ready(c),
  );
  const charge = cl((t - T * 0.2) / (T * 0.7));
  const fx: BFx = {
    smear: t >= tB - 0.02 ? 0.1 : 0,
    heavy: true,
    motes: t > T * 0.2 && t < tB ? charge : 0,
    ring: t > T * 0.2 && t < tB ? charge : 0,
    tremble: t > T * 0.25 && t < tB ? 0.35 + charge * 0.5 : 0,
  };
  if (t >= tB - 2.5 / RFPS && t < tB) fx.glint = 1;
  return { r, fx };
}

/** Прицел выпада: низкая стойка спринтера, клинок назад-вниз, дрожь. */
function techAim(t: number, c: BCtx): BTech {
  const T = (BOSS.dashAim / c.hs) * c.cw;
  const r = trackB(
    [
      [
        0.14,
        {
          crouch: 2.6,
          lean: 0.22,
          b: 2.65,
          lift: -1,
          arm: 6,
          fwd: -2.5,
          row: 5,
          eyes: 1,
          hy: 0.6,
          hot: 0.5,
        },
        eOut,
      ],
      [T * 0.8, { crouch: 3, lean: 0.26, b: 2.78, fwd: -3, hot: 1 }, eIO],
      [T, { crouch: 3.4, lean: 0.31, fwd: -3.6, b: 2.85 }, eIn],
    ],
    cl(t, 0, T),
    ready(c),
  );
  const fx: BFx = { tremble: t > 0.14 ? 0.3 + 0.5 * cl((t - 0.14) / (T - 0.14)) : 0 };
  if (t >= T - 2.5 / RFPS) fx.glint = 1;
  return { r, fx };
}

/** Выпад: вытянулся в струну, клинок вперёд, 4 кадра петлёй. */
function techDash(t: number, c: BCtx): BTech {
  if (t < 0) return techAim((BOSS.dashAim / c.hs) * c.cw + t, c);
  const base = techAim(99, c).r;
  const tt = t < 2 / RFPS ? t : 2 / RFPS + ((t - 2 / RFPS) % (4 / RFPS));
  const r = trackB(
    [
      [
        0.06,
        {
          crouch: -1.2,
          lean: 0.36,
          b: 0.06,
          arm: 8.5,
          lift: 1,
          len: 19,
          fwd: 3,
          row: 5,
          hot: 1,
          sq: 0.08,
          hy: -0.4,
        },
        eOut3,
      ],
    ],
    tt,
    base,
  );
  const f = Math.floor(tt * RFPS);
  r.hy += f >= 2 && f % 2 ? 0.4 : 0;
  return { r, fx: { smear: t < 0.07 ? 0.07 : 0, streak: f >= 2 ? 1 + (f % 2) : 0 } };
}

/** Стойка «зеркальная защита»: клинок стоймя, перед собой — стекло. */
function techGuard(t: number, c: BCtx): BTech {
  const r = trackB(
    [
      [
        0.1,
        {
          b: vertB(c),
          arm: 3,
          lift: 5,
          hl: 4,
          hf: 2,
          crouch: 1.6,
          lean: -0.06,
          hy: 0.4,
          eyes: 0.9,
          pane: 1,
          front: 1,
          row: 0,
        },
        eOut,
      ],
    ],
    t,
    ready(c),
  );
  // Дышит под стойкой, но клинок не дрожит — он держит.
  const k = cl((t - 0.1) / 0.2);
  r.crouch += Math.sin(t * TAU * 1.6) * 0.35 * k;
  r.hy += Math.sin(t * TAU * 1.6 - 0.7) * 0.3 * k;
  return { r, fx: { sheen: t > 0.1 ? ((t - 0.1) / 0.42) % 1 : -1 } };
}

/** Ответ: отбив (звон), короткий замах, удар — контакт в 0,32. */
function techRiposte(t: number, c: BCtx): BTech {
  const T = BOSS.riposte;
  const g = techGuard(0.95, c).r;
  const r = trackB(
    [
      [
        0.05,
        { b: vertB(c) - 0.45, fwd: -1.6, lean: -0.18, crouch: 1.2, pane: 0.3, eyes: 1, front: 1 },
        eOut,
      ],
      [
        0.2,
        {
          b: -1.65,
          lift: 3,
          arm: 4.5,
          hl: 0,
          hf: 0,
          lean: -0.12,
          crouch: 1.6,
          fwd: -1.2,
          hot: 1,
          pane: 0,
        },
        eIO,
      ],
      [T, { b: 0.95, lift: 0, arm: 7, lean: 0.22, crouch: 0.3, fwd: 3, row: 0 }, eOut3],
    ],
    cl(t, 0, T),
    g,
  );
  const fx: BFx = {
    smear: t >= 0.18 ? 0.09 : 0,
    spark: t < 0.12 ? 1 - t / 0.12 : 0,
    pflash: t < 0.1 ? 1 - t / 0.1 : 0,
  };
  if (t >= 0.2 - 2 / RFPS && t < 0.2) fx.glint = 1;
  return { r, fx };
}

/** Взгляд: клинок опущен, голова поднята, глаза разгораются — вспышка в T. */
function techGaze(t: number, c: BCtx): BTech {
  const T = BOSS.gaze / c.hs;
  const r = trackB(
    [
      [
        0.18,
        {
          b: LOW_B[c.dir],
          arm: 4,
          lift: -2,
          crouch: -0.6,
          hy: -1.2,
          lean: -0.06,
          eyes: 1,
          gz: 0.25,
        },
        eOut,
      ],
      [T - 0.1, { hy: -1.6, crouch: -0.9, gz: 1, core: 1 }, eIn],
      [T, { lean: 0.12, hy: -0.4, crouch: 0.2, gz: 1.25, fwd: 1 }, eOut3],
    ],
    cl(t, 0, T),
    ready(c),
  );
  return { r, fx: {} };
}

/** Нырок в зеркало: клинок стоймя, стекло встаёт, фигура уходит полосами. */
function techDive(t: number, c: BCtx): BTech {
  const r = trackB(
    [
      [
        0.1,
        { b: vertB(c), lift: 5, arm: 3, hl: 3, hf: 2, crouch: 1.4, hy: 0.4, seam: 0.8, front: 1 },
        eOut,
      ],
      [0.14, { vis: 1 }],
      [0.42, { vis: 0, seam: 1, crouch: 0.6 }, eIn],
      [0.45, { seam: 0.7 }],
    ],
    t,
    ready(c),
  );
  return { r, fx: {} };
}

/** Выход из зеркала у стены и прицел через весь зал. */
function techMaim(t: number, c: BCtx): BTech {
  const T = BOSS.mirrorAim / c.hs;
  const base: BRig = {
    ...ready(c),
    vis: 0,
    seam: 1,
    crouch: 2,
    lean: 0.2,
    b: 2.6,
    lift: -1,
    arm: 6,
    row: 5,
    eyes: 1,
  };
  const r = trackB(
    [
      [T * 0.42, { vis: 1, seam: 0.35 }, eOut],
      [T * 0.55, { crouch: 3.2, lean: 0.32, b: 2.8, fwd: -3, seam: 0, hot: 0.6 }, eIO],
      [T * 0.9, { crouch: 3.6, fwd: -3.8, b: 2.86, hot: 1 }, eIO],
      [T, { crouch: 3.8, lean: 0.36, fwd: -4 }, eIn],
    ],
    cl(t, 0, T),
    base,
  );
  const fx: BFx = { tremble: t > T * 0.55 ? 0.5 : 0 };
  if (t >= T - 2.5 / RFPS) fx.glint = 1;
  return { r, fx };
}

/** Пробежка через зал: спринт 8 кадров на 24 к/с, клинок волочится сзади. */
function techSprint(t: number, c: BCtx): BTech {
  if (t < 0) return techMaim(BOSS.mirrorAim / c.hs + t, c);
  const base = techMaim(99, c).r;
  if (t < 2 / RFPS) {
    const r = trackB(
      [[2 / RFPS, { crouch: 1, lean: 0.34, fwd: 2, sq: 0.06, row: 0 }, eOut]],
      t,
      base,
    );
    return { r, fx: { streak: 1 } };
  }
  const f = Math.floor((t - 2 / RFPS) * RFPS) % 8;
  const ph = f / 8;
  const r: BRig = {
    ...base,
    row: [0, 1, 2, 3][Math.floor(f / 2)],
    lean: 0.34,
    crouch: 1 + 0.9 * Math.abs(Math.sin(ph * TAU)),
    hy: 0.5 + 0.5 * Math.cos(ph * 2 * TAU - 0.8),
    b: 2.8 + 0.1 * Math.sin(ph * TAU),
    arm: 7,
    lift: -1 + 0.6 * Math.sin(ph * TAU),
    hot: 0.7,
    fwd: 2,
    sq: 0.06,
    seam: 0,
    vis: 1,
  };
  return { r, fx: { streak: 1 + (f % 2) } };
}

/** Оглушение: споткнулся, клинок в пол, качается; звёзды; встряхнулся. */
function techDaze(t: number, c: BCtx): BTech {
  const D = 2.1 / c.hs;
  const stun: Partial<BRig> = {
    lean: -0.28,
    crouch: 2.3,
    fwd: -2,
    b: DROOP_B[c.dir],
    lift: -3,
    arm: 4,
    eyes: 0.25,
    hy: 1.3,
    core: 0.2,
    row: 0,
  };
  if (t < 0.3) {
    const r = trackB([[0.14, stun, eOut]], t, ready(c));
    return { r, fx: { stars: t > 0.1 ? (t - 0.1) / 1.08 : -1 } };
  }
  const end = D - 0.35;
  const base = { ...ready(c), ...stun };
  if (t < end) {
    // Петля 13 кадров на 12 к/с: качается, шлем опаздывает, глаза мигают.
    const f = Math.floor((t - 0.3) * 12) % 13;
    const ph = f / 13;
    const r: BRig = {
      ...base,
      tilt: 0.11 * Math.sin(ph * TAU),
      hx: 1.3 * Math.sin(ph * TAU - 0.9),
      hy: 1.2 + 0.4 * Math.sin(ph * 2 * TAU),
      lean: -0.18,
      crouch: 1.7 + 0.3 * Math.cos(ph * TAU),
      fwd: -1.2,
      eyes: f % 5 === 0 ? 0.6 : 0.25,
    };
    return { r, fx: { stars: ph } };
  }
  // Встряхнулся: мотнул шлемом, поднял клинок, стойка.
  const tt = t - end;
  const r = trackB(
    [
      [0.07, { hx: 1.8, hy: 0.6, tilt: 0.05 }, eOut],
      [0.14, { hx: -1.6, tilt: -0.05, eyes: 1 }, eIO],
      [0.21, { hx: 0.6, tilt: 0 }, eIO],
      [0.35, { ...ready(c), hx: 0 }, eIO],
    ],
    cl(tt, 0, 0.35),
    { ...base, lean: -0.18, crouch: 1.7, fwd: -1.2 },
  );
  return { r, fx: {} };
}

/** Шаг сквозь зеркало (фаза теней, перетасовка). */
function techShift(t: number, c: BCtx): BTech {
  const r = trackB(
    [
      [
        0.12,
        { b: vertB(c), lift: 5, arm: 3, hl: 3, hf: 2, crouch: 1, hy: 0.3, seam: 0.7, front: 1 },
        eOut,
      ],
      [0.18, { vis: 1 }],
      [0.4, { seam: 1 }],
      [0.6, { vis: 0 }, eIn],
      [0.7, { seam: 0 }],
    ],
    t,
    ready(c),
  );
  return { r, fx: { sheen: t < 0.3 ? t / 0.3 : -1 } };
}

/** Выход после шага (intro с 0,5): полосы собираются, взмах — стойка. */
function techIntroQuick(t: number, c: BCtx): BTech {
  const base: BRig = {
    ...ready(c),
    vis: 0,
    seam: 1,
    b: vertB(c),
    lift: 5,
    arm: 3,
    hl: 3,
    hf: 2,
    crouch: 1,
    front: 1,
  };
  const r = trackB(
    [
      [0.3, { vis: 1, seam: 0.2 }, eOut],
      [
        0.42,
        { b: GUARD_B[c.dir] - 0.5, lift: 1, hl: 0, hf: 0, arm: 5, crouch: 0.2, seam: 0, front: 0 },
        eOut,
      ],
      [0.7, { ...ready(c) }, eIO],
    ],
    t,
    base,
  );
  return { r, fx: { smear: t > 0.28 && t < 0.52 ? 0.1 : 0, sk: 0.7 } };
}

/** Первый выход: из зеркала, салют клинком у забрала, мельница, стойка. */
function techIntro(t: number, c: BCtx): BTech {
  const V = vertB(c);
  const r = trackB(
    [
      [0.14, { seam: 1, vis: 0 }],
      [0.5, { vis: 1, seam: 0.3 }, eOut],
      [
        0.66,
        {
          b: V,
          lift: 8,
          arm: 2,
          hl: 5,
          hf: 3,
          hy: -0.4,
          crouch: -0.3,
          seam: 0,
          eyes: 0.8,
          front: 1,
        },
        eOut,
      ],
      [0.86, { eyes: 1, core: 0.7, front: 1 }],
      [1.12, { b: V - TAU, lift: 3, arm: 5, hl: 1, hf: 0, crouch: 0.6, front: 0 }, eIO, true],
      [1.4, { ...ready(c), b: GUARD_B[c.dir] - TAU }, eIO],
    ],
    t,
    { ...ready(c), vis: 0, seam: 0 },
  );
  return { r, fx: { smear: t > 0.86 && t < 1.2 ? 0.12 : 0 } };
}

/** Миг контакта (t = 0 отдыха): след в полную силу, клинок вспыхивает. */
const contact = (t: number): BFx => ({ sk: 1 - t / 0.14, bflash: t < 0.02 ? 1 : 0 });

/** Отдых после удара: проводка (контакт в t = 0), тяжёлое дыхание, стойка. */
function techRec(from: number, t: number, c: BCtx): BTech {
  const R = c.rec / c.hs;
  if (t < 0) {
    if (from === 1) return techSwing(2, comboT(2, c) + t, c);
    if (from === 2) return techHeavy((BOSS.heavy / c.hs) * c.cw + t, c);
    if (from === 3) return techDash(t + 0.3, c);
    if (from === 4) return techRiposte(BOSS.riposte + t, c);
    if (from === 5) return techGaze(BOSS.gaze / c.hs + t, c);
  }
  const breath = (k: number, a: number, b: number) =>
    Math.sin(t * TAU * 2.2) * k * sstep(a, a + 0.08, t) * (1 - sstep(b - 0.1, b, t));
  // Стойка — тем же углом по модулю оборота, но ближайшим к тому, откуда
  // клинок идёт: иначе он возвращался бы в стойку через лишний оборот.
  const gN = (ref: number) => nearB(GUARD_B[c.dir], ref);
  const rdN = (ref: number): BRig => ({ ...ready(c), b: gN(ref) });
  switch (from) {
    case 1: {
      const S = SWING[2];
      const r = trackB(
        [
          [
            0.12,
            {
              b: S.C + S.over,
              lift: -4,
              arm: 6,
              lean: 0.3,
              crouch: 2.6,
              hy: 0.8,
              fwd: 3,
              hot: 0.4,
            },
            eOut,
          ],
          [R * 0.45, { lean: 0.18, crouch: 1.6, b: S.C + S.over - 0.1, hot: 0, row: 0 }, eIO],
          [R, rdN(S.C + S.over), eIO],
        ],
        t,
        techSwing(2, comboT(2, c), c).r,
      );
      r.crouch += breath(0.6, 0.12, R * 0.8);
      r.hy += breath(0.7, 0.14, R * 0.8);
      return { r, fx: { smear: t < 0.14 ? 0.09 : 0, heavy: true, ...contact(t) } };
    }
    case 2: {
      const r = trackB(
        [
          [
            0.12,
            { b: 2.4, lift: -4.5, arm: 7, lean: 0.42, crouch: 2.8, fwd: 5, hy: 1, hot: 0.5 },
            eOut,
          ],
          [
            R * 0.5,
            { b: 2.35, lift: -4.5, lean: 0.3, crouch: 1.9, fwd: 4, hot: 0, core: 0.5, eyes: 0.6 },
            eIO,
          ],
          [
            R * 0.82,
            { b: gN(2.35), lift: 0, arm: 5, lean: 0, crouch: 0.5, fwd: 1, hy: 0.2, row: 0 },
            eIO,
          ],
          [R, rdN(2.35), eIO],
        ],
        t,
        techHeavy((BOSS.heavy / c.hs) * c.cw, c).r,
      );
      r.crouch += breath(0.8, 0.12, R * 0.8);
      r.hy += breath(0.9, 0.14, R * 0.8);
      r.core = Math.max(r.core, 0.5 + breath(0.4, 0.12, R * 0.8));
      return { r, fx: { smear: t < 0.14 ? 0.1 : 0, heavy: true, ...contact(t) } };
    }
    case 3: {
      const r = trackB(
        [
          [
            0.1,
            { lean: -0.26, crouch: 2.2, fwd: 1, b: 0.5, arm: 6, len: 17, sq: -0.06, hot: 0.3 },
            eOut,
          ],
          [
            R * 0.55,
            { lean: -0.04, crouch: 0.8, b: gN(0.5), fwd: 0.5, row: 0, sq: 0, hot: 0 },
            eIO,
          ],
          [R, rdN(0.5), eIO],
        ],
        t,
        techDash(0.3, c).r,
      );
      return { r, fx: {} };
    }
    case 4: {
      const r = trackB(
        [
          [
            0.1,
            { b: 0.95 + 0.5, lift: -1, arm: 6, lean: 0.12, crouch: 0.9, fwd: 3, hot: 0.4 },
            eOut,
          ],
          [
            R * 0.6,
            { b: gN(1.45), lift: 0, arm: 5, lean: 0, crouch: 0.4, fwd: 0.8, hot: 0, row: 0 },
            eIO,
          ],
          [R, rdN(1.45), eIO],
        ],
        t,
        techRiposte(BOSS.riposte, c).r,
      );
      return { r, fx: { smear: t < 0.12 ? 0.09 : 0, ...contact(t) } };
    }
    case 5: {
      const r = trackB(
        [
          [0.22, { gz: 0.35, hy: -0.2, lean: 0, fwd: 0.6 }, eOut],
          [R * 0.55, { gz: 0, b: gN(LOW_B[c.dir]), arm: 5, lift: 0, crouch: 0.2, hy: 0 }, eIO],
          [R, rdN(LOW_B[c.dir]), eIO],
        ],
        t,
        techGaze(BOSS.gaze / c.hs, c).r,
      );
      return { r, fx: {} };
    }
    default: {
      const rd = ready(c);
      const r = trackB([[R, rd, eIO]], t, { ...rd, crouch: 1.2, lean: -0.05, eyes: 0.7 });
      r.crouch += breath(0.4, 0, R);
      return { r, fx: {} };
    }
  }
}

/** Покой: дыхание 2,4 с (24 кадра на 10 к/с), шлем опаздывает, блик по стеклу. */
function techIdle(t: number, c: BCtx): BTech {
  const ph = (t / 2.4) % 1;
  const s = Math.sin(ph * TAU);
  const r: BRig = {
    ...ready(c),
    crouch: 0.4 + 0.45 * s,
    hy: 0.5 * Math.sin(ph * TAU - 0.7),
    b: GUARD_B[c.dir] + 0.06 * Math.sin(ph * TAU - 1.1),
    lift: 0.5 * Math.sin(ph * TAU - 0.9),
    core: 0.4 + 0.2 * Math.sin(ph * TAU * 2),
  };
  return { r, fx: { sheen: ph < 0.34 ? ph / 0.34 : -1 } };
}

/** Бег: 8 кадров на шаг (по пройденному пути), вес на каждом шаге. */
function techRun(ph: number, c: BCtx, fast: number): BTech {
  const f = Math.floor(ph * 8) % 8;
  const p = f / 8;
  const r: BRig = {
    ...ready(c),
    row: [0, 1, 2, 3][Math.floor(f / 2)],
    // Два шага за цикл: на каждом — осел, между — подлетел.
    crouch: 0.2 + 0.8 * (0.5 + 0.5 * Math.cos(p * 2 * TAU)),
    hy: 0.4 + 0.5 * Math.cos(p * 2 * TAU - 0.9),
    lean: 0.06 + 0.08 * fast,
    tilt: c.dir === 'right' ? 0 : 0.03 * Math.sin(p * TAU),
    b: GUARD_B[c.dir] + 0.12 * Math.sin(p * TAU) + (c.dir === 'right' ? 0.25 * fast : 0),
    lift: 0.6 * Math.sin(p * TAU - 0.6),
    hf: -1 * fast,
  };
  return { r, fx: {} };
}

/** Смерть (настоящее, 1,45 с): удар, паутина трещин, клинок падает, свет, раскол. */
const DIE_T = 1.45;
const DIE_SHATTER = 0.58;
/** Отблеск (0,95 с): трещины и свет за 0,4 — взрыв осколками (удар `f7_copyburst`). */
const DIEC_T = 0.95;
const DIEC_SHATTER = 0.4;

function techDie(t: number, c: BCtx, copy: boolean): BTech {
  const S = copy ? DIEC_SHATTER : DIE_SHATTER;
  const tt = Math.min(t, S - 0.02);
  const r = trackB(
    [
      [0.06, { lean: -0.26, hy: -1.1, crouch: 1, eyes: 1, core: 1, fwd: -1.5 }, eOut],
      [
        S * 0.85,
        { lean: 0.14, hy: 1.6, crouch: 2.4, eyes: 0.3, fwd: -0.5, b: DROOP_B[c.dir], lift: -3 },
        eIO,
      ],
    ],
    tt,
    ready(c),
  );
  const web = Math.min(6, Math.max(0, Math.floor((tt - 0.05) / ((S - 0.12) / 6)) + 1));
  const fx: BFx = {
    web,
    tremble: tt > 0.1 ? 0.3 + (tt / S) * 0.8 : 0,
    inner: cl((tt - S * 0.6) / (S * 0.4)),
  };
  r.eyes = web >= 5 ? (Math.floor(tt * RFPS) % 2 ? 1 : 0.2) : r.eyes;
  return { r, fx };
}

/** Поза техники в момент t (секунды от начала её отрезка). */
function techAt(tech: string, v: number, t: number, c: BCtx): BTech {
  switch (tech) {
    case 'idle':
      return techIdle(t, c);
    case 'run':
      return techRun(t, c, v / 10);
    case 'swing':
      return techSwing(v, t, c);
    case 'follow':
      return techFollow(v, t, c);
    case 'heavy':
      return techHeavy(t, c);
    case 'aim':
      return techAim(t, c);
    case 'dash':
      return techDash(t, c);
    case 'guard':
      return techGuard(t, c);
    case 'riposte':
      return techRiposte(t, c);
    case 'gaze':
      return techGaze(t, c);
    case 'mdive':
      return techDive(t, c);
    case 'maim':
      return techMaim(t, c);
    case 'mrun':
      return techSprint(t, c);
    case 'daze':
      return techDaze(t, c);
    case 'shift':
      return techShift(t, c);
    case 'introQ':
      return techIntroQuick(t, c);
    case 'intro0':
      return techIntro(t, c);
    case 'rec':
      return techRec(v, t, c);
    case 'die':
      return techDie(t, c, false);
    case 'dieC':
      return techDie(t, c, true);
  }
  return techIdle(0, c);
}

// ---- Фигура: стекло из листа героя, ×4 для выборки ---------------------------

/** Холст кадра до обрезки и точка ног в нём. */
const BW = 96;
const BH = 92;
const BAX = 48;
const BAY = 66;

interface BodySrc {
  /** Фигура ×4 (128×128) — из неё выбирается согнутое тело. */
  hi: Px;
  /** Маска 32×32: R — глаза, G — сердцевина, B — свежая трещина. */
  mask: Px;
}
const BODY = frameLRU<BodySrc | null>(48);

/**
 * Scale2x (EPX) на типизированных массивах — вдвое крупнее без «лесенки» по
 * диагоналям и без выделений на пиксель: фигура босса проходит его трижды
 * (×2 — облик, ещё ×4 — источник для выборки согнутого тела).
 */
function scale2xFast(p: Px): Px {
  const w = p.w;
  const h = p.h;
  const o = new Px(w * 2, h * 2);
  const s = new Uint32Array(w * h);
  const sv = new Uint32Array(p.data.buffer, p.data.byteOffset, w * h);
  for (let i = 0; i < w * h; i++) s[i] = p.data[i * 4 + 3] ? sv[i] : 0;
  const d = new Uint32Array(o.data.buffer, o.data.byteOffset, w * h * 4);
  const W2 = w * 2;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const P = s[y * w + x];
      const A = y > 0 ? s[(y - 1) * w + x] : 0;
      const B = x < w - 1 ? s[y * w + x + 1] : 0;
      const C = x > 0 ? s[y * w + x - 1] : 0;
      const D = y < h - 1 ? s[(y + 1) * w + x] : 0;
      const j = y * 2 * W2 + x * 2;
      d[j] = C === A && C !== D && A !== B ? A : P;
      d[j + 1] = A === B && A !== C && B !== D ? B : P;
      d[j + W2] = D === C && D !== B && C !== A ? C : P;
      d[j + W2 + 1] = B === D && B !== A && D !== C ? D : P;
    }
  return o;
}

/** Часть ломаных: каждая растёт от начала на долю `k` своей длины. */
function cutLines(lines: [number, number][][], k: number): [number, number][][] {
  if (k >= 1) return lines;
  const out: [number, number][][] = [];
  for (const ln of lines) {
    let total = 0;
    for (let i = 0; i + 1 < ln.length; i++)
      total += Math.hypot(ln[i + 1][0] - ln[i][0], ln[i + 1][1] - ln[i][1]);
    let left = total * k;
    const part: [number, number][] = [ln[0]];
    for (let i = 0; i + 1 < ln.length && left > 0; i++) {
      const [x0, y0] = ln[i];
      const [x1, y1] = ln[i + 1];
      const d = Math.hypot(x1 - x0, y1 - y0);
      const q = Math.min(1, left / (d || 1));
      part.push([x0 + (x1 - x0) * q, y0 + (y1 - y0) * q]);
      left -= d;
    }
    if (part.length > 1) out.push(part);
  }
  return out;
}

/** Трещины в фигуру (тёмная черта, светлый край) и, если надо, в маску. */
function crackInto(
  p: Px,
  mask: Px | null,
  lines: [number, number][][],
  dark: RGBA,
  lit: RGBA,
): void {
  for (const ln of lines)
    for (let i = 0; i + 1 < ln.length; i++) {
      const [x0, y0] = ln[i];
      const [x1, y1] = ln[i + 1];
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
      for (let k = 0; k <= n; k++) {
        const x = Math.round(x0 + ((x1 - x0) * k) / n);
        const y = Math.round(y0 + ((y1 - y0) * k) / n);
        if (!p.solid(x, y)) continue;
        p.set(x, y, dark);
        if (p.solid(x - 1, y - 1)) p.set(x - 1, y - 1, lit);
        if (mask) {
          const m = mask.get(x, y);
          mask.set(x, y, [m[0], m[1], 255, 255]);
        }
      }
    }
}

/** Где глаза (прорези забрала) в фигуре 32×32. */
const EYES: Record<BDir, [number, number][]> = {
  down: [
    [12, 14],
    [13, 14],
    [18, 14],
    [19, 14],
  ],
  right: [
    [20, 14],
    [21, 14],
  ],
  up: [],
};

/**
 * Стекло фигуры: ступень робы, сторона, строка листа; `cr` — сколько фаз
 * трещин (у копий 0), `rv` — насколько проросла свежая (1…4), `dw` —
 * паутина смерти (0…6).
 */
function bodySrc(tier: number, dir: BDir, row: number, cr: number, rv: number, dw: number) {
  const key = `${tier}|${dir}|${row}|${cr}|${rv}|${dw}`;
  const hit = BODY.get(key);
  if (hit !== undefined) return hit;
  const src = heroPx(tier, dir, row);
  if (!src) return null;
  const body = glassify(scale2xFast(src), BOSS_RAMP, INK, 3, 0.9, 0.75);
  const mask = new Px(32, 32);
  // Сердцевина: фиолетовый огонь сквозь стекло груди (у спины не видно).
  if (dir !== 'up')
    for (let y = 24; y <= 29; y++)
      for (let x = 13; x <= 19; x++) {
        const d = Math.abs(x - 16) + Math.abs(y - 26.5) * 1.3;
        if (d > 3 || !body.solid(x, y)) continue;
        const c = body.get(x, y);
        if (c[0] === INK[0] && c[1] === INK[1]) continue;
        body.set(x, y, d < 1.4 ? VIO[3] : mixc(c, VIO[2], 0.65));
        mask.set(x, y, [0, d < 1.4 ? 255 : 150, 0, 255]);
      }
  // Трещины копятся по фазам; светлый край — только у свежей.
  for (let s = 1; s <= Math.min(3, cr); s++) {
    const fresh = s === cr;
    const lines = fresh ? cutLines(BOSS_CRACKS[s], rv / 4) : BOSS_CRACKS[s];
    crackInto(
      body,
      fresh ? mask : null,
      lines,
      hx('#0a0c1c'),
      fresh ? hx('#f0fcff') : hx('#3e5298'),
    );
  }
  if (dw > 0) crackInto(body, mask, cutLines(DEATH_WEB, dw / 6), hx('#0a0c1c'), hx('#f0fcff'));
  // Прорезь забрала (чернила внутри шлема) — горит во взгляде.
  for (let y = 6; y < 20; y++)
    for (let x = 3; x < 29; x++) {
      const c = body.get(x, y);
      if (!c[3] || c[0] !== INK[0] || c[1] !== INK[1]) continue;
      let inside = 0;
      for (const [dx, dy] of [
        [-3, 0],
        [3, 0],
        [0, -3],
        [0, 3],
      ])
        if (body.solid(x + dx, y + dy)) inside++;
      if (inside === 4) mask.set(x, y, [128, 0, 0, 255]);
    }
  for (const [x, y] of EYES[dir]) {
    body.set(x, y, CYAN_HOT);
    const m = mask.get(x, y);
    mask.set(x, y, [255, m[1], m[2], 255]);
  }
  const out = { hi: scale2xFast(scale2xFast(body)), mask };
  BODY.set(key, out);
  return out;
}

// ---- Карта тела: присед, наклон, шлем ---------------------------------------

/** Высота «ног» в фигуре: присед сжимает их, остальное опускается целиком. */
const CL = 11;
const crF = (h: number, c: number) => (h <= CL ? (h * (CL - c)) / CL : h - c);
const crI = (h: number, c: number) => (h <= CL - c ? (h * CL) / (CL - c) : h + c);
/** Доля шлема на высоте h (от ног): шлем гнётся отдельно, шея — плавно. */
const headW = (h: number) => sstep(12, 17, h);

interface BPlace {
  fx: number;
  fy: number;
  rot: number;
  crouch: number;
  hx: number;
  hy: number;
}

function placeOf(r: BRig, c: BCtx): BPlace {
  let rot = r.tilt;
  let hy = r.hy;
  let crouch = r.crouch;
  if (c.dir === 'right') rot += r.lean;
  else if (c.dir === 'down') {
    // Анфас наклон вперёд — шлем к зрителю (ниже), спина — выше. Мягче, чем
    // в профиль: анфас присед сплющивает фигуру в блин.
    hy += r.lean * 4;
    crouch = crouch * 0.75 + Math.max(0, r.lean);
  } else {
    hy -= r.lean * 4;
    crouch *= 0.75;
  }
  return { fx: BAX, fy: BAY, rot, crouch: cl(crouch, -4, 6), hx: r.hx, hy };
}

/** Точка фигуры (u, v) → точка кадра. */
function fmap(u: number, v: number, P: BPlace): [number, number] {
  const h = 32 - v;
  const w = headW(h);
  const x = u - 16 + w * P.hx;
  const y = -(crF(h, P.crouch) - w * P.hy);
  const cs = Math.cos(P.rot);
  const sn = Math.sin(P.rot);
  return [P.fx + x * cs - y * sn, P.fy + x * sn + y * cs];
}

interface GlowPx {
  x: number;
  y: number;
  /** 0 — глаз, 1 — сердцевина, 2 — свежая трещина, 3 — прорезь забрала. */
  k: number;
  v: number;
}

/**
 * Тело в кадр: обратная карта каждого пикселя кадра в фигуру ×4. `vis` < 1
 * — фигура по ту сторону зеркала: видны только часть полос, и они
 * разъехались вбок. `sheen` — полоса блика по стеклу (−1 — нет).
 */
function drawBody(dst: Px, glow: GlowPx[], S: BodySrc, P: BPlace, sheen: number): void {
  const cs = Math.cos(P.rot);
  const sn = Math.sin(P.rot);
  const hi = S.hi.data;
  const md = S.mask.data;
  const band = sheen >= 0 ? -14 + sheen * 44 : -999;
  for (let y = P.fy - 46; y <= P.fy + 6; y++) {
    for (let x = P.fx - 34; x <= P.fx + 34; x++) {
      const X1 = x + 0.5 - P.fx;
      const Y1 = y + 0.5 - P.fy;
      const X = X1 * cs + Y1 * sn;
      const Y = -X1 * sn + Y1 * cs;
      const hp = -Y;
      if (hp < -0.5 || hp > 40) continue;
      let h = crI(hp, P.crouch);
      h = crI(hp + headW(h) * P.hy, P.crouch);
      h = crI(hp + headW(h) * P.hy, P.crouch);
      const u = X - headW(h) * P.hx + 16;
      const v = 32 - h;
      if (u < 0 || v < 0 || u >= 32 || v >= 32) continue;
      const i = (Math.floor(v * 4) * 128 + Math.floor(u * 4)) * 4;
      if (!hi[i + 3]) continue;
      let c: RGBA = [hi[i], hi[i + 1], hi[i + 2], 255];
      const ink = c[0] === INK[0] && c[1] === INK[1] && c[2] === INK[2];
      if (!ink && Math.abs(u - v * 0.9 - band) < 1.3) c = mixc(c, WHITE, 0.42);
      dst.set(x, y, c);
      const mi = (Math.floor(v) * 32 + Math.floor(u)) * 4;
      if (!md[mi + 3]) continue;
      if (md[mi] === 128) glow.push({ x, y, k: 3, v: 128 });
      else if (md[mi]) glow.push({ x, y, k: 0, v: md[mi] });
      else if (md[mi + 2]) glow.push({ x, y, k: 2, v: md[mi + 2] });
      else if (md[mi + 1]) glow.push({ x, y, k: 1, v: md[mi + 1] });
    }
  }
}

/**
 * Фигура по ту сторону зеркала: видна часть полос по 2 px, и они разъехались
 * вбок в разные стороны (`vis` 1 — вся здесь, 0 — ушла целиком).
 */
function sliceFig(p: Px, vis: number): Px {
  const o = new Px(p.w, p.h);
  for (let y = 0; y < p.h; y++) {
    const sI = Math.floor((y - BAY + 48) / 2);
    const th = hash(sI, 11) * 0.7 + 0.3 * Math.min(1, Math.abs(sI - 11) / 12);
    if (th >= vis) continue;
    const side = sI % 2 ? 1 : -1;
    const off = Math.round(side * Math.pow(1 - vis, 1.4) * (7 + 12 * hash(sI, 13)));
    const k = 0.6 + 0.4 * vis;
    for (let x = 0; x < p.w; x++) {
      const i = (y * p.w + x) * 4;
      if (!p.data[i + 3]) continue;
      o.set(x + off, y, [p.data[i], p.data[i + 1], p.data[i + 2], Math.round(p.data[i + 3] * k)]);
    }
  }
  return o;
}

// ---- Рука и клинок -----------------------------------------------------------

const ARM_T: Tones = [BOSS_RAMP[0], BOSS_RAMP[1], BOSS_RAMP[2], BOSS_RAMP[4]];

interface BGeom {
  sx: number;
  sy: number;
  hx: number;
  hy: number;
  a: number;
  tx: number;
  ty: number;
}

/** Плечо, кулак, остриё: кулак ходит по дуге вокруг плеча вслед за клинком. */
function bladeGeom(r: BRig, c: BCtx, P: BPlace): BGeom {
  const [su, sv] = SHOULDER[c.dir];
  const [sx, sy] = fmap(su, sv, P);
  const a = c.phi + r.b;
  let ox = r.hf;
  let oy = 0;
  if (c.dir === 'down') {
    ox = -r.hl;
    oy = r.hf * 0.5;
  } else if (c.dir === 'up') {
    ox = r.hl;
    oy = -r.hf * 0.5;
  }
  const hx = sx + Math.cos(a) * r.arm + ox;
  const hy = sy + Math.sin(a) * r.arm * 0.7 - r.lift + oy;
  return { sx, sy, hx, hy, a, tx: hx + Math.cos(a) * r.len, ty: hy + Math.sin(a) * r.len };
}

function drawArm(p: Px, g: BGeom): void {
  limb(p, g.sx, g.sy, g.hx, g.hy, 1.7, 1.35, ARM_T, 0.1);
  shadeEll(p, g.hx, g.hy, 1.9, 1.7, ARM_T, 0.3);
}

/** Звезда-блик (поверх темноты). */
function glintAt(p: Px, x: number, y: number, s: number, a: number): void {
  const X = Math.round(x);
  const Y = Math.round(y);
  p.set(X, Y, alpha(WHITE, a));
  for (let i = 1; i <= s; i++) {
    const k = a * (1 - (i - 1) / (s + 0.5));
    const c = i === 1 ? alpha(CYAN_HOT, k) : alpha(CYAN, k * 0.85);
    p.set(X + i, Y, c);
    p.set(X - i, Y, c);
    p.set(X, Y + i, c);
    p.set(X, Y - i, c);
  }
  if (s >= 3) {
    const c = alpha(CYAN, a * 0.5);
    p.set(X + 1, Y + 1, c);
    p.set(X - 1, Y - 1, c);
    p.set(X + 1, Y - 1, c);
    p.set(X - 1, Y + 1, c);
  }
}

/** Промежуточное положение клинка между двумя выборками (для гладкого серпа). */
function lerpGeom(A: BGeom, B: BGeom, k: number): BGeom {
  const hx = A.hx + (B.hx - A.hx) * k;
  const hy = A.hy + (B.hy - A.hy) * k;
  const a = A.a + (B.a - A.a) * k;
  const la = Math.hypot(A.tx - A.hx, A.ty - A.hy);
  const lb = Math.hypot(B.tx - B.hx, B.ty - B.hy);
  const len = la + (lb - la) * k;
  return { sx: A.sx, sy: A.sy, hx, hy, a, tx: hx + Math.cos(a) * len, ty: hy + Math.sin(a) * len };
}

/**
 * След-серп: площадь, которую клинок вымел за `win` секунд до t, — по
 * настоящей кривой техники. У клинка след во всю длину лезвия, по дуге назад
 * — только у острия (серп) и тусклее; ход тела за это время вычтен (след
 * лежит в мире). `sk` — сила следа: 1 на ударе и в миг контакта, к концу
 * проводки гаснет.
 */
function drawSmear(
  lit: Px,
  tech: string,
  v: number,
  t: number,
  c: BCtx,
  win: number,
  heavy: boolean,
  cur: BRig,
  sk: number,
): void {
  const n = 12;
  const raw: BGeom[] = [];
  for (let i = n; i >= 0; i--) {
    const r = techAt(tech, v, t - (win * i) / n, c).r;
    const g = bladeGeom(r, c, placeOf(r, c));
    // Ход тела за это время: старый клинок стоял там, где было тело тогда.
    const df = r.fwd - cur.fwd;
    const ox = df * Math.cos(c.phi);
    const oy = df * Math.sin(c.phi) * 0.7 - (r.hop - cur.hop);
    g.hx += ox;
    g.hy += oy;
    g.tx += ox;
    g.ty += oy;
    raw.push(g);
  }
  // Гуще там, где клинок летел быстро: иначе дуга ломается углами.
  const seq: BGeom[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (i) {
      const m = Math.ceil(Math.abs(raw[i].a - raw[i - 1].a) / 0.09);
      for (let j = 1; j < m; j++) seq.push(lerpGeom(raw[i - 1], raw[i], j / m));
    }
    seq.push(raw[i]);
  }
  let total = 0;
  for (let i = 1; i < seq.length; i++) total += Math.abs(seq[i].a - seq[i - 1].a);
  if (total < 0.35) return;
  const dim = sk >= 0.8 ? 0 : sk >= 0.45 ? 1 : 2;
  const buf = new Px(lit.w, lit.h);
  const tiers: RGBA[] = [
    [0, 0, 0, 0],
    alpha(GL[2], 0.4),
    alpha(CYAN, 0.62),
    alpha(CYAN_HOT, 0.86),
    alpha(WHITE, 0.95),
  ];
  const ext = heavy ? 2.5 : 1.2;
  const pt = (g: BGeom, d: number): [number, number] => [
    g.hx + Math.cos(g.a) * d,
    g.hy + Math.sin(g.a) * d,
  ];
  // От хвоста к клинку: новое ложится поверх старого.
  let cum = total;
  for (let i = 0; i + 1 < seq.length; i++) {
    const A = seq[i];
    const B = seq[i + 1];
    const da = Math.abs(B.a - A.a);
    const frA = cum / total;
    cum -= da;
    const frB = cum / total;
    if (da < 0.004) continue;
    const lenA = Math.hypot(A.tx - A.hx, A.ty - A.hy);
    const lenB = Math.hypot(B.tx - B.hx, B.ty - B.hy);
    const inA = lenA * (0.4 + 0.52 * Math.pow(frA, 0.8));
    const inB = lenB * (0.4 + 0.52 * Math.pow(frB, 0.8));
    const outA = lenA + ext * (1 - frA * 0.6);
    const outB = lenB + ext * (1 - frB * 0.6);
    const tier = (frB < 0.28 ? 3 : frB < 0.62 ? 2 : 1) - dim;
    if (tier <= 0) continue;
    if (heavy && frB < 0.8)
      poly(
        buf,
        [pt(A, outA), pt(A, outA + 2.5), pt(B, outB + 2.5), pt(B, outB)],
        [Math.max(1, tier - 1), 0, 0, 255],
      );
    poly(buf, [pt(A, inA), pt(A, outA), pt(B, outB), pt(B, inB)], [tier, 0, 0, 255]);
    if (frB < 0.5 && !dim)
      poly(buf, [pt(A, outA - 1.3), pt(A, outA), pt(B, outB), pt(B, outB - 1.3)], [4, 0, 0, 255]);
  }
  for (let i = 0; i < buf.data.length; i += 4) {
    const k = buf.data[i + 3] ? buf.data[i] : 0;
    if (!k) continue;
    lit.set((i / 4) % lit.w, Math.floor(i / 4 / lit.w), tiers[k]);
  }
}

// ---- Кадр ------------------------------------------------------------------

interface BReq {
  tier: number;
  copy: boolean;
  /** Трещины: фаз (у копии 0), свежая проросла на rv/4, светится cg (0…3). */
  cr: number;
  rv: number;
  cg: number;
  tech: string;
  v: number;
  /** Кадр отрезка (24 к/с; у покоя и бега — свой счёт). */
  f: number;
  /** Время кадра, с (для покоя и бега — фаза). */
  t: number;
  dir: BDir;
  /** Взгляд — 1/16 оборота (правый эквивалент). */
  q: number;
  hk: number;
  rk: number;
  /** Вздрог от удара героя 0…2. */
  fl: number;
  look: Look;
}

interface BFrame extends MobFrame {
  /** Сдвиг кадра от хода тела (вдоль взгляда и подскок), до зеркала. */
  bx: number;
  by: number;
}

// ~440 кадров: обрезанный кадр с подсветкой в среднем ~15 КБ, это ≈7 МБ — в
// бюджете библии (≈11 МБ на 400 кадров 88×80).
const BFR = frameLRU<BFrame>(440);

/** Для замеров стенда: сколько кадров отражения в кеше и сброс кеша. */
export const f7BossCache = {
  size: () => BFR.size,
  clear: (all = false) => {
    BFR.clear();
    if (all) {
      BODY.clear();
      INTACT.clear();
    }
  },
};

function ctxOf(q: BReq): BCtx {
  return {
    dir: q.dir,
    phi: (q.q * TAU) / 16,
    hs: q.hk / 100,
    cw: q.copy ? 1.15 : 1,
    rec: q.rk / 100,
  };
}

/** Кадр без зеркала и вспышки. */
function bossBase(q: BReq): BFrame | null {
  const key = `b|${q.tier}|${q.copy ? 1 : 0}|${q.cr}|${q.rv}|${q.cg}|${q.tech}|${q.v}|${q.f}|${q.dir}|${q.q}|${q.hk}|${q.rk}|${q.fl}|${q.look}`;
  const hit = BFR.get(key);
  if (hit) return hit;
  const c = ctxOf(q);
  const { r, fx } = techAt(q.tech, q.v, q.t, c);
  if (q.fl > 0) {
    // Вздрог от удара героя: шлем назад, присел, глаза вспыхнули.
    const k = q.fl / 2;
    r.lean -= 0.16 * k;
    r.hy -= 1.1 * k;
    r.crouch += 0.7 * k;
    r.eyes = 1;
    r.b += 0.22 * k;
  }
  const dying = q.tech === 'die' || q.tech === 'dieC';
  const shatterAt = q.tech === 'die' ? DIE_SHATTER : DIEC_SHATTER;
  if (dying && q.t >= shatterAt) return dieShards(q, c);
  const S = bodySrc(q.tier, q.dir, r.row, q.cr, q.rv, fx.web ?? 0);
  if (!S) return null;
  const P = placeOf(r, c);
  let p = new Px(BW, BH);
  let lit = new Px(BW, BH);
  const glow: GlowPx[] = [];
  const g = bladeGeom(r, c, P);
  const bladeOn = !(q.tech === 'die' && q.t > 0.12);
  const sn = Math.sin(g.a);
  const behind =
    r.front > 0.5 ? false : r.front < -0.5 ? true : sn < -0.3 || (c.dir === 'up' && sn < 0.45);
  const blade = () => {
    if (!bladeOn) return;
    glassBlade(p, g.hx, g.hy, g.a, r.len, 1.7, r.hot > 0.5 ? 1 : 0);
  };
  if (behind) {
    blade();
    drawArm(p, g);
  }
  drawBody(p, glow, S, P, fx.sheen ?? -1);
  if (!behind) {
    drawArm(p, g);
    blade();
  }
  if (q.tech === 'die' && q.t > 0.12) dropBlade(p, lit, q.t, c);
  if (q.look === 'elite') p.outline(GOLD);
  p.outline(alpha(INK, 0.6));

  // ---- Поверх темноты ----
  const eyeC = r.gz > 0.05 ? mixc(CYAN_HOT, VIO[3], Math.min(1, r.gz * 1.5)) : CYAN_HOT;
  const eyesAt = glow.filter((gp) => gp.k === 0).map((gp) => [gp.x, gp.y] as const);
  for (const gp of glow) {
    if (gp.k === 0) {
      lit.set(gp.x, gp.y, alpha(eyeC, cl(0.3 + 0.7 * r.eyes)));
      if (r.eyes > 0.85 || r.gz > 0.3) {
        const h = alpha(r.gz > 0.3 ? VIO[2] : CYAN, 0.3);
        lit.set(gp.x, gp.y - 1, h);
        lit.set(gp.x, gp.y + 1, h);
      }
    } else if (gp.k === 1 && r.core > 0.45)
      lit.set(gp.x, gp.y, alpha(gp.v > 200 ? VIO[3] : VIO[2], cl((r.core - 0.45) * 1.8)));
    else if (gp.k === 3 && r.gz > 0.1) {
      // Прорезь забрала наливается фиолетовым огнём от глаз к краям: чем
      // ближе к глазу и чем дальше взгляд, тем горячее; редкие искры мерцают.
      let d = 9;
      for (const e of eyesAt) d = Math.min(d, Math.abs(e[0] - gp.x) + Math.abs(e[1] - gp.y));
      const heat = r.gz * 1.6 - d * 0.28 + (hash(gp.x, gp.y, q.f) > 0.9 ? 0.35 : 0);
      if (heat > 0.05) {
        const c0 = heat > 1.1 ? WHITE : heat > 0.7 ? VIO[3] : heat > 0.35 ? VIO[2] : VIO[1];
        lit.set(gp.x, gp.y, alpha(c0, cl(0.35 + heat * 0.6)));
      }
    } else if (gp.k === 2 && (q.cg > 0 || dying))
      lit.set(
        gp.x,
        gp.y,
        alpha(CYAN_HOT, dying ? 0.5 + (fx.inner ?? 0) * 0.5 : Math.min(1, q.cg / 3)),
      );
  }
  // Взгляд: пламя из прорезей, кайма фиолетом, вспышка в миг удара.
  if (r.gz > 0.15) gazeFire(lit, p, glow, r.gz, q.f);
  // Клинок накалён — кромка светится.
  if (bladeOn && r.hot > 0.15) {
    const ux = Math.cos(g.a);
    const uy = Math.sin(g.a);
    const L = r.len;
    for (let i = 2; i <= L; i++)
      lit.set(
        Math.round(g.hx + ux * i - uy * 0.6),
        Math.round(g.hy + uy * i + ux * 0.6),
        alpha(CYAN_HOT, (0.25 + 0.6 * r.hot) * (0.5 + (0.5 * i) / L)),
      );
  }
  // По ту сторону зеркала — полосами (и тело, и его свет).
  if (r.vis < 0.999) {
    p = sliceFig(p, r.vis);
    lit = sliceFig(lit, r.vis);
  }
  if (fx.smear && bladeOn) drawSmear(lit, q.tech, q.v, q.t, c, fx.smear, !!fx.heavy, r, fx.sk ?? 1);
  if (fx.glint && bladeOn) glintAt(lit, g.tx, g.ty, fx.glint > 0.7 ? 3 : 2, cl(fx.glint));
  if (fx.bflash && bladeOn) {
    // Миг контакта: лезвие белое целиком, на острие — звезда.
    const ux = Math.cos(g.a);
    const uy = Math.sin(g.a);
    for (let i = 2; i <= r.len; i++)
      for (const w of [-0.7, 0, 0.7])
        lit.set(
          Math.round(g.hx + ux * i - uy * w),
          Math.round(g.hy + uy * i + ux * w),
          alpha(WHITE, 0.9 * fx.bflash),
        );
    glintAt(lit, g.tx, g.ty, 3, fx.bflash);
  }
  if (fx.ring) chargeRing(lit, P, fx.ring, q.f);
  if (fx.motes) motes(lit, g, fx.motes, q.t);
  if (fx.spark) {
    const mx = g.hx + Math.cos(g.a) * r.len * 0.55;
    const my = g.hy + Math.sin(g.a) * r.len * 0.55;
    glintAt(lit, mx, my, Math.round(2 + fx.spark * 3), cl(fx.spark * 1.2));
  }
  if (fx.streak) streaks(lit, P, c, fx.streak);
  if (fx.stars !== undefined && fx.stars >= 0) dazeStars(lit, P, r, fx.stars);
  if (r.pane > 0.05) pane(lit, P, c, r.pane, fx.sheen ?? 0, fx.pflash ?? 0);
  if (r.seam > 0.02) seam(lit, P, r.seam);
  if (fx.inner) innerLight(lit, p, fx.inner);
  // Смена фазы: первый миг — стекло вспыхивает насквозь, как от удара.
  if (q.cg === 4) innerLight(lit, p, 0.55);

  // Дрожь подготовки — сдвигом кадра, свой на каждый кадр техники.
  const tr = fx.tremble ?? 0;
  const jx = tr ? (hash(q.f, 17, q.v) - 0.5) * 2 * tr : 0;
  const jy = tr ? (hash(q.f, 23, q.v) - 0.5) * 0.8 * tr : 0;
  const shadowK = r.vis * (1 - r.hop * 0.05);
  return cropped(key, p, lit, glow, r, c, jx, jy, shadowK);
}

/** Обрезать пустое, собрать кадр движка. */
function cropped(
  key: string,
  p: Px,
  lit: Px,
  glow: GlowPx[],
  r: BRig,
  c: BCtx,
  jx: number,
  jy: number,
  shadowK: number,
): BFrame {
  let x0 = p.w;
  let y0 = p.h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      const i = (y * p.w + x) * 4;
      if (!p.data[i + 3] && !lit.data[i + 3]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  if (x1 < 0) {
    x0 = BAX;
    y0 = BAY;
    x1 = BAX;
    y1 = BAY;
  }
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const crop = (s: Px) => {
    const o = new Px(w, h);
    for (let y = 0; y < h; y++)
      o.data.set(
        s.data.subarray(((y + y0) * s.w + x0) * 4, ((y + y0) * s.w + x0 + w) * 4),
        y * w * 4,
      );
    return o;
  };
  let litOn = false;
  for (let i = 3; i < lit.data.length; i += 4)
    if (lit.data[i]) {
      litOn = true;
      break;
    }
  const eye = glow.find((gp) => gp.k === 0);
  const sq = r.sq;
  const side = c.dir === 'right';
  const out: BFrame = {
    img: crop(p).canvas(),
    lit: litOn ? crop(lit).canvas() : null,
    ax: BAX - x0,
    ay: BAY - y0,
    eye: eye && r.vis > 0.5 ? [eye.x - x0, eye.y - y0] : null,
    bx: r.fwd * Math.cos(c.phi) + jx,
    by: r.fwd * Math.sin(c.phi) * 0.7 - r.hop + jy,
    sx: side ? 1 + sq : 1 - sq * 0.4,
    sy: side ? 1 - sq * 0.5 : 1 + sq * 0.6,
    still: true,
    shadow: Math.max(0, 11 * shadowK),
  };
  return BFR.set(key, out);
}

function mirrorCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const o = document.createElement('canvas');
  o.width = src.width;
  o.height = src.height;
  const g = o.getContext('2d');
  if (g) {
    g.translate(src.width, 0);
    g.scale(-1, 1);
    g.drawImage(src, 0, 0);
  }
  return o;
}

function flashCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const o = document.createElement('canvas');
  o.width = src.width;
  o.height = src.height;
  const g = o.getContext('2d');
  if (g) {
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.fillRect(0, 0, o.width, o.height);
  }
  return o;
}

/** Кадр по запросу: левая сторона — зеркало правой, вспышка — поверх. */
function bossFrame(q: BReq, left: boolean, flash: boolean): BFrame | null {
  if (!left && !flash) return bossBase(q);
  const key = `v|${q.tier}|${q.copy ? 1 : 0}|${q.cr}|${q.rv}|${q.cg}|${q.tech}|${q.v}|${q.f}|${q.dir}|${q.q}|${q.hk}|${q.rk}|${q.fl}|${q.look}|${left ? 1 : 0}|${flash ? 1 : 0}`;
  const hit = BFR.get(key);
  if (hit) return hit;
  if (flash) {
    const src = bossFrame(q, left, false);
    if (!src) return null;
    return BFR.set(key, { ...src, img: flashCanvas(src.img) });
  }
  const b = bossBase(q);
  if (!b) return null;
  return BFR.set(key, {
    ...b,
    img: mirrorCanvas(b.img),
    lit: b.lit ? mirrorCanvas(b.lit) : null,
    eye: b.eye ? [b.img.width - 1 - b.eye[0], b.eye[1]] : null,
    ax: b.img.width - b.ax,
    bx: -b.bx,
  });
}

/** Сквозь зеркало: фигура распадается полосами-осколками (k 0…1). */
function slices(p: Px, k: number, out: boolean): Px {
  const o = new Px(p.w, p.h);
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      const i = (y * p.w + x) * 4;
      if (!p.data[i + 3]) continue;
      const band = Math.floor(x / 3);
      const th = hash(band, 3);
      const vis = out ? th > k : th < k;
      if (!vis) continue;
      const lift = out ? Math.round(k * 5 * hash(band, 9)) : 0;
      o.set(x, y - lift, [
        p.data[i],
        p.data[i + 1],
        p.data[i + 2],
        Math.round(p.data[i + 3] * (out ? 1 - k * 0.5 : 0.5 + k * 0.5)),
      ]);
    }
  return o;
}

// ---- Всё, что светится вокруг тела ------------------------------------------

/**
 * Кольцо набора вокруг тела — то же, что у тяжёлого удара героя: растёт с
 * набором, полное — белое.
 */
function chargeRing(lit: Px, P: BPlace, k: number, f: number): void {
  const R = 7 + k * 12;
  const cx = P.fx;
  const cy = P.fy - 12;
  const full = k > 0.95;
  const c = full ? WHITE : CYAN;
  const n = Math.ceil(R * 7);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    // Дуга «бежит»: на каждом кадре гаснет своя четверть.
    const gap = (i / n + f * 0.07) % 1 < 0.18 && !full;
    if (gap) continue;
    lit.set(
      Math.round(cx + Math.cos(a) * R),
      Math.round(cy + Math.sin(a) * R * 0.62),
      alpha(c, 0.35 + 0.5 * k),
    );
  }
}

/** Искры набора: стекают к острию по спирали, ярче у клинка. */
function motes(lit: Px, g: BGeom, k: number, t: number): void {
  for (let i = 0; i < 6; i++) {
    const fr = (t * 1.7 + hash(i, 3)) % 1;
    const ang = hash(i, 5) * TAU + t * 3.2;
    const rad = 17 * (1 - fr) + 1;
    const x = g.tx + Math.cos(ang) * rad;
    const y = g.ty + Math.sin(ang) * rad * 0.8;
    const a = (0.25 + 0.75 * fr) * k;
    lit.set(Math.round(x), Math.round(y), alpha(CYAN_HOT, a));
    if (fr > 0.55)
      lit.set(
        Math.round(x - Math.cos(ang) * 1.2),
        Math.round(y - Math.sin(ang)),
        alpha(CYAN, a * 0.6),
      );
  }
}

/** Полосы скорости позади тела (выпад, пробежка). */
function streaks(lit: Px, P: BPlace, c: BCtx, k: number): void {
  const ux = Math.cos(c.phi);
  const uy = Math.sin(c.phi);
  for (let i = 0; i < 4; i++) {
    // Полосы — вдоль хода, позади, по высоте тела; две фазы мигают.
    const lat = [-9, -2, 5, 11][i] + (k === 2 ? 1 : 0);
    const h = [26, 18, 10, 20][i];
    const back = 10 + ((i * 5 + k * 3) % 7);
    const L = 7 + ((i * 3 + k) % 4) * 2;
    const x0 = P.fx - ux * back - uy * lat;
    const y0 = P.fy - h * (Math.abs(ux) > 0.5 ? 1 : 0.4) - uy * back * 0.7 + ux * lat * 0.4;
    for (let s = 0; s < L; s++) {
      const q = s / L;
      lit.set(
        Math.round(x0 - ux * s),
        Math.round(y0 - uy * s * 0.7),
        alpha(q < 0.3 ? CYAN_HOT : CYAN, 0.55 * (1 - q)),
      );
    }
  }
}

/** Звёзды оглушения: три по кругу над шлемом, задняя — тусклее. */
function dazeStars(lit: Px, P: BPlace, r: BRig, ph: number): void {
  const [cx, cy] = fmap(16 + r.hx, 1, P);
  for (let i = 0; i < 3; i++) {
    const a = ph * TAU + (i / 3) * TAU;
    const x = Math.round(cx + Math.cos(a) * 9);
    const y = Math.round(cy - 3 + Math.sin(a) * 2.6);
    const k = Math.sin(a) < 0 ? 0.5 : 1;
    lit.set(x, y, alpha(WHITE, k));
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ])
      lit.set(x + dx, y + dy, alpha(hx('#c8f0ff'), 0.8 * k));
  }
}

/** Зеркальная защита: стекло перед телом, по нему бежит блик. */
function pane(lit: Px, P: BPlace, c: BCtx, k: number, sheen: number, fl = 0): void {
  const rim = mixc(CYAN, WHITE, fl);
  const side = c.dir === 'right';
  const cx = P.fx + (side ? 9 : 0);
  const cy = P.fy - 16 + (c.dir === 'down' ? 3 : 0);
  const rx = side ? 3.2 : 12;
  const ry = 16;
  const back = c.dir === 'up' ? 0.5 : 1;
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
    for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
      const d = Math.hypot((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry);
      if (d > 1.04) continue;
      const band = Math.abs(x - cx - (y - cy) * 0.5 - (sheen * 2 - 1) * rx * 1.6) < 1.2;
      if (d > 0.86) lit.set(x, y, alpha(rim, (0.55 + 0.4 * fl) * Math.max(k, fl) * back));
      else if (fl > 0.3 && (x + y) % 2 === 0) lit.set(x, y, alpha(WHITE, 0.35 * fl));
      else if (band && sheen >= 0) lit.set(x, y, alpha(CYAN_HOT, 0.5 * k * back));
      else if ((x + y) % 2 === 0) lit.set(x, y, alpha(CYAN, 0.07 * k * back));
    }
}

/** Шов зеркала: черта встаёт, потом раскрывается овалом. */
function seam(lit: Px, P: BPlace, k: number): void {
  const cx = P.fx;
  const cy = P.fy - 16;
  const h = 17 * Math.min(1, k / 0.45);
  for (let y = Math.round(cy - h); y <= Math.round(cy + h); y++) {
    const e = 1 - Math.abs(y - cy) / (h + 1);
    lit.set(cx, y, alpha(WHITE, 0.95 * e));
    lit.set(cx - 1, y, alpha(CYAN, 0.45 * e));
    lit.set(cx + 1, y, alpha(CYAN, 0.45 * e));
  }
  if (k <= 0.45) return;
  const rx = 12 * Math.min(1, (k - 0.45) / 0.45);
  if (rx < 1) return;
  for (let y = Math.floor(cy - 17); y <= Math.ceil(cy + 17); y++)
    for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
      const d = Math.hypot((x + 0.5 - cx) / rx, (y + 0.5 - cy) / 17);
      if (d > 1.05) continue;
      if (d > 0.88) lit.set(x, y, alpha(CYAN, 0.6));
      else if ((x + y) % 3 === 0) lit.set(x, y, alpha(CYAN, 0.1));
    }
}

/** Взгляд: пламя из прорезей, фиолетовая кайма по силуэту, вспышка. */
function gazeFire(lit: Px, p: Px, glow: GlowPx[], gz: number, f: number): void {
  const k = Math.min(1, gz);
  let ex0 = 1e9;
  let ex1 = -1e9;
  let ey = 0;
  let ne = 0;
  for (const gp of glow) {
    if (gp.k !== 0) continue;
    ex0 = Math.min(ex0, gp.x);
    ex1 = Math.max(ex1, gp.x);
    ey += gp.y;
    ne++;
    // Глаз — белое ядро; над ним язык пламени, колышется по кадрам.
    if (k > 0.5) lit.set(gp.x, gp.y, alpha(WHITE, 0.9));
    const h = Math.round(2 + 7 * k * (0.45 + 0.55 * hash(f, gp.x, 3)));
    const sway = Math.round((hash(f >> 1, gp.x, 5) - 0.5) * 2);
    for (let i = 1; i <= h; i++) {
      const q = i / (h + 1);
      const x = gp.x + (q > 0.5 ? sway : 0);
      const col = q < 0.25 ? WHITE : q < 0.5 ? VIO[3] : q < 0.8 ? VIO[2] : VIO[1];
      lit.set(x, gp.y - i, alpha(col, 0.95 - q * 0.55));
    }
  }
  // Кайма: снаружи силуэта, где рядом тело.
  const a = 0.5 * k;
  if (a > 0.05)
    for (let y = 1; y < p.h - 1; y++)
      for (let x = 1; x < p.w - 1; x++) {
        if (p.solid(x, y)) continue;
        if (p.solid(x - 1, y) || p.solid(x + 1, y) || p.solid(x, y - 1) || p.solid(x, y + 1))
          if ((x + y + f) % 2 === 0 || k > 0.7) lit.set(x, y, alpha(VIO[2], a));
      }
  if (gz > 1.02 && ne) {
    // Вспышка взгляда: черта через забрало, белое ядро.
    const y = Math.round(ey / ne);
    const s = cl((gz - 1) / 0.25);
    for (let x = ex0 - 10; x <= ex1 + 10; x++) {
      const d = x < ex0 ? ex0 - x : x > ex1 ? x - ex1 : 0;
      const q = 1 - d / 11;
      lit.set(x, y, alpha(d < 3 ? WHITE : VIO[3], q * s));
      if (d < 5) {
        lit.set(x, y - 1, alpha(VIO[2], q * s * 0.6));
        lit.set(x, y + 1, alpha(VIO[2], q * s * 0.6));
      }
    }
  }
}

/** Свет изнутри перед раскалом: стекло светится насквозь. */
function innerLight(lit: Px, p: Px, k: number): void {
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      const i = (y * p.w + x) * 4;
      if (p.data[i + 3] < 200) continue;
      const ink = p.data[i] === INK[0] && p.data[i + 1] === INK[1] && p.data[i + 2] === INK[2];
      lit.set(x, y, alpha(ink ? CYAN : CYAN_HOT, (ink ? 0.35 : 0.7) * k));
    }
}

/** Смерть: клинок выпал из руки при 0,12 и лежит на полу (отскок). */
function dropBlade(p: Px, lit: Px, t: number, c: BCtx): void {
  const r0 = techDie(0.12, c, false).r;
  const g0 = bladeGeom(r0, c, placeOf(r0, c));
  const len = r0.len;
  const mx0 = g0.hx + Math.cos(g0.a) * len * 0.5;
  const my0 = g0.hy + Math.sin(g0.a) * len * 0.5;
  const floor = BAY + 3;
  const tau = t - 0.12;
  const G = 280;
  const vy0 = -26;
  // Время падения на пол: my0 + vy0·τ + G·τ²/2 = floor.
  const D = floor - my0;
  const tl = (-vy0 + Math.sqrt(vy0 * vy0 + 2 * G * Math.max(0, D))) / G;
  const land = Math.cos(g0.a) >= 0 ? 0.18 : Math.PI - 0.18;
  let mx: number;
  let my: number;
  let a: number;
  const spin = Math.cos(g0.a) >= 0 ? 6.5 : -6.5;
  if (tau < tl) {
    mx = mx0 + Math.cos(c.phi) * 9 * tau;
    my = my0 + vy0 * tau + (G * tau * tau) / 2;
    a = g0.a + (land - g0.a) * eIn(tau / tl) + Math.sin((tau / tl) * Math.PI) * spin * 0.15;
  } else {
    const b = tau - tl;
    mx = mx0 + Math.cos(c.phi) * 9 * tl + Math.cos(c.phi) * 3 * Math.min(b, 0.1);
    // Отскок: звякнул и лёг.
    my = floor - (b < 0.1 ? Math.sin((b / 0.1) * Math.PI) * 2 : 0);
    a = land + (b < 0.1 ? Math.sin((b / 0.1) * Math.PI) * 0.25 : 0);
  }
  const hx0 = mx - Math.cos(a) * len * 0.5;
  const hy0 = my - Math.sin(a) * len * 0.5;
  glassBlade(p, hx0, hy0, a, len, 1.6, 0);
  if (tau >= tl && tau < tl + 0.12) glintAt(lit, mx, my - 1, 2, 1 - (tau - tl) / 0.12);
}

/**
 * Раскол: последний целый кадр режется на осколки (ближайшее из 13 зёрен с
 * рваной кромкой), они разлетаются от сердцевины, падают на пол, звякают
 * и лежат, мерцая гранью, потом гаснут. У отблеска — резче и дальше.
 */
interface Intact {
  src: Px;
  ox: number;
  oy: number;
  /** Номер осколка каждого пикселя (−1 — пусто) и низ каждого осколка. */
  seedOf: Int16Array;
  bottom: number[];
  seeds: [number, number][];
}
const INTACT = frameLRU<Intact>(8);
const SHARDS = 18;

/** Последний целый кадр, разрезанный на осколки (ближайшее зерно, рваная кромка). */
function intactOf(q: BReq, S0: number): Intact | null {
  const key = `${q.tech}|${q.dir}|${q.q}|${q.tier}|${q.copy ? 1 : 0}|${q.cr}|${q.hk}|${q.look}`;
  const hit = INTACT.get(key);
  if (hit) return hit;
  const base = bossBase({ ...q, f: -1, t: S0 - 0.02 });
  if (!base) return null;
  const src = fromCanvas(base.img);
  const ox = BAX - base.ax;
  const oy = BAY - base.ay;
  const seeds: [number, number][] = [];
  for (let i = 0; i < SHARDS; i++)
    seeds.push([
      BAX - 14 + hash(i, 61) * 28,
      BAY - 34 + (i / (SHARDS - 1)) * 32 + (hash(i, 67) - 0.5) * 6,
    ]);
  const seedOf = new Int16Array(src.w * src.h).fill(-1);
  const bottom = new Array<number>(SHARDS).fill(-1e9);
  for (let y = 0; y < src.h; y++)
    for (let x = 0; x < src.w; x++) {
      if (!src.data[(y * src.w + x) * 4 + 3]) continue;
      const X = x + ox;
      const Y = y + oy;
      let best = 0;
      let bd = 1e9;
      for (let s = 0; s < SHARDS; s++) {
        const d =
          (X - seeds[s][0]) ** 2 + (Y - seeds[s][1]) ** 2 * 1.4 + hash(X >> 1, Y >> 1, s) * 30;
        if (d < bd) {
          bd = d;
          best = s;
        }
      }
      seedOf[y * src.w + x] = best;
      bottom[best] = Math.max(bottom[best], Y);
    }
  return INTACT.set(key, { src, ox, oy, seedOf, bottom, seeds });
}

/**
 * Раскол: последний целый кадр разлетается осколками от сердцевины —
 * большинство падает у ног, редкие улетают дальше; упав, осколок звякает,
 * ложится плашмя (сплющивается к своему низу) и мерцает гранью, потом всё
 * гаснет. У отблеска — резче и дальше (его осколки режут, `f7_copyburst`).
 */
function dieShards(q: BReq, c: BCtx): BFrame {
  const copy = q.tech === 'dieC';
  const S0 = copy ? DIEC_SHATTER : DIE_SHATTER;
  const end = copy ? DIEC_T : DIE_T;
  const it = intactOf(q, S0);
  const p = new Px(BW, BH);
  const lit = new Px(BW, BH);
  if (it) {
    const { src, ox, oy, seedOf, bottom, seeds } = it;
    const tau = q.t - S0;
    const fade = 1 - cl((q.t - (end - 0.4)) / 0.4);
    const cx = BAX;
    const cy = BAY - 11;
    const path = seeds.map(([sx, sy], i) => {
      const ang = Math.atan2(sy - cy, sx - cx) + (hash(i, 71) - 0.5) * 0.9;
      const h = hash(i, 73);
      const sp = copy ? 35 + h * 85 : 10 + h * h * 75;
      let x = 0;
      let y = 0;
      let vx = Math.cos(ang) * sp;
      let vy = Math.sin(ang) * sp * 0.4 - (copy ? 50 : 35) - hash(i, 79) * 50;
      const floor = BAY + 1 + (hash(i, 83) - 0.35) * 10 - bottom[i];
      let landed = -1;
      const dt = 1 / 120;
      for (let st = 0; st * dt < tau; st++) {
        vy += 720 * dt;
        x += vx * dt;
        y += vy * dt;
        if (y > floor) {
          y = floor;
          if (landed < 0) landed = st * dt;
          vy = vy > 60 ? -vy * 0.3 : 0;
          vx *= 0.4;
        }
      }
      const flat = landed >= 0 ? cl((tau - landed) / 0.06) : 0;
      return { dx: Math.round(x), dy: Math.round(y), landed, flat };
    });
    for (let y = 0; y < src.h; y++)
      for (let x = 0; x < src.w; x++) {
        const s = seedOf[y * src.w + x];
        if (s < 0) continue;
        const i = (y * src.w + x) * 4;
        const m = path[s];
        const X = x + ox + m.dx;
        const Y0 = y + oy;
        // Лёг плашмя: осколок сплющивается к своему низу.
        const Y = Math.round(bottom[s] + (Y0 - bottom[s]) * (1 - 0.5 * m.flat)) + m.dy;
        p.set(X, Y, [
          src.data[i],
          src.data[i + 1],
          src.data[i + 2],
          Math.round(src.data[i + 3] * fade),
        ]);
        // Грань ловит свет: вспышка в миг раскола, потом мерцание на полу.
        if (tau < 0.1) lit.set(X, Y, alpha(CYAN_HOT, (1 - tau / 0.1) * 0.8 * fade));
        else if (m.landed >= 0 && (x * 7 + y * 3 + s + q.f) % 23 === 0)
          lit.set(X, Y, alpha(WHITE, 0.8 * fade));
      }
  }
  const key = `s|${q.tech}|${q.f}|${q.dir}|${q.q}|${q.tier}|${q.copy ? 1 : 0}|${q.cr}|${q.hk}|${q.look}`;
  return cropped(key, p, lit, [], { ...RIG0 }, c, 0, 0, 0);
}

// ---- Рисовальщик: режим мозга → техника и кадр -------------------------------

/** Что рисовальщик помнит об отражении между кадрами (только для рисунка). */
interface BMem {
  dir: Dir4;
  mode: string;
  prev: string;
  walk: number;
  now: number;
  phase: number;
  phaseT: number;
}
const bMem = new WeakMap<Mob, BMem>();

/** Сторона с запасом (как у героя): по диагонали не мигает бок/спина. */
function dirPick(face: number, prev: Dir4 | null): Dir4 {
  const c = Math.cos(face);
  const s = Math.sin(face);
  const side = Math.abs(c) > Math.abs(s);
  if (!prev) return side ? (c < 0 ? 'left' : 'right') : s < 0 ? 'up' : 'down';
  const prevSide = prev === 'left' || prev === 'right';
  const keep = side === prevSide || Math.abs(Math.abs(c) - Math.abs(s)) < 0.2;
  const useSide = keep ? prevSide : side;
  return useSide ? (c < 0 ? 'left' : 'right') : s < 0 ? 'up' : 'down';
}

function bMemOf(m: Mob, pose: MobPose): { s: BMem; fresh: boolean } {
  let s = bMem.get(m);
  const fresh = !s;
  if (!s) {
    s = {
      dir: dirPick(m.face, null),
      mode: pose.mode,
      prev: '',
      walk: 0,
      now: pose.now,
      phase: Math.max(0, F7_VIEW.bossPhase),
      phaseT: -9,
    };
    bMem.set(m, s);
  } else s.dir = dirPick(m.face, s.dir);
  if (pose.mode !== s.mode) {
    s.prev = s.mode;
    s.mode = pose.mode;
  }
  const dt = cl(pose.now - s.now, 0, 0.1);
  s.now = pose.now;
  s.walk += Math.hypot(m.vx, m.vy) * TS * dt;
  const ph = Math.max(0, F7_VIEW.bossPhase);
  if (ph > s.phase) s.phaseT = pose.now;
  s.phase = ph;
  return { s, fresh };
}

/** Темп фазы, как в мозге (`haste`). */
function bossHaste(copy: boolean): number {
  const p = F7_VIEW.bossPhase;
  const base = p >= 3 ? 1.22 : p >= 2 ? 1.12 : 1;
  return copy ? base * 0.82 : base;
}

/** Откуда пришёл отдых: память рисовальщика, запасной путь — `rec`, на листе — `vFrom`. */
function recFrom(m: Mob, s: BMem): number {
  const hint = m.data.vFrom;
  if (hint) return hint;
  switch (s.prev) {
    case 'combo':
      return 1;
    case 'heavy':
      return 2;
    case 'dash':
      return 3;
    case 'riposte':
      return 4;
    case 'gaze':
      return 5;
  }
  const r = m.data.rec;
  return r === 0.95 ? 1 : r === 1.15 ? 2 : r === 0.8 ? 4 : 0;
}

const STRIDE = 26;

registerMobPainter('f7_boss', (m: Mob, pose: MobPose) => {
  const copy = m.kind === 'f7boss_copy';
  const { s, fresh } = bMemOf(m, pose);
  const tier = heroGear().robe;
  const phase = Math.max(0, F7_VIEW.bossPhase);
  const hs = bossHaste(copy);
  const left = s.dir === 'left';
  const dir: BDir = left ? 'right' : (s.dir as BDir);
  let qi = ((Math.round(m.face / (TAU / 16)) % 16) + 16) % 16;
  if (left) qi = (8 - qi + 16) % 16;
  const hk = Math.round(hs * 100);
  const cw = copy ? 1.15 : 1;
  const t = pose.t;
  let tech = 'idle';
  let v = 0;
  let f = 0;
  let tf = 0;
  let rk = 80;
  const at = (ts: number, T: number) => {
    const n = Math.ceil(T * RFPS - 1e-6);
    f = Math.max(0, Math.min(n, Math.floor(ts * RFPS + 1e-6)));
    tf = Math.min(f / RFPS, T);
  };
  switch (pose.mode) {
    case 'combo': {
      const k = Math.min(3, m.data.k ?? 0);
      if (t < 0 && k >= 1) {
        tech = 'follow';
        v = Math.min(1, k - 1);
        at(t + 0.1 / hs, 0.1 / hs);
      } else {
        tech = 'swing';
        v = Math.min(2, k);
        at(t, (BOSS.combo[v] / hs) * cw);
      }
      break;
    }
    case 'heavy':
      tech = 'heavy';
      at(t, (BOSS.heavy / hs) * cw);
      break;
    case 'dashAim':
      tech = 'aim';
      at(t, (BOSS.dashAim / hs) * cw);
      break;
    case 'dash': {
      tech = 'dash';
      const n = Math.floor(Math.max(0, t) * RFPS + 1e-6);
      f = n < 2 ? n : 2 + ((n - 2) % 4);
      tf = f / RFPS;
      break;
    }
    case 'guard':
      tech = 'guard';
      at(t, BOSS.guard);
      break;
    case 'riposte':
      tech = 'riposte';
      at(t, BOSS.riposte);
      break;
    case 'gaze':
      tech = 'gaze';
      at(t, BOSS.gaze / hs);
      break;
    case 'mdive':
      tech = 'mdive';
      at(t, 0.45);
      break;
    case 'maim':
      tech = 'maim';
      at(t, BOSS.mirrorAim / hs);
      break;
    case 'mrun': {
      tech = 'mrun';
      const n = Math.floor(Math.max(0, t) * RFPS + 1e-6);
      f = n < 2 ? n : 2 + ((n - 2) % 8);
      tf = f / RFPS;
      break;
    }
    case 'daze': {
      tech = 'daze';
      const end = 2.1 / hs - 0.35;
      if (t < 0.3) {
        f = Math.floor(Math.max(0, t) * RFPS + 1e-6);
        tf = f / RFPS;
      } else if (t < end) {
        const n = Math.floor((t - 0.3) * 12) % 13;
        f = 8 + n;
        tf = 0.3 + n / 12;
      } else {
        const n = Math.min(8, Math.floor((t - end) * RFPS + 1e-6));
        f = 21 + n;
        tf = end + n / RFPS;
      }
      break;
    }
    case 'shift':
      tech = 'shift';
      at(t, 0.7);
      break;
    case 'intro':
    case 'roar':
      if (m.data.quick) {
        tech = 'introQ';
        at(t - 0.5, 0.7);
      } else {
        tech = 'intro0';
        at(t, 1.4);
      }
      break;
    case 'recover': {
      tech = 'rec';
      v = recFrom(m, s);
      rk = Math.round((m.data.rec ?? 0.8) * 100);
      at(t, rk / 100 / hs);
      break;
    }
    case 'dying':
      tech = copy ? 'dieC' : 'die';
      at(t, copy ? DIEC_T : DIE_T);
      break;
    default: {
      const sp = Math.hypot(m.vx, m.vy);
      if (sp > 0.4) {
        tech = 'run';
        v = sp > 2.5 ? 10 : sp > 1.2 ? 5 : 0;
        const d = fresh ? pose.now * sp * TS : s.walk;
        f = Math.floor(((d / STRIDE) % 1) * 8) % 8;
        tf = f / 8;
      } else {
        tech = 'idle';
        f = Math.floor(pose.now * 10 + m.id * 3.7) % 24;
        tf = f / 10;
      }
    }
  }
  // Смена фазы: свежая трещина прорастает, вспыхивает и гаснет.
  // На листе кадров смену фазы задаёт `vPcT` (время режима = время после смены).
  // Трещины и их вспышка — у копий те же, что у настоящего: иначе фаза копий
  // решалась бы с одного взгляда (настоящего выдаёт только тень от люстры).
  const pc = m.data.vPcT ? pose.t : pose.now - s.phaseT;
  const rv = pc < 0.3 ? Math.min(4, 1 + Math.floor(pc / 0.07)) : 4;
  const cg = pc >= 0 && pc < 0.9 ? (pc < 0.1 ? 4 : pc < 0.3 ? 3 : pc < 0.55 ? 2 : 1) : 0;
  const loose = tech === 'idle' || tech === 'run' || tech === 'daze' || tech === 'rec';
  const fl0 = m.flash ?? 0;
  const q: BReq = {
    tier,
    copy,
    cr: Math.min(3, phase),
    rv,
    cg,
    tech,
    v,
    f,
    t: tf,
    dir,
    q: qi,
    hk,
    rk,
    fl: loose && pose.mode !== 'dying' ? (fl0 > 0.07 ? 2 : fl0 > 0.01 ? 1 : 0) : 0,
    look: pose.look,
  };
  // Белая вспышка удара героя; у трупа — только в первый миг.
  const flash = pose.flash && (pose.mode !== 'dying' || t < 0.1);
  const fr = bossFrame(q, left, flash);
  if (!fr) return null;
  const out: MobFrame = { ...fr, dx: fr.bx, dy: fr.by };
  // Шлейф: выпад и пробежка — как рывок героя; тяжёлый — на взрыве.
  if (tech === 'dash' || tech === 'mrun')
    out.ghost = { every: 0.03, life: 0.22, tint: '#8fd8ff', alpha: 0.4 };
  else if (
    (tech === 'heavy' && tf > (BOSS.heavy / hs) * cw - 0.11) ||
    (tech === 'rec' && v === 2 && tf < 0.14) ||
    (tech === 'swing' && v === 2 && tf > 0.1)
  )
    out.ghost = { every: 0.035, life: 0.16, tint: '#c0d4ff', alpha: 0.28 };
  if (tech === 'die') out.linger = DIE_T;
  if (tech === 'dieC') out.linger = DIEC_T;
  // Смена фазы: тело вздрагивает, пока трещина прорастает.
  if (pc >= 0 && pc < 0.45)
    out.dx = (out.dx ?? 0) + Math.sin(pc * TAU * 16) * 0.9 * (1 - pc / 0.45);
  // Отдача от удара героя: от героя, с возвратом (в технике — слабее).
  if (fl0 > 0 && pose.mode !== 'dying') {
    const sim = paintSim();
    const age = cl(0.12 - fl0, 0, 0.12);
    let ux = pose.left ? 1 : -1;
    let uy = 0;
    if (sim) {
      const dx = m.x - sim.hero.x;
      const dy = m.y - sim.hero.y;
      const d = Math.hypot(dx, dy) || 1;
      ux = dx / d;
      uy = dy / d;
    }
    const k = Math.sin((age / 0.12) * Math.PI) * 2.2 * (loose ? 1 : 0.4);
    out.dx = (out.dx ?? 0) + ux * k;
    out.dy = (out.dy ?? 0) + uy * k * 0.6;
  }
  return out;
});

// Прогрев: первый бой — выход, покой, бег и все техники первой фазы; анфас
// (герой обычно снизу) целиком, бок в обе стороны — самое частое.
registerMobWarm('f7_boss', function* () {
  const tier = heroGear().robe;
  const base = {
    tier,
    copy: false,
    cr: 0,
    rv: 4,
    cg: 0,
    hk: 100,
    rk: 80,
    fl: 0,
    look: 'normal' as Look,
  };
  const span = (tech: string, v: number, rk: number): [number, number] => {
    const c: Record<string, number> = {
      intro0: 1.4,
      swing: BOSS.combo[Math.min(2, v)],
      follow: 0.1,
      heavy: BOSS.heavy,
      aim: BOSS.dashAim,
      guard: BOSS.guard,
      riposte: BOSS.riposte,
      rec: rk / 100,
    };
    const T = c[tech] ?? 0;
    return [Math.ceil(T * RFPS - 1e-6) + 1, T];
  };
  const list: [string, number, number][] = [
    ['intro0', 0, 80],
    ['idle', 0, 80],
    ['run', 10, 80],
    ['swing', 0, 80],
    ['follow', 0, 80],
    ['swing', 1, 80],
    ['follow', 1, 80],
    ['swing', 2, 80],
    ['rec', 1, 95],
    ['heavy', 0, 80],
    ['rec', 2, 115],
    ['aim', 0, 80],
    ['dash', 0, 80],
    ['rec', 3, 60],
    ['guard', 0, 80],
    ['riposte', 0, 80],
    ['rec', 4, 80],
  ];
  const sides: [BDir, number, boolean][] = [
    ['down', 4, false],
    ['right', 0, false],
    ['right', 0, true],
  ];
  for (const [dir, qq, left] of sides)
    for (const [tech, v, rk] of list) {
      // Бок — только самое частое (покой, бег, первый взмах): кеш на ~440
      // кадров, и прогрев не должен вытеснять сам себя.
      if (dir !== 'down' && !['idle', 'run', 'swing', 'follow'].includes(tech)) continue;
      if (dir !== 'down' && v > 0 && tech !== 'run') continue;
      let n: number;
      let T = 0;
      if (tech === 'idle') n = 24;
      else if (tech === 'run') n = 8;
      else if (tech === 'dash') n = 6;
      else [n, T] = span(tech, v, rk);
      for (let f = 0; f < n; f++) {
        const tf = tech === 'idle' ? f / 10 : tech === 'run' ? f / 8 : Math.min(f / RFPS, T || 99);
        bossFrame({ ...base, tech, v, f, t: tf, dir, q: qq, rk }, left, false);
        yield f;
      }
    }
});

// ---------------------------------------------------------------------------
// Стеклянный голем: лист из тайла DCSS (`golem.png`, кадры 40×40): покой ×2,
// шаг ×4, замах, удар, боль. Трещины — кодом, по числу принятых трещин.
// ---------------------------------------------------------------------------

const sheets = new Map<string, Px | null>();

/** Картинка этажа пикселями; пока не пришла — null (движок нарисует запасной вид). */
function sheet(name: string): Px | null {
  if (sheets.has(name)) return sheets.get(name) ?? null;
  sheets.set(name, null);
  if (typeof Image === 'undefined') return null;
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d');
    if (!g) return;
    g.drawImage(img, 0, 0);
    const p = new Px(img.width, img.height);
    p.data.set(g.getImageData(0, 0, img.width, img.height).data);
    sheets.set(name, p);
  };
  img.src = `${import.meta.env.BASE_URL}dungeon/f7/${name}.png`;
  return null;
}

function cut(src: Px, i: number, w: number, h: number): Px {
  const o = new Px(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const s = (y * src.w + i * w + x) * 4;
      const d = (y * w + x) * 4;
      for (let k = 0; k < 4; k++) o.data[d + k] = src.data[s + k];
    }
  return o;
}

const GOLEM_CRACK: [number, number][][][] = [
  [
    [
      [17, 17],
      [20, 21],
      [19, 25],
    ],
    [
      [26, 18],
      [29, 23],
    ],
  ],
  [
    [
      [12, 12],
      [15, 15],
      [13, 19],
    ],
    [
      [22, 30],
      [24, 35],
    ],
    [
      [8, 20],
      [10, 23],
    ],
  ],
];

function paintGolem(i: number, cracks: number, glow: number, sleep: boolean): Built | null {
  const sh = sheet('golem');
  if (!sh) return null;
  const p = cut(sh, i, 40, 40);
  for (let c = 0; c < Math.min(2, cracks); c++)
    crackLines(p, GOLEM_CRACK[c], hx('#0a0e1a'), hx('#e8faff'));
  // Сердцевина светится: у треснувшего — ярче (стекло тоньше).
  const core: [number, number] = [19, 18];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++)
      if (p.solid(core[0] + dx, core[1] + dy) && (dx === 0 || dy === 0))
        p.set(core[0] + dx, core[1] + dy, cracks >= 2 ? VIO[3] : cracks === 1 ? VIO[2] : VIO[1]);
  if (glow) {
    // Перед разрывом: стекло вспыхивает изнутри.
    for (let y = 0; y < p.h; y++)
      for (let x = 0; x < p.w; x++) {
        if (!p.solid(x, y)) continue;
        p.set(x, y, mixc(p.get(x, y), CYAN_HOT, 0.2 * glow));
      }
  }
  if (sleep) {
    // Стоит статуей: тусклее, без сердцевины.
    for (let y = 0; y < p.h; y++)
      for (let x = 0; x < p.w; x++)
        if (p.solid(x, y)) p.set(x, y, mixc(p.get(x, y), SILV[0], 0.35));
  }
  return { p, ax: 20, ay: 39, eye: sleep ? null : [19, 10] };
}

registerMobPainter('f7_golem', (m: Mob, pose: MobPose) => {
  const cracks = m.data.cracks ?? 0;
  const mode = pose.mode;
  let i = Math.floor(pose.frame / 3) % 2;
  let glow = 0;
  let a = 'idle';
  if (pose.anim === 'dead') {
    const k = Math.min(3, Math.floor(pose.t / 0.15));
    return frameOf('f7_golem', pose, `dead${cracks}`, k, () => {
      const b = paintGolem(0, cracks, 0, false);
      if (!b) return null;
      return { ...b, p: shatter(b.p, 20, 20, (k + 1) / 4, 3) };
    });
  }
  if (mode === 'slam') {
    i = pose.t < 0.8 ? 6 : 7;
    a = 'slam';
  } else if (mode === 'rupture') {
    i = 6;
    glow = 1 + Math.min(2, Math.floor(pose.t / 0.2));
    a = 'rup';
  } else if (pose.anim === 'run') {
    i = 2 + (Math.floor(pose.frame / 2) % 4);
    a = 'run';
  } else if (pose.anim === 'hurt') {
    i = 8;
    a = 'hurt';
  } else if (mode === 'recover' && pose.t < 0.25) {
    i = 7;
    a = 'after';
  }
  const sleep = pose.anim === 'sleep';
  return frameOf('f7_golem', pose, `${a}${cracks}${sleep ? 's' : ''}`, i * 10 + glow, () =>
    paintGolem(i, cracks, glow, sleep),
  );
});

// ---------------------------------------------------------------------------
// Призрачная копия: бледная фигура в капюшоне без ног, вместо лица —
// гладкое зеркало. Не видят — почти прозрачна, только мерцает кант.
// ---------------------------------------------------------------------------

const PH: Tones = [hx('#5a6c98'), hx('#98aed8'), hx('#cfe0f6'), hx('#f6fbff')];

function paintPhantom(anim: string, f: number, hidden: boolean): Built {
  const p = new Px(22, 26);
  const sway = Math.sin((f / 4) * TAU);
  const lean = anim === 'run' ? 2 : anim === 'bite' ? 3 : 0;
  // Хвост — лентами вниз, колышется.
  for (let i = 0; i < 3; i++) {
    const x0 = 9 + i * 2;
    const pts = spline(
      [
        [x0, 14],
        [x0 - lean * 0.5 + sway * (i - 1), 19],
        [x0 - lean + sway * 1.5 * (i === 1 ? -1 : 1), 24],
      ],
      5,
    );
    pts.forEach(([x, y], j) => {
      const w = 2.4 - j * 0.16;
      p.ell(x, y, Math.max(0.5, w), 0.8, alpha(PH[j < 5 ? 1 : 0], 0.85 - j * 0.06));
    });
  }
  // Тело-балахон.
  poly(
    p,
    [
      [6 + lean * 0.3, 8],
      [15 + lean * 0.3, 8],
      [16, 16],
      [5, 16],
    ],
    (x, y) => tone(PH, (x < 10 ? 0.6 : 0.3) - (y - 8) * 0.04),
  );
  // Руки: в замахе подняты, в ударе вперёд.
  const up = anim === 'wind';
  const fw = anim === 'bite';
  const lh: [number, number] = [up ? 3 : fw ? 2 : 4, up ? 3 : fw ? 11 : 14 + sway];
  const rh: [number, number] = [up ? 19 : fw ? 21 : 17, up ? 3 : fw ? 10 : 14 - sway];
  limb(p, 7, 10, lh[0], lh[1], 1.2, 0.8, PH, 0.1);
  limb(p, 15, 10, rh[0], rh[1], 1.2, 0.8, PH, -0.1);
  // Когти-льдинки.
  p.set(lh[0], lh[1] + 1, CYAN_HOT);
  p.set(rh[0], rh[1] + 1, CYAN_HOT);
  // Капюшон и лицо-зеркало.
  shadeEll(p, 10.5 + lean * 0.4, 5.5, 4.6, 4.8, PH, 0.1);
  const fx = 10.5 + lean * 0.5;
  p.ell(fx, 6.4, 2.6, 3, SILV[1]);
  p.ell(fx - 0.6, 5.8, 1.6, 2, SILV[2]);
  stroke(p, fx - 1.6, 4.6, fx + 0.4, 8.2, SILV[3]);
  if (up || fw) {
    p.set(Math.round(fx - 1), 6, VIO[3]);
    p.set(Math.round(fx + 1), 6, VIO[3]);
  }
  p.outline(alpha(hx('#2a3456'), 0.8));
  let out = fade(p, 0.82);
  if (hidden) {
    // Не видят: только мерцающий кант.
    out = new Px(p.w, p.h);
    for (let y = 0; y < p.h; y++)
      for (let x = 0; x < p.w; x++) {
        const i = (y * p.w + x) * 4;
        if (!p.data[i + 3]) continue;
        const edge = !p.solid(x - 1, y) || !p.solid(x + 1, y) || !p.solid(x, y - 1);
        if (edge && (x + y + f) % 3 === 0) out.set(x, y, alpha(PH[3], 0.35));
      }
  }
  return { p: out, ax: 11, ay: 25, eye: hidden ? null : [Math.round(fx), 6] };
}

registerMobPainter('f7_phantom', (m: Mob, pose: MobPose) => {
  const hidden = (m.data.ghost ?? 0) > 0 && pose.mode !== 'f7_step';
  let anim: string = pose.anim;
  if (anim === 'sleep') anim = 'idle';
  const f = anim === 'wind' || anim === 'bite' ? pose.frame % 2 : pose.frame % 4;
  if (pose.anim === 'dead') {
    const k = Math.min(3, Math.floor(pose.t / 0.15));
    return frameOf('f7_phantom', pose, 'dead', k, () => {
      const b = paintPhantom('idle', 0, false);
      return { ...b, p: slices(b.p, (k + 1) / 4, true) };
    });
  }
  return frameOf('f7_phantom', pose, `${anim}${hidden ? 'h' : ''}`, f, () =>
    paintPhantom(anim, f, hidden),
  );
});

// ---------------------------------------------------------------------------
// Тень из рамы: высокая сутулая фигура из фиолетового мрака, белые глаза,
// длинные руки до пола; на плечах — щепки позолоты от рамы.
// ---------------------------------------------------------------------------

const SHD: Tones = [hx('#0e0a1a'), hx('#261c44'), hx('#43346e'), hx('#6c5aa8')];

function paintShadow(anim: string, f: number, grab: boolean, step: number): Built {
  const p = new Px(28, 30);
  const sway = Math.sin((f / 4) * TAU) * (anim === 'run' ? 1.5 : 0.8);
  const hunch = anim === 'bite' ? 3 : anim === 'run' ? 2 : 0;
  // Ноги-подтёки: не ступни, а дым к полу.
  for (let i = 0; i < 4; i++) {
    const x = 10 + i * 2 + (i % 2 ? sway : -sway) * 0.5;
    stroke(p, x, 20, x + (i - 1.5) * 0.8, 28, alpha(SHD[1], 0.9), 2);
  }
  // Туловище.
  limb(p, 13, 20, 13 + hunch, 9, 3.6, 3, SHD, 0);
  // Голова — маленькая, вперёд.
  shadeEll(p, 13 + hunch * 1.2, 6.5, 3.2, 3, SHD, 0.15);
  // Руки: длинные, пальцы-когти.
  const upA = anim === 'wind';
  const reachF = anim === 'bite' ? 7 : 0;
  const la: [number, number] = upA ? [5, 2] : [6 - reachF * 0.2, 25 + sway];
  const ra: [number, number] = grab
    ? [26, 12]
    : upA
      ? [21, 2]
      : [19 + reachF, 24 - sway - reachF * 0.8];
  limb(p, 11, 11, la[0], la[1], 1.3, 0.8, SHD, 0.1);
  limb(p, 16, 11, ra[0], ra[1], 1.3, 0.8, SHD, 0.1);
  for (const [x, y] of [la, ra]) for (let c = -1; c <= 1; c++) p.set(x + c, y + 1, hx('#8c7ad8'));
  // Позолота рамы на плече.
  p.set(10, 9, GILT[2]);
  p.set(9, 10, GILT[1]);
  p.set(17, 9, GILT[1]);
  p.outline(alpha(INK, 0.9));
  // Глаза — белые, пустые.
  const ex = 12 + hunch * 1.2;
  p.set(Math.round(ex), 6, WHITE);
  p.set(Math.round(ex + 2), 6, WHITE);
  let q = p;
  if (step < 4) {
    // Выход из рамы: проявляется снизу вверх.
    q = new Px(p.w, p.h);
    const top = Math.round(p.h * (1 - (step + 1) / 4));
    for (let y = top; y < p.h; y++)
      for (let x = 0; x < p.w; x++) {
        const i = (y * p.w + x) * 4;
        if (p.data[i + 3]) q.set(x, y, [p.data[i], p.data[i + 1], p.data[i + 2], p.data[i + 3]]);
      }
  }
  return { p: q, ax: 13, ay: 29, eye: [Math.round(ex + 1), 6] };
}

registerMobPainter('f7_shadow', (m: Mob, pose: MobPose) => {
  let anim: string = pose.anim;
  const grab = pose.mode === 'grab';
  if (grab) anim = pose.t > 0.4 ? 'bite' : 'wind';
  const step = pose.mode === 'f7_step' ? Math.min(3, Math.floor((pose.t / 0.5) * 4)) : 4;
  const f = anim === 'run' || anim === 'idle' ? pose.frame % 4 : pose.frame % 2;
  if (pose.anim === 'dead' || pose.mode === 'f7_back') {
    const back = pose.mode === 'f7_back';
    const k = Math.min(3, Math.floor(pose.t / (back ? 0.3 : 0.15)));
    return frameOf('f7_shadow', pose, back ? 'back' : 'dead', k, () => {
      const b = paintShadow('idle', 0, false, 4);
      return { ...b, p: slices(b.p, (k + 1) / 4, true) };
    });
  }
  return frameOf('f7_shadow', pose, `${anim}${grab ? 'g' : ''}${step}`, f, () =>
    paintShadow(anim, f, grab, step),
  );
});

// ---------------------------------------------------------------------------
// Зеркальная бабочка: четыре крыла-зеркальца в тонкой оправе, фиолетовое
// тельце. Вспышка — крылья раскрыты и раскалены добела.
// ---------------------------------------------------------------------------

function mothWing(p: Px, pts: [number, number][], hot: number): void {
  const base: Tones = hot
    ? [hx('#a8c8ec'), hx('#dcecff'), hx('#f6fbff'), WHITE]
    : [hx('#3a4a6c'), hx('#6c86ae'), hx('#b0c8e4'), hx('#eef6ff')];
  // Стекло с отражением: свет сверху-слева по плоскости крыла.
  const cx = pts.reduce((a, q) => a + q[0], 0) / pts.length;
  const cy = pts.reduce((a, q) => a + q[1], 0) / pts.length;
  poly(p, pts, (x, y) => tone(base, 0.5 - (x - cx) * 0.08 - (y - cy) * 0.1));
  // Оправа — тонкий кант.
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    stroke(p, a[0], a[1], b[0], b[1], hot ? CYAN_HOT : SILV[1]);
  }
  // Блик по диагонали.
  stroke(p, cx - 1.5, cy - 1, cx + 0.5, cy + 1, base[3]);
}

function paintMoth(f: number, hot: number): Built {
  const p = new Px(22, 16);
  // Взмах: раскрыто, полураскрыто, сложено, полураскрыто.
  const open = hot ? 1 : [1, 0.55, 0.15, 0.55][f % 4];
  const cx = 11;
  const cy = 8;
  const wy = (1 - open) * 3;
  for (const s of [-1, 1]) {
    const W1 = 2 + 7 * open;
    mothWing(
      p,
      [
        [cx + s * 1, cy - 1],
        [cx + s * W1, cy - 6 + wy],
        [cx + s * (W1 + 1), cy - 1],
        [cx + s * 1.5, cy + 0.5],
      ],
      hot,
    );
    mothWing(
      p,
      [
        [cx + s * 1, cy + 1],
        [cx + s * (1 + 5 * open), cy + 1],
        [cx + s * (1 + 4 * open), cy + 5 - wy * 0.5],
        [cx + s * 1, cy + 3],
      ],
      hot,
    );
  }
  // Тельце и усики.
  limb(p, cx, cy - 2, cx, cy + 4, 1.1, 0.7, VIO, 0.2);
  stroke(p, cx - 0.5, cy - 3, cx - 2.5, cy - 6, VIO[2]);
  stroke(p, cx + 0.5, cy - 3, cx + 2.5, cy - 6, VIO[2]);
  p.set(cx - 3, cy - 7, hx('#fff4b8'));
  p.set(cx + 3, cy - 7, hx('#fff4b8'));
  p.outline(alpha(INK, 0.85));
  return { p, ax: 11, ay: 15, eye: [cx, cy - 2] };
}

registerMobPainter('f7_moth', (m: Mob, pose: MobPose) => {
  const hot = pose.mode === 'flash' ? Math.min(2, Math.floor(pose.t / 0.35)) : 0;
  const f = pose.mode === 'flash' ? 0 : Math.floor(pose.frame * 1.5) % 4;
  if (pose.anim === 'dead') {
    const k = Math.min(3, Math.floor(pose.t / 0.15));
    return frameOf('f7_moth', pose, 'dead', k, () => {
      const b = paintMoth(0, 0);
      return { ...b, p: shatter(b.p, 11, 8, (k + 1) / 4, 5) };
    });
  }
  return frameOf('f7_moth', pose, `fly${hot}`, f, () => paintMoth(f, hot ? 1 : 0));
});

// ---------------------------------------------------------------------------
// Осколочный паук: стеклянное брюшко с розовым сердцем, ноги-дуги, на спине
// шипы-осколки. В прыжке — поджат и поднят над своей тенью.
// ---------------------------------------------------------------------------

const SPG: Tones = [hx('#2c4a60'), hx('#5a8aa6'), hx('#9cd0e4'), hx('#e6faff')];
const PINK = hx('#ff6a98');

function paintSpider(anim: string, f: number, lift: number): Built {
  const H0 = 28;
  const p = new Px(26, H0);
  const gy = H0 - 4 - lift;
  const cx = 12;
  // Вид сбоку в три четверти: голова слева, брюшко справа. Ноги — ломаные
  // с коленом ВЫШЕ спины, стопы далеко по земле; дальние — темнее и позади
  // тела. Первый заход раскинул ноги дугами в стороны, и паук читался
  // летучей мышью.
  const tuck = anim === 'leap' ? 0.55 : anim === 'aim' ? 1.15 : 1;
  const legs = (far: boolean) => {
    for (let i = 0; i < 4; i++) {
      // Походка «четвёрками»: 0 и 2 ближние идут с 1 и 3 дальними.
      const grp = (i + (far ? 1 : 0)) % 2;
      const ph = anim === 'run' ? (f + grp * 2) % 4 : 0;
      const swing = anim === 'run' ? [1.5, 0.5, -1.5, -0.5][ph] : 0;
      const up = anim === 'run' && (ph === 0 || ph === 1) ? 1 : 0;
      const hx0 = cx - 2 + i * 1.3 + (far ? 1 : 0);
      const hy0 = gy - 5 - (far ? 1 : 0);
      const fx = cx + (-9.5 + i * 6.2) * tuck + swing + (far ? 1.5 : 0);
      const fy = gy - (far ? 2 : 0) - up - (anim === 'leap' ? 2 : 0);
      const kx = hx0 + (fx - hx0) * 0.42 + (i < 2 ? -1 : 1);
      const ky = gy - 10.5 - (far ? 1 : 0) + (anim === 'aim' ? -1 : 0) + (anim === 'leap' ? 2 : 0);
      const upper = far ? SPG[0] : SPG[2];
      const lower = far ? SPG[0] : SPG[1];
      stroke(p, hx0, hy0, kx, ky, upper);
      stroke(p, kx, ky, fx, fy, lower);
      // Коготок — светлая точка стопы (ближние).
      if (!far) p.set(Math.round(fx), Math.round(fy), SPG[3]);
      else p.set(Math.round(kx), Math.round(ky), SPG[1]);
    }
  };
  legs(true);
  // Брюшко — стекло, внутри розовое сердце.
  shadeEll(p, cx + 4, gy - 6, 4.6, 3.6, SPG, 0.05);
  p.ell(cx + 4.4, gy - 5.6, 1.6, 1.2, PINK);
  p.set(cx + 3, gy - 8, SPG[3]);
  // Шипы-осколки на спине.
  poly(
    p,
    [
      [cx + 2, gy - 8],
      [cx + 3, gy - 13],
      [cx + 4, gy - 8],
    ],
    (x) => (x < cx + 3 ? SPG[3] : SPG[2]),
  );
  poly(
    p,
    [
      [cx + 5, gy - 8],
      [cx + 7.5, gy - 12],
      [cx + 7, gy - 6],
    ],
    SPG[2],
  );
  // Головогрудь и глаза гроздью.
  shadeEll(p, cx - 1.5, gy - 5.5, 2.9, 2.5, [
    hx('#1c2c3c'),
    hx('#34506a'),
    hx('#5a86a6'),
    hx('#a8d4ec'),
  ]);
  p.set(cx - 3.5, gy - 7, PINK);
  p.set(cx - 2.5, gy - 7, PINK);
  p.set(cx - 3.5, gy - 6, hx('#ffb8d0'));
  p.set(cx - 2, gy - 8, hx('#ff9ab8'));
  // Хелицеры.
  p.set(cx - 4, gy - 4, anim === 'bite' ? WHITE : SPG[2]);
  p.set(cx - 4, gy - 3, anim === 'bite' ? WHITE : SPG[1]);
  legs(false);
  p.outline(alpha(INK, 0.9));
  return { p, ax: 12, ay: H0 - 3, eye: [cx - 3, gy - 7] };
}

registerMobPainter('f7_spider', (m: Mob, pose: MobPose) => {
  let anim: string = pose.anim === 'run' ? 'run' : pose.anim === 'bite' ? 'bite' : 'idle';
  let lift = 0;
  if (pose.mode === 'aim') anim = 'aim';
  if (pose.mode === 'leap') {
    anim = 'leap';
    const k = Math.min(1, pose.t / 0.36);
    lift = Math.round(Math.sin(k * Math.PI) * 9);
  }
  const f = anim === 'run' ? pose.frame % 4 : pose.frame % 2;
  if (pose.anim === 'dead') {
    const k = Math.min(3, Math.floor(pose.t / 0.15));
    return frameOf('f7_spider', pose, 'dead', k, () => {
      const b = paintSpider('idle', 0, 0);
      return { ...b, p: shatter(b.p, 12, 18, (k + 1) / 4, 9) };
    });
  }
  return frameOf('f7_spider', pose, `${anim}${lift}`, f, () => paintSpider(anim, f, lift));
});

// ---------------------------------------------------------------------------
// Призма: парящая трёхгранная призма; вращается (кадры — поворот модели),
// внутри радуга. В прицеле сердцевина раскаляется.
// ---------------------------------------------------------------------------

const RAINBOW = ['#ff5a7a', '#ffb050', '#fff080', '#80f0a0', '#70c8ff', '#b890ff'].map((c) =>
  hx(c),
);

function paintPrism(f: number, hot: number, rise: number): Built {
  const p = new Px(20, 26);
  const cx = 10;
  const top = 3;
  const bot = 20;
  const a0 = (f / 6) * (TAU / 3);
  // Три ребра на окружности: видимые грани — между соседними рёбрами.
  const R = 6;
  const edges = [0, 1, 2].map((i) => {
    const a = a0 + (i / 3) * TAU;
    return { x: cx + Math.cos(a) * R, z: Math.sin(a) };
  });
  const faces = [0, 1, 2]
    .map((i) => {
      const e0 = edges[i];
      const e1 = edges[(i + 1) % 3];
      return { e0, e1, zm: (e0.z + e1.z) / 2 };
    })
    .sort((a, b) => a.zm - b.zm);
  const t: Tones = [hx('#3c2a70'), hx('#6a58b4'), hx('#a8a0ec'), hx('#eee8ff')];
  for (const fc of faces) {
    if (fc.zm < -0.3) continue;
    const l = 0.35 + fc.zm * 0.3 + (fc.e0.x < fc.e1.x ? 0.1 : -0.1) + hot * 0.15;
    poly(
      p,
      [
        [fc.e0.x, top + 3 - fc.e0.z],
        [fc.e1.x, top + 3 - fc.e1.z],
        [fc.e1.x, bot - 3 - fc.e1.z],
        [fc.e0.x, bot - 3 - fc.e0.z],
      ],
      () => tone(t, l),
    );
  }
  // Верх и низ — острия.
  poly(
    p,
    [
      [cx - 5, top + 3],
      [cx, top - 2],
      [cx + 5, top + 3],
    ],
    VIO[2],
  );
  poly(
    p,
    [
      [cx - 5, bot - 3],
      [cx, bot + 3],
      [cx + 5, bot - 3],
    ],
    VIO[0],
  );
  // Радуга внутри: полоска, сдвигается с поворотом.
  for (let y = top + 4; y < bot - 3; y++) {
    const c = RAINBOW[(y + f) % RAINBOW.length];
    p.set(cx + Math.round(Math.sin(a0 * 3) * 1.5), y, alpha(c, 0.8));
  }
  if (hot)
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + f;
      p.set(
        Math.round(cx + Math.cos(a) * 8),
        Math.round(12 + Math.sin(a) * 9),
        alpha(RAINBOW[i], 0.8),
      );
    }
  p.set(cx - 2, top + 5, WHITE);
  p.outline(alpha(INK, 0.85));
  let q = p;
  if (rise < 4) {
    // Поднимается из подставки: сперва видна верхушка.
    q = new Px(p.w, p.h);
    const topCut = Math.round(p.h * (1 - (rise + 1) / 4));
    for (let y = 0; y < p.h - topCut; y++)
      for (let x = 0; x < p.w; x++) {
        const i = (y * p.w + x) * 4;
        if (p.data[i + 3])
          q.set(x, y + topCut, [p.data[i], p.data[i + 1], p.data[i + 2], p.data[i + 3]]);
      }
  }
  return { p: q, ax: 10, ay: 25, eye: [cx, 12] };
}

registerMobPainter('f7_prism', (m: Mob, pose: MobPose) => {
  const f = Math.floor(pose.t * 5 + m.id) % 6;
  const hot = pose.mode === 'aim' ? 1 : 0;
  const rise = pose.mode === 'f7_rise' ? Math.min(3, Math.floor(pose.t / 0.25)) : 4;
  if (pose.anim === 'dead') {
    const k = Math.min(3, Math.floor(pose.t / 0.15));
    return frameOf(
      'f7_prism',
      pose,
      'dead',
      k,
      () => {
        const b = paintPrism(0, 1, 4);
        return { ...b, p: shatter(b.p, 10, 12, (k + 1) / 4, 13) };
      },
      false,
    );
  }
  return frameOf('f7_prism', pose, `p${hot}${rise}`, f, () => paintPrism(f, hot, rise), false);
});

// ---------------------------------------------------------------------------
// Стекольщик-воришка: бесёнок в фартуке и зеркальных очках, за спиной мешок
// с монетами. Ныряет в зеркало — пропадает.
// ---------------------------------------------------------------------------

const LEATHER: Tones = [hx('#3a2a1e'), hx('#5a4430'), hx('#7a6044'), hx('#9a7c5a')];
const SACK: Tones = [hx('#4a3418'), hx('#86683a'), hx('#b89a5c'), hx('#e0c890')];

function paintThief(anim: string, f: number): Built {
  const p = new Px(22, 22);
  const hop = anim === 'run' ? [0, -1, -2, -1][f % 4] : 0;
  const cx = 10;
  const gy = 20;
  const st = anim === 'run' ? [1, 0, -1, 0][f % 4] : 0;
  // Ноги.
  limb(p, cx - 1, gy - 5 + hop, cx - 2 - st, gy, 0.8, 0.7, LEATHER);
  limb(p, cx + 2, gy - 5 + hop, cx + 3 + st, gy, 0.8, 0.7, LEATHER);
  // Мешок за спиной.
  shadeEll(p, cx - 4, gy - 9 + hop, 4, 4.4, SACK);
  p.set(cx - 5, gy - 12 + hop, GOLD);
  p.set(cx - 3, gy - 7 + hop, hx('#fff0a0'));
  stroke(p, cx - 4, gy - 13 + hop, cx - 3, gy - 14 + hop, hx('#5a3a1a'));
  // Тело в фартуке.
  shadeEll(p, cx + 1, gy - 8 + hop, 3.2, 3.6, GL, 0.1);
  poly(
    p,
    [
      [cx - 1, gy - 9 + hop],
      [cx + 4, gy - 9 + hop],
      [cx + 4, gy - 4 + hop],
      [cx - 1, gy - 4 + hop],
    ],
    hx('#6a4a2c'),
  );
  stroke(p, cx - 1, gy - 9 + hop, cx + 4, gy - 9 + hop, hx('#8a6a42'));
  // Голова, уши, очки-зеркальца.
  shadeEll(p, cx + 2, gy - 14 + hop, 3.6, 3.2, GL, 0.15);
  poly(
    p,
    [
      [cx - 1, gy - 16 + hop],
      [cx - 3, gy - 19 + hop],
      [cx, gy - 17 + hop],
    ],
    GL[1],
  );
  poly(
    p,
    [
      [cx + 5, gy - 16 + hop],
      [cx + 7, gy - 19 + hop],
      [cx + 4, gy - 17 + hop],
    ],
    GL[1],
  );
  p.ell(cx + 1, gy - 14 + hop, 1.2, 1.2, SILV[2]);
  p.ell(cx + 4, gy - 14 + hop, 1.2, 1.2, SILV[2]);
  p.set(cx + 1, gy - 15 + hop, WHITE);
  p.set(cx + 4, gy - 15 + hop, WHITE);
  stroke(p, cx + 2, gy - 12 + hop, cx + 3, gy - 12 + hop, INK);
  p.outline(alpha(INK, 0.9));
  return { p, ax: 10, ay: 21, eye: [cx + 3, gy - 14 + hop] };
}

registerMobPainter('f7_thief', (m: Mob, pose: MobPose) => {
  if (pose.mode === 'f7_dive') {
    // Ныряет в зеркало: распадается полосами, как отражение, уходящее в стекло.
    const k = Math.min(3, Math.floor(pose.t / 0.1));
    return frameOf('f7_thief', pose, 'dive', k, () => {
      if (k >= 3) return { p: new Px(2, 2), ax: 1, ay: 1, eye: null };
      const b = paintThief('run', 1);
      return { ...b, p: slices(b.p, (k + 1) / 4, true), eye: null };
    });
  }
  const anim = pose.anim === 'run' ? 'run' : 'idle';
  const f = anim === 'run' ? pose.frame % 4 : 0;
  if (pose.anim === 'dead') {
    const k = Math.min(3, Math.floor(pose.t / 0.15));
    return frameOf('f7_thief', pose, 'dead', k, () => {
      const b = paintThief('idle', 0);
      return { ...b, p: shatter(b.p, 10, 12, (k + 1) / 4, 17) };
    });
  }
  return frameOf('f7_thief', pose, anim, f, () => paintThief(anim, f));
});

// ---------------------------------------------------------------------------
// Реквизит. Живые (кадрами): блик по зеркалу, колонна со светом внутри,
// канделябр, друза, кокон, призма на подставке, куча осколков, люстра, рама,
// зеркала-переходы. Остальное — статично.
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
const EMPTY_SPRITE = (): Sprite => ({ img: new Px(1, 1).canvas(), ax: 0, ay: 1 });

const COLD_FIRE = [hx('#2a58c0'), hx('#5aa0ff'), hx('#a8e0ff'), hx('#f0fcff')];

/** Холодный язычок пламени высотой h (кадр f) с основанием в (x, y). */
function coldFlame(p: Px, x: number, y: number, h: number, f: number): void {
  const sway = [0, 1, 0, -1][f % 4];
  for (let i = 0; i < h; i++) {
    const k = i / h;
    const w = (1 - k) * 1.6 + 0.3;
    const cx = x + sway * k;
    for (let dx = -Math.ceil(w); dx <= Math.ceil(w); dx++) {
      if (Math.abs(dx) > w) continue;
      const core = Math.abs(dx) / w;
      const c =
        k > 0.75
          ? COLD_FIRE[1]
          : core < 0.4 && k < 0.6
            ? COLD_FIRE[3]
            : core < 0.75
              ? COLD_FIRE[2]
              : COLD_FIRE[1];
      p.set(Math.round(cx + dx), y - i, c);
    }
  }
}

// Блик на зеркале: раз в несколько секунд по стеклу проходит свет.
registerPropPainter('f7_glint', (o, time) => {
  const ph = (time * 0.22 + hash(o.x, o.y, 4)) % 1;
  if (ph > 0.3) return spriteOf('glint|off', EMPTY_SPRITE);
  const k = Math.min(7, Math.floor((ph / 0.3) * 8));
  return spriteOf(`glint|${k}`, () => {
    const p = new Px(16, 16);
    // Полоса света наискось, внутри стекла (2…13).
    for (let y = 2; y <= 13; y++)
      for (let x = 2; x <= 13; x++) {
        const d = x + y - (k * 3 + 2);
        if (d === 0) p.set(x, y, alpha(WHITE, 0.75));
        else if (d === 1 || d === -2) p.set(x, y, alpha(CYAN_HOT, 0.35));
      }
    return { img: p.canvas(), ax: 8, ay: 16 };
  });
});

// Портьера: бархат с фалдами поверх зеркала, золотая кисть.
registerPropPainter('f7_drape', (o) => {
  const v = Math.floor(hash(o.x, o.y, 2) * 2);
  return spriteOf(`drape|${v}`, () => {
    const p = new Px(16, 16);
    const vel: Tones = [hx('#2a0e22'), hx('#4a1a3a'), hx('#6e2a56'), hx('#9a4a7a')];
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        // Складки: синус по x; к низу собраны к краю (подвязана).
        const side = v ? x : 15 - x;
        const tie = y > 9 ? (y - 9) * 1.4 : 0;
        if (side < tie) continue;
        const fold = Math.sin((x + y * 0.15) * 1.3);
        p.set(x, y, tone(vel, 0.4 + fold * 0.45 - y * 0.02));
      }
    stroke(p, 0, 0, 15, 0, GILT[2]);
    stroke(p, 0, 1, 15, 1, GILT[1]);
    const tx = v ? 13 : 2;
    p.set(tx, 10, GILT[3]);
    p.set(tx, 11, GILT[2]);
    p.set(tx, 12, GILT[1]);
    return { img: p.canvas(), ax: 8, ay: 16 };
  });
});

// Стеклянная колонна: цоколь, прозрачный ствол, свет поднимается внутри.
registerPropPainter('f7_pillar', (o, time) => {
  const f = Math.floor(time * 6 + hash(o.x, o.y) * 6) % 6;
  return spriteOf(`pillar|${f}`, () => {
    const p = new Px(16, 34);
    const stone: Tones = [hx('#2c2e3c'), hx('#4c5064'), hx('#747a92'), hx('#a8aec4')];
    // Цоколь и капитель.
    for (const [y0, y1] of [
      [28, 33],
      [0, 4],
    ])
      for (let y = y0; y <= y1; y++)
        for (let x = 2; x <= 13; x++)
          p.set(x, y, tone(stone, 0.55 - (x - 2) * 0.05 - (y === y0 ? -0.3 : 0)));
    // Ствол: стекло, края светлее, середина глубже.
    for (let y = 5; y <= 27; y++)
      for (let x = 4; x <= 11; x++) {
        const e = Math.min(x - 4, 11 - x);
        const c = e === 0 ? GL[2] : e === 1 ? GL[1] : mixc(GL[0], GL[1], 0.4);
        p.set(x, y, alpha(c, e === 0 ? 1 : 0.85));
      }
    // Грани и блик слева.
    stroke(p, 5, 5, 5, 27, alpha(GL[3], 0.8));
    stroke(p, 8, 5, 8, 27, alpha(GL[2], 0.4));
    // Свет внутри поднимается.
    const ly = 27 - f * 4;
    p.ell(7.5, ly, 2.2, 2.6, alpha(CYAN_HOT, 0.55));
    p.ell(7.5, ly, 1, 1.4, alpha(WHITE, 0.8));
    p.outline(INK);
    return { img: p.canvas(), ax: 8, ay: 34 };
  });
});

// Канделябр: бронзовая стойка, три свечи с холодным огнём.
registerPropPainter('f7_candle', (o, time) => {
  const f = Math.floor(time * 7 + hash(o.x, o.y) * 4) % 4;
  return spriteOf(`candle|${f}`, () => {
    const p = new Px(14, 28);
    limb(p, 7, 26, 7, 12, 1, 1, GILT);
    p.ell(7, 26, 3.5, 1.3, GILT[1]);
    stroke(p, 2, 13, 12, 13, GILT[2]);
    stroke(p, 2, 13, 2, 11, GILT[1]);
    stroke(p, 12, 13, 12, 11, GILT[1]);
    for (const x of [2, 7, 12]) {
      const top = x === 7 ? 7 : 9;
      for (let y = top; y <= (x === 7 ? 11 : 11); y++) p.set(x, y, hx('#e8e4f0'));
      p.set(x - 1, top + 1, hx('#b8b4c8'));
    }
    p.outline(INK);
    coldFlame(p, 2, 8, 4, f);
    coldFlame(p, 7, 6, 5, f + 1);
    coldFlame(p, 12, 8, 4, f + 2);
    return { img: p.canvas(), ax: 7, ay: 28 };
  });
});

// Бюст на постаменте: лицо — гладкое зеркало.
registerPropPainter('f7_bust', (o) => {
  const v = Math.floor(hash(o.x, o.y, 6) * 2);
  return spriteOf(`bust|${v}`, () => {
    const p = new Px(14, 24);
    const marble: Tones = [hx('#5a5e70'), hx('#8e94a8'), hx('#c4cad8'), hx('#eef0f6')];
    // Постамент.
    for (let y = 14; y <= 23; y++)
      for (let x = 3; x <= 10; x++) p.set(x, y, tone(marble, 0.6 - (x - 3) * 0.08));
    stroke(p, 2, 14, 11, 14, marble[2]);
    stroke(p, 2, 23, 11, 23, marble[0]);
    // Плечи и голова.
    shadeEll(p, 7, 12, 5, 2.6, marble);
    shadeEll(p, 7, 6.5, 3.2, 4, marble, 0.1);
    // Лицо-зеркало (у одного — треснувшее).
    p.ell(7.3, 7, 2, 2.6, SILV[1]);
    stroke(p, 6, 5.5, 8, 8.5, SILV[3]);
    if (v) stroke(p, 8, 5, 6, 9, INK);
    p.outline(INK);
    return { img: p.canvas(), ax: 7, ay: 24 };
  });
});

// Стеклянная ваза с сухим цветком.
registerPropPainter('f7_vase', (o, _t, _a, flash) => {
  const v = Math.floor(hash(o.x, o.y, 8) * 2);
  return spriteOf(`vase|${v}|${flash ? 1 : 0}`, () => {
    const p = new Px(12, 18);
    shadeEll(p, 6, 13, 4, 4, GL, 0.1);
    limb(p, 6, 9, 6, 5, 1.4, 1.2, GL);
    p.ell(6, 4.5, 2.2, 0.8, GL[2]);
    stroke(p, 6, 4, v ? 8 : 4, 0, hx('#6a5a44'));
    p.set(v ? 8 : 4, 0, hx(v ? '#c89ab8' : '#b8a8d8'));
    p.set(4, 12, GL[3]);
    p.outline(INK);
    const img = flash ? p.tint(WHITE, 0.8).canvas() : p.canvas();
    return { img, ax: 6, ay: 18 };
  });
});

// Друза хрусталя: шестигранные кристаллы, по ним бегает искра.
registerPropPainter('f7_crystal', (o, time) => {
  const v = Math.floor(hash(o.x, o.y, 1) * 3);
  const f = Math.floor(time * 3 + hash(o.x, o.y) * 4) % 4;
  return spriteOf(`crystal|${v}|${f}`, () => {
    const p = new Px(18, 22);
    const tint =
      v === 2 ? VIO : ([hx('#1e4c5c'), hx('#3c8ca0'), hx('#7ad0de'), hx('#d8faff')] as Tones);
    const shards: [number, number, number, number, number][] = [
      [9, 21, 9, 3, 2.6],
      [5, 21, 3, 9, 2],
      [13, 21, 15, 8, 2.1],
      [7, 21, 6, 13, 1.5],
      [11, 21, 12, 14, 1.4],
    ];
    for (const [x0, y0, x1, y1, r] of shards) {
      const dx = x1 - x0;
      const dy = y1 - y0;
      const L = Math.hypot(dx, dy);
      const nx = -dy / L;
      const ny = dx / L;
      poly(
        p,
        [
          [x0 + nx * r, y0 + ny * r],
          [x1 + nx * r * 0.7, y1 + ny * r * 0.7],
          [x1 + (dx / L) * r, y1 + (dy / L) * r],
          [x1 - nx * r * 0.7, y1 - ny * r * 0.7],
          [x0 - nx * r, y0 - ny * r],
        ],
        (x) => (x < x0 + (x1 - x0) * 0.5 - 0.3 ? tint[2] : tint[1]),
      );
      stroke(p, x0 - nx * 0.3, y0, x1, y1, alpha(tint[3], 0.7));
    }
    p.outline(INK);
    const sp: [number, number] = [
      [9, 5],
      [4, 11],
      [14, 10],
      [11, 15],
    ][f] as [number, number];
    p.set(sp[0], sp[1], WHITE);
    p.set(sp[0] - 1, sp[1], alpha(WHITE, 0.5));
    p.set(sp[0] + 1, sp[1], alpha(WHITE, 0.5));
    p.set(sp[0], sp[1] - 1, alpha(WHITE, 0.5));
    return { img: p.canvas(), ax: 9, ay: 22 };
  });
});

// Ящик зеркальных стёкол: доски, из щелей блестят листы.
registerPropPainter('f7_crate', (o, _t, _a, flash) => {
  const v = Math.floor(hash(o.x, o.y, 3) * 2);
  return spriteOf(`crate|${v}|${flash ? 1 : 0}`, () => {
    const p = new Px(16, 16);
    const wood: Tones = [hx('#3a2418'), hx('#5e3c26'), hx('#86583a'), hx('#b07e54')];
    for (let y = 3; y <= 15; y++)
      for (let x = 1; x <= 14; x++)
        p.set(x, y, tone(wood, (y - 3) % 4 === 0 ? 0.1 : 0.5 - (x - 1) * 0.02));
    // Листы стекла торчат сверху.
    for (let i = 0; i < 4; i++) {
      const x = 3 + i * 3;
      const h = 3 + ((i + v) % 3);
      for (let y = 3 - h; y < 4; y++) p.set(x, y, i % 2 ? SILV[2] : GL[2]);
      p.set(x, 3 - h, WHITE);
    }
    stroke(p, 1, 3, 14, 15, wood[0]);
    p.outline(INK);
    const img = flash ? p.tint(WHITE, 0.8).canvas() : p.canvas();
    return { img, ax: 8, ay: 16 };
  });
});

// Туалетный столик с овальным зеркалом.
registerPropPainter('f7_vanity', () =>
  spriteOf('vanity', () => {
    const p = new Px(20, 26);
    const wood: Tones = [hx('#2a1a22'), hx('#4a2c3a'), hx('#6c4458'), hx('#946478')];
    // Зеркало на подставке.
    p.ell(10, 7, 6, 6.5, GILT[1]);
    p.ell(10, 7, 5, 5.5, SILV[1]);
    p.ell(9, 6, 3.5, 4, SILV[2]);
    stroke(p, 7, 4, 11, 10, SILV[3]);
    stroke(p, 10, 13, 10, 15, GILT[0]);
    // Стол с ящиками.
    for (let y = 15; y <= 25; y++)
      for (let x = 2; x <= 17; x++) p.set(x, y, tone(wood, 0.5 - (y - 15) * 0.03));
    stroke(p, 2, 15, 17, 15, wood[3]);
    stroke(p, 3, 19, 16, 19, wood[0]);
    p.set(9, 17, GILT[2]);
    p.set(9, 21, GILT[2]);
    // Пудреница и флакон.
    p.ell(5, 14, 1.6, 0.9, hx('#d8b8c8'));
    limb(p, 15, 14, 15, 12, 0.8, 0.6, VIO);
    p.outline(INK);
    return { img: p.canvas(), ax: 10, ay: 26 };
  }),
);

// Кокон бабочек на стеклянном стебле: светится изнутри; вскрытый — пуст.
registerPropPainter('f7_cocoon', (o, time) => {
  const at = F7_VIEW.cocoons.get(o.id) ?? -999;
  const torn = F7_VIEW.time - at < 60;
  const f = Math.floor(time * 2.5 + hash(o.x, o.y) * 4) % 4;
  return spriteOf(`cocoon|${torn ? 't' : f}`, () => {
    // Кокон висит на стеклянной ветке-дуге: шёлк с зеркальными чешуйками,
    // внутри теплится бабочка. Прошлый — «леденец на палочке».
    const p = new Px(18, 26);
    const rod: Tones = [hx('#28395a'), hx('#4a78a2'), hx('#88badc'), hx('#e2f6ff')];
    // Ветка: из пола вверх и дугой вбок, кокон висит с кончика.
    const arc = spline([
      [4, 25],
      [3, 17],
      [4, 8],
      [8, 3],
      [11, 3],
    ]);
    for (const [x, y] of arc) {
      p.set(Math.round(x), Math.round(y), rod[1]);
      p.set(Math.round(x) - 1, Math.round(y), rod[2]);
    }
    stroke(p, 11, 3, 11, 6, alpha(rod[3], 0.8));
    const silk: Tones = [hx('#5a5478'), hx('#9a94b8'), hx('#d4d0ea'), hx('#f6f4ff')];
    if (torn) {
      shadeEll(p, 11, 12, 3.4, 5.5, silk);
      p.ell(11.5, 11, 1.8, 3, INK);
      p.set(9, 6, silk[2]);
      p.set(13, 7, silk[2]);
      p.set(10, 18, alpha(silk[1], 0.8));
    } else {
      shadeEll(p, 11, 12, 3.8, 6.2, silk);
      // Нити шёлка — косыми витками.
      for (let y = 8; y < 17; y += 2) stroke(p, 8, y, 14, y + 1, alpha(silk[0], 0.6));
      // Зеркальные чешуйки поблёскивают по очереди.
      const sc: [number, number][] = [
        [9, 9],
        [13, 11],
        [10, 14],
        [12, 16],
      ];
      sc.forEach(([x, y], k) => p.set(x, y, k === f ? CYAN_HOT : alpha(GL[2], 0.8)));
      const g = [0.35, 0.6, 0.85, 0.6][f];
      p.ell(11, 13, 1.6, 2.6, alpha(VIO[3], g));
    }
    p.outline(INK);
    return { img: p.canvas(), ax: 4, ay: 26 };
  });
});

// Узел стеклянной нити у пола (сама нить — зона `f7_thread`).
registerPropPainter('f7_web', (o, time) => {
  const f = Math.floor(time * 3 + hash(o.x, o.y) * 3) % 3;
  return spriteOf(`web|${f}`, () => {
    const p = new Px(16, 10);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI + 0.2;
      stroke(p, 8, 8, 8 + Math.cos(a) * 7, 8 - Math.sin(a) * 6, alpha(CYAN, 0.55));
    }
    for (let r = 2; r <= 6; r += 2)
      for (let i = 0; i <= 8; i++) {
        const a = (i / 8) * Math.PI;
        p.set(
          Math.round(8 + Math.cos(a) * r),
          Math.round(8 - Math.sin(a) * r * 0.85),
          alpha(CYAN, 0.45),
        );
      }
    const s = [
      [5, 5],
      [11, 4],
      [8, 2],
    ][f];
    p.set(s[0], s[1], WHITE);
    return { img: p.canvas(), ax: 8, ay: 10 };
  });
});

// Застывший в стекле: тёмный силуэт путника внутри прозрачной глыбы.
registerPropPainter('f7_frozen', (o) => {
  const v = Math.floor(hash(o.x, o.y, 9) * 2);
  return spriteOf(`frozen|${v}`, () => {
    const p = new Px(18, 28);
    // Силуэт: голова, плечи, поднятая рука.
    // Застывший — лиловый: на полупрозрачном стекле тёмная фигура тонула.
    const man: Tones = [hx('#241c40'), hx('#443a72'), hx('#6a5aa4'), hx('#9a8ad0')];
    shadeEll(p, 9, 7, 2.6, 2.8, man);
    limb(p, 9, 10, 9, 20, 3, 2.6, man);
    limb(p, 7, 12, v ? 3 : 5, v ? 4 : 17, 1, 0.9, man);
    limb(p, 11, 12, 13, 18, 1, 0.9, man);
    limb(p, 8, 20, 7, 26, 1.2, 1, man);
    limb(p, 10, 20, 11, 26, 1.2, 1, man);
    // Глыба стекла поверх: грани, блики. Стекло ложится НА фигуру, а не
    // вместо неё (первый заход заменял пиксели — внутри была пустота).
    for (let y = 1; y <= 27; y++)
      for (let x = 1; x <= 16; x++) {
        const edge = x === 1 || x === 16 || y === 1 || y === 27;
        const facet = (x * 2 + y) % 13 === 0;
        const glass = edge ? GL[2] : facet ? GL[3] : GL[1];
        const a = edge ? 0.9 : facet ? 0.6 : 0.22;
        if (p.solid(x, y) && !edge)
          p.set(x, y, mixc(p.get(x, y), [glass[0], glass[1], glass[2], 255], a * 0.7));
        else p.set(x, y, alpha(glass, a));
      }
    stroke(p, 3, 3, 3, 24, alpha(WHITE, 0.6));
    stroke(p, 4, 3, 8, 3, alpha(WHITE, 0.5));
    // Глаза застывшего ещё светятся.
    p.set(8, 7, CYAN_HOT);
    p.set(10, 7, CYAN_HOT);
    p.outline(INK);
    return { img: p.canvas(), ax: 9, ay: 28 };
  });
});

// Мольберт под покрывалом: угол покрывала сполз — видна золочёная рама.
registerPropPainter('f7_easel', (o) => {
  const v = Math.floor(hash(o.x, o.y, 5) * 2);
  return spriteOf(`easel|${v}`, () => {
    const p = new Px(16, 26);
    const wood: Tones = [hx('#3a2418'), hx('#5e3c26'), hx('#86583a'), hx('#b07e54')];
    limb(p, 4, 25, 7, 3, 0.8, 0.7, wood);
    limb(p, 12, 25, 9, 3, 0.8, 0.7, wood);
    limb(p, 8, 25, 8, 12, 0.7, 0.7, wood);
    // Холст в раме.
    for (let y = 5; y <= 16; y++)
      for (let x = 2; x <= 13; x++)
        p.set(x, y, x === 2 || x === 13 || y === 5 || y === 16 ? GILT[2] : hx('#1a1c2a'));
    // Покрывало.
    const cloth: Tones = [hx('#4a4e62'), hx('#767c94'), hx('#a4aac0'), hx('#d0d4e2')];
    poly(
      p,
      [
        [1, 4],
        [14, 4],
        [14, v ? 18 : 12],
        [v ? 6 : 10, 19],
        [1, 18],
      ],
      (x, y) => tone(cloth, 0.55 + Math.sin(x * 1.2 + y * 0.3) * 0.3),
    );
    p.outline(INK);
    return { img: p.canvas(), ax: 8, ay: 26 };
  });
});

// Призма на подставке: парит и отбрасывает радугу на пол.
registerPropPainter('f7_prismstand', (o, time) => {
  const f = Math.floor(time * 4 + hash(o.x, o.y) * 4) % 4;
  return spriteOf(`pstand|${f}`, () => {
    const p = new Px(18, 26);
    const stone: Tones = [hx('#2c2e3c'), hx('#4c5064'), hx('#747a92'), hx('#a8aec4')];
    for (let y = 18; y <= 25; y++)
      for (let x = 5; x <= 12; x++) p.set(x, y, tone(stone, 0.6 - (x - 5) * 0.07));
    stroke(p, 4, 18, 13, 18, stone[3]);
    // Радуга веером на подставке и полу.
    for (let i = 0; i < 6; i++) p.set(9 + i, 24 - ((i + f) % 2), alpha(RAINBOW[i], 0.7));
    const bob = [0, -1, -1, 0][f];
    poly(
      p,
      [
        [9, 5 + bob],
        [13, 14 + bob],
        [5, 14 + bob],
      ],
      (x) => (x < 9 ? VIO[2] : VIO[1]),
    );
    stroke(p, 9, 6 + bob, 7, 13 + bob, VIO[3]);
    p.set(9, 11 + bob, RAINBOW[f]);
    p.outline(INK);
    return { img: p.canvas(), ax: 9, ay: 26 };
  });
});

// Куча осколков: блестят вразнобой.
registerPropPainter('f7_shardpile', (o, time) => {
  const v = Math.floor(hash(o.x, o.y, 11) * 3);
  const f = Math.floor(time * 3 + hash(o.x, o.y) * 4) % 4;
  return spriteOf(`pile|${v}|${f}`, () => {
    const p = new Px(16, 10);
    for (let i = 0; i < 9; i++) {
      const x = 2 + hash(i, v, 1) * 12;
      const y = 3 + hash(i, v, 2) * 6;
      const s = 1.2 + hash(i, v, 3) * 1.6;
      poly(
        p,
        [
          [x, y - s],
          [x + s, y + s * 0.4],
          [x - s * 0.7, y + s * 0.5],
        ],
        i % 3 ? GL[2] : SILV[2],
      );
    }
    p.outline(alpha(INK, 0.7));
    const k = [3, 7, 5, 1][f];
    p.set(Math.round(2 + hash(k, v, 1) * 12), Math.round(2 + hash(k, v, 2) * 5), WHITE);
    return { img: p.canvas(), ax: 8, ay: 9 };
  });
});

// Хрустальная люстра: висит над полом, подвески качаются, свечи горят.
registerPropPainter('f7_chandelier', (o, time) => {
  const f = Math.floor(time * 3 + hash(o.x, o.y) * 4) % 4;
  return spriteOf(`chand|${f}`, () => {
    const p = new Px(28, 30);
    const sway = [0, 1, 0, -1][f];
    // Цепь уходит вверх (к своду).
    stroke(p, 14, 0, 14 + sway * 0.5, 8, GILT[1]);
    // Обод.
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * TAU;
      p.set(
        Math.round(14 + sway * 0.5 + Math.cos(a) * 10),
        Math.round(12 + Math.sin(a) * 3),
        GILT[2],
      );
    }
    // Подвески-капли.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      const x = 14 + sway + Math.cos(a) * 10;
      const y = 13 + Math.sin(a) * 3;
      stroke(p, x, y, x + sway * 0.5, y + 4, alpha(GL[2], 0.9));
      p.set(Math.round(x + sway * 0.5), Math.round(y + 5), i % 2 ? CYAN_HOT : GL[3]);
    }
    // Свечи с холодным огнём.
    for (const dx of [-8, -3, 3, 8]) {
      const x = Math.round(14 + sway * 0.5 + dx);
      stroke(p, x, 11, x, 9, hx('#e8e4f0'));
    }
    p.outline(alpha(INK, 0.7));
    for (const [i, dx] of [-8, -3, 3, 8].entries())
      coldFlame(p, Math.round(14 + sway * 0.5 + dx), 8, 3, f + i);
    // Висит высоко: основание картинки далеко под ней (тени нет — не касается пола).
    return { img: p.canvas(), ax: 14, ay: 46 };
  });
});

/** Золочёная рама с завитками (w×h), внутри — пусто. */
function giltFrame(p: Px, x0: number, y0: number, w: number, h: number): void {
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) {
      const e = Math.min(x - x0, y - y0, x0 + w - 1 - x, y0 + h - 1 - y);
      if (e > 1) continue;
      const lit = x - x0 < 2 || y - y0 < 2;
      p.set(x, y, e === 0 ? GILT[lit ? 2 : 0] : GILT[lit ? 3 : 1]);
    }
  // Завитки по углам.
  for (const [cx, cy] of [
    [x0, y0],
    [x0 + w - 1, y0],
    [x0, y0 + h - 1],
    [x0 + w - 1, y0 + h - 1],
  ]) {
    p.set(cx, cy, GILT[3]);
    p.ell(cx, cy, 1.2, 1.2, GILT[2]);
  }
}

// Пустая рама: засада тени. Дрожит — внутри вихрь; тень снаружи — пусто.
registerPropPainter('f7_frame', (o, time, _a, flash) => {
  const st = F7_VIEW.frames.get(o.id) ?? 0;
  const f = Math.floor(time * (st === 1 ? 10 : 3)) % 4;
  return spriteOf(`frame|${st}|${st <= 1 ? f : 0}|${flash ? 1 : 0}`, () => {
    const p = new Px(16, 24);
    // Холст — густая тьма; у готовой рамы в ней медленно ходит мрак.
    for (let y = 3; y <= 19; y++)
      for (let x = 3; x <= 12; x++) {
        const n = Math.sin(x * 0.9 + y * 0.6 + f * 1.6) + Math.cos(y * 0.8 - f);
        const c =
          st === 1
            ? n > 0.6
              ? VIO[2]
              : n > -0.2
                ? VIO[1]
                : VIO[0]
            : st === 0
              ? n > 1.1
                ? VIO[1]
                : hx('#0a0812')
              : hx('#07060c');
        p.set(x, y, c);
      }
    // Дрожит — в холсте проступает силуэт.
    if (st === 1) {
      p.ell(8, 8, 2, 2, SHD[0]);
      limb(p, 8, 10, 8, 18, 2.4, 2.8, [SHD[0], SHD[0], SHD[1], SHD[1]]);
      p.set(7, 8, WHITE);
      p.set(9, 8, WHITE);
    }
    if (st === 3) {
      stroke(p, 4, 5, 9, 12, alpha(SILV[1], 0.6));
      stroke(p, 9, 12, 7, 18, alpha(SILV[1], 0.6));
    }
    giltFrame(p, 1, 1, 14, 21);
    // Ножка: рама прислонена к стене.
    stroke(p, 3, 22, 3, 23, GILT[0]);
    stroke(p, 12, 22, 12, 23, GILT[0]);
    p.outline(INK);
    const img = flash ? p.tint(WHITE, 0.8).canvas() : p.canvas();
    return { img, ax: 8, ay: 24 };
  });
});

// Большое зеркало зала: резная рама, в стекле — сам зал (тёмный), трещины от ударов.
registerPropPainter('f7_bigmirror', (_o, time, _a, flash) => {
  const hits = F7_VIEW.bigHits;
  const g = Math.floor(time * 0.5) % 2;
  return spriteOf(`big|${hits}|${g}|${flash ? 1 : 0}`, () => {
    const W0 = 52;
    const H0 = 46;
    const p = new Px(W0, H0);
    // Стекло: холодная глубина. В нём отражён зал — чёрный камень пола
    // сеткой швов в перспективе, свет колонн, — и в середине стоит ОН:
    // тёмная фигура рыцаря, чьи глаза разгораются с каждым ударом.
    const floorY = 30;
    for (let y = 5; y < H0 - 6; y++)
      for (let x = 5; x < W0 - 5; x++) {
        const k = (y - 5) / (H0 - 11);
        let c = mixc(hx('#161c30'), hx('#2a3450'), k);
        if (y >= floorY) {
          // Пол в зеркале: швы плит сходятся к середине.
          const d = (y - floorY + 1) / (H0 - 6 - floorY);
          const u = (x - W0 / 2) / (0.35 + d);
          if (Math.abs(u % 8) < 0.9 || (y - floorY) % 4 === 0) c = mixc(c, SILV[1], 0.3);
        }
        if ((x === 12 || x === 39) && y < floorY + 2) c = mixc(c, GL[2], 0.45);
        if ((x === 13 || x === 40) && y < floorY + 2) c = mixc(c, GL[1], 0.3);
        p.set(x, y, c);
      }
    // Двойник в глубине стекла.
    const man: Tones = [hx('#0c0e1c'), hx('#161a2e'), hx('#22283e'), hx('#303852')];
    shadeEll(p, 26, 17, 4.2, 4.6, man);
    limb(p, 26, 21, 26, 30, 4.4, 3.6, man);
    limb(p, 22, 22, 20, 29, 1.4, 1.2, man);
    limb(p, 30, 22, 32, 29, 1.4, 1.2, man);
    stroke(p, 23, 17, 29, 17, hx('#05060c'));
    stroke(p, 26, 17, 26, 20, hx('#05060c'));
    const eye = hits ? CYAN_HOT : alpha(CYAN, 0.35 + g * 0.2);
    p.set(24, 17, eye);
    p.set(28, 17, eye);
    // Блики наискось.
    for (let i = 0; i < 26; i++) {
      p.set(10 + i, 34 - i, alpha(WHITE, 0.45 + g * 0.2));
      p.set(13 + i, 34 - i, alpha(CYAN_HOT, 0.25));
    }
    // Рама: широкая позолота, наверху — гребень.
    for (let y = 0; y < H0; y++)
      for (let x = 0; x < W0; x++) {
        const e = Math.min(x, y - 2, W0 - 1 - x, H0 - 1 - y);
        if (e < 0 || e > 4) continue;
        const lit = x < 5 || y < 7;
        p.set(x, y, e === 0 || e === 4 ? GILT[lit ? 1 : 0] : GILT[lit ? 3 : 2]);
      }
    poly(
      p,
      [
        [18, 3],
        [26, -1],
        [34, 3],
      ],
      GILT[2],
    );
    p.ell(26, 2, 2.4, 2, VIO[2]);
    // Трещины — по числу ударов, звездой от точки удара.
    const cx = 26;
    const cy = 24;
    for (let i = 0; i < Math.min(6, hits) * 2; i++) {
      const a = (i / 12) * TAU + 0.3;
      const len = 6 + ((i * 7) % 13);
      stroke(p, cx, cy, cx + Math.cos(a) * len, cy + Math.sin(a) * len * 0.9, hx('#0a0c18'));
      stroke(
        p,
        cx - 1,
        cy - 1,
        cx + Math.cos(a) * len - 1,
        cy + Math.sin(a) * len * 0.9 - 1,
        alpha(WHITE, 0.55),
      );
    }
    if (hits) p.ell(cx, cy, 1.5 + hits * 0.3, 1.5 + hits * 0.3, alpha(WHITE, 0.8));
    p.outline(INK);
    const img = flash ? p.tint(WHITE, 0.7).canvas() : p.canvas();
    return { img, ax: W0 / 2, ay: H0 };
  });
});

/** Цвета пар переходов: оправа и вихрь. */
const PORTAL_TONES: Tones[] = [
  [hx('#1e3c6c'), hx('#3a78c8'), hx('#8ac4ff'), hx('#e8f6ff')],
  [hx('#2c1c5c'), hx('#6a44c8'), hx('#b490ff'), hx('#f0e6ff')],
  [hx('#0e3c3a'), hx('#1c8a80'), hx('#6ae0d0'), hx('#dcfff8')],
  [hx('#4c1422'), hx('#b0304c'), hx('#ff7a8a'), hx('#ffe4ea')],
];

// Зеркало-переход: овал в цветной оправе, внутри вихрь; заряжается, когда в нём стоят.
for (let n = 1; n <= 4; n++)
  registerPropPainter(`f7_portal${n}`, (o, time) => {
    const f = Math.floor(time * 6 + hash(o.x, o.y) * 4) % 6;
    const charge = Math.min(3, Math.floor((F7_VIEW.warp[n] ?? 0) * 4));
    return spriteOf(`portal${n}|${f}|${charge}`, () => {
      const t = PORTAL_TONES[n - 1];
      const p = new Px(18, 30);
      const cx = 9;
      const cy = 13;
      // Вихрь внутри: спираль, крутится кадрами.
      for (let y = 2; y <= 25; y++)
        for (let x = 2; x <= 15; x++) {
          const dx = (x + 0.5 - cx) / 6.2;
          const dy = (y + 0.5 - cy) / 11;
          const d = Math.hypot(dx, dy);
          if (d > 1) continue;
          const a = Math.atan2(dy, dx);
          const s = Math.sin(a * 2 + d * 7 - (f / 6) * TAU);
          const c = s > 0.5 ? t[2] : s > -0.2 ? t[1] : t[0];
          p.set(x, y, charge ? mixc(c, t[3], charge * 0.22) : c);
        }
      // Оправа: серебро с цветным камнем наверху.
      for (let i = 0; i < 64; i++) {
        const a = (i / 64) * TAU;
        const x = Math.round(cx + Math.cos(a) * 7.2 - 0.5);
        const y = Math.round(cy + Math.sin(a) * 12 - 0.5);
        p.set(x, y, Math.cos(a) < 0 || Math.sin(a) < 0 ? SILV[3] : SILV[1]);
      }
      p.ell(cx - 0.5, 1.5, 1.6, 1.4, t[3]);
      // Ножки-подставка.
      stroke(p, cx - 4, 25, cx - 6, 29, SILV[1]);
      stroke(p, cx + 3, 25, cx + 5, 29, SILV[1]);
      p.outline(INK);
      return { img: p.canvas(), ax: 9, ay: 30 };
    });
  });

// ---------------------------------------------------------------------------
// Свои клетки. У каждого района — свой рисовальщик (Галерея — мрамор,
// ковры, зеркала в позолоте; Хрусталь — стеклянный пол, хрустальные стены,
// пропасть; Зал — мозаика и зеркала арены), общие — осколки, ложные проходы,
// треснувшие зеркала, иллюзии, знаки переходов. Клетки — из кеша.
// ---------------------------------------------------------------------------

const cells = new Map<string, Px>();
const cellOf = (key: string, make: () => Px): Px => {
  let c = cells.get(key);
  if (!c) {
    c = make();
    cells.set(key, c);
  }
  return c;
};

type Area = 'g' | 'c' | 'h';

const MK = F7_MARK;

/** Мрамор шахматкой: квадраты по 8, прожилки. Контраст сдержанный — пол
 *  не должен спорить с монстрами (первый заход был чёрно-белым и шумел). */
function checkerCell(c: CellCtx): Px {
  const v = Math.floor(hash(c.wx, c.wy, 1) * 4);
  const par = (c.wx + c.wy) % 2;
  return cellOf(`chk|${v}|${par}`, () => {
    const p = new Px(16, 16);
    const light: RGBA[] = [hx('#444a5e'), hx('#4e556b'), hx('#596179')];
    const dark: RGBA[] = [hx('#1a1c2a'), hx('#202334'), hx('#272a3e')];
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const q = (Math.floor(x / 8) + Math.floor(y / 8) + par) % 2;
        const pal = q ? light : dark;
        const vein = Math.sin((x + v * 5) * 0.7 + y * 0.45 + Math.sin(y * 0.9 + v) * 1.5) > 0.93;
        let t = 1;
        if (x % 8 === 0 || y % 8 === 0) t = 2;
        if (x % 8 === 7 || y % 8 === 7) t = 0;
        p.set(x, y, vein ? (q ? hx('#687088') : hx('#30344a')) : pal[t]);
      }
    // Полировка: отблеск на светлом квадрате.
    if (v === 1)
      for (let i = 0; i < 4; i++) p.set(2 + i + (par ? 8 : 0), 5 - i, alpha(WHITE, 0.22));
    return p;
  });
}

/** Паркет «ёлочкой»: столбцы по 8 точек, планки наискось то «/», то «\»,
 *  встречаются в шов. Дерево приглушённое и холодное — это пыльный дворец,
 *  а не новый дом. Узор привязан к миру, период — 15 клеток. */
const HERRING: RGBA[] = [hx('#33261f'), hx('#3d2e25'), hx('#47352a'), hx('#523e31')];
function herringCell(c: CellCtx): Px {
  const mx = ((c.wx % 15) + 15) % 15;
  const my = ((c.wy % 15) + 15) % 15;
  return cellOf(`her|${mx}|${my}`, () => {
    const p = new Px(16, 16);
    const seam = hx('#191210');
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const u = mx * 16 + x;
        const v = my * 16 + y;
        const col = Math.floor(u / 8);
        const up = col % 2 === 0;
        // Поперёк планки (ширина 3) и вдоль неё (длина 10, со сдвигом по ряду).
        const across = up ? u + v : v - u + 480;
        const s = Math.floor(across / 3);
        const along = (up ? u - v : u + v) + 480 + s * 4;
        const seg = Math.floor(along / 10);
        let t = HERRING[Math.floor(hash(s % 160, seg % 112, col % 30) * 4)];
        if (across % 3 === 0 || along % 10 === 0) t = seam;
        else if (across % 3 === 1) t = mixc(t, hx('#6a5444'), 0.25);
        else if ((along + s) % 7 === 3) t = mixc(t, hx('#2a1f19'), 0.4); // волокно
        if (u % 8 === 0) t = mixc(t, seam, 0.6);
        p.set(x, y, t);
      }
    return p;
  });
}

/** Полированный чёрный камень: квадратные плиты 2×2 клетки, тонкий шов с
 *  фаской, на стыке четырёх плит — серебряная звёздочка, по плите — мягкий
 *  косой отблеск. Вперевязку (как кирпич) плиты читались стеной сверху. */
function obsidianCell(c: CellCtx): Px {
  const qx = ((c.wx % 2) + 2) % 2;
  const qy = ((c.wy % 2) + 2) % 2;
  const slab = hash(c.wx >> 1, c.wy >> 1, 43);
  const v = Math.floor(slab * 4);
  return cellOf(`obs|${qx}${qy}|${v}`, () => {
    const p = new Px(16, 16);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const sx = (qx * 16 + x) / 32;
        const sy = (qy * 16 + y) / 32;
        let col = mixc(hx('#161826'), hx('#0c0d16'), Math.min(1, (sx + sy) * 0.6));
        // Косой отблеск — у каждой четвёртой плиты, широкий и мягкий: на
        // всех сразу параллельные полосы читались дождём.
        const band = Math.abs(sx - sy * 0.8 - 0.25);
        if (v === 1 && band < 0.16) col = mixc(col, hx('#262a42'), 0.45 * (1 - band / 0.16));
        // Прожилка в камне.
        if (v === 2 && Math.abs(Math.sin(sx * 7 + sy * 3) * 0.12 - (sy - 0.5)) < 0.02)
          col = hx('#1e2032');
        p.set(x, y, col);
      }
    // Шов — только по краю плиты (верх и лево плиты 2×2).
    if (qy === 0)
      for (let x = 0; x < 16; x++) {
        p.set(x, 0, hx('#050509'));
        p.set(x, 1, hx('#242740'));
      }
    if (qx === 0)
      for (let y = 0; y < 16; y++) {
        p.set(0, y, hx('#050509'));
        p.set(1, y, hx('#20233a'));
      }
    // Серебряная звёздочка на стыке плит.
    if (qx === 0 && qy === 0) {
      p.set(0, 0, SILV[3]);
      p.set(1, 0, SILV[1]);
      p.set(0, 1, SILV[1]);
      p.set(15, 0, SILV[1]);
      p.set(0, 15, SILV[1]);
    }
    return p;
  });
}

/** Шестигранное стекло: соты по 8 точек (нечётные ряды сдвинуты на 4),
 *  у каждой соты свой оттенок, свет — сверху-слева, у некоторых искра. */
const HEX_TINT: RGBA[][] = [
  [hx('#0f2630'), hx('#163842'), hx('#22525e')],
  [hx('#10222c'), hx('#18323e'), hx('#244a5a')],
  [hx('#141c30'), hx('#1c2842'), hx('#2c3a5e')],
  [hx('#0e2628'), hx('#153a38'), hx('#20544e')],
];
function hexCell(c: CellCtx): Px {
  const mx = ((c.wx % 4) + 4) % 4;
  const my = ((c.wy % 4) + 4) % 4;
  return cellOf(`hex|${mx}|${my}`, () => {
    const p = new Px(16, 16);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const u = mx * 16 + x + 0.5;
        const v = my * 16 + y + 0.5;
        // Ближайший и второй центр сот.
        let d1 = 1e9;
        let d2 = 1e9;
        let ci = 0;
        let cj = 0;
        let ox = 0;
        let oy = 0;
        const j0 = Math.floor(v / 7);
        for (let j = j0 - 1; j <= j0 + 1; j++) {
          const off = j % 2 ? 4 : 0;
          const i0 = Math.floor((u - off) / 8);
          for (let i = i0 - 1; i <= i0 + 1; i++) {
            const cx = i * 8 + off + 4;
            const cy = j * 7 + 3.5;
            const d = Math.hypot(u - cx, (v - cy) * 1.1);
            if (d < d1) {
              d2 = d1;
              d1 = d;
              ci = i;
              cj = j;
              ox = u - cx;
              oy = v - cy;
            } else if (d < d2) d2 = d;
          }
        }
        const tint = HEX_TINT[Math.floor(hash(((ci % 8) + 8) % 8, ((cj % 9) + 9) % 9, 47) * 4)];
        const edge = d2 - d1 < 1.1;
        let col: RGBA;
        if (edge) col = ox + oy < 0 ? hx('#08121a') : hx('#2e6c7a');
        else {
          const l = -(ox * 0.6 + oy * 0.8) / 4.5;
          col = l > 0.35 ? tint[2] : l > -0.25 ? tint[1] : tint[0];
        }
        p.set(x, y, col);
      }
    // Искры в толще — редкие.
    const s = Math.floor(hash(mx, my, 49) * 16);
    if (s < 5) p.set(3 + s * 2, 4 + ((s * 5) % 9), alpha(CYAN_HOT, 0.75));
    return p;
  });
}

/** Сырой пол пещеры: тёмный камень, щебень, трещины и ростки хрусталя. */
function roughCell(c: CellCtx): Px {
  const v = Math.floor(hash(c.wx, c.wy, 53) * 6);
  return cellOf(`rough|${v}`, () => {
    const p = new Px(16, 16);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const n = hash(x >> 1, y >> 1, v * 7 + 3) * 0.6 + hash(x, y, v) * 0.4;
        p.set(x, y, mixc(hx('#161a24'), hx('#232a36'), n));
      }
    // Щебень: камешки со светлой макушкой.
    for (let i = 0; i < 4; i++) {
      const x = 1 + Math.floor(hash(i, v, 55) * 13);
      const y = 1 + Math.floor(hash(i, v, 56) * 13);
      p.set(x, y, hx('#39414f'));
      p.set(x + 1, y, hx('#2c3340'));
      p.set(x, y + 1, hx('#0d1016'));
    }
    // Трещина.
    if (v % 2 === 0) {
      stroke(p, 2 + v, 3, 7, 8, hx('#0a0c12'));
      stroke(p, 7, 8, 12, 10 + (v % 3), hx('#0a0c12'));
    }
    // Росток хрусталя: две-три грани.
    if (v >= 3) {
      const x = 4 + v;
      const t: Tones = v === 5 ? VIO : [hx('#16404c'), hx('#2e7a8a'), hx('#6ac6d4'), hx('#d4f8ff')];
      for (let k = 0; k < 4; k++) {
        p.set(x, 12 - k, k === 3 ? t[3] : t[2]);
        p.set(x + 1, 12 - k, t[1]);
      }
      p.set(x - 1, 12, t[1]);
      p.set(x - 1, 11, t[2]);
      p.set(x + 2, 12, t[0]);
      for (let dx = -1; dx <= 2; dx++) p.set(x + dx, 13, alpha(INK, 0.5));
    }
    return p;
  });
}

/** Дощатый пол мастерской: доски по 4 точки, торцы вразбежку, гвозди,
 *  стеклянная крошка в щелях. Старое серое дерево. */
function plankCell(c: CellCtx): Px {
  const v = Math.floor(hash(c.wx, c.wy, 61) * 4);
  const mx = ((c.wx % 8) + 8) % 8;
  return cellOf(`plank|${mx}|${c.wy % 4}|${v}`, () => {
    const p = new Px(16, 16);
    const wood = [hx('#35302b'), hx('#3e3831'), hx('#474037'), hx('#50483d')];
    for (let b = 0; b < 4; b++) {
      const row = (c.wy % 4) * 4 + b;
      // Торец доски: раз в 2–3 клетки, у каждой доски свой сдвиг.
      const shift = Math.floor(hash(row, 7, 63) * 40);
      for (let y = b * 4; y < b * 4 + 4; y++)
        for (let x = 0; x < 16; x++) {
          const u = mx * 16 + x + shift;
          const seg = Math.floor(u / 40);
          let col = wood[Math.floor(hash(row, seg, 65) * 4)];
          if (y === b * 4) col = hx('#1a1714');
          else if (y === b * 4 + 1) col = mixc(col, hx('#6a5e50'), 0.25);
          else if ((u * 7 + y * 3) % 23 === 0) col = mixc(col, hx('#221e1a'), 0.5); // волокно
          if (u % 40 === 0) col = hx('#1a1714');
          if (u % 40 === 2 && y === b * 4 + 2) col = hx('#8a8478'); // гвоздь
          p.set(x, y, col);
        }
    }
    // Стеклянная крошка в щели.
    if (v === 0) {
      p.set(5, 4, alpha(GL[3], 0.8));
      p.set(11, 12, alpha(GL[2], 0.7));
    }
    return p;
  });
}

/** Стеклянный мосток: сквозь толстое стекло видна пропасть, по краям —
 *  светлая кромка там, где под ногами обрыв; поперечные рёбра жёсткости. */
function bridgeCell(c: CellCtx): Px {
  const edge = (dx: number, dy: number) => c.markAt(dx, dy) === MK.void;
  const up = edge(0, -1);
  const dn = edge(0, 1);
  const lf = edge(-1, 0);
  const rt = edge(1, 0);
  const v = Math.floor(hash(c.wx, c.wy, 59) * 2);
  return cellOf(`bridge|${+up}${+dn}${+lf}${+rt}|${v}`, () => {
    const p = new Px(16, 16);
    const deep = voidCell({ ...c, markAt: () => MK.void, open: () => false });
    p.data.set(deep.data);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const k = 0.42 + ((x + y) / 30) * 0.12;
        p.set(x, y, mixc(p.get(x, y), hx('#3c8c9c'), k));
      }
    // Рёбра жёсткости поперёк хода.
    const horiz = lf || rt ? false : true;
    for (let i = 0; i < 16; i++) {
      if (horiz) p.set(i, 0, alpha(hx('#8ad8e6'), 0.55));
      else p.set(0, i, alpha(hx('#8ad8e6'), 0.55));
    }
    // Кромки над обрывом: яркая грань и тень под ней.
    for (let i = 0; i < 16; i++) {
      if (up) {
        p.set(i, 0, hx('#c8f6ff'));
        p.set(i, 1, hx('#5aa8b8'));
      }
      if (dn) {
        p.set(i, 15, hx('#0a1a20'));
        p.set(i, 14, hx('#7ac8d6'));
      }
      if (lf) {
        p.set(0, i, hx('#c8f6ff'));
        p.set(1, i, hx('#5aa8b8'));
      }
      if (rt) {
        p.set(15, i, hx('#0a1a20'));
        p.set(14, i, hx('#7ac8d6'));
      }
    }
    // Блик по стеклу.
    for (let i = 0; i < 4; i++) p.set(4 + i + v * 5, 10 - i, alpha(WHITE, 0.35));
    return p;
  });
}

/** Полы, из которых собирается «пол комнаты» под предметом, осколками,
 *  знаком перехода и буквами движка (логово, табличка, тайник). */
const ROOM_FLOORS: ReadonlySet<number> = new Set<number>([
  MK.checker,
  MK.carpet,
  MK.glass,
  MK.mosaic,
  MK.herring,
  MK.obsidian,
  MK.hex,
  MK.rough,
  MK.plank,
]);

/** Вид пола вокруг клетки: большинство из восьми соседей (0 — нет своего). */
function roomMark(c: CellCtx): number {
  const count = new Map<number, number>();
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [-1, -1],
    [1, -1],
    [-1, 1],
  ]) {
    const k = c.markAt(dx, dy);
    if (ROOM_FLOORS.has(k)) count.set(k, (count.get(k) ?? 0) + (dx === 0 || dy === 0 ? 1.2 : 1));
  }
  let best = 0;
  let bk = 0;
  for (const [k, n] of count)
    if (n > best) {
      best = n;
      bk = k;
    }
  return bk;
}

/** Пол комнаты под клеткой (или null — пусть рисует движок). */
function roomFloor(c: CellCtx, area: Area): Px | null {
  const k = roomMark(c);
  if (!k) return null;
  const cc: CellCtx = { ...c, mark: k };
  if (k === MK.checker) return checkerCell(cc);
  if (k === MK.glass) return glassFloor(Math.floor(hash(c.wx, c.wy, 2) * 8));
  if (k === MK.mosaic) return mosaicCell(cc, false);
  if (k === MK.herring) return herringCell(cc);
  if (k === MK.obsidian) return obsidianCell(cc);
  if (k === MK.hex) return hexCell(cc);
  if (k === MK.rough) return roughCell(cc);
  if (k === MK.plank) return plankCell(cc);
  return carpetCell(
    { ...cc, markAt: (dx, dy) => (c.markAt(dx, dy) === MK.under ? MK.carpet : c.markAt(dx, dy)) },
    area === 'h',
  );
}

/** Наложить прозрачную клетку на пол комнаты (кешируется по обоим). */
function onRoom(c: CellCtx, area: Area, key: string, top: Px): Px {
  const base = roomFloor(c, area);
  if (!base) return top;
  return cellOf(`on|${key}|${c.wx}|${c.wy}`, () => {
    const p = new Px(16, 16);
    p.data.set(base.data);
    over(p, top, 0, 0);
    return p;
  });
}

/** Ковровая дорожка: бархат с узором, кайма там, где ковёр кончается. */
/** Ковёр продолжается под предметом, осколками и знаком перехода — кайма
 *  вокруг каждой вазы на ковре читалась рамкой-прицелом. */
const rugGoesOn = (k: number) =>
  k === MK.carpet || k === MK.under || k === MK.shards || (k > MK.portal && k <= MK.portal + 4);

function carpetCell(c: CellCtx, hall: boolean): Px {
  const up = !rugGoesOn(c.markAt(0, -1));
  const dn = !rugGoesOn(c.markAt(0, 1));
  const lf = !rugGoesOn(c.markAt(-1, 0));
  const rt = !rugGoesOn(c.markAt(1, 0));
  return cellOf(`rug|${hall ? 1 : 0}|${+up}${+dn}${+lf}${+rt}|${(c.wx + c.wy) % 2}`, () => {
    const p = new Px(16, 16);
    const base = hall ? hx('#2c1846') : hx('#46162e');
    const mid = hall ? hx('#3e2464') : hx('#5e2240');
    const gold = GILT[2];
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        // Ромбы узора.
        const d = Math.abs(x - 7.5) + Math.abs(y - 7.5);
        let col = d < 3 ? mid : d < 4 ? gold : base;
        if ((x + y) % 5 === 0 && d > 5) col = mid;
        if ((c.wx + c.wy) % 2 && d < 1.5) col = hall ? VIO[2] : hx('#a8445a');
        p.set(x, y, col);
      }
    const border = (x: number, y: number) => {
      p.set(x, y, gold);
    };
    for (let i = 0; i < 16; i++) {
      if (up) {
        border(i, 0);
        p.set(i, 1, GILT[0]);
      }
      if (dn) {
        border(i, 15);
        p.set(i, 14, GILT[0]);
      }
      if (lf) {
        border(0, i);
        p.set(1, i, GILT[0]);
      }
      if (rt) {
        border(15, i);
        p.set(14, i, GILT[0]);
      }
    }
    return p;
  });
}

/** Осколки на полу: россыпь поверх пола комнаты — пол виден. */
function shardsTop(v: number): Px {
  return cellOf(`shards|${v}`, () => {
    const p = new Px(16, 16);
    for (let i = 0; i < 8; i++) {
      const x = 1 + hash(i, v, 1) * 14;
      const y = 1 + hash(i, v, 2) * 14;
      const s = 0.9 + hash(i, v, 3) * 1.7;
      const a = hash(i, v, 4) * TAU;
      poly(
        p,
        [
          [x + Math.cos(a) * s * 1.6, y + Math.sin(a) * s * 1.6],
          [x + Math.cos(a + 2.2) * s, y + Math.sin(a + 2.2) * s],
          [x + Math.cos(a + 4) * s, y + Math.sin(a + 4) * s],
        ],
        i % 3 ? alpha(GL[2], 0.9) : alpha(SILV[2], 0.9),
      );
      p.set(Math.round(x), Math.round(y), i % 2 ? alpha(WHITE, 0.9) : alpha(GL[3], 0.8));
    }
    // Тёмная кромка у острых краёв — осколки лежат, а не висят.
    const q = new Px(16, 16);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++)
        if (!p.solid(x, y) && p.solid(x - 1, y - 1)) q.set(x, y, alpha(INK, 0.45));
    over(p, q, 0, 0);
    return p;
  });
}

function shardsCell(c: CellCtx, area: Area): Px {
  const v = Math.floor(hash(c.wx, c.wy, 5) * 4);
  return onRoom(c, area, `sh${v}`, shardsTop(v));
}

/** Зеркало на лице стены: оправа по краю, стекло с отражением тёмного зала. */
function mirrorCell(c: CellCtx, area: Area, arena: boolean): Px | null {
  const face = c.open(0, 1);
  const v = Math.floor(hash(c.wx, c.wy, 7) * 4);
  const lf = c.markAt(-1, 0);
  const rt = c.markAt(1, 0);
  const joinL = lf === MK.mirror || lf === MK.arena || lf === MK.cracked;
  const joinR = rt === MK.mirror || rt === MK.arena || rt === MK.cracked;
  if (!face) {
    // Боковая стена арены: зеркальная кромка вдоль пола.
    if (!arena) return null;
    return cellOf(`mside|${+c.open(-1, 0)}|${+c.open(1, 0)}|${+c.open(0, -1)}`, () => {
      const p = new Px(16, 16);
      if (c.open(-1, 0)) for (let y = 0; y < 16; y++) p.set(1, y, alpha(VIO[3], 0.8));
      if (c.open(1, 0)) for (let y = 0; y < 16; y++) p.set(14, y, alpha(VIO[3], 0.8));
      if (c.open(0, -1)) for (let x = 0; x < 16; x++) p.set(x, 1, alpha(VIO[3], 0.8));
      return p;
    });
  }
  return cellOf(`mirror|${area}|${+arena}|${v}|${+joinL}|${+joinR}`, () => {
    const p = new Px(16, 16);
    const frame: Tones = arena
      ? [hx('#2a2440'), hx('#5a5078'), hx('#9a92c0'), hx('#e0dcf4')]
      : area === 'c'
        ? [hx('#1c4450'), hx('#3a8494'), hx('#7ad0de'), hx('#d8faff')]
        : GILT;
    const glassTop = arena ? hx('#2a2450') : hx('#222c44');
    const glassBot = arena ? hx('#4a3c78') : hx('#3c4c68');
    const x0 = joinL ? 0 : 2;
    const x1 = joinR ? 15 : 13;
    for (let y = 2; y <= 14; y++)
      for (let x = x0; x <= x1; x++) {
        const k = (y - 2) / 12;
        let col = mixc(glassTop, glassBot, k);
        // В стекле — отражение: пол зала внизу, отсвет колонн.
        if (k > 0.66 && (x + v) % 4 < 2) col = mixc(col, SILV[1], 0.35);
        if (x === 5 + v && k < 0.7) col = mixc(col, GL[2], 0.3);
        p.set(x, y, col);
      }
    // Блики: две параллельные полосы наискось.
    for (let i = 0; i < 12; i++) {
      const x = x0 + 2 + i;
      const y = 13 - i;
      if (x <= x1 && y >= 2) {
        p.set(x, y, alpha(WHITE, 0.3));
        if (x + 2 <= x1) p.set(x + 2, y, alpha(CYAN_HOT, 0.18));
      }
    }
    // Оправа: верх и низ всегда, бока — где зеркало кончается.
    for (let x = 0; x < 16; x++) {
      p.set(x, 0, frame[0]);
      p.set(x, 1, frame[2]);
      p.set(x, 15, frame[0]);
      p.set(x, 14, frame[1]);
    }
    if (!joinL)
      for (let y = 0; y < 16; y++) {
        p.set(0, y, frame[0]);
        p.set(1, y, frame[2]);
      }
    if (!joinR)
      for (let y = 0; y < 16; y++) {
        p.set(15, y, frame[0]);
        p.set(14, y, frame[1]);
      }
    if (!joinL) p.set(1, 1, frame[3]);
    if (arena) {
      // Зеркала арены — с фиолетовым огнём в рамке.
      p.set(8, 0, VIO[3]);
      p.set(8, 15, VIO[2]);
    }
    return p;
  });
}

/** Треснувшее зеркало: звезда трещин, выбитые куски. */
function crackedCell(c: CellCtx, area: Area, arena: boolean): Px | null {
  const base = mirrorCell({ ...c, mark: MK.mirror }, area, arena);
  if (!base) return null;
  // Боковая стена арены (кромка, а не лицо) — трещин не рисуем: звезда на
  // верхушке стены читалась бледной плиткой.
  if (!c.open(0, 1)) return base;
  const v = Math.floor(hash(c.wx, c.wy, 13) * 3);
  return cellOf(`crack|${area}|${+arena}|${v}|${+c.open(0, 1)}`, () => {
    const p = new Px(16, 16);
    p.data.set(base.data);
    const cx = 6 + v * 2;
    const cy = 7 + (v % 2);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + v;
      const len = 4 + ((i * 5 + v) % 5);
      stroke(p, cx, cy, cx + Math.cos(a) * len, cy + Math.sin(a) * len, hx('#07080e'));
      p.set(
        Math.round(cx + Math.cos(a) * 2) - 1,
        Math.round(cy + Math.sin(a) * 2) - 1,
        alpha(WHITE, 0.7),
      );
    }
    // Выбитые куски — тёмная изнанка.
    p.ell(cx, cy, 1.5, 1.5, hx('#07080e'));
    p.ell(cx + 3, cy + 3, 1, 0.8, hx('#101420'));
    return p;
  });
}

/** Клетка, сдвинутая на (ox, oy): для рисования пола «чужими глазами». */
function shifted(c: CellCtx, ox: number, oy: number): CellCtx {
  return {
    tile: 0,
    mark: c.markAt(ox, oy),
    wx: c.wx + ox,
    wy: c.wy + oy,
    open: (dx, dy) => c.open(ox + dx, oy + dy),
    markAt: (dx, dy) => c.markAt(ox + dx, oy + dy),
  };
}

const AREA_ID: Record<Area, string> = { g: F7_GALLERY, c: F7_CRYSTAL, h: F7_HALL };

/** Пол вида `k` в клетке `c` (её же мировые координаты — узор продолжается). */
function floorAs(c: CellCtx, k: number, area: Area): Px | null {
  const cc: CellCtx = { ...c, mark: k };
  if (k === MK.checker) return checkerCell(cc);
  if (k === MK.glass) return glassFloor(Math.floor(hash(c.wx, c.wy, 2) * 8));
  if (k === MK.herring) return herringCell(cc);
  if (k === MK.obsidian) return obsidianCell(cc);
  if (k === MK.hex) return hexCell(cc);
  if (k === MK.rough) return roughCell(cc);
  if (k === MK.plank) return plankCell(cc);
  if (k === MK.mosaic) return mosaicCell(cc, false);
  // Обычный пол района — тот же, что рисует движок.
  return floorCell(
    AREA_ID[area] as Parameters<typeof floorCell>[0],
    c.wx,
    c.wy,
    false,
    false,
    false,
    'slab',
  );
}

/**
 * Ложный проход: зеркало, в котором отражён пол ЭТОГО ЖЕ хода — выглядит
 * продолжением коридора на две клетки (клетка у пола и клетка за ней),
 * темнеет вглубь. Выдают его только тонкая черта стекла на границе и
 * одинокий блик. Первый заход рисовал там мраморную шахматку с «перспективой»
 * — на виде сверху это читалось картинкой на стене, а не ходом.
 */
function fakeCell(c: CellCtx, area: Area): Px {
  const dirs: [number, number][] = [
    [0, 1],
    [1, 0],
    [-1, 0],
    [0, -1],
  ];
  let dir: [number, number] = [0, 1];
  let depth = 0;
  // Сперва — вторая клетка обманки (за зеркалом), потом — сама клетка у пола.
  // Пропасть «полом» не считается: обманка смотрит в ход, а не в провал.
  const floorAt = (dx: number, dy: number) => c.open(dx, dy) && c.markAt(dx, dy) !== MK.void;
  for (const d of dirs)
    if (c.markAt(d[0], d[1]) === MK.fake && floorAt(d[0] * 2, d[1] * 2)) {
      dir = d;
      depth = 2;
      break;
    }
  if (!depth)
    for (const d of dirs)
      if (floorAt(d[0], d[1])) {
        dir = d;
        depth = 1;
        break;
      }
  return cellOf(`fake|${area}|${c.wx}|${c.wy}`, () => {
    const p = new Px(16, 16);
    const room = shifted(c, dir[0] * Math.max(1, depth), dir[1] * Math.max(1, depth));
    let k = room.mark;
    if (!ROOM_FLOORS.has(k)) k = roomMark(room);
    const floor = floorAs(c, k, area);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const c0 = floor ? floor.get(x, y) : hx('#1c1e2a');
        // Глубина: к дальнему краю темнее (вторая клетка — почти тьма).
        const t = dir[1] > 0 ? 1 - y / 16 : dir[1] < 0 ? y / 16 : dir[0] > 0 ? 1 - x / 16 : x / 16;
        const k2 = depth >= 2 ? 0.5 + t * 0.4 : 0.18 + t * 0.3;
        p.set(x, y, mixc([c0[0], c0[1], c0[2], 255], hx('#0c1020'), k2));
      }
    if (depth === 1) {
      // Черта стекла — по границе с настоящим полом, и блик.
      for (let i = 0; i < 16; i++) {
        const [x, y] = dir[1] > 0 ? [i, 15] : dir[1] < 0 ? [i, 0] : dir[0] > 0 ? [15, i] : [0, i];
        p.set(x, y, mixc(p.get(x, y), SILV[2], 0.28));
      }
      const v = Math.floor(hash(c.wx, c.wy, 17) * 3);
      p.set(5 + v * 3, 6, alpha(WHITE, 0.4));
      p.set(6 + v * 3, 5, alpha(WHITE, 0.22));
    }
    return p;
  });
}

/** Иллюзия: пол, нарисованный зеркальной стеной (лицо стены + зеркало). */
function illusionCell(c: CellCtx, area: Area): Px | null {
  const around = {
    open: (dx: number, dy: number) =>
      dy === 1 && dx === 0 ? true : dx === 0 && dy === -1 ? false : c.open(dx, dy),
  };
  const wall = wallCell(around, area === 'c' ? 'rock' : 'brick', c.wx, c.wy);
  const mir = mirrorCell(
    { ...c, mark: MK.mirror, open: (dx, dy) => (dx === 0 && dy === 1 ? true : c.open(dx, dy)) },
    area,
    false,
  );
  if (!wall || !mir) return null;
  return cellOf(`illu|${area}|${c.wx}|${c.wy}`, () => {
    const p = new Px(16, 16);
    p.data.set(wall.data);
    over(p, mir, 0, 0);
    // Единственная примета: блик стоит не там — отражение «плывёт».
    p.set(4, 12, alpha(VIO[3], 0.8));
    return p;
  });
}

/** Стена за большим зеркалом: кладка, в которой угадывается арка. */
function behindCell(c: CellCtx): Px | null {
  if (!c.open(0, 1)) return null;
  return cellOf(`behind|${c.wx % 5}`, () => {
    const p = new Px(16, 16);
    for (let y = 3; y < 16; y++) {
      const x = c.wx % 5 === 2 ? 8 : -1;
      if (x >= 0) p.set(x, y, alpha(hx('#0a0a12'), 0.6));
    }
    return p;
  });
}

/** Стеклянный пол хрустального лабиринта: толстые плиты с мягкой фаской,
 *  в толще — жилки хрусталя и редкие искры. */
function glassFloor(v: number): Px {
  return cellOf(`glass|${v}`, () => {
    const p = new Px(16, 16);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        let col = mixc(hx('#162c36'), hx('#10202a'), (x + y) / 30);
        if (x === 0 || y === 0) col = hx('#2c5462');
        else if (x === 15 || y === 15) col = hx('#0a161c');
        else if (x === 1 || y === 1) col = hx('#1e3c48');
        p.set(x, y, col);
      }
    // Жилка хрусталя в толще — у одной плиты из восьми, каждая своей
    // ломаной (одна и та же «галочка» на каждой четвёртой читалась узором).
    if (v === 1 || v === 5) {
      let x = v === 1 ? 2 : 13;
      let y = v === 1 ? 12 : 3;
      for (let i = 0; i < 9; i++) {
        const nx = x + (v === 1 ? 1 : -1);
        const ny = y + (i % 3 === 1 ? 0 : v === 1 ? -1 : 1);
        stroke(p, x, y, nx, ny, alpha(hx('#3e7e8e'), 0.35 - i * 0.02));
        x = nx;
        y = ny;
      }
    }
    if (v === 2) p.set(6, 5, alpha(CYAN_HOT, 0.6));
    if (v === 6) {
      // Пузырёк воздуха в стекле.
      p.set(10, 9, alpha(GL[3], 0.35));
      p.set(11, 10, alpha(GL[2], 0.25));
    }
    // Отражение наискось.
    if (v % 2 === 0) for (let i = 0; i < 5; i++) p.set(3 + i, 11 - i, alpha(WHITE, 0.1));
    return p;
  });
}

/** Хрустальная стена: на лице — растущие кристаллы, сверху — острия из породы. */
function crystalCell(c: CellCtx): Px | null {
  const face = c.open(0, 1);
  const v = Math.floor(hash(c.wx, c.wy, 23) * 4);
  return cellOf(`cryst|${+face}|${v}`, () => {
    const p = new Px(16, 16);
    const t: Tones = v === 3 ? VIO : [hx('#16404c'), hx('#2e7a8a'), hx('#6ac6d4'), hx('#d4f8ff')];
    if (face) {
      // Лицо: полупрозрачный хрусталь поверх породы, кристаллы снизу вверх.
      for (let y = 0; y < 16; y++)
        for (let x = 0; x < 16; x++) p.set(x, y, alpha(t[0], 0.35 + (y / 16) * 0.2));
      const n = 3 + (v % 2);
      for (let i = 0; i < n; i++) {
        const x = 2 + Math.floor(hash(i, v, 3) * 12);
        const h = 6 + Math.floor(hash(i, v, 4) * 9);
        const w = 1 + (i % 2);
        for (let y = 15; y > 15 - h; y--)
          for (let dx = -w; dx <= w; dx++) {
            const edge = Math.abs(dx) === w;
            p.set(x + dx, y, edge ? t[1] : dx < 0 ? t[3] : t[2]);
          }
        p.set(x, 15 - h, t[3]);
      }
      for (let x = 0; x < 16; x++) p.set(x, 15, alpha(INK, 0.5));
    } else {
      // Сверху: острия кристаллов из тёмной породы.
      for (let i = 0; i < 2; i++) {
        const x = 3 + Math.floor(hash(i, v, 5) * 10);
        const y = 4 + Math.floor(hash(i, v, 6) * 8);
        poly(
          p,
          [
            [x - 1.5, y + 2],
            [x, y - 2],
            [x + 1.5, y + 2],
          ],
          (xx) => (xx < x ? t[2] : t[1]),
        );
      }
    }
    return p;
  });
}

/** Пропасть: зеркальная тьма — не звёзды, а бледные столбы отражённого
 *  света далеко внизу и редкий осколок, повисший в пустоте. У края —
 *  стеклянная кромка и обрыв. */
function voidCell(c: CellCtx): Px {
  const up = !c.open(0, -1) ? 0 : c.markAt(0, -1) === MK.void ? 0 : 1;
  const lf = c.markAt(-1, 0) === MK.void || !c.open(-1, 0) ? 0 : 1;
  const rt = c.markAt(1, 0) === MK.void || !c.open(1, 0) ? 0 : 1;
  const dn = c.markAt(0, 1) === MK.void || !c.open(0, 1) ? 0 : 1;
  const col = ((c.wx % 6) + 6) % 6;
  const v = Math.floor(hash(c.wx, c.wy, 29) * 8);
  return cellOf(`void|${up}${lf}${rt}${dn}|${col}|${v}`, () => {
    const p = new Px(16, 16);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const u = col * 16 + x;
        // Столбы света в глубине: мягкая синусоида по миру, период 6 клеток.
        const shaft = Math.max(0, Math.sin((u / 96) * TAU * 2 + 0.6)) ** 6;
        const n = hash(x >> 2, y >> 2, v) * 0.25;
        p.set(x, y, mixc(hx('#03050a'), hx('#0e1830'), shaft * 0.8 + n));
      }
    // Повисший осколок — один на восемь клеток.
    if (v === 0) {
      p.set(7, 6, alpha(GL[3], 0.7));
      p.set(8, 7, alpha(GL[2], 0.6));
      p.set(7, 7, alpha(GL[1], 0.5));
    }
    // Край: стеклянная кромка сверху, под ней обрыв — тень глубины.
    if (up) {
      for (let x = 0; x < 16; x++) {
        p.set(x, 0, hx('#6ac0d0'));
        p.set(x, 1, hx('#1e4c5a'));
        p.set(x, 2, hx('#12303a'));
        for (let y = 3; y < 7; y++) p.set(x, y, mixc(hx('#0a1a22'), p.get(x, y), (y - 3) / 4));
        if ((x + c.wx) % 5 === 0) p.set(x, 3, hx('#2e6a78'));
      }
    }
    if (lf) for (let y = 0; y < 16; y++) p.set(0, y, hx('#3a7a8a'));
    if (rt) for (let y = 0; y < 16; y++) p.set(15, y, hx('#16323c'));
    if (dn) for (let x = 0; x < 16; x++) p.set(x, 15, hx('#2a5a68'));
    return p;
  });
}

/** Шов хрусталя у выходов Зала призм: стекло с прожилкой будущей стены. */
function seamCell(c: CellCtx): Px {
  const v = Math.floor(hash(c.wx, c.wy, 37) * 2);
  return cellOf(`seam|${v}`, () => {
    const p = new Px(16, 16);
    p.data.set(glassFloor(v).data);
    for (let x = 0; x < 16; x++) {
      p.set(x, 8 + Math.round(Math.sin(x * 0.8 + v) * 1.2), alpha(CYAN, 0.75));
    }
    for (const x of [3, 8, 13]) {
      poly(
        p,
        [
          [x - 1, 9],
          [x, 5],
          [x + 1, 9],
        ],
        alpha(hx('#7ad0de'), 0.9),
      );
    }
    return p;
  });
}

/** Центр арены (мировые клетки) — для мозаики лучами и кольцами. */
let arenaC: [number, number] | null = null;
function arenaCenter(): [number, number] {
  if (!arenaC) arenaC = [32.5, 17];
  return arenaC;
}

/** Мозаика арены: тёмный камень, серебряные кольца и лучи к центру. */
function mosaicCell(c: CellCtx, scar: boolean): Px {
  return cellOf(`mos|${c.wx}|${c.wy}|${+scar}`, () => {
    const p = new Px(16, 16);
    const [cx, cy] = arenaCenter();
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const wx = c.wx + (x + 0.5) / 16;
        const wy = c.wy + (y + 0.5) / 16;
        const dx = wx - cx;
        const dy = (wy - cy) * 1.15;
        const r = Math.hypot(dx, dy);
        const a = Math.atan2(dy, dx);
        // Тессеры: сетка по 4 пикселя.
        const tess = x % 4 === 0 || y % 4 === 0 ? 0.82 : 1;
        let col = mixc(
          hx('#1c1a2c'),
          hx('#2a2640'),
          hash(Math.floor(x / 4), Math.floor(y / 4), c.wx * 31 + c.wy) * 0.6,
        );
        const ring = Math.abs(r - Math.round(r / 4) * 4) < 0.12 && r > 1;
        const ray = Math.abs(Math.sin(a * 6)) < 0.05 * (1 + 2 / (r + 0.5)) && r > 1.5 && r < 13;
        if (r < 1.7) {
          // Середина арены — круглое зеркало в серебряной оправе, в нём
          // восьмилучевая звезда «той стороны».
          if (r > 1.45) col = SILV[2];
          else if (r > 1.32) col = SILV[0];
          else {
            col = mixc(hx('#1c1a3e'), hx('#34306a'), 1 - r / 1.32);
            if (Math.abs(Math.sin(a * 4)) < 0.28 * (1 - r / 1.4)) col = VIO[2];
            if (r < 0.22) col = VIO[3];
          }
        } else if (ring) col = SILV[2];
        else if (ray) col = mixc(col, VIO[2], 0.7);
        p.set(x, y, [
          Math.round(col[0] * tess),
          Math.round(col[1] * tess),
          Math.round(col[2] * tess),
          255,
        ]);
      }
    if (scar) {
      // Сколы от осколков: трещины и выбоины.
      const v = Math.floor(hash(c.wx, c.wy, 41) * 3);
      stroke(p, 2 + v, 3, 9, 8 + v, hx('#07060c'));
      stroke(p, 9, 8 + v, 14, 6, hx('#07060c'));
      p.ell(9, 8 + v, 1.4, 1, hx('#07060c'));
      p.set(3 + v, 12, alpha(GL[2], 0.8));
      p.set(12, 11, alpha(WHITE, 0.7));
    }
    return p;
  });
}

/** Знак пары переходов на полу: кольцо цвета пары и насечки — поверх
 *  пола комнаты. */
function portalCell(c: CellCtx, area: Area): Px {
  const n = c.mark - MK.portal;
  const top = cellOf(`psig|${n}`, () => {
    const p = new Px(16, 16);
    const t = PORTAL_TONES[Math.max(0, Math.min(3, n - 1))];
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * TAU;
      p.set(
        Math.round(7.5 + Math.cos(a) * 6.5),
        Math.round(9 + Math.sin(a) * 4.5),
        alpha(t[2], 0.75),
      );
      if (i % 5 === 0)
        p.set(
          Math.round(7.5 + Math.cos(a) * 5),
          Math.round(9 + Math.sin(a) * 3.3),
          alpha(t[3], 0.8),
        );
    }
    return p;
  });
  return onRoom(c, area, `ps${n}`, top);
}

/** Пол под предметом и под буквами движка: узор большинства соседей. */
function underCell(c: CellCtx, area: Area): Px | null {
  return roomFloor(c, area);
}

function painterFor(area: Area) {
  return (c: CellCtx): Px | null => {
    const k = c.mark;
    if (k === MK.checker) return checkerCell(c);
    if (k === MK.carpet) return carpetCell(c, area === 'h');
    if (k === MK.shards) return shardsCell(c, area);
    if (k === MK.mirror) return mirrorCell(c, area, false);
    if (k === MK.arena) return mirrorCell(c, area, true);
    if (k === MK.cracked) {
      const arena = area === 'h' && c.wy < 32;
      return crackedCell(c, area, arena);
    }
    if (k === MK.fake) return fakeCell(c, area);
    if (k === MK.illusion) return illusionCell(c, area);
    if (k === MK.behind) return behindCell(c);
    if (k === MK.glass) return glassFloor(Math.floor(hash(c.wx, c.wy, 2) * 8));
    if (k === MK.crystal) return crystalCell(c);
    if (k === MK.void) return voidCell(c);
    if (k === MK.seam) return seamCell(c);
    if (k === MK.mosaic) return mosaicCell(c, false);
    if (k === MK.scar) return mosaicCell(c, true);
    if (k === MK.under) return underCell(c, area);
    if (k === MK.herring) return herringCell(c);
    if (k === MK.obsidian) return obsidianCell(c);
    if (k === MK.hex) return hexCell(c);
    if (k === MK.bridge) return bridgeCell(c);
    if (k === MK.rough) return roughCell(c);
    if (k === MK.plank) return plankCell(c);
    if (k > MK.portal && k <= MK.portal + 4) return portalCell(c, area);
    return null;
  };
}

registerCellPainter(F7_GALLERY, painterFor('g'));
registerCellPainter(F7_CRYSTAL, painterFor('c'));
registerCellPainter(F7_HALL, painterFor('h'));

// ---------------------------------------------------------------------------
// Метки и зоны: рождение в зеркале, рябь, дрожь рамы, нити, переходы,
// отражения героя в зеркалах, тень настоящего Отражения, вспышки, осколки.
// Рисуют готовые картинки из кеша; векторное — только простые фигуры.
// ---------------------------------------------------------------------------

export type ZoneX = (Zone | Strike) & Record<string, unknown>;
export const zk = (z: ZoneX) => {
  const warn = (z.warn as number | undefined) ?? 0;
  const life = (z as Zone).life ?? warn;
  return Math.max(0, Math.min(1, z.t / Math.max(0.01, warn || life)));
};

const zimg = new Map<string, HTMLCanvasElement>();
const zcache = (key: string, make: () => Px): HTMLCanvasElement => {
  let c = zimg.get(key);
  if (!c) {
    c = make().canvas();
    zimg.set(key, c);
  }
  return c;
};

/** Силуэт, идущий к стеклу изнутри зеркала (k 0…5): растёт и светлеет. */
function birthSil(kind: string, k: number): Px {
  const p = new Px(12, 12);
  const s = 0.45 + k * 0.11;
  const col = alpha(k >= 4 ? GL[2] : SHD[1], 0.55 + k * 0.08);
  if (kind === 'f7_prism') {
    poly(
      p,
      [
        [6, 6 - 5 * s],
        [6 + 4 * s, 6 + 4 * s],
        [6 - 4 * s, 6 + 4 * s],
      ],
      col,
    );
  } else {
    // Человек: голова, плечи, туловище.
    p.ell(6, 11 - 9 * s, 1.8 * s + 0.4, 1.8 * s + 0.4, col);
    poly(
      p,
      [
        [6 - 3.2 * s, 11 - 6.5 * s],
        [6 + 3.2 * s, 11 - 6.5 * s],
        [6 + 2.4 * s, 11.5],
        [6 - 2.4 * s, 11.5],
      ],
      col,
    );
    if (k >= 3) {
      p.set(5, Math.round(11 - 9 * s), CYAN_HOT);
      p.set(7, Math.round(11 - 9 * s), CYAN_HOT);
    }
  }
  if (k >= 4)
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      p.set(Math.round(6 + Math.cos(a) * 5), Math.round(6 + Math.sin(a) * 5), alpha(WHITE, 0.4));
    }
  return p;
}

registerZonePainter('f7_birth', (g, z0, px, py) => {
  const z = z0 as ZoneX;
  const k = Math.min(5, Math.floor(zk(z) * 6));
  const kind = (z.kind as string) ?? 'f7_echo';
  const img = zcache(`birth|${kind === 'f7_prism' ? 'p' : 'h'}|${k}`, () => birthSil(kind, k));
  g.drawImage(img, Math.round(px - 6), Math.round(py - 6));
  return true;
});

registerZonePainter('f7_ripple', (g, z0, px, py) => {
  const z = z0 as ZoneX;
  const k = Math.min(3, Math.floor(zk(z) * 4));
  const img = zcache(`ripple|${k}`, () => {
    const p = new Px(16, 16);
    for (let r = 0; r < 3; r++) {
      const rr = 1.5 + k * 1.4 + r * 2.2;
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * TAU;
        p.set(
          Math.round(7.5 + Math.cos(a) * rr),
          Math.round(7.5 + Math.sin(a) * rr * 0.8),
          alpha(CYAN_HOT, 0.6 - r * 0.18),
        );
      }
    }
    return p;
  });
  g.drawImage(img, Math.round(px - 8), Math.round(py - 8));
  return true;
});

registerZonePainter('f7_stir', (g, z0, px, py) => {
  const z = z0 as ZoneX;
  const k = Math.min(3, Math.floor(zk(z) * 4));
  const img = zcache(`stir|${k}`, () => {
    const p = new Px(20, 26);
    for (let i = 0; i < 10 + k * 5; i++) {
      const a = hash(i, k, 1) * TAU;
      const r = 3 + hash(i, k, 2) * (5 + k);
      p.set(
        Math.round(10 + Math.cos(a) * r),
        Math.round(12 + Math.sin(a) * r * 1.3),
        alpha(VIO[k > 1 ? 3 : 2], 0.7),
      );
    }
    return p;
  });
  g.drawImage(img, Math.round(px - 10), Math.round(py - 20));
  return true;
});

registerZonePainter('f7_hatch', (g, z0, px, py) => {
  const z = z0 as ZoneX;
  const k = Math.min(3, Math.floor(zk(z) * 4));
  const img = zcache(`hatch|${k}`, () => {
    const p = new Px(20, 20);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      const r = 2 + k * 2.2;
      p.set(
        Math.round(10 + Math.cos(a) * r),
        Math.round(10 + Math.sin(a) * r),
        alpha(i % 2 ? VIO[3] : WHITE, 0.8 - k * 0.15),
      );
    }
    return p;
  });
  g.drawImage(img, Math.round(px - 10), Math.round(py - 18));
  return true;
});

// Нить паука: тонкая блестящая линия, по ней бегут искры.
registerZonePainter('f7_thread', (g, z0, _px, _py, S, time) => {
  const z = z0 as ZoneX;
  const ox = _px - (z.x as number) * S;
  const oy = _py - (z.y as number) * S;
  const x0 = (z.x0 as number) * S + ox;
  const y0 = (z.y0 as number) * S + oy - 3;
  const x1 = (z.x1 as number) * S + ox;
  const y1 = (z.y1 as number) * S + oy - 3;
  const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0)));
  g.fillStyle = 'rgba(170,230,255,0.55)';
  for (let i = 0; i <= n; i++)
    g.fillRect(
      Math.round(x0 + ((x1 - x0) * i) / n),
      Math.round(y0 + ((y1 - y0) * i) / n + Math.sin(i * 0.5) * 0.4),
      1,
      1,
    );
  g.fillStyle = 'rgba(255,255,255,0.95)';
  for (let s = 0; s < 2; s++) {
    const k = (time * 0.6 + s * 0.5 + (z.id as number) * 0.13) % 1;
    g.fillRect(Math.round(x0 + (x1 - x0) * k), Math.round(y0 + (y1 - y0) * k), 1, 1);
  }
  // Тень нити на полу — чтобы читалась натянутой, а не нарисованной.
  g.fillStyle = 'rgba(0,0,0,0.25)';
  for (let i = 0; i <= n; i += 2)
    g.fillRect(
      Math.round(x0 + ((x1 - x0) * i) / n),
      Math.round(y0 + ((y1 - y0) * i) / n + 3),
      1,
      1,
    );
  return true;
});

registerZonePainter('f7_snap', (g, z0, px, py) => {
  const z = z0 as ZoneX;
  const k = zk(z);
  g.fillStyle = `rgba(220,250,255,${0.9 - k * 0.8})`;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    const r = 2 + k * 10;
    g.fillRect(Math.round(px + Math.cos(a) * r), Math.round(py - 3 + Math.sin(a) * r * 0.7), 1, 1);
  }
  return true;
});

registerZonePainter('f7_warp', (g, z0, px, py) => {
  const z = z0 as ZoneX;
  const k = Math.min(3, Math.floor(zk(z) * 4));
  const n = Math.max(1, Math.min(4, (z.pair as number) ?? 1));
  const img = zcache(`warp|${n}|${k}`, () => {
    const t = PORTAL_TONES[n - 1];
    const p = new Px(32, 36);
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * TAU;
      const r = 6 + k * 3;
      p.set(
        Math.round(16 + Math.cos(a) * r),
        Math.round(20 + Math.sin(a) * r * 0.6),
        alpha(t[3], 0.9 - k * 0.2),
      );
    }
    // Столб света над рамой.
    for (let y = 2; y < 30; y++)
      for (let x = 13; x <= 18; x++)
        p.set(x, y, alpha(t[2], (0.5 - Math.abs(x - 15.5) * 0.14) * (1 - k * 0.2)));
    return p;
  });
  g.drawImage(img, Math.round(px - 16), Math.round(py - 30));
  return true;
});

// Отражения героя в зеркалах рядом с ним: в стекле идёт его двойник.
const reflImg = new Map<string, HTMLCanvasElement | null>();
function reflectionOf(tier: number, dir: Dir4, row: number): HTMLCanvasElement | null {
  const key = `${tier}|${dir}|${row}`;
  if (reflImg.has(key)) return reflImg.get(key) ?? null;
  const src = heroPx(tier, dir, row);
  if (!src) return null;
  // Отражение в стекле — светлее героя: оно само «светится» из зеркала, иначе
  // в полутёмном зале его почти не видно (первый заход: 0,3 прозрачности).
  const q = glassify(
    src,
    ['#34466e', '#50709e', '#7aa2d0', '#b2d6f2', '#e8f8ff'].map((c) => hx(c)),
    hx('#1a2238'),
    1.2,
    0.9,
  );
  const p = fade(q, 0.9);
  const c = p.canvas();
  reflImg.set(key, c);
  return c;
}

registerZonePainter('f7_reflect', (g, z0, px, py) => {
  const z = z0 as ZoneX;
  const sim = z.sim as Sim | undefined;
  if (!sim) return true;
  const h = sim.hero;
  if (h.mode === 'dead') return true;
  const w = sim.world;
  const tier = heroGear().robe;
  const hx0 = Math.floor(h.x);
  const hy0 = Math.floor(h.y);
  // Направление отражения: в зеркале на северной стене герой смотрит «на нас».
  const f = dirOf(h.face);
  const rdir: Dir4 = f === 'up' ? 'down' : f === 'down' ? 'up' : f;
  const moving = Math.hypot(h.vx, h.vy) > 0.6;
  const row = moving ? Math.floor(h.walk / 0.36) % 4 : 0;
  const img = reflectionOf(tier, rdir, row);
  if (!img) return true;
  for (let y = hy0 - 5; y <= hy0; y++)
    for (let x = hx0 - 3; x <= hx0 + 3; x++) {
      if (x < 0 || y < 0 || x >= w.w || y >= w.h) continue;
      const k = w.mark[y * w.w + x];
      if (k !== MK.mirror && k !== MK.arena) continue;
      if (sim.tiles[y * w.w + x] !== 1) continue;
      const fy = y + 1;
      if (fy >= w.h || sim.tiles[fy * w.w + x] === 1) continue;
      // Отражение стоит у нижней кромки стекла, по x — там же, где герой.
      const dist = h.y - (y + 1);
      if (dist < 0 || dist > 5) continue;
      const cellX = px + (x - h.x) * TS;
      const cellY = py + (y - h.y) * TS;
      const sx = Math.round(px - 8);
      const sy = Math.round(cellY + 14 - 16 + Math.min(4, dist * 0.8));
      g.save();
      g.beginPath();
      g.rect(Math.round(cellX) + 2, Math.round(cellY) + 2, 12, 12);
      g.clip();
      g.globalAlpha = Math.max(0.45, 1 - dist * 0.11);
      g.drawImage(img, sx, sy);
      g.restore();
    }
  // Отставшее отражение (Коридор отражений): стоит на месте и смотрит.
  if (F7_VIEW.lagX >= 0) {
    const x = Math.floor(F7_VIEW.lagX);
    const y = F7_VIEW.lagY;
    const img2 = reflectionOf(tier, 'down', 0);
    if (img2) {
      const cellX = px + (x - h.x) * TS;
      const cellY = py + (y - h.y) * TS;
      g.save();
      g.globalAlpha = 0.95;
      g.drawImage(img2, Math.round(cellX), Math.round(cellY - 1));
      g.fillStyle = 'rgba(200,245,255,0.9)';
      g.fillRect(Math.round(cellX) + 6, Math.round(cellY) + 6, 1, 1);
      g.fillRect(Math.round(cellX) + 9, Math.round(cellY) + 6, 1, 1);
      g.restore();
    }
  }
  return true;
});

registerZonePainter('f7_flash', (g, z0, px, py, S) => {
  const z = z0 as ZoneX;
  const k = zk(z);
  g.fillStyle = `rgba(245,250,255,${0.55 * (1 - k)})`;
  g.beginPath();
  g.arc(px, py, (z.r as number) * S * (0.6 + k * 0.4), 0, TAU);
  g.fill();
  return true;
});

registerZonePainter('f7_grab', (g, z0, px, py, S) => {
  const z = z0 as ZoneX;
  const a = (z.ang as number) ?? 0;
  const len = ((z.len as number) ?? 1) * S;
  const k = zk(z);
  g.fillStyle = `rgba(40,28,70,${0.9 - k * 0.6})`;
  for (let i = 0; i < len; i += 1) {
    const w = Math.sin(i * 0.5) * 1.2;
    g.fillRect(
      Math.round(px + Math.cos(a) * i - Math.sin(a) * w),
      Math.round(py - 6 + Math.sin(a) * i + Math.cos(a) * w),
      2,
      2,
    );
  }
  g.fillStyle = 'rgba(160,140,230,0.9)';
  g.fillRect(Math.round(px + Math.cos(a) * len), Math.round(py - 6 + Math.sin(a) * len), 2, 2);
  return true;
});

registerZonePainter('f7_ring', (g, z0, px, py, S) => {
  const z = z0 as ZoneX;
  const k = zk(z);
  g.strokeStyle = `rgba(160,230,255,${0.4 + 0.5 * k})`;
  g.lineWidth = 1;
  g.beginPath();
  g.arc(px, py, (z.r as number) * S * (0.4 + 0.6 * k), 0, TAU);
  g.stroke();
  return true;
});

/** Кадры разлёта стекла (для осколков, лопнувших копий и голема). */
function burstPx(k: number): Px {
  const p = new Px(40, 40);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU + hash(i, 1) * 0.4;
    const r = 3 + k * 4 + hash(i, 2) * 4;
    const x = 20 + Math.cos(a) * r;
    const y = 20 + Math.sin(a) * r * 0.8;
    const s = 1.2 - k * 0.2;
    poly(
      p,
      [
        [x, y - s * 1.5],
        [x + s, y + s],
        [x - s, y + s * 0.6],
      ],
      alpha(i % 3 ? GL[3] : SILV[3], 1 - k * 0.22),
    );
  }
  return p;
}

registerZonePainter('f7_shatter', (g, z0, px, py) => {
  const z = z0 as ZoneX;
  const k = Math.min(3, Math.floor(zk(z) * 4));
  g.drawImage(
    zcache(`burst|${k}`, () => burstPx(k)),
    Math.round(px - 20),
    Math.round(py - 24),
  );
  return true;
});

registerZonePainter('f7_rise', (g, z0, px, py) => {
  const z = z0 as ZoneX;
  const k = Math.min(3, Math.floor(zk(z) * 4));
  const img = zcache(`rise|${k}`, () => {
    // Осколки стягиваются в фигуру (обратный разлёт).
    const p = burstPx(3 - k);
    const q = new Px(p.w, p.h);
    q.data.set(p.data);
    q.ell(20, 22 - k * 2, 2 + k, 1 + k * 1.4, alpha(SHD[1], 0.3 + k * 0.15));
    return q;
  });
  g.drawImage(img, Math.round(px - 20), Math.round(py - 26));
  return true;
});

registerZonePainter('f7_grow', (g, z0, px, py) => {
  const z = z0 as ZoneX;
  const k = Math.min(3, Math.floor(zk(z) * 4));
  const img = zcache(`grow|${k}`, () => {
    const p = new Px(16, 22);
    for (let i = 0; i < 3; i++) {
      const x = 3 + i * 5;
      const h = 3 + k * (3 + i);
      poly(
        p,
        [
          [x - 2, 21],
          [x, 21 - h],
          [x + 2, 21],
        ],
        (xx) => (xx < x ? hx('#9aeaff') : hx('#3a8a9a')),
      );
    }
    return p;
  });
  g.drawImage(img, Math.round(px - 8), Math.round(py - 14));
  return true;
});

// Осколки, лежащие на полу (замедляют, режут): рассыпь из кеша по зоне.
registerZonePainter('f7_shardfloor', (g, z0, px, py, S) => {
  const z = z0 as ZoneX;
  const r = (z.r as number) * S;
  const life = (z as Zone).life;
  const fadeK = Math.max(0, Math.min(1, (life - z.t) / 1.5));
  const v = (z.id as number) % 4;
  const img = zcache(`sfloor|${v}|${Math.round(r)}`, () => {
    const n = Math.round(r * 2 + 2);
    const p = new Px(n, n);
    for (let i = 0; i < r * 1.6; i++) {
      const a = hash(i, v, 5) * TAU;
      const d = Math.sqrt(hash(i, v, 6)) * r;
      const x = n / 2 + Math.cos(a) * d;
      const y = n / 2 + Math.sin(a) * d * 0.8;
      poly(
        p,
        [
          [x, y - 1.6],
          [x + 1.3, y + 0.8],
          [x - 1.1, y + 0.9],
        ],
        i % 3 ? alpha(GL[2], 0.9) : alpha(SILV[3], 0.9),
      );
    }
    return p;
  });
  g.globalAlpha = fadeK;
  g.drawImage(img, Math.round(px - img.width / 2), Math.round(py - img.height / 2));
  g.globalAlpha = 1;
  return true;
});

// Луч призмы: пока наливается — тонкая дрожащая черта, к концу толще и белее.
registerZonePainter('f7_beam', (g, z0, px, py, S) => {
  const z = z0 as ZoneX;
  const k = zk(z);
  const a = (z.ang as number) ?? 0;
  const len = (z.r as number) * S;
  g.save();
  g.translate(px, py - 4);
  g.rotate(a);
  g.fillStyle = `rgba(255,70,90,${0.12 + 0.2 * k})`;
  const hw = ((z.w as number) ?? 0.3) * S;
  g.fillRect(0, -hw, len, hw * 2);
  const th = k > 0.75 ? 2 : 1;
  for (let i = 0; i < len; i += 2) {
    const c = RAINBOW[Math.floor(i / 4) % RAINBOW.length];
    g.fillStyle = k > 0.8 ? 'rgba(255,255,255,0.95)' : css(c, 0.5 + 0.4 * k);
    g.fillRect(i, -th / 2 + (k < 0.8 ? Math.sin(i * 0.7 + k * 30) * 0.5 : 0), 2, th);
  }
  g.restore();
  return true;
});

// ---------------------------------------------------------------------------
// Снаряд: осколок стекла, вращается кадрами.
// ---------------------------------------------------------------------------

const shotSprites = new Map<string, Sprite>();
registerShotPainter('f7_shard', (s, time) => {
  const f = Math.floor(time * 16 + s.id) % 4;
  let sp = shotSprites.get(`shard|${f}`);
  if (!sp) {
    const p = new Px(9, 9);
    const a = (f / 4) * Math.PI;
    poly(
      p,
      [
        [4.5 + Math.cos(a) * 3.6, 4.5 + Math.sin(a) * 3.6],
        [4.5 + Math.cos(a + 2.4) * 2, 4.5 + Math.sin(a + 2.4) * 2],
        [4.5 + Math.cos(a + 3.9) * 2, 4.5 + Math.sin(a + 3.9) * 2],
      ],
      GL[2],
    );
    p.set(4, 4, WHITE);
    p.outline(alpha(INK, 0.8));
    sp = { img: p.canvas(), ax: 4, ay: 6 };
    shotSprites.set(`shard|${f}`, sp);
  }
  return sp;
});

// ---------------------------------------------------------------------------
// Иконки вещей 10×10.
// ---------------------------------------------------------------------------

registerItemArt('f7mat', () => {
  // Зеркальный осколок: треугольник стекла с серебряной изнанкой.
  const p = new Px(10, 10);
  poly(
    p,
    [
      [1, 8],
      [5, 1],
      [9, 7],
    ],
    (x, y) => (x + y < 9 ? SILV[3] : SILV[2]),
  );
  poly(
    p,
    [
      [2, 8],
      [5, 3],
      [8, 7],
    ],
    GL[1],
  );
  stroke(p, 4, 4, 3, 6, WHITE);
  p.outline(INK);
  return p;
});

registerItemArt('f7_amalgam', () => {
  // Амальгама: капля жидкого серебра с отражением.
  const p = new Px(10, 10);
  shadeEll(p, 5, 6, 3.4, 3, SILV, 0.1);
  poly(
    p,
    [
      [3, 5],
      [5, 1],
      [7, 5],
    ],
    SILV[2],
  );
  p.set(4, 5, WHITE);
  p.set(6, 7, VIO[2]);
  p.outline(INK);
  return p;
});

registerItemArt('f7_core', () => {
  // Ядро призмы: огранённый кристалл, внутри радуга.
  const p = new Px(10, 10);
  poly(
    p,
    [
      [5, 0],
      [9, 5],
      [5, 9],
      [1, 5],
    ],
    (x) => (x < 5 ? VIO[2] : VIO[1]),
  );
  for (let y = 2; y < 8; y++) p.set(5, y, RAINBOW[y % RAINBOW.length]);
  p.set(3, 3, WHITE);
  p.outline(INK);
  return p;
});

registerItemArt('f7_wing', () => {
  const p = new Px(10, 10);
  mothWing(
    p,
    [
      [1, 8],
      [4, 1],
      [9, 2],
      [7, 8],
    ],
    0,
  );
  p.outline(INK);
  return p;
});

registerItemArt('f7_visage', () => {
  // Лик Отражения: стеклянная маска-шлем с трещиной и светящимися прорезями.
  const p = new Px(10, 10);
  shadeEll(p, 5, 5, 4, 4.4, [hx('#2a3470'), hx('#4664a8'), hx('#7aa4da'), hx('#e0f4ff')], 0.1);
  stroke(p, 2, 4, 8, 4, INK);
  p.set(3, 4, CYAN_HOT);
  p.set(7, 4, CYAN_HOT);
  stroke(p, 6, 1, 4, 5, hx('#0a0c1c'));
  stroke(p, 4, 5, 5, 8, hx('#0a0c1c'));
  p.set(5, 2, WHITE);
  p.outline(INK);
  return p;
});

registerItemArt('f7_nectar', () => {
  // Зеркальный нектар: склянка с золотистым светом.
  const p = new Px(10, 10);
  shadeEll(p, 5, 6.5, 3.2, 3, GL, 0.2);
  p.ell(5, 7, 2.2, 1.8, hx('#f0d070'));
  limb(p, 5, 3.5, 5, 1.5, 1, 1, SILV);
  p.set(4, 6, WHITE);
  p.outline(INK);
  return p;
});

registerItemArt('f7_jelly', () => {
  // Паучий студень: дрожащий розовый ком на осколке-блюдце, внутри — два
  // стеклянных зёрнышка, сверху блик. Прошлый — плоский кубик.
  const p = new Px(10, 10);
  poly(
    p,
    [
      [0.5, 8.5],
      [9.5, 8.5],
      [8, 9.8],
      [2, 9.8],
    ],
    GL[1],
  );
  const pink: Tones = [hx('#a83c62'), hx('#e0708e'), hx('#ffa8c0'), hx('#ffe2ea')];
  shadeEll(p, 5, 5.8, 3.8, 3.2, pink);
  p.set(3, 8, pink[1]);
  p.set(7, 8, pink[0]);
  p.set(4, 6, alpha(GL[3], 0.9));
  p.set(6, 5, alpha(GL[2], 0.9));
  p.set(3, 4, WHITE);
  p.outline(INK);
  return p;
});
