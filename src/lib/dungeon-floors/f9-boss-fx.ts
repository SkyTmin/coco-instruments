// Этаж 9, босс «Многоглавая гидра» — техники (v2.86): всё, что гидра делает
// с миром вокруг себя. Рисунок самого тела, голов и шей — в `f9-art.ts`
// (другой агент); здесь — пол, вода и воздух:
//   • метки ударов (`registerZonePainter`): «куда» видно с первого кадра
//     (весь контур сразу), «когда» — таймер наливается от пасти к краю ровно
//     к урону, последние 0,2 с — тревога: край горит и мигает, у каждой
//     стихии свой сигнал (челюсти смыкаются, вода отступает, молния ищет
//     дорогу, свет собирается в точку);
//   • контакт каждого удара (`registerImpactPainter`): свой рисунок, тряска
//     по силе удара, вспышка только у ярких;
//   • снаряды — кристалл льда с иглами и ком яда крутятся, за ними хвост;
//     контакт — ледяной цветок и шлепок с брызгами;
//   • визуальные зоны мозга (`api.vfx`, правки в `f9-brains.ts` помечены
//     «v2.86 — только рисунок»): луч лечения, часы отрастания обрубка,
//     обрубок кровит, выжженный след молнии, ил под скрытой головой.
//
// Правила файла:
//   • всё рисуется пикселями в одну игровую точку от центра удара, центр
//     прижат к точке экрана (как рендер ставит мобов) — без дрожи на пиксель
//     и без размытых кругов;
//   • частица — функция времени (`fly`), разброс — от зерна удара: кадр не
//     хранит состояния и одинаков при любом шаге рендера и в стоп-кадре;
//   • светится — `above` (пламя, молния, луч, свет); лежит на полу — под
//     мобами (гарь, лёд, ил, лужи, метки);
//   • цвета стихий — те же, что у голов (`ELEM` в `f9-art.ts`).
import { Px } from '../dungeon-art';
import {
  frameLRU,
  IMPACT_PAINTERS,
  paintSim,
  registerImpactPainter,
  registerMobWarm,
  registerShotPainter,
  registerZonePainter,
} from '../dungeon-paint';
import type { ImpactRec, Sprite } from '../dungeon-paint';
import type { Mob, Shot, Strike, Zone } from '../dungeon-sim';
import { F9_VIEW } from './f9-brains';

type RGBA = [number, number, number, number];

// ---------------------------------------------------------------------------
// Палитра. Стихии — ступенями от тени к блику; вода, ил, кровь — этажа.
// ---------------------------------------------------------------------------

const WHITE = '#ffffff';
const HOT = '#fff4e8';
const INK = '#150f0b';
// Огонь.
const F_D = '#4a1006';
const F_R = '#b02e0c';
const F_O = '#ff6a1a';
const F_Y = '#ffb534';
const F_L = '#ffe888';
const F_W = '#fffbe0';
const SOOT = '#140c08';
const SOOT2 = '#2e1a0e';
const SMOKE = ['#2a2624', '#46403c', '#6a625c', '#8e8680'];
// Лёд.
const I_D = '#16264a';
const I_M = '#34609a';
const I_L = '#7ab4e8';
const I_H = '#c8ecff';
const I_W = '#f4fdff';
// Яд.
const V_D = '#10240c';
const V_M = '#2e6a1a';
const V_L = '#6ab02e';
const V_H = '#b4f050';
const V_W = '#eaffb0';
// Гроза.
const B_D = '#241a5a';
const B_M = '#5a4ab8';
const B_L = '#a898f4';
const B_Y = '#fff27a';
// Свет.
const L_D = '#7a5a14';
const L_M = '#c8a030';
const L_L = '#f0d468';
const L_H = '#fff4c0';
// Скрытая голова — лиловое.
const C_D = '#1c1030';
const C_M = '#4a2e7a';
const C_L = '#9a6ae0';
const C_H = '#d8b8ff';
// Вода озера и ил.
const W_D = '#0c2622';
const W_M = '#1d3a33';
const W_T = '#2f6a55';
const W_L = '#7fc49a';
const FOAM = '#d9f5d0';
const FOAM_W = '#f2fff8';
const MUD = ['#141008', '#2e2616', '#4a3e26', '#6a5a3a', '#8a7a58'];
// Кровь.
const BL_D = '#3a0806';
const BL_M = '#7a1410';
const BL_R = '#b82a22';
const BL_L = '#e8503a';
const RED = '#ff4a3a';
const RED_D = '#8a1a14';
// Тело гидры (хвост): те же тона, что у тела в `f9-art.ts`.
const HY = ['#0c1a12', '#1e3a26', '#36603c', '#5e8a58', '#8aa860'];

/** Ступени стихий: тень, основа, свет, блик, белое. 0 огонь … 4 свет. */
const EL_P: string[][] = [
  [F_D, F_R, F_O, F_Y, F_W],
  [I_D, I_M, I_L, I_H, I_W],
  [V_D, V_M, V_L, V_H, V_W],
  [B_D, B_M, B_L, B_Y, WHITE],
  [L_D, L_M, L_L, L_H, WHITE],
];

const rgb = (h: string, a = 255): RGBA => {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255, a];
};

// ---------------------------------------------------------------------------
// Общее: время, случайность из зерна, кривые.
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const outCubic = (t: number) => 1 - (1 - clamp01(t)) ** 3;
const outQuad = (t: number) => 1 - (1 - clamp01(t)) ** 2;
const inQuad = (t: number) => clamp01(t) ** 2;
const inCubic = (t: number) => clamp01(t) ** 3;
const outBack = (t: number, s = 1.9) => {
  const u = clamp01(t) - 1;
  return 1 + (s + 1) * u * u * u + s * u * u;
};
/** Тяжесть брызг и осколков, игровых пикселей в секунду². */
const G = 520;
/** Последние 0,2 с перед уроном — метка кричит. */
const ALARM = 0.2;

/** Случайное 0…1 из зерна: номер частицы `i`, свойство `k`. */
function rnd(seed: number, i: number, k: number): number {
  let h = (seed ^ Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(k + 11, 0x85ebca77)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}
const sgn = (seed: number, i: number, k: number) => rnd(seed, i, k) * 2 - 1;

/** Гладкий шум 0…1 по одной оси, `per` — период (кольцо без шва). */
function vn(seed: number, v: number, per = 1 << 20): number {
  const i = Math.floor(v);
  const f = v - i;
  const s = f * f * (3 - 2 * f);
  const a = ((i % per) + per) % per;
  return rnd(seed, a, 3) * (1 - s) + rnd(seed, (a + 1) % per, 3) * s;
}

/** Зерно зоны или удара по номеру (у зон `api.vfx` номера отрицательные). */
const idSeed = (id: number, k = 0) =>
  (Math.imul(id | 0, 0x9e3779b1) ^ Math.imul(k + 7, 0x85ebca77)) >>> 0;

/** «Когда»: доля метки, остаток и тревога последних 0,2 с. */
interface When {
  T: number;
  t: number;
  k: number;
  left: number;
  alarm: boolean;
  /** 0…1 внутри тревоги. */
  a: number;
}
function whenOf(st: { t: number; warn?: number }): When {
  const T = Math.max(0.05, st.warn ?? 0);
  const t = Math.min(Math.max(0, st.t), T);
  const left = T - t;
  return { T, t, k: t / T, left, alarm: left < ALARM, a: clamp01(1 - left / ALARM) };
}
/** Мигание тревоги, 18 Гц. */
const blink = (time: number) => Math.floor(time * 18) % 2 === 0;

// ---------------------------------------------------------------------------
// Кисть: точки в игровой пиксель от центра, центр — в точке экрана.
// ---------------------------------------------------------------------------

class Brush {
  readonly g: CanvasRenderingContext2D;
  readonly ox: number;
  readonly oy: number;
  private c = '';
  constructor(g: CanvasRenderingContext2D, px: number, py: number) {
    this.g = g;
    // Рендер масштабирует канву целым множителем: прижимаем к его точке.
    const s = g.getTransform().a || 1;
    this.ox = Math.round(px * s) / s;
    this.oy = Math.round(py * s) / s;
  }
  ink(c: string, a = 1): void {
    if (c !== this.c) {
      this.g.fillStyle = c;
      this.c = c;
    }
    this.g.globalAlpha = a <= 0 ? 0 : a >= 1 ? 1 : a;
  }
  dot(x: number, y: number, w = 1, h = 1): void {
    this.g.fillRect(this.ox + Math.round(x), this.oy + Math.round(y), w, h);
  }
  /** Квадрат `s`×`s` с серединой в точке. */
  sq(x: number, y: number, s: number): void {
    const h = (s - 1) / 2;
    this.dot(x - h, y - h, s, s);
  }
  /** Отрезок точками (`w` — толщина квадратом). */
  line(x0: number, y0: number, x1: number, y1: number, w = 1): void {
    const n = Math.max(
      Math.abs(Math.round(x1) - Math.round(x0)),
      Math.abs(Math.round(y1) - Math.round(y0)),
      1,
    );
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      const y = y0 + ((y1 - y0) * i) / n;
      if (w <= 1) this.dot(x, y);
      else this.sq(x, y, w);
    }
  }
  /** Отрезок пунктиром: `dash` точек есть, столько же нет; `ph` — бег. */
  dashed(x0: number, y0: number, x1: number, y1: number, dash: number, ph: number): void {
    const n = Math.max(
      Math.abs(Math.round(x1) - Math.round(x0)),
      Math.abs(Math.round(y1) - Math.round(y0)),
      1,
    );
    for (let i = 0; i <= n; i++) {
      if (((Math.floor(i / dash - ph) % 2) + 2) % 2) continue;
      this.dot(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n);
    }
  }
  /** Кольцо точками: эллипс r × r·sy, дуга a0…a1, пунктир `dash`. */
  ring(cx: number, cy: number, r: number, sy = 1, a0 = 0, a1 = TAU, dash = 0, phase = 0): void {
    if (r < 0.75) {
      this.dot(cx, cy);
      return;
    }
    const span = a1 - a0;
    const n = Math.max(6, Math.ceil(Math.abs(span) * r * 1.3));
    let lx = 1e9;
    let ly = 1e9;
    const x0 = this.ox + Math.round(cx);
    const y0 = this.oy + Math.round(cy);
    for (let i = 0; i <= n; i++) {
      const a = a0 + (span * i) / n;
      if (dash > 0 && ((Math.floor((Math.abs(a - a0) * r) / dash + phase) % 2) + 2) % 2) continue;
      const x = Math.round(Math.cos(a) * r);
      const y = Math.round(Math.sin(a) * r * sy);
      if (x === lx && y === ly) continue;
      lx = x;
      ly = y;
      this.g.fillRect(x0 + x, y0 + y, 1, 1);
    }
  }
  /** Рваное кольцо: дуги с разрывами по шуму — рябь, пена, фронт жара. */
  torn(
    cx: number,
    cy: number,
    r: number,
    sy: number,
    seed: number,
    keep = 0.55,
    w = 1,
    a0 = 0,
    a1 = TAU,
    phase = 0,
  ): void {
    if (r < 1.5) return;
    const span = a1 - a0;
    const n = Math.max(6, Math.ceil(Math.abs(span) * r * 1.25));
    let lx = 1e9;
    let ly = 1e9;
    const x0 = this.ox + Math.round(cx);
    const y0 = this.oy + Math.round(cy);
    for (let i = 0; i <= n; i++) {
      const a = a0 + (span * i) / n;
      if (vn(seed, (a * r) / 6 + phase) > keep) continue;
      const x = Math.round(Math.cos(a) * r);
      const y = Math.round(Math.sin(a) * r * sy);
      if (x === lx && y === ly) continue;
      lx = x;
      ly = y;
      this.g.fillRect(x0 + x, y0 + y, w, 1);
    }
  }
  /** Пятно строками пикселей: рваный край (`wob` — доля), без сглаживания. */
  blob(cx: number, cy: number, rx: number, ry: number, seed = 0, wob = 0): void {
    if (rx < 0.5 || ry < 0.5) return;
    const n = Math.ceil(ry);
    const bx = this.ox + Math.round(cx);
    const by = this.oy + Math.round(cy);
    for (let y = -n; y <= n; y++) {
      const q = 1 - (y / ry) ** 2;
      if (q <= 0) continue;
      const w = rx * Math.sqrt(q);
      const l = Math.round(-w * (1 - wob * vn(seed, y / 2.5 + 20)));
      const r = Math.round(w * (1 - wob * vn(seed + 7, y / 2.5 + 20)));
      if (r < l) continue;
      this.g.fillRect(bx + l, by + y, r - l + 1, 1);
    }
  }
  /**
   * Кольцевой сектор строками (полуширина `half` < π/2), рваные бока
   * (`wob` — размах, пиксели): клин конуса, мокрый след, копоть.
   */
  wedge(r0: number, r1: number, a: number, half: number, seed = 0, wob = 0): void {
    if (r1 <= r0 || half <= 0) return;
    const c1 = Math.cos(a - half);
    const s1 = Math.sin(a - half);
    const c2 = Math.cos(a + half);
    const s2 = Math.sin(a + half);
    const n = Math.ceil(r1);
    const R1 = r1 * r1;
    const R0 = r0 * r0;
    for (let y = -n; y <= n; y++) {
      const q1 = R1 - y * y;
      if (q1 <= 0) continue;
      const X1 = Math.sqrt(q1);
      let lo = -X1;
      let hi = X1;
      if (s1 > 1e-6) hi = Math.min(hi, (c1 * y) / s1);
      else if (s1 < -1e-6) lo = Math.max(lo, (c1 * y) / s1);
      else if (c1 * y < 0) continue;
      if (s2 > 1e-6) lo = Math.max(lo, (c2 * y) / s2);
      else if (s2 < -1e-6) hi = Math.min(hi, (c2 * y) / s2);
      else if (c2 * y > 0) continue;
      if (hi < lo) continue;
      const j0 = wob * (vn(seed, y / 3 + 40) * 2 - 1);
      const j1 = wob * (vn(seed + 9, y / 3 + 40) * 2 - 1);
      const X0 = R0 - y * y > 0 ? Math.sqrt(R0 - y * y) : -1;
      const l = lo + j0;
      const h = hi + j1;
      if (X0 < 0) this.row(y, l, h);
      else {
        this.row(y, l, Math.min(h, -X0));
        this.row(y, Math.max(l, X0), h);
      }
    }
  }
  /** Полоса вдоль оси (ux, uy): от s0 до s1, полуширина hw — строками. */
  band(ux: number, uy: number, s0: number, s1: number, hw: number): void {
    // Выпуклый четырёхугольник — построчно.
    const nx = -uy;
    const ny = ux;
    const P = [
      [ux * s0 + nx * hw, uy * s0 + ny * hw],
      [ux * s1 + nx * hw, uy * s1 + ny * hw],
      [ux * s1 - nx * hw, uy * s1 - ny * hw],
      [ux * s0 - nx * hw, uy * s0 - ny * hw],
    ];
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const p of P) {
      y0 = Math.min(y0, p[1]);
      y1 = Math.max(y1, p[1]);
    }
    for (let y = Math.ceil(y0); y <= Math.floor(y1); y++) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < 4; i++) {
        const [ax, ay] = P[i];
        const [bx, by] = P[(i + 1) % 4];
        if (ay === by) {
          if (Math.abs(y - ay) < 0.5) {
            lo = Math.min(lo, ax, bx);
            hi = Math.max(hi, ax, bx);
          }
          continue;
        }
        if ((y < ay && y < by) || (y > ay && y > by)) continue;
        const x = ax + ((y - ay) * (bx - ax)) / (by - ay);
        lo = Math.min(lo, x);
        hi = Math.max(hi, x);
      }
      if (hi >= lo) this.row(y, lo, hi);
    }
  }
  /**
   * Кольцевой сектор одной заливкой пути — для больших прозрачных площадей
   * (клин хвоста): строками это сотни прямоугольников на кадр, а под такой
   * заливкой край всё равно не читается.
   */
  sector(r0: number, r1: number, a: number, half: number): void {
    const g = this.g;
    g.beginPath();
    g.arc(this.ox, this.oy, r1, a - half, a + half);
    if (r0 > 0) g.arc(this.ox, this.oy, r0, a + half, a - half, true);
    else g.lineTo(this.ox, this.oy);
    g.closePath();
    g.fill();
  }
  row(y: number, l: number, r: number): void {
    const L = Math.round(l);
    const R = Math.round(r);
    if (R >= L) this.g.fillRect(this.ox + L, this.oy + y, R - L + 1, 1);
  }
}

