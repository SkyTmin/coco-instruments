// Этаж 6 «Огненный разлом» — набор рисунка мобов (анимации мобов 6, по эталону
// боссов 12–14 и мобов 2–5). Мобы собираются мини-3D ригом `f15-rig.ts`
// (только импорт): тело — эллипсоиды и капсулы в своих осях, свет
// сверху-слева, контур, свечение — слоем поверх темноты. Отсюда все 8 сторон
// честно (свет на зеркале был бы справа). Каждое действие — трек 24 к/с от
// `pose.t`, кадр контакта — миг урона мозга; ход — по пройденному пути, курс —
// с пределом поворота; покой — с фазой от номера моба; реакция на удар героя —
// полями кадра. Кадры — только в `frameLRU` с пределом на вид, холст обрезан
// до рисунка, вспышка удара — перекраской готового холста; прогрев —
// `registerMobWarm` во всех 8 сторонах, смерти тоже.

import { Px } from '../dungeon-art';
import { frameLRU, paintSim } from '../dungeon-paint';
import type { FrameLRU, MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import { proj, renderRig, SE } from './f15-rig';
import type { RGBA, Rig, RigOut, Tones, V3 } from './f15-rig';

export type { RGBA, Tones, V3 };
export type Look = MobPose['look'];

export const PI = Math.PI;
export const TAU = PI * 2;
export const FPS = 24;

// ---- Цвет --------------------------------------------------------------------------

export const hx = (h: string, a = 255): RGBA => {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255, a];
};
export const tn = (a: string, b: string, c: string, d: string): Tones => [
  hx(a),
  hx(b),
  hx(c),
  hx(d),
];
export const mixc = (a: RGBA, b: RGBA, k: number): RGBA => [
  Math.round(a[0] + (b[0] - a[0]) * k),
  Math.round(a[1] + (b[1] - a[1]) * k),
  Math.round(a[2] + (b[2] - a[2]) * k),
  Math.round(a[3] + (b[3] - a[3]) * k),
];
export const alpha = (c: RGBA, a: number): RGBA => [c[0], c[1], c[2], Math.round(clamp01(a) * 255)];
/** Тоны, смешанные к цвету (остывание, обугливание). */
export const mixT = (t: Tones, c: RGBA, k: number): Tones => [
  mixc(t[0], c, k),
  mixc(t[1], c, k),
  mixc(t[2], c, k),
  mixc(t[3], c, k),
];

export const INK = hx('#150f0b');
export const WHITE = hx('#ffffff');
export const GOLD = hx('#ffcc40');
/** Палитра огня этажа: от тёмного к белому. */
export const FIRE: RGBA[] = [
  hx('#7a1c06'),
  hx('#d8400e'),
  hx('#ff8a1e'),
  hx('#ffd24a'),
  hx('#fff4c0'),
];
export const FIRE_T: Tones = [FIRE[1], FIRE[2], FIRE[3], FIRE[4]];
export const ASH_T = tn('#2a2624', '#4a4440', '#6e6660', '#968c84');
/** Невидимый материал: плоскость лавы или пола, ниже которой тело не видно. */
export const CLIP: Tones = [
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
];

// ---- Кривые и кванты ---------------------------------------------------------------

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
export const smooth = (k: number) => {
  const x = clamp01(k);
  return x * x * (3 - 2 * x);
};
export const sstep = (a: number, b: number, x: number) => smooth((x - a) / (b - a));
export const easeOut = (k: number) => 1 - (1 - clamp01(k)) ** 3;
export const easeIn = (k: number) => clamp01(k) ** 2;
export const easeInOut = (k: number) => {
  const x = clamp01(k);
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
};
/** Детерминированный шум 0…1 по трём числам (без `sim.rng`). */
export const hash = (a: number, b: number, c = 0) => {
  let h =
    (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1274126177)) >>>
    0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
/** Номер кадра 24 к/с от времени, не больше `max`. */
export const fi = (t: number, max: number) =>
  Math.min(max, Math.max(0, Math.floor(t * FPS + 1e-6)));
