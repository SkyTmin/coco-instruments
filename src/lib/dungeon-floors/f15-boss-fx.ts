// Этаж 15, босс «Хозяин подземелья» — техники (v2.87): метки ударов,
// контакт, пыль, кровь, осколки, ветер, память прошлых этажей, удары
// сердца, техники эха. Тело босса рисует `f15-boss-art.ts`, здесь — всё, что
// босс делает с МИРОМ. Договор движка — библия §14.
//
// Как устроено:
//   • метка удара (`registerZonePainter` для strike) читается «куда» с
//     первого кадра (вся фигура удара тёмной кровью с кромкой) и «когда» —
//     фронт налива доходит до края ровно в миг урона; последние 0,2 с —
//     «тик-тик» и белая кромка. У каждой техники ещё свой предвестник: три
//     борозды когтей, четыре отпечатка лап, трещина под шипом, тень лезвия;
//   • контакт (`registerImpactPainter`) — кадр-звезда в миг урона, потом
//     то, что удар сделал с полом: рваная плоть, трещины, брызги крови,
//     обломки камня с тяжестью и отскоком, пыль клубами, которая оседает;
//     тряска — по силе удара;
//   • удары без своего strike (шаги, посадка, взмахи крыльев, рёв, кокон
//     лопается, сердце вырвано, стены сжимаются, финал) — визуальные зоны
//     `f15b_fx*`, их ставит мозг через `api.vfx` (без урона и статусов);
//   • всё светящееся (лава, лучи, молнии, взрывы перьев) — поверх темноты;
//     то, что в этом слое лежит на полу, прячется за телами, стоящими ближе
//     к камере (`occOf`), — как если бы слой сортировался по глубине.
//
// Пиксели — на СЕТКЕ МИРА (`Pen`): эффект не «плывёт» по полу при движении
// камеры. Частицы детерминированы — позиция считается от зерна и возраста,
// а не копится по кадрам: лист кадров и игра рисуют одно и то же, стоп-кадр
// держит позу сам.
//
// Пол камеры сердца — тёмная плоть, поэтому пыль здесь светлее пола
// (розово-серая), у трещин светлая кромка снизу-справа (свет сверху-слева),
// обломки — с тёмным контуром.
import { Px } from '../dungeon-art';
import {
  paintSim,
  registerImpactPainter,
  registerShotPainter,
  registerZonePainter,
} from '../dungeon-paint';
import type { ImpactRec, Sprite } from '../dungeon-paint';
import type { Mob, Shot, Sim, Strike, Zone } from '../dungeon-sim';
import { beatK, f15bView, HEART, LION } from './f15-boss-brains';
import { heartTop, TRUNK, trunkX, veinEnds, veinPoint, VEINS } from './f15-boss-art';

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
const eInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t));
/** Остаток всегда положительный: у зон `api.vfx` номера отрицательные. */
const mod = (x: number, n: number) => ((x % n) + n) % n;
/** Зерно из номера удара/зоны: у зон `api.vfx` номер отрицательный. */
const seedOf = (id: number | undefined) => (id ?? 0) >>> 0;

/** Последние 0,2 с перед уроном — ясный сигнал «сейчас». */
const SIG = 0.2;
/** «Тик-тик»: две вспышки в последние 0,2 с (0,20…0,15 и 0,10…0,05). */
const tick = (left: number) => left < SIG && Math.floor(left / 0.05) % 2 === 1;

// ---- Палитра: плоть, кровь, камень льва, угли, память, эхо -------------------

const C = {
  ink: '#0c0206',
  groove: '#070103',
  flesh: ['#1a0509', '#2e0b12', '#501822', '#7d2e35', '#a8524c'],
  lip: '#b86a60',
  lipHi: '#e0a090',
  blood: ['#2a0306', '#5a0a10', '#9a1420', '#d8222e', '#ff5a4a'],
  bloodHi: '#ff9a8a',
  ember: ['#4a0a04', '#9a2a08', '#e05010', '#ff8a2a', '#ffd080', '#fff4c8'],
  stone: ['#120e0f', '#2c2421', '#4a3e37', '#6e5f54', '#98877a', '#c4b4a2'],
  gold: ['#7a4a10', '#d8a030', '#ffd040', '#fff4b0'],
  wind: '#f0e4e0',
  windMid: '#c8b4b4',
  white: '#fff8f0',
  shadow: '#000000',
  ghost: ['#140f2a', '#2a3470', '#3c5a9e', '#6a9ed0', '#a8dcf0', '#e6faff'],
  vio: ['#24104a', '#5a34a0', '#9a70e8', '#d8c8ff', '#ffffff'],
  lava: ['#3a0804', '#7a1806', '#c03a08', '#ff7a14', '#ffb030', '#ffe070', '#fff6c0'],
  crust: ['#0e0a0a', '#1c1614', '#2c2420', '#40342c', '#564636'],
  sea: ['#020a10', '#072430', '#0c3a48', '#16586a', '#30a8b8', '#80e8f0', '#d8ffff'],
  glass: ['#1e2c46', '#5a7298', '#94aed0', '#d4e2f4', '#ffffff'],
  bog: ['#0c1408', '#1e300e', '#3a5a18', '#6a9a2a', '#a8e060', '#e0ffa0'],
};

/** Искра угля по доле жизни: белая → жёлтая → оранжевая → красная. */
const emberCol = (k: number) =>
  k < 0.18
    ? '#ffffff'
    : k < 0.42
      ? C.ember[4]
      : k < 0.7
        ? C.ember[3]
        : k < 0.88
          ? C.ember[2]
          : C.ember[1];
/** Капля крови по доле жизни: светлая → алая → тёмная. */
const bloodCol = (k: number) => (k < 0.2 ? C.bloodHi : k < 0.55 ? C.blood[4] : k < 0.8 ? C.blood[3] : C.blood[2]);
/** Пылинка в ветре: белая → бледная → тает в пол. */
const windCol = (k: number) => (k < 0.3 ? C.white : k < 0.7 ? C.wind : C.windMid);
/** Призрачная искра: белая → голубая → синяя. */
const ghostCol = (k: number) =>
  k < 0.25 ? C.ghost[5] : k < 0.55 ? C.ghost[4] : k < 0.85 ? C.ghost[3] : C.ghost[2];
/** Раскалённый шов по остыванию 0 (белый) … 1 (тёмный). */
const heatCol = (k: number) =>
  k < 0.12
    ? C.white
    : k < 0.3
      ? C.ember[4]
      : k < 0.5
        ? C.ember[3]
        : k < 0.7
          ? C.ember[2]
          : k < 0.88
            ? C.ember[1]
            : C.ember[0];
/** Свежая рана в плоти по остыванию: белая → алая → тёмная борозда. */
const woundCol = (k: number) =>
  k < 0.08
    ? C.white
    : k < 0.2
      ? C.bloodHi
      : k < 0.38
        ? C.blood[4]
        : k < 0.6
          ? C.blood[3]
          : k < 0.82
            ? C.blood[2]
            : C.blood[1];

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
 * Тело на экране: прямоугольник `[x0, x1] × [y0, y1]` в пикселях мира, ноги —
 * на `fy`. Пиксель пола (x, y) этим телом заслонён, если он внутри
 * прямоугольника и дальше от камеры, чем ноги (y < fy).
 */
interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  fy: number;
}

/**
 * Тела вылазки, что сейчас на экране: лев (огромный), сердце, эхо, сгустки,
 * герой. Размеры — по кадрам их рисовальщиков, с запасом внутрь: лучше
 * чуть меньше спрятать, чем лечь метке герою на грудь.
 */
function occOf(S: number): Box[] {
  const sim = paintSim();
  const out: Box[] = [];
  if (!sim) return out;
  for (const m of sim.mobs) {
    if (m.mode === 'dying' && m.t > 0.4) continue;
    const lift = Math.round((m.data.z ?? 0) * 3) * 5;
    let hw: number;
    let h: number;
    if (m.kind === 'f15boss') {
      hw = 2.3 * S;
      h = 4.2 * S;
    } else if (m.kind === 'f15boss_heart') {
      hw = 1.3 * S;
      h = 3.4 * S;
    } else if (m.r >= 0.7) {
      hw = 1.1 * S;
      h = 3 * S;
    } else {
      hw = Math.max(5, m.r * S);
      h = m.r * S * 3.2;
    }
    const fy = m.y * S + 2;
    out.push({ x0: m.x * S - hw, x1: m.x * S + hw, y0: fy - lift - h, y1: fy - lift, fy });
  }
  const hero = sim.hero;
  const fy = hero.y * S + 2;
  out.push({ x0: hero.x * S - 0.42 * S, x1: hero.x * S + 0.42 * S, y0: fy - 1.25 * S, y1: fy, fy });
  return out;
}

// ---- Перо: пиксели на сетке мира -------------------------------------------

/**
 * Рисует в игровых пикселях, привязанных к сетке МИРА: `(px, py)` — где на
 * экране точка мира `(wx, wy)` (в пикселях мира). Поправка `qx/qy` — остаток
 * привязки движка, одна на весь кадр: эффект стоит на полу, а не дрожит.
 *
 * `occ` — тела, которые заслоняют пол (слой поверх темноты): пока поле
 * задано, всё, что рисует перо, считается лежащим на полу, и пиксели за
 * телами пропускаются. Летящее (искры, брызги) рисуется с `occ = null`.
 */
