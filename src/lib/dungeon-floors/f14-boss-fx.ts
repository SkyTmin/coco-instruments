// Этаж 14, босс «Повелитель часа» — техники (v2.87): метки ударов, контакт,
// остановка времени, ножи, песочные часы отмотки, полночь. Тело Повелителя
// рисует `f14-art.ts`, здесь — всё, что он делает с МИРОМ. Договор движка —
// библия §14.
//
// Язык этажа — ЧАСЫ, и он один на все приёмы:
//   • «куда» — вся фигура удара с первого кадра: тёмный багрец и минутная
//     дорожка рисок по кромке (абсолютные риски циферблата — 60 на круг,
//     каждая пятая длинная);
//   • «когда» — стрелка ЩЁЛКАЕТ, налив ТЕЧЁТ: тень стрелки идёт по метке
//     рывками от риски к риске с разгоном, за ней плавно наливается цвет,
//     пройденные риски загораются латунью; стрелка доходит до края ровно в
//     миг урона. Последние 0,2 с — белая кромка и «тик-тик»;
//   • контакт (`registerImpactPainter`) — смаз клинка с проводкой за край,
//     звон кольцами, искры латуни по ходу, рубец в эмали остывает от белого,
//     сколы эмали летят и отскакивают, пыль садится; тряска по силе удара;
//   • приёмы без своего strike (минутная, остановка, ножи, телепорт, удары
//     часов в полночь, шаги) — визуальные зоны `f14b_*`, их ставит мозг
//     через `api.vfx` (без урона и статусов, номер мимо `nextId`).
//
// Всё светящееся — поверх темноты (`above`); то, что в этом слое лежит на
// полу (рубец, трещины, сколы), прячется за телами ближе к камере (`occOf`).
// Пиксели — на СЕТКЕ МИРА (`Pen`): эффект не плывёт по полу с камерой.
// Частицы детерминированы: позиция — от зерна и возраста, а не копится по
// кадрам; стоп-кадр держит позу сам, лист кадров и игра рисуют одно.
//
// Время. Мир в остановке стоит — `zone.t` и `strike.t` не идут, и метки
// замирают сами. Что обязано жить в остановке (вспышки ножей, телепорт,
// «стекло» остановки), считает настоящие секунды: `f14Time` (сколько идёт
// остановка) или часы рендера с первого кадра зоны (`seenAt`).
import { Px } from '../dungeon-art';
import { BOSS_SCRIPTS } from '../dungeon-ai';
import {
  paintSim,
  registerImpactPainter,
  registerMobWarm,
  registerShotPainter,
  registerZonePainter,
  SHOT_PAINTERS,
} from '../dungeon-paint';
import type { ImpactRec, Sprite } from '../dungeon-paint';
import type { Mob, Sim, Strike, Zone } from '../dungeon-sim';
import { lordPointPx } from './f14-art';
import type { LordPoint } from './f14-art';
import { F14_FX, f14State, f14Time, KNIFE_ANG, LORD, worldStopped } from './f14-brains';

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
/** Зерно зоны: номер может быть отрицательным — только так. */
const seedOf = (id: number) => (id >>> 0) % 100003;

/** Последние 0,2 с перед уроном — ясный сигнал «сейчас». */
const SIG = 0.2;
/** «Тик-тик»: две вспышки в последние 0,2 с (0,20…0,15 и 0,10…0,05). */
const tick = (left: number) => left < SIG && Math.floor(left / 0.05) % 2 === 1;

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

// ---- Палитра: латунь, эмаль, сталь, бирюза времени, лунная ночь ------------

const C = {
  ink: '#150f0b',
  inkN: '#03040a',
  white: '#fffaf0',
  brass: ['#3a2410', '#7a5220', '#b8862e', '#f0c860', '#fff0b0'],
  steel: ['#2a3038', '#58626e', '#98a4b0', '#e4ecf4', '#ffffff'],
  teal: ['#0e3a44', '#1e7a88', '#4cc8d8', '#b8f4ff', '#8fe8ff'],
  sand: ['#6a4a24', '#a8844c', '#d8b878', '#f4e2b0'],
  ice: ['#26324a', '#627088', '#b4c2d8', '#d8e8ff', '#ffffff'],
  moon: ['#0a1026', '#34406a', '#7a8ac8', '#c8d8ff', '#ffffff'],
  night: '#04060e',
  violet: ['#1a1030', '#3a2a6a', '#7a64c8', '#c8b8ff'],
};

/** Свет фазы Повелителя: янтарь, лёд остановки, бирюза отмотки, луна полночи. */
const GLOW = ['#ffb040', '#d8e8ff', '#8fe8ff', '#c8d8ff'];
const GLOW_HI = ['#fff0b0', '#ffffff', '#e8ffff', '#ffffff'];

/** Метка удара по фазе: пол арены меняется (кость, лёд, бирюза, ночь). */
interface MarkPal {
  /** «Куда»: заливка всей фигуры. */
  fill: string;
  fillA: number;
  /** Налив за стрелкой. */
  sweep: string;
  sweepHot: string;
  /** Кромка и её тень. */
  edge: string;
  edgeSh: string;
  /** Риски: не пройдены / пройдены. */
  tick: string;
  tickOn: string;
  /** Тень стрелки. */
  shade: string;
  shadeA: number;
}
const MARK: MarkPal[] = [
  {
    fill: '#5a0c10',
    fillA: 0.3,
    sweep: '#a41c22',
    sweepHot: '#d82a24',
    edge: '#e8302a',
    edgeSh: '#2a0806',
    tick: '#3a1206',
    tickOn: '#ffd860',
    shade: '#1a0604',
    shadeA: 0.62,
  },
  {
    fill: '#4a0818',
    fillA: 0.32,
    sweep: '#9a1a2a',
    sweepHot: '#d02a34',
    edge: '#ff3a40',
    edgeSh: '#10141e',
    tick: '#1a2238',
    tickOn: '#ffffff',
    shade: '#0a0e18',
    shadeA: 0.62,
  },
  {
    fill: '#5a0a12',
    fillA: 0.34,
    sweep: '#a81a22',
    sweepHot: '#e02a2a',
    edge: '#ff4a38',
    edgeSh: '#04161a',
    tick: '#06262a',
    tickOn: '#ffe0a0',
    shade: '#021014',
    shadeA: 0.62,
  },
  {
    fill: '#8a1430',
    fillA: 0.3,
    sweep: '#c8243a',
    sweepHot: '#ff3a48',
    edge: '#ff5a5a',
    edgeSh: '#000000',
    tick: '#3a1a40',
    tickOn: '#c8d8ff',
    shade: '#000004',
    shadeA: 0.66,
  },
];

/** Фаза Повелителя для картинки (вне кадра — первая). */
const phaseNow = () => Math.max(0, Math.min(3, F14_FX.bossPhase | 0));
const markPal = () => MARK[phaseNow()];

/** Искра латуни по доле жизни: белая → светлая латунь → латунь → тёмная. */
const brassSpark = (k: number) =>
  k < 0.15
    ? '#ffffff'
    : k < 0.4
      ? C.brass[4]
      : k < 0.7
        ? C.brass[3]
        : k < 0.88
          ? C.brass[2]
          : C.brass[1];
/** Искра стали: белая → холодная → серая. */
const steelSpark = (k: number) =>
  k < 0.2 ? '#ffffff' : k < 0.5 ? C.steel[3] : k < 0.8 ? C.steel[2] : C.steel[1];
/**
 * Искра горячей латуни: белая → жёлтая → оранжевая → красная. Не «латунь»:
 * на светлой эмали жёлто-бурая искра терялась — насыщенный огонь читается.
 */
const hotSpark = (k: number) =>
  k < 0.15
    ? '#ffffff'
    : k < 0.35
      ? '#fff0a0'
      : k < 0.6
        ? '#ffb040'
        : k < 0.85
          ? '#e86018'
          : '#8a2a08';
/** Искра серебра (стрелки в остановке и полночь): белая → лёд → синь. */
const iceSpark = (k: number) =>
  k < 0.2 ? '#ffffff' : k < 0.45 ? '#d8e8ff' : k < 0.75 ? '#8aa8e0' : '#4a5a98';
/** Металл стрелок по фазе: латунь (0, 2) или серебро (1, 3) — как у тела. */
const metalSpark = (ph: number) => (ph === 1 || ph === 3 ? iceSpark : hotSpark);
/** Смаз клинка по фазе: голова, тело, хвост, тень хвоста. */
const SMEAR: string[][] = [
  ['#ffffff', '#ffd868', '#f08a20', '#a8400c'],
  // Серебро на светлой ледяной эмали: тело — холодная синь, иначе пропадало.
  ['#ffffff', '#a8c0f0', '#4a64b0', '#1e2a58'],
  ['#ffffff', '#ffd868', '#f08a20', '#a8400c'],
  ['#ffffff', '#e0e6ff', '#9a8ae8', '#4a2a98'],
];
/** Искра времени: белая → бирюза. */
const timeSpark = (k: number) =>
  k < 0.2 ? '#ffffff' : k < 0.5 ? C.teal[3] : k < 0.8 ? C.teal[4] : C.teal[2];
/** Звёздная искра полночи. */
const moonSpark = (k: number) =>
  k < 0.25 ? '#ffffff' : k < 0.55 ? C.moon[3] : k < 0.8 ? C.moon[2] : C.violet[2];
// ---- Перо: пиксели на сетке мира -------------------------------------------

/**
 * Рисует в игровых пикселях, привязанных к сетке МИРА: `(px, py)` — где на
 * экране точка мира `(wx, wy)` (в пикселях мира). Поправка `qx/qy` — остаток
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
    for (let n = 0; n < 800; n++) {
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
  /**
   * Линия, что прячется за телами: `occ(x, y, y + lift)` — пиксель на высоте
   * `lift` над полом (след в воздухе за спиной не ложится на грудь).
   */
  lineO(x0: number, y0: number, x1: number, y1: number, occ: Occ, lift: number): void {
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
    let lx = 1e9;
    let ly = 1e9;
    for (let i = 0; i <= n; i++) {
      const x = Math.floor(x0 + ((x1 - x0) * i) / n);
      const y = Math.floor(y0 + ((y1 - y0) * i) / n);
      if (x === lx && y === ly) continue;
      lx = x;
      ly = y;
      if (!occ(x, y, y + lift)) this.g.fillRect(x + this.qx, y + this.qy, 1, 1);
    }
  }
  /** Линия с тенью на пиксель вниз-вправо — читается на пёстром полу. */
  lineS(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    c: string,
    a: number,
    sh = 0.5,
    shc = C.ink,
  ): void {
    if (sh > 0) {
      this.col(shc, a * sh);
      this.line(x0 + 1, y0 + 1, x1 + 1, y1 + 1);
    }
    this.col(c, a);
    this.line(x0, y0, x1, y1);
  }
}

// ---- Кто заслоняет: тела ближе к камере ------------------------------------

/**
 * Слой поверх темноты рисуется после всех мобов. То, что в нём лежит на
 * полу (рубец, трещина, скол), легло бы героям на грудь. `occ(x, y, depth)` —
 * пиксель мира (x, y) предмета на глубине `depth` (y его опоры, пиксели)
 * заслонён телом, чьи ноги ближе к камере. Тело — прямоугольник: Повелитель
 * 1,7 × 3,6 клетки, герой 0,8 × 1,25, прочие — по радиусу.
 */
interface Occ {
  (x: number, y: number, depth: number): boolean;
  /** Никого вокруг прямоугольника — проверки по пикселям не нужны. */
  clear(x0: number, y0: number, x1: number, y1: number, depth: number): boolean;
}
function occOf(S: number): Occ {
  const sim = paintSim();
  const b: number[] = [];
  if (sim) {
    for (const m of sim.mobs) {
      if (m.mode === 'dying' && m.t > 0.5) continue;
      const big = m.r >= 0.8;
      b.push(
        m.x * S,
        m.y * S + 2,
        big ? 0.85 * S : Math.max(5, m.r * S),
        big ? 3.6 * S : m.r * S * 3.4,
      );
    }
    const h = sim.hero;
    b.push(h.x * S, h.y * S + 2, 0.42 * S, 1.25 * S);
  }
  const f = ((x: number, y: number, depth: number) => {
    for (let i = 0; i < b.length; i += 4) {
      const fy = b[i + 1];
      if (depth >= fy - 1) continue;
      if (y > fy || y < fy - b[i + 3]) continue;
      if (Math.abs(x + 0.5 - b[i]) < b[i + 2]) return true;
    }
    return false;
  }) as Occ;
  f.clear = (x0, y0, x1, y1, depth) => {
    for (let i = 0; i < b.length; i += 4) {
      const fy = b[i + 1];
      if (depth >= fy - 1) continue;
      if (y1 < fy - b[i + 3] || y0 > fy) continue;
      if (x1 < b[i] - b[i + 2] || x0 > b[i] + b[i + 2]) continue;
      return false;
    }
    return true;
  };
  return f;
}
/** Никого не заслоняет: для слоя пола. */
const NO_OCC: Occ = Object.assign(() => false, { clear: () => true });

/**
 * Обрезка «за телами» для слоя поверх темноты (анимации 14): из рисования
 * вырезаются тела, чьи ноги ближе к камере, чем `depth` (y мира, px). Для
 * того, что лежит на полу, годится любая глубина: пиксель пола внутри
 * прямоугольника тела всегда за его ногами. Одна обрезка на проход —
 * дешевле `occOf` по пикселям. Повелитель — роба и циферблат со шпилями.
 * Каждое тело — своя обрезка (они пересекаются: при `evenodd` одним путём
 * двойное перекрытие снова открывалось). Тела дальше экрана от героя — мимо.
 * Вызывать между `save`/`restore`.
 */
function clipBodies(g: CanvasRenderingContext2D, p: Pen, S: number, depth = -1e9): void {
  const sim = paintSim();
  if (!sim) return;
  const h = sim.hero;
  const box = (x: number, fy: number, hw: number, y0: number, y1: number) => {
    if (fy <= depth + 1) return;
    g.beginPath();
    g.rect(-8192, -8192, 16384, 16384);
    g.rect(Math.floor(x - hw) + p.qx, Math.floor(y0) + p.qy, Math.ceil(hw * 2), Math.ceil(y1 - y0));
    g.clip('evenodd');
  };
  for (const m of sim.mobs) {
    if (m.mode === 'dying' && m.t > 0.5) continue;
    if (Math.abs(m.x - h.x) > 12 || Math.abs(m.y - h.y) > 16) continue;
    const x = m.x * S;
    const fy = m.y * S + 2;
    if (m.kind === 'f14boss') {
      box(x, fy, 14, fy - 39, fy + 1);
      box(x, fy, 15, fy - 62, fy - 39);
    } else if (m.r >= 0.8) box(x, fy, 0.85 * S, fy - 3.6 * S, fy + 1);
    else box(x, fy, Math.max(5, m.r * S), fy - m.r * S * 3.4, fy + 1);
  }
  box(h.x * S, h.y * S + 2, 0.42 * S, h.y * S + 2 - 1.25 * S, h.y * S + 3);
}

/** Точка тела Повелителя в мире, px: из кадра «Тела» (`lordPointPx`), иначе — запасная. */
const LORD_PT_FALLBACK: Record<LordPoint, [number, number]> = {
  face: [0, -41],
  minTip: [20, 4],
  hourTip: [-15, -2],
  glass: [0, -24],
};
function lordPt(m: Mob, which: LordPoint, S: number): [number, number] {
  const pt = lordPointPx(m, which);
  if (pt) return [m.x * S + pt[0], m.y * S + pt[1]];
  const [fx, fy] = LORD_PT_FALLBACK[which];
  return [m.x * S + (Math.cos(m.face) < 0 ? -fx : fx), m.y * S + fy];
}

/** Повелитель в мире, которого рисуют сейчас. */
const lordNow = (): Mob | null =>
  paintSim()?.mobs.find((q) => q.kind === 'f14boss' && q.mode !== 'dying') ?? null;

/** Зерно от места и угла: оба слоя одного удара рисуют одни и те же рубцы и сколы. */
const seedAt = (x: number, y: number, a = 0) =>
  (hash(
    Math.floor(x * 16 + 0.5) + 4096,
    Math.floor(y * 16 + 0.5) + 4096,
    Math.round(a * 64) + 999,
  ) *
    99991) >>>
  0;

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

/** Сектор с любыми концами (a0 может быть больше a1 — порядок не важен). */
function sector(
  p: Pen,
  cx: number,
  cy: number,
  r0: number,
  r1: number,
  a: number,
  b: number,
): void {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (hi - lo < 1e-4) return;
  fillSector(p, cx, cy, r0, r1, lo, hi);
}

/** Многоугольник строками пикселей (точки — пары x, y мира). */
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

/**
 * Лист стрелки по углу `a` от r0 до r1: шейка, расширение к 0,62 и остриё —
 * силуэт часовой (широкий) или минутной (узкий) стрелки.
 */
function handPts(
  cx: number,
  cy: number,
  a: number,
  r0: number,
  r1: number,
  w: number,
  slim = false,
): number[] {
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const nx = -uy;
  const ny = ux;
  const prof: [number, number][] = slim
    ? [
        [0, 0.5],
        [0.7, 0.5],
        [0.78, 1],
        [1, 0],
      ]
    : [
        [0, 0.38],
        [0.36, 0.5],
        [0.62, 1],
        [0.84, 0.62],
        [1, 0],
      ];
  const pts: number[] = [];
  for (const [u, k] of prof) {
    const r = r0 + (r1 - r0) * u;
    pts.push(cx + ux * r + nx * w * k, cy + uy * r + ny * w * k);
  }
  for (let i = prof.length - 2; i >= 0; i--) {
    const [u, k] = prof[i];
    const r = r0 + (r1 - r0) * u;
    pts.push(cx + ux * r - nx * w * k, cy + uy * r - ny * w * k);
  }
  return pts;
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
  if (circles.size > 400) circles.delete(circles.keys().next().value as number);
  circles.set(R, c);
  return c;
}

/**
 * Кольцо по пикселям цветом `c`. `keep(a, i)` — оставить ли пиксель
 * (пунктир, дуга, «рваная» волна). `sh` — тень на пиксель вниз-вправо.
 * `occ` + `depth` — не рисовать за телами (слой поверх темноты).
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
  occ: Occ = NO_OCC,
  depth = 0,
): void {
  if (r < 0.5 || a <= 0) return;
  const pts = circle(r);
  const ox = Math.floor(cx);
  const oy = Math.floor(cy);
  const n = pts.x.length;
  const free = occ === NO_OCC || occ.clear(ox - r - 1, oy - r - 1, ox + r + 2, oy + r + 2, depth);
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
      if (!free && occ(x, y, depth)) continue;
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
/** Строка ещё не начата. Не −1: x пробегает и отрицательные значения (от −R). */
const NO_RUN = -1e9;

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