/** Рисовать с сохранением состояния канвы (зоны рендер не оборачивает). */
function paint(
  g: CanvasRenderingContext2D,
  px: number,
  py: number,
  fn: (b: Brush) => void,
): boolean {
  g.save();
  try {
    fn(new Brush(g, px, py));
  } finally {
    g.restore();
    g.globalAlpha = 1;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Частицы: полёт по параболе, клубы, языки пламени.
// ---------------------------------------------------------------------------

interface Bit {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Секунд после посадки; −1 — ещё в полёте. */
  t: number;
}
const BIT: Bit = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, t: -1 };

/**
 * Полёт от (x0, y0, z0) со скоростью (vx, vy, vz), тяжесть `gz`, время `t`.
 * `hop` > 0 — отскок на долю скорости и скольжение до остановки (осколок,
 * комок, искра); иначе ложится, где упал (капля).
 */
function fly(
  o: Bit,
  x0: number,
  y0: number,
  z0: number,
  vx: number,
  vy: number,
  vz: number,
  gz: number,
  t: number,
  hop = 0,
): Bit {
  const t1 = (vz + Math.sqrt(vz * vz + 2 * gz * Math.max(0, z0))) / gz;
  if (t < t1) {
    o.x = x0 + vx * t;
    o.y = y0 + vy * t;
    o.z = z0 + vz * t - (gz * t * t) / 2;
    o.vx = vx;
    o.vy = vy;
    o.vz = vz - gz * t;
    o.t = -1;
    return o;
  }
  let x = x0 + vx * t1;
  let y = y0 + vy * t1;
  let u = t - t1;
  if (hop > 0) {
    const vz2 = (gz * t1 - vz) * hop;
    const t2 = (2 * vz2) / gz;
    const hx = vx * 0.5;
    const hy = vy * 0.5;
    if (u < t2) {
      o.x = x + hx * u;
      o.y = y + hy * u;
      o.z = vz2 * u - (gz * u * u) / 2;
      o.vx = hx;
      o.vy = hy;
      o.vz = vz2 - gz * u;
      o.t = -1;
      return o;
    }
    x += hx * t2;
    y += hy * t2;
    u -= t2;
    const s = (1 - Math.exp(-8 * u)) / 8;
    x += hx * 0.6 * s;
    y += hy * 0.6 * s;
  }
  o.x = x;
  o.y = y;
  o.z = 0;
  o.vx = 0;
  o.vy = 0;
  o.vz = 0;
  o.t = u;
  return o;
}

/**
 * Частица: в полёте — точка и хвост по экранной скорости (как искры меча);
 * легла — пятнышко цвета `land`, гаснет за `lie` с.
 */
function bit(
  b: Brush,
  p: Bit,
  head: string,
  tail: string,
  a: number,
  size = 1,
  lie = 0.4,
  land = tail,
): void {
  if (p.t < 0) {
    const sx = p.x;
    const sy = p.y - p.z;
    const vx = p.vx;
    const vy = p.vy - p.vz;
    const sp = Math.abs(vx) + Math.abs(vy);
    if (sp > 25) {
      const k = Math.max(1.2 / sp, 0.028);
      b.ink(tail, a * 0.75);
      b.dot(sx - vx * k, sy - vy * k);
    }
    if (sp > 150) {
      b.ink(tail, a * 0.4);
      b.dot(sx - vx * 0.056, sy - vy * 0.056);
    }
    b.ink(head, a);
    b.sq(sx, sy, size);
    return;
  }
  if (p.t < lie) {
    b.ink(land, a * (1 - p.t / lie));
    b.dot(p.x - (size > 1 ? 1 : 0), p.y, size > 1 ? 3 : 2, 1);
  }
}

/** Клуб (дым, пламя, пыль): пиксельный диск со светом сверху-слева. */
function puff(
  b: Brush,
  x: number,
  y: number,
  r: number,
  dark: string,
  lite: string,
  a: number,
  seed = 0,
): void {
  if (a <= 0.01) return;
  if (r < 0.9) {
    b.ink(lite, a);
    b.dot(x, y);
    return;
  }
  b.ink(dark, a);
  b.blob(x, y, r, r * 0.92, seed, 0.2);
  b.ink(lite, a);
  b.blob(x - r * 0.3, y - r * 0.32, r * 0.58, r * 0.55, seed + 1, 0.25);
}

/** Язык пламени: основание (x, y), высота h, ширина w, `ph` — колыхание. */
function tongue(b: Brush, x: number, y: number, h: number, w: number, ph: number, a = 1): void {
  if (h < 1 || a <= 0.01) return;
  const passes: [string, number, number][] = [
    [F_R, 1, 1],
    [F_O, 0.75, 0.82],
    [F_Y, 0.48, 0.58],
    [F_W, 0.25, 0.3],
  ];
  for (const [c, kw, kh] of passes) {
    b.ink(c, a);
    const hh = Math.max(1, Math.round(h * kh));
    for (let i = 0; i < hh; i++) {
      const u = i / Math.max(1, h);
      const ww = Math.max(1, Math.round(w * kw * (1 - i / hh) ** 0.7));
      const sway = Math.sin(ph + i * 0.6) * u * 1.8;
      b.dot(x + sway - ww / 2 + 0.5, y - i, ww, 1);
    }
  }
}

/** Искорка-крест: в центре белое, лучи цветом. */
function twinkle(b: Brush, x: number, y: number, c: string, a: number, big: boolean): void {
  b.ink(c, a);
  b.dot(x - 1, y);
  b.dot(x + 1, y);
  b.dot(x, y - 1);
  b.dot(x, y + 1);
  if (big) {
    b.ink(c, a * 0.6);
    b.dot(x - 2, y);
    b.dot(x + 2, y);
    b.dot(x, y - 2);
    b.dot(x, y + 2);
  }
  b.ink(WHITE, a);
  b.dot(x, y);
}

// ---------------------------------------------------------------------------
// Кто бьёт: мобы из кадра (`paintSim`). На листе кадров мира нет — там
// берутся запасные значения.
// ---------------------------------------------------------------------------

function mobById(id: number | undefined): Mob | null {
  const sim = paintSim();
  if (!sim || id === undefined) return null;
  return sim.mobs.find((m) => m.id === id) ?? null;
}

function nearestMob(kinds: string[], x: number, y: number, maxD: number): Mob | null {
  const sim = paintSim();
  if (!sim) return null;
  let best: Mob | null = null;
  let bd = maxD;
  for (const m of sim.mobs) {
    if (!kinds.includes(m.kind)) continue;
    const d = Math.hypot(m.x - x, m.y - y);
    if (d < bd) {
      bd = d;
      best = m;
    }
  }
  return best;
}

/** Смотрит ли голова влево (кадр отражён): пасть — с этой стороны. */
const sideOf = (a: number) => (Math.cos(a) >= 0 ? 1 : -1);

/**
 * Пасть головы над полом, пиксели от её точки на полу: голова-летун поднята
 * на 6 и ещё столько же до челюсти; кадр смотрит влево или вправо.
 */
const mouthOf = (a: number, crown = false): [number, number] => [
  sideOf(a) * (crown ? 13 : 10),
  crown ? -19 : -15,
];

/**
 * Жив ли тот, кто бьёт, к моменту удара: удар умершего гаснет (движок
 * убирает метку), значит и его зона-картинка не играет контакт.
 */
const ALIVE = new WeakMap<object, boolean>();
function aliveAtHit(z: Zone & { from?: number }): boolean {
  if (z.t >= (z.warn ?? 0)) return ALIVE.get(z) ?? true;
  const sim = paintSim();
  const m = sim && z.from !== undefined ? sim.mobs.find((o) => o.id === z.from) : null;
  const ok = !sim || z.from === undefined || (!!m && m.mode !== 'dying');
  ALIVE.set(z, ok);
  return ok;
}

type ZX = Zone & { ang?: number; from?: number; tgt?: number; el?: number };

// ---------------------------------------------------------------------------
// Укус головы и скрытой головы — `f9_bite` (круг r 0,85/1 на 1,15 перед
// пастью). Метка: тень нависшей пасти и кровавый круг наливаются к удару;
// по бокам от оси укуса — два ряда клыков: сперва пасть РАСКРЫВАЕТСЯ до
// края круга (замах), в последние 0,2 с челюсти схлопываются с разгоном и
// сходятся ровно в кадр урона. Контакт: сомкнутые клыки белым, ударное
// кольцо, брызги вперёд по укусу, следы проколов на земле сохнут.
// ---------------------------------------------------------------------------

/** Направление укуса: от головы к метке (голова — `from`). */
const BITE_DIR = new WeakMap<object, number>();
function biteDir(st: Strike): number {
  const d = BITE_DIR.get(st);
  if (d !== undefined) return d;
  const m = mobById(st.from);
  if (!m) return 0;
  const a = Math.atan2(st.y - m.y, st.x - m.x);
  BITE_DIR.set(st, a);
  return a;
}

/** Два ряда клыков по бокам от оси укуса, `gap` — от оси до клыка. */
function jaws(
  b: Brush,
  R: number,
  dir: number,
  gap: number,
  tooth: string,
  gum: string,
  a: number,
): void {
  const ux = Math.cos(dir);
  const uy = Math.sin(dir);
  const nx = -uy;
  const ny = ux;
  const n = R > 15 ? 6 : 5;
  for (const side of [-1, 1]) {
    // Десна — дугой: посередине дальше от оси (челюсть — «U»).
    let px = 0;
    let py = 0;
    for (let i = 0; i < n; i++) {
      const f = (i / (n - 1)) * 2 - 1;
      const s = f * R * 0.66;
      const o = side * (gap + (1 - f * f) * 1.6 + 1);
      const x = ux * s + nx * o;
      const y = uy * s + ny * o;
      if (i) {
        b.ink(gum, a);
        b.line(px, py, x, y);
      }
      px = x;
      py = y;
    }
    // Клыки верхней и нижней челюсти сдвинуты на полшага — сходятся «в замок».
    for (let i = 0; i < n; i++) {
      const f = (i / (n - 1)) * 2 - 1;
      const s = f * R * 0.66 + side * R * 0.08;
      const o = side * (gap + (1 - f * f) * 1.6);
      const x = ux * s + nx * o;
      const y = uy * s + ny * o;
      b.ink(tooth, a);
      b.dot(x, y);
      b.dot(x + ux, y + uy);
      b.dot(x - nx * side, y - ny * side);
      b.ink(WHITE, a);
      b.dot(x - nx * side * 2, y - ny * side * 2);
    }
  }
}

registerZonePainter('f9_bite', (g, z, px, py, S, time) => {
  const st = z as Strike;
  const w = whenOf(st);
  const R = st.r * S;
  const dir = biteDir(st);
  return paint(g, px, py, (b) => {
    // Тень пасти, что нависла над местом укуса: густеет к удару.
    b.ink('#000000', 0.1 + 0.22 * w.k);
    b.blob(0, 0, R * (0.45 + 0.5 * w.k), R * (0.4 + 0.45 * w.k), 3, 0.08);
    // Кровавый круг — таймер: от середины к краю ровно к удару.
    const rf = R * (0.12 + 0.88 * w.k);
    b.ink(BL_R, 0.12 + 0.16 * w.k + (w.alarm ? 0.16 : 0));
    b.blob(0, 0, rf, rf);
    b.ink(w.alarm ? RED : BL_R, 0.35 + 0.4 * w.k);
    b.ring(0, 0, rf);
    // Край: пунктир бежит по кругу; в тревоге — сплошной и горячий.
    if (w.alarm) {
      b.ink(blink(time) ? HOT : RED, 1);
      b.ring(0, 0, R);
      b.ink(RED, 0.8);
      b.ring(0, 0, R + 1);
    } else {
      b.ink(BL_M, 0.5 + 0.3 * w.k);
      b.ring(0, 0, R + 1);
      b.ink(RED, 0.5 + 0.45 * w.k);
      b.ring(0, 0, R, 1, 0, TAU, 3, time * 7);
    }
    // Челюсти: раскрываются (замах), потом схлопываются с разгоном.
    const open = w.T - ALARM;
    const gap = w.alarm
      ? R * 0.92 * (1 - inCubic(w.a))
      : R * (0.3 + 0.62 * outCubic(w.t / Math.max(0.01, open)));
    if (w.alarm && w.a > 0.2) {
      // Смаз схлопывания: полосы от прошлого положения челюстей.
      const prev = R * 0.92 * (1 - inCubic(w.a - 0.35));
      const ux = Math.cos(dir);
      const uy = Math.sin(dir);
      b.ink(HOT, 0.4);
      for (const side of [-1, 1])
        for (const s of [-0.4, 0, 0.4])
          b.line(
            ux * s * R - uy * side * (gap + 2),
            uy * s * R + ux * side * (gap + 2),
            ux * s * R - uy * side * prev,
            uy * s * R + ux * side * prev,
          );
    }
    jaws(b, R, dir, gap, w.alarm ? HOT : '#e8dcc0', w.alarm ? RED : BL_M, 0.55 + 0.45 * w.k);
  });
});

const IMP_DIR = new WeakMap<ImpactRec, number>();
/** Откуда пришёл удар: от ближайшего моба этих видов к точке удара. */
function impactDir(rec: ImpactRec, kinds: string[], fallback: number): number {
  const d = IMP_DIR.get(rec);
  if (d !== undefined) return d;
  const m = nearestMob(kinds, rec.x, rec.y, 3);
  const a = m ? Math.atan2(rec.y - m.y, rec.x - m.x) : fallback;
  IMP_DIR.set(rec, a);
  return a;
}

registerImpactPainter('f9_bite', {
  life: 0.95,
  shake: 0.25,
  paint(g, rec, px, py, S, age) {
    const R = (rec.r ?? 0.85) * S;
    const dir = impactDir(rec, ['f9_head', 'f9_crown'], 0);
    const ux = Math.cos(dir);
    const uy = Math.sin(dir);
    const nx = -uy;
    const ny = ux;
    const seed = rec.seed;
    return paint(g, px, py, (b) => {
      // Проколы клыков на земле: два ряда, темнеют и сохнут.
      const fade = 1 - clamp01((age - 0.35) / 0.6);
      const n = R > 15 ? 6 : 5;
      for (const side of [-1, 1])
        for (let i = 0; i < n; i++) {
          const f = (i / (n - 1)) * 2 - 1;
          const s = f * R * 0.66 + side * R * 0.08;
          const o = side * (2 + (1 - f * f) * 1.2);
          b.ink(BL_D, 0.85 * fade);
          b.dot(ux * s + nx * o, uy * s + ny * o, 2, 1);
          b.ink(BL_R, 0.9 * fade);
          b.dot(ux * s + nx * o, uy * s + ny * o);
        }
      // Кадр контакта: челюсти сомкнуты — клыки белым, вспышка по оси.
      if (age < 0.1) {
        const k = age / 0.1;
        jaws(b, R, dir, 0.5, k < 0.5 ? WHITE : '#f0e4c8', k < 0.5 ? HOT : BL_M, 1 - k * 0.6);
        b.ink(WHITE, 0.9 * (1 - k));
        b.line(-ux * R * 0.8, -uy * R * 0.8, ux * R * 0.8, uy * R * 0.8, k < 0.4 ? 2 : 1);
      }
      // Ударное кольцо рвётся и уходит.
      if (age < 0.26) {
        const k = age / 0.26;
        b.ink(k < 0.3 ? WHITE : FOAM, 0.9 * (1 - k));
        b.torn(0, 0, R * (0.55 + 0.95 * outCubic(k)), 1, seed, 0.72 - 0.3 * k, k < 0.35 ? 2 : 1);
      }
      // Брызги — вперёд по укусу: вода с пасти и кровь.
      for (let i = 0; i < 20; i++) {
        const u = age - rnd(seed, i, 4) * 0.03;
        if (u < 0) continue;
        const a = dir + sgn(seed, i, 1) * 1.1;
        const sp = 35 + rnd(seed, i, 2) * 70;
        fly(
          BIT,
          ux * R * 0.3,
          uy * R * 0.3,
          5,
          Math.cos(a) * sp,
          Math.sin(a) * sp * 0.8,
          40 + rnd(seed, i, 3) * 70,
          G,
          u,
        );
        if (i % 3 === 0) bit(b, BIT, BL_L, BL_M, 1, 1, 0.5, BL_D);
        else bit(b, BIT, FOAM_W, W_L, 1, i % 4 === 1 ? 2 : 1, 0.3, W_D);
      }
      // Пыль из-под пасти — низко, в стороны от оси.
      for (let i = 0; i < 6; i++) {
        const u = age - rnd(seed, i, 20) * 0.04;
        if (u < 0 || u > 0.55) continue;
        const side = i % 2 ? 1 : -1;
        const d = R * (0.4 + 0.9 * outCubic(u / 0.4));
        const s = sgn(seed, i, 21) * R * 0.5;
        puff(
          b,
          nx * side * d + ux * s,
          ny * side * d + uy * s - u * 8,
          1.5 + u * 5,
          MUD[2],
          MUD[3],
          0.45 * (1 - u / 0.55),
          seed + i,
        );
      }
    });
  },
});

// ---------------------------------------------------------------------------
// Огненная голова — конус `f9_firecone` (r 4,2, дуга 0,9) и струя `f9_flame`.
// Метка: весь клин виден сразу пунктиром, от пасти к краю ползёт выжженная
// земля с фронтом жара — доходит до края ровно к удару; по клину бегут искры,
// над выжженным дрожит марево; в тревоге края горят и мигают. Струя (зона
// мозга, поверх темноты): клубы пламени вылетают из пасти, в кадр урона уже
// накрывают клин, у края упираются, расползаются и уходят вверх дымом.
// Контакт на полу: вспышка жара по клину, копоть лучами, искры скачут.
// ---------------------------------------------------------------------------

registerZonePainter('f9_firecone', (g, z, px, py, S, time) => {
  const st = z as Strike;
  const w = whenOf(st);
  const R = st.r * S;
  const a = st.ang ?? 0;
  const half = (st.arc ?? 0.9) / 2;
  const seed = idSeed(st.id, 1);
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  return paint(g, px, py, (b) => {
    // Выжженная земля — таймер от пасти к краю.
    const rf = R * (0.06 + 0.94 * w.k);
    b.ink(F_D, 0.14 + 0.16 * w.k + (w.alarm ? 0.12 : 0));
    b.wedge(4, rf, a, half, seed, 1.2);
    b.ink(SOOT2, 0.25 * w.k);
    b.wedge(4, rf * 0.6, a, half * 0.8, seed + 3, 1.5);
    // Фронт жара: рваная горячая дуга на краю выжженного.
    b.ink(w.alarm ? F_Y : F_O, 0.55 + 0.4 * w.k);
    b.torn(0, 0, rf, 1, seed, 0.72, 1, a - half, a + half, time * 4);
    b.ink(F_R, 0.5);
    b.torn(0, 0, rf - 2, 1, seed + 5, 0.5, 1, a - half, a + half, time * 3);
    // Края клина: всё «куда» видно с первого кадра; пунктир бежит от пасти.
    const hot = w.alarm && blink(time);
    b.ink(w.alarm ? (hot ? HOT : F_Y) : F_O, w.alarm ? 1 : 0.45 + 0.35 * w.k);
    for (const s of [-1, 1]) {
      const c = Math.cos(a + s * half);
      const sn = Math.sin(a + s * half);
      if (w.alarm) b.line(c * 5, sn * 5, c * R, sn * R);
      else b.dashed(c * 5, sn * 5, c * R, sn * R, 3, time * 5);
    }
    if (w.alarm) b.ring(0, 0, R, 1, a - half, a + half);
    else b.ring(0, 0, R, 1, a - half, a + half, 3, -time * 5);
    // Искры бегут от пасти к краю (живое): ярче там, где уже выжжено.
    for (let i = 0; i < 10; i++) {
      const u = (time * (0.9 + rnd(seed, i, 1) * 0.6) + rnd(seed, i, 2)) % 1;
      const aa = a + sgn(seed, i, 3) * half * 0.85;
      const r = 6 + (R - 6) * u;
      const lit = r < rf;
      b.ink(lit ? (i % 3 ? F_Y : F_L) : F_O, (lit ? 0.9 : 0.35) * (1 - u * 0.6));
      b.dot(Math.cos(aa) * r, Math.sin(aa) * r - (lit ? u * 3 : 0));
    }
    // Марево над выжженным: короткие светлые штрихи ползут вверх.
    for (let i = 0; i < 6; i++) {
      const u = (time * 1.4 + i / 6) % 1;
      const r = rf * (0.3 + 0.6 * rnd(seed, i, 7));
      const aa = a + sgn(seed, i, 8) * half * 0.6;
      b.ink(F_Y, 0.22 * w.k * Math.sin(u * Math.PI));
      b.dot(Math.cos(aa) * r - 1, Math.sin(aa) * r - u * 6, 3, 1);
    }
    // Тревога: у пасти лижут языки — вот-вот дохнёт.
    if (w.alarm)
      for (let j = 0; j < 3; j++) {
        const d = 6 + j * 4;
        tongue(b, ux * d + (j - 1), uy * d, 2 + 5 * w.a, 3, time * 22 + j * 2, 0.85);
      }
  });
});

/** Пламя по жару: 0 — белое у пасти, 1 — красное, дальше — дым. */
function fireInk(h: number): [string, string] {
  if (h < 0.18) return [F_L, F_W];
  if (h < 0.4) return [F_O, F_Y];
  if (h < 0.7) return [F_R, F_O];
  if (h < 0.95) return [F_D, F_R];
  return [SMOKE[0], SMOKE[2]];
}

/** Слои струи от края к ядру: цвет, доля ширины, доля длины, прозрачность. */
const JET: [string, number, number, number][] = [
  [F_D, 1.0, 1.03, 0.55],
  [F_R, 0.9, 0.97, 0.9],
  [F_O, 0.7, 0.86, 1],
  [F_Y, 0.45, 0.66, 1],
  [F_W, 0.2, 0.4, 1],
];

registerZonePainter('f9_flame', (g, z, px, py, S, time) => {
  const zz = z as ZX;
  const warn = zz.warn ?? 0;
  if (zz.t < warn) return true;
  const u = zz.t - warn;
  const R = zz.r * S;
  const a = zz.ang ?? 0;
  const half = 0.45;
  const seed = idSeed(zz.id, 2);
  const [mx, my] = mouthOf(a);
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  // Струя над полом: из пасти вниз к земле — берём середину подъёма.
  const ox = mx * 0.45;
  const oy = my * 0.5;
  return paint(g, px + ox, py + oy, (b) => {
    // В кадр урона струя уже накрыла три четверти клина, через кадр — весь;
    // после 0,24 с отрывается от пасти и улетает, к 0,5 с — только дым.
    const reach = R * (0.74 + 0.31 * outCubic(u / 0.07) + 0.12 * outQuad((u - 0.2) / 0.3));
    const inner = R * 0.35 * inQuad((u - 0.2) / 0.3);
    const fade = 1 - clamp01((u - 0.36) / 0.14);
    const fl = Math.floor(time * 24);
    // Остывает изнутри: сперва гаснет белое ядро, последним — тёмный край.
    JET.forEach(([c, kw, kr, al], li) => {
      const t0 = 0.16 + (JET.length - 1 - li) * 0.035;
      const k = 1 - clamp01((u - t0) / 0.12);
      const r1 = reach * kr;
      if (k <= 0 || r1 <= inner + 2) return;
      b.ink(c, al * k);
      b.wedge(Math.max(2, inner), r1, a, half * kw * (0.8 + 0.2 * k), seed + fl * 13, 3 + kw * 2);
    });
    // Клубы по фронту и бокам: пламя кипит, а не режется дугой.
    for (let i = 0; i < 14; i++) {
      const side = sgn(seed + fl, i, 1);
      const front = i < 8;
      const d = front
        ? reach * (0.9 + 0.12 * rnd(seed + fl, i, 2))
        : inner + (reach - inner) * rnd(seed + fl, i, 3);
      if (d < inner + 2) continue;
      const aa = a + side * half * (front ? 0.85 : 1.0);
      const r = (front ? 2.5 : 1.6) + rnd(seed + fl, i, 4) * 2;
      const h = front ? 0.55 + 0.3 * rnd(seed, i, 5) : 0.35;
      const [dk, lt] = fireInk(h + u);
      puff(b, Math.cos(aa) * d, Math.sin(aa) * d - u * 10, r, dk, lt, fade, seed + i);
    }
    // Дым с конца струи: поднимается и тает.
    for (let i = 0; i < 6; i++) {
      const v = u - 0.12 - i * 0.04;
      if (v < 0) continue;
      const aa = a + sgn(seed, i, 6) * half * 0.8;
      const d = R * (0.8 + 0.2 * rnd(seed, i, 7));
      puff(
        b,
        Math.cos(aa) * d + Math.sin(v * 5 + i) * 2,
        Math.sin(aa) * d - v * 40,
        3 + v * 12,
        SMOKE[0],
        SMOKE[1],
        0.4 * (1 - clamp01(v / 0.36)),
        seed + i,
      );
    }
    // Ядро у пасти, пока бьёт: белое, дрожит.
    if (u < 0.24) {
      const k = 1 - u / 0.24;
      for (let s = 0; s < R * 0.35; s += 1.5) {
        const f = clamp01(s / (R * 0.35));
        const jit = Math.sin(time * 40 + s) * 0.7;
        const bx = (mx - ox) * (1 - f) + ux * s - uy * jit;
        const by = (my - oy) * (1 - f) + uy * s + ux * jit;
        b.ink(f < 0.5 ? F_W : F_L, k);
        b.sq(bx, by, f < 0.6 ? 2 : 1);
      }
    }
  });
});

registerImpactPainter('f9_firecone', {
  life: 1.7,
  shake: 0.25,
  flash: 0.12,
  flashRgb: '255,170,90',
  paint(g, rec, px, py, S, age) {
    const R = (rec.r ?? 4.2) * S;
    const a = rec.ang ?? 0;
    const half = (rec.arc ?? 0.9) / 2;
    const seed = rec.seed;
    return paint(g, px, py, (b) => {
      // Вспышка жара по всему клину в кадр контакта.
      if (age < 0.12) {
        const k = age / 0.12;
        b.ink(F_O, 0.2 * (1 - k));
        b.wedge(4, R, a, half, seed, 1.5);
        b.ink(F_W, 0.8 * (1 - k));
        b.ring(0, 0, R, 1, a - half, a + half);
      }
      // Копоть лучами от пасти: сперва тлеет, потом темнеет и сходит.
      const fade = 1 - clamp01((age - 0.8) / 0.9);
      const glow = 1 - clamp01(age / 0.7);
      for (let i = 0; i < 16; i++) {
        const aa = a + sgn(seed, i, 1) * half * 0.9;
        const r0 = R * (0.12 + rnd(seed, i, 2) * 0.2);
        const r1 = R * (0.55 + rnd(seed, i, 3) * 0.45);
        const c = Math.cos(aa);
        const s = Math.sin(aa);
        for (let r = r0; r < r1; r += 1) {
          if (vn(seed + i, r / 3) < 0.35) continue;
          b.ink(SOOT, 0.55 * fade);
          b.dot(c * r, s * r);
          if (glow > 0 && vn(seed + i + 50, r / 2 + age * 6) > 0.72) {
            b.ink(r / R < 0.5 ? F_Y : F_O, glow);
            b.dot(c * r, s * r);
          }
        }
      }
      // Гарь дымит: клубы поднимаются с выжженного и тают.
      for (let i = 0; i < 6; i++) {
        const v = age - 0.35 - rnd(seed, i, 20) * 0.5;
        if (v < 0 || v > 1) continue;
        const aa = a + sgn(seed, i, 21) * half * 0.7;
        const d = R * (0.3 + 0.55 * rnd(seed, i, 22));
        puff(
          b,
          Math.cos(aa) * d + Math.sin(v * 4 + i) * 2,
          Math.sin(aa) * d - v * 18,
          1.5 + v * 4,
          SMOKE[0],
          SMOKE[1],
          0.4 * Math.sin(v * Math.PI),
          seed + i,
        );
      }
      // Искры скачут по земле вдоль струи.
      for (let i = 0; i < 12; i++) {
        const aa = a + sgn(seed, i, 10) * half;
        const r = R * (0.25 + 0.65 * rnd(seed, i, 11));
        const sp = 30 + rnd(seed, i, 12) * 60;
        const t = age - rnd(seed, i, 13) * 0.08;
        if (t < 0) continue;
        fly(
          BIT,
          Math.cos(aa) * r,
          Math.sin(aa) * r,
          2,
          Math.cos(aa) * sp,
          Math.sin(aa) * sp,
          40 + rnd(seed, i, 14) * 60,
          G,
          t,
          0.35,
        );
        const k = clamp01(t / 0.7);
        if (k >= 1) continue;
        bit(b, BIT, k < 0.4 ? F_L : F_O, F_R, 1 - k, 1, 0.2, F_D);
      }
    });
  },
});

// Тлеющая лужа — угли там, куда дохнул огонь. Это ещё и ОГОНЬ ДЛЯ ПРИЖИГАНИЯ
// (`fireFor`), поэтому огоньки видны издали: языки, угли, искры вверх.
registerZonePainter('f9_embers', (g, z, px, py, S, time) => {
  const zz = z as Zone;
  const warn = zz.warn ?? 0;
  if (zz.t < warn) return true;
  const u = zz.t - warn;
  const grow = outCubic(u / 0.2);
  const fade = u > zz.life - 1.2 ? clamp01((zz.life - u) / 1.2) : 1;
  const R = zz.r * S;
  const seed = idSeed(zz.id, 3);
  return paint(g, px, py, (b) => {
    // Гарь.
    b.ink(SOOT, 0.6 * fade * grow);
    b.blob(0, 0, R * grow, R * 0.78 * grow, seed, 0.3);
    b.ink(SOOT2, 0.55 * fade * grow);
    b.blob(-1, -1, R * 0.66 * grow, R * 0.5 * grow, seed + 3, 0.3);
    // Угли: трещины дышат жаром, каждая в свой такт.
    for (let i = 0; i < 11; i++) {
      const aa = rnd(seed, i, 1) * TAU;
      const rr = Math.sqrt(rnd(seed, i, 2)) * R * 0.8 * grow;
      const x = Math.cos(aa) * rr;
      const y = Math.sin(aa) * rr * 0.78;
      const heat = 0.5 + 0.5 * Math.sin(time * (2 + rnd(seed, i, 3) * 3) + rnd(seed, i, 4) * 6);
      const c = heat > 0.8 ? F_Y : heat > 0.5 ? F_O : heat > 0.25 ? F_R : F_D;
      b.ink(c, fade);
      b.dot(x, y, i % 3 ? 2 : 1, 1);
    }
    // Языки пламени.
    for (let j = 0; j < 3; j++) {
      const aa = rnd(seed, j, 5) * TAU;
      const rr = rnd(seed, j, 6) * R * 0.45;
      const h = (3 + 4 * vn(seed + j, time * 4)) * fade * grow;
      tongue(b, Math.cos(aa) * rr, Math.sin(aa) * rr * 0.78, h, 3, time * 14 + j * 2, 0.95);
    }
    // Искры взлетают и гаснут.
    for (let j = 0; j < 4; j++) {
      const ph = (time / 0.9 + rnd(seed, j, 7)) % 1;
      const x0 = sgn(seed, j, 8) * R * 0.5;
      b.ink(ph < 0.5 ? F_L : F_O, (1 - ph) * fade);
      b.dot(x0 + Math.sin(ph * 6 + j) * 1.5, -ph * 14 - 2);
    }
  });
});

// ---------------------------------------------------------------------------
// Снаряды: ледяной кристалл и ком яда. Навесом — поэтому направление берётся
// по ЭКРАННОЙ скорости (подъём и падение навеса), хвост тянется за ним.
// Кадры — в кеше (16 направлений × кадры вращения), прогрев — ниже.
// ---------------------------------------------------------------------------

const SHOTS = frameLRU<Sprite>(360);

/** Экранное направление снаряда, 0…15. */
function shotDir(s: Shot): number {
  let vy = s.vy;
  if (s.lob) {
    const k = clamp01(s.age / s.lob.T);
    const H = Math.min(3, s.lob.T * 2.2);
    vy -= (Math.cos(k * Math.PI) * Math.PI * H) / s.lob.T;
  }
  const a = Math.atan2(vy, s.vx);
  return ((Math.round(a / (TAU / 16)) % 16) + 16) % 16;
}

/** Треугольник в холст пикселей (заливка по центрам пикселей). */
function tri(
  p: Px,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  c: RGBA,
): void {
  const x0 = Math.floor(Math.min(ax, bx, cx));
  const x1 = Math.ceil(Math.max(ax, bx, cx));
  const y0 = Math.floor(Math.min(ay, by, cy));
  const y1 = Math.ceil(Math.max(ay, by, cy));
  const e = (x0: number, y0: number, x1: number, y1: number, x: number, y: number) =>
    (x1 - x0) * (y - y0) - (y1 - y0) * (x - x0);
  const area = e(ax, ay, bx, by, cx, cy);
  if (Math.abs(area) < 1e-6) return;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const w0 = e(bx, by, cx, cy, px, py) / area;
      const w1 = e(cx, cy, ax, ay, px, py) / area;
      const w2 = e(ax, ay, bx, by, px, py) / area;
      if (w0 >= -0.01 && w1 >= -0.01 && w2 >= -0.01) p.set(x, y, c);
    }
}

