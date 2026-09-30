// Этаж 8, босс «Демон семи лун» — техники (v2.86): всё, что демон делает с
// МИРОМ. Тело рисует `f8-art.ts`, здесь — метки ударов, контакт, снаряды,
// пыль и лунный свет. Договор движка — библия §14.
//
// Почерк — «дыхание луны»: каждый взмах оставляет в воздухе россыпь
// маленьких полумесяцев разного размера. Серпик (`moonlet`) — сквозной знак
// всех техник: из него сложены метки, следы, контакт и снаряды.
//
// Как устроено:
//   • метка удара (`registerZonePainter` для strike): «куда» — вся фигура
//     удара с первого кадра (тёмная полоса, пунктир кромок); «когда» — фронт
//     налива доходит до конца ровно в миг урона (с разгоном), последние
//     0,2 с — два «тика» и белая кромка;
//   • контакт (`registerImpactPainter`): кадр удара — белый серп или смаз,
//     дальше проводка с перелётом, серпики разлетаются и гаснут, в полу —
//     разрез с кромкой, щепа с тяжестью и отскоком, пыль; тряска — по силе;
//   • режимы без своего удара (прицел выпада, рывок, залп, кольца, смена
//     фазы, рёв, луны) рисует «режиссёр» — одна зона-картинка `f8v_dir` на
//     бой: читает босса и рисует по его `m.t` (стоп-кадр держит позу сам);
//     шаги, толчок и занос рывка — зоны `f8v_*` мозга в миг события.
//
// Пиксели — на сетке МИРА (`Pen`): эффект стоит на полу, а не плывёт при
// движении камеры. Частицы считаются от зерна и возраста, а не копятся по
// кадрам: лист кадров и игра рисуют одно и то же.
import { Px } from '../dungeon-art';
import {
  frameLRU,
  paintSim,
  registerImpactPainter,
  registerMobWarm,
  registerShotPainter,
  registerZonePainter,
} from '../dungeon-paint';
import type { ImpactRec, Sprite } from '../dungeon-paint';
import type { Mob, Shot, Sim, Strike, Zone } from '../dungeon-sim';
import { BOSS8 } from './f8-brains';

type RGBA = [number, number, number, number];

const TAU = Math.PI * 2;
const TS = 16;
const hx = (h: string, a = 255): RGBA => {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255, a];
};
/** Детерминированный шум по трём целым, 0…1. */
const hash = (a: number, b: number, c = 0): number => {
  let h =
    (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1274126177)) >>>
    0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const k01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const eIn2 = (t: number) => t * t;
const eOut2 = (t: number) => 1 - (1 - t) * (1 - t);
const eOut3 = (t: number) => 1 - (1 - t) * (1 - t) * (1 - t);
const posMod = (x: number, n: number) => ((x % n) + n) % n;
/** Зерно зоны: у зон `api.vfx` номера отрицательные — только так. */
const seedOf = (id: number) => id >>> 0;

/** Последние 0,2 с перед уроном — ясный сигнал «сейчас». */
const SIG = 0.2;
/** Два «тика» в последние 0,2 с: 0,20…0,15 и 0,10…0,05. */
const tick = (left: number) => left > 0 && left < SIG && Math.floor(left / 0.05) % 2 === 1;

let rmq: MediaQueryList | null | undefined;
/** Просили меньше движения: меньше частиц, без мигания. */
const reduced = () => {
  if (rmq === undefined)
    rmq =
      typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
  return !!rmq?.matches;
};

// ---- Палитра: лунный свет, лиловая плоть клинка, золото глаз, лак пола ------

const C = {
  ink: '#0c0612',
  void: '#07030b',
  vDk: '#1e0b30',
  violet: '#43206a',
  purple: '#7440b4',
  lilac: '#a47ae6',
  lav: '#d6c2ff',
  pale: '#efe6ff',
  moon: '#fff6dc',
  white: '#ffffff',
  gold: '#ffd84a',
  goldDk: '#b8801e',
  goldHi: '#fff0a0',
  crimson: '#8a1020',
  vein: '#6a0a1c',
  sky: '#c8d8ff',
  skyDk: '#6a84d8',
  gash: '#0e0610',
  lip: '#6a4450',
  wood: ['#170b10', '#2c161c', '#4a262e', '#6e3c42', '#96625e'],
};

// ---- Перо: пиксели на сетке мира -------------------------------------------

/**
 * Рисует игровыми пикселями, привязанными к сетке МИРА: `(px, py)` — где на
 * экране точка мира `(wx, wy)` (в пикселях мира). Остаток привязки `qx/qy`
 * один на весь кадр — эффект стоит на полу, а не дрожит по нему. Соседние
 * пиксели строки или столбца сливаются в один прямоугольник (`run`).
 */
class Pen {
  readonly g: CanvasRenderingContext2D;
  readonly qx: number;
  readonly qy: number;
  private rx = 0;
  private ry = 0;
  private rw = 0;
  private rh = 0;
  constructor(g: CanvasRenderingContext2D, px: number, py: number, wx: number, wy: number) {
    this.g = g;
    const sc = g.getTransform().a || 1;
    this.qx = Math.round((px - wx) * sc) / sc;
    this.qy = Math.round((py - wy) * sc) / sc;
  }
  col(c: string, a = 1): void {
    this.end();
    this.g.fillStyle = c;
    this.g.globalAlpha = a < 0 ? 0 : a > 1 ? 1 : a;
  }
  dot(x: number, y: number, w = 1, h = 1): void {
    this.g.fillRect(Math.floor(x) + this.qx, Math.floor(y) + this.qy, w, h);
  }
  img(c: HTMLCanvasElement, x: number, y: number, a = 1, op?: GlobalCompositeOperation): void {
    this.end();
    this.g.globalAlpha = a < 0 ? 0 : a > 1 ? 1 : a;
    if (op) this.g.globalCompositeOperation = op;
    this.g.drawImage(c, Math.floor(x) + this.qx, Math.floor(y) + this.qy);
    if (op) this.g.globalCompositeOperation = 'source-over';
  }
  /** Спрайт серединой в точку мира. */
  at(c: HTMLCanvasElement, x: number, y: number, a = 1): void {
    this.img(c, x - c.width / 2, y - c.height / 2, a);
  }
  run(x: number, y: number): void {
    x = Math.floor(x);
    y = Math.floor(y);
    if (this.rw) {
      if (this.rh === 1 && y === this.ry && (x === this.rx + this.rw || x === this.rx - 1)) {
        if (x < this.rx) this.rx = x;
        this.rw++;
        return;
      }
      if (this.rw === 1 && x === this.rx && (y === this.ry + this.rh || y === this.ry - 1)) {
        if (y < this.ry) this.ry = y;
        this.rh++;
        return;
      }
      if (x >= this.rx && x < this.rx + this.rw && y >= this.ry && y < this.ry + this.rh) return;
      this.g.fillRect(this.rx + this.qx, this.ry + this.qy, this.rw, this.rh);
    }
    this.rx = x;
    this.ry = y;
    this.rw = 1;
    this.rh = 1;
  }
  end(): void {
    if (this.rw) this.g.fillRect(this.rx + this.qx, this.ry + this.qy, this.rw, this.rh);
    this.rw = 0;
  }
  /** Линия по пикселям (Брезенхэм); `keep(i, n)` — какие оставить (пунктир). */
  line(x0: number, y0: number, x1: number, y1: number, keep?: (i: number, n: number) => boolean) {
    let x = Math.floor(x0);
    let y = Math.floor(y0);
    const xe = Math.floor(x1);
    const ye = Math.floor(y1);
    const dx = Math.abs(xe - x);
    const dy = -Math.abs(ye - y);
    const sx = x < xe ? 1 : -1;
    const sy = y < ye ? 1 : -1;
    const n = Math.max(dx, -dy);
    let err = dx + dy;
    for (let i = 0; i <= 1200; i++) {
      if (!keep || keep(i, n)) this.run(x, y);
      if (x === xe && y === ye) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
    this.end();
  }
  /** Дуга по пикселям от a0 до a1 (a0 < a1); `keep(u)` — доля пути 0…1. */
  arc(cx: number, cy: number, r: number, a0: number, a1: number, keep?: (u: number) => boolean) {
    if (r < 0.5 || a1 <= a0) return;
    const n = Math.max(2, Math.ceil((a1 - a0) * r * 1.6));
    let lx = 1e9;
    let ly = 1e9;
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const a = a0 + (a1 - a0) * u;
      const x = Math.floor(cx + Math.cos(a) * r);
      const y = Math.floor(cy + Math.sin(a) * r);
      if (x === lx && y === ly) continue;
      lx = x;
      ly = y;
      if (keep && !keep(u)) continue;
      this.run(x, y);
    }
    this.end();
  }
}

/**
 * Кольцевой сектор [r0, r1] × [a − h, a + h] строками пикселей (h < π/2):
 * пересечение двух полуплоскостей и кольца — по отрезку на строку.
 */
function wedgeRows(
  cx: number,
  cy: number,
  r0: number,
  r1: number,
  a: number,
  h: number,
  row: (Y: number, xa: number, xb: number) => void,
): void {
  if (r1 <= r0 + 0.3 || h <= 0) return;
  const u0x = Math.cos(a - h);
  const u0y = Math.sin(a - h);
  const u1x = Math.cos(a + h);
  const u1y = Math.sin(a + h);
  const span = (s0: number, s1: number, Y: number) => {
    const xa = Math.ceil(cx + s0 - 0.5);
    const xb = Math.floor(cx + s1 - 0.5);
    if (xb >= xa) row(Y, xa, xb);
  };
  const y0 = Math.floor(cy - r1);
  const y1 = Math.ceil(cy + r1);
  for (let Y = y0; Y <= y1; Y++) {
    const yy = Y + 0.5 - cy;
    if (Math.abs(yy) >= r1) continue;
    const ho = Math.sqrt(r1 * r1 - yy * yy);
    let lo = -ho;
    let up = ho;
    if (u0y > 1e-9) up = Math.min(up, (u0x * yy) / u0y);
    else if (u0y < -1e-9) lo = Math.max(lo, (u0x * yy) / u0y);
    else if (u0x * yy < 0) continue;
    if (u1y > 1e-9) lo = Math.max(lo, (yy * u1x) / u1y);
    else if (u1y < -1e-9) up = Math.min(up, (yy * u1x) / u1y);
    else if (yy * u1x > 0) continue;
    if (up <= lo) continue;
    const hi = Math.abs(yy) < r0 ? Math.sqrt(r0 * r0 - yy * yy) : 0;
    if (hi > 0) {
      span(lo, Math.min(up, -hi), Y);
      span(Math.max(lo, hi), up, Y);
    } else span(lo, up, Y);
  }
}
function wedge(p: Pen, cx: number, cy: number, r0: number, r1: number, a: number, h: number) {
  p.end();
  wedgeRows(cx, cy, r0, r1, a, h, (Y, xa, xb) => p.g.fillRect(xa + p.qx, Y + p.qy, xb - xa + 1, 1));
}
/**
 * Тот же сектор одним контуром канвы — для того, что растёт каждый кадр
 * (налив). Край сглажен, но лежит под пиксельными кромками и фронтом.
 */
function wedgePath(p: Pen, cx: number, cy: number, r0: number, r1: number, a: number, h: number) {
  if (r1 <= r0 + 0.3) return;
  p.end();
  const g = p.g;
  const x = cx + p.qx;
  const y = cy + p.qy;
  g.beginPath();
  g.arc(x, y, r1, a - h, a + h);
  g.arc(x, y, r0, a + h, a - h, true);
  g.closePath();
  g.fill();
}

/**
 * Неподвижная основа метки-сектора — растром, один раз на метку: строками
 * пикселей её перерисовывали каждый кадр, а у веера таких конусов 7–11.
 */
function wedgeBase(
  p: Pen,
  slot: string,
  cx: number,
  cy: number,
  r0: number,
  r1: number,
  a: number,
  h: number,
  col: RGBA,
): void {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const an of [a - h, a - h / 2, a, a + h / 2, a + h])
    for (const r of [r0, r1]) {
      xs.push(cx + Math.cos(an) * r);
      ys.push(cy + Math.sin(an) * r);
    }
  const hs = heldShape(
    slot,
    `${cx.toFixed(2)}|${cy.toFixed(2)}|${r0.toFixed(1)}|${r1.toFixed(1)}|${a.toFixed(4)}|${h.toFixed(4)}`,
    Math.min(...xs) - 2,
    Math.min(...ys) - 2,
    Math.max(...xs) + 2,
    Math.max(...ys) + 2,
    (b) =>
      wedgeRows(cx, cy, r0, r1, a, h, (Y, xa, xb) => {
        for (let x = xa; x <= xb; x++) b.put(x, Y, col);
      }),
  );
  if (hs) p.img(hs.cv, hs.x0, hs.y0, 1);
}

