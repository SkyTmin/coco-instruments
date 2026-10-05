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
import { F15_FX, MOTIFS } from './f15-brains';
import type { Arc, Chart, FShot, Ring, Well } from './f15-brains';

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
const alpha = (c: RGBA, a: number): RGBA => [c[0], c[1], c[2], Math.round(Math.max(0, Math.min(1, a)) * 255)];
const tn = (a: string, b: string, c: string, d: string): Tones => [hx(a), hx(b), hx(c), hx(d)];
const rgba = (c: RGBA, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (k: number) => k * k * (3 - 2 * k);

function hash(x: number, y: number, s: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
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
  vnoise(x, y, sc, s) * 0.55 + vnoise(x, y, sc / 2, s + 1) * 0.3 + vnoise(x, y, sc / 4, s + 2) * 0.15;

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

function limb(p: Px, x0: number, y0: number, x1: number, y1: number, r0: number, r1: number, t: Tones, bias = 0): void {
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
    else p.rect(Math.floor(x - w / 2), Math.floor(y - w / 2), Math.floor(x + w / 2 - 0.01), Math.floor(y + w / 2 - 0.01), c);
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

function clearPx(p: Px, x: number, y: number): void {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || y < 0 || x >= p.w || y >= p.h) return;
  const i = (y * p.w + x) * 4;
  p.data[i + 3] = 0;
}

const INK = hx('#0a0614');
const WHITE = hx('#ffffff');
const GOLDK = hx('#ffd060');

// Палитры этажа.
const STONE = tn('#141230', '#211d46', '#2f2a5e', '#433c7c');
const STONE2 = tn('#100e26', '#1a1638', '#26214c', '#363066');
const CRYST = tn('#123a6a', '#1f6aa8', '#4cb6e8', '#c8f4ff');
const VIOLET = tn('#2a1660', '#4a2a98', '#7a56d8', '#d0c0ff');
const TEAL = tn('#0c3a44', '#147a86', '#2ec8d0', '#b8fff6');
const BRASS = tn('#4a3410', '#80601e', '#c09038', '#f4dc8a');
const IVORY = tn('#6a6478', '#9a94aa', '#c8c2d4', '#f2eef8');
const LAPIS = tn('#0a1440', '#14246a', '#22409a', '#4a70d0');
const METEOR = tn('#1c1414', '#3a2a26', '#5e4a40', '#8a7464');
const NIGHT = tn('#05030c', '#0a0820', '#141038', '#221c52');
const GOLD = tn('#6a4410', '#b07a18', '#f0b838', '#fff2b0');
const ROSE = tn('#3a1030', '#6a2050', '#b04a80', '#ffb8d8');
const STAR_C = hx('#fff4d0');
const TEAL_GLOW = hx('#6cf0ff');
const VIOLET_GLOW = hx('#b890ff');
const SKY: RGBA[] = [hx('#020108'), hx('#07041a'), hx('#120a34'), hx('#1e1450')];

// ---------------------------------------------------------------------------
// Клетки. Пустота — космос с туманностями; у каждого района свои пол и стены.
// ---------------------------------------------------------------------------

/** Космос: туманность (две краски), звёзды трёх величин, редкие далёкие планеты. */
function spacePx(p: Px, wx: number, wy: number, k = 1, lane = false): void {
  const X0 = wx * TS;
  const Y0 = wy * TS;
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const Y = Y0 + y;
      const n = fbm(X, Y, 64, 1501);
      const m = fbm(X + 300, Y - 200, 96, 1502);
      let c = ramp(SKY, n * 0.9 * k);
      // Туманность: фиолет и бирюза полосами.
      const neb = clamp01((m - 0.52) * 3.2);
      if (neb > 0) c = mixc(c, n > 0.5 ? hx('#2a1660') : hx('#0c3040'), neb * 0.55 * k);
      if (lane) {
        // Дорожка орбиты: светлая пыль.
        const d = vnoise(X, Y, 6, 1503);
        c = mixc(c, hx('#2a2460'), 0.35 + d * 0.2);
      }
      p.set(x, y, c);
    }
  // Звёзды: по хешу клетки, не на стыке.
  for (let i = 0; i < 5; i++) {
    const h = hash(wx * 5 + i, wy, 1510);
    if (h > 0.5) continue;
    const x = 1 + Math.floor(hash(wx, wy * 5 + i, 1511) * 14);
    const y = 1 + Math.floor(hash(wx * 3 + i, wy * 7, 1512) * 14);
    const big = h < 0.05;
    const col = h < 0.18 ? STAR_C : h < 0.3 ? hx('#a8c8ff') : hx('#c8a8ff');
    if (big) sparkle(p, x, y, col, 1);
    else p.set(x, y, alpha(col, 0.5 + h));
  }
  if (hash(wx, wy, 1513) < 0.004) {
    // Далёкая планета.
    shadeEll(p, 8, 8, 3.5, 3.5, hash(wx, wy, 1514) < 0.5 ? ROSE : LAPIS, -0.1);
  }
}

/** Провал в породе (в Корнях): тьма с отсветом кристаллов по краю. */
function chasmPx(p: Px, c: CellCtx): void {
  const X0 = c.wx * TS;
  const Y0 = c.wy * TS;
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const n = fbm(X0 + x, Y0 + y, 24, 1520);
      p.set(x, y, ramp([hx('#020108'), hx('#06041a'), hx('#0e0a2c')], n * 0.7));
    }
  // Северный край: обрыв — лицо породы уходит вниз, тёмнея.
  if (c.open(0, -1) && c.markAt(0, -1) !== c.mark) {
    for (let x = 0; x < TS; x++) {
      const h = 5 + Math.floor(vnoise(X0 + x, Y0, 4, 1521) * 4);
      for (let y = 0; y < h; y++) {
        const k = y / h;
        p.set(x, y, mixc(STONE[2], hx('#05030c'), k));
      }
      if (hash(X0 + x, Y0, 1522) < 0.18) p.set(x, h - 2, alpha(TEAL_GLOW, 0.7));
    }
  }
  for (let i = 0; i < 2; i++)
    if (hash(c.wx * 2 + i, c.wy, 1523) < 0.3)
      p.set(2 + Math.floor(hash(c.wx, c.wy + i, 1524) * 12), 6 + Math.floor(hash(c.wx + i, c.wy, 1525) * 9), alpha(TEAL_GLOW, 0.5));
}

