// Этаж 10, босс «Король демонов» — техники (v2.86): метки ударов, контакт,
// пыль, осколки, молнии, обрушение края арены. Тело короля рисует
// `f10-art.ts`, здесь — всё, что король делает с МИРОМ. Договор движка —
// библия §14.
//
// Как устроено:
//   • метка удара (`registerZonePainter` для strike) читается «куда» с
//     первого кадра (вся фигура удара тёмным багрецом с кромкой) и «когда» —
//     фронт налива доходит до края ровно в миг урона (серп рассечения,
//     трещина рубки, тень опускающегося меча, тень крыльев пике); последние
//     0,2 с — «тик-тик» и белая кромка;
//   • контакт (`registerImpactPainter`) — след клинка, раскол мрамора,
//     пыль клубами, осколки с тяжестью и отскоком, ударная волна, искры;
//     тряска — по силе удара;
//   • удары без своего strike (посадка, шаги, крылья, рёв, двери стражи,
//     обрушение края) — визуальные зоны `f10_fx*`, их ставит мозг через
//     `api.vfx` (без урона и статусов, `vfx()` в `f10-brains.ts`);
//   • всё светящееся (молнии, перья пламени, огонь из бездны) — поверх
//     темноты (`above`); то, что лежит на полу в этом слое (выжженное
//     пятно, круг метки), прячется за телами, стоящими ближе к камере
//     (`occOf`), — как если бы слой сортировался по глубине.
//
// Пол тронного зала — чёрный мрамор с золотыми жилами: тёмное на нём
// пропадает, поэтому пыль светлее пола (серо-лиловая), у трещин светлая
// кромка снизу-справа (свет сверху-слева), осколки с тёмным контуром.
//
// Пиксели — на СЕТКЕ МИРА (`Pen`): эффект не «плывёт» по полу при движении
// камеры. Частицы детерминированы — позиция считается от зерна и возраста,
// а не копится по кадрам: лист кадров и игра рисуют одно и то же, стоп-кадр
// держит позу сам.
import { Px } from '../dungeon-art';
import {
  IMPACT_PAINTERS,
  paintSim,
  registerImpactPainter,
  registerMobWarm,
  registerZonePainter,
  ZONE_PAINTERS,
} from '../dungeon-paint';
import type { ImpactRec } from '../dungeon-paint';
import type { Strike, Zone } from '../dungeon-sim';

type RGBA = [number, number, number, number];

const TAU = Math.PI * 2;
const hx = (h: string, a = 255): RGBA => {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255, a];
};
/** Детерминированный шум по трём числам, 0…1 (та же формула, что в f10-art). */
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
const tick = (left: number) => left < SIG && Math.floor(left / 0.05) % 2 === 1;

// ---- Палитра: чёрный мрамор, кровь, золото, адский огонь, молния ------------

const C = {
  ink: '#0a0508',
  groove: '#050204',
  lip: '#5e5266',
  lipHi: '#8a7e96',
  redDk: '#3a0408',
  redMid: '#6a0c12',
  red: '#a8141c',
  crimson: '#e0202a',
  hot: '#ff4a2a',
  rose: '#ff9a7a',
  yellow: '#ffe070',
  white: '#fff8ee',
  gold: ['#5e3a10', '#9a6a1c', '#d8a23a', '#ffe28a'],
  fire: ['#5a0a04', '#a8300c', '#e05010', '#ffa030', '#fff0a0'],
  vio: ['#24104a', '#5a34a0', '#9a70e8', '#d8c8ff', '#ffffff'],
  wind: '#e6dcf0',
  pool: '#0c0410',
  shadow: '#000000',
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
/** Искра молнии: белая → сиреневая → фиолетовая. */
const zapCol = (k: number) =>
  k < 0.3 ? '#ffffff' : k < 0.6 ? C.vio[3] : k < 0.85 ? C.vio[2] : C.vio[1];
/** Раскалённый шов по остыванию 0 (белый) … 1 (тёмный). */
const heatCol = (k: number) =>
  k < 0.12
    ? C.white
    : k < 0.3
      ? C.fire[4]
      : k < 0.5
        ? C.fire[3]
        : k < 0.7
          ? C.fire[2]
          : k < 0.88
            ? C.fire[1]
            : C.fire[0];

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
 * кратен точке экрана; поправка `qx/qy` — остаток привязки движка, одна на
 * весь кадр, поэтому эффект стоит на полу, а не дрожит по нему.
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
  /** Прямоугольник в целых пикселях мира (уже с полом). */
  rect(x: number, y: number, w: number, h: number): void {
    this.g.fillRect(x + this.qx, y + this.qy, w, h);
  }
  img(c: HTMLCanvasElement, x: number, y: number): void {
    this.g.drawImage(c, Math.floor(x) + this.qx, Math.floor(y) + this.qy);
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

// ---- Кто заслоняет: тела ближе к камере ------------------------------------

/**
 * Слой поверх темноты рисуется после всех мобов. То, что в нём лежит на
 * полу (круг метки пера, выжженное пятно молнии), легло бы героям на
 * грудь. `occ(x, y, depth)` — пиксель мира (x, y) предмета, стоящего на
 * глубине `depth` (y его опоры, пиксели), заслонён телом, чьи ноги ближе к
 * камере. Тело — прямоугольник: король 1,9 × 4,6 клетки (в полёте — выше
 * на подъём), герой 0,8 × 1,2, прочие — по радиусу.
 */
interface Occ {
  (x: number, y: number, depth: number): boolean;
  /** Никого вокруг прямоугольника [x0, x1] × [y0, y1] — проверки не нужны. */
  clear(x0: number, y0: number, x1: number, y1: number, depth: number): boolean;
}
function occOf(S: number): Occ {
  const sim = paintSim();
  const b: number[] = [];
  if (sim) {
    for (const m of sim.mobs) {
      if (m.mode === 'dying' && m.t > 0.4) continue;
      const big = m.r >= 0.8;
      const lift = Math.round((m.data.z ?? 0) * 4) * 4;
      b.push(
        m.x * S,
        m.y * S + 2,
        big ? 0.95 * S : Math.max(5, m.r * S),
        big ? 4.6 * S : m.r * S * 3.4,
        lift,
      );
    }
    const h = sim.hero;
    b.push(h.x * S, h.y * S + 2, 0.4 * S, 1.2 * S, 0);
  }
  const f = ((x: number, y: number, depth: number) => {
    for (let i = 0; i < b.length; i += 5) {
      const fy = b[i + 1];
      if (depth >= fy - 1) continue;
      const bot = fy - b[i + 4];
      if (y > bot || y < bot - b[i + 3]) continue;
      if (Math.abs(x + 0.5 - b[i]) < b[i + 2]) return true;
    }
    return false;
  }) as Occ;
  f.clear = (x0, y0, x1, y1, depth) => {
    for (let i = 0; i < b.length; i += 5) {
      const fy = b[i + 1];
      if (depth >= fy - 1) continue;
      const bot = fy - b[i + 4];
      if (y1 < bot - b[i + 3] || y0 > bot) continue;
      if (x1 < b[i] - b[i + 2] || x0 > b[i] + b[i + 2]) continue;
      return false;
    }
    return true;
  };
  return f;
}

// ---- Заливки по строкам пикселей -------------------------------------------

/**
 * Кольцевой сектор [r0, r1] × [a0, a1] строками пикселей (центр пикселя
 * внутри — пиксель наш). Угол больше четверти круга режется на куски с
 * ОБЩИМИ границами: пиксель на стыке достаётся ровно одному куску, и
 * полупрозрачная заливка не даёт шва.
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
  // Строки только там, где кусок бывает: узкий срез серпа не гоняет весь круг.
  let ylo = -r1;
  let yhi = r1;
  if (!full) {
    const sa = Math.sin(a0);
    const sb = Math.sin(a1);
    ylo = Math.min(sa * r0, sa * r1, sb * r0, sb * r1);
    yhi = Math.max(sa * r0, sa * r1, sb * r0, sb * r1);
    if (inArc(-Math.PI / 2, a0, a1 - a0)) ylo = -r1;
    if (inArc(Math.PI / 2, a0, a1 - a0)) yhi = r1;
  }
  const y0 = Math.floor(cy + ylo) - 1;
  const y1 = Math.ceil(cy + yhi) + 1;
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
    // Через пиксель — мягкий край света без градиента.
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
): void {
  if (l1 <= l0) return;
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
    x: Int16Array.from(withA.map((p) => p[0])),
    y: Int16Array.from(withA.map((p) => p[1])),
    a: Float32Array.from(withA.map((p) => p[2])),
  };
  if (circles.size > 160) circles.delete(circles.keys().next().value as number);
  circles.set(R, c);
  return c;
}

/** Угол a в секторе [a0, a0 + span] (span > 0) с переходом через 2π. */
function inArc(a: number, a0: number, span: number): boolean {
  return mod(a - a0, TAU) <= span;
}

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
  for (let y = -R; y <= R; y++) {
    let run = -1;
    for (let x = -R; x <= R + 1; x++) {
      let inside = false;
      if (x <= R) {
        const dx = x0 + x + 0.5 - cx;
        const dy = y0 + y + 0.5 - cy;
        const a = (dx * ux + dy * uy) / l;
        const b = (-dx * uy + dy * ux) / w;
        inside = a * a + b * b <= 1 && !(dither && (x0 + x + y0 + y) & 1);
      }
      if (inside && run < 0) run = x;
      if (!inside && run >= 0) {
        if (dither) for (let q = run; q < x; q++) p.rect(x0 + q, y0 + y, 1, 1);
        else p.rect(x0 + run, y0 + y, x - run, 1);
        run = -1;
      }
    }
  }
}

/**
 * Звезда удара: n лучей радиуса r (у основания — 0,4 r), залита по
 * пикселям. Кадр контакта: рисуется два-три кадра, сжимаясь.
 */
function star(p: Pen, cx: number, cy: number, r: number, n: number, rot: number): void {
  const R = Math.ceil(r) + 1;
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  // Соседние пиксели строки сливаются в один прямоугольник.
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

// ---- Спрайты-заготовки -------------------------------------------------------

const sprites = new Map<number, HTMLCanvasElement>();
const sprite = (key: number, make: () => Px): HTMLCanvasElement => {
  let c = sprites.get(key);
  if (!c) {
    c = make().canvas();
    sprites.set(key, c);
  }
  return c;
};

/** Пыль: тень снизу-справа, основа, свет сверху-слева. */
const PUFF_PAL: [RGBA, RGBA, RGBA][] = [
  [hx('#463e52'), hx('#6a607a'), hx('#a096b0')], // 0 — мраморная пыль, светлее пола и камня
  [hx('#0a070c'), hx('#1c1620'), hx('#302838')], // 1 — копоть и дым
  [hx('#3a0e0c'), hx('#6a1e16'), hx('#9a3a24')], // 2 — горячий пепел
  [hx('#6a6278'), hx('#a8a0b8'), hx('#e0daea')], // 3 — ветер крыльев, рёв
  [hx('#040206'), hx('#10061a'), hx('#240c30')], // 4 — тьма короля
];

/**
 * Клуб пыли радиуса r (1…16), вариант v (0…3): три доли, чтобы край был
 * рваным, а не циркульным. Свет сверху-слева, тень — у нижней кромки.
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
        // Сплошной клуб в два-три тона: край через пиксель на телефоне
        // читался щетиной. Лёгкость даёт прозрачность при рисовании.
        const low = !inside(x, y + 2) && l < 0.1;
        p.set(x, y, low && R > 2 ? sh : l > 0.3 ? hi : mid);
      }
    return p;
  });
}

const CHUNK_PAL: RGBA[][] = [
  [hx('#08060a'), hx('#1d1822'), hx('#3a3242'), hx('#6a6078')], // 0 — чёрный мрамор
  [hx('#34070b'), hx('#641015'), hx('#9e1e26'), hx('#d8424a')], // 1 — багровый ковёр, помост
];

/** Обломок размера 1…4, поворот f (0…3): грань с объёмом, у крупных — жила золота. */
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
        // Скол, а не галька: одна сторона срезана прямой.
        const u = (dx * ca + dy * sa) / rx;
        const w = (-dx * sa + dy * ca) / ry;
        if (u * u + w * w > 1 || u + w * 0.6 > 0.8) continue;
        const l = -dx * 0.6 - dy * 0.8;
        p.set(x, y, l > 0.6 ? t[3] : l > -0.2 ? t[2] : l > -0.9 ? t[1] : t[0]);
      }
    if (sz >= 3 && pal === 0) p.set(Math.floor(c), Math.floor(c) - 1, hx(C.gold[2]));
    p.outline(hx(C.ink));
    return p;
  });
}

/** Язык пламени высоты h (3…12), кадр f (0…3); основание — низ по центру. */
function flameImg(h: number, f: number): HTMLCanvasElement {
  const H = Math.max(3, Math.min(12, Math.round(h)));
  return sprite(30000 + H * 8 + (f & 3), () => {
    const w = Math.max(3, Math.round(H * 0.5)) | 1;
    const p = new Px(w + 2, H + 1);
    const cx = (w + 2) / 2;
    const fire = C.fire.map((c) => hx(c));
    for (let y = 0; y < H; y++) {
      const t = y / Math.max(1, H - 1);
      const half = (w / 2) * Math.pow(Math.sin(Math.PI * Math.min(1, 0.12 + t * 0.95) * 0.5), 0.9);
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
        p.set(x, y, col);
      }
    }
    return p;
  });
}

/**
 * Перо пламени 15×15, кадр поворота f (0…7 — полоборота): тёмно-багровое
 * опахало, огненная кромка, золотой стержень, язычок огня на кончике.
 * Поворот считается по формуле на кадр, а не крутит готовую картинку —
 * пиксели ровные в любом кадре.
 */
function featherImg(f: number): HTMLCanvasElement {
  return sprite(40000 + (f & 7), () => {
    const p = new Px(15, 15);
    const th = ((f & 7) / 8) * Math.PI - 0.6;
    const ca = Math.cos(th);
    const sa = Math.sin(th);
    const body = [hx('#3a0408'), hx('#6a0c12'), hx('#a8141c')];
    for (let y = 0; y < 15; y++)
      for (let x = 0; x < 15; x++) {
        const dx = x + 0.5 - 7.5;
        const dy = y + 0.5 - 7.5;
        const al = dx * ca + dy * sa; // вдоль, −6 … 6 (кончик — +)
        const ac = -dx * sa + dy * ca;
        if (al < -6.2 || al > 6.2) continue;
        const u = (al + 6.2) / 12.4;
        const hw = 2.5 * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.08)), 0.75) + 0.2;
        const w = ac < 0 ? hw : hw * 0.8;
        if (Math.abs(ac) > w) continue;
        let c: RGBA;
        if (Math.abs(ac) < 0.55 && u < 0.92) c = u < 0.2 ? hx(C.gold[2]) : hx(C.gold[3]);
        else if (Math.abs(ac) > w - 0.9) c = u > 0.55 ? hx(C.fire[3]) : hx(C.fire[2]);
        else c = body[ac < 0 ? 2 : u > 0.5 ? 1 : 0];
        if (u > 0.9) c = hx(C.fire[4]);
        p.set(x, y, c);
      }
    p.outline(hx('#1a0406'));
    return p;
  });
}