class Pen {
  readonly g: CanvasRenderingContext2D;
  readonly qx: number;
  readonly qy: number;
  occ: Box[] | null = null;
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
    this.rect(Math.floor(x), Math.floor(y), w, h);
  }
  /** Прямоугольник в целых пикселях мира (уже с полом). */
  rect(x: number, y: number, w: number, h: number): void {
    if (!this.occ) {
      this.g.fillRect(x + this.qx, y + this.qy, w, h);
      return;
    }
    for (let yy = y; yy < y + h; yy++) this.run(yy, x, x + w - 1);
  }
  /** Строка пикселей [xa, xb] без заслонённых кусков. */
  private run(Y: number, xa: number, xb: number): void {
    let lo = xa;
    const cuts: [number, number][] = [];
    for (const b of this.occ!) {
      if (Y < b.y0 || Y > b.y1 || Y >= b.fy - 1 || b.x1 < xa || b.x0 > xb) continue;
      cuts.push([Math.floor(b.x0), Math.ceil(b.x1)]);
    }
    if (!cuts.length) {
      this.g.fillRect(xa + this.qx, Y + this.qy, xb - xa + 1, 1);
      return;
    }
    cuts.sort((p, q) => p[0] - q[0]);
    for (const [c0, c1] of cuts) {
      if (c0 > lo) this.g.fillRect(lo + this.qx, Y + this.qy, Math.min(xb, c0 - 1) - lo + 1, 1);
      lo = Math.max(lo, c1 + 1);
      if (lo > xb) return;
    }
    if (lo <= xb) this.g.fillRect(lo + this.qx, Y + this.qy, xb - lo + 1, 1);
  }
  /**
   * Картинка. С `occ`: `depth` — y опоры предмета (стоит на полу), без него —
   * каждая строка картинки сама лежит на полу.
   */
  img(c: HTMLCanvasElement, x: number, y: number, depth?: number): void {
    const X = Math.floor(x);
    const Y = Math.floor(y);
    const occ = this.occ;
    if (occ) {
      let hit = false;
      for (const b of occ) {
        if (b.x1 < X || b.x0 > X + c.width || b.y1 < Y || b.y0 > Y + c.height) continue;
        if ((depth ?? Y) >= b.fy - 1) continue;
        hit = true;
        break;
      }
      if (hit) {
        // Заслонено: по строкам — видимые куски строки картинки.
        for (let yy = 0; yy < c.height; yy++) {
          const Yr = Y + yy;
          const d = depth ?? Yr;
          let lo = 0;
          const cuts: [number, number][] = [];
          for (const b of occ) {
            if (Yr < b.y0 || Yr > b.y1 || d >= b.fy - 1) continue;
            const c0 = Math.floor(b.x0) - X;
            const c1 = Math.ceil(b.x1) - X;
            if (c1 < 0 || c0 >= c.width) continue;
            cuts.push([c0, c1]);
          }
          cuts.sort((p, q) => p[0] - q[0]);
          const put = (a: number, b: number) => {
            if (b >= a) this.g.drawImage(c, a, yy, b - a + 1, 1, X + a + this.qx, Yr + this.qy, b - a + 1, 1);
          };
          for (const [c0, c1] of cuts) {
            put(lo, Math.min(c.width - 1, c0 - 1));
            lo = Math.max(lo, c1 + 1);
          }
          put(lo, c.width - 1);
        }
        return;
      }
    }
    this.g.drawImage(c, X + this.qx, Y + this.qy);
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
    for (let n = 0; n < 900; n++) {
      this.rect(x, y, 1, 1);
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
 * Кольцевой сектор [r0, r1] × [a0, a1] строками пикселей. Угол больше
 * четверти круга режется на куски с ОБЩИМИ границами: пиксель на стыке
 * достаётся ровно одному куску, и полупрозрачная заливка не даёт шва.
 */
function fillSector(p: Pen, cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): void {
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
        if (xb >= xa) p.rect(xa, Y, xb - xa + 1, 1);
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
    if (dither) for (let x = xa + ((xa + Y) & 1); x <= xb; x += 2) p.rect(x, Y, 1, 1);
    else p.rect(xa, Y, xb - xa + 1, 1);
  }
}

/** Полоса вдоль (ux, uy) от l0 до l1, полуширина hw — строками пикселей. */
function fillLane(p: Pen, cx: number, cy: number, ux: number, uy: number, l0: number, l1: number, hw: number, dither = false): void {
  if (l1 <= l0) return;
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
  if (circles.size > 200) circles.delete(circles.keys().next().value as number);
  circles.set(R, c);
  return c;
}

/**
 * Кольцо по пикселям цветом `c`. `keep(a, i)` — оставить ли пиксель
 * (пунктир, дуга, «рваная» пыль). `sh` — тень на пиксель вниз-вправо.
 * `ry` — сплющить по вертикали (кольцо на полу в перспективе).
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
function lens(p: Pen, cx: number, cy: number, ux: number, uy: number, l: number, w: number, dither = false): void {
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

/** Овал на полу: полуоси rx, ry (перспектива — ry ≈ 0,62 rx). */
const oval = (p: Pen, cx: number, cy: number, rx: number, ry: number, dither = false) =>
  lens(p, cx, cy, 1, 0, Math.max(0.6, rx), Math.max(0.6, ry), dither);

/**
 * Звезда удара: n лучей радиуса r (у основания — 0,4 r), залита по
 * пикселям. Кадр контакта: рисуется два-три кадра, сжимаясь.
 */
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

/** Кадр контакта: белая звезда, внутри — цветная, сжимается за `T`. */
function hitStar(p: Pen, x: number, y: number, age: number, T: number, r: number, rot: number, inner: string): void {
  if (age >= T) return;
  const k = age / T;
  p.col(k < 0.4 ? C.white : inner, 1);
  star(p, x, y, r * (1 - 0.5 * k), 8, rot);
  if (k < 0.6) {
    p.col(inner, 1);
    star(p, x, y, r * 0.45, 4, rot + 0.4);
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
  [hx('#341a1e'), hx('#56343a'), hx('#7e5650')], // 0 — пыль плоти, чуть светлее пола
  [hx('#0a0607'), hx('#1c1416'), hx('#302427')], // 1 — копоть и дым
  [hx('#3a0e0c'), hx('#7a2414'), hx('#c05024')], // 2 — горячий пепел, огонь
  [hx('#7a6a70'), hx('#b8a8ac'), hx('#efe6e4')], // 3 — ветер крыльев
  [hx('#1c2850'), hx('#3c5a9e'), hx('#8ab8e0')], // 4 — призрачный туман эха
  [hx('#2a5a68'), hx('#6aa8b8'), hx('#d0f4f8')], // 5 — брызги и пар бездны
  [hx('#1a3a10'), hx('#3e7020'), hx('#84b440')], // 6 — яд топи
  [hx('#3a0610'), hx('#7a1420'), hx('#c03040')], // 7 — кровавая взвесь
  [hx('#5a4a30'), hx('#a08a5a'), hx('#e8d8a0')], // 8 — золотая пыль сердца
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
        // Край у крупного клуба — через пиксель: облако, а не шарик с обводкой.
        const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
        if (edge && R > 3 && (x + y) & 1) continue;
        const l = ((x + 0.5 - c) * -0.55 + (y + 0.5 - c) * -0.83) / Math.max(1, R);
        p.set(x, y, l > 0.32 ? hi : l > -0.5 ? mid : sh);
      }
    return p;
  });
}

const CHUNK_PAL: RGBA[][] = [
  [hx('#120e0f'), hx('#3a312c'), hx('#6e5f54'), hx('#a8988a')], // 0 — камень льва
  [hx('#1a0408'), hx('#4a0c16'), hx('#7a1a26'), hx('#b04850')], // 1 — плоть
  [hx('#1a1412'), hx('#3a302a'), hx('#5e5046'), hx('#8e7c6a')], // 2 — скорлупа кокона
  [hx('#10304a'), hx('#3a7aa8'), hx('#90e0ff'), hx('#ffffff')], // 3 — лёд
  [hx('#1e2c46'), hx('#5a7298'), hx('#b4c8e4'), hx('#ffffff')], // 4 — стекло зеркала
  [hx('#0e0a0a'), hx('#2c2420'), hx('#564636'), hx('#ff7a14')], // 5 — корка лавы
  [hx('#140f2a'), hx('#2a3470'), hx('#6a9ed0'), hx('#e6faff')], // 6 — призрачный осколок
];

/** Обломок размера 1…4, поворот f (0…3): грань с объёмом, у крупных камней — тлеющий шов. */
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
    if (sz >= 3 && pal === 0) p.set(Math.floor(c), Math.floor(c), hx(C.ember[3]));
    p.outline(hx(C.ink));
    return p;
  });
}

/** Язык пламени высоты h (3…14), кадр f (0…3), палитра: 0 — огонь, 1 — призрак, 2 — лава. */
function flameImg(h: number, f: number, pal = 0): HTMLCanvasElement {
  const H = Math.max(3, Math.min(14, Math.round(h)));
  return sprite(30000 + pal * 1000 + H * 8 + (f & 3), () => {
    const w = Math.max(3, Math.round(H * 0.5)) | 1;
    const p = new Px(w + 2, H + 1);
    const cx = (w + 2) / 2;
    const fire =
      pal === 1
        ? [C.ghost[1], C.ghost[2], C.ghost[3], C.ghost[4], C.ghost[5]].map((c) => hx(c))
        : pal === 2
          ? [C.lava[1], C.lava[2], C.lava[3], C.lava[5], C.lava[6]].map((c) => hx(c))
          : [C.ember[0], C.ember[1], C.ember[2], C.ember[3], C.ember[4]].map((c) => hx(c));
    for (let y = 0; y < H; y++) {
      const t = y / Math.max(1, H - 1);
      const half = (w / 2) * Math.pow(Math.sin(Math.PI * Math.min(1, 0.12 + t * 0.95) * 0.5), 0.9);
      const sway = Math.round(Math.sin((f & 3) * 1.57 + t * 2.6) * (1 - t) * 1.3);
      for (let x = 0; x < w + 2; x++) {
        const d = Math.abs(x + 0.5 - cx - sway);
        if (d > half + 0.25) continue;
        const inner = half - d;
        // y — от вершины: сверху узкий тёмный язычок, книзу шире и ярче.
        const col = y === 0 ? fire[1] : t > 0.45 && inner > 1.4 ? fire[4] : inner > 0.7 ? fire[3] : t < 0.3 ? fire[1] : fire[2];
        p.set(x, y, col);
      }
    }
    return p;
  });
}

/** Тёмное пятно радиуса r: выжженное (0), лужа крови (1), копоть призрака (2). */
function scorchImg(r: number, tone: number): HTMLCanvasElement {
  const R = Math.max(2, Math.min(24, Math.round(r)));
  return sprite(60000 + R * 4 + tone, () => {
    const s = R * 2 + 1;
    const p = new Px(s, s);
    const c = [hx('#08020a'), hx('#3a040a'), hx('#0c1028')][tone];
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

/** Падение с высоты z0: та же тяжесть, потом отскоки, как у `fly`. */
function fall(t: number, z0: number, vz: number, G: number, e = 0.3): Fly {
  // Время до касания: z0 + vz t − G t²/2 = 0.
  const T = (vz + Math.sqrt(vz * vz + 2 * G * z0)) / G;
  if (t < T) return { h: t, z: z0 + vz * t - (G * t * t) / 2, air: true };
  const vHit = G * T - vz;
  const f = fly(t - T, vHit * e, G, e);
  return { h: T + f.h * 0.45, z: f.z, air: f.air };
}

/** Путь с сопротивлением: скорость v гаснет с темпом k. */
const drag = (v: number, k: number, t: number) => (v / k) * (1 - Math.exp(-k * t));

/**
 * Обломки веером: `n` штук из (x, y) в сторону `ang` ± `spread`, скорость
 * `v0…v0+dv`, подброс `vz0…vz0+dvz`. Тень под летящим, лёгший гаснет к
 * `fade`. `big` — доля крупных. `delay(i)` — когда вылетает i-й, `at(i)` —
 * откуда (третье число — свой угол).
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
    // Клуб раздувается, а под конец садится и тает — пыль оседает.
    const grow = eOut2(k01(t / (L * 0.45)));
    const settle = 1 - 0.45 * k01((k - 0.55) / 0.45);
    const r = (r0 + (r1 - r0) * sz * grow) * settle;
    const z = rise * (0.6 + 0.4 * h2) * eOut2(k);
    const im = puffImg(pal, r, i);
    p.alpha(0.85 * alpha * (k < 0.15 ? 1 : 1 - Math.pow((k - 0.15) / 0.85, 0.9)));
    const ox = src ? src[0] : x;
    const oy = src ? src[1] : y;
    p.img(im, ox + Math.cos(th) * d - im.width / 2, oy + Math.sin(th) * d - z - im.height / 2, oy + Math.sin(th) * d);
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
  col: (k: number) => string = emberCol,
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
 * Капли: вылетают из `at(i)` (третье число — угол), летят с тяжестью, а
 * упавшие остаются пятнышком до `fade`. Летящая капля — с хвостиком по
 * ходу; цвет — по доле полёта (`col`), пятно — `splat`.
 */
function drops(
  p: Pen,
  seed: number,
  age: number,
  n: number,
  at: (i: number) => [number, number, number],
  v0: number,
  dv: number,
  vz0: number,
  dvz: number,
  born: (i: number) => number,
  col: (k: number) => string,
  splat: string | null,
  fade: [number, number],
  G = 380,
): void {
  const a = 1 - k01((age - fade[0]) / (fade[1] - fade[0]));
  if (a <= 0) return;
  for (let i = 0; i < n; i++) {
    const t = age - born(i);
    if (t < 0) continue;
    const [ox, oy, th0] = at(i);
    const th = th0 + (hash(seed, i, 61) - 0.5) * 0.7;
    const v = v0 + dv * hash(seed, i, 62);
    const vz = vz0 + dvz * hash(seed, i, 63);
    const T = (2 * vz) / G;
    if (t < T) {
      const z = vz * t - (G * t * t) / 2;
      const gx = ox + Math.cos(th) * v * t;
      const gy = oy + Math.sin(th) * v * t;
      const t2 = Math.max(0, t - 0.03);
      const z2 = vz * t2 - (G * t2 * t2) / 2;
      p.col(col(t / T), a);
      p.line(ox + Math.cos(th) * v * t2, oy + Math.sin(th) * v * t2 - z2, gx, gy - z);
    } else if (splat) {
      const gx = ox + Math.cos(th) * v * T;
      const gy = oy + Math.sin(th) * v * T;
      p.col(splat, 0.85 * a);
      p.dot(gx, gy, hash(seed, i, 64) < 0.4 ? 2 : 1, 1);
    }
  }
}

/** Угольки: поднимаются от места рождения, качаются, гаснут. */
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
  col: (k: number) => string = emberCol,
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
 * снизу-справа (свет сверху-слева), как разрыв в плоти.
 */
function crackOf(key: string, seed: number, br: [number, number, number][], jag = 0.5, forkP = 0.22, forkL = 0.45): Crack {
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
  const walk = (x0: number, y0: number, a0: number, len: number, d0: number, wid: number, id: number, depth: number) => {
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
        if (w > 1.1) put(Math.floor(qx + Math.sin(a) * 0.95), Math.floor(qy - Math.cos(a) * 0.95), d);
        if (w > 2.1) put(Math.floor(qx - Math.sin(a) * 0.95), Math.floor(qy + Math.cos(a) * 0.95), d);
      }
      x = nx;
      y = ny;
      if (depth < 1 && s > len * 0.25 && s < len * 0.8 && hash(seed, id * 17 + i, 2) < forkP) {
        const side = hash(seed, id * 19 + i, 3) < 0.5 ? -1 : 1;
        walk(x, y, a + side * (0.5 + 0.4 * hash(seed, id, 4)), (len - s) * forkL, d0 + s, 1, id * 7 + i + 1, depth + 1);
      }
    }
  };
  br.forEach(([a, len, w], i) => walk(0.5, 0.5, a, len, 0, w, i + 1, 0));
  const pts = [...px.entries()].map(([k, d]) => [Math.floor(k / 4096) - 1024, (k % 4096) - 1024, d]);
  pts.sort((a, b) => a[2] - b[2]);
  const lips = pts.filter(([x, y, d]) => d < maxLen * 0.6 && !px.has(K(x + 1, y + 1))).map(([x, y, d]) => [x + 1, y + 1, d]);
  c = {
    x: Int16Array.from(pts.map((p) => p[0])),
    y: Int16Array.from(pts.map((p) => p[1])),
    d: Float32Array.from(pts.map((p) => p[2])),
    lx: Int16Array.from(lips.map((p) => p[0])),
    ly: Int16Array.from(lips.map((p) => p[1])),
    ld: Float32Array.from(lips.map((p) => p[2])),
    max: pts.length ? pts[pts.length - 1][2] : 0,
  };
  if (cracks.size > 80) cracks.delete(cracks.keys().next().value as string);
  cracks.set(key, c);
  return c;
}

/** Раскрытая трещина одним холстом: пока бежит — по пикселям, дорисовалась — одним `drawImage`. */
const crackImgs = new WeakMap<Crack, Map<string, { img: HTMLCanvasElement; x: number; y: number }>>();
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
  hit = { img: px.canvas(), x: x0, y: y0 };
  m.set(key, hit);
  return hit;
}

