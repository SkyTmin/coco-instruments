// Этаж 12, босс «Двуликий король проклятий» — техники (v2.87): метки ударов,
// контакт, зоны и снаряды. Тело короля рисует `f12-art.ts`, здесь — всё, что
// король делает с МИРОМ. Договор движка — библия §14.
//
// Как устроено:
//   • метка удара (`registerZonePainter` для strike) читается «куда» с первого
//     кадра (вся фигура удара тёмным кармином с кромкой) и «когда» — натяжение
//     или налив доходит до края ровно в миг урона; последние 0,2 с — белая
//     кромка и «тик-тик»;
//   • контакт (`registerImpactPainter`) — рассечение воздуха, рубцы в камне,
//     обрывки, пыль, искры, столб пламени, огненный болт; тряска — по силе;
//   • удары без своего strike (вход, знак, волна переписи зала, поезд, шаги,
//     смена фаз) — визуальные зоны `f12v_*`, их ставит мозг через `api.vfx`;
//   • всё светящееся — поверх темноты (`above`); то, что в этом слое лежит
//     на полу, прячется за телами, стоящими ближе к камере (`Pen.occ`), —
//     как если бы слой сортировался по глубине.
//
// Пиксели — на СЕТКЕ МИРА (`Pen`): эффект не «плывёт» по полу при движении
// камеры. Частицы детерминированы — позиция считается от зерна и возраста,
// а не копится по кадрам: лист кадров и игра рисуют одно и то же, стоп-кадр
// держит позу сам.
//
// Палитра этажа: камень святилища — сиреневые плиты, храм — тёмная кровь;
// проклятие — кармин и розовое, разрез — белый, пламя — оранжевое, оберег —
// золото и бумага офуда.
import { Px } from '../dungeon-art';
import { Tile, isWallTile } from '../dungeon-world';
import {
  paintSim,
  registerImpactPainter,
  registerMobWarm,
  registerZonePainter,
} from '../dungeon-paint';
import type { ImpactRec } from '../dungeon-paint';
import type { Mob, Strike, Zone } from '../dungeon-sim';
import { F12_MARK } from './f12';
import { F12_FX, KING } from './f12-brains';
import type { GridView } from './f12-brains';
import { SHRINE_H, SHRINE_W, shrinePx } from './f12-art';

type RGBA = [number, number, number, number];

const TAU = Math.PI * 2;
const hx = (h: string, a = 255): RGBA => {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255, a];
};
/** Детерминированный шум по трём числам, 0…1 (та же формула, что в f12-art). */
const hash = (a: number, b: number, c = 0) => {
  let h = (a * 374761393 + b * 668265263 + c * 1274126177) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const k01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const eOut2 = (t: number) => 1 - (1 - t) * (1 - t);
const eOut3 = (t: number) => 1 - (1 - t) * (1 - t) * (1 - t);
const eIn2 = (t: number) => t * t;
const eInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t));
/** Остаток всегда положительный: у зон `api.vfx` номера отрицательные. */
const mod = (x: number, n: number) => ((x % n) + n) % n;

/** Последние 0,2 с перед уроном — ясный сигнал «сейчас». */
const SIG = 0.2;
/** «Тик-тик»: две вспышки в последние 0,2 с (0,20…0,15 и 0,10…0,05). */
const tick = (left: number) => left < SIG && Math.floor(left / 0.05) % 2 === 1;

// ---- Палитра ---------------------------------------------------------------

const C = {
  ink: '#150f0b',
  groove: '#07030a',
  crDk: '#2a0412',
  crMd: '#5e0a22',
  cr: '#a8142e',
  crHi: '#e8203f',
  hot: '#ff3a5c',
  rose: '#ff8aa4',
  pink: '#ffc8d6',
  white: '#fff7f4',
  lipStone: '#8c7c9c',
  lipBlood: '#8e3644',
  fire: ['#4a0804', '#a8300c', '#e05010', '#ffa030', '#fff0a0'],
  gold: ['#4e3408', '#8a6a1a', '#c09a30', '#f0d060', '#fff4c8'],
  paper: ['#8a8068', '#b3aa8c', '#d2c9aa', '#ece4c6'],
  seal: '#c01a2a',
  smoke: '#1a1218',
};

/** Искра огня по доле жизни: белая → жёлтая → оранжевая → красная. */
const sparkCol = (k: number) =>
  k < 0.18
    ? '#ffffff'
    : k < 0.42
      ? C.fire[4]
      : k < 0.7
        ? C.fire[3]
        : k < 0.88
          ? C.fire[2]
          : C.fire[1];
/** Искра проклятия: белая → розовая → кармин. */
const curseCol = (k: number) => (k < 0.2 ? C.white : k < 0.45 ? C.pink : k < 0.75 ? C.hot : C.cr);
/** Остывающий жар по доле 0 (белый) … 1 (тёмный). */
const heatCol = (k: number) =>
  k < 0.1
    ? C.white
    : k < 0.25
      ? C.fire[4]
      : k < 0.45
        ? C.fire[3]
        : k < 0.65
          ? C.fire[2]
          : k < 0.85
            ? C.fire[1]
            : C.fire[0];
/** Остывающий рубец проклятия: белый → розовый → кармин → тёмный жёлоб. */
const cutHeat = (k: number) =>
  k < 0.1
    ? C.white
    : k < 0.25
      ? C.pink
      : k < 0.45
        ? C.hot
        : k < 0.7
          ? C.cr
          : k < 0.9
            ? C.crMd
            : C.groove;

/**
 * Пол под ударом: храм развёрнут или помост (красный кирпич) — «кровь»,
 * иначе — сиреневый камень святилища. (x, y) — клетка мира, если известна.
 */
function bloodFloor(x?: number, y?: number): boolean {
  if (F12_FX.domain > 0.5) return true;
  const sim = paintSim();
  if (x === undefined || y === undefined || !sim?.world?.mark) return false;
  const w = sim.world;
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  if (cx < 0 || cy < 0 || cx >= w.w || cy >= w.h) return false;
  return w.mark[cy * w.w + cx] === F12_MARK.dais;
}

let rmq: MediaQueryList | null | undefined;
/** Пользователь просил меньше движения: меньше частиц, без мигания. */
const reduced = () => {
  if (rmq === undefined)
    rmq =
      typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
  return !!rmq?.matches;
};

// ---- Кто заслоняет: тела ближе к камере ------------------------------------

/**
 * Слой поверх темноты рисуется после всех мобов. То, что в нём лежит на полу
 * (метка разреза, рубец, круг оберега), легло бы героям на грудь. Тело —
 * прямоугольник над точкой ног: пиксель с глубиной `depth` (y его опоры,
 * пиксели мира) прячется за телом, чьи ноги ближе к камере.
 */
interface Body {
  x: number;
  foot: number;
  hw: number;
  top: number;
}
let bodyKey = '';
let bodyList: Body[] = [];
function bodies(S: number): Body[] {
  const sim = paintSim();
  if (!sim) return [];
  const h = sim.hero;
  const key = `${sim.time}|${h.x}|${h.y}|${sim.mobs.length}|${S}`;
  if (key === bodyKey) return bodyList;
  const out: Body[] = [];
  for (const m of sim.mobs) {
    if (m.mode === 'dying' && m.t > 0.45) continue;
    let hw: number;
    let ht: number;
    if (m.kind === 'f12boss') {
      hw = 12;
      ht = m.mode === 'f12_domain' || m.mode === 'f12_intro' ? 44 : 60;
    } else if (m.kind === 'f12_train') {
      hw = 40;
      ht = 44;
    } else if (m.kind === 'f12_pillar') {
      hw = 6;
      ht = m.data.bowl ? 18 : 26;
    } else {
      hw = Math.max(4, m.r * S * 0.9);
      ht = Math.max(10, m.r * S * 3);
    }
    const foot = m.y * S + 2;
    out.push({ x: m.x * S, foot, hw, top: foot - ht });
  }
  const hf = h.y * S + 2;
  out.push({ x: h.x * S, foot: hf, hw: 6, top: hf - 19 });
  // Храм на помосте — стена: нить сетки на полу позади него прячется.
  if (F12_FX.domain > 0)
    for (const z of sim.zones)
      if (z.art === 'f12_shrine') {
        const foot = z.y * S;
        out.push({
          x: z.x * S,
          foot,
          hw: SHRINE_W / 2 - 8,
          top: foot - SHRINE_H * eOut2(F12_FX.domain),
        });
      }
  bodyKey = key;
  bodyList = out;
  return out;
}

// ---- Перо: пиксели на сетке мира -------------------------------------------

/**
 * Рисует в игровых пикселях, привязанных к сетке МИРА: `(px, py)` — где на
 * экране точка мира `(wx, wy)` (в пикселях мира). Сдвиг камеры дробный, но
 * кратен точке экрана; поправка `qx/qy` одна на весь кадр, поэтому эффект
 * стоит на полу, а не дрожит по нему. Рисует только видимое (`x0…y1`): линии
 * через весь зал не стоят ничего за краем экрана.
 */
class Pen {
  readonly g: CanvasRenderingContext2D;
  readonly qx: number;
  readonly qy: number;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly occ: Body[];
  constructor(
    g: CanvasRenderingContext2D,
    px: number,
    py: number,
    wx: number,
    wy: number,
    above = false,
    S = 16,
  ) {
    this.g = g;
    const t = g.getTransform();
    const sc = t.a || 1;
    this.qx = Math.round((px - wx) * sc) / sc;
    this.qy = Math.round((py - wy) * sc) / sc;
    const ex = t.e / sc;
    const ey = t.f / sc;
    this.x0 = Math.floor(-ex - this.qx) - 2;
    this.y0 = Math.floor(-ey - this.qy) - 2;
    this.x1 = Math.ceil(g.canvas.width / sc - ex - this.qx) + 2;
    this.y1 = Math.ceil(g.canvas.height / sc - ey - this.qy) + 2;
    this.occ = above ? bodies(S) : [];
  }
  col(c: string, a = 1): void {
    this.g.fillStyle = c;
    this.g.globalAlpha = a < 0 ? 0 : a > 1 ? 1 : a;
  }
  alpha(a: number): void {
    this.g.globalAlpha = a < 0 ? 0 : a > 1 ? 1 : a;
  }
  /** Видна ли рамка [x0, x1] × [y0, y1] хоть краем. */
  sees(x0: number, y0: number, x1: number, y1: number): boolean {
    return x1 >= this.x0 && x0 <= this.x1 && y1 >= this.y0 && y0 <= this.y1;
  }
  hidden(x: number, y: number, depth: number): boolean {
    for (const b of this.occ)
      if (depth < b.foot - 1 && y >= b.top && y <= b.foot && Math.abs(x + 0.5 - b.x) < b.hw)
        return true;
    return false;
  }
  /** Пиксель (x, y) мира; `depth` — y опоры (по умолчанию сам y: лежит на полу). */
  dot(x: number, y: number, depth?: number, w = 1, h = 1): void {
    const X = Math.floor(x);
    const Y = Math.floor(y);
    if (X + w < this.x0 || X > this.x1 || Y + h < this.y0 || Y > this.y1) return;
    if (this.occ.length && this.hidden(X, Y, depth ?? Y)) return;
    this.g.fillRect(X + this.qx, Y + this.qy, w, h);
  }
  /** Прямоугольник в целых пикселях мира, без заслонения. */
  rect(x: number, y: number, w: number, h: number): void {
    this.g.fillRect(x + this.qx, y + this.qy, w, h);
  }
  /** Строка пикселей [xa, xb] ряда Y (целые, включительно). */
  run(xa: number, xb: number, Y: number, depth?: number): void {
    if (Y < this.y0 || Y > this.y1) return;
    if (xa < this.x0) xa = this.x0;
    if (xb > this.x1) xb = this.x1;
    if (xb < xa) return;
    if (this.occ.length) {
      const d = depth ?? Y;
      let cut: [number, number][] | null = null;
      for (const b of this.occ) {
        if (d >= b.foot - 1 || Y < b.top || Y > b.foot) continue;
        const ca = Math.ceil(b.x - b.hw - 0.5);
        const cb = Math.floor(b.x + b.hw - 0.5);
        if (cb < xa || ca > xb) continue;
        (cut ??= []).push([ca, cb]);
      }
      if (cut) {
        cut.sort((p, q) => p[0] - q[0]);
        let x = xa;
        for (const [ca, cb] of cut) {
          if (ca > x) this.g.fillRect(x + this.qx, Y + this.qy, Math.min(xb, ca - 1) - x + 1, 1);
          x = Math.max(x, cb + 1);
          if (x > xb) return;
        }
        if (x <= xb) this.g.fillRect(x + this.qx, Y + this.qy, xb - x + 1, 1);
        return;
      }
    }
    this.g.fillRect(xa + this.qx, Y + this.qy, xb - xa + 1, 1);
  }
  /** Столбик пикселей [ya, yb] в колонке X. */
  vrun(X: number, ya: number, yb: number, depth?: number): void {
    if (X < this.x0 || X > this.x1) return;
    if (ya < this.y0) ya = this.y0;
    if (yb > this.y1) yb = this.y1;
    if (yb < ya) return;
    if (this.occ.length) {
      for (let y = ya; y <= yb; y++) if (!this.hidden(X, y, depth ?? y)) this.rect(X, y, 1, 1);
      return;
    }
    this.g.fillRect(X + this.qx, ya + this.qy, 1, yb - ya + 1);
  }
  /**
   * Линия по пикселям (Брезенхэм), концы — точки мира; соседние пиксели ряда
   * (или колонки) идут одним прямоугольником. Отрезок сперва режется по
   * экрану: линия через весь зал перебирает только видимые пиксели.
   */
  line(x0: number, y0: number, x1: number, y1: number, depth?: number): void {
    const c = this.clip(x0, y0, x1, y1);
    if (!c) return;
    let x = Math.floor(c[0]);
    let y = Math.floor(c[1]);
    const xe = Math.floor(c[2]);
    const ye = Math.floor(c[3]);
    const dx = Math.abs(xe - x);
    const dy = -Math.abs(ye - y);
    const sx = x < xe ? 1 : -1;
    const sy = y < ye ? 1 : -1;
    const xmaj = dx >= -dy;
    let err = dx + dy;
    let rx = x;
    let ry = y;
    const flush = (ex: number, ey: number) => {
      if (xmaj) this.run(Math.min(rx, ex), Math.max(rx, ex), ry, depth);
      else this.vrun(rx, Math.min(ry, ey), Math.max(ry, ey), depth);
    };
    for (let n = 0; n < 4000; n++) {
      if (x === xe && y === ye) break;
      const e2 = 2 * err;
      let nx = x;
      let ny = y;
      if (e2 >= dy) {
        err += dy;
        nx += sx;
      }
      if (e2 <= dx) {
        err += dx;
        ny += sy;
      }
      if (xmaj ? ny !== y : nx !== x) {
        flush(x, y);
        rx = nx;
        ry = ny;
      }
      x = nx;
      y = ny;
    }
    flush(x, y);
  }
  /** Отрезок по рамке экрана (Лянг — Барски); null — не виден. */
  clip(x0: number, y0: number, x1: number, y1: number): [number, number, number, number] | null {
    let t0 = 0;
    let t1 = 1;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const edges: [number, number][] = [
      [-dx, x0 - this.x0],
      [dx, this.x1 - x0],
      [-dy, y0 - this.y0],
      [dy, this.y1 - y0],
    ];
    for (const [p, q] of edges) {
      if (p === 0) {
        if (q < 0) return null;
        continue;
      }
      const r = q / p;
      if (p < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
    return [x0 + dx * t0, y0 + dy * t0, x0 + dx * t1, y0 + dy * t1];
  }
  /** Картинка: левый верхний угол (x, y) мира; заслонённое — построчно. */
  img(c: HTMLCanvasElement, x: number, y: number, depth?: number): void {
    const X = Math.floor(x);
    const Y = Math.floor(y);
    const w = c.width;
    const h = c.height;
    if (X + w < this.x0 || X > this.x1 || Y + h < this.y0 || Y > this.y1) return;
    const d = depth ?? Y + h - 1;
    let clear = true;
    for (const b of this.occ)
      if (d < b.foot - 1 && Y + h > b.top && Y <= b.foot && X + w > b.x - b.hw && X < b.x + b.hw) {
        clear = false;
        break;
      }
    if (clear) {
      this.g.drawImage(c, X + this.qx, Y + this.qy);
      return;
    }
    for (let yy = 0; yy < h; yy++) {
      let run = -1;
      for (let xx = 0; xx <= w; xx++) {
        const vis = xx < w && !this.hidden(X + xx, Y + yy, d);
        if (vis && run < 0) run = xx;
        if (!vis && run >= 0) {
          this.g.drawImage(
            c,
            run,
            yy,
            xx - run,
            1,
            X + run + this.qx,
            Y + yy + this.qy,
            xx - run,
            1,
          );
          run = -1;
        }
      }
    }
  }
}

// ---- Заливки строками пикселей --------------------------------------------

/** Многоугольник (точки — пары x, y мира) строками пикселей. */
function fillPoly(p: Pen, pts: number[], depth?: number): void {
  const n = pts.length / 2;
  let ymin = 1e9;
  let ymax = -1e9;
  for (let i = 0; i < n; i++) {
    ymin = Math.min(ymin, pts[i * 2 + 1]);
    ymax = Math.max(ymax, pts[i * 2 + 1]);
  }
  const Y0 = Math.max(Math.floor(ymin), p.y0);
  const Y1 = Math.min(Math.ceil(ymax), p.y1);
  for (let Y = Y0; Y <= Y1; Y++) {
    const yy = Y + 0.5;
    let lo = 1e9;
    let up = -1e9;
    for (let i = 0; i < n; i++) {
      const xa = pts[i * 2];
      const ya = pts[i * 2 + 1];
      const xb = pts[((i + 1) % n) * 2];
      const yb = pts[((i + 1) % n) * 2 + 1];
      if ((ya <= yy && yb > yy) || (yb <= yy && ya > yy)) {
        const x = xa + ((yy - ya) / (yb - ya)) * (xb - xa);
        lo = Math.min(lo, x);
        up = Math.max(up, x);
      }
    }
    if (up < lo) continue;
    const xa = Math.ceil(lo - 0.5);
    const xb = Math.floor(up - 0.5);
    if (xb >= xa) p.run(xa, xb, Y, depth);
  }
}

/** Полоса вдоль (ux, uy) от l0 до l1, полуширина hw. */
function fillLane(
  p: Pen,
  cx: number,
  cy: number,
  ux: number,
  uy: number,
  l0: number,
  l1: number,
  hw: number,
): void {
  if (l1 <= l0 || hw <= 0) return;
  const nx = -uy;
  const ny = ux;
  fillPoly(p, [
    cx + ux * l0 + nx * hw,
    cy + uy * l0 + ny * hw,
    cx + ux * l1 + nx * hw,
    cy + uy * l1 + ny * hw,
    cx + ux * l1 - nx * hw,
    cy + uy * l1 - ny * hw,
    cx + ux * l0 - nx * hw,
    cy + uy * l0 - ny * hw,
  ]);
}

/** Угол a в секторе [a0, a0 + span] (span > 0) с переходом через 2π. */
const inArc = (a: number, a0: number, span: number) => mod(a - a0, TAU) <= span;

/**
 * Кольцевой сектор [r0, r1] × [a0, a1] строками пикселей. Угол больше
 * четверти круга режется на куски с общими границами: пиксель на стыке
 * достаётся ровно одному куску — полупрозрачная заливка без шва.
 */
function fillSector(
  p: Pen,
  cx: number,
  cy: number,
  r0: number,
  r1: number,
  a0: number,
  a1: number,
): void {
  if (r1 <= 0.5 || a1 <= a0) return;
  const full = a1 - a0 >= TAU - 1e-6;
  const n = full ? 1 : Math.max(1, Math.ceil((a1 - a0) / (Math.PI / 2)));
  const bx: number[] = [];
  const by: number[] = [];
  for (let j = 0; j <= n; j++) {
    const a = a0 + ((a1 - a0) * j) / n;
    bx.push(Math.cos(a));
    by.push(Math.sin(a));
  }
  const y0 = Math.max(Math.floor(cy - r1) - 1, p.y0);
  const y1 = Math.min(Math.ceil(cy + r1) + 1, p.y1);
  for (let Y = y0; Y <= y1; Y++) {
    const yy = Y + 0.5 - cy;
    if (Math.abs(yy) >= r1) continue;
    const ho = Math.sqrt(r1 * r1 - yy * yy);
    const hi = Math.abs(yy) < r0 ? Math.sqrt(r0 * r0 - yy * yy) : 0;
    const segs: [number, number][] =
      hi > 0
        ? [
            [-ho, -hi],
            [hi, ho],
          ]
        : [[-ho, ho]];
    for (let j = 0; j < n; j++) {
      for (const [s0, s1] of segs) {
        let lo = s0;
        let up = s1;
        if (!full) {
          const a = -by[j];
          const b = bx[j] * yy;
          if (a > 1e-9) lo = Math.max(lo, -b / a);
          else if (a < -1e-9) up = Math.min(up, -b / a);
          else if (b < 0) continue;
          const a2 = by[j + 1];
          const b2 = -bx[j + 1] * yy;
          if (a2 > 1e-9) lo = Math.max(lo, -b2 / a2);
          else if (a2 < -1e-9) up = Math.min(up, -b2 / a2);
          else if (b2 <= 0) continue;
        }
        const xa = Math.ceil(cx + lo - 0.5);
        const xb = Math.floor(cx + up - 0.5);
        if (xb >= xa) p.run(xa, xb, Y);
      }
    }
  }
}

/** Овал (rx, ry) строками пикселей; `depth` — глубина опоры. */
function fillOval(p: Pen, cx: number, cy: number, rx: number, ry: number, depth?: number): void {
  if (rx < 0.5 || ry < 0.5) return;
  const y0 = Math.floor(cy - ry);
  const y1 = Math.ceil(cy + ry);
  for (let Y = y0; Y <= y1; Y++) {
    const v = (Y + 0.5 - cy) / ry;
    if (v * v >= 1) continue;
    const hw = rx * Math.sqrt(1 - v * v);
    const xa = Math.ceil(cx - hw - 0.5);
    const xb = Math.floor(cx + hw - 0.5);
    if (xb >= xa) p.run(xa, xb, Y, depth);
  }
}

// ---- Окружности по пикселям (средняя точка), кеш по радиусу -----------------

interface CircPts {
  x: Int16Array;
  y: Int16Array;
  a: Float32Array;
}
const circles = new Map<number, CircPts>();
function circle(r: number): CircPts {
  const R = Math.max(1, Math.round(r));
  let c = circles.get(R);
  if (c) return c;
  const pts: [number, number][] = [];
  const seen = new Set<number>();
  const add = (x: number, y: number) => {
    const key = (x + 2048) * 4096 + (y + 2048);
    if (seen.has(key)) return;
    seen.add(key);
    pts.push([x, y]);
  };
  let x = R;
  let y = 0;
  let err = 1 - R;
  while (x >= y) {
    add(x, y);
    add(y, x);
    add(-y, x);
    add(-x, y);
    add(-x, -y);
    add(-y, -x);
    add(y, -x);
    add(x, -y);
    y++;
    if (err < 0) err += 2 * y + 1;
    else {
      x--;
      err += 2 * (y - x) + 1;
    }
  }
  const withA = pts.map(([x0, y0]) => [x0, y0, Math.atan2(y0, x0)]);
  withA.sort((p, q) => p[2] - q[2]);
  c = {
    x: Int16Array.from(withA.map((q) => q[0])),
    y: Int16Array.from(withA.map((q) => q[1])),
    a: Float32Array.from(withA.map((q) => q[2])),
  };
  if (circles.size > 200) circles.delete(circles.keys().next().value as number);
  circles.set(R, c);
  return c;
}

/**
 * Кольцо по пикселям цветом, что стоит в пере. `keep(a, i)` — оставить ли
 * пиксель (пунктир, дуга, «рваная» пыль). `sy` — сплющить по высоте (круг
 * на полу в три четверти не сплющиваем: пол виден сверху).
 */
function ring(
  p: Pen,
  cx: number,
  cy: number,
  r: number,
  keep?: (a: number, i: number) => boolean,
  depth?: number,
  dr = 0,
): void {
  if (r < 0.5) return;
  const R = Math.round(r) + Math.ceil(Math.abs(dr));
  const ox = Math.floor(cx);
  const oy = Math.floor(cy);
  if (!p.sees(ox - R - 1, oy - R - 1, ox + R + 1, oy + R + 1)) return;
  const pts = circle(r);
  const n = pts.x.length;
  for (let i = 0; i < n; i++) {
    if (keep && !keep(pts.a[i], i)) continue;
    // Соседнее кольцо — те же точки, сдвинутые по радиусу: большой круг
    // не пересчитывается на каждое кольцо полосы.
    const x = dr ? pts.x[i] + Math.round(Math.cos(pts.a[i]) * dr) : pts.x[i];
    const y = dr ? pts.y[i] + Math.round(Math.sin(pts.a[i]) * dr) : pts.y[i];
    p.dot(ox + x, oy + y, depth);
  }
}

/**
 * Видимые пиксели большой окружности (волна переписи — до 30 клеток):
 * строками и столбцами экрана, без построения всей окружности. Кладёт в
 * `out` тройки x, y (пиксели мира), угол.
 */
function arcView(p: Pen, cx: number, cy: number, r: number, out: number[]): number[] {
  out.length = 0;
  const R = Math.round(r);
  if (R < 1) return out;
  const ox = Math.floor(cx);
  const oy = Math.floor(cy);
  if (!p.sees(ox - R - 1, oy - R - 1, ox + R + 1, oy + R + 1)) return out;
  const seen = new Set<number>();
  const put = (x: number, y: number) => {
    const k = (x - ox + 4096) * 8192 + (y - oy + 4096);
    if (seen.has(k)) return;
    seen.add(k);
    out.push(x, y, Math.atan2(y - oy, x - ox));
  };
  const y0 = Math.max(p.y0, oy - R);
  const y1 = Math.min(p.y1, oy + R);
  for (let Y = y0; Y <= y1; Y++) {
    const d = Math.sqrt(Math.max(0, R * R - (Y - oy) * (Y - oy)));
    for (const X of [ox + Math.round(d), ox - Math.round(d)]) if (X >= p.x0 && X <= p.x1) put(X, Y);
  }
  const x0 = Math.max(p.x0, ox - R);
  const x1 = Math.min(p.x1, ox + R);
  for (let X = x0; X <= x1; X++) {
    const d = Math.sqrt(Math.max(0, R * R - (X - ox) * (X - ox)));
    for (const Y of [oy + Math.round(d), oy - Math.round(d)]) if (Y >= p.y0 && Y <= p.y1) put(X, Y);
  }
  return out;
}

/** Нарисовать видимую дугу (`arcView`) со сдвигом по радиусу `dr` и отбором `keep`. */
function arcDraw(
  p: Pen,
  pts: number[],
  dr: number,
  keep?: (a: number, i: number) => boolean,
): void {
  for (let i = 0; i < pts.length; i += 3) {
    const a = pts[i + 2];
    if (keep && !keep(a, i / 3)) continue;
    p.dot(
      pts[i] + (dr ? Math.round(Math.cos(a) * dr) : 0),
      pts[i + 1] + (dr ? Math.round(Math.sin(a) * dr) : 0),
    );
  }
}

/** Звезда удара: n лучей радиуса r (у основания — 0,35 r). */
function star(
  p: Pen,
  cx: number,
  cy: number,
  r: number,
  n: number,
  rot: number,
  depth?: number,
): void {
  const R = Math.ceil(r) + 1;
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  for (let y = -R; y <= R; y++) {
    let run = -1;
    for (let x = -R; x <= R + 1; x++) {
      let on = false;
      if (x <= R) {
        const dx = x0 + x + 0.5 - cx;
        const dy = y0 + y + 0.5 - cy;
        const d = Math.hypot(dx, dy);
        if (d <= r) {
          const th = Math.atan2(dy, dx) - rot;
          const spike = Math.pow(Math.abs(Math.cos((th * n) / 2)), 3);
          on = d <= r * (0.35 + 0.65 * spike);
        }
      }
      if (on && run < 0) run = x;
      if (!on && run >= 0) {
        p.run(x0 + run, x0 + x - 1, y0 + y, depth);
        run = -1;
      }
    }
  }
}

/** Четыре уголка прицела остриём внутрь: на радиусе r, поворот rot. */
function corners(p: Pen, cx: number, cy: number, r: number, rot: number, len = 3): void {
  for (let i = 0; i < 4; i++) {
    const t = rot + (i * Math.PI) / 2 + Math.PI / 4;
    const ux = Math.cos(t);
    const uy = Math.sin(t);
    const tx = cx + ux * r;
    const ty = cy + uy * r;
    for (const s of [-1, 1]) {
      const bx = tx + (ux * 0.7 - uy * 0.7 * s) * len;
      const by = ty + (uy * 0.7 + ux * 0.7 * s) * len;
      p.line(tx, ty, bx, by);
    }
  }
}

// ---- Спрайты-заготовки -------------------------------------------------------

const sprites = new Map<number, HTMLCanvasElement>();
const sprite = (key: number, make: () => Px): HTMLCanvasElement => {
  let c = sprites.get(key);
  if (!c) {
    c = make().canvas();
    if (sprites.size > 900) sprites.delete(sprites.keys().next().value as number);
    sprites.set(key, c);
  }
  return c;
};

/** Пыль и дым: тень снизу, основа, свет сверху-слева. */
const PUFF_PAL: [RGBA, RGBA, RGBA][] = [
  [hx('#2e2438'), hx('#4e4060'), hx('#7e6e92')], // 0 — каменная пыль святилища
  [hx('#0a070c'), hx('#1a1420'), hx('#2e2634')], // 1 — копоть и дым
  [hx('#2a0614'), hx('#5a0e24'), hx('#8e2240')], // 2 — пар проклятия
  [hx('#8a2a0a'), hx('#e06a1a'), hx('#ffd070')], // 3 — огненный клуб
  [hx('#24060c'), hx('#4a1018'), hx('#6e2028')], // 4 — пыль кровавого пола храма
  [hx('#5e5868'), hx('#a8a0b4'), hx('#e6e0ee')], // 5 — светлая пыль (зал возвращается)
];

/**
 * Клуб радиуса r (1…16), вариант v (0…3): три доли, чтобы край был рваным,
 * а не циркульным. Свет сверху-слева, тень — у нижней кромки.
 */
function puffImg(pal: number, r: number, v: number): HTMLCanvasElement {
  const R = Math.max(1, Math.min(16, Math.round(r)));
  return sprite(10000 + pal * 1000 + R * 8 + (v & 3), () => {
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
        const l = ((x + 0.5 - c) * -0.55 + (y + 0.5 - c) * -0.83) / Math.max(1, R);
        const low = !inside(x, y + 2) && l < 0.1;
        p.set(x, y, low && R > 2 ? sh : l > 0.3 ? hi : mid);
      }
    return p;
  });
}

const CHUNK_PAL: RGBA[][] = [
  [hx('#0e0a12'), hx('#2e2438'), hx('#4c3e5c'), hx('#76668a')], // 0 — плита святилища
  [hx('#10030a'), hx('#3a0a14'), hx('#5e1420'), hx('#8a2a36')], // 1 — кровавый пол храма
  [hx('#3a0804'), hx('#a8300c'), hx('#ffa030'), hx('#fff0a0')], // 2 — раскалённый
  [hx('#14060a'), hx('#4e1016'), hx('#781a1e'), hx('#c04a36')], // 3 — лак храма
  [hx('#3a3646'), hx('#6a6478'), hx('#a49eb2'), hx('#e2dcea')], // 4 — фарфор чаши
];

/** Обломок размера 1…4, поворот f (0…3): скол с объёмом. */
function chunkImg(sz: number, f: number, pal: number): HTMLCanvasElement {
  return sprite(20000 + pal * 100 + sz * 10 + (f & 3), () => {
    const s = sz * 2 + 3;
    const p = new Px(s, s);
    const c = s / 2;
    const rx = 0.55 + 0.62 * sz;
    const ry = 0.42 + 0.42 * sz;
    const a = (f & 3) * (Math.PI / 4);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const t = CHUNK_PAL[pal];
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        const dx = x + 0.5 - c;
        const dy = y + 0.5 - c;
        const u = (dx * ca + dy * sa) / rx;
        const w = (-dx * sa + dy * ca) / ry;
        if (u * u + w * w > 1 || u + w * 0.6 > 0.8) continue;
        const l = -dx * 0.6 - dy * 0.8;
        p.set(x, y, l > 0.6 ? t[3] : l > -0.2 ? t[2] : l > -0.9 ? t[1] : t[0]);
      }
    p.outline(pal === 2 ? hx('#2a0604') : hx(C.ink));
    return p;
  });
}

