// Этаж 7, босс «Отражение героя» — техники (v2.86): метки ударов, контакт,
// осколки, трещины в воздухе, рябь зеркал. Тело босса рисует `f7-art.ts`,
// здесь — всё, что Отражение делает с МИРОМ. Договор движка — библия §14.
//
// Язык этажа — СТЕКЛО. Отражение — стеклянный двойник героя, и каждый его
// удар бьёт не по воздуху, а по зеркалу мира:
//   • метка удара — багровое «куда» с первого кадра и стеклянная кромка по
//     краю; «когда» — фронт налива идёт от Отражения к кромке и доходит до
//     неё ровно в миг урона (у тяжёлого — с разгоном, как падающий клинок);
//     последние 0,2 с — кромка белеет «тик-тик», в воздухе у кромки уже
//     бегут волоски трещин; по стеклу метки скользит блик;
//   • контакт — серп света по дуге взмаха (растёт по ходу клинка и тает с
//     хвоста), воздух в точке удара ТРЕСКАЕТСЯ звездой, держится миг и
//     осыпается кусками; стеклянные осколки летят с подбросом, падают,
//     отскакивают и лежат на полу, поблёскивая; на зеркальном полу — отсвет;
//   • у дуэли своих ударов (strike) нет — мозг бьёт `hurtHero` сам. Метку и
//     контакт ставит он же визуальными зонами (`api.vfx`, в `f7-brains.ts`
//     помечены «v2.86 — только рисунок»): метка следит за мобом и его
//     `m.tele` (своя на каждый замах — `m.data.vTz`), контакт встаёт в той
//     строке, где урон. Свои удары по площади (осколки копии, залп зеркал)
//     рисуются метками strike и `registerImpactPainter`;
//   • копии и настоящее рисуются ОДИНАКОВО — выдать настоящее может только
//     тень от люстры (`f7_trueshadow`), и она тоже здесь.
//
// Всё светящееся (кромки, серпы, трещины воздуха, искры, щель зеркала) —
// поверх темноты: вторая зона того же вида с `_lit`. Пол (заливка метки,
// лежащие осколки, трещины пола, отсвет, пыль) — под мобами.
//
// Пиксели — на СЕТКЕ МИРА (`Pen`): эффект стоит на полу, а не плывёт с
// камерой. Частицы детерминированы — позиция считается от зерна и возраста,
// а не копится по кадрам: лист кадров и игра рисуют одно и то же, стоп-кадр
// держит позу сам. Зерно — от места и угла, поэтому пол и свет одного удара
// видят одни и те же осколки: пока летит — рисует свет, лёг — пол.
import { Px } from '../dungeon-art';
import {
  paintSim,
  registerImpactPainter,
  registerMobWarm,
  registerZonePainter,
} from '../dungeon-paint';
import type { ImpactRec } from '../dungeon-paint';
import type { Mob, Strike, Zone } from '../dungeon-sim';
import { MAP_W } from './f7-art';

type RGBA = [number, number, number, number];

const TAU = Math.PI * 2;
const hx = (h: string, a = 255): RGBA => {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255, a];
};
/** Детерминированный шум по трём числам, 0…1. */
const hash = (a: number, b: number, c = 0) => {
  let h = (a * 374761393 + b * 668265263 + c * 1274126177) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const k01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const eOut2 = (t: number) => 1 - (1 - t) * (1 - t);
const eOut3 = (t: number) => 1 - (1 - t) * (1 - t) * (1 - t);
const eIn2 = (t: number) => t * t;
/** Остаток всегда положительный: у зон `api.vfx` номера отрицательные. */
const mod = (x: number, n: number) => ((x % n) + n) % n;

/** Последние 0,2 с перед уроном — ясный сигнал «сейчас». */
const SIG = 0.2;
/** «Тик-тик»: две вспышки в последние 0,2 с. */
const tick = (left: number) => left < SIG && Math.floor(left / 0.05) % 2 === 1;
/** На сколько пикселей над полом идёт клинок: удар — на высоте груди. */
const LIFT = 9;

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

// ---- Палитра: стекло, серебро, лиловый огонь, багрянец метки --------------

const C = {
  ink: '#10101a',
  deep: '#070a16',
  g0: '#28395a',
  g1: '#4a78a2',
  g2: '#88badc',
  g3: '#e2f6ff',
  cyan: '#9aeaff',
  hot: '#e0fbff',
  white: '#ffffff',
  v0: '#2a1c4c',
  v1: '#583c9c',
  v2: '#9a7ae2',
  v3: '#dccaff',
  shadow: '#04020a',
};

/** Цвета метки: «куда», «когда», сигнал, кромка, фронт, блик. */
interface Pal {
  dk: string;
  mid: string;
  hot: string;
  rim: string;
  front: string;
  sheen: string;
}
const PAL_CUT: Pal = {
  dk: '#5c0c2c',
  mid: '#c21842',
  hot: '#ff3a62',
  rim: '#9aeaff',
  front: '#ff9ab0',
  sheen: '#ffd6e0',
};
const PAL_GAZE: Pal = {
  dk: '#2c0c54',
  mid: '#8a2ad8',
  hot: '#c46aff',
  rim: '#dccaff',
  front: '#f0e2ff',
  sheen: '#f6ecff',
};

// ---- Перо: пиксели на сетке мира -------------------------------------------

/**
 * Рисует в игровых пикселях, привязанных к сетке МИРА: `(px, py)` — где на
 * экране точка мира `(wx, wy)` (в пикселях мира). Сдвиг камеры дробный, но
 * кратен точке экрана; поправка `qx/qy` одна на весь кадр — эффект стоит на
 * полу, а не дрожит по нему.
 */
class Pen {
  readonly g: CanvasRenderingContext2D;
  readonly qx: number;
  readonly qy: number;
  constructor(g: CanvasRenderingContext2D, px: number, py: number, wx: number, wy: number) {
    this.g = g;
    const sc = g.getTransform().a || 1;
    this.qx = Math.round((px - wx) * sc) / sc;
    this.qy = Math.round((py - wy) * sc) / sc;
  }
  /** Цвет и прозрачность; строку цвета холст разбирает заново на каждое присвоение — повтор пропускаем. */
  col(c: string, a = 1): void {
    if (c !== this.last) {
      this.g.fillStyle = c;
      this.last = c;
    }
    this.g.globalAlpha = a < 0 ? 0 : a > 1 ? 1 : a;
  }
  private last = "";
  /** После `restore()` холст вернул прежний цвет — забыть запомненный. */
  reset(): void {
    this.last = "";
  }
  dot(x: number, y: number, w = 1, h = 1): void {
    this.g.fillRect(Math.floor(x) + this.qx, Math.floor(y) + this.qy, w, h);
  }
  /** Отрезок строки [xa, xb] (целые пиксели мира). */
  row(y: number, xa: number, xb: number): void {
    this.g.fillRect(xa + this.qx, y + this.qy, xb - xa + 1, 1);
  }
  img(c: HTMLCanvasElement, x: number, y: number): void {
    this.g.drawImage(c, Math.floor(x) + this.qx, Math.floor(y) + this.qy);
  }
  /** Линия по пикселям (Брезенхэм); соседние в строке сливаются в отрезок. */
  line(x0: number, y0: number, x1: number, y1: number): void {
    let x = Math.floor(x0);
    let y = Math.floor(y0);
    const xe = Math.floor(x1);
    const ye = Math.floor(y1);
    const dx = Math.abs(xe - x);
    const dy = -Math.abs(ye - y);
    const sx = x < xe ? 1 : -1;
    const sy = y < ye ? 1 : -1;
    let err = dx + dy;
    let rx = x;
    let ry = y;
    let rw = 1;
    for (let n = 0; n < 2400 && (x !== xe || y !== ye); n++) {
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
      if (y === ry) {
        if (x < rx) rx = x;
        rw++;
      } else {
        this.g.fillRect(rx + this.qx, ry + this.qy, rw, 1);
        rx = x;
        ry = y;
        rw = 1;
      }
    }
    this.g.fillRect(rx + this.qx, ry + this.qy, rw, 1);
  }
  /** Пунктир: `on` пикселей видно, `off` — нет, `run` — бег штрихов. */
  dash(x0: number, y0: number, x1: number, y1: number, on: number, off: number, run: number) {
    const L = Math.hypot(x1 - x0, y1 - y0);
    if (L < 0.5) return;
    const ux = (x1 - x0) / L;
    const uy = (y1 - y0) / L;
    const per = on + off;
    for (let s = 0; s <= L; s += 1) if (mod(s - run, per) < on) this.dot(x0 + ux * s, y0 + uy * s);
  }
}

// ---- Заливки по строкам: сектор и выпуклый многоугольник ---------------------

/**
 * Кольцевой сектор [r0, r1] × [a0, a1] строками пикселей: `cb(Y, xa, xb)`.
 * Угол больше четверти круга режется на куски с общими границами — пиксель
 * на стыке достаётся ровно одному куску, полупрозрачное не двоится.
 */
function sectorRows(
  cx: number,
  cy: number,
  r0: number,
  r1: number,
  a0: number,
  a1: number,
  cb: (y: number, xa: number, xb: number) => void,
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
  const y0 = Math.floor(cy - r1);
  const y1 = Math.ceil(cy + r1);
  for (let Y = y0; Y <= y1; Y++) {
    const yy = Y + 0.5 - cy;
    if (Math.abs(yy) >= r1) continue;
    const ho = Math.sqrt(r1 * r1 - yy * yy);
    const hi = Math.abs(yy) < r0 ? Math.sqrt(r0 * r0 - yy * yy) : 0;
    for (let j = 0; j < n; j++)
      for (let s = 0; s < (hi > 0 ? 2 : 1); s++) {
        let lo = hi > 0 ? (s ? hi : -ho) : -ho;
        let up = hi > 0 ? (s ? ho : -hi) : ho;
        if (!full) {
          // Не раньше начала куска: sin(θ − a_j) ≥ 0.
          const A = -by[j];
          const B = bx[j] * yy;
          if (A > 1e-9) lo = Math.max(lo, -B / A);
          else if (A < -1e-9) up = Math.min(up, -B / A);
          else if (B < 0) continue;
          // Раньше конца куска: sin(θ − a_{j+1}) < 0.
          const A2 = by[j + 1];
          const B2 = -bx[j + 1] * yy;
          if (A2 > 1e-9) lo = Math.max(lo, -B2 / A2);
          else if (A2 < -1e-9) up = Math.min(up, -B2 / A2);
          else if (B2 <= 0) continue;
        }
        const xa = Math.ceil(cx + lo - 0.5);
        const xb = Math.floor(cx + up - 0.5);
        if (xb >= xa) cb(Y, xa, xb);
      }
  }
}

function fillSector(
  p: Pen,
  cx: number,
  cy: number,
  r0: number,
  r1: number,
  a0: number,
  a1: number,
): void {
  sectorRows(cx, cy, r0, r1, a0, a1, (Y, xa, xb) => p.row(Y, xa, xb));
}

/** Выпуклый многоугольник строками пикселей. */
function convexRows(
  xs: number[],
  ys: number[],
  cb: (y: number, xa: number, xb: number) => void,
): void {
  const n = xs.length;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const y of ys) {
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  for (let Y = Math.floor(y0); Y <= Math.ceil(y1); Y++) {
    const yy = Y + 0.5;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ya = ys[i];
      const yb = ys[j];
      if ((ya <= yy && yb > yy) || (yb <= yy && ya > yy)) {
        const x = xs[i] + ((yy - ya) * (xs[j] - xs[i])) / (yb - ya);
        lo = Math.min(lo, x);
        hi = Math.max(hi, x);
      }
    }
    if (lo > hi) continue;
    const xa = Math.ceil(lo - 0.5);
    const xb = Math.floor(hi - 0.5);
    if (xb >= xa) cb(Y, xa, xb);
  }
}

/** Полоса вдоль направления (ux, uy): от s0 до s1, полуширина hw. */
function laneRows(
  cx: number,
  cy: number,
  ux: number,
  uy: number,
  s0: number,
  s1: number,
  hw: number,
  cb: (y: number, xa: number, xb: number) => void,
): void {
  if (s1 <= s0) return;
  const nx = -uy;
  const ny = ux;
  convexRows(
    [
      cx + ux * s0 + nx * hw,
      cx + ux * s1 + nx * hw,
      cx + ux * s1 - nx * hw,
      cx + ux * s0 - nx * hw,
    ],
    [
      cy + uy * s0 + ny * hw,
      cy + uy * s1 + ny * hw,
      cy + uy * s1 - ny * hw,
      cy + uy * s0 - ny * hw,
    ],
    cb,
  );
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
    const key = (x + 1024) * 4096 + (y + 1024);
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
  const withA = pts.map(([px, py]) => [px, py, Math.atan2(py, px)]);
  withA.sort((p, q) => p[2] - q[2]);
  c = {
    x: Int16Array.from(withA.map((p) => p[0])),
    y: Int16Array.from(withA.map((p) => p[1])),
    a: Float32Array.from(withA.map((p) => p[2])),
  };
  if (circles.size > 400) circles.delete(circles.keys().next().value as number);
  circles.set(R, c);
  return c;
}

/** Угол a в дуге [a0, a0 + span] (span > 0) с переходом через 2π. */
const inArc = (a: number, a0: number, span: number) => mod(a - a0, TAU) <= span;

/**
 * Кольцо по пикселям текущим цветом. `keep(a, i)` — оставить ли пиксель
 * (дуга, пунктир, рваная волна). Соседние пиксели сливаются в отрезки.
 */
function ring(
  p: Pen,
  cx: number,
  cy: number,
  r: number,
  keep?: (a: number, i: number) => boolean,
): void {
  if (r < 0.6) return;
  const pts = circle(r);
  const ox = Math.floor(cx);
  const oy = Math.floor(cy);
  const n = pts.x.length;
  let rx = 0;
  let ry = 0;
  let rw = 0;
  let rh = 0;
  for (let i = 0; i < n; i++) {
    if (keep && !keep(pts.a[i], i)) continue;
    const x = ox + pts.x[i];
    const y = oy + pts.y[i];
    if (rw && rh === 1 && y === ry && (x === rx + rw || x === rx - 1)) {
      if (x < rx) rx = x;
      rw++;
      continue;
    }
    if (rw === 1 && x === rx && (y === ry + rh || y === ry - 1)) {
      if (y < ry) ry = y;
      rh++;
      continue;
    }
    if (rw) p.g.fillRect(rx + p.qx, ry + p.qy, rw, rh);
    rx = x;
    ry = y;
    rw = 1;
    rh = 1;
  }
  if (rw) p.g.fillRect(rx + p.qx, ry + p.qy, rw, rh);
}

