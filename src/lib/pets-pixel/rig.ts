// Пиксельные питомцы — общий риг. Тот же приём, что у мамонта 12-го
// (`f12-art.ts`): тело собрано из эллипсоидов, кадр считается лучом на
// пиксель с буфером глубины, свет сверху-слева-спереди, тон — ступенями
// палитры, контур и линии стыка частей. Отличия под питомца:
//   * камера почти анфас (наклон 15°): питомец смотрит на игрока;
//   * тон хранится НОМЕРОМ ступени палитры, а не цветом: шов, кант света и
//     контур сдвигают ступень, и рисунок не выходит из палитры;
//   * `along` — переход цвета вдоль части (огненное перо: багрянец у
//     основания → золото → белое у кончика), свет поверх него слабее;
//   * узор (`tex`) — от точки на самой части, а не от экрана: часть
//     двигается — узор едет с ней, контур не «кипит».
// Всё детерминировано: ни `Math.random`, ни времени — те же числа дают те
// же пиксели. Запекание — `scripts/pets-pixel/bake.ts`.

// Сперва плитки: у подземелья круг импортов (art → sprites → tiles → art), и
// при входе через `dungeon-art` плитки падают на ещё не готовом `hex`. Игра
// входит в круг с другой стороны, запекание и тесты — через этот файл.
import '../dungeon-tiles';
import { Px } from '../dungeon-art';

export type RGBA = [number, number, number, number];
export type V3 = [number, number, number];

// ---------------------------------------------------------------------------
// Цвет.
// ---------------------------------------------------------------------------

export function hx(h: string, a = 255): RGBA {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255, a];
}
export const ramp = (...c: string[]): RGBA[] => c.map((s) => hx(s));
export function mixc(a: RGBA, b: RGBA, k: number): RGBA {
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
    Math.round(a[3] + (b[3] - a[3]) * k),
  ];
}

// ---------------------------------------------------------------------------
// Время: ключи с разгоном и торможением (как `kf` мамонта).
// ---------------------------------------------------------------------------

/** Ключ: [время, значение, кривая к нему: 'i' разгон, 'o' торможение, 'l' ровно, иначе плавно]. */
export type Key = [number, number, ('i' | 'o' | 'l' | 's')?];
export function kf(t: number, keys: Key[]): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const k = keys[i];
    if (t < k[0]) {
      const p = keys[i - 1];
      const u = (t - p[0]) / (k[0] - p[0]);
      const e = k[2];
      const w =
        e === 'i' ? u * u * u : e === 'o' ? 1 - (1 - u) ** 3 : e === 'l' ? u : u * u * (3 - 2 * u);
      return p[1] + (k[1] - p[1]) * w;
    }
  }
  return keys[keys.length - 1][1];
}
export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
/** Горб 0 → 1 → 0 на отрезке [a, b]. */
export const bump = (t: number, a: number, b: number) =>
  t <= a || t >= b ? 0 : Math.sin(((t - a) / (b - a)) * Math.PI);
/** Время петли длиной T: всегда в [0, T). */
export const wrap = (t: number, T: number) => ((t % T) + T) % T;
/** Детерминированный шум точки. */
export function hash(x: number, y: number, s = 0): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Вторичное движение пружиной: `drive(t)` — куда тянет (поза ведущей
 * части), ответ — где кончик сейчас. Считается заново от `t0` шагами 1/240 с,
 * поэтому кадр зависит только от `t`: в петле начало берётся на две петли
 * раньше, и кончик успевает выйти на тот же ход, что и в прошлом круге.
 */
export function spring(
  drive: (t: number) => number,
  t: number,
  t0: number,
  freq: number,
  damp: number,
): number {
  const dt = 1 / 240;
  let x = drive(t0);
  let v = 0;
  const w = freq * Math.PI * 2;
  const n = Math.max(0, Math.round((t - t0) / dt));
  for (let i = 1; i <= n; i++) {
    const g = drive(t0 + i * dt);
    v += (w * w * (g - x) - 2 * damp * w * v) * dt;
    x += v * dt;
  }
  return x;
}