/** Трещина до пути `reach` (пиксели): жёлоб `core`, кромка `lip`. */
function drawCrack(p: Pen, c: Crack, x: number, y: number, reach: number, core: string, lip: string | null, a: number): void {
  if (a <= 0 || reach <= 0) return;
  const ox = Math.floor(x);
  const oy = Math.floor(y);
  if (reach >= c.max) {
    const im = crackImg(c, core, lip);
    p.alpha(a);
    p.img(im.img, ox + im.x, oy + im.y);
    return;
  }
  if (lip) {
    p.col(lip, a * 0.75);
    for (let i = 0; i < c.lx.length && c.ld[i] <= reach; i++) p.dot(ox + c.lx[i], oy + c.ly[i]);
  }
  p.col(core, a);
  for (let i = 0; i < c.x.length && c.d[i] <= reach; i++) p.dot(ox + c.x[i], oy + c.y[i]);
}

/** Звезда трещин: n ветвей вокруг, длины lo…hi, первая — по углу a. */
const starBranches = (seed: number, n: number, a: number, lo: number, hi: number, w = 2): [number, number, number][] =>
  Array.from({ length: n }, (_, i) => [
    a + (i / n) * TAU + (hash(seed, i, 41) - 0.5) * (TAU / n) * 0.6,
    lo + (hi - lo) * hash(seed, i, 42),
    i % 2 ? Math.max(1, w - 1) : w,
  ]);

// ---- Общее для зон ----------------------------------------------------------

/** Лишние поля визуальных зон мозга и зон удара. */
type FxZone = Zone & {
  ang?: number;
  arc?: number;
  w?: number;
  mob?: number;
  q?: number;
  cells?: number[];
  n?: number;
  k?: number;
  vx?: number;
  vy?: number;
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

/** Моб по номеру (чей удар) — с вылазки, что рисуется сейчас. */
const mobOf = (id: number | undefined): Mob | undefined =>
  id === undefined ? undefined : paintSim()?.mobs.find((m) => m.id === id);
const lionNow = (): Mob | undefined => paintSim()?.mobs.find((m) => m.kind === 'f15boss');

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

/** Серп: полоса у внешнего радиуса, толще в середине дуги, тоньше к рогам. */
function crescent(p: Pen, cx: number, cy: number, rOut: number, a0: number, arc: number, th: number, c: string, a: number): void {
  const n = 9;
  p.col(c, a);
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n;
    const t = Math.max(1, th * Math.pow(Math.sin(Math.PI * u), 0.7));
    fillSector(p, cx, cy, Math.max(0, rOut - t), rOut, a0 + (arc * i) / n, a0 + (arc * (i + 1)) / n);
  }
}

/** Откуда идёт удар: от края веера, что выше на экране (удар сверху вниз). */
function sweepOf(a: number, arc: number): { as: number; dir: number } {
  const s0 = Math.sin(a - arc / 2);
  const s1 = Math.sin(a + arc / 2);
  return s0 <= s1 + 1e-6 ? { as: a - arc / 2, dir: 1 } : { as: a + arc / 2, dir: -1 };
}

/** Когда фронт `eOut2` на пути `span` за `T` с проходит точку s. */
const sweepT = (s: number, span: number, T: number) => T * (1 - Math.sqrt(1 - k01(s / span)));

/** Крошка плоти на полу метки дрожит, к удару — подскакивает. */
function hopBits(
  p: Pen,
  sd: number,
  time: number,
  k: number,
  n: number,
  at: (i: number) => [number, number],
  c = C.lipHi,
): void {
  for (let i = 0; i < n; i++) {
    const [gx, gy] = at(i);
    const hop = k > 0.3 ? Math.floor(hash(i, Math.floor(time * 16), sd) * (1 + 3 * k)) : 0;
    if (hop) {
      p.col(C.ink, 0.45);
      p.dot(gx, gy + 1);
    }
    p.col(c, 0.85);
    p.dot(gx, gy - hop);
  }
}

/** Рубец на полу дугой: пиксели по ходу удара (`u` — доля пути), с волной. */
interface Gash {
  x: Int16Array;
  y: Int16Array;
  u: Float32Array;
}
const gashes = new Map<string, Gash>();
function gashOf(seed: number, rg: number, as: number, dir: number, span: number, wide = true): Gash {
  const key = `${seed}|${Math.round(rg)}|${Math.round(as * 100)}|${dir}|${Math.round(span * 100)}|${wide}`;
  let gs = gashes.get(key);
  if (gs) return gs;
  const xs: number[] = [];
  const ys: number[] = [];
  const us: number[] = [];
  const ph1 = hash(seed, 1, 61) * TAU;
  const ph2 = hash(seed, 2, 61) * TAU;
  let lx = 1e9;
  let ly = 1e9;
  for (let s = 0; s <= span; s += 0.4 / rg) {
    const u = s / span;
    const wob = 1.1 * Math.sin(s * 3 + ph1) + 0.6 * Math.sin(s * 8 + ph2);
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
    if (wide && u > 0.12 && u < 0.86) {
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
  if (gashes.size > 40) gashes.delete(gashes.keys().next().value as string);
  gashes.set(key, gs);
  return gs;
}

/**
 * Рана по пикселям: где удар прошёл раньше — там уже потемнела.
 * `when(u)` — когда удар прошёл долю u, `cool` — за сколько остывает.
 */
function drawWound(
  p: Pen,
  gs: Gash,
  ox: number,
  oy: number,
  age: number,
  reveal: number,
  when: (u: number) => number,
  cool: number,
  fade: number,
  colOf: (k: number) => string = woundCol,
  lip: string | null = C.lip,
): void {
  if (fade <= 0 || reveal <= 0) return;
  const X = Math.floor(ox);
  const Y = Math.floor(oy);
  if (lip) {
    p.col(lip, 0.6 * fade);
    for (let i = 0; i < gs.x.length; i++) if (gs.u[i] <= reveal) p.dot(X + gs.x[i] + 1, Y + gs.y[i] + 1);
  }
  const bands = [0.08, 0.2, 0.38, 0.6, 0.82, 1.01];
  for (let b = 0; b < bands.length; b++) {
    const lo = b ? bands[b - 1] : -1;
    p.col(colOf(b ? lo + 0.001 : 0), fade);
    for (let i = 0; i < gs.x.length; i++) {
      const u = gs.u[i];
      if (u > reveal) continue;
      const h = k01((age - when(u)) / cool);
      if (h >= lo && h < bands[b]) p.dot(X + gs.x[i], Y + gs.y[i]);
    }
  }
}

// =============================================================================
// КОГТИ — веер r 3,1 дуга 1,8 от льва; метка встаёт в 0,2 с режима, удар —
// в 0,9 (во второй фазе «КРЫЛЬЕВ» бывает вторая лапа следом). Метка: весь
// веер тёмной кровью; налив от льва к краю с разгоном; три борозды —
// где пройдут когти — процарапываются по ходу будущего взмаха; тень
// занесённой лапы висит у того края, откуда она пойдёт. Контакт: три
// когтя проходят веер дугами за 0,12 с (белое остриё, алое тело, тёмный
// хвост) с проводкой за край; в плоти остаются три рваные раны, остывающие
// от белого к тёмной борозде, кровь брызжет по ходу лапы, у края — пыль.
// =============================================================================

/** Радиусы трёх когтей — доли радиуса веера. */
const CLAW_R = [0.62, 0.76, 0.9];
const CLAW_SWEEP = 0.12;
const CLAW_OVER = 0.5;

registerZonePainter(
  'f15b_claw',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const st = z as Strike;
    const { k, left } = warnOf(st);
    const sig = left < SIG;
    const tk = !reduced() && tick(left);
    const cx = st.x * S;
    const cy = st.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = st.r * S;
    const arc = st.arc ?? 1.8;
    const a = st.ang ?? 0;
    const a0 = a - arc / 2;
    const r0 = S * 0.8;
    const sd = seedOf(st.id);
    // «Куда»: весь веер сразу.
    p.col(C.blood[0], 0.42 + 0.12 * k);
    fillSector(p, cx, cy, r0, R, a0, a0 + arc);
    // «Когда»: налив от льва к краю с разгоном, фронт — серп.
    const rf = r0 + (R - r0) * Math.pow(k, 1.6);
    p.col(sig ? C.blood[2] : C.blood[1], (tk ? 0.66 : 0.44) + 0.12 * k);
    fillSector(p, cx, cy, r0, rf, a0, a0 + arc);
    crescent(p, cx, cy, rf, a0, arc, 1 + 3 * k, sig ? C.ember[4] : C.blood[3], 0.9);
    ring(p, cx, cy, rf, sig ? C.white : C.bloodHi, 0.85, (ang) => inArc(ang, a0, arc));
    // Три борозды процарапываются по ходу будущего взмаха.
    const { as, dir } = sweepOf(a, arc);
    const reach = arc * eOut2(k01(k * 1.2));
    for (let j = 0; j < 3; j++) {
      const rr = R * CLAW_R[j];
      const step = 2.5 / rr;
      for (let s = 0, n = 0; s <= reach; s += step, n++) {
        if (!sig && n % 2) continue;
        const ang = as + dir * s;
        const x = cx + Math.cos(ang) * rr;
        const y = cy + Math.sin(ang) * rr;
        p.col(C.ink, 0.55);
        p.dot(x + 1, y + 1);
        p.col(sig ? C.white : k > 0.6 ? C.ember[4] : C.bloodHi, 0.4 + 0.55 * k);
        p.dot(x, y);
      }
    }
    // Тень занесённой лапы — у края, откуда пойдёт взмах; опускается — темнеет.
    const dk = Math.pow(k, 1.8);
    const pa = as - dir * (0.22 - 0.2 * dk);
    const pr = R * 0.76;
    const pxp = cx + Math.cos(pa) * pr;
    const pyp = cy + Math.sin(pa) * pr;
    const tx = -Math.sin(pa) * dir;
    const ty = Math.cos(pa) * dir;
    p.col(C.shadow, 0.18 + 0.5 * dk);
    lens(p, pxp, pyp, tx, ty, 4 + 2 * dk, 3 + 1.5 * dk, dk < 0.45);
    for (let j = -1; j <= 1; j++) {
      const ox = Math.cos(pa) * j * 3;
      const oy = Math.sin(pa) * j * 3;
      p.dot(pxp + ox + tx * (5 + 2 * dk), pyp + oy + ty * (5 + 2 * dk), 2, 2);
    }
    // Кромка: штрихи бегут от краёв к оси — удар сходится.
    const run = time * (22 + 56 * k);
    sectorRim(
      p,
      cx,
      cy,
      R,
      a0,
      arc,
      r0,
      sig ? (tk ? C.white : C.ember[4]) : k > 0.5 ? C.blood[4] : C.blood[3],
      0.75 + 0.25 * k,
      sig ? undefined : (u) => mod(u - run, 8) < 5,
    );
    hopBits(p, sd, time, k, 12, (i) => {
      const rr = R * (0.35 + 0.6 * hash(sd, i, 5));
      const aa = a0 + arc * hash(sd, i, 6);
      return [cx + Math.cos(aa) * rr, cy + Math.sin(aa) * rr];
    });
  }),
);