// ---- Спрайты-заготовки: осколки, блёстки, пыль ------------------------------

const sprites = new Map<number, HTMLCanvasElement>();
const sprite = (key: number, make: () => Px): HTMLCanvasElement => {
  let c = sprites.get(key);
  if (!c) {
    c = make().canvas();
    sprites.set(key, c);
  }
  return c;
};

/** Тона осколков: стекло, серебро, лиловое стекло. Тень, основа, свет, блик. */
const SHARD_PAL: RGBA[][] = [
  [hx('#1c2c4a'), hx('#4a78a2'), hx('#9ccbe8'), hx('#f2fcff')],
  [hx('#2c3444'), hx('#6c7a8e'), hx('#b4c2d4'), hx('#ffffff')],
  [hx('#24163e'), hx('#6a48b0'), hx('#b89af0'), hx('#f4ecff')],
];
const SHARD_FRAMES = 8;

/**
 * Осколок стекла размером sz (2…5), кадр вращения f (0…7), палитра pal.
 * Кувыркается: плоская щепка поворачивается и то ловит свет гранью
 * (блик), то встаёт ребром (тонкая тёмная черта).
 */
function shardImg(sz: number, f: number, pal: number): HTMLCanvasElement {
  return sprite(10000 + sz * 1000 + f * 10 + pal, () => {
    const n = sz * 2 + 3;
    const p = new Px(n, n);
    const c = n / 2;
    const th = (f / SHARD_FRAMES) * Math.PI + 0.3;
    const face = Math.abs(Math.cos((f / SHARD_FRAMES) * TAU * 0.75));
    const w = 0.28 + 0.72 * face;
    const ux = Math.cos(th);
    const uy = Math.sin(th);
    const L = sz * 0.95 + 0.6;
    const B = sz * 0.55 + 0.3;
    const W = sz * 0.42 * w + 0.35;
    const ax = c + ux * L;
    const ay = c + uy * L;
    const bx = c - ux * B - uy * W;
    const by = c - uy * B + ux * W;
    const cx2 = c - ux * B * 0.7 + uy * W;
    const cy2 = c - uy * B * 0.7 - ux * W;
    const T = SHARD_PAL[pal];
    const tri = (x: number, y: number, x0: number, y0: number, x1: number, y1: number) =>
      (x1 - x0) * (y - y0) - (y1 - y0) * (x - x0);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const X = x + 0.5;
        const Y = y + 0.5;
        const d1 = tri(X, Y, ax, ay, bx, by);
        const d2 = tri(X, Y, bx, by, cx2, cy2);
        const d3 = tri(X, Y, cx2, cy2, ax, ay);
        const neg = d1 < 0 || d2 < 0 || d3 < 0;
        const pos = d1 > 0 || d2 > 0 || d3 > 0;
        if (neg && pos) continue;
        // Свет сверху-слева: верхняя-левая половина светлее.
        const lit = (X - c) * -0.6 + (Y - c) * -0.8 > 0;
        p.set(x, y, face > 0.86 ? (lit ? T[3] : T[2]) : lit ? T[2] : T[1]);
      }
    if (!p.data.some((v, i) => i % 4 === 3 && v > 0)) p.set(Math.floor(c), Math.floor(c), T[2]);
    p.outline([T[0][0], T[0][1], T[0][2], 200]);
    return p;
  });
}

/** Блёстка: крест с белой серединой, r 1…4; у крупных — короткие диагонали. */
function glintImg(r: number, pal: number): HTMLCanvasElement {
  return sprite(20000 + r * 10 + pal, () => {
    const n = r * 2 + 1;
    const p = new Px(n, n);
    const arm = pal === 2 ? hx('#c8a8ff') : pal === 1 ? hx('#ff9ab0') : hx('#9aeaff');
    const tip = pal === 2 ? hx('#7a4ad8', 180) : pal === 1 ? hx('#c21842', 180) : hx('#4a9ad8', 180);
    for (let i = 1; i <= r; i++) {
      const c = i === r && r > 1 ? tip : arm;
      p.set(r + i, r, c);
      p.set(r - i, r, c);
      p.set(r, r + i, c);
      p.set(r, r - i, c);
    }
    if (r >= 3) {
      const d = hx('#e0fbff', 150);
      p.set(r + 1, r + 1, d);
      p.set(r - 1, r - 1, d);
      p.set(r + 1, r - 1, d);
      p.set(r - 1, r + 1, d);
    }
    p.set(r, r, hx('#ffffff'));
    return p;
  });
}

/** Стеклянная пыль: клуб с рваным краем, свет сверху-слева. r 2…9. */
function puffImg(r: number, v: number): HTMLCanvasElement {
  const R = Math.max(2, Math.min(9, Math.round(r)));
  return sprite(30000 + R * 10 + (v & 3), () => {
    const n = R * 2 + 3;
    const p = new Px(n, n);
    const c = n / 2;
    const lo = hx('#5a7aa0', 100);
    const mid = hx('#9cbcdc', 135);
    const hi = hx('#e2f2ff', 175);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const dx = x + 0.5 - c;
        const dy = y + 0.5 - c;
        const a = Math.atan2(dy, dx);
        const edge = R * (0.82 + 0.18 * Math.sin(a * 3 + v * 1.7) * Math.cos(a * 2 - v));
        const d = Math.hypot(dx, dy);
        if (d > edge) continue;
        const lit = (-dx * 0.6 - dy * 0.8) / R;
        p.set(x, y, lit > 0.25 ? hi : lit < -0.35 ? lo : mid);
      }
    return p;
  });
}

// ---- Частицы: позиция от зерна и возраста -----------------------------------

interface Fly {
  /** Путь по земле в секундах начальной скорости, высота, в воздухе ли. */
  h: number;
  z: number;
  air: boolean;
}
/**
 * Полёт осколка: старт с высоты z0, подброс vz, тяжесть G, отскоки с потерей
 * энергии (e) и трением. `h` — путь по земле в секундах начальной скорости.
 */
function fly(t: number, z0: number, vz: number, G: number, e = 0.3): Fly {
  let tt = t;
  let v = vz;
  let z = z0;
  let sp = 1;
  let h = 0;
  for (let b = 0; b < 3; b++) {
    const T = (v + Math.sqrt(v * v + 2 * G * z)) / G;
    if (tt < T) return { h: h + sp * tt, z: z + v * tt - (G * tt * tt) / 2, air: true };
    tt -= T;
    h += sp * T;
    v = Math.sqrt(v * v + 2 * G * z) * e;
    z = 0;
    sp *= 0.4;
    if (v < 12) break;
  }
  const slide = Math.min(tt, 0.1);
  return { h: h + sp * (slide - (slide * slide) / 0.2), z: 0, air: false };
}

interface ShardSpec {
  seed: number;
  n: number;
  /** Откуда (пиксели мира, земля) и с какой высоты. */
  x: number;
  y: number;
  z0: number;
  ang: number;
  spread: number;
  v0: number;
  dv: number;
  vz0: number;
  dvz: number;
  /** Доля крупных, палитра (0 стекло, 1 серебро, 2 лиловое). */
  big: number;
  pal: number;
  /** Когда лежащие гаснут: [начало, конец]. */
  fade: [number, number];
  /** Старт полёта, с (для отложенных). */
  t0?: number;
}

/**
 * Осколки: `layer` 'air' — только летящие (слой света), 'ground' — только
 * легшие (пол). Одно зерно — одни и те же осколки в обоих слоях.
 */
function shards(p: Pen, s: ShardSpec, age: number, time: number, layer: 'air' | 'ground'): void {
  const t = age - (s.t0 ?? 0);
  if (t < 0) return;
  const a = 1 - k01((t - s.fade[0]) / (s.fade[1] - s.fade[0]));
  if (a <= 0) return;
  const n = reduced() ? Math.ceil(s.n / 2) : s.n;
  for (let i = 0; i < n; i++) {
    const r1 = hash(s.seed, i, 11);
    const r2 = hash(s.seed, i, 12);
    const r3 = hash(s.seed, i, 13);
    const r4 = hash(s.seed, i, 14);
    const th = s.ang + (r1 - 0.5) * 2 * s.spread;
    const v = s.v0 + s.dv * r2;
    const f = fly(t, s.z0 * (0.7 + 0.6 * r4), s.vz0 + s.dvz * r3, 420);
    if (f.air !== (layer === 'air')) continue;
    const gx = s.x + Math.cos(th) * v * f.h;
    const gy = s.y + Math.sin(th) * v * f.h * 0.85;
    const sz = r4 < s.big * 0.4 ? 5 : r4 < s.big ? 4 : r4 < 0.6 ? 3 : 2;
    if (f.air) {
      // Тень на полу — видно, где он упадёт.
      p.col(C.shadow, 0.35 * a);
      p.dot(gx - sz / 2, gy, sz, 1);
      const spin = mod(Math.floor(t * (18 + r2 * 16)) + i, SHARD_FRAMES);
      const im = shardImg(sz, spin, s.pal);
      p.col('#000', a);
      p.img(im, gx - im.width / 2, gy - f.z - im.height / 2);
    } else {
      const im = shardImg(sz, (i * 3) & 7, s.pal);
      p.col('#000', a * 0.92);
      p.img(im, gx - im.width / 2, gy - im.height / 2 + 1);
      // Лежащий осколок ловит свет: изредка вспыхивает блёсткой.
      const tw = hash(s.seed, i, Math.floor(time * 5 + r1 * 7));
      if (tw < 0.07 && !reduced()) {
        const gl = glintImg(tw < 0.025 ? 2 : 1, s.pal === 2 ? 2 : 0);
        p.col('#000', a);
        p.img(gl, gx - gl.width / 2, gy - gl.height / 2);
      }
    }
  }
}

/**
 * Звезда удара по пикселям: n лучей радиуса r (у основания — 0,35 r). Кадр
 * контакта: белая сердцевина и стеклянный ореол, за 2–3 кадра сжимается.
 * Строки сливаются в отрезки — вызовов рисования по числу строк.
 */
function starRows(p: Pen, cx: number, cy: number, r: number, n: number, rot: number): void {
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
          const spike = Math.pow(Math.abs(Math.cos((th * n) / 2)), 4);
          on = d <= r * (0.35 + 0.65 * spike);
        }
      }
      if (on && run < 0) run = x;
      if (!on && run >= 0) {
        p.row(y0 + y, x0 + run, x0 + x - 1);
        run = -1;
      }
    }
  }
}
/** Вспышка контакта: звезда `r` за `T` с сжимается, белая → стекло. */
function impactStar(
  p: Pen,
  x: number,
  y: number,
  age: number,
  T: number,
  r: number,
  rot: number,
  vio = false,
): void {
  if (age >= T) return;
  const q = age / T;
  p.col(vio ? C.v2 : C.cyan, 0.8 * (1 - q));
  starRows(p, x, y, r * (1.25 - 0.55 * q), 8, rot + 0.2);
  p.col(q < 0.45 ? C.white : vio ? C.v3 : C.hot, 1);
  starRows(p, x, y, r * (1 - 0.6 * q), 4, rot);
}

/** Блёстки: вспыхивают по очереди и гаснут на месте. */
function glints(
  p: Pen,
  seed: number,
  age: number,
  n: number,
  at: (i: number) => [number, number],
  t0: number,
  span: number,
  life: number,
  rMax: number,
  pal: number,
): void {
  for (let i = 0; i < n; i++) {
    const tb = t0 + span * hash(seed, i, 61);
    const q = (age - tb) / life;
    if (q < 0 || q >= 1) continue;
    const r = Math.max(1, Math.round(rMax * Math.sin(Math.PI * q)));
    const [x, y] = at(i);
    const im = glintImg(r, pal);
    p.col('#000', 1);
    p.img(im, x - im.width / 2, y - im.height / 2);
  }
}

/**
 * Отсвет вспышки на ЗЕРКАЛЬНОМ полу: пол не темнеет пятном, а светлеет —
 * тёплое ядро и кольцо света, расходящееся по стеклу (сложение цвета).
 */
function floorFlash(p: Pen, x: number, y: number, age: number, T: number, rMax: number): void {
  if (age >= T) return;
  const q = age / T;
  p.g.save();
  p.g.globalCompositeOperation = 'lighter';
  p.col(C.g1, 0.45 * (1 - q));
  fillSector(p, x, y, 0, 2 + 5 * (1 - q), 0, TAU);
  p.col(C.g2, 0.55 * (1 - q));
  ring(p, x, y, 4 + rMax * eOut2(q));
  p.col(C.g1, 0.35 * (1 - q));
  ring(p, x, y, 3 + rMax * 0.78 * eOut2(q));
  p.g.restore();
  p.reset();
}

/**
 * Стеклянная крошка: светлые точки разлетаются с сопротивлением и
 * подскоком, мерцают (то белая, то стекло) и гаснут. Клуб пыли на тёмном
 * зеркальном полу читается серым пятном — стекло крошится искрами.
 */
function specks(
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
  up = 0,
): void {
  if (reduced()) n = Math.ceil(n / 2);
  for (let i = 0; i < n; i++) {
    const h1 = hash(seed, i, 26);
    const h2 = hash(seed, i, 27);
    const h3 = hash(seed, i, 28);
    const L = life * (0.55 + 0.6 * h3);
    if (age >= L) continue;
    const k = age / L;
    const th = ang + (h1 - 0.5) * 2 * spread;
    const d = ((v0 + dv * h2) / 4) * (1 - Math.exp(-4 * age));
    const z = Math.max(0, up * (0.5 + h2) * age - 150 * age * age);
    const tw = hash(seed, i, Math.floor(age * 24));
    p.col(tw < 0.3 ? C.white : i % 3 ? C.cyan : C.g2, 1 - k * k);
    p.dot(x + Math.cos(th) * d, y + Math.sin(th) * d * 0.8 - z);
  }
}

