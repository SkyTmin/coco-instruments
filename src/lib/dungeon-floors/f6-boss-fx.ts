// Этаж 6, босс «Красный змей» — техники (v2.86): метки ударов, контакт,
// пламя, угли, пепел, жар. Тело змея рисует `f6-art.ts` («Тело»), здесь —
// всё, что змей делает с МИРОМ. Договор движка — библия §14.
//
// Как устроено:
//   • метка удара (`registerZonePainter` для strike) читается «куда» с
//     первого кадра (залитая площадь с тёмной кромкой) и «когда» — фронт
//     жара доходит до края ровно в миг урона; последние 0,2 с — «тик-тик»
//     и белая кромка. Пол под меткой «закипает»: искры поднимаются чаще;
//   • контакт (`registerImpactPainter`) — у каждого удара свой: укус
//     смыкает челюсти и плюёт огнём, хвост проходит полным кругом со
//     смазом, волна встаёт стеной языков пламени, веер ложится ковром,
//     уголь разбивается лужей расплава, пике выбивает воронку; тряска — по
//     силе удара (0,1 уголь … 0,5 пике);
//   • СЛОЙ НЕБА: всё светящееся (пламя, искры, струя, вспышки) рисуется
//     поверх темноты и поверх мобов. Движок зовёт рисовальщика удара в
//     одном слое, а у удара есть и пол (копоть, трещины, пыль), и огонь.
//     Поэтому пол рисует свой рисовальщик, а огонь он кладёт в очередь
//     `sky()` — её в том же кадре рисует зона-оверлей `f6_fxsky` (ставит
//     мозг, `above`). Нет оверлея (лист кадров, лобби) — рисуется сразу;
//   • языки пламени за спиной змея и героя не рисуются поверх них
//     (`hidden`): слой неба идёт после всех мобов, и без этого стена огня
//     позади змея ложилась ему на грудь;
//   • пасть — там, где её нарисовало «Тело»: точка берётся из глаза
//     настоящего кадра змея (`mouthOf`), а не из чисел, — струя, вдох и
//     угли выходят изо рта при любой позе;
//   • удары без своего strike (ползок, взмах крыльев, тень в небе, вдох,
//     разлом, рёв, смена фазы, смерть) — визуальные зоны `f6_fx*`, их
//     ставит мозг через `api.vfx` (без урона и статусов).
//
// Пиксели — на СЕТКЕ МИРА (`Pen`): эффект не «плывёт» по полу при движении
// камеры. Частицы детерминированы — позиция считается от зерна и возраста,
// а не копится по кадрам: лист кадров и игра рисуют одно и то же, и
// стоп-кадр держит позу сам.
import { Px } from '../dungeon-art';
import {
  MOB_PAINTERS,
  frameLRU,
  paintSim,
  registerImpactPainter,
  registerMobWarm,
  registerZonePainter,
} from '../dungeon-paint';
import type { ImpactRec, MobPose } from '../dungeon-paint';
import type { Mob, Strike, Zone } from '../dungeon-sim';

type RGBA = [number, number, number, number];

const TAU = Math.PI * 2;
const TS = 16;
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
/** Остаток всегда положительный: у зон `api.vfx` номера отрицательные. */
const mod = (a: number, n: number) => ((a % n) + n) % n;
/** Зерно из номера зоны/удара (отрицательного тоже) — целое 0…2³². */
const seedOf = (id: number | undefined) => (id ?? 1) >>> 0;

/** Последние 0,2 с перед уроном — ясный сигнал «сейчас». */
const SIG = 0.2;
/** «Тик-тик»: две вспышки в последние 0,2 с. */
const tick = (left: number) => left < SIG && Math.floor(left / 0.05) % 2 === 1;

// ---- Палитра: базальт арены, копоть, огонь, пепел ---------------------------

const C = {
  ink: '#150f0b',
  soot: '#0e0808',
  sootHi: '#3a2622',
  groove: '#0a0505',
  lip: '#6e5e5a',
  redDk: '#5a0a06',
  red: '#b01a10',
  redHot: '#ff3a1c',
  orange: '#ff7a1a',
  amber: '#ffb030',
  yellow: '#ffe060',
  white: '#fff8e0',
  bone: '#d4c8ae',
  boneDk: '#6a5e50',
  shadow: '#140606',
  wind: '#f4e8d8',
};
/** Жар по доле остывания 0 (бел) … 1 (тёмный): расплав, трещины, искры. */
const HEAT = [
  '#ffffff',
  '#fff2a0',
  '#ffd050',
  '#ffb030',
  '#ff7a1a',
  '#e0400e',
  '#a8260c',
  '#5a0e06',
];
const heat = (k: number) =>
  HEAT[Math.min(HEAT.length - 1, Math.max(0, Math.floor(k * HEAT.length)))];

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
 * экране точка мира `(wx, wy)` (в пикселях мира). Поправка `qx/qy` — одна
 * на весь кадр: эффект стоит на полу, а не дрожит по нему.
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
  rect(x: number, y: number, w: number, h: number): void {
    this.g.fillRect(x + this.qx, y + this.qy, w, h);
  }
  img(c: HTMLCanvasElement, x: number, y: number): void {
    this.g.drawImage(c, Math.floor(x) + this.qx, Math.floor(y) + this.qy);
  }
  private v: [number, number, number, number] | null = null;
  /**
   * Видна ли точка мира (с запасом `m`) на холсте. Полосы волны — до
   * тридцати клеток, экран — около двенадцати: огонь за краем не рисуем.
   */
  sees(x: number, y: number, m = 24, my = m): boolean {
    let v = this.v;
    if (!v) {
      const t = this.g.getTransform();
      const a = t.a || 1;
      const d = t.d || 1;
      const W = this.g.canvas.width;
      const H = this.g.canvas.height;
      v = this.v = [
        -t.e / a - this.qx,
        -t.f / d - this.qy,
        (W - t.e) / a - this.qx,
        (H - t.f) / d - this.qy,
      ];
    }
    return x > v[0] - m && x < v[2] + m && y > v[1] - my && y < v[3] + my;
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

// ---- Слой неба: огонь поверх темноты и поверх мобов --------------------------

type SkyOp = () => void;
const skyQ: { t: number; op: SkyOp }[] = [];
/** Когда оверлей рисовал в последний раз (время рендера). */
let skySeen = -1;

/**
 * Нарисовать поверх темноты. Оверлей жив (рисовал в последние 0,25 с) —
 * в очередь, её он нарисует в этом же кадре; нет — сразу (лист кадров).
 */
function sky(time: number, op: SkyOp): void {
  if (skySeen >= 0 && time >= skySeen && time - skySeen < 0.25) skyQ.push({ t: time, op });
  else op();
}

registerZonePainter('f6_fxsky', (g, _z, _px, _py, _S, time) => {
  skySeen = time;
  for (const q of skyQ) {
    // Команда из прошлого кадра — камера уже другая: не рисуем.
    if (q.t !== time) continue;
    g.save();
    try {
      q.op();
    } catch (e) {
      // Одна сломанная картинка не гасит весь слой.
      if (!skyBroken) console.error('f6_fxsky', e);
      skyBroken = true;
    } finally {
      g.restore();
    }
  }
  skyQ.length = 0;
  return true;
});
let skyBroken = false;

// ---- Кто заслоняет огонь: змей и герой --------------------------------------

interface Occ {
  x: number;
  y: number;
  w0: number;
  w1: number;
  h: number;
}
let occT = -1;
let occ: Occ[] = [];
const AIR = new Set(['f6_fly', 'f6_mark', 'f6_dive']);

/**
 * Силуэты, за которыми язык пламени не виден (пиксели мира): трапеция от
 * точки ног вверх. Считается раз на кадр.
 */
function occluders(time: number): Occ[] {
  if (occT === time) return occ;
  occT = time;
  occ = [];
  const sim = paintSim();
  if (!sim) return occ;
  for (const m of sim.mobs) {
    if (m.kind !== 'f6boss' || m.mode === 'dying') continue;
    const air = AIR.has(m.mode) || (m.mode === 'f6_takeoff' && m.t > 0.45);
    if (air) occ.push({ x: m.x * TS, y: m.y * TS - 22, w0: 12, w1: 30, h: 44 });
    else occ.push({ x: m.x * TS, y: m.y * TS + 2, w0: 14, w1: 19, h: 46 });
  }
  const h = sim.hero;
  occ.push({ x: h.x * TS, y: h.y * TS + 2, w0: 6, w1: 6, h: 19 });
  return occ;
}

/** Точка мира (x, y — основание языка) позади и внутри чьего-то силуэта. */
function hidden(time: number, x: number, y: number): boolean {
  for (const o of occluders(time)) {
    const up = o.y - y;
    if (up <= 0 || up > o.h) continue;
    if (Math.abs(x - o.x) < o.w0 + ((o.w1 - o.w0) * up) / o.h) return true;
  }
  return false;
}

// ---- Где пасть: по глазу настоящего кадра «Тела» -----------------------------

const mobOf = (id: number | undefined): Mob | undefined => {
  if (id === undefined) return undefined;
  return paintSim()?.mobs.find((m) => m.id === id);
};
const serpent = (): Mob | undefined =>
  paintSim()?.mobs.find((m) => m.kind === 'f6boss' && m.mode !== 'dying');

interface Mouth {
  /** Пасть в пикселях мира (экранная точка: глубина уже вычтена). */
  x: number;
  y: number;
  /** Высота пасти над полом, пиксели. */
  z: number;
  /** Куда смотрит морда на экране: 1 — вправо, −1 — влево. */
  dir: number;
}
const mouthCache = new Map<number, { t: number; v: Mouth }>();

/**
 * Пасть змея. Кадр берётся у рисовальщика «Тела» с той же позой, что
 * даст ему рендер (кадр уже в кеше — это только чтение), по глазу и
 * сдвигу хода. Нет кадра или глаза — средние числа прежнего рисунка.
 */
function mouthOf(m: Mob, time: number): Mouth {
  const hit = mouthCache.get(m.id);
  if (hit && hit.t === time) return hit.v;
  const left = Math.cos(m.face) < 0;
  const dir = left ? -1 : 1;
  const air = AIR.has(m.mode);
  let dx = dir * 22;
  let dy = air ? -56 : -30;
  try {
    const paint = MOB_PAINTERS.get('f6boss');
    const speed = Math.hypot(m.vx, m.vy);
    const tt = time + m.id * 0.37;
    const hurt = m.flash > 0 && m.mode !== 'dying';
    const base = speed > 0.4 ? 'run' : 'idle';
    const pose: MobPose = {
      anim: hurt ? 'hurt' : base,
      frame: base === 'run' ? Math.floor(tt * (8 + speed * 2.2)) : Math.floor(tt * 4),
      mode: m.mode,
      t: m.t,
      left,
      flash: m.flash > 0.05,
      look: 'normal',
      now: time,
    };
    const fr = paint?.(m, pose);
    if (fr && fr.eye) {
      const sx = fr.sx ?? 1;
      const sy = fr.sy ?? 1;
      const rot = fr.rot ?? 0;
      // Пасть — чуть впереди и ниже глаза, по морде.
      const lx = (fr.eye[0] + dir * 5 - fr.ax) * sx;
      const ly = (fr.eye[1] + 3 - fr.ay) * sy;
      const c = Math.cos(rot);
      const s = Math.sin(rot);
      dx = lx * c - ly * s + (fr.dx ?? 0);
      dy = lx * s + ly * c + 2 + (fr.dy ?? 0);
    }
  } catch {
    // Кадр не дался — средние числа.
  }
  const v: Mouth = { x: m.x * TS + dx, y: m.y * TS + dy, z: Math.max(4, -dy), dir };
  mouthCache.set(m.id, { t: time, v });
  if (mouthCache.size > 8) mouthCache.delete(mouthCache.keys().next().value as number);
  return v;
}

// ---- Растр: окружности, сектор, многоугольник --------------------------------

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
  const pts: [number, number, number][] = [];
  const seen = new Set<number>();
  const add = (x: number, y: number) => {
    const key = (x + 512) * 1024 + (y + 512);
    if (seen.has(key)) return;
    seen.add(key);
    pts.push([x, y, Math.atan2(y, x)]);
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
  pts.sort((p, q) => p[2] - q[2]);
  c = {
    x: Int16Array.from(pts.map((p) => p[0])),
    y: Int16Array.from(pts.map((p) => p[1])),
    a: Float32Array.from(pts.map((p) => p[2])),
  };
  circles.set(R, c);
  return c;
}

/** Угол a в секторе [a0, a0 + span] (span > 0) с переходом через 2π. */
const inArc = (a: number, a0: number, span: number) => mod(a - a0, TAU) <= span;

/**
 * Кольцо по пикселям цветом `c`, сплюснутое по вертикали `sq` (пол в три
 * четверти). `keep(a, i)` — оставить ли пиксель (пунктир, дуга, «рваная»
 * пыль). `sh` — тень на пиксель вниз-вправо.
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
  sq = 1,
): void {
  const pts = circle(r);
  const ox = Math.floor(cx);
  const oy = Math.floor(cy);
  const n = pts.x.length;
  for (let pass = sh > 0 ? 0 : 1; pass < 2; pass++) {
    const d = pass ? 0 : 1;
    p.col(pass ? c : C.ink, pass ? a : a * sh);
    let lastY = 1e9;
    let lastX = 1e9;
    for (let i = 0; i < n; i++) {
      if (keep && !keep(pts.a[i], i)) continue;
      const x = ox + pts.x[i] + d;
      const y = oy + Math.round(pts.y[i] * sq) + d;
      if (x === lastX && y === lastY) continue;
      lastX = x;
      lastY = y;
      if (p.sees(x, y, 2)) p.rect(x, y, 1, 1);
    }
  }
}

/**
 * Кольцевой сектор [r0, r1] × [a0, a1] строками пикселей, сплюснутый по
 * вертикали `sq`. Угол больше четверти круга режется на куски с ОБЩИМИ
 * границами: пиксель на стыке достаётся ровно одному куску. Отрезок строки
 * считается сразу (круг и две полуплоскости), а не перебором пикселей:
 * сектор веера — семь клеток в радиусе, по пикселю это сотни тысяч проверок
 * за кадр.
 */
function fillSector(
  p: Pen,
  cx: number,
  cy: number,
  r0: number,
  r1: number,
  a0: number,
  a1: number,
  sq = 1,
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
  const y0 = Math.floor(cy - r1 * sq);
  const y1 = Math.ceil(cy + r1 * sq);
  const off = cx - 0.5;
  for (let y = y0; y <= y1; y++) {
    if (!p.sees(cx, y, r1 + 2, 1)) continue;
    const dy = (y + 0.5 - cy) / sq;
    const o2 = r1 * r1 - dy * dy;
    if (o2 < 0) continue;
    const ho = Math.sqrt(o2);
    const i2 = r0 * r0 - dy * dy;
    const hi = i2 > 0 ? Math.sqrt(i2) : -1;
    for (let seg = 0; seg < (hi > 0 ? 2 : 1); seg++) {
      const sL = hi > 0 ? (seg ? hi : -ho) : -ho;
      const sH = hi > 0 ? (seg ? ho : -hi) : ho;
      for (let j = 0; j < n; j++) {
        let L = sL;
        let H = sH;
        let Ls = false;
        let Hs = false;
        let ok = true;
        if (!full) {
          // Слева от начала куска: by·dx ≤ bx·dy.
          const A0 = by[j];
          const B0 = bx[j] * dy;
          if (Math.abs(A0) < 1e-9) ok = B0 >= 0;
          else if (A0 > 0) H = Math.min(H, B0 / A0);
          else L = Math.max(L, B0 / A0);
          // Справа от конца куска: by·dx > bx·dy (строго).
          const A1 = by[j + 1];
          const B1 = bx[j + 1] * dy;
          if (Math.abs(A1) < 1e-9) ok = ok && B1 < 0;
          else if (A1 > 0) {
            const v = B1 / A1;
            if (v >= L) {
              L = v;
              Ls = true;
            }
          } else {
            const v = B1 / A1;
            if (v <= H) {
              H = v;
              Hs = true;
            }
          }
        }
        if (!ok) continue;
        const xa = Ls ? Math.floor(L + off) + 1 : Math.ceil(L + off);
        const xb = Hs ? Math.ceil(H + off) - 1 : Math.floor(H + off);
        if (xb >= xa) p.rect(xa, y, xb - xa + 1, 1);
        if (full) break;
      }
    }
  }
}

/** Выпуклый многоугольник строками пикселей (центр пикселя внутри). */
function fillPoly(p: Pen, xs: number[], ys: number[]): void {
  const n = xs.length;
  let ya = Infinity;
  let yb = -Infinity;
  for (const y of ys) {
    ya = Math.min(ya, y);
    yb = Math.max(yb, y);
  }
  for (let y = Math.floor(ya); y <= Math.ceil(yb); y++) {
    const yc = y + 0.5;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const y0 = ys[i];
      const y1 = ys[j];
      if (yc < y0 === yc < y1) continue;
      const x = xs[i] + ((yc - y0) / (y1 - y0)) * (xs[j] - xs[i]);
      if (x < lo) lo = x;
      if (x > hi) hi = x;
    }
    if (hi < lo) continue;
    const a = Math.ceil(lo - 0.5);
    const b = Math.floor(hi - 0.5);
    if (b >= a) p.rect(a, y, b - a + 1, 1);
  }
}