/** Звезда удара: n лучей радиуса r (у основания — 0,35 r), залита по пикселям. */
function star(p: Pen, cx: number, cy: number, r: number, n: number, rot: number): void {
  if (r < 0.6) return;
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
          on = d <= r * (0.35 + 0.65 * spike);
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

/** Блик-крестик: четыре луча длиной L, середина — точка. */
function glint(p: Pen, x: number, y: number, L: number, c: string, a: number): void {
  if (L < 0.5 || a <= 0) return;
  const X = Math.floor(x);
  const Y = Math.floor(y);
  const l = Math.round(L);
  p.col(c, a * 0.75);
  p.rect(X - l, Y, l * 2 + 1, 1);
  p.rect(X, Y - l, 1, l * 2 + 1);
  p.col('#ffffff', a);
  p.rect(X, Y, 1, 1);
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

/** Пыль: тень снизу, основа, свет сверху-слева. Светлее пола своей фазы. */
const PUFF_PAL: [RGBA, RGBA, RGBA][] = [
  [hx('#6a5a40'), hx('#a8946c'), hx('#e6d6b0')], // 0 — эмаль слоновой кости
  [hx('#4a5468'), hx('#94a2bc'), hx('#e0e8f6')], // 1 — изморозь остановки
  [hx('#6a4a24'), hx('#b0905a'), hx('#ecd6a4')], // 2 — песок отмотки
  [hx('#34406a'), hx('#6a7ab8'), hx('#b8c8f0')], // 3 — ночная пыль в лунном свете (тёмная на тёмном читалась грязью)
  [hx('#0c0c12'), hx('#22222e'), hx('#3e3e52')], // 4 — копоть погасшей лампы
  [hx('#0e3a44'), hx('#3a9aa8'), hx('#b8f4ff')], // 5 — песок времени (бирюза)
];
/** Пыль от фазы: на полу этой фазы читается светлее пола. */
const dustPal = () => [0, 1, 2, 3][phaseNow()];

/**
 * Клуб пыли радиуса r (1…16), вариант v (0…3): три доли, чтобы край был
 * рваным, а не циркульным.
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

/** Обломки: эмаль по фазе (0–3), латунь (4), стекло (5). */
const CHIP_PAL: RGBA[][] = [
  [hx('#3a3022'), hx('#8a7552'), hx('#cfba90'), hx('#fffaf0')],
  [hx('#26324a'), hx('#627088'), hx('#b4c2d8'), hx('#ffffff')],
  [hx('#0c2a2e'), hx('#2e6066'), hx('#74b0b4'), hx('#d0f4f8')],
  [hx('#04060e'), hx('#1e2648'), hx('#5a6aa0'), hx('#c8d4ff')],
  [hx('#3a2410'), hx('#7a5220'), hx('#d8a23a'), hx('#fff0b0')],
  [hx('#1e5864'), hx('#7ac8d4', 220), hx('#c8f4fc', 230), hx('#ffffff')],
];

/** Светлая крошка пола по фазе — читается на эмали своей фазы. */
const CHIP_HI = ['#fffaf0', '#ffffff', '#d0f4f8', '#c8d4ff'];

/**
 * Скол размера 1…4, поворот f (0…3): острый осколок эмали (клин, а не
 * галька — круглая крошка с контуром читалась бусинами), тень снизу.
 * Контур — только у крупных: мелочь контур превращает в бисер.
 */
function chipImg(sz: number, f: number, pal: number): HTMLCanvasElement {
  return sprite(20000 + pal * 100 + sz * 10 + (f & 3), () => {
    const s = sz * 2 + 3;
    const p = new Px(s, s);
    const c = s / 2;
    const glass = pal === 5;
    const t = CHIP_PAL[pal];
    if (sz <= 1) {
      // Пиксель-пара: свет и тень.
      const a = f & 3;
      p.set(2, 2, t[3]);
      p.set(a & 1 ? 3 : 2, a & 2 ? 3 : 2, t[2]);
      return p;
    }
    const rx = glass ? 0.5 + 0.95 * sz : 0.6 + 0.7 * sz;
    const ry = glass ? 0.3 + 0.3 * sz : 0.32 + 0.3 * sz;
    const a = (f & 3) * (Math.PI / 4) + 0.3;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        const dx = x + 0.5 - c;
        const dy = y + 0.5 - c;
        const u = (dx * ca + dy * sa) / rx;
        const w = (-dx * sa + dy * ca) / ry;
        // Клин: широкий у одного конца, острый у другого.
        if (Math.abs(u) > 1 || Math.abs(w) > (1 - u) * 0.6 + 0.1) continue;
        const l = -dx * 0.6 - dy * 0.8 + (w < 0 ? 0.5 : -0.4);
        p.set(x, y, l > 0.7 ? t[3] : l > -0.1 ? t[2] : l > -0.9 ? t[1] : t[0]);
      }
    if (sz >= 3 || glass) p.outline(glass ? hx('#0a2a30') : hx(C.ink));
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
 * начальной скорости.
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

/** Откуда и куда вылетает i-я частица: [x, y, угол?]. */
type At = (i: number) => [number, number, number?];

/**
 * Сколы веером: `n` штук из (x, y) в сторону `ang` ± `spread`, скорость
 * `v0…v0+dv`, подброс `vz0…vz0+dvz`. Тень под летящим, лёгший гаснет к
 * `fade`. `big` — доля крупных. `delay(i)` — когда вылетает i-й.
 */
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
  big = 0.3,
  pal = 0,
  delay?: (i: number) => number,
  at?: At,
  occ: Occ = NO_OCC,
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
    if (occ !== NO_OCC && occ(gx, gy, gy)) continue;
    const sz = r4 < big * 0.4 ? 4 : r4 < big ? 3 : r4 < 0.7 ? 2 : 1;
    if (f.air) {
      p.col(C.ink, 0.3 * a);
      p.dot(gx - sz / 2, gy + 1, sz, 1);
    }
    const spin = f.air ? Math.floor(t * (14 + r2 * 10) + i) & 3 : i & 3;
    const im = chipImg(sz, spin, pal);
    p.alpha(a);
    p.img(im, gx - im.width / 2, gy - f.z - im.height / 2);
  }
}

/**
 * Пыль клубами: `n` клубов из (x, y), направление `ang` ± `spread`, скорость
 * с сопротивлением, растут `r0 → r1`, поднимаются на `rise` и тают за `life`:
 * раздувается, садится и тает — пыль оседает, а не висит камнем.
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
  at?: At,
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

/** Искры: головка и хвост по скорости, падают с тяжестью, цвет — по доле жизни. */
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
  col: (k: number) => string = brassSpark,
  delay?: (i: number) => number,
  at?: At,
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
 * Пылинки, что ВИСЯТ и плывут (песок времени, звёзды): `n` штук вокруг
 * точки, каждая по своей орбите; `k` — общая фаза (0…1 — сколько прошло).
 */
function motes(
  p: Pen,
  seed: number,
  n: number,
  pos: (i: number, h1: number, h2: number, h3: number) => [number, number, number] | null,
  col: (i: number) => string,
): void {
  for (let i = 0; i < n; i++) {
    const q = pos(i, hash(seed, i, 51), hash(seed, i, 52), hash(seed, i, 53));
    if (!q || q[2] <= 0) continue;
    p.col(col(i), q[2]);
    p.dot(q[0], q[1]);
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
  if (cracks.size > 60) cracks.delete(cracks.keys().next().value as string);
  cracks.set(key, c);
  return c;
}

/**
 * Трещина до пути `reach` (пиксели): жёлоб `core`, кромка `lip`. Трещина
 * лежит на полу: глубина пикселя — его собственный y.
 */
function drawCrack(
  p: Pen,
  c: Crack,
  x: number,
  y: number,
  reach: number,
  core: string,
  lip: string | null,
  a: number,
  occ: Occ = NO_OCC,
): void {
  if (a <= 0) return;
  const ox = Math.floor(x);
  const oy = Math.floor(y);
  if (lip) {
    p.col(lip, a * 0.75);
    for (let i = 0; i < c.lx.length && c.ld[i] <= reach; i++) {
      const Y = oy + c.ly[i];
      if (!occ(ox + c.lx[i], Y, Y)) p.dot(ox + c.lx[i], Y);
    }
  }
  p.col(core, a);
  for (let i = 0; i < c.x.length && c.d[i] <= reach; i++) {
    const Y = oy + c.y[i];
    if (!occ(ox + c.x[i], Y, Y)) p.dot(ox + c.x[i], Y);
  }
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

/** Лишние поля визуальных зон мозга (`api.vfx`) и зон удара. */
type FxZone = Zone & {
  /** Чья зона (Повелитель). */
  mob?: number;
  ang?: number;
  arc?: number;
  w?: number;
  len?: number;
  /** Номер: удар часов, фаза, тик или так, вход или выход. */
  n?: number;
  /** Ножи остановки. */
  ids?: number[];
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

/** Метка удара: налив 0…1, сколько осталось до урона и вся длина, с. */
const warnOf = (z: Zone | Strike) => {
  const st = z as Strike;
  const w = Math.max(0.01, st.warn ?? 0.01);
  return { k: k01(st.t / w), left: w - st.t, T: w };
};

/** Первый кадр, когда рендер увидел зону, — часы для того, что живёт в остановке. */
const seen = new Map<number, number>();
function seenAt(id: number, time: number): number {
  let t = seen.get(id);
  if (t === undefined || t > time) {
    t = time;
    seen.set(id, t);
    if (seen.size > 96) seen.delete(seen.keys().next().value as number);
  }
  return t;
}

const mobById = (id: number | undefined): Mob | null => {
  if (id === undefined) return null;
  const sim = paintSim();
  return sim?.mobs.find((m) => m.id === id) ?? null;
};

/** Сколько настоящих секунд идёт остановка мира (вне — −1). */
function stopElapsed(sim: Sim | null): number {
  if (!sim || !worldStopped(sim)) return -1;
  const T = f14Time(sim);
  return T ? T.dur - sim.scaleT : -1;
}

/**
 * Стрелка-щелчок: доля пути `e` (0…1) по `n` равным шагам. Стрелка встаёт на
 * риску рывком и на кадр перелетает её — металл щёлкает; налив за ней течёт
 * плавно (его считает вызывающий по `e`). Возврат — доля пути стрелки.
 */
function clickStep(
  e: number,
  n: number,
  kOfE: (e: number) => number,
  k: number,
  T: number,
): number {
  const j = Math.min(n, Math.floor(e * n + 1e-6));
  if (j <= 0) return 0;
  // Когда случился этот щелчок: перелёт 0,035 с после него.
  const tj = kOfE(j / n) * T;
  const since = k * T - tj;
  const over = since >= 0 && since < 0.035 && j < n ? 0.22 / n : 0;
  return j / n + over;
}

/**
 * Риски циферблата на дуге [a0, a0 + span] радиуса r: 60 на круг, каждая
 * пятая длинная, абсолютные углы — те же риски, что на эмали арены.
 * `lit(a)` — пройдена ли (горит латунью).
 */
function dialTicks(
  p: Pen,
  cx: number,
  cy: number,
  r: number,
  a0: number,
  span: number,
  off: string,
  on: string,
  lit: (a: number) => boolean,
  alpha: number,
  long = 5,
  short = 2,
  occ: Occ = NO_OCC,
  depth = 0,
): void {
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * TAU - Math.PI / 2;
    if (span < TAU - 1e-6 && !inArc(a, a0, span)) continue;
    const L = i % 5 === 0 ? long : short;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const x0 = cx + ux * (r - L);
    const y0 = cy + uy * (r - L);
    const x1 = cx + ux * r;
    const y1 = cy + uy * r;
    if (occ !== NO_OCC && occ(x1, y1, depth)) continue;
    const isOn = lit(a);
    p.lineS(x0, y0, x1, y1, isOn ? on : off, alpha, isOn ? 0.55 : 0, C.ink);
  }
}

/** Кромка сектора: дуга и два края с тёмной тенью; `far` — край, куда придёт стрелка. */
function sectorRim(
  p: Pen,
  cx: number,
  cy: number,
  r0: number,
  R: number,
  a0: number,
  arc: number,
  c: string,
  sh: string,
  a: number,
  far: number | null,
  farC: string,
): void {
  const ok = (ang: number) => inArc(ang, a0, arc);
  ring(p, cx, cy, R + 1, sh, a * 0.7, ok);
  ring(p, cx, cy, R, c, a, ok);
  for (const ea of [a0, a0 + arc]) {
    const ux = Math.cos(ea);
    const uy = Math.sin(ea);
    const isFar = far !== null && Math.abs(mod(ea - far + Math.PI, TAU) - Math.PI) < 1e-3;
    p.lineS(cx + ux * r0, cy + uy * r0, cx + ux * R, cy + uy * R, isFar ? farC : c, a, 0.7, sh);
    if (isFar) {
      // Край, где ударит, — двойной: сюда смотрят.
      const nx = -uy;
      const ny = ux;
      const s = mod(ea - a0, TAU) < 1e-3 ? 1 : -1;
      p.lineS(
        cx + ux * r0 + nx * s,
        cy + uy * r0 + ny * s,
        cx + ux * R + nx * s,
        cy + uy * R + ny * s,
        farC,
        a * 0.8,
        0,
      );
    }
  }
}

/**
 * Смаз клинка по дуге (кадры удара): путь s от `as` в сторону `dir`, от
 * хвоста `tail` до головы `front`. Голова — белая кромка и широкое тело
 * цвета металла, к хвосту тоньше и темнее. `rim` — тёмная кромка снаружи:
 * на светлой эмали без неё светлый лист пропадал. Шаг 0,05 рад — ступенек
 * сектора не видно.
 */
function smearArc(
  p: Pen,
  cx: number,
  cy: number,
  as: number,
  dir: number,
  tail: number,
  front: number,
  rout: (s: number) => number,
  rin: (s: number, q: number) => number,
  a: number,
  pal: string[],
  rim: number,
): void {
  const len = front - tail;
  if (len <= 0.01 || a <= 0) return;
  const n = Math.max(2, Math.min(64, Math.ceil(len / 0.05)));
  const at = (s: number) => as + dir * s;
  if (rim > 0) {
    const ro = rout(front);
    p.col(C.ink, rim * a);
    sector(p, cx, cy, ro, ro + 1.3, at(tail + len * 0.4), at(front));
  }
  for (let j = 0; j < n; j++) {
    const s1 = front - (len * j) / n;
    const s0 = front - (len * (j + 1)) / n;
    const q = (j + 0.5) / n;
    const ro = rout(s1);
    const ri = Math.min(ro - 1, rin(s1, q));
    const lo = Math.min(at(s0), at(s1));
    const hi = Math.max(at(s0), at(s1)) + 0.003;
    const body = q < 0.3 ? pal[1] : q < 0.65 ? pal[2] : pal[3];
    p.col(body, a * (q < 0.65 ? 0.95 : 0.85 * (1 - ((q - 0.65) / 0.35) * 0.75)));
    fillSector(p, cx, cy, ri, ro, lo, hi);
    if (q < 0.55) {
      p.col(pal[0], a * (1 - q * 0.8));
      fillSector(p, cx, cy, Math.max(ri, ro - (q < 0.2 ? 3 : 1.5)), ro, lo, hi);
    }
  }
}

/**
 * «Сейчас»: последние 0,2 с к кромке метки сходится белое кольцо пунктиром
 * (снаружи внутрь, с замедлением) — замыкается в кадр урона.
 */
function closeIn(
  p: Pen,
  cx: number,
  cy: number,
  R: number,
  a0: number,
  span: number,
  left: number,
): void {
  if (left >= SIG || left < 0) return;
  const s = k01(1 - left / SIG);
  const rr = R + 2 + 14 * (1 - eOut3(s));
  const full = span >= TAU - 1e-3;
  ring(
    p,
    cx,
    cy,
    rr,
    '#ffffff',
    0.35 + 0.6 * s,
    (a, i) => (full || inArc(a, a0, span)) && (i >> 1) % 3 !== 2,
    0.5,
  );
}

// =============================================================================
// ЧАСОВАЯ — конус r 2,7, дуга 1,9 по взгляду. Метка встаёт в 0,22 с режима,
// удар — в 0,8/0,71/0,64 с (метка горит 0,58/0,49/0,42 с). Метка: весь
// сектор багрецом с первого кадра, по кромке — минутная дорожка; тень
// часовой стрелки идёт по сектору рывками от риски к риске с разгоном (куда
// и как рубит тело: смотрит вправо — по часовой, влево — против), за ней
// течёт налив, пройденные риски горят латунью; дальний край двойной — там
// ударит. Контакт: клинок проходит сектор размытым листом с проводкой за
// край, по кромке звенит (дуги звона расходятся), в эмали — раскалённый
// рубец, искры латуни по ходу, сколы эмали и пыль к краю.
// =============================================================================

/** Куда идёт удар часовой: смотрит вправо (cos ≥ 0) — по часовой стрелке. */
const hourDir = (a: number) => (Math.cos(a) < 0 ? -1 : 1);
const HOUR_E = 1.6;
const hourE = (k: number) => Math.pow(k, HOUR_E);
const hourK = (e: number) => Math.pow(e, 1 / HOUR_E);

registerZonePainter(
  'f14_lordhour',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number) => {
    const st = z as Strike;
    const { k, left, T } = warnOf(st);
    const P = markPal();
    const sig = left < SIG;
    const tk = !reduced() && tick(left);
    const cx = st.x * S;
    const cy = st.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = st.r * S;
    const arc = st.arc ?? 1.9;
    const a = st.ang ?? 0;
    const a0 = a - arc / 2;
    const dir = hourDir(a);
    const as = dir > 0 ? a0 : a0 + arc;
    const af = dir > 0 ? a0 + arc : a0;
    const r0 = S * 0.45;
    // Проявление: метка не «выключателем», а за 0,06 с.
    const born = k01(st.t / 0.06);
    // «Куда»: весь сектор.
    p.col(P.fill, (P.fillA * 0.75 + 0.05 * k) * born);
    fillSector(p, cx, cy, r0, R, a0, a0 + arc);
    // «Когда»: налив течёт за стрелкой — хвостом кометы: у стрелки ярче.
    // Сигнал «сейчас» несут кромка и риски, а не заливка: залитый красным
    // сектор читался плашкой.
    const e = hourE(k);
    const th = as + dir * arc * e;
    p.col(P.sweep, (0.16 + 0.08 * k) * born);
    sector(p, cx, cy, r0, R, as, th);
    const back = Math.min(arc * e, 0.4);
    p.col(sig ? P.sweepHot : P.sweep, (0.2 + 0.08 * k + (tk ? 0.14 : 0)) * born);
    sector(p, cx, cy, r0, R, th - dir * back, th);
    // Пол в секторе дрожит: крошка эмали подскакивает к удару.
    if (k > 0.3 && !reduced()) {
      const sd = st.id >>> 0;
      for (let i = 0; i < 12; i++) {
        const rr = r0 + (R - r0) * (0.2 + 0.75 * hash(sd, i, 5));
        const aa = a0 + arc * hash(sd, i, 6);
        const hop = Math.floor(hash(i, Math.floor(F14_FX.clock * 18), sd) * (1 + 3 * k));
        const gx = cx + Math.cos(aa) * rr;
        const gy = cy + Math.sin(aa) * rr;
        if (hop) {
          p.col(C.ink, 0.4 * born);
          p.dot(gx, gy + 1);
        }
        p.col(CHIP_HI[phaseNow()], 0.85 * born);
        p.dot(gx, gy - hop);
      }
    }
    // Стрелка щёлкает по рискам (7 шагов на дугу 1,9).
    const n = Math.max(3, Math.round(arc / (TAU / 24)));
    const eh = clickStep(e, n, hourK, k, T);
    const ha = as + dir * arc * Math.min(1.04, eh);
    // Риски минутной дорожки по кромке: пройденные горят.
    dialTicks(
      p,
      cx,
      cy,
      R - 1,
      a0,
      arc,
      P.tick,
      sig ? '#ffffff' : P.tickOn,
      (ta) => (dir > 0 ? mod(ta - as, TAU) : mod(as - ta, TAU)) <= arc * eh + 1e-3,
      0.9 * born,
    );
    // Тень часовой стрелки: лист с прорезью, на полу — тёмным.
    p.col(P.shade, P.shadeA * born);
    fillPoly(p, handPts(cx, cy, ha, r0, R * 0.94, 4.2));
    const hx0 = cx + Math.cos(ha) * R * 0.62;
    const hy0 = cy + Math.sin(ha) * R * 0.62;
    p.col(P.fill, 0.8 * born);
    p.dot(hx0, hy0);
    // Кромка; последние 0,2 с — белая, «тик-тик».
    sectorRim(
      p,
      cx,
      cy,
      r0,
      R,
      a0,
      arc,
      sig ? (tk ? '#ffffff' : C.brass[4]) : P.edge,
      P.edgeSh,
      (0.75 + 0.25 * k) * born,
      af,
      sig ? '#ffffff' : C.brass[4],
    );
    // Последние 0,2 с к кромке сходится белая дуга — «сейчас».
    closeIn(p, cx, cy, R, a0, arc, left);
  }),
);

/** Рубец в эмали: дуга с дрожью, пиксели по ходу клинка (`u` — доля пути). */
interface Gash {
  x: Int16Array;
  y: Int16Array;
  u: Float32Array;
}
const gashes = new Map<string, Gash>();
function gashOf(seed: number, rg: number, as: number, dir: number, span: number): Gash {
  const key = `${seed}|${Math.round(rg)}|${Math.round(as * 100)}|${dir}|${Math.round(span * 100)}`;
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
    const wob = 1.2 * Math.sin(s * 3 + ph1) + 0.6 * Math.sin(s * 9 + ph2);
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
    if (u > 0.18 && u < 0.82) {
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

/** Жёлоб рубца: тёмный с белой кромкой снизу-справа — высечен в эмали (слой пола). */
function drawGroove(p: Pen, gs: Gash, cx: number, cy: number, reveal: number, fade: number): void {
  if (fade <= 0 || reveal <= 0) return;
  const ox = Math.floor(cx);
  const oy = Math.floor(cy);
  p.col(C.white, 0.4 * fade);
  for (let i = 0; i < gs.x.length; i++)
    if (gs.u[i] <= reveal) p.dot(ox + gs.x[i] + 1, oy + gs.y[i] + 1);
  p.col('#1a0e06', 0.8 * fade);
  for (let i = 0; i < gs.x.length; i++) if (gs.u[i] <= reveal) p.dot(ox + gs.x[i], oy + gs.y[i]);
}

/**
 * Жар рубца (поверх темноты): где клинок прошёл недавно — бело-жёлтый,
 * остывает к латуни и гаснет. `passT(u)` — когда клинок прошёл долю пути u.
 */
function drawHeat(
  p: Pen,
  gs: Gash,
  cx: number,
  cy: number,
  reveal: number,
  passT: (u: number) => number,
  age: number,
  cool: number,
  col: (k: number) => string = hotSpark,
): void {
  if (reveal <= 0) return;
  const ox = Math.floor(cx);
  const oy = Math.floor(cy);
  const bands = 5;
  // Полоса каждой точки — один раз (не пять раз на каждую полосу).
  const n = gs.x.length;
  if (heatBand.length < n) heatBand = new Int8Array(n * 2);
  const used = [0, 0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    const u = gs.u[i];
    let b = -1;
    if (u <= reveal) {
      const h = k01((age - passT(u)) / cool);
      if (h < 1) b = Math.min(bands - 1, Math.floor(h * bands));
    }
    heatBand[i] = b;
    if (b >= 0) used[b]++;
  }
  for (let b = 0; b < bands; b++) {
    if (!used[b]) continue;
    const hk = (b + 0.5) / bands;
    p.col(col(hk * 0.85), 1 - hk * 0.6);
    for (let i = 0; i < n; i++) if (heatBand[i] === b) p.dot(ox + gs.x[i], oy + gs.y[i]);
  }
}
let heatBand = new Int8Array(256);

const HOUR_SWEEP = 0.12;
const HOUR_OVER = 0.42;

/**
 * Геометрия контакта часовой — одна на оба слоя: смаз (голова и хвост по
 * возрасту), рубец от зерна места, когда клинок прошёл каждую его точку.
 */
function hourGeo(x: number, y: number, r: number, a: number, arc: number, S: number) {
  const cx = x * S;
  const cy = y * S;
  const R = r * S;
  const dir = hourDir(a);
  const as = dir > 0 ? a - arc / 2 : a + arc / 2;
  const span = arc + HOUR_OVER;
  const sd = seedAt(x, y, a);
  const at = (s: number) => as + dir * s;
  const g0 = 0.1;
  const gspan = arc - 0.2;
  const gs = gashOf(sd, R * 0.74, at(g0), dir, gspan);
  // К кадру контакта клинок уже прошёл большую часть сектора — кадр контакта
  // показывает весь след; дальше — проводка за край и тает хвост.
  const front = (age: number) => span * (0.72 + 0.28 * eOut2(k01(age / HOUR_SWEEP)));
  const passT = (u: number) => {
    const s = g0 + u * gspan;
    return s <= span * 0.72 ? 0 : HOUR_SWEEP * (1 - Math.sqrt(1 - k01((s / span - 0.72) / 0.28)));
  };
  const pick = (i: number) => Math.min(gs.x.length - 1, Math.floor(hash(sd, i, 81) * gs.x.length));
  return { cx, cy, R, a, arc, dir, as, span, sd, at, g0, gspan, gs, front, passT, pick };
}

// Контакт часовой, слой ПОЛА (под телами, под темнотой): лист смаза идёт по
// сектору с проводкой за край, за ним в эмали раскрывается рубец (жёлоб),
// сколы летят из рубца и ложатся, пыль к краю. Свет — в `f14b_hourfx`.
registerImpactPainter('f14_lordhour', {
  life: 1.5,
  shake: 0.35,
  flash: 0.18,
  flashRgb: '255,224,160',
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const H = hourGeo(rec.x, rec.y, rec.r ?? LORD.hourR, rec.ang ?? 0, rec.arc ?? LORD.hourArc, S);
    const { cx, cy, R, arc, dir, as, span, sd, at, g0, gspan, gs } = H;
    const p = new Pen(g, px, py, cx, cy);
    const few = reduced();
    const ph = phaseNow();
    const front = H.front(age);
    const tail = span * eOut2(k01((age + 0.02) / 0.26));
    const fadeA = 1 - k01((age - 0.12) / 0.14);
    smearArc(
      p,
      cx,
      cy,
      as,
      dir,
      tail,
      front,
      (s) => R + 2 - k01((s - arc) / HOUR_OVER) * 8,
      (s, q) => R * (0.36 + 0.36 * q + 0.3 * k01((s - arc) / HOUR_OVER)),
      fadeA,
      SMEAR[ph],
      age < 0.12 ? 0.6 : 0,
    );
    // Рубец в эмали: раскрывается за клинком; лежит, пока жив контакт.
    drawGroove(p, gs, cx, cy, k01((front - g0) / gspan), 1 - k01((age - 1.05) / 0.4));
    // Сколы эмали из рубца — вверх и наружу, отскакивают и ложатся.
    chips(
      p,
      sd + 3,
      age,
      cx,
      cy,
      few ? 4 : 12,
      0,
      0.6,
      18,
      34,
      50,
      60,
      [0.9, 1.4],
      0.12,
      ph,
      (i) => H.passT(gs.u[H.pick(i + 30)]),
      (i) => {
        const j = H.pick(i + 30);
        return [cx + gs.x[j], cy + gs.y[j], Math.atan2(gs.y[j], gs.x[j])];
      },
    );
    // Пыль к краю сектора: ветер клинка.
    const nD = few ? 3 : 6;
    dust(
      p,
      sd + 5,
      age,
      cx,
      cy,
      nD,
      0,
      0.35,
      18,
      16,
      1.5,
      5,
      5,
      0.8,
      dustPal(),
      0.6,
      (i) => 0.02 + (i / nD) * 0.08,
      (i) => {
        const th = at(((i + 0.5) / nD) * arc);
        return [cx + Math.cos(th) * R * 0.92, cy + Math.sin(th) * R * 0.92, th];
      },
    );
  }),
});

/** Где ударил клинок (точка тела в кадр контакта): номер зоны → мир, px. */
const contactAt = new Map<number, [number, number][]>();
function contactPts(id: number, m: Mob | null, which: LordPoint[], S: number): [number, number][] {
  let v = contactAt.get(id);
  if (!v && m) {
    v = which.map((w) => lordPt(m, w, S));
    contactAt.set(id, v);
    if (contactAt.size > 24) contactAt.delete(contactAt.keys().next().value as number);
  }
  return v ?? [];
}

/**
 * Контакт часовой, слой ПОВЕРХ ТЕМНОТЫ (`f14b_hourfx`, мозг ставит в строке
 * урона): у острия часовой — звезда и искры по ходу клинка (точка — из кадра
 * «Тела»), кромка сектора вспыхивает, жар в рубце остывает, искры латуни из
 * рубца, звон дугами. Всё, что на полу, прячется за телами (`clipBodies`).
 */
registerZonePainter(
  'f14b_hourfx',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number) => {
    const zz = z as FxZone;
    const age = zz.t;
    if (age > 1.2) return;
    const H = hourGeo(zz.x, zz.y, zz.r, zz.ang ?? 0, zz.arc ?? LORD.hourArc, S);
    const { cx, cy, R, a, arc, dir, as, sd, at, g0, gspan, gs } = H;
    const p = new Pen(g, px, py, cx, cy);
    const few = reduced();
    const ph = phaseNow();
    const front = H.front(age);
    const af = as + dir * arc;
    // Точка контакта — острие часовой в кадр удара; нет кадра — дальний край.
    const [tip] = contactPts(zz.id, mobById(zz.mob), ['hourTip'], S);
    const tx = tip ? tip[0] : cx + Math.cos(af) * R * 0.86;
    const ty = tip ? tip[1] : cy + Math.sin(af) * R * 0.86;
    g.save();
    clipBodies(g, p, S);
    // Кадр контакта: кромка сектора вспыхивает целиком.
    if (age < 0.08)
      ring(p, cx, cy, R, '#ffffff', 1 - age / 0.08, (ang) => inArc(ang, a - arc / 2, arc), 0.5);
    // Жар в рубце: бело-жёлтый там, где клинок прошёл только что.
    drawHeat(p, gs, cx, cy, k01((front - g0) / gspan), H.passT, age, 0.9);
    // Звон — дуги от места, где клинок встал.
    const fx = cx + Math.cos(af) * R * 0.86;
    const fy = cy + Math.sin(af) * R * 0.86;
    if (!few)
      for (let w = 0; w < 2; w++) {
        const t = age - w * 0.08;
        if (t < 0 || t > 0.4) continue;
        const kk = t / 0.4;
        ring(
          p,
          fx,
          fy,
          4 + 16 * eOut2(kk),
          w === 0 ? '#ffffff' : GLOW_HI[ph],
          0.85 * (1 - kk),
          (ang, i) => Math.abs(mod(ang - af + Math.PI, TAU) - Math.PI) < 1.1 && (i >> 1) % 3 !== 2,
          0.45,
        );
      }
    // Искры латуни из рубца — за телом прячутся, перед ним летят поверх.
    sparks(
      p,
      sd,
      age,
      cx,
      cy,
      few ? 5 : 16,
      0,
      0.5,
      60,
      90,
      0.5,
      70,
      metalSpark(ph),
      (i) => H.passT(gs.u[H.pick(i)]),
      (i) => {
        const j = H.pick(i);
        return [cx + gs.x[j], cy + gs.y[j], at(g0 + gs.u[j] * gspan) + dir * Math.PI * 0.4];
      },
    );
    g.restore();
    // Острие: звезда контакта и сноп искр по ходу клинка — над всем.
    if (age < 0.14) {
      const kk = age / 0.14;
      p.col(SMEAR[ph][3], 0.9);
      star(p, tx + 1, ty + 1, 12 * (1 - kk * 0.55), 4, af + 0.4);
      p.col(kk < 0.4 ? '#ffffff' : SMEAR[ph][1], 1);
      star(p, tx, ty, 11 * (1 - kk * 0.55), 4, af + 0.4);
      if (kk < 0.5) {
        p.col('#ffffff', 1 - kk * 2);
        lens(p, tx, ty, 1, 0, 4, 4);
      }
    }
    sparks(
      p,
      sd + 9,
      age,
      tx,
      ty,
      few ? 4 : 10,
      af + (dir * Math.PI) / 2,
      0.7,
      70,
      80,
      0.42,
      55,
      metalSpark(ph),
    );
  }),
);