/** Пыль клубами: из (x, y) по направлению ± разброс, растёт и тает. */
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
  alpha = 0.7,
): void {
  if (reduced()) n = Math.ceil(n / 2);
  for (let i = 0; i < n; i++) {
    const h1 = hash(seed, i, 21);
    const h2 = hash(seed, i, 22);
    const h3 = hash(seed, i, 23);
    const L = life * (0.7 + 0.5 * h3);
    if (age >= L) continue;
    const k = age / L;
    const th = ang + (h1 - 0.5) * 2 * spread;
    const d = ((v0 + dv * h2) / 3.2) * (1 - Math.exp(-3.2 * age));
    const r = r0 + (r1 - r0) * (0.5 + 0.5 * h3) * eOut2(k01(k / 0.6));
    const im = puffImg(r, i);
    p.col('#000', alpha * (k < 0.3 ? 1 : 1 - (k - 0.3) / 0.7));
    p.img(
      im,
      x + Math.cos(th) * d - im.width / 2,
      y + Math.sin(th) * d * 0.8 - rise * eOut2(k) - im.height / 2,
    );
  }
}

// ---- Трещины: сеть от зерна, растёт от точки ---------------------------------

interface Crack {
  x: Int16Array;
  y: Int16Array;
  d: Float32Array;
  max: number;
}
const cracks = new Map<string, Crack>();

/**
 * Сеть трещин из (0, 0): ветви `[угол, длина, ширина]`, излом `jag`,
 * развилки с шансом `forkP`. Каждый пиксель знает путь от корня — трещина
 * «бежит», а не проявляется.
 */
function crackOf(
  key: string,
  seed: number,
  br: [number, number, number][],
  jag = 0.5,
  forkP = 0.25,
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
      a = a * 0.7 + a0 * 0.3;
      const nx = x + Math.cos(a) * 2;
      const ny = y + Math.sin(a) * 2;
      const w = wid * (1 - s / len);
      for (let q = 0; q <= 4; q++) {
        const qx = x + ((nx - x) * q) / 4;
        const qy = y + ((ny - y) * q) / 4;
        const d = d0 + s + q * 0.5;
        put(Math.floor(qx), Math.floor(qy), d);
        if (w > 1.2)
          put(Math.floor(qx + Math.sin(a) * 0.95), Math.floor(qy - Math.cos(a) * 0.95), d);
      }
      x = nx;
      y = ny;
      if (depth < 1 && s > len * 0.3 && s < len * 0.75 && hash(seed, id * 17 + i, 2) < forkP) {
        const side = hash(seed, id * 19 + i, 3) < 0.5 ? -1 : 1;
        walk(x, y, a + side * (0.5 + 0.5 * hash(seed, id, 4)), (len - s) * 0.55, d0 + s, 1, id * 7 + i + 1, depth + 1);
      }
    }
  };
  br.forEach(([a, len, w], i) => walk(0.5, 0.5, a, len, 0, w, i + 1, 0));
  const pts = [...px.entries()].map(([k, d]) => [Math.floor(k / 4096) - 1024, (k % 4096) - 1024, d]);
  pts.sort((a, b) => a[2] - b[2]);
  c = {
    x: Int16Array.from(pts.map((q) => q[0])),
    y: Int16Array.from(pts.map((q) => q[1])),
    d: Float32Array.from(pts.map((q) => q[2])),
    max: pts.length ? pts[pts.length - 1][2] : 0,
  };
  if (cracks.size > 160) cracks.delete(cracks.keys().next().value as string);
  cracks.set(key, c);
  return c;
}

/** Звезда трещин: n ветвей, первая — по углу a, длины lo…hi. */
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
    i % 2 ? 1 : w,
  ]);

/** Трещина до пути `reach` одним цветом. */
function drawCrack(p: Pen, c: Crack, x: number, y: number, reach: number): void {
  const ox = Math.floor(x);
  const oy = Math.floor(y);
  for (let i = 0; i < c.x.length && c.d[i] <= reach; i++) p.dot(ox + c.x[i], oy + c.y[i]);
}

/**
 * Трещина в ВОЗДУХЕ: звезда света бежит от точки удара за `grow` с,
 * держится до `hold`, потом осыпается кусками по 5 пикселей пути — каждый
 * падает с подскоком и гаснет. Тёмная подкладка на пиксель вниз-вправо
 * делает её сколом, а не рисунком мелом.
 */
function airCrack(
  p: Pen,
  c: Crack,
  x: number,
  y: number,
  age: number,
  grow: number,
  hold: number,
  seed: number,
  vio = false,
): void {
  if (age < 0) return;
  const ox = Math.floor(x);
  const oy = Math.floor(y);
  const core = vio ? C.v3 : C.hot;
  const edge = vio ? C.v2 : C.cyan;
  if (age < hold) {
    const reach = c.max * eOut3(k01(age / grow));
    const flash = age < grow + 0.03;
    p.col(C.v0, 0.55);
    for (let i = 0; i < c.x.length && c.d[i] <= reach; i++) p.dot(ox + c.x[i] + 1, oy + c.y[i] + 1);
    for (let i = 0; i < c.x.length && c.d[i] <= reach; i++) {
      // Середина горит белым, к концам — стекло.
      const far = c.d[i] > c.max * 0.55;
      p.col(flash ? C.white : far ? edge : core, 1);
      p.dot(ox + c.x[i], oy + c.y[i]);
    }
    return;
  }
  // Осыпается: куски пути падают, каждый своим ходом.
  const t = age - hold;
  if (t > 0.5) return;
  const G = 380;
  for (let i = 0; i < c.x.length; i++) {
    const ch = Math.floor(c.d[i] / 5);
    const d0 = hash(seed, ch, 71) * 0.08;
    const tt = Math.max(0, t - d0);
    const vx = (hash(seed, ch, 72) - 0.5) * 30;
    const vy = -10 - 25 * hash(seed, ch, 73);
    const dy = vy * tt + (G * tt * tt) / 2;
    const a = 1 - k01(tt / 0.42);
    if (a <= 0 || dy > 22) continue;
    const glint = hash(seed, ch, Math.floor(age * 20)) < 0.25;
    p.col(glint ? C.white : ch % 2 ? edge : C.g2, a);
    p.dot(ox + c.x[i] + vx * tt, oy + c.y[i] + dy);
  }
}

// ---- Общее для зон -----------------------------------------------------------

/** Поля визуальных зон мозга (`vfx()` в f7-brains) и ударов. */
type FxZone = (Zone | Strike) & {
  vA?: number;
  vR?: number;
  vArc?: number;
  vK?: number;
  vm?: number;
  vT?: number;
  vP?: number;
  vS?: number;
  vL?: number;
  mi?: number;
  lx?: number;
  ly?: number;
  mob?: number;
  ang?: number;
  warn?: number;
};

const mobOf = (id: number | undefined): Mob | undefined =>
  id === undefined ? undefined : paintSim()?.mobs.find((m) => m.id === id);

/** Зерно от места и угла: пол и свет одного удара видят одни осколки. */
const seedOf = (x: number, y: number, a = 0) =>
  (Math.round(x * 64) * 7919 + Math.round(y * 64) * 104729 + Math.round(a * 997) * 31) >>> 0;

/**
 * Обёртка рисовальщика: контекст сохраняется и возвращается (зоны рисуются
 * без `save/restore` движка — прозрачность не должна утечь в соседей).
 */
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

/** Зона-картинка мозга: возраст с учётом `warn`, центр в пикселях мира. */
interface Fx {
  z: FxZone;
  p: Pen;
  cx: number;
  cy: number;
  age: number;
  sd: number;
  S: number;
  time: number;
}
function fxZone(
  f: (fx: Fx) => void,
): (g: CanvasRenderingContext2D, z0: Zone | Strike, px: number, py: number, S: number, time: number) => boolean {
  return guarded((g, z0: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const z = z0 as FxZone;
    const age = z.t - (z.warn ?? 0);
    if (age < 0) return;
    const cx = z.x * S;
    const cy = z.y * S;
    f({ z, p: new Pen(g, px, py, cx, cy), cx, cy, age, sd: seedOf(z.x, z.y, z.vA ?? 0), S, time });
  });
}

/** Такая же зона уже рисуется рядом (копии уходят в зеркало с одного места). */
function dup(z: FxZone): boolean {
  const sim = paintSim();
  if (!sim) return false;
  for (const q of sim.zones)
    if (
      q !== z &&
      q.art === z.art &&
      q.id > z.id &&
      Math.abs(q.x - z.x) < 0.3 &&
      Math.abs(q.y - z.y) < 0.3 &&
      Math.abs(q.t - z.t) < 0.1
    )
      return true;
  return false;
}

// =============================================================================
// МЕТКИ ЗАМАХА. Зона следит за мобом: форма — из `m.tele` (мозг доворачивает
// клинок за героем первые ползамаха), время — `m.t` против длины замаха
// `vT`. Пол: багровое «куда», налив «когда», блик по стеклу, у тяжёлого —
// иней трещин. Свет: стеклянная кромка бегущим пунктиром, фронт, искры,
// последние 0,2 с — белая кромка «тик-тик» и волоски трещин в воздухе.
// =============================================================================

type TeleStyle = 'cut' | 'heavy' | 'lane' | 'gaze';
interface Tele {
  shape: 'cone' | 'line';
  cx: number;
  cy: number;
  R: number;
  hw: number;
  ang: number;
  arc: number;
  k: number;
  left: number;
  style: TeleStyle;
  seed: number;
}

const STYLE: Record<string, TeleStyle> = {
  combo: 'cut',
  riposte: 'cut',
  heavy: 'heavy',
  dashAim: 'lane',
  maim: 'lane',
  gaze: 'gaze',
};

function teleOf(z: FxZone, S: number, lit: boolean): Tele | null {
  const m = mobOf(z.vm);
  if (!m || m.mode === 'dying') return null;
  // Своя метка у каждого замаха: новый замах — новая зона, старая молчит.
  const own = m.data.vTz;
  if (own !== undefined && z.id !== (lit ? own - 1 : own)) return null;
  const t = m.tele;
  const style = STYLE[m.mode];
  if (!t || !style) return null;
  const T = z.vT ?? 0.5;
  if (m.t < 0 || m.t > T + 1e-3) return null;
  return {
    shape: t.shape === 'line' ? 'line' : 'cone',
    cx: m.x * S,
    cy: m.y * S,
    R: t.r * S,
    hw: (t.w ?? 0.5) * S,
    ang: t.ang ?? m.dir,
    arc: t.arc ?? 1,
    k: k01(m.t / T),
    left: T - m.t,
    style,
    seed: mod(z.id * 7919, 1e6) + m.id * 31,
  };
}

/** Перо у моба: зона стоит там, где начался замах, моб мог сдвинуться. */
const penAt = (g: CanvasRenderingContext2D, z: FxZone, px: number, py: number, S: number, t: Tele) =>
  new Pen(g, px + t.cx - z.x * S, py + t.cy - z.y * S, t.cx, t.cy);

/** «Когда» тяжелее у тяжёлого: клинок падает с разгоном. */
const frontK = (t: Tele) => (t.style === 'heavy' ? Math.pow(t.k, 2.2) : Math.pow(t.k, 1.6));

/** Блик по стеклу метки: косая полоса проходит по сектору раз в 0,9 с. */
function sheenCone(p: Pen, t: Tele, r0: number, time: number, c: string, a: number): void {
  const per = 0.9;
  const ph = mod(time + (t.seed % 97) * 0.01, per) / per;
  const span = t.R * 2.4;
  const c0 = t.cx + t.cy - span / 2 + span * ph;
  p.col(c, a * Math.sin(Math.PI * ph));
  sectorRows(t.cx, t.cy, r0, t.R, t.ang - t.arc / 2, t.ang + t.arc / 2, (Y, xa, xb) => {
    const b0 = Math.max(xa, Math.floor(c0 - Y));
    const b1 = Math.min(xb, Math.floor(c0 - Y) + 2);
    if (b1 >= b0) p.row(Y, b0, b1);
  });
}

function coneFloor(p: Pen, t: Tele, time: number): void {
  const pal = t.style === 'gaze' ? PAL_GAZE : PAL_CUT;
  const r0 = 5;
  const a0 = t.ang - t.arc / 2;
  const a1 = t.ang + t.arc / 2;
  const sig = t.left < SIG;
  const tk = !reduced() && tick(t.left);
  // «Куда»: весь сектор с первого кадра.
  p.col(pal.dk, 0.3 + 0.1 * t.k);
  fillSector(p, t.cx, t.cy, r0, t.R, a0, a1);
  // «Когда»: налив от Отражения к кромке.
  const rf = r0 + (t.R - r0) * (0.06 + 0.94 * frontK(t));
  p.col(sig ? pal.hot : pal.mid, (tk ? 0.5 : 0.26) + 0.14 * t.k);
  fillSector(p, t.cx, t.cy, r0, rf, a0, a1);
  if (!reduced()) sheenCone(p, t, r0, time, pal.sheen, 0.16 + 0.1 * t.k);
  // Тяжёлый: зеркальный пол покрывается инеем трещин от точки удара.
  if (t.style === 'heavy' && t.k > 0.3) {
    const bx = t.cx + Math.cos(t.ang) * 17;
    const by = t.cy + Math.sin(t.ang) * 17;
    const ck = crackOf(
      `htele|${t.seed % 4099}`,
      t.seed,
      starBranches(t.seed, 6, t.ang, 10, t.R * 0.7, 1),
      0.55,
      0.3,
    );
    p.col(C.deep, 0.75);
    drawCrack(p, ck, bx, by, ck.max * eIn2(k01((t.k - 0.3) / 0.7)));
  }
}