/** Выпуклый многоугольник строками пикселей. */
function polyRows(xs: number[], ys: number[], row: (Y: number, xa: number, xb: number) => void) {
  const n = xs.length;
  let ymin = 1e9;
  let ymax = -1e9;
  for (const y of ys) {
    ymin = Math.min(ymin, y);
    ymax = Math.max(ymax, y);
  }
  for (let Y = Math.floor(ymin); Y <= Math.ceil(ymax); Y++) {
    const yc = Y + 0.5;
    let lo = 1e9;
    let hi = -1e9;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ya = ys[i];
      const yb = ys[j];
      if (yc < ya === yc < yb) continue;
      const x = xs[i] + ((xs[j] - xs[i]) * (yc - ya)) / (yb - ya);
      if (x < lo) lo = x;
      if (x > hi) hi = x;
    }
    if (hi < lo) continue;
    const xa = Math.ceil(lo - 0.5);
    const xb = Math.floor(hi - 0.5);
    if (xb >= xa) row(Y, xa, xb);
  }
}
function poly(p: Pen, xs: number[], ys: number[]): void {
  p.end();
  polyRows(xs, ys, (Y, xa, xb) => p.g.fillRect(xa + p.qx, Y + p.qy, xb - xa + 1, 1));
}
/** Линия (Брезенхэм) в растр; `keep(i)` — пунктир. */
function bufLine(
  b: Buf,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  c: RGBA,
  keep?: (i: number) => boolean,
): void {
  let x = Math.floor(x0);
  let y = Math.floor(y0);
  const xe = Math.floor(x1);
  const ye = Math.floor(y1);
  const dx = Math.abs(xe - x);
  const dy = -Math.abs(ye - y);
  const sx = x < xe ? 1 : -1;
  const sy = y < ye ? 1 : -1;
  let err = dx + dy;
  for (let i = 0; i <= 1200; i++) {
    if (!keep || keep(i)) b.put(x, y, c);
    if (x === xe && y === ye) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/** Полоса вдоль луча: от (x, y) по углу `a`, [s0, s1] вдоль, ±w0 → ±w1 поперёк. */
function strip(
  p: Pen,
  x: number,
  y: number,
  a: number,
  s0: number,
  s1: number,
  w0: number,
  w1 = w0,
): void {
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const nx = -uy;
  const ny = ux;
  poly(
    p,
    [x + ux * s0 + nx * w0, x + ux * s1 + nx * w1, x + ux * s1 - nx * w1, x + ux * s0 - nx * w0],
    [y + uy * s0 + ny * w0, y + uy * s1 + ny * w1, y + uy * s1 - ny * w1, y + uy * s0 - ny * w0],
  );
}

/** Веретено вдоль луча: острый хвост в s0, самая широкая часть в `mid`, острие в s1. */
function lance(
  p: Pen,
  x: number,
  y: number,
  a: number,
  s0: number,
  s1: number,
  w: number,
  mid = 0.7,
) {
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const nx = -uy;
  const ny = ux;
  const sm = s0 + (s1 - s0) * mid;
  poly(
    p,
    [x + ux * s0, x + ux * sm + nx * w, x + ux * s1, x + ux * sm - nx * w],
    [y + uy * s0, y + uy * sm + ny * w, y + uy * s1, y + uy * sm - ny * w],
  );
}

// ---- Растровый буфер: сложные фигуры (смаз, глаз) — одним drawImage ---------

let scratch: HTMLCanvasElement | null = null;
let scratchG: CanvasRenderingContext2D | null = null;

/** Кусок пикселей мира [x0, x1] × [y0, y1]; пишется поверх, выводится разом. */
class Buf {
  readonly x0: number;
  readonly y0: number;
  readonly w: number;
  readonly h: number;
  readonly img: ImageData | null;
  constructor(x0: number, y0: number, x1: number, y1: number) {
    this.x0 = Math.floor(x0) - 1;
    this.y0 = Math.floor(y0) - 1;
    this.w = Math.max(1, Math.min(420, Math.ceil(x1) - this.x0 + 2));
    this.h = Math.max(1, Math.min(420, Math.ceil(y1) - this.y0 + 2));
    this.img = typeof ImageData !== 'undefined' ? new ImageData(this.w, this.h) : null;
  }
  /** Пиксель цвета `c` с прозрачностью `a` (заменяет прежний). */
  put(x: number, y: number, c: RGBA, a = 1): void {
    const X = Math.floor(x) - this.x0;
    const Y = Math.floor(y) - this.y0;
    if (!this.img || X < 0 || Y < 0 || X >= this.w || Y >= this.h) return;
    const d = this.img.data;
    const i = (Y * this.w + X) * 4;
    d[i] = c[0];
    d[i + 1] = c[1];
    d[i + 2] = c[2];
    d[i + 3] = c[3] * a;
  }
  flush(p: Pen, a = 1): void {
    if (!this.img || a <= 0.01) return;
    if (!scratch || !scratchG || scratch.width < this.w || scratch.height < this.h) {
      scratch = document.createElement('canvas');
      scratch.width = Math.max(this.w, scratch?.width ?? 0, 64);
      scratch.height = Math.max(this.h, scratch?.height ?? 0, 64);
      scratchG = scratch.getContext('2d');
      if (!scratchG) return;
    }
    scratchG.putImageData(this.img, 0, 0);
    p.end();
    p.g.globalAlpha = a > 1 ? 1 : a;
    p.g.drawImage(scratch, 0, 0, this.w, this.h, this.x0 + p.qx, this.y0 + p.qy, this.w, this.h);
  }
}

/** Растр, который держит метка: пересобирается, только когда сменился ключ. */
interface Held {
  key: string;
  cv: HTMLCanvasElement;
  x0: number;
  y0: number;
}
const held = new Map<string, Held>();
/**
 * Фигура метки из кеша: `slot` — чья (метка и деталь), `key` — всё, от чего
 * зависит картинка (раскрытие, накал, место). Глаз «шести глаз» меняется
 * два десятка раз за жизнь метки, а не в каждом кадре.
 */
function heldShape(
  slot: string,
  key: string,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  draw: (b: Buf) => void,
): Held | null {
  let h = held.get(slot);
  if (h && h.key === key) {
    held.delete(slot);
    held.set(slot, h);
    return h;
  }
  const b = new Buf(x0, y0, x1, y1);
  if (!b.img) return null;
  draw(b);
  const cv = h?.cv ?? document.createElement('canvas');
  cv.width = b.w;
  cv.height = b.h;
  cv.getContext('2d')?.putImageData(b.img, 0, 0);
  h = { key, cv, x0: b.x0, y0: b.y0 };
  held.delete(slot);
  held.set(slot, h);
  while (held.size > 64) held.delete(held.keys().next().value as string);
  return h;
}

/**
 * Серп-полоса по дуге радиуса R: угол `ang(u)`, u от u0 до u1; толщина
 * `th(u)` внутрь; цвета от внешней кромки к середине: `cols` =
 * [кромка, ядро, тело, хвост]. Кромка пишется последней — лежит сверху.
 */
function band(
  b: Buf,
  cx: number,
  cy: number,
  R: number,
  ang: (u: number) => number,
  u0: number,
  u1: number,
  th: (u: number) => number,
  cols: RGBA[],
  a = 1,
  streak = false,
): void {
  if (u1 <= u0 || R < 1) return;
  const span = Math.abs(ang(u1) - ang(u0));
  const n = Math.max(2, Math.ceil(span * R * 1.8));
  for (let i = 0; i <= n; i++) {
    const u = u0 + ((u1 - u0) * i) / n;
    const t = th(u);
    if (t < 0.5) continue;
    const an = ang(u);
    const ca = Math.cos(an);
    const sa = Math.sin(an);
    for (let d = t; d >= 0; d -= 0.6) {
      const f = d / t;
      let ci = d < 1 ? 0 : f < 0.35 ? 1 : f < 0.72 ? 2 : 3;
      // Полосы смаза вдоль хода: каждая третья строка — тоном ниже.
      if (streak && ci > 0 && ci < 3 && Math.floor(d) % 3 === 2) ci++;
      b.put(cx + ca * (R - d), cy + sa * (R - d), cols[ci], a);
    }
  }
}

/** Серп с собственной кривизной: дуга ±1,1 рад вокруг своей середины. */
const MSPAN = 1.1;
/**
 * Лунный серп: выпуклостью в сторону `a`, середина внешней кромки — в
 * (x, y), хорда `chord`, толщина посередине `th`. Кривизна своя, а не
 * кривизна удара: дуга радиуса конуса почти прямая и читалась скобкой.
 */
function moonShape(
  b: Buf,
  x: number,
  y: number,
  a: number,
  chord: number,
  th: number,
  cols: RGBA[],
  alpha = 1,
): void {
  const rc = chord / (2 * Math.sin(MSPAN));
  const ox = x - Math.cos(a) * rc;
  const oy = y - Math.sin(a) * rc;
  band(
    b,
    ox,
    oy,
    rc,
    (u) => a - MSPAN + 2 * MSPAN * u,
    0,
    1,
    (u) => th * Math.pow(Math.sin(Math.PI * u), 0.75),
    cols,
    alpha,
  );
}
/**
 * Тот же серп дугами пикселей, без растра: для того, что едет каждый кадр
 * (фронт налива). Шаг полпикселя — между кольцами не остаётся дыр.
 */
function moonRuns(
  p: Pen,
  x: number,
  y: number,
  a: number,
  chord: number,
  th: number,
  cols: [string, string, string],
  alpha = 1,
): void {
  const rc = chord / (2 * Math.sin(MSPAN));
  const ox = x - Math.cos(a) * rc;
  const oy = y - Math.sin(a) * rc;
  for (let d = th; d >= 0; d -= 0.5) {
    const q = d / Math.max(0.5, th);
    const sp = ((2 * MSPAN) / Math.PI) * Math.acos(Math.min(1, Math.pow(q, 1 / 0.75)));
    if (sp < 0.04) continue;
    p.col(d < 1 ? cols[0] : q < 0.5 ? cols[1] : cols[2], alpha);
    p.arc(ox, oy, rc - d, a - sp, a + sp);
  }
}

const moonSprites = frameLRU<{ cv: HTMLCanvasElement; ox: number; oy: number }>(240);
/**
 * Серп спрайтом: направление — 32 ступени, хорда — целые пиксели, толщина —
 * полпикселя. Летящий серп веера меняет размер каждый кадр, но у 7–11
 * конусов хорды почти всегда одни и те же (предел 44) — кадры общие.
 */
function moonSprite(a: number, chord: number, th: number, col: number) {
  const q = posMod(Math.round((a / TAU) * 32), 32);
  const ch = Math.max(4, Math.round(chord));
  const tq = Math.max(0.5, Math.round(th * 2) / 2);
  const key = `${q}|${ch}|${tq}|${col}`;
  let s = moonSprites.get(key);
  if (s) return s;
  const b = new Buf(-ch, -ch, ch, ch);
  if (!b.img || typeof document === 'undefined') return null;
  moonShape(b, 0.5, 0.5, (q / 32) * TAU, ch, tq, MOON_COLS[col]);
  const cv = document.createElement('canvas');
  cv.width = b.w;
  cv.height = b.h;
  cv.getContext('2d')?.putImageData(b.img, 0, 0);
  s = moonSprites.set(key, { cv, ox: b.x0, oy: b.y0 });
  return s;
}

/** Рамка под серп в (x, y) с хордой `chord`. */
const moonBuf = (x: number, y: number, chord: number) =>
  new Buf(x - chord, y - chord, x + chord, y + chord);

const COL_HOT: RGBA[] = [hx(C.white), hx(C.white), hx(C.moon), hx(C.lav)];
const COL_MOON: RGBA[] = [hx(C.moon), hx(C.lav), hx(C.lilac), hx(C.purple)];
const COL_COOL: RGBA[] = [hx(C.lav), hx(C.lilac), hx(C.purple), hx(C.violet)];
const COL_GOLD: RGBA[] = [hx(C.goldHi), hx(C.gold), hx(C.moon), hx(C.lav)];
/** Палитры спрайтов серпа (`moonSprite`): раскалённый, лунный, остывший, золотой. */
const MOON_COLS = [COL_HOT, COL_MOON, COL_COOL, COL_GOLD];

// ---- Спрайты: серпики, пыль, лунный свет -----------------------------------

const sprites = new Map<number, HTMLCanvasElement>();
const sprite = (key: number, make: () => Px): HTMLCanvasElement => {
  let c = sprites.get(key);
  if (!c) {
    c = make().canvas();
    sprites.set(key, c);
  }
  return c;
};

/** Палитры серпика: кромка, тело, рога, ореол. */
const MOON_PAL: RGBA[][] = [
  [hx('#fffaf0'), hx('#e2d0ff'), hx('#9a6ae0'), hx('#5a2aa0', 120)], // 0 — лунный
  [hx('#fff6c0'), hx('#ffd84a'), hx('#c07a1a'), hx('#8a1020', 120)], // 1 — золото глаз
  [hx('#ffffff'), hx('#d4e2ff'), hx('#7a94e0'), hx('#2a3a8a', 120)], // 2 — луч луны
  [hx('#ffffff'), hx('#fff6dc'), hx('#d8c4ff'), hx('#a070e8', 150)], // 3 — раскалённый
];
const MOON_SIZES = [3, 4, 5, 7, 9, 11, 14];

/**
 * Серпик: полумесяц диаметром `MOON_SIZES[sz]`, рога смотрят в сторону
 * `rot` (16 направлений), свет сверху-слева, ореол в пиксель.
 */
function moonlet(sz: number, rot: number, pal = 0): HTMLCanvasElement {
  const si = Math.max(0, Math.min(MOON_SIZES.length - 1, Math.round(sz)));
  const ri = posMod(Math.round(rot), 16);
  const pi = Math.max(0, Math.min(3, pal));
  return sprite(10000 + (pi * 8 + si) * 16 + ri, () => {
    const d = MOON_SIZES[si];
    const n = d + 2;
    const p = new Px(n, n);
    const c = n / 2;
    const R = d / 2;
    const o = (ri / 16) * TAU;
    const kx = c + Math.cos(o) * R * 0.62;
    const ky = c + Math.sin(o) * R * 0.62;
    const Rc = R * 0.84;
    const [E, B, T, H] = MOON_PAL[pi];
    const inside = (x: number, y: number) => {
      const qx = x + 0.5;
      const qy = y + 0.5;
      return Math.hypot(qx - c, qy - c) < R && Math.hypot(qx - kx, qy - ky) >= Rc;
    };
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        if (!inside(x, y)) continue;
        const qx = x + 0.5;
        const qy = y + 0.5;
        const dO = R - Math.hypot(qx - c, qy - c);
        const dC = Math.hypot(qx - kx, qy - ky) - Rc;
        const light = ((qx - c) * -0.7 + (qy - c) * -0.7) / R;
        p.set(x, y, d > 4 && dC < 0.8 ? T : dO < 1 && light > -0.35 ? E : B);
      }
    const halo: [number, number][] = [];
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++)
        if (
          !inside(x, y) &&
          (inside(x - 1, y) || inside(x + 1, y) || inside(x, y - 1) || inside(x, y + 1))
        )
          halo.push([x, y]);
    for (const [x, y] of halo) p.set(x, y, H);
    return p;
  });
}

/** Направление (угол) → номер поворота серпика. */
const rotOf = (a: number) => posMod(Math.round((a / TAU) * 16), 16);

/** Пыль: тень снизу, основа, свет сверху-слева. */
const PUFF_PAL: RGBA[][] = [
  [hx('#6a5a70'), hx('#8c7e96'), hx('#b8aac2')], // 0 — пыль замка
  [hx('#5a46a0'), hx('#8a78c8'), hx('#cfc0f4')], // 1 — лунная дымка
];

/**
 * Клуб пыли радиуса r (1…10), вариант v: три доли — край рваный. Без
 * тёмного обода и край в шахматку: плотный круг с каймой читался камнем.
 */
