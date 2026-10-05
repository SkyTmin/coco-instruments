// Этаж 13, босс «Колосс» — техники (v2.87): метки ударов, зоны, снаряды и
// контакт каждого удара. Тело босса рисует `f13-art.ts`, здесь — всё, что
// исполин делает с ПЛОЩАДЬЮ. Договор движка — библия §14.
//
// Как устроено:
//   • метка удара читается «куда» с первого кадра (тёмная кромка, бледная
//     заливка всей формы) и «когда» — фронт налива, тень ладони, тень
//     падающего камня, волна пара доходят до места ровно в миг урона;
//     последние 0,2 с — «тик-тик» и жёлтая кромка;
//   • контакт (`registerImpactPainter`) — свой у каждого удара: смаз ладони
//     и борозды от пальцев, плиты мозаики, подброшенные топотом, раскол,
//     пыль клубами, камни с отскоком, стена пара; тряска — по силе удара;
//   • у ударов без своего strike (выброс пара, разлом площади, шаги,
//     колени, рёв фаз, бросок) — визуальные зоны `api.vfx`, их ставит мозг
//     (без урона и статусов, строки `// v2.87 — только рисунок`);
//   • всё светящееся (угли жара, струи из раскалённых решёток, плащ пара
//     поверх тела) — поверх темноты (`above`); пыль, трещины, камни, пар у
//     земли — на полу под мобами.
//
// Мозаика площади пёстрая и сама расчерчена красными и золотыми лучами.
// Поэтому метки отличаются от неё ДВИЖЕНИЕМ (бегущие штрихи, налив, тени) и
// тёмной кромкой, у всего светлого — тень на пиксель вниз-вправо, пар —
// с серо-синей тенью снизу (белое на кремовом иначе пропадает).
//
// Пиксели — на СЕТКЕ МИРА (`Pen`): эффект стоит на полу, а не плывёт за
// камерой. Частицы детерминированы — позиция от зерна и возраста, а не
// копится по кадрам: лист кадров и игра рисуют одно и то же, стоп-кадр
// держит позу сам.
import { Px } from '../dungeon-art';
import {
  paintSim,
  registerImpactPainter,
  registerMobWarm,
  registerShotPainter,
  registerZonePainter,
} from '../dungeon-paint';
import type { ImpactRec, Sprite } from '../dungeon-paint';
import type { Mob, Shot, Strike, Zone } from '../dungeon-sim';
import { COL } from './f13-brains';

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
const eIn2 = (t: number) => t * t;
const eOut2 = (t: number) => 1 - (1 - t) * (1 - t);
const eOut3 = (t: number) => 1 - (1 - t) * (1 - t) * (1 - t);
/** Положительный остаток (у зон `api.vfx` номера отрицательные). */
const pmod = (x: number, n: number) => ((x % n) + n) % n;

/** Последние 0,2 с перед уроном — ясный сигнал «сейчас». */
const SIG = 0.2;
/** «Тик-тик»: две вспышки в последние 0,2 с (0,20…0,15 и 0,10…0,05). */
const tick = (left: number) => left > 0 && left < SIG && Math.floor(left / 0.05) % 2 === 1;

// ---- Палитра: кровь меток, жар, пар, камень города ---------------------------

const C = {
  ink: '#150f0b',
  redDk: '#5a0c08',
  red: '#b8241a',
  redHot: '#ff4a2a',
  orange: '#ff8a2a',
  yellow: '#ffe070',
  white: '#fff8ec',
  shadow: '#140806',
  groove: '#3a281c',
  lip: '#efe2c4',
  deep: '#160c08',
  steam: '#f6f4f0',
  steamSh: '#7c8aa0',
  wet: '#4a4038',
  fire: ['#5a1206', '#a8300c', '#ff6a1a', '#ffb030', '#fff0a0'],
};

/** Искра и уголь по доле жизни: белая → жёлтая → оранжевая → красная. */
const emberCol = (k: number) =>
  k < 0.15
    ? '#ffffff'
    : k < 0.38
      ? C.fire[4]
      : k < 0.62
        ? C.fire[3]
        : k < 0.85
          ? C.fire[2]
          : C.fire[1];

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

// ---- Перо: пиксели на сетке мира -------------------------------------------

/**
 * Рисует в игровых пикселях, привязанных к сетке МИРА: `(px, py)` — где на
 * экране точка мира `(wx, wy)` (пиксели мира). Поправка `qx/qy` — остаток
 * привязки движка, одна на весь кадр: эффект стоит на полу, а не дрожит.
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
  col(c: string, a = 1): void {
    this.g.fillStyle = c;
    this.g.globalAlpha = a < 0 ? 0 : a > 1 ? 1 : a;
  }
  dot(x: number, y: number, w = 1, h = 1): void {
    this.g.fillRect(Math.floor(x) + this.qx, Math.floor(y) + this.qy, w, h);
  }
  /** Прямоугольник в целых пикселях мира (уже с полом). */
  rect(x: number, y: number, w: number, h: number): void {
    this.g.fillRect(x + this.qx, y + this.qy, w, h);
  }
  img(c: HTMLCanvasElement, x: number, y: number): void {
    this.g.drawImage(c, Math.floor(x) + this.qx, Math.floor(y) + this.qy);
  }
  /** Холст с масштабом от центра (кусок плиты уходит в пропасть). */
  imgS(c: HTMLCanvasElement, x: number, y: number, s: number): void {
    const w = Math.max(1, Math.round(c.width * s));
    const h = Math.max(1, Math.round(c.height * s));
    this.g.drawImage(c, Math.floor(x - w / 2) + this.qx, Math.floor(y - h / 2) + this.qy, w, h);
  }
  /** Линия по пикселям (Брезенхэм), концы — точки мира. */
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
    for (let n = 0; n < 600; n++) {
      this.g.fillRect(x + this.qx, y + this.qy, 1, 1);
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
  /** Линия с тенью на пиксель вниз-вправо — читается на пёстрой мозаике. */
  lineS(x0: number, y0: number, x1: number, y1: number, c: string, a: number, sh = 0.5): void {
    if (sh > 0) {
      this.col(C.ink, a * sh);
      this.line(x0 + 1, y0 + 1, x1 + 1, y1 + 1);
    }
    this.col(c, a);
    this.line(x0, y0, x1, y1);
  }
}

// ---- Заливки по строкам пикселей -------------------------------------------

/**
 * Кольцевой сектор [r0, r1] × [a0, a1] строками пикселей. Угол больше
 * четверти круга режется на куски с ОБЩИМИ границами: пиксель на стыке
 * достаётся ровно одному куску, полупрозрачная заливка не даёт шва.
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
  const y0 = Math.floor(cy - r1);
  const y1 = Math.ceil(cy + r1);
  const g = p.g;
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
        if (xb >= xa) g.fillRect(xa + p.qx, Y + p.qy, xb - xa + 1, 1);
      }
    }
  }
}

/** Многоугольник по строкам пикселей: ровный край без сглаживания канвы. */
function fillPoly(p: Pen, xs: number[], ys: number[]): void {
  const y0 = Math.floor(Math.min(...ys));
  const y1 = Math.ceil(Math.max(...ys));
  const n = xs.length;
  for (let y = y0; y < y1; y++) {
    const cy = y + 0.5;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (cy < ys[i] === cy < ys[j]) continue;
      const x = xs[i] + ((cy - ys[i]) / (ys[j] - ys[i])) * (xs[j] - xs[i]);
      if (x < lo) lo = x;
      if (x > hi) hi = x;
    }
    const a = Math.round(lo);
    const b = Math.round(hi);
    if (b > a) p.rect(a, y, b - a, 1);
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
    const key = (x + 1024) * 4096 + (y + 1024);
    if (seen.has(key)) return;
    seen.add(key);
    pts.push([x, y]);
  };
  let x = R;
  let y = 0;
  let err = 1 - R;
  while (x >= y) {
    for (const [a, b] of [
      [x, y],
      [y, x],
      [-y, x],
      [-x, y],
      [-x, -y],
      [-y, -x],
      [y, -x],
      [x, -y],
    ])
      add(a, b);
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
    x: Int16Array.from(withA.map((p) => p[0])),
    y: Int16Array.from(withA.map((p) => p[1])),
    a: Float32Array.from(withA.map((p) => p[2])),
  };
  circles.set(R, c);
  return c;
}

/** Угол a в секторе [a0, a0 + span] (span > 0) с переходом через 2π. */
const inArc = (a: number, a0: number, span: number) => {
  const d = (((a - a0) % TAU) + TAU) % TAU;
  return d <= span;
};

/**
 * Кольцо по пикселям цветом `c`. `keep(a, i)` — оставить ли пиксель
 * (пунктир, дуга, «рваная» пыль). `sh` — тень на пиксель вниз-вправо.
 */
function ring(
  p: Pen,
  cx: number,
  cy: number,
  r: number,
  c: string,
  a: number,
  keep?: (a: number, i: number) => boolean,
  sh = 0,
): void {
  if (r < 0.5 || a <= 0) return;
  const pts = circle(r);
  const ox = Math.floor(cx);
  const oy = Math.floor(cy);
  const n = pts.x.length;
  for (let pass = sh > 0 ? 0 : 1; pass < 2; pass++) {
    const d = pass ? 0 : 1;
    p.col(pass ? c : C.ink, pass ? a : a * sh);
    let rx = 0;
    let ry = 0;
    let rw = 0;
    let rh = 0;
    for (let i = 0; i < n; i++) {
      if (keep && !keep(pts.a[i], i)) continue;
      const x = ox + pts.x[i] + d;
      const y = oy + pts.y[i] + d;
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
      if (rw) p.rect(rx, ry, rw, rh);
      rx = x;
      ry = y;
      rw = 1;
      rh = 1;
    }
    if (rw) p.rect(rx, ry, rw, rh);
  }
}

/**
 * Дуга «от руки»: по углу от `from` на `span` (со знаком — куда ведём),
 * радиус чуть гуляет (`jit`), разрывы с долей `gap`. Борозда, кромка
 * волны, край трещины — неровные, а не циркульные.
 */
function arcDots(
  p: Pen,
  cx: number,
  cy: number,
  r: number,
  from: number,
  span: number,
  jit: number,
  seed: number,
  gap = 0,
): void {
  const n = Math.max(2, Math.ceil(Math.abs(span) * r));
  let px0 = NaN;
  let py0 = NaN;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const a = from + span * u;
    const seg = Math.floor((i * 1.0) / 3);
    if (gap > 0 && hash(seed, seg, 61) < gap) {
      px0 = NaN;
      continue;
    }
    const rr = r + (hash(seed, seg, 62) - 0.5) * jit + (hash(seed, seg + 1, 62) - 0.5) * jit * 0.5;
    const x = Math.floor(cx + Math.cos(a) * rr);
    const y = Math.floor(cy + Math.sin(a) * rr);
    if (x === px0 && y === py0) continue;
    p.dot(x, y);
    px0 = x;
    py0 = y;
  }
}

/** Повёрнутый овал по пикселям: вдоль (ux, uy) полуось `l`, поперёк — `w`. */
function lens(
  p: Pen,
  cx: number,
  cy: number,
  ux: number,
  uy: number,
  l: number,
  w: number,
  dither = false,
): void {
  const R = Math.ceil(Math.max(l, w)) + 1;
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  for (let y = -R; y <= R; y++)
    for (let x = -R; x <= R; x++) {
      const dx = x0 + x + 0.5 - cx;
      const dy = y0 + y + 0.5 - cy;
      const a = (dx * ux + dy * uy) / l;
      const b = (-dx * uy + dy * ux) / w;
      if (a * a + b * b > 1) continue;
      if (dither && (x0 + x + y0 + y) & 1) continue;
      p.dot(x0 + x, y0 + y);
    }
}

/** Звезда удара: n лучей радиуса r (у основания — 0,4 r). */
function star(p: Pen, cx: number, cy: number, r: number, n: number, rot: number): void {
  const R = Math.ceil(r) + 1;
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  for (let y = -R; y <= R; y++)
    for (let x = -R; x <= R; x++) {
      const dx = x0 + x + 0.5 - cx;
      const dy = y0 + y + 0.5 - cy;
      const d = Math.hypot(dx, dy);
      if (d > r) continue;
      const th = Math.atan2(dy, dx) - rot;
      const spike = Math.pow(Math.abs(Math.cos((th * n) / 2)), 3);
      if (d <= r * (0.4 + 0.6 * spike)) p.dot(x0 + x, y0 + y);
    }
}

/** Эллипс тени по пикселям (полуоси rx, ry), `dither` — мягкая тень. */
function shadowEll(p: Pen, cx: number, cy: number, rx: number, ry: number, dither = false): void {
  if (rx < 0.5 || ry < 0.5) return;
  const y0 = Math.floor(cy - ry);
  const y1 = Math.ceil(cy + ry);
  for (let y = y0; y <= y1; y++) {
    const yy = (y + 0.5 - cy) / ry;
    if (Math.abs(yy) >= 1) continue;
    const h = rx * Math.sqrt(1 - yy * yy);
    const a = Math.ceil(cx - h - 0.5);
    const b = Math.floor(cx + h - 0.5);
    if (b < a) continue;
    if (!dither) p.rect(a, y, b - a + 1, 1);
    else for (let x = a; x <= b; x++) if (((x + y) & 1) === 0) p.rect(x, y, 1, 1);
  }
}

// ---- Спрайты-заготовки: клубы, камни, плиты мозаики --------------------------

const sprites = new Map<string, HTMLCanvasElement>();
const sprite = (key: string, make: () => Px): HTMLCanvasElement => {
  let c = sprites.get(key);
  if (!c) {
    c = make().canvas();
    sprites.set(key, c);
  }
  return c;
};

/**
 * Клуб: тень снизу-справа, основа, свет сверху-слева. Пыль — серо-бурая,
 * чуть темнее мозаики, со светлой макушкой: кремовая на кремовом полу
 * читалась ватой.
 */
const PUFF_PAL: [RGBA, RGBA, RGBA][] = [
  [hx('#76695a'), hx('#a3967e'), hx('#d4c9ae')], // 0 — пыль города
  [hx('#7c8aa0'), hx('#d8e0e8'), hx('#ffffff')], // 1 — пар: серо-синяя тень, белый верх
  [hx('#b06a52'), hx('#f6d6c4'), hx('#fffaf2')], // 2 — горячий пар: розовая тень
  [hx('#221e1c'), hx('#3e3834'), hx('#5e5650')], // 3 — копоть, гарь
  [hx('#5a3022'), hx('#8e5a44'), hx('#c08a6c')], // 4 — кирпичная пыль Стены
];

/**
 * Клуб радиуса r (1…18), вариант v (0…3): три доли, чтобы край был рваным,
 * а не циркульным. Свет сверху-слева, тень — у нижней кромки. `d` — растр
 * таяния: 0 — сплошной, 1/2 — шахматка (две фазы), 3/4 — редкая сетка.
 */
function puffImg(pal: number, r: number, v: number, d = 0): HTMLCanvasElement {
  const R = Math.max(1, Math.min(18, Math.round(r)));
  return sprite(`pf${pal}|${R}|${v & 3}|${d}`, () => {
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
        if (d === 1 && (x + y) & 1) continue;
        if (d === 2 && !((x + y) & 1)) continue;
        if (d >= 3 && ((x + ((d - 3) & 1)) & 1 || (y + ((d - 3) >> 1)) & 1)) continue;
        const l = ((x + 0.5 - c) * -0.55 + (y + 0.5 - c) * -0.83) / Math.max(1, R);
        const edge = !inside(x, y + 1) || (!inside(x + 1, y + 1) && l < 0);
        // Край клуба мягкий: внешний ряд — шахматкой (иначе клуб — камень).
        const rim =
          !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
        if (rim && R > 2 && (x + y) & 1) continue;
        p.set(x, y, edge && R > 1 ? sh : l > 0.25 ? hi : mid);
      }
    return p;
  });
}

/**
 * Клуб в мире: доля жизни `k` решает, как он тает — сплошной, потом
 * шахматкой, потом редкой сеткой (как в пиксельных играх), а не мутной
 * прозрачностью. Растр привязан к сетке мира — не «кипит» при движении.
 */
function club(
  p: Pen,
  pal: number,
  r: number,
  v: number,
  x: number,
  y: number,
  k: number,
  a = 1,
): void {
  const R = Math.max(1, Math.min(18, Math.round(r * (1 - 0.2 * k01((k - 0.6) / 0.4)))));
  const s = 2 * R + 3;
  const ix = Math.floor(x - s / 2);
  const iy = Math.floor(y - s / 2);
  // Тает шахматкой, потом гаснет: редкая сетка читалась решёткой.
  const d = k < 0.45 ? 0 : 1 + ((ix + iy) & 1);
  p.col('#000', a * (k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3));
  p.img(puffImg(pal, R, v, d), ix, iy);
}

// ---- Облако: клубы сливаются в одну массу -----------------------------------

/**
 * Три тона облака: тень, основа, блик. У пара тень мягкая (серо-голубая),
 * у пыли — бурая. Облако рисуется ВСЕМИ клубами сразу в три прохода —
 * край и светотень общие, клубы сливаются, а не стоят бусами.
 */
const CLOUD_PAL: [RGBA, RGBA, RGBA][] = [
  [hx('#6e6252'), hx('#a3967e'), hx('#d4c9ae')], // 0 — пыль города
  [hx('#9aa6b8'), hx('#dfe5ec'), hx('#ffffff')], // 1 — пар
  [hx('#c48a74'), hx('#f6dccc'), hx('#fffaf2')], // 2 — горячий пар
  [hx('#1e1a18'), hx('#3a3430'), hx('#5a524c')], // 3 — копоть
  [hx('#5a3022'), hx('#8e5a44'), hx('#c08a6c')], // 4 — кирпичная пыль
];

/** Ком облака одного тона: три доли (вариант v), растр таяния d как у клуба. */
function blobImg(pal: number, tone: number, R: number, v: number, d: number): HTMLCanvasElement {
  return sprite(`bl${pal}|${tone}|${R}|${v & 3}|${d}`, () => {
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
    const col = CLOUD_PAL[pal][tone];
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        if (!inside(x, y)) continue;
        if (d === 1 && (x + y) & 1) continue;
        if (d === 2 && !((x + y) & 1)) continue;
        if (d >= 3 && ((x + ((d - 3) & 1)) & 1 || (y + ((d - 3) >> 1)) & 1)) continue;
        // Край основы мягкий: внешний ряд шахматкой — сквозь него видна тень.
        if (tone === 1 && R > 2 && (x + y) & 1) {
          const rim =
            !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
          if (rim) continue;
        }
        p.set(x, y, col);
      }
    return p;
  });
}