function coneLit(p: Pen, t: Tele, time: number): void {
  const pal = t.style === 'gaze' ? PAL_GAZE : PAL_CUT;
  const r0 = 5;
  const a0 = t.ang - t.arc / 2;
  const sig = t.left < SIG;
  const tk = !reduced() && tick(t.left);
  const kf = frontK(t);
  const rf = r0 + (t.R - r0) * (0.06 + 0.94 * kf);
  // Кромка: стеклянный пунктир бежит от краёв к оси — удар сходится в сектор.
  const run = time * (22 + 70 * t.k);
  const mid = t.arc / 2;
  const keepRim = (a: number) => {
    if (!inArc(a, a0, t.arc)) return false;
    if (sig) return true;
    const u = Math.abs(mod(a - a0, TAU) - mid) * t.R;
    return mod(u + run, 7) < 4.5;
  };
  p.col(C.ink, 0.5);
  ring(p, t.cx + 1, t.cy + 1, t.R, keepRim);
  p.col(sig ? (tk ? C.white : pal.hot) : pal.rim, 0.55 + 0.4 * t.k);
  ring(p, t.cx, t.cy, t.R, keepRim);
  // Края сектора — точками.
  for (const ea of [a0, a0 + t.arc]) {
    const ux = Math.cos(ea);
    const uy = Math.sin(ea);
    p.col(sig ? (tk ? C.white : pal.hot) : pal.rim, 0.35 + 0.4 * t.k);
    if (sig) p.line(t.cx + ux * (r0 + 2), t.cy + uy * (r0 + 2), t.cx + ux * t.R, t.cy + uy * t.R);
    else p.dash(t.cx + ux * (r0 + 2), t.cy + uy * (r0 + 2), t.cx + ux * t.R, t.cy + uy * t.R, 2, 3, -run * 0.5);
  }
  // Фронт «когда»: яркая дуга и мягкий след за ней.
  const inside = (a: number) => inArc(a, a0, t.arc);
  if (rf > r0 + 1) {
    p.col(pal.front, 0.3 + 0.3 * t.k);
    ring(p, t.cx, t.cy, rf - 1.5, inside);
    p.col(sig ? C.white : pal.front, 0.7 + 0.3 * t.k);
    ring(p, t.cx, t.cy, rf, inside);
  }
  const seed = t.seed;
  if (t.style === 'heavy' || t.style === 'gaze') {
    // Сила стягивается к клинку (тяжёлый) или бьёт из глаз наружу (взгляд).
    const n = reduced() ? 5 : 11;
    for (let i = 0; i < n; i++) {
      const aa = a0 + t.arc * hash(seed, i, 81);
      const sp = 0.7 + 0.6 * hash(seed, i, 82);
      const ph = mod(time * sp * (0.6 + 1.6 * t.k) + hash(seed, i, 83), 1);
      const rr = t.style === 'heavy' ? t.R * (1 - ph) + 4 : r0 + (t.R - r0) * ph;
      const x = t.cx + Math.cos(aa) * rr;
      const y = t.cy + Math.sin(aa) * rr - (t.style === 'heavy' ? 2 + 10 * (1 - rr / t.R) : 0);
      p.col(t.style === 'gaze' ? C.v3 : i % 3 ? C.cyan : C.white, 0.9 * Math.sin(Math.PI * ph));
      p.dot(x, y);
      if (i % 3 === 0) p.dot(x - 1, y);
    }
  }
  // Последние 0,2 с: у кромки в воздухе бегут волоски трещин.
  if (sig && t.style !== 'gaze' && !reduced()) {
    const q = 1 - t.left / SIG;
    const n = t.style === 'heavy' ? 5 : 3;
    for (let i = 0; i < n; i++) {
      const aa = a0 + t.arc * ((i + 0.5) / n + (hash(seed, i, 84) - 0.5) * 0.18);
      const rr = t.R * (0.72 + 0.14 * hash(seed, i, 85));
      const ck = crackOf(
        `hair|${i}|${seed % 1013}`,
        seed + i,
        [
          [aa + Math.PI + 0.4, 4 + 3 * hash(seed, i, 86), 1],
          [aa + 0.3, 3 + 3 * hash(seed, i, 87), 1],
        ],
        0.7,
        0,
      );
      p.col(C.hot, 0.9);
      drawCrack(p, ck, t.cx + Math.cos(aa) * rr, t.cy + Math.sin(aa) * rr - LIFT, ck.max * q);
    }
  }
}

function laneFloor(p: Pen, t: Tele, time: number): void {
  const pal = PAL_CUT;
  const ux = Math.cos(t.ang);
  const uy = Math.sin(t.ang);
  const s0 = 4;
  const L = Math.max(s0 + 2, t.R);
  const sig = t.left < SIG;
  const tk = !reduced() && tick(t.left);
  p.col(pal.dk, 0.3 + 0.1 * t.k);
  laneRows(t.cx, t.cy, ux, uy, s0, L, t.hw, (Y, xa, xb) => p.row(Y, xa, xb));
  const sf = s0 + (L - s0) * (0.05 + 0.95 * Math.pow(t.k, 1.5));
  p.col(sig ? pal.hot : pal.mid, (tk ? 0.5 : 0.26) + 0.14 * t.k);
  laneRows(t.cx, t.cy, ux, uy, s0, sf, t.hw, (Y, xa, xb) => p.row(Y, xa, xb));
  // Шевроны бегут к концу — куда рванёт.
  const nx = -uy;
  const ny = ux;
  const step = 10;
  const run = mod(time * (26 + 90 * t.k), step);
  const w = Math.max(2, t.hw - 2);
  p.col(pal.sheen, 0.3 + 0.25 * t.k);
  for (let s = s0 + run; s < L - 3; s += step) {
    const x = t.cx + ux * s;
    const y = t.cy + uy * s;
    p.line(x - ux * 3 + nx * w * 0.6, y - uy * 3 + ny * w * 0.6, x, y);
    p.line(x - ux * 3 - nx * w * 0.6, y - uy * 3 - ny * w * 0.6, x, y);
  }
  // Конец пути — поперечная черта: здесь он встанет.
  p.col(pal.mid, 0.55 + 0.3 * t.k);
  laneRows(t.cx, t.cy, ux, uy, L - 2, L, t.hw + 1, (Y, xa, xb) => p.row(Y, xa, xb));
}

function laneLit(p: Pen, t: Tele, time: number): void {
  const pal = PAL_CUT;
  const ux = Math.cos(t.ang);
  const uy = Math.sin(t.ang);
  const nx = -uy;
  const ny = ux;
  const s0 = 4;
  const L = Math.max(s0 + 2, t.R);
  const sig = t.left < SIG;
  const tk = !reduced() && tick(t.left);
  const run = time * (24 + 80 * t.k);
  const col = sig ? (tk ? C.white : pal.hot) : pal.rim;
  for (const sd of [1, -1]) {
    const x0 = t.cx + ux * s0 + nx * t.hw * sd;
    const y0 = t.cy + uy * s0 + ny * t.hw * sd;
    const x1 = t.cx + ux * L + nx * t.hw * sd;
    const y1 = t.cy + uy * L + ny * t.hw * sd;
    p.col(col, 0.5 + 0.4 * t.k);
    if (sig) p.line(x0, y0, x1, y1);
    else p.dash(x0, y0, x1, y1, 4, 3, run);
  }
  // Фронт — поперечная черта света.
  const sf = s0 + (L - s0) * (0.05 + 0.95 * Math.pow(t.k, 1.5));
  p.col(sig ? C.white : pal.front, 0.75 + 0.25 * t.k);
  p.line(
    t.cx + ux * sf + nx * (t.hw - 1),
    t.cy + uy * sf + ny * (t.hw - 1),
    t.cx + ux * sf - nx * (t.hw - 1),
    t.cy + uy * sf - ny * (t.hw - 1),
  );
  // Конец пути — блёстка, к удару крупнее.
  const im = glintImg(sig ? 3 : 1 + Math.round(t.k), 1);
  p.col('#000', 0.6 + 0.4 * t.k);
  p.img(im, t.cx + ux * L - im.width / 2, t.cy + uy * L - im.height / 2);
  // Последние 0,2 с: ось полосы — белая нить.
  if (sig) {
    p.col(C.white, 0.35 + 0.4 * (1 - t.left / SIG));
    p.line(t.cx + ux * s0, t.cy + uy * s0, t.cx + ux * sf, t.cy + uy * sf);
  }
}

registerZonePainter(
  'f7_fxtele',
  guarded((g, z0: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const z = z0 as FxZone;
    const t = teleOf(z, S, false);
    if (!t) return;
    const p = penAt(g, z, px, py, S, t);
    if (t.shape === 'line') laneFloor(p, t, time);
    else coneFloor(p, t, time);
  }),
);

registerZonePainter(
  'f7_fxtele_lit',
  guarded((g, z0: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const z = z0 as FxZone;
    const t = teleOf(z, S, true);
    if (!t) return;
    const p = penAt(g, z, px, py, S, t);
    if (t.shape === 'line') laneLit(p, t, time);
    else coneLit(p, t, time);
  }),
);

// =============================================================================
// ВЗМАХ (серия из трёх, ответ из стойки). Контакт: серп света растёт по ходу
// клинка и тает с хвоста; воздух трескается звездой в точке удара и
// осыпается; осколки летят наружу и по ходу взмаха, падают и лежат; на
// зеркальном полу — отсвет вспышки. Третий взмах и ответ — крупнее.
// =============================================================================

/** Куда идёт клинок: 1 — угол растёт (по часовой на экране), −1 — назад. */
const SWEEP = [1, -1, 1, -1];

interface Cut {
  cx: number;
  cy: number;
  ang: number;
  R: number;
  arc: number;
  k: number;
  sd: number;
}
const cutOf = (fx: Fx): Cut => ({
  cx: fx.cx,
  cy: fx.cy,
  ang: fx.z.vA ?? 0,
  R: (fx.z.vR ?? 2) * fx.S,
  arc: fx.z.vArc ?? 1.95,
  k: Math.min(3, Math.max(0, Math.round(fx.z.vK ?? 0))),
  sd: fx.sd,
});

/**
 * Серп света по дуге: дуга режется на дольки, каждая родилась, когда через
 * неё прошёл клинок (`born` — время прохода всей дуги, он кончается в миг
 * урона: в кадре контакта серп уже целый, свежий у острия и старше к
 * хвосту), живёт `life` с, белая → стекло, тоньше к концам и к старости;
 * слегка расходится наружу.
 */
function crescent(
  p: Pen,
  cx: number,
  cy: number,
  ang: number,
  arc: number,
  R: number,
  dir: number,
  age: number,
  born: number,
  life: number,
  thick: number,
  slices: number,
  vio = false,
  amul = 1,
): void {
  const a0 = ang - arc / 2;
  for (let i = 0; i < slices; i++) {
    const u = (i + 0.5) / slices;
    const a = age + born * (1 - u);
    if (a < 0 || a >= life) continue;
    const q = a / life;
    const s0 = dir > 0 ? a0 + (arc * i) / slices : a0 + arc - (arc * (i + 1)) / slices;
    const s1 = s0 + arc / slices + 0.002;
    const outer = R * (0.95 + 0.1 * eOut2(q));
    // Толще всего сразу за клинком, к хвосту и к концам дуги — тоньше.
    const th = Math.max(1, (thick * (1 - q * 0.8) + 0.5) * Math.pow(Math.sin(Math.PI * u), 0.4));
    const al = (1 - q * 0.75) * amul;
    // Тело серпа — стекло, кромка — раскалённая нить.
    if (th > 1.5) {
      p.col(q < 0.3 ? C.hot : vio ? C.v2 : q < 0.6 ? C.cyan : C.g2, al * 0.85);
      fillSector(p, cx, cy, outer - th, outer - 1, s0, s1);
    }
    p.col(q < 0.45 ? C.white : vio ? C.v3 : C.hot, al);
    fillSector(p, cx, cy, outer - 1, outer, s0, s1);
  }
}

function cutShards(c: Cut): ShardSpec {
  const big = c.k === 2 || c.k === 3;
  const dir = SWEEP[c.k];
  return {
    seed: c.sd,
    n: big ? 12 : 7,
    x: c.cx + Math.cos(c.ang) * c.R * 0.75,
    y: c.cy + Math.sin(c.ang) * c.R * 0.75,
    z0: LIFT,
    ang: c.ang + dir * 0.45,
    spread: c.arc * 0.45,
    v0: 30,
    dv: big ? 60 : 45,
    vz0: 25,
    dvz: 45,
    big: big ? 0.45 : 0.25,
    pal: 0,
    fade: [0.75, 1.2],
  };
}

function cutLit(fx: Fx): void {
  const c = cutOf(fx);
  const { p, age, time } = fx;
  const dir = SWEEP[c.k];
  const big = c.k === 2 || c.k === 3;
  crescent(
    p,
    c.cx,
    c.cy - LIFT,
    c.ang,
    c.arc,
    c.R,
    dir,
    age,
    big ? 0.07 : 0.05,
    0.15,
    big ? 7 : 5,
    big ? 14 : 10,
  );
  // Трещина в воздухе у середины дуги.
  const hx0 = c.cx + Math.cos(c.ang) * c.R * 0.72;
  const hy0 = c.cy + Math.sin(c.ang) * c.R * 0.72 - LIFT;
  const ck = crackOf(
    `cut|${c.k}|${c.sd % 509}`,
    c.sd,
    starBranches(c.sd, big ? 7 : 5, c.ang + dir * 0.6, 4, big ? 13 : 9, 2),
    0.55,
    0.3,
  );
  airCrack(p, ck, hx0, hy0, age + 0.025, 0.05, big ? 0.24 : 0.18, c.sd);
  // Кадр контакта: искра и кольцо звона в точке удара.
  impactStar(p, hx0, hy0, age, 0.09, big ? 9 : 7, c.ang);
  if (age < 0.16) {
    const q = age / 0.16;
    p.col(q < 0.4 ? C.white : C.cyan, 0.9 * (1 - q));
    ring(p, hx0, hy0, 3 + (big ? 11 : 8) * eOut2(q), (_a, i) => hash(i >> 1, c.sd, 3) > 0.25);
  }
  glints(
    p,
    c.sd,
    age,
    big ? 8 : 5,
    (i) => {
      const aa = c.ang - c.arc / 2 + c.arc * hash(c.sd, i, 62);
      const rr = c.R * (0.7 + 0.3 * hash(c.sd, i, 63));
      return [c.cx + Math.cos(aa) * rr, c.cy + Math.sin(aa) * rr - LIFT];
    },
    0.02,
    0.12,
    0.14,
    2,
    0,
  );
  shards(p, cutShards(c), age, time, 'air');
}

