// Этаж 8 «Бесконечный замок» — рисовальщики: клетки трёх районов, реквизит,
// монстры и Демон семи лун, метки ударов, снаряды, иконки вещей.
//
// Всё рисует код, 16 пикселей на клетку, свет сверху-слева, контур тёмный.
// Палитра — ступени камня 0x72 (тени, обводка, кромки) плюс материалы
// замка: тёмное лаковое дерево, штукатурка и бумага сёдзи, татами; два
// акцента — красный лак перил и лунное золото. Насыщенное — только акцент.
//
// Клетки собираются в кусок карты один раз (анимировать в них нельзя) —
// живое (огонь, дым, качание фонарей, двери, облака на луне) — предметами
// и метками. Кадры монстров и предметов — из кеша: ключ — вид, поза, кадр,
// сторона, вспышка, облик.

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
import { F8_HALLS, F8_LOWER, F8_MARK, F8_MOON } from './f8';
import { doorOpen, F8_CLOCK } from './f8-brains';

type RGBA = [number, number, number, number];
type V = [number, number];

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
const darker = (c: RGBA, k: number): RGBA => mixc(c, [8, 6, 10, c[3]], k);
const lighter = (c: RGBA, k: number): RGBA => mixc(c, [255, 250, 235, c[3]], k);

const M = F8_MARK;
const TS = 16;
/** Середина логова в мировых клетках (Зал луны — верхний район, его верх — ряд 0). */
const ARENA_C: [number, number] = [32.5, 29];
export const TAU = Math.PI * 2;

/** Обводка — та же, что у всего подземелья. */
const INK = hx('#150f0b');
const INK2 = hx('#222222');
const WHITE = hx('#ffffff');
const GOLD = hx('#ffcc40');

/** Четыре тона материала: тень, основа, свет, блик. */
type Tones = [RGBA, RGBA, RGBA, RGBA];
const tones = (a: string, b: string, c: string, d: string): Tones => [hx(a), hx(b), hx(c), hx(d)];

// Материалы замка.
const WOOD: Tones = tones('#241210', '#3e2016', '#5e321f', '#8a5230');
/** Пол: лакированная доска — теплее и светлее дерева стен. */
const FLOORW: Tones = tones('#2a170e', '#5a3620', '#7a4c2a', '#b88452');
const LACQ: Tones = tones('#140c0e', '#24161a', '#3a2226', '#6a4448');
const RED: Tones = tones('#4a0e10', '#8a1a18', '#c0302a', '#f06a4a');
const PLASTER: Tones = tones('#8e8676', '#b8ae98', '#d8cfb8', '#efe8d6');
const PAPER: Tones = tones('#b09c70', '#d8c690', '#f0e2b0', '#fff6d8');
const TATAMI: Tones = tones('#5e5a2c', '#7a7438', '#948c48', '#b0a660');
const HERI: Tones = tones('#10160f', '#1c2a1e', '#2e4230', '#4a6448');
const GILT: Tones = tones('#7a5418', '#b8862e', '#e8b84a', '#fff0a0');
const MOONC: Tones = tones('#3a4270', '#6a78b8', '#b0c0f0', '#eef2ff');
const STONE: Tones = tones('#2e2626', '#483b3a', '#775c55', '#aa8d7a');

const LX = -0.45;
const LY = -0.72;
const LZ = 0.52;
const toneOf = (t: Tones, l: number): RGBA =>
  l > 0.78 ? t[3] : l > 0.42 ? t[2] : l > 0.02 ? t[1] : t[0];

/** Детерминированный шум по числам, 0…1. */
const hash = (a: number, b: number, c = 0) => {
  let h = (a * 374761393 + b * 668265263 + c * 1274126177) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

// ---------------------------------------------------------------------------
// Растеризация.
// ---------------------------------------------------------------------------

/** Овал с объёмом: цвет по нормали. */
function shadeEll(p: Px, cx: number, cy: number, rx: number, ry: number, t: Tones, bias = 0): void {
  if (rx <= 0 || ry <= 0) return;
  p.ell(cx, cy, rx, ry, (x, y) => {
    const dx = (x + 0.5 - cx) / rx;
    const dy = (y + 0.5 - cy) / ry;
    const nz = Math.sqrt(Math.max(0, 1 - dx * dx - dy * dy));
    return toneOf(t, dx * LX + dy * LY + nz * LZ + bias);
  });
}

/** Капсула от (x0, y0) до (x1, y1): свет по нормали. */
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
      p.set(x, y, toneOf(t, nx * LX + ny * LY + nz * LZ + bias));
    }
}

/** Многоугольник заливкой (чётно-нечётно). */
function poly(p: Px, pts: V[], c: RGBA | ((x: number, y: number) => RGBA | null)): void {
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
      if (col) p.set(x, y, col);
    }
}

/** Тонированный многоугольник: свет по высоте и краю (ткань, лак). */
function shadePoly(p: Px, pts: V[], t: Tones, lightLeft = true): void {
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
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);
  poly(p, pts, (x, y) => {
    const u = (x + 0.5 - minX) / w;
    const v = (y + 0.5 - minY) / h;
    const l = (lightLeft ? 1 - u : u) * 0.55 + (1 - v) * 0.35;
    return l > 0.7 ? t[2] : l > 0.32 ? t[1] : t[0];
  });
}

/** Линия толщины `w`. */
export function stroke(p: Px, x0: number, y0: number, x1: number, y1: number, c: RGBA, w = 1): void {
  const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2) + 1;
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    const y = y0 + ((y1 - y0) * i) / n;
    if (w <= 1) p.set(Math.floor(x), Math.floor(y), c);
    else p.ell(x, y, w / 2, w / 2, c);
  }
}

function clear(p: Px, x: number, y: number): void {
  if (x < 0 || y < 0 || x >= p.w || y >= p.h) return;
  p.data[(y * p.w + x) * 4 + 3] = 0;
}

// ---------------------------------------------------------------------------
// Клетки: пол.
// ---------------------------------------------------------------------------

/** Тон района: Залы — холоднее, Зал луны — в лунном свете. */
function areaShift(c: RGBA, area: string): RGBA {
  if (area === F8_HALLS) return mixc(c, hx('#4a3a78', c[3]), 0.12);
  if (area === F8_MOON) return mixc(c, hx('#3a4a8a', c[3]), 0.16);
  return c;
}
const areaTones = (t: Tones, area: string): Tones => t.map((c) => areaShift(c, area)) as Tones;

/**
 * Татами: плетёнка «корзинкой» — в квадрате 2×2 клеток два мата, в
 * соседнем квадрате — повёрнутые. Мат — 16×32: кайма (хэри) по длинным
 * сторонам, частое плетение поперёк, стык на коротких.
 */
function tatami(wx: number, wy: number, area: string, tone = TATAMI): Px {
  const p = new Px(TS, TS);
  const t = areaTones(tone, area);
  const heri = areaTones(HERI, area);
  const bx = Math.floor(wx / 2);
  const by = Math.floor(wy / 2);
  const horiz = (bx + by) % 2 === 0;
  // Выцветание мата: чуть разный тон у каждого.
  const matId = horiz ? `${bx}:${wy}` : `${wx}:${by}`;
  const fade = hash(bx * 7 + (horiz ? wy : wx), by * 5 + (horiz ? 1 : 2), 11);
  const base = fade > 0.7 ? t[2] : fade < 0.2 ? mixc(t[1], t[0], 0.3) : t[1];
  void matId;
  p.rect(0, 0, TS - 1, TS - 1, base);
  // Плетение: полосы поперёк длины мата.
  for (let i = 0; i < TS; i++) {
    const on = i % 2 === 0;
    for (let j = 0; j < TS; j++) {
      const x = horiz ? i : j;
      const y = horiz ? j : i;
      if (on && (j + (horiz ? wy : wx)) % 3 === 0) p.set(x, y, mixc(base, t[0], 0.35));
      else if (!on && (j + i) % 5 === 0) p.set(x, y, mixc(base, t[2], 0.45));
    }
  }
  if (horiz) {
    // Длинные стороны — сверху и снизу клетки: кайма.
    p.rect(0, 0, TS - 1, 1, heri[1]);
    p.rect(0, 0, TS - 1, 0, heri[2]);
    p.rect(0, TS - 2, TS - 1, TS - 1, heri[1]);
    p.rect(0, TS - 1, TS - 1, TS - 1, heri[0]);
    // Узор каймы — редкие точки.
    for (let x = 1; x < TS; x += 4) {
      p.set(x, 1, heri[3]);
      p.set(x + 2, TS - 2, heri[2]);
    }
    // Короткая сторона мата — стык.
    if (wx % 2 === 0) for (let y = 2; y < TS - 2; y++) p.set(0, y, t[0]);
    else for (let y = 2; y < TS - 2; y++) p.set(TS - 1, y, mixc(t[0], base, 0.4));
  } else {
    p.rect(0, 0, 1, TS - 1, heri[1]);
    p.rect(0, 0, 0, TS - 1, heri[2]);
    p.rect(TS - 2, 0, TS - 1, TS - 1, heri[1]);
    p.rect(TS - 1, 0, TS - 1, TS - 1, heri[0]);
    for (let y = 1; y < TS; y += 4) {
      p.set(1, y, heri[3]);
      p.set(TS - 2, y + 2, heri[2]);
    }
    if (wy % 2 === 0) for (let x = 2; x < TS - 2; x++) p.set(x, 0, t[0]);
    else for (let x = 2; x < TS - 2; x++) p.set(x, TS - 1, mixc(t[0], base, 0.4));
  }
  return p;
}

/** Потёртость, кровь, копоть, следы меча — поверх татами. */
function wear(p: Px, wx: number, wy: number, kind: number): void {
  const r = (i: number) => hash(wx, wy, 40 + i);
  if (kind === M.blood) {
    const blood = [hx('#5a0e10'), hx('#7a1614'), hx('#9a2418')];
    const cx = 4 + r(1) * 8;
    const cy = 4 + r(2) * 8;
    p.ell(cx, cy, 3 + r(3) * 2, 2 + r(4) * 1.5, blood[1]);
    p.ell(cx - 0.8, cy - 0.6, 1.6, 1, blood[2]);
    for (let i = 0; i < 6; i++) {
      const a = r(10 + i) * TAU;
      const d = 3 + r(20 + i) * 4;
      p.set(Math.round(cx + Math.cos(a) * d), Math.round(cy + Math.sin(a) * d * 0.7), blood[0]);
    }
    return;
  }
  if (kind === M.scorch) {
    for (let y = 0; y < TS; y++)
      for (let x = 0; x < TS; x++) {
        const d = Math.hypot(x - 8 - (r(1) - 0.5) * 6, (y - 8 - (r(2) - 0.5) * 6) * 1.2);
        const k = 1 - d / 8;
        if (k <= 0) continue;
        const c = p.get(x, y);
        p.set(x, y, mixc(c, hx('#140c08'), Math.min(0.85, k * 1.1)));
        if (k > 0.55 && (x + y * 3) % 7 === 0) p.set(x, y, hx('#3a1a0a'));
      }
    return;
  }
  if (kind === M.cut) {
    // Два-три удара мечом: светлая сечка в плетении, края тёмные.
    const n = 2 + Math.floor(r(1) * 2);
    for (let i = 0; i < n; i++) {
      const a = -0.6 + r(3 + i) * 1.2;
      const cx = 3 + r(6 + i) * 10;
      const cy = 3 + r(9 + i) * 10;
      const L = 5 + r(12 + i) * 4;
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      stroke(p, cx - ux * L, cy - uy * L + 1, cx + ux * L, cy + uy * L + 1, hx('#3a3418'));
      stroke(p, cx - ux * L, cy - uy * L, cx + ux * L, cy + uy * L, hx('#d8cc88'));
    }
  }
}

/** Доски энгавы: вдоль (`h`) или поперёк; лак с узким бликом. */
function planks(wx: number, wy: number, horiz: boolean, area: string, tone = FLOORW): Px {
  const p = new Px(TS, TS);
  const t = areaTones(tone, area);
  // Доска — 4 пикселя; стык доски по длине — от мировых координат. Швы
  // тонкие и мягкие: тёмный шов на каждой доске превращал пол в кладку.
  for (let j = 0; j < 4; j++) {
    const lane = (horiz ? wy : wx) * 4 + j;
    const v = hash(lane, 7, 3);
    const col = v > 0.7 ? mixc(t[1], t[2], 0.55) : v > 0.3 ? t[1] : mixc(t[1], t[0], 0.22);
    const seam = Math.floor(hash(lane, 9, 5) * 64);
    const ph = hash(lane, 11, 2) * TAU;
    for (let i = 0; i < TS; i++) {
      const along = (horiz ? wx : wy) * TS + i;
      // Волокно: тонкая волна по доске.
      const g = Math.round(1.5 + Math.sin(along * 0.19 + ph) * 1.2);
      for (let k = 0; k < 4; k++) {
        const x = horiz ? i : j * 4 + k;
        const y = horiz ? j * 4 + k : i;
        let c = col;
        if (k === 3) c = mixc(col, t[0], 0.62);
        else if (k === 0) c = mixc(col, t[2], 0.28);
        else if (k === g && (along + lane * 5) % 9 < 5) c = mixc(col, t[0], 0.28);
        const m = (along + seam) % 64;
        if (m === 0 && k < 3) c = mixc(col, t[0], 0.7);
        if ((m === 3 || m === 61) && k === 1) c = mixc(col, hx('#1a1210'), 0.55);
        p.set(x, y, c);
      }
    }
    // Сучок — изредка.
    if (hash(lane, Math.floor(((horiz ? wx : wy) * TS) / 32), 17) > 0.93) {
      const a = 4 + Math.floor(hash(lane, 3, 19) * 8);
      const x = horiz ? a : j * 4 + 1;
      const y = horiz ? j * 4 + 1 : a;
      p.set(x, y, mixc(col, t[0], 0.7));
      p.set(horiz ? x + 1 : x + 1, horiz ? y : y + 1, mixc(col, t[0], 0.45));
    }
  }
  // Лак: широкая мягкая полоса отражения фонарей — по мировым координатам.
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const d = (((wx * TS + x) * 2 + (wy * TS + y)) % 71) - 35;
      const a = Math.abs(d);
      if (a < 4) p.set(x, y, mixc(p.get(x, y), t[3], a < 1.5 ? 0.3 : 0.14));
    }
  return p;
}

/**
 * Потолок «кэссон» (гo-тэндзё): решётка чёрных балок с золотыми
 * накладками на пересечениях, в каждой клетке — расписная панель
 * (зелёная или киноварная по шахматке) с золотым цветком.
 */
function ceiling(wx: number, wy: number, area: string): Px {
  const p = new Px(TS, TS);
  const beam = areaTones(LACQ, area);
  const g = areaTones(GILT, area);
  const green = (wx + wy) % 2 === 0;
  const panel = areaTones(
    green
      ? tones('#12241e', '#1e3a30', '#2e5444', '#4a7a60')
      : tones('#3a1410', '#5a2018', '#7a3022', '#a04a30'),
    area,
  );
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      let c: RGBA;
      if (x < 2 || y < 2) c = x === 0 || y === 0 ? beam[2] : beam[1];
      else if (x === 2 || y === 2) c = panel[0];
      else if (x === TS - 1 || y === TS - 1) c = panel[2];
      else c = hash(wx * TS + x, wy * TS + y, 5) > 0.93 ? panel[2] : panel[1];
      p.set(x, y, c);
    }
  // Золотая накладка на пересечении балок.
  p.rect(0, 0, 2, 2, g[1]);
  p.set(0, 0, g[3]);
  p.set(1, 1, g[2]);
  // Кайма панели и цветок: четыре лепестка, сердцевина.
  for (let i = 5; i <= 11; i++) {
    p.set(i, 5, mixc(panel[1], g[0], 0.6));
    p.set(i, 11, mixc(panel[1], g[0], 0.6));
    p.set(5, i, mixc(panel[1], g[0], 0.6));
    p.set(11, i, mixc(panel[1], g[0], 0.6));
  }
  const fl: [number, number, RGBA][] = [
    [8, 7, g[2]],
    [7, 8, g[2]],
    [9, 8, g[1]],
    [8, 9, g[1]],
    [8, 8, g[3]],
    [8, 6, g[1]],
    [6, 8, g[1]],
    [10, 8, g[0]],
    [8, 10, g[0]],
    [7, 7, g[0]],
    [9, 9, g[0]],
  ];
  for (const [x, y, c] of fl) p.set(x, y, c);
  return p;
}

/** Лаковый пол арены: чёрное дерево, тонкие золотые жилы, лунные блики. */
function moonFloor(wx: number, wy: number, kind: number): Px {
  const p = new Px(TS, TS);
  const t = LACQ;
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      // Широкие доски по 8 пикселей поперёк, стык со смещением.
      const board = Math.floor((wx * TS + x) / 8);
      const v = hash(board, 3, 1);
      let c = v > 0.6 ? t[2] : t[1];
      if ((wx * TS + x) % 8 === 0) c = t[0];
      const off = Math.floor(hash(board, 5, 2) * 32);
      if ((wy * TS + y + off) % 32 === 0) c = t[0];
      p.set(x, y, c);
    }
  // Золотая инкрустация: кольца вокруг середины логова (среднее — орбита,
  // по которой в финале кружат семь лун) и лучи между внутренними.
  const g = GILT;
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = wx * TS + x + 0.5 - ARENA_C[0] * TS;
      const Y = wy * TS + y + 0.5 - ARENA_C[1] * TS;
      const d = Math.hypot(X, Y) / TS;
      for (const R of [4, 7.5, 11]) {
        const e = Math.abs(d - R) * TS;
        if (e < 0.6) p.set(x, y, Math.floor(Math.atan2(Y, X) * 40) & 3 ? g[1] : g[2]);
        else if (e < 1.4 && Y > 0) p.set(x, y, mixc(p.get(x, y), g[0], 0.35));
      }
      // Двенадцать лучей между внутренним и средним кольцом.
      const a = (Math.atan2(Y, X) / (Math.PI * 2)) * 12;
      if (d > 4.3 && d < 7.2 && Math.abs(a - Math.round(a)) * d * 0.52 * TS < 0.5)
        p.set(x, y, mixc(p.get(x, y), g[1], 0.6));
    }
  // Лунный блик — длинная холодная полоса.
  for (let i = 0; i < TS; i++) {
    const y = (i + wx * 3 + wy * 11) % 29;
    if (y < TS) {
      const c = p.get(i, y);
      p.set(i, y, mixc(c, MOONC[2], 0.22));
    }
  }
  if (kind === M.moonPit) {
    // Волосяные трещины — пол здесь держится на честном слове.
    const r = (i: number) => hash(wx, wy, 70 + i);
    let x = 2 + r(1) * 12;
    let y = 0;
    while (y < TS) {
      p.set(Math.floor(x), y, hx('#07050a'));
      if (r(y + 3) > 0.7) p.set(Math.floor(x) + 1, y, hx('#2a2440'));
      x += (r(y + 20) - 0.5) * 2;
      y += 1;
    }
  }
  if (kind === M.moonScreen) {
    // Паз под ширму: две латунные полосы.
    for (let x = 0; x < TS; x++) {
      p.set(x, 6, g[0]);
      p.set(x, 9, g[0]);
    }
  }
  return p;
}

/** Красные лаковые перила вдоль края пропасти — на клетке пола. */
function railing(p: Px, side: 'n' | 's' | 'w' | 'e', wx: number, wy: number): void {
  const r = RED;
  if (side === 's' || side === 'n') {
    const y = side === 's' ? TS - 4 : 1;
    for (let x = 0; x < TS; x++) {
      p.set(x, y, r[3]);
      p.set(x, y + 1, r[2]);
      p.set(x, y + 2, r[0]);
    }
    for (let x = 0; x < TS; x++) {
      if ((wx * TS + x) % 8 !== 3) continue;
      // Столбик с золотым навершием.
      p.rect(x, y - 2, x + 1, y + 3, r[1]);
      p.set(x, y - 2, GILT[2]);
      p.set(x + 1, y - 2, GILT[1]);
      p.set(x + 1, y + 3, r[0]);
    }
  } else {
    const x = side === 'e' ? TS - 3 : 1;
    for (let y = 0; y < TS; y++) {
      p.set(x, y, r[2]);
      p.set(x + 1, y, r[0]);
    }
    for (let y = 0; y < TS; y++) {
      if ((wy * TS + y) % 8 !== 3) continue;
      p.rect(x - 1, y, x + 2, y + 1, r[1]);
      p.set(x - 1, y, GILT[2]);
    }
  }
}

const isDeepMark = (k: number) => k === M.abyss || k === M.abyssMoon;

/** Перила по сторонам, где соседняя клетка — пропасть. */
function railsAround(p: Px, c: CellCtx): void {
  if (isDeepMark(c.markAt(0, 1))) railing(p, 's', c.wx, c.wy);
  if (isDeepMark(c.markAt(0, -1))) railing(p, 'n', c.wx, c.wy);
  if (isDeepMark(c.markAt(-1, 0))) railing(p, 'w', c.wx, c.wy);
  if (isDeepMark(c.markAt(1, 0))) railing(p, 'e', c.wx, c.wy);
}

/** Мост: доски поперёк хода, по краям — перила над пропастью. */
function bridge(c: CellCtx, area: string, fall: boolean): Px {
  const vert = isDeepMark(c.markAt(-1, 0)) || isDeepMark(c.markAt(1, 0));
  const p = planks(
    c.wx,
    c.wy,
    vert,
    area,
    fall ? tones('#2a1812', '#48281a', '#6a3e26', '#8a5a36') : WOOD,
  );
  if (fall) {
    // Доски старые: щели между ними, одна просела.
    const r = hash(c.wx, c.wy, 5);
    for (let i = 0; i < TS; i++)
      if (vert) p.set(i, Math.floor(r * 12) + 2, hx('#07050a'));
      else p.set(Math.floor(r * 12) + 2, i, hx('#07050a'));
  }
  railsAround(p, c);
  return p;
}

/** Пропасть между этажами замка: далеко внизу — чужие покои и огни. */
function abyss(c: CellCtx, area: string, moon: boolean): Px {
  const p = new Px(TS, TS);
  const deep = moon ? hx('#0a0c1c') : hx('#07060c');
  const mist = moon ? hx('#1c2446') : hx('#110e1c');
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const n = hash(Math.floor((c.wx * TS + x) / 4), Math.floor((c.wy * TS + y) / 4), 3);
      p.set(x, y, n > 0.82 ? mixc(deep, mist, 0.6) : n > 0.5 ? mixc(deep, mist, 0.25) : deep);
    }
  // Внизу — балки и крошечные комнаты другого этажа замка.
  const r = (i: number) => hash(c.wx, c.wy, 90 + i);
  if (r(1) > 0.72) {
    const x = Math.floor(r(2) * 12);
    for (let y = 0; y < TS; y++) p.set(x, y, mixc(deep, hx('#3a2418'), 0.45));
    p.set(x + 1, Math.floor(r(3) * 16), mixc(deep, hx('#5a3a24'), 0.5));
  }
  if (r(4) > 0.8) {
    const x = 2 + Math.floor(r(5) * 9);
    const y = 2 + Math.floor(r(6) * 9);
    p.rect(x, y, x + 3, y + 2, mixc(deep, hx('#5a5428'), 0.35));
    p.rect(x, y, x + 3, y, mixc(deep, hx('#1c2a1e'), 0.6));
  }
  if (r(7) > 0.86) {
    // Огонёк далёкого фонаря.
    const x = 1 + Math.floor(r(8) * 13);
    const y = 1 + Math.floor(r(9) * 13);
    p.set(x, y, hx('#ffb040'));
    p.set(x + 1, y, hx('#8a4a18'));
    p.set(x, y + 1, hx('#6a3a14'));
  }
  if (moon && r(10) > 0.6) {
    // Лунная дымка: светлые клочья.
    const x = Math.floor(r(11) * 14);
    const y = Math.floor(r(12) * 14);
    for (let i = 0; i < 4; i++) p.set(x + i, y + (i >> 1), alpha(MOONC[1], 0.4));
  }
  // Край пола сверху: толщина перекрытия — тёмное дерево, светлая кромка.
  if (!isDeepMark(c.markAt(0, -1)) && c.markAt(0, -1) !== M.bridgeFall) {
    const w = WOOD;
    p.rect(0, 0, TS - 1, 0, w[3]);
    p.rect(0, 1, TS - 1, 3, w[1]);
    p.rect(0, 4, TS - 1, 4, w[0]);
    for (let x = 1; x < TS; x += 5) p.set(x, 2, w[0]);
    // Подпорки уходят вниз.
    for (let x = 0; x < TS; x++)
      if ((c.wx * TS + x) % 12 === 5)
        for (let y = 5; y < 13; y++) p.set(x, y, mixc(w[0], deep, (y - 5) / 9));
  }
  void area;
  return p;
}

