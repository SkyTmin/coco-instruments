// Этаж 11, босс «Древний страж» — техники (v2.87): метки ударов, контакт,
// лучи, ракеты, купол, пар, обрушение края. Тело стража рисует `f11-art.ts`,
// здесь — всё, что страж делает с МИРОМ. Договор движка — библия §14.
//
// Как устроено:
//   • метки ударов стража — не strike с `warn`, а `m.tele` мозга (удар бьёт в
//     миг готовности). Красную метку движка выключает `m.data.vNoTele`, а
//     рисуют два «режиссёра» на весь бой — зоны-картинки мозга: `f11v_dir`
//     на полу (под телами) и `f11v_sky` поверх темноты. Оба читают стража
//     (`m.mode`, `m.t`, `m.data`) и рисуют подготовку ровно по его часам:
//     «куда» — с первого кадра, «когда» — налив доходит до края в миг урона,
//     последние 0,2 с — «тик-тик» и белая кромка;
//   • контакт — `registerImpactPainter` у ударов стража (`f11_beam`,
//     `f11_slam`, `f11_stomp`) и у ракет (`f11_rocket`): кратер, трещины,
//     мраморная крошка, пыль клубами, ударная волна; тряска — по силе;
//   • лучи вращения 3-й фазы — своя зона `f11v_spin` на весь режим, угол —
//     `m.data.sa` стража (тот же, что считает урон);
//   • поверх темноты рисуется только светящееся и летящее; то, что лежит на
//     полу за телами ближе к камере, обрезается их силуэтом (`front`) —
//     слой ведёт себя так, будто сортирован по глубине.
//
// Пол «Сердца замка» — светлый мрамор и синяя мозаика: светлая пыль на нём
// пропадает, поэтому пыль тёплая, с тенью снизу; трещины тёмные со светлой
// кромкой снизу-справа (свет сверху-слева), обломки — с контуром этажа.
//
// Пиксели — на СЕТКЕ МИРА (`Pen`): эффект не «плывёт» по полу за камерой.
// Частицы детерминированы — позиция считается от зерна и возраста, а не
// копится по кадрам: лист кадров и игра рисуют одно и то же, стоп-кадр
// держит позу сам.
import { Px } from '../dungeon-art';
import {
  MOB_PAINTERS,
  paintSim,
  registerImpactPainter,
  registerMobWarm,
  registerShotPainter,
  registerZonePainter,
} from '../dungeon-paint';
import type { ImpactRec, MobAnim, MobFrame, MobPose, Sprite } from '../dungeon-paint';
import type { Mob, Shot, Sim, Strike, Zone } from '../dungeon-sim';
import { BOSS, f11State, windAt } from './f11-brains';

type RGBA = [number, number, number, number];

const TAU = Math.PI * 2;
const PI = Math.PI;
const hx = (h: string, a = 255): RGBA => {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255, a];
};
/** Детерминированный шум по трём числам, 0…1 (та же формула, что в f11-art). */
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
/** «Тик-тик»: две вспышки в последние 0,2 с (0,20…0,15 и 0,10…0,05). */
const tick = (left: number) => left < SIG && left > 0 && Math.floor(left / 0.05) % 2 === 1;

// ---- Палитра: мрамор, бронза стража, руны, лазер, огонь, пар ---------------

const C = {
  ink: '#1d2130',
  shade: '#3c3848',
  groove: '#24202e',
  lip: '#f6f5fa',
  dust: '#e8e0d0',
  pebble: '#8a8698',
  redDk: '#6a0e0a',
  red: '#d8281c',
  hot: '#ff5a2a',
  orange: '#ff9a3a',
  yellow: '#ffe070',
  cream: '#fff4d0',
  white: '#ffffff',
  rune: '#6ff4e6',
  cyan: '#7af6ff',
  cyanDk: '#1e7a84',
  teal: '#2fa0a4',
  ice: '#dffcff',
  fire: ['#5a1404', '#a8300c', '#e86018', '#ffa830', '#fff0a0'],
  heat: ['#3a0c06', '#8a2010', '#d84a14', '#ff9a2a', '#ffe48a', '#fffef0'],
  bronze: ['#2c2a22', '#48443a', '#6a6856', '#928e76', '#b8b49a'],
  soot: '#1c1a20',
};

/** Искра огня по доле жизни: белая → жёлтая → оранжевая → красная. */
const sparkCol = (k: number) =>
  k < 0.18
    ? C.white
    : k < 0.42
      ? C.fire[4]
      : k < 0.7
        ? C.fire[3]
        : k < 0.88
          ? C.fire[2]
          : C.fire[1];
/** Искра рун: белая → бирюзовая → тёмная бирюза. */
const runeCol = (k: number) => (k < 0.3 ? C.white : k < 0.65 ? C.cyan : k < 0.85 ? C.rune : C.teal);
/** Раскалённый шов по остыванию 0 (белый) … 1 (тёмный). */
const heatCol = (k: number) =>
  k < 0.1
    ? C.heat[5]
    : k < 0.25
      ? C.heat[4]
      : k < 0.45
        ? C.heat[3]
        : k < 0.65
          ? C.heat[2]
          : k < 0.85
            ? C.heat[1]
            : C.heat[0];
/** Цвет фазы: 2 — холодный щит, 3 — перегрев, 4 — падение. */
const phaseCol = (ph: number) =>
  ph === 2 ? '#8ae0ff' : ph === 3 ? C.orange : ph >= 4 ? C.hot : C.rune;

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
  col(c: string, a = 1): void {
    this.g.fillStyle = c;
    this.g.globalAlpha = a < 0 ? 0 : a > 1 ? 1 : a;
  }
  alpha(a: number): void {
    this.g.globalAlpha = a < 0 ? 0 : a > 1 ? 1 : a;
  }
  dot(x: number, y: number, w = 1, h = 1): void {
    this.g.fillRect(Math.floor(x) + this.qx, Math.floor(y) + this.qy, w, h);
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.g.fillRect(x + this.qx, y + this.qy, w, h);
  }
  img(c: HTMLCanvasElement, x: number, y: number): void {
    this.g.drawImage(c, Math.floor(x) + this.qx, Math.floor(y) + this.qy);
  }
  /** Линия по пикселям (Брезенхэм); `keep(i)` — пунктир по номеру пикселя. */
  line(x0: number, y0: number, x1: number, y1: number, keep?: (i: number) => boolean): void {
    let x = Math.floor(x0);
    let y = Math.floor(y0);
    const xe = Math.floor(x1);
    const ye = Math.floor(y1);
    const dx = Math.abs(xe - x);
    const dy = -Math.abs(ye - y);
    const sx = x < xe ? 1 : -1;
    const sy = y < ye ? 1 : -1;
    let err = dx + dy;
    for (let n = 0; n < 900; n++) {
      if (!keep || keep(n)) this.g.fillRect(x + this.qx, y + this.qy, 1, 1);
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
  /** Линия с тенью на пиксель вниз-вправо — читается на пёстром полу. */
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

/** Угол a в секторе [a0, a0 + span] (span > 0) с переходом через 2π. */
function inArc(a: number, a0: number, span: number): boolean {
  return mod(a - a0, TAU) <= span;
}

/**
 * Кольцевой сектор [r0, r1] × [a0, a1] строками пикселей (центр пикселя
 * внутри — пиксель наш). Угол больше четверти круга режется на куски с
 * ОБЩИМИ границами: полупрозрачная заливка не даёт шва.
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
  const n = full ? 1 : Math.max(1, Math.ceil((a1 - a0) / (PI / 2)));
  const bx: number[] = [];
  const by: number[] = [];
  for (let j = 0; j <= n; j++) {
    const a = a0 + ((a1 - a0) * j) / n;
    bx.push(Math.cos(a));
    by.push(Math.sin(a));
  }
  const y0 = Math.floor(cy - r1) - 1;
  const y1 = Math.ceil(cy + r1) + 1;
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

/** Выпуклый многоугольник строками пикселей (точки — пары x, y мира). */
function fillPoly(p: Pen, pts: number[], dither = false): void {
  const n = pts.length / 2;
  let ymin = 1e9;
  let ymax = -1e9;
  for (let i = 0; i < n; i++) {
    ymin = Math.min(ymin, pts[i * 2 + 1]);
    ymax = Math.max(ymax, pts[i * 2 + 1]);
  }
  const g = p.g;
  for (let Y = Math.floor(ymin); Y <= Math.ceil(ymax); Y++) {
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
    if (xb < xa) continue;
    if (dither)
      for (let x = xa + ((xa + Y) & 1); x <= xb; x += 2) g.fillRect(x + p.qx, Y + p.qy, 1, 1);
    else g.fillRect(xa + p.qx, Y + p.qy, xb - xa + 1, 1);
  }
}

/** Полоса вдоль (ux, uy) от l0 до l1, полуширина hw — строками пикселей. */
function fillLane(
  p: Pen,
  cx: number,
  cy: number,
  ux: number,
  uy: number,
  l0: number,
  l1: number,
  hw: number,
  dither = false,
): void {
  if (l1 <= l0 || hw <= 0) return;
  const nx = -uy;
  const ny = ux;
  fillPoly(
    p,
    [
      cx + ux * l0 + nx * hw,
      cy + uy * l0 + ny * hw,
      cx + ux * l1 + nx * hw,
      cy + uy * l1 + ny * hw,
      cx + ux * l1 - nx * hw,
      cy + uy * l1 - ny * hw,
      cx + ux * l0 - nx * hw,
      cy + uy * l0 - ny * hw,
    ],
    dither,
  );
}

/** Толстый отрезок от (x0, y0) до (x1, y1) полушириной hw (экранные точки мира). */
function fillSeg(p: Pen, x0: number, y0: number, x1: number, y1: number, hw: number): void {
  const L = Math.hypot(x1 - x0, y1 - y0);
  if (L < 0.01) {
    disc(p, x0, y0, hw);
    return;
  }
  fillLane(p, x0, y0, (x1 - x0) / L, (y1 - y0) / L, 0, L, hw);
}

/** Круг по пикселям. */
function disc(p: Pen, cx: number, cy: number, r: number, dither = false): void {
  if (r < 0.5) {
    p.dot(cx, cy);
    return;
  }
  const g = p.g;
  for (let Y = Math.floor(cy - r); Y <= Math.ceil(cy + r); Y++) {
    const yy = Y + 0.5 - cy;
    if (Math.abs(yy) > r) continue;
    const h = Math.sqrt(r * r - yy * yy);
    const xa = Math.ceil(cx - h - 0.5);
    const xb = Math.floor(cx + h - 0.5);
    if (xb < xa) continue;
    if (dither)
      for (let x = xa + ((xa + Y) & 1); x <= xb; x += 2) g.fillRect(x + p.qx, Y + p.qy, 1, 1);
    else g.fillRect(xa + p.qx, Y + p.qy, xb - xa + 1, 1);
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
    const key = (x + 512) * 1024 + (y + 512);
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
    x: Int16Array.from(withA.map((q) => q[0])),
    y: Int16Array.from(withA.map((q) => q[1])),
    a: Float32Array.from(withA.map((q) => q[2])),
  };
  if (circles.size > 200) circles.delete(circles.keys().next().value as number);
  circles.set(R, c);
  return c;
}

/**
 * Кольцо по пикселям цветом `c`. `keep(a, i)` — оставить ли пиксель
 * (пунктир, дуга, рваная пыль). `sh` — тень на пиксель вниз-вправо.
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
    for (let i = 0; i < n; i++) {
      if (keep && !keep(pts.a[i], i)) continue;
      p.rect(ox + pts.x[i] + d, oy + pts.y[i] + d, 1, 1);
    }
  }
}

/** Звезда удара: n лучей радиуса r (у основания — 0,4 r). */
function star(p: Pen, cx: number, cy: number, r: number, n: number, rot: number): void {
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
          on = d <= r * (0.4 + 0.6 * spike);
        }
      }
      if (on && run < 0) run = x;
      if (!on && run >= 0) {
        p.rect(x0 + run, y0 + y, x - run, 1);
        run = -1;
      }
    }
  }
}

/** Блик-крест: четыре луча длины L из точки, тоньше к концу. */
function flare(p: Pen, x: number, y: number, L: number, c: string, a: number): void {
  p.col(c, a);
  p.line(x - L, y, x + L, y);
  p.line(x, y - Math.round(L * 0.7), x, y + Math.round(L * 0.7));
  if (L > 4) {
    p.col(C.white, a);
    p.rect(Math.floor(x) - 1, Math.floor(y), 3, 1);
    p.rect(Math.floor(x), Math.floor(y) - 1, 1, 3);
  }
}

// ---- Спрайты-заготовки -------------------------------------------------------

const sprites = new Map<number, HTMLCanvasElement>();
const spr = (key: number, make: () => Px): HTMLCanvasElement => {
  let c = sprites.get(key);
  if (!c) {
    c = make().canvas();
    sprites.set(key, c);
  }
  return c;
};

/** Пыль: тень снизу-справа, основа, свет сверху-слева. */
const PUFF_PAL: [RGBA, RGBA, RGBA][] = [
  [hx('#8a8070'), hx('#c4bba9'), hx('#ece6d8')], // 0 — мраморная пыль, теплее пола
  [hx('#1c1a22'), hx('#33303c'), hx('#4e4a58')], // 1 — копоть
  [hx('#666470'), hx('#9896a2'), hx('#cfcdd8')], // 2 — дым ракеты
  [hx('#9aaac2'), hx('#d6e0ee'), hx('#ffffff')], // 3 — пар
  [hx('#b8380c'), hx('#ff8a2a'), hx('#ffe48a')], // 4 — огонь, выхлоп
  [hx('#1e7a84'), hx('#5fd6cc'), hx('#c8fcf4')], // 5 — рунная пыль
  [hx('#3a4a2a'), hx('#5a6e3e'), hx('#86a05e')], // 6 — мох и земля
];