/** Столб молнии высоты H (кратно 8), вариант v: зигзаг с отростками. */
interface BoltCol {
  img: HTMLCanvasElement;
  x: Int16Array;
  y: Int16Array;
  core: Uint8Array;
  w: number;
  h: number;
}
const bolts = new Map<number, BoltCol>();
function boltCol(v: number, H: number): BoltCol {
  const key = (v & 7) * 1000 + H;
  let b = bolts.get(key);
  if (b) return b;
  const W = 23;
  const p = new Px(W, H + 2);
  const pts: [number, number][] = [];
  const n = Math.max(5, Math.round(H / 14));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const j = i === n ? 0 : (hash(v, i, 71) - 0.5) * 12;
    pts.push([11 + j, H * t]);
  }
  const glow = hx(C.vio[2]);
  const core = hx('#ffffff');
  const pix = new Map<number, number>();
  const put = (x: number, y: number, c: number) => {
    const X = Math.round(x);
    const Y = Math.round(y);
    if (X < 0 || Y < 0 || X >= W || Y > H + 1) return;
    const k = X * 4096 + Y;
    if ((pix.get(k) ?? 0) < c) pix.set(k, c);
  };
  const seg = (x0: number, y0: number, x1: number, y1: number, thick: boolean) => {
    const m = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)));
    for (let i = 0; i <= m; i++) {
      const x = x0 + ((x1 - x0) * i) / Math.max(1, m);
      const y = y0 + ((y1 - y0) * i) / Math.max(1, m);
      put(x, y, 2);
      put(x - 1, y, 1);
      put(x + 1, y, 1);
      if (thick) {
        put(x - 2, y, 1);
        put(x + 2, y, 1);
      }
    }
  };
  for (let i = 0; i < n; i++) seg(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], i > n - 3);
  // Отростки: два коротких «корня» от середины.
  for (let k = 0; k < 2; k++) {
    const i = 1 + Math.floor(hash(v, k, 72) * (n - 2));
    const [x, y] = pts[i];
    const s = hash(v, k, 73) < 0.5 ? -1 : 1;
    const l = 5 + hash(v, k, 74) * 6;
    const xm = x + s * l * 0.6;
    const ym = y + l * 0.7;
    const m = Math.ceil(l);
    for (let q = 0; q <= m; q++) put(x + ((xm - x) * q) / m, y + ((ym - y) * q) / m, 2);
  }
  const xs: number[] = [];
  const ys: number[] = [];
  const cs: number[] = [];
  for (const [k, c] of pix) {
    const x = Math.floor(k / 4096);
    const y = k % 4096;
    p.set(x, y, c === 2 ? core : glow);
    xs.push(x - 11);
    ys.push(y - H);
    cs.push(c);
  }
  b = {
    img: p.canvas(),
    x: Int16Array.from(xs),
    y: Int16Array.from(ys),
    core: Uint8Array.from(cs),
    w: W,
    h: H + 2,
  };
  bolts.set(key, b);
  return b;
}

/**
 * Тень крыльев короля на полу: тело-овал и два перепончатых крыла с
 * фестонами. `span` — полуразмах, пиксели (12…30), взмах f (0…3) — крылья
 * поднимаются, и тень короче. `soft` — через пиксель (король высоко).
 */
function wingShadow(span: number, f: number, soft: boolean): HTMLCanvasElement {
  const Sp = Math.max(10, Math.min(32, Math.round(span)));
  return sprite(50000 + Sp * 16 + (f & 3) * 2 + (soft ? 1 : 0), () => {
    const fold = [1, 0.84, 0.66, 0.84][f & 3];
    const half = Sp * fold;
    const W = Math.ceil(Sp) * 2 + 3;
    const Hh = Math.ceil(Sp * 0.7) + 4;
    const p = new Px(W, Hh);
    const cx = W / 2;
    const cy = Hh / 2;
    const col = hx('#000000');
    for (let y = 0; y < Hh; y++)
      for (let x = 0; x < W; x++) {
        if (soft && (x + y) & 1) continue;
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const ax = Math.abs(dx);
        // Тело и голова с рогами.
        let inside = (dx / 3.2) ** 2 + (dy / 5.2) ** 2 <= 1;
        if (!inside && ax < 2.5 && dy < -4 && dy > -7.5) inside = ax > 0.8 && ax < 2.6;
        if (!inside && ax <= half) {
          // Крыло: передний край от плеча к концу чуть вверх, задний —
          // фестонами между пальцами.
          const u = ax / half;
          const top = -2 - u * Sp * 0.18;
          const scal = Math.abs(Math.sin(u * Math.PI * 3));
          const bot = 2 + (1 - u) * Sp * 0.28 - scal * Sp * 0.12 * u;
          inside = ax > 1.5 && dy >= top && dy <= bot;
        }
        if (inside) p.set(x, y, col);
      }
    return p;
  });
}

/** Выжженное пятно радиуса r: тёмное, край — через пиксель. */
function scorchImg(r: number, tone: number): HTMLCanvasElement {
  const R = Math.max(2, Math.min(24, Math.round(r)));
  return sprite(60000 + R * 4 + tone, () => {
    const s = R * 2 + 1;
    const p = new Px(s, s);
    const c = [hx('#050208'), hx('#12060a'), hx('#1a0c04')][tone];
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
  at?: (i: number) => [number, number, number?],
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
      p.col(C.ink, 0.35 * a);
      p.dot(gx - sz / 2, gy + 1, sz, 1);
    }
    const spin = f.air ? Math.floor(t * (14 + r2 * 10) + i) & 3 : i & 3;
    const im = chunkImg(sz, spin, pal);
    p.alpha(a);
    p.img(im, gx - im.width / 2, gy - f.z - im.height / 2);
  }
}

/**
 * Пыль клубами: `n` клубов из (x, y), направление `ang` ± `spread`, скорость
 * с сопротивлением, растут `r0 → r1`, поднимаются на `rise` и тают за `life`.
 * `delay(i)` — когда рождается i-й, `at(i)` — откуда.
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
  at?: (i: number) => [number, number, number?],
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
    // Клуб раздувается, а под конец садится и тает — пыль оседает, а не
    // висит камнем.
    const grow = eOut2(k01(t / (L * 0.45)));
    const settle = 1 - 0.45 * k01((k - 0.55) / 0.45);
    const r = (r0 + (r1 - r0) * sz * grow) * settle;
    const z = rise * (0.6 + 0.4 * h2) * eOut2(k);
    const im = puffImg(pal, r, i);
    p.alpha(0.85 * alpha * (k < 0.15 ? 1 : 1 - Math.pow((k - 0.15) / 0.85, 0.9)));
    const ox = src ? src[0] : x;
    const oy = src ? src[1] : y;
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
  at?: (i: number) => [number, number, number?],
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
): void {
  for (let i = 0; i < n; i++) {
    const t = age - born(i);
    const L = life * (0.7 + 0.5 * hash(seed, i, 41));
    if (t < 0 || t >= L) continue;
    const k = t / L;
    const [x, y] = at(i);
    const sw = Math.sin(t * (5 + 3 * hash(seed, i, 42)) + i) * (1.5 + 2 * k);
    const z = rise * (0.6 + 0.6 * hash(seed, i, 43)) * eOut2(k);
    p.col(sparkCol(0.25 + k * 0.75), a0 * (1 - k * k));
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
  /** Рамка от корня: x0, y0, x1, y1 (с кромкой). */
  box: [number, number, number, number];
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
    .filter(([x, y, d]) => d < maxLen * 0.6 && !px.has(K(x + 1, y + 1)))
    .map(([x, y, d]) => [x + 1, y + 1, d]);
  c = {
    x: Int16Array.from(pts.map((p) => p[0])),
    y: Int16Array.from(pts.map((p) => p[1])),
    d: Float32Array.from(pts.map((p) => p[2])),
    lx: Int16Array.from(lips.map((p) => p[0])),
    ly: Int16Array.from(lips.map((p) => p[1])),
    ld: Float32Array.from(lips.map((p) => p[2])),
    max: pts.length ? pts[pts.length - 1][2] : 0,
    box: [
      Math.min(0, ...pts.map((q) => q[0])),
      Math.min(0, ...pts.map((q) => q[1])),
      Math.max(0, ...pts.map((q) => q[0])) + 1,
      Math.max(0, ...pts.map((q) => q[1])) + 1,
    ],
  };
  if (cracks.size > 60) cracks.delete(cracks.keys().next().value as string);
  cracks.set(key, c);
  return c;
}

/**
 * Раскрытая трещина одним холстом: пока бежит — по пикселям, дорисовалась —
 * одним `drawImage`.
 */
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
    const l = hx(lip, Math.round(0.75 * 255));
    for (let i = 0; i < c.lx.length; i++) px.set(c.lx[i] - x0, c.ly[i] - y0, l);
  }
  const k = hx(core);
  for (let i = 0; i < c.x.length; i++) px.set(c.x[i] - x0, c.y[i] - y0, k);
  hit = { img: px.canvas(), x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } as {
    img: HTMLCanvasElement;
    x: number;
    y: number;
  };
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
  occ?: Occ,
  depth = 0,
): void {
  if (a <= 0) return;
  const ox = Math.floor(x);
  const oy = Math.floor(y);
  if (
    reach >= c.max &&
    (!occ || occ.clear(ox + c.box[0], oy + c.box[1], ox + c.box[2], oy + c.box[3], depth))
  ) {
    const im = crackImg(c, core, lip);
    p.alpha(a);
    p.img(im.img, ox + im.x, oy + im.y);
    return;
  }
  if (lip) {
    p.col(lip, a * 0.75);
    for (let i = 0; i < c.lx.length && c.ld[i] <= reach; i++)
      if (!occ || !occ(ox + c.lx[i], oy + c.ly[i], depth)) p.dot(ox + c.lx[i], oy + c.ly[i]);
  }
  p.col(core, a);
  for (let i = 0; i < c.x.length && c.d[i] <= reach; i++)
    if (!occ || !occ(ox + c.x[i], oy + c.y[i], depth)) p.dot(ox + c.x[i], oy + c.y[i]);
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

/** Лишние поля визуальных зон мозга (`vfx()` в f10-brains) и зон удара. */
type FxZone = Zone & {
  ang?: number;
  len?: number;
  vd?: number;
  n?: number;
  cells?: number[];
  follow?: number;
};

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

/** Метка удара: налив 0…1 и сколько осталось до урона, с. */
const warnOf = (z: Zone | Strike) => {
  const st = z as Strike;
  const w = Math.max(0.01, st.warn ?? 0.01);
  return { k: k01(st.t / w), left: w - st.t };
};

/** Кромка сектора: дуга и два края, тёмная снаружи. `keep(u)` — пунктир. */
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
    const d = mod(ang - a0, TAU);
    return keep(Math.min(d, arc - d) * R);
  };
  ring(p, cx, cy, R + 1, C.ink, a * 0.7, ok);
  ring(p, cx, cy, R, c, a, ok);
  for (const ea of [a0, a0 + arc]) {
    const ex = Math.cos(ea);
    const ey = Math.sin(ea);
    const out = ea === a0 ? -1 : 1;
    const nx = -ey * out;
    const ny = ex * out;
    for (let r = r0; r < R; r += 1) {
      if (keep && !keep(R - r)) continue;
      p.col(C.ink, a * 0.7);
      p.dot(cx + ex * r + nx, cy + ey * r + ny);
      p.col(c, a);
      p.dot(cx + ex * r, cy + ey * r);
    }
  }
}

/** Четыре уголка прицела остриём внутрь: на радиусе r, поворот rot. */
function corners(
  p: Pen,
  cx: number,
  cy: number,
  r: number,
  rot: number,
  c: string,
  a: number,
  len = 4,
): void {
  for (let i = 0; i < 4; i++) {
    const t = rot + (i * Math.PI) / 2;
    const ux = Math.cos(t);
    const uy = Math.sin(t);
    const tx = cx + ux * r;
    const ty = cy + uy * r;
    for (const s of [-1, 1]) {
      const bx = tx + ux * len * 0.8 - uy * len * 0.8 * s;
      const by = ty + uy * len * 0.8 + ux * len * 0.8 * s;
      p.lineS(tx, ty, bx, by, c, a, 0.6);
    }
  }
}

/** Картинка на полу в слое поверх темноты: пиксели за телами — не рисуем. */
function imgO(
  p: Pen,
  occ: Occ,
  im: HTMLCanvasElement,
  x: number,
  y: number,
  depth: number,
  a: number,
): void {
  if (a <= 0) return;
  const X = Math.floor(x);
  const Y = Math.floor(y);
  p.alpha(a);
  if (occ.clear(X, Y, X + im.width, Y + im.height, depth)) {
    p.img(im, X, Y);
    return;
  }
  // Заслонено: по строкам — видимые куски строки картинки.
  const g = p.g;
  for (let yy = 0; yy < im.height; yy++) {
    let run = -1;
    for (let xx = 0; xx <= im.width; xx++) {
      const vis = xx < im.width && !occ(X + xx, Y + yy, depth);
      if (vis && run < 0) run = xx;
      if (!vis && run >= 0) {
        g.drawImage(im, run, yy, xx - run, 1, X + run + p.qx, Y + yy + p.qy, xx - run, 1);
        run = -1;
      }
    }
  }
}

// =============================================================================
// РАССЕЧЕНИЕ — веер r 3,3, дуга 2,4 (метка встаёт в 0,25 с, удар — в
// 0,85/0,74/0,65 с режима). Метка: весь веер тёмным багрецом с первого
// кадра; серп бежит от короля к краю с разгоном (как меч) и оставляет за
// собой налив; два бледных повтора позади — след. Кромка пунктиром, штрихи
// сходятся к оси; последние 0,2 с — белая кромка и «тик-тик». Контакт:
// клинок проходит веер сверху вниз размытым серпом (белое остриё, багровое
// тело, тёмный хвост) с проводкой за край; в мраморе остаётся раскалённый
// рубец дугой, из него — искры по ходу меча, крошка и пыль к краю, волна
// воздуха за кромкой.
// =============================================================================

/** Серп: полоса у внешнего радиуса, толще в середине дуги, тоньше к рогам. */
function crescent(
  p: Pen,
  cx: number,
  cy: number,
  rOut: number,
  a0: number,
  arc: number,
  th: number,
  c: string,
  a: number,
): void {
  const n = 9;
  p.col(c, a);
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n;
    const t = Math.max(1, th * Math.pow(Math.sin(Math.PI * u), 0.7));
    fillSector(
      p,
      cx,
      cy,
      Math.max(0, rOut - t),
      rOut,
      a0 + (arc * i) / n,
      a0 + (arc * (i + 1)) / n,
    );
  }
}