// ---------------------------------------------------------------------------
// Клетки: стены.
// ---------------------------------------------------------------------------

/** Верх стены (стена к нам спиной): тёмная кровля перекрытий. */
function wallTop(c: CellCtx, capTone: Tones): Px {
  const p = new Px(TS, TS);
  const dark = hx('#1b1516');
  p.rect(0, 0, TS - 1, TS - 1, dark);
  // Редкие доски перекрытия — массив читается деревом, а не камнем.
  for (let y = 0; y < TS; y++)
    if ((c.wy * TS + y) % 6 === 0) for (let x = 0; x < TS; x++) p.set(x, y, hx('#221a1b'));
  const t = capTone;
  const oU = c.open(0, -1);
  const oL = c.open(-1, 0);
  const oR = c.open(1, 0);
  const faceD = !c.open(0, 1) && c.open(0, 2);
  // Кромка у пола сверху: брус, светлый край к полу.
  if (oU) {
    p.rect(0, 0, TS - 1, 0, t[3]);
    p.rect(0, 1, TS - 1, 2, t[2]);
    p.rect(0, 3, TS - 1, 3, INK);
  }
  // Кромка над лицом стены снизу: торец балки.
  if (faceD) {
    p.rect(0, TS - 4, TS - 1, TS - 4, INK);
    p.rect(0, TS - 3, TS - 1, TS - 2, t[1]);
    p.rect(0, TS - 1, TS - 1, TS - 1, t[3]);
    for (let x = 0; x < TS; x++) if ((c.wx * TS + x) % 7 === 2) p.set(x, TS - 2, t[0]);
  }
  if (oL || (!c.open(-1, 0) && c.open(-1, 1) && !faceD && c.open(0, 1) === false && false)) {
    p.rect(0, 0, 0, TS - 1, INK);
    p.rect(1, 0, 2, TS - 1, t[2]);
    p.rect(3, 0, 3, TS - 1, t[0]);
  }
  if (oR) {
    p.rect(TS - 1, 0, TS - 1, TS - 1, INK);
    p.rect(TS - 3, 0, TS - 2, TS - 1, t[1]);
    p.rect(TS - 4, 0, TS - 4, TS - 1, t[0]);
  }
  // Стык с лицом соседа снизу-сбоку: торец поднимается до кромки.
  const fDL = !c.open(-1, 0) && !c.open(-1, 1) && c.open(-1, 2);
  const fDR = !c.open(1, 0) && !c.open(1, 1) && c.open(1, 2);
  if (!faceD && !c.open(0, 1)) {
    if (fDL && !oL) {
      p.rect(0, TS - 4, 3, TS - 4, INK);
      p.rect(0, TS - 3, 3, TS - 1, t[1]);
    }
    if (fDR && !oR) {
      p.rect(TS - 4, TS - 4, TS - 1, TS - 4, INK);
      p.rect(TS - 4, TS - 3, TS - 1, TS - 1, t[1]);
    }
  }
  // Внешние углы.
  if (c.open(-1, -1) && !oU && !oL) p.rect(0, 0, 3, 2, t[2]);
  if (c.open(1, -1) && !oU && !oR) p.rect(TS - 4, 0, TS - 1, 2, t[2]);
  return p;
}

/** Штукатурка с балками: лицо стены покоев. */
function plasterFace(c: CellCtx, area: string, kind: number): Px {
  const p = new Px(TS, TS);
  const pl = areaTones(PLASTER, area);
  const w = WOOD;
  // Тело — штукатурка с мелкой фактурой.
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const n = hash(c.wx * TS + x, c.wy * TS + y, 1);
      let col = n > 0.9 ? pl[3] : n < 0.08 ? pl[1] : pl[2];
      // Свет сверху: низ стены в тени.
      if (y > 10) col = mixc(col, pl[1], (y - 10) / 8);
      p.set(x, y, col);
    }
  // Нагэси — балка поперёк сверху, плинтус снизу.
  p.rect(0, 0, TS - 1, 2, w[2]);
  p.rect(0, 0, TS - 1, 0, w[3]);
  p.rect(0, 3, TS - 1, 3, w[0]);
  p.rect(0, TS - 3, TS - 1, TS - 1, w[1]);
  p.rect(0, TS - 3, TS - 1, TS - 3, w[2]);
  p.rect(0, TS - 1, TS - 1, TS - 1, INK);
  // Столб (хасира) — через каждые три клетки и у краёв стены.
  const post = (x0: number) => {
    p.rect(x0, 0, x0 + 2, TS - 1, w[1]);
    p.rect(x0, 0, x0, TS - 1, w[2]);
    p.rect(x0 + 2, 0, x0 + 2, TS - 1, w[0]);
    p.set(x0 + 1, 1, w[3]);
  };
  if (c.wx % 3 === 0 || c.open(-1, 0)) post(0);
  if (c.open(1, 0)) post(TS - 3);
  // Край кладки у соседа-стены без лица: тёмная черта.
  if (!c.open(-1, 0) && c.open(-1, 1) === false) for (let y = 0; y < TS; y++) p.set(0, y, INK);
  if (!c.open(1, 0) && c.open(1, 1) === false) for (let y = 0; y < TS; y++) p.set(TS - 1, y, INK);
  if (kind === M.window || kind === M.lamp) return p;
  // Свиток на стене — изредка (иероглиф — три мазка).
  if (kind === M.wall && hash(c.wx, c.wy, 13) > 0.86 && c.wx % 3 !== 0) {
    p.rect(5, 4, 10, 12, hx('#e8dcb8'));
    p.rect(5, 4, 10, 4, w[1]);
    p.rect(5, 12, 10, 12, w[1]);
    p.set(7, 6, INK2);
    p.set(8, 7, INK2);
    p.set(7, 8, INK2);
    p.set(8, 9, INK2);
    p.set(7, 10, hx('#8a1a18'));
  }
  return p;
}

/** Сёдзи: решётка кумико на светящейся бумаге. */
function shojiFace(c: CellCtx, area: string, torn: boolean): Px {
  const p = new Px(TS, TS);
  const paper = areaTones(PAPER, area);
  const w = WOOD;
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      // Бумага светится изнутри: светлее к середине ячейки.
      const cx = (x % 5) - 2;
      const cy = ((y - 3) % 4) - 1.5;
      const k = 1 - (cx * cx + cy * cy) / 8;
      p.set(x, y, k > 0.6 ? paper[3] : k > 0.2 ? paper[2] : paper[1]);
    }
  // Решётка: вертикали через 5, горизонтали через 4.
  for (let y = 0; y < TS; y++) {
    p.set(0, y, w[1]);
    p.set(5, y, w[2]);
    p.set(10, y, w[2]);
    p.set(15, y, w[1]);
  }
  for (let x = 0; x < TS; x++) {
    p.set(x, 3, w[2]);
    p.set(x, 7, w[2]);
    p.set(x, 11, w[2]);
  }
  // Верхняя балка и нижняя доска (косимаита).
  p.rect(0, 0, TS - 1, 2, w[1]);
  p.rect(0, 0, TS - 1, 0, w[3]);
  p.rect(0, TS - 4, TS - 1, TS - 1, w[1]);
  p.rect(0, TS - 4, TS - 1, TS - 4, w[2]);
  p.rect(0, TS - 1, TS - 1, TS - 1, INK);
  if (torn) {
    // Надорванная бумага: тёмные дыры с неровным краем.
    for (const [x, y] of [
      [2, 5],
      [7, 9],
      [12, 5],
    ] as V[]) {
      if (hash(c.wx, c.wy, x * 3 + y) < 0.35) continue;
      p.set(x, y, hx('#1a1010'));
      p.set(x + 1, y, hx('#2a1a14'));
      p.set(x, y + 1, hx('#2a1a14'));
      p.set(x + 1, y + 1, paper[0]);
    }
  }
  return p;
}

/** Фусума: две створки, роспись волн и облаков, круглые ручки. */
function fusumaFace(c: CellCtx, area: string, movable: boolean, door: boolean): Px {
  const p = new Px(TS, TS);
  const base = areaTones(
    movable ? tones('#6a5a44', '#9a8a68', '#c0b088', '#e0d0a8') : PLASTER,
    area,
  );
  const frame = movable ? LACQ : WOOD;
  for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) p.set(x, y, y > 10 ? base[1] : base[2]);
  // Роспись: волны (индиго) и золотые облака — узор от мировых координат.
  const X = c.wx * TS;
  for (let x = 0; x < TS; x++) {
    const wy = 9 + Math.round(Math.sin((X + x) * 0.45) * 1.5);
    p.set(x, wy, hx('#2a3a6a'));
    p.set(x, wy + 1, hx('#3a4e84'));
    if ((X + x) % 6 === 0) p.set(x, wy - 1, hx('#dce4f0'));
    const cy = 5 + Math.round(Math.sin((X + x) * 0.2 + 1) * 1.2);
    if ((X + x) % 16 < 9) {
      p.set(x, cy, GILT[2]);
      if ((X + x) % 16 < 7) p.set(x, cy + 1, GILT[1]);
    }
  }
  // Рама створки: вертикали по стыкам, сверху и снизу.
  p.rect(0, 0, TS - 1, 1, frame[1]);
  p.rect(0, 0, TS - 1, 0, frame[2]);
  p.rect(0, TS - 2, TS - 1, TS - 1, frame[1]);
  p.rect(0, TS - 1, TS - 1, TS - 1, INK);
  const seam = c.wx % 2 === 0 ? 0 : TS - 1;
  for (let y = 0; y < TS; y++) p.set(seam, y, frame[0]);
  // Ручка-хикитэ — утопленный круг.
  const hxp = c.wx % 2 === 0 ? 3 : TS - 4;
  p.set(hxp, 7, GILT[1]);
  p.set(hxp + 1, 7, GILT[0]);
  p.set(hxp, 8, GILT[0]);
  p.set(hxp + 1, 8, INK);
  if (movable) {
    // Перегородка ездит: латунные полозья сверху и снизу, стрелки паза.
    for (let x = 0; x < TS; x++) {
      p.set(x, 2, GILT[1]);
      p.set(x, TS - 3, GILT[1]);
    }
    for (let x = 2; x < TS; x += 6) {
      p.set(x, 3, GILT[2]);
      p.set(x + 1, 3, GILT[0]);
    }
  }
  if (door) {
    // Дверь: створки темнее, щель посередине.
    for (let y = 2; y < TS - 2; y++) {
      p.set(7, y, frame[0]);
      p.set(8, y, frame[1]);
    }
  }
  return p;
}

/** Красный лак: колонна или стена святилища. */
function redFace(c: CellCtx): Px {
  const p = new Px(TS, TS);
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const u = x / 15;
      const l = 1 - Math.abs(u - 0.32) * 1.8;
      p.set(x, y, l > 0.75 ? RED[3] : l > 0.35 ? RED[2] : l > -0.1 ? RED[1] : RED[0]);
    }
  // Латунные обручи — сверху и снизу.
  for (const y of [1, 12]) {
    p.rect(0, y, TS - 1, y + 1, GILT[1]);
    p.rect(0, y, TS - 1, y, GILT[2]);
    for (let x = 2; x < TS; x += 4) p.set(x, y + 1, GILT[0]);
  }
  p.rect(0, TS - 1, TS - 1, TS - 1, INK);
  void c;
  return p;
}

/** Кожа барабана на раме: стенка Барабанной. */
function drumFace(c: CellCtx): Px {
  const p = new Px(TS, TS);
  const hide = tones('#8a7250', '#b89a6a', '#d8c090', '#f0e0b8');
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const d = Math.hypot(x - 7.5, y - 8) / 8;
      p.set(x, y, d < 0.5 ? hide[3] : d < 0.8 ? hide[2] : hide[1]);
    }
  // Томоэ — три запятые (упрощённо: три точки по кругу).
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + c.wx;
    const x = 7.5 + Math.cos(a) * 3;
    const y = 8 + Math.sin(a) * 3;
    p.ell(x, y, 1.3, 1.3, hx('#8a1a18'));
    p.set(
      Math.round(x + Math.cos(a + 1.6) * 1.8),
      Math.round(y + Math.sin(a + 1.6) * 1.8),
      hx('#8a1a18'),
    );
  }
  // Красная рама и гвозди.
  p.rect(0, 0, TS - 1, 1, RED[1]);
  p.rect(0, TS - 2, TS - 1, TS - 1, RED[0]);
  p.rect(0, 0, 1, TS - 1, RED[1]);
  p.rect(TS - 2, 0, TS - 1, TS - 1, RED[0]);
  for (let i = 3; i < TS - 2; i += 3) {
    p.set(i, 2, GILT[2]);
    p.set(i, TS - 3, GILT[1]);
  }
  return p;
}

/** Балка перевёрнутого потолка: массивное тёмное дерево с оковкой. */
function beamFace(c: CellCtx): Px {
  const p = new Px(TS, TS);
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const v = y < 3 ? LACQ[3] : y < 6 ? LACQ[2] : y > 12 ? LACQ[0] : LACQ[1];
      p.set(x, y, v);
    }
  for (let x = 0; x < TS; x++) if ((c.wx * TS + x) % 9 === 4) p.rect(x, 4, x + 1, 11, GILT[1]);
  p.rect(0, TS - 1, TS - 1, TS - 1, INK);
  return p;
}

/** Своя клетка стены: лицо (пол под ней) или верх с кромками. */
function wallCell(c: CellCtx, area: string): Px {
  const face = c.open(0, 1);
  const k = c.mark;
  if (!face) {
    const cap =
      k === M.red
        ? RED
        : k === M.shift0 || k === M.shift1 || k === M.beam
          ? LACQ
          : k === M.drumWall
            ? RED
            : WOOD;
    return wallTop(c, areaTones(cap, area));
  }
  switch (k) {
    case M.shoji:
      return shojiFace(c, area, false);
    case M.eyes:
      return shojiFace(c, area, true);
    case M.fusuma:
    case M.flipWall:
      return fusumaFace(c, area, false, false);
    case M.door:
      return fusumaFace(c, area, false, true);
    case M.shift0:
    case M.shift1:
      return fusumaFace(c, area, true, false);
    case M.red:
      return redFace(c);
    case M.drumWall:
      return drumFace(c);
    case M.beam:
      return beamFace(c);
    default:
      return plasterFace(c, area, k);
  }
}

// ---------------------------------------------------------------------------
// Клетки: выбор по виду.
// ---------------------------------------------------------------------------

const FLOOR_OF = new Set<number>([
  M.tatami,
  M.blood,
  M.scorch,
  M.cut,
  M.plankH,
  M.plankV,
  M.bridge,
  M.bridgeFall,
  M.ceil,
  M.moon,
  M.moonPit,
  M.moonScreen,
  M.group,
  M.ambush,
  M.flip,
  M.flipBeam,
  M.drumFloor,
  M.track0,
  M.track1,
]);

/** Вид пола под вещью или паутиной: большинство соседей. */
function inheritMark(c: CellCtx): number {
  const count = new Map<number, number>();
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ] as V[]) {
    const k = c.markAt(dx, dy);
    if (!FLOOR_OF.has(k) || k === M.bridgeFall) continue;
    const base =
      k === M.blood ||
      k === M.scorch ||
      k === M.cut ||
      k === M.group ||
      k === M.ambush ||
      k === M.flip ||
      k === M.flipBeam ||
      k === M.drumFloor
        ? M.tatami
        : k;
    count.set(base, (count.get(base) ?? 0) + (dx && dy ? 1 : 2));
  }
  let best = 0;
  let bn = 0;
  for (const [k, n] of count)
    if (n > bn) {
      best = k;
      bn = n;
    }
  return best;
}

function floorOf(c: CellCtx, kind: number, area: string): Px | null {
  switch (kind) {
    case M.tatami:
    case M.group:
    case M.ambush:
    case M.flip:
    case M.flipBeam: {
      const p = tatami(c.wx, c.wy, area);
      railsAround(p, c);
      return p;
    }
    case M.blood:
    case M.scorch:
    case M.cut: {
      const p = tatami(c.wx, c.wy, area);
      wear(p, c.wx, c.wy, kind);
      return p;
    }
    case M.plankH:
    case M.plankV: {
      const p = planks(c.wx, c.wy, kind === M.plankH, area);
      railsAround(p, c);
      return p;
    }
    case M.bridge:
      return bridge(c, area, false);
    case M.bridgeFall:
      return bridge(c, area, true);
    case M.ceil:
      return ceiling(c.wx, c.wy, area);
    case M.moon:
    case M.moonPit:
    case M.moonScreen:
      return moonFloor(c.wx, c.wy, kind);
    case M.drumFloor: {
      // Татами Барабанной с красной каймой; места лопастей — паз.
      const p = tatami(c.wx, c.wy, area, tones('#5a4a2a', '#76603a', '#927a4a', '#ae965e'));
      for (let i = 0; i < TS; i++) {
        p.set(i, 0, RED[1]);
        p.set(0, i, RED[1]);
      }
      for (let i = 3; i < TS - 3; i += 2) {
        p.set(i, 8, hx('#4a1a14'));
        p.set(8, i, hx('#4a1a14'));
      }
      return p;
    }
    case M.track0:
    case M.track1: {
      // Паз перегородки: пол соседей и латунные полозья поперёк хода.
      const base = inheritMark(c);
      const p =
        (base && base !== M.track0 && base !== M.track1 ? floorOf(c, base, area) : null) ??
        planks(c.wx, c.wy, true, area);
      const along = (k: number) =>
        k === M.track0 || k === M.track1 || k === M.shift0 || k === M.shift1;
      const horiz = along(c.markAt(-1, 0)) || along(c.markAt(1, 0));
      for (let i = 0; i < TS; i++) {
        if (horiz) {
          p.set(i, 6, GILT[0]);
          p.set(i, 7, GILT[2]);
          p.set(i, 9, GILT[0]);
        } else {
          p.set(6, i, GILT[0]);
          p.set(7, i, GILT[2]);
          p.set(9, i, GILT[0]);
        }
      }
      return p;
    }
    default:
      return null;
  }
}

function f8Cell(c: CellCtx, area: string): Px | null {
  const k = c.mark;
  // Рухнувший мост — пропасть.
  if (c.tile === 11) return abyss(c, area, k !== M.abyss);
  if (isDeepMark(k)) return abyss(c, area, k === M.abyssMoon);
  if (k >= 40 && k < 60) return wallCell(c, area);
  if (k === M.web) {
    const base = inheritMark(c) || M.plankH;
    const p = floorOf(c, base, area) ?? planks(c.wx, c.wy, true, area);
    web(p, c.wx, c.wy);
    return p;
  }
  if (k === M.inherit) {
    const base = inheritMark(c);
    return base ? floorOf(c, base, area) : null;
  }
  return floorOf(c, k, area);
}

/** Паутина: лучи и спираль по мировым координатам — ткётся через клетки. */
function web(p: Px, wx: number, wy: number): void {
  const silk = hx('#e8e4f0', 200);
  const dim = hx('#9a94a8', 150);
  // Центр паутины — в узле решётки 5×5 клеток.
  const cx =
    Math.floor(wx / 5) * 5 * TS +
    40 +
    Math.floor(hash(Math.floor(wx / 5), Math.floor(wy / 5), 1) * 30);
  const cy =
    Math.floor(wy / 5) * 5 * TS +
    40 +
    Math.floor(hash(Math.floor(wx / 5), Math.floor(wy / 5), 2) * 30);
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = wx * TS + x - cx;
      const Y = wy * TS + y - cy;
      const d = Math.hypot(X, Y);
      const a = Math.atan2(Y, X);
      // Лучи: восемь.
      const ray = Math.abs((((a / TAU) * 8 + 8) % 1) - 0.5) > 0.47;
      // Спираль: шаг 7 пикселей, провисает между лучами.
      const sag = Math.abs(Math.sin(a * 4)) * 1.5;
      const ring = Math.abs(((d + sag) % 7) - 3.5) > 3.1;
      if (ray && d < 60) p.set(x, y, silk);
      else if (ring && d < 60) p.set(x, y, dim);
    }
}

registerCellPainter(F8_LOWER, (c) => f8Cell(c, F8_LOWER));
registerCellPainter(F8_HALLS, (c) => f8Cell(c, F8_HALLS));
registerCellPainter(F8_MOON, (c) => f8Cell(c, F8_MOON));

// ---------------------------------------------------------------------------
// Реквизит: предметы этажа. Живые — кадрами (огонь, дым, качание, двери).
// ---------------------------------------------------------------------------

const sprites = new Map<string, Sprite>();

export function cached(key: string, make: () => Sprite): Sprite {
  let s = sprites.get(key);
  if (!s) {
    s = make();
    sprites.set(key, s);
  }
  return s;
}

export const spr = (p: Px, ax: number, ay: number): Sprite => ({ img: p.canvas(), ax, ay });

/** Вспышка удара: побелить. */
const flashed = (p: Px, on: boolean): Px => (on ? p.tint(WHITE, 0.8) : p);

/** Язычок пламени высотой `h` в точке (x, y) — низ пламени. */
function flame(p: Px, x: number, y: number, h: number, f: number, cold = false): void {
  const c = cold
    ? [hx('#4a6ad8'), hx('#8ab0ff'), hx('#e8f4ff')]
    : [hx('#e8501a'), hx('#ffb040'), hx('#fff4b0')];
  for (let i = 0; i < h; i++) {
    const w = Math.max(0, Math.round((h - i) * 0.45 - (i === 0 ? 0.5 : 0)));
    const sway = f % 2 === 0 ? 0 : i > h / 2 ? 1 : 0;
    for (let dx = -w; dx <= w; dx++) {
      const col = Math.abs(dx) >= w ? c[0] : Math.abs(dx) >= w - 1 ? c[1] : c[2];
      p.set(x + dx + sway, y - i, col);
    }
  }
}

/** Дверь-фусума: закрыта — рисует клетка; открыта — щель, в темноте глаза. */
registerPropPainter('f8_door', (o) => {
  const st = doorOpen(o, F8_CLOCK.now);
  if (st.k <= 0) return null;
  const k = Math.round(st.k * 4) / 4;
  return cached(`door|${k}|${st.gold ? 1 : 0}`, () => {
    const p = new Px(TS, TS);
    const gap = Math.round(2 + k * 10);
    const x0 = 8 - Math.floor(gap / 2);
    const x1 = x0 + gap - 1;
    p.rect(x0, 2, x1, TS - 2, hx('#07050a'));
    // Края створок — светлый торец лака.
    for (let y = 2; y < TS - 1; y++) {
      p.set(x0 - 1, y, WOOD[3]);
      p.set(x1 + 1, y, WOOD[2]);
    }
    if (k >= 0.5) {
      // Глаза из темноты: демон уже в проёме.
      const eye = st.gold ? hx('#ffe040') : hx('#ff3a28');
      p.set(6, 7, eye);
      p.set(9, 7, eye);
      if (k >= 1) {
        p.set(6, 6, darker(eye, 0.4));
        p.set(9, 6, darker(eye, 0.4));
      }
    }
    return spr(p, 8, TS);
  });
});

/** Круглое окно: ночь, луна, облака плывут. */
registerPropPainter('f8_moonwin', (o, time) => {
  const f = Math.floor(time * 1.2 + o.x) % 8;
  return cached(`moonwin|${f}`, () => {
    const p = new Px(TS, TS);
    const cx = 7.5;
    const cy = 8;
    const R = 6.2;
    for (let y = 0; y < TS; y++)
      for (let x = 0; x < TS; x++) {
        const d = Math.hypot(x + 0.5 - cx - 0.5, y + 0.5 - cy);
        if (d > R + 1) continue;
        if (d > R) {
          p.set(x, y, WOOD[0]);
          continue;
        }
        p.set(x, y, mixc(hx('#0c1030'), hx('#2a3a78'), (y - 2) / 12));
      }
    // Луна.
    shadeEll(p, 9, 6, 2.6, 2.6, MOONC, 0.3);
    p.ell(10.2, 5.4, 2, 2, hx('#101840'));
    // Облако плывёт через окно.
    const ox = ((f * 2) % 16) - 4;
    for (let i = 0; i < 7; i++) {
      const x = ox + i;
      const y = 9 + (i % 3 === 1 ? -1 : 0);
      if (x >= 2 && x <= 13) {
        p.set(x, y, hx('#6a78a8'));
        p.set(x, y + 1, hx('#4a5688'));
      }
    }
    // Решётка кумико поверх — крестом.
    for (let i = 2; i < 14; i++) {
      p.set(7, i, WOOD[1]);
      p.set(i, 8, WOOD[1]);
    }
    // Рама — толстое кольцо.
    for (let a = 0; a < 64; a++) {
      const t = (a / 64) * TAU;
      p.set(
        Math.round(cx + 0.5 + Math.cos(t) * (R + 0.4)),
        Math.round(cy + Math.sin(t) * (R + 0.4)),
        WOOD[2],
      );
    }
    return spr(p, 8, TS);
  });
});

