// Этаж 3, босс «Алая пасть» — техники (v2.85): всё, что пасть делает с
// миром вокруг себя. Рисунок самого тела — в `f3-art.ts` (другой агент);
// здесь — пол, вода и воздух:
//   • метки ударов (`registerZonePainter`): «куда» видно с первого кадра,
//     «когда» — таймер наливается ровно к урону, последние 0,2 с — тревога
//     (горячий край, смыкание зубов, вал срывается с места);
//   • контакт каждого удара (`registerImpactPainter`): стенка воды, брызги,
//     грязь и волна с настоящей баллистикой, тряска по силе удара;
//   • плевок — крутящийся сгусток с хвостом капель, контакт — лужа;
//   • прилив — пена по наступающей кромке, отлив при смерти;
//   • брызги нырков и всплытий, кильватер, мокрый след и капли с тела в
//     прыжке — зонами без урона и статусов из мозга (`f3-brains.ts`, правки
//     помечены «v2.85 — только рисунок»).
//
// Правила файла:
//   • всё рисуется пикселями в одну игровую точку, прижатыми к сетке от
//     центра удара, а центр — к точке экрана (как рендер ставит мобов):
//     без дрожи на пиксель и без размытых пятен;
//   • частица — функция времени (`fly`), разброс — от зерна удара: кадр не
//     хранит состояния и одинаков при любом шаге рендера (и в стоп-кадре);
//   • одиночные светлые точки на тёмном читаются звёздным небом (урок
//     клеток этажа) — пена лежит полосками и комками, а не крапом;
//   • брызги живут в мире: стенка воды встаёт кольцом, рвётся на струи и
//     капли, капля летит по параболе, шлёпается и оставляет мокрую точку,
//     которая сохнет; комок грязи отскакивает и ложится; волна бьёт в край,
//     ломается и откатывается в озеро.
import { Px } from '../dungeon-art';
import {
  frameLRU,
  paintSim,
  registerImpactPainter,
  registerShotPainter,
  registerZonePainter,
} from '../dungeon-paint';
import type { ImpactRec, Sprite } from '../dungeon-paint';
import type { Shot, Strike, Zone } from '../dungeon-sim';
import { Tile } from '../dungeon-world';
import type { F3Zone } from './f3-brains';

// ---------------------------------------------------------------------------
// Палитра: вода этажа (бирюза и пена), мокрый песок, алое пасти.
// ---------------------------------------------------------------------------

const FOAM = '#e8fffb';
const FOAM2 = '#a6ece2';
const GLINT = '#ffffff';
const TEAL = '#3e8c90';
const TEAL_D = '#1a5660';
const DEEP = '#0f3a44';
const WET = '#0a1c22';
const MUD = '#121719';
const MUD2 = '#262e2e';
const MUD3 = '#7c887f';
const DUST = '#8a948c';
const RED = '#ff4a3a';
const RED_D = '#a2202a';
const BLOOD = '#6a1622';
const HOT = '#fff2e4';
const TOOTH = '#f6eedc';

type RGBA = [number, number, number, number];
const rgb = (h: string, a = 255): RGBA => {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255, a];
};

// ---------------------------------------------------------------------------
// Общее: случайность из зерна, пиксельная кисть, полёт частицы.
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const outCubic = (t: number) => 1 - (1 - clamp01(t)) ** 3;
const inQuad = (t: number) => clamp01(t) ** 2;
/** Тяжесть брызг, игровых пикселей в секунду². */
const G = 520;
/** Последние 0,2 с перед уроном — метка кричит. */
const ALARM = 0.2;

