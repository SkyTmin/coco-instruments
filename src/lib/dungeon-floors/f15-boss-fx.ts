// Этаж 15, босс «Хозяин подземелья» — техники: метки ударов владыки, контакт,
// звёздная пыль, колодцы тяготения, планеты короны, звездопад, затмение,
// сверхновая, память прошлых этажей (четверти) и приёмы эха. Тело владыки
// рисует `f15-boss-art.ts`, здесь — всё, что он делает с МИРОМ.
//
// Как устроено:
//   • метка удара (`registerZonePainter` для strike) — язык астролябии
//     (`astroMark`, `bandAstro`): «куда» с первого кадра — вся фигура удара
//     ночью на полу, кромка с рисками, что идут по кругу; «когда» — фронт
//     налива доходит до края ровно в миг урона; последние 0,2 с — «тик-тик»
//     и белая кромка, заливка гуще, но не слепит. У каждого приёма свой
//     предвестник: ладонь-созвездие встаёт из руки, звёзды вспыхивают там,
//     куда придёт удар из тьмы, тень падающего метеора, дуга полёта планеты;
//   • шов с телом: ладони — из `lordHandPx`, планеты — от `crownSpot` (по
//     той же кривой, что у мозга); владыку, эхо, осколки и хранителей
//     рисует `f15-boss-art.ts`, здесь их нет;
//   • контакт (`registerImpactPainter`) — кадр-звезда в миг урона, потом
//     след: отпечаток ладони гаснет, кристаллы планет звенят осколками,
//     звёздная пыль клубами оседает; тряска — по силе удара;
//   • сцены без своего strike (созвездие выходит из плаща, звезда эха
//     возвращается на плащ, затмение, сверхновая, финал, прицел осколка) —
//     визуальные зоны `f15b_fx*` (`api.vfx` мозга, без урона и статусов);
//   • всё светящееся (метеоры, лучи сверхновой, когти из тьмы) — поверх
//     темноты; то, что в этом слое лежит на полу, за телами, стоящими
//     ближе к камере, ложится на треть (`occOf`).
//
// Ни плоти, ни крови (запрет владельца): след удара — светящийся шрам
// звёздного света в полу, брызги — фиолетовая туманность.
//
// Пиксели — на СЕТКЕ МИРА (`Pen`): эффект не «плывёт» по полу при движении
// камеры. Частицы детерминированы — позиция считается от зерна и возраста.

import { Px } from '../dungeon-art';
import {
  frameLRU,
  IMPACT_PAINTERS,
  paintSim,
  registerImpactPainter,
  registerMobWarm,
  registerShotPainter,
  registerZonePainter,
  ZONE_PAINTERS,
} from '../dungeon-paint';
import type { ImpactRec, Sprite } from '../dungeon-paint';
import type { Mob, Shot, Strike, Zone } from '../dungeon-sim';
import { F15B_MARK } from './f15-boss';
import { crownSpot, f15bView, LORD } from './f15-boss-brains';
import type { F15BState } from './f15-boss-brains';
import { F15B_SKY, lordHandPx } from './f15-boss-art';

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
/** Зерно из номера удара/зоны: у зон `api.vfx` номер отрицательный. */
const seedOf = (id: number | undefined) => (id ?? 0) >>> 0;

/** Последние 0,2 с перед уроном — ясный сигнал «сейчас». */
const SIG = 0.2;
/** «Тик-тик»: две вспышки в последние 0,2 с (0,20…0,15 и 0,10…0,05). */
const tick = (left: number) => left < SIG && Math.floor(left / 0.05) % 2 === 1;

// ---- Палитра: ночь, звёздный шрам, золото, угли, память, созвездия ------------
// Ни плоти, ни крови: `neb` — фиолетовая туманность брызг, `scarCol` —
// остывание светящегося шрама в полу.

const C = {
  ink: '#05040f',
  groove: '#03020a',
  dusk: ['#0a0920', '#100e30', '#171442', '#201b56', '#2b246c'],
  lip: '#6a5ab0',
  lipHi: '#a898e0',
  neb: ['#0a0620', '#24104a', '#46207a', '#9a5ad0', '#c890f0'],
  nebHi: '#ecd4ff',
  ember: ['#4a0a04', '#9a2a08', '#e05010', '#ff8a2a', '#ffd080', '#fff4c8'],
  stone: ['#08071a', '#14122e', '#22204a', '#3a3870', '#5c5a9a', '#8c8ac4'],
  gold: ['#6e4a14', '#dcaa3c', '#ffd866', '#fff0b8'],
  wind: '#e8eaff',
  windMid: '#a8acd8',
  white: '#fffaf0',
  shadow: '#000000',
  ghost: ['#100e30', '#2b246c', '#4c42a4', '#9a8ae0', '#ffd866', '#fff6d0'],
  ice: ['#0a1a34', '#163a6a', '#2a64a4', '#4c9ad6', '#8cd0f4', '#d0f4ff', '#ffffff'],
  night: ['#05040f', '#0a0920', '#100e30', '#171442', '#201b56', '#2b246c', '#3a3088', '#4c42a4'],
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
/** Капля туманности по доле жизни: светлая → сиреневая → тёмная. */
const nebCol = (k: number) =>
  k < 0.2 ? C.nebHi : k < 0.55 ? C.neb[4] : k < 0.8 ? C.neb[3] : C.neb[2];
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
/** Свежий звёздный шрам по остыванию: белый → сиреневый → тёмная борозда. */
const scarCol = (k: number) =>
  k < 0.08
    ? C.white
    : k < 0.2
      ? C.nebHi
      : k < 0.38
        ? C.neb[4]
        : k < 0.6
          ? C.neb[3]
          : k < 0.82
            ? C.neb[2]
            : C.neb[1];

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
 * Тела вылазки, что сейчас на экране: владыка, эхо, осколки, хранители,
 * герой. Размеры — по кадрам их рисовальщиков, с запасом внутрь: лучше
 * чуть меньше спрятать, чем лечь метке герою на грудь.
 */
function occOf(S: number): Box[] {
  const sim = paintSim();
  const out: Box[] = [];
  if (!sim) return out;
  const hero = sim.hero;
  for (const m of sim.mobs) {
    if (m.mode === 'dying' && m.t > 0.4) continue;
    const lift = Math.round((m.data.z ?? 0) * 3) * 5;
    let hw: number;
    let h: number;
    if (m.kind === 'f15boss') {
      // Герой за владыкой — рисовальщик тела делает его полупрозрачным:
      // тогда он ничего не заслоняет, иначе вырезанный прямоугольник
      // просвечивал бы сквозь него рамкой. Владыка парит: колокол плаща
      // ~1,3 клетки в стороны, до ядра-лица — около 5 клеток.
      if (hero.y < m.y - 0.2 && m.y - hero.y < 5.2 && Math.abs(hero.x - m.x) < 2.2) continue;
      if (m.mode === 'f15l_sleep') continue;
      hw = 1.25 * S;
      h = 5 * S;
    } else if (m.kind === 'f15b_keeper') {
      hw = 0.5 * S;
      h = 3.4 * S;
    } else if (m.kind === 'f15b_shard') {
      continue;
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
  /** Строки развёртки (эхо — запись): ≥ 0 — каждая третья строка пропущена со сдвигом. */
  scan = -1;
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
    if (this.scan >= 0) {
      for (let yy = y; yy < y + h; yy++) {
        if (mod(yy + this.scan, 3) === 0) continue;
        if (this.occ) this.run(yy, x, x + w - 1);
        else this.g.fillRect(x + this.qx, yy + this.qy, w, 1);
      }
      return;
    }
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
    // Заслонённое не вырезается дочиста, а ложится на треть: прямоугольник
    // тела шире рисунка, и пустая рамка вокруг героя читалась чёрной дырой.
    const ga = this.g.globalAlpha;
    for (const [c0, c1] of cuts) {
      if (c0 > lo) this.g.fillRect(lo + this.qx, Y + this.qy, Math.min(xb, c0 - 1) - lo + 1, 1);
      const h0 = Math.max(lo, c0);
      const h1 = Math.min(xb, c1);
      if (h1 >= h0) {
        this.g.globalAlpha = ga * 0.3;
        this.g.fillRect(h0 + this.qx, Y + this.qy, h1 - h0 + 1, 1);
        this.g.globalAlpha = ga;
      }
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
            if (b >= a)
              this.g.drawImage(c, a, yy, b - a + 1, 1, X + a + this.qx, Yr + this.qy, b - a + 1, 1);
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

const NO_RUN = -1e9;

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
    // Начало строки: x бывает отрицательным, поэтому «нет строки» — не −1.
    let run = NO_RUN;
    for (let x = -R; x <= R + 1; x++) {
      let inside = false;
      if (x <= R) {
        const dx = x0 + x + 0.5 - cx;
        const dy = y0 + y + 0.5 - cy;
        const a = (dx * ux + dy * uy) / l;
        const b = (-dx * uy + dy * ux) / w;
        inside = a * a + b * b <= 1 && !(dither && (x0 + x + y0 + y) & 1);
      }
      if (inside && run === NO_RUN) run = x;
      if (!inside && run !== NO_RUN) {
        if (dither) for (let q = run; q < x; q++) p.rect(x0 + q, y0 + y, 1, 1);
        else p.rect(x0 + run, y0 + y, x - run, 1);
        run = NO_RUN;
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
    let run = NO_RUN;
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
      if (on && run === NO_RUN) run = x;
      if (!on && run !== NO_RUN) {
        p.rect(x0 + run, y0 + y, x - run, 1);
        run = NO_RUN;
      }
    }
  }
}

/** Кадр контакта: белая звезда, внутри — цветная, сжимается за `T`. */
function hitStar(
  p: Pen,
  x: number,
  y: number,
  age: number,
  T: number,
  r: number,
  rot: number,
  inner: string,
): void {
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
  [hx('#1a1640'), hx('#2e2a60'), hx('#4a4688')], // 0 — звёздная пыль пола, чуть светлее карты
  [hx('#0a0607'), hx('#1c1416'), hx('#302427')], // 1 — копоть и дым
  [hx('#3a0e0c'), hx('#7a2414'), hx('#c05024')], // 2 — горячий пепел, огонь
  [hx('#7a6a70'), hx('#b8a8ac'), hx('#efe6e4')], // 3 — ветер крыльев
  [hx('#1c2850'), hx('#3c5a9e'), hx('#8ab8e0')], // 4 — призрачный туман эха
  [hx('#2a5a68'), hx('#6aa8b8'), hx('#d0f4f8')], // 5 — брызги и пар бездны
  [hx('#1a3a10'), hx('#3e7020'), hx('#84b440')], // 6 — яд топи
  [hx('#24104a'), hx('#46207a'), hx('#7a4ab0')], // 7 — фиолетовая туманность
  [hx('#5a4a30'), hx('#a08a5a'), hx('#e8d8a0')], // 8 — золотая пыль
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
        const edge =
          !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
        if (edge && R > 3 && (x + y) & 1) continue;
        const l = ((x + 0.5 - c) * -0.55 + (y + 0.5 - c) * -0.83) / Math.max(1, R);
        p.set(x, y, l > 0.32 ? hi : l > -0.5 ? mid : sh);
      }
    return p;
  });
}

const CHUNK_PAL: RGBA[][] = [
  [hx('#0a0920'), hx('#2a2650'), hx('#4c4890'), hx('#8c88c8')], // 0 — плита звёздной карты
  [hx('#1a0c34'), hx('#46207a'), hx('#9a5ad0'), hx('#ecd4ff')], // 1 — фиолетовый кристалл
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

/** Тёмное пятно радиуса r: выжженное (0), лужа туманности (1), копоть призрака (2). */
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
    p.img(
      im,
      ox + Math.cos(th) * d - im.width / 2,
      oy + Math.sin(th) * d - z - im.height / 2,
      oy + Math.sin(th) * d,
    );
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
 * снизу-справа (свет сверху-слева), как трещина в камне.
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
  };
  if (cracks.size > 80) cracks.delete(cracks.keys().next().value as string);
  cracks.set(key, c);
  return c;
}

/** Раскрытая трещина одним холстом: пока бежит — по пикселям, дорисовалась — одним `drawImage`. */
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
  tx?: number;
  ty?: number;
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
const lordNow = (): Mob | undefined => paintSim()?.mobs.find((m) => m.kind === 'f15boss');

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

/** Откуда идёт удар: от края веера, что выше на экране (удар сверху вниз). */
function sweepOf(a: number, arc: number): { as: number; dir: number } {
  const s0 = Math.sin(a - arc / 2);
  const s1 = Math.sin(a + arc / 2);
  return s0 <= s1 + 1e-6 ? { as: a - arc / 2, dir: 1 } : { as: a + arc / 2, dir: -1 };
}

/** Когда фронт `eOut2` на пути `span` за `T` с проходит точку s. */
const sweepT = (s: number, span: number, T: number) => T * (1 - Math.sqrt(1 - k01(s / span)));

/** Крошка звёздного пола в метке дрожит, к удару — подскакивает. */
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
function gashOf(
  seed: number,
  rg: number,
  as: number,
  dir: number,
  span: number,
  wide = true,
): Gash {
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
function drawScar(
  p: Pen,
  gs: Gash,
  ox: number,
  oy: number,
  age: number,
  reveal: number,
  when: (u: number) => number,
  cool: number,
  fade: number,
  colOf: (k: number) => string = scarCol,
  lip: string | null = C.lip,
): void {
  if (fade <= 0 || reveal <= 0) return;
  const X = Math.floor(ox);
  const Y = Math.floor(oy);
  if (lip) {
    p.col(lip, 0.6 * fade);
    for (let i = 0; i < gs.x.length; i++)
      if (gs.u[i] <= reveal) p.dot(X + gs.x[i] + 1, Y + gs.y[i] + 1);
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
// ПОДЗЕМЕЛЬЕ ПОМНИТ — четверти арены по очереди становятся прошлыми этажами:
// СЗ лава, СВ бездна, ЮЗ зеркала, ЮВ круги гидры.
//
// МЕТКА ЧЕТВЕРТИ (`f15b_qwarn`, живёт до пробуждения + 0,2 с). Пока ждёт —
// по краю четверти еле видная кайма; за 1,6 с до перемены проступает
// ровно то, чем станет пол (см. `regionOf`): где ляжет лава — раскалённые
// жилы в корке, где встанет вода — тёмная рябь, где поднимутся зеркала —
// стеклянные ромбы, где загорятся круги — руны; над этим — живое: угли,
// пузыри, блики, споры. Мерцает всё чаще; в миг перемены четверть
// вспыхивает своим цветом и гаснет. Перемену — всплеск лавы, волну
// воды, звон стекла, вспышку кругов — рисует `f15b_fxqwake` (мозг).
// =============================================================================

type QuadV = F15BState['quads'][number];
const MK = F15B_MARK;
const QUAD_HEX = ['#ff6a20', '#30d0d8', '#c8dcff', '#70f080'];

/** Сглаженный шум 0…1 по пикселям — жилы лавы, рябь воды. */
function vn(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi, seed) * (1 - u) + hash(xi + 1, yi, seed) * u;
  const b = hash(xi, yi + 1, seed) * (1 - u) + hash(xi + 1, yi + 1, seed) * u;
  return a * (1 - v) + b * v;
}

interface Region {
  img: HTMLCanvasElement;
  flash: HTMLCanvasElement;
  x0: number;
  y0: number;
}
const regions = new WeakMap<number[], Region>();

/**
 * Предпросмотр четверти одним холстом (строится один раз на бой): каждая
 * клетка — тем, чем станет (`qd.to`), остальная четверть — лёгкий налёт
 * её цвета; по краю четверти — кайма. `flash` — та же форма, залитая
 * цветом, для вспышки перемены.
 */
/** Холст четверти строится по 14 клеток за вызов: целиком — 20–40 мс разом. */
interface RegionBuild {
  p: Px;
  f: Px;
  set: Set<number>;
  i: number;
  x0: number;
  y0: number;
}
const building = new WeakMap<number[], RegionBuild>();

function regionOf(qd: QuadV, cells: number[], W: number, S: number): Region | null {
  let r = regions.get(cells);
  if (r) return r;
  if (!cells.length) return null;
  let bd = building.get(cells);
  if (!bd) {
    let x0 = 1e9;
    let y0 = 1e9;
    let x1 = -1e9;
    let y1 = -1e9;
    for (const i of cells) {
      x0 = Math.min(x0, i % W);
      x1 = Math.max(x1, i % W);
      y0 = Math.min(y0, Math.floor(i / W));
      y1 = Math.max(y1, Math.floor(i / W));
    }
    const pw = (x1 - x0 + 1) * S;
    const ph = (y1 - y0 + 1) * S;
    bd = { p: new Px(pw, ph), f: new Px(pw, ph), set: new Set(cells), i: 0, x0, y0 };
    building.set(cells, bd);
    return null;
  }
  const p = bd.p;
  const f = bd.f;
  const set = bd.set;
  const qc = hx(QUAD_HEX[qd.q] ?? '#ffffff');
  const tint = hx(QUAD_HEX[qd.q] ?? '#ffffff', 34);
  const flashC = hx(QUAD_HEX[qd.q] ?? '#ffffff', 150);
  const sd = 31 + qd.q * 17;
  const end = Math.min(cells.length, bd.i + 14);
  for (; bd.i < end; bd.i++) {
    const i = cells[bd.i];
    const cxl = i % W;
    const cyl = Math.floor(i / W);
    const ox = (cxl - bd.x0) * S;
    const oy = (cyl - bd.y0) * S;
    const to = qd.to.get(i);
    const mk = to ? to[1] : -1;
    for (let v = 0; v < S; v++)
      for (let u = 0; u < S; u++) {
        const X = cxl * S + u;
        const Y = cyl * S + v;
        let c: RGBA | null = tint;
        if (mk === MK.lava) {
          // Корка с раскалёнными жилами: изолинии шума — трещины.
          const n = vn(X / 6, Y / 6, sd) * 0.7 + vn(X / 2.5, Y / 2.5, sd + 1) * 0.3;
          const d = Math.abs(n - 0.5);
          c =
            d < 0.035
              ? hx(C.lava[5])
              : d < 0.075
                ? hx(C.lava[3])
                : d < 0.11
                  ? hx(C.lava[1], 220)
                  : hx(C.crust[1 + (hash(X >> 1, Y >> 1, sd) < 0.3 ? 1 : 0)], 230);
        } else if (mk === MK.crust) {
          const n = hash(X >> 1, Y >> 1, sd + 2);
          c = n < 0.025 ? hx(C.ember[2]) : hx(n < 0.5 ? C.crust[1] : C.crust[2], 200);
        } else if (mk === MK.abyss) {
          const n = vn(X / 5, Y / 5, sd + 3);
          const band = Math.sin(X * 0.32 + Y * 0.12 + n * 7);
          c =
            band > 0.9
              ? hx(C.sea[4], 220)
              : band > 0.6
                ? hx(C.sea[3], 230)
                : hx(n < 0.45 ? C.sea[0] : C.sea[1], 240);
          if (hash(X, Y, sd + 4) < 0.01) c = hx(C.sea[5]);
        } else if (mk === MK.shallow) {
          const band = Math.sin(X * 0.3 + Y * 0.1 + vn(X / 5, Y / 5, sd + 3) * 7);
          c = band > 0.8 ? hx(C.sea[4], 150) : hx(C.sea[2], 130);
        } else if (mk === MK.mirror) {
          // Стеклянный столб сверху: ромб со светом сверху-слева.
          const du = u + 0.5 - S / 2;
          const dv = v + 0.5 - S / 2;
          const m = Math.abs(du) + Math.abs(dv);
          if (m < S * 0.44)
            c =
              m > S * 0.36
                ? hx(C.glass[0])
                : du + dv < -3
                  ? hx(C.glass[4])
                  : du + dv < 2
                    ? hx(C.glass[3])
                    : hx(C.glass[2]);
          else c = hx(C.glass[1], 90);
        } else if (mk === MK.mirrorFloor) {
          c =
            (u + v) % 5 === 0 || (u - v + 32) % 7 === 0 ? hx(C.glass[2], 130) : hx(C.glass[0], 70);
        } else if (mk === MK.circleA || mk === MK.circleB) {
          const du = u + 0.5 - S / 2;
          const dv = v + 0.5 - S / 2;
          const d = Math.hypot(du, dv);
          const ang = Math.atan2(dv, du);
          if (Math.abs(d - 6.4) < 0.7) c = hx(C.bog[4]);
          else if (Math.abs(d - 3.6) < 0.6 && Math.floor((ang / TAU) * 12 + 12) % 2 === 0)
            c = hx(C.bog[5]);
          else if (d < 6) c = hx(C.bog[1], 200);
          else c = hx(C.bog[2], 120);
        } else if (mk === MK.bog) {
          const n = vn(X / 4, Y / 4, sd + 5);
          c = n > 0.62 ? hx(C.bog[2], 230) : hx(C.bog[1], 200);
          if (hash(X, Y, sd + 6) < 0.012) c = hx(C.bog[4]);
        }
        // Кайма по краю четверти.
        const edge =
          (u < 2 && !set.has(i - 1)) ||
          (u >= S - 2 && !set.has(i + 1)) ||
          (v < 2 && !set.has(i - W)) ||
          (v >= S - 2 && !set.has(i + W));
        if (edge) c = (u + v) & 1 ? qc : hx(C.ink);
        p.set(ox + u, oy + v, c);
        f.set(ox + u, oy + v, flashC);
      }
  }
  if (bd.i < cells.length) return null;
  r = { img: p.canvas(), flash: f.canvas(), x0: bd.x0 * S, y0: bd.y0 * S };
  building.delete(cells);
  regions.set(cells, r);
  return r;
}

/** Кайма четверти: отрезки [x, y, w, h] по краю клеток (кеш на массив клеток). */
const quadEdges = new WeakMap<number[], number[]>();
function edgesOf(cells: number[], W: number, S: number): number[] {
  const hit = quadEdges.get(cells);
  if (hit) return hit;
  const set = new Set(cells);
  const out: number[] = [];
  for (const i of cells) {
    const x = (i % W) * S;
    const y = Math.floor(i / W) * S;
    if (!set.has(i - 1)) out.push(x, y, 1, S);
    if (!set.has(i + 1)) out.push(x + S - 1, y, 1, S);
    if (!set.has(i - W)) out.push(x, y, S, 1);
    if (!set.has(i + W)) out.push(x, y + S - 1, S, 1);
  }
  quadEdges.set(cells, out);
  return out;
}

/** Клетки четверти нужного вида — для частиц (не больше 40). */
const pickCells = (qd: QuadV, kind: 'pool' | 'mirror' | 'circle' | 'all'): number[] => {
  const list =
    kind === 'pool'
      ? qd.pools
      : kind === 'mirror'
        ? qd.mirrors
        : kind === 'circle'
          ? qd.circles.flat()
          : qd.area;
  if (list.length <= 40) return list;
  const out: number[] = [];
  for (let i = 0; i < 40; i++) out.push(list[Math.floor((i * list.length) / 40)]);
  return out;
};

/** Живое над будущим полом: угли, пузыри, блики, споры — `n` штук. */
function quadLife(
  p: Pen,
  qd: QuadV,
  W: number,
  S: number,
  time: number,
  k: number,
  al: number,
): void {
  const kind = qd.kind;
  const list = pickCells(
    qd,
    kind === 'lava' || kind === 'abyss' ? 'pool' : kind === 'mirror' ? 'mirror' : 'circle',
  );
  if (!list.length) return;
  const n = Math.round(list.length * (0.3 + 0.9 * k));
  for (let j = 0; j < n; j++) {
    const i = list[j % list.length];
    const bx = (i % W) * S + S * hash(i, j, 1);
    const by = Math.floor(i / W) * S + S * hash(i, j, 2);
    const per = 0.8 + 0.8 * hash(i, j, 3);
    const ph = mod(time / per + hash(i, j, 4), 1);
    if (kind === 'lava') {
      p.col(emberCol(0.2 + 0.8 * ph), al * (1 - ph));
      p.dot(bx + Math.sin(ph * 6 + j) * 1.5, by - ph * 12);
    } else if (kind === 'abyss') {
      if (ph < 0.75) continue;
      p.col(C.sea[5], al * 0.9);
      const r = ph < 0.88 ? 1 : 2;
      p.dot(bx - r, by);
      p.dot(bx + r, by);
      p.dot(bx, by - r);
      p.dot(bx, by + r);
    } else if (kind === 'mirror') {
      if (ph > 0.25) continue;
      const s = ph < 0.12 ? 3 : 2;
      p.col(C.white, al);
      p.dot(bx - s, by);
      p.dot(bx - s, by, s * 2 + 1, 1);
      p.dot(bx, by - s, 1, s * 2 + 1);
    } else {
      p.col(ph < 0.5 ? C.bog[5] : C.bog[4], al * (1 - ph));
      p.dot(bx + Math.sin(ph * 5 + j) * 2, by - ph * 10);
    }
  }
}

registerZonePainter(
  'f15b_qwarn',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const zz = z as FxZone;
    const s = paintSim();
    const v = f15bView(s);
    if (!s || !v || !zz.cells) return;
    const qd = v.quads[zz.q ?? 0];
    if (!qd) return;
    const W = s.world.w;
    const p = new Pen(g, px, py, zz.x * S, zz.y * S);
    // Картинка будущего пола строится по кускам заранее.
    const reg = regionOf(qd, zz.cells, W, S);
    const wakeIn = zz.life - zz.t - 0.2;
    if (wakeIn >= 1.6) {
      // Ждёт: дышит только кайма по краю четверти. Прежде здесь каждый кадр
      // ложилась вся картинка четверти на 0,12 прозрачности — четыре
      // картинки по 160×160 на кадр, самое дорогое в фазе.
      const e = edgesOf(zz.cells, W, S);
      p.col(QUAD_HEX[mod(zz.q ?? 0, 4)], 0.3 + 0.15 * Math.sin(time * 2 + (zz.q ?? 0)));
      for (let j = 0; j < e.length; j += 4) p.rect(e[j], e[j + 1], e[j + 2], e[j + 3]);
      return;
    }
    if (!reg) return;
    // Перемена: четверть вспыхивает своим цветом и гаснет.
    if (wakeIn < 0) {
      const u = k01(-wakeIn / 0.2);
      p.alpha(0.85 * (1 - u));
      p.img(reg.flash, reg.x0, reg.y0);
      return;
    }
    const k = k01(1 - wakeIn / 1.6);
    const sig = wakeIn < SIG;
    const tk = !reduced() && tick(wakeIn);
    const on = !reduced() && Math.sin(time * (5 + 16 * k)) > 0.3;
    p.alpha(0.2 + 0.6 * k + (on ? 0.08 : 0) + (tk ? 0.15 : 0));
    p.img(reg.img, reg.x0, reg.y0);
    if (sig) {
      p.alpha(tk ? 0.4 : 0.15);
      p.img(reg.flash, reg.x0, reg.y0);
    }
    quadLife(p, qd, W, S, time, k, 0.5 + 0.5 * k);
  }),
);

// Пробуждение четверти — перемена пола (зона мозга, поверх темноты):
// лава всплёскивает из жил, вода бьёт фонтанами, зеркала встают со
// звоном и блеском, круги загораются кольцами.
registerZonePainter(
  'f15b_fxqwake',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number) => {
    const zz = z as FxZone;
    const s = paintSim();
    const v = f15bView(s);
    if (!s || !v) return;
    const qd = v.quads[zz.q ?? 0];
    if (!qd) return;
    const W = s.world.w;
    const age = zz.t;
    const p = new Pen(g, px, py, zz.x * S, zz.y * S);
    const sd = seedOf(zz.id) + 7;
    const few = reduced();
    const kind = qd.kind;
    const list = pickCells(
      qd,
      kind === 'lava' || kind === 'abyss' ? 'pool' : kind === 'mirror' ? 'mirror' : 'circle',
    );
    if (!list.length) return;
    const at = (i: number): [number, number, number] => {
      const c = list[i % list.length];
      return [
        (c % W) * S + S * (0.2 + 0.6 * hash(sd, i, 1)),
        Math.floor(c / W) * S + S * (0.3 + 0.5 * hash(sd, i, 2)),
        TAU * hash(sd, i, 3),
      ];
    };
    const born = (i: number) => 0.18 * hash(sd, i, 4);
    if (kind === 'lava') {
      drops(
        p,
        sd,
        age,
        few ? 10 : 28,
        at,
        10,
        30,
        70,
        90,
        born,
        (q) => heatCol(q * 0.8),
        C.crust[2],
        [0.7, 1.0],
      );
      dust(
        p,
        sd + 1,
        age,
        0,
        0,
        few ? 3 : 8,
        -Math.PI / 2,
        0.6,
        6,
        6,
        2,
        7,
        16,
        0.9,
        1,
        0.55,
        born,
        (i) => at(i + 3),
      );
    } else if (kind === 'abyss') {
      drops(
        p,
        sd,
        age,
        few ? 10 : 30,
        at,
        10,
        30,
        60,
        100,
        born,
        (q) => (q < 0.3 ? C.sea[6] : q < 0.7 ? C.sea[5] : C.sea[4]),
        C.sea[3],
        [0.6, 0.9],
      );
      dust(
        p,
        sd + 1,
        age,
        0,
        0,
        few ? 3 : 8,
        -Math.PI / 2,
        0.8,
        8,
        8,
        2,
        7,
        10,
        0.8,
        5,
        0.5,
        born,
        (i) => at(i + 5),
      );
    } else if (kind === 'mirror') {
      chunks(
        p,
        sd,
        age,
        0,
        0,
        few ? 6 : 16,
        0,
        Math.PI,
        20,
        40,
        60,
        80,
        [0.6, 0.95],
        0.1,
        4,
        born,
        at,
      );
      for (let i = 0; i < Math.min(list.length, 6); i++) {
        const [x, y] = at(i);
        hitStar(p, x, y - 10, age - i * 0.04, 0.16, 9, 0.3, C.glass[3]);
      }
    } else {
      for (let i = 0; i < Math.min(list.length, 4); i++) {
        const [x, y] = at(i);
        const t = age - i * 0.05;
        if (t < 0 || t > 0.6) continue;
        const k = t / 0.6;
        ring(
          p,
          x,
          y,
          4 + 20 * eOut2(k),
          k < 0.2 ? C.white : C.bog[4],
          0.9 * (1 - k),
          (_a, j) => j % 3 !== 2,
          0.4,
        );
      }
      drops(
        p,
        sd,
        age,
        few ? 8 : 20,
        at,
        8,
        20,
        40,
        60,
        born,
        (q) => (q < 0.4 ? C.bog[5] : C.bog[4]),
        C.bog[2],
        [0.6, 0.95],
      );
    }
  }),
);