const ICE_T: RGBA[] = [rgb(I_D), rgb(I_M), rgb(I_L), rgb(I_H), rgb(I_W)];
/** Свет сверху-слева: тон грани по её нормали. */
const faceTone = (T: RGBA[], nx: number, ny: number, bias = 0) => {
  const l = -(nx * 0.6 + ny * 0.8) + bias;
  return T[l > 0.55 ? 4 : l > 0.15 ? 3 : l > -0.3 ? 2 : 1];
};

/** Ледяной кристалл: гранёное ядро крутится, три иглы, за ним снежная пыль. */
function iceSprite(d: number, f: number): Sprite {
  const W = 30;
  const c = 15;
  const p = new Px(W, W);
  const a = (d / 16) * TAU;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  // Хвост: иней срывается с кристалла и тает — точки назад по ходу.
  for (let k = 0; k < 6; k++) {
    const dist = 6 + k * 2.2;
    const wob = Math.sin((f + k * 2) * 0.9) * (0.6 + k * 0.35);
    const x = c - ux * dist - uy * wob;
    const y = c - uy * dist + ux * wob;
    const al = Math.round(255 * (1 - k / 6));
    p.set(x, y, k % 2 ? rgb(I_H, al) : rgb(I_W, al));
    if (k < 2) p.set(x - ux, y - uy, rgb(I_L, al));
  }
  // Ядро: шестигранник, грани — треугольники от центра, поворот кадром.
  const spin = (f / 8) * (TAU / 3);
  const V: [number, number][] = [];
  for (let k = 0; k < 6; k++) {
    const ang = spin + (k / 6) * TAU;
    const r = k % 2 ? 3.4 : 4.4;
    V.push([c + Math.cos(ang) * r, c + Math.sin(ang) * r * 0.9]);
  }
  for (let k = 0; k < 6; k++) {
    const [x0, y0] = V[k];
    const [x1, y1] = V[(k + 1) % 6];
    const mx = (x0 + x1) / 2 - c;
    const my = (y0 + y1) / 2 - c;
    const l = Math.hypot(mx, my) || 1;
    tri(p, c, c, x0, y0, x1, y1, faceTone(ICE_T, mx / l, my / l));
  }
  // Иглы: три, крутятся вместе с ядром; светлая сторона — к свету.
  for (let k = 0; k < 3; k++) {
    const ang = spin + (k / 3) * TAU + 0.5;
    const L = 7.5;
    const cx = Math.cos(ang);
    const sy = Math.sin(ang);
    for (let s = 3.5; s <= L; s += 0.5) {
      const col = s > L - 1.2 ? ICE_T[4] : cx * -0.6 + sy * -0.8 > 0 ? ICE_T[3] : ICE_T[2];
      p.set(c + cx * s, c + sy * s * 0.9, col);
    }
  }
  p.outline(rgb('#0c1630', 230));
  // Блик — всегда сверху-слева, не крутится.
  p.set(c - 2, c - 2, ICE_T[4]);
  p.set(c - 1, c - 2, ICE_T[4]);
  p.set(c - 2, c - 1, ICE_T[3]);
  return { img: p.canvas(), ax: c, ay: c + 2 };
}

registerShotPainter('f9_iceball', (s: Shot, time: number) => {
  const d = shotDir(s);
  const f = ((Math.floor(time * 16 + s.id * 3) % 8) + 8) % 8;
  const key = `i|${d}|${f}`;
  return SHOTS.get(key) ?? SHOTS.set(key, iceSprite(d, f));
});

const VEN_T: RGBA[] = [rgb(V_D), rgb(V_M), rgb(V_L), rgb(V_H), rgb(V_W)];

/** Ком яда: дрожит и вытягивается по ходу, внутри пузыри, за ним капли. */
function venomSprite(d: number, f: number): Sprite {
  const W = 26;
  const c = 13;
  const p = new Px(W, W);
  const a = (d / 16) * TAU;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const wob = Math.sin((f / 6) * TAU);
  // Капли позади: отрываются и провисают вниз (тяжёлые).
  const drips: [number, number, number][] = [
    [6, 1.6, 0],
    [9, 1.1, 1],
    [12, 0.7, 2],
  ];
  for (const [dist, r, k] of drips) {
    const sag = ((f + k * 2) % 6) * 0.35 + k * 0.5;
    const lat = Math.sin((f + k * 3) * 1.1) * 0.8;
    p.ell(c - ux * dist - uy * lat, c - uy * dist + ux * lat + sag, r, r, VEN_T[k === 0 ? 2 : 3]);
  }
  // Тело: эллипс по ходу, свет сверху-слева по нормали.
  const rx = 4.4 + wob * 0.6;
  const ry = 3.4 - wob * 0.45;
  for (let y = 0; y < W; y++)
    for (let x = 0; x < W; x++) {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      const al = dx * ux + dy * uy;
      const ac = -dx * uy + dy * ux;
      const q = (al / rx) ** 2 + (ac / ry) ** 2;
      if (q > 1) continue;
      const nz = Math.sqrt(1 - q);
      const l = -(dx * 0.55 + dy * 0.75) / 4 + nz * 0.45;
      p.set(x, y, VEN_T[l > 0.75 ? 3 : l > 0.35 ? 2 : l > 0.02 ? 1 : 0]);
    }
  // Пузыри внутри — ползут по кругу.
  for (let k = 0; k < 2; k++) {
    const ang = (f / 6) * TAU + k * Math.PI;
    p.set(c + Math.cos(ang) * 1.8, c + Math.sin(ang) * 1.3, VEN_T[4]);
  }
  p.outline(rgb('#081404', 235));
  p.set(c - 2, c - 2, rgb(WHITE));
  p.set(c - 1, c - 2, VEN_T[4]);
  return { img: p.canvas(), ax: c, ay: c + 2 };
}