/** Полоса вдоль угла `ang` от `s0` до `s1`, полуширина `w0` у начала и `w1` у конца. */
function fillLane(
  p: Pen,
  ox: number,
  oy: number,
  ang: number,
  s0: number,
  s1: number,
  w0: number,
  w1 = w0,
): void {
  if (s1 <= s0) return;
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  const nx = -uy;
  const ny = ux;
  fillPoly(
    p,
    [
      ox + ux * s0 - nx * w0,
      ox + ux * s1 - nx * w1,
      ox + ux * s1 + nx * w1,
      ox + ux * s0 + nx * w0,
    ],
    [
      oy + uy * s0 - ny * w0,
      oy + uy * s1 - ny * w1,
      oy + uy * s1 + ny * w1,
      oy + uy * s0 + ny * w0,
    ],
  );
}

/** Овал строками пикселей. */
function fillEll(p: Pen, cx: number, cy: number, rx: number, ry: number): void {
  if (rx < 0.5 || ry < 0.5) return;
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    const dy = (y + 0.5 - cy) / ry;
    if (dy * dy > 1) continue;
    const w = rx * Math.sqrt(1 - dy * dy);
    const a = Math.ceil(cx - w - 0.5);
    const b = Math.floor(cx + w - 0.5);
    if (b >= a) p.rect(a, y, b - a + 1, 1);
  }
}

/** Звезда удара: n лучей радиуса r, залита по пикселям. */
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
      if (d <= r * (0.34 + 0.66 * spike)) p.dot(x0 + x, y0 + y);
    }
}

// ---- Свет огня: мягкое сложение поверх темноты -------------------------------

let glowC: HTMLCanvasElement | null = null;
function glowImg(): HTMLCanvasElement {
  if (glowC) return glowC;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  if (g) {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,176,80,1)');
    gr.addColorStop(0.3, 'rgba(255,120,40,0.55)');
    gr.addColorStop(0.65, 'rgba(220,60,20,0.18)');
    gr.addColorStop(1, 'rgba(160,30,10,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
  }
  glowC = c;
  return c;
}

/** Огонь светит: тёплое пятно сложением — пол вокруг пламени оживает. */
function glow(p: Pen, x: number, y: number, rx: number, ry: number, a: number): void {
  if (a <= 0.01 || rx < 1) return;
  const g = p.g;
  const op = g.globalCompositeOperation;
  const sm = g.imageSmoothingEnabled;
  g.globalCompositeOperation = 'lighter';
  g.globalAlpha = Math.min(1, a);
  g.imageSmoothingEnabled = true;
  g.drawImage(glowImg(), x - rx + p.qx, y - ry + p.qy, rx * 2, ry * 2);
  g.imageSmoothingEnabled = sm;
  g.globalCompositeOperation = op;
}

// ---- Спрайты-заготовки -------------------------------------------------------

// Заготовки эффектов — с вытеснением: ключей около пятисот (языки, клубы,
// осколки, силуэты), трещины клеток разлома — отдельно, их столько, сколько
// клеток в кольцах арены.
const sprites = frameLRU<HTMLCanvasElement>(640);
const cellSprites = frameLRU<HTMLCanvasElement>(420);
const sprite = (key: string, make: () => Px, lru = sprites): HTMLCanvasElement =>
  lru.get(key) ?? lru.set(key, make().canvas());

const FL = {
  edge: hx('#a8260c'),
  red: hx('#e0400e'),
  orange: hx('#ff7a1a'),
  amber: hx('#ffb030'),
  core: hx('#fff2a0'),
  white: hx('#ffffff'),
};

/**
 * Язык пламени высоты h (3…20), кадр f (0…3); основание — низ по центру.
 * Кончик качается сильнее основания, в кадре 3 от кончика отрывается
 * огонёк — язык «пляшет», а не мигает.
 */
function flameImg(h: number, f: number): HTMLCanvasElement {
  const H = Math.max(3, Math.min(20, Math.round(h)));
  const F = f & 3;
  return sprite(`fl${H}|${F}`, () => {
    const w = Math.max(3, Math.round(H * 0.44)) | 1;
    const W = w + 5;
    const p = new Px(W, H + 3);
    const cx = W / 2;
    const top = 3;
    // Кадры одного языка: кончик клонится то влево, то вправо, у кадра 2
    // язык выше и уже (вытянулся), у кадра 3 от кончика отрывается огонёк.
    const lean = [1, -0.6, 0.4, -1][F];
    const slim = F === 2 ? 0.82 : 1;
    for (let y = 0; y < H; y++) {
      const t = y / Math.max(1, H - 1); // 0 — кончик, 1 — основание
      // Капля: шире всего на двух третях, донце скруглено.
      const half =
        (w / 2) * slim * Math.pow(Math.sin(Math.PI * Math.min(0.97, 0.04 + t * 0.9)), 0.7);
      const sway = Math.round(
        lean * Math.pow(1 - t, 1.6) * 2.2 + Math.sin(F * 2.1 + t * 7) * (1 - t) * 0.6,
      );
      for (let x = 0; x < W; x++) {
        const d = Math.abs(x + 0.5 - cx - sway);
        if (d > half + 0.2) continue;
        const inner = half - d;
        const u = inner / Math.max(0.5, half);
        const col =
          inner < 0.6
            ? t < 0.4
              ? FL.edge
              : FL.red
            : u > 0.55 && t > 0.5 && half > 1.6
              ? FL.core
              : u > 0.3 && t > 0.3
                ? FL.amber
                : t < 0.22
                  ? FL.red
                  : FL.orange;
        p.set(x, y + top, col);
      }
    }
    if (F === 3 && H >= 6) {
      const sx = Math.round(cx - 1.5);
      p.set(sx, 0, FL.edge);
      p.set(sx, 1, FL.orange);
      p.set(sx + 1, 1, FL.red);
    }
    return p;
  });
}

/** Клуб дыма, пыли или пепла: тень снизу, основа, свет сверху-слева. */
const PUFF_PAL: [RGBA, RGBA, RGBA][] = [
  [hx('#2a2022'), hx('#44383a'), hx('#665652')], // 0 — базальтовая пыль (темнее светлой ваты)
  [hx('#0e0a0a'), hx('#1e1716'), hx('#302624')], // 1 — чёрный дым
  [hx('#4e4642'), hx('#7a6e66'), hx('#a89a8e')], // 2 — пепел
  [hx('#7a7a82'), hx('#b4b4ba'), hx('#e6e6ec')], // 3 — пар
  [hx('#3a140c'), hx('#6a2814'), hx('#9e4a22')], // 4 — дым, подсвеченный огнём
];

/**
 * Клуб радиуса r (1…14), вариант v (0…3): три доли, чтобы край был
 * рваным, а не циркульным.
 */
function puffImg(pal: number, r: number, v: number): HTMLCanvasElement {
  const R = Math.max(1, Math.min(14, Math.round(r)));
  const V = v & 3;
  return sprite(`pf${pal}|${R}|${V}`, () => {
    const s = 2 * R + 3;
    const p = new Px(s, s);
    const c = R + 1.5;
    const rot = V * 1.57 + 0.4;
    const lobes: [number, number, number][] = [
      [0, 0, R],
      [Math.cos(rot) * R * 0.5, Math.sin(rot) * R * 0.32, R * 0.62],
      [Math.cos(rot + 2.4) * R * 0.52, Math.sin(rot + 2.4) * R * 0.3, R * 0.56],
    ];
    // Глубина пикселя внутри клуба: у края — редкая сетка (мягкий край
    // пиксельной пыли), в середине — сплошь. Без этого клуб читался
    // камнем, а не пылью.
    const depth = (x: number, y: number) => {
      let best = -1e9;
      for (const [ox, oy, rr] of lobes)
        best = Math.max(best, rr - Math.hypot(x + 0.5 - c - ox, y + 0.5 - c - oy));
      return best;
    };
    const [sh, mid, hi] = PUFF_PAL[pal];
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        const dp = depth(x, y);
        if (dp < 0) continue;
        if (R > 2 && dp < 1.3 && (x + y + V) & 1) continue;
        const l = ((x + 0.5 - c) * -0.55 + (y + 0.5 - c) * -0.83) / Math.max(1, R);
        const low = depth(x, y + 1) < 0;
        p.set(x, y, low && R > 1 ? sh : l > 0.3 ? hi : mid);
      }
    return p;
  });
}

const CHIP: RGBA[] = [hx('#1c1618'), hx('#2e2628'), hx('#4a3e3e'), hx('#6e5e5a')];

/**
 * Осколок базальта размера 1…4, поворот f (0…3); `hot` — раскалённый:
 * кромка снизу светится, как у куска, вывернутого из-под лавы.
 */
function chipImg(sz: number, f: number, hot: boolean): HTMLCanvasElement {
  const Z = Math.max(1, Math.min(4, sz));
  const F = f & 3;
  return sprite(`ch${Z}|${F}|${hot ? 1 : 0}`, () => {
    const s = Z * 2 + 3;
    const p = new Px(s, s);
    const c = s / 2;
    const rx = 0.6 + 0.6 * Z;
    const ry = 0.45 + 0.42 * Z;
    const a = F * (Math.PI / 4) + 0.3;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        const dx = x + 0.5 - c;
        const dy = y + 0.5 - c;
        const u = (dx * ca + dy * sa) / rx;
        const w = (-dx * sa + dy * ca) / ry;
        // Граник, а не галька: срез по одной стороне.
        if (u * u + w * w > 1 || u + w * 0.6 > 0.95) continue;
        const l = -dx * 0.6 - dy * 0.8;
        let col = l > 0.6 ? CHIP[3] : l > -0.2 ? CHIP[2] : l > -0.9 ? CHIP[1] : CHIP[0];
        if (hot && l < -0.5) col = l < -1.1 ? FL.orange : FL.red;
        p.set(x, y, col);
      }
    p.outline(hx(C.ink));
    return p;
  });
}

/**
 * Уголь змея (снаряд): глыба базальта 9×9 в раскалённых трещинах,
 * кадр f (0…3) — поворот на четверть: глыба кувыркается в полёте.
 */
function rockImg(f: number): HTMLCanvasElement {
  const F = f & 3;
  return sprite(`rock${F}`, () => {
    const p = new Px(11, 11);
    const c = 5.5;
    const rot = (F * Math.PI) / 2 + 0.35;
    const cr = Math.cos(rot);
    const sr = Math.sin(rot);
    for (let y = 0; y < 11; y++)
      for (let x = 0; x < 11; x++) {
        const dx = x + 0.5 - c;
        const dy = y + 0.5 - c;
        // Глыба с гранями: радиус по углу.
        const a = Math.atan2(dy, dx) - rot;
        const R = 3.9 + 0.7 * Math.cos(a * 3) + 0.35 * Math.sin(a * 5);
        const d = Math.hypot(dx, dy);
        if (d > R) continue;
        // Координаты в «теле» глыбы — трещины кувыркаются с ней.
        const u = dx * cr + dy * sr;
        const w = -dx * sr + dy * cr;
        const crack =
          Math.abs(u * 0.9 - w * 0.45) < 0.55 ||
          (Math.abs(w + 1.2 - u * 0.3) < 0.5 && u > -0.5) ||
          (Math.abs(u + 1.6) < 0.5 && w > 0.2);
        const l = -dx * 0.6 - dy * 0.8;
        let col = l > 1.6 ? CHIP[3] : l > -0.3 ? CHIP[2] : l > -1.8 ? CHIP[1] : CHIP[0];
        if (crack) col = d < 1.8 ? FL.core : d < 3 ? FL.amber : FL.orange;
        // Снизу глыба раскалена — светит, как угли в костре.
        if (!crack && l < -2.2) col = FL.red;
        p.set(x, y, col);
      }
    p.outline(hx(C.ink));
    return p;
  });
}

/** Капля огня радиуса r (1…6) стадии st: 0 бел … 5 тёмный дым. */
const BLOB: [string, string][] = [
  ['#ffffff', '#fff2a0'],
  ['#fff2a0', '#ffb030'],
  ['#ffb030', '#ff7a1a'],
  ['#ff7a1a', '#e0400e'],
  ['#e0400e', '#8a1c0a'],
  ['#3a2622', '#1e1414'],
];
function blobImg(r: number, st: number): HTMLCanvasElement {
  const R = Math.max(1, Math.min(6, Math.round(r)));
  const S = Math.max(0, Math.min(BLOB.length - 1, st));
  return sprite(`bl${R}|${S}`, () => {
    const s = 2 * R + 1;
    const p = new Px(s, s);
    const core = hx(BLOB[S][0]);
    const rim = hx(BLOB[S][1]);
    const c = R + 0.5;
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
        if (d > R + 0.3) continue;
        // Ядро смещено вверх-влево: капля объёмная, а не кружок.
        const dc = Math.hypot(x + 0.5 - c + R * 0.2, y + 0.5 - c + R * 0.2);
        p.set(x, y, dc < R * 0.62 ? core : rim);
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
 * Полёт: подброс `vz`, тяжесть `G`, отскоки с потерей энергии и трением —
 * всё по формуле, от возраста. `h` — путь по земле в секундах начальной
 * скорости (умножить на скорость — пиксели).
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
 * `fade`. `hotK` — доля раскалённых.
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
  hotK = 0.3,
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
    const gy = y + Math.sin(th) * v * f.h * 0.8;
    const sz = r4 < big * 0.4 ? 4 : r4 < big ? 3 : r4 < 0.7 ? 2 : 1;
    if (f.air) {
      p.col(C.ink, 0.3 * a);
      p.dot(gx - sz / 2, gy + 1, sz, 1);
    }
    const spin = f.air ? Math.floor(age * (14 + r2 * 10) + i) & 3 : i & 3;
    // Раскалённый остывает: через секунду — просто камень.
    const hot = hash(seed, i, 15) < hotK && age < 0.9 + r3 * 0.6;
    const im = chipImg(sz, spin, hot);
    p.col('#000', a);
    p.img(im, gx - im.width / 2, gy - f.z - im.height / 2);
  }
}

/**
 * Клубы: `n` штук из (x, y), направление `ang` ± `spread`, скорость с
 * сопротивлением, растут `r0 → r1`, поднимаются на `rise` и тают за
 * `life`. `stagger` — задержка появления клуба.
 */
function puffs(
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
  stagger = 0,
  sq = 0.8,
): void {
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
    const ox = x + Math.cos(th) * d;
    const oy = y + Math.sin(th) * d * sq - z;
    if (!p.sees(ox, oy, r + 4)) continue;
    const im = puffImg(pal, r, i);
    // Густой в начале, редеет с пятой доли жизни — тает, а не гаснет разом.
    p.col('#000', alpha * (k < 0.2 ? 1 : 1 - Math.pow((k - 0.2) / 0.8, 1.1)));
    p.img(im, ox - im.width / 2, oy - im.height / 2);
  }
}

/** Искры: головка и хвост по скорости, цвет по доле жизни, тяжесть. */
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
    if (age >= L || age < 0) continue;
    const k = age / L;
    const th = ang + (h1 - 0.5) * 2 * spread;
    const v = v0 + dv * h2;
    const vz = up * (0.4 + h3);
    const at = (t: number): [number, number] => {
      const d = drag(v, 2.2, t);
      const z = vz * t - G * t * t;
      return [x + Math.cos(th) * d, y + Math.sin(th) * d * 0.8 - z];
    };
    const [ax, ay] = at(age);
    const [bx, by] = at(Math.max(0, age - 0.035));
    p.col(heat(k * 0.85), 1 - k * 0.3);
    p.line(bx, by, ax, ay);
  }
}

/**
 * Угольки поднимаются от жара: качаются, гаснут. От (x, y) в пятне
 * `rx × ry`, по `n` штук, каждый живёт `life`; `stagger` — растянуть
 * рождения по времени.
 */
function embersUp(
  p: Pen,
  seed: number,
  age: number,
  x: number,
  y: number,
  rx: number,
  ry: number,
  n: number,
  life: number,
  rise = 26,
  stagger = 0,
): void {
  if (!p.sees(x, y - rise / 2, Math.max(rx, ry) + rise)) return;
  for (let i = 0; i < n; i++) {
    const t = age - stagger * hash(seed, i, 41);
    const L = life * (0.6 + 0.5 * hash(seed, i, 42));
    if (t < 0 || t >= L) continue;
    const k = t / L;
    const bx = x + (hash(seed, i, 43) - 0.5) * 2 * rx;
    const by = y + (hash(seed, i, 44) - 0.5) * 2 * ry;
    const sw = Math.sin(t * (5 + 4 * hash(seed, i, 45)) + i) * (1.5 + 2 * k);
    const zz = rise * (0.5 + 0.7 * hash(seed, i, 46)) * eOut2(k);
    p.col(heat(0.25 + k * 0.7), 1 - k * k);
    p.dot(bx + sw, by - zz);
  }
}

