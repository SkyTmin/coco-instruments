// Этаж 4 «Двойная крипта» — набор рисунка мобов (анимации мобов 4, по эталону
// боссов 12–14 и монстров 15-го). Облик прежний (кость, ржавчина, латы,
// балахон некроманта), а рисунок — из маленького пиксельного «3D»: тело —
// точки суставов в своих осях (вперёд f, вправо s, вверх u), кости и латы —
// линии и плоскости между ними, проекция сверху в три четверти. Отсюда 8
// сторон: рисуются юг, юго-восток, восток, северо-восток и север, остальные —
// зеркалом. Каждое действие — трек 24 к/с от `pose.t`, кадр контакта = миг
// урона мозга; ход — по пройденному пути; покой — с фазой от номера моба.
// Кадры — только в `frameLRU` с пределом на вид, прогрев — `registerMobWarm`.

import type { Mob } from '../dungeon-sim';
import { hex, Px } from '../dungeon-art';
import { frameLRU, paintSim } from '../dungeon-paint';
import type { FrameLRU, MobFrame, MobPose } from '../dungeon-paint';

export type RGBA = [number, number, number, number];
export type P3 = [number, number, number];
export type Look = MobPose['look'];

export const PI = Math.PI;
export const TAU = PI * 2;
export const R = Math.round;

// ---- Палитра (те же ступени, что у прежних рисовальщиков этажа) ----------------

export const INK = hex('#150f0b');
export const WHITE: RGBA = [255, 255, 255, 255];
export const BONE = {
  hi: hex('#f4efe0'),
  mid: hex('#d8cfb8'),
  sh: hex('#a79d84'),
  dk: hex('#716853'),
  hole: hex('#1c1412'),
};
export const RUST = { hi: hex('#c98a5a'), mid: hex('#8a4a2a'), dk: hex('#58301c') };
export const IRON = {
  hi: hex('#d4d8dc'),
  mid: hex('#949aa0'),
  sh: hex('#646a70'),
  dk: hex('#3c4046'),
};
export const RAG = { mid: hex('#4d5a46'), dk: hex('#2f382c'), hi: hex('#6a7862') };
/** Полость грудной клетки костяка. */
export const CAVITY = hex('#2a201c');
export const WOOD = { mid: hex('#6e4a2e'), dk: hex('#432a1a'), hi: hex('#94683e') };
export const EYE_RED = hex('#ff3a28');
export const GOLDK = hex('#ffcc40');

// ---- Кривые и кванты ------------------------------------------------------------

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
/** Доля отрезка времени [a, b], в котором сейчас t. */
export const seg = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
export const eIn = (k: number) => k * k * k;
export const eOut = (k: number) => 1 - (1 - k) ** 3;
export const eInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
/** Номер кадра 24 к/с (не больше `max`). */
export const fi = (t: number, max: number) => Math.min(max, Math.max(0, Math.floor(t * 24 + 1e-6)));
export const mod = (n: number, k: number) => ((Math.floor(n) % k) + k) % k;
/** Хеш номера моба → 0…1 (фаза покоя: стая не дышит в такт). */
export const hash01 = (n: number) => (((Math.imul(n | 0, 2654435761) >>> 0) % 1000) + 0.5) / 1000;

// ---- Вектора --------------------------------------------------------------------