// ---------------------------------------------------------------------------
// Векторы.
// ---------------------------------------------------------------------------

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export function norm(a: V3): V3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
export const lerp3 = (a: V3, b: V3, k: number): V3 => [
  a[0] + (b[0] - a[0]) * k,
  a[1] + (b[1] - a[1]) * k,
  a[2] + (b[2] - a[2]) * k,
];
export function bezQ(a: V3, b: V3, c: V3, u: number): V3 {
  const v = 1 - u;
  return [
    v * v * a[0] + 2 * u * v * b[0] + u * u * c[0],
    v * v * a[1] + 2 * u * v * b[1] + u * u * c[1],
    v * v * a[2] + 2 * u * v * b[2] + u * u * c[2],
  ];
}
/** Поворот точки вокруг оси «к зрителю» (крен во фронтальной плоскости x–z), + — по часовой. */
export function rollY(p: V3, a: number, o: V3 = [0, 0, 0]): V3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const x = p[0] - o[0];
  const z = p[2] - o[2];
  return [o[0] + x * c + z * s, p[1], o[2] - x * s + z * c];
}
/** Поворот вокруг оси x (наклон к зрителю), + — верх уходит к зрителю. */
export function pitchX(p: V3, a: number, o: V3 = [0, 0, 0]): V3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const y = p[1] - o[1];
  const z = p[2] - o[2];
  return [p[0], o[1] + y * c + z * s, o[2] - y * s + z * c];
}
/** Поворот вокруг вертикали, + — передом вправо (к правому краю кадра). */
export function yawZ(p: V3, a: number, o: V3 = [0, 0, 0]): V3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const x = p[0] - o[0];
  const y = p[1] - o[1];
  return [o[0] + x * c + y * s, o[1] - x * s + y * c, p[2]];
}
/** Оси части: первая — вдоль `dir`, третья — ближе всего к `up`. */
export function axes(dir: V3, up: V3): [V3, V3, V3] {
  const e1 = norm(dir);
  let e3 = sub(up, mul(e1, dot(up, e1)));
  if (Math.hypot(e3[0], e3[1], e3[2]) < 1e-6) e3 = Math.abs(e1[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  e3 = norm(e3);
  const e2 = cross(e3, e1);
  return [e1, e2, e3];
}
export const AX0: [V3, V3, V3] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

// ---------------------------------------------------------------------------
// Камера и свет.
// ---------------------------------------------------------------------------

/** Наклон камеры: питомец почти анфас, макушка и лапы на полу чуть видны. */
const EL = 0.27;
const CE = Math.cos(EL);
const SE = Math.sin(EL);
/** К зрителю: +y — к зрителю, z — вверх, x — вправо по кадру. */
export const VIEW: V3 = [0, CE, SE];
/** К свету: сверху, слева, спереди. */
export const LIGHT: V3 = norm([-0.58, 0.52, 0.66]);
/** Точка модели → кадр: x, y вниз, глубина (больше — ближе). */
export function project(p: V3): [number, number, number] {
  return [p[0], p[1] * SE - p[2] * CE, p[1] * CE + p[2] * SE];
}

// ---------------------------------------------------------------------------
// Части и кадр.
// ---------------------------------------------------------------------------

export interface Part {
  c: V3;
  ax: [V3, V3, V3];
  r: V3;
  /** Номер палитры в списке `pal` кадра. */
  pal: number;
  /** Номер для швов: у частей одной детали (звенья пера) — один. */
  id: number;
  /** Тон вдоль первой оси: доля палитры у основания (q = −1) и у кончика (q = +1). */
  along?: [number, number];
  /** Сколько света поверх `along` (огонь светится сам — мало). */
  lit?: number;
  /** Сдвиг тона по точке на части (единичная сфера части): перья, чешуя. */
  tex?: (qx: number, qy: number, qz: number) => number;
  /** Сдвиг тона всей части (ярче — +). */
  bias?: number;
  /** Не участвует в швах (мелочь: глаз, звено цепи). */
  noSeam?: boolean;
}

export interface Frame {
  w: number;
  h: number;
  /** Номер палитры и ступень на пиксель (−1 — пусто). */
  pal: Int16Array;
  tone: Int16Array;
  zb: Float32Array;
  idb: Int16Array;
}

export function newFrame(w: number, h: number): Frame {
  const n = w * h;
  const f: Frame = {
    w,
    h,
    pal: new Int16Array(n),
    tone: new Int16Array(n),
    zb: new Float32Array(n),
    idb: new Int16Array(n),
  };
  f.pal.fill(-1);
  f.idb.fill(-1);
  f.zb.fill(-1e9);
  return f;
}

/** Нарисовать части в кадр; начало модели (земля под серединой) — в точке (ox, oy). */
export function drawParts(f: Frame, parts: Part[], pals: RGBA[][], ox: number, oy: number): void {
  const { w, h, zb } = f;
  for (const pt of parts) {
    const [e1, e2, e3] = pt.ax;
    const [r1, r2, r3] = pt.r;
    if (r1 <= 0.05 || r2 <= 0.05 || r3 <= 0.05) continue;
    const N = pals[pt.pal].length;
    const [scx, scy] = project(pt.c);
    const sy1 = e1[1] * SE - e1[2] * CE;
    const sy2 = e2[1] * SE - e2[2] * CE;
    const sy3 = e3[1] * SE - e3[2] * CE;
    const RX = Math.sqrt((r1 * e1[0]) ** 2 + (r2 * e2[0]) ** 2 + (r3 * e3[0]) ** 2) + 1;
    const RY = Math.sqrt((r1 * sy1) ** 2 + (r2 * sy2) ** 2 + (r3 * sy3) ** 2) + 1;
    const x0 = Math.max(0, Math.floor(ox + scx - RX));
    const x1 = Math.min(w - 1, Math.ceil(ox + scx + RX));
    const y0 = Math.max(0, Math.floor(oy + scy - RY));
    const y1 = Math.min(h - 1, Math.ceil(oy + scy + RY));
    if (x0 > x1 || y0 > y1) continue;
    const qdx = dot(VIEW, e1) / r1;
    const qdy = dot(VIEW, e2) / r2;
    const qdz = dot(VIEW, e3) / r3;
    const a = qdx * qdx + qdy * qdy + qdz * qdz;
    const lit = pt.lit ?? 1;
    for (let py = y0; py <= y1; py++) {
      const sy = py + 0.5 - oy;
      // Точка луча при t = 0: (sx, sy·SE, −sy·CE).
      const dy0 = sy * SE - pt.c[1];
      const dz0 = -sy * CE - pt.c[2];
      for (let px = x0; px <= x1; px++) {
        const dx0 = px + 0.5 - ox - pt.c[0];
        const q0x = (dx0 * e1[0] + dy0 * e1[1] + dz0 * e1[2]) / r1;
        const q0y = (dx0 * e2[0] + dy0 * e2[1] + dz0 * e2[2]) / r2;
        const q0z = (dx0 * e3[0] + dy0 * e3[1] + dz0 * e3[2]) / r3;
        const b = 2 * (q0x * qdx + q0y * qdy + q0z * qdz);
        const cc = q0x * q0x + q0y * q0y + q0z * q0z - 1;
        const disc = b * b - 4 * a * cc;
        if (disc < 0) continue;
        const t = (-b + Math.sqrt(disc)) / (2 * a);
        const i = py * w + px;
        if (t <= zb[i]) continue;
        const qx = q0x + t * qdx;
        const qy = q0y + t * qdy;
        const qz = q0z + t * qdz;
        const nx = (e1[0] * qx) / r1 + (e2[0] * qy) / r2 + (e3[0] * qz) / r3;
        const ny = (e1[1] * qx) / r1 + (e2[1] * qy) / r2 + (e3[1] * qz) / r3;
        const nz = (e1[2] * qx) / r1 + (e2[2] * qy) / r2 + (e3[2] * qz) / r3;
        const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        const lam = (nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]) / nl;
        // Тёплый отсвет снизу: тень не чёрная.
        const bounce = Math.max(0, -nz / nl) * 0.14;
        let k = Math.max(0, lam * 0.6 + 0.4 + bounce);
        if (pt.along) {
          const u = clamp01((qx + 1) / 2);
          k = lerp(pt.along[0], pt.along[1], u) + (k - 0.6) * 0.45 * lit;
        }
        if (pt.tex) k += pt.tex(qx, qy, qz);
        if (pt.bias) k += pt.bias;
        zb[i] = t;
        f.idb[i] = pt.noSeam ? -2 : pt.id;
        f.pal[i] = pt.pal;
        f.tone[i] = Math.max(0, Math.min(N - 1, Math.round(k * (N - 1))));
      }
    }
  }
}

/** Швы: дальняя часть темнее на ступень там, где к ней прилегает ближняя. */
export function seams(f: Frame, gap = 1.6, steps = 1): void {
  const { w, h, idb, zb, tone } = f;
  const hit: number[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (idb[i] < 0) continue;
      const nb = [
        x + 1 < w ? i + 1 : -1,
        y + 1 < h ? i + w : -1,
        x > 0 ? i - 1 : -1,
        y > 0 ? i - w : -1,
      ];
      for (const j of nb) {
        if (j < 0 || idb[j] < 0 || idb[j] === idb[i]) continue;
        if (zb[j] - zb[i] > gap) {
          hit.push(i);
          break;
        }
      }
    }
  for (const i of hit) tone[i] = Math.max(0, tone[i] - steps);
}

/** Кант света по кромке сверху-слева: ступень вверх у пикселей с пустотой выше или левее. */
export function rimLight(f: Frame, pals: RGBA[][], only?: (pal: number) => boolean): void {
  const { w, h, pal, tone } = f;
  const hit: number[] = [];
  for (let y = 1; y < h; y++)
    for (let x = 1; x < w; x++) {
      const i = y * w + x;
      if (pal[i] < 0 || (only && !only(pal[i]))) continue;
      if (pal[i - w] < 0 || pal[i - 1] < 0) hit.push(i);
    }
  for (const i of hit) tone[i] = Math.min(pals[pal[i]].length - 1, tone[i] + 1);
}

/** Кадр → пиксели. */
export function toPx(f: Frame, pals: RGBA[][]): Px {
  const p = new Px(f.w, f.h);
  for (let i = 0; i < f.w * f.h; i++) {
    const pl = f.pal[i];
    if (pl < 0) continue;
    const c = pals[pl][f.tone[i]];
    const j = i * 4;
    p.data[j] = c[0];
    p.data[j + 1] = c[1];
    p.data[j + 2] = c[2];
    p.data[j + 3] = c[3];
  }
  return p;
}

/**
 * Контур «по соседу»: пиксель снаружи фигуры темнеет к `ink` от цвета
 * соседа (у огня контур бурый, у тела — почти чёрный, у железа — сизый).
 * `k` — доля чернил.
 */
export function selOutline(p: Px, ink: RGBA, k = 0.78): void {
  const { w, h, data } = p;
  const add: [number, number, RGBA][] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 0) continue;
      let best = -1;
      let lum = 1e9;
      const nb: [number, number][] = [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ];
      for (const [nx, ny] of nb) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = (ny * w + nx) * 4;
        if (data[j + 3] < 200) continue;
        // Самый тёмный сосед: контур не светлеет у вспышки.
        const l = data[j] * 0.3 + data[j + 1] * 0.55 + data[j + 2] * 0.15;
        if (l < lum) {
          lum = l;
          best = j;
        }
      }
      if (best < 0) continue;
      const c: RGBA = [data[best], data[best + 1], data[best + 2], 255];
      add.push([x, y, mixc(c, ink, k)]);
    }
  for (const [x, y, c] of add) p.set(x, y, c);
}