function cutFloor(fx: Fx): void {
  const c = cutOf(fx);
  const { p, age, time } = fx;
  // Зеркальный пол отражает серп: тот же серп, тусклый, у самого пола.
  const big = c.k === 2 || c.k === 3;
  p.g.save();
  p.g.globalCompositeOperation = 'lighter';
  crescent(
    p,
    c.cx,
    c.cy + 2,
    c.ang,
    c.arc,
    c.R * 0.94,
    SWEEP[c.k],
    age,
    big ? 0.07 : 0.05,
    0.13,
    big ? 3 : 2,
    big ? 14 : 10,
    false,
    0.28,
  );
  p.g.restore();
  p.reset();
  shards(p, cutShards(c), age, time, 'ground');
}

registerZonePainter('f7_fxcut', fxZone(cutFloor));
registerZonePainter('f7_fxcut_lit', fxZone(cutLit));

// =============================================================================
// ТЯЖЁЛЫЙ — конус r 2,7, дуга 3,8 (почти круг перед собой). Контакт: клинок
// входит в пол в клетке перед Отражением — вспышка, зеркальный пол
// раскалывается звездой (жёлоб тёмный, кромка светлая), ударная волна,
// серп по всей дуге, большая трещина воздуха, дождь осколков, стеклянная
// пыль. Самый тяжёлый удар — тряска 0,42 и вспышка.
// =============================================================================

interface Heavy {
  cx: number;
  cy: number;
  ang: number;
  R: number;
  arc: number;
  bx: number;
  by: number;
  sd: number;
}
const heavyOf = (fx: Fx): Heavy => {
  const ang = fx.z.vA ?? 0;
  return {
    cx: fx.cx,
    cy: fx.cy,
    ang,
    R: (fx.z.vR ?? 2.7) * fx.S,
    arc: fx.z.vArc ?? 3.8,
    bx: fx.cx + Math.cos(ang) * fx.S * 1.05,
    by: fx.cy + Math.sin(ang) * fx.S * 1.05,
    sd: fx.sd,
  };
};
const heavyShards = (h: Heavy): ShardSpec => ({
  seed: h.sd,
  n: 22,
  x: h.bx,
  y: h.by,
  z0: 3,
  ang: h.ang,
  spread: 1.9,
  v0: 40,
  dv: 80,
  vz0: 60,
  dvz: 90,
  big: 0.5,
  pal: 0,
  fade: [1.25, 1.8],
});

function heavyLit(fx: Fx): void {
  const h = heavyOf(fx);
  const { p, age, time } = fx;
  crescent(p, h.cx, h.cy - LIFT, h.ang, h.arc, h.R, 1, age, 0.08, 0.18, 8, 18);
  // Кадр контакта: звезда удара в точке, где клинок вошёл в пол.
  impactStar(p, h.bx, h.by - 3, age, 0.13, 15, h.ang);
  if (age < 0.12) {
    p.col(C.white, 0.9 * (1 - age / 0.12));
    ring(p, h.bx, h.by - 2, 6 + 8 * (age / 0.12));
  }
  // Ударная волна — рваное кольцо от точки удара.
  if (age < 0.36) {
    const q = age / 0.36;
    const r = 6 + 46 * eOut2(q);
    p.col(C.white, 0.9 * (1 - q));
    ring(p, h.bx, h.by, r, (_a, i) => hash(i >> 2, h.sd, 9) > 0.25);
    p.col(C.cyan, 0.6 * (1 - q));
    ring(p, h.bx, h.by, r - 2, (_a, i) => hash(i >> 2, h.sd, 10) > 0.45);
  }
  const ck = crackOf(
    `hvy|${h.sd % 1021}`,
    h.sd,
    starBranches(h.sd, 8, h.ang + 0.3, 7, 17, 2),
    0.5,
    0.35,
  );
  airCrack(p, ck, h.bx, h.by - LIFT + 2, age + 0.025, 0.06, 0.3, h.sd);
  glints(
    p,
    h.sd,
    age,
    reduced() ? 5 : 12,
    (i) => {
      const aa = h.ang - h.arc / 2 + h.arc * hash(h.sd, i, 64);
      const rr = h.R * (0.35 + 0.65 * hash(h.sd, i, 65));
      return [h.cx + Math.cos(aa) * rr, h.cy + Math.sin(aa) * rr - 4];
    },
    0.03,
    0.3,
    0.16,
    3,
    0,
  );
  shards(p, heavyShards(h), age, time, 'air');
}

function heavyFloor(fx: Fx): void {
  const h = heavyOf(fx);
  const { p, age, time } = fx;
  const fade = 1 - k01((age - 1.2) / 0.55);
  floorFlash(p, h.bx, h.by, age, 0.3, 30);
  // Раскол зеркального пола: жёлоб тёмный, кромка — светлый пиксель снизу-справа.
  const ck = crackOf(
    `hfl|${h.sd % 1031}`,
    h.sd + 5,
    starBranches(h.sd + 5, 7, h.ang, 14, 32, 2),
    0.45,
    0.3,
  );
  const reach = ck.max * eOut3(k01(age / 0.12));
  p.col(C.g2, 0.55 * fade);
  drawCrack(p, ck, h.bx + 1, h.by + 1, reach);
  p.col(C.deep, 0.95 * fade);
  drawCrack(p, ck, h.bx, h.by, reach);
  // Выбоина у точки удара.
  p.col(C.deep, 0.9 * fade);
  fillSector(p, h.bx, h.by, 0, 2.6, 0, TAU);
  dust(p, h.sd, age, h.bx, h.by, 8, h.ang, 1.6, 26, 34, 2, 6, 7, 0.9, 0.55);
  shards(p, heavyShards(h), age, time, 'ground');
}

registerZonePainter('f7_fxheavy', fxZone(heavyFloor));
registerZonePainter('f7_fxheavy_lit', fxZone(heavyLit));

// =============================================================================
// ВЫПАД (рывок и бег сквозь зал): толчок со стеклянной пылью и царапинами,
// искры за спиной на ходу, попадание — звезда и трещина воздуха вытянутая
// по ходу, осколки веером вперёд. Удар о стену — трещина и осколки назад.
// =============================================================================

function kickFloor(fx: Fx): void {
  const { p, age, cx, cy, sd, z } = fx;
  const a = z.vA ?? 0;
  const big = (z.vK ?? 0) > 0;
  const back = a + Math.PI;
  // Царапины на полу позади: оттолкнулся.
  const q = 1 - k01((age - 0.35) / 0.5);
  if (q > 0) {
    const nx = -Math.sin(a);
    const ny = Math.cos(a);
    for (const s of [-1, 1]) {
      p.col(C.g2, 0.5 * q);
      p.line(
        cx + nx * 3 * s,
        cy + ny * 3 * s,
        cx + Math.cos(back) * (big ? 12 : 9) + nx * 3.5 * s,
        cy + Math.sin(back) * (big ? 12 : 9) + ny * 3.5 * s,
      );
    }
  }
  specks(p, sd, age, cx, cy, big ? 16 : 11, back, 0.9, 34, 50, 0.5, 26);
}
function kickLit(fx: Fx): void {
  const { p, age, cx, cy, sd, z } = fx;
  const a = z.vA ?? 0;
  if (age < 0.22) {
    const q = age / 0.22;
    p.col(C.hot, 0.8 * (1 - q));
    ring(p, cx, cy - 2, 4 + 10 * eOut2(q), (_x, i) => hash(i >> 1, sd, 5) > 0.3);
  }
  glints(
    p,
    sd,
    age,
    5,
    (i) => {
      const aa = a + Math.PI + (hash(sd, i, 66) - 0.5) * 2;
      const rr = 3 + 9 * hash(sd, i, 67);
      return [cx + Math.cos(aa) * rr, cy + Math.sin(aa) * rr - 3 - 4 * hash(sd, i, 68)];
    },
    0,
    0.1,
    0.14,
    2,
    0,
  );
}
registerZonePainter('f7_fxkick', fxZone(kickFloor));
registerZonePainter('f7_fxkick_lit', fxZone(kickLit));

/** Искры на ходу: светлые черты за спиной ложатся на зеркальный пол и гаснут. */
registerZonePainter(
  'f7_fxstreak',
  fxZone(({ p, age, cx, cy, sd, z }) => {
    const a = z.vA ?? 0;
    const q = age / 0.35;
    if (q >= 1) return;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const nx = -uy;
    const ny = ux;
    const big = (z.vK ?? 0) > 0;
    for (let i = 0; i < 3; i++) {
      const off = (hash(sd, i, 91) - 0.5) * 12;
      const len = (big ? 14 : 9) * (0.6 + 0.4 * hash(sd, i, 92)) * (1 - q * 0.5);
      const x = cx + nx * off;
      const y = cy + ny * off - 2 - 8 * hash(sd, i, 93);
      p.col(i === 0 ? C.hot : C.g2, 0.7 * (1 - q));
      p.line(x - ux * 2, y - uy * 2, x - ux * len, y - uy * len);
    }
    if (q < 0.4) {
      const im = glintImg(1, 0);
      p.col('#000', 1 - q);
      p.img(im, cx - ux * 6 - 1, cy - uy * 6 - 6);
    }
  }),
);

function pierceShards(fx: Fx): ShardSpec {
  const big = (fx.z.vK ?? 0) > 0;
  return {
    seed: fx.sd,
    n: big ? 12 : 9,
    x: fx.cx,
    y: fx.cy,
    z0: 8,
    ang: fx.z.vA ?? 0,
    spread: 0.8,
    v0: 50,
    dv: big ? 90 : 70,
    vz0: 20,
    dvz: 50,
    big: 0.35,
    pal: 0,
    fade: [0.7, 1.1],
  };
}
registerZonePainter(
  'f7_fxpierce',
  fxZone((fx) => shards(fx.p, pierceShards(fx), fx.age, fx.time, 'ground')),
);
registerZonePainter(
  'f7_fxpierce_lit',
  fxZone((fx) => {
    const { p, age, cx, cy, sd, z } = fx;
    const a = z.vA ?? 0;
    const big = (z.vK ?? 0) > 0;
    const y = cy - 8;
    impactStar(p, cx, y, age, 0.1, big ? 12 : 10, a);
    // Трещина вытянута по ходу выпада: длинная вперёд, короткие вбок и назад.
    const ck = crackOf(`prc|${+big}|${sd % 503}`, sd, [
      [a + (hash(sd, 1, 1) - 0.5) * 0.3, big ? 16 : 13, 2],
      [a + 0.9, 6 + 3 * hash(sd, 2, 1), 1],
      [a - 0.9, 6 + 3 * hash(sd, 3, 1), 1],
      [a + Math.PI + 0.3, 5, 1],
      [a + Math.PI - 0.5, 4, 1],
    ]);
    airCrack(p, ck, cx, y, age + 0.02, 0.04, 0.2, sd);
    if (age < 0.2) {
      const q = age / 0.2;
      p.col(C.white, 0.8 * (1 - q));
      ring(p, cx, y + 4, 3 + 9 * eOut2(q), (_x, i) => hash(i >> 1, sd, 6) > 0.3);
    }
    shards(p, pierceShards(fx), age, fx.time, 'air');
  }),
);

function wallShards(fx: Fx): ShardSpec {
  const a = fx.z.vA ?? 0;
  return {
    seed: fx.sd,
    n: 10,
    x: fx.cx + Math.cos(a) * 7,
    y: fx.cy + Math.sin(a) * 7,
    z0: 8,
    ang: a + Math.PI,
    spread: 1.1,
    v0: 30,
    dv: 60,
    vz0: 30,
    dvz: 50,
    big: 0.4,
    pal: 1,
    fade: [0.6, 1.0],
  };
}
registerZonePainter(
  'f7_fxwall',
  fxZone((fx) => {
    const a = fx.z.vA ?? 0;
    dust(fx.p, fx.sd, fx.age, fx.cx + Math.cos(a) * 7, fx.cy + Math.sin(a) * 7, 6, a + Math.PI, 1.1, 20, 20, 2, 6, 5, 0.8, 0.7);
    shards(fx.p, wallShards(fx), fx.age, fx.time, 'ground');
  }),
);
registerZonePainter(
  'f7_fxwall_lit',
  fxZone((fx) => {
    const { p, age, cx, cy, sd, z } = fx;
    const a = z.vA ?? 0;
    const x = cx + Math.cos(a) * 8;
    const y = cy + Math.sin(a) * 8 - 7;
    impactStar(p, x, y, age, 0.1, 10, a + Math.PI);
    const ck = crackOf(
      `wal|${sd % 509}`,
      sd,
      starBranches(sd, 6, a + Math.PI, 4, 11, 2),
      0.55,
      0.25,
    );
    airCrack(p, ck, x, y, age + 0.02, 0.04, 0.2, sd);
    shards(p, wallShards(fx), age, fx.time, 'air');
  }),
);

// =============================================================================
// СТОЙКА — удар героя в зеркальную стойку отражён: вспышка в точке сшибки,
// плоскость зеркала (черта поперёк удара) горит и гаснет, искры летят
// обратно в героя — удар «вернулся».
// =============================================================================

registerZonePainter(
  'f7_fxparry',
  fxZone(({ p, age, cx, cy }) => floorFlash(p, cx, cy, age, 0.22, 14)),
);
registerZonePainter(
  'f7_fxparry_lit',
  fxZone(({ p, age, cx, cy, sd, z }) => {
    const a = z.vA ?? 0;
    const y = cy - 10;
    const nx = -Math.sin(a);
    const ny = Math.cos(a);
    // Плоскость зеркала поперёк удара.
    if (age < 0.3) {
      const q = age / 0.3;
      const L = 8 * (1 - q * 0.4);
      p.col(q < 0.3 ? C.white : C.cyan, 1 - q);
      p.line(cx - nx * L, y - ny * L, cx + nx * L, y + ny * L);
    }
    impactStar(p, cx, y, age, 0.1, 10, a + 0.4);
    if (age < 0.22) {
      const q = age / 0.22;
      p.col(C.hot, 0.8 * (1 - q));
      ring(p, cx, y, 3 + 10 * eOut2(q));
    }
    // Искры обратно в героя: с сопротивлением и тяжестью, белые → лиловые.
    const n = reduced() ? 5 : 10;
    for (let i = 0; i < n; i++) {
      const L = 0.3 + 0.25 * hash(sd, i, 33);
      if (age >= L) continue;
      const th = a + (hash(sd, i, 31) - 0.5) * 1.6;
      const v = 70 + 70 * hash(sd, i, 32);
      const at = (t: number): [number, number] => {
        const d = (v / 2.5) * (1 - Math.exp(-2.5 * t));
        return [cx + Math.cos(th) * d, y + Math.sin(th) * d * 0.8 + 90 * t * t - 20 * t];
      };
      const [x1, y1] = at(age);
      const [x0, y0] = at(Math.max(0, age - 0.035));
      const k = age / L;
      p.col(k < 0.3 ? C.white : k < 0.65 ? C.cyan : C.v2, 1 - k * 0.5);
      p.line(x0, y0, x1, y1);
    }
  }),
);