/** Фонарь-тётин на балке: качается, мигает. */
registerPropPainter('f8_wlamp', (o, time) => {
  const f = Math.floor(time * 3 + o.x * 0.7) % 4;
  const fl = Math.floor(time * 9 + o.y) % 2;
  return cached(`wlamp|${f}|${fl}`, () => {
    const p = new Px(TS, 22);
    const sway = [0, 1, 0, -1][f];
    const x = 8 + sway;
    stroke(p, 8, 2, x, 6, INK2);
    // Тело фонаря: ребристый овал, красный с белым поясом.
    const body = fl
      ? tones('#8a1a18', '#c8302a', '#f06040', '#ffb080')
      : tones('#7a1614', '#b8282a', '#e05038', '#ffa070');
    shadeEll(p, x, 12, 4.2, 5.2, body, 0.35);
    for (let y = 8; y < 17; y += 2) {
      for (let dx = -3; dx <= 3; dx++)
        if (p.solid(x + dx, y)) p.set(x + dx, y, darker(p.get(x + dx, y), 0.25));
    }
    p.rect(x - 2, 11, x + 2, 12, hx('#f8e8c0'));
    p.set(x, 11, INK2);
    p.set(x, 12, hx('#8a1a18'));
    // Шапка и донце — чёрный лак.
    p.rect(x - 2, 6, x + 2, 7, LACQ[1]);
    p.rect(x - 2, 17, x + 2, 18, LACQ[1]);
    p.set(x, 19, GILT[2]);
    p.set(x, 20, GILT[1]);
    p.outline(INK);
    return spr(p, 8, 16);
  });
});

/** Плавучий фонарь над пропастью: покачивается. */
registerPropPainter('f8_float', (o, time) => {
  const f = Math.floor(time * 2 + o.x + o.y) % 6;
  const fl = Math.floor(time * 7 + o.x) % 2;
  return cached(`float|${f}|${fl}`, () => {
    const p = new Px(12, 18);
    const bob = [0, 0, 1, 1, 1, 0][f];
    const y0 = 5 + bob;
    // Лодочка-основание.
    p.rect(2, y0 + 7, 9, y0 + 8, WOOD[2]);
    p.rect(3, y0 + 9, 8, y0 + 9, WOOD[0]);
    // Бумажный короб, светится.
    const paper = fl ? PAPER : tones('#a89060', '#d0b880', '#ecd8a0', '#fff0c8');
    p.rect(3, y0, 8, y0 + 6, paper[2]);
    p.rect(4, y0 + 1, 7, y0 + 5, paper[3]);
    p.rect(3, y0, 3, y0 + 6, paper[1]);
    p.rect(3, y0, 8, y0, WOOD[1]);
    p.set(5, y0 + 3, hx('#ffcc60'));
    p.set(6, y0 + 3, hx('#fff0a0'));
    p.outline(INK);
    // Отражение-блик под лодочкой.
    p.set(5, y0 + 11, alpha(hx('#ffb040'), 0.5));
    p.set(6, y0 + 12, alpha(hx('#ffb040'), 0.3));
    return spr(p, 6, 17);
  });
});

/** Андон: бумажный светильник на ножках. */
registerPropPainter('f8_andon', (o, time) => {
  const fl = Math.floor(time * 6 + o.x * 3) % 3;
  return cached(`andon|${fl}`, () => {
    const p = new Px(12, 20);
    // Ножки.
    p.rect(2, 14, 2, 19, WOOD[1]);
    p.rect(9, 14, 9, 19, WOOD[0]);
    p.rect(2, 18, 9, 18, WOOD[1]);
    // Короб: рама и бумага, горит изнутри.
    const glow = [hx('#fff0b8'), hx('#ffe6a0'), hx('#fff8d0')][fl];
    p.rect(1, 4, 10, 14, WOOD[1]);
    p.rect(2, 5, 9, 13, glow);
    p.rect(2, 5, 3, 13, PAPER[2]);
    p.rect(8, 5, 9, 13, PAPER[1]);
    for (let y = 5; y < 14; y += 4) p.rect(2, y, 9, y, WOOD[2]);
    p.rect(1, 3, 10, 3, LACQ[2]);
    p.rect(0, 2, 11, 2, LACQ[1]);
    p.set(5, 9, hx('#ffd060'));
    p.set(6, 9, hx('#fff4b0'));
    p.outline(INK);
    return spr(p, 6, 19);
  });
});

/** Каменный фонарь: основание, столб, окошко с огнём, крыша с загибом. */
registerPropPainter('f8_toro', (o, time) => {
  const f = Math.floor(time * 8 + o.x) % 4;
  return cached(`toro|${f}`, () => {
    const p = new Px(14, 26);
    const s = STONE;
    p.rect(3, 22, 10, 24, s[1]);
    p.rect(3, 22, 10, 22, s[2]);
    p.rect(5, 15, 8, 21, s[1]);
    p.rect(5, 15, 5, 21, s[2]);
    p.rect(3, 13, 10, 14, s[2]);
    // Огневая камера — окошко светится.
    p.rect(4, 8, 9, 12, s[1]);
    p.rect(5, 9, 8, 11, hx('#2a1a10'));
    flame(p, 6, 11, 3 + (f % 2), f);
    // Крыша с загнутыми краями и навершие-жемчуг.
    poly(
      p,
      [
        [1, 7],
        [12, 7],
        [10, 4],
        [3, 4],
      ],
      s[2],
    );
    p.set(0, 6, s[2]);
    p.set(13, 6, s[1]);
    p.rect(3, 7, 10, 7, s[0]);
    shadeEll(p, 6.5, 2.5, 1.6, 1.6, s);
    // Мох у основания.
    p.set(3, 21, hx('#3a4a24'));
    p.set(10, 21, hx('#2a3a1c'));
    p.outline(INK);
    return spr(p, 7, 25);
  });
});

/** Курильница: бронза на трёх ножках, дым вьётся вверх. */
registerPropPainter('f8_incense', (o, time) => {
  const f = Math.floor(time * 5 + o.x) % 6;
  return cached(`incense|${f}`, () => {
    const p = new Px(12, 26);
    const bronze = tones('#3a2a14', '#6a4a24', '#9a7038', '#d0a860');
    p.set(3, 25, bronze[0]);
    p.set(8, 25, bronze[0]);
    p.set(5, 25, bronze[1]);
    shadeEll(p, 5.5, 22, 4, 2.8, bronze);
    p.rect(2, 19, 9, 19, bronze[2]);
    p.set(1, 20, bronze[1]);
    p.set(10, 20, bronze[1]);
    p.outline(INK);
    // Дым: завитки поднимаются, тают.
    for (let i = 0; i < 14; i++) {
      const y = 18 - i;
      const x = 5.5 + Math.sin((i + f * 1.3) * 0.6) * (1 + i * 0.12);
      const a = 0.65 - i * 0.04;
      p.set(Math.round(x), y, alpha(hx('#d8d0e0'), a));
      if (i % 3 === 0) p.set(Math.round(x) + 1, y, alpha(hx('#b0a8c0'), a * 0.6));
    }
    return spr(p, 6, 25);
  });
});

/** Свечи на подставке. */
registerPropPainter('f8_candles', (o, time) => {
  const f = Math.floor(time * 10 + o.y) % 4;
  return cached(`candles|${f}`, () => {
    const p = new Px(10, 22);
    p.rect(4, 8, 5, 20, LACQ[2]);
    p.rect(4, 8, 4, 20, LACQ[3]);
    p.rect(2, 20, 7, 21, LACQ[1]);
    p.rect(2, 7, 7, 7, GILT[1]);
    // Свеча и воск.
    p.rect(4, 3, 5, 6, hx('#f0e8d8'));
    p.set(5, 4, hx('#c8c0b0'));
    p.set(3, 7, hx('#f0e8d8'));
    p.outline(INK);
    flame(p, 4, 2, 3 + (f % 2), f);
    return spr(p, 5, 21);
  });
});

/** Ширма-бёбу: золотые створки, сосна. Бьётся. */
registerPropPainter('f8_byobu', (_o, _t, _a, flash) =>
  cached(`byobu|${flash ? 1 : 0}`, () => {
    const p = new Px(22, 18);
    // Шесть створок зигзагом: светлые и теневые по очереди.
    for (let i = 0; i < 6; i++) {
      const x0 = 1 + i * 3.4;
      const dark = i % 2 === 1;
      const g = dark ? GILT[1] : GILT[2];
      poly(
        p,
        [
          [x0, 3 + (dark ? 1 : 0)],
          [x0 + 3.4, 3 + (dark ? 0 : 1)],
          [x0 + 3.4, 15 + (dark ? 0 : 1)],
          [x0, 15 + (dark ? 1 : 0)],
        ],
        g,
      );
    }
    // Сосна: ствол и хвоя.
    stroke(p, 5, 14, 9, 7, WOOD[1], 1.5);
    stroke(p, 9, 7, 15, 5, WOOD[1]);
    for (const [x, y] of [
      [8, 5],
      [12, 4],
      [15, 5],
      [6, 9],
    ] as V[]) {
      p.ell(x, y, 2.2, 1.2, hx('#2a4a2a'));
      p.set(x, y - 1, hx('#4a6a3a'));
    }
    p.rect(0, 16, 21, 16, LACQ[1]);
    p.outline(INK);
    return spr(flashed(p, flash), 11, 17);
  }),
);

/** Бочка сакэ в соломе с красным знаком. Бьётся. */
registerPropPainter('f8_sake', (_o, _t, _a, flash) =>
  cached(`sake|${flash ? 1 : 0}`, () => {
    const p = new Px(14, 16);
    const straw = tones('#7a6232', '#a8884a', '#c8aa62', '#e0c882');
    for (let y = 3; y < 15; y++)
      for (let x = 1; x < 13; x++) {
        const u = (x - 1) / 11;
        const l = 1 - Math.abs(u - 0.35) * 1.8;
        let c = l > 0.6 ? straw[2] : l > 0.1 ? straw[1] : straw[0];
        if ((x + y * 2) % 5 === 0) c = darker(c, 0.15);
        p.set(x, y, c);
      }
    // Верёвки поясом.
    for (const y of [4, 13]) p.rect(1, y, 12, y, hx('#4a3018'));
    for (let y = 4; y < 14; y += 3) p.set(2, y, hx('#4a3018'));
    // Красный знак в круге.
    p.ell(7, 8.5, 3, 3, hx('#e8dcc0'));
    p.set(6, 7, RED[1]);
    p.set(7, 8, RED[1]);
    p.set(8, 8, RED[1]);
    p.set(7, 9, RED[1]);
    p.set(6, 10, RED[1]);
    // Крышка.
    p.ell(7, 3, 5.4, 1.4, WOOD[2]);
    p.outline(INK);
    return spr(flashed(p, flash), 7, 15);
  }),
);

/** Низкий столик с чайником и чашками. Бьётся. */
registerPropPainter('f8_table', (_o, _t, _a, flash) =>
  cached(`table|${flash ? 1 : 0}`, () => {
    const p = new Px(16, 12);
    p.rect(1, 5, 14, 7, LACQ[2]);
    p.rect(1, 5, 14, 5, LACQ[3]);
    p.rect(1, 7, 14, 7, LACQ[0]);
    p.rect(2, 8, 2, 11, LACQ[1]);
    p.rect(13, 8, 13, 11, LACQ[0]);
    // Золотая кайма столешницы.
    p.set(1, 6, GILT[1]);
    p.set(14, 6, GILT[1]);
    // Чайник и две чашки.
    shadeEll(p, 6, 3, 2.2, 1.8, tones('#2a2a2a', '#4a4844', '#6a6862', '#9a988e'));
    p.set(8, 3, hx('#4a4844'));
    p.set(6, 1, hx('#6a6862'));
    p.rect(10, 3, 11, 4, hx('#e8e0d0'));
    p.rect(12, 4, 13, 4, hx('#e8e0d0'));
    p.set(10, 3, hx('#3a6a4a'));
    p.outline(INK);
    return spr(flashed(p, flash), 8, 11);
  }),
);

/** Ваза с веткой сливы. Бьётся. */
registerPropPainter('f8_vase', (_o, _t, _a, flash) =>
  cached(`vase|${flash ? 1 : 0}`, () => {
    const p = new Px(12, 20);
    const pot = tones('#2a3a5a', '#4a6a9a', '#8aa8d0', '#e0ecf8');
    shadeEll(p, 5.5, 15, 3.8, 3.8, pot);
    p.rect(4, 9, 7, 12, pot[2]);
    p.rect(4, 9, 4, 12, pot[3]);
    p.rect(3, 8, 8, 8, pot[1]);
    // Узор — синие волны на белом поясе.
    for (let x = 3; x < 9; x++) p.set(x, 15, x % 2 ? pot[3] : pot[0]);
    // Ветка сливы.
    stroke(p, 6, 8, 9, 2, WOOD[0]);
    stroke(p, 7, 5, 3, 1, WOOD[0]);
    for (const [x, y] of [
      [9, 2],
      [3, 1],
      [8, 4],
      [5, 3],
    ] as V[]) {
      p.set(x, y, hx('#f0a0b8'));
      p.set(x + 1, y, hx('#d86088'));
    }
    p.outline(INK);
    return spr(flashed(p, flash), 6, 19);
  }),
);

/** Доспех на стойке: шлем с рогами, маска, красная шнуровка. */
registerPropPainter('f8_armor', () =>
  cached('armor', () => {
    const p = new Px(18, 26);
    const steel = tones('#1a1a22', '#2e2e3a', '#4a4a5a', '#7a7a90');
    // Стойка.
    p.rect(8, 20, 9, 25, WOOD[1]);
    p.rect(4, 24, 13, 25, WOOD[0]);
    // Юбка-кусадзури: пластины.
    for (let i = 0; i < 4; i++) p.rect(4 + i * 2.5, 17, 5 + i * 2.5, 21, steel[1 + (i % 2)]);
    // Кираса: чёрный лак, красная шнуровка рядами.
    shadePoly(
      p,
      [
        [4, 9],
        [13, 9],
        [12, 17],
        [5, 17],
      ],
      steel,
    );
    for (let y = 11; y < 17; y += 2) for (let x = 5; x < 13; x += 2) p.set(x, y, RED[2]);
    // Наплечники-содэ.
    shadePoly(
      p,
      [
        [1, 9],
        [4, 9],
        [4, 15],
        [1, 14],
      ],
      steel,
    );
    shadePoly(
      p,
      [
        [13, 9],
        [16, 9],
        [16, 14],
        [13, 15],
      ],
      steel,
    );
    for (const y of [11, 13]) {
      p.rect(1, y, 3, y, RED[1]);
      p.rect(14, y, 16, y, RED[1]);
    }
    // Шлем, маска-мэмпо, золотые рога-кувагата.
    shadeEll(p, 8.5, 5, 3.6, 3, steel);
    p.rect(5, 5, 12, 5, steel[0]);
    p.rect(6, 6, 11, 8, RED[1]);
    p.set(7, 7, INK2);
    p.set(10, 7, INK2);
    stroke(p, 7, 3, 4, 0, GILT[2]);
    stroke(p, 10, 3, 13, 0, GILT[2]);
    p.set(8, 2, GILT[3]);
    p.outline(INK);
    return spr(p, 9, 25);
  }),
);

/** Стойка мечей: два меча в ножнах на чёрной подставке. */
registerPropPainter('f8_rack', () =>
  cached('rack', () => {
    const p = new Px(18, 14);
    p.rect(2, 5, 3, 12, LACQ[2]);
    p.rect(14, 5, 15, 12, LACQ[1]);
    p.rect(1, 12, 16, 13, LACQ[1]);
    p.rect(1, 12, 16, 12, LACQ[3]);
    for (const [y, c] of [
      [5, RED[1]],
      [8, LACQ[3]],
    ] as [number, RGBA][]) {
      // Ножны и рукоять с оплёткой.
      p.rect(1, y, 12, y + 1, c);
      p.rect(1, y, 12, y, lighter(c, 0.3));
      p.rect(13, y, 16, y + 1, hx('#1a1418'));
      for (let x = 13; x < 17; x += 2) p.set(x, y, hx('#e8e0d0'));
      p.set(12, y, GILT[2]);
      p.set(12, y + 1, GILT[1]);
    }
    p.outline(INK);
    return spr(p, 9, 13);
  }),
);

/** Тайко на подставке. Дрожит, когда рядом бьют в барабан. */
registerPropPainter('f8_taiko', (o, time) => {
  const beat = F8_CLOCK.now - (F8_CLOCK.beat ?? -9);
  const f = beat < 0.5 ? Math.floor(time * 20) % 2 : 0;
  return cached(`taiko|${f}`, () => {
    const p = new Px(18, 18);
    const dx = f ? 1 : 0;
    // Подставка.
    p.rect(2, 12, 3, 17, WOOD[1]);
    p.rect(14, 12, 15, 17, WOOD[0]);
    p.rect(2, 16, 15, 16, WOOD[1]);
    // Корпус: красный лак, латунные гвозди; кожа — светлый круг с томоэ.
    shadeEll(p, 8.5 + dx, 9, 7, 6, RED, 0.2);
    for (let a = 0; a < 12; a++) {
      const t = (a / 12) * TAU;
      p.set(Math.round(8.5 + dx + Math.cos(t) * 5.8), Math.round(9 + Math.sin(t) * 4.8), GILT[2]);
    }
    shadeEll(p, 8.5 + dx, 9, 4.2, 3.6, tones('#a88858', '#d0b080', '#ecd4a0', '#fff0c8'), 0.3);
    p.set(7 + dx, 8, RED[1]);
    p.set(10 + dx, 9, RED[1]);
    p.set(8 + dx, 11, RED[1]);
    p.outline(INK);
    void o;
    return spr(p, 9, 17);
  });
});

/** Лестница в никуда: ступени уходят вверх и обрываются в пустоте. */
function stairs(): Px {
  const p = new Px(16, 30);
  const w = WOOD;
  for (let i = 0; i < 7; i++) {
    // Ступень i: проступь и подступенок; выше — меньше и дальше.
    const y = 26 - i * 3.6;
    const x0 = 2 + i * 0.4;
    const x1 = 13 - i * 0.4;
    p.rect(Math.round(x0), Math.round(y), Math.round(x1), Math.round(y), w[3]);
    p.rect(Math.round(x0), Math.round(y) + 1, Math.round(x1), Math.round(y) + 2, w[1]);
    p.rect(Math.round(x0), Math.round(y) + 3, Math.round(x1), Math.round(y) + 3, w[0]);
  }
  // Тетивы и перила.
  stroke(p, 1, 29, 4, 3, LACQ[2]);
  stroke(p, 14, 29, 11, 3, LACQ[1]);
  stroke(p, 0, 21, 3, 0, RED[2]);
  stroke(p, 15, 21, 12, 0, RED[1]);
  // Обрыв: верхняя ступень расщеплена, щепки.
  p.set(6, 1, w[2]);
  p.set(8, 0, w[1]);
  p.set(10, 2, w[2]);
  p.outline(INK);
  return p;
}

registerPropPainter('f8_stairs', () => cached('stairs', () => spr(stairs(), 8, 29)));
registerPropPainter('f8_stairs_up', () =>
  cached('stairs_up', () => {
    const src = stairs();
    // Вверх ногами: отражаем по вертикали вручную.
    const p = new Px(src.w, src.h);
    for (let y = 0; y < src.h; y++)
      for (let x = 0; x < src.w; x++) {
        const c = src.get(x, src.h - 1 - y);
        if (c[3]) p.set(x, y, c);
      }
    return spr(p, 8, 29);
  }),
);

/** Подушка-дзабутон. */
registerPropPainter('f8_cushion', (o) => {
  const v = Math.floor(o.x + o.y * 3) % 2;
  return cached(`cushion|${v}`, () => {
    const p = new Px(12, 8);
    const t = v
      ? tones('#2a2a5a', '#3a3a7a', '#5a5aa0', '#8a8ac8')
      : tones('#5a1414', '#8a2020', '#b83a30', '#e06850');
    shadeEll(p, 5.5, 4, 5, 2.6, t, 0.2);
    p.set(5, 4, GILT[2]);
    p.set(1, 2, t[2]);
    p.set(10, 2, t[1]);
    p.outline(INK);
    return spr(p, 6, 7);
  });
});

/** Лампа потолка, что теперь «стоит»: бомбори вверх ногами, шнур вверх. */
function upLamp(fl: number): Px {
  const p = new Px(12, 20);
  const paper = fl ? PAPER : tones('#b09a68', '#d8c088', '#f0dca8', '#fff4d0');
  // Шнур уходит «вверх» — к полу, что над головой.
  stroke(p, 6, 0, 6, 6, INK2);
  p.rect(4, 6, 7, 7, LACQ[1]);
  shadeEll(p, 5.5, 11, 4, 4, paper, 0.4);
  p.rect(3, 15, 8, 16, LACQ[1]);
  p.rect(4, 17, 7, 17, GILT[1]);
  p.set(5, 11, hx('#ffc860'));
  p.outline(INK);
  return p;
}
registerPropPainter('f8_c_lamp', (o, time) => {
  const fl = Math.floor(time * 6 + o.x) % 2;
  return cached(`clamp|${fl}`, () => spr(upLamp(fl), 6, 19));
});
registerPropPainter('f8_uplamp', (o, time) => {
  const fl = Math.floor(time * 6 + o.y) % 2;
  return cached(`clamp|${fl}`, () => spr(upLamp(fl), 6, 19));
});

// Помосты бивы и место барабанщика рисуются на полу меткой (`f8_dais`,
// `f8_tomoe`), а не предметом: предмет лёг бы поверх того, кто на нём сидит.
registerPropPainter('f8_stage', () => null);
registerPropPainter('f8_stage2', () => null);
registerPropPainter('f8_drumseat', () => null);

// ---------------------------------------------------------------------------
// Метки ударов, лужи, картинки на полу.
// ---------------------------------------------------------------------------

/** Клетки предупреждения сдвига: что станет стеной — мигает, пол дрожит. */
registerZonePainter('f8_shift', (g, z0, px, py, S, time) => {
  const z = z0 as Zone & { cells: number[]; open: number[]; w: number; pit?: number };
  const W = z.w;
  const k = Math.min(1, z.t / Math.max(0.01, z.life));
  const blink = Math.floor(time * (6 + k * 10)) % 2 === 0;
  const shake = Math.round(Math.sin(time * 60) * k * 1.2);
  for (const i of z.cells) {
    const cx = px + ((i % W) - z.x) * S;
    const cy = py + (Math.floor(i / W) - z.y) * S;
    if (z.pit) {
      // Пол рушится: тёмные трещины растут.
      g.fillStyle = `rgba(4,3,10,${0.2 + 0.55 * k})`;
      g.fillRect(cx + shake, cy, S, S);
      g.strokeStyle = `rgba(160,170,255,${blink ? 0.7 : 0.35})`;
      g.lineWidth = 1;
      g.strokeRect(cx + 0.5, cy + 0.5, S - 1, S - 1);
      continue;
    }
    // Здесь встанет стена: призрак створки поднимается, край мигает.
    g.fillStyle = `rgba(232,200,120,${0.12 + 0.4 * k})`;
    g.fillRect(cx + shake, cy + S * (1 - k), S, S * k);
    g.strokeStyle = blink ? 'rgba(255,90,60,0.95)' : 'rgba(255,210,120,0.6)';
    g.lineWidth = 1;
    g.strokeRect(cx + 0.5, cy + 0.5, S - 1, S - 1);
    // Пыль с потолка.
    g.fillStyle = 'rgba(220,210,190,0.7)';
    for (let d = 0; d < 3; d++) {
      const fx = cx + ((d * 5 + Math.floor(time * 20)) % S);
      const fy = cy + ((time * 30 + d * 7) % S);
      g.fillRect(Math.round(fx), Math.round(fy), 1, 1);
    }
  }
  for (const i of z.open) {
    const cx = px + ((i % W) - z.x) * S;
    const cy = py + (Math.floor(i / W) - z.y) * S;
    // Стена уедет: по ней бегут светлые полосы.
    g.fillStyle = `rgba(160,220,255,${blink ? 0.35 * k + 0.1 : 0.12})`;
    g.fillRect(cx, cy, S, S);
  }
  return true;
});