/** Пепел падает хлопьями, кружит и ложится на пол. */
function ashFall(
  p: Pen,
  seed: number,
  age: number,
  x: number,
  y: number,
  rx: number,
  ry: number,
  n: number,
  from: number,
  life: number,
  h0 = 30,
): void {
  if (!p.sees(x, y - h0 / 2, Math.max(rx, ry) + h0)) return;
  for (let i = 0; i < n; i++) {
    const t = age - from - life * 0.5 * hash(seed, i, 51);
    const L = life * (0.55 + 0.45 * hash(seed, i, 52));
    if (t < 0 || t >= L) continue;
    const k = t / L;
    const bx = x + (hash(seed, i, 53) - 0.5) * 2 * rx;
    const by = y + (hash(seed, i, 54) - 0.5) * 2 * ry;
    const zz = h0 * (0.5 + 0.5 * hash(seed, i, 55)) * (1 - Math.min(1, k * 1.25));
    const sw = Math.sin(t * 3.2 + i * 1.7) * 3;
    const lit = hash(seed, i, 56) < 0.25 && k < 0.5;
    p.col(lit ? C.orange : k > 0.8 ? '#4e4642' : '#8a7e76', k > 0.85 ? (1 - k) * 6 * 0.8 : 0.85);
    p.dot(bx + sw, by - zz);
  }
}

/**
 * Языки пламени: `n` штук в точках `at(i)`, растут за `rise`, горят,
 * опадают к `life`; высота `h0…h0+dh`. Язык позади змея или героя не
 * рисуется (`hidden`). Возвращает, сколько горит.
 */
function flames(
  p: Pen,
  seed: number,
  age: number,
  time: number,
  n: number,
  at: (i: number) => [number, number, number],
  h0: number,
  dh: number,
  life: number,
  rise = 0.07,
): number {
  let lit = 0;
  for (let i = 0; i < n; i++) {
    const [fx, fy, delay] = at(i);
    const t = age - delay;
    const L = life * (0.75 + 0.4 * hash(seed, i, 61));
    if (t < 0 || t >= L) continue;
    if (!p.sees(fx, fy - 10, 16) || hidden(time, fx, fy)) continue;
    const k = t / L;
    const grow = eOut3(k01(t / rise));
    const fall = k < 0.55 ? 1 : 1 - eIn2((k - 0.55) / 0.45);
    const flick = 0.82 + 0.18 * Math.sin(time * (17 + 7 * hash(seed, i, 62)) + i * 2.1);
    const h = (h0 + dh * hash(seed, i, 63)) * grow * fall * flick;
    if (h < 2.5) continue;
    const f = (Math.floor(time * 12 + hash(seed, i, 64) * 4) + i) & 3;
    const im = flameImg(h, f);
    p.col('#000', 1);
    p.img(im, fx - im.width / 2, fy - im.height + 1);
    lit++;
  }
  return lit;
}

// ---- Трещины: сеть от зерна, растёт от точки удара ---------------------------

interface Crack {
  x: Int16Array;
  y: Int16Array;
  d: Float32Array;
  max: number;
}
const cracks = new Map<string, Crack>();

/**
 * Сеть трещин из точки (0, 0): ветви `[угол, длина, ширина-у-корня]`,
 * извилистость `jag`, развилки с шансом `forkP`. Каждый пиксель знает путь
 * от корня — трещина «бежит», а не проявляется. `sq` — сплющивание пола.
 */
function crackOf(
  key: string,
  seed: number,
  br: [number, number, number][],
  jag = 0.5,
  forkP = 0.22,
  sq = 0.8,
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
      const ny = y + Math.sin(a) * 2 * sq;
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
  c = {
    x: Int16Array.from(pts.map((q) => q[0])),
    y: Int16Array.from(pts.map((q) => q[1])),
    d: Float32Array.from(pts.map((q) => q[2])),
    max: pts.length ? pts[pts.length - 1][2] : 0,
  };
  if (cracks.size > 60) cracks.delete(cracks.keys().next().value as string);
  cracks.set(key, c);
  return c;
}

/** Раскрытая трещина одним холстом на цвет (разломы лежат по две секунды). */
const crackImgs = new WeakMap<
  Crack,
  Map<string, { img: HTMLCanvasElement; x: number; y: number }>
>();
function crackImg(c: Crack, core: string, upTo: number) {
  let m = crackImgs.get(c);
  if (!m) {
    m = new Map();
    crackImgs.set(c, m);
  }
  const key = `${core}|${upTo}`;
  let hit = m.get(key);
  if (hit) return hit;
  let x0 = 1e9;
  let y0 = 1e9;
  let x1 = -1e9;
  let y1 = -1e9;
  for (let i = 0; i < c.x.length; i++) {
    if (c.d[i] > upTo) break;
    x0 = Math.min(x0, c.x[i]);
    y0 = Math.min(y0, c.y[i]);
    x1 = Math.max(x1, c.x[i]);
    y1 = Math.max(y1, c.y[i]);
  }
  if (x1 < x0) x0 = y0 = x1 = y1 = 0;
  const px = new Px(x1 - x0 + 1, y1 - y0 + 1);
  const k = hx(core);
  for (let i = 0; i < c.x.length && c.d[i] <= upTo; i++) px.set(c.x[i] - x0, c.y[i] - y0, k);
  hit = { img: px.canvas(), x: x0, y: y0 };
  // Жар в жёлобе отступает шагами: у одной трещины — десятки длин.
  if (m.size > 64) m.delete(m.keys().next().value as string);
  m.set(key, hit);
  return hit;
}

/**
 * Трещина до пути `reach`: тёмный жёлоб `core`; `hot` — жар в жёлобе
 * (доля остывания 0…1, у корня горячее), `hotTo` — докуда жар.
 */
function drawCrack(
  p: Pen,
  c: Crack,
  x: number,
  y: number,
  reach: number,
  core: string,
  a: number,
  hot = -1,
  hotTo = 0.6,
  thin?: Crack,
): void {
  if (a <= 0) return;
  const ox = Math.floor(x);
  const oy = Math.floor(y);
  if (reach >= c.max) {
    const im = crackImg(c, core, 1e9);
    p.col('#000', a);
    p.img(im.img, ox + im.x, oy + im.y);
  } else {
    p.col(core, a);
    for (let i = 0; i < c.x.length && c.d[i] <= reach; i++) p.dot(ox + c.x[i], oy + c.y[i]);
  }
  if (hot < 0 || hot >= 1) return;
  // Жар — в широкой части жёлоба; остывая, отступает к корню.
  // Жар — только по оси жёлоба (`thin`): во всю ширину он читался краской.
  const hc = thin ?? c;
  const lim = Math.min(reach, hc.max * hotTo * (1 - hot * 0.6));
  const st = Math.min(HEAT.length - 1, 2 + Math.floor(hot * 6));
  const im = crackImg(hc, HEAT[st], Math.round(lim / 2) * 2);
  p.col('#000', a * (1 - hot * 0.5));
  p.img(im.img, ox + im.x, oy + im.y);
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

// ---- Оттиски: неподвижное на полу рисуется один раз -------------------------

interface Stamp {
  img: HTMLCanvasElement;
  x: number;
  y: number;
}
const stamps = new WeakMap<object, Map<string, Stamp>>();

/**
 * Неподвижная часть метки или контакта (заливка, кромка, копоть, шов) —
 * холстом по рамке `box` (пиксели мира), один раз на удар и вариант.
 * Кадр кладёт его одним `drawImage` с нужной прозрачностью. Ключ — сам
 * удар или запись контакта: в бою это один и тот же объект все кадры.
 */
function stamp(
  key: object,
  variant: string,
  box: [number, number, number, number],
  draw: (q: Pen) => void,
): Stamp {
  let m = stamps.get(key);
  if (!m) {
    m = new Map();
    stamps.set(key, m);
  }
  let s = m.get(variant);
  if (s) return s;
  const x0 = Math.floor(box[0]) - 3;
  const y0 = Math.floor(box[1]) - 3;
  const px = new Px(
    Math.max(1, Math.ceil(box[2]) - x0 + 4),
    Math.max(1, Math.ceil(box[3]) - y0 + 4),
  );
  draw(new Pen(pxCtx(px) as unknown as CanvasRenderingContext2D, -x0, -y0, 0, 0));
  s = { img: px.canvas(), x: x0, y: y0 };
  m.set(variant, s);
  return s;
}

/**
 * Холст-притворщик для оттисков: точки и пролёты пишутся прямо в буфер
 * `Px`, а не вызовами холста. Кромка полосы в тридцать клеток — это две
 * тысячи точек; холстом они стоили миллисекунды в первый кадр волны.
 * Умеет ровно то, что зовут оттиски: цвет, прозрачность, прямоугольник.
 */
function pxCtx(px: Px) {
  const one = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  let rgba: RGBA = [0, 0, 0, 255];
  let last = '';
  let alpha = 1;
  return {
    canvas: { width: px.w, height: px.h },
    getTransform: () => one,
    set fillStyle(c: string) {
      if (c !== last) {
        last = c;
        rgba = hx(c.length === 4 ? `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}` : c);
      }
    },
    get fillStyle() {
      return last;
    },
    set globalAlpha(a: number) {
      alpha = a;
    },
    get globalAlpha() {
      return alpha;
    },
    fillRect(x: number, y: number, w: number, h: number) {
      const c: RGBA = [rgba[0], rgba[1], rgba[2], Math.round(rgba[3] * alpha)];
      const xa = Math.max(0, Math.round(x));
      const ya = Math.max(0, Math.round(y));
      const xb = Math.min(px.w, Math.round(x + w));
      const yb = Math.min(px.h, Math.round(y + h));
      for (let yy = ya; yy < yb; yy++) for (let xx = xa; xx < xb; xx++) px.set(xx, yy, c);
    },
  };
}

// ---- Общее для меток ---------------------------------------------------------

type FxZone = Zone & {
  ang?: number;
  len?: number;
  mob?: number;
  sweep?: number;
  cells?: number[];
  W?: number;
};

/**
 * Кромка полосы: две длинные стороны и торец, в два пикселя (тёмная —
 * снаружи). `run` — сдвиг пунктира (бежит по полосе), `null` — сплошная.
 */
function laneRim(
  p: Pen,
  ox: number,
  oy: number,
  ang: number,
  s0: number,
  s1: number,
  w: number,
  c: string,
  a: number,
  run: number | null,
  cap = true,
): void {
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  const nx = -uy;
  const ny = ux;
  // Два прохода — тень, потом кромка: цвет ставится дважды, а не на
  // каждую точку (разбор цвета дороже самой точки).
  for (const ink of [true, false]) {
    p.col(ink ? C.ink : c, ink ? a * 0.6 : a);
    for (const side of [-1, 1]) {
      for (let s = s0; s <= s1; s += 1) {
        if (run !== null && mod(s - run, 8) > 5) continue;
        const x = ox + ux * s + nx * w * side;
        const y = oy + uy * s + ny * w * side;
        if (ink) p.dot(x + nx * side, y + ny * side);
        else p.dot(x, y);
      }
    }
    if (!cap) continue;
    for (let q = -w; q <= w; q += 1) {
      const x = ox + ux * s1 + nx * q;
      const y = oy + uy * s1 + ny * q;
      if (ink) p.dot(x + ux, y + uy);
      else p.dot(x, y);
    }
  }
}

/**
 * Пол закипает: искорки поднимаются из площади метки, чаще к удару.
 * `pick(u, v)` — точка площади по двум долям 0…1.
 */
function simmer(
  p: Pen,
  seed: number,
  time: number,
  k: number,
  n: number,
  pick: (u: number, v: number) => [number, number],
): void {
  const m = Math.round(n * (0.3 + 0.7 * k));
  for (let i = 0; i < m; i++) {
    const rate = 1.3 + 1.6 * k;
    const ph = time * rate + hash(seed, i, 71);
    const cyc = Math.floor(ph);
    const f = ph - cyc;
    const [x, y] = pick(hash(seed, i, 72 + cyc * 3), hash(seed, i, 73 + cyc * 3));
    const z = f * (5 + 7 * k);
    p.col(heat(0.3 + f * 0.6), (1 - f) * (0.55 + 0.45 * k));
    p.dot(x, y - z);
  }
}

// =============================================================================
// УКУС — полоса r 3,55, полуширина 0,7, метка 0,6/h, бросок 7 кл/с в
// [T, T+0,18]. Метка: полоса, по которой к пасти бегут струйки жара (куда
// выстрелит голова), фронт жара идёт от змея с разгоном — как сам бросок;
// там, где голова кончит бросок (`BITE_AT` полосы), — ЧЕЛЮСТИ: тень
// головы и два ряда клыков, раскрытые широко, смыкаются ровно в миг урона.
// Контакт: огненное копьё броска сжимается к пасти, белые дуги челюстей
// схлопываются в звезду, из пасти — клуб пламени вперёд и искры, на полу —
// борозда от подбородка и опалённое пятно, пыль в стороны.
// =============================================================================

/** Где смыкаются челюсти: доля полосы (голова в конце броска). */
const BITE_AT = 0.8;

/** Овал вдоль (ux, uy): полуоси `l` вдоль и `w` поперёк — многоугольником. */
function fillLens(
  p: Pen,
  cx: number,
  cy: number,
  ux: number,
  uy: number,
  l: number,
  w: number,
): void {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < 16; i++) {
    const t = (i / 16) * TAU;
    const a = Math.cos(t) * l;
    const b = Math.sin(t) * w;
    xs.push(cx + ux * a - uy * b);
    ys.push(cy + uy * a + ux * b);
  }
  fillPoly(p, xs, ys);
}

/**
 * Челюсти в (ex, ey) мордой по (ux, uy): тень головы, линия десны и по n
 * клыков в ряду; `open` — раскрыв (пиксели от оси до кончиков клыков).
 */
function jaws(
  p: Pen,
  ex: number,
  ey: number,
  ux: number,
  uy: number,
  open: number,
  n: number,
  fang: string,
  a: number,
  shade: number,
): void {
  const nx = -uy;
  const ny = ux;
  // Тень головы: к удару гуще — голова уже над тобой.
  p.col(C.shadow, a * shade);
  fillLens(p, ex - ux * 5, ey - uy * 5, ux, uy, 9, open + 3.5);
  for (const side of [-1, 1]) {
    // Десна — тёмная дуга, клыки растут от неё к оси.
    p.col(C.ink, a * 0.85);
    for (let s = -n * 3.4; s <= 2; s += 1) {
      const bend = Math.max(0, -s - n * 2.4) * 0.35;
      p.dot(
        ex + ux * s + nx * (open + 3 + bend) * side,
        ey + uy * s + ny * (open + 3 + bend) * side,
        1,
        1,
      );
    }
    for (let i = 0; i < n; i++) {
      const s = -i * 3.4 - (side > 0 ? 0 : 1.7);
      // Передний клык — длиннее: у змея клыки у самого конца морды.
      const len = i === 0 ? 4.5 : 3.2;
      const bx = ex + ux * s + nx * (open + 2.6) * side;
      const by = ey + uy * s + ny * (open + 2.6) * side;
      const tx = ex + ux * s + nx * (open + 2.6 - len) * side;
      const ty = ey + uy * s + ny * (open + 2.6 - len) * side;
      p.col(C.ink, a * 0.9);
      fillPoly(
        p,
        [bx - ux * 1.9, bx + ux * 1.9, tx - nx * side * 0.9],
        [by - uy * 1.9, by + uy * 1.9, ty - ny * side * 0.9],
      );
      p.col(fang, a);
      fillPoly(p, [bx - ux * 1.2, bx + ux * 1.2, tx], [by - uy * 1.2, by + uy * 1.2, ty]);
    }
  }
}