/** Сердцевина колодца: воронка света, закрученная (сам свет живёт в предмете). */
function corePx(p: Px, c: CellCtx): void {
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const dx = x + 0.5 - 8;
      const dy = y + 0.5 - 8;
      const r = Math.hypot(dx, dy) / 8;
      const a = Math.atan2(dy, dx) + r * 5;
      const sw = 0.5 + 0.5 * Math.sin(a * 3);
      let col = ramp([hx('#ffffff'), hx('#9ff8ff'), hx('#2aa8c8'), hx('#123060'), hx('#06041a')], r * 0.9 + sw * 0.12);
      if (r > 1) col = ramp(SKY, 0.4);
      p.set(x, y, col);
    }
  void c;
}

/** Пол-порода Корней: индиго с вкраплениями кристалла. */
function rootFloor(p: Px, c: CellCtx, grit: boolean): void {
  const X0 = c.wx * TS;
  const Y0 = c.wy * TS;
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const Y = Y0 + y;
      const v = voronoi(X, Y, grit ? 3.2 : 7, grit ? 1531 : 1530);
      const n = fbm(X, Y, 20, 1532);
      let col: RGBA;
      if (grit) {
        // Старая выработка: щебень с бурым налётом.
        const l = -(v.ox * LX + v.oy * LY) * 0.9 + 0.35 + (n - 0.5) * 0.5;
        col = v.d2 - v.d1 < 0.12 ? hx('#120e1e') : tone(tn('#1a1424', '#2a2234', '#3c3248', '#544862'), l);
      } else {
        const l = (n - 0.5) * 0.9 + 0.3 - (v.d2 - v.d1 < 0.08 ? 0.5 : 0) + v.id * 0.25;
        col = tone(STONE, l);
        // Крупинки кристалла.
        const h = hash(X, Y, 1533);
        if (h < 0.012) col = CRYST[2];
        else if (h < 0.018) col = VIOLET[2];
      }
      p.set(x, y, col);
    }
}