export const v3 = (f: number, s: number, u: number): P3 => [f, s, u];
export const vadd = (a: P3, b: P3): P3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const vsub = (a: P3, b: P3): P3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const vmul = (a: P3, k: number): P3 => [a[0] * k, a[1] * k, a[2] * k];
export const vdot = (a: P3, b: P3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const vlen = (a: P3) => Math.sqrt(vdot(a, a));
export const vnorm = (a: P3): P3 => {
  const l = vlen(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const vlerp = (a: P3, b: P3, k: number): P3 => [
  a[0] + (b[0] - a[0]) * k,
  a[1] + (b[1] - a[1]) * k,
  a[2] + (b[2] - a[2]) * k,
];
/** Направление между двумя направлениями — по дуге (лерп с нормировкой). */
export const vslerp = (a: P3, b: P3, k: number): P3 => vnorm(vlerp(a, b, k));

/** Сустав двух звеньев: от `a` к `b`, длины `l1`, `l2`, колено — в сторону `pole`. */
export function ik(a: P3, b: P3, l1: number, l2: number, pole: P3): P3 {
  const d = vsub(b, a);
  let L = vlen(d);
  if (L < 1e-6) return vadd(a, vmul(vnorm(pole), l1));
  const dir = vmul(d, 1 / L);
  L = Math.min(L, l1 + l2 - 1e-3);
  const x = (l1 * l1 - l2 * l2 + L * L) / (2 * L);
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  let pp = vsub(pole, vmul(dir, vdot(pole, dir)));
  const pl = vlen(pp);
  pp = pl > 1e-6 ? vmul(pp, 1 / pl) : [0, 0, 1];
  return vadd(vadd(a, vmul(dir, x)), vmul(pp, h));
}

// ---- Проекция и стороны -----------------------------------------------------------

/** Сжатие глубины: шаг к зрителю — полшага вниз по экрану. */
export const QK = 0.5;

export interface Cam {
  ax: number;
  ay: number;
  c: number;
  s: number;
}
export const camOf = (yaw: number, ax: number, ay: number): Cam => ({
  ax,
  ay,
  c: Math.cos(yaw),
  s: Math.sin(yaw),
});
/** Точка тела (вперёд, вправо, вверх) → [x, y экрана, глубина к зрителю]. */
export function pj(c: Cam, p: P3): [number, number, number] {
  const wy = p[0] * c.s + p[1] * c.c;
  return [c.ax + p[0] * c.c - p[1] * c.s, c.ay + wy * QK - p[2], wy];
}

/** Сторона 0…7 по игровому углу: 0 — восток, 2 — юг (к зрителю), 6 — север. */
export const dir8 = (a: number) => mod(Math.round(a / (PI / 4)), 8);
/** Рисуемая сторона: юго-запад, запад и северо-запад — зеркало юго-востока, востока, северо-востока. */
export function viewOf(d: number): { d: number; mir: boolean; yaw: number } {
  const mir = d === 3 || d === 4 || d === 5;
  const dd = mir ? (12 - d) % 8 : d;
  return { d: dd, mir, yaw: (dd * PI) / 4 };
}
/** Вид спрайта головы: 0 — бок, 1 — три четверти к зрителю, 2 — лицом, 3 — три четверти спиной, 4 — спиной. */
export const headView = (dd: number) =>
  dd === 0 ? 0 : dd === 1 ? 1 : dd === 2 ? 2 : dd === 7 ? 3 : 4;

// ---- Сцена: части по глубине --------------------------------------------------------

export interface Op {
  d: number;
  i: number;
  f: (p: Px) => void;
}
export class Scene {
  ops: Op[] = [];
  constructor(public cam: Cam) {}
  P(p: P3) {
    return pj(this.cam, p);
  }
  add(d: number, f: (p: Px) => void): void {
    this.ops.push({ d, i: this.ops.length, f });
  }
  /** Кость или палка: линия, шишки на концах. */
  seg(a: P3, b: P3, c: RGBA, knobA: RGBA | null = null, knobB: RGBA | null = null, dz = 0): void {
    const A = this.P(a);
    const B = this.P(b);
    this.add((A[2] + B[2]) / 2 + dz, (p) => {
      p.line(A[0], A[1], B[0], B[1], c);
      if (knobA) p.set(A[0], A[1], knobA);
      if (knobB) p.set(B[0], B[1], knobB);
    });
  }
  /** Толстая часть (2 точки): свет — сверху-слева, тень — второй линией. */
  thick(a: P3, b: P3, c: RGBA, c2: RGBA, dz = 0): void {
    const A = this.P(a);
    const B = this.P(b);
    this.add((A[2] + B[2]) / 2 + dz, (p) => {
      const vert = Math.abs(B[1] - A[1]) > Math.abs(B[0] - A[0]);
      if (vert) p.line(A[0] + 1, A[1], B[0] + 1, B[1], c2);
      else p.line(A[0], A[1] + 1, B[0], B[1] + 1, c2);
      p.line(A[0], A[1], B[0], B[1], c);
    });
  }
  /** Плоскость (щит, ткань): заливка многоугольника, цвет — функция точки экрана. */
  poly(pts: P3[], col: RGBA | ((x: number, y: number, k: number) => RGBA | null), dz = 0): void {
    const Q = pts.map((q) => this.P(q));
    const d = Q.reduce((a, q) => a + q[2], 0) / Q.length + dz;
    this.add(d, (p) => fillPoly(p, Q, col));
  }
  /** Спрайт в точке тела. */
  spr(at: P3, f: (p: Px, x: number, y: number) => void, dz = 0): void {
    const A = this.P(at);
    this.add(A[2] + dz, (p) => f(p, A[0], A[1]));
  }
  paint(p: Px): void {
    this.ops.sort((a, b) => a.d - b.d || a.i - b.i);
    for (const o of this.ops) o.f(p);
  }
}

/** Заливка многоугольника строками; `k` в функции цвета — доля высоты (0 — верх). */
export function fillPoly(
  p: Px,
  Q: [number, number, number][],
  col: RGBA | ((x: number, y: number, k: number) => RGBA | null),
): void {
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const q of Q) {
    y0 = Math.min(y0, q[1]);
    y1 = Math.max(y1, q[1]);
  }
  const ya = Math.ceil(y0 - 0.5);
  const yb = Math.floor(y1 - 0.5);
  const xs: number[] = [];
  for (let y = ya; y <= yb; y++) {
    const yc = y + 0.5;
    xs.length = 0;
    for (let i = 0; i < Q.length; i++) {
      const a = Q[i];
      const b = Q[(i + 1) % Q.length];
      if (a[1] === b[1]) continue;
      if ((yc >= a[1] && yc < b[1]) || (yc >= b[1] && yc < a[1]))
        xs.push(a[0] + ((yc - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const xa = Math.ceil(xs[i] - 0.5);
      const xb = Math.floor(xs[i + 1] - 0.5);
      for (let x = xa; x <= xb; x++) {
        const c = typeof col === 'function' ? col(x, y, (y - ya) / Math.max(1, yb - ya)) : col;
        if (c) p.set(x, y, c);
      }
    }
  }
}

/** Выпуклая оболочка точек экрана (для силуэта полости). */
export function hull2(P: [number, number, number][]): [number, number, number][] {
  const pts = P.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cr = (o: number[], a: number[], b: number[]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: [number, number, number][] = [];
  for (const q of pts) {
    while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
    lo.push(q);
  }
  const hi: [number, number, number][] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const q = pts[i];
    while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop();
    hi.push(q);
  }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}

// ---- Кадр: облик, вспышка, зеркало, кеш ------------------------------------------------

/**
 * Белая вспышка удара из готового кадра: тот же холст, залитый белым поверх
 * себя (как `tint(WHITE, 0.9)`), без перерисовки позы — кеш по картинке. Удар
 * героя белит моба 0,1–0,15 с, и отдельный кадр вспышки на каждую позу был
 * главной ценой новых кадров в толпе.
 */
const FLASHED = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();
export function flashImg(img: HTMLCanvasElement): HTMLCanvasElement {
  let c = FLASHED.get(img);
  if (!c) {
    c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.globalAlpha = 0.9;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, c.width, c.height);
    FLASHED.set(img, c);
    const o = OFF.get(img);
    if (o) OFF.set(c, o);
  }
  return c;
}
export const withFlash = <T extends MobFrame>(fr: T, flash: boolean): T =>
  flash ? { ...fr, img: flashImg(fr.img) } : fr;

/** Готовый рисунок → холст: облик (элита — золотой кант, альбинос — бледный), зеркало, вспышка. */
export function finish(px: Px, mir: boolean, flash: boolean, look: Look): HTMLCanvasElement {
  let p = px;
  if (look === 'elite') {
    const q = new Px(p.w, p.h);
    q.data.set(p.data);
    q.outline(GOLDK);
    p = q;
  } else if (look === 'albino') p = p.tint(hex('#f4ece4'), 0.45);
  if (mir) p = p.flipX();
  if (flash) p = p.tint(WHITE, 0.9);
  const c = p.canvas();
  const b = boxOf(p);
  if (b) BOX.set(c, b);
  return c;
}

// ---- Обрезка кадра по рисунку ------------------------------------------------------------
//
// Холст кадра — с запасом под замах и падение, а движок кладёт его на экран
// целиком (`drawImage` в экранном масштабе): пустые поля стоили толпе этажа
// больше, чем само рисование. Кеш хранит кадр, обрезанный до рисунка: начало
// холста сдвигается — на столько же сдвигаются якорь и слой `lit` (движок кладёт
// `lit` тем же якорем). Рисунок на экране тот же до пикселя.

/** Рамка непрозрачного рисунка [x0, y0, x1, y1] — из `finish`. */
const BOX = new WeakMap<HTMLCanvasElement, [number, number, number, number]>();
/** Левый верхний угол светящихся точек слоя `lit` — из `litOf`. */
const LBOX = new WeakMap<HTMLCanvasElement, [number, number]>();
/** Сдвиг начала обрезанного кадра относительно полного холста. */
const OFF = new WeakMap<HTMLCanvasElement, [number, number]>();
/** На сколько обрезан кадр слева и сверху: точки в координатах полного холста минус это. */
export const offOf = (img: HTMLCanvasElement): [number, number] => OFF.get(img) ?? [0, 0];

function boxOf(p: Px): [number, number, number, number] | null {
  const { w, h, data } = p;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0, i = y * w * 4 + 3; x < w; x++, i += 4)
      if (data[i]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
  return x1 < 0 ? null : [x0, y0, x1, y1];
}

function cropCanvas(
  src: HTMLCanvasElement,
  ox: number,
  oy: number,
  w: number,
  h: number,
): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  c.getContext('2d')?.drawImage(src, -ox, -oy);
  return c;
}

/**
 * Кадр, обрезанный до рисунка. `keep` — точка, которую обрезка не отрезает
 * (огонь некроманта рисуется слоем позже, по точкам полного холста).
 */
function trimFrame(fr: MobFrame): MobFrame {
  const b = BOX.get(fr.img);
  if (!b) return fr;
  const l = fr.lit ? LBOX.get(fr.lit) : undefined;
  const keep = (fr as { keep?: [number, number] }).keep;
  let ox = b[0];
  let oy = b[1];
  if (l) {
    ox = Math.min(ox, l[0]);
    oy = Math.min(oy, l[1]);
  }
  if (keep) {
    ox = Math.min(ox, keep[0]);
    oy = Math.min(oy, keep[1]);
  }
  ox = Math.max(0, ox);
  oy = Math.max(0, oy);
  const w = b[2] + 1 - ox;
  const h = b[3] + 1 - oy;
  if (!ox && !oy && w === fr.img.width && h === fr.img.height) return fr;
  const img = cropCanvas(fr.img, ox, oy, w, h);
  OFF.set(img, [ox, oy]);
  const lit = fr.lit ? cropCanvas(fr.lit, ox, oy, fr.lit.width - ox, fr.lit.height - oy) : fr.lit;
  return {
    ...fr,
    img,
    ax: fr.ax - ox,
    ay: fr.ay - oy,
    lit,
    eye: fr.eye ? [fr.eye[0] - ox, fr.eye[1] - oy] : fr.eye,
  };
}

/** Замер для стенда: сколько кадров мобов построено и за сколько (мс). */
export const F4_MOB_STAT = {
  n: 0,
  ms: [] as number[],
  by: {} as Record<string, number>,
  size: {} as Record<string, () => number>,
  /** Последние промахи кеша (вид|ключ) — для стенда: что рисуется заново в бою. */
  miss: [] as string[],
  /** Стенд: не обрезать кадры (сверка «до пикселя» с обрезкой). */
  noTrim: false,
};
export function stat(kind: string, ms: number, key = ''): void {
  F4_MOB_STAT.n++;
  if (F4_MOB_STAT.ms.length < 4000) F4_MOB_STAT.ms.push(ms);
  F4_MOB_STAT.miss.push(`${kind}|${key}`);
  if (F4_MOB_STAT.miss.length > 400) F4_MOB_STAT.miss.splice(0, 200);
  F4_MOB_STAT.by[kind] = (F4_MOB_STAT.by[kind] ?? 0) + 1;
}

/** Кадр из кеша вида: нет — построить и замерить. */
export function cached(
  lru: FrameLRU<MobFrame>,
  kind: string,
  key: string,
  build: () => MobFrame,
): MobFrame {
  let fr = lru.get(key);
  if (!fr) {
    const t0 = performance.now();
    const full = build();
    fr = lru.set(key, F4_MOB_STAT.noTrim ? full : trimFrame(full));
    stat(kind, performance.now() - t0, key);
  }
  return fr;
}

/** Слой поверх темноты: только светящиеся точки (глаза, огонь) — общий для кадров с теми же точками. */
export const LITS = frameLRU<HTMLCanvasElement>(600);
export function litOf(
  w: number,
  h: number,
  pts: [number, number, RGBA][],
): HTMLCanvasElement | null {
  if (!pts.length) return null;
  const key = `${w}x${h}|${pts.map(([x, y, c]) => `${x},${y},${c.join('.')}`).join(';')}`;
  let c = LITS.get(key);
  if (!c) {
    // Холст слоя — только до самой правой и нижней светящейся точки: движок
    // кладёт `lit` тем же якорем, что и кадр (начало холста то же), а рисует
    // его в экранном масштабе — пустые поля полного кадра стоили толпе
    // ~1 мс на кадр (17 больших прозрачных холстов поверх темноты).
    let mx = 0;
    let my = 0;
    for (const [x, y] of pts) {
      mx = Math.max(mx, Math.round(x));
      my = Math.max(my, Math.round(y));
    }
    const p = new Px(Math.min(w, mx + 1), Math.min(h, my + 1));
    for (const [x, y, col] of pts) p.set(x, y, col);
    c = LITS.set(key, p.canvas());
    const b = boxOf(p);
    if (b) LBOX.set(c, [b[0], b[1]]);
  }
  return c;
}

/** Цвет глаз по облику — как у движка (`drawMob`). */
export const eyeCol = (look: Look, base: RGBA): RGBA =>
  look === 'albino' ? hex('#ff6a88') : look === 'elite' ? hex('#ffb020') : base;

// ---- Память рисунка: курс с пределом поворота, путь, смена режима, удар героя -------------

export interface Vis {
  now: number;
  x: number;
  y: number;
  /** Пройденный путь, клетки (шаг — по нему). */
  dist: number;
  /** Курс рисунка (сглажен пределом поворота). */
  yaw: number;
  mode: string;
  prev: string;
  /** Когда удар героя (по часам рендера) и откуда (угол от героя к мобу). */
  hitAt: number;
  hitAng: number;
  flash: number;
  /** Отбой щитом: прошлый ключ взмаха и когда отбил. */
  parry: number;
  parryAt: number;
}
export const VIS = new Map<number, Vis>();

export const angD = (a: number, b: number) => {
  let d = (a - b) % TAU;
  if (d > PI) d -= TAU;
  if (d < -PI) d += TAU;
  return d;
};

export function visOf(m: Mob, pose: MobPose, want: number, turn: number): Vis {
  const id = m.id ?? -1;
  const x = m.x ?? 0;
  const y = m.y ?? 0;
  let v = VIS.get(id);
  // Время пошло назад (лист кадров, новый бой) — память заново.
  if (v && (pose.now < v.now - 0.05 || pose.now - v.now > 1.5)) v = undefined;
  if (!v) {
    v = {
      now: pose.now,
      x,
      y,
      dist: 0,
      yaw: want,
      mode: pose.mode,
      prev: '',
      hitAt: -9,
      hitAng: 0,
      flash: 0,
      parry: m.data?.parry ?? 0,
      parryAt: -9,
    };
    VIS.set(id, v);
    if (VIS.size > 256) VIS.delete(VIS.keys().next().value as number);
  }
  const dt = Math.max(0, Math.min(0.1, pose.now - v.now));
  if (dt > 0) {
    const moved = Math.hypot(x - v.x, y - v.y);
    // В бою — по пути (упёрся в стену — ноги стоят); на листе кадров мир не
    // движется, и шаг идёт от скорости.
    v.dist += paintSim() ? Math.min(moved, 0.5) : Math.hypot(m.vx ?? 0, m.vy ?? 0) * dt;
    const mx = turn * dt;
    v.yaw += Math.max(-mx, Math.min(mx, angD(want, v.yaw)));
  }
  v.x = x;
  v.y = y;
  v.now = pose.now;
  if (pose.mode !== v.mode) {
    v.prev = v.mode;
    v.mode = pose.mode;
  }
  const fl = m.flash ?? 0;
  if (fl > v.flash + 0.01 && pose.mode !== 'dying') {
    v.hitAt = pose.now;
    const sim = paintSim();
    const kx = m.kx ?? 0;
    const ky = m.ky ?? 0;
    v.hitAng = sim
      ? Math.atan2(y - sim.hero.y, x - sim.hero.x)
      : Math.hypot(kx, ky) > 0.01
        ? Math.atan2(ky, kx)
        : (m.face ?? 0) + PI;
  }
  v.flash = fl;
  const pr = m.data?.parry ?? 0;
  if (pr !== v.parry) {
    v.parry = pr;
    v.parryAt = pose.now;
  }
  return v;
}

/** Отдача от удара героя (0,2 с): отброс по удару, вжатие, возврат — полями кадра. */
export function hurtFields(v: Vis, now: number, k = 1): Partial<MobFrame> {
  const a = now - v.hitAt;
  if (a < 0 || a > 0.2) return {};
  const e = a < 0.04 ? 1 : 1 - eOut((a - 0.04) / 0.16);
  const cx = Math.cos(v.hitAng);
  const cy = Math.sin(v.hitAng);
  return {
    dx: cx * 1.6 * e * k,
    dy: cy * 0.8 * e * k,
    rot: cx * 0.09 * e * k,
    sx: 1 + 0.06 * e * k,
    sy: 1 - 0.08 * e * k,
  };
}

/** Сложить поля хода кадра (сдвиги — суммой, сжатие — произведением). */
export function addFields(a: Partial<MobFrame>, b: Partial<MobFrame>): Partial<MobFrame> {
  const o: Partial<MobFrame> = { ...a };
  if (b.dx) o.dx = (o.dx ?? 0) + b.dx;
  if (b.dy) o.dy = (o.dy ?? 0) + b.dy;
  if (b.rot) o.rot = (o.rot ?? 0) + b.rot;
  if (b.sx !== undefined) o.sx = (o.sx ?? 1) * b.sx;
  if (b.sy !== undefined) o.sy = (o.sy ?? 1) * b.sy;
  return o;
}

/** Пустой кадр (кучка, пока кости ещё падают с умирающего костяка). */
export let EMPTY: HTMLCanvasElement | null = null;
export const emptyFrame = (): MobFrame => {
  EMPTY ??= new Px(1, 1).canvas();
  return { img: EMPTY, ax: 0, ay: 0, eye: null, shadow: 0, still: true };
};