/** Откуда идёт меч: от края веера, что выше на экране (удар сверху вниз). */
function sweepOf(a: number, arc: number): { as: number; dir: number } {
  const s0 = Math.sin(a - arc / 2);
  const s1 = Math.sin(a + arc / 2);
  return s0 <= s1 + 1e-6 ? { as: a - arc / 2, dir: 1 } : { as: a + arc / 2, dir: -1 };
}

/** Когда фронт `eOut2` на пути `span` за `T` с проходит точку s. */
const sweepT = (s: number, span: number, T: number) => T * (1 - Math.sqrt(1 - k01(s / span)));

registerZonePainter(
  'f10_slash',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const st = z as Strike;
    const { k, left } = warnOf(st);
    const sig = left < SIG;
    const tk = !reduced() && tick(left);
    const cx = st.x * S;
    const cy = st.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = st.r * S;
    const arc = st.arc ?? 2.4;
    const a0 = (st.ang ?? 0) - arc / 2;
    const r0 = S * 0.5;
    const sd = st.id >>> 0;
    // «Куда»: весь веер сразу.
    p.col(C.redDk, 0.36 + 0.12 * k);
    fillSector(p, cx, cy, r0, R, a0, a0 + arc);
    // «Когда»: серп от короля к краю с разгоном; за ним — налив.
    const rAt = (kk: number) => r0 + (R - r0) * Math.pow(k01(kk), 1.7);
    const rf = rAt(k);
    p.col(sig ? C.red : C.redMid, (tk ? 0.62 : 0.4) + 0.14 * k);
    fillSector(p, cx, cy, r0, rf, a0, a0 + arc);
    for (const [lag, al] of [
      [0.2, 0.3],
      [0.1, 0.5],
    ] as const) {
      const rr = rAt(k - lag);
      if (rr > r0 + 3) crescent(p, cx, cy, rr, a0, arc, 2, C.red, al);
    }
    crescent(p, cx, cy, rf, a0, arc, 2 + 4 * k, sig ? C.hot : C.crimson, 0.95);
    ring(p, cx, cy, rf, sig ? C.white : C.rose, 0.95, (ang) => inArc(ang, a0, arc));
    // Кромка: штрихи бегут от краёв к оси — удар сходится в веер.
    const run = time * (20 + 50 * k);
    sectorRim(
      p,
      cx,
      cy,
      R,
      a0,
      arc,
      r0,
      sig ? (tk ? C.white : C.yellow) : k > 0.5 ? C.hot : C.crimson,
      0.75 + 0.25 * k,
      sig ? undefined : (u) => mod(u - run, 8) < 5,
    );
    // Мраморная крошка в веере дрожит, к удару — подскакивает.
    for (let i = 0; i < 14; i++) {
      const rr = R * (0.4 + 0.55 * hash(sd, i, 5));
      const aa = a0 + arc * hash(sd, i, 6);
      const hop = k > 0.35 ? Math.floor(hash(i, Math.floor(time * 16), sd) * (1 + 3 * k)) : 0;
      const gx = cx + Math.cos(aa) * rr;
      const gy = cy + Math.sin(aa) * rr;
      if (hop) {
        p.col(C.ink, 0.45);
        p.dot(gx, gy + 1);
      }
      p.col(C.lipHi, 0.85);
      p.dot(gx, gy - hop);
    }
  }),
);

/** Рубец в мраморе: дуга с волной, пиксели по ходу меча (`u` — доля пути). */
interface Gash {
  x: Int16Array;
  y: Int16Array;
  u: Float32Array;
}
const gashes = new Map<string, Gash>();
function gashOf(seed: number, R: number, as: number, dir: number, span: number): Gash {
  const key = `${seed}|${Math.round(R)}|${Math.round(as * 100)}|${dir}|${Math.round(span * 100)}`;
  let gs = gashes.get(key);
  if (gs) return gs;
  const rg = R * 0.78;
  const xs: number[] = [];
  const ys: number[] = [];
  const us: number[] = [];
  const ph1 = hash(seed, 1, 61) * TAU;
  const ph2 = hash(seed, 2, 61) * TAU;
  let lx = 1e9;
  let ly = 1e9;
  for (let s = 0; s <= span; s += 0.4 / rg) {
    const u = s / span;
    const wob = 1.6 * Math.sin(s * 3 + ph1) + 0.8 * Math.sin(s * 8 + ph2);
    const ang = as + dir * s;
    const r = rg + wob;
    const x = Math.floor(Math.cos(ang) * r);
    const y = Math.floor(Math.sin(ang) * r);
    if (x === lx && y === ly) continue;
    lx = x;
    ly = y;
    xs.push(x);
    ys.push(y);
    us.push(u);
    // В середине рубец шире: второй пиксель к центру.
    if (u > 0.16 && u < 0.84) {
      const x2 = Math.floor(Math.cos(ang) * (r - 1));
      const y2 = Math.floor(Math.sin(ang) * (r - 1));
      if (x2 !== x || y2 !== y) {
        xs.push(x2);
        ys.push(y2);
        us.push(u);
      }
    }
  }
  gs = { x: Int16Array.from(xs), y: Int16Array.from(ys), u: Float32Array.from(us) };
  if (gashes.size > 24) gashes.delete(gashes.keys().next().value as string);
  gashes.set(key, gs);
  return gs;
}

const SLASH_SWEEP = 0.15;
const SLASH_OVER = 0.4;

registerImpactPainter('f10_slash', {
  life: 1.35,
  shake: 0.25,
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const cx = rec.x * S;
    const cy = rec.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = (rec.r ?? 3.3) * S;
    const a = rec.ang ?? 0;
    const arc = rec.arc ?? 2.4;
    const { as, dir } = sweepOf(a, arc);
    const sd = rec.seed >>> 0;
    const few = reduced();
    const span = arc + SLASH_OVER;
    const at = (s: number) => as + dir * s;
    const front = span * eOut2(k01(age / SLASH_SWEEP));
    const tail = span * eOut2(k01((age - 0.05) / 0.22));
    // Смаз клинка: остриё белое, тело багровое, хвост тёмный; за краем веера
    // (проводка) серп тоньше и тает.
    const fadeA = 1 - k01((age - 0.14) / 0.14);
    if (front - tail > 0.02 && fadeA > 0) {
      const len = front - tail;
      const n = Math.max(2, Math.min(24, Math.ceil(len / 0.07)));
      for (let j = 0; j < n; j++) {
        const s1 = front - (len * j) / n;
        const s0 = front - (len * (j + 1)) / n;
        const q = (j + 0.5) / n;
        const past = k01((s1 - arc) / SLASH_OVER);
        const rout = R + 1 - past * 4;
        const rin = Math.min(rout - 1, R * (0.46 + 0.36 * q + 0.28 * past));
        const lo = Math.min(at(s0), at(s1));
        const hi = Math.max(at(s0), at(s1));
        if (q < 0.22) {
          p.col(C.crimson, 0.95 * fadeA);
          fillSector(p, cx, cy, rin, rout - 4, lo, hi);
          p.col(C.fire[4], fadeA);
          fillSector(p, cx, cy, Math.max(rin, rout - 4), rout - 1, lo, hi);
          p.col(C.white, fadeA);
          fillSector(p, cx, cy, Math.max(rin, rout - 1.5), rout, lo, hi);
        } else if (q < 0.6) {
          p.col(C.crimson, 0.9 * fadeA);
          fillSector(p, cx, cy, rin, rout, lo, hi);
          p.col(C.rose, 0.85 * fadeA);
          fillSector(p, cx, cy, Math.max(rin, rout - 2), rout, lo, hi);
        } else {
          p.col(C.red, 0.75 * fadeA * (1 - ((q - 0.6) / 0.4) * 0.6));
          fillSector(p, cx, cy, rin, rout, lo, hi);
        }
      }
    }
    // Кадр контакта: кромка веера вспыхивает целиком.
    if (age < 0.07)
      ring(p, cx, cy, R, C.white, 1 - age / 0.07, (ang) => inArc(ang, a - arc / 2, arc), 0.5);
    // Рубец: раскрывается за клинком, остывает от белого к тёмному жёлобу.
    const g0 = 0.12;
    const gspan = arc - 0.24;
    const gs = gashOf(sd, R, at(g0), dir, gspan);
    const reveal = k01((front - g0) / gspan);
    const fade = 1 - k01((age - 0.95) / 0.4);
    if (fade > 0 && reveal > 0) {
      const ox = Math.floor(cx);
      const oy = Math.floor(cy);
      p.col(C.lip, 0.7 * fade);
      for (let i = 0; i < gs.x.length; i++)
        if (gs.u[i] <= reveal) p.dot(ox + gs.x[i] + 1, oy + gs.y[i] + 1);
      // Жар по пикселям: где клинок прошёл раньше — там уже остывает.
      const cols = [C.white, C.fire[4], C.fire[3], C.fire[2], C.fire[1], C.fire[0], C.groove];
      for (let b = 0; b < cols.length; b++) {
        p.col(cols[b], fade);
        for (let i = 0; i < gs.x.length; i++) {
          const u = gs.u[i];
          if (u > reveal) continue;
          const tc = sweepT(g0 + u * gspan, span, SLASH_SWEEP);
          const h = k01((age - tc) / 0.85);
          const bi =
            h < 0.1 ? 0 : h < 0.25 ? 1 : h < 0.45 ? 2 : h < 0.65 ? 3 : h < 0.85 ? 4 : h < 1 ? 5 : 6;
          if (bi === b) p.dot(ox + gs.x[i], oy + gs.y[i]);
        }
      }
    }
    // Искры из рубца по ходу меча: рождаются, когда клинок проходит место.
    const nS = few ? 5 : 14;
    const pick = (i: number) =>
      Math.min(gs.x.length - 1, Math.floor(hash(sd, i, 81) * gs.x.length));
    sparks(
      p,
      sd,
      age,
      cx,
      cy,
      nS,
      0,
      0.45,
      70,
      80,
      0.42,
      55,
      sparkCol,
      (i) => sweepT(g0 + gs.u[pick(i)] * gspan, span, SLASH_SWEEP),
      (i) => {
        const j = pick(i);
        const th = at(g0 + gs.u[j] * gspan);
        return [cx + gs.x[j], cy + gs.y[j], th + dir * Math.PI * 0.32];
      },
    );
    // Крошка из рубца и пыль к краю веера.
    chunks(
      p,
      sd + 3,
      age,
      cx,
      cy,
      few ? 3 : 8,
      0,
      0.5,
      22,
      30,
      45,
      45,
      [0.95, 1.3],
      0.25,
      0,
      (i) => sweepT(g0 + gs.u[pick(i + 20)] * gspan, span, SLASH_SWEEP),
      (i) => {
        const j = pick(i + 20);
        return [cx + gs.x[j], cy + gs.y[j], at(g0 + gs.u[j] * gspan)];
      },
    );
    const nD = few ? 3 : 7;
    dust(
      p,
      sd + 5,
      age,
      cx,
      cy,
      nD,
      0,
      0.3,
      14,
      16,
      1.5,
      5,
      6,
      0.85,
      0,
      0.6,
      (i) => sweepT(((i + 0.5) / nD) * arc, span, SLASH_SWEEP) + 0.02,
      (i) => {
        const th = at(((i + 0.5) / nD) * arc);
        return [cx + Math.cos(th) * R * 0.9, cy + Math.sin(th) * R * 0.9, th];
      },
    );
    // Волна воздуха за кромкой.
    if (age < 0.3)
      ring(
        p,
        cx,
        cy,
        R + 3 + 16 * eOut2(age / 0.3),
        C.wind,
        0.75 * (1 - age / 0.3),
        (ang, i) => inArc(ang, a - arc / 2, arc) && hash(i >> 1, sd, 9) > 0.25,
        0.5,
      );
  }),
});

// =============================================================================
// РУБКА — полоса от короля по взгляду (до стены, не длиннее 6,2 клетки),
// полуширина 0,75; метка встаёт в 0,3 с, удар — в 0,95/0,83/0,73 с. Метка:
// полоса тёмным багрецом с первого кадра, пунктир краёв бежит от короля;
// трещина бежит от меча к концу полосы и доходит ровно в миг удара; тень
// опускающегося меча растёт от короткой (меч над головой) к длинной (меч у
// пола) и из мягкой становится чёткой. Контакт: меч входит в плиты (звезда,
// воронка), по полосе бежит волна — плиты вскидывает, крошка и пыль в
// стороны, искры на конце. Трещину дальше держит разлом `f10_rift` (тлеет
// 2,2 с) — рисунок тот же, что у метки.
// =============================================================================

/** Где меч входит в пол, клеток от короля (там же `boom` мозга). */
const CLEAVE_BITE = 2;
/** Откуда начинается трещина, клеток от короля. */
const RIFT_FROM = 0.95;

/** Зерно трещины рубки: одно у метки и у разлома (место и угол удара). */
const riftSeed = (x: number, y: number, a: number) =>
  (Math.round(x * 4) * 7919 + Math.round(y * 4) * 104729 + Math.round(a * 60) * 31337) >>> 0;
function riftCrack(seed: number, a: number, len: number): Crack {
  const L = Math.max(4, Math.round(len));
  return crackOf(`rift|${seed}|${L}`, seed, [[a, L, 3]], 0.32, 0.16, 0.22);
}