registerZonePainter(
  'f6_bite',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const st = z as Strike;
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
    const w = (st.w ?? 0.7) * S;
    const s0 = S * 0.5;
    const jS = Math.max(s0 + 12, L * BITE_AT);
    const sig = left < SIG;
    const tk = !reduced() && tick(left);
    const sd = seedOf(st.id);
    // «Куда»: вся полоса с первого кадра, бледно — сквозь неё видно пол.
    // Заливка неподвижна — оттиском.
    const box = laneBox(cx, cy, a, L, w + 3);
    const base = stamp(st, 'fill', box, (q) => {
      q.col(C.redDk, 1);
      fillLane(q, cx, cy, a, s0, L, w);
    });
    p.col('#000', 0.22 + 0.1 * k);
    p.img(base.img, base.x, base.y);
    // «Когда»: фронт жара идёт к пасти с разгоном, как бросок.
    const front = s0 + (jS - s0) * Math.pow(k, 1.7);
    const fw = w * (0.45 + 0.55 * k);
    p.col(sig ? C.redHot : C.red, (tk ? 0.55 : 0.3) + 0.12 * k);
    fillLane(p, cx, cy, a, s0, front, fw);
    p.col(sig ? C.white : C.yellow, 0.85);
    for (let q = -fw; q <= fw; q += 1) p.dot(cx + ux * front + nx * q, cy + uy * front + ny * q);
    // Струйки жара бегут к пасти — показывают, куда выстрелит голова.
    const nS = Math.round(6 + 8 * k);
    const sp = 30 + 110 * k;
    for (let i = 0; i < nS; i++) {
      const span = L - s0;
      const s = s0 + mod(hash(sd, i, 1) * span + time * sp * (0.8 + 0.4 * hash(sd, i, 3)), span);
      const q = (hash(sd, i, 2) - 0.5) * 1.5 * w;
      const len = 2 + 4 * k;
      const edge = Math.min(1, (s - s0) / 8, (L - s) / 8);
      p.col(sig ? C.yellow : C.amber, (0.25 + 0.5 * k) * edge);
      p.line(
        cx + ux * (s - len) + nx * q,
        cy + uy * (s - len) + ny * q,
        cx + ux * s + nx * q,
        cy + uy * s + ny * q,
      );
    }
    // Кромка — пунктиром, бежит к пасти; полоса короткая, оттиск на каждый
    // шаг пунктира стоил бы дороже самих точек.
    laneRim(
      p,
      cx,
      cy,
      a,
      s0,
      L,
      w,
      sig ? (tk ? C.white : C.yellow) : k > 0.5 ? C.orange : C.redHot,
      0.7 + 0.3 * k,
      sig ? null : time * (26 + 50 * k),
      true,
    );
    simmer(p, sd, time, k, 8, (u, v) => {
      const s = s0 + (L - s0) * u;
      const q = (v - 0.5) * 2 * w;
      return [cx + ux * s + nx * q, cy + uy * s + ny * q];
    });
    // Челюсти: раскрыты во всю полосу, смыкаются к удару (ease-in — щелчок).
    const ex = cx + ux * jS;
    const ey = cy + uy * jS;
    const open = 1 + (w + 3) * (1 - eIn2(k));
    jaws(
      p,
      ex,
      ey,
      ux,
      uy,
      open,
      4,
      sig ? (tk ? C.white : '#fff2c8') : C.bone,
      0.8 + 0.2 * k,
      0.2 + 0.4 * k,
    );
  }),
);

registerImpactPainter('f6_bite', {
  life: 1.3,
  shake: 0.28,
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
      const L = (rec.r ?? 3.55) * S;
      const s0 = S * 0.5;
      const jS = Math.max(s0 + 12, L * BITE_AT);
      const sd = rec.seed;
      const few = reduced();
      const ex = cx + ux * jS;
      const ey = cy + uy * jS;
      // Высота пасти в броске: голова идёт на уровне груди героя.
      const lift = 8;
      const fade = 1 - k01((age - 0.8) / 0.5);
      // Пол: борозда — подбородок прочертил базальт, светлый край с одной стороны.
      p.col(C.groove, 0.6 * fade);
      fillLane(p, cx, cy, a, s0 + 6, jS, 0.6, 1.3);
      p.col(C.lip, 0.5 * fade);
      for (let s = s0 + 8; s < jS - 2; s += 1)
        if (hash(sd, Math.floor(s / 2), 5) < 0.7)
          p.dot(cx + ux * s + nx * 2.4, cy + uy * s + ny * 2.4);
      // Опалённое пятно, где сомкнулась пасть: жар остывает к краям.
      const cool = k01(age / 0.9);
      p.col(C.soot, 0.55 * fade);
      fillLens(p, ex + ux * 3, ey + uy * 3, ux, uy, 8, 5);
      p.col(heat(0.3 + cool * 0.7), (1 - cool) * 0.9);
      fillLens(p, ex + ux * 3, ey + uy * 3, ux, uy, 4 * (1 - cool * 0.4), 2.2 * (1 - cool * 0.4));
      // Пыль — невысоко в стороны от броска и вперёд от пасти.
      const mx = cx + ux * jS * 0.6;
      const my = cy + uy * jS * 0.6;
      puffs(p, sd, age, mx, my, few ? 1 : 3, a + Math.PI / 2, 0.4, 30, 20, 1, 4, 2, 0.6, 0, 0.6);
      puffs(
        p,
        sd + 1,
        age,
        mx,
        my,
        few ? 1 : 3,
        a - Math.PI / 2,
        0.4,
        30,
        20,
        1,
        4,
        2,
        0.6,
        0,
        0.6,
      );
      sky(time, () => {
        // Огненное копьё броска: голова прошла здесь — след сжимается к пасти.
        if (age < 0.17) {
          const q = eOut2(age / 0.17);
          const back = s0 + (jS - 4 - s0) * q;
          const span = Math.max(1, jS - back);
          for (let s = back; s <= jS; s += 1) {
            const u = (s - back) / span;
            const wd = (0.4 + 3.2 * u) * (1 - 0.5 * q);
            const x = cx + ux * s;
            const y = cy + uy * s - lift;
            const al = 1 - q * 0.5;
            p.col(u > 0.35 ? C.orange : C.red, al * 0.9);
            fillLens(p, x, y, ux, uy, 1, wd + 0.8);
            if (u > 0.2) {
              p.col(u > 0.6 ? C.yellow : C.amber, al);
              fillLens(p, x, y, ux, uy, 1, wd * 0.55);
            }
            if (u > 0.55) {
              p.col(C.white, al);
              p.dot(x, y);
            }
          }
          // Линии скорости по бокам копья.
          p.col(C.wind, 0.55 * (1 - q));
          for (const side of [-1, 1]) {
            const off = 7 + 2 * hash(sd, side + 2, 7);
            const s1 = back + (jS - back) * 0.2;
            p.line(
              cx + ux * s1 + nx * off * side,
              cy + uy * s1 + ny * off * side - lift,
              cx + ux * (jS - 5) + nx * off * side,
              cy + uy * (jS - 5) + ny * off * side - lift,
            );
          }
        }
        // Щелчок: белые дуги челюстей схлопываются — и звезда удара.
        if (age < 0.13) {
          const q = age / 0.13;
          const o = 9 * (1 - eOut3(Math.min(1, q * 2.2)));
          p.col(C.white, 1);
          for (const side of [-1, 1])
            for (let s = -7; s <= 3; s += 1) {
              const bend = ((s + 2) * (s + 2)) / 12;
              p.dot(
                ex + ux * s + nx * (o + bend) * side,
                ey + uy * s - lift + ny * (o + bend) * side,
                2,
                2,
              );
            }
          if (q > 0.4) {
            const k2 = (q - 0.4) / 0.6;
            p.col(k2 < 0.5 ? C.white : C.yellow, 1);
            star(p, ex + ux * 2, ey + uy * 2 - lift, 13 * (1 - 0.5 * k2), 6, a + 0.3);
          }
        }
        // Пламя из пасти: языки у пола под пастью и клуб огня вперёд.
        flames(
          p,
          sd,
          age - 0.02,
          time,
          few ? 3 : 6,
          (i) => {
            const d = 2 + i * 2.2 + hash(sd, i, 91) * 2;
            const q2 = (hash(sd, i, 92) - 0.5) * 8;
            return [ex + ux * d + nx * q2, ey + uy * d + ny * q2 + 1, i * 0.025];
          },
          7,
          7,
          0.5,
          0.05,
        );
        const t2 = age - 0.02;
        if (t2 > 0 && t2 < 0.45)
          for (let i = 0; i < (few ? 4 : 9); i++) {
            const th = a + (hash(sd, i, 81) - 0.5) * 1.1;
            const L2 = 0.25 + 0.2 * hash(sd, i, 83);
            const k2 = t2 / L2;
            if (k2 >= 1) continue;
            const d = drag(60 + 50 * hash(sd, i, 82), 7, t2);
            const r = 1.2 + 2.6 * Math.sin(Math.min(1, k2 * 1.4) * Math.PI * 0.85);
            const im = blobImg(r, Math.min(5, Math.floor(k2 * 5.5)));
            p.col('#000', k2 < 0.75 ? 0.95 : (1 - k2) * 3.8);
            p.img(
              im,
              ex + Math.cos(th) * d - im.width / 2,
              ey - lift * (1 - k2 * 0.6) - 4 * k2 + Math.sin(th) * d * 0.8 - im.height / 2,
            );
          }
        sparks(p, sd, age, ex, ey - lift, few ? 5 : 12, a, 0.7, 70, 70, 0.5, 40);
        glow(p, ex, ey - 4, 34, 26, 0.8 * (1 - k01(age / 0.55)));
      });
    },
  ),
});

// =============================================================================
// ХВОСТ — круг r 2,4 вокруг змея, метка 0,8/h. Метка: «часы» — сектор
// заметает круг от спины змея и замыкается ровно в миг урона; фронт — тень
// хвоста с тающими копиями, под ней пыль. Контакт: хвост проходит полный
// круг раскалённым смазом за 0,12 с, на конце — щелчок кнута, волна и пыль
// разлетаются спиралью, по полу — кольцевая борозда.
// =============================================================================

/** Откуда и куда метёт хвост: от спины змея, по часовой. */
function tailFrom(from: number | undefined): { a0: number; dir: number } {
  const m = mobOf(from);
  const face = m ? m.face : 0;
  return { a0: face + Math.PI, dir: 1 };
}
const tailDirs = new WeakMap<object, { a0: number; dir: number }>();
const tailOf = (key: object, from: number | undefined) => {
  let v = tailDirs.get(key);
  if (!v) {
    v = tailFrom(from);
    tailDirs.set(key, v);
  }
  return v;
};
/** Последняя метка хвоста — её направление берёт контакт. */
let lastTail: { a0: number; dir: number; x: number; y: number } | null = null;

registerZonePainter(
  'f6_tail',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const st = z as Strike;
    const k = k01(st.t / Math.max(0.01, st.warn));
    const left = st.warn - st.t;
    const cx = st.x * S;
    const cy = st.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = st.r * S;
    const sq = 0.8;
    const sig = left < SIG;
    const tk = !reduced() && tick(left);
    const sd = seedOf(st.id);
    const { a0, dir } = tailOf(st, st.from);
    lastTail = { a0, dir, x: st.x, y: st.y };
    // «Куда»: круг целиком.
    p.col(C.redDk, 0.28 + 0.08 * k);
    fillEll(p, cx, cy, R, R * sq);
    // «Когда»: сектор заметает круг и замыкается в миг удара.
    const sw = TAU * Math.pow(k, 1.35);
    const lo = dir > 0 ? a0 : a0 - sw;
    p.col(sig ? C.redHot : C.red, (tk ? 0.6 : 0.34) + 0.1 * k);
    fillSector(p, cx, cy, S * 0.4, R, lo, lo + sw, sq);
    // Фронт — тень хвоста и три тающие копии за ней.
    const fa = a0 + dir * sw;
    for (let j = 3; j >= 0; j--) {
      const aa = fa - dir * j * 0.13;
      p.col(C.shadow, (j === 0 ? 0.8 : 0.35 - j * 0.08) * (0.5 + 0.5 * k));
      const ca = Math.cos(aa);
      const sa = Math.sin(aa);
      for (let r = R * 0.3; r <= R * 0.96; r += 1) {
        const wd = 1 + (r / R) * 1.6;
        p.dot(cx + ca * r - sa * wd * dir, cy + sa * r * sq - ca * wd * dir * sq, 2, 2);
      }
    }
    // Пыль из-под хвоста — там, где сейчас фронт.
    for (let i = 0; i < 5; i++) {
      const ph = (time * 3 + hash(sd, i, 91)) % 1;
      const rr = R * (0.55 + 0.4 * hash(sd, i, 92));
      const aa = fa - dir * ph * 0.5;
      const im = puffImg(0, 1 + ph * 3 * (0.5 + k), i);
      p.col('#000', (1 - ph) * 0.6 * (0.3 + 0.7 * k));
      p.img(
        im,
        cx + Math.cos(aa) * (rr + ph * 5) - im.width / 2,
        cy + Math.sin(aa) * (rr + ph * 5) * sq - ph * 4 - im.height / 2,
      );
    }
    // Кромка: пунктир бежит по кругу всё быстрее; у сигнала — сплошная.
    const run = time * (3 + 10 * k) * dir;
    ring(
      p,
      cx,
      cy,
      R,
      sig ? (tk ? C.white : C.yellow) : k > 0.5 ? C.orange : C.redHot,
      0.75 + 0.25 * k,
      sig ? undefined : (ang) => mod(ang * 6 - run, TAU / 4) < TAU / 7,
      0.6,
      sq,
    );
    simmer(p, sd, time, k, 12, (u, v) => {
      const aa = u * TAU;
      const rr = R * Math.sqrt(v);
      return [cx + Math.cos(aa) * rr, cy + Math.sin(aa) * rr * sq];
    });
  }),
);

registerImpactPainter('f6_tail', {
  life: 1.4,
  shake: 0.32,
  paint: guarded(
    (g, rec: ImpactRec, px: number, py: number, S: number, age: number, time: number) => {
      const cx = rec.x * S;
      const cy = rec.y * S;
      const p = new Pen(g, px, py, cx, cy);
      const R = (rec.r ?? 2.4) * S;
      const sq = 0.8;
      const sd = rec.seed;
      const few = reduced();
      const same = lastTail && Math.hypot(lastTail.x - rec.x, lastTail.y - rec.y) < 0.2;
      const a0 = same && lastTail ? lastTail.a0 : 0;
      const dir = same && lastTail ? lastTail.dir : 1;
      const fade = 1 - k01((age - 0.8) / 0.6);
      // Пол: кольцевая борозда, прочерченная концом хвоста.
      const rg = R * 0.8;
      ring(p, cx, cy + 1, rg + 1, C.lip, 0.45 * fade, (_a, i) => hash(i >> 2, sd, 3) > 0.25, 0, sq);
      ring(p, cx, cy, rg, C.groove, 0.75 * fade, (_a, i) => hash(i >> 2, sd, 3) > 0.25, 0, sq);
      // Пыль: кольцом, по спирали — хвост тянет её за собой.
      for (let i = 0; i < (few ? 6 : 16); i++) {
        const aa = a0 + (i / 16) * TAU + hash(sd, i, 1) * 0.3;
        const t = age - (i / 16) * 0.12;
        if (t < 0) continue;
        const L = 0.65 + 0.3 * hash(sd, i, 2);
        if (t > L) continue;
        const kk = t / L;
        const d = rg + drag(60 + 30 * hash(sd, i, 3), 3.4, t);
        const spin = dir * drag(1.4, 3, t);
        // Клуб растёт и редеет, поднимаясь: пыль, а не камень на полу.
        const im = puffImg(0, 1.5 + 5 * eOut2(kk), i);
        p.col('#000', 0.6 * Math.pow(1 - kk, 1.6));
        p.img(
          im,
          cx + Math.cos(aa + spin) * d - im.width / 2,
          cy + Math.sin(aa + spin) * d * sq - kk * 11 - im.height / 2,
        );
      }
      chips(p, sd, age, cx, cy, few ? 4 : 10, a0, Math.PI, 40, 40, 50, 60, [0.9, 1.35], 0.2, 0.3);
      // Смаз хвоста: кольцевая полоса проходит круг за 0,12 с — голова
      // белая, дальше жёлтое, оранжевое, багровое; хвост смаза тает раньше.
      // Дальняя (северная) половина круга идёт ЗА телом змея — рисуется на
      // полу, под мобами; ближняя — поверх.
      const SW = 0.12;
      const smear = (front: boolean) => {
        if (age >= SW + 0.1) return;
        const q = Math.min(1, age / SW);
        const head = TAU * eOut2(q);
        const out = age > SW ? (age - SW) / 0.1 : 0;
        const segs = 26;
        const d = (TAU * 0.7) / segs;
        const GR = [
          C.white,
          C.yellow,
          C.yellow,
          C.amber,
          C.amber,
          C.orange,
          C.orange,
          C.orange,
          C.redHot,
          C.redHot,
          C.red,
          C.red,
          C.redDk,
          C.redDk,
        ];
        const part = (r0: number, r1: number, lo: number, hi: number) => {
          for (let k = Math.floor(lo / Math.PI); k * Math.PI < hi; k++) {
            if ((mod(k, 2) === 0) !== front) continue;
            const s0 = Math.max(lo, k * Math.PI);
            const s1 = Math.min(hi, (k + 1) * Math.PI);
            if (s1 > s0) fillSector(p, cx, cy - 3, r0, r1, s0, s1, sq);
          }
        };
        for (let j = segs - 1; j >= 0; j--) {
          const b1 = head - j * d;
          const b0 = head - (j + 1) * d;
          if (b1 <= 0) continue;
          const lo2 = Math.max(0, b0);
          const al = Math.pow(1 - j / segs, 0.9) * (1 - out);
          if (al <= 0.03) continue;
          const r0 = R * (0.62 + (0.28 * j) / segs);
          const r1 = R * (0.97 - (0.17 * j) / segs);
          p.col(GR[Math.floor((j * GR.length) / segs)], al * 0.95);
          if (dir > 0) part(r0, r1, a0 + lo2, a0 + b1 + 0.02);
          else part(r0, r1, a0 - b1 - 0.02, a0 - lo2);
        }
        // Кромка смаза — белая нить по внешнему краю у головы.
        const ha = a0 + dir * head;
        p.col(C.white, 1 - out);
        for (let da = 0; da < 0.7; da += 0.04) {
          const aa = ha - dir * da;
          if (Math.sin(aa) >= 0 !== front) continue;
          p.dot(cx + Math.cos(aa) * (R + 1), cy - 3 + Math.sin(aa) * (R + 1) * sq);
        }
      };
      // Искры срываются с конца хвоста по касательной, пока он проходит
      // круг, — не из середины змея (там они блестели на брюхе).
      const tailSparks = (front: boolean) => {
        for (let k = 0; k < 4; k++) {
          const u = (k + 0.5) / 4;
          const aa = a0 + dir * TAU * u;
          if (Math.sin(aa) >= 0 !== front) continue;
          const ex = cx + Math.cos(aa) * R * 0.85;
          const ey = cy - 3 + Math.sin(aa) * R * 0.85 * sq;
          const lag = SW * (1 - Math.sqrt(1 - u));
          sparks(
            p,
            sd + k * 7,
            age - lag,
            ex,
            ey,
            few ? 2 : 4,
            aa + (dir * Math.PI) / 2 - dir * 0.4,
            0.6,
            70,
            50,
            0.4,
            40,
          );
        }
      };
      smear(false);
      tailSparks(false);
      sky(time, () => {
        smear(true);
        tailSparks(true);
        // Щелчок кнута на конце круга.
        if (age > 0.09 && age < 0.19) {
          const q = (age - 0.09) / 0.1;
          const ta = a0 + dir * TAU;
          p.col(q < 0.5 ? C.white : C.yellow, 1);
          star(p, cx + Math.cos(ta) * R, cy - 3 + Math.sin(ta) * R * sq, 10 * (1.1 - q), 4, 0.4);
        }
        // Волна: от кольца наружу, рваная.
        if (age < 0.32) {
          const q = age / 0.32;
          ring(
            p,
            cx,
            cy,
            R * (0.9 + 0.8 * eOut2(q)),
            C.wind,
            0.9 * (1 - q),
            (_a, i) => hash(i >> 2, sd, 9) > 0.3,
            0.5,
            sq,
          );
        }
      });
    },
  ),
});