/** Конус с отпечатками ладоней по краю — звезда многорукого. */
registerZonePainter('f8_palm', (g, z0, px, py, S) => {
  const z = z0 as Strike;
  const k = Math.min(1, z.t / z.warn);
  const R = z.r * S;
  const a = z.ang ?? 0;
  const h = (z.arc ?? 0.5) / 2;
  g.fillStyle = `rgba(255,120,40,${0.12 + 0.3 * k})`;
  g.beginPath();
  g.moveTo(px, py);
  g.arc(px, py, R * (0.3 + 0.7 * k), a - h, a + h);
  g.closePath();
  g.fill();
  // Ладонь на конце: пять пальцев.
  const ex = px + Math.cos(a) * R * (0.35 + 0.6 * k);
  const ey = py + Math.sin(a) * R * (0.35 + 0.6 * k);
  g.fillStyle = `rgba(255,${k > 0.8 ? 60 : 170},60,${0.5 + 0.4 * k})`;
  g.fillRect(Math.round(ex - 2), Math.round(ey - 2), 4, 4);
  for (let i = -2; i <= 2; i++) {
    const fa = a + i * 0.35;
    g.fillRect(Math.round(ex + Math.cos(fa) * 3), Math.round(ey + Math.sin(fa) * 3), 1, 1);
  }
  g.strokeStyle = `rgba(255,90,40,${0.4 + 0.5 * k})`;
  g.lineWidth = 1;
  g.beginPath();
  g.arc(px, py, R, a - h, a + h);
  g.stroke();
  return true;
});

/** Хватка: линия с рукой, тянущейся к концу. */
registerZonePainter('f8_grab', (g, z0, px, py, S) => {
  const z = z0 as Strike;
  const k = Math.min(1, z.t / z.warn);
  const a = z.ang ?? 0;
  const L = z.r * S;
  g.save();
  g.translate(px, py);
  g.rotate(a);
  g.fillStyle = `rgba(200,140,255,${0.14 + 0.3 * k})`;
  g.fillRect(0, -(z.w ?? 0.4) * S, L, (z.w ?? 0.4) * S * 2);
  g.fillStyle = `rgba(230,190,255,${0.5 + 0.4 * k})`;
  const hx0 = L * k;
  g.fillRect(Math.round(hx0 - 3), -2, 4, 4);
  g.fillRect(Math.round(hx0 + 1), -3, 2, 1);
  g.fillRect(Math.round(hx0 + 1), 2, 2, 1);
  g.fillRect(Math.round(hx0 + 1), 0, 2, 1);
  g.restore();
  return true;
});

/** Нить паука: тонкий блестящий отрезок. */
registerZonePainter('f8_thread', (g, z0, px, py, S, time) => {
  const z = z0 as Zone & { ang: number; seg: number };
  const ux = Math.cos(z.ang);
  const uy = Math.sin(z.ang);
  const L = (z.seg * S) / 2 + 1;
  const glint = (Math.floor(time * 12) + Math.floor(z.x * 3 + z.y * 5)) % 5 === 0;
  g.strokeStyle = glint ? 'rgba(255,255,255,0.95)' : 'rgba(225,220,240,0.7)';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(Math.round(px - ux * L) + 0.5, Math.round(py - uy * L) + 0.5);
  g.lineTo(Math.round(px + ux * L) + 0.5, Math.round(py + uy * L) + 0.5);
  g.stroke();
  // Капелька клея.
  g.fillStyle = 'rgba(240,230,255,0.6)';
  g.fillRect(Math.round(px), Math.round(py), 1, 1);
  return true;
});

/** Натяг нити: линия наливается, в конце — вспышка разреза. */
registerZonePainter('f8_cut', (g, z0, px, py, S) => {
  const z = z0 as Strike;
  const k = Math.min(1, z.t / z.warn);
  g.save();
  g.translate(px, py);
  g.rotate(z.ang ?? 0);
  const w = (z.w ?? 0.3) * S;
  g.fillStyle = `rgba(255,80,160,${0.12 + 0.3 * k})`;
  g.fillRect(0, -w, z.r * S, w * 2);
  g.fillStyle = `rgba(255,240,255,${0.5 + 0.5 * k})`;
  g.fillRect(0, k > 0.85 ? -1 : 0, z.r * S * Math.min(1, k * 1.2), k > 0.85 ? 2 : 1);
  g.restore();
  return true;
});

/** Когти барабанщика: три борозды по полу. */
registerZonePainter('f8_claw', (g, z0, px, py, S) => {
  const z = z0 as Strike;
  const k = Math.min(1, z.t / z.warn);
  g.save();
  g.translate(px, py);
  g.rotate(z.ang ?? 0);
  const L = z.r * S;
  g.fillStyle = `rgba(255,150,60,${0.14 + 0.28 * k})`;
  g.fillRect(0, -(z.w ?? 0.25) * S, L, (z.w ?? 0.25) * S * 2);
  // Борозда бежит от барабанщика.
  g.fillStyle = `rgba(255,220,160,${0.4 + 0.5 * k})`;
  g.fillRect(0, 0, L * k, 1);
  for (let i = 0; i < L * k; i += 7) g.fillRect(i, -1, 2, 1);
  g.restore();
  return true;
});

/** Волна брюшного барабана — кольцо с точками томоэ. */
registerZonePainter('f8_boom', (g, z0, px, py, S, time) => {
  const z = z0 as Strike;
  const k = Math.min(1, z.t / z.warn);
  const R = z.r * S;
  const w = (z.w ?? 0.5) * S;
  g.strokeStyle = `rgba(255,140,60,${0.25 + 0.45 * k})`;
  g.lineWidth = w * 2 * (0.4 + 0.6 * k);
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.stroke();
  g.fillStyle = `rgba(255,230,180,${0.6 * k})`;
  for (let i = 0; i < 3; i++) {
    const a = time * 3 + (i / 3) * TAU;
    g.fillRect(Math.round(px + Math.cos(a) * R) - 1, Math.round(py + Math.sin(a) * R) - 1, 3, 3);
  }
  return true;
});

/** Когти сквозь бумагу: линия от стены с крюками. */
registerZonePainter('f8_claws', (g, z0, px, py, S) => {
  const z = z0 as Strike;
  const k = Math.min(1, z.t / z.warn);
  g.save();
  g.translate(px, py);
  g.rotate(z.ang ?? 0);
  const L = z.r * S;
  const w = (z.w ?? 0.4) * S;
  g.fillStyle = `rgba(255,40,40,${0.14 + 0.32 * k})`;
  g.fillRect(0, -w, L, w * 2);
  g.fillStyle = `rgba(255,230,210,${0.5 + 0.5 * k})`;
  const tip = L * (0.3 + 0.7 * k);
  for (const dy of [-3, 0, 3]) {
    g.fillRect(Math.round(tip - 4), dy, 4, 1);
    g.fillRect(Math.round(tip), dy + 1, 1, 1);
  }
  g.restore();
  return true;
});

/** Куда перенесётся бива: струна кольцом. */
registerZonePainter('f8_note', (g, z0, px, py, S, time) => {
  const z = z0 as Zone;
  const k = Math.min(1, z.t / Math.max(0.01, z.life));
  g.strokeStyle = `rgba(210,180,255,${0.8 - 0.5 * k})`;
  g.lineWidth = 1;
  g.beginPath();
  g.arc(px, py, z.r * S * (0.5 + k), 0, TAU);
  g.stroke();
  g.fillStyle = 'rgba(255,240,255,0.9)';
  const a = time * 8;
  g.fillRect(Math.round(px + Math.cos(a) * 5), Math.round(py + Math.sin(a) * 3), 1, 1);
  return true;
});

/** Горящее масло лопнувшего фонаря. */
registerZonePainter('f8_oil', (g, z0, px, py, S, time) => {
  const z = z0 as Zone;
  const warn = z.warn ?? 0;
  const life = z.t - warn;
  const fade = Math.max(0, Math.min(1, (z.life - life) / 0.6));
  g.fillStyle = `rgba(255,120,30,${(z.t < warn ? 0.15 : 0.28) * fade})`;
  g.beginPath();
  g.ellipse(px, py, z.r * S, z.r * S * 0.6, 0, 0, TAU);
  g.fill();
  if (z.t >= warn)
    for (let i = 0; i < 5; i++) {
      const a = i * 1.3 + z.id;
      const x = px + Math.cos(a) * z.r * S * 0.6;
      const y = py + Math.sin(a) * z.r * S * 0.35;
      const h = 2 + ((Math.floor(time * 10) + i) % 3);
      g.fillStyle = `rgba(255,${180 + i * 10},60,${0.8 * fade})`;
      g.fillRect(Math.round(x), Math.round(y - h), 1, h);
    }
  return true;
});

/** Серп на полу: тонкий полумесяц по дуге радиуса `R` вокруг центра. */
export function crescentArc(
  g: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  R: number,
  a0: number,
  a1: number,
  k: number,
  rgb: string,
): void {
  // Полумесяц: внешняя дуга ярче, внутренняя — тоньше; к концам сужается.
  g.fillStyle = `rgba(${rgb},${0.35 + 0.55 * k})`;
  g.beginPath();
  g.arc(cx, cy, R, a0, a1);
  const mid = (a0 + a1) / 2;
  const inner = R - Math.max(2, R * 0.12 * (0.5 + k));
  g.quadraticCurveTo(
    cx + Math.cos(mid) * inner,
    cy + Math.sin(mid) * inner,
    cx + Math.cos(a0) * R,
    cy + Math.sin(a0) * R,
  );
  g.fill();
}

/** Мозаика луны в полу арены: золотой полумесяц в кольце. */
registerZonePainter('f8_moonfloor', (g, z0, px, py, S) => {
  const z = z0 as Zone;
  const R = z.r * S;
  g.strokeStyle = 'rgba(232,184,74,0.45)';
  g.lineWidth = 1;
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.stroke();
  g.beginPath();
  g.arc(px, py, R - 3, 0, TAU);
  g.stroke();
  // Инкрустация полумесяца — тонкой золотой нитью, почти без заливки:
  // сплошной жёлтый серп спорил с ореолом самого демона.
  const r1 = R * 0.62;
  g.fillStyle = 'rgba(232,184,74,0.08)';
  g.beginPath();
  g.arc(px - 2, py, r1, -2.2, 2.2);
  g.arc(px + r1 * 0.35 - 2, py, r1 * 0.78, 2.0, -2.0, true);
  g.closePath();
  g.fill();
  g.strokeStyle = 'rgba(232,184,74,0.32)';
  g.stroke();
  // Семь точек-лун по кольцу.
  g.fillStyle = 'rgba(255,240,160,0.6)';
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU - Math.PI / 2;
    g.fillRect(
      Math.round(px + Math.cos(a) * (R - 1.5)) - 1,
      Math.round(py + Math.sin(a) * (R - 1.5)) - 1,
      2,
      2,
    );
  }
  return true;
});

/**
 * Помост бивы: низкий лаковый настил — верх с отражением, торец спереди,
 * золотые накладки по углам, красная подушка под сидящей.
 */
registerZonePainter('f8_dais', (g, z0, px, py, S) => {
  const z = z0 as Zone;
  const w = Math.round(z.r * S);
  const x0 = Math.round(px - w);
  const y0 = Math.round(py - S * 1.1);
  const W2 = w * 2;
  const H2 = Math.round(S * 1.9);
  // Торец (высота настила) — темнее, снизу.
  g.fillStyle = 'rgba(20,10,12,0.92)';
  g.fillRect(x0, y0 + H2 - 3, W2, 5);
  // Верх: чёрный лак.
  g.fillStyle = 'rgba(40,22,26,0.94)';
  g.fillRect(x0, y0, W2, H2 - 3);
  // Отражение фонарей — косая полоса.
  g.fillStyle = 'rgba(160,110,90,0.18)';
  for (let i = 0; i < 3; i++)
    g.fillRect(x0 + Math.round(W2 * (0.18 + i * 0.07)), y0 + 1, 2, H2 - 5);
  // Золотая кайма и накладки на углах.
  g.strokeStyle = 'rgba(232,184,74,0.8)';
  g.lineWidth = 1;
  g.strokeRect(x0 + 0.5, y0 + 0.5, W2 - 1, H2 - 4);
  g.fillStyle = 'rgba(255,216,120,0.95)';
  for (const [cx, cy] of [
    [x0, y0],
    [x0 + W2 - 3, y0],
    [x0, y0 + H2 - 6],
    [x0 + W2 - 3, y0 + H2 - 6],
  ])
    g.fillRect(cx, cy, 3, 3);
  // Золотой шов по торцу.
  g.fillStyle = 'rgba(232,184,74,0.55)';
  g.fillRect(x0 + 2, y0 + H2 - 2, W2 - 4, 1);
  // Подушка (дзабутон) под сидящей.
  g.fillStyle = 'rgba(150,34,32,0.95)';
  g.fillRect(Math.round(px - 6), Math.round(py - 3), 12, 8);
  g.fillStyle = 'rgba(200,70,56,0.9)';
  g.fillRect(Math.round(px - 5), Math.round(py - 3), 10, 2);
  return true;
});

/** Томоэ Барабанной: три запятые — знак барабана на полу. */
registerZonePainter('f8_tomoe', (g, z0, px, py, S, time) => {
  const z = z0 as Zone;
  const R = z.r * S;
  const beat = F8_CLOCK.now - (F8_CLOCK.beat ?? -9);
  const glow = beat < 0.6 ? 1 - beat / 0.6 : 0;
  g.strokeStyle = `rgba(200,50,40,${0.45 + 0.4 * glow})`;
  g.lineWidth = 2;
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.stroke();
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + time * 0.2;
    const x = px + Math.cos(a) * R * 0.45;
    const y = py + Math.sin(a) * R * 0.45;
    g.fillStyle = `rgba(160,30,26,${0.6 + 0.3 * glow})`;
    g.beginPath();
    g.arc(x, y, R * 0.24, 0, TAU);
    g.fill();
    g.beginPath();
    g.arc(x, y, R * 0.42, a + 0.4, a + 1.9);
    g.strokeStyle = `rgba(160,30,26,${0.6 + 0.3 * glow})`;
    g.stroke();
  }
  return true;
});

/** Вся Перевёрнутая комната дрожит: пыль, трещины по полу. */
registerZonePainter('f8_flipwarn', (g, z0, px, py, S, time) => {
  const z = z0 as Zone & { x0: number; y0: number; x1: number; y1: number };
  const k = Math.min(1, z.t / Math.max(0.01, z.life));
  const x0 = px + (z.x0 - z.x) * S;
  const y0 = py + (z.y0 - z.y) * S;
  const w = (z.x1 - z.x0 + 1) * S;
  const h = (z.y1 - z.y0 + 1) * S;
  const blink = Math.floor(time * (4 + 10 * k)) % 2 === 0;
  g.strokeStyle = blink ? 'rgba(255,90,60,0.9)' : 'rgba(255,220,150,0.5)';
  g.lineWidth = 2;
  g.strokeRect(x0 + 1, y0 + 1, w - 2, h - 2);
  g.fillStyle = `rgba(10,6,4,${0.12 * k})`;
  g.fillRect(x0, y0, w, h);
  // Сквозь татами проступает потолок: балки кессонов и золотые гвозди —
  // видно заранее, чем станет пол.
  const ga = Math.min(0.75, k * 0.9);
  g.fillStyle = `rgba(28,14,12,${ga})`;
  const jig = Math.round(Math.sin(time * 47) * k * 1.5);
  for (let gx = 0; gx <= w; gx += S * 2) g.fillRect(x0 + gx - 1 + jig, y0, 2, h);
  for (let gy = 0; gy <= h; gy += S * 2) g.fillRect(x0, y0 + gy - 1, w, 2);
  if (blink) {
    g.fillStyle = `rgba(255,204,64,${0.4 + 0.5 * k})`;
    for (let gx = 0; gx <= w; gx += S * 2)
      for (let gy = 0; gy <= h; gy += S * 2) g.fillRect(x0 + gx - 1 + jig, y0 + gy - 1, 2, 2);
  }
  // Пыль сыплется с «потолка».
  g.fillStyle = 'rgba(230,220,200,0.75)';
  for (let i = 0; i < 40 * k; i++) {
    const fx = x0 + ((i * 37 + 11) % Math.max(1, w));
    const fy = y0 + ((time * 60 + i * 23) % Math.max(1, h));
    g.fillRect(Math.round(fx), Math.round(fy), 1, 2);
  }
  return true;
});

/** Доска дрожит перед падением. */
registerZonePainter('f8_plank', (g, z0, px, py, S, time) => {
  const z = z0 as Zone & { xs: number[]; row: number };
  const k = Math.min(1, z.t / Math.max(0.01, z.life));
  const blink = Math.floor(time * (8 + 12 * k)) % 2 === 0;
  for (const x of z.xs) {
    const cx = px + (x - z.x) * S;
    const cy = py + (z.row - z.y) * S;
    const jit = Math.round(Math.sin(time * 70 + x) * k * 1.5);
    g.strokeStyle = blink ? 'rgba(255,80,50,0.95)' : 'rgba(255,200,120,0.55)';
    g.lineWidth = 1;
    g.strokeRect(cx + 0.5 + jit, cy + 0.5, S - 1, S - 1);
    g.fillStyle = `rgba(0,0,0,${0.3 * k})`;
    g.fillRect(cx + 2, cy + 3, S - 4, 1);
    g.fillRect(cx + 2, cy + 9, S - 4, 1);
  }
  return true;
});

/** Доски летят в пропасть: кувыркаются и тают. */
registerZonePainter('f8_planks_fall', (g, z0, px, py, S) => {
  const z = z0 as Zone & { xs: number[]; row: number };
  const k = Math.min(1, z.t / Math.max(0.01, z.life));
  for (const x of z.xs) {
    const cx = px + (x - z.x + 0.5) * S;
    const cy = py + (z.row - z.y + 0.5) * S + k * k * 10;
    const s = S * (1 - k * 0.7);
    g.save();
    g.translate(cx, cy);
    g.rotate(k * (x % 2 ? 1.8 : -1.4));
    g.fillStyle = `rgba(106,62,38,${1 - k})`;
    g.fillRect(-s / 2, -s / 4, s, s / 2);
    g.fillStyle = `rgba(40,24,16,${1 - k})`;
    g.fillRect(-s / 2, s / 4 - 1, s, 1);
    g.restore();
  }
  return true;
});

/** Доски всплывают обратно. */
registerZonePainter('f8_planks_rise', (g, z0, px, py, S) => {
  const z = z0 as Zone & { xs: number[]; row: number };
  const k = Math.min(1, z.t / Math.max(0.01, z.life));
  for (const x of z.xs) {
    const cx = px + (x - z.x) * S;
    const cy = py + (z.row - z.y) * S;
    g.fillStyle = `rgba(160,190,255,${0.5 * (1 - k)})`;
    g.fillRect(cx, cy + (1 - k) * 6, S, S * k);
  }
  return true;
});

/** Сюда вернуло с края: вспышка-кольцо. */
registerZonePainter('f8_land', (g, z0, px, py, S) => {
  const z = z0 as Zone;
  const k = Math.min(1, z.t / Math.max(0.01, z.life));
  g.strokeStyle = `rgba(255,240,200,${1 - k})`;
  g.lineWidth = 2;
  g.beginPath();
  g.arc(px, py, z.r * S * (0.4 + k), 0, TAU);
  g.stroke();
  g.fillStyle = `rgba(255,220,140,${0.4 * (1 - k)})`;
  g.beginPath();
  g.arc(px, py, z.r * S * 0.6, 0, TAU);
  g.fill();
  return true;
});

// ---------------------------------------------------------------------------
// Снаряды.
// ---------------------------------------------------------------------------

/** Огонёк фонарного духа: язычок, три кадра. */
registerShotPainter('f8_wisp', (s, time) => {
  const f = Math.floor(time * 14 + s.id) % 3;
  return cached(`wisp|${f}`, () => {
    const p = new Px(9, 11);
    shadeEll(p, 4.5, 7, 2.8, 2.6, tones('#c83a14', '#ff8a30', '#ffcc60', '#fff8d0'), 0.3);
    flame(p, 4, 5, 4 + (f === 1 ? 1 : 0), f);
    return spr(p, 4.5, 8);
  });
});

// ---------------------------------------------------------------------------
// Иконки вещей 10×10.
// ---------------------------------------------------------------------------

registerItemArt('f8mat', () => {
  const p = new Px(10, 10);
  // Лаковая щепа: красный лак сверху, светлое дерево на сломе.
  poly(
    p,
    [
      [1, 7],
      [7, 1],
      [9, 2],
      [3, 9],
    ],
    RED[2],
  );
  stroke(p, 2, 7, 7, 2, RED[3]);
  stroke(p, 3, 9, 9, 3, hx('#d8b888'));
  p.outline(INK);
  return p;
});
registerItemArt('f8_horn', () => {
  const p = new Px(10, 10);
  limb(p, 2, 8, 7, 2, 1.8, 0.5, tones('#141014', '#2a2228', '#4a3e48', '#7a6a78'));
  p.set(7, 1, hx('#d8d0e0'));
  p.outline(INK);
  return p;
});
registerItemArt('f8_silk', () => {
  const p = new Px(10, 10);
  shadeEll(p, 5, 5.5, 3.6, 3.4, tones('#8a849a', '#c0bad0', '#e8e4f0', '#ffffff'));
  for (let i = 0; i < 4; i++) stroke(p, 2, 3 + i * 1.6, 8, 4 + i * 1.6, hx('#9a94a8'));
  p.outline(INK);
  return p;
});
registerItemArt('f8_paper', () => {
  const p = new Px(10, 10);
  p.rect(1, 2, 8, 8, PAPER[2]);
  p.rect(1, 2, 8, 2, PAPER[3]);
  p.rect(5, 2, 5, 8, PAPER[1]);
  p.set(3, 5, hx('#ff8a30'));
  p.set(7, 6, RED[1]);
  p.outline(INK);
  return p;
});
registerItemArt('f8_string', () => {
  const p = new Px(10, 10);
  for (let a = 0; a < 40; a++) {
    const t = (a / 40) * TAU * 2;
    p.set(
      Math.round(5 + Math.cos(t) * (3.5 - a * 0.05)),
      Math.round(5 + Math.sin(t) * (3 - a * 0.04)),
      a % 3 ? hx('#d8c8ff') : hx('#9a88d0'),
    );
  }
  p.set(8, 8, GILT[2]);
  p.outline(INK);
  return p;
});
registerItemArt('f8_moonblade', () => {
  const p = new Px(10, 10);
  stroke(p, 1, 9, 3, 7, hx('#2a1a30'), 1.5);
  p.set(3, 7, GILT[2]);
  for (let i = 0; i < 6; i++) {
    p.set(4 + i, 6 - i, hx('#e8e0ff'));
    p.set(4 + i, 7 - i, hx('#8a7ac8'));
  }
  p.set(6, 4, hx('#ffd84a'));
  p.set(8, 2, hx('#ffd84a'));
  p.outline(INK);
  return p;
});
registerItemArt('f8_onigiri', () => {
  const p = new Px(10, 10);
  poly(
    p,
    [
      [5, 1],
      [9, 8],
      [1, 8],
    ],
    hx('#f4f0e8'),
  );
  p.rect(3, 6, 7, 8, hx('#1a2a1a'));
  p.set(4, 3, hx('#ffffff'));
  p.outline(INK);
  return p;
});
registerItemArt('f8_spiderleg', () => {
  const p = new Px(10, 10);
  limb(p, 1, 8, 5, 3, 1.2, 0.9, tones('#2a1a2a', '#4a2a44', '#6a3e62', '#9a6090'));
  limb(p, 5, 3, 9, 6, 0.9, 0.5, tones('#2a1a2a', '#4a2a44', '#6a3e62', '#9a6090'));
  p.outline(INK);
  return p;
});
registerItemArt('f8_mochi', () => {
  const p = new Px(10, 10);
  shadeEll(p, 5, 6, 4, 3, tones('#b8b0c8', '#e0dcea', '#f4f2fa', '#ffffff'));
  p.ell(5, 4.5, 2, 1.4, hx('#f0d0e0'));
  p.set(7, 3, hx('#ffd84a'));
  p.outline(INK);
  return p;
});