/** Клуб радиуса r (1…16), вариант v (0…3): три доли — край рваный. */
function puffImg(pal: number, r: number, v: number): HTMLCanvasElement {
  const R = Math.max(1, Math.min(16, Math.round(r)));
  return spr(10000 + pal * 1000 + R * 8 + (v & 3), () => {
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
  [hx('#6e6c7e'), hx('#9c9aac'), hx('#c6c4d2'), hx('#eeedf4')], // 0 — мрамор пола
  [hx('#3a362c'), hx('#5e5c4a'), hx('#86826a'), hx('#b0ac90')], // 1 — бронза стража
  [hx('#1a5c64'), hx('#2fa0a4'), hx('#7fe6dc'), hx('#e8fffc')], // 2 — кристалл пилона
  [hx('#1a2c50'), hx('#2a4a7c'), hx('#4670a8'), hx('#8aaad4')], // 3 — смальта мозаики
];

/** Обломок размера 1…4, поворот f (0…3): скол со срезом, со светом. */
function chunkImg(sz: number, f: number, pal: number): HTMLCanvasElement {
  return spr(20000 + pal * 100 + sz * 10 + (f & 3), () => {
    const s = sz * 2 + 3;
    const p = new Px(s, s);
    const c = s / 2;
    const rx = 0.55 + 0.62 * sz;
    const ry = 0.42 + 0.42 * sz;
    const a = (f & 3) * (PI / 4);
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
    p.outline(hx(C.ink));
    return p;
  });
}

/** Язык пламени высоты h (3…12), кадр f (0…3); основание — низ по центру. */
function flameImg(h: number, f: number): HTMLCanvasElement {
  const H = Math.max(3, Math.min(12, Math.round(h)));
  return spr(30000 + H * 8 + (f & 3), () => {
    const w = Math.max(3, Math.round(H * 0.5)) | 1;
    const p = new Px(w + 2, H + 1);
    const cx = (w + 2) / 2;
    const fire = C.fire.map((c) => hx(c));
    for (let y = 0; y < H; y++) {
      const t = y / Math.max(1, H - 1);
      const half = (w / 2) * Math.pow(Math.sin(PI * Math.min(1, 0.12 + t * 0.95) * 0.5), 0.9);
      const sway = Math.round(Math.sin((f & 3) * 1.57 + t * 2.6) * (1 - t) * 1.3);
      for (let x = 0; x < w + 2; x++) {
        const d = Math.abs(x + 0.5 - cx - sway);
        if (d > half + 0.25) continue;
        const inner = half - d;
        const col =
          y === 0
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
    return p;
  });
}

/** Сота купола: шестиугольная пластина r (2…5), поворот f (0…3), прозрачная бирюза. */
function hexImg(r: number, f: number): HTMLCanvasElement {
  const R = Math.max(2, Math.min(5, Math.round(r)));
  return spr(40000 + R * 8 + (f & 3), () => {
    const s = 2 * R + 3;
    const p = new Px(s, s);
    const c = s / 2;
    const rot = (f & 3) * 0.26;
    const sq = 0.6 + 0.4 * Math.abs(Math.cos(f * 0.9));
    const inHex = (x: number, y: number, rr: number) => {
      const dx = (x + 0.5 - c) / sq;
      const dy = y + 0.5 - c;
      for (let k = 0; k < 3; k++) {
        const a = rot + (k * PI) / 3;
        if (Math.abs(dx * Math.cos(a) + dy * Math.sin(a)) > rr * 0.866) return false;
      }
      return true;
    };
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        if (!inHex(x, y, R)) continue;
        const edge = !inHex(x, y, R - 1.1);
        const l = (x - c) * -0.5 + (y - c) * -0.8;
        p.set(
          x,
          y,
          edge
            ? l > 0
              ? hx('#ffffff', 240)
              : hx('#7af6ff', 230)
            : hx(l > 0.5 ? '#bff8ff' : '#5fd6e0', 120),
        );
      }
    return p;
  });
}

/**
 * Плита края арены, уходящая в небо: верх — мрамор с плитами, торец —
 * светлый камень, низ — земля с корнями (остров!). Вариант v (0…3).
 */
function slabImg(v: number): HTMLCanvasElement {
  return spr(50000 + (v & 7), () => {
    const W = 16;
    const p = new Px(W + 2, 22);
    const top = [hx('#a8a6b8'), hx('#c4c2d0'), hx('#dcdae6'), hx('#f2f1f6')];
    const side = [hx('#6a6878'), hx('#8a8898'), hx('#a8a6b6')];
    const earth = [hx('#3e2c1e'), hx('#5c4028'), hx('#7a5636')];
    const cut = (x: number) => Math.round(Math.sin(x * 0.9 + v * 1.7) * 1.2 + hash(x, v, 61) * 1.5);
    for (let x = 1; x <= W; x++) {
      const y0 = 1 + cut(x) * 0.5;
      // Верх плиты (12 px), торец (4), земля клином (до 5 px), корешки.
      for (let y = Math.round(y0); y < 12; y++) {
        const seam = (x + v * 5) % 9 === 0 || y === Math.round(y0);
        p.set(x, y, seam ? top[0] : y < 4 ? top[3] : hash(x, y, v + 71) < 0.3 ? top[1] : top[2]);
      }
      for (let y = 12; y < 15; y++) p.set(x, y, side[y === 12 ? 2 : y === 13 ? 1 : 0]);
      const depth = 15 + Math.round((1 - Math.abs(x - W / 2 - 0.5) / (W / 2)) * (3 + (v & 1) * 2));
      for (let y = 15; y < depth; y++)
        p.set(x, y, earth[y === 15 ? 2 : hash(x, y, v + 81) < 0.5 ? 1 : 0]);
      if (hash(x, v, 91) < 0.18)
        for (let y = depth; y < depth + 2 + (x & 1); y++) p.set(x, y, earth[0]);
    }
    if (v & 2) for (let k = 0; k < 4; k++) p.set(4 + k * 3, 6 + (k & 1), hx('#4670a8'));
    p.outline(hx(C.ink));
    return p;
  });
}

/**
 * Кулак-проекция для удара кулаками: каменная кисть стража, сжатая и
 * опущенная костяшками вниз, с бирюзовой вязью рун и светящейся кромкой.
 * `mir` — левая (зеркально).
 */
function fistImg(mir: boolean): HTMLCanvasElement {
  return spr(60000 + (mir ? 1 : 0), () => {
    const W = 15;
    const H = 15;
    const p = new Px(W + 2, H + 2);
    const T = C.bronze.map((c) => hx(c));
    const cx = 8;
    for (let y = 1; y <= H; y++)
      for (let x = 1; x <= W; x++) {
        const dx = (x - cx) / 6.4;
        const dy = (y - 8) / 6.6;
        // Ком кулака: тело и четыре костяшки внизу, большой палец сбоку.
        let inside = dx * dx * 1.05 + dy * dy < 1;
        const kn = Math.floor((x - 2) / 3);
        if (!inside && y >= 11 && y <= 14 && x >= 2 && x <= 13) {
          const kx = 3.5 + kn * 3;
          inside = (x - kx) ** 2 + (y - 12) ** 2 < 2.6;
        }
        if (!inside && x >= 12 && x <= 15 && y >= 6 && y <= 11)
          inside = (x - 13) ** 2 * 1.4 + (y - 8.5) ** 2 < 5;
        if (!inside) continue;
        const l = (x - cx) * -0.45 + (y - 8) * -0.75;
        let c = l > 3.2 ? T[4] : l > 0.8 ? T[3] : l > -2.5 ? T[2] : T[1];
        // Пальцы: тёмные швы.
        if (y >= 10 && (x - 2) % 3 === 0 && x < 14) c = T[0];
        p.set(mir ? W + 1 - x : x, y, c);
      }
    // Вязь рун по тыльной стороне.
    const rune = hx(C.rune);
    for (const [x, y] of [
      [5, 5],
      [6, 4],
      [7, 4],
      [8, 5],
      [9, 6],
      [7, 6],
      [6, 7],
      [8, 7],
    ])
      p.set(mir ? W + 1 - x : x, y, rune);
    p.outline(hx('#9ff8f0'));
    return p;
  });
}

/** Тень двух кулаков на полу: полуразмах `s` px; `soft` — через пиксель. */
function fistShadow(s: number, soft: boolean): HTMLCanvasElement {
  const S = Math.max(4, Math.min(28, Math.round(s)));
  return spr(70000 + S * 2 + (soft ? 1 : 0), () => {
    const W = S * 2 + 3;
    const H = Math.round(S * 0.9) + 3;
    const p = new Px(W, H);
    const col = hx('#141020');
    const cx = W / 2;
    const cy = H / 2;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        if (soft && (x + y) & 1) continue;
        const ax = Math.abs(x + 0.5 - cx);
        const dy = y + 0.5 - cy;
        // Два кома: каждый — скруглённый квадрат, между ними щель.
        const fx = (ax - S * 0.5) / (S * 0.47);
        const fy = dy / (S * 0.42);
        const inside = fx ** 4 + fy ** 4 < 1 && ax > S * 0.04;
        if (inside) p.set(x, y, col);
      }
    return p;
  });
}

/** Выжженное пятно радиуса r: тёмное, край через пиксель. */
function sootImg(r: number, tone: number): HTMLCanvasElement {
  const R = Math.max(2, Math.min(24, Math.round(r)));
  return spr(80000 + R * 4 + tone, () => {
    const s = R * 2 + 1;
    const p = new Px(s, Math.ceil(s * 0.8) + 1);
    const c = [hx('#16141a'), hx('#2a1810'), hx('#3a3446')][tone];
    for (let y = 0; y < p.h; y++)
      for (let x = 0; x < s; x++) {
        const dx = (x + 0.5 - s / 2) / R;
        const dy = (y + 0.5 - p.h / 2) / (R * 0.75);
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

/** Лепесток (цветы сада на плечах стража): 2×2, цвет c (0…3). */
const PETAL = ['#f4f0ea', '#e888a8', '#f6d24a', '#a8d870'];

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
 * `fade`. `big` — доля крупных. `delay(i)` — когда вылетает i-й.
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
    const sz = r4 < big * 0.4 ? 4 : r4 < big ? 3 : r4 < 0.7 ? 2 : 1;
    if (f.air) {
      p.col(C.ink, 0.3 * a);
      p.dot(gx - sz / 2, gy + 1, sz, 1);
    }
    const spin = f.air ? Math.floor(t * (14 + r2 * 10) + i) & 3 : i & 3;
    const im = chunkImg(sz, spin, typeof pal === 'number' ? pal : 0);
    p.alpha(a);
    p.img(im, gx - im.width / 2, gy - f.z - im.height / 2);
  }
}

/** Ветер на клетке (клеток/с) — чтобы пыль и дым уходили по ветру этажа. */
function windPx(sim: Sim | null, x: number, y: number): [number, number] {
  const st = f11State(sim);
  if (!st) return [0.9, 0.15];
  const [wx, wy] = windAt(st, x, y, [0, 0]);
  return [wx, wy];
}

/**
 * Пыль клубами: `n` клубов из (x, y), направление `ang` ± `spread`, скорость
 * с сопротивлением, растут `r0 → r1`, поднимаются на `rise` и тают за `life`.
 * `wind` — снос ветром, пикселей в секунду.
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
  wind?: [number, number],
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
    const ox = (src ? src[0] : x) + (wind ? wind[0] * t * t * 0.6 : 0);
    const oy = (src ? src[1] : y) + (wind ? wind[1] * t * t * 0.6 : 0);
    p.img(im, ox + Math.cos(th) * d - im.width / 2, oy + Math.sin(th) * d - z - im.height / 2);
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
    p.line(bx, by, ax, ay);
  }
}

/** Угольки и мошки: поднимаются от места рождения, качаются, гаснут. */
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
  col: (k: number) => string = (k) => sparkCol(0.25 + k * 0.75),
): void {
  for (let i = 0; i < n; i++) {
    const t = age - born(i);
    const L = life * (0.7 + 0.5 * hash(seed, i, 41));
    if (t < 0 || t >= L) continue;
    const k = t / L;
    const [x, y] = at(i);
    const sw = Math.sin(t * (5 + 3 * hash(seed, i, 42)) + i) * (1.5 + 2 * k);
    const z = rise * (0.6 + 0.6 * hash(seed, i, 43)) * eOut2(k);
    p.col(col(k), a0 * (1 - k * k));
    p.dot(x + sw, y - z);
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
    .filter(([x, y, d]) => d < maxLen * 0.65 && !px.has(K(x + 1, y + 1)))
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

/** Раскрытая трещина одним холстом: дорисовалась — одним `drawImage`. */
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
  if (x1 < x0) x0 = y0 = x1 = y1 = 0;
  const px = new Px(x1 - x0 + 1, y1 - y0 + 1);
  if (lip) {
    const l = hx(lip, Math.round(0.8 * 255));
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
    p.alpha(a);
    p.img(im.img, ox + im.x, oy + im.y);
    return;
  }
  if (lip) {
    p.col(lip, a * 0.8);
    for (let i = 0; i < c.lx.length && c.ld[i] <= reach; i++)
      p.rect(ox + c.lx[i], oy + c.ly[i], 1, 1);
  }
  p.col(core, a);
  for (let i = 0; i < c.x.length && c.d[i] <= reach; i++) p.rect(ox + c.x[i], oy + c.y[i], 1, 1);
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

// ---- Тела ближе к камере: слой поверх темноты обрезается их силуэтом --------

/** Тело: середина по x, земля (y ног), полуширина, высота — пиксели мира. */
interface Body {
  x: number;
  fy: number;
  hw: number;
  h: number;
}

function bodiesOf(sim: Sim | null, S: number): Body[] {
  const out: Body[] = [];
  if (!sim) return out;
  for (const m of sim.mobs) {
    if (m.mode === 'dying' && m.t > 0.5) continue;
    if (m.kind === 'f11boss') out.push({ x: m.x * S, fy: m.y * S + 2, hw: 20, h: 64 });
    else if (m.kind === 'f11_pylon') out.push({ x: m.x * S, fy: m.y * S + 2, hw: 6, h: 37 });
    else
      out.push({
        x: m.x * S,
        fy: m.y * S + 2,
        hw: Math.max(4, m.r * S),
        h: Math.max(10, m.r * S * 3),
      });
  }
  const h = sim.hero;
  if (h.mode !== 'dead') out.push({ x: h.x * S, fy: h.y * S + 2, hw: 5, h: 16 });
  return out;
}

/**
 * Нарисовать то, что лежит на глубине `depth` (y опоры в пикселях мира), так,
 * чтобы тела, стоящие ближе к камере, его заслоняли: обрезка по их
 * прямоугольникам (каждое — своим `clip`, пересечение дополнений).
 */
function front(p: Pen, bodies: Body[], depth: number, draw: () => void): void {
  const g = p.g;
  let clipped = false;
  for (const b of bodies) {
    if (b.fy <= depth + 1) continue;
    if (!clipped) {
      g.save();
      clipped = true;
    }
    g.beginPath();
    g.rect(-1e5, -1e5, 2e5, 2e5);
    g.rect(
      Math.floor(b.x - b.hw) + p.qx,
      Math.floor(b.fy - b.h) + p.qy,
      Math.ceil(b.hw * 2),
      Math.ceil(b.h),
    );
    g.clip('evenodd');
  }
  draw();
  if (clipped) g.restore();
}

/**
 * Отрезок вдоль пола (от s0 до s1 по направлению ux, uy из (bx, by)), который
 * рисуется кусками одной глубины: часть, ушедшая за тело, им заслонена.
 */
function frontRun(
  p: Pen,
  bodies: Body[],
  bx: number,
  by: number,
  ux: number,
  uy: number,
  s0: number,
  s1: number,
  draw: (a: number, b: number) => void,
): void {
  if (s1 <= s0) return;
  const step = 6;
  let a = s0;
  let mask = -1;
  const maskAt = (s: number) => {
    const depth = by + uy * s;
    let mk = 0;
    for (let i = 0; i < bodies.length && i < 30; i++) if (bodies[i].fy > depth + 1) mk |= 1 << i;
    return mk;
  };
  for (let s = s0; ; s = Math.min(s1, s + step)) {
    const mk = maskAt(Math.min(s1, s + step / 2));
    if (mask === -1) mask = mk;
    if (mk !== mask || s >= s1) {
      const end = s >= s1 ? s1 : s;
      const mid = (a + end) / 2;
      front(p, bodies, by + uy * mid, () => draw(a, end));
      a = end;
      mask = mk;
      if (s >= s1) break;
    }
  }
}

// ---- Страж: где он, его глаз и грудь ------------------------------------------

const bossOf = (sim: Sim | null): Mob | null =>
  sim?.mobs.find((m) => m.kind === 'f11boss' && m.mode !== 'dying') ?? null;

/** Поза стража так же, как её строит рендер (`DungeonRenderer.mobPose`). */
function bossPose(m: Mob, time: number): MobPose {
  const speed = Math.hypot(m.vx, m.vy);
  const tt = time + m.id * 0.37;
  let anim: MobAnim = 'idle';
  let frame = Math.floor(tt * 4);
  if (m.mode === 'dying' || m.mode === 'escape') {
    anim = 'dead';
    frame = 0;
  } else if (m.mode === 'roar') {
    anim = 'wind';
    frame = m.t < 0.12 ? 0 : 1;
  } else if (m.mode === 'recover') {
    if (m.t < 0.18) {
      anim = 'bite';
      frame = m.t < 0.09 ? 0 : 1;
    } else frame = Math.floor(tt * 5);
  } else if (speed > 0.4) {
    anim = 'run';
    frame = Math.floor(tt * (8 + speed * 2.2));
  }
  const hurt = m.flash > 0 && m.mode !== 'dying' && anim !== 'wind' && anim !== 'bite';
  return {
    anim: hurt ? 'hurt' : anim,
    frame,
    mode: m.mode,
    t: m.t,
    left: Math.cos(m.face) < 0,
    flash: m.flash > 0.05,
    look: 'normal',
    now: time,
  };
}

/**
 * Глаз стража в пикселях мира — из ТОГО ЖЕ кадра, что рисует тело (кадр в
 * кеше рисовальщика, поле `eye`), со сдвигом, сжатием и наклоном кадра, как в
 * `drawMob`. Нет кадра — запасная точка над головой.
 */
function bossEye(m: Mob, time: number, S: number): [number, number] {
  const bx = m.x * S;
  const by = m.y * S;
  let fr: MobFrame | null = null;
  try {
    fr = MOB_PAINTERS.get('f11boss')?.(m, bossPose(m, time)) ?? null;
  } catch {
    fr = null;
  }
  if (!fr || !fr.eye) return [bx + (Math.cos(m.face) < 0 ? -9 : 9), by - 40];
  const x0 = bx - fr.ax + (fr.dx ?? 0);
  const y0 = by + 2 - fr.ay + (fr.dy ?? 0);
  const sx = fr.sx ?? 1;
  const sy = fr.sy ?? 1;
  const rot = fr.rot ?? 0;
  if (sx === 1 && sy === 1 && rot === 0) return [x0 + fr.eye[0] + 0.5, y0 + fr.eye[1] + 0.5];
  const lx = (fr.eye[0] + 0.5 - fr.ax) * sx;
  const ly = (fr.eye[1] + 0.5 - fr.ay) * sy;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return [x0 + fr.ax + lx * c - ly * s, y0 + fr.ay + lx * s + ly * c];
}

/** Ядро в груди: под глазом и чуть к спине (кадр стража смотрит вбок). */
function bossCore(m: Mob, time: number, S: number): [number, number] {
  const [ex, ey] = bossEye(m, time, S);
  const side = Math.cos(m.face) < 0 ? -1 : 1;
  return [ex - 5 * side, ey + 15];
}

/** Сколько клеток до стены по направлению (глубина лучу не преграда) — как в мозге. */
function wallDist(sim: Sim | null, x: number, y: number, ang: number, max: number): number {
  if (!sim) return max;
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  const W = sim.world.w;
  const H = sim.world.h;
  for (let d = 0.25; d <= max; d += 0.25) {
    const cx = Math.floor(x + ux * d);
    const cy = Math.floor(y + uy * d);
    if (cx < 0 || cy < 0 || cx >= W || cy >= H) return d;
    const t = sim.tiles[cy * W + cx];
    if (t !== 11 && !(t === 2 || t === 12 || t === 10 || (t >= 3 && t <= 5))) return d;
  }
  return max;
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

/** Лишние поля визуальных зон мозга. */
type FxZone = Zone & {
  ang?: number;
  boss?: number;
  cells?: number[];
  left?: number;
  pylon?: number;
};

// =============================================================================
// ВЗГЛЯД — линия от стража до стены (не длиннее 15 клеток), полуширина 0,5.
// Глаз ведёт героя 1,05 с (поворот 2,3 рад/с), замирает 0,38 с, луч — в 1,43 с.
// Метка: на полу полоса тёмным багрецом с первого кадра — пока глаз ведёт,
// она шире и мягче и СУЖАЕТСЯ до ширины луча к замиранию; налив бежит от
// стража к стене и доходит до конца ровно к выстрелу. Над полом — тонкий
// прицел из самой линзы, на герое — красная точка. Глаз копит свет: искры
// стягиваются в линзу, на замирании — вспышка-крест и кольцо, сжимающееся
// к выстрелу; последние 0,2 с — белая нить и «тик-тик». Контакт: луч из
// линзы падает на пол перед стражем и идёт до стены (белое ядро, жёлтое,
// оранжевое, красный ореол — ширина ровно как удар), у стены — брызги
// искр; на полу остаётся расплавленный шов, остывает от белого к копоти,
// над ним дым и угольки.
// =============================================================================

const GAZE_T = BOSS.gazeTrack + BOSS.gazeLock;
/** Высота луча над полом, px: на уровне колен героя — читается «по ногам». */
const BEAM_H = 6;
/** Где луч из линзы касается пола, px от стража. */
const BEAM_S1 = 1.5;

function gazeFloor(p: Pen, m: Mob, S: number, time: number): void {
  const tl = m.tele;
  if (!tl || tl.shape !== 'line') return;
  const t = m.t;
  const left = GAZE_T - t;
  const lock = t >= BOSS.gazeTrack;
  const sig = left < SIG;
  const tk = !reduced() && tick(left);
  const a = tl.ang ?? m.face;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const nx = -uy;
  const ny = ux;
  const bx = m.x * S;
  const by = m.y * S;
  const L = tl.r * S;
  const s0 = 1.1 * S;
  if (L <= s0 + 2) return;
  const kt = k01(t / BOSS.gazeTrack);
  const hw0 = BOSS.gazeW * S;
  const hw = lock ? hw0 : hw0 * (1 + 0.85 * (1 - eOut2(kt)));
  // «Куда»: полоса — с первого кадра; сужается, пока глаз ведёт.
  p.col(C.redDk, lock ? 0.3 : 0.08 + 0.14 * kt);
  fillLane(p, bx, by, ux, uy, s0, L, hw, !lock && kt < 0.35);
  // «Когда»: налив от стража к стене доходит до конца ровно к выстрелу.
  const kf = k01(t / GAZE_T);
  const lf = s0 + (L - s0) * Math.pow(kf, 1.7);
  p.col(lock ? C.hot : C.red, lock ? 0.36 : 0.22);
  fillLane(p, bx, by, ux, uy, s0, lf, hw * 0.45);
  // Кромки: пунктир бежит к стене; замер — сплошные и горячие.
  const run = Math.floor(time * (40 + 120 * kf));
  const dash = lock ? undefined : (i: number) => mod(i - run, 8) < 5;
  const ec = sig ? (tk ? C.white : C.yellow) : lock ? C.hot : C.red;
  for (const sd of [-1, 1]) {
    const ex = nx * hw * sd;
    const ey = ny * hw * sd;
    p.col(C.ink, 0.3);
    p.line(
      bx + ux * s0 + ex + 1,
      by + uy * s0 + ey + 1,
      bx + ux * L + ex + 1,
      by + uy * L + ey + 1,
      dash,
    );
    p.col(ec, lock ? 0.95 : 0.5 + 0.4 * kt);
    p.line(bx + ux * s0 + ex, by + uy * s0 + ey, bx + ux * L + ex, by + uy * L + ey, dash);
  }
  // Торец у стены — скобка: сюда упрётся луч.
  p.lineS(
    bx + ux * L + nx * (hw + 2),
    by + uy * L + ny * (hw + 2),
    bx + ux * L - nx * (hw + 2),
    by + uy * L - ny * (hw + 2),
    ec,
    0.9,
  );
  // Замер: вспышка по всей полосе.
  const lt = t - BOSS.gazeTrack;
  if (lock && lt < 0.1) {
    p.col(C.cream, 0.55 * (1 - lt / 0.1));
    fillLane(p, bx, by, ux, uy, s0, L, hw);
  }
  // Тревога: ось — белой нитью.
  if (sig) {
    p.col(tk ? C.white : C.yellow, 0.95);
    p.line(bx + ux * s0, by + uy * s0, bx + ux * L, by + uy * L);
  }
}

function gazeSky(p: Pen, sim: Sim, m: Mob, S: number, time: number, bodies: Body[]): void {
  const tl = m.tele;
  if (!tl || tl.shape !== 'line') return;
  const t = m.t;
  const left = GAZE_T - t;
  const lock = t >= BOSS.gazeTrack;
  const lt = t - BOSS.gazeTrack;
  const sig = left < SIG;
  const tk = !reduced() && tick(left);
  const a = tl.ang ?? m.face;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const bx = m.x * S;
  const by = m.y * S;
  const L = tl.r * S;
  const s1 = BEAM_S1 * S;
  const [ex, ey] = bossEye(m, time, S);
  const kf = k01(t / GAZE_T);
  // Прицел: из линзы на пол перед стражем — и по полу к стене.
  const c = sig ? (tk ? C.white : C.yellow) : lock ? C.hot : C.red;
  const fl = lock ? 0.95 : 0.45 + 0.35 * kf + (Math.floor(time * 24) % 3 === 0 ? 0.15 : 0);
  const fx = bx + ux * s1;
  const fy = by + uy * s1 - 2;
  const dropDepth = by + uy * s1;
  front(p, bodies, dropDepth, () => {
    p.col(c, fl);
    p.line(ex, ey, fx, fy);
  });
  frontRun(p, bodies, bx, by, ux, uy, s1, L, (s0, s2) => {
    p.col(c, fl);
    p.line(bx + ux * s0, by + uy * s0 - 2, bx + ux * s2, by + uy * s2 - 2);
    if (lock) {
      p.col(C.red, 0.45);
      p.line(bx + ux * s0, by + uy * s0 - 1, bx + ux * s2, by + uy * s2 - 1);
    }
  });
  // Точка прицела на герое — его «уже видят».
  const h = sim.hero;
  const hdx = h.x * S - bx;
  const hdy = h.y * S - by;
  const along = hdx * ux + hdy * uy;
  const across = Math.abs(-hdx * uy + hdy * ux);
  if (along > s1 && along < L && across < BOSS.gazeW * S + 5 && Math.floor(time * 16) % 2 === 0) {
    p.col(c, 1);
    p.dot(h.x * S - 1, h.y * S - 9, 2, 2);
    p.col(C.white, 0.9);
    p.dot(h.x * S - 1, h.y * S - 9);
  }
  // Глаз копит свет: искры стягиваются в линзу, свечение растёт.
  const n = reduced() ? 3 : 7;
  for (let i = 0; i < n && !lock; i++) {
    const ph = mod(time * (1.2 + 1.8 * kf) + i / n, 1);
    const rr = 16 * (1 - eIn2(ph));
    const aa = i * 2.4 + time * 5;
    p.col(ph > 0.7 ? C.yellow : C.hot, 0.35 + 0.6 * ph);
    p.dot(ex + Math.cos(aa) * rr, ey + Math.sin(aa) * rr * 0.8);
  }
  p.col(lock ? C.hot : C.red, 0.35);
  disc(p, ex, ey, 2 + 3 * kf + (lock ? 1 : 0));
  p.col(lock ? C.yellow : C.hot, 0.8);
  disc(p, ex, ey, 1 + 1.5 * kf);
  if (lock) {
    // Замер: вспышка-крест, потом кольцо сжимается к выстрелу — таймер.
    if (lt < 0.12) {
      p.col(C.white, 1);
      star(p, ex, ey, 13 * (1 - lt / 0.12) + 4, 4, 0);
    }
    const kl = k01(lt / BOSS.gazeLock);
    ring(p, ex, ey, 3 + 11 * (1 - kl), sig ? C.white : C.yellow, 0.85);
    flare(p, ex, ey, 3 + Math.round(5 * kl), sig && tk ? C.white : C.yellow, 0.9);
  }
}

/** Луч взгляда — зона мозга `f11_beamfx` (0,35 с, поверх темноты): ядро и ореол. */
registerZonePainter(
  'f11_beamfx',
  guarded((g, z0: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const z = z0 as FxZone;
    const sim = paintSim();
    const bx = z.x * S;
    const by = z.y * S;
    const p = new Pen(g, px, py, bx, by);
    const a = z.ang ?? 0;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const L = z.r * S;
    const m = bossOf(sim);
    const [ex, ey] = m ? bossEye(m, time, S) : [bx + (ux < 0 ? -9 : 9), by - 40];
    const t = z.t;
    const life = (z as Zone).life || 0.35;
    // Выстрел: луч выходит за 0,05 с, держится, тоньшает и гаснет к концу зоны.
    const ext = eOut2(k01(t / 0.05));
    const w = t < 0.15 ? 1 : 1 - eIn2(k01((t - 0.15) / (life - 0.15)));
    if (w <= 0) return;
    const jit = Math.floor(time * 30) % 2;
    const s1 = BEAM_S1 * S;
    const Lc = s1 + (L - s1) * ext;
    const fx = bx + ux * s1;
    const fy = by + uy * s1 - BEAM_H;
    const bodies = bodiesOf(sim, S);
    const layers: [number, string, number][] = [
      [(BOSS.gazeW * S + jit) * w, C.red, 0.5],
      [5.2 * w, C.hot, 0.85],
      [3.2 * w, C.yellow, 1],
      [Math.max(0.6, 1.4 * w), C.white, 1],
    ];
    front(p, bodies, by + uy * s1, () => {
      for (const [hw, c, al] of layers) {
        p.col(c, al);
        fillSeg(p, ex, ey, fx, fy, hw * 0.75);
      }
    });
    frontRun(p, bodies, bx, by, ux, uy, s1, Lc, (s0, s2) => {
      for (const [hw, c, al] of layers) {
        p.col(c, al);
        fillLane(p, bx, by - BEAM_H, ux, uy, s0, s2, hw);
      }
    });
    // Перехлёст у пола: свет ложится на плиты под лучом.
    p.col(C.orange, 0.25 * w);
    fillLane(p, bx, by, ux, uy, s1, Lc, BOSS.gazeW * S * 0.7);
    // Дульная вспышка у линзы и огонь в торце.
    p.col(C.white, 1);
    star(p, ex, ey, 4 + 7 * w, 6, time * 3);
    if (ext >= 1) {
      const tx = bx + ux * L;
      const ty = by + uy * L - BEAM_H;
      p.col(C.yellow, 0.9 * w);
      disc(p, tx, ty, 4 + jit * 1.5);
      p.col(C.white, w);
      star(p, tx, ty, 5 + 4 * w, 5, time * 7);
    }
  }),
);

/** Контакт взгляда — на полу: расплавленный шов, жар, дым, искры у стены. */
registerImpactPainter('f11_beam', {
  life: 2.4,
  shake: 0.08,
  flash: 0.2,
  flashRgb: '255,200,150',
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const bx = rec.x * S;
    const by = rec.y * S;
    const p = new Pen(g, px, py, bx, by);
    const a = rec.ang ?? 0;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const nx = -uy;
    const ny = ux;
    const L = (rec.r ?? 8) * S;
    const s0 = 1.3 * S;
    if (L <= s0) return;
    const sd = rec.seed >>> 0;
    const few = reduced();
    const fade = 1 - k01((age - 1.5) / 0.9);
    // Вспышка жара по всей полосе.
    if (age < 0.14) {
      p.col(C.orange, 0.42 * (1 - age / 0.14));
      fillLane(p, bx, by, ux, uy, s0, L, BOSS.gazeW * S);
    }
    // Копоть вдоль шва.
    p.col(C.soot, 0.38 * fade);
    fillLane(p, bx, by, ux, uy, s0, L, 2.5, true);
    // Шов: волнистая раскалённая нить, остывает от белого к тёмному.
    const cool = k01(age / 1.3);
    p.col(heatCol(cool), (0.95 - 0.35 * cool) * fade);
    let px0 = 0;
    let py0 = 0;
    for (let s = s0, i = 0; s <= L; s += 2, i++) {
      const off = Math.round(Math.sin(s * 0.31 + (sd % 7)) * 0.9 + (hash(sd, i, 3) - 0.5) * 1.1);
      const qx = bx + ux * s + nx * off;
      const qy = by + uy * s + ny * off;
      if (i) p.line(px0, py0, qx, qy);
      px0 = qx;
      py0 = qy;
    }
    // Дым вдоль шва.
    const nD = few ? 4 : 9;
    const [wx, wy] = windPx(paintSim(), rec.x, rec.y);
    dust(
      p,
      sd,
      age,
      bx,
      by,
      nD,
      -PI / 2,
      0.5,
      4,
      6,
      2,
      6,
      14,
      1.3,
      1,
      0.5,
      (i) => 0.06 + 0.35 * hash(sd, i, 5),
      (i) => {
        const s = s0 + (L - s0) * ((i + hash(sd, i, 6)) / nD);
        return [bx + ux * s, by + uy * s, -PI / 2];
      },
      [wx * 6, wy * 6],
    );
    // Угольки поднимаются со шва.
    embers(
      p,
      sd + 1,
      age,
      few ? 5 : 12,
      0.9,
      12,
      (i) => 0.05 + 0.6 * hash(sd, i, 7),
      (i) => {
        const s = s0 + (L - s0) * hash(sd, i, 8);
        return [bx + ux * s, by + uy * s];
      },
    );
    // У стены: брызги искр назад и в стороны, капли металла.
    const ex = bx + ux * L;
    const ey = by + uy * L;
    sparks(p, sd + 2, age, ex, ey, few ? 6 : 14, a + PI, 1.3, 50, 90, 0.55, 70);
    chunks(p, sd + 3, age, ex, ey, few ? 2 : 5, a + PI, 1, 20, 30, 40, 60, [0.8, 1.2], 0.2, 0);
  }),
});

// =============================================================================
// КУЛАКИ — круг r 1,8 в точке героя, удар через 0,9 с. Страж вскидывает руки
// и бьёт оземь — а в точке удара с неба падают два каменных кулака-проекции
// с бирюзовой вязью рун. Метка: круг с первого кадра (кромка пунктиром
// бежит, четыре уголка прицела сходятся к кромке к удару), в нём — ТЕНЬ
// кулаков: мягкая и маленькая, пока они высоко, растёт и темнеет по мере
// падения; кулаки падают с разгоном, в конце — полосы скорости. Последние
// 0,2 с — белая кромка и «тик-тик». Контакт: белая звезда, кратер,
// трещины звездой, ударная волна, мраморная крошка с отскоками, пыль
// клубами по ветру, кулаки рассыпаются бирюзовыми искрами.
// =============================================================================

/** Когда кулаки появляются в небе и на какой высоте, px. */
const FIST_T0 = 0.2;
const FIST_Z = 104;

function slamFloor(p: Pen, m: Mob, S: number, time: number): void {
  const T = BOSS.slamWarn;
  const t = m.t;
  const k = k01(t / T);
  const left = T - t;
  const sig = left < SIG;
  const tk = !reduced() && tick(left);
  const tx = (m.data.tx ?? m.x) * S;
  const ty = (m.data.ty ?? m.y) * S;
  const R = BOSS.slamR * S;
  const sd = (m.id * 977 + Math.floor((m.data.tx ?? 0) * 31)) >>> 0;
  // «Куда»: круг с первого кадра, заливка густеет.
  p.col(C.red, 0.06 + 0.13 * k);
  disc(p, tx, ty, R);
  // Тень кулаков: растёт и темнеет по мере падения.
  const u = k01((t - FIST_T0) / (T - FIST_T0));
  const sz = 7 + 13 * eIn2(Math.max(k * 0.6, u));
  const sh = fistShadow(sz, u < 0.5);
  p.alpha(0.18 + 0.5 * Math.max(k * 0.5, u));
  p.img(sh, tx - sh.width / 2, ty + 2 - sh.height / 2);
  // Кромка: пунктир бежит, к удару — сплошная.
  const run = time * (24 + 70 * k);
  const rc = sig ? (tk ? C.white : C.yellow) : k > 0.6 ? C.hot : C.red;
  ring(p, tx, ty, R + 1, C.ink, 0.45);
  ring(p, tx, ty, R, rc, 0.7 + 0.3 * k, sig ? undefined : (ang) => mod(ang * R - run, 10) < 6.5);
  // «Когда»: уголки прицела сходятся к кромке ровно к удару.
  const rr = R + 12 * (1 - eOut2(k));
  for (let i = 0; i < 4; i++) {
    const th = i * (PI / 2) + PI / 4 + time * 0.6;
    const cx = tx + Math.cos(th) * rr;
    const cy = ty + Math.sin(th) * rr;
    for (const s of [-1, 1]) {
      const bx = cx - Math.cos(th) * 3 + Math.cos(th + (s * PI) / 2) * 3;
      const by = cy - Math.sin(th) * 3 + Math.sin(th + (s * PI) / 2) * 3;
      p.lineS(cx, cy, bx, by, rc, 0.85, 0.5);
    }
  }
  // Крошка на плитах дрожит — всё сильнее.
  for (let i = 0; i < 12; i++) {
    const r0 = R * (0.15 + 0.8 * hash(sd, i, 5));
    const aa = hash(sd, i, 6) * TAU;
    const hop = k > 0.25 ? Math.floor(hash(i, Math.floor(time * 18), sd) * (1 + 3 * k)) : 0;
    const gx = tx + Math.cos(aa) * r0;
    const gy = ty + Math.sin(aa) * r0;
    if (hop) {
      p.col(C.ink, 0.35);
      p.dot(gx, gy + 1);
    }
    p.col(C.pebble, 0.9);
    p.dot(gx, gy - hop);
  }
}

function slamSky(p: Pen, m: Mob, S: number, time: number): void {
  const T = BOSS.slamWarn;
  const t = m.t;
  if (t < FIST_T0) return;
  const u = k01((t - FIST_T0) / (T - FIST_T0));
  const tx = (m.data.tx ?? m.x) * S;
  const ty = (m.data.ty ?? m.y) * S;
  // Падают с разгоном: высоко — медленно, у земли — рывком.
  const z = FIST_Z * (1 - Math.pow(u, 2.3));
  const fadeIn = k01((t - FIST_T0) / 0.14);
  const L = fistImg(true);
  const Rr = fistImg(false);
  // Полосы скорости над кулаками.
  if (u > 0.5) {
    const v = (u - 0.5) / 0.5;
    p.col(C.ice, 0.55 * v);
    for (let i = 0; i < 6; i++) {
      const x = tx - 14 + i * 5.5 + (i % 2);
      const y0 = ty - z - 14 - hash(i, 3, 17) * 6;
      p.line(x, y0 - 8 - 22 * v, x, y0);
    }
  }
  // Свет рун от кулаков на земле — сверху вниз ярче.
  p.col(C.rune, 0.12 + 0.25 * u);
  disc(p, tx, ty + 1, 6 + 10 * u, true);
  p.alpha(0.55 + 0.4 * fadeIn * (0.6 + 0.4 * u));
  p.img(L, tx - 10 - L.width / 2, ty - z - L.height + 3);
  p.img(Rr, tx + 10 - Rr.width / 2, ty - z - Rr.height + 3);
  // Мерцание вязи: кулак — проекция, а не камень.
  if (Math.floor(time * 20) % 3 === 0) {
    p.col(C.cyan, 0.35);
    p.dot(tx - 10, ty - z - 9, 2, 1);
    p.dot(tx + 9, ty - z - 9, 2, 1);
  }
}

registerImpactPainter('f11_slam', {
  life: 1.8,
  shake: 0.12,
  flash: 0.14,
  flashRgb: '220,255,250',
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const cx = rec.x * S;
    const cy = rec.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = (rec.r ?? BOSS.slamR) * S;
    const sd = rec.seed >>> 0;
    const few = reduced();
    const fade = 1 - k01((age - 1.25) / 0.55);
    // Кратер: вмятина с тёмным краем сверху-слева и светлым снизу-справа.
    p.col(C.shade, 0.55 * fade);
    disc(p, cx, cy + 1, 9);
    p.col(C.groove, 0.6 * fade);
    disc(p, cx - 1, cy, 6);
    ring(p, cx, cy + 1, 10, C.lip, 0.7 * fade, (a) => a > -0.3 && a < 2.2);
    ring(p, cx, cy + 1, 10, C.groove, 0.6 * fade, (a) => a < -1.2 || a > 2.6);
    // Трещины звездой: бегут от удара за 0,12 с.
    const ck = crackOf(
      `slam|${sd % 61}`,
      sd,
      starBranches(sd, 7, hash(sd, 0, 1) * TAU, R * 0.5, R * 1.05, 3),
      0.5,
      0.25,
    );
    const reach = ck.max * eOut3(k01(age / 0.12));
    drawCrack(p, ck, cx, cy, reach, C.groove, C.lip, fade);
    // Вспышка: белая звезда, бирюзовая кайма.
    if (age < 0.1) {
      const k = age / 0.1;
      p.col(C.cyan, 0.9);
      star(p, cx, cy - 3, 26 * (1 - 0.4 * k), 8, 0.2);
      p.col(C.white, 1);
      star(p, cx, cy - 3, 18 * (1 - 0.5 * k), 8, 0.2);
    }
    // Ударная волна: светлый фронт и пыльный пояс за ним.
    if (age < 0.32) {
      const k = age / 0.32;
      const rw = R * (0.3 + 0.95 * eOut2(k));
      p.col(C.dust, 0.4 * (1 - k));
      fillSector(p, cx, cy, Math.max(0, rw - 6), rw, 0, TAU);
      ring(p, cx, cy, rw, C.white, 1 - k, (_a, i) => hash(i >> 2, sd, 9) > 0.2, 0.6);
    }
    // Пыль клубами по кругу, сносит ветром.
    const [wx, wy] = windPx(paintSim(), rec.x, rec.y);
    const nD = few ? 6 : 12;
    dust(
      p,
      sd,
      age,
      cx,
      cy,
      nD,
      0,
      0.3,
      30,
      22,
      2,
      7,
      5,
      1.1,
      0,
      0.75,
      (i) => 0.02 + 0.06 * hash(sd, i, 8),
      (i) => {
        const th = (i / nD) * TAU + 0.3;
        return [cx + Math.cos(th) * R * 0.55, cy + Math.sin(th) * R * 0.55, th];
      },
      [wx * 8, wy * 8],
    );
    // Мраморная крошка: веером, с отскоками; изредка — смальта мозаики.
    const nC = few ? 6 : 14;
    chunks(
      p,
      sd + 9,
      age,
      cx,
      cy,
      nC,
      0,
      0.35,
      30,
      45,
      50,
      80,
      [1.1, 1.6],
      0.4,
      0,
      undefined,
      (i) => {
        const th = (i / nC) * TAU + hash(sd, i, 10);
        return [cx + Math.cos(th) * R * 0.25, cy + Math.sin(th) * R * 0.25, th];
      },
    );
    chunks(p, sd + 19, age, cx, cy, few ? 2 : 4, 0, PI, 20, 30, 60, 60, [1.0, 1.5], 0.2, 3);
    // Кулаки рассыпаются бирюзовыми искрами.
    sparks(p, sd + 4, age, cx, cy - 6, few ? 6 : 14, -PI / 2, PI * 0.9, 50, 80, 0.55, 90, runeCol);
  }),
});

// =============================================================================
// ТОПОТ — кольцо r 2,3, толщина 1 (пояс 1,3…3,3 клетки), удар через 0,65 с.
// Метка: пояс с первого кадра (внутренняя и внешняя кромки — пунктиром
// навстречу друг другу), налив растёт от внутренней кромки к внешней и
// касается её в миг удара; по плитам бежит дрожь, крошка подпрыгивает.
// Последние 0,2 с — кромки белые, «тик-тик». Контакт: ударная волна
// проходит пояс за 0,2 с, плиты в поясе вскидывает крошкой, трещины
// лучами и обрывками по кругу, пыль кольцом — по ветру.
// =============================================================================

function stompFloor(p: Pen, m: Mob, S: number, time: number): void {
  const T = BOSS.stompWarn;
  const t = m.t;
  const k = k01(t / T);
  const left = T - t;
  const sig = left < SIG;
  const tk = !reduced() && tick(left);
  const bx = m.x * S;
  const by = m.y * S;
  const R0 = (BOSS.stompR - BOSS.stompW) * S;
  const R1 = (BOSS.stompR + BOSS.stompW) * S;
  p.col(C.red, 0.06 + 0.12 * k);
  fillSector(p, bx, by, R0, R1, 0, TAU);
  // «Когда»: налив от внутренней кромки — к внешней ровно к удару.
  const rf = R0 + (R1 - R0) * Math.pow(k, 1.35);
  p.col(C.hot, 0.14 + 0.12 * k);
  fillSector(p, bx, by, R0, rf, 0, TAU);
  ring(p, bx, by, rf, C.hot, 0.5 + 0.4 * k, (_a, i) => i % 3 !== 0);
  // Кромки — пунктиром навстречу друг другу.
  const run = time * (30 + 80 * k);
  const rc = sig ? (tk ? C.white : C.yellow) : k > 0.55 ? C.hot : C.red;
  for (const [R, dir] of [
    [R0, 1],
    [R1, -1],
  ]) {
    ring(p, bx, by, R + 1, C.ink, 0.4);
    ring(
      p,
      bx,
      by,
      R,
      rc,
      0.7 + 0.3 * k,
      sig ? undefined : (ang) => mod(ang * R * dir - run, 9) < 6,
    );
  }
  // Дрожь: крошка в поясе подпрыгивает.
  const sd = m.id * 131;
  for (let i = 0; i < 18; i++) {
    const r0 = R0 + (R1 - R0) * hash(sd, i, 5);
    const aa = hash(sd, i, 6) * TAU;
    const hop = k > 0.2 ? Math.floor(hash(i, Math.floor(time * 20), sd) * (1 + 3 * k)) : 0;
    const gx = bx + Math.cos(aa) * r0;
    const gy = by + Math.sin(aa) * r0;
    if (hop) {
      p.col(C.ink, 0.35);
      p.dot(gx, gy + 1);
    }
    p.col(C.pebble, 0.9);
    p.dot(gx, gy - hop);
  }
}

registerImpactPainter('f11_stomp', {
  life: 1.7,
  shake: 0.12,
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const cx = rec.x * S;
    const cy = rec.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const r = rec.r ?? BOSS.stompR;
    const w = rec.w ?? BOSS.stompW;
    const R0 = (r - w) * S;
    const R1 = (r + w) * S;
    const sd = rec.seed >>> 0;
    const few = reduced();
    const fade = 1 - k01((age - 1.2) / 0.5);
    // Трещины лучами от ступни — через весь пояс.
    const ck = crackOf(
      `stomp|${sd % 53}`,
      sd,
      starBranches(sd, 9, hash(sd, 0, 1) * TAU, R1 * 0.8, R1 * 1.05, 3),
      0.45,
      0.2,
    );
    drawCrack(p, ck, cx, cy, ck.max * eOut3(k01(age / 0.16)), C.groove, C.lip, fade);
    // Обрывки трещин по внешней кромке.
    const rk = eOut2(k01((age - 0.05) / 0.15));
    if (rk > 0)
      ring(
        p,
        cx,
        cy,
        R1 - 2,
        C.groove,
        0.75 * fade,
        (a, i) => hash(i >> 3, sd, 5) > 0.45 && mod(a + PI, TAU) / TAU < rk,
      );
    // Ударная волна проходит пояс.
    if (age < 0.3) {
      const k = age / 0.3;
      const rw = R0 * 0.6 + (R1 + 8 - R0 * 0.6) * eOut2(k);
      p.col(C.dust, 0.45 * (1 - k));
      fillSector(p, cx, cy, Math.max(0, rw - 7), rw, 0, TAU);
      ring(p, cx, cy, rw, C.white, 1 - k, (_a, i) => hash(i >> 2, sd, 9) > 0.18, 0.6);
    }
    // Плиты пояса вскидывает крошкой — наружу.
    const nC = few ? 8 : 20;
    chunks(
      p,
      sd + 9,
      age,
      cx,
      cy,
      nC,
      0,
      0.25,
      25,
      40,
      45,
      80,
      [1.1, 1.6],
      0.35,
      0,
      (i) => 0.02 * hash(sd, i, 4),
      (i) => {
        const th = (i / nC) * TAU + hash(sd, i, 10) * 0.5;
        const rr = R0 + (R1 - R0) * hash(sd, i, 11);
        return [cx + Math.cos(th) * rr, cy + Math.sin(th) * rr, th];
      },
    );
    // Пыль кольцом по внешней кромке — по ветру.
    const [wx, wy] = windPx(paintSim(), rec.x, rec.y);
    const nD = few ? 8 : 16;
    dust(
      p,
      sd,
      age,
      cx,
      cy,
      nD,
      0,
      0.25,
      26,
      18,
      2,
      7,
      5,
      1.1,
      0,
      0.7,
      (i) => 0.06 + 0.06 * hash(sd, i, 8),
      (i) => {
        const th = (i / nD) * TAU;
        return [cx + Math.cos(th) * R1 * 0.95, cy + Math.sin(th) * R1 * 0.95, th];
      },
      [wx * 8, wy * 8],
    );
  }),
});