function puffImg(pal: number, r: number, v: number): HTMLCanvasElement {
  const R = Math.max(1, Math.min(10, Math.round(r)));
  return sprite(40000 + pal * 1000 + R * 8 + (v & 3), () => {
    const s = 2 * R + 3;
    const p = new Px(s, s);
    const c = R + 1.5;
    const rot = (v & 3) * 1.57 + 0.4;
    const lobes: [number, number, number][] = [
      [0, 0, R],
      [Math.cos(rot) * R * 0.5, Math.sin(rot) * R * 0.32, R * 0.62],
      [Math.cos(rot + 2.4) * R * 0.52, Math.sin(rot + 2.4) * R * 0.3, R * 0.56],
    ];
    const inside = (x: number, y: number) =>
      lobes.some(([ox, oy, rr]) => (x + 0.5 - c - ox) ** 2 + (y + 0.5 - c - oy) ** 2 <= rr * rr);
    const [sh, mid, hi] = PUFF_PAL[pal];
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        if (!inside(x, y)) continue;
        const l = ((x + 0.5 - c) * -0.55 + (y + 0.5 - c) * -0.83) / R;
        const rim =
          !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
        if (rim && R > 1 && (x + y) & 1) continue;
        p.set(x, y, rim ? sh : l > 0.3 ? hi : mid);
      }
    return p;
  });
}

/** Лужица лунного света на полу: овал в шахматку, гуще к середине. */
function poolImg(r: number, pal: number): HTMLCanvasElement {
  const R = Math.max(2, Math.min(24, Math.round(r)));
  return sprite(50000 + pal * 100 + R, () => {
    const w = 2 * R + 1;
    const h = Math.max(3, Math.round(R * 0.9));
    const p = new Px(w, h);
    const col = pal ? hx('#b8c8ff') : hx('#c8b0ff');
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const dx = (x + 0.5 - w / 2) / (w / 2);
        const dy = (y + 0.5 - h / 2) / (h / 2);
        const d = dx * dx + dy * dy;
        if (d > 1) continue;
        if (d > 0.45 && (x + y) & 1) continue;
        p.set(x, y, [col[0], col[1], col[2], Math.round(255 * (0.55 - 0.35 * d))]);
      }
    return p;
  });
}

// ---- Частицы: позиция от зерна и возраста -----------------------------------

interface Fly {
  h: number;
  z: number;
  air: boolean;
}
/** Полёт щепки: подброс, тяжесть, отскоки с потерей энергии, трение. */
function fly(t: number, vz: number, G = 420, e = 0.32): Fly {
  let tt = t;
  let v = vz;
  let sp = 1;
  let h = 0;
  for (let b = 0; b < 3; b++) {
    const T = (2 * v) / G;
    if (tt < T) return { h: h + sp * tt, z: v * tt - (G * tt * tt) / 2, air: true };
    tt -= T;
    h += sp * T;
    v *= e;
    sp *= 0.45;
    if (v < 12) break;
  }
  const s = Math.min(tt, 0.1);
  return { h: h + sp * (s - (s * s) / 0.2), z: 0, air: false };
}
/** Путь с сопротивлением: скорость v гаснет с темпом k. */
const drag = (v: number, k: number, t: number) => (v / k) * (1 - Math.exp(-k * t));

/** Щепа лакового пола: веером, с тенью в полёте, лёгшая гаснет к `fade`. */
function chips(
  p: Pen,
  seed: number,
  age: number,
  x: number,
  y: number,
  n: number,
  ang: number,
  spread: number,
  v0: number,
  dv: number,
  vz0: number,
  dvz: number,
  fade: [number, number],
): void {
  const a = 1 - k01((age - fade[0]) / (fade[1] - fade[0]));
  if (a <= 0) return;
  for (let i = 0; i < n; i++) {
    const th = ang + (hash(seed, i, 61) - 0.5) * 2 * spread;
    const v = v0 + dv * hash(seed, i, 62);
    const f = fly(age, vz0 + dvz * hash(seed, i, 63));
    const gx = x + Math.cos(th) * v * f.h;
    const gy = y + Math.sin(th) * v * f.h;
    const big = hash(seed, i, 64) < 0.4;
    const spin = f.air ? Math.floor(age * 22 + i) & 1 : i & 1;
    const w = big ? (spin ? 2 : 1) : 1;
    const h = big ? (spin ? 1 : 2) : 1;
    if (f.air) {
      p.col(C.ink, 0.35 * a);
      p.dot(gx, gy + 1, w, 1);
    }
    p.col(C.wood[4], a);
    p.dot(gx, gy - f.z, w, 1);
    if (h > 1) {
      p.col(C.wood[2], a);
      p.dot(gx, gy - f.z + 1, w, 1);
    }
  }
}

/** Клубы пыли: из точки веером, с сопротивлением, растут, поднимаются, тают. */
function dust(
  p: Pen,
  seed: number,
  age: number,
  x: number,
  y: number,
  n: number,
  ang: number,
  spread: number,
  v0: number,
  dv: number,
  r0: number,
  r1: number,
  rise: number,
  life: number,
  pal = 0,
  alpha = 0.85,
  stagger = 0,
): void {
  for (let i = 0; i < n; i++) {
    const t = age - stagger * hash(seed, i, 24);
    if (t < 0) continue;
    const L = life * (0.75 + 0.4 * hash(seed, i, 23));
    if (t >= L) continue;
    const k = t / L;
    const th = ang + (hash(seed, i, 21) - 0.5) * 2 * spread;
    const d = drag(v0 + dv * hash(seed, i, 22), 3.2, t);
    const sz = 0.5 + 0.6 * hash(seed, i, 25);
    const r = r0 + (r1 - r0) * sz * eOut2(k01(t / (L * 0.6)));
    const z = rise * eOut2(k);
    const im = puffImg(pal, r, i);
    p.img(
      im,
      x + Math.cos(th) * d - im.width / 2,
      y + Math.sin(th) * d - z - im.height / 2,
      alpha * (k < 0.3 ? 1 : 1 - Math.pow((k - 0.3) / 0.7, 1.2)),
    );
  }
}

/**
 * Серпики «дыхания луны»: рождаются вдоль следа (`at(i)` → [x, y, угол
 * разлёта]), летят с сопротивлением, крутятся, мельчают и гаснут.
 */
function moonlets(
  p: Pen,
  seed: number,
  age: number,
  n: number,
  at: (i: number) => [number, number, number],
  v0: number,
  dv: number,
  life: number,
  size: number,
  pal = 0,
  born = 0,
  rise = 0,
): void {
  for (let i = 0; i < n; i++) {
    const t = age - born * hash(seed, i, 71);
    if (t < 0) continue;
    const L = life * (0.6 + 0.6 * hash(seed, i, 72));
    if (t >= L) continue;
    const k = t / L;
    const [x, y, th] = at(i);
    const d = drag(v0 + dv * hash(seed, i, 73), 2.6, t);
    const s0 = size - (hash(seed, i, 74) < 0.5 ? 1 : 0) - (hash(seed, i, 75) < 0.25 ? 1 : 0);
    // Мельче пяти пикселей серп рассыпается в закорючку — такие только гаснут.
    const s = Math.max(Math.min(2, s0), s0 - Math.floor(k * 2.2));
    const spin = hash(seed, i, 76) * 16 + t * (hash(seed, i, 77) < 0.5 ? -9 : 9);
    const im = moonlet(s, spin, t < 0.05 ? 3 : pal);
    const tw = k > 0.6 && Math.floor(t * 20 + i) % 3 === 0 ? 0.5 : 1;
    p.at(im, x + Math.cos(th) * d, y + Math.sin(th) * d - rise * eOut2(k), tw * (1 - eIn2(k)));
  }
}

/** Разрез в полу: жёлоб и светлая кромка со стороны света; `reach` — доля длины. */
function gash(
  p: Pen,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  reach: number,
  a: number,
  wide = false,
): void {
  if (a <= 0.01 || reach <= 0) return;
  const xe = x0 + (x1 - x0) * reach;
  const ye = y0 + (y1 - y0) * reach;
  // Кромка — на стенке, куда светит (свет сверху-слева): снизу или справа.
  const horiz = Math.abs(x1 - x0) >= Math.abs(y1 - y0);
  const lx = horiz ? 0 : 1;
  const ly = horiz ? 1 : 0;
  p.col(C.lip, a * 0.75);
  p.line(x0 + lx, y0 + ly, xe + lx, ye + ly);
  p.col(C.gash, a);
  p.line(x0, y0, xe, ye);
  if (wide) {
    p.col(C.gash, a * 0.6);
    p.line(x0 - ly, y0 - lx, xe - ly, ye - lx, (i, n) => i > n * 0.2 && i < n * 0.8);
  }
}

// ---- Общее для рисовальщиков ------------------------------------------------

/** Сохранить и вернуть контекст: зоны рисуются без `save/restore` движка. */
function guarded<A extends unknown[]>(f: (g: CanvasRenderingContext2D, ...a: A) => void) {
  return (g: CanvasRenderingContext2D, ...a: A) => {
    g.save();
    try {
      f(g, ...a);
    } finally {
      g.restore();
    }
    return true;
  };
}

const bossOf = (sim: Sim | null): Mob | undefined =>
  sim?.mobs.find((m) => m.kind === 'f8boss' && m.mode !== 'dying');
const mobById = (id: number | undefined): Mob | undefined =>
  id === undefined ? undefined : paintSim()?.mobs.find((m) => m.id === id);
/** Спешка босса по фазе (как `hasteOf` мозга). */
const hasteOf = (phase: number) => (phase >= 3 ? 1.18 : phase >= 2 ? 1.1 : phase >= 1 ? 1.05 : 1);
/** Откуда смотрят шесть глаз: голова демона в пикселях мира над точкой ног. */
const HEAD_UP = 44;

// =============================================================================
// ВЕЕР ПОЛУМЕСЯЦЕВ — конусы r 3,4…6,2 × клинок, раствор 0,24, метка 0,8/спешка.
// Метка: тёмная полоса и пунктир кромок бегут к краю; «когда» — серп на
// фронте налива, с разгоном доходит до края в миг удара; по пути в полосе
// загораются серпики. Контакт: белое веретено по оси (смаз полёта), на краю
// — серп, уходит с перелётом и рассыпается на серпики, в полу — разрез, щепа.
// =============================================================================

/** Сколько клинка у ног: удар начинается не из точки босса, а с его меча. */
const FAN_R0 = 0.7 * TS;
/** Основа метки веера: тёмно-лиловая, полупрозрачная. */
const FAN_BASE = hx('#2a1244', 112);
/** Основа реза вплотную: темнее и с кровью в тоне. */
const SWEEP_BASE = hx('#2c0c2a', 118);
/** Хорда серпа на краю конуса: чуть шире полосы, но не больше 44 пикселей. */
const fanChord = (R: number, h: number) => Math.max(10, Math.min(44, 2 * R * Math.tan(h) * 1.25));

registerZonePainter(
  'f8_crescent',
  guarded((g, z0: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const st = z0 as Strike;
    const cx = st.x * S;
    const cy = st.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const k = k01(st.t / Math.max(0.01, st.warn));
    const left = st.warn - st.t;
    const sig = left < SIG;
    const tk = !reduced() && tick(left);
    const R = st.r * S;
    const a = st.ang ?? 0;
    const h = (st.arc ?? 0.24) / 2;
    const sd = st.id;
    // «Куда»: вся полоса с первого кадра — тёмная, с лиловым отливом.
    wedgeBase(p, `fanbase|${st.id}`, cx, cy, FAN_R0, R, a, h, FAN_BASE);
    // «Когда»: налив от меча к краю, с разгоном — как сам взмах.
    const rf = FAN_R0 + (R - FAN_R0) * Math.pow(k, 1.7);
    p.col(C.purple, (tk ? 0.5 : 0.3) + 0.14 * k);
    wedgePath(p, cx, cy, FAN_R0, rf, a, h);
    // Кромки: пунктир бежит к краю, к удару — быстрее; в конце — сплошные.
    const run = time * (26 + 80 * k);
    p.col(sig ? (tk ? C.white : C.moon) : C.lilac, 0.55 + 0.35 * k);
    for (const s of [-1, 1]) {
      const ea = a + s * h;
      p.line(
        cx + Math.cos(ea) * FAN_R0,
        cy + Math.sin(ea) * FAN_R0,
        cx + Math.cos(ea) * R,
        cy + Math.sin(ea) * R,
        sig ? undefined : (i) => posMod(i - run, 7) < 4,
      );
    }
    // Край: контур серпа, который тут родится; в последние 0,2 с серп
    // наливается золотом — через миг он же и полетит (контакт).
    const chord = fanChord(R, h);
    const ex = cx + Math.cos(a) * R;
    const ey = cy + Math.sin(a) * R;
    {
      const th = sig ? Math.round(chord * 0.2 * (0.6 + 0.4 * (1 - left / SIG)) * 2) / 2 : 1.4;
      const hot = sig ? (tk ? 2 : 1) : 0;
      const hs = heldShape(
        `rim|${st.id}`,
        `${th}|${hot}|${ex.toFixed(2)}|${ey.toFixed(2)}|${a.toFixed(4)}|${chord.toFixed(2)}`,
        ex - chord,
        ey - chord,
        ex + chord,
        ey + chord,
        (b) => moonShape(b, ex, ey, a, chord, th, hot === 2 ? COL_HOT : hot ? COL_GOLD : COL_COOL),
      );
      if (hs) p.img(hs.cv, hs.x0, hs.y0, sig ? 1 : 0.3 + 0.5 * k);
    }
    // Фронт налива — бегущий серп: растёт вместе с шириной полосы.
    if (k > 0.02 && rf < R - 2) {
      const ch = Math.max(4, Math.min(chord, 2 * rf * Math.tan(h) * 1.15));
      const fx = cx + Math.cos(a) * rf;
      const fy = cy + Math.sin(a) * rf;
      moonRuns(p, fx, fy, a, ch, 1.2 + 2.2 * k, [C.moon, C.lav, C.lilac], 0.6 + 0.4 * k);
    }
    // Серпики загораются там, где прошёл фронт, и мерцают.
    const n = 2 + Math.floor(R / 30);
    for (let i = 0; i < n; i++) {
      const u = 0.18 + 0.72 * hash(sd, i, 1);
      const ku = Math.pow(u, 1 / 1.7);
      const born = (k - ku) * st.warn;
      if (born < 0) continue;
      const rr = FAN_R0 + (R - FAN_R0) * u + born * 5;
      const aa = a + (hash(sd, i, 2) - 0.5) * 1.5 * h;
      const sz = Math.min(2, Math.floor(born / 0.07)) + (hash(sd, i, 3) < 0.3 ? 1 : 0);
      const rot = rotOf(aa + Math.PI) + Math.round(Math.sin(time * 5 + i) * 1.2);
      p.at(
        moonlet(sz, rot, sig ? 3 : 0),
        cx + Math.cos(aa) * rr,
        cy + Math.sin(aa) * rr,
        0.75 + 0.25 * Math.sin(time * 9 + i * 2),
      );
    }
  }),
);