registerZonePainter(
  'f10_cleave',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const st = z as Strike;
    const { k, left } = warnOf(st);
    const sig = left < SIG;
    const tk = !reduced() && tick(left);
    const cx = st.x * S;
    const cy = st.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const a = st.ang ?? 0;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const nx = -uy;
    const ny = ux;
    const L = st.r * S;
    const hw = (st.w ?? 0.75) * S;
    const l0 = S * 0.55;
    const s0 = RIFT_FROM * S;
    const sd = st.id >>> 0;
    // «Куда»: вся полоса.
    p.col(C.redDk, 0.36 + 0.12 * k);
    fillLane(p, cx, cy, ux, uy, l0, L, hw);
    // «Когда»: налив за трещиной, трещина — до конца ровно к удару.
    const e = Math.pow(k, 1.5);
    const reach = (L - s0) * e;
    p.col(sig ? C.red : C.redMid, (tk ? 0.62 : 0.36) + 0.14 * k);
    fillLane(p, cx, cy, ux, uy, l0, s0 + reach, hw * (0.4 + 0.6 * e));
    // Края пунктиром: штрихи бегут от короля к концу.
    const run = time * (26 + 70 * k);
    const edge = sig ? (tk ? C.white : C.yellow) : k > 0.5 ? C.hot : C.crimson;
    for (let s = l0; s < L; s += 1) {
      if (!sig && mod(s - run, 9) >= 5) continue;
      for (const side of [-1, 1]) {
        const ex = cx + ux * s + nx * hw * side;
        const ey = cy + uy * s + ny * hw * side;
        p.col(C.ink, 0.6);
        p.dot(ex + nx * side, ey + ny * side);
        p.col(edge, 0.75 + 0.25 * k);
        p.dot(ex, ey);
      }
    }
    // Конец полосы — поперечная планка: дальше рубка не достаёт.
    p.lineS(
      cx + ux * L + nx * hw,
      cy + uy * L + ny * hw,
      cx + ux * L - nx * hw,
      cy + uy * L - ny * hw,
      edge,
      0.8,
      0.6,
    );
    // Тень опускающегося меча: короткая и мягкая → длинная и чёткая.
    const dk = Math.pow(k, 2.2);
    const shL = S * (0.35 + 1.55 * dk);
    p.col(C.shadow, 0.4 + 0.5 * dk);
    lens(
      p,
      cx + ux * (S * 0.55 + shL / 2),
      cy + uy * (S * 0.55 + shL / 2),
      ux,
      uy,
      shL / 2,
      1.3 + dk,
      dk < 0.55,
    );
    // Трещина от меча — тот же рисунок, что у разлома после удара.
    const ck = riftCrack(riftSeed(st.x, st.y, a), a, L - s0);
    drawCrack(
      p,
      ck,
      cx + ux * s0,
      cy + uy * s0,
      ck.max * e,
      sig ? C.fire[4] : k > 0.6 ? C.fire[3] : C.hot,
      null,
      0.95,
    );
    // Крошка на полосе подпрыгивает, к удару — выше.
    if (k > 0.3)
      for (let i = 0; i < 12; i++) {
        const s = l0 + (L - l0) * hash(sd, i, 7);
        const o = (hash(sd, i, 8) - 0.5) * 2 * hw * 0.8;
        const hop = Math.floor(hash(i, Math.floor(time * 16), sd) * (1 + 3 * k));
        const gx = cx + ux * s + nx * o;
        const gy = cy + uy * s + ny * o;
        if (hop) {
          p.col(C.ink, 0.45);
          p.dot(gx, gy + 1);
        }
        p.col(C.lipHi, 0.85);
        p.dot(gx, gy - hop);
      }
  }),
);

const CLEAVE_RUN = 0.14;

registerImpactPainter('f10_cleave', {
  life: 1.5,
  shake: 0.3,
  flash: 0.22,
  flashRgb: '255,70,40',
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const cx = rec.x * S;
    const cy = rec.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const a = rec.ang ?? 0;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const nx = -uy;
    const ny = ux;
    const L = (rec.r ?? 6.2) * S;
    const hw = (rec.w ?? 0.75) * S;
    const s0 = RIFT_FROM * S;
    const sd = rec.seed >>> 0;
    const few = reduced();
    const bx = cx + ux * CLEAVE_BITE * S;
    const by = cy + uy * CLEAVE_BITE * S;
    // Волна по полосе: от меча к концу за 0,14 с.
    const df = s0 + (L - s0) * eOut2(k01(age / CLEAVE_RUN));
    const passT = (s: number) => CLEAVE_RUN * (1 - Math.sqrt(1 - k01((s - s0) / (L - s0))));
    const glow = 1 - k01(age / 0.4);
    if (glow > 0) {
      // Вся полоса ещё горит меткой и гаснет — удар не «выключает» её.
      p.col(C.red, 0.4 * (1 - k01(age / 0.25)));
      fillLane(p, cx, cy, ux, uy, S * 0.55, L, hw);
      p.col(C.crimson, 0.5 * glow);
      fillLane(p, cx, cy, ux, uy, s0, df, hw * 0.6);
      p.col(C.fire[3], 0.6 * glow);
      fillLane(p, cx, cy, ux, uy, s0, df, 1.5);
    }
    if (age < CLEAVE_RUN + 0.1) {
      const fa = 1 - k01((age - CLEAVE_RUN) / 0.1);
      for (const [d, c] of [
        [0, C.white],
        [-2, C.yellow],
        [-4, C.hot],
      ] as const) {
        const s = df + d;
        p.lineS(
          cx + ux * s + nx * (hw + 3),
          cy + uy * s + ny * (hw + 3),
          cx + ux * s - nx * (hw + 3),
          cy + uy * s - ny * (hw + 3),
          c,
          fa,
          d === 0 ? 0.6 : 0,
        );
      }
    }
    // Воронка там, где меч вошёл в плиты.
    const fade = 1 - k01((age - 1.1) / 0.4);
    p.col(C.lip, 0.8 * fade);
    lens(p, bx + 1, by + 1, ux, uy, 6.5, 3);
    p.col(C.groove, fade);
    lens(p, bx, by, ux, uy, 6, 2.3);
    // Кадр контакта: звезда удара, пока держит стоп-кадр.
    if (age < 0.13) {
      const k = age / 0.13;
      p.col(k < 0.4 ? '#ffffff' : C.yellow, 1);
      star(p, bx, by, 17 * (1 - 0.5 * k), 8, a + 0.2);
      if (k < 0.6) {
        p.col(C.fire[4], 1);
        star(p, bx, by, 8, 4, a + 0.6);
      }
    }
    if (age < 0.32)
      ring(
        p,
        bx,
        by,
        5 + 34 * eOut2(age / 0.32),
        C.white,
        0.9 * (1 - age / 0.32),
        (_ang, i) => hash(i >> 2, sd, 9) > 0.25,
        0.6,
      );
    // Плиты вскидывает по ходу волны: крошка в обе стороны.
    const nC = few ? 6 : 16;
    const sPos = (i: number) => s0 + (L - s0) * k01((i + 0.5) / nC + (hash(sd, i, 3) - 0.5) * 0.05);
    chunks(
      p,
      sd,
      age,
      cx,
      cy,
      nC,
      0,
      0.55,
      16,
      30,
      55,
      80,
      [1.0, 1.45],
      0.4,
      0,
      (i) => passT(sPos(i)),
      (i) => {
        const s = sPos(i);
        const side = i % 2 ? 1 : -1;
        return [
          cx + ux * s + nx * side * 2,
          cy + uy * s + ny * side * 2,
          Math.atan2(ny * side, nx * side) + side * 0.3,
        ];
      },
    );
    const nD = few ? 4 : 10;
    dust(
      p,
      sd + 3,
      age,
      cx,
      cy,
      nD,
      0,
      0.35,
      14,
      18,
      1.5,
      6,
      7,
      0.8,
      0,
      0.5,
      (i) => passT(s0 + (L - s0) * ((i + 0.5) / nD)),
      (i) => {
        const s = s0 + (L - s0) * ((i + 0.5) / nD);
        const side = i % 2 ? 1 : -1;
        return [
          cx + ux * s + nx * side * 4,
          cy + uy * s + ny * side * 4,
          Math.atan2(ny * side, nx * side),
        ];
      },
    );
    // Искры: у меча — фонтаном, на конце полосы — когда туда дошла волна.
    sparks(p, sd, age, bx, by - 2, few ? 4 : 11, a, Math.PI, 40, 60, 0.5, 75);
    sparks(
      p,
      sd + 7,
      age,
      cx + ux * L,
      cy + uy * L,
      few ? 3 : 7,
      a,
      0.9,
      40,
      50,
      0.4,
      50,
      sparkCol,
      () => CLEAVE_RUN,
    );
  }),
});

// Разлом после рубки: жёлоб с кромкой, в нём тлеет — импульсы жара бегут
// от меча к концу, остывает от белого к багровому, в конце гаснет; дым и
// угольки поднимаются из трещины.
registerZonePainter(
  'f10_rift',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number) => {
    const zz = z as FxZone;
    const t = zz.t;
    const a = zz.ang ?? 0;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const L = (zz.len ?? 4) * S;
    const s0 = RIFT_FROM * S;
    const cx = zz.x * S;
    const cy = zz.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const sd = riftSeed(zz.x, zz.y, a);
    const ck = riftCrack(sd, a, L - s0);
    const sx = cx + ux * s0;
    const sy = cy + uy * s0;
    // Трещина уже пробежала в метке — здесь она сразу во всю длину, а по ней
    // идёт волна удара (белый фронт) и дальше тлеет.
    const reach = ck.max;
    const wave = ck.max * eOut2(k01(t / CLEAVE_RUN));
    const fade = 1 - k01((t - (zz.life - 0.55)) / 0.55);
    drawCrack(p, ck, sx, sy, reach, C.groove, C.lip, fade);
    // Жар: импульсы бегут по жёлобу, дальний конец остывает раньше.
    const cool = k01((t - 0.05) / 1.75);
    const ox = Math.floor(sx);
    const oy = Math.floor(sy);
    if (cool < 1) {
      const cols = [C.white, C.fire[4], C.fire[3], C.fire[2], C.fire[1], C.fire[0]];
      for (let b = 0; b < cols.length; b++) {
        p.col(cols[b], fade);
        for (let i = 0; i < ck.x.length; i++) {
          const d = ck.d[i];
          const pulse = mod(d - t * 55, 30) < 5 ? -0.2 : 0;
          // До волны трещина горит, как в метке; волна проходит — белеет.
          const hit = d <= wave ? 0 : 0.35;
          const h = cool * 1.1 + (d / Math.max(1, ck.max)) * 0.25 + pulse + hit;
          if (h >= 1) continue;
          const bi = Math.max(0, Math.min(5, Math.floor(h * 6)));
          if (bi === b) p.dot(ox + ck.x[i], oy + ck.y[i]);
        }
      }
    }
    // Угольки и дым из трещины.
    const heat = 1 - cool;
    const n = ck.x.length;
    if (n) {
      const src = (i: number): [number, number] => {
        const j = Math.floor(hash(sd, i, 45) * n);
        return [ox + ck.x[j], oy + ck.y[j]];
      };
      embers(p, sd, t, 9, 0.9, 16, (i) => (i / 9) * 1.5 + hash(sd, i, 44) * 0.2, src, heat * fade);
      dust(
        p,
        sd + 1,
        t,
        0,
        0,
        5,
        -Math.PI / 2,
        0.5,
        3,
        4,
        2,
        6,
        12,
        1.3,
        1,
        0.5 * fade,
        (i) => 0.1 + i * 0.28,
        (i) => src(i + 30),
      );
    }
  }),
);

// =============================================================================
// ВОЛНА ПОДЪЁМА — круг r 3,2: король встаёт с трона, урон через 1 с после
// метки. Метка: кромка круга с первого кадра (штрихи обегают её); от
// короля растекается его тьма — лужа с рваным краем-щупальцами, доходит до
// кромки ровно в миг удара, край лужи раскаляется; крошка на полу дрожит
// всё сильнее. Контакт: ударная волна кольцом (белый фронт, багровый
// след), трещины звездой, тьму рвёт клочьями наружу, пыль и крошка.
// =============================================================================

registerZonePainter(
  'f10_shock',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const st = z as Strike;
    const { k, left } = warnOf(st);
    const sig = left < SIG;
    const tk = !reduced() && tick(left);
    const cx = st.x * S;
    const cy = st.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = st.r * S;
    const sd = st.id >>> 0;
    // «Куда»: кромка круга, штрихи обегают её.
    const run = time * (14 + 30 * k);
    ring(p, cx, cy, R + 1, C.ink, 0.6);
    ring(
      p,
      cx,
      cy,
      R,
      sig ? (tk ? C.white : C.yellow) : k > 0.5 ? C.hot : C.crimson,
      0.65 + 0.35 * k,
      sig ? undefined : (ang) => mod(ang * R - run, 9) < 6,
    );
    // «Когда»: тьма растекается от короля и доходит до кромки к удару.
    const rp = R * (0.14 + 0.86 * Math.pow(k, 1.3));
    p.col(C.pool, 0.42 + 0.25 * k);
    fillSector(p, cx, cy, 0, rp, 0, TAU);
    // Рваный край: щупальца тянутся и втягиваются.
    const N = 30;
    for (let i = 0; i < N; i++) {
      const aa = (i / N) * TAU + (hash(sd, i, 3) - 0.5) * 0.15;
      const wob = 0.5 + 0.5 * Math.sin(time * (3 + 2 * hash(sd, i, 4)) + i * 1.7);
      const Lt = 2 + 6 * wob * (0.4 + 0.6 * k);
      const ex = Math.cos(aa);
      const ey = Math.sin(aa);
      p.col(C.pool, 0.6);
      p.line(cx + ex * (rp - 1), cy + ey * (rp - 1), cx + ex * (rp + Lt), cy + ey * (rp + Lt));
      p.col(sig ? C.hot : C.redMid, 0.5 + 0.4 * k);
      p.dot(cx + ex * (rp + Lt), cy + ey * (rp + Lt));
    }
    ring(p, cx, cy, rp, sig ? C.hot : C.red, 0.35 + 0.6 * k * k);
    // «Тик»: вспыхивает пояс у кромки, а не весь круг.
    if (tk) {
      p.col(C.hot, 0.4);
      fillSector(p, cx, cy, R - 4, R, 0, TAU);
    }
    // Крошка на полу дрожит — всё сильнее.
    for (let i = 0; i < 22; i++) {
      const rr = R * (0.2 + 0.78 * hash(sd, i, 5));
      const aa = hash(sd, i, 6) * TAU;
      const hop = k > 0.2 ? Math.floor(hash(i, Math.floor(time * 18), sd) * (1 + 3 * k)) : 0;
      const gx = cx + Math.cos(aa) * rr;
      const gy = cy + Math.sin(aa) * rr;
      if (hop) {
        p.col(C.ink, 0.45);
        p.dot(gx, gy + 1);
      }
      p.col(C.lipHi, 0.85);
      p.dot(gx, gy - hop);
    }
  }),
);