registerShotPainter('f9_venomglob', (s: Shot, time: number) => {
  const d = shotDir(s);
  const f = ((Math.floor(time * 12 + s.id * 2) % 6) + 6) % 6;
  const key = `v|${d}|${f}`;
  return SHOTS.get(key) ?? SHOTS.set(key, venomSprite(d, f));
});

// ---------------------------------------------------------------------------
// Лёд — место падения `f9_frost` (r 1,25, метка = полёт шара, потом лёд 5 с)
// и контакт `f9_iceball`. Метка: снежинка из центра растёт лучами и дотягивается
// до края ровно в миг падения; край пунктиром крутится, в тревоге горит
// белым. Контакт — ЛЕДЯНОЙ ЦВЕТОК: из точки падения выстреливают кристаллы
// (с перелётом, `outBack`), стоят полсекунды и лопаются осколками, которые
// падают, отскакивают и тают. Под ними — ледяная корка, трещины, блики.
// ---------------------------------------------------------------------------

/** Снежинка: шесть лучей с веточками, длина `L`. */
function snowflake(b: Brush, L: number, rot: number, c: string, a: number): void {
  if (L < 1) return;
  b.ink(c, a);
  for (let k = 0; k < 6; k++) {
    const ang = rot + (k / 6) * TAU;
    const cx = Math.cos(ang);
    const sy = Math.sin(ang);
    b.line(0, 0, cx * L, sy * L);
    for (let s = 4; s < L - 1; s += 4) {
      const tl = Math.min(3, (L - s) * 0.5);
      for (const side of [-1, 1]) {
        const ta = ang + side * 0.8;
        b.line(cx * s, sy * s, cx * s + Math.cos(ta) * tl, sy * s + Math.sin(ta) * tl);
      }
    }
  }
}

const CRUSTS = frameLRU<HTMLCanvasElement>(48);

/** Ледяная корка радиуса rr: подложка, блики, кромка, снежинка, трещины. */
function frostCrust(seed: number, rr: number): HTMLCanvasElement {
  const key = `${seed}|${rr}`;
  const hit = CRUSTS.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = rr * 2 + 4;
  c.height = rr * 2 + 4;
  const cg = c.getContext('2d');
  if (!cg) return c;
  const b = new Brush(cg, rr + 2, rr + 2);
  b.ink(I_D, 0.45);
  b.blob(0, 1, rr, rr * 0.92, seed, 0.18);
  b.ink(I_M, 0.3);
  b.blob(0, 0, rr - 1, rr * 0.9 - 1, seed, 0.18);
  b.ink(I_L, 0.22);
  b.blob(-rr * 0.2, -rr * 0.25, rr * 0.55, rr * 0.4, seed + 5, 0.25);
  b.ink(I_H, 0.7);
  b.torn(0, 0, rr - 1, 0.92, seed + 2, 0.6);
  snowflake(b, rr * 0.85, 0.3, I_H, 0.4);
  b.ink(I_W, 0.5);
  for (let i = 0; i < 4; i++) {
    const ang = rnd(seed, i, 1) * TAU;
    let x = 0;
    let y = 0;
    for (let s = 0; s < rr * 0.8; s += 3) {
      const nx = x + Math.cos(ang + sgn(seed, i * 9 + s, 2) * 0.5) * 3;
      const ny = y + Math.sin(ang + sgn(seed, i * 9 + s, 2) * 0.5) * 3;
      b.line(x, y, nx, ny);
      x = nx;
      y = ny;
    }
  }
  cg.globalAlpha = 1;
  return CRUSTS.set(key, c);
}

registerZonePainter('f9_frost', (g, z, px, py, S, time) => {
  const zz = z as Zone;
  const warn = zz.warn ?? 0;
  const R = zz.r * S;
  const seed = idSeed(zz.id, 4);
  return paint(g, px, py, (b) => {
    if (zz.t < warn) {
      const w = whenOf(zz);
      // Иней растёт из центра — таймер падения.
      const rf = R * (0.1 + 0.9 * w.k);
      b.ink(I_M, 0.12 + 0.14 * w.k);
      b.blob(0, 0, rf, rf);
      snowflake(b, rf * 0.95, 0.3 + time * 0.25, I_H, 0.35 + 0.5 * w.k);
      // Край: всё место видно сразу.
      if (w.alarm) {
        b.ink(blink(time) ? I_W : I_H, 1);
        b.ring(0, 0, R);
        b.ink(I_L, 0.8);
        b.ring(0, 0, R + 1);
      } else {
        b.ink(I_L, 0.45 + 0.4 * w.k);
        b.ring(0, 0, R, 1, 0, TAU, 3, time * 5);
      }
      return;
    }
    // Лёд лежит: корка, трещины, блики; тает в конце. Корка неподвижна —
    // рисуется один раз на размер в холст и кладётся картинкой.
    const u = zz.t - warn;
    const grow = 0.45 + 0.55 * outCubic(u / 0.12);
    const fade = u > zz.life - 1.2 ? clamp01((zz.life - u) / 1.2) : 1;
    const rr = Math.round(R * grow * (0.7 + 0.3 * fade));
    const crust = frostCrust(seed, rr);
    const sc = g.getTransform().a || 1;
    g.globalAlpha = fade;
    g.drawImage(crust, Math.round((px - rr - 2) * sc) / sc, Math.round((py - rr - 2) * sc) / sc);
    g.globalAlpha = 1;
    // Блики перебегают по корке.
    for (let i = 0; i < 2; i++) {
      const ph = (time * 0.7 + i * 0.5 + rnd(seed, i, 3)) % 1;
      if (ph > 0.35) continue;
      const ang = rnd(seed, i + Math.floor(time * 0.7 + i * 0.5), 4) * TAU;
      const r = rr * 0.6 * rnd(seed, i, 5);
      twinkle(
        b,
        Math.cos(ang) * r,
        Math.sin(ang) * r * 0.9,
        I_H,
        fade * Math.sin((ph / 0.35) * Math.PI),
        ph > 0.1 && ph < 0.25,
      );
    }
  });
});

/**
 * Кристалл цветка: растёт из (x, y) под углом `tilt` от вертикали, длина
 * `len`, у основания ширина `w`. Левая грань светлая, правая — в тени, по
 * краю тёмный кант, остриё белое.
 */
function crystal(
  b: Brush,
  x: number,
  y: number,
  len: number,
  tilt: number,
  w: number,
  a: number,
): void {
  if (len < 1) return;
  const dx = Math.sin(tilt);
  const dy = -Math.cos(tilt);
  const n = Math.ceil(len);
  const wOf = (s: number) => Math.max(1, Math.round(w * (1 - s / (len + 1)) ** 0.75));
  // Кант: на точку шире с каждой стороны — кристалл отделён от льда под ним.
  b.ink('#0a1228', a * 0.9);
  for (let s = -1; s <= n; s++) {
    const ws = wOf(Math.max(0, s)) + 2;
    b.dot(x + dx * s - ws / 2 + 0.5, y + dy * s, ws, 1);
  }
  for (let s = 0; s < n; s++) {
    const ws = wOf(s);
    const cx = x + dx * s;
    const cy = y + dy * s;
    const x0 = cx - ws / 2 + 0.5;
    const l = Math.max(1, Math.floor(ws / 2));
    // Грань в тени — справа, на свету — слева, ребро — белой нитью.
    b.ink(I_M, a);
    b.dot(x0, cy, ws, 1);
    b.ink(s > len * 0.6 ? I_H : I_L, a);
    b.dot(x0, cy, l, 1);
    b.ink(I_W, a);
    b.dot(x0 + l - 1, cy);
  }
  b.ink(WHITE, a);
  b.dot(x + dx * (n - 1), y + dy * (n - 1));
  b.dot(x + dx * (n - 2) - 1, y + dy * (n - 2));
}

/** Лепестки ледяного цветка: место, длина, наклон, ширина. Задние — первыми. */
const FLOWER = [
  { x: -3, y: -2, len: 15, tilt: -0.38, w: 5 },
  { x: 4, y: -2, len: 16, tilt: 0.42, w: 5 },
  { x: -7, y: 1, len: 11, tilt: -0.95, w: 4 },
  { x: 7, y: 1, len: 10, tilt: 1.0, w: 4 },
  { x: 0, y: 0, len: 22, tilt: 0.05, w: 6 },
  { x: -3, y: 3, len: 9, tilt: -0.6, w: 4 },
  { x: 3, y: 3, len: 8, tilt: 0.65, w: 4 },
];

registerImpactPainter('f9_iceball', {
  life: 1.4,
  shake: 0.15,
  paint(g, rec, px, py, S, age) {
    const seed = rec.seed;
    return paint(g, px, py, (b) => {
      // Удар: белый блин и кольцо инея.
      if (age < 0.1) {
        const k = age / 0.1;
        b.ink(WHITE, 0.9 * (1 - k));
        b.blob(0, 0, 5 + 7 * k, 3.5 + 5 * k, seed, 0.2);
      }
      if (age < 0.3) {
        const k = age / 0.3;
        b.ink(I_H, 0.9 * (1 - k));
        b.torn(0, 0, 6 + 18 * outCubic(k), 0.8, seed, 0.7, k < 0.3 ? 2 : 1);
      }
      const grow = outBack(age / 0.1, 2.2);
      const stand = age < 0.55;
      // Лучи по земле: ледяные иглы плашмя, тают после раскола.
      const melt = clamp01((age - 0.55) / 0.45);
      if (melt < 1)
        for (let i = 0; i < 7; i++) {
          const ang = (i / 7) * TAU + rnd(seed, i, 1) * 0.5;
          const L = (8 + rnd(seed, i, 2) * 8) * grow;
          const cx = Math.cos(ang);
          const sy = Math.sin(ang) * 0.6;
          for (let s = 2; s < L; s += 1) {
            const edge = s > L - 2;
            b.ink(edge ? I_W : s % 3 ? I_L : I_H, 1 - melt);
            b.dot(cx * s, sy * s);
            if (s < L * 0.5) {
              b.ink(I_M, (1 - melt) * 0.9);
              b.dot(cx * s - sy, sy * s + cx * 0.6);
            }
          }
        }
      // Цветок: кристаллы выстреливают из земли с перелётом, стоят, дрожат
      // перед расколом и лопаются осколками.
      if (stand) {
        b.ink('#0a1228', 0.35);
        b.blob(0, 1, 10 * grow, 4 * grow);
        const shiver = age > 0.45 ? (Math.floor(age * 48) % 2 ? 1 : -1) * 0.6 : 0;
        FLOWER.forEach((q, k) => {
          // В кадр удара цветок уже на трети роста — вылетает из земли.
          const gk = outBack((age + 0.035 - k * 0.012) / 0.1, 2.4);
          crystal(b, q.x + shiver, q.y, q.len * gk, q.tilt, q.w, 1);
        });
      } else {
        FLOWER.forEach((q, k) => {
          for (let j = 0; j < 3; j++) {
            const i = k * 3 + j;
            const t = age - 0.55;
            const hz = (q.len * (j + 0.5)) / 3;
            const ang = Math.atan2(q.y + 0.5, q.x + 0.5) + sgn(seed, i, 7) * 1.2;
            const sp = 25 + rnd(seed, i, 8) * 45;
            fly(
              BIT,
              q.x + Math.sin(q.tilt) * hz,
              q.y,
              Math.cos(q.tilt) * hz,
              Math.cos(ang) * sp,
              Math.sin(ang) * sp * 0.7,
              30 + rnd(seed, i, 9) * 60,
              G,
              t,
              0.3,
            );
            const a = 1 - clamp01((t - 0.22) / 0.3);
            if (a <= 0) continue;
            b.ink('#0a1228', a * 0.8);
            b.dot(BIT.x - 1, BIT.y - BIT.z - 1, 4, 3);
            b.ink(j === 2 ? I_W : I_H, a);
            b.dot(BIT.x, BIT.y - BIT.z, 2, 1);
            b.ink(I_L, a);
            b.dot(BIT.x, BIT.y - BIT.z + 1, 2, 1);
          }
        });
      }
      // Морозный пар стелется и тает.
      for (let i = 0; i < 6; i++) {
        const u = age - rnd(seed, i, 10) * 0.05;
        if (u < 0 || u > 0.7) continue;
        const ang = rnd(seed, i, 11) * TAU;
        const d = 4 + 14 * outCubic(u / 0.6);
        puff(
          b,
          Math.cos(ang) * d,
          Math.sin(ang) * d * 0.6 - u * 4,
          2 + u * 6,
          I_L,
          I_W,
          0.32 * (1 - u / 0.7),
          seed + i,
        );
      }
    });
  },
});

// ---------------------------------------------------------------------------
// Яд — контакт кома `f9_venomglob`. Шлепок звездой с пальцами по ходу
// полёта, брызги летят вперёд и прожигают пятнышки, над местом шипит
// зелёный дымок, лопаются пузыри. Сама лужа — общая (`f9_venom`, `f9-art`).
// ---------------------------------------------------------------------------

registerImpactPainter('f9_venomglob', {
  life: 1.2,
  shake: 0.1,
  paint(g, rec, px, py, S, age) {
    const seed = rec.seed;
    const vx = rec.vx ?? 1;
    const vy = rec.vy ?? 0;
    const sp0 = Math.hypot(vx, vy) || 1;
    const ux = vx / sp0;
    const uy = vy / sp0;
    return paint(g, px, py, (b) => {
      // Шлепок: пятно с пальцами, вытянутыми по ходу, уходит в лужу.
      const grow = 0.45 + 0.55 * outCubic(age / 0.1);
      const fade = 1 - clamp01((age - 0.15) / 0.4);
      if (fade > 0) {
        b.ink(V_M, 0.9 * fade);
        b.blob(ux * 2, uy * 2, 7 * grow, 5 * grow, seed, 0.25);
        for (let i = 0; i < 7; i++) {
          const ang = Math.atan2(uy, ux) + sgn(seed, i, 1) * 1.4;
          const L =
            (5 + rnd(seed, i, 2) * 7) * grow * (0.6 + 0.4 * Math.cos(ang - Math.atan2(uy, ux)));
          const c = Math.cos(ang);
          const s = Math.sin(ang);
          for (let r = 4; r < 4 + L; r += 1) {
            b.ink(r > 2 + L ? V_H : V_L, fade);
            b.dot(c * r, s * r * 0.75);
          }
          b.ink(V_H, fade);
          b.sq(c * (4 + L), s * (4 + L) * 0.75, 2);
        }
        b.ink(V_H, 0.8 * fade);
        b.blob(-1, -1, 3.5 * grow, 2.5 * grow, seed + 2, 0.2);
      }
      // Брызги вперёд по ходу, падают и шипят пятнышками.
      for (let i = 0; i < 12; i++) {
        const ang = Math.atan2(uy, ux) + sgn(seed, i, 3) * 1.1;
        const sp = 30 + rnd(seed, i, 4) * 50;
        fly(
          BIT,
          0,
          0,
          2,
          Math.cos(ang) * sp,
          Math.sin(ang) * sp * 0.75,
          50 + rnd(seed, i, 5) * 60,
          G,
          age,
        );
        bit(b, BIT, V_H, V_L, 1, i % 4 ? 1 : 2, 0.7, V_M);
      }
      // Шипит: зелёно-серый дымок поднимается и тает.
      for (let i = 0; i < 5; i++) {
        const u = age - 0.08 - rnd(seed, i, 6) * 0.2;
        if (u < 0 || u > 0.9) continue;
        const x = sgn(seed, i, 7) * 7 + Math.sin(u * 5 + i) * 1.5;
        puff(b, x, -u * 16 - 2, 1.5 + u * 4, '#3a4a30', '#6a7a58', 0.45 * (1 - u / 0.9), seed + i);
      }
      // Пузыри лопаются колечками.
      for (let i = 0; i < 4; i++) {
        const t0 = 0.15 + rnd(seed, i, 8) * 0.6;
        const u = age - t0;
        if (u < 0 || u > 0.18) continue;
        const x = sgn(seed, i, 9) * 6;
        const y = sgn(seed, i, 10) * 4;
        b.ink(V_W, 1 - u / 0.18);
        b.ring(x, y, 1 + u * 12, 0.7);
      }
    });
  },
});

// ---------------------------------------------------------------------------
// Гроза — линия `f9_bolt` (r 9, полуширина 0,42). Метка: вся дорога видна
// сразу (тёмная полоса, края пунктиром бегут от пасти), заряд течёт от
// пасти к концу ровно к удару, в заряженной части пляшет статика; в тревоге
// по оси ищет дорогу тонкий «лидер» — каждый кадр новый. Контакт (поверх
// темноты): ломаная молния из пасти до конца с ветвями, ядро белое, ореол
// лиловый; через 0,12 с — повторный разряд по новой дорожке, потом тает.
// След на полу — зона мозга `f9_boltscar`: выжженный зигзаг тлеет и гаснет.
// ---------------------------------------------------------------------------

registerZonePainter('f9_bolt', (g, z, px, py, S, time) => {
  const st = z as Strike;
  const w = whenOf(st);
  const L = st.r * S;
  const hw = (st.w ?? 0.42) * S;
  const a = st.ang ?? 0;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const nx = -uy;
  const ny = ux;
  const seed = idSeed(st.id, 5);
  return paint(g, px, py, (b) => {
    b.ink(B_D, 0.2 + 0.12 * w.k);
    b.band(ux, uy, 4, L, hw);
    // Заряд — таймер от пасти к концу.
    const lf = 4 + (L - 4) * w.k;
    b.ink(B_M, 0.22 + 0.18 * w.k + (w.alarm ? 0.15 : 0));
    b.band(ux, uy, 4, lf, hw * 0.75);
    // Края.
    for (const s of [-1, 1]) {
      const ex = nx * s * hw;
      const ey = ny * s * hw;
      if (w.alarm) {
        b.ink(blink(time) ? WHITE : B_Y, 1);
        b.line(ex + ux * 4, ey + uy * 4, ex + ux * L, ey + uy * L);
      } else {
        b.ink(B_L, 0.45 + 0.4 * w.k);
        b.dashed(ex + ux * 4, ey + uy * 4, ex + ux * L, ey + uy * L, 3, -time * 6);
      }
    }
    // Торец: скобка в конце дороги.
    b.ink(w.alarm ? B_Y : B_L, 0.5 + 0.4 * w.k);
    b.line(ux * L + nx * hw, uy * L + ny * hw, ux * L - nx * hw, uy * L - ny * hw);
    // Статика: короткие зигзаги поперёк заряженной части, 12 раз в секунду.
    const gen = Math.floor(time * 12);
    for (let i = 0; i < 6; i++) {
      const s = 6 + rnd(seed + gen, i, 1) * (lf - 6);
      if (s > lf) continue;
      let x0 = ux * s - nx * hw * 0.9;
      let y0 = uy * s - ny * hw * 0.9;
      b.ink(i % 2 ? B_Y : B_L, 0.75);
      for (let j = 1; j <= 3; j++) {
        const o = -hw * 0.9 + (hw * 1.8 * j) / 3;
        const ss = s + sgn(seed + gen, i * 5 + j, 2) * 2.5;
        const x1 = ux * ss + nx * o;
        const y1 = uy * ss + ny * o;
        b.line(x0, y0, x1, y1);
        x0 = x1;
        y0 = y1;
      }
    }
    // Лидер: молния ищет дорогу — тонкая ломаная по оси, в тревоге.
    if (w.alarm) {
      const g2 = Math.floor(time * 24);
      const reach = L * (0.4 + 0.6 * w.a);
      let x0 = ux * 4;
      let y0 = uy * 4;
      b.ink(g2 % 2 ? B_Y : WHITE, 0.35 + 0.6 * w.a);
      for (let s = 9; s <= reach; s += 5) {
        const o = sgn(seed + g2, s, 3) * hw * 0.7;
        const x1 = ux * s + nx * o;
        const y1 = uy * s + ny * o;
        b.line(x0, y0, x1, y1);
        x0 = x1;
        y0 = y1;
      }
    }
  });
});