/** Доля действия длиной T, которую показывает кадр f (середина кадра). */
export const kf = (f: number, T: number) => clamp01((f + 0.5) / FPS / T);
export const mod = (n: number, k: number) => ((Math.floor(n) % k) + k) % k;

export type Ease = (x: number) => number;
/** Ключ трека: [доля или время, значение, кривая входа в ключ]. */
export type Key = [number, number, Ease?];
/** Трек ключей: между ключами — по кривой ключа (по умолчанию — плавно). */
export function trk(k: number, keys: Key[]): number {
  if (k <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1, e] = keys[i];
    if (k <= t1) {
      const [t0, v0] = keys[i - 1];
      const u = (k - t0) / Math.max(1e-6, t1 - t0);
      return v0 + (v1 - v0) * (e ?? smooth)(u);
    }
  }
  return keys[keys.length - 1][1];
}

// ---- Стороны и курс -------------------------------------------------------------------

export const NDIR = 8;
/** Игровой угол → курс рига: на экране морда смотрит точно туда же. */
export const rigYaw = (a: number) => Math.atan2(Math.sin(a), SE * Math.cos(a));
export const dirN = (a: number) => mod(Math.round((a / TAU) * NDIR), NDIR);
export const yawN = (d: number) => rigYaw((d / NDIR) * TAU);
export const angD = (a: number, b: number) => {
  let d = (a - b) % TAU;
  if (d > PI) d -= TAU;
  if (d < -PI) d += TAU;
  return d;
};
/** Сторона камеры: правый бок ближе к зрителю при cos(курса) ≥ 0. */
export const camSide = (yaw: number) => (Math.cos(yaw) >= 0 ? 1 : -1);

export const speedOf = (m: Mob) => Math.hypot(m.vx ?? 0, m.vy ?? 0);
export const moving = (m: Mob, thr = 0.4) => speedOf(m) > thr;
/** Курс по ходу: движется — по скорости, стоит — куда смотрит. */
export const headOf = (m: Mob, thr = 0.4) =>
  moving(m, thr) ? Math.atan2(m.vy ?? 0, m.vx ?? 0) : (m.face ?? 0);

// ---- Память рисунка: курс с пределом поворота, путь, прошлый режим, удар героя ----------

export interface Vis {
  now: number;
  x: number;
  y: number;
  /** Курс рисунка, игровой угол (сглажен пределом поворота). */
  yaw: number;
  /** Пройденный путь, клетки (шаг — по нему). */
  dist: number;
  mode: string;
  prev: string;
  /** Когда режим сменился (часы рендера). */
  modeAt: number;
  /** Миг удара героя (часы рендера) и отдача — единичный вектор. */
  hit: number;
  fl: number;
  kx: number;
  ky: number;
  /** Свои числа вида (корка голема, подскок…). */
  n: Record<string, number>;
}
const VIS = new Map<number, Vis>();

function knockOf(v: Vis, m: Mob): void {
  const sim = paintSim();
  let kx = m.kx ?? 0;
  let ky = m.ky ?? 0;
  if (sim && Math.hypot(kx, ky) < 0.01) {
    kx = (m.x ?? 0) - sim.hero.x;
    ky = (m.y ?? 0) - sim.hero.y;
  }
  const l = Math.hypot(kx, ky);
  const f = m.face ?? 0;
  v.kx = l > 0.01 ? kx / l : -Math.cos(f);
  v.ky = l > 0.01 ? ky / l : -Math.sin(f);
}

/**
 * Ход моба для рисунка: курс `want` с пределом поворота `turn` (рад/с), путь,
 * прошлый режим, удар героя. Память — по номеру моба (копия долгой смерти
 * помнит то же); время пошло назад (лист кадров, новый бой) — заново.
 */