// =============================================================================
// РАЗВОРОТ — кольцо r 2,1, толщина 0,72 (1,38…2,82 клетки), удар — в
// 0,9/0,8/0,72 с. Метка: обод-циферблат — кольцо багрецом, через него —
// риски часов; две тени стрелок (от XII и от VI) бегут по кругу рывками и
// наливают кольцо за собой: полный круг — удар. Внутри, у самого
// Повелителя, — чисто: туда (или прочь за кромку) уходить. Контакт: два
// листа смаза облетают круг, по кольцу щёлкает храповик — двенадцать
// щелчков по часовым рискам, волна воздуха наружу, процарапанный круг.
// =============================================================================

const SPIN_E = 1.5;
const spinE = (k: number) => Math.pow(k, SPIN_E);
const spinK = (e: number) => Math.pow(e, 1 / SPIN_E);

registerZonePainter(
  'f14_lordspin',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number) => {
    const st = z as Strike;
    const { k, left, T } = warnOf(st);
    const P = markPal();
    const sig = left < SIG;
    const tk = !reduced() && tick(left);
    const cx = st.x * S;
    const cy = st.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const Rm = st.r * S;
    const w = (st.w ?? 0.72) * S;
    const ri = Rm - w;
    const ro = Rm + w;
    const born = k01(st.t / 0.06);
    // «Куда»: обод целиком.
    p.col(P.fill, (P.fillA * 0.75 + 0.05 * k) * born);
    fillSector(p, cx, cy, ri, ro, 0, TAU);
    // «Когда»: две стрелки от XII и VI, налив за ними хвостом кометы.
    const e = spinE(k);
    const n = 12;
    const eh = clickStep(e, n, spinK, k, T);
    const top = -Math.PI / 2;
    for (const s0 of [top, top + Math.PI]) {
      const th = s0 + Math.PI * e;
      p.col(P.sweep, (0.16 + 0.08 * k) * born);
      sector(p, cx, cy, ri, ro, s0, th);
      p.col(sig ? P.sweepHot : P.sweep, (0.2 + 0.08 * k + (tk ? 0.14 : 0)) * born);
      sector(p, cx, cy, ri, ro, th - Math.min(Math.PI * e, 0.5), th);
    }
    // Часовые риски через обод (длинные) и минутные по внешней кромке.
    const litTo = Math.PI * eh;
    const lit = (ta: number) => mod(ta - top, Math.PI) <= litTo + 1e-3 || eh >= 1;
    dialTicks(
      p,
      cx,
      cy,
      ro - 1,
      0,
      TAU,
      P.tick,
      sig ? '#ffffff' : P.tickOn,
      lit,
      0.9 * born,
      Math.round(w * 2 - 2),
      2,
    );
    // Тени стрелок поперёк обода.
    p.col(P.shade, P.shadeA * born);
    for (const s0 of [top, top + Math.PI]) {
      const ha = s0 + Math.PI * Math.min(1.03, eh);
      fillPoly(p, handPts(cx, cy, ha, ri - 2, ro + 1, 3.4));
    }
    // Кромки: внешняя и внутренняя (за ней — чисто).
    const edge = sig ? (tk ? '#ffffff' : C.brass[4]) : P.edge;
    const ea = (0.75 + 0.25 * k) * born;
    ring(p, cx, cy, ro + 1, P.edgeSh, ea * 0.7);
    ring(p, cx, cy, ro, edge, ea);
    ring(p, cx, cy, ri - 1, P.edgeSh, ea * 0.7);
    ring(p, cx, cy, ri, edge, ea, (_a, i) => sig || (i >> 1) % 2 === 0);
    // Последние 0,2 с к ободу сходится белое кольцо — «сейчас».
    closeIn(p, cx, cy, ro + 1, 0, TAU, left);
  }),
);

const SPIN_RUN = 0.16;

/** Где прошёл лист разворота к возрасту `age` (одна мера на оба слоя). */
const spinFront = (age: number) => (Math.PI + 0.5) * (0.7 + 0.3 * eOut2(k01(age / SPIN_RUN)));
/** Рваный процарапанный круг: какие пиксели обода прошёл клинок. */
const spinPassed = (sd: number, front: number) => (ang: number, i: number) =>
  mod(ang + Math.PI / 2, Math.PI) / Math.PI <= front / (Math.PI + 0.5) + 0.02 &&
  hash(i >> 3, sd, 4) > 0.3;

// Контакт разворота, слой ПОЛА: два листа смаза облетают круг, за ними —
// процарапанный рваный круг (жёлоб), сколы наружу и пыль. Свет — `f14b_spinfx`.
registerImpactPainter('f14_lordspin', {
  life: 1.25,
  shake: 0.25,
  flash: 0.12,
  flashRgb: '255,232,190',
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const cx = rec.x * S;
    const cy = rec.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const Rm = (rec.r ?? 2.1) * S;
    const w = (rec.w ?? 0.72) * S;
    const ri = Rm - w;
    const ro = Rm + w;
    const sd = seedAt(rec.x, rec.y);
    const few = reduced();
    const ph = phaseNow();
    const top = -Math.PI / 2;
    // Два листа смаза облетают каждый свою половину и перелетают на 0,5.
    const span = Math.PI + 0.5;
    const front = spinFront(age);
    const tail = span * eOut2(k01((age + 0.02) / 0.3));
    const fadeA = 1 - k01((age - 0.14) / 0.16);
    for (const s0 of [top, top + Math.PI])
      smearArc(
        p,
        cx,
        cy,
        s0,
        1,
        tail,
        front,
        (s) => ro + 1 - k01((s - Math.PI) / 0.5) * 5,
        (s, q) => ri + (ro - ri) * (0.1 + 0.5 * q + 0.3 * k01((s - Math.PI) / 0.5)),
        fadeA,
        SMEAR[ph],
        age < 0.12 ? 0.6 : 0,
      );
    // Процарапанный круг — рваными дугами, тёмный жёлоб; к 0,7 с гаснет
    // (сплошное кольцо надолго читалось гравировкой циферблата).
    const fade = 1 - k01((age - 0.35) / 0.35);
    if (fade > 0) {
      const passed = spinPassed(sd, front);
      ring(p, cx, cy, Rm + 1, C.white, 0.35 * fade, passed);
      ring(p, cx, cy, Rm, '#1a0e06', 0.7 * fade, passed);
    }
    chips(
      p,
      sd + 3,
      age,
      cx,
      cy,
      few ? 3 : 12,
      0,
      0.4,
      16,
      26,
      40,
      50,
      [0.75, 1.15],
      0.1,
      ph,
      (i) => (i % 6) * 0.02,
      (i) => {
        const ta = top + hash(sd, i, 72) * TAU;
        return [cx + Math.cos(ta) * Rm, cy + Math.sin(ta) * Rm, ta];
      },
    );
    dust(
      p,
      sd + 5,
      age,
      cx,
      cy,
      few ? 4 : 8,
      0,
      0.2,
      16,
      14,
      1.5,
      4.5,
      4,
      0.75,
      dustPal(),
      0.55,
      (i) => i * 0.012,
      (i) => {
        const ta = top + ((i + 0.5) / 8) * TAU;
        return [cx + Math.cos(ta) * ro, cy + Math.sin(ta) * ro, ta];
      },
    );
  }),
});