/** Точка модели в кадре, если её не закрывает ближнее (допуск `tol`). */
export function seen(f: Frame, p: V3, ox: number, oy: number, tol = 1.2): [number, number] | null {
  const [sx, sy, sd] = project(p);
  const x = Math.floor(ox + sx);
  const y = Math.floor(oy + sy);
  if (x < 0 || y < 0 || x >= f.w || y >= f.h) return null;
  const i = y * f.w + x;
  if (f.pal[i] >= 0 && f.zb[i] > sd + tol) return null;
  return [x, y];
}

/** Буквенная карта поверх кадра (глаза, клюв): буква — цвет, точка — пусто. */
export function stamp(
  p: Px,
  rows: string[],
  pal: Record<string, RGBA>,
  x0: number,
  y0: number,
  flip = false,
): void {
  for (let y = 0; y < rows.length; y++)
    for (let x = 0; x < rows[y].length; x++) {
      const ch = rows[y][flip ? rows[y].length - 1 - x : x];
      const c = pal[ch];
      if (c) p.set(x0 + x, y0 + y, c);
    }
}

/** Шахматка: доля 0…1 → есть ли пиксель (порядок Байера 4×4). */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
export const dith = (x: number, y: number, k: number) => k > BAYER[(y & 3) * 4 + (x & 3)];