/** Жила: в полу светится бирюзовая прожилка. */
function veinFloor(p: Px, c: CellCtx): void {
  rootFloor(p, c, false);
  const X0 = c.wx * TS;
  const Y0 = c.wy * TS;
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const Y = Y0 + y;
      const r = Math.abs(fbm(X, Y, 18, 1540) - 0.5);
      if (r < 0.02) p.set(x, y, hx('#d8ffff'));
      else if (r < 0.045) p.set(x, y, TEAL[2]);
      else if (r < 0.075) p.set(x, y, mixc(p.get(x, y), TEAL[1], 0.6));
    }
}

/** Кайма колодца: шестигранные кристальные плиты, светлее к ядру. */
function rimFloor(p: Px, c: CellCtx, obs: boolean): void {
  const X0 = c.wx * TS;
  const Y0 = c.wy * TS;
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const Y = Y0 + y;
      const v = voronoi(X, Y, 5, 1550);
      const edge = v.d2 - v.d1 < 0.1;
      const l = -(v.ox * LX + v.oy * LY) * 1.2 + 0.45 + v.id * 0.2;
      let col = edge ? (obs ? BRASS[1] : TEAL[1]) : tone(obs ? LAPIS : CRYST, l - 0.15);
      if (!edge && hash(X, Y, 1551) < 0.01) col = WHITE;
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
function heavyFloor(p: Px, c: CellCtx): void {
  const X0 = c.wx * TS;
  const Y0 = c.wy * TS;
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const Y = Y0 + y;
      const n = fbm(X, Y, 14, 1570);
      const ring = Math.sin(Math.hypot(((X % 48) + 48) % 48 - 24, ((Y % 48) + 48) % 48 - 24) * 0.9);
      let col = tone(tn('#120a18', '#22142a', '#34203e', '#4a2e54'), (n - 0.5) * 0.8 + 0.2);
      if (ring > 0.93) col = mixc(col, hx('#a04a6a'), 0.45);
      p.set(x, y, col);
    }
}

/** Кромка стены на полу под ней (стена в одну клетку). */
function capOnFloor(p: Px, c: CellCtx, t: Tones): void {
  if (c.open(0, 1)) return;
  for (let x = 0; x < TS; x++) {
    p.set(x, 13, t[3]);
    p.set(x, 14, t[2]);
    p.set(x, 15, t[1]);
  }
}

/** Тень у подножия стены: сверху и с боков. */
function wallShade(p: Px, c: CellCtx): void {
  const sh = hx('#000000');
  if (!c.open(0, -1)) for (let x = 0; x < TS; x++) for (let y = 0; y < 3; y++) p.set(x, y, alpha(sh, 0.45 - y * 0.13));
  if (!c.open(-1, 0)) for (let y = 0; y < TS; y++) for (let x = 0; x < 2; x++) p.set(x, y, alpha(sh, 0.3 - x * 0.13));
  if (!c.open(1, 0)) for (let y = 0; y < TS; y++) for (let x = 0; x < 2; x++) p.set(15 - x, y, alpha(sh, 0.3 - x * 0.13));
}

/** Стена Корней: порода с кристальными друзами; лицо — слои. */
function rockWall(p: Px, c: CellCtx, crystal: boolean): void {
  const X0 = c.wx * TS;
  const Y0 = c.wy * TS;
  const face = c.open(0, 1);
  const capH = face ? 5 : 16;
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const Y = Y0 + y;
      let col: RGBA;
      if (y < capH) {
        const v = voronoi(X, Y, crystal ? 4.5 : 9, crystal ? 1581 : 1580);
        const l = -(v.ox * LX + v.oy * LY) * 1.4 + 0.35 + v.id * 0.3;
        col = crystal || v.id > 0.86 ? tone(v.id > 0.5 ? CRYST : VIOLET, l) : tone(STONE2, l);
        if (v.d2 - v.d1 < 0.08) col = INK;
      } else {
        // Лицо: слои породы, внизу темнее; в слоях — кристальные иглы.
        const band = Math.sin((Y + vnoise(X, Y, 12, 1582) * 8) * 0.7);
        col = tone(crystal ? CRYST : STONE, band * 0.4 + 0.3 - (y - capH) * 0.035);
        if (!crystal && hash(Math.floor(X / 3), Y, 1583) < 0.02) col = TEAL[2];
        if (y === capH) col = crystal ? CRYST[3] : STONE[3];
      }
      p.set(x, y, col);
    }
  if (face && crystal)
    for (let i = 0; i < 2; i++) {
      // Кристалл растёт из лица стены.
      const bx = 3 + Math.floor(hash(c.wx, c.wy + i, 1584) * 10);
      const h = 4 + Math.floor(hash(c.wx + i, c.wy, 1585) * 4);
      facet(p, [[bx - 2, 15], [bx, 15 - h], [bx + 1, 15]], CRYST, -1, 0, 0.2);
      facet(p, [[bx + 1, 15], [bx, 15 - h], [bx + 3, 15]], CRYST, 1, 0, -0.1);
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
      let col = tone(VIOLET, l);
      if (v.d2 - v.d1 < 0.09) col = hx('#e8d8ff');
      p.set(x, y, col);
    }
}