/**
 * Контакт разворота, слой ПОВЕРХ ТЕМНОТЫ (`f14b_spinfx`): храповик щёлкает по
 * двенадцати рискам, жар в процарапанном круге, волна воздуха наружу, искры
 * по касательной — всё на полу и прячется за телами; на остриях обеих
 * стрелок (точки из кадра «Тела» в кадр контакта) — вспышки и сноп искр.
 */
registerZonePainter(
  'f14b_spinfx',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number) => {
    const zz = z as FxZone;
    const age = zz.t;
    if (age > 1) return;
    const cx = zz.x * S;
    const cy = zz.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const Rm = zz.r * S;
    const w = (zz.w ?? 0.72) * S;
    const ri = Rm - w;
    const ro = Rm + w;
    const sd = seedAt(zz.x, zz.y);
    const few = reduced();
    const ph = phaseNow();
    const top = -Math.PI / 2;
    const front = spinFront(age);
    g.save();
    clipBodies(g, p, S);
    // Храповик: двенадцать щелчков по часовым рискам, по часовой стрелке —
    // за каждым листом по шесть.
    for (let i = 0; i < 12; i++) {
      const ta = top + (i / 12) * TAU;
      const t = age - ((i % 6) / 6) * SPIN_RUN * 0.7;
      if (t < 0 || t > 0.18) continue;
      const kk = t / 0.18;
      const ux = Math.cos(ta);
      const uy = Math.sin(ta);
      const r0 = ri - 2 + 4 * kk;
      const r1 = ro + 2 - 4 * kk;
      const hot = kk < 0.35 ? '#ffffff' : SMEAR[ph][1];
      p.lineS(cx + ux * r0, cy + uy * r0, cx + ux * r1, cy + uy * r1, hot, 1 - kk * 0.7, 0.6);
      p.lineS(
        cx + ux * r0 - uy,
        cy + uy * r0 + ux,
        cx + ux * r1 - uy,
        cy + uy * r1 + ux,
        SMEAR[ph][2],
        0.8 * (1 - kk),
        0,
      );
      glint(p, cx + ux * Rm, cy + uy * Rm, 3 * (1 - kk) + 1, SMEAR[ph][1], 1 - kk);
    }
    // Жар в процарапанном круге — остывает за 0,3 с.
    if (age < 0.3) ring(p, cx, cy, Rm, hotSpark(age / 0.3), 1 - age / 0.3, spinPassed(sd, front));
    // Волна воздуха наружу.
    if (age < 0.42)
      ring(
        p,
        cx,
        cy,
        ro + 2 + 26 * eOut2(age / 0.42),
        GLOW_HI[ph],
        0.85 * (1 - age / 0.42),
        (_a, i) => hash(i >> 2, sd, 9) > 0.22,
        0.5,
      );
    // Искры по касательной из обода.
    sparks(
      p,
      sd,
      age,
      cx,
      cy,
      few ? 6 : 18,
      0,
      0.35,
      60,
      70,
      0.45,
      60,
      metalSpark(ph),
      (i) => (i % 6) * 0.02,
      (i) => {
        const ta = top + hash(sd, i, 71) * TAU;
        return [cx + Math.cos(ta) * Rm, cy + Math.sin(ta) * Rm, ta + Math.PI / 2];
      },
    );
    g.restore();
    // Острия обеих стрелок в кадр контакта: вспышка и сноп по ходу.
    const tips = contactPts(zz.id, mobById(zz.mob), ['minTip', 'hourTip'], S);
    tips.forEach(([tx, ty], j) => {
      const ta = Math.atan2(ty - cy, tx - cx) + Math.PI / 2;
      if (age < 0.12) {
        const kk = age / 0.12;
        p.col(kk < 0.4 ? '#ffffff' : SMEAR[ph][1], 1 - kk * 0.5);
        star(p, tx, ty, 7 * (1 - kk * 0.5), 4, ta + 0.4);
      }
      sparks(p, sd + 11 + j, age, tx, ty, few ? 3 : 7, ta, 0.6, 60, 70, 0.38, 50, metalSpark(ph));
    });
  }),
);

// =============================================================================
// МИНУТНАЯ — прицел линией первые 0,25 с (линия ходит за героем), удар —
// в 0,72/0,64/0,58 с: Повелитель летит по линии 0,2 с, минутная входит в
// пол (стрелка в полу 1 с — окно). Метка движка (`m.tele`) выключена
// (`vNoTele`) — рисуем свою (`f14b_minmark`): дорожка с минутными рисками по
// обоим краям; пока ищет — пунктир и прицел на конце пляшет, захват —
// щелчок (риски вспыхивают); остриё минутной стрелки бежит от Повелителя к
// концу, налив за ним, риски загораются; в конце — скоба и крест: здесь
// стрелка войдёт в пол. Контакт — `f14b_lunge` (след выпада: смаз стали
// по дорожке, линии скорости, пыль толчка) и `f14b_stab` (стрелка в полу:
// звезда, трещины, сколы, пыль; пока держит — натуга искрами; вырвал —
// крошка).
// =============================================================================

const MIN_AIM = 0.25;
const MIN_E = 1.35;

registerZonePainter(
  'f14b_minmark',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const zz = z as FxZone;
    const m = mobById(zz.mob);
    if (!m || m.mode !== 'f14_minute' || !m.tele) return;
    const tl = m.tele;
    const P = markPal();
    const k = k01(tl.k);
    const Tw = Math.max(0.05, zz.life - 0.1);
    const left = Tw * (1 - k);
    const sig = left < SIG;
    const tk = !reduced() && tick(left);
    const cx = m.x * S;
    const cy = m.y * S;
    const p = new Pen(g, px + (m.x - zz.x) * S, py + (m.y - zz.y) * S, cx, cy);
    const a = tl.ang ?? 0;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const nx = -uy;
    const ny = ux;
    const L = tl.r * S;
    const hw = (tl.w ?? 0.48) * S;
    const l0 = S * 0.55;
    const aim = m.t < MIN_AIM;
    const born = k01(m.t / 0.08);
    // «Куда»: дорожка.
    p.col(P.fill, (P.fillA * 0.75 + 0.05 * k) * born);
    fillLane(p, cx, cy, ux, uy, l0, L, hw);
    // «Когда»: остриё бежит к концу, налив за ним — у острия ярче.
    const e = Math.pow(k, MIN_E);
    const front = l0 + (L - l0) * e;
    p.col(P.sweep, (0.16 + 0.08 * k) * born);
    fillLane(p, cx, cy, ux, uy, l0, front, hw * (0.5 + 0.5 * e));
    p.col(sig ? P.sweepHot : P.sweep, (0.2 + 0.08 * k + (tk ? 0.14 : 0)) * born);
    fillLane(p, cx, cy, ux, uy, Math.max(l0, front - 20), front, hw * (0.5 + 0.5 * e));
    // Риски по краям: каждые 4 пикселя, каждая пятая длиннее.
    const lockT = m.t - MIN_AIM;
    const lockFlash = lockT >= 0 && lockT < 0.07;
    for (let s = l0 + 2, i = 0; s < L - 1; s += 4, i++) {
      const on = s <= front;
      const len = i % 5 === 0 ? 3 : 2;
      for (const side of [-1, 1]) {
        const ex = cx + ux * s + nx * hw * side;
        const ey = cy + uy * s + ny * hw * side;
        if (aim && !on && i % 2) continue;
        p.lineS(
          ex,
          ey,
          ex - nx * side * len,
          ey - ny * side * len,
          lockFlash || (sig && on) ? '#ffffff' : on ? P.tickOn : P.tick,
          0.9 * born,
          on ? 0.5 : 0,
        );
      }
    }
    // Края дорожки: пока ищет — пунктир бежит к цели; захват — сплошные.
    const edge = sig ? (tk ? '#ffffff' : C.brass[4]) : lockFlash ? '#ffffff' : P.edge;
    const run = time * 60;
    for (let s = l0; s < L; s += 1) {
      if (aim && mod(s - run, 6) >= 3) continue;
      for (const side of [-1, 1]) {
        const ex = cx + ux * s + nx * (hw + 1) * side;
        const ey = cy + uy * s + ny * (hw + 1) * side;
        p.col(P.edgeSh, 0.6 * born);
        p.dot(ex + nx * side, ey + ny * side);
        p.col(edge, (0.75 + 0.25 * k) * born);
        p.dot(ex, ey);
      }
    }
    // Остриё минутной стрелки — тень с острым концом.
    p.col(P.shade, P.shadeA * born);
    fillPoly(p, handPts(cx, cy, a, Math.max(l0, front - 14), front + 1, 3, true));
    p.col(sig ? '#ffffff' : P.tickOn, 0.9 * born);
    p.dot(cx + ux * front, cy + uy * front);
    // Последние 0,2 с к краям дорожки сходятся белые пунктиры — «сейчас».
    if (left < SIG) {
      const sk = k01(1 - left / SIG);
      const off = hw + 2 + 9 * (1 - eOut3(sk));
      p.col('#ffffff', 0.35 + 0.6 * sk);
      for (let s = l0, i = 0; s < L; s += 1, i++) {
        if ((i >> 1) % 3 === 2) continue;
        for (const side of [-1, 1])
          p.dot(cx + ux * s + nx * off * side, cy + uy * s + ny * off * side);
      }
    }
    // Конец: скоба поперёк и крест — сюда войдёт стрелка.
    const bx = cx + ux * L;
    const by = cy + uy * L;
    const endC = sig ? '#ffffff' : lockFlash ? '#ffffff' : C.brass[4];
    p.lineS(
      bx + nx * (hw + 3),
      by + ny * (hw + 3),
      bx - nx * (hw + 3),
      by - ny * (hw + 3),
      endC,
      0.95 * born,
      0.6,
    );
    // Крест — ровно там, где минутная войдёт в пол (`f14b_stab`: конец выпада
    // + 0,6 клетки = конец дорожки).
    const xs = cx + ux * (L - 2);
    const ys = cy + uy * (L - 2);
    const jit = aim && !reduced() ? (hash(Math.floor(time * 20), 3) - 0.5) * 2 : 0;
    const cr = 3 + (aim ? 1 : 0) + (sig ? 1 : 0);
    for (const d of [1, -1]) {
      const qx = (ux + nx * d) * cr;
      const qy = (uy + ny * d) * cr;
      p.lineS(
        xs - qx + jit,
        ys - qy,
        xs + qx + jit,
        ys + qy,
        sig ? C.white : P.edge,
        0.95 * born,
        0.6,
      );
    }
  }),
);

const LUNGE = 0.2;

// След выпада (поверх темноты): Повелитель летит 0,2 с от начала к концу
// (мозг ведёт его линейно), за ним — линии скорости по всей высоте тела.
// Клинок, его смаз и игла острия — в кадре «Тела»; пыль — `f14b_scuff`.
registerZonePainter(
  'f14b_lunge',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number) => {
    const zz = z as FxZone;
    const t = zz.t;
    const cx = zz.x * S;
    const cy = zz.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const a = zz.ang ?? 0;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const nx = -uy;
    const ny = ux;
    const L = Math.max(0.5, (zz.len ?? 3) - 0.6) * S;
    const sd = seedOf(zz.id);
    const few = reduced();
    const ph = phaseNow();
    const head = L * k01(t / LUNGE);
    // Хвост догоняет голову, когда тело встало: линии втягиваются за 0,16 с.
    const tail = Math.min(
      head,
      L * eIn2(k01((t - 0.04) / 0.3)) + L * eOut2(k01((t - LUNGE) / 0.16)),
    );
    const fade = 1 - k01((t - LUNGE - 0.05) / 0.2);
    // Линии скорости — по всей высоте тела (Повелитель 3,5 клетки ростом):
    // длинные у пояса, короче у головы и подола; белые и цвета фазы. Идут
    // ЗА телом: где тело ближе к камере, линия прячется.
    const occ = occOf(S);
    if (fade > 0 && head - tail > 1) {
      const nL = few ? 5 : 11;
      for (let i = 0; i < nL; i++) {
        const hgt = 4 + (i / (nL - 1)) * 48;
        const off = (hash(sd, i, 3) - 0.5) * 10;
        const mid = 1 - Math.abs(hgt - 26) / 26;
        const len = (head - tail) * (0.45 + 0.55 * mid) * (0.7 + 0.3 * hash(sd, i, 4));
        const s1 = head - 6 - 6 * hash(sd, i, 5);
        const s0 = Math.max(tail, s1 - len);
        if (s1 <= s0) continue;
        const ox = nx * off;
        const oy = ny * off - hgt;
        p.col(i % 3 === 1 ? GLOW_HI[ph] : '#ffffff', (0.55 + 0.4 * mid) * fade);
        p.lineO(
          cx + ux * s0 + ox,
          cy + uy * s0 + oy,
          cx + ux * s1 + ox,
          cy + uy * s1 + oy,
          occ,
          hgt,
        );
        if (mid > 0.5) {
          p.col(SMEAR[ph][2], 0.6 * fade);
          p.lineO(
            cx + ux * s0 + ox,
            cy + uy * s0 + oy + 1,
            cx + ux * (s0 + (s1 - s0) * 0.6) + ox,
            cy + uy * (s0 + (s1 - s0) * 0.6) + oy + 1,
            occ,
            hgt - 1,
          );
        }
      }
    }
    // Кадр урона: вся дорожка вспыхивает разом — клинок «прошил» её в миг
    // удара (урон — по всей дорожке сразу, а тело долетит за 0,2 с).
    if (t < 0.1) {
      const kk = t / 0.1;
      const L1 = ((zz.len ?? 3) * S) | 0;
      g.save();
      clipBodies(g, p, S);
      p.col('#ffffff', 0.9 * (1 - kk));
      p.line(cx + ux * S * 0.55, cy + uy * S * 0.55, cx + ux * L1, cy + uy * L1);
      p.col(GLOW_HI[ph], 0.6 * (1 - kk));
      for (const side of [-1, 1]) {
        const o = 2 + 3 * kk;
        p.line(
          cx + ux * S * 0.7 + nx * o * side,
          cy + uy * S * 0.7 + ny * o * side,
          cx + ux * (L1 - 4) + nx * o * side,
          cy + uy * (L1 - 4) + ny * o * side,
        );
      }
      g.restore();
    }
    // Пыль подола и толчка — на полу, в `f14b_scuff`.
  }),
);

// Пол под выпадом (`f14b_scuff`, слой пола): подол метёт пол — клубы по пути,
// по мере того как он проходит место; у старта — толчок пылью и сколами назад.
registerZonePainter(
  'f14b_scuff',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number) => {
    const zz = z as FxZone;
    const t = zz.t;
    const cx = zz.x * S;
    const cy = zz.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const a = zz.ang ?? 0;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const nx = -uy;
    const ny = ux;
    const L = Math.max(0.5, (zz.len ?? 3) - 0.6) * S;
    const sd = seedAt(zz.x, zz.y, a);
    const few = reduced();
    const ph = phaseNow();
    const nP = few ? 3 : 6;
    dust(
      p,
      sd + 7,
      t,
      cx,
      cy,
      nP,
      a + Math.PI,
      0.9,
      8,
      10,
      2,
      5.5,
      4,
      0.6,
      dustPal(),
      0.55,
      (i) => ((i + 0.5) / nP) * LUNGE,
      (i) => {
        const s = ((i + 0.5) / nP) * L;
        const side = i % 2 ? 1 : -1;
        return [
          cx + ux * s + nx * side * 7,
          cy + uy * s + ny * side * 7,
          Math.atan2(ny * side, nx * side),
        ];
      },
    );
    dust(
      p,
      sd,
      t,
      cx - ux * 4,
      cy - uy * 4,
      few ? 3 : 6,
      a + Math.PI,
      0.7,
      24,
      22,
      1.5,
      6,
      4,
      0.75,
      dustPal(),
      0.75,
    );
    chips(p, sd + 3, t, cx, cy, few ? 2 : 6, a + Math.PI, 0.6, 20, 30, 40, 40, [0.6, 0.9], 0.1, ph);
    // Борозда подола по эмали: две тонкие царапины по краям пути, тают.
    const head = L * k01(t / LUNGE);
    const fade = 1 - k01((t - 0.3) / 0.35);
    if (fade > 0 && head > 2)
      for (const side of [-1, 1])
        for (let q = 0; q < head; q += 1) {
          if (hash(q >> 2, side + 5, sd) < 0.35) continue;
          const X = cx + ux * q + nx * side * 5;
          const Y = cy + uy * q + ny * side * 5;
          p.col(C.ink, 0.3 * fade);
          p.dot(X, Y + 1);
          p.col(C.white, 0.22 * fade);
          p.dot(X, Y);
        }
  }),
);

/** Где минутная вошла в пол: остриё из кадра «Тела» в первый кадр зоны. */
function stabAt(zz: FxZone, S: number): [number, number] {
  const [tip] = contactPts(zz.id, lordNow(), ['minTip'], S);
  return tip ?? [zz.x * S, zz.y * S];
}

const stabBranches = (sd: number, a: number) => {
  const br = starBranches(sd, 6, a, 12, 20, 2);
  br[0][1] = 30;
  br[3][1] = 18;
  return br;
};