const FLAME_PAL: string[][] = [
  ['#5a0a04', '#a8300c', '#e05010', '#ffa030', '#fff0a0'], // 0 — огонь
  ['#2a0412', '#7a0e26', '#d01a3c', '#ff6a8a', '#ffe0ea'], // 1 — проклятое пламя
  ['#24082e', '#5a1c7a', '#a040d0', '#e090ff', '#fff0ff'], // 2 — пламя чаши
];

/** Язык пламени высоты h (3…24), кадр f (0…3), палитра pal; основание — низ по центру. */
function flameImg(h: number, f: number, pal = 0): HTMLCanvasElement {
  const H = Math.max(3, Math.min(24, Math.round(h)));
  return sprite(30000 + pal * 1000 + H * 8 + (f & 3), () => {
    const w = Math.max(3, Math.round(H * 0.5)) | 1;
    const p = new Px(w + 2, H + 1);
    const cx = (w + 2) / 2;
    const fire = FLAME_PAL[pal].map((c) => hx(c));
    for (let y = 0; y < H; y++) {
      const t = 1 - y / Math.max(1, H - 1);
      const half = (w / 2) * Math.pow(Math.sin(Math.PI * Math.min(1, 0.12 + t * 0.95) * 0.5), 0.9);
      const sway = Math.round(Math.sin((f & 3) * 1.57 + t * 2.6) * (1 - t) * 1.3);
      for (let x = 0; x < w + 2; x++) {
        const d = Math.abs(x + 0.5 - cx - sway);
        if (d > half + 0.25) continue;
        const inner = half - d;
        const col =
          y === H - 1
            ? fire[1]
            : t > 0.45 && inner > 1.4
              ? fire[4]
              : inner > 0.7
                ? fire[3]
                : t < 0.3
                  ? fire[1]
                  : fire[2];
        p.set(x, H - 1 - y, col);
      }
    }
    // Язык рвётся сверху: отдельная искорка над кончиком.
    if (H > 6 && f & 1) p.set(Math.round(cx), 0, fire[3]);
    return p;
  });
}

/** Обрывок: бумага офуда, ткань, пепел; поворот f (0…3) — плашмя, ребром, наискось. */
function shredImg(v: number, f: number): HTMLCanvasElement {
  return sprite(40000 + (v & 7) * 8 + (f & 3), () => {
    const kind = v & 3;
    const base =
      kind === 0
        ? [hx(C.paper[1]), hx(C.paper[3])]
        : kind === 1
          ? [hx('#c8c0b4'), hx('#fff8f0')]
          : kind === 2
            ? [hx('#2a0a12'), hx('#7a1a2a')]
            : [hx(C.paper[2]), hx(C.paper[3])];
    const shapes: string[][] = [
      ['ab', 'bb', '..'],
      ['.a.', 'bba', '...'],
      ['b.', 'a.', 'b.'],
      ['a..', '.bb', '...'],
    ];
    const rows = shapes[f & 3];
    const p = new Px(3, 3);
    p.map(rows, { a: base[0], b: base[1] });
    // Красная печать на бумаге офуда.
    if (v & 4 && kind !== 2 && (f & 3) === 0) p.set(0, 0, hx(C.seal));
    return p;
  });
}