registerImpactPainter('f15b_claw', {
  life: 1.5,
  shake: 0.26,
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const cx = rec.x * S;
    const cy = rec.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = (rec.r ?? 3.1) * S;
    const a = rec.ang ?? 0;
    const arc = rec.arc ?? 1.8;
    const { as, dir } = sweepOf(a, arc);
    const sd = rec.seed >>> 0;
    const few = reduced();
    const span = arc + CLAW_OVER;
    const at = (s: number) => as + dir * s;
    const front = span * eOut2(k01(age / CLAW_SWEEP));
    const tail = span * eOut2(k01((age - 0.04) / 0.2));
    const fadeA = 1 - k01((age - 0.12) / 0.12);
    // Смаз всей лапы — бледная полоса за когтями: масса прошла, а не три иглы.
    if (front - tail > 0.02 && fadeA > 0) {
      const lo = Math.min(at(tail), at(front));
      const hi = Math.max(at(tail), at(front));
      p.col(C.flesh[3], 0.3 * fadeA);
      fillSector(p, cx, cy, R * 0.52, R * 0.98, lo, hi);
    }
    // Три когтя: остриё белое, тело алое, хвост тёмный; за краем веера
    // (проводка) коготь тоньше, уходит внутрь и тает.
    for (let j = 0; j < 3 && fadeA > 0; j++) {
      const rj = R * CLAW_R[j];
      const len = front - tail;
      if (len <= 0.02) continue;
      const n = Math.max(2, Math.min(20, Math.ceil(len / 0.07)));
      for (let q = 0; q < n; q++) {
        const s1 = front - (len * q) / n;
        const s0 = front - (len * (q + 1)) / n;
        const u = (q + 0.5) / n;
        const past = k01((s1 - arc) / CLAW_OVER);
        const rout = rj + 1 - past * 5;
        const th = Math.max(1, (u < 0.3 ? 3 : 2) * (1 - past * 0.5));
        const lo = Math.min(at(s0), at(s1));
        const hi = Math.max(at(s0), at(s1));
        if (u < 0.22) {
          p.col(C.white, fadeA);
          fillSector(p, cx, cy, rout - th, rout, lo, hi);
        } else if (u < 0.6) {
          p.col(C.blood[4], 0.95 * fadeA);
          fillSector(p, cx, cy, rout - th, rout, lo, hi);
          p.col(C.bloodHi, 0.9 * fadeA);
          fillSector(p, cx, cy, rout - 1, rout, lo, hi);
        } else {
          p.col(C.blood[2], 0.8 * fadeA * (1 - (u - 0.6) * 1.4));
          fillSector(p, cx, cy, rout - th, rout, lo, hi);
        }
      }
    }
    // Кадр контакта: кромка веера вспыхивает.
    if (age < 0.07) ring(p, cx, cy, R, C.white, 1 - age / 0.07, (ang) => inArc(ang, a - arc / 2, arc), 0.5);
    // Три раны в плоти: раскрываются за когтем, остывают к тёмной борозде.
    const g0 = 0.1;
    const gspan = arc - 0.16;
    const fade = 1 - k01((age - 1.05) / 0.45);
    const reveal = k01((front - g0) / gspan);
    const when = (u: number) => sweepT(g0 + u * gspan, span, CLAW_SWEEP);
    const wounds: Gash[] = [];
    for (let j = 0; j < 3; j++) {
      const gs = gashOf(sd + j * 7, R * CLAW_R[j] - 1, at(g0), dir, gspan * (0.88 + 0.12 * hash(sd, j, 3)), j !== 1);
      wounds.push(gs);
      drawWound(p, gs, cx, cy, age, reveal, when, 0.9, fade);
    }
    // Кровь проступает каплями по ране и стекает на пиксель-два.
    if (age > 0.18 && fade > 0) {
      for (let i = 0; i < (few ? 6 : 14); i++) {
        const gs = wounds[i % 3];
        const pi = Math.floor(hash(sd, i, 71) * gs.x.length);
        const t = age - when(gs.u[pi]) - 0.12 - 0.3 * hash(sd, i, 72);
        if (t < 0) continue;
        const run = Math.min(3, Math.floor(t * 6));
        p.col(C.blood[3], 0.9 * fade);
        p.dot(Math.floor(cx) + gs.x[pi], Math.floor(cy) + gs.y[pi] + 1, 1, run + 1);
        p.col(C.bloodHi, 0.8 * fade);
        p.dot(Math.floor(cx) + gs.x[pi], Math.floor(cy) + gs.y[pi] + 1);
      }
    }
    // Брызги по ходу лапы: рождаются, когда коготь проходит место.
    const pick = (i: number) => {
      const gs = wounds[i % 3];
      return [gs, Math.min(gs.x.length - 1, Math.floor(hash(sd, i, 81) * gs.x.length))] as const;
    };
    drops(
      p,
      sd,
      age,
      few ? 8 : 22,
      (i) => {
        const [gs, j] = pick(i);
        const th = at(g0 + gs.u[j] * gspan) + dir * (Math.PI / 2 - 0.35);
        return [cx + gs.x[j], cy + gs.y[j], th];
      },
      40,
      70,
      25,
      45,
      (i) => {
        const [gs, j] = pick(i);
        return when(gs.u[j]);
      },
      bloodCol,
      C.blood[2],
      [1.0, 1.45],
    );
    // Клочья плоти и пыль у края, куда лапа вышла.
    const ex = at(arc);
    chunks(p, sd + 3, age, cx + Math.cos(ex) * R * 0.85, cy + Math.sin(ex) * R * 0.85, few ? 2 : 5, ex + dir * 1.2, 0.6, 30, 40, 50, 50, [0.9, 1.3], 0.2, 1, () => CLAW_SWEEP * 0.8);
    dust(
      p,
      sd + 5,
      age,
      cx,
      cy,
      few ? 3 : 6,
      0,
      0.35,
      14,
      18,
      1.5,
      5,
      5,
      0.8,
      0,
      0.55,
      (i) => sweepT(((i + 0.5) / 6) * arc, span, CLAW_SWEEP) + 0.02,
      (i) => {
        const th = at(((i + 0.5) / 6) * arc);
        return [cx + Math.cos(th) * R * 0.92, cy + Math.sin(th) * R * 0.92, th + dir * 1.1];
      },
    );
    // Волна воздуха за кромкой.
    if (age < 0.28)
      ring(
        p,
        cx,
        cy,
        R + 3 + 14 * eOut2(age / 0.28),
        C.wind,
        0.7 * (1 - age / 0.28),
        (ang, i) => inArc(ang, a - arc / 2, arc) && hash(i >> 1, sd, 9) > 0.25,
        0.5,
      );
  }),
});

// =============================================================================
// ПРЫЖОК ЛЬВА — присед 0,72 с (метка приземления r 1,9 горит с первого
// кадра приседа) → прыжок 0,55 с → посадка: урон метки, и сразу же — кольцо
// осколков r 3,2 (warn 0,35). Метка: круг тёмной кровью; налив от центра;
// четыре отпечатка лап — куда лягут лапы (по направлению прыжка), из
// бледных становятся чёткими; во второй половине звезда трещин уже бежит,
// пол прогибается. Контакт: кадр-звезда, воронка с рваной кромкой, четыре
// глубоких следа, трещины звездой, ударная волна, клочья, камни и пыль.
// =============================================================================

/** Где лапы относительно центра посадки: [вперёд, вбок] в клетках. */
const PAWS: [number, number][] = [
  [0.95, -0.55],
  [0.95, 0.55],
  [-1.15, -0.5],
  [-1.15, 0.5],
];

/** Отпечаток лапы: подушка и четыре пальца, носком по (ux, uy). */
function paw(p: Pen, x: number, y: number, ux: number, uy: number, big: number, dither: boolean): void {
  lens(p, x, y, ux, uy, 2.2 * big, 2.8 * big, dither);
  const nx = -uy;
  const ny = ux;
  for (let i = 0; i < 4; i++) {
    const s = (i - 1.5) * 1.9 * big;
    const f = (3.6 - Math.abs(i - 1.5) * 0.7) * big;
    const tx = x + ux * f + nx * s;
    const ty = y + uy * f + ny * s;
    if (dither && (Math.floor(tx) + Math.floor(ty)) & 1) continue;
    p.dot(tx - 0.5, ty - 0.5, big > 1.1 ? 2 : 1, big > 1.1 ? 2 : 1);
  }
}

/** Куда прыгает лев: его направление; нет льва — вниз. */
const leapDir = (from?: number) => {
  const m = mobOf(from) ?? lionNow();
  return m ? m.dir : Math.PI / 2;
};

registerZonePainter(
  'f15b_pounce',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const st = z as Strike;
    const { k, left } = warnOf(st);
    const sig = left < SIG;
    const tk = !reduced() && tick(left);
    const cx = st.x * S;
    const cy = st.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = st.r * S;
    const sd = seedOf(st.id);
    const ang = leapDir(st.from);
    const ux = Math.cos(ang);
    const uy = Math.sin(ang);
    // «Куда».
    p.col(C.blood[0], 0.4 + 0.1 * k);
    fillSector(p, cx, cy, 0, R, 0, TAU);
    // «Когда»: налив от центра; второй половиной пол уже прогибается.
    const rf = R * Math.pow(k, 1.5);
    p.col(sig ? C.blood[2] : C.blood[1], (tk ? 0.66 : 0.42) + 0.12 * k);
    fillSector(p, cx, cy, 0, rf, 0, TAU);
    ring(p, cx, cy, rf, sig ? C.white : C.bloodHi, 0.85);
    const sag = k01((k - 0.55) / 0.45);
    if (sag > 0) {
      p.col(C.ink, 0.35 * sag);
      oval(p, cx, cy, R * 0.55 * sag, R * 0.36 * sag, sag < 0.5);
      const ck = crackOf(`pounce|${sd % 997}`, sd, starBranches(sd, 7, ang, S * 1.0, S * 2.0, 2), 0.45, 0.2);
      drawCrack(p, ck, cx, cy, ck.max * 0.4 * sag, sig ? C.blood[4] : C.groove, sig ? C.ember[3] : C.lip, 0.8);
    }
    // Четыре лапы: сюда лягут. Тень лапы с тёмной каймой — читается на крови.
    const crisp = k > 0.45;
    for (const [f, s] of PAWS) {
      const x = cx + (ux * f - uy * s) * S;
      const y = cy + (uy * f + ux * s) * S;
      p.col(C.ink, 0.35 + 0.4 * k);
      paw(p, x + 1, y + 1, ux, uy, 1.25 + 0.2 * k, !crisp);
      p.col(sig ? C.white : crisp ? C.blood[4] : C.bloodHi, 0.35 + 0.6 * k);
      paw(p, x, y, ux, uy, 1.25 + 0.2 * k, !crisp);
    }
    // Кромка: пунктир бежит по кругу, к удару — сплошная.
    const run = Math.floor(time * (14 + 30 * k));
    ring(p, cx, cy, R, sig ? (tk ? C.white : C.ember[4]) : k > 0.5 ? C.blood[4] : C.blood[3], 0.8 + 0.2 * k, sig ? undefined : (_a, i) => mod(i - run, 8) < 5, 0.6);
    hopBits(p, sd, time, k, 10, (i) => {
      const rr = R * Math.sqrt(hash(sd, i, 5));
      const aa = TAU * hash(sd, i, 6);
      return [cx + Math.cos(aa) * rr, cy + Math.sin(aa) * rr * 0.9];
    });
  }),
);