// ---------------------------------------------------------------------------
// Монстры: общий конвейер кадра (облик, вспышка, отражение, кеш).
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
  build: () => Built,
): MobFrame {
  const key = `${kind}|${anim}|${f}|${pose.left ? 1 : 0}|${pose.flash ? 1 : 0}|${pose.look}`;
  const hit = frames.get(key);
  if (hit) return hit;
  return finish(key, build(), pose.look, pose.flash, pose.left);
}

/** Кадр по модулю: номер кадра движка растёт со временем. */
const mod = (f: number, n: number) => ((Math.floor(f) % n) + n) % n;
/** Время в режиме — ступенями (кеш не растёт на каждой сотой секунды). */
const tq = (t: number, step = 0.1, max = 30) => Math.min(max, Math.max(0, Math.floor(t / step)));

/** Звёзды над головой оглушённого. */
function stars(p: Px, cx: number, cy: number, rx: number, f: number): void {
  for (let i = 0; i < 3; i++) {
    const a = (f / 4) * TAU + (i / 3) * TAU;
    const x = Math.round(cx + Math.cos(a) * rx);
    const y = Math.round(cy + Math.sin(a) * rx * 0.35);
    p.set(x, y, hx('#ffffff'));
    p.set(x - 1, y, hx('#fff27a'));
    p.set(x + 1, y, hx('#fff27a'));
    p.set(x, y - 1, hx('#fff27a'));
  }
}

// ---------------------------------------------------------------------------
// Скелет демона: таз, торс с наклоном, голова, ноги, любое число рук.
// Одежда — кимоно с широкими рукавами и хакама (широкие штаны).
// ---------------------------------------------------------------------------

interface Arm {
  sh: V;
  el: V;
  ha: V;
  far: boolean;
}

interface Rig {
  s: number;
  hip: V;
  lean: number;
  torso: number;
  head: V;
  headR: number;
  legF: [V, V, V];
  legN: [V, V, V];
  arms: Arm[];
  squint: boolean;
  mouth: number;
  /** Что в руке/за спиной — рисуется слоем. */
  items: { layer: 'back' | 'mid' | 'hand'; draw: (p: Px) => void }[];
}

interface Style {
  skin: Tones;
  top: Tones;
  pants: Tones;
  under: RGBA;
  sash: RGBA;
  hair: Tones | null;
  hairKind: 'knot' | 'long' | 'wild' | 'bald' | 'tail';
  horns: 0 | 1 | 2;
  horn: Tones;
  eye: RGBA;
  /** Ширина плеч и пояса. */
  bulk: number;
  /** Рукав: 0 — голая рука, 1 — широкий рукав кимоно. */
  sleeve: number;
  /** Хакама — широкие штаны; нет — набедренная повязка. */
  hakama: boolean;
  /** Узор на ткани (точки гербов). */
  crest?: RGBA;
  /** Живот барабаном. */
  belly?: boolean;
  fang?: boolean;
  /** Ширина пояса-оби (по умолчанию от масштаба). */
  sashW?: number;
}

const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1]];
const lerp = (a: V, b: V, k: number): V => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
const neckOf = (r: Rig): V => add(r.hip, [Math.sin(r.lean) * r.torso, -Math.cos(r.lean) * r.torso]);

function drawLeg(p: Px, l: [V, V, V], st: Style, s: number, far: boolean): void {
  const t = far ? (st.pants.map((c) => darker(c, 0.25)) as Tones) : st.pants;
  if (st.hakama) {
    // Штанина хакама — расширяется книзу, складки.
    const w0 = 1.6 * s;
    const w1 = 2.6 * s;
    const [a, b, c] = l;
    const dir = Math.atan2(c[1] - a[1], c[0] - a[0]);
    const nx = -Math.sin(dir);
    const ny = Math.cos(dir);
    shadePoly(
      p,
      [
        [a[0] + nx * w0, a[1] + ny * w0],
        [b[0] + nx * w0 * 1.15, b[1] + ny * w0 * 1.15],
        [c[0] + nx * w1, c[1]],
        [c[0] - nx * w1, c[1]],
        [b[0] - nx * w0 * 1.15, b[1] - ny * w0 * 1.15],
        [a[0] - nx * w0, a[1] - ny * w0],
      ],
      t,
    );
    // Складка посередине.
    stroke(p, lerp(a, b, 0.3)[0], lerp(a, b, 0.3)[1], c[0], c[1] - 1, t[0]);
    // Таби — ступня.
    p.set(Math.round(c[0] + 1), Math.round(c[1]), far ? hx('#b8b0a0') : hx('#ece4d4'));
    p.set(Math.round(c[0] + 2), Math.round(c[1]), far ? hx('#8a8478') : hx('#c8c0b0'));
    return;
  }
  const sk = far ? (st.skin.map((c) => darker(c, 0.25)) as Tones) : st.skin;
  limb(p, l[0][0], l[0][1], l[1][0], l[1][1], 1.3 * s, 1.1 * s, sk);
  limb(p, l[1][0], l[1][1], l[2][0], l[2][1], 1.1 * s, 0.9 * s, sk);
  p.set(Math.round(l[2][0] + 1), Math.round(l[2][1]), sk[0]);
}

function drawArm(p: Px, a: Arm, st: Style, s: number): void {
  const far = a.far;
  const cloth = far ? (st.top.map((c) => darker(c, 0.3)) as Tones) : st.top;
  const sk = far ? (st.skin.map((c) => darker(c, 0.3)) as Tones) : st.skin;
  if (st.sleeve > 0) {
    // Широкий рукав: плечо — локоть, и полотнище свисает вниз.
    limb(p, a.sh[0], a.sh[1], a.el[0], a.el[1], 1.4 * s, 1.5 * s, cloth);
    const drop = 2.6 * s * st.sleeve;
    shadePoly(
      p,
      [
        [a.sh[0] - 0.6 * s, a.sh[1]],
        [a.el[0] + 1.2 * s, a.el[1] - 0.6 * s],
        [a.el[0] + 1 * s, a.el[1] + drop],
        [lerp(a.sh, a.el, 0.4)[0], lerp(a.sh, a.el, 0.4)[1] + drop * 0.8],
      ],
      cloth,
    );
    // Кромка рукава — светлая.
    stroke(
      p,
      a.el[0] + 1.1 * s,
      a.el[1] - 0.4 * s,
      a.el[0] + 1 * s,
      a.el[1] + drop - 0.5,
      cloth[2],
    );
    limb(p, a.el[0], a.el[1], a.ha[0], a.ha[1], 0.9 * s, 0.8 * s, sk);
  } else {
    limb(p, a.sh[0], a.sh[1], a.el[0], a.el[1], 1.2 * s, 1 * s, sk);
    limb(p, a.el[0], a.el[1], a.ha[0], a.ha[1], 1 * s, 0.85 * s, sk);
  }
  // Кисть с когтями.
  p.ell(a.ha[0], a.ha[1], 0.9 * s, 0.9 * s, sk[far ? 1 : 2]);
  const ang = Math.atan2(a.ha[1] - a.el[1], a.ha[0] - a.el[0]);
  p.set(
    Math.round(a.ha[0] + Math.cos(ang) * 1.3 * s),
    Math.round(a.ha[1] + Math.sin(ang) * 1.3 * s),
    hx('#e8e0d0'),
  );
}

function drawTorso(p: Px, r: Rig, st: Style): void {
  const s = r.s;
  const neck = neckOf(r);
  const wS = 2.5 * s * st.bulk;
  const wW = 2.2 * s * st.bulk * (st.belly ? 1.35 : 1);
  const nx = Math.cos(r.lean);
  const ny = Math.sin(r.lean);
  // Корпус: трапеция плечи — пояс; спина слева, грудь справа.
  const pts: V[] = [
    [neck[0] - wS * nx * 0.9, neck[1] - wS * ny * 0.9],
    [neck[0] + wS * nx, neck[1] + wS * ny],
    [r.hip[0] + wW * nx * 1.05, r.hip[1] + wW * ny],
    [r.hip[0] - wW * nx, r.hip[1] - wW * ny],
  ];
  shadePoly(p, pts, st.top);
  if (st.belly) {
    // Живот барабаном: круглый, туго.
    shadeEll(p, r.hip[0] + wW * 0.5, r.hip[1] - 2.2 * s, 2.6 * s, 2.8 * s, st.skin, 0.1);
  }
  // Ворот: светлая косая полоса нижнего кимоно от шеи к поясу.
  const c0 = lerp(pts[1], pts[0], 0.35);
  const c1: V = [r.hip[0] + wW * 0.4, r.hip[1] - 1.8 * s];
  stroke(p, c0[0], c0[1], c1[0], c1[1], st.under);
  stroke(p, c0[0] + 1, c0[1], c1[0] + 1, c1[1], darker(st.under, 0.3));
  // Пояс-оби.
  const b0 = lerp(pts[3], pts[0], 0.12);
  const b1 = lerp(pts[2], pts[1], 0.12);
  stroke(p, b0[0], b0[1], b1[0], b1[1], st.sash, st.sashW ?? Math.max(1, 1.6 * s));
  // Гербы на ткани.
  if (st.crest) {
    const m = lerp(neck, r.hip, 0.45);
    p.set(Math.round(m[0] - 1 * s), Math.round(m[1]), st.crest);
  }
}

function drawHead(p: Px, r: Rig, st: Style, look: 'normal' | 'angry' = 'normal'): void {
  const [hxp, hyp] = r.head;
  const R = r.headR;
  // Волосы сзади — до головы.
  if (st.hair && (st.hairKind === 'long' || st.hairKind === 'tail')) {
    const h = st.hair;
    if (st.hairKind === 'long')
      shadePoly(
        p,
        [
          [hxp - R * 0.2, hyp - R],
          [hxp - R * 1.3, hyp - R * 0.2],
          [hxp - R * 1.6, hyp + R * 3.2],
          [hxp - R * 0.3, hyp + R * 2.4],
        ],
        h,
      );
    else {
      // Хвост: высокий узел на затылке и тяжёлая прядь по спине.
      shadeEll(p, hxp - R * 0.75, hyp - R * 0.75, R * 0.5, R * 0.45, h);
      limb(p, hxp - R * 1.0, hyp - R * 0.6, hxp - R * 1.9, hyp + R * 1.2, R * 0.5, R * 0.42, h);
      limb(p, hxp - R * 1.9, hyp + R * 1.2, hxp - R * 1.7, hyp + R * 3.0, R * 0.42, R * 0.18, h);
    }
  }
  // Дальний рог — за головой, темнее.
  const horn = (bx: number, by: number, k: number, far: boolean) => {
    const t = far ? (st.horn.map((c) => darker(c, 0.35)) as Tones) : st.horn;
    // Рог они: растёт со лба вверх и загибается вперёд.
    const m: V = [bx + R * 0.3 * k, by - R * 0.62 * k];
    const tip: V = [bx + R * 1.05 * k, by - R * 0.95 * k];
    limb(p, bx, by, m[0], m[1], R * 0.3, R * 0.22, t);
    limb(p, m[0], m[1], tip[0], tip[1], R * 0.22, R * 0.06, t);
  };
  if (st.horns === 2) horn(hxp - R * 0.1, hyp - R * 0.8, 1, true);
  // Череп и лицо в профиль: лоб, прямой нос, подбородок — без морды.
  shadeEll(p, hxp - R * 0.05, hyp - R * 0.05, R, R * 1.02, st.skin);
  shadeEll(p, hxp + R * 0.28, hyp + R * 0.45, R * 0.6, R * 0.55, st.skin, 0.05);
  // Нос — один пиксель вперёд.
  p.set(Math.round(hxp + R * 0.98), Math.round(hyp + R * 0.08), st.skin[1]);
  if (st.hair) {
    const h = st.hair;
    if (st.hairKind === 'knot') {
      // Макушка и узел-тонмагэ.
      poly(
        p,
        [
          [hxp - R, hyp + R * 0.1],
          [hxp - R * 0.8, hyp - R * 0.9],
          [hxp + R * 0.55, hyp - R * 1.05],
          [hxp + R * 0.35, hyp - R * 0.55],
          [hxp - R * 0.35, hyp - R * 0.3],
        ],
        h[1],
      );
      limb(p, hxp - R * 0.3, hyp - R * 1.05, hxp + R * 0.4, hyp - R * 1.4, R * 0.3, R * 0.25, h);
    } else if (st.hairKind === 'wild') {
      for (let i = 0; i < 6; i++) {
        const a = -Math.PI * 1.02 + i * 0.3;
        stroke(
          p,
          hxp + Math.cos(a) * R * 0.6,
          hyp + Math.sin(a) * R * 0.6,
          hxp + Math.cos(a) * R * 1.55 - R * 0.2,
          hyp + Math.sin(a) * R * 1.45,
          h[i % 2 ? 1 : 2],
        );
      }
      poly(
        p,
        [
          [hxp - R * 1.05, hyp + R * 0.3],
          [hxp - R * 0.9, hyp - R * 0.9],
          [hxp + R * 0.45, hyp - R * 1.05],
          [hxp + R * 0.25, hyp - R * 0.55],
          [hxp - R * 0.3, hyp - R * 0.2],
        ],
        h[1],
      );
    } else if (st.hairKind === 'long' || st.hairKind === 'tail') {
      // Макушка и чёлка: пряди падают на лоб.
      poly(
        p,
        [
          [hxp - R * 1.05, hyp + R * 0.5],
          [hxp - R * 0.95, hyp - R * 0.9],
          [hxp + R * 0.2, hyp - R * 1.1],
          [hxp + R * 0.85, hyp - R * 0.6],
          [hxp + R * 0.75, hyp - R * 0.25],
          [hxp + R * 0.35, hyp - R * 0.45],
          [hxp - R * 0.25, hyp - R * 0.25],
          [hxp - R * 0.45, hyp + R * 0.5],
        ],
        h[1],
      );
      stroke(p, hxp - R * 0.7, hyp - R * 0.85, hxp + R * 0.3, hyp - R * 1.0, h[2]);
    }
  }
  if (st.horns === 1) horn(hxp + R * 0.35, hyp - R * 0.8, 1.15, false);
  else if (st.horns === 2) horn(hxp + R * 0.45, hyp - R * 0.72, 1, false);
  void look;
}

/** Глаз и рот поверх контура. */
function drawFace(p: Px, r: Rig, st: Style, dead = false): [number, number] {
  const [hxp, hyp] = r.head;
  const R = r.headR;
  const ex = Math.round(hxp + R * 0.5);
  const ey = Math.round(hyp - R * 0.1);
  if (dead) {
    p.set(ex - 1, ey - 1, INK);
    p.set(ex, ey, INK);
    p.set(ex + 1, ey + 1, INK);
    p.set(ex + 1, ey - 1, INK);
    p.set(ex - 1, ey + 1, INK);
    return [ex, ey];
  }
  // Бровь — злой излом над глазом.
  p.set(ex - 1, ey - 2, darker(st.skin[0], 0.5));
  p.set(ex, ey - 1, darker(st.skin[0], 0.5));
  p.set(ex + 1, ey - 1, darker(st.skin[0], 0.35));
  if (r.squint) {
    p.set(ex, ey, INK);
    p.set(ex + 1, ey, INK);
  } else {
    p.set(ex, ey, lighter(st.eye, 0.55));
    p.set(ex + 1, ey, st.eye);
    if (R > 3.4) p.set(ex + 1, ey + 1, darker(st.eye, 0.35));
  }
  // Рот: щель у подбородка, клык.
  const mx = Math.round(hxp + R * 0.62);
  const my = Math.round(hyp + R * 0.62);
  if (r.mouth > 0.3) {
    p.set(mx, my, hx('#2a0a0a'));
    p.set(mx + 1, my, hx('#2a0a0a'));
    p.set(mx, my + 1, hx('#5a1010'));
  } else p.set(mx, my, darker(st.skin[0], 0.4));
  if (st.fang !== false) p.set(mx + 1, my - 1 + (r.mouth > 0.3 ? 2 : 1), hx('#f4ecd8'));
  return [ex, ey];
}

function drawRig(
  r: Rig,
  st: Style,
  W: number,
  H: number,
  dead = false,
): { p: Px; eye: [number, number] } {
  const p = new Px(W, H);
  for (const it of r.items) if (it.layer === 'back') it.draw(p);
  for (const a of r.arms) if (a.far) drawArm(p, a, st, r.s);
  drawLeg(p, r.legF, st, r.s, true);
  drawLeg(p, r.legN, st, r.s, false);
  drawTorso(p, r, st);
  for (const it of r.items) if (it.layer === 'mid') it.draw(p);
  drawHead(p, r, st);
  for (const a of r.arms) if (!a.far) drawArm(p, a, st, r.s);
  for (const it of r.items) if (it.layer === 'hand') it.draw(p);
  p.outline(INK);
  const eye = drawFace(p, r, st, dead);
  return { p, eye };
}

/** Катана: цуба, рукоять с оплёткой, клинок с бликом. */
function katana(
  p: Px,
  hand: V,
  ang: number,
  len: number,
  o: { glow?: RGBA; dark?: boolean } = {},
): void {
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  // Рукоять — назад от кисти.
  stroke(p, hand[0] - ux * 2.5, hand[1] - uy * 2.5, hand[0], hand[1], hx('#1a1418'), 1.6);
  p.set(Math.round(hand[0] - ux * 1.5), Math.round(hand[1] - uy * 1.5), hx('#e8e0d0'));
  // Цуба.
  p.set(Math.round(hand[0] + ux * 0.8 - uy), Math.round(hand[1] + uy * 0.8 + ux), GILT[1]);
  p.set(Math.round(hand[0] + ux * 0.8 + uy), Math.round(hand[1] + uy * 0.8 - ux), GILT[2]);
  // Клинок: лёгкий изгиб, светлая кромка.
  const steel = o.dark ? hx('#6a6478') : hx('#c8ccd8');
  const edge = o.glow ?? (o.dark ? hx('#a8a0c0') : hx('#ffffff'));
  for (let i = 1; i <= len; i++) {
    const bend = (i / len) ** 2 * 1.2;
    const x = hand[0] + ux * i - uy * bend * -1;
    const y = hand[1] + uy * i - ux * bend;
    p.set(Math.round(x), Math.round(y), steel);
    p.set(Math.round(x - uy * 0.9), Math.round(y + ux * 0.9), i % 3 ? edge : steel);
  }
}

/** Поза двуногого по анимации: смещения суставов от таза и плеча. */
interface PoseIn {
  anim: string;
  f: number;
  mode: string;
  t: number;
}

function bipedRig(o: {
  s: number;
  W: number;
  H: number;
  legLen: number;
  torso: number;
  headR: number;
  arms: number;
  pose: PoseIn;
  lean?: number;
  runFrames?: number;
  heavy?: boolean;
}): Rig {
  const { s, pose } = o;
  const gy = o.H - 2;
  const cx = Math.round(o.W / 2) - 1;
  let hip: V = [cx, gy - o.legLen];
  let lean = o.lean ?? 0.12;
  let bob = 0;
  let squint = false;
  let mouth = 0;
  // Ноги: колено и стопа относительно таза [dx, dy]; стопа на земле.
  let kneeF: V = [0.6 * s, o.legLen * 0.5];
  let kneeN: V = [1.2 * s, o.legLen * 0.5];
  let footF: V = [-1.2 * s, 0];
  let footN: V = [1.4 * s, 0];
  // Руки: локоть и кисть от плеча.
  let elF: V = [0.4 * s, 2.6 * s];
  let haF: V = [1.6 * s, 4.6 * s];
  let elN: V = [0.8 * s, 2.6 * s];
  let haN: V = [2.4 * s, 4.4 * s];
  const ph = (n: number) => (pose.f / n) * TAU;
  switch (pose.anim) {
    case 'idle': {
      bob = [0, 0.3, 0.5, 0.3][mod(pose.f, 4)] * s;
      haN = [2.4 * s, (4.4 + bob * 0.3) * s];
      break;
    }
    case 'run': {
      const n = o.runFrames ?? 6;
      const p = ph(n);
      lean = (o.lean ?? 0.12) + (o.heavy ? 0.1 : 0.28);
      bob = Math.abs(Math.sin(p)) * (o.heavy ? 0.6 : 1) * s;
      const sw = Math.cos(p) * 2.6 * s;
      const lift = (k: number) => Math.max(0, Math.sin(p + k)) * 1.8 * s;
      footN = [1.2 * s + sw, lift(0)];
      footF = [-0.6 * s - sw, lift(Math.PI)];
      kneeN = [1.6 * s + sw * 0.6, o.legLen * 0.5 - lift(0) * 0.6];
      kneeF = [0.8 * s - sw * 0.6, o.legLen * 0.5 - lift(Math.PI) * 0.6];
      elN = [0.4 * s - sw * 0.35, 2.4 * s];
      haN = [2 * s - sw * 0.7, 4 * s];
      elF = [0.4 * s + sw * 0.3, 2.4 * s];
      haF = [1.6 * s + sw * 0.6, 4 * s];
      break;
    }
    case 'wind': {
      const k = pose.f === 0 ? 0.6 : 1;
      lean = -0.05;
      elN = [-1.6 * s * k, -0.4 * s];
      haN = [-2.6 * s * k, -2.4 * s * k];
      elF = [1.2 * s, 1.8 * s];
      haF = [2.8 * s, 2.4 * s];
      kneeN = [2.2 * s, o.legLen * 0.45];
      footN = [2.6 * s, 0];
      kneeF = [0.2 * s, o.legLen * 0.5];
      footF = [-2.2 * s, 0];
      mouth = 0.6 * k;
      break;
    }
    case 'bite': {
      const k = pose.f === 0 ? 1 : 0.6;
      lean = 0.5;
      hip = [hip[0] + 1 * s * k, hip[1] + 0.3 * s];
      elN = [2.4 * s * k, 0.6 * s];
      haN = [5 * s * k, 0.8 * s];
      elF = [-0.4 * s, 2.2 * s];
      haF = [-0.6 * s, 4 * s];
      kneeN = [2.6 * s, o.legLen * 0.4];
      footN = [3.2 * s, 0];
      kneeF = [-0.6 * s, o.legLen * 0.5];
      footF = [-3 * s, 0];
      mouth = 0.9 * k;
      break;
    }
    case 'hurt':
      lean = -0.25;
      hip = [hip[0] - 1 * s, hip[1]];
      squint = true;
      mouth = 0.5;
      elN = [0.6 * s, 0.6 * s];
      haN = [2.2 * s, -1 * s];
      break;
    case 'sleep': {
      // Сидит на пятках (сэйдза), голова опущена.
      const k = mod(pose.f, 2) === 0 ? 0 : 0.3;
      hip = [hip[0] - 0.4 * s, gy - o.legLen * 0.45 + k * s];
      lean = 0.25;
      squint = true;
      kneeN = [2.6 * s, o.legLen * 0.45];
      kneeF = [2.2 * s, o.legLen * 0.45];
      footN = [-1.6 * s, 0];
      footF = [-2 * s, 0];
      elN = [1.6 * s, 2 * s];
      haN = [2.8 * s, 3.2 * s];
      break;
    }
  }
  hip = [hip[0], hip[1] - bob];
  const r: Rig = {
    s,
    hip,
    lean,
    torso: o.torso,
    head: [0, 0],
    headR: o.headR,
    legF: [add(hip, [-0.6 * s, 0.2 * s]), [0, 0], [0, 0]],
    legN: [add(hip, [0.6 * s, 0.4 * s]), [0, 0], [0, 0]],
    arms: [],
    squint,
    mouth,
    items: [],
  };
  const neck = neckOf(r);
  r.head = add(neck, [
    0.8 * s + Math.sin(lean) * 1.2 * s,
    -o.headR * 0.95 - (pose.anim === 'sleep' ? -1.2 * s : 0),
  ]);
  const gnd = (x: number, lift: number): V => [hip[0] + x, gy - lift];
  r.legF[1] = add(r.legF[0], kneeF);
  r.legF[2] = gnd(footF[0] - 0.4 * s, footF[1]);
  r.legN[1] = add(r.legN[0], kneeN);
  r.legN[2] = gnd(footN[0] + 0.4 * s, footN[1]);
  if (pose.anim === 'sleep') {
    r.legF[2] = [hip[0] + footF[0], gy];
    r.legN[2] = [hip[0] + footN[0], gy];
    r.legF[1] = [hip[0] + kneeF[0], gy - 0.8 * s];
    r.legN[1] = [hip[0] + kneeN[0], gy - 0.6 * s];
  }
  const sh = add(neck, [-0.2 * s, 1 * s]);
  r.arms.push({ sh: add(sh, [-0.6 * s, 0]), el: add(sh, elF), ha: add(sh, haF), far: true });
  r.arms.push({ sh: add(sh, [0.4 * s, 0.2 * s]), el: add(sh, elN), ha: add(sh, haN), far: false });
  return r;
}