/** Выжженное или прорезанное пятно радиуса r: тёмное, край — через пиксель. */
function scorchImg(r: number, tone: number): HTMLCanvasElement {
  const R = Math.max(2, Math.min(24, Math.round(r)));
  return sprite(60000 + R * 4 + tone, () => {
    const s = R * 2 + 1;
    const p = new Px(s, s);
    const c = [hx('#08040a'), hx('#16060a'), hx('#1e0c04')][tone];
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        const dx = (x + 0.5 - s / 2) / R;
        const dy = (y + 0.5 - s / 2) / (R * 0.8);
        const d = dx * dx + dy * dy;
        if (d > 1) continue;
        const rag = hash(x, y, 91) * 0.35;
        if (d > 0.55 - rag && (x + y) & 1) continue;
        if (d > 0.85 - rag * 0.5) continue;
        p.set(x, y, c);
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
/**
 * Полёт обломка: подброс `vz`, тяжесть `G`, отскоки с потерей энергии и
 * трением — всё по формуле, от возраста. `h` — путь по земле в секундах
 * начальной скорости (умножить на скорость — пиксели).
 */
function fly(t: number, vz: number, G: number, e = 0.34): Fly {
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
    if (v < 10) break;
  }
  const slide = Math.min(tt, 0.12);
  return { h: h + sp * (slide - (slide * slide) / 0.24), z: 0, air: false };
}

/** Путь с сопротивлением: скорость v гаснет с темпом k. */
const drag = (v: number, k: number, t: number) => (v / k) * (1 - Math.exp(-k * t));

type From = (i: number) => [number, number, number?];

/**
 * Обломки веером: `n` штук из (x, y) в сторону `ang` ± `spread`, скорость
 * `v0…v0+dv`, подброс `vz0…vz0+dvz`. Тень под летящим, лёгший гаснет к
 * `fade`. `delay(i)` — когда вылетает i-й, `at(i)` — откуда (и куда).
 */
function chunks(
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
  big = 0.3,
  pal = 0,
  delay?: (i: number) => number,
  at?: From,
): void {
  const a = 1 - k01((age - fade[0]) / (fade[1] - fade[0]));
  if (a <= 0) return;
  for (let i = 0; i < n; i++) {
    const t = age - (delay ? delay(i) : 0);
    if (t < 0) continue;
    const r1 = hash(seed, i, 11);
    const r2 = hash(seed, i, 12);
    const r3 = hash(seed, i, 13);
    const r4 = hash(seed, i, 14);
    const src = at ? at(i) : null;
    const th = (src && src[2] !== undefined ? src[2] : ang) + (r1 - 0.5) * 2 * spread;
    const v = v0 + dv * r2;
    const f = fly(t, vz0 + dvz * r3, 430);
    const ox = src ? src[0] : x;
    const oy = src ? src[1] : y;
    const gx = ox + Math.cos(th) * v * f.h;
    const gy = oy + Math.sin(th) * v * f.h;
    const sz = r4 < big * 0.4 ? 3 : r4 < big ? 2 : 1;
    if (f.air) {
      p.col(C.ink, 0.35 * a);
      p.dot(gx - sz / 2, gy + 1, gy + 1, sz, 1);
    }
    const spin = f.air ? Math.floor(t * (14 + r2 * 10) + i) & 3 : i & 3;
    const im = chunkImg(sz, spin, pal);
    p.alpha(a);
    p.img(im, gx - im.width / 2, gy - f.z - im.height / 2, gy);
  }
}

/**
 * Пыль клубами: `n` клубов из (x, y), направление `ang` ± `spread`, скорость
 * с сопротивлением, растут `r0 → r1`, поднимаются на `rise` и тают за `life`.
 */
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
  alpha = 0.7,
  delay?: (i: number) => number,
  at?: From,
): void {
  for (let i = 0; i < n; i++) {
    const h1 = hash(seed, i, 21);
    const h2 = hash(seed, i, 22);
    const h3 = hash(seed, i, 23);
    const t = age - (delay ? delay(i) : 0);
    if (t < 0) continue;
    const L = life * (0.75 + 0.4 * h3);
    if (t >= L) continue;
    const k = t / L;
    const src = at ? at(i) : null;
    const th = (src && src[2] !== undefined ? src[2] : ang) + (h1 - 0.5) * 2 * spread;
    const d = drag(v0 + dv * h2, 3.2, t);
    const sz = 0.5 + 0.6 * hash(seed, i, 25);
    // Клуб раздувается, а под конец садится и тает — пыль оседает.
    const grow = eOut2(k01(t / (L * 0.45)));
    const settle = 1 - 0.45 * k01((k - 0.55) / 0.45);
    const r = (r0 + (r1 - r0) * sz * grow) * settle;
    const z = rise * (0.6 + 0.4 * h2) * eOut2(k);
    const im = puffImg(pal, r, i);
    p.alpha(0.85 * alpha * (k < 0.15 ? 1 : 1 - Math.pow((k - 0.15) / 0.85, 0.9)));
    const ox = src ? src[0] : x;
    const oy = src ? src[1] : y;
    const gy = oy + Math.sin(th) * d;
    p.img(im, ox + Math.cos(th) * d - im.width / 2, gy - z - im.height / 2, gy);
  }
}

/** Искры: головка и хвост по скорости, цвет по доле жизни. */
function sparks(
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
  life: number,
  up = 50,
  col: (k: number) => string = sparkCol,
  delay?: (i: number) => number,
  at?: From,
): void {
  for (let i = 0; i < n; i++) {
    const h1 = hash(seed, i, 31);
    const h2 = hash(seed, i, 32);
    const h3 = hash(seed, i, 33);
    const t = age - (delay ? delay(i) : 0);
    if (t < 0) continue;
    const L = life * (0.6 + 0.6 * h3);
    if (t >= L) continue;
    const k = t / L;
    const src = at ? at(i) : null;
    const th = (src && src[2] !== undefined ? src[2] : ang) + (h1 - 0.5) * 2 * spread;
    const v = v0 + dv * h2;
    const vz = up * (0.4 + h3);
    const ox = src ? src[0] : x;
    const oy = src ? src[1] : y;
    const pos = (tt: number): [number, number] => {
      const d = drag(v, 2.2, tt);
      const z = vz * tt - 160 * tt * tt;
      return [ox + Math.cos(th) * d, oy + Math.sin(th) * d - Math.max(-2, z)];
    };
    const [ax, ay] = pos(t);
    const [bx, by] = pos(Math.max(0, t - 0.035));
    p.col(col(k), 1 - k * 0.4);
    p.line(bx, by, ax, ay, oy + Math.sin(th) * drag(v, 2.2, t));
  }
}

/**
 * Угольки: поднимаются от места рождения, качаются, гаснут. `n` штук, i-й
 * рождается в `born(i)` и живёт `life`; `at(i)` — откуда.
 */
function embers(
  p: Pen,
  seed: number,
  age: number,
  n: number,
  life: number,
  rise: number,
  born: (i: number) => number,
  at: (i: number) => [number, number],
  a0 = 1,
  col: (k: number) => string = sparkCol,
): void {
  for (let i = 0; i < n; i++) {
    const t = age - born(i);
    const L = life * (0.7 + 0.5 * hash(seed, i, 41));
    if (t < 0 || t >= L) continue;
    const k = t / L;
    const [x, y] = at(i);
    const sw = Math.sin(t * (5 + 3 * hash(seed, i, 42)) + i) * (1.5 + 2 * k);
    const z = rise * (0.6 + 0.6 * hash(seed, i, 43)) * eOut2(k);
    p.col(col(0.25 + k * 0.75), a0 * (1 - k * k));
    p.dot(x + sw, y - z, y);
  }
}

/**
 * Обрывки: из точки `at(i)` вылетают поперёк (`at(i)[2]` — угол) с рывком и
 * тут же вязнут в воздухе, потом медленно опускаются, кружась, и ложатся.
 * Рисунок — бумага офуда, ткань, пепел (`kind` — смещение варианта).
 */
function shreds(
  p: Pen,
  seed: number,
  age: number,
  n: number,
  born: (i: number) => number,
  at: From,
  v0: number,
  life: number,
  kind = 0,
): void {
  for (let i = 0; i < n; i++) {
    const t = age - born(i);
    if (t < 0) continue;
    const h1 = hash(seed, i, 51);
    const h2 = hash(seed, i, 52);
    const h3 = hash(seed, i, 53);
    const L = life * (0.8 + 0.4 * h3);
    if (t >= L) continue;
    const [ox, oy, th0] = at(i);
    const th = (th0 ?? 0) + (h1 - 0.5) * 0.9;
    const d = drag(v0 * (0.5 + h2), 7, t);
    const lift = 4 + 12 * h2;
    let z = lift * (1 - Math.exp(-6 * t)) - 11 * t + 3;
    const air = z > 0;
    if (!air) z = 0;
    const sw = air ? Math.sin(t * (6 + 5 * h1) + i * 1.7) * (1.5 + 2 * h3) : 0;
    const gx = ox + Math.cos(th) * d + sw;
    const gy = oy + Math.sin(th) * d;
    const f = air ? Math.floor(t * (9 + 7 * h1) + i) & 3 : (i & 1) * 3;
    const a = 1 - k01((t - (L - 0.35)) / 0.35);
    if (air && z > 2) {
      p.col(C.ink, 0.25 * a);
      p.dot(gx, gy + 1, gy + 1);
    }
    p.alpha(a);
    p.img(shredImg(kind + (i % 3 === 0 ? 4 : 0) + (i & 1), f), gx - 1, gy - z - 1, gy);
  }
}

// ---- Трещины: сеть от зерна, растёт от точки удара ---------------------------

interface Crack {
  x: Int16Array;
  y: Int16Array;
  d: Float32Array;
  lx: Int16Array;
  ly: Int16Array;
  ld: Float32Array;
  max: number;
}
const cracks = new Map<string, Crack>();

/**
 * Сеть трещин из точки (0, 0): ветви `[угол, длина, ширина-у-корня]`,
 * извилистость `jag`, развилки с шансом `forkP`. Каждый пиксель знает путь
 * от корня — трещина «бежит», а не проявляется. Кромка — светлый пиксель
 * снизу-справа (свет сверху-слева), как высеченный жёлоб.
 */
function crackOf(
  key: string,
  seed: number,
  br: [number, number, number][],
  jag = 0.5,
  forkP = 0.22,
  forkL = 0.45,
): Crack {
  let c = cracks.get(key);
  if (c) return c;
  const px = new Map<number, number>();
  const K = (x: number, y: number) => (x + 1024) * 4096 + (y + 1024);
  const put = (x: number, y: number, d: number) => {
    const k = K(x, y);
    const o = px.get(k);
    if (o === undefined || d < o) px.set(k, d);
  };
  const walk = (
    x0: number,
    y0: number,
    a0: number,
    len: number,
    d0: number,
    wid: number,
    id: number,
    depth: number,
  ) => {
    let x = x0;
    let y = y0;
    let a = a0;
    for (let s = 0, i = 0; s < len; s += 2, i++) {
      a += (hash(seed, id * 131 + i, 1) - 0.5) * jag * 2;
      a = a * 0.72 + a0 * 0.28;
      const nx = x + Math.cos(a) * 2;
      const ny = y + Math.sin(a) * 2;
      const w = wid * (1 - s / len);
      for (let q = 0; q <= 4; q++) {
        const qx = x + ((nx - x) * q) / 4;
        const qy = y + ((ny - y) * q) / 4;
        const d = d0 + s + q * 0.5;
        put(Math.floor(qx), Math.floor(qy), d);
        if (w > 1.1)
          put(Math.floor(qx + Math.sin(a) * 0.95), Math.floor(qy - Math.cos(a) * 0.95), d);
      }
      x = nx;
      y = ny;
      if (depth < 1 && s > len * 0.25 && s < len * 0.8 && hash(seed, id * 17 + i, 2) < forkP) {
        const side = hash(seed, id * 19 + i, 3) < 0.5 ? -1 : 1;
        walk(
          x,
          y,
          a + side * (0.5 + 0.4 * hash(seed, id, 4)),
          (len - s) * forkL,
          d0 + s,
          1,
          id * 7 + i + 1,
          depth + 1,
        );
      }
    }
  };
  br.forEach(([a, len, w], i) => walk(0.5, 0.5, a, len, 0, w, i + 1, 0));
  const pts = [...px.entries()].map(([k, d]) => [
    Math.floor(k / 4096) - 1024,
    (k % 4096) - 1024,
    d,
  ]);
  pts.sort((a, b) => a[2] - b[2]);
  const lips = pts
    .filter(([x, y]) => !px.has(K(x + 1, y + 1)))
    .map(([x, y, d]) => [x + 1, y + 1, d]);
  c = {
    x: Int16Array.from(pts.map((q) => q[0])),
    y: Int16Array.from(pts.map((q) => q[1])),
    d: Float32Array.from(pts.map((q) => q[2])),
    lx: Int16Array.from(lips.map((q) => q[0])),
    ly: Int16Array.from(lips.map((q) => q[1])),
    ld: Float32Array.from(lips.map((q) => q[2])),
    max: pts.length ? pts[pts.length - 1][2] : 0,
  };
  if (cracks.size > 80) cracks.delete(cracks.keys().next().value as string);
  cracks.set(key, c);
  return c;
}

/** Звезда трещин: n ветвей вокруг, длины lo…hi, первая — по углу a. */
const starBranches = (
  seed: number,
  n: number,
  a: number,
  lo: number,
  hi: number,
  w = 2,
): [number, number, number][] =>
  Array.from({ length: n }, (_, i) => [
    a + (i / n) * TAU + (hash(seed, i, 41) - 0.5) * (TAU / n) * 0.6,
    lo + (hi - lo) * hash(seed, i, 42),
    i % 2 ? Math.max(1, w - 1) : w,
  ]);

/**
 * Трещина до пути `reach` (пиксели): жёлоб цвета `core(d)` (по пути от
 * корня — жар остывает от точки удара), кромка `lip`.
 */
function drawCrack(
  p: Pen,
  c: Crack,
  x: number,
  y: number,
  reach: number,
  core: string | ((d: number) => string),
  lip: string | null,
  a: number,
): void {
  if (a <= 0) return;
  const ox = Math.floor(x);
  const oy = Math.floor(y);
  if (lip) {
    p.col(lip, a * 0.7);
    for (let i = 0; i < c.lx.length && c.ld[i] <= reach; i++) p.dot(ox + c.lx[i], oy + c.ly[i]);
  }
  if (typeof core === 'string') {
    p.col(core, a);
    for (let i = 0; i < c.x.length && c.d[i] <= reach; i++) p.dot(ox + c.x[i], oy + c.y[i]);
    return;
  }
  let last = '';
  for (let i = 0; i < c.x.length && c.d[i] <= reach; i++) {
    const cc = core(c.d[i]);
    if (cc !== last) {
      p.col(cc, a);
      last = cc;
    }
    p.dot(ox + c.x[i], oy + c.y[i]);
  }
}

// ---- Общее для зон ----------------------------------------------------------

/** Визуальные зоны мозга (`api.vfx`) с полями для рисунка. */
type VZone = Zone & {
  vFrom?: number;
  vT?: number;
  vAng?: number;
  vW?: number;
  vBack?: number;
  vKind?: number;
  vDir?: number;
  vX0?: number;
  vY0?: number;
  vX1?: number;
  vY1?: number;
};

/** Зона рисуется без `save/restore` движка — прозрачность не должна утечь. */
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

/** Метка удара: налив 0…1 и сколько осталось до урона, с. */
const warnOf = (z: Zone | Strike) => {
  const st = z as Strike;
  const w = Math.max(0.01, st.warn ?? 0.01);
  return { k: k01(st.t / w), left: w - st.t };
};

/** Номер для зерна: у зон `api.vfx` и у листа кадров он бывает отрицательным или пустым. */
const idOf = (z: { id?: number }) => (z.id ?? 0) >>> 0;

/** Король на этой вылазке (или null — лист кадров). */
const kingNow = (): Mob | null => paintSim()?.mobs.find((m) => m.kind === 'f12boss') ?? null;

// =============================================================================
// РАССЕЧЕНИЕ — `f12_cut`: три (с 3-й фазы пять) параллельные линии от короля
// к герою, длина 10, полуширина 0,36; урон в 0,78 + i·0,07 (с помоста —
// 0,9 + i·0,07). Той же краской — КРЕСТ «Расщепления»: две линии 4,8 под
// героем, урон в 0,82.
//
// Метка — нить. С первого кадра видна вся полоса удара (тёмный кармин с
// кромкой), по оси — провисшая нить, которая качается. Натяжение бежит от
// короля к концу (у креста — от обоих концов к середине) и доходит до края
// ровно в миг урона: натянутое — прямое и светлое, за ним полоса наливается.
// Последние 0,2 с — нить белая, звенит (дрожь на пиксель), кромка «тик-тик».
//
// Контакт — рассечение воздуха: белое лезвие пробегает линию за 0,07 с с
// багровым смазом, воздух расходится двумя белыми кромками, между ними —
// кармин; в камне остаётся рубец (раскалённый проклятием, остывает в тёмный
// жёлоб со светлой кромкой), из него — обрывки, крошка и пыль; на конце
// линии — искры, у креста — вспышка-звезда в середине.
// =============================================================================

/** Пробег лезвия по линии, с. */
const CUT_RUN = 0.07;

/** Рубец разреза: пиксели вдоль линии с лёгкой волной (`u` — доля пути 0…1). */
interface Scar {
  x: Int16Array;
  y: Int16Array;
  u: Float32Array;
}
const scars = new Map<string, Scar>();
function scarOf(seed: number, L: number, a: number, jag = 1): Scar {
  const key = `${seed}|${Math.round(L)}|${Math.round(a * 200)}|${jag}`;
  let sc = scars.get(key);
  if (sc) return sc;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const ph1 = hash(seed, 1, 61) * TAU;
  const ph2 = hash(seed, 2, 61) * TAU;
  const xs: number[] = [];
  const ys: number[] = [];
  const us: number[] = [];
  let lx = 1e9;
  let ly = 1e9;
  for (let s = 0; s <= L; s += 0.5) {
    const u = s / L;
    // У концов рубец сходит на нет: волна ×(края).
    const edge = Math.min(1, u * 6, (1 - u) * 6);
    const off = jag * edge * (0.9 * Math.sin(s * 0.19 + ph1) + 0.5 * Math.sin(s * 0.57 + ph2));
    const x = Math.floor(ux * s - uy * off);
    const y = Math.floor(uy * s + ux * off);
    if (x === lx && y === ly) continue;
    lx = x;
    ly = y;
    xs.push(x);
    ys.push(y);
    us.push(u);
  }
  sc = { x: Int16Array.from(xs), y: Int16Array.from(ys), u: Float32Array.from(us) };
  if (scars.size > 48) scars.delete(scars.keys().next().value as string);
  scars.set(key, sc);
  return sc;
}

/**
 * Рубец, остывший до тёмного жёлоба, одним холстом (жёлоб и кромка): пока
 * горит — по пикселям, остыл — одним `drawImage`.
 */
const scarImgs = new WeakMap<Scar, Map<string, { img: HTMLCanvasElement; x: number; y: number }>>();
function scarImg(sc: Scar, core: string, lip: string) {
  let m = scarImgs.get(sc);
  if (!m) {
    m = new Map();
    scarImgs.set(sc, m);
  }
  const key = `${core}|${lip}`;
  let hit = m.get(key);
  if (hit) return hit;
  let x0 = 1e9;
  let y0 = 1e9;
  let x1 = -1e9;
  let y1 = -1e9;
  for (let i = 0; i < sc.x.length; i++) {
    x0 = Math.min(x0, sc.x[i]);
    y0 = Math.min(y0, sc.y[i]);
    x1 = Math.max(x1, sc.x[i] + 1);
    y1 = Math.max(y1, sc.y[i] + 1);
  }
  if (x1 < x0) x0 = y0 = x1 = y1 = 0;
  const px = new Px(x1 - x0 + 1, y1 - y0 + 1);
  const l = hx(lip, 170);
  for (let i = 0; i < sc.x.length; i++) px.set(sc.x[i] - x0 + 1, sc.y[i] - y0 + 1, l);
  const k = hx(core);
  for (let i = 0; i < sc.x.length; i++) px.set(sc.x[i] - x0, sc.y[i] - y0, k);
  hit = { img: px.canvas(), x: x0, y: y0 };
  m.set(key, hit);
  return hit;
}

/**
 * Нить по оси разреза: `off(s)` — отход поперёк, пиксели; `colAt(s)` —
 * цвет. Шаг — по главной оси: каждый пиксель ровно один раз.
 */
function threadLine(
  p: Pen,
  sx: number,
  sy: number,
  ux: number,
  uy: number,
  s0: number,
  s1: number,
  off: (s: number) => number,
  colAt: (s: number) => string,
  a: number,
): void {
  if (s1 <= s0) return;
  const n = Math.ceil(Math.max(Math.abs(ux), Math.abs(uy)) * (s1 - s0));
  if (n <= 0) return;
  const nx = -uy;
  const ny = ux;
  // Только видимый кусок нити.
  const c = p.clip(sx + ux * s0, sy + uy * s0, sx + ux * s1, sy + uy * s1);
  if (!c) return;
  let last = '';
  for (let i = 0; i <= n; i++) {
    const s = s0 + ((s1 - s0) * i) / n;
    const o = Math.round(off(s));
    const x = sx + ux * s + nx * o;
    const y = sy + uy * s + ny * o;
    if (x < p.x0 - 2 || x > p.x1 + 2 || y < p.y0 - 2 || y > p.y1 + 2) continue;
    const cc = colAt(s);
    if (cc !== last) {
      p.col(cc, a);
      last = cc;
    }
    p.dot(x, y);
  }
}

registerZonePainter(
  'f12_cut',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const st = z as Strike;
    const { k, left } = warnOf(st);
    const sig = left < SIG;
    const tk = !reduced() && tick(left);
    const sx = st.x * S;
    const sy = st.y * S;
    const p = new Pen(g, px, py, sx, sy, true, S);
    const a = st.ang ?? 0;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const nx = -uy;
    const ny = ux;
    const L = st.r * S;
    const hw = (st.w ?? 0.36) * S;
    const cross = st.r < 6;
    const sd = idOf(st);
    // Натяжение: доля пути от точки крепления (у креста — от каждого конца).
    const span = cross ? L / 2 : L;
    const f = span * Math.pow(k, 1.5);
    const tight = (s: number) => (cross ? s <= f || s >= L - f : s <= f);
    // «Куда»: вся полоса удара с первого кадра.
    p.col(C.crDk, 0.3 + 0.14 * k);
    fillLane(p, sx, sy, ux, uy, 0, L, hw);
    // «Когда»: за натяжением полоса наливается.
    p.col(sig ? C.cr : C.crMd, (tk ? 0.6 : 0.36) + 0.12 * k);
    if (cross) {
      fillLane(p, sx, sy, ux, uy, 0, f, hw);
      fillLane(p, sx, sy, ux, uy, L - f, L, hw);
    } else fillLane(p, sx, sy, ux, uy, 0, f, hw);
    // Налив течёт: шевроны бегут от крепления по налитой части (остриём по
    // ходу удара — тот же язык, что у прицела лука; не «шпалы»: на станции
    // частая лесенка читалась бы рельсами).
    const hs = 13;
    const flow = time * (26 + 70 * k);
    p.col(sig ? C.pink : C.crHi, 0.32 + 0.2 * k);
    const runs: [number, number, number][] = cross
      ? [
          [0, f, 1],
          [L - f, L, -1],
        ]
      : [[0, f, 1]];
    for (const [a0, a1, dir] of runs) {
      if (a1 - a0 < 5) continue;
      const ph = mod(flow, hs);
      for (let q = 0; q < (a1 - a0) / hs + 1; q++) {
        const s = dir > 0 ? a0 + ph + q * hs : a1 - ph - q * hs;
        const s2 = s - dir * 3;
        if (Math.min(s, s2) < a0 || Math.max(s, s2) > a1) continue;
        for (const side of [-1, 1])
          p.line(
            sx + ux * s2 + nx * (hw - 1.5) * side,
            sy + uy * s2 + ny * (hw - 1.5) * side,
            sx + ux * s,
            sy + uy * s,
          );
      }
    }
    // Кромка: тонкая и тихая — главное в метке нить. Натянутый кусок кромки
    // светлее; последние 0,2 с — вся кромка, «тик-тик».
    const ec = sig ? (tk ? C.white : C.pink) : C.crHi;
    for (const side of [-1, 1]) {
      const ex = sx + nx * hw * side;
      const ey = sy + ny * hw * side;
      p.col(ec, sig ? 0.95 : 0.32);
      p.line(ex, ey, ex + ux * L, ey + uy * L);
      if (sig || f < 1) continue;
      p.col(C.hot, 0.75);
      p.line(ex, ey, ex + ux * f, ey + uy * f);
      if (cross) p.line(ex + ux * (L - f), ey + uy * (L - f), ex + ux * L, ey + uy * L);
    }
    // Нить: натянутое — прямое, провисшее — плавно качается; к удару звенит.
    const slackA = 0.8 + 3.4 * Math.pow(1 - k, 1.3);
    const sway = Math.cos(time * 5.5 + (sd % 7));
    const twang = sig ? (Math.floor(time * 40) & 1 ? 1 : -1) * (tk ? 1 : 0) : 0;
    const off = (s: number) => {
      if (tight(s)) return twang * Math.sin((s / L) * Math.PI * 3);
      const v = cross ? (s - f) / Math.max(1, L - 2 * f) : (s - f) / Math.max(1, L - f);
      return slackA * Math.sin(Math.PI * v) * sway;
    };
    const tc = sig ? C.white : k > 0.6 ? C.pink : C.rose;
    threadLine(p, sx, sy, ux, uy, 0, L, off, (s) => (tight(s) ? tc : C.crHi), 0.95);
    // Бусина натяжения: яркая точка на фронте.
    if (k < 1) {
      const beads = cross ? [f, L - f] : [f];
      for (const b of beads) {
        const bx = sx + ux * b;
        const by = sy + uy * b;
        p.col(C.hot, 0.8);
        p.dot(bx - 1, by - 1, undefined, 3, 3);
        p.col(C.white, 1);
        p.dot(bx, by);
      }
    }
    // У креста — прицел в середине сходится (рисует одна линия пары).
    if (cross && mod(a, Math.PI) < Math.PI / 2) {
      const cx = sx + (ux * L) / 2;
      const cy = sy + (uy * L) / 2;
      p.col(sig ? C.white : C.pink, 0.9);
      corners(p, cx, cy, 4 + 10 * (1 - eOut2(k)), a, 3);
    }
  }),
);