// =============================================================================
// ИЗВЕРЖЕНИЕ — четверть лавы, у героя (r 1,15, warn 1, жжёт). Метка: корка
// вспучивается — в ней звезда трещин, раскалённых всё ярче (от тёмно-
// красного к белому), в центре разгорается пузырь, из трещин сочится дым и
// плюются капли; кромка пунктиром. Контакт (поверх темноты): столб
// лавовых сгустков вверх — остывают на лету и падают каплями, что гаснут
// на полу; в середине — светящаяся воронка, дым и пепел, искры.
// =============================================================================

registerZonePainter(
  'f15b_erupt',
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
    // «Куда»: тёмная корка кругом.
    p.col(C.crust[0], 0.55);
    oval(p, cx, cy, R, R * 0.75);
    // Под коркой разгорается: пятно жара от центра.
    const rf = R * Math.pow(k, 1.4);
    p.col(sig ? C.lava[3] : C.lava[1], (tk ? 0.8 : 0.45) + 0.2 * k);
    oval(p, cx, cy, rf, rf * 0.75);
    if (k > 0.3) {
      p.col(k > 0.75 ? C.lava[5] : C.lava[4], 0.6 + 0.4 * k);
      oval(p, cx, cy - 1, R * 0.32 * k, R * 0.22 * k);
    }
    // Звезда трещин в корке — раскаляется.
    const ck = crackOf(
      `erupt|${sd % 997}`,
      sd,
      starBranches(sd, 6, 0.3, R * 0.55, R * 0.95, 2),
      0.5,
      0.25,
    );
    drawCrack(
      p,
      ck,
      cx,
      cy,
      ck.max * eOut2(k01(k * 1.3)),
      heatCol(sig ? 0 : 1 - k),
      C.crust[3],
      0.95,
    );
    // Дым из трещин и капли, что плюются к удару.
    dust(
      p,
      sd,
      mod(time, 1.2),
      cx,
      cy,
      3,
      -Math.PI / 2,
      0.5,
      4,
      4,
      1.5,
      4 + 2 * k,
      10,
      1.1,
      1,
      0.35 + 0.25 * k,
      (i) => i * 0.4,
      (i) => [
        cx + (hash(sd, i, 9) - 0.5) * R,
        cy + (hash(sd, i, 10) - 0.5) * R * 0.6,
        -Math.PI / 2,
      ],
    );
    if (k > 0.5) {
      const n = Math.floor(2 + 6 * k);
      for (let i = 0; i < n; i++) {
        const per = 0.35 + 0.3 * hash(sd, i, 11);
        const ph = mod(time / per + hash(sd, i, 12), 1);
        const x = cx + (hash(sd, i, 13) - 0.5) * R * 1.2;
        const y = cy + (hash(sd, i, 14) - 0.5) * R * 0.7;
        const zz = Math.sin(ph * Math.PI) * (5 + 6 * k);
        p.col(heatCol(ph * 0.7), 0.95);
        p.dot(x, y - zz);
      }
    }
    // Кромка.
    const run = Math.floor(time * (12 + 30 * k));
    const pts = circle(R);
    const edge = sig ? (tk ? C.white : C.lava[5]) : k > 0.5 ? C.lava[3] : C.lava[2];
    for (let i = 0; i < pts.x.length; i++) {
      if (!sig && mod(i - run, 7) >= 4) continue;
      const x = cx + pts.x[i];
      const y = cy + pts.y[i] * 0.75;
      p.col(C.ink, 0.5);
      p.dot(x + 1, y + 1);
      p.col(edge, 0.9);
      p.dot(x, y);
    }
  }),
);

registerImpactPainter('f15b_erupt', {
  life: 1.7,
  shake: 0.22,
  flash: 0.12,
  flashRgb: '255,120,40',
  above: true,
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const cx = rec.x * S;
    const cy = rec.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = (rec.r ?? 1.15) * S;
    const sd = rec.seed >>> 0;
    const few = reduced();
    const occ = occOf(S);
    // Воронка: корка разорвана, внутри — лава, остывает от краёв к середине.
    p.occ = occ;
    const cool = k01(age / 1.1);
    const fade = 1 - k01((age - 1.2) / 0.5);
    p.col(C.crust[0], 0.8 * fade);
    oval(p, cx, cy, R * 0.8, R * 0.56);
    p.col(heatCol(0.45 + cool * 0.55), 0.95 * fade);
    oval(p, cx, cy, R * 0.6 * (1 - 0.3 * cool), R * 0.4 * (1 - 0.3 * cool));
    p.col(heatCol(0.15 + cool * 0.7), fade);
    oval(p, cx - 1, cy, R * 0.32 * (1 - 0.5 * cool), R * 0.2 * (1 - 0.5 * cool));
    // Корка по краю воронки — тёмные плиты, вывернутые наружу.
    for (let i = 0; i < 7; i++) {
      const th = (i / 7) * TAU + hash(sd, i, 9) * 0.5;
      const x = cx + Math.cos(th) * R * 0.7;
      const y = cy + Math.sin(th) * R * 0.5;
      p.col(C.crust[2], fade);
      p.dot(x - 1, y - 1, 3, 2);
      p.col(C.crust[4], fade);
      p.dot(x - 1, y - 1, 2, 1);
    }
    // Струя лавы: два языка друг на друге, оседает за 0,3 с.
    p.occ = null;
    const jet = 1 - eIn2(k01(age / 0.32));
    if (jet > 0.05) {
      for (let j = 0; j < 2; j++) {
        const im = flameImg(14 * jet, mod(Math.floor(age * 30) + j, 4), 2);
        p.alpha(1);
        p.img(im, cx - im.width / 2 + (j ? 1 : -1), cy - im.height * (j + 1) * 0.9 + 2);
      }
    }
    p.occ = occ;
    // Капли на полу: падают из столба и гаснут.
    const n = few ? 12 : 30;
    for (let i = 0; i < n; i++) {
      const th = TAU * hash(sd, i, 1);
      const v = 14 + 40 * hash(sd, i, 2);
      const vz = 110 + 130 * hash(sd, i, 3);
      const t = age - 0.02 * (i % 4);
      if (t < 0) continue;
      const T = (2 * vz) / 430;
      const gx = cx + Math.cos(th) * v * Math.min(t, T);
      const gy = cy + Math.sin(th) * v * Math.min(t, T) * 0.75;
      if (t < T) {
        p.occ = null;
        const zz = vz * t - 215 * t * t;
        const sz = hash(sd, i, 4) < 0.45 ? 3 : 2;
        // Сгусток с тёмной каймой: светлое ядро остывает на лету.
        p.col(C.lava[1], 1);
        p.dot(gx - 1, gy - zz - 1, sz + 1, sz + 1);
        p.col(heatCol(k01(t / T) * 0.6), 1);
        p.dot(gx - 1, gy - zz - 1, sz, sz);
        p.occ = occ;
      } else {
        const c = k01((t - T) / 0.7);
        p.col(heatCol(0.35 + 0.65 * c), 0.9 * fade);
        p.dot(gx, gy, hash(sd, i, 4) < 0.35 ? 2 : 1, 1);
      }
    }
    p.occ = null;
    // Кадр контакта, искры, дым и пепел.
    hitStar(p, cx, cy - 6, age, 0.1, 14, 0.2, C.lava[5]);
    sparks(p, sd + 2, age, cx, cy - 4, few ? 6 : 14, -Math.PI / 2, 1.2, 30, 60, 0.6, 120);
    dust(
      p,
      sd + 3,
      age - 0.05,
      cx,
      cy - 6,
      few ? 3 : 6,
      -Math.PI / 2,
      0.8,
      10,
      14,
      2,
      8,
      22,
      1.3,
      1,
      0.6,
    );
    dust(p, sd + 4, age, cx, cy - 4, few ? 2 : 4, -Math.PI / 2, 1.2, 14, 14, 2, 6, 10, 0.6, 2, 0.8);
  }),
});

// =============================================================================
// ВОДОВОРОТ И ГЕЙЗЕР — четверть бездны: у ближнего омута закручивается
// водоворот (зона 1,9 с), в 0,95 с тянет к краю, а у края в 1,95 с бьёт
// гейзер (r 1,3, холод). Водоворот: рукава пены вращаются всё быстрее,
// воронка темнеет, вода стекает внутрь; в миг рывка кольцо сжимается к
// центру. Метка гейзера: рябь сходится к центру всё чаще, пузыри, к
// концу — горб воды. Контакт: столб воды в три клетки, пена по краям,
// рушится каплями, брызги кольцом и пар.
// =============================================================================

registerZonePainter(
  'f15b_fxswirl',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const zz = z as Zone;
    const cx = zz.x * S;
    const cy = zz.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = zz.r * S;
    const t = zz.t;
    const k = k01(t / 0.95);
    const fade = 1 - k01((t - (zz.life - 0.45)) / 0.45);
    const sd = seedOf(zz.id);
    // Воронка: тёмная середина растёт.
    p.col(C.sea[0], 0.75 * fade);
    oval(p, cx, cy, R * (0.12 + 0.25 * k), R * (0.08 + 0.17 * k));
    p.col(C.sea[3], 0.6 * fade);
    ring(p, cx, cy, R * (0.14 + 0.25 * k), C.sea[3], 0.6 * fade, (_a, i) => i % 2 === 0);
    // Три рукава пены — спирали, крутятся всё быстрее.
    const spin = time * (2.2 + 4.5 * k);
    for (let arm = 0; arm < 3; arm++)
      for (let q = 0; q < 1; q += 0.022) {
        const r = R * (0.16 + 0.84 * q);
        const th = (arm / 3) * TAU + q * 3.4 - spin;
        const x = cx + Math.cos(th) * r;
        const y = cy + Math.sin(th) * r * 0.72;
        const al = fade * (0.35 + 0.6 * k) * (1 - q * 0.6);
        p.col(q < 0.35 ? C.sea[6] : C.sea[5], al);
        p.dot(x, y);
        if (q < 0.6 && hash(arm, Math.floor(q * 100), sd) < 0.4) {
          p.col(C.sea[4], al * 0.7);
          p.dot(x + 1, y);
        }
      }
    // Вода стекает внутрь: пылинки пены по кругу к центру.
    for (let i = 0; i < 16; i++) {
      const ph = mod(time * (0.5 + 0.9 * k) + hash(sd, i, 1), 1);
      const r = R * (1 - ph) * 0.95;
      const th = TAU * hash(sd, i, 2) - spin * 0.6 + ph * 2;
      p.col(C.sea[5], fade * 0.7 * Math.sin(Math.PI * ph));
      p.dot(cx + Math.cos(th) * r, cy + Math.sin(th) * r * 0.72);
    }
    // Рывок: кольцо сжимается к центру.
    const tp = t - 0.95;
    if (tp >= 0 && tp < 0.3) {
      const kk = tp / 0.3;
      ring(
        p,
        cx,
        cy,
        R * (1 - 0.7 * eOut2(kk)),
        C.white,
        0.9 * (1 - kk),
        (_a, i) => hash(i >> 1, sd, 3) > 0.3,
        0.5,
      );
    }
  }),
);

registerZonePainter(
  'f15b_geyser',
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
    // «Куда»: мелководье кругом.
    p.col(C.sea[1], 0.55);
    oval(p, cx, cy, R, R * 0.72);
    const rf = R * Math.pow(k, 1.4);
    p.col(sig ? C.sea[4] : C.sea[2], (tk ? 0.8 : 0.5) + 0.2 * k);
    oval(p, cx, cy, rf, rf * 0.72);
    // Рябь сходится к центру — всё чаще.
    const rate = 0.8 + 2.6 * k;
    for (let j = 0; j < 3; j++) {
      const ph = mod(time * rate + j / 3, 1);
      const r = R * (1 - ph);
      if (r < 2) continue;
      const pts = circle(r);
      p.col(C.sea[5], 0.55 * Math.sin(Math.PI * ph));
      for (let i = 0; i < pts.x.length; i += 2) p.dot(cx + pts.x[i], cy + pts.y[i] * 0.72);
    }
    // Пузыри.
    const nb = Math.floor(3 + 10 * k);
    for (let i = 0; i < nb; i++) {
      const per = 0.4 + 0.4 * hash(sd, i, 1);
      const ph = mod(time / per + hash(sd, i, 2), 1);
      if (ph < 0.6) continue;
      const x = cx + (hash(sd, i, 3) - 0.5) * R * 1.4;
      const y = cy + (hash(sd, i, 4) - 0.5) * R;
      p.col(C.sea[6], 0.85);
      p.dot(x, y);
      if (ph > 0.85) {
        p.dot(x - 1, y);
        p.dot(x + 1, y);
      }
    }
    // Горб воды перед ударом.
    if (k > 0.75) {
      const h = k01((k - 0.75) / 0.25);
      p.col(C.sea[4], 0.8);
      oval(p, cx, cy - 2 * h, R * 0.45 * h + 1, R * 0.3 * h + 1);
      p.col(C.sea[6], 0.9);
      p.dot(cx - R * 0.15 * h, cy - 3 * h, Math.max(1, Math.round(4 * h)), 1);
    }
    // Кромка.
    const run = Math.floor(time * (12 + 30 * k));
    const pts = circle(R);
    const edge = sig ? (tk ? C.white : C.sea[6]) : C.sea[4];
    for (let i = 0; i < pts.x.length; i++) {
      if (!sig && mod(i - run, 7) >= 4) continue;
      p.col(C.ink, 0.5);
      p.dot(cx + pts.x[i] + 1, cy + pts.y[i] * 0.72 + 1);
      p.col(edge, 0.9);
      p.dot(cx + pts.x[i], cy + pts.y[i] * 0.72);
    }
  }),
);

/** Столб воды высоты h (пиксели), кадр пены f: шире внизу, пена по краям. */
function waterCol(h: number, f: number): HTMLCanvasElement {
  const H = Math.max(2, Math.min(56, Math.round(h / 2) * 2));
  return sprite(100000 + H * 4 + (f & 3), () => {
    const W = 15;
    const p = new Px(W, H + 2);
    for (let y = 0; y <= H; y++) {
      const t = y / H; // 0 — верх
      const hw = 3 + 3.5 * t + (hash(f, y >> 1, 5) - 0.5) * 1.6;
      const cxx = 7.5 + (hash(f, y >> 2, 6) - 0.5) * 1.2;
      for (let x = 0; x < W; x++) {
        const d = x + 0.5 - cxx;
        if (Math.abs(d) > hw) continue;
        const e = hw - Math.abs(d);
        const c = e < 1 ? C.sea[6] : d < -hw * 0.3 ? C.sea[5] : d < hw * 0.3 ? C.sea[4] : C.sea[3];
        p.set(x, y + 1, hx(c, 235));
      }
    }
    // Шапка пены.
    for (let x = 4; x < 11; x++) if (hash(f, x, 7) < 0.7) p.set(x, 0, hx(C.white));
    return p;
  });
}

registerImpactPainter('f15b_geyser', {
  life: 1.7,
  shake: 0.3,
  flash: 0.08,
  flashRgb: '160,240,255',
  above: true,
  paint: guarded(
    (g, rec: ImpactRec, px: number, py: number, S: number, age: number, time: number) => {
      const cx = rec.x * S;
      const cy = rec.y * S;
      const p = new Pen(g, px, py, cx, cy);
      const R = (rec.r ?? 1.3) * S;
      const sd = rec.seed >>> 0;
      const few = reduced();
      const occ = occOf(S);
      // Брызги кольцом и иней — на полу.
      p.occ = occ;
      if (age < 0.5) {
        const k = age / 0.5;
        ring(
          p,
          cx,
          cy,
          4 + R * 1.3 * eOut2(k),
          C.sea[5],
          0.9 * (1 - k),
          (_a, i) => hash(i >> 1, sd, 2) > 0.25,
          0.5,
        );
      }
      const frost = 1 - k01((age - 0.8) / 0.6);
      p.col(C.sea[6], 0.5 * frost);
      for (let i = 0; i < 18; i++) {
        const th = TAU * hash(sd, i, 3);
        const r = R * (0.5 + 0.5 * hash(sd, i, 4));
        p.dot(cx + Math.cos(th) * r, cy + Math.sin(th) * r * 0.72);
      }
      // Столб: встаёт за 0,08 с, стоит, с 0,35 с рушится сверху.
      const H = S * 3.2;
      const up = eOut3(k01(age / 0.08));
      const down = eIn2(k01((age - 0.35) / 0.4));
      const h = H * up * (1 - down);
      if (h > 2) {
        const im = waterCol(h, Math.floor(time * 20));
        p.alpha(0.95);
        p.img(im, cx - 7.5, cy - im.height + 2, cy);
      }
      p.occ = null;
      hitStar(p, cx, cy - 4, age, 0.08, 12, 0.5, C.sea[6]);
      // Рушится каплями: сверху вниз, с отскоком брызг.
      if (age > 0.3) {
        const n = few ? 8 : 20;
        for (let i = 0; i < n; i++) {
          const t = age - 0.3 - 0.25 * hash(sd, i, 5);
          if (t < 0) continue;
          const f = fall(t, H * (0.3 + 0.7 * hash(sd, i, 6)), 30 * hash(sd, i, 7), 430);
          if (!f.air && t > 0.9) continue;
          const th = TAU * hash(sd, i, 8);
          const v = 20 + 30 * hash(sd, i, 9);
          const gx = cx + Math.cos(th) * v * f.h;
          const gy = cy + Math.sin(th) * v * f.h * 0.72;
          p.col(f.air ? C.sea[6] : C.sea[4], f.air ? 0.95 : 0.6);
          p.dot(gx, gy - f.z, 1, f.air ? 2 : 1);
        }
      }
      dust(
        p,
        sd + 1,
        age,
        cx,
        cy - 6,
        few ? 3 : 7,
        -Math.PI / 2,
        Math.PI,
        14,
        16,
        2,
        8,
        12,
        1.2,
        5,
        0.5,
      );
    },
  ),
});

// =============================================================================
// ЛУЧ ЗЕРКАЛА — четверть зеркал: от зеркала к герою, до стены, ширина
// 0,38, warn 0,9, стены режут (поверх темноты — свет). Метка: тонкая нить
// прицела во всю длину; в зеркале собирается свет — искры стягиваются к
// нему; от зеркала по нити бежит налив, нить сужается и твердеет;
// последние 0,2 с — белая. Контакт: слепящий луч (белая сердцевина,
// холодный ореол через пиксель), блики по всей длине, на конце —
// звезда, стеклянная крошка и искры.
// =============================================================================

registerZonePainter(
  'f15b_mbeam',
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
    const hw = (st.w ?? 0.38) * S;
    const sd = seedOf(st.id);
    const y0 = -8; // луч идёт на высоте груди
    // Пятно на полу под лучом — куда.
    p.occ = occOf(S);
    p.col(C.glass[0], 0.3 + 0.15 * k);
    fillLane(p, cx, cy, ux, uy, 0, L, hw, true);
    p.occ = null;
    // Нить прицела во всю длину; налив — от зеркала.
    const lf = L * Math.pow(k, 1.2);
    for (let s = 0; s < L; s += 1) {
      const lit = s < lf;
      if (!lit && !sig && Math.floor(s + time * 40) % 4 !== 0) continue;
      p.col(
        sig ? (tk ? C.white : C.glass[4]) : lit ? C.glass[3] : C.glass[2],
        lit ? 0.6 + 0.4 * k : 0.5,
      );
      p.dot(cx + ux * s, cy + uy * s + y0);
    }
    // Края полосы — редкие точки (сужаются к удару).
    const ew = hw * (1 - 0.35 * k);
    for (let s = 2; s < L; s += 5) {
      for (const side of [-1, 1]) {
        p.col(C.glass[2], 0.35 + 0.35 * k);
        p.dot(cx + ux * s + nx * ew * side, cy + uy * s + ny * ew * side + y0);
      }
    }
    // Свет стягивается в зеркало.
    for (let i = 0; i < 10; i++) {
      const ph = mod(time * (0.8 + 1.6 * k) + hash(sd, i, 1), 1);
      const th = TAU * hash(sd, i, 2);
      const r = (1 - ph) * (10 + 8 * hash(sd, i, 3));
      p.col(C.white, Math.sin(Math.PI * ph) * (0.4 + 0.5 * k));
      p.dot(cx + Math.cos(th) * r, cy + Math.sin(th) * r * 0.7 + y0);
    }
    p.col(sig ? C.white : C.glass[3], 1);
    star(p, cx, cy + y0, 2 + 4 * k, 4, time * 2);
  }),
);

registerImpactPainter('f15b_mbeam', {
  life: 0.8,
  shake: 0.14,
  flash: 0.14,
  flashRgb: '220,235,255',
  above: true,
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const cx = rec.x * S;
    const cy = rec.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const a = rec.ang ?? 0;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const L = (rec.r ?? 8) * S;
    const hw = (rec.w ?? 0.38) * S;
    const sd = rec.seed >>> 0;
    const few = reduced();
    const y0 = -8;
    const k = k01(age / 0.32);
    if (k < 1) {
      // Ореол через пиксель, сердцевина сплошная — сужается и гаснет.
      p.col(C.glass[3], 0.75 * (1 - k));
      fillLane(p, cx, cy + y0, ux, uy, 0, L, hw * (1.2 - 0.6 * k), true);
      p.col(age < 0.05 ? C.white : C.glass[4], 1 - k * 0.8);
      fillLane(p, cx, cy + y0, ux, uy, 0, L, Math.max(0.6, 2.2 * (1 - k)));
    }
    // Блики по длине.
    for (let i = 0; i < (few ? 4 : 10); i++) {
      const s = L * hash(sd, i, 1);
      const t = age - 0.04 - 0.3 * hash(sd, i, 2);
      if (t < 0 || t > 0.18) continue;
      const x = cx + ux * s;
      const y = cy + uy * s + y0;
      const r = t < 0.08 ? 3 : 2;
      p.col(C.white, 1 - t / 0.18);
      p.dot(x - r, y, r * 2 + 1, 1);
      p.dot(x, y - r, 1, r * 2 + 1);
    }
    // Конец луча: звезда, стеклянная крошка, искры.
    const ex = cx + ux * L;
    const ey = cy + uy * L;
    hitStar(p, ex, ey + y0, age, 0.12, 9, a, C.glass[3]);
    hitStar(p, cx, cy + y0, age, 0.1, 7, a, C.glass[3]);
    chunks(p, sd, age, ex, ey, few ? 3 : 7, a + Math.PI, 1.2, 20, 40, 40, 60, [0.5, 0.8], 0, 4);
    sparks(p, sd + 1, age, ex, ey + y0 / 2, few ? 4 : 10, a + Math.PI, 1.3, 50, 60, 0.4, 40, (q) =>
      q < 0.4 ? C.white : q < 0.75 ? C.glass[3] : C.glass[2],
    );
  }),
});

// =============================================================================
// ГОЛОВА ИЗ КРУГА — четверть гидры: из круга-телепорта бьёт голова (r 1,45,
// warn 0,85, яд). Метка: руна круга вращается и разгорается; под топью
// кругами ходит тень головы, поднимаясь; пузыри всё чаще; последние 0,3 с —
// сверху и снизу смыкаются ряды зубов. Контакт: голова вырывается из
// круга, челюсти щёлкают (вспышка), яд брызгами, кольцо топи, голова
// уходит обратно, пузыри и ядовитый пар.
// =============================================================================

/** Голова гидры (вид спереди-сверху), челюсти: 0 — раскрыты, 1 — сомкнуты. */
function hydraHead(shut: number): HTMLCanvasElement {
  return sprite(110000 + shut, () => {
    const W = 26;
    const p = new Px(W, 31);
    const SC = ['#0e2a0c', '#1e4a16', '#3a7a24', '#6ab03a', '#b0e070'].map((c) => hx(c));
    const belly = hx('#a8c070');
    const bone = hx('#e8dcc0');
    const cx = W / 2;
    // Шея: изгиб из топи, брюшные щитки посередине.
    for (let y = 17; y < 31; y++) {
      const c0 = cx + Math.sin(((y - 17) / 14) * Math.PI) * 1.6;
      for (let x = 0; x < W; x++) {
        const d = x + 0.5 - c0;
        if (Math.abs(d) > 4.2) continue;
        const scaleRow = (y + (x >> 1)) % 3 === 0;
        p.set(
          x,
          y,
          Math.abs(d + 0.4) < 1.6
            ? y % 2
              ? belly
              : SC[3]
            : d < -2.2
              ? SC[3]
              : d > 2.4
                ? SC[1]
                : scaleRow
                  ? SC[3]
                  : SC[2],
        );
      }
    }
    // Голова: череп сверху, морда книзу — смотрит на героя.
    for (let y = 1; y < 21; y++) {
      const t = (y - 1) / 19;
      const hw = t < 0.35 ? 4 + 9 * t : t < 0.7 ? 7.2 - (t - 0.35) * 2 : 6.5 - (t - 0.7) * 9;
      for (let x = 0; x < W; x++) {
        const d = x + 0.5 - cx;
        if (Math.abs(d) > hw) continue;
        const l = -d / hw - (t - 0.4);
        const scaleRow = (x + y * 2) % 4 === 0;
        p.set(
          x,
          y,
          l > 0.7 ? SC[4] : l > 0.1 ? (scaleRow ? SC[4] : SC[3]) : l > -0.6 ? SC[2] : SC[1],
        );
      }
    }
    // Гребень: костяные шипы по бокам черепа.
    for (const [y, len] of [
      [4, 3],
      [7, 4],
      [10, 3],
    ]) {
      for (let q = 0; q < len; q++) {
        p.set(Math.round(cx - 7 - q), y - Math.floor(q / 2), bone);
        p.set(Math.round(cx + 6 + q), y - Math.floor(q / 2), bone);
      }
    }
    // Пасть.
    if (!shut) {
      for (let y = 12; y < 20; y++) {
        const hw = 4.6 - (y - 12) * 0.35;
        for (let x = 0; x < W; x++) if (Math.abs(x + 0.5 - cx) < hw) p.set(x, y, hx('#160404'));
      }
      p.set(Math.round(cx), 16, hx(C.bog[5]));
      p.set(Math.round(cx) - 1, 17, hx(C.bog[4]));
      for (const x of [-4, -2, 2, 4]) {
        p.set(Math.round(cx + x - 0.5), 12, bone);
        p.set(Math.round(cx + x - 0.5), 13, bone);
      }
      for (const x of [-3, 0, 3]) p.set(Math.round(cx + x - 0.5), 18, bone);
    } else {
      for (let x = Math.round(cx - 5); x <= Math.round(cx + 4); x++) {
        p.set(x, 15, hx('#160404'));
        p.set(x, x % 2 ? 14 : 16, bone);
      }
    }
    // Глаза горят.
    for (const s of [-1, 1]) {
      const ex = Math.round(cx + s * 4.5 - 0.5);
      p.set(ex, 7, hx('#ffe060'));
      p.set(ex + (s < 0 ? 1 : -1), 7, hx('#fff8c0'));
      p.set(ex, 8, hx('#c08010'));
    }
    p.outline(hx('#081004'));
    return p;
  });
}