function deadRig(r: Rig, H: number): Rig {
  // Лежит на спине: торс вдоль земли, руки и ноги раскиданы.
  const s = r.s;
  const gy = H - 3;
  r.hip = [r.hip[0] - 3 * s, gy - 1.2 * s];
  r.lean = Math.PI / 2 + 0.1;
  const neck = neckOf(r);
  r.head = add(neck, [r.headR * 0.9, -0.2 * s]);
  r.legF = [r.hip, add(r.hip, [-2 * s, -1.2 * s]), add(r.hip, [-4 * s, -0.4 * s])];
  r.legN = [r.hip, add(r.hip, [-2.4 * s, 0.4 * s]), add(r.hip, [-4.6 * s, 1 * s])];
  const sh = add(neck, [-0.6 * s, -0.2 * s]);
  r.arms = r.arms.map((a, i) => ({
    sh,
    el: add(sh, [i % 2 ? 1.4 * s : -0.6 * s, -1.8 * s - i * 0.4 * s]),
    ha: add(sh, [i % 2 ? 3 * s : 0.4 * s, -2.6 * s - i * 0.3 * s]),
    far: a.far,
  }));
  r.squint = false;
  return r;
}

/** Вход анимации: поза движка плюс свои режимы вида. */
function poseIn(pose: MobPose, runFrames = 6): PoseIn {
  let f = pose.frame;
  const n =
    pose.anim === 'run' ? runFrames : pose.anim === 'idle' ? 4 : pose.anim === 'sleep' ? 2 : 2;
  f = mod(f, n);
  return { anim: pose.anim, f, mode: pose.mode, t: pose.t };
}

// ---------------------------------------------------------------------------
// Бес-прислужник: мелкий, рогатый, прыгает.
// ---------------------------------------------------------------------------

const IMP_ST: Style = {
  skin: tones('#5a1a14', '#8a2a1c', '#b8442a', '#e07048'),
  top: tones('#2a1a14', '#3e281c', '#5a3a26', '#7a5234'),
  pants: tones('#2a1a14', '#3e281c', '#5a3a26', '#7a5234'),
  under: hx('#c8b898'),
  sash: hx('#3a2a1a'),
  hair: null,
  hairKind: 'bald',
  horns: 1,
  horn: tones('#8a7a58', '#c8b888', '#ece0b0', '#fff8d8'),
  eye: hx('#ffd040'),
  bulk: 1.1,
  sleeve: 0,
  hakama: false,
};

registerMobPainter('f8_imp', (m: Mob, pose: MobPose) => {
  const pi = poseIn(pose, 6);
  let anim = pi.anim;
  let f = pi.f;
  if (pose.mode === 'aim') {
    anim = 'wind';
    f = pose.t < 0.2 ? 0 : 1;
  } else if (pose.mode === 'leap') {
    anim = 'leap';
    f = 0;
  } else if (pose.mode === 'f8_out') {
    anim = 'run';
    f = mod(pose.t * 10, 6);
  }
  return frameOf('f8_imp', pose, anim, f, () => {
    const W = 26;
    const H = 24;
    const s = 0.72;
    const r = bipedRig({
      s,
      W,
      H,
      legLen: 5.2,
      torso: 4.2,
      headR: 3.9,
      arms: 2,
      pose: { ...pi, anim: anim === 'leap' ? 'bite' : anim, f },
    });
    if (anim === 'leap') {
      // В прыжке: вытянулся вперёд, ноги назад, когти перед собой.
      r.hip = add(r.hip, [0, -3]);
      r.lean = 1.1;
      const neck = neckOf(r);
      r.head = add(neck, [2.6, -1]);
      r.legF[2] = add(r.hip, [-4, 1]);
      r.legN[2] = add(r.hip, [-3, 2.4]);
      r.legF[1] = lerp(r.legF[0], r.legF[2], 0.5);
      r.legN[1] = lerp(r.legN[0], r.legN[2], 0.5);
      for (const a of r.arms) {
        a.sh = add(neck, [0, 1]);
        a.el = add(a.sh, [2.2, 0.4]);
        a.ha = add(a.sh, [4.2, a.far ? -0.6 : 0.8]);
      }
      r.mouth = 1;
    }
    if (anim === 'dead') deadRig(r, H);
    // Хвост с наконечником-лопаткой — силуэт беса.
    r.items.push({
      layer: 'back',
      draw: (p) => {
        const wag =
          anim === 'run' ? Math.sin(f) * 1.2 : anim === 'idle' ? [0, 0.5, 1, 0.5][f % 4] : 0;
        const a: V = add(r.hip, [-1, 0.6]);
        const b: V = add(r.hip, [-4.5, -0.5 + wag]);
        const c: V = add(r.hip, [-6.2, -3.6 + wag]);
        const t = IMP_ST.skin;
        limb(p, a[0], a[1], b[0], b[1], 0.7, 0.55, t);
        limb(p, b[0], b[1], c[0], c[1], 0.55, 0.45, t);
        poly(
          p,
          [
            [c[0] - 1.6, c[1] + 0.4],
            [c[0] + 0.2, c[1] - 2.2],
            [c[0] + 1.4, c[1] + 0.6],
            [c[0], c[1] + 0.2],
          ],
          t[1],
        );
      },
    });
    // Набедренная повязка вместо хакама.
    r.items.push({
      layer: 'mid',
      draw: (p) => {
        p.rect(
          Math.round(r.hip[0] - 1.6),
          Math.round(r.hip[1] - 0.5),
          Math.round(r.hip[0] + 1.6),
          Math.round(r.hip[1] + 1),
          hx('#e8dcc0'),
        );
        p.set(Math.round(r.hip[0] + 0.5), Math.round(r.hip[1] + 2), hx('#c8b898'));
      },
    });
    const { p, eye } = drawRig(r, IMP_ST, W, H, anim === 'dead');
    if (pose.mode === 'stun') stars(p, r.head[0], r.head[1] - 4, 3, mod(pose.t * 8, 4));
    return { p, ax: Math.round(W / 2), ay: H - 2, eye: anim === 'dead' ? null : eye };
  });
});

// ---------------------------------------------------------------------------
// Демон-мечник: хаори, хакама, два рожка, катана. Выпады сериями.
// ---------------------------------------------------------------------------

const BLADE_ST: Style = {
  skin: tones('#6a6070', '#9a90a0', '#c8c0cc', '#ece6ee'),
  top: tones('#141828', '#222a44', '#34406a', '#4e5c90'),
  pants: tones('#2a2a30', '#3e3e48', '#5a5a66', '#7a7a88'),
  under: hx('#e8e0d0'),
  sash: hx('#8a1a18'),
  hair: tones('#0a0a0e', '#16161e', '#262634', '#3a3a50'),
  hairKind: 'tail',
  horns: 1,
  horn: tones('#7a6a58', '#b8a88e', '#e0d4bc', '#fff6e0'),
  eye: hx('#ff5040'),
  bulk: 1,
  sleeve: 0.9,
  hakama: true,
  crest: hx('#e8b84a'),
};

/** Кадр мечника по режиму: свои позы стойки, выпада, окна. */
registerMobPainter('f8_blade', (m: Mob, pose: MobPose) => {
  const pi = poseIn(pose, 6);
  let anim: string = pi.anim;
  let f = pi.f;
  const mode = pose.mode;
  if (mode === 'aim') {
    anim = 'iai';
    f = pose.t < 0.25 ? 0 : 1;
  } else if (mode === 'lunge') {
    anim = 'lunge';
    f = 0;
  } else if (mode === 'recover' && m.data.long) {
    anim = 'pant';
    f = mod(pose.t * 5, 2);
  } else if (mode === 'f8_out') {
    anim = 'run';
    f = mod(pose.t * 10, 6);
  }
  return frameOf('f8_blade', pose, anim, f, () => {
    const W = 36;
    const H = 32;
    const s = 0.95;
    const base = anim === 'iai' || anim === 'lunge' || anim === 'pant' ? 'idle' : anim;
    const r = bipedRig({
      s,
      W,
      H,
      legLen: 8.5,
      torso: 7,
      headR: 3.6,
      arms: 2,
      pose: { ...pi, anim: base, f },
    });
    let blade = { ang: 0.9, len: 11, sheath: false };
    if (anim === 'iai') {
      // Иай: присел, ладонь на рукояти у бедра — сейчас вырвет клинок.
      r.hip = add(r.hip, [0, 1.6]);
      r.lean = 0.55;
      const neck = neckOf(r);
      r.head = add(neck, [2, -2.8]);
      r.legN[1] = add(r.legN[0], [3, 2]);
      r.legN[2] = [r.hip[0] + 4, H - 2];
      r.legF[1] = add(r.legF[0], [-1.4, 3]);
      r.legF[2] = [r.hip[0] - 4, H - 2];
      const sh = add(neck, [0, 1]);
      r.arms[1] = { sh, el: add(sh, [0.4, 3]), ha: add(r.hip, [1.4, 0.4]), far: false };
      r.arms[0] = {
        sh: add(sh, [-0.6, 0]),
        el: add(sh, [1.2, 2.6]),
        ha: add(r.hip, [2.2, 0]),
        far: true,
      };
      blade = { ang: f ? 3.35 : 3.0, len: 11, sheath: true };
    } else if (anim === 'lunge') {
      // Выпад: вытянут в струну, клинок вперёд, за спиной — след.
      r.hip = add(r.hip, [1, 1]);
      r.lean = 1.15;
      const neck = neckOf(r);
      r.head = add(neck, [3, -1.4]);
      r.legF[2] = [r.hip[0] - 7, H - 2];
      r.legF[1] = lerp(r.legF[0], r.legF[2], 0.5);
      r.legN[1] = add(r.legN[0], [3.4, 1.4]);
      r.legN[2] = [r.hip[0] + 5, H - 2];
      const sh = add(neck, [0, 1]);
      r.arms[1] = { sh, el: add(sh, [3, 0]), ha: add(sh, [6, -0.4]), far: false };
      r.arms[0] = {
        sh: add(sh, [-1, 0]),
        el: add(sh, [-2.6, 1.6]),
        ha: add(sh, [-4.4, 2.4]),
        far: true,
      };
      blade = { ang: -0.05, len: 12, sheath: false };
    } else if (anim === 'pant') {
      // Окно: клинок вонзён в пол, опирается — тяжело дышит.
      r.lean = 0.45 + f * 0.05;
      const neck = neckOf(r);
      r.head = add(neck, [1.6, -2.2 + f * 0.5]);
      const sh = add(neck, [0, 1]);
      r.arms[1] = { sh, el: add(sh, [2, 2.4]), ha: add(sh, [3.4, 4.4]), far: false };
      r.squint = true;
      r.mouth = 0.6;
      blade = { ang: 1.45, len: 11, sheath: false };
    } else if (anim === 'wind') blade = { ang: -2.2, len: 11, sheath: false };
    else if (anim === 'bite') blade = { ang: 0.35, len: 12, sheath: false };
    else if (anim === 'run') blade = { ang: 2.5, len: 11, sheath: false };
    else if (anim === 'hurt') blade = { ang: -1.2, len: 11, sheath: false };
    else if (anim === 'sleep') blade = { ang: 0.05, len: 11, sheath: false };
    if (anim === 'dead') deadRig(r, H);
    const hand = r.arms[1].ha;
    if (anim !== 'dead')
      r.items.push({
        layer: blade.sheath ? 'mid' : 'hand',
        draw: (p) => katana(p, anim === 'sleep' ? add(r.hip, [-3, 2]) : hand, blade.ang, blade.len),
      });
    else r.items.push({ layer: 'back', draw: (p) => katana(p, [r.hip[0] + 7, H - 4], 0.1, 11) });
    // Ножны на поясе — всегда.
    r.items.push({
      layer: 'back',
      draw: (p) =>
        stroke(p, r.hip[0] - 4, r.hip[1] + 1, r.hip[0] + 2, r.hip[1] - 1, hx('#1a1418'), 1.5),
    });
    const { p, eye } = drawRig(r, BLADE_ST, W, H, anim === 'dead');
    if (anim === 'lunge') {
      // Линии скорости за спиной.
      const c = alpha(hx('#c8c0e0'), 0.6);
      for (const [y, l] of [
        [10, 6],
        [14, 9],
        [19, 5],
      ] as const)
        stroke(p, 0, y, l, y, c);
    }
    if (pose.mode === 'stun') stars(p, r.head[0], r.head[1] - 5, 4, mod(pose.t * 8, 4));
    return { p, ax: Math.round(W / 2), ay: H - 2, eye: anim === 'dead' ? null : eye };
  });
});

// ---------------------------------------------------------------------------
// Многорукий: громадный, шесть рук. Звезда ударов — все руки в стороны.
// ---------------------------------------------------------------------------

const ARMS_ST: Style = {
  skin: tones('#183640', '#2a5a68', '#46869a', '#7ab8c8'),
  top: tones('#2a1a12', '#46301e', '#644428', '#86603a'),
  pants: tones('#1e1612', '#34261c', '#4a3828', '#645038'),
  under: hx('#e0d8c8'),
  sash: hx('#e8e0c8'),
  hair: tones('#2a0808', '#4a1010', '#6e1a16', '#9a2a20'),
  hairKind: 'wild',
  horns: 2,
  horn: tones('#6a5a3a', '#9a8a5a', '#c8b884', '#f0e4b8'),
  eye: hx('#ff8a30'),
  bulk: 1.85,
  sleeve: 0,
  hakama: true,
};

registerMobPainter('f8_arms', (m: Mob, pose: MobPose) => {
  const pi = poseIn(pose, 6);
  let anim: string = pi.anim;
  let f = pi.f;
  if (pose.mode === 'star') {
    anim = 'star';
    f = pose.t < STAR_T * 0.5 ? 0 : 1;
  } else if (pose.mode === 'grab') {
    anim = 'grab';
    f = pose.t < 0.5 ? 0 : 1;
  } else if (pose.mode === 'recover' && m.data.long) {
    anim = 'star_end';
    f = 0;
  } else if (pose.mode === 'f8_out') {
    anim = 'run';
    f = mod(pose.t * 8, 6);
  }
  return frameOf('f8_arms', pose, anim, f, () => {
    const W = 60;
    const H = 50;
    const s = 1.4;
    const base = ['star', 'grab', 'star_end'].includes(anim) ? 'idle' : anim;
    const r = bipedRig({
      s,
      W,
      H,
      legLen: 10.5,
      torso: 10.5,
      headR: 4.4,
      arms: 2,
      pose: { ...pi, anim: base, f },
      heavy: true,
      lean: 0.18,
    });
    const neck = neckOf(r);
    // Шесть рук: три пары от плеч вниз по корпусу.
    const shs: V[] = [add(neck, [0, 1.4]), add(neck, [-0.6, 4.2]), add(neck, [-1, 7])];
    const arms: Arm[] = [];
    for (let i = 0; i < 3; i++) {
      const sh = shs[i];
      // В покое — поза божества: верхняя пара вскинута, средняя в стороны,
      // нижняя опущена. Шесть рук видны силуэтом, а не гребёнкой у живота.
      const sw =
        anim === 'run'
          ? Math.sin(f * 1.05 + i) * 0.18
          : anim === 'idle'
            ? Math.sin(f * 1.6 + i) * 0.08
            : 0;
      const aN0 = [-0.95, 0.12, 1.05][i] + sw;
      const aF0 = [Math.PI + 0.95, Math.PI - 0.12, Math.PI - 1.05][i] - sw;
      const bend = (a: number, L: number, turn: number): [V, V] => [
        [Math.cos(a - turn) * L * 0.5, Math.sin(a - turn) * L * 0.5],
        [Math.cos(a) * L, Math.sin(a) * L],
      ];
      let [elN, haN] = bend(aN0, 7.6 * s, 0.35);
      let [elF, haF] = bend(aF0, 7.4 * s, -0.35);
      if (anim === 'star' || anim === 'star_end') {
        // Звезда: на замахе руки сжаты к телу, на ударе — выброшены до конца.
        const k = anim === 'star_end' ? 1.3 : f ? 1.3 : 0.55;
        const aN = -0.95 + i * 0.95;
        const aF = Math.PI + 0.95 - i * 0.95;
        [elN, haN] = bend(aN, 7 * s * k, f || anim === 'star_end' ? 0.05 : 0.8);
        [elF, haF] = bend(aF, 6.8 * s * k, f || anim === 'star_end' ? -0.05 : -0.8);
      } else if (anim === 'grab' && i === 0) {
        const k = f ? 1 : 0.5;
        elN = [3.4 * s * k, 0];
        haN = [7.6 * s * k, 0.4 * s];
      } else if (anim === 'wind') {
        elN = [-0.6 * s, -1.6 * s - i * 0.4];
        haN = [0.8 * s, -3.6 * s - i * 0.6];
      } else if (anim === 'bite') {
        elN = [3 * s, 0.6 * s + i];
        haN = [5.6 * s, 0.8 * s + i];
      }
      arms.push({ sh: add(sh, [-0.8, 0]), el: add(sh, elF), ha: add(sh, haF), far: true });
      arms.push({ sh: add(sh, [0.6, 0.2]), el: add(sh, elN), ha: add(sh, haN), far: false });
    }
    r.arms = arms;
    if (anim === 'dead') deadRig(r, H);
    const { p, eye } = drawRig(r, ARMS_ST, W, H, anim === 'dead');
    if (pose.mode === 'stun') stars(p, r.head[0], r.head[1] - 5, 5, mod(pose.t * 8, 4));
    return { p, ax: Math.round(W / 2), ay: H - 2, eye: anim === 'dead' ? null : eye };
  });
});

/** Замах звезды (для кадра) — из ИИ. */
const STAR_T = 0.95;

// ---------------------------------------------------------------------------
// Бес-казначей: толстый, в хаори торговца, мешок монет за спиной.
// ---------------------------------------------------------------------------

const MISER_ST: Style = {
  skin: tones('#6a3a1a', '#a0582a', '#c8783a', '#eca058'),
  top: tones('#3a2a0a', '#6a4a14', '#9a7020', '#c89a38'),
  pants: tones('#2a1a14', '#3e281c', '#5a3a26', '#7a5234'),
  under: hx('#e8d8b0'),
  sash: hx('#1a1410'),
  hair: tones('#1a1410', '#2e241c', '#443428', '#5e4a38'),
  hairKind: 'knot',
  horns: 1,
  horn: tones('#8a7a58', '#c8b888', '#ece0b0', '#fff8d8'),
  eye: hx('#ffe040'),
  bulk: 1.35,
  sleeve: 0.8,
  hakama: true,
  belly: true,
};

registerMobPainter('f8_miser', (m: Mob, pose: MobPose) => {
  const pi = poseIn(pose, 6);
  let anim: string = pi.anim;
  let f = pi.f;
  if (pose.mode === 'flee' || pose.mode === 'f8_out') {
    anim = 'run';
    f = mod(pose.t * 12, 6);
  }
  if (pose.mode === 'f8_dive' || pose.mode === 'f8_hidden') {
    anim = 'dive';
    f = tq(pose.t, 0.1, 4);
  }
  return frameOf('f8_miser', pose, anim, f, () => {
    const W = 26;
    const H = 24;
    const s = 0.72;
    const r = bipedRig({
      s,
      W,
      H,
      legLen: 5,
      torso: 5,
      headR: 3,
      arms: 2,
      pose: { ...pi, anim: anim === 'dive' ? 'run' : anim, f: anim === 'dive' ? 1 : f },
    });
    if (anim === 'dead') deadRig(r, H);
    // Мешок с монетами за спиной; золото выглядывает.
    const neck = neckOf(r);
    r.items.push({
      layer: 'back',
      draw: (p) => {
        const c: V = anim === 'dead' ? [r.hip[0] - 6, H - 6] : add(neck, [-4.2, 2.6]);
        shadeEll(p, c[0], c[1], 4.4, 4.8, tones('#5a4428', '#8a6a3e', '#b08c56', '#d8b87a'));
        p.set(Math.round(c[0]), Math.round(c[1] - 4.6), hx('#3a2a18'));
        p.set(Math.round(c[0] + 1), Math.round(c[1] - 4.8), hx('#3a2a18'));
        for (const [dx, dy] of [
          [-1, -3],
          [1, -3.4],
          [0, -2.4],
        ] as V[])
          p.set(Math.round(c[0] + dx), Math.round(c[1] + dy), hx('#ffd84a'));
        // Знак монеты на мешке.
        p.ell(c[0] + 0.5, c[1] + 0.6, 1.6, 1.6, hx('#e8b84a'));
        p.set(Math.round(c[0] + 0.5), Math.round(c[1] + 0.6), hx('#8a6a3e'));
      },
    });
    const { p, eye } = drawRig(r, MISER_ST, W, H, anim === 'dead');
    if (anim === 'dive') {
      // Ныряет в щель двери: тает снизу вверх.
      const cut = Math.round(H * (f / 4));
      for (let y = H - 1; y >= H - cut; y--) for (let x = 0; x < W; x++) clear(p, x, y);
    }
    // Монетка выпадает на бегу.
    if (anim === 'run' && f % 3 === 0) p.set(3, H - 4, hx('#ffd84a'));
    void m;
    return { p, ax: Math.round(W / 2), ay: H - 2, eye: anim === 'dead' ? null : eye };
  });
});

// ---------------------------------------------------------------------------
// Демон-барабанщик: барабаны вросли в плечи и живот.
// ---------------------------------------------------------------------------

const DRUM_ST: Style = {
  skin: tones('#4a1a1a', '#7a2a24', '#a8443a', '#d06a58'),
  top: tones('#1a1418', '#2a2228', '#3e343c', '#5a4e58'),
  pants: tones('#2a1a14', '#44281c', '#623a28', '#845034'),
  under: hx('#d8c8a8'),
  sash: hx('#e8b84a'),
  hair: tones('#e0d8c8', '#f0e8d8', '#fff8ec', '#ffffff'),
  hairKind: 'wild',
  horns: 2,
  horn: tones('#3a2a1a', '#5a4428', '#8a6a3a', '#b8945a'),
  eye: hx('#ffb040'),
  bulk: 1.55,
  sleeve: 0,
  hakama: true,
  belly: true,
};

/** Барабан, вросший в тело: красный корпус, кожа с томоэ. */
function bodyDrum(p: Px, c: V, rx: number, ry: number, hit: boolean): void {
  shadeEll(p, c[0], c[1], rx, ry, RED, 0.15);
  shadeEll(
    p,
    c[0] + rx * 0.15,
    c[1],
    rx * 0.65,
    ry * 0.7,
    tones('#a88858', '#d0b080', '#ecd4a0', hit ? '#ffffff' : '#fff0c8'),
    0.3,
  );
  p.set(Math.round(c[0]), Math.round(c[1] - 1), RED[1]);
  p.set(Math.round(c[0] + 1), Math.round(c[1] + 1), RED[1]);
  for (let a = 0; a < 8; a++) {
    const t = (a / 8) * TAU;
    p.set(
      Math.round(c[0] + Math.cos(t) * (rx - 0.5)),
      Math.round(c[1] + Math.sin(t) * (ry - 0.5)),
      GILT[2],
    );
  }
}