registerImpactPainter('f10_shock', {
  life: 1.5,
  shake: 0.35,
  flash: 0.25,
  flashRgb: '255,60,40',
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const cx = rec.x * S;
    const cy = rec.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = (rec.r ?? 3.2) * S;
    const sd = rec.seed >>> 0;
    const few = reduced();
    const fade = 1 - k01((age - 1.1) / 0.4);
    // Тьма лужи ещё лежит за фронтом волны — волна сметает её наружу.
    if (age < 0.36) {
      const rw = R * (0.3 + 0.88 * eOut2(age / 0.36));
      if (rw < R) {
        p.col(C.pool, 0.6 * (1 - age / 0.36));
        fillSector(p, cx, cy, rw, R, 0, TAU);
      }
    }
    // Трещины звездой: бегут от короля, раскалённые — остывают.
    const ck = crackOf(
      `shock|${sd % 997}`,
      sd,
      starBranches(sd, 7, hash(sd, 0, 1) * TAU, R * 0.42, R * 0.78, 3),
      0.55,
      0.12,
    );
    const reach = ck.max * eOut3(k01(age / 0.16));
    drawCrack(p, ck, cx, cy, reach, C.groove, C.lip, fade);
    const hot = 1 - k01((age - 0.05) / 0.75);
    if (hot > 0) drawCrack(p, ck, cx, cy, reach, heatCol(0.5 * (1 - hot)), null, hot ** 1.5);
    // Вспышка в центре.
    if (age < 0.1) {
      p.col(age < 0.04 ? '#ffffff' : C.yellow, 1);
      star(p, cx, cy - 2, 20 * (1 - 0.4 * (age / 0.1)), 10, 0.1);
    }
    // Ударная волна: белый фронт, за ним розовый, багровый, тёмный.
    if (age < 0.36) {
      const k = age / 0.36;
      const rw = R * (0.3 + 0.88 * eOut2(k));
      p.col(C.crimson, 0.45 * (1 - k));
      fillSector(p, cx, cy, Math.max(0, rw - 6), rw, 0, TAU);
      const band = [C.white, C.rose, C.crimson];
      band.forEach((c, d) =>
        ring(
          p,
          cx,
          cy,
          rw - d,
          c,
          (1 - k) * (d ? 0.85 : 1),
          (_a, i) => hash(i >> 2, sd, 9 + (d >> 1)) > 0.18,
          d === 0 ? 0.5 : 0,
        ),
      );
    }
    // Тьму рвёт клочьями наружу.
    const nT = few ? 6 : 12;
    dust(p, sd + 5, age, cx, cy, nT, 0, 0.25, 60, 45, 2, 6, 4, 0.5, 4, 0.85, undefined, (i) => {
      const th = (i / nT) * TAU + hash(sd, i, 7);
      return [cx + Math.cos(th) * R * 0.25, cy + Math.sin(th) * R * 0.25, th];
    });
    // Мраморная пыль по кругу и крошка.
    const nD = few ? 5 : 10;
    dust(
      p,
      sd,
      age,
      cx,
      cy,
      nD,
      0,
      0.2,
      26,
      16,
      1.5,
      6,
      6,
      0.9,
      0,
      0.55,
      (i) => 0.05 + 0.1 * hash(sd, i, 8),
      (i) => {
        const th = (i / nD) * TAU + 0.2;
        return [cx + Math.cos(th) * R * 0.62, cy + Math.sin(th) * R * 0.62, th];
      },
    );
    const nC = few ? 5 : 14;
    chunks(
      p,
      sd + 9,
      age,
      cx,
      cy,
      nC,
      0,
      0.3,
      28,
      40,
      45,
      70,
      [1.0, 1.5],
      0.4,
      0,
      undefined,
      (i) => {
        const th = (i / nC) * TAU + hash(sd, i, 10);
        return [cx + Math.cos(th) * R * 0.3, cy + Math.sin(th) * R * 0.3, th];
      },
    );
  }),
});

// =============================================================================
// ЗОВ ТРОНА — круг r 2,2 у подножия трона, 2,8 с (король открыт). Круг сам
// себя чертит: золотая голова обегает кольцо от верха, внутреннее багровое
// кольцо идёт навстречу, руны вспыхивают, когда голова проходит мимо. В
// 0,8 с — зов: волна от круга к дверям, руны белеют; дальше круг бьётся,
// как сердце, золотые искры поднимаются от рун; в конце стирается с хвоста.
// =============================================================================

/** Руна 3×5 по зерну: стержень посередине и засечки — «футарк» без шрифта. */
function rune(p: Pen, x: number, y: number, v: number): void {
  const X = Math.floor(x) - 1;
  const Y = Math.floor(y) - 2;
  p.rect(X + 1, Y, 1, 5);
  for (let r = 0; r < 5; r++) {
    if (hash(v, r, 17) < 0.45) p.rect(X, Y + r, 1, 1);
    if (hash(v, r, 18) < 0.45) p.rect(X + 2, Y + r, 1, 1);
  }
}

registerZonePainter(
  'f10_command',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const zz = z as Zone;
    const t = zz.t;
    const life = zz.life;
    const cx = zz.x * S;
    const cy = zz.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = zz.r * S;
    const DRAW = 0.55;
    const draw = eOut2(k01(t / DRAW));
    const draw2 = eOut2(k01((t - 0.12) / 0.5));
    const erase = k01((t - (life - 0.4)) / 0.4);
    const top = -Math.PI / 2;
    const beat = t > 0.8 ? Math.pow(Math.max(0, Math.sin((t - 0.8) * Math.PI * 3.2)), 8) : 0;
    const call = t >= 0.8 && t < 1.45 ? (t - 0.8) / 0.65 : -1;
    // Внешнее кольцо: чертится по часовой от верха, стирается с хвоста.
    const span1 = TAU * draw - TAU * erase;
    const from1 = top + TAU * erase;
    if (span1 > 0.01) {
      ring(p, cx, cy, R + 1, C.ink, 0.6, (ang) => inArc(ang, from1, span1));
      ring(p, cx, cy, R, beat > 0.3 ? C.gold[3] : C.gold[2], 0.7 + 0.3 * beat, (ang) =>
        inArc(ang, from1, span1),
      );
      ring(p, cx, cy, R - 3, C.gold[1], 0.5, (ang, i) => inArc(ang, from1, span1) && i % 3 === 0);
    }
    // Голова кольца — искра, пока чертит.
    if (draw < 1) {
      const ha = top + TAU * draw;
      p.col(C.white, 1);
      p.dot(cx + Math.cos(ha) * R - 1, cy + Math.sin(ha) * R - 1, 2, 2);
      for (let j = 1; j < 5; j++) {
        const hb = ha - j * 0.09;
        p.col(C.gold[3], 1 - j * 0.2);
        p.dot(cx + Math.cos(hb) * R, cy + Math.sin(hb) * R - j * 0.6);
      }
    }
    // Внутреннее кольцо — навстречу, багровое, пунктиром вращается.
    const R2 = R * 0.62;
    const span2 = TAU * draw2 - TAU * erase;
    if (span2 > 0.01)
      ring(
        p,
        cx,
        cy,
        R2,
        C.crimson,
        0.75 + 0.25 * beat,
        (ang) => inArc(ang, top - TAU * draw2, span2) && mod(ang * R2 + t * 16, 7) < 5,
        0.5,
      );
    // Руны между кольцами: вспыхивают, когда голова проходит мимо.
    const rot = t * 0.35;
    const nR = 10;
    for (let i = 0; i < nR; i++) {
      const u = i / nR;
      if (u > draw || u < erase) continue;
      const tb = DRAW * (1 - Math.sqrt(1 - u));
      const fl = 1 - k01((t - tb) / 0.3);
      const aa = top + u * TAU + rot;
      const gx = cx + Math.cos(aa) * R * 0.81;
      const gy = cy + Math.sin(aa) * R * 0.81;
      const lit = call >= 0 && call < 0.5 ? 1 : fl;
      p.col(C.ink, 0.6);
      rune(p, gx + 1, gy + 1, i + 3);
      p.col(lit > 0.3 ? C.white : beat > 0.4 ? C.gold[3] : C.hot, 0.8 + 0.2 * lit);
      rune(p, gx, gy, i + 3);
    }
    // Зов: волна от круга к дверям.
    if (call >= 0) {
      const k = call;
      ring(
        p,
        cx,
        cy,
        R + 4 + 44 * eOut2(k),
        C.gold[3],
        0.85 * (1 - k),
        (_a, i) => hash(i >> 1, 77, 3) > 0.3,
        0.5,
      );
      ring(
        p,
        cx,
        cy,
        R + 2 + 30 * eOut2(k),
        C.crimson,
        0.6 * (1 - k),
        (_a, i) => hash(i >> 1, 78, 3) > 0.4,
      );
    }
    // Золотые искры поднимаются от рун, пока король открыт.
    if (t > 0.6 && erase < 1)
      for (let i = 0; i < 12; i++) {
        const per = 0.9 + 0.3 * hash(i, 5, 19);
        const ph = mod(t + hash(i, 6, 19) * per, per) / per;
        const aa = top + hash(i, 7, 19) * TAU + rot;
        const x = cx + Math.cos(aa) * R * (0.7 + 0.2 * hash(i, 8, 19));
        const y = cy + Math.sin(aa) * R * (0.7 + 0.2 * hash(i, 8, 19)) - ph * 18;
        p.col(ph < 0.3 ? C.gold[3] : C.gold[2], (1 - ph) * (1 - erase));
        p.dot(x + Math.sin(ph * 6 + i) * 1.5, y);
      }
  }),
);

// Дверь стражи распахивается (зов трона): клин багрового света по полу,
// пыль клубами из проёма, искры. `vd` — задержка: стража выходит по одному.
registerZonePainter(
  'f10_fxgate',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number) => {
    const zz = z as FxZone;
    const t = zz.t - (zz.vd ?? 0);
    if (t < 0) return;
    const a = zz.ang ?? Math.PI / 2;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const nx = -uy;
    const ny = ux;
    const cx = zz.x * S;
    const cy = zz.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const sd = zz.id >>> 0;
    // Дверь распахивается: клин света растёт из проёма, дрожит, как огонь
    // за дверью, и гаснет; три клина разной длины — свет ярче у порога.
    const fl =
      (t < 0.08 ? t / 0.08 : 1 - k01((t - 0.2) / 1.0)) *
      (0.85 + 0.15 * Math.sin(t * 31 + sd) * Math.sin(t * 13));
    if (fl > 0) {
      const open = eOut2(k01(t / 0.18));
      // Клин: у порога сплошной, дальняя треть — через пиксель (свет тает).
      const wedge = (l: number, w0: number, w1: number, c: string, al: number) => {
        const L = S * l * open;
        const m = 0.62;
        const wm = w0 + (w1 - w0) * m;
        p.col(c, al * fl);
        fillPoly(p, [
          cx + nx * w0,
          cy + ny * w0,
          cx + ux * L * m + nx * wm,
          cy + uy * L * m + ny * wm,
          cx + ux * L * m - nx * wm,
          cy + uy * L * m - ny * wm,
          cx - nx * w0,
          cy - ny * w0,
        ]);
        fillPoly(
          p,
          [
            cx + ux * L * m + nx * wm,
            cy + uy * L * m + ny * wm,
            cx + ux * L + nx * w1,
            cy + uy * L + ny * w1,
            cx + ux * L - nx * w1,
            cy + uy * L - ny * w1,
            cx + ux * L * m - nx * wm,
            cy + uy * L * m - ny * wm,
          ],
          true,
        );
      };
      wedge(3, 6, 22, C.redMid, 0.22);
      wedge(2.1, 5, 15, C.crimson, 0.2);
      wedge(1.2, 4, 9, C.fire[3], 0.26);
    }
    // Пыль из проёма — в багровом свете двери.
    dust(p, sd, t, cx + ux * 6, cy + uy * 6, 5, a, 0.75, 26, 18, 1.5, 4, 4, 0.9, 2, 0.55);
    sparks(p, sd, t, cx + ux * 4, cy + uy * 4, 7, a, 0.8, 30, 40, 0.55, 40);
  }),
);

// =============================================================================
// ПИКЕ С НЕБА. Метка пике (`f10_divemark`, ходит за героем 2,4 с): на полу
// тень крыльев короля — большая и мягкая, пока он высоко, взмахи видны по
// тени; вокруг — оранжевый прицел пунктиром, уголки кружат. Замерла —
// прицел краснеет, тень сжимается и густеет: король идёт вниз. Круг посадки
// (`f10_diveland`, 0,75 с): тёмный багрец, к нему сходится кольцо и уголки,
// лучи пике бегут к центру. Урон бьёт, пока король ещё в воздухе: контакт —
// воздух под крыльями бьёт в пол, пыль разлетается. Сама посадка через
// 0,18 с — зона `f10_fxtouch` (воронка, трещины, обломки).
// =============================================================================

registerZonePainter(
  'f10_divemark',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const zz = z as FxZone;
    const t = zz.t;
    const cx = zz.x * S;
    const cy = zz.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = zz.r * S;
    const locked = !zz.follow;
    const kl = locked ? k01((t - (zz.life - 0.75)) / 0.75) : 0;
    // Тень крыльев: высоко — большая и мягкая, вниз — меньше и гуще.
    const f = Math.floor(time * 5) & 3;
    const span = 30 - 13 * eIn2(kl);
    // Высоко — тень бледная, опускается — густеет (сплошная: шахматка на
    // телефоне читалась сеткой).
    const im = wingShadow(span, kl > 0.6 ? 0 : f, false);
    const ox = locked ? 0 : Math.sin(time * 1.7) * 3;
    const oy = locked ? 0 : Math.cos(time * 1.3) * 2;
    p.alpha(0.2 + 0.1 * k01(t / 1.5) + 0.4 * kl);
    p.img(im, cx - im.width / 2 + ox, cy - im.height / 2 + oy);
    if (!locked) {
      ring(p, cx, cy, R, C.fire[3], 0.8, (ang) => mod(ang * R + time * 20, 9) < 5, 0.5);
      corners(p, cx, cy, R + 4, time * 1.2 + Math.PI / 4, C.fire[3], 0.9);
    } else ring(p, cx, cy, R, C.crimson, 0.9, undefined, 0.5);
  }),
);

registerZonePainter(
  'f10_diveland',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const st = z as Strike;
    const { k, left } = warnOf(st);
    const sig = left < SIG;
    const tk = !reduced() && tick(left);
    const cx = st.x * S;
    const cy = st.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = st.r * S;
    p.col(C.redDk, 0.32 + 0.25 * k);
    fillSector(p, cx, cy, 0, R, 0, TAU);
    // Лучи пике бегут к центру — чем ближе удар, тем быстрее.
    for (let i = 0; i < 12; i++) {
      const aa = (i / 12) * TAU + 0.13;
      const u = mod(time * (1.5 + 3 * k) + hash(i, 5, 23), 1);
      const r1 = R * (1.15 - u);
      if (r1 < 3) continue;
      const ex = Math.cos(aa);
      const ey = Math.sin(aa);
      p.col(sig ? C.white : C.rose, 0.35 + 0.5 * k);
      p.line(
        cx + ex * r1,
        cy + ey * r1,
        cx + ex * Math.max(2, r1 - 4),
        cy + ey * Math.max(2, r1 - 4),
      );
    }
    // Сходящееся кольцо и уголки: встречаются с кромкой ровно к удару.
    const rc = R * (1 + 1.2 * (1 - Math.pow(k, 1.4)));
    ring(p, cx, cy, rc, sig ? C.white : C.hot, 0.55 + 0.45 * k, undefined, 0.5);
    ring(p, cx, cy, R, sig ? (tk ? C.white : C.yellow) : C.crimson, 0.8 + 0.2 * k, undefined, 0.6);
    corners(p, cx, cy, rc + 3, Math.PI / 4, sig ? C.white : C.yellow, 1, 5);
    if (tk) {
      p.col(C.hot, 0.18);
      fillSector(p, cx, cy, 0, R, 0, TAU);
    }
  }),
);