registerZonePainter(
  'f15b_hbite',
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
    // «Куда»: топь кругом.
    p.col(C.bog[0], 0.55);
    oval(p, cx, cy, R, R * 0.72);
    const rf = R * Math.pow(k, 1.4);
    p.col(sig ? C.bog[3] : C.bog[2], (tk ? 0.75 : 0.45) + 0.15 * k);
    oval(p, cx, cy, rf, rf * 0.72);
    // Тень головы ходит кругами под топью, поднимаясь.
    const th = time * (3 + 5 * k) + sd;
    const r = R * 0.45 * (1 - 0.6 * k);
    p.col(C.ink, 0.25 + 0.5 * k);
    lens(
      p,
      cx + Math.cos(th) * r,
      cy + Math.sin(th) * r * 0.72,
      -Math.sin(th),
      Math.cos(th) * 0.72,
      4 + 3 * k,
      2 + 1.5 * k,
      k < 0.5,
    );
    // Пузыри.
    const nb = Math.floor(3 + 9 * k);
    for (let i = 0; i < nb; i++) {
      const per = 0.4 + 0.5 * hash(sd, i, 1);
      const ph = mod(time / per + hash(sd, i, 2), 1);
      if (ph < 0.55) continue;
      p.col(C.bog[5], 0.85);
      p.dot(cx + (hash(sd, i, 3) - 0.5) * R * 1.5, cy + (hash(sd, i, 4) - 0.5) * R);
    }
    // Руна круга: зубцы вращаются, разгораются.
    const pts = circle(R);
    const run = Math.floor(time * (10 + 26 * k));
    const edge = sig ? (tk ? C.white : C.bog[5]) : C.bog[4];
    for (let i = 0; i < pts.x.length; i++) {
      if (!sig && mod(i - run, 6) >= 4) continue;
      p.col(C.ink, 0.5);
      p.dot(cx + pts.x[i] + 1, cy + pts.y[i] * 0.72 + 1);
      p.col(edge, 0.8 + 0.2 * k);
      p.dot(cx + pts.x[i], cy + pts.y[i] * 0.72);
    }
    // Зубы смыкаются сверху и снизу.
    const jk = k01((k - 0.65) / 0.35);
    if (jk > 0) {
      const gap = R * 0.55 * (1 - jk) + 1;
      p.col(C.white, 0.5 + 0.5 * jk);
      for (let i = -3; i <= 3; i++) {
        const x = cx + i * 3;
        const sag = Math.abs(i) * 0.6;
        p.dot(x, cy - gap + sag - 2, 1, 2);
        p.dot(x + 1, cy + gap - sag, 1, 2);
      }
    }
  }),
);

registerImpactPainter('f15b_hbite', {
  life: 1.3,
  shake: 0.2,
  above: true,
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const cx = rec.x * S;
    const cy = rec.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = (rec.r ?? 1.45) * S;
    const sd = rec.seed >>> 0;
    const few = reduced();
    const occ = occOf(S);
    p.occ = occ;
    // Кольцо топи и пятно яда — на полу.
    if (age < 0.5) {
      const k = age / 0.5;
      ring(
        p,
        cx,
        cy,
        4 + R * 1.2 * eOut2(k),
        C.bog[4],
        0.85 * (1 - k),
        (_a, i) => hash(i >> 1, sd, 2) > 0.3,
        0.5,
      );
    }
    // Голова: вырывается за 0,08 с, щёлкает, с 0,35 с уходит обратно.
    const up = eOut3(k01(age / 0.08));
    const down = eIn2(k01((age - 0.35) / 0.3));
    const h = up * (1 - down);
    if (h > 0.05) {
      const im = hydraHead(age > 0.06 && age < 0.4 ? 1 : 0);
      const vis = Math.round(im.height * h);
      // Видна только часть над топью: голова поднимается из круга.
      const X = Math.floor(cx - im.width / 2);
      const Y = Math.floor(cy + 2 - vis);
      p.alpha(1);
      p.g.drawImage(im, 0, 0, im.width, vis, X + p.qx, Y + p.qy, im.width, vis);
    }
    p.occ = null;
    // Щелчок челюстей.
    hitStar(p, cx, cy - 14 * up, age - 0.06, 0.1, 10, 0.4, C.bog[5]);
    // Яд брызгами, пузыри, пар.
    drops(
      p,
      sd,
      age,
      few ? 6 : 16,
      (i) => [cx, cy - 10, (i / 16) * TAU],
      20,
      40,
      40,
      60,
      (i) => 0.06 + 0.02 * (i % 3),
      (q) => (q < 0.4 ? C.bog[5] : C.bog[4]),
      C.bog[2],
      [0.9, 1.3],
    );
    dust(
      p,
      sd + 1,
      age - 0.3,
      cx,
      cy - 2,
      few ? 2 : 5,
      -Math.PI / 2,
      1.2,
      8,
      10,
      2,
      7,
      10,
      0.9,
      6,
      0.5,
    );
  }),
});

// Телепорт круга гидры (зона мозга 0,6 с у обоих кругов, перенос в 0,55 с):
// руна крутится всё быстрее, из круга встаёт столб света, искры
// стягиваются; в миг переноса — белая вспышка.
registerZonePainter(
  'f15b_fxwarp',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const zz = z as Zone;
    const cx = zz.x * S;
    const cy = zz.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = zz.r * S;
    const t = zz.t;
    const k = k01(t / 0.55);
    const sd = seedOf(zz.id);
    const spin = time * (4 + 14 * k);
    // Руна: зубцы бегут по кругу.
    const pts = circle(R);
    for (let i = 0; i < pts.x.length; i++) {
      if (mod(i - Math.floor(spin * 4), 5) >= 3) continue;
      p.col(k > 0.8 ? C.white : C.bog[5], 0.6 + 0.4 * k);
      p.dot(cx + pts.x[i], cy + pts.y[i] * 0.72);
    }
    // Столб света растёт вверх.
    const H = 44 * eOut2(k);
    for (let y = 0; y < H; y += 1) {
      const w = Math.max(1, R * 0.55 * (1 - y / 60));
      const al = (0.25 + 0.5 * k) * (1 - y / Math.max(1, H));
      p.col(y % 3 ? C.bog[4] : C.bog[5], al);
      for (let x = -w; x <= w; x += 2) p.dot(cx + x + ((y + Math.floor(time * 30)) & 1), cy - y);
    }
    // Искры стягиваются.
    for (let i = 0; i < 10; i++) {
      const ph = mod(time * 1.6 + hash(sd, i, 1), 1);
      const th = TAU * hash(sd, i, 2);
      const r = (1 - ph) * (R + 10);
      p.col(C.bog[5], Math.sin(Math.PI * ph));
      p.dot(cx + Math.cos(th) * r, cy + Math.sin(th) * r * 0.7 - ph * 6);
    }
    // Перенос: столб вспыхивает белым и сжимается в нить.
    if (t > 0.5) {
      const u = k01((t - 0.5) / 0.1);
      const w = Math.max(1, R * 0.6 * (1 - u));
      p.col(C.white, 0.95 * (1 - u * 0.6));
      p.rect(Math.floor(cx - w), Math.floor(cy - 48), Math.ceil(w * 2), 48);
      ring(p, cx, cy, R * (1 + 0.8 * u), C.white, 1 - u, (_a, i) => i % 2 === 0);
    }
  }),
);

// =============================================================================
// ТЕХНИКИ ЭХА — пять прошлых боссов встают из пола «записью»: их тела —
// перекрашенный рисунок хозяина со строками развёртки (`f15-boss-art`).
// Техники — ТЕ ЖЕ, что у самих боссов на их этажах, и рисуются тем же
// языком (серп и рубец Короля демонов, тень секиры Минотавра, полосы
// пламени змея, челюсти, гроза клетками), но в спектральной палитре эха:
// метка — тёмная синь, фронт — голубой, сигнал — белый; контакт — та же
// сила, но смаз и вспышки идут строками развёртки, как у тел. Плоть пола
// рвётся по-настоящему: память бьёт по живому.
// =============================================================================

const G = C.ghost;
/** Строки развёртки бегут вниз (как у тел эха: три строки, шаг 1/6 с). */
const scanOf = (time: number) => mod(Math.floor(time * 6), 3);

// ---- Взмах Короля демонов (конус r 3,1 дуга 2,3) ----------------------------

const ESLASH_SWEEP = 0.15;
const ESLASH_OVER = 0.4;

registerZonePainter(
  'f15b_slash',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const st = z as Strike;
    const { k, left } = warnOf(st);
    const sig = left < SIG;
    const tk = !reduced() && tick(left);
    const cx = st.x * S;
    const cy = st.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = st.r * S;
    const arc = st.arc ?? 2.3;
    const a0 = (st.ang ?? 0) - arc / 2;
    const r0 = S * 0.5;
    const sd = seedOf(st.id);
    p.col(G[0], 0.5 + 0.1 * k);
    fillSector(p, cx, cy, r0, R, a0, a0 + arc);
    const rAt = (kk: number) => r0 + (R - r0) * Math.pow(k01(kk), 1.7);
    const rf = rAt(k);
    p.col(sig ? G[2] : G[1], (tk ? 0.7 : 0.45) + 0.12 * k);
    fillSector(p, cx, cy, r0, rf, a0, a0 + arc);
    for (const [lag, al] of [
      [0.2, 0.3],
      [0.1, 0.5],
    ] as const) {
      const rr = rAt(k - lag);
      if (rr > r0 + 3) crescent(p, cx, cy, rr, a0, arc, 2, G[3], al);
    }
    crescent(p, cx, cy, rf, a0, arc, 2 + 4 * k, sig ? C.white : G[4], 0.95);
    ring(p, cx, cy, rf, sig ? C.white : G[5], 0.9, (ang) => inArc(ang, a0, arc));
    const run = time * (20 + 50 * k);
    sectorRim(
      p,
      cx,
      cy,
      R,
      a0,
      arc,
      r0,
      sig ? (tk ? C.white : G[5]) : k > 0.5 ? G[4] : G[3],
      0.75 + 0.25 * k,
      sig ? undefined : (u) => mod(u - run, 8) < 5,
    );
    hopBits(p, sd, time, k, 12, (i) => {
      const rr = R * (0.4 + 0.55 * hash(sd, i, 5));
      const aa = a0 + arc * hash(sd, i, 6);
      return [cx + Math.cos(aa) * rr, cy + Math.sin(aa) * rr];
    });
  }),
);

registerImpactPainter('f15b_slash', {
  life: 1.35,
  shake: 0.24,
  paint: guarded(
    (g, rec: ImpactRec, px: number, py: number, S: number, age: number, time: number) => {
      const cx = rec.x * S;
      const cy = rec.y * S;
      const p = new Pen(g, px, py, cx, cy);
      const R = (rec.r ?? 3.1) * S;
      const a = rec.ang ?? 0;
      const arc = rec.arc ?? 2.3;
      const { as, dir } = sweepOf(a, arc);
      const sd = rec.seed >>> 0;
      const few = reduced();
      const span = arc + ESLASH_OVER;
      const at = (s: number) => as + dir * s;
      const front = span * eOut2(k01(age / ESLASH_SWEEP));
      const tail = span * eOut2(k01((age - 0.05) / 0.22));
      const fadeA = 1 - k01((age - 0.14) / 0.14);
      // Смаз клинка строками развёртки: остриё белое, тело голубое, хвост синий.
      p.scan = scanOf(time);
      if (front - tail > 0.02 && fadeA > 0) {
        const len = front - tail;
        const n = Math.max(2, Math.min(24, Math.ceil(len / 0.07)));
        for (let j = 0; j < n; j++) {
          const s1 = front - (len * j) / n;
          const s0 = front - (len * (j + 1)) / n;
          const q = (j + 0.5) / n;
          const past = k01((s1 - arc) / ESLASH_OVER);
          const rout = R + 1 - past * 4;
          const rin = Math.min(rout - 1, R * (0.46 + 0.36 * q + 0.28 * past));
          const lo = Math.min(at(s0), at(s1));
          const hi = Math.max(at(s0), at(s1));
          if (q < 0.22) {
            p.col(G[4], 0.95 * fadeA);
            fillSector(p, cx, cy, rin, rout - 3, lo, hi);
            p.col(C.white, fadeA);
            fillSector(p, cx, cy, Math.max(rin, rout - 3), rout, lo, hi);
          } else if (q < 0.6) {
            p.col(G[3], 0.9 * fadeA);
            fillSector(p, cx, cy, rin, rout, lo, hi);
            p.col(G[5], 0.85 * fadeA);
            fillSector(p, cx, cy, Math.max(rin, rout - 2), rout, lo, hi);
          } else {
            p.col(G[2], 0.75 * fadeA * (1 - ((q - 0.6) / 0.4) * 0.6));
            fillSector(p, cx, cy, rin, rout, lo, hi);
          }
        }
      }
      p.scan = -1;
      if (age < 0.07)
        ring(p, cx, cy, R, C.white, 1 - age / 0.07, (ang) => inArc(ang, a - arc / 2, arc), 0.5);
      // Рубец в полу: холодное свечение памяти остывает к тёмной борозде.
      const g0 = 0.12;
      const gspan = arc - 0.24;
      const gs = gashOf(sd, R * 0.78, at(g0), dir, gspan);
      const reveal = k01((front - g0) / gspan);
      const fade = 1 - k01((age - 0.95) / 0.4);
      const when = (u: number) => sweepT(g0 + u * gspan, span, ESLASH_SWEEP);
      drawScar(p, gs, cx, cy, age, reveal, when, 0.85, fade, (h) =>
        h < 0.1
          ? C.white
          : h < 0.25
            ? G[5]
            : h < 0.45
              ? G[4]
              : h < 0.65
                ? G[3]
                : h < 0.85
                  ? C.neb[2]
                  : C.neb[1],
      );
      const pick = (i: number) =>
        Math.min(gs.x.length - 1, Math.floor(hash(sd, i, 81) * gs.x.length));
      sparks(
        p,
        sd,
        age,
        cx,
        cy,
        few ? 5 : 14,
        0,
        0.45,
        70,
        80,
        0.42,
        55,
        ghostCol,
        (i) => when(gs.u[pick(i)]),
        (i) => {
          const j = pick(i);
          return [cx + gs.x[j], cy + gs.y[j], at(g0 + gs.u[j] * gspan) + dir * Math.PI * 0.32];
        },
      );
      chunks(
        p,
        sd + 3,
        age,
        cx,
        cy,
        few ? 3 : 7,
        0,
        0.5,
        22,
        30,
        45,
        45,
        [0.95, 1.3],
        0.2,
        1,
        (i) => when(gs.u[pick(i + 20)]),
        (i) => {
          const j = pick(i + 20);
          return [cx + gs.x[j], cy + gs.y[j], at(g0 + gs.u[j] * gspan)];
        },
      );
      dust(
        p,
        sd + 5,
        age,
        cx,
        cy,
        few ? 3 : 6,
        0,
        0.3,
        14,
        16,
        1.5,
        5,
        6,
        0.85,
        4,
        0.5,
        (i) => sweepT(((i + 0.5) / 6) * arc, span, ESLASH_SWEEP) + 0.02,
        (i) => {
          const th = at(((i + 0.5) / 6) * arc);
          return [cx + Math.cos(th) * R * 0.9, cy + Math.sin(th) * R * 0.9, th];
        },
      );
      if (age < 0.3)
        ring(
          p,
          cx,
          cy,
          R + 3 + 16 * eOut2(age / 0.3),
          G[4],
          0.7 * (1 - age / 0.3),
          (ang, i) => inArc(ang, a - arc / 2, arc) && hash(i >> 1, sd, 9) > 0.25,
          0.5,
        );
    },
  ),
});

// ---- Рубка Короля демонов (полоса до 6,2, полуширина 0,72) -------------------

const ECLEAVE_BITE = 2;
const ECLEAVE_FROM = 0.95;
const ECLEAVE_RUN = 0.14;

registerZonePainter(
  'f15b_cleave',
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
    const hw = (st.w ?? 0.72) * S;
    const l0 = S * 0.55;
    const s0 = ECLEAVE_FROM * S;
    const sd = seedOf(st.id);
    p.col(G[0], 0.5 + 0.1 * k);
    fillLane(p, cx, cy, ux, uy, l0, L, hw);
    const e = Math.pow(k, 1.5);
    p.col(sig ? G[2] : G[1], (tk ? 0.7 : 0.42) + 0.14 * k);
    fillLane(p, cx, cy, ux, uy, l0, s0 + (L - s0) * e, hw * (0.4 + 0.6 * e));
    const run = time * (26 + 70 * k);
    const edge = sig ? (tk ? C.white : G[5]) : k > 0.5 ? G[4] : G[3];
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
    // Трещина от меча бежит к концу — та же, что раскроется ударом.
    const ck = crackOf(
      `ecleave|${sd % 997}|${Math.round(L)}`,
      sd,
      [[a, Math.max(4, L - s0), 3]],
      0.32,
      0.16,
      0.22,
    );
    drawCrack(
      p,
      ck,
      cx + ux * s0,
      cy + uy * s0,
      ck.max * e,
      sig ? G[5] : k > 0.6 ? G[4] : G[3],
      null,
      0.95,
    );
  }),
);

/** Призрачный клинок вдоль удара: длинный тонкий овал, строками. */
function ghostBlade(
  p: Pen,
  x: number,
  y: number,
  ux: number,
  uy: number,
  len: number,
  w: number,
  a: number,
): void {
  p.col(G[4], 0.8 * a);
  lens(p, x + (ux * len) / 2, y + (uy * len) / 2, ux, uy, len / 2, w);
  p.col(C.white, a);
  lens(p, x + (ux * len) / 2, y + (uy * len) / 2, ux, uy, len / 2 - 1, Math.max(0.6, w - 1.2));
}

registerImpactPainter('f15b_cleave', {
  life: 1.5,
  shake: 0.3,
  flash: 0.16,
  flashRgb: '170,210,255',
  paint: guarded(
    (g, rec: ImpactRec, px: number, py: number, S: number, age: number, time: number) => {
      const cx = rec.x * S;
      const cy = rec.y * S;
      const p = new Pen(g, px, py, cx, cy);
      const a = rec.ang ?? 0;
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      const nx = -uy;
      const ny = ux;
      const L = (rec.r ?? 6) * S;
      const hw = (rec.w ?? 0.72) * S;
      const sd = rec.seed >>> 0;
      const few = reduced();
      const s0 = ECLEAVE_FROM * S;
      const bx = cx + ux * S * ECLEAVE_BITE;
      const by = cy + uy * S * ECLEAVE_BITE;
      const fade = 1 - k01((age - 1.0) / 0.5);
      // Трещина раскрывается по всей полосе за 0,14 с и остывает.
      const ck = crackOf(
        `ecleave|${sd % 997}|${Math.round(L)}`,
        sd,
        [[a, Math.max(4, L - s0), 3]],
        0.32,
        0.16,
        0.22,
      );
      const reach = ck.max * eOut2(k01(age / ECLEAVE_RUN));
      const cool = k01((age - 0.1) / 0.8);
      drawCrack(
        p,
        ck,
        cx + ux * s0,
        cy + uy * s0,
        reach,
        cool < 0.3 ? G[5] : cool < 0.6 ? G[3] : C.neb[1],
        C.lip,
        fade,
      );
      // Призрачный меч воткнут в пол — тает строками.
      if (age < 0.32) {
        p.scan = scanOf(time);
        ghostBlade(
          p,
          cx + ux * S * 0.6,
          cy + uy * S * 0.6 - 3,
          ux,
          uy,
          S * (ECLEAVE_BITE - 0.4),
          2.6,
          1 - age / 0.32,
        );
        p.scan = -1;
      }
      hitStar(p, bx, by - 2, age, 0.12, 16, a + 0.3, G[4]);
      // Волна по полосе: пол вскидывает, крошка и пыль в стороны.
      const n = few ? 6 : 16;
      const passT = (s: number) => ECLEAVE_RUN * k01((s - s0) / (L - s0));
      chunks(
        p,
        sd + 1,
        age,
        cx,
        cy,
        n,
        0,
        0.5,
        18,
        26,
        50,
        60,
        [1.0, 1.45],
        0.25,
        1,
        (i) => passT(s0 + ((i + 0.5) / n) * (L - s0)),
        (i) => {
          const s = s0 + ((i + 0.5) / n) * (L - s0);
          const side = i % 2 ? 1 : -1;
          return [
            cx + ux * s + nx * side * 2,
            cy + uy * s + ny * side * 2,
            Math.atan2(ny * side, nx * side),
          ];
        },
      );
      dust(
        p,
        sd + 2,
        age,
        cx,
        cy,
        few ? 4 : 10,
        0,
        0.4,
        16,
        18,
        2,
        7,
        5,
        1.0,
        0,
        0.5,
        (i) => passT(s0 + ((i + 0.5) / 10) * (L - s0)),
        (i) => {
          const s = s0 + ((i + 0.5) / 10) * (L - s0);
          const side = i % 2 ? 1 : -1;
          return [
            cx + ux * s + nx * side * hw * 0.6,
            cy + uy * s + ny * side * hw * 0.6,
            Math.atan2(ny * side, nx * side),
          ];
        },
      );
      sparks(
        p,
        sd + 3,
        age - ECLEAVE_RUN,
        cx + ux * L,
        cy + uy * L,
        few ? 4 : 10,
        a,
        1.0,
        40,
        60,
        0.45,
        50,
        ghostCol,
      );
    },
  ),
});

// ---- Секира Минотавра (круг r 1,5 впереди) -----------------------------------

/** Призрачное лезвие секиры, воткнутое в пол: полумесяц и обух. */
function ghostAxe(): HTMLCanvasElement {
  return sprite(120000, () => {
    // Полумесяц лезвия слева от древка, режущая кромка — белая; древко
    // уходит в пол (нижние строки картинки — уже под полом).
    const p = new Px(26, 26);
    for (let y = 0; y < 22; y++)
      for (let x = 0; x < 26; x++) {
        const dx = x + 0.5 - 15;
        const dy = y + 0.5 - 10;
        const outer = dx * dx + dy * dy <= 11 * 11;
        const ix = x + 0.5 - 19;
        const inner = ix * ix + dy * dy <= 9.5 * 9.5;
        if (!outer || inner || x > 15) continue;
        const edge = dx * dx + dy * dy > 9.6 * 9.6;
        p.set(x, y, edge ? hx(C.white) : dy < -2 ? hx(G[4]) : dy < 4 ? hx(G[3]) : hx(G[2]));
      }
    for (let y = 0; y < 26; y++) {
      p.set(15, y, hx(y < 3 ? C.white : G[2]));
      p.set(16, y, hx(G[1]));
    }
    p.outline(hx(G[0]));
    return p;
  });
}

registerZonePainter(
  'f15b_axe',
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
    const m = mobOf(st.from);
    const a = m ? Math.atan2(st.y - m.y, st.x - m.x) : 0;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    p.col(G[0], 0.5 + 0.1 * k);
    oval(p, cx, cy, R, R * 0.75);
    const rf = R * Math.pow(k, 1.6);
    p.col(sig ? G[2] : G[1], (tk ? 0.7 : 0.44) + 0.14 * k);
    oval(p, cx, cy, rf, rf * 0.75);
    ring(p, cx, cy, rf, sig ? C.white : G[4], 0.85, (_a, i) => i % 4 !== 3);
    // Тень секиры: из-за Минотавра к центру; опускается — темнеет, сжимается.
    const drop = Math.pow(k, 2.2);
    const along = -R * 1.1 * (1 - drop);
    p.col(C.shadow, 0.2 + 0.6 * drop);
    lens(p, cx + ux * along, cy + uy * along, -uy, ux, 6 - 2 * drop, 3 - drop, drop < 0.4);
    const run = Math.floor(time * (12 + 30 * k));
    const pts = circle(R);
    const edge = sig ? (tk ? C.white : G[5]) : k > 0.5 ? G[4] : G[3];
    // Кромка сплошная с первого кадра («куда»), по ней бегут светлые штрихи.
    for (let i = 0; i < pts.x.length; i++) {
      const lit = sig || mod(i - run, 7) < 4;
      p.col(C.ink, lit ? 0.5 : 0.3);
      p.dot(cx + pts.x[i] + 1, cy + pts.y[i] * 0.75 + 1);
      p.col(lit ? edge : G[3], lit ? 0.9 : 0.5);
      p.dot(cx + pts.x[i], cy + pts.y[i] * 0.75);
    }
    if (sig) {
      const ck = crackOf(`eaxe|${sd % 997}`, sd, starBranches(sd, 5, a, 6, 13, 1), 0.45, 0);
      drawCrack(p, ck, cx, cy, (1 - left / SIG) * 13, C.groove, null, 0.85);
    }
    hopBits(
      p,
      sd,
      time,
      k,
      10,
      (i) => {
        const th = TAU * hash(sd, i, 5);
        const rr = R * Math.sqrt(hash(sd, i, 6));
        return [cx + Math.cos(th) * rr, cy + Math.sin(th) * rr * 0.75];
      },
      G[4],
    );
  }),
);

registerImpactPainter('f15b_axe', {
  life: 1.6,
  shake: 0.32,
  paint: guarded(
    (g, rec: ImpactRec, px: number, py: number, S: number, age: number, time: number) => {
      const cx = rec.x * S;
      const cy = rec.y * S;
      const p = new Pen(g, px, py, cx, cy);
      const R = (rec.r ?? 1.5) * S;
      const sd = rec.seed >>> 0;
      const few = reduced();
      const fade = 1 - k01((age - 1.1) / 0.5);
      const ck = crackOf(
        `eaxe|${sd % 997}`,
        sd,
        starBranches(sd, 7, 0.4, R * 0.6, R * 1.25, 2),
        0.42,
        0.3,
      );
      drawCrack(p, ck, cx, cy, ck.max * eOut3(k01(age / 0.14)), C.groove, C.lip, fade);
      p.col(C.lip, 0.9 * fade);
      lens(p, cx + 1, cy + 1, 1, 0, 7, 2.2);
      p.col(C.ink, fade);
      lens(p, cx, cy, 1, 0, 6.5, 1.7);
      // Призрачная секира в полу: тает строками.
      if (age < 0.55) {
        const im = ghostAxe();
        p.scan = scanOf(time);
        p.alpha(1 - age / 0.55);
        p.img(im, cx - 15, cy - im.height + 5);
        p.scan = -1;
      }
      hitStar(p, cx, cy - 2, age, 0.13, 15, 0.2, G[5]);
      if (age < 0.3) {
        const k = age / 0.3;
        ring(
          p,
          cx,
          cy,
          5 + 30 * eOut2(k),
          C.white,
          0.95 * (1 - k),
          (_a, i) => hash(i >> 2, sd, 9) > 0.22,
          0.6,
        );
        ring(
          p,
          cx,
          cy,
          4 + 30 * eOut2(k),
          G[4],
          0.7 * (1 - k),
          (_a, i) => hash(i >> 2, sd, 10) > 0.4,
        );
      }
      chunks(p, sd + 1, age, cx, cy, few ? 4 : 10, 0, Math.PI, 26, 44, 70, 80, [1.1, 1.6], 0.35, 1);
      dust(p, sd + 2, age, cx, cy, few ? 4 : 9, 0, Math.PI, 24, 30, 2, 8, 6, 1.1, 0, 0.55);
      dust(
        p,
        sd + 3,
        age,
        cx,
        cy - 4,
        few ? 2 : 4,
        -Math.PI / 2,
        1.2,
        10,
        10,
        2,
        5,
        8,
        0.6,
        0,
        0.35,
      );
    },
  ),
});

// ---- Челюсти: укус змея (конус) и головы гидры (круг) -----------------------

/**
 * Челюсть: дёсна — полумесяц вдоль (nx, ny), выгнутый от пасти, и `n`
 * клыков треугольниками остриём к (dx, dy) — к середине пасти.
 */
function teeth(
  p: Pen,
  x: number,
  y: number,
  nx: number,
  ny: number,
  dx: number,
  dy: number,
  n: number,
  gapT: number,
  c: string,
  a: number,
): void {
  const half = ((n - 1) / 2) * gapT + 2;
  // Дёсна: дуга, концы загнуты к пасти.
  p.col(G[2], 0.85 * a);
  for (let s = -half; s <= half; s += 0.5) {
    const bend = (s / half) * (s / half) * 3;
    const gx = x + nx * s + dx * bend;
    const gy = y + ny * s + dy * bend;
    p.dot(gx - dx, gy - dy, 1, 1);
    p.dot(gx - dx * 2, gy - dy * 2, 1, 1);
  }
  for (let i = 0; i < n; i++) {
    const s = (i - (n - 1) / 2) * gapT;
    const q = Math.abs(s / half);
    const bend = q * q * 3;
    const bx = x + nx * s + dx * bend;
    const by = y + ny * s + dy * bend;
    const len = 4.2 - q * 1.6;
    // Клык: основание в два пикселя, остриё — один.
    for (let t = 0; t <= len; t += 0.5) {
      const w = t < len * 0.5 ? 1 : 0;
      p.col(C.ink, a * 0.55);
      p.dot(bx + dx * t + 1, by + dy * t + 1);
      p.col(t > len - 1 ? C.white : c, a);
      p.dot(bx + dx * t, by + dy * t);
      if (w) p.dot(bx + dx * t + nx, by + dy * t + ny);
    }
  }
}