// =============================================================================
// ВЗГЛЯД — узкий конус r 6. Метка лиловая, искры бьют из глаз наружу.
// Контакт: волна света бежит по конусу (фронт и три кольца за ним), лиловые
// блёстки оседают на пол. Заливку пола рисует `f7_gazeflash`.
// =============================================================================

registerZonePainter(
  'f7_gazeflash',
  guarded((g, z0: Zone | Strike, px: number, py: number, S: number) => {
    const z = z0 as FxZone;
    const life = (z as Zone).life || 0.35;
    const q = k01(z.t / life);
    const cx = z.x * S;
    const cy = z.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const a = z.ang ?? 0;
    const R = (z.r ?? 6) * S;
    const arc = 0.9;
    // Свет заливает конус от глаз к краю за первые 0,1 с и гаснет.
    const rf = R * eOut2(k01(z.t / 0.1));
    p.col(PAL_GAZE.mid, 0.32 * (1 - q));
    fillSector(p, cx, cy, 4, rf, a - arc / 2, a + arc / 2);
    p.col(PAL_GAZE.sheen, 0.2 * (1 - q));
    fillSector(p, cx, cy, 4, rf * 0.55, a - arc / 3, a + arc / 3);
  }),
);
registerZonePainter(
  'f7_fxgaze',
  fxZone(({ p, age, cx, cy, sd, z }) => {
    const a = z.vA ?? 0;
    const R = (z.vR ?? 6) * 16;
    const arc = z.vArc ?? 0.9;
    // Блёстки оседают на пол вдоль конуса.
    glints(
      p,
      sd,
      age,
      reduced() ? 5 : 10,
      (i) => {
        const aa = a + (hash(sd, i, 94) - 0.5) * arc;
        const rr = R * (0.2 + 0.8 * hash(sd, i, 95));
        return [cx + Math.cos(aa) * rr, cy + Math.sin(aa) * rr];
      },
      0.1,
      0.35,
      0.22,
      1,
      2,
    );
  }),
);
registerZonePainter(
  'f7_fxgaze_lit',
  fxZone(({ p, age, cx, cy, z }) => {
    const a = z.vA ?? 0;
    const R = (z.vR ?? 6) * 16;
    const arc = z.vArc ?? 0.9;
    const a0 = a - arc / 2;
    const inside = (x: number) => inArc(x, a0, arc);
    // Фронт волны и три кольца за ним — гипнотическая рябь.
    for (let j = 0; j < 4; j++) {
      const t = age - j * 0.05;
      if (t < 0 || t > 0.3) continue;
      const q = t / 0.3;
      const r = 5 + (R - 5) * eOut2(k01(t / 0.16));
      p.col(j === 0 ? C.white : C.v3, (j === 0 ? 1 : 0.6) * (1 - q));
      ring(p, cx, cy, r, inside);
    }
    impactStar(p, cx + Math.cos(a) * 5, cy + Math.sin(a) * 5 - 15, age, 0.1, 8, a, true);
    // Взгляд попал — над героем кружат лиловые осколки-зеркальца, пока он
    // очарован (джойстик наоборот): видно, ПОЧЕМУ ноги идут не туда.
    const h = paintSim()?.hero;
    const ch = h?.status?.charm?.t ?? 0;
    if (h && ch > 0 && age > 0.05) {
      const hx0 = h.x * 16;
      const hy0 = h.y * 16 - 22;
      const fade = Math.min(1, ch / 0.25);
      const n = 3;
      for (let i = 0; i < n; i++) {
        const an = age * 5.5 + (i / n) * TAU;
        const x = hx0 + Math.cos(an) * 7;
        const y = hy0 + Math.sin(an) * 2.5;
        const im = shardImg(2, mod(Math.floor(age * 14) + i * 3, SHARD_FRAMES), 2);
        p.col('#000', fade * (Math.sin(an) > -0.2 ? 1 : 0.55));
        p.img(im, x - im.width / 2, y - im.height / 2);
      }
      // Глаз-знак: миндаль с лиловым зрачком, мигает раз в полсекунды.
      if (Math.floor(age * 4) % 2 === 0 || reduced()) {
        p.col(C.v3, 0.9 * fade);
        p.g.fillRect(Math.floor(hx0) - 2 + p.qx, Math.floor(hy0) - 4 + p.qy, 5, 1);
        p.g.fillRect(Math.floor(hx0) - 2 + p.qx, Math.floor(hy0) - 2 + p.qy, 5, 1);
        p.g.fillRect(Math.floor(hx0) - 3 + p.qx, Math.floor(hy0) - 3 + p.qy, 1, 1);
        p.g.fillRect(Math.floor(hx0) + 3 + p.qx, Math.floor(hy0) - 3 + p.qy, 1, 1);
        p.col(C.v1, fade);
        p.g.fillRect(Math.floor(hx0) + p.qx, Math.floor(hy0) - 3 + p.qy, 1, 1);
      }
    }
  }),
);

// =============================================================================
// ЗЕРКАЛО: уход (нырок, шаг сквозь зеркало) и выход. Уход — пол под ним
// становится зеркальной гладью: рябь сходится внутрь, блёстки втягиваются
// по спирали, в конце щель света схлопывается. Выход — рябь расходится,
// щель света раскрывается «дверью» и выпускает блёстки.
// =============================================================================

function slit(p: Pen, x: number, y: number, h: number, w: number, a: number): void {
  if (w <= 0 || a <= 0) return;
  const hw = Math.max(0, Math.round(w / 2));
  p.col(C.cyan, 0.5 * a);
  p.g.fillRect(Math.floor(x) - hw - 1 + p.qx, Math.floor(y - h) + 2 + p.qy, hw * 2 + 3, Math.max(1, h - 4));
  p.col(C.hot, 0.85 * a);
  p.g.fillRect(Math.floor(x) - hw + p.qx, Math.floor(y - h) + p.qy, hw * 2 + 1, h);
  p.col(C.white, a);
  p.g.fillRect(Math.floor(x) + p.qx, Math.floor(y - h) + 1 + p.qy, 1, Math.max(1, h - 2));
}

registerZonePainter(
  'f7_fxdive',
  fxZone(({ z, p, age, cx, cy }) => {
    if (dup(z)) return;
    const T = (z.vK ?? 0) > 0 ? 0.7 : 0.45;
    // Рябь сходится к ногам.
    for (let j = 0; j < 3; j++) {
      const t = age - j * T * 0.22;
      if (t < 0 || t > T) continue;
      const q = t / T;
      p.col(j === 0 ? C.cyan : C.g2, 0.55 * Math.sin(Math.PI * q));
      ring(p, cx, cy, 24 * (1 - eIn2(q)) + 2);
    }
    // Гладь под ним темнеет — зеркало открылось; схлопывается после ухода.
    const open = age < T ? eOut2(age / T) : 1 - k01((age - T) / 0.18);
    if (open > 0) {
      p.col(C.v0, 0.5 * open);
      fillSector(p, cx, cy, 0, 10 * open, 0, TAU);
      p.col(C.g1, 0.35 * open);
      ring(p, cx, cy, 10 * open);
    }
    // Хлопок глади, когда ушёл.
    if (age >= T && age < T + 0.16) {
      const q = (age - T) / 0.16;
      p.col(C.hot, 0.7 * (1 - q));
      ring(p, cx, cy, 4 + 14 * eOut2(q));
    }
  }),
);
registerZonePainter(
  'f7_fxdive_lit',
  fxZone(({ z, p, age, cx, cy, sd }) => {
    if (dup(z)) return;
    const T = (z.vK ?? 0) > 0 ? 0.7 : 0.45;
    const n = reduced() ? 5 : 10;
    // Блёстки втягиваются по спирали.
    if (age < T)
      for (let i = 0; i < n; i++) {
        const q = age / T;
        const a0 = TAU * hash(sd, i, 51);
        const aa = a0 + q * 4 * (i % 2 ? 1 : -1);
        const rr = (14 + 10 * hash(sd, i, 52)) * (1 - eIn2(q));
        const h = 4 + 20 * hash(sd, i, 53);
        p.col(i % 3 ? C.cyan : C.white, Math.sin(Math.PI * q));
        p.dot(cx + Math.cos(aa) * rr, cy + Math.sin(aa) * rr * 0.6 - h);
      }
    // Щель света схлопывается — ушёл в зеркало.
    if (age >= T - 0.08 && age < T + 0.12) {
      const q = (age - T + 0.08) / 0.2;
      slit(p, cx, cy, Math.round(30 * (1 - q * 0.6)), 4 * (1 - q), 1 - q * 0.5);
    }
  }),
);

registerZonePainter(
  'f7_fxemerge',
  fxZone(({ z, p, age, cx, cy }) => {
    if (dup(z)) return;
    const big = (z.vK ?? 0) > 0;
    for (let j = 0; j < 3; j++) {
      const t = age - j * 0.13;
      const T = big ? 0.95 : 0.7;
      if (t < 0 || t > T) continue;
      const q = t / T;
      p.col(j === 0 ? C.hot : C.g2, 0.6 * (1 - q));
      ring(p, cx, cy, 3 + (big ? 34 : 24) * eOut2(q));
    }
    floorFlash(p, cx, cy, age, 0.35, 18);
    // Щель — дверь зеркала ЗА фигурой: раскрывается шире тела (свет бьёт из-за
    // спины по краям), выпускает и схлопывается. Под мобом — поверх тела
    // она читалась бы белой полосой по фигуре.
    const big2 = (z.vK ?? 0) > 0;
    const H = big2 ? 42 : 34;
    const T = big2 ? 0.8 : 0.55;
    if (age < T) {
      const q = age / T;
      const w = q < 0.3 ? 11 * eOut2(q / 0.3) : 11 * (1 - eIn2((q - 0.3) / 0.7));
      slit(p, cx, cy, Math.round(H * (q < 0.2 ? eOut2(q / 0.2) : 1)), w, 1 - q * 0.3);
    }
  }),
);
registerZonePainter(
  'f7_fxemerge_lit',
  fxZone(({ z, p, age, cx, cy, sd }) => {
    if (dup(z)) return;
    const big = (z.vK ?? 0) > 0;
    const H = big ? 38 : 30;
    glints(
      p,
      sd,
      age,
      reduced() ? 5 : big ? 14 : 9,
      (i) => {
        const aa = TAU * hash(sd, i, 54);
        const tb = 0.08 + 0.4 * hash(sd, i, 61);
        const q = k01((age - tb) / 0.22);
        const rr = 3 + (10 + 10 * hash(sd, i, 55)) * eOut2(q);
        return [cx + Math.cos(aa) * rr, cy + Math.sin(aa) * rr * 0.6 - 6 - H * 0.6 * hash(sd, i, 56)];
      },
      0.08,
      0.4,
      0.22,
      2,
      0,
    );
  }),
);

// =============================================================================
// БЕГ СКВОЗЬ ЗАЛ: за Отражением в воздухе остаётся трещина-разрез — белая
// нить со стеклянным краем, по ней бегут блики; на полу — её отражение.
// Кончился бег — разрез держится миг и осыпается кусками.
// =============================================================================

const runLen = new WeakMap<object, { len: number; done: number }>();
function runOf(z: FxZone, S: number, age: number): { len: number; done: number } {
  if (z.vL !== undefined) {
    // Лист кадров: длина задана, бег — 17 клеток в секунду.
    const len = Math.min(z.vL * S, age * 17 * S);
    return { len, done: len >= z.vL * S ? (z.vL / 17) : -1 };
  }
  let r = runLen.get(z);
  if (!r) {
    r = { len: 0, done: -1 };
    runLen.set(z, r);
  }
  if (r.done < 0) {
    const m = mobOf(z.vm);
    const a = z.vA ?? 0;
    if (m && m.mode === 'mrun' && age < 1.8) {
      r.len = Math.max(r.len, ((m.x - z.x) * Math.cos(a) + (m.y - z.y) * Math.sin(a)) * S);
    } else r.done = age;
  }
  return r;
}

function drawRun(fx: Fx, lit: boolean): void {
  const { z, p, age, cx, cy, sd, S } = fx;
  const r = runOf(z, S, age);
  if (r.len < 2) return;
  const a = z.vA ?? 0;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const hold = 0.2;
  const since = r.done < 0 ? 0 : age - r.done;
  const y0 = lit ? cy - LIFT : cy;
  if (since < hold) {
    if (!lit) {
      // Отражение разреза на зеркальном полу — тусклое.
      p.col(C.g2, 0.28);
      p.line(cx, y0, cx + ux * r.len, y0 + uy * r.len);
      return;
    }
    p.col(C.cyan, 0.55);
    p.line(cx - uy, y0 + ux, cx + ux * r.len - uy, y0 + uy * r.len + ux);
    p.col(C.white, 0.95);
    p.line(cx, y0, cx + ux * r.len, y0 + uy * r.len);
    // Блики бегут по разрезу.
    for (let i = 0; i < 4; i++) {
      const s = mod(age * 260 + i * 53 + (sd % 50), Math.max(8, r.len));
      const im = glintImg(i === 0 ? 2 : 1, 0);
      p.col('#000', 0.9);
      p.img(im, cx + ux * s - im.width / 2, y0 + uy * s - im.height / 2);
    }
    return;
  }
  if (!lit) return;
  // Осыпается: куски по 7 пикселей падают, каждый своим ходом.
  const t = since - hold;
  if (t > 0.55) return;
  const n = Math.min(90, Math.floor(r.len / 7) + 1);
  for (let i = 0; i < n; i++) {
    const tt = Math.max(0, t - hash(sd, i, 74) * 0.12);
    const al = 1 - k01(tt / 0.42);
    if (al <= 0) continue;
    const dy = -12 * tt + 190 * tt * tt;
    const dx = (hash(sd, i, 75) - 0.5) * 18 * tt;
    const s0 = i * 7;
    const s1 = Math.min(r.len, s0 + 5);
    p.col(hash(sd, i, Math.floor(age * 18)) < 0.25 ? C.white : i % 2 ? C.cyan : C.g2, al);
    p.line(cx + ux * s0 + dx, y0 + uy * s0 + dy, cx + ux * s1 + dx, y0 + uy * s1 + dy);
  }
}
registerZonePainter('f7_fxrun', fxZone((fx) => drawRun(fx, false)));
registerZonePainter('f7_fxrun_lit', fxZone((fx) => drawRun(fx, true)));