registerImpactPainter('f10_diveland', {
  life: 0.8,
  shake: 0.12,
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const cx = rec.x * S;
    const cy = rec.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = (rec.r ?? 1.8) * S;
    const sd = rec.seed >>> 0;
    const few = reduced();
    // Тень короля падает на круг и сжимается — он над самой землёй.
    if (age < 0.24) {
      const k = age / 0.24;
      p.col(C.shadow, 0.55 * (1 - k * 0.5));
      fillSector(p, cx, cy, 0, R * (0.8 - 0.45 * k), 0, TAU);
    }
    // Воздух под крыльями бьёт в пол: кольцо ветра и пыль наружу.
    if (age < 0.35)
      ring(
        p,
        cx,
        cy,
        R * (0.6 + 1.2 * eOut2(age / 0.35)),
        C.wind,
        0.8 * (1 - age / 0.35),
        (_a, i) => hash(i >> 1, sd, 4) > 0.3,
        0.5,
      );
    const nD = few ? 5 : 12;
    dust(p, sd, age, cx, cy, nD, 0, 0.2, 55, 25, 1.5, 5, 2, 0.6, 0, 0.6, undefined, (i) => {
      const th = (i / nD) * TAU + hash(sd, i, 5) * 0.4;
      return [cx + Math.cos(th) * R * 0.5, cy + Math.sin(th) * R * 0.5, th];
    });
  }),
});

// Посадка короля (`f10_fxtouch`, ставит мозг в миг касания): воронка,
// трещины звездой раскалены и остывают, звезда удара, кольцо пыли, тяжёлые
// обломки с отскоком, искры. Самый тяжёлый удар боя.
registerZonePainter(
  'f10_fxtouch',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number) => {
    const zz = z as FxZone;
    const t = zz.t;
    const cx = zz.x * S;
    const cy = zz.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const sd = zz.id >>> 0;
    const few = reduced();
    const fade = 1 - k01((t - 1.3) / 0.5);
    p.col(C.lip, 0.8 * fade);
    lens(p, cx + 1, cy + 1, 1, 0, 12, 7);
    p.col(C.groove, 0.95 * fade);
    lens(p, cx, cy, 1, 0, 11, 6);
    const ck = crackOf(
      `touch|${sd % 997}`,
      sd,
      starBranches(sd, 9, 0.3, S * 0.95, S * 1.85, 3),
      0.55,
      0.12,
    );
    const reach = ck.max * eOut3(k01(t / 0.14));
    drawCrack(p, ck, cx, cy, reach, C.groove, C.lip, fade);
    const hot = 1 - k01((t - 0.1) / 0.7);
    if (hot > 0) drawCrack(p, ck, cx, cy, reach, heatCol(0.5 * (1 - hot)), null, hot ** 1.5);
    if (t < 0.1) {
      p.col(t < 0.04 ? '#ffffff' : C.yellow, 1);
      star(p, cx, cy, 21 * (1 - 0.5 * (t / 0.1)), 8, 0.3);
    }
    if (t < 0.42) {
      const k = t / 0.42;
      ring(
        p,
        cx,
        cy,
        8 + 52 * eOut2(k),
        C.wind,
        0.9 * (1 - k),
        (_a, i) => hash(i >> 2, sd, 9) > 0.2,
        0.6,
      );
      ring(
        p,
        cx,
        cy,
        6 + 44 * eOut2(k),
        C.lipHi,
        0.7 * (1 - k),
        (_a, i) => hash(i >> 2, sd, 10) > 0.4,
      );
    }
    const nD = few ? 5 : 10;
    dust(p, sd, t, cx, cy, nD, 0, 0.2, 55, 30, 2, 8, 6, 0.8, 0, 0.52, undefined, (i) => {
      const th = (i / nD) * TAU + 0.1;
      return [cx + Math.cos(th) * 9, cy + Math.sin(th) * 6, th];
    });
    chunks(p, sd + 2, t, cx, cy, few ? 5 : 11, 0, Math.PI, 30, 40, 60, 90, [0.9, 1.35], 0.5);
    sparks(p, sd + 4, t, cx, cy - 2, few ? 4 : 10, 0, Math.PI, 50, 60, 0.45, 75);
  }),
);

// Кольцо посадки (`f10_shockring`, r 3,1, пояс 0,55, 0,35 с): пояс кольца
// тёмным багрецом с пунктирными краями, от места посадки к нему бежит
// рваная волна пыли и доходит в миг удара. Контакт — кольцо рвётся наружу
// пылью и крошкой.
registerZonePainter(
  'f10_shockring',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const st = z as Strike;
    const { k, left } = warnOf(st);
    const sig = left < SIG;
    const tk = !reduced() && tick(left);
    const cx = st.x * S;
    const cy = st.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = st.r * S;
    const w = (st.w ?? 0.55) * S;
    const sd = st.id >>> 0;
    p.col(tk ? C.red : C.redDk, 0.38 + 0.18 * k);
    fillSector(p, cx, cy, R - w, R + w, 0, TAU);
    const run = time * 30;
    const edge = sig ? C.yellow : C.crimson;
    ring(
      p,
      cx,
      cy,
      R + w,
      edge,
      0.65 + 0.35 * k,
      sig ? undefined : (ang) => mod(ang * R - run, 8) < 5,
      0.5,
    );
    ring(
      p,
      cx,
      cy,
      R - w,
      edge,
      0.65 + 0.35 * k,
      sig ? undefined : (ang) => mod(ang * R + run, 8) < 5,
      0.5,
    );
    const rf = R * (0.15 + 0.85 * k);
    ring(p, cx, cy, rf, sig ? C.white : C.wind, 0.85, (_a, i) => hash(i >> 1, sd, 7) > 0.2, 0.5);
    ring(p, cx, cy, rf - 2, C.lipHi, 0.5, (_a, i) => hash(i >> 1, sd, 8) > 0.35);
  }),
);

registerImpactPainter('f10_shockring', {
  life: 1.1,
  shake: 0.2,
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const cx = rec.x * S;
    const cy = rec.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = (rec.r ?? 3.1) * S;
    const w = (rec.w ?? 0.55) * S;
    const sd = rec.seed >>> 0;
    const few = reduced();
    if (age < 0.26) {
      const k = age / 0.26;
      const rw = R + w * 1.3 * eOut2(k);
      [C.white, C.rose, C.crimson, C.red].forEach((c, d) =>
        ring(
          p,
          cx,
          cy,
          rw - d,
          c,
          (1 - k) * (d ? 0.8 : 1),
          (_a, i) => hash(i >> 2, sd, 3 + d) > 0.2,
          d ? 0 : 0.5,
        ),
      );
    }
    const nD = few ? 6 : 12;
    dust(p, sd, age, cx, cy, nD, 0, 0.25, 26, 16, 1.5, 6, 4, 0.7, 0, 0.45, undefined, (i) => {
      const th = (i / nD) * TAU + hash(sd, i, 5) * 0.3;
      return [cx + Math.cos(th) * R, cy + Math.sin(th) * R, th];
    });
    const nC = few ? 4 : 10;
    chunks(
      p,
      sd + 1,
      age,
      cx,
      cy,
      nC,
      0,
      0.3,
      20,
      30,
      40,
      50,
      [0.8, 1.1],
      0.2,
      0,
      undefined,
      (i) => {
        const th = (i / nC) * TAU + hash(sd, i, 6);
        return [cx + Math.cos(th) * R, cy + Math.sin(th) * R, th];
      },
    );
  }),
});

// =============================================================================
// ПЕРО ПЛАМЕНИ (`f10_feather`, r 0,6, 0,9 с; слой поверх темноты). Перо
// падает с высоты, качаясь маятником и поворачиваясь по ходу качания, за
// ним тлеет след; на полу растёт и густеет его тень, круг метки пунктиром
// вращается, к удару — сплошной и белый. Контакт: перо вспыхивает — языки
// огня, угольки, выжженное пятно. Всё на полу прячется за телами ближе к
// камере.
// =============================================================================

registerZonePainter(
  'f10_feather',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const st = z as Strike;
    const { k, left } = warnOf(st);
    const sig = left < SIG;
    const tk = !reduced() && tick(left);
    const cx = st.x * S;
    const cy = st.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = st.r * S;
    const sd = st.id >>> 0;
    const occ = occOf(S);
    const ox = Math.floor(cx);
    const oy = Math.floor(cy);
    // Тень пера растёт и густеет.
    const sr = 1.5 + 3.5 * k;
    p.col(C.shadow, 0.2 + 0.4 * k);
    for (let y = -3; y <= 3; y++)
      for (let x = -6; x <= 6; x++) {
        if ((x / sr) ** 2 + (y / (sr * 0.45)) ** 2 > 1) continue;
        if (!occ(ox + x, oy + y, cy)) p.dot(ox + x, oy + y);
      }
    // Круг метки: пунктир вращается, к удару — сплошной.
    const pts = circle(R);
    const vis = (i: number) => !occ(ox + pts.x[i], oy + pts.y[i], cy);
    ring(
      p,
      cx,
      cy,
      R,
      sig ? (tk ? C.white : C.yellow) : C.fire[3],
      0.6 + 0.4 * k,
      (ang, i) => vis(i) && (sig || mod(ang * R + time * 18, 7) < 4),
    );
    // Перо: падает, качаясь; след тлеет позади.
    const H = 64;
    const posAt = (tt: number): [number, number] => {
      const kk = k01(tt / Math.max(0.01, st.warn));
      const zf = H * Math.pow(1 - kk, 1.15);
      const sw = Math.sin(tt * 5.5 + (sd % 7)) * 6 * (1 - kk);
      return [cx + sw, cy - zf];
    };
    for (let j = 1; j <= 5; j++) {
      const tj = st.t - j * 0.045;
      if (tj < 0) break;
      const [x, y] = posAt(tj);
      p.col(sparkCol(0.3 + j * 0.13), 0.9 - j * 0.15);
      p.dot(x + (hash(sd, j, Math.floor(time * 20)) - 0.5) * 2, y);
    }
    const [fx, fy] = posAt(st.t);
    const fr = Math.floor(mod(Math.sin(st.t * 5.5 + (sd % 7)) * 2.5 + 4, 8));
    const im = featherImg(fr);
    p.alpha(1);
    p.img(im, fx - 7, fy - 7);
  }),
);

registerImpactPainter('f10_feather', {
  life: 1.0,
  shake: 0.08,
  above: true,
  paint: guarded(
    (g, rec: ImpactRec, px: number, py: number, S: number, age: number, time: number) => {
      const cx = rec.x * S;
      const cy = rec.y * S;
      const p = new Pen(g, px, py, cx, cy);
      const sd = rec.seed >>> 0;
      const few = reduced();
      const occ = occOf(S);
      const sc = scorchImg(6, 2);
      imgO(
        p,
        occ,
        sc,
        cx - sc.width / 2,
        cy - sc.height / 2,
        cy,
        0.8 * (1 - k01((age - 0.5) / 0.5)),
      );
      if (age < 0.07) {
        p.col(age < 0.035 ? '#ffffff' : C.fire[4], 1);
        star(p, cx, cy - 2, 9, 6, 0.4);
      }
      // Языки огня расходятся и опадают.
      for (let j = 0; j < 4; j++) {
        const th = (j / 4) * TAU + hash(sd, j, 3);
        const d = 1 + 5 * eOut2(k01(age / 0.2));
        const x = cx + Math.cos(th) * d;
        const y = cy + Math.sin(th) * d * 0.6;
        const h = 10 * (1 - k01(age / 0.7)) * (0.6 + 0.4 * hash(sd, j, 4));
        if (h < 3 || occ(Math.floor(x), Math.floor(y) - 2, y)) continue;
        const im = flameImg(h, Math.floor(time * 12) + j);
        p.alpha(1);
        p.img(im, x - im.width / 2, y - im.height + 1);
      }
      sparks(p, sd, age, cx, cy - 2, few ? 3 : 8, 0, Math.PI, 20, 30, 0.55, 90);
      embers(
        p,
        sd,
        age,
        few ? 3 : 6,
        0.8,
        20,
        (i) => 0.05 + i * 0.07,
        (i) => [cx + (hash(sd, i, 9) - 0.5) * 8, cy + (hash(sd, i, 10) - 0.5) * 4],
      );
    },
  ),
});

// =============================================================================
// МОЛНИИ (общие `f10_bolt`, `f10_bolt_line`: гроза трона, шторм короля, маги,
// Витражный зал). Метку рисует `f10-art.ts`, здесь — только контакт, слоем
// поверх темноты: столб молнии бьёт три раза подряд и гаснет, у земли —
// вспышка и кольцо разряда, по полу разбегается «корень» разряда и гаснет,
// остаётся выжженное пятно; искры. Пятно и корень прячутся за телами.
// Контактов в шторме — десятки разом: столбы и корни — готовые холсты.
// =============================================================================

function boltAt(p: Pen, occ: Occ, v: number, x: number, y: number, a: number): void {
  const b = boltCol(v, 112);
  const X = Math.floor(x) - 11;
  const Y = Math.floor(y) - 112;
  p.alpha(a);
  if (occ.clear(X, Y, X + b.w, Y + b.h, y)) {
    p.img(b.img, X, Y);
    return;
  }
  for (const core of [1, 2]) {
    p.col(core === 2 ? '#ffffff' : C.vio[2], a);
    for (let i = 0; i < b.x.length; i++) {
      if (b.core[i] !== core) continue;
      const qx = Math.floor(x) + b.x[i];
      const qy = Math.floor(y) + b.y[i];
      if (!occ(qx, qy, y)) p.dot(qx, qy);
    }
  }
}

function zapGround(
  p: Pen,
  occ: Occ,
  v: number,
  x: number,
  y: number,
  R: number,
  age: number,
  sd: number,
  few: boolean,
): void {
  const Rq = Math.max(6, Math.round(R / 4) * 4);
  const sc = scorchImg(Rq * 0.55, 0);
  imgO(p, occ, sc, x - sc.width / 2, y - sc.height / 2, y, 0.75 * (1 - k01((age - 0.35) / 0.6)));
  // Корень разряда: пять ветвей с редкими отростками (шанс развилки — на
  // шаг в 2 пикселя, поэтому маленький: иначе вместо корня паутина).
  const ck = crackOf(
    `zap|${v}|${Rq}`,
    900 + v,
    starBranches(900 + v, 5, v * 0.9, Rq * 0.4, Rq * 0.9, 1),
    0.8,
    0.07,
    0.35,
  );
  const za = 1 - k01((age - 0.08) / 0.4);
  if (za > 0) {
    const col = age < 0.06 ? '#ffffff' : age < 0.2 ? C.vio[3] : C.vio[2];
    // Разряд по полу — мгновенно, весь сразу: молния не «растёт».
    drawCrack(p, ck, x, y, ck.max, col, null, za, occ, y);
  }
  if (age < 0.08) {
    p.col(age < 0.04 ? '#ffffff' : C.vio[3], 1);
    star(p, x, y, Rq * 0.55 * (1 - 0.4 * (age / 0.08)), 8, v);
  }
  if (age < 0.3)
    ring(
      p,
      x,
      y,
      Rq * (0.3 + 0.85 * eOut2(age / 0.3)),
      C.vio[3],
      0.9 * (1 - age / 0.3),
      (_a, i) => hash(i >> 1, sd, 5) > 0.3,
    );
  sparks(p, sd, age, x, y - 2, few ? 3 : 7, 0, Math.PI, 30, 55, 0.4, 60, zapCol);
}