// --- Обсерватория -----------------------------------------------------------

/** Плиты Обсерватории: тёмный камень, латунные швы. */
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
      let col = tone(tn('#141830', '#1e2440', '#2a3254', '#3a4470'), (n - 0.5) * 0.6 + 0.3 + id * 0.2);
      if (u === 0 || v === 0) col = BRASS[0];
      if ((u === 1 || v === 1) && hash(X, Y, 1602) < 0.5) col = mixc(col, BRASS[1], 0.4);
      p.set(x, y, col);
    }
}

/** Звёздная карта: эмаль ночи, звёзды и тонкие линии созвездий. */
function chartFloor(p: Px, c: CellCtx, node: boolean): void {
  const X0 = c.wx * TS;
  const Y0 = c.wy * TS;
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const Y = Y0 + y;
      const n = fbm(X, Y, 30, 1610);
      let col = ramp([hx('#060a24'), hx('#0c1640'), hx('#16245e')], n);
      const h = hash(X, Y, 1611);
      if (h < 0.01) col = STAR_C;
      else if (h < 0.02) col = hx('#7a8ad0');
      p.set(x, y, col);
    }
  // Сетка небесных координат — золотом, редкая.
  for (let i = 0; i < TS; i++) {
    if ((((X0 + i) % 32) + 32) % 32 === 0) for (let y = 0; y < TS; y++) p.set(i, y, alpha(BRASS[2], 0.35));
    if ((((Y0 + i) % 32) + 32) % 32 === 0) for (let x = 0; x < TS; x++) p.set(x, i, alpha(BRASS[2], 0.35));
  }
  if (node) {
    glow(p, 8, 8, 6, hx('#a8c8ff'), 0.7);
    p.ell(8, 8, 4.5, 4.5, alpha(BRASS[2], 0.0));
    for (let a = 0; a < TAU; a += 0.15) p.set(8 + Math.cos(a) * 5, 8 + Math.sin(a) * 5, BRASS[2]);
    sparkle(p, 8, 8, WHITE, 2);
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
      const n = vnoise(X, Y, 3, 1620);
      const l = 0.45 + (n - 0.5) * 0.6 + Math.sin((X + Y) * 0.3) * 0.15;
      let col = tone(BRASS, l);
      // Гравировка: деления.
      if ((((X * 7 + Y * 3) % 23) + 23) % 23 === 0) col = BRASS[0];
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
      let col = tone(tn('#1a0a2c', '#2a1044', '#3c1a5c', '#5a2a80'), 0.3 + (n - 0.5) * 0.4);
      // Узор: ромбы.
      const u = (((X % 12) + 12) % 12) - 6;
      const v = (((Y % 12) + 12) % 12) - 6;
      if (Math.abs(u) + Math.abs(v) === 4) col = mixc(col, GOLD[1], 0.6);
      if (Math.abs(u) + Math.abs(v) === 0) col = GOLD[2];
      if (edgeL && x < 3) col = x === 1 ? GOLD[2] : GOLD[0];
      if (edgeR && x > 12) col = x === 14 ? GOLD[2] : GOLD[0];
      p.set(x, y, col);
    }
}