// =============================================================================
// РАКЕТЫ — пять навесом с 0,7 с через 0,13 с; ветер этажа сносит их в полёте
// вместе с точкой падения (мозг двигает `lob.x1/y1`). Ракета выходит из люка
// на плече (а не из пола у ног: снаряд движка стартует на земле — рисунок
// ведёт её от люка и сводит на путь движка к падению), летит носом по
// экранной скорости, крутится полосой вязи, за ней — шлейф дыма: клубы
// остаются там, где она пролетела, раздуваются, уходят по ветру и тают.
// Метка падения: круг с кольцом, сходящимся к кромке ровно в миг падения,
// уголки прицела, штрихи сноса по ветру. До залпа из люков сочится дым;
// на каждый пуск — вспышка у люка. Контакт: белая вспышка, огненный шар
// уходит вверх копотью, ударное кольцо, искры и крошка. На полу — лужа
// огня (`f11_scorch`, 1,1 с): копоть, языки пламени садятся, угольки.
// =============================================================================

/** Высота люков над полом, px. */
const HATCH_Z = 36;

/** Люк, из которого вышла ракета: смещение от точки старта снаряда, px. */
function rocketHatch(vx: number, vy: number, S: number): [number, number] {
  const a = Math.atan2(vy, vx);
  const side = Math.cos(a) >= 0 ? 1 : -1;
  return [-Math.cos(a) * 1.4 * S + side * 10, -Math.sin(a) * 1.4 * S - HATCH_Z];
}