registerZonePainter(
  'f15b_bite',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const st = z as Strike;
    const { k, left } = warnOf(st);
    const sig = left < SIG;
    const tk = !reduced() && tick(left);
    const cx = st.x * S;
    const cy = st.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = st.r * S;
    const isCone = st.shape === 'cone';
    const a = st.ang ?? Math.PI / 2;
    const arc = st.arc ?? 1.3;
    const a0 = a - arc / 2;
    if (isCone) {
      p.col(G[0], 0.5 + 0.1 * k);
      fillSector(p, cx, cy, S * 0.5, R, a0, a0 + arc);
      const rf = S * 0.5 + (R - S * 0.5) * Math.pow(k, 1.5);
      p.col(sig ? G[2] : G[1], (tk ? 0.7 : 0.44) + 0.14 * k);
      fillSector(p, cx, cy, S * 0.5, rf, a0, a0 + arc);
      const run = time * (20 + 50 * k);
      sectorRim(
        p,
        cx,
        cy,
        R,
        a0,
        arc,
        S * 0.5,
        sig ? (tk ? C.white : G[5]) : k > 0.5 ? G[4] : G[3],
        0.75 + 0.25 * k,
        sig ? undefined : (u) => mod(u - run, 8) < 5,
      );
    } else {
      p.col(G[0], 0.5 + 0.1 * k);
      oval(p, cx, cy, R, R * 0.75);
      const rf = R * Math.pow(k, 1.5);
      p.col(sig ? G[2] : G[1], (tk ? 0.7 : 0.44) + 0.14 * k);
      oval(p, cx, cy, rf, rf * 0.75);
      const pts = circle(R);
      const run = Math.floor(time * (12 + 30 * k));
      for (let i = 0; i < pts.x.length; i++) {
        if (!sig && mod(i - run, 7) >= 4) continue;
        p.col(sig ? (tk ? C.white : G[5]) : G[4], 0.9);
        p.dot(cx + pts.x[i], cy + pts.y[i] * 0.75);
      }
    }
    // Челюсти смыкаются: верхний и нижний ряд зубов идут друг к другу.
    const jx = isCone ? cx + Math.cos(a) * R * 0.6 : cx;
    const jy = isCone ? cy + Math.sin(a) * R * 0.6 : cy;
    const ax = isCone ? Math.cos(a) : 0;
    const ay = isCone ? Math.sin(a) : 1;
    const nx = -ay;
    const ny = ax;
    const gap = (isCone ? R * 0.45 : R * 0.62) * (1 - Math.pow(k, 1.6)) + 2;
    const c = sig ? C.white : k > 0.6 ? G[5] : G[4];
    teeth(p, jx - nx * gap, jy - ny * gap, ax, ay, nx, ny, 5, 4, c, 0.45 + 0.55 * k);
    teeth(p, jx + nx * gap, jy + ny * gap, ax, ay, -nx, -ny, 5, 4, c, 0.45 + 0.55 * k);
  }),
);

registerImpactPainter('f15b_bite', {
  life: 1.0,
  shake: 0.2,
  paint: guarded(
    (g, rec: ImpactRec, px: number, py: number, S: number, age: number, time: number) => {
      const cx = rec.x * S;
      const cy = rec.y * S;
      const p = new Pen(g, px, py, cx, cy);
      const R = (rec.r ?? 1.2) * S;
      const sd = rec.seed >>> 0;
      const few = reduced();
      const isCone = rec.shape === 'cone';
      const a = rec.ang ?? Math.PI / 2;
      const jx = isCone ? cx + Math.cos(a) * R * 0.6 : cx;
      const jy = isCone ? cy + Math.sin(a) * R * 0.6 : cy;
      const ax = isCone ? Math.cos(a) : 0;
      const ay = isCone ? Math.sin(a) : 1;
      const nx = -ay;
      const ny = ax;
      // Щелчок: ряды сомкнуты, тают строками.
      if (age < 0.35) {
        const al = 1 - age / 0.35;
        p.scan = scanOf(time);
        teeth(p, jx - nx * 2, jy - ny * 2, ax, ay, nx, ny, 5, 4, age < 0.06 ? C.white : G[5], al);
        teeth(p, jx + nx * 2, jy + ny * 2, ax, ay, -nx, -ny, 5, 4, age < 0.06 ? C.white : G[5], al);
        p.scan = -1;
      }
      hitStar(p, jx, jy - 2, age, 0.1, 12, a + 0.4, G[4]);
      if (age < 0.28) {
        const k = age / 0.28;
        ring(
          p,
          jx,
          jy,
          4 + 18 * eOut2(k),
          G[4],
          0.85 * (1 - k),
          (_a, i) => hash(i >> 1, sd, 4) > 0.25,
          0.5,
        );
      }
      // Брызги эктоплазмы и туманность из прикуса.
      drops(
        p,
        sd,
        age,
        few ? 6 : 14,
        (i) => [jx, jy, (i / 14) * TAU],
        30,
        40,
        30,
        40,
        () => 0.02,
        ghostCol,
        G[2],
        [0.6, 0.95],
      );
      drops(
        p,
        sd + 1,
        age,
        few ? 3 : 8,
        (i) => [jx, jy, (i / 8) * TAU + 0.4],
        20,
        30,
        20,
        30,
        () => 0.03,
        nebCol,
        C.neb[2],
        [0.6, 0.95],
      );
    },
  ),
});

// ---- Полосы пламени змея (линии 0,5 с просветами) ---------------------------

registerZonePainter(
  'f15b_flame',
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
    const hw = (st.w ?? 0.5) * S;
    const sd = seedOf(st.id);
    p.col(G[0], 0.5 + 0.1 * k);
    fillLane(p, cx, cy, ux, uy, 0, L, hw);
    // Фитиль: огонь бежит от змея к концу полосы.
    const lf = L * Math.pow(k, 1.25);
    // Сигнал мигает умеренно: полоса не должна слепить и прятать героя.
    p.col(sig ? G[2] : G[1], (tk ? 0.56 : 0.42) + 0.1 * k);
    fillLane(p, cx, cy, ux, uy, 0, lf, hw * (0.5 + 0.5 * k));
    for (let j = -1; j <= 1; j++) {
      const f = mod(Math.floor(time * 14) + j + sd, 4);
      const im = flameImg(3 + 4 * k + (j === 0 ? 2 : 0), f, 1);
      p.alpha(0.95);
      p.img(
        im,
        cx + ux * lf + nx * j * hw * 0.55 - im.width / 2,
        cy + uy * lf + ny * j * hw * 0.55 - im.height + 1,
      );
    }
    // Языки по полосе подрагивают — пламя уже там, только ждёт.
    for (let s = 6; s < lf - 6; s += 9) {
      const h = 1 + Math.floor(hash(Math.floor(s), Math.floor(time * 10), sd) * 3 * k);
      p.col(G[3], 0.55);
      p.dot(cx + ux * s, cy + uy * s - h, 1, h);
    }
    const run = time * (30 + 70 * k);
    const edge = sig ? (tk ? C.white : G[5]) : k > 0.5 ? G[4] : G[3];
    for (let s = 0; s < L; s += 1) {
      if (!sig && mod(s - run, 9) >= 5) continue;
      for (const side of [-1, 1]) {
        p.col(C.ink, 0.5);
        p.dot(cx + ux * s + nx * (hw + 1) * side, cy + uy * s + ny * (hw + 1) * side);
        p.col(edge, 0.8 + 0.2 * k);
        p.dot(cx + ux * s + nx * hw * side, cy + uy * s + ny * hw * side);
      }
    }
  }),
);

registerImpactPainter('f15b_flame', {
  life: 1.3,
  shake: 0.07,
  above: true,
  paint: guarded(
    (g, rec: ImpactRec, px: number, py: number, S: number, age: number, time: number) => {
      const cx = rec.x * S;
      const cy = rec.y * S;
      const p = new Pen(g, px, py, cx, cy);
      const a = rec.ang ?? 0;
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      const nx = -uy;
      const ny = ux;
      const L = (rec.r ?? 8) * S;
      const hw = (rec.w ?? 0.5) * S;
      const sd = rec.seed >>> 0;
      const few = reduced();
      const occ = occOf(S);
      // Выжженная полоса — на полу.
      p.occ = occ;
      p.col('#0c1028', 0.55 * (1 - k01((age - 0.6) / 0.7)));
      fillLane(p, cx, cy, ux, uy, 0, L, hw * 0.8, true);
      // Языки призрачного пламени встают по полосе от змея к концу.
      const step = few ? 9 : 5;
      for (let s = 2; s < L; s += step * (0.6 + 0.8 * hash(sd, Math.floor(s), 9))) {
        const t = age - 0.13 * (s / L) - 0.06 * hash(sd, Math.floor(s), 8);
        if (t < 0) continue;
        const life = 0.4 + 0.45 * hash(sd, Math.floor(s), 1);
        if (t > life) continue;
        const hgt =
          (3 + 10 * hash(sd, Math.floor(s), 2)) *
          eOut2(k01(t / 0.07)) *
          (1 - eIn2(k01((t - life * 0.5) / (life * 0.5))));
        if (hgt < 2) continue;
        const o = (hash(sd, Math.floor(s), 3) - 0.5) * hw * 1.2;
        const im = flameImg(hgt, mod(Math.floor(time * 12) + Math.floor(s), 4), 1);
        const x = cx + ux * s + nx * o;
        const y = cy + uy * s + ny * o;
        p.alpha(0.95);
        p.img(im, x - im.width / 2, y - im.height + 1, y);
      }
      p.occ = null;
      if (age < 0.06) {
        p.col(C.white, 1 - age / 0.06);
        fillLane(p, cx, cy, ux, uy, 0, L, 0.8);
      }
      embers(
        p,
        sd,
        age,
        few ? 6 : 16,
        0.9,
        16,
        (i) => 0.1 + 0.4 * hash(sd, i, 5),
        (i) => {
          const s = L * hash(sd, i, 6);
          return [
            cx + ux * s + nx * (hash(sd, i, 7) - 0.5) * hw,
            cy + uy * s + ny * (hash(sd, i, 7) - 0.5) * hw,
          ];
        },
        0.9,
        ghostCol,
      );
    },
  ),
});

// ---- Гроза Короля демонов (круги r 1,45 клетками, поверх темноты) ----------

interface BoltCol {
  img: HTMLCanvasElement;
  w: number;
  h: number;
}
const bolts = new Map<number, BoltCol>();
/** Столб молнии высоты H, вариант v: зигзаг с отростками (призрачно-фиолетовый). */
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
    const kk = X * 4096 + Y;
    if ((pix.get(kk) ?? 0) < c) pix.set(kk, c);
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
  for (let kq = 0; kq < 2; kq++) {
    const i = 1 + Math.floor(hash(v, kq, 72) * (n - 2));
    const [x, y] = pts[i];
    const s = hash(v, kq, 73) < 0.5 ? -1 : 1;
    const l = 5 + hash(v, kq, 74) * 6;
    const m = Math.ceil(l);
    for (let q = 0; q <= m; q++) put(x + (s * l * 0.6 * q) / m, y + (l * 0.7 * q) / m, 2);
  }
  for (const [kk, c] of pix) p.set(Math.floor(kk / 4096), kk % 4096, c === 2 ? core : glow);
  b = { img: p.canvas(), w: W, h: H + 2 };
  bolts.set(key, b);
  return b;
}

const zapCol = (k: number) =>
  k < 0.3 ? '#ffffff' : k < 0.6 ? C.vio[3] : k < 0.85 ? C.vio[2] : C.vio[1];

registerZonePainter(
  'f15b_bolt',
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
    // На полу (за телами — нет): круг и руна.
    p.col(C.vio[0], 0.42 + 0.1 * k);
    oval(p, cx, cy, R, R * 0.75);
    const rf = R * Math.pow(k, 1.5);
    p.col(C.vio[1], (tk ? 0.6 : 0.36) + 0.12 * k);
    oval(p, cx, cy, rf, rf * 0.75);
    const spin = time * (1 + 3 * k);
    for (let i = 0; i < 6; i++) {
      const th = spin + (i / 6) * TAU;
      p.col(sig ? C.white : C.vio[3], 0.5 + 0.4 * k);
      for (let r = R * 0.25; r < R * 0.85; r += 2)
        p.dot(cx + Math.cos(th) * r, cy + Math.sin(th) * r * 0.75);
    }
    const pts = circle(R);
    const run = Math.floor(time * (12 + 30 * k));
    for (let i = 0; i < pts.x.length; i++) {
      if (!sig && mod(i - run, 7) >= 4) continue;
      p.col(sig ? (tk ? C.white : C.vio[3]) : C.vio[2], 0.9);
      p.dot(cx + pts.x[i], cy + pts.y[i] * 0.75);
    }
    // Заряд стягивается к центру.
    for (let i = 0; i < 8; i++) {
      const ph = mod(time * (0.8 + 2 * k) + hash(sd, i, 1), 1);
      const th = TAU * hash(sd, i, 2);
      const r = (1 - ph) * R * 1.1;
      p.col(C.vio[3], Math.sin(Math.PI * ph) * (0.4 + 0.5 * k));
      p.dot(cx + Math.cos(th) * r, cy + Math.sin(th) * r * 0.75 - ph * 4);
    }
    // Последние 0,2 с — пилотный разряд с неба, мерцает.
    if (sig && Math.floor(time * 30) % 2 === 0) {
      let x = cx;
      for (let i = 0; i < 8; i++) {
        const nx2 = cx + (i === 7 ? 0 : (hash(sd, i, Math.floor(time * 20)) - 0.5) * 8);
        p.col(C.vio[3], 0.7);
        p.line(x, cy - 72 + i * 9, nx2, cy - 72 + (i + 1) * 9);
        x = nx2;
      }
    }
  }),
);

registerImpactPainter('f15b_bolt', {
  life: 1.0,
  shake: 0.05,
  flash: 0.2,
  flashRgb: '190,160,255',
  above: true,
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const cx = rec.x * S;
    const cy = rec.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const sd = rec.seed >>> 0;
    const few = reduced();
    const occ = occOf(S);
    p.occ = occ;
    const sc = scorchImg(11, 2);
    p.alpha(0.8 * (1 - k01((age - 0.5) / 0.5)));
    p.img(sc, cx - sc.width / 2, cy - sc.height / 2);
    p.occ = null;
    // Столб молнии: два кадра яркий, потом мерцает и гаснет.
    if (age < 0.24 && (age < 0.1 || Math.floor(age * 40) % 2 === 0)) {
      const H = 96;
      const b = boltCol(sd & 7, H);
      p.alpha(age < 0.1 ? 1 : 0.6);
      p.img(b.img, cx - 11, cy - H);
    }
    hitStar(p, cx, cy - 2, age, 0.12, 13, 0.5, C.vio[3]);
    // Разряд по полу — короткие ветви.
    if (age < 0.2) {
      for (let i = 0; i < 5; i++) {
        const th = TAU * hash(sd, i, 1);
        let x = cx;
        let y = cy;
        p.col(i % 2 ? C.white : C.vio[3], 1 - age / 0.2);
        for (let q = 0; q < 4; q++) {
          const nx2 = x + Math.cos(th + (hash(sd, i * 4 + q, 2) - 0.5) * 1.2) * 5;
          const ny2 = y + Math.sin(th + (hash(sd, i * 4 + q, 2) - 0.5) * 1.2) * 3.5;
          p.line(x, y, nx2, ny2);
          x = nx2;
          y = ny2;
        }
      }
    }
    sparks(p, sd + 1, age, cx, cy - 2, few ? 5 : 12, 0, Math.PI, 40, 70, 0.45, 60, zapCol);
    dust(p, sd + 2, age, cx, cy, few ? 2 : 4, -Math.PI / 2, 1.4, 10, 10, 2, 6, 8, 0.8, 1, 0.5);
  }),
});

// ---- Головы гидры: огонь навесом и лёд веером --------------------------------

/** Призрачный огненный шар, кадр f, хвост по направлению d (0…7). */
function ghostFireball(f: number, d: number): Sprite {
  const key = 130000 + f * 8 + d;
  let img = sprites.get(key);
  if (!img) {
    const p = new Px(20, 20);
    const a = (d / 8) * TAU;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    // Хвост: три языка назад по полёту, мерцают.
    for (let j = 0; j < 3; j++) {
      const off = (j - 1) * 1.6;
      const len = 6 + ((f + j) % 3) * 1.5;
      for (let s = 2; s < len; s += 0.5) {
        const w = 1.6 * (1 - s / len);
        for (let o = -w; o <= w; o += 0.5)
          p.set(
            Math.round(10 - ux * s - uy * (off + o)),
            Math.round(10 - uy * s + ux * (off + o)),
            hx(s < len * 0.5 ? G[3] : G[2], 220),
          );
      }
    }
    p.ell(10, 10, 4.3 + (f % 2) * 0.3, 4.1, hx(G[2]));
    p.ell(10 - ux * 0.5, 9.6, 3, 2.8, hx(G[4]));
    p.ell(9.5 - ux * 0.8, 9.2, 1.6, 1.4, hx(C.white));
    p.outline(hx(G[0]));
    img = p.canvas();
    sprites.set(key, img);
  }
  return { img, ax: 10, ay: 10 };
}

registerShotPainter('f15b_fireball', (s: Shot, time: number) => {
  const a = Math.atan2(s.vy, s.vx);
  const d = mod(Math.round((a / TAU) * 8), 8);
  return ghostFireball(mod(Math.floor(time * 12 + s.id), 4), d);
});

registerImpactPainter('f15b_fireball', {
  life: 0.9,
  shake: 0.12,
  above: true,
  paint: guarded(
    (g, rec: ImpactRec, px: number, py: number, S: number, age: number, time: number) => {
      const cx = rec.x * S;
      const cy = rec.y * S;
      const p = new Pen(g, px, py, cx, cy);
      const sd = rec.seed >>> 0;
      const few = reduced();
      hitStar(p, cx, cy - 3, age, 0.1, 11, 0.3, G[4]);
      // Огонь разлетается кольцом языков и опадает.
      for (let i = 0; i < (few ? 5 : 9); i++) {
        const th = (i / 9) * TAU;
        const t = age - 0.02 * (i % 3);
        if (t < 0 || t > 0.45) continue;
        const r = 4 + 9 * eOut2(k01(t / 0.2));
        const h = 8 * (1 - t / 0.45);
        if (h < 2) continue;
        const im = flameImg(h, mod(Math.floor(time * 14) + i, 4), 1);
        p.alpha(0.95);
        p.img(
          im,
          cx + Math.cos(th) * r - im.width / 2,
          cy + Math.sin(th) * r * 0.7 - im.height + 1,
        );
      }
      if (age < 0.3)
        ring(
          p,
          cx,
          cy,
          4 + 14 * eOut2(age / 0.3),
          G[4],
          0.85 * (1 - age / 0.3),
          (_a, i) => hash(i >> 1, sd, 3) > 0.3,
          0.5,
        );
      embers(
        p,
        sd,
        age,
        few ? 5 : 12,
        0.8,
        14,
        (i) => 0.03 * i,
        (i) => [cx + (hash(sd, i, 4) - 0.5) * 14, cy + (hash(sd, i, 5) - 0.5) * 8],
        0.9,
        ghostCol,
      );
    },
  ),
});

/** Ледяной осколок: направление d (0…15), с искрящимся следом. */
function iceShot(d: number, f: number): Sprite {
  const key = 140000 + d * 2 + f;
  let img = sprites.get(key);
  if (!img) {
    const p = new Px(22, 22);
    const a = (d / 16) * TAU;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    // След: искры назад.
    for (let j = 0; j < 4; j++) {
      const s = 6 + j * 2.5;
      const o = ((j + f) % 2 ? 1 : -1) * (j * 0.4);
      p.set(
        Math.round(11 - ux * s - uy * o),
        Math.round(11 - uy * s + ux * o),
        hx(j < 2 ? '#c8f4ff' : '#6ab0e0', 230 - j * 40),
      );
    }
    const q = new Px(22, 22);
    for (let s = -4; s <= 6; s += 0.5) {
      const w = s > 0 ? 2.2 * (1 - s / 6.5) : 2.2 * (1 + s / 5);
      for (let o = -w; o <= w; o += 0.5) {
        const c = o < -0.5 ? '#ffffff' : o < 0.8 ? '#90e0ff' : '#3a7aa8';
        q.set(Math.round(11 + ux * s - uy * o), Math.round(11 + uy * s + ux * o), hx(c));
      }
    }
    q.outline(hx('#10304a'));
    for (let i = 0; i < q.data.length; i += 4)
      if (q.data[i + 3]) p.data.set(q.data.subarray(i, i + 4), i);
    img = p.canvas();
    sprites.set(key, img);
  }
  return { img, ax: 11, ay: 11 };
}

registerShotPainter('f15b_ice', (s: Shot, time: number) => {
  const a = Math.atan2(s.vy, s.vx);
  return iceShot(mod(Math.round((a / TAU) * 16), 16), mod(Math.floor(time * 10 + s.id), 2));
});

registerImpactPainter('f15b_ice', {
  life: 0.9,
  shake: 0.06,
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const cx = rec.x * S;
    const cy = rec.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const sd = rec.seed >>> 0;
    const few = reduced();
    const back = Math.atan2(-(rec.vy ?? 0), -(rec.vx ?? 1));
    hitStar(p, cx, cy - 3, age, 0.08, 9, back, '#c8f4ff');
    chunks(p, sd, age, cx, cy, few ? 4 : 9, back, 1.4, 25, 45, 40, 50, [0.6, 0.9], 0.1, 3);
    if (age < 0.35)
      ring(
        p,
        cx,
        cy,
        3 + 12 * eOut2(age / 0.35),
        '#d8f8ff',
        0.85 * (1 - age / 0.35),
        (_a, i) => i % 3 !== 1,
        0.4,
      );
    dust(p, sd + 1, age, cx, cy, few ? 2 : 4, back, 1.2, 10, 10, 2, 5, 4, 0.6, 5, 0.5);
  }),
});

// ---- Лужа огня, облако яда, туман под эхом ---------------------------------

registerZonePainter(
  'f15b_flames',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const zz = z as Zone;
    const cx = zz.x * S;
    const cy = zz.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = zz.r * S;
    const sd = seedOf(zz.id);
    const t = zz.t - (zz.warn ?? 0);
    const fade = Math.min(k01(t / 0.12), 1 - k01((t - (zz.life - 0.5)) / 0.5));
    if (zz.above) p.occ = occOf(S);
    const sc = scorchImg(R * 0.95, 2);
    p.alpha(0.7 * fade);
    p.img(sc, cx - sc.width / 2, cy - sc.height / 2);
    // Языки призрачного огня — каждый со своим дыханием.
    const n = reduced() ? 4 : 8;
    for (let i = 0; i < n; i++) {
      const th = TAU * hash(sd, i, 1);
      const r = R * 0.75 * Math.sqrt(hash(sd, i, 2));
      const x = cx + Math.cos(th) * r;
      const y = cy + Math.sin(th) * r * 0.7;
      const breath = 0.6 + 0.4 * Math.sin(time * (5 + 3 * hash(sd, i, 3)) + i * 2);
      const h = (4 + 6 * hash(sd, i, 4)) * breath * fade;
      if (h < 2) continue;
      const im = flameImg(h, mod(Math.floor(time * 12) + i, 4), 1);
      p.alpha(0.95);
      p.img(im, x - im.width / 2, y - im.height + 1, y);
    }
    p.occ = null;
    embers(
      p,
      sd,
      mod(time, 1.4),
      6,
      0.9,
      12,
      (i) => i * 0.2,
      (i) => [cx + (hash(sd, i, 5) - 0.5) * R * 1.4, cy + (hash(sd, i, 6) - 0.5) * R],
      0.8 * fade,
      ghostCol,
    );
  }),
);

registerZonePainter(
  'f15b_miasma',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const zz = z as Zone;
    const cx = zz.x * S;
    const cy = zz.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = zz.r * S;
    const sd = seedOf(zz.id);
    const warn = zz.warn ?? 0;
    if (zz.t < warn) {
      // Яд сочится из пола: пятно растёт, капли поднимаются, кромка сжимается.
      const k = zz.t / warn;
      const left = warn - zz.t;
      const sig = left < SIG;
      p.col(C.bog[0], 0.4 + 0.2 * k);
      oval(p, cx, cy, R * (0.3 + 0.7 * k), R * (0.2 + 0.5 * k));
      const pts = circle(R);
      const run = Math.floor(time * (10 + 20 * k));
      for (let i = 0; i < pts.x.length; i++) {
        if (!sig && mod(i - run, 6) >= 3) continue;
        p.col(sig && tick(left) ? C.white : C.bog[4], 0.8);
        p.dot(cx + pts.x[i], cy + pts.y[i] * 0.72);
      }
      embers(
        p,
        sd,
        mod(time, 1),
        8,
        0.7,
        10,
        (i) => i * 0.12,
        (i) => [cx + (hash(sd, i, 1) - 0.5) * R * 1.4, cy + (hash(sd, i, 2) - 0.5) * R],
        0.7 + 0.3 * k,
        (q) => (q < 0.5 ? C.bog[5] : C.bog[4]),
      );
      return;
    }
    const t = zz.t - warn;
    const fade = Math.min(k01(t / 0.25), 1 - k01((t - (zz.life - 0.6)) / 0.6));
    // Облако: клубы яда медленно ходят по кругу и дышат.
    for (let i = 0; i < 9; i++) {
      const th = (i / 9) * TAU + time * 0.35 * (i % 2 ? 1 : -1);
      const r = R * (0.2 + 0.55 * hash(sd, i, 3));
      const br = 0.8 + 0.2 * Math.sin(time * 2 + i);
      const im = puffImg(6, (5 + 4 * hash(sd, i, 4)) * br, i);
      p.alpha(0.5 * fade);
      p.img(
        im,
        cx + Math.cos(th) * r - im.width / 2,
        cy + Math.sin(th) * r * 0.7 - im.height / 2 - 3,
      );
    }
    for (let i = 0; i < 6; i++) {
      const ph = mod(time * 0.9 + hash(sd, i, 5), 1);
      if (ph < 0.7) continue;
      p.col(C.bog[5], 0.8 * fade);
      p.dot(cx + (hash(sd, i, 6) - 0.5) * R * 1.4, cy + (hash(sd, i, 7) - 0.5) * R - ph * 4);
    }
  }),
);

/** Лужа туманности: рваное пятно с брызгами вокруг (вариант v). */
registerZonePainter(
  'f15b_mist',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const zz = z as FxZone;
    const cx = zz.x * S;
    const cy = zz.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = zz.r * S;
    const sd = seedOf(zz.id);
    const m = mobOf(zz.mob);
    const rising = m?.mode === 'f15e_rise';
    const rk = rising ? k01(m!.t / 1.5) : 1;
    const dying = m?.mode === 'dying' ? 1 - k01(m!.t / 0.6) : 1;
    const thick = (rising ? 0.6 : 0.24) * dying;
    for (let i = 0; i < 6; i++) {
      const th = (i / 6) * TAU + time * 0.4;
      const im = puffImg(4, R * (0.35 + 0.15 * hash(sd, i, 1)), i);
      p.alpha(thick);
      p.img(
        im,
        cx + Math.cos(th) * R * 0.7 - im.width / 2,
        cy + Math.sin(th) * R * 0.35 - im.height / 2,
      );
    }
    // Струйки вверх.
    for (let i = 0; i < (rising ? 10 : 4); i++) {
      const ph = mod(time * 0.7 + hash(sd, i, 2), 1);
      const x = cx + (hash(sd, i, 3) - 0.5) * R * 1.6;
      p.col(G[4], (rising ? 0.7 : 0.35) * (1 - ph) * dying);
      p.dot(x + Math.sin(ph * 6 + i) * 1.5, cy - ph * (rising ? 30 : 14), 1, rising ? 3 : 2);
    }
    if (rising) {
      // Кольца вызова расходятся от ног, пока эхо проявляется.
      for (let j = 0; j < 2; j++) {
        const ph = mod(time * 1.6 + j * 0.5, 1);
        ring(
          p,
          cx,
          cy,
          R * (0.4 + 0.9 * ph),
          j ? G[4] : G[5],
          0.7 * (1 - ph) * (1 - rk * 0.5),
          (_a, i) => i % 3 !== 2,
        );
      }
    }
  }),
);

// =============================================================================
// ХОЗЯИН ПОДЗЕМЕЛЬЯ — приёмы владыки, стражи и сцены боя.
//
// Язык метки у владыки один на все приёмы. «Куда» — ночь-тень на полу и
// кольцо астролябии с бегущими рисками: золото — руки и звёзды, голубой
// кристалл — планеты, фиолет — волны тяготения. «Когда» — налив от центра:
// его фронт доходит до края ровно в урон; последние 0,2 с — белая кромка и
// «тик-тик». Метки лежат на полу поверх темноты (`above` мозга) и прячутся за
// телами ближе к камере (`occOf`); летящее — ладонь, планеты, метеоры — в
// воздухе, без заслонения.
// =============================================================================

/** Звёздная искра по доле жизни: белая → золото → фиолет. */
const starCol = (k: number) =>
  k < 0.2
    ? '#ffffff'
    : k < 0.45
      ? C.gold[3]
      : k < 0.7
        ? C.gold[2]
        : k < 0.88
          ? '#c890f0'
          : '#6a34a4';