// =============================================================================
// СЛЕДЫ: стеклянный двойник оставляет на зеркальном полу светлые отпечатки
// — пара пикселей с бликом, гаснет за секунду. У копий такие же.
// =============================================================================

registerZonePainter(
  'f7_fxstep',
  fxZone(({ z, p, age, cx, cy }) => {
    const life = (z as Zone).life || 1.1;
    const q = age / life;
    if (q >= 1) return;
    const a = z.vA ?? 0;
    const side = (z.vS ?? 0) ? 1 : -1;
    const x = cx - Math.sin(a) * 3 * side;
    const y = cy + Math.cos(a) * 3 * side * 0.6 + 1;
    const horiz = Math.abs(Math.cos(a)) > 0.7;
    p.col(C.g2, 0.5 * (1 - q));
    p.dot(x - 1, y, horiz ? 3 : 2, horiz ? 2 : 3);
    p.col(C.hot, 0.7 * (1 - q) * (q < 0.25 ? 1 : 0.4));
    p.dot(x, y);
  }),
);

// =============================================================================
// СМЕНА ФАЗЫ и СМЕРТЬ. Смена фазы — кольцо стекла рвётся от Отражения,
// пол трескается (к третьей — сильнее, с багровым светом). Смерть — белая
// вспышка и лучи, воздух раскалывается большой звездой, ливень осколков с
// отскоками, пол в трещинах, осколки лежат и поблёскивают три секунды.
// =============================================================================

registerZonePainter(
  'f7_fxphase',
  fxZone(({ z, p, age, cx, cy, sd }) => {
    const ph = Math.round(z.vP ?? 1);
    const fade = 1 - k01((age - 1.5) / 0.7);
    const ck = crackOf(
      `phf|${ph}|${sd % 1009}`,
      sd + ph,
      starBranches(sd + ph, 5 + ph * 2, 0.4, 12 + ph * 4, 26 + ph * 8, 2),
      0.5,
      0.3,
    );
    const reach = ck.max * eOut3(k01(age / 0.25));
    p.col(C.g2, 0.5 * fade);
    drawCrack(p, ck, cx + 1, cy + 1, reach);
    p.col(C.deep, 0.95 * fade);
    drawCrack(p, ck, cx, cy, reach);
  }),
);
registerZonePainter(
  'f7_fxphase_lit',
  fxZone(({ z, p, age, cx, cy, sd }) => {
    const ph = Math.round(z.vP ?? 1);
    const tint = ph === 2 ? C.v3 : ph === 3 ? PAL_CUT.hot : C.cyan;
    if (age < 0.7) {
      const q = age / 0.7;
      const r = 8 + 64 * eOut2(q);
      p.col(C.white, 0.9 * (1 - q));
      ring(p, cx, cy - 4, r, (_a, i) => hash(i >> 3, sd, 12) > 0.3);
      p.col(tint, 0.7 * (1 - q));
      ring(p, cx, cy - 4, r - 3, (_a, i) => hash(i >> 3, sd, 13) > 0.45);
    }
    impactStar(p, cx, cy - 16, age, 0.16, 16, 0.3, ph === 2);
    const ck = crackOf(
      `phl|${ph}|${sd % 1019}`,
      sd + 11 * ph,
      starBranches(sd + 11 * ph, 6 + ph, 0.2, 8, 14 + ph * 3, 2),
      0.55,
      0.3,
    );
    airCrack(p, ck, cx, cy - 16, age, 0.07, 0.35, sd, ph === 2);
  }),
);

function deathShards(fx: Fx): ShardSpec {
  return {
    seed: fx.sd,
    n: 34,
    x: fx.cx,
    y: fx.cy,
    z0: 14,
    ang: 0,
    spread: Math.PI,
    v0: 25,
    dv: 95,
    vz0: 50,
    dvz: 120,
    big: 0.5,
    pal: 0,
    fade: [2.4, 3.2],
  };
}
registerZonePainter(
  'f7_fxdeath',
  fxZone((fx) => {
    const { p, age, cx, cy, sd, time } = fx;
    const fade = 1 - k01((age - 2.3) / 0.9);
    floorFlash(p, cx, cy, age, 0.45, 44);
    const ck = crackOf(`dfl|${sd % 1033}`, sd + 3, starBranches(sd + 3, 9, 0.2, 18, 40, 2), 0.45, 0.35);
    const reach = ck.max * eOut3(k01(age / 0.2));
    p.col(C.g2, 0.55 * fade);
    drawCrack(p, ck, cx + 1, cy + 1, reach);
    p.col(C.deep, 0.95 * fade);
    drawCrack(p, ck, cx, cy, reach);
    dust(p, sd, age, cx, cy, 12, 0, Math.PI, 20, 40, 2, 7, 9, 1.2, 0.55);
    shards(p, deathShards(fx), age, time, 'ground');
  }),
);
registerZonePainter(
  'f7_fxdeath_lit',
  fxZone((fx) => {
    const { p, age, cx, cy, sd, time } = fx;
    const y = cy - 14;
    // Лучи из сердцевины — медленно поворачиваются и гаснут.
    if (age < 0.6 && !reduced()) {
      const q = age / 0.6;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU + 0.2 + q * 0.5;
        const r0 = 6 + 10 * q;
        const r1 = r0 + 16 + 20 * eOut2(q);
        p.col(i % 2 ? C.cyan : C.white, 0.75 * (1 - q));
        p.line(cx + Math.cos(a) * r0, y + Math.sin(a) * r0, cx + Math.cos(a) * r1, y + Math.sin(a) * r1);
      }
    }
    if (age < 0.16) {
      const q = age / 0.16;
      p.col(C.white, 1 - q * 0.5);
      fillSector(p, cx, y, 0, 7 - 4 * q, 0, TAU);
    }
    impactStar(p, cx, y, age, 0.2, 22, 0.15);
    const ck = crackOf(`dai|${sd % 1039}`, sd, starBranches(sd, 10, 0.1, 10, 24, 2), 0.5, 0.35);
    airCrack(p, ck, cx, y, age + 0.03, 0.08, 0.38, sd);
    glints(
      p,
      sd,
      age,
      reduced() ? 8 : 20,
      (i) => {
        const aa = TAU * hash(sd, i, 57);
        const rr = 6 + 34 * hash(sd, i, 58);
        return [cx + Math.cos(aa) * rr, cy + Math.sin(aa) * rr * 0.8 - 20 * hash(sd, i, 59)];
      },
      0.05,
      0.9,
      0.2,
      2,
      0,
    );
    shards(p, deathShards(fx), age, time, 'air');
  }),
);

// =============================================================================
// ОСКОЛКИ КОПИИ — удар по кругу r 1,25, метка 0,4 с. Метка: круг «куда»,
// налив «когда», осколки кружат всё быстрее и сжимаются к середине — вот-вот
// лопнет. Контакт: звезда, кольцо, осколки разлетаются, падают и лежат.
// Зерно — от места: полёт (свет) и лежащие (пол) — одни и те же осколки.
// =============================================================================

const burstShards = (x: number, y: number, S: number, sd: number): ShardSpec => ({
  seed: sd,
  n: 16,
  x: x * S,
  y: y * S,
  z0: 10,
  ang: 0,
  spread: Math.PI,
  v0: 55,
  dv: 70,
  vz0: 40,
  dvz: 45,
  big: 0.35,
  pal: 0,
  fade: [2.2, 3],
});

registerZonePainter(
  'f7_copyburst',
  guarded((g, z0: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const st = z0 as Strike;
    const k = k01(st.t / Math.max(0.01, st.warn));
    const left = st.warn - st.t;
    const cx = st.x * S;
    const cy = st.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = st.r * S;
    const sig = left < SIG;
    const tk = !reduced() && tick(left);
    p.col(PAL_CUT.dk, 0.26 + 0.1 * k);
    fillSector(p, cx, cy, 0, R, 0, TAU);
    const rf = R * (0.1 + 0.9 * Math.pow(k, 1.3));
    p.col(sig ? PAL_CUT.hot : PAL_CUT.mid, (tk ? 0.55 : 0.3) + 0.14 * k);
    fillSector(p, cx, cy, 0, rf, 0, TAU);
    p.col(sig ? (tk ? C.white : PAL_CUT.hot) : PAL_CUT.rim, 0.6 + 0.35 * k);
    ring(p, cx, cy, R, sig ? undefined : (a) => mod(a * R + time * 60, 7) < 4.5);
    // Осколки кружат, всё быстрее, и сжимаются — вот-вот лопнет.
    const sd = seedOf(st.x, st.y);
    const n = reduced() ? 5 : 8;
    for (let i = 0; i < n; i++) {
      const w = 5 + 26 * k * k;
      const a = (i / n) * TAU + time * w * 0.3 + hash(sd, i, 1);
      const rr = R * (1.02 - 0.2 * k) * (0.85 + 0.3 * hash(sd, i, 2));
      const h = 7 + 3 * Math.sin(time * 9 + i) - 3 * k;
      const im = shardImg(3, mod(Math.floor(time * w) + i, SHARD_FRAMES), 0);
      p.col(C.shadow, 0.3);
      p.dot(cx + Math.cos(a) * rr - 1, cy + Math.sin(a) * rr * 0.7, 3, 1);
      p.col('#000', 0.9);
      p.img(im, cx + Math.cos(a) * rr - im.width / 2, cy + Math.sin(a) * rr * 0.7 - h - im.height / 2);
    }
  }),
);

registerImpactPainter('f7_copyburst', {
  life: 0.9,
  shake: 0.22,
  above: true,
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number, time: number) => {
    const cx = rec.x * S;
    const cy = rec.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const sd = seedOf(rec.x, rec.y);
    if (age < 0.12) {
      const q = age / 0.12;
      impactStar(p, cx, cy - 10, age, 0.12, 12, 0.4);
      p.col(C.white, 0.9 * (1 - q));
      fillSector(p, cx, cy - 10, 0, 5 * (1 - q) + 1, 0, TAU);
    }
    if (age < 0.28) {
      const q = age / 0.28;
      p.col(C.white, 0.85 * (1 - q));
      ring(p, cx, cy, 5 + (rec.r ?? 1.25) * S * 1.2 * eOut2(q), (_a, i) => hash(i >> 2, sd, 9) > 0.3);
    }
    const ck = crackOf(`cbr|${sd % 997}`, sd, starBranches(sd, 6, 0.5, 5, 11, 2), 0.55, 0.25);
    airCrack(p, ck, cx, cy - 10, age + 0.02, 0.04, 0.2, sd);
    shards(p, burstShards(rec.x, rec.y, S, sd), age, time, 'air');
  }),
});
registerZonePainter(
  'f7_fxburst',
  fxZone(({ z, p, age, S, time }) => {
    const sd = seedOf(z.x, z.y);
    shards(p, burstShards(z.x, z.y, S, sd), age, time, 'ground');
  }),
);

// =============================================================================
// ЗАЛП ЗЕРКАЛ (третья фаза). Зеркало на стене разгорается и покрывается
// звездой трещин; по линии через зал — багровая полоса, в воздухе над ней
// густеют висящие осколки (дрожат, к удару выстраиваются остриём вперёд и
// отходят назад — замах); фронт света идёт от зеркала к дальней стене и
// доходит ровно в миг удара. Контакт: осколки летят по линии со следом,
// полоса вспыхивает, у дальней стены — брызги. Лежат вдоль линии.
// =============================================================================

registerZonePainter(
  'f7_mirrorglow',
  guarded((g, z0: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const z = z0 as FxZone;
    const life = (z as Zone).life || 1;
    const k = k01(z.t / life);
    const left = life - z.t;
    const mi = z.mi ?? 0;
    const sim = paintSim();
    const W = sim?.world?.w ?? MAP_W;
    const tx = mod(mi, W);
    const ty = Math.floor(mi / W);
    const cx = z.x * S;
    const cy = z.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const x0 = tx * S;
    const y0 = ty * S;
    // Лицо зеркала есть, если под ним пол; у боковых — только кромка.
    const face = sim?.tiles ? sim.tiles[(ty + 1) * W + tx] !== 1 : true;
    const sig = left < SIG;
    const tk = !reduced() && tick(left);
    const flick = 0.35 + 0.5 * k + (reduced() ? 0 : 0.12 * Math.sin(time * 40 + mi));
    if (face) {
      p.col(sig ? (tk ? C.white : C.hot) : C.v3, Math.min(1, flick) * 0.75);
      p.g.fillRect(x0 + 2 + p.qx, y0 + 2 + p.qy, S - 4, S - 4);
      const sd = seedOf(tx, ty);
      const ck = crackOf(`mir|${sd % 991}`, sd, starBranches(sd, 6, 0.3, 3, 8, 1), 0.6, 0.2);
      p.col(C.deep, 0.95);
      drawCrack(p, ck, x0 + 8, y0 + 8, ck.max * eOut2(k));
      p.col(C.white, 0.8);
      drawCrack(p, ck, x0 + 7, y0 + 7, ck.max * eOut2(k) * 0.5);
    }
    // Рамка горит багровым → белым.
    p.col(sig ? (tk ? C.white : PAL_CUT.hot) : PAL_CUT.mid, 0.5 + 0.45 * k);
    p.g.fillRect(x0 + p.qx, y0 + p.qy, S, 1);
    p.g.fillRect(x0 + p.qx, y0 + S - 1 + p.qy, S, 1);
    p.g.fillRect(x0 + p.qx, y0 + p.qy, 1, S);
    p.g.fillRect(x0 + S - 1 + p.qx, y0 + p.qy, 1, S);
  }),
);