registerMobPainter('f8_drum', (m: Mob, pose: MobPose) => {
  const pi = poseIn(pose, 6);
  let anim: string = pi.anim;
  let f = pi.f;
  if (pose.mode === 'side') {
    anim = 'side';
    f = pose.t < 0.5 ? 0 : 1;
  } else if (pose.mode === 'belly') {
    anim = 'belly';
    f = mod(pose.t * 6, 2) + (pose.t > 1.2 ? 2 : 0);
  }
  const lefty = m.data.left ? 1 : 0;
  return frameOf('f8_drum', pose, `${anim}${lefty}`, f, () => {
    const W = 56;
    const H = 46;
    const s = 1.25;
    const base = anim === 'side' || anim === 'belly' ? 'idle' : anim;
    const r = bipedRig({
      s,
      W,
      H,
      legLen: 8,
      torso: 8.5,
      headR: 3.6,
      arms: 2,
      pose: { ...pi, anim: base, f: base === 'idle' ? 0 : f },
      heavy: true,
      lean: 0.05,
    });
    const neck = neckOf(r);
    const sh = add(neck, [-0.2 * s, 1 * s]);
    if (anim === 'side') {
      // Бьёт в плечевой барабан: рука с другой стороны, замах — удар.
      const up = f === 0;
      r.arms[1] = {
        sh: add(sh, [0.4, 0]),
        el: add(sh, [up ? -1 : 1, up ? -3 : -1]),
        ha: add(sh, [up ? -2 : -1.4, up ? -5.4 : -2.6]),
        far: false,
      };
    } else if (anim === 'belly') {
      // Обе ладони в брюхо.
      const k = f % 2;
      for (const a of r.arms) {
        a.el = add(a.sh, [2.4, 2 + k]);
        a.ha = add(r.hip, [3.6 - k * 0.6, -3 + k]);
      }
      r.mouth = 1;
    }
    if (anim === 'dead') deadRig(r, H);
    const hit = (anim === 'side' && f === 1) || (anim === 'belly' && f % 2 === 1);
    // Кольцо барабанов за спиной — как у бога грома: дуга из пяти на обруче.
    r.items.push({
      layer: 'back',
      draw: (p) => {
        if (anim === 'dead') return;
        const c: V = add(neck, [-1.2 * s, 0.6 * s]);
        const R = 7.4 * s;
        for (let a = Math.PI * 0.62; a <= Math.PI * 1.62; a += 0.04)
          p.set(
            Math.round(c[0] + Math.cos(a) * R),
            Math.round(c[1] + Math.sin(a) * R * 0.9),
            GILT[0],
          );
        for (let i = 0; i < 5; i++) {
          const a = Math.PI * (0.7 + i * 0.22);
          const beat = anim === 'side' && hit && i === 2;
          bodyDrum(
            p,
            [c[0] + Math.cos(a) * R, c[1] + Math.sin(a) * R * 0.9],
            1.7 * s,
            1.7 * s,
            beat,
          );
        }
      },
    });
    r.items.push({
      layer: 'mid',
      draw: (p) => {
        if (anim === 'dead') return;
        // Брюшной — большой, спереди; плечевой — на плече.
        bodyDrum(p, add(r.hip, [2.8 * s, -3.6 * s]), 4.2 * s, 4.4 * s, anim === 'belly' && hit);
        bodyDrum(p, add(neck, [-1.2 * s, 0.6 * s]), 2.6 * s, 2.4 * s, anim === 'side' && hit);
      },
    });
    const { p, eye } = drawRig(r, DRUM_ST, W, H, anim === 'dead');
    if (hit) {
      // Звуковые дуги от барабана.
      const c = alpha(hx('#ffe0b0'), 0.8);
      const o: V =
        anim === 'belly' ? add(r.hip, [2.6 * s, -3.4 * s]) : add(neck, [-1.4 * s, 0.4 * s]);
      for (let a = -0.8; a <= 0.8; a += 0.2) {
        p.set(Math.round(o[0] + Math.cos(a) * 7), Math.round(o[1] + Math.sin(a) * 7), c);
        p.set(Math.round(o[0] + Math.cos(a) * 9), Math.round(o[1] + Math.sin(a) * 9), c);
      }
    }
    if (pose.mode === 'stun') stars(p, r.head[0], r.head[1] - 5, 5, mod(pose.t * 8, 4));
    return { p, ax: Math.round(W / 2), ay: H - 2, eye: anim === 'dead' ? null : eye };
  });
});

// ---------------------------------------------------------------------------
// Демон-паук: брюшко с белой маской, лицо демона на головогруди, восемь
// ног аркой — колени выше спины, стопы далеко снаружи.
// ---------------------------------------------------------------------------

const SP = {
  body: tones('#140c18', '#261628', '#3e2440', '#5e3a60'),
  leg: tones('#100a12', '#20142a', '#382442', '#56385e'),
  face: tones('#8a8098', '#c8c0d4', '#ece8f4', '#ffffff'),
  mark: hx('#c8203a'),
  eye: hx('#ff3a8a'),
};

function spiderPx(anim: string, f: number, t: number): Built {
  const W = 42;
  const H = 28;
  const p = new Px(W, H);
  const G = H - 2;
  let bx = 14;
  let by = 16;
  let hxp = 24;
  let hyp = 17;
  let rear = 0;
  let fang = 0;
  if (anim === 'aim') {
    // Встал на дыбы: брюшко задрано, паутинная бородавка светится.
    rear = 1;
    by = 11;
    bx = 11;
    hyp = 15;
  } else if (anim === 'bite') {
    hxp = 23;
    fang = 1;
  } else if (anim === 'wind') fang = 0.6;
  else if (anim === 'sleep') {
    by = 18;
    hyp = 19;
  } else if (anim === 'idle') by += mod(f, 4) === 2 ? 0.5 : 0;
  const dead = anim === 'dead';
  // Ноги: четыре пары; дальние — темнее и первыми.
  const legs = (far: boolean) => {
    for (let i = 0; i < 4; i++) {
      // Ноги веером: две пары вперёд, две назад — за брюшко.
      const hip: V = [hxp - 1 - i * 1.6, hyp - 0.5];
      let footX = hxp + [13, 8, -8, -15][i] + (far ? -2 : 2);
      let lift = 0;
      if (anim === 'run') {
        const ph = (f / 6) * TAU + (i % 2 === (far ? 0 : 1) ? 0 : Math.PI);
        footX += Math.cos(ph) * 2;
        lift = Math.max(0, Math.sin(ph)) * 2.5;
      } else if (anim === 'idle') footX += Math.sin(f * 1.6 + i) * 0.4;
      if (anim === 'aim' && i === 0) lift = 6;
      if (anim === 'sleep') footX = hxp - 2 + (i - 1.5) * 3;
      let foot: V = [footX, G - lift];
      let knee: V = [
        hip[0] + (foot[0] - hip[0]) * 0.42,
        Math.min(hip[1], foot[1]) - (anim === 'sleep' ? 2 : 7.5 - Math.abs(i - 1.5) * 0.6),
      ];
      if (dead) {
        foot = [hxp - 3 + (i - 1.5) * 2.5, hyp - 8];
        knee = [hxp - 3 + (i - 1.5) * 3.2, hyp - 4];
      }
      const t2 = far ? (SP.leg.map((c) => darker(c, 0.35)) as Tones) : SP.leg;
      limb(p, hip[0], hip[1], knee[0], knee[1], 1.1, 0.9, t2);
      limb(p, knee[0], knee[1], foot[0], foot[1], 0.9, 0.5, t2);
      // Сустав — красная точка.
      p.set(Math.round(knee[0]), Math.round(knee[1]), far ? darker(SP.mark, 0.4) : SP.mark);
    }
  };
  legs(true);
  // Брюшко: тёмное, белая маска-узор.
  shadeEll(p, bx, by, 6.8, 5.2, SP.body);
  for (let y = -3; y <= 3; y++)
    for (let x = -3; x <= 3; x++) {
      if (Math.abs(x) + Math.abs(y) * 1.4 > 4.2) continue;
      if (Math.abs(x) === 1 && y === -1) continue;
      p.set(Math.round(bx - 1 + x), Math.round(by - 1 + y), y > 1 ? SP.face[1] : SP.face[2]);
    }
  p.set(Math.round(bx - 2), Math.round(by - 2), SP.mark);
  p.set(Math.round(bx), Math.round(by - 2), SP.mark);
  if (rear) {
    p.set(Math.round(bx - 6), Math.round(by + 2), hx('#fff0ff'));
    p.set(Math.round(bx - 7), Math.round(by + 2), hx('#e8b0ff'));
  }
  // Головогрудь — лицо демона: белое, как маска театра, с волосами.
  shadeEll(p, hxp, hyp, 5, 4.4, SP.face, 0.15);
  poly(
    p,
    [
      [hxp - 5, hyp + 1],
      [hxp - 4.4, hyp - 3.6],
      [hxp + 0.5, hyp - 4.8],
      [hxp + 1.5, hyp - 2.6],
      [hxp - 2, hyp - 2.2],
      [hxp - 3.2, hyp + 1.6],
    ],
    SP.body[1],
  );
  legs(false);
  p.outline(INK);
  // Лицо поверх контура: четыре глаза, красные полосы, жвала.
  const ex = Math.round(hxp + 2);
  const ey = Math.round(hyp - 1);
  if (dead) {
    p.set(ex, ey, INK);
    p.set(ex - 2, ey, INK);
  } else {
    // Два больших глаза и четыре малых над ними — паучьи.
    p.set(ex, ey, SP.eye);
    p.set(ex + 1, ey, hx('#ffd0e8'));
    p.set(ex, ey + 1, darker(SP.eye, 0.3));
    p.set(ex - 3, ey, SP.eye);
    p.set(ex - 2, ey, hx('#ffd0e8'));
    p.set(ex - 3, ey + 1, darker(SP.eye, 0.3));
    p.set(ex - 2, ey - 2, SP.eye);
    p.set(ex, ey - 2, SP.eye);
    p.set(ex + 2, ey - 1, darker(SP.eye, 0.2));
  }
  // Красные полосы-узор, как у демонов.
  p.set(Math.round(hxp - 1), Math.round(hyp + 1.5), SP.mark);
  p.set(Math.round(hxp), Math.round(hyp + 2), SP.mark);
  p.set(Math.round(hxp + 3.2), Math.round(hyp - 3), SP.mark);
  const mx = Math.round(hxp + 4.2);
  const my = Math.round(hyp + 1.6);
  p.set(mx, my - Math.round(fang), hx('#f4ecd8'));
  p.set(mx, my + 1 + Math.round(fang), hx('#f4ecd8'));
  p.set(mx + 1, my + Math.round(fang * 2), hx('#d8d0c0'));
  void t;
  return { p, ax: 20, ay: G, eye: dead ? null : [ex, ey] };
}

registerMobPainter('f8_spider', (m: Mob, pose: MobPose) => {
  let anim: string = pose.anim;
  let f = anim === 'run' ? mod(pose.frame, 6) : mod(pose.frame, 4);
  if (pose.mode === 'aim') {
    anim = 'aim';
    f = 0;
  } else if (pose.mode === 'f8_out') {
    anim = 'run';
    f = mod(pose.t * 12, 6);
  }
  const built = frameOf('f8_spider', pose, anim, f, () => {
    const b = spiderPx(anim, f, pose.t);
    if (pose.mode === 'stun') stars(b.p, 24, 8, 4, mod(pose.t * 8, 4));
    return b;
  });
  void m;
  return built;
});

// ---------------------------------------------------------------------------
// Фонарный дух: бумажный фонарь с одним глазом и длинным языком.
// ---------------------------------------------------------------------------

function lanternPx(anim: string, f: number): Built {
  const W = 24;
  const H = 32;
  const p = new Px(W, H);
  const dim = anim === 'gutter';
  const cx = 11.5;
  const top = 5 + (anim === 'idle' ? [0, 0, 1, 1][f] : 0) + (dim ? 2 : 0);
  const bot = top + 17 - (dim ? 2 : 0);
  const paper = dim
    ? tones('#7a6a48', '#a08a60', '#bca47a', '#d8c098')
    : tones('#b09460', '#e0c890', '#f8e8b8', '#fff8e0');
  // Ручка-петля сверху.
  stroke(p, cx - 2, top - 3, cx + 2, top - 3, LACQ[2]);
  p.set(Math.round(cx - 2), top - 2, LACQ[2]);
  p.set(Math.round(cx + 2), top - 2, LACQ[2]);
  // Тело: бочонок с рёбрами, светится изнутри.
  for (let y = top; y <= bot; y++) {
    const k = (y - top) / (bot - top);
    const hw = 3.5 + Math.sin(k * Math.PI) * 3.2;
    for (let x = Math.floor(cx - hw); x <= Math.ceil(cx + hw); x++) {
      const u = (x + 0.5 - (cx - hw)) / (hw * 2);
      const l = 1 - Math.abs(u - 0.38) * 2;
      let c = l > 0.55 ? paper[3] : l > 0.1 ? paper[2] : paper[1];
      if ((y - top) % 3 === 0) c = darker(c, 0.18);
      if (u < 0.08 || u > 0.94) c = paper[0];
      p.set(x, y, c);
    }
  }
  // Шапка и донце — чёрный лак.
  p.rect(Math.round(cx - 3), top - 1, Math.round(cx + 3), top, LACQ[2]);
  p.rect(Math.round(cx - 3), bot, Math.round(cx + 3), bot + 1, LACQ[1]);
  // Прорехи, сквозь них огонь.
  const fire = dim ? hx('#c86a20') : hx('#ffd060');
  p.set(Math.round(cx + 3), top + 5, fire);
  p.set(Math.round(cx - 4), top + 11, fire);
  p.set(Math.round(cx - 3), top + 11, hx('#fff0a0'));
  // Рот: рваная щель, язык.
  const my = top + 12;
  const open = anim === 'aim' ? 3 : anim === 'wind' || anim === 'bite' ? 2 : 1;
  p.rect(Math.round(cx - 3), my, Math.round(cx + 4), my + open - 1, hx('#2a0a08'));
  if (anim === 'aim') p.rect(Math.round(cx - 1), my + 1, Math.round(cx + 2), my + 1, hx('#ffb040'));
  if (anim !== 'dead') {
    const wag =
      anim === 'idle' ? [0, 1, 0, -1][f] : anim === 'run' ? [1, 0, -1, 0, 1, 0][mod(f, 6)] : 0;
    const tongue = [hx('#8a1a2a'), hx('#c8304a'), hx('#f06a80')];
    const x0 = Math.round(cx + 1);
    for (let i = 0; i < 7; i++) {
      const x = x0 + Math.round(Math.sin(i * 0.7) * 0.8 + (i > 3 ? wag : 0));
      p.set(x, my + open + i, tongue[i < 5 ? 1 : 0]);
      p.set(x + 1, my + open + i, tongue[i < 3 ? 2 : 1]);
    }
  }
  p.outline(INK);
  // Глаз — один, большой.
  const ey = top + 6;
  const ex = Math.round(cx + 1);
  let eye: [number, number] | null = [ex, ey];
  if (anim === 'dead') {
    stroke(p, ex - 2, ey, ex + 2, ey, INK);
    eye = null;
  } else if (anim === 'sleep' || dim) {
    stroke(p, ex - 2, ey + (dim ? 0 : 1), ex + 2, ey + (dim ? 0 : 1), INK);
    p.set(ex, ey + 1, dim ? hx('#ff8a30') : INK);
    if (!dim) eye = null;
  } else {
    p.ell(ex + 0.5, ey + 0.5, 2.6, 2.1, hx('#fff8e8'));
    p.ell(ex + 0.8, ey + 0.5, 1.3, 1.5, anim === 'aim' ? hx('#ff3a28') : hx('#e8a020'));
    p.set(ex + 1, ey, INK);
    p.set(ex + 1, ey + 1, INK);
    // Брови-складки бумаги.
    stroke(p, ex - 2, ey - 3, ex + 3, ey - 2 - (anim === 'aim' ? 1 : 0), paper[0]);
  }
  if (anim === 'dead') {
    // Смят и горит.
    for (let i = 0; i < 6; i++) flame(p, 6 + i * 2, bot - 3 + (i % 2), 3 + (i % 3), i);
  }
  return { p, ax: 12, ay: H - 2, eye };
}

registerMobPainter('f8_lantern', (m: Mob, pose: MobPose) => {
  let anim: string = pose.anim;
  let f = mod(pose.frame, anim === 'run' ? 6 : 4);
  if (pose.mode === 'aim') {
    anim = 'aim';
    f = 0;
  } else if (pose.mode === 'gutter') {
    anim = 'gutter';
    f = 0;
  } else if (pose.mode === 'chase') {
    anim = 'idle';
    f = mod(pose.t * 4 + m.id, 4);
  }
  if (pose.mode === 'f8_rise') {
    // Поднимается из пропасти: проявляется снизу вверх.
    const k = Math.min(4, Math.floor(pose.t * 5));
    return frameOf('f8_lantern', pose, `rise${k}`, 0, () => {
      const b = lanternPx('idle', 0);
      const cut = Math.round((b.p.h * (4 - k)) / 5);
      for (let y = 0; y < cut; y++) for (let x = 0; x < b.p.w; x++) clear(b.p, x, y);
      return b;
    });
  }
  return frameOf('f8_lantern', pose, anim, f, () => lanternPx(anim, f));
});

// ---------------------------------------------------------------------------
// Глазастые сёдзи: глаза на бумаге, потом когтистые руки сквозь неё.
// Кадр лежит на лице стены: земля кадра — у ног моба перед стеной.
// ---------------------------------------------------------------------------

const EYE_AY = 22;

function eyesPx(anim: string, f: number): Built {
  const W = 18;
  const H = 38;
  const p = new Px(W, H);
  if (anim === 'hide') return { p: new Px(2, 2), ax: 1, ay: 1, eye: null };
  // Глаза на бумаге (лицо стены — ряды 1…16 кадра).
  const spots: [number, number, number][] = [
    [4, 5, 1.6],
    [11, 4, 2.1],
    [7, 10, 1.4],
    [13, 11, 1.7],
    [3, 12, 1.2],
  ];
  const open = anim === 'peek' ? Math.min(1, (f + 1) / 4) : 1;
  const dead = anim === 'dead';
  if (anim === 'thrust' || anim === 'open' || dead) {
    // Бумага прорвана посередине.
    for (let y = 6; y < 15; y++)
      for (let x = 5; x < 13; x++) {
        const edge = Math.abs(x - 8.5) + Math.abs(y - 10) * 0.8;
        if (edge < 4.2 + ((x * 7 + y * 3) % 3) * 0.4) p.set(x, y, hx('#0a0606'));
      }
  }
  for (const [x, y, r] of spots) {
    if (dead) {
      stroke(p, x - r, y, x + r, y, hx('#3a1010'));
      continue;
    }
    const ry = r * 0.75 * open;
    if (ry < 0.4) {
      stroke(p, x - r, y, x + r, y, hx('#5a1a14'));
      continue;
    }
    p.ell(x, y, r + 0.5, ry + 0.5, hx('#5a1410'));
    p.ell(x, y, r, ry, hx('#f4ece0'));
    p.set(Math.round(x - r + 0.5), Math.round(y), hx('#e06060'));
    p.ell(x + 0.3, y, Math.max(0.6, r * 0.5), Math.max(0.5, ry * 0.8), hx('#c81a1a'));
    p.set(Math.round(x + 0.3), Math.round(y), INK);
  }
  if (anim === 'thrust' || anim === 'open') {
    // Руки: из дыры вниз-вперёд, длинные пальцы.
    const reach = anim === 'thrust' ? 0.5 + f * 0.25 : 1;
    const wig = anim === 'open' ? (f ? 1 : -1) : 0;
    const skin = tones('#3a2a34', '#5a4250', '#7e6272', '#a88a98');
    for (const [sx, k] of [
      [7, 0],
      [10, 1],
    ] as V[]) {
      const hand: V = [sx + 4 * reach + k * 2, 14 + 16 * reach + wig * (k ? 1 : -1)];
      const elbow: V = [sx + 1 + k, 14 + 8 * reach];
      limb(p, sx, 12, elbow[0], elbow[1], 1.2, 1, skin);
      limb(p, elbow[0], elbow[1], hand[0], hand[1], 1, 0.8, skin);
      // Кисть и три когтя веером — рука, а не палка.
      p.ell(hand[0], hand[1], 1.3, 1.1, skin[2]);
      for (let i = -1; i <= 1; i++)
        stroke(
          p,
          hand[0] + i * 0.8,
          hand[1] + 0.5,
          hand[0] + i * 1.8 + 0.6,
          hand[1] + 3,
          hx('#f0e8d8'),
        );
    }
  }
  p.outline(INK);
  // Светится в темноте — средний глаз.
  return { p, ax: 9, ay: EYE_AY, eye: dead ? null : [11, 4] };
}

registerMobPainter('f8_eyes', (m: Mob, pose: MobPose) => {
  let anim = 'hide';
  let f = 0;
  const mode = pose.mode;
  if (mode === 'f8_peek') {
    anim = 'peek';
    f = Math.min(3, Math.floor(pose.t * 8));
  } else if (mode === 'f8_thrust') {
    anim = 'thrust';
    f = Math.min(2, Math.floor(pose.t * 5));
  } else if (mode === 'f8_open' || mode === 'stun') {
    anim = 'open';
    f = mod(pose.t * 6, 2);
  } else if (pose.anim === 'dead') anim = 'dead';
  else if (pose.flash) anim = 'open';
  void m;
  return frameOf('f8_eyes', pose, anim, f, () => eyesPx(anim, f));
});

// ---------------------------------------------------------------------------
// Бива-струнник: сидит в кимоно, волосы закрывают лицо (один глаз), лютня.
// ---------------------------------------------------------------------------

const BIWA = {
  robe: tones('#2a1a3a', '#4a2e62', '#6e4a8e', '#9a78b8'),
  robe2: tones('#8a8098', '#c0b8cc', '#e0dcea', '#fcfaff'),
  hair: tones('#060608', '#101016', '#1c1c26', '#2e2e3e'),
  skin: tones('#7a7078', '#aaa0a8', '#d4ccd2', '#f4eef2'),
  wood: tones('#4a2a14', '#7a4a24', '#a8703a', '#d8a058'),
};

