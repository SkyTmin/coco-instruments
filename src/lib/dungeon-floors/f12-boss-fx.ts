// Этаж 12 «Полярная ночь» — техники: метки замаха (у мобов этажа и у
// мамонта), удары по площади с контактом, зоны-картинки (`api.vfx`) и игла
// ежа.
//
// Мобы этажа и мамонт ставят `vNoTele`: красную метку движка этаж рисует
// сам в слое пола (`F12_FLOOR_HOOKS`). Цвет угрозы — тот же тёплый красный,
// что у движка (игрок его знает), кромка и рост — ледяные: корка инея
// нарастает от края к середине и белеет за миг до удара. Кадр контакта —
// кадр урона: мозг бьёт в конце `warn`, контакт рисует `registerImpactPainter`.

import { Px } from '../dungeon-art';
import {
  paintSim,
  registerImpactPainter,
  registerShotPainter,
  registerZonePainter,
} from '../dungeon-paint';
import type { Sprite } from '../dungeon-paint';
import type { Sim, Strike, Zone } from '../dungeon-sim';
import { F12_FLOOR_HOOKS, F12_SKY_HOOKS } from './f12-art';
import { f12Glacier, f12Mammoth, MAMMOTH, SPIRIT } from './f12-brains';

type G = CanvasRenderingContext2D;
type C3 = [number, number, number];
const TS = 16;
const TAU = Math.PI * 2;

const c3 = (h: string): C3 => {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};
const rgba = (c: C3, a: number) =>
  `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a)).toFixed(3)})`;

const P = {
  danger: c3('#ff5a44'),
  hot: c3('#ffc0a8'),
  white: c3('#ffffff'),
  frost: c3('#d6f2ff'),
  ice: c3('#8cc8ec'),
  iceD: c3('#3672a6'),
  iceDD: c3('#163860'),
  snow: c3('#cad8ee'),
  snowS: c3('#7088b2'),
  water: c3('#08203c'),
  waterL: c3('#4f8bbd'),
  foam: c3('#e8f6ff'),
  teal: c3('#7ae8f0'),
  tealD: c3('#15798a'),
  aur: c3('#3ef0b0'),
  aurL: c3('#9affd8'),
  aurD: c3('#16a07a'),
  fire: c3('#ff8a2a'),
  fireL: c3('#ffc65a'),
  fireW: c3('#fff3c4'),
  smoke: c3('#4a5468'),
  smokeL: c3('#8a96aa'),
  rock: c3('#3a4762'),
  rockL: c3('#7a88a8'),
  gold: c3('#ffe08a'),
  ink: c3('#0b1020'),
};

// ---------------------------------------------------------------------------
// Помощники.
// ---------------------------------------------------------------------------