registerImpactPainter('f12_cut', {
  life: 1.6,
  shake: 0.12,
  above: true,
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const sx = rec.x * S;
    const sy = rec.y * S;
    const p = new Pen(g, px, py, sx, sy, true, S);
    const a = rec.ang ?? 0;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const nx = -uy;
    const ny = ux;
    const L = (rec.r ?? 10) * S;
    const hw = (rec.w ?? 0.36) * S;
    const cross = (rec.r ?? 10) < 6;
    const sd = rec.seed >>> 0;
    const few = reduced();
    const span = cross ? L / 2 : L;
    // Когда лезвие проходит точку s линии (ease-out: срывается и тормозит).
    // Крест взрывается ИЗ середины: метка сошлась ножницами на герое — и
    // разрез расходится от него к концам.
    const dOf = (s: number) => (cross ? Math.abs(s - L / 2) : s);
    const pass = (s: number) => CUT_RUN * (1 - Math.cbrt(1 - k01(dOf(s) / span)));
    const front = span * eOut3(k01(age / CUT_RUN));
    const reached = (s: number) => dOf(s) <= front;
    // Рубец в камне — под всем остальным: раскрывается за лезвием,
    // остывает от розового к тёмному жёлобу со светлой кромкой.
    const lip = bloodFloor(rec.x + (ux * L) / 32, rec.y + (uy * L) / 32) ? C.lipBlood : C.lipStone;
    const fade = 1 - k01((age - 1.05) / 0.5);
    if (fade > 0) {
      const sc = scarOf(sd, L, a, cross ? 0.7 : 1);
      const ox = Math.floor(sx);
      const oy = Math.floor(sy);
      const cool = (u: number) => k01((age - pass(u * L)) / 0.32 + 0.25);
      if (age > CUT_RUN + 0.35) {
        const im = scarImg(sc, C.groove, lip);
        p.alpha(fade);
        p.img(im.img, ox + im.x, oy + im.y, oy + im.y);
      } else {
        p.col(lip, 0.65 * fade);
        for (let i = 0; i < sc.x.length; i++)
          if (reached(sc.u[i] * L)) p.dot(ox + sc.x[i] + 1, oy + sc.y[i] + 1);
        let last = '';
        for (let i = 0; i < sc.x.length; i++) {
          if (!reached(sc.u[i] * L)) continue;
          const cc = cutHeat(cool(sc.u[i]));
          if (cc !== last) {
            p.col(cc, fade);
            last = cc;
          }
          p.dot(ox + sc.x[i], oy + sc.y[i]);
        }
      }
    }
    // Рассечение по пикселям оси: у каждой точки своё время после прохода
    // лезвия τ. Лезвие (τ < 0,03) — белая полоса в 3 пикселя; потом щель
    // пустоты: чёрная середина и белые губы, которые сходятся (до 0,16);
    // потом алый след в пиксель, тающий до 0,45.
    if (age < CUT_RUN + 0.47) {
      const n = Math.ceil(Math.max(Math.abs(ux), Math.abs(uy)) * L);
      const cl = p.clip(sx, sy, sx + ux * L, sy + uy * L);
      const bins: number[][] = [[], [], [], [], [], []];
      if (cl)
        for (let i = 0; i <= n; i++) {
          const s = (L * i) / n;
          if (!reached(s)) continue;
          const tau = age - pass(s);
          const b =
            tau < 0.03 ? 0 : tau < 0.16 ? 1 : tau < 0.26 ? 2 : tau < 0.36 ? 3 : tau < 0.46 ? 4 : 5;
          if (b < 5) bins[b].push(s, tau);
        }
      const at = (s: number, o: number): [number, number] => [
        sx + ux * s + nx * o,
        sy + uy * s + ny * o,
      ];
      // Лезвие.
      p.col(C.white, 1);
      for (let i = 0; i < bins[0].length; i += 2)
        for (let o = -1; o <= 1; o++) p.dot(...at(bins[0][i], o));
      // Щель: губы сходятся от ±2 к ±1, середина — пустота.
      for (let i = 0; i < bins[1].length; i += 2) {
        const s = bins[1][i];
        const tau = bins[1][i + 1];
        const o = tau < 0.09 ? 2 : 1;
        p.col(C.groove, 1);
        for (let q = -(o - 1); q <= o - 1; q++) p.dot(...at(s, q));
        p.col(tau < 0.1 ? C.white : C.pink, 1);
        p.dot(...at(s, -o));
        p.dot(...at(s, o));
      }
      // Алый след.
      const trail = [C.hot, C.cr, C.crMd];
      for (let b = 2; b <= 4; b++) {
        p.col(trail[b - 2], b === 4 ? 0.6 : 1);
        for (let i = 0; i < bins[b].length; i += 2) p.dot(...at(bins[b][i], 0));
      }
      // Головка лезвия — ромб, пока оно в пути.
      if (age < CUT_RUN) {
        const heads = cross ? [L / 2 - front, L / 2 + front] : [front];
        p.col(C.white, 1);
        for (const hs of heads) star(p, sx + ux * hs, sy + uy * hs, 4.5, 2, a);
      }
    }
    // Обрывки воздуха и бумаги — поперёк линии, рождаются за лезвием.
    const nShred = few ? 3 : cross ? 6 : 10;
    const sAt = (i: number, salt: number) => L * (0.06 + 0.88 * hash(sd, i, salt));
    shreds(
      p,
      sd,
      age,
      nShred,
      (i) => pass(sAt(i, 71)),
      (i) => {
        const s = sAt(i, 71);
        const side = i & 1 ? 1 : -1;
        return [sx + ux * s, sy + uy * s, a + (side * Math.PI) / 2];
      },
      38,
      1.3,
      0,
    );
    // Крошка из рубца и пыль.
    const pal = bloodFloor(rec.x + (ux * L) / 32, rec.y + (uy * L) / 32) ? 1 : 0;
    chunks(
      p,
      sd + 3,
      age,
      sx,
      sy,
      few ? 2 : cross ? 4 : 6,
      0,
      0.4,
      16,
      22,
      40,
      40,
      [0.9, 1.3],
      0.2,
      pal,
      (i) => pass(sAt(i, 72)),
      (i) => {
        const s = sAt(i, 72);
        return [sx + ux * s, sy + uy * s, a + ((i & 1 ? 1 : -1) * Math.PI) / 2];
      },
    );
    dust(
      p,
      sd + 5,
      age,
      sx,
      sy,
      few ? 2 : cross ? 3 : 5,
      0,
      0.5,
      6,
      8,
      1.5,
      4.5,
      5,
      0.8,
      bloodFloor(rec.x + (ux * L) / 32, rec.y + (uy * L) / 32) ? 4 : 0,
      0.55,
      (i) => pass(sAt(i, 73)) + 0.02,
      (i) => {
        const s = sAt(i, 73);
        return [sx + ux * s, sy + uy * s, a + ((i & 1 ? 1 : -1) * Math.PI) / 2];
      },
    );
    if (cross) {
      // Середина креста: звезда и кольцо (рисует одна линия пары).
      if (mod(a, Math.PI) < Math.PI / 2) {
        const cx = sx + (ux * L) / 2;
        const cy = sy + (uy * L) / 2;
        const t0 = age;
        if (t0 < 0.14) {
          p.col(C.white, 1 - t0 / 0.14);
          star(p, cx, cy, 11 - 40 * t0, 4, a + Math.PI / 4);
        }
        if (t0 >= 0 && t0 < 0.3) {
          p.col(C.hot, 0.8 * (1 - t0 / 0.3));
          ring(p, cx, cy, 4 + 22 * eOut2(t0 / 0.3), (an, i) => hash(i >> 1, sd, 9) > 0.3);
        }
        sparks(
          p,
          sd + 7,
          Math.max(0, t0),
          cx,
          cy,
          few ? 4 : 10,
          0,
          Math.PI,
          50,
          60,
          0.35,
          40,
          curseCol,
        );
      }
    }
    if (age >= CUT_RUN) {
      // Конец линии (у креста — оба): лезвие уходит в воздух искрами.
      const ends = cross ? [0, L] : [L];
      for (const [j, e] of ends.entries()) {
        const ex = sx + ux * e;
        const ey = sy + uy * e;
        const da = cross && e === 0 ? a + Math.PI : a;
        sparks(
          p,
          sd + 17 + j * 3,
          age - CUT_RUN,
          ex,
          ey,
          few ? 2 : cross ? 4 : 7,
          da,
          0.7,
          40,
          50,
          0.3,
          30,
          curseCol,
        );
      }
    }
  }),
});

// =============================================================================
// КОГТИ — `f12_claw`: конус r 2,3, дуга 1,9 к герою, урон в 0,62 (крест
// «Расщепления» бьёт следом, в 0,82). Четыре руки — четыре когтя.
//
// Метка: весь конус тёмным кармином с первого кадра; четыре дорожки когтей —
// пунктиром; каждая наливается от края, что выше на экране, к другому
// (удар сверху вниз), последняя доходит ровно в миг урона. Кромка — штрихи к
// оси, последние 0,2 с — белая, «тик-тик».
//
// Контакт: четыре когтя проходят конус размытыми серпами вразнобой (белое
// остриё, кармин, тёмный хвост) с проводкой за край; в камне — четыре
// борозды, раскалённые проклятием, остывают; крошка по ходу когтей, пыль у
// краёв, розовые искры с остриёв, волна воздуха за кромкой.
// =============================================================================

/** Откуда идёт удар: от края сектора, что выше на экране (сверху вниз). */
function sweepOf(a: number, arc: number): { as: number; dir: number } {
  const s0 = Math.sin(a - arc / 2);
  const s1 = Math.sin(a + arc / 2);
  return s0 <= s1 + 1e-6 ? { as: a - arc / 2, dir: 1 } : { as: a + arc / 2, dir: -1 };
}

/** Радиусы четырёх когтей — доли радиуса конуса. */
const CLAWS = [0.4, 0.57, 0.74, 0.9];

registerZonePainter(
  'f12_claw',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const st = z as Strike;
    const { k, left } = warnOf(st);
    const sig = left < SIG;
    const tk = !reduced() && tick(left);
    const cx = st.x * S;
    const cy = st.y * S;
    const p = new Pen(g, px, py, cx, cy, true, S);
    const R = st.r * S;
    const arc = st.arc ?? 1.9;
    const a = st.ang ?? 0;
    const a0 = a - arc / 2;
    const { as, dir } = sweepOf(a, arc);
    const r0 = 5;
    // «Куда».
    p.col(C.crDk, 0.34 + 0.12 * k);
    fillSector(p, cx, cy, r0, R, a0, a0 + arc);
    // Кромка: дуга и два края, штрихи бегут к оси.
    const run = time * (18 + 40 * k);
    const ec = sig ? (tk ? C.white : C.pink) : k > 0.55 ? C.hot : C.crHi;
    p.col(ec, 0.7 + 0.3 * k);
    ring(p, cx, cy, R, (an) => {
      if (!inArc(an, a0, arc)) return false;
      if (sig) return true;
      const d = Math.min(mod(an - a0, TAU), arc - mod(an - a0, TAU)) * R;
      return mod(d - run, 7) < 4;
    });
    for (const ea of [a0, a0 + arc]) {
      const ex = Math.cos(ea);
      const ey = Math.sin(ea);
      for (let r = r0; r < R; r += 1) {
        if (!sig && mod(R - r - run, 7) >= 4) continue;
        p.dot(cx + ex * r, cy + ey * r);
      }
    }
    // Дорожки когтей: пунктир — «куда», налив — «когда».
    for (let i = 0; i < 4; i++) {
      const rr = R * CLAWS[i];
      const prog = k01((k - i * 0.06) / 0.82);
      const span = arc * eIn2(prog);
      p.col(C.rose, 0.35);
      ring(p, cx, cy, rr, (an, j) => inArc(an, a0, arc) && (j & 3) === 0);
      if (span <= 0.01) continue;
      const lo = dir > 0 ? as : as - span;
      p.col(sig ? C.white : i % 2 ? C.pink : C.hot, 0.95);
      ring(p, cx, cy, rr, (an) => inArc(an, lo, span));
      // Остриё на конце дорожки.
      const tip = as + dir * span;
      p.col(C.white, 1);
      p.dot(cx + Math.cos(tip) * rr, cy + Math.sin(tip) * rr, undefined, 2, 1);
    }
  }),
);

/** Борозда когтя: дуга с дрожью, пиксели по ходу (`u` — доля пути). */
const gouges = new Map<string, Scar>();
function gougeOf(seed: number, R: number, as: number, dir: number, span: number): Scar {
  const key = `${seed}|${Math.round(R)}|${Math.round(as * 100)}|${dir}|${Math.round(span * 100)}`;
  let gs = gouges.get(key);
  if (gs) return gs;
  const xs: number[] = [];
  const ys: number[] = [];
  const us: number[] = [];
  const ph = hash(seed, 3, 61) * TAU;
  let lx = 1e9;
  let ly = 1e9;
  for (let s = 0; s <= span; s += 0.4 / R) {
    const u = s / span;
    const ang = as + dir * s;
    const r = R + 0.8 * Math.sin(s * 9 + ph);
    const x = Math.floor(Math.cos(ang) * r);
    const y = Math.floor(Math.sin(ang) * r);
    if (x === lx && y === ly) continue;
    lx = x;
    ly = y;
    xs.push(x);
    ys.push(y);
    us.push(u);
  }
  gs = { x: Int16Array.from(xs), y: Int16Array.from(ys), u: Float32Array.from(us) };
  if (gouges.size > 48) gouges.delete(gouges.keys().next().value as string);
  gouges.set(key, gs);
  return gs;
}

const CLAW_SWEEP = 0.11;
const CLAW_LAG = 0.014;
const CLAW_OVER = 0.45;
/**
 * Замах начался до контакта: в миг урона серпы уже на ходу (первый — на 70 %
 * пути, последний — только вошёл). Иначе кадр контакта был пустым.
 */
const CLAW_PRE = 0.05;

registerImpactPainter('f12_claw', {
  life: 1.4,
  shake: 0.25,
  above: true,
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const cx = rec.x * S;
    const cy = rec.y * S;
    const p = new Pen(g, px, py, cx, cy, true, S);
    const R = (rec.r ?? 2.3) * S;
    const a = rec.ang ?? 0;
    const arc = rec.arc ?? 1.9;
    const { as, dir } = sweepOf(a, arc);
    const sd = rec.seed >>> 0;
    const few = reduced();
    const span = arc + CLAW_OVER;
    const at = (s: number) => as + dir * s;
    // Кадр контакта: кромка конуса вспыхивает.
    if (age < 0.07) {
      p.col(C.white, 1 - age / 0.07);
      ring(p, cx, cy, R, (an) => inArc(an, a - arc / 2, arc));
    }
    const lip = bloodFloor(rec.x + Math.cos(a) * 1.2, rec.y + Math.sin(a) * 1.2)
      ? C.lipBlood
      : C.lipStone;
    for (let i = 0; i < 4; i++) {
      const t = age + CLAW_PRE - i * CLAW_LAG;
      if (t < 0) continue;
      const rr = R * CLAWS[i];
      // Смаз когтя: серп толщиной 2–3 пикселя, остриё белое.
      const fr = span * eOut2(k01(t / CLAW_SWEEP));
      const tl = span * eOut2(k01((t - 0.035) / 0.16));
      const fa = 1 - k01((t - 0.12) / 0.12);
      if (fr - tl > 0.02 && fa > 0) {
        const len = fr - tl;
        const n = Math.max(2, Math.min(18, Math.ceil(len / 0.08)));
        for (let j = 0; j < n; j++) {
          const s1 = fr - (len * j) / n;
          const s0 = fr - (len * (j + 1)) / n;
          const q = (j + 0.5) / n;
          const past = k01((s1 - arc) / CLAW_OVER);
          const th = (q < 0.25 ? 3 : q < 0.6 ? 2 : 1) * (1 - past * 0.6);
          const lo = Math.min(at(s0), at(s1));
          const hi = Math.max(at(s0), at(s1));
          p.col(q < 0.25 ? C.white : q < 0.6 ? C.hot : C.cr, fa * (q < 0.6 ? 1 : 0.7));
          fillSector(p, cx, cy, rr - th / 2, rr + th / 2 + 0.5, lo, hi);
        }
      }
      // Борозда: раскрывается за когтем, остывает.
      const gs = gougeOf(sd + i, rr, at(0.06), dir, arc - 0.12);
      const reveal = k01((fr - 0.06) / (arc - 0.12));
      const gf = 1 - k01((age - 0.9) / 0.45);
      if (gf > 0 && reveal > 0) {
        const ox = Math.floor(cx);
        const oy = Math.floor(cy);
        p.col(lip, 0.6 * gf);
        for (let j = 0; j < gs.x.length; j++)
          if (gs.u[j] <= reveal) p.dot(ox + gs.x[j] + 1, oy + gs.y[j] + 1);
        let last = '';
        for (let j = 0; j < gs.x.length; j++) {
          if (gs.u[j] > reveal) continue;
          const tc = CLAW_SWEEP * (1 - Math.sqrt(1 - k01((0.06 + gs.u[j] * (arc - 0.12)) / span)));
          const cc = cutHeat(k01((t - tc) / 0.6));
          if (cc !== last) {
            p.col(cc, gf);
            last = cc;
          }
          p.dot(ox + gs.x[j], oy + gs.y[j]);
        }
      }
      // Искры с острия по ходу когтя.
      sparks(
        p,
        sd + 10 + i,
        age,
        cx,
        cy,
        few ? 1 : 3,
        0,
        0.4,
        50,
        50,
        0.3,
        35,
        curseCol,
        (j) => i * CLAW_LAG - CLAW_PRE + CLAW_SWEEP * (0.3 + 0.5 * hash(sd, i * 8 + j, 81)),
        (j) => {
          const s = arc * (0.3 + 0.6 * hash(sd, i * 8 + j, 82));
          const th = at(s);
          return [cx + Math.cos(th) * rr, cy + Math.sin(th) * rr, th + (dir * Math.PI) / 2];
        },
      );
    }
    // Крошка по ходу когтей и пыль у края конуса.
    const pal = bloodFloor(rec.x + Math.cos(a) * 1.2, rec.y + Math.sin(a) * 1.2) ? 1 : 0;
    chunks(
      p,
      sd + 3,
      age,
      cx,
      cy,
      few ? 3 : 7,
      0,
      0.5,
      20,
      30,
      45,
      40,
      [0.9, 1.3],
      0.25,
      pal,
      (i) => CLAW_SWEEP * (0.2 + 0.7 * hash(sd, i, 83)),
      (i) => {
        const th = at(arc * (0.15 + 0.8 * hash(sd, i, 83)));
        const rr = R * CLAWS[i & 3];
        return [cx + Math.cos(th) * rr, cy + Math.sin(th) * rr, th + (dir * Math.PI) / 2];
      },
    );
    dust(
      p,
      sd + 5,
      age,
      cx,
      cy,
      few ? 2 : 5,
      0,
      0.3,
      10,
      12,
      1.5,
      5,
      6,
      0.85,
      bloodFloor(rec.x + Math.cos(a) * 1.2, rec.y + Math.sin(a) * 1.2) ? 4 : 0,
      0.6,
      (i) => CLAW_SWEEP * (0.4 + 0.5 * (i / 5)),
      (i) => {
        const th = at(arc * (0.1 + 0.8 * (i / 4)));
        return [cx + Math.cos(th) * R * 0.95, cy + Math.sin(th) * R * 0.95, th];
      },
    );
    // Волна воздуха за кромкой.
    if (age < 0.3) {
      p.col(C.pink, 0.6 * (1 - age / 0.3));
      ring(
        p,
        cx,
        cy,
        R + 3 + 14 * eOut2(age / 0.3),
        (an, i) => inArc(an, a - arc / 2, arc) && hash(i >> 1, sd, 9) > 0.3,
      );
    }
  }),
});

// =============================================================================
// СТОЛБЫ ПЛАМЕНИ — `f12_pyre`: 3–4 круга r 1,15 у героя, урон в 0,95 + i·0,12
// (первый — под самим героем).
//
// Метка — пятно жара: круг тёмного жара с первого кадра, по кромке бежит
// пунктир; жар стягивается к середине (внутреннее кольцо сжимается, свечение
// растёт), под полом раскаляются трещины — от тёмно-красных к белым, из них
// поднимаются угольки, тем чаще, чем ближе удар. Последние 0,2 с — кромка и
// трещины белые, «тик-тик».
//
// Контакт — столб пламени бьёт из пола за 0,06 с на четыре клетки вверх,
// держится, рвётся языками и опадает (0,32…0,62); у основания — волна жара и
// юбка из языков, под ним — выжженный кратер с теми же трещинами, остывающими
// от белого к тёмному; искры веером, оплавленные осколки, угольки, дым.
// =============================================================================

/** Зерно трещин столба — от места: у метки и у контакта одно. */
const spotSeed = (x: number, y: number) =>
  (Math.round(x * 4) * 7919 + Math.round(y * 4) * 104729 + 12) >>> 0;
const pyreCrack = (seed: number, R: number) =>
  crackOf(
    `pyre|${seed}|${Math.round(R)}`,
    seed,
    starBranches(seed, 6, hash(seed, 1, 5) * TAU, R * 0.55, R * 1.02, 2),
    0.55,
    0.3,
    0.5,
  );

/** Пламя по налив у трещины метки: тёмный → красный → жёлтый → белый. */
const glowCol = (k: number) =>
  k < 0.35 ? C.fire[1] : k < 0.65 ? C.fire[2] : k < 0.9 ? C.fire[3] : C.fire[4];

registerZonePainter(
  'f12_pyre',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const st = z as Strike;
    const { k, left } = warnOf(st);
    const sig = left < SIG;
    const tk = !reduced() && tick(left);
    const cx = st.x * S;
    const cy = st.y * S;
    const p = new Pen(g, px, py, cx, cy, true, S);
    const R = st.r * S;
    const sd = spotSeed(st.x, st.y);
    // «Куда»: круг жара.
    p.col('#1e0604', 0.42 + 0.14 * k);
    fillOval(p, cx, cy, R, R);
    // Жар стягивается: свечение растёт от середины.
    const gr = R * (0.2 + 0.7 * eOut2(k));
    p.col(C.fire[0], 0.5);
    fillOval(p, cx, cy, gr, gr);
    if (k > 0.45) {
      p.col(C.fire[1], 0.55 * k01((k - 0.45) / 0.3));
      fillOval(p, cx, cy, gr * 0.6, gr * 0.6);
    }
    // Трещины: бегут от середины и раскаляются.
    const cr = pyreCrack(sd, R);
    drawCrack(
      p,
      cr,
      cx,
      cy,
      cr.max * Math.pow(k, 0.8),
      sig ? (tk ? C.white : C.fire[4]) : glowCol(k),
      null,
      0.95,
    );
    // Внутреннее кольцо печати сжимается к середине.
    p.col(sig ? C.white : C.fire[3], 0.75);
    ring(p, cx, cy, Math.max(1, R * (0.92 - 0.6 * eIn2(k))), (an, i) => (i & 1) === 0);
    // Кромка: пунктир бежит по кругу, к удару — сплошная.
    const run = time * (1.2 + 3 * k);
    p.col(sig ? (tk ? C.white : C.fire[4]) : k > 0.55 ? C.fire[3] : C.fire[2], 0.85);
    ring(p, cx, cy, R, sig ? undefined : (an) => mod(an + run, TAU / 10) < TAU / 16);
    // Угольки из трещин — поток густеет к удару.
    const few = reduced();
    const n = few ? 4 : 12;
    embers(
      p,
      sd,
      st.t,
      n,
      0.55,
      10 + 8 * k,
      (i) => (i / n) * Math.max(0.2, st.warn - 0.1) * (0.4 + 0.6 * hash(sd, i, 44)),
      (i) => {
        const an = hash(sd, i, 45) * TAU;
        const rr = R * 0.8 * Math.sqrt(hash(sd, i, 46));
        return [cx + Math.cos(an) * rr, cy + Math.sin(an) * rr];
      },
    );
  }),
);