registerImpactPainter('f15b_pounce', {
  life: 1.7,
  shake: 0.45,
  flash: 0.14,
  flashRgb: '255,140,90',
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const cx = rec.x * S;
    const cy = rec.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = (rec.r ?? 1.9) * S;
    const sd = rec.seed >>> 0;
    const few = reduced();
    const ang = leapDir();
    const ux = Math.cos(ang);
    const uy = Math.sin(ang);
    const fade = 1 - k01((age - 1.2) / 0.5);
    // Воронка: продавлена, края вывернуты, через полсекунды — кровь в ней.
    const cr = eOut3(k01(age / 0.08));
    p.col(C.lip, 0.8 * fade);
    oval(p, cx + 1, cy + 1, R * 0.62 * cr, R * 0.42 * cr);
    p.col(C.ink, 0.9 * fade);
    oval(p, cx, cy, R * 0.58 * cr, R * 0.38 * cr);
    const pool = k01((age - 0.35) / 0.6);
    if (pool > 0) {
      p.col(C.blood[1], 0.9 * fade);
      oval(p, cx, cy + 1, R * 0.4 * pool, R * 0.24 * pool);
      p.col(C.blood[3], 0.7 * fade);
      p.dot(cx - R * 0.15 * pool, cy - 1, Math.max(1, Math.round(3 * pool)), 1);
    }
    // Четыре глубоких следа лап.
    p.col(C.groove, fade);
    for (const [f, s] of PAWS) {
      const x = cx + (ux * f - uy * s) * S;
      const y = cy + (uy * f + ux * s) * S;
      paw(p, x, y, ux, uy, 1.1, false);
    }
    // Трещины звездой — тот же рисунок, что у метки, теперь до конца.
    const ck = crackOf(`pounce|${sd % 997}`, sd, starBranches(sd, 7, ang, S * 1.0, S * 2.0, 2), 0.45, 0.2);
    drawCrack(p, ck, cx, cy, ck.max * eOut3(k01(age / 0.16)), C.groove, C.lip, fade);
    const ck2 = crackOf(`pounce2|${sd % 997}`, sd + 9, starBranches(sd + 9, 5, ang + 0.6, S * 1.4, S * 2.6, 2), 0.5, 0.25);
    drawCrack(p, ck2, cx, cy, ck2.max * eOut3(k01((age - 0.03) / 0.22)), C.groove, C.lip, fade);
    // Кадр контакта.
    hitStar(p, cx, cy - 2, age, 0.12, 22, ang + 0.2, C.ember[4]);
    // Ударная волна — рваная, как пыль.
    if (age < 0.34) {
      const k = age / 0.34;
      ring(p, cx, cy, 6 + R * 1.9 * eOut2(k), C.white, 0.9 * (1 - k), (_a, i) => hash(i >> 2, sd, 9) > 0.22, 0.6);
      ring(p, cx, cy, 5 + R * 1.9 * eOut2(k), C.lipHi, 0.7 * (1 - k), (_a, i) => hash(i >> 2, sd, 10) > 0.4);
    }
    // Кровь брызгами, клочья плоти и камни, пыль кольцом.
    drops(
      p,
      sd,
      age,
      few ? 8 : 20,
      (i) => [cx, cy, (i / 20) * TAU],
      40,
      70,
      40,
      60,
      () => 0,
      bloodCol,
      C.blood[2],
      [1.2, 1.7],
    );
    chunks(p, sd + 1, age, cx, cy, few ? 4 : 10, 0, Math.PI, 30, 55, 70, 90, [1.2, 1.7], 0.3, 1);
    chunks(p, sd + 2, age, cx, cy, few ? 3 : 7, ang, 1.4, 25, 40, 60, 80, [1.2, 1.7], 0.5, 0);
    dust(p, sd, age, cx, cy, few ? 5 : 12, 0, Math.PI, 30, 34, 2, 8, 6, 1.2, 0, 0.6);
  }),
});

// =============================================================================
// ОСКОЛКИ КОЛЬЦОМ — сразу за посадкой: кольцо r 3,2 толщиной 0,55, warn
// 0,35. Метка: полоса кольца темнеет; из неё лезут каменные осколки — чем
// ближе удар, тем выше и тем сильнее дрожат; волна от воронки бежит к
// полосе и доходит в миг удара. Контакт: осколки вырываются и летят
// наружу, полоса рвётся короткими трещинами, пыль кольцом.
// =============================================================================

/** Каменный осколок, торчащий из пола: высота h (1…10), вариант v. */
function shardImg(h: number, v: number): HTMLCanvasElement {
  const H = Math.max(1, Math.min(10, Math.round(h)));
  return sprite(70000 + H * 8 + (v & 7), () => {
    const W = 5;
    const p = new Px(W + 2, H + 2);
    const lean = ((v & 3) - 1.5) * 0.35;
    const ramp = CHUNK_PAL[0];
    for (let y = 0; y < H; y++) {
      const t = y / Math.max(1, H);
      const hw = 2.2 * (1 - t) + 0.3;
      const cxx = 3.5 + lean * y * 0.5;
      for (let x = 0; x < W + 2; x++) {
        const d = x + 0.5 - cxx;
        if (Math.abs(d) > hw) continue;
        p.set(x, H - y, d < -0.4 ? ramp[3] : d < 0.6 ? ramp[2] : ramp[1]);
      }
    }
    if (v & 4 && H > 4) p.set(3, H - 1, hx(C.ember[3]));
    p.outline(hx(C.ink));
    return p;
  });
}

registerZonePainter(
  'f15b_shards',
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
    const sd = seedOf(st.id);
    // «Куда»: полоса кольца.
    p.col(C.blood[0], 0.42 + 0.12 * k);
    fillSector(p, cx, cy, R - w, R + w, 0, TAU);
    // «Когда»: полоса наливается, волна от воронки бежит к ней рваным краем.
    p.col(sig ? C.blood[2] : C.blood[1], (tk ? 0.62 : 0.3) + 0.2 * k);
    fillSector(p, cx, cy, R - w * k, R + w * k, 0, TAU);
    const rf = S * 0.9 + (R - w - S * 0.9) * Math.pow(k, 1.3);
    ring(p, cx, cy, rf, C.lip, 0.35 + 0.35 * k, (_a, i) => hash(i >> 2, sd, 3) > 0.35);
    // Внешний край — сплошной, внутренний — редкий.
    const edge = sig ? (tk ? C.white : C.ember[4]) : k > 0.5 ? C.blood[4] : C.blood[3];
    ring(p, cx, cy, R + w, edge, 0.7 + 0.3 * k, undefined, 0.6);
    ring(p, cx, cy, R - w, C.blood[3], 0.5, (_a, i) => i % 4 === 0);
    // Осколки лезут из полосы: выше и беспокойнее к удару.
    const n = 30;
    const grow = Math.pow(k, 1.4);
    for (let i = 0; i < n; i++) {
      const aa = (i / n) * TAU + (hash(sd, i, 7) - 0.5) * 0.15;
      const rr = R + (hash(sd, i, 8) - 0.5) * w * 1.2;
      const h = (1.5 + 5 * hash(sd, i, 9)) * grow;
      if (h < 1) continue;
      const shake = k > 0.6 ? Math.round(Math.sin(time * 50 + i * 2.1) * (k - 0.6) * 2.5) : 0;
      const im = shardImg(h, i + (sd & 7));
      const x = cx + Math.cos(aa) * rr;
      const y = cy + Math.sin(aa) * rr * 0.92;
      p.alpha(1);
      p.img(im, x - 3 + shake, y - im.height + 1);
    }
  }),
);

registerImpactPainter('f15b_shards', {
  life: 1.5,
  shake: 0.24,
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const cx = rec.x * S;
    const cy = rec.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = (rec.r ?? 3.2) * S;
    const w = (rec.w ?? 0.55) * S;
    const sd = rec.seed >>> 0;
    const few = reduced();
    const fade = 1 - k01((age - 1.0) / 0.5);
    // Полоса порвана: короткие трещины поперёк.
    for (let i = 0; i < 14; i++) {
      const aa = (i / 14) * TAU + hash(sd, i, 3) * 0.3;
      const ck = crackOf(`shard|${sd % 499}|${i}`, sd + i, [[aa + (hash(sd, i, 4) - 0.5) * 0.6, w * 1.8, 1]], 0.6, 0.3);
      drawCrack(p, ck, cx + Math.cos(aa) * (R - w * 0.8), cy + Math.sin(aa) * (R - w * 0.8), ck.max * eOut3(k01(age / 0.1)), C.groove, C.lip, fade);
    }
    // Вспышка полосы — кадр контакта.
    if (age < 0.09) {
      ring(p, cx, cy, R, C.white, 1 - age / 0.09, (_a, i) => i % 3 !== 1);
      ring(p, cx, cy, R + w * 0.6, C.ember[4], 1 - age / 0.09, (_a, i) => i % 2 === 0);
    }
    // Осколки вырываются и летят наружу (камень), немного внутрь.
    const n = few ? 10 : 26;
    chunks(p, sd, age, cx, cy, n, 0, 0.12, 30, 50, 90, 110, [1.0, 1.5], 0.35, 0, undefined, (i) => {
      const aa = (i / n) * TAU;
      return [cx + Math.cos(aa) * R, cy + Math.sin(aa) * R * 0.92, aa];
    });
    chunks(p, sd + 1, age, cx, cy, few ? 3 : 8, 0, 0.3, 15, 20, 60, 50, [1.0, 1.5], 0.2, 1, undefined, (i) => {
      const aa = ((i + 0.5) / 8) * TAU;
      return [cx + Math.cos(aa) * R, cy + Math.sin(aa) * R * 0.92, aa + Math.PI];
    });
    dust(p, sd + 2, age, cx, cy, few ? 6 : 14, 0, 0.2, 14, 16, 2, 8, 5, 1.0, 0, 0.7, undefined, (i) => {
      const aa = ((i + 0.3) / 14) * TAU;
      return [cx + Math.cos(aa) * R, cy + Math.sin(aa) * R * 0.92, aa];
    });
  }),
});

// =============================================================================
// УДАРНАЯ ВОЛНА — кольца толщиной 0,45–0,6: кокон лопается (2,6 и 4,6),
// вздрагивает от павшего эха (2,4), крылья раскрываются (3). Метка: полоса
// кольца; фронт волны бежит от льва и доходит до полосы в миг удара, за
// ним — рябь; крошка на полосе подпрыгивает, когда фронт рядом. Контакт —
// по тому, что ударило: кокон — скорлупа и ихор, пробуждение — то же
// сильнее и клочья плёнки, крылья — ветер, каменные перья и пыль.
// =============================================================================

type ShockKind = 'crack' | 'wake' | 'wing';
const shockKind = (): ShockKind => {
  const ph = paintSim()?.boss?.phase ?? 1;
  return ph === 0 ? 'crack' : ph >= 3 ? 'wing' : 'wake';
};

registerZonePainter(
  'f15b_shock',
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
    const sd = seedOf(st.id);
    const wind = shockKind() === 'wing';
    const hot = wind ? C.wind : C.blood[4];
    // «Куда».
    p.col(wind ? C.flesh[2] : C.blood[0], 0.4 + 0.12 * k);
    fillSector(p, cx, cy, R - w, R + w, 0, TAU);
    // «Когда»: фронт волны от льва к полосе, за ним — рябь.
    const r0 = S * 0.6;
    const e = Math.pow(k, 1.35);
    const rf = r0 + (R - r0) * e;
    p.col(sig ? (wind ? C.white : C.blood[2]) : wind ? C.flesh[3] : C.blood[1], (tk ? 0.6 : 0.3) + 0.15 * k);
    fillSector(p, cx, cy, Math.max(0, rf - 3), rf, 0, TAU);
    ring(p, cx, cy, rf, sig ? C.white : hot, 0.95, (_a, i) => hash(i >> 2, sd, 3) > 0.2, 0.5);
    const rr = r0 + (R - r0) * Math.pow(Math.max(0, k - 0.25), 1.35);
    if (rr > r0 + 3) ring(p, cx, cy, rr, wind ? C.windMid : C.blood[3], 0.3, (_a, i) => hash(i >> 1, sd, 5) > 0.45);
    // Края полосы: внешний — пунктир бежит, к удару — сплошной; внутренний — редкий.
    const run = Math.floor(time * (16 + 34 * k));
    const edge = sig ? (tk ? C.white : C.ember[4]) : k > 0.5 ? hot : wind ? C.windMid : C.blood[3];
    ring(p, cx, cy, R + w, edge, 0.75 + 0.25 * k, sig ? undefined : (_a, i) => mod(i - run, 9) < 6, 0.6);
    ring(p, cx, cy, R - w, wind ? C.windMid : C.blood[3], 0.5, (_a, i) => i % 4 === 0);
    // Крошка на полосе: подскакивает, когда фронт подходит.
    const near = k01(1 - (R - rf) / (S * 1.2));
    hopBits(
      p,
      sd,
      time,
      near,
      18,
      (i) => {
        const aa = TAU * hash(sd, i, 6);
        const rr = R + (hash(sd, i, 7) - 0.5) * w * 1.6;
        return [cx + Math.cos(aa) * rr, cy + Math.sin(aa) * rr];
      },
      wind ? C.wind : C.lipHi,
    );
  }),
);