let scr: HTMLCanvasElement | null = null;
let sctx: CanvasRenderingContext2D | null = null;
/** Общий буфер облака: облако собирается целиком, на экран — одним кадром. */
function scratch(w: number, h: number): CanvasRenderingContext2D {
  if (!scr || !sctx || scr.width < w || scr.height < h) {
    scr = scr ?? document.createElement('canvas');
    scr.width = Math.max(scr.width, w, 128);
    scr.height = Math.max(scr.height, h, 128);
    sctx = scr.getContext('2d')!;
  }
  sctx.clearRect(0, 0, w, h);
  return sctx;
}

/**
 * Облако из клубов: `cl` — по пять чисел на клуб (x, y мира в пикселях,
 * радиус, доля жизни k, вариант). `a` — прозрачность облака целиком (пелена
 * пара), `hide` — клуб заслонён (за телом Колосса, за героем).
 */
function cloud(
  p: Pen,
  pal: number,
  cl: number[],
  a = 1,
  hide?: (x: number, y: number) => boolean,
): void {
  const n = cl.length / 5;
  if (!n || a <= 0) return;
  let x0 = 1e9;
  let y0 = 1e9;
  let x1 = -1e9;
  let y1 = -1e9;
  const keep: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = cl[i * 5];
    const y = cl[i * 5 + 1];
    const r = cl[i * 5 + 2];
    const k = cl[i * 5 + 3];
    if (r < 0.6 || k >= 1) continue;
    if (hide && hide(x, y)) continue;
    keep.push(i);
    x0 = Math.min(x0, x - r - 4);
    y0 = Math.min(y0, y - r - 4);
    x1 = Math.max(x1, x + r + 5);
    y1 = Math.max(y1, y + r + 6);
  }
  if (!keep.length) return;
  x0 = Math.floor(x0);
  y0 = Math.floor(y0);
  const w = Math.min(640, Math.ceil(x1) - x0);
  const h = Math.min(640, Math.ceil(y1) - y0);
  const g = scratch(w, h);
  for (let tone = 0; tone < 3; tone++)
    for (const i of keep) {
      const x = cl[i * 5];
      const y = cl[i * 5 + 1];
      const k = cl[i * 5 + 3];
      if (tone === 2 && k > 0.55) continue;
      const R0 = Math.max(
        1,
        Math.min(16, Math.round(cl[i * 5 + 2] * (1 - 0.2 * k01((k - 0.6) / 0.4)))),
      );
      // У мелких комов блик и тень не видны — не тратим на них проходы.
      if ((tone === 2 && R0 < 3) || (tone === 0 && R0 < 2)) continue;
      const R = tone === 2 ? Math.max(1, Math.round(R0 * 0.55)) : R0;
      const ox = tone === 0 ? 1 : tone === 2 ? -R0 * 0.3 : 0;
      const oy = tone === 0 ? 2 : tone === 2 ? -R0 * 0.38 : 0;
      const ix = Math.floor(x + ox - R - 1.5);
      const iy = Math.floor(y + oy - R - 1.5);
      if (k > 0.9) continue;
      const d = k < 0.5 ? 0 : 1 + ((ix + iy) & 1);
      g.drawImage(blobImg(pal, tone, R, cl[i * 5 + 4], d), ix - x0, iy - y0);
    }
  p.col('#000', a);
  p.g.drawImage(scr!, 0, 0, w, h, x0 + p.qx, y0 + p.qy, w, h);
}

const STONE_PAL: RGBA[][] = [
  [hx('#29231f'), hx('#4a413a'), hx('#6c6158'), hx('#92867a')], // 0 — булыжник
  [hx('#3a3632'), hx('#6a645c'), hx('#9a9286'), hx('#c8c0b0')], // 1 — камень Стены
  [hx('#3a1a12'), hx('#6e3222'), hx('#9a4a32'), hx('#c06a4a')], // 2 — кирпич
  [hx('#5a4e3a'), hx('#9a8a6a'), hx('#d8c8a0'), hx('#f0e6cc')], // 3 — смальта мозаики
];

/** Камень размера 1…4, поворот f (0…3): овал с объёмом и тёмным контуром. */
function stoneImg(sz: number, f: number, pal: number): HTMLCanvasElement {
  return sprite(`st${pal}|${sz}|${f & 3}`, () => {
    const s = sz * 2 + 3;
    const p = new Px(s, s);
    const c = s / 2;
    const rx = 0.55 + 0.6 * sz;
    const ry = 0.4 + 0.4 * sz;
    const a = (f & 3) * (Math.PI / 4);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const t = STONE_PAL[pal];
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        const dx = x + 0.5 - c;
        const dy = y + 0.5 - c;
        const u = (dx * ca + dy * sa) / rx;
        const w = (-dx * sa + dy * ca) / ry;
        if (u * u + w * w > 1) continue;
        const l = -dx * 0.6 - dy * 0.8;
        p.set(x, y, l > 0.6 ? t[3] : l > -0.2 ? t[2] : l > -0.9 ? t[1] : t[0]);
      }
    p.outline(hx(C.ink));
    return p;
  });
}

/** Мозаика площади: крем, терракота, золото, сланец (как в `f13-art`). */
const MOS: RGBA[] = [hx('#d8c8a0'), hx('#9a4a2e'), hx('#b8903e'), hx('#4a5a6a'), hx('#6a2a1e')];

/**
 * Осколок мозаики, выбитый из пола: неровная плитка цвета смальты, кромка
 * сверху-слева светлее, торец снизу темнее; обводка — тёмным камнем, а не
 * чернилами (с чёрной обводкой плитки читались «доминошками»). `f` — наклон
 * в полёте: 0 — плашмя, 1 — к нам, 2 — на ребре, 3 — от нас.
 */
function slabImg(w: number, f: number, v: number): HTMLCanvasElement {
  return sprite(`sl${w}|${f & 3}|${v & 3}`, () => {
    const top = Math.max(
      1,
      [Math.round(w * 0.6), Math.round(w * 0.45), 1, Math.round(w * 0.35)][f & 3],
    );
    const side = [1, 2, 2, 1][f & 3];
    const p = new Px(w + 2, top + side + 2);
    const base = MOS[[0, 1, 2, 0][v & 3]];
    const lift = (c: RGBA, k: number): RGBA => [
      Math.max(0, Math.min(255, c[0] + k)),
      Math.max(0, Math.min(255, c[1] + k)),
      Math.max(0, Math.min(255, c[2] + k)),
      255,
    ];
    // Неровный край: срезанные углы, разные у вариантов.
    const cut = (x: number, y: number) =>
      (x === 0 && y === 0 && v & 1) || (x === w - 1 && y === top - 1 && !(v & 1));
    for (let y = 0; y < top; y++)
      for (let x = 0; x < w; x++) {
        if (cut(x, y)) continue;
        const edge = y === 0 || x === 0 ? 26 : x === w - 1 || y === top - 1 ? -18 : 0;
        p.set(x + 1, y + 1, lift(base, edge + (hash(x, y, v) - 0.5) * 12));
      }
    for (let y = 0; y < side; y++)
      for (let x = 0; x < w; x++)
        p.set(x + 1, top + 1 + y, (f & 3) === 2 ? hx('#3a3028') : lift(base, -70 - y * 18));
    p.outline(hx('#3a2e22'));
    return p;
  });
}

// ---- Частицы: позиция от зерна и возраста -----------------------------------

interface Fly {
  /** Путь по земле (в секундах начальной скорости), высота, в воздухе ли. */
  h: number;
  z: number;
  air: boolean;
}
/**
 * Полёт камня: подброс `vz`, тяжесть `G`, отскоки с потерей энергии и
 * трением — от возраста. `h` — путь по земле в секундах начальной скорости.
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

/**
 * Камни веером: `n` штук из (x, y) в сторону `ang` ± `spread`, скорость
 * `v0…v0+dv`, подброс `vz0…vz0+dvz`. Тень под летящим, лёгший гаснет к `fade`.
 */
function stones(
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
  pal: number,
  fade: [number, number],
  big = 0.3,
): void {
  const a = 1 - k01((age - fade[0]) / (fade[1] - fade[0]));
  if (a <= 0) return;
  for (let i = 0; i < n; i++) {
    const r1 = hash(seed, i, 11);
    const r2 = hash(seed, i, 12);
    const r3 = hash(seed, i, 13);
    const r4 = hash(seed, i, 14);
    const th = ang + (r1 - 0.5) * 2 * spread;
    const v = v0 + dv * r2;
    const f = fly(age, vz0 + dvz * r3, 430);
    const gx = x + Math.cos(th) * v * f.h;
    const gy = y + Math.sin(th) * v * f.h;
    const sz = r4 < big * 0.4 ? 4 : r4 < big ? 3 : r4 < 0.7 ? 2 : 1;
    if (f.air) {
      p.col(C.ink, 0.3 * a);
      p.dot(gx - sz / 2, gy + 1, sz, 1);
    }
    const spin = f.air ? Math.floor(age * (14 + r2 * 10) + i) & 3 : i & 3;
    // 10 — осколки мозаики: плитки смальты, а не камешки-овалы.
    const im =
      pal === 10
        ? slabImg(Math.min(6, 2 + sz), f.air ? spin : (i & 1) * 2, i)
        : stoneImg(sz, spin, pal === 9 ? (i % 3 === 0 ? 2 : 1) : pal);
    p.col('#000', a);
    p.img(im, gx - im.width / 2, gy - f.z - im.height / 2);
  }
}

/**
 * Клубы: `n` штук из (x, y), направление `ang` ± `spread`, скорость с
 * сопротивлением, растут `r0 → r1`, поднимаются на `rise` и тают за `life`.
 * `stagger` — задержка появления клуба (доля до `stagger` с).
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
  alpha = 0.92,
  stagger = 0,
  hide?: (x: number, y: number) => boolean,
  into?: number[],
): void {
  // `into` — только собрать клубы: несколько источников рисуются ОДНИМ
  // облаком (линия разлома — не облако на каждую клетку).
  const cl = into ?? [];
  for (let i = 0; i < n; i++) {
    const h1 = hash(seed, i, 21);
    const h2 = hash(seed, i, 22);
    const h3 = hash(seed, i, 23);
    const t = age - stagger * hash(seed, i, 24);
    if (t < 0) continue;
    const L = life * (0.75 + 0.4 * h3);
    if (t >= L) continue;
    const k = t / L;
    const th = ang + (h1 - 0.5) * 2 * spread;
    const d = drag(v0 + dv * h2, 3.2, t);
    const sz = 0.5 + 0.6 * hash(seed, i, 25);
    const r = r0 + (r1 - r0) * sz * eOut2(k01(t / (L * 0.6)));
    const z = rise * (0.6 + 0.4 * h2) * eOut2(k);
    cl.push(x + Math.cos(th) * d, y + Math.sin(th) * d - z, r, k, i);
  }
  if (!into) cloud(p, pal, cl, alpha, hide);
}

/** Искры и угли: головка и хвост по скорости, цвет по доле жизни. */
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
  G = 160,
): void {
  for (let i = 0; i < n; i++) {
    const h1 = hash(seed, i, 31);
    const h2 = hash(seed, i, 32);
    const h3 = hash(seed, i, 33);
    const L = life * (0.6 + 0.6 * h3);
    if (age >= L) continue;
    const k = age / L;
    const th = ang + (h1 - 0.5) * 2 * spread;
    const v = v0 + dv * h2;
    const vz = up * (0.4 + h3);
    const at = (t: number): [number, number] => {
      const d = drag(v, 2.2, t);
      const z = vz * t - G * t * t;
      return [x + Math.cos(th) * d, y + Math.sin(th) * d - z];
    };
    const [ax, ay] = at(age);
    const [bx, by] = at(Math.max(0, age - 0.04));
    p.col(emberCol(k), 1 - k * 0.4);
    p.line(bx, by, ax, ay);
  }
}

// ---- Трещины: сеть от зерна, растёт от точки удара ---------------------------