function biwaPx(anim: string, f: number): Built {
  const W = 34;
  const H = 30;
  const p = new Px(W, H);
  const G = H - 2;
  const dead = anim === 'dead';
  const sway = anim === 'play' ? [0, 0.5, 0, -0.5][f] : 0;
  const cx = 15 + sway;
  if (dead) {
    // Упала ничком, лютня расколота, струны порваны.
    shadePoly(
      p,
      [
        [4, G - 4],
        [26, G - 5],
        [28, G],
        [3, G],
      ],
      BIWA.robe,
    );
    shadePoly(
      p,
      [
        [3, G - 6],
        [12, G - 7],
        [13, G - 2],
        [2, G - 2],
      ],
      BIWA.hair,
    );
    shadeEll(p, 24, G - 7, 4, 3, BIWA.wood);
    stroke(p, 22, G - 9, 26, G - 5, INK2);
    stroke(p, 27, G - 9, 31, G - 12, hx('#e8e0f0'));
    p.outline(INK);
    return { p, ax: 15, ay: G, eye: null };
  }
  // Кимоно разлито по полу: широкое основание.
  shadePoly(
    p,
    [
      [cx - 9, G],
      [cx + 10, G],
      [cx + 6, G - 9],
      [cx - 5, G - 10],
    ],
    BIWA.robe,
  );
  // Белое верхнее кимоно — полосой.
  shadePoly(
    p,
    [
      [cx - 4, G - 10],
      [cx + 5, G - 9],
      [cx + 4, G - 17],
      [cx - 3, G - 18],
    ],
    BIWA.robe2,
  );
  // Волосы: длинные, до пола, закрывают лицо.
  shadePoly(
    p,
    [
      [cx - 6, G - 2],
      [cx - 5, G - 19],
      [cx - 1, G - 24],
      [cx + 4, G - 23],
      [cx + 5, G - 16],
      [cx + 3, G - 12],
      [cx - 2, G - 3],
    ],
    BIWA.hair,
  );
  // Бива: грушевидный корпус стоит на коленях почти отвесно, короткий
  // гриф вверх и колковая коробка, заломленная назад. Длинная светлая
  // палка читалась мечом — гриф тёмный и короткий.
  const bodyC: V = [cx + 5.5, G - 9];
  shadeEll(p, bodyC[0], bodyC[1], 4.4, 5.8, BIWA.wood, 0.1);
  // Дека светлее, две лунки-резонатора и подгрудник.
  p.ell(bodyC[0] + 0.4, bodyC[1] + 0.6, 3, 4.4, BIWA.wood[2]);
  p.set(Math.round(bodyC[0] - 1), Math.round(bodyC[1] - 2), hx('#2a1408'));
  p.set(Math.round(bodyC[0] + 1.6), Math.round(bodyC[1] - 2), hx('#2a1408'));
  p.rect(
    Math.round(bodyC[0] - 1),
    Math.round(bodyC[1] + 3),
    Math.round(bodyC[0] + 2),
    Math.round(bodyC[1] + 3),
    BIWA.wood[0],
  );
  const glow = anim === 'strum';
  // Рука с плектром (бати) — большой веер.
  const up = anim === 'strum' ? f % 2 === 0 : anim === 'play' ? f < 2 : true;
  const hand: V = [bodyC[0] + (up ? 2 : 1), bodyC[1] + (up ? -4 : 1)];
  limb(p, cx + 3, G - 15, hand[0], hand[1], 1.4, 1.1, BIWA.robe2);
  poly(
    p,
    [
      [hand[0], hand[1]],
      [hand[0] + 4, hand[1] - (up ? 3 : 1)],
      [hand[0] + 4, hand[1] + (up ? 1 : 3)],
    ],
    hx('#e8e0c8'),
  );
  p.ell(hand[0], hand[1], 1, 1, BIWA.skin[2]);
  // Гриф — поверх руки и волос: короткий, вверх-назад за плечо, колковая
  // коробка заломлена вниз, колки светлые.
  const neckTop: V = [cx - 1.5, G - 22.5];
  stroke(p, bodyC[0] - 0.8, bodyC[1] - 5, neckTop[0], neckTop[1], BIWA.wood[2], 1.6);
  const peg: V = [neckTop[0] - 3, neckTop[1] + 2.6];
  stroke(p, neckTop[0], neckTop[1], peg[0], peg[1], BIWA.wood[0], 1.8);
  p.set(Math.round(neckTop[0] - 0.5), Math.round(neckTop[1] - 1.2), hx('#f4e0b0'));
  p.set(Math.round(neckTop[0] - 2.4), Math.round(neckTop[1] + 0.2), hx('#f4e0b0'));
  p.set(Math.round(peg[0] - 1), Math.round(peg[1]), hx('#f4e0b0'));
  // Струны: светятся при ударе.
  for (let i = -1; i <= 1; i += 2)
    stroke(
      p,
      bodyC[0] + i * 0.7,
      bodyC[1] + 2.6,
      neckTop[0] + 1 + i * 0.3,
      neckTop[1] + 1.4,
      glow ? hx('#fff0ff') : hx('#e8d8b8'),
    );
  p.outline(INK);
  // Один глаз сквозь пряди — огромный.
  const ex = Math.round(cx + 2);
  const ey = G - 19;
  if (anim === 'hurt') stroke(p, ex - 1, ey, ex + 2, ey, hx('#e0c8ff'));
  else {
    p.ell(ex + 0.5, ey + 0.5, 2, 1.6, hx('#f4f0ff'));
    p.ell(ex + 0.8, ey + 0.5, 1, 1.4, hx('#8a4ad8'));
    p.set(ex + 1, ey, INK);
  }
  if (glow) {
    // Звук струны — дуги.
    const c = alpha(hx('#e8d8ff'), 0.85);
    for (let a = -1.2; a <= 0.2; a += 0.2) {
      p.set(Math.round(bodyC[0] + Math.cos(a) * 8), Math.round(bodyC[1] + Math.sin(a) * 8), c);
      if (f % 2)
        p.set(Math.round(bodyC[0] + Math.cos(a) * 11), Math.round(bodyC[1] + Math.sin(a) * 11), c);
    }
  }
  return { p, ax: 15, ay: G, eye: [ex, ey] };
}

registerMobPainter('f8_biwa', (m: Mob, pose: MobPose) => {
  let anim = 'play';
  let f = mod(pose.t * 3 + m.id, 4);
  const mode = pose.mode;
  if (mode === 'f8_strum' || mode === 'f8_vanish') {
    anim = 'strum';
    f = mod(pose.t * 10, 4);
  } else if (pose.anim === 'hurt' || mode === 'stun') {
    anim = 'hurt';
    f = 0;
  } else if (pose.anim === 'dead') {
    anim = 'dead';
    f = 0;
  }
  if (mode === 'f8_gone')
    return frameOf('f8_biwa', pose, 'gone', 0, () => ({
      p: new Px(2, 2),
      ax: 1,
      ay: 1,
      eye: null,
    }));
  if (mode === 'f8_vanish' && pose.t > 0.3) {
    // Растворяется: пиксели гаснут шахматкой.
    const k = Math.min(3, Math.floor((pose.t - 0.3) * 15));
    return frameOf('f8_biwa', pose, `fade${k}`, 0, () => {
      const b = biwaPx('strum', 0);
      for (let y = 0; y < b.p.h; y++)
        for (let x = 0; x < b.p.w; x++) if ((x + y * 3) % 4 <= k) clear(b.p, x, y);
      return b;
    });
  }
  return frameOf('f8_biwa', pose, anim, f, () => biwaPx(anim, f));
});

// ---------------------------------------------------------------------------
// Луна финала: светящийся полумесяц в ореоле.
// ---------------------------------------------------------------------------

registerMobPainter('f8_moon', (m: Mob, pose: MobPose) => {
  const f = mod(pose.t * 6 + m.id, 4);
  return frameOf('f8_moon', { ...pose, flash: false }, 'moon', f, () => {
    const p = new Px(18, 18);
    p.ell(9, 9, 7, 7, alpha(MOONC[2], 0.25));
    shadeEll(p, 9, 9, 5, 5, tones('#b89a4a', '#e8c86a', '#fff0a8', '#ffffff'), 0.3);
    // Вырез полумесяца: стираем круг.
    for (let y = 0; y < 18; y++)
      for (let x = 0; x < 18; x++)
        if (Math.hypot(x + 0.5 - 11.5, y + 0.5 - 7.5) < 4.2) clear(p, x, y);
    // Блёстка кружит.
    const a = (f / 4) * TAU;
    p.set(Math.round(9 + Math.cos(a) * 7), Math.round(9 + Math.sin(a) * 7), hx('#ffffff'));
    return { p, ax: 9, ay: 15, eye: [6, 10] };
  });
});

// ---------------------------------------------------------------------------
// Демон семи лун. Высокий мечник: хвост волос, шесть глаз (на виду — три),
// тёмно-лиловое кимоно с лунами, меч из плоти с глазами — растёт по фазам.
// ---------------------------------------------------------------------------

const BOSS_ST: Style = {
  skin: tones('#5a5068', '#8a809a', '#b4acc4', '#dcd6e8'),
  top: tones('#1a0e24', '#2e1a42', '#4a2a68', '#6a4290'),
  pants: tones('#0e0a12', '#1a141e', '#2a2230', '#3e3446'),
  under: hx('#d8d0e0'),
  sash: hx('#e8b84a'),
  hair: tones('#050407', '#0e0c12', '#1c1824', '#2e2838'),
  hairKind: 'tail',
  horns: 0,
  horn: tones('#1a1418', '#3a2a30', '#5a4448', '#8a7478'),
  eye: hx('#ffd84a'),
  bulk: 1.15,
  sleeve: 1.1,
  hakama: true,
  crest: hx('#e8b84a'),
  fang: false,
  sashW: 1.4,
};

/** Меч из плоти: лиловый клинок, вдоль — золотые глаза; с фазы 2 — отростки. */
function moonBlade(p: Px, hand: V, ang: number, len: number, phase: number, glow: boolean): void {
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  stroke(p, hand[0] - ux * 3, hand[1] - uy * 3, hand[0], hand[1], hx('#1a0e24'), 2);
  p.set(Math.round(hand[0] - ux * 2), Math.round(hand[1] - uy * 2), hx('#e8b84a'));
  // Цуба — круглая, золотая, с глазом.
  p.ell(hand[0] + ux * 0.8, hand[1] + uy * 0.8, 1.6, 1.6, GILT[2]);
  const flesh = glow
    ? tones('#6a3a8a', '#a878d0', '#e0c8ff', '#ffffff')
    : tones('#3a1a4a', '#6a3a7a', '#9a6aaa', '#d8b8e8');
  for (let i = 2; i <= len; i++) {
    const bend = (i / len) ** 2 * 2;
    const x = hand[0] + ux * i + uy * bend;
    const y = hand[1] + uy * i - ux * bend;
    const w = i < len - 2 ? 1 : 0;
    p.set(Math.round(x), Math.round(y), flesh[1]);
    if (w) p.set(Math.round(x - uy), Math.round(y + ux), flesh[2]);
    if (i % 5 === 3 && i < len - 2) {
      p.set(Math.round(x), Math.round(y), hx('#ffd84a'));
      p.set(Math.round(x + uy * 0.8), Math.round(y - ux * 0.8), hx('#2a0a1a'));
    }
    // Отростки-ветви — меч растёт.
    if (phase >= 2 && i % 7 === 5) {
      const bx = x + uy * 2.6 + ux * 1.4;
      const by = y - ux * 2.6 + uy * 1.4;
      stroke(p, x, y, bx, by, flesh[2]);
      if (phase >= 3) stroke(p, x, y, x - uy * 2.2 + ux * 1.2, y + ux * 2.2 + uy * 1.2, flesh[1]);
    }
  }
  const tipx = hand[0] + ux * len;
  const tipy = hand[1] + uy * len;
  p.set(Math.round(tipx), Math.round(tipy), flesh[3]);
}

/** Полумесяц на кадре (след взмаха). */
function crescentPx(
  p: Px,
  cx: number,
  cy: number,
  R: number,
  a0: number,
  a1: number,
  c: RGBA,
): void {
  for (let a = a0; a <= a1; a += 0.04) {
    const k = Math.sin(((a - a0) / (a1 - a0)) * Math.PI);
    for (let d = 0; d <= Math.max(0, k * 2.2); d += 0.5)
      p.set(Math.round(cx + Math.cos(a) * (R - d)), Math.round(cy + Math.sin(a) * (R - d)), c);
  }
}

function bossPx(anim: string, f: number, phase: number): Built {
  const W = 72;
  const H = 66;
  const s = 1.55;
  const base = ['idle', 'run', 'hurt', 'dead', 'sleep', 'wind', 'bite'].includes(anim)
    ? anim
    : 'idle';
  const r = bipedRig({
    s,
    W,
    H,
    legLen: 15,
    torso: 13,
    headR: 5.4,
    arms: 2,
    pose: { anim: base, f, mode: anim, t: 0 },
    lean: 0.08,
  });
  const blade = [1, 1.1, 1.35, 1.65][phase];
  const L = Math.round(20 * blade);
  const neck = neckOf(r);
  const sh = add(neck, [-0.2 * s, 1 * s]);
  // Хват двумя руками: ближняя и дальняя кисть — на рукояти.
  const grip = (hand: V) => {
    r.arms[1].ha = hand;
    r.arms[1].el = lerp(r.arms[1].sh, hand, 0.5);
    r.arms[1].el = add(r.arms[1].el, [0, 1.6 * s]);
    r.arms[0].ha = add(hand, [-1.4 * s, 0.6 * s]);
    r.arms[0].el = add(lerp(r.arms[0].sh, r.arms[0].ha, 0.5), [0, 1.4 * s]);
  };
  let sword = { hand: r.arms[1].ha, ang: 1.1, glow: false, show: true };
  const arc: { cx: number; cy: number; R: number; a0: number; a1: number }[] = [];
  switch (anim) {
    case 'idle':
    case 'run':
      sword = { hand: r.arms[1].ha, ang: anim === 'run' ? 2.4 : 1.25, glow: false, show: true };
      break;
    case 'roar': {
      // Вход: голова откинута, меч в сторону — луна за спиной.
      r.lean = -0.18;
      r.head = add(neckOf(r), [0.4 * s, -r.headR * 1.05]);
      const hand = add(sh, [5 * s, -1 * s]);
      r.arms[1].ha = hand;
      r.arms[1].el = add(sh, [2.6 * s, 0.6 * s]);
      sword = { hand, ang: -0.35, glow: true, show: true };
      break;
    }
    case 'fanwind': {
      // Замах веера: меч отведён назад и вниз, корпус скручен.
      r.lean = -0.05;
      const hand = add(r.hip, [-4 * s, -1 * s]);
      grip(hand);
      sword = { hand, ang: Math.PI - 0.45, glow: f === 1, show: true };
      break;
    }
    case 'fan': {
      // Веер: взмах вперёд-вверх, полумесяцы сходят с клинка.
      r.lean = 0.3;
      const hand = add(sh, [4 * s, -1.6 * s]);
      grip(hand);
      sword = { hand, ang: -0.55, glow: true, show: true };
      arc.push({ cx: hand[0], cy: hand[1], R: L * 0.9, a0: -1.3, a1: 0.5 });
      break;
    }
    case 'sweepwind': {
      const hand = add(sh, [-2 * s, 0.8 * s]);
      grip(hand);
      sword = { hand, ang: Math.PI + 0.2, glow: false, show: true };
      break;
    }
    case 'sweep': {
      r.lean = 0.35;
      const hand = add(sh, [5 * s, 1.4 * s]);
      grip(hand);
      sword = { hand, ang: 0.15, glow: true, show: true };
      arc.push({ cx: sh[0], cy: sh[1] + 2, R: L * 0.8, a0: -0.9, a1: 1.2 });
      break;
    }
    case 'iai': {
      // Иай: присел, клинок у бедра, взгляд вперёд.
      r.hip = add(r.hip, [0, 2.4]);
      r.lean = 0.5;
      const nk = neckOf(r);
      r.head = add(nk, [2.6, -r.headR * 0.9]);
      r.legN[1] = add(r.legN[0], [4.4, 3]);
      r.legN[2] = [r.hip[0] + 6, H - 2];
      r.legF[1] = add(r.legF[0], [-2, 4.4]);
      r.legF[2] = [r.hip[0] - 6, H - 2];
      const s2 = add(nk, [0, 1.4]);
      r.arms[1] = { sh: s2, el: add(s2, [1, 4]), ha: add(r.hip, [2, 0.6]), far: false };
      r.arms[0] = {
        sh: add(s2, [-1, 0]),
        el: add(s2, [2, 3.6]),
        ha: add(r.hip, [3.4, 0]),
        far: true,
      };
      sword = { hand: r.arms[1].ha, ang: Math.PI - 0.12, glow: f === 1, show: true };
      break;
    }
    case 'dash': {
      r.hip = add(r.hip, [2, 1.6]);
      r.lean = 1.05;
      const nk = neckOf(r);
      r.head = add(nk, [4, -2]);
      r.legF[2] = [r.hip[0] - 11, H - 2];
      r.legF[1] = lerp(r.legF[0], r.legF[2], 0.5);
      r.legN[1] = add(r.legN[0], [5, 2]);
      r.legN[2] = [r.hip[0] + 7, H - 2];
      const s2 = add(nk, [0, 1.4]);
      const hand = add(s2, [8, 0.6]);
      r.arms[1] = { sh: s2, el: add(s2, [4, 0.4]), ha: hand, far: false };
      r.arms[0] = { sh: add(s2, [-1, 0]), el: add(s2, [-3, 2.4]), ha: add(s2, [-6, 3]), far: true };
      sword = { hand, ang: 0.02, glow: true, show: true };
      break;
    }
    case 'eyes': {
      // Шесть глаз горят: меч вперёд, остриём на героя.
      const hand = add(sh, [4.4 * s, 0.4 * s]);
      grip(hand);
      sword = { hand, ang: 0.08, glow: f === 1, show: true };
      break;
    }
    case 'volley': {
      const hand = add(sh, [3 * s, -3 * s]);
      grip(hand);
      sword = { hand, ang: f ? 0.2 : -1.1, glow: true, show: true };
      arc.push({ cx: hand[0], cy: hand[1], R: L * 0.8, a0: -1.2, a1: 0.4 });
      break;
    }
    case 'rings': {
      // Меч к небу: сейчас по арене пойдут дуги.
      const hand = add(sh, [1.4 * s, -4.2 * s]);
      grip(hand);
      sword = { hand, ang: -Math.PI / 2 + 0.08, glow: true, show: true };
      break;
    }
    case 'phase': {
      // Смена фазы: на колене, меч воткнут, аура.
      r.hip = add(r.hip, [0, 5]);
      r.lean = 0.35;
      const nk = neckOf(r);
      r.head = add(nk, [1.8, -r.headR * 0.9]);
      r.legN[1] = add(r.legN[0], [4, 0]);
      r.legN[2] = [r.hip[0] + 4.4, H - 2];
      r.legF[1] = [r.hip[0] - 1, H - 2];
      r.legF[2] = [r.hip[0] - 5, H - 2];
      const s2 = add(nk, [0, 1.4]);
      const hand = add(s2, [4.6, 3]);
      r.arms[1] = { sh: s2, el: add(s2, [2.4, 2.4]), ha: hand, far: false };
      r.arms[0] = {
        sh: add(s2, [-1, 0]),
        el: add(s2, [2, 3.4]),
        ha: add(hand, [-1, 1]),
        far: true,
      };
      sword = { hand, ang: Math.PI / 2 - 0.05, glow: f === 1, show: true };
      break;
    }
    case 'pant': {
      // Окно после серии: меч опущен, плечи вниз.
      r.lean = 0.28;
      const nk = neckOf(r);
      r.head = add(nk, [1.6, -r.headR * 0.85 + 0.8]);
      const hand = add(sh, [3 * s, 3.4 * s]);
      r.arms[1].ha = hand;
      r.arms[1].el = add(sh, [1.6 * s, 2.2 * s]);
      sword = { hand, ang: 1.25, glow: false, show: true };
      r.squint = f === 1;
      break;
    }
    case 'wind':
      sword = { hand: r.arms[1].ha, ang: -2.1, glow: false, show: true };
      break;
    case 'bite':
      sword = { hand: r.arms[1].ha, ang: 0.3, glow: true, show: true };
      break;
    case 'hurt':
      sword = { hand: r.arms[1].ha, ang: -1, glow: false, show: true };
      break;
  }
  if (anim === 'dead') deadRig(r, H);
  const L2 = anim === 'dead' ? Math.round(L * 0.45) : L;
  r.items.push({
    layer: anim === 'iai' ? 'mid' : 'hand',
    draw: (p) =>
      anim === 'dead'
        ? moonBlade(p, [r.hip[0] + 9, H - 4], 0.12, L2, phase, false)
        : moonBlade(p, sword.hand, sword.ang, L, phase, sword.glow),
  });
  // Ножны на поясе и узор лун на кимоно.
  r.items.push({
    layer: 'back',
    draw: (p) =>
      stroke(p, r.hip[0] - 7, r.hip[1] + 2, r.hip[0] + 3, r.hip[1] - 1, hx('#140a1a'), 2),
  });
  // Полы хаори за спиной — развеваются; силуэт шире мечника.
  r.items.push({
    layer: 'back',
    draw: (p) => {
      if (anim === 'dead') return;
      const nk = neckOf(r);
      const wave =
        anim === 'run' || anim === 'dash' ? 2.4 : anim === 'roar' || anim === 'phase' ? 1.6 : 0.6;
      shadePoly(
        p,
        [
          [nk[0] - 2, nk[1] + 1],
          [nk[0] + 1, nk[1] + 2],
          [r.hip[0] - 1, r.hip[1] + 5],
          [r.hip[0] - 7 - wave * 2, r.hip[1] + 7 + wave],
          [r.hip[0] - 9 - wave * 3, r.hip[1] + 2],
          [nk[0] - 6 - wave, nk[1] + 6],
        ],
        BOSS_ST.top.map((c) => darker(c, 0.2)) as Tones,
      );
      // Луны по подолу.
      crescentPx(p, r.hip[0] - 6 - wave * 2, r.hip[1] + 4, 1.4, -2, 1.2, GILT[1]);
    },
  });
  // Ореол-полумесяц за головой — знак «семи лун»; растёт с фазой.
  r.items.push({
    layer: 'back',
    draw: (p) => {
      if (anim === 'dead') return;
      const [hxp, hyp] = r.head;
      const R = r.headR * (2.35 + phase * 0.15);
      const col = phase >= 2 ? hx('#ffe08a') : GILT[1];
      crescentPx(
        p,
        hxp - 1.5,
        hyp + 0.5,
        R,
        Math.PI * 0.5,
        Math.PI * 1.45,
        alpha(col, phase >= 3 ? 0.95 : 0.7),
      );
    },
  });
  r.items.push({
    layer: 'mid',
    draw: (p) => {
      if (anim === 'dead') return;
      const nk = neckOf(r);
      for (const [k, dx] of [
        [0.3, -1],
        [0.62, 1.4],
      ] as V[]) {
        const c = lerp(nk, r.hip, k);
        crescentPx(p, c[0] + dx, c[1], 1.6, -2, 1.2, GILT[1]);
      }
    },
  });
  const { p, eye } = drawRig(r, BOSS_ST, W, H, anim === 'dead');
  // Шесть глаз: на виду три пары — столбцом по лицу (дальние — тусклее).
  if (anim !== 'dead') {
    const [hxp, hyp] = r.head;
    const R = r.headR;
    const wide = anim === 'eyes' || anim === 'roar' || anim === 'phase';
    for (let i = 0; i < 3; i++) {
      const ey = Math.round(hyp - R * 0.62 + i * R * 0.44);
      const ex = Math.round(hxp + R * 0.42 - (i === 1 ? 0 : 0.7));
      const iris = wide ? hx('#fff0a0') : hx('#ffd84a');
      // Глаз: красный белок, золотая радужка, чёрный зрачок.
      p.set(ex - 1, ey, hx('#8a1020'));
      p.set(ex, ey, iris);
      p.set(ex + 1, ey, INK);
      p.set(ex + 2, ey, hx('#8a1020'));
      if (wide) {
        p.set(ex, ey - 1, alpha(iris, 0.7));
        p.set(ex + 1, ey - 1, alpha(iris, 0.5));
      }
      // Дальние глаза — у края лица, тусклее.
      p.set(ex - 3, ey, hx('#b07a2a'));
    }
    // Узор-трещины на лице (как у демонов старших лун).
    p.set(Math.round(hxp + R * 0.1), Math.round(hyp - R * 0.8), hx('#8a1a2a'));
    p.set(Math.round(hxp - R * 0.2), Math.round(hyp - R * 0.6), hx('#8a1a2a'));
  }
  // Полумесяцы, сходящие с клинка.
  for (const a of arc) crescentPx(p, a.cx, a.cy, a.R, a.a0, a.a1, alpha(hx('#f4ecff'), 0.9));
  if (anim === 'phase') {
    // Аура: кольцо лунного света.
    for (let a = 0; a < TAU; a += 0.12)
      p.set(
        Math.round(r.hip[0] + Math.cos(a) * 16),
        Math.round(r.hip[1] - 6 + Math.sin(a) * 10),
        alpha(MOONC[2], f ? 0.9 : 0.5),
      );
  }
  return { p, ax: Math.round(W / 2), ay: H - 2, eye: anim === 'dead' ? null : eye };
}

registerMobPainter('f8boss', (m: Mob, pose: MobPose) => {
  const phase = Math.max(0, Math.min(3, m.data.phase ?? 0));
  const mode = pose.mode;
  let anim: string = pose.anim;
  let f = pose.anim === 'run' ? mod(pose.frame, 6) : mod(pose.frame, anim === 'idle' ? 4 : 2);
  const t = pose.t;
  switch (mode) {
    case 'roar':
      anim = 'roar';
      f = 0;
      break;
    case 'phase':
      anim = 'phase';
      f = mod(t * 4, 2);
      break;
    case 'fan':
      anim = t < 0.45 ? 'fanwind' : 'fan';
      f = t < 0.25 ? 0 : 1;
      break;
    case 'sweep':
      anim = t < 0.35 ? 'sweepwind' : 'sweep';
      f = 0;
      break;
    case 'aim':
      anim = 'iai';
      f = t < 0.4 ? 0 : 1;
      break;
    case 'dash':
      anim = 'dash';
      f = 0;
      break;
    case 'eyes':
      anim = 'eyes';
      f = mod(t * 8, 2);
      break;
    case 'volley':
      anim = 'volley';
      f = t < 0.8 ? 0 : 1;
      break;
    case 'rings':
      anim = 'rings';
      f = 0;
      break;
    case 'recover':
      anim = 'pant';
      f = mod(t * 3, 2);
      break;
  }
  if (pose.anim === 'dead' || mode === 'dying') {
    anim = 'dead';
    f = 0;
  }
  return frameOf('f8boss', pose, `${anim}|p${phase}`, f, () => bossPx(anim, f, phase));
});