registerImpactPainter('f8_crescent', {
  life: 1.15,
  // Веер — 5–7 конусов разом (эхо — ещё 4): тряска складывается до ~0,3.
  shake: 0.05,
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const cx = rec.x * S;
    const cy = rec.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = (rec.r ?? 4) * S;
    const a = rec.ang ?? 0;
    const h = (rec.arc ?? 0.24) / 2;
    const sd = rec.seed;
    const few = reduced();
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const nx = -uy;
    const ny = ux;
    // Разрез в полу по оси: открывается от меча к краю за 0,07 с, лежит.
    const gk = eOut3(k01(age / 0.07));
    gash(
      p,
      cx + ux * R * 0.3,
      cy + uy * R * 0.3,
      cx + ux * R * 0.93,
      cy + uy * R * 0.93,
      gk,
      1 - k01((age - 0.6) / 0.5),
    );
    // Смаз полёта: тонкое веретено по оси, хвост догоняет голову, гаснет.
    // Толстое веретено с серпом на конце читалось молотом, а не полётом.
    if (age < 0.16) {
      const k = age / 0.16;
      const s0 = FAN_R0 + (R - FAN_R0) * eOut2(k);
      const w = (1.3 + R * Math.tan(h) * 0.07) * (1 - k) + 0.5;
      p.col(k < 0.3 ? C.lav : C.purple, 0.75 * (1 - k));
      lance(p, cx, cy, a, s0, R, w + 0.8, 0.8);
      p.col(k < 0.25 ? C.white : C.moon, 1 - k);
      p.line(
        cx + ux * (s0 + (R - s0) * 0.2),
        cy + uy * (s0 + (R - s0) * 0.2),
        cx + ux * (R - 2),
        cy + uy * (R - 2),
      );
    }
    // Серп на краю: тот, что налился в метке, срывается вперёд с перелётом,
    // тоньшает и рассыпается.
    const chord = fanChord(R, h);
    const T = 0.3;
    if (age < T) {
      const k = age / T;
      const Rb = R + 18 * eOut2(k);
      const ch = chord * (1 + 0.3 * k);
      const bx = cx + ux * Rb;
      const by = cy + uy * Rb;
      const ci = age < 0.06 ? 0 : k < 0.7 ? 1 : 2;
      const ms = moonSprite(a, ch, ch * 0.24 * (1 - 0.65 * k) + 1, ci);
      if (ms) p.img(ms.cv, Math.floor(bx) + ms.ox, Math.floor(by) + ms.oy, 1 - eIn2(k));
    }
    // Серп рассыпается на три серпика — летят дальше и гаснут.
    if (age >= 0.22) {
      moonlets(
        p,
        sd + 5,
        age - 0.22,
        3,
        (i) => {
          const off = (i - 1) * chord * 0.42;
          const Rb = R + 16;
          return [cx + ux * Rb + nx * off, cy + uy * Rb + ny * off, a + (i - 1) * 0.5];
        },
        20,
        12,
        0.55,
        3,
      );
    }
    // Серпики «дыхания луны» — россыпью по следу.
    const n = few ? 2 : 3 + Math.floor(R / 34);
    moonlets(
      p,
      sd,
      age,
      n,
      (i) => {
        const s = FAN_R0 + (R - FAN_R0) * (0.2 + 0.78 * hash(sd, i, 81));
        const side = hash(sd, i, 82) < 0.5 ? -1 : 1;
        const off = s * Math.tan(h) * (0.2 + 0.7 * hash(sd, i, 83)) * side;
        return [
          cx + ux * s + nx * off,
          cy + uy * s + ny * off,
          a + side * (0.9 + 0.5 * hash(sd, i, 84)),
        ];
      },
      10,
      16,
      0.65,
      3,
      0,
      0.05,
      4,
    );
    // Щепа с края разреза — в обе стороны.
    if (!few) {
      const ex = cx + ux * R * 0.8;
      const ey = cy + uy * R * 0.8;
      chips(p, sd, age, ex, ey, 2, a + Math.PI / 2, 0.6, 30, 40, 60, 60, [0.6, 0.95]);
      chips(p, sd + 1, age, ex, ey, 2, a - Math.PI / 2, 0.6, 30, 40, 60, 60, [0.6, 0.95]);
    }
  }),
});

// =============================================================================
// РЕЗ ВПЛОТНУЮ — конус r 2,3 × клинок, раствор 2,5, метка 0,62/спешка, 1,6 урона.
// Метка: широкий тёмный сектор, налив от ног к кромке, кромка — пунктир
// сходится к оси; серпики стягиваются к мечу («вдох»); в конце — трещинки
// у ног. Контакт: огромный смаз-серп через весь сектор сверху вниз, с
// перелётом за кромку; россыпь серпиков, дуга-разрез в полу, волна, щепа.
// =============================================================================

registerZonePainter(
  'f8_sweep',
  guarded((g, z0: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const st = z0 as Strike;
    const cx = st.x * S;
    const cy = st.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const k = k01(st.t / Math.max(0.01, st.warn));
    const left = st.warn - st.t;
    const sig = left < SIG;
    const tk = !reduced() && tick(left);
    const R = st.r * S;
    const a = st.ang ?? 0;
    const h = Math.min(1.5, (st.arc ?? 2.5) / 2);
    const r0 = 0.45 * S;
    wedgeBase(p, `swbase|${st.id}`, cx, cy, r0, R, a, h, SWEEP_BASE);
    const rf = r0 + (R - r0) * Math.pow(k, 1.6);
    p.col(C.purple, (tk ? 0.5 : 0.3) + 0.15 * k);
    wedgePath(p, cx, cy, r0, rf, a, h);
    // Фронт налива — серп через весь сектор.
    if (k > 0.02 && rf < R - 1) {
      p.col(C.moon, 0.5 + 0.5 * k);
      p.arc(cx, cy, rf, a - h, a + h);
      p.col(C.lav, 0.45 + 0.4 * k);
      p.arc(cx, cy, rf - 1, a - h * 0.8, a + h * 0.8);
    }
    // Кромка: штрихи бегут от краёв к оси — удар сойдётся в одну дугу.
    const run = time * (22 + 70 * k);
    const arcLen = 2 * h * R;
    p.col(sig ? (tk ? C.white : C.gold) : k > 0.5 ? C.lav : C.lilac, 0.6 + 0.4 * k);
    p.arc(
      cx,
      cy,
      R,
      a - h,
      a + h,
      sig ? undefined : (u) => posMod(Math.min(u, 1 - u) * arcLen - run, 8) < 5,
    );
    for (const s of [-1, 1]) {
      const ea = a + s * h;
      p.line(
        cx + Math.cos(ea) * r0,
        cy + Math.sin(ea) * r0,
        cx + Math.cos(ea) * R,
        cy + Math.sin(ea) * R,
        sig ? undefined : (i) => posMod(i - run, 6) < 3,
      );
    }
    // Вдох: серпики стягиваются с кромки к мечу — всё быстрее.
    const n = 6;
    for (let i = 0; i < n; i++) {
      const ph = posMod(hash(st.id, i, 5) + st.t * (0.9 + 1.8 * k), 1);
      const rr = R * (1 - eIn2(ph)) + r0 * eIn2(ph);
      const aa = a + (hash(st.id, i, 6) - 0.5) * 1.7 * h;
      p.at(
        moonlet(ph < 0.7 ? 2 : 1, rotOf(aa), sig ? 3 : 0),
        cx + Math.cos(aa) * rr,
        cy + Math.sin(aa) * rr,
        (0.35 + 0.6 * k) * Math.sin(Math.PI * ph),
      );
    }
    // Последние 0,2 с: пол у ног трескается — сейчас ударит.
    if (sig) {
      const q = 1 - left / SIG;
      p.col(C.gash, 0.8);
      for (let i = 0; i < 3; i++) {
        const aa = a + (i - 1) * h * 0.55 + (hash(st.id, i, 9) - 0.5) * 0.3;
        const L = r0 + (R * 0.35 - r0 * 0.5) * q;
        p.line(
          cx + Math.cos(aa) * r0,
          cy + Math.sin(aa) * r0,
          cx + Math.cos(aa) * L,
          cy + Math.sin(aa) * L,
        );
      }
    }
  }),
);

/** Куда идёт рез: сверху вниз, как в кадрах тела (смотрит вправо — по часовой). */
const sweepDir = (a: number) => (Math.cos(a) >= 0 ? 1 : -1);

registerImpactPainter('f8_sweep', {
  life: 1.35,
  shake: 0.3,
  flash: 0.15,
  flashRgb: '190,140,255',
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const cx = rec.x * S;
    const cy = rec.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = (rec.r ?? 2.3) * S;
    const a = rec.ang ?? 0;
    const h = Math.min(1.5, (rec.arc ?? 2.5) / 2);
    const sd = rec.seed;
    const few = reduced();
    const dir = sweepDir(a);
    const angOf = (u: number) => a + dir * (-h + 2 * h * u);
    // Разрез дугой: открывается по ходу реза за 0,06 с, лежит, гаснет.
    const gR = R * 0.8;
    const ga = 1 - k01((age - 0.8) / 0.5);
    if (ga > 0) {
      const reach = eOut3(k01(age / 0.06));
      const lo = dir > 0 ? a - h * 0.92 : a + h * 0.92 - 2 * h * 0.92 * reach;
      const hi = dir > 0 ? a - h * 0.92 + 2 * h * 0.92 * reach : a + h * 0.92;
      p.col(C.lip, 0.7 * ga);
      p.arc(cx, cy + 1, gR, lo, hi);
      p.col(C.gash, ga);
      p.arc(cx, cy, gR, lo, hi);
      p.arc(cx, cy, gR - 1, lo + 0.15, hi - 0.15);
    }
    // Волна по полу: рваная дуга уходит за кромку.
    if (age < 0.26) {
      const k = age / 0.26;
      p.col(C.lav, 0.8 * (1 - k));
      p.arc(
        cx,
        cy,
        R + 4 + 22 * eOut2(k),
        a - h,
        a + h,
        (u) => hash(Math.floor(u * 40), sd, 7) > 0.3,
      );
    }
    // Смаз-серп: весь сектор в кадр удара, дальше хвост тает по ходу реза,
    // голова проходит за кромку сектора (проводка) и гаснет.
    const T = 0.32;
    if (age < T) {
      const k = age / T;
      const head = 1 + 0.17 * eOut2(k01(age / 0.12));
      const tail = head * eIn2(k01(age / 0.28));
      const cols = age < 0.05 ? COL_HOT : k < 0.45 ? COL_MOON : COL_COOL;
      const Rs = R * 0.95;
      const W = R * 0.46 * (1 - 0.55 * k);
      const b = new Buf(cx - Rs - 2, cy - Rs - 2, cx + Rs + 2, cy + Rs + 2);
      band(
        b,
        cx,
        cy,
        Rs,
        angOf,
        tail,
        head,
        (u) => {
          const f = (u - tail) / Math.max(0.01, head - tail);
          return W * Math.pow(f, 0.8) * Math.min(1, (head - u) * 14 + 0.15);
        },
        cols,
        1,
        true,
      );
      b.flush(p, 1 - eIn2(k));
    }
    // Россыпь серпиков по следу — в порядке реза.
    moonlets(
      p,
      sd,
      age,
      few ? 5 : 12,
      (i) => {
        const u = (i + hash(sd, i, 91)) / (few ? 5 : 12);
        const an = angOf(u);
        const rr = R * (0.5 + 0.45 * hash(sd, i, 92));
        return [cx + Math.cos(an) * rr, cy + Math.sin(an) * rr, an + dir * 0.35];
      },
      14,
      22,
      0.9,
      3,
      0,
      0.05,
      3,
    );
    // Щепа из разреза — наружу (пыль здесь читалась серыми камнями).
    if (!few)
      for (let j = 0; j < 4; j++) {
        const an = angOf(0.15 + 0.23 * j);
        chips(
          p,
          sd + j * 13,
          age,
          cx + Math.cos(an) * gR,
          cy + Math.sin(an) * gR,
          2,
          an,
          0.5,
          26,
          40,
          55,
          70,
          [0.8, 1.2],
        );
      }
  }),
});

// =============================================================================
// СЛЕД ВЫПАДА — линия по пути рывка, w 0,55, метка 0,42. Метка: путь уже
// разрезан (светлая нить), по нему «спят» серпы — просыпаются от начала
// рывка к концу вслед за наливом. Контакт: путь вспыхивает, серпы
// поднимаются из пола и рассыпаются серпиками, в полу — длинный разрез.
// =============================================================================

registerZonePainter(
  'f8_trail',
  guarded((g, z0: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const st = z0 as Strike;
    const x0 = st.x * S;
    const y0 = st.y * S;
    const p = new Pen(g, px, py, x0, y0);
    const k = k01(st.t / Math.max(0.01, st.warn));
    const left = st.warn - st.t;
    const sig = left < SIG;
    const tk = !reduced() && tick(left);
    const L = st.r * S;
    const a = st.ang ?? 0;
    const w = (st.w ?? 0.55) * S;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const nx = -uy;
    const ny = ux;
    p.col(C.vDk, 0.36);
    strip(p, x0, y0, a, 0, L, w);
    const lf = L * Math.pow(k, 1.25);
    p.col(C.purple, (tk ? 0.4 : 0.26) + 0.1 * k);
    strip(p, x0, y0, a, 0, lf, w);
    const run = time * (30 + 60 * k);
    p.col(sig ? (tk ? C.white : C.moon) : C.lilac, 0.5 + 0.4 * k);
    for (const s of [-1, 1])
      p.line(
        x0 + nx * w * s,
        y0 + ny * w * s,
        x0 + ux * L + nx * w * s,
        y0 + uy * L + ny * w * s,
        sig ? undefined : (i) => posMod(i - run, 7) < 4,
      );
    // Нить разреза — её оставил сам выпад.
    p.col(sig ? C.white : C.lav, 0.55 + 0.45 * k);
    p.line(x0, y0, x0 + ux * L, y0 + uy * L);
    // Серпы вдоль пути: растут, когда их догоняет налив.
    const n = Math.max(2, Math.round(L / 14));
    for (let i = 0; i < n; i++) {
      const s = ((i + 0.5) / n) * L;
      const g0 = (lf - s) / (L * 0.25);
      if (g0 <= 0) continue;
      const sz = Math.min(4, 2 + Math.floor(g0 * 3));
      const side = i % 2 ? 1 : -1;
      // Рогами назад, к началу выпада, с наклоном то в одну, то в другую
      // сторону: «U» поперёк пути читались чашками.
      p.at(
        moonlet(sz, trailRot(a, side) + Math.round(Math.sin(time * 6 + i) * 0.8), sig ? 3 : 0),
        x0 + ux * s + nx * side * 2,
        y0 + uy * s + ny * side * 2,
        0.8 + 0.2 * Math.sin(time * 11 + i),
      );
    }
  }),
);