/** Дорожка молнии: точки от пасти (поднята) к концу по полу. */
function boltPath(
  L: number,
  a: number,
  hw: number,
  seed: number,
  gen: number,
  mx: number,
  my: number,
): [number, number][] {
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const nx = -uy;
  const ny = ux;
  const pts: [number, number][] = [];
  const n = Math.max(4, Math.ceil(L / 5));
  // Блуждание, а не пила: шаг вбок от прошлой точки, изредка — резкий излом.
  let o = 0;
  for (let i = 0; i <= n; i++) {
    const s = (L * i) / n;
    const f = Math.min(1, s / 28);
    if (i > 0 && i < n) {
      const big = rnd(seed + gen * 7, i, 2) > 0.82;
      o += sgn(seed + gen * 7, i, 1) * hw * (big ? 1.7 : 0.7);
      o = Math.max(-hw * 1.5, Math.min(hw * 1.5, o * 0.9));
    } else o = 0;
    pts.push([mx * (1 - f) + ux * s + nx * o, my * (1 - f) - 4 * f + uy * s + ny * o]);
  }
  return pts;
}

registerImpactPainter('f9_bolt', {
  life: 0.6,
  shake: 0.3,
  flash: 0.16,
  flashRgb: '255,250,190',
  above: true,
  paint(g, rec, px, py, S, age) {
    const L = (rec.r ?? 9) * S;
    const a = rec.ang ?? 0;
    const hw = (rec.w ?? 0.42) * S;
    const seed = rec.seed;
    const [mx, my] = mouthOf(a);
    return paint(g, px, py, (b) => {
      // Разряд, пауза, повторный разряд по новой дорожке, угасание.
      const gen = age < 0.12 ? 0 : 1;
      const on = age < 0.07 || (age > 0.12 && age < 0.17);
      const k = age < 0.17 ? (on ? 1 : 0.35) : 1 - clamp01((age - 0.17) / 0.33);
      if (k <= 0) return;
      const pts = boltPath(L, a, hw, seed, gen, mx, my);
      const seg = (w: number, c: string, al: number) => {
        b.ink(c, al);
        for (let i = 1; i < pts.length; i++)
          b.line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], w);
      };
      if (on || age >= 0.17) {
        seg(5, B_M, 0.35 * k);
        seg(3, B_L, 0.8 * k);
        seg(age < 0.3 ? 2 : 1, age < 0.3 ? WHITE : B_Y, k);
      } else seg(1, B_L, k);
      // Ветви: отходят от излома, тоньше, гаснут быстрее.
      const bk = 1 - clamp01((age - 0.05) / 0.25);
      if (bk > 0)
        for (let j = 0; j < 4; j++) {
          const at = 1 + Math.floor(rnd(seed + gen, j, 5) * (pts.length - 2));
          let [x0, y0] = pts[at];
          const ba =
            a + (rnd(seed + gen, j, 6) > 0.5 ? 1 : -1) * (0.5 + rnd(seed + gen, j, 7) * 0.5);
          const len = 10 + rnd(seed + gen, j, 8) * 14;
          b.ink(j % 2 ? B_Y : WHITE, bk);
          for (let q = 1; q <= 3; q++) {
            const s = (len * q) / 3;
            const o = sgn(seed + gen, j * 4 + q, 9) * 3;
            const x1 = pts[at][0] + Math.cos(ba) * s - Math.sin(ba) * o;
            const y1 = pts[at][1] + Math.sin(ba) * s + Math.cos(ba) * o;
            b.line(x0, y0, x1, y1);
            x0 = x1;
            y0 = y1;
          }
        }
      // Конец: вспышка и искры рассыпаются по полу.
      const ex = Math.cos(a) * L;
      const ey = Math.sin(a) * L;
      if (age < 0.12) {
        // Вспышка на конце — звездой, не кругом.
        const k = 1 - age / 0.12;
        b.ink(B_Y, k);
        for (let i = 0; i < 6; i++) {
          const ang = (i / 6) * TAU + rnd(seed, i, 13);
          const L = 4 + 6 * k * (i % 2 ? 0.6 : 1);
          b.line(ex, ey - 2, ex + Math.cos(ang) * L, ey - 2 + Math.sin(ang) * L);
        }
        b.ink(WHITE, k);
        b.blob(ex, ey - 2, 2, 2);
      }
      for (let i = 0; i < 10; i++) {
        const ang = rnd(seed, i, 10) * TAU;
        const sp = 40 + rnd(seed, i, 11) * 70;
        fly(
          BIT,
          ex,
          ey,
          4,
          Math.cos(ang) * sp,
          Math.sin(ang) * sp * 0.7,
          40 + rnd(seed, i, 12) * 80,
          G,
          age,
          0.4,
        );
        bit(b, BIT, i % 2 ? B_Y : WHITE, B_L, 1 - clamp01(age / 0.6), 1, 0.15, B_L);
      }
    });
  },
});