interface Crack {
  x: Int16Array;
  y: Int16Array;
  d: Float32Array;
  /** Кромка: светлый пиксель снизу-справа от жёлоба. */
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
  let maxLen = 0;
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
    maxLen = Math.max(maxLen, d0 + len);
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
        if (w > 2.1)
          put(Math.floor(qx - Math.sin(a) * 0.95), Math.floor(qy + Math.cos(a) * 0.95), d);
      }
      x = nx;
      y = ny;
      if (depth < 1 && s > len * 0.3 && s < len * 0.75 && hash(seed, id * 17 + i, 2) < forkP) {
        const side = hash(seed, id * 19 + i, 3) < 0.5 ? -1 : 1;
        walk(
          x,
          y,
          a + side * (0.5 + 0.4 * hash(seed, id, 4)),
          (len - s) * 0.5,
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
    .filter(([x, y, d]) => d < maxLen * 0.55 && !px.has(K(x + 1, y + 1)))
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
  if (cracks.size > 600) cracks.delete(cracks.keys().next().value as string);
  cracks.set(key, c);
  return c;
}

/**
 * Трещина одной ветвью по направлению `ang` из конечного набора: 16 сторон
 * × 3 рисунка на длину. Сеть от случайного зерна считалась бы прямо в кадр
 * удара (3–10 мс) — а этот набор прогревается заранее.
 */
function rcrack(len: number, w: number, ang: number, v: number): Crack {
  const L = Math.max(2, Math.round(len));
  const b = pmod(Math.round(ang / (TAU / 16)), 16);
  const vv = pmod(v, 3);
  return crackOf(
    `rc|${L}|${w}|${b}|${vv}`,
    b * 7 + vv * 131 + L,
    [[(b * TAU) / 16 + (hash(b, vv, L) - 0.5) * 0.25, L, w]],
    0.5,
    0.18,
  );
}

/** Звезда трещин вида `kind` — 4 рисунка на вид, тоже из прогретого набора. */
function scrack(kind: string, n: number, lo: number, hi: number, w: number, v: number): Crack {
  const vv = pmod(v, 4);
  const sd = vv * 977 + kind.length * 31 + n;
  return crackOf(
    `sc|${kind}|${Math.round(lo)}|${Math.round(hi)}|${vv}`,
    sd,
    starBranches(sd, n, vv * 0.7, lo, hi, w),
    0.45,
    0.25,
  );
}

/** Раскрытая трещина одним холстом (дорисовалась — один `drawImage`). */
const crackImgs = new WeakMap<
  Crack,
  Map<string, { img: HTMLCanvasElement; x: number; y: number }>
>();
function crackImg(c: Crack, core: string, lip: string | null) {
  let m = crackImgs.get(c);
  if (!m) {
    m = new Map();
    crackImgs.set(c, m);
  }
  const key = `${core}|${lip}`;
  let hit = m.get(key);
  if (hit) return hit;
  let x0 = 1e9;
  let y0 = 1e9;
  let x1 = -1e9;
  let y1 = -1e9;
  const grow = (xs: Int16Array, ys: Int16Array) => {
    for (let i = 0; i < xs.length; i++) {
      x0 = Math.min(x0, xs[i]);
      y0 = Math.min(y0, ys[i]);
      x1 = Math.max(x1, xs[i]);
      y1 = Math.max(y1, ys[i]);
    }
  };
  grow(c.x, c.y);
  if (lip) grow(c.lx, c.ly);
  if (x1 < x0) {
    x0 = y0 = 0;
    x1 = y1 = 0;
  }
  const px = new Px(x1 - x0 + 1, y1 - y0 + 1);
  if (lip) {
    const l = hx(lip, Math.round(0.7 * 255));
    for (let i = 0; i < c.lx.length; i++) px.set(c.lx[i] - x0, c.ly[i] - y0, l);
  }
  const k = hx(core);
  for (let i = 0; i < c.x.length; i++) px.set(c.x[i] - x0, c.y[i] - y0, k);
  hit = { img: px.canvas(), x: x0, y: y0 };
  m.set(key, hit);
  return hit;
}

/** Трещина до пути `reach` (пиксели): жёлоб `core`, кромка `lip`. */
function drawCrack(
  p: Pen,
  c: Crack,
  x: number,
  y: number,
  reach: number,
  core: string,
  lip: string | null,
  a: number,
): void {
  if (a <= 0) return;
  const ox = Math.floor(x);
  const oy = Math.floor(y);
  if (reach >= c.max) {
    const im = crackImg(c, core, lip);
    p.col('#000', a);
    p.img(im.img, ox + im.x, oy + im.y);
    return;
  }
  if (lip) {
    p.col(lip, a * 0.7);
    for (let i = 0; i < c.lx.length && c.ld[i] <= reach; i++) p.dot(ox + c.lx[i], oy + c.ly[i]);
  }
  p.col(core, a);
  for (let i = 0; i < c.x.length && c.d[i] <= reach; i++) p.dot(ox + c.x[i], oy + c.y[i]);
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

// ---- Общее для зон ----------------------------------------------------------

/** Лишние поля визуальных зон мозга (`api.vfx` в f13-brains). */
type FxZone = Zone & {
  ang?: number;
  k?: number;
  tx?: number;
  ty?: number;
  sx?: number;
  sy?: number;
  cells?: number[];
  ww?: number;
};

/** Колосс в кадре (живой). */
const colossus = (): Mob | undefined =>
  paintSim()?.mobs.find((m) => m.kind === 'f13boss' && m.mode !== 'dying');

const mobOf = (id: number | undefined): Mob | undefined =>
  id === undefined ? undefined : paintSim()?.mobs.find((m) => m.id === id);

/**
 * Кто заслоняет точку мира (пиксели) для слоя поверх темноты: этот слой
 * рисуется после всех мобов, и клуб пара ЗА спиной Колосса ложился бы ему
 * на грудь. Заслоняют Колосс (трапеция: ноги 0,9 клетки, плечи 1,5, рост
 * 4,8) и герой (0,45 × 1,25): точка за ними и в силуэте не рисуется.
 */
interface Screen {
  /** Точка (x, y) на картинке, `gy` — где её основание на земле (глубина). */
  (x: number, y: number, gy: number): boolean;
}
function screenOf(S: number): Screen {
  const sim = paintSim();
  const box: number[] = [];
  if (sim) {
    for (const m of sim.mobs)
      if (m.kind === 'f13boss' && m.mode !== 'dying')
        box.push(m.x * S, m.y * S, 0.9 * S, 1.5 * S, 4.8 * S);
    const h = sim.hero;
    box.push(h.x * S, h.y * S, 0.45 * S, 0.45 * S, 1.25 * S);
  }
  return (x: number, y: number, gy: number) => {
    for (let i = 0; i < box.length; i += 5) {
      // Заслоняет только тот, кто стоит ближе к камере (южнее точки).
      if (box[i + 1] <= gy) continue;
      const up = box[i + 1] - 1 - y;
      if (up <= 0 || up > box[i + 4]) continue;
      if (Math.abs(x - box[i]) < box[i + 2] + (box[i + 3] - box[i + 2]) * (up / box[i + 4]))
        return true;
    }
    return false;
  };
}

/**
 * Обёртка рисовальщика: сохранить и вернуть контекст (зоны рисуются без
 * `save/restore` движка — прозрачность не должна утечь в соседей).
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

/** Кромка сектора: дуга и два края, в два пикселя (тёмная снаружи). */
function sectorRim(
  p: Pen,
  cx: number,
  cy: number,
  R: number,
  a0: number,
  arc: number,
  r0: number,
  c: string,
  a: number,
  keep?: (u: number) => boolean,
): void {
  const ok = (ang: number) => {
    if (!inArc(ang, a0, arc)) return false;
    if (!keep) return true;
    const d = (((ang - a0) % TAU) + TAU) % TAU;
    return keep(d * R);
  };
  ring(p, cx, cy, R + 1, C.ink, a * 0.6, ok);
  ring(p, cx, cy, R, c, a, ok);
  for (const ea of [a0, a0 + arc]) {
    const ex = Math.cos(ea);
    const ey = Math.sin(ea);
    const out = ea === a0 ? -1 : 1;
    const nx = -ey * out;
    const ny = ex * out;
    for (let r = r0; r < R; r += 1) {
      if (keep && !keep(ea === a0 ? R - r : arc * R + (R - r))) continue;
      p.col(C.ink, a * 0.6);
      p.dot(cx + ex * r + nx, cy + ey * r + ny);
      p.col(c, a);
      p.dot(cx + ex * r, cy + ey * r);
    }
  }
}

/**
 * Пыль на полу подскакивает: `n` крошек в форме (`at(i)` — точка мира),
 * прыгают тем выше и чаще, чем ближе удар (`k` 0…1). Земля «боится».
 */
function hops(
  p: Pen,
  seed: number,
  time: number,
  k: number,
  n: number,
  at: (i: number) => [number, number],
): void {
  if (k <= 0.25 || reduced()) return;
  const amp = 1 + 3 * k01((k - 0.25) / 0.75);
  for (let i = 0; i < n; i++) {
    const [gx, gy] = at(i);
    const hop = Math.floor(hash(i, Math.floor(time * (10 + 14 * k)), seed) * amp);
    if (hop) {
      p.col(C.ink, 0.35);
      p.dot(gx, gy + 1);
    }
    p.col(i % 3 ? C.lip : '#a89a80', 0.95);
    p.dot(gx, gy - hop);
  }
}

/**
 * Импульсы по земле: тонкие рваные дуги бегут от тела наружу (до `rEnd`),
 * всё чаще к удару — «ударит волной отсюда». `arc` не задан — круг.
 */
function pings(
  p: Pen,
  cx: number,
  cy: number,
  r0: number,
  rEnd: number,
  k: number,
  t: number,
  seed: number,
  col: string,
  a0?: number,
  arc?: number,
): void {
  // Период от 0,5 с к 0,12 с: фаза — интеграл частоты, без скачков.
  const ph = (t / 0.5) * (1 + 1.6 * k * k);
  for (let j = 0; j < 3; j++) {
    const u = ph - Math.floor(ph) + j / 3;
    const uu = u - Math.floor(u);
    const r = r0 + (rEnd - r0) * eOut2(uu);
    const a = (0.25 + 0.6 * k) * (1 - uu) * Math.min(1, uu * 6);
    ring(
      p,
      cx,
      cy,
      r,
      col,
      a,
      (ang, i) =>
        (a0 === undefined || inArc(ang, a0, arc ?? TAU)) && hash(i >> 2, seed, j + 70) > 0.3,
      0.5,
    );
  }
}

// =============================================================================
// ЛАДОНЬ — конус r 5,2, дуга 1,5 перед собой (`f13_colpalm`). Метка: налив
// от тела к кромке с разгоном; над начальным краем висит тень занесённой
// ладони — большая и бледная, пока рука высоко; в последние 0,2 с ладонь
// метёт по дуге, за ней остаётся раскалённая полоса. Контакт: смаз ладони
// по всему конусу, четыре борозды от пальцев и пятка, волна по кромке,
// земля сгребена к концу хода — пыль и камни летят по касательной.
// =============================================================================

/**
 * Куда метёт ладонь: сверху вниз по экрану — как рука в кадре (замах над
 * головой, удар наискось вниз). Смотрит вправо или к нам — по часовой.
 */
const sweepDir = (a: number) => (Math.cos(a) + Math.sin(a) >= 0 ? 1 : -1);

/**
 * Тень ладони на земле: пятерня, пальцы — по (ux, uy) (от тела наружу),
 * большой палец — к началу хода (сторона `side`). `s` — масштаб (высоко —
 * крупнее), `soft` — рябая (мягкая тень высоко поднятой руки).
 */
function palmShadow(
  p: Pen,
  x: number,
  y: number,
  ux: number,
  uy: number,
  side: number,
  s: number,
  soft: boolean,
): void {
  const nx = -uy;
  const ny = ux;
  lens(p, x, y, ux, uy, 4.2 * s, 3.6 * s, soft);
  for (let f = 0; f < 4; f++) {
    const off = (f - 1.5) * 1.75 * s;
    const len = (f === 0 || f === 3 ? 2.6 : 3.2) * s;
    lens(
      p,
      x + ux * (4.6 * s + len * 0.55) + nx * off,
      y + uy * (4.6 * s + len * 0.55) + ny * off,
      ux,
      uy,
      len,
      0.8 * s,
      soft,
    );
  }
  lens(
    p,
    x + nx * side * 4.2 * s + ux * 0.8 * s,
    y + ny * side * 4.2 * s + uy * 0.8 * s,
    ux * 0.5 + nx * side * 0.86,
    uy * 0.5 + ny * side * 0.86,
    2.4 * s,
    0.9 * s,
    soft,
  );
}

registerZonePainter(
  'f13_colpalm',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const st = z as Strike;
    const T = Math.max(0.01, st.warn);
    const t = Math.min(st.t, T);
    const k = k01(t / T);
    const left = T - t;
    const cx = st.x * S;
    const cy = st.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = st.r * S;
    const a = st.ang ?? 0;
    const arc = st.arc ?? 1.5;
    const a0 = a - arc / 2;
    const dir = sweepDir(a);
    const aS = a - (dir * arc) / 2;
    const r0 = S * 1.1;
    const sig = left < SIG;
    const tk = !reduced() && tick(left);
    // «Куда»: весь конус с первого кадра, с тёмной кромкой.
    p.col(C.redDk, 0.24 + 0.08 * k);
    fillSector(p, cx, cy, r0, R, a0, a0 + arc);
    // «Когда»: налив от тела к кромке — с разгоном, как рука.
    const rf = r0 + (R - r0) * Math.pow(k, 1.7);
    p.col(sig ? C.redHot : C.red, (tk ? 0.6 : 0.3) + 0.12 * k);
    fillSector(p, cx, cy, r0, rf, a0, a0 + arc);
    ring(
      p,
      cx,
      cy,
      rf,
      sig ? C.yellow : C.orange,
      0.7 + 0.3 * k,
      (ang) => inArc(ang, a0, arc),
      0.5,
    );
    // Кромка: штрихи бегут по ходу ладони.
    const run = time * (30 + 70 * k) * dir;
    sectorRim(
      p,
      cx,
      cy,
      R,
      a0,
      arc,
      r0,
      sig ? (tk ? C.white : C.yellow) : k > 0.5 ? C.orange : C.redHot,
      0.75 + 0.25 * k,
      sig ? undefined : (u) => pmod(u - run, 9) < 6,
    );
    // Земля дрожит под занесённой рукой.
    hops(p, 13, time, k, 18, (i) => {
      const rr = r0 + (R - r0) * (0.15 + 0.8 * hash(i, 5, 13));
      const aa = a0 + arc * hash(i, 6, 13);
      return [cx + Math.cos(aa) * rr, cy + Math.sin(aa) * rr];
    });
    // Ладонь: занесена над начальным краем; в последние 0,2 с — метёт.
    const sw = sig ? eIn2(1 - left / SIG) : 0;
    const ah = aS + dir * (0.16 + (arc - 0.32) * sw);
    const rh = R * 0.63;
    if (sw > 0) {
      // След: раскалённая полоса за ладонью, передний край — жёлтый.
      const b0 = Math.min(aS, ah);
      const b1 = Math.max(aS, ah);
      p.col(C.redHot, 0.45);
      fillSector(p, cx, cy, R * 0.4, R * 0.88, b0, b1);
      p.col(C.yellow, 0.9);
      for (let r = R * 0.4; r < R * 0.88; r += 1)
        p.dot(cx + Math.cos(ah) * r, cy + Math.sin(ah) * r);
    }
    const ux = Math.cos(ah);
    const uy = Math.sin(ah);
    const high = 1 - (sig ? 1 : eIn2(k));
    // Рука высоко — тень крупнее и мягче (рябая), но видна с первого кадра.
    p.col(C.shadow, 0.5 + 0.4 * (1 - high));
    palmShadow(p, cx + ux * rh, cy + uy * rh, ux, uy, -dir, 1.2 + 0.35 * high, high > 0.85);
  }),
);

registerImpactPainter('f13_colpalm', {
  life: 1.75,
  shake: 0.14,
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const cx = rec.x * S;
    const cy = rec.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const a = rec.ang ?? 0;
    const arc = rec.arc ?? 1.5;
    const R = (rec.r ?? 5.2) * S;
    const dir = sweepDir(a);
    const aS = a - (dir * arc) / 2;
    const aE = a + (dir * arc) / 2;
    const sd = rec.seed;
    const few = reduced();
    const fade = 1 - k01((age - 1.15) / 0.55);
    // Смаз ладони: весь путь руки, ярче к концу хода, гаснет за 0,15 с.
    if (age < 0.15) {
      const k = age / 0.15;
      const n = 6;
      for (let i = 0; i < n; i++) {
        const u0 = i / n;
        const u1 = (i + 1) / n;
        const b0 = aS + dir * arc * u0;
        const b1 = aS + dir * arc * u1;
        p.col(k < 0.3 ? C.white : C.yellow, (0.3 + 0.7 * u1) * (1 - k));
        fillSector(
          p,
          cx,
          cy,
          R * (0.4 + 0.18 * k),
          R * (0.9 - 0.04 * k),
          Math.min(b0, b1),
          Math.max(b0, b1),
        );
      }
      // Линии скорости поперёк смаза — видно, куда шла рука.
      if (k < 0.7)
        for (let i = 0; i < 4; i++) {
          const r = R * (0.48 + 0.12 * i);
          p.col(C.red, 0.7 * (1 - k));
          arcDots(
            p,
            cx,
            cy,
            r,
            aS + dir * arc * (0.1 + 0.15 * hash(sd, i, 2)),
            dir * arc * (0.45 + 0.4 * k),
            0,
            sd + i,
            0.2,
          );
        }
    }
    // Борозды: пятка и четыре пальца — от начала хода до конца.
    const ext = arc * eOut3(k01(age / 0.07));
    const grooves = [0.44, 0.55, 0.64, 0.73, 0.82];
    grooves.forEach((rr, i) => {
      const r = R * rr;
      const lo = aS + dir * (0.05 + 0.08 * hash(sd, i, 3));
      const span = dir * Math.max(0, ext - 0.1 - 0.12 * hash(sd, i, 4));
      // Шрам в полу: жёлоб в два пикселя, светлая кромка снизу-справа.
      p.col(C.lip, 0.75 * fade);
      arcDots(p, cx + 1, cy + 2, r, lo, span, 1.4, sd + i * 31, 0.1);
      p.col(i === 0 ? C.deep : C.groove, fade);
      arcDots(p, cx, cy, r, lo, span, 1.4, sd + i * 31, 0.1);
      arcDots(p, cx, cy + 1, r, lo, span * 0.92, 1.4, sd + i * 31, 0.1);
    });
    // Волна по кромке конуса — рваная, как пыль.
    if (age < 0.3) {
      const k = age / 0.3;
      ring(
        p,
        cx,
        cy,
        R * (0.94 + 0.3 * eOut2(k)),
        C.white,
        0.9 * (1 - k),
        (ang, i) => inArc(ang, a - arc / 2, arc) && hash(i >> 2, sd, 9) > 0.25,
        0.6,
      );
    }
    // Пыль по следу — встаёт там, где прошла рука (по порядку хода).
    const nT = few ? 5 : 12;
    const trail: number[] = [];
    for (let i = 0; i < nT; i++) {
      const u = (i + 0.5) / nT;
      const ang = aS + dir * arc * u;
      const rr = R * (0.48 + 0.36 * hash(sd, i, 7));
      const t = age + 0.12 * (1 - u);
      const L = 0.7 + 0.25 * hash(sd, i, 8);
      if (t >= L) continue;
      const kk = t / L;
      const tang = ang + (dir * Math.PI) / 2;
      const d = drag(14 + 10 * hash(sd, i, 9), 3, t);
      trail.push(
        cx + Math.cos(ang) * rr + Math.cos(tang) * d,
        cy + Math.sin(ang) * rr + Math.sin(tang) * d - 6 * eOut2(kk),
        2 + 5 * eOut2(k01(t / 0.35)) * (0.6 + 0.5 * hash(sd, i, 6)),
        kk,
        i,
      );
    }
    cloud(p, 0, trail, 0.95);
    // Сгребённая земля у конца хода: вал пыли и камни — по ходу руки и наружу.
    const ex = cx + Math.cos(aE) * R * 0.66;
    const ey = cy + Math.sin(aE) * R * 0.66;
    const tang = aE + (dir * Math.PI) / 2;
    const fling = tang - dir * 0.75;
    dust(p, sd, age, ex, ey, few ? 3 : 7, fling, 0.6, 26, 30, 3, 9, 8, 0.95, 0, 0.95);
    stones(p, sd, age, ex, ey, few ? 5 : 12, fling, 0.6, 30, 50, 60, 70, 10, [1.0, 1.5], 0.4);
    stones(
      p,
      sd + 5,
      age,
      cx + Math.cos(a) * R * 0.6,
      cy + Math.sin(a) * R * 0.6,
      few ? 3 : 6,
      fling,
      0.8,
      18,
      30,
      40,
      50,
      0,
      [1.0, 1.5],
      0.2,
    );
  }),
});

// =============================================================================
// ТОПОТ — дуга кольца r 2,9 ± 0,8 на стороне героя (`f13_foot`). Метка:
// полоса дуги с первого кадра; от ног бегут импульсы — всё чаще к удару;
// полоса наливается изнутри наружу, крошка подпрыгивает. Контакт: удар
// приходит волной — полоса вспыхивает, плиты мозаики вылетают из гнёзд и
// падают обратно, поперёк полосы — трещины, вдоль — стена пыли.
// =============================================================================

/**
 * Метка кольца (топот — дуга, землетрясение — круг): полоса с кромками,
 * налив изнутри наружу, импульсы от ног, крошка прыгает, в последние 0,2 с
 * плиты в полосе уже трескаются.
 */
function ringMark(
  g: CanvasRenderingContext2D,
  z: Zone | Strike,
  px: number,
  py: number,
  S: number,
  time: number,
  heavy: number,
): void {
  {
    const st = z as Strike;
    const T = Math.max(0.01, st.warn);
    const t = Math.min(st.t, T);
    const k = k01(t / T);
    const left = T - t;
    const cx = st.x * S;
    const cy = st.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const r = st.r * S;
    const w = (st.w ?? 0.8) * S;
    const arc = st.arc ?? TAU;
    const a0 = (st.ang ?? 0) - arc / 2;
    const sig = left < SIG;
    const tk = !reduced() && tick(left);
    p.col(C.redDk, 0.24 + 0.08 * k);
    fillSector(p, cx, cy, r - w, r + w, a0, a0 + arc);
    // Налив изнутри наружу: волна выйдет от ног.
    const rf = r - w + 2 * w * Math.pow(k, 1.5);
    p.col(sig ? C.redHot : C.red, (tk ? 0.62 : 0.32) + 0.1 * k);
    fillSector(p, cx, cy, r - w, rf, a0, a0 + arc);
    const rimC = sig ? (tk ? C.white : C.yellow) : C.redHot;
    sectorRim(p, cx, cy, r + w, a0, arc, r - w, rimC, 0.8 + 0.2 * k);
    ring(p, cx, cy, r - w, C.ink, 0.5, (ang) => inArc(ang, a0, arc));
    ring(p, cx, cy, r - w + 1, rimC, 0.6 + 0.3 * k, (ang) => inArc(ang, a0, arc));
    pings(p, cx, cy, S * 1.1, r - w, k, st.t, 17, sig ? C.yellow : C.orange, a0, arc);
    const nh = Math.round((arc * r) / 5);
    hops(p, 29, time, k, nh, (i) => {
      const rr = r - w + 2 * w * hash(i, 5, 29);
      const aa = a0 + arc * hash(i, 6, 29);
      return [cx + Math.cos(aa) * rr, cy + Math.sin(aa) * rr];
    });
    // Последние 0,2 с: плиты в полосе уже трескаются — трещины бегут
    // поперёк полосы от внутреннего края, каждая своей длины.
    if (sig) {
      const sd = pmod(st.id, 997) + 1;
      const n = Math.max(4, Math.round((arc * r) / 26));
      for (let i = 0; i < n; i++) {
        const aa = a0 + arc * ((i + 0.2 + 0.6 * hash(sd, i, 1)) / n);
        const ck = rcrack(
          2 * w * (0.55 + 0.4 * hash(sd, i, 3)),
          1,
          aa + (hash(sd, i, 2) - 0.5) * 0.5,
          sd + i,
        );
        drawCrack(
          p,
          ck,
          cx + Math.cos(aa) * (r - w),
          cy + Math.sin(aa) * (r - w),
          ck.max * eOut2(1 - left / SIG),
          C.groove,
          null,
          0.85,
        );
      }
    }
  }
}