/** Ледяная искра: белая → голубая. */
const iceCol = (k: number) =>
  k < 0.2 ? '#ffffff' : k < 0.5 ? C.ice[5] : k < 0.8 ? C.ice[4] : C.ice[3];
/** Фиолетовая искра плаща. */
const vioCol = (k: number) =>
  k < 0.2 ? '#ffffff' : k < 0.5 ? '#ecd4ff' : k < 0.8 ? '#c890f0' : '#6a34a4';

const bez = (a: number, c: number, b: number, u: number) =>
  (1 - u) * (1 - u) * a + 2 * (1 - u) * u * c + u * u * b;
const smooth3 = (u: number) => u * u * (3 - 2 * u);
const eIn3 = (t: number) => t * t * t;

/** Кадры техник владыки (планеты, камни метеоров): с вытеснением. */
const LFX = frameLRU<HTMLCanvasElement>(360);

/** Звёздочка-крест на сетке мира. */
function twinkle(
  p: Pen,
  x: number,
  y: number,
  r: number,
  c: string,
  a: number,
  core = '#ffffff',
): void {
  if (a <= 0.02) return;
  p.col(c, a);
  for (let i = 1; i <= r; i++) {
    p.dot(x + i, y);
    p.dot(x - i, y);
    p.dot(x, y + i);
    p.dot(x, y - i);
  }
  if (r >= 2) {
    p.col(c, a * 0.5);
    p.dot(x + 1, y + 1);
    p.dot(x - 1, y - 1);
    p.dot(x + 1, y - 1);
    p.dot(x - 1, y + 1);
  }
  p.col(core, a);
  p.dot(x, y);
}

/** Чей удар смотрит куда: угол приёма у владыки (`m.data.ang`). */
const angOf = (st: Strike): number => {
  const m = mobOf(st.from);
  if (m && m.data.ang !== undefined) return m.data.ang;
  if (m) return Math.atan2(st.y - m.y, st.x - m.x);
  return st.ang ?? 0;
};

/** Ладонь владыки в пикселях мира — ближняя к точке (tx, ty); кадра нет — центр фигуры. */
function handAt(m: Mob, S: number, tx: number, ty: number): [number, number] {
  const ox = m.x * S;
  const oy = m.y * S;
  let best: [number, number] | null = null;
  let bd = 1e9;
  for (const side of [-1, 1]) {
    const h = lordHandPx(m, side);
    if (!h) continue;
    const x = ox + h[0];
    const y = oy + h[1];
    const d = Math.hypot(x - tx, y - ty);
    if (d < bd) {
      bd = d;
      best = [x, y];
    }
  }
  return best ?? [ox, oy - 2.4 * S];
}

/** Риски астролябии наружу от окружности r: каждая четвёртая длиннее. */
function ticks(
  p: Pen,
  cx: number,
  cy: number,
  r: number,
  n: number,
  rot: number,
  len: number,
  c: string,
  a: number,
  keep?: (ang: number) => boolean,
): void {
  for (let j = 0; j < n; j++) {
    const t = rot + (j / n) * TAU;
    if (keep && !keep(Math.atan2(Math.sin(t), Math.cos(t)))) continue;
    const L = j % 4 === 0 ? len * 2 : len;
    const ux = Math.cos(t);
    const uy = Math.sin(t);
    p.lineS(cx + ux * (r + 1), cy + uy * (r + 1), cx + ux * (r + L), cy + uy * (r + L), c, a, 0.5);
  }
}

/**
 * Круглая метка владыки: тень, налив от центра (фронт доходит до края в
 * урон), кольцо с рисками крутится; последние 0,2 с — белая кромка и вспышки
 * внешнего кольца «тик-тик».
 */
function astroMark(
  p: Pen,
  cx: number,
  cy: number,
  R: number,
  k: number,
  left: number,
  time: number,
  sd: number,
  rim: string,
  hot: string,
  fill: string,
  nt = 16,
): void {
  const sig = left < SIG;
  const tk = !reduced() && tick(left);
  p.col(C.night[1], 0.32 + 0.28 * k);
  fillSector(p, cx, cy, 0, R, 0, TAU);
  const rf = R * (0.12 + 0.88 * Math.pow(k, 1.25));
  // Вспышка сигнала — белым светом: золото полупрозрачно над ночью давало бежевый.
  p.col(tk ? C.white : fill, sig ? (tk ? 0.24 : 0.5) : 0.16 + 0.26 * k);
  fillSector(p, cx, cy, 0, rf, 0, TAU);
  ring(
    p,
    cx,
    cy,
    rf,
    sig ? C.white : hot,
    0.45 + 0.5 * k,
    (_a, i) => hash(i >> 2, sd, 3) > 0.2,
    0.4,
  );
  const rc = sig ? (tk ? C.white : hot) : rim;
  ring(p, cx, cy, R, rc, sig ? 1 : 0.65 + 0.3 * k, undefined, 0.6);
  ticks(p, cx, cy, R, nt, time * (sd & 1 ? 0.8 : -0.8), 2, sig ? C.white : rim, 0.5 + 0.45 * k);
  if (sig) ring(p, cx, cy, R + 5, tk ? C.white : hot, 0.85, (_a, i) => i % 2 === 0);
}

/**
 * Полоса кольца [R − w, R + w]: ночь и цвет, двойная кромка, риски поперёк
 * бегут по кругу; фронт от `from` доходит до полосы ровно в урон. `keep(a)` —
 * дуга (проход в кольце).
 */
function bandAstro(
  p: Pen,
  cx: number,
  cy: number,
  R: number,
  w: number,
  k: number,
  left: number,
  sd: number,
  time: number,
  from: number,
  fill: string,
  edge: string,
  hot: string,
  keep?: (a: number) => boolean,
): void {
  const sig = left < SIG;
  const tk = !reduced() && tick(left);
  const r0 = Math.max(0, R - w);
  const r1 = R + w;
  const band = () => {
    if (!keep) {
      fillSector(p, cx, cy, r0, r1, 0, TAU);
      return;
    }
    for (let j = 0; j < 64; j++) {
      const b0 = -Math.PI + (j / 64) * TAU;
      const b1 = -Math.PI + ((j + 1) / 64) * TAU;
      if (keep((b0 + b1) / 2)) fillSector(p, cx, cy, r0, r1, b0, b1);
    }
  };
  const kk = (a: number) => !keep || keep(a);
  p.col(C.night[1], 0.3 + 0.2 * k);
  band();
  p.col(tk ? hot : fill, sig ? (tk ? 0.3 : 0.5) : 0.16 + 0.28 * k);
  band();
  const ec = sig ? (tk ? C.white : hot) : edge;
  ring(p, cx, cy, r1, ec, 0.7 + 0.3 * k, (a) => kk(a), 0.6);
  ring(p, cx, cy, r0, ec, 0.55 + 0.35 * k, (a) => kk(a), 0.5);
  // Риски поперёк полосы: каждая четвёртая — во всю ширину.
  const n = Math.max(12, Math.round((TAU * R) / 9));
  const rot = time * (sd & 1 ? 0.35 : -0.35);
  p.col(ec, 0.35 + 0.35 * k);
  for (let j = 0; j < n; j++) {
    const t = rot + (j / n) * TAU;
    if (!kk(Math.atan2(Math.sin(t), Math.cos(t)))) continue;
    const ux = Math.cos(t);
    const uy = Math.sin(t);
    const l0 = j % 4 === 0 ? r0 + 1 : R;
    p.line(cx + ux * l0, cy + uy * l0, cx + ux * (r1 - 1), cy + uy * (r1 - 1));
  }
  // «Когда»: фронт идёт от владыки и доходит до полосы в урон.
  const rf = from + (R - from) * Math.pow(k, 1.15);
  if (rf < r0 - 1)
    ring(
      p,
      cx,
      cy,
      rf,
      hot,
      0.3 + 0.55 * k,
      (a, i) => kk(a) && mod(i + Math.floor(time * 20), 5) < 3,
      0.4,
    );
  if (sig) ring(p, cx, cy, r1 + 2, tk ? C.white : hot, 0.85, (a, i) => kk(a) && i % 2 === 0);
}

/** Гребень волны контакта: светлое кольцо бежит наружу и гаснет. */
function crest(
  p: Pen,
  cx: number,
  cy: number,
  R: number,
  age: number,
  T: number,
  grow: number,
  col: string,
  sd: number,
  keep?: (a: number) => boolean,
): void {
  if (age >= T || age < 0) return;
  const k = age / T;
  const rc = R + grow * eOut2(k);
  const kk = (a: number, i: number) => (!keep || keep(a)) && hash(i >> 2, sd, 9) > 0.12;
  ring(p, cx, cy, rc - 2, C.ink, 0.45 * (1 - k), kk);
  ring(p, cx, cy, rc, age < 0.06 ? C.white : col, 0.95 * (1 - k), kk, 0.5);
  if (k < 0.5)
    ring(
      p,
      cx,
      cy,
      rc + 1,
      C.white,
      0.6 * (1 - k * 2),
      (a, i) => kk(a, i) && hash(i >> 1, sd, 7) > 0.5,
    );
}

/**
 * Фигура по пикселям: `inside(u, v)` — в долях R вдоль угла a и поперёк.
 * С меткой `tag` строки берутся из кеша (R — по полпикселя, угол — 1/64
 * оборота, центр — в середине пикселя): ладонь иначе считала силуэт по
 * пикселю каждый кадр.
 */
const SHAPES = frameLRU<number[]>(240);
function shapeRows(
  p: Pen,
  cx: number,
  cy: number,
  R: number,
  a: number,
  inside: (u: number, v: number) => boolean,
  tag?: string,
): void {
  if (R < 1) return;
  const aq = Math.round((a / TAU) * 64);
  const Rq = tag ? Math.round(R * 2) / 2 : R;
  const key = tag ? `${tag}|${Rq}|${mod(aq, 64)}` : '';
  let spans = tag ? SHAPES.get(key) : undefined;
  if (!spans) {
    spans = [];
    const A = tag ? (aq / 64) * TAU : a;
    const ux = Math.cos(A);
    const uy = Math.sin(A);
    const E = Math.ceil(Rq) + 1;
    const fx = tag ? 0.5 : cx - Math.floor(cx);
    const fy = tag ? 0.5 : cy - Math.floor(cy);
    for (let y = -E; y <= E; y++) {
      let run = NO_RUN;
      for (let x = -E; x <= E + 1; x++) {
        let on = false;
        if (x <= E) {
          const dx = (x + 0.5 - fx) / Rq;
          const dy = (y + 0.5 - fy) / Rq;
          on = inside(dx * ux + dy * uy, -dx * uy + dy * ux);
        }
        if (on && run === NO_RUN) run = x;
        if (!on && run !== NO_RUN) {
          spans.push(run, y, x - run);
          run = NO_RUN;
        }
      }
    }
    if (tag) SHAPES.set(key, spans);
  }
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  for (let i = 0; i < spans.length; i += 3)
    p.rect(x0 + spans[i], y0 + spans[i + 1], spans[i + 2], 1);
}

// ---- Ладонь: созвездие выходит из руки, встаёт над целью и падает ----------

/** Ладонь в долях радиуса: (вдоль руки, поперёк). */
const PALM_PTS: [number, number][] = [
  [-0.85, 0], // 0 запястье
  [-0.42, -0.4],
  [-0.42, 0.4],
  [0.14, -0.36], // 3..6 основания пальцев
  [0.18, -0.12],
  [0.18, 0.12],
  [0.14, 0.36],
  [0.5, -0.42], // 7..10 суставы
  [0.58, -0.14],
  [0.58, 0.14],
  [0.5, 0.42],
  [0.8, -0.47], // 11..14 кончики
  [0.92, -0.15],
  [0.92, 0.15],
  [0.8, 0.47],
  [-0.2, 0.58], // 15 большой палец
  [0.12, 0.86],
];
const PALM_LINES: [number, number][] = [
  [0, 1],
  [0, 2],
  [1, 3],
  [3, 4],
  [4, 5],
  [5, 6],
  [6, 2],
  [3, 7],
  [4, 8],
  [5, 9],
  [6, 10],
  [7, 11],
  [8, 12],
  [9, 13],
  [10, 14],
  [2, 15],
  [15, 16],
];
/** Пальцы силуэта: поперёк у основания, кончик вдоль; веером расходятся. */
const FINGERS: [number, number][] = [
  [-0.33, 0.78],
  [-0.11, 0.93],
  [0.11, 0.93],
  [0.33, 0.8],
];
const FING_W = 0.078;

/** Отрезок (ax, ay) → (bx, by) полуширины w: попала ли точка. */
function inSeg(u: number, v: number, ax: number, ay: number, bx: number, by: number, w: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = k01(((u - ax) * dx + (v - ay) * dy) / (dx * dx + dy * dy));
  return Math.hypot(u - ax - dx * t, v - ay - dy * t) <= w;
}

/** Силуэт ладони (тень, отпечаток): ладонь овалом, четыре пальца веером, большой. */
function inPalm(u: number, v: number): boolean {
  const pu = (u + 0.25) / 0.5;
  const pv = v / 0.42;
  if (pu * pu + pv * pv <= 1) return true;
  for (const [v0, tip] of FINGERS)
    if (inSeg(u, v, 0.05, v0 * 0.9, tip, v0 * 1.35, FING_W)) return true;
  return inSeg(u, v, -0.34, 0.32, 0.1, 0.62, 0.088);
}

/** Кромка фигуры: точка внутри, а сосед на пиксель — снаружи. */
function edgeOf(inside: (u: number, v: number) => boolean, R: number, a: number) {
  const ex = Math.cos(a) / R;
  const ey = Math.sin(a) / R;
  return (u: number, v: number) =>
    inside(u, v) &&
    !(
      inside(u + ex, v - ey) &&
      inside(u - ex, v + ey) &&
      inside(u + ey, v + ex) &&
      inside(u - ey, v - ex)
    );
}

function palmDraw(
  p: Pen,
  cx: number,
  cy: number,
  R: number,
  a: number,
  show: number,
  col: string,
  al: number,
  time: number,
  sd: number,
): void {
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const pt = (i: number): [number, number] => {
    const [u, v] = PALM_PTS[i];
    return [cx + (u * ux - v * uy) * R, cy + (u * uy + v * ux) * R];
  };
  const n = PALM_LINES.length;
  for (let j = 0; j < n; j++) {
    const s = k01(show * (n + 3) - j);
    if (s <= 0) continue;
    const [i0, i1] = PALM_LINES[j];
    const [x0, y0] = pt(i0);
    const [x1b, y1b] = pt(i1);
    const x1 = x0 + (x1b - x0) * s;
    const y1 = y0 + (y1b - y0) * s;
    p.lineS(x0, y0, x1, y1, col, al, 0.4);
  }
  for (let i = 0; i < PALM_PTS.length; i++) {
    const s = k01(show * 1.4 - i / PALM_PTS.length);
    if (s <= 0) continue;
    const [x, y] = pt(i);
    const tw = 0.6 + 0.4 * Math.sin(time * 7 + hash(sd, i, 41) * 9);
    const tip = i >= 11 && i <= 14;
    twinkle(p, x, y, tip ? 2 : 1, tip ? C.gold[3] : col, al * s * tw, '#ffffff');
  }
}

/** Ладонь выходит из руки и встаёт над целью за столько секунд. */
const PALM_RISE = 0.42;

registerZonePainter(
  'f15b_palm',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const st = z as Strike;
    const { k, left } = warnOf(st);
    const sig = left < SIG;
    const cx = st.x * S;
    const cy = st.y * S;
    const p = new Pen(g, px, py, cx, cy);
    p.occ = occOf(S);
    const R = st.r * S;
    const sd = seedOf(st.id);
    const a = angOf(st);
    astroMark(p, cx, cy, R, k, left, time, sd, C.gold[1], C.gold[3], C.vio[1]);
    // Высота: ладонь встаёт над целью, висит, в последние 0,2 с падает.
    const H = S * 1.7;
    const rise = eOut2(k01(st.t / PALM_RISE));
    const drop = k01(1 - left / SIG);
    const h = H * (1 - eIn3(drop)) + Math.sin(time * 6) * 1.5 * (1 - drop) * rise;
    // Тень ладони: большая и бледная, пока ладонь высоко, — чёткая под ней.
    const near = k01(1 - h / H);
    p.col(C.ink, (0.18 + 0.42 * near) * rise);
    shapeRows(p, cx, cy, R * 0.92 * (1 + 0.45 * (1 - near)), a, inPalm, 'p');
    // Ладонь-созвездие: из руки владыки — над целью.
    p.occ = null;
    const lord = mobOf(st.from);
    const [hx2, hy2] = lord ? handAt(lord, S, cx, cy) : [cx, cy - H];
    const ax = hx2 + (cx - hx2) * rise;
    const ay = hy2 + (cy - h - hy2) * rise;
    const Rp = R * 0.92 * (0.35 + 0.65 * rise);
    // Нить света от руки к запястью — ладонь держит владыка.
    if (lord) {
      const wx = ax - Math.cos(a) * Rp * 0.85;
      const wy = ay - Math.sin(a) * Rp * 0.85;
      const n = Math.max(4, Math.floor(Math.hypot(wx - hx2, wy - hy2) / 3));
      const run = Math.floor(time * 30);
      for (let j = 0; j < n; j++) {
        if (mod(j - run, 4) >= 2) continue;
        const f = j / n;
        p.col(C.gold[2], (0.25 + 0.35 * k) * (1 - drop));
        p.dot(hx2 + (wx - hx2) * f, hy2 + (wy - hy2) * f - Math.sin(f * Math.PI) * 6);
      }
    }
    // Ладонь: ночной силуэт с золотой кромкой — читается и на плаще владыки.
    p.col(C.night[0], 0.55 + 0.2 * k);
    shapeRows(p, ax, ay, Rp, a, inPalm, 'p');
    p.col(sig ? C.white : C.gold[1], 0.7 + 0.3 * k);
    shapeRows(p, ax, ay, Rp, a, edgeOf(inPalm, Math.round(Rp * 2) / 2, a), 'pe');
    palmDraw(
      p,
      ax,
      ay,
      Rp,
      a,
      Math.min(1, 0.3 + rise),
      sig ? C.white : C.gold[2],
      0.55 + 0.45 * k,
      time,
      sd,
    );
    // Падает: полосы скорости над ладонью.
    if (drop > 0 && !reduced())
      for (let i = 0; i < 5; i++) {
        const x = ax + (i - 2) * Rp * 0.32;
        const y = ay - Rp * 0.55 - hash(sd, i, 44) * 4;
        p.col(C.white, 0.7 * drop);
        p.line(x, y - 4 - 10 * drop, x, y);
      }
  }),
);

/** Угол отпечатка по записи контакта: владыка к концу следа может смотреть иначе. */
const PALM_ANG = new Map<number, number>();

registerImpactPainter('f15b_palm', {
  life: 1.2,
  shake: 0.32,
  above: true,
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const cx = rec.x * S;
    const cy = rec.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = (rec.r ?? 1.7) * S;
    const sd = rec.seed >>> 0;
    const few = reduced();
    let a = PALM_ANG.get(sd);
    if (a === undefined) {
      a = lordNow()?.data.ang ?? 0;
      PALM_ANG.set(sd, a);
      if (PALM_ANG.size > 12) PALM_ANG.delete(PALM_ANG.keys().next().value as number);
    }
    const f = 1 - k01(age / 1.2);
    // Вмятина и отпечаток ладони: белый → золото → фиолет, остывает.
    p.occ = occOf(S);
    p.col(C.night[0], 0.5 * f);
    fillSector(p, cx, cy, 0, R * 0.95, 0, TAU);
    const hot =
      age < 0.05
        ? C.white
        : age < 0.16
          ? C.gold[3]
          : age < 0.4
            ? C.gold[2]
            : age < 0.7
              ? '#c890f0'
              : '#6a34a4';
    p.col(hot, (age < 0.1 ? 0.75 : 0.4) * f);
    shapeRows(p, cx, cy, R * 0.92, a, inPalm, 'p');
    p.col(hot, Math.min(1, 1.5 * f));
    shapeRows(p, cx, cy, R * 0.92, a, edgeOf(inPalm, Math.round(R * 1.84) / 2, a), 'pe');
    ring(p, cx, cy, R, C.gold[2], 0.8 * f * f, (_a, i) => hash(i >> 1, sd, 5) > 0.3);
    p.occ = null;
    hitStar(p, cx, cy - 2, age, 0.1, R * 1.05, sd * 0.01, C.gold[2]);
    crest(p, cx, cy, R, age, 0.42, S * 1.4, C.gold[3], sd);
    crest(p, cx, cy, R * 0.7, age - 0.07, 0.4, S * 1.1, '#c890f0', sd + 1);
    p.occ = occOf(S);
    dust(p, sd, age, cx, cy, few ? 5 : 10, 0, 0.5, 30, 30, 3, 7, 6, 0.9, 0, 0.6, undefined, (i) => {
      const t = (i / 10) * TAU + hash(sd, i, 45);
      return [cx + Math.cos(t) * R * 0.85, cy + Math.sin(t) * R * 0.85, t];
    });
    chunks(
      p,
      sd,
      age,
      cx,
      cy,
      few ? 3 : 7,
      0,
      0.6,
      40,
      50,
      60,
      50,
      [0.6, 1.1],
      0.25,
      1,
      undefined,
      (i) => {
        const t = (i / 7) * TAU + hash(sd, i, 46);
        return [cx + Math.cos(t) * R * 0.6, cy + Math.sin(t) * R * 0.6, t];
      },
    );
    p.occ = null;
    sparks(p, sd, age, cx, cy, few ? 6 : 14, -Math.PI / 2, 1.2, 40, 70, 0.6, 90, starCol);
    // Созвездие рассеивается вверх.
    const k = k01(age / 0.9);
    if (k < 1) {
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      PALM_PTS.forEach(([u, v], i) => {
        const z = 30 * eOut2(k) * (0.6 + 0.4 * hash(sd, i, 47));
        const dx = (hash(sd, i, 48) - 0.5) * 12 * k;
        const x = cx + (u * ux - v * uy) * R * 0.92 + dx;
        const y = cy + (u * uy + v * ux) * R * 0.92 - z;
        twinkle(p, x, y, i >= 11 && i <= 14 && k < 0.5 ? 2 : 1, starCol(k), (1 - k) * 0.95);
      });
    }
  }),
});

// ---- Взмах: веер ночи, звёзды копятся у края, рука проходит дугой -----------

registerZonePainter(
  'f15b_sweep',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const st = z as Strike;
    const { k, left } = warnOf(st);
    const sig = left < SIG;
    const tk = !reduced() && tick(left);
    const cx = st.x * S;
    const cy = st.y * S;
    const p = new Pen(g, px, py, cx, cy);
    p.occ = occOf(S);
    const R = st.r * S;
    const sd = seedOf(st.id);
    const a = st.ang ?? 0;
    const arc = st.arc ?? 1.9;
    const a0 = a - arc / 2;
    const r0 = S * 0.5;
    const inS = (t: number) => inArc(t, a0, arc);
    p.col(C.night[1], 0.3 + 0.25 * k);
    fillSector(p, cx, cy, r0, R, a0, a0 + arc);
    // Налив от владыки к краю веера.
    const rf = r0 + (R - r0) * Math.pow(k, 1.2);
    // Сигнал — как у круглых меток: фиолет гуще, «тик» светлее; золото по
    // ночи давало бежевую засветку поверх героя.
    p.col(tk ? C.vio[3] : C.vio[1], sig ? (tk ? 0.26 : 0.5) : 0.14 + 0.22 * k);
    fillSector(p, cx, cy, r0, rf, a0, a0 + arc);
    ring(
      p,
      cx,
      cy,
      rf,
      sig ? C.white : C.gold[2],
      0.45 + 0.5 * k,
      (t, i) => inS(t) && hash(i >> 2, sd, 3) > 0.2,
      0.4,
    );
    sectorRim(
      p,
      cx,
      cy,
      R,
      a0,
      arc,
      r0,
      sig ? (tk ? C.white : C.gold[3]) : C.gold[1],
      0.65 + 0.3 * k,
    );
    ticks(
      p,
      cx,
      cy,
      R,
      48,
      time * (sd & 1 ? 0.5 : -0.5),
      2,
      sig ? C.white : C.gold[1],
      0.45 + 0.45 * k,
      inS,
    );
    // Рука пойдёт от края, что выше на экране: там копятся звёзды.
    const { as, dir } = sweepOf(a, arc);
    for (let i = 0; i < 9; i++) {
      const rr = r0 + (R - r0) * (0.15 + 0.85 * hash(sd, i, 51));
      const aa = as + dir * 0.14 * hash(sd, i, 52);
      const on = k01(k * 1.6 - i * 0.08);
      twinkle(
        p,
        cx + Math.cos(aa) * rr,
        cy + Math.sin(aa) * rr,
        sig || i % 3 === 0 ? 2 : 1,
        C.gold[3],
        on * (0.6 + 0.4 * Math.sin(time * 9 + i)),
      );
    }
    // Последние 0,14 с — сама рука: серп бежит от начального края.
    if (left < 0.14) {
      const u = eIn2(1 - left / 0.14);
      const sw = Math.max(0.02, arc * u);
      p.occ = null;
      crescent(p, cx, cy, R, dir > 0 ? as : as - sw, sw, 5, C.gold[3], 0.95);
      const e = as + dir * sw;
      p.lineS(
        cx + Math.cos(e) * r0,
        cy + Math.sin(e) * r0,
        cx + Math.cos(e) * R,
        cy + Math.sin(e) * R,
        C.white,
        0.9,
        0.4,
      );
    }
  }),
);

registerImpactPainter('f15b_sweep', {
  life: 0.8,
  shake: 0.22,
  above: true,
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const cx = rec.x * S;
    const cy = rec.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = (rec.r ?? 3.3) * S;
    const sd = rec.seed >>> 0;
    const a = rec.ang ?? 0;
    const arc = rec.arc ?? 1.9;
    const { as, dir } = sweepOf(a, arc);
    // Рука проходит за край на 15 % и тает: серп звёздного света со следом.
    const span = arc * (1 + 0.15 * eOut2(k01(age / 0.09)));
    const lo = dir > 0 ? as : as - span;
    const k = k01(age / 0.5);
    if (k < 1) {
      const col = age < 0.05 ? C.white : age < 0.14 ? C.gold[3] : k < 0.6 ? C.gold[2] : '#c890f0';
      crescent(p, cx, cy, R, lo, span, Math.max(1, 7 * (1 - k)), col, 1 - k * 0.8);
      crescent(p, cx, cy, R - 6, lo, span, Math.max(1, 3 * (1 - k)), '#c890f0', 0.6 * (1 - k));
      if (age < 0.18) {
        const e = as + dir * span;
        twinkle(
          p,
          cx + Math.cos(e) * (R - 3),
          cy + Math.sin(e) * (R - 3),
          3,
          C.gold[3],
          1 - age / 0.18,
        );
      }
    }
    p.occ = occOf(S);
    dust(
      p,
      sd,
      age,
      cx,
      cy,
      reduced() ? 4 : 8,
      0,
      0.4,
      20,
      30,
      2,
      6,
      5,
      0.7,
      0,
      0.55,
      (i) => i * 0.012,
      (i) => {
        const t = as + dir * span * ((i + 0.5) / 8);
        return [cx + Math.cos(t) * R, cy + Math.sin(t) * R, t];
      },
    );
    p.occ = null;
    sparks(
      p,
      sd,
      age,
      cx,
      cy,
      reduced() ? 6 : 16,
      0,
      0.3,
      50,
      60,
      0.5,
      50,
      starCol,
      undefined,
      (i) => {
        const t = a - arc / 2 + arc * hash(sd, i, 53);
        return [cx + Math.cos(t) * R * 0.92, cy + Math.sin(t) * R * 0.92, t + dir * 0.6];
      },
    );
  }),
});

// ---- Волна: ладони врозь — кольца тяготения разбегаются от владыки ----------

registerZonePainter(
  'f15b_repel',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const st = z as Strike;
    const { k, left } = warnOf(st);
    const cx = st.x * S;
    const cy = st.y * S;
    const p = new Pen(g, px, py, cx, cy);
    p.occ = occOf(S);
    const R = st.r * S;
    const sd = seedOf(st.id);
    if (st.shape === 'circle') {
      astroMark(p, cx, cy, R, k, left, time, sd, '#9a5ad0', C.vio[3], C.vio[1], 20);
      return;
    }
    bandAstro(
      p,
      cx,
      cy,
      R,
      (st.w ?? 0.55) * S,
      k,
      left,
      sd,
      time,
      S * 0.8,
      C.vio[1],
      '#c890f0',
      C.vio[3],
    );
  }),
);