/** Столб пламени: высота H (кратно 4), ширина W, кадр f (0…3). Основание — низ по центру. */
function pillarImg(H: number, W: number, f: number): HTMLCanvasElement {
  const Hq = Math.max(4, Math.min(72, Math.round(H / 4) * 4));
  const Wq = Math.max(6, Math.min(36, Math.round(W / 2) * 2));
  return sprite(70000 + Hq * 400 + Wq * 4 + (f & 3), () => {
    const p = new Px(Wq + 4, Hq + 6);
    const cx = (Wq + 4) / 2;
    const fire = C.fire.map((c) => hx(c));
    for (let y = 0; y < Hq + 6; y++) {
      // u — доля высоты от основания (0) к макушке (1).
      const u = (Hq + 5 - y) / Hq;
      if (u > 1.08) continue;
      // Ствол сужается к макушке; у основания — чуть шире (юбка).
      const half = (Wq / 2) * (1 - 0.55 * Math.pow(Math.min(1, u), 2.2)) * (u < 0.08 ? 1.12 : 1);
      const sway = Math.sin(u * 7 + (f & 3) * 1.6) * 1.2 * u;
      for (let x = 0; x < Wq + 4; x++) {
        const dx = x + 0.5 - cx - sway;
        const d = Math.abs(dx) / Math.max(0.5, half);
        // Макушка рвётся тремя языками.
        if (u > 0.72) {
          const tongue = Math.abs(Math.sin((dx / Math.max(1, half)) * 2.4 + (f & 3) * 0.9));
          if (u > 0.72 + 0.36 * tongue) continue;
        }
        if (d > 1) continue;
        // Турбулентность: тёмные прожилки ползут вверх по кадрам.
        const n = hash(x, Math.floor((y + (f & 3) * 3) / 2), 77);
        const hot = 1 - d * 0.85 - Math.max(0, u - 0.55) * 0.9 + (n - 0.5) * 0.3;
        const col =
          hot > 0.62
            ? fire[4]
            : hot > 0.4
              ? fire[3]
              : hot > 0.18
                ? fire[2]
                : hot > 0
                  ? fire[1]
                  : fire[0];
        p.set(x, y, col);
      }
    }
    return p;
  });
}

registerImpactPainter('f12_pyre', {
  life: 1.7,
  shake: 0.22,
  flash: 0.12,
  flashRgb: '255,150,60',
  above: true,
  paint: guarded(
    (g, rec: ImpactRec, px: number, py: number, S: number, age: number, time: number) => {
      const cx = rec.x * S;
      const cy = rec.y * S;
      const p = new Pen(g, px, py, cx, cy, true, S);
      const R = (rec.r ?? 1.15) * S;
      const sd = spotSeed(rec.x, rec.y);
      const rs = rec.seed >>> 0;
      const few = reduced();
      // Кратер: выжженное пятно и трещины, остывающие от белого к тёмному.
      const cf = 1 - k01((age - 1.25) / 0.45);
      const sc = scorchImg(R * 0.95, 2);
      p.alpha(0.85 * cf);
      p.img(sc, cx - sc.width / 2, cy - sc.height / 2, cy - sc.height / 2);
      const cr = pyreCrack(sd, R);
      drawCrack(
        p,
        cr,
        cx,
        cy,
        cr.max,
        (d) => heatCol(k01(age / 1.1 + (d / cr.max) * 0.25)),
        C.lipStone,
        cf,
      );
      // Волна жара у основания.
      if (age < 0.22) {
        const w = age / 0.22;
        p.col(w < 0.4 ? C.fire[4] : C.fire[3], 0.9 * (1 - w));
        ring(p, cx, cy, R * (0.9 + 1.3 * eOut2(w)));
        p.col(C.fire[2], 0.7 * (1 - w));
        ring(p, cx, cy, R * (0.8 + 1.3 * eOut2(w)) - 2, (an, i) => (i & 1) === 0);
      }
      // Столб: бьёт из пола, держится, рвётся и опадает.
      const H0 = 60;
      let H = 0;
      let W = R * 1.45;
      if (age < 0.06) H = H0 * eOut3(age / 0.06);
      else if (age < 0.32) H = H0 + 3 * Math.sin(time * 40);
      else if (age < 0.62) {
        const c = (age - 0.32) / 0.3;
        H = H0 * (1 - eIn2(c));
        W *= 1 - 0.5 * c;
      }
      // Юбка из языков вокруг основания (за столбом и перед ним).
      const skirt = (front: boolean) => {
        if (age > 0.75) return;
        const sk = age < 0.05 ? age / 0.05 : 1 - k01((age - 0.35) / 0.4);
        for (let i = 0; i < 10; i++) {
          const an = (i / 10) * TAU + hash(sd, i, 3) * 0.4;
          const fy = Math.sin(an);
          if (front !== fy > 0) continue;
          const fx0 = cx + Math.cos(an) * R * 0.85;
          const fy0 = cy + fy * R * 0.85;
          const h = (6 + 7 * hash(sd, i, 4)) * sk;
          if (h < 3) continue;
          const im = flameImg(h, Math.floor(time * 14 + i), 0);
          p.alpha(1);
          p.img(im, fx0 - im.width / 2, fy0 - im.height + 1, fy0);
        }
      };
      skirt(false);
      if (H > 3) {
        const im = pillarImg(H, W, Math.floor(time * 18));
        p.alpha(1);
        p.img(im, cx - im.width / 2, cy - im.height + 3, cy);
      }
      skirt(true);
      // Кадр контакта: белая вспышка в основании.
      if (age < 0.05) {
        p.col(C.white, 1 - age / 0.05);
        fillOval(p, cx, cy - 2, R * 0.7, R * 0.45, cy);
      }
      // Искры веером вверх, оплавленные осколки, угольки после опадания, дым.
      sparks(p, rs, age, cx, cy - 8, few ? 6 : 16, 0, Math.PI, 40, 70, 0.7, 150, sparkCol);
      embers(
        p,
        rs + 5,
        age,
        few ? 6 : 14,
        0.9,
        26,
        (i) => 0.3 + i * 0.03,
        (i) => [cx + (hash(rs, i, 6) - 0.5) * R * 1.4, cy - H0 * 0.6 * hash(rs, i, 7)],
      );
      // Дым — когда столб опал: с места макушки, выше и позже.
      dust(
        p,
        rs + 7,
        age,
        cx,
        cy - 18,
        few ? 2 : 4,
        -Math.PI / 2,
        1.2,
        4,
        6,
        3,
        9,
        30,
        1.3,
        1,
        0.5,
        (i) => 0.5 + i * 0.09,
      );
    },
  ),
});

// =============================================================================
// ОГНЕННАЯ СТРЕЛА (с фазы 1). Лук натягивается 1,65 с (с 3-й фазы — 1,27):
// до T − 0,45 король ведёт прицел за героем, потом замирает. В T — стрела
// `f12_arrow` (линия через весь зал, полуширина 1,05, метка 0,05) и горящая
// полоса `f12_fire` по линии; спина короля открыта.
//
// Метка — `f12v_bow` (зона-картинка, ставит мозг; красная линия движка
// выключена `vNoTele`): с первого кадра — полоса удара через весь зал тёмным
// жаром с кромкой; по оси — луч прицела: пока король целится, он широкий,
// мягкий и дрожит маревом, вдоль бегут шевроны — куда полетит огонь. На
// замирании свечение сжимается в раскалённую нить, кромка становится
// сплошной, шевроны ускоряются, нить звенит всё чаще; последние 0,2 с —
// белая, «тик-тик». У лука стягиваются угольки.
//
// Контакт — болт: раскалённый наконечник пересекает зал за ≤ 0,15 с (быстрее,
// чем загорается полоса), за ним — след, остывающий от белого к тёмно-
// красному, языки по следу, волна жара расходится поперёк; у стены — взрыв:
// огненные клубы, кольцо, искры, щебень, дым.
// =============================================================================

/** Где стрела упирается в стену, пиксели от начала (нет вылазки — вся длина). */
const wallHits = new Map<number, number>();
function wallAt(seed: number, x: number, y: number, ang: number, L: number): number {
  const hit = wallHits.get(seed);
  if (hit !== undefined) return hit;
  const sim = paintSim();
  let d = L;
  if (sim?.world && sim.tiles) {
    const w = sim.world;
    const ux = Math.cos(ang);
    const uy = Math.sin(ang);
    for (let s = 1; s <= L / 16; s += 0.2) {
      const cx = Math.floor(x + ux * s);
      const cy = Math.floor(y + uy * s);
      if (cx < 0 || cy < 0 || cx >= w.w || cy >= w.h) {
        d = s * 16;
        break;
      }
      const t = sim.tiles[cy * w.w + cx];
      if (isWallTile(t) || t === Tile.Gate) {
        d = s * 16;
        break;
      }
    }
  }
  if (wallHits.size > 32) wallHits.delete(wallHits.keys().next().value as number);
  wallHits.set(seed, d);
  return d;
}

registerZonePainter(
  'f12v_bow',
  guarded((g, zz: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const z = zz as VZone;
    const sim = paintSim();
    const m = sim?.mobs.find((q) => q.id === z.vFrom) ?? null;
    // Выпустил или сбит — прицела больше нет (дальше — стрела).
    if (sim && (!m || m.mode !== 'f12_bow')) return;
    const T = z.vT ?? 1.65;
    const t = m ? m.t : z.t;
    const kx = (m ? m.x : z.x) * S;
    const ky = (m ? m.y : z.y) * S;
    const ang = m ? (m.data.ang ?? z.vAng ?? 0) : (z.vAng ?? 0);
    const p = new Pen(g, px, py, z.x * S, z.y * S, true, S);
    const ux = Math.cos(ang);
    const uy = Math.sin(ang);
    const nx = -uy;
    const ny = ux;
    const L = z.r * S;
    const hw = (z.vW ?? 1.05) * S;
    const k = k01(t / T);
    const left = T - t;
    const sig = left < SIG;
    const tk = !reduced() && tick(left);
    const tf = T - 0.45;
    const fk = k01((t - tf) / 0.45);
    // «Куда»: полоса через весь зал.
    p.col('#2a0804', 0.24 + 0.16 * k);
    fillLane(p, kx, ky, ux, uy, 6, L, hw);
    // Кромка: пока целится — точки бегут от лука, замер — сплошная.
    const ec = sig ? (tk ? C.white : C.fire[4]) : fk > 0 ? C.fire[3] : C.fire[2];
    p.col(ec, sig ? 1 : 0.45 + 0.4 * fk);
    const run = time * (40 + 120 * fk);
    for (const side of [-1, 1]) {
      const ex = kx + nx * hw * side;
      const ey = ky + ny * hw * side;
      if (fk > 0) {
        p.line(ex + ux * 6, ey + uy * 6, ex + ux * L, ey + uy * L);
        continue;
      }
      const cl = p.clip(ex, ey, ex + ux * L, ey + uy * L);
      if (!cl) continue;
      const s0 = Math.max(6, (cl[0] - ex) * ux + (cl[1] - ey) * uy - 6);
      const s1 = Math.min(L, (cl[2] - ex) * ux + (cl[3] - ey) * uy + 6);
      for (let s = s0 - mod(s0 - run, 6); s < s1; s += 6)
        p.line(ex + ux * s, ey + uy * s, ex + ux * (s + 3), ey + uy * (s + 3));
    }
    // Свечение луча: широкое и мягкое, на замирании сжимается в нить.
    const gw = Math.round(3 * (1 - fk));
    if (gw > 0) {
      p.col(C.fire[2], 0.22 + 0.1 * k);
      fillLane(p, kx, ky, ux, uy, 8, L, gw + 0.5);
    }
    // Нить: марево дрожит, пока целится; на замирании звенит всё чаще.
    const vib = fk > 0.3 ? (Math.floor(time * (18 + 70 * fk)) & 1 ? 1 : -1) : 0;
    const off = (s: number) =>
      fk > 0
        ? vib * Math.sin((s / 40) * Math.PI)
        : 1.2 * Math.sin(time * 17 + s * 0.09) * Math.sin(time * 5.3 + s * 0.023);
    const core = sig ? C.white : fk > 0 ? C.fire[4] : C.fire[3];
    threadLine(p, kx, ky, ux, uy, 8, L, off, () => core, 0.95);
    // Шевроны — куда полетит огонь.
    const sp = 26;
    const cr = time * (70 + 260 * fk);
    p.col(sig ? C.white : C.fire[3], 0.75);
    const cl = p.clip(kx, ky, kx + ux * L, ky + uy * L);
    if (cl) {
      const s0 = Math.max(14, (cl[0] - kx) * ux + (cl[1] - ky) * uy - sp);
      const s1 = Math.min(L - 4, (cl[2] - kx) * ux + (cl[3] - ky) * uy + sp);
      for (let s = s0 - mod(s0 - cr, sp); s < s1; s += sp) {
        const bx = kx + ux * s;
        const by = ky + uy * s;
        for (const side of [-1, 1])
          p.line(bx - ux * 4 + nx * 4 * side, by - uy * 4 + ny * 4 * side, bx, by);
      }
    }
    // У лука стягиваются угольки (на уровне рук, с той стороны, куда смотрит).
    const bx = kx + (Math.cos(ang) >= 0 ? 17 : -17);
    const by = ky - 27;
    const nE = reduced() ? 4 : 10;
    for (let i = 0; i < nE; i++) {
      const ph = mod(t / 0.42 + i / nE, 1);
      const an = hash(i, 5, 7) * TAU + t * 3;
      const rr = (16 - 15 * eIn2(ph)) * (0.6 + 0.4 * k);
      p.col(sparkCol(1 - ph), 0.5 + 0.5 * k);
      p.dot(bx + Math.cos(an) * rr, by + Math.sin(an) * rr * 0.7, ky);
    }
    if (fk > 0) {
      p.col(sig ? C.white : C.fire[4], 1);
      star(p, bx, by, 2 + 2.5 * fk + (Math.floor(time * 20) & 1), 4, time * 3, ky);
    }
  }),
);

registerZonePainter(
  'f12_arrow',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number) => {
    // Тетива отпущена: полоса вспыхивает на 0,05 с перед болтом.
    const st = z as Strike;
    const sx = st.x * S;
    const sy = st.y * S;
    const p = new Pen(g, px, py, sx, sy, true, S);
    const a = st.ang ?? 0;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const L = st.r * S;
    const hw = (st.w ?? 1.05) * S;
    const nx = -uy;
    const ny = ux;
    p.col(C.fire[4], 1);
    for (const side of [-1, 1])
      p.line(
        sx + ux * 6 + nx * hw * side,
        sy + uy * 6 + ny * hw * side,
        sx + ux * L + nx * hw * side,
        sy + uy * L + ny * hw * side,
      );
    p.col(C.white, 1);
    p.line(sx + ux * 8, sy + uy * 8, sx + ux * L, sy + uy * L);
  }),
);

/** Наконечник болта: направление d (0…15), кадр f (0…1); центр картинки — остриё. */
function boltImg(d: number, f: number): HTMLCanvasElement {
  return sprite(80000 + (d & 15) * 2 + (f & 1), () => {
    const N = 27;
    const p = new Px(N, N);
    const c = (N - 1) / 2;
    const th = ((d & 15) / 16) * TAU;
    const ca = Math.cos(th);
    const sa = Math.sin(th);
    const fire = C.fire.map((q) => hx(q));
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const dx = x - c;
        const dy = y - c;
        const al = dx * ca + dy * sa; // вдоль: + — вперёд
        const ac = Math.abs(-dx * sa + dy * ca);
        if (al > 3 || al < -13) continue;
        // Капля: острая спереди, хвост пламени длиннее и рваный.
        const wf =
          al > 0 ? 2.6 * (1 - al / 3) : 2.6 + al * 0.06 + Math.sin(al * 1.3 + (f & 1) * 2) * 0.6;
        if (wf <= 0 || ac > wf) continue;
        const hot = 1 - ac / Math.max(0.5, wf) - Math.max(0, -al) / 15;
        p.set(x, y, hot > 0.6 ? fire[4] : hot > 0.35 ? fire[3] : hot > 0.12 ? fire[2] : fire[1]);
      }
    p.set(Math.round(c), Math.round(c), hx('#ffffff'));
    p.set(Math.round(c - ca), Math.round(c - sa), hx('#ffffff'));
    return p;
  });
}

registerImpactPainter('f12_arrow', {
  life: 1.5,
  shake: 0.4,
  above: true,
  paint: guarded(
    (g, rec: ImpactRec, px: number, py: number, S: number, age: number, time: number) => {
      const sx = rec.x * S;
      const sy = rec.y * S;
      const p = new Pen(g, px, py, sx, sy, true, S);
      const a = rec.ang ?? 0;
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      const nx = -uy;
      const ny = ux;
      const L = (rec.r ?? 20) * S;
      const hw = (rec.w ?? 1.05) * S;
      const sd = rec.seed >>> 0;
      const few = reduced();
      const D = wallAt(sd, rec.x, rec.y, a, L);
      // Полёт: зал за ≤ 0,15 с — болт обгоняет загорание полосы.
      const tau = Math.min(0.15, D / 1400);
      const head = D * k01(age / tau);
      const tp = (s: number) => (tau * s) / D;
      const s0 = 8;
      // Кадр контакта: кромки полосы вспыхивают белым и гаснут в жёлтое.
      if (age < 0.08) {
        p.col(age < 0.04 ? C.white : C.fire[4], 1 - age / 0.08);
        for (const side of [-1, 1])
          p.line(
            sx + ux * s0 + nx * hw * side,
            sy + uy * s0 + ny * hw * side,
            sx + ux * D + nx * hw * side,
            sy + uy * D + ny * hw * side,
          );
        p.col(C.fire[3], 0.16 * (1 - age / 0.08));
        fillLane(p, sx, sy, ux, uy, s0, D, hw);
      }
      // Волна жара расходится поперёк: две кромки.
      const N = 10;
      for (let j = 0; j < N; j++) {
        const a0 = s0 + ((D - s0) * j) / N;
        const a1 = s0 + ((D - s0) * (j + 1)) / N;
        const sm = (a0 + a1) / 2;
        if (sm > head) continue;
        const ta = age - tp(sm);
        if (ta < 0 || ta > 0.32) continue;
        const o = 3 + 22 * eOut2(ta / 0.32);
        p.col(C.fire[3], 0.6 * (1 - ta / 0.32));
        // Марево, а не кромка: штрихи по 3 пикселя через 3.
        for (const side of [-1, 1]) {
          const ox = nx * o * side;
          const oy = ny * o * side;
          for (let q = a0 + (j & 1) * 3; q < a1; q += 6)
            p.line(
              sx + ux * q + ox,
              sy + uy * q + oy,
              sx + ux * Math.min(a1, q + 3) + ox,
              sy + uy * Math.min(a1, q + 3) + oy,
            );
        }
      }
      // След: по пикселю оси — остывает от белого к тёмно-красному.
      if (age < tau + 0.9) {
        const cl = p.clip(sx + ux * s0, sy + uy * s0, sx + ux * head, sy + uy * head);
        if (cl) {
          const n = Math.ceil(Math.max(Math.abs(ux), Math.abs(uy)) * (head - s0));
          const bins: number[][] = [[], [], [], [], [], []];
          for (let i = 0; i <= n; i++) {
            const s = s0 + ((head - s0) * i) / Math.max(1, n);
            const x = sx + ux * s;
            const y = sy + uy * s;
            if (x < p.x0 - 3 || x > p.x1 + 3 || y < p.y0 - 3 || y > p.y1 + 3) continue;
            const h = (age - tp(s)) / 0.9;
            const b = h < 0.06 ? 0 : h < 0.18 ? 1 : h < 0.35 ? 2 : h < 0.6 ? 3 : h < 1 ? 4 : 5;
            if (b < 5) bins[b].push(s);
          }
          const cols = [C.white, C.fire[4], C.fire[3], C.fire[2], C.fire[1]];
          const wid = [2, 2, 1, 1, 0];
          for (let b = 0; b < 5; b++) {
            p.col(cols[b], b === 4 ? 0.7 : 1);
            for (const s of bins[b])
              for (let o = -wid[b]; o <= wid[b]; o++)
                p.dot(sx + ux * s + nx * o, sy + uy * s + ny * o);
          }
        }
        // Языки по следу: у каждого своё время после пролёта.
        const step = 11;
        for (let s = s0 + step; s < head; s += step) {
          const x = sx + ux * s;
          const y = sy + uy * s;
          if (x < p.x0 - 10 || x > p.x1 + 10 || y < p.y0 - 4 || y > p.y1 + 20) continue;
          const ta = age - tp(s);
          const life = 0.55 + 0.25 * hash(sd, s, 3);
          if (ta < 0 || ta > life) continue;
          const h = (5 + 6 * hash(sd, s, 4)) * Math.sin(Math.PI * Math.min(1, ta / life));
          if (h < 3) continue;
          const im = flameImg(h, Math.floor(time * 14 + s), 0);
          p.alpha(1);
          p.img(im, x - im.width / 2 + (hash(sd, s, 5) - 0.5) * 6, y - im.height + 1, y);
        }
      }
      // Наконечник.
      if (age < tau + 0.01) {
        const d = Math.round((mod(a, TAU) / TAU) * 16) & 15;
        const im = boltImg(d, Math.floor(time * 30));
        const hx0 = sx + ux * Math.min(head, D);
        const hy0 = sy + uy * Math.min(head, D);
        p.alpha(1);
        p.img(im, hx0 - (im.width - 1) / 2, hy0 - (im.height - 1) / 2, hy0);
      }
      // Угольки по следу.
      embers(
        p,
        sd,
        age,
        few ? 8 : 22,
        0.9,
        14,
        (i) => tp(s0 + (D - s0) * hash(sd, i, 47)) + 0.05,
        (i) => {
          const s = s0 + (D - s0) * hash(sd, i, 47);
          const o = (hash(sd, i, 48) - 0.5) * 10;
          return [sx + ux * s + nx * o, sy + uy * s + ny * o];
        },
      );
      // Удар в стену.
      if (D < L - 1 && age >= tau) {
        const ta = age - tau;
        const ex = sx + ux * (D - 3);
        const ey = sy + uy * (D - 3);
        if (ta < 0.06) {
          p.col(C.white, 1 - ta / 0.06);
          star(p, ex, ey, 12 - 60 * ta, 6, a, ey);
        }
        if (ta < 0.3) {
          p.col(C.fire[3], 0.85 * (1 - ta / 0.3));
          ring(p, ex, ey, 6 + 26 * eOut2(ta / 0.3), (an, i) => hash(i >> 1, sd, 9) > 0.25, ey);
        }
        dust(p, sd + 1, ta, ex, ey, few ? 3 : 7, a + Math.PI, 1.4, 20, 30, 3, 10, 10, 0.7, 3, 0.95);
        dust(
          p,
          sd + 2,
          ta,
          ex,
          ey,
          few ? 2 : 4,
          a + Math.PI,
          1.2,
          8,
          12,
          4,
          10,
          22,
          1.2,
          1,
          0.55,
          (i) => 0.25 + i * 0.08,
        );
        sparks(p, sd + 3, ta, ex, ey, few ? 6 : 14, a + Math.PI, 1.3, 60, 90, 0.6, 70, sparkCol);
        chunks(
          p,
          sd + 4,
          ta,
          ex,
          ey,
          few ? 2 : 6,
          a + Math.PI,
          1.1,
          22,
          30,
          50,
          50,
          [0.9, 1.3],
          0.35,
          0,
        );
      }
    },
  ),
});