interface RocketPath {
  x0: number;
  y0: number;
  vx: number;
  vy: number;
  T: number;
  /** Снос ветром, клеток в секунду (оценка по нынешнему отходу от пути). */
  dx: number;
  dy: number;
  hx: number;
  hy: number;
}

function rocketPath(s: Shot, S: number): RocketPath | null {
  const lob = s.lob;
  if (!lob) return null;
  const age = Math.max(0.01, s.age);
  const [hx0, hy0] = rocketHatch(s.vx, s.vy, S);
  return {
    x0: lob.x0,
    y0: lob.y0,
    vx: s.vx,
    vy: s.vy,
    T: lob.T,
    dx: (s.x - (lob.x0 + s.vx * s.age)) / age,
    dy: (s.y - (lob.y0 + s.vy * s.age)) / age,
    hx: hx0,
    hy: hy0,
  };
}

/** Где на экране (пиксели мира) ракета в возрасте τ: путь движка, высота навеса, люк. */
function rocketAt(r: RocketPath, tau: number, S: number): [number, number] {
  const k = k01(tau / r.T);
  const Hc = Math.min(3, r.T * 2.2) * S;
  const f = (1 - k) * (1 - k);
  const gx = (r.x0 + (r.vx + r.dx) * tau) * S;
  const gy = (r.y0 + (r.vy + r.dy) * tau) * S;
  return [gx + r.hx * f, gy - Math.sin(k * PI) * Hc + r.hy * f];
}

/** Ракета: латунный корпус, полоса вязи (крутится), стабилизаторы, нос, пламя. */
function rocketImg(d: number, f: number, roll: number): HTMLCanvasElement {
  return spr(90000 + (d & 15) * 8 + (f % 3) * 2 + (roll & 1), () => {
    const p = new Px(18, 18);
    const a = ((d & 15) / 16) * TAU;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const brass = [hx('#4a3412'), hx('#86622a'), hx('#c09a48'), hx('#f0d890')];
    const fire = C.fire.map((c) => hx(c));
    const flameL = 3.5 + (f % 3);
    for (let y = 0; y < 18; y++)
      for (let x = 0; x < 18; x++) {
        const dx = x + 0.5 - 9;
        const dy = y + 0.5 - 9;
        const u = dx * ca + dy * sa;
        const v = -dx * sa + dy * ca;
        const av = Math.abs(v);
        // Свет сверху-слева: нормаль поперёк корпуса против направления света.
        const nlx = -sa * Math.sign(v || 1);
        const nly = ca * Math.sign(v || 1);
        const lit = (nlx * -0.55 + nly * -0.83) * (av / 1.8);
        if (u >= -4.5 && u <= 3 && av <= 1.8) {
          let c = lit > 0.35 ? brass[3] : lit > -0.2 ? brass[2] : lit > -0.6 ? brass[1] : brass[0];
          if (u > -1.5 + roll * 1.2 && u < -0.4 + roll * 1.2)
            c = av < 0.9 ? hx('#bff8ee') : hx('#2fa0a4');
          p.set(x, y, c);
        } else if (u > 3 && u <= 6.2 && av <= 1.8 * (1 - (u - 3) / 3.4)) {
          p.set(x, y, u > 5.2 ? hx('#e84a3a') : lit > 0 ? hx('#7c8290') : hx('#3c4048'));
        } else if (
          u >= -4.5 &&
          u <= -2.2 &&
          av > 1.8 &&
          av <= 3.4 &&
          av - 1.8 <= (-2.2 - u) * 0.9
        ) {
          p.set(x, y, brass[lit > 0 ? 2 : 0]);
        } else if (
          u < -4.5 &&
          u >= -4.5 - flameL &&
          av <= 1.5 * (1 - (-4.5 - u) / (flameL + 0.5))
        ) {
          const q = (-4.5 - u) / flameL;
          p.set(x, y, q < 0.3 ? fire[4] : q < 0.6 ? fire[3] : fire[2]);
        }
      }
    p.outline(hx(C.ink));
    return p;
  });
}