export function visOf(m: Mob, pose: MobPose, want: number, turn: number): Vis {
  const id = m.id ?? -1;
  const now = pose.now || 0;
  const fl = m.flash ?? 0;
  let v = VIS.get(id);
  if (v && (now < v.now - 0.05 || now - v.now > 1.5)) v = undefined;
  if (!v) {
    v = {
      now,
      x: m.x ?? 0,
      y: m.y ?? 0,
      yaw: want,
      dist: speedOf(m) * (pose.t || 0),
      mode: pose.mode,
      prev: '',
      modeAt: now - (pose.t || 0),
      hit: fl > 0 ? now - Math.max(0, 0.12 - fl) : -9,
      fl,
      kx: 0,
      ky: 0,
      n: {},
    };
    knockOf(v, m);
    VIS.set(id, v);
    if (VIS.size > 400) VIS.delete(VIS.keys().next().value as number);
    return v;
  }
  const dt = clamp(now - v.now, 0, 0.1);
  if (dt > 0) {
    // В бою — по пути (упёрся в стену — ноги стоят); на листе мир не
    // движется, и шаг идёт от скорости.
    v.dist += paintSim()
      ? Math.min(Math.hypot((m.x ?? 0) - v.x, (m.y ?? 0) - v.y), 0.5)
      : speedOf(m) * dt;
    v.x = m.x ?? 0;
    v.y = m.y ?? 0;
    v.now = now;
    const mx = turn * dt;
    v.yaw += clamp(angD(want, v.yaw), -mx, mx);
  }
  if (pose.mode !== v.mode) {
    v.prev = v.mode;
    v.mode = pose.mode;
    v.modeAt = now - (pose.t || 0);
  }
  if (fl > v.fl + 0.02) {
    v.hit = now;
    knockOf(v, m);
  }
  v.fl = fl;
  return v;
}

/**
 * Реакция на удар героя — 6 кадров поверх любой позы: отброс корпуса по
 * отдаче, вжатие, наклон прочь от героя, возврат. `A` — размах, пиксели.
 */
export function hurtFx(v: Vis, now: number, A: number, ex: Partial<MobFrame>): number {
  const age = now - v.hit;
  if (age < 0 || age >= 0.25) return -1;
  const out = age < 0.05 ? easeOut(age / 0.05) : 1 - sstep(0.05, 0.25, age);
  const sq = age < 0.1 ? 1 - age / 0.1 : 0;
  ex.dx = (ex.dx ?? 0) + v.kx * A * out;
  ex.dy = (ex.dy ?? 0) + v.ky * A * out * 0.6;
  ex.sx = (ex.sx ?? 1) * (1 + 0.12 * sq);
  ex.sy = (ex.sy ?? 1) * (1 - 0.12 * sq);
  ex.rot = (ex.rot ?? 0) + v.kx * 0.12 * out;
  return age;
}

// ---- Кадр: риг → картинка → обрезка → кеш ----------------------------------------------

export interface Pic {
  p: Px;
  lit: Px | null;
  ax: number;
  ay: number;
  eye: [number, number] | null;
}

export interface Kind {
  name: string;
  w: number;
  h: number;
  ax: number;
  ay: number;
  pics: FrameLRU<Pic>;
  frames: FrameLRU<MobFrame>;
  limit: number;
}

const KINDS: Kind[] = [];
/** Вид: холст рига w×h, точка ног (ax, ay); предел кеша кадров. */
export const kindOf = (
  name: string,
  w: number,
  h: number,
  ax: number,
  ay: number,
  limit: number,
): Kind => {
  const K: Kind = {
    name,
    w,
    h,
    ax,
    ay,
    pics: frameLRU<Pic>(Math.round(limit * 0.6)),
    frames: frameLRU<MobFrame>(limit),
    limit,
  };
  KINDS.push(K);
  return K;
};

/**
 * Замер для стенда: цена нового кадра (мс), сколько построено, сколько — в бою
 * (не прогревом) и каких (последние 300 ключей); `clear` — сбросить кеши.
 */
export const F6_MOB_STAT = {
  n: 0,
  battle: 0,
  ms: [] as number[],
  max: 0,
  maxKey: '',
  keys: [] as string[],
  warm: 0,
  by: {} as Record<string, number>,
  clear: () => {
    for (const K of KINDS) {
      K.pics.clear();
      K.frames.clear();
    }
  },
  sizes: () => KINDS.map((K) => `${K.name}:${K.frames.size}/${K.limit}`).join(' '),
};
let warming = false;
function stat(ms: number, key: string): void {
  const S = F6_MOB_STAT;
  S.n++;
  if (S.ms.length < 4000) S.ms.push(ms);
  if (ms > S.max) {
    S.max = ms;
    S.maxKey = key;
  }
  if (warming) S.warm++;
  else {
    S.battle++;
    S.keys.push(key);
    if (S.keys.length > 300) S.keys.splice(0, 100);
  }
}