/** Поворот серпа следа: рога к началу пути, наклон по стороне. */
const trailRot = (a: number, side: number) => rotOf(a + Math.PI + side * 0.55);

registerImpactPainter('f8_trail', {
  life: 1.1,
  shake: 0.2,
  flash: 0.12,
  flashRgb: '200,170,255',
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const x0 = rec.x * S;
    const y0 = rec.y * S;
    const p = new Pen(g, px, py, x0, y0);
    const L = (rec.r ?? 3) * S;
    const a = rec.ang ?? 0;
    const sd = rec.seed;
    const few = reduced();
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const nx = -uy;
    const ny = ux;
    const x1 = x0 + ux * L;
    const y1 = y0 + uy * L;
    gash(p, x0, y0, x1, y1, 1, 1 - k01((age - 0.6) / 0.5), true);
    // Кадр удара: путь вспыхивает белой нитью в лиловой кайме и гаснет от
    // концов к середине.
    if (age < 0.2) {
      const k = age / 0.2;
      const cut = 0.5 * eOut2(k);
      p.col(C.lilac, 0.7 * (1 - k));
      lance(p, x0 + ux * L * cut, y0 + uy * L * cut, a, 0, L * (1 - 2 * cut), 3 * (1 - k) + 1, 0.5);
      p.col(k < 0.3 ? C.white : C.moon, 1 - k);
      p.line(
        x0 + ux * L * cut,
        y0 + uy * L * cut,
        x0 + ux * L * (1 - cut),
        y0 + uy * L * (1 - cut),
      );
      p.line(
        x0 + ux * L * cut + nx,
        y0 + uy * L * cut + ny,
        x0 + ux * L * (1 - cut) + nx,
        y0 + uy * L * (1 - cut) + ny,
        (i, n) => i > n * 0.15 && i < n * 0.85,
      );
    }
    // Серпы поднимаются из пола и рассыпаются.
    const n = Math.max(2, Math.round(L / 14));
    for (let i = 0; i < n; i++) {
      const s = ((i + 0.5) / n) * L;
      const side = i % 2 ? 1 : -1;
      const bx = x0 + ux * s + nx * side * 1.5;
      const by = y0 + uy * s + ny * side * 1.5;
      const t = age - 0.012 * i;
      if (t < 0) continue;
      if (t < 0.32) {
        const k = t / 0.32;
        const sz = t < 0.05 ? 5 : Math.max(2, Math.round(5 - 3 * k));
        p.at(
          moonlet(sz, trailRot(a, side), t < 0.06 ? 3 : 0),
          bx + nx * side * 4 * eOut2(k),
          by + ny * side * 4 * eOut2(k) - 9 * eOut2(k),
          1 - eIn2(k),
        );
      }
    }
    moonlets(
      p,
      sd,
      age - 0.2,
      few ? 3 : Math.min(10, n * 2),
      (i) => {
        const s = ((Math.floor(i / 2) + 0.5) / n) * L;
        const side = i % 2 ? 1 : -1;
        return [x0 + ux * s + nx * side * 5, y0 + uy * s + ny * side * 5 - 8, a + side * 1.2];
      },
      8,
      14,
      0.6,
      2,
      0,
      0,
      3,
    );
    if (!few)
      chips(
        p,
        sd,
        age,
        x0 + ux * L * 0.5,
        y0 + uy * L * 0.5,
        4,
        a + Math.PI / 2,
        1.4,
        25,
        35,
        50,
        60,
        [0.7, 1.05],
      );
    dust(p, sd, age, x1, y1, few ? 1 : 2, a, 0.7, 16, 16, 2, 5, 5, 0.6, 0, 0.45);
  }),
});

// =============================================================================
// ШЕСТЬ ГЛАЗ — линия 7,2 × клинок через место героя, w 0,48, метка 1,5…2,2 с.
// Метка: разрез пространства — сомкнутая щель во всю длину медленно
// раскрывается в огромный глаз-миндалину: красные прожилки, золотая
// радужка, зрачок следит за героем. Открылся — удар; последние 0,2 с зрачок
// сжимается в нить. Пока метка свежая — золотой взгляд тянется от головы
// демона: видно, откуда пришла. Контакт: глаз схлопывается в раскалённую
// черту, черта расходится двумя губами, золотые искры-серпики.
// =============================================================================

const EYE_C = {
  lidUp: hx('#eadcff'),
  lidLo: hx('#8a5ac8'),
  sclera: hx('#220816'),
  scleraDk: hx('#12040c'),
  vein: hx('#8a1428'),
  iris: hx('#ffd84a'),
  irisHi: hx('#fff0a0'),
  irisRim: hx('#b8801e'),
  pupil: hx('#0a0206'),
  slit: hx('#f0e6ff'),
  ink: hx('#0c0612'),
};

/**
 * Глаз-миндалина в своих координатах: `u` вдоль (0…L), `v` поперёк. `open`
 * 0…1 — раскрытие, `at` — где радужка вдоль, `look` — сдвиг зрачка, `slit`
 * — полуширина зрачка. `put` получает пиксели глаза; шаг меньше пикселя —
 * без дыр при повороте.
 */
function eyeShape(
  put: (u: number, v: number, c: RGBA) => void,
  L: number,
  H: number,
  open: number,
  at: number,
  look: number,
  slit: number,
  seed: number,
  step = 1,
  hot = false,
): void {
  const qa = (4 * at * (L - at)) / (L * L);
  const ir = H * open * Math.pow(Math.max(0, qa), 0.8) * 0.92;
  const mid = at;
  for (let u = 0; u <= L; u += step) {
    const q = (4 * u * (L - u)) / (L * L);
    const hh = H * open * Math.pow(Math.max(0, q), 0.8);
    if (hh < 0.7) {
      put(u, 0, hot ? EYE_C.slit : EYE_C.lidLo);
      continue;
    }
    const vein = Math.sin(u * 0.33 + seed) * hh * 0.55;
    for (let v = -hh; v <= hh; v += step) {
      let c: RGBA;
      const du = u - mid;
      if (v <= -hh + 1) c = hot ? EYE_C.slit : EYE_C.lidUp;
      else if (v >= hh - 1) c = EYE_C.lidLo;
      else if (du * du + v * v * 1.3 < ir * ir) {
        if (Math.abs(du - look) < slit && Math.abs(v) < ir * 0.9) c = EYE_C.pupil;
        else if (du * du + v * v * 1.3 > (ir - 1) * (ir - 1)) c = EYE_C.irisRim;
        else if (du < -ir * 0.2 && v < -ir * 0.2) c = EYE_C.irisHi;
        else c = EYE_C.iris;
      } else if (Math.abs(v - vein) < 0.55 || Math.abs(v + vein * 0.7) < 0.5) c = EYE_C.vein;
      else c = Math.abs(v) > hh - 2.2 ? EYE_C.scleraDk : EYE_C.sclera;
      put(u, v, c);
    }
  }
}

registerZonePainter(
  'f8_eyeslash',
  guarded((g, z0: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const st = z0 as Strike & { eye?: number };
    const x0 = st.x * S;
    const y0 = st.y * S;
    const p = new Pen(g, px, py, x0, y0);
    const k = k01(st.t / Math.max(0.01, st.warn));
    const left = st.warn - st.t;
    const sig = left < SIG;
    const tk = !reduced() && tick(left);
    const L = st.r * S;
    const a = st.ang ?? 0;
    const w = (st.w ?? 0.48) * S;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const nx = -uy;
    const ny = ux;
    // Глаз раскрывается к удару: медленно, в последней трети — быстрее.
    // Раскрытие — 16 ступеней: глаз пересобирается при смене ступени.
    const open = sig ? 1 : Math.round((0.06 + 0.94 * Math.pow(k, 1.35)) * 16) / 16;
    // Радужка — сбоку от середины: в середине стоит герой и закрыл бы её.
    // Зрачок косится на героя.
    const at = L * (0.5 + ((st.eye ?? 0) & 1 ? 1 : -1) * 0.24);
    const sim = paintSim();
    let look = 0;
    if (sim) {
      const hx0 = sim.hero.x * S - (x0 + ux * at);
      const hy0 = sim.hero.y * S - (y0 + uy * at);
      look = Math.round(Math.max(-2, Math.min(2, (hx0 * ux + hy0 * uy) * 0.1)));
    }
    const slit = sig ? 0.35 : 1.1;
    const hs = heldShape(
      `eye|${st.id}`,
      `${open}|${look}|${sig ? 1 : 0}|${tk ? 1 : 0}|${x0.toFixed(2)}|${y0.toFixed(2)}|${a.toFixed(4)}|${L}`,
      Math.min(x0, x0 + ux * L) - w,
      Math.min(y0, y0 + uy * L) - w,
      Math.max(x0, x0 + ux * L) + w,
      Math.max(y0, y0 + uy * L) + w,
      (b) => {
        // «Куда»: вся полоса удара — тёмная, с пунктиром кромок; в последние
        // 0,2 с кромки сплошные и золотые. Растр вместе с глазом — полоса
        // не перерисовывается строками в каждом кадре.
        const band = hx(C.vDk, Math.round(255 * (0.36 + 0.1 * open)));
        polyRows(
          [x0 + nx * w, x0 + ux * L + nx * w, x0 + ux * L - nx * w, x0 - nx * w],
          [y0 + ny * w, y0 + uy * L + ny * w, y0 + uy * L - ny * w, y0 - ny * w],
          (Y, xa, xb) => {
            for (let x = xa; x <= xb; x++) b.put(x, Y, band);
          },
        );
        const rim = hx(
          sig ? (tk ? C.white : C.gold) : C.goldDk,
          sig ? 255 : Math.round(255 * (0.4 + 0.4 * open)),
        );
        for (const s of [-1, 1])
          bufLine(
            b,
            x0 + nx * w * s,
            y0 + ny * w * s,
            x0 + ux * L + nx * w * s,
            y0 + uy * L + ny * w * s,
            rim,
            sig ? undefined : (i) => posMod(i + (s > 0 ? 0 : 3), 6) < 3,
          );
        eyeShape(
          (u, v, c) => b.put(x0 + ux * u + nx * v, y0 + uy * u + ny * v, c),
          L,
          w * 0.95,
          open,
          at,
          look,
          slit,
          st.id,
          0.7,
          tk,
        );
      },
    );
    if (hs) p.img(hs.cv, hs.x0, hs.y0, 0.9);
    // Пока метка свежая — золотой взгляд от головы демона.
    const boss = mobById(st.from);
    if (boss && st.t < 0.3) {
      const q = st.t / 0.3;
      const bx = boss.x * S;
      const by = boss.y * S - HEAD_UP;
      const ex = x0 + ux * L * 0.5;
      const ey = y0 + uy * L * 0.5;
      const reach = eOut2(k01(q * 2.2));
      p.col(C.gold, 0.9 * (1 - q));
      p.line(bx, by, bx + (ex - bx) * reach, by + (ey - by) * reach, (i) => i % 3 !== 2);
    }
  }),
);

registerImpactPainter('f8_eyeslash', {
  life: 0.95,
  shake: 0.14,
  flash: 0.12,
  flashRgb: '255,220,120',
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const x0 = rec.x * S;
    const y0 = rec.y * S;
    const p = new Pen(g, px, py, x0, y0);
    const L = (rec.r ?? 7) * S;
    const a = rec.ang ?? 0;
    const w = (rec.w ?? 0.48) * S;
    const sd = rec.seed;
    const few = reduced();
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const nx = -uy;
    const ny = ux;
    const cx = x0 + ux * L * 0.5;
    const cy = y0 + uy * L * 0.5;
    gash(
      p,
      x0 + ux * L * 0.06,
      y0 + uy * L * 0.06,
      x0 + ux * L * 0.94,
      y0 + uy * L * 0.94,
      1,
      1 - k01((age - 0.5) / 0.45),
    );
    // Кадр удара: глаз схлопнулся в раскалённую черту во всю длину.
    if (age < 0.07) {
      p.col(C.lilac, 0.9);
      lance(p, x0, y0, a, 0, L, 3.6, 0.5);
      p.col(C.gold, 1);
      lance(p, x0, y0, a, L * 0.02, L * 0.98, 2.2, 0.5);
      p.col(C.white, 1);
      p.line(x0 + ux * L * 0.04, y0 + uy * L * 0.04, x0 + ux * L * 0.96, y0 + uy * L * 0.96);
      p.col(C.goldHi, 1);
      lance(p, cx - nx * 6, cy - ny * 6, a + Math.PI / 2, 0, 12, 1.6, 0.5);
    } else if (age < 0.4) {
      // Черта расходится двумя губами — разрез раскрылся и гаснет.
      const k = (age - 0.07) / 0.33;
      const off = 1 + 4 * eOut2(k);
      const shrink = 0.5 * eIn2(k);
      for (const s of [-1, 1]) {
        p.col(s < 0 ? C.moon : C.lilac, 1 - k);
        lance(
          p,
          x0 + nx * off * s,
          y0 + ny * off * s,
          a,
          L * shrink * 0.5,
          L * (1 - shrink * 0.5),
          1.3 * (1 - k) + 0.4,
          0.5,
        );
      }
      p.col(C.void, 0.7 * (1 - k));
      lance(p, x0, y0, a, L * 0.1, L * 0.9, Math.max(0.5, off - 1.5), 0.5);
    }
    // Золотые серпики — поперёк черты, в обе стороны.
    moonlets(
      p,
      sd,
      age,
      few ? 4 : 10,
      (i) => {
        const s = L * (0.08 + 0.84 * hash(sd, i, 101));
        const side = i % 2 ? 1 : -1;
        return [
          x0 + ux * s,
          y0 + uy * s,
          a + side * (Math.PI / 2 + (hash(sd, i, 102) - 0.5) * 0.8),
        ];
      },
      22,
      26,
      0.6,
      2,
      1,
    );
  }),
});