registerZonePainter(
  'f13_foot',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) =>
    ringMark(g, z, px, py, S, time, 0),
  ),
);

/**
 * Взрыв полосы кольца (топот, землетрясение): вспышка, волна, плиты из
 * гнёзд, трещины поперёк, пыль стеной. `full` — полный круг.
 */
function bandBlast(
  p: Pen,
  sd: number,
  age: number,
  cx: number,
  cy: number,
  r: number,
  w: number,
  a0: number,
  arc: number,
  heavy: number,
): void {
  const few = reduced();
  const fade = 1 - k01((age - 0.85 - 0.25 * heavy) / 0.45);
  const inA = (ang: number) => inArc(ang, a0, arc);
  // Кадр удара: полоса белая, потом жёлтая, гаснет за 0,12 с.
  if (age < 0.12) {
    const k = age / 0.12;
    p.col(k < 0.35 ? C.white : C.yellow, 0.75 * (1 - k));
    fillSector(p, cx, cy, r - w, r + w, a0, a0 + arc);
  }
  // Гнёзда выбитых плит — тёмные ямки с кромкой (остаются).
  const nSlab = Math.round((arc * r) / 24);
  for (let i = 0; i < nSlab; i++) {
    const ang = a0 + arc * ((i + hash(sd, i, 81)) / nSlab);
    const rr = r + (hash(sd, i, 82) - 0.5) * 1.4 * w;
    const hx0 = cx + Math.cos(ang) * rr;
    const hy0 = cy + Math.sin(ang) * rr;
    const sw = 4 + Math.floor(hash(sd, i, 83) * 3);
    if (age < 0.03) continue;
    // Гнездо выбитой плитки — неглубокая тень в полу, не чёрный брусок.
    p.col('#4a3a2a', 0.5 * fade);
    p.rect(Math.floor(hx0 - sw / 2), Math.floor(hy0 - 1), sw, 2);
    // Плита: подброс, кувырок, падает рядом и лежит, потом тает.
    const f = fly(age - 0.03, 70 + 60 * hash(sd, i, 84) + 30 * heavy, 430, 0.25);
    const out = drag(10 + 16 * hash(sd, i, 85) + 10 * heavy, 2.5, Math.min(age, 0.6));
    const gx = hx0 + Math.cos(ang) * out;
    const gy = hy0 + Math.sin(ang) * out;
    if (f.air) {
      p.col(C.ink, 0.3);
      p.rect(Math.floor(gx - sw / 2), Math.floor(gy + 1), sw, 1);
    }
    const tilt = f.air ? Math.floor(age * (10 + 8 * hash(sd, i, 86)) + i) & 3 : (i & 1) * 2;
    const im = slabImg(sw, tilt, Math.floor(hash(sd, i, 87) * 4));
    p.col('#000', fade);
    p.img(im, gx - im.width / 2, gy - f.z - im.height / 2);
  }
  // Трещины поперёк полосы: от середины в обе стороны.
  const nCr = Math.max(3, Math.round((arc * r) / 24));
  for (let i = 0; i < nCr; i++) {
    const ang = a0 + arc * ((i + 0.5) / nCr) + (hash(sd, i, 91) - 0.5) * 0.08;
    const bx = cx + Math.cos(ang) * r;
    const by = cy + Math.sin(ang) * r;
    const out = rcrack(w * (0.8 + 0.3 * heavy), 2, ang + (hash(sd, i, 92) - 0.5) * 0.4, sd + i);
    const inn = rcrack(
      w * (0.6 + 0.3 * heavy),
      2,
      ang + Math.PI + (hash(sd, i, 93) - 0.5) * 0.4,
      sd + i + 1,
    );
    for (const ck of [out, inn])
      drawCrack(p, ck, bx, by, ck.max * eOut3(k01(age / 0.12)), C.groove, C.lip, fade);
  }
  // Волна: от внутреннего края наружу — рваная, тает.
  if (age < 0.34) {
    const k = age / 0.34;
    ring(
      p,
      cx,
      cy,
      r - w + (2 * w + 10 + 10 * heavy) * eOut2(k),
      C.white,
      0.95 * (1 - k),
      (ang, i) => inA(ang) && hash(i >> 2, sd, 9) > 0.22,
      0.6,
    );
    ring(
      p,
      cx,
      cy,
      r - w + (2 * w + 6 + 8 * heavy) * eOut2(k),
      C.lip,
      0.7 * (1 - k),
      (ang, i) => inA(ang) && hash(i >> 2, sd, 10) > 0.4,
    );
  }
  // Стена пыли вдоль полосы: клубы встают по дуге и сносит наружу.
  const nD = Math.round((arc * r) / (few ? 24 : 10));
  const wall: number[] = [];
  for (let i = 0; i < nD; i++) {
    const ang = a0 + arc * ((i + hash(sd, i, 94)) / nD);
    const rr = r + (hash(sd, i, 95) - 0.5) * w;
    const t = age - 0.03 * hash(sd, i, 96);
    const L = (0.7 + 0.2 * heavy) * (0.8 + 0.4 * hash(sd, i, 97));
    if (t < 0 || t >= L) continue;
    const kk = t / L;
    const d = drag(18 + 18 * heavy + 10 * hash(sd, i, 98), 3.2, t);
    wall.push(
      cx + Math.cos(ang) * (rr + d),
      cy + Math.sin(ang) * (rr + d) - (7 + 5 * heavy) * eOut2(kk),
      3 + (4 + 3 * heavy) * eOut2(k01(t / (L * 0.5))) * (0.6 + 0.6 * hash(sd, i, 99)),
      kk,
      i,
    );
  }
  cloud(p, 0, wall, 0.95);
  // Камни — наружу, с отскоком.
  const mid = a0 + arc / 2;
  stones(
    p,
    sd,
    age,
    cx + Math.cos(mid) * r,
    cy + Math.sin(mid) * r,
    few ? 4 : Math.round(6 + 6 * heavy),
    mid,
    arc / 2,
    24,
    40,
    50,
    70,
    0,
    [1.2 + 0.3 * heavy, 1.75 + 0.3 * heavy],
    0.3,
  );
}

registerImpactPainter('f13_foot', {
  life: 1.9,
  shake: 0.18,
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const cx = rec.x * S;
    const cy = rec.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const arc = rec.arc ?? TAU;
    bandBlast(
      p,
      rec.seed,
      age,
      cx,
      cy,
      (rec.r ?? 2.9) * S,
      (rec.w ?? 0.8) * S,
      (rec.ang ?? 0) - arc / 2,
      arc,
      0,
    );
  }),
});

// =============================================================================
// РАЗВОРОТ — конус r 3,9, дуга 2,2 за спиной (`f13_colback`), потом за
// 0,5 с лицом туда. Метка: «стрелка часов» — рука заметает конус в ту
// сторону, куда он повернётся (`vSpin` из мозга), и замыкает его ровно в
// миг урона; у ног крутится пыль — он ставит опорную ногу. Контакт: три
// серпа ветра по всему конусу, пыль и камни сдуты по ходу поворота,
// костяшки прочертили пол у конца дуги.
// =============================================================================

/** Куда повернётся (+1 — по часовой на экране). Мозг кладёт в `vSpin`. */
const spinOf = (m: Mob | undefined) => ((m?.data.vSpin ?? 1) < 0 ? -1 : 1);

registerZonePainter(
  'f13_colback',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const st = z as Strike;
    const T = Math.max(0.01, st.warn);
    const t = Math.min(st.t, T);
    const k = k01(t / T);
    const left = T - t;
    const cx = st.x * S;
    const cy = st.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = st.r * S;
    const a = st.ang ?? 0;
    const arc = st.arc ?? 2.2;
    const a0 = a - arc / 2;
    const dir = spinOf(mobOf(st.from));
    const aS = a - (dir * arc) / 2;
    const r0 = S * 1.1;
    const sig = left < SIG;
    const tk = !reduced() && tick(left);
    p.col(C.redDk, 0.24 + 0.08 * k);
    fillSector(p, cx, cy, r0, R, a0, a0 + arc);
    // Стрелка: заметает конус по ходу поворота, разгоняясь.
    const sw = Math.pow(k, 1.35);
    const aL = aS + dir * arc * sw;
    p.col(sig ? C.redHot : C.red, (tk ? 0.62 : 0.34) + 0.1 * k);
    fillSector(p, cx, cy, r0, R, Math.min(aS, aL), Math.max(aS, aL));
    const ux = Math.cos(aL);
    const uy = Math.sin(aL);
    p.col(C.ink, 0.6);
    for (let r = r0; r < R; r += 1) p.dot(cx + ux * r + 1, cy + uy * r + 1);
    p.col(sig ? C.white : C.yellow, 0.95);
    for (let r = r0; r < R; r += 1) p.dot(cx + ux * r, cy + uy * r);
    // Наконечник стрелки у кромки — смотрит по ходу поворота.
    const nx = -uy * dir;
    const ny = ux * dir;
    const tx0 = cx + ux * R * 0.78;
    const ty0 = cy + uy * R * 0.78;
    for (const side of [-1, 1]) {
      const ex = tx0 - nx * 5 + ux * side * 4;
      const ey = ty0 - ny * 5 + uy * side * 4;
      p.lineS(tx0, ty0, ex, ey, sig ? C.white : C.yellow, 0.95, 0.6);
    }
    const run = time * (30 + 60 * k) * dir;
    sectorRim(
      p,
      cx,
      cy,
      R,
      a0,
      arc,
      r0,
      sig ? (tk ? C.white : C.yellow) : k > 0.5 ? C.orange : C.redHot,
      0.75 + 0.25 * k,
      sig ? undefined : (u) => pmod(u - run, 9) < 6,
    );
    // Пыль у ног крутится в сторону поворота — опорная нога.
    if (!reduced()) {
      const spin = dir * (1.5 + 9 * k * k) * st.t;
      for (let i = 0; i < 14; i++) {
        const ang = (i / 14) * TAU + spin * (0.8 + 0.4 * hash(i, 2, 77));
        const rr = S * (1.0 + 0.5 * hash(i, 3, 77));
        const x = cx + Math.cos(ang) * rr;
        const y = cy + Math.sin(ang) * rr * 0.8;
        p.col(C.ink, 0.3 * k);
        p.dot(x + 1, y + 1);
        p.col(i % 3 ? C.lip : '#a89a80', 0.25 + 0.6 * k);
        p.dot(x, y);
      }
    }
  }),
);

registerImpactPainter('f13_colback', {
  life: 1.6,
  shake: 0.26,
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const cx = rec.x * S;
    const cy = rec.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const a = rec.ang ?? 0;
    const arc = rec.arc ?? 2.2;
    const R = (rec.r ?? 3.9) * S;
    // Сторона поворота — с Колосса в миг удара (он ещё не развернулся).
    let dir = spinMemo.get(rec);
    if (dir === undefined) {
      dir = spinOf(colossus());
      spinMemo.set(rec, dir);
    }
    const aS = a - (dir * arc) / 2;
    const aE = a + (dir * arc) / 2;
    const sd = rec.seed;
    const few = reduced();
    const fade = 1 - k01((age - 1.05) / 0.55);
    // Кадр удара: весь конус вспыхивает ветром.
    if (age < 0.07) {
      p.col(age < 0.035 ? C.white : C.lip, 0.55 * (1 - age / 0.07));
      fillSector(p, cx, cy, S * 1.1, R, a - arc / 2, a + arc / 2);
    }
    // Три серпа ветра: голова убегает по ходу поворота, хвост догоняет;
    // средний — главный (рука), крайние — тоньше.
    if (age < 0.26) {
      for (let j = 0; j < 3; j++) {
        const rj = R * [0.5, 0.74, 0.95][j];
        const big = j === 1 ? 1.7 : 1;
        const head = eOut3(k01((age + 0.02 - j * 0.015) / 0.09));
        const tail = eOut2(k01((age - 0.025 - j * 0.015) / 0.17));
        if (head <= tail) continue;
        const al = 1 - k01((age - 0.08) / 0.18);
        const n = 6;
        for (let i = 0; i < n; i++) {
          const u0 = tail + ((head - tail) * i) / n;
          const u1 = tail + ((head - tail) * (i + 1)) / n;
          const b0 = aS + dir * arc * u0;
          const b1 = aS + dir * arc * u1;
          // Толще и ярче к голове — серп, а не кольцо.
          const th = (1 + 3.4 * ((i + 1) / n)) * big;
          p.col(C.ink, al * 0.35);
          fillSector(
            p,
            cx + 1,
            cy + 1,
            rj - th,
            rj + th * 0.55,
            Math.min(b0, b1),
            Math.max(b0, b1),
          );
          p.col(i >= n - 2 ? C.white : C.lip, al * (0.4 + 0.6 * ((i + 1) / n)));
          fillSector(p, cx, cy, rj - th, rj + th * 0.55, Math.min(b0, b1), Math.max(b0, b1));
        }
      }
    }
    // Борозды костяшек у конца дуги.
    for (let i = 0; i < 3; i++) {
      const r = R * (0.62 + 0.09 * i);
      const span = dir * 0.7 * eOut3(k01(age / 0.1));
      const lo = aE - dir * (0.75 + 0.1 * hash(sd, i, 5));
      p.col(C.lip, 0.7 * fade);
      arcDots(p, cx + 1, cy + 1, r, lo, span, 1.2, sd + i * 17, 0.12);
      p.col(C.groove, fade);
      arcDots(p, cx, cy, r, lo, span, 1.2, sd + i * 17, 0.12);
    }
    // Пыль сдута по ходу поворота — с каждого места конуса по касательной.
    const nD = few ? 5 : 13;
    const swept: number[] = [];
    for (let i = 0; i < nD; i++) {
      const u = (i + 0.5) / nD;
      const ang = aS + dir * arc * u;
      const rr = R * (0.45 + 0.45 * hash(sd, i, 7));
      const t = age - 0.06 * u;
      const L = 0.85 + 0.3 * hash(sd, i, 8);
      if (t < 0 || t >= L) continue;
      const kk = t / L;
      const tang = ang + (dir * Math.PI) / 2;
      const d = drag(30 + 20 * hash(sd, i, 9), 3.4, t);
      swept.push(
        cx + Math.cos(ang) * rr + Math.cos(tang) * d,
        cy + Math.sin(ang) * rr + Math.sin(tang) * d - 5 * eOut2(kk),
        2 + 5 * eOut2(k01(t / 0.35)) * (0.6 + 0.5 * hash(sd, i, 6)),
        kk,
        i,
      );
    }
    cloud(p, 0, swept, 0.95);
    // Линии ветра: короткие дуги бегут по ходу поворота.
    if (age < 0.32 && !few) {
      const k = age / 0.32;
      for (let i = 0; i < 7; i++) {
        const r = R * (0.42 + 0.55 * hash(sd, i, 11));
        const from = aS + dir * arc * (0.1 + 0.6 * hash(sd, i, 12) + 0.5 * eOut2(k));
        p.col(C.white, 0.8 * (1 - k));
        arcDots(p, cx, cy, r, from, dir * (10 / r), 0, sd + i, 0);
      }
    }
    const ex = cx + Math.cos(aE) * R * 0.7;
    const ey = cy + Math.sin(aE) * R * 0.7;
    stones(
      p,
      sd,
      age,
      ex,
      ey,
      few ? 4 : 10,
      aE + (dir * Math.PI) / 2,
      0.6,
      30,
      45,
      50,
      60,
      0,
      [1.05, 1.6],
      0.3,
    );
  }),
});
const spinMemo = new WeakMap<ImpactRec, number>();

/** Разворот: опорная нога проворачивается — пыль вихрем, гравий по касательной. */
registerZonePainter(
  'f13_colpivot',
  guarded((g, zz: Zone | Strike, px: number, py: number, S: number) => {
    const z = zz as FxZone;
    const t = z.t;
    const cx = z.x * S;
    const cy = z.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const dir = (z.k ?? 1) < 0 ? -1 : 1;
    const sd = pmod(z.id, 9973) * 5 + 9;
    const R = z.r * S;
    const fade = 1 - k01((t - 0.45) / 0.35);
    // Затёртый круг под ногами.
    p.col(C.groove, 0.55 * fade);
    arcDots(p, cx, cy + 2, R * 0.55, 0, TAU * dir * eOut2(k01(t / 0.4)), 1.5, sd, 0.35);
    // Вихрь пыли: клубы идут по кругу и отходят наружу.
    const n = reduced() ? 5 : 12;
    const swirl: number[] = [];
    for (let i = 0; i < n; i++) {
      const L = 0.6 + 0.2 * hash(sd, i, 1);
      if (t >= L) continue;
      const kk = t / L;
      const ang = (i / n) * TAU + dir * 6 * eOut2(kk) * (0.7 + 0.5 * hash(sd, i, 2));
      const rr = R * (0.5 + 0.6 * eOut2(kk));
      swirl.push(
        cx + Math.cos(ang) * rr,
        cy + Math.sin(ang) * rr * 0.75 - 4 * kk,
        2 + 4 * eOut2(k01(kk * 2)),
        kk,
        i,
      );
    }
    cloud(p, 0, swirl, 0.92);
    for (let i = 0; i < 6; i++)
      stones(
        p,
        sd + i,
        t,
        cx + Math.cos((i / 6) * TAU) * R * 0.5,
        cy + Math.sin((i / 6) * TAU) * R * 0.4,
        1,
        (i / 6) * TAU + (dir * Math.PI) / 2,
        0.3,
        30,
        20,
        30,
        30,
        0,
        [0.5, 0.75],
        0,
      );
  }),
);

// =============================================================================
// ЗЕМЛЕТРЯСЕНИЕ (фаза 2) — кольцо r 3,3 ± 1,1 у ног (`f13_colquake`), обломки
// Стены по всей площади (`f13_coldebris`), трещина по линии разлома
// (`f13_colfault`) и обрушение её в пропасть (`f13_colrift`).
// Метка обломка: тень растёт и темнеет, камень падает с высоты с ускорением
// и касается земли ровно в миг урона; до падения с высоты сыплется крошка —
// «оттуда прилетит». Контакт: камень разбивается — куски, пыль, раскол.
// =============================================================================

registerZonePainter(
  'f13_colquake',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) =>
    ringMark(g, z, px, py, S, time, 1),
  ),
);