// =============================================================================
// ГОРЯЩАЯ ПОЛОСА — `f12_fire`: круги r 0,75 через 1,3 клетки по следу
// стрелы, 4,5 с жгут (метка 0,15). Зона БОЯ (урон, ожог) — рисуется всегда.
// Угли разгораются, встают три языка разной высоты и мерцают вразнобой,
// под ними — жаркая лужа и выжженное пятно, вверх — угольки и тонкий дым;
// в последние 0,6 с языки опадают, остаются тлеющие угли.
// =============================================================================

registerZonePainter(
  'f12_fire',
  guarded((g, zz: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const z = zz as Zone;
    const cx = z.x * S;
    const cy = z.y * S;
    const p = new Pen(g, px, py, cx, cy, true, S);
    const w = z.warn ?? 0.15;
    const t = z.t;
    const end = w + z.life;
    const sd = idOf(z) * 7 + 3;
    const R = z.r * S;
    // Рост и угасание языков.
    const grow = eOut2(k01((t - w) / 0.25));
    const die = 1 - k01((t - (end - 0.6)) / 0.6);
    const flame = t < w ? 0 : grow * die;
    const fade = 1 - k01((t - (end - 0.25)) / 0.25);
    // Пятно и лужа жара.
    const sc = scorchImg(R * 0.75, 2);
    p.alpha(0.7 * fade * k01((t - w * 0.8) / 0.2));
    p.img(sc, cx - sc.width / 2, cy - sc.height / 2, cy - sc.height / 2);
    // Лужа — когда болт пролетел (он пересекает зал за ≤ 0,15 с = метка зоны).
    const pool = t < w ? k01((t - w * 0.8) / (w * 0.2)) : Math.max(0.25, flame);
    p.col('#6a1806', 0.45 * pool * fade);
    fillOval(p, cx, cy, R * 0.8, R * 0.6);
    p.col(C.fire[2], 0.45 * pool * fade);
    fillOval(p, cx, cy, R * 0.42, R * 0.3);
    // Угли: пока разгорается — россыпь, потом тлеют под языками.
    for (let i = 0; i < 5 && t > w * 0.8; i++) {
      const an = hash(sd, i, 1) * TAU;
      const rr = R * 0.55 * hash(sd, i, 2);
      if (Math.sin(time * (5 + 4 * hash(sd, i, 3)) + i * 2) < -0.3) continue;
      p.col(t < w ? C.fire[4] : C.fire[3], fade);
      p.dot(cx + Math.cos(an) * rr, cy + Math.sin(an) * rr * 0.7);
    }
    // Три языка вразнобой — сзади наперёд.
    if (flame > 0.05) {
      const tongues: [number, number, number][] = [
        [-5, -2, 9],
        [4, -1, 8],
        [0, 1, 13],
      ];
      for (const [i, [ox, oy, h0]] of tongues.entries()) {
        const fl = 1 + 0.18 * Math.sin(time * (9 + i * 2.3) + sd);
        const h = h0 * flame * fl * (0.85 + 0.3 * hash(sd, i, 9));
        if (h < 3) continue;
        const im = flameImg(h, Math.floor(time * 12 + i * 1.7 + mod(sd, 4)), 0);
        p.alpha(1);
        p.img(im, cx + ox - im.width / 2, cy + oy - im.height + 1, cy + oy);
      }
    }
    // Угольки и тонкий дым.
    if (!reduced()) {
      for (let i = 0; i < 3; i++) {
        const ph = mod(time * 0.9 + i / 3 + hash(sd, i, 5), 1);
        const ex = cx + (hash(sd, i, 6) - 0.5) * R + Math.sin(time * 4 + i) * 2;
        p.col(sparkCol(0.3 + ph * 0.7), (1 - ph) * fade * Math.max(0.3, flame));
        p.dot(ex, cy - 4 - 22 * ph, cy);
      }
      if (flame > 0.2) {
        const ph = mod(time * 0.5 + hash(sd, 7, 7), 1);
        const im = puffImg(1, 2 + 3 * ph, sd);
        p.alpha(0.3 * (1 - ph) * flame);
        p.img(
          im,
          cx - im.width / 2 + Math.sin(time * 2 + sd) * 3,
          cy - 18 - 14 * ph - im.height / 2,
          cy,
        );
      }
    }
  }),
);

// =============================================================================
// ЖЕРТВЕННЫЙ ХРАМ: сетка «верного» удара — `f12_grid` (метка 1,35 с, разрез
// 0,45 с, бьёт мимо брони, рывок не спасает), обереги — `f12_ward` (круги
// r 1,15: кто внутри — цел), контакт — событие `f12_gridcut`.
//
// Метка: нити тянутся от стен зала навстречу друг другу (у стены — бумажный
// офуда, к которому нить привязана), по очереди от ближних к дальним; к
// середине метки сходятся, провисшие — качаются; потом натягиваются, на
// пересечениях завязываются узлы, у оберегов нить упирается в круг и
// искрит золотом. Последние 0,2 с — вся сетка белая, «тик-тик».
// Разрез: по каждой нити пробегает белое лезвие (нити по очереди, за
// 0,16 с все), за ним — щель и алый след, у оберегов — золотые искры.
// Контакт: вся сетка вспыхивает белым, на полу — рубцы по всем нитям,
// обрывки бумаги и воздуха опадают, пыль на узлах.
//
// Обереги загораются по одному (круг виден с первого кадра — честно: защита
// действует сразу), четыре офуда стоят по сторонам, внутри ходит золотой
// узор; в разрез — купол вспыхивает; после — офуда сгорают, круг гаснет.
// =============================================================================

type GridZone = Zone & { f12?: GridView };

/** Нить по оси: горизонтальная (hz) в ряду c или вертикальная в колонке c. */
interface Thread {
  hz: boolean;
  c: number;
  /** Полная длина нити — от стены до стены (пиксели мира). */
  a: number;
  b: number;
  /** Куски без оберегов: [s0, s1, у s0 оберег, у s1 оберег]. */
  segs: [number, number, boolean, boolean][];
}

/** Обереги вылазки: зоны `f12_ward` по порядку зажжения. */
function wardsNow(): Zone[] {
  const sim = paintSim();
  if (!sim) return [];
  return sim.zones.filter((z) => z.art === 'f12_ward').sort((p, q) => p.id - q.id);
}

/** Нити сетки в пикселях мира, с дырами под обереги. */
function threadsOf(v: GridView, wards: { x: number; y: number }[], S: number): Thread[] {
  const R = KING.wardR;
  const out: Thread[] = [];
  const add = (hz: boolean, c: number) => {
    const a0 = hz ? v.x0 : v.y0;
    const b0 = hz ? v.x1 : v.y1;
    let segs: [number, number, boolean, boolean][] = [[a0, b0, false, false]];
    for (const w of wards) {
      const d = hz ? Math.abs(w.y - c) : Math.abs(w.x - c);
      if (d >= R) continue;
      const half = Math.sqrt(R * R - d * d);
      const m = hz ? w.x : w.y;
      const nxt: [number, number, boolean, boolean][] = [];
      for (const [a, b, wa, wb] of segs) {
        if (m - half > a) nxt.push([a, Math.min(b, m - half), wa, m - half < b ? true : wb]);
        if (m + half < b) nxt.push([Math.max(a, m + half), b, m + half > a ? true : wa, wb]);
      }
      segs = nxt.filter(([a, b]) => b > a);
    }
    out.push({
      hz,
      c: c * S,
      a: a0 * S,
      b: b0 * S,
      segs: segs.map(([a, b, wa, wb]) => [a * S, b * S, wa, wb]),
    });
  };
  for (let x = v.x0 + v.off; x <= v.x1; x += v.step) add(false, x);
  for (let y = v.y0 + v.off; y <= v.y1; y += v.step) add(true, y);
  return out;
}

/** Зал (прямоугольник сетки) без кругов оберегов — строками пикселей. */
function arenaWash(
  p: Pen,
  v: GridView,
  wards: { x: number; y: number }[],
  S: number,
  col: string,
  a: number,
): void {
  if (a <= 0) return;
  const R = KING.wardR * S;
  const X0 = Math.max(p.x0, Math.ceil(v.x0 * S));
  const X1 = Math.min(p.x1, Math.floor(v.x1 * S) - 1);
  const Y0 = Math.max(p.y0, Math.ceil(v.y0 * S));
  const Y1 = Math.min(p.y1, Math.floor(v.y1 * S) - 1);
  p.col(col, a);
  const cut: [number, number][] = [];
  for (let Y = Y0; Y <= Y1; Y++) {
    cut.length = 0;
    for (const w of wards) {
      const dy = Y + 0.5 - w.y * S;
      if (Math.abs(dy) >= R) continue;
      const h = Math.sqrt(R * R - dy * dy);
      cut.push([Math.ceil(w.x * S - h - 0.5), Math.floor(w.x * S + h - 0.5)]);
    }
    cut.sort((q, r) => q[0] - r[0]);
    let x = X0;
    for (const [ca, cb] of cut) {
      if (ca > x) p.run(x, Math.min(X1, ca - 1), Y);
      x = Math.max(x, cb + 1);
    }
    if (x <= X1) p.run(x, X1, Y);
  }
}

/**
 * Разрез сеткой по клеткам: в каждой клетке между нитями — диагональ (через
 * одну — в другую сторону), волной от короля: белая, розовая, алая, гаснет.
 * Пиксели в кругах оберегов не рисуются — круг не пустил.
 */
function cellSlashes(
  p: Pen,
  v: GridView,
  wards: { x: number; y: number }[],
  S: number,
  kx: number,
  ky: number,
  tc: number,
  fade: number,
): void {
  const R2 = (KING.wardR * S) ** 2;
  const xs: number[] = [v.x0];
  for (let x = v.x0 + v.off; x <= v.x1; x += v.step) xs.push(x);
  xs.push(v.x1);
  const ys: number[] = [v.y0];
  for (let y = v.y0 + v.off; y <= v.y1; y += v.step) ys.push(y);
  ys.push(v.y1);
  const dmax = Math.hypot((v.x1 - v.x0) * S, (v.y1 - v.y0) * S) / 2 || 1;
  for (let i = 0; i + 1 < xs.length; i++)
    for (let j = 0; j + 1 < ys.length; j++) {
      const ax = xs[i] * S;
      const bx = xs[i + 1] * S;
      const ay = ys[j] * S;
      const by = ys[j + 1] * S;
      if (bx - ax < 4 || by - ay < 4 || !p.sees(ax, ay, bx, by)) continue;
      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2;
      const ta = tc - GRID_SNAP * Math.min(1, Math.hypot(mx - kx, my - ky) / dmax);
      if (ta < 0 || ta > 0.45) continue;
      const col = ta < 0.04 ? C.white : ta < 0.12 ? C.pink : ta < 0.25 ? C.hot : C.cr;
      const al = ta < 0.25 ? 1 : 0.7 * (1 - (ta - 0.25) / 0.2) * fade;
      if (al <= 0) continue;
      p.col(col, al);
      const flip = (i + j) & 1;
      const x0 = ax + 2;
      const x1 = bx - 3;
      const y0 = flip ? by - 3 : ay + 2;
      const y1 = flip ? ay + 2 : by - 3;
      const n = Math.ceil(Math.max(x1 - x0, Math.abs(y1 - y0)));
      for (let q = 0; q <= n; q++) {
        const x = Math.floor(x0 + ((x1 - x0) * q) / n);
        const y = Math.floor(y0 + ((y1 - y0) * q) / n);
        let safe = false;
        for (const w of wards)
          if ((x + 0.5 - w.x * S) ** 2 + (y + 0.5 - w.y * S) ** 2 < R2) safe = true;
        if (safe) continue;
        p.dot(x, y);
        if (ta < 0.04) p.dot(x + 1, y);
      }
    }
}

/** Нити сетки один раз на сетку и набор оберегов (сетка живёт 2 с — не пересчитывать каждый кадр). */
const threadCache = new WeakMap<GridView, { key: string; th: Thread[] }>();
function threadsCached(v: GridView, wards: { x: number; y: number }[], S: number): Thread[] {
  const key = `${S}|${wards.map((w) => `${w.x},${w.y}`).join('|')}`;
  const c = threadCache.get(v);
  if (c && c.key === key) return c.th;
  const th = threadsOf(v, wards, S);
  threadCache.set(v, { key, th });
  return th;
}

/** Отрезок нити [s0, s1] со сдвигом поперёк `o` — одной строкой пикселей. */
function axisRun(p: Pen, t: Thread, s0: number, s1: number, o = 0): void {
  if (s1 < s0) return;
  if (t.hz) p.run(Math.floor(s0), Math.floor(s1), Math.floor(t.c + o));
  else p.vrun(Math.floor(t.c + o), Math.floor(s0), Math.floor(s1));
}

/**
 * Провисшая нить [s0, s1]: сдвиг `off(s)` поперёк, соседние пиксели с одним
 * сдвигом — одной строкой. Только видимый кусок.
 */
function swayRun(p: Pen, t: Thread, s0: number, s1: number, off: (s: number) => number): void {
  const lo = Math.max(Math.floor(s0), t.hz ? p.x0 : p.y0);
  const hi = Math.min(Math.floor(s1), t.hz ? p.x1 : p.y1);
  if (hi < lo) return;
  const cc = t.hz ? t.c : t.c;
  if (t.hz ? cc < p.y0 - 6 || cc > p.y1 + 6 : cc < p.x0 - 6 || cc > p.x1 + 6) return;
  let rs = lo;
  let ro = Math.round(off(lo));
  for (let s = lo + 1; s <= hi + 1; s++) {
    const o = s <= hi ? Math.round(off(s)) : 1e9;
    if (o !== ro) {
      axisRun(p, t, rs, s - 1, ro);
      rs = s;
      ro = o;
    }
  }
}

/** Бумажный офуда у стены: 3×6, красная печать; качается на пиксель. */
function ofuda(p: Pen, x: number, y: number, sway: number, burn = 0): void {
  const X = Math.floor(x) - 1 + sway;
  const Y = Math.floor(y) - 6;
  if (burn >= 1) return;
  const top = Math.floor(burn * 6);
  // Нить-привязь.
  p.col(C.gold[2], 1);
  p.dot(X + 1, Y - 1, y);
  for (let r = top; r < 6; r++) {
    p.col(
      r === top && burn > 0
        ? C.fire[3]
        : r === top + 1 && burn > 0
          ? C.ink
          : r < 3
            ? C.paper[3]
            : C.paper[2],
      1,
    );
    p.dot(X, Y + r, y, 3, 1);
  }
  if (top < 3) {
    p.col(C.seal, 1);
    p.dot(X + 1, Y + 2, y, 1, 2);
  }
}

/**
 * Пол оберега радиуса R: золотой свет шахматкой, к кромке гуще и ярче;
 * кольцо из восьми знаков и печать-ромб посередине.
 */
function wardFloor(R: number): HTMLCanvasElement {
  const Rq = Math.max(6, Math.min(30, Math.round(R)));
  return sprite(90000 + Rq, () => {
    const s = Rq * 2 + 1;
    const p = new Px(s, s);
    const c = Rq;
    const g3 = hx(C.gold[3], 150);
    const g4 = hx(C.gold[4], 210);
    const g2 = hx(C.gold[2], 120);
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        const d = Math.hypot(x - c, y - c) / Rq;
        if (d > 0.93) continue;
        if ((x + y) & 1) continue;
        const keep = d > 0.72 ? 1 : d > 0.45 ? 0.55 : 0.3;
        if (hash(x, y, 17) > keep) continue;
        p.set(x, y, d > 0.8 ? g4 : g3);
      }
    // Кольцо знаков: короткие штрихи-«иероглифы».
    for (let i = 0; i < 8; i++) {
      const an = (i / 8) * TAU;
      const gx = c + Math.cos(an) * Rq * 0.58;
      const gy = c + Math.sin(an) * Rq * 0.58;
      const v = Math.floor(hash(i, 3, 9) * 3);
      const pts: [number, number][] =
        v === 0
          ? [
              [-1, -1],
              [0, -1],
              [1, -1],
              [0, 0],
              [0, 1],
            ]
          : v === 1
            ? [
                [-1, -1],
                [-1, 0],
                [-1, 1],
                [0, 0],
                [1, -1],
                [1, 1],
              ]
            : [
                [0, -1],
                [-1, 0],
                [0, 0],
                [1, 0],
                [-1, 1],
                [1, 1],
              ];
      for (const [dx, dy] of pts) p.set(Math.round(gx) + dx, Math.round(gy) + dy, g4);
    }
    // Печать посередине.
    for (const [dx, dy] of [
      [0, -2],
      [-1, -1],
      [1, -1],
      [-2, 0],
      [2, 0],
      [-1, 1],
      [1, 1],
      [0, 2],
    ] as [number, number][])
      p.set(c + dx, c + dy, g4);
    p.set(c, c, g2);
    return p;
  });
}

/** Нити щёлкают волной от короля: от ближней до дальней — столько секунд. */
const GRID_SNAP = 0.12;