/** Случайное 0…1 из зерна: номер частицы `i`, свойство `k`. Один удар — один рисунок. */
function rnd(seed: number, i: number, k: number): number {
  let h = (seed ^ Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(k + 11, 0x85ebca77)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** Гладкий шум 0…1 по одной оси с периодом `per` (кольцо без шва) — рваный край без «кипения». */
function vn(seed: number, v: number, per = 1 << 20): number {
  const i = Math.floor(v);
  const f = v - i;
  const s = f * f * (3 - 2 * f);
  const a = ((i % per) + per) % per;
  return rnd(seed, a, 3) * (1 - s) + rnd(seed, (a + 1) % per, 3) * s;
}

/**
 * Зерно по месту: контакт приземления (рендер) и ближняя половина брызг
 * (зона мозга) рождаются в одной точке — и рисуют один и тот же набор капель.
 */
const posSeed = (x: number, y: number, k: number) =>
  (Math.imul(Math.round(x * 32), 73856093) ^
    Math.imul(Math.round(y * 32), 19349663) ^
    Math.imul(k + 1, 83492791)) >>>
  0;

/** Кисть: точки в игровой пиксель от центра, центр — в точке экрана. */
class Brush {
  readonly g: CanvasRenderingContext2D;
  readonly ox: number;
  readonly oy: number;
  constructor(g: CanvasRenderingContext2D, px: number, py: number) {
    this.g = g;
    // Рендер масштабирует канву целым множителем: прижимаем к его точке.
    const s = g.getTransform().a || 1;
    this.ox = Math.round(px * s) / s;
    this.oy = Math.round(py * s) / s;
  }
  private lastC = '';
  ink(c: string, a = 1): void {
    // Смена кисти — разбор строки цвета: пропускаем, если цвет тот же.
    if (c !== this.lastC) {
      this.g.fillStyle = c;
      this.lastC = c;
    }
    this.g.globalAlpha = a <= 0 ? 0 : a >= 1 ? 1 : a;
  }
  /**
   * Рваное кольцо: дуги с разрывами по шуму (рябь, пена, борозда) — не
   * «прицел» из ровных кругов. `keep` — доля, что остаётся; `w` — толщина.
   */
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
    if (r < 1) return;
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
  dot(x: number, y: number, w = 1, h = 1): void {
    this.g.fillRect(this.ox + Math.round(x), this.oy + Math.round(y), w, h);
  }
  /** Кольцо точками, без сглаживания: эллипс r × r·sy, дуга a0…a1, пунктир. */
  ring(cx: number, cy: number, r: number, sy = 1, a0 = 0, a1 = TAU, dash = 0, phase = 0): void {
    if (r < 0.75) {
      this.dot(cx, cy);
      return;
    }
    const span = a1 - a0;
    const n = Math.max(6, Math.ceil(Math.abs(span) * r * 1.25));
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
  /** Отрезок точками. */
  line(x0: number, y0: number, x1: number, y1: number): void {
    const n = Math.max(
      Math.abs(Math.round(x1) - Math.round(x0)),
      Math.abs(Math.round(y1) - Math.round(y0)),
      1,
    );
    for (let i = 0; i <= n; i++) this.dot(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n);
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
  /** Сектор (или кольцевой сектор) заливкой пути — площадь удара. */
  sector(r0: number, r1: number, a: number, half: number): void {
    const g = this.g;
    g.beginPath();
    g.arc(this.ox, this.oy, r1, a - half, a + half);
    if (r0 > 0) g.arc(this.ox, this.oy, r0, a + half, a - half, true);
    else g.lineTo(this.ox, this.oy);
    g.closePath();
    g.fill();
  }
  /** Дуга штрихом (толстая полоса, пунктир — `dash`). */
  arc(r: number, a0: number, a1: number, width: number, col: string, a: number, dash = 0): void {
    const g = this.g;
    g.globalAlpha = a <= 0 ? 0 : a >= 1 ? 1 : a;
    g.strokeStyle = col;
    g.lineWidth = width;
    if (dash) g.setLineDash([dash, dash * 0.7]);
    g.beginPath();
    g.arc(this.ox, this.oy, Math.max(0.5, r), a0, a1);
    g.stroke();
    if (dash) g.setLineDash([]);
  }
}

/** Где частица: координаты по полу, высота, скорость, сколько лежит. */
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
 * Полёт по параболе от (x0, y0, z0) со скоростью (vx, vy, vz), тяжесть `gz`.
 * `hop` > 0 — комок: отскакивает на долю скорости удара и скользит до
 * остановки; иначе капля — ложится, где упала.
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
    // Скользит с трением: скорость гаснет экспонентой.
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
 * Капля: в полёте — точка и хвост по скорости (как искры меча); легла на
 * песок — шлепок и мокрая точка, которая сохнет; упала в воду — кружок.
 */
function drop(b: Brush, p: Bit, head: string, a: number, water: boolean, size = 1): void {
  if (p.t < 0) {
    const sx = p.x;
    const sy = p.y - p.z;
    const vx = p.vx;
    const vy = p.vy - p.vz;
    const sp = Math.abs(vx) + Math.abs(vy);
    if (sp > 50) {
      b.ink(TEAL, a * 0.7);
      b.dot(sx - vx * 0.026, sy - vy * 0.026);
    }
    if (sp > 140) {
      b.ink(TEAL_D, a * 0.5);
      b.dot(sx - vx * 0.052, sy - vy * 0.052);
    }
    b.ink(head, a);
    b.dot(sx, sy, size, size);
    return;
  }
  const u = p.t;
  if (water) {
    if (u < 0.32) {
      b.ink(FOAM2, a * 0.75 * (1 - u / 0.32));
      b.ring(p.x, p.y, 1 + u * 10, 0.6);
    }
    return;
  }
  if (u < 0.07) {
    b.ink(head, a);
    b.dot(p.x - 1, p.y, 3, 1);
  } else if (u < 0.6) {
    b.ink(WET, a * 0.7 * (1 - u / 0.6));
    b.dot(p.x - (size > 1 ? 1 : 0), p.y, size + 1, 1);
  }
}

/** Комок грязи: тень под ним, пока летит; светлая макушка; лёг — лежит. */
function clod(b: Brush, p: Bit, col: string, a: number, size: number): void {
  if (p.z > 1.5) {
    b.ink('#000000', 0.3 * a);
    b.dot(p.x, p.y + 1, size, 1);
  }
  b.ink(col, a);
  b.dot(p.x, p.y - p.z, size, size);
  // Мокрый блик сверху-слева — комок читается на тёмном песке.
  b.ink(MUD3, a * (size > 1 ? 1 : 0.6));
  b.dot(p.x, p.y - p.z, 1, 1);
}

/** Вода ли под точкой сейчас (с приливом): капля упадёт кружком, а не пятном. */
function waterAt(x: number, y: number): boolean {
  const sim = paintSim();
  if (!sim) return false;
  const w = sim.world;
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  if (cx < 0 || cy < 0 || cx >= w.w || cy >= w.h) return false;
  return sim.tiles[cy * w.w + cx] === Tile.Deep;
}

// ---------------------------------------------------------------------------
// Стенка воды кольцом — корона всплеска: общая для приземления, нырка и
// взлёта. Встаёт за `rise`, раскрывается от `r0` до `r1` и опадает за
// `fall`; верх — зубцами по шуму, наклонён наружу; к концу стенка рвётся на
// струи (сперва тонкие места), а с зубцов срываются капли (`tips`).
// ---------------------------------------------------------------------------

interface SheetOpts {
  r0: number;
  r1: number;
  /** Высота стенки, пиксели. */
  h: number;
  rise: number;
  fall: number;
}

const sheetH = (o: SheetOpts, t: number) =>
  o.h * (t < o.rise ? outCubic(t / o.rise) : 1 - inQuad((t - o.rise) / o.fall));
const sheetR = (o: SheetOpts, t: number) => o.r0 + (o.r1 - o.r0) * outCubic(t / (o.rise + o.fall));

/** `front`: true — ближняя половина (поверх тела), false — дальняя, null — вся. */
function sheet(b: Brush, seed: number, age: number, front: boolean | null, o: SheetOpts): void {
  if (age >= o.rise + o.fall || age < 0) return;
  const H = sheetH(o, age);
  const rc = sheetR(o, age);
  // Рвётся с середины подъёма: сперва тонкие места, к концу — отдельные струи.
  const tear = 0.1 + clamp01((age - o.rise * 0.6) / o.fall) * 1.0;
  const n = Math.max(12, Math.ceil(TAU * rc));
  // Вода, а не лёд: стенка светлая и сквозная, темнее только у земли; верх
  // раскрыт наружу. Проходы — по цвету: низ, середина, пена, блики.
  for (let pass = 0; pass < 4; pass++) {
    if (pass === 0) b.ink(TEAL, 0.55);
    else if (pass === 1) b.ink(FOAM2, 0.55);
    else if (pass === 2) b.ink(FOAM, 0.95);
    else b.ink(GLINT, 1);
    let lx = 1e9;
    let ly = 1e9;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const s = Math.sin(a);
      if (front !== null && s >= 0 !== front) continue;
      const q = vn(seed, (i / n) * 18, 18);
      if (q < tear) continue;
      const h = Math.round(H * (0.3 + 0.85 * q));
      if (h < 1) continue;
      const c = Math.cos(a);
      const x = Math.round(c * rc);
      const y = Math.round(s * rc);
      if (x === lx && y === ly) continue;
      lx = x;
      ly = y;
      const lean = c * h * 0.5;
      const hb = Math.max(1, Math.round(h * 0.35));
      // Столбики в две точки шириной внахлёст — плёнка, а не частокол.
      if (pass === 0) b.dot(x, y - hb + 1, 2, hb);
      else if (pass === 1) {
        if (h - hb > 1) b.dot(x + lean * 0.5, y - h + 2, 2, h - hb - 1);
      } else if ((pass === 3) === q > 0.82) b.dot(x + lean, y - h, 2, 2);
    }
  }
}

/** Капли, сорвавшиеся с зубцов стенки: наружу по параболе. */
function tips(
  b: Brush,
  seed: number,
  age: number,
  front: boolean | null,
  o: SheetOpts,
  n: number,
  sp0: number,
  sp1: number,
  water: boolean,
): void {
  for (let i = 0; i < n; i++) {
    const a = ((i + rnd(seed, i, 5)) / n) * TAU;
    const c = Math.cos(a);
    const s = Math.sin(a);
    if (front !== null && s >= 0 !== front) continue;
    const tl = o.rise * 0.5 + rnd(seed, i, 6) * o.fall * 0.7;
    const t = age - tl;
    if (t < 0) continue;
    const rc = sheetR(o, tl);
    const sp = sp0 + rnd(seed, i, 7) * (sp1 - sp0);
    const z0 = sheetH(o, tl) * (0.75 + 0.45 * rnd(seed, i, 8));
    fly(BIT, c * rc, s * rc, z0, c * sp, s * sp, 25 + rnd(seed, i, 9) * 65, G, t);
    drop(b, BIT, i % 3 ? FOAM : GLINT, 1, water, i % 5 === 0 ? 2 : 1);
  }
}

// ---------------------------------------------------------------------------
// Прыжок и приземление — `f3_splash` (самый тяжёлый удар, ×1,5).
// Метка горит весь полёт: край — где падёт тело; лужа алой воды наливается
// к удару; с тела в круг падают капли; зубы по кругу — пасть сверху —
// смыкаются в последние 0,2 с. Контакт: блин пены в кадр удара, стенка воды
// кольцом (ближнюю половину рисует зона мозга поверх тела и героя), вода
// накатывает по песку и уходит в него, пыль, комья, мокрое пятно сохнет.
// ---------------------------------------------------------------------------

registerZonePainter('f3_splash', (g, z, px, py, scale, time) => {
  const st = z as Strike;
  const T = Math.max(0.05, st.warn);
  const t = Math.min(st.t, T);
  const k = t / T;
  const left = T - t;
  const alarm = left < ALARM;
  const R = st.r * scale;
  const b = new Brush(g, px, py);
  const seed = (st.id * 2654435761) >>> 0;
  g.save();
  // Лужа алой воды наливается от середины — таймер до удара.
  const rf = R * (0.12 + 0.88 * k);
  b.ink(RED, 0.1 + 0.16 * k + (alarm ? 0.12 : 0));
  b.blob(0, 0, rf, rf, seed, 0.1);
  b.ink(alarm ? HOT : RED, 0.35 + 0.45 * k);
  b.ring(0, 0, rf);
  // Край удара: пунктир бежит по кругу; в тревоге — сплошной и горячий.
  if (alarm) {
    const on = Math.floor(time * 18) % 2 === 0;
    b.ink(on ? HOT : RED, 1);
    b.ring(0, 0, R);
    b.ink(RED, 0.9);
    b.ring(0, 0, R + 1);
  } else {
    b.ink(RED_D, 0.45 + 0.3 * k);
    b.ring(0, 0, R + 1);
    b.ink(RED, 0.55 + 0.4 * k);
    b.ring(0, 0, R, 1, 0, TAU, 4, time * 6);
  }
  // Зубы по кругу — пасть сверху: ползут внутрь и смыкаются к удару.
  const bite = alarm ? 2 + 3 * (1 - left / ALARM) : 2 * k * k;
  const rot = time * 0.35;
  b.ink(alarm ? HOT : TOOTH, 0.45 + 0.5 * k);
  for (let i = 0; i < 10; i++) {
    const a = rot + (i / 10) * TAU;
    const ux = -Math.cos(a);
    const uy = -Math.sin(a);
    const bx = Math.cos(a) * (R - 1 - bite);
    const by = Math.sin(a) * (R - 1 - bite);
    for (let d = 0; d < 4; d++) {
      const w = d < 2 ? 1 : 0;
      for (let s = -w; s <= w; s++) b.dot(bx + ux * d - uy * s, by + uy * d + ux * s);
    }
  }
  // С тела в полёте в круг падают капли — шлёпаются и расходятся кружками.
  for (let i = 0; i < 7; i++) {
    const kd = 0.32 + (0.6 * i) / 7 + rnd(seed, i, 1) * 0.06;
    const dt = (k - kd) * T;
    if (dt < -0.08 || dt > 0.35) continue;
    const a = rnd(seed, i, 2) * TAU;
    const r = Math.sqrt(rnd(seed, i, 3)) * R * 0.8;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (dt < 0) {
      b.ink(FOAM, 0.9);
      b.dot(x, y + dt * 320, 1, 2);
    } else {
      b.ink(FOAM2, 0.8 * (1 - dt / 0.35));
      b.ring(x, y, 1 + dt * 14, 0.6);
    }
  }
  g.restore();
  return true;
});

/** Корона приземления: стенка кольцом вокруг тела и капли с её зубцов. */
const LAND = (R: number): SheetOpts => ({
  r0: R * 0.5,
  r1: R * 1.05,
  h: 18,
  rise: 0.08,
  fall: 0.3,
});

function crown(b: Brush, seed: number, R: number, age: number, front: boolean | null): void {
  const o = LAND(R);
  sheet(b, seed, age, front, o);
  tips(b, seed, age, front, o, 30, 35, 85, false);
  // Несколько капель выше всех — искры над стенкой.
  for (let i = 0; i < 8; i++) {
    const a = rnd(seed, i, 30) * TAU;
    const s = Math.sin(a);
    if (front !== null && s >= 0 !== front) continue;
    const c = Math.cos(a);
    const sp = 15 + rnd(seed, i, 31) * 25;
    fly(BIT, c * R * 0.5, s * R * 0.5, 6, c * sp, s * sp, 150 + rnd(seed, i, 32) * 70, G, age);
    drop(b, BIT, GLINT, 1, false);
  }
}

registerImpactPainter('f3_splash', {
  life: 1.6,
  shake: 0.5,
  flash: 0.2,
  flashRgb: '255,236,230',
  paint(g, rec, px, py, scale, age) {
    const R = (rec.r ?? 1.45) * scale;
    const b = new Brush(g, px, py);
    const seed = posSeed(rec.x, rec.y, 2);
    // Мокрое пятно: вода с тела легла на песок и сохнет.
    const wetA = age < 0.06 ? age / 0.06 : 1 - clamp01((age - 0.5) / 1.1);
    b.ink(WET, 0.5 * wetA);
    b.blob(0, 0, R * 1.05, R * 0.95, seed, 0.25);
    // Вода накатывает по песку от тела и уходит в него: тёмная плёнка,
    // по краю — рваная пена (не ровный круг).
    if (age < 0.8) {
      const k = outCubic(age / 0.3);
      const rs = R * (0.55 + 0.8 * k);
      const f = 1 - clamp01((age - 0.22) / 0.58);
      // Плёнка неровная и гаснет быстро — не купол; пена рвётся, пока бежит.
      b.ink(TEAL_D, 0.28 * f);
      b.blob(0, 0, rs, rs * 0.88, seed + 11, 0.3);
      b.ink(FOAM, 0.9 * f);
      b.torn(0, 0, rs, 0.88, seed + 12, 0.62 - 0.3 * k, 2, 0, TAU, age * 2);
      b.ink(FOAM2, 0.6 * f);
      b.torn(0, 1, rs - 2.5, 0.88, seed + 13, 0.4 - 0.2 * k);
    }
    // Блин пены в кадр удара — прячет склейку тела и земли.
    if (age < 0.08) {
      const k = age / 0.08;
      b.ink(FOAM, 0.95 * (1 - k));
      b.blob(0, 0, R * (0.8 + 0.3 * k), R * (0.62 + 0.25 * k), seed + 5, 0.22);
    }
    // Пыль с сухого края: клубы выдавило из-под тела, оседают.
    for (let i = 0; i < 10; i++) {
      const u = age - rnd(seed, i, 40) * 0.05;
      if (u < 0 || u > 0.7) continue;
      const a = ((i + rnd(seed, i, 41)) / 10) * TAU;
      const r = R * (0.9 + 0.8 * outCubic(u / 0.5));
      const sz = Math.round(2 + u * 6);
      b.ink(DUST, 0.34 * (1 - u / 0.7));
      b.dot(Math.cos(a) * r - sz / 2, Math.sin(a) * r * 0.9 - sz / 2 - u * 6, sz, sz);
    }
    // Грязь: комья отскакивают, скользят и ложатся.
    const fade = 1 - clamp01((age - 1.0) / 0.6);
    for (let i = 0; i < 12; i++) {
      const a = rnd(seed, i, 20) * TAU;
      const sp = 30 + rnd(seed, i, 21) * 55;
      const vz = 50 + rnd(seed, i, 22) * 70;
      const c = Math.cos(a);
      const s = Math.sin(a);
      fly(BIT, c * R * 0.3, s * R * 0.3, 3, c * sp, s * sp, vz, G, age, 0.32);
      clod(b, BIT, i % 2 ? MUD2 : MUD, fade, i % 3 === 0 ? 2 : 1);
    }
    // Дальняя половина короны (ближнюю — поверх тела и героя — рисует зона).
    crown(b, seed, R, age, false);
    return true;
  },
});

// ---------------------------------------------------------------------------
// Хвост на берегу — `f3_thrash` (круг r 2 вокруг тела, 0,55 с).
// Метка — часы: от хвоста через спину хвост «заметает» круг, в заметённом —
// борозды, ведущая кромка светлая; в тревоге край горит, камешки прыгают.
// Контакт — смаз хвоста с проводкой на полоборота дальше, брызги и комья
// по касательной, борозда содранного песка, оседающая пыль.
// ---------------------------------------------------------------------------

/** С какой стороны начинает хвост и куда метёт: от хвоста через спину к голове. */
function sweepOf(face: number | null): { a0: number; dir: number } {
  if (face === null) return { a0: Math.PI, dir: 1 };
  const right = Math.cos(face) >= 0;
  return { a0: right ? Math.PI : 0, dir: right ? 1 : -1 };
}

function mawFace(id: number | undefined, x: number, y: number): number | null {
  const sim = paintSim();
  if (!sim) return null;
  for (const m of sim.mobs) {
    if (m.kind !== 'f3_maw') continue;
    if (m.id === id || Math.hypot(m.x - x, m.y - y) < 1.5) return m.face;
  }
  return null;
}

registerZonePainter('f3_thrash', (g, z, px, py, scale, time) => {
  const st = z as Strike;
  const T = Math.max(0.05, st.warn);
  const t = Math.min(st.t, T);
  const k = t / T;
  const left = T - t;
  const alarm = left < ALARM;
  const R = st.r * scale;
  const b = new Brush(g, px, py);
  const { a0, dir } = sweepOf(mawFace(st.from, st.x, st.y));
  const seed = (st.id * 2654435761) >>> 0;
  g.save();
  // Заметённое: сектор от хвоста по ходу — наливается ровно к удару.
  const sw = TAU * k;
  const aEnd = a0 + dir * sw;
  b.ink(RED, 0.1 + 0.14 * k + (alarm ? 0.1 : 0));
  g.beginPath();
  g.moveTo(b.ox, b.oy);
  g.arc(b.ox, b.oy, R, Math.min(a0, aEnd), Math.max(a0, aEnd));
  g.closePath();
  g.fill();
  // Борозды: хвост волочится по песку — тёмные штрихи в заметённом.
  b.ink(MUD, 0.5);
  const nb = Math.floor(14 * k);
  for (let j = 0; j < nb; j++) {
    const a = a0 + dir * TAU * ((j + 0.5) / 14);
    const r1 = R * (0.5 + 0.2 * rnd(seed, j, 1));
    const r2 = R * (0.8 + 0.15 * rnd(seed, j, 2));
    b.line(Math.cos(a) * r1, Math.sin(a) * r1, Math.cos(a) * r2, Math.sin(a) * r2);
  }
  // Кромка хвоста: светлая черта — где хвост сейчас.
  b.ink(alarm ? HOT : TOOTH, 0.6 + 0.4 * k);
  b.line(
    Math.cos(aEnd) * R * 0.4,
    Math.sin(aEnd) * R * 0.4,
    Math.cos(aEnd) * R,
    Math.sin(aEnd) * R,
  );
  // Край удара.
  if (alarm) {
    const on = Math.floor(time * 18) % 2 === 0;
    b.ink(on ? HOT : RED, 1);
    b.ring(0, 0, R);
    b.ink(RED, 0.9);
    b.ring(0, 0, R + 1);
    // Камешки у края подпрыгивают: земля дрожит.
    b.ink(MUD3, 1);
    for (let i = 0; i < 10; i++) {
      const a = rnd(seed, i, 5) * TAU;
      const hz = Math.abs(Math.sin(time * 26 + i * 1.7)) * 2;
      b.dot(Math.cos(a) * (R - 2), Math.sin(a) * (R - 2) - hz);
    }
  } else {
    b.ink(RED_D, 0.45 + 0.3 * k);
    b.ring(0, 0, R + 1);
    b.ink(RED, 0.5 + 0.45 * k);
    b.ring(0, 0, R, 1, 0, TAU, 4, -dir * time * 8);
  }
  g.restore();
  return true;
});

const SWEEP = new WeakMap<ImpactRec, { a0: number; dir: number }>();

registerImpactPainter('f3_thrash', {
  life: 1.2,
  shake: 0.25,
  paint(g, rec, px, py, scale, age) {
    const R = (rec.r ?? 2) * scale;
    const b = new Brush(g, px, py);
    let sw = SWEEP.get(rec);
    if (!sw) {
      sw = sweepOf(mawFace(undefined, rec.x, rec.y));
      SWEEP.set(rec, sw);
    }
    const { a0, dir } = sw;
    const seed = rec.seed;
    // Борозда: полоса содранного песка по кругу — рваная, темнеет и сохнет.
    const scuff = (age < 0.08 ? age / 0.08 : 1) * (1 - clamp01((age - 0.5) / 0.7));
    if (scuff > 0) {
      b.ink(WET, 0.55 * scuff);
      for (let j = 0; j < 3; j++) b.torn(0, 0, R * (0.68 + j * 0.06), 1, seed + j, 0.62, 2);
    }
    // Ударная волна по песку — рваная.
    if (age < 0.28) {
      const k = age / 0.28;
      b.ink(FOAM2, 0.8 * (1 - k));
      b.torn(0, 0, R * (0.85 + 0.5 * outCubic(k)), 1, seed + 9, 0.7);
    }
    // Смаз хвоста: хвост обошёл тело кругом — смаз по всему кругу, ярче у
    // головы, гаснет к хвосту; проводка ещё на 0,9 рад за точку удара.
    if (age < 0.26) {
      const k = age / 0.26;
      const head = a0 + dir * (TAU + 0.9 * outCubic(age / 0.16));
      const len = TAU * (1 - 0.55 * k);
      for (let seg = 0; seg < 6; seg++) {
        const s0 = head - dir * len * ((seg + 1) / 6);
        const s1 = head - dir * len * (seg / 6);
        const fa = (1 - k) * (1 - seg * 0.15);
        const lo = Math.min(s0, s1);
        const hi = Math.max(s0, s1);
        b.arc(R * 0.72, lo, hi, 8 - seg, TEAL, 0.5 * fa);
        b.arc(R * 0.75, lo, hi, 3.5 - seg * 0.4, FOAM, 0.95 * fa);
      }
    }
    // Брызги и комья — по касательной, по ходу хвоста.
    const fade = 1 - clamp01((age - 0.75) / 0.45);
    for (let i = 0; i < 34; i++) {
      const phi = a0 + dir * TAU * ((i + rnd(seed, i, 1) * 0.7) / 34);
      const c = Math.cos(phi);
      const s = Math.sin(phi);
      const tx = -s * dir;
      const ty = c * dir;
      const tsp = 55 + rnd(seed, i, 2) * 75;
      const rsp = 15 + rnd(seed, i, 3) * 35;
      const vz = 40 + rnd(seed, i, 4) * 75;
      const x0 = c * R * 0.78;
      const y0 = s * R * 0.78;
      if (i % 3 === 0) {
        fly(BIT, x0, y0, 2, tx * tsp + c * rsp, ty * tsp + s * rsp, vz, G, age, 0.3);
        clod(b, BIT, i % 2 ? MUD2 : MUD, fade, i % 6 === 0 ? 2 : 1);
      } else {
        fly(BIT, x0, y0, 3, tx * tsp + c * rsp, ty * tsp + s * rsp, vz, G, age);
        drop(b, BIT, i % 2 ? FOAM : FOAM2, 1, false, i % 5 === 0 ? 2 : 1);
      }
    }
    // Пыль: клубы у края оседают и расползаются.
    for (let i = 0; i < 10; i++) {
      const u = age - 0.03 - rnd(seed, i, 7) * 0.1;
      if (u < 0 || u > 0.9) continue;
      const a = a0 + dir * TAU * (i / 10);
      const r = R * 0.9 + u * 14;
      const sz = Math.round(2 + u * 5);
      b.ink(DUST, 0.34 * (1 - u / 0.9));
      b.dot(Math.cos(a) * r - sz / 2, Math.sin(a) * r - sz / 2 - u * 5, sz, sz);
    }
    return true;
  },
});

// ---------------------------------------------------------------------------
// Волна хвостом — `f3_wave` (конус r 6,5, дуга 1,1, 0,85 с / 0,68 в ярости).
// Метка: мокрая бирюза — докуда накроет; рябь бежит К пасти, всё быстрее —
// вал собирает воду; края пунктиром бегут наружу; у пасти встаёт вал и
// растёт к удару. За 0,12 с до урона вал срывается, в кадр урона он на
// середине конуса на полной скорости, через 0,1 с бьёт в край и ломается.
// Контакт: вал добегает, брызги с гребня по пути и веером на краю, мокрый
// конус с полосами течения, пена клочьями — и всё откатывается в озеро.
// ---------------------------------------------------------------------------

const WAVE_LEAD = 0.12;
const WAVE_RUN = 0.1;
/** Вал у пасти до срыва, пикселей от середины: за телом, не под ним. */
const WAVE_R0 = 20;

/**
 * Где гребень: `tau` — секунды от урона (минус — до). Разгон до срыва и
 * торможение после; скорость на стыке одна — в кадр урона вал на полном ходу.
 */
function crestAt(tau: number, R: number): number {
  const r0 = WAVE_R0;
  const rm = r0 + ((R - r0) * WAVE_LEAD) / (WAVE_LEAD + WAVE_RUN);
  if (tau <= -WAVE_LEAD) return r0;
  if (tau < 0) {
    const s = 1 + tau / WAVE_LEAD;
    return r0 + (rm - r0) * s * s;
  }
  if (tau < WAVE_RUN) {
    const s = 1 - tau / WAVE_RUN;
    return rm + (R - rm) * (1 - s * s);
  }
  return R;
}

/**
 * Вал дугой: тело воды за гребнем (полоса `thick`), стенка высотой `h`
 * столбиками вдоль дуги — низ тёмный, верх светлее, гребень пены зубцами
 * (кипит, зубцы ползут вдоль гребня), пена у подножия.
 */
function waveWall(
  b: Brush,
  seed: number,
  r: number,
  a: number,
  half: number,
  h: number,
  thick: number,
  alpha: number,
  time: number,
): void {
  // Тело вала за гребнем: тёмная полоса, у гребня светлее — вода горбом.
  if (thick > 0.5) {
    b.arc(r - thick / 2 - 1, a - half, a + half, thick, TEAL_D, alpha * 0.65);
    b.arc(r - 2, a - half, a + half, Math.min(3, thick * 0.5), TEAL, alpha * 0.8);
  }
  const n = Math.ceil(2 * half * r * 1.1);
  for (let pass = 0; pass < 3; pass++) {
    if (pass === 0) b.ink(DEEP, alpha * 0.95);
    else if (pass === 1) b.ink(TEAL, alpha * 0.9);
    let lx = 1e9;
    let ly = 1e9;
    for (let i = 0; i <= n; i++) {
      const aa = a - half + (2 * half * i) / n;
      const x = Math.round(Math.cos(aa) * r);
      const y = Math.round(Math.sin(aa) * r);
      if (x === lx && y === ly) continue;
      lx = x;
      ly = y;
      const q = vn(seed, (i / n) * 16 + time * 5);
      const hh = Math.max(1, Math.round(h * (0.65 + 0.5 * q)));
      const hb = Math.max(1, Math.round(hh * 0.45));
      if (pass === 0) b.dot(x, y - hb + 1, 1, hb);
      else if (pass === 1) {
        if (hh - hb > 1) b.dot(x, y - hh + 2, 1, hh - hb - 1);
      } else {
        b.ink(q > 0.78 ? GLINT : FOAM, alpha);
        b.dot(x, y - hh, 1, 2);
      }
    }
  }
  // Подножие: пена там, где вал бьёт в песок, — рваная, бурлит.
  b.ink(FOAM2, alpha * 0.85);
  b.torn(0, 0, r + 1, 1, seed, 0.6, 1, a - half, a + half, time * 4);
  b.ink(FOAM, alpha * 0.6);
  b.torn(0, 0, r + 2, 1, seed + 3, 0.35, 1, a - half, a + half, -time * 3);
}

registerZonePainter('f3_wave', (g, z, px, py, scale, time) => {
  const st = z as Strike;
  const T = Math.max(0.05, st.warn);
  const t = Math.min(st.t, T);
  const k = t / T;
  const left = T - t;
  const alarm = left < ALARM;
  const R = st.r * scale;
  const a = st.ang ?? 0;
  const half = (st.arc ?? 1) / 2;
  const b = new Brush(g, px, py);
  const seed = (st.id * 2654435761) >>> 0;
  g.save();
  // Докуда накроет: мокрая бирюза; в тревоге мигает.
  const flick = alarm && Math.floor(time * 18) % 2 === 0 ? 0.08 : 0;
  b.ink('#46aab4', 0.1 + 0.16 * k + flick);
  b.sector(WAVE_R0, R, a, half);
  // Вода уходит к пасти: дуги ряби бегут внутрь, всё быстрее.
  const ph = t * 0.8 + (1.3 * t * t) / T;
  for (let i = 0; i < 5; i++) {
    const f = (((ph + i / 5) % 1) + 1) % 1;
    const rr = WAVE_R0 + 6 + (R - WAVE_R0 - 6) * (1 - f);
    b.ink(FOAM2, (0.12 + 0.3 * k) * Math.sin(f * Math.PI));
    b.ring(0, 0, rr, 1, a - half + 0.05, a + half - 0.05, 3, 0);
  }
  // Края: пунктир бежит наружу — туда пойдёт вал.
  b.ink(RED, 0.4 + 0.45 * k);
  for (const side of [-1, 1]) {
    const c = Math.cos(a + side * half);
    const s = Math.sin(a + side * half);
    for (let d = WAVE_R0; d <= R; d++) {
      if ((((d - time * 36) % 6) + 6) % 6 >= 3) continue;
      b.dot(c * d, s * d);
    }
  }
  // Дальний край — где кончится удар.
  if (alarm) {
    b.ink(flick ? HOT : RED, 1);
    b.ring(0, 0, R, 1, a - half, a + half);
    b.ink(RED, 0.9);
    b.ring(0, 0, R + 1, 1, a - half, a + half);
  } else {
    b.ink(RED_D, 0.4 + 0.3 * k);
    b.ring(0, 0, R + 1, 1, a - half, a + half);
    b.ink(RED, 0.55 + 0.4 * k);
    b.ring(0, 0, R, 1, a - half, a + half, 4, time * 8);
  }
  // Вал у пасти встаёт и растёт; в последние 0,12 с — срывается вперёд.
  const rc = crestAt(t - T, R);
  const h = 2 + 5 * k ** 1.5;
  waveWall(b, seed, rc, a, half, h, 2 + 5 * k, 0.55 + 0.45 * k, time);
  g.restore();
  return true;
});

registerImpactPainter('f3_wave', {
  life: 1.6,
  shake: 0.3,
  flash: 0.12,
  flashRgb: '190,250,245',
  paint(g, rec, px, py, scale, age, time) {
    const R = (rec.r ?? 6.5) * scale;
    const a = rec.ang ?? 0;
    const half = (rec.arc ?? 1.1) / 2;
    const b = new Brush(g, px, py);
    const seed = rec.seed;
    const rc = crestAt(age, R);
    // Откат: с 0,3 с вода уходит обратно к пасти — песок за ней тёмный, сохнет.
    const backK = inQuad((age - 0.3) / 1.2);
    const back = R - (R - WAVE_R0) * backK;
    const wetR = Math.min(rc, back);
    const dry = 1 - clamp01((age - 0.35) / 1.25);
    // Вода по песку темнее сухого (мокро) и в бликах — не луч фонаря.
    b.ink(TEAL_D, 0.42 * dry);
    b.sector(WAVE_R0, Math.max(WAVE_R0 + 1, wetR), a, half);
    // Блики на плёнке: короткие черты поперёк течения, уходят с водой к пасти.
    b.ink(FOAM2, 0.4 * dry);
    for (let i = 0; i < 14; i++) {
      const rr = WAVE_R0 + 6 + rnd(seed, i, 70) * (R - WAVE_R0 - 10);
      const r = rr - (rr - WAVE_R0) * 0.6 * inQuad((age - 0.3) / 1.2);
      if (r > wetR - 2) continue;
      const aa = a + (rnd(seed, i, 71) * 2 - 1) * half * 0.9;
      b.dot(Math.cos(aa) * r - 1, Math.sin(aa) * r, 3, 1);
    }
    b.ink(WET, 0.32 * (1 - dry) * (1 - clamp01((age - 1.1) / 0.5)));
    b.sector(Math.max(WAVE_R0, wetR), R, a, half);
    // Пена отката: рваная линия на краю воды.
    if (age > 0.3 && dry > 0) {
      b.ink(FOAM, 0.8 * dry);
      b.torn(0, 0, wetR, 1, seed + 21, 0.6, 2, a - half, a + half, age * 3);
      b.ink(FOAM2, 0.55 * dry);
      b.torn(0, 0, wetR + 2, 1, seed + 22, 0.4, 1, a - half, a + half, -age * 2);
    }
    // Вал добегает до края и ломается: оседает, пена лезет за край.
    if (age < WAVE_RUN + 0.32) {
      const brk = clamp01((age - WAVE_RUN) / 0.32);
      waveWall(b, seed, rc + brk * 5, a, half, 7 * (1 - brk), 7 * (1 - brk), 1 - brk * 0.8, time);
    }
    // Пена клочьями: легла, где прошёл вал, и уезжает с откатом.
    for (let i = 0; i < 8; i++) {
      const rr = WAVE_R0 + 10 + rnd(seed, i, 1) * (R - WAVE_R0 - 14);
      if (rc < rr) continue;
      const aa = a + (rnd(seed, i, 2) * 2 - 1) * half * 0.85;
      const u = (age - 0.3 - rnd(seed, i, 3) * 0.2) / 1.1;
      const r = rr - (rr - WAVE_R0) * 0.75 * inQuad(u);
      const al = 0.75 * (1 - clamp01((age - 0.6 - rnd(seed, i, 4) * 0.3) / 0.4));
      if (al <= 0) continue;
      // Клок пены — горсть пузырьков разной величины, а не камешек и не точка.
      const x = Math.cos(aa) * r;
      const y = Math.sin(aa) * r;
      b.ink(FOAM, al);
      b.dot(x, y, 2, 1);
      b.ink(FOAM2, al * 0.8);
      b.dot(x + 2 + (i % 2), y + 1, 1, 1);
      b.dot(x - 2, y - (i % 2), 2, 1);
    }
    // Брызги с гребня по пути.
    for (let i = 0; i < 18; i++) {
      const tl = (WAVE_RUN * i) / 18;
      const t = age - tl;
      if (t < 0) continue;
      const r0 = crestAt(tl, R);
      const aa = a + (rnd(seed, i, 5) * 2 - 1) * half * 0.9;
      const c = Math.cos(aa);
      const s = Math.sin(aa);
      const sp = 40 + rnd(seed, i, 6) * 45;
      fly(BIT, c * r0, s * r0, 7, c * sp, s * sp, 60 + rnd(seed, i, 7) * 60, G, t);
      drop(b, BIT, i % 2 ? FOAM : GLINT, 1, false);
    }
    // Вал ударил в край: веер брызг за край.
    const tb = age - WAVE_RUN;
    if (tb >= 0)
      for (let i = 0; i < 32; i++) {
        const aa = a + ((i + rnd(seed, i, 8)) / 32 - 0.5) * 2 * half;
        const c = Math.cos(aa);
        const s = Math.sin(aa);
        const sp = 25 + rnd(seed, i, 9) * 50;
        fly(BIT, c * R, s * R, 6, c * sp, s * sp, 80 + rnd(seed, i, 10) * 80, G, tb);
        drop(b, BIT, i % 3 ? FOAM : GLINT, 1, false, i % 6 === 0 ? 2 : 1);
      }
    return true;
  },
});

// ---------------------------------------------------------------------------
// Плевок — `f3_spit` (навесом, 1 или 3 в «ГОЛОДЕ»). Сгусток тёмной воды с
// алой жилкой крутится (8 кадров), вытянут по ходу, за ним — хвост из трёх
// капель по экранной скорости (с подъёмом и падением навеса). Контакт —
// шлепок, брызги по ходу полёта и лужа, которая растекается и сохнет.
// ---------------------------------------------------------------------------

const SPIT_FRAMES = frameLRU<Sprite>(160);
const SPIT_W = 30;

function spitSprite(d: number, f: number): Sprite {
  const W = SPIT_W;
  const c = W / 2;
  const p = new Px(W, W);
  const a = (d / 16) * TAU;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  // Хвост капель — позади, мельче и прозрачнее, колышется.
  const tail: [number, number, RGBA][] = [
    [7.2, 2, rgb(TEAL)],
    [11, 1.5, rgb(FOAM2, 220)],
    [14, 1, rgb(FOAM2, 160)],
  ];
  tail.forEach(([dist, rad, col], j) => {
    const w = Math.sin(((f + j * 3) / 8) * TAU) * 1.1;
    p.ell(c - ux * dist - uy * w, c - uy * dist + ux * w, rad, rad, col);
  });
  p.line(c - ux * 3.5, c - uy * 3.5, c - ux * 8.5, c - uy * 8.5, rgb(FOAM2, 140));
  // Сгусток: вытянут по ходу, свет сверху-слева, алая жилка крутится.
  const body = rgb('#1c6a74');
  const lite = rgb('#3aa6a8');
  const hi = rgb('#9ae8e0');
  for (let y = 0; y < W; y++)
    for (let x = 0; x < W; x++) {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      const al = dx * ux + dy * uy;
      const ac = -dx * uy + dy * ux;
      if ((al / 4.8) ** 2 + (ac / 3.9) ** 2 > 1) continue;
      const l = -(dx * 0.6 + dy * 0.8) / 4.2;
      p.set(x, y, l > 0.45 ? hi : l > -0.15 ? lite : body);
    }
  const va = (f / 8) * TAU;
  for (const k of [0, Math.PI]) {
    p.set(c - 0.5 + Math.cos(va + k) * 2.3, c - 0.5 + Math.sin(va + k) * 1.7, rgb(RED));
    p.set(c - 0.5 + Math.cos(va + k + 0.5) * 1.9, c - 0.5 + Math.sin(va + k + 0.5) * 1.4, rgb(RED));
    p.set(c - 0.5 + Math.cos(va + k + 1) * 1.4, c - 0.5 + Math.sin(va + k + 1) * 1, rgb(RED_D));
  }
  p.set(c - 2, c - 2, rgb(GLINT));
  p.set(c - 1, c - 2, rgb(GLINT));
  p.outline(rgb('#150f0b'));
  return { img: p.canvas(), ax: c, ay: c };
}

registerShotPainter('f3_spit', (s: Shot, time: number) => {
  // Экранная скорость: навес поднимает и роняет сгусток — хвост тянется за ним.
  let vy = s.vy;
  if (s.lob) {
    const k = clamp01(s.age / s.lob.T);
    const H = Math.min(3, s.lob.T * 2.2);
    vy -= (Math.cos(k * Math.PI) * Math.PI * H) / s.lob.T;
  }
  const ang = Math.atan2(vy, s.vx);
  const d = ((Math.round(ang / (TAU / 16)) % 16) + 16) % 16;
  const f0 = ((Math.floor(time * 14 + s.id * 3) % 8) + 8) % 8;
  const f = s.vx >= 0 ? f0 : (8 - f0) % 8;
  const key = `${d}|${f}`;
  return SPIT_FRAMES.get(key) ?? SPIT_FRAMES.set(key, spitSprite(d, f));
});

registerImpactPainter('f3_spit', {
  life: 1.8,
  shake: 0.1,
  paint(g, rec, px, py, _scale, age) {
    const b = new Brush(g, px, py);
    const seed = rec.seed;
    const vx = rec.vx ?? 0;
    const vy = rec.vy ?? 0;
    const sp = Math.hypot(vx, vy) || 1;
    const ux = vx / sp;
    const uy = vy / sp;
    // Лужа: растекается по ходу за 0,16 с, потом сохнет и сжимается.
    const grow = outCubic(age / 0.16);
    const dry = clamp01((age - 0.9) / 0.9);
    const rx = 12 * grow * (1 - 0.35 * dry);
    const ry = 9 * grow * (1 - 0.35 * dry);
    const cx = ux * 2;
    const cy = uy * 2;
    const alive = 1 - dry;
    b.ink('#0c3038', 0.9 * alive);
    b.blob(cx, cy + 1, rx, ry, seed, 0.28);
    b.ink('#16505a', 0.9 * alive);
    b.blob(cx, cy, rx - 1, ry - 1, seed, 0.28);
    b.ink(TEAL, 0.6 * alive);
    b.blob(cx - 2, cy - 1.5, rx * 0.5, ry * 0.42, seed + 5, 0.3);
    // Блик по кромке — сверху-слева, как свет на всём.
    b.ink(FOAM2, 0.7 * alive);
    b.ring(cx, cy, rx - 1.5, (ry - 1.5) / Math.max(1, rx - 1.5), Math.PI * 1.05, Math.PI * 1.6);
    // Алые прожилки — кровь пасти.
    b.ink(RED, 0.85 * alive);
    for (let i = 0; i < 3; i++) {
      const aa = rnd(seed, i, 1) * TAU;
      const r = 0.2 + rnd(seed, i, 2) * 0.45;
      const x = cx + Math.cos(aa) * rx * r;
      const y = cy + Math.sin(aa) * ry * r;
      b.dot(x, y, 2, 1);
    }
    // Рябь по луже, пока свежая.
    const u = (age - 0.1) / 0.6;
    if (u > 0 && u < 1) {
      b.ink(FOAM2, 0.5 * (1 - u));
      b.ring(cx, cy, 2 + (rx - 3) * outCubic(u), ry / Math.max(1, rx));
    }
    // Шлепок: кольцо и брызги по ходу.
    if (age < 0.22) {
      const k = age / 0.22;
      b.ink(FOAM, 0.9 * (1 - k));
      b.ring(cx, cy, 3 + 13 * outCubic(k), 0.75);
    }
    for (let i = 0; i < 14; i++) {
      const aa = rnd(seed, i, 3) * TAU;
      const v = 30 + rnd(seed, i, 4) * 45;
      fly(
        BIT,
        cx,
        cy,
        2,
        Math.cos(aa) * v + ux * 30,
        Math.sin(aa) * v + uy * 30,
        40 + rnd(seed, i, 5) * 60,
        G,
        age,
      );
      drop(b, BIT, i % 2 ? FOAM2 : TEAL, 1, false, i % 4 === 0 ? 2 : 1);
    }
    return true;
  },
});

// ---------------------------------------------------------------------------
// Прилив — `f3_tide` (зона фазы «ПРИЛИВ», 2,6 с) и `f3_tidefx` (зона-след
// на весь остаток боя). Первая: отмель, которую зальёт, намокает и блестит,
// будущая кромка — пунктиром пены, за 0,45 с до заливки пена набегает на
// клетку. Вторая — следит за клетками: залило — всплеск пены и капли; у
// сухих соседей кромка пены лижет берег; ушла вода (смерть, сброс) —
// откат от дальних клеток к озеру и мокрый песок сохнет.
// ---------------------------------------------------------------------------

type TideZone = Zone & F3Zone;
const TIDE_SET = new WeakMap<object, Set<number>>();

function tideSet(zz: TideZone): Set<number> {
  let s = TIDE_SET.get(zz);
  if (!s) {
    s = new Set(zz.cells ?? []);
    TIDE_SET.set(zz, s);
  }
  return s;
}

registerZonePainter('f3_tide', (g, z, px, py, scale, time) => {
  const zz = z as TideZone;
  const sim = paintSim();
  if (!zz.cells || !zz.ww) return true;
  const ww = zz.ww;
  const t = zz.t;
  const kw = clamp01(t / 1.8);
  const out = clamp01((zz.life - t) / 0.35);
  // Кисть у начала мира: клетки ложатся ровно на куски карты.
  const b = new Brush(g, px - zz.x * scale, py - zz.y * scale);
  const set = tideSet(zz);
  const edge = (j: number) => !set.has(j) && (!sim || sim.tiles[j] !== Tile.Deep);
  const dash = Math.floor(time * 8);
  g.save();
  for (let k = 0; k < zz.cells.length; k++) {
    const i = zz.cells[k];
    if (sim && sim.tiles[i] === Tile.Deep) continue;
    const x0 = (i % ww) * 16;
    const y0 = Math.floor(i / ww) * 16;
    // Плёнка воды: отмель темнеет и блестит.
    b.ink(TEAL, (0.07 + 0.15 * kw) * out);
    b.dot(x0, y0, 16, 16);
    // Блик ползёт наискось.
    const ph = (((time * 1.3 + (x0 + y0) * 0.013) % 1) + 1) % 1;
    const gp = Math.floor(ph * 22) - 3;
    b.ink(FOAM2, 0.45 * kw * out);
    for (let d = 0; d < 3; d++) {
      const gx = gp + d;
      const gy = 15 - gp - d;
      if (gx >= 0 && gx < 16 && gy >= 0 && gy < 16) b.dot(x0 + gx, y0 + gy);
    }
    // Будущая кромка: пунктир пены по краю отмели у сухого пола.
    b.ink(FOAM, (0.35 + 0.35 * kw) * out);
    if (edge(i + ww))
      for (let x = 0; x < 16; x += 2) if (((x >> 1) + dash) % 3) b.dot(x0 + x, y0 + 15, 2, 1);
    if (edge(i - ww))
      for (let x = 0; x < 16; x += 2) if (((x >> 1) + dash) % 3) b.dot(x0 + x, y0, 2, 1);
    if (edge(i + 1))
      for (let y = 0; y < 16; y += 2) if (((y >> 1) + dash) % 3) b.dot(x0 + 15, y0 + y, 1, 2);
    if (edge(i - 1))
      for (let y = 0; y < 16; y += 2) if (((y >> 1) + dash) % 3) b.dot(x0, y0 + y, 1, 2);
    // Перед заливкой пена набегает на клетку.
    const tf = 1.8 + Math.floor(k / 3) * 0.09;
    const aw = clamp01(1 - (tf - t) / 0.45);
    if (aw > 0) {
      b.ink(TEAL_D, 0.35 * aw);
      b.dot(x0, y0, 16, 16);
      b.ink(FOAM, 0.7 * aw);
      for (let j = 0; j < 4; j++)
        b.dot(x0 + Math.floor(rnd(i, j, 1) * 13), y0 + Math.floor(rnd(i, j, 2) * 15), 3, 1);
    }
  }
  g.restore();
  return true;
});

interface TideTrack {
  /** Когда залило клетку (время рендера) или −1. */
  ft: Float32Array;
  /** Когда вода ушла из клетки или −1. */
  et: Float32Array;
  /** Откуда пришла вода (где озеро): 0 — север, 1 — юг, 2 — запад, 3 — восток. */
  from: Uint8Array;
}
const TRACK = new WeakMap<object, TideTrack>();

/** Сторона, где ближайшая вода озера: по прямым до шести клеток. */
function lakeSide(tiles: Uint8Array, i: number, ww: number, n: number): number {
  for (let d = 1; d <= 6; d++) {
    const cand = [i - d * ww, i + d * ww, i - d, i + d];
    for (let s = 0; s < 4; s++) {
      const j = cand[s];
      if (j < 0 || j >= n) continue;
      if (s >= 2 && Math.floor(j / ww) !== Math.floor(i / ww)) continue;
      if (tiles[j] === Tile.Deep) return s;
    }
  }
  return 0;
}

/**
 * Полоса клетки от стороны `side` на долю `p` (0…1): прямоугольник от края,
 * откуда пришла вода. Вернёт [x, y, w, h] и линию фронта.
 */
function band(x0: number, y0: number, side: number, p: number): [number, number, number, number] {
  const L = Math.round(16 * p);
  if (side === 0) return [x0, y0, 16, L];
  if (side === 1) return [x0, y0 + 16 - L, 16, L];
  if (side === 2) return [x0, y0, L, 16];
  return [x0 + 16 - L, y0, L, 16];
}

/** Пена по фронту воды: рваная черта поперёк клетки на границе полосы. */
function front(b: Brush, x0: number, y0: number, side: number, p: number, seed: number): void {
  const L = Math.round(16 * p);
  for (let q = 0; q < 16; q++) {
    if (vn(seed, q / 3) > 0.72) continue;
    const jag = vn(seed + 5, q / 2) > 0.5 ? 1 : 0;
    if (side === 0) b.dot(x0 + q, y0 + L - 1 + jag, 1, 2);
    else if (side === 1) b.dot(x0 + q, y0 + 15 - L - jag, 1, 2);
    else if (side === 2) b.dot(x0 + L - 1 + jag, y0 + q, 2, 1);
    else b.dot(x0 + 15 - L - jag, y0 + q, 2, 1);
  }
}

registerZonePainter('f3_tidefx', (g, z, px, py, scale, time) => {
  const zz = z as TideZone;
  const sim = paintSim();
  if (!sim || !zz.cells || !zz.ww) return true;
  // Старый след (прошлый бой до сброса) молчит: рисует последний.
  for (const o of sim.zones) if (o.art === 'f3_tidefx' && o.id > zz.id) return true;
  const cells = zz.cells;
  const n = cells.length;
  const ww = zz.ww;
  const w = sim.world;
  let tr = TRACK.get(zz);
  if (!tr) {
    const from = new Uint8Array(n);
    for (let k = 0; k < n; k++) from[k] = lakeSide(w.tiles, cells[k], ww, w.w * w.h);
    tr = { ft: new Float32Array(n).fill(-1), et: new Float32Array(n).fill(-1), from };
    TRACK.set(zz, tr);
  }
  const b = new Brush(g, px - zz.x * scale, py - zz.y * scale);
  const dryAt = (i: number, j: number) => j >= 0 && j < w.w * w.h && sim.tiles[j] === w.tiles[i];
  g.save();
  for (let k = 0; k < n; k++) {
    const i = cells[k];
    const wet = sim.tiles[i] === Tile.Deep;
    if (wet && tr.ft[k] < 0) {
      tr.ft[k] = time;
      tr.et[k] = -1;
    } else if (!wet && tr.ft[k] >= 0) {
      tr.ft[k] = -1;
      tr.et[k] = time;
    }
    const x0 = (i % ww) * 16;
    const y0 = Math.floor(i / ww) * 16;
    const side = tr.from[k];
    if (wet) {
      const u = time - tr.ft[k];
      if (u < 0.45) {
        // Вода наползает на клетку со стороны озера: впереди ещё песок,
        // по фронту — рваная пена, с фронта прыгают капли.
        const p = outCubic(u / 0.4);
        const [ax, ay, aw, ah] = band(x0, y0, side ^ 1, 1 - p);
        if (aw > 0 && ah > 0) {
          b.ink('#27313a', 0.8);
          b.dot(ax, ay, aw, ah);
        }
        b.ink(FOAM, 0.95 * (1 - u / 0.45));
        front(b, x0, y0, side, p, i);
        for (let j = 0; j < 2; j++) {
          fly(
            BIT,
            x0 + 3 + rnd(i, j, 5) * 10,
            y0 + 3 + rnd(i, j, 6) * 10,
            1,
            (rnd(i, j, 7) - 0.5) * 30,
            (rnd(i, j, 8) - 0.5) * 20,
            40 + rnd(i, j, 9) * 40,
            G,
            u,
          );
          drop(b, BIT, FOAM, 1, true);
        }
      }
      // Живая кромка: пена лижет сухих соседей — набегает и отходит.
      const lap = (Math.sin(time * 2.6 + x0 * 0.05 + y0 * 0.07) * 0.5 + 0.5) * 2.5;
      const n0 = Math.round(lap);
      // Три черты на сторону с разрывами (сдвиг по клетке — стык не в такт).
      const o = k % 3;
      b.ink(FOAM, 0.6);
      for (let e = 0; e < 3; e++) {
        const a0 = e * 6 - o + (e ? 0 : o);
        const len = e === 2 ? 16 - a0 : 4 + ((k + e) % 2);
        if (dryAt(i, i + ww)) b.dot(x0 + a0, y0 + 15 + n0, len, 1);
        if (dryAt(i, i - ww)) b.dot(x0 + a0, y0 - n0, len, 1);
        if (dryAt(i, i + 1)) b.dot(x0 + 15 + n0, y0 + a0, 1, len);
        if (dryAt(i, i - 1)) b.dot(x0 - n0, y0 + a0, 1, len);
      }
    } else if (tr.et[k] >= 0) {
      // Отлив: дальние клетки сохнут первыми, у озера вода держится дольше и
      // уходит к озеру полосой с пеной по краю; песок за ней мокрый и сохнет.
      const u = time - tr.et[k];
      const hold = 0.12 + 0.9 * (1 - k / Math.max(1, n - 1));
      const out = 0.35;
      if (u < hold + out) {
        const p = u < hold ? 1 : 1 - outCubic((u - hold) / out);
        const [ax, ay, aw, ah] = band(x0, y0, side, p);
        b.ink(WET, 0.45);
        b.dot(x0, y0, 16, 16);
        if (aw > 0 && ah > 0) {
          b.ink('#1f5d66', 0.85);
          b.dot(ax, ay, aw, ah);
        }
        b.ink(FOAM, 0.85);
        front(b, x0, y0, side, p, i + 7);
      } else if (u < hold + out + 1.4) {
        b.ink(WET, 0.45 * (1 - (u - hold - out) / 1.4));
        b.dot(x0, y0, 16, 16);
      } else tr.et[k] = -1;
    }
  }
  g.restore();
  return true;
});

// ---------------------------------------------------------------------------
// Зоны движения из мозга (без урона и статусов): нырок, всплытие, взлёт из
// воды и с берега, кильватер, капли с тела, мокрый след, вспучивание перед
// прыжком, рёв, «ГОЛОД».
// ---------------------------------------------------------------------------

/** Нырок: стенка воды вокруг ушедшего тела, круги, пена; через 0,2 с — струя из середины. */
function dive(b: Brush, seed: number, R: number, age: number): void {
  if (age < 0.6) {
    const k = age / 0.6;
    b.ink(FOAM, 0.8 * (1 - k));
    b.blob(0, 0, R * 0.55 * (1 - 0.3 * k), R * 0.4 * (1 - 0.3 * k), seed, 0.35);
  }
  for (let j = 0; j < 3; j++) {
    const u = (age - j * 0.16) / 0.9;
    if (u < 0 || u > 1) continue;
    b.ink(j ? FOAM2 : FOAM, 0.75 * (1 - u));
    b.torn(0, 0, R * (0.5 + 1.1 * outCubic(u)), 0.72, seed + j, 0.62, j ? 1 : 2);
  }
  const o: SheetOpts = { r0: R * 0.35, r1: R * 0.75, h: 10, rise: 0.07, fall: 0.28 };
  sheet(b, seed, age, null, o);
  tips(b, seed, age, null, o, 14, 20, 45, true);
  // Вода схлопнулась над телом и выстрелила струёй.
  const tj = age - 0.2;
  if (tj > 0)
    for (let i = 0; i < 8; i++) {
      const a = rnd(seed, i, 4) * TAU;
      const sp = rnd(seed, i, 5) * 10;
      fly(
        BIT,
        0,
        0,
        2,
        Math.cos(a) * sp,
        Math.sin(a) * sp * 0.7,
        110 + rnd(seed, i, 6) * 60,
        G,
        tj - i * 0.012,
      );
      if (tj - i * 0.012 > 0) drop(b, BIT, i % 2 ? GLINT : FOAM, 1, true, i < 2 ? 2 : 1);
    }
}

/**
 * Всплытие и взлёт: вода вспучилась и лопнула кругом, стенка опадает с тела,
 * капли; `amp` — сила, `ang` — куда тянет тело (взлёт), `half` — только
 * ближняя (true) или дальняя половина.
 */
function emerge(
  b: Brush,
  seed: number,
  R: number,
  age: number,
  amp: number,
  ang: number | undefined,
  half: boolean | null,
): void {
  if (half !== true) {
    // Вода вспучилась горбом и лопнула: рваный круг быстро расходится.
    if (age < 0.26) {
      const k = age / 0.26;
      const r = R * (0.4 + 0.7 * outCubic(k));
      b.ink(FOAM, 0.9 * (1 - k));
      b.torn(0, 0, r, 0.72, seed + 1, 0.78, 2);
    }
    if (age < 0.8) {
      const k = age / 0.8;
      b.ink(FOAM2, 0.6 * (1 - k));
      b.blob(0, 0, R * 0.55, R * 0.38, seed, 0.4);
    }
    for (let j = 0; j < 2; j++) {
      const u = (age - 0.12 - j * 0.2) / 0.8;
      if (u < 0 || u > 1) continue;
      b.ink(FOAM2, 0.6 * (1 - u));
      b.torn(0, 0, R * (0.7 + 1.0 * outCubic(u)), 0.72, seed + 4 + j, 0.6);
    }
  }
  if (ang === undefined) {
    // Всплыла: вода стекает с тела — капли падают по его краю и бьют кружками.
    for (let i = 0; i < 16; i++) {
      const a = rnd(seed, i, 60) * TAU;
      const c = Math.cos(a);
      const s = Math.sin(a);
      if (half !== null && s >= 0 !== half) continue;
      const t = age - rnd(seed, i, 61) * 0.3;
      if (t < 0) continue;
      const sp = 8 + rnd(seed, i, 62) * 18;
      const z0 = 4 + rnd(seed, i, 63) * 8;
      fly(
        BIT,
        c * R * 0.5,
        s * R * 0.3,
        z0,
        c * sp,
        s * sp * 0.6,
        10 + rnd(seed, i, 64) * 25,
        G,
        t,
      );
      drop(b, BIT, i % 3 ? FOAM2 : FOAM, 1, true);
    }
    return;
  }
  // Взлёт: тяжёлое тело вырвалось из воды — стенка кольцом, капли с зубцов.
  const o: SheetOpts = {
    r0: R * 0.4,
    r1: R * (0.75 + 0.15 * amp),
    h: 5 + 6 * amp,
    rise: 0.06,
    fall: 0.26 + 0.06 * amp,
  };
  sheet(b, seed, age, half, o);
  tips(b, seed, age, half, o, Math.round(12 * amp), 20, 40 + 20 * amp, true);
  // Тело тянет за собой струю — капли уходят вверх вслед за ним.
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  for (let i = 0; i < 12; i++) {
    const s = rnd(seed, i, 50) - 0.5;
    if (half !== null && uy + s >= 0 !== half) continue;
    const sp = 40 + rnd(seed, i, 51) * 50;
    const t = age - rnd(seed, i, 52) * 0.12;
    if (t < 0) continue;
    fly(BIT, s * 8, s * 3, 4, ux * sp + s * 20, uy * sp * 0.7, 150 + rnd(seed, i, 53) * 80, G, t);
    drop(b, BIT, i % 3 ? FOAM : GLINT, 1, true, i % 4 === 0 ? 2 : 1);
  }
}

/** Взлёт с берега: комья и пыль назад, две борозды от лап. */
function kick(b: Brush, seed: number, R: number, age: number, ang: number): void {
  const back = ang + Math.PI;
  const bx = Math.cos(back);
  const by = Math.sin(back);
  const fade = 1 - clamp01((age - 0.5) / 0.4);
  // Борозды от лап.
  b.ink(WET, 0.5 * fade);
  for (const side of [-1, 1]) {
    const ox = -by * side * 4;
    const oy = bx * side * 3;
    b.line(ox, oy, ox + bx * 9, oy + by * 9);
  }
  for (let i = 0; i < 12; i++) {
    const a = back + (rnd(seed, i, 1) - 0.5) * 1.4;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const sp = 35 + rnd(seed, i, 2) * 50;
    fly(BIT, c * R * 0.2, s * R * 0.2, 2, c * sp, s * sp, 50 + rnd(seed, i, 3) * 45, G, age, 0.3);
    clod(b, BIT, i % 2 ? MUD2 : MUD, fade, i % 3 === 0 ? 2 : 1);
  }
  for (let i = 0; i < 6; i++) {
    const u = age - i * 0.03;
    if (u < 0 || u > 0.8) continue;
    const r = 4 + u * 18;
    const sz = Math.round(2 + u * 5);
    const aa = back + (i - 2.5) * 0.3;
    b.ink(DUST, 0.32 * (1 - u / 0.8));
    b.dot(Math.cos(aa) * r - sz / 2, Math.sin(aa) * r - sz / 2 - u * 5, sz, sz);
  }
}

registerZonePainter('f3_fx_splash', (g, z, px, py, scale) => {
  const zz = z as TideZone;
  const age = zz.t;
  const kind = zz.k ?? 0;
  const R = zz.r * scale;
  const b = new Brush(g, px, py);
  const seed = posSeed(zz.x, zz.y, kind);
  g.save();
  if (kind === 2) crown(b, seed, R, age, true);
  else if (kind === 0) dive(b, seed, R, age);
  else if (kind === 1) emerge(b, seed, R, age, 1, undefined, null);
  else if (kind === 3) emerge(b, seed, R, age, 1.6, zz.vAng, !!zz.above);
  else kick(b, seed, R, age, zz.vAng ?? 0);
  g.restore();
  return true;
});

/** Кильватер: за плавником кольцо ряби расходится — цепочка колец складывается в клин. */
registerZonePainter('f3_fx_wake', (g, z, px, py) => {
  const zz = z as TideZone;
  const u = clamp01(zz.t / zz.life);
  const a = zz.vAng ?? 0;
  const b = new Brush(g, px, py);
  g.save();
  const r = 2 + 17 * outCubic(u);
  b.ink(FOAM2, 0.55 * (1 - u));
  b.torn(0, 0, r, 0.68, zz.id, 0.7, 1, a + Math.PI - 2.2, a + Math.PI + 2.2);
  if (u < 0.28) {
    // Пена у плавника — черта поперёк хода.
    const f = 1 - u / 0.28;
    const nx = -Math.sin(a);
    const ny = Math.cos(a) * 0.7;
    const bx = -Math.cos(a) * 2;
    const by = -Math.sin(a) * 1.4;
    b.ink(FOAM, 0.85 * f);
    b.line(bx - nx * 3, by - ny * 3, bx + nx * 3, by + ny * 3);
  }
  g.restore();
  return true;
});

/**
 * Капли с тела. `k` > 0 — капля в прыжке падает с высоты `k` клеток и
 * шлёпается (в воду — кружком); `k` = 0 — мокрый след на берегу, сохнет.
 */
const DRIP_WATER = new WeakMap<object, boolean>();
registerZonePainter('f3_fx_drip', (g, z, px, py) => {
  const zz = z as TideZone;
  const b = new Brush(g, px, py);
  const seed = (zz.id * 2654435761) >>> 0;
  const h = (zz.k ?? 0) * 16;
  g.save();
  if (h > 0) {
    let water = DRIP_WATER.get(zz);
    if (water === undefined) {
      water = waterAt(zz.x, zz.y);
      DRIP_WATER.set(zz, water);
    }
    for (let i = 0; i < 2; i++) {
      const ox = (rnd(seed, i, 1) - 0.5) * 12;
      const oy = (rnd(seed, i, 2) - 0.5) * 6;
      const t = zz.t - rnd(seed, i, 3) * 0.06;
      if (t < 0) continue;
      fly(BIT, ox, oy, h * (0.7 + 0.3 * rnd(seed, i, 4)), 0, 0, 0, G, t);
      drop(b, BIT, FOAM2, 0.9, water);
    }
  } else {
    const u = clamp01(zz.t / zz.life);
    b.ink(WET, 0.5 * (1 - u));
    b.blob(
      (rnd(seed, 0, 1) - 0.5) * 6,
      (rnd(seed, 0, 2) - 0.5) * 3,
      3 + rnd(seed, 0, 3) * 2,
      1.6,
      seed,
      0.3,
    );
    b.blob((rnd(seed, 1, 1) - 0.5) * 10, (rnd(seed, 1, 2) - 0.5) * 5, 1.5, 1, seed + 1, 0.2);
    if (u < 0.4) {
      b.ink(FOAM2, 0.55 * (1 - u / 0.4));
      b.dot((rnd(seed, 2, 1) - 0.5) * 6, (rnd(seed, 2, 2) - 0.5) * 3, 2, 1);
    }
  }
  g.restore();
  return true;
});

/** Вспучивание перед прыжком из воды: круги стягиваются к середине, пузыри лопаются. */
registerZonePainter('f3_fx_boil', (g, z, px, py, scale) => {
  const zz = z as TideZone;
  const u = clamp01(zz.t / zz.life);
  const R = zz.r * scale;
  const b = new Brush(g, px, py);
  const seed = (zz.id * 2654435761) >>> 0;
  g.save();
  for (let j = 0; j < 3; j++) {
    const f = (u * 1.7 + j / 3) % 1;
    b.ink(FOAM2, (0.25 + 0.55 * u) * Math.sin(f * Math.PI));
    b.torn(0, 0, R * (1.3 - f), 0.72, seed + j, 0.6);
  }
  b.ink(FOAM, 0.2 + 0.6 * u);
  b.blob(0, 0, R * 0.45 * u, R * 0.3 * u, seed, 0.4);
  for (let i = 0; i < 12; i++) {
    const tp = rnd(seed, i, 1);
    const a = rnd(seed, i, 2) * TAU;
    const r = Math.sqrt(rnd(seed, i, 3)) * R * 0.9;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r * 0.72;
    const d = u - tp;
    if (d < -0.25 || d > 0.2) continue;
    if (d < 0) {
      b.ink(FOAM2, 0.8);
      b.dot(x, y);
    } else {
      b.ink(FOAM, 0.8 * (1 - d / 0.2));
      b.ring(x, y, 1 + d * 12, 0.7);
    }
  }
  g.restore();
  return true;
});

/** Рёв на берегу: кольца от пасти по песку, пыль подскакивает там, где прошло кольцо. */
registerZonePainter('f3_fx_roar', (g, z, px, py) => {
  const zz = z as TideZone;
  const t = zz.t;
  const b = new Brush(g, px, py);
  const seed = (zz.id * 2654435761) >>> 0;
  g.save();
  for (let j = 0; j < 3; j++) {
    const u = (t - 0.15 - j * 0.3) / 0.7;
    if (u < 0 || u > 1) continue;
    b.ink(FOAM2, 0.4 * (1 - u));
    b.ring(0, 0, 12 + 46 * outCubic(u), 0.85, 0, TAU, 3, t * 4);
  }
  for (let i = 0; i < 18; i++) {
    const a = rnd(seed, i, 1) * TAU;
    const r = 14 + rnd(seed, i, 2) * 40;
    const j = Math.floor(rnd(seed, i, 3) * 3);
    // Когда кольцо j дошло сюда.
    const tp = 0.15 + j * 0.3 + 0.7 * (1 - Math.cbrt(1 - clamp01((r - 12) / 46)));
    const d = t - tp;
    if (d < 0 || d > 0.5) continue;
    const hz = Math.sin(clamp01(d / 0.25) * Math.PI) * 2.5;
    b.ink(MUD3, 1 - d / 0.5);
    b.dot(Math.cos(a) * r, Math.sin(a) * r * 0.85 - hz);
    b.ink(DUST, 0.25 * (1 - d / 0.5));
    b.dot(Math.cos(a) * r - 1, Math.sin(a) * r * 0.85 - 1 - d * 6, 3, 2);
  }
  g.restore();
  return true;
});

/** «ГОЛОД»: алые круги по воде и песку, брызги алой воды. */
registerZonePainter('f3_fx_hunger', (g, z, px, py) => {
  const zz = z as TideZone;
  const t = zz.t;
  const b = new Brush(g, px, py);
  const seed = (zz.id * 2654435761) >>> 0;
  g.save();
  for (let j = 0; j < 3; j++) {
    const u = (t - j * 0.18) / 0.8;
    if (u < 0 || u > 1) continue;
    b.ink(j ? RED : HOT, 0.8 * (1 - u));
    b.ring(0, 0, 10 + 60 * outCubic(u), 0.8);
    b.ink(BLOOD, 0.6 * (1 - u));
    b.ring(0, 0, 9 + 60 * outCubic(u), 0.8);
  }
  for (let i = 0; i < 20; i++) {
    const a = rnd(seed, i, 1) * TAU;
    const sp = 30 + rnd(seed, i, 2) * 60;
    fly(BIT, 0, 0, 6, Math.cos(a) * sp, Math.sin(a) * sp * 0.8, 70 + rnd(seed, i, 3) * 90, G, t);
    drop(b, BIT, i % 3 ? RED : HOT, 1, waterAt(zz.x + BIT.x / 16, zz.y + BIT.y / 16));
  }
  g.restore();
  return true;
});