// =============================================================================
// ВОЛНА ПЛАМЕНИ — шесть полос поперёк, метка (1,05 + 0,22k)/h: фронт огня
// идёт от змея. Метка полосы: залита, по оси — раскалённый шов, который
// наливается к удару, шевроны показывают, куда идёт волна; в последние
// 0,3 с из шва уже прыскают огоньки. Контакт полосы: стена языков пламени
// встаёт за 0,07 с и опадает, дым и угольки вверх, пол в копоти с
// остывающим швом, пепел ложится.
// Полоса бывает в тридцать клеток: всё неподвижное в ней (заливка, кромки,
// шов, копоть) — оттиски `stamp`, кадр кладёт их целиком.
// =============================================================================

/** Рамка полосы в пикселях мира. */
function laneBox(
  ox: number,
  oy: number,
  ang: number,
  L: number,
  w: number,
): [number, number, number, number] {
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  const xs = [ox - uy * w, ox + uy * w, ox + ux * L - uy * w, ox + ux * L + uy * w];
  const ys = [oy + ux * w, oy - ux * w, oy + uy * L + ux * w, oy + uy * L - ux * w];
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Шов полосы: тёмная трещина по оси; `drop` — доля выпавших (остывших) точек. */
function seamPx(
  q: Pen,
  sd: number,
  cx: number,
  cy: number,
  a: number,
  L: number,
  drop: number,
): void {
  const bx = Math.cos(a);
  const by = Math.sin(a);
  for (let s = 1; s < L - 1; s += 1) {
    const h = hash(sd, Math.floor(s), 4);
    if (h < 0.12 || h < drop) continue;
    const j = hash(sd, Math.floor(s / 7), 2) < 0.3 ? 1 : 0;
    q.dot(cx + bx * s + by * j, cy + by * s - bx * j);
  }
}

registerZonePainter(
  'f6_wave',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const st = z as Strike & { band?: number };
    const k = k01(st.t / Math.max(0.01, st.warn));
    const left = st.warn - st.t;
    const cx = st.x * S;
    const cy = st.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const a = st.ang ?? 0;
    const bx = Math.cos(a);
    const by = Math.sin(a);
    // Куда идёт волна — поперёк полосы, от змея.
    const ux = by;
    const uy = -bx;
    const L = st.r * S;
    const w = (st.w ?? 0.62) * S;
    const sig = left < SIG;
    const tk = !reduced() && tick(left);
    const sd = seedOf(st.id);
    const box = laneBox(cx, cy, a, L, w + 2);
    // Далёкие полосы видны бледнее, пока до них не дошло.
    const near = k01((k - 0.35) / 0.65);
    const base = stamp(st, 'fill', box, (q) => {
      q.col(C.redDk, 1);
      fillLane(q, cx, cy, a, 0, L, w);
    });
    p.col('#000', 0.24 + 0.14 * near);
    p.img(base.img, base.x, base.y);
    if (near > 0) {
      const lv = Math.max(1, Math.round(near * 5));
      const hot = sig ? 1 : 0;
      const nf = stamp(st, `near${lv}|${hot}`, box, (q) => {
        q.col(hot ? C.redHot : C.red, 1);
        fillLane(q, cx, cy, a, 0, L, w * (0.3 + (0.7 * lv) / 5));
      });
      p.col('#000', (tk ? 0.55 : 0.3) * near);
      p.img(nf.img, nf.x, nf.y);
    }
    // Шов по оси — наливается жаром: сперва тёмная трещина, к удару — жёлтая.
    const hs = Math.min(HEAT.length - 1, Math.floor((sig ? 0.12 : 0.8 - 0.55 * k) * HEAT.length));
    const seam = stamp(st, `seam${hs}`, box, (q) => {
      q.col(HEAT[hs], 1);
      seamPx(q, sd, cx, cy, a, L, 0);
    });
    p.col('#000', 0.45 + 0.55 * k);
    p.img(seam.img, seam.x, seam.y);
    // Шевроны: куда пойдёт волна (от змея). Ползут поперёк полосы.
    // Сдвиг — целыми точками, поэтому шевроны тоже оттиск (полоса длинная:
    // точками это три сотни вызовов на полосу за кадр).
    const shift = Math.round(((time * (4 + 8 * k)) % 1) * 3 - 1.5);
    const cc = sig ? C.yellow : C.amber;
    const chev = stamp(st, `chev${shift}|${cc}`, box, (q) => {
      q.col(cc, 1);
      for (let s = 12; s < L - 8; s += 26) {
        for (let e = -4; e <= 4; e++) {
          const d = (4 - Math.abs(e)) * 0.9 + shift;
          q.dot(cx + bx * (s + e) + ux * d, cy + by * (s + e) + uy * d, 1, 1);
          q.dot(cx + bx * (s + e) + ux * (d - 1), cy + by * (s + e) + uy * (d - 1), 1, 1);
        }
      }
    });
    p.col('#000', 0.3 + 0.45 * k);
    p.img(chev.img, chev.x, chev.y);
    const rc = sig ? (tk ? C.white : C.yellow) : near > 0.3 ? C.orange : C.redHot;
    const rim = stamp(st, `rim${rc}`, box, (q) =>
      laneRim(q, cx, cy, a, 0, L, w, rc, 1, null, false),
    );
    p.col('#000', 0.55 + 0.45 * k);
    p.img(rim.img, rim.x, rim.y);
    // Прыскают огоньки: полоса вот-вот вспыхнет.
    if (left < 0.32) {
      const q = 1 - left / 0.32;
      sky(time, () =>
        flames(
          p,
          sd,
          q * 0.5,
          time,
          Math.floor(L / 10),
          (i) => [
            cx + bx * (5 + i * 10 + hash(sd, i, 3) * 5),
            cy + by * (5 + i * 10),
            hash(sd, i, 4) * 0.25,
          ],
          2 + 5 * q,
          3,
          0.6,
          0.1,
        ),
      );
    }
  }),
);

registerImpactPainter('f6_wave', {
  life: 2.2,
  shake: 0.1,
  paint: guarded(
    (g, rec: ImpactRec, px: number, py: number, S: number, age: number, time: number) => {
      const cx = rec.x * S;
      const cy = rec.y * S;
      const p = new Pen(g, px, py, cx, cy);
      const a = rec.ang ?? 0;
      const bx = Math.cos(a);
      const by = Math.sin(a);
      const ux = by;
      const uy = -bx;
      const L = (rec.r ?? 4) * S;
      const w = (rec.w ?? 0.62) * S;
      const sd = rec.seed;
      const few = reduced();
      const fade = 1 - k01((age - 1.4) / 0.8);
      const box = laneBox(cx, cy, a, L, w + 2);
      // Пол: копоть полосой с рваными краями.
      const soot = stamp(rec, 'soot', box, (q) => {
        q.col(C.soot, 1);
        for (let s = 0; s < L; s += 2) {
          const e0 = w * (0.55 + 0.35 * hash(sd, Math.floor(s / 2), 1));
          const e1 = w * (0.55 + 0.35 * hash(sd, Math.floor(s / 2), 2));
          fillLane(q, cx + bx * s, cy + by * s, a + Math.PI / 2, -e0, e1, 1, 1);
        }
      });
      p.col('#000', 0.5 * fade);
      p.img(soot.img, soot.x, soot.y);
      // Шов остывает: белый → красный → тёмный, точки гаснут по одной.
      const cool = k01(age / 1.6);
      if (cool < 1) {
        const hs = Math.min(HEAT.length - 1, Math.floor((0.15 + cool * 0.85) * HEAT.length));
        const drop = cool > 0.4 ? cool - 0.3 : 0;
        const dq = Math.round(drop * 10);
        const seam = stamp(rec, `seam${hs}|${dq}`, box, (q) => {
          q.col(HEAT[hs], 1);
          seamPx(q, sd, cx, cy, a, L, dq / 10);
        });
        p.col('#000', 0.95 * (1 - cool * 0.5));
        p.img(seam.img, seam.x, seam.y);
      }
      const n = Math.max(3, Math.floor(L / 4));
      sky(time, () => {
        // Свет стены — пол вокруг оживает.
        const gl = age < 0.08 ? age / 0.08 : 1 - k01((age - 0.15) / 0.55);
        if (gl > 0.02)
          for (let s = L * 0.15; s < L; s += L / Math.max(1, Math.round(L / 40)))
            if (p.sees(cx + bx * s, cy + by * s, 34))
              glow(p, cx + bx * s, cy + by * s, 34, 24, 0.5 * gl);
        // Стена огня: языки вразброс по ширине полосы — не забор, а пожар.
        flames(
          p,
          sd,
          age,
          time,
          n,
          (i) => {
            const s = (i + 0.5) * (L / n) + (hash(sd, i, 7) - 0.5) * 2;
            const off = (hash(sd, i, 8) - 0.5) * w * 1.1;
            return [cx + bx * s + ux * off, cy + by * s + uy * off, hash(sd, i, 9) * 0.04];
          },
          few ? 9 : 12,
          7,
          0.55,
          0.07,
        );
        // Угольки вверх и дым из-за стены.
        for (let s = 0; s < L; s += 48) {
          const sx = cx + bx * (s + 24);
          const sy = cy + by * (s + 24);
          if (!p.sees(sx, sy - 10, 48)) continue;
          embersUp(p, sd + s, age - 0.05, sx, sy, 20, 6, few ? 3 : 7, 1.3, 34, 0.5);
          puffs(
            p,
            sd + s,
            age - 0.25,
            sx,
            sy - 10,
            few ? 1 : 3,
            -Math.PI / 2,
            0.8,
            4,
            6,
            3,
            8,
            16,
            1.4,
            1,
            0.55,
            0.4,
          );
        }
        // Пепел ложится на выжженное.
        ashFall(
          p,
          sd,
          age,
          cx + (bx * L) / 2,
          cy + (by * L) / 2,
          Math.abs(bx * L) / 2 + 8,
          Math.abs(by * L) / 2 + 8,
          few ? 6 : Math.min(28, Math.floor(L / 10)),
          0.5,
          1.6,
          26,
        );
      });
    },
  ),
});

// Стена огня — рисует контакт полосы (`f6_wave` выше): у этой зоны та же
// минута и то же место, второй раз огонь не рисуем.
registerZonePainter('f6_waveflame', () => true);

// =============================================================================
// ДЫХАНИЕ — струя изо рта. В волне (0,8 с, r 3,2): струя бьёт в пол перед
// змеем и расходится по нему в стороны — отсюда пошла волна. В веере
// (sweep = ±1, 1,2/h + 0,3 с, r 7): струя метёт сектор за сектором и
// стелется ковром до края; ось струи проходит середину каждого сектора
// ровно в миг его удара. Струя — сплошной тугой шнур от пасти до пола
// (белое ядро, жёлтое, оранжевое, багровая кромка, дрожит), по полу —
// капли огня, у пасти белые, к краю остывают в дым; за струёй по полу
// остаются языки пламени.
// =============================================================================

interface JetPt {
  x: number;
  y: number;
  k: number;
  r: number;
}

/**
 * Капля, упавшая из струи в точку (gx, gy) под углом `ang`, возраст `tau`
 * после падения: стелется по полу до `reach` с сопротивлением и
 * расходится в сторону `side` (в волне — вдоль полосы, `lat`).
 */
function dropAt(
  gx: number,
  gy: number,
  ang: number,
  tau: number,
  reach: number,
  life: number,
  side: number,
  lat: number,
): JetPt | null {
  if (tau < 0 || tau > life) return null;
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  const q = tau / life;
  const s = (reach * (1 - Math.exp(-4 * q))) / (1 - Math.exp(-4));
  const sp = side * lat * (1 - Math.exp(-5 * q));
  return {
    x: gx + ux * s - uy * sp,
    y: gy + uy * s * 0.9 + ux * sp * 0.9 - 3 * q,
    k: q,
    r: 1.2 + 2.2 * Math.sin(Math.min(1, q * 1.3) * Math.PI * 0.8),
  };
}