registerImpactPainter('f10_bolt', {
  life: 0.95,
  shake: 0.1,
  flash: 0.28,
  flashRgb: '190,160,255',
  above: true,
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const cx = rec.x * S;
    const cy = rec.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = (rec.r ?? 1.05) * S;
    const sd = rec.seed >>> 0;
    const occ = occOf(S);
    const v = sd & 7;
    zapGround(p, occ, v, cx, cy, R, age, sd, reduced());
    // Столб: три удара подряд (разные зигзаги), потом след гаснет.
    if (age < 0.22) {
      const vv = (v + Math.floor(age / 0.05)) & 7;
      const a =
        age < 0.15 ? (Math.floor(age / 0.025) % 3 === 2 ? 0.55 : 1) : 1 - (age - 0.15) / 0.07;
      boltAt(p, occ, vv, cx, cy, a);
    }
  }),
});

registerImpactPainter('f10_bolt_line', {
  life: 0.95,
  shake: 0.12,
  flash: 0.3,
  flashRgb: '190,160,255',
  above: true,
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const cx = rec.x * S;
    const cy = rec.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const a = rec.ang ?? 0;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const L = (rec.r ?? 4) * S;
    const sd = rec.seed >>> 0;
    const occ = occOf(S);
    const few = reduced();
    // Разряд бежит по оси полосы от начала к концу.
    const n = Math.max(1, Math.round(L / (S * 3.2)));
    const run = 0.1;
    const reach = L * eOut2(k01(age / run));
    const za = 0.85 * (1 - k01((age - 0.1) / 0.3));
    if (za > 0) {
      const ck = crackOf(
        `zapline|${Math.round(L)}|${Math.round(a * 100)}|${sd & 3}`,
        700 + (sd & 3),
        [[a, L, 1]],
        0.6,
        0.03,
        0.2,
      );
      const col = age < 0.08 ? '#ffffff' : C.vio[3];
      const ox = Math.floor(cx);
      const oy = Math.floor(cy);
      const b = ck.box;
      const axis = Math.abs(Math.cos(a)) > 0.99 || Math.abs(Math.sin(a)) > 0.99;
      if (axis && occ.clear(ox + b[0], oy + b[1], ox + b[2], oy + b[3], cy)) {
        // Полоса вдоль оси: бегущий разряд — готовый холст, обрезанный по фронту.
        const im = crackImg(ck, col, null);
        const w = im.img.width;
        const h = im.img.height;
        p.alpha(za);
        if (Math.abs(Math.cos(a)) > 0.99) {
          const cut = Math.max(
            0,
            Math.min(w, Math.cos(a) > 0 ? reach - im.x : w - (-reach - im.x)),
          );
          const sx = Math.cos(a) > 0 ? 0 : w - cut;
          if (cut > 0)
            p.g.drawImage(im.img, sx, 0, cut, h, ox + im.x + sx + p.qx, oy + im.y + p.qy, cut, h);
        } else {
          const cut = Math.max(
            0,
            Math.min(h, Math.sin(a) > 0 ? reach - im.y : h - (-reach - im.y)),
          );
          const sy = Math.sin(a) > 0 ? 0 : h - cut;
          if (cut > 0)
            p.g.drawImage(im.img, 0, sy, w, cut, ox + im.x + p.qx, oy + im.y + sy + p.qy, w, cut);
        }
      } else drawCrack(p, ck, cx, cy, reach, col, null, za, occ, cy);
    }
    // Столбы вдоль полосы — по очереди, как пробегает разряд.
    for (let j = 0; j < n; j++) {
      const s = ((j + 0.5) / n) * L;
      const x = cx + ux * s;
      const y = cy + uy * s;
      const t = age - (s / L) * run;
      if (t < 0) continue;
      zapGround(p, occ, (sd + j) & 7, x, y, S * 1.1, t, sd + j * 13, few || j % 2 === 1);
      if (t < 0.2) {
        const vv = (sd + j + Math.floor(t / 0.05)) & 7;
        const al = t < 0.14 ? (Math.floor(t / 0.025) % 3 === 2 ? 0.55 : 1) : 1 - (t - 0.14) / 0.06;
        boltAt(p, occ, vv, x, y, al);
      }
    }
  }),
});

// Стекло витража (общий `f10_glass`: окна тронного зала и Витражного зала):
// осколки четырёх цветов разлетаются, звенят отскоками, ложатся и
// поблёскивают, потом гаснут.
registerImpactPainter('f10_glass', {
  life: 1.4,
  shake: 0.05,
  paint: guarded(
    (g, rec: ImpactRec, px: number, py: number, S: number, age: number, time: number) => {
      const cx = rec.x * S;
      const cy = rec.y * S;
      const p = new Pen(g, px, py, cx, cy);
      const sd = rec.seed >>> 0;
      const cols = ['#c8323a', '#7a4ac8', '#e8b040', '#3a6aa8'];
      const a = 1 - k01((age - 1.0) / 0.4);
      if (age < 0.06) {
        p.col('#ffffff', 1);
        star(p, cx, cy, 7, 4, sd);
      }
      const n = reduced() ? 5 : 11;
      for (let i = 0; i < n; i++) {
        const th = hash(sd, i, 1) * TAU;
        const v = 20 + 40 * hash(sd, i, 2);
        const f = fly(age, 30 + 50 * hash(sd, i, 3), 430, 0.4);
        const x = cx + Math.cos(th) * v * f.h;
        const y = cy + Math.sin(th) * v * f.h * 0.8;
        if (f.air) {
          p.col(C.ink, 0.35 * a);
          p.dot(x, y + 1, 2, 1);
        }
        const spin = f.air ? Math.floor(age * 18 + i) & 1 : i & 1;
        p.col(C.ink, 0.7 * a);
        p.dot(x - 1, y - f.z - 1, spin ? 4 : 3, spin ? 3 : 4);
        p.col(cols[(i + sd) & 3], a);
        p.dot(x, y - f.z, spin ? 2 : 1, spin ? 1 : 2);
        // Лёгший — поблёскивает.
        if (!f.air && hash(i, Math.floor(time * 6), sd) > 0.8) {
          p.col('#ffffff', a);
          p.dot(x, y);
        }
      }
    },
  ),
});

// =============================================================================
// ДВИЖЕНИЕ КОРОЛЯ — визуальные зоны мозга. Шаг (`f10_fxstep`): пыль из-под
// сапога назад по ходу. Взлёт (`f10_fxwing`): крылья бьют в пол — пыль
// кольцом и штрихи ветра. Взмах в полёте (`f10_fxflap`): пыль под тенью.
// Крылья (`f10_fxgust`, смена фазы 2): ветер закручивается к королю, в
// 0,9 с крылья распахиваются — порыв кольцом. Рёв (`f10_fxroar`, фаза 3,
// поверх темноты): кольца звука от головы; `f10_fxquake` — пол дрожит,
// крошка скачет, пыль поднимается.
// =============================================================================

registerZonePainter(
  'f10_fxstep',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number) => {
    const zz = z as FxZone;
    const a = zz.ang ?? 0;
    const side = zz.n ? 1 : -1;
    const cx = zz.x * S - Math.sin(a) * 4 * side;
    const cy = zz.y * S + Math.cos(a) * 3 * side + 1;
    const p = new Pen(g, px, py, zz.x * S, zz.y * S);
    dust(p, zz.id >>> 0, zz.t, cx, cy, 3, a + Math.PI, 1.1, 9, 10, 1.5, 4.5, 2, 0.7, 0, 0.75);
  }),
);

registerZonePainter(
  'f10_fxwing',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number) => {
    const zz = z as FxZone;
    const t = zz.t;
    const cx = zz.x * S;
    const cy = zz.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const sd = zz.id >>> 0;
    const n = reduced() ? 6 : 10;
    dust(
      p,
      sd,
      t,
      cx,
      cy,
      n,
      0,
      0.15,
      75,
      30,
      1.5,
      6,
      3,
      0.8,
      0,
      0.6,
      (i) => 0.04 * (i % 3),
      (i) => {
        const th = (i / n) * TAU;
        return [cx + Math.cos(th) * 8, cy + Math.sin(th) * 5, th];
      },
    );
    if (t < 0.4)
      for (let i = 0; i < 12; i++) {
        const th = (i / 12) * TAU + 0.2;
        const d = 10 + 60 * eOut2(t / 0.4) * (0.7 + 0.3 * hash(sd, i, 3));
        const ex = Math.cos(th);
        const ey = Math.sin(th);
        p.lineS(
          cx + ex * d,
          cy + ey * d,
          cx + ex * (d + 6),
          cy + ey * (d + 6),
          C.wind,
          0.7 * (1 - t / 0.4),
          0.4,
        );
      }
  }),
);

registerZonePainter(
  'f10_fxflap',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number) => {
    const zz = z as FxZone;
    const cx = zz.x * S;
    const cy = zz.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const sd = zz.id >>> 0;
    // Взмах крыльев: лёгкие завитки ветра под тенью, не клубы.
    dust(p, sd, zz.t, cx, cy, 4, 0, 0.3, 45, 14, 1, 3, 1, 0.45, 3, 0.3, undefined, (i) => {
      const th = (i / 5) * TAU + hash(sd, i, 2);
      return [cx + Math.cos(th) * 6, cy + Math.sin(th) * 4, th];
    });
  }),
);

registerZonePainter(
  'f10_fxgust',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number) => {
    const zz = z as FxZone;
    const t = zz.t;
    const cx = zz.x * S;
    const cy = zz.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const sd = zz.id >>> 0;
    const SNAP = 0.9;
    // Вдох: пыль и сор закручивает к королю.
    if (t < SNAP + 0.1)
      for (let i = 0; i < 16; i++) {
        const k = k01((t - hash(sd, i, 1) * 0.3) / (SNAP - 0.25));
        if (k <= 0 || k >= 1) continue;
        const th = hash(sd, i, 2) * TAU + k * 2.2;
        const r = S * (3.4 - 2.8 * eIn2(k));
        const x = cx + Math.cos(th) * r;
        const y = cy + Math.sin(th) * r * 0.75;
        const im = puffImg(3, 1 + 2 * (1 - k), i);
        p.alpha(0.55 * Math.sin(Math.PI * k));
        p.img(im, x - im.width / 2, y - im.height / 2);
        p.col(C.lipHi, 0.9);
        p.dot(x + 3, y + 1);
      }
    // Крылья распахнулись: порыв кольцом, пыль и штрихи наружу.
    const u = t - SNAP;
    if (u >= 0) {
      if (u < 0.5) {
        const k = u / 0.5;
        ring(
          p,
          cx,
          cy,
          12 + 75 * eOut2(k),
          C.wind,
          0.85 * (1 - k),
          (_a, i) => hash(i >> 2, sd, 4) > 0.25,
          0.5,
        );
        ring(
          p,
          cx,
          cy,
          10 + 60 * eOut2(k),
          C.lipHi,
          0.6 * (1 - k),
          (_a, i) => hash(i >> 2, sd, 5) > 0.45,
        );
        for (let i = 0; i < 16; i++) {
          const th = (i / 16) * TAU + 0.1;
          const d = 14 + 70 * eOut2(k) * (0.6 + 0.4 * hash(sd, i, 6));
          const ex = Math.cos(th);
          const ey = Math.sin(th);
          p.lineS(
            cx + ex * d,
            cy + ey * d,
            cx + ex * (d + 8),
            cy + ey * (d + 8),
            C.wind,
            0.75 * (1 - k),
            0.4,
          );
        }
      }
      const n = reduced() ? 6 : 16;
      dust(p, sd + 1, u, cx, cy, n, 0, 0.2, 80, 30, 1.5, 6, 3, 0.8, 0, 0.55, undefined, (i) => {
        const th = (i / n) * TAU;
        return [cx + Math.cos(th) * 12, cy + Math.sin(th) * 8, th];
      });
    }
  }),
);

/** Где голова короля над точкой ног, пиксели (анфас, рёв). */
const HEAD_UP = 62;

registerZonePainter(
  'f10_fxroar',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number) => {
    const zz = z as FxZone;
    const t = zz.t;
    const cx = zz.x * S;
    const cy = zz.y * S - HEAD_UP;
    const p = new Pen(g, px, py, cx, cy);
    const sd = zz.id >>> 0;
    for (let j = 0; j < 5; j++) {
      const tj = t - 0.12 - j * 0.26;
      if (tj < 0 || tj > 0.75) continue;
      const k = tj / 0.75;
      const r = 8 + 70 * eOut2(k);
      ring(p, cx, cy, r, C.white, 0.9 * (1 - k), (_a, i) => hash(i >> 2, sd + j, 3) > 0.35, 0.4);
      ring(p, cx, cy, r - 2, C.crimson, 0.8 * (1 - k), (_a, i) => hash(i >> 2, sd + j, 4) > 0.25);
    }
  }),
);

registerZonePainter(
  'f10_fxquake',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const zz = z as FxZone;
    const t = zz.t;
    const cx = zz.x * S;
    const cy = zz.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const sd = zz.id >>> 0;
    const k = 1 - k01((t - 1.3) / 0.6);
    for (let i = 0; i < 40; i++) {
      const rr = S * (1 + 4 * hash(sd, i, 1));
      const aa = hash(sd, i, 2) * TAU;
      const hop = Math.floor(hash(i, Math.floor(time * 18), sd) * 4 * k);
      const gx = cx + Math.cos(aa) * rr;
      const gy = cy + Math.sin(aa) * rr * 0.8;
      if (hop) {
        p.col(C.ink, 0.45);
        p.dot(gx, gy + 1);
      }
      p.col(C.lipHi, 0.85 * k);
      p.dot(gx, gy - hop);
    }
    dust(
      p,
      sd,
      t,
      cx,
      cy,
      reduced() ? 5 : 12,
      -Math.PI / 2,
      0.4,
      4,
      4,
      2,
      7,
      10,
      1.1,
      0,
      0.7,
      (i) => 0.08 * i,
      (i) => {
        const rr = S * (1.2 + 3.5 * hash(sd, i, 3));
        const aa = hash(sd, i, 4) * TAU;
        return [cx + Math.cos(aa) * rr, cy + Math.sin(aa) * rr * 0.8];
      },
    );
  }),
);