registerImpactPainter('f13_colquake', {
  life: 2.3,
  shake: 0.24,
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const cx = rec.x * S;
    const cy = rec.y * S;
    const p = new Pen(g, px, py, cx, cy);
    bandBlast(p, rec.seed, age, cx, cy, (rec.r ?? 3.3) * S, (rec.w ?? 1.1) * S, 0, TAU, 1);
    // Под ногами — раскол звездой: он ударил двумя ногами разом.
    const sd = rec.seed;
    const ck = scrack('quake', 5, S * 0.9, S * 1.5, 3, sd);
    drawCrack(
      p,
      ck,
      cx,
      cy + 3,
      ck.max * eOut3(k01(age / 0.16)),
      C.groove,
      C.lip,
      1 - k01((age - 1.2) / 0.5),
    );
  }),
});

/**
 * Кусок Стены: тёсаный блок со швами раствора, кувыркается (кадр f из 8).
 * Свет сверху-слева неподвижен — вертится камень, а не освещение.
 */
function blockImg(f: number, v: number): HTMLCanvasElement {
  return sprite(`bk${f & 7}|${v & 1}`, () => {
    const s = 17;
    const p = new Px(s, s);
    const c = s / 2;
    const th = ((f & 7) / 8) * Math.PI;
    const ca = Math.cos(th);
    const sa = Math.sin(th);
    const t = STONE_PAL[v & 1 ? 2 : 1];
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        const dx = x + 0.5 - c;
        const dy = y + 0.5 - c;
        const u = dx * ca + dy * sa;
        const w = -dx * sa + dy * ca;
        if (Math.abs(u) > 5.6 || Math.abs(w) > 3.9 || Math.abs(u) + Math.abs(w) > 8.4) continue;
        const seam = Math.abs(w + 0.2) < 0.5 || Math.abs(u - (w < 0 ? 1.4 : -2.4)) < 0.5;
        const l =
          0.42 +
          (-dx * 0.55 - dy * 0.83) / 9 +
          (hash(Math.floor(u + 7), Math.floor(w + 5), v) - 0.5) * 0.16;
        p.set(x, y, seam ? t[0] : l > 0.72 ? t[3] : l > 0.42 ? t[2] : l > 0.14 ? t[1] : t[0]);
      }
    p.outline(hx(C.ink));
    return p;
  });
}

/** Сколько летит кусок Стены (с), высота, с которой падает (пиксели). */
const FALL_T = 0.62;
const FALL_H = 104;

registerZonePainter(
  'f13_coldebris',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const st = z as Strike;
    const T = Math.max(0.01, st.warn);
    const t = Math.min(st.t, T);
    const k = k01(t / T);
    const left = T - t;
    const cx = st.x * S;
    const cy = st.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = st.r * S;
    const sd = pmod(st.id, 9973) + 1;
    const sig = left < SIG;
    const tk = !reduced() && tick(left);
    const fk = k01((t - (T - FALL_T)) / FALL_T);
    // «Куда»: круг с бегущей тёмно-красной кромкой.
    p.col(C.redDk, 0.18 + 0.12 * k);
    fillSector(p, cx, cy, 0, R, 0, TAU);
    const run = time * (20 + 40 * k);
    ring(p, cx, cy, R, C.ink, 0.6, undefined);
    ring(
      p,
      cx,
      cy,
      R - 1,
      sig ? (tk ? C.white : C.yellow) : C.redHot,
      0.7 + 0.3 * k,
      sig ? undefined : (ang) => pmod(ang * R + run, 8) < 5,
    );
    // Сходящееся кольцо в последние 0,4 с.
    if (left < 0.4)
      ring(
        p,
        cx,
        cy,
        R * (1 + 0.8 * (left / 0.4)),
        sig ? C.yellow : C.orange,
        0.8,
        (_a, i) => i % 3 !== 0,
        0.5,
      );
    // Тень камня: растёт и темнеет, пока он падает.
    const sh = 0.3 + 0.6 * fk;
    p.col(C.shadow, 0.14 + 0.5 * fk);
    shadowEll(p, cx, cy + 1, R * sh * 0.85, R * sh * 0.5, fk < 0.45);
    // До падения с высоты сыплется крошка — видно, откуда.
    if (fk <= 0 && !reduced()) {
      for (let i = 0; i < 3; i++) {
        const ph = pmod(st.t * 1.6 + i / 3, 1);
        const z0 = FALL_H * (1 - ph * ph);
        p.col('#8a8070', 0.9 * (1 - ph * 0.3));
        p.dot(cx + (hash(sd, i, 3) - 0.5) * 10, cy - z0);
      }
    }
    if (fk > 0) {
      // Камень: падает с ускорением, кувыркаясь; над ним — полосы скорости.
      const zf = FALL_H * (1 - fk * fk);
      const drift = (hash(sd, 1, 4) - 0.5) * 10 * (1 - fk);
      const im = blockImg(Math.floor(st.t * 13 + sd), sd & 1);
      const bx = cx + drift;
      const by = cy - zf - 4;
      const v = fk * 2;
      p.col('#d8d0c0', 0.5);
      p.dot(bx - 3, by - 8 - 6 * v, 1, Math.max(1, Math.round(6 * v)));
      p.dot(bx + 2, by - 9 - 8 * v, 1, Math.max(1, Math.round(8 * v)));
      p.col('#000', 1);
      p.img(im, bx - im.width / 2, by - im.height / 2);
      // Свита камешков рядом.
      for (let i = 0; i < 3; i++) {
        const lag = 0.08 + 0.06 * i;
        const fz = FALL_H * (1 - Math.max(0, fk - lag) ** 2);
        p.col(C.ink, 1);
        p.dot(bx + (hash(sd, i, 6) - 0.5) * 16 + 1, cy - fz - 2, 2, 2);
        p.col('#9a9286', 1);
        p.dot(bx + (hash(sd, i, 6) - 0.5) * 16, cy - fz - 3, 2, 2);
      }
    }
  }),
);

registerImpactPainter('f13_coldebris', {
  life: 1.45,
  shake: 0.08,
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const cx = rec.x * S;
    const cy = rec.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const sd = rec.seed;
    const few = reduced();
    const fade = 1 - k01((age - 1.0) / 0.45);
    const ck = scrack('deb', 5, 5, 11, 2, sd);
    drawCrack(p, ck, cx, cy, ck.max * eOut3(k01(age / 0.1)), C.groove, C.lip, fade);
    if (age < 0.08) {
      p.col(age < 0.035 ? C.white : C.yellow, 1);
      star(p, cx, cy - 3, 11 * (1 - 0.4 * (age / 0.08)), 6, 0.4);
    }
    if (age < 0.25) {
      const k = age / 0.25;
      ring(
        p,
        cx,
        cy,
        4 + 16 * eOut2(k),
        C.lip,
        0.85 * (1 - k),
        (_a, i) => hash(i >> 2, sd, 4) > 0.3,
        0.6,
      );
    }
    dust(p, sd, age, cx, cy, few ? 3 : 5, 0, Math.PI, 22, 20, 3, 8, 6, 0.95, (sd & 1) * 4, 0.9);
    stones(p, sd, age, cx, cy - 2, few ? 4 : 6, 0, Math.PI, 18, 34, 50, 60, 9, [1.0, 1.45], 0.5);
    // Что осталось: пара тёсаных обломков лежит у ямки.
    for (let i = 0; i < 2; i++) {
      const im = stoneImg(3 + i, i + (sd & 3), 1);
      p.col('#000', fade * k01(age / 0.15));
      p.img(im, cx + (i ? 3 : -6) - im.width / 2, cy + (i ? -1 : 2) - im.height / 2);
    }
  }),
});

// ---- Разлом площади и обрушение в пропасть ----------------------------------

interface FaultPath {
  /** Пиксели трещины (мир) и путь вдоль линии. */
  x: Int16Array;
  y: Int16Array;
  d: Float32Array;
  len: number;
  /** Середины клеток по порядку вдоль линии и их путь. */
  cx: number[];
  cy: number[];
  cd: number[];
}
const faultPaths = new WeakMap<object, FaultPath>();

/** Линия разлома: клетки по порядку, ломаная с изломами внутри клеток. */
function faultOf(z: FxZone, S: number): FaultPath | null {
  const cached = faultPaths.get(z);
  if (cached) return cached;
  const cells = z.cells;
  if (!cells?.length) return null;
  const W = z.ww ?? 64;
  const pts = cells.map((i) => [((i % W) + 0.5) * S, (Math.floor(i / W) + 0.5) * S]);
  let x0 = 1e9;
  let x1 = -1e9;
  let y0 = 1e9;
  let y1 = -1e9;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  const byX = x1 - x0 >= y1 - y0;
  pts.sort((a, b) => (byX ? a[0] - b[0] || a[1] - b[1] : a[1] - b[1] || a[0] - b[0]));
  const sd = cells[0] * 7 + cells.length;
  const px: [number, number, number][] = [];
  const seen = new Set<number>();
  let D = 0;
  const cd: number[] = [];
  let lx = pts[0][0];
  let ly = pts[0][1];
  pts.forEach(([x, y], j) => {
    // Излом внутри клетки: точка уходит вбок на 2–4 пикселя.
    const jx = (hash(sd, j, 1) - 0.5) * 7;
    const jy = (hash(sd, j, 2) - 0.5) * 7;
    const tx = x + jx;
    const ty = y + jy;
    const n = Math.max(1, Math.ceil(Math.hypot(tx - lx, ty - ly)));
    for (let s = 0; s <= n; s++) {
      const qx = Math.floor(lx + ((tx - lx) * s) / n);
      const qy = Math.floor(ly + ((ty - ly) * s) / n);
      const key = (qx + 4096) * 8192 + (qy + 4096);
      if (!seen.has(key)) {
        seen.add(key);
        px.push([qx, qy, D + (s / n) * Math.hypot(tx - lx, ty - ly)]);
      }
    }
    D += Math.hypot(tx - lx, ty - ly);
    cd.push(D);
    lx = tx;
    ly = ty;
  });
  const f: FaultPath = {
    x: Int16Array.from(px.map((q) => q[0])),
    y: Int16Array.from(px.map((q) => q[1])),
    d: Float32Array.from(px.map((q) => q[2])),
    len: Math.max(1, D),
    cx: pts.map((q) => q[0]),
    cy: pts.map((q) => q[1]),
    cd,
  };
  faultPaths.set(z, f);
  return f;
}

/**
 * Трещина по линии разлома (визуальная зона мозга в миг топота): бежит от
 * края до края за 0,35 с, у каждой клетки — фонтан пыли; дальше дышит
 * жаром всё чаще, края осыпаются внутрь — «сойди, сейчас рухнет».
 */
registerZonePainter(
  'f13_colfault',
  guarded((g, zz: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const z = zz as FxZone;
    const f = faultOf(z, S);
    if (!f) return;
    const t = z.t;
    const life = z.life || 1.85;
    const crackAt = life - 0.25;
    const p = new Pen(g, px, py, z.x * S, z.y * S);
    const sd = pmod(z.id, 9973) * 3 + 7;
    const reach = f.len * eOut2(k01(t / 0.35));
    const u = k01((t - 0.35) / (crackAt - 0.35));
    const wide = t > crackAt - 0.5 ? 1 : 0;
    // Кромка и жёлоб — по пути вдоль линии.
    p.col(C.lip, 0.75);
    for (let i = 0; i < f.x.length; i++) if (f.d[i] <= reach) p.dot(f.x[i] + 1, f.y[i] + 1);
    p.col(C.deep, 1);
    for (let i = 0; i < f.x.length; i++)
      if (f.d[i] <= reach) p.dot(f.x[i], f.y[i], 1 + wide, 1 + wide);
    // Жар из разлома: пульс всё чаще к обрушению.
    if (t > 0.35) {
      const ph = TAU * (1.6 * (t - 0.35) + 5 * u * u * u);
      const pulse = 0.5 + 0.5 * Math.sin(ph);
      p.col(C.fire[2], (0.25 + 0.55 * pulse) * (0.5 + 0.5 * u));
      for (let i = 0; i < f.x.length; i += 1) if ((i & 1) === 0) p.dot(f.x[i], f.y[i]);
    }
    // У каждой клетки — фонтан пыли, когда трещина её проходит (вся линия —
    // одно облако).
    const spurts: number[] = [];
    for (let j = 0; j < f.cx.length; j++) {
      const at = (0.35 * f.cd[j]) / f.len;
      const tj = t - at;
      if (tj < 0) continue;
      dust(
        p,
        sd + j * 5,
        tj,
        f.cx[j],
        f.cy[j],
        reduced() ? 1 : 2,
        -Math.PI / 2,
        1.2,
        8,
        8,
        2,
        6,
        10,
        0.8,
        0,
        0.8,
        0,
        undefined,
        spurts,
      );
      stones(
        p,
        sd + j * 5,
        tj,
        f.cx[j],
        f.cy[j],
        1,
        -Math.PI / 2,
        Math.PI,
        8,
        10,
        40,
        30,
        10,
        [0.6, 0.9],
        0,
      );
    }
    cloud(p, 0, spurts, 0.8);
    // Край осыпается внутрь: крошка скатывается в щель.
    if (u > 0.3 && !reduced()) {
      for (let j = 0; j < f.cx.length; j++) {
        for (let q = 0; q < 2; q++) {
          const ph = pmod(time * (1.5 + 2 * u) + hash(sd, j, q), 1);
          const side = q ? 1 : -1;
          p.col(q ? C.lip : '#8a7c62', 0.9 * (1 - ph));
          p.dot(f.cx[j] + side * (6 - 5 * ph), f.cy[j] + (hash(sd, j, q + 4) - 0.5) * 8 + 3 * ph);
        }
      }
    }
  }),
);

/**
 * Обрушение (визуальная зона мозга в миг, когда клетки стали пропастью):
 * плиты проваливаются, уменьшаясь и темнея, из щели встаёт пыль, со дна
 * поднимаются искры жара.
 */
registerZonePainter(
  'f13_colrift',
  guarded((g, zz: Zone | Strike, px: number, py: number, S: number) => {
    const z = zz as FxZone;
    const f = faultOf(z, S);
    if (!f) return;
    const t = z.t;
    const p = new Pen(g, px, py, z.x * S, z.y * S);
    const sd = pmod(z.id, 9973) * 9 + 1;
    const few = reduced();
    const plume: number[] = [];
    const soot: number[] = [];
    for (let j = 0; j < f.cx.length; j++) {
      for (let q = 0; q < (few ? 1 : 3); q++) {
        const delay = 0.12 * hash(sd, j * 3 + q, 1);
        const fk = k01((t - delay) / 0.7);
        if (fk >= 1) continue;
        const x = f.cx[j] + (hash(sd, j * 3 + q, 2) - 0.5) * 11;
        const y = f.cy[j] + (hash(sd, j * 3 + q, 3) - 0.5) * 9 + 14 * fk * fk;
        const im = slabImg(4 + (q % 3), Math.floor(t * 9 + q) & 3, j + q);
        p.col('#000', 1 - fk * 0.5);
        p.imgS(im, x, y, 1 - 0.85 * fk);
        if (fk > 0.2) {
          // Темнеет, уходя в глубину.
          p.col(C.deep, 0.8 * fk);
          const s = Math.max(1, Math.round(im.width * (1 - 0.85 * fk)));
          p.rect(Math.floor(x - s / 2), Math.floor(y - s / 3), s, Math.max(1, Math.round(s * 0.6)));
        }
      }
      dust(
        p,
        sd + j * 7,
        t - 0.05,
        f.cx[j],
        f.cy[j],
        few ? 1 : 2,
        -Math.PI / 2,
        Math.PI,
        6,
        8,
        3,
        9,
        24,
        1.4,
        j % 3 ? 0 : 3,
        0.8,
        0,
        undefined,
        j % 3 ? plume : soot,
      );
      sparks(
        p,
        sd + j,
        t - 0.2,
        f.cx[j],
        f.cy[j] + 2,
        few ? 0 : 2,
        -Math.PI / 2,
        0.6,
        4,
        6,
        0.9,
        70,
        40,
      );
    }
    // Пыль из щели — одним облаком на всю линию (было — облако на клетку).
    cloud(p, 0, plume, 0.8);
    cloud(p, 3, soot, 0.8);
  }),
);

// =============================================================================
// ШАГИ, НОГА, КОЛЕНИ — визуальные зоны мозга: пыль из-под подошвы, крошка
// трещин, плиты вздрагивают. Колосс весит — это видно по полу.
// =============================================================================

/** Пыль шага: клубы низко в стороны, трещинки под пяткой, камешки. */
registerZonePainter(
  'f13_colstep',
  guarded((g, zz: Zone | Strike, px: number, py: number, S: number) => {
    const z = zz as FxZone;
    const t = z.t;
    const cx = z.x * S;
    const cy = z.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const sd = pmod(z.id, 9973) * 7 + 3;
    const hot = (z.k ?? 0) >= 3;
    const fade = 1 - k01((t - 0.45) / 0.35);
    // Отпечаток: трещинки под пяткой.
    const ck = scrack('step', 4, 3, 6, 1, z.id);
    drawCrack(
      p,
      ck,
      cx,
      cy,
      ck.max * eOut3(k01(t / 0.08)),
      hot ? '#3a1408' : C.groove,
      null,
      0.75 * fade,
    );
    if (hot) {
      p.col(C.fire[2], 0.8 * (1 - k01(t / 0.6)));
      p.dot(cx - 1, cy);
      p.dot(cx + 2, cy - 1);
    }
    // Клубы низко в стороны — пыль выдавлена из-под подошвы.
    dust(
      p,
      sd,
      t,
      cx,
      cy + 1,
      reduced() ? 2 : 5,
      0,
      Math.PI,
      16,
      12,
      2,
      6,
      3,
      0.75,
      hot ? 3 : 0,
      0.85,
    );
    stones(
      p,
      sd,
      t,
      cx,
      cy,
      reduced() ? 1 : 3,
      -Math.PI / 2,
      Math.PI,
      10,
      14,
      30,
      30,
      0,
      [0.5, 0.8],
      0,
    );
  }),
);