registerZonePainter(
  'f6_breath',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const zz = z as FxZone;
    const t = zz.t;
    const life = zz.life;
    const cx = zz.x * S;
    const cy = zz.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const few = reduced();
    const sweep = zz.sweep ?? 0;
    const m = serpent();
    const mo = m && Math.hypot(m.x - zz.x, m.y - zz.y) < 2.5 ? mouthOf(m, time) : null;
    const base = zz.ang ?? 0;
    // Без змея (лист кадров) — пасть там, где её рисовал прежний кадр.
    const mx = mo ? mo.x : cx + 22 * (Math.cos(base) < 0 ? -1 : 1);
    const my = mo ? mo.y : cy - 30;
    // Угол струи: в волне — прямо, в веере — от края к краю.
    const D = sweep ? Math.max(0.3, life - 0.3) : life;
    const angAt = (te: number) =>
      sweep ? base + sweep * Math.min(1.65, -1.375 + 3.3 * k01(te / D)) : base;
    const reach = (sweep ? (zz.r ?? 7) - 1.7 : 0.6) * S;
    const d0 = (sweep ? 1.7 : 1.5) * S;
    const lat = sweep ? 5 : 22;
    const plife = sweep ? 0.55 : 0.45;
    const dt = few ? 1 / 30 : 1 / 60;
    const stop = sweep ? D + 0.06 : life - 0.12;
    const sd = seedOf(zz.id);
    const tf = 0.08;
    sky(time, () => {
      // Огонь по полу: каждая порция струи бежит от места удара языком
      // пламени — растёт, стелется, опадает и уходит дымком. Не шарики:
      // круглые капли читались бусами.
      for (let te = Math.max(0, t - tf - plife); te <= Math.min(t - tf, stop); te += dt) {
        const j = Math.round(te / dt);
        const ang = angAt(te) + (hash(sd, j, 1) - 0.5) * 0.1;
        const gx = cx + Math.cos(ang) * d0;
        const gy = cy + Math.sin(ang) * d0;
        const taper = k01((stop - te) / 0.2) * k01(te / 0.05 + 0.3);
        for (let s = 0; s < 2; s++) {
          const pt = dropAt(
            gx,
            gy,
            ang,
            t - tf - te,
            reach * (0.65 + 0.35 * hash(sd, j, 2 + s)),
            plife,
            (hash(sd, j, 4 + s) - 0.5) * 2,
            lat,
          );
          if (!pt) continue;
          if (hidden(time, pt.x, pt.y + 2)) continue;
          if (pt.k > 0.78) {
            if ((j + s) % 3) continue;
            const im = puffImg(1, 1 + (pt.k - 0.78) * 12, j);
            p.col('#000', 0.45 * (1 - (pt.k - 0.78) / 0.22));
            p.img(im, pt.x - im.width / 2, pt.y - im.height / 2 - (pt.k - 0.78) * 30);
            continue;
          }
          const h = (3 + 8 * Math.sin(Math.min(1, pt.k / 0.78) * Math.PI)) * (0.5 + 0.5 * taper);
          if (h < 2.5) continue;
          const im = flameImg(h, (j + s + Math.floor(time * 12)) & 3);
          p.col('#000', 1);
          p.img(im, pt.x - im.width / 2, pt.y + 2 - im.height);
        }
      }
      // Языки пламени, оставшиеся там, где прошла струя.
      const nT = Math.floor(Math.min(t, stop + plife) / 0.05);
      flames(
        p,
        sd,
        t,
        time,
        Math.min(nT + 1, 60),
        (i) => {
          const te = i * 0.05;
          const ang = angAt(Math.min(te, stop)) + (hash(sd, i, 11) - 0.5) * 0.3;
          const d = d0 + (reach + (sweep ? 0 : 8)) * (0.2 + 0.75 * hash(sd, i, 12));
          const side = sweep ? 0 : (hash(sd, i, 13) - 0.5) * 2 * lat;
          return [
            cx + Math.cos(ang) * d - Math.sin(ang) * side,
            cy + Math.sin(ang) * d * 0.9 + Math.cos(ang) * side * 0.9,
            te + tf + 0.06,
          ];
        },
        6,
        6,
        0.45,
        0.06,
      );
      // Струя: от пасти к полу расширяется конусом, провисает, края рвутся
      // и дрожат (ширина — шум по времени), ядро белое только у пасти.
      const on = k01(t / 0.05) * k01((stop - t) / 0.12);
      if (on > 0.02) {
        const ang = angAt(t);
        const gx = cx + Math.cos(ang) * d0;
        const gy = cy + Math.sin(ang) * d0;
        const c1x = (mx + gx) / 2 + Math.cos(ang) * 5;
        const c1y = (my + gy) / 2 - 6;
        const N = Math.max(4, Math.ceil(Math.hypot(gx - mx, gy - my)));
        const fr = Math.floor(time * 24);
        const LAY: [string, number, number][] = [
          [C.red, 1.3, 0],
          [C.orange, 1, 0],
          [C.amber, 0.62, 0.08],
          [C.yellow, 0.36, 0.12],
          [C.white, 0.18, 0.25],
        ];
        for (const [col, kw, from] of LAY) {
          p.col(col, on);
          for (let i = 0; i <= N; i++) {
            const u = i / N;
            if (u < from) continue;
            const x = (1 - u) * (1 - u) * mx + 2 * u * (1 - u) * c1x + u * u * gx;
            const y = (1 - u) * (1 - u) * my + 2 * u * (1 - u) * c1y + u * u * gy;
            // Край рвётся: у каждого шага и кадра своя толщина.
            const jit = 0.75 + 0.5 * hash(i, fr, 3);
            const wob = Math.sin(time * 40 - u * 12) * 1.1 * u;
            const w = (1 + 3.6 * u * u) * kw * on * jit * (col === C.white ? 1 - u * 0.8 : 1);
            if (w < 0.4) continue;
            const hw = Math.round(w);
            p.rect(
              Math.round(x - hw + wob * 0.5),
              Math.round(y - hw + wob),
              Math.max(1, hw * 2),
              Math.max(1, hw * 2),
            );
          }
        }
        // Языки по струе: огонь горит на ней вверх — не луч, а пламя.
        for (let i = 2; i < N - 2; i += 5) {
          const u = i / N;
          if (u < 0.3) continue;
          const x = (1 - u) * (1 - u) * mx + 2 * u * (1 - u) * c1x + u * u * gx;
          const y = (1 - u) * (1 - u) * my + 2 * u * (1 - u) * c1y + u * u * gy;
          const hh = (3 + 5 * u) * (0.6 + 0.4 * hash(i, fr >> 1, 7)) * on;
          if (hh < 2.5) continue;
          const im = flameImg(hh, (i + fr) & 3);
          p.col('#000', 0.9);
          p.img(
            im,
            x - im.width / 2 + (hash(i, 3, 8) - 0.5) * 3,
            y - im.height + 1 - (1 + 2.6 * u * u) * 0.8,
          );
        }
        // Клочья пламени отрываются от струи и тают вверх.
        for (let i = 0; i < (few ? 3 : 8); i++) {
          const ph = (time * 3.2 + hash(sd, i, 51)) % 1;
          const u = 0.25 + 0.7 * hash(sd, i, 52 + Math.floor(time * 3.2 + hash(sd, i, 51)));
          const x = (1 - u) * (1 - u) * mx + 2 * u * (1 - u) * c1x + u * u * gx;
          const y = (1 - u) * (1 - u) * my + 2 * u * (1 - u) * c1y + u * u * gy;
          const im = blobImg(2.4 - ph * 1.4, Math.min(5, 1 + Math.floor(ph * 5)));
          p.col('#000', on * (1 - ph));
          p.img(
            im,
            x - im.width / 2 + (hash(sd, i, 53) - 0.5) * 6 * ph,
            y - im.height / 2 - ph * 9,
          );
        }
        // Удар струи в пол — не пятно, а куст огня и брызги.
        flames(
          p,
          sd + Math.floor(t * 10),
          ((t * 10) % 1) * 0.5,
          time,
          4,
          (i) => [gx + (i - 1.5) * 3.5, gy + (i % 2), 0],
          8 * on,
          5,
          0.6,
          0.04,
        );
        sparks(
          p,
          sd + Math.floor(t * 20),
          ((t * 20) % 1) * 0.3,
          gx,
          gy - 1,
          few ? 2 : 5,
          ang,
          1.2,
          40,
          50,
          0.3,
          30,
        );
        glow(p, mx, my, 22, 18, 0.8 * on);
        glow(p, gx, gy, 44, 32, 0.7 * on);
        p.col(C.white, on);
        star(p, mx, my, 3.5 + Math.sin(time * 40) * 0.8, 4, time * 3);
      }
      // Свет от ковра огня (в веере — у фронта струи).
      if (sweep) {
        const ang = angAt(Math.min(t, stop));
        glow(
          p,
          cx + Math.cos(ang) * (d0 + reach * 0.5),
          cy + Math.sin(ang) * (d0 + reach * 0.5),
          50,
          36,
          0.5 * k01((stop + 0.4 - t) / 0.4),
        );
      }
    });
  }),
);

// =============================================================================
// ВДОХ — перед волной и веером (время метки): жар стягивается в пасть.
// Угольки со всей арены летят спиралью ко рту, всё быстрее; горло
// разгорается; за 0,12 с до выдоха — белая вспышка в пасти: «сейчас».
// =============================================================================

registerZonePainter(
  'f6_fxinhale',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const zz = z as FxZone;
    const t = zz.t;
    const T = zz.life;
    const m = mobOf(zz.mob) ?? serpent();
    if (!m) return;
    const cx = m.x * S;
    const cy = m.y * S;
    const p = new Pen(g, px + (m.x - zz.x) * S, py + (m.y - zz.y) * S, cx, cy);
    const mo = mouthOf(m, time);
    const sd = seedOf(zz.id);
    const few = reduced();
    const k = k01(t / T);
    sky(time, () => {
      const n = few ? 8 : 22;
      for (let i = 0; i < n; i++) {
        const born = hash(sd, i, 1) * T * 0.7;
        const dur = 0.3 + 0.25 * hash(sd, i, 2);
        const q = (t - born) / dur;
        if (q < 0 || q > 1) continue;
        const a0 = hash(sd, i, 3) * TAU;
        const d0 = S * (1.6 + 1.6 * hash(sd, i, 4));
        const sx = cx + Math.cos(a0) * d0;
        const sy = cy + Math.sin(a0) * d0 * 0.8 - 4;
        // Спираль к пасти: угол доворачивается, путь — с разгоном.
        const e = eIn2(q);
        const sw = (1 - e) * 1.2 * (i % 2 ? 1 : -1);
        const dx = sx - mo.x;
        const dy = sy - mo.y;
        const cs = Math.cos(sw);
        const sn = Math.sin(sw);
        const x = mo.x + (dx * cs - dy * sn) * (1 - e);
        const y = mo.y + (dx * sn + dy * cs) * (1 - e);
        const e2 = eIn2(Math.max(0, q - 0.08));
        const x2 = mo.x + (dx * cs - dy * sn) * (1 - e2);
        const y2 = mo.y + (dx * sn + dy * cs) * (1 - e2);
        p.col(heat(0.5 - q * 0.4), 0.5 + 0.5 * q);
        p.line(x2, y2, x, y);
      }
      // Горло наливается жаром.
      glow(p, mo.x, mo.y + 2, 10 + 14 * k, 8 + 10 * k, 0.3 + 0.6 * k * k);
      const left = T - t;
      if (left < 0.12) {
        const q = 1 - left / 0.12;
        p.col(q < 0.5 ? C.yellow : C.white, 1);
        star(p, mo.x, mo.y, 3 + 6 * q, 4, 0.6);
      }
    });
  }),
);

// =============================================================================
// ВЕЕР — шесть секторов r 7, дуга 0,59, метка (1 + 0,2k)/h. Метка сектора:
// залит, фронт жара бежит от змея к дуге и доходит в миг удара, дуга
// сектора — яркая кромка, боковые края тусклые (соседи не мельтешат).
// Контакт: сектор вспыхивает ковром огня — языки загораются от змея к
// краю, пол в копоти с тлеющими угольками, дым, пепел.
// =============================================================================

registerZonePainter(
  'f6_sweep',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const st = z as Strike;
    const k = k01(st.t / Math.max(0.01, st.warn));
    const left = st.warn - st.t;
    const cx = st.x * S;
    const cy = st.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = st.r * S;
    const a = st.ang ?? 0;
    const arc = st.arc ?? 0.59;
    const a0 = a - arc / 2;
    const sig = left < SIG;
    const tk = !reduced() && tick(left);
    const sd = seedOf(st.id);
    const sq = 0.9;
    const box: [number, number, number, number] = [cx - R, cy - R * sq, cx + R, cy + R * sq];
    const base = stamp(st, 'fill', box, (q) => {
      q.col(C.redDk, 1);
      fillSector(q, cx, cy, S * 0.6, R, a0, a0 + arc, sq);
    });
    p.col('#000', 0.2 + 0.1 * k);
    p.img(base.img, base.x, base.y);
    const rf = S * 0.6 + (R - S * 0.6) * Math.pow(k, 1.6);
    p.col(sig ? C.redHot : C.red, (tk ? 0.58 : 0.3) + 0.12 * k);
    fillSector(p, cx, cy, S * 0.6, rf, a0, a0 + arc, sq);
    // Фронт жара — яркая дуга.
    ring(
      p,
      cx,
      cy,
      rf,
      sig ? C.yellow : C.orange,
      0.7 + 0.3 * k,
      (ang) => inArc(ang, a0, arc),
      0.5,
      sq,
    );
    // Дуга сектора — кромка; бока — тусклые.
    ring(
      p,
      cx,
      cy,
      R,
      sig ? (tk ? C.white : C.yellow) : k > 0.5 ? C.orange : C.redHot,
      0.7 + 0.3 * k,
      (ang) => inArc(ang, a0, arc),
      0.6,
      sq,
    );
    for (const ea of [a0, a0 + arc]) {
      p.col(sig ? C.yellow : C.red, 0.3 + 0.3 * k);
      for (let r = S * 0.6; r < R; r += 1)
        if (mod(r - time * 30, 6) < 3) p.dot(cx + Math.cos(ea) * r, cy + Math.sin(ea) * r * sq);
    }
    simmer(p, sd, time, k, 12, (u, v) => {
      const aa = a0 + arc * u;
      const rr = S * 0.6 + (R - S * 0.6) * Math.sqrt(v);
      return [cx + Math.cos(aa) * rr, cy + Math.sin(aa) * rr * sq];
    });
  }),
);

registerImpactPainter('f6_sweep', {
  life: 2,
  shake: 0.12,
  paint: guarded(
    (g, rec: ImpactRec, px: number, py: number, S: number, age: number, time: number) => {
      const cx = rec.x * S;
      const cy = rec.y * S;
      const p = new Pen(g, px, py, cx, cy);
      const R = (rec.r ?? 7) * S;
      const a = rec.ang ?? 0;
      const arc = rec.arc ?? 0.59;
      const a0 = a - arc / 2;
      const sd = rec.seed;
      const few = reduced();
      const sq = 0.9;
      const r0 = S * 0.8;
      const fade = 1 - k01((age - 1.3) / 0.7);
      // Пол: копоть сектором и тлеющие угольки.
      const soot = stamp(rec, 'soot', [cx - R, cy - R * sq, cx + R, cy + R * sq], (q) => {
        q.col(C.soot, 1);
        fillSector(q, cx, cy, r0, R * 0.97, a0 + 0.02, a0 + arc - 0.02, sq);
      });
      p.col('#000', 0.42 * fade);
      p.img(soot.img, soot.x, soot.y);
      for (let i = 0; i < (few ? 10 : 26); i++) {
        const aa = a0 + arc * hash(sd, i, 1);
        const rr = r0 + (R - r0) * Math.sqrt(hash(sd, i, 2));
        const cool = k01((age - 0.2) / (0.8 + 0.9 * hash(sd, i, 3)));
        if (cool >= 1) continue;
        p.col(heat(0.3 + 0.7 * cool), 1 - cool * 0.3);
        p.dot(cx + Math.cos(aa) * rr, cy + Math.sin(aa) * rr * sq);
      }
      sky(time, () => {
        const gl = age < 0.1 ? age / 0.1 : 1 - k01((age - 0.2) / 0.6);
        for (const f of [0.35, 0.7]) {
          const r = r0 + (R - r0) * f;
          glow(p, cx + Math.cos(a) * r, cy + Math.sin(a) * r * sq, 34, 26, 0.45 * gl);
        }
        // Ковёр огня: языки загораются от змея к краю.
        const n = few ? 10 : 24;
        flames(
          p,
          sd,
          age,
          time,
          n,
          (i) => {
            const u = hash(sd, i, 11);
            const v = Math.sqrt((i + 0.5) / n);
            const rr = r0 + (R - r0) * v;
            const aa = a0 + arc * (0.08 + 0.84 * u);
            return [cx + Math.cos(aa) * rr, cy + Math.sin(aa) * rr * sq, v * 0.2];
          },
          7,
          7,
          0.75,
          0.08,
        );
        embersUp(
          p,
          sd,
          age - 0.1,
          cx + Math.cos(a) * R * 0.6,
          cy + Math.sin(a) * R * 0.6 * sq,
          R * 0.28,
          R * 0.2,
          few ? 4 : 10,
          1.4,
          30,
          0.6,
        );
        puffs(
          p,
          sd,
          age - 0.3,
          cx + Math.cos(a) * R * 0.6,
          cy + Math.sin(a) * R * 0.6 * sq - 8,
          few ? 2 : 4,
          -Math.PI / 2,
          1,
          6,
          8,
          3,
          9,
          18,
          1.5,
          1,
          0.5,
          0.5,
        );
        ashFall(
          p,
          sd,
          age,
          cx + Math.cos(a) * R * 0.6,
          cy + Math.sin(a) * R * 0.6 * sq,
          R * 0.3,
          R * 0.22,
          few ? 5 : 14,
          0.7,
          1.3,
          24,
        );
      });
    },
  ),
});

// =============================================================================
// УГЛИ С НЕБА — круг r 0,7 у героя, метка 0,85. Змей в небе плюёт глыбой:
// она летит дугой ИЗ ЕГО ПАСТИ (точка запомнена в миг метки), кувыркается,
// за ней — огненный хвост и дым; ложится ровно в миг урона. Метка: тень
// глыбы растёт и темнеет, кольцо с засечками сходится. Контакт: лужа
// расплава остывает, брызги дугами, язычки, дым.
// =============================================================================

const emberFrom = new WeakMap<object, { x: number; y: number; z: number }>();

