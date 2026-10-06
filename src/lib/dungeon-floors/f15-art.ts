// Этаж 15 «Ядро подземелья», половина «Мир» — рисунок. Всё нарисовано кодом
// (CC0 проекта): клетки трёх районов, живые предметы, одиннадцать монстров
// со всеми позами, метки и картинки механик (колодцы, острова орбит, дуги
// комет, звёзды, затмение, шторм), снаряды и иконки материалов.
//
// Палитра этажа — ночь у упавшей звезды: индиго и фиолет породы, бирюза
// кристалла, латунь строителей, золото звезды. Ничего мясного.
//
// Свет падает сверху-слева. Клетки рисуются целиком (`paintAll`), по
// мировым координатам: шов между клетками не виден. Кадры монстров — в
// кеше с вытеснением (`frameLRU`) и прогреваются заранее (`registerMobWarm`).

import { Px, TS } from '../dungeon-art';
import type { Mob, Shot, Strike, Zone } from '../dungeon-sim';
import { bandOf } from '../dungeon-world';
import type { WorldObj } from '../dungeon-world';
import {
  frameLRU,
  MOB_PAINTERS,
  paintSim,
  registerCellPainter,
  registerImpactPainter,
  registerItemArt,
  registerMobPainter,
  registerMobWarm,
  registerPropPainter,
  registerShotPainter,
  registerZonePainter,
} from '../dungeon-paint';
import type { CellCtx, MobFrame, MobPose, Sprite } from '../dungeon-paint';
import { F15_MARK, F15_OBS, F15_ORBIT, F15_ROOTS } from './f15';
import {
  ASTRO,
  COMET,
  DEVOURER,
  ECHO,
  F15_FX,
  f15State,
  GRAVITON,
  inDark,
  METEOR as METEOR_K,
  MOON,
  MOTIFS,
  NOVA,
} from './f15-brains';
import type { Arc, Chart, FShot, Ring, Well } from './f15-brains';
import { F3, proj, renderRig, Rig, SE, vadd, vdot, vlen, vlerp, vmul, vnorm, vsub } from './f15-rig';
import type { Mat, RigOpt, RigOut, V3 } from './f15-rig';

type RGBA = [number, number, number, number];
type Tones = [RGBA, RGBA, RGBA, RGBA];

const MK = F15_MARK;
const TAU = Math.PI * 2;
const PI = Math.PI;
const T_DEEP = 11;

// ---------------------------------------------------------------------------
// Цвет и шум.
// ---------------------------------------------------------------------------