/** Нога топота опустилась: кольцо пыли у ног, раскол под подошвой. */
registerZonePainter(
  'f13_colplant',
  guarded((g, zz: Zone | Strike, px: number, py: number, S: number) => {
    const z = zz as FxZone;
    const t = z.t;
    const cx = z.x * S;
    const cy = z.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const sd = pmod(z.id, 9973) * 11 + 5;
    const R = z.r * S;
    const fade = 1 - k01((t - 0.7) / 0.4);
    const ck = scrack('plant', 6, R * 0.35, R * 0.7, 2, z.id);
    drawCrack(p, ck, cx, cy, ck.max * eOut3(k01(t / 0.1)), C.groove, C.lip, fade);
    if (t < 0.25) {
      const k = t / 0.25;
      ring(
        p,
        cx,
        cy,
        R * (0.3 + 0.9 * eOut2(k)),
        C.lip,
        0.85 * (1 - k),
        (_a, i) => hash(i >> 2, sd, 4) > 0.3,
        0.6,
      );
    }
    dust(p, sd, t, cx, cy, reduced() ? 4 : 10, 0, Math.PI, 30, 20, 3, 9, 6, 1, 0, 0.9);
  }),
);

/**
 * Пыль, что ставил мозг и раньше (`puff` топота и землетрясения): оседающая
 * мгла у земли — низкие клубы расходятся кольцом. Контакт удара рисует
 * своё, это — хвост, что держится дольше.
 */
registerZonePainter(
  'f13_coldust',
  guarded((g, zz: Zone | Strike, px: number, py: number, S: number) => {
    const z = zz as FxZone;
    const life = z.life || 1;
    const t = z.t;
    const p = new Pen(g, px, py, z.x * S, z.y * S);
    const R = z.r * S;
    const sd = pmod(z.id, 9973) * 13 + 1;
    const n = reduced() ? 4 : Math.min(18, Math.round(6 + R / 5));
    const haze: number[] = [];
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * TAU + hash(sd, i, 1) * 0.5;
      const L = life * (0.7 + 0.3 * hash(sd, i, 2));
      if (t >= L) continue;
      const k = t / L;
      const d = R * (0.35 + 0.5 * eOut2(k)) * (0.7 + 0.4 * hash(sd, i, 3));
      haze.push(
        z.x * S + Math.cos(ang) * d,
        z.y * S + Math.sin(ang) * d * 0.8 - 3 * k,
        R * 0.08 + 2 + 3 * eOut2(k),
        k,
        i,
      );
    }
    cloud(p, 0, haze, 0.8);
  }),
);

// =============================================================================
// ВЫБРОС ПАРА (фаза 1) — зона r 3,4: 0,8 с предупреждения, потом 2,2 с жжёт
// (`f13_ventburst`). Метка: давление — пар со всей площадки втягивается к
// нему по спирали, по кромке шипят свищи, налив от тела к кромке; в
// последние 0,2 с кромка белеет. Выброс: белая волна до края, тор пара
// катится наружу и встаёт, пол мокрый и горячий, по кромке весь срок
// поднимаются струйки — видно, докуда жжёт.
// =============================================================================

/** Рваная волна (двойная кромка) — фронт выброса пара, жара, удара. */
function shockRing(
  p: Pen,
  cx: number,
  cy: number,
  r: number,
  c: string,
  a: number,
  sd: number,
): void {
  ring(p, cx, cy, r, c, a, (_ang, i) => hash(i >> 2, sd, 9) > 0.2, 0.55);
  ring(p, cx, cy, r - 2, c, a * 0.5, (_ang, i) => hash(i >> 2, sd, 10) > 0.5);
}

registerZonePainter(
  'f13_ventburst',
  guarded((g, zz: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const z = zz as Zone;
    const warn = z.warn ?? 0.8;
    const cx = z.x * S;
    const cy = z.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = z.r * S;
    const sd = pmod(z.id, 9973) * 7 + 3;
    const few = reduced();
    if (z.t < warn) {
      const k = k01(z.t / warn);
      const left = warn - z.t;
      const sig = left < SIG;
      const tk = !few && tick(left);
      p.col('#ffb090', 0.1 + 0.1 * k);
      fillSector(p, cx, cy, S * 0.9, R, 0, TAU);
      const rf = S * 0.9 + (R - S * 0.9) * Math.pow(k, 1.6);
      p.col(sig ? C.white : '#ffd8c0', (tk ? 0.55 : 0.22) + 0.12 * k);
      fillSector(p, cx, cy, S * 0.9, rf, 0, TAU);
      ring(p, cx, cy, rf, C.white, 0.6 + 0.4 * k, (_a, i) => hash(i >> 2, sd, 3) > 0.25, 0.5);
      // Кромка: пунктир бежит по кругу, к выбросу — быстрее.
      const run = time * (25 + 50 * k);
      ring(p, cx, cy, R + 1, C.ink, 0.55);
      ring(
        p,
        cx,
        cy,
        R,
        sig ? (tk ? C.white : C.yellow) : C.orange,
        0.8 + 0.2 * k,
        sig ? undefined : (ang) => pmod(ang * R + run, 9) < 6,
      );
      // Давление: струйки пара втягиваются к нему по спирали.
      if (!few)
        for (let i = 0; i < 10; i++) {
          const u = pmod(z.t * (0.9 + 1.4 * k) + i / 10, 1);
          const ang = (i / 10) * TAU + u * 1.4 + hash(sd, i, 1) * 6;
          const rr = R * (1 - u) + S * 0.8 * u;
          club(
            p,
            1,
            1.5 + 2 * (1 - u),
            i,
            cx + Math.cos(ang) * rr,
            cy + Math.sin(ang) * rr - 3 * u,
            0.3 + 0.5 * u,
            0.85,
          );
        }
      // Свищи по кромке — всё чаще.
      for (let i = 0; i < 9; i++) {
        if (hash(sd, i, 4) > 0.25 + 0.75 * k) continue;
        const ph = pmod(z.t * (1.5 + 3 * k) + hash(sd, i, 5), 1);
        const ang = hash(sd, i, 6) * TAU;
        const rr = R * (0.75 + 0.25 * hash(sd, i, 7));
        club(
          p,
          1,
          1 + 3 * ph,
          i,
          cx + Math.cos(ang) * rr,
          cy + Math.sin(ang) * rr - 10 * ph,
          ph,
          0.9,
        );
      }
      hops(p, sd, time, k, 16, (i) => {
        const rr = S + (R - S) * hash(i, 5, sd);
        const aa = TAU * hash(i, 6, sd);
        return [cx + Math.cos(aa) * rr, cy + Math.sin(aa) * rr];
      });
      return;
    }
    // Выброс.
    const t = z.t - warn;
    const life = z.life;
    const fe = k01((life - t) / 0.5);
    // Мокрый горячий пол — весь срок, пока жжёт; по кромке бегут струйки.
    p.col('#ffc8b0', 0.2 * fe);
    fillSector(p, cx, cy, S * 0.6, R, 0, TAU);
    ring(p, cx, cy, R, '#fff0e6', 0.75 * fe, (ang) => pmod(ang * R + time * 12, 7) < 4.5, 0.45);
    if (t < 0.07) {
      p.col(C.white, 0.55 * (1 - t / 0.07));
      fillSector(p, cx, cy, 0, R, 0, TAU);
    }
    if (t < 0.24) {
      const k = t / 0.24;
      shockRing(p, cx, cy, S + (R * 1.12 - S) * eOut2(k), C.white, 1 - k, sd);
    }
    // У кромки — низкая полоса пара весь срок: видно, докуда жжёт.
    const nW = few ? 10 : 26;
    const edge: number[] = [];
    for (let i = 0; i < nW; i++) {
      const ph = pmod(t * 0.9 + hash(sd, i, 13), 1);
      const ang = ((i + 0.5 * hash(sd, i, 14)) / nW) * TAU + t * 0.15;
      const rr = R * (0.9 + 0.12 * hash(sd, i, 15));
      edge.push(
        cx + Math.cos(ang) * rr,
        cy + Math.sin(ang) * rr - 2 - 8 * ph,
        3 + 3 * ph,
        Math.max(ph * 0.55, 1 - fe),
        i,
      );
    }
    cloud(p, 1, edge, 0.85 * fe);
  }),
);

/**
 * Облако выброса пара (поверх темноты, ставит мозг в миг выброса): тор
 * горячего пара катится от тела наружу и встаёт, потом белеет и редеет;
 * клубы за спиной Колосса заслонены его телом.
 */
registerZonePainter(
  'f13_colvent',
  guarded((g, zz: Zone | Strike, px: number, py: number, S: number) => {
    const z = zz as Zone;
    const t = z.t;
    const cx = z.x * S;
    const cy = z.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = z.r * S;
    const sd = pmod(z.id, 9973) * 5 + 17;
    const few = reduced();
    const fe = k01((z.life - t) / 0.7);
    const hidden = screenOf(S);
    const hot: number[] = [];
    const white: number[] = [];
    const n = few ? 12 : 36;
    for (let i = 0; i < n; i++) {
      const tt = t - 0.05 * hash(sd, i, 9);
      const L = 1.3 + 0.7 * hash(sd, i, 10);
      if (tt < 0 || tt >= L) continue;
      const kk = tt / L;
      const ang = hash(sd, i, 8) * TAU;
      const far = 0.3 + 0.7 * Math.sqrt(hash(sd, i, 11));
      const rr = R * far * (0.25 + 0.75 * eOut3(k01(tt / 0.4)));
      const gx = cx + Math.cos(ang) * rr;
      const gy = cy + Math.sin(ang) * rr * 0.85;
      const zz2 = (4 + 30 * (1 - far) + 10 * hash(sd, i, 12)) * eOut2(kk) + 3;
      const y = gy - zz2;
      if (hidden(gx, y, gy)) continue;
      const r =
        (3 + 7 * eOut2(k01(tt / 0.35))) * (0.6 + 0.7 * hash(sd, i, 13)) * (1.15 - 0.3 * far);
      (tt < 0.14 ? hot : white).push(gx, y, r, Math.max(kk, 1 - fe), i);
    }
    cloud(p, 1, white, 0.9 * fe);
    cloud(p, 2, hot, 0.95);
  }),
);

/**
 * Выход из земли (вход боя, 2,6 с, визуальная зона мозга): площадь
 * раскалывается звездой, под ним — яма, мостовая разлетается, из трещин
 * бьют гейзеры, вокруг встаёт столб пара; к концу всё оседает.
 */
registerZonePainter(
  'f13_colrise',
  guarded((g, zz: Zone | Strike, px: number, py: number, S: number) => {
    const z = zz as Zone;
    const t = z.t;
    const cx = z.x * S;
    const cy = z.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const sd = pmod(z.id, 9973) * 3 + 11;
    const few = reduced();
    const life = z.life || 2.6;
    const fe = 1 - k01((t - (life - 0.55)) / 0.55);
    const ck = scrack('rise', 9, S * 1.6, S * 3, 3, 0);
    drawCrack(p, ck, cx, cy + 2, ck.max * eOut3(k01(t / 0.35)), C.groove, C.lip, fe);
    const hr = S * 1.35 * eOut3(k01(t / 0.25));
    p.col(C.lip, 0.7 * fe);
    shadowEll(p, cx + 1, cy + 3, hr, hr * 0.45);
    p.col(C.deep, 0.92 * fe);
    shadowEll(p, cx, cy + 2, hr, hr * 0.42);
    if (t < 0.3) shockRing(p, cx, cy, S + S * 3.4 * eOut2(t / 0.3), C.white, 1 - t / 0.3, sd);
    stones(
      p,
      sd,
      t,
      cx,
      cy,
      few ? 6 : 14,
      -Math.PI / 2,
      Math.PI,
      30,
      50,
      80,
      100,
      10,
      [1.8, 2.4],
      0.5,
    );
    // Гейзеры из концов трещин — пульсируют.
    const br = starBranches(pmod(0, 4) * 977 + 4 * 31 + 9, 9, 0, S * 1.6, S * 3, 3);
    const gey: number[] = [];
    for (let j = 0; j < 4; j++) {
      const [a, L] = br[j * 2];
      const gx = cx + Math.cos(a) * L * 0.7;
      const gy = cy + 2 + Math.sin(a) * L * 0.7;
      const t0 = 0.15 + j * 0.1;
      if (t < t0) continue;
      // Струя встаёт рывком и бьёт, пока он поднимается.
      const H = 52 * eOut2(k01((t - t0) / 0.15));
      for (let q = 0; q < (few ? 4 : 9); q++) {
        const hq = pmod(t * 1.9 + q / 9 + j * 0.27, 1);
        gey.push(
          gx + Math.sin(q + t * 6) * (1 + 2 * hq),
          gy - 4 - H * hq,
          2.5 + 5 * hq,
          Math.max(hq * hq, 1 - fe),
          q + j * 9,
        );
      }
    }
    cloud(p, 1, gey, 0.9);
    // Столб пара вокруг — встаёт вместе с ним.
    dust(
      p,
      sd + 1,
      t,
      cx,
      cy,
      few ? 6 : 14,
      -Math.PI / 2,
      Math.PI,
      18,
      16,
      5,
      12,
      46,
      1.6,
      1,
      0.85,
      1.4,
    );
    dust(p, sd + 2, t, cx, cy + 2, few ? 4 : 10, 0, Math.PI, 40, 30, 3, 8, 6, 0.9, 0, 0.9);
  }),
);

// =============================================================================
// БРОСОК ГЛЫБЫ (фаза ≥ 2, издали): замах 1,1 с, глыба навесом
// (`f13_colrock`), по месту падения — завал (`f13_colrubble`, вязнешь).
// Замах: он вырывает кусок мостовой — под ногами яма, с поднятой глыбы
// сыплется крошка (`f13_colrip`). Полёт: глыба кладки вертится, с неё
// сыплются камешки, на земле — её тень и метка падения со сходящимся
// кольцом (`f13_colaim`). Контакт: глыба лопается — куски с отскоком,
// пыль, раскол, и каменный дождь: подброшенная крошка падает вокруг ещё
// с секунду.
// =============================================================================

const BOULDER_R = 10;
const BOULDER_T: RGBA[] = [hx('#241c18'), hx('#4a3e36'), hx('#766858'), hx('#a8987e')];

/** Неровный контур, что вертится вместе с камнем: 0…1 по углу. */
const lumps = (a: number) =>
  0.5 + 0.25 * Math.sin(3 * a + 1.3) + 0.15 * Math.sin(5 * a + 0.4) + 0.1 * Math.sin(2 * a + 2);

/**
 * Глыба кладки (кадр f из 16): швы раствора и неровный край вертятся,
 * свет сверху-слева стоит — вертится камень, а не освещение.
 */
function boulderImg(f: number): HTMLCanvasElement {
  return sprite(`bd${f & 15}`, () => {
    const R = BOULDER_R;
    const s = 2 * R + 4;
    const p = new Px(s, s);
    const c = s / 2;
    const th = ((f & 15) / 16) * TAU;
    const ca = Math.cos(th);
    const sa = Math.sin(th);
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        const dx = x + 0.5 - c;
        const dy = y + 0.5 - c;
        const d = Math.hypot(dx, dy);
        const u = dx * ca + dy * sa;
        const w = -dx * sa + dy * ca;
        if (d > R * (0.82 + 0.18 * lumps(Math.atan2(w, u)))) continue;
        const nz = Math.sqrt(Math.max(0, 1 - (d / R) ** 2));
        let l = ((-dx * 0.5 - dy * 0.75) / R) * 0.8 + nz * 0.55 - 0.12;
        const row = Math.floor((w + 20) / 4.5);
        const off = row % 2 ? 2.5 : 0;
        if (pmod(w + 20, 4.5) < 0.9 || pmod(u + 20 + off, 6) < 0.9) l -= 0.45;
        l += (hash(Math.floor(u + 20), Math.floor(w + 20), 3) - 0.5) * 0.14;
        p.set(
          x,
          y,
          l > 0.55
            ? BOULDER_T[3]
            : l > 0.2
              ? BOULDER_T[2]
              : l > -0.15
                ? BOULDER_T[1]
                : BOULDER_T[0],
        );
      }
    p.outline(hx(C.ink));
    return p;
  });
}

registerShotPainter('f13_colrock', (s: Shot): Sprite => {
  // Вертится по ходу полёта: летит влево — против часовой.
  const f = Math.floor(s.age * 20 + s.id);
  const img = boulderImg(s.vx < 0 ? 15 - (f & 15) : f);
  const c = img.width / 2;
  return { img, ax: c, ay: c + BOULDER_R * 0.75 };
});

/** Высота навеса (клетки) — как у движка (`stepShots`). */
const lobZ = (k: number, T: number) => Math.sin(k * Math.PI) * Math.min(3, T * 2.2);

registerZonePainter(
  'f13_colaim',
  guarded((g, zz: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const z = zz as FxZone;
    const T = Math.max(0.05, z.k ?? z.life);
    const t = Math.min(z.t, T);
    const k = k01(t / T);
    const left = T - t;
    const cx = z.x * S;
    const cy = z.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = z.r * S;
    const sig = left < SIG;
    const tk = !reduced() && tick(left);
    const sx = (z.sx ?? z.x) * S;
    const sy = (z.sy ?? z.y) * S;
    // «Куда»: круг удара, кромка бежит.
    p.col(C.redDk, 0.2 + 0.14 * k);
    fillSector(p, cx, cy, 0, R, 0, TAU);
    ring(p, cx, cy, R + 1, C.ink, 0.6);
    ring(
      p,
      cx,
      cy,
      R,
      sig ? (tk ? C.white : C.yellow) : C.redHot,
      0.75 + 0.25 * k,
      sig ? undefined : (ang) => pmod(ang * R + time * 40, 8) < 5,
    );
    // «Когда»: кольцо сходится к кромке ровно к падению.
    ring(
      p,
      cx,
      cy,
      R * (1 + 1.6 * Math.pow(1 - k, 1.4)),
      sig ? C.yellow : C.orange,
      0.85,
      (_a, i) => i % 4 !== 0,
      0.55,
    );
    // Тень глыбы бежит по земле под ней и темнеет, снижаясь.
    const gx = sx + (cx - sx) * k;
    const gy = sy + (cy - sy) * k;
    const zf = lobZ(k, T) / 3;
    p.col(C.shadow, 0.25 + 0.45 * (1 - zf));
    shadowEll(p, gx, gy + 1, 7 * (1 - 0.3 * zf), 3 * (1 - 0.3 * zf), zf > 0.5);
    // С глыбы сыплются камешки: каждый падает с высоты, где её оставил.
    if (!reduced())
      for (let i = 0; i < 9; i++) {
        const ti = ((i + 0.5) / 9) * T * 0.9;
        if (z.t < ti) continue;
        const ki = ti / T;
        const x = sx + (cx - sx) * ki + (hash(i, 3, 41) - 0.5) * 8;
        const y = sy + (cy - sy) * ki + (hash(i, 4, 41) - 0.5) * 4;
        const z0 = lobZ(ki, T) * S;
        const dt = z.t - ti;
        const zz2 = z0 - 0.5 * 520 * dt * dt;
        if (zz2 < -0.5 && dt > 0.6) continue;
        p.col(C.ink, 0.5);
        p.dot(x + 1, y - Math.max(0, zz2) + 1, 2, 2);
        p.col('#8a7c6a', 1);
        p.dot(x, y - Math.max(0, zz2), 2, 2);
      }
  }),
);