registerZonePainter(
  'f6_ember',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const st = z as Strike;
    const k = k01(st.t / Math.max(0.01, st.warn));
    const left = st.warn - st.t;
    const cx = st.x * S;
    const cy = st.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = st.r * S;
    const sig = left < SIG;
    const tk = !reduced() && tick(left);
    const sd = seedOf(st.id);
    // Откуда летит: пасть змея в миг первой метки.
    let o = emberFrom.get(st);
    if (!o) {
      const m = mobOf(st.from);
      if (m) {
        const mo = mouthOf(m, time);
        // Точка «пола» под пастью — там, где змей; высота — пасть.
        o = { x: mo.x, y: m.y * S, z: m.y * S - mo.y + 6 };
      } else o = { x: cx - 18, y: cy - 6, z: 96 };
      emberFrom.set(st, o);
    }
    // Тень глыбы: растёт и темнеет, пока та падает.
    const sh = 2 + 5 * eIn2(k);
    p.col(C.shadow, 0.25 + 0.55 * k);
    fillEll(p, cx, cy, sh, sh * 0.6);
    p.col(C.redDk, 0.25 + 0.1 * k);
    fillEll(p, cx, cy, R, R * 0.75);
    ring(
      p,
      cx,
      cy,
      R,
      sig ? (tk ? C.white : C.yellow) : C.orange,
      0.7 + 0.3 * k,
      undefined,
      0.6,
      0.75,
    );
    // Засечки сходятся к кругу.
    const rr = R * (1.9 - 0.9 * eOut2(k));
    const rot = time * 1.5;
    p.col(sig ? C.yellow : C.amber, 0.5 + 0.5 * k);
    for (let i = 0; i < 4; i++) {
      const aa = rot + (i * TAU) / 4;
      const x = cx + Math.cos(aa) * rr;
      const y = cy + Math.sin(aa) * rr * 0.75;
      p.dot(x - 1, y, 3, 1);
      p.dot(x, y - 1, 1, 3);
    }
    // Глыба — в небе: поверх темноты и мобов.
    const oo = o;
    sky(time, () => {
      const pos = (q: number): [number, number] => {
        const e = k01(q);
        const x = oo.x + (cx - oo.x) * e;
        const y = oo.y + (cy - oo.y) * e;
        const zz = oo.z * (1 - e) + 34 * 4 * e * (1 - e);
        return [x, y - zz];
      };
      // Дымный след: клубы, отставшие на дуге, всплывают и тают.
      for (let i = 1; i <= 5; i++) {
        const q = k - i * 0.07;
        if (q < 0) continue;
        const [x, y] = pos(q);
        const im = puffImg(1, 1.5 + i * 0.6, i + Math.floor(q * 9));
        p.col('#000', 0.42 - i * 0.06);
        p.img(im, x - im.width / 2, y - im.height / 2 - i * 1.5);
      }
      // Огненный хвост: частая дуга назад во времени, от белого к багровому.
      for (let i = 14; i >= 1; i--) {
        const q = k - i * 0.013;
        if (q < 0) continue;
        const [x, y] = pos(q);
        const st2 = Math.min(4, Math.floor(i * 0.32));
        const im = blobImg(Math.max(1, 3.4 - i * 0.18), st2);
        const jx = (hash(sd, i, Math.floor(time * 30)) - 0.5) * 1.6;
        p.col('#000', 0.95 - i * 0.04);
        p.img(im, x - im.width / 2 + jx, y - im.height / 2);
      }
      const [x, y] = pos(k);
      glow(p, x, y, 16, 14, 0.7);
      const im = rockImg(Math.floor(st.t * 14));
      p.col('#000', 1);
      p.img(im, x - im.width / 2, y - im.height / 2);
    });
  }),
);

registerImpactPainter('f6_ember', {
  life: 1.6,
  shake: 0.1,
  paint: guarded(
    (g, rec: ImpactRec, px: number, py: number, S: number, age: number, time: number) => {
      const cx = rec.x * S;
      const cy = rec.y * S;
      const p = new Pen(g, px, py, cx, cy);
      const sd = rec.seed;
      const few = reduced();
      const fade = 1 - k01((age - 1.1) / 0.5);
      const cool = k01(age / 1.2);
      // Пол: воронка и лужа расплава, остывает в корку.
      p.col(C.soot, 0.6 * fade);
      fillEll(p, cx, cy, 8, 5.5);
      p.col(C.lip, 0.4 * fade);
      ring(p, cx, cy, 8, C.lip, 0.5 * fade, (_a, i) => hash(i, sd, 2) > 0.4, 0, 0.7);
      for (let i = 0; i < 6; i++) {
        const aa = (i / 6) * TAU + hash(sd, i, 3);
        const d = 2 + 3 * hash(sd, i, 4);
        const r = 1.5 + 1.5 * hash(sd, i, 5);
        p.col(heat(0.1 + cool * 0.9), fade);
        fillEll(
          p,
          cx + Math.cos(aa) * d,
          cy + Math.sin(aa) * d * 0.7,
          r * (1 - cool * 0.3),
          r * 0.7 * (1 - cool * 0.3),
        );
      }
      sky(time, () => {
        glow(p, cx, cy - 2, 26, 20, 0.8 * (1 - k01(age / 0.6)));
        if (age < 0.08) {
          p.col(C.white, 1);
          star(p, cx, cy - 2, 8 * (1.2 - age / 0.08), 6, 0.3);
        }
        // Брызги расплава — дугами, тяжёлые.
        for (let i = 0; i < (few ? 5 : 12); i++) {
          const th = hash(sd, i, 11) * TAU;
          const v = 20 + 30 * hash(sd, i, 12);
          const f = fly(age, 40 + 50 * hash(sd, i, 13), 360, 0);
          if (!f.air) {
            // Легла каплей и тлеет.
            if (age > 1) continue;
            const gx = cx + Math.cos(th) * v * f.h;
            const gy = cy + Math.sin(th) * v * f.h * 0.75;
            p.col(heat(0.5 + age * 0.5), 1 - age);
            p.dot(gx, gy);
            continue;
          }
          const gx = cx + Math.cos(th) * v * f.h;
          const gy = cy + Math.sin(th) * v * f.h * 0.75 - f.z;
          p.col(heat(0.1 + age * 0.8), 1);
          p.dot(gx, gy, 1, 2);
        }
        flames(
          p,
          sd,
          age,
          time,
          few ? 2 : 4,
          (i) => [cx + (i - 1.5) * 3, cy + (i % 2), i * 0.03],
          6,
          5,
          0.55,
        );
        puffs(
          p,
          sd,
          age - 0.1,
          cx,
          cy - 6,
          few ? 1 : 3,
          -Math.PI / 2,
          0.8,
          5,
          5,
          2,
          6,
          12,
          1.2,
          1,
          0.6,
          0.2,
        );
      });
    },
  ),
});

// =============================================================================
// ПИКЕ. Пока змей кружит над героем (f6_mark, `f6_fxshadow`) — по полу
// скользит тень крылатого змея и прицел за героем. Круг замер (strike
// `f6_dive`, 0,55 с): тень растёт и темнеет, засечки сходятся, в конце
// поднимается пыль от крыльев. Контакт — самый тяжёлый удар змея:
// вспышка, две волны, воронка, раскалённые трещины звездой, венец огня,
// обломки дугами, пыль клубами (тряска 0,5). Через 0,16 с тело падает
// в воронку (`f6_impact`): второй, низкий удар пылью.
// =============================================================================

/** Тень змея сверху: тело, шея, хвост и раскинутые крылья; 16 поворотов. */
function shadowImg(rot: number, spread: number): HTMLCanvasElement {
  const R = mod(Math.round(rot), 16);
  const Sp = Math.max(0, Math.min(2, spread));
  return sprite(`sh${R}|${Sp}`, () => {
    const N = 52;
    const p = new Px(N, N);
    const c = N / 2;
    const a = (R / 16) * TAU;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const wing = 0.7 + 0.15 * Sp;
    const ink = hx('#000000');
    const inside = (u: number, v: number) => {
      // u — вдоль тела (голова +), v — поперёк; в пикселях.
      const body = (u / 12) ** 2 + (v / 3.4) ** 2 < 1;
      const neck = u > 8 && u < 19 && Math.abs(v) < 1.8 - (u - 8) * 0.05;
      const head = ((u - 20) / 3.6) ** 2 + (v / 2.6) ** 2 < 1;
      const tail =
        u < -8 && u > -24 && Math.abs(v - Math.sin((u + 8) * 0.25) * 2) < 1.6 + (u + 24) * 0.06;
      // Крыло: треугольник от плеча, задний край — фестонами.
      const wv = Math.abs(v);
      const wl = 22 * wing;
      let w = false;
      if (wv > 2 && wv < wl) {
        const k = (wv - 2) / (wl - 2);
        const front = 4 - k * 6;
        const back = -6 - k * 2 + Math.sin(k * 9) * 2.2 * k;
        w = u < front && u > back + k * 6 * (k > 0.8 ? 1 : 0);
      }
      return body || neck || head || tail || w;
    };
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const dx = x + 0.5 - c;
        const dy = (y + 0.5 - c) / 0.75;
        const u = dx * ca + dy * sa;
        const v = -dx * sa + dy * ca;
        if (inside(u, v)) p.set(x, y, ink);
      }
    return p;
  });
}

registerZonePainter(
  'f6_fxshadow',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const zz = z as FxZone;
    const m = mobOf(zz.mob);
    if (!m) return;
    const gx = m.data.gx ?? zz.x;
    const gy = m.data.gy ?? zz.y;
    const cx = gx * S;
    const cy = gy * S;
    const p = new Pen(g, px + (gx - zz.x) * S, py + (gy - zz.y) * S, cx, cy);
    const t = zz.t;
    const on = k01(t / 0.25) * k01((zz.life - t) / 0.08);
    // Тень кружит над целью: змей высматривает.
    const orb = 10 - 4 * k01(t / zz.life);
    const ang = time * 2.2;
    const sx = cx + Math.cos(ang) * orb;
    const sy = cy + Math.sin(ang) * orb * 0.75;
    const rot = ((ang + Math.PI / 2) / TAU) * 16;
    const flap = Math.floor(time * 6) % 3;
    const im = shadowImg(rot, flap);
    p.col(C.redDk, 0.16 * on);
    fillEll(p, cx, cy, 1.9 * S, 1.9 * S * 0.75);
    p.col('#000', 0.42 * on);
    p.img(im, sx - im.width / 2, sy - im.height / 2);
    // Прицел за героем — пунктир, ещё не замер.
    const R = 1.9 * S;
    ring(
      p,
      cx,
      cy,
      R,
      C.orange,
      0.85 * on,
      (a) => mod(a * 3 + time * 4, TAU / 3) < TAU / 5,
      0.6,
      0.75,
    );
  }),
);

registerZonePainter(
  'f6_dive',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const st = z as Strike;
    const k = k01(st.t / Math.max(0.01, st.warn));
    const left = st.warn - st.t;
    const cx = st.x * S;
    const cy = st.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = st.r * S;
    const sq = 0.75;
    const sig = left < SIG;
    const tk = !reduced() && tick(left);
    const sd = seedOf(st.id);
    // «Куда»: круг и тень змея — падает сюда.
    p.col(C.redDk, 0.3 + 0.15 * k);
    fillEll(p, cx, cy, R, R * sq);
    p.col(sig ? C.redHot : C.red, (tk ? 0.55 : 0.28) * k);
    fillEll(p, cx, cy, R * eOut2(k), R * sq * eOut2(k));
    const im = shadowImg(4, 2);
    const s = 0.85 + 0.4 * eIn2(k);
    p.col('#000', 0.45 + 0.45 * k);
    const g2 = p.g;
    const w = im.width * s;
    const h = im.height * s;
    g2.drawImage(
      im,
      Math.round(cx - w / 2) + p.qx,
      Math.round(cy - h / 2) + p.qy,
      Math.round(w),
      Math.round(h),
    );
    ring(
      p,
      cx,
      cy,
      R,
      sig ? (tk ? C.white : C.yellow) : k > 0.5 ? C.orange : C.redHot,
      0.8 + 0.2 * k,
      undefined,
      0.6,
      sq,
    );
    // Засечки: четыре шеврона сходятся к кромке.
    const rr = R * (1.55 - 0.55 * eOut2(k));
    p.col(sig ? C.yellow : C.orange, 0.6 + 0.4 * k);
    for (let i = 0; i < 4; i++) {
      const aa = Math.PI / 4 + (i * TAU) / 4;
      const ca = Math.cos(aa);
      const sa = Math.sin(aa);
      for (let q = -3; q <= 3; q++) {
        const d = rr + Math.abs(q);
        p.dot(cx + ca * d - sa * q, cy + (sa * d + ca * q) * sq);
      }
    }
    // Крылья гонят вниз воздух: пыль из круга наружу.
    if (left < 0.3) {
      const q = 1 - left / 0.3;
      puffs(
        p,
        sd,
        q * 0.3,
        cx,
        cy,
        reduced() ? 3 : 8,
        0,
        Math.PI,
        30,
        20,
        2,
        5,
        2,
        0.5,
        0,
        0.7 * q,
      );
    }
    simmer(p, sd, time, k, 10, (u, v) => {
      const aa = u * TAU;
      const r2 = R * Math.sqrt(v);
      return [cx + Math.cos(aa) * r2, cy + Math.sin(aa) * r2 * sq];
    });
  }),
);

registerImpactPainter('f6_dive', {
  life: 2.4,
  shake: 0.5,
  flash: 0.4,
  flashRgb: '255,170,90',
  paint: guarded(
    (g, rec: ImpactRec, px: number, py: number, S: number, age: number, time: number) => {
      const cx = rec.x * S;
      const cy = rec.y * S;
      const p = new Pen(g, px, py, cx, cy);
      const R = (rec.r ?? 1.9) * S;
      const sd = rec.seed;
      const few = reduced();
      const sq = 0.75;
      const fade = 1 - k01((age - 1.7) / 0.7);
      // Воронка: тёмная чаша с кромкой.
      p.col(C.lip, 0.5 * fade);
      fillEll(p, cx, cy + 1, R * 0.62, R * 0.62 * sq);
      p.col(C.soot, 0.85 * fade);
      fillEll(p, cx, cy, R * 0.55, R * 0.55 * sq);
      // Раскалённые трещины звездой — бегут за 0,12 с и остывают.
      const br = starBranches(sd, 9, 0.3, R * 0.9, R * 1.7, 3);
      const ck = crackOf(`dive|${sd % 991}`, sd, br, 0.45, 0.3, sq);
      const ckT = crackOf(
        `dive|${sd % 991}|t`,
        sd,
        br.map(([a, l]) => [a, l, 1]),
        0.45,
        0.3,
        sq,
      );
      const reach = ck.max * eOut3(k01(age / 0.12));
      // Жар начинается с янтаря, не с жёлтого: жёлтые ветви читались молнией.
      drawCrack(p, ck, cx, cy, reach, C.groove, fade, 0.17 + 0.83 * k01(age / 2), 0.75, ckT);
      // Медленная волна пыли по полу.
      if (age < 0.8) {
        const q = age / 0.8;
        ring(
          p,
          cx,
          cy,
          R * (0.6 + 1.6 * eOut2(q)),
          '#8a7c72',
          0.8 * (1 - q),
          (_a, i) => hash(i >> 2, sd, 9) > 0.35,
          0.5,
          sq,
        );
      }
      // Пыль подсвечена жаром воронки (палитра 4): серая под свечением
      // читалась оливковой.
      puffs(p, sd, age, cx, cy, few ? 5 : 14, 0, Math.PI, 80, 50, 3, 9, 8, 1.8, 4, 0.7, 0.05);
      chips(p, sd, age, cx, cy, few ? 6 : 16, 0, Math.PI, 30, 50, 90, 90, [1.3, 1.9], 0.45, 0.4);
      sky(time, () => {
        glow(p, cx, cy - 4, 60, 44, 0.9 * (1 - k01(age / 0.9)));
        // Кадр контакта: белая звезда держится стоп-кадром, гаснет.
        if (age < 0.12) {
          const q = age / 0.12;
          p.col(q < 0.45 ? C.white : C.yellow, 1);
          star(p, cx, cy - 4, 24 * (1 - 0.4 * q), 8, 0.2);
          p.col(C.white, 1);
          fillEll(p, cx, cy - 4, 7 * (1 - q), 5 * (1 - q));
        }
        // Быстрая волна — белая, рваная.
        if (age < 0.3) {
          const q = age / 0.3;
          ring(
            p,
            cx,
            cy,
            R * (0.4 + 2.2 * eOut2(q)),
            C.white,
            0.95 * (1 - q),
            (_a, i) => hash(i >> 2, sd, 10) > 0.2,
            0.6,
            sq,
          );
          ring(
            p,
            cx,
            cy,
            R * (0.3 + 2 * eOut2(q)),
            C.amber,
            0.7 * (1 - q),
            (_a, i) => hash(i >> 2, sd, 11) > 0.45,
            0,
            sq,
          );
        }
        // Венец огня по кромке воронки.
        flames(
          p,
          sd,
          age,
          time,
          few ? 8 : 16,
          (i) => {
            const aa = (i / 16) * TAU + hash(sd, i, 21) * 0.3;
            const rr = R * (0.62 + 0.15 * hash(sd, i, 22));
            return [
              cx + Math.cos(aa) * rr,
              cy + Math.sin(aa) * rr * sq,
              0.02 + hash(sd, i, 23) * 0.06,
            ];
          },
          9,
          9,
          0.7,
          0.06,
        );
        sparks(p, sd, age, cx, cy - 3, few ? 8 : 22, -Math.PI / 2, Math.PI, 60, 80, 0.7, 70);
        embersUp(p, sd, age - 0.15, cx, cy, R * 0.8, R * 0.5, few ? 5 : 14, 1.6, 40, 0.8);
      });
    },
  ),
});