registerImpactPainter('f15b_repel', {
  life: 0.8,
  shake: 0.16,
  above: true,
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const cx = rec.x * S;
    const cy = rec.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = (rec.r ?? 2.2) * S;
    const disc = rec.shape === 'circle';
    const w = disc ? 0 : (rec.w ?? 0.55) * S;
    const sd = rec.seed >>> 0;
    const few = reduced();
    // Полоса вспыхивает и гаснет.
    p.occ = occOf(S);
    if (age < 0.16) {
      p.col(age < 0.05 ? C.white : '#c890f0', 0.55 * (1 - age / 0.16));
      fillSector(p, cx, cy, disc ? 0 : R - w, R + w, 0, TAU);
    }
    const n = disc ? (few ? 5 : 8) : few ? 6 : 14;
    dust(p, sd, age, cx, cy, n, 0, 0.3, 20, 25, 2, 6, 4, 0.7, 7, 0.55, undefined, (i) => {
      const t = (i / n) * TAU + hash(sd, i, 54);
      return [cx + Math.cos(t) * (R + w), cy + Math.sin(t) * (R + w), t];
    });
    p.occ = null;
    crest(p, cx, cy, R + w, age, 0.45, S * 1.1, '#c890f0', sd);
    sparks(p, sd, age, cx, cy, few ? 8 : 18, 0, 0.4, 40, 50, 0.5, 30, vioCol, undefined, (i) => {
      const t = TAU * hash(sd, i, 55);
      return [cx + Math.cos(t) * (R + w), cy + Math.sin(t) * (R + w), t];
    });
  }),
});

// ---- Колодец тяготения: кулак сжат — воронка гнёт пол, схлопывание ---------

/** Сетка пола в воронке: линии решётки стянуты к центру и закручены. */
function wellGrid(p: Pen, cx: number, cy: number, PR: number, pull: number, few: boolean): void {
  const step = few ? 16 : 12;
  const n = Math.floor(PR / step);
  const gam = 1 + pull;
  const warp = (x: number, y: number): [number, number, number] => {
    const f = Math.min(1, Math.hypot(x, y) / PR);
    const rr = PR * Math.pow(f, gam);
    const t = Math.atan2(y, x) + pull * 1.1 * (1 - f) * (1 - f);
    return [cx + Math.cos(t) * rr, cy + Math.sin(t) * rr, f];
  };
  for (let o = 0; o < 2; o++)
    for (let j = -n; j <= n; j++) {
      const c = j * step;
      const half = Math.sqrt(Math.max(0, PR * PR - c * c));
      let prev: [number, number, number] | null = null;
      for (let s = -half; s <= half + 0.01; s += 6) {
        const q = o ? warp(c, s) : warp(s, c);
        if (prev) {
          const f = (prev[2] + q[2]) / 2;
          p.col(
            f < 0.3 ? '#c890f0' : f < 0.65 ? C.vio[2] : C.night[7],
            0.2 + 0.55 * (1 - f) * Math.min(1, pull),
          );
          p.line(prev[0], prev[1], q[0], q[1]);
        }
        prev = q;
      }
    }
}

registerZonePainter(
  'f15b_well',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const st = z as Strike;
    const { left } = warnOf(st);
    const sig = left < SIG;
    const tk = !reduced() && tick(left);
    const cx = st.x * S;
    const cy = st.y * S;
    const p = new Pen(g, px, py, cx, cy);
    p.occ = occOf(S);
    const R = st.r * S;
    const PR = LORD.wellR * S;
    const sd = seedOf(st.id);
    const W = LORD.wellWarn;
    const t = st.t;
    const few = reduced();
    if (t < W) {
      // Кулак сжимается: граница тяги проступает, звёзды стягиваются спиралью.
      const k = t / W;
      ring(
        p,
        cx,
        cy,
        PR,
        C.gold[1],
        0.15 + 0.45 * k,
        (_a, i) => mod(i - Math.floor(time * 12), 8) < 4,
        0.4,
      );
      for (let i = 0; i < 16; i++) {
        const a0 = (i / 16) * TAU + hash(sd, i, 61);
        const rr = PR * (1 - 0.85 * eIn2(k)) * (0.55 + 0.45 * hash(sd, i, 62));
        const aa = a0 + k * 2.6;
        twinkle(
          p,
          cx + Math.cos(aa) * rr,
          cy + Math.sin(aa) * rr,
          i % 4 ? 1 : 2,
          i % 3 ? '#c890f0' : C.gold[3],
          0.3 + 0.65 * k,
        );
      }
      const hr = 1.5 + 5 * eIn2(k);
      p.col(C.ink, 0.5 + 0.45 * k);
      oval(p, cx, cy, hr, hr);
      ring(p, cx, cy, hr + 1, C.gold[2], 0.4 + 0.5 * k);
      return;
    }
    const u = (t - W) / LORD.wellLife;
    const grow = Math.min(1, u * 4);
    // Последние 0,8 с — воронка сжимается перед схлопыванием.
    const end = k01(1 - left / 0.8);
    // Воронка: пол темнеет ступенями к центру — глубина.
    const shrink = 1 - 0.25 * end;
    const DEPTH: [number, string, number][] = [
      [1, C.night[0], 0.2],
      [0.72, C.night[0], 0.14],
      [0.48, C.neb[1], 0.22],
      [0.28, C.neb[0], 0.3],
    ];
    for (const [f, c, al] of DEPTH) {
      p.col(c, al * grow);
      fillSector(p, cx, cy, 0, PR * f * (f < 1 ? shrink : 1), 0, TAU);
    }
    wellGrid(p, cx, cy, PR, grow * (0.6 + 0.8 * end), few);
    // Граница тяги: золотой пунктир, точки бегут внутрь.
    ring(
      p,
      cx,
      cy,
      PR,
      C.gold[1],
      0.7 * grow,
      (_a, i) => mod(i + Math.floor(time * 6), 8) < 4,
      0.5,
    );
    if (!few)
      for (let i = 0; i < 18; i++) {
        const aa = (i / 18) * TAU + time * 0.3;
        const f = mod(time * 0.9 + hash(sd, i, 63), 1);
        const r1 = PR * (1 - 0.45 * f);
        const r2 = PR * (1 - 0.45 * Math.max(0, f - 0.08));
        p.col(C.gold[2], 0.75 * grow * (1 - f));
        p.line(
          cx + Math.cos(aa) * r2,
          cy + Math.sin(aa) * r2,
          cx + Math.cos(aa) * r1,
          cy + Math.sin(aa) * r1,
        );
      }
    // Рукава звёзд закручиваются к центру — со следом по ходу.
    const per = few ? 12 : 22;
    const sp = 1 + end;
    const arm = (ar: number, f: number): [number, number] => {
      const rr = R * 0.3 + (PR * 0.9 * shrink - R * 0.3) * f;
      const aa = (ar / 3) * TAU + Math.log(1 + rr / S) * 2.6 - time * 2.4 * sp;
      return [cx + Math.cos(aa) * rr, cy + Math.sin(aa) * rr];
    };
    for (let ar = 0; ar < 3; ar++)
      for (let i = 0; i < per; i++) {
        const f = mod(i / per - time * 0.35 * sp, 1);
        const [x, y] = arm(ar, f);
        const [x2, y2] = arm(ar, Math.min(1, f + 0.035));
        const c = f < 0.3 ? '#ffffff' : f < 0.55 ? C.gold[3] : f < 0.8 ? '#c890f0' : '#6a34a4';
        p.col(c, grow * (1 - f * 0.55));
        p.line(x2, y2, x, y);
        if (f < 0.35) p.dot(x - 0.5, y - 0.5, 2, 2);
      }
    // Кольцо взрыва: риски, к схлопыванию — золото и белое.
    p.col(C.night[1], 0.2 + 0.35 * end);
    fillSector(p, cx, cy, 0, R, 0, TAU);
    const bc = sig ? (tk ? C.white : C.gold[3]) : end > 0 ? C.gold[2] : C.gold[1];
    ring(p, cx, cy, R + 1, '#9a5ad0', 0.6, undefined, 0.4);
    ring(
      p,
      cx,
      cy,
      R,
      bc,
      0.65 + 0.35 * end,
      (_a, i) => sig || mod(i - Math.floor(time * 20), 6) < 4,
      0.5,
    );
    ticks(p, cx, cy, R, 12, -time * 1.5, 2, bc, 0.5 + 0.45 * end);
    // Горизонт: чёрный диск, кольцо аккреции бежит.
    const hr = S * 0.6 * (0.6 + 0.4 * grow) * (1 + 0.35 * end) * (1 + 0.08 * Math.sin(time * 9));
    p.col(C.ink, 0.95);
    oval(p, cx, cy, hr, hr);
    const run = Math.floor(time * 24);
    ring(p, cx, cy, hr + 1.5, C.gold[2], 0.95, (_a, i) => mod(i + run, 5) < 3);
    ring(p, cx, cy, hr + 1.5, C.white, 0.9, (_a, i) => mod(i + run, 5) === 0);
    ring(p, cx, cy, hr + 3.5, '#c890f0', 0.55, (_a, i) => mod(i - run, 6) < 2);
    // «Сейчас»: кольцо схлопывания сжимается к горизонту.
    if (sig) ring(p, cx, cy, hr + (R - hr) * (left / SIG), C.white, 0.9, undefined, 0.4);
  }),
);

registerImpactPainter('f15b_well', {
  life: 1.1,
  shake: 0.45,
  flash: 0.3,
  flashRgb: '200,150,255',
  above: true,
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const cx = rec.x * S;
    const cy = rec.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = (rec.r ?? 1.6) * S;
    const sd = rec.seed >>> 0;
    const few = reduced();
    const f = 1 - k01(age / 1.1);
    // Шрам схлопывания: звезда трещин светится и гаснет.
    p.occ = occOf(S);
    const v = sd % 5;
    const cr = crackOf(`well${v}`, 31 + v, starBranches(31 + v, 7, v, R * 0.9, R * 1.5, 2), 0.45);
    drawCrack(
      p,
      cr,
      cx,
      cy,
      cr.max * eOut2(k01(age / 0.18)),
      age < 0.14 ? C.white : '#c890f0',
      null,
      f * f,
    );
    p.col(C.ink, 0.5 * f);
    oval(p, cx, cy, R * 0.55, R * 0.4);
    dust(p, sd, age, cx, cy, few ? 4 : 10, 0, Math.PI, 50, 40, 3, 8, 6, 1.0, 7, 0.6);
    chunks(p, sd, age, cx, cy, few ? 3 : 8, 0, Math.PI, 50, 60, 70, 60, [0.6, 1.0], 0.3, 1);
    p.occ = null;
    if (age < 0.12) {
      const q = age / 0.12;
      p.col(C.white, 0.85 * (1 - q));
      oval(p, cx, cy, R * (0.6 + 0.8 * q), R * (0.6 + 0.8 * q));
    }
    hitStar(p, cx, cy, age, 0.14, R * 1.3, sd * 0.01, '#c890f0');
    crest(p, cx, cy, R, age, 0.55, S * 2.2, '#c890f0', sd);
    crest(p, cx, cy, R * 0.6, age - 0.06, 0.45, S * 1.4, C.gold[3], sd + 1);
    sparks(p, sd, age, cx, cy, few ? 8 : 22, 0, Math.PI, 90, 110, 0.7, 60, vioCol);
  }),
});

// ---- Планеты: дуга полёта золотым пунктиром, кристалл падает и лежит -------

/** Радиусы и палитры планет короны (как у «Тела»): тень, основа, свет, блик. */
const PL_R = [2.6, 3.0, 2.4, 2.8, 3.3];
const PL_PAL = [
  ['#163a6a', '#4c9ad6', '#8cd0f4', '#ffffff'],
  ['#6e4a14', '#dcaa3c', '#ffd866', '#fff0b8'],
  ['#2a1250', '#6a34a4', '#9a5ad0', '#ecd4ff'],
  ['#0c2a40', '#2a7a9a', '#5ab8d0', '#e6faff'],
  ['#2b246c', '#8cd0f4', '#d0f4ff', '#ffffff'],
];

/** Планета: шар с гранями кристалла, грани бегут по кругу (кадр f из 8). */
function planetImg(i: number, r: number, f: number): HTMLCanvasElement {
  const R = Math.max(2, Math.round(r));
  const fr = f & 7;
  const key = `pl|${i}|${R}|${fr}`;
  const hit = LFX.get(key);
  if (hit) return hit;
  const ringed = i === 4;
  const rx = ringed ? R * 2 : R;
  const w = Math.ceil(rx * 2) + 4;
  const h = Math.ceil(R * 2) + 4;
  const px = new Px(w, h);
  const ox = w / 2;
  const oy = h / 2;
  const pal = PL_PAL[i % 5].map((c) => hx(c));
  const ringPx = (front: boolean) => {
    if (!ringed) return;
    for (let q = 0; q < 72; q++) {
      const t = (q / 72) * TAU;
      if (Math.sin(t) >= 0 !== front) continue;
      px.set(
        Math.floor(ox + Math.cos(t) * rx),
        Math.floor(oy + Math.sin(t) * R * 0.42 - Math.cos(t) * R * 0.2),
        hx(front ? C.gold[2] : C.gold[1]),
      );
    }
  };
  ringPx(false);
  const rot = (fr / 8) * (TAU / 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = (x + 0.5 - ox) / R;
      const dy = (y + 0.5 - oy) / R;
      const d2 = dx * dx + dy * dy;
      if (d2 > 1) continue;
      const dz = Math.sqrt(1 - d2);
      const l = -dx * 0.55 - dy * 0.6 + dz * 0.58;
      let c = l > 0.78 ? 3 : l > 0.3 ? 2 : l > -0.15 ? 1 : 0;
      // Грани: полосы по долготе, с поворотом бегут через шар.
      const lon = Math.atan2(dx, dz) + rot;
      if (Math.cos(lon * 3 + dy * 1.2) > 0.6) c = Math.min(3, c + 1);
      else if (Math.cos(lon * 3 + dy * 1.2) < -0.75) c = Math.max(0, c - 1);
      px.set(x, y, pal[c]);
    }
  ringPx(true);
  px.outline(hx(C.ink, 210));
  return LFX.set(key, px.canvas());
}

/** Какая планета летит в эту метку (по точке падения). */
function planetOf(v: Readonly<F15BState>, st: Strike): number {
  let best = -1;
  let bd = 0.05;
  v.planets.forEach((pl, i) => {
    const d = Math.abs(pl.tx - st.x) + Math.abs(pl.ty - st.y);
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

/** Пунктир дуги (точки мира × S), бежит к концу. */
function dashArc(
  p: Pen,
  S: number,
  sx: number,
  sy: number,
  qx: number,
  qy: number,
  tx: number,
  ty: number,
  e0: number,
  e1: number,
  run: number,
  col: string,
  a: number,
): void {
  const len = (Math.hypot(qx - sx, qy - sy) + Math.hypot(tx - qx, ty - qy)) * S;
  const n = Math.max(12, Math.min(90, Math.floor(len / 3)));
  for (let j = 0; j < n; j++) {
    const e = j / n;
    const e2 = (j + 1) / n;
    if (e2 < e0 || e > e1 || mod(j - run, 4) >= 2) continue;
    const x0 = bez(sx, qx, tx, e) * S;
    const y0 = bez(sy, qy, ty, e) * S;
    const x1 = bez(sx, qx, tx, e2) * S;
    const y1 = bez(sy, qy, ty, e2) * S;
    const al = a * (0.6 + 0.4 * e);
    p.lineS(x0, y0, x1, y1, col, al, 0.6);
    p.col(col, al * 0.7);
    p.line(x0 + 1, y0, x1 + 1, y1);
  }
}

registerZonePainter(
  'f15b_planet',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const st = z as Strike;
    const { k, left } = warnOf(st);
    const sig = left < SIG;
    const cx = st.x * S;
    const cy = st.y * S;
    const p = new Pen(g, px, py, cx, cy);
    p.occ = occOf(S);
    const R = st.r * S;
    const sd = seedOf(st.id);
    astroMark(p, cx, cy, R, k, left, time, sd, C.ice[3], C.ice[5], C.ice[1], 12);
    // Перекрестье прицела.
    for (let q = 0; q < 4; q++) {
      const aa = (q * TAU) / 4 + Math.PI / 4;
      p.lineS(
        cx + Math.cos(aa) * R * 0.3,
        cy + Math.sin(aa) * R * 0.3,
        cx + Math.cos(aa) * R * 0.68,
        cy + Math.sin(aa) * R * 0.68,
        sig ? C.white : C.ice[4],
        0.45 + 0.45 * k,
        0.4,
      );
    }
    const s = paintSim();
    const v = f15bView(s);
    const i = v ? planetOf(v, st) : -1;
    const pl = v && i >= 0 ? v.planets[i] : undefined;
    if (!s || !pl) return;
    // Тень падающей планеты растёт, пока она летит.
    const fu = pl.stage === 1 ? k01((s.time - pl.at) / LORD.orbitFly) : pl.stage === 2 ? 1 : 0;
    if (fu > 0) {
      p.col(C.ink, 0.2 + 0.4 * fu);
      oval(p, cx, cy, R * (0.3 + 0.55 * fu), R * (0.3 + 0.55 * fu) * 0.6);
    }
    // Дуга полёта — золотой бегущий пунктир от короны к метке.
    p.occ = null;
    const lord = mobOf(st.from);
    const run = Math.floor(time * 18);
    const ca = sig ? 1 : 0.55 + 0.45 * k;
    const col = sig ? C.white : C.gold[2];
    if (pl.stage === 1) {
      const u = k01((s.time - pl.at) / LORD.orbitFly);
      const e0 = smooth3(u) * 0.35 + u * u * 0.65;
      dashArc(p, S, pl.sx, pl.sy, pl.cx, pl.cy, st.x, st.y, e0, 1, run, col, ca);
    } else if (pl.stage === 0 && lord) {
      // До срыва: дуга считается так же, как её построит мозг в миг срыва.
      const [sx, sy] = crownSpot(lord, i, s.time + Math.max(0, LORD.orbitWarn - st.t));
      const dx = st.x - sx;
      const dy = st.y - sy;
      const d = Math.hypot(dx, dy) || 1;
      const side = (i % 2 ? 1 : -1) * (lord.data.side ?? 1) * (1.6 + i * 0.35);
      const qx = (sx + st.x) / 2 + (-dy / d) * side;
      const qy = (sy + st.y) / 2 + (dx / d) * side - 1.6;
      dashArc(p, S, sx, sy, qx, qy, st.x, st.y, 0, 1, run, col, ca);
    }
  }),
);

registerImpactPainter('f15b_planet', {
  life: 1.1,
  shake: 0.28,
  above: true,
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const cx = rec.x * S;
    const cy = rec.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = (rec.r ?? 1.15) * S;
    const sd = rec.seed >>> 0;
    const few = reduced();
    const f = 1 - k01(age / 1.1);
    // Кратер: тёмная чаша, по кругу встают шипы кристалла.
    p.occ = occOf(S);
    p.col(C.ink, 0.5 * f);
    oval(p, cx, cy, R * 0.85, R * 0.6);
    const up = eOut3(k01(age / 0.12)) * (1 - k01((age - 0.7) / 0.4));
    for (let i = 0; i < 7; i++) {
      const t = (i / 7) * TAU + hash(sd, i, 66);
      const rr = R * (0.7 + 0.25 * hash(sd, i, 67));
      const bx = cx + Math.cos(t) * rr;
      const by = cy + Math.sin(t) * rr * 0.75;
      const hh = (3 + 4 * hash(sd, i, 68)) * up;
      if (hh < 1) continue;
      const lean = Math.cos(t) * 1.5;
      p.col(C.ice[5], 0.95);
      p.line(bx, by, bx + lean, by - hh);
      p.col(C.ice[3], 0.95);
      p.line(bx + 1, by, bx + 1 + lean, by - hh + 1);
    }
    dust(p, sd, age, cx, cy, few ? 3 : 7, 0, Math.PI, 30, 30, 3, 6, 5, 0.9, 5, 0.45);
    chunks(p, sd, age, cx, cy, few ? 4 : 9, 0, Math.PI, 60, 70, 90, 70, [0.55, 1.0], 0.35, 3);
    p.occ = null;
    hitStar(p, cx, cy - 2, age, 0.1, R * 1.15, sd * 0.01, C.ice[4]);
    crest(p, cx, cy, R, age, 0.42, S * 1.2, C.ice[4], sd);
    sparks(p, sd, age, cx, cy, few ? 5 : 12, -Math.PI / 2, 1.3, 50, 70, 0.5, 70, iceCol);
  }),
});

// ---- Звездопад: прицелы кольцом, метеоры падают издалека со следом ---------

/** Метеор приходит сверху-справа: направление ОТ цели к небу. */
const METEOR_IN: [number, number] = (() => {
  const x = 0.55;
  const y = -1;
  const n = Math.hypot(x, y);
  return [x / n, y / n];
})();

/** Камень метеора: неровный, кувыркается (кадр f из 8), передний край раскалён. */
function rockImg(sz: number, f: number): HTMLCanvasElement {
  const fr = f & 7;
  const key = `rock|${sz}|${fr}`;
  const hit = LFX.get(key);
  if (hit) return hit;
  const s = sz * 2 + 3;
  const px = new Px(s, s);
  const c = s / 2;
  const rot = (fr / 8) * TAU;
  // Ход — вниз-влево (против METEOR_IN): этот бок горит.
  const mx = -METEOR_IN[0];
  const my = -METEOR_IN[1];
  for (let y = 0; y < s; y++)
    for (let x = 0; x < s; x++) {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      const ang = Math.atan2(dy, dx) - rot;
      const rr = sz * (0.8 + 0.14 * Math.cos(ang * 3) + 0.08 * Math.cos(ang * 5 + 1));
      const d = Math.hypot(dx, dy);
      if (d > rr) continue;
      const hot = (dx * mx + dy * my) / sz;
      const l = (-dx * 0.6 - dy * 0.8) / sz;
      const pit = Math.cos(ang * 2 + 0.7) > 0.8 && d > sz * 0.3 && d < sz * 0.6;
      const col =
        hot > 0.5
          ? '#fff0b8'
          : hot > 0.15
            ? C.ember[4]
            : pit
              ? C.crust[1]
              : l > 0.35
                ? C.crust[4]
                : l > -0.3
                  ? C.crust[3]
                  : C.crust[2];
      px.set(x, y, hx(col));
    }
  px.outline(hx(C.ink, 220));
  return LFX.set(key, px.canvas());
}

/** Метеор в полёте: длинный след (белый → золото → угли → фиолет) и камень. */
function meteorFly(
  p: Pen,
  x: number,
  y: number,
  u: number,
  sd: number,
  big: boolean,
  time: number,
): void {
  const [ux, uy] = METEOR_IN;
  const nx = -uy;
  const ny = ux;
  const L = (26 + 40 * u) * (big ? 1.25 : 1);
  for (let i = Math.floor(L); i > 0; i--) {
    const f = i / L;
    const c =
      f < 0.12
        ? '#ffffff'
        : f < 0.3
          ? C.gold[3]
          : f < 0.55
            ? C.ember[3]
            : f < 0.8
              ? '#9a5ad0'
              : '#46207a';
    const w = f < 0.25 ? 5 : f < 0.5 ? 3 : 2;
    p.col(c, (1 - f) * 0.95);
    for (let o = 0; o < w; o++) {
      const d = o - (w - 1) / 2;
      p.dot(x + ux * i + nx * d, y + uy * i + ny * d);
    }
  }
  // Отлетающие искры следа.
  for (let j = 0; j < 6; j++) {
    const f = mod(hash(sd, j, 71) + time * 2.2, 1);
    const i = L * (0.15 + 0.7 * f);
    const off = (hash(sd, j, 72) - 0.5) * 8 * f;
    p.col(f < 0.5 ? C.gold[3] : '#c890f0', 0.8 * (1 - f));
    p.dot(x + ux * i + nx * off, y + uy * i + ny * off);
  }
  const sz = big ? 6 : 5;
  ring(p, x, y, sz + 2, C.gold[2], 0.45);
  const im = rockImg(sz, Math.floor(time * 16) + sd);
  p.alpha(1);
  p.img(im, x - im.width / 2, y - im.height / 2);
}

registerZonePainter(
  'f15b_meteor',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const st = z as Strike;
    const { k, left } = warnOf(st);
    const sig = left < SIG;
    const cx = st.x * S;
    const cy = st.y * S;
    const p = new Pen(g, px, py, cx, cy);
    p.occ = occOf(S);
    const R = st.r * S;
    const sd = seedOf(st.id);
    const big = st.r > 1.1;
    astroMark(p, cx, cy, R, k, left, time, sd, C.gold[1], C.gold[3], C.night[5], big ? 16 : 12);
    // Перекрестье: четыре риски к центру.
    for (let q = 0; q < 4; q++) {
      const aa = (q * TAU) / 4;
      p.lineS(
        cx + Math.cos(aa) * R * 0.35,
        cy + Math.sin(aa) * R * 0.35,
        cx + Math.cos(aa) * R * 0.75,
        cy + Math.sin(aa) * R * 0.75,
        sig ? C.white : C.gold[2],
        0.45 + 0.45 * k,
        0.4,
      );
    }
    // Метеор падает издалека с ускорением; тень растёт под ним.
    const FALL = big ? 0.85 : 0.75;
    if (left < FALL) {
      const u = 1 - left / FALL;
      p.col(C.ink, 0.2 + 0.45 * u);
      oval(p, cx, cy, R * (0.25 + 0.5 * u), R * (0.25 + 0.5 * u) * 0.6);
      p.occ = null;
      const D = (big ? 10 : 8) * S * (1 - u * u);
      meteorFly(p, cx + METEOR_IN[0] * D, cy + METEOR_IN[1] * D, u, sd, big, time);
    }
  }),
);

registerImpactPainter('f15b_meteor', {
  life: 1.0,
  shake: 0.22,
  above: true,
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const cx = rec.x * S;
    const cy = rec.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = (rec.r ?? 1) * S;
    const sd = rec.seed >>> 0;
    const few = reduced();
    const f = 1 - k01(age / 1.0);
    // Кратер: чаша, раскалённая кромка остывает.
    p.occ = occOf(S);
    p.col(C.ink, 0.55 * f);
    oval(p, cx, cy, R * 0.8, R * 0.55);
    const hk = k01(age / 0.9);
    ring(p, cx, cy, R * 0.62, heatCol(hk), 0.9 * (1 - hk), (_a, i) => hash(i, sd, 74) > 0.25);
    dust(p, sd, age, cx, cy, few ? 2 : 4, 0, Math.PI, 25, 30, 3, 6, 6, 0.8, 7, 0.45);
    chunks(p, sd, age, cx, cy, few ? 2 : 5, 0, Math.PI, 40, 55, 70, 60, [0.5, 0.95], 0.3, 5);
    p.occ = null;
    hitStar(p, cx, cy - 2, age, 0.1, R * 1.2, sd * 0.01, C.gold[2]);
    crest(p, cx, cy, R, age, 0.38, S, C.gold[3], sd);
    sparks(p, sd, age, cx, cy, few ? 6 : 14, -Math.PI / 2, 1.3, 50, 80, 0.55, 90, emberCol);
  }),
});

// ---- Удары из тьмы (затмение): звёзды вспыхивают там, куда придёт удар -----

/** Три когтя-созвездия веером. */
function clawLines(
  cx: number,
  cy: number,
  R: number,
  a: number,
  arc: number,
): [number, number][][] {
  const out: [number, number][][] = [];
  for (const o of [-0.32, 0, 0.32]) {
    const pts: [number, number][] = [];
    for (let j = 0; j <= 6; j++) {
      const f = j / 6;
      const rr = R * (0.22 + 0.78 * f);
      const aa = a + o * arc + (f - 0.5) * 0.35;
      pts.push([cx + Math.cos(aa) * rr, cy + Math.sin(aa) * rr]);
    }
    out.push(pts);
  }
  return out;
}

/** Ломаная до доли пути `u` (0…1). */
function polyTo(
  p: Pen,
  pts: [number, number][],
  u: number,
  c: string,
  a: number,
  thick: boolean,
): void {
  const n = pts.length - 1;
  const end = u * n;
  for (let j = 0; j < n && j < end; j++) {
    const [x0, y0] = pts[j];
    const [x1b, y1b] = pts[j + 1];
    const s = Math.min(1, end - j);
    const x1 = x0 + (x1b - x0) * s;
    const y1 = y0 + (y1b - y0) * s;
    p.lineS(x0, y0, x1, y1, c, a, 0.5);
    if (thick) p.line(x0 + 1, y0, x1 + 1, y1);
  }
}