function hash(a: number, b: number, s = 0): number {
  let h =
    (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const k01 = (v: number) => Math.max(0, Math.min(1, v));
const eOut = (k: number) => 1 - (1 - k01(k)) ** 3;
const eIn = (k: number) => k01(k) ** 2;
const seedOf = (z: { id: number }) => z.id >>> 0;

function dot(g: G, x: number, y: number, w: number, h: number, c: C3, a: number): void {
  if (a <= 0.01) return;
  g.fillStyle = rgba(c, a);
  g.fillRect(Math.round(x), Math.round(y), w, h);
}

/** Точки по окружности: кромка метки. */
function ringTicks(
  g: G,
  X: number,
  Y: number,
  R: number,
  c: C3,
  a: number,
  step = 4,
  seed = 0,
  keep = 1,
  ry = 1,
): void {
  if (R < 1 || a <= 0.01) return;
  const n = Math.max(10, Math.round((TAU * R) / step));
  g.fillStyle = rgba(c, a);
  for (let i = 0; i < n; i++) {
    if (keep < 1 && hash(seed, i, 7) > keep) continue;
    const t = (i / n) * TAU;
    g.fillRect(Math.round(X + Math.cos(t) * R), Math.round(Y + Math.sin(t) * R * ry), 2, 1);
  }
}

/** Трещина-луч: ломаная от точки. `len` в пикселях. */
function crackRay(
  g: G,
  X: number,
  Y: number,
  ang: number,
  len: number,
  seed: number,
  c: C3,
  a: number,
  shade = true,
): void {
  if (len < 1 || a <= 0.01) return;
  let x = X;
  let y = Y;
  let an = ang;
  for (let s = 0; s < len; s++) {
    x += Math.cos(an);
    y += Math.sin(an);
    an += (hash(seed, s, 11) - 0.5) * 0.55;
    if (shade) dot(g, x, y + 1, 1, 1, P.iceDD, a * 0.7);
    dot(g, x, y, 1, 1, c, a);
    // Короткая веточка.
    if (s > 3 && hash(seed, s, 12) < 0.07) {
      const b = an + (hash(seed, s, 13) < 0.5 ? 1 : -1) * 0.9;
      for (let q = 1; q < 4; q++)
        dot(g, x + Math.cos(b) * q, y + Math.sin(b) * q, 1, 1, c, a * 0.7);
    }
  }
}

interface Burst {
  n: number;
  seed: number;
  /** Направление и разброс; без разброса — во все стороны. */
  ang?: number;
  spread?: number;
  /** Скорость по полу, пикс/с. */
  v: [number, number];
  /** Подлёт вверх, пикс/с, и тяжесть. */
  up?: [number, number];
  grav?: number;
  life: [number, number];
  size?: [number, number];
  cols: C3[];
  /** Торможение (воздух, снег). */
  drag?: number;
  /** Старт с кольца, пикс. */
  r0?: number;
  /** Дым всплывает, пикс/с. */
  rise?: number;
  /** Задержка вылета частиц, с (размазать по времени). */
  delay?: number;
}

/** Частицы по баллистике: всё считается от возраста, без состояния. */
function burst(g: G, X: number, Y: number, age: number, b: Burst, alphaK = 1): void {
  for (let i = 0; i < b.n; i++) {
    const h1 = hash(b.seed, i, 1);
    const h2 = hash(b.seed, i, 2);
    const h3 = hash(b.seed, i, 3);
    const h4 = hash(b.seed, i, 4);
    const t = age - (b.delay ?? 0) * h4;
    const life = b.life[0] + (b.life[1] - b.life[0]) * h3;
    if (t < 0 || t > life) continue;
    const a = b.spread === undefined ? h1 * TAU : (b.ang ?? 0) + (h1 - 0.5) * b.spread;
    const v = b.v[0] + (b.v[1] - b.v[0]) * h2;
    const drag = b.drag ?? 0;
    const d = drag > 0 ? (v * (1 - Math.exp(-drag * t))) / drag : v * t;
    const r0 = (b.r0 ?? 0) * (0.55 + 0.45 * h4);
    const up = b.up ? b.up[0] + (b.up[1] - b.up[0]) * h2 : 0;
    const z = Math.max(0, up * t - 0.5 * (b.grav ?? 0) * t * t) + (b.rise ?? 0) * t;
    const x = X + Math.cos(a) * (r0 + d);
    const y = Y + Math.sin(a) * (r0 + d) * 0.7 - z;
    const sz = b.size ? Math.round(b.size[0] + (b.size[1] - b.size[0]) * h3) : 1;
    const fade = 1 - eIn(t / life);
    dot(g, x - sz / 2, y - sz / 2, sz, sz, b.cols[i % b.cols.length], fade * alphaK);
  }
}

/** Мягкое пятно света или тени. */
function glow(g: G, X: number, Y: number, R: number, c: C3, a: number, ry = 1, add = false): void {
  if (R < 1 || a <= 0.01) return;
  g.save();
  if (add) g.globalCompositeOperation = 'lighter';
  const gr = g.createRadialGradient(X, Y, 0, X, Y, R);
  gr.addColorStop(0, rgba(c, a));
  gr.addColorStop(1, rgba(c, 0));
  g.fillStyle = gr;
  g.translate(X, Y);
  g.scale(1, ry);
  g.beginPath();
  g.arc(0, 0, R, 0, TAU);
  g.fill();
  g.restore();
}

/** Окно вида зоны в игровых пикселях (как у слоёв этажа). */
function viewOf(g: G, z: Zone | Strike, px: number, py: number) {
  const m = g.getTransform();
  const s = m.a || 1;
  return {
    left: z.x * TS - px,
    top: z.y * TS - py,
    gw: g.canvas.width / s,
    gh: g.canvas.height / s,
  };
}

/** Прямая до стены, клеток (как `clearDist` мозга). */
function rayLen(sim: Sim, x: number, y: number, ang: number, max: number): number {
  const w = sim.world;
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  for (let d = 0.2; d <= max; d += 0.2) {
    const cx = Math.floor(x + ux * d);
    const cy = Math.floor(y + uy * d);
    if (cx < 0 || cy < 0 || cx >= w.w || cy >= w.h) return d;
    const t = sim.tiles[cy * w.w + cx];
    if (t === 1 || t === 0) return d;
  }
  return max;
}

// ---------------------------------------------------------------------------
// Метки: красное ядро движка с ледяной кромкой. `k` — налив 0…1.
// ---------------------------------------------------------------------------

/** Мигание в последние 15% налива. */
const blink = (k: number, time: number) => k > 0.85 && Math.sin(time * 40) > 0;

function markCircle(
  g: G,
  X: number,
  Y: number,
  R: number,
  k: number,
  time: number,
  seed: number,
): void {
  g.fillStyle = rgba(P.danger, 0.07 + 0.05 * k);
  g.beginPath();
  g.arc(X, Y, R, 0, TAU);
  g.fill();
  g.fillStyle = rgba(P.danger, 0.12 + 0.24 * k);
  g.beginPath();
  g.arc(X, Y, Math.max(0, R * eOut(k)), 0, TAU);
  g.fill();
  const edge = blink(k, time) ? P.white : P.frost;
  ringTicks(g, X, Y, R, edge, 0.5 + 0.45 * k, 3);
  // Иней ползёт от кромки внутрь шестью иглами.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + hash(seed, i, 21) * 0.5;
    const L = R * 0.35 * k;
    for (let q = 0; q < L; q++)
      dot(g, X + Math.cos(a) * (R - q), Y + Math.sin(a) * (R - q), 1, 1, P.frost, 0.55 * k);
  }
}

function markRing(g: G, X: number, Y: number, R: number, w: number, k: number, time: number): void {
  g.strokeStyle = rgba(P.danger, 0.14 + 0.3 * k);
  g.lineWidth = w * 2;
  g.beginPath();
  g.arc(X, Y, R, 0, TAU);
  g.stroke();
  const edge = blink(k, time) ? P.white : P.frost;
  ringTicks(g, X, Y, R + w, edge, 0.45 + 0.4 * k, 3);
  ringTicks(g, X, Y, Math.max(1, R - w), edge, 0.3 + 0.4 * k, 4);
}

function markLine(
  g: G,
  X: number,
  Y: number,
  ang: number,
  L: number,
  hw: number,
  k: number,
  time: number,
  a = 1,
): void {
  g.save();
  g.translate(X, Y);
  g.rotate(ang);
  g.fillStyle = rgba(P.danger, (0.08 + 0.06 * k) * a);
  g.fillRect(0, -hw, L, hw * 2);
  g.fillStyle = rgba(P.danger, (0.12 + 0.24 * k) * a);
  g.fillRect(0, -hw, L * eOut(k), hw * 2);
  const edge = blink(k, time) ? P.white : P.frost;
  g.fillStyle = rgba(edge, (0.45 + 0.45 * k) * a);
  for (let x = 0; x < L; x += 3) {
    g.fillRect(x, -hw, 2, 1);
    g.fillRect(x, hw - 1, 2, 1);
  }
  // Шевроны бегут по ходу удара.
  const off = (time * (20 + 40 * k)) % 12;
  g.fillStyle = rgba(P.frost, (0.25 + 0.5 * k) * a);
  const ch = Math.min(4, hw * 0.7);
  for (let x = off; x < L - 3; x += 12)
    for (let q = 0; q <= ch; q++) {
      g.fillRect(Math.round(x - q * 0.7), Math.round(-q), 1, 1);
      g.fillRect(Math.round(x - q * 0.7), Math.round(q), 1, 1);
    }
  g.restore();
}

function markCone(
  g: G,
  X: number,
  Y: number,
  ang: number,
  R: number,
  arc: number,
  k: number,
  time: number,
): void {
  const h = arc / 2;
  g.fillStyle = rgba(P.danger, 0.07 + 0.05 * k);
  g.beginPath();
  g.moveTo(X, Y);
  g.arc(X, Y, R, ang - h, ang + h);
  g.closePath();
  g.fill();
  g.fillStyle = rgba(P.danger, 0.14 + 0.24 * k);
  g.beginPath();
  g.moveTo(X, Y);
  g.arc(X, Y, Math.max(0, R * eOut(k)), ang - h, ang + h);
  g.closePath();
  g.fill();
  const edge = blink(k, time) ? P.white : P.frost;
  const n = Math.max(6, Math.round((arc * R) / 3));
  g.fillStyle = rgba(edge, 0.5 + 0.45 * k);
  for (let i = 0; i <= n; i++) {
    const a = ang - h + (arc * i) / n;
    g.fillRect(Math.round(X + Math.cos(a) * R), Math.round(Y + Math.sin(a) * R), 2, 1);
  }
  for (const s of [-1, 1]) {
    const a = ang + s * h;
    for (let q = 4; q < R; q += 3)
      g.fillRect(Math.round(X + Math.cos(a) * q), Math.round(Y + Math.sin(a) * q), 1, 1);
  }
}

/** Метки обычных мобов этажа (`m.tele`). */
function mobMarks(g: G, sim: Sim, left: number, top: number, time: number): void {
  for (const m of sim.mobs) {
    const t = m.tele;
    if (!t || !m.data.vNoTele || m.kind === 'f12boss' || !m.kind.startsWith('f12')) continue;
    const X = (t.x ?? m.x) * TS - left;
    const Y = (t.y ?? m.y) * TS - top;
    const R = t.r * TS;
    const k = k01(t.k);
    switch (t.shape) {
      case 'circle':
        markCircle(g, X, Y, R, k, time, m.id);
        break;
      case 'ring':
        markRing(g, X, Y, R, (t.w ?? 0.6) * TS, k, time);
        break;
      case 'line':
        markLine(g, X, Y, t.ang ?? 0, R, (t.w ?? 0.5) * TS, k, time);
        break;
      case 'cone':
        markCone(g, X, Y, t.ang ?? 0, R, t.arc ?? 1, k, time);
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// Метки мамонта: бивни, топот, набег (с местом, где он врежется), шипы,
// дыбы. Слабое место — треснувший бивень — подсвечено в оглушении.
// ---------------------------------------------------------------------------

function mammothMarks(g: G, sim: Sim, left: number, top: number, time: number): void {
  const m = f12Mammoth(sim);
  if (!m || m.mode === 'dying') return;
  const T = MAMMOTH;
  const X = m.x * TS - left;
  const Y = m.y * TS - top;
  switch (m.mode) {
    case 'f12b_tusk': {
      if (m.t >= T.tusk.hit) return;
      const k = m.t / T.tusk.hit;
      markCone(g, X, Y, m.face, T.tusk.r * TS + 4, T.tusk.arc, k, time);
      // Бивни: два серпа идут снизу вверх по конусу в такт замаху.
      const sw = eIn(k);
      for (const s of [-1, 1]) {
        const a = m.face + s * (T.tusk.arc / 2) * (1 - sw);
        for (let q = m.r * TS; q < T.tusk.r * TS; q += 2)
          dot(g, X + Math.cos(a) * q, Y + Math.sin(a) * q, 1, 1, P.white, 0.25 + 0.6 * k);
      }
      return;
    }
    case 'f12b_stomp': {
      if (m.t >= T.stomp.hit) return;
      const k = m.t / T.stomp.hit;
      const R = T.stomp.r * TS;
      markCircle(g, X, Y, R, k, time, m.id + 3);
      for (let i = 0; i < 9; i++)
        crackRay(
          g,
          X,
          Y,
          (i / 9) * TAU + hash(m.id, i, 31),
          R * 0.9 * eOut(k),
          m.id * 9 + i,
          P.frost,
          0.6 * k,
        );
      return;
    }
    case 'f12b_paw':
    case 'f12b_charge': {
      const paw = m.mode === 'f12b_paw';
      const L = (paw ? (m.data.len ?? 14) : 4.5) * TS;
      const k = paw ? k01(m.data.k ?? 0) : 1;
      const hw = (m.r + 0.3) * TS;
      markLine(g, X, Y, m.face, L, hw, k, time, paw ? 1 : 0.45);
      if (paw && (m.data.len ?? 14) < 13.9) {
        // Здесь он врежется: звезда трещин на стене — сюда и заманивай.
        const ex = X + Math.cos(m.face) * L;
        const ey = Y + Math.sin(m.face) * L;
        const pulse = 0.55 + 0.45 * Math.sin(time * 9);
        for (let i = 0; i < 7; i++)
          crackRay(
            g,
            ex,
            ey,
            (i / 7) * TAU,
            7 + 5 * k,
            m.id * 13 + i,
            P.teal,
            (0.4 + 0.5 * k) * pulse,
            false,
          );
        ringTicks(g, ex, ey, 6 + 4 * pulse, P.teal, 0.7 * k, 3);
      }
      return;
    }
    case 'f12b_spikes': {
      if (m.t >= T.spikes.hit) return;
      const k = m.t / T.spikes.hit;
      for (const off of [-0.38, 0, 0.38]) {
        const ang = m.face + off;
        const x = m.x + Math.cos(ang) * (m.r + 0.4);
        const y = m.y + Math.sin(ang) * (m.r + 0.4);
        const L = Math.min(T.spikes.len, rayLen(sim, x, y, ang, T.spikes.len)) * TS;
        markLine(g, x * TS - left, y * TS - top, ang, L, 0.9 * TS, k, time, 0.55);
      }
      return;
    }
    case 'f12b_rear': {
      if (m.t >= 0.9) return;
      const k = m.t / 0.9;
      // Не урон — отброс: белое кольцо снега, без красного.
      ringTicks(g, X, Y, 3.6 * TS, P.frost, 0.35 + 0.5 * k, 3);
      ringTicks(g, X, Y, 3.6 * TS * eOut(k), P.white, 0.4 * k, 5);
      return;
    }
  }
}

F12_FLOOR_HOOKS.push(mobMarks, mammothMarks);

/** Слабое место над темнотой: скобы прицела у треснувшего бивня. */
F12_SKY_HOOKS.push((g, sim, left, top, time) => {
  const m = f12Mammoth(sim);
  if (!m || m.mode !== 'f12b_stunned') return;
  const hx = (m.x + Math.cos(m.face) * m.r * 1.05) * TS - left;
  const hy = (m.y + Math.sin(m.face) * m.r * 0.8) * TS - top - 14;
  const p = 0.5 + 0.5 * Math.sin(time * 8);
  const d = 9 + 3 * p;
  glow(g, hx, hy, 14, P.teal, 0.25 + 0.2 * p, 1, true);
  g.fillStyle = rgba(P.teal, 0.65 + 0.35 * p);
  for (const [sx, sy] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    const cx = Math.round(hx + sx * d);
    const cy = Math.round(hy + sy * d);
    g.fillRect(cx - (sx > 0 ? 3 : 0), cy, 4, 1);
    g.fillRect(cx, cy - (sy > 0 ? 3 : 0), 1, 4);
  }
});

// ---------------------------------------------------------------------------
// Удары по площади: метка до `warn`, контакт — `registerImpactPainter`.
// ---------------------------------------------------------------------------

/** Сосулька со свода: тень растёт и темнеет, кромка индевеет. */
registerZonePainter('f12_iciclefall', (g, st, px, py, _s, time) => {
  const s = st as Strike;
  const k = k01(s.t / Math.max(0.05, s.warn));
  const R = s.r * TS;
  glow(g, px, py, R * (1.5 - 0.5 * k), P.ink, 0.25 + 0.45 * k, 0.6);
  markCircle(g, px, py, R, k, time, s.id);
  // Перекрестье точки падения.
  dot(g, px - 2, py, 5, 1, P.frost, 0.4 + 0.5 * k);
  dot(g, px, py - 2, 1, 5, P.frost, 0.4 + 0.5 * k);
  return true;
});

registerImpactPainter('f12_iciclefall', {
  life: 1.1,
  shake: 0.16,
  paint(g, rec, px, py, _s, age) {
    const R = (rec.r ?? 1) * TS;
    const sd = rec.seed >>> 0;
    const fade = 1 - k01((age - 0.6) / 0.5);
    for (let i = 0; i < 6; i++)
      crackRay(
        g,
        px,
        py,
        (i / 6) * TAU + hash(sd, i, 1),
        R * eOut(age / 0.12),
        sd + i,
        P.frost,
        0.7 * fade,
      );
    if (age < 0.25)
      ringTicks(g, px, py, R * (0.4 + 0.9 * eOut(age / 0.25)), P.white, 1 - age / 0.25, 2);
    burst(g, px, py, age, {
      n: 18,
      seed: sd,
      v: [30, 80],
      up: [30, 80],
      grav: 260,
      life: [0.45, 0.8],
      size: [1, 2],
      cols: [P.white, P.ice, P.frost, P.iceD],
    });
    burst(
      g,
      px,
      py,
      age,
      {
        n: 10,
        seed: sd + 7,
        v: [10, 26],
        drag: 3,
        rise: 6,
        life: [0.5, 0.9],
        size: [2, 3],
        cols: [P.snow, P.frost],
      },
      0.6,
    );
    return age < 1.1;
  },
});

/** Сосулька летит со свода к тени (стоит над темнотой). */
const ICDROP: HTMLCanvasElement[] = [];
function icicleCv(v: number): HTMLCanvasElement {
  if (ICDROP[v]) return ICDROP[v];
  const W = 9;
  const H = 24;
  const p = new Px(W, H);
  for (let y = 0; y < H; y++) {
    const half = 4 * (1 - y / H) ** 0.8 + (y < 3 ? 0.5 : 0);
    for (let x = 0; x < W; x++) {
      const d = x - 4 + (v ? 0.4 : -0.2);
      if (Math.abs(d) > half) continue;
      const k = d < -half * 0.3 ? 4 : d < half * 0.3 ? 3 : 2;
      const col = [P.iceDD, P.iceD, P.ice, P.frost, P.white][k - (y > H * 0.7 ? 1 : 0)];
      p.set(x, y, [col[0], col[1], col[2], 255]);
    }
  }
  p.outline([10, 24, 48, 230]);
  ICDROP[v] = p.canvas();
  return ICDROP[v];
}

registerZonePainter('f12_icdrop', (g, z, px, py) => {
  const zz = z as Zone;
  const k = k01(zz.t / Math.max(0.05, zz.life));
  if (k >= 0.98) return true;
  const fall = eIn(k);
  const cv = icicleCv(seedOf(zz) & 1);
  const off = (1 - fall) * 150;
  const x = Math.round(px - cv.width / 2);
  const y = Math.round(py - cv.height - off);
  // Шлейф падения.
  if (k > 0.35)
    for (let q = 1; q < 5; q++) dot(g, px - 1, y - q * 5, 2, 4, P.frost, 0.18 * (5 - q) * k);
  g.drawImage(cv, x, y);
  return true;
});

/** Вода из-под льдины: тёмный круг, рябь сходится, пузыри. */
registerZonePainter('f12_surge', (g, st, px, py, _s, time) => {
  const s = st as Strike;
  const k = k01(s.t / Math.max(0.05, s.warn));
  const R = s.r * TS;
  glow(g, px, py, R * 1.2, P.water, 0.55 + 0.3 * k);
  markCircle(g, px, py, R, k, time, s.id);
  for (let i = 0; i < 3; i++) {
    const r = R * (1 - ((time * 0.9 + i / 3) % 1));
    ringTicks(g, px, py, r, P.waterL, 0.5 * k, 3, s.id + i, 0.8);
  }
  const sd = s.id >>> 0;
  for (let i = 0; i < 6; i++) {
    const ph = (time * (1.4 + hash(sd, i, 2)) + hash(sd, i, 3)) % 1;
    const a = hash(sd, i, 4) * TAU;
    const r = hash(sd, i, 5) * R * 0.7;
    dot(g, px + Math.cos(a) * r, py + Math.sin(a) * r - ph * 3, 1, 1, P.foam, k * (1 - ph));
  }
  return true;
});

registerImpactPainter('f12_surge', {
  life: 1,
  shake: 0.14,
  paint(g, rec, px, py, _s, age) {
    const R = (rec.r ?? 1.2) * TS;
    const sd = rec.seed >>> 0;
    if (age < 0.5)
      ringTicks(g, px, py, R * (0.5 + eOut(age / 0.5)), P.foam, 1 - age / 0.5, 2, sd, 0.9);
    // Столб воды: брызги вверх и обратно.
    burst(g, px, py, age, {
      n: 26,
      seed: sd,
      v: [6, 34],
      up: [70, 140],
      grav: 330,
      life: [0.6, 0.95],
      size: [1, 2],
      cols: [P.foam, P.waterL, P.white, P.ice],
    });
    glow(g, px, py, R, P.foam, 0.35 * (1 - k01(age / 0.4)), 0.7);
    return age < 1;
  },
});

/** Вал вьюги: вдоль линии наметает сугробы — вырастают к удару. */
registerZonePainter('f12_snowwall', (g, st, px, py, _s, time) => {
  const s = st as Strike;
  const k = k01(s.t / Math.max(0.05, s.warn));
  const L = s.r * TS;
  const hw = (s.w ?? 1) * TS;
  markLine(g, px, py, s.ang ?? 0, L, hw, k, time, 0.8);
  const ux = Math.cos(s.ang ?? 0);
  const uy = Math.sin(s.ang ?? 0);
  const sd = s.id >>> 0;
  // Сплошной вал: гребень по шуму, светлый верх, голубая тень снизу.
  const grow = eOut(k);
  const hAt = (x: number) =>
    (3 + 3.5 * Math.sin(x * 0.11 + hash(sd, 1, 1) * 6) + 2.5 * Math.sin(x * 0.29 + sd)) * grow + 1;
  for (let x = 0; x < L; x++) {
    const h = Math.max(1, hAt(x));
    const cx = Math.round(px + ux * x);
    const cy = Math.round(py + uy * x + 3);
    const top = Math.round(cy - h);
    g.fillStyle = rgba(P.snowS, 0.9);
    g.fillRect(cx, Math.round(cy - h * 0.45), 1, Math.max(1, Math.round(h * 0.45) + 1));
    g.fillStyle = rgba(P.snow, 0.95);
    g.fillRect(cx, top, 1, Math.max(1, Math.round(h * 0.55)));
    if (hAt(x - 1) < h) dot(g, cx, top, 1, 1, P.white, 0.95);
  }
  // Позёмка срывается с гребня.
  for (let x = 6; x < L; x += 9) {
    const ph = (time * 2 + hash(sd, x, 2)) % 1;
    const h = hAt(x);
    dot(g, px + ux * x + ph * 10, py + uy * x + 3 - h - ph * 4, 2, 1, P.white, 0.6 * k * (1 - ph));
  }
  return true;
});

registerImpactPainter('f12_snowwall', {
  life: 0.9,
  shake: 0.12,
  paint(g, rec, px, py, _s, age) {
    const L = (rec.r ?? 4) * TS;
    const ang = rec.ang ?? 0;
    const sd = rec.seed >>> 0;
    const n = Math.max(2, Math.round(L / 10));
    for (let i = 0; i < n; i++) {
      const x = px + Math.cos(ang) * ((i + 0.5) * (L / n));
      const y = py + Math.sin(ang) * ((i + 0.5) * (L / n));
      burst(g, x, y, age, {
        n: 7,
        seed: sd + i * 17,
        v: [12, 40],
        up: [30, 70],
        grav: 160,
        drag: 2,
        life: [0.45, 0.85],
        size: [2, 4],
        cols: [P.white, P.snow, P.frost],
      });
    }
    // Белая волна вдоль вала.
    if (age < 0.3) {
      g.save();
      g.translate(px, py);
      g.rotate(ang);
      g.fillStyle = rgba(P.white, 0.55 * (1 - age / 0.3));
      const hw = (rec.w ?? 1) * TS * (1 + age * 2);
      g.fillRect(0, -hw, L, hw * 2);
      g.restore();
    }
    return age < 0.9;
  },
});

/** Шипы мамонта: трещина бежит по линии, под ней светится лёд. */
registerZonePainter('f12_spikes', (g, st, px, py, _s, time) => {
  const s = st as Strike;
  const k = k01(s.t / Math.max(0.05, s.warn));
  const L = s.r * TS;
  const ang = s.ang ?? 0;
  markLine(g, px, py, ang, L, (s.w ?? 0.9) * TS, k, time);
  crackRay(g, px, py, ang, L * eOut(k * 1.25), s.id >>> 0, P.white, 0.9);
  // Голубой свет под фронтом трещины.
  const f = L * eOut(k * 1.25);
  glow(g, px + Math.cos(ang) * f, py + Math.sin(ang) * f, 9, P.teal, 0.5 * k, 1, true);
  return true;
});

registerImpactPainter('f12_spikes', {
  life: 1.05,
  shake: 0.2,
  flash: 0.15,
  flashRgb: '190,235,255',
  paint(g, rec, px, py, _s, age) {
    const L = (rec.r ?? 6) * TS;
    const ang = rec.ang ?? 0;
    const sd = rec.seed >>> 0;
    const ux = Math.cos(ang);
    const uy = Math.sin(ang);
    const n = Math.max(3, Math.round(L / 7));
    for (let i = 0; i < n; i++) {
      // Шипы встают волной от мамонта, стоят и крошатся.
      const t0 = (i / n) * 0.12;
      const t = age - t0;
      if (t < 0) continue;
      const up = eOut(t / 0.07);
      const gone = k01((t - 0.45) / 0.25);
      const hgt = (10 + 9 * hash(sd, i, 1)) * up * (1 - gone);
      const side = (hash(sd, i, 2) - 0.5) * 8;
      const x = px + ux * (i + 0.5) * (L / n) - uy * side;
      const y = py + uy * (i + 0.5) * (L / n) + ux * side * 0.6;
      if (hgt > 0.5) {
        const w = 3 + Math.round(hash(sd, i, 3) * 2);
        const tilt = (hash(sd, i, 4) - 0.5) * 4;
        g.fillStyle = rgba(P.iceD, 0.95);
        g.beginPath();
        g.moveTo(x - w, y);
        g.lineTo(x + w, y);
        g.lineTo(x + tilt, y - hgt);
        g.closePath();
        g.fill();
        g.fillStyle = rgba(P.ice, 0.95);
        g.beginPath();
        g.moveTo(x - w, y);
        g.lineTo(x, y);
        g.lineTo(x + tilt, y - hgt);
        g.closePath();
        g.fill();
        dot(g, x + tilt - 1, y - hgt, 1, Math.max(1, Math.round(hgt * 0.4)), P.white, 0.9);
      }
      if (gone > 0)
        burst(g, x, y - 6, t - 0.45, {
          n: 4,
          seed: sd + i * 5,
          v: [14, 36],
          up: [20, 50],
          grav: 220,
          life: [0.3, 0.5],
          size: [1, 2],
          cols: [P.white, P.ice],
        });
    }
    return age < 1.05;
  },
});

/** Завеса сияния (хранитель, шаманка): лента света наливается по линии. */
registerZonePainter('f12_curtain', (g, st, px, py, _s, time) => {
  const s = st as Strike;
  const k = k01(s.t / Math.max(0.05, s.warn));
  const L = s.r * TS;
  const ang = s.ang ?? 0;
  const hw = (s.w ?? 0.8) * TS;
  markLine(g, px, py, ang, L, hw, k, time, 0.7);
  g.save();
  g.globalCompositeOperation = 'lighter';
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  for (let x = 0; x < L; x += 3) {
    const wv = Math.sin(time * 4 + x * 0.25) * 0.5 + 0.5;
    const hgt = (6 + 10 * wv) * k;
    const cx = px + ux * x;
    const cy = py + uy * x;
    const lg = g.createLinearGradient(0, cy - hgt, 0, cy);
    lg.addColorStop(0, rgba(P.aurL, 0));
    lg.addColorStop(1, rgba(P.aur, 0.2 * k));
    g.fillStyle = lg;
    g.fillRect(Math.round(cx), Math.round(cy - hgt), 2, Math.round(hgt));
  }
  g.restore();
  return true;
});

registerImpactPainter('f12_curtain', {
  life: 0.8,
  shake: 0.1,
  above: true,
  paint(g, rec, px, py, _s, age) {
    const L = (rec.r ?? 4) * TS;
    const ang = rec.ang ?? 0;
    const sd = rec.seed >>> 0;
    const ux = Math.cos(ang);
    const uy = Math.sin(ang);
    const fade = 1 - eIn(age / 0.8);
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (let x = 0; x < L; x += 2) {
      const hgt = 30 * (1 - age / 0.8) + 6;
      const cx = px + ux * x;
      const cy = py + uy * x;
      const lg = g.createLinearGradient(0, cy - hgt, 0, cy);
      lg.addColorStop(0, rgba(P.aurL, 0));
      lg.addColorStop(0.7, rgba(P.aurL, 0.32 * fade));
      lg.addColorStop(1, rgba(P.white, 0.45 * fade));
      g.fillStyle = lg;
      g.fillRect(Math.round(cx), Math.round(cy - hgt), 2, Math.round(hgt));
    }
    g.restore();
    for (let i = 0; i < 4; i++) {
      const x = px + ux * L * ((i + 0.5) / 4);
      const y = py + uy * L * ((i + 0.5) / 4);
      burst(g, x, y, age, {
        n: 5,
        seed: sd + i * 3,
        v: [4, 14],
        rise: 26,
        life: [0.4, 0.8],
        cols: [P.aurL, P.white, P.teal],
      });
    }
    return age < 0.8;
  },
});

/** Убийство окружением: без метки и без общего взрыва. */
registerZonePainter('f12_none', () => true);
registerImpactPainter('f12_none', { life: 0.01, shake: 0, paint: () => false });

// ---------------------------------------------------------------------------
// Игла ежа.
// ---------------------------------------------------------------------------

const QUILL = new Map<number, Sprite>();
registerShotPainter('f12_quill', (s) => {
  const a = Math.atan2(s.vy, s.vx);
  const q = ((Math.round((a / TAU) * 16) % 16) + 16) % 16;
  const hit = QUILL.get(q);
  if (hit) return hit;
  const p = new Px(13, 13);
  const dx = Math.cos((q * TAU) / 16);
  const dy = Math.sin((q * TAU) / 16);
  for (let k = -5; k <= 4; k++) {
    const col: [number, number, number, number] =
      k >= 3
        ? [255, 255, 255, 255]
        : k >= 0
          ? [160, 208, 238, 255]
          : k >= -3
            ? [92, 156, 203, 230]
            : [54, 114, 166, 150];
    p.set(6 + dx * k, 6 + dy * k, col);
  }
  p.outline([10, 24, 48, 200]);
  const spr: Sprite = { img: p.canvas(), ax: 6, ay: 6 };
  QUILL.set(q, spr);
  return spr;
});

registerImpactPainter('f12_quill', {
  life: 0.4,
  shake: 0.02,
  paint(g, rec, px, py, _s, age) {
    const sd = rec.seed >>> 0;
    const back = Math.atan2(-(rec.vy ?? 0), -(rec.vx ?? 1));
    burst(g, px, py, age, {
      n: 6,
      seed: sd,
      ang: back,
      spread: 2.2,
      v: [20, 50],
      up: [10, 30],
      grav: 200,
      life: [0.2, 0.4],
      cols: [P.white, P.ice],
    });
    return age < 0.4;
  },
});

// ---------------------------------------------------------------------------
// Зоны-картинки (`api.vfx`): t — возраст, life — длина.
// ---------------------------------------------------------------------------

type ZoneFx = (g: G, z: Zone, X: number, Y: number, k: number, age: number, time: number) => void;
function zoneFx(art: string, f: ZoneFx): void {
  registerZonePainter(art, (g, z, px, py, _s, time) => {
    const zz = z as Zone;
    const life = Math.max(0.05, zz.life);
    if (zz.t > life) return true;
    f(g, zz, px, py, k01(zz.t / life), zz.t, time);
    return true;
  });
}

/** Жаровня или факел вспыхнули: тёплый круг и искры вверх. */
zoneFx('f12_ignite', (g, z, X, Y, k, age) => {
  const R = z.r * TS;
  glow(g, X, Y - 4, R * (0.6 + 0.6 * eOut(k)), P.fire, 0.55 * (1 - k), 0.7, true);
  ringTicks(g, X, Y, R * eOut(k / 0.6), P.fireL, 0.8 * (1 - k), 3, seedOf(z), 0.7, 0.7);
  burst(g, X, Y - 6, age, {
    n: 16,
    seed: seedOf(z),
    v: [6, 24],
    rise: 34,
    drag: 2,
    life: [0.4, 0.85],
    cols: [P.fireW, P.fireL, P.fire],
  });
});

/** Огонь задули: дым клубами вверх. */
zoneFx('f12_smoke', (g, z, X, Y, _k, age) => {
  burst(
    g,
    X,
    Y - 8,
    age,
    {
      n: 12,
      seed: seedOf(z),
      v: [3, 12],
      rise: 20,
      drag: 1.5,
      life: [0.6, 1.2],
      size: [2, 4],
      cols: [P.smokeL, P.smoke, P.snowS],
      delay: 0.3,
    },
    0.7,
  );
});

/** Всплеск: брызги, кольцо ряби, пена. */
zoneFx('f12_splash', (g, z, X, Y, k, age) => {
  const R = z.r * TS;
  const sd = seedOf(z);
  ringTicks(g, X, Y, R * (0.3 + 0.8 * eOut(k)), P.foam, 0.8 * (1 - k), 2, sd, 0.85, 0.7);
  ringTicks(g, X, Y, R * 0.6 * eOut(k * 1.4), P.waterL, 0.6 * (1 - k), 3, sd + 1, 0.85, 0.7);
  burst(g, X, Y, age, {
    n: 18,
    seed: sd,
    v: [10, 36],
    up: [50, 110],
    grav: 300,
    life: [0.5, 0.8],
    size: [1, 2],
    cols: [P.foam, P.waterL, P.white],
  });
});

/** Лёд разбит: осколки веером, иней кольцом. */
zoneFx('f12_shatter', (g, z, X, Y, k, age) => {
  const R = z.r * TS;
  const sd = seedOf(z);
  if (age < 0.15) glow(g, X, Y - 8, R, P.white, 0.7 * (1 - age / 0.15), 1, true);
  ringTicks(g, X, Y, R * eOut(k * 1.6), P.frost, 0.7 * (1 - k), 2, sd, 0.6, 0.7);
  burst(g, X, Y - 8, age, {
    n: 22,
    seed: sd,
    v: [30, 90],
    up: [20, 80],
    grav: 280,
    life: [0.35, z.life],
    size: [1, 3],
    cols: [P.white, P.ice, P.frost, P.iceD],
  });
});

/** Герой замёрз: иглы инея сходятся к нему (глыбу рисует слой неба). */
zoneFx('f12_iceblock', (g, z, X, Y, _k, age) => {
  if (age > 0.35) return;
  const q = age / 0.35;
  const sd = seedOf(z);
  for (let i = 0; i < 10; i++) {
    const a = hash(sd, i, 1) * TAU;
    const r = (26 + 10 * hash(sd, i, 2)) * (1 - eOut(q));
    const x = X + Math.cos(a) * r;
    const y = Y - 10 + Math.sin(a) * r * 0.8;
    dot(g, x, y, 2, 1, P.white, 1 - q * 0.6);
    dot(g, x - Math.cos(a) * 3, y - Math.sin(a) * 2, 1, 1, P.ice, 0.7 * (1 - q));
  }
});

/** Пар из проталины или источника. */
zoneFx('f12_steampuff', (g, z, X, Y, _k, age) => {
  burst(
    g,
    X,
    Y - 4,
    age,
    {
      n: 9,
      seed: seedOf(z),
      v: [2, 8],
      rise: 18,
      life: [0.6, 1.2],
      size: [2, 4],
      cols: [P.white, P.frost, P.snow],
      delay: 0.4,
    },
    0.55,
  );
});

/** Гонг: золотые кольца бегут по залу, звери слепнут. Над темнотой. */
zoneFx('f12_gongwave', (g, z, X, Y, k, age) => {
  const R = z.r * TS;
  if (age < 0.2) glow(g, X, Y - 10, 40, P.gold, 0.8 * (1 - age / 0.2), 1, true);
  for (let i = 0; i < 3; i++) {
    const q = k01((age - i * 0.18) / 1.0);
    if (q <= 0 || q >= 1) continue;
    ringTicks(
      g,
      X,
      Y,
      R * eOut(q),
      i ? P.gold : P.white,
      0.75 * (1 - q),
      2,
      seedOf(z) + i,
      0.9,
      0.75,
    );
  }
});

/** Удар по ледяному затвору: искры льда и стружка. */
zoneFx('f12_gatehit', (g, z, X, Y, _k, age) => {
  if (age < 0.08) glow(g, X, Y - 6, 12, P.white, 0.8, 1, true);
  burst(g, X, Y - 8, age, {
    n: 12,
    seed: seedOf(z),
    v: [30, 70],
    up: [20, 60],
    grav: 260,
    life: [0.3, 0.6],
    cols: [P.white, P.ice, P.frost],
  });
});

/** Морозный выдох: облачко инея и кристаллы наружу. */
zoneFx('f12_frostburst', (g, z, X, Y, k, age) => {
  const R = z.r * TS;
  const sd = seedOf(z);
  glow(g, X, Y - 4, R * (0.5 + 0.8 * eOut(k)), P.ice, 0.45 * (1 - k), 0.8, true);
  ringTicks(g, X, Y, R * eOut(k * 1.3), P.frost, 0.7 * (1 - k), 3, sd, 0.7, 0.75);
  burst(g, X, Y - 4, age, {
    n: 16,
    seed: sd,
    v: [20, 46],
    drag: 2.5,
    life: [0.35, z.life],
    size: [1, 2],
    cols: [P.white, P.frost, P.teal],
  });
});

/** Топот: волна по льду, снежная пыль, трещины лучами. */
zoneFx('f12_stompring', (g, z, X, Y, k, age) => {
  const R = z.r * TS;
  const sd = seedOf(z);
  const fade = 1 - eIn(k);
  for (let i = 0; i < 8; i++)
    crackRay(
      g,
      X,
      Y,
      (i / 8) * TAU + hash(sd, i, 1) * 0.6,
      R * 0.85 * eOut(age / 0.15),
      sd + i,
      P.frost,
      0.65 * fade,
    );
  if (age < 0.35) {
    const q = age / 0.35;
    ringTicks(g, X, Y, R * (0.3 + 0.75 * eOut(q)), P.white, 1 - q, 2, sd, 0.9);
    ringTicks(g, X, Y, R * (0.2 + 0.7 * eOut(q)), P.snow, 0.6 * (1 - q), 3, sd + 3, 0.7);
  }
  burst(
    g,
    X,
    Y,
    age,
    {
      n: 24,
      seed: sd + 5,
      v: [R * 1.2, R * 2.4],
      r0: R * 0.3,
      up: [10, 30],
      grav: 90,
      drag: 3,
      life: [0.45, z.life],
      size: [2, 3],
      cols: [P.snow, P.white, P.snowS],
    },
    0.75,
  );
});

/** Снежный клуб: песец нырнул или вынырнул, удар в сугроб. */
zoneFx('f12_snowburst', (g, z, X, Y, _k, age) => {
  const sd = seedOf(z);
  burst(g, X, Y - 2, age, {
    n: 18,
    seed: sd,
    v: [14, 40],
    up: [30, 70],
    grav: 200,
    drag: 2,
    life: [0.35, z.life],
    size: [2, 3],
    cols: [P.white, P.snow, P.snowS],
  });
});

/** Дыхание духа: струя инея по конусу (dur — угол). */
zoneFx('f12_breath', (g, z, X, Y, k, age) => {
  const ang = z.dur ?? 0;
  const R = z.r * TS;
  const h = SPIRIT.arc / 2;
  const sd = seedOf(z);
  g.fillStyle = rgba(P.frost, 0.22 * (1 - k));
  g.beginPath();
  g.moveTo(X, Y);
  g.arc(X, Y, R * eOut(k * 2), ang - h, ang + h);
  g.closePath();
  g.fill();
  for (let i = 0; i < 26; i++) {
    const a = ang + (hash(sd, i, 1) - 0.5) * 2 * h;
    const r = R * k01(age * (2.2 + hash(sd, i, 2)) - hash(sd, i, 3) * 0.3);
    if (r <= 0) continue;
    dot(
      g,
      X + Math.cos(a) * r,
      Y + Math.sin(a) * r - 6,
      i % 3 ? 1 : 2,
      1,
      i % 2 ? P.white : P.teal,
      0.85 * (1 - k),
    );
  }
});

/** Вспышка сияния: ленты вьются вверх, лучи. Над темнотой. */
zoneFx('f12_auroraburst', (g, z, X, Y, k, age) => {
  const R = z.r * TS;
  const sd = seedOf(z);
  glow(g, X, Y - 10, R * (0.8 + 0.6 * eOut(k)), P.aur, 0.5 * (1 - k), 1, true);
  g.save();
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 5; i++) {
    const a0 = (i / 5) * TAU + hash(sd, i, 1);
    for (let s = 0; s < 18; s++) {
      const q = s / 18;
      const a = a0 + q * 2.4 + age * 2;
      const r = R * 0.3 + q * R * 0.6;
      const y = Y - 6 - q * 34 * eOut(k * 2) - age * 10;
      const x = X + Math.cos(a) * r * 0.6;
      g.fillStyle = rgba(s % 4 ? P.aur : P.aurL, 0.6 * (1 - k) * (1 - q * 0.5));
      g.fillRect(Math.round(x), Math.round(y + Math.sin(a) * 3), 2, 2);
    }
  }
  g.restore();
});

/** Мамонт врезался в стену: глыбы и щебень, звезда трещин. */
zoneFx('f12_wallhit', (g, z, X, Y, k, age) => {
  const R = z.r * TS;
  const sd = seedOf(z);
  const fade = 1 - eIn(k);
  for (let i = 0; i < 9; i++)
    crackRay(g, X, Y, (i / 9) * TAU, R * eOut(age / 0.12), sd + i, P.white, 0.7 * fade);
  if (age < 0.12) glow(g, X, Y - 8, R, P.white, 0.8 * (1 - age / 0.12), 1, true);
  burst(g, X, Y - 10, age, {
    n: 26,
    seed: sd,
    v: [30, 90],
    up: [40, 110],
    grav: 300,
    life: [0.5, 1.1],
    size: [2, 4],
    cols: [P.rock, P.rockL, P.ice, P.white],
  });
  burst(
    g,
    X,
    Y,
    age,
    {
      n: 14,
      seed: sd + 9,
      v: [10, 30],
      drag: 2,
      rise: 8,
      life: [0.6, 1.2],
      size: [3, 5],
      cols: [P.snow, P.snowS],
    },
    0.5,
  );
});

/** Смена фазы: волна цвета фазы по арене (dur — номер фазы). Над темнотой. */
const PHASE_COL: C3[] = [P.ice, P.white, P.iceD, P.aur];
zoneFx('f12_phase', (g, z, X, Y, k, age) => {
  const p = Math.max(0, Math.min(3, Math.round(z.dur ?? 0)));
  const col = PHASE_COL[p];
  const R = z.r * TS;
  const sd = seedOf(z);
  if (age < 0.25) glow(g, X, Y - 16, 60, col, 0.6 * (1 - age / 0.25), 1, true);
  for (let i = 0; i < 2; i++) {
    const q = k01((age - i * 0.2) / 1.1);
    if (q <= 0 || q >= 1) continue;
    ringTicks(g, X, Y, R * eOut(q), col, 0.85 * (1 - q), 2, sd + i, 0.85, 0.8);
  }
  if (p === 1) {
    // Вьюга: снег закручивается вокруг мамонта.
    for (let i = 0; i < 40; i++) {
      const a = hash(sd, i, 1) * TAU + age * (2 + hash(sd, i, 2) * 2);
      const r = 20 + hash(sd, i, 3) * 70 * eOut(k * 1.5);
      dot(g, X + Math.cos(a) * r, Y - 12 + Math.sin(a) * r * 0.5, 2, 1, P.white, 0.7 * (1 - k));
    }
  } else if (p === 2) {
    // Ледниковый период: кристаллы вырастают по кругу.
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU;
      const r = R * 0.45;
      const hgt = 14 * eOut(k * 3) * (1 - eIn(k));
      const x = X + Math.cos(a) * r;
      const y = Y + Math.sin(a) * r * 0.8;
      g.fillStyle = rgba(P.ice, 0.8);
      g.beginPath();
      g.moveTo(x - 3, y);
      g.lineTo(x + 3, y);
      g.lineTo(x, y - hgt);
      g.closePath();
      g.fill();
    }
  } else if (p === 3) {
    // Сияние: столп света, шаманка взлетает.
    g.save();
    g.globalCompositeOperation = 'lighter';
    const lg = g.createLinearGradient(0, Y - 140, 0, Y);
    lg.addColorStop(0, rgba(P.aur, 0));
    lg.addColorStop(1, rgba(P.aurL, 0.45 * (1 - k)));
    g.fillStyle = lg;
    g.fillRect(Math.round(X - 14), Math.round(Y - 140), 28, 140);
    g.restore();
  } else {
    burst(
      g,
      X,
      Y,
      age,
      {
        n: 26,
        seed: sd,
        v: [60, 140],
        drag: 2,
        life: [0.5, 1.2],
        size: [2, 3],
        cols: [P.white, P.snow],
      },
      0.8,
    );
  }
});

/**
 * Ледник растёт: клетки следующего слоя индевеют (dur — номер слоя).
 * Сюда через миг поднимется стена — уходи к середине.
 */
zoneFx('f12_glacierwarn', (g, z, X, Y, k, _age, time) => {
  const sim = paintSim();
  if (!sim) return;
  const cells = f12Glacier(sim).layers[Math.round(z.dur ?? 0)];
  if (!cells) return;
  const left = z.x * TS - X;
  const top = z.y * TS - Y;
  const w = sim.world.w;
  const b = blink(k, time);
  for (const i of cells) {
    const cx = (i % w) * TS - left;
    const cy = Math.floor(i / w) * TS - top;
    if (cx < -TS || cy < -TS || cx > 600 || cy > 900) continue;
    g.fillStyle = rgba(b ? P.white : P.ice, 0.16 + 0.36 * k);
    g.fillRect(Math.round(cx), Math.round(cy), TS, TS);
    // Кристаллы нарастают из клетки.
    const n = 2 + (i % 2);
    for (let q = 0; q < n; q++) {
      const x = cx + 3 + hash(i, q, 1) * 10;
      const y = cy + 12 - hash(i, q, 2) * 4;
      const hgt = (4 + 7 * hash(i, q, 3)) * eOut(k);
      g.fillStyle = rgba(P.frost, 0.85);
      g.beginPath();
      g.moveTo(x - 2, y);
      g.lineTo(x + 2, y);
      g.lineTo(x, y - hgt);
      g.closePath();
      g.fill();
    }
  }
});

/** Вход мамонта: снег сыплется со свода, иней кольцом, сияние над ним. */
zoneFx('f12_wake', (g, z, X, Y, k, age) => {
  const sd = seedOf(z);
  if (age < 0.6)
    ringTicks(
      g,
      X,
      Y,
      12 * TS * 0.6 * eOut(age / 0.6),
      P.frost,
      0.8 * (1 - age / 0.6),
      3,
      sd,
      0.8,
      0.75,
    );
  // Снег со свода: хлопья падают и тают у пола.
  for (let i = 0; i < 70; i++) {
    const t0 = hash(sd, i, 1) * 1.6;
    const t = age - t0;
    if (t < 0 || t > 1) continue;
    const a = hash(sd, i, 2) * TAU;
    const r = 8 + hash(sd, i, 3) * 90;
    const x = X + Math.cos(a) * r + Math.sin(t * 6 + i) * 3;
    const yf = Y + Math.sin(a) * r * 0.6;
    const y = yf - 120 * (1 - t);
    dot(g, x, y, i % 4 ? 1 : 2, i % 4 ? 1 : 2, P.white, 0.8 * (1 - eIn(t)));
  }
  // Сияние разгорается высоко над ним.
  g.save();
  g.globalCompositeOperation = 'lighter';
  const a = Math.sin(Math.PI * k) * 0.35;
  for (let s = -12; s <= 12; s++) {
    const x = X + s * 6;
    const hgt = 40 + 20 * Math.sin(age * 2 + s * 0.6);
    const yb = Y - 70 + Math.sin(age * 1.5 + s * 0.4) * 8;
    const lg = g.createLinearGradient(0, yb - hgt, 0, yb);
    lg.addColorStop(0, rgba(P.aurL, 0));
    lg.addColorStop(1, rgba(P.aur, a * (1 - Math.abs(s) / 13)));
    g.fillStyle = lg;
    g.fillRect(Math.round(x), Math.round(yb - hgt), 4, Math.round(hgt));
  }
  g.restore();
});

/**
 * Смерть мамонта (dur — куда смотрел): трещины под ним, снежная пыль,
 * когда тело ложится (~1,1 с), и дух уходит в сияние зелёными огнями.
 */
zoneFx('f12_mamdeath', (g, z, X, Y, k, age) => {
  const sd = seedOf(z);
  const R = z.r * TS;
  const fade = 1 - eIn(k);
  for (let i = 0; i < 10; i++)
    crackRay(
      g,
      X,
      Y,
      (i / 10) * TAU + hash(sd, i, 1) * 0.5,
      R * 1.4 * eOut(age / 0.4),
      sd + i,
      P.frost,
      0.6 * fade,
    );
  const fall = age - 1.1;
  if (fall > 0) {
    const side = (z.dur ?? 0) + Math.PI / 2;
    const fx = X + Math.cos(side) * 10;
    const fy = Y + Math.sin(side) * 6;
    if (fall < 0.4)
      ringTicks(
        g,
        fx,
        fy,
        R * (0.6 + 1.2 * eOut(fall / 0.4)),
        P.white,
        1 - fall / 0.4,
        2,
        sd,
        0.85,
        0.7,
      );
    burst(
      g,
      fx,
      fy,
      fall,
      {
        n: 40,
        seed: sd + 3,
        v: [30, 90],
        r0: 14,
        up: [10, 40],
        grav: 60,
        drag: 2.2,
        life: [0.8, 1.6],
        size: [2, 4],
        cols: [P.white, P.snow, P.snowS],
      },
      0.85,
    );
  }
  // Дух уходит в сияние: столп зелёного света над телом и огни вверх.
  g.save();
  g.globalCompositeOperation = 'lighter';
  const pil = k01((age - 1.1) / 0.5) * (1 - k01((age - 2.3) / 0.7));
  if (pil > 0) {
    const lg = g.createLinearGradient(0, Y - 150, 0, Y);
    lg.addColorStop(0, rgba(P.aur, 0));
    lg.addColorStop(0.6, rgba(P.aur, 0.22 * pil));
    lg.addColorStop(1, rgba(P.aurL, 0.4 * pil));
    g.fillStyle = lg;
    for (let s = -3; s <= 3; s++) {
      const wv = Math.sin(age * 3 + s) * 2;
      g.fillRect(Math.round(X + s * 5 + wv - 2), Math.round(Y - 150), 4, 150);
    }
  }
  for (let i = 0; i < 16; i++) {
    const t = age - 1.2 - i * 0.08;
    if (t < 0 || t > 1.6) continue;
    const x = X + (hash(sd, i, 5) - 0.5) * 44 + Math.sin(t * 4 + i) * 6;
    const y = Y - 8 - t * (50 + 30 * hash(sd, i, 6));
    const a = 1 - t / 1.6;
    // Хвост огня — пять точек назад по пути.
    for (let q = 4; q >= 0; q--) {
      const tq = Math.max(0, t - q * 0.05);
      const yq = Y - 8 - tq * (50 + 30 * hash(sd, i, 6));
      const xq = X + (hash(sd, i, 5) - 0.5) * 44 + Math.sin(tq * 4 + i) * 6;
      g.fillStyle = rgba(q ? P.aurD : P.aurL, a * (q ? 0.5 - q * 0.08 : 1));
      g.fillRect(Math.round(xq), Math.round(yq), q ? 2 : 3, q ? 2 : 3);
    }
    g.fillStyle = rgba(P.white, a * 0.9);
    g.fillRect(Math.round(x) + 1, Math.round(y) + 1, 1, 1);
  }
  g.restore();
});