// Тело змея падает в воронку (0,16 с после урона): низкая пыль кольцом,
// дрожь пола, мелкие камни. Огонь и вспышку дал сам удар — здесь вес.
registerZonePainter(
  'f6_impact',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const zz = z as Zone;
    const t = zz.t;
    const cx = zz.x * S;
    const cy = zz.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = zz.r * S;
    const sd = seedOf(zz.id);
    const sq = 0.75;
    if (t < 0.35) {
      const q = t / 0.35;
      ring(
        p,
        cx,
        cy,
        R * (0.5 + 1.1 * eOut2(q)),
        '#a89a8e',
        0.85 * (1 - q),
        (_a, i) => hash(i >> 1, sd, 3) > 0.3,
        0.5,
        sq,
      );
    }
    puffs(
      p,
      sd,
      t,
      cx,
      cy + 2,
      reduced() ? 3 : 10,
      0,
      Math.PI,
      70,
      30,
      2,
      6,
      2,
      0.5,
      0,
      0.6,
      0,
      0.7,
    );
    chips(p, sd, t, cx, cy, reduced() ? 2 : 6, 0, Math.PI, 20, 20, 40, 40, [0.35, 0.5], 0, 0.2);
    void time;
  }),
);

// =============================================================================
// РАЗЛОМ (фаза 3) — кольцо клеток арены уходит в лаву, метка 1,6 с на
// клетку. Клетка трескается: сеть трещин СШИТА с соседями (точка, где
// трещина пересекает край клетки, берётся от самого края — у соседа та же),
// кольцо читается одной трещиной. Жар в трещинах растёт, между ними
// сочится лава; последние 0,2 с — светится. Выход лавы — `f6_fxquake`.
// =============================================================================

/** Трещины клетки (cx, cy) — холст 16×16 стадии st (0 тёмная … 3 жёлтая). */
function cellCrack(x: number, y: number, st: number): HTMLCanvasElement {
  return sprite(
    `cc${x},${y}|${st}`,
    () => {
      const p = new Px(16, 16);
      // Узел внутри клетки и точки на краях (от ребра — у соседа те же).
      const nx = 5 + Math.floor(hash(x, y, 1) * 6);
      const ny = 5 + Math.floor(hash(x, y, 2) * 6);
      const edges: [number, number][] = [];
      const eTop = hash(x, y, 11);
      const eBot = hash(x, y + 1, 11);
      const eLft = hash(x, y, 12);
      const eRgt = hash(x + 1, y, 12);
      if (hash(x, y, 13) < 0.72) edges.push([2 + Math.floor(eTop * 12), 0]);
      if (hash(x, y + 1, 13) < 0.72) edges.push([2 + Math.floor(eBot * 12), 15]);
      if (hash(x, y, 14) < 0.72) edges.push([0, 2 + Math.floor(eLft * 12)]);
      if (hash(x + 1, y, 14) < 0.72) edges.push([15, 2 + Math.floor(eRgt * 12)]);
      if (edges.length < 2)
        edges.push([15, 2 + Math.floor(eRgt * 12)], [0, 2 + Math.floor(eLft * 12)]);
      const col = [hx('#2a0806'), hx('#8a1a0c'), hx('#ff6a1a'), hx('#ffe060')][st];
      const lip = [hx('#1a0404'), hx('#3a0a06'), hx('#a8260c'), hx('#ff8a2a')][st];
      for (const [ex, ey] of edges) {
        // Излом посередине — трещина, а не линейка.
        const mx = (nx + ex) / 2 + (hash(x * 7 + ex, y * 7 + ey, 3) - 0.5) * 4;
        const my = (ny + ey) / 2 + (hash(x * 7 + ex, y * 7 + ey, 4) - 0.5) * 4;
        for (const [x0, y0, x1, y1] of [
          [nx, ny, mx, my],
          [mx, my, ex, ey],
        ]) {
          const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
          for (let i = 0; i <= n; i++) {
            const px = Math.round(x0 + ((x1 - x0) * i) / n);
            const py = Math.round(y0 + ((y1 - y0) * i) / n);
            if (st >= 2) p.set(px + 1, py + 1, lip);
            p.set(px, py, col);
          }
        }
      }
      if (st >= 3) p.set(nx, ny, hx('#ffffff'));
      return p;
    },
    cellSprites,
  );
}

registerZonePainter(
  'f6_crack',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const zz = z as Zone;
    const warn = zz.warn ?? 1.6;
    const k = k01(zz.t / warn);
    const left = warn - zz.t;
    const x = Math.floor(zz.x);
    const y = Math.floor(zz.y);
    const cx = zz.x * S;
    const cy = zz.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const sig = left < SIG;
    const tk = !reduced() && tick(left);
    const x0 = x * S;
    const y0 = y * S;
    // Жар под полом: клетка наливается, по кольцу бежит пульс.
    const pulse = 0.5 + 0.5 * Math.sin(time * (6 + 10 * k) - (x + y) * 0.9);
    p.col(sig ? C.redHot : C.red, (0.14 + 0.3 * k) * (0.7 + 0.3 * pulse) + (tk ? 0.2 : 0));
    p.rect(x0, y0, 16, 16);
    const stg = sig ? 3 : k < 0.3 ? 0 : k < 0.6 ? 1 : k < 0.85 ? 2 : 3;
    p.col('#000', 1);
    p.img(cellCrack(x, y, stg), x0, y0);
    if (k > 0.5) {
      const q = (k - 0.5) / 0.5;
      sky(time, () => {
        embersUp(
          p,
          (x * 131 + y * 71) >>> 0,
          (time + hash(x, y, 5)) % 0.9,
          x0 + 8,
          y0 + 8,
          6,
          5,
          1,
          0.9,
          10 + 8 * q,
        );
        if (sig) glow(p, x0 + 8, y0 + 8, 14, 12, 0.35);
      });
    }
  }),
);

// Лава выходит кольцом: брызги дугами, языки, дым — по клеткам кольца.
registerZonePainter(
  'f6_fxquake',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const zz = z as FxZone;
    const warn = zz.warn ?? 1.6;
    const t = zz.t - warn;
    if (t < 0) return;
    const cells = zz.cells ?? [];
    const W = zz.W ?? 1;
    const cx = zz.x * S;
    const cy = zz.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const few = reduced();
    const step = Math.max(1, Math.ceil(cells.length / (few ? 16 : 48)));
    sky(time, () => {
      for (let j = 0; j < cells.length; j += step) {
        const i = cells[j];
        const x = ((i % W) + 0.5) * S;
        const y = (Math.floor(i / W) + 0.5) * S;
        const sd = (i * 2654435761) >>> 0;
        const age = t - hash(sd, 1, 1) * 0.15;
        if (age < 0) continue;
        if (age < 0.5) glow(p, x, y, 18, 14, 0.5 * (1 - age / 0.5));
        flames(p, sd, age, time, 1, () => [x, y + 2, 0], 7, 7, 0.6, 0.06);
        for (let q = 0; q < 2; q++) {
          const th = hash(sd, q, 3) * TAU;
          const v = 12 + 16 * hash(sd, q, 4);
          const f = fly(age, 50 + 40 * hash(sd, q, 5), 380, 0);
          if (!f.air) continue;
          p.col(heat(0.05 + age), 1);
          p.dot(x + Math.cos(th) * v * f.h, y + Math.sin(th) * v * f.h * 0.75 - f.z, 1, 2);
        }
        if (j % (step * 3) === 0)
          puffs(p, sd, age - 0.2, x, y - 6, 1, -Math.PI / 2, 0.6, 3, 3, 3, 7, 14, 1, 1, 0.5);
      }
    });
  }),
);

// =============================================================================
// ДВИЖЕНИЕ И СЦЕНЫ (визуальные зоны мозга): ползок, взмахи крыльев, рёв,
// смена фазы, смерть.
// =============================================================================

// Ползок: брюхо трёт базальт — пыль по сторонам назад, искры из-под чешуи.
registerZonePainter(
  'f6_fxcrawl',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const zz = z as FxZone;
    const t = zz.t;
    const cx = zz.x * S;
    const cy = zz.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const a = zz.ang ?? 0;
    const sd = seedOf(zz.id);
    const back = a + Math.PI;
    puffs(
      p,
      sd,
      t,
      cx + Math.cos(back) * 6,
      cy + 2 + Math.sin(back) * 4,
      1,
      back + 0.9,
      0.3,
      10,
      8,
      1,
      4,
      2,
      0.6,
      0,
      0.6,
    );
    puffs(
      p,
      sd + 1,
      t,
      cx + Math.cos(back) * 6,
      cy + 2 + Math.sin(back) * 4,
      1,
      back - 0.9,
      0.3,
      10,
      8,
      1,
      4,
      2,
      0.6,
      0,
      0.6,
    );
    if (hash(sd, 1, 9) < 0.55)
      sky(time, () =>
        sparks(
          p,
          sd,
          t,
          cx + Math.cos(back) * 8,
          cy + Math.sin(back) * 5,
          2,
          back,
          0.8,
          26,
          20,
          0.28,
          18,
        ),
      );
  }),
);

// Взлёт: три взмаха крыльев гонят пыль и пепел кольцом.
registerZonePainter(
  'f6_fxgust',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const zz = z as FxZone;
    const m = mobOf(zz.mob);
    const gx = m ? m.x : zz.x;
    const gy = m ? m.y : zz.y;
    const cx = gx * S;
    const cy = gy * S;
    const p = new Pen(g, px + (gx - zz.x) * S, py + (gy - zz.y) * S, cx, cy);
    const sd = seedOf(zz.id);
    const few = reduced();
    for (let b = 0; b < 3; b++) {
      const age = zz.t - (0.12 + b * 0.3);
      if (age < 0 || age > 0.9) continue;
      const q = age / 0.9;
      ring(
        p,
        cx,
        cy,
        S * (0.8 + 2.2 * eOut2(Math.min(1, age / 0.4))),
        C.wind,
        0.55 * (1 - Math.min(1, age / 0.4)),
        (_a, i) => hash(i >> 2, sd + b, 4) > 0.4,
        0,
        0.75,
      );
      puffs(
        p,
        sd + b * 17,
        age,
        cx,
        cy + 2,
        few ? 5 : 12,
        0,
        Math.PI,
        110,
        40,
        1.5,
        4,
        1,
        0.6,
        0,
        0.55 * (1 - b * 0.12),
        0,
        0.6,
      );
      sky(time, () => embersUp(p, sd + b, age, cx, cy, S * 1.2, S * 0.6, few ? 2 : 6, 0.8, 16));
      void q;
    }
  }),
);

// Рёв (призыв духов): жар волнами от пасти, пепел поднимается.
registerZonePainter(
  'f6_fxroar',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const zz = z as FxZone;
    const m = mobOf(zz.mob);
    const cx = zz.x * S;
    const cy = zz.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const sd = seedOf(zz.id);
    const mo = m ? mouthOf(m, time) : { x: cx + 20, y: cy - 30, z: 30, dir: 1 };
    sky(time, () => {
      for (let j = 0; j < 3; j++) {
        const age = zz.t - j * 0.14;
        if (age < 0 || age > 0.6) continue;
        const q = age / 0.6;
        ring(
          p,
          mo.x,
          mo.y,
          5 + 40 * eOut2(q),
          j === 0 ? C.amber : C.orange,
          0.6 * (1 - q),
          (a, i) => Math.sin(a * 9 + i * 0.3) > -0.3,
          0,
          0.8,
        );
      }
      glow(p, mo.x, mo.y, 22, 18, 0.6 * (1 - k01(zz.t / 0.8)));
      embersUp(p, sd, zz.t, cx, cy, S * 2.2, S * 1.4, reduced() ? 4 : 14, 0.9, 22);
    });
  }),
);

// Смена фазы: жар кольцом по арене, пол трескается звездой, угли вверх.
registerZonePainter(
  'f6_fxphase',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const zz = z as FxZone;
    const t = zz.t;
    const cx = zz.x * S;
    const cy = zz.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const sd = seedOf(zz.id);
    const few = reduced();
    const fade = k01((zz.life - t) / 0.8);
    const br = starBranches(sd, 10, 0.3, S * 2, S * 3.6, 3);
    const ck = crackOf(`phase|${sd % 97}`, sd, br, 0.45, 0.35);
    const ckT = crackOf(
      `phase|${sd % 97}|t`,
      sd,
      br.map(([a, l]) => [a, l, 1]),
      0.45,
      0.35,
    );
    const reach = ck.max * eOut3(k01(t / 0.3));
    drawCrack(p, ck, cx, cy + 2, reach, C.groove, fade, k01(t / 1.8), 0.8, ckT);
    puffs(p, sd, t, cx, cy + 2, few ? 4 : 12, 0, Math.PI, 60, 30, 3, 8, 7, 1.4, 2, 0.6);
    sky(time, () => {
      glow(p, cx, cy - 6, 70, 50, 0.7 * (1 - k01(t / 1)));
      if (t < 0.6) {
        const q = t / 0.6;
        ring(
          p,
          cx,
          cy,
          S * (0.6 + 6 * eOut2(q)),
          C.yellow,
          0.9 * (1 - q),
          (_a, i) => hash(i >> 2, sd, 7) > 0.2,
          0.5,
          0.8,
        );
        ring(
          p,
          cx,
          cy,
          S * (0.4 + 5.4 * eOut2(q)),
          C.orange,
          0.7 * (1 - q),
          (_a, i) => hash(i >> 2, sd, 8) > 0.5,
          0,
          0.8,
        );
      }
      sparks(p, sd, t, cx, cy - 6, few ? 8 : 24, -Math.PI / 2, Math.PI, 50, 70, 0.9, 80);
      embersUp(p, sd + 3, t, cx, cy, S * 3, S * 2, few ? 8 : 26, 1.6, 44, 0.6);
    });
  }),
);

// Смерть: жар уходит — вспышка, столб угольков, пар над остывающей лавой,
// пепел ложится на всю арену.
registerZonePainter(
  'f6_fxdeath',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const zz = z as FxZone;
    const t = zz.t;
    const cx = zz.x * S;
    const cy = zz.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const sd = seedOf(zz.id);
    const few = reduced();
    puffs(
      p,
      sd,
      t - 0.1,
      cx,
      cy + 2,
      few ? 5 : 14,
      0,
      Math.PI,
      50,
      30,
      3,
      9,
      10,
      2.2,
      2,
      0.65,
      0.3,
    );
    sky(time, () => {
      glow(p, cx, cy - 10, 80, 60, 0.9 * (1 - k01(t / 1.6)));
      if (t < 0.5) {
        const q = t / 0.5;
        ring(
          p,
          cx,
          cy,
          S * (0.5 + 5 * eOut2(q)),
          C.white,
          0.8 * (1 - q),
          (_a, i) => hash(i >> 2, sd, 7) > 0.3,
          0.5,
          0.8,
        );
      }
      embersUp(p, sd, t, cx, cy - 8, S * 0.8, S * 0.5, few ? 10 : 34, 2.4, 70, 1.2);
      // Последний дым: снизу подсвечен жаром, выше — чёрный, расходится
      // и тает. Белый пар без лавы под ним читался призраком.
      puffs(
        p,
        sd + 5,
        t - 0.3,
        cx,
        cy - 4,
        few ? 2 : 5,
        -Math.PI / 2,
        1,
        16,
        16,
        3,
        8,
        22,
        1.2,
        4,
        0.5,
        0.5,
      );
      puffs(
        p,
        sd + 9,
        t - 0.7,
        cx,
        cy - 8,
        few ? 3 : 7,
        -Math.PI / 2,
        1.3,
        14,
        18,
        4,
        11,
        30,
        1.9,
        1,
        0.42,
        1.1,
      );
      ashFall(p, sd, t, cx, cy, S * 4, S * 3, few ? 16 : 60, 0.4, 2.6, 40);
    });
  }),
);

// =============================================================================
// ПРОГРЕВ: заготовки техник рисуются до боя, по одной на шаг (движок тратит
// на прогрев до 3 мс за кадр, пока змей в мире) — первый язык пламени,
// клуб или глыба не рисуются впервые посреди удара.
// =============================================================================

function* warmFx(): Generator<unknown> {
  for (let r = 1; r <= 120; r++) {
    circle(r);
    // Большие окружности дороже — по одной на шаг.
    if (r > 48 || r % 4 === 0) yield;
  }
  for (let h = 3; h <= 20; h++)
    for (let f = 0; f < 4; f++) {
      flameImg(h, f);
      yield;
    }
  for (let r = 1; r <= 6; r++)
    for (let st = 0; st < BLOB.length; st++) {
      blobImg(r, st);
      yield;
    }
  for (let f = 0; f < 4; f++) {
    rockImg(f);
    yield;
  }
  for (const pal of [0, 1, 4, 2])
    for (let r = 1; r <= 12; r++)
      for (let v = 0; v < 4; v++) {
        puffImg(pal, r, v);
        yield;
      }
  for (let sz = 1; sz <= 4; sz++)
    for (let f = 0; f < 4; f++) {
      chipImg(sz, f, false);
      chipImg(sz, f, true);
      yield;
    }
  for (let r = 0; r < 16; r++)
    for (let s = 0; s < 3; s++) {
      shadowImg(r, s);
      yield;
    }
  glowImg();
}

registerMobWarm('f6boss', warmFx);