registerShotPainter('f11_rocket', (s, time) => {
  const S = 16;
  const r = rocketPath(s, S);
  if (!r) {
    const a = Math.atan2(s.vy, s.vx);
    const img = rocketImg(Math.round((a / TAU) * 16), Math.floor(time * 20), Math.floor(time * 14));
    return { img, ax: 9, ay: 9 };
  }
  const [x1, y1] = rocketAt(r, s.age, S);
  const [x0, y0] = rocketAt(r, Math.max(0, s.age - 0.025), S);
  const a = Math.atan2(y1 - y0, x1 - x0);
  const d = mod(Math.round((a / TAU) * 16), 16);
  const img = rocketImg(d, Math.floor(time * 20), Math.floor(time * 14));
  // Движок рисует снаряд в (земля − высота навеса); рисунок добавляет путь от люка.
  const k = k01(s.age / r.T);
  const f = (1 - k) * (1 - k);
  return { img, ax: 9 - r.hx * f, ay: 9 - r.hy * f } as Sprite;
});

/** Прицел падения: круг, кольцо сходится к кромке к падению, снос ветром. */
function rocketReticle(p: Pen, sim: Sim, s: Shot, S: number, time: number): void {
  const lob = s.lob;
  if (!lob) return;
  const cx = lob.x1 * S;
  const cy = lob.y1 * S;
  const R = s.r * S;
  const k = k01(s.age / lob.T);
  const left = lob.T - s.age;
  const sig = left < SIG;
  const tk = !reduced() && tick(left);
  const rc = sig ? (tk ? C.white : C.yellow) : k > 0.6 ? C.hot : C.red;
  p.col(C.red, 0.07 + 0.2 * k);
  disc(p, cx, cy, R);
  ring(p, cx, cy, R + 1, C.ink, 0.45);
  ring(p, cx, cy, R, rc, 0.75 + 0.25 * k);
  const rr = R + R * 1.1 * (1 - eOut2(k));
  const run = time * 40;
  ring(p, cx, cy, rr, rc, 0.45 + 0.4 * k, (ang) => mod(ang * rr + run, 8) < 4);
  for (let i = 0; i < 4; i++) {
    const th = (i * PI) / 2 + time * 1.5;
    const ox = Math.cos(th);
    const oy = Math.sin(th);
    p.lineS(
      cx + ox * (rr + 4),
      cy + oy * (rr + 4),
      cx + ox * (rr - 1),
      cy + oy * (rr - 1),
      rc,
      0.9,
      0.5,
    );
  }
  p.col(rc, 0.9);
  p.dot(cx - 1, cy, 3, 1);
  p.dot(cx, cy - 1, 1, 3);
  // Снос ветром: штрихи позади прицела — куда его тащит.
  const [wx, wy] = windPx(sim, lob.x1, lob.y1);
  const w = Math.hypot(wx, wy);
  if (w > 0.6) {
    const ux = wx / w;
    const uy = wy / w;
    p.col(C.white, 0.6);
    for (let j = -1; j <= 1; j++) {
      const ph = mod(time * 2.2 + j * 0.33, 1);
      const bx = cx - ux * (R + 4 + ph * 8) - uy * j * 5;
      const by = cy - uy * (R + 4 + ph * 8) + ux * j * 5;
      p.line(bx, by, bx - ux * (3 + w * 1.5), by - uy * (3 + w * 1.5));
    }
  }
}

/** Шлейф ракет: путь помнит рендер (снаряд исчезает при падении, дым — нет). */
interface Trail {
  r: RocketPath;
  age: number;
  /** Время рендера, когда снаряд пропал (лёг), или null. */
  dead: number | null;
  seen: number;
  seed: number;
}

/** Память рисунка на вылазку: шлейфы, пилоны (их убирают раньше, чем доиграл взрыв). */
interface Mem {
  trails: Map<number, Trail>;
  pylons: Map<number, { x: number; y: number; t: number | null; seen: number }>;
}
const mems = new WeakMap<Sim, Mem>();
const memOf = (sim: Sim): Mem => {
  let m = mems.get(sim);
  if (!m) {
    m = { trails: new Map(), pylons: new Map() };
    mems.set(sim, m);
  }
  return m;
};

const PUFF_DT = 0.03;
const PUFF_LIFE = 0.85;

function rocketTrails(p: Pen, sim: Sim, S: number, time: number): void {
  const mem = memOf(sim);
  for (const s of sim.shots) {
    if (s.art !== 'f11_rocket' || !s.lob) continue;
    const r = rocketPath(s, S);
    if (!r) continue;
    const tr = mem.trails.get(s.id);
    if (tr) {
      tr.r = r;
      tr.age = s.age;
      tr.seen = time;
    } else
      mem.trails.set(s.id, { r, age: s.age, dead: null, seen: time, seed: (s.id * 7919) >>> 0 });
    // Пуск: вспышка у люка, клуб дыма.
    if (s.age < 0.09) {
      const [lx, ly] = rocketAt(r, 0, S);
      const k = s.age / 0.09;
      p.col(C.white, 1 - k);
      star(p, lx, ly, 7 * (1 - k) + 2, 6, 0.3);
      p.col(C.yellow, 0.8 * (1 - k));
      disc(p, lx, ly, 3);
    }
  }
  const [wx, wy] = windPx(sim, sim.hero.x, sim.hero.y);
  const few = reduced();
  for (const [id, tr] of mem.trails) {
    if (tr.seen !== time && tr.dead === null) tr.dead = time;
    const now = tr.dead === null ? tr.age : tr.age + (time - tr.dead);
    if (tr.dead !== null && time - tr.dead > PUFF_LIFE + 0.4) {
      mem.trails.delete(id);
      continue;
    }
    const last = Math.min(tr.age, tr.r.T);
    for (let i = 0, tau = 0; tau <= last; i++, tau += few ? PUFF_DT * 2 : PUFF_DT) {
      const pa = now - tau;
      const L = PUFF_LIFE * (0.8 + 0.4 * hash(tr.seed, i, 1));
      if (pa < 0 || pa >= L) continue;
      const k = pa / L;
      const [x, y] = rocketAt(tr.r, tau, S);
      const ox = wx * 7 * pa + (hash(tr.seed, i, 2) - 0.5) * 3;
      const oy = wy * 7 * pa - 10 * eOut2(k) + (hash(tr.seed, i, 3) - 0.5) * 2;
      const hot = pa < 0.07;
      const im = puffImg(hot ? 4 : 2, hot ? 1.5 : 1.2 + 3.2 * eOut2(k01(pa / 0.45)), i);
      p.alpha(hot ? 0.95 : 0.7 * Math.pow(1 - k, 1.3));
      p.img(im, x + ox - im.width / 2, y + oy - im.height / 2);
    }
  }
}

/** До залпа из люков сочится дым, люки тлеют. */
function rocketsSky(p: Pen, m: Mob, S: number, time: number): void {
  const t = m.t;
  if (t > BOSS.rocketWind + 0.1) return;
  const bx = m.x * S;
  const by = m.y * S;
  const k = k01(t / BOSS.rocketWind);
  for (const side of [-1, 1]) {
    const hx0 = bx + side * 10;
    const hy0 = by - HATCH_Z;
    dust(
      p,
      m.id * 31 + side,
      t,
      hx0,
      hy0,
      6,
      -PI / 2,
      0.45,
      5,
      8,
      1,
      3.5,
      12,
      0.8,
      2,
      0.55 * (0.4 + 0.6 * k),
      (i) => i * 0.11,
    );
    if (Math.floor(time * (8 + 16 * k)) % 2 === 0) {
      p.col(C.hot, 0.9);
      p.dot(hx0 - 1, hy0 + 1, 3, 1);
    }
  }
}

registerImpactPainter('f11_rocket', {
  life: 1.5,
  shake: 0.1,
  flash: 0.1,
  flashRgb: '255,190,120',
  above: true,
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const cx = rec.x * S;
    const cy = rec.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const sd = rec.seed >>> 0;
    const few = reduced();
    const [wx, wy] = windPx(paintSim(), rec.x, rec.y);
    // Вспышка.
    if (age < 0.08) {
      const k = age / 0.08;
      p.col(C.yellow, 1);
      star(p, cx, cy - 4, 15 * (1 - 0.4 * k), 8, 0.4);
      p.col(C.white, 1);
      disc(p, cx, cy - 4, 6 * (1 - k) + 2);
    }
    // Ударное кольцо по полу.
    if (age < 0.22) {
      const k = age / 0.22;
      ring(
        p,
        cx,
        cy,
        6 + 26 * eOut2(k),
        C.cream,
        0.9 * (1 - k),
        (_a, i) => hash(i >> 2, sd, 4) > 0.2,
        0.5,
      );
    }
    // Огненный шар уходит вверх и темнеет в копоть.
    dust(
      p,
      sd,
      age,
      cx,
      cy - 3,
      few ? 4 : 7,
      -PI / 2,
      1.1,
      30,
      30,
      3,
      8,
      16,
      0.5,
      4,
      0.95,
      (i) => 0.01 * i,
    );
    dust(
      p,
      sd + 1,
      age,
      cx,
      cy - 6,
      few ? 4 : 8,
      -PI / 2,
      0.9,
      14,
      18,
      3,
      9,
      26,
      1.4,
      1,
      0.7,
      (i) => 0.12 + 0.05 * i,
      undefined,
      [wx * 9, wy * 9],
    );
    sparks(p, sd + 2, age, cx, cy - 2, few ? 6 : 14, 0, PI, 60, 90, 0.6, 80);
    chunks(p, sd + 3, age, cx, cy, few ? 3 : 6, 0, PI, 25, 35, 50, 70, [1.0, 1.4], 0.3, 0);
  }),
});

/** Лужа огня от ракеты (1,1 с, жжёт): копоть, языки пламени садятся, угольки. */
registerZonePainter(
  'f11_scorch',
  guarded((g, z0: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const z = z0 as Zone;
    const cx = z.x * S;
    const cy = z.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const k = k01(z.t / z.life);
    const R = z.r * S;
    const sd = ((z.id >>> 0) * 2654435761) >>> 0;
    const soot = sootImg(R * 0.9, 1);
    p.alpha(0.75 * (1 - k * k));
    p.img(soot, cx - soot.width / 2, cy - soot.height / 2);
    // Тлеющий край — где жжёт.
    ring(p, cx, cy, R * 0.85, C.fire[2], 0.55 * (1 - k), (_a, i) => hash(i >> 1, sd, 3) > 0.35);
    const n = reduced() ? 3 : 6;
    for (let i = 0; i < n; i++) {
      const aa = hash(sd, i, 1) * TAU;
      const rr = R * 0.7 * Math.sqrt(hash(sd, i, 2));
      const h = (5 + 6 * hash(sd, i, 4)) * (1 - k) * (0.8 + 0.2 * Math.sin(time * 13 + i));
      if (h < 2) continue;
      const fl = flameImg(h, Math.floor(time * 12 + i));
      p.alpha(1);
      p.img(
        fl,
        cx + Math.cos(aa) * rr - fl.width / 2,
        cy + Math.sin(aa) * rr * 0.75 - fl.height + 1,
      );
    }
    embers(
      p,
      sd,
      z.t,
      8,
      0.6,
      12,
      (i) => i * 0.12,
      (i) => [cx + (hash(sd, i, 6) - 0.5) * R * 1.2, cy + (hash(sd, i, 7) - 0.5) * R * 0.8],
    );
  }),
);

// =============================================================================
// ЛУЧИ ВРАЩЕНИЯ (3-я фаза) — заряд 0,95 с, потом 3,3 с два луча из груди
// (от 1,7 клетки, до стены, не длиннее 13) крутятся 1,2 рад/с в сторону
// `sdir`; угол — `m.data.sa`, тот же, что считает урон. Одна зона мозга
// `f11v_spin` на весь режим (поверх темноты); пол под лучами рисует
// «режиссёр» на полу. Заряд: в ядро стягиваются искры жара, свечение
// растёт; на полу — две направляющие до стены пунктиром и шевроны поперёк:
// КУДА повернут лучи; клин первых мгновений хода наливается. Последние
// 0,2 с — направляющие белые, «тик-тик». Пуск: вспышка ядра, лучи выходят
// из груди и опускаются к колену героя (так читается «по ногам», а не над
// головой); ядро белое, жёлтое, оранжевое, ореол — ширина как удар; по лучу
// бегут сгустки — энергия идёт наружу; у стены — фонтан искр и раскалённое
// пятно. На полу под лучом — жаркая полоса, за лучом — выжженный клин,
// остывающий в копоть; перед лучом — слабый отсвет «сейчас сюда».
// Тела ближе к камере луч заслоняют. Конец: лучи втягиваются в ядро.
// =============================================================================

const SPIN_CH = BOSS.spinCharge;
const SPIN_END = BOSS.spinCharge + BOSS.spinDur;
/** Высота луча над полом, px. */
const SPIN_H = 9;
/** Полуширина удара луча, px (мозг: 0,42 клетки). */
const SPIN_HW = 0.42;

interface SpinNow {
  m: Mob;
  /** Фаза: 0…1 заряд, 1 — бьёт, 2 — втягивается. */
  stage: 0 | 1 | 2;
  /** Доля внутри фазы. */
  k: number;
  sa: number;
  sdir: number;
}

function spinNow(sim: Sim, z: FxZone): SpinNow | null {
  const m = sim.mobs.find((q) => q.id === z.boss && q.kind === 'f11boss');
  if (!m || m.mode === 'dying') return null;
  const sa = m.data.sa ?? m.face;
  const sdir = m.data.sdir || 1;
  if (m.mode === 'f11_spin') {
    if (m.t < SPIN_CH) return { m, stage: 0, k: k01(m.t / SPIN_CH), sa, sdir };
    return { m, stage: 1, k: k01((m.t - SPIN_CH) / BOSS.spinDur), sa, sdir };
  }
  if (m.mode === 'recover' && z.t >= SPIN_END - 0.05 && m.t < 0.3)
    return { m, stage: 2, k: k01(m.t / 0.25), sa, sdir };
  return null;
}

/** Луч: корень и конец вдоль пола, px от стража. */
function spinReach(sim: Sim, m: Mob, a: number, S: number): [number, number, boolean] {
  const x0 = m.x + Math.cos(a) * BOSS.beamR0;
  const y0 = m.y + Math.sin(a) * BOSS.beamR0;
  const len = wallDist(sim, x0, y0, a, BOSS.beamLen);
  return [BOSS.beamR0 * S, (BOSS.beamR0 + len) * S, len < BOSS.beamLen - 0.3];
}