// =============================================================================
// ОБРУШЕНИЕ КРАЯ (фаза 3). Клетка «трескается» (`f10_fxcrack`, 2 с): те же
// трещины, что нарисованы в клетке, наливаются жаром снизу, мерцают всё
// чаще, крошка скачет, из трещин курится пыль; последние 0,2 с — «тик-тик».
// Клетка «падает» (`f10_fxfall`): плита уходит вниз, сжимаясь и темнея,
// обломки сыплются в бездну, по краю — пыль; `f10_fxember` (поверх
// темноты) — из провала вспыхивает огонь бездны, угольки летят вверх.
// Клетки — номера мира, `ww` — ширина мира.
// =============================================================================

type CellZone = FxZone & { ww?: number };

/** Пиксели трещин клетки «трескается» — повтор рисунка `crackingCell` в f10-art. */
function crackCellPix(v: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let n = 0; n < 3; n++) {
    let x = 2 + Math.floor(hash(n, v, 1) * 12);
    let y = 0;
    while (y < 16) {
      out.push([x, y, y % 3 === 0 ? 2 : 1]);
      out.push([Math.min(15, x + 1), y, 0]);
      y += 1;
      x += hash(n, y, v) > 0.5 ? 1 : -1;
      x = Math.max(0, Math.min(15, x));
    }
  }
  return out;
}

/** Жар в трещинах клетки: сердцевина белая, края — оранжевые, ореол. */
function cellGlow(v: number): HTMLCanvasElement {
  return sprite(70000 + (v & 3), () => {
    const p = new Px(16, 16);
    const pix = crackCellPix(v & 3);
    const on = new Set(pix.map(([x, y]) => y * 16 + x));
    for (const [x, y] of pix)
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const X = x + dx;
        const Y = y + dy;
        if (X < 0 || Y < 0 || X > 15 || Y > 15 || on.has(Y * 16 + X)) continue;
        p.set(X, Y, hx(C.fire[2], 120));
      }
    for (const [x, y, c] of pix)
      p.set(x, y, hx(c === 2 ? C.fire[4] : c === 1 ? C.fire[3] : C.fire[2]));
    return p;
  });
}

/** Плита, что уходит в бездну: чёрный мрамор с остывшими трещинами, dl — темнее. */
function slabImg(v: number, dl: number): HTMLCanvasElement {
  return sprite(71000 + (v & 3) * 8 + dl, () => {
    const p = new Px(16, 16);
    const M = [hx('#0d0a10'), hx('#1d1822'), hx('#2c2634'), hx('#463e50')];
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const edge =
          x === 0 || y === 0 ? 3 : x === 15 || y === 15 ? 0 : hash(x, y, v) > 0.9 ? 2 : 1;
        p.set(x, y, M[edge]);
      }
    for (const [x, y, c] of crackCellPix(v & 3)) p.set(x, y, c ? hx('#4a0a06') : hx('#1a0404'));
    if (dl > 0) {
      const d = new Px(16, 16);
      d.data.set(p.data);
      return d.tint(hx('#000000'), dl * 0.22);
    }
    return p;
  });
}

/**
 * Огонь бездны в провале: клетка светится снизу (там глубина видна), край —
 * через пиксель. Квадратом клетки, а не кругом: круги по краю читались
 * рядом монет.
 */
function abyssGlow(): HTMLCanvasElement {
  return sprite(72000, () => {
    const p = new Px(16, 16);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const dv = (15 - y) / 15;
        const dh = Math.abs(x + 0.5 - 8) / 8;
        const I = (1 - dv * 0.85) * (1 - dh * dh * 0.7);
        if (I < 0.28) continue;
        if (I < 0.45 && (x + y) & 1) continue;
        p.set(x, y, hx(I > 0.78 ? C.fire[3] : I > 0.55 ? C.fire[2] : C.fire[1]));
      }
    return p;
  });
}

const cellsOf = (zz: CellZone): [number, number][] => {
  const W = zz.ww ?? paintSim()?.world.w ?? 0;
  if (!W || !zz.cells) return [];
  return zz.cells.map((i) => [i % W, Math.floor(i / W)]);
};

registerZonePainter(
  'f10_fxcrack',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const zz = z as CellZone;
    const t = zz.t;
    const p = new Pen(g, px, py, zz.x * S, zz.y * S);
    const T = 2;
    const left = T - t;
    const tk = !reduced() && tick(left);
    const ramp = 0.25 + 0.75 * Math.pow(k01(t / T), 1.6);
    const cells = cellsOf(zz);
    for (const [x, y] of cells) {
      const X = x * S;
      const Y = y * S;
      const v = Math.floor(hash(x, y, 51) * 4);
      const fl = 0.7 + 0.3 * Math.sin(time * (7 + 16 * k01(t / T)) + x * 1.3 + y * 0.7);
      p.alpha(tk ? 1 : ramp * fl);
      p.img(cellGlow(v), X, Y);
      // Крошка скачет, пыль курится из трещин.
      for (let j = 0; j < 2; j++) {
        const hop = Math.floor(hash(x * 3 + j, Math.floor(time * 14), y) * (1 + 3 * ramp));
        const gx = X + 2 + Math.floor(hash(x, y, 60 + j) * 12);
        const gy = Y + 2 + Math.floor(hash(x, y, 62 + j) * 12);
        if (hop) {
          p.col(C.ink, 0.45);
          p.dot(gx, gy + 1);
        }
        p.col(C.lipHi, 0.85);
        p.dot(gx, gy - hop);
      }
      const per = 0.7;
      const ph = mod(t + hash(x, y, 64) * per, per) / per;
      if (t > 0.3) {
        const im = puffImg(0, 1 + 2 * ph, x + y);
        p.alpha(0.55 * (1 - ph));
        p.img(im, X + 4 + hash(x, y, 65) * 8 - im.width / 2, Y + 8 - ph * 10 - im.height / 2);
      }
    }
  }),
);

registerZonePainter(
  'f10_fxfall',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number) => {
    const zz = z as CellZone;
    const t = zz.t;
    const p = new Pen(g, px, py, zz.x * S, zz.y * S);
    const cells = cellsOf(zz);
    const few = reduced();
    for (const [x, y] of cells) {
      const X = x * S;
      const Y = y * S;
      const v = Math.floor(hash(x, y, 51) * 4);
      const sd = (x * 7919 + y * 104729) >>> 0;
      // Плита уходит вниз: сжимается к середине, темнеет, чуть крутится.
      const k = t / 0.6;
      if (k < 1) {
        const s = 1 - 0.8 * eIn2(k);
        const dl = Math.min(3, Math.floor(k * 4));
        g.save();
        g.globalAlpha = 1;
        g.translate(X + 8 + p.qx, Y + 8 + 5 * eIn2(k) + p.qy);
        g.rotate((hash(x, y, 66) - 0.5) * 0.7 * k);
        g.scale(s, s);
        g.drawImage(slabImg(v, dl), -8, -8);
        g.restore();
      }
      // Обломки сыплются в провал — уменьшаются и тонут в темноте.
      for (let j = 0; j < (few ? 1 : 3); j++) {
        const tt = t - 0.03 * j;
        if (tt < 0 || tt > 0.55) continue;
        const kk = tt / 0.55;
        const bx = X + 2 + hash(sd, j, 1) * 12 + (hash(sd, j, 2) - 0.5) * 8 * kk;
        const by = Y + 2 + hash(sd, j, 3) * 10 + 60 * tt * tt;
        const im = chunkImg(kk < 0.5 ? 2 : 1, j + Math.floor(tt * 16), 0);
        p.alpha(1 - kk);
        p.img(im, bx - im.width / 2, by - im.height / 2);
      }
      // Пыль по краю провала.
      if (!few && (x + y) % 2 === 0)
        dust(p, sd, t, X + 8, Y + 4, 2, -Math.PI / 2, 1.2, 8, 8, 2, 6, 6, 0.9, 0, 0.7);
    }
  }),
);

registerZonePainter(
  'f10_fxember',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const zz = z as CellZone;
    const t = zz.t;
    const p = new Pen(g, px, py, zz.x * S, zz.y * S);
    const cells = cellsOf(zz);
    const few = reduced();
    const gl = abyssGlow();
    for (const [x, y] of cells) {
      const X = x * S;
      const Y = y * S;
      const sd = (x * 7919 + y * 104729) >>> 0;
      // У каждой клетки свой миг и своя сила: провал вспыхивает неровно.
      const d0 = 0.05 + 0.25 * hash(sd, 1, 4);
      const tt = t - d0;
      if (tt < 0) continue;
      const pow = 0.55 + 0.45 * hash(sd, 2, 4);
      const fl = (tt < 0.15 ? tt / 0.15 : 1 - k01((tt - 0.15) / 0.9)) * pow;
      if (fl > 0) {
        p.alpha(0.32 * fl);
        p.img(gl, X, Y);
      }
      // Языки огня бездны встают из провала и опадают.
      for (let j = 0; j < (few ? 1 : 2); j++) {
        const tj = tt - 0.08 * j;
        if (tj < 0 || tj > 0.8) continue;
        const h = 11 * pow * Math.sin(Math.PI * (tj / 0.8)) * (0.7 + 0.3 * hash(sd, j, 5));
        if (h < 3) continue;
        const im = flameImg(h, Math.floor(time * 12) + j + x);
        const fx = X + 3 + hash(sd, j, 6) * 10;
        p.alpha(0.95);
        p.img(im, fx - im.width / 2, Y + 14 - im.height);
      }
      embers(
        p,
        sd,
        tt,
        few ? 1 : 2,
        1.1,
        26,
        (i) => 0.05 + 0.3 * hash(sd, i, 5),
        (i) => [X + 3 + hash(sd, i, 6) * 10, Y + 6 + hash(sd, i, 7) * 6],
      );
    }
  }),
);

// Отсвет жаровен по полу тронного зала (фаза 1, картинка): дышит медленно,
// вздрагивает, как огонь.
registerZonePainter(
  'f10_redglow',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const R = z.r * S;
    const a =
      0.075 + 0.022 * Math.sin(time * 1.6) + 0.01 * Math.sin(time * 7.3) * Math.sin(time * 3.1);
    const grd = g.createRadialGradient(px, py, R * 0.15, px, py, R);
    grd.addColorStop(0, `rgba(170,24,26,${a.toFixed(3)})`);
    grd.addColorStop(0.6, `rgba(120,14,20,${(a * 0.6).toFixed(3)})`);
    grd.addColorStop(1, 'rgba(120,14,20,0)');
    g.fillStyle = grd;
    g.fillRect(px - R, py - R, R * 2, R * 2);
  }),
);

// ---- Прогрев: всё, что король покажет в бою, — заранее, по кадру за шаг ----

registerMobWarm('f10boss', function* () {
  for (let pal = 0; pal < PUFF_PAL.length; pal++)
    for (let r = 1; r <= 12; r++)
      for (let v = 0; v < 4; v++) {
        puffImg(pal, r, v);
        if (v === 3) yield;
      }
  for (let pal = 0; pal < 2; pal++)
    for (let sz = 1; sz <= 4; sz++) {
      for (let f = 0; f < 4; f++) chunkImg(sz, f, pal);
      yield;
    }
  for (let h = 3; h <= 12; h++) {
    for (let f = 0; f < 4; f++) flameImg(h, f);
    yield;
  }
  for (let f = 0; f < 8; f++) featherImg(f);
  yield;
  for (let v = 0; v < 8; v++) {
    boltCol(v, 112);
    yield;
  }
  for (let s = 17; s <= 30; s++) {
    for (let f = 0; f < 4; f++) {
      wingShadow(s, f, true);
      wingShadow(s, f, false);
    }
    yield;
  }
  for (const r of [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]) scorchImg(r, 0);
  scorchImg(6, 2);
  yield;
  for (let v = 0; v < 4; v++) {
    cellGlow(v);
    for (let d = 0; d < 4; d++) slabImg(v, d);
    yield;
  }
  abyssGlow();
});

// Репетиция: каждая метка и каждый контакт короля — по разу на скрытом
// холсте. Первый вызов рисовальщика дорог (компиляция, круги, трещины,
// спрайты) — пусть он случится в прогреве, а не в миг удара. Ошибка здесь
// не должна гасить весь прогрев движка — каждый вызов под своей защитой.
registerMobWarm('f10boss', function* () {
  if (typeof document === 'undefined') return;
  const cv = document.createElement('canvas');
  cv.width = 160;
  cv.height = 160;
  const g = cv.getContext('2d');
  if (!g) return;
  const zones: [string, Record<string, unknown>][] = [
    ['f10_slash', { shape: 'cone', r: 3.3, arc: 2.4, ang: 0.3, warn: 0.6 }],
    ['f10_cleave', { shape: 'line', r: 6.2, w: 0.75, ang: 0.3, warn: 0.65 }],
    ['f10_rift', { r: 0.5, life: 2.2, ang: 0.3, len: 6.2 }],
    ['f10_shock', { shape: 'circle', r: 3.2, warn: 1 }],
    ['f10_command', { r: 2.2, life: 2.8 }],
    ['f10_divemark', { r: 1.7, life: 2.4, follow: 1 }],
    ['f10_diveland', { shape: 'circle', r: 1.8, warn: 0.75 }],
    ['f10_shockring', { shape: 'ring', r: 3.1, w: 0.55, warn: 0.35 }],
    ['f10_feather', { shape: 'circle', r: 0.6, warn: 0.9 }],
    ['f10_fxtouch', { r: 0.5, life: 1.8 }],
    ['f10_fxgust', { r: 0.5, life: 2.3 }],
    ['f10_fxroar', { r: 0.5, life: 2 }],
  ];
  const t = [0.05, 0.35, 0.7];
  for (const [art, o] of zones) {
    const zp = ZONE_PAINTERS.get(art);
    for (const k of t)
      try {
        g.setTransform(2, 0, 0, 2, 0, 0);
        const warn = (o.warn as number | undefined) ?? (o.life as number);
        zp?.(
          g,
          { id: -1, x: 2, y: 2, dmg: 0, ...o, t: k * warn } as unknown as Zone,
          40,
          40,
          16,
          k,
        );
      } catch {
        // репетиция — не бой
      }
    yield;
  }
  for (const art of [
    'f10_slash',
    'f10_cleave',
    'f10_shock',
    'f10_diveland',
    'f10_shockring',
    'f10_feather',
    'f10_bolt',
    'f10_bolt_line',
    'f10_glass',
  ]) {
    const imp = IMPACT_PAINTERS.get(art);
    const rec: ImpactRec = {
      art,
      x: 2,
      y: 2,
      shape: 'circle',
      r: 1.2,
      w: 0.6,
      ang: 0,
      arc: 2.4,
      seed: 7,
    };
    for (const k of t)
      try {
        g.setTransform(2, 0, 0, 2, 0, 0);
        imp?.paint(g, rec, 40, 40, 16, k, k);
      } catch {
        // репетиция — не бой
      }
    yield;
  }
});