registerImpactPainter('f15b_shock', {
  life: 1.5,
  shake: 0.22,
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const cx = rec.x * S;
    const cy = rec.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = (rec.r ?? 2.6) * S;
    const w = (rec.w ?? 0.55) * S;
    const sd = rec.seed >>> 0;
    const few = reduced();
    const kind = shockKind();
    const wind = kind === 'wing';
    const big = kind === 'wake';
    // Пол вздыбился волной: гребень (свет) и впадина (тень) бегут наружу и
    // гаснут; в первый кадр гребень белый — кадр контакта.
    if (age < 0.45) {
      const k = age / 0.45;
      const rc = R + S * 1.5 * eOut2(k);
      const al = 1 - k;
      ring(p, cx, cy, rc - 2, C.ink, 0.5 * al, (_a, i) => hash(i >> 2, sd, 8) > 0.15);
      ring(p, cx, cy, rc, age < 0.06 ? C.white : wind ? C.wind : C.lipHi, 0.95 * al, (_a, i) => hash(i >> 2, sd, 9) > 0.15, 0.5);
      if (k < 0.6) ring(p, cx, cy, rc + 1, wind ? C.white : C.blood[4], 0.6 * (1 - k / 0.6), (_a, i) => hash(i >> 1, sd, 7) > 0.5);
    }
    // Пол на полосе вздыбился: короткие трещины наружу.
    if (!wind) {
      const fade = 1 - k01((age - 0.9) / 0.5);
      const nC = big ? 12 : 8;
      for (let i = 0; i < nC; i++) {
        const aa = (i / nC) * TAU + hash(sd, i, 3) * 0.4;
        const ck = crackOf(`shock|${sd % 499}|${i}`, sd + i * 3, [[aa, w * 2.2, 1]], 0.55, 0.3);
        drawCrack(p, ck, cx + Math.cos(aa) * (R - w), cy + Math.sin(aa) * (R - w), ck.max * eOut3(k01(age / 0.12)), C.groove, C.lip, fade);
      }
    }
    const at = (n: number, o: number) => (i: number) => {
      const aa = ((i + o) / n) * TAU;
      return [cx + Math.cos(aa) * R, cy + Math.sin(aa) * R * 0.94, aa] as [number, number, number];
    };
    if (wind) {
      // Крылья: ветер — штрихи пылинок наружу, у полосы — редкие клубы и
      // каменная крошка с пола.
      const nm = few ? 12 : 34;
      sparks(p, sd, age, cx, cy, nm, 0, 0.12, 120, 110, 0.55, 0, windCol, (i) => 0.03 * (i % 4), at(nm, 0.37));
      dust(p, sd + 5, age, cx, cy, few ? 4 : 9, 0, 0.2, 50, 40, 1.5, 6, 3, 0.7, 3, 0.45, undefined, at(9, 0.15));
      chunks(p, sd + 1, age, cx, cy, few ? 3 : 8, 0, 0.2, 50, 50, 25, 30, [0.9, 1.4], 0.1, 0, undefined, at(8, 0.6));
      return;
    }
    // Кокон: скорлупа, плёнка, ихор.
    const n = few ? 6 : big ? 14 : 9;
    chunks(p, sd + 1, age, cx, cy, n, 0, 0.25, 30, 50, 70, 90, [1.0, 1.5], big ? 0.35 : 0.2, 2, undefined, at(n, 0.1));
    if (big) chunks(p, sd + 2, age, cx, cy, few ? 3 : 7, 0, 0.3, 20, 40, 60, 60, [1.0, 1.5], 0.2, 1, undefined, at(7, 0.5));
    drops(p, sd + 3, age, few ? 8 : big ? 24 : 14, at(24, 0.3), 30, 50, 30, 40, () => 0, (q) => (q < 0.3 ? C.ember[4] : q < 0.7 ? C.blood[4] : C.blood[3]), C.blood[2], [1.0, 1.5]);
    dust(p, sd + 4, age, cx, cy, few ? 4 : 10, 0, 0.3, 16, 20, 2, 7, 6, 1.0, 0, 0.5, undefined, at(10, 0.5));
  }),
});

// =============================================================================
// КАМЕННЫЕ ШИПЫ — лев встаёт на дыбы (0…0,5 с) и бьёт: восемь кругов r 0,85
// бегут к герою (шаг 1,05, warn 0,45 + i·0,085). Метка: круг тёмной кровью;
// трещина бежит по полу от прошлого шипа к этому — видно, куда идёт
// волна; пол вспучивается, в центре расходится звезда с жаром камня
// внутри; последние 0,2 с — остриё уже показалось. Контакт: шип вырывается
// из пола за 0,07 с (плоть рвётся, кровь, пыль), стоит полсекунды и
// крошится — куски падают с высоты, пыль оседает.
// =============================================================================

/** Каменный шип высоты h (1…26), вариант v (0…3): клин с гранями и тлеющим швом. */
function spikeImg(h: number, v: number): HTMLCanvasElement {
  const H = Math.max(1, Math.min(26, Math.round(h)));
  return sprite(80000 + H * 4 + (v & 3), () => {
    const W = 11;
    const p = new Px(W + 2, H + 3);
    const lean = ((v & 3) - 1.5) * 0.06;
    const ramp = [hx(C.stone[1]), hx(C.stone[2]), hx(C.stone[3]), hx(C.stone[4]), hx(C.stone[5])];
    const base = H + 1;
    for (let y = 0; y <= H; y++) {
      const t = y / Math.max(1, H);
      // Ступенчатый клин: у основания шире, сколы по краям.
      const jag = hash(v, Math.floor(y / 3), 7) * 1.2;
      const hw = Math.max(0.6, (4.6 - jag) * Math.pow(1 - t, 0.85));
      const cxx = 6.5 + lean * y * 6;
      for (let x = 0; x < W + 2; x++) {
        const d = x + 0.5 - cxx;
        if (Math.abs(d) > hw) continue;
        // Две грани: левая на свету, правая в тени; ребро — светлая линия.
        const face = d < -hw * 0.15 ? (d < -hw * 0.7 ? 4 : 3) : d < hw * 0.35 ? 2 : 1;
        p.set(x, base - y, ramp[face]);
      }
    }
    // Тлеющий шов: зигзаг по середине нижних двух третей.
    if (H > 6) {
      let sx = 6.5;
      for (let y = 1; y < H * 0.62; y++) {
        sx += (hash(v, y, 9) - 0.5) * 1.2;
        const c = y < H * 0.25 ? C.ember[3] : C.ember[2];
        p.set(Math.round(sx + lean * y * 6), base - y, hx(c));
      }
    }
    p.outline(hx(C.ink));
    return p;
  });
}

/** Откуда бежит волна шипов: от льва (если он есть). */
const spikeDir = (st: { x: number; y: number }, from?: number) => {
  const m = mobOf(from) ?? lionNow();
  return m ? Math.atan2(st.y - m.y, st.x - m.x) : 0;
};

registerZonePainter(
  'f15b_spike',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const st = z as Strike;
    const { k, left } = warnOf(st);
    const sig = left < SIG;
    const tk = !reduced() && tick(left);
    const cx = st.x * S;
    const cy = st.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = st.r * S;
    const sd = seedOf(st.id);
    const ang = spikeDir(st, st.from);
    const ux = Math.cos(ang);
    const uy = Math.sin(ang);
    // «Куда».
    p.col(C.blood[0], 0.4 + 0.12 * k);
    oval(p, cx, cy, R, R * 0.7);
    // Трещина бежит от прошлого шипа сюда — куда идёт волна.
    const gap = LION.spikeGap * S;
    const ck = crackOf(`spikeRun|${sd % 997}`, sd, [[ang, gap, 2]], 0.4, 0.15, 0.3);
    drawCrack(p, ck, cx - ux * gap, cy - uy * gap, ck.max * eOut2(k01(k * 1.25)), k > 0.7 ? C.ember[2] : C.blood[1], C.lip, 0.9);
    // «Когда»: налив, пол вспучивается кольцом.
    const rf = R * Math.pow(k, 1.4);
    p.col(sig ? C.blood[2] : C.blood[1], (tk ? 0.66 : 0.42) + 0.12 * k);
    oval(p, cx, cy, rf, rf * 0.7);
    if (k > 0.2) ring(p, cx, cy, R * (0.25 + 0.45 * k), C.lip, 0.45 * k, (_a, i) => i % 2 === 0);
    // Звезда в центре: жар камня рвётся наружу.
    if (k > 0.45) {
      const sk = crackOf(`spikeStar|${sd % 997}`, sd + 3, starBranches(sd + 3, 5, ang, 3, 7, 1), 0.5, 0);
      drawCrack(p, sk, cx, cy, sk.max * k01((k - 0.45) / 0.55), sig ? C.ember[4] : C.ember[2], null, 0.9);
    }
    // Остриё показалось.
    if (k > 0.8) {
      const im = spikeImg(1 + 5 * k01((k - 0.8) / 0.2), sd & 3);
      const jig = sig ? Math.round(Math.sin(time * 60) * 0.6) : 0;
      p.alpha(1);
      p.img(im, cx - 7 + jig, cy - im.height + 2);
    }
    // Кромка.
    const edge = sig ? (tk ? C.white : C.ember[4]) : k > 0.5 ? C.blood[4] : C.blood[3];
    p.col(C.ink, 0.6);
    const pts = circle(R);
    for (let i = 0; i < pts.x.length; i++) {
      if (!sig && i % 3 === 2) continue;
      const x = cx + pts.x[i];
      const y = cy + pts.y[i] * 0.7;
      p.col(C.ink, 0.5);
      p.dot(x + 1, y + 1);
      p.col(edge, 0.8 + 0.2 * k);
      p.dot(x, y);
    }
    hopBits(p, sd, time, k, 6, (i) => {
      const aa = TAU * hash(sd, i, 6);
      const rr = R * Math.sqrt(hash(sd, i, 5));
      return [cx + Math.cos(aa) * rr, cy + Math.sin(aa) * rr * 0.7];
    });
  }),
);

registerImpactPainter('f15b_spike', {
  life: 1.6,
  shake: 0.1,
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const cx = rec.x * S;
    const cy = rec.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const sd = rec.seed >>> 0;
    const few = reduced();
    const v = sd & 3;
    const H = S * (1.15 + 0.35 * hash(sd, 1, 1));
    const ang = spikeDir(rec);
    const fade = 1 - k01((age - 1.15) / 0.45);
    // Рваная плоть у основания.
    p.col(C.lip, 0.8 * fade);
    oval(p, cx + 1, cy + 1, 6, 3.4);
    p.col(C.ink, 0.95 * fade);
    oval(p, cx, cy, 5.5, 3);
    const sk = crackOf(`spikeStar|${sd % 997}`, sd + 3, starBranches(sd + 3, 5, ang, 5, 10, 1), 0.5, 0.1);
    drawCrack(p, sk, cx, cy, sk.max * eOut3(k01(age / 0.08)), C.groove, C.lip, fade);
    // Шип: вырывается за 0,07 с, стоит, с 0,55 с крошится сверху вниз.
    const up = eOut3(k01(age / 0.07));
    const crumble = eIn2(k01((age - 0.55) / 0.32));
    const h = H * up * (1 - crumble);
    if (h >= 1) {
      const im = spikeImg(h, v);
      // В миг выхода — на пиксель выше (удар), потом садится.
      const jolt = age < 0.1 ? -1 : 0;
      p.alpha(1);
      p.img(im, cx - 7, cy - im.height + 2 + jolt);
    }
    // Кадр контакта: на острие.
    hitStar(p, cx, cy - H * up, age, 0.1, 10, 0.3, C.ember[4]);
    // Плоть и кровь рвутся у основания.
    drops(p, sd, age, few ? 5 : 12, (i) => [cx, cy, (i / 12) * TAU], 30, 40, 50, 60, () => 0, bloodCol, C.blood[2], [1.1, 1.6]);
    chunks(p, sd + 1, age, cx, cy, few ? 2 : 5, 0, Math.PI, 20, 30, 60, 60, [1.1, 1.6], 0.2, 1);
    dust(p, sd + 2, age, cx, cy, few ? 3 : 6, 0, Math.PI, 18, 16, 2, 6, 5, 0.85, 0, 0.55);
    // Крошится: куски падают с высоты шипа и отскакивают.
    if (age > 0.55) {
      const n = few ? 5 : 10;
      const a = fade;
      for (let i = 0; i < n; i++) {
        const born = 0.55 + (i / n) * 0.3;
        const t = age - born;
        if (t < 0) continue;
        const z0 = H * (1 - i / n) * 0.9;
        const th = TAU * hash(sd, i, 51);
        const v0 = 12 + 26 * hash(sd, i, 52);
        const f = fall(t, z0, 20 + 30 * hash(sd, i, 53), 430);
        const gx = cx + Math.cos(th) * v0 * f.h;
        const gy = cy + Math.sin(th) * v0 * f.h * 0.7;
        const sz = hash(sd, i, 54) < 0.4 ? 3 : 2;
        if (f.air) {
          p.col(C.ink, 0.3 * a);
          p.dot(gx - 1, gy + 1, sz, 1);
        }
        const im = chunkImg(sz, f.air ? Math.floor(t * 18 + i) & 3 : i & 3, 0);
        p.alpha(a);
        p.img(im, gx - im.width / 2, gy - f.z - im.height / 2);
      }
      dust(p, sd + 4, age - 0.6, cx, cy - 4, few ? 2 : 5, -Math.PI / 2, 1.4, 10, 12, 2, 6, 6, 0.8, 0, 0.7);
    }
  }),
});