/** Мозаика: зодиакальные плитки — лазурь, слоновая кость, золото. */
function mosaicFloor(p: Px, c: CellCtx): void {
  const X0 = c.wx * TS;
  const Y0 = c.wy * TS;
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const Y = Y0 + y;
      const tx = Math.floor(X / 3);
      const ty = Math.floor(Y / 3);
      const grout = ((X % 3) + 3) % 3 === 2 || ((Y % 3) + 3) % 3 === 2;
      // Большие круги узора по 64 точки.
      const cx = ((X % 64) + 64) % 64 - 32;
      const cy = ((Y % 64) + 64) % 64 - 32;
      const r = Math.hypot(cx, cy);
      const h = hash(tx, ty, 1640);
      let col: RGBA;
      if (r > 26 && r < 30) col = tone(GOLD, 0.3 + h * 0.4);
      else if (r < 7) col = tone(IVORY, 0.4 + h * 0.4);
      else if (Math.abs(Math.sin(Math.atan2(cy, cx) * 6)) < 0.18 && r < 26) col = tone(IVORY, 0.2 + h * 0.3);
      else col = tone(LAPIS, 0.2 + h * 0.5);
      if (grout) col = mixc(col, INK, 0.55);
      p.set(x, y, col);
    }
}

/** Стена Обсерватории: тёсаный камень, латунный карниз, иногда окно в небо. */
function obsWall(p: Px, c: CellCtx, window: boolean): void {
  const X0 = c.wx * TS;
  const Y0 = c.wy * TS;
  const face = c.open(0, 1);
  const capH = face ? 5 : 16;
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const Y = Y0 + y;
      let col: RGBA;
      if (y < capH) {
        // Верх кладки — плиты с латунным бортом у края.
        const row = Math.floor(Y / 6);
        const off = row % 2 ? 4 : 0;
        const u = (((X + off) % 8) + 8) % 8;
        col = tone(tn('#0e1024', '#181c38', '#22284c', '#2e3662'), 0.3 + hash(Math.floor((X + off) / 8), row, 1650) * 0.4);
        if (u === 0 || ((Y % 6) + 6) % 6 === 0) col = hx('#0a0a18');
      } else {
        const yy = y - capH;
        const row = Math.floor(yy / 4);
        const off = row % 2 ? 5 : 0;
        const u = (((X + off) % 10) + 10) % 10;
        col = tone(tn('#161a34', '#222846', '#30385e', '#424c7a'), 0.35 + hash(Math.floor((X + off) / 10), row + c.wy * 4, 1651) * 0.35 - yy * 0.02);
        if (yy % 4 === 0 || u === 0) col = hx('#0c0e20');
        if (yy < 2) col = yy === 0 ? BRASS[3] : BRASS[1];
      }
      p.set(x, y, col);
    }
  if (face && window) {
    // Круглое окно: космос, латунная рама.
    const cx = 8;
    const cy = 10;
    for (let y = 5; y < 16; y++)
      for (let x = 2; x < 14; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d < 4.2) {
          const n = fbm(X0 + x, Y0 + y, 10, 1652);
          p.set(x, y, ramp([hx('#05031a'), hx('#1a1050'), hx('#3a2080')], n));
          if (hash(X0 + x, Y0 + y, 1653) < 0.08) p.set(x, y, STAR_C);
        } else if (d < 5.4) p.set(x, y, tone(BRASS, (cy - y) / 6 + 0.4));
      }
  }
}

/** Звёздная дверь: закрыта — плита с созвездием-замком, открыта — порог. */
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
      let col = tone(LAPIS, 0.2 + n * 0.4);
      if (y < 2) col = BRASS[2];
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
      // Кратеры: ячейки Вороного, край светлее с подсвета, дно темнее.
      const v = voronoi(X, Y, 11, 1701);
      let l = (n - 0.5) * 0.7 + 0.35;
      if (v.id < 0.35 && v.d1 < 0.34) {
        const k = v.d1 / 0.34;
        l += k > 0.8 ? (v.ox * LX + v.oy * LY) * -1.5 : -0.35 * (1 - k);
      }
      let col = tone(tn('#1c1828', '#2c2638', '#3e374c', '#575066'), l);
      if (hash(X, Y, 1702) < 0.008) col = hx('#8a84a0');
      p.set(x, y, col);
    }
}