// =============================================================================
// КОЛЬЦА ДУГ (фаза 3) — круги r 0,62 по окружностям 2,4 / 4,7 / 7 вокруг
// демона, у каждого кольца — окно. Метка: кольцо целиком (одной картинкой
// на кольцо, не на каждый круг): тёмная лента с кромками, по ней бегут
// блики, у окна — светлые «ворота»; в каждом круге растёт стоячий серп.
// Контакт: серпы кольца вырастают из пола разом и гаснут, в полу —
// царапина по дуге. Тряска — чуть-чуть на круг (их в кольце до 46).
// =============================================================================

type ArcStrike = Strike & { ang0: number; R: number; cx: number; cy: number };

/** Кеш колец: пиксельные кромки и лента одним холстом на радиус и накал. */
function ringImg(Rpx: number, w: number, hot: number): HTMLCanvasElement {
  const R = Math.round(Rpx);
  const W = Math.round(w);
  return sprite(60000 + R * 40 + W * 3 + hot, () => {
    const s = 2 * (R + W + 3);
    const p = new Px(s, s);
    const c = s / 2;
    const rim = hot ? hx('#fff6dc') : hx('#cdb4ff');
    const rim2 = hot ? hx('#ffd84a') : hx('#8a5ad0');
    const fill = hot ? hx('#7a4ac0', 110) : hx('#1e0b30', 110);
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
        const o = d - R;
        if (Math.abs(o) > W + 0.5) continue;
        if (o > W - 0.5) p.set(x, y, rim);
        else if (o < -W + 0.5) p.set(x, y, rim2);
        else p.set(x, y, fill);
      }
    return p;
  });
}

/** Кольцо, собранное из живых кругов: середина, радиус, углы кругов. */
interface Ring {
  cx: number;
  cy: number;
  R: number;
  a0: number;
  a1: number;
  t: number;
  warn: number;
}
const ringDrawn = new Map<string, number>();
/** Угол круга кольца по месту — для контакта (в записи удара его нет). */
const arcAng = new Map<number, number>();
const arcKey = (x: number, y: number) => Math.round(x * 16) * 100003 + Math.round(y * 16);

function ringOf(st: ArcStrike, sim: Sim | null): Ring | null {
  if (!sim) return null;
  const angs: number[] = [];
  for (const s of sim.strikes) {
    if (s.art !== 'f8_arc') continue;
    const q = s as ArcStrike;
    if (
      Math.abs(q.R - st.R) > 0.01 ||
      Math.abs(q.cx - st.cx) > 0.01 ||
      Math.abs(q.cy - st.cy) > 0.01
    )
      continue;
    angs.push(posMod(q.ang0, TAU));
  }
  if (angs.length < 2) return null;
  angs.sort((x, y) => x - y);
  // Окно — самый большой просвет между соседними кругами.
  let gi = angs.length - 1;
  let gap = angs[0] + TAU - angs[angs.length - 1];
  for (let i = 0; i < angs.length - 1; i++)
    if (angs[i + 1] - angs[i] > gap) {
      gap = angs[i + 1] - angs[i];
      gi = i;
    }
  const pad = 0.62 / st.R;
  const a0 = angs[(gi + 1) % angs.length] - pad;
  let a1 = angs[gi] + pad;
  while (a1 <= a0) a1 += TAU;
  return { cx: st.cx, cy: st.cy, R: st.R, a0, a1, t: st.t, warn: st.warn };
}

registerZonePainter(
  'f8_arc',
  guarded((g, z0: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const st = z0 as ArcStrike;
    const x = st.x * S;
    const y = st.y * S;
    const p = new Pen(g, px, py, x, y);
    const k = k01(st.t / Math.max(0.01, st.warn));
    const left = st.warn - st.t;
    const sig = left < SIG;
    const tk = !reduced() && tick(left);
    const w = st.r * S;
    arcAng.set(arcKey(st.x, st.y), st.ang0);
    if (arcAng.size > 400) arcAng.delete(arcAng.keys().next().value as number);
    // Кольцо целиком — первым из его кругов в этом кадре.
    const ring = ringOf(st, paintSim());
    const rk = `${st.R.toFixed(2)}|${st.cx.toFixed(2)}|${st.cy.toFixed(2)}`;
    if (ring && ringDrawn.get(rk) !== time) {
      ringDrawn.set(rk, time);
      if (ringDrawn.size > 12) ringDrawn.delete(ringDrawn.keys().next().value as string);
      const rcx = ring.cx * S;
      const rcy = ring.cy * S;
      const Rp = ring.R * S;
      const img = ringImg(Rp, w * (0.55 + 0.45 * k), sig && !tk ? 1 : 0);
      // Окно вырезано: кольцо рисуется только по дуге кругов.
      g.save();
      g.beginPath();
      g.moveTo(rcx + p.qx, rcy + p.qy);
      g.arc(rcx + p.qx, rcy + p.qy, Rp + w + 4, ring.a0, ring.a1);
      g.closePath();
      g.clip();
      p.img(img, rcx - img.width / 2, rcy - img.height / 2, 0.45 + 0.55 * k);
      g.restore();
      // Ворота окна: светлые столбики на концах дуги.
      p.col(sig ? C.white : C.gold, 0.6 + 0.4 * k);
      for (const e of [ring.a0, ring.a1]) {
        const ex = Math.cos(e);
        const ey = Math.sin(e);
        p.line(
          rcx + ex * (Rp - w - 2),
          rcy + ey * (Rp - w - 2),
          rcx + ex * (Rp + w + 2),
          rcy + ey * (Rp + w + 2),
        );
      }
      // Блики бегут по кольцу, к удару — быстрее.
      const span = ring.a1 - ring.a0;
      for (let j = 0; j < 3; j++) {
        const ph = posMod(j / 3 + time * (0.12 + 0.5 * k) * (st.R < 3 ? 1.6 : 1), 1);
        const an = ring.a0 + span * ph;
        p.at(
          moonlet(1, rotOf(an + Math.PI), 3),
          rcx + Math.cos(an) * Rp,
          rcy + Math.sin(an) * Rp,
          0.9,
        );
      }
      g.globalAlpha = 1;
    } else if (!ring) {
      // Без симуляции (лист кадров) — свой кусок ленты.
      const rcx = x - Math.cos(st.ang0) * st.R * S;
      const rcy = y - Math.sin(st.ang0) * st.R * S;
      const half = 0.55 / st.R;
      p.col(C.vDk, 0.4);
      wedge(p, rcx, rcy, st.R * S - w, st.R * S + w, st.ang0, half);
      p.col(sig ? C.white : C.lav, 0.5 + 0.5 * k);
      p.arc(rcx, rcy, st.R * S + w, st.ang0 - half, st.ang0 + half);
      p.arc(rcx, rcy, st.R * S - w, st.ang0 - half, st.ang0 + half);
    }
    // Стоячий серп в круге: растёт к удару, рогами к демону.
    const sz = Math.min(4, Math.floor(k * 5));
    p.at(moonlet(sz, rotOf(st.ang0 + Math.PI), sig ? 3 : 0), x, y, tk ? 1 : 0.55 + 0.45 * k);
  }),
);

registerImpactPainter('f8_arc', {
  life: 0.75,
  shake: 0.012,
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const x = rec.x * S;
    const y = rec.y * S;
    const p = new Pen(g, px, py, x, y);
    const sd = rec.seed;
    let a0 = arcAng.get(arcKey(rec.x, rec.y));
    if (a0 === undefined) {
      const b = bossOf(paintSim());
      a0 = b ? Math.atan2(rec.y - b.y, rec.x - b.x) : (rec.ang ?? 0);
    }
    const tx = -Math.sin(a0);
    const ty = Math.cos(a0);
    // Царапина по дуге.
    const ga = 1 - k01((age - 0.35) / 0.4);
    gash(p, x - tx * 6, y - ty * 6, x + tx * 6, y + ty * 6, eOut3(k01(age / 0.05)), ga);
    // Серп вырастает из пола, поднимается и тает.
    if (age < 0.36) {
      const k = age / 0.36;
      const sz = age < 0.05 ? 6 : Math.max(1, Math.round(5 - 4 * k));
      p.at(moonlet(sz, rotOf(a0 + Math.PI), age < 0.07 ? 3 : 0), x, y - 8 * eOut2(k), 1 - eIn2(k));
      if (age < 0.05) {
        p.col(C.white, 0.9);
        p.dot(x - 1, y + 1, 3, 1);
      }
    }
    moonlets(
      p,
      sd,
      age - 0.06,
      1,
      () => [x, y - 6, a0 + (hash(sd, 1, 1) - 0.5) * 1.2],
      12,
      12,
      0.5,
      2,
      0,
      0,
      5,
    );
  }),
});

// =============================================================================
// ЛУЧ ЛУНЫ (фаза 3) — линия 16 клеток от луны, w 0,42, метка 1,15 с. Метка —
// на полу (поверх темноты она ложилась стеклом на демона и героя): пунктир
// во всю длину, по лучу к луне стягиваются блики, у луны разгорается блик; к
// удару луч толще. Контакт — поверх темноты: столб света во всю длину,
// белое ядро, голубая кайма, сгустки бегут от луны, сужается и гаснет.
// =============================================================================

registerZonePainter(
  'f8_moonray',
  guarded((g, z0: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const st = z0 as Strike;
    const x0 = st.x * S;
    const y0 = st.y * S;
    const p = new Pen(g, px, py, x0, y0);
    const k = k01(st.t / Math.max(0.01, st.warn));
    const left = st.warn - st.t;
    const sig = left < SIG;
    const tk = !reduced() && tick(left);
    const L = st.r * S;
    const a = st.ang ?? 0;
    const w = (st.w ?? 0.42) * S;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const nx = -uy;
    const ny = ux;
    p.col(C.skyDk, 0.1 + 0.14 * k);
    strip(p, x0, y0, a, 2, L, w);
    // Кромки — редкий пунктир, к удару гуще.
    p.col(sig ? C.white : C.sky, 0.3 + 0.4 * k);
    const gap = Math.round(9 - 5 * k);
    for (const s of [-1, 1])
      p.line(
        x0 + nx * w * s,
        y0 + ny * w * s,
        x0 + ux * L + nx * w * s,
        y0 + uy * L + ny * w * s,
        sig ? undefined : (i) => posMod(i + time * 30, gap) < 2,
      );
    // Ядро луча: тонкое, наливается.
    p.col(tk ? C.white : C.sky, 0.35 + 0.6 * k);
    p.line(x0, y0, x0 + ux * L, y0 + uy * L, (i) => k > 0.6 || posMod(i - time * 60, 5) < 3);
    if (k > 0.55) {
      p.col(C.white, (k - 0.55) * 2);
      strip(p, x0, y0, a, 3, L, 0.8 * (k - 0.5));
    }
    // Блики стягиваются к луне — луна набирает свет.
    for (let i = 0; i < 6; i++) {
      const ph = posMod(hash(st.id, i, 3) - st.t * (0.5 + 1.2 * k), 1);
      const s = L * ph;
      p.at(
        moonlet(0, rotOf(a), 2),
        x0 + ux * s,
        y0 + uy * s,
        0.3 + 0.7 * k * Math.sin(Math.PI * ph),
      );
    }
    // Блик у луны.
    const gr = 1 + Math.round(4 * k);
    p.col(C.white, 0.5 + 0.5 * k);
    p.dot(x0 - gr, y0, gr * 2 + 1, 1);
    p.dot(x0, y0 - gr, 1, gr * 2 + 1);
    p.col(C.sky, 0.6);
    p.dot(x0 - 1, y0 - 1, 3, 3);
  }),
);

registerImpactPainter('f8_moonray', {
  life: 0.7,
  shake: 0.12,
  flash: 0.2,
  flashRgb: '215,225,255',
  above: true,
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const x0 = rec.x * S;
    const y0 = rec.y * S;
    const p = new Pen(g, px, py, x0, y0);
    const L = (rec.r ?? 16) * S;
    const a = rec.ang ?? 0;
    const w = (rec.w ?? 0.42) * S;
    const sd = rec.seed;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    // Луч бьёт от луны: фронт проходит всю длину за 0,05 с, дальше столб
    // пульсирует, сужается и гаснет; ядро — белое, по краям — голубая кайма.
    if (age < 0.45) {
      const k = age / 0.45;
      const reach = L * eOut2(k01(age / 0.05));
      const pulse = 1 + 0.18 * Math.sin(age * 90);
      const ww = w * (1.4 - 1.15 * eOut2(k)) * pulse;
      p.col(C.skyDk, 0.5 * (1 - k));
      strip(p, x0, y0, a, 0, reach, ww * 0.7 + 2, ww + 2);
      p.col(C.sky, 0.85 * (1 - k));
      strip(p, x0, y0, a, 0, reach, ww * 0.6, ww);
      p.col(C.white, 1 - eIn2(k));
      strip(p, x0, y0, a, 0, reach, Math.max(0.5, ww * 0.25), Math.max(0.5, ww * 0.45));
      // Бегущие сгустки света по столбу.
      p.col(C.white, 0.9 * (1 - k));
      for (let j = 0; j < 4; j++) {
        const s = posMod(j / 4 + age * 5, 1) * reach;
        strip(p, x0, y0, a, s, s + 6, ww * 0.7);
      }
    }
    // Звезда у луны.
    if (age < 0.25) {
      const k = age / 0.25;
      const r = Math.round(9 * (1 - k)) + 2;
      p.col(C.white, 1 - k);
      p.dot(x0 - r, y0, 2 * r + 1, 1);
      p.dot(x0, y0 - r, 1, 2 * r + 1);
      p.col(C.sky, 1 - k);
      p.dot(x0 - 2, y0 - 2, 5, 5);
    }
    // Блёстки вдоль луча.
    moonlets(
      p,
      sd,
      age,
      8,
      (i) => {
        const s = L * (0.06 + 0.9 * hash(sd, i, 111));
        return [x0 + ux * s, y0 + uy * s, a + (i % 2 ? 1 : -1) * Math.PI * 0.5];
      },
      6,
      10,
      0.55,
      1,
      2,
      0.05,
      4,
    );
  }),
});