export type Proj2 = (v: V3) => [number, number];

/** Нарисовать риг вида; `post` дорисовывает поверх (в точках рига — `P`). */
export function draw(
  K: Kind,
  r: Rig,
  post?: (o: RigOut, P: Proj2) => void,
  inner = 2.2,
  outline: RGBA | null = INK,
): Pic {
  const o = renderRig(r, K.w, K.h, K.ax, K.ay, { outline, inner });
  if (post)
    post(o, (v) => {
      const q = proj(v, K.ax, K.ay);
      return [q[0], q[1]];
    });
  return { p: o.p, lit: o.lit, ax: K.ax, ay: K.ay, eye: o.eye };
}
export const litOn = (o: RigOut): Px => (o.lit ??= new Px(o.p.w, o.p.h));

function paleOf(p: Px): Px {
  const pale = hx('#f4ece4');
  const q = new Px(p.w, p.h);
  for (let i = 0; i < p.data.length; i += 4) {
    if (!p.data[i + 3]) continue;
    const l = (p.data[i] + p.data[i + 1] + p.data[i + 2]) / 3;
    const c = mixc([l, l, l, 255], pale, 0.45);
    q.data[i] = c[0];
    q.data[i + 1] = c[1];
    q.data[i + 2] = c[2];
    q.data[i + 3] = p.data[i + 3];
  }
  return q;
}

/** Золотой кант элиты — кольцом снаружи контура. */
function goldEdge(p: Px): Px {
  const q = new Px(p.w, p.h);
  q.data.set(p.data);
  const solid = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < p.w && y < p.h && p.data[(y * p.w + x) * 4 + 3] >= 200;
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      if (p.data[(y * p.w + x) * 4 + 3] >= 100) continue;
      if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))
        q.set(x, y, GOLD);
    }
  return q;
}

/** Тьма, из которой проявляется моб (из норы, из лавы): 0 — нет, 3 — почти чёрный. */
function darkOf(p: Px, lvl: number): Px {
  const k = (lvl / 4) * 0.9;
  const dk = hx('#0a0606');
  const q = new Px(p.w, p.h);
  for (let i = 0; i < p.data.length; i += 4) {
    if (!p.data[i + 3]) continue;
    q.data[i] = p.data[i] + (dk[0] - p.data[i]) * k;
    q.data[i + 1] = p.data[i + 1] + (dk[1] - p.data[i + 1]) * k;
    q.data[i + 2] = p.data[i + 2] + (dk[2] - p.data[i + 2]) * k;
    q.data[i + 3] = p.data[i + 3];
  }
  return q;
}

/** Холст из буфера, обрезанный до прямоугольника. */
function cropCanvas(p: Px, x0: number, y0: number, cw: number, ch: number): HTMLCanvasElement {
  if (!x0 && !y0 && cw === p.w && ch === p.h) return p.canvas();
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  const g = c.getContext('2d');
  if (g) {
    const img = g.createImageData(cw, ch);
    for (let y = 0; y < ch; y++) {
      const s = ((y + y0) * p.w + x0) * 4;
      img.data.set(p.data.subarray(s, s + cw * 4), y * cw * 4);
    }
    g.putImageData(img, 0, 0);
  }
  return c;
}