registerZonePainter(
  'f12_grid',
  guarded((g, zz: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const z = zz as GridZone;
    const v = z.f12;
    if (!v) return;
    const W = KING.gridWarn;
    const tw = z.t;
    const k = k01(tw / W);
    const left = W - tw;
    const sig = left < SIG && left > 0;
    const tk = !reduced() && tick(left);
    const tc = tw - W;
    if (tc > v.cut + 0.25) return;
    const p = new Pen(g, px, py, z.x * S, z.y * S, true, S);
    const wards = wardsNow();
    const th = threadsCached(v, wards, S);
    const N = th.length;
    if (tc < 0) {
      // Опасно ВЕЗДЕ в зале, кроме оберегов (урон — по всей арене, а не по
      // нитям): зал наливается тусклым кармином, круги оберегов — дыры.
      const dk = 0.06 + 0.16 * k + (sig ? (tk ? 0.14 : 0.07) : 0);
      arenaWash(p, v, wards, S, sig ? C.hot : C.cr, dk);
      // Метка: нити тянутся от стен, сходятся, натягиваются.
      const tight = k01((k - 0.55) / 0.4);
      const A = 2.6 * (1 - tight);
      for (let i = 0; i < N; i++) {
        const t = th[i];
        // Ближние к середине зала — первыми: нити расходятся от центра.
        const d0 = (Math.abs(i - (t.hz ? N * 0.75 : N * 0.25)) / N) * 0.5;
        const ext = eOut2(k01((k - d0) / 0.4));
        if (ext <= 0) continue;
        const mid = (t.a + t.b) / 2;
        const r0 = t.a + (mid - t.a) * ext;
        const r1 = t.b - (t.b - mid) * ext;
        // На кровавом полу храма кармин тонет — нить светлее: роза → розовый.
        const col = sig ? (tk ? C.white : C.pink) : tight > 0.6 ? C.pink : C.rose;
        p.col(col, sig ? 1 : 0.6 + 0.4 * k);
        const ph = time * 5 + i * 1.7;
        for (const [s0, s1] of t.segs) {
          // Кусок, до которого дотянулась нить: от стены к середине.
          const parts: [number, number][] = [
            [s0, Math.min(s1, r0)],
            [Math.max(s0, r1), s1],
          ];
          for (const [q0, q1] of parts) {
            if (q1 <= q0) continue;
            if (A < 0.5) axisRun(p, t, q0, q1);
            else
              swayRun(p, t, q0, q1, (s) => {
                const u = (s - t.a) / (t.b - t.a);
                return A * Math.sin(u * Math.PI * 3 + ph) * Math.sin(Math.PI * u);
              });
          }
        }
        // Офуда у стен, к которым привязана нить.
        const sw = Math.sin(time * 3 + i) > 0.6 ? 1 : 0;
        for (const e of [t.a, t.b]) {
          const ex = t.hz ? e : t.c;
          const ey = t.hz ? t.c : e;
          ofuda(
            p,
            ex + (t.hz ? (e === t.a ? 2 : -2) : 0),
            ey + (t.hz ? 0 : e === t.a ? 8 : -1),
            sw,
          );
        }
        // У оберега нить упирается в круг — золотая бусина.
        if (ext > 0.95) {
          p.col(Math.floor(time * 10 + i) & 1 ? C.gold[4] : C.gold[3], 1);
          for (const [s0, s1, wa, wb] of t.segs) {
            if (wa) p.dot(t.hz ? s0 - 1 : t.c - 1, t.hz ? t.c - 1 : s0 - 1, undefined, 2, 2);
            if (wb) p.dot(t.hz ? s1 - 1 : t.c - 1, t.hz ? t.c - 1 : s1 - 1, undefined, 2, 2);
          }
        }
      }
      // Узлы на пересечениях — когда сетка натянута.
      if (tight > 0.3) {
        p.col(sig ? C.white : C.pink, 0.9);
        for (const a of th)
          if (!a.hz)
            for (const b of th)
              if (b.hz) {
                const inSeg = (t: Thread, s: number) =>
                  t.segs.some(([s0, s1]) => s >= s0 && s <= s1);
                if (!inSeg(a, b.c) || !inSeg(b, a.c)) continue;
                p.dot(a.c - 1, b.c - 1, undefined, 2, 2);
              }
      }
      return;
    }
    // Разрез: нити щёлкают разом — волной от короля за 0,12 с. Каждая: белая
    // полоса в 3 пикселя, потом щель (пустота с белыми губами), алый след.
    const fadeAll = 1 - k01((tc - v.cut) / 0.25);
    const km = kingNow();
    const kx = (km ? km.x : z.x) * S;
    const ky = (km ? km.y : z.y) * S;
    let dmax = 1;
    for (const t of th) dmax = Math.max(dmax, Math.abs(t.c - (t.hz ? ky : kx)));
    const few = reduced();
    // Каждая клетка сетки рассечена наискось — разрезано всё, кроме кругов.
    cellSlashes(p, v, wards, S, kx, ky, tc, fadeAll);
    for (let i = 0; i < N; i++) {
      const t = th[i];
      const ta = tc - GRID_SNAP * (Math.abs(t.c - (t.hz ? ky : kx)) / dmax);
      for (const [s0, s1, wa, wb] of t.segs) {
        if (ta < 0) {
          p.col(C.pink, 0.9);
          axisRun(p, t, s0, s1);
          continue;
        }
        if (ta < 0.04) {
          p.col(C.white, 1);
          for (const o of [-1, 0, 1]) axisRun(p, t, s0, s1, o);
        } else if (ta < 0.16) {
          const o = ta < 0.1 ? 2 : 1;
          p.col(C.groove, 1);
          for (let q = -(o - 1); q <= o - 1; q++) axisRun(p, t, s0, s1, q);
          p.col(ta < 0.1 ? C.white : C.pink, 1);
          axisRun(p, t, s0, s1, -o);
          axisRun(p, t, s0, s1, o);
        } else {
          p.col(ta < 0.3 ? C.hot : ta < 0.5 ? C.cr : C.crMd, (ta < 0.3 ? 1 : 0.7) * fadeAll);
          axisRun(p, t, s0, s1, 0);
        }
        // У оберега нить не прошла — золотые искры от круга.
        for (const [s, isW, dir] of [
          [s0, wa, -1],
          [s1, wb, 1],
        ] as [number, boolean, number][]) {
          if (!isW) continue;
          const x = t.hz ? s : t.c;
          const y = t.hz ? t.c : s;
          const an = t.hz ? (dir < 0 ? 0 : Math.PI) : dir < 0 ? Math.PI / 2 : -Math.PI / 2;
          sparks(
            p,
            (i * 31 + Math.floor(s)) >>> 0,
            ta,
            x,
            y,
            few ? 2 : 5,
            an,
            0.9,
            30,
            40,
            0.35,
            30,
            (q) => (q < 0.3 ? C.white : q < 0.6 ? C.gold[4] : C.gold[3]),
          );
        }
      }
    }
  }),
);

registerZonePainter(
  'f12_ward',
  guarded((g, zz: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const z = zz as Zone;
    const cx = z.x * S;
    const cy = z.y * S;
    const p = new Pen(g, px, py, cx, cy, true, S);
    const R = z.r * S;
    const W = KING.gridWarn;
    const CUT = KING.gridCut;
    const all = wardsNow();
    const idx = Math.max(0, all.indexOf(z));
    const t = z.t;
    const ti = 0.06 + idx * 0.14;
    const lit = k01((t - ti) / 0.12);
    const out = k01((t - (W + CUT)) / 0.4);
    const a = 1 - out;
    if (a <= 0) return;
    // «Куда»: круг виден сразу — защита действует с первого кадра.
    if (lit < 1) {
      p.col(C.gold[3], 0.6 * a);
      ring(p, cx, cy, R, (an, i) => (i & 3) < 2);
    }
    if (lit <= 0) return;
    // Зажглось: вспышка кольцом от середины к краю.
    if (lit < 1) {
      p.col(C.white, 1 - lit);
      ring(p, cx, cy, R * (0.3 + 0.7 * lit));
      p.col(C.gold[4], 0.4 * (1 - lit));
      fillOval(p, cx, cy, R * lit, R * lit);
    }
    // Пол оберега — золотой свет шахматкой (гуще к кромке), знаки, печать;
    // дышит прозрачностью. Двойная кромка, узор ходит.
    const fl = wardFloor(R);
    p.alpha(a * (0.78 + 0.22 * Math.sin(time * 4 + idx)));
    p.img(fl, cx - (fl.width - 1) / 2, cy - (fl.height - 1) / 2, cy - (fl.height - 1) / 2);
    const cutting = t >= W && t < W + CUT;
    const flare = cutting ? 1 - k01((t - W) / 0.18) : 0;
    p.col(flare > 0 ? C.white : C.gold[4], a);
    ring(p, cx, cy, R);
    if (flare > 0.3) ring(p, cx, cy, R + 1);
    p.col(C.gold[2], 0.9 * a);
    ring(p, cx, cy, R - 4, (an) => mod(an - time * 0.9, TAU / 8) < TAU / 13);
    // Руны между кольцами.
    p.col(C.gold[3], a);
    for (let i = 0; i < 6; i++) {
      const an = -time * 0.5 + (i / 6) * TAU;
      const rx = cx + Math.cos(an) * (R - 2);
      const ry = cy + Math.sin(an) * (R - 2);
      p.dot(rx, ry, undefined, 1, 1);
      p.dot(rx + Math.cos(an + 1.57), ry + Math.sin(an + 1.57));
    }
    // Свет оберега поднимается мотыльками.
    if (!reduced())
      for (let i = 0; i < 6; i++) {
        const ph = mod(time * 0.8 + i / 6, 1);
        const an = (i / 6) * TAU + idx;
        const mx = cx + Math.cos(an) * R * 0.7;
        const my = cy + Math.sin(an) * R * 0.7;
        p.col(C.gold[4], (1 - ph) * 0.8 * a);
        p.dot(mx + Math.sin(time * 3 + i) * 1.5, my - ph * 20, my);
      }
    // Купол: в разрез вспыхивает над кругом.
    if (flare > 0) {
      p.col(C.white, flare);
      ring(p, cx, cy - R * 0.2, R * 1.05, (an) => an < -0.15 && an > -Math.PI + 0.15, cy);
      p.col(C.gold[4], 0.6 * flare);
      ring(
        p,
        cx,
        cy - R * 0.2,
        R * 0.85,
        (an, i) => an < -0.3 && an > -Math.PI + 0.3 && (i & 1) === 0,
        cy,
      );
    }
    // Четыре офуда по сторонам; после разреза сгорают снизу вверх.
    const burn = k01((t - (W + CUT)) / 0.35);
    for (let i = 0; i < 4; i++) {
      const an = (i / 4) * TAU + Math.PI / 4;
      const ox = cx + Math.cos(an) * (R + 1);
      const oy = cy + Math.sin(an) * (R + 1) * 0.92;
      const sw = Math.sin(time * 2.6 + i * 1.3 + idx) > 0.55 ? 1 : 0;
      ofuda(p, ox, oy, sw, burn > 0 ? k01(burn * 1.2 - i * 0.08) : 0);
    }
    if (burn > 0)
      shreds(
        p,
        (z.id >>> 0) + 5,
        t - (W + CUT),
        reduced() ? 2 : 6,
        (i) => 0.05 + (i & 3) * 0.06,
        (i) => {
          const an = ((i & 3) / 4) * TAU + Math.PI / 4;
          return [cx + Math.cos(an) * (R + 1), cy + Math.sin(an) * (R + 1) * 0.92 - 4, an];
        },
        10,
        0.6,
        2,
      );
  }),
);

/** Сетка для контакта: снимается с зоны в миг удара (зона скоро исчезнет). */
const gridSnap = new Map<
  number,
  { v: GridView; wards: { x: number; y: number }[]; zx: number; zy: number }
>();

registerImpactPainter('f12_gridcut', {
  life: 1.6,
  shake: 0.15,
  flash: 0.28,
  flashRgb: '255,205,220',
  above: true,
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const sd = rec.seed >>> 0;
    let snap = gridSnap.get(sd);
    if (!snap) {
      const sim = paintSim();
      const gz = sim?.zones.find((q) => q.art === 'f12_grid') as GridZone | undefined;
      if (!gz?.f12) return;
      snap = { v: gz.f12, wards: wardsNow().map((w) => ({ x: w.x, y: w.y })), zx: gz.x, zy: gz.y };
      if (gridSnap.size > 8) gridSnap.delete(gridSnap.keys().next().value as number);
      gridSnap.set(sd, snap);
    }
    const p = new Pen(g, px, py, rec.x * S, rec.y * S, true, S);
    const th = threadsCached(snap.v, snap.wards, S);
    const few = reduced();
    const lip = C.lipBlood;
    // Рубцы по всем нитям.
    const fade = 1 - k01((age - 0.9) / 0.6);
    if (fade > 0)
      for (const t of th)
        for (const [s0, s1] of t.segs) {
          p.col(lip, 0.6 * fade);
          axisRun(p, t, s0, s1, 1);
          p.col(age < 0.35 ? C.crMd : C.groove, fade);
          axisRun(p, t, s0, s1, 0);
        }
    // Обрывки и пыль — только у нитей в кадре.
    for (const [j, t] of th.entries()) {
      const vis = t.hz ? t.c >= p.y0 - 8 && t.c <= p.y1 + 8 : t.c >= p.x0 - 8 && t.c <= p.x1 + 8;
      if (!vis) continue;
      const seg = t.segs;
      if (!seg.length) continue;
      const n = few ? 2 : 6;
      const at = (i: number): [number, number, number] => {
        const sg = seg[Math.floor(hash(sd + j, i, 91) * seg.length)];
        const s = sg[0] + (sg[1] - sg[0]) * hash(sd + j, i, 92);
        const side = i & 1 ? 1 : -1;
        return t.hz ? [s, t.c, (side * Math.PI) / 2] : [t.c, s, side > 0 ? 0 : Math.PI];
      };
      shreds(
        p,
        sd + j * 13,
        age,
        n,
        (i) => 0.02 + hash(sd + j, i, 93) * 0.12,
        at,
        30,
        1.2,
        (j & 1) * 1,
      );
      dust(
        p,
        sd + j * 17,
        age,
        0,
        0,
        few ? 1 : 2,
        0,
        0.6,
        5,
        6,
        1.5,
        4,
        5,
        0.8,
        4,
        0.5,
        (i) => 0.03 + i * 0.05,
        (i) => at(i + 20),
      );
    }
  }),
});

// =============================================================================
// ХРАМ — `f12_shrine` (зона на помосте, пол): встаёт из пола за 1,2 с, пока
// развёрнут — ДЫШИТ: нижняя челюсть пасти опускается на 0…2 пикселя, горло
// разгорается, на выдохе из пасти идёт пар проклятия и угольки, глаза
// вспыхивают. Подъём и уход — трещина по линии пола, пыль, крошка.
// От трёх чаш к храму идут жилы: по ним бегут сгустки — чаши держат храм;
// разбитая чаша рвёт жилу (половинки хлещут к концам, искры на разрыве).
// =============================================================================

/** Пасть в спрайте храма (`shrinePx`): центр и полуоси. */
const MOUTH = { x: SHRINE_W / 2, y: 58, rx: 17, ry: 12.5 };

/**
 * Храм с опущенной челюстью `jaw` (0…2 пикселя) и кадром глаз `f`: нижняя
 * половина пасти с зубами сдвигается вниз, в щели — раскалённое горло.
 */
function shrineBreath(jaw: number, f: number): HTMLCanvasElement {
  return sprite(95000 + jaw * 2 + (f & 1), () => {
    const base = shrinePx(f & 1);
    const out = new Px(base.w, base.h);
    out.data.set(base.data);
    if (jaw <= 0) return out;
    const { x: cx, y: my, rx, ry } = MOUTH;
    const inMouth = (x: number, y: number, grow: number) =>
      ((x + 0.5 - cx) / (rx + grow)) ** 2 + ((y + 0.5 - my) / (ry + grow)) ** 2 <= 1;
    const throat = (x: number, y: number): RGBA => {
      const d = Math.hypot((x + 0.5 - cx) / rx, (y + 0.5 - my) / ry);
      const hot = 1 - d;
      return hot > 0.45
        ? hx('#ffb070')
        : hot > 0.25
          ? hx('#ff5a3a')
          : hot > 0.08
            ? hx('#c01a24')
            : hx('#5a0810');
    };
    // Горло под нижней половиной пасти.
    for (let y = Math.floor(my); y < base.h; y++)
      for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++)
        if (inMouth(x, y, 0.6)) out.set(x, y, throat(x, y));
    // Челюсть (нижняя половина пасти с зубами) — ниже на `jaw`.
    for (let y = base.h - 1; y >= Math.floor(my); y--)
      for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
        if (!inMouth(x, y, 0.6)) continue;
        const i = (y * base.w + x) * 4;
        if (!base.data[i + 3]) continue;
        // Зубы и кромку — да, само горло — нет (оно уже раскалено).
        const r = base.data[i];
        const gch = base.data[i + 1];
        const isTooth = r > 150 && gch > 120;
        const isRim = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - my) / ry) ** 2 > 0.82;
        if (!isTooth && !isRim) continue;
        out.set(x, y + jaw, [r, gch, base.data[i + 2], 255]);
      }
    return out;
  });
}

/** Жилы чаш: от чаши к храму, сгустки бегут к храму. */
function tethers(p: Pen, sx: number, sy: number, S: number, time: number): void {
  const sim = paintSim();
  if (!sim) return;
  for (const m of sim.mobs) {
    if (m.kind !== 'f12_pillar' || !(m.data.bowl ?? 0)) continue;
    const bx = m.x * S;
    const by = m.y * S - 2;
    // Дуга: прогиб в сторону от прямой — жила, а не луч.
    const dx = sx - bx;
    const dy = sy - by;
    const L = Math.hypot(dx, dy) || 1;
    const mx = (bx + sx) / 2 - (dy / L) * L * 0.08;
    const my = (by + sy) / 2 + (dx / L) * L * 0.08;
    const at = (u: number): [number, number] => {
      const a = (1 - u) * (1 - u);
      const b = 2 * (1 - u) * u;
      const c = u * u;
      return [a * bx + b * mx + c * sx, a * by + b * my + c * sy];
    };
    let u0 = 0;
    const u1 = 1;
    let alpha = 1;
    let snap = -1;
    if (m.mode === 'f12_rise') u0 = 1 - eOut2(k01(m.t / 0.55));
    else if (m.mode === 'dying') {
      snap = m.t;
      if (snap > 0.45) continue;
    } else if (m.mode === 'escape') alpha = 1 - k01(m.t / 0.35);
    if (alpha <= 0) continue;
    const seg = 28;
    const draw = (a0: number, a1: number, col: string, al: number, o: number) => {
      p.col(col, al * alpha);
      for (let i = 0; i < seg; i++) {
        const ua = a0 + ((a1 - a0) * i) / seg;
        const ub = a0 + ((a1 - a0) * (i + 1)) / seg;
        const [xa, ya] = at(ua);
        const [xb, yb] = at(ub);
        p.line(xa, ya + o, xb, yb + o);
      }
    };
    if (snap < 0) {
      draw(u0, u1, C.groove, 0.8, 1);
      draw(u0, u1, C.cr, 0.95, 0);
      // Сгустки к храму.
      p.col(C.pink, alpha);
      for (let j = 0; j < 6; j++) {
        const u = mod(time * (48 / L) + j / 6 + (m.id % 7) * 0.13, 1);
        if (u < u0) continue;
        const [x, y] = at(u);
        p.dot(x - 1, y - 1, undefined, 2, 2);
      }
    } else {
      // Разрыв посередине: половинки хлещут к концам и гаснут.
      const r = eOut2(k01(snap / 0.3));
      const fa = 1 - k01((snap - 0.15) / 0.3);
      const wob = (1 - r) * 3;
      p.col(C.hot, fa);
      for (const [a0, a1] of [
        [0, 0.5 - 0.5 * r],
        [0.5 + 0.5 * r, 1],
      ] as [number, number][]) {
        if (a1 <= a0) continue;
        for (let i = 0; i < seg; i++) {
          const ua = a0 + ((a1 - a0) * i) / seg;
          const ub = a0 + ((a1 - a0) * (i + 1)) / seg;
          const [xa, ya] = at(ua);
          const [xb, yb] = at(ub);
          const o = Math.round(Math.sin(ua * 30 + snap * 40) * wob);
          p.line(xa, ya + o, xb, yb + o);
        }
      }
      const [cx0, cy0] = at(0.5);
      sparks(p, m.id >>> 0, snap, cx0, cy0, 8, 0, Math.PI, 30, 40, 0.35, 40, curseCol);
    }
  }
}

registerZonePainter(
  'f12_shrine',
  guarded((g, zz: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const z = zz as Zone;
    const k = F12_FX.domain;
    const cx = z.x * S;
    const cy = z.y * S;
    const p = new Pen(g, px, py, cx, cy, false, S);
    // Жилы чаш — на полу, под храмом и под телами.
    tethers(p, cx, cy, S, time);
    if (k <= 0) return;
    const sd = idOf(z) * 5 + 11;
    // Дыхание: период 2,8 с; челюсть 0…2 пикселя, на вдохе горло разгорается.
    const br = 0.5 - 0.5 * Math.cos((time / 2.8) * TAU);
    const jaw = k < 1 ? 0 : Math.round(br * 2);
    const img = shrineBreath(jaw, br > 0.7 ? 1 : 0);
    // Встаёт из пола: сперва крыша, потом пасть.
    const hk = Math.max(1, Math.round(img.height * eOut2(k)));
    const X = Math.floor(cx - SHRINE_W / 2);
    const Y = Math.floor(cy) - hk;
    g.globalAlpha = 1;
    g.drawImage(img, 0, 0, img.width, hk, X + p.qx, Y + p.qy, img.width, hk);
    const few = reduced();
    // Подъём и уход: трещина по линии пола, пыль, крошка.
    const moving = k < 1;
    const zt = z.t;
    if (moving || zt < 1.6) {
      const mv = moving ? 1 : 1 - k01((zt - 1.2) / 0.4);
      p.col(C.groove, 0.9 * mv);
      p.run(X - 4, X + SHRINE_W + 4, Math.floor(cy) + 1);
      p.col(C.crHi, 0.8 * mv * (Math.floor(time * 16) & 1 ? 1 : 0.6));
      p.run(X + 2, X + SHRINE_W - 2, Math.floor(cy));
      dust(
        p,
        sd,
        mod(zt, 0.6),
        cx,
        cy,
        few ? 3 : 8,
        -Math.PI / 2,
        1.3,
        6,
        10,
        3,
        8,
        6,
        0.6,
        bloodFloor() ? 4 : 0,
        0.6 * mv,
        undefined,
        (i) => [X + (SHRINE_W * (i + 0.5)) / 8, cy, i < 4 ? Math.PI * 0.9 : Math.PI * 0.1],
      );
      chunks(
        p,
        sd + 1,
        mod(zt, 0.6),
        cx,
        cy,
        few ? 2 : 5,
        -Math.PI / 2,
        1.2,
        14,
        18,
        40,
        30,
        [0.45, 0.6],
        0.3,
        3,
        undefined,
        (i) => [X + SHRINE_W * hash(sd, i, 7), cy, -Math.PI / 2],
      );
    }
    if (k < 1) return;
    // Выдох: пар проклятия и угольки из пасти.
    const mx = X + MOUTH.x;
    const my = Y + MOUTH.y + 2;
    const exhale = Math.sin((time / 2.8) * TAU) < 0;
    if (!few) {
      for (let i = 0; i < 4; i++) {
        const ph = mod(time * 0.55 + i / 4, 1);
        const side = i & 1 ? 1 : -1;
        const im = puffImg(2, 2 + 4 * ph, i);
        p.alpha((exhale ? 0.55 : 0.25) * (1 - ph));
        p.img(im, mx + side * (4 + 18 * ph) - im.width / 2, my - 2 - 16 * ph - im.height / 2);
      }
      embers(
        p,
        sd,
        mod(time, 2.8),
        10,
        1.1,
        26,
        (i) => i * 0.26,
        (i) => [mx + (hash(sd, i, 3) - 0.5) * 20, my],
        exhale ? 1 : 0.6,
        curseCol,
      );
    }
  }),
);

// =============================================================================
// ВОЛНА ПЕРЕПИСИ ЗАЛА — `f12v_wave` (зона-картинка, ставит мозг): клетки
// арены меняются кольцами по 2,2 клетки каждые 0,09 с от помоста — фронт
// идёт ровно по ним. Вперёд — кромка проклятого пламени: кармин с белой
// гранью, языки, впереди — брызги тьмы, за фронтом оседает красный туман,
// крошка летит наружу. Назад (храм рухнул или иссяк) — светлая кромка
// сходится к помосту, пыль, зал возвращается. Всё — внутри арены.
// =============================================================================

/** Буфер точек дуги волны (один на кадр). */
const ARC: number[] = [];