// =============================================================================
// ПИКЕ — лев висит над залом (прицел 1,0 с), линия через весь зал до стены
// шириной 1,05 (поверх темноты), потом пике за 0,4 с вдоль неё. Метка:
// полоса тёмной кровью с первого кадра (за телами — не лежит на них);
// налив бежит от льва к стене и доходит в миг удара; шевроны «туда»
// бегут всё быстрее; края пунктиром, последние 0,2 с — белые. Контакт:
// голова пике идёт по полосе с той же скоростью, что лев: за ней — струи
// ветра, клин воздуха, пыль и клочья вздымает по обе стороны.
// =============================================================================

registerZonePainter(
  'f15b_swoop',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const st = z as Strike;
    const { k, left } = warnOf(st);
    const sig = left < SIG;
    const tk = !reduced() && tick(left);
    const cx = st.x * S;
    const cy = st.y * S;
    const p = new Pen(g, px, py, cx, cy);
    p.occ = occOf(S);
    const a = st.ang ?? 0;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const nx = -uy;
    const ny = ux;
    const L = st.r * S;
    const hw = (st.w ?? 1.05) * S;
    const l0 = S * 0.6;
    // «Куда»: вся полоса.
    p.col(C.blood[0], 0.34 + 0.1 * k);
    fillLane(p, cx, cy, ux, uy, l0, L, hw);
    // «Когда»: налив от льва к стене.
    const lf = l0 + (L - l0) * Math.pow(k, 1.3);
    p.col(sig ? C.blood[2] : C.blood[1], (tk ? 0.6 : 0.36) + 0.12 * k);
    fillLane(p, cx, cy, ux, uy, l0, lf, hw);
    p.col(sig ? C.white : C.bloodHi, 0.9);
    fillLane(p, cx, cy, ux, uy, lf - 2, lf, hw);
    // Шевроны «туда»: бегут всё быстрее.
    const sp = 16;
    const off = mod(time * (50 + 170 * k), sp);
    for (let s = l0 + off; s < L - 4; s += sp) {
      const al = (0.25 + 0.55 * k) * (s < lf ? 1 : 0.55);
      for (const side of [-1, 1]) {
        const x0 = cx + ux * s + nx * hw * 0.6 * side;
        const y0 = cy + uy * s + ny * hw * 0.6 * side;
        const x1 = cx + ux * (s + 6) ;
        const y1 = cy + uy * (s + 6);
        p.lineS(x0, y0, x1, y1, sig ? C.white : C.wind, al, 0.5);
      }
    }
    // Края пунктиром бегут от льва; к удару — сплошные.
    const edge = sig ? (tk ? C.white : C.ember[4]) : k > 0.5 ? C.blood[4] : C.blood[3];
    const run = time * (30 + 90 * k);
    for (let s = l0; s < L; s += 1) {
      if (!sig && mod(s - run, 10) >= 6) continue;
      for (const side of [-1, 1]) {
        const ex = cx + ux * s + nx * hw * side;
        const ey = cy + uy * s + ny * hw * side;
        p.col(C.ink, 0.55);
        p.dot(ex + nx * side, ey + ny * side);
        p.col(edge, 0.75 + 0.25 * k);
        p.dot(ex, ey);
      }
    }
    // Конец полосы — планка: дальше пике не идёт.
    p.lineS(cx + ux * L + nx * hw, cy + uy * L + ny * hw, cx + ux * L - nx * hw, cy + uy * L - ny * hw, edge, 0.85, 0.6);
    p.occ = null;
  }),
);

registerImpactPainter('f15b_swoop', {
  life: 1.4,
  shake: 0.3,
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
    const hw = (rec.w ?? 1.05) * S;
    const sd = rec.seed >>> 0;
    const few = reduced();
    const T = LION.swoop;
    const head = L * k01(age / T);
    // Когда голова пике проходит точку s полосы.
    const passT = (s: number) => (k01(s / L) * T);
    // Кадр контакта: по оси полосы — белая нить, по краям — алые.
    if (age < 0.08) {
      const al = 1 - age / 0.08;
      p.col(C.white, al);
      fillLane(p, cx, cy, ux, uy, S * 0.6, L, 1);
      p.col(C.blood[4], 0.8 * al);
      for (const side of [-1, 1]) fillLane(p, cx + nx * side * hw, cy + ny * side * hw, ux, uy, S * 0.6, L, 0.6);
    }
    // Струи ветра за головой: тянутся назад, тают.
    const nS = 9;
    for (let j = 0; j < nS; j++) {
      const o = ((j + 0.5) / nS - 0.5) * 2 * hw * 0.9;
      const lag = 6 + 26 * hash(sd, j, 1);
      const len = 24 + 30 * hash(sd, j, 2);
      const end = Math.min(head, L) - lag * (1 - Math.abs(o) / hw) * 0.4;
      const tailS = Math.max(0, end - len);
      const life = k01((age - T) / 0.3);
      const al = 0.75 * (1 - life);
      if (al <= 0 || end <= tailS) continue;
      for (let s = tailS; s < end; s += 1) {
        const q = (s - tailS) / (end - tailS);
        if (q < 0.4 && Math.floor(s) % 2) continue;
        p.col(q > 0.75 ? C.white : C.wind, al * (0.35 + 0.65 * q));
        p.dot(cx + ux * s + nx * o, cy + uy * s + ny * o);
      }
    }
    // Клин воздуха у головы — как волна от носа лодки.
    if (age < T + 0.05) {
      const hxp = cx + ux * head;
      const hyp = cy + uy * head;
      for (const side of [-1, 1]) {
        p.lineS(hxp, hyp, hxp - ux * 18 + nx * side * (hw + 8), hyp - uy * 18 + ny * side * (hw + 8), C.wind, 0.85, 0.5);
        p.lineS(hxp - ux * 6, hyp - uy * 6, hxp - ux * 22 + nx * side * (hw + 4), hyp - uy * 22 + ny * side * (hw + 4), C.windMid, 0.6, 0);
      }
    }
    // Пыль и клочья вздымает по обе стороны, когда голова проходит:
    // пылинки штрихами наискось назад, редкие клубы.
    const nM = few ? 10 : Math.min(40, Math.max(12, Math.round(L / 6)));
    sparks(
      p,
      sd + 4,
      age,
      cx,
      cy,
      nM,
      0,
      0.25,
      70,
      80,
      0.55,
      0,
      windCol,
      (i) => passT(((i + 0.5) / nM) * L),
      (i) => {
        const s = ((i + 0.5) / nM) * L;
        const side = i % 2 ? 1 : -1;
        return [cx + ux * s + nx * side * hw * 0.5, cy + uy * s + ny * side * hw * 0.5, Math.atan2(ny * side - uy * 0.6, nx * side - ux * 0.6)];
      },
    );
    const nD = few ? 4 : Math.min(14, Math.max(5, Math.round(L / 18)));
    dust(
      p,
      sd,
      age,
      cx,
      cy,
      nD,
      0,
      0.35,
      26,
      30,
      2,
      6,
      4,
      0.85,
      3,
      0.4,
      (i) => passT(((i + 0.5) / nD) * L),
      (i) => {
        const s = ((i + 0.5) / nD) * L;
        const side = i % 2 ? 1 : -1;
        return [cx + ux * s + nx * side * hw * 0.7, cy + uy * s + ny * side * hw * 0.7, Math.atan2(ny * side, nx * side)];
      },
    );
    chunks(
      p,
      sd + 1,
      age,
      cx,
      cy,
      few ? 4 : 12,
      0,
      0.4,
      30,
      40,
      40,
      50,
      [1.0, 1.4],
      0.15,
      1,
      (i) => passT(((i + 0.5) / 12) * L),
      (i) => {
        const s = ((i + 0.5) / 12) * L;
        const side = i % 2 ? -1 : 1;
        return [cx + ux * s + nx * side * hw * 0.5, cy + uy * s + ny * side * hw * 0.5, Math.atan2(ny * side, nx * side)];
      },
    );
  }),
});

// =============================================================================
// ПЕРЬЯ-МИНЫ — за пике лев роняет шесть перьев по сторонам следа (r 0,75,
// warn 0,85). Метка: перо падает сверху и втыкается в пол (пыльца у
// основания), под ним — круг взрыва; кончик пера тлеет и мигает всё чаще,
// по полу от него расходятся раскалённые трещинки; последние 0,2 с —
// добела. Контакт (поверх темноты): перо рвётся — вспышка, клуб огня,
// каменные щепки и искры, на полу — выжженное пятно.
// =============================================================================

/** Каменное перо, воткнутое в пол наискось: наклон t (−2…2), жар `hot` (0…3). */
function quillImg(t: number, hot: number): HTMLCanvasElement {
  return sprite(90000 + (t + 2) * 8 + hot, () => {
    const p = new Px(13, 17);
    const lean = t * 0.32;
    const base: [number, number] = [6.5, 15.5];
    const ux = Math.sin(lean);
    const uy = -Math.cos(lean);
    const tip = hot === 3 ? hx(C.white) : hot === 2 ? hx(C.ember[4]) : hot === 1 ? hx(C.ember[3]) : hx(C.ember[2]);
    for (let s = 0; s <= 13; s++) {
      const x = base[0] + ux * s;
      const y = base[1] + uy * s;
      // Опахало: шире к середине, левая сторона на свету.
      const w = s < 3 ? 0 : 2.6 * Math.sin(((s - 3) / 10.5) * Math.PI);
      for (let q = -w; q <= w; q += 0.5) {
        const xx = x - uy * q;
        const yy = y + ux * q;
        p.set(Math.round(xx), Math.round(yy), q < -0.6 ? hx(C.stone[4]) : q > 0.8 ? hx(C.stone[2]) : hx(C.stone[3]));
      }
      p.set(Math.round(x), Math.round(y), s > 9 ? tip : s > 6 && hot ? hx(C.ember[2]) : hx(C.stone[5]));
    }
    p.outline(hx(C.ink));
    return p;
  });
}

registerZonePainter(
  'f15b_quill',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const st = z as Strike;
    const { k, left } = warnOf(st);
    const sig = left < SIG;
    const tk = !reduced() && tick(left);
    const cx = st.x * S;
    const cy = st.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = st.r * S;
    const sd = seedOf(st.id);
    // «Куда»: круг взрыва.
    p.col(C.blood[0], 0.38 + 0.12 * k);
    oval(p, cx, cy, R, R * 0.72);
    const rf = R * Math.pow(k, 1.5);
    p.col(sig ? C.blood[2] : C.blood[1], (tk ? 0.66 : 0.4) + 0.14 * k);
    oval(p, cx, cy, rf, rf * 0.72);
    // Раскалённые трещинки от основания.
    if (k > 0.35) {
      const ck = crackOf(`quill|${sd % 997}`, sd, starBranches(sd, 5, 0.4, 4, R * 0.9, 1), 0.5, 0);
      drawCrack(p, ck, cx, cy, ck.max * k01((k - 0.35) / 0.65), sig ? C.ember[4] : k > 0.7 ? C.ember[3] : C.ember[2], null, 0.9);
    }
    // Кромка пунктиром, к удару — сплошная.
    const run = Math.floor(time * (12 + 30 * k));
    const pts = circle(R);
    const edge = sig ? (tk ? C.white : C.ember[4]) : k > 0.5 ? C.ember[3] : C.blood[3];
    for (let i = 0; i < pts.x.length; i++) {
      if (!sig && mod(i - run, 7) >= 4) continue;
      const x = cx + pts.x[i];
      const y = cy + pts.y[i] * 0.72;
      p.col(C.ink, 0.5);
      p.dot(x + 1, y + 1);
      p.col(edge, 0.85);
      p.dot(x, y);
    }
    // Перо падает сверху и втыкается: первые 0,09 с.
    const drop = k01(st.t / 0.09);
    const lean = Math.round((hash(sd, 1, 1) - 0.5) * 4);
    const blink = sig ? 3 : Math.sin(time * (8 + 46 * k)) > 0.2 ? (k > 0.6 ? 2 : 1) : 0;
    const im = quillImg(Math.max(-2, Math.min(2, lean)), blink);
    const zq = (1 - eIn2(drop)) * 26;
    if (drop < 1) {
      p.col(C.ink, 0.3 + 0.4 * drop);
      p.dot(cx - 2, cy, 5, 1);
    }
    p.alpha(1);
    p.img(im, cx - 6.5, cy - 15.5 - zq);
    // Втыкается — пыльца у основания.
    const t = st.t - 0.09;
    if (t >= 0 && t < 0.35) dust(p, sd, t, cx, cy, 3, -Math.PI / 2, 1.6, 10, 10, 1.5, 4, 3, 0.35, 0, 0.6);
    // Жар у кончика светит на пол.
    if (blink >= 2) {
      p.col(C.ember[3], 0.35 + 0.3 * k);
      p.dot(cx - 1, cy, 3, 1);
    }
  }),
);