// Стрелка в полу, слой ПОЛА: трещины бегут по эмали (длиннее по ходу
// выпада) тёмным жёлобом, воронка, тень удара кольцом, сколы и пыль;
// вырвал — крошка и клуб. Место — остриё минутной из кадра «Тела».
registerZonePainter(
  'f14b_stab',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number) => {
    const zz = z as FxZone;
    const t = zz.t;
    const [cx, cy] = stabAt(zz, S);
    const p = new Pen(g, px, py, zz.x * S, zz.y * S);
    const a = zz.ang ?? 0;
    const sd = seedAt(zz.x, zz.y, a);
    const few = reduced();
    const ph = phaseNow();
    const out = LORD.stuck;
    const fade = 1 - k01((t - out - 0.3) / 0.5);
    const ck = crackOf(`stab|${sd}`, sd, stabBranches(sd, a), 0.45, 0.25, 0.5);
    const reach = ck.max * eOut3(k01(t / 0.16));
    drawCrack(p, ck, cx, cy, reach, '#1a0e06', C.white, 0.9 * fade, NO_OCC);
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    p.col(C.white, 0.45 * fade);
    lens(p, cx + 1, cy + 1, ux, uy, 5.5, 2.8);
    p.col(C.ink, 0.85 * fade);
    lens(p, cx, cy, ux, uy, 5, 2.4);
    if (t < 0.35) {
      const kk = t / 0.35;
      ring(
        p,
        cx,
        cy,
        5 + 28 * eOut2(kk),
        C.ink,
        0.5 * (1 - kk),
        (_x, i) => hash(i >> 2, sd, 9) > 0.25,
      );
    }
    chips(
      p,
      sd,
      t,
      cx,
      cy,
      few ? 5 : 14,
      a + Math.PI,
      Math.PI,
      18,
      36,
      55,
      75,
      [0.9, 1.3],
      0.15,
      ph,
    );
    dust(p, sd + 2, t, cx, cy, few ? 3 : 8, 0, Math.PI, 16, 18, 2, 7, 6, 1.0, dustPal(), 0.85);
    if (t >= out) {
      const tt = t - out;
      chips(
        p,
        sd + 20,
        tt,
        cx,
        cy,
        few ? 2 : 7,
        -Math.PI / 2,
        1.4,
        10,
        18,
        55,
        40,
        [0.6, 0.9],
        0.15,
        ph,
      );
      dust(
        p,
        sd + 21,
        tt,
        cx,
        cy,
        few ? 2 : 5,
        -Math.PI / 2,
        1.6,
        10,
        10,
        2,
        6,
        7,
        0.8,
        dustPal(),
        0.75,
      );
    }
  }),
);

// Стрелка в полу, слой ПОВЕРХ ТЕМНОТЫ (`f14b_stabfx`): жар бежит по трещинам
// и остывает, жар на дне воронки, звезда контакта и белое кольцо, сноп искр
// назад; пока стрелка сидит (1 с) — натуга искрами от её настоящего острия в
// такт рывкам тела. Что на полу — прячется за телами.
registerZonePainter(
  'f14b_stabfx',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number) => {
    const zz = z as FxZone;
    const t = zz.t;
    const [cx, cy] = stabAt(zz, S);
    const p = new Pen(g, px, py, zz.x * S, zz.y * S);
    const a = zz.ang ?? 0;
    const sd = seedAt(zz.x, zz.y, a);
    const few = reduced();
    const ph = phaseNow();
    const out = LORD.stuck;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    g.save();
    clipBodies(g, p, S);
    const heat = 1 - k01(t / 0.7);
    if (heat > 0) {
      const ck = crackOf(`stab|${sd}`, sd, stabBranches(sd, a), 0.45, 0.25, 0.5);
      const reach = ck.max * eOut3(k01(t / 0.16));
      drawCrack(
        p,
        ck,
        cx,
        cy,
        Math.min(reach, ck.max * (0.25 + 0.75 * heat)),
        hotSpark(1 - heat),
        null,
        heat,
        NO_OCC,
      );
    }
    if (t < out) {
      p.col(hotSpark(k01(t / 0.6) * 0.8), 0.8 * (1 - k01(t / 0.9)));
      lens(p, cx, cy, ux, uy, 2.5, 1.1);
    }
    if (t < 0.35) {
      const kk = t / 0.35;
      ring(
        p,
        cx,
        cy,
        4 + 28 * eOut2(kk),
        '#ffffff',
        0.9 * (1 - kk),
        (_x, i) => hash(i >> 2, sd, 9) > 0.25,
      );
    }
    g.restore();
    // Кадр контакта: звезда с тенью (читается и на светлой эмали).
    if (t < 0.13) {
      const kk = t / 0.13;
      const r = 17 * (1 - 0.5 * kk);
      p.col(SMEAR[ph][3], 0.8);
      star(p, cx + 1, cy - 1, r, 8, a + 0.2);
      p.col(kk < 0.4 ? '#ffffff' : SMEAR[ph][1], 1);
      star(p, cx, cy - 2, r, 8, a + 0.2);
      if (kk < 0.6) {
        p.col('#ffffff', 1);
        star(p, cx, cy - 2, 8, 4, a + 0.6);
      }
    }
    sparks(
      p,
      sd + 4,
      t,
      cx,
      cy - 2,
      few ? 4 : 12,
      a + Math.PI,
      1.3,
      50,
      60,
      0.45,
      70,
      metalSpark(ph),
    );
    // Натуга: стрелка дёргается в полу — искры в такт (6 Гц, как рывки тела)
    // из острия, где оно сейчас.
    if (!few && t > 0.15 && t < out) {
      const beat = Math.floor((t - 0.15) * 6);
      const bt = (t - 0.15) * 6 - beat;
      const m = mobById(zz.mob) ?? lordNow();
      const [sx, sy] = m && m.mode === 'f14_stuck' ? lordPt(m, 'minTip', S) : [cx, cy];
      if (bt < 0.45)
        sparks(
          p,
          sd + 10 + beat,
          bt / 6,
          sx,
          sy - 3,
          4,
          -Math.PI / 2,
          1.2,
          30,
          30,
          0.25,
          40,
          metalSpark(ph),
        );
    }
  }),
);

// =============================================================================
// ОСТАНОВКА — хлопок 2 с («вдох» под звук остановки), потом мир стоит
// 2,2 с (в полночь 1,6). `f14b_stop` — на всю арену, поверх темноты:
//   • вдох: кольца сходятся к Повелителю всё чаще, песчинки идут к нему по
//     спирали с разгоном; вокруг — двенадцать рисок часов загораются по
//     одной (двенадцатая — остановка), стрелка показывает на последнюю;
//   • стоит: стекло времени — застывшие кольца с бегущим бликом, висящие
//     песчинки, края кадра темнеют; риски гаснут по одной против часовой —
//     сколько осталось до «время пошло»;
//   • пуск: волна от места хлопка, застывшее стекло трескается и
//     разлетается, песчинки срываются. Через 0,35 с летят ножи.
// Мир в остановке серый (движок): здесь всё держится на яркости.
// =============================================================================

const STOP_RINGS = [2.6, 5.2, 7.8];
/** Зоны остановки, при которых мир действительно встал. */
const stopSeen = new Set<number>();

/**
 * Циферблат героя в остановке: двенадцать рисок кольцом вокруг него, горят
 * `on` (гаснут против часовой — гаснущая мигает); `burst` 0…1 — время пошло:
 * риски разлетаются наружу и тают.
 */
function heroDial(
  p: Pen,
  hx0: number,
  hy0: number,
  on: number,
  glow: string,
  glow2: string,
  a: number,
  burst: number,
  time: number,
): void {
  const R = 19 + 16 * eOut2(burst);
  const al = a * (1 - burst);
  if (al <= 0) return;
  // Тонкий обод — сплошной у горящих часов, пунктир у погасших.
  ring(p, hx0, hy0, R + 2, glow2, 0.45 * al, (ang, i) => {
    const h = Math.floor(mod((ang + Math.PI / 2) / TAU, 1) * 12);
    return burst > 0 || h < on || (i >> 1) % 2 === 0;
  });
  for (let h = 0; h < 12; h++) {
    const ang = -Math.PI / 2 + (h / 12) * TAU;
    const lit = burst > 0 || h < on;
    const dying = h === on - 1 && Math.floor(time * 10) % 2 === 0;
    const L = h % 3 ? 3 : 6;
    const x0 = hx0 + Math.cos(ang) * (R - L);
    const y0 = hy0 + Math.sin(ang) * (R - L);
    const x1 = hx0 + Math.cos(ang) * R;
    const y1 = hy0 + Math.sin(ang) * R;
    p.lineS(
      x0,
      y0,
      x1,
      y1,
      lit ? (dying ? glow2 : '#ffffff') : glow2,
      (lit ? 1 : 0.3) * al,
      lit ? 0.7 : 0,
    );
  }
}

/**
 * Пузырь его времени. Движок в остановке красит весь кадр в серое ПОСЛЕ всех
 * слоёв — и Повелитель, единственный, кто в ней ходит, серел вместе с миром
 * (неправда: время стоит не для него). Серое движка — режим `saturation` с
 * долей 0,92: оттенок пикселей остаётся (8% цвета), падает насыщенность.
 * После кадра (микрозадача: после `frame()`, до вывода на экран) в овале
 * вокруг него насыщенность возвращаем тем же режимом — заливкой цвета с
 * насыщенностью ~0,32: оттенок и яркость — его собственные. Снимок кадра не
 * нужен (копия живой канвы стоила ~9 мс). Кромка овала — стекло.
 * Просьба к движку: серое с исключением по мобу.
 */
function lordBubble(
  g: CanvasRenderingContext2D,
  p: Pen,
  m: Mob,
  S: number,
  glow: string,
  form: number,
): void {
  const sim = paintSim();
  if (!sim || reduced() || !(sim.scaleT > 0 && sim.worldScale < 0.95)) return;
  if (typeof queueMicrotask === 'undefined') return;
  const T = g.getTransform();
  if (T.b || T.c || !T.a || !T.d) return;
  const RX = 21;
  const RY = 37;
  const ux = m.x * S + p.qx;
  const uy = m.y * S - 27 + p.qy;
  const ex = T.a * ux + T.e;
  const ey = T.d * uy + T.f;
  const rx = T.a * RX;
  const ry = T.d * RY;
  queueMicrotask(() => {
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'saturation';
    g.fillStyle = 'hsl(30, 32%, 50%)';
    // Край мягкий: внешнее кольцо — вполсилы.
    for (const [kr, a] of [
      [1, 0.5],
      [0.88, 1],
    ]) {
      g.globalAlpha = a * form;
      g.beginPath();
      g.ellipse(ex, ey, rx * kr, ry * kr, 0, 0, TAU);
      g.fill();
    }
    g.restore();
  });
  // Стекло пузыря: тонкая кромка с бликом сверху-слева.
  const cx = m.x * S;
  const cy = m.y * S - 27;
  p.col(glow, 0.35 * form);
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * TAU;
    if ((i >> 1) % 4 === 3) continue;
    p.dot(cx + Math.cos(a) * (RX + 1), cy + Math.sin(a) * (RY + 1));
  }
  p.col('#ffffff', 0.7 * form);
  for (let i = 0; i < 6; i++) {
    const a = Math.PI * 1.1 + i * 0.09;
    p.dot(cx + Math.cos(a) * (RX - 2), cy + Math.sin(a) * (RY - 2));
  }
}

registerZonePainter(
  'f14b_stop',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const zz = z as FxZone;
    const sim = paintSim();
    const cx = zz.x * S;
    const cy = zz.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const sd = seedOf(zz.id);
    const ph = phaseNow();
    const few = reduced();
    const clap = LORD.clap;
    const e = stopElapsed(sim);
    const t = zz.t;
    const m = mobById(zz.mob);
    // Хлопок сорван (Повелитель пал на вдохе) — ни вдоха, ни «пуска»: пуск
    // рисуем, только если эта зона видела остановку.
    if (e >= 0 && !stopSeen.has(zz.id)) {
      stopSeen.add(zz.id);
      if (stopSeen.size > 32) stopSeen.delete(stopSeen.values().next().value as number);
    }
    const clapping = m?.mode === 'f14_clap';
    if (e < 0 && !clapping && !stopSeen.has(zz.id)) return;
    const inhale = e < 0 && clapping;
    const glow = GLOW_HI[ph];
    const glow2 = GLOW[ph];
    // Где были песчинки, когда мир встал: от зерна и доли вдоха.
    const moteAt = (i: number, kk: number): [number, number] => {
      const h1 = hash(sd, i, 51);
      const h2 = hash(sd, i, 52);
      const r0 = (2.2 + 7 * h1) * S;
      const cyc = mod(h2 + kk * (0.55 + 0.9 * kk), 1);
      const r = r0 * (1 - cyc * 0.85);
      const a = h2 * TAU + i * 0.7 - cyc * 2.4;
      return [cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.86];
    };
    const NM = few ? 14 : 34;
    if (inhale) {
      const kk = k01(t / clap);
      const left = clap - t;
      const sig = left < SIG;
      // Кольца сходятся: всё чаще (фаза растёт квадратично). Кольца,
      // песчинки и риски — на полу: за телами прячутся.
      const phase = kk * 2.2 + kk * kk * 4.5;
      g.save();
      clipBodies(g, p, S);
      for (let i = 0; i < 4; i++) {
        const u = mod(phase + i / 4, 1);
        const r = S * 9.5 * (1 - u);
        if (r < 6) continue;
        ring(
          p,
          cx,
          cy,
          r,
          i % 2 ? glow2 : glow,
          (0.15 + 0.5 * u) * (0.4 + 0.6 * kk),
          (_a, j) => (j >> 2) % 4 !== 3,
        );
      }
      // Песчинки идут к нему по спирали.
      for (let i = 0; i < NM; i++) {
        const [x, y] = moteAt(i, kk);
        p.col(i % 3 ? glow : glow2, 0.45 + 0.5 * kk);
        p.dot(x, y);
      }
      g.restore();
      // Время втягивается в циферблат его лица (точка «Тела»): штрихи летят
      // со всей арены, всё быстрее и длиннее (длина — по скорости).
      const [mx, my] = m ? lordPt(m, 'face', S) : [cx, cy - 41];
      const NSk = few ? 10 : 26;
      for (let i = 0; i < NSk; i++) {
        const h1 = hash(sd, i, 61);
        const h2 = hash(sd, i, 62);
        const ph0 = phase * (0.8 + 0.4 * h2) + h1;
        const u = mod(ph0, 1);
        const r = S * 9 * Math.pow(1 - u, 1.4) + 6;
        const v = 1.4 * Math.pow(1 - u, 0.4) * (0.6 + kk * 1.8);
        const len = Math.min(26, 3 + v * 9);
        const a = h2 * TAU + i * 2.4;
        const ux = Math.cos(a);
        const uy = Math.sin(a) * 0.86;
        const al = k01(u * 4) * (0.35 + 0.6 * kk);
        p.col(i % 4 ? glow : '#ffffff', al);
        p.line(mx + ux * r, my + uy * r, mx + ux * (r + len), my + uy * (r + len));
      }
      // Венец вдоха вокруг циферблата (само лицо разгорается в кадре «Тела»,
      // поверх него не рисуем): кольцо сжимается, к хлопку — лучи наружу.
      const core = 2 + 5 * eIn2(kk);
      const hr = 16 - 4 * kk;
      ring(p, mx, my, hr + 1, glow2, 0.4 + 0.4 * kk);
      ring(p, mx, my, hr, '#ffffff', 0.5 + 0.4 * kk, (_a, i) => sig || (i >> 1) % 4 !== 3);
      if (kk > 0.5) {
        const fl = sig ? (tick(left) ? 1 : 0.6) : 0.5 + 0.5 * Math.sin(time * 24);
        p.col('#ffffff', fl * (kk - 0.5) * 2);
        for (let r = 0; r < 4; r++) {
          const a = time * 0.6 + (r * Math.PI) / 2;
          const L = hr + 2 + core * 2.2;
          p.line(
            mx + Math.cos(a) * (hr + 2),
            my + Math.sin(a) * (hr + 2),
            mx + Math.cos(a) * L,
            my + Math.sin(a) * L,
          );
        }
      }
      // Двенадцать рисок вокруг: загораются по одной — двенадцатая — остановка.
      g.save();
      clipBodies(g, p, S);
      const lit = Math.min(12, Math.floor(kk * 12 + 1e-6));
      const Rd = S * 3.4;
      for (let h = 0; h < 12; h++) {
        const a = -Math.PI / 2 + (h / 12) * TAU;
        const on = h < lit || sig;
        const x0 = cx + Math.cos(a) * (Rd - 5);
        const y0 = cy + Math.sin(a) * (Rd - 5);
        const x1 = cx + Math.cos(a) * Rd;
        const y1 = cy + Math.sin(a) * Rd;
        p.lineS(
          x0,
          y0,
          x1,
          y1,
          on ? (sig && !tick(left) ? '#ffffff' : glow) : glow2,
          on ? 0.95 : 0.25,
          0.5,
        );
        if (h === lit - 1 && !sig) glint(p, x1, y1, 2, glow, 0.9);
      }
      g.restore();
      return;
    }
    if (e >= 0) {
      // Мир стоит. Первые 0,25 с — затвор: кольцо уходит за край арены.
      const dur = f14Time(sim!)?.dur ?? 2.2;
      if (e < 0.3) {
        const kk = e / 0.3;
        ring(p, cx, cy, S * 1.5 + S * 10 * eOut3(kk), '#ffffff', 0.9 * (1 - kk), undefined, 0.6);
        ring(p, cx, cy, S * 1 + S * 8 * eOut3(kk), glow, 0.6 * (1 - kk));
      }
      // Его время идёт: пузырь цвета вокруг Повелителя (движок сереет кадр).
      if (m) lordBubble(g, p, m, S, glow, k01(e / 0.2));
      g.save();
      clipBodies(g, p, S);
      // Стекло времени: три застывших кольца, по ним идёт блик.
      const form = k01(e / 0.2);
      for (let i = 0; i < STOP_RINGS.length; i++) {
        const R = STOP_RINGS[i] * S;
        const run = time * (0.6 + 0.2 * i) * (i % 2 ? -1 : 1) + i;
        ring(p, cx, cy, R, glow, 0.28 * form, (_a, j) => (j + i) % 3 !== 0);
        ring(
          p,
          cx,
          cy,
          R,
          '#ffffff',
          0.85 * form,
          (ang) => {
            const d = Math.abs(mod(ang - run + Math.PI, TAU) - Math.PI);
            return d < 0.18;
          },
          0.5,
        );
      }
      // Висящие песчинки (где их застал хлопок) — слегка мерцают.
      for (let i = 0; i < NM; i++) {
        const [x, y] = moteAt(i, 1);
        const tw = few ? 1 : 0.6 + 0.4 * Math.sin(time * 5 + i * 1.7);
        p.col(i % 3 ? glow : '#ffffff', 0.85 * tw);
        p.dot(x, y);
        if (i % 7 === 0) glint(p, x, y, 1.5, glow, 0.6 * tw);
      }
      g.restore();
      // Края кадра темнеют: тьма за аркой.
      const vg = 0.35 * form;
      p.col(C.inkN, vg);
      fillSector(p, cx, cy, S * 9.6, S * 16, 0, TAU);
      p.col(C.inkN, vg * 0.6);
      fillSector(p, cx, cy, S * 8.4, S * 9.6, 0, TAU);
      // Сколько осталось — у самого героя (туда смотрят): двенадцать рисок
      // кольцом гаснут по одной против часовой; последняя — «время пошло».
      const leftK = k01(1 - e / dur);
      const on = Math.ceil(leftK * 12 - 1e-6);
      heroDial(p, sim!.hero.x * S, sim!.hero.y * S - 7, on, glow, glow2, form, 0, time);
      return;
    }
    // Время пошло: волна, стекло разлетается, песчинки срываются.
    const age = t - clap;
    if (age < 0) return;
    if (sim && age < 0.35)
      heroDial(p, sim.hero.x * S, sim.hero.y * S - 7, 0, glow, glow2, 1, age / 0.35, time);
    if (age < 0.55) {
      const kk = age / 0.55;
      ring(
        p,
        cx,
        cy,
        S * 1.5 + S * 11 * eOut2(kk),
        '#ffffff',
        0.9 * (1 - kk),
        (_a, i) => hash(i >> 2, sd, 7) > 0.15,
        0.6,
      );
      ring(p, cx, cy, S * 1 + S * 9.5 * eOut2(k01((age - 0.05) / 0.55)), glow, 0.7 * (1 - kk));
    }
    // Осколки стеклянных колец: дуги расходятся и тают.
    const shatter = k01(age / 0.7);
    if (shatter < 1)
      for (let i = 0; i < STOP_RINGS.length; i++) {
        const R = STOP_RINGS[i] * S * (1 + 0.25 * eOut2(shatter));
        ring(
          p,
          cx,
          cy,
          R,
          i % 2 ? glow : '#ffffff',
          0.8 * (1 - shatter),
          (ang, j) =>
            hash(Math.floor(((ang + Math.PI) / TAU) * 24), i, sd) > 0.45 + 0.5 * shatter &&
            (j & 1) === 0,
        );
      }
    // Песчинки срываются наружу с сопротивлением.
    for (let i = 0; i < NM; i++) {
      const [x, y] = moteAt(i, 1);
      const a = Math.atan2(y - cy, x - cx);
      const d = drag(70 + 50 * hash(sd, i, 55), 3.5, age);
      const al = 1 - k01(age / 0.8);
      if (al <= 0) break;
      p.col(i % 3 ? glow : '#ffffff', 0.85 * al);
      p.line(
        x + Math.cos(a) * Math.max(0, d - 4),
        y + Math.sin(a) * Math.max(0, d - 4),
        x + Math.cos(a) * d,
        y + Math.sin(a) * d,
      );
    }
  }),
);