// =============================================================================
// ГЛАЗА ПОЛА (фаза 1+) — шесть глаз арены: миндалина в пикселях, зрачок
// следит за героем, моргают каждый в свой час; пока демон в «шести глазах»
// — радужка разгорается. Кадры — из кеша (раскрытие × взгляд × накал).
// =============================================================================

function floorEyeImg(open: number, lx: number, ly: number, hot: number): HTMLCanvasElement {
  return sprite(70000 + open * 100 + (lx + 3) * 10 + (ly + 2) * 2 + hot, () => {
    const L = 22;
    const H = 5;
    const p = new Px(L + 3, 2 * H + 3);
    const cy = H + 1.5;
    eyeShape(
      (u, v, c) =>
        p.set(Math.floor(u + 1.5), Math.floor(cy + v + (Math.abs(v) < 2 ? ly * 0.5 : 0)), c),
      L,
      H,
      open / 4,
      L / 2,
      lx,
      hot ? 0.6 : 1.1,
      3,
      0.5,
    );
    return p;
  });
}

registerZonePainter(
  'f8_floor_eye',
  guarded((g, z0: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const z = z0 as Zone;
    const x = z.x * S;
    const y = z.y * S;
    const p = new Pen(g, px, py, x, y);
    const sd = seedOf(z.id);
    // Открывается при рождении, дальше моргает раз в 3,5–6 с.
    const born = k01(z.t / 0.8);
    const per = 3.5 + 2.5 * hash(sd, 1, 1);
    const ph = posMod(time + hash(sd, 2, 2) * per, per);
    const blink = ph < 0.16 ? Math.abs(ph - 0.08) / 0.08 : 1;
    const open = Math.round(4 * Math.min(born, blink));
    const sim = paintSim();
    let lx = 0;
    let ly = 0;
    if (sim) {
      const dx = sim.hero.x - z.x;
      const dy = sim.hero.y - z.y;
      const d = Math.hypot(dx, dy) || 1;
      lx = Math.round((dx / d) * 3);
      ly = Math.round((dy / d) * 1.4);
    }
    const hot = sim && bossOf(sim)?.mode === 'eyes' ? 1 : 0;
    // Тёмное пятно под глазом — глаз «в полу», а не наклейка на нём.
    p.col(C.void, 0.55);
    p.dot(x - 12, y - 3, 24, 7);
    p.dot(x - 10, y - 4, 20, 9);
    const im = floorEyeImg(open, lx, ly, hot);
    p.img(im, x - im.width / 2, y - im.height / 2, 0.92);
    if (hot && open > 2) {
      p.col(C.gold, 0.25 + 0.2 * Math.sin(time * 12 + sd));
      p.dot(x - 13, y, 1, 1);
      p.dot(x + 13, y, 1, 1);
    }
  }),
);

// =============================================================================
// ЛУННЫЙ СЕРП (фаза 2+) — снаряд `f8_serp`: вертится (8 кадров на оборот),
// за ним — два отставших силуэта и искры; кадр — из кеша по направлению и
// повороту. Контакт: вспышка, серп раскалывается на серпики, летящие
// дальше по ходу, на полу — лужица лунного света.
// =============================================================================

const SERP_PAD = 16;

/** Кадр серпа: направление полёта `q` (16), поворот `f` (8). */
function serpImg(q: number, f: number): Sprite {
  const key = 80000 + q * 8 + f;
  let c = sprites.get(key);
  if (!c) {
    const n = 15 + SERP_PAD * 2;
    const p = new Px(n, n);
    const cx = n / 2;
    const cy = n / 2;
    const ang = (q / 16) * TAU;
    // След: два отставших силуэта серпа (тусклее, мельче), искры.
    for (let j = 2; j >= 1; j--) {
      const bx = cx - Math.cos(ang) * j * 5.5;
      const by = cy - Math.sin(ang) * j * 5.5;
      const spin = ((f - j) / 8) * TAU;
      const al = j === 1 ? 150 : 80;
      const col = j === 1 ? hx('#a47ae6', al) : hx('#5a2aa0', al);
      for (let y = -7; y <= 7; y++)
        for (let x = -7; x <= 7; x++) {
          const d = Math.hypot(x + 0.5, y + 0.5);
          const kx = Math.cos(spin) * 2.6;
          const ky = Math.sin(spin) * 2.6;
          if (d < 6 - j && Math.hypot(x + 0.5 - kx, y + 0.5 - ky) >= 5 - j)
            p.set(Math.floor(bx + x), Math.floor(by + y), col);
        }
    }
    for (let j = 0; j < 3; j++) {
      const s = 9 + j * 5;
      const off = ((f + j * 3) % 5) - 2;
      p.set(
        Math.floor(cx - Math.cos(ang) * s - Math.sin(ang) * off),
        Math.floor(cy - Math.sin(ang) * s + Math.cos(ang) * off),
        hx(j ? '#d6c2ff' : '#ffffff', 220 - j * 50),
      );
    }
    // Сам серп: вертящийся полумесяц, кромка раскалена.
    const spin = (f / 8) * TAU;
    const kx = Math.cos(spin) * 2.7;
    const ky = Math.sin(spin) * 2.7;
    for (let y = -8; y <= 8; y++)
      for (let x = -8; x <= 8; x++) {
        const qx = x + 0.5;
        const qy = y + 0.5;
        const d = Math.hypot(qx, qy);
        if (d >= 6.3 || Math.hypot(qx - kx, qy - ky) < 5.5) continue;
        const dC = Math.hypot(qx - kx, qy - ky) - 5.5;
        const light = (qx * -0.7 + qy * -0.7) / 6;
        const col =
          d > 5.3
            ? light > -0.4
              ? hx('#ffffff')
              : hx('#fff6dc')
            : dC < 0.9
              ? hx('#9a6ae0')
              : hx('#e2d0ff');
        p.set(Math.floor(cx + x), Math.floor(cy + y), col);
      }
    p.outline(hx('#43206a', 170));
    c = p.canvas();
    sprites.set(key, c);
  }
  // Серп парит над полом: привязка ниже середины.
  return { img: c, ax: c.width / 2, ay: c.height / 2 + 7 };
}

registerShotPainter('f8_serp', (s: Shot) => {
  const a = Math.atan2(s.vy, s.vx);
  const q = rotOf(a);
  const f = posMod(Math.floor(s.age * 24 + s.id), 8);
  return serpImg(q, f);
});

registerImpactPainter('f8_serp', {
  life: 0.8,
  shake: 0.06,
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const x = rec.x * S;
    const y = rec.y * S;
    const p = new Pen(g, px, py, x, y);
    const sd = rec.seed;
    const a = Math.atan2(rec.vy ?? 0, rec.vx ?? 1);
    // Лужица лунного света на полу — растекается и гаснет (светом, а не
    // краской: складывается с полом).
    const pk = k01(age / 0.15);
    const pool = poolImg(5 + 6 * eOut2(pk), 0);
    p.img(
      pool,
      x - pool.width / 2,
      y - pool.height / 2 + 1,
      0.9 * (1 - k01((age - 0.2) / 0.55)),
      'lighter',
    );
    const hy = y - 7;
    // Кадр удара: серп встал поперёк хода и вспыхнул; кольцо звона.
    if (age < 0.09) {
      const k = age / 0.09;
      const b = moonBuf(x, hy, 16);
      moonShape(b, x + Math.cos(a) * 3, hy + Math.sin(a) * 3, a, 14 - 4 * k, 4 - 2 * k, COL_HOT);
      b.flush(p, 1);
      p.col(C.white, 1 - k);
      p.dot(x - 1, hy - 1, 3, 3);
    }
    if (age < 0.24) {
      const k = age / 0.24;
      p.col(k < 0.4 ? C.white : C.lav, 0.9 * (1 - k));
      p.arc(x, hy, 3 + 11 * eOut2(k), 0, TAU, (u) => hash(Math.floor(u * 24), sd, 3) > 0.3);
    }
    // Серп раскалывается: осколки-серпики летят дальше по ходу и вбок.
    moonlets(
      p,
      sd,
      age,
      reduced() ? 2 : 5,
      (i) => [x, hy, a + (i - 2) * 0.55 + (hash(sd, i, 121) - 0.5) * 0.3],
      34,
      30,
      0.6,
      3,
      0,
      0,
      4,
    );
  }),
});

// =============================================================================
// РЕЖИССЁР — одна зона-картинка `f8v_dir` на бой: то, что демон делает с
// миром в режимах без своего удара. Читает босса и рисует по его `m.t`.
//   aim    — прицел выпада (вместо красной метки движка: `vNoTele`);
//   dash   — разрез по пути рывка, ветер;
//   volley — пять дорожек серпов, фронт по ним, вспышка залпа;
//   rings  — лунная волна от поднятого меча;
//   phase  — печать семи лун у ног, серпики кругом, волна и сброс;
//   roar   — три волны рёва; луны — лужа света, прибытие.
// =============================================================================

registerZonePainter(
  'f8v_dir',
  guarded((g, z0: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const z = z0 as Zone;
    const sim = paintSim();
    if (!sim) return;
    // Режиссёр один: прошлый бой мог оставить свою зону.
    if (sim.zones.find((q) => q.art === 'f8v_dir') !== z) return;
    const p = new Pen(g, px, py, z.x * S, z.y * S);
    for (const mm of sim.mobs) if (mm.kind === 'f8_moon') moonGlow(p, mm, S, time);
    const dead = sim.mobs.find((q) => q.kind === 'f8boss' && q.mode === 'dying');
    if (dead) deathBurst(p, dead, S);
    const m = bossOf(sim);
    if (!m) return;
    const bx = m.x * S;
    const by = m.y * S;
    const ph = m.data.phase ?? 0;
    const haste = hasteOf(ph);
    const t = m.t;
    switch (m.mode) {
      case 'aim':
        aimLine(p, m, bx, by, S, time, BOSS8.dashAim / haste);
        break;
      case 'dash':
        dashCut(p, m, bx, by, S, time);
        break;
      case 'volley':
        volleyLanes(p, m, bx, by, S, time, 0.85 / haste);
        break;
      case 'rings':
        if (t > 0.1 && t < 0.62) {
          const k = (t - 0.1) / 0.52;
          p.col(C.lav, 0.85 * (1 - k));
          p.arc(
            bx,
            by,
            10 + 110 * eOut2(k),
            0,
            TAU,
            (u) => hash(Math.floor(u * 90), m.id, 9) > 0.25,
          );
          p.col(C.gold, 0.6 * (1 - k));
          p.arc(bx, by, 6 + 100 * eOut2(k), 0, TAU, (u) => hash(Math.floor(u * 70), m.id, 8) > 0.6);
        }
        break;
      case 'phase':
        phaseSeal(p, m, bx, by, S, time, t);
        break;
      case 'roar':
        for (let i = 0; i < 3; i++) {
          const k = (t - 0.1 - i * 0.4) / 0.6;
          if (k < 0 || k > 1) continue;
          p.col(i === 1 ? C.gold : C.lav, 0.75 * (1 - k));
          p.arc(bx, by, 8 + 58 * eOut2(k), 0, TAU, (u) => hash(Math.floor(u * 60), i, 3) > 0.3);
        }
        dust(p, m.id, t, bx, by, 6, 0, Math.PI, 30, 20, 3, 6, 5, 0.9, 0, 0.45, 0.4);
        break;
    }
  }),
);

/** Прицел выпада: полоса пути, рельсы бегут к цели, остриё-серп в конце. */
function aimLine(p: Pen, m: Mob, bx: number, by: number, S: number, time: number, T: number) {
  const tl = m.tele;
  if (!tl || tl.shape !== 'line') return;
  const k = k01(tl.k);
  const left = T * (1 - k);
  const sig = left < SIG;
  const tk = !reduced() && tick(left);
  const a = tl.ang ?? m.dir;
  const L = tl.r * S;
  const w = (tl.w ?? 0.5) * S;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const nx = -uy;
  const ny = ux;
  p.col(C.vDk, 0.34);
  strip(p, bx, by, a, 4, L, w * 0.8, w);
  const lf = 4 + (L - 4) * Math.pow(k, 1.5);
  p.col(C.purple, (tk ? 0.38 : 0.24) + 0.1 * k);
  strip(p, bx, by, a, 4, lf, w * 0.8, w * (0.8 + 0.2 * (lf / L)));
  // Рельсы: пунктир бежит от демона к цели, к выпаду — быстрее.
  const run = time * (40 + 120 * k);
  // В последние 0,2 с рельсы гаснут до лиловых: белой остаётся нить иай.
  p.col(C.lilac, 0.55 + 0.4 * k);
  for (const s of [-1, 1])
    p.line(
      bx + ux * 4 + nx * w * 0.8 * s,
      by + uy * 4 + ny * w * 0.8 * s,
      bx + ux * L + nx * w * s,
      by + uy * L + ny * w * s,
      sig ? undefined : (i) => posMod(i - run, 8) < 4,
    );
  // Стрелки-шевроны по оси — куда рванёт.
  if (!sig)
    for (let j = 0; j < 4; j++) {
      const s = posMod(j * 0.25 + time * (0.6 + 1.6 * k), 1) * (L - 12) + 8;
      if (s > lf) continue;
      const cxp = bx + ux * s;
      const cyp = by + uy * s;
      p.col(C.lav, 0.7);
      p.line(cxp - ux * 3 + nx * 3, cyp - uy * 3 + ny * 3, cxp, cyp);
      p.line(cxp - ux * 3 - nx * 3, cyp - uy * 3 - ny * 3, cxp, cyp);
    }
  // Последние 0,2 с — белая нить иай по всей длине, по бокам — лиловая кайма.
  if (sig) {
    p.col(C.lav, tk ? 0.9 : 0.6);
    p.line(bx + ux * 4 + nx, by + uy * 4 + ny, bx + ux * L + nx, by + uy * L + ny);
    p.line(bx + ux * 4 - nx, by + uy * 4 - ny, bx + ux * L - nx, by + uy * L - ny);
    p.col(tk ? C.white : C.moon, 1);
    p.line(bx + ux * 4, by + uy * 4, bx + ux * L, by + uy * L);
  }
  // Остриё: серп в конце пути растёт.
  p.at(
    moonlet(1 + Math.floor(k * 3.5), rotOf(a + Math.PI), sig ? 3 : 0),
    bx + ux * L,
    by + uy * L,
    0.6 + 0.4 * k,
  );
}