/** Рамка рисунка: [x0, y0, x1, y1] или null (пусто). */
function bboxOf(p: Px, acc: [number, number, number, number] | null) {
  const { w, h, data } = p;
  let [x0, y0, x1, y1] = acc ?? [w, h, -1, -1];
  for (let y = 0; y < h; y++)
    for (let x = 0, i = y * w * 4 + 3; x < w; x++, i += 4)
      if (data[i]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? acc : ([x0, y0, x1, y1] as [number, number, number, number]);
}

let EMPTY: HTMLCanvasElement | null = null;

/**
 * Готовая картинка → кадр: облик, тьма проявления; холст и слой `lit`
 * обрезаны до общего рисунка (площадь кадра — главная цена вывода), якорь и
 * глаз — следом.
 */
function finish(pic: Pic, look: Look, dark: number): MobFrame {
  let p = pic.p;
  if (dark > 0) p = darkOf(p, dark);
  if (look === 'albino') p = paleOf(p);
  if (look === 'elite') p = goldEdge(p);
  const lit = pic.lit && dark < 2 ? pic.lit : null;
  let bb = bboxOf(p, null);
  if (lit) bb = bboxOf(lit, bb);
  if (!bb) {
    EMPTY ??= new Px(1, 1).canvas();
    return { img: EMPTY, ax: 0, ay: 0, eye: null };
  }
  const [x0, y0, x1, y1] = bb;
  const cw = x1 + 1 - x0;
  const ch = y1 + 1 - y0;
  const eye =
    dark >= 2 || !pic.eye ? null : ([pic.eye[0] - x0, pic.eye[1] - y0] as [number, number]);
  return {
    img: cropCanvas(p, x0, y0, cw, ch),
    ax: pic.ax - x0,
    ay: pic.ay - y0,
    eye,
    lit: lit ? cropCanvas(lit, x0, y0, cw, ch) : null,
  };
}

/** Белая вспышка удара — перекраска готового холста (кеш по холсту). */
const FLASHED = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();
export function flashImg(img: HTMLCanvasElement): HTMLCanvasElement {
  let c = FLASHED.get(img);
  if (!c) {
    c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d');
    if (g) {
      g.drawImage(img, 0, 0);
      g.globalCompositeOperation = 'source-atop';
      g.globalAlpha = 0.85;
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, c.width, c.height);
    }
    FLASHED.set(img, c);
  }
  return c;
}

/** Кадр вида: поза `anim`, кадр `f`, сторона `d`; `dark` — проявление из темноты. */
export function frameOf(
  K: Kind,
  anim: string,
  f: number,
  d: number,
  pose: MobPose,
  build: () => Pic,
  dark = 0,
): MobFrame {
  const key = `${anim}|${f}|${d}`;
  const fk = `${key}|${pose.look}|${dark}`;
  let fr = K.frames.get(fk);
  if (!fr) {
    const t0 = performance.now();
    let pic = K.pics.get(key);
    if (!pic) pic = K.pics.set(key, build());
    fr = K.frames.set(fk, finish(pic, pose.look, dark));
    stat(performance.now() - t0, `${K.name}|${fk}`);
  }
  return pose.flash ? { ...fr, img: flashImg(fr.img) } : fr;
}

export const WARM_POSE: MobPose = {
  anim: 'idle',
  frame: 0,
  mode: 'chase',
  t: 0,
  left: false,
  flash: false,
  look: 'normal',
  now: 0,
};

/** Прогрев: кадры поз во всех 8 сторонах, по одному на шаг. */
export function* warmAll(
  K: Kind,
  list: [string, number][],
  pic: (a: string, f: number, d: number) => Pic,
  dirs: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 7],
) {
  for (const [anim, n] of list)
    for (const d of dirs)
      for (let f = 0; f < n; f++) {
        warming = true;
        try {
          frameOf(K, anim, f, d, WARM_POSE, () => pic(anim, f, d));
        } finally {
          warming = false;
        }
        yield 0;
      }
}

/** Сложить поля кадра: сдвиги — суммой, сжатие — произведением. */
export function addFx(o: Partial<MobFrame>, dx = 0, dy = 0, sx = 1, sy = 1, rot = 0): void {
  if (dx) o.dx = (o.dx ?? 0) + dx;
  if (dy) o.dy = (o.dy ?? 0) + dy;
  if (sx !== 1) o.sx = (o.sx ?? 1) * sx;
  if (sy !== 1) o.sy = (o.sy ?? 1) * sy;
  if (rot) o.rot = (o.rot ?? 0) + rot;
}