// Выжженный след молнии на полу — зона мозга, в кадр удара (warn = метке).
registerZonePainter('f9_boltscar', (g, z, px, py, S, time) => {
  const zz = z as ZX;
  const warn = zz.warn ?? 0;
  if (!aliveAtHit(zz) || zz.t < warn) return true;
  const u = zz.t - warn;
  const L = zz.r * S;
  const a = zz.ang ?? 0;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const seed = idSeed(zz.id, 6);
  const fade = 1 - clamp01((u - 0.5) / (zz.life - 0.5));
  const glow = 1 - clamp01(u / 0.5);
  return paint(g, px, py, (b) => {
    let x0 = ux * 20;
    let y0 = uy * 20;
    for (let s = 24; s <= L; s += 4) {
      const o = sgn(seed, s, 1) * 3;
      const x1 = ux * s - uy * o;
      const y1 = uy * s + ux * o;
      b.ink(SOOT, 0.6 * fade);
      b.line(x0, y0, x1, y1, 2);
      if (glow > 0) {
        b.ink(s % 8 ? B_L : B_Y, glow);
        b.line(x0, y0, x1, y1);
      }
      x0 = x1;
      y0 = y1;
    }
    // Дымки над выжженным.
    for (let i = 0; i < 3; i++) {
      const s = L * (0.3 + 0.25 * i);
      const v = u - i * 0.08;
      if (v < 0 || v > 0.9) continue;
      puff(
        b,
        ux * s + Math.sin(time * 3 + i) * 1.5,
        uy * s - v * 14 - 2,
        1.5 + v * 4,
        SMOKE[0],
        SMOKE[2],
        0.4 * (1 - v / 0.9),
        seed + i,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Свет — вспышка `f9_glare` (круг r 2,2 вокруг белой головы). Метка: круг
// рун крутится, с края к голове по спицам текут огоньки — свет собирается в
// пасть; золото наливается от середины к краю; в тревоге в центре растёт
// белое ядро и край мигает. Контакт (поверх темноты): белый диск, двенадцать
// лучей выстреливают и гаснут, по полу бежит кольцо, искры разлетаются.
// ---------------------------------------------------------------------------

registerZonePainter('f9_glare', (g, z, px, py, S, time) => {
  const st = z as Strike;
  const w = whenOf(st);
  const R = st.r * S;
  return paint(g, px, py, (b) => {
    const rf = R * (0.1 + 0.9 * w.k);
    b.ink(L_L, 0.1 + 0.14 * w.k + (w.alarm ? 0.12 : 0));
    b.blob(0, 0, rf, rf);
    // Круг рун: насечки крутятся навстречу краю.
    b.ink(L_M, 0.4 + 0.4 * w.k);
    for (let i = 0; i < 24; i++) {
      const ang = (i / 24) * TAU - time * 0.8;
      const r0 = R * 0.7;
      const l = i % 3 ? 1 : 3;
      b.line(
        Math.cos(ang) * r0,
        Math.sin(ang) * r0,
        Math.cos(ang) * (r0 + l),
        Math.sin(ang) * (r0 + l),
      );
    }
    // Край.
    if (w.alarm) {
      b.ink(blink(time) ? WHITE : L_H, 1);
      b.ring(0, 0, R);
      b.ink(L_L, 0.8);
      b.ring(0, 0, R + 1);
    } else {
      b.ink(L_L, 0.45 + 0.4 * w.k);
      b.ring(0, 0, R, 1, 0, TAU, 4, time * 5);
    }
    // Свет стекается к голове по спицам.
    for (let i = 0; i < 10; i++) {
      const ang = (i / 10) * TAU + 0.3;
      const u = (time * (1 + w.k) + i * 0.37) % 1;
      const r = R * (1 - u);
      b.ink(u > 0.7 ? WHITE : L_H, 0.3 + 0.6 * w.k);
      b.dot(Math.cos(ang) * r, Math.sin(ang) * r);
      b.ink(L_L, 0.25 + 0.4 * w.k);
      b.dot(Math.cos(ang) * (r + 2), Math.sin(ang) * (r + 2));
    }
    if (w.alarm) {
      // Свет собирается в точку: кольцо сжимается к голове.
      b.ink(WHITE, 0.5 + 0.5 * w.a);
      b.ring(0, 0, R * 0.55 * (1 - w.a) + 2, 1);
      b.ink(L_H, 1);
      b.dot(-1, -1, 3, 3);
    }
  });
});

registerImpactPainter('f9_glare', {
  life: 0.65,
  shake: 0.2,
  flash: 0.2,
  flashRgb: '255,245,215',
  above: true,
  paint(g, rec, px, py, S, age) {
    const R = (rec.r ?? 2.2) * S;
    const seed = rec.seed;
    const cy = -12;
    return paint(g, px, py, (b) => {
      // Диск света — во весь круг в кадр контакта, тает за 0,14 с.
      if (age < 0.14) {
        const k = age / 0.14;
        b.ink(L_H, 0.55 * (1 - k));
        b.blob(0, cy * 0.5, R * (0.75 + 0.3 * k), R * (0.65 + 0.25 * k));
        b.ink(WHITE, 0.95 * (1 - k));
        b.blob(0, cy, R * (0.45 + 0.2 * k), R * (0.4 + 0.15 * k));
      }
      // Лучи: восемь клиньев выстреливают с перелётом и гаснут, длинный через
      // короткий; у основания толще.
      const rk = 1 - clamp01((age - 0.06) / 0.34);
      if (rk > 0) {
        b.ink(L_H, rk);
        b.blob(0, 0, 3 + 2 * rk, 2 + 2 * rk);
        b.ink(WHITE, rk);
        b.blob(0, 0, 1.5 + rk, 1 + rk);
      }
      if (rk > 0)
        for (let i = 0; i < 8; i++) {
          const ang = (i / 8) * TAU + 0.2;
          const L = R * 1.4 * outBack(age / 0.15, 1.2) * (i % 2 ? 0.6 : 1);
          const c = Math.cos(ang);
          const s = Math.sin(ang);
          b.ink(L_L, rk * 0.8);
          b.band(c, s, 4, L * 0.55, 2);
          b.ink(L_H, rk);
          b.band(c, s, 4, L * 0.8, 1);
          b.line(c * 4, s * 4, c * L, s * L);
          b.ink(WHITE, rk);
          b.line(c * 4, s * 4, c * L * 0.5, s * L * 0.5);
        }
      // Кольцо по полу.
      if (age < 0.35) {
        const k = age / 0.35;
        b.ink(L_H, 0.9 * (1 - k));
        b.torn(0, 0, R * (0.3 + 1.1 * outCubic(k)), 1, seed, 0.7, k < 0.3 ? 2 : 1);
      }
      // Искры разлетаются и поднимаются.
      for (let i = 0; i < 14; i++) {
        const ang = rnd(seed, i, 2) * TAU;
        const d = 8 + R * 0.9 * outCubic(age / 0.6) * (0.5 + rnd(seed, i, 3) * 0.5);
        const al = 1 - clamp01(age / 0.65);
        twinkle(
          b,
          Math.cos(ang) * d,
          cy + Math.sin(ang) * d * 0.8 - age * 12,
          L_L,
          al,
          i % 4 === 0,
        );
      }
    });
  },
});

// ---------------------------------------------------------------------------
// Лечение белой головы: луч к раненой голове (зона мозга `f9_healbeam`
// поверх темноты, пока голова в режиме `heal`) и вспышка исцеления
// `f9_healed`. Луч — две золотые нити вьются вокруг белого ядра, огоньки
// бегут к цели, над целью венец; всё ярче к концу 1,4 с. Красной линии
// движка нет (`vNoTele`).
// ---------------------------------------------------------------------------

registerZonePainter('f9_healbeam', (g, z, px, py, S, time) => {
  const zz = z as ZX;
  const m = mobById(zz.from);
  const tg = mobById(zz.tgt);
  if (!m || m.mode !== 'heal' || !tg || tg.mode === 'dying') return true;
  const k = clamp01(m.t / 1.4);
  const face = Math.atan2(tg.y - m.y, tg.x - m.x);
  const [mx, my] = mouthOf(face);
  const x0 = (m.x - zz.x) * S + mx;
  const y0 = (m.y - zz.y) * S + my;
  const x1 = (tg.x - zz.x) * S;
  const y1 = (tg.y - zz.y) * S - 18;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L;
  const uy = dy / L;
  return paint(g, px, py, (b) => {
    // Нити.
    for (let s = 0; s <= L; s += 1) {
      const env = Math.sin((s / L) * Math.PI);
      for (const ph of [0, Math.PI]) {
        const o = Math.sin(s * 0.3 - time * 14 + ph) * (1.2 + 2 * k) * env;
        b.ink(ph ? L_L : L_H, 0.4 + 0.45 * k);
        b.dot(x0 + ux * s - uy * o, y0 + uy * s + ux * o);
      }
    }
    // Ядро.
    b.ink(WHITE, 0.25 + 0.65 * k);
    b.line(x0, y0, x1, y1, k > 0.7 ? 2 : 1);
    // Огоньки бегут к цели.
    for (let i = 0; i < 5; i++) {
      const u = (time * 1.6 + i / 5) % 1;
      twinkle(b, x0 + dx * u, y0 + dy * u, L_L, 0.5 + 0.5 * k, false);
    }
    // Свет в пасти целителя и венец над целью.
    b.ink(L_H, 0.7 + 0.3 * k);
    b.blob(x0, y0, 1.5 + 1.5 * k, 1.5 + 1.5 * k);
    b.ink(L_H, 0.4 + 0.5 * k);
    b.ring(x1, y1 - 2, 6 + Math.sin(time * 10) * 1.2, 0.5, 0, TAU, 2, time * 6);
    for (let i = 0; i < 3; i++) {
      const u = (time * 0.9 + i / 3) % 1;
      b.ink(WHITE, (0.4 + 0.5 * k) * (1 - u));
      b.dot(x1 - 4 + i * 4, y1 - 4 - u * 10);
    }
  });
});

registerZonePainter('f9_healed', (g, z, px, py, S, time) => {
  const zz = z as Zone;
  const u = clamp01(zz.t / Math.max(0.01, zz.life));
  const seed = idSeed(zz.id, 7);
  return paint(g, px, py, (b) => {
    // Столб света над исцелённой головой.
    const w = Math.max(1, Math.round(6 * (1 - u)));
    b.ink(L_H, 0.55 * (1 - u));
    b.dot(-w / 2, -40, w, 40);
    b.ink(WHITE, 0.8 * (1 - u));
    b.dot(-0.5, -40 + u * 20, 1, 40 - u * 20);
    // Кольцо по полу.
    b.ink(L_H, 0.9 * (1 - u));
    b.ring(0, 0, 5 + 16 * outCubic(u), 0.6);
    // Искры поднимаются.
    for (let i = 0; i < 10; i++) {
      const x = sgn(seed, i, 1) * 10;
      const y = -8 - (10 + rnd(seed, i, 2) * 24) * outCubic(u) - rnd(seed, i, 3) * 6;
      twinkle(b, x + Math.sin(time * 6 + i) * 1.5, y, L_L, 1 - u, i % 3 === 0);
    }
  });
});

// ---------------------------------------------------------------------------
// Хвост из воды — конус `f9_tail` от тела (r 8,5, дуга 1,25, метка 1,15 с),
// самый тяжёлый удар. Три слоя:
//   • метка на полу: весь клин виден сразу; вода темнеет от тела к краю —
//     фронт пены доходит до края ровно к удару; по дуге бегут шевроны
//     в сторону взмаха; в тревоге край горит;
//   • хвост (зона мозга `f9_tailfx`, под мобами: головы парят над ним, тело
//     закрывает корень — глубина читается верно): поднимается из воды за
//     начальным краем клина и взводится назад (замах), в тревоге дрожит; в
//     кадр урона он уже у дальнего края — взмах со смазом, перелёт на 0,4
//     рад, кончик отстаёт, потом тонет; вал воды с пенным гребнем бежит по
//     клину и рвётся на брызги, в конце взмаха — шлепок;
//   • контакт на полу: мокрый клин и смаз по воде, сохнут.
// Куда метёт — знак от угла удара (метка, хвост и контакт считают одинаково).
// ---------------------------------------------------------------------------

/** От середины тела до корня хвоста, px. */
const TAIL_RB = 26;
const BELLY = '#948e54';
const BELLY_L = '#bcb67a';

/**
 * Стенка кольцом (вода, ил) вокруг (cx, cy): встаёт за `rise`, раскрывается
 * от r0 до r1 и опадает за `fall`; верх — зубцами по шуму, к концу рвётся
 * на струи (сперва тонкие места).
 */
function wall(
  b: Brush,
  cx: number,
  cy: number,
  seed: number,
  age: number,
  r0: number,
  r1: number,
  H: number,
  rise: number,
  fall: number,
  dark: string,
  mid: string,
  top: string,
): void {
  if (age >= rise + fall || age < 0) return;
  const h0 = H * (age < rise ? outCubic(age / rise) : 1 - inQuad((age - rise) / fall));
  const rc = r0 + (r1 - r0) * outCubic(age / (rise + fall));
  const tear = 0.1 + clamp01((age - rise * 0.6) / fall);
  const n = Math.max(12, Math.ceil(TAU * rc));
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * TAU;
    const q = vn(seed, (i / n) * 16, 16);
    if (q < tear) continue;
    const h = Math.round(h0 * (0.3 + 0.8 * q));
    if (h < 1) continue;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const x = cx + Math.round(c * rc);
    const y = cy + Math.round(s * rc * 0.8);
    const hb = Math.max(1, Math.round(h * 0.45));
    b.ink(dark, 0.95);
    b.dot(x, y - hb + 1, 2, hb);
    if (h > hb) {
      b.ink(mid, 0.95);
      b.dot(x + c * h * 0.15, y - h + 1, 2, h - hb);
    }
    b.ink(top, 1);
    b.dot(x + c * h * 0.3, y - h, 2, 1);
  }
}
const sweepOf = (a: number) => (((Math.round(a * 1000) % 2) + 2) % 2 ? 1 : -1);

/**
 * Хвост: корень у тела под углом `th`, длина до `reach`; `rise` — насколько
 * поднят из воды (0…1); `bend` — изгиб к кончику (рад, со знаком); `al` —
 * прозрачность; `jit` — дрожь замаха.
 */
function tail(
  b: Brush,
  th: number,
  reach: number,
  rise: number,
  bend: number,
  time: number,
  al: number,
  jit = 0,
): void {
  if (al <= 0.01 || rise <= 0.01) return;
  const N = 13;
  const segs: { x: number; y: number; z: number; r: number; f: number }[] = [];
  for (let i = 0; i < N; i++) {
    const f = i / (N - 1);
    const ang = th + bend * f * f;
    const r = TAIL_RB + (reach - TAIL_RB) * f;
    const z =
      rise * (16 * Math.sin(Math.PI * f * 0.85) + 6 * f + Math.sin(time * 6 - f * 5) * 1.2 * f);
    segs.push({
      x: Math.cos(ang) * r + (jit ? Math.sin(time * 70 + i) * jit : 0),
      y: Math.sin(ang) * r,
      z,
      r: 7 - 4.6 * f,
      f,
    });
  }
  // Тень на воде.
  for (const s of segs) {
    if (s.z < 2) continue;
    b.ink('#000000', 0.25 * al);
    b.blob(s.x, s.y, s.r, s.r * 0.4);
  }
  // Корень уходит в воду: пена кольцом.
  b.ink(FOAM, 0.8 * al);
  b.torn(segs[0].x, segs[0].y, 7, 0.45, 91, 0.6, 1, 0, TAU, time * 3);
  // Спина: от дальних к ближним по экрану.
  const order = segs.slice().sort((p, q) => p.y - q.y);
  for (const s of order) {
    const y = s.y - s.z;
    b.ink(HY[0], al);
    b.blob(s.x, y, s.r + 1, s.r + 0.6);
    b.ink(HY[1], al);
    b.blob(s.x, y, s.r, s.r * 0.9);
    // Брюхо — светлой полосой снизу.
    b.ink(BELLY, al);
    b.blob(s.x + s.r * 0.1, y + s.r * 0.45, s.r * 0.7, s.r * 0.35);
    b.ink(BELLY_L, al);
    b.dot(s.x - s.r * 0.2, y + s.r * 0.35, Math.max(1, Math.round(s.r * 0.6)), 1);
    b.ink(HY[2], al);
    b.blob(s.x - s.r * 0.3, y - s.r * 0.35, s.r * 0.55, s.r * 0.45);
    b.ink(HY[3], al);
    b.dot(s.x - s.r * 0.45, y - s.r * 0.55);
  }
  // Гребень: шипы по верху через сегмент, плавник на кончике.
  for (let i = 1; i < N - 1; i += 2) {
    const s = segs[i];
    const y = s.y - s.z - s.r;
    const h = Math.max(1, Math.round(3.5 - s.f * 2));
    for (let k = 0; k < h; k++) {
      b.ink(k === h - 1 ? HY[4] : HY[3], al);
      b.dot(s.x, y - k, k ? 1 : 2, 1);
    }
  }
  const t1 = segs[N - 1];
  const t0 = segs[N - 2];
  const fa = Math.atan2(t1.y - t1.z - (t0.y - t0.z), t1.x - t0.x);
  for (const o of [-0.7, 0, 0.7]) {
    b.ink(o ? HY[3] : HY[4], al);
    b.line(t1.x, t1.y - t1.z, t1.x + Math.cos(fa + o) * 6, t1.y - t1.z + Math.sin(fa + o) * 6);
  }
}

registerZonePainter('f9_tail', (g, z, px, py, S, time) => {
  const st = z as Strike;
  const w = whenOf(st);
  const R = st.r * S;
  const a = st.ang ?? 0;
  const half = (st.arc ?? 1.25) / 2;
  const dirS = sweepOf(a);
  const seed = idSeed(st.id, 8);
  return paint(g, px, py, (b) => {
    // Вода темнеет от тела — таймер; фронт — пенный гребень.
    const rf = TAIL_RB + (R - TAIL_RB) * w.k;
    // Весь клин сразу — мутной водой; налитое — темнее.
    b.ink(W_M, 0.16);
    b.sector(rf, R, a, half);
    b.ink(W_D, 0.3 + 0.18 * w.k + (w.alarm ? 0.12 : 0));
    b.sector(TAIL_RB, rf, a, half);
    b.ink(w.alarm ? FOAM_W : FOAM, 0.5 + 0.45 * w.k);
    b.torn(0, 0, rf, 1, seed, 0.75, w.alarm ? 2 : 1, a - half, a + half, time * 5);
    b.ink(W_L, 0.4 * w.k);
    b.torn(0, 0, rf - 3, 1, seed + 3, 0.45, 1, a - half, a + half, time * 4);
    // Край клина.
    if (w.alarm) {
      b.ink(blink(time) ? FOAM_W : W_L, 1);
      b.ring(0, 0, R, 1, a - half, a + half);
      for (const s of [-1, 1]) {
        const c = Math.cos(a + s * half);
        const sn = Math.sin(a + s * half);
        b.line(c * TAIL_RB, sn * TAIL_RB, c * R, sn * R);
      }
    } else {
      b.ink(W_D, 0.6);
      b.ring(0, 0, R + 1, 1, a - half, a + half);
      b.ink(FOAM, 0.55 + 0.4 * w.k);
      b.ring(0, 0, R, 1, a - half, a + half, 4, -dirS * time * 6);
      for (const s of [-1, 1]) {
        const c = Math.cos(a + s * half);
        const sn = Math.sin(a + s * half);
        b.dashed(c * TAIL_RB, sn * TAIL_RB, c * R, sn * R, 3, time * 4);
      }
    }
    // Шевроны бегут по дуге туда, куда пойдёт взмах.
    for (let i = 0; i < 3; i++) {
      const u = (time * 0.8 + i / 3) % 1;
      const ang = a - dirS * half + dirS * 2 * half * u;
      const r = R * 0.82;
      const cx = Math.cos(ang) * r;
      const cy = Math.sin(ang) * r;
      const tx = -Math.sin(ang) * dirS;
      const ty = Math.cos(ang) * dirS;
      const rx = Math.cos(ang);
      const ry = Math.sin(ang);
      b.ink(FOAM, (0.35 + 0.5 * w.k) * Math.sin(u * Math.PI));
      b.line(cx - tx * 3 + rx * 3, cy - ty * 3 + ry * 3, cx, cy);
      b.line(cx - tx * 3 - rx * 3, cy - ty * 3 - ry * 3, cx, cy);
    }
  });
});

registerImpactPainter('f9_tail', {
  life: 1.9,
  shake: 0.5,
  flash: 0.1,
  flashRgb: '210,255,240',
  paint(g, rec, px, py, S, age) {
    const R = (rec.r ?? 8.5) * S;
    const a = rec.ang ?? 0;
    const half = (rec.arc ?? 1.25) / 2;
    const dirS = sweepOf(a);
    const seed = rec.seed;
    const rw = TAIL_RB + (R * 1.06 - TAIL_RB) * outCubic(age / 0.6);
    return paint(g, px, py, (b) => {
      // Мокрый клин — вода вылетела на берег и уходит.
      const wet = age < 0.05 ? age / 0.05 : 1 - clamp01((age - 0.5) / 1.4);
      b.ink(W_D, 0.35 * wet);
      b.sector(TAIL_RB, rw, a, half + 0.05);
      // Смаз взмаха по воде: светлее к концу взмаха, гаснет за 0,25 с.
      const sm = 1 - clamp01(age / 0.25);
      if (sm > 0) {
        // Три полосы: хвост уже у дальнего края — там светлее всего;
        // гаснет смаз от начала взмаха к концу.
        const bands: [number, number, string, number][] = [
          [0, 0.45, W_T, 0.25],
          [0.45, 0.78, W_L, 0.35],
          [0.78, 1.0, FOAM_W, 0.55],
        ];
        for (const [f0, f1, c, al] of bands) {
          const k = sm * clamp01((f1 - age * 3) / 0.4);
          if (k <= 0) continue;
          const lo = -half + 2 * half * f0;
          const hi = -half + 2 * half * f1;
          b.ink(c, al * k);
          b.sector(TAIL_RB, R * 0.8, a + dirS * ((lo + hi) / 2), (hi - lo) / 2 + 0.01);
        }
        // Линии скорости вдоль взмаха.
        b.ink(FOAM_W, sm);
        for (let q = 0; q < 5; q++) {
          const r = TAIL_RB + ((R * 0.8 - TAIL_RB) * (q + 0.5)) / 5;
          const a0 = a - dirS * half * (1 - age * 4);
          const a1 = a + dirS * half;
          b.ring(0, 0, r, 1, Math.min(a0, a1), Math.max(a0, a1), 6, q * 1.3);
        }
      }
      // Рябь бежит за валом.
      for (let q = 0; q < 3; q++) {
        const v = age - 0.12 - q * 0.12;
        if (v < 0 || v > 0.9) continue;
        const r = TAIL_RB + (R - TAIL_RB) * outCubic(v / 0.9) * 0.9;
        b.ink(W_L, 0.5 * (1 - v / 0.9));
        b.torn(0, 0, r, 1, seed + q, 0.5, 1, a - half, a + half, q);
      }
    });
  },
});

// Хвост, вал и брызги — зона мозга под мобами (warn = метке).
registerZonePainter('f9_tailfx', (g, z, px, py, S, time) => {
  const zz = z as ZX & { arc?: number };
  const warn = zz.warn ?? 0;
  const R = zz.r * S;
  const a = zz.ang ?? 0;
  const half = (zz.arc ?? 1.25) / 2;
  const dirS = sweepOf(a);
  const a0 = a - dirS * half;
  const a1 = a + dirS * half;
  const reach = R * 0.72;
  const seed = idSeed(zz.id, 9);
  if (!aliveAtHit(zz)) return true;
  return paint(g, px, py, (b) => {
    if (zz.t < warn) {
      // Замах: хвост встаёт из воды за начальным краем и взводится назад.
      const w = whenOf(zz);
      const coil = 0.12 + 0.3 * outQuad(w.k) + (w.alarm ? 0.14 * outQuad(w.a) : 0);
      const rise = outCubic(w.k / 0.35);
      // Капли стекают с поднятого хвоста.
      tail(b, a0 - dirS * coil, reach, rise, dirS * 0.35, time, 1, w.alarm ? 0.7 : 0);
      for (let i = 0; i < 3; i++) {
        const ph = (time * 1.6 + i / 3) % 1;
        const f = 0.3 + i * 0.2;
        const ang = a0 - dirS * coil + dirS * 0.35 * f * f;
        const r = TAIL_RB + (reach - TAIL_RB) * f;
        const z0 = rise * (16 * Math.sin(Math.PI * f * 0.85) + 6 * f);
        const zz2 = z0 * (1 - ph * ph);
        b.ink(FOAM, 0.8);
        b.dot(Math.cos(ang) * r, Math.sin(ang) * r - zz2, 1, 2);
      }
      return;
    }
    const age = zz.t - warn;
    // Взмах: в кадр урона хвост уже у дальнего края, дальше — перелёт.
    const swing = outCubic(age / 0.14);
    const th = a1 - dirS * 0.12 + dirS * 0.42 * swing;
    const sink = clamp01((age - 0.16) / 0.45);
    const bend = -dirS * (0.5 - 0.35 * swing);
    // Смаз-призраки хвоста между краями — в первые кадры.
    if (age < 0.1)
      for (let j = 0; j < 3; j++) {
        const gth = a0 + (th - a0) * (0.35 + j * 0.2);
        tail(b, gth, reach, 0.8, bend, time, 0.18 + j * 0.1);
      }
    tail(b, th, reach, 1 - sink, bend, time, 1 - clamp01((age - 0.45) / 0.25));
    // Вал: стенка воды бежит по клину от тела, гребень пенный, рвётся.
    const rw = TAIL_RB + (R * 1.06 - TAIL_RB) * outCubic(age / 0.6);
    const H = 12 * (1 - clamp01((age - 0.3) / 0.5));
    const tear = clamp01((age - 0.25) / 0.5);
    if (H > 0.5) {
      const n = Math.ceil(2 * half * rw);
      for (let i = 0; i <= n; i++) {
        const ang = a - half + (2 * half * i) / n;
        const q = vn(seed, i * 0.22);
        if (q < tear) continue;
        const h = Math.round(H * (0.35 + 0.85 * q));
        if (h < 1) continue;
        const c = Math.cos(ang);
        const s = Math.sin(ang);
        const x = c * rw;
        const y = s * rw;
        const lean = c * h * 0.25;
        b.ink(W_T, 0.7);
        b.dot(x, y - Math.ceil(h * 0.4) + 1, 1, Math.ceil(h * 0.4));
        b.ink(W_L, 0.75);
        b.dot(x + lean * 0.5, y - h + 1, 1, Math.max(1, h - Math.ceil(h * 0.4)));
        b.ink(q > 0.8 ? FOAM_W : FOAM, 1);
        b.dot(x + lean, y - h, 1, 1);
      }
    }
    // Брызги с гребня и по ходу взмаха.
    for (let i = 0; i < 26; i++) {
      const tl = 0.02 + rnd(seed, i, 1) * 0.35;
      const t = age - tl;
      if (t < 0) continue;
      const ang = a - half + 2 * half * rnd(seed, i, 2);
      const r0 = TAIL_RB + (R * 1.06 - TAIL_RB) * outCubic(tl / 0.6);
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      const tx = -s * dirS;
      const ty = c * dirS;
      const sp = 30 + rnd(seed, i, 3) * 60;
      const tan = i % 2 ? 50 + rnd(seed, i, 4) * 60 : 0;
      fly(
        BIT,
        c * r0,
        s * r0,
        6,
        c * sp + tx * tan,
        s * sp * 0.8 + ty * tan,
        60 + rnd(seed, i, 5) * 80,
        G,
        t,
      );
      bit(b, BIT, i % 3 ? FOAM : FOAM_W, W_L, 1, i % 5 === 0 ? 2 : 1, 0.35, W_D);
    }
    // Шлепок в конце взмаха: корона воды кольцом, капли с её зубцов.
    const ex = Math.cos(a1 + dirS * 0.3) * R * 0.5;
    const ey = Math.sin(a1 + dirS * 0.3) * R * 0.5;
    const sa = age - 0.1;
    if (sa >= 0) {
      if (sa < 0.12) {
        b.ink(FOAM_W, 0.9 * (1 - sa / 0.12));
        b.blob(ex, ey, 6 + sa * 50, 3 + sa * 25, seed, 0.25);
      }
      wall(b, ex, ey, seed + 40, sa, 3, 15, 18, 0.08, 0.4, W_T, W_L, FOAM_W);
      for (let i = 0; i < 14; i++) {
        const ang = rnd(seed, i, 41) * TAU;
        const sp = 25 + rnd(seed, i, 42) * 40;
        fly(
          BIT,
          ex + Math.cos(ang) * 5,
          ey + Math.sin(ang) * 3,
          10,
          Math.cos(ang) * sp,
          Math.sin(ang) * sp * 0.7,
          60 + rnd(seed, i, 43) * 70,
          G,
          sa - 0.04,
        );
        if (sa < 0.04) continue;
        bit(b, BIT, i % 3 ? FOAM : FOAM_W, W_L, 1, i % 4 ? 1 : 2, 0.3, W_D);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Скрытая голова (фаза 3).
// Призма — пять лучей стихий `f9_ray0…4` (линии r 10, метка 0,95 с).
// Метка: каждый луч — дорожка своего цвета; стихия течёт по ней ВНУТРЬ, к
// пасти (голова вдыхает пять стихий), заряд наливается от пасти к концу; в
// тревоге по оси загорается нить. Контакт (поверх темноты): пять лучей из
// пасти разом — широкие в кадр урона, сужаются и мерцают, по каждому
// разлетается своё: угли, иней, капли яда, искры, блёстки.
// ---------------------------------------------------------------------------

/** Частица стихии: огонь поднимается, лёд искрит, яд капает, гроза трещит, свет мерцает. */
function elemBit(
  b: Brush,
  el: number,
  x: number,
  y: number,
  u: number,
  a: number,
  seed: number,
  i: number,
): void {
  const P = EL_P[el];
  switch (el) {
    case 0:
      b.ink(u < 0.4 ? P[4] : u < 0.7 ? P[3] : P[2], a);
      b.dot(x + Math.sin(u * 9 + i) * 1.2, y - u * 10);
      break;
    case 1:
      twinkle(b, x, y + u * 3, P[3], a * (1 - u), u < 0.3);
      break;
    case 2:
      b.ink(P[3], a);
      b.dot(x, y + u * u * 12, 1, 2);
      break;
    case 3:
      b.ink(Math.floor(u * 24) % 2 ? P[3] : WHITE, a);
      b.line(
        x,
        y,
        x + sgn(seed, i, Math.floor(u * 12)) * 3,
        y + sgn(seed, i + 9, Math.floor(u * 12)) * 3,
      );
      break;
    default:
      twinkle(b, x, y - u * 5, P[2], a * (1 - u), false);
  }
}

for (let el = 0; el < 5; el++) {
  const P = EL_P[el];
  registerZonePainter(`f9_ray${el}`, (g, z, px, py, S, time) => {
    const st = z as Strike;
    const w = whenOf(st);
    const L = st.r * S;
    const hw = (st.w ?? 0.4) * S;
    const a = st.ang ?? 0;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const nx = -uy;
    const ny = ux;
    const seed = idSeed(st.id, 10 + el);
    return paint(g, px, py, (b) => {
      b.ink(P[0], 0.2 + 0.12 * w.k);
      b.band(ux, uy, 8, L, hw);
      const lf = 8 + (L - 8) * w.k;
      b.ink(P[1], 0.22 + 0.2 * w.k + (w.alarm ? 0.15 : 0));
      b.band(ux, uy, 8, lf, hw * 0.6);
      for (const s of [-1, 1]) {
        const ex = nx * s * hw;
        const ey = ny * s * hw;
        if (w.alarm) {
          b.ink(blink(time) ? P[4] : P[3], 1);
          b.line(ex + ux * 8, ey + uy * 8, ex + ux * L, ey + uy * L);
        } else {
          b.ink(P[2], 0.4 + 0.45 * w.k);
          // Пунктир течёт к пасти — стихию тянет внутрь.
          b.dashed(ex + ux * 8, ey + uy * 8, ex + ux * L, ey + uy * L, 3, time * 6);
        }
      }
      // Стихия течёт к пасти.
      for (let i = 0; i < 5; i++) {
        const u = (time * (0.8 + w.k) + i / 5 + rnd(seed, i, 1) * 0.1) % 1;
        const s = 8 + (L * 0.55 - 8) * (1 - u);
        const o = sgn(seed, i, 2) * hw * 0.5;
        elemBit(b, el, ux * s + nx * o, uy * s + ny * o, 0.2, 0.4 + 0.5 * w.k, seed, i);
      }
      if (w.alarm) {
        b.ink(P[4], 0.5 + 0.5 * w.a);
        b.line(ux * 8, uy * 8, ux * L * (0.3 + 0.7 * w.a), uy * L * (0.3 + 0.7 * w.a));
      }
    });
  });
  registerImpactPainter(`f9_ray${el}`, {
    life: 0.55,
    shake: 0.1,
    above: true,
    flash: el === 4 ? 0.18 : 0,
    flashRgb: '250,240,255',
    paint(g, rec, px, py, S, age) {
      const L = (rec.r ?? 10) * S;
      const a = rec.ang ?? 0;
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      const nx = -uy;
      const ny = ux;
      const seed = rec.seed;
      // Все пять лучей — из одной пасти: куда смотрит голова, а не луч.
      const cr = nearestMob(['f9_crown'], rec.x, rec.y, 1.5);
      const [mx, my] = mouthOf(cr ? cr.face : Math.PI / 2, true);
      const k = 1 - clamp01((age - 0.33) / 0.2);
      if (k <= 0) return true;
      return paint(g, px, py, (b) => {
        // Толщина: широкий в кадр урона, сужается и мерцает.
        const flick = Math.floor(age * 24) % 2;
        const wd = age < 0.06 ? 7 : Math.max(1, Math.round(5 - 12 * (age - 0.06) + flick));
        // Прямой луч из пасти к концу дороги на полу.
        const x0 = mx;
        const y0 = my;
        const x1 = ux * L;
        const y1 = uy * L - 4;
        const pts = (s: number): [number, number] => {
          const f = s / L;
          return [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f];
        };
        const seg = (w: number, c: string, al: number) => {
          b.ink(c, al);
          b.line(x0, y0, x1, y1, w);
        };
        seg(wd + 2, P[0], 0.45 * k);
        seg(wd, P[2], 0.9 * k);
        seg(Math.max(1, wd - 3), P[4], k);
        // Конец луча — вспышка.
        if (age < 0.2) {
          b.ink(P[4], 1 - age / 0.2);
          b.blob(x1, y1, 3 + age * 20, 2 + age * 14);
        }
        // Стихия с луча.
        for (let i = 0; i < 9; i++) {
          const s = 20 + rnd(seed, i, 1) * (L - 20);
          const u = clamp01((age - rnd(seed, i, 2) * 0.12) / 0.4);
          if (u <= 0 || u >= 1) continue;
          const [bx, by] = pts(s);
          const o = sgn(seed, i, 3) * (3 + u * 8);
          elemBit(b, el, bx + nx * o, by + ny * o, u, k, seed, i);
        }
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Водоворот `f9_whirl` (круг r 1,35 под героем, 1,05 с) — голова под илом.
// Метка: ил темнеет и закручивается тремя рукавами всё быстрее, мусор
// стягивает к центру, лиловый свет снизу наливается к краю; в тревоге
// центр вспучивается, свет рвётся трещинами. Контакт: лиловая вспышка,
// стенка ила кольцом, комья летят, отскакивают и ложатся, воронка оседает.
// ---------------------------------------------------------------------------

registerZonePainter('f9_whirl', (g, z, px, py, S, time) => {
  const st = z as Strike;
  const w = whenOf(st);
  const R = st.r * S;
  const seed = idSeed(st.id, 16);
  const spin = 3 * w.t + 6 * w.t * w.t;
  return paint(g, px, py, (b) => {
    b.ink(MUD[0], 0.5 + 0.3 * w.k);
    b.blob(0, 0, R, R, seed, 0.12);
    b.ink(C_M, 0.22 + 0.3 * w.k);
    b.blob(0, 0, R * (0.1 + 0.9 * w.k), R * (0.1 + 0.9 * w.k));
    // Рукава: от края к центру, толщиной в две точки, внутри — лиловее.
    for (let arm = 0; arm < 3; arm++)
      for (let s = 0; s < 1; s += 0.03) {
        const r = R * (1 - s) * 0.95;
        const ang = (arm / 3) * TAU + s * 4.5 + spin;
        b.ink(s > 0.5 ? C_H : MUD[4], (0.55 + 0.45 * w.k) * (1 - s * 0.25));
        b.dot(Math.cos(ang) * r, Math.sin(ang) * r, s < 0.6 ? 2 : 1, 1);
      }
    // Взбитый край — светлый ил, тень снаружи.
    b.ink(MUD[0], 0.8);
    b.ring(0, 1, R + 2);
    b.ink(MUD[4], 0.9);
    b.torn(0, 0, R, 1, seed, 0.65, 2, 0, TAU, spin * 0.5);
    b.ink(MUD[3], 0.8);
    b.torn(0, 0, R + 1.5, 1, seed + 1, 0.45, 1, 0, TAU, -spin * 0.3);
    // Мусор затягивает в воронку.
    for (let i = 0; i < 6; i++) {
      const u = (time * 0.9 + i / 6) % 1;
      const r = R * (1 - u);
      const ang = spin * 1.3 + i * 1.7 + u * 3;
      b.ink(i % 2 ? MUD[4] : MUD[3], 0.9 * (1 - u * 0.5));
      b.dot(Math.cos(ang) * r, Math.sin(ang) * r, i % 3 ? 1 : 2, 1);
    }
    if (w.alarm) {
      b.ink(C_H, 0.5 + 0.4 * w.a);
      b.blob(0, -w.a * 2, 3 + 5 * w.a, 2 + 4 * w.a);
      b.ink(C_H, w.a);
      for (let i = 0; i < 5; i++) {
        const ang = rnd(seed, i, 3) * TAU;
        b.line(0, 0, Math.cos(ang) * R * 0.85 * w.a, Math.sin(ang) * R * 0.85 * w.a);
      }
      b.ink(blink(time) ? C_H : C_L, 1);
      b.ring(0, 0, R + 2);
    } else {
      b.ink(C_L, 0.35 + 0.4 * w.k);
      b.ring(0, 0, R + 2, 1, 0, TAU, 4, time * 4);
    }
  });
});

registerImpactPainter('f9_whirl', {
  life: 1.4,
  shake: 0.35,
  flash: 0.1,
  flashRgb: '190,140,255',
  paint(g, rec, px, py, S, age) {
    const R = (rec.r ?? 1.35) * S;
    const seed = rec.seed;
    return paint(g, px, py, (b) => {
      // Воронка оседает тёмным кольцом.
      const cr = 1 - clamp01((age - 0.4) / 1.0);
      b.ink(MUD[0], 0.55 * cr);
      b.torn(0, 0, R * 0.9, 1, seed, 0.75, 2);
      b.ink(MUD[1], 0.5 * cr);
      b.blob(0, 0, R * 0.7, R * 0.6, seed + 1, 0.2);
      if (age < 0.16) {
        const k = age / 0.16;
        b.ink(C_L, 0.5 * (1 - k));
        b.blob(0, 0, R * (0.8 + 0.5 * k), R * (0.7 + 0.4 * k));
        b.ink(C_H, 0.95 * (1 - k));
        b.blob(0, -4, 6 + 12 * k, 5 + 9 * k);
      }
      wall(b, 0, 0, seed, age + 0.03, R * 0.35, R * 1.15, 22, 0.08, 0.42, MUD[2], MUD[3], MUD[4]);
      for (let i = 0; i < 22; i++) {
        const ang = rnd(seed, i, 1) * TAU;
        const sp = 30 + rnd(seed, i, 2) * 60;
        fly(
          BIT,
          Math.cos(ang) * R * 0.3,
          Math.sin(ang) * R * 0.3,
          6,
          Math.cos(ang) * sp,
          Math.sin(ang) * sp * 0.75,
          70 + rnd(seed, i, 3) * 80,
          G,
          age,
          0.3,
        );
        const a = 1 - clamp01((age - 0.9) / 0.5);
        const sz = i % 3 ? 1 : 2;
        if (BIT.z > 1.5) {
          b.ink('#000000', 0.3 * a);
          b.dot(BIT.x, BIT.y + 1, sz, 1);
        }
        b.ink(i % 2 ? MUD[1] : MUD[2], a);
        b.dot(BIT.x, BIT.y - BIT.z, sz, sz);
        b.ink(MUD[4], a * 0.8);
        b.dot(BIT.x, BIT.y - BIT.z);
      }
      for (let i = 0; i < 8; i++) {
        const ang = rnd(seed, i, 5) * TAU;
        const sp = 40 + rnd(seed, i, 6) * 40;
        fly(
          BIT,
          0,
          0,
          8,
          Math.cos(ang) * sp,
          Math.sin(ang) * sp * 0.7,
          100 + rnd(seed, i, 7) * 60,
          G,
          age,
        );
        bit(b, BIT, C_H, C_L, 1 - clamp01(age / 0.8), 1, 0.2, C_M);
      }
    });
  },
});

// Ил скрытой головы: нырок и всплытие — зона мозга (`f9_mud`). С меткой
// (`warn`) — ил вспучивается и пузырится, потом всплеск; без — сразу всплеск.
registerZonePainter('f9_mud', (g, z, px, py, S, time) => {
  const zz = z as Zone;
  const warn = zz.warn ?? 0;
  const R = zz.r * S;
  const seed = idSeed(zz.id, 17);
  return paint(g, px, py, (b) => {
    if (zz.t < warn) {
      const w = whenOf(zz);
      b.ink(MUD[1], 0.6);
      b.blob(0, -w.k * 2, R * (0.4 + 0.5 * w.k), R * (0.3 + 0.35 * w.k), seed, 0.2);
      b.ink(MUD[3], 0.7);
      b.torn(0, 0, R * (0.5 + 0.5 * w.k), 0.6, seed, 0.6, 1, 0, TAU, time * 3);
      for (let i = 0; i < 5; i++) {
        const ph = (time * (1.5 + w.k * 2) + rnd(seed, i, 1)) % 1;
        const ang = rnd(seed, i + Math.floor(time * 1.5 + rnd(seed, i, 1)), 2) * TAU;
        const r = R * 0.6 * rnd(seed, i, 3);
        b.ink(ph < 0.8 ? MUD[3] : C_L, 1 - ph);
        b.ring(Math.cos(ang) * r, Math.sin(ang) * r * 0.6, 0.5 + ph * 2, 0.7);
      }
      return;
    }
    const age = zz.t - warn;
    wall(b, 0, 0, seed, age, R * 0.3, R * 1.1, 12, 0.07, 0.35, MUD[2], MUD[3], MUD[4]);
    for (let i = 0; i < 10; i++) {
      const ang = rnd(seed, i, 4) * TAU;
      const sp = 25 + rnd(seed, i, 5) * 45;
      fly(
        BIT,
        0,
        0,
        4,
        Math.cos(ang) * sp,
        Math.sin(ang) * sp * 0.7,
        60 + rnd(seed, i, 6) * 60,
        G,
        age,
        0.3,
      );
      const a = 1 - clamp01((age - 0.4) / 0.3);
      b.ink(i % 2 ? MUD[1] : MUD[2], a);
      b.dot(BIT.x, BIT.y - BIT.z, i % 3 ? 1 : 2, i % 3 ? 1 : 2);
    }
    if (age < 0.5) {
      b.ink(MUD[3], 0.7 * (1 - age / 0.5));
      b.ring(0, 0, 4 + R * outCubic(age / 0.5), 0.6);
    }
  });
});

// ---------------------------------------------------------------------------
// Смена фазы — сцены мира (зоны мозга в миг смены фазы):
//   • `f9_flood` (фаза 1) — озеро выходит из берегов: пенный вал кольцом
//     бежит на берег, за ним мутная вода, капли с гребня;
//   • `f9_douse` (фаза 2) — жаровня падает в воду: пар столбом, искры
//     разлетаются и гаснут, шипящее кольцо на воде;
//   • `f9_drain` (фаза 3) — озеро уходит в ил: вода закручивается воронкой
//     и сжимается к телу, открывая ил.
// Клетки мир меняет сразу — сцена прячет склейку и показывает, что случилось.
// ---------------------------------------------------------------------------

registerZonePainter('f9_flood', (g, z, px, py, S, time) => {
  const zz = z as Zone;
  const u = zz.t;
  const R0 = zz.r * S;
  const seed = idSeed(zz.id, 30);
  if (u > zz.life) return true;
  return paint(g, px, py, (b) => {
    const k = outCubic(u / 1.0);
    const r = R0 + 2.6 * S * k;
    const fade = 1 - clamp01((u - 0.9) / 0.5);
    // Вода растекается за валом.
    b.ink(W_T, 0.45 * fade);
    b.torn(0, 0, R0 + (r - R0) * 0.5, 0.75, seed, 0.6, 2, 0, TAU, u * 2);
    // Вал: пенный гребень.
    b.ink(FOAM_W, fade);
    b.torn(0, 0, r, 0.75, seed + 8, 0.75, 2, 0, TAU, u * 4);
    // Капли с гребня.
    for (let i = 0; i < 18; i++) {
      const tl = rnd(seed, i, 1) * 0.6;
      const t = u - tl;
      if (t < 0) continue;
      const ang = rnd(seed, i, 2) * TAU;
      const r1 = R0 + 2.6 * S * outCubic(tl / 1.0);
      const sp = 20 + rnd(seed, i, 3) * 30;
      fly(
        BIT,
        Math.cos(ang) * r1,
        Math.sin(ang) * r1 * 0.75,
        4,
        Math.cos(ang) * sp,
        Math.sin(ang) * sp * 0.6,
        50 + rnd(seed, i, 4) * 50,
        G,
        t,
      );
      bit(b, BIT, FOAM, W_L, fade, 1, 0.3, W_D);
    }
    void time;
  });
});

registerZonePainter('f9_douse', (g, z, px, py, S, time) => {
  const zz = z as Zone;
  const u = zz.t;
  const seed = idSeed(zz.id, 31);
  return paint(g, px, py, (b) => {
    // Шипящее кольцо на воде.
    if (u < 0.5) {
      b.ink(FOAM, 0.9 * (1 - u / 0.5));
      b.ring(0, 0, 4 + u * 36, 0.55);
    }
    // Искры: вверх и в стороны, падают в воду и гаснут.
    for (let i = 0; i < 14; i++) {
      const ang = rnd(seed, i, 1) * TAU;
      const sp = 20 + rnd(seed, i, 2) * 50;
      fly(
        BIT,
        0,
        0,
        10,
        Math.cos(ang) * sp,
        Math.sin(ang) * sp * 0.7,
        60 + rnd(seed, i, 3) * 90,
        G,
        u,
      );
      bit(b, BIT, i % 2 ? F_Y : F_L, F_O, 1 - clamp01(u / 0.9), 1, 0.1, F_R);
    }
    // Пар столбом: клубы поднимаются, растут и тают.
    for (let i = 0; i < 9; i++) {
      const v = u - i * 0.05;
      if (v < 0 || v > 1.1) continue;
      const x = sgn(seed, i, 4) * 5 + Math.sin(v * 4 + i) * 3;
      puff(b, x, -6 - v * 34, 2 + v * 7, '#8a9494', '#d8e2e0', 0.6 * (1 - v / 1.1), seed + i);
    }
    void time;
  });
});

registerZonePainter('f9_drain', (g, z, px, py, S, time) => {
  const zz = z as Zone;
  const u = zz.t;
  const R0 = zz.r * S;
  const seed = idSeed(zz.id, 32);
  if (u > zz.life) return true;
  return paint(g, px, py, (b) => {
    // Вода сжимается к середине — под ней уже ил.
    const rw = R0 * (1 - inQuad(u / 1.6));
    if (rw < 1) return;
    b.ink(W_D, 0.75);
    b.blob(0, 0, rw, rw * 0.72, seed, 0.12);
    b.ink(W_M, 0.6);
    b.blob(0, 0, rw * 0.8, rw * 0.58, seed + 1, 0.12);
    // Воронка: пенные рукава закручиваются всё быстрее.
    const spin = u * 4 + u * u * 6;
    for (let arm = 0; arm < 4; arm++)
      for (let s = 0; s < 1; s += 0.04) {
        const r = rw * (1 - s) * 0.95;
        const ang = (arm / 4) * TAU + s * 5 + spin;
        b.ink(s < 0.4 ? FOAM : W_L, 0.8 * (1 - s * 0.4));
        b.dot(Math.cos(ang) * r, Math.sin(ang) * r * 0.72);
      }
    // Пена по кромке уходящей воды.
    b.ink(FOAM_W, 0.9);
    b.torn(0, 0, rw, 0.72, seed + 2, 0.7, 2, 0, TAU, spin);
    void time;
  });
});

// ---------------------------------------------------------------------------
// Ядовитый гейзер фазы 2 — `f9_geyser` (круг r 1,1, метка 1,1 с). Метка:
// из центра трещинами расходится ядовитый свет, доходит до края к удару;
// пузыри всё чаще; в тревоге из трещин бьёт пар. Контакт (поверх темноты):
// столб ядовитой воды выстреливает, стоит и рушится каплями, у основания —
// кольцо брызг, над местом — зелёная мгла.
// ---------------------------------------------------------------------------

registerZonePainter('f9_geyser', (g, z, px, py, S, time) => {
  const st = z as Strike;
  const w = whenOf(st);
  const R = st.r * S;
  const seed = idSeed(st.id, 18);
  return paint(g, px, py, (b) => {
    const rf = R * (0.1 + 0.9 * w.k);
    b.ink(V_D, 0.25 + 0.2 * w.k);
    b.blob(0, 0, rf, rf, seed, 0.15);
    // Трещины со светом яда.
    for (let i = 0; i < 5; i++) {
      const ang = (i / 5) * TAU + rnd(seed, i, 1) * 0.6;
      let x = 0;
      let y = 0;
      for (let s = 3; s <= rf * 0.95; s += 3) {
        const ta = ang + sgn(seed, i * 11 + s, 2) * 0.45;
        const nx = x + Math.cos(ta) * 3;
        const ny = y + Math.sin(ta) * 3;
        b.ink(V_D, 0.9);
        b.line(x + 1, y + 1, nx + 1, ny + 1);
        b.ink(w.alarm ? V_W : V_H, 0.55 + 0.4 * w.k);
        b.line(x, y, nx, ny);
        x = nx;
        y = ny;
      }
      if (w.alarm) {
        const u = (time * 3 + i / 5) % 1;
        puff(b, x, y - u * 10, 1 + u * 2.5, '#6a8a58', '#c8e8b0', 0.6 * (1 - u), seed + i);
      }
    }
    // Пузыри — всё чаще.
    for (let i = 0; i < 6; i++) {
      const per = 0.55 - 0.35 * w.k;
      const ph = (time / per + rnd(seed, i, 3)) % 1;
      const cyc = Math.floor(time / per + rnd(seed, i, 3));
      const ang = rnd(seed + cyc, i, 4) * TAU;
      const r = rnd(seed + cyc, i, 5) * rf * 0.8;
      b.ink(V_H, 0.8 * (1 - ph));
      b.ring(Math.cos(ang) * r, Math.sin(ang) * r, 0.6 + ph * 2.2, 0.8);
    }
    if (w.alarm) {
      b.ink(blink(time) ? V_W : V_H, 1);
      b.ring(0, 0, R);
      b.ink(V_L, 0.8);
      b.ring(0, 0, R + 1);
    } else {
      b.ink(V_L, 0.45 + 0.4 * w.k);
      b.ring(0, 0, R, 1, 0, TAU, 3, time * 5);
    }
  });
});

registerImpactPainter('f9_geyser', {
  life: 1.5,
  shake: 0.25,
  above: true,
  paint(g, rec, px, py, S, age) {
    const R = (rec.r ?? 1.1) * S;
    const seed = rec.seed;
    return paint(g, px, py, (b) => {
      // Столб: выстреливает за 0,1 с (с перелётом), стоит и кипит, рушится
      // сверху; по нему бегут светлые струи вверх.
      // В кадр удара столб уже на середине — вырывается из земли.
      const top =
        age < 0.1
          ? 50 * (0.5 + 0.5 * outBack(age / 0.1, 1.4))
          : age < 0.34
            ? 50 + Math.sin(age * 40) * 2
            : 50 * (1 - inQuad((age - 0.34) / 0.3));
      if (top > 1) {
        const fl = Math.floor(age * 24);
        for (let y = 0; y < top; y++) {
          const u = y / top;
          // Бока кипят: ширина по шуму, у основания юбка, наверху раскрытие.
          const wd =
            2.5 +
            3.5 * vn(seed + fl * 3, y / 4) +
            (y < 8 ? (8 - y) * 0.8 : 0) +
            (u > 0.75 ? (u - 0.75) * 26 : 0);
          const sh = (vn(seed + 9, y / 6 + age * 8) - 0.5) * 3;
          const l = Math.round(-wd + sh);
          const r = Math.round(wd + sh);
          b.ink(V_D, 0.85);
          b.row(-y, l - 1, r + 1);
          b.ink(V_M, 0.9);
          b.row(-y, l, r);
          b.ink(V_L, 0.9);
          b.row(-y, l + 1, Math.round(sh + wd * 0.2));
          b.ink((y + Math.floor(age * 160)) % 9 < 2 ? V_W : V_H, 0.95);
          b.row(-y, l + 1, l + 2);
        }
        // Шапка: пена кипит клубами и срывается вбок.
        for (let i = 0; i < 6; i++) {
          const ang = (i / 6) * TAU + age * 3;
          const d = 4 + 3 * vn(seed + i, age * 10);
          puff(
            b,
            Math.cos(ang) * d,
            -top - 2 + Math.sin(ang) * d * 0.5,
            2.5 + rnd(seed, i, 30) * 2,
            V_L,
            V_W,
            0.95,
            seed + i,
          );
        }
        // Струйки срываются с боков.
        for (let i = 0; i < 6; i++) {
          const ph = (age * 3 + i / 6) % 1;
          const y0 = top * (0.3 + 0.6 * rnd(seed, i, 31));
          const side = i % 2 ? 1 : -1;
          b.ink(V_H, 1 - ph);
          b.dot(side * (5 + ph * 8), -y0 + ph * ph * 30, 1, 2);
        }
      }
      // Кольцо брызг у основания: стенка ядовитой воды.
      wall(b, 0, 0, seed + 3, age, 4, R * 1.15, 9, 0.06, 0.3, V_M, V_L, V_W);
      if (age < 0.35) {
        const k = age / 0.35;
        b.ink(V_H, 0.9 * (1 - k));
        b.torn(0, 0, 4 + R * 1.3 * outCubic(k), 0.7, seed, 0.65, k < 0.3 ? 2 : 1);
      }
      // Капли со столба: срываются сверху и падают вокруг.
      for (let i = 0; i < 24; i++) {
        const tl = 0.08 + rnd(seed, i, 1) * 0.35;
        const t = age - tl;
        if (t < 0) continue;
        const ang = rnd(seed, i, 2) * TAU;
        const sp = 15 + rnd(seed, i, 3) * 35;
        const z0 = 30 + rnd(seed, i, 4) * 16;
        fly(
          BIT,
          0,
          0,
          z0,
          Math.cos(ang) * sp,
          Math.sin(ang) * sp * 0.7,
          rnd(seed, i, 5) * 40,
          G,
          t,
        );
        bit(b, BIT, i % 3 ? V_H : V_W, V_L, 1, i % 4 ? 1 : 2, 0.5, V_M);
      }
      // Мгла.
      for (let i = 0; i < 5; i++) {
        const u = age - 0.1 - rnd(seed, i, 6) * 0.2;
        if (u < 0 || u > 1.1) continue;
        const ang = rnd(seed, i, 7) * TAU;
        const d = 6 + 10 * outCubic(u);
        puff(
          b,
          Math.cos(ang) * d,
          Math.sin(ang) * d * 0.6 - 6 - u * 8,
          2 + u * 5,
          '#3a5a30',
          '#6a8a58',
          0.35 * (1 - u / 1.1),
          seed + i,
        );
      }
    });
  },
});

// ---------------------------------------------------------------------------
// Обрубок шеи: часы отрастания (`f9_stumpclock`, зона мозга на полу вместо
// красного кольца движка), прижигание `f9_sear`, отрастание `f9_regrow`
// (и новая голова из тела), срубленная голова `f9_sever`.
// Часы: жилы по кругу тянутся к обрубку и бьются, как сердце, — чем ближе
// отрастание, тем чаще; круг сжимается (как прежнее кольцо — те же радиусы);
// в последнюю секунду горит красным. Есть огонь в руке — внутри мигает
// огненный пунктир: «прижигай сейчас».
// ---------------------------------------------------------------------------

registerZonePainter('f9_stumpclock', (g, z, px, py, S, time) => {
  const zz = z as ZX;
  const s = mobById(zz.from);
  if (!s || s.mode !== 'bleed') return true;
  const T = s.data.T ?? 8;
  const left = Math.max(0, T - s.t);
  const k = clamp01(s.t / T);
  const ox = (s.x - zz.x) * S;
  const oy = (s.y - zz.y) * S;
  const seed = idSeed(zz.id, 19);
  return paint(g, px + ox, py + oy, (b) => {
    const r = (0.5 + 0.9 * (left / T)) * S;
    const per = 0.9 - 0.6 * k;
    const ph = (s.t % per) / per;
    const beat = ph < 0.18 ? 1 - ph / 0.18 : 0;
    const late = left < 1.2;
    // Жилы тянутся к обрубку, по ним бежит кровь.
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * TAU + rnd(seed, i, 1) * 0.4;
      let x = Math.cos(ang) * r;
      let y = Math.sin(ang) * r;
      const steps = Math.max(2, Math.floor((r - 4) / 3));
      b.ink(BL_M, 0.55 + 0.3 * beat);
      for (let j = 1; j <= steps; j++) {
        const rr = r - ((r - 4) * j) / steps;
        const ta = ang + Math.sin(j * 1.7 + i) * 0.18;
        const nx = Math.cos(ta) * rr;
        const ny = Math.sin(ta) * rr;
        b.line(x, y, nx, ny);
        x = nx;
        y = ny;
      }
      const u = (ph + i * 0.07) % 1;
      const rr = r - (r - 4) * u;
      b.ink(BL_L, 0.9);
      b.dot(Math.cos(ang) * rr, Math.sin(ang) * rr);
    }
    b.ink(late && blink(time) ? RED : BL_R, 0.6 + 0.4 * beat + (late ? 0.3 : 0));
    b.torn(0, 0, r, 1, seed, 0.8, beat > 0.5 || late ? 2 : 1, 0, TAU, s.t * 0.5);
    b.ink(BL_M, 0.5);
    b.ring(0, 0, r + 2 + beat * 2, 1, 0, TAU, 2, time * 3);
    if ((s.data.can ?? 0) > 0) {
      b.ink(blink(time * 0.5) ? F_Y : F_O, 0.9);
      b.ring(0, 0, 7, 0.6, 0, TAU, 2, -time * 8);
    }
  });
});

registerZonePainter('f9_sear', (g, z, px, py, S, time) => {
  const zz = z as Zone;
  const t = zz.t;
  const seed = idSeed(zz.id, 20);
  const cy = -11;
  return paint(g, px, py, (b) => {
    if (t < 0.09) {
      const k = t / 0.09;
      b.ink(F_W, 1 - k * 0.5);
      b.blob(0, cy, 4 + 6 * k, 3 + 4 * k);
    }
    // Шипит по полу кольцом.
    if (t < 0.3) {
      b.ink(F_O, 1 - t / 0.3);
      b.ring(0, 0, 3 + t * 30, 0.6);
    }
    // Языки: взмывают над срезом и опадают.
    const h = 13 * outCubic(t / 0.1) * (1 - clamp01((t - 0.15) / 0.45));
    for (let j = 0; j < 5; j++)
      tongue(b, (j - 2) * 1.6, cy + 1, h * (j % 2 ? 0.7 : 1), 3, time * 20 + j * 1.7, 1);
    // Искры — вверх и в стороны, падают.
    for (let i = 0; i < 16; i++) {
      const ang = rnd(seed, i, 1) * TAU;
      const sp = 20 + rnd(seed, i, 2) * 45;
      fly(
        BIT,
        0,
        0,
        11,
        Math.cos(ang) * sp,
        Math.sin(ang) * sp * 0.7,
        70 + rnd(seed, i, 3) * 80,
        G,
        t,
        0.3,
      );
      const a = 1 - clamp01(t / 0.8);
      bit(b, BIT, i % 3 ? F_Y : F_W, F_O, a, 1, 0.2, F_R);
    }
    // Дым поднимается.
    for (let i = 0; i < 4; i++) {
      const u = t - 0.08 - i * 0.05;
      if (u < 0) continue;
      puff(
        b,
        Math.sin(u * 6 + i) * 2 + (i - 1.5) * 2,
        cy - 4 - u * 30,
        1.5 + u * 7,
        SMOKE[1],
        SMOKE[3],
        0.6 * (1 - clamp01(u / 0.7)),
        seed + i,
      );
    }
  });
});

registerZonePainter('f9_regrow', (g, z, px, py, S, time) => {
  const zz = z as Zone;
  const t = zz.t;
  const seed = idSeed(zz.id, 21);
  return paint(g, px, py, (b) => {
    // Ударное кольцо плоти.
    if (t < 0.3) {
      const k = t / 0.3;
      b.ink(BL_R, 0.9 * (1 - k));
      b.torn(0, 0, 4 + 18 * outCubic(k), 0.8, seed, 0.7, k < 0.3 ? 2 : 1);
    }
    // Жилы хлещут вверх и втягиваются.
    const L = 16 * outBack(t / 0.14, 1.6) * (1 - clamp01((t - 0.25) / 0.35));
    if (L > 1)
      for (let i = 0; i < 5; i++) {
        const base = (i - 2) * 2.5;
        let x = base;
        let y = -6;
        for (let s = 1; s <= 6; s++) {
          const f = s / 6;
          const nx = base + Math.sin(f * 3 + i * 1.3 + time * 8) * 4 * f + (i - 2) * f * 3;
          const ny = -6 - L * f;
          b.ink(f > 0.8 ? BL_L : BL_R, 1);
          b.line(x, y, nx, ny, f < 0.5 ? 2 : 1);
          x = nx;
          y = ny;
        }
      }
    // Брызги крови.
    for (let i = 0; i < 18; i++) {
      const ang = rnd(seed, i, 1) * TAU;
      const sp = 20 + rnd(seed, i, 2) * 50;
      fly(
        BIT,
        0,
        0,
        8,
        Math.cos(ang) * sp,
        Math.sin(ang) * sp * 0.7,
        60 + rnd(seed, i, 3) * 90,
        G,
        t,
      );
      bit(b, BIT, i % 3 ? BL_R : BL_L, BL_M, 1, i % 4 ? 1 : 2, 0.5, BL_D);
    }
  });
});

// Срубленная голова: кровь фонтаном из шеи, капли падают и ложатся.
registerZonePainter('f9_sever', (g, z, px, py, S, time) => {
  const zz = z as Zone;
  const t = zz.t;
  const seed = idSeed(zz.id, 22);
  return paint(g, px, py, (b) => {
    if (t < 0.12) {
      b.ink(BL_L, 1 - t / 0.12);
      b.blob(0, -12, 3 + t * 30, 2 + t * 20);
    }
    for (let i = 0; i < 22; i++) {
      const tl = rnd(seed, i, 1) * 0.18;
      const u = t - tl;
      if (u < 0) continue;
      const ang = rnd(seed, i, 2) * TAU;
      const sp = 15 + rnd(seed, i, 3) * 45;
      fly(
        BIT,
        0,
        0,
        12,
        Math.cos(ang) * sp,
        Math.sin(ang) * sp * 0.7,
        40 + rnd(seed, i, 4) * 90,
        G,
        u,
      );
      bit(b, BIT, i % 3 ? BL_R : BL_L, BL_M, 1, i % 4 ? 1 : 2, 0.6, BL_D);
    }
    void time;
  });
});

// ---------------------------------------------------------------------------
// Огонь в руке героя — `f9_handfire` (id держит тест этажа). Факел у руки
// со стороны взгляда: язык пламени колышется, угольки летят вверх; к концу
// срока сжимается и захлёбывается.
// ---------------------------------------------------------------------------

registerZonePainter('f9_handfire', (g, _z, px, py, S, time) => {
  const k = F9_VIEW.fire;
  if (k <= 0) return true;
  const sim = paintSim();
  const face = sim ? sim.hero.face : 0;
  const side = Math.cos(face) >= 0 ? 1 : -1;
  // Захлёбывается в последние 20%: гаснет рывками.
  if (k < 0.2 && vn(77, time * 9) < 0.35 * (1 - k / 0.2)) return true;
  const x = side * 6;
  const y = -8;
  const sz = 0.55 + 0.45 * k;
  return paint(g, px, py, (b) => {
    b.ink(F_O, 0.25);
    b.blob(x, y + 1, 4 * sz, 2 * sz);
    tongue(b, x, y, (7 + 2.5 * vn(5, time * 7)) * sz, 4 * sz, time * 16, 1);
    tongue(b, x + side, y - 1, (4 + 2 * vn(9, time * 9)) * sz, 2, time * 21 + 2, 0.9);
    for (let i = 0; i < 4; i++) {
      const ph = (time * 1.3 + i / 4) % 1;
      b.ink(ph < 0.5 ? F_L : F_O, (1 - ph) * sz);
      b.dot(x + Math.sin(ph * 7 + i * 2) * 2, y - 6 - ph * 14);
    }
  });
});

// ---------------------------------------------------------------------------
// Прогрев: кадры снарядов (16 направлений × кадры вращения) и первые вызовы
// рисовальщиков контакта — пока в мире есть голова гидры.
// ---------------------------------------------------------------------------

registerMobWarm('f9_head', function* () {
  for (let d = 0; d < 16; d++) {
    for (let f = 0; f < 8; f++) {
      const key = `i|${d}|${f}`;
      if (!SHOTS.get(key)) SHOTS.set(key, iceSprite(d, f));
      yield;
    }
    for (let f = 0; f < 6; f++) {
      const key = `v|${d}|${f}`;
      if (!SHOTS.get(key)) SHOTS.set(key, venomSprite(d, f));
      yield;
    }
  }
  const c = new Px(8, 8).canvas().getContext('2d');
  if (!c) return;
  for (const art of [
    'f9_bite',
    'f9_firecone',
    'f9_iceball',
    'f9_venomglob',
    'f9_bolt',
    'f9_glare',
    'f9_tail',
    'f9_geyser',
    'f9_whirl',
    'f9_ray0',
  ]) {
    const def = IMPACT_PAINTERS.get(art);
    if (!def) continue;
    const rec: ImpactRec = {
      art,
      x: -99,
      y: -99,
      r: 2,
      ang: 0,
      arc: 1,
      w: 0.4,
      vx: 1,
      vy: 0,
      seed: 7,
    };
    for (const age of [0, 0.2, 0.6]) def.paint(c, rec, -500, -500, 16, age, 0);
    yield;
  }
});