// Телепорт в остановке: выход — риски сходятся в точку и столб гаснет;
// вход — столб света, риски расходятся кольцом, круг на полу. Мир стоит,
// поэтому часы — настоящие секунды с первого кадра зоны.
registerZonePainter(
  'f14b_blink',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const zz = z as FxZone;
    const t = time - seenAt(zz.id, time);
    const D = 0.42;
    if (t > D) return;
    const cx = zz.x * S;
    const cy = zz.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const ph = phaseNow();
    const glow = GLOW_HI[ph];
    const k = t / D;
    const inn = (zz.n ?? 0) === 1;
    // Столб — по высоте Повелителя: у пола шире и ярче, к верху тает и
    // сужается; вход — бьёт сверху и оседает, выход — стягивается в нить.
    const colA = inn ? 1 - k : 1 - k * 1.4;
    if (colA > 0) {
      const H = 64;
      const w0 = inn ? 5 * (1 - eOut2(k)) + 1 : 3 * (1 - k) + 1;
      const X = Math.floor(cx);
      const Y = Math.floor(cy);
      for (let y = 0; y < H; y++) {
        const u = y / H;
        const w = Math.max(1, Math.round(w0 * (1 - u * 0.6)));
        const a = colA * Math.pow(1 - u, 0.6);
        p.col(glow, a * 0.55);
        p.rect(X - Math.ceil(w / 2) - 1, Y - y, w + 2, 1);
        p.col('#ffffff', a);
        p.rect(X - Math.floor(w / 2), Y - y, Math.max(1, w - 1), 1);
      }
    }
    // Двенадцать рисок: сходятся (выход) или расходятся (вход).
    const r = inn ? 6 + 22 * eOut2(k) : 26 * (1 - eOut2(k)) + 3;
    for (let h = 0; h < 12; h++) {
      const a = -Math.PI / 2 + (h / 12) * TAU;
      const x = cx + Math.cos(a) * r;
      const y = cy - 22 + Math.sin(a) * r * 0.9;
      p.col(h % 3 ? glow : '#ffffff', 1 - k);
      p.dot(x, y, h % 3 ? 1 : 2, h % 3 ? 1 : 2);
    }
    // Круг на полу.
    ring(
      p,
      cx,
      cy,
      inn ? 4 + 14 * eOut2(k) : 16 * (1 - k) + 2,
      glow,
      0.8 * (1 - k),
      undefined,
      0.5,
    );
    if (inn && t < 0.1) {
      p.col('#ffffff', 1 - t / 0.1);
      star(p, cx, cy - 26, 12, 4, 0);
    }
  }),
);

// Ножи Повелителя. Общий рисунок ножа (`f14_knife`) — этажа, его ставят и
// мобы; ножи кольца мозг ставит под своим рисунком `f14b_lknife`: пока нож
// летит из руки на место — снаряд пустой, его рисует зона. Поверх НАШИХ
// ножей (их номера — в зоне) — своё: вылет веером из острия минутной (точка
// «Тела») с вращением и следом, вспышка на месте, в ожидании блик бежит по
// клинку, проём кольца подсвечен коридором со стрелками наружу, перед
// пуском — дрожь, в полёте — след. Конец пути — контакт `f14b_lknife`.
interface KnifeTrack {
  x: number;
  y: number;
  vx: number;
  vy: number;
  fly: number;
  gone: number;
}
const knifeTracks = new Map<number, Map<number, KnifeTrack>>();

/** Когда рендер впервые увидел нож кольца (часы его вылета из руки). */
const lknifeBorn = new Map<number, number>();
const KNIFE_FLY = 0.24;
/** Ножи вылетают веером по кругу: задержка — по месту ножа в кольце. */
const knifeDelay = (id: number) =>
  (mod((KNIFE_ANG.get(id) ?? Math.PI) - Math.PI - 0.2, TAU) / TAU) * 0.3;
function knifeBornAt(id: number, time: number): number {
  let b = lknifeBorn.get(id);
  if (b === undefined || b > time) {
    b = time;
    lknifeBorn.set(id, b);
    if (lknifeBorn.size > 96) lknifeBorn.delete(lknifeBorn.keys().next().value as number);
  }
  return b;
}
/** Сколько нож уже на месте (< 0 — ещё летит из руки). */
const knifeSettled = (id: number, time: number) =>
  reduced() ? 1 : time - knifeBornAt(id, time) - knifeDelay(id) - KNIFE_FLY;

let blankSprite: Sprite | null = null;
registerShotPainter('f14b_lknife', (s, time) => {
  if (s.age < -1e5 && knifeSettled(s.id, time) < 0) {
    if (!blankSprite) {
      const c = document.createElement('canvas');
      c.width = 1;
      c.height = 1;
      blankSprite = { img: c, ax: 0, ay: 0 };
    }
    return blankSprite;
  }
  return SHOT_PAINTERS.get('f14_knife')?.(s, time) ?? null;
});

/** Нож в полёте из руки: клинок 9 px с остриём, поворот `a`. */
function knifeBlade(p: Pen, x: number, y: number, a: number, al: number): void {
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  p.col(C.ink, 0.5 * al);
  p.line(x - ux * 4 + 1, y - uy * 4 + 1, x + ux * 5 + 1, y + uy * 5 + 1);
  p.col(C.steel[2], al);
  p.line(x - ux * 4, y - uy * 4, x + ux * 4, y + uy * 4);
  p.col('#ffffff', al);
  p.dot(x + ux * 5, y + uy * 5);
  p.col(C.brass[3], al);
  p.dot(x - ux * 4, y - uy * 4);
}

registerZonePainter(
  'f14b_knives',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const zz = z as FxZone;
    const sim = paintSim();
    const ids = zz.ids ?? [];
    if (!sim || !ids.length) return;
    let tr = knifeTracks.get(zz.id);
    if (!tr) {
      tr = new Map();
      knifeTracks.set(zz.id, tr);
      if (knifeTracks.size > 8) knifeTracks.delete(knifeTracks.keys().next().value as number);
    }
    const p = new Pen(g, px, py, zz.x * S, zz.y * S);
    const ph = phaseNow();
    const glow = GLOW_HI[ph];
    const few = reduced();
    const stopped = worldStopped(sim);
    // Откуда летят: остриё минутной в первый кадр зоны.
    const [from] = contactPts(zz.id, lordNow(), ['minTip'], S);
    let hanging = 0;
    const slots = new Set<number>();
    const total = ph >= 3 ? LORD.knives + 6 : LORD.knives + 2;
    ids.forEach((id) => {
      const s = sim.shots.find((q) => q.id === id);
      let k = tr!.get(id);
      if (s) {
        if (!k) {
          k = { x: s.x, y: s.y, vx: 0, vy: 0, fly: 0, gone: 0 };
          tr!.set(id, k);
        }
        k.x = s.x;
        k.y = s.y;
        k.vx = s.vx;
        k.vy = s.vy;
        if (s.age > -1e5 && !k.fly) k.fly = time;
      } else if (k && !k.gone) k.gone = time;
      if (k && !k.fly && !k.gone) {
        hanging++;
        const a = (KNIFE_ANG.get(id) ?? 0) - Math.PI;
        slots.add(mod(Math.round(((a - 0.2) / TAU) * total), total));
      }
    });
    // Проём кольца — коридор через героя: пунктир краёв и стрелки наружу.
    if (hanging) {
      const half = total / 2;
      const cx = zz.x * S;
      const cy = zz.y * S;
      const R = (LORD.knifeR + 1.2) * S;
      const w = S * 0.5;
      const pulse = few ? 0.8 : 0.6 + 0.3 * Math.sin(time * 9);
      const born = k01((time - knifeBornAt(ids[0], time) - 0.3) / 0.2);
      g.save();
      clipBodies(g, p, S);
      for (let q = 0; q < half; q++) {
        if (slots.has(q) || slots.has(q + half)) continue;
        const a = (q / total) * TAU + 0.2;
        const ux = Math.cos(a);
        const uy = Math.sin(a);
        // Мир в остановке серый — коридор держится на яркости: светлая полоса
        // со сплошными краями и тенью (пунктир сливался с узором пола).
        p.col('#ffffff', 0.26 * born);
        fillLane(p, cx, cy, ux, uy, -R, R, w);
        for (const side of [-1, 1])
          p.lineS(
            cx - ux * R - uy * w * side,
            cy - uy * R + ux * w * side,
            cx + ux * R - uy * w * side,
            cy + uy * R + ux * w * side,
            '#ffffff',
            (0.55 + 0.45 * pulse) * born,
            0.8,
          );
        // Шевроны наружу у обоих концов: «сюда».
        for (const end of [-1, 1]) {
          const run = few ? 0.5 : mod(time * 1.4, 1);
          for (let j = 0; j < 2; j++) {
            const d = (LORD.knifeR - 0.4 + (j + run) * 0.6) * S * end;
            const bx = cx + ux * d;
            const by = cy + uy * d;
            const al = (1 - Math.abs(j + run - 1) * 0.6) * pulse * born;
            const fx = ux * end;
            const fy = uy * end;
            p.lineS(bx - fx * 3 - uy * 4, by - fy * 3 + ux * 4, bx, by, '#ffffff', 0.95 * al, 0.6);
            p.lineS(bx - fx * 3 + uy * 4, by - fy * 3 - ux * 4, bx, by, '#ffffff', 0.95 * al, 0.6);
          }
        }
      }
      g.restore();
    }
    ids.forEach((id) => {
      const k = tr!.get(id);
      if (!k || k.gone) return;
      const x = k.x * S;
      const y = k.y * S - 4;
      const ang = KNIFE_ANG.get(id) ?? Math.atan2(k.vy, k.vx);
      const ux = Math.cos(ang);
      const uy = Math.sin(ang);
      if (!k.fly) {
        const st = knifeSettled(id, time);
        if (st < 0) {
          // Вылет из руки: дуга вверх и вниз на место, вращается, тормозит.
          const t0 = st + KNIFE_FLY;
          if (t0 < 0 || !from) return;
          const pos = (u: number): [number, number] => {
            const mx = (from[0] + x) / 2;
            const my = Math.min(from[1], y) - 14;
            const v = 1 - u;
            return [
              v * v * from[0] + 2 * u * v * mx + u * u * x,
              v * v * from[1] + 2 * u * v * my + u * u * y,
            ];
          };
          const u = eOut2(t0 / KNIFE_FLY);
          for (let j = 4; j >= 1; j--) {
            const [tx, ty] = pos(Math.max(0, u - j * 0.07));
            p.col(j < 2 ? '#ffffff' : glow, 0.5 * (1 - j / 5));
            p.dot(tx, ty);
          }
          const [bx, by] = pos(u);
          knifeBlade(p, bx, by, ang + (1 - u) * TAU * 1.25, 1);
          return;
        }
        // На месте: вспышка, нож встаёт в воздухе.
        if (st < 0.22) {
          const kk = st / 0.22;
          p.col('#ffffff', 1 - kk);
          star(p, x, y, 8 * (1 - kk) + 2, 4, ang + Math.PI / 4);
          ring(p, x, y, 3 + 9 * eOut2(kk), glow, 0.8 * (1 - kk));
        }
        // Ждёт: блик бежит от рукояти к острию.
        const run = mod(st * 1.6, 1);
        if (run < 0.5) {
          const q = -6 + 14 * (run / 0.5);
          p.col('#ffffff', 0.9);
          p.dot(x + ux * q, y + uy * q);
        }
        // Время пошло — дрожит перед пуском: штрихи по бокам.
        if (!stopped && !few) {
          const j = Math.floor(time * 30) % 2 ? 1 : -1;
          p.col(glow, 0.8);
          p.line(
            x - uy * 4 * j - ux * 3,
            y + ux * 4 * j - uy * 3,
            x - uy * 4 * j + ux * 3,
            y + ux * 4 * j + uy * 3,
          );
          glint(p, x + ux * 8, y + uy * 8, 2, glow, 0.9);
        }
        return;
      }
      // Полёт: след — лента стали с белой нитью, тает к хвосту.
      const t = time - k.fly;
      const L = Math.min(S * 1.8, Math.hypot(k.vx, k.vy) * S * t);
      for (let s = 0; s < L; s += 1) {
        const q = s / Math.max(1, L);
        p.col(q < 0.3 ? '#ffffff' : q < 0.6 ? C.steel[3] : glow, (1 - q) * 0.85);
        p.dot(x - ux * (6 + s), y - uy * (6 + s));
        if (q < 0.5) {
          p.col(C.steel[2], (1 - q * 2) * 0.5);
          p.dot(x - ux * (6 + s) - uy, y - uy * (6 + s) + ux);
        }
      }
      if (t < 0.08) {
        p.col('#ffffff', 1 - t / 0.08);
        star(p, x - ux * 6, y - uy * 6, 5, 4, ang);
      }
    });
  }),
);

// Конец пути ножа кольца (контакт снаряда): о стену — звезда, искры назад и
// крошка; о героя — белая звезда и стальные искры насквозь; долетел — тает
// искрами времени. Тряска малая: ножей дюжина, тряска складывается.
const knifeHow = new WeakMap<ImpactRec, number>();
registerImpactPainter('f14b_lknife', {
  life: 0.45,
  shake: 0.02,
  above: true,
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const sim = paintSim();
    const x = rec.x * S;
    const y = rec.y * S - 4;
    const p = new Pen(g, px, py, rec.x * S, rec.y * S);
    const vx = rec.vx ?? 0;
    const vy = rec.vy ?? 0;
    const ahead = Math.hypot(vx, vy) > 0.1;
    const ang = ahead ? Math.atan2(vy, vx) : 0;
    const ux = Math.cos(ang);
    const uy = Math.sin(ang);
    let how = knifeHow.get(rec);
    if (how === undefined) {
      how = 3;
      if (sim) {
        const wx = Math.floor(rec.x + vx * 0.04);
        const wy = Math.floor(rec.y + vy * 0.04);
        const wall = sim.tiles[wy * sim.world.w + wx];
        how =
          Math.hypot(sim.hero.x - rec.x, sim.hero.y - rec.y) < 0.8
            ? 1
            : ahead && wall !== 2 && wall !== 12
              ? 2
              : 3;
      }
      knifeHow.set(rec, how);
    }
    const sdk = rec.seed % 9973;
    const few = reduced();
    const t = age;
    if (how === 2) {
      if (t < 0.1) {
        p.col('#ffffff', 1 - t / 0.1);
        star(p, x + ux * 6, y + uy * 6, 7, 4, ang + 0.4);
      }
      sparks(
        p,
        sdk,
        t,
        x + ux * 6,
        y + uy * 6,
        few ? 3 : 7,
        ang + Math.PI,
        0.9,
        40,
        50,
        0.35,
        40,
        steelSpark,
      );
      chips(
        p,
        sdk + 1,
        t,
        x + ux * 7,
        y + uy * 7,
        few ? 1 : 3,
        ang + Math.PI,
        0.8,
        14,
        14,
        30,
        30,
        [0.3, 0.45],
        0.1,
        4,
      );
    } else if (how === 1) {
      if (t < 0.1) {
        p.col('#ffffff', 1 - t / 0.1);
        star(p, x, y, 9, 6, ang);
      }
      sparks(p, sdk, t, x, y, few ? 3 : 8, ang, 0.6, 40, 50, 0.3, 30, steelSpark);
    } else
      for (let j = 0; j < 6; j++) {
        const a = hash(sdk, j, 3) * TAU;
        const d = 10 * eOut2(k01(t / 0.45));
        p.col(timeSpark(t / 0.45), 1 - t / 0.45);
        p.dot(x + Math.cos(a) * d, y + Math.sin(a) * d);
      }
  }),
});

// =============================================================================
// ОТМОТКА — песочные часы ритуала (`f14_glassring`, r 2,4, 5,5 с): на полу
// вокруг ступицы — стеклянный обод часов с бликом, бегущим НАЗАД; песок
// течёт к Повелителю по спирали против часовой (время идёт вспять); риски
// по ободу гаснут по одной против часовой — столько осталось до отмотки;
// последние 0,6 с обод разгорается. Порог (засечка на полосе) — трещины в
// стекле: чем больше снял, тем дальше бегут; вдвое — скалывается. Снял —
// `f14b_glassbreak` (стекло разлетается, песок взрывом); не успел —
// `f14b_rewound` (песок втягивается, стрелка обходит круг назад).
// =============================================================================

/** Доля снятого порога отмотки 0…1 (по засечке сценария). */
function ritualCut(sim: Sim | null): number {
  if (!sim) return 0;
  const m = sim.mobs.find((q) => q.kind === 'f14boss' && q.mode === 'f14_ritual');
  if (!m) return 0;
  const sc = BOSS_SCRIPTS.get('f14boss');
  const ns = sim.boss && sc?.notches ? sc.notches(sim, sim.boss) : [];
  if (ns.length <= LORD.hp.length) return 0;
  const notch = ns[ns.length - 1];
  return k01(1 - (m.hp / m.maxHp - notch) / LORD.need);
}