/** Пол: направляющие и клин на заряде; жаркая полоса, выжженный след на ходу. */
function spinFloor(p: Pen, sim: Sim, z: FxZone, S: number, time: number): void {
  const st = spinNow(sim, z);
  if (!st) return;
  const { m, stage, k, sa, sdir } = st;
  const bx = m.x * S;
  const by = m.y * S;
  const hw = SPIN_HW * S;
  if (stage === 0) {
    const left = SPIN_CH - m.t;
    const sig = left < SIG;
    const tk = !reduced() && tick(left);
    const c = sig ? (tk ? C.white : C.yellow) : k > 0.6 ? C.hot : C.red;
    for (const a of [sa, sa + PI]) {
      const [s0, s1] = spinReach(sim, m, a, S);
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      const nx = -uy;
      const ny = ux;
      // Клин первых мгновений хода — куда пойдёт луч.
      p.col(C.red, 0.05 + 0.12 * k);
      fillSector(p, bx, by, s0, s1, sdir > 0 ? a : a - 0.45, sdir > 0 ? a + 0.45 : a);
      p.col(C.redDk, 0.12 + 0.18 * k);
      fillLane(p, bx, by, ux, uy, s0, s1, hw);
      const run = Math.floor(time * (30 + 90 * k));
      for (const sd of [-1, 1]) {
        p.col(c, 0.45 + 0.5 * k);
        p.line(
          bx + ux * s0 + nx * hw * sd,
          by + uy * s0 + ny * hw * sd,
          bx + ux * s1 + nx * hw * sd,
          by + uy * s1 + ny * hw * sd,
          sig ? undefined : (i) => mod(i - run, 8) < 5,
        );
      }
      // Шевроны поперёк — в сторону вращения.
      const tx = -uy * sdir;
      const ty = ux * sdir;
      for (let j = 0; j < 3; j++) {
        const s = s0 + (s1 - s0) * (0.3 + 0.25 * j);
        const slide = mod(time * 1.6 + j * 0.3, 1) * 5;
        const cx = bx + ux * s + tx * (hw + 3 + slide);
        const cy = by + uy * s + ty * (hw + 3 + slide);
        const al = (0.35 + 0.6 * k) * (1 - slide / 7);
        p.lineS(cx - tx * 3 + ux * 3, cy - ty * 3 + uy * 3, cx, cy, c, al, 0.5);
        p.lineS(cx - tx * 3 - ux * 3, cy - ty * 3 - uy * 3, cx, cy, c, al, 0.5);
      }
    }
    return;
  }
  // Бьёт: жаркая полоса под лучом, выжженный клин позади, отсвет впереди.
  const out = stage === 2 ? 1 - k : 1;
  const run = stage === 1 ? Math.min(1, (m.t - SPIN_CH) / 0.6) : 1;
  for (const a0 of [sa, sa + PI]) {
    const N = 7;
    const span = 0.55 * run;
    for (let i = N - 1; i >= 0; i--) {
      const a1 = a0 - sdir * span * ((i + 1) / N);
      const a2 = a0 - sdir * span * (i / N);
      const [s0, s1] = spinReach(sim, m, (a1 + a2) / 2, S);
      const q = i / N;
      p.col(q < 0.35 ? C.fire[2] : C.soot, (q < 0.35 ? 0.3 : 0.22) * (1 - q) * out);
      fillSector(p, bx, by, s0, s1, Math.min(a1, a2), Math.max(a1, a2));
    }
    const [s0, s1] = spinReach(sim, m, a0, S);
    const ux = Math.cos(a0);
    const uy = Math.sin(a0);
    p.col(C.red, 0.12 * out);
    fillSector(p, bx, by, s0, s1, sdir > 0 ? a0 : a0 - 0.22, sdir > 0 ? a0 + 0.22 : a0);
    if (stage === 1) {
      p.col(C.orange, 0.5);
      fillLane(p, bx, by, ux, uy, s0, s1, hw * 0.75);
      p.col(C.yellow, 0.8);
      fillLane(p, bx, by, ux, uy, s0, s1, 1);
    }
  }
}

registerZonePainter(
  'f11v_spin',
  guarded((g, z0: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const z = z0 as FxZone;
    const sim = paintSim();
    if (!sim) return;
    const st = spinNow(sim, z);
    if (!st) return;
    const { m, stage, k, sa, sdir } = st;
    const bx = m.x * S;
    const by = m.y * S;
    const p = new Pen(g, px, py, z.x * S, z.y * S);
    const [cx, cy] = bossCore(m, time, S);
    const few = reduced();
    const bodies = bodiesOf(sim, S);
    if (stage === 0) {
      // Заряд: искры жара стягиваются в ядро, свечение растёт.
      const n = few ? 4 : 10;
      for (let i = 0; i < n; i++) {
        const ph = mod(time * (1 + 2 * k) + i / n, 1);
        const rr = 26 * (1 - eIn2(ph));
        const aa = i * 2.39 + time * 4 * sdir;
        p.col(ph > 0.6 ? C.yellow : C.orange, 0.3 + 0.7 * ph);
        p.dot(cx + Math.cos(aa) * rr, cy + Math.sin(aa) * rr * 0.75);
      }
      p.col(C.orange, 0.3 + 0.3 * k);
      disc(p, cx, cy, 2 + 5 * k);
      p.col(C.yellow, 0.9);
      disc(p, cx, cy, 1 + 2.5 * k);
      if (SPIN_CH - m.t < SIG) flare(p, cx, cy, 6 + Math.round(6 * k), C.white, 0.95);
      return;
    }
    const tl = stage === 1 ? m.t - SPIN_CH : 0;
    const ign = stage === 1 ? eOut2(k01(tl / 0.05)) : 1;
    const out = stage === 2 ? 1 - k : 1;
    const jit = Math.floor(time * 30) % 2;
    for (const a of [sa, sa + PI]) {
      const [s0, s1full, wall] = spinReach(sim, m, a, S);
      // Втягивается: конец бежит к корню.
      const s1 = stage === 2 ? s0 + (s1full - s0) * (1 - eIn2(k)) : s0 + (s1full - s0) * ign;
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      const rx = bx + ux * s0;
      const ry = by + uy * s0 - SPIN_H;
      const w = out * (0.85 + 0.15 * Math.sin(time * 40 + a));
      const layers: [number, string, number][] = [
        [(SPIN_HW * S + jit * 0.8) * w, C.red, 0.5],
        [4.4 * w, C.hot, 0.85],
        [2.6 * w, C.yellow, 1],
        [Math.max(0.6, 1.1 * w), C.white, 1],
      ];
      // Из груди — вниз к корню луча.
      front(p, bodies, by + uy * s0, () => {
        for (const [hw, c, al] of layers) {
          p.col(c, al);
          fillSeg(p, cx, cy, rx, ry, hw * 0.7);
        }
      });
      frontRun(p, bodies, bx, by, ux, uy, s0, s1, (sa0, sa1) => {
        for (const [hw, c, al] of layers) {
          p.col(c, al);
          fillLane(p, bx, by - SPIN_H, ux, uy, sa0, sa1, hw);
        }
        // Сгустки бегут наружу — энергия идёт из ядра.
        p.col(C.white, 0.9 * out);
        for (let j = 0; j < 5; j++) {
          const s = s0 + mod(time * 240 + j * 47 + (a > sa ? 23 : 0), Math.max(1, s1full - s0));
          if (s < sa0 || s > sa1) continue;
          disc(p, bx + ux * s, by + uy * s - SPIN_H, 2.2 * w);
        }
      });
      // У стены — раскалённое пятно и фонтан искр (искра помнит, где был луч).
      if (stage === 1 && ign >= 1) {
        const ex = bx + ux * s1;
        const ey = by + uy * s1 - SPIN_H;
        p.col(C.yellow, 0.85);
        disc(p, ex, ey, 3 + jit);
        p.col(C.white, 1);
        star(p, ex, ey, 6 + jit * 2, 5, time * 9);
        if (wall) {
          const nB = few ? 4 : 9;
          for (let b = 0; b < nB; b++) {
            const tb = Math.floor(time / 0.04) - b;
            const age = time - tb * 0.04;
            if (age > 0.4 || age < 0) continue;
            const ab = a - sdir * BOSS.spinW * age;
            const [, sb] = spinReach(sim, m, ab, S);
            const ox = bx + Math.cos(ab) * sb;
            const oy = by + Math.sin(ab) * sb;
            sparks(
              p,
              (tb * 977 + (a > sa ? 7 : 0)) >>> 0,
              age,
              ox,
              oy,
              3,
              ab + PI,
              1.2,
              40,
              70,
              0.4,
              60,
            );
          }
        }
      }
    }
    // Ядро пылает.
    p.col(C.orange, 0.5 * out);
    disc(p, cx, cy, 5 + jit);
    p.col(C.white, out);
    disc(p, cx, cy, 2.5);
    if (stage === 1 && tl < 0.12) {
      const kk = tl / 0.12;
      p.col(C.white, 1 - kk);
      star(p, cx, cy, 20 * (1 - 0.5 * kk), 8, 0.2);
      ring(p, cx, cy, 8 + 30 * eOut2(kk), C.yellow, 1 - kk);
    } else flare(p, cx, cy, 4 + jit * 2, C.cream, 0.8 * out);
  }),
);

// =============================================================================
// ПАР ИЗ РЕШЁТОК (3-я фаза) — зона мозга `f11_steam` у решётки: метка 0,8 с,
// потом струя 1,3 с, r 1,05. Метка: между прутьями решётки разгорается жар
// (тёмно-красный → оранжевый → белый), над решёткой дрожат струйки, по
// кругу удара сходятся кольца давления; последние 0,2 с — белая кромка и
// плевки пара. Струя (поверх темноты, «режиссёр» неба): столб клубов бьёт
// вверх, раздувается и уходит по ветру; в начале — кольцо пара по полу.
// Тела ближе к камере столб заслоняют.
// =============================================================================

registerZonePainter(
  'f11_steam',
  guarded((g, z0: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const z = z0 as Zone;
    const cx = z.x * S;
    const cy = z.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const warn = z.warn ?? 0;
    const R = z.r * S;
    const x0 = Math.floor(cx) - 8;
    const y0 = Math.floor(cy) - 8;
    // Жар между прутьями решётки (щели — каждый третий столбец).
    const heat = z.t < warn ? eIn2(k01(z.t / warn)) : 1 - k01((z.t - warn) / (z.life * 0.8));
    if (heat > 0.02) {
      const c = heat > 0.85 ? C.cream : heat > 0.55 ? C.yellow : heat > 0.3 ? C.orange : C.red;
      for (let x = 4; x <= 13; x += 3) {
        p.col(c, 0.35 + 0.6 * heat);
        p.rect(x0 + x, y0 + 2, 1, 12);
        p.col(C.hot, 0.3 * heat);
        p.rect(x0 + x - 1, y0 + 3, 1, 10);
      }
    }
    if (z.t < warn) {
      const k = z.t / warn;
      const left = warn - z.t;
      const sig = left < SIG;
      const tk = !reduced() && tick(left);
      p.col(C.red, 0.05 + 0.12 * k);
      disc(p, cx, cy, R);
      const rc = sig ? (tk ? C.white : C.yellow) : k > 0.6 ? C.hot : C.red;
      ring(p, cx, cy, R + 1, C.ink, 0.4);
      ring(p, cx, cy, R, rc, 0.7 + 0.3 * k, sig ? undefined : (a) => mod(a * R + time * 30, 8) < 5);
      // Кольца давления сходятся к решётке.
      for (let j = 0; j < 2; j++) {
        const ph = mod(time * (1.2 + 2 * k) + j * 0.5, 1);
        ring(p, cx, cy, R * (1 - ph) + 2, C.cream, 0.5 * ph * k);
      }
      return;
    }
    // Бьёт: мокрый горячий круг на полу.
    const kl = k01((z.t - warn) / z.life);
    p.col(C.ice, 0.22 * (1 - kl));
    disc(p, cx, cy, R, true);
    ring(p, cx, cy, R, C.white, 0.4 * (1 - kl));
  }),
);

/** Столб пара над решёткой — в «режиссёре» неба. */
function steamSky(p: Pen, sim: Sim, z: Zone, S: number, time: number, bodies: Body[]): void {
  const cx = z.x * S;
  const cy = z.y * S;
  const warn = z.warn ?? 0;
  const few = reduced();
  const sd = ((z.id >>> 0) * 2246822519) >>> 0;
  const [wx, wy] = windPx(sim, z.x, z.y);
  front(p, bodies, cy, () => {
    if (z.t < warn) {
      const k = z.t / warn;
      // Струйки дрожат над решёткой; в тревоге — плевки.
      embers(
        p,
        sd,
        z.t,
        few ? 3 : 7,
        0.5,
        10 + 8 * k,
        (i) => i * 0.11,
        (i) => [cx - 5 + hash(sd, i, 1) * 10, cy - 1],
        0.4 + 0.5 * k,
        () => C.white,
      );
      if (warn - z.t < SIG) {
        p.col(C.white, 0.85);
        for (let i = 0; i < 3; i++) {
          const x = cx - 5 + i * 5;
          const h = 4 + hash(i, Math.floor(time * 20), sd) * 8;
          p.line(x, cy - 2, x, cy - 2 - h);
        }
      }
      return;
    }
    const lt = z.t - warn;
    const stop = z.life - 0.35;
    // Кольцо пара по полу в первый миг.
    if (lt < 0.25) {
      const k = lt / 0.25;
      ring(
        p,
        cx,
        cy,
        4 + 16 * eOut2(k),
        C.white,
        0.8 * (1 - k),
        (_a, i) => hash(i >> 2, sd, 9) > 0.3,
      );
    }
    // Столб: клубы бьют вверх, раздуваются, уходят по ветру.
    const dt = few ? 0.07 : 0.035;
    for (let i = 0, born = 0; born <= Math.min(lt, stop); i++, born += dt) {
      const pa = lt - born;
      const L = 0.75 * (0.8 + 0.4 * hash(sd, i, 2));
      if (pa >= L) continue;
      const k = pa / L;
      const up = 70 * drag(1, 2.4, pa) * (0.8 + 0.4 * hash(sd, i, 3));
      const x = cx + (hash(sd, i, 4) - 0.5) * 8 + wx * 10 * pa * pa;
      const y = cy - 3 - up + wy * 6 * pa * pa;
      const im = puffImg(3, 2 + 7 * eOut2(k01(pa / 0.5)), i);
      p.alpha(0.85 * (1 - Math.pow(k, 1.5)));
      p.img(im, x - im.width / 2, y - im.height / 2);
    }
  });
}

// =============================================================================
// КУПОЛ И ПИЛОНЫ (2-я фаза). Купол рисует тело (`f11-art.ts`) сотами поверх
// кадра; здесь — то, что с ним происходит. Лучи пилонов (`f11_pylonbeam`):
// дрожащая лента от вершины кристалла к ПОВЕРХНОСТИ купола, по ней бегут
// сгустки к стражу, точка касания горит сотой. Удар по куполу (мозг ставит
// `vDomeT`, `vDomeA`): в месте удара — вспышка, от неё по куполу бежит
// волна загорающихся сот, искры отскакивают. Сборка (`vUp`): соты
// загораются волной от лучей пилонов. Падение (`vFall`): купол
// осыпается — соты падают на пол, звенят, отскакивают и гаснут. Пилон
// пал — кристалл разлетается осколками, вверх бьёт столб света.
// =============================================================================

/** Купол в пикселях мира: середина над стражем и радиус — как в кадре тела. */
const DOME_DY = 28;
const DOME_R = 34;

registerZonePainter(
  'f11_pylonbeam',
  guarded((g, z0: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const sim = paintSim();
    if (!sim) return;
    const z = z0 as FxZone;
    const pylon = sim.mobs.find(
      (m) => m.id === z.pylon && m.mode !== 'dying' && m.mode !== 'escape',
    );
    const boss = bossOf(sim);
    if (!pylon || !boss || !sim.boss?.data.shield) return;
    const p = new Pen(g, px, py, z.x * S, z.y * S);
    const sx = pylon.x * S;
    const sy = pylon.y * S - 32;
    const dcx = boss.x * S;
    const dcy = boss.y * S - DOME_DY;
    const dl = Math.hypot(sx - dcx, sy - dcy) || 1;
    const ex = dcx + ((sx - dcx) / dl) * DOME_R;
    const ey = dcy + ((sy - dcy) / dl) * DOME_R;
    const L = Math.hypot(ex - sx, ey - sy);
    if (L < 2) return;
    const ux = (ex - sx) / L;
    const uy = (ey - sy) / L;
    const nx = -uy;
    const ny = ux;
    const hit = pylon.flash > 0 && Math.floor(time * 30) % 2 === 0;
    // Лента: две нити, дрожат бегущей волной.
    for (let pass = 0; pass < 2; pass++) {
      p.col(pass ? C.white : C.cyan, pass ? 0.9 : hit ? 0.35 : 0.7);
      let lx = sx;
      let ly = sy;
      for (let s = 2; s <= L; s += 2) {
        const wob =
          Math.sin(s * 0.22 - time * 16 + pass * 1.5) * (pass ? 0.6 : 1.4) * Math.sin((s / L) * PI);
        const qx = sx + ux * s + nx * wob;
        const qy = sy + uy * s + ny * wob;
        p.line(lx, ly, qx, qy);
        lx = qx;
        ly = qy;
      }
    }
    // Сгустки — к куполу.
    for (let j = 0; j < 3; j++) {
      const s = mod(time * 90 + j * (L / 3), L);
      p.col(C.white, 1);
      disc(p, sx + ux * s, sy + uy * s, 1.3);
    }
    // Узлы: вершина кристалла и сота в месте касания.
    p.col(C.cyan, 0.5 + 0.3 * Math.sin(time * 9));
    disc(p, sx, sy, 2.5);
    const hxi = hexImg(3, Math.floor(time * 6));
    p.alpha(0.6 + 0.4 * Math.sin(time * 11 + z.x));
    p.img(hxi, ex - hxi.width / 2, ey - hxi.height / 2);
  }),
);

/** Сетка сот купола: середины в пикселях мира, кеш. */
let domeCells: [number, number][] | null = null;
function domeGrid(): [number, number][] {
  if (domeCells) return domeCells;
  const out: [number, number][] = [];
  const d = 7;
  for (let r = -6; r <= 6; r++)
    for (let q = -6; q <= 6; q++) {
      const x = (q + r / 2) * d;
      const y = r * d * 0.866;
      if (Math.hypot(x, y) < DOME_R - 2) out.push([x, y]);
    }
  domeCells = out;
  return out;
}

/** Шестиугольник по пикселям (контур) радиуса r. */
function hexLine(p: Pen, cx: number, cy: number, r: number): void {
  let lx = 0;
  let ly = 0;
  for (let k = 0; k <= 6; k++) {
    const a = (k * PI) / 3 + PI / 6;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r * 0.9;
    if (k) p.line(lx, ly, x, y);
    lx = x;
    ly = y;
  }
}