registerImpactPainter('f13_colrock', {
  life: 2.0,
  shake: 0.32,
  flash: 0.25,
  flashRgb: '255,236,210',
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const cx = rec.x * S;
    const cy = rec.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const sd = rec.seed;
    const few = reduced();
    const fade = 1 - k01((age - 1.3) / 0.6);
    const va = Math.atan2(rec.vy ?? 0, rec.vx ?? 1);
    const ck = scrack('rock', 6, 8, 18, 3, sd);
    drawCrack(p, ck, cx, cy, ck.max * eOut3(k01(age / 0.12)), C.groove, C.lip, fade);
    p.col(C.lip, 0.7 * fade);
    lens(p, cx + 1, cy + 1, 1, 0, 9, 4.5);
    p.col(C.deep, 0.9 * fade);
    lens(p, cx, cy, 1, 0, 8.5, 4);
    if (age < 0.09) {
      p.col(age < 0.04 ? C.white : C.yellow, 1);
      star(p, cx, cy - 4, 16 * (1 - 0.45 * (age / 0.09)), 8, 0.3);
    }
    if (age < 0.3) {
      const k = age / 0.3;
      shockRing(p, cx, cy, 6 + 30 * eOut2(k), C.white, 0.95 * (1 - k), sd);
    }
    // Куски глыбы — по ходу полёта и в стороны, с отскоком; крупные — кладка.
    stones(p, sd, age, cx, cy - 3, few ? 4 : 10, va, 1.4, 34, 44, 70, 60, 9, [1.4, 2.0], 0.75);
    stones(
      p,
      sd + 3,
      age,
      cx,
      cy - 3,
      few ? 2 : 6,
      va + Math.PI,
      1.2,
      18,
      24,
      60,
      40,
      1,
      [1.3, 1.9],
      0.5,
    );
    // Каменный дождь: крошка подброшена высоко и падает вокруг ещё с секунду,
    // у каждой — пыльца в миг падения.
    for (let i = 0; i < (few ? 5 : 16); i++) {
      const th = hash(sd, i, 51) * TAU;
      const v = 14 + 28 * hash(sd, i, 52);
      const vz = 150 + 90 * hash(sd, i, 53);
      const T = (2 * vz) / 430;
      const t = Math.min(age, T);
      const gx = cx + Math.cos(th) * v * t;
      const gy = cy + Math.sin(th) * v * t * 0.8;
      if (age < T) {
        const z = vz * t - 215 * t * t;
        p.col(C.ink, 0.35);
        p.dot(gx, gy + 1, 2, 1);
        p.col(i % 3 ? '#9a8c78' : '#6e3222', 1);
        p.dot(gx, gy - z, i % 4 ? 1 : 2, i % 4 ? 2 : 2);
      } else if (age < T + 0.35) {
        const k = (age - T) / 0.35;
        club(p, 0, 1.5 + 2 * k, i, gx, gy - 2 * k, k, 0.9);
        p.col('#6e6458', fade);
        p.dot(gx, gy);
      } else {
        p.col('#6e6458', fade);
        p.dot(gx, gy);
      }
    }
    dust(p, sd, age, cx, cy, few ? 5 : 16, 0, Math.PI, 34, 30, 4, 11, 12, 1.15, 0, 0.95);
  }),
});

/** Завал на месте падения: куча кладки, гравий до края (там вязнешь). */
function heapImg(v: number): HTMLCanvasElement {
  return sprite(`hp${v % 3}`, () => {
    const W = 44;
    const H = 26;
    const p = new Px(W, H);
    const tones = [STONE_PAL[1], STONE_PAL[3], STONE_PAL[2], BOULDER_T];
    const blob = (x0: number, y0: number, r: number, t: RGBA[]) => {
      for (let y = Math.floor(y0 - r); y <= Math.ceil(y0 + r); y++)
        for (let x = Math.floor(x0 - r * 1.2); x <= Math.ceil(x0 + r * 1.2); x++) {
          const dx = (x + 0.5 - x0) / (r * 1.2);
          const dy = (y + 0.5 - y0) / r;
          if (dx * dx + dy * dy > 1) continue;
          const l = -dx * 0.6 - dy * 0.8 + 0.25;
          p.set(x, y, l > 0.65 ? t[3] : l > 0.1 ? t[2] : l > -0.5 ? t[1] : t[0]);
        }
    };
    const n = 18;
    // От краёв к середине: середина выше и рисуется последней.
    const order = Array.from({ length: n }, (_, i) => i).sort(
      (a, b) => hash(b, v, 2) - hash(a, v, 2),
    );
    for (const i of order) {
      const a = hash(i, v, 1) * TAU;
      const d = Math.sqrt(hash(i, v, 2));
      const x = 22 + Math.cos(a) * 16 * d;
      const y = 17 + Math.sin(a) * 6 * d - (1 - d) * 7;
      blob(x, y, 2 + 2.6 * hash(i, v, 5) * (1.2 - d * 0.5), tones[(i + v) % 4]);
    }
    p.outline(hx(C.ink));
    return p;
  });
}

registerZonePainter(
  'f13_colrubble',
  guarded((g, zz: Zone | Strike, px: number, py: number, S: number) => {
    const z = zz as Zone;
    const t = z.t;
    const cx = z.x * S;
    const cy = z.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = z.r * S;
    const sd = pmod(z.id, 9973) * 5 + 2;
    const fe = k01((z.life - t) / 0.5);
    // Гравий до края завала — видно, где вязнешь.
    for (let i = 0; i < 26; i++) {
      const a = hash(sd, i, 1) * TAU;
      const d = R * (0.45 + 0.55 * Math.sqrt(hash(sd, i, 2)));
      const x = cx + Math.cos(a) * d;
      const y = cy + Math.sin(a) * d * 0.8;
      p.col(C.ink, 0.5 * fe);
      p.dot(x + 1, y + 1);
      p.col(i % 3 ? '#8a7c6a' : '#6e3222', fe);
      p.dot(x, y, i % 4 ? 1 : 2, 1);
    }
    const im = heapImg(pmod(z.id, 3));
    p.col('#000', fe);
    p.img(im, cx - im.width / 2, cy - im.height + 9);
    dust(p, sd, t, cx, cy, reduced() ? 2 : 6, 0, Math.PI, 10, 12, 4, 8, 7, 0.8, 0, 0.75);
  }),
);

/**
 * Замах броска (визуальная зона мозга, 1,1 с): он выломал кусок мостовой —
 * под ногами яма и раскол, пыль; с поднятой над головой глыбы сыплется
 * крошка и бьётся о землю у ног.
 */
registerZonePainter(
  'f13_colrip',
  guarded((g, zz: Zone | Strike, px: number, py: number, S: number) => {
    const z = zz as FxZone;
    const t = z.t;
    const cx = z.x * S;
    const cy = z.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const sd = pmod(z.id, 9973) * 13 + 7;
    const fe = 1 - k01((t - (z.life - 0.4)) / 0.4);
    const ck = scrack('rip', 5, 6, 12, 2, z.id);
    drawCrack(p, ck, cx, cy + 3, ck.max * eOut3(k01(t / 0.12)), C.groove, C.lip, fe);
    p.col(C.lip, 0.6 * fe);
    shadowEll(p, cx + 1, cy + 4, 8, 3.5);
    p.col(C.deep, 0.85 * fe);
    shadowEll(p, cx, cy + 3, 7.5, 3);
    dust(p, sd, t, cx, cy + 2, reduced() ? 3 : 8, 0, Math.PI, 26, 20, 3, 8, 8, 0.9, 0, 0.9);
    // Крошка с глыбы над головой (≈ 70 пикселей вверх).
    if (!reduced())
      for (let i = 0; i < 8; i++) {
        const t0 = 0.12 + i * 0.11;
        const dt = t - t0;
        if (dt < 0) continue;
        const z0 = 68 - 0.5 * 420 * dt * dt;
        const x =
          cx + (hash(sd, i, 1) - 0.5) * 16 + (z.ang !== undefined ? Math.cos(z.ang) * 3 : 0);
        const y = cy + (hash(sd, i, 2) - 0.3) * 6;
        if (z0 > 0) {
          p.col(C.ink, 0.5);
          p.dot(x + 1, y - z0 + 1, 2, 2);
          p.col('#8a7c6a', 1);
          p.dot(x, y - z0, 2, 2);
        } else if (dt < 0.9) {
          const k = k01((-z0 / 420) * 4);
          if (k < 1) club(p, 0, 1.5 + 1.5 * k, i, x, y - 1, k, 0.85);
        }
      }
  }),
);

// =============================================================================
// КОЛЬЦА ПАРА (фаза 3) — четыре кольца r 2,6/4,6/6,6/8,6 ± 0,7, каждое
// бьёт через 0,32 с после прошлого (`f13_steamring`). Метка: все четыре
// полосы видны сразу; от него идёт ОДНА волна пара со скоростью 2 клетки на
// 0,32 с и касается каждой полосы ровно в миг её удара — видно, где волна
// сейчас и куда успеешь шагнуть. Перед волной он втягивает пар в себя.
// Контакт: по кольцу встаёт стена горячего пара, пол мокрый.
// =============================================================================

const RING_V = 2 / COL.rings.gap;

registerZonePainter(
  'f13_steamring',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const st = z as Strike;
    const T = Math.max(0.01, st.warn);
    const t = Math.min(st.t, T);
    const left = T - t;
    const cx = st.x * S;
    const cy = st.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const r = st.r;
    const w = st.w ?? 0.7;
    const sd = pmod(st.id, 9973) + 3;
    const sig = left < SIG;
    const tk = !reduced() && tick(left);
    const rf = r - left * RING_V;
    const near = k01(1 - (r - rf) / 2);
    // Большие кольца — пол-экрана: налив сдержанный, иначе вспышка на весь кадр.
    const big = r > 5 ? 0.6 : 1;
    p.col(sig ? '#ff8a5a' : '#ffb894', (0.1 + 0.26 * near + (tk ? 0.18 : 0)) * big);
    fillSector(p, cx, cy, (r - w) * S, (r + w) * S, 0, TAU);
    const run = time * 18 * (1 + 2 * near);
    for (const rr of [r - w, r + w]) {
      ring(p, cx, cy, rr * S + (rr > r ? 1 : -1), C.ink, 0.45);
      ring(
        p,
        cx,
        cy,
        rr * S,
        sig ? (tk ? C.white : C.yellow) : near > 0.5 ? C.orange : '#ffe0d0',
        0.6 + 0.4 * near,
        sig ? undefined : (ang) => pmod(ang * rr * S + run, 10) < 6,
      );
    }
    // Волна: у каждой полосы — свой отрезок пути (от прошлой до неё).
    const own = r < 3 ? rf > 0.25 : rf > r - 2;
    if (own && rf <= r) {
      const R = rf * S;
      shockRing(p, cx, cy, R, C.white, 0.9, sd);
      // Гребень волны: низкий вал пара бежит по полу.
      const n = Math.max(8, Math.round((TAU * R) / (reduced() ? 18 : 8)));
      const crest: number[] = [];
      for (let i = 0; i < n; i++) {
        const ang = ((i + 0.6 * hash(sd, i, 1)) / n) * TAU;
        const rr = R - 2 * hash(sd, i, 5);
        crest.push(
          cx + Math.cos(ang) * rr,
          cy + Math.sin(ang) * rr - 3 - 2 * hash(sd, i, 6),
          2.5 + 2 * hash(sd, i, 2),
          0.1,
          i,
        );
      }
      cloud(p, 1, crest, 0.85);
    }
    // Перед волной он втягивает пар в себя.
    if (r < 3 && rf < 0.25 && !reduced()) {
      const draw: number[] = [];
      for (let i = 0; i < 14; i++) {
        const u = pmod(st.t * 2 + i / 14, 1);
        const ang = (i / 14) * TAU + hash(sd, i, 3) * 2;
        const rr = S * (2.6 - 1.8 * u);
        draw.push(
          cx + Math.cos(ang) * rr,
          cy + Math.sin(ang) * rr - 6 * u,
          1.5 + 2.5 * (1 - u),
          0.2 + 0.6 * u,
          i,
        );
      }
      cloud(p, 1, draw, 0.85);
    }
  }),
);

registerImpactPainter('f13_steamring', {
  life: 1.3,
  shake: 0.07,
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const cx = rec.x * S;
    const cy = rec.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const r = (rec.r ?? 2.6) * S;
    const w = (rec.w ?? 0.7) * S;
    const sd = rec.seed;
    const few = reduced();
    const fade = 1 - k01((age - 0.8) / 0.5);
    p.col(C.wet, 0.3 * fade);
    fillSector(p, cx, cy, r - w, r + w, 0, TAU);
    if (age < 0.07) {
      p.col(C.white, 0.7 * (1 - age / 0.07));
      fillSector(p, cx, cy, r - w, r + w, 0, TAU);
    }
    if (age < 0.2)
      shockRing(p, cx, cy, r + w * eOut2(age / 0.2) * 1.4, '#fff0e0', 1 - age / 0.2, sd);
    // Стена горячего пара по кольцу: встаёт, белеет, редеет.
    // Два яруса: низ — плотный вал у пола, верх — клубы встают выше.
    const n = Math.max(14, Math.round((TAU * r) / (few ? 14 : 6)));
    const hot: number[] = [];
    const white: number[] = [];
    for (let i = 0; i < n; i++) {
      const up = i % 2;
      const ang = ((i + hash(sd, i, 4)) / n) * TAU;
      const rr = r + (hash(sd, i, 5) - 0.5) * w * 1.3;
      const t = age - 0.05 * hash(sd, i, 6);
      const L = (up ? 0.75 : 0.95) * (0.8 + 0.4 * hash(sd, i, 7));
      if (t < 0 || t >= L) continue;
      const kk = t / L;
      const lift = up ? 8 + (12 + 10 * hash(sd, i, 9)) * eOut2(kk) : 2 + 4 * eOut2(kk);
      (kk < 0.28 ? hot : white).push(
        cx + Math.cos(ang) * (rr + 5 * eOut2(kk)),
        cy + Math.sin(ang) * (rr + 5 * eOut2(kk)) - lift,
        (up ? 3 : 4.5) + (up ? 3 : 3.5) * eOut2(k01(t / 0.35)) * (0.7 + 0.5 * hash(sd, i, 8)),
        kk,
        i,
      );
    }
    cloud(p, 1, white, 0.9);
    cloud(p, 2, hot, 0.95);
  }),
});

// =============================================================================
// ПЛАЩ ПАРА (фаза 1) — зона r 2,4 ходит за ним поверх темноты (`f13_cloak`):
// пар кружит вокруг тела, гуще у затылка; у земли — кольцо горячего пара
// (докуда жжёт). Крюк сорвал (`bareT`): клубы разлетаются, у затылка —
// белый хлопок; пока голый — только редкие струйки; за 0,6 с до конца пар
// стягивается обратно — «сейчас затянет».
// =============================================================================

registerZonePainter(
  'f13_cloak',
  guarded((g, zz: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const z = zz as Zone;
    const m = colossus();
    const cx = z.x * S;
    const cy = z.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = z.r * S;
    const sd = pmod(z.id, 9973) + 5;
    const few = reduced();
    const hidden = screenOf(S);
    const bareT = m?.data.bareT ?? 0;
    const bare = bareT > 0;
    const tear = COL.bare - bareT;
    const form = eOut2(k01(z.t / 0.8));
    // Плотность: сорван — пусто, за 0,6 с до конца — стягивается обратно.
    const back = bare && bareT < 0.6 ? eOut2(1 - bareT / 0.6) : 0;
    const dense = bare ? back : form;
    const face = m?.face ?? Math.PI / 2;
    // Горячее кольцо у земли — граница ожога (сорван — гаснет: не жжёт).
    // Низкая струйка с разрывами: граница видна, но не «спасательный круг».
    const ringA = bare ? 0.15 + 0.4 * back : 0.5 * form;
    const nG = few ? 10 : 26;
    const ground: number[] = [];
    for (let i = 0; i < nG; i++) {
      const ph = pmod(time * 0.6 + hash(sd, i, 2), 1);
      if (Math.sin(ph * Math.PI) < 0.25) continue;
      const ang = ((i + 0.5 * hash(sd, i, 1)) / nG) * TAU + time * 0.25;
      const rr = R * (0.96 + 0.08 * hash(sd, i, 3));
      const x = cx + Math.cos(ang) * rr;
      const gy = cy + Math.sin(ang) * rr * 0.8;
      const y = gy - 1 - 5 * ph;
      if (hidden(x, y, gy)) continue;
      ground.push(x, y, 1.5 + 2.2 * Math.sin(ph * Math.PI), 0.2 + 0.6 * ph, i);
    }
    cloud(p, 1, ground, ringA);
    // Пелена вокруг тела: клубы кружат и поднимаются; за телом — заслонены.
    const n = few ? 10 : 26;
    const veil: number[] = [];
    const nape: number[] = [];
    for (let i = 0; i < n; i++) {
      const h = pmod(time * 0.13 + hash(sd, i, 5), 1);
      const ang = (i / n) * TAU + time * (0.4 + 0.25 * hash(sd, i, 6)) + h * 1.2;
      // Пелена гуще по краям силуэта: середина груди просвечивает.
      let rr = S * (0.78 + 0.5 * hash(sd, i, 7)) * (1 - 0.2 * h);
      let k = 0.1 + 0.55 * h * h;
      if (bare && tear < 0.5) {
        // Сорван: клубы разлетаются от тела и тают.
        rr += drag(190, 4, tear);
        k = Math.max(k, tear / 0.5);
      } else if (bare) {
        if (bareT >= 0.6) continue;
        // Стягивается обратно — идут к телу издалека.
        rr *= 1 + 1.5 * (1 - back);
        k = Math.max(k, 0.7 * (1 - back));
      }
      const x = cx + Math.cos(ang) * rr;
      const gy = cy + Math.sin(ang) * rr * 0.45;
      const y = gy - (6 + h * 62);
      if (hidden(x, y, gy)) continue;
      veil.push(x, y, 2.5 + 3 * hash(sd, i, 8) + 2 * h, k, i);
    }
    // Затылок в пару: самый плотный ком — за головой, в сторону затылка.
    if (!bare || back > 0) {
      const nx = cx - Math.cos(face) * S * 0.35;
      const gy = cy - Math.sin(face) * S * 0.25;
      for (let i = 0; i < 6; i++) {
        const x = nx + (i - 2.5) * 3.5 + Math.sin(time * 2 + i * 1.7);
        const y = gy - 56 - (i % 3) * 4;
        if (hidden(x, y, gy)) continue;
        nape.push(x, y, 4 + (i % 2) * 2, 0.15, i + 50);
      }
    }
    // Пелена прозрачная — тело видно сквозь неё; ком у затылка — плотный.
    cloud(p, 1, veil, (bare ? (tear < 0.5 ? 0.6 : 0.45 * back) : 0.42 * form) * (few ? 0.8 : 1));
    cloud(p, 1, nape, bare ? 0.85 * back : 0.85 * form);
    // Хлопок у затылка в миг срыва.
    if (bare && tear < 0.25) {
      const k = tear / 0.25;
      shockRing(p, cx - Math.cos(face) * S * 0.35, cy - 56, 4 + 26 * eOut2(k), C.white, 1 - k, sd);
    }
    void dense;
  }),
);