/** Причал: латунный настил с кольцами для швартовки. */
function dockFloor(p: Px, c: CellCtx): void {
  const X0 = c.wx * TS;
  const Y0 = c.wy * TS;
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = X0 + x;
      const Y = Y0 + y;
      const plank = ((Y % 5) + 5) % 5;
      let col = tone(tn('#2a1e10', '#4a3618', '#6a5024', '#8a6c34'), 0.3 + vnoise(X, Y, 6, 1710) * 0.4);
      if (plank === 0) col = hx('#1a120a');
      if ((((X % 16) + 16) % 16 === 3 || ((X % 16) + 16) % 16 === 12) && plank === 2) col = BRASS[3];
      p.set(x, y, col);
    }
  // Кромка к пустоте — латунный борт.
  for (let i = 0; i < TS; i++) {
    if (!c.open(0, -1) || c.markAt(0, -1) === MK.lane || c.markAt(0, -1) === MK.void) p.set(i, 0, BRASS[2]);
    if (c.markAt(0, 1) === MK.lane || c.markAt(0, 1) === MK.island) p.set(i, 15, BRASS[1]);
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
  // Борта моста там, где рядом пустота.
  const rail = (side: 'l' | 'r' | 't' | 'b') => {
    for (let i = 0; i < TS; i++) {
      const [x, y] = side === 'l' ? [0, i] : side === 'r' ? [15, i] : side === 't' ? [i, 0] : [i, 15];
      p.set(x, y, hx('#e0ffff'));
    }
  };
  if (!c.open(-1, 0) || c.markAt(-1, 0) === MK.void) rail('l');
  if (!c.open(1, 0) || c.markAt(1, 0) === MK.void) rail('r');
  if (c.markAt(0, -1) === MK.void) rail('t');
  if (c.markAt(0, 1) === MK.void) rail('b');
}

/** Стена Пояса: глыба астероида (видна только у края островов). */
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
      const l = -(v.ox * LX + v.oy * LY) * 1.2 + 0.3 + (y >= capH ? -0.25 - (y - capH) * 0.03 : 0);
      let col = tone(METEOR, l);
      if (v.d2 - v.d1 < 0.07) col = hx('#120c0c');
      if (y === capH && face) col = METEOR[3];
      p.set(x, y, col);
    }
}

const CELL_CACHE = new Map<string, Px>();

function cellOf(area: string) {
  return (c: CellCtx): Px | null => {
    const mk = c.mark;
    const p = new Px(TS, TS);
    // Пустота и провалы.
    if (c.tile === T_DEEP) {
      if (mk === MK.core) corePx(p, c);
      else if (mk === MK.pit) chasmPx(p, c);
      else if (mk === MK.lane || mk === MK.island) spacePx(p, c.wx, c.wy, 1, true);
      else if (mk === MK.vortex) spacePx(p, c.wx, c.wy, 1.3);
      else if (area === F15_ROOTS && mk !== MK.void) chasmPx(p, c);
      else spacePx(p, c.wx, c.wy);
      return p;
    }
    // Стены.
    if (!c.open(0, 0)) {
      if (mk === MK.seal) sealPx(p, c);
      else if (mk === MK.door) doorPx(p, c, false);
      else if (mk === MK.xwall || mk === MK.memory) rockWall(p, c, true);
      else if (mk === MK.obswall || area === F15_OBS) obsWall(p, c, mk === MK.window);
      else if (mk === MK.window) obsWall(p, c, true);
      else if (area === F15_ORBIT) asteroidWall(p, c);
      else rockWall(p, c, false);
      return p;
    }
    // Пол.
    const rootish = (q: Px, cc: CellCtx) => rootFloor(q, cc, false);
    const baseOf = area === F15_OBS ? slabFloor : area === F15_ORBIT ? regolith : rootish;
    switch (mk) {
      case MK.grit:
        rootFloor(p, c, true);
        break;
      case MK.vein:
        veinFloor(p, c);
        break;
      case MK.rim:
        rimFloor(p, c, area === F15_OBS);
        break;
      case MK.float:
        floatFloor(p, c, baseOf);
        break;
      case MK.heavy:
        heavyFloor(p, c);
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
        spacePx(p, c.wx, c.wy, 1, true);
        return p;
      default:
        baseOf(p, c);
    }
    wallShade(p, c);
    capOnFloor(p, c, area === F15_OBS ? tn('#0e1024', '#181c38', '#22284c', '#2e3662') : area === F15_ORBIT ? METEOR : STONE2);
    return p;
  };
}

registerCellPainter(F15_ROOTS, cellOf(F15_ROOTS));
registerCellPainter(F15_OBS, cellOf(F15_OBS));
registerCellPainter(F15_ORBIT, cellOf(F15_ORBIT));
void CELL_CACHE;