registerZonePainter(
  'f14_glassring',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const zz = z as FxZone;
    const sim = paintSim();
    const cx = zz.x * S;
    const cy = zz.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = zz.r * S;
    const t = zz.t;
    const life = zz.life > 0 && zz.life < 1e8 ? zz.life : LORD.ritual;
    const kk = k01(t / life);
    const left = life - t;
    const sd = seedOf(zz.id);
    const few = reduced();
    const clk = F14_FX.clock;
    const born = eOut2(k01(t / 0.35));
    const late = k01((0.6 - left) / 0.6);
    // Пол под стеклом: бирюзовая дымка, к отмотке гуще.
    p.col(C.teal[1], (0.18 + 0.12 * late) * born);
    fillSector(p, cx, cy, S * 0.9, R, 0, TAU);
    // Сколько осталось: сектор «песка» убывает против часовой.
    p.col(C.sand[2], 0.22 * born);
    sector(p, cx, cy, S * 0.9, R - 3, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - kk));
    // Песок течёт к центру по спирали против часовой (время вспять):
    // песчинка — короткий штрих по ходу, к центру ярче.
    const NS = few ? 16 : 40;
    const sandAt = (i: number, u: number): [number, number] => {
      const h2 = hash(sd, i, 62);
      const r = R * (1.05 - u * 0.8);
      const a = h2 * TAU - u * 2.8;
      return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
    };
    for (let i = 0; i < NS; i++) {
      const h1 = hash(sd, i, 61);
      const h2 = hash(sd, i, 62);
      const u = mod(h1 + clk * (0.45 + 0.3 * h2) * (1 + late), 1);
      const [x1, y1] = sandAt(i, u);
      const [x0, y0] = sandAt(i, Math.max(0, u - 0.05));
      p.col(i % 4 ? C.sand[3] : C.teal[4], (0.35 + 0.6 * u) * born);
      p.line(x0, y0, x1, y1);
    }
    // Обод — стекло: тёмная кромка снаружи, прозрачное тело, светлая кромка
    // изнутри; блик бежит назад (против часовой), второй — напротив.
    const ga = (0.85 + 0.15 * late) * born;
    p.col(late > 0 ? C.teal[4] : C.teal[2], (0.32 + 0.3 * late) * born);
    fillSector(p, cx, cy, R - 3, R + 1, 0, TAU);
    ring(p, cx, cy, R + 2, C.teal[0], 0.9 * born);
    ring(p, cx, cy, R + 1, C.teal[1], ga);
    ring(p, cx, cy, R - 3, C.teal[3], ga);
    const gl = -clk * 1.3;
    const near = (ang: number, c: number, w: number) =>
      Math.abs(mod(ang - c + Math.PI, TAU) - Math.PI) < w;
    for (const rr of [R - 2, R - 1, R])
      ring(p, cx, cy, rr, '#ffffff', 0.9 * born, (ang) => near(ang, gl, 0.2 + (rr - R + 2) * 0.05));
    ring(p, cx, cy, R - 1, '#ffffff', 0.55 * born, (ang) => near(ang, gl + Math.PI, 0.08));
    // Риски: гаснут по одной против часовой — сколько осталось.
    const on = Math.ceil((1 - kk) * 12 - 1e-6);
    for (let h = 0; h < 12; h++) {
      const a = -Math.PI / 2 - (h / 12) * TAU;
      // От XII против часовой: первой гаснет XII, за ней XI, X…
      const lit = h >= 12 - on;
      p.lineS(
        cx + Math.cos(a) * (R - 5),
        cy + Math.sin(a) * (R - 5),
        cx + Math.cos(a) * (R - 2),
        cy + Math.sin(a) * (R - 2),
        lit ? (late > 0 && Math.floor(time * 12) % 2 ? '#ffffff' : C.teal[4]) : C.teal[0],
        lit ? 0.95 * born : 0.5 * born,
        0.5,
      );
    }
    // Порог: трещины бегут ВДОЛЬ стеклянного обода — чем больше снял, тем
    // их больше и тем они длиннее; к концу обод в сетке, сыплются сколы.
    const cut = ritualCut(sim);
    if (cut > 0) {
      const cr = glassCracks(sd, R);
      for (let i = 0; i < cr.length; i++) {
        const grow = k01((cut - i * 0.13) / 0.4);
        if (grow <= 0) continue;
        const c = cr[i];
        p.col(C.teal[0], 0.85);
        for (let j = 0; j < c.x.length && c.s[j] <= grow; j++)
          p.dot(cx + c.x[j] + 1, cy + c.y[j] + 1);
        p.col('#ffffff', 1);
        for (let j = 0; j < c.x.length && c.s[j] <= grow; j++) p.dot(cx + c.x[j], cy + c.y[j]);
      }
      if (cut > 0.55) {
        const n = Math.floor((cut - 0.55) * 18);
        for (let i = 0; i < n; i++) {
          const a = hash(sd, i, 71) * TAU;
          const f = fly(mod(time * 0.9 + hash(sd, i, 73), 1) * 0.6, 20, 430);
          p.col(i % 2 ? '#ffffff' : C.teal[3], 0.9);
          p.dot(cx + Math.cos(a) * (R + 2 + f.h * 6), cy + Math.sin(a) * (R + 2) - f.z);
        }
      }
    }
  }),
);

/** Трещины стеклянного обода: дуги вдоль кольца с дрожью по радиусу и отростками. */
interface GlassCrack {
  x: Int16Array;
  y: Int16Array;
  s: Float32Array;
}
const glassCrackCache = new Map<string, GlassCrack[]>();
function glassCracks(seed: number, R: number): GlassCrack[] {
  const key = `${seed}|${Math.round(R)}`;
  let out = glassCrackCache.get(key);
  if (out) return out;
  out = [];
  for (let i = 0; i < 6; i++) {
    const a0 = (i / 6) * TAU + hash(seed, i, 81) * 0.8;
    const span = 0.6 + 0.5 * hash(seed, i, 82);
    const dir = hash(seed, i, 83) < 0.5 ? -1 : 1;
    const xs: number[] = [];
    const ys: number[] = [];
    const ss: number[] = [];
    let lx = 1e9;
    let ly = 1e9;
    const steps = Math.ceil((span * R) / 0.7);
    for (let k = 0; k <= steps; k++) {
      const u = k / steps;
      const a = a0 + dir * span * u;
      const rr =
        R -
        1 +
        1.6 * Math.sin(u * 9 + i) * hash(seed, i, 84) -
        (hash(seed, i * 31 + k, 85) < 0.15 ? 1 : 0);
      const x = Math.floor(Math.cos(a) * rr);
      const y = Math.floor(Math.sin(a) * rr);
      if (x !== lx || y !== ly) {
        xs.push(x);
        ys.push(y);
        ss.push(u);
        lx = x;
        ly = y;
      }
      // Отросток поперёк обода — 2–3 пикселя.
      if (k % 7 === 3 && hash(seed, i * 17 + k, 86) < 0.6) {
        const side = hash(seed, i * 19 + k, 87) < 0.5 ? -1 : 1;
        for (let q = 1; q <= 2 + (k % 2); q++) {
          xs.push(Math.floor(Math.cos(a) * (rr + side * q)));
          ys.push(Math.floor(Math.sin(a) * (rr + side * q)));
          ss.push(u + 0.02 * q);
        }
      }
    }
    const order = ss.map((s, j) => j).sort((p0, q0) => ss[p0] - ss[q0]);
    out.push({
      x: Int16Array.from(order.map((j) => xs[j])),
      y: Int16Array.from(order.map((j) => ys[j])),
      s: Float32Array.from(order.map((j) => ss[j])),
    });
  }
  if (glassCrackCache.size > 8)
    glassCrackCache.delete(glassCrackCache.keys().next().value as string);
  glassCrackCache.set(key, out);
  return out;
}

// Ритуал, слой ПОВЕРХ ТЕМНОТЫ (`f14b_ritualfx`, мозг ставит рядом с
// `f14_glassring`): песок течёт ВСПЯТЬ — с обода на полу струйками вверх по
// спирали против часовой прямо в песочные часы у него в руках (точка «Тела»);
// у колбы — венец, к отмотке чаще и ярче; снятый порог — по трещинам обода
// бегут блики. Ушёл из ритуала (разбили или отмотал) — гаснет сразу.
registerZonePainter(
  'f14b_ritualfx',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const zz = z as FxZone;
    const m = mobById(zz.mob);
    if (!m || m.mode !== 'f14_ritual') return;
    const sim = paintSim();
    const cx = zz.x * S;
    const cy = zz.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = zz.r * S;
    const t = zz.t;
    const life = zz.life > 0 ? zz.life : LORD.ritual;
    const left = life - t;
    const late = k01((0.6 - left) / 0.6);
    const born = eOut2(k01(t / 0.35));
    const sd = seedAt(zz.x, zz.y);
    const few = reduced();
    const [gx, gy] = lordPt(m, 'glass', S);
    // Струйки песка: с обода вверх в колбу, против часовой, к колбе быстрее.
    const NS = few ? 10 : 26;
    const speed = 0.55 * (1 + 1.5 * late);
    for (let i = 0; i < NS; i++) {
      const h1 = hash(sd, i, 91);
      const h2 = hash(sd, i, 92);
      const u = mod(h1 + time * speed * (0.7 + 0.5 * h2), 1);
      const pos = (q: number): [number, number] => {
        const a0 = h2 * TAU - q * 2.2;
        const rr = R * (1 - eIn2(q));
        const lift = 30 * Math.sin(q * Math.PI * 0.5) * q;
        const bx = cx + Math.cos(a0) * rr;
        const by = cy + Math.sin(a0) * rr * 0.9;
        return [bx + (gx - bx) * eIn2(q), by + (gy - by) * eIn2(q) - lift * (1 - q)];
      };
      const [x1, y1] = pos(u);
      const [x0, y0] = pos(Math.max(0, u - 0.06));
      p.col(i % 4 ? C.sand[3] : C.teal[4], (0.3 + 0.65 * u) * born * k01((1 - u) * 12));
      p.line(x0, y0, x1, y1);
    }
    // Венец у колбы (поверх самой колбы не рисуем — она в руках у «Тела»).
    const beat = few ? 0.5 : 0.5 + 0.5 * Math.sin(time * (6 + 10 * late));
    ring(p, gx, gy, 9 + beat, C.teal[4], (0.35 + 0.4 * late) * born, (_a, i) => (i >> 1) % 3 !== 2);
    ring(
      p,
      gx,
      gy,
      11 + beat,
      '#ffffff',
      (0.15 + 0.5 * late) * born * beat,
      (_a, i) => i % 4 === 0,
    );
    // Снятый порог: по трещинам обода бегут блики.
    const cut = ritualCut(sim);
    const ringZ = sim?.zones.find((q) => q.art === 'f14_glassring');
    if (cut > 0 && !few && ringZ) {
      const cr = glassCracks(seedOf(ringZ.id), R);
      g.save();
      clipBodies(g, p, S);
      for (let i = 0; i < cr.length; i++) {
        const grow = k01((cut - i * 0.13) / 0.4);
        if (grow <= 0) continue;
        const c = cr[i];
        const run = mod(time * 0.9 + i * 0.3, 1) * grow;
        p.col('#ffffff', 0.9);
        for (let j = 0; j < c.x.length; j++)
          if (Math.abs(c.s[j] - run) < 0.05) p.dot(cx + c.x[j], cy + c.y[j]);
      }
      g.restore();
    }
  }),
);

// Часы разбиты. Слой ПОЛА (`f14b_glassfloor`): осколки обода летят,
// вращаясь, падают, отскакивают и ЛОЖАТСЯ на пол; песок взрывом и оседает.
// Слой поверх темноты (`f14b_glassbreak`): вспышка у колбы в его руках (точка
// «Тела»), белый обод, бирюзовая волна, искры времени.
const glassAt =
  (sd: number, cx: number, cy: number, R: number): At =>
  (i) => {
    const a = hash(sd, i, 81) * TAU;
    return [cx + Math.cos(a) * R, cy + Math.sin(a) * R, a];
  };
registerZonePainter(
  'f14b_glassfloor',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number) => {
    const zz = z as FxZone;
    const t = zz.t;
    const cx = zz.x * S;
    const cy = zz.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = zz.r * S;
    const sd = seedAt(zz.x, zz.y);
    const few = reduced();
    const at = glassAt(sd, cx, cy, R);
    chips(
      p,
      sd,
      t,
      cx,
      cy,
      few ? 8 : 22,
      0,
      0.5,
      24,
      40,
      60,
      80,
      [1.3, 1.8],
      0.4,
      5,
      undefined,
      at,
    );
    dust(p, sd + 1, t, cx, cy, few ? 4 : 10, 0, 0.5, 18, 20, 2, 6, 6, 1.2, 5, 0.6, undefined, at);
  }),
);

registerZonePainter(
  'f14b_glassbreak',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number) => {
    const zz = z as FxZone;
    const t = zz.t;
    const cx = zz.x * S;
    const cy = zz.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = zz.r * S;
    const sd = seedAt(zz.x, zz.y);
    const few = reduced();
    const [tip] = contactPts(zz.id, lordNow(), ['glass'], S);
    const [gx, gy] = tip ?? [cx, cy - 24];
    g.save();
    clipBodies(g, p, S);
    if (t < 0.12) ring(p, cx, cy, R, '#ffffff', 1 - t / 0.12, undefined, 0.6);
    if (t < 0.5)
      ring(
        p,
        cx,
        cy,
        R + 30 * eOut2(t / 0.5),
        C.teal[4],
        0.85 * (1 - t / 0.5),
        (_a, i) => hash(i >> 2, sd, 7) > 0.2,
        0.5,
      );
    g.restore();
    if (t < 0.12) {
      const k = t / 0.12;
      p.col('#ffffff', 1 - k);
      star(p, gx, gy, 18 * (1 - k * 0.5), 8, 0.3);
    }
    // Осколки колбы из рук — брызгами стекла вверх и в стороны.
    sparks(p, sd + 3, t, gx, gy, few ? 3 : 8, -Math.PI / 2, 1.4, 30, 40, 0.45, 50, iceSpark);
    sparks(
      p,
      sd + 2,
      t,
      cx,
      cy,
      few ? 4 : 12,
      0,
      0.4,
      40,
      50,
      0.5,
      40,
      timeSpark,
      undefined,
      glassAt(sd, cx, cy, R),
    );
  }),
);

// Не успел: песок втягивается к нему, стрелка обходит круг назад, бирюзовая
// волна сходится.
registerZonePainter(
  'f14b_rewound',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number) => {
    const zz = z as FxZone;
    const t = zz.t;
    const cx = zz.x * S;
    const cy = zz.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = zz.r * S;
    const sd = seedOf(zz.id);
    const D = 1.0;
    if (t > D) return;
    const k = t / D;
    // Песок уходит в колбу у него в руках (точка «Тела»).
    const lord = lordNow();
    const [gx, gy] = lord ? lordPt(lord, 'glass', S) : [cx, cy - 20];
    g.save();
    clipBodies(g, p, S);
    // Волна сходится.
    ring(
      p,
      cx,
      cy,
      (R + 40) * (1 - eOut2(k01(t / 0.45))) + 4,
      C.teal[4],
      0.9 * (1 - k),
      undefined,
      0.5,
    );
    // Стрелка назад: полный круг против часовой за 0,5 с со следом.
    if (t < 0.6) {
      const kk = eInOut(t / 0.6);
      const a = -Math.PI / 2 - kk * TAU;
      p.col(C.teal[3], 0.4 * (1 - kk));
      sector(p, cx, cy, 4, R, a, a + 0.6);
      p.lineS(cx, cy, cx + Math.cos(a) * R, cy + Math.sin(a) * R, '#ffffff', 0.95, 0.5);
    }
    g.restore();
    // Песок втягивается в колбу.
    for (let i = 0; i < 26; i++) {
      const a = hash(sd, i, 5) * TAU;
      const r0 = R * (1 + 1.4 * hash(sd, i, 6));
      const u = eIn2(k01(t / (0.5 + 0.3 * hash(sd, i, 7))));
      const r = r0 * (1 - u);
      if (u >= 1) continue;
      const bx = cx + Math.cos(a - u * 1.5) * r;
      const by = cy + Math.sin(a - u * 1.5) * r;
      p.col(i % 3 ? C.sand[3] : C.teal[4], 0.9);
      p.dot(bx + (gx - bx) * u, by + (gy - by) * u);
    }
  }),
);

// =============================================================================
// ПОЛНОЧЬ — час бьёт раз в 3 с (`f14b_toll`: звон кругом от ступицы, гаснет
// лампа своего часа — дым и уголёк, цифра часа вспыхивает), на двенадцатом
// — удар по всей арене, кроме ступицы (`f14_midnight`, кольцо r 6,6, w 4,5,
// метка 2 с, поверх темноты). Метка: огромная минутная стрелка идёт от XII
// по кругу рывками по часам (двенадцать щелчков), за ней на пол ложится
// ночь (`f14b_night` — слой пола, под телами); ступица горит белым, к ней
// бегут шевроны «сюда»; пройденные часы на ободе загораются. Контакт —
// лунная волна от ступицы к краю, звёзды и искры, двенадцать трещин по
// часам (их держит `f14b_night`).
// =============================================================================

registerZonePainter(
  'f14b_toll',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number) => {
    const zz = z as FxZone;
    const sim = paintSim();
    const t = zz.t;
    const cx = zz.x * S;
    const cy = zz.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const sd = seedOf(zz.id);
    const n = Math.max(1, Math.min(12, zz.n ?? 1));
    const R = zz.r * S;
    const few = reduced();
    g.save();
    clipBodies(g, p, S);
    // Удар колокола в ступице: кольцо сжимается к ней и отскакивает — звон
    // идёт ОТ ступицы (там бьёт час).
    if (t < 0.18) {
      const k = t / 0.18;
      ring(p, cx, cy, S * 2 * (1 - 0.35 * Math.sin(k * Math.PI)), '#ffffff', 1 - k, undefined, 0.5);
    }
    // Звон: два кольца от ступицы к ободу.
    for (let w = 0; w < 2; w++) {
      const tt = t - w * 0.12;
      if (tt < 0 || tt > 1.1) continue;
      const k = tt / 1.1;
      ring(
        p,
        cx,
        cy,
        S * 2 + (R - S * 2) * eOut2(k),
        w ? C.moon[2] : C.moon[3],
        0.7 * (1 - k),
        (_a, i) => (i >> 1) % 4 !== 3,
        0.4,
      );
    }
    // Цифра часа на ободе вспыхивает.
    const ha = -Math.PI / 2 + (n / 12) * TAU;
    const nx = cx + Math.cos(ha) * S * 9.2;
    const ny = cy + Math.sin(ha) * S * 9.2;
    if (t < 0.6) {
      const k = t / 0.6;
      p.col('#ffffff', 1 - k);
      star(p, nx, ny, 9 * (1 - k * 0.5), 4, 0.4);
      ring(p, nx, ny, 4 + 10 * eOut2(k), C.moon[3], 0.8 * (1 - k));
    }
    g.restore();
    // Лампа своего часа гаснет: дым вверх и падающий уголёк.
    const st = sim ? f14State(sim) : null;
    const lamp = st?.lamps.find((l) => l.hour === n - 1);
    if (lamp) {
      const lx = lamp.x * S;
      const ly = lamp.y * S - 6;
      if (t < 0.15) {
        p.col(C.brass[4], 1 - t / 0.15);
        star(p, lx, ly, 6, 4, 0.3);
      }
      dust(p, sd, t, lx, ly, few ? 2 : 5, -Math.PI / 2, 0.5, 6, 8, 1.5, 4.5, 12, 1.6, 4, 0.75);
      sparks(p, sd + 1, t, lx, ly, few ? 1 : 3, Math.PI / 2, 1.2, 8, 10, 0.9, 10, brassSpark);
    }
  }),
);