const hx = (h: string, a = 255): RGBA => {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255, a];
};
const mixc = (a: RGBA, b: RGBA, k: number): RGBA => {
  k = Math.max(0, Math.min(1, k));
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
    Math.round(a[3] + (b[3] - a[3]) * k),
  ];
};
const alpha = (c: RGBA, a: number): RGBA => [
  c[0],
  c[1],
  c[2],
  Math.round(Math.max(0, Math.min(1, a)) * 255),
];
const tn = (a: string, b: string, c: string, d: string): Tones => [hx(a), hx(b), hx(c), hx(d)];
const rgba = (c: RGBA, a = 1) =>
  `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (k: number) => k * k * (3 - 2 * k);

function hash(x: number, y: number, s: number): number {
  let h =
    (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Гладкий шум по мировым пикселям: решётка `sc`. */
function vnoise(x: number, y: number, sc: number, s: number): number {
  const fx = x / sc;
  const fy = y / sc;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const u = smooth(fx - ix);
  const v = smooth(fy - iy);
  const a = hash(ix, iy, s);
  const b = hash(ix + 1, iy, s);
  const c = hash(ix, iy + 1, s);
  const d = hash(ix + 1, iy + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

const fbm = (x: number, y: number, sc: number, s: number) =>
  vnoise(x, y, sc, s) * 0.55 +
  vnoise(x, y, sc / 2, s + 1) * 0.3 +
  vnoise(x, y, sc / 4, s + 2) * 0.15;

interface Vor {
  d1: number;
  d2: number;
  id: number;
  /** Смещение точки от центра ячейки (для граней). */
  ox: number;
  oy: number;
}

/** Ячейки Вороного по решётке `sc` — грани кристалла, плиты, булыжник. */
function voronoi(x: number, y: number, sc: number, s: number): Vor {
  const fx = x / sc;
  const fy = y / sc;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  let d1 = 9;
  let d2 = 9;
  let id = 0;
  let ox = 0;
  let oy = 0;
  for (let j = -1; j <= 1; j++)
    for (let i = -1; i <= 1; i++) {
      const cx = ix + i + hash(ix + i, iy + j, s);
      const cy = iy + j + hash(ix + i, iy + j, s + 7);
      const d = Math.hypot(fx - cx, fy - cy);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        id = hash(ix + i, iy + j, s + 3);
        ox = fx - cx;
        oy = fy - cy;
      } else if (d < d2) d2 = d;
    }
  return { d1, d2, id, ox, oy };
}

/** Свет сверху-слева-спереди. */
const LX = -0.45;
const LY = -0.72;
const LZ = 0.52;

function tone(t: Tones, l: number): RGBA {
  return l > 0.78 ? t[3] : l > 0.42 ? t[2] : l > 0.02 ? t[1] : t[0];
}

/** Плавный тон: между четырьмя ступенями без полос (для неба и свечения). */
function ramp(cs: RGBA[], k: number): RGBA {
  k = clamp01(k) * (cs.length - 1);
  const i = Math.min(cs.length - 2, Math.floor(k));
  return mixc(cs[i], cs[i + 1], k - i);
}

function shadeEll(p: Px, cx: number, cy: number, rx: number, ry: number, t: Tones, bias = 0): void {
  if (rx <= 0 || ry <= 0) return;
  p.ell(cx, cy, rx, ry, (x, y) => {
    const dx = (x + 0.5 - cx) / rx;
    const dy = (y + 0.5 - cy) / ry;
    const nz = Math.sqrt(Math.max(0, 1 - dx * dx - dy * dy));
    return tone(t, dx * LX + dy * LY + nz * LZ + bias);
  });
}

function limb(
  p: Px,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  r0: number,
  r1: number,
  t: Tones,
  bias = 0,
): void {
  const minX = Math.floor(Math.min(x0 - r0, x1 - r1)) - 1;
  const maxX = Math.ceil(Math.max(x0 + r0, x1 + r1)) + 1;
  const minY = Math.floor(Math.min(y0 - r0, y1 - r1)) - 1;
  const maxY = Math.ceil(Math.max(y0 + r0, y1 + r1)) + 1;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const L2 = dx * dx + dy * dy || 1e-6;
  for (let y = minY; y <= maxY; y++)
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const k = clamp01(((px - x0) * dx + (py - y0) * dy) / L2);
      const r = r0 + (r1 - r0) * k;
      const ex = px - (x0 + dx * k);
      const ey = py - (y0 + dy * k);
      const d = Math.hypot(ex, ey);
      if (d > r) continue;
      const nx = ex / (r || 1);
      const ny = ey / (r || 1);
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      p.set(x, y, tone(t, nx * LX + ny * LY + nz * LZ + bias));
    }
}

function poly(p: Px, pts: [number, number][], c: RGBA | ((x: number, y: number) => RGBA)): void {
  let minX = 1e9;
  let maxX = -1e9;
  let minY = 1e9;
  let maxY = -1e9;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++)
    for (let x = Math.floor(minX); x <= Math.ceil(maxX); x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i];
        const [xj, yj] = pts[j];
        if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) p.set(x, y, typeof c === 'function' ? c(x, y) : c);
    }
}

/** Грань кристалла: свет по её нормали (`nx, ny` — куда смотрит грань). */
function facet(p: Px, pts: [number, number][], t: Tones, nx: number, ny: number, bias = 0): void {
  const l = nx * LX + ny * LY + 0.5 + bias;
  poly(p, pts, tone(t, l));
}

function stroke(p: Px, x0: number, y0: number, x1: number, y1: number, c: RGBA, w = 1): void {
  const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2) + 1;
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    const y = y0 + ((y1 - y0) * i) / n;
    if (w <= 1) p.set(Math.floor(x), Math.floor(y), c);
    else
      p.rect(
        Math.floor(x - w / 2),
        Math.floor(y - w / 2),
        Math.floor(x + w / 2 - 0.01),
        Math.floor(y + w / 2 - 0.01),
        c,
      );
  }
}

/** Мягкая светящаяся точка (свечение складывается поверх). */
function glow(p: Px, cx: number, cy: number, r: number, c: RGBA, k = 1): void {
  for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++)
    for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r;
      if (d >= 1) continue;
      p.set(x, y, alpha(c, (1 - d) * (1 - d) * k));
    }
}

/** Звёздочка-крестик. */
function sparkle(p: Px, x: number, y: number, c: RGBA, arm = 1): void {
  p.set(x, y, c);
  const s = alpha(c, 0.6);
  for (let k = 1; k <= arm; k++) {
    p.set(x - k, y, s);
    p.set(x + k, y, s);
    p.set(x, y - k, s);
    p.set(x, y + k, s);
  }
}

const INK = hx('#0a0614');
const WHITE = hx('#ffffff');
const GOLDK = hx('#ffd060');

// Палитры этажа.
const STONE = tn('#141230', '#211d46', '#2f2a5e', '#433c7c');
const CRYST = tn('#123a6a', '#1f6aa8', '#4cb6e8', '#c8f4ff');
const VIOLET = tn('#2a1660', '#4a2a98', '#7a56d8', '#d0c0ff');
const TEAL = tn('#0c3a44', '#147a86', '#2ec8d0', '#b8fff6');
const BRASS = tn('#4a3410', '#80601e', '#c09038', '#f4dc8a');
const IVORY = tn('#6a6478', '#9a94aa', '#c8c2d4', '#f2eef8');
const LAPIS = tn('#0a1440', '#14246a', '#22409a', '#4a70d0');
const METEOR = tn('#1c1414', '#3a2a26', '#5e4a40', '#8a7464');
const GOLD = tn('#6a4410', '#b07a18', '#f0b838', '#fff2b0');
const ROSE = tn('#3a1030', '#6a2050', '#b04a80', '#ffb8d8');
const STAR_C = hx('#fff4d0');
const TEAL_GLOW = hx('#6cf0ff');
const VIOLET_GLOW = hx('#b890ff');
const SKY: RGBA[] = [hx('#020108'), hx('#07041a'), hx('#120a34'), hx('#1e1450')];

// ---------------------------------------------------------------------------
// Клетки. Пустота — космос с туманностями; у каждого района свои пол и стены.
// Язык: пол СВЕТЛЕЕ и ровнее, верх стены — почти чёрный, лицо стены —
// слои со светлой кромкой. Звёзды бывают только в пустоте (пол без искр,
// иначе он читается небом).
// ---------------------------------------------------------------------------

const BAY = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
/** Упорядоченный шум 4×4: мягкий переход тонов без полос. */
const dith = (x: number, y: number) => BAY[((y & 3) << 2) | (x & 3)] / 16 - 0.5;

const ROOT_FLOOR = tn('#221e44', '#2e2a5a', '#3b3672', '#4c4690');
const ROOT_CAP = tn('#07061a', '#0d0b24', '#151232', '#201c44');
const ROOT_FACE = tn('#161236', '#241e50', '#342c6c', '#5a50a8');
const CRYST_DIM = tn('#0c2448', '#154276', '#2470a8', '#62bce6');
const GRIT = tn('#1a1634', '#282248', '#383062', '#524a86');
const OBS_FLOOR = tn('#242a4a', '#30385e', '#3e4876', '#505c92');
const OBS_CAP = tn('#06071a', '#0c0e22', '#131730', '#1b2042');
const OBS_FACE = tn('#181c38', '#242a4e', '#323a68', '#444e88');
const REG = tn('#2a2638', '#3a354c', '#4e4864', '#6a6484');

/** Космос: туманность (две краски), звёзды трёх величин, редкие далёкие планеты. */
function spacePx(p: Px, wx: number, wy: number, k = 1, lane: boolean | Ring = false): void {
  const X0 = wx * TS;
  const Y0 = wy * TS;
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const Y = Y0 + y;
      const n = fbm(X, Y, 64, 1501);
      const m = fbm(X + 300, Y - 200, 96, 1502);
      let c = ramp(SKY, n * 0.9 * k);
      const neb = clamp01((m - 0.52) * 3.2);
      if (neb > 0) c = mixc(c, n > 0.5 ? hx('#2a1660') : hx('#0c3040'), neb * 0.55 * k);
      if (lane) {
        // Дорожка орбиты: пыльное кольцо с мягкими краями и пунктир середины.
        const dn = vnoise(X, Y, 6, 1503);
        if (lane === true) c = mixc(c, hx('#2a2460'), 0.25 + dn * 0.15);
        else {
          const d = Math.hypot(X + 0.5 - lane.cx * TS, Y + 0.5 - lane.cy * TS) / TS;
          const k = clamp01(Math.min(d - lane.r0 + 0.4, lane.r1 + 0.4 - d) / 0.8);
          if (k > 0) c = mixc(c, hx('#2c2666'), smooth(k) * (0.3 + dn * 0.2));
          const mid = (lane.r0 + lane.r1) / 2;
          const ang = Math.atan2(Y + 0.5 - lane.cy * TS, X + 0.5 - lane.cx * TS);
          if (Math.abs(d - mid) < 0.05 && ((Math.floor(ang * mid * TS) % 6) + 6) % 6 < 2)
            c = mixc(c, TEAL_GLOW, 0.45);
        }
      }
      p.set(x, y, c);
    }
  for (let i = 0; i < 5; i++) {
    const h = hash(wx * 5 + i, wy, 1510);
    if (h > 0.5) continue;
    const x = 1 + Math.floor(hash(wx, wy * 5 + i, 1511) * 14);
    const y = 1 + Math.floor(hash(wx * 3 + i, wy * 7, 1512) * 14);
    const col = h < 0.18 ? STAR_C : h < 0.3 ? hx('#a8c8ff') : hx('#c8a8ff');
    if (h < 0.05) sparkle(p, x, y, col, 1);
    else p.set(x, y, alpha(col, 0.5 + h));
  }
  if (hash(wx, wy, 1513) < 0.004)
    shadeEll(p, 8, 8, 3.5, 3.5, hash(wx, wy, 1514) < 0.5 ? ROSE : LAPIS, -0.1);
}

/** Провал в породе: тьма, по северному краю — обрыв со светом кристаллов. */
function chasmPx(p: Px, c: CellCtx): void {
  const X0 = c.wx * TS;
  const Y0 = c.wy * TS;
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const n = fbm(X0 + x, Y0 + y, 24, 1520);
      p.set(x, y, ramp([hx('#020108'), hx('#06041a'), hx('#0e0a2c')], n * 0.7));
    }
  if (solidFloorAt(c, 0, -1)) {
    for (let x = 0; x < TS; x++) {
      const h = 6 + Math.floor(vnoise(X0 + x, Y0, 4, 1521) * 4);
      for (let y = 0; y < h; y++) p.set(x, y, mixc(ROOT_FACE[2], hx('#05030c'), y / h));
      p.set(x, 0, ROOT_FACE[3]);
      if (hash(X0 + x, Y0, 1522) < 0.15) p.set(x, h - 3, alpha(TEAL_GLOW, 0.6));
    }
  }
}

/**
 * Толща плиты пола над пустотой (клетка пустоты прямо под полом): лицо
 * породы с неровным низом, капли-сосульки, под ними бирюзовый отсвет.
 */
/** Твёрдый пол (не пустота и не стена) в соседней клетке. `open` движка считает пустоту открытой. */
function solidFloorAt(c: CellCtx, dx: number, dy: number): boolean {
  const sim = F15_FX.sim;
  if (!sim || !c.open(dx, dy)) return false;
  const x = c.wx + dx;
  const y = c.wy + dy;
  if (x < 0 || y < 0 || x >= sim.world.w || y >= sim.world.h) return false;
  return sim.tiles[y * sim.world.w + x] !== T_DEEP;
}

function ledgeFace(p: Px, c: CellCtx, t: Tones): void {
  const X0 = c.wx * TS;
  for (let x = 0; x < TS; x++) {
    const X = X0 + x;
    const h =
      5 + Math.floor(vnoise(X, c.wy, 5, 1595) * 4) + (hash(X >> 1, c.wy, 1596) < 0.12 ? 3 : 0);
    for (let y = 0; y < h; y++) {
      const k = y / h;
      let col = tone(t, 0.75 - k * 1.1 + (hash(X, y, 1597) - 0.5) * 0.15);
      if (y === 0) col = t[3];
      // Слои породы.
      if ((y + (X >> 3)) % 4 === 2) col = mixc(col, INK, 0.25);
      p.set(x, y, col);
    }
    p.set(x, h, alpha(TEAL_GLOW, 0.35));
    p.set(x, h + 1, alpha(TEAL_GLOW, 0.15));
  }
}

/** Центры спящих больших осколков мира (кратер «Пробуждения»). */
const SHARD_AT = new WeakMap<object, [number, number][]>();
function craterAt(c: CellCtx): [number, number] | null {
  const sim = F15_FX.sim;
  if (!sim) return null;
  let l = SHARD_AT.get(sim.world);
  if (!l) {
    l = sim.world.objs
      .filter((o) => o.ref === 'f15_bigshard')
      .map((o) => [o.x + 0.5, o.y + 0.5] as [number, number]);
    SHARD_AT.set(sim.world, l);
  }
  for (const s of l) if (Math.hypot(s[0] - c.wx - 0.5, s[1] - c.wy - 0.5) < 4.4) return s;
  return null;
}

/**
 * Кратер осколка: круглая воронка по пикселям (клетки ямы — крестом, край
 * рисуем кругом). Северная внутренняя стенка видна, на дне — свет ядра.
 */
function craterPx(
  p: Px,
  c: CellCtx,
  at: [number, number],
  base: (p: Px, c: CellCtx) => void,
): void {
  rimFloor(p, c, false, base);
  const cx = at[0] * TS;
  const cy = at[1] * TS;
  const RP = 2.05 * TS;
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = c.wx * TS + x + 0.5;
      const Y = c.wy * TS + y + 0.5;
      const dx = X - cx;
      const dy = Y - cy;
      const a = Math.atan2(dy, dx);
      const R = RP + (vnoise(a * 9, 0, 1, 1561) - 0.5) * 2.4;
      const d = Math.hypot(dx, dy);
      if (d > R) continue;
      // Дно — круг, сдвинутый вниз: над ним видна северная стенка.
      const hd = Math.hypot(dx, (dy - 0.55 * TS) * 1.1);
      const HR = R - 0.45 * TS;
      let col: RGBA;
      if (d > R - 1.2) col = dy > 0 ? CRYST[3] : ROOT_FACE[0];
      else if (hd > HR) {
        // Стенка: камень сверху светлее, к дну темнее; жилы кристалла.
        const k = clamp01((Y - (cy - R)) / (0.9 * TS));
        col = mixc(ROOT_FACE[2], hx('#07051a'), k);
        if (hash(Math.floor(X / 2), Math.floor(Y / 3), 1562) < 0.08) col = mixc(col, TEAL[2], 0.6);
      } else {
        const r = hd / HR;
        const sw = 0.5 + 0.5 * Math.sin(a * 3 + r * 6);
        col = ramp(
          [hx('#d8ffff'), hx('#6ce4f4'), hx('#1c78a8'), hx('#0c2458'), hx('#060a24')],
          r * 0.95 + sw * 0.1,
        );
        if (hash(X, Y, 1563) < 0.012) col = WHITE;
      }
      p.set(x, y, col);
    }
}

/** Сердцевина колодца: воронка света, закрученная (осколок над ней — предмет). */
function corePx(p: Px): void {
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const dx = x + 0.5 - 8;
      const dy = y + 0.5 - 8;
      const r = Math.hypot(dx, dy) / 8;
      const a = Math.atan2(dy, dx) + r * 5;
      const sw = 0.5 + 0.5 * Math.sin(a * 3);
      const col =
        r > 1
          ? CRYST_DIM[0]
          : ramp(
              [hx('#ffffff'), hx('#9ff8ff'), hx('#2aa8c8'), hx('#123060'), hx('#081838')],
              r * 0.9 + sw * 0.12,
            );
      p.set(x, y, col);
    }
}

/** Мелкие кристаллы в полу — по блокам 8×8 мира, шов клеток не режет их. */
function chips(p: Px, c: CellCtx, share: number, big: boolean): void {
  const X0 = c.wx * TS;
  const Y0 = c.wy * TS;
  for (let by = Math.floor(Y0 / 8) - 1; by <= Math.floor((Y0 + 15) / 8); by++)
    for (let bx = Math.floor(X0 / 8) - 1; bx <= Math.floor((X0 + 15) / 8); bx++) {
      if (hash(bx, by, 1535) > share) continue;
      const cx = bx * 8 + 1 + Math.floor(hash(bx, by, 1536) * 6) - X0;
      const cy = by * 8 + 2 + Math.floor(hash(bx, by, 1537) * 5) - Y0;
      const t = hash(bx, by, 1538) < 0.3 ? VIOLET : CRYST_DIM;
      const h = big
        ? 4 + Math.floor(hash(bx, by, 1539) * 3)
        : 2 + Math.floor(hash(bx, by, 1539) * 2);
      // Тень, левая (светлая) и правая (тёмная) грани, вершина.
      p.set(cx + 1, cy + 1, alpha(INK, 0.5));
      p.set(cx + 2, cy + 1, alpha(INK, 0.35));
      for (let i = 0; i < h; i++) {
        p.set(cx, cy - i, t[2]);
        p.set(cx + 1, cy - i, t[1]);
      }
      p.set(cx, cy - h, t[3]);
      if (big) {
        p.set(cx - 1, cy, t[2]);
        p.set(cx - 1, cy - 1, t[3]);
        p.set(cx + 2, cy, t[1]);
      }
    }
}

/** Пол Корней: тёсаная природой порода, плиты с тиснёными швами. */
function rootFloor(p: Px, c: CellCtx, grit: boolean): void {
  const X0 = c.wx * TS;
  const Y0 = c.wy * TS;
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const Y = Y0 + y;
      const n = fbm(X, Y, 26, 1530);
      if (grit) {
        // Старая выработка: галька, каждая — бугорок со светом сверху.
        const v = voronoi(X, Y, 3.4, 1531);
        const l = -(v.ox * LX + v.oy * LY) * 1.1 + 0.3 + (n - 0.5) * 0.4 + dith(X, Y) * 0.15;
        p.set(x, y, v.d2 - v.d1 < 0.1 ? GRIT[0] : tone(GRIT, l));
        continue;
      }
      const v = voronoi(X, Y, 11, 1532);
      const seam = v.d2 - v.d1;
      // Крупные пятна: светящийся «лишайник» кристаллов в швах и тёмная пыль.
      const m = fbm(X, Y, 110, 1533);
      let l = 0.2 + (n - 0.5) * 0.9 + v.id * 0.2 + dith(X, Y) * 0.16 + (m - 0.5) * 0.35;
      if (seam < 0.05) l = -0.2;
      else if (seam < 0.11) l += v.ox * LX + v.oy * LY > 0 ? 0.25 : -0.22;
      let col = tone(ROOT_FLOOR, l);
      // У камней свой оттенок: одни в фиолет, другие в синеву.
      if (seam >= 0.05) {
        if (v.id > 0.82) col = mixc(col, VIOLET[1], 0.22);
        else if (v.id < 0.12) col = mixc(col, LAPIS[1], 0.25);
      }
      // Трещина через камень со слабым светом изнутри.
      if (v.id > 0.4 && v.id < 0.47 && seam > 0.12) {
        const cr = Math.abs(
          (X - Y * 0.6) * 0.25 + Math.sin(Y * 0.5) * 0.8 - Math.round((X - Y * 0.6) * 0.25),
        );
        if (cr < 0.07) col = mixc(INK, VIOLET[2], 0.35);
      }
      // Лишайник — кустиками в швах, а не ровной крошкой.
      const clump = vnoise(X, Y, 5, 1527);
      if (m > 0.58 && seam < 0.13 && clump > 0.62 && hash(X, Y, 1534) < (m - 0.58) * 2.2)
        col = hash(X, Y, 1529) < 0.3 ? TEAL[3] : TEAL[2];
      else if (m < 0.36 && seam >= 0.05) col = mixc(col, hx('#120e2a'), (0.36 - m) * 1.6);
      p.set(x, y, col);
    }
  chips(p, c, grit ? 0.04 : 0.07, false);
}

/** Пол в кристаллах (`xfloor`): из камня растут кристаллы покрупнее. */
function xFloor(p: Px, c: CellCtx): void {
  rootFloor(p, c, false);
  chips(p, c, 0.35, true);
}

/** Жила: в полу светится бирюзовая прожилка. */
function veinFloor(p: Px, c: CellCtx): void {
  rootFloor(p, c, false);
  const X0 = c.wx * TS;
  const Y0 = c.wy * TS;
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const r = Math.abs(fbm(X0 + x, Y0 + y, 18, 1540) - 0.5);
      if (r < 0.018) p.set(x, y, hash(X0 + x, Y0 + y, 1541) < 0.2 ? hx('#d8ffff') : TEAL[2]);
      else if (r < 0.05) p.set(x, y, mixc(p.get(x, y), TEAL[1], 0.45));
    }
}

/** Кольцо орбиты, по которому идёт клетка дорожки. */
function ringFor(c: CellCtx): Ring | null {
  const st = stNow();
  if (!st) return null;
  for (const r of st.rings) {
    const d = Math.hypot(c.wx + 0.5 - r.cx, c.wy + 0.5 - r.cy);
    if (d > r.r0 - 1 && d < r.r1 + 1) return r;
  }
  return null;
}

/** Ближний колодец к клетке (кайма рисуется кругом от его ядра). */
function wellFor(c: CellCtx): Well | null {
  const st = stNow();
  if (!st) return null;
  let best: Well | null = null;
  let bd = 4.2;
  for (const w of st.wells) {
    if (w.temp) continue;
    const d = Math.hypot(w.x - c.wx - 0.5, w.y - c.wy - 0.5);
    if (d < bd) {
      bd = d;
      best = w;
    }
  }
  return best;
}

/**
 * Кайма колодца: кольца кристальных плит вокруг ядра (у Обсерватории —
 * латунь и лазурь). Круг по пикселям — край не лесенкой клеток.
 */
function rimFloor(p: Px, c: CellCtx, obs: boolean, base: (p: Px, c: CellCtx) => void): void {
  base(p, c);
  const w = wellFor(c);
  const cr = w ? null : craterAt(c);
  const cx = w ? w.x * TS : cr ? cr[0] * TS : (c.wx + 0.5) * TS;
  const cy = w ? w.y * TS : cr ? cr[1] * TS : (c.wy + 0.5) * TS;
  const RIM = 2.45 * TS;
  const t = obs ? LAPIS : CRYST_DIM;
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = c.wx * TS + x;
      const Y = c.wy * TS + y;
      const dx = X + 0.5 - cx;
      const dy = Y + 0.5 - cy;
      const d = Math.hypot(dx, dy);
      if (d > RIM + dith(X, Y) * 3) continue;
      const rr = (d - 0.9 * TS) / (0.6 * TS);
      const ring = Math.max(0, Math.floor(rr));
      const segN = 8 + ring * 4;
      const a = Math.atan2(dy, dx) / TAU + 0.5 + ring * 0.13;
      const seg = Math.floor(a * segN);
      const fr = rr - ring;
      const fa = a * segN - seg;
      const edge = fr < 0.14 || fa < 0.08;
      const outer = d > RIM - 2.5;
      let col: RGBA;
      if (outer) col = obs ? BRASS[1] : CRYST_DIM[0];
      else if (edge) col = obs ? BRASS[fr < 0.07 ? 2 : 1] : CRYST_DIM[0];
      else {
        // Плита наклонена к ядру: ближняя к свету сторона светлее.
        const l =
          0.5 -
          ring * 0.14 +
          hash(seg, ring, 1550) * 0.2 +
          ((dx * LX + dy * LY) / (d || 1)) * -0.2 +
          dith(X, Y) * 0.1;
        col = tone(t, l);
      }
      p.set(x, y, col);
    }
}

/** Невесомость: пол бледнеет, над ним висят пылинки. */
function floatFloor(p: Px, c: CellCtx, base: (p: Px, c: CellCtx) => void): void {
  base(p, c);
  const X0 = c.wx * TS;
  const Y0 = c.wy * TS;
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const n = vnoise(X0 + x, Y0 + y, 10, 1560);
      p.set(x, y, alpha(hx('#8a7ae0'), 0.12 + n * 0.14));
    }
  for (let i = 0; i < 3; i++) {
    const x = Math.floor(hash(c.wx, c.wy * 3 + i, 1561) * 15);
    const y = Math.floor(hash(c.wx * 3 + i, c.wy, 1562) * 13);
    p.set(x, y, alpha(hx('#e0d8ff'), 0.85));
    p.set(x, y + 2, alpha(hx('#000000'), 0.35));
  }
}

/** Тяжесть: плотная порода, по ней — кольца давления. */
/**
 * Расстояние (px) от точки клетки до края пятна своей метки — чтобы пятна
 * (тяжесть, гравий) кончались неровно по пикселям, а не ступеньками клеток.
 */
function patchEdge(c: CellCtx): (x: number, y: number) => number {
  const no = (dx: number, dy: number) => c.markAt(dx, dy) !== c.mark;
  const L = no(-1, 0);
  const R = no(1, 0);
  const U = no(0, -1);
  const D = no(0, 1);
  const cor: [number, number][] = [];
  if (no(-1, -1)) cor.push([0, 0]);
  if (no(1, -1)) cor.push([TS, 0]);
  if (no(-1, 1)) cor.push([0, TS]);
  if (no(1, 1)) cor.push([TS, TS]);
  return (x, y) => {
    let e = 99;
    if (L) e = Math.min(e, x + 0.5);
    if (R) e = Math.min(e, TS - 0.5 - x);
    if (U) e = Math.min(e, y + 0.5);
    if (D) e = Math.min(e, TS - 0.5 - y);
    for (const [cx, cy] of cor) e = Math.min(e, Math.hypot(x + 0.5 - cx, y + 0.5 - cy));
    return e;
  };
}

/** Гравий старой выработки поверх пола Корней, край — россыпью. */
function gritFloor(p: Px, c: CellCtx): void {
  rootFloor(p, c, false);
  const q = new Px(TS, TS);
  rootFloor(q, c, true);
  // Пятно — «капли» вокруг центров соседних клеток гравия: круглое у
  // одиночной клетки, слитное у группы, за свою клетку не вылезает.
  const near: [number, number][] = [];
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++)
      if (c.markAt(dx, dy) === c.mark) near.push([dx * TS + 8, dy * TS + 8]);
  const R = 12.5;
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = c.wx * TS + x;
      const Y = c.wy * TS + y;
      let f = 0;
      for (const [cx, cy] of near) {
        const d2 = ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2) / (R * R);
        if (d2 < 1) f += (1 - d2) ** 2;
      }
      f += (vnoise(X, Y, 4, 1528) - 0.5) * 0.3;
      if (f < 0.35 || (f < 0.45 && dith(X, Y) > (f - 0.35) * 10)) continue;
      const i = (y * TS + x) * 4;
      p.set(x, y, [q.data[i], q.data[i + 1], q.data[i + 2], 255]);
    }
}

function heavyFloor(p: Px, c: CellCtx, base: (p: Px, c: CellCtx) => void): void {
  base(p, c);
  const X0 = c.wx * TS;
  const Y0 = c.wy * TS;
  // Край пятна тяжести — неровный, по пикселям, а не по клеткам.
  const ed = patchEdge(c);
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const Y = Y0 + y;
      const e = ed(x, y) + (vnoise(X, Y, 6, 1571) - 0.5) * 7;
      if (e < 0.6) continue;
      const n = fbm(X, Y, 14, 1570);
      const ring = Math.sin(
        Math.hypot((((X % 48) + 48) % 48) - 24, (((Y % 48) + 48) % 48) - 24) * 0.9,
      );
      let col = tone(
        tn('#1c1024', '#2a1834', '#3c244a', '#543462'),
        (n - 0.5) * 0.8 + 0.25 + dith(X, Y) * 0.12,
      );
      if (ring > 0.93) col = mixc(col, hx('#b0507a'), 0.45);
      if (e < 1.8) col = mixc(col, hx('#d070a8'), 0.55);
      else if (e < 3.2 && dith(X, Y) < 0.5) col = mixc(col, hx('#2a1834'), 0.5);
      p.set(x, y, col);
    }
}

/** Тень у подножия стены: сверху и с боков. */
function wallShade(p: Px, c: CellCtx): void {
  const sh = hx('#000000');
  if (!c.open(0, -1))
    for (let x = 0; x < TS; x++) for (let y = 0; y < 3; y++) p.set(x, y, alpha(sh, 0.5 - y * 0.15));
  if (!c.open(-1, 0))
    for (let y = 0; y < TS; y++)
      for (let x = 0; x < 2; x++) p.set(x, y, alpha(sh, 0.32 - x * 0.14));
  if (!c.open(1, 0))
    for (let y = 0; y < TS; y++)
      for (let x = 0; x < 2; x++) p.set(15 - x, y, alpha(sh, 0.32 - x * 0.14));
}

/** Светлая кайма верха стены там, где рядом пол (силуэт массива). */
function capRim(p: Px, c: CellCtx, col: RGBA, capH: number): void {
  if (c.open(-1, 0)) for (let y = 0; y < capH; y++) p.set(0, y, col);
  if (c.open(1, 0)) for (let y = 0; y < capH; y++) p.set(15, y, alpha(col, 0.6));
  if (c.open(0, -1)) for (let x = 0; x < TS; x++) p.set(x, 0, col);
}

/**
 * Стена Корней. Верх — тёмная порода в гранях (у кристальной — друзы);
 * лицо над полом — слои с кромкой света, у подножия кристаллы.
 */
function rockWall(p: Px, c: CellCtx, crystal: boolean): void {
  const X0 = c.wx * TS;
  const Y0 = c.wy * TS;
  const face = c.open(0, 1);
  const capH = face ? 6 : 16;
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const Y = Y0 + y;
      let col: RGBA;
      if (y < capH) {
        const n = fbm(X, Y, 14, 1580);
        const v = voronoi(X, Y, 9, 1581);
        let l = 0.25 + (n - 0.5) * 0.7 - (v.ox * LX + v.oy * LY) * 0.5 + dith(X, Y) * 0.12;
        if (v.d2 - v.d1 < 0.06) l -= 0.35;
        col = tone(ROOT_CAP, l);
        if (crystal) {
          const q = voronoi(X, Y, 5, 1582);
          if (q.id > 0.62) {
            const lq = -(q.ox * LX + q.oy * LY) * 1.6 + 0.35;
            col = q.d2 - q.d1 < 0.1 ? CRYST_DIM[0] : tone(q.id > 0.85 ? VIOLET : CRYST_DIM, lq);
          }
        }
      } else {
        const yy = y - capH;
        const band = Math.sin((Y + vnoise(X, Y, 12, 1583) * 7) * 0.62);
        let l = 0.62 - yy * 0.045 + band * 0.16 + dith(X, Y) * 0.12;
        if (hash(X >> 2, Math.floor(Y / 5), 1584) < 0.08 && (X & 3) === 0) l -= 0.4;
        col = tone(crystal ? CRYST_DIM : ROOT_FACE, l);
        if (yy === 0) col = crystal ? CRYST_DIM[3] : ROOT_FACE[3];
        if (y === 15) col = mixc(col, INK, 0.5);
      }
      p.set(x, y, col);
    }
  capRim(p, c, crystal ? CRYST_DIM[2] : ROOT_FACE[2], capH);
  if (face) {
    // Кристаллы у подножия лица.
    const n = crystal ? 2 : hash(c.wx, c.wy, 1585) < 0.3 ? 1 : 0;
    for (let i = 0; i < n; i++) {
      const bx = 3 + Math.floor(hash(c.wx, c.wy + i, 1586) * 10);
      const h = 4 + Math.floor(hash(c.wx + i, c.wy, 1587) * 5);
      const t = hash(c.wx + i, c.wy + 1, 1588) < 0.3 ? VIOLET : CRYST;
      facet(
        p,
        [
          [bx - 2, 16],
          [bx, 16 - h],
          [bx + 0.5, 16],
        ],
        t,
        -1,
        0,
        0.15,
      );
      facet(
        p,
        [
          [bx + 0.5, 16],
          [bx, 16 - h],
          [bx + 2.5, 16],
        ],
        t,
        1,
        0,
        -0.1,
      );
    }
  }
}

/** Печать зала: кристальная решётка с фиолетовым светом. */
function sealPx(p: Px, c: CellCtx): void {
  const X0 = c.wx * TS;
  const Y0 = c.wy * TS;
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const Y = Y0 + y;
      const v = voronoi(X, Y, 4, 1590);
      const l = -(v.ox * LX + v.oy * LY) * 1.3 + 0.5 + v.id * 0.2;
      p.set(x, y, v.d2 - v.d1 < 0.09 ? hx('#e8d8ff') : tone(VIOLET, l));
    }
}

// --- Обсерватория -----------------------------------------------------------

/** Плиты Обсерватории: светлый тёсаный камень, тонкие латунные швы. */
function slabFloor(p: Px, c: CellCtx): void {
  const X0 = c.wx * TS;
  const Y0 = c.wy * TS;
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const Y = Y0 + y;
      const row = Math.floor(Y / 16);
      const off = row % 2 ? 8 : 0;
      const u = (((X + off) % 16) + 16) % 16;
      const v = ((Y % 16) + 16) % 16;
      const id = hash(Math.floor((X + off) / 16), row, 1600);
      const n = fbm(X, Y, 12, 1601);
      let col = tone(
        OBS_FLOOR,
        0.3 +
          (n - 0.5) * 0.5 +
          id * 0.22 +
          dith(X, Y) * 0.12 -
          (u + v) * 0.006 -
          (id > 0.9 ? 0.2 : 0),
      );
      if (id < 0.07) {
        // Редкая плита со звездой-инкрустацией: приглушённое серебро в лазури —
        // не спорит с золотыми метками звездопада и блеском добычи.
        const dx = u - 7.5;
        const dy = v - 7.5;
        const r = Math.hypot(dx, dy);
        const a = Math.atan2(dy, dx);
        if (r < 1.4) col = mixc(col, IVORY[2], 0.55);
        else if (r < 2 + 3.4 * Math.pow(Math.abs(Math.cos(a * 2)), 6))
          col = mixc(col, dx + dy < 0 ? IVORY[1] : LAPIS[2], 0.45);
        else if (Math.abs(r - 6) < 0.5) col = mixc(col, LAPIS[1], 0.5);
      }
      if (u === 0 || v === 0) col = BRASS[0];
      else if (u === 1 || v === 1) col = mixc(col, OBS_FLOOR[3], 0.35);
      p.set(x, y, col);
    }
}

/** Звёздная карта: эмаль неба в каменных плитах — звёзды нарисованы, не горят. */
function chartFloor(p: Px, c: CellCtx, node: boolean): void {
  const X0 = c.wx * TS;
  const Y0 = c.wy * TS;
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const Y = Y0 + y;
      const n = fbm(X, Y, 30, 1610);
      let col = tone(
        tn('#141e4c', '#1c2a62', '#26387a', '#344a96'),
        0.25 + (n - 0.5) * 0.7 + dith(X, Y) * 0.15,
      );
      const h = hash(X, Y, 1611);
      if (h < 0.006) col = IVORY[3];
      else if (h < 0.01) col = GOLD[2];
      // Швы плит эмали — латунь, каждые 32 точки; сетка координат — тоньше.
      const u = ((X % 32) + 32) % 32;
      const v = ((Y % 32) + 32) % 32;
      if (u === 0 || v === 0) col = BRASS[1];
      else if (u === 16 || v === 16) col = mixc(col, BRASS[2], 0.3);
      p.set(x, y, col);
    }
  if (node) {
    // Узел созвездия: латунное кольцо, в нём огранённый камень.
    p.ell(8, 8, 5.5, 5.5, BRASS[1]);
    p.ell(8, 8, 4.5, 4.5, (x, y) => tone(BRASS, 0.5 - (x + y - 16) * 0.05));
    p.ell(8, 8, 3.5, 3.5, LAPIS[0]);
    poly(
      p,
      [
        [8, 5],
        [11, 8],
        [8, 11],
        [5, 8],
      ],
      (x, y) => tone(CRYST, 0.8 - (x - 5 + y - 5) * 0.06),
    );
    p.set(7, 6, WHITE);
  }
}

/** Латунное кольцо в полу. */
function brassFloor(p: Px, c: CellCtx): void {
  const X0 = c.wx * TS;
  const Y0 = c.wy * TS;
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const Y = Y0 + y;
      // Латунные плиты по клеткам: фаска, шлифовка, гравировка дуг, заклёпки, патина.
      const streak = (hash(0, Y, 1621) - 0.5) * 0.12;
      const sheen = Math.sin((X - Y) * 0.06) * 0.1;
      let col = tone(BRASS, 0.5 + streak + sheen + dith(X, Y) * 0.06);
      const R = Math.hypot((((X % 96) + 96) % 96) - 48, (((Y % 96) + 96) % 96) - 48);
      if (Math.abs(R - 30) < 0.6 || Math.abs(R - 40) < 0.5) col = BRASS[1];
      if (x === 0 || y === 0) col = BRASS[3];
      else if (x === TS - 1 || y === TS - 1) col = BRASS[0];
      else if (x === 1 || y === 1) col = mixc(col, BRASS[3], 0.3);
      if ((x === 2 || x === TS - 3) && (y === 2 || y === TS - 3)) col = BRASS[0];
      if ((x === 2 || x === TS - 3) && (y === 1 || y === TS - 4)) col = BRASS[3];
      const pat = fbm(X, Y, 22, 1622);
      if (pat > 0.66 && x > 0 && y > 0)
        col = mixc(col, hx('#3c8a78'), Math.min(0.7, (pat - 0.66) * 4));
      p.set(x, y, col);
    }
}

/** Ковровая дорожка: фиолет с золотой каймой по краям. */
function runnerFloor(p: Px, c: CellCtx): void {
  const X0 = c.wx * TS;
  const Y0 = c.wy * TS;
  const edgeL = c.markAt(-1, 0) !== MK.runner;
  const edgeR = c.markAt(1, 0) !== MK.runner;
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const Y = Y0 + y;
      const n = vnoise(X, Y, 2, 1630);
      let col = tone(tn('#1e0c32', '#2e124a', '#401c62', '#5e2c86'), 0.35 + (n - 0.5) * 0.35);
      const u = (((X % 12) + 12) % 12) - 6;
      const v = (((Y % 12) + 12) % 12) - 6;
      if (Math.abs(u) + Math.abs(v) === 4) col = mixc(col, GOLD[1], 0.6);
      if (Math.abs(u) + Math.abs(v) === 0) col = GOLD[2];
      if (edgeL && x < 3) col = x === 1 ? GOLD[2] : GOLD[0];
      if (edgeR && x > 12) col = x === 14 ? GOLD[2] : GOLD[0];
      p.set(x, y, col);
    }
}

/** Мозаика купола: лазурь, слоновая кость, золото — круги и лучи. */
function mosaicFloor(p: Px, c: CellCtx): void {
  // Купольная мозаика: лазурь, круги серебра и слоновой кости — без золота,
  // чтобы золотые метки звездопада читались на ней с первого взгляда.
  const X0 = c.wx * TS;
  const Y0 = c.wy * TS;
  const SILVER = tn('#3a4466', '#56628a', '#7c88ac', '#a8b2cc');
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const Y = Y0 + y;
      const grout = ((X % 3) + 3) % 3 === 2 || ((Y % 3) + 3) % 3 === 2;
      const cx = (((X % 64) + 64) % 64) - 32;
      const cy = (((Y % 64) + 64) % 64) - 32;
      const r = Math.hypot(cx, cy);
      const h = hash(Math.floor(X / 3), Math.floor(Y / 3), 1640);
      let col: RGBA;
      if (r > 27 && r < 29.5) col = tone(SILVER, 0.2 + h * 0.4);
      else if (r < 5) col = tone(IVORY, 0.2 + h * 0.4);
      else if (Math.abs(Math.sin(Math.atan2(cy, cx) * 4)) < 0.1 && r < 27 && r > 7)
        col = tone(SILVER, 0.1 + h * 0.3);
      else col = tone(LAPIS, 0.3 + h * 0.45 + dith(X, Y) * 0.1);
      if (grout) col = mixc(col, INK, 0.4);
      p.set(x, y, col);
    }
}

/** Стена Обсерватории: тёмный верх кладки, лицо — тёсаный камень, латунный пояс; окно в небо. */
function obsWall(p: Px, c: CellCtx, window: boolean): void {
  const X0 = c.wx * TS;
  const Y0 = c.wy * TS;
  const face = c.open(0, 1);
  const capH = face ? 6 : 16;
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const Y = Y0 + y;
      let col: RGBA;
      if (y < capH) {
        const row = Math.floor(Y / 8);
        const off = row % 2 ? 6 : 0;
        const u = (((X + off) % 12) + 12) % 12;
        col = tone(
          OBS_CAP,
          0.3 + hash(Math.floor((X + off) / 12), row, 1650) * 0.35 + dith(X, Y) * 0.1,
        );
        if (u === 0 || ((Y % 8) + 8) % 8 === 0) col = OBS_CAP[0];
      } else {
        const yy = y - capH;
        const row = Math.floor(yy / 4);
        const off = (row + c.wy) % 2 ? 5 : 0;
        const u = (((X + off) % 10) + 10) % 10;
        col = tone(
          OBS_FACE,
          0.5 +
            hash(Math.floor((X + off) / 10), row + c.wy * 4, 1651) * 0.3 -
            yy * 0.035 +
            dith(X, Y) * 0.1,
        );
        if (yy % 4 === 3 || u === 0) col = OBS_FACE[0];
        if (yy < 2) col = yy === 0 ? BRASS[3] : BRASS[1];
        if (y === 15) col = mixc(col, INK, 0.5);
      }
      p.set(x, y, col);
    }
  capRim(p, c, OBS_FACE[2], capH);
  if (face && window) {
    const cx = 8;
    const cy = 11;
    for (let y = 6; y < 16; y++)
      for (let x = 2; x < 14; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d < 3.8) {
          const n = fbm(X0 + x, Y0 + y, 10, 1652);
          p.set(x, y, ramp([hx('#05031a'), hx('#1a1050'), hx('#3a2080')], n));
          if (hash(X0 + x, Y0 + y, 1653) < 0.1) p.set(x, y, STAR_C);
        } else if (d < 5) p.set(x, y, tone(BRASS, (cy - y) / 6 + 0.45));
      }
  }
}

/** Звёздная дверь: закрыта — плита лазури с созвездием-замком, открыта — золотой порог. */
function doorPx(p: Px, c: CellCtx, open: boolean): void {
  if (open) {
    slabFloor(p, c);
    for (let x = 0; x < TS; x++) {
      p.set(x, 7, GOLD[2]);
      p.set(x, 8, GOLD[1]);
    }
    return;
  }
  const X0 = c.wx * TS;
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const n = vnoise(X0 + x, y, 6, 1660);
      let col = tone(LAPIS, 0.35 + n * 0.4 + dith(X0 + x, y) * 0.1);
      if (y < 2) col = BRASS[y ? 2 : 3];
      if (y > 13) col = BRASS[0];
      p.set(x, y, col);
    }
  const s = ((c.wx * 7) % 5) + 3;
  sparkle(p, s + 2, 6, STAR_C, 1);
  sparkle(p, 12 - (s % 4), 10, hx('#a8c8ff'), 1);
  stroke(p, s + 2, 6, 12 - (s % 4), 10, alpha(GOLD[3], 0.6));
}

// --- Пояс орбит --------------------------------------------------------------

/** Реголит: серо-фиолетовая пыль с кратерами. */
function regolith(p: Px, c: CellCtx): void {
  const X0 = c.wx * TS;
  const Y0 = c.wy * TS;
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const Y = Y0 + y;
      const n = fbm(X, Y, 18, 1700);
      const v = voronoi(X, Y, 11, 1701);
      let l = (n - 0.5) * 0.7 + 0.42 + dith(X, Y) * 0.14;
      if (v.id < 0.35 && v.d1 < 0.34) {
        const k = v.d1 / 0.34;
        l += k > 0.8 ? (v.ox * LX + v.oy * LY) * -1.5 : -0.35 * (1 - k);
      }
      p.set(x, y, hash(X, Y, 1702) < 0.006 ? hx('#a8a2c0') : tone(REG, l));
    }
}

/** Причал: латунный настил; к пустоте — борт. */
function dockFloor(p: Px, c: CellCtx): void {
  const X0 = c.wx * TS;
  const Y0 = c.wy * TS;
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const Y = Y0 + y;
      const plank = ((Y % 5) + 5) % 5;
      let col = tone(
        tn('#2a1e10', '#4a3618', '#6a5024', '#8a6c34'),
        0.35 + vnoise(X, Y, 6, 1710) * 0.4 + dith(X, Y) * 0.1,
      );
      if (plank === 0) col = hx('#1a120a');
      if ((((X % 16) + 16) % 16 === 3 || ((X % 16) + 16) % 16 === 12) && plank === 2)
        col = BRASS[3];
      p.set(x, y, col);
    }
  const voidAt = (dx: number, dy: number) => {
    const m = c.markAt(dx, dy);
    return !c.open(dx, dy) || m === MK.lane || m === MK.void || m === MK.island;
  };
  for (let i = 0; i < TS; i++) {
    if (voidAt(0, -1)) p.set(i, 0, BRASS[3]);
    if (voidAt(0, 1)) {
      p.set(i, 14, BRASS[2]);
      p.set(i, 15, BRASS[0]);
    }
    if (voidAt(-1, 0)) p.set(0, i, BRASS[2]);
    if (voidAt(1, 0)) p.set(15, i, BRASS[1]);
  }
}

/** Световой мост: над пустотой — полупрозрачные светящиеся плиты. */
function bridgePx(p: Px, c: CellCtx): void {
  spacePx(p, c.wx, c.wy, 0.8);
  const Y0 = c.wy * TS;
  const vert = c.markAt(0, -1) === MK.bridge || c.markAt(0, 1) === MK.bridge;
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const along = vert ? Y0 + y : c.wx * TS + x;
      const seam = ((along % 6) + 6) % 6 === 0;
      p.set(x, y, alpha(seam ? hx('#bff8ff') : hx('#3ab8d0'), seam ? 0.75 : 0.42));
    }
  const rail = (side: 'l' | 'r' | 't' | 'b') => {
    for (let i = 0; i < TS; i++) {
      const [x, y] =
        side === 'l' ? [0, i] : side === 'r' ? [15, i] : side === 't' ? [i, 0] : [i, 15];
      p.set(x, y, hx('#e0ffff'));
    }
  };
  if (!c.open(-1, 0) || c.markAt(-1, 0) === MK.void) rail('l');
  if (!c.open(1, 0) || c.markAt(1, 0) === MK.void) rail('r');
  if (c.markAt(0, -1) === MK.void) rail('t');
  if (c.markAt(0, 1) === MK.void) rail('b');
}

/** Стена Пояса: глыба астероида. */
function asteroidWall(p: Px, c: CellCtx): void {
  const X0 = c.wx * TS;
  const Y0 = c.wy * TS;
  const face = c.open(0, 1);
  const capH = face ? 6 : 16;
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const Y = Y0 + y;
      const v = voronoi(X, Y, 8, 1720);
      let col: RGBA;
      if (y < capH) {
        const l = -(v.ox * LX + v.oy * LY) * 0.8 + 0.15 + dith(X, Y) * 0.1;
        col =
          v.d2 - v.d1 < 0.07
            ? hx('#0a0606')
            : tone(tn('#0c0808', '#181212', '#261e1c', '#3a2e2a'), l);
      } else {
        const l = 0.6 - (y - capH) * 0.05 - (v.ox * LX + v.oy * LY) * 0.6 + dith(X, Y) * 0.1;
        col = y === capH ? METEOR[3] : tone(METEOR, l);
        if (y === 15) col = mixc(col, INK, 0.5);
      }
      p.set(x, y, col);
    }
  capRim(p, c, METEOR[2], capH);
}

function cellOf(area: string) {
  const rootish = (q: Px, cc: CellCtx) => rootFloor(q, cc, false);
  const baseOf = area === F15_OBS ? slabFloor : area === F15_ORBIT ? regolith : rootish;
  return (c: CellCtx): Px | null => {
    const mk = c.mark;
    const p = new Px(TS, TS);
    if (c.tile === T_DEEP) {
      if (mk === MK.core) corePx(p);
      else if (mk === MK.pit) {
        const at = craterAt(c);
        if (at) craterPx(p, c, at, baseOf);
        else chasmPx(p, c);
      } else if (mk === MK.lane || mk === MK.island) spacePx(p, c.wx, c.wy, 1, ringFor(c) ?? false);
      else if (mk === MK.vortex) spacePx(p, c.wx, c.wy);
      else if (area === F15_ROOTS && mk !== MK.void) chasmPx(p, c);
      else {
        spacePx(p, c.wx, c.wy);
        // Под краем пола — его толща: уступ уходит в пустоту, снизу свет левитации.
        if (solidFloorAt(c, 0, -1))
          ledgeFace(p, c, area === F15_ORBIT ? REG : area === F15_OBS ? OBS_FACE : ROOT_FACE);
      }
      return p;
    }
    if (!c.open(0, 0)) {
      if (mk === MK.seal) sealPx(p, c);
      else if (mk === MK.door) doorPx(p, c, false);
      else if (mk === MK.xwall || mk === MK.memory) rockWall(p, c, true);
      else if (mk === MK.obswall || mk === MK.window || area === F15_OBS)
        obsWall(p, c, mk === MK.window);
      else if (area === F15_ORBIT) asteroidWall(p, c);
      else rockWall(p, c, false);
      return p;
    }
    switch (mk) {
      case MK.xfloor:
        xFloor(p, c);
        break;
      case MK.grit:
        gritFloor(p, c);
        break;
      case MK.vein:
        veinFloor(p, c);
        break;
      case MK.rim: {
        // Кайма кратера осколка тоже рисует его воронку: круг шире креста ямы.
        const at = craterAt(c);
        if (at) craterPx(p, c, at, baseOf);
        else rimFloor(p, c, area === F15_OBS, baseOf);
        break;
      }
      case MK.float:
        floatFloor(p, c, baseOf);
        break;
      case MK.heavy:
        heavyFloor(p, c, baseOf);
        break;
      case MK.chart:
        chartFloor(p, c, false);
        break;
      case MK.node:
        chartFloor(p, c, true);
        break;
      case MK.brass:
        brassFloor(p, c);
        break;
      case MK.runner:
        runnerFloor(p, c);
        break;
      case MK.mosaic:
        mosaicFloor(p, c);
        break;
      case MK.doorOpen:
        doorPx(p, c, true);
        break;
      case MK.dock:
        dockFloor(p, c);
        break;
      case MK.bridge:
        bridgePx(p, c);
        return p;
      case MK.island:
        // Остров рисует кольцо целиком (плавно едет); клетка — пустота.
        spacePx(p, c.wx, c.wy, 1, ringFor(c) ?? false);
        return p;
      default:
        baseOf(p, c);
    }
    wallShade(p, c);
    return p;
  };
}

registerCellPainter(F15_ROOTS, cellOf(F15_ROOTS));
registerCellPainter(F15_OBS, cellOf(F15_OBS));
registerCellPainter(F15_ORBIT, cellOf(F15_ORBIT));

// ---------------------------------------------------------------------------
// Предметы. Кадры живых — по корзинам времени, всё в кеше с вытеснением.
// ---------------------------------------------------------------------------

const SPR = frameLRU<Sprite | null>(900);

function sprite(key: string, build: () => { p: Px; ax: number; ay: number } | null): Sprite | null {
  const hit = SPR.get(key);
  if (hit !== undefined) return hit;
  const b = build();
  return SPR.set(key, b ? { img: b.p.canvas(), ax: b.ax, ay: b.ay } : null);
}

const stNow = () => {
  const s = paintSim();
  return s ? (f15State(s) ?? null) : null;
};

/** Кристалл-призма: основание (bx, by), ширина, высота, наклон вершины. */
function crystal(
  p: Px,
  bx: number,
  by: number,
  w: number,
  h: number,
  lean: number,
  t: Tones,
  glowK = 0,
): void {
  const tipX = bx + lean;
  const tipY = by - h;
  const sh = h * 0.72;
  const ls: [number, number] = [bx - w / 2 + lean * 0.72, by - sh];
  const rs: [number, number] = [bx + w / 2 + lean * 0.72, by - sh];
  const mid: [number, number] = [bx + w * 0.08 + lean * 0.72, by - sh + 0.5];
  // Левая грань (на свету), правая (в тени), шапка — две грани к вершине.
  facet(p, [[bx - w / 2, by], ls, mid, [bx + w * 0.08, by]], t, -0.8, 0.1, 0.05);
  facet(p, [[bx + w * 0.08, by], mid, rs, [bx + w / 2, by]], t, 0.9, 0.1, -0.05);
  facet(p, [ls, [tipX, tipY], mid], t, -0.6, -0.8, 0.15);
  facet(p, [mid, [tipX, tipY], rs], t, 0.5, -0.7, 0);
  // Ребро и блик.
  stroke(p, bx + w * 0.08, by - 0.5, mid[0], mid[1], alpha(t[3], 0.7));
  stroke(p, mid[0], mid[1], tipX, tipY + 0.5, alpha(WHITE, 0.55));
  if (glowK > 0) {
    // Свет внутри: полоса вдоль оси.
    for (let i = 0; i < h * 0.8; i++) {
      const k = i / h;
      p.set(bx + lean * k - 0.5, by - 1 - i, alpha(WHITE, glowK * (0.6 - k * 0.5)));
    }
  }
}

/** Латунная стойка-тренога. */
function tripod(p: Px, cx: number, top: number, bot: number, spread: number): void {
  stroke(p, cx, top, cx - spread, bot, BRASS[1]);
  stroke(p, cx, top, cx + spread, bot, BRASS[0]);
  stroke(p, cx + 0.5, top, cx + 0.5, bot - 1, BRASS[2]);
  p.set(cx - spread, bot, BRASS[3]);
  p.set(cx + spread, bot, BRASS[2]);
}

/** Тень на полу под предметом. */
function floorShadow(p: Px, cx: number, cy: number, rx: number, ry: number, k = 0.4): void {
  p.ell(cx, cy, rx, ry, (x, y) => {
    const d = Math.hypot((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry);
    return alpha(hx('#000000'), k * (1 - d * d));
  });
}

/** Осколок звезды над ядром колодца: висит, крутится; тянет колодец — ярче. */
registerPropPainter('f15_core', (o, time) => {
  const st = stNow();
  const w = st?.wells.find(
    (q) => Math.abs(q.x - o.x - 0.5) < 1.2 && Math.abs(q.y - o.y - 0.5) < 1.2,
  );
  const s = w ? w.state : 0;
  const push = w && w.mode < 0 ? 1 : 0;
  const f = Math.floor(time * (s === 2 ? 14 : 7)) % 12;
  return sprite(`core|${s}|${push}|${f}`, () => {
    const p = new Px(26, 40);
    const cx = 13;
    const bob = Math.sin((f / 12) * TAU) * 1.5;
    const cy = 20 + bob;
    const col = push ? VIOLET : CRYST;
    const g = push ? VIOLET_GLOW : TEAL_GLOW;
    glow(p, cx, cy, s === 2 ? 12 : s === 1 ? 10 : 8, g, s === 2 ? 0.75 : 0.5);
    glow(p, cx, cy, 5, WHITE, s === 2 ? 0.8 : 0.45);
    // Ромб-кристалл: восемь граней, поворот по кадру.
    const rot = (f / 12) * PI;
    const R = 4.5;
    const H = 8;
    for (let i = 0; i < 4; i++) {
      const a0 = rot + (i * PI) / 2;
      const a1 = a0 + PI / 2;
      const x0 = cx + Math.cos(a0) * R;
      const x1 = cx + Math.cos(a1) * R;
      const front = Math.sin(a0 + PI / 4) > 0;
      if (!front) continue;
      const l = Math.cos(a0 + PI / 4 + 0.7);
      poly(
        p,
        [
          [x0, cy + Math.sin(a0) * 1.2],
          [cx, cy - H],
          [x1, cy + Math.sin(a1) * 1.2],
        ],
        tone(col, 0.45 + l * 0.45),
      );
      poly(
        p,
        [
          [x0, cy + Math.sin(a0) * 1.2],
          [cx, cy + H * 0.8],
          [x1, cy + Math.sin(a1) * 1.2],
        ],
        tone(col, 0.15 + l * 0.4),
      );
    }
    p.set(cx, cy - H + 1, WHITE);
    p.set(cx - 1, cy - 2, WHITE);
    p.set(cx, cy - 3, alpha(WHITE, 0.8));
    // Искры по орбите.
    for (let i = 0; i < 3; i++) {
      const a = (f / 12) * TAU * (s === 2 ? -1 : 1) + (i * TAU) / 3;
      sparkle(
        p,
        cx + Math.cos(a) * 9,
        cy + Math.sin(a) * 3.5,
        s ? WHITE : alpha(g, 0.8),
        s === 2 ? 1 : 0,
      );
    }
    return { p, ax: cx, ay: 34 };
  });
});

/** Большой осколок Пробуждения: друза в рост, внутри медленно бьётся свет. */
registerPropPainter('f15_bigshard', (o, time) => {
  const st = stNow();
  const hall = st?.halls.find((h) => h.name === 'awaken');
  const run = hall?.state === 'run' ? 1 : hall?.state === 'done' ? 2 : 0;
  const f = Math.floor(time * (run === 1 ? 8 : 3)) % 8;
  return sprite(`bigshard|${run}|${f}`, () => {
    const p = new Px(48, 64);
    const cx = 24;
    const by = 58;
    const pulse = 0.5 + 0.5 * Math.sin((f / 8) * TAU);
    glow(
      p,
      cx,
      by - 22,
      22,
      run === 2 ? hx('#7ab0c0') : TEAL_GLOW,
      0.25 + pulse * 0.25 * (run === 2 ? 0.3 : 1),
    );
    const t = run === 2 ? tn('#1a2a3a', '#2a4a5a', '#4a7a8a', '#9ac8d0') : CRYST;
    crystal(p, cx - 11, by, 8, 26, -5, t, 0.3);
    crystal(p, cx + 12, by, 9, 30, 6, t, 0.3);
    crystal(p, cx + 5, by + 1, 7, 18, 3, VIOLET, 0.2);
    crystal(p, cx, by, 13, 50, 1, t, run === 2 ? 0.1 : 0.4 + pulse * 0.5);
    crystal(p, cx - 5, by + 2, 6, 14, -3, VIOLET, 0.2);
    if (run !== 2) {
      // Сердцевина светится толчками.
      glow(p, cx + 1, by - 26, 6 + pulse * 3, WHITE, 0.5 + pulse * 0.4);
      for (let i = 0; i < 4; i++) {
        const a = (f / 8) * TAU + i * 1.57;
        p.set(cx + Math.cos(a) * 14, by - 26 + Math.sin(a) * 18, alpha(TEAL_GLOW, 0.8));
      }
    } else {
      // После события — трещина и тусклый блеск.
      stroke(p, cx - 2, by - 40, cx + 3, by - 24, hx('#0a1420'));
      stroke(p, cx + 3, by - 24, cx - 1, by - 12, hx('#0a1420'));
    }
    p.outline(alpha(INK, 0.8));
    return { p, ax: cx, ay: by + 2 };
  });
});

/** Значок мотива в кристалле памяти: что за этаж помнит камень. */
function motifGlyph(p: Px, cx: number, cy: number, motif: number, c: RGBA): void {
  switch (MOTIFS[motif]) {
    case 'rat': // Крыса: тельце, ухо, хвост.
      p.ell(cx, cy + 0.5, 2.5, 1.5, c);
      p.set(cx + 2, cy - 1, c);
      stroke(p, cx - 2, cy + 1, cx - 4, cy - 1, c);
      break;
    case 'shroom': // Гриб: шляпка и ножка.
      p.ell(cx, cy - 0.5, 2.8, 1.6, c);
      p.rect(cx - 0.5, cy, cx + 0.5, cy + 2.5, c);
      break;
    case 'lava': // Язык пламени.
      p.ell(cx, cy + 1, 2, 1.6, c);
      stroke(p, cx - 1, cy, cx, cy - 3, c);
      stroke(p, cx + 1, cy, cx + 1, cy - 1.5, c);
      break;
    case 'mirror': // Зеркало: овал в раме.
      for (let a = 0; a < TAU; a += 0.4) p.set(cx + Math.cos(a) * 2, cy + Math.sin(a) * 3, c);
      p.set(cx - 0.5, cy - 1, c);
      break;
    case 'sky': // Крыло.
      stroke(p, cx - 3, cy + 1, cx, cy - 2, c);
      stroke(p, cx, cy - 2, cx + 3, cy + 1, c);
      stroke(p, cx - 2, cy + 1, cx + 2, cy + 1, c);
      break;
    default: // Часы: круг и стрелки.
      for (let a = 0; a < TAU; a += 0.45) p.set(cx + Math.cos(a) * 2.6, cy + Math.sin(a) * 2.6, c);
      stroke(p, cx, cy, cx, cy - 2, c);
      stroke(p, cx, cy, cx + 1.5, cy, c);
  }
}

/** Кристалл памяти в стене: внутри — тень былого этажа; перед выпуском разгорается. */
registerPropPainter('f15_memory', (o, time) => {
  const st = stNow();
  const mem = st?.mems.find((m) => m.x === o.x && m.y === o.y);
  const motif = mem?.motif ?? (o.x + o.y) % 6;
  const used = mem?.used ? 1 : 0;
  const g = mem ? Math.min(3, Math.floor(mem.glow * 4)) : 0;
  const f = Math.floor(time * 4 + o.x) % 6;
  return sprite(`mem|${motif}|${used}|${g}|${used ? 0 : f}`, () => {
    // Кристалл в лице стены: большая призма в оправе породы, внутри —
    // знак этажа, который он помнит. Перед выпуском эха разгорается.
    const p = new Px(26, 32);
    const cx = 13;
    const by = 30;
    const shimmer = 0.5 + 0.5 * Math.sin((f / 6) * TAU);
    const t = used ? tn('#1a1430', '#2a2048', '#3a3060', '#5a5080') : VIOLET;
    if (!used) glow(p, cx, by - 13, 12 + g * 1.5, VIOLET_GLOW, 0.22 + g * 0.12 + shimmer * 0.06);
    // Оправа: обломки породы у основания.
    p.ell(cx, by - 1, 10, 3, STONE[0]);
    p.ell(cx - 1, by - 2, 8.5, 2.2, STONE[1]);
    crystal(p, cx - 6, by - 1, 5, 11, -3, t, used ? 0 : 0.2);
    crystal(p, cx + 6, by - 1, 5, 13, 3, t, used ? 0 : 0.2);
    crystal(p, cx, by, 10, 26, 0.5, t, used ? 0 : 0.35 + g * 0.1);
    if (!used) {
      motifGlyph(p, cx, by - 13, motif, alpha(hx('#fff4ff'), 0.6 + g * 0.13));
      if (g >= 2)
        for (let i = 0; i < 4; i++)
          sparkle(
            p,
            cx + Math.cos(i * 1.57 + f) * 9,
            by - 13 + Math.sin(i * 1.57 + f) * 9,
            WHITE,
            1,
          );
    } else {
      stroke(p, cx - 2, by - 22, cx + 2, by - 14, INK);
      stroke(p, cx + 2, by - 14, cx - 1, by - 6, INK);
      motifGlyph(p, cx, by - 13, motif, alpha(hx('#6a5a90'), 0.4));
    }
    edge(p, alpha(INK, 0.85));
    return { p, ax: cx, ay: by + 1 };
  });
});

/** Кристальная лампа на латунной ножке: погашена — тёмный камень, зажжена — свет. */
registerPropPainter('f15_lamp', (o, time) => {
  const st = stNow();
  const l = st?.lamps.find((q) => q.obj === o);
  const lit = l?.lit ? 1 : 0;
  const fresh = l && lit && (paintSim()?.time ?? 0) - l.t < 0.5 ? 1 : 0;
  const f = lit ? Math.floor(time * 6 + o.x) % 8 : 0;
  return sprite(`lamp|${lit}|${fresh}|${f}`, () => {
    const p = new Px(18, 30);
    const cx = 9;
    floorShadow(p, cx, 27, 5, 1.8);
    // Подставка: латунная ножка, чаша-коронка.
    p.ell(cx, 26.5, 4, 1.6, BRASS[0]);
    p.ell(cx, 26, 3.4, 1.2, BRASS[2]);
    limb(p, cx, 26, cx, 15, 1.1, 0.9, BRASS);
    p.ell(cx, 15, 3.6, 1.4, BRASS[1]);
    for (let i = -3; i <= 3; i += 2) stroke(p, cx + i, 15, cx + i * 1.3, 11, BRASS[2]);
    const fl = 0.85 + 0.15 * Math.sin((f / 8) * TAU * 2);
    if (lit) {
      glow(p, cx, 8, 9, TEAL_GLOW, 0.45 * fl + fresh * 0.3);
      crystal(p, cx, 15, 6, 13, 0, CRYST, 0.9);
      glow(p, cx, 8, 3.5, WHITE, 0.7 * fl);
      sparkle(p, cx + Math.round(Math.sin(f) * 4), 2 + (f % 3), WHITE, fresh);
    } else crystal(p, cx, 15, 6, 13, 0, tn('#0c1428', '#16243e', '#22385a', '#3a5a80'), 0);
    p.outline(alpha(INK, 0.85));
    return { p, ax: cx, ay: 28 };
  });
});

/** Друза: гнездо мелких кристаллов, по граням бегает искра. */
registerPropPainter('f15_druse', (o, time) => {
  const f = Math.floor(time * 3 + o.x * 0.7 + o.y) % 10;
  const v = (o.x * 3 + o.y) % 3;
  return sprite(`druse|${v}|${f}`, () => {
    const p = new Px(20, 18);
    floorShadow(p, 10, 15, 7, 2);
    p.ell(10, 14.5, 7, 2.4, STONE[1]);
    const t = v === 1 ? VIOLET : CRYST;
    const lean = [-3, 2, -1];
    crystal(p, 5, 15, 4, 7, lean[v], t, 0.2);
    crystal(p, 14, 15, 4, 8, 2 - v, v === 2 ? VIOLET : t, 0.2);
    crystal(p, 10, 15.5, 5, 12, lean[(v + 1) % 3] * 0.5, t, 0.5);
    crystal(p, 8, 16, 3, 5, -1, VIOLET, 0.2);
    if (f < 4) sparkle(p, [10, 6, 14, 9][f], [5, 10, 9, 8][f], WHITE, f % 2);
    p.outline(alpha(INK, 0.8));
    return { p, ax: 10, ay: 16 };
  });
});

/** Столп породы с кристальными жилами. */
registerPropPainter('f15_pillar', (o) => {
  const v = (o.x + o.y * 3) % 2;
  return sprite(`pillar|${v}`, () => {
    const p = new Px(20, 44);
    const cx = 10;
    floorShadow(p, cx, 41, 8, 2.2, 0.5);
    for (let y = 4; y < 42; y++) {
      const wv =
        6 +
        Math.sin(y * 0.35 + v) * 0.8 +
        (y > 36 ? (y - 36) * 0.4 : 0) +
        (y < 8 ? (8 - y) * 0.3 : 0);
      for (let x = Math.floor(cx - wv); x <= Math.ceil(cx + wv); x++) {
        const nx = (x + 0.5 - cx) / wv;
        if (Math.abs(nx) > 1) continue;
        const l = nx * LX * 1.4 + 0.42 + (fbm(x * 3, y * 2, 6, 1800 + v) - 0.5) * 0.5;
        p.set(x, y, tone(STONE, l));
      }
    }
    // Жилы кристалла по камню.
    for (let y = 6; y < 40; y++) {
      const x = cx + Math.sin(y * 0.22 + v * 2) * 3.5;
      p.set(x, y, TEAL[2]);
      if (y % 7 === 0) p.set(x + 1, y, WHITE);
    }
    p.ell(cx, 4.5, 6, 2.2, STONE[3]);
    crystal(p, cx - 3, 6, 3, 5, -1, CRYST, 0.3);
    crystal(p, cx + 3, 5, 3, 4, 1, VIOLET, 0.3);
    p.outline(alpha(INK, 0.9));
    return { p, ax: cx, ay: 42 };
  });
});

/** Сталагмит с кристальной вершиной. */
registerPropPainter('f15_stalag', (o) => {
  const v = (o.x * 5 + o.y) % 3;
  return sprite(`stalag|${v}`, () => {
    const p = new Px(14, 26);
    const cx = 7;
    floorShadow(p, cx, 23, 5, 1.6);
    const H = 16 + v * 2;
    for (let y = 24 - H; y < 24; y++) {
      const k = (y - (24 - H)) / H;
      const wv = 0.6 + k * 4.4;
      for (let x = Math.floor(cx - wv); x <= Math.ceil(cx + wv); x++) {
        const nx = (x + 0.5 - cx) / wv;
        if (Math.abs(nx) > 1) continue;
        p.set(x, y, tone(STONE, nx * -0.6 + 0.35 + Math.sin(y * 1.3) * 0.12));
      }
    }
    crystal(p, cx, 24 - H + 5, 3, 6, v - 1, CRYST, 0.5);
    p.outline(alpha(INK, 0.85));
    return { p, ax: cx, ay: 24 };
  });
});

/**
 * Мелкий убор пола (не твёрдый): место внутри клетки — по номеру клетки,
 * чтобы россыпь не стояла по сетке. Холст 24×24, якорь сдвигается.
 */
function floorBit(
  o: WorldObj,
  kind: string,
  n: number,
  build: (p: Px, v: number) => void,
): Sprite | null {
  const h = hash(o.x, o.y, 1590);
  const v = Math.floor(h * n);
  const ox = Math.floor(hash(o.x, o.y, 1591) * 4) * 2 - 3;
  const oy = Math.floor(hash(o.x, o.y, 1592) * 3) * 3 - 3;
  return sprite(`${kind}|${v}|${ox}|${oy}`, () => {
    const p = new Px(24, 24);
    build(p, v);
    // Низ предмета на строке 18 холста; сдвиг oy поднимает его в клетке.
    return { p, ax: 12 - ox, ay: 18 + 4 - oy };
  });
}

/** Ростки кристаллов у стен Корней: два-четыре кристалла и отсвет. */
registerPropPainter('f15_sprout', (o) =>
  floorBit(o, 'sprout', 6, (p, v) => {
    const t = v % 3 === 0 ? VIOLET : v % 3 === 1 ? CRYST : TEAL;
    glow(p, 12, 15, 7, t === VIOLET ? VIOLET_GLOW : TEAL_GLOW, 0.35);
    floorShadow(p, 12, 18, 6, 1.6, 0.35);
    const n = 2 + (v % 3);
    for (let i = 0; i < n; i++) {
      const bx = 12 + (i - (n - 1) / 2) * 3 + (i % 2);
      const hh = (i === Math.floor(n / 2) ? 8 : 4) + ((v + i) % 3);
      crystal(p, bx, 18 - (i % 2), 3, hh, (i - (n - 1) / 2) * 1.2, t, 0.4);
    }
    // Камешки у основания.
    p.ell(8, 18, 1.5, 1, STONE[2]);
    p.ell(16 + (v % 2), 18.5, 1.2, 0.8, STONE[1]);
    if (v > 2) sparkle(p, 12 + (v % 2) * 2, 8 - (v % 3), WHITE, 1);
  }),
);

/** Осколки метеоритов на реголите Пояса: тёмные грани, иногда тлеющий шов. */
registerPropPainter('f15_rubble', (o) =>
  floorBit(o, 'rubble', 6, (p, v) => {
    floorShadow(p, 12, 18, 8, 2, 0.4);
    const rocks: [number, number, number, number][] = [
      [10, 16, 4.5, 3],
      [16, 17, 2.8, 2],
      [6, 18, 2, 1.4],
    ];
    rocks.slice(0, 2 + (v % 2)).forEach(([cx, cy, rx, ry], i) => {
      const s = 1 + ((v + i) % 3) * 0.12;
      // Гранёный камень: верх светлее, низ тёмный.
      p.ell(cx, cy, rx * s, ry * s, (x, y) => {
        const fy = (y + 0.5 - (cy - ry * s)) / (2 * ry * s);
        const fx = (x + 0.5 - cx) / (rx * s);
        const facetK = Math.floor((fx + 1) * 1.5) / 3;
        return tone(METEOR, 0.75 - fy * 0.9 - facetK * 0.2 + hash(x, y, 1593 + v) * 0.1);
      });
    });
    if (v === 1 || v === 4) {
      // Тлеющий шов — тёплый свет из трещины.
      stroke(p, 8, 15, 12, 17, hx('#ff9a40'));
      p.set(10, 16, hx('#ffe0a0'));
    } else if (v === 2) crystal(p, 11, 15, 2, 4, 0.5, CRYST, 0.3);
    p.outline(alpha(INK, 0.7));
  }),
);

/** Сор Обсерватории: свиток, лист звёздной карты, латунная шестерня, линза. */
registerPropPainter('f15_scroll', (o) =>
  floorBit(o, 'scroll', 6, (p, v) => {
    floorShadow(p, 12, 18, 7, 1.6, 0.35);
    const k = v % 4;
    if (k === 0) {
      // Свёрнутый свиток с сургучом.
      for (let x = 6; x <= 17; x++) {
        p.set(x, 15, IVORY[3]);
        p.set(x, 16, IVORY[2]);
        p.set(x, 17, IVORY[1]);
      }
      p.ell(6, 16, 1.4, 1.6, IVORY[0]);
      p.ell(17.5, 16, 1.4, 1.6, IVORY[3]);
      p.set(12, 16, ROSE[2]);
      p.set(12, 17, ROSE[1]);
    } else if (k === 1) {
      // Развёрнутый лист карты неба: созвездие точками.
      poly(
        p,
        [
          [5, 14],
          [17, 13],
          [19, 18],
          [7, 19],
        ],
        (x, y) => mixc(IVORY[2], IVORY[1], hash(x, y, 1594) * 0.5),
      );
      for (const [x, y] of [
        [8, 16],
        [11, 15],
        [14, 16],
        [16, 15],
      ])
        p.set(x, y, LAPIS[2]);
      stroke(p, 8, 16, 11, 15, alpha(LAPIS[1], 0.6));
      stroke(p, 11, 15, 14, 16, alpha(LAPIS[1], 0.6));
    } else if (k === 2) {
      // Латунная шестерня плашмя.
      p.ell(12, 16, 5, 2.8, (x, y) => tone(BRASS, 0.7 - (y - 13) * 0.12));
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        p.set(Math.round(12 + Math.cos(a) * 5.8), Math.round(16 + Math.sin(a) * 3.2), BRASS[2]);
      }
      p.ell(12, 16, 1.6, 0.9, BRASS[0]);
    } else {
      // Выпавшая линза: голубой блик в латунной оправе.
      p.ell(12, 16, 4, 2.4, BRASS[1]);
      p.ell(12, 15.8, 3, 1.7, (x, y) => mixc(CRYST[2], CRYST[3], (16 - y) * 0.3));
      p.set(11, 15, WHITE);
    }
    p.outline(alpha(INK, 0.6));
  }),
);

/** Жеода: камень, на сколе — аметистовое нутро. Бьётся. */
registerPropPainter('f15_geode', (o, _t, _alive, flash) => {
  const v = (o.x + o.y) % 2;
  return sprite(`geode|${v}|${flash ? 1 : 0}`, () => {
    const p = new Px(18, 16);
    floorShadow(p, 9, 13.5, 7, 2);
    shadeEll(p, 9, 9, 7, 5.5, METEOR, 0.05);
    // Скол: тёмный овал, по краю — кристаллы внутрь.
    p.ell(9 + v, 8, 4.2, 3, hx('#1a0c30'));
    for (let a = 0; a < TAU; a += 0.5) {
      const x = 9 + v + Math.cos(a) * 3.4;
      const y = 8 + Math.sin(a) * 2.4;
      p.set(x, y, VIOLET[2 + (Math.sin(a) < 0 ? 1 : 0)]);
      p.set(9 + v + Math.cos(a) * 2.2, 8 + Math.sin(a) * 1.5, VIOLET[1]);
    }
    p.set(8 + v, 7, WHITE);
    glow(p, 9 + v, 8, 3, VIOLET_GLOW, 0.4);
    if (flash) p.tint(WHITE, 0.6);
    p.outline(alpha(INK, 0.9));
    return { p, ax: 9, ay: 14 };
  });
});

/** Обломок упавшей звезды: тёмный камень, трещины ещё тлеют золотом. */
registerPropPainter('f15_rock', (o, time) => {
  const f = Math.floor(time * 5 + o.x) % 8;
  const v = (o.x * 7 + o.y) % 2;
  return sprite(`rock|${v}|${f}`, () => {
    const p = new Px(22, 20);
    const cx = 11;
    floorShadow(p, cx, 17, 8, 2.4, 0.5);
    const pulse = 0.5 + 0.5 * Math.sin((f / 8) * TAU);
    glow(p, cx, 12, 10, hx('#ffb040'), 0.18 + pulse * 0.12);
    // Глыба — гранёная.
    const pts: [number, number][] = v
      ? [
          [3, 16],
          [2, 10],
          [6, 5],
          [12, 4],
          [18, 7],
          [20, 13],
          [17, 17],
          [8, 18],
        ]
      : [
          [2, 15],
          [4, 8],
          [9, 4],
          [15, 5],
          [19, 10],
          [18, 16],
          [11, 18],
        ];
    poly(p, pts, (x, y) => {
      const n = fbm(x * 2, y * 2, 5, 1810 + v);
      return tone(METEOR, (cx - x) * 0.05 + (12 - y) * 0.06 + (n - 0.5) * 0.6 + 0.2);
    });
    // Тлеющие трещины.
    const hot = mixc(hx('#ff8a20'), hx('#fff0a0'), pulse);
    stroke(p, 6, 9, 10, 12, hot);
    stroke(p, 10, 12, 15, 9, hot);
    stroke(p, 10, 12, 11, 16, mixc(hot, hx('#c04010'), 0.4));
    stroke(p, 15, 9, 17, 12, alpha(hot, 0.7));
    // Искра вверх.
    const sy = 8 - f * 1.2;
    if (sy > 0) p.set(cx + Math.sin(f * 1.7) * 3, sy, alpha(hx('#ffe080'), 1 - f / 8));
    p.outline(alpha(INK, 0.9));
    return { p, ax: cx, ay: 18 };
  });
});

/** Причальный якорь: латунный кнехт с кольцом; натянут трос — кольцо горит. */
registerPropPainter('f15_anchor', (o, time) => {
  const st = stNow();
  const tt = st?.tether;
  const on = tt && Math.abs(tt.ax - o.x - 0.5) < 0.8 && Math.abs(tt.ay - o.y - 0.5) < 0.8 ? 1 : 0;
  const f = Math.floor(time * 4) % 4;
  return sprite(`anchor|${on}|${on ? f : 0}`, () => {
    const p = new Px(16, 22);
    const cx = 8;
    floorShadow(p, cx, 19, 6, 2);
    p.ell(cx, 18.5, 5.5, 2, BRASS[0]);
    p.ell(cx, 18, 5, 1.6, BRASS[1]);
    limb(p, cx, 18, cx, 8, 2.6, 2.2, BRASS, 0.05);
    p.ell(cx, 7.5, 3.6, 1.5, BRASS[3]);
    p.ell(cx, 8, 3.6, 1.2, BRASS[2]);
    // Кольцо.
    for (let a = 0; a < TAU; a += 0.25)
      p.set(
        cx + 3 + Math.cos(a) * 2.2,
        12 + Math.sin(a) * 2.6,
        Math.sin(a) < 0 ? BRASS[3] : BRASS[1],
      );
    // Витки троса у основания.
    for (let i = 0; i < 3; i++)
      p.ell(cx, 16 - i * 1.5, 3.2, 0.7, i % 2 ? hx('#7a6a90') : hx('#b0a4c8'));
    if (on) {
      glow(p, cx + 3, 12, 5, TEAL_GLOW, 0.5 + (f % 2) * 0.2);
      sparkle(p, cx + 3, 9 + (f % 2), WHITE, 1);
    }
    p.outline(alpha(INK, 0.85));
    return { p, ax: cx, ay: 20 };
  });
});

/** Рычаг колодца: ручка влево — колодец тянет (бирюза), вправо — толкает (фиолет). */
registerPropPainter('f15_lever', (o) => {
  const st = stNow();
  const w = st?.wells
    .filter((q) => q.kind === 'map' && Math.hypot(q.x - o.x - 0.5, q.y - o.y - 0.5) < 22)
    .sort((a, b) => Math.hypot(a.x - o.x, a.y - o.y) - Math.hypot(b.x - o.x, b.y - o.y))[0];
  const push = w && w.mode < 0 ? 1 : 0;
  return sprite(`lever|${push}`, () => {
    const p = new Px(18, 24);
    const cx = 9;
    floorShadow(p, cx, 21, 6, 2);
    // Тумба: камень с латунной полосой и шкалой «тянет — толкает».
    p.rect(4, 13, 14, 21, STONE[2]);
    p.rect(4, 13, 14, 13, STONE[3]);
    p.rect(13, 14, 14, 21, STONE[1]);
    p.rect(4, 16, 14, 16, BRASS[2]);
    p.set(5, 15, TEAL[2]);
    p.set(13, 15, VIOLET[2]);
    // Ручка.
    const a = push ? 0.55 : -0.55;
    const tx = cx + Math.sin(a) * 9;
    const ty = 13 - Math.cos(a) * 9;
    limb(p, cx, 13, tx, ty, 0.9, 0.8, BRASS);
    shadeEll(p, tx, ty, 2, 2, push ? VIOLET : CRYST, 0.2);
    glow(p, tx, ty, 4, push ? VIOLET_GLOW : TEAL_GLOW, 0.4);
    p.outline(alpha(INK, 0.85));
    return { p, ax: cx, ay: 22 };
  });
});

/** Телескоп на треноге: наведён — из линзы бьёт свет. */
registerPropPainter('f15_telescope', (o, time) => {
  const st = stNow();
  const sc = st?.scopes.find((s) => s.obj === o);
  const what = sc?.what ?? 'door';
  const done =
    what === 'door' ? (st?.doors.some((d) => d.open) ? 1 : 0) : st && st.dark > 0.05 ? 0 : 1;
  const f = Math.floor(time * 4) % 4;
  return sprite(`scope|${what}|${done}|${done ? f : 0}`, () => {
    const p = new Px(28, 30);
    const cx = 13;
    floorShadow(p, cx, 27, 8, 2.2);
    tripod(p, cx, 16, 27, 6);
    // Труба: под углом в небо, раструб — к зрителю.
    const ax = cx - 7;
    const ay = 20;
    const bx = cx + 9;
    const by = 6;
    limb(p, ax, ay, bx, by, 2.6, 1.8, BRASS, 0.05);
    for (const k of [0.25, 0.55, 0.8]) {
      const x = ax + (bx - ax) * k;
      const y = ay + (by - ay) * k;
      p.ell(x, y, 2.4 - k * 0.6, 2.4 - k * 0.6, BRASS[3]);
    }
    p.ell(ax - 0.5, ay + 0.4, 2.4, 2.8, BRASS[0]);
    p.ell(ax - 0.5, ay + 0.4, 1.6, 2, what === 'sun' ? hx('#ffd060') : hx('#7ab8ff'));
    p.set(ax - 1, ay - 0.5, WHITE);
    p.ell(cx, 16, 2, 1.4, BRASS[2]);
    if (done) {
      glow(p, bx + 1, by - 1, 5, what === 'sun' ? GOLDK : TEAL_GLOW, 0.4 + (f % 2) * 0.15);
      sparkle(p, bx + 1, by - 1, WHITE, 1);
    }
    p.outline(alpha(INK, 0.85));
    return { p, ax: cx, ay: 28 };
  });
});

/** Маяк орбиты: латунный столбик, вращается холодный огонь. */
registerPropPainter('f15_beacon', (o, time) => {
  const f = Math.floor(time * 8 + o.x) % 8;
  return sprite(`beacon|${f}`, () => {
    const p = new Px(16, 28);
    const cx = 8;
    floorShadow(p, cx, 25, 5, 1.6);
    p.ell(cx, 24.5, 4, 1.5, BRASS[0]);
    limb(p, cx, 24, cx, 12, 1.4, 1.1, BRASS);
    p.rect(cx - 3, 6, cx + 3, 11, alpha(hx('#bfefff'), 0.35));
    p.rect(cx - 3, 5, cx + 3, 5, BRASS[2]);
    p.rect(cx - 3, 12, cx + 3, 12, BRASS[1]);
    p.ell(cx, 4, 2.4, 1.4, BRASS[3]);
    const a = (f / 8) * TAU;
    const lx = cx + Math.cos(a) * 2;
    glow(p, cx, 8.5, 7, hx('#9ae0ff'), 0.45);
    if (Math.sin(a) > -0.2) {
      glow(p, lx, 8.5, 3, WHITE, 0.95);
      // Луч в сторону вращения.
      for (let i = 2; i < 7; i++)
        p.set(cx + Math.cos(a) * (2 + i), 8.5, alpha(hx('#cff6ff'), 0.6 - i * 0.07));
    } else p.ell(cx, 8.5, 1.5, 1.5, hx('#5ab0e0'));
    p.outline(alpha(INK, 0.8));
    return { p, ax: cx, ay: 26 };
  });
});

// --- Обсерватория ---------------------------------------------------------

/** Колонна: светлый камень с каннелюрами, латунная капитель. */
registerPropPainter('f15_column', () =>
  sprite('column', () => {
    const p = new Px(18, 46);
    const cx = 9;
    floorShadow(p, cx, 43, 8, 2.2, 0.5);
    // База.
    p.rect(2, 39, 16, 43, IVORY[1]);
    p.rect(2, 39, 16, 39, IVORY[3]);
    p.rect(3, 37, 15, 38, IVORY[2]);
    // Ствол с каннелюрами.
    for (let y = 9; y < 37; y++)
      for (let x = 4; x <= 14; x++) {
        const nx = (x + 0.5 - cx) / 5.5;
        let l = nx * LX * 1.6 + 0.5;
        if ((x - 4) % 3 === 2) l -= 0.3;
        p.set(x, y, tone(IVORY, l));
      }
    // Капитель — латунь и звёздочка.
    p.rect(2, 5, 16, 8, BRASS[2]);
    p.rect(2, 5, 16, 5, BRASS[3]);
    p.rect(2, 8, 16, 8, BRASS[0]);
    p.rect(1, 2, 17, 4, IVORY[2]);
    p.rect(1, 2, 17, 2, IVORY[3]);
    sparkle(p, cx, 6, GOLD[3], 0);
    p.outline(alpha(INK, 0.9));
    return { p, ax: cx, ay: 44 };
  }),
);

/** Армиллярная сфера: латунные кольца вращаются вокруг маленькой Земли. */
registerPropPainter('f15_armillary', (o, time) => {
  const f = Math.floor(time * 6 + o.x) % 24;
  return sprite(`armil|${f}`, () => {
    const p = new Px(28, 36);
    const cx = 14;
    const cy = 14;
    floorShadow(p, cx, 33, 8, 2.4);
    // Подставка.
    p.ell(cx, 32.5, 6, 2, BRASS[0]);
    p.ell(cx, 32, 5.4, 1.6, BRASS[2]);
    limb(p, cx, 31, cx, 24, 1.3, 1, BRASS);
    stroke(p, cx - 4, 31, cx, 26, BRASS[1]);
    stroke(p, cx + 4, 31, cx, 26, BRASS[0]);
    const a = (f / 24) * TAU;
    const R = 10;
    // Кольца: экватор (наклон), меридиан (вращается), эклиптика.
    const ringPts = (tilt: number, spin: number, r: number) => {
      const out: [number, number, number][] = [];
      for (let t = 0; t < TAU; t += 0.05) {
        let x = Math.cos(t) * r;
        const y = 0;
        let z = Math.sin(t) * r;
        // Поворот вокруг оси Y на spin, затем наклон вокруг X.
        const x1 = x * Math.cos(spin) + z * Math.sin(spin);
        const z1 = -x * Math.sin(spin) + z * Math.cos(spin);
        x = x1;
        z = z1;
        const y2 = y * Math.cos(tilt) - z * Math.sin(tilt);
        const z2 = y * Math.sin(tilt) + z * Math.cos(tilt);
        out.push([x, y2, z2]);
      }
      return out;
    };
    const rings = [
      { pts: ringPts(1.2, 0, R), c: BRASS },
      { pts: ringPts(0.1, a, R - 1), c: GOLD },
      { pts: ringPts(1.25 - 0.4, a * 0.5 + 1, R - 2), c: BRASS },
    ];
    // Задние половины колец, шар, передние половины.
    for (const rg of rings)
      for (const [x, y, z] of rg.pts) if (z < 0) p.set(cx + x, cy + y, rg.c[1]);
    shadeEll(p, cx, cy, 3.4, 3.4, LAPIS, 0.1);
    p.set(cx - 1, cy - 1, hx('#7ad0a0'));
    p.set(cx + 1, cy, hx('#5ab080'));
    for (const rg of rings)
      for (const [x, y, z] of rg.pts)
        if (z >= 0) p.set(cx + x, cy + y, z > R * 0.5 ? rg.c[3] : rg.c[2]);
    // Ось.
    stroke(p, cx - 2, cy - R - 1, cx + 2, cy + R + 1, alpha(BRASS[3], 0.8));
    p.outline(alpha(INK, 0.7));
    return { p, ax: cx, ay: 34 };
  });
});

/** Оррерий: солнце горит в середине, планеты на спицах идут каждая своим ходом. */
registerPropPainter('f15_orrery', (_o, time) => {
  const f = Math.floor(time * 8) % 48;
  return sprite(`orrery|${f}`, () => {
    const p = new Px(40, 36);
    const cx = 20;
    const cy = 18;
    floorShadow(p, cx, 32, 15, 3.4, 0.5);
    // Стол: круглая латунная столешница в перспективе.
    p.ell(cx, 28, 15, 5, BRASS[0]);
    p.ell(cx, 27, 15, 5, BRASS[1]);
    p.ell(cx, 26.5, 14, 4.4, BRASS[2]);
    for (let a = 0; a < TAU; a += TAU / 24)
      p.set(cx + Math.cos(a) * 13, 26.5 + Math.sin(a) * 4, BRASS[3]);
    limb(p, cx, 26, cx, 18, 1.2, 1, BRASS);
    const t = (f / 48) * TAU;
    const planets = [
      { r: 5, s: 4, c: METEOR, rad: 1.2 },
      { r: 8.5, s: 2, c: ROSE, rad: 1.6 },
      { r: 12, s: 1, c: LAPIS, rad: 2 },
      { r: 15.5, s: -1, c: GOLD, rad: 1.7 },
    ];
    // Орбиты — тонкие латунные кольца, сплюснутые.
    for (const pl of planets)
      for (let a = 0; a < TAU; a += 0.06)
        p.set(cx + Math.cos(a) * pl.r, cy + Math.sin(a) * pl.r * 0.34, alpha(BRASS[2], 0.45));
    const pos = planets.map((pl) => {
      const a = t * pl.s + pl.r;
      return {
        ...pl,
        x: cx + Math.cos(a) * pl.r,
        y: cy + Math.sin(a) * pl.r * 0.34,
        z: Math.sin(a),
      };
    });
    const drawP = (q: (typeof pos)[number]) => {
      stroke(p, cx, cy, q.x, q.y - 2, alpha(BRASS[1], 0.9));
      shadeEll(p, q.x, q.y - 2, q.rad, q.rad, q.c, 0.1);
      if (q.c === GOLD)
        for (let a = 0; a < TAU; a += 0.3)
          p.set(q.x + Math.cos(a) * 3, q.y - 2 + Math.sin(a), alpha(GOLD[3], 0.7));
    };
    for (const q of pos) if (q.z < 0) drawP(q);
    // Солнце.
    glow(p, cx, cy - 2, 9, hx('#ffc040'), 0.5);
    shadeEll(p, cx, cy - 2, 3.2, 3.2, GOLD, 0.35);
    p.set(cx - 1, cy - 3, WHITE);
    for (const q of pos) if (q.z >= 0) drawP(q);
    p.outline(alpha(INK, 0.6));
    return { p, ax: cx, ay: 33 };
  });
});

/** Жаровня: латунная чаша на треноге, в ней — звёздный огонь (бело-голубой с золотом). */
registerPropPainter('f15_brazier', (o, time) => {
  const f = Math.floor(time * 10 + o.x) % 8;
  return sprite(`brazier|${f}`, () => {
    const p = new Px(18, 30);
    const cx = 9;
    floorShadow(p, cx, 27, 6, 2);
    tripod(p, cx, 17, 27, 5);
    // Пламя: языки по кадру.
    glow(p, cx, 10, 10, hx('#ffd080'), 0.35);
    for (let i = 0; i < 3; i++) {
      const ph = ((f + i * 3) % 8) / 8;
      const h = 7 + Math.sin(ph * TAU) * 2 + (i === 1 ? 3 : 0);
      const x0 = cx - 3 + i * 3;
      for (let k = 0; k < h; k++) {
        const kk = k / h;
        const w = (1 - kk) * 1.8;
        const xx = x0 + Math.sin(ph * TAU + kk * 3) * kk * 1.4;
        p.ell(
          xx,
          15 - k,
          w,
          0.7,
          kk < 0.3 ? hx('#ffe8a0') : kk < 0.7 ? hx('#bff4ff') : alpha(hx('#7ad8ff'), 0.8),
        );
      }
    }
    p.set(cx + ((f * 3) % 5) - 2, 3 + (f % 3), alpha(hx('#fff4c0'), 0.8));
    // Чаша.
    p.ell(cx, 16, 6, 2.4, BRASS[1]);
    p.ell(cx, 15.2, 5.2, 1.4, hx('#fff0c0'));
    for (let x = -6; x <= 6; x++) p.set(cx + x, 17 + Math.abs(x) * -0.1 + 1, BRASS[x < 0 ? 2 : 0]);
    p.outline(alpha(INK, 0.8));
    return { p, ax: cx, ay: 28 };
  });
});

/** Небесный глобус: синяя сфера в звёздах, золотой меридиан; медленно вертится. */
registerPropPainter('f15_globe', (o, time) => {
  const f = Math.floor(time * 3 + o.x) % 16;
  return sprite(`globe|${f}`, () => {
    const p = new Px(20, 26);
    const cx = 10;
    const cy = 10;
    const R = 6.5;
    floorShadow(p, cx, 23, 6, 2);
    p.ell(cx, 22.5, 4.5, 1.6, BRASS[0]);
    limb(p, cx, 22, cx, 17, 1.1, 0.9, BRASS);
    const rot = (f / 16) * TAU;
    for (let y = -R; y <= R; y++)
      for (let x = -R; x <= R; x++) {
        const d = Math.hypot(x + 0.5, y + 0.5) / R;
        if (d > 1) continue;
        const nz = Math.sqrt(1 - d * d);
        const nx = (x + 0.5) / R;
        const ny = (y + 0.5) / R;
        const l = nx * LX + ny * LY + nz * LZ;
        let c = tone(LAPIS, l + 0.1);
        // Звёзды на сфере: долгота с поворотом.
        const lon = Math.atan2(nx, nz) + rot;
        const lat = Math.asin(Math.max(-1, Math.min(1, ny)));
        const h = hash(Math.floor(lon * 3), Math.floor(lat * 5), 1820);
        if (h < 0.18 && hash(Math.floor(lon * 7), Math.floor(lat * 9), 1821) < 0.4)
          c = mixc(c, STAR_C, 0.8);
        if (Math.abs(((lon % 1.57) + 1.57) % 1.57) < 0.08) c = mixc(c, GOLD[2], 0.5);
        p.set(cx + x, cy + y, c);
      }
    // Меридиан-оправа.
    for (let a = -PI * 0.85; a < PI * 0.85; a += 0.08)
      p.set(
        cx + Math.sin(a) * (R + 1.2),
        cy - Math.cos(a) * (R + 1.2),
        BRASS[Math.cos(a) > 0 ? 3 : 1],
      );
    p.outline(alpha(INK, 0.8));
    return { p, ax: cx, ay: 24 };
  });
});

/** Пюпитр с атласом неба; страница иногда перелистывается. */
registerPropPainter('f15_lectern', (o, time) => {
  const f = Math.floor(time * 6 + o.x * 5) % 36;
  const turn = f < 6 ? f : 0;
  return sprite(`lect|${turn}`, () => {
    const p = new Px(18, 22);
    const cx = 9;
    floorShadow(p, cx, 19, 6, 2);
    const WOOD = tn('#2a1810', '#4a2c1a', '#6a4428', '#8a6038');
    p.rect(cx - 1, 11, cx + 1, 19, WOOD[2]);
    p.rect(cx + 1, 11, cx + 1, 19, WOOD[1]);
    p.rect(cx - 4, 19, cx + 4, 20, WOOD[1]);
    // Наклонная доска и раскрытая книга.
    poly(
      p,
      [
        [2, 10],
        [16, 10],
        [15, 13],
        [3, 13],
      ],
      WOOD[2],
    );
    poly(
      p,
      [
        [3, 5],
        [9, 6],
        [9, 11],
        [3, 10],
      ],
      IVORY[3],
    );
    poly(
      p,
      [
        [9, 6],
        [15, 5],
        [15, 10],
        [9, 11],
      ],
      IVORY[2],
    );
    // Карта на странице: звёзды и линия.
    sparkle(p, 5, 7, LAPIS[2], 0);
    p.set(7, 8, LAPIS[2]);
    stroke(p, 5, 7, 7, 8, alpha(LAPIS[1], 0.7));
    for (let i = 0; i < 3; i++) p.set(11 + i, 7 + (i % 2), alpha(INK, 0.5));
    if (turn) {
      const k = turn / 6;
      const x = 15 - k * 12;
      poly(
        p,
        [
          [9, 6],
          [x, 5 - Math.sin(k * PI) * 3],
          [x, 10 - Math.sin(k * PI) * 3],
          [9, 11],
        ],
        IVORY[3],
      );
    }
    p.outline(alpha(INK, 0.85));
    return { p, ax: cx, ay: 20 };
  });
});

/** Шкаф с линзами: стеклянные дверцы, внутри блестят приборы. Бьётся. */
registerPropPainter('f15_cabinet', (o, _t, _alive, flash) => {
  const v = (o.x + o.y) % 2;
  return sprite(`cab|${v}|${flash ? 1 : 0}`, () => {
    const p = new Px(18, 28);
    const WOOD = tn('#1e1220', '#3a2238', '#583452', '#7a4c70');
    p.rect(1, 2, 16, 26, WOOD[1]);
    p.rect(1, 2, 16, 3, WOOD[3]);
    p.rect(15, 4, 16, 26, WOOD[0]);
    p.rect(1, 25, 16, 26, WOOD[0]);
    // Стекло: две дверцы.
    for (const x0 of [3, 9]) {
      p.rect(x0, 5, x0 + 5, 23, alpha(hx('#2a3a6a'), 0.9));
      stroke(p, x0 + 1, 22, x0 + 4, 6, alpha(WHITE, 0.25));
    }
    // Полки и предметы: линзы, колба, маленький глобус.
    p.rect(3, 11, 14, 11, BRASS[1]);
    p.rect(3, 17, 14, 17, BRASS[1]);
    shadeEll(p, 5, 9, 1.6, 1.6, CRYST, 0.3);
    shadeEll(p, 12, 9.5, 1.4, 1.4, GOLD, 0.2);
    shadeEll(p, 6 + v * 4, 15, 1.8, 1.8, LAPIS, 0.2);
    p.rect(11 - v * 5, 13, 12 - v * 5, 16, VIOLET[2]);
    shadeEll(p, 8, 21, 2.2, 1.2, BRASS, 0.2);
    p.set(8, 2, BRASS[3]);
    p.set(8, 14, BRASS[3]);
    if (flash) p.tint(WHITE, 0.6);
    p.outline(alpha(INK, 0.9));
    return { p, ax: 9, ay: 27 };
  });
});

/** Статуя звездочёта: фигура в мантии на постаменте держит звезду. */
registerPropPainter('f15_statue', (o, time) => {
  const f = Math.floor(time * 2 + o.x) % 6;
  const v = (o.x * 3 + o.y) % 2;
  return sprite(`statue|${v}|${f}`, () => {
    const p = new Px(24, 50);
    const cx = 12;
    floorShadow(p, cx, 47, 10, 2.4, 0.5);
    // Постамент.
    p.rect(3, 38, 21, 47, IVORY[1]);
    p.rect(3, 38, 21, 39, IVORY[3]);
    p.rect(19, 40, 21, 47, IVORY[0]);
    p.rect(5, 42, 19, 43, BRASS[2]);
    // Мантия: конус складок.
    poly(
      p,
      [
        [cx - 7, 38],
        [cx - 3, 14],
        [cx + 3, 14],
        [cx + 7, 38],
      ],
      (x, y) => {
        const fold = Math.sin((x - cx) * 1.3 + y * 0.08);
        return tone(IVORY, (cx - x) * 0.06 + 0.42 + fold * 0.18);
      },
    );
    // Голова в капюшоне.
    shadeEll(p, cx, 11, 3.2, 3.6, IVORY, 0.05);
    p.ell(cx + 0.5, 12, 1.8, 2, IVORY[0]);
    // Рука поднята: держит звезду (или армиллу).
    const hx0 = v ? cx - 6 : cx + 6;
    limb(p, cx + (v ? -2 : 2), 18, hx0, 6, 1.4, 1.1, IVORY);
    const tw = 0.6 + 0.4 * Math.sin((f / 6) * TAU);
    glow(p, hx0, 3.5, 5, GOLDK, 0.35 * tw + 0.2);
    sparkle(p, hx0, 3, hx('#fff4c0'), 2);
    // Свиток в другой руке.
    p.rect(v ? cx + 2 : cx - 5, 22, v ? cx + 5 : cx - 2, 24, IVORY[3]);
    p.outline(alpha(INK, 0.9));
    return { p, ax: cx, ay: 48 };
  });
});

// --- Пояс орбит -----------------------------------------------------------

/** Плавучий обломок: камень с латунным осколком, медленно кружит в пустоте. */
registerPropPainter('f15_float', (o, time) => {
  const f = Math.floor(time * 3 + o.x * 1.3 + o.y) % 16;
  const v = (o.x * 7 + o.y * 3) % 3;
  return sprite(`float|${v}|${f}`, () => {
    const p = new Px(20, 22);
    const cx = 10;
    const bob = Math.sin((f / 16) * TAU) * 1.5;
    const cy = 10 + bob;
    const rot = (f / 16) * TAU * (v === 1 ? -1 : 1);
    // Неровный камень, поворот вершин.
    const n = 7;
    const pts: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rot;
      const r = 4 + hash(i, v, 1830) * 2.2;
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.8]);
    }
    poly(p, pts, (x, y) => tone(v === 2 ? STONE : METEOR, (cx - x) * 0.08 + (cy - y) * 0.1 + 0.3));
    if (v === 0) {
      // Латунный осколок (обломок прибора).
      poly(
        p,
        [
          [cx + 1, cy - 2],
          [cx + 6, cy - 4],
          [cx + 4, cy + 1],
        ],
        BRASS[2],
      );
      p.set(cx + 4, cy - 3, BRASS[3]);
    } else if (v === 2) crystal(p, cx, cy + 1, 3, 6, 1, CRYST, 0.4);
    // Слабая тень на пустоте — ниже, размытая (он висит высоко).
    p.ell(cx, 20, 4, 1, alpha(hx('#000000'), 0.25));
    p.outline(alpha(INK, 0.7));
    return { p, ax: cx, ay: 20 };
  });
});

/** Пылевой вихрь: фиолетовая спираль пыли крутится над пустотой. */
registerPropPainter('f15_vortex', (_o, time) => {
  const f = Math.floor(time * 10) % 16;
  return sprite(`vortex|${f}`, () => {
    const p = new Px(56, 36);
    const cx = 28;
    const cy = 18;
    glow(p, cx, cy, 18, VIOLET_GLOW, 0.25);
    const rot = (f / 16) * TAU;
    for (let arm = 0; arm < 3; arm++)
      for (let k = 0; k < 70; k++) {
        const r = 1.5 + k * 0.36;
        const a = rot + (arm * TAU) / 3 + k * 0.16;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r * 0.5;
        const c = k < 12 ? WHITE : k < 35 ? hx('#c8a8ff') : hx('#7a56d8');
        p.set(x, y, alpha(c, 1 - k / 80));
        if (k % 9 === 0) p.set(x + 1, y, alpha(c, 0.5));
      }
    glow(p, cx, cy, 3.5, WHITE, 0.8);
    return { p, ax: cx, ay: 27 };
  });
});

// ---------------------------------------------------------------------------
// Общие мелочи рисунка: слой света из ярких пикселей, обводка, сторона, шип.
// ---------------------------------------------------------------------------

type Look = MobPose['look'];

/** Яркие пиксели кадра — слой поверх темноты. */
function litOf(p: Px, thr = 200): Px {
  const q = new Px(p.w, p.h);
  for (let i = 0; i < p.data.length; i += 4) {
    if (p.data[i + 3] < 40) continue;
    const mx = Math.max(p.data[i], p.data[i + 1], p.data[i + 2]);
    const mn = Math.min(p.data[i], p.data[i + 1], p.data[i + 2]);
    if (mx < thr && !(mx > thr - 50 && mx - mn > 90)) continue;
    q.data[i] = p.data[i];
    q.data[i + 1] = p.data[i + 1];
    q.data[i + 2] = p.data[i + 2];
    q.data[i + 3] = Math.round(p.data[i + 3] * 0.85);
  }
  return q;
}

/** Обводка по телу: свечение (полупрозрачное) не обводится. */
function edge(p: Px, c: RGBA): void {
  const solid = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < p.w && y < p.h && p.data[(y * p.w + x) * 4 + 3] >= 200;
  const add: number[] = [];
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      if (p.data[(y * p.w + x) * 4 + 3] >= 100) continue;
      if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) add.push(x, y);
    }
  for (let i = 0; i < add.length; i += 2) p.set(add[i], add[i + 1], c);
}

/** Номер направления 0…n−1 по углу. */
const dirBucket = (a: number, n: number) => ((Math.round((a / TAU) * n) % n) + n) % n;

/** Шип-кристалл от точки (x, y) по углу a, длина L, ширина основания w. */
function spike(
  p: Px,
  x: number,
  y: number,
  a: number,
  L: number,
  w: number,
  t: Tones,
  tip: RGBA = WHITE,
): void {
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const tx = x + ux * L;
  const ty = y + uy * L;
  const lx = x - uy * w * 0.5;
  const ly = y + ux * w * 0.5;
  const rx = x + uy * w * 0.5;
  const ry = y - ux * w * 0.5;
  const lite = -uy * LX + ux * LY;
  poly(
    p,
    [
      [lx, ly],
      [tx, ty],
      [x, y],
    ],
    tone(t, 0.55 - lite * 0.45),
  );
  poly(
    p,
    [
      [x, y],
      [tx, ty],
      [rx, ry],
    ],
    tone(t, 0.35 + lite * 0.45),
  );
  p.set(tx, ty, tip);
}


// ---------------------------------------------------------------------------
// Монстры в объёме (анимации 15). Каждый собран из примитивов мини-3D
// (`f15-rig.ts`) и смотрит в одну из 16 сторон — туда, куда идёт: боком не
// ходит. Шаг — по пройденному пути, техники — 24 к/с от времени режима
// (стоп-кадр их держит), кадр контакта — ровно там, где мозг бьёт. Кадр
// строится раз на позу, сторону и облик и живёт в кеше с вытеснением.
// Состояние рисунка (курс с пределом поворота, путь, прошлый режим) — в
// `WeakMap` по мобу: в `m.data` рисунок не пишет.
// ---------------------------------------------------------------------------

const MF = frameLRU<MobFrame>(2600);
const FPS = 24;
const NDIR = 16;

/** Замер для стенда: сколько кадров монстров построено и за сколько. */
export const F15_MOB_STAT = { n: 0, ms: 0, max: 0, size: () => MF.size };

interface Vis {
  now: number;
  x: number;
  y: number;
  /** Курс рисунка в игровых углах (сглажен пределом поворота). */
  yaw: number;
  /** Пройденный путь, клетки. */
  dist: number;
  /** Скорость поворота курса, рад/с (сглажена) — крен в вираже. */
  yr: number;
  mode: string;
  prev: string;
}
const VIS = new WeakMap<Mob, Vis>();

const angD = (a: number, b: number) => {
  let d = (a - b) % TAU;
  if (d > PI) d -= TAU;
  if (d < -PI) d += TAU;
  return d;
};

/**
 * Прошлый режим для листа кадров: стенд рисует каждый кадр новым мобом и
 * передаёт его номером в `m.data.vSheetPrev` (в игре его помнит `Vis`).
 */
const SHEET_PREV = [
  '',
  'windup',
  'f15_open',
  'aim',
  'f15_charge',
  'f15_dash',
  'f15_cast_well',
  'f15_cast_bolt',
  'f15_dive',
  'f15_gather',
  'f15_lunge',
  'f15_dizzy',
  'f15_roll',
  'f15_snuff',
];

/** Ход моба для рисунка: курс с пределом поворота (рад/с), путь, прошлый режим. */
function visOf(m: Mob, pose: MobPose, want: number, turn: number): Vis {
  let v = VIS.get(m);
  if (!v) {
    const sp = Math.hypot(m.vx, m.vy);
    v = {
      now: pose.now,
      x: m.x,
      y: m.y,
      yaw: want,
      dist: sp * pose.t,
      yr: 0,
      mode: pose.mode,
      prev: SHEET_PREV[m.data.vSheetPrev ?? 0] ?? '',
    };
    VIS.set(m, v);
    return v;
  }
  const dt = Math.max(0, Math.min(0.1, pose.now - v.now));
  if (dt > 0) {
    v.dist += Math.min(Math.hypot(m.x - v.x, m.y - v.y), 1);
    v.x = m.x;
    v.y = m.y;
    v.now = pose.now;
    const mx = turn * dt;
    const dy = Math.max(-mx, Math.min(mx, angD(want, v.yaw)));
    v.yaw += dy;
    v.yr += (dy / dt - v.yr) * Math.min(1, dt * 10);
  }
  if (pose.mode !== v.mode) {
    v.prev = v.mode;
    v.mode = pose.mode;
  }
  return v;
}

/** Игровой угол → курс рига (чтобы на экране морда смотрела точно туда же). */
const rigYaw = (a: number) => Math.atan2(Math.sin(a), SE * Math.cos(a));
/** Курс рига → угол на экране. */
const scrAng = (yaw: number) => Math.atan2(SE * Math.sin(yaw), Math.cos(yaw));
/** Сторона 0…15 и её курс рига. */
function side16(gameA: number): { d: number; yaw: number } {
  const d = dirBucket(rigYaw(gameA), NDIR);
  return { d, yaw: (d / NDIR) * TAU };
}
/** Идёт ли моб (по скорости мозга). */
const moving = (m: Mob, thr = 0.4) => Math.hypot(m.vx, m.vy) > thr;
/** Курс по ходу: движется — по скорости, стоит — куда смотрит. */
const headOf = (m: Mob) => (moving(m) ? Math.atan2(m.vy, m.vx) : m.face);

const easeOut = (k: number) => 1 - (1 - clamp01(k)) ** 3;
const easeIn = (k: number) => clamp01(k) ** 2;
const sstep = (a: number, b: number, x: number) => smooth(clamp01((x - a) / (b - a)));
/** Номер кадра техники 24 к/с (не больше `max`). */
const fi = (t: number, max: number) => Math.min(max, Math.max(0, Math.floor(t * FPS)));

interface Pic {
  p: Px;
  lit: Px | null;
  ax: number;
  ay: number;
  eye: [number, number] | null;
}

function pale(p: Px): Px {
  const c0 = hx('#f4f0ff');
  const q = new Px(p.w, p.h);
  for (let i = 0; i < p.data.length; i += 4) {
    if (!p.data[i + 3]) continue;
    const l = (p.data[i] + p.data[i + 1] + p.data[i + 2]) / 3;
    const c = mixc([l, l, l, 255], c0, 0.5);
    q.data[i] = c[0];
    q.data[i + 1] = c[1];
    q.data[i + 2] = c[2];
    q.data[i + 3] = p.data[i + 3];
  }
  return q;
}

function finish3(b: Pic, look: Look, flash: boolean): MobFrame {
  let p = b.p;
  if (look === 'albino') p = pale(p);
  if (look === 'elite') edge(p, GOLDK);
  if (flash) p = p.tint(WHITE, 0.85);
  return { img: p.canvas(), ax: b.ax, ay: b.ay, eye: b.eye, lit: b.lit ? b.lit.canvas() : null };
}

/** Кадр из кеша: вид, поза, номер кадра, сторона; `extra` — поля хода кадра. */
function mobFrame(
  kind: string,
  pose: MobPose,
  anim: string,
  f: number,
  d: number,
  build: () => Pic,
  extra?: Partial<MobFrame> | null,
): MobFrame {
  const key = `${kind}|${anim}|${f}|${d}|${pose.flash ? 1 : 0}|${pose.look}`;
  let fr = MF.get(key);
  if (!fr) {
    const t0 = performance.now();
    // Осколки смерти элиты — без золотой обводки: она съедала их цвет.
    const look = pose.look === 'elite' && anim === 'die' ? 'normal' : pose.look;
    fr = MF.set(key, finish3(build(), look, pose.flash));
    const ms = performance.now() - t0;
    F15_MOB_STAT.n++;
    F15_MOB_STAT.ms += ms;
    F15_MOB_STAT.max = Math.max(F15_MOB_STAT.max, ms);
  }
  return extra ? { ...fr, ...extra } : fr;
}

type Proj2 = (v: V3) => [number, number];
/** Отрисовать риг и дорисовать поверх (`post` — след, искры) в экранных точках. */
function draw(
  r: Rig,
  w: number,
  h: number,
  ax: number,
  ay: number,
  post?: (o: RigOut, P: Proj2) => void,
  opt?: RigOpt,
): Pic {
  const o = renderRig(r, w, h, ax, ay, opt);
  if (post)
    post(o, (v) => {
      const q = proj(v, ax, ay);
      return [q[0], q[1]];
    });
  return { p: o.p, lit: o.lit, ax, ay, eye: o.eye };
}

const litOn = (o: RigOut): Px => (o.lit ??= new Px(o.p.w, o.p.h));

/**
 * След удара — серп по полу вокруг точки (cx, cy) экрана: от угла `a0` до
 * `a1` (экранные углы), нарисована доля `k`, голова яркая, хвост гаснет.
 */
function slash(
  p: Px,
  cx: number,
  cy: number,
  R: number,
  a0: number,
  a1: number,
  k: number,
  c: RGBA,
  fade = 1,
  wide = 2,
): void {
  if (k <= 0 || fade <= 0) return;
  const n = Math.max(4, Math.ceil(Math.abs(a1 - a0) * R * 1.6));
  const m = Math.round(n * clamp01(k));
  for (let i = 0; i <= m; i++) {
    const s = i / n;
    const a = a0 + (a1 - a0) * s;
    const age = m ? 1 - i / m : 0; // 0 — голова
    const al = (1 - age * 0.85) * fade;
    const wdt = 1 + (wide - 1) * (1 - age) * Math.sin(Math.PI * Math.min(1, s * 1.15));
    for (let j = 0; j < wdt; j += 0.7) {
      const rr = R - j;
      p.set(
        Math.round(cx + Math.cos(a) * rr),
        Math.round(cy + Math.sin(a) * rr),
        alpha(age < 0.2 ? WHITE : c, al),
      );
    }
  }
}

/** Звёзды над оглушённым: точки рига на орбите над головой (кадр f из 8). */
function dizzyStars(r: Rig, top: V3, f: number, R = 4): void {
  for (let i = 0; i < 3; i++) {
    const a = (f / 8) * TAU + (i / 3) * TAU;
    const P: V3 = [top[0] + Math.cos(a) * R, top[1] + Math.sin(a) * R, top[2] + Math.sin(a) * 0.6];
    r.dot(P, i === 0 ? WHITE : hx('#fff27a'), 1, 2, 0.4);
  }
}

/** Искры-лучики вокруг точки экрана (контакт, выстрел): k — доля разлёта. */
function burstPx(p: Px, x: number, y: number, k: number, n: number, R: number, c: RGBA, seed = 1) {
  if (k <= 0 || k >= 1) return;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + hash(i, seed, 3) * 0.6;
    const r0 = R * (0.2 + k * 0.8);
    const r1 = r0 + 2 * (1 - k);
    stroke(
      p,
      x + Math.cos(a) * r0,
      y + Math.sin(a) * r0,
      x + Math.cos(a) * r1,
      y + Math.sin(a) * r1,
      alpha(i % 2 ? c : WHITE, 1 - k),
    );
  }
}


// --- Кристальный ёж -----------------------------------------------------------
//
// Тельце в бурой шёрстке, мордочка, четыре лапки и иглы-кристаллы кольцами
// вокруг боковой оси (по шесть в кольце: шар при качении повторяется через
// 60°, и кадров качения нужно пять на сторону). У развёрнутого видны только
// иглы спины, свёрнутый — колючий шар.

const U_FUR = tn('#2a1614', '#4e2e24', '#7c5236', '#b08458');
const U_SKIN = tn('#5a3438', '#8c5458', '#c48a84', '#f4c8b8');
const U_EYE = hx('#9fe8ff');
const U_R = 5.4;

const U_SPINES: { d: V3; back: number; ring: number }[] = (() => {
  const out: { d: V3; back: number; ring: number }[] = [];
  [-0.98, -0.5, 0, 0.5, 0.98].forEach((lat, ring) => {
    for (let k = 0; k < 6; k++) {
      const th = ((k + (ring % 2) * 0.5) / 6) * TAU;
      const cl = Math.cos(lat);
      const d: V3 = [Math.cos(th) * cl, Math.sin(lat), Math.sin(th) * cl];
      const back = clamp01((d[2] + 0.3) * 1.7) * clamp01((0.6 - d[0]) * 1.7);
      out.push({ d, back, ring });
    }
  });
  return out;
})();

interface UPose {
  /** Фаза шага 0…1. */
  ph: number;
  /** Свёрнут 0…1. */
  c: number;
  /** Мордочка наружу у свёрнутого (оглушён). */
  peek: number;
  /** Поворот шара (качение вперёд), рад. */
  spin: number;
  pitch: number;
  fwd: number;
  lift: number;
  crouch: number;
  jaw: number;
  bristle: number;
  /** Иглы смотрят вперёд (прицел веера) 0…1. */
  aim: number;
  glow: number;
  /** Доля выстреленных игл спины (отрастают). */
  gone: number;
  side: number;
  /** Смерть 0…1. */
  dk: number;
}
const U0: UPose = {
  ph: 0,
  c: 0,
  peek: 0,
  spin: 0,
  pitch: 0,
  fwd: 0,
  lift: 0,
  crouch: 0,
  jaw: 0,
  bristle: 0,
  aim: 0,
  glow: 0,
  gone: 0,
  side: 0,
  dk: 0,
};

function urchinRig(o: UPose, yaw: number): Rig {
  const r = new Rig();
  const B = F3.yaw(yaw);
  const c = o.c;
  const sk = 1 - o.dk * 0.45;
  const rb: V3 = [
    (6.2 - c * 1.0) * sk,
    (4.9 + c * 0.3) * sk,
    (4.0 + c * 1.2 - o.crouch * 0.7) * sk,
  ];
  const H = rb[2] + 0.5 - o.crouch * 0.4 + o.lift - c * 0.2;
  const body = B.at(o.fwd, 0, H).pitch(o.pitch).roll(o.side);
  const crack = o.dk > 0 ? 0.25 + o.dk * 0.5 : 0;
  r.ell(body, [0, 0, 0], rb, {
    T: U_FUR,
    bias: crack,
    glow: o.dk > 0 ? o.dk * 0.6 : 0,
    pat: (q, l) => (q[2] < -0.5 + c * 0.3 && q[0] > -0.6 ? tone(U_SKIN, l - 0.1) : null),
  });
  // Мордочка: у свёрнутого уходит в шар.
  const ch = c * (1 - o.peek);
  const hd = body
    .at(rb[0] * (0.74 - ch * 0.45), 0, -0.9 - ch * 0.8)
    .pitch(-o.jaw * 0.45 + ch * 0.4)
    .scale(1 - ch * 0.25);
  const skin: Mat = { T: U_SKIN };
  r.ell(hd, [0.6, 0, 0], [2.8, 2.25, 2.05], skin);
  r.dot(hd.p(3.3, 0, 0.35), hx('#2a0c22'), 0, 1, 0.8);
  if (ch < 0.8) {
    for (const s of [-1, 1]) {
      r.ell(hd, [-1.2, s * 1.9, 1.8], [0.7, 0.55, 1.0], skin);
      r.dot(hd.p(1.2, s * 1.55, 1.0), o.dk > 0 ? INK : U_EYE, o.dk > 0 ? 0 : 1, 1, 0.5);
    }
    if (o.jaw > 0.05) {
      r.ell(hd, [1.6, 0, -1.3], [1.7, 1.25, 0.45 + o.jaw * 0.8], { T: tn('#1a0614', '#2a0c1e', '#4a1830', '#6a2440') });
      r.dot(hd.p(2.6, -0.6, -0.9), WHITE, 0, 1, 0.9);
      r.dot(hd.p(2.6, 0.6, -0.9), WHITE, 0, 1, 0.9);
    }
    if (o.dk <= 0) r.eye = hd.p(1.2, -1.55, 1.0);
  }
  // Лапки: диагональными парами; свёрнутый их поджимает.
  const legs: [number, number, number][] = [
    [2.4, -2.8, 0],
    [2.4, 2.8, 0.5],
    [-2.6, -2.8, 0.5],
    [-2.6, 2.8, 0],
  ];
  for (const [lf, ls, off] of legs) {
    const p = (o.ph + off) % 1;
    const sw = -Math.cos(p * TAU) * 1.9;
    const up = Math.max(0, Math.sin(p * TAU)) * 1.4;
    const hip = body.p(lf, ls * 0.9, -rb[2] * 0.45);
    const foot0 = B.p(o.fwd + lf * 0.9 + sw, ls * 1.1, up);
    const foot = vlerp(foot0, hip, Math.max(c, o.dk));
    r.cap(hip, foot, 1.25, 0.95, { T: U_FUR, bias: -0.15 });
    r.ball(foot, 1.0 * (1 - c * 0.5), { T: U_SKIN, bias: -0.2 });
  }
  // Иглы.
  const spinF = body.pitch(o.spin);
  const sweep = -0.4 + o.aim * 1.1 - o.bristle * 0.15;
  const mat: Mat = { T: CRYST, spec: true, glow: 0.22 + o.glow * 0.45 };
  const from = r.size;
  for (const s of U_SPINES) {
    let vis = Math.max(s.back, c);
    if (o.gone > 0 && s.back > 0.45 && s.d[0] > -0.35) vis *= 1 - o.gone;
    if (vis < 0.08) continue;
    const L = (3.0 + 2.5 * s.back * (1 - c * 0.3) + o.bristle * 1.3) * vis;
    const base = spinF.p(s.d[0] * rb[0] * 0.8, s.d[1] * rb[1] * 0.8, s.d[2] * rb[2] * 0.8);
    const dl = spinF.v(s.d[0], s.d[1], s.d[2]);
    const dir = vadd(dl, vmul(body.f, sweep * (1 - c) * Math.max(0, s.d[2] + 0.2)));
    r.spike(base, dir, L, 1.3 + 0.4 * s.back, mat, 4, s.ring * 0.4);
    if (o.glow > 0.35 && s.back > 0.5) {
      const tip = vadd(base, vmul(vnorm(dir), L + 0.3));
      r.dot(tip, WHITE, o.glow, 1, 0.8);
    }
  }
  if (o.dk > 0) r.explode(sstep(0.25, 1, o.dk), body.o, 15, 11, 30, from, 0.3);
  return r;
}

/** Нарисовать ежа: холст 44×44, ноги в (22, 30). */
function urchinPic(o: UPose, yaw: number, post?: (o: RigOut, P: Proj2) => void): Pic {
  return draw(urchinRig(o, yaw), 44, 44, 22, 30, post);
}

/** Серп укуса перед мордой: экранный угол `sa`, доля `k`, затухание `fade`. */
function biteTrail(R: number, sa: number, arc: number, k: number, fade: number, c: RGBA) {
  return (o: RigOut, P: Proj2) => {
    const [cx, cy] = P([0, 0, 2.5]);
    const lit = litOn(o);
    slash(lit, cx, cy, R, sa + arc / 2, sa - arc / 2, k, c, fade, 3);
    slash(o.p, cx, cy, R, sa + arc / 2, sa - arc / 2, k, alpha(c, 0.8), fade * 0.8, 1);
  };
}

registerMobPainter('f15_urchin', (m: Mob, pose: MobPose) => {
  const t = pose.t;
  const md = pose.mode;
  const roll = md === 'f15_roll';
  const tech = md !== 'chase' && md !== 'idle' && md !== 'wander' && md !== 'flee';
  const v = visOf(m, pose, roll ? Math.atan2(m.vy, m.vx) : tech ? m.face : headOf(m), roll ? 40 : 11);
  const { d, yaw } = side16(v.yaw);
  const sa = scrAng(yaw);
  const o: UPose = { ...U0 };
  const extra: Partial<MobFrame> = { shadow: 6 };
  let anim = 'idle';
  let f = 0;
  let post: ((o: RigOut, P: Proj2) => void) | undefined;
  if (md === 'dying') {
    const T = 1.05;
    f = fi(t, 25);
    const k = f / FPS / T;
    anim = 'die';
    o.c = easeOut(k / 0.3);
    o.dk = k;
    o.glow = 1 - k;
    extra.linger = T;
    extra.alpha = 1 - sstep(0.7, 1, k);
    extra.shadow = 6 * (1 - k);
  } else if (md === 'windup') {
    // Укус: присел назад, иглы дыбом — бросок вперёд с открытой пастью;
    // челюсти смыкаются в последнем кадре замаха (урон — в конце замаха).
    const T = 0.6;
    f = fi(t, 14);
    const k = (f + 0.5) / FPS / T;
    anim = 'bite';
    const back = sstep(0, 0.65, k);
    const snap = easeOut((k - 0.7) / 0.25);
    o.fwd = -3 * back * (1 - snap) + 5.5 * snap;
    o.crouch = 0.9 * back * (1 - snap);
    o.bristle = back;
    o.pitch = -0.18 * back * (1 - snap) + 0.22 * snap;
    o.jaw = k < 0.93 ? back * 0.5 * (1 - snap) + snap : 0.15;
    o.ph = 0.25;
    if (k > 0.72) post = biteTrail(13, sa, 1.4, (k - 0.72) / 0.28, 1, TEAL_GLOW);
    extra.still = true;
  } else if (md === 'f15_curl') {
    // Сворачивание: присел, качнулся назад — и колючий шар, готовый к броску.
    const T = 0.6;
    f = fi(t, 14);
    const k = (f + 0.5) / FPS / T;
    anim = 'curl';
    o.crouch = 0.8 * sstep(0, 0.2, k) * (1 - sstep(0.3, 0.6, k));
    o.c = easeOut(sstep(0.12, 0.7, k));
    o.lift = Math.sin(PI * sstep(0.5, 0.85, k)) * 2.2;
    o.spin = -0.45 * sstep(0.55, 0.85, k) + 0.6 * sstep(0.85, 1, k);
    o.bristle = sstep(0.1, 0.6, k);
    o.glow = k;
    extra.still = true;
  } else if (roll) {
    // Качение: шар крутится по ходу; пять кадров на 60° (иглы повторяются).
    const ang = (v.dist * TS) / U_R;
    f = Math.floor(ang / (TAU / 30)) % 5;
    anim = 'roll';
    o.c = 1;
    o.spin = (f * TAU) / 30 + 0.6;
    o.glow = 0.7;
    extra.dy = -Math.abs(Math.sin(v.dist * 3.1)) * 1.2;
    extra.ghost = { every: 0.035, life: 0.18, tint: '108,240,255', alpha: 0.42 };
    extra.still = true;
  } else if (md === 'f15_dizzy') {
    // Оглушён: шар раскачивается и затихает, мордочка наружу, звёзды кругом.
    f = fi(t, 26);
    const k = f / FPS;
    anim = 'dizzy';
    o.c = 0.85;
    o.peek = 0.7;
    o.side = Math.sin(k * 13) * 0.4 * (1 - k / 1.2);
    o.spin = Math.sin(k * 9) * 0.15;
    extra.still = true;
    const sf = f % 8;
    const base = urchinRig;
    return mobFrame('urchin', pose, anim, f, d, () => {
      const r = base(o, yaw);
      dizzyStars(r, [0, 0, 13], sf, 4.2);
      return draw(r, 44, 44, 22, 30);
    }, extra);
  } else if (md === 'f15_open') {
    // Раскрытие: разворачивается, горбит спину к цели, иглы смотрят вперёд и
    // наливаются светом; выстрел — в конце режима.
    const T = 0.55;
    f = fi(t, 13);
    const k = (f + 0.5) / FPS / T;
    anim = 'open';
    o.c = 0.9 * (1 - easeOut(sstep(0, 0.42, k)));
    o.pitch = 0.5 * sstep(0.25, 0.85, k);
    o.aim = sstep(0.25, 0.9, k);
    o.bristle = sstep(0.2, 0.8, k);
    o.glow = sstep(0.35, 1, k);
    o.crouch = 0.6 * sstep(0.3, 1, k);
    o.side = k > 0.7 ? (f % 2 ? 0.05 : -0.05) : 0;
    extra.still = true;
  } else if (md === 'recover') {
    const T = 0.6;
    f = fi(t, 14);
    const k = (f + 0.5) / FPS / T;
    if (v.prev === 'f15_open') {
      // Отдача веера: иглы спины ушли, корпус отбросило назад; отрастают.
      anim = 'shot';
      const kick = 1 - easeOut(k / 0.35);
      o.pitch = -0.28 * kick;
      o.fwd = -2.2 * kick;
      o.aim = kick;
      o.gone = 1 - sstep(0.35, 1, k);
      o.glow = kick;
      o.crouch = 0.3 * kick;
      if (f <= 4)
        post = (out, P) => {
          const lit = litOn(out);
          const fk = f / 5;
          for (let i = -2; i <= 2; i++) {
            const a = sa + i * 0.22;
            const [x0, y0] = P([0, 0, 7]);
            const r0 = 6 + fk * 10;
            const x = x0 + Math.cos(a) * r0;
            const y = y0 + Math.sin(a) * r0 * 0.9;
            stroke(lit, x, y, x - Math.cos(a) * 4, y - Math.sin(a) * 4, alpha(TEAL_GLOW, 0.8 - fk * 0.6));
            lit.set(Math.round(x), Math.round(y), alpha(WHITE, 1 - fk));
          }
        };
    } else if (v.prev === 'windup') {
      // Проводка укуса: держит выпад, серп гаснет, затем отходит.
      anim = 'bitefol';
      const hold = 1 - sstep(0.2, 0.75, k);
      o.fwd = 5.5 * hold;
      o.pitch = 0.22 * hold;
      o.jaw = 0.15 * hold;
      o.bristle = hold;
      o.ph = 0.25;
      if (k < 0.4) post = biteTrail(13, sa, 1.4, 1, 1 - k / 0.4, TEAL_GLOW);
    } else {
      anim = 'rec';
      o.crouch = 0.3 * (1 - k);
      o.bristle = 0.5 * (1 - k);
    }
    extra.still = true;
  } else if (md === 'stun' || pose.anim === 'hurt') {
    f = fi(t, 6);
    anim = 'hurt';
    const k = f / 6;
    o.crouch = 0.8 * (1 - k);
    o.fwd = -1.5 * (1 - k);
    o.pitch = -0.2 * (1 - k);
    o.bristle = 1 - k;
  } else if (moving(m)) {
    f = Math.floor((v.dist / 0.7) * 8) % 8;
    anim = 'run';
    o.ph = f / 8;
    o.lift = Math.abs(Math.sin((f / 8) * TAU)) * 0.6;
    o.pitch = 0.05;
  } else {
    f = Math.floor(pose.now * 4) % 4;
    anim = 'idle';
    o.crouch = (f === 1 || f === 2 ? 0.15 : 0) + 0.05;
    o.glow = f === 2 ? 0.4 : 0.15;
  }
  return mobFrame('urchin', pose, anim, f, d, () => urchinPic(o, yaw, post), extra);
});

registerMobWarm('f15_urchin', function* () {
  const pose = (anim: MobPose['anim'], mode: string): MobPose => ({
    anim,
    frame: 0,
    mode,
    t: 0,
    left: false,
    flash: false,
    look: 'normal',
    now: 0,
  });
  for (let d = 0; d < NDIR; d++) {
    const yaw = (d / NDIR) * TAU;
    for (let f = 0; f < 8; f++) {
      mobFrame('urchin', pose('run', 'chase'), 'run', f, d, () =>
        urchinPic({ ...U0, ph: f / 8, lift: Math.abs(Math.sin((f / 8) * TAU)) * 0.6, pitch: 0.05 }, yaw),
      );
      yield 0;
    }
    for (let f = 0; f < 5; f++) {
      mobFrame('urchin', pose('sleep', 'f15_roll'), 'roll', f, d, () =>
        urchinPic({ ...U0, c: 1, spin: (f * TAU) / 30 + 0.6, glow: 0.7 }, yaw),
      );
      yield 0;
    }
  }
});


// --- Метеор-жук ---------------------------------------------------------------
//
// Жук-носорог в панцире из метеорита: по камню — трещины с магмой (узор в
// координатах тела: поворачивается с ним), рог загнут вверх, шесть ног
// треногой. Прицел — опустил рог, скребёт задними лапами, трещины
// разгораются; таран — пламя из-под панциря назад; о стену — оглушён.

const MET_ROCK = tn('#1a1210', '#33261f', '#55433a', '#86705e');
const MET_DARK = tn('#120c0a', '#221814', '#3a2a22', '#5a463a');
const FLAME = tn('#a02008', '#f06018', '#ffb030', '#fff0b0');
const MAGMA_LO = hx('#6a1e0a');
const MAGMA_HI = hx('#ffb040');

/** Сеть трещин: нулевые линии суммы синусов в координатах тела. */
const crackF = (q: V3) =>
  Math.abs(
    Math.sin(q[0] * 5.3 + 1.7 * Math.sin(q[1] * 4.1 + 0.3)) +
      Math.sin(q[1] * 5.9 + 1.3 * Math.sin(q[2] * 3.7)) * 0.8 +
      Math.sin(q[2] * 6.1 + q[0] * 2.3) * 0.6,
  );

/** Камень с магмой в трещинах: `heat` 0…1 — как сильно горят. */
function magmaMat(T: Tones, heat: number, w = 0.16): Mat {
  const c = mixc(MAGMA_LO, MAGMA_HI, heat);
  return {
    T,
    pat: (q, l) => (crackF(q) < w ? (heat > 0.85 && crackF(q) < w * 0.4 ? WHITE : c) : tone(T, l)),
    gpat: (q) => (crackF(q) < w ? 0.35 + heat * 0.65 : 0),
  };
}

/** Нога насекомого: бедро вверх-наружу, голень к земле. */
function bugLeg(r: Rig, hip: V3, foot: V3, out: V3, m: Mat, k = 1): void {
  const knee = vadd(vlerp(hip, foot, 0.42), vadd(vmul(out, 1.6 * k), [0, 0, 2.6 * k]));
  r.cap(hip, knee, 0.95 * k, 0.75 * k, m);
  r.cap(knee, foot, 0.75 * k, 0.45 * k, m);
}

interface MPose {
  ph: number;
  /** Наклон корпуса носом вниз. */
  pitch: number;
  /** Голова (с рогом) носом вниз. */
  head: number;
  fwd: number;
  lift: number;
  heat: number;
  /** Ноги: 0 — шаг, 1 — врастопырку (оглушён), 2 — смазаны бегом. */
  legs: number;
  side: number;
  /** Пламя тарана 0…1, `fl` — кадр языков. */
  fire: number;
  fl: number;
  dk: number;
}
const M0: MPose = {
  ph: 0,
  pitch: 0,
  head: 0,
  fwd: 0,
  lift: 0,
  heat: 0.25,
  legs: 0,
  side: 0,
  fire: 0,
  fl: 0,
  dk: 0,
};

function meteorRig(o: MPose, yaw: number): Rig {
  const r = new Rig();
  const B = F3.yaw(yaw);
  const body = B.at(o.fwd, 0, 5.4 + o.lift).pitch(o.pitch).roll(o.side);
  const shell = magmaMat(MET_ROCK, o.heat);
  const plate = magmaMat(MET_DARK, o.heat, 0.12);
  const legM: Mat = { T: MET_DARK, bias: -0.1 };
  // Ноги — треногой: (1, 3 слева и 2 справа) против остальных.
  const hips: [number, number, number][] = [
    [3.2, -1, 0],
    [3.2, 1, 0.5],
    [0.4, -1, 0.5],
    [0.4, 1, 0],
    [-2.8, -1, 0],
    [-2.8, 1, 0.5],
  ];
  const legsFrom = r.size;
  for (const [hf, s, off] of hips) {
    const p = (o.ph + off) % 1;
    let sw = -Math.cos(p * TAU) * 2.2;
    let up = Math.max(0, Math.sin(p * TAU)) * 1.6;
    if (o.legs === 2) {
      sw = (off ? -1 : 1) * 1.2;
      up = 0.4;
    }
    const spread = o.legs === 1 ? 9.5 : 7.4;
    const hip = body.p(hf, s * 3.4, -2.6);
    const foot = B.p(o.fwd + hf * 1.15 + sw + (o.legs === 1 ? hf * 0.3 : 0), s * spread, up + (o.legs === 1 ? 1.5 : 0));
    bugLeg(r, hip, foot, B.v(0, s, 0), legM, o.dk > 0 ? 1 - o.dk * 0.5 : 1);
  }
  // Панцирь, переднеспинка, голова с рогом.
  const bodyFrom = r.size;
  r.ell(body, [-1.6, 0, 0], [7.2, 5.6, 4.3], shell);
  r.line(body.p(-1.6, 0, 4.35), body.p(-8.6, 0, 0.6), hx('#120c0a'), 0, 0.4);
  r.line(body.p(4.0, 0, 3.4), body.p(-1.0, 0, 4.4), hx('#120c0a'), 0, 0.4);
  r.ell(body, [4.4, 0, 0.2], [2.9, 4.3, 3.2], plate);
  const hd = body.at(6.6, 0, -0.6).pitch(o.head);
  r.ell(hd, [0.6, 0, 0], [2.3, 2.7, 2.1], { T: MET_DARK });
  const hornM: Mat = { T: MET_ROCK, bias: 0.15 };
  const h0 = hd.p(1.8, 0, 1.0);
  const h1 = hd.p(4.4, 0, 3.0);
  const h2 = hd.p(5.2, 0, 6.0);
  r.cap(h0, h1, 1.45, 1.0, hornM);
  r.cap(h1, h2, 1.0, 0.35, { ...hornM, glow: o.heat > 0.6 ? 0.5 : 0 });
  r.dot(h2, mixc(MAGMA_HI, WHITE, o.heat), o.heat, 1, 0.6);
  for (const s of [-1, 1]) {
    r.cap(hd.p(2.0, s * 1.3, -1.2), hd.p(3.2, s * 0.5, -1.7), 0.6, 0.3, legM);
    r.dot(hd.p(1.9, s * 1.8, 0.6), o.dk > 0 ? INK : hx('#ffb040'), o.dk > 0 ? 0 : 1, 1, 0.5);
  }
  if (o.dk <= 0) r.eye = hd.p(1.9, -1.8, 0.6);
  // Пламя тарана: языки из-под панциря назад.
  if (o.fire > 0) {
    const fm: Mat = { T: FLAME, glow: 1, soft: true, bias: 0.35 };
    for (let i = 0; i < 5; i++) {
      const s = (i - 2) * 1.5;
      const z = 1.2 + Math.abs(i - 2) * 0.6 + (i % 2) * 1.2;
      const fl = 0.75 + 0.5 * hash(i, o.fl, 77);
      const L = (6 + 6 * fl) * o.fire;
      const a = body.p(-7.6, s, z - 1);
      const b = vadd(a, vadd(B.v(-L, s * 0.35, 0), [0, 0, 1.4 * fl]));
      r.cap(a, b, 2.1 * o.fire, 0.3, fm);
    }
  }
  if (o.dk > 0) {
    r.explode(sstep(0.15, 1, o.dk), body.o, 23, 12, 30, bodyFrom, 0.25);
    r.explode(sstep(0.3, 1, o.dk) * 0.4, body.o, 5, 5, 10, legsFrom, 0.1);
  }
  return r;
}

function meteorPic(o: MPose, yaw: number, post?: (o: RigOut, P: Proj2) => void): Pic {
  return draw(meteorRig(o, yaw), 60, 52, 30, 34, post);
}

/** Клубы пыли у ног (2D): `k` — возраст 0…1, `n` штук, за спиной по углу `sa`. */
function dustPuffs(p: Px, x: number, y: number, sa: number, k: number, n: number, seed: number) {
  if (k <= 0 || k >= 1) return;
  for (let i = 0; i < n; i++) {
    const a = sa + PI + (hash(i, seed, 1) - 0.5) * 1.6;
    const d = 3 + k * (5 + hash(i, seed, 2) * 6);
    const cx = x + Math.cos(a) * d;
    const cy = y + Math.sin(a) * d * 0.6 - k * 2;
    const rr = 1 + k * 2;
    p.ell(Math.round(cx), Math.round(cy), rr, rr * 0.8, alpha(hx('#7a7088'), 0.55 * (1 - k)));
  }
}

registerMobPainter('f15_meteor', (m: Mob, pose: MobPose) => {
  const t = pose.t;
  const md = pose.mode;
  const charge = md === 'f15_charge';
  const tech = md !== 'chase' && md !== 'idle' && md !== 'wander';
  const v = visOf(m, pose, charge ? m.dir : tech ? m.face : headOf(m), charge ? 30 : 8);
  const { d, yaw } = side16(v.yaw);
  const sa = scrAng(yaw);
  const o: MPose = { ...M0 };
  const extra: Partial<MobFrame> = { shadow: 9 };
  let anim = 'idle';
  let f = 0;
  let post: ((o: RigOut, P: Proj2) => void) | undefined;
  if (md === 'dying') {
    const T = 1.1;
    f = fi(t, 26);
    const k = f / FPS / T;
    anim = 'die';
    o.dk = k;
    o.heat = 1 - k;
    o.legs = 1;
    extra.linger = T;
    extra.alpha = 1 - sstep(0.72, 1, k);
    extra.shadow = 9 * (1 - k);
  } else if (md === 'aim') {
    // Прицел: опустил рог, роет задними лапами, трещины разгораются, дрожит.
    const T = METEOR_K.aim;
    f = fi(t, 19);
    const k = (f + 0.5) / FPS / T;
    anim = 'aim';
    const dn = easeOut(k / 0.4);
    o.head = 0.38 * dn;
    o.pitch = 0.16 * dn;
    o.fwd = -1.6 * dn;
    o.heat = 0.25 + 0.75 * sstep(0.1, 1, k);
    o.ph = 0.25 + (f % 4 < 2 ? 0.08 : -0.08) * dn;
    o.side = k > 0.6 ? (f % 2 ? 0.04 : -0.04) : 0;
    post = (out, P) => {
      const [x, y] = P([0, 0, 0]);
      dustPuffs(out.p, x, y + 1, sa, ((f % 6) + 1) / 7, 3, f >> 1);
      const lit = litOn(out);
      for (let i = 0; i < 3; i++) {
        const sk = ((f + i * 3) % 9) / 9;
        const [sx, sy] = P([(hash(i, 3, 3) - 0.5) * 8, (hash(i, 4, 3) - 0.5) * 6, 9 + sk * 8]);
        if (o.heat > 0.5) lit.set(Math.round(sx), Math.round(sy), alpha(MAGMA_HI, (1 - sk) * 0.8));
        else out.p.set(Math.round(sx), Math.round(sy), alpha(hx('#8a8090'), 0.6 * (1 - sk)));
      }
    };
    extra.still = true;
  } else if (charge) {
    // Таран: корпус низко, ноги смазаны, пламя назад; шлейф — огненный.
    f = Math.floor(pose.now * 16) % 4;
    anim = 'charge';
    o.pitch = 0.14;
    o.head = 0.3;
    o.heat = 1;
    o.legs = 2;
    o.ph = (f % 2) * 0.5;
    o.fire = 1;
    o.fl = f;
    o.lift = f % 2 ? 0.5 : 0;
    extra.ghost = { every: 0.03, life: 0.22, tint: '255,140,50', alpha: 0.5 };
    extra.still = true;
  } else if (md === 'f15_dizzy') {
    // О стену: отбросило, рог задран, лапы врастопырку, звёзды над головой.
    f = fi(t, 33);
    const k = f / FPS;
    anim = 'dizzy';
    const bump = 1 - easeOut(k / 0.25);
    o.pitch = -0.28 * bump - 0.08;
    o.head = -0.3 * bump - 0.1;
    o.fwd = -3 * bump;
    o.legs = 1;
    o.heat = 0.35 * (1 - k / 1.4) + 0.1;
    o.side = Math.sin(k * 11) * 0.12 * (1 - k / 1.5);
    const sf = f % 8;
    extra.still = true;
    return mobFrame(
      'meteor',
      pose,
      anim,
      f,
      d,
      () => {
        const r = meteorRig(o, yaw);
        if (k > 0.12) dizzyStars(r, [Math.cos(yaw) * 5, Math.sin(yaw) * 5, 16], sf, 4.5);
        return draw(r, 60, 52, 30, 34, (out, P) => {
          if (k < 0.3) {
            const [x, y] = P([Math.cos(yaw) * 14, Math.sin(yaw) * 14, 7]);
            burstPx(litOn(out), x, y, k / 0.3, 9, 9, MAGMA_HI, 5);
            dustPuffs(out.p, x, y + 3, sa + PI, k / 0.3, 5, 9);
          }
        });
      },
      extra,
    );
  } else if (md === 'windup') {
    // Удар рогом: опустил голову — взмах снизу вверх через конус.
    const T = 0.8;
    f = fi(t, 19);
    const k = (f + 0.5) / FPS / T;
    anim = 'gore';
    const dn = easeOut(k / 0.6);
    const up = easeOut((k - 0.75) / 0.25);
    o.head = 0.45 * dn * (1 - up) - 0.45 * up;
    o.pitch = 0.18 * dn * (1 - up) - 0.12 * up;
    o.fwd = -2 * dn * (1 - up) + 3.5 * up;
    o.heat = 0.3 + 0.5 * dn;
    o.ph = 0.25;
    if (k > 0.75) post = biteTrail(17, sa, 1.5, (k - 0.75) / 0.25, 1, hx('#ffb040'));
    extra.still = true;
  } else if (md === 'recover') {
    const T = 0.7;
    f = fi(t, 16);
    const k = (f + 0.5) / FPS / T;
    if (v.prev === 'f15_charge') {
      // Торможение: упёрся лапами, корпус клюёт вперёд, пыль веером, остывает.
      anim = 'brake';
      const br = 1 - easeOut(k / 0.6);
      o.pitch = 0.2 * br;
      o.head = 0.2 * br;
      o.heat = 0.4 + 0.6 * br;
      o.legs = 1;
      o.fire = Math.max(0, 1 - k * 4) * 0.6;
      o.fl = f % 4;
      o.fwd = 1.5 * br;
      if (k < 0.6)
        post = (out, P) => {
          const [x, y] = P([Math.cos(yaw) * 8, Math.sin(yaw) * 8, 0]);
          dustPuffs(out.p, x, y, sa + PI, k / 0.6, 6, 13);
        };
    } else if (v.prev === 'windup') {
      anim = 'gorefol';
      const hold = 1 - sstep(0.15, 0.8, k);
      o.head = -0.45 * hold;
      o.pitch = -0.12 * hold;
      o.fwd = 3.5 * hold;
      o.heat = 0.3 + 0.5 * hold;
      o.ph = 0.25;
      if (k < 0.35) post = biteTrail(17, sa, 1.5, 1, 1 - k / 0.35, hx('#ffb040'));
    } else {
      anim = 'rec';
      o.heat = 0.3;
    }
    extra.still = true;
  } else if (md === 'stun' || pose.anim === 'hurt') {
    f = fi(t, 6);
    anim = 'hurt';
    const k = 1 - f / 6;
    o.pitch = -0.15 * k;
    o.fwd = -1.5 * k;
    o.heat = 0.25 + 0.5 * k;
  } else if (moving(m)) {
    f = Math.floor((v.dist / 0.85) * 8) % 8;
    anim = 'run';
    o.ph = f / 8;
    o.lift = f % 4 === 1 ? 0.4 : 0;
    o.side = Math.sin((f / 8) * TAU) * 0.04;
  } else {
    f = Math.floor(pose.now * 3) % 4;
    anim = 'idle';
    o.heat = 0.2 + (f === 1 ? 0.15 : f === 2 ? 0.25 : 0.05);
    o.head = f === 2 ? 0.05 : 0;
  }
  return mobFrame('meteor', pose, anim, f, d, () => meteorPic(o, yaw, post), extra);
});

registerMobWarm('f15_meteor', function* () {
  const pose: MobPose = {
    anim: 'run',
    frame: 0,
    mode: 'chase',
    t: 0,
    left: false,
    flash: false,
    look: 'normal',
    now: 0,
  };
  for (let d = 0; d < NDIR; d++) {
    const yaw = (d / NDIR) * TAU;
    for (let f = 0; f < 8; f++) {
      mobFrame('meteor', pose, 'run', f, d, () =>
        meteorPic(
          { ...M0, ph: f / 8, lift: f % 4 === 1 ? 0.4 : 0, side: Math.sin((f / 8) * TAU) * 0.04 },
          yaw,
        ),
      );
      yield 0;
    }
  }
});


// --- Комета-гончая --------------------------------------------------------------
//
// Поджарая гончая из звёздного льда: голова-ядро кометы, грива и хвост —
// светящийся шлейф, который тянется назад по ходу. Галоп — ноги парами с
// фазой, корпус качается. Замах — припала к земле, хвост вспыхнул; рывок —
// вытянулась в струну, ноги в «летящем галопе», хвост во всю длину; на
// дуге кренится внутрь виража. После рывка — занос с упором лап и пылью.

const HOUND = tn('#1c2a4e', '#2e4a80', '#5a86c0', '#bfe4ff');
const HOUND_D = tn('#101a34', '#1a2a50', '#2e4a80', '#5a86c0');
const COMA = tn('#1a6a9a', '#3ab0e0', '#9ae8ff', '#ffffff');

interface CPose {
  ph: number;
  /** 0 — шаг, 1 — летящий галоп (ноги врозь), 2 — упор (занос). */
  legs: number;
  crouch: number;
  pitch: number;
  bank: number;
  /** Длина хвоста-шлейфа 0…1. */
  tail: number;
  /** Свечение ядра 0…1. */
  glow: number;
  stretch: number;
  head: number;
  jaw: number;
  /** Кадр языков шлейфа. */
  fl: number;
  dk: number;
}
const C0: CPose = {
  ph: 0,
  legs: 0,
  crouch: 0,
  pitch: 0,
  bank: 0,
  tail: 0.3,
  glow: 0.3,
  stretch: 0,
  head: 0,
  jaw: 0,
  fl: 0,
  dk: 0,
};

function cometRig(o: CPose, yaw: number): Rig {
  const r = new Rig();
  const B = F3.yaw(yaw);
  const H = 7.8 - o.crouch * 2.8;
  const body = B.at(0, 0, H).pitch(o.pitch).roll(o.bank);
  const L = 1 + o.stretch * 0.35;
  const fur: Mat = { T: HOUND, pat: (q, l) => (q[2] < -0.45 ? tone(HOUND_D, l + 0.2) : null) };
  const from = r.size;
  r.ell(body, [-1.6 * L, 0, 0], [3.6 * L, 2.8, 2.5], fur);
  r.ell(body, [2.1 * L, 0, 0.4], [3.0, 3.0, 3.0], fur);
  // Шея и голова-ядро.
  const nk = body.at(4.0 * L, 0, 1.8).pitch(o.head - 0.25);
  const hd = nk.at(2.0, 0, 1.0).pitch(0.25);
  r.cap(body.p(3.0 * L, 0, 1.0), hd.o, 1.8, 1.5, fur);
  r.ell(hd, [0.3, 0, 0.2], [2.6, 2.3, 2.1], { T: HOUND, bias: 0.1 });
  r.cap(hd.p(1.6, 0, -0.2), hd.p(4.0, 0, -0.6 - o.jaw * 0.3), 1.4, 0.9, { T: HOUND });
  r.dot(hd.p(4.4, 0, -0.5), INK, 0, 1, 0.6);
  if (o.jaw > 0.1) r.cap(hd.p(1.4, 0, -0.9), hd.p(3.0, 0, -1.2 - o.jaw * 1.3), 0.7, 0.45, { T: HOUND_D });
  for (const s of [-1, 1]) {
    r.spike(hd.p(-0.6, s * 1.2, 1.5), hd.v(-0.8, s * 0.45, 1), 3.4, 1.1, { T: HOUND, bias: 0.1 }, 3);
    r.dot(hd.p(1.6, s * 1.4, 0.7), o.dk > 0 ? INK : WHITE, o.dk > 0 ? 0 : 1, 1, 0.5);
  }
  if (o.dk <= 0) r.eye = hd.p(1.6, -1.4, 0.7);
  // Ноги: передние и задние парами, галоп с фазой.
  const legs: [number, number, number][] = [
    [2.6 * L, -1.7, 0],
    [2.6 * L, 1.7, 0.12],
    [-3.8 * L, -1.7, 0.5],
    [-3.8 * L, 1.7, 0.62],
  ];
  const legM: Mat = { T: HOUND_D, bias: 0.1 };
  for (const [lf, ls, off] of legs) {
    const front = lf > 0;
    const hip = body.p(lf, ls, -1.2);
    let foot: V3;
    if (o.legs === 1) {
      foot = B.p(lf + (front ? 5.5 : -6), ls * 0.9, H - 3.4);
    } else if (o.legs === 2) {
      foot = B.p(lf + (front ? 3.6 : -1.6), ls * 1.3, 0);
    } else {
      const p = (o.ph + off) % 1;
      const sw = -Math.cos(p * TAU) * 2.6;
      const up = Math.max(0, Math.sin(p * TAU)) * 1.8;
      foot = B.p(lf * 1.05 + sw, ls * 1.05, up);
    }
    const mid = vlerp(hip, foot, 0.5);
    const knee = vadd(mid, B.v(front ? -0.8 : 1.0, 0, 0.5));
    r.cap(hip, knee, 1.45, 0.95, legM);
    r.cap(knee, foot, 0.95, 0.7, legM);
  }
  // Хвост-шлейф: цепочка светящихся сгустков назад и вверх, дрожит кадрами.
  const n = 7;
  let prev = body.p(-4.6 * L, 0, 0.8);
  for (let i = 1; i <= n; i++) {
    const k = i / n;
    const wob = (hash(i, o.fl, 41) - 0.5) * 1.6 * k;
    const P = vadd(body.p(-4.6 * L - k * (4 + 12 * o.tail), wob, 0.8 + k * (2.4 - o.stretch * 1.4)), [0, 0, 0]);
    const rr = (1.7 - k * 1.2) * (0.7 + o.tail * 0.5);
    r.cap(prev, P, rr + 0.2, rr, {
      T: COMA,
      glow: 0.55 + o.glow * 0.4 - k * 0.3,
      soft: true,
      bias: -0.05 - k * 0.45 + o.glow * 0.25,
    });
    prev = P;
  }
  // Грива — искры вдоль шеи.
  for (let i = 0; i < 3; i++)
    r.dot(nk.p(-0.4 - i * 1.3, 0, 2.3 - i * 0.3), mixc(COMA[2], WHITE, o.glow), 0.8, 1, 0.6);
  if (o.dk > 0) r.explode(sstep(0.1, 1, o.dk), body.o, 31, 10, 24, from, 0.4);
  return r;
}

function cometPic(o: CPose, yaw: number, post?: (o: RigOut, P: Proj2) => void): Pic {
  return draw(cometRig(o, yaw), 64, 48, 32, 32, post);
}

registerMobPainter('f15_comet', (m: Mob, pose: MobPose) => {
  const t = pose.t;
  const md = pose.mode;
  const dash = md === 'f15_dash';
  const tech = md !== 'chase' && md !== 'idle' && md !== 'wander';
  const v = visOf(m, pose, dash ? headOf(m) : tech ? m.face : headOf(m), dash ? 40 : 12);
  const { d, yaw } = side16(v.yaw);
  const sa = scrAng(yaw);
  const o: CPose = { ...C0 };
  const extra: Partial<MobFrame> = { shadow: 7 };
  let anim = 'idle';
  let f = 0;
  let post: ((o: RigOut, P: Proj2) => void) | undefined;
  if (md === 'dying') {
    const T = 0.95;
    f = fi(t, 22);
    const k = f / FPS / T;
    anim = 'die';
    o.dk = k;
    o.crouch = sstep(0, 0.3, k);
    o.tail = 0.3 * (1 - k);
    o.glow = 1 - k;
    extra.linger = T;
    extra.alpha = 1 - sstep(0.65, 1, k);
    extra.shadow = 7 * (1 - k);
  } else if (md === 'aim') {
    // Замах: припала к земле, зад вверх, хвост вспыхнул и вытянулся.
    const T = COMET.aim;
    f = fi(t, 13);
    const k = (f + 0.5) / FPS / T;
    anim = 'aim';
    const dn = easeOut(k / 0.5);
    o.crouch = 0.9 * dn;
    o.pitch = 0.22 * dn;
    o.head = 0.2 * dn;
    o.tail = 0.3 + 0.5 * k;
    o.glow = 0.3 + 0.7 * k;
    o.legs = 0;
    o.ph = 0.25 + (k > 0.7 ? (f % 2) * 0.04 : 0);
    o.fl = f % 4;
    extra.still = true;
  } else if (dash) {
    // Рывок: струна, летящий галоп, шлейф во всю длину; крен в вираже.
    f = Math.floor(pose.now * 16) % 4;
    const bank = Math.max(-1, Math.min(1, Math.round(v.yr / 5)));
    anim = 'dash' + bank;
    o.legs = 1;
    o.stretch = 1;
    o.pitch = 0.05;
    o.head = 0.15;
    o.tail = 1;
    o.glow = 1;
    o.jaw = 0.6;
    o.fl = f;
    o.bank = bank * 0.35;
    extra.ghost = { every: 0.03, life: 0.22, tint: '140,240,255', alpha: 0.55 };
    extra.still = true;
  } else if (md === 'recover' && v.prev === 'f15_dash') {
    // Приземление с заносом: упёрлась лапами, корпус откинут, пыль и искры.
    const T = 0.45;
    f = fi(t, 10);
    const k = (f + 0.5) / FPS / T;
    anim = 'skid';
    const br = 1 - easeOut(k);
    o.legs = k < 0.7 ? 2 : 0;
    o.pitch = -0.25 * br;
    o.crouch = 0.6 * br;
    o.tail = 0.4 + 0.6 * br;
    o.glow = 0.3 + 0.7 * br;
    o.fl = f % 4;
    o.ph = 0.25;
    post = (out, P) => {
      const [x, y] = P([Math.cos(yaw) * 6, Math.sin(yaw) * 6, 0]);
      dustPuffs(out.p, x, y, sa + PI, Math.min(0.99, k * 1.2), 5, 21);
      if (k < 0.5) {
        const lit = litOn(out);
        for (let i = 0; i < 4; i++) {
          const a = sa + PI + (hash(i, 7, 3) - 0.5) * 1.4;
          const rr = 4 + k * 14 * (0.6 + hash(i, 8, 3));
          lit.set(Math.round(x + Math.cos(a) * rr), Math.round(y + Math.sin(a) * rr * 0.6 - k * 4), alpha(COMA[2], 1 - k * 2));
        }
      }
    };
    extra.still = true;
  } else if (md === 'recover') {
    f = fi(t, 10);
    anim = 'rec';
    o.crouch = 0.3 * (1 - f / 10);
  } else if (md === 'stun' || pose.anim === 'hurt') {
    f = fi(t, 6);
    anim = 'hurt';
    const k = 1 - f / 6;
    o.pitch = -0.2 * k;
    o.head = -0.3 * k;
    o.crouch = 0.3 * k;
  } else if (moving(m)) {
    f = Math.floor((v.dist / 1.1) * 8) % 8;
    anim = 'run';
    o.ph = f / 8;
    o.pitch = Math.sin((f / 8) * TAU) * 0.07;
    o.tail = 0.55;
    o.glow = 0.45;
    o.fl = f % 4;
    extra.dy = -Math.max(0, Math.sin((f / 8) * TAU + 0.6)) * 1.2;
  } else {
    f = Math.floor(pose.now * 5) % 4;
    anim = 'idle';
    o.fl = f;
    o.crouch = f === 1 || f === 2 ? 0.1 : 0;
    o.glow = 0.3 + (f === 2 ? 0.15 : 0);
  }
  return mobFrame('comet', pose, anim, f, d, () => cometPic(o, yaw, post), extra);
});

registerMobWarm('f15_comet', function* () {
  const pose: MobPose = {
    anim: 'run',
    frame: 0,
    mode: 'chase',
    t: 0,
    left: false,
    flash: false,
    look: 'normal',
    now: 0,
  };
  for (let d = 0; d < NDIR; d++) {
    const yaw = (d / NDIR) * TAU;
    for (let f = 0; f < 8; f++) {
      mobFrame('comet', pose, 'run', f, d, () =>
        cometPic(
          { ...C0, ph: f / 8, pitch: Math.sin((f / 8) * TAU) * 0.07, tail: 0.55, glow: 0.45, fl: f % 4 },
          yaw,
        ),
      );
      yield 0;
    }
    for (let f = 0; f < 4; f++) {
      mobFrame('comet', pose, 'dash0', f, d, () =>
        cometPic(
          { ...C0, legs: 1, stretch: 1, pitch: 0.05, head: 0.15, tail: 1, glow: 1, jaw: 0.6, fl: f },
          yaw,
        ),
      );
      yield 0;
    }
  }
});


// --- Гравитонный страж ------------------------------------------------------------
//
// Каменный страж с ядром тяжести в груди: щит на левой руке смотрит туда
// же, куда `m.face` (щит гасит удары спереди — рисунок обязан показывать
// правду), кулак на правой. Поворачивается медленно — как мозг. Ноги шагают
// туда, куда он идёт, даже если идёт не лицом (мозг ведёт его к герою, а
// разворачивает отдельно). Замах: кулак вверх-назад, ядро стягивает к нему
// свет; удар — кулак в пол ровно в круг метки в кадр урона; проводка —
// кулак лежит в пыли и медленно уходит назад.

const GRAV_T = tn('#16142a', '#2a2850', '#45437a', '#6e6ca8');
const GRAV_PLATE = tn('#22264a', '#3a4474', '#5c6ea8', '#a4b4e8');
const GRAV_CORE = tn('#4a2a98', '#7a56d8', '#c0a8ff', '#ffffff');

/** Два звена (плечо — локоть — кисть): локоть уходит в сторону `bend`. */
function ik2(a: V3, c: V3, l1: number, l2: number, bend: V3): V3 {
  const d = vsub(c, a);
  const L = Math.min(vlen(d), l1 + l2 - 0.01);
  const u = vnorm(d);
  const x = (l1 * l1 - l2 * l2 + L * L) / (2 * L);
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  const b = vnorm(vsub(bend, vmul(u, vdot(bend, u))));
  return vadd(vadd(a, vmul(u, x)), vmul(b, h));
}

interface GPose {
  ph: number;
  /** Куда шагают ноги относительно корпуса (рад). */
  rel: number;
  walk: number;
  /** Кулак в осях земли под стражем (вперёд, вправо, вверх). */
  fist: V3;
  lean: number;
  crouch: number;
  /** Щит: на сколько выдвинут вперёд 0…1. */
  guard: number;
  core: number;
  /** Свет, стянутый к кулаку 0…1. */
  charge: number;
  side: number;
  dk: number;
}
/** Кулак в осях земли (вперёд, вправо, вверх от ног). */
const G_REST: V3 = [4, 7.5, 6];
const G0: GPose = {
  ph: 0,
  rel: 0,
  walk: 0,
  fist: G_REST,
  lean: 0,
  crouch: 0,
  guard: 0.5,
  core: 0.4,
  charge: 0,
  side: 0,
  dk: 0,
};

function gravRig(o: GPose, yaw: number): Rig {
  const r = new Rig();
  const B = F3.yaw(yaw);
  const fall = o.dk > 0 ? sstep(0, 0.45, o.dk) : 0;
  const H = 10.5 - o.crouch * 2 - fall * 4;
  const hip = B.at(0, 0, H).roll(o.side);
  const body = hip.pitch(o.lean + fall * 0.3);
  const stone: Mat = { T: GRAV_T };
  const plate: Mat = { T: GRAV_PLATE, spec: true };
  // Ноги — короткие столбы; шаг вдоль `rel`.
  const legsFrom = r.size;
  for (const s of [-1, 1]) {
    const p = (o.ph + (s > 0 ? 0.5 : 0)) % 1;
    const sw = -Math.cos(p * TAU) * 2.6 * o.walk;
    const up = Math.max(0, Math.sin(p * TAU)) * 1.6 * o.walk;
    const hp = hip.p(0, s * 3.4, -1);
    const ft = B.p(Math.cos(o.rel) * sw, s * 3.8 + Math.sin(o.rel) * sw, up);
    const kn = ik2(hp, ft, 5.2, 5.2, B.v(1, s * 0.3, 0));
    r.cap(hp, kn, 2.4, 2.0, stone);
    r.cap(kn, ft, 2.0, 2.2, stone);
    r.ell(F3.yaw(yaw, ft), [0.8, 0, 0.6], [2.6, 2.4, 1.0], plate);
  }
  // Корпус: глыба торса, пластины на плечах, ядро в груди.
  const bodyFrom = r.size;
  r.ell(body, [0, 0, 6], [5.4, 6.4, 6.2], stone);
  r.ell(body, [0.6, 0, 9.5], [4.0, 6.6, 2.6], plate);
  const core = body.p(4.2, 0, 6.4);
  r.ell(body, [3.9, 0, 6.4], [1.2, 2.4, 2.4], {
    T: GRAV_CORE,
    glow: 0.5 + o.core * 0.5,
    bias: o.core * 0.4,
    soft: true,
  });
  // Голова, вжатая в плечи: забрало со щелью.
  const hd = body.at(1.2, 0, 12.6);
  r.ell(hd, [0, 0, 0], [2.6, 2.6, 2.2], plate);
  r.line(hd.p(2.55, -1.4, 0.2), hd.p(2.55, 1.4, 0.2), hx('#d8c8ff'), 1, 0.5);
  if (o.dk <= 0) r.eye = hd.p(2.6, 0, 0.2);
  // Левая рука со щитом.
  const shL = body.p(0.5, -6.6, 9.2);
  const handL = body.p(4.5 + o.guard * 2.2, -5.5 + o.guard * 1.2, 6);
  const elL = ik2(shL, handL, 4.8, 4.8, body.v(-0.3, -1, -0.6));
  r.ball(shL, 2.6, plate);
  r.cap(shL, elL, 2.0, 1.7, stone);
  r.cap(elL, handL, 1.7, 1.6, stone);
  const sh = body.at(4.8 + o.guard * 2.6, -4.2 + o.guard * 1.6, 6.2).turn(-0.35 + o.guard * 0.25);
  const ring: V3[] = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    ring.push(sh.p(0, Math.cos(a) * 4.6, Math.sin(a) * 5.4));
  }
  r.poly(ring, {
    T: GRAV_PLATE,
    pat: (q, l) => {
      const c0 = sh.o;
      const d = Math.hypot(q[0] - c0[0], q[1] - c0[1], q[2] - c0[2]);
      if (d > 4.0) return tone(BRASS, l + 0.2);
      if (d < 1.3) return GRAV_CORE[2];
      return null;
    },
    gpat: (q) => (Math.hypot(q[0] - sh.o[0], q[1] - sh.o[1], q[2] - sh.o[2]) < 1.3 ? 0.8 : 0),
  });
  // Правая рука с кулаком.
  const shR = body.p(0.5, 6.6, 9.2);
  const fist = B.p(o.fist[0], o.fist[1], o.fist[2]);
  const elR = ik2(shR, fist, 9, 9, body.v(-0.6, 0.6, -0.2));
  r.ball(shR, 2.6, plate);
  r.cap(shR, elR, 2.1, 1.9, stone);
  r.cap(elR, fist, 1.9, 2.1, stone);
  r.ell(F3.yaw(yaw, fist), [0, 0, 0], [2.9, 2.7, 2.6], {
    ...plate,
    glow: o.charge * 0.6,
    bias: o.charge * 0.35,
  });
  if (o.charge > 0.2)
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + o.charge * 5;
      const rr = 4.5 * (1.4 - o.charge);
      r.dot(vadd(fist, [Math.cos(a) * rr, Math.sin(a) * rr, Math.sin(a * 2) * 2]), VIOLET_GLOW, 1, 1, 0.6);
    }
  if (o.dk > 0) {
    r.explode(sstep(0.35, 1, o.dk), core, 41, 6, 34, bodyFrom, 0.15);
    r.explode(sstep(0.45, 1, o.dk) * 0.5, core, 7, 3, 12, legsFrom, 0.05);
  }
  return r;
}

function gravPic(o: GPose, yaw: number, post?: (o: RigOut, P: Proj2) => void): Pic {
  return draw(gravRig(o, yaw), 72, 72, 36, 50, post);
}

/** Где кулак в кадр удара: точка метки мозга (`punchAt` вперёд), чуть над полом. */
const G_PUNCH: V3 = [GRAVITON.punchAt * TS - 3, 2, 3];

registerMobPainter('f15_graviton', (m: Mob, pose: MobPose) => {
  const t = pose.t;
  const md = pose.mode;
  const v = visOf(m, pose, m.face, 60);
  const { d, yaw } = side16(m.face);
  const o: GPose = { ...G0 };
  const extra: Partial<MobFrame> = { shadow: 13 };
  let anim = 'idle';
  let f = 0;
  let post: ((o: RigOut, P: Proj2) => void) | undefined;
  if (md === 'dying') {
    const T = 1.3;
    f = fi(t, 31);
    const k = f / FPS / T;
    anim = 'die';
    o.dk = k;
    o.core = k < 0.35 ? 1 : 1 - sstep(0.35, 0.6, k);
    o.fist = vlerp(G_REST, [6, 7, 2], sstep(0, 0.4, k));
    o.guard = 0.5 * (1 - k);
    o.side = 0.2 * sstep(0, 0.4, k);
    if (k < 0.5)
      post = (out, P) => {
        const [x, y] = P([4, 0, 16]);
        const lit = litOn(out);
        const rr = 10 * (1 - k / 0.5);
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * TAU + k * 4;
          lit.set(Math.round(x + Math.cos(a) * rr), Math.round(y + Math.sin(a) * rr * 0.7), alpha(VIOLET_GLOW, 0.9));
        }
      };
    extra.linger = T;
    extra.alpha = 1 - sstep(0.75, 1, k);
    extra.shadow = 13 * (1 - k * 0.6);
  } else if (md === 'windup') {
    // Замах кулаком: подъём вверх-назад, задержка с набором, удар в круг.
    const T = 0.95;
    f = fi(t, 22);
    const k = (f + 0.5) / FPS / T;
    anim = 'punch';
    const up = easeOut(k / 0.55);
    const slam = easeIn((k - 0.8) / 0.2);
    const high: V3 = [-3, 7, 24];
    o.fist = slam > 0 ? vlerp(high, G_PUNCH, slam) : vlerp(G_REST, high, up);
    o.lean = -0.18 * up * (1 - slam) + 0.5 * slam;
    o.crouch = 0.4 * up + 0.6 * slam;
    o.guard = 0.8;
    o.charge = sstep(0.3, 0.8, k) * (1 - slam * 0.3);
    o.core = 0.4 + 0.6 * sstep(0.2, 0.8, k);
    o.side = -0.06 * up * (1 - slam);
    if (slam > 0.3)
      post = (out, P) => {
        // След кулака: дуга сверху вниз.
        const lit = litOn(out);
        const pts: [number, number][] = [];
        for (let i = 0; i <= 8; i++) {
          const s = (slam * i) / 8;
          const q = vlerp(high, G_PUNCH, s);
          pts.push(P(F3.yaw(yaw).p(q[0], q[1], q[2])));
        }
        for (let i = 1; i < pts.length; i++)
          stroke(lit, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], alpha(i > 6 ? WHITE : VIOLET_GLOW, 0.3 + (i / 8) * 0.6), 2);
      };
    extra.still = true;
  } else if (md === 'recover') {
    const T = 0.9;
    f = fi(t, 21);
    const k = (f + 0.5) / FPS / T;
    if (v.prev === 'windup') {
      // Проводка: кулак лежит в пыли, отдача по корпусу, затем уходит назад.
      anim = 'slam';
      const hold = 1 - sstep(0.35, 1, k);
      o.fist = vlerp(G_REST, G_PUNCH, hold);
      o.lean = 0.5 * hold;
      o.crouch = 0.6 * hold + (k < 0.12 ? 0.3 : 0);
      o.guard = 0.8;
      o.core = 0.4 + 0.4 * hold;
      o.charge = Math.max(0, 1 - k * 5) * 0.8;
      if (k < 0.45)
        post = (out, P) => {
          const g = F3.yaw(yaw).p(G_PUNCH[0], G_PUNCH[1], 0);
          const [x, y] = P(g);
          dustPuffs(out.p, x, y, scrAng(yaw) + PI, k / 0.45, 7, 29);
          dustPuffs(out.p, x, y, scrAng(yaw), k / 0.45, 5, 31);
          burstPx(litOn(out), x, y - 2, k / 0.3, 8, 10, VIOLET_GLOW, 3);
        };
    } else {
      anim = 'rec';
    }
    extra.still = true;
  } else if (md === 'stun' || pose.anim === 'hurt') {
    f = fi(t, 6);
    anim = 'hurt';
    const k = 1 - f / 6;
    o.lean = -0.12 * k;
    o.guard = 1;
    o.core = 0.4 + 0.5 * k;
  } else if (moving(m, 0.3)) {
    const ta = rigYaw(Math.atan2(m.vy, m.vx));
    const rb = Math.round(angD(ta, yaw) / (TAU / 8));
    f = Math.floor((v.dist / 1.4) * 8) % 8;
    anim = 'walk' + (((rb % 8) + 8) % 8);
    o.walk = 1;
    o.rel = (rb * TAU) / 8;
    o.ph = f / 8;
    o.side = Math.sin((f / 8) * TAU) * 0.07;
    o.crouch = Math.abs(Math.cos((f / 8) * TAU)) * 0.25;
    o.fist = [4 - Math.sin((f / 8) * TAU) * 1.5, 7.5, 6];
  } else {
    f = Math.floor(pose.now * 2.5) % 4;
    anim = 'idle';
    o.crouch = f === 1 || f === 2 ? 0.15 : 0;
    o.core = 0.35 + (f === 2 ? 0.25 : f === 1 ? 0.12 : 0);
  }
  return mobFrame('grav', pose, anim, f, d, () => gravPic(o, yaw, post), extra);
});

registerMobWarm('f15_graviton', function* () {
  const pose: MobPose = {
    anim: 'run',
    frame: 0,
    mode: 'chase',
    t: 0,
    left: false,
    flash: false,
    look: 'normal',
    now: 0,
  };
  for (let d = 0; d < NDIR; d++) {
    const yaw = (d / NDIR) * TAU;
    for (let f = 0; f < 8; f++) {
      mobFrame('grav', pose, 'walk0', f, d, () =>
        gravPic(
          {
            ...G0,
            walk: 1,
            ph: f / 8,
            side: Math.sin((f / 8) * TAU) * 0.07,
            crouch: Math.abs(Math.cos((f / 8) * TAU)) * 0.25,
            fist: [4 - Math.sin((f / 8) * TAU) * 1.5, 7.5, 6],
          },
          yaw,
        ),
      );
      yield 0;
    }
  }
});


// --- Звездочёт ----------------------------------------------------------------
//
// Сутулый звездочёт в мантии с узором созвездий (узор по координатам тела —
// поворачивается с ним), капюшон с двумя огоньками, посох с армиллярной
// сферой. Три камня-щита кружат вокруг по орбите — сколько их сейчас
// (`m.data.stones`), столько и рисуется: камни сбиваются ударами и
// отрастают, рисунок не врёт. Камни дорисовываются поверх готового кадра
// тела (за телом — дальние, перед ним — ближние), чтобы не множить кадры.
// Колодец: посох вверх, сфера крутится — удар посохом оземь ровно в кадр,
// когда мозг ставит колодец. Залп: посох наводится, на навершии копятся
// три звезды, выстрел — отдача.

const ROBE = tn('#0c0c2a', '#18184a', '#262a70', '#3a44a0');
const ROBE_IN = tn('#06061a', '#0c0c2a', '#141444', '#1c1c5a');
const STAFF = tn('#2a1a0c', '#4a3018', '#7a5228', '#b08040');

/** Звёзды мантии: точки и пары-штрихи на сфере тела. */
const robeStar = (q: V3) => {
  const a = Math.atan2(q[2], q[1]);
  const h = q[0];
  const cell = hash(Math.floor(a * 3.2 + 50), Math.floor(h * 2.2 + 50), 9);
  return cell > 0.82;
};

interface APose {
  /** Шаг 0…1 (подол, носки). */
  ph: number;
  walk: number;
  /** Посох: кисть правой руки в осях земли (вперёд, вправо, вверх). */
  hand: V3;
  /** Навершие посоха — куда смотрит (вектор в осях земли). */
  tip: V3;
  lean: number;
  /** Поворот сферы на навершии. */
  spin: number;
  /** Сколько звёзд копится на навершии 0…3 (дробно — набор). */
  stars: number;
  glow: number;
  /** Левая рука к небу (каст колодца) 0…1. */
  raise: number;
  dk: number;
}
const A_HAND: V3 = [3.5, 5.5, 8];
const A0: APose = {
  ph: 0,
  walk: 0,
  hand: A_HAND,
  tip: [0.3, 0.2, 1],
  lean: 0.1,
  spin: 0,
  stars: 0,
  glow: 0.3,
  raise: 0,
  dk: 0,
};

function astroRig(o: APose, yaw: number): Rig {
  const r = new Rig();
  const B = F3.yaw(yaw);
  const body = B.at(0, 0, 0).pitch(o.lean);
  const fall = o.dk > 0 ? sstep(0, 0.5, o.dk) : 0;
  const robe: Mat = {
    T: ROBE,
    pat: (q, l) => (robeStar([q[0], q[1], q[2]]) && l > 0 ? hx('#fff4d0') : null),
  };
  // Мантия: колокол от плеч до пола, подол качается.
  const sw = Math.sin(o.ph * TAU) * 1.2 * o.walk;
  const hem = B.p(sw * 0.4, 0, 1.2);
  const neck = body.p(0.4, 0, 14 - fall * 6);
  const from = r.size;
  r.cap(hem, neck, 5.6 - fall, 2.8, robe);
  r.ell(F3.yaw(yaw, hem), [0, 0, 0], [5.8, 5.8, 1.6], { T: ROBE_IN });
  // Носки под подолом.
  if (o.walk > 0)
    for (const s of [-1, 1]) {
      const p = Math.sin(o.ph * TAU + (s > 0 ? PI : 0));
      r.ell(F3.yaw(yaw, B.p(2.5 + p * 2, s * 2, 0.8)), [0, 0, 0], [1.6, 1.1, 0.9], { T: ROBE_IN });
    }
  // Капюшон-колпак и лицо во тьме.
  const hd = F3.yaw(yaw, vadd(neck, B.v(0.6, 0, 2.6))).pitch(o.lean * 0.5);
  r.ell(hd, [0, 0, 0], [3.0, 3.0, 3.2], robe);
  r.cap(hd.p(-0.6, 0, 2.2), hd.p(-3.2, 0, 7.0), 2.6, 0.4, robe);
  r.ell(hd, [1.9, 0, -0.4], [1.3, 2.0, 2.0], { T: ROBE_IN, flat: 0 });
  for (const s of [-1, 1])
    r.dot(hd.p(2.9, s * 0.9, -0.2), o.dk > 0 ? INK : hx('#ffe9a0'), o.dk > 0 ? 0 : 1, 1, 0.8);
  if (o.dk <= 0) r.eye = hd.p(2.9, -0.9, -0.2);
  // Плечи и рукава.
  const shR = body.p(0.6, 3.2, 12.6 - fall * 6);
  const shL = body.p(0.6, -3.2, 12.6 - fall * 6);
  const hand = B.p(o.hand[0], o.hand[1], o.hand[2] - fall * 5);
  const elR = ik2(shR, hand, 4.6, 4.6, B.v(-0.4, 1, -0.6));
  r.cap(shR, elR, 1.9, 1.6, robe);
  r.cap(elR, hand, 1.6, 2.0, robe);
  const handL = B.p(2.5 + o.raise * 1.5, -4 - o.raise * 0.5, 7.5 + o.raise * 12 - fall * 4);
  const elL = ik2(shL, handL, 4.6, 4.6, B.v(-0.4, -1, -0.4));
  r.cap(shL, elL, 1.9, 1.6, robe);
  r.cap(elL, handL, 1.6, 2.0, robe);
  if (o.raise > 0.3) r.dot(vadd(handL, [0, 0, 1.5]), hx('#fff4d0'), 1, 2, 0.8);
  // Посох: древко через кисть, навершие — сфера с двумя кольцами.
  const td = vnorm(B.v(o.tip[0], o.tip[1], o.tip[2]));
  const top = vadd(hand, vmul(td, 9));
  const bot = vadd(hand, vmul(td, -10));
  r.cap(bot, top, 0.8, 0.9, { T: STAFF });
  const core = vadd(top, vmul(td, 2.2));
  r.ball(core, 1.3, { T: tn('#6a4410', '#f0b838', '#fff2b0', '#ffffff'), glow: 0.6 + o.glow * 0.4 });
  for (let k = 0; k < 2; k++) {
    const n = 10;
    let prev: V3 | null = null;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * TAU;
      const R = 3.0;
      const sp = o.spin + k * 1.3;
      const P: V3 =
        k === 0
          ? vadd(core, [Math.cos(a) * R, Math.sin(a) * R * Math.cos(sp), Math.sin(a) * R * Math.sin(sp)])
          : vadd(core, [Math.cos(a) * R * Math.cos(sp), Math.sin(a) * R, Math.cos(a) * R * Math.sin(sp)]);
      if (prev) r.line(prev, P, k ? hx('#c09038') : hx('#f4dc8a'), 0.5, 0.2);
      prev = P;
    }
  }
  // Звёзды на навершии — набор залпа.
  for (let i = 0; i < 3; i++) {
    const k = clamp01(o.stars - i);
    if (k <= 0) continue;
    const a = (i / 3) * TAU + o.spin * 2;
    const P = vadd(core, [Math.cos(a) * 4.2 * (1.4 - k * 0.4), Math.sin(a) * 4.2, 1.5 + Math.sin(a) * 1.5]);
    r.dot(P, k > 0.95 ? WHITE : hx('#fff4d0'), 1, k > 0.5 ? 2 : 1, 1.2);
  }
  if (o.dk > 0) r.explode(sstep(0.4, 1, o.dk), body.p(0, 0, 6), 51, 5, 20, from, 0.4);
  return r;
}

function astroPic(o: APose, yaw: number, post?: (o: RigOut, P: Proj2) => void): Pic {
  return draw(astroRig(o, yaw), 64, 64, 32, 46, post);
}

// Камни на орбите: свой маленький кадр на каждый поворот, кладутся поверх.
const STONE_N = 6;
const STONES = new Map<string, HTMLCanvasElement>();
function stoneImg(i: number, rot: number, lit: boolean): HTMLCanvasElement {
  const key = `${i}|${rot}|${lit ? 1 : 0}`;
  let c = STONES.get(key);
  if (c) return c;
  const r = new Rig();
  const F = F3.yaw((rot / STONE_N) * TAU + i).pitch(0.6 + i);
  r.ell(F, [0, 0, 0], [2.4 - i * 0.3, 1.8, 1.6 + i * 0.2], {
    T: METEOR,
    pat: (q, l) => (Math.abs(q[0] + q[2] * 0.4) < 0.18 && l > -0.2 ? hx('#ffd060') : null),
    gpat: (q) => (Math.abs(q[0] + q[2] * 0.4) < 0.18 ? 0.9 : 0),
  });
  const o = renderRig(r, 9, 9, 4.5, 6.5);
  c = (lit ? (o.lit ?? new Px(9, 9)) : o.p).canvas();
  STONES.set(key, c);
  return c;
}

/** Кадр тела с камнями: дальние за телом, ближние перед ним. */
const WITH_STONES = new WeakMap<MobFrame, Map<string, MobFrame>>();
function withStones(fr: MobFrame, n: number, phase: number, lift: number): MobFrame {
  if (n <= 0) return fr;
  const key = `${n}|${phase}|${lift}`;
  let mp = WITH_STONES.get(fr);
  if (!mp) WITH_STONES.set(fr, (mp = new Map()));
  let out = mp.get(key);
  if (out) return out;
  if (mp.size > 96) mp.clear();
  const w = fr.img.width;
  const h = fr.img.height;
  const mk = () => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  };
  const img = mk();
  const g = img.getContext('2d');
  const lit = mk();
  const gl = lit.getContext('2d');
  if (!g || !gl) return fr;
  const pts: { x: number; y: number; z: number; i: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = (phase / 24) * TAU + (i / 3) * TAU;
    const R = 13;
    const wx = Math.cos(a) * R;
    const wy = Math.sin(a) * R;
    const wz = 9 + lift + Math.sin(a * 2 + i) * 1.5;
    const [x, y, z] = proj([wx, wy, wz], fr.ax, fr.ay);
    pts.push({ x, y, z, i });
  }
  const put = (front: boolean) => {
    for (const p of pts) {
      if (p.z > 0 !== front) continue;
      const rot = (phase + p.i * 2) % STONE_N;
      g.drawImage(stoneImg(p.i, rot, false), Math.round(p.x - 4.5), Math.round(p.y - 6.5));
      gl.drawImage(stoneImg(p.i, rot, true), Math.round(p.x - 4.5), Math.round(p.y - 6.5));
    }
  };
  put(false);
  g.drawImage(fr.img, 0, 0);
  if (fr.lit) gl.drawImage(fr.lit, 0, 0);
  put(true);
  out = { ...fr, img, lit };
  mp.set(key, out);
  return out;
}

registerMobPainter('f15_astro', (m: Mob, pose: MobPose) => {
  const t = pose.t;
  const md = pose.mode;
  const cast = md === 'f15_cast_well' || md === 'f15_cast_bolt';
  const v = visOf(m, pose, cast || md === 'recover' ? m.face : headOf(m), 9);
  const { d, yaw } = side16(v.yaw);
  const o: APose = { ...A0 };
  const extra: Partial<MobFrame> = { shadow: 8 };
  let anim = 'idle';
  let f = 0;
  let post: ((o: RigOut, P: Proj2) => void) | undefined;
  const stones = md === 'dying' ? 0 : Math.max(0, Math.min(3, m.data.stones ?? ASTRO.stones));
  if (md === 'dying') {
    const T = 1.1;
    f = fi(t, 26);
    const k = f / FPS / T;
    anim = 'die';
    o.dk = k;
    o.glow = 1 - k;
    o.lean = 0.1 + 0.4 * sstep(0, 0.5, k);
    extra.linger = T;
    extra.alpha = 1 - sstep(0.7, 1, k);
    extra.shadow = 8 * (1 - k);
  } else if (md === 'f15_cast_well') {
    // Колодец: посох и рука вверх, сфера раскручивается — посох оземь.
    const T = ASTRO.castWell;
    f = fi(t, 21);
    const k = (f + 0.5) / FPS / T;
    anim = 'well';
    const up = easeOut(k / 0.55);
    const down = easeIn((k - 0.82) / 0.18);
    o.hand = vlerp(vlerp(A_HAND, [3, 4, 15], up), [5, 4, 5], down);
    o.tip = [0.15 + down * 0.3, 0.1, 1];
    o.raise = up * (1 - down * 0.5);
    o.lean = -0.12 * up * (1 - down) + 0.2 * down;
    o.spin = k * 9;
    o.glow = 0.4 + 0.6 * k;
    extra.still = true;
  } else if (md === 'f15_cast_bolt') {
    // Залп: посох наводится вперёд, на навершии копятся три звезды.
    const T = ASTRO.castBolt;
    f = fi(t, 17);
    const k = (f + 0.5) / FPS / T;
    anim = 'bolt';
    const aim = easeOut(k / 0.45);
    o.hand = vlerp(A_HAND, [6, 3, 10], aim);
    o.tip = [aim * 1.6 + 0.3, 0, 1 - aim * 0.6];
    o.lean = 0.15 * aim;
    o.stars = 3 * sstep(0.25, 0.95, k);
    o.spin = k * 6;
    o.glow = 0.4 + 0.6 * k;
    extra.still = true;
  } else if (md === 'recover') {
    const T = 0.4;
    f = fi(t, 9);
    const k = (f + 0.5) / FPS / T;
    if (v.prev === 'f15_cast_bolt') {
      // Отдача: посох вскинут, вспышка на навершии гаснет.
      anim = 'boltfol';
      const kick = 1 - easeOut(k);
      o.hand = vlerp(A_HAND, [4, 3, 11], kick);
      o.tip = [kick * 0.8 + 0.3, 0, 1];
      o.lean = -0.12 * kick;
      o.glow = kick;
      if (k < 0.5)
        post = (out, P) => {
          const tip = F3.yaw(yaw).p(9, 3, 18);
          const [x, y] = P(tip);
          burstPx(litOn(out), x, y, k / 0.5, 8, 7, hx('#fff4d0'), 11);
        };
    } else if (v.prev === 'f15_cast_well') {
      // Посох стоит в полу, от него по земле — кольцо.
      anim = 'wellfol';
      const hold = 1 - sstep(0.3, 1, k);
      o.hand = vlerp(A_HAND, [5, 4, 5], hold);
      o.tip = [0.45 * hold + 0.15, 0.1, 1];
      o.lean = 0.2 * hold;
      o.glow = hold;
      post = (out, P) => {
        const [x, y] = P(F3.yaw(yaw).p(5, 4, 0));
        const lit = litOn(out);
        const rr = 3 + k * 7;
        for (let i = 0; i < 20; i++) {
          const a = (i / 20) * TAU;
          lit.set(Math.round(x + Math.cos(a) * rr), Math.round(y + Math.sin(a) * rr * SE), alpha(GOLDK, 0.8 * (1 - k)));
        }
      };
    } else anim = 'rec';
    extra.still = true;
  } else if (md === 'stun' || pose.anim === 'hurt') {
    f = fi(t, 6);
    anim = 'hurt';
    const k = 1 - f / 6;
    o.lean = -0.25 * k;
    o.hand = [2, 5, 9];
  } else if (moving(m)) {
    f = Math.floor((v.dist / 0.9) * 8) % 8;
    anim = 'walk';
    o.walk = 1;
    o.ph = f / 8;
    o.lean = 0.16;
    o.hand = [4 + Math.sin((f / 8) * TAU) * 1.5, 5.5, 8 + Math.abs(Math.cos((f / 8) * TAU))];
    o.spin = f * 0.4;
  } else {
    f = Math.floor(pose.now * 3) % 6;
    anim = 'idle';
    o.spin = f * 0.5;
    o.lean = 0.08 + (f % 3 === 1 ? 0.04 : 0);
  }
  const fr = mobFrame('astro', pose, anim, f, d, () => astroPic(o, yaw, post), extra);
  return withStones(fr, stones, Math.floor(pose.now * 8) % 24, 0);
});

registerMobWarm('f15_astro', function* () {
  const pose: MobPose = {
    anim: 'run',
    frame: 0,
    mode: 'chase',
    t: 0,
    left: false,
    flash: false,
    look: 'normal',
    now: 0,
  };
  for (let d = 0; d < NDIR; d++) {
    const yaw = (d / NDIR) * TAU;
    for (let f = 0; f < 8; f++) {
      mobFrame('astro', pose, 'walk', f, d, () =>
        astroPic(
          {
            ...A0,
            walk: 1,
            ph: f / 8,
            lean: 0.16,
            hand: [4 + Math.sin((f / 8) * TAU) * 1.5, 5.5, 8 + Math.abs(Math.cos((f / 8) * TAU))],
            spin: f * 0.4,
          },
          yaw,
        ),
      );
      yield 0;
    }
  }
});


// --- Страж созвездия -----------------------------------------------------------
//
// Узел фигуры — живая звезда: ядро и восемь лучей-кристаллов, ведущий луч
// смотрит по ходу, звезда кренится в сторону движения и медленно вертится
// вокруг себя (лучи повторяются через 90° — восемь кадров). Спит рисунком
// на полу: плоская звезда; встаёт — рисунок отрывается от пола, из него
// вверх тянется столб света. Вспышка: лучи втягиваются, ядро белеет —
// лучи выстреливают во всю длину ровно в кадр урона. Линии между узлами
// рисует картинка фигуры (`f15_figure`, хлыст — `f15_lash`).

const STAR_T = tn('#6a5a20', '#c0a040', '#ffe9a0', '#ffffff');
const STAR_CORE = tn('#c09038', '#ffd060', '#fff4d0', '#ffffff');

interface SPose {
  spin: number;
  tilt: number;
  /** Длина лучей (1 — обычная). */
  ext: number;
  glow: number;
  /** Сплющенность: 1 — рисунок на полу. */
  flat: number;
  /** Столб света вниз (подъём), длина в пикселях. */
  beam: number;
  dk: number;
}
const S0: SPose = { spin: 0, tilt: 0.25, ext: 1, glow: 0.4, flat: 0, beam: 0, dk: 0 };

function constelRig(o: SPose, yaw: number): Rig {
  const r = new Rig();
  const Y = F3.yaw(yaw);
  const base = Y.at(0, 0, 5 * (1 - o.flat) + 0.6).pitch(o.tilt).turn(o.spin);
  const fl = 1 - o.flat * 0.9;
  const F = new F3(base.o, base.f, base.s, vmul(base.u, fl));
  const ray: Mat = { T: STAR_T, glow: 0.5 + o.glow * 0.5, spec: true, bias: o.glow * 0.2 - 0.1 };
  const from = r.size;
  const c = F.o;
  const rays: [V3, number][] = [
    [[1, 0, 0], 7.5],
    [[0, 1, 0], 6],
    [[-1, 0, 0], 6],
    [[0, -1, 0], 6],
    [[0, 0, 1], 5],
    [[0, 0, -1], 4],
  ];
  for (const [d, L] of rays) {
    const dir = F.v(d[0], d[1], d[2]);
    r.cap(c, vadd(c, vmul(dir, L * o.ext)), 1.5, 0.15, ray);
  }
  for (let i = 0; i < 4; i++) {
    const a = (i + 0.5) * (TAU / 4);
    const dir = F.v(Math.cos(a), Math.sin(a), 0);
    r.cap(c, vadd(c, vmul(dir, 3.8 * o.ext)), 1.0, 0.1, ray);
  }
  r.ball(c, 1.4 + o.glow * 0.6, { T: STAR_CORE, glow: 1, soft: true, bias: 0.1 + o.glow * 0.4 });
  if (o.beam > 0) {
    r.line(c, vadd(c, [0, 0, -o.beam]), alpha(STAR_C, 0.8), 1, -0.5);
    r.line(vadd(c, [0.6, 0, 0]), vadd(c, [0.6, 0, -o.beam * 0.8]), alpha(STAR_C, 0.35), 1, -0.6);
  }
  if (o.dk > 0) r.explode(sstep(0, 1, o.dk), c, 61, 9, 18, from, 0.6);
  return r;
}

function constelPic(o: SPose, yaw: number, post?: (o: RigOut, P: Proj2) => void): Pic {
  return draw(constelRig(o, yaw), 40, 48, 20, 34, post, { inner: 0 });
}

registerMobPainter('f15_constel', (m: Mob, pose: MobPose) => {
  const t = pose.t;
  const md = pose.mode;
  const v = visOf(m, pose, headOf(m), 7);
  const { d, yaw } = side16(v.yaw);
  const o: SPose = { ...S0 };
  const extra: Partial<MobFrame> = { shadow: 5 };
  let anim = 'idle';
  let f = 0;
  let post: ((o: RigOut, P: Proj2) => void) | undefined;
  const spin = Math.floor(pose.now * 6) % 8;
  o.spin = (spin / 8) * (TAU / 4);
  if (md === 'f15_rise') {
    // Встаёт: плоский рисунок на полу отрывается и поднимается, столб света.
    const T = 1.2;
    f = fi(t, 28);
    const k = (f + 0.5) / FPS / T;
    anim = 'rise';
    const up = easeOut(sstep(0.3, 1, k));
    o.flat = 1 - sstep(0.15, 0.7, k);
    o.tilt = 0;
    o.glow = 0.3 + 0.7 * sstep(0, 0.4, k) * (1 - up * 0.5);
    o.beam = 6 * up;
    o.ext = 0.7 + 0.3 * k;
    extra.lift = 6 * up;
    extra.still = true;
    extra.shadow = 5 * up;
  } else if (md === 'dying') {
    const T = 0.9;
    f = fi(t, 21);
    const k = f / FPS / T;
    anim = 'die';
    o.dk = k;
    o.glow = 1 - k;
    extra.linger = T;
    extra.alpha = 1 - sstep(0.6, 1, k);
    extra.lift = 6 * (1 - easeIn(k));
    extra.still = true;
  } else if (md === 'windup') {
    // Вспышка: лучи втягиваются, ядро белеет — выстрел лучами в кадр урона.
    const T = 0.8;
    f = fi(t, 18);
    const k = (f + 0.5) / FPS / T;
    anim = 'flare';
    const pull = easeOut(k / 0.75);
    const fire = easeOut((k - 0.88) / 0.12);
    o.ext = 1 - 0.55 * pull + 1.2 * fire;
    o.glow = 0.4 + 0.6 * pull;
    o.tilt = 0;
    o.spin = o.spin + pull * 0.6;
    extra.still = true;
    extra.lift = 6 - pull * 2;
  } else if (md === 'recover') {
    const T = 0.5;
    f = fi(t, 11);
    const k = (f + 0.5) / FPS / T;
    anim = v.prev === 'windup' ? 'flarefol' : 'rec';
    if (v.prev === 'windup') {
      const ex = 1 - easeOut(k);
      o.ext = 1 + 1.2 * ex;
      o.glow = 0.4 + 0.6 * ex;
      o.tilt = 0;
      if (k < 0.5)
        post = (out, P) => {
          const [x, y] = P([0, 0, 5]);
          const lit = litOn(out);
          const rr = 4 + k * 26;
          for (let i = 0; i < 24; i++) {
            const a = (i / 24) * TAU;
            lit.set(Math.round(x + Math.cos(a) * rr), Math.round(y + Math.sin(a) * rr * 0.6), alpha(STAR_C, 0.9 * (1 - k * 2)));
          }
        };
      extra.lift = 4 + 2 * k;
    }
    extra.still = true;
  } else if (moving(m, 0.25)) {
    anim = 'fly';
    f = spin;
    o.tilt = 0.35;
  } else {
    anim = 'idle';
    f = spin;
    o.tilt = 0.1;
    o.glow = 0.4 + (spin % 4 === 1 ? 0.2 : 0);
  }
  return mobFrame('constel', pose, anim, f, d, () => constelPic(o, yaw, post), extra);
});

registerMobWarm('f15_constel', function* () {
  const pose: MobPose = {
    anim: 'run',
    frame: 0,
    mode: 'chase',
    t: 0,
    left: false,
    flash: false,
    look: 'normal',
    now: 0,
  };
  for (let d = 0; d < NDIR; d++) {
    const yaw = (d / NDIR) * TAU;
    for (let f = 0; f < 8; f++) {
      mobFrame('constel', pose, 'fly', f, d, () =>
        constelPic({ ...S0, spin: (f / 8) * (TAU / 4), tilt: 0.35 }, yaw),
      );
      yield 0;
    }
  }
});

// --- Спутник -------------------------------------------------------------------------
//
// Малая луна с лицом: кратеры медленно проворачиваются вокруг оси (узор по
// координатам шара — не кипит), глаза смотрят по ходу. Прицел: сжимается и
// отводится назад-вверх, край светится; пике — вытянулась в каплю, белый
// шлейф; после — отскок вверх с кувырком.

const MOON_T = tn('#34324a', '#666480', '#a8a4bc', '#f0eef8');
const CRATERS: [V3, number][] = [
  [vnorm([0.3, 0.8, 0.5]), 0.93],
  [vnorm([-0.6, 0.2, 0.7]), 0.95],
  [vnorm([0.1, -0.7, 0.6]), 0.9],
  [vnorm([-0.4, -0.5, -0.6]), 0.92],
  [vnorm([0.7, 0.1, -0.6]), 0.94],
  [vnorm([-0.9, 0.3, -0.2]), 0.9],
];

interface OPose {
  spin: number;
  /** Сжатие вдоль хода (−) или вытяжка (+). */
  str: number;
  glow: number;
  eyes: number;
  roll: number;
  dk: number;
}
const O0: OPose = { spin: 0, str: 0, glow: 0.2, eyes: 1, roll: 0, dk: 0 };

function moonRig(o: OPose, yaw: number): Rig {
  const r = new Rig();
  const F = F3.yaw(yaw).at(0, 0, 5).pitch(o.roll);
  const cs = Math.cos(o.spin);
  const sn = Math.sin(o.spin);
  const from = r.size;
  const sk = 1 + o.str;
  r.ell(F, [0, 0, 0], [5 * sk, 5 / Math.sqrt(sk), 5 / Math.sqrt(sk)], {
    T: MOON_T,
    bias: o.glow * 0.3,
    glow: o.glow > 0.5 ? (o.glow - 0.5) * 0.6 : 0,
    pat: (q, l) => {
      const p: V3 = [q[0] * cs - q[1] * sn, q[0] * sn + q[1] * cs, q[2]];
      for (const [c, k] of CRATERS) {
        const dd = vdot(p, c);
        if (dd > k + (1 - k) * 0.45) return tone(MOON_T, l - 0.55);
        if (dd > k) return tone(MOON_T, l + (vdot(c, [-0.45, 0.2, 0.8]) > 0 ? -0.3 : 0.35));
      }
      return null;
    },
  });
  if (o.dk <= 0)
    for (const s of [-1, 1]) {
      const eye = F.p(4.6 * sk, s * 1.6, 1.0);
      r.dot(eye, o.eyes > 0.5 ? hx('#1a1830') : hx('#4a4860'), 0, 1, 0.6);
      if (o.eyes > 0.5) r.dot(vadd(eye, [0, 0, 0.9]), hx('#1a1830'), 0, 1, 0.6);
    }
  if (o.dk <= 0) r.eye = F.p(4.6, -1.6, 1.0);
  if (o.dk > 0) {
    // Раскол: две половинки разлетаются и падают.
    r.prims.length = from;
    const k = sstep(0, 1, o.dk);
    for (const s of [-1, 1]) {
      const H = F.at(0, s * (1 + k * 7), -k * k * 9).roll(s * k * 1.4);
      r.ell(H, [0, 0, 0], [5, 5, 5], { T: MOON_T, bias: -0.1 }, (q) => q[1] * s < 0);
    }
  }
  return r;
}

function moonPic(o: OPose, yaw: number, post?: (o: RigOut, P: Proj2) => void): Pic {
  return draw(moonRig(o, yaw), 32, 32, 16, 22, post);
}

registerMobPainter('f15_moon', (m: Mob, pose: MobPose) => {
  const t = pose.t;
  const md = pose.mode;
  const dive = md === 'f15_dive';
  const tech = md === 'aim' || dive;
  const v = visOf(m, pose, tech ? m.dir : headOf(m), dive ? 40 : 10);
  const { d, yaw } = side16(v.yaw);
  const o: OPose = { ...O0 };
  const extra: Partial<MobFrame> = { shadow: 4 };
  let anim = 'idle';
  let f = 0;
  const spin = Math.floor(pose.now * 4) % 8;
  o.spin = (spin / 8) * TAU;
  if (md === 'dying') {
    const T = 0.85;
    f = fi(t, 20);
    const k = f / FPS / T;
    anim = 'die';
    o.dk = k;
    extra.linger = T;
    extra.alpha = 1 - sstep(0.6, 1, k);
    extra.lift = 6 * (1 - easeIn(k));
    extra.still = true;
  } else if (md === 'aim') {
    // Прицел: отводится назад-вверх, сжимается, край накаляется.
    const T = MOON.aim;
    f = fi(t, 14);
    const k = (f + 0.5) / FPS / T;
    anim = 'aim';
    o.str = -0.22 * easeOut(k / 0.6);
    o.glow = 0.2 + 0.8 * k;
    o.eyes = 0;
    o.roll = -0.3 * k;
    extra.lift = 6 + 4 * easeOut(k);
    extra.dx = -Math.cos(scrAng(yaw)) * 2 * easeOut(k);
    extra.still = true;
  } else if (dive) {
    // Пике: капля с белым шлейфом, почти у пола.
    f = Math.floor(pose.now * 12) % 2;
    anim = 'dive';
    o.str = 0.45;
    o.glow = 1;
    o.eyes = 0;
    o.roll = 0.35;
    extra.lift = 2;
    extra.still = true;
    extra.ghost = { every: 0.025, life: 0.2, tint: '220,215,255', alpha: 0.55 };
  } else if (md === 'recover' && v.prev === 'f15_dive') {
    // Отскок вверх с кувырком.
    const T = 0.45;
    f = fi(t, 10);
    const k = (f + 0.5) / FPS / T;
    anim = 'bounce';
    o.roll = -k * TAU * 0.75;
    o.str = -0.15 * (1 - k);
    o.glow = 0.6 * (1 - k);
    extra.lift = 2 + 6 * Math.sin(PI * k * 0.75) + 2 * k;
    extra.still = true;
  } else {
    anim = moving(m) ? 'fly' : 'idle';
    f = spin;
    o.roll = moving(m) ? 0.2 : 0;
  }
  return mobFrame('moon', pose, anim, f, d, () => moonPic(o, yaw), extra);
});

registerMobWarm('f15_moon', function* () {
  const pose: MobPose = {
    anim: 'run',
    frame: 0,
    mode: 'chase',
    t: 0,
    left: false,
    flash: false,
    look: 'normal',
    now: 0,
  };
  for (let d = 0; d < NDIR; d++) {
    const yaw = (d / NDIR) * TAU;
    for (let f = 0; f < 8; f++) {
      mobFrame('moon', pose, 'fly', f, d, () => moonPic({ ...O0, spin: (f / 8) * TAU, roll: 0.2 }, yaw));
      yield 0;
    }
  }
});


// --- Пожиратель света -------------------------------------------------------------
//
// Скат из пустоты: тёмное тело и крылья с фиолетовой каймой по свету, пасть
// — чёрное кольцо. Вокруг него свет гаснет: под ним мутное пятно тьмы, к
// пасти тянутся искры. Во тьме (затмение, рядом нет лампы) он
// полупрозрачный — там его и не берут удары: рисунок говорит то же, что
// игра. Гасит лампу: зависает, крылья запахиваются вперёд, свет лампы
// струйками течёт в пасть. Хватка: взмах крыльями вверх — бросок пастью
// со следом.

const VOID_T = tn('#06040e', '#100a20', '#1e1438', '#34245c');
const VOID_RIM = hx('#9a7ae8');

interface DPose {
  /** Взмах крыльев: −1 вниз … 1 вверх. */
  flap: number;
  /** Крылья запахнуты вперёд 0…1. */
  wrap: number;
  maw: number;
  pitch: number;
  fwd: number;
  tail: number;
  dk: number;
}
const D0: DPose = { flap: 0, wrap: 0, maw: 0.2, pitch: 0, fwd: 0, tail: 0, dk: 0 };

function devRig(o: DPose, yaw: number): Rig {
  const r = new Rig();
  const B = F3.yaw(yaw).at(o.fwd, 0, 5).pitch(o.pitch);
  const skin: Mat = {
    T: VOID_T,
    pat: (_q, l) => (l > 0.93 ? VOID_RIM : null),
  };
  const from = r.size;
  r.ell(B, [0, 0, 0], [5.4, 3.8, 2.2], skin);
  // Крылья: передняя кромка от плеча к концу, задняя — к хвосту.
  for (const s of [-1, 1]) {
    const tipU = o.flap * 5 - o.dk * 3;
    const tipF = -1.5 + o.wrap * 6;
    const tipS = s * (11 - o.wrap * 4);
    const sh = B.p(2.5, s * 2.8, 0.3);
    const tip = B.p(tipF, tipS, tipU);
    const mid = B.p(-1.5 + o.wrap * 3, s * (7 - o.wrap * 2), tipU * 0.5 - 0.6);
    const back = B.p(-4.2, s * 2.4, -0.2);
    r.poly([sh, tip, mid], skin);
    r.poly([sh, mid, back], skin);
    r.poly([mid, tip, B.p(tipF - 3, tipS * 0.8, tipU * 0.7)], { ...skin, bias: -0.15 });
  }
  // Хвост-плеть.
  let prev = B.p(-5, 0, 0);
  for (let i = 1; i <= 4; i++) {
    const k = i / 4;
    const P = B.p(-5 - k * 8, Math.sin(o.tail + k * 2.4) * 2.2 * k, -k * 1.5);
    r.cap(prev, P, 0.9 - k * 0.5, 0.7 - k * 0.5, skin);
    prev = P;
  }
  // Пасть — чёрное кольцо, светящаяся кайма; глаза над ней.
  const mw = B.at(5.0, 0, -0.2);
  const R = 1.2 + o.maw * 1.8;
  r.ell(mw, [0, 0, 0], [0.6, R, R * 0.8], { T: tn('#000000', '#020104', '#05030a', '#0a0614'), flat: 0 });
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU;
    r.dot(mw.p(0.3, Math.cos(a) * (R + 0.4), Math.sin(a) * (R + 0.4) * 0.8), alpha(VOID_RIM, 0.9), 0.7, 1, 0.4);
  }
  if (o.dk <= 0)
    for (const s of [-1, 1]) r.dot(B.p(3.6, s * 1.6, 1.8), hx('#d8b8ff'), 1, 1, 0.6);
  if (o.dk <= 0) r.eye = B.p(3.6, -1.6, 1.8);
  if (o.dk > 0) r.explode(sstep(0, 1, o.dk), B.o, 81, 7, 6, from, 0.7);
  return r;
}

/** Мутное пятно тьмы под пожирателем (рисуется в кадре под телом). */
function voidHalo(p: Px, cx: number, cy: number, R: number, k: number): void {
  for (let y = Math.floor(cy - R); y <= cy + R; y++)
    for (let x = Math.floor(cx - R); x <= cx + R; x++) {
      const d = Math.hypot(x + 0.5 - cx, (y + 0.5 - cy) / 0.7) / R;
      if (d >= 1 || p.data[(y * p.w + x) * 4 + 3] > 0) continue;
      const a = (1 - d) * (1 - d) * 0.5 * k;
      if (a > 0.04 && dith(x, y) + 0.5 < a * 2.2) p.set(x, y, alpha(hx('#05030c'), a));
    }
}

function devPic(o: DPose, yaw: number, halo: number, post?: (o: RigOut, P: Proj2) => void): Pic {
  return draw(devRig(o, yaw), 64, 52, 32, 34, (out, P) => {
    const [x, y] = P([0, 0, 0]);
    voidHalo(out.p, x, y, 18, halo);
    if (post) post(out, P);
  });
}

registerMobPainter('f15_devourer', (m: Mob, pose: MobPose) => {
  const t = pose.t;
  const md = pose.mode;
  const tech = md === 'f15_snuff' || md === 'windup' || md === 'recover';
  const v = visOf(m, pose, tech ? m.face : headOf(m), 6);
  const { d, yaw } = side16(v.yaw);
  const sa = scrAng(yaw);
  const sim = paintSim();
  const dark = sim ? inDark(sim, m.x, m.y) : false;
  const o: DPose = { ...D0 };
  const extra: Partial<MobFrame> = { shadow: 9, lift: 8 };
  let anim = 'fly';
  let f = 0;
  let post: ((o: RigOut, P: Proj2) => void) | undefined;
  if (md === 'dying') {
    // Рассеивается дымом: крылья опадают, тело расползается.
    const T = 0.9;
    f = fi(t, 21);
    const k = f / FPS / T;
    anim = 'die';
    o.dk = k;
    o.maw = 1;
    o.flap = -0.5;
    extra.linger = T;
    extra.alpha = 1 - sstep(0.4, 1, k);
    extra.lift = 8 * (1 - k * 0.6);
    extra.still = true;
  } else if (md === 'f15_snuff') {
    // Гасит лампу: зависает, запахивает крылья, свет течёт в пасть.
    const T = DEVOURER.snuff;
    f = fi(t, 23);
    const k = (f + 0.5) / FPS / T;
    anim = 'snuff';
    o.wrap = easeOut(k / 0.4);
    o.maw = 0.4 + 0.6 * easeOut(k / 0.3);
    o.flap = Math.sin(k * 18) * 0.25;
    o.pitch = 0.15;
    o.tail = k * 6;
    post = (out, P) => {
      const [mx, my] = P(F3.yaw(yaw).p(5.5, 0, 5));
      const lit = litOn(out);
      for (let i = 0; i < 6; i++) {
        const s = ((f * 0.13 + i / 6) % 1);
        const a = sa + (hash(i, 3, 5) - 0.5) * 0.9;
        const rr = 4 + (1 - s) * 18;
        const x = mx + Math.cos(a) * rr;
        const y = my + Math.sin(a) * rr * 0.7 + (1 - s) * 2;
        stroke(lit, x, y, x - Math.cos(a) * 2, y - Math.sin(a) * 1.4, alpha(hx('#ffe9a0'), 0.35 + s * 0.6));
      }
    };
    extra.still = true;
  } else if (md === 'windup') {
    // Хватка: крылья вверх, отводит голову — бросок пастью со следом.
    const T = 0.85;
    f = fi(t, 20);
    const k = (f + 0.5) / FPS / T;
    anim = 'grab';
    const up = easeOut(k / 0.65);
    const go = easeOut((k - 0.78) / 0.22);
    o.flap = up * (1 - go) - 0.8 * go;
    o.pitch = -0.25 * up * (1 - go) + 0.3 * go;
    o.fwd = -3 * up * (1 - go) + 6 * go;
    o.maw = 0.3 + 0.7 * go + 0.3 * up * (1 - go);
    o.wrap = 0.6 * go;
    if (k > 0.78) post = biteTrail(18, sa, 1.6, (k - 0.78) / 0.22, 1, VOID_RIM);
    extra.still = true;
  } else if (md === 'recover' && v.prev === 'windup') {
    const T = 0.55;
    f = fi(t, 13);
    const k = (f + 0.5) / FPS / T;
    anim = 'grabfol';
    const hold = 1 - sstep(0.2, 0.9, k);
    o.flap = -0.8 * hold;
    o.pitch = 0.3 * hold;
    o.fwd = 6 * hold;
    o.maw = 0.3 + 0.5 * hold;
    o.wrap = 0.6 * hold;
    if (k < 0.4) post = biteTrail(18, sa, 1.6, 1, 1 - k / 0.4, VOID_RIM);
    extra.still = true;
  } else {
    // Полёт: взмах из восьми кадров; на месте — медленнее.
    const fly = moving(m);
    f = Math.floor(pose.now * (fly ? 9 : 6)) % 8;
    anim = fly ? 'fly' : 'hover';
    o.flap = Math.sin((f / 8) * TAU);
    o.tail = (f / 8) * TAU;
    o.pitch = fly ? 0.12 : 0;
    extra.dy = -o.flap * 0.8;
  }
  if (dark) extra.alpha = Math.min(extra.alpha ?? 1, 0.42);
  return mobFrame('dev', pose, anim, f, d, () => devPic(o, yaw, 1, post), extra);
});

registerMobWarm('f15_devourer', function* () {
  const pose: MobPose = {
    anim: 'run',
    frame: 0,
    mode: 'chase',
    t: 0,
    left: false,
    flash: false,
    look: 'normal',
    now: 0,
  };
  for (let d = 0; d < NDIR; d++) {
    const yaw = (d / NDIR) * TAU;
    for (let f = 0; f < 8; f++) {
      mobFrame('dev', pose, 'fly', f, d, () =>
        devPic({ ...D0, flap: Math.sin((f / 8) * TAU), tail: (f / 8) * TAU, pitch: 0.12 }, yaw, 1),
      );
      yield 0;
    }
  }
});

// --- Сверхновая ---------------------------------------------------------------------
//
// Звёздный голем: солнце-ядро в треснувшей скорлупе из каменных пластин,
// тяжёлые ноги и руки. Набор: пластины расходятся, ядро белеет и растёт,
// руки разводятся — вспышка кольцом ровно в кадр урона (кольцо рисует
// картинка `f15_novaburst`), пластины выбивает наружу, потом они со стуком
// встают на место. Гибель: пластины по спирали стягиваются к ядру, ядро
// гаснет в фиолет и схлопывается в точку — на её месте мозг ставит колодец.

const NOVA_T = tn('#b0501a', '#f08a28', '#ffd060', '#fff8d8');
const NOVA_SHELL = tn('#1a1014', '#2e1c1c', '#4a3028', '#6e4a38');

/** Пластины скорлупы: нормаль на сфере ядра. */
const NOVA_PLATES: V3[] = (() => {
  const out: V3[] = [];
  const lats = [-0.5, 0.15, 0.75];
  lats.forEach((la, j) => {
    const n = j === 2 ? 3 : 5;
    for (let i = 0; i < n; i++) {
      const lo = ((i + j * 0.5) / n) * TAU;
      out.push([Math.cos(lo) * Math.cos(la), Math.sin(lo) * Math.cos(la), Math.sin(la)]);
    }
  });
  return out;
})();

interface NPose {
  ph: number;
  walk: number;
  /** Пластины отошли от ядра (пиксели). */
  open: number;
  /** Ядро: яркость и рост. */
  core: number;
  arms: number;
  /** Схлопывание 0…1. */
  col: number;
  shake: number;
  lean: number;
}
const N0: NPose = { ph: 0, walk: 0, open: 0, core: 0.4, arms: 0, col: 0, shake: 0, lean: 0 };

function novaRig(o: NPose, yaw: number): Rig {
  const r = new Rig();
  const B = F3.yaw(yaw);
  const col = o.col;
  const H = 9 - col * 3;
  const body = B.at(0, 0, H).pitch(o.lean);
  const stone: Mat = { T: NOVA_SHELL, pat: (q, l) => (crackF(q) < 0.12 ? NOVA_T[2] : tone(NOVA_SHELL, l)), gpat: (q) => (crackF(q) < 0.12 ? 0.8 : 0) };
  const legsAlive = col < 0.4;
  // Ноги и руки (при схлопывании втягиваются).
  if (legsAlive) {
    const lk = 1 - col / 0.4;
    for (const s of [-1, 1]) {
      const p = (o.ph + (s > 0 ? 0.5 : 0)) % 1;
      const sw = -Math.cos(p * TAU) * 2.4 * o.walk;
      const up = Math.max(0, Math.sin(p * TAU)) * 1.4 * o.walk;
      const hp = body.p(0, s * 3.4, -3);
      const ft = vlerp(B.p(sw, s * 4, up), hp, 1 - lk);
      const kn = ik2(hp, ft, 4.2, 4.2, B.v(1, 0, 0));
      r.cap(hp, kn, 2.2 * lk, 1.8 * lk, stone);
      r.cap(kn, ft, 1.8 * lk, 2.2 * lk, stone);
    }
    for (const s of [-1, 1]) {
      const sh = body.p(0, s * 7, 4);
      const hand = body.p(1.5 + o.arms * 1, s * (8.5 + o.arms * 5), 0 + o.arms * 9);
      const h2 = vlerp(hand, sh, 1 - lk);
      const el = ik2(sh, h2, 4.5, 4.5, body.v(-0.4, s, -0.5));
      r.cap(sh, el, 2.0 * lk, 1.7 * lk, stone);
      r.cap(el, h2, 1.7 * lk, 2.4 * lk, stone);
    }
  }
  // Ядро.
  const coreC = body.p(0, 0, 3);
  const cr = (3.6 + o.core * 1.6) * (1 - col * 0.85);
  const coreT: Tones =
    col > 0.3 ? [VIOLET[0], VIOLET[1], mixc(VIOLET[2], NOVA_T[2], 1 - col), WHITE] : NOVA_T;
  r.ball(coreC, cr, { T: coreT, glow: 1, soft: true, bias: 0.15 + o.core * 0.5 });
  // Пластины: по нормали от ядра, при схлопывании — спиралью внутрь.
  const from = r.size;
  NOVA_PLATES.forEach((n0, i) => {
    const sp = col * (2.4 + (i % 3) * 0.5);
    const c0 = Math.cos(sp);
    const s0 = Math.sin(sp);
    const n: V3 = [n0[0] * c0 - n0[1] * s0, n0[0] * s0 + n0[1] * c0, n0[2]];
    const jit = o.shake ? (hash(i, 1, 9) - 0.5) * o.shake : 0;
    const dist = (6.2 + o.open + jit) * (1 - col * 0.9);
    const nw = body.v(n[0], n[1], n[2]);
    const c = vadd(coreC, vmul(nw, dist));
    const ref: V3 = Math.abs(nw[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const e1 = vnorm([nw[1] * ref[2] - nw[2] * ref[1], nw[2] * ref[0] - nw[0] * ref[2], nw[0] * ref[1] - nw[1] * ref[0]]);
    const e2: V3 = [nw[1] * e1[2] - nw[2] * e1[1], nw[2] * e1[0] - nw[0] * e1[2], nw[0] * e1[1] - nw[1] * e1[0]];
    const F = new F3(c, nw, e1, e2);
    const sz = (1 - col * 0.6) * (i % 2 ? 1 : 0.85);
    r.ell(F, [0, 0, 0], [1.2, 2.9 * sz, 2.6 * sz], stone);
  });
  // Глаза — щели на верхней пластине-короне.
  if (col < 0.2) {
    const top = body.p(1.8, 0, 3 + 6.2 + o.open);
    for (const s of [-1, 1]) r.dot(vadd(top, B.v(1.6, s * 1.4, -1)), WHITE, 1, 1, 1);
    r.eye = vadd(top, B.v(1.6, -1.4, -1));
  }
  if (col > 0.85) r.prims.length = from;
  return r;
}

function novaPic(o: NPose, yaw: number, post?: (o: RigOut, P: Proj2) => void): Pic {
  return draw(novaRig(o, yaw), 64, 64, 32, 46, post);
}

registerMobPainter('f15_nova', (m: Mob, pose: MobPose) => {
  const t = pose.t;
  const md = pose.mode;
  const v = visOf(m, pose, md === 'chase' ? headOf(m) : m.face, 5);
  const { d, yaw } = side16(v.yaw);
  const o: NPose = { ...N0 };
  const extra: Partial<MobFrame> = { shadow: 12 };
  let anim = 'idle';
  let f = 0;
  let post: ((o: RigOut, P: Proj2) => void) | undefined;
  if (md === 'dying') {
    // Схлопывание: пластины спиралью к ядру, ядро в фиолет и в точку.
    const T = 0.8;
    f = fi(t, 19);
    const k = f / FPS / T;
    anim = 'die';
    o.col = easeIn(k / 0.85);
    o.core = 1 - k;
    post = (out, P) => {
      const [x, y] = P([0, 0, 12 - o.col * 3]);
      const lit = litOn(out);
      if (k > 0.8) {
        const rr = 2 + (k - 0.8) * 60;
        for (let i = 0; i < 24; i++) {
          const a = (i / 24) * TAU;
          lit.set(Math.round(x + Math.cos(a) * rr), Math.round(y + Math.sin(a) * rr * 0.7), alpha(VIOLET_GLOW, 1 - (k - 0.8) * 5));
        }
      } else
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * TAU + k * 6;
          const rr = 22 * (1 - k);
          lit.set(Math.round(x + Math.cos(a) * rr), Math.round(y + Math.sin(a) * rr * 0.7), alpha(NOVA_T[2], 0.9));
        }
    };
    extra.linger = T;
    extra.shadow = 12 * (1 - k);
    extra.still = true;
  } else if (md === 'f15_gather') {
    // Набор света: скорлупа раскрывается, ядро растёт, руки вверх.
    const T = NOVA.gather;
    f = fi(t, 33);
    const k = (f + 0.5) / FPS / T;
    anim = 'gather';
    o.open = 3.5 * easeOut(k);
    o.core = 0.4 + 0.6 * k;
    o.arms = easeOut(k / 0.7);
    o.lean = -0.12 * o.arms;
    o.shake = k > 0.75 ? 1.6 * ((f % 2) * 2 - 1) : 0;
    post = (out, P) => {
      const [x, y] = P([0, 0, 12]);
      const lit = litOn(out);
      for (let i = 0; i < 8; i++) {
        const s = (k * 3 + i / 8) % 1;
        const a = (i / 8) * TAU + i;
        const rr = 26 * (1 - s);
        lit.set(Math.round(x + Math.cos(a) * rr), Math.round(y + Math.sin(a) * rr * 0.7), alpha(NOVA_T[3], 0.4 + s * 0.6));
      }
    };
    extra.still = true;
  } else if (md === 'recover' && v.prev === 'f15_gather') {
    // Выброс: пластины выбиты наружу и со стуком встают назад, ядро тускнеет.
    const T = 0.8;
    f = fi(t, 19);
    const k = (f + 0.5) / FPS / T;
    anim = 'burst';
    const out = k < 0.12 ? 1 : 1 - easeOut((k - 0.12) / 0.6);
    o.open = 7 * out;
    o.core = 1 - 0.6 * k;
    o.arms = out;
    o.lean = 0.1 * (1 - out);
    extra.still = true;
  } else if (md === 'stun' || pose.anim === 'hurt') {
    f = fi(t, 6);
    anim = 'hurt';
    o.open = 1.5 * (1 - f / 6);
    o.lean = -0.1;
  } else if (moving(m, 0.3)) {
    f = Math.floor((v.dist / 1.3) * 8) % 8;
    anim = 'walk';
    o.walk = 1;
    o.ph = f / 8;
    o.core = 0.4 + 0.1 * Math.sin((f / 8) * TAU * 2);
  } else {
    f = Math.floor(pose.now * 3) % 4;
    anim = 'idle';
    o.core = 0.35 + (f === 1 ? 0.12 : f === 2 ? 0.2 : 0.05);
    o.open = f === 2 ? 0.4 : 0;
  }
  return mobFrame('nova', pose, anim, f, d, () => novaPic(o, yaw, post), extra);
});

registerMobWarm('f15_nova', function* () {
  const pose: MobPose = {
    anim: 'run',
    frame: 0,
    mode: 'chase',
    t: 0,
    left: false,
    flash: false,
    look: 'normal',
    now: 0,
  };
  for (let d = 0; d < NDIR; d++) {
    const yaw = (d / NDIR) * TAU;
    for (let f = 0; f < 8; f++) {
      mobFrame('nova', pose, 'walk', f, d, () =>
        novaPic({ ...N0, walk: 1, ph: f / 8, core: 0.4 + 0.1 * Math.sin((f / 8) * TAU * 2) }, yaw),
      );
      yield 0;
    }
  }
});

// --- Золотой метеорит --------------------------------------------------------------
//
// Самородок на шести быстрых лапках: золото гранями (узор по телу), за ним
// золотая пыль. Удирает лицом по ходу, в вираже вокруг колодца кренится.
// Монеты сыплются по-настоящему (добыча движка) — рисунок их не выдумывает.
// Ушёл (14 с) — вертится волчком и исчезает искрой.

interface BPose {
  ph: number;
  bank: number;
  spin: number;
  shrink: number;
  glint: number;
  dk: number;
}
const B0: BPose = { ph: 0, bank: 0, spin: 0, shrink: 0, glint: 0, dk: 0 };

function bugRig(o: BPose, yaw: number): Rig {
  const r = new Rig();
  const B = F3.yaw(yaw + o.spin).at(0, 0, 4.2).roll(o.bank).scale(1 - o.shrink);
  const gold: Mat = {
    T: GOLD,
    spec: true,
    pat: (q, l) => {
      // Грани: тон по квантованной нормали — кусок самородка.
      const fq = Math.round(q[0] * 2) * 0.31 + Math.round(q[1] * 2) * 0.17 + Math.round(q[2] * 2) * 0.43;
      return tone(GOLD, l + (fq % 0.3) - 0.1);
    },
  };
  const legM: Mat = { T: BRASS, bias: -0.1 };
  const from = r.size;
  const hips: [number, number, number][] = [
    [2.4, -1, 0],
    [2.4, 1, 0.5],
    [0, -1, 0.5],
    [0, 1, 0],
    [-2.4, -1, 0],
    [-2.4, 1, 0.5],
  ];
  for (const [hf, s, off] of hips) {
    const p = (o.ph + off) % 1;
    const sw = -Math.cos(p * TAU) * 1.8;
    const up = Math.max(0, Math.sin(p * TAU)) * 1.4;
    const hip = B.p(hf * 0.8, s * 2.4, -1.4);
    const ft = F3.yaw(yaw + o.spin).p(hf + sw, s * 5.2, up);
    bugLeg(r, hip, vlerp(ft, hip, o.shrink), F3.yaw(yaw).v(0, s, 0), legM, 0.7);
  }
  r.ell(B, [-0.6, 0, 0.4], [4.4, 3.4, 3.0], gold);
  r.ell(B, [3.4, 0, -0.2], [1.8, 2.0, 1.6], { T: BRASS });
  for (const s of [-1, 1]) {
    r.dot(B.p(4.6, s * 1.0, 0.4), hx('#3a1a00'), 0, 1, 0.5);
    r.cap(B.p(4.4, s * 0.8, 1.0), B.p(6.4, s * 2.2, 2.6), 0.4, 0.2, legM);
  }
  r.eye = B.p(4.6, -1.0, 0.4);
  if (o.glint > 0) r.dot(B.p(-0.6, -1.2, 3.3), WHITE, 1, 2, 1);
  if (o.dk > 0) r.explode(sstep(0, 1, o.dk), B.o, 91, 9, 22, from, 0.4);
  return r;
}

function bugPic(o: BPose, yaw: number, post?: (o: RigOut, P: Proj2) => void): Pic {
  return draw(bugRig(o, yaw), 40, 36, 20, 24, post);
}

registerMobPainter('f15_goldbug', (m: Mob, pose: MobPose) => {
  const t = pose.t;
  const md = pose.mode;
  const v = visOf(m, pose, headOf(m), 16);
  const { d, yaw } = side16(v.yaw);
  const o: BPose = { ...B0 };
  const extra: Partial<MobFrame> = { shadow: 6 };
  let anim = 'run';
  let f = 0;
  if (md === 'escape') {
    // Ушёл: волчок, сжимается, вспышка-искра.
    f = fi(t, 9);
    const k = (f + 0.5) / FPS / 0.4;
    anim = 'escape';
    o.spin = k * TAU * 1.5;
    o.shrink = easeIn(k) * 0.85;
    o.glint = 1;
    const post = (out: RigOut, P: Proj2) => {
      if (k < 0.5) return;
      const [x, y] = P([0, 0, 4]);
      const lit = litOn(out);
      const a = (k - 0.5) * 2;
      sparkle(lit, Math.round(x), Math.round(y), alpha(WHITE, 1 - a * 0.5), Math.round(1 + a * 4));
    };
    extra.still = true;
    extra.alpha = 1 - sstep(0.7, 1, k);
    return mobFrame('gbug', pose, anim, f, d, () => bugPic(o, yaw, post), extra);
  }
  if (md === 'dying') {
    const T = 0.8;
    f = fi(t, 19);
    const k = f / FPS / T;
    anim = 'die';
    o.dk = k;
    extra.linger = T;
    extra.alpha = 1 - sstep(0.6, 1, k);
  } else if (md === 'stun' || pose.anim === 'hurt') {
    f = fi(t, 6);
    anim = 'hurt';
    o.bank = (f % 2 ? 0.3 : -0.3) * (1 - f / 6);
    o.glint = 1;
  } else {
    f = Math.floor((v.dist / 0.55) * 8) % 8;
    const bank = Math.max(-1, Math.min(1, Math.round(v.yr / 4)));
    anim = 'run' + bank;
    o.ph = f / 8;
    o.bank = bank * 0.3;
    o.glint = f === 3 ? 1 : 0;
    extra.dy = -Math.abs(Math.sin((f / 8) * TAU * 2)) * 0.8;
    extra.ghost = { every: 0.06, life: 0.3, tint: '255,208,96', alpha: 0.35 };
  }
  return mobFrame('gbug', pose, anim, f, d, () => bugPic(o, yaw), extra);
});


// --- Отражение: тени прошлых этажей ---------------------------------------------------
//
// Монстр прошлого этажа, перекрашенный звёздным светом: берём кадр его же
// рисовальщика и переводим яркость в палитру «индиго → бирюза → белое».
// Перекраска считается раз на кадр источника и не зависит от времени,
// звёздные искры стоят на своих точках фигуры — ничего не «кипит».
// Рождение: друза кристалла памяти трескается, осколки расходятся и
// падают, из неё поднимается фигура.

/** Чей рисовальщик даёт тень каждому мотиву (в порядке `MOTIFS`). */
const ECHO_SRC = ['f1_rat', 'f2_shroom', 'f6_salamander', 'f7_phantom', 'f11_harpy', 'f14_soldier'];
const SPECTRAL: RGBA[] = [
  hx('#140a38'),
  hx('#3a2a90'),
  hx('#6a7ae0'),
  hx('#9ae8ff'),
  hx('#ffffff'),
];
const ECHO_TINT = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();

/** Перекрасить кадр в звёздную палитру; искры — по пикселям фигуры, без времени. */
function spectral(src: HTMLCanvasElement): HTMLCanvasElement {
  const hit = ECHO_TINT.get(src);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const g = c.getContext('2d');
  if (!g || !src.width || !src.height) return src;
  g.drawImage(src, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height);
  const W = c.width;
  for (let i = 0; i < d.data.length; i += 4) {
    if (!d.data[i + 3]) continue;
    const l = (d.data[i] * 0.3 + d.data[i + 1] * 0.55 + d.data[i + 2] * 0.15) / 255;
    const px = (i >> 2) % W;
    const py = Math.floor((i >> 2) / W);
    const star = l > 0.35 && hash(px, py, 1511) > 0.975;
    const col = star ? STAR_C : ramp(SPECTRAL, Math.min(1, l * 1.25 + 0.08));
    d.data[i] = col[0];
    d.data[i + 1] = col[1];
    d.data[i + 2] = col[2];
    d.data[i + 3] = Math.round(d.data[i + 3] * 0.88);
  }
  g.putImageData(d, 0, 0);
  ECHO_TINT.set(src, c);
  return c;
}

/** Своё эхо на случай, если чужого рисовальщика нет: облачко-силуэт. */
function echoFallback(f: number, motif: number): Pic {
  const p = new Px(28, 30);
  const cx = 14;
  glow(p, cx, 16, 11, hx('#9ae8ff'), 0.35);
  shadeEll(p, cx, 16, 7, 8, tn('#1a1048', '#3a3aa0', '#6a8ae0', '#c8f4ff'), 0.1);
  for (let i = 0; i < 4; i++) p.set(cx - 5 + i * 3, 24 + ((f + i) % 2), alpha(hx('#9ae8ff'), 0.7));
  motifGlyph(p, cx, 15, motif, WHITE);
  return { p, lit: litOf(p), ax: cx, ay: 26, eye: null };
}

/** Друза памяти на рождении: `k` 0 — целая, 1 — осколки разошлись и легли. */
function bornShell(k: number): Pic {
  const r = new Rig();
  const m: Mat = { T: CRYST, spec: true, glow: 0.35 + (1 - k) * 0.4 };
  const open = easeOut(sstep(0.25, 0.8, k));
  const drop = easeIn(sstep(0.45, 1, k));
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU + 0.3;
    const out = 1.5 + open * 9;
    const b: V3 = [Math.cos(a) * out, Math.sin(a) * out, 0];
    const lean = 0.25 + open * 1.1;
    const dir: V3 = [Math.cos(a) * lean, Math.sin(a) * lean, 1 - drop * 0.8];
    const L = (9 + (i % 3) * 3) * (1 - drop * 0.55);
    r.spike(b, dir, L, 2.2, m, 4, i);
  }
  if (k < 0.3) r.ball([0, 0, 6], 3 * (1 - k / 0.3), { T: CRYST, glow: 1, soft: true, bias: 0.6 });
  const o = renderRig(r, 48, 48, 24, 36);
  return { p: o.p, lit: o.lit, ax: 24, ay: 36, eye: null };
}
const BORN = new Map<number, Pic>();
const bornAt = (f: number) => {
  let b = BORN.get(f);
  if (!b) BORN.set(f, (b = bornShell(f / 16)));
  return b;
};

/** Наложить друзу на кадр фигуры (по точке ног), с кешем на пару. */
const ECHO_BORN = new WeakMap<HTMLCanvasElement, Map<number, MobFrame>>();
function withShell(fr: MobFrame, f: number): MobFrame {
  let mp = ECHO_BORN.get(fr.img);
  if (!mp) ECHO_BORN.set(fr.img, (mp = new Map()));
  const hit = mp.get(f);
  if (hit) return hit;
  const sh = bornAt(f);
  const ax = Math.max(fr.ax, sh.ax);
  const ay = Math.max(fr.ay, sh.ay);
  const w = ax + Math.max(fr.img.width - fr.ax, sh.p.w - sh.ax);
  const h = ay + Math.max(fr.img.height - fr.ay, sh.p.h - sh.ay);
  const mk = () => {
    const c = document.createElement('canvas');
    c.width = Math.ceil(w);
    c.height = Math.ceil(h);
    return c;
  };
  const img = mk();
  const lit = mk();
  const g = img.getContext('2d');
  const gl = lit.getContext('2d');
  if (!g || !gl) return fr;
  // Фигура поднимается из друзы: растёт от ног и наливается.
  const rise = sstep(0.35, 1, f / 16);
  const sy = 0.3 + rise * 0.7;
  g.globalAlpha = 0.4 + rise * 0.5;
  g.drawImage(
    fr.img,
    Math.round(ax - fr.ax),
    Math.round(ay - fr.ay * sy),
    fr.img.width,
    Math.max(1, Math.round(fr.img.height * sy)),
  );
  g.globalAlpha = 1;
  g.drawImage(sh.p.canvas(), Math.round(ax - sh.ax), Math.round(ay - sh.ay));
  if (sh.lit) gl.drawImage(sh.lit.canvas(), Math.round(ax - sh.ax), Math.round(ay - sh.ay));
  const out: MobFrame = { ...fr, img, lit, ax, ay, eye: null, sy: 1, alpha: 1, ghost: null };
  mp.set(f, out);
  return out;
}

const ECHO_MODE: Record<string, string> = {
  f15_lunge_aim: 'windup',
  f15_spore: 'windup',
  f15_gust: 'windup',
  f15_tick: 'windup',
  f15_lunge: 'chase',
  f15_blink: 'chase',
  f15_born: 'idle',
};

registerMobPainter('f15_echo', (m: Mob, pose: MobPose) => {
  const motif = (((m.data.motif ?? 0) % 6) + 6) % 6;
  const src = MOB_PAINTERS.get(ECHO_SRC[motif]);
  const bornF = pose.mode === 'f15_born' ? Math.min(16, Math.floor((pose.t / ECHO.born) * 16)) : 16;
  const rise = sstep(0.35, 1, bornF / 16);
  const blink = pose.mode === 'f15_blink' && (m.data.ghost ?? 0) > 0;
  const extra: Partial<MobFrame> = {
    alpha: blink ? 0.25 : 0.4 + rise * 0.5,
    ghost: { every: 0.08, life: 0.3, tint: '140,200,255', alpha: 0.3 },
    lit: null,
    linger: undefined,
  };
  let fr: MobFrame | null = null;
  if (src) {
    try {
      const mode = ECHO_MODE[pose.mode] ?? pose.mode;
      const anim = mode === 'windup' ? 'wind' : pose.anim;
      const s = src(m, { ...pose, mode, anim, look: pose.look === 'elite' ? 'elite' : 'normal' });
      if (s && s.img)
        fr = {
          ...s,
          img: spectral(s.img),
          eye: s.eye ?? null,
          ...extra,
          sy: (s.sy ?? 1) * (0.3 + rise * 0.7),
          lit: null,
          ghost: extra.ghost,
          linger: undefined,
        };
    } catch {
      // Чужой рисовальщик упал на нашем мобе — рисуем своё.
    }
  }
  if (!fr) {
    const f = Math.floor(pose.now * 6) % 4;
    fr = mobFrame('echo', pose, 'fly', motif * 8 + f, 0, () => echoFallback(f, motif), {
      ...extra,
      sy: 0.3 + rise * 0.7,
    });
  }
  return bornF < 16 ? withShell(fr, bornF) : fr;
});

// ---------------------------------------------------------------------------
// Метки и картинки механик. Рисуются контекстом в игровых пикселях; (px, py) —
// экранная точка центра зоны, мировая точка (wx, wy) → (wx·TS − L, wy·TS − T).
// ---------------------------------------------------------------------------

/** Сдвиг экрана по зоне: мировые клетки → игровые пиксели экрана. */
const viewOf = (z: { x: number; y: number }, px: number, py: number) => {
  const L = z.x * TS - px;
  const T = z.y * TS - py;
  return (wx: number, wy: number): [number, number] => [wx * TS - L, wy * TS - T];
};

const zoneOf = <K>(z: Zone | Strike): K | null => {
  const st = stNow();
  return st ? ((st.zmap.get(z as Zone) as K | undefined) ?? null) : null;
};

/** Краски колодцев по роду: карта — бирюза, звездочёт — золото, сверхновая — пламя. */
function wellColors(w: Well): { c: string; hot: string } {
  if (w.mode < 0) return { c: '184,144,255', hot: '240,220,255' };
  switch (w.kind) {
    case 'astro':
      return { c: '255,208,96', hot: '255,244,200' };
    case 'nova':
      return { c: '255,150,60', hot: '255,240,190' };
    case 'star':
      return { c: '230,236,255', hot: '255,255,255' };
    default:
      return { c: '108,240,255', hot: '230,255,255' };
  }
}

// --- Мир живёт -------------------------------------------------------------------
//
// Одна зона-картинка на всю вылазку (`f15_life`, ставит правило этажа через
// `api.vfx`): поверх кусков карты, под мобами. Рисует только видимые
// клетки: звёзды пустоты медленно текут, кристаллы вспыхивают искрой,
// пыль невесомости плывёт по кругу, тёмная сетка тяжести давит волной,
// редкая пыль тянется к ядру (на север, к «Сердцу»). В невесомости за
// героем и мобами тянется лёгкий шлейф светящейся пыли.

/** Видимое окно в игровых пикселях экрана (с запасом). */
function viewBox(g: CanvasRenderingContext2D, pad = 24): [number, number, number, number] {
  const m = g.getTransform();
  const sc = m.a || 1;
  const x0 = -m.e / sc - pad;
  const y0 = -m.f / sc - pad;
  return [x0, y0, x0 + g.canvas.width / sc + pad * 2, y0 + g.canvas.height / sc + pad * 2];
}

/** Круг (x, y, r) в игровых пикселях экрана задевает видимое окно. */
function onScreen(g: CanvasRenderingContext2D, x: number, y: number, r: number): boolean {
  const [x0, y0, x1, y1] = viewBox(g, 0);
  return x + r >= x0 && x - r <= x1 && y + r >= y0 && y - r <= y1;
}

interface Trail {
  pts: { x: number; y: number; t: number }[];
  last: number;
  seen: number;
}
/** Чьи снаряды оставляют след дуги и каким цветом. */
const SHOT_TRAIL: Record<string, string> = { f15_needle: '140,230,255', f15_starbolt: '255,208,96' };
const SHOT_KEY = -1e6;
const TRAILS = new WeakMap<object, Map<number, Trail>>();
const HERO_TRAIL = -1e9;
const F15_HEART = 'f15heart';

function trailOf(sim: object, id: number): Trail {
  let mp = TRAILS.get(sim);
  if (!mp) TRAILS.set(sim, (mp = new Map()));
  let tr = mp.get(id);
  if (!tr) mp.set(id, (tr = { pts: [], last: -1, seen: 0 }));
  return tr;
}

/** Шлейф пыли за телом в невесомости: точки раз в 0,05 с, живут 0,6 с. */
function stepTrail(tr: Trail, x: number, y: number, time: number, on: boolean): void {
  if (on && time - tr.last > 0.05) {
    tr.pts.push({ x, y, t: time });
    tr.last = time;
  }
  while (tr.pts.length && (time - tr.pts[0].t > 0.6 || tr.pts.length > 14)) tr.pts.shift();
}

registerZonePainter('f15_life', (g, z, px, py, _s, time) => {
  const sim = paintSim();
  const st = stNow();
  if (!sim || !st || sim.area === F15_HEART) return true;
  const hb = bandOf(sim.world, F15_HEART);
  // Невесомость шторма — весь зал, без меток на полу.
  const sh = st.storm === 2 ? st.halls.find((q) => q.name === 'storm') : undefined;
  const fly = (x: number, y: number) =>
    mark[y * W + x] === MK.float || (!!sh && x >= sh.x0 && x <= sh.x1 && y >= sh.y0 && y <= sh.y1);
  const at = viewOf(z, px, py);
  const [bx0, by0, bx1, by1] = viewBox(g, 8);
  // Мир → экран: (wx, wy) → at(wx, wy). Обратно — через сдвиг нуля.
  const [ox, oy] = at(0, 0);
  const W = sim.world.w;
  const H = sim.world.h;
  const cx0 = Math.max(0, Math.floor((bx0 - ox) / TS));
  const cy0 = Math.max(0, Math.floor((by0 - oy) / TS));
  const cx1 = Math.min(W - 1, Math.ceil((bx1 - ox) / TS));
  const cy1 = Math.min(H - 1, Math.ceil((by1 - oy) / TS));
  const tiles = sim.tiles;
  const mark = sim.world.mark;
  g.save();
  for (let cy = cy0; cy <= cy1; cy++) {
    // Ряды «Сердца» рисуют агенты босса — их не трогаем.
    if (hb && cy >= hb.top && cy < hb.top + hb.h) continue;
    for (let cx = cx0; cx <= cx1; cx++) {
      const i = cy * W + cx;
      const mk = mark[i];
      const sx = ox + cx * TS;
      const sy = oy + cy * TS;
      const h0 = hash(cx, cy, 1501);
      if (tiles[i] === T_DEEP) {
        if (mk === MK.core || mk === MK.pit) continue;
        // Звёзды пустоты текут: в каждой клетке своя, поток единый.
        if (h0 < 0.45) continue;
        const u = (h0 * 7.3 + time * 0.045) % 1;
        const v = (hash(cx, cy, 1502) + time * 0.018) % 1;
        const tw = 0.45 + 0.55 * Math.sin(time * (1.5 + h0 * 2) + h0 * 40);
        g.fillStyle = h0 > 0.93 ? `rgba(200,240,255,${0.5 + tw * 0.4})` : `rgba(255,244,208,${0.18 + tw * 0.3})`;
        g.fillRect(Math.floor(sx + u * TS), Math.floor(sy + v * TS), 1, 1);
        continue;
      }
      if (mk === MK.xwall || mk === MK.memory || mk === MK.xfloor || mk === MK.vein) {
        // Кристалл вспыхивает искрой: редко, у каждой клетки свой такт.
        if (h0 < 0.55) continue;
        const ph = Math.sin(time * (0.8 + h0 * 1.4) + h0 * 60);
        if (ph > 0.97) {
          const k = (ph - 0.97) / 0.03;
          const x = Math.floor(sx + 3 + hash(cx, cy, 1503) * 10);
          const y = Math.floor(sy + 2 + hash(cx, cy, 1504) * 8);
          g.fillStyle = `rgba(220,250,255,${0.5 + k * 0.5})`;
          g.fillRect(x, y, 1, 1);
          if (k > 0.5) {
            g.fillStyle = `rgba(108,240,255,${(k - 0.5) * 1.2})`;
            g.fillRect(x - 1, y, 3, 1);
            g.fillRect(x, y - 1, 1, 3);
          }
        }
        continue;
      }
      if (fly(cx, cy)) {
        // Пыль невесомости: две пылинки на клетку ходят медленными кругами.
        for (let k = 0; k < 2; k++) {
          const hk = hash(cx, cy, 1510 + k);
          const a = time * (0.4 + hk * 0.5) + hk * TAU;
          const x = sx + 4 + hk * 8 + Math.cos(a) * 3;
          const y = sy + 4 + hash(cx, cy, 1520 + k) * 8 + Math.sin(a) * 2 - Math.sin(time * 0.7 + hk * 9) * 1.5;
          g.fillStyle = `rgba(184,220,255,${0.25 + 0.25 * Math.sin(a * 1.7)})`;
          g.fillRect(Math.floor(x), Math.floor(y), 1, 1);
        }
        continue;
      }
      if (mk === MK.heavy) {
        // Тяжесть давит: тёмная сетка вздрагивает волной сверху вниз.
        const wv = Math.sin(time * 2.2 - cy * 0.55 - cx * 0.12);
        if (wv > 0.55) {
          const k = (wv - 0.55) / 0.45;
          g.fillStyle = `rgba(4,2,14,${0.18 + k * 0.22})`;
          g.fillRect(Math.floor(sx), Math.floor(sy + TS - 1), TS, 1);
          g.fillRect(Math.floor(sx + TS - 1), Math.floor(sy), 1, TS);
          g.fillStyle = `rgba(122,86,216,${k * 0.25})`;
          g.fillRect(Math.floor(sx + 7), Math.floor(sy + 7 + k * 2), 2, 1);
        }
        continue;
      }
      // Редкая пыль тянется к ядру: на север, покачиваясь.
      if (h0 > 0.93) {
        const v = 1 - ((hash(cx, cy, 1531) + time * 0.12) % 1);
        const x = sx + 8 + Math.sin(time * 1.3 + h0 * 30) * 3;
        const y = sy + v * TS;
        const a = Math.min(1, Math.min(v, 1 - v) * 5) * 0.35;
        g.fillStyle = `rgba(255,236,190,${a})`;
        g.fillRect(Math.floor(x), Math.floor(y), 1, 1);
      }
    }
  }
  // Шлейфы невесомости: герой и мобы.
  const h = sim.hero;
  const heroTr = trailOf(sim, HERO_TRAIL);
  heroTr.seen = time;
  stepTrail(heroTr, h.x, h.y, time, st.floating && Math.hypot(st.hv[0], st.hv[1]) > 0.6);
  const draw1 = (tr: Trail, c: string) => {
    for (const p of tr.pts) {
      const age = (time - p.t) / 0.6;
      if (age >= 1) continue;
      const [x, y] = at(p.x, p.y);
      g.fillStyle = `rgba(${c},${0.45 * (1 - age)})`;
      const s = age < 0.3 ? 2 : 1;
      g.fillRect(Math.floor(x - s / 2), Math.floor(y - 2 - age * 3), s, s);
    }
  };
  draw1(heroTr, '184,230,255');
  for (const m of sim.mobs) {
    if (m.mode === 'dying') continue;
    const fl = fly(Math.floor(m.x), Math.floor(m.y));
    const tr = trailOf(sim, m.id);
    tr.seen = time;
    stepTrail(tr, m.x, m.y, time, fl && Math.hypot(m.vx, m.vy) > 0.6);
    if (tr.pts.length) draw1(tr, '200,190,255');
  }
  // Дуги снарядов: след по настоящему пути — у колодца видно, как гнёт.
  for (const sh of sim.shots) {
    const c = SHOT_TRAIL[sh.art];
    if (!c) continue;
    const tr = trailOf(sim, SHOT_KEY - sh.id);
    tr.seen = time;
    if (time - tr.last > 0.025) {
      tr.pts.push({ x: sh.x, y: sh.y, t: time });
      tr.last = time;
    }
    while (tr.pts.length && (time - tr.pts[0].t > 0.32 || tr.pts.length > 16)) tr.pts.shift();
    if (tr.pts.length < 2) continue;
    g.lineWidth = 1;
    for (let i = 1; i < tr.pts.length; i++) {
      const a0 = tr.pts[i - 1];
      const a1 = tr.pts[i];
      const k = 1 - (time - a1.t) / 0.32;
      if (k <= 0) continue;
      const [x0, y0] = at(a0.x, a0.y);
      const [x1, y1] = at(a1.x, a1.y);
      g.strokeStyle = `rgba(${c},${0.5 * k})`;
      g.beginPath();
      g.moveTo(x0, y0 - 2);
      g.lineTo(x1, y1 - 2);
      g.stroke();
    }
  }
  // Ушедшие тела и снаряды — из памяти.
  const mp = TRAILS.get(sim);
  if (mp && mp.size > 24) for (const [id, tr] of mp) if (time - tr.seen > 1) mp.delete(id);
  g.restore();
  return true;
});

/**
 * Колодец — воронка в полу. Сетка пола (кольца и спицы) прогибается к ядру:
 * кольца сбегаются к середине, спицы закручиваются; тихо — сетка почти
 * ровная и еле видна, предупреждение (секунда) — граница бьётся, сетка
 * начинает проседать, шевроны бегут к ядру; тяга — воронка во всю глубину,
 * искры по спирали внутрь (толкает — наружу и сетка горбом); к концу тяги
 * стихает. Временный колодец рождается вспышкой.
 */
registerZonePainter('f15_well', (g, z, px, py, _s, time) => {
  const w = zoneOf<Well>(z);
  if (!w) return true;
  const R = w.r * TS;
  if (!onScreen(g, px, py, R + 8)) return true;
  const { c, hot } = wellColors(w);
  const s = w.state;
  const dir = w.mode < 0 ? -1 : 1;
  const depth =
    s === 2 ? (w.f < 0.82 ? 1 : 1 - smooth((w.f - 0.82) / 0.18) * 0.5) : s === 1 ? 0.15 + 0.55 * smooth(w.f) : 0.08;
  g.save();
  // Тень воронки: глубже к середине (толкает — светлый горб).
  if (depth > 0.1) {
    const gr = g.createRadialGradient(px, py, 0, px, py, R);
    if (dir > 0) {
      gr.addColorStop(0, `rgba(2,1,10,${0.55 * depth})`);
      gr.addColorStop(0.45, `rgba(4,2,16,${0.25 * depth})`);
      gr.addColorStop(1, 'rgba(4,2,16,0)');
    } else {
      gr.addColorStop(0, `rgba(${c},${0.2 * depth})`);
      gr.addColorStop(1, `rgba(${c},0)`);
    }
    g.fillStyle = gr;
    g.beginPath();
    g.arc(px, py, R, 0, TAU);
    g.fill();
  }
  // Сетка: кольца сбегаются к ядру (r = R·u^p), спицы закручиваются.
  const p = 1 + depth * 0.9 * dir;
  const twist = depth * 1.6 * dir;
  const spin = time * 0.35 * dir * depth;
  const NR = 6;
  const NS = 12;
  g.lineWidth = 1;
  for (let j = 1; j <= NR; j++) {
    const u = j / NR;
    const rr = R * Math.pow(u, Math.max(0.4, p));
    const a = (0.08 + 0.2 * depth) * (0.45 + 0.55 * (1 - u)) * (s === 0 ? 0.6 : 1);
    g.strokeStyle = `rgba(${c},${a})`;
    g.beginPath();
    g.arc(px, py, rr, 0, TAU);
    g.stroke();
  }
  for (let i = 0; i < NS; i++) {
    const a0 = (i / NS) * TAU + spin;
    g.strokeStyle = `rgba(${c},${(0.06 + 0.14 * depth) * (s === 0 ? 0.6 : 1)})`;
    g.beginPath();
    for (let k = 0; k <= 8; k++) {
      const u = 1 - k / 8;
      const rr = R * Math.pow(Math.max(0.02, u), Math.max(0.4, p));
      const a = a0 + twist * (1 - u) * (1 - u);
      const x = px + Math.cos(a) * rr;
      const y = py + Math.sin(a) * rr;
      if (k === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
  // Граница.
  const pulse = s === 1 ? 0.5 + 0.5 * Math.sin(time * 14) : 0;
  g.strokeStyle = `rgba(${c},${s === 0 ? 0.16 : s === 1 ? 0.35 + pulse * 0.45 : 0.5 * (0.4 + 0.6 * depth)})`;
  g.setLineDash(s === 0 ? [2, 6] : [5, 3]);
  g.lineDashOffset = -time * 8 * dir;
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.stroke();
  g.setLineDash([]);
  // Рождение временного колодца: вспышка кольцом от середины.
  if (w.temp && s === 1 && w.f < 0.6) {
    const k = w.f / 0.6;
    g.strokeStyle = `rgba(${hot},${0.9 * (1 - k)})`;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(px, py, Math.max(1, R * easeOut(k)), 0, TAU);
    g.stroke();
    g.lineWidth = 1;
  }
  // Частицы: тянет — искры по спирали внутрь; предупреждает — шевроны; тихо — пыль.
  const n = Math.round((s === 2 ? 60 * depth + 8 : s === 1 ? 12 : 8) * Math.max(0.7, w.r / 5));
  for (let i = 0; i < n; i++) {
    const h0 = hash(i, w.id, 2001);
    const a0 = hash(i * 7 + 3, w.id, 2002) * TAU;
    const speed = s === 2 ? 0.55 * w.k * (0.4 + 0.6 * depth) : 0.12 + (s === 1 ? 0.2 * w.f : 0);
    let u = (time * speed + h0) % 1;
    if (dir < 0) u = 1 - u;
    const rr = R * (1 - u) + w.burn * TS * u;
    const a = a0 + (1 - u) * (1 - u) * 3.2 * dir + spin;
    const x = px + Math.cos(a) * rr;
    const y = py + Math.sin(a) * rr;
    if (s === 1) {
      const ux = -Math.cos(a) * dir;
      const uy = -Math.sin(a) * dir;
      g.strokeStyle = `rgba(${c},${0.4 + pulse * 0.4 + w.f * 0.2})`;
      g.beginPath();
      g.moveTo(x - ux * 2 - uy * 2, y - uy * 2 + ux * 2);
      g.lineTo(x, y);
      g.lineTo(x - ux * 2 + uy * 2, y - uy * 2 - ux * 2);
      g.stroke();
    } else if (s === 2) {
      // Искра со штрихом назад по спирали — видно, куда течёт.
      const fadeIn = Math.min(1, u * 5) * (1 - Math.max(0, u - 0.85) / 0.15);
      const ub = Math.min(1, Math.max(0, u - 0.04 * dir));
      const rb = R * (1 - ub) + w.burn * TS * ub;
      const ab = a0 + (1 - ub) * (1 - ub) * 3.2 * dir + spin;
      // Штрих не длиннее 6 px: у кромки спираль быстрая по углу.
      let bx = px + Math.cos(ab) * rb - x;
      let by = py + Math.sin(ab) * rb - y;
      const bl = Math.hypot(bx, by);
      if (bl > 6) {
        bx *= 6 / bl;
        by *= 6 / bl;
      }
      const al = (0.55 + u * 0.45) * fadeIn * (0.55 + 0.45 * depth);
      g.strokeStyle = `rgba(${c},${al * 0.8})`;
      g.lineWidth = h0 > 0.7 ? 2 : 1;
      g.beginPath();
      g.moveTo(x + bx, y + by);
      g.lineTo(x, y);
      g.stroke();
      g.lineWidth = 1;
      g.fillStyle = `rgba(${hot},${al})`;
      g.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2);
    } else {
      g.fillStyle = `rgba(${c},${0.22 * (1 - Math.abs(u - 0.5) * 0.6)})`;
      g.fillRect(Math.round(x), Math.round(y), 1, 1);
    }
  }
  // Ядро ожога: белое пламя, красная кайма (здесь жжёт).
  if (w.burn > 0 && s === 2) {
    const B = w.burn * TS;
    const gr = g.createRadialGradient(px, py, 0, px, py, B);
    gr.addColorStop(0, `rgba(${hot},${0.75 * (0.5 + 0.5 * depth)})`);
    gr.addColorStop(0.7, `rgba(${c},0.35)`);
    gr.addColorStop(1, 'rgba(255,90,70,0.2)');
    g.fillStyle = gr;
    g.beginPath();
    g.arc(px, py, B, 0, TAU);
    g.fill();
    g.strokeStyle = `rgba(255,110,80,${0.55 + 0.3 * Math.sin(time * 9)})`;
    g.beginPath();
    g.arc(px, py, B, 0, TAU);
    g.stroke();
  }
  g.restore();
  return true;
});

// --- Острова орбит --------------------------------------------------------------

interface IslandArt {
  top: HTMLCanvasElement;
  /** Толща: верхний (освещённый) и нижний (тёмный) слои силуэта. */
  silHi: HTMLCanvasElement;
  silLo: HTMLCanvasElement;
  glowC: HTMLCanvasElement;
  C: number;
}

const ISLANDS = new Map<string, IslandArt>();
const ISLE = tn('#2e2840', '#463e5e', '#625a84', '#8a82ae');

function tintCanvas(p: Px, col: string): HTMLCanvasElement {
  const c = p.canvas();
  const g2 = c.getContext('2d');
  if (g2) {
    g2.globalCompositeOperation = 'source-in';
    g2.fillStyle = col;
    g2.fillRect(0, 0, c.width, c.height);
  }
  return c;
}

/**
 * Остров кольца: сектор-кольцо вокруг угла 0, холст с центром кольца в
 * середине. Верх — реголит в кратерах с бирюзовой каймой левитации и
 * кристаллами, по оси — латунные маячки причала.
 */
function islandArt(r: Ring): IslandArt {
  const key = `${r.name}|${r.r0}|${r.r1}|${r.half}`;
  const hit = ISLANDS.get(key);
  if (hit) return hit;
  const R1 = r.r1 * TS;
  const R0 = r.r0 * TS;
  const C = Math.ceil(R1) + 3;
  const top = new Px(C * 2, C * 2);
  const sil = new Px(C * 2, C * 2);
  const glowP = new Px(C * 2, C * 2);
  const half = r.half;
  for (let y = 0; y < C * 2; y++)
    for (let x = 0; x < C * 2; x++) {
      const dx = x + 0.5 - C;
      const dy = y + 0.5 - C;
      const d = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      const wob = (vnoise(a * 60, d, 4, 2010) - 0.5) * 3;
      const inR = d >= R0 + 0.5 + wob * 0.6 && d < R1 - 0.5 + wob;
      const inA = Math.abs(a) * d <= half * d - 1 + wob;
      if (!inR || !inA) {
        if (d >= R0 - 4 && d < R1 + 4 && Math.abs(a) * d <= half * d + 4)
          glowP.set(x, y, alpha(TEAL_GLOW, 0.2));
        continue;
      }
      glowP.set(x, y, alpha(TEAL_GLOW, 0.32));
      sil.set(x, y, WHITE);
      const edge = Math.min(d - R0 - wob * 0.6, R1 - d + wob, (half - Math.abs(a)) * d + wob);
      const n = fbm(x, y, 9, 2011);
      const v = voronoi(x, y, 7, 2012);
      let l = (n - 0.5) * 0.7 + 0.45 + dith(x, y) * 0.12;
      if (v.id < 0.3 && v.d1 < 0.32) l += v.d1 > 0.24 ? 0.2 : -0.3;
      let col = tone(ISLE, l);
      if (edge < 1.2) col = hx('#c8f8ff');
      else if (edge < 2.6) col = mixc(col, TEAL[2], 0.55);
      else if (edge < 4) col = mixc(col, TEAL[1], 0.2);
      if (hash(x, y, 2013) < 0.005) col = CRYST[3];
      top.set(x, y, col);
    }
  // Кристаллы на острове: гнёзда по сторонам от оси (не на пути причала).
  const nest = (rr: number, side: number) => {
    const x = C + rr;
    const y = C + side;
    for (const [ox, oy, h] of [
      [0, 0, 4],
      [2, 1, 3],
      [-1, 2, 2],
    ] as [number, number, number][]) {
      for (let i = 0; i < h; i++) {
        top.set(x + ox, y + oy - i, CRYST[2]);
        top.set(x + ox + 1, y + oy - i, CRYST[1]);
      }
      top.set(x + ox, y + oy - h, WHITE);
    }
  };
  const span = Math.max(4, half * (R0 + R1) * 0.5 - 6);
  nest(R0 + (R1 - R0) * 0.5, -span * 0.7);
  nest(R0 + (R1 - R0) * 0.35, span * 0.75);
  // Маячки: латунные кольца на оси острова.
  for (const k of [0.3, 0.7]) {
    const rr = R0 + (R1 - R0) * k;
    top.ell(C + rr, C, 1.8, 1.8, BRASS[1]);
    top.ell(C + rr - 0.3, C - 0.3, 1, 1, BRASS[3]);
  }
  const out: IslandArt = {
    top: top.canvas(),
    silHi: tintCanvas(sil, '#3c3254'),
    silLo: tintCanvas(sil, '#140f1c'),
    glowC: glowP.canvas(),
    C,
  };
  ISLANDS.set(key, out);
  return out;
}

/** Кольцо орбиты: острова плавно едут по кругу; парад — золото по краю. */
registerZonePainter('f15_ring', (g, z, px, py, _s, time) => {
  const r = zoneOf<Ring>(z);
  if (!r) return true;
  const art = islandArt(r);
  const C = art.C;
  // Ход по орбите: в такте — пыль за кормой; у причала остров замирает,
  // огни причала горят зелёным, за секунду до отхода — мигают жёлтым.
  const moving = r.from !== r.to;
  const half = Math.abs(r.from / PI - Math.round(r.from / PI)) < 1e-6;
  const docked = !moving && r.name === 'small' && !r.parade && r.dockLeft > 0 && half;
  const sp = moving ? Math.sin(PI * clamp01(r.beatT / Math.max(0.01, r.beat))) : 0;
  const dir = Math.sign(r.to - r.from) || 1;
  const mid = ((r.r0 + r.r1) / 2) * TS;
  g.save();
  const prev = g.imageSmoothingEnabled;
  g.imageSmoothingEnabled = false;
  for (let k = 0; k < r.n; k++) {
    const ang = PI / 2 + (k * TAU) / r.n + r.vis;
    const bob = Math.sin(time * 1.3 + k * 2) * (docked ? 0.15 : 0.6);
    if (sp > 0.05)
      for (let i = 0; i < 10; i++) {
        const h0 = hash(i, k, 2070);
        const back = ang - dir * (r.half * 0.9 + (0.04 + h0 * 0.3) * (0.5 + sp));
        const rr = mid + (hash(i, k, 2071) - 0.5) * r.width * TS * 0.8;
        const fl = (time * 3 + h0) % 1;
        g.fillStyle = `rgba(190,200,255,${0.4 * sp * (1 - fl)})`;
        g.fillRect(Math.round(px + Math.cos(back) * rr), Math.round(py + Math.sin(back) * rr + 3 + fl * 3), 1, 1);
      }
    const draw = (img: HTMLCanvasElement, dy: number, a = 1) => {
      g.save();
      g.globalAlpha = a;
      g.translate(px, py + dy + bob);
      g.rotate(ang);
      g.drawImage(img, -C, -C);
      g.restore();
    };
    // Ореол левитации, толща (камень уходит вниз), верх.
    draw(art.glowC, 9, 0.55 + 0.25 * Math.sin(time * 2 + k));
    for (let dy = 7; dy >= 3; dy--) draw(art.silLo, dy);
    draw(art.silHi, 2);
    draw(art.silHi, 1);
    draw(art.top, 0);
    if (docked) {
      const soon = r.dockLeft < 1.2;
      const on = soon ? Math.sin(time * 14) > 0 : Math.sin(time * 2.4 + k) > -0.6;
      g.fillStyle = soon ? `rgba(255,196,80,${on ? 0.95 : 0.25})` : `rgba(130,255,180,${on ? 0.85 : 0.35})`;
      for (const sd of [-1, 1]) {
        const la = ang + sd * r.half * 0.8;
        const lr = r.r1 * TS - 2;
        g.fillRect(Math.round(px + Math.cos(la) * lr) - 1, Math.round(py + Math.sin(la) * lr + bob) - 1, 2, 2);
      }
    }
    if (r.parade) {
      g.save();
      g.translate(px, py + bob);
      g.rotate(ang);
      g.strokeStyle = `rgba(255,214,110,${0.5 + 0.3 * Math.sin(time * 6)})`;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(0, 0, r.r1 * TS - 1.5, -r.half, r.half);
      g.stroke();
      g.restore();
    }
  }
  g.imageSmoothingEnabled = prev;
  g.restore();
  return true;
});

// --- Созвездие на карте ----------------------------------------------------------

/** Фигура созвездия: спит — тусклые точки; проснулась — нити горят; собрана — золото. */
registerZonePainter('f15_figure', (g, z, px, py, _s, time) => {
  const ch = zoneOf<Chart>(z);
  if (!ch) return true;
  const at = viewOf(z, px, py);
  const pts = ch.nodes.map(([x, y]) => at(x + 0.5, y + 0.5));
  g.save();
  const awake = ch.state === 'awake';
  const done = ch.state === 'done';
  const col = done ? '255,214,110' : awake ? '170,200,255' : '120,140,220';
  const a = done ? 0.55 : awake ? 0.45 + 0.25 * Math.sin(time * 5) : 0.18;
  g.strokeStyle = `rgba(${col},${a})`;
  g.lineWidth = 1;
  g.setLineDash(done ? [] : [3, 3]);
  g.lineDashOffset = -time * 6;
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.stroke();
  g.setLineDash([]);
  for (const [x, y] of pts) {
    g.fillStyle = `rgba(${col},${a + 0.25})`;
    g.fillRect(Math.round(x) - 1, Math.round(y), 3, 1);
    g.fillRect(Math.round(x), Math.round(y) - 1, 1, 3);
  }
  g.restore();
  return true;
});

// --- Дуга рывка кометы ---------------------------------------------------------------

/**
 * Дуга кометы — её метка: на замахе по дуге бежит налив от кометы к концу
 * (здесь пройдёт), в рывке — тающий светлый след.
 */
registerZonePainter('f15_arc', (g, z, px, py, _s, time) => {
  const arc = zoneOf<Arc>(z);
  if (!arc) return true;
  const at = viewOf(z, px, py);
  const aim = arc.t < arc.aim;
  const k = aim ? arc.t / arc.aim : 1;
  const fade = aim ? 1 : Math.max(0, 1 - (arc.t - arc.aim) / Math.max(0.1, arc.T - arc.aim));
  if (fade <= 0) return true;
  const N = 28;
  const pt = (u: number) => {
    const a = arc.a0 + (arc.a1 - arc.a0) * u;
    const R = arc.R + (arc.R1 - arc.R) * u;
    return at(arc.cx + Math.cos(a) * R, arc.cy + Math.sin(a) * R);
  };
  g.save();
  // Полоса пути: тусклая целиком, налив — до k.
  g.lineCap = 'round';
  g.lineWidth = 7;
  g.strokeStyle = `rgba(255,90,70,${0.14 * fade})`;
  g.beginPath();
  for (let i = 0; i <= N; i++) {
    const [x, y] = pt(i / N);
    if (i) g.lineTo(x, y);
    else g.moveTo(x, y);
  }
  g.stroke();
  g.lineWidth = aim ? 3 : 2;
  g.strokeStyle = aim ? `rgba(255,140,110,${0.35 + 0.4 * k})` : `rgba(190,245,255,${0.6 * fade})`;
  g.beginPath();
  for (let i = 0; i <= Math.ceil(N * k); i++) {
    const [x, y] = pt(Math.min(k, i / N));
    if (i) g.lineTo(x, y);
    else g.moveTo(x, y);
  }
  g.stroke();
  // Шевроны по ходу.
  if (aim)
    for (let i = 1; i < 6; i++) {
      const u = (i / 6 + time * 0.8) % 1;
      const [x, y] = pt(u);
      const [x2, y2] = pt(Math.min(1, u + 0.02));
      const a = Math.atan2(y2 - y, x2 - x);
      g.strokeStyle = `rgba(255,220,200,${0.7 * k})`;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x - Math.cos(a - 0.7) * 3, y - Math.sin(a - 0.7) * 3);
      g.lineTo(x, y);
      g.lineTo(x - Math.cos(a + 0.7) * 3, y - Math.sin(a + 0.7) * 3);
      g.stroke();
    }
  g.restore();
  return true;
});

// --- Отбитый снаряд ----------------------------------------------------------------------

/** Отбитый снаряд — теперь твой: бирюзовая игла со следом. */
registerZonePainter('f15_fshot', (g, z, px, py) => {
  const s = zoneOf<FShot>(z);
  if (!s) return true;
  const sp = Math.hypot(s.vx, s.vy) || 1;
  const ux = s.vx / sp;
  const uy = s.vy / sp;
  g.save();
  for (let i = 0; i < 8; i++) {
    g.fillStyle = `rgba(140,250,255,${0.6 - i * 0.07})`;
    g.fillRect(Math.round(px - ux * i * 1.6) - 1, Math.round(py - uy * i * 1.6) - 1, 2, 2);
  }
  const gr = g.createRadialGradient(px, py, 0, px, py, 6);
  gr.addColorStop(0, 'rgba(255,255,255,0.95)');
  gr.addColorStop(0.4, 'rgba(120,240,255,0.6)');
  gr.addColorStop(1, 'rgba(120,240,255,0)');
  g.fillStyle = gr;
  g.beginPath();
  g.arc(px, py, 6, 0, TAU);
  g.fill();
  g.restore();
  return true;
});

// --- Короткие вспышки ---------------------------------------------------------------------

const lifeK = (z: Zone | Strike) => {
  const life = (z as Zone).life ?? 0.4;
  return Math.min(1, z.t / Math.max(0.01, life));
};

/** Искры: звёздочки разлетаются и гаснут. */
registerZonePainter('f15_spark', (g, z, px, py) => {
  const k = lifeK(z);
  g.save();
  for (let i = 0; i < 9; i++) {
    const a = hash(i, z.id, 2020) * TAU;
    const d = z.r * TS * (0.2 + k * (0.6 + hash(i, z.id, 2021) * 0.6));
    const x = Math.round(px + Math.cos(a) * d);
    const y = Math.round(py + Math.sin(a) * d * 0.8 - k * 3);
    g.fillStyle = `rgba(${i % 3 ? '170,245,255' : '255,255,255'},${1 - k})`;
    g.fillRect(x, y, 1, 1);
    if (k < 0.5) {
      g.fillRect(x - 1, y, 3, 1);
      g.fillRect(x, y - 1, 1, 3);
    }
  }
  g.restore();
  return true;
});

/** Вспышка памяти: фиолетовое кольцо расходится, вверх летят пылинки. */
registerZonePainter('f15_memflash', (g, z, px, py) => {
  const k = lifeK(z);
  g.save();
  g.strokeStyle = `rgba(200,170,255,${(1 - k) * 0.8})`;
  g.lineWidth = 2 - k;
  g.beginPath();
  g.ellipse(px, py, z.r * TS * (0.3 + k * 0.8), z.r * TS * (0.2 + k * 0.55), 0, 0, TAU);
  g.stroke();
  for (let i = 0; i < 10; i++) {
    const x = px + (hash(i, z.id, 2030) - 0.5) * z.r * TS * 1.4;
    const y = py - k * 14 * (0.5 + hash(i, z.id, 2031));
    g.fillStyle = `rgba(230,210,255,${1 - k})`;
    g.fillRect(Math.round(x), Math.round(y), 1, 2);
  }
  g.restore();
  return true;
});

/** Тёмная сетка под грузом: узлы стянуты к (px, py), волна давит к середине. */
function pressGrid(
  g: CanvasRenderingContext2D,
  px: number,
  py: number,
  R: number,
  press: number,
  time: number,
  a: number,
): void {
  const step = 6;
  const n = Math.ceil(R / step);
  const at = (dx: number, dy: number): [number, number] => {
    const d = Math.hypot(dx, dy);
    const u = Math.max(0, 1 - d / R);
    const k = press * u * u * (0.8 + 0.2 * Math.sin(time * 6 + d * 0.35));
    return [px + dx * (1 - k), py + dy * (1 - k)];
  };
  g.strokeStyle = `rgba(6,2,18,${a})`;
  g.lineWidth = 1;
  for (let axis = 0; axis < 2; axis++)
    for (let i = -n; i <= n; i++) {
      const c = i * step;
      g.beginPath();
      for (let j = 0; j <= 12; j++) {
        const t = -R + (j / 12) * R * 2;
        const [x, y] = axis ? at(c, t) : at(t, c);
        if (j === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
}

/**
 * Тяжесть после удара гравитона. Первые 0,4 с — удар: светлая волна по
 * полу, трещины разбегаются, пыль подлетает и падает. Потом круг вдавлен:
 * тёмная сетка пола стянута к середине и давит волнами, кольца сжимаются.
 * Граница — ровно радиус зоны (замедляет внутри круга).
 */
registerZonePainter('f15_heavy', (g, z, px, py, _s, time) => {
  const zz = z as Zone;
  const R = z.r * TS;
  if (!onScreen(g, px, py, R + 6)) return true;
  const fade = Math.min(1, (zz.life - zz.t) / 0.6, zz.t / 0.06);
  const hit = clamp01(zz.t / 0.4);
  const seed = ((z.id % 97) + 97) % 97;
  g.save();
  const gr = g.createRadialGradient(px, py, 0, px, py, R);
  gr.addColorStop(0, `rgba(20,6,40,${0.5 * fade})`);
  gr.addColorStop(0.8, `rgba(50,16,80,${0.3 * fade})`);
  gr.addColorStop(1, 'rgba(50,16,80,0)');
  g.fillStyle = gr;
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.fill();
  // Сетка давит: в ударе вдавливается рывком, дальше дышит.
  g.save();
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.clip();
  const press = 0.28 * easeOut(hit * 2.2) + 0.06 * Math.sin(time * 3.2) * hit;
  pressGrid(g, px, py, R, press, time, 0.45 * fade);
  g.restore();
  for (let i = 0; i < 3; i++) {
    const u = 1 - ((time * 0.7 + i / 3) % 1);
    g.strokeStyle = `rgba(184,144,255,${0.4 * fade * (1 - u * 0.5)})`;
    g.beginPath();
    g.arc(px, py, Math.max(1, R * u), 0, TAU);
    g.stroke();
  }
  // Трещины бегут от середины за 0,25 с.
  const grow = easeOut(zz.t / 0.25);
  g.strokeStyle = `rgba(10,4,20,${0.75 * fade})`;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + hash(i, seed, 2040);
    const L = R * (0.7 + hash(i, seed, 2041) * 0.25) * grow;
    g.beginPath();
    g.moveTo(px + Math.cos(a) * 3, py + Math.sin(a) * 3);
    g.lineTo(px + Math.cos(a + 0.2) * L * 0.55, py + Math.sin(a + 0.2) * L * 0.55);
    g.lineTo(px + Math.cos(a - 0.1) * L, py + Math.sin(a - 0.1) * L);
    g.stroke();
  }
  // Удар: волна и пыль.
  if (hit < 1) {
    const k = easeOut(hit);
    g.strokeStyle = `rgba(220,200,255,${0.8 * (1 - hit)})`;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(px, py, Math.max(1, R * (0.2 + 0.95 * k)), 0, TAU);
    g.stroke();
    g.lineWidth = 1;
    for (let i = 0; i < 16; i++) {
      const a = hash(i, seed, 2042) * TAU;
      const d = R * (0.25 + 0.75 * k) * (0.6 + 0.4 * hash(i, seed, 2043));
      const up = Math.sin(hit * PI) * (4 + hash(i, seed, 2044) * 6);
      g.fillStyle = `rgba(150,120,200,${0.8 * (1 - hit)})`;
      g.fillRect(Math.round(px + Math.cos(a) * d), Math.round(py + Math.sin(a) * d - up), 2, 2);
    }
  }
  g.restore();
  return true;
});

/** Шторм: тяжесть на весь зал — дымка, тёмная сетка давит сверху вниз полосами. */
registerZonePainter('f15_heavyall', (g, z, px, py, _s, time) => {
  const zz = z as Zone;
  const fade = Math.min(1, (zz.life - zz.t) / 0.6, zz.t / 0.4);
  const R = z.r * TS;
  g.save();
  g.fillStyle = `rgba(50,16,80,${0.22 * fade})`;
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.fill();
  g.clip();
  // Тёмная сетка видимой части: ряды съезжают вниз, как под прессом.
  const [x0, y0, x1, y1] = viewBox(g, 0);
  const sx = Math.floor((x0 - px) / TS) * TS + px;
  const off = (time * 14) % TS;
  const sy = Math.floor((y0 - py) / TS) * TS + py + off - TS;
  g.fillStyle = `rgba(6,2,18,${0.3 * fade})`;
  for (let y = sy; y < y1; y += TS) g.fillRect(Math.floor(x0), Math.round(y), Math.ceil(x1 - x0), 1);
  g.fillStyle = `rgba(6,2,18,${0.16 * fade})`;
  for (let x = sx; x < x1; x += TS) g.fillRect(Math.round(x), Math.floor(y0), 1, Math.ceil(y1 - y0));
  g.fillStyle = `rgba(200,160,255,${0.35 * fade})`;
  for (let i = 0; i < 60; i++) {
    const x = px + (hash(i, 1, 2050) - 0.5) * R * 1.8;
    const y = py - R + ((hash(i, 2, 2050) * R * 2 + time * 60) % (R * 2));
    if (x < x0 || x > x1 || y < y0 - 3 || y > y1) continue;
    g.fillRect(Math.round(x), Math.round(y), 1, 3);
  }
  g.restore();
  return true;
});

/** Шторм: предупреждение — волны от середины зала. */
registerZonePainter('f15_stormwarn', (g, z, px, py) => {
  const k = lifeK(z);
  const st = stNow();
  const heavy = st ? st.storm !== 1 : true;
  g.save();
  for (let i = 0; i < 3; i++) {
    const u = (k * 1.5 + i / 3) % 1;
    g.strokeStyle = heavy
      ? `rgba(184,120,255,${(1 - u) * 0.6})`
      : `rgba(160,230,255,${(1 - u) * 0.6})`;
    g.lineWidth = 2;
    g.beginPath();
    g.ellipse(px, py, z.r * TS * u, z.r * TS * u * 0.7, 0, 0, TAU);
    g.stroke();
  }
  g.restore();
  return true;
});

/** Тень затмения: темнота поверх всего, дыры — у зажжённых ламп и малая у героя. */
registerZonePainter('f15_dark', (g, z, px, py) => {
  const st = stNow();
  const sim = paintSim();
  if (!st || !sim || st.dark <= 0.01 || sim.area !== F15_OBS) return true;
  // Тьма — только в зале затмения (из запечатанного зала не выйти).
  const hall = st.halls.find((q) => q.name === 'eclipse');
  const h = sim.hero;
  if (hall && (h.x < hall.x0 - 1 || h.x > hall.x1 + 2 || h.y < hall.y0 - 1 || h.y > hall.y1 + 2))
    return true;
  const at = viewOf(z, px, py);
  const holes: [number, number, number][] = [];
  for (const l of st.lamps) if (l.lit) holes.push([...at(l.x, l.y), 3.6 * TS]);
  holes.push([...at(sim.hero.x, sim.hero.y - 0.3), 1.7 * TS]);
  const W = g.canvas.width;
  const H = g.canvas.height;
  const m = g.getTransform();
  const sc = m.a || 1;
  const x0 = -m.e / sc - 32;
  const y0 = -m.f / sc - 32;
  const x1 = x0 + W / sc + 64;
  const y1 = y0 + H / sc + 64;
  const A = 0.8 * st.dark;
  g.save();
  g.fillStyle = `rgba(4,2,12,${A})`;
  g.beginPath();
  g.rect(x0, y0, x1 - x0, y1 - y0);
  for (const [x, y, r] of holes) {
    g.moveTo(x + r, y);
    g.arc(x, y, r, 0, TAU, true);
  }
  g.fill('evenodd');
  // Мягкий край дыр.
  for (const [x, y, r] of holes) {
    const gr = g.createRadialGradient(x, y, r * 0.55, x, y, r);
    gr.addColorStop(0, 'rgba(4,2,12,0)');
    gr.addColorStop(1, `rgba(4,2,12,${A})`);
    g.fillStyle = gr;
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fill();
  }
  g.restore();
  return true;
});

/** Падающая звезда: на полу наливается круг, с неба летит звезда со шлейфом. */
registerZonePainter('f15_star', (g, z, px, py, _s, time) => {
  const s = z as Strike;
  const k = Math.min(1, s.t / Math.max(0.01, s.warn));
  const R = z.r * TS;
  g.save();
  g.fillStyle = `rgba(255,214,110,${0.1 + k * 0.18})`;
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.fill();
  g.strokeStyle = `rgba(255,230,160,${0.4 + k * 0.5})`;
  g.lineWidth = 1;
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.stroke();
  g.fillStyle = `rgba(255,190,90,${0.35 + k * 0.3})`;
  g.beginPath();
  g.arc(px, py, Math.max(0.5, R * k), 0, TAU);
  g.fill();
  // Звезда в небе: из-за верхнего левого края к центру.
  const d = (1 - k) * 90;
  const sx = px - d * 0.55;
  const sy = py - d;
  for (let i = 0; i < 14; i++) {
    const w = i < 4 ? 3 : i < 9 ? 2 : 1;
    g.fillStyle = `rgba(255,${240 - i * 6},${200 - i * 10},${0.7 - i * 0.045})`;
    g.fillRect(Math.round(sx - i * 2.2 - w / 2), Math.round(sy - i * 4 - w / 2), w, w);
  }
  const SR = 4 + 4 * k;
  const gr = g.createRadialGradient(sx, sy, 0, sx, sy, SR);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.5, 'rgba(255,220,140,0.6)');
  gr.addColorStop(1, 'rgba(255,220,140,0)');
  g.fillStyle = gr;
  g.beginPath();
  g.arc(sx, sy, SR, 0, TAU);
  g.fill();
  void time;
  g.restore();
  return true;
});

/** Звезда упала: кольцо, вспышка, брызги золота. */
registerZonePainter('f15_starland', (g, z, px, py) => {
  const k = lifeK(z);
  const R = z.r * TS;
  g.save();
  const gr = g.createRadialGradient(px, py, 0, px, py, R * (0.5 + k * 0.6));
  gr.addColorStop(0, `rgba(255,255,240,${(1 - k) * 0.9})`);
  gr.addColorStop(1, 'rgba(255,200,100,0)');
  g.fillStyle = gr;
  g.beginPath();
  g.arc(px, py, R * (0.5 + k * 0.6), 0, TAU);
  g.fill();
  g.strokeStyle = `rgba(255,220,150,${1 - k})`;
  g.lineWidth = 2;
  g.beginPath();
  g.ellipse(px, py, R * (0.4 + k), R * (0.3 + k * 0.75), 0, 0, TAU);
  g.stroke();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU + hash(i, z.id, 2060);
    const d = R * (0.3 + k * 1.1);
    g.fillStyle = `rgba(255,${200 + (i % 3) * 20},120,${1 - k})`;
    g.fillRect(
      Math.round(px + Math.cos(a) * d),
      Math.round(py + Math.sin(a) * d * 0.75 - Math.sin(k * PI) * 5),
      1,
      1,
    );
  }
  g.restore();
  return true;
});

registerImpactPainter('f15_star', {
  life: 1.6,
  shake: 0.25,
  paint: (g, rec, px, py, _s, age) => {
    // Обожжённый след: тлеет и гаснет.
    const k = Math.min(1, age / 1.6);
    const R = (rec.r ?? 1.3) * TS * 0.7;
    const gr = g.createRadialGradient(px, py, 0, px, py, R);
    gr.addColorStop(0, `rgba(255,170,80,${0.45 * (1 - k)})`);
    gr.addColorStop(0.6, `rgba(60,30,30,${0.35 * (1 - k)})`);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.ellipse(px, py, R, R * 0.8, 0, 0, TAU);
    g.fill();
    return true;
  },
});

/**
 * Нить созвездия: провисшая нить натягивается от звезды к звезде, свет
 * бежит по ней; к удару она тугая и дрожит. Полоса под ней — честная
 * ширина удара.
 */
registerZonePainter('f15_lash', (g, z, px, py, _s, time) => {
  const s = z as Strike;
  const k = clamp01(s.t / Math.max(0.01, s.warn ?? 0));
  const L = z.r * TS;
  const a = s.ang ?? 0;
  const W = (s.w ?? 0.3) * TS;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  if (!onScreen(g, px + (ux * L) / 2, py + (uy * L) / 2, L / 2 + W + 4)) return true;
  g.save();
  // Полоса удара (тусклая) — где опасно.
  g.strokeStyle = `rgba(255,110,90,${0.12 + k * 0.2})`;
  g.lineWidth = W * 2;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(px, py);
  g.lineTo(px + ux * L, py + uy * L);
  g.stroke();
  // Нить: провис уходит к удару, перед самым ударом — дрожь натяжения.
  const sag = L * 0.14 * (1 - k) ** 2 + (k > 0.85 ? Math.sin(time * 70) * 0.8 : 0);
  const at = (u: number): [number, number] => {
    const off = sag * 4 * u * (1 - u);
    return [px + ux * L * u - uy * off, py + uy * L * u + ux * off + off * 0.3];
  };
  g.lineCap = 'butt';
  g.lineWidth = 1;
  g.strokeStyle = `rgba(150,170,255,${0.25 + 0.3 * k})`;
  g.beginPath();
  for (let i = 0; i <= 12; i++) {
    const [x, y] = at(i / 12);
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke();
  // Свет бежит от звезды к звезде.
  const head = k;
  g.strokeStyle = `rgba(220,232,255,${0.55 + 0.45 * k})`;
  g.lineWidth = k > 0.85 ? 2 : 1;
  g.beginPath();
  for (let i = 0; i <= 12; i++) {
    const [x, y] = at((i / 12) * head);
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke();
  const [fx, fy] = at(head);
  g.fillStyle = `rgba(255,255,255,${0.6 + 0.4 * Math.sin(time * 30)})`;
  g.fillRect(Math.round(fx) - 1, Math.round(fy), 3, 1);
  g.fillRect(Math.round(fx), Math.round(fy) - 1, 1, 3);
  g.restore();
  return true;
});

/** Контакт нити: хлопок — белая нить с волной вдоль, искры летят в стороны. */
registerImpactPainter('f15_lash', {
  life: 0.45,
  shake: 0.12,
  paint: (g, rec, px, py, _s, age) => {
    const k = clamp01(age / 0.45);
    const L = (rec.r ?? 4) * TS;
    const a = rec.ang ?? 0;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const seed = rec.seed >>> 0;
    g.save();
    // Волна бежит по нити и гаснет.
    const amp = 3 * (1 - k);
    g.strokeStyle = `rgba(${k < 0.3 ? '255,255,255' : '170,200,255'},${0.9 * (1 - k)})`;
    g.lineWidth = k < 0.25 ? 2 : 1;
    g.beginPath();
    for (let i = 0; i <= 16; i++) {
      const u = i / 16;
      const off = Math.sin(u * PI * 3 - age * 40) * amp * Math.sin(u * PI);
      const x = px + ux * L * u - uy * off;
      const y = py + uy * L * u + ux * off;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    g.lineWidth = 1;
    // Искры по нормали.
    for (let i = 0; i < 12; i++) {
      const u = hash(i, seed % 9973, 2060);
      const side = hash(i, seed % 9973, 2061) > 0.5 ? 1 : -1;
      const d = (3 + hash(i, seed % 9973, 2062) * 9) * easeOut(k);
      const x = px + ux * L * u - uy * d * side;
      const y = py + uy * L * u + ux * d * side + k * k * 4;
      g.fillStyle = `rgba(220,236,255,${0.9 * (1 - k)})`;
      g.fillRect(Math.round(x), Math.round(y), 1, 1);
    }
    g.restore();
    return k < 1;
  },
});

/** Луч телескопа: столб света с неба, искры по краю. */
registerZonePainter('f15_beam', (g, z, px, py, _s, time) => {
  const k = lifeK(z);
  const W = z.r * TS * (1 - k * 0.6);
  const a = k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85;
  g.save();
  const gr = g.createLinearGradient(px - W, 0, px + W, 0);
  gr.addColorStop(0, 'rgba(255,240,190,0)');
  gr.addColorStop(0.5, `rgba(255,250,230,${0.75 * a})`);
  gr.addColorStop(1, 'rgba(255,240,190,0)');
  g.fillStyle = gr;
  g.fillRect(px - W, py - 220, W * 2, 220 + W * 0.3);
  const gr2 = g.createRadialGradient(px, py, 0, px, py, W * 1.4);
  gr2.addColorStop(0, `rgba(255,255,255,${0.8 * a})`);
  gr2.addColorStop(1, 'rgba(255,230,160,0)');
  g.fillStyle = gr2;
  g.beginPath();
  g.ellipse(px, py, W * 1.4, W * 0.9, 0, 0, TAU);
  g.fill();
  for (let i = 0; i < 14; i++) {
    const y = py - ((hash(i, 3, 2070) * 200 + time * 120) % 200);
    const x = px + (hash(i, 4, 2070) - 0.5) * W * 1.6;
    g.fillStyle = `rgba(255,255,255,${a})`;
    g.fillRect(Math.round(x), Math.round(y), 1, 2);
  }
  g.restore();
  return true;
});

/** Сверхновая вспыхнула: огненное кольцо по метке и белая вспышка. */
registerZonePainter('f15_novaburst', (g, z, px, py) => {
  const k = lifeK(z);
  const R = z.r * TS;
  g.save();
  const gr = g.createRadialGradient(px, py, R * 0.2, px, py, R * (0.6 + k * 0.5));
  gr.addColorStop(0, `rgba(255,255,240,${(1 - k) * 0.8})`);
  gr.addColorStop(0.6, `rgba(255,190,80,${(1 - k) * 0.5})`);
  gr.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = gr;
  g.beginPath();
  g.arc(px, py, R * (0.6 + k * 0.5), 0, TAU);
  g.fill();
  g.strokeStyle = `rgba(255,230,160,${1 - k})`;
  g.lineWidth = 3 * (1 - k) + 1;
  g.beginPath();
  g.ellipse(px, py, R * (0.7 + k * 0.4), R * (0.6 + k * 0.35), 0, 0, TAU);
  g.stroke();
  g.restore();
  return true;
});

/** След саламандры-эха: призрачный голубой огонёк; сперва метка, потом жжёт. */
registerZonePainter('f15_ember', (g, z, px, py, _s, time) => {
  const zz = z as Zone;
  const warn = zz.warn ?? 0;
  const R = z.r * TS;
  g.save();
  if (zz.t < warn) {
    const k = zz.t / warn;
    g.strokeStyle = `rgba(140,200,255,${0.3 + k * 0.5})`;
    g.beginPath();
    g.ellipse(px, py, R, R * 0.75, 0, 0, TAU);
    g.stroke();
    g.fillStyle = `rgba(140,200,255,${0.15 * k})`;
    g.fill();
  } else {
    const fade = Math.min(1, (zz.life - zz.t) / 0.5);
    for (let i = 0; i < 5; i++) {
      const ph = (time * 3 + i * 0.37 + hash(i, z.id, 2080)) % 1;
      const x = px + (hash(i, z.id, 2081) - 0.5) * R * 1.4;
      const y = py + 2 - ph * 8;
      g.fillStyle = `rgba(${ph < 0.4 ? '230,245,255' : '120,170,255'},${(1 - ph) * 0.85 * fade})`;
      g.fillRect(Math.round(x), Math.round(y), 2, 2 + (ph < 0.3 ? 1 : 0));
    }
    g.fillStyle = `rgba(90,140,255,${0.22 * fade})`;
    g.beginPath();
    g.ellipse(px, py, R, R * 0.75, 0, 0, TAU);
    g.fill();
  }
  g.restore();
  return true;
});

/** Споры гриба-эха: облачко бирюзово-фиолетовых пылинок. */
registerZonePainter('f15_spore', (g, z, px, py, _s, time) => {
  const zz = z as Zone;
  const fade = Math.min(1, (zz.life - zz.t) / 0.6, zz.t / 0.3);
  const R = z.r * TS;
  g.save();
  const gr = g.createRadialGradient(px, py, 0, px, py, R);
  gr.addColorStop(0, `rgba(120,200,220,${0.25 * fade})`);
  gr.addColorStop(1, 'rgba(120,120,220,0)');
  g.fillStyle = gr;
  g.beginPath();
  g.ellipse(px, py, R, R * 0.8, 0, 0, TAU);
  g.fill();
  for (let i = 0; i < 18; i++) {
    const a = hash(i, z.id, 2090) * TAU + time * (0.3 + hash(i, 1, 2090) * 0.5);
    const d = R * Math.sqrt(hash(i, 2, 2090));
    g.fillStyle = `rgba(${i % 2 ? '180,240,255' : '200,170,255'},${0.7 * fade})`;
    g.fillRect(
      Math.round(px + Math.cos(a) * d),
      Math.round(py + Math.sin(a) * d * 0.8 - Math.sin(time * 2 + i) * 2),
      1,
      1,
    );
  }
  g.restore();
  return true;
});

/** Удар окружения по мобу — без картинки. */
registerZonePainter('f15_none', () => true);
registerImpactPainter('f15_none', { life: 0.01, paint: () => false });

/** Трос якоря: светящаяся нить от якоря к точке зацепа, по ней скользит искра. */
registerZonePainter('f15_tether', (g, z, px, py, _s, time) => {
  const st = stNow();
  const t = st?.tether;
  if (!t) return true;
  const at = viewOf(z, px, py);
  const [ax, ay] = at(t.ax, t.ay - 0.6);
  const [bx, by] = at(t.x1, t.y1);
  const k = Math.min(1, t.t / t.T);
  g.save();
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2 + 6 * (1 - k);
  g.strokeStyle = 'rgba(30,20,50,0.6)';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(ax, ay + 1);
  g.quadraticCurveTo(mx, my + 1, bx, by + 1);
  g.stroke();
  g.strokeStyle = 'rgba(108,240,255,0.35)';
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(ax, ay);
  g.quadraticCurveTo(mx, my, bx, by);
  g.stroke();
  g.strokeStyle = `rgba(190,250,255,${0.8 + 0.2 * Math.sin(time * 20)})`;
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(ax, ay);
  g.quadraticCurveTo(mx, my, bx, by);
  g.stroke();
  // Бусины света бегут по тросу к крюку.
  g.fillStyle = 'rgba(255,255,255,0.9)';
  for (let i = 0; i < 3; i++) {
    const u = (time * 2.2 + i / 3) % 1;
    const qx = (1 - u) * (1 - u) * ax + 2 * (1 - u) * u * mx + u * u * bx;
    const qy = (1 - u) * (1 - u) * ay + 2 * (1 - u) * u * my + u * u * by;
    g.fillRect(Math.round(qx) - 1, Math.round(qy) - 1, 2, 2);
  }
  // Крюк-кристалл на конце: ромб, в первый миг вгрызается искрами.
  const hx0 = Math.round(bx);
  const hy0 = Math.round(by);
  g.fillStyle = 'rgba(108,240,255,0.9)';
  g.fillRect(hx0 - 2, hy0, 5, 1);
  g.fillRect(hx0, hy0 - 2, 1, 5);
  g.fillStyle = 'rgba(240,255,255,1)';
  g.fillRect(hx0 - 1, hy0 - 1, 3, 3);
  const bite = clamp01(t.t / 0.18);
  if (bite < 1) {
    g.strokeStyle = `rgba(230,255,255,${0.9 * (1 - bite)})`;
    g.beginPath();
    g.arc(bx, by, 2 + bite * 7, 0, TAU);
    g.stroke();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + 0.4;
      const d = 2 + easeOut(bite) * 8;
      g.fillStyle = `rgba(190,250,255,${1 - bite})`;
      g.fillRect(Math.round(bx + Math.cos(a) * d), Math.round(by + Math.sin(a) * d), 1, 1);
    }
  }
  g.restore();
  return true;
});

// ---------------------------------------------------------------------------
// Снаряды и их контакт.
// ---------------------------------------------------------------------------

/** Игла ежа: кристальная, остриём по ходу, за ней блёстки. */
registerShotPainter('f15_needle', (s: Shot) => {
  const b = dirBucket(Math.atan2(s.vy, s.vx), 16);
  return sprite(`needle|${b}`, () => {
    const p = new Px(18, 18);
    const a = (b / 16) * TAU;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    for (let i = 1; i <= 4; i++)
      p.set(9 - ux * (3 + i * 1.5), 9 - uy * (3 + i * 1.5), alpha(TEAL_GLOW, 0.55 - i * 0.12));
    spike(p, 9 - ux * 3, 9 - uy * 3, a, 8, 2.4, CRYST, WHITE);
    p.outline(alpha(INK, 0.6));
    return { p, ax: 9, ay: 11 };
  });
});

/** Звёздный болт звездочёта: золотая звезда крутится, за ней хвост. */
registerShotPainter('f15_starbolt', (s: Shot, time: number) => {
  const b = dirBucket(Math.atan2(s.vy, s.vx), 8);
  const f = Math.floor(time * 16) % 4;
  return sprite(`starbolt|${b}|${f}`, () => {
    const p = new Px(26, 26);
    const a = (b / 8) * TAU;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    for (let i = 1; i <= 6; i++)
      glow(p, 13 - ux * i * 1.8, 13 - uy * i * 1.8, 3 - i * 0.35, GOLDK, 0.5 - i * 0.07);
    glow(p, 13, 13, 6, hx('#ffd060'), 0.6);
    const rot = (f / 4) * (PI / 2);
    const pts: [number, number][] = [];
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 1.6 : 4;
      const t = rot + (i / 10) * TAU - PI / 2;
      pts.push([13 + Math.cos(t) * r, 13 + Math.sin(t) * r]);
    }
    poly(p, pts, (x, y) => (x + y < 26 ? GOLD[3] : GOLD[2]));
    p.set(13, 13, WHITE);
    return { p, ax: 13, ay: 15 };
  });
});

registerImpactPainter('f15_needle', {
  life: 0.3,
  paint: (g, rec, px, py, _s, age) => {
    const k = age / 0.3;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + rec.seed;
      const d = 2 + k * 6;
      g.fillStyle = `rgba(${i % 2 ? '200,250,255' : '110,220,255'},${1 - k})`;
      g.fillRect(Math.round(px + Math.cos(a) * d), Math.round(py + Math.sin(a) * d - k * 2), 1, 1);
    }
    return true;
  },
});

registerImpactPainter('f15_starbolt', {
  life: 0.4,
  paint: (g, rec, px, py, _s, age) => {
    const k = age / 0.4;
    g.strokeStyle = `rgba(255,220,130,${1 - k})`;
    g.beginPath();
    g.arc(px, py, 2 + k * 8, 0, TAU);
    g.stroke();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + rec.seed;
      g.fillStyle = `rgba(255,245,200,${1 - k})`;
      g.fillRect(
        Math.round(px + Math.cos(a) * (3 + k * 9)),
        Math.round(py + Math.sin(a) * (3 + k * 9)),
        1,
        1,
      );
    }
    return true;
  },
});

// ---------------------------------------------------------------------------
// Иконки вещей (10×10).
// ---------------------------------------------------------------------------

registerItemArt('f15_shard', () => {
  const p = new Px(10, 10);
  crystal(p, 5, 9.5, 4, 9, 1, CRYST, 0.6);
  p.set(4, 3, WHITE);
  p.outline(INK);
  return p;
});

registerItemArt('f15_dust', () => {
  const p = new Px(10, 10);
  // Мешочек звёздной пыли: синий бархат, золотая завязка, искры.
  shadeEll(p, 5, 6.3, 3.6, 3.1, LAPIS, 0.15);
  p.rect(4, 2, 6, 3, LAPIS[2]);
  p.rect(3, 3, 7, 3, GOLD[2]);
  p.set(4, 6, STAR_C);
  p.set(6, 7, GOLD[3]);
  p.set(5, 5, WHITE);
  p.outline(INK);
  return p;
});

registerItemArt('f15_meteorite', () => {
  const p = new Px(10, 10);
  poly(
    p,
    [
      [1, 7],
      [2, 3],
      [5, 1],
      [8, 2],
      [9, 6],
      [7, 9],
      [3, 9],
    ],
    (x, y) => tone(METEOR, (5 - x) * 0.08 + (5 - y) * 0.1 + 0.35),
  );
  stroke(p, 3, 5, 5, 6, hx('#ffb040'));
  stroke(p, 5, 6, 7, 4, hx('#ffe080'));
  p.outline(INK);
  return p;
});

registerItemArt('f15_lens', () => {
  const p = new Px(10, 10);
  p.ell(5, 5, 4, 4, BRASS[2]);
  p.ell(5, 5, 3, 3, hx('#7ab8ff'));
  p.ell(4.5, 4.5, 1.6, 1.6, hx('#c8e8ff'));
  p.set(4, 4, WHITE);
  p.outline(INK);
  return p;
});

registerItemArt('f15_void', () => {
  const p = new Px(10, 10);
  // Шарик пустоты: чёрный, по краю фиолетовый ободок, внутри звезда.
  p.ell(5, 5, 4, 4, VIOLET[1]);
  p.ell(5, 5, 3.2, 3.2, hx('#05030c'));
  p.set(6, 4, WHITE);
  p.set(3, 6, alpha(VIOLET_GLOW, 0.8));
  p.outline(INK);
  return p;
});

registerItemArt('f15_memory', () => {
  const p = new Px(10, 10);
  poly(
    p,
    [
      [2, 3],
      [4, 1],
      [6, 1],
      [8, 3],
      [8, 7],
      [6, 9],
      [4, 9],
      [2, 7],
    ],
    (x, y) => mixc(VIOLET[3], VIOLET[1], (x + y) / 16),
  );
  p.set(4, 3, WHITE);
  p.set(5, 5, hx('#fff0ff'));
  p.set(6, 6, alpha(WHITE, 0.6));
  p.outline(INK);
  return p;
});

registerItemArt('f15_honey', () => {
  const p = new Px(10, 10);
  // Кристальный мёд: соты-шестигранник, светится бирюзой.
  poly(
    p,
    [
      [2, 3],
      [5, 1],
      [8, 3],
      [8, 7],
      [5, 9],
      [2, 7],
    ],
    (x, y) => tone(TEAL, (5 - x) * 0.1 + (5 - y) * 0.1 + 0.55),
  );
  stroke(p, 5, 1, 5, 9, alpha(TEAL[0], 0.6));
  stroke(p, 2, 5, 8, 5, alpha(TEAL[0], 0.4));
  p.set(4, 3, WHITE);
  p.outline(INK);
  return p;
});

registerItemArt('f15_ration', () => {
  const p = new Px(10, 10);
  // Паёк звездочёта: свёрток в синей ткани, перевязан латунью, сверху звезда.
  p.rect(1, 3, 8, 8, LAPIS[2]);
  p.rect(1, 3, 8, 3, LAPIS[3]);
  p.rect(8, 4, 8, 8, LAPIS[1]);
  p.rect(4, 3, 5, 8, BRASS[2]);
  sparkle(p, 5, 1, GOLD[3], 1);
  p.outline(INK);
  return p;
});