registerZonePainter(
  'f12v_wave',
  guarded((g, zz: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const z = zz as VZone;
    const cx = z.x * S;
    const cy = z.y * S;
    const p = new Pen(g, px, py, cx, cy, true, S);
    const back = (z.vBack ?? 0) > 0;
    const Rmax = z.r * S;
    const v = (2.2 * S) / 0.09;
    const R = back ? Rmax - v * z.t : v * z.t;
    const end = back ? R <= 0 : R >= Rmax;
    const fade = end ? 1 - k01((back ? -R : R - Rmax) / (v * 0.4)) : 1;
    if (fade <= 0 || (R < 1 && back)) return;
    // Только внутри арены.
    const x0 = (z.vX0 ?? -1e4) * S;
    const y0 = (z.vY0 ?? -1e4) * S;
    const x1 = (z.vX1 ?? 1e4) * S;
    const y1 = (z.vY1 ?? 1e4) * S;
    g.beginPath();
    g.rect(x0 + p.qx, y0 + p.qy, x1 - x0, y1 - y0);
    g.clip();
    const sd = 7717;
    const few = reduced();
    const inView = (an: number, r: number) => {
      const x = cx + Math.cos(an) * r;
      const y = cy + Math.sin(an) * r;
      return x > p.x0 - 12 && x < p.x1 + 12 && y > p.y0 - 30 && y < p.y1 + 12;
    };
    // Видимая часть кольца — одна на кадр; узор пунктира — от угла (не
    // «кипит», пока кольцо растёт).
    const arc = arcView(p, cx, cy, R, ARC);
    const cell = (an: number, w: number) => Math.floor((mod(an, TAU) * Math.max(1, R)) / w);
    if (!back) {
      // Брызги тьмы впереди фронта.
      p.col(C.groove, 0.8 * fade);
      arcDraw(p, arc, 3, (an) => hash(cell(an, 2), 3, 7) > 0.55);
      // Кромка: белая грань, кармин, тёмный край.
      p.col(C.white, fade);
      arcDraw(p, arc, 1, (an) => hash(cell(an, 1), 5, 7) > 0.35);
      p.col(C.hot, fade);
      arcDraw(p, arc, 0);
      p.col(C.cr, fade);
      arcDraw(p, arc, -1);
      p.col(C.crMd, 0.8 * fade);
      arcDraw(p, arc, -3, (an) => (cell(an, 1) & 1) === 0);
      // Языки проклятого пламени по кромке.
      const step = 13 / Math.max(13, R);
      for (let an = mod(time * 0.05, step); an < TAU; an += step) {
        if (!inView(an, R)) continue;
        const x = cx + Math.cos(an) * R;
        const y = cy + Math.sin(an) * R;
        const j = Math.floor(an / step);
        const h = (6 + 8 * hash(j, 9, 1)) * fade;
        if (h < 3) continue;
        const im = flameImg(h, Math.floor(time * 14 + j), 1);
        p.alpha(0.95);
        p.img(im, x - im.width / 2, y - im.height + 1, y);
      }
      // Красный туман за фронтом.
      if (!few)
        for (let i = 0; i < 24; i++) {
          const an = hash(sd, i, 1) * TAU;
          const born = hash(sd, i, 2) * 1.2;
          const tt = z.t - born;
          if (tt < 0 || tt > 0.9) continue;
          const rr = v * born - 6;
          if (rr < 0 || !inView(an, rr)) continue;
          const im = puffImg(2, 3 + 5 * (tt / 0.9), i);
          p.alpha(0.5 * (1 - tt / 0.9) * fade);
          p.img(
            im,
            cx + Math.cos(an) * rr - im.width / 2,
            cy + Math.sin(an) * rr - im.height / 2 - 8 * tt,
          );
        }
    } else {
      // Назад: светлая кромка сходится к помосту, пыль поднимается.
      p.col(C.white, 0.9 * fade);
      arcDraw(p, arc, 0);
      p.col('#c8c0d0', 0.7 * fade);
      arcDraw(p, arc, 2, (an) => (cell(an, 1) & 1) === 0);
      if (!few)
        for (let i = 0; i < 28; i++) {
          const an = hash(sd, i, 4) * TAU;
          const born = hash(sd, i, 5) * 1.2;
          const tt = z.t - born;
          if (tt < 0 || tt > 0.8) continue;
          const rr = Rmax - v * born + 4;
          if (rr < 0 || !inView(an, rr)) continue;
          const im = puffImg(5, 2 + 4 * (tt / 0.8), i);
          p.alpha(0.55 * (1 - tt / 0.8) * fade);
          p.img(
            im,
            cx + Math.cos(an) * rr - im.width / 2,
            cy + Math.sin(an) * rr - im.height / 2 - 10 * tt,
          );
        }
    }
  }),
);

// =============================================================================
// ЗНАК — `f12v_cast` (фаза 2, 2,6 с): король идёт на помост и складывает
// знак. У ног вычерчивается печать: кольцо замыкается по ходу знака, знаки
// загораются по одному, внутреннее кольцо идёт навстречу; к рукам по спирали
// стягиваются огни проклятия; когда пояс раскрылся (1,2 с) — от ног бегут
// раскалённые трещины. Последние 0,2 с — всё белое: сейчас развернётся храм.
// =============================================================================

registerZonePainter(
  'f12v_cast',
  guarded((g, zz: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const z = zz as VZone;
    const sim = paintSim();
    const m = sim?.mobs.find((q) => q.id === z.vFrom) ?? null;
    if (sim && (!m || m.mode !== 'f12_cast')) return;
    const T = KING.cast;
    const t = m ? m.t : z.t;
    const kx = (m ? m.x : z.x) * S;
    const ky = (m ? m.y : z.y) * S;
    const p = new Pen(g, px, py, z.x * S, z.y * S, true, S);
    const R = z.r * S;
    const left = T - t;
    const sig = left < SIG;
    const tk = !reduced() && tick(left);
    const sd = 4243;
    // Печать: бледный круг сразу, кольцо замыкается.
    p.col(C.crHi, 0.3);
    ring(p, kx, ky, R, (an, i) => (i & 3) === 0);
    const span = TAU * eInOut(k01(t / (T - 0.3)));
    p.col(sig ? (tk ? C.white : C.pink) : C.hot, 1);
    ring(p, kx, ky, R, (an) => inArc(an, -Math.PI / 2, span));
    ring(p, kx, ky, R, (an) => inArc(an, -Math.PI / 2, span), undefined, -1);
    if (t > 0.5) {
      p.col(sig ? C.white : C.rose, 0.8);
      ring(p, kx, ky, R - 6, (an) => mod(an + time * 1.4, TAU / 10) < TAU / 18);
    }
    // Знаки загораются по одному.
    for (let i = 0; i < 8; i++) {
      if (t < 0.15 + i * 0.27) continue;
      const an = -Math.PI / 2 + (i / 8) * TAU;
      const gx = Math.floor(kx + Math.cos(an) * (R - 3));
      const gy = Math.floor(ky + Math.sin(an) * (R - 3));
      const fresh = k01((t - 0.15 - i * 0.27) / 0.15);
      p.col(fresh < 1 ? C.white : sig ? C.white : C.pink, 1);
      p.dot(gx - 1, gy, undefined, 3, 1);
      p.dot(gx, gy - 1, undefined, 1, 3);
    }
    // Трещины от ног, когда раскрылся пояс.
    if (t > 1.2) {
      const cr = crackOf(
        'cast',
        sd,
        starBranches(sd, 8, 0.3, R * 0.7, R * 1.25, 2),
        0.5,
        0.25,
        0.5,
      );
      const reach = cr.max * eOut2(k01((t - 1.2) / 1.1));
      const pulse = 0.5 + 0.5 * Math.sin(time * 9);
      drawCrack(p, cr, kx, ky, reach, sig ? C.white : pulse > 0.5 ? C.hot : C.cr, C.groove, 0.95);
    }
    // Огни проклятия стягиваются к рукам по спирали.
    const hx0 = kx;
    const hy0 = ky - 30;
    const n = reduced() ? 6 : 16;
    const per = t > 1.2 ? 0.45 : 0.7;
    for (let i = 0; i < n; i++) {
      const ph = mod(t / per + i / n, 1);
      const an = hash(sd, i, 3) * TAU + ph * 2.4;
      const rr = (46 - 44 * eIn2(ph)) * (0.7 + 0.3 * hash(sd, i, 4));
      p.col(curseCol(1 - ph), 0.4 + 0.6 * ph);
      p.dot(hx0 + Math.cos(an) * rr, hy0 + Math.sin(an) * rr * 0.75, ky + 1);
    }
  }),
);

// =============================================================================
// ВСТУПЛЕНИЕ — `f12v_intro` (2,6 с, король недосягаем): сидит — вокруг
// поднимаются огни проклятия; встаёт на колено — под коленом трескается
// пол; встаёт с оскалом (1,95 с) — две ударные волны, кольцо пыли, звезда
// трещин и обрывки бумаги разлетаются.
// =============================================================================

registerZonePainter(
  'f12v_intro',
  guarded((g, zz: Zone | Strike, px: number, py: number, S: number) => {
    const z = zz as VZone;
    const m = paintSim()?.mobs.find((q) => q.id === z.vFrom) ?? null;
    const kx = (m ? m.x : z.x) * S;
    const ky = (m ? m.y : z.y) * S;
    const p = new Pen(g, px, py, z.x * S, z.y * S, true, S);
    const t = z.t;
    const sd = 9091;
    const few = reduced();
    const ROAR = KING.intro * 0.75;
    const KNEE = KING.intro * 0.5;
    // Огни поднимаются вокруг сидящего.
    if (t < ROAR + 0.3)
      embers(
        p,
        sd,
        t,
        few ? 6 : 18,
        0.9,
        24,
        (i) => (i / 18) * ROAR,
        (i) => {
          const an = hash(sd, i, 1) * TAU;
          return [kx + Math.cos(an) * 18, ky + Math.sin(an) * 6];
        },
        1,
        curseCol,
      );
    // Колено — трещина под ним.
    if (t > KNEE) {
      const cr = crackOf('introK', sd + 1, starBranches(sd + 1, 4, 0, 6, 12, 1), 0.6);
      drawCrack(
        p,
        cr,
        kx + 4,
        ky,
        cr.max * eOut2(k01((t - KNEE) / 0.2)),
        C.groove,
        bloodFloor(z.x, z.y) ? C.lipBlood : C.lipStone,
        1 - k01((t - KING.intro - 0.4) / 0.6),
      );
      dust(
        p,
        sd + 2,
        t - KNEE,
        kx + 4,
        ky,
        few ? 1 : 3,
        0,
        Math.PI,
        6,
        8,
        1.5,
        4,
        3,
        0.6,
        bloodFloor(z.x, z.y) ? 4 : 0,
        0.6,
      );
    }
    // Рёв: ударные волны, пыль, трещины, обрывки.
    const tr = t - ROAR;
    if (tr >= 0) {
      if (tr < 0.06) {
        p.col(C.white, 1 - tr / 0.06);
        star(p, kx, ky - 30, 10, 6, 0.3, ky);
      }
      for (const [d, col] of [
        [0, C.white],
        [0.08, C.pink],
      ] as [number, string][]) {
        const q = (tr - d) / 0.4;
        if (q < 0 || q > 1) continue;
        p.col(col, 1 - q);
        ring(p, kx, ky, 8 + 80 * eOut2(q), (an, i) => hash(i >> 1, sd, 3) > 0.2);
      }
      const cr = crackOf('introR', sd + 3, starBranches(sd + 3, 7, 0.2, 18, 34, 2), 0.5, 0.25);
      const cf = 1 - k01((tr - 0.6) / 0.5);
      drawCrack(
        p,
        cr,
        kx,
        ky,
        cr.max * eOut2(k01(tr / 0.18)),
        (d) => cutHeat(k01(tr / 0.6 + (d / cr.max) * 0.3)),
        bloodFloor(z.x, z.y) ? C.lipBlood : C.lipStone,
        cf,
      );
      dust(
        p,
        sd + 4,
        tr,
        kx,
        ky,
        few ? 4 : 12,
        0,
        Math.PI,
        40,
        30,
        2,
        6,
        4,
        0.8,
        bloodFloor(z.x, z.y) ? 4 : 0,
        0.65,
        undefined,
        (i) => {
          const an = (i / 12) * TAU;
          return [kx + Math.cos(an) * 8, ky + Math.sin(an) * 4, an];
        },
      );
      shreds(
        p,
        sd + 5,
        tr,
        few ? 3 : 10,
        (i) => i * 0.01,
        (i) => [kx, ky - 6, (i / 10) * TAU],
        60,
        1.2,
        0,
      );
    }
  }),
);

// =============================================================================
// СМЕНА ФАЗЫ — `f12v_phase`: «ПЛАМЯ» (1) — кольцо огня расходится от
// короля, угольки; «ВСЁ СРАЗУ» (3) — двойная карминовая волна, звезда
// трещин, обрывки.
// =============================================================================

registerZonePainter(
  'f12v_phase',
  guarded((g, zz: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const z = zz as VZone;
    const m = paintSim()?.mobs.find((q) => q.id === z.vFrom) ?? null;
    const kx = (m ? m.x : z.x) * S;
    const ky = (m ? m.y : z.y) * S;
    const p = new Pen(g, px, py, z.x * S, z.y * S, true, S);
    const t = z.t;
    const sd = 3131 + (z.vKind ?? 1);
    const few = reduced();
    if (t < 0.06) {
      p.col(C.white, 1 - t / 0.06);
      star(p, kx, ky - 30, 9, 4, 0.8, ky);
    }
    if ((z.vKind ?? 1) === 1) {
      // Кольцо огня.
      const q = k01(t / 0.55);
      const R = 8 + 52 * eOut2(q);
      const n = 18;
      for (let i = 0; i < n; i++) {
        const an = (i / n) * TAU + hash(sd, i, 1) * 0.2;
        const x = kx + Math.cos(an) * R;
        const y = ky + Math.sin(an) * R * 0.85;
        const h = (12 - 8 * q) * (0.7 + 0.5 * hash(sd, i, 2)) * (1 - k01((t - 0.5) / 0.4));
        if (h < 3) continue;
        const im = flameImg(h, Math.floor(time * 14 + i), 0);
        p.alpha(1);
        p.img(im, x - im.width / 2, y - im.height + 1, y);
      }
      sparks(p, sd, t, kx, ky - 10, few ? 6 : 18, 0, Math.PI, 50, 60, 0.7, 120, sparkCol);
    } else {
      for (const [d, col] of [
        [0, C.white],
        [0.07, C.hot],
        [0.14, C.cr],
      ] as [number, string][]) {
        const q = (t - d) / 0.45;
        if (q < 0 || q > 1) continue;
        p.col(col, 1 - q);
        ring(p, kx, ky, 10 + 70 * eOut2(q), (an, i) => hash(i >> 1, sd, 3) > 0.25);
      }
      const cr = crackOf('phase3', sd, starBranches(sd, 8, 0.1, 20, 36, 2), 0.5, 0.25);
      drawCrack(
        p,
        cr,
        kx,
        ky,
        cr.max * eOut2(k01(t / 0.2)),
        (dd) => cutHeat(k01(t / 0.8 + (dd / cr.max) * 0.3)),
        bloodFloor(z.x, z.y) ? C.lipBlood : C.lipStone,
        1 - k01((t - 0.8) / 0.45),
      );
      shreds(
        p,
        sd + 1,
        t,
        few ? 3 : 10,
        (i) => i * 0.012,
        (i) => [kx, ky - 8, (i / 10) * TAU],
        60,
        1.1,
        0,
      );
    }
  }),
);

// =============================================================================
// ПОЕЗД СБИЛ КОРОЛЯ — `f12v_train`: вспышка удара на теле, сноп искр от
// металла, король катится вбок ~2,9 клетки (как отброс мозга: 26 клеток/с с
// затуханием 9) — за ним две борозды и пыль, щебень.
// =============================================================================

registerZonePainter(
  'f12v_train',
  guarded((g, zz: Zone | Strike, px: number, py: number, S: number) => {
    const z = zz as VZone;
    const cx = z.x * S;
    const cy = z.y * S;
    const p = new Pen(g, px, py, cx, cy, true, S);
    const t = z.t;
    const dir = (z.vDir ?? 1) > 0 ? 1 : -1;
    const sd = 2671;
    const few = reduced();
    const slide = (tt: number) => (26 / 9) * (1 - Math.exp(-9 * tt)) * S;
    const d = slide(t);
    const fade = 1 - k01((t - 1.0) / 0.5);
    // Борозды за катящимся телом.
    const lip = bloodFloor(z.x, z.y) ? C.lipBlood : C.lipStone;
    for (const ox of [-5, 4]) {
      p.col(lip, 0.6 * fade);
      p.vrun(
        Math.floor(cx + ox + 1),
        Math.floor(Math.min(cy, cy + dir * d)),
        Math.floor(Math.max(cy, cy + dir * d)),
      );
      p.col(C.groove, fade);
      p.vrun(
        Math.floor(cx + ox),
        Math.floor(Math.min(cy, cy + dir * d)),
        Math.floor(Math.max(cy, cy + dir * d)),
      );
    }
    if (t < 0.08) {
      p.col(C.white, 1 - t / 0.08);
      star(p, cx, cy - 26, 15, 6, 0.4, cy);
      p.col(C.fire[4], 0.8 * (1 - t / 0.08));
      ring(p, cx, cy - 20, 10 + 120 * t);
    }
    sparks(
      p,
      sd,
      t,
      cx,
      cy - 18,
      few ? 10 : 30,
      dir > 0 ? Math.PI / 2 : -Math.PI / 2,
      1.5,
      70,
      110,
      0.6,
      60,
      (k) => (k < 0.3 ? C.white : k < 0.6 ? C.fire[4] : C.fire[3]),
    );
    dust(
      p,
      sd + 1,
      t,
      cx,
      cy,
      few ? 3 : 8,
      -Math.PI / 2,
      1.3,
      6,
      10,
      2,
      6,
      6,
      0.9,
      bloodFloor(z.x, z.y) ? 4 : 0,
      0.6,
      (i) => i * 0.04,
      (i) => [
        cx + (i & 1 ? -6 : 5),
        cy + dir * slide(i * 0.04),
        dir > 0 ? -Math.PI / 2 : Math.PI / 2,
      ],
    );
    chunks(
      p,
      sd + 2,
      t,
      cx,
      cy,
      few ? 2 : 6,
      dir > 0 ? Math.PI / 2 : -Math.PI / 2,
      1.1,
      20,
      30,
      50,
      40,
      [1.0, 1.4],
      0.3,
      bloodFloor(z.x, z.y) ? 1 : 0,
    );
  }),
);

// =============================================================================
// ШАГ — `f12v_step` (король идёт): след ступни, щепоть пыли назад и две
// искорки проклятия — не чаще 2,4 раза в секунду, живёт 0,9 с.
// =============================================================================

registerZonePainter(
  'f12v_step',
  guarded((g, zz: Zone | Strike, px: number, py: number, S: number) => {
    const z = zz as VZone;
    const side = (z.vKind ?? 0) > 0 ? 1 : -1;
    const a = z.vAng ?? 0;
    const cx = z.x * S - Math.sin(a) * 3 * side;
    const cy = z.y * S + 1 + Math.cos(a) * 2 * side;
    const p = new Pen(g, px, py, z.x * S, z.y * S, true, S);
    const t = z.t;
    const k = t / Math.max(0.1, z.life);
    p.col(C.groove, 0.45 * (1 - k));
    p.dot(cx - 1, cy, undefined, 3, 1);
    const im = puffImg(bloodFloor(z.x, z.y) ? 4 : 0, 1.5 + 2 * eOut2(k), (z.id >>> 0) & 3);
    p.alpha(0.45 * (1 - k));
    p.img(im, cx - Math.cos(a) * 6 * eOut2(k) - im.width / 2, cy - 3 * k - im.height / 2, cy);
    p.col(curseCol(0.4 + 0.6 * k), 1 - k);
    p.dot(cx + 2, cy - 2 - 10 * k, cy);
    p.dot(cx - 2, cy - 4 - 7 * k, cy);
  }),
);

// =============================================================================
// Прогрев: спрайты техник первой фазы и храма — по одному за шаг, пока король
// в мире (рендер тратит до 3 мс за кадр). Иначе первый разрез, первый столб
// и первая волна собирали бы спрайты прямо в бою.
// =============================================================================

registerMobWarm('f12boss', function* () {
  for (let pal = 0; pal < 3; pal++)
    for (let h = 3; h <= 24; h++)
      for (let f = 0; f < 4; f++) {
        flameImg(h, f, pal);
        if ((f & 1) === 1) yield;
      }
  for (const pal of [0, 1, 2, 3, 4, 5])
    for (let r = 1; r <= 12; r++) {
      for (let v = 0; v < 4; v++) puffImg(pal, r, v);
      yield;
    }
  for (const pal of [0, 1, 2, 3])
    for (let sz = 1; sz <= 3; sz++) {
      for (let f = 0; f < 4; f++) chunkImg(sz, f, pal);
      yield;
    }
  for (let v = 0; v < 8; v++) for (let f = 0; f < 4; f++) shredImg(v, f);
  yield;
  for (let d = 0; d < 16; d++) {
    boltImg(d, 0);
    boltImg(d, 1);
    yield;
  }
  for (let H = 4; H <= 64; H += 4) {
    for (let f = 0; f < 4; f++) pillarImg(H, 26, f);
    yield;
  }
  wardFloor(18);
  scorchImg(14, 2);
  scorchImg(17, 2);
  scorchImg(9, 2);
  yield;
  for (let j = 0; j <= 2; j++) {
    shrineBreath(j, 0);
    yield;
    shrineBreath(j, 1);
    yield;
  }
});
