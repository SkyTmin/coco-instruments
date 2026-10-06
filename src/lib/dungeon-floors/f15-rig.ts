// Мини-3D для монстров «Ядра» (анимации 15). Ортографическая камера сверху
// под углом: земля сжата до SE, высота — до CE, глубина к зрителю —
// y·CE + z·SE. Мир кадра в пикселях: x — восток, y — юг (к зрителю), z —
// вверх; начало — точка ног. Примитивы: эллипсоиды (точно, лучом),
// сужающиеся капсулы, плоские многоугольники (грани кристаллов, крылья,
// пластины), точки и линии. Буфер глубины, свет сверху-слева, тон
// ступенями, внешний контур и внутренний — по разрыву глубины. Узор
// считается в координатах тела, поэтому поворачивается вместе с ним и не
// «кипит» на ходу.

import { Px } from '../dungeon-art';

export type RGBA = [number, number, number, number];
export type Tones = [RGBA, RGBA, RGBA, RGBA];
export type V3 = [number, number, number];

/** Сжатие земли и высоты: синус и косинус угла камеры. */
export const SE = 0.6;
export const CE = 0.8;

export const v3 = (x: number, y: number, z: number): V3 => [x, y, z];
export const vadd = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const vsub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const vmul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const vdot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const vlen = (a: V3) => Math.sqrt(vdot(a, a));
export const vlerp = (a: V3, b: V3, k: number): V3 => [
  a[0] + (b[0] - a[0]) * k,
  a[1] + (b[1] - a[1]) * k,
  a[2] + (b[2] - a[2]) * k,
];
export const vcross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export function vnorm(a: V3): V3 {
  const l = vlen(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

// Свет экрана (сверху-слева, чуть к зрителю) — в мир: L = LX·R + LY·D + LZ·V.
const LIGHT = vnorm([-0.45, -0.72 * SE + 0.52 * CE, 0.72 * CE + 0.52 * SE]);

/**
 * Система координат части тела: начало и три орта — вперёд (f), вправо (s),
 * вверх (u). Поворот курса — вокруг вертикали; наклоны — вокруг своих осей.
 */
export class F3 {
  constructor(
    public o: V3,
    public f: V3,
    public s: V3,
    public u: V3,
  ) {}
  /** Смотрит по курсу `a` (0 — восток, π/2 — юг, к зрителю). */
  static yaw(a: number, o: V3 = [0, 0, 0]): F3 {
    const c = Math.cos(a);
    const si = Math.sin(a);
    return new F3(o, [c, si, 0], [-si, c, 0], [0, 0, 1]);
  }
  /** Точка в своих координатах → мир. */
  p(f: number, s: number, u: number): V3 {
    const { o, f: F, s: S, u: U } = this;
    return [
      o[0] + F[0] * f + S[0] * s + U[0] * u,
      o[1] + F[1] * f + S[1] * s + U[1] * u,
      o[2] + F[2] * f + S[2] * s + U[2] * u,
    ];
  }
  /** Направление в своих координатах → мир (без сдвига). */
  v(f: number, s: number, u: number): V3 {
    const { f: F, s: S, u: U } = this;
    return [
      F[0] * f + S[0] * s + U[0] * u,
      F[1] * f + S[1] * s + U[1] * u,
      F[2] * f + S[2] * s + U[2] * u,
    ];
  }
  /** Та же ориентация, начало в своей точке (f, s, u). */
  at(f: number, s: number, u: number): F3 {
    return new F3(this.p(f, s, u), this.f, this.s, this.u);
  }
  /** Наклон носом вниз (вокруг правой оси). */
  pitch(a: number): F3 {
    const c = Math.cos(a);
    const si = Math.sin(a);
    const f = vsub(vmul(this.f, c), vmul(this.u, si));
    const u = vadd(vmul(this.u, c), vmul(this.f, si));
    return new F3(this.o, f, this.s, u);
  }
  /** Крен: верх уходит вправо (вокруг оси «вперёд»). */
  roll(a: number): F3 {
    const c = Math.cos(a);
    const si = Math.sin(a);
    const s = vsub(vmul(this.s, c), vmul(this.u, si));
    const u = vadd(vmul(this.u, c), vmul(this.s, si));
    return new F3(this.o, this.f, s, u);
  }
  /** Поворот направо (вокруг своей вертикали). */
  turn(a: number): F3 {
    const c = Math.cos(a);
    const si = Math.sin(a);
    const f = vadd(vmul(this.f, c), vmul(this.s, si));
    const s = vsub(vmul(this.s, c), vmul(this.f, si));
    return new F3(this.o, f, s, this.u);
  }
  /** Равномерный масштаб осей (раздувание, сжатие). */
  scale(k: number): F3 {
    return new F3(this.o, vmul(this.f, k), vmul(this.s, k), vmul(this.u, k));
  }
}

export interface Mat {
  T: Tones;
  /** Свечение 0…1: такая доля яркости идёт в слой поверх темноты. */
  glow?: number;
  /** Сдвиг освещённости (+ светлее). */
  bias?: number;
  /**
   * Узор: точка в координатах тела (у эллипсоида — на единичной сфере, у
   * капсулы — [доля длины, x, y сечения], у грани — мир) и свет → свой
   * цвет или null (тон по свету).
   */
  pat?: (q: V3, l: number) => RGBA | null;
  /** Блик: на самом светлом — белая точка (кристалл, металл). */
  spec?: boolean;
  /** Без внутреннего контура (свечение, пламя, дым). */
  soft?: boolean;
  /** Ровный тон без света: номер ступени. */
  flat?: number;
  /** Свечение по точке тела 0…1 (трещины с магмой) — сверх `glow`. */
  gpat?: (q: V3) => number;
}

interface PEll {
  k: 0;
  c: V3;
  a: [V3, V3, V3];
  m: Mat;
  cut?: (q: V3) => boolean;
}
interface PCap {
  k: 1;
  a: V3;
  b: V3;
  r0: number;
  r1: number;
  m: Mat;
}
interface PPoly {
  k: 2;
  pts: V3[];
  m: Mat;
  bias: number;
}
interface PDot {
  k: 3;
  p: V3;
  c: RGBA;
  glow: number;
  s: number;
  bias: number;
}
interface PLine {
  k: 4;
  a: V3;
  b: V3;
  c: RGBA;
  glow: number;
  bias: number;
}
type Prim = PEll | PCap | PPoly | PDot | PLine;

export class Rig {
  prims: Prim[] = [];
  /** Точка глаза (мир): движок светит ею в темноте. */
  eye: V3 | null = null;
  /** Эллипсоид по осям рамки: центр (f, s, u) и полуоси по f, s, u. */
  ell(F: F3, c: V3, r: V3, m: Mat, cut?: (q: V3) => boolean): this {
    this.prims.push({
      k: 0,
      c: F.p(c[0], c[1], c[2]),
      a: [vmul(F.f, r[0]), vmul(F.s, r[1]), vmul(F.u, r[2])],
      m,
      cut,
    });
    return this;
  }
  /** Шар в мировой точке. */
  ball(c: V3, r: number, m: Mat): this {
    this.prims.push({ k: 0, c, a: [[r, 0, 0], [0, r, 0], [0, 0, r]], m });
    return this;
  }
  /** Сужающаяся капсула (конечность, шея, хвост) между мировыми точками. */
  cap(a: V3, b: V3, r0: number, r1: number, m: Mat): this {
    this.prims.push({ k: 1, a, b, r0, r1, m });
    return this;
  }
  /** Плоская грань по мировым вершинам (видна с обеих сторон). */
  poly(pts: V3[], m: Mat, bias = 0): this {
    if (pts.length >= 3) this.prims.push({ k: 2, pts, m, bias });
    return this;
  }
  /**
   * Шип-кристалл: пирамида от основания `b` по направлению `d` длиной `L`,
   * `n` граней, полуширина основания `w`, поворот граней `tw`.
   */
  spike(b: V3, d: V3, L: number, w: number, m: Mat, n = 4, tw = 0): this {
    const dir = vnorm(d);
    const ref: V3 = Math.abs(dir[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const e1 = vnorm(vcross(dir, ref));
    const e2 = vcross(dir, e1);
    const tip = vadd(b, vmul(dir, L));
    const ring: V3[] = [];
    for (let i = 0; i < n; i++) {
      const a = tw + (i / n) * Math.PI * 2;
      ring.push(vadd(b, vadd(vmul(e1, Math.cos(a) * w), vmul(e2, Math.sin(a) * w))));
    }
    for (let i = 0; i < n; i++) this.poly([ring[i], ring[(i + 1) % n], tip], m);
    return this;
  }
  dot(p: V3, c: RGBA, glow = 0, s = 1, bias = 0.6): this {
    this.prims.push({ k: 3, p, c, glow, s, bias });
    return this;
  }
  line(a: V3, b: V3, c: RGBA, glow = 0, bias = 0.3): this {
    this.prims.push({ k: 4, a, b, c, glow, bias });
    return this;
  }
  /** Сколько примитивов уже добавлено — метка для `explode(…, from)`. */
  get size(): number {
    return this.prims.length;
  }
  /**
   * Разлёт частей (смерть, раскол): каждый примитив с номером от `from`
   * летит от центра `c` со скоростью `spd` (пикс/ед. k), падает (`grav`),
   * ложится на пол и сжимается к своей середине. `k` — время разлёта 0…1.
   */
  explode(k: number, c: V3, seed: number, spd = 10, grav = 26, from = 0, shrink = 0.5): this {
    if (k <= 0) return this;
    const rnd = (i: number, s: number) => {
      const v = Math.sin(i * 127.1 + s * 311.7 + seed * 74.7) * 43758.5453;
      return v - Math.floor(v);
    };
    for (let i = from; i < this.prims.length; i++) {
      const q = this.prims[i];
      const mid: V3 =
        q.k === 0
          ? q.c
          : q.k === 1 || q.k === 4
            ? vlerp(q.a, q.b, 0.5)
            : q.k === 3
              ? q.p
              : vmul(
                  q.pts.reduce((s, p) => vadd(s, p), [0, 0, 0] as V3),
                  1 / q.pts.length,
                );
      const d = vnorm(
        vadd(vsub(mid, c), [(rnd(i, 1) - 0.5) * 6, (rnd(i, 2) - 0.5) * 6, rnd(i, 3) * 4]),
      );
      const v = spd * (0.6 + rnd(i, 4) * 0.8);
      let off: V3 = [d[0] * v * k, d[1] * v * k, d[2] * v * k + v * 0.6 * k - grav * k * k];
      if (mid[2] + off[2] < 0.6) off = [off[0], off[1], 0.6 - mid[2]];
      const sk = 1 - shrink * k;
      const mv = (p: V3): V3 => vadd(vadd(mid, vmul(vsub(p, mid), sk)), off);
      if (q.k === 0) {
        q.c = vadd(q.c, off);
        q.a = [vmul(q.a[0], sk), vmul(q.a[1], sk), vmul(q.a[2], sk)];
      } else if (q.k === 1 || q.k === 4) {
        q.a = mv(q.a);
        q.b = mv(q.b);
        if (q.k === 1) {
          q.r0 *= sk;
          q.r1 *= sk;
        }
      } else if (q.k === 2) q.pts = q.pts.map(mv);
      else q.p = vadd(q.p, off);
    }
    return this;
  }
}

/** Мир → экран кадра: [x, y, глубина к зрителю]. */
export function proj(P: V3, ax: number, ay: number): [number, number, number] {
  return [ax + P[0], ay + P[1] * SE - P[2] * CE, P[1] * CE + P[2] * SE];
}

export interface RigOut {
  p: Px;
  lit: Px | null;
  eye: [number, number] | null;
}

export interface RigOpt {
  /** Цвет внешнего контура; null — без него. */
  outline?: RGBA | null;
  /** Порог разрыва глубины для внутреннего контура, пиксели (0 — без него). */
  inner?: number;
  /** Цвет внутреннего контура (по умолчанию — темнейший тон дальней части). */
  innerC?: RGBA | null;
}

let BUF: {
  n: number;
  zb: Float32Array;
  id: Int16Array;
  col: Uint8ClampedArray;
  gl: Uint8Array;
} | null = null;

const band = (T: Tones, l: number): RGBA =>
  l > 0.78 ? T[3] : l > 0.38 ? T[2] : l > -0.02 ? T[1] : T[0];

/** Нарисовать риг на холст w×h, (ax, ay) — где на холсте точка ног. */
export function renderRig(
  rig: Rig,
  w: number,
  h: number,
  ax: number,
  ay: number,
  opt: RigOpt = {},
): RigOut {
  const N = w * h;
  if (!BUF || BUF.n < N)
    BUF = {
      n: N,
      zb: new Float32Array(N),
      id: new Int16Array(N),
      col: new Uint8ClampedArray(N * 4),
      gl: new Uint8Array(N),
    };
  const { zb, id, col, gl } = BUF;
  zb.fill(-1e9, 0, N);
  id.fill(-1, 0, N);
  gl.fill(0, 0, N);
  col.fill(0, 0, N * 4);
  const mats: (Mat | null)[] = [];
  let anyGlow = false;

  const put = (i: number, z: number, pid: number, c: RGBA, g: number) => {
    zb[i] = z;
    id[i] = pid;
    const j = i * 4;
    col[j] = c[0];
    col[j + 1] = c[1];
    col[j + 2] = c[2];
    col[j + 3] = c[3];
    gl[i] = g;
    if (g) anyGlow = true;
  };
  const shade = (m: Mat, n: V3, q: V3): RGBA => {
    const l = vdot(n, LIGHT) + (m.bias ?? 0);
    if (m.pat) {
      const c = m.pat(q, l);
      if (c) return c;
    }
    if (m.flat !== undefined) return m.T[m.flat];
    if (m.spec && l > 0.97) return [255, 255, 255, 255];
    return band(m.T, l);
  };
  const glowOf = (m: Mat) => Math.round(Math.max(0, Math.min(1, m.glow ?? 0)) * 255);
  const gq = (m: Mat, g: number, q: V3) =>
    m.gpat ? Math.max(g, Math.round(Math.max(0, Math.min(1, m.gpat(q))) * 255)) : g;

  rig.prims.forEach((q, pid) => {
    if (q.k === 0) {
      mats.push(q.m);
      const [A1, A2, A3] = q.a;
      const inv = [1 / vdot(A1, A1), 1 / vdot(A2, A2), 1 / vdot(A3, A3)];
      const A = [A1, A2, A3];
      const gX = A.map((a, i) => a[0] * inv[i]);
      const gY = A.map((a, i) => (a[1] * SE - a[2] * CE) * inv[i]);
      const gV = A.map((a, i) => (a[1] * CE + a[2] * SE) * inv[i]);
      const c0 = A.map((a, i) => -vdot(q.c, a) * inv[i]);
      const [cx, cy] = proj(q.c, ax, ay);
      const ex = Math.sqrt(A1[0] ** 2 + A2[0] ** 2 + A3[0] ** 2);
      const ey = Math.sqrt(
        (A1[1] * SE - A1[2] * CE) ** 2 +
          (A2[1] * SE - A2[2] * CE) ** 2 +
          (A3[1] * SE - A3[2] * CE) ** 2,
      );
      const x0 = Math.max(0, Math.floor(cx - ex - 1));
      const x1 = Math.min(w - 1, Math.ceil(cx + ex + 1));
      const y0 = Math.max(0, Math.floor(cy - ey - 1));
      const y1 = Math.min(h - 1, Math.ceil(cy + ey + 1));
      const a2 = gV[0] * gV[0] + gV[1] * gV[1] + gV[2] * gV[2];
      if (a2 < 1e-12) return;
      const g = glowOf(q.m);
      for (let py = y0; py <= y1; py++) {
        const Y = py + 0.5 - ay;
        for (let px = x0; px <= x1; px++) {
          const X = px + 0.5 - ax;
          const q0 = gX[0] * X + gY[0] * Y + c0[0];
          const q1 = gX[1] * X + gY[1] * Y + c0[1];
          const q2 = gX[2] * X + gY[2] * Y + c0[2];
          const b = 2 * (q0 * gV[0] + q1 * gV[1] + q2 * gV[2]);
          const c = q0 * q0 + q1 * q1 + q2 * q2 - 1;
          const disc = b * b - 4 * a2 * c;
          if (disc < 0) continue;
          const sq = Math.sqrt(disc);
          let t = (-b + sq) / (2 * a2);
          let Q: V3 = [q0 + t * gV[0], q1 + t * gV[1], q2 + t * gV[2]];
          let back = false;
          if (q.cut && q.cut(Q)) {
            t = (-b - sq) / (2 * a2);
            Q = [q0 + t * gV[0], q1 + t * gV[1], q2 + t * gV[2]];
            if (q.cut(Q)) continue;
            back = true;
          }
          const i = py * w + px;
          if (t <= zb[i]) continue;
          let n = vnorm([
            Q[0] * A1[0] * inv[0] + Q[1] * A2[0] * inv[1] + Q[2] * A3[0] * inv[2],
            Q[0] * A1[1] * inv[0] + Q[1] * A2[1] * inv[1] + Q[2] * A3[1] * inv[2],
            Q[0] * A1[2] * inv[0] + Q[1] * A2[2] * inv[1] + Q[2] * A3[2] * inv[2],
          ]);
          if (back) n = vmul(n, -0.6);
          put(i, t, pid, shade(q.m, n, Q), gq(q.m, g, Q));
        }
      }
    } else if (q.k === 1) {
      mats.push(q.m);
      const [xa, ya, da] = proj(q.a, ax, ay);
      const [xb, yb, db] = proj(q.b, ax, ay);
      const R = Math.max(q.r0, q.r1);
      const x0 = Math.max(0, Math.floor(Math.min(xa, xb) - R - 1));
      const x1 = Math.min(w - 1, Math.ceil(Math.max(xa, xb) + R + 1));
      const y0 = Math.max(0, Math.floor(Math.min(ya, yb) - R - 1));
      const y1 = Math.min(h - 1, Math.ceil(Math.max(ya, yb) + R + 1));
      const ex = xb - xa;
      const ey = yb - ya;
      const L2 = ex * ex + ey * ey;
      const g = glowOf(q.m);
      for (let py = y0; py <= y1; py++)
        for (let px = x0; px <= x1; px++) {
          const cx = px + 0.5;
          const cy = py + 0.5;
          let t = L2 > 1e-6 ? ((cx - xa) * ex + (cy - ya) * ey) / L2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const r = q.r0 + (q.r1 - q.r0) * t;
          if (r <= 0.05) continue;
          const ox = cx - (xa + ex * t);
          const oy = cy - (ya + ey * t);
          const d2 = ox * ox + oy * oy;
          if (d2 > r * r) continue;
          const hz = Math.sqrt(r * r - d2);
          const z = da + (db - da) * t + hz;
          const i = py * w + px;
          if (z <= zb[i]) continue;
          const nx = ox / r;
          const ny = oy / r;
          const nz = hz / r;
          const n: V3 = [nx, ny * SE + nz * CE, -ny * CE + nz * SE];
          const Q: V3 = [t, nx, ny];
          put(i, z, pid, shade(q.m, n, Q), gq(q.m, g, Q));
        }
    } else if (q.k === 2) {
      mats.push(q.m);
      const sp = q.pts.map((P) => proj(P, ax, ay));
      // Нормаль по Ньюэллу — устойчива и для невыпуклых.
      let nx = 0;
      let ny = 0;
      let nz = 0;
      for (let i = 0; i < q.pts.length; i++) {
        const a = q.pts[i];
        const b = q.pts[(i + 1) % q.pts.length];
        nx += (a[1] - b[1]) * (a[2] + b[2]);
        ny += (a[2] - b[2]) * (a[0] + b[0]);
        nz += (a[0] - b[0]) * (a[1] + b[1]);
      }
      let n = vnorm([nx, ny, nz]);
      let nV = n[1] * CE + n[2] * SE;
      if (Math.abs(nV) < 0.04) return;
      let back = 0;
      if (nV < 0) {
        n = vmul(n, -1);
        nV = -nV;
        back = -0.12;
      }
      const k0 = vdot(n, q.pts[0]);
      const nX = n[0];
      const nY = n[1] * SE - n[2] * CE;
      let mx0 = 1e9;
      let mx1 = -1e9;
      let my0 = 1e9;
      let my1 = -1e9;
      for (const [x, y] of sp) {
        mx0 = Math.min(mx0, x);
        mx1 = Math.max(mx1, x);
        my0 = Math.min(my0, y);
        my1 = Math.max(my1, y);
      }
      const x0 = Math.max(0, Math.floor(mx0));
      const x1 = Math.min(w - 1, Math.ceil(mx1));
      const y0 = Math.max(0, Math.floor(my0));
      const y1 = Math.min(h - 1, Math.ceil(my1));
      const m: Mat = back ? { ...q.m, bias: (q.m.bias ?? 0) + back } : q.m;
      const g = glowOf(q.m);
      for (let py = y0; py <= y1; py++) {
        const cy = py + 0.5;
        for (let px = x0; px <= x1; px++) {
          const cx = px + 0.5;
          let inside = false;
          for (let i = 0, j = sp.length - 1; i < sp.length; j = i++) {
            const xi = sp[i][0];
            const yi = sp[i][1];
            const xj = sp[j][0];
            const yj = sp[j][1];
            if (yi > cy !== yj > cy && cx < ((xj - xi) * (cy - yi)) / (yj - yi) + xi)
              inside = !inside;
          }
          if (!inside) continue;
          const X = cx - ax;
          const Y = cy - ay;
          const t = (k0 - nX * X - nY * Y) / nV + q.bias;
          const i = py * w + px;
          if (t <= zb[i]) continue;
          const P: V3 = [X, Y * SE + t * CE, -Y * CE + t * SE];
          put(i, t, pid, shade(m, n, P), g);
        }
      }
    } else if (q.k === 3) {
      mats.push(null);
      const [x, y, d] = proj(q.p, ax, ay);
      const xi = Math.floor(x);
      const yi = Math.floor(y);
      const g = Math.round(q.glow * 255);
      const pts: [number, number][] =
        q.s >= 2
          ? [
              [0, 0],
              [1, 0],
              [-1, 0],
              [0, 1],
              [0, -1],
            ]
          : [[0, 0]];
      for (const [ox, oy] of pts) {
        const X = xi + ox;
        const Y = yi + oy;
        if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
        const i = Y * w + X;
        if (d + q.bias <= zb[i]) continue;
        put(i, d + q.bias, pid, ox || oy ? [q.c[0], q.c[1], q.c[2], q.c[3]] : q.c, g);
      }
    } else {
      mats.push(null);
      const [xa, ya, da] = proj(q.a, ax, ay);
      const [xb, yb, db] = proj(q.b, ax, ay);
      const n = Math.ceil(Math.max(Math.abs(xb - xa), Math.abs(yb - ya)) * 1.5) + 1;
      const g = Math.round(q.glow * 255);
      for (let s = 0; s <= n; s++) {
        const k = s / n;
        const X = Math.floor(xa + (xb - xa) * k);
        const Y = Math.floor(ya + (yb - ya) * k);
        if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
        const i = Y * w + X;
        const z = da + (db - da) * k + q.bias;
        if (z <= zb[i]) continue;
        put(i, z, pid, q.c, g);
      }
    }
  });

  const p = new Px(w, h);
  const out = p.data;
  out.set(col.subarray(0, N * 4));
  // Внутренний контур: пиксель дальней части у разрыва глубины темнеет.
  const thr = opt.inner ?? 2.6;
  if (thr > 0) {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const pid = id[i];
        if (pid < 0) continue;
        const m = mats[pid];
        if (!m || m.soft || gl[i] > 160) continue;
        const z = zb[i] + thr;
        let near = -1;
        if (x > 0 && id[i - 1] >= 0 && id[i - 1] !== pid && zb[i - 1] > z) near = i - 1;
        else if (x < w - 1 && id[i + 1] >= 0 && id[i + 1] !== pid && zb[i + 1] > z) near = i + 1;
        else if (y > 0 && id[i - w] >= 0 && id[i - w] !== pid && zb[i - w] > z) near = i - w;
        else if (y < h - 1 && id[i + w] >= 0 && id[i + w] !== pid && zb[i + w] > z) near = i + w;
        if (near < 0) continue;
        const c = opt.innerC ?? m.T[0];
        const j = i * 4;
        out[j] = c[0];
        out[j + 1] = c[1];
        out[j + 2] = c[2];
      }
  }
  // Внешний контур по силуэту (полупрозрачное не обводится).
  const oc = opt.outline === undefined ? ([10, 6, 20, 255] as RGBA) : opt.outline;
  if (oc) {
    const solid = (x: number, y: number) =>
      x >= 0 && y >= 0 && x < w && y < h && col[(y * w + x) * 4 + 3] >= 200;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (col[i * 4 + 3] >= 100) continue;
        if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) {
          const j = i * 4;
          out[j] = oc[0];
          out[j + 1] = oc[1];
          out[j + 2] = oc[2];
          out[j + 3] = oc[3];
        }
      }
  }
  let lit: Px | null = null;
  if (anyGlow) {
    lit = new Px(w, h);
    const L = lit.data;
    for (let i = 0; i < N; i++) {
      if (!gl[i]) continue;
      const j = i * 4;
      L[j] = out[j];
      L[j + 1] = out[j + 1];
      L[j + 2] = out[j + 2];
      L[j + 3] = Math.round((out[j + 3] * gl[i]) / 255);
    }
  }
  let eye: [number, number] | null = null;
  if (rig.eye) {
    const [x, y, d] = proj(rig.eye, ax, ay);
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    if (xi >= 0 && yi >= 0 && xi < w && yi < h && zb[yi * w + xi] <= d + 1.2) eye = [xi, yi];
  }
  return { p, lit, eye };
}