/** Где ночь уже легла: угол от XII по часовой (рывки по часам), 0…2π. */
function nightOf(k: number, T: number): { flow: number; hand: number } {
  const e = Math.pow(k, 1.15);
  const eh = clickStep(e, 12, (x) => Math.pow(x, 1 / 1.15), k, T);
  return { flow: TAU * e, hand: TAU * Math.min(1.02, eh) };
}

registerZonePainter(
  'f14_midnight',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const st = z as Strike;
    const { k, left, T } = warnOf(st);
    const sig = left < SIG;
    const tk = !reduced() && tick(left);
    const cx = st.x * S;
    const cy = st.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const occ = occOf(S);
    const w = (st.w ?? 4.5) * S;
    const Rm = st.r * S;
    const ri = Rm - w;
    const ro = Rm + w;
    const top = -Math.PI / 2;
    const { hand } = nightOf(k, T);
    const born = k01(st.t / 0.12);
    // Всё это лежит на полу: стрелка, ступица, шевроны и часы на ободе —
    // под телами (стрелка накрывала самого Повелителя).
    clipBodies(g, p, S);
    // Ступица — спасение: белый круг дышит, «тик-тик» под конец.
    const pulse = 0.5 + 0.5 * Math.sin(time * 10);
    const hubC = sig ? (tk ? '#ffffff' : C.moon[3]) : '#ffffff';
    ring(p, cx, cy, ri, hubC, (0.75 + 0.25 * pulse) * born, undefined, 0.6, occ, cy + ri);
    ring(
      p,
      cx,
      cy,
      ri - 2,
      C.moon[3],
      (0.4 + 0.4 * pulse) * born,
      (_a, i) => (i >> 1) % 2 === 0,
      0,
      occ,
      cy + ri,
    );
    // Шевроны «сюда»: двенадцать лучей по часам, на каждом — два шеврона
    // бегут от обода к ступице (двойная галочка остриём к центру).
    for (let i = 0; i < 12; i++) {
      const a = top + (i / 12) * TAU + TAU / 24;
      for (let j = 0; j < 2; j++) {
        const u = mod(time * 0.8 + i * 0.083 + j * 0.5, 1);
        const r = ri + S * 0.5 + S * 4.5 * (1 - u);
        const cxp = cx + Math.cos(a) * r;
        const cyp = cy + Math.sin(a) * r;
        if (occ(cxp, cyp, cyp)) continue;
        const ux = Math.cos(a);
        const uy = Math.sin(a);
        const nx = -uy;
        const ny = ux;
        const al = k01(u * 3) * (1 - k01((u - 0.85) / 0.15) * 0.6) * born;
        for (const d of [0, 3]) {
          const tx = cxp - ux * d;
          const ty = cyp - uy * d;
          const c = d ? C.moon[3] : '#ffffff';
          p.lineS(tx + nx * 4 + ux * 4, ty + ny * 4 + uy * 4, tx, ty, c, al, 0.7, C.inkN);
          p.lineS(tx - nx * 4 + ux * 4, ty - ny * 4 + uy * 4, tx, ty, c, al, 0.7, C.inkN);
        }
      }
    }
    // Обод арены — край удара; часы на нём горят за стрелкой.
    ring(
      p,
      cx,
      cy,
      ro - 2,
      sig ? '#ffffff' : '#ff5a5a',
      (0.5 + 0.4 * k) * born,
      (_a, i) => (i >> 1) % 3 !== 2,
      0.5,
      occ,
      cy + ro,
    );
    for (let h = 0; h < 12; h++) {
      const a = top + (h / 12) * TAU;
      const lit = (h === 0 ? TAU : (h / 12) * TAU) <= hand + 1e-3;
      const x0 = cx + Math.cos(a) * (ro - 10);
      const y0 = cy + Math.sin(a) * (ro - 10);
      const x1 = cx + Math.cos(a) * (ro - 3);
      const y1 = cy + Math.sin(a) * (ro - 3);
      if (occ(x1, y1, y1)) continue;
      p.lineS(
        x0,
        y0,
        x1,
        y1,
        lit ? (sig ? '#ffffff' : C.moon[3]) : '#5a3a6a',
        (lit ? 1 : 0.7) * born,
        0.6,
        C.inkN,
      );
    }
    // Стрелка полуночи — призрачный багровый клинок от ступицы к ободу,
    // щёлкает по часам. Не серебро: серебряные стрелки арены метут пол
    // рядом, и белая стрелка таймера с ними путалась.
    const ha = top + hand;
    const ux = Math.cos(ha);
    const uy = Math.sin(ha);
    p.col(C.inkN, 0.4 * born);
    fillPoly(p, handPts(cx + 3, cy + 4, ha, ri - 4, ro - 4, 4.5, true));
    p.col(sig ? '#ff8a9a' : '#c8243a', 0.7 * born);
    fillPoly(p, handPts(cx, cy, ha, ri - 4, ro - 4, 4, true));
    p.col(sig && tk ? '#ffffff' : '#ff5a6a', born);
    p.line(cx + ux * ri, cy + uy * ri, cx + ux * (ro - 6), cy + uy * (ro - 6));
    glint(p, cx + ux * (ro - 5), cy + uy * (ro - 5), 3, '#ff8a9a', born);
  }),
);

// Ночь на полу: сектор от XII за стрелкой (течёт плавно), под телами; после
// удара — двенадцать трещин по часам от ступицы и иней звёзд, тают.
registerZonePainter(
  'f14b_night',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number) => {
    const zz = z as FxZone;
    const t = zz.t;
    const T = LORD.midnightWarn;
    const cx = zz.x * S;
    const cy = zz.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const sd = seedOf(zz.id);
    const ri = S * 2.1;
    const ro = zz.r * S;
    const top = -Math.PI / 2;
    const k = k01(t / T);
    const { flow } = nightOf(k, T);
    if (t < T) {
      const sig = T - t < SIG;
      // За стрелкой — кровавая ночь (тёмная ночь на тёмном полу не читалась),
      // впереди — багровая дымка: «сюда тоже ударит». Кромка — у стрелки.
      p.col('#2a0418', sig && tick(T - t) ? 0.7 : 0.52);
      sector(p, cx, cy, ri, ro, top, top + flow);
      p.col('#4a0a2a', 0.2);
      sector(p, cx, cy, ri, ro, top + flow, top + TAU);
      const ea = top + flow;
      p.lineS(
        cx + Math.cos(ea) * ri,
        cy + Math.sin(ea) * ri,
        cx + Math.cos(ea) * ro,
        cy + Math.sin(ea) * ro,
        '#ff3a48',
        0.8,
        0.6,
        C.inkN,
      );
      return;
    }
    const age = t - T;
    const fade = 1 - k01((age - 0.5) / 0.5);
    p.col(C.night, 0.55 * (1 - k01(age / 0.25)));
    fillSector(p, cx, cy, ri, ro, 0, TAU);
    // Двенадцать трещин по часам: эмаль раскалывается по часовым линиям —
    // почти прямые, тонкие, с редкими короткими отростками.
    for (let h = 0; h < 12; h++) {
      const a = top + (h / 12) * TAU;
      const ck = crackOf(`night|${h}`, 97 + h, [[a, ro - ri - 10, 1]], 0.14, 0.14, 0.25);
      drawCrack(
        p,
        ck,
        cx + Math.cos(a) * (ri + 2),
        cy + Math.sin(a) * (ri + 2),
        ck.max * eOut3(k01(age / 0.22)),
        age < 0.15 ? '#ffffff' : C.moon[2],
        C.inkN,
        fade,
      );
    }
    // Иней звёзд по полу.
    motes(
      p,
      sd,
      40,
      (_i, h1, h2) => {
        const r = ri + (ro - ri) * h1;
        const a = h2 * TAU;
        return [
          cx + Math.cos(a) * r,
          cy + Math.sin(a) * r,
          fade * (0.4 + 0.6 * hash(sd, Math.floor(age * 8), _i)),
        ];
      },
      (i) => (i % 3 ? C.moon[3] : '#ffffff'),
    );
  }),
);

registerImpactPainter('f14_midnight', {
  life: 1.6,
  shake: 0.5,
  flash: 0.5,
  flashRgb: '200,216,255',
  above: true,
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const cx = rec.x * S;
    const cy = rec.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const sd = rec.seed >>> 0;
    const few = reduced();
    const w = (rec.w ?? 4.5) * S;
    const Rm = (rec.r ?? 6.6) * S;
    const ri = Rm - w;
    const ro = Rm + w;
    // Лунная волна от ступицы к ободу: белый фронт, лиловый хвост — по полу,
    // за телами.
    g.save();
    clipBodies(g, p, S);
    if (age < 0.5) {
      const k = age / 0.5;
      const r = ri + (ro - ri) * eOut2(k);
      ring(p, cx, cy, r, '#ffffff', 1 - k, undefined, 0.6);
      ring(p, cx, cy, r - 3, C.moon[3], 0.8 * (1 - k));
      ring(p, cx, cy, r - 7, C.violet[2], 0.6 * (1 - k), (_a, i) => (i >> 1) % 2 === 0);
    }
    // Ступица уцелела: белое кольцо держит.
    if (age < 0.3) ring(p, cx, cy, ri, '#ffffff', 1 - age / 0.3, undefined, 0.5);
    g.restore();
    // Звёзды по всей арене: вспыхивают, гаснут.
    const NS = few ? 10 : 30;
    for (let i = 0; i < NS; i++) {
      const r = ri + (ro - ri) * hash(sd, i, 1);
      const a = hash(sd, i, 2) * TAU;
      const t0 = ((r - ri) / (ro - ri)) * 0.4;
      const t = age - t0;
      if (t < 0 || t > 0.5) continue;
      const k = t / 0.5;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      p.col(moonSpark(k), 1 - k);
      star(p, x, y, 5 * (1 - k) + 1, 4, a);
    }
    // Искры вверх по ободу.
    sparks(
      p,
      sd + 5,
      age,
      cx,
      cy,
      few ? 6 : 18,
      0,
      Math.PI,
      30,
      40,
      0.6,
      70,
      moonSpark,
      (i) => 0.25 + (i % 6) * 0.03,
      (i) => {
        const a = hash(sd, i, 9) * TAU;
        return [cx + Math.cos(a) * ro * 0.9, cy + Math.sin(a) * ro * 0.9, a];
      },
    );
  }),
});

// =============================================================================
// Движение и сцены: шаги тикают, смена фазы — волна по арене, пробуждение —
// часы на ободе зажигаются по кругу.
// =============================================================================

// Шаг: под подолом — тонкое кольцо, как тик часов (тик крупнее, так мельче),
// пара песчинок подскакивает, из-под подола — клуб пыли назад. Ступни
// чередуются: кольцо смещено вбок от хода (`ang` — куда шёл), левой — правой.
registerZonePainter(
  'f14b_step',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number) => {
    const zz = z as FxZone;
    const t = zz.t;
    const D = 0.45;
    if (t > D) return;
    const cx = zz.x * S;
    const cy = zz.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const k = t / D;
    const big = (zz.n ?? 0) === 1;
    const ph = phaseNow();
    const a0 = zz.ang;
    const side = big ? 1 : -1;
    const fx = a0 === undefined ? cx : cx - Math.sin(a0) * 4 * side;
    const fy = a0 === undefined ? cy : cy + Math.cos(a0) * 2 * side;
    p.col(GLOW[ph], 0.55 * (1 - k));
    const rx = (big ? 6 : 4) + (big ? 9 : 6) * eOut2(k);
    // Овал (вид сверху в три четверти): по пикселям кольца, сжатого по y.
    const pts = circle(rx);
    for (let i = 0; i < pts.x.length; i += 1) {
      if ((i >> 1) % 3 === 2) continue;
      p.dot(fx + pts.x[i], fy + pts.y[i] * 0.45);
    }
    const sd = seedOf(zz.id);
    for (let i = 0; i < 2; i++) {
      const f = fly(t, 30 + 20 * hash(sd, i, 1), 430);
      const a = (hash(sd, i, 2) - 0.5) * 2.4 + (i ? 0 : Math.PI);
      p.col(GLOW_HI[ph], 0.8 * (1 - k));
      p.dot(fx + Math.cos(a) * 6 * f.h * 8, fy - f.z);
    }
    if (a0 !== undefined && !reduced())
      dust(p, sd + 3, t, fx, fy, 2, a0 + Math.PI, 0.7, 10, 8, 1.5, 3.5, 3, 0.45, dustPal(), 0.45);
  }),
);

// Смена фазы: от Повелителя по арене бежит волна цвета новой фазы; за ней —
// искры, пол уже другой (арена перекрашена мозгом).
registerZonePainter(
  'f14b_phase',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number) => {
    const zz = z as FxZone;
    const t = zz.t;
    const cx = zz.x * S;
    const cy = zz.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const n = Math.max(0, Math.min(3, zz.n ?? 1));
    const sd = seedOf(zz.id);
    const D = 0.8;
    // Волна — по полу, за телами.
    g.save();
    clipBodies(g, p, S);
    if (t < D) {
      const k = t / D;
      const r = S * 1 + S * 12 * eOut2(k);
      ring(p, cx, cy, r, '#ffffff', 0.9 * (1 - k), undefined, 0.6);
      ring(p, cx, cy, r - 4, GLOW[n], 0.8 * (1 - k), (_a, i) => (i >> 1) % 3 !== 2);
      ring(p, cx, cy, r - 9, GLOW[n], 0.4 * (1 - k), (_a, i) => (i >> 2) % 2 === 0);
    }
    g.restore();
    // Волна рождается у его лица (точка «Тела»): венец вспыхивает и уходит.
    const lord = lordNow();
    if (lord && t < 0.35) {
      const [fx, fy] = lordPt(lord, 'face', S);
      const k = t / 0.35;
      ring(p, fx, fy, 13 + 10 * eOut2(k), '#ffffff', 1 - k, undefined, 0.5);
      ring(p, fx, fy, 11 + 6 * eOut2(k), GLOW[n], 0.8 * (1 - k));
    }
    motes(
      p,
      sd,
      reduced() ? 12 : 36,
      (i, h1, h2) => {
        const r = S * (1.5 + 10 * h1);
        const t0 = (r / (S * 13)) * D;
        const tt = t - t0;
        if (tt < 0 || tt > 0.7) return null;
        const a = h2 * TAU;
        return [cx + Math.cos(a) * r, cy + Math.sin(a) * r - 18 * eOut2(tt / 0.7), 1 - tt / 0.7];
      },
      (i) => (i % 3 ? GLOW[n] : '#ffffff'),
    );
  }),
);

// Пробуждение: двенадцать часов на ободе арены зажигаются по кругу от XII —
// циферблат «просыпается» вместе с ним.
registerZonePainter(
  'f14b_wake',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number) => {
    const zz = z as FxZone;
    const t = zz.t;
    const cx = zz.x * S;
    const cy = zz.y * S;
    const p = new Pen(g, px, py, cx, cy);
    // Рядом с ним (видно на любом экране): часы заводятся — двенадцать рисок
    // вокруг загораются по часовой с ускорением, на двенадцатой — вспышка.
    const sim = paintSim();
    const m = sim?.mobs.find((q) => q.kind === 'f14boss');
    if (m && t < 2.4) {
      // Циферблат заводится у его лица: венец наливается к вспышке.
      const [fx, fy] = lordPt(m, 'face', S);
      const kf = k01(t / 1.5);
      if (t < 1.9)
        ring(
          p,
          fx,
          fy,
          12,
          C.brass[4],
          0.25 + 0.6 * kf * (1 - k01((t - 1.5) / 0.4)),
          (_a, i) => i / circle(12).x.length <= kf,
        );
      g.save();
      clipBodies(g, p, S);
      const mx = m.x * S;
      const my = m.y * S;
      const Rn = S * 2.4;
      const lit = Math.min(12, Math.floor(12 * Math.pow(k01(t / 1.5), 1.6) + 1e-6));
      const out = 1 - k01((t - 1.8) / 0.6);
      for (let h = 0; h < 12; h++) {
        const a = -Math.PI / 2 + (h / 12) * TAU;
        const L = h % 3 ? 3 : 6;
        const on = h < lit;
        p.lineS(
          mx + Math.cos(a) * (Rn - L),
          my + Math.sin(a) * (Rn - L),
          mx + Math.cos(a) * Rn,
          my + Math.sin(a) * Rn,
          on ? C.brass[4] : C.brass[1],
          (on ? 0.95 : 0.4) * out,
          0.6,
        );
      }
      const tf = t - 1.5;
      if (tf >= 0 && tf < 0.4) {
        ring(
          p,
          mx,
          my,
          Rn + 2 + 20 * eOut2(tf / 0.4),
          '#ffffff',
          0.85 * (1 - tf / 0.4),
          undefined,
          0.5,
        );
        ring(p, mx, my, Rn + 20 * eOut2(tf / 0.4), C.brass[3], 0.7 * (1 - tf / 0.4));
      }
      g.restore();
    }
    const R = S * 9.2;
    for (let h = 0; h < 12; h++) {
      const t0 = 0.15 + h * 0.1;
      const tt = t - t0;
      if (tt < 0) continue;
      const a = -Math.PI / 2 + (h / 12) * TAU;
      const x = cx + Math.cos(a) * R;
      const y = cy + Math.sin(a) * R;
      const k = k01(tt / 0.5);
      const out = 1 - k01((t - 1.9) / 0.5);
      if (tt < 0.5) {
        p.col('#ffffff', 1 - k);
        star(p, x, y, 8 * (1 - k * 0.6), 4, 0.3);
      }
      glint(p, x, y, 2, C.brass[4], 0.8 * out);
    }
  }),
);

// =============================================================================
// Прогрев (движок тратит до 3 мс за кадр, пока Повелитель в мире): кольца
// всех радиусов, что разбегаются по арене (волна, звон, затвор остановки), —
// иначе расходящееся кольцо считало новую окружность в каждом кадре; клубы
// пыли и сколы всех фаз; двенадцать трещин полуночи.
// =============================================================================

registerMobWarm('f14boss', function* () {
  // Шаг прогрева — меньше 3 мс даже на слабом телефоне: большие окружности
  // по одной, спрайты — по радиусу и размеру.
  for (let r = 1; r <= 240; r++) {
    circle(r);
    if (r > 100 || r % 4 === 0) yield;
  }
  for (let pal = 0; pal < PUFF_PAL.length; pal++)
    for (let r = 1; r <= 8; r++) {
      for (let v = 0; v < 4; v++) puffImg(pal, r, v);
      yield;
    }
  for (let pal = 0; pal < CHIP_PAL.length; pal++)
    for (let sz = 1; sz <= 4; sz++) {
      for (let f = 0; f < 4; f++) chipImg(sz, f, pal);
      yield;
    }
  const top = -Math.PI / 2;
  const len = 11.1 * 16 - 2.1 * 16 - 10;
  for (let h = 0; h < 12; h++) {
    crackOf(`night|${h}`, 97 + h, [[top + (h / 12) * TAU, len, 1]], 0.14, 0.14, 0.25);
    yield;
  }
});