registerImpactPainter('f15b_quill', {
  life: 1.1,
  shake: 0.12,
  flash: 0.08,
  flashRgb: '255,150,60',
  above: true,
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const cx = rec.x * S;
    const cy = rec.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const sd = rec.seed >>> 0;
    const few = reduced();
    const R = (rec.r ?? 0.75) * S;
    const occ = occOf(S);
    // Выжженное пятно — на полу, за телами не лежит.
    p.occ = occ;
    const sc = scorchImg(R * 0.9, 0);
    p.alpha(0.75 * (1 - k01((age - 0.6) / 0.5)));
    p.img(sc, cx - sc.width / 2, cy - sc.height / 2);
    p.occ = null;
    // Вспышка и клуб огня.
    hitStar(p, cx, cy - 6, age, 0.1, 13, 0.4, C.ember[4]);
    if (age < 0.22) {
      const k = age / 0.22;
      ring(p, cx, cy - 2, 4 + R * 1.4 * eOut2(k), C.ember[4], 0.9 * (1 - k), (_a, i) => hash(i >> 1, sd, 3) > 0.25, 0);
    }
    dust(p, sd, age, cx, cy - 4, few ? 3 : 6, -Math.PI / 2, Math.PI, 20, 26, 2, 7, 9, 0.55, 2, 0.95);
    dust(p, sd + 1, age - 0.12, cx, cy - 8, few ? 2 : 4, -Math.PI / 2, 1.2, 8, 10, 2, 6, 14, 0.9, 1, 0.6);
    // Каменные щепки и искры.
    chunks(p, sd + 2, age, cx, cy, few ? 4 : 9, 0, Math.PI, 40, 60, 60, 80, [0.7, 1.1], 0.15, 0);
    sparks(p, sd + 3, age, cx, cy - 4, few ? 6 : 14, 0, Math.PI, 50, 70, 0.5, 60);
  }),
});

// =============================================================================
// ПЕРЬЯ — каменные перья веером (по 5): в полёте вертятся (опахало
// мелькает плашмя-ребром), за ними тают два силуэта и тлеющие искры.
// Контакт: перо бьётся вдребезги — щепки назад, искры, пыльца.
// =============================================================================

/** Перо в полёте: направление d (0…15), фаза мелькания f (0…3). */
function featherShot(d: number, f: number): Sprite {
  const key = 95000 + d * 4 + f;
  let img = sprites.get(key);
  if (!img) {
    const p = new Px(26, 26);
    const a = (d / 16) * TAU;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const flut = [1, 0.62, 0.22, 0.62][f];
    const side = f === 1 ? 1 : f === 3 ? -1 : 0;
    const draw = (q: Px, ox: number, oy: number, al: number, ghost: boolean) => {
      for (let s = -6; s <= 6; s += 0.5) {
        const x = 13 + ox + ux * s;
        const y = 13 + oy + uy * s;
        const u = (s + 6) / 12;
        const w = 2.4 * Math.sin(Math.PI * Math.min(1, u * 1.15)) * flut;
        for (let o = -w; o <= w; o += 0.5) {
          const xx = x - uy * (o + side * 0.5);
          const yy = y + ux * (o + side * 0.5);
          const c = ghost ? hx(C.stone[3], Math.round(al * 255)) : hx(o < -0.5 ? C.stone[4] : o > 0.8 ? C.stone[2] : C.stone[3]);
          q.set(Math.round(xx), Math.round(yy), c);
        }
        if (!ghost) q.set(Math.round(x), Math.round(y), s > 3.5 ? hx(s > 5 ? C.ember[4] : C.ember[3]) : hx(C.stone[5]));
      }
    };
    // След: два тающих силуэта и искры позади.
    draw(p, -ux * 9, -uy * 9, 0.18, true);
    draw(p, -ux * 4.5, -uy * 4.5, 0.38, true);
    const q = new Px(26, 26);
    draw(q, 0, 0, 1, false);
    q.outline(hx(C.ink));
    for (let i = 0; i < q.data.length; i += 4) if (q.data[i + 3]) p.data.set(q.data.subarray(i, i + 4), i);
    const sw = [0, 1, 0, -1][f];
    p.set(Math.round(13 - ux * 11 - uy * sw), Math.round(13 - uy * 11 + ux * sw), hx(C.ember[3]));
    p.set(Math.round(13 - ux * 13 + uy * sw), Math.round(13 - uy * 13 - ux * sw), hx(C.ember[2], 200));
    img = p.canvas();
    sprites.set(key, img);
  }
  return { img, ax: 13, ay: 13 };
}

registerShotPainter('f15b_feather', (s: Shot, time: number) => {
  const a = Math.atan2(s.vy, s.vx);
  const d = mod(Math.round((a / TAU) * 16), 16);
  const f = mod(Math.floor(time * 18 + s.id * 1.7), 4);
  return featherShot(d, f);
});

registerImpactPainter('f15b_feather', {
  life: 0.8,
  shake: 0.04,
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const cx = rec.x * S;
    const cy = rec.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const sd = rec.seed >>> 0;
    const few = reduced();
    const back = Math.atan2(-(rec.vy ?? 0), -(rec.vx ?? 1));
    hitStar(p, cx, cy - 3, age, 0.07, 7, back, C.ember[4]);
    chunks(p, sd, age, cx, cy, few ? 3 : 6, back, 1.1, 20, 40, 40, 50, [0.5, 0.8], 0, 0);
    sparks(p, sd + 1, age, cx, cy - 3, few ? 3 : 7, back, 1.2, 40, 50, 0.4, 40);
    dust(p, sd + 2, age, cx, cy, 2, back, 1, 8, 8, 1.5, 4, 3, 0.4, 0, 0.6);
  }),
});

// =============================================================================
// ПОРЫВ — лев бьёт крыльями вперёд: конус r 5,6 дуга 1,5, метка встаёт в
// 0,1 с, удар в 0,85 (сносит в опасную четверть). Метка: конус бледной
// плотью — воздух, а не рана; налив от льва; крылья поднимаются и тянут
// воздух НА себя: пылинки ползут к льву всё быстрее, перед ударом
// замирают; кромка пунктиром. Контакт: стена ветра уходит к краю и за
// него — струи, пыль и клочья сдувает наружу, у краёв закручиваются вихри.
// =============================================================================

registerZonePainter(
  'f15b_gust',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const st = z as Strike;
    const { k, left } = warnOf(st);
    const sig = left < SIG;
    const tk = !reduced() && tick(left);
    const cx = st.x * S;
    const cy = st.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = st.r * S;
    const arc = st.arc ?? 1.5;
    const a = st.ang ?? 0;
    const a0 = a - arc / 2;
    const r0 = S * 0.9;
    const sd = seedOf(st.id);
    // «Куда»: бледная плоть.
    p.col(C.flesh[2], 0.4 + 0.1 * k);
    fillSector(p, cx, cy, r0, R, a0, a0 + arc);
    const rf = r0 + (R - r0) * Math.pow(k, 1.6);
    p.col(sig ? C.flesh[4] : C.flesh[3], (tk ? 0.55 : 0.32) + 0.12 * k);
    fillSector(p, cx, cy, r0, rf, a0, a0 + arc);
    crescent(p, cx, cy, rf, a0, arc, 1 + 2 * k, sig ? C.white : C.wind, 0.85);
    // Вдох крыльев: пылинки ползут к льву, перед ударом — замирают.
    if (!sig) {
      const pull = 0.35 + 1.4 * k;
      for (let i = 0; i < 22; i++) {
        const aa = a0 + arc * hash(sd, i, 3);
        const ph = mod(hash(sd, i, 4) - time * pull * (0.6 + 0.5 * hash(sd, i, 5)), 1);
        const rr = r0 + (R - r0) * ph;
        const len = 2 + 4 * k;
        p.lineS(cx + Math.cos(aa) * rr, cy + Math.sin(aa) * rr, cx + Math.cos(aa) * (rr + len), cy + Math.sin(aa) * (rr + len), C.wind, (0.3 + 0.5 * k) * Math.sin(Math.PI * ph), 0.4);
      }
    }
    const run = time * (20 + 50 * k);
    sectorRim(p, cx, cy, R, a0, arc, r0, sig ? (tk ? C.white : C.wind) : k > 0.5 ? C.wind : C.windMid, 0.7 + 0.3 * k, sig ? undefined : (u) => mod(u + run, 9) < 5);
  }),
);

registerImpactPainter('f15b_gust', {
  life: 1.5,
  shake: 0.3,
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const cx = rec.x * S;
    const cy = rec.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = (rec.r ?? 5.6) * S;
    const arc = rec.arc ?? 1.5;
    const a = rec.ang ?? 0;
    const a0 = a - arc / 2;
    const sd = rec.seed >>> 0;
    const few = reduced();
    const RR = R * 1.3;
    const FT = 0.32;
    const front = RR * eOut2(k01(age / FT));
    // Когда фронт проходит радиус r.
    const passT = (r: number) => FT * (1 - Math.sqrt(1 - k01(r / RR)));
    // Стена ветра: струи вразнобой у фронта — у каждой свой отступ, длина
    // и изгиб; тают к краю.
    const fa = 1 - k01((age - 0.2) / 0.28);
    if (fa > 0) {
      const n = few ? 10 : 26;
      for (let i = 0; i < n; i++) {
        const aa = a0 + arc * ((i + hash(sd, i, 1)) / n);
        const len = 6 + 18 * hash(sd, i, 2);
        const e = front - 22 * hash(sd, i, 3);
        if (e - len < S * 0.8 || hash(sd, i, 5) < 0.2) continue;
        const bend = (hash(sd, i, 4) - 0.5) * 0.12;
        const steps = Math.ceil(len / 2);
        for (let q = 0; q < steps; q++) {
          const r1 = e - len + (q / steps) * len;
          const th = aa + bend * (q / steps);
          const head = q / steps;
          p.col(C.ink, 0.3 * fa);
          p.dot(cx + Math.cos(th) * r1 + 1, cy + Math.sin(th) * r1 + 1);
          p.col(head > 0.75 ? C.white : C.wind, fa * (0.25 + 0.7 * head));
          p.dot(cx + Math.cos(th) * r1, cy + Math.sin(th) * r1);
        }
      }
    }
    // Пылинки и редкие клубы сдувает наружу, когда фронт проходит.
    const nM = few ? 10 : 30;
    sparks(
      p,
      sd + 6,
      age,
      cx,
      cy,
      nM,
      0,
      0.08,
      110,
      120,
      0.6,
      0,
      windCol,
      (i) => passT(R * (0.2 + 0.75 * hash(sd, i, 17))),
      (i) => {
        const aa = a0 + arc * hash(sd, i, 16);
        const rr = R * (0.2 + 0.75 * hash(sd, i, 17));
        return [cx + Math.cos(aa) * rr, cy + Math.sin(aa) * rr, aa];
      },
    );
    const nD = few ? 3 : 7;
    dust(
      p,
      sd,
      age,
      cx,
      cy,
      nD,
      0,
      0.15,
      60,
      50,
      2,
      7,
      3,
      0.8,
      3,
      0.45,
      (i) => passT(R * (0.3 + 0.65 * hash(sd, i, 7))),
      (i) => {
        const aa = a0 + arc * hash(sd, i, 6);
        const rr = R * (0.3 + 0.65 * hash(sd, i, 7));
        return [cx + Math.cos(aa) * rr, cy + Math.sin(aa) * rr, aa];
      },
    );
    chunks(
      p,
      sd + 1,
      age,
      cx,
      cy,
      few ? 4 : 12,
      0,
      0.2,
      70,
      70,
      20,
      30,
      [1.0, 1.5],
      0.1,
      1,
      (i) => passT(R * (0.25 + 0.6 * hash(sd, i, 9))),
      (i) => {
        const aa = a0 + arc * hash(sd, i, 8);
        const rr = R * (0.25 + 0.6 * hash(sd, i, 9));
        return [cx + Math.cos(aa) * rr, cy + Math.sin(aa) * rr, aa];
      },
    );
    // Вихри у краёв конуса: закручиваются и тают.
    for (const side of [-1, 1]) {
      const t = age - passT(R * 0.7);
      if (t < 0 || t > 0.6) continue;
      const ea = a + (side * arc) / 2;
      const ex = cx + Math.cos(ea) * R * 0.75;
      const ey = cy + Math.sin(ea) * R * 0.75;
      const al = 0.8 * (1 - t / 0.6);
      for (let s = 0; s < 1.6 * Math.PI; s += 0.18) {
        const r = 2 + s * 2.2;
        const th = s * side + t * 12 * side + ea;
        p.col(C.wind, al * (s / (1.6 * Math.PI)));
        p.dot(ex + Math.cos(th) * r, ey + Math.sin(th) * r * 0.7);
      }
    }
  }),
});

// @@MEMORY@@