registerZonePainter(
  'f7_shardline',
  guarded((g, z0: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const st = z0 as Strike;
    const k = k01(st.t / Math.max(0.01, st.warn));
    const left = st.warn - st.t;
    const cx = st.x * S;
    const cy = st.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const a = st.ang ?? 0;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const nx = -uy;
    const ny = ux;
    const L = st.r * S;
    const hw = (st.w ?? 0.42) * S;
    const sig = left < SIG;
    const tk = !reduced() && tick(left);
    p.col(PAL_CUT.dk, 0.26 + 0.12 * k);
    laneRows(cx, cy, ux, uy, 0, L, hw, (Y, xa, xb) => p.row(Y, xa, xb));
    const sf = L * (0.03 + 0.97 * Math.pow(k, 1.4));
    p.col(sig ? PAL_CUT.hot : PAL_CUT.mid, (tk ? 0.5 : 0.26) + 0.12 * k);
    laneRows(cx, cy, ux, uy, 0, sf, hw, (Y, xa, xb) => p.row(Y, xa, xb));
    // Края — пунктиром, к удару сплошь.
    const col = sig ? (tk ? C.white : PAL_CUT.hot) : PAL_CUT.rim;
    for (const s of [1, -1]) {
      p.col(col, 0.45 + 0.4 * k);
      const x0 = cx + nx * hw * s;
      const y0 = cy + ny * hw * s;
      if (sig) p.line(x0, y0, x0 + ux * L, y0 + uy * L);
      else p.dash(x0, y0, x0 + ux * L, y0 + uy * L, 4, 4, time * (30 + 90 * k));
    }
    p.col(sig ? C.white : PAL_CUT.front, 0.8);
    p.line(cx + ux * sf + nx * hw, cy + uy * sf + ny * hw, cx + ux * sf - nx * hw, cy + uy * sf - ny * hw);
    // Висящие осколки: появляются, когда до них дошёл свет; дрожат; к удару
    // встают остриём по линии и отходят назад.
    const sd = seedOf(st.x, st.y, a);
    const step = reduced() ? 22 : 13;
    // Кадр осколка, у которого остриё смотрит вдоль линии (кадры — пол-оборота с 0,3 рад).
    const aim = mod(Math.round(((a - 0.3) / Math.PI) * SHARD_FRAMES), SHARD_FRAMES);
    for (let s = 8, i = 0; s < L - 4; s += step, i++) {
      if (s > sf) break;
      const off = (hash(sd, i, 3) - 0.5) * hw * 1.2;
      const back = sig ? 3 * (1 - left / SIG) : 0;
      const jit = sig || reduced() ? 0 : Math.round((hash(sd, i, Math.floor(time * 20)) - 0.5) * 2);
      const x = cx + ux * (s - back) + nx * off + jit;
      const y = cy + uy * (s - back) + ny * off - 5;
      const f = sig ? aim : mod(Math.floor(time * 10) + i, SHARD_FRAMES);
      const im = shardImg(3, f, 0);
      p.col(C.shadow, 0.3);
      p.dot(x - 1, y + 5, 3, 1);
      p.col('#000', 0.95);
      p.img(im, x - im.width / 2, y - im.height / 2);
    }
  }),
);

/** Скорость залпа: пикселей мира в секунду. */
const VOLLEY_V = 2400;
registerImpactPainter('f7_shardline', {
  life: 0.8,
  shake: 0.12,
  above: true,
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const cx = rec.x * S;
    const cy = rec.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const a = rec.ang ?? 0;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const nx = -uy;
    const ny = ux;
    const L = (rec.r ?? 8) * S;
    const hw = (rec.w ?? 0.42) * S;
    const sd = seedOf(rec.x, rec.y, a);
    const y0 = cy - 5;
    // Кадр контакта: вся линия режется светом разом (урон — по всей линии в
    // один миг), потом по ней несутся осколки.
    if (age < 0.07) {
      const q = age / 0.07;
      p.col(C.white, 1 - q * 0.6);
      p.line(cx, y0, cx + ux * L, y0 + uy * L);
      p.col(C.cyan, 0.6 * (1 - q));
      p.line(cx + nx, y0 + ny, cx + ux * L + nx, y0 + uy * L + ny);
      p.line(cx - nx, y0 - ny, cx + ux * L - nx, y0 + uy * L - ny);
    }
    // Зеркало лопается — из него вырывается залп.
    impactStar(p, cx, y0, age, 0.1, 9, a);
    // След залпа по полосе гаснет за ним.
    const head = Math.min(L, (age + 0.03) * VOLLEY_V);
    const fl = 1 - k01(age / 0.35);
    if (fl > 0) {
      p.col(C.hot, 0.5 * fl);
      p.line(cx, y0, cx + ux * head, y0 + uy * head);
    }
    // Осколки летят по линии со следом.
    const n = reduced() ? 4 : 7;
    for (let i = 0; i < n; i++) {
      const t = age + 0.03 - 0.09 * hash(sd, i, 7);
      if (t < 0) continue;
      const s = t * VOLLEY_V * (0.9 + 0.2 * hash(sd, i, 8));
      if (s > L + 20) continue;
      const off = (hash(sd, i, 9) - 0.5) * hw * 1.4;
      const hx0 = cx + ux * Math.min(s, L) + nx * off;
      const hy0 = y0 + uy * Math.min(s, L) + ny * off;
      const tail = Math.min(s, 22);
      p.col(C.g2, 0.6);
      p.line(hx0 - ux * tail, hy0 - uy * tail, hx0 - ux * 6, hy0 - uy * 6);
      p.col(C.white, 1);
      p.line(hx0 - ux * 5, hy0 - uy * 5, hx0, hy0);
    }
    // У дальней стены — брызги, когда долетел первый.
    const tHit = L / VOLLEY_V;
    const q = (age - tHit) / 0.35;
    if (q >= 0 && q < 1) {
      const ex = cx + ux * L;
      const ey = y0 + uy * L;
      if (q < 0.3) {
        const im = glintImg(3, 0);
        p.col('#000', 1);
        p.img(im, ex - im.width / 2, ey - im.height / 2);
      }
      for (let i = 0; i < 8; i++) {
        const th = a + Math.PI + (hash(sd, i, 10) - 0.5) * 2.2;
        const d = 22 * hash(sd, i, 11) * eOut2(q);
        p.col(i % 2 ? C.cyan : C.white, 1 - q);
        p.dot(ex + Math.cos(th) * d, ey + Math.sin(th) * d + 40 * q * q);
      }
    }
  }),
});
registerZonePainter(
  'f7_fxvolley',
  fxZone(({ z, p, age, cx, cy, S, time }) => {
    const a = z.vA ?? 0;
    const L = (z.vL ?? 8) * S;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const nx = -uy;
    const ny = ux;
    const sd = seedOf(z.x, z.y, a);
    const fade = 1 - k01((age - 3.0) / 1.0);
    const n = Math.min(40, Math.floor(L / (reduced() ? 20 : 11)));
    for (let i = 0; i < n; i++) {
      const s = L * hash(sd, i, 41);
      // Ложится, когда долетел до этого места.
      const t = age - s / VOLLEY_V - 0.05;
      if (t < 0) continue;
      const off = (hash(sd, i, 42) - 0.5) * 12;
      const x = cx + ux * s + nx * off;
      const y = cy + uy * s + ny * off;
      const drop = t < 0.12 ? (1 - t / 0.12) * 5 : 0;
      const im = shardImg(hash(sd, i, 43) < 0.3 ? 3 : 2, (i * 3) & 7, 0);
      p.col('#000', fade * 0.9);
      p.img(im, x - im.width / 2, y - drop - im.height / 2);
      if (hash(sd, i, Math.floor(time * 5)) < 0.05 && !reduced()) {
        const gl = glintImg(1, 0);
        p.col('#000', fade);
        p.img(gl, x - 1, y - 1);
      }
    }
  }),
);

// =============================================================================
// ТЕНЬ НАСТОЯЩЕГО (фаза теней). Люстра над серединой арены отбрасывает от
// ведущего длинную тень — её нет у копий, это единственный признак. Тень
// повторяет фигуру (ноги, туловище, голова, клинок) и движется с ней: на
// бегу ноги расходятся, на замахе клинок у тени поднят, на ударе —
// проходит дугой. Край — сплошной у ног и прореженный к голове (свет
// рассеивается), длина чуть дышит с пламенем люстры.
// =============================================================================

/** Байер 4×4: порог прореживания края. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

registerZonePainter(
  'f7_trueshadow',
  guarded((g, z0: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const z = z0 as FxZone & { sim?: unknown };
    const sim = paintSim();
    const m = sim?.mobs.find((q) => q.id === z.mob);
    if (!m || (m.data.ghost ?? 0) > 0 || m.mode === 'dying') return;
    const lx = z.lx ?? m.x;
    const ly = z.ly ?? m.y - 2;
    const a = Math.atan2(m.y - ly, m.x - lx);
    const d = Math.hypot(m.x - lx, m.y - ly);
    const flame = reduced() ? 1 : 1 + 0.025 * Math.sin(time * 7.3) + 0.015 * Math.sin(time * 13.1);
    const len = (1.8 + d * 0.22) * S * flame;
    const cx = m.x * S;
    const cy = m.y * S + 1;
    const p = new Pen(g, px + (m.x - z.x) * S, py + (m.y - z.y) * S, cx, cy);
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const nx = -uy;
    const ny = ux;
    // Поза тени — из режима моба.
    const run = m.mode === 'chase' || m.mode === 'dash' || m.mode === 'mrun';
    const stride = run ? Math.sin(time * 11) : 0;
    let blade = 0.35; // угол клинка у тени относительно оси, рад
    let bladeOn = true;
    if (m.mode === 'combo' || m.mode === 'riposte' || m.mode === 'heavy') {
      const w = m.mode === 'heavy' ? 1 : m.mode === 'riposte' ? 0.32 : 0.46;
      const q = k01(m.t / w);
      blade = 0.35 + 1.1 * eOut2(q);
    } else if (m.mode === 'recover' && m.t < 0.2) blade = -0.9 + m.t * 4;
    else if (m.mode === 'daze') bladeOn = false;
    // Силуэт в осях (u вдоль тени, v поперёк): ноги, туловище, голова.
    const inside = (u: number, v: number): boolean => {
      const t = u / len;
      if (t < 0 || t > 1.02) return false;
      if (t < 0.38) {
        // Две ноги: у ступней врозь (на бегу — шире и по очереди вперёд),
        // к бёдрам сходятся в туловище.
        const q = t / 0.38;
        if (q > 0.8) return Math.abs(v) < 2.6;
        const c = 1.5 + 1.1 * (1 - q) * Math.abs(stride);
        const wl = 1.1 + 0.4 * q;
        const uL = Math.max(0, stride * 2.5);
        const uR = Math.max(0, -stride * 2.5);
        return (Math.abs(v - c) < wl && u >= uL) || (Math.abs(v + c) < wl && u >= uR);
      }
      if (t < 0.8) return Math.abs(v) < 3.2 + 1.2 * Math.sin(((t - 0.38) / 0.42) * Math.PI);
      const hc = 0.9;
      const hr = 0.12;
      const du = (t - hc) / hr;
      return du * du + (v / 3.6) * (v / 3.6) < 1;
    };
    const R = Math.ceil(len) + 8;
    const x0 = Math.floor(Math.min(cx, cx + ux * len) - 8);
    const x1 = Math.ceil(Math.max(cx, cx + ux * len) + 8);
    const y0 = Math.floor(Math.min(cy, cy + uy * len) - 8);
    const y1 = Math.ceil(Math.max(cy, cy + uy * len) + 8);
    void R;
    p.col(C.shadow, 0.6);
    for (let Y = y0; Y <= y1; Y++) {
      let ra = -1;
      for (let X = x0; X <= x1 + 1; X++) {
        let on = false;
        if (X <= x1) {
          const dx = X + 0.5 - cx;
          const dy = Y + 0.5 - cy;
          const u = dx * ux + dy * uy;
          const v = -dx * uy + dy * ux;
          on = inside(u, v);
          // Край прорежен к голове: свет рассеивается.
          if (on) {
            const t = u / len;
            const thr = t < 0.55 ? -1 : ((t - 0.55) / 0.5) * 11;
            if (BAYER[(Y & 3) * 4 + (X & 3)] < thr) on = false;
          }
        }
        if (on && ra < 0) ra = X;
        if (!on && ra >= 0) {
          p.row(Y, ra, X - 1);
          ra = -1;
        }
      }
    }
    // Клинок тени: от плеча, угол растёт на замахе и проходит на ударе.
    if (bladeOn) {
      const su = len * 0.66;
      const sx = cx + ux * su + nx * 3;
      const sy = cy + uy * su + ny * 3;
      const ba = a + blade;
      const bl = len * 0.42;
      p.col(C.shadow, 0.5);
      p.line(sx, sy, sx + Math.cos(ba) * bl, sy + Math.sin(ba) * bl);
    }
  }),
);

// ---- Прогрев: осколки, блёстки и пыль готовы до первого удара ---------------

function* warmFx(): Generator<unknown> {
  for (let pal = 0; pal < 3; pal++)
    for (let sz = 2; sz <= 5; sz++) {
      for (let f = 0; f < SHARD_FRAMES; f++) shardImg(sz, f, pal);
      yield 0;
    }
  for (let pal = 0; pal < 3; pal++) {
    for (let r = 1; r <= 4; r++) glintImg(r, pal);
    yield 0;
  }
  for (let r = 2; r <= 9; r++) {
    for (let v = 0; v < 4; v++) puffImg(r, v);
    yield 0;
  }
  for (let r = 2; r <= 40; r += 1) circle(r);
  yield 0;
}
registerMobWarm('f7_boss', warmFx);