function domeSky(p: Pen, sim: Sim, S: number, time: number): void {
  const b = sim.boss;
  const m = bossOf(sim);
  if (!b) return;
  const now = sim.time;
  const few = reduced();
  if (m) {
    const dcx = m.x * S;
    const dcy = m.y * S - DOME_DY;
    // Удар по куполу: вспышка в месте удара, волна сот по куполу.
    const ht = now - (m.data.vDomeT ?? -9);
    if (b.data.shield && ht >= 0 && ht < 0.5) {
      const a = (m.data.vDomeA ?? 0) + PI;
      const hx0 = dcx + Math.cos(a) * DOME_R * 0.92;
      const hy0 = dcy + Math.sin(a) * DOME_R * 0.8;
      const rho = 4 + 70 * eOut2(ht / 0.5);
      for (const [x, y] of domeGrid()) {
        const d = Math.hypot(dcx + x - hx0, dcy + y - hy0);
        const band = Math.abs(d - rho);
        if (band > 6) continue;
        p.col(band < 2.5 ? C.white : C.cyan, (1 - ht / 0.5) * (1 - band / 6));
        hexLine(p, dcx + x, dcy + y, 3.6);
      }
      if (ht < 0.08) {
        p.col(C.white, 1);
        star(p, hx0, hy0, 9 * (1 - ht / 0.08) + 3, 6, 0.2);
      }
      sparks(
        p,
        ((m.data.vDomeT ?? 0) * 1000) >>> 0,
        ht,
        hx0,
        hy0 + 20,
        few ? 3 : 7,
        a,
        0.9,
        40,
        60,
        0.4,
        40,
        runeCol,
      );
    }
    // Сборка: соты загораются волной от пилонов.
    const ut = now - (b.data.vUp ?? -9);
    if (b.data.shield && ut >= 0 && ut < 0.8) {
      const pyl = sim.mobs.filter((q) => q.kind === 'f11_pylon' && q.mode !== 'dying');
      const pts = pyl.map((q) => {
        const sx = q.x * S;
        const sy = q.y * S - 32;
        const dl = Math.hypot(sx - dcx, sy - dcy) || 1;
        return [dcx + ((sx - dcx) / dl) * DOME_R, dcy + ((sy - dcy) / dl) * DOME_R];
      });
      const rho = 90 * eOut2(ut / 0.8);
      for (const [x, y] of domeGrid()) {
        let d = 1e9;
        for (const [qx, qy] of pts) d = Math.min(d, Math.hypot(dcx + x - qx, dcy + y - qy));
        if (d > rho) continue;
        const fresh = rho - d < 10;
        p.col(fresh ? C.white : C.cyan, (fresh ? 0.9 : 0.35) * (1 - ut / 0.8));
        hexLine(p, dcx + x, dcy + y, 3.6);
      }
    }
  }
  // Падение купола: соты осыпаются на пол — где бы ни был страж.
  const ft = now - (b.data.vFall ?? -9);
  if (ft >= 0 && ft < 1.6) {
    const bm = m ?? sim.mobs.find((q) => q.kind === 'f11boss');
    if (!bm) return;
    const dcx = bm.x * S;
    const fy = bm.y * S;
    const sd = ((b.data.vFall ?? 0) * 997) >>> 0;
    if (ft < 0.12) {
      ring(p, dcx, fy - DOME_DY, DOME_R + 6 * (ft / 0.12), C.white, 1 - ft / 0.12);
      ring(p, dcx, fy - DOME_DY, DOME_R - 2, C.cyan, 1 - ft / 0.12);
    }
    const cells = domeGrid();
    const step = few ? 3 : 1;
    const G = 300;
    for (let i = 0; i < cells.length; i += step) {
      const [x, y] = cells[i];
      // Сота падает со своей высоты на купол: верхние — дольше.
      const h0 = Math.max(1, DOME_DY - y);
      const gx0 = dcx + x;
      const gy0 = fy + y * 0.35 + 6 * (hash(sd, i, 2) - 0.5);
      const v = 18 + 30 * hash(sd, i, 3);
      const out = Math.atan2(gy0 - fy, x || 0.01);
      const tt = Math.max(0, ft - 0.04 * hash(sd, i, 4));
      const fallT = Math.sqrt((2 * h0) / G);
      // До пола — свободное падение; потом один отскок с потерей сил.
      let zt = 0;
      if (tt < fallT) zt = h0 - (G / 2) * tt * tt;
      else {
        const vb = 0.28 * G * fallT;
        const tb = tt - fallT;
        zt = Math.max(0, vb * tb - (G / 2) * tb * tb);
      }
      const gx = gx0 + Math.cos(out) * v * Math.min(tt, 0.6);
      const gy = gy0 + Math.sin(out) * v * 0.5 * Math.min(tt, 0.6);
      const a = 1 - k01((ft - 0.9) / 0.7);
      const im = hexImg(3 + (i % 2), Math.floor(tt * 14 + i));
      p.alpha(a * (Math.floor(ft * 20 + i) % 4 === 0 ? 1 : 0.8));
      p.img(im, gx - im.width / 2, gy - zt - im.height / 2);
      // Звон о пол — искорка в миг касания.
      if (tt >= fallT && tt < fallT + 0.06) {
        p.col(C.white, 0.9);
        p.dot(gx - 1, gy, 3, 1);
      }
    }
  }
}

/** Пилоны: память места (их убирают раньше, чем доиграл взрыв). */
function pylonSky(p: Pen, sim: Sim, S: number, time: number): void {
  const mem = memOf(sim);
  for (const m of sim.mobs) {
    if (m.kind !== 'f11_pylon') continue;
    const rec = mem.pylons.get(m.id);
    const broke = m.mode === 'dying' || m.mode === 'escape';
    if (!rec) mem.pylons.set(m.id, { x: m.x, y: m.y, t: broke ? time : null, seen: time });
    else {
      rec.seen = time;
      if (broke && rec.t === null) rec.t = time;
    }
    // Новый пилон: столб света встаёт из пола.
    if (!broke && m.t < 0.9) {
      const k = m.t / 0.9;
      const x = m.x * S;
      const y = m.y * S;
      p.col(C.cyan, 0.6 * (1 - k));
      fillLane(p, x, y, 0, -1, 0, 70 * eOut2(k01(m.t / 0.3)), 4 * (1 - k) + 1);
      p.col(C.white, 0.8 * (1 - k));
      fillLane(p, x, y, 0, -1, 0, 60 * eOut2(k01(m.t / 0.3)), 1.5);
      ring(p, x, y, 4 + 16 * eOut2(k), C.cyan, 1 - k);
    }
  }
  const few = reduced();
  for (const [id, rec] of mem.pylons) {
    if (rec.t === null && rec.seen !== time) rec.t = time;
    if (rec.t === null) continue;
    const age = time - rec.t;
    if (age > 1.4) {
      mem.pylons.delete(id);
      continue;
    }
    const x = rec.x * S;
    const y = rec.y * S;
    const sd = (id * 7919) >>> 0;
    if (age < 0.1) {
      p.col(C.white, 1 - age / 0.1);
      star(p, x, y - 20, 14, 6, 0.3);
    }
    if (age < 0.5) {
      const k = age / 0.5;
      p.col(C.cyan, 0.7 * (1 - k));
      fillLane(p, x, y - 30, 0, -1, 0, 80 * eOut2(k), 3 * (1 - k) + 0.5);
    }
    chunks(
      p,
      sd,
      age,
      x,
      y,
      few ? 4 : 10,
      0,
      PI,
      20,
      40,
      60,
      90,
      [0.9, 1.4],
      0.4,
      2,
      undefined,
      (i) => [x + (hash(sd, i, 1) - 0.5) * 6, y - 4 - hash(sd, i, 2) * 20, hash(sd, i, 3) * TAU],
    );
    sparks(p, sd + 1, age, x, y - 16, few ? 4 : 9, -PI / 2, PI, 40, 60, 0.5, 70, runeCol);
  }
}

// =============================================================================
// ПАДЕНИЕ ОСТРОВА (4-я фаза): край арены трещит 2 с и уходит в небо.
// `f11v_crack` (зона мозга в миг «трещит», клетки — в зоне): по каждой
// клетке бегут трещины, в них к концу пульсирует красный жар, из щелей
// сыплется пыль, крошка подпрыгивает, с внешней кромки в небо сыплются
// камешки; последние 0,4 с — дрожь пылью. `f11v_fall` (в миг «уходит»):
// плиты отрываются и всплывают в небо, каждая — кусок острова с землёй и
// корешками снизу; пыль из-под них сдувает ветром к обрыву, сверху
// сыплются комья.
// =============================================================================

/** Ступени роста трещины клетки одним холстом (4 ступени × цвет). */
const crackStages = new WeakMap<
  Crack,
  Map<string, { img: HTMLCanvasElement; x: number; y: number }>
>();
function crackStage(c: Crack, st: number, core: string, lip: string | null) {
  let m = crackStages.get(c);
  if (!m) {
    m = new Map();
    crackStages.set(c, m);
  }
  const key = `${st}|${core}|${lip}`;
  let hit = m.get(key);
  if (hit) return hit;
  const reach = (c.max * st) / 4;
  let x0 = 1e9;
  let y0 = 1e9;
  let x1 = -1e9;
  let y1 = -1e9;
  for (let i = 0; i < c.x.length; i++) {
    x0 = Math.min(x0, c.x[i]);
    y0 = Math.min(y0, c.y[i]);
    x1 = Math.max(x1, c.x[i] + 1);
    y1 = Math.max(y1, c.y[i] + 1);
  }
  if (x1 < x0) x0 = y0 = x1 = y1 = 0;
  const px = new Px(x1 - x0 + 1, y1 - y0 + 1);
  if (lip)
    for (let i = 0; i < c.lx.length; i++)
      if (c.ld[i] <= reach) px.set(c.lx[i] - x0, c.ly[i] - y0, hx(lip, 200));
  for (let i = 0; i < c.x.length; i++)
    if (c.d[i] <= reach) px.set(c.x[i] - x0, c.y[i] - y0, hx(core));
  hit = { img: px.canvas(), x: x0, y: y0 };
  m.set(key, hit);
  return hit;
}
const edgeCrack = (v: number) =>
  crackOf(
    `edge|${v}`,
    v * 977 + 13,
    starBranches(v * 31 + 5, 3, hash(v, 1, 3) * TAU, 7, 12, 2),
    0.6,
    0.3,
  );

registerZonePainter(
  'f11v_crack',
  guarded((g, z0: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const z = z0 as FxZone;
    const sim = paintSim();
    if (!sim || !z.cells) return;
    const p = new Pen(g, px, py, z.x * S, z.y * S);
    const W = sim.world.w;
    const t = z.t;
    const few = reduced();
    const st = Math.min(4, 1 + Math.floor(t / 0.4));
    const pulse = t > 0.6 ? 0.5 + 0.5 * Math.sin(time * (8 + 14 * k01((t - 0.6) / 1.4))) : 0;
    const shake = t > 1.6;
    for (let n = 0; n < z.cells.length; n++) {
      const i: number = z.cells[n];
      if (sim.world.mark[i] === undefined) continue;
      const cx = (i % W) * S + 8;
      const cy = Math.floor(i / W) * S + 8;
      const v = (i * 2654435761) >>> 0;
      const ck = edgeCrack(v % 6);
      const im = crackStage(ck, st, C.groove, C.lip);
      p.alpha(1);
      p.img(im.img, cx + im.x, cy + im.y);
      if (pulse > 0) {
        const hot = crackStage(ck, st, C.hot, null);
        p.alpha(0.25 + 0.6 * pulse);
        p.img(hot.img, cx + hot.x, cy + hot.y);
      }
      // Пыль из щелей и прыгающая крошка.
      if (!few || n % 3 === 0) {
        const ph = mod(time * 1.8 + (v % 97) / 97, 1);
        const pr = puffImg(0, 1 + 2.5 * ph, v & 3);
        p.alpha(0.55 * (1 - ph) * (0.4 + 0.6 * k01(t / 1.2)));
        p.img(pr, cx - 4 + (v % 9) - pr.width / 2, cy - 2 - ph * 6 - pr.height / 2);
        const hop = Math.abs(Math.sin(time * (14 + (v % 5)) + n)) * (1 + 3 * k01(t / 2));
        p.col(C.pebble, 0.9);
        p.dot(cx + ((v >> 4) % 11) - 5, cy + ((v >> 8) % 9) - 4 - hop);
      }
      if (shake && Math.floor(time * 24 + n) % 3 === 0) {
        p.col(C.dust, 0.22);
        p.rect(cx - 8, cy - 8, 16, 16);
      }
      // С кромки над небом сыплются камешки.
      const below = i + W;
      if (sim.tiles[below] === 11 && n % 2 === 0) {
        const ph = mod(time * 1.3 + (v % 53) / 53, 1);
        p.col(C.shade, 0.8 * (1 - ph));
        p.dot(cx - 6 + (v % 13), cy + 8 + ph * ph * 26);
      }
    }
  }),
);

registerZonePainter(
  'f11v_fall',
  guarded((g, z0: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const z = z0 as FxZone;
    const sim = paintSim();
    if (!sim || !z.cells) return;
    const p = new Pen(g, px, py, z.x * S, z.y * S);
    const W = sim.world.w;
    const t = z.t;
    const few = reduced();
    const acx = z.x * S;
    const acy = z.y * S;
    for (let n = 0; n < z.cells.length; n++) {
      const i: number = z.cells[n];
      const v = (i * 2654435761) >>> 0;
      const cx = (i % W) * S + 8;
      const cy = Math.floor(i / W) * S + 8;
      const out = Math.atan2(cy - acy, cx - acx);
      const d = 0.25 * ((v % 101) / 101);
      const u = k01((t - d) / 2.5);
      const lift = 34 * eIn2(u) + 14 * u;
      const drift = 22 * eIn2(u);
      const x = cx + Math.cos(out) * drift;
      const y = cy + Math.sin(out) * drift * 0.5 - lift;
      // Пыль из-под плиты сдувает к обрыву.
      if (t - d < 0.9 && (!few || n % 3 === 0)) {
        const pa = Math.max(0, t - d);
        const k = pa / 0.9;
        for (let q = 0; q < 2; q++) {
          const pr = puffImg(0, 2 + 4 * eOut2(k), (v >> q) & 3);
          p.alpha(0.6 * (1 - k));
          p.img(
            pr,
            cx + Math.cos(out) * (6 + 30 * eOut2(k)) + (q ? 4 : -4) - pr.width / 2,
            cy + Math.sin(out) * 12 * eOut2(k) - 3 * k - pr.height / 2,
          );
        }
      }
      if (u >= 1) continue;
      const a = 1 - k01((u - 0.55) / 0.45);
      const im = slabImg(v & 7);
      p.alpha(a);
      p.img(im, x - im.width / 2, y - 9);
      // Комья земли сыплются из-под плиты в небо.
      if (u < 0.7) {
        const ph = mod(t * 1.7 + (v % 37) / 37, 1);
        p.col('#5c4028', a * (1 - ph));
        p.dot(x - 4 + (v % 9), y + 10 + ph * 18);
      }
    }
  }),
);

// =============================================================================
// СЦЕНЫ: смена протокола (1,3 с), колено (купол пал, 5,5 с), пробуждение
// (2,4 с), смерть, шаги.
//   • смена: вокруг стража сам себя чертит круг рун цвета новой фазы, три
//     волны расходятся по полу, по корпусу бегут разряды; в 4-й фазе от
//     ног к краю бегут раскалённые трещины; во 2-й из пола встают столбы
//     света — там, где поднялись пилоны;
//   • колено: удар колена оземь — пыль кольцом и крошка; потом в груди
//     коротит (разряды) и из ядра сочится дым;
//   • пробуждение: с корпуса осыпаются пыль и мох, под ногами разгорается
//     круг рун; глаз вспыхивает, когда загорается; руки вверх — волна;
//   • смерть (`f11v_death`): ядро схлопывается и рвётся вспышкой, разряды,
//     столб дыма, искры; сад на плечах отпускает лепестки — их уносит ветер;
//   • шаги (`f11v_step`): пыль из-под ступни, крошка и волосяная трещина.
// =============================================================================

/** Разряды по корпусу: ломаные между точками овала тела, 16 раз в секунду. */
function arcs(p: Pen, m: Mob, S: number, time: number, n: number, col: string, a = 1): void {
  const bx = m.x * S;
  const by = m.y * S - 30;
  const gen = Math.floor(time * 16);
  for (let j = 0; j < n; j++) {
    const a0 = hash(gen, j, m.id) * TAU;
    const a1 = a0 + 0.8 + hash(gen, j, 7) * 2;
    let x0 = bx + Math.cos(a0) * 17;
    let y0 = by + Math.sin(a0) * 20;
    const x1 = bx + Math.cos(a1) * 17;
    const y1 = by + Math.sin(a1) * 20;
    p.col(j % 2 ? C.white : col, a);
    for (let q = 1; q <= 4; q++) {
      const qx = x0 + (x1 - x0) / (5 - q) + (hash(gen, j * 9 + q, 3) - 0.5) * 6;
      const qy = y0 + (y1 - y0) / (5 - q) + (hash(gen, j * 9 + q, 4) - 0.5) * 6;
      p.line(x0, y0, qx, qy);
      x0 = qx;
      y0 = qy;
    }
  }
}