// =============================================================================
// ЖАР (фаза 3) — зона r 2,3 ходит за ним по полу (`f13_heat`): пол под ним
// тлеет, кромка ожога бежит огнём, от земли поднимается марево. Поверх
// темноты — угли и искры от тела (`f13_colheatlit`, ставит мозг на смене
// фазы): светятся, а не тонут в темноте.
// =============================================================================

registerZonePainter(
  'f13_heat',
  guarded((g, zz: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const z = zz as Zone;
    const cx = z.x * S;
    const cy = z.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = z.r * S;
    const sd = pmod(z.id, 9973) + 9;
    const form = eOut2(k01(z.t / 0.6));
    const flick = 0.85 + 0.15 * Math.sin(time * 9) * Math.sin(time * 5.3);
    p.col('#ff5a18', 0.14 * form * flick);
    fillSector(p, cx, cy, 0, R, 0, TAU);
    p.col('#ffa040', 0.1 * form * flick);
    fillSector(p, cx, cy, 0, R * 0.6, 0, TAU);
    ring(p, cx, cy, R + 1, C.ink, 0.5 * form);
    ring(p, cx, cy, R, C.fire[2], 0.85 * form, (ang) => pmod(ang * R - time * 22, 8) < 5);
    // Марево: столбики тёплого воздуха дрожат и уходят вверх.
    if (!reduced())
      for (let i = 0; i < 12; i++) {
        const a = hash(sd, i, 1) * TAU;
        const d = R * (0.3 + 0.65 * hash(sd, i, 2));
        const ph = pmod(time * 0.9 + hash(sd, i, 3), 1);
        const x = cx + Math.cos(a) * d + Math.sin(time * 6 + i) * 1.2;
        const y = cy + Math.sin(a) * d * 0.8 - ph * 16;
        p.col('#ffd8a0', 0.35 * (1 - ph) * form);
        p.dot(x, y, 1, 3);
      }
  }),
);

/** Кадр, в котором угли жара уже нарисованы (зон может быть две за бои). */
let heatDrawn = -1;
registerZonePainter(
  'f13_colheatlit',
  guarded((g, zz: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const m = colossus();
    if (!m || (m.data.phase ?? 0) < 3 || heatDrawn === time) return;
    heatDrawn = time;
    const z = zz as Zone;
    const cx = m.x * S;
    const cy = m.y * S;
    const p = new Pen(g, px + (m.x - z.x) * S, py + (m.y - z.y) * S, cx, cy);
    const R = COL.heat.r * S;
    const hidden = screenOf(S);
    // Кромка ожога светится и в темноте.
    ring(p, cx, cy, R, C.fire[3], 0.55, (ang) => pmod(ang * R - time * 22, 8) < 3);
    // Угли: от земли и от тела, вьются вверх, гаснут белое → красное.
    const n = reduced() ? 10 : 26;
    for (let i = 0; i < n; i++) {
      const L = 1 + 0.8 * hash(i, 1, 61);
      const ph = pmod(time / L + hash(i, 2, 61), 1);
      const a = hash(i, 3, 61) * TAU + Math.floor(time / L + hash(i, 2, 61)) * 2.1;
      const d = R * (0.2 + 0.75 * hash(i, 4, 61));
      const gx = cx + Math.cos(a) * d;
      const gy = cy + Math.sin(a) * d * 0.8;
      const x = gx + Math.sin(ph * 6 + i) * 3;
      const y = gy - ph * (40 + 40 * hash(i, 5, 61));
      if (hidden(x, y, gy)) continue;
      p.col(emberCol(ph), 1 - ph * 0.5);
      p.dot(x, y, i % 5 ? 1 : 2, i % 5 ? 1 : 2);
    }
  }),
);

// =============================================================================
// СТРУИ ИЗ РЕШЁТОК (фаза 1) — зоны r 1 у отдушин арены: 0,75 с греются,
// 1,2 с бьёт столб пара (`f13_jet`, поверх темноты). Метка: решётка
// раскаляется и пульсирует всё чаще, из щелей шипит пар, кромка зоны
// бежит; в последние 0,2 с — плевок пара. Струя: столб встаёт за 0,12 с на
// высоту в четыре клетки, бурлит, у основания мокро и брызги; в конце
// отрывается от земли и тает. Стоит за героем — герой его заслоняет.
// =============================================================================

registerZonePainter(
  'f13_jet',
  guarded((g, zz: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const z = zz as Zone;
    const warn = z.warn ?? 0.75;
    const cx = z.x * S;
    const cy = z.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = z.r * S;
    const sd = pmod(z.id, 9973) * 17 + 1;
    const hidden = screenOf(S);
    const few = reduced();
    if (z.t < warn) {
      const k = k01(z.t / warn);
      const left = warn - z.t;
      const sig = left < SIG;
      const tk = !few && tick(left);
      const ph = TAU * (z.t * 3 + 4 * k * k * k);
      const pulse = 0.5 + 0.5 * Math.sin(ph);
      p.col(C.fire[2], (0.15 + 0.45 * k) * (0.6 + 0.4 * pulse));
      shadowEll(p, cx, cy + 0.5, 6.5, 5.5);
      p.col(C.fire[4], (0.1 + 0.5 * k) * pulse);
      shadowEll(p, cx, cy + 0.5, 3, 2.2);
      ring(p, cx, cy, R + 1, C.ink, 0.5);
      ring(
        p,
        cx,
        cy,
        R,
        sig ? (tk ? C.white : C.yellow) : C.orange,
        0.7 + 0.3 * k,
        sig ? undefined : (ang) => pmod(ang * R + time * 30, 7) < 4,
      );
      // Шипит из щелей решётки.
      for (let i = 0; i < 4; i++) {
        if (hash(sd, i, 1) > 0.3 + 0.7 * k) continue;
        const q = pmod(z.t * (1.6 + 2 * k) + i / 4, 1);
        const x = cx + (i - 1.5) * 3;
        if (hidden(x, cy - 4 - 10 * q, cy)) continue;
        club(p, 1, 1 + 2 * q, i, x, cy - 3 - 10 * q, q, 0.85);
      }
      if (sig) {
        const q = 1 - left / SIG;
        club(p, 2, 2 + 4 * q, 0, cx, cy - 4 - 14 * q, 0.2, 0.95);
      }
      return;
    }
    const t = z.t - warn;
    const life = z.life;
    const fe = k01((life - t) / 0.3);
    const up = eOut2(k01(t / 0.12));
    const H = 66 * up;
    const base = (1 - fe) * H;
    // У основания: мокро, горячо, брызги в стороны.
    p.col('#ffd0b8', 0.3 * fe);
    shadowEll(p, cx, cy + 1, R, R * 0.7);
    ring(p, cx, cy, R, '#fff0e6', 0.7 * fe, (ang) => pmod(ang * R + time * 40, 6) < 4);
    if (t < 0.1) shockRing(p, cx, cy, 4 + 14 * eOut2(t / 0.1), C.white, 1 - t / 0.1, sd);
    // Брызги пара у основания и сам столб: клубы бегут вверх, расширяясь;
    // низ — горячий, верх — белый и тает. Стоит за героем — заслонён им.
    const low: number[] = [];
    const col: number[] = [];
    for (let i = 0; i < (few ? 3 : 6); i++) {
      const q = pmod(time * 2.5 + i / 6, 1);
      const a = (i / 6) * TAU + Math.floor(time * 2.5 + i / 6) * 1.3;
      const x = cx + Math.cos(a) * (4 + 10 * q);
      const gy = cy + Math.sin(a) * (3 + 7 * q);
      if (hidden(x, gy - 2, gy)) continue;
      low.push(x, gy - 2 - 3 * q, 2 + 2.5 * q, Math.max(q, 1 - fe), i);
    }
    const n = few ? 8 : 18;
    for (let i = 0; i < n; i++) {
      const q = pmod(time * 2.1 + i / n, 1);
      const h = base + q * (H - base);
      if (h > H + 1) continue;
      const x = cx + Math.sin(time * 7 + i * 1.9) * (1 + q * 3) + (hash(sd, i, 3) - 0.5) * 3;
      const y = cy - 4 - h;
      if (hidden(x, y, cy)) continue;
      (q < 0.18 ? low : col).push(x, y, 3.5 + 6.5 * q, Math.max(q * q * 0.95, 1 - fe), i);
    }
    cloud(p, 1, col, 0.92);
    cloud(p, 2, low, 0.95 * fe);
  }),
);

// =============================================================================
// НА КОЛЕНИ, РЁВ ФАЗ — визуальные зоны мозга.
// =============================================================================

/**
 * Пушка свалила (`k` 1): колени ударили в пол — две звезды трещин, кольцо
 * пыли, плиты вздрогнули. Встаёт (`k` 0): пыль у ног.
 */
registerZonePainter(
  'f13_colkneel',
  guarded((g, zz: Zone | Strike, px: number, py: number, S: number) => {
    const z = zz as FxZone;
    const t = z.t;
    const cx = z.x * S;
    const cy = z.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const sd = pmod(z.id, 9973) * 7 + 5;
    const slam = (z.k ?? 1) > 0;
    const few = reduced();
    const fe = 1 - k01((t - (z.life - 0.45)) / 0.45);
    if (slam) {
      // Колени бьют в пол: две звезды раскола, волна, пыль кольцом, смальта.
      for (const s of [-1, 1]) {
        const ck = scrack('knee', 5, 6, 12, 2, z.id + (s > 0 ? 1 : 0));
        drawCrack(
          p,
          ck,
          cx + s * S * 0.5,
          cy + 3,
          ck.max * eOut3(k01(t / 0.1)),
          C.groove,
          C.lip,
          fe,
        );
      }
      if (t < 0.06) {
        p.col(C.white, 0.8);
        star(p, cx - S * 0.5, cy, 9, 6, 0.3);
        star(p, cx + S * 0.5, cy, 9, 6, 0.9);
      }
      if (t < 0.32) {
        shockRing(p, cx, cy + 2, 8 + 40 * eOut2(t / 0.32), C.white, 1 - t / 0.32, sd);
        shockRing(p, cx, cy + 2, 6 + 28 * eOut2(t / 0.32), C.lip, 0.8 * (1 - t / 0.32), sd + 1);
      }
      stones(p, sd, t, cx, cy + 2, few ? 5 : 14, 0, Math.PI, 30, 36, 60, 70, 10, [0.9, 1.3], 0.3);
      dust(p, sd, t, cx, cy + 3, few ? 7 : 20, 0, Math.PI, 44, 30, 4, 11, 9, 1.1, 0, 0.95);
    } else {
      dust(p, sd, t, cx, cy + 3, few ? 3 : 8, 0, Math.PI, 26, 18, 2, 6, 5, 0.8, 0, 0.85);
    }
  }),
);

/**
 * Рёв смены фазы (`k` — новая фаза): 1 «ПАР» — его окутывает: белая волна
 * пара от тела; 2 «ТОПОТ» — плащ сорван рёвом: пар сдуло, пыль кольцом и
 * раскол; 3 «ИСПАРЕНИЕ» — волна жара и сноп искр (поверх темноты).
 */
registerZonePainter(
  'f13_colroar',
  guarded((g, zz: Zone | Strike, px: number, py: number, S: number) => {
    const z = zz as FxZone;
    const t = z.t;
    const cx = z.x * S;
    const cy = z.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const sd = pmod(z.id, 9973) * 3 + 1;
    const few = reduced();
    const ph = z.k ?? 1;
    const R = z.r * S;
    if (ph === 1) {
      if (t < 0.4) shockRing(p, cx, cy, S + (R - S) * eOut2(t / 0.4), C.white, 1 - t / 0.4, sd);
      dust(p, sd, t, cx, cy - 20, few ? 6 : 16, 0, Math.PI, 70, 40, 4, 9, 14, 1.0, 1, 0.9);
    } else if (ph === 2) {
      if (t < 0.4) shockRing(p, cx, cy, S + (R - S) * eOut2(t / 0.4), C.lip, 1 - t / 0.4, sd);
      dust(p, sd, t, cx, cy - 30, few ? 6 : 16, 0, Math.PI, 110, 60, 4, 8, 10, 0.8, 1, 0.85);
      dust(p, sd + 1, t, cx, cy + 2, few ? 5 : 12, 0, Math.PI, 50, 30, 3, 8, 6, 1.0, 0, 0.9);
      const ck = scrack('roar', 7, S * 0.8, S * 1.6, 2, z.id);
      drawCrack(
        p,
        ck,
        cx,
        cy + 3,
        ck.max * eOut3(k01(t / 0.2)),
        C.groove,
        C.lip,
        1 - k01((t - 0.9) / 0.4),
      );
    } else {
      // Волна жара: вспышка, два огненных кольца, сноп углей от тела.
      if (t < 0.22) {
        p.col(C.fire[3], 0.35 * (1 - t / 0.22));
        fillSector(p, cx, cy, 0, S + (R - S) * eOut2(t / 0.22) * 0.7, 0, TAU);
      }
      if (t < 0.5) {
        const k = t / 0.5;
        shockRing(p, cx, cy, S + (R - S) * eOut2(k), C.fire[4], 1 - k, sd);
        shockRing(p, cx, cy, S + (R - S) * 0.8 * eOut2(k), C.fire[2], 0.9 * (1 - k), sd + 1);
      }
      sparks(p, sd, t, cx, cy - 34, few ? 14 : 48, 0, Math.PI, 50, 90, 1.2, 90, 90);
      sparks(
        p,
        sd + 7,
        t - 0.15,
        cx,
        cy - 20,
        few ? 6 : 20,
        -Math.PI / 2,
        0.9,
        20,
        40,
        1.4,
        120,
        60,
      );
    }
  }),
);

// =============================================================================
// ПРОГРЕВ: заготовки техник рисуются до боя, по одной на шаг (движок тратит
// на прогрев до 3 мс за кадр, пока Колосс в мире) — клуб, камень, плита,
// трещина или глыба не рисуются впервые посреди удара. Генераторы на один
// рисовальщик идут по очереди: тело (`f13-art`) — первым.
// =============================================================================

function* warmFx(): Generator<unknown> {
  for (let r = 1; r <= 150; r++) {
    circle(r);
    if (r % 4 === 0) yield;
  }
  // Комы облаков: пыль — до 12, пар — до 16 (кучевые клубы выброса).
  for (const pal of [1, 0, 2])
    for (let r = 1; r <= (pal ? 16 : 12); r++)
      for (let v = 0; v < 4; v++) {
        for (let tone = 0; tone < 3; tone++) {
          for (let d = 0; d <= 2; d++)
            blobImg(pal, tone, tone === 2 ? Math.max(1, Math.round(r * 0.55)) : r, v, d);
          yield;
        }
        if (pal < 2 && r <= 8) {
          for (let d = 0; d <= 2; d++) puffImg(pal, r, v, d);
          yield;
        }
      }
  for (const pal of [3, 4])
    for (let r = 1; r <= 9; r++)
      for (let v = 0; v < 4; v++) {
        puffImg(pal, r, v, 0);
        yield;
      }
  for (let pal = 0; pal < STONE_PAL.length; pal++)
    for (let sz = 1; sz <= 4; sz++)
      for (let f = 0; f < 4; f++) {
        stoneImg(sz, f, pal);
        yield;
      }
  for (let w = 3; w <= 8; w++)
    for (let f = 0; f < 4; f++)
      for (let v = 0; v < 4; v++) {
        slabImg(w, f, v);
        yield;
      }
  for (let f = 0; f < 8; f++) {
    blockImg(f, 0);
    blockImg(f, 1);
    yield;
  }
  for (let f = 0; f < 16; f++) {
    boulderImg(f);
    yield;
  }
  for (let v = 0; v < 3; v++) {
    heapImg(v);
    yield;
  }
  // Трещины: звёзды всех видов и ветви полос топота и землетрясения.
  const S = 16;
  for (let v = 0; v < 4; v++) {
    scrack('step', 4, 3, 6, 1, v);
    scrack('plant', 6, 1.5 * S * 0.35, 1.5 * S * 0.7, 2, v);
    yield;
    scrack('quake', 5, S * 0.9, S * 1.5, 3, v);
    scrack('deb', 5, 5, 11, 2, v);
    yield;
    scrack('rock', 6, 8, 18, 3, v);
    scrack('rip', 5, 6, 12, 2, v);
    scrack('knee', 5, 6, 12, 2, v);
    yield;
    scrack('roar', 7, S * 0.8, S * 1.6, 2, v);
    yield;
  }
  scrack('rise', 9, S * 1.6, S * 3, 3, 0);
  yield;
  for (const [w, heavy] of [
    [0.8 * S, 0],
    [1.1 * S, 1],
  ])
    for (let b = 0; b < 16; b++)
      for (let v = 0; v < 3; v++) {
        const a = (b * TAU) / 16;
        rcrack(w * (0.8 + 0.3 * heavy), 2, a, v);
        rcrack(w * (0.6 + 0.3 * heavy), 2, a, v);
        yield;
      }
}

registerMobWarm('f13boss', warmFx);

void fillPoly;