registerZonePainter(
  'f15b_nightclaw',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const st = z as Strike;
    const { k, left } = warnOf(st);
    const sig = left < SIG;
    const tk = !reduced() && tick(left);
    const cx = st.x * S;
    const cy = st.y * S;
    const p = new Pen(g, px, py, cx, cy);
    p.occ = occOf(S);
    const R = st.r * S;
    const sd = seedOf(st.id);
    const a = st.ang ?? 0;
    const arc = st.arc ?? 1.6;
    const a0 = a - arc / 2;
    const r0 = S * 0.6;
    const W = Math.max(0.01, st.warn);
    // «Куда»: в секторе тьмы проступает звёздное небо; налив — к краю.
    p.col(C.night[3], 0.2 + 0.22 * k);
    fillSector(p, cx, cy, r0, R, a0, a0 + arc);
    const rf = r0 + (R - r0) * Math.pow(k, 1.2);
    p.col(sig ? '#9a5ad0' : C.vio[1], sig ? (tk ? 0.3 : 0.18) : 0.12 + 0.2 * k);
    fillSector(p, cx, cy, r0, rf, a0, a0 + arc);
    sectorRim(
      p,
      cx,
      cy,
      R,
      a0,
      arc,
      r0,
      sig ? (tk ? C.white : '#ecd4ff') : '#9a5ad0',
      0.45 + 0.5 * k,
      sig ? undefined : (u) => mod(Math.floor(u / 3) + Math.floor(time * 14), 4) < 2,
    );
    // Звёзды вспыхивают одна за другой, всё гуще; новая — с лучами.
    for (let i = 0; i < 36; i++) {
      const th = hash(sd, i, 81) * 0.9;
      if (k < th) continue;
      const born = (k - th) * W;
      const rr = r0 + (R - r0) * hash(sd, i, 82);
      const aa = a + (hash(sd, i, 83) - 0.5) * arc * 0.95;
      const tw = 0.55 + 0.45 * Math.sin(time * 11 + i * 2.3);
      twinkle(
        p,
        cx + Math.cos(aa) * rr,
        cy + Math.sin(aa) * rr,
        born < 0.1 ? 3 : hash(sd, i, 84) < 0.25 ? 2 : 1,
        sig ? C.white : born < 0.1 ? C.gold[3] : '#c890f0',
        born < 0.1 ? 1 : tw,
      );
    }
    // Три когтя — созвездиями; в последние 0,14 с проходят от основания к концу.
    const lines = clawLines(cx, cy, R, a, arc);
    for (const pts of lines) {
      const shown = Math.min(pts.length, Math.ceil(k * 1.3 * pts.length));
      for (let j = 0; j < shown; j++)
        twinkle(p, pts[j][0], pts[j][1], 1, '#ecd4ff', 0.5 + 0.45 * k);
    }
    if (left < 0.14) {
      p.occ = null;
      const u = eIn2(1 - left / 0.14);
      for (const pts of lines) polyTo(p, pts, u, C.white, 0.95, true);
    }
  }),
);

registerImpactPainter('f15b_nightclaw', {
  life: 0.8,
  shake: 0.26,
  above: true,
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const cx = rec.x * S;
    const cy = rec.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = (rec.r ?? 3.8) * S;
    const sd = rec.seed >>> 0;
    const a = rec.ang ?? 0;
    const arc = rec.arc ?? 1.6;
    const k = k01(age / 0.55);
    // Когти уходят за край на 15 %, гаснут белый → сирень → фиолет.
    const over = 1 + 0.15 * eOut2(k01(age / 0.08));
    const lines = clawLines(cx, cy, R * over, a, arc);
    if (k < 1) {
      const c = age < 0.06 ? '#ffffff' : k < 0.4 ? '#ecd4ff' : '#9a5ad0';
      for (const pts of lines) polyTo(p, pts, 1, c, 1 - k, k < 0.4);
      // След на полу — тонкий шрам звёздного света.
      p.occ = occOf(S);
      for (const pts of clawLines(cx, cy, R, a, arc))
        polyTo(p, pts, 1, '#6a34a4', 0.5 * (1 - k), false);
      p.occ = null;
    }
    sparks(
      p,
      sd,
      age,
      cx,
      cy,
      reduced() ? 6 : 15,
      a,
      arc / 2,
      50,
      60,
      0.5,
      40,
      vioCol,
      undefined,
      (i) => {
        const pts = lines[i % 3];
        const [x, y] = pts[pts.length - 1 - (i % 3)];
        return [x, y, a];
      },
    );
  }),
});

registerZonePainter(
  'f15b_starfall',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const st = z as Strike;
    const { k, left } = warnOf(st);
    const sig = left < SIG;
    const cx = st.x * S;
    const cy = st.y * S;
    const p = new Pen(g, px, py, cx, cy);
    p.occ = occOf(S);
    const R = st.r * S;
    const sd = seedOf(st.id);
    astroMark(p, cx, cy, R, k, left, time, sd, C.ice[3], C.ice[5], C.night[5], 8);
    // Звезда разгорается в точке удара.
    twinkle(
      p,
      cx,
      cy,
      Math.round(1 + 3 * k),
      sig ? '#ffffff' : k < 0.5 ? C.ice[4] : C.gold[3],
      0.5 + 0.5 * k * (0.75 + 0.25 * Math.sin(time * 14)),
    );
    // Последние 0,45 с — звезда падает с неба со следом.
    const FALL = 0.45;
    if (left < FALL) {
      const u = 1 - left / FALL;
      p.col(C.ink, 0.2 + 0.4 * u);
      oval(p, cx, cy, R * (0.2 + 0.45 * u), R * (0.2 + 0.45 * u) * 0.6);
      p.occ = null;
      const D = 9 * S * (1 - u * u);
      const [ux, uy] = METEOR_IN;
      const x = cx + ux * D;
      const y = cy + uy * D;
      const L = 10 + 18 * u;
      for (let i = Math.floor(L); i > 0; i--) {
        const f = i / L;
        p.col(f < 0.25 ? '#ffffff' : f < 0.6 ? C.ice[5] : C.ice[3], (1 - f) * 0.9);
        p.dot(x + ux * i, y + uy * i);
        if (f < 0.3) p.dot(x + ux * i + 1, y + uy * i);
      }
      twinkle(p, x, y, 2, C.ice[5], 1);
    }
  }),
);

registerImpactPainter('f15b_starfall', {
  life: 0.7,
  shake: 0.14,
  above: true,
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const cx = rec.x * S;
    const cy = rec.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = (rec.r ?? 0.95) * S;
    const sd = rec.seed >>> 0;
    // След звезды на полу гаснет.
    p.occ = occOf(S);
    const f = 1 - k01(age / 0.7);
    twinkle(p, cx, cy, Math.round(1 + 3 * f), C.ice[4], f);
    p.occ = null;
    hitStar(p, cx, cy - 1, age, 0.12, R * 1.3, 0.4, C.ice[4]);
    crest(p, cx, cy, R, age, 0.35, S * 0.8, C.ice[4], sd);
    sparks(p, sd, age, cx, cy, reduced() ? 5 : 11, -Math.PI / 2, 1.4, 40, 60, 0.45, 70, iceCol);
  }),
});

// ---- Сверхновая: кольца света с проходом, толчки плаща ----------------------

const arcKeep = (st: { ang?: number; arc?: number }) => {
  if (st.arc === undefined || st.arc >= TAU - 1e-3) return undefined;
  const a0 = (st.ang ?? 0) - st.arc / 2;
  const span = st.arc;
  return (a: number) => inArc(a, a0, span);
};

registerZonePainter(
  'f15b_pulse',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const st = z as Strike;
    const { k, left } = warnOf(st);
    const cx = st.x * S;
    const cy = st.y * S;
    const p = new Pen(g, px, py, cx, cy);
    p.occ = occOf(S);
    const R = st.r * S;
    const w = (st.w ?? 0.6) * S;
    const sd = seedOf(st.id);
    const keep = arcKeep(st);
    bandAstro(p, cx, cy, R, w, k, left, sd, time, S * 0.9, C.vio[1], C.gold[2], C.gold[3], keep);
    // В полосе копится звёздный свет: искры бегут поперёк полосы наружу.
    if (!reduced())
      for (let i = 0; i < 36; i++) {
        const t = hash(sd, i, 94) * TAU;
        if (keep && !keep(Math.atan2(Math.sin(t), Math.cos(t)))) continue;
        const rr = R - w + 2 * w * mod(hash(sd, i, 95) + time * (0.6 + 0.8 * k), 1);
        twinkle(p, cx + Math.cos(t) * rr, cy + Math.sin(t) * rr, 1, C.gold[3], 0.35 + 0.55 * k);
      }
    const span = st.arc ?? TAU;
    if (span >= TAU - 1e-3) return;
    // Проход: края — столбы кристального света, в проходе — голубой путь.
    const a0 = (st.ang ?? 0) - span / 2;
    for (const ea of [a0, a0 + span])
      for (const d of [-w, 0, w]) {
        const bx = cx + Math.cos(ea) * (R + d);
        const by = cy + Math.sin(ea) * (R + d);
        const H = S * (1.1 + 0.25 * Math.sin(time * 6 + d));
        for (let hh = 0; hh < H; hh++) {
          p.col(hh < 2 ? C.white : C.ice[4], (0.8 - (0.75 * hh) / H) * (0.55 + 0.45 * k));
          p.dot(bx, by - hh);
        }
      }
    ring(
      p,
      cx,
      cy,
      R,
      C.ice[5],
      0.6,
      (t, i) => inArc(t, a0 + span, TAU - span) && mod(i + Math.floor(time * 10), 6) < 2,
    );
  }),
);

registerImpactPainter('f15b_pulse', {
  life: 0.8,
  shake: 0.2,
  above: true,
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const cx = rec.x * S;
    const cy = rec.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = (rec.r ?? 3.2) * S;
    const sd = rec.seed >>> 0;
    const few = reduced();
    const keep = arcKeep(rec);
    // Стена света: по полосе встают столбы — снизу белые, вверху тают в фиолет.
    const hk = Math.sin(Math.PI * k01(age / 0.45));
    if (hk > 0.1) {
      const n = few ? 14 : Math.round((TAU * R) / 7);
      for (let i = 0; i < n; i++) {
        const t = (i / n) * TAU + hash(sd, i, 92) * 0.1;
        if (keep && !keep(Math.atan2(Math.sin(t), Math.cos(t)))) continue;
        const x = cx + Math.cos(t) * R;
        const y = cy + Math.sin(t) * R;
        const H = S * 1.5 * hk * (0.55 + 0.45 * hash(sd, i, 93));
        p.col(C.white, 0.9 * hk);
        p.line(x, y, x, y - H * 0.3);
        p.col(C.gold[3], 0.75 * hk);
        p.line(x, y - H * 0.3, x, y - H * 0.65);
        p.col('#c890f0', 0.5 * hk);
        p.line(x, y - H * 0.65, x, y - H);
      }
    }
    crest(p, cx, cy, R, age, 0.45, S * 1.2, C.gold[3], sd, keep);
    sparks(p, sd, age, cx, cy, few ? 8 : 20, 0, 0.5, 60, 60, 0.5, 40, starCol, undefined, (i) => {
      let t = TAU * hash(sd, i, 91);
      if (keep && !keep(Math.atan2(Math.sin(t), Math.cos(t)))) t += Math.PI;
      return [cx + Math.cos(t) * R, cy + Math.sin(t) * R, t];
    });
  }),
});

registerZonePainter(
  'f15b_shock',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const st = z as Strike;
    const { k, left } = warnOf(st);
    const cx = st.x * S;
    const cy = st.y * S;
    const p = new Pen(g, px, py, cx, cy);
    p.occ = occOf(S);
    bandAstro(
      p,
      cx,
      cy,
      st.r * S,
      (st.w ?? 0.55) * S,
      k,
      left,
      seedOf(st.id),
      time,
      S * 0.6,
      C.neb[2],
      '#9a5ad0',
      '#ecd4ff',
    );
  }),
);

registerImpactPainter('f15b_shock', {
  life: 0.9,
  shake: 0.24,
  above: true,
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const cx = rec.x * S;
    const cy = rec.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = (rec.r ?? 2.6) * S;
    const sd = rec.seed >>> 0;
    const few = reduced();
    if (age < 0.14) {
      p.occ = occOf(S);
      p.col(age < 0.05 ? C.white : '#c890f0', 0.5 * (1 - age / 0.14));
      fillSector(p, cx, cy, Math.max(0, R - (rec.w ?? 0.55) * S), R + (rec.w ?? 0.55) * S, 0, TAU);
      p.occ = null;
    }
    crest(p, cx, cy, R, age, 0.5, S * 1.4, '#c890f0', sd);
    sparks(p, sd, age, cx, cy, few ? 8 : 18, 0, 0.5, 40, 50, 0.6, 30, starCol, undefined, (i) => {
      const t = TAU * hash(sd, i, 93);
      return [cx + Math.cos(t) * R, cy + Math.sin(t) * R, t];
    });
  }),
});

// ---- Хранитель памяти: удар посохом и копьё света ---------------------------

registerZonePainter(
  'f15b_kslam',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const st = z as Strike;
    const { k, left } = warnOf(st);
    const sig = left < SIG;
    const tk = !reduced() && tick(left);
    const cx = st.x * S;
    const cy = st.y * S;
    const p = new Pen(g, px, py, cx, cy);
    p.occ = occOf(S);
    const R = st.r * S;
    const sd = seedOf(st.id);
    // Метка владыки (астролябия) золотом, внутри — круг рун: восемь засечек
    // ходят по кругу — архив листает память.
    astroMark(p, cx, cy, R, k, left, time, sd, C.gold[2], C.gold[3], C.vio[1], 12);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + time * 0.8;
      const r1 = R * 0.62;
      p.lineS(
        cx + Math.cos(a) * r1,
        cy + Math.sin(a) * r1,
        cx + Math.cos(a) * (r1 + 4),
        cy + Math.sin(a) * (r1 + 4),
        sig ? C.white : C.gold[2],
        0.4 + 0.5 * k,
        0.3,
      );
    }
    ring(p, cx, cy, R * 0.62 - 2, C.gold[1], 0.35 + 0.3 * k, (_a, i) => i % 2 === 0);
    // Посох над меткой: светлая риска падает к центру в последние 0,2 с.
    if (sig) {
      const f = 1 - left / SIG;
      p.lineS(cx, cy - S * 2.2 * (1 - f), cx, cy - S * 0.2, tk ? C.white : C.gold[3], 0.9, 0.5);
    }
  }),
);

registerImpactPainter('f15b_kslam', {
  life: 1.0,
  shake: 0.25,
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const cx = rec.x * S;
    const cy = rec.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = (rec.r ?? 2.1) * S;
    const sd = rec.seed >>> 0;
    const few = reduced();
    hitStar(p, cx, cy, age, 0.1, S * 0.9, 0, C.gold[2]);
    crest(p, cx, cy, R, age, 0.45, S * 1.1, C.gold[3], sd);
    // Руны вспыхивают по кругу удара и гаснут.
    if (age < 0.4) {
      const f = age / 0.4;
      ring(p, cx, cy, R * (0.62 + 0.38 * eOut2(f)), C.white, 0.9 * (1 - f), (_a, i) => i % 3 !== 2);
      ticks(p, cx, cy, R * 0.62, 8, 0, 3, C.gold[3], 1 - f);
    }
    chunks(p, sd, age, cx, cy, few ? 3 : 7, 0, Math.PI, 50, 60, 70, 60, [0.55, 0.95], 0.3, 1);
    sparks(p, sd + 3, age, cx, cy, few ? 4 : 10, 0, TAU, 40, 50, 0.45, 30, starCol);
    dust(
      p,
      sd,
      age,
      cx,
      cy,
      few ? 4 : 9,
      0,
      Math.PI,
      40,
      40,
      3,
      7,
      5,
      0.9,
      0,
      0.55,
      undefined,
      (i) => {
        const t = (i / 9) * TAU;
        return [cx + Math.cos(t) * R * 0.7, cy + Math.sin(t) * R * 0.7, t];
      },
    );
  }),
});

registerZonePainter(
  'f15b_klance',
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
    const L = st.r * S;
    const hw = (st.w ?? 0.45) * S;
    p.col(C.ice[0], 0.3 + 0.18 * k);
    fillLane(p, cx, cy, ux, uy, 0, L, hw);
    // Фронт копья бежит от посоха к концу.
    p.col(sig ? C.white : C.ice[3], (tk ? 0.9 : 0.5) * (0.4 + 0.6 * k));
    fillLane(p, cx, cy, ux, uy, 0, L * eOut2(k), Math.max(1, hw * 0.3));
    const nx = -uy;
    const ny = ux;
    const run = Math.floor(time * 20);
    for (let d = 0; d < L; d += 2) {
      if (!sig && mod(Math.floor(d / 2) - run, 6) >= 4) continue;
      p.col(sig ? C.white : C.ice[4], 0.55 + 0.4 * k);
      p.dot(cx + ux * d + nx * hw, cy + uy * d + ny * hw);
      p.dot(cx + ux * d - nx * hw, cy + uy * d - ny * hw);
    }
    twinkle(p, cx + ux * L, cy + uy * L, sig ? 2 : 1, C.ice[4], 0.5 + 0.5 * k);
  }),
);

registerImpactPainter('f15b_klance', {
  life: 0.55,
  shake: 0.14,
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const cx = rec.x * S;
    const cy = rec.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const a = rec.ang ?? 0;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const L = (rec.r ?? 5) * S;
    const sd = rec.seed >>> 0;
    const k = k01(age / 0.35);
    if (k < 1) {
      p.col(C.ice[2], 0.35 * (1 - k));
      fillLane(p, cx, cy, ux, uy, 0, L, 8 * (1 - k * 0.5));
      p.col(C.ice[4], 0.8 * (1 - k));
      fillLane(p, cx, cy, ux, uy, 0, L, 4 * (1 - k * 0.6));
      p.col('#ffffff', 1 - k);
      fillLane(p, cx, cy, ux, uy, 0, L, Math.max(0.6, 1.6 * (1 - k)));
    }
    sparks(
      p,
      sd,
      age,
      cx + ux * L,
      cy + uy * L,
      reduced() ? 4 : 10,
      a,
      0.9,
      50,
      60,
      0.4,
      40,
      iceCol,
    );
  }),
});

// ---- Прицел осколка: пунктир по пути тарана, на захвате — сплошной ----------

registerZonePainter(
  'f15b_fxaim',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const zz = z as FxZone;
    const cx = zz.x * S;
    const cy = zz.y * S;
    const p = new Pen(g, px, py, cx, cy);
    p.occ = occOf(S);
    const a = zz.ang ?? 0;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const L = (zz.n ?? 6) * S;
    const lock = (zz.k ?? 0) > 0;
    const run = Math.floor(time * 24);
    for (let d = 6; d < L; d += 1) {
      if (!lock && mod(d - run, 6) >= 3) continue;
      p.col(lock ? '#ffffff' : C.ice[4], lock ? 0.85 : 0.55);
      p.dot(cx + ux * d, cy + uy * d);
    }
    const ex = cx + ux * L;
    const ey = cy + uy * L;
    ring(p, ex, ey, lock ? 4 : 6, lock ? '#ffffff' : C.ice[4], 0.8, (_a, i) => i % 2 === 0);
  }),
);

// ---- Небо арены: лучи сверхновой на полу, свет под лежащими планетами -------

/** Луч сверхновой по полу и в воздухе. */
function novaBeams(p: Pen, v: Readonly<F15BState>, S: number, now: number, floor: boolean): void {
  const nv = v.nova;
  const lord = lordNow();
  if (!nv || !lord || lord.mode !== 'f15l_core' || nv.stage !== 'beams') return;
  const t = now - nv.at;
  const warm = t < LORD.beamWarm;
  const cx = v.cx * S;
  const cy = v.cy * S;
  const L = (v.r + 0.5) * S;
  const hw = LORD.beamW * S;
  const fl = 0.85 + 0.15 * hash(Math.floor(now * 30), 1, 95);
  for (let i = 0; i < nv.n; i++) {
    const a = nv.a + (i * TAU) / nv.n;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const l0 = S * 0.7;
    if (floor) {
      p.col(C.ember[2], warm ? 0.12 * (t / LORD.beamWarm) : 0.22);
      fillLane(p, cx, cy, ux, uy, l0, L, hw * (warm ? 0.6 : 1.5));
      continue;
    }
    if (warm) {
      const k = t / LORD.beamWarm;
      const run = Math.floor(now * 30);
      for (let d = l0; d < L; d += 1) {
        if (mod(Math.floor(d) - run, 5) >= 3) continue;
        p.col(C.gold[2], (0.25 + 0.5 * k) * fl);
        p.dot(cx + ux * d, cy + uy * d);
      }
      p.col(C.gold[3], 0.2 * k);
      fillLane(p, cx, cy, ux, uy, l0, L, 0.6 + 1.4 * k);
      continue;
    }
    p.col(C.gold[1], 0.25 * fl);
    fillLane(p, cx, cy, ux, uy, l0, L, hw + 3);
    p.col(C.gold[2], 0.6 * fl);
    fillLane(p, cx, cy, ux, uy, l0, L, hw * 0.8);
    p.col('#ffffff', 0.95);
    fillLane(p, cx, cy, ux, uy, l0, L, 2.2);
    // Искры бегут по лучу наружу.
    for (let j = 0; j < 10; j++) {
      const f = mod(j / 10 + now * 0.9, 1);
      const d = l0 + (L - l0) * f;
      const o = (hash(j, i, 96) - 0.5) * hw * 1.6;
      p.col(j % 3 ? C.gold[3] : '#ffffff', 0.9 * (1 - f * 0.5));
      p.dot(cx + ux * d - uy * o, cy + uy * d + ux * o);
    }
  }
}

registerZonePainter(
  'f15b_fxsky',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const s = paintSim();
    const v = f15bView(s);
    if (!s || !v) return;
    const cx = z.x * S;
    const cy = z.y * S;
    const p = new Pen(g, px, py, cx, cy);
    p.occ = occOf(S);
    // Астролябия живая: риски колец медленно вращаются (внешнее — по
    // часовой, среднее — против), звёзды созвездий мерцают.
    const [vx0, vx1, vy0, vy1] = viewOf(p);
    const seen = (x: number, y: number) => x > vx0 && x < vx1 && y > vy0 && y < vy1;
    const [r0, r1, r2] = F15B_SKY.rings.map((r) => r * S);
    const rot = time * 0.045;
    for (let j = 0; j < 60; j++) {
      const a = rot + (j / 60) * TAU;
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      const x0 = cx + ux * (r2 + 1);
      const y0 = cy + uy * (r2 + 1);
      if (!seen(x0, y0)) continue;
      const long = j % 5 === 0;
      const L = long ? 4 : 2;
      p.lineS(
        x0,
        y0,
        x0 + ux * L,
        y0 + uy * L,
        long ? C.gold[1] : '#a8761e',
        long ? 0.95 : 0.8,
        0.5,
      );
    }
    for (let j = 0; j < 24; j++) {
      const a = -rot * 1.6 + (j / 24) * TAU;
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      const x0 = cx + ux * (r1 - 4);
      const y0 = cy + uy * (r1 - 4);
      if (!seen(x0, y0)) continue;
      if (j % 6 === 0) {
        // Указатель сети: ромб на кольце.
        p.col(C.gold[2], 0.9);
        p.dot(x0 - 1, y0, 3, 1);
        p.dot(x0, y0 - 1, 1, 3);
        p.col('#ffffff', 0.9);
        p.dot(x0, y0);
      } else {
        p.col('#a8761e', 0.75);
        p.dot(x0, y0);
      }
    }
    for (let j = 0; j < 8; j++) {
      const a = rot * 2.4 + (j / 8) * TAU;
      const x0 = cx + Math.cos(a) * (r0 + 2);
      const y0 = cy + Math.sin(a) * (r0 + 2);
      if (seen(x0, y0)) twinkle(p, x0, y0, 1, C.gold[2], 0.75);
    }
    if (!reduced())
      F15B_SKY.stars.forEach(([sx, sy], i) => {
        const x = cx + sx * S;
        const y = cy + sy * S;
        if (!seen(x, y)) return;
        const tw = Math.sin(time * (1.3 + hash(i, 5, 99) * 2.2) + i * 1.7);
        if (tw > 0.35) twinkle(p, x, y, tw > 0.8 ? 2 : 1, C.ice[5], (tw - 0.35) * 1.4);
      });
    novaBeams(p, v, S, s.time, true);
    // Свет под упавшими планетами.
    for (const pl of v.planets) {
      if (pl.stage !== 2) continue;
      p.col(C.ice[2], 0.22 + 0.06 * Math.sin(time * 4));
      oval(p, pl.x * S, pl.y * S, S * 0.9, S * 0.6);
    }
  }),
);

registerZonePainter(
  'f15b_fxplanets',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const s = paintSim();
    const v = f15bView(s);
    if (!s || !v) return;
    const cx = z.x * S;
    const cy = z.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const now = s.time;
    novaBeams(p, v, S, now, false);
    const lord = lordNow();
    v.planets.forEach((pl, i) => {
      if (pl.stage === 0) return;
      const t = now - pl.at;
      const pal = PL_PAL[i % 5];
      if (pl.stage === 2) {
        // Лежит в кратере: медленно поворачивается, светится; перед возвратом
        // мигает, и пунктир показывает дорогу назад, к короне.
        p.occ = occOf(S);
        const X = pl.x * S;
        const Y = pl.y * S;
        const r = PL_R[i] * 1.6;
        const glow = 0.5 + 0.2 * Math.sin(time * 5 + i);
        ring(p, X, Y - r * 0.4, r + 3, pal[2], glow * 0.55, (_a, q) => q % 2 === 0);
        const im = planetImg(i, r, Math.floor(time * 4) + i);
        p.alpha(1);
        p.img(im, X - im.width / 2, Y - r * 0.4 - im.height / 2, Y);
        p.occ = null;
        const back = k01((t - (LORD.orbitStay - 0.45)) / 0.45);
        if (back > 0 && lord) {
          const [hx2, hy2] = crownSpot(lord, i, now + (LORD.orbitStay - t));
          const mx = (pl.x + hx2) / 2;
          const my = Math.min(pl.y, hy2) - 1.8;
          dashArc(p, S, pl.x, pl.y, mx, my, hx2, hy2, 0, back, Math.floor(time * 18), pal[2], 0.7);
          if (!reduced() && Math.floor(time * 12) % 2 === 0)
            ring(p, X, Y - r * 0.4, r + 1, C.white, 0.8);
        }
        return;
      }
      // Летит по той же дуге, что у мозга, и кувыркается; за ним — хвост.
      const at = (u: number): [number, number] => {
        const uu = k01(u);
        if (pl.stage === 1) {
          const e = smooth3(uu) * 0.35 + uu * uu * 0.65;
          return [bez(pl.sx, pl.cx, pl.tx, e), bez(pl.sy, pl.cy, pl.ty, e)];
        }
        const [hx2, hy2] = lord ? crownSpot(lord, i, now) : [pl.sx, pl.sy];
        const e = smooth3(uu);
        const mx = (pl.sx + hx2) / 2;
        const my = Math.min(pl.sy, hy2) - 1.8;
        return [bez(pl.sx, mx, hx2, e), bez(pl.sy, my, hy2, e)];
      };
      const T = pl.stage === 1 ? LORD.orbitFly : LORD.orbitBack;
      const u = k01(t / T);
      const grow = pl.stage === 1 ? u : 1 - u;
      const r = PL_R[i] * (1 + 0.8 * grow);
      const n = reduced() ? 6 : 12;
      for (let j = n; j >= 1; j--) {
        const [x0, y0] = at(u - j * 0.028);
        const [x1, y1] = at(u - (j - 1) * 0.028);
        const f = j / n;
        const c = f < 0.25 ? C.white : f < 0.55 ? pal[2] : pl.stage === 1 ? '#c890f0' : pal[1];
        p.col(c, 0.85 * (1 - f));
        p.line(x0 * S, y0 * S, x1 * S, y1 * S);
        if (f < 0.6) p.line(x0 * S + 1, y0 * S, x1 * S + 1, y1 * S);
        if (f < 0.3) p.line(x0 * S, y0 * S + 1, x1 * S, y1 * S + 1);
      }
      const [X0, Y0] = at(u);
      const X = X0 * S;
      const Y = Y0 * S;
      ring(p, X, Y, r + 2, C.gold[3], 0.35, (_a, q) => q % 2 === 0);
      const im = planetImg(i, r, Math.floor(time * 16) + i * 3);
      p.alpha(1);
      p.img(im, X - im.width / 2, Y - im.height / 2);
    });
  }),
);

// ---- Затмение: ночь на всю арену, окна у героя и у распахнутого плаща -------

/** Видимая часть экрана в пикселях мира (с запасом в пиксель). */
function viewOf(p: Pen): [number, number, number, number] {
  const m = p.g.getTransform();
  const sc = m.a || 1;
  return [
    Math.floor(-m.e / sc - p.qx) - 1,
    Math.ceil((p.g.canvas.width - m.e) / sc - p.qx) + 1,
    Math.floor(-m.f / sc - p.qy) - 1,
    Math.ceil((p.g.canvas.height - m.f) / sc - p.qy) + 1,
  ];
}