function shiftFloor(p: Pen, sim: Sim, m: Mob, S: number, time: number): void {
  const ph = sim.boss?.phase ?? 1;
  const col = phaseCol(ph);
  const t = m.t;
  const bx = m.x * S;
  const by = m.y * S;
  const R = 2.6 * S;
  const few = reduced();
  const fade = 1 - k01((t - 1.0) / 0.3);
  // Круг рун чертит сам себя.
  const sweep = TAU * eOut2(k01(t / 0.45));
  ring(p, bx, by, R + 1, C.ink, 0.5 * fade, (a) => mod(a + PI / 2, TAU) <= sweep);
  ring(p, bx, by, R, col, 0.95 * fade, (a) => mod(a + PI / 2, TAU) <= sweep);
  ring(
    p,
    bx,
    by,
    R - 4,
    col,
    0.6 * fade,
    (a) => mod(a * 30 - time * 9, 6) < 3 && mod(a + PI / 2, TAU) <= sweep,
  );
  for (let j = 0; j < 12; j++) {
    const a = -PI / 2 + (j / 12) * TAU;
    if (mod(a + PI / 2, TAU) > sweep) continue;
    const lit = mod(a + PI / 2, TAU) > sweep - 0.6;
    p.lineS(
      bx + Math.cos(a) * (R - 3),
      by + Math.sin(a) * (R - 3),
      bx + Math.cos(a) * (R + 3),
      by + Math.sin(a) * (R + 3),
      lit ? C.white : col,
      fade,
      0.5,
    );
  }
  // Три волны по полу.
  for (const t0 of [0, 0.42, 0.84]) {
    const u = (t - t0) / 0.6;
    if (u < 0 || u > 1) continue;
    ring(
      p,
      bx,
      by,
      1.2 * S + 5 * S * eOut2(u),
      col,
      0.8 * (1 - u),
      (_a, i) => hash(i >> 2, Math.round(t0 * 10), 5) > 0.2,
      0.5,
    );
  }
  const sd = m.id * 53 + ph;
  if (t < 0.9)
    dust(p, sd, t, bx, by, few ? 5 : 10, 0, PI, 30, 20, 2, 6, 4, 0.9, 0, 0.6, undefined, (i) => [
      bx + Math.cos((i / 10) * TAU) * 14,
      by + Math.sin((i / 10) * TAU) * 6,
      (i / 10) * TAU,
    ]);
  // 4-я фаза: раскалённые трещины от ног к краю.
  if (ph >= 4) {
    const ck = crackOf(
      `shift4|${m.id % 7}`,
      sd,
      starBranches(sd, 6, 0.3, S * 3, S * 5, 3),
      0.5,
      0.3,
    );
    const reach = ck.max * eOut2(k01(t / 1.1));
    drawCrack(p, ck, bx, by, reach, C.groove, C.lip, 1);
    drawCrack(p, ck, bx, by, reach, heatCol(0.35 + 0.3 * k01(t / 1.3)), null, 0.85);
  }
}

function shiftSky(p: Pen, sim: Sim, m: Mob, S: number, time: number): void {
  const ph = sim.boss?.phase ?? 1;
  arcs(p, m, S, time, reduced() ? 1 : 3, phaseCol(ph), 0.9 * (1 - k01((m.t - 1.1) / 0.2)));
}

function staggerFloor(p: Pen, m: Mob, S: number): void {
  const t = m.t;
  if (t > 1.4) return;
  const bx = m.x * S;
  const by = m.y * S;
  const sd = m.id * 71 + 3;
  const few = reduced();
  const nD = few ? 5 : 12;
  dust(p, sd, t, bx, by, nD, 0, 0.3, 34, 20, 2, 7, 5, 1.2, 0, 0.75, undefined, (i) => {
    const th = (i / nD) * TAU;
    return [bx + Math.cos(th) * 16, by + Math.sin(th) * 7, th];
  });
  chunks(p, sd + 1, t, bx, by, few ? 4 : 10, 0, PI, 25, 30, 40, 60, [1.0, 1.4], 0.3, 0);
  if (t < 0.25) ring(p, bx, by, 10 + 40 * eOut2(t / 0.25), C.white, 1 - t / 0.25, undefined, 0.5);
}

function staggerSky(p: Pen, m: Mob, S: number, time: number): void {
  const t = m.t;
  // Коротит: вспышки разрядов раз в 0,45 с.
  if (mod(t, 0.45) < 0.12) arcs(p, m, S, time, reduced() ? 1 : 2, C.rune);
  // Из ядра сочится дым.
  const [cx, cy] = bossCore(m, time, S);
  const sd = m.id * 37;
  const n = Math.min(14, Math.floor(t / 0.16));
  dust(
    p,
    sd,
    t,
    cx,
    cy,
    n,
    -PI / 2,
    0.4,
    6,
    6,
    1,
    4,
    22,
    1.3,
    1,
    0.55,
    (i) => i * 0.16,
    undefined,
    [6, -1],
  );
}

function wakeFloor(p: Pen, m: Mob, S: number, time: number): void {
  const t = m.t;
  const k = k01(t / BOSS.wake);
  const bx = m.x * S;
  const by = m.y * S;
  const R = 2.2 * S;
  ring(p, bx, by, R + 1, C.ink, 0.4 * k);
  ring(p, bx, by, R, C.rune, 0.3 + 0.6 * k, (a) => mod(a + PI / 2, TAU) <= TAU * k);
  ring(p, bx, by, R - 4, C.rune, 0.5 * k, (a) => mod(a * 30 + time * 6, 7) < 3);
  // Руки вверх (последняя стадия) — волна по полу.
  const u = (t - BOSS.wake * 0.75) / 0.5;
  if (u > 0 && u < 1)
    ring(p, bx, by, 1.4 * S + 4 * S * eOut2(u), C.rune, 0.8 * (1 - u), undefined, 0.5);
}

function wakeSky(p: Pen, m: Mob, S: number, time: number): void {
  const t = m.t;
  const bx = m.x * S;
  const by = m.y * S;
  const sd = m.id * 17;
  // С корпуса сыплются пыль и мох — веками лежали.
  if (t < 1.6) {
    for (let i = 0; i < (reduced() ? 6 : 16); i++) {
      const born = hash(sd, i, 1) * 1.2;
      const a = t - born;
      if (a < 0 || a > 0.6) continue;
      const x = bx - 16 + hash(sd, i, 2) * 32;
      const y0 = by - 52 + hash(sd, i, 3) * 28;
      const y = y0 + 160 * a * a;
      if (y > by + 2) continue;
      p.col(i % 3 === 0 ? '#86a05e' : i % 3 === 1 ? '#c4bba9' : '#5a6e3e', 1);
      p.dot(x, y, i % 4 === 0 ? 2 : 1, 1);
    }
  }
  // Глаз загорается — вспышка.
  const et = t - BOSS.wake * 0.5;
  if (et > 0 && et < 0.3) {
    const [ex, ey] = bossEye(m, time, S);
    const k = et / 0.3;
    p.col(C.cyan, 1 - k);
    star(p, ex, ey, 12 * (1 - k) + 3, 4, 0);
    flare(p, ex, ey, 10, C.white, 1 - k);
  }
}

registerZonePainter(
  'f11v_death',
  guarded((g, z0: Zone | Strike, px: number, py: number, S: number) => {
    const z = z0 as FxZone;
    const bx = z.x * S;
    const by = z.y * S;
    const p = new Pen(g, px, py, bx, by);
    const t = z.t;
    const sd = ((z.id >>> 0) * 2654435761) >>> 0;
    const few = reduced();
    const [wx, wy] = windPx(paintSim(), z.x, z.y);
    const soot = sootImg(22, 2);
    p.alpha(0.5 * (1 - k01((t - 2.4) / 0.8)) * k01(t / 0.2));
    p.img(soot, bx - soot.width / 2, by - soot.height / 2 + 2);
    const nD = few ? 7 : 16;
    dust(
      p,
      sd,
      t,
      bx,
      by,
      nD,
      0,
      0.3,
      46,
      30,
      3,
      9,
      6,
      1.6,
      0,
      0.75,
      (i) => 0.04 * hash(sd, i, 1),
      (i) => {
        const th = (i / nD) * TAU;
        return [bx + Math.cos(th) * 18, by + Math.sin(th) * 8, th];
      },
      [wx * 8, wy * 8],
    );
    dust(
      p,
      sd + 1,
      t,
      bx,
      by,
      few ? 4 : 9,
      0,
      PI,
      20,
      20,
      3,
      8,
      8,
      1.4,
      6,
      0.6,
      (i) => 0.45 + 0.05 * i,
    );
    chunks(p, sd + 2, t, bx, by - 6, few ? 5 : 12, 0, PI, 30, 50, 60, 90, [1.6, 2.4], 0.4, 1);
  }),
);

function deathSky(p: Pen, sim: Sim, z: FxZone, S: number, time: number): void {
  const t = z.t;
  const bx = z.x * S;
  const by = z.y * S;
  const cx = bx;
  const cy = by - 18;
  const sd = ((z.id >>> 0) * 2246822519) >>> 0;
  const few = reduced();
  const [wx, wy] = windPx(sim, z.x, z.y);
  // Ядро схлопывается и рвётся.
  if (t < 0.12) {
    p.col(C.white, 1);
    disc(p, cx, cy, 14 * (1 - t / 0.12) + 2);
  } else if (t < 0.4) {
    const k = (t - 0.12) / 0.28;
    p.col(C.cyan, 1 - k);
    star(p, cx, cy, 8 + 24 * eOut2(k), 8, 0.4);
    p.col(C.white, 1 - k);
    star(p, cx, cy, 5 + 14 * eOut2(k), 8, 0.4);
    ring(p, cx, cy, 6 + 40 * eOut2(k), C.rune, 1 - k);
  }
  if (t < 1.2 && mod(t, 0.2) < 0.1) {
    const fake = { x: z.x, y: z.y, id: 3 } as Mob;
    arcs(p, fake, S, time, few ? 1 : 3, C.rune, 1 - t / 1.2);
  }
  sparks(p, sd, t, cx, cy, few ? 8 : 18, -PI / 2, PI, 60, 100, 0.8, 110, runeCol);
  // Столб дыма из ядра.
  const n = Math.min(few ? 10 : 24, Math.floor(t / 0.09));
  dust(
    p,
    sd + 1,
    t,
    cx,
    cy,
    n,
    -PI / 2,
    0.35,
    10,
    10,
    2,
    7,
    36,
    1.6,
    1,
    0.6,
    (i) => 0.15 + i * 0.09,
    undefined,
    [wx * 10, wy * 10],
  );
  // Сад на плечах отпускает лепестки — их уносит ветер.
  for (let i = 0; i < (few ? 6 : 16); i++) {
    const a = t - 0.2 - hash(sd, i, 5) * 0.8;
    if (a < 0 || a > 2.6) continue;
    const x = bx - 14 + hash(sd, i, 6) * 28 + (wx * 14 + 10) * a + Math.sin(a * 6 + i) * 3;
    const y = by - 40 + hash(sd, i, 7) * 10 + wy * 10 * a - 14 * a + Math.cos(a * 5 + i) * 2;
    p.col(PETAL[i % 4], 1 - k01((a - 1.8) / 0.8));
    p.dot(x, y, 2, 1);
  }
}

registerZonePainter(
  'f11v_step',
  guarded((g, z0: Zone | Strike, px: number, py: number, S: number) => {
    const z = z0 as FxZone;
    const cx = z.x * S;
    const cy = z.y * S + 1;
    const p = new Pen(g, px, py, cx, cy);
    const t = z.t;
    const sd = ((z.id >>> 0) * 2654435761) >>> 0;
    const [wx, wy] = windPx(paintSim(), z.x, z.y);
    if (t < 0.15) ring(p, cx, cy, 3 + 6 * eOut2(t / 0.15), C.shade, 0.35 * (1 - t / 0.15));
    const ck = crackOf(
      `step|${sd % 8}`,
      sd % 8,
      starBranches(sd % 8, 3, hash(sd % 8, 2, 2) * TAU, 3, 6, 1),
      0.6,
      0.1,
    );
    drawCrack(p, ck, cx, cy, ck.max, C.groove, null, 0.6 * (1 - k01((t - 0.4) / 0.5)));
    dust(
      p,
      sd,
      t,
      cx,
      cy,
      3,
      PI * 0.5,
      PI * 0.6,
      14,
      14,
      1.5,
      4,
      3,
      0.8,
      0,
      0.55,
      undefined,
      undefined,
      [wx * 6, wy * 6],
    );
    chunks(p, sd + 1, t, cx, cy, 2, 0, PI, 12, 14, 30, 30, [0.5, 0.8], 0, 0);
  }),
);

// =============================================================================
// «РЕЖИССЁРЫ» — две зоны мозга на весь бой. `f11v_dir` (на полу, под телами):
// метки ударов и всё, что лежит на полу. `f11v_sky` (поверх темноты): глаз,
// прицел, кулаки, дым ракет, столбы пара, купол, пилоны, разряды, смерть.
// Режиссёр один: прошлый бой мог оставить свою зону.
// =============================================================================

registerZonePainter(
  'f11v_dir',
  guarded((g, z0: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const z = z0 as Zone;
    const sim = paintSim();
    if (!sim || sim.zones.find((q) => q.art === 'f11v_dir') !== z) return;
    const p = new Pen(g, px, py, z.x * S, z.y * S);
    for (const s of sim.shots) if (s.art === 'f11_rocket') rocketReticle(p, sim, s, S, time);
    for (const q of sim.zones) if (q.art === 'f11v_spin') spinFloor(p, sim, q as FxZone, S, time);
    const m = bossOf(sim);
    if (!m) return;
    switch (m.mode) {
      case 'f11_gaze':
        gazeFloor(p, m, S, time);
        break;
      case 'f11_slam':
        slamFloor(p, m, S, time);
        break;
      case 'f11_stomp':
        stompFloor(p, m, S, time);
        break;
      case 'f11_shift':
        shiftFloor(p, sim, m, S, time);
        break;
      case 'f11_stagger':
        staggerFloor(p, m, S);
        break;
      case 'roar':
      case 'f11_wake':
        wakeFloor(p, m, S, time);
        break;
    }
  }),
);

registerZonePainter(
  'f11v_sky',
  guarded((g, z0: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const z = z0 as Zone;
    const sim = paintSim();
    if (!sim || sim.zones.find((q) => q.art === 'f11v_sky') !== z) return;
    const p = new Pen(g, px, py, z.x * S, z.y * S);
    const bodies = bodiesOf(sim, S);
    for (const q of sim.zones) {
      if (q.art === 'f11_steam') steamSky(p, sim, q, S, time, bodies);
      else if (q.art === 'f11v_death') deathSky(p, sim, q as FxZone, S, time);
    }
    rocketTrails(p, sim, S, time);
    pylonSky(p, sim, S, time);
    domeSky(p, sim, S, time);
    const m = bossOf(sim);
    if (!m) return;
    switch (m.mode) {
      case 'f11_gaze':
        gazeSky(p, sim, m, S, time, bodies);
        break;
      case 'f11_slam':
        slamSky(p, m, S, time);
        break;
      case 'f11_rockets':
        rocketsSky(p, m, S, time);
        break;
      case 'f11_shift':
        shiftSky(p, sim, m, S, time);
        break;
      case 'f11_stagger':
        staggerSky(p, m, S, time);
        break;
      case 'roar':
      case 'f11_wake':
        wakeSky(p, m, S, time);
        break;
    }
  }),
);

// ---- Прогрев: заготовки спрайтов, пока страж стоит (по одной за шаг) -----------

registerMobWarm('f11boss', function* () {
  for (let d = 0; d < 16; d++)
    for (let f = 0; f < 3; f++)
      for (let r = 0; r < 2; r++) {
        rocketImg(d, f, r);
        yield;
      }
  for (const pal of [0, 1, 2, 3, 4])
    for (let r = 1; r <= 10; r++)
      for (let v = 0; v < 4; v++) {
        puffImg(pal, r, v);
        yield;
      }
  for (let pal = 0; pal < 4; pal++)
    for (let sz = 1; sz <= 4; sz++)
      for (let f = 0; f < 4; f++) {
        chunkImg(sz, f, pal);
        yield;
      }
  for (let s = 4; s <= 28; s++) {
    fistShadow(s, true);
    fistShadow(s, false);
    yield;
  }
  fistImg(true);
  fistImg(false);
  for (let v = 0; v < 8; v++) {
    slabImg(v);
    yield;
  }
  for (let r = 2; r <= 5; r++)
    for (let f = 0; f < 4; f++) {
      hexImg(r, f);
      yield;
    }
  for (let h = 3; h <= 12; h++)
    for (let f = 0; f < 4; f++) {
      flameImg(h, f);
      yield;
    }
  for (let v = 0; v < 6; v++) {
    const ck = edgeCrack(v);
    for (let st = 1; st <= 4; st++) {
      crackStage(ck, st, C.groove, C.lip);
      crackStage(ck, st, C.hot, null);
      yield;
    }
  }
});