/** Рывок: светлый разрез от места старта до демона, ветер вдоль пути. */
function dashCut(p: Pen, m: Mob, bx: number, by: number, S: number, time: number) {
  const x0 = (m.data.x0 ?? m.x) * S;
  const y0 = (m.data.y0 ?? m.y) * S;
  const dx = bx - x0;
  const dy = by - y0;
  const L = Math.hypot(dx, dy);
  if (L < 2) return;
  const a = Math.atan2(dy, dx);
  const ux = dx / L;
  const uy = dy / L;
  const nx = -uy;
  const ny = ux;
  // Разрез ярче у демона — там клинок сейчас.
  p.col(C.purple, 0.55);
  strip(p, x0, y0, a, 0, L, 0.4, 2.4);
  p.col(C.lav, 0.9);
  p.line(x0, y0, bx - ux * 3, by - uy * 3);
  p.col(C.white, 1);
  p.line(bx - ux * Math.min(L, 22), by - uy * Math.min(L, 22), bx - ux * 3, by - uy * 3);
  // Ветер: штрихи за демоном, по бокам.
  for (let j = 0; j < 4; j++) {
    const off = (j < 2 ? -1 : 1) * (5 + (j % 2) * 5);
    const len = 10 + 8 * hash(m.id, j, Math.floor(time * 12));
    const back = 6 + j * 3;
    p.col(C.pale, 0.55);
    p.line(
      bx - ux * back + nx * off,
      by - uy * back + ny * off,
      bx - ux * (back + len) + nx * off,
      by - uy * (back + len) + ny * off,
    );
  }
  // Серпики остаются там, где демон уже прошёл.
  const n = Math.floor(L / 12);
  for (let i = 0; i < n; i++) {
    const s = (i + 0.5) * 12;
    const side = i % 2 ? 1 : -1;
    p.at(
      moonlet(1 + (i % 2), rotOf(a + side * 1.4), 0),
      x0 + ux * s + nx * side * 3,
      y0 + uy * s + ny * side * 3,
      0.8,
    );
  }
}

/** Залп: пять дорожек серпов, по ним — фронт; вспышка в миг залпа. */
function volleyLanes(p: Pen, m: Mob, bx: number, by: number, S: number, time: number, T: number) {
  const t = m.t;
  const R = 4.5 * S;
  const due = [T, T + 0.75];
  for (let v = 0; v < 2; v++) {
    const start = v ? T : 0;
    const end = due[v];
    const turn = v ? 0.13 : 0;
    if (t < start || t > end + 0.14) continue;
    const k = k01((t - start) / (end - start));
    const left = end - t;
    const sig = left < SIG && left > 0;
    const tk = !reduced() && tick(left);
    if (t <= end)
      for (let i = 0; i < 5; i++) {
        const a = m.dir + turn + (i / 4 - 0.5) * 1.5;
        const ux = Math.cos(a);
        const uy = Math.sin(a);
        p.col(C.vDk, 0.3);
        strip(p, bx, by, a, 10, R, 1.5, 3.5);
        p.col(sig ? (tk ? C.white : C.moon) : C.lilac, 0.4 + 0.5 * k);
        p.line(
          bx + ux * 10,
          by + uy * 10,
          bx + ux * R,
          by + uy * R,
          sig ? undefined : (j) => posMod(j - time * 50, 6) < 3,
        );
        const s = 10 + (R - 10) * Math.pow(k, 1.6);
        p.at(
          moonlet(2 + Math.floor(k * 1.9), rotOf(a + Math.PI), sig ? 3 : 0),
          bx + ux * s,
          by + uy * s,
          0.7 + 0.3 * k,
        );
      }
    // Вспышка залпа: веер света у меча.
    if (t > end && t < end + 0.14) {
      const k = (t - end) / 0.14;
      const b = new Buf(bx - 30, by - 30, bx + 30, by + 30);
      band(
        b,
        bx,
        by,
        12 + 12 * eOut2(k),
        (u) => m.dir + turn - 0.9 + 1.8 * u,
        0,
        1,
        (u) => 4 * (1 - k) * Math.sin(Math.PI * u) + 0.5,
        [hx(C.white), hx(C.moon), hx(C.lav), hx(C.lilac)],
      );
      b.flush(p, 1 - k);
    }
  }
}

/** Смена фазы: печать семи лун у ног, кружащие серпики, волна и сброс. */
function phaseSeal(p: Pen, m: Mob, bx: number, by: number, S: number, time: number, t: number) {
  const PT = BOSS8.phaseT;
  const ph = m.data.phase ?? 1;
  // Волна в начале.
  if (t < 0.45) {
    const k = t / 0.45;
    p.col(C.lav, 0.9 * (1 - k));
    p.arc(bx, by, 8 + 76 * eOut2(k), 0, TAU, (u) => hash(Math.floor(u * 80), m.id, 5) > 0.25);
  }
  // Печать: двойное кольцо и семь лунных знаков; зажжены — по фазе.
  const grow = eOut2(k01(t / 0.5));
  const fade = 1 - k01((t - PT + 0.2) / 0.2);
  const R = 34 * grow;
  if (R > 2) {
    p.col(C.vDk, 0.45 * fade);
    wedge(p, bx, by, R - 4, R + 4, 0, Math.PI / 2 - 0.001);
    wedge(p, bx, by, R - 4, R + 4, Math.PI, Math.PI / 2 - 0.001);
    p.col(C.violet, 0.7 * fade);
    p.arc(bx, by, R + 4, 0, TAU);
    p.col(C.lav, 0.8 * fade);
    p.arc(bx, by, R, 0, TAU, (u) => posMod(u * 90 - time * 8, 5) < 3);
    p.arc(bx, by, R - 4, 0, TAU, (u) => posMod(u * 70 + time * 6, 7) < 2);
    for (let i = 0; i < 7; i++) {
      const an = (i / 7) * TAU - Math.PI / 2 + t * 0.5;
      const lit = i < 1 + ph * 2;
      p.at(
        moonlet(lit ? 3 : 2, rotOf(an + Math.PI), lit ? 3 : 0),
        bx + Math.cos(an) * R,
        by + Math.sin(an) * R,
        (lit ? 1 : 0.4) * fade,
      );
    }
  }
  // Серпики кружат вверх по спирали.
  for (let i = 0; i < 10; i++) {
    const q = posMod(t * 0.7 + i / 10, 1);
    const an = i * 2.4 + t * 2.2;
    const rr = 26 * (1 - 0.6 * q);
    p.at(
      moonlet(q < 0.5 ? 2 : 1, rotOf(an), 0),
      bx + Math.cos(an) * rr,
      by + Math.sin(an) * rr * 0.5 - 40 * q,
      Math.sin(Math.PI * q) * fade,
    );
  }
  // Сброс в конце: печать схлопывается к ногам и выстреливает серпиками.
  if (t > PT - 0.2) {
    const k = k01((t - PT + 0.2) / 0.2);
    p.col(C.white, 1 - k * 0.5);
    p.arc(bx, by, 34 * (1 - eIn2(k)) + 2, 0, TAU);
    p.col(C.lav, 0.8);
    p.arc(bx, by, 34 * (1 - eIn2(k)) + 5, 0, TAU, (u) => posMod(u * 40, 2) < 1);
  }
  if (t > PT - 0.05)
    moonlets(
      p,
      m.id + ph * 17,
      t - PT + 0.05,
      9,
      (i) => [bx, by - 6, (i / 9) * TAU],
      60,
      30,
      0.35,
      3,
      3,
    );
}

/**
 * Смерть демона (0,7 с, пока симуляция держит его в `dying`): пол под ним
 * трескается звездой из семи лучей, семь лун вырываются из тела и
 * разлетаются, кольцо света уходит по арене. Тело доигрывает своё (`linger`).
 */
function deathBurst(p: Pen, m: Mob, S: number) {
  const t = m.t;
  const bx = m.x * S;
  const by = m.y * S;
  const fade = 1 - k01((t - 0.35) / 0.35);
  for (let i = 0; i < 7; i++) {
    const an = (i / 7) * TAU + 0.35;
    const L = (14 + 10 * hash(m.id, i, 3)) * eOut3(k01(t / 0.12));
    gash(p, bx, by, bx + Math.cos(an) * L, by + Math.sin(an) * L * 0.8, 1, fade);
  }
  if (t < 0.3) {
    const k = t / 0.3;
    p.col(k < 0.3 ? C.white : C.lav, 0.9 * (1 - k));
    p.arc(bx, by, 6 + 60 * eOut2(k), 0, TAU, (u) => hash(Math.floor(u * 80), m.id, 4) > 0.25);
  }
  moonlets(p, m.id, t, 7, (i) => [bx, by - 8, (i / 7) * TAU + 0.35], 110, 30, 0.7, 5, 0, 0, 16);
}

/** Луна над ареной: лужица света под ней, прибытие — вспышка и кольцо. */
function moonGlow(p: Pen, mm: Mob, S: number, time: number) {
  const x = mm.x * S;
  const y = mm.y * S;
  const pool = poolImg(9 + Math.sin(time * 2 + mm.id) * 1.2, 0);
  p.img(pool, x - pool.width / 2, y - pool.height / 2 + 2, 0.5, 'lighter');
  if (mm.t < 0.9 && mm.t >= 0) {
    const k = mm.t / 0.9;
    p.col(C.pale, 0.9 * (1 - k));
    p.arc(x, y + 2, 4 + 20 * eOut2(k), 0, TAU, (u) => hash(Math.floor(u * 30), mm.id, 2) > 0.3);
    if (k < 0.35) {
      p.col(C.white, 1 - k / 0.35);
      p.dot(x, y - 40 + 40 * (k / 0.35), 1, 30);
    }
  }
}

// =============================================================================
// ДВИЖЕНИЕ — зоны мозга `f8v_*` в миг события: шаг, толчок выпада, занос.
// =============================================================================

type MoveZone = Zone & { ang?: number };

/** Шаг: пыль из-под ступни (левая-правая — по номеру зоны), лёгкая. */
registerZonePainter(
  'f8v_step',
  guarded((g, z0: Zone | Strike, px: number, py: number, S: number) => {
    const z = z0 as MoveZone;
    const sd = seedOf(z.id);
    const a = z.ang ?? 0;
    const side = sd & 1 ? 1 : -1;
    const x = z.x * S - Math.sin(a) * 4 * side;
    const y = z.y * S + Math.cos(a) * 2 * side + 1;
    const p = new Pen(g, px, py, x, y);
    dust(p, sd, z.t, x, y, 2, a + Math.PI, 0.9, 8, 8, 1, 3, 3, 0.55, 0, 0.5);
  }),
);

/** Толчок выпада: пыль назад, волна, щепа, борозды от ступней. */
registerZonePainter(
  'f8v_launch',
  guarded((g, z0: Zone | Strike, px: number, py: number, S: number) => {
    const z = z0 as MoveZone;
    const x = z.x * S;
    const y = z.y * S;
    const p = new Pen(g, px, py, x, y);
    const sd = seedOf(z.id);
    const a = z.ang ?? 0;
    const t = z.t;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const ga = 1 - k01((t - 0.4) / 0.5);
    for (const s of [-1, 1])
      gash(
        p,
        x - uy * 3 * s,
        y + ux * 3 * s,
        x - uy * 3 * s - ux * 7,
        y + ux * 3 * s - uy * 7,
        1,
        ga,
      );
    if (t < 0.22) {
      const k = t / 0.22;
      p.col(C.pale, 0.85 * (1 - k));
      p.arc(x, y, 5 + 16 * eOut2(k), a + Math.PI - 1.3, a + Math.PI + 1.3);
    }
    dust(p, sd, t, x, y, reduced() ? 2 : 4, a + Math.PI, 0.8, 26, 22, 2, 5, 5, 0.6, 0, 0.5);
    if (!reduced()) chips(p, sd, t, x, y, 4, a + Math.PI, 0.9, 30, 30, 50, 50, [0.5, 0.85]);
  }),
);

/** Занос в конце выпада: два следа-борозды, пыль вперёд, серпики. */
registerZonePainter(
  'f8v_skid',
  guarded((g, z0: Zone | Strike, px: number, py: number, S: number) => {
    const z = z0 as MoveZone;
    const x = z.x * S;
    const y = z.y * S;
    const p = new Pen(g, px, py, x, y);
    const sd = seedOf(z.id);
    const a = z.ang ?? 0;
    const t = z.t;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const ga = 1 - k01((t - 0.5) / 0.55);
    const reach = eOut2(k01(t / 0.12));
    for (const s of [-1, 1])
      gash(
        p,
        x - uy * 3 * s - ux * 18,
        y + ux * 3 * s - uy * 18,
        x - uy * 3 * s,
        y + ux * 3 * s,
        reach,
        ga,
      );
    dust(
      p,
      sd,
      t,
      x + ux * 4,
      y + uy * 4,
      reduced() ? 2 : 3,
      a,
      0.9,
      20,
      18,
      2,
      5,
      5,
      0.65,
      0,
      0.5,
    );
    moonlets(p, sd, t, 3, (i) => [x, y - 4, a + (i - 1) * 0.8], 16, 12, 0.5, 1, 0, 0, 3);
  }),
);

// ---- Прогрев: серпики, серп-снаряд, кольца, глаза пола ------------------------

// Порядок — по тому, что игрок увидит первым: серпики веера и реза (фаза 0),
// пыль шагов, потом глаза (фаза 1), серпы-снаряды (2), кольца (3).
registerMobWarm('f8boss', function* () {
  for (const pal of [0, 3, 1, 2])
    for (let sz = 0; sz < MOON_SIZES.length; sz++) {
      for (let r = 0; r < 16; r++) moonlet(sz, r, pal);
      yield 0;
    }
  for (let r = 1; r <= 6; r++) {
    for (let v = 0; v < 4; v++) puffImg(0, r, v);
    yield 0;
  }
  for (let o = 0; o <= 4; o++) {
    for (let lx = -3; lx <= 3; lx++) floorEyeImg(o, lx, 0, 0);
    yield 0;
  }
  for (let q = 0; q < 16; q++)
    for (let f = 0; f < 8; f += 2) {
      serpImg(q, f);
      serpImg(q, f + 1);
      yield 0;
    }
  for (const R of BOSS8.ringR) {
    for (let w = 5; w <= 10; w++) {
      ringImg(R * TS, w, 0);
      yield 0;
    }
    ringImg(R * TS, 10, 1);
    yield 0;
  }
});