function veil(
  p: Pen,
  cx: number,
  cy: number,
  R: number,
  holes: [number, number, number][],
  col: string,
  a: number,
  clip?: [number, number, number],
): void {
  const LV = [0, 0.35, 0.7, 1];
  const RING = [0.75, 1, 1.3];
  // Только видимая часть экрана: ночь на всю арену — сотни строк за кадром.
  const [vx0, vx1, vy0, vy1] = viewOf(p);
  const y0 = Math.max(vy0, Math.floor(cy - R), clip ? Math.floor(clip[1] - clip[2]) : -1e9);
  const y1 = Math.min(vy1, Math.ceil(cy + R), clip ? Math.ceil(clip[1] + clip[2]) : 1e9);
  const lvAt = (X: number, Y: number) => {
    let lv = 3;
    for (const [hx2, hy2, hr] of holes) {
      const d = Math.hypot(X + 0.5 - hx2, Y + 0.5 - hy2) / hr;
      lv = Math.min(lv, d < RING[0] ? 0 : d < RING[1] ? 1 : d < RING[2] ? 2 : 3);
    }
    return lv;
  };
  const cuts: number[] = [];
  // Строки без окон с теми же краями сливаются в один прямоугольник: в
  // затмении это почти весь экран — сотни строк превращаются в единицы.
  let bx0 = 0;
  let bx1 = -1;
  let by0 = 0;
  let bn = 0;
  const flush = () => {
    if (bn > 0) {
      p.col(col, a);
      p.rect(bx0, by0, bx1 - bx0 + 1, bn);
    }
    bn = 0;
  };
  for (let Y = y0; Y <= y1; Y++) {
    const yy = Y + 0.5 - cy;
    if (Math.abs(yy) >= R) continue;
    const hw = Math.sqrt(R * R - yy * yy);
    let xa = Math.max(vx0, Math.ceil(cx - hw - 0.5));
    let xb = Math.min(vx1, Math.floor(cx + hw - 0.5));
    if (clip) {
      const cyy = Y + 0.5 - clip[1];
      if (Math.abs(cyy) >= clip[2]) continue;
      const cw = Math.sqrt(clip[2] * clip[2] - cyy * cyy);
      xa = Math.max(xa, Math.ceil(clip[0] - cw - 0.5));
      xb = Math.min(xb, Math.floor(clip[0] + cw - 0.5));
    }
    if (xb < xa) continue;
    // Границы ступеней окон в этой строке: уровень меняется только на них.
    cuts.length = 0;
    for (const [hx2, hy2, hr] of holes) {
      const dy = Y + 0.5 - hy2;
      for (const k of RING) {
        const ro = hr * k;
        if (Math.abs(dy) >= ro) continue;
        const w = Math.sqrt(ro * ro - dy * dy);
        // Пиксель X внутри, если |X + 0.5 − hx| < w.
        cuts.push(Math.floor(hx2 - w - 0.5) + 1, Math.ceil(hx2 + w - 0.5));
      }
    }
    if (!cuts.length) {
      if (bn > 0 && (xa !== bx0 || xb !== bx1 || Y !== by0 + bn)) flush();
      if (bn === 0) {
        bx0 = xa;
        bx1 = xb;
        by0 = Y;
      }
      bn += 1;
      continue;
    }
    flush();
    cuts.push(xa, xb + 1);
    cuts.sort((q1, q2) => q1 - q2);
    let runX = xa;
    let runL = -1;
    for (let i = 0; i < cuts.length; i++) {
      const X0 = Math.max(xa, cuts[i]);
      if (X0 > xb) break;
      const X1 = i + 1 < cuts.length ? Math.min(xb, cuts[i + 1] - 1) : xb;
      if (X1 < X0) continue;
      // На отрезке уровень постоянен — кроме кромок, проверим оба конца.
      for (const X of X0 === X1 ? [X0] : [X0, X1]) {
        const lv = lvAt(X, Y);
        if (lv !== runL) {
          if (runL > 0 && X > runX) {
            p.col(col, a * LV[runL]);
            p.rect(runX, Y, X - runX, 1);
          }
          runX = X;
          runL = lv;
        }
      }
    }
    if (runL > 0 && xb >= runX) {
      p.col(col, a * LV[runL]);
      p.rect(runX, Y, xb - runX + 1, 1);
    }
  }
  flush();
}

registerZonePainter(
  'f15b_fxeclipse',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const s = paintSim();
    const v = f15bView(s);
    if (!s || !v || v.dark <= 0.01) return;
    const cx = z.x * S;
    const cy = z.y * S;
    const p = new Pen(g, px, py, cx, cy);
    // Тьма — на весь видимый мир: и коридор ворот, и лампы зала гаснут.
    const R = (v.r + 24) * S;
    const RS = (v.r + 3) * S;
    const holes: [number, number, number][] = [[s.hero.x * S, (s.hero.y - 0.4) * S, 1.5 * S]];
    const lord = lordNow();
    const open = !!lord && lord.mode === 'f15l_open';
    if (open && lord) holes.push([lord.x * S, (lord.y - 2.2) * S, 3.4 * S * k01(lord.t / 0.4)]);
    // Ночь выходит из плаща волной: фронт бежит от владыки по арене, а когда
    // свет возвращается — сворачивается обратно в плащ.
    const lx = lord ? lord.x * S : cx;
    const ly = lord ? (lord.y - 2.2) * S : cy;
    const maxR = Math.hypot(lx - cx, ly - cy) + R;
    const w = k01(v.dark / 0.9);
    const Rw = maxR * w;
    if (Rw < 2) return;
    const a = 0.8;
    const [vx0, vx1, vy0, vy1] = viewOf(p);
    const inArena = (x: number, y: number) =>
      x > vx0 && x < vx1 && y > vy0 && y < vy1 && Math.hypot(x - cx, y - cy) < R;
    veil(p, lx, ly, Rw, holes, C.night[0], a, [cx, cy, R]);
    // Фронт волны: кайма ночи светится фиолетом, по ней бегут звёзды.
    if (w < 0.999) {
      const keep = (t: number) => inArena(lx + Math.cos(t) * Rw, ly + Math.sin(t) * Rw);
      ring(p, lx, ly, Rw + 2, C.night[0], 0.45, (t) => keep(t));
      ring(p, lx, ly, Rw, '#6a34a4', 0.85, (t, i) => keep(t) && hash(i >> 2, 3, 97) > 0.2);
      ring(p, lx, ly, Rw - 2, '#c890f0', 0.6, (t, i) => keep(t) && i % 3 === 0);
      if (!reduced())
        for (let i = 0; i < 24; i++) {
          const t = (i / 24) * TAU + time * 0.4;
          const x = lx + Math.cos(t) * (Rw - 4);
          const y = ly + Math.sin(t) * (Rw - 4);
          if (inArena(x, y)) twinkle(p, x, y, 1, C.gold[3], 0.8);
        }
    }
    // Небо затмения: редкие звёзды мерцают — только там, куда дошла ночь.
    for (let i = 0; i < 60; i++) {
      const rr = RS * Math.sqrt(hash(i, 1, 97));
      const aa = TAU * hash(i, 2, 97);
      const x = cx + Math.cos(aa) * rr;
      const y = cy + Math.sin(aa) * rr * 0.9;
      if (Math.hypot(x - lx, y - ly) > Rw - 3) continue;
      const tw = 0.5 + 0.5 * Math.sin(time * (1.5 + hash(i, 3, 97) * 3) + i);
      p.col(i % 5 ? C.ice[4] : C.gold[3], a * 0.5 * tw);
      p.dot(x, y);
    }
    // Плащ распахнут — кромка окна золотом.
    if (open && lord)
      ring(
        p,
        lord.x * S,
        (lord.y - 2.2) * S,
        3.4 * S * k01(lord.t / 0.4),
        C.gold[3],
        0.5 * v.dark,
        (_a, i) => mod(i + Math.floor(time * 10), 6) < 3,
      );
  }),
);

// ---- Созвездие выходит из плаща и звезда возвращается на плащ ---------------

registerZonePainter(
  'f15b_fxfold',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number) => {
    const zz = z as FxZone;
    const sx = zz.x * S;
    const sy = zz.y * S;
    const p = new Pen(g, px, py, sx, sy);
    const tx = (zz.tx ?? zz.x) * S;
    const ty = (zz.ty ?? zz.y) * S;
    const L = zz.life;
    const t = zz.t;
    const n = 12;
    const fly = L * 0.55;
    const ends: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + (zz.n ?? 0);
      ends.push([
        tx + Math.cos(a) * S * (0.7 + 0.25 * hash(i, 7, 98)),
        ty - S * 0.6 + Math.sin(a) * S * 0.55,
      ]);
    }
    const out = 1 - k01((t - (L - 0.35)) / 0.35);
    for (let i = 0; i < n; i++) {
      const d = i * 0.04;
      const u = k01((t - d) / fly);
      if (u <= 0) continue;
      const [ex, ey] = ends[i];
      const ox = sx + (hash(i, 1, 98) - 0.5) * 18;
      const oy = sy + (hash(i, 2, 98) - 0.5) * 10;
      const mx = (ox + ex) / 2 + (hash(i, 3, 98) - 0.5) * 30;
      const my = Math.min(oy, ey) - S * 2.5;
      const pos = (q: number): [number, number] => {
        const e = smooth3(k01(q));
        return [bez(ox, mx, ex, e), bez(oy, my, ey, e)];
      };
      if (u < 1)
        for (let j = 1; j <= 5; j++) {
          const [x, y] = pos(u - j * 0.04);
          p.col('#c890f0', 0.6 * (1 - j / 6));
          p.dot(x, y);
        }
      const [x, y] = pos(u);
      twinkle(p, x, y, u >= 1 ? 2 : 1, C.gold[3], out);
    }
    // Долетели — созвездие сшивается линиями и гаснет в тело эха.
    const join = k01((t - fly - 0.5) / 0.4);
    if (join > 0)
      for (let i = 0; i < n; i++) {
        const [x0, y0] = ends[i];
        const [x1, y1] = ends[(i + 1) % n];
        p.lineS(x0, y0, x0 + (x1 - x0) * join, y0 + (y1 - y0) * join, C.gold[2], 0.6 * out, 0);
      }
  }),
);

registerZonePainter(
  'f15b_fxkindle',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number) => {
    const zz = z as FxZone;
    const ox = zz.x * S;
    const oy = zz.y * S;
    const p = new Pen(g, px, py, ox, oy);
    const lord = lordNow();
    const tx = (lord ? lord.x : (zz.tx ?? zz.x)) * S;
    const ty = (lord ? lord.y - 2.4 : (zz.ty ?? zz.y)) * S;
    const t = zz.t;
    // Вспышка на месте павшего эха.
    if (t < 0.3) {
      hitStar(p, ox, oy - 8, t, 0.3, S * 0.9, 0.2, C.gold[2]);
      ring(p, ox, oy, 4 + t * 60, C.gold[3], 1 - t / 0.3);
    }
    // Пять звёзд летят на плащ.
    for (let i = 0; i < 5; i++) {
      const u = k01((t - 0.08 - i * 0.04) / 0.62);
      if (u <= 0 || u >= 1) continue;
      const mx = (ox + tx) / 2 + (i - 2) * 10;
      const my = Math.min(oy, ty) - S * 1.8;
      const pos = (q: number): [number, number] => {
        const e = eIn2(k01(q));
        return [bez(ox, mx, tx, e), bez(oy - 8, my, ty, e)];
      };
      // След — сплошной хвост кометы: у головы белый, к концу золото гаснет.
      let [lx, ly] = pos(u);
      for (let j = 1; j <= 9; j++) {
        const [x, y] = pos(u - j * 0.03);
        p.lineS(lx, ly, x, y, j < 3 ? C.gold[3] : C.gold[2], 0.85 * (1 - j / 10), j < 4 ? 0.5 : 0);
        lx = x;
        ly = y;
      }
      const [x, y] = pos(u);
      twinkle(p, x, y, 2, C.white, 1);
    }
    // Звезда загорелась на плаще: вспышка лучами, кольцо, искры.
    const k = k01((t - 0.7) / 0.4);
    if (k > 0 && k < 1) {
      hitStar(p, tx, ty, t - 0.7, 0.3, S * 1.1, 0.25, C.gold[3]);
      ring(p, tx, ty, 2 + k * 18, C.gold[3], 1 - k, undefined, 0.5);
      ring(p, tx, ty, 1 + k * 10, C.white, 0.8 * (1 - k), (_a, i) => i % 3 !== 2);
      twinkle(p, tx, ty, Math.round(4 * (1 - k)) + 1, C.gold[3], 1 - k * 0.5);
      sparks(
        p,
        (zz.n ?? 0) * 31 + 5,
        t - 0.7,
        tx,
        ty,
        reduced() ? 4 : 10,
        0,
        TAU,
        30,
        50,
        0.4,
        -20,
        starCol,
      );
    }
  }),
);

// ---- Сверхновая: звезда раздувается, вспышка; финал: звезда рождается ------

registerZonePainter(
  'f15b_fxnova',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const zz = z as FxZone;
    const fx = zz.x * S;
    const fy = zz.y * S;
    const p = new Pen(g, px, py, fx, fy);
    const lord = lordNow();
    // Звезда копится в ядре владыки (над полом), волна идёт по полу.
    const cx = lord ? lord.x * S : fx;
    const cy = lord ? (lord.y - 3.5) * S : fy - 3.5 * S;
    const few = reduced();
    const t = zz.t;
    const T = LORD.nova - 0.6;
    if (t < T + 0.1) {
      const k = k01(t / T);
      // Звёздная пыль арены стекается спиралью в ядро — всё быстрее.
      const n = few ? 18 : 40;
      const Rm = S * 7;
      for (let i = 0; i < n; i++) {
        const f = mod(hash(i, 1, 141) + t * (0.35 + 0.9 * k), 1);
        const pos = (q: number): [number, number] => {
          const rr = Rm * Math.pow(1 - q, 1.6);
          const aa = hash(i, 2, 141) * TAU + q * 2.6;
          return [cx + Math.cos(aa) * rr, cy + Math.sin(aa) * rr * 0.75];
        };
        const [x0, y0] = pos(Math.max(0, f - 0.05));
        const [x1, y1] = pos(f);
        p.col(starCol(1 - f), (0.3 + 0.6 * k) * (f < 0.1 ? f * 10 : 1));
        p.line(x0, y0, x1, y1);
      }
      // Лучи из ядра: растут и крутятся.
      const rays = 12;
      for (let i = 0; i < rays; i++) {
        const a = (i / rays) * TAU + time * 0.3;
        const L = S * (0.5 + 2.6 * eIn2(k)) * (i % 2 ? 0.6 : 1);
        p.lineS(
          cx,
          cy,
          cx + Math.cos(a) * L,
          cy + Math.sin(a) * L,
          i % 2 ? C.gold[2] : C.gold[3],
          0.35 + 0.5 * k,
          0,
        );
      }
      // Ядро разгорается: кольца света, белая сердцевина.
      const r = S * (0.25 + 0.75 * eIn2(k)) * (1 + 0.06 * Math.sin(time * 20));
      ring(p, cx, cy, r * 1.6, C.gold[2], 0.35 + 0.4 * k, (_a, i) => i % 2 === 0);
      ring(p, cx, cy, r * 1.25, C.gold[3], 0.6);
      p.col(C.gold[3], 0.75);
      oval(p, cx, cy, r, r);
      p.col('#ffffff', 0.95);
      oval(p, cx, cy, r * 0.55, r * 0.55);
      // На полу — кольцо астролябии сходится к звезде.
      const f = mod(t * 0.9, 1);
      ring(p, fx, fy, S * (6 - 5 * f), C.gold[2], 0.5 * k * (1 - f), (_a, i) => i % 3 !== 0, 0.4);
    }
    const e = t - T;
    if (e >= 0) {
      // Вспышка — кольцами, а не белым экраном: сцену видно.
      if (e < 0.5) {
        const u = e / 0.5;
        p.col('#ffffff', (few ? 0.35 : 0.55) * (1 - u));
        oval(p, cx, cy, S * (0.8 + 1.6 * eOut2(u)), S * (0.8 + 1.6 * eOut2(u)));
        for (let j = 0; j < 3; j++) {
          const uu = k01(u * 1.2 - j * 0.15);
          if (uu <= 0 || uu >= 1) continue;
          ring(
            p,
            fx,
            fy,
            S * (1 + 11 * eOut2(uu)),
            j === 1 ? '#c890f0' : C.gold[3],
            0.9 * (1 - uu),
            undefined,
            0.5,
          );
        }
      }
      sparks(p, 4141, e, cx, cy, few ? 10 : 30, 0, Math.PI, 120, 160, 1.0, 40, starCol);
    }
  }),
);

registerZonePainter(
  'f15b_fxfinale',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const zz = z as FxZone;
    const cx = zz.x * S;
    const cy = zz.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const t = zz.t;
    const s = paintSim();
    const R = (f15bView(s)?.r ?? 13) * S;
    // Вспышка короткая: под ней рассыпается плащ — сцену не закрывать.
    if (t < 0.22) {
      const u = t / 0.22;
      p.col('#fffaf0', (reduced() ? 0.1 : 0.22) * (1 - u));
      oval(p, cx, cy, S + R * eOut2(u), S + R * eOut2(u));
    }
    // Звёзды плаща возвращаются на небо арены: из владыки разлетаются
    // дугами, садятся звёздами пола, мерцают и гаснут к концу сцены.
    const lord = lordNow();
    const ox = lord ? lord.x * S : cx;
    const oy = lord ? (lord.y - 2.2) * S : cy - 2 * S;
    const nStar = reduced() ? 16 : 36;
    const gone = 1 - k01((t - 2.4) / 0.8);
    for (let i = 0; i < nStar; i++) {
      const u = k01((t - 0.12 - 0.5 * hash(i, 4, 103)) / 1.1);
      if (u <= 0) continue;
      const rr = R * (0.3 + 0.62 * Math.sqrt(hash(i, 5, 103)));
      const aa = TAU * hash(i, 6, 103);
      const ex = cx + Math.cos(aa) * rr;
      const ey = cy + Math.sin(aa) * rr;
      const mx = (ox + ex) / 2;
      const my = Math.min(oy, ey) - S * (1.5 + 2 * hash(i, 7, 103));
      const pos = (q: number): [number, number] => {
        const e = eOut2(k01(q));
        return [bez(ox, mx, ex, e), bez(oy, my, ey, e)];
      };
      if (u < 1) {
        let [lx, ly] = pos(u);
        for (let j = 1; j <= 5; j++) {
          const [x, y] = pos(u - j * 0.035);
          p.lineS(lx, ly, x, y, C.gold[2], 0.7 * (1 - j / 6) * gone, 0);
          lx = x;
          ly = y;
        }
      }
      const [x, y] = pos(u);
      // Села — звезда вспыхивает кольцом и дальше мерцает.
      const land = t - 0.12 - 0.5 * hash(i, 4, 103) - 1.1;
      if (land > 0 && land < 0.3)
        ring(p, x, y, 1 + 9 * eOut2(land / 0.3), C.gold[3], 0.8 * (1 - land / 0.3));
      // Севшая звезда крупнее звёзд неба и с ореолом — иначе тонет в россыпи.
      const flick = land < 0.3 || Math.sin(time * 4 + i * 1.7) > 0.3;
      const big = u >= 1 ? (flick ? 3 : 2) : 1;
      if (u >= 1) {
        p.col(C.gold[2], 0.2 * gone);
        oval(p, x, y, 3.5, 3.5);
      }
      twinkle(p, x, y, big, u < 1 ? C.white : C.gold[3], gone);
    }
    for (let j = 0; j < 3; j++) {
      const u = (t - j * 0.3) / 2;
      if (u <= 0 || u >= 1) continue;
      ring(
        p,
        cx,
        cy,
        S + R * 1.1 * eOut2(u),
        j === 1 ? '#c890f0' : C.gold[3],
        1 - u,
        (_a, i) => hash(i >> 1, j, 99) > 0.2,
      );
    }
    embers(
      p,
      777,
      t,
      reduced() ? 24 : 70,
      2.2,
      50,
      (i) => hash(i, 1, 101) * 1.2,
      (i) => {
        const rr = R * Math.sqrt(hash(i, 2, 101));
        const aa = TAU * hash(i, 3, 101);
        return [cx + Math.cos(aa) * rr, cy + Math.sin(aa) * rr];
      },
      1,
      starCol,
    );
    // Звезда рождается заново: золотой крест в центре.
    const k = k01((t - 0.4) / 1.2);
    if (k > 0)
      twinkle(
        p,
        cx,
        cy - 6,
        Math.round(2 + 6 * eOut2(k)),
        C.gold[3],
        0.6 + 0.4 * Math.sin(time * 6),
      );
  }),
);

// ---- Луч обжёг героя; дирижёр будит четверть --------------------------------

registerZonePainter(
  'f15b_fxsear',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number) => {
    const zz = z as FxZone;
    const cx = zz.x * S;
    const cy = zz.y * S - 8;
    const p = new Pen(g, px, py, cx, cy);
    const t = zz.t;
    const a = (zz.ang ?? 0) + Math.PI / 2;
    const sd = seedOf(zz.id);
    if (t < 0.08) {
      p.col('#ffffff', 1 - t / 0.08);
      oval(p, cx, cy, 6, 6);
    }
    sparks(p, sd, t, cx, cy, 8, a, 0.6, 50, 50, 0.4, 40, emberCol);
    sparks(p, sd + 1, t, cx, cy, 8, a + Math.PI, 0.6, 50, 50, 0.4, 40, emberCol);
  }),
);

const quadMid = new WeakMap<number[], [number, number]>();
function quadCenter(cells: number[], W: number): [number, number] {
  const hit = quadMid.get(cells);
  if (hit) return hit;
  let sx = 0;
  let sy = 0;
  for (const i of cells) {
    sx += (i % W) + 0.5;
    sy += Math.floor(i / W) + 0.5;
  }
  const out: [number, number] = cells.length ? [sx / cells.length, sy / cells.length] : [0, 0];
  quadMid.set(cells, out);
  return out;
}

registerZonePainter(
  'f15b_fxconduct',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const zz = z as FxZone;
    const s = paintSim();
    const v = f15bView(s);
    const lord = lordNow();
    if (!s || !v || !lord) return;
    const qd = v.quads.find((x) => x.q === zz.q);
    if (!qd || !qd.area.length) return;
    const [qx, qy] = quadCenter(qd.area, s.world.w);
    const cx = zz.x * S;
    const cy = zz.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const t = zz.t;
    const env = k01(t / 0.2) * (1 - k01((t - (zz.life - 0.35)) / 0.35));
    const ex = qx * S;
    const ey = qy * S;
    // Нить — от поднятой ладони (точка из кадра «Тела»).
    const [hx2, hy2] = handAt(lord, S, ex, ey);
    const col = QUAD_HEX[mod(zz.q ?? 0, 4)];
    // Нить от поднятой руки к четверти, по ней бежит свет.
    const n = Math.max(8, Math.floor(Math.hypot(ex - hx2, ey - hy2) / 3));
    for (let j = 0; j < n; j++) {
      const f = j / n;
      const x = hx2 + (ex - hx2) * f;
      const y = hy2 + (ey - hy2) * f - Math.sin(f * Math.PI) * S * 1.2;
      const pulse = Math.abs(mod(f - t * 1.6, 1) - 0.5) < 0.06;
      p.col(pulse ? '#ffffff' : C.gold[2], env * (pulse ? 1 : 0.55));
      p.dot(x, y);
    }
    // Знак над четвертью: круг и четыре спицы.
    ring(p, ex, ey, S * 1.5, col, env * 0.9, (_a, i) => i % 2 === 0, 0.4);
    for (let q = 0; q < 4; q++) {
      const a = (q * TAU) / 4 + time * 1.2;
      p.lineS(
        ex + Math.cos(a) * S * 0.6,
        ey + Math.sin(a) * S * 0.6,
        ex + Math.cos(a) * S * 1.4,
        ey + Math.sin(a) * S * 1.4,
        col,
        env * 0.8,
        0.3,
      );
    }
  }),
);

// ---- Прогрев: заготовки и сухой прогон рисовальщиков ------------------------

const WARM_STRIKES: [string, 'circle' | 'line' | 'cone' | 'ring', number, number?, number?][] = [
  ['f15b_palm', 'circle', 1.7],
  ['f15b_sweep', 'cone', 3.3, 0, 1.9],
  ['f15b_repel', 'ring', 4, 0.55],
  ['f15b_well', 'circle', 1.6],
  ['f15b_planet', 'circle', 1.15],
  ['f15b_meteor', 'circle', 1],
  ['f15b_nightclaw', 'cone', 3.8, 0, 1.6],
  ['f15b_starfall', 'circle', 0.95],
  ['f15b_pulse', 'ring', 6.4, 0.6, TAU - 1.3],
  ['f15b_shock', 'ring', 2.6, 0.6],
  ['f15b_kslam', 'circle', 2.1],
  ['f15b_klance', 'line', 6, 0.45],
  ['f15b_erupt', 'circle', 1.15],
  ['f15b_geyser', 'circle', 1.3],
  ['f15b_mbeam', 'line', 8, 0.38],
  ['f15b_hbite', 'circle', 1.45],
  ['f15b_slash', 'cone', 3.1, undefined, 2.3],
  ['f15b_cleave', 'line', 6, 0.72],
  ['f15b_axe', 'circle', 1.5],
  ['f15b_bite', 'cone', 2.5, undefined, 1.3],
  ['f15b_bite', 'circle', 1.15],
  ['f15b_flame', 'line', 8, 0.5],
  ['f15b_bolt', 'circle', 1.45],
];
const WARM_SHOTS = ['f15b_fireball', 'f15b_ice'];
const WARM_FX = [
  'f15b_fxsky',
  'f15b_fxplanets',
  'f15b_fxeclipse',
  'f15b_fxconduct',
  'f15b_fxaim',
  'f15b_fxqwake',
  'f15b_fxswirl',
  'f15b_fxwarp',
  'f15b_flames',
  'f15b_miasma',
  'f15b_mist',
  'f15b_fxsear',
  'f15b_fxkindle',
  'f15b_fxfold',
  'f15b_fxnova',
  'f15b_fxfinale',
];

function* warmFx(): Generator<void> {
  for (let pal = 0; pal < 3; pal++)
    for (let h = 3; h <= 14; h++) {
      for (let f = 0; f < 4; f++) flameImg(h, f, pal);
      yield;
    }
  for (let pal = 0; pal < PUFF_PAL.length; pal++)
    for (let r = 1; r <= 12; r++) {
      for (let v = 0; v < 4; v++) puffImg(pal, r, v);
      yield;
    }
  for (let pal = 0; pal < CHUNK_PAL.length; pal++) {
    for (let sz = 1; sz <= 4; sz++) for (let f = 0; f < 4; f++) chunkImg(sz, f, pal);
    yield;
  }
  for (let d = 0; d < 16; d++) {
    for (let f = 0; f < 2; f++) iceShot(d, f);
    yield;
  }
  for (let f = 0; f < 4; f++) for (let d = 0; d < 8; d++) ghostFireball(f, d);
  hydraHead(0);
  hydraHead(1);
  ghostAxe();
  yield;
  // Планеты: все радиусы полёта (от короны до ×1,8) и лёжа, по 8 кадров.
  for (let i = 0; i < 5; i++) {
    for (let r = Math.round(PL_R[i]); r <= Math.round(PL_R[i] * 1.8); r++)
      for (let f = 0; f < 8; f++) planetImg(i, r, f);
    yield;
  }
  for (const sz of [5, 6]) for (let f = 0; f < 8; f++) rockImg(sz, f);
  yield;
  for (let h = 2; h <= 56; h += 2) {
    for (let f = 0; f < 4; f++) waterCol(h, f);
    yield;
  }
  for (let r = 2; r <= 20; r++) for (let t = 0; t < 3; t++) scorchImg(r, t);
  yield;
  for (let v = 0; v < 8; v++) boltCol(v, 96);
  yield;
  for (let r = 1; r <= 140; r += 10) {
    for (let q = r; q < r + 10; q++) circle(q);
    yield;
  }
  // Сухой прогон: каждый рисовальщик — несколько кадров на черновике.
  const c = document.createElement('canvas');
  c.width = 200;
  c.height = 200;
  const g = c.getContext('2d');
  if (!g) return;
  let n = 0;
  for (const [art, shape, r, w, arc] of WARM_STRIKES) {
    const zp = ZONE_PAINTERS.get(art);
    const imp = IMPACT_PAINTERS.get(art);
    const warn = 0.8;
    for (const k of [0.3, 0.9]) {
      const st = {
        shape,
        x: 0,
        y: 0,
        r,
        w,
        arc,
        ang: 0.4,
        warn,
        dmg: 0,
        t: warn * k,
        id: 900 + n++,
        art,
      } as Strike;
      zp?.(g, st, 100, 100, 16, 1);
      yield;
    }
    for (const age of [0, 0.06, 0.2, 0.5]) {
      imp?.paint(
        g,
        { art, x: 0, y: 0, shape, r, w, arc, ang: 0.4, seed: 4242 + n, vx: 3, vy: 1 },
        100,
        100,
        16,
        age,
        1,
      );
      yield;
    }
  }
  for (const art of WARM_SHOTS) {
    const imp = IMPACT_PAINTERS.get(art);
    for (const age of [0, 0.1, 0.4]) {
      imp?.paint(g, { art, x: 0, y: 0, seed: 77, vx: 4, vy: 2 }, 100, 100, 16, age, 1);
      yield;
    }
  }
  for (const art of WARM_FX) {
    const zp = ZONE_PAINTERS.get(art);
    for (const t of [0.05, 0.4]) {
      zp?.(g, { x: 0, y: 0, r: 1, life: 1, t, id: -1 - n++, art } as Zone, 100, 100, 16, 1);
      yield;
    }
  }
  g.clearRect(0, 0, 200, 200);
}

registerMobWarm('f15boss', warmFx);
