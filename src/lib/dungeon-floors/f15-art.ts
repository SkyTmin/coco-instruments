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
import { COMET, F15_FX, f15State, GRAVITON, METEOR as METEOR_K, MOTIFS, NOVA, URCHIN } from './f15-brains';
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
function crystal(p: Px, bx: number, by: number, w: number, h: number, lean: number, t: Tones, glowK = 0): void {
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
  const w = st?.wells.find((q) => Math.abs(q.x - o.x - 0.5) < 1.2 && Math.abs(q.y - o.y - 0.5) < 1.2);
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
      poly(p, [[x0, cy + Math.sin(a0) * 1.2], [cx, cy - H], [x1, cy + Math.sin(a1) * 1.2]], tone(col, 0.45 + l * 0.45));
      poly(p, [[x0, cy + Math.sin(a0) * 1.2], [cx, cy + H * 0.8], [x1, cy + Math.sin(a1) * 1.2]], tone(col, 0.15 + l * 0.4));
    }
    p.set(cx, cy - H + 1, WHITE);
    p.set(cx - 1, cy - 2, WHITE);
    p.set(cx, cy - 3, alpha(WHITE, 0.8));
    // Искры по орбите.
    for (let i = 0; i < 3; i++) {
      const a = (f / 12) * TAU * (s === 2 ? -1 : 1) + (i * TAU) / 3;
      sparkle(p, cx + Math.cos(a) * 9, cy + Math.sin(a) * 3.5, s ? WHITE : alpha(g, 0.8), s === 2 ? 1 : 0);
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
    glow(p, cx, by - 22, 22, run === 2 ? hx('#7ab0c0') : TEAL_GLOW, 0.25 + pulse * 0.25 * (run === 2 ? 0.3 : 1));
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
    const p = new Px(16, 16);
    const cx = 8;
    const shimmer = 0.5 + 0.5 * Math.sin((f / 6) * TAU);
    const t = used ? tn('#1a1430', '#2a2048', '#3a3060', '#5a5080') : VIOLET;
    // Оправа породы и сам камень — восьмигранник.
    poly(p, [[3, 4], [6, 1], [10, 1], [13, 4], [13, 12], [10, 15], [6, 15], [3, 12]], STONE[0]);
    poly(p, [[4, 5], [6.5, 2], [9.5, 2], [12, 5], [12, 11.5], [9.5, 14], [6.5, 14], [4, 11.5]], (x, y) => {
      const k = (x - 4 + (y - 2)) / 18;
      return mixc(t[2], t[0], k);
    });
    if (!used) {
      glow(p, cx, 8, 5 + g, VIOLET_GLOW, 0.35 + g * 0.18 + shimmer * 0.1);
      motifGlyph(p, cx, 8, motif, alpha(hx('#f4eaff'), 0.55 + g * 0.15));
      p.set(5, 4, WHITE);
      p.set(6, 3, alpha(WHITE, 0.7));
      if (g >= 2) for (let i = 0; i < 4; i++) sparkle(p, cx + Math.cos(i * 1.57 + f) * 6, 8 + Math.sin(i * 1.57 + f) * 6, WHITE, 0);
    } else {
      stroke(p, 6, 3, 9, 8, INK);
      stroke(p, 9, 8, 7, 13, INK);
      motifGlyph(p, cx, 8, motif, alpha(hx('#6a5a90'), 0.4));
    }
    return { p, ax: cx, ay: 15 };
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
      const wv = 6 + Math.sin(y * 0.35 + v) * 0.8 + (y > 36 ? (y - 36) * 0.4 : 0) + (y < 8 ? (8 - y) * 0.3 : 0);
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
      ? [[3, 16], [2, 10], [6, 5], [12, 4], [18, 7], [20, 13], [17, 17], [8, 18]]
      : [[2, 15], [4, 8], [9, 4], [15, 5], [19, 10], [18, 16], [11, 18]];
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
    for (let a = 0; a < TAU; a += 0.25) p.set(cx + 3 + Math.cos(a) * 2.2, 12 + Math.sin(a) * 2.6, Math.sin(a) < 0 ? BRASS[3] : BRASS[1]);
    // Витки троса у основания.
    for (let i = 0; i < 3; i++) p.ell(cx, 16 - i * 1.5, 3.2, 0.7, i % 2 ? hx('#7a6a90') : hx('#b0a4c8'));
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
  const done = what === 'door' ? (st?.doors.some((d) => d.open) ? 1 : 0) : st && st.dark > 0.05 ? 0 : 1;
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
      for (let i = 2; i < 7; i++) p.set(cx + Math.cos(a) * (2 + i), 8.5, alpha(hx('#cff6ff'), 0.6 - i * 0.07));
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
        let y = 0;
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
    for (const rg of rings) for (const [x, y, z] of rg.pts) if (z < 0) p.set(cx + x, cy + y, rg.c[1]);
    shadeEll(p, cx, cy, 3.4, 3.4, LAPIS, 0.1);
    p.set(cx - 1, cy - 1, hx('#7ad0a0'));
    p.set(cx + 1, cy, hx('#5ab080'));
    for (const rg of rings) for (const [x, y, z] of rg.pts) if (z >= 0) p.set(cx + x, cy + y, z > R * 0.5 ? rg.c[3] : rg.c[2]);
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
    for (let a = 0; a < TAU; a += TAU / 24) p.set(cx + Math.cos(a) * 13, 26.5 + Math.sin(a) * 4, BRASS[3]);
    limb(p, cx, 26, cx, 18, 1.2, 1, BRASS);
    const t = (f / 48) * TAU;
    const planets = [
      { r: 5, s: 4, c: METEOR, rad: 1.2 },
      { r: 8.5, s: 2, c: ROSE, rad: 1.6 },
      { r: 12, s: 1, c: LAPIS, rad: 2 },
      { r: 15.5, s: -1, c: GOLD, rad: 1.7 },
    ];
    // Орбиты — тонкие латунные кольца, сплюснутые.
    for (const pl of planets) for (let a = 0; a < TAU; a += 0.06) p.set(cx + Math.cos(a) * pl.r, cy + Math.sin(a) * pl.r * 0.34, alpha(BRASS[2], 0.45));
    const pos = planets.map((pl) => {
      const a = t * pl.s + pl.r;
      return { ...pl, x: cx + Math.cos(a) * pl.r, y: cy + Math.sin(a) * pl.r * 0.34, z: Math.sin(a) };
    });
    const drawP = (q: (typeof pos)[number]) => {
      stroke(p, cx, cy, q.x, q.y - 2, alpha(BRASS[1], 0.9));
      shadeEll(p, q.x, q.y - 2, q.rad, q.rad, q.c, 0.1);
      if (q.c === GOLD) for (let a = 0; a < TAU; a += 0.3) p.set(q.x + Math.cos(a) * 3, q.y - 2 + Math.sin(a), alpha(GOLD[3], 0.7));
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
        p.ell(xx, 15 - k, w, 0.7, kk < 0.3 ? hx('#ffe8a0') : kk < 0.7 ? hx('#bff4ff') : alpha(hx('#7ad8ff'), 0.8));
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
        if (h < 0.18 && hash(Math.floor(lon * 7), Math.floor(lat * 9), 1821) < 0.4) c = mixc(c, STAR_C, 0.8);
        if (Math.abs(((lon % 1.57) + 1.57) % 1.57) < 0.08) c = mixc(c, GOLD[2], 0.5);
        p.set(cx + x, cy + y, c);
      }
    // Меридиан-оправа.
    for (let a = -PI * 0.85; a < PI * 0.85; a += 0.08) p.set(cx + Math.sin(a) * (R + 1.2), cy - Math.cos(a) * (R + 1.2), BRASS[Math.cos(a) > 0 ? 3 : 1]);
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
    poly(p, [[2, 10], [16, 10], [15, 13], [3, 13]], WOOD[2]);
    poly(p, [[3, 5], [9, 6], [9, 11], [3, 10]], IVORY[3]);
    poly(p, [[9, 6], [15, 5], [15, 10], [9, 11]], IVORY[2]);
    // Карта на странице: звёзды и линия.
    sparkle(p, 5, 7, LAPIS[2], 0);
    p.set(7, 8, LAPIS[2]);
    stroke(p, 5, 7, 7, 8, alpha(LAPIS[1], 0.7));
    for (let i = 0; i < 3; i++) p.set(11 + i, 7 + (i % 2), alpha(INK, 0.5));
    if (turn) {
      const k = turn / 6;
      const x = 15 - k * 12;
      poly(p, [[9, 6], [x, 5 - Math.sin(k * PI) * 3], [x, 10 - Math.sin(k * PI) * 3], [9, 11]], IVORY[3]);
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
    poly(p, [[cx - 7, 38], [cx - 3, 14], [cx + 3, 14], [cx + 7, 38]], (x, y) => {
      const fold = Math.sin((x - cx) * 1.3 + y * 0.08);
      return tone(IVORY, (cx - x) * 0.06 + 0.42 + fold * 0.18);
    });
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
      poly(p, [[cx + 1, cy - 2], [cx + 6, cy - 4], [cx + 4, cy + 1]], BRASS[2]);
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
// Монстры. Каждый кадр строится раз на позу, сторону и вид (элита, альбинос),
// живёт в кеше с вытеснением. Слой `lit` — светящиеся части поверх темноты.
// ---------------------------------------------------------------------------

type Look = MobPose['look'];

interface Built {
  p: Px;
  /** Середина тела и земля в кадре (смотрит вправо). */
  ax: number;
  ay: number;
  eye: [number, number] | null;
  /** Светящееся: `true` — взять яркие пиксели кадра; Px — свой слой. */
  lit?: Px | boolean | null;
}

const FR = frameLRU<MobFrame>(1600);

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

function finish(b: Built, look: Look, flash: boolean, left: boolean): MobFrame {
  let p = b.p;
  let lit: Px | null = b.lit === true ? litOf(p) : b.lit || null;
  if (look === 'albino') {
    const pale = hx('#f4f0ff');
    const q = new Px(p.w, p.h);
    for (let i = 0; i < p.data.length; i += 4) {
      if (!p.data[i + 3]) continue;
      const l = (p.data[i] + p.data[i + 1] + p.data[i + 2]) / 3;
      const c = mixc([l, l, l, 255], pale, 0.5);
      q.data[i] = c[0];
      q.data[i + 1] = c[1];
      q.data[i + 2] = c[2];
      q.data[i + 3] = p.data[i + 3];
    }
    p = q;
  }
  if (look === 'elite') p.outline(GOLDK);
  if (flash) p = p.tint(WHITE, 0.85);
  if (left) {
    p = p.flipX();
    if (lit) lit = lit.flipX();
  }
  const eye = b.eye ? ([left ? p.w - 1 - b.eye[0] : b.eye[0], b.eye[1]] as [number, number]) : null;
  return { img: p.canvas(), ax: left ? p.w - b.ax : b.ax, ay: b.ay, eye, lit: lit ? lit.canvas() : null };
}

/**
 * Кадр из кеша. `flip` — отражать ли (кадры по направлению рисуются как
 * есть). `extra` — поля хода кадра (сдвиг, шлейф, прозрачность).
 */
function frameOf(
  kind: string,
  pose: MobPose,
  anim: string,
  f: number,
  build: () => Built,
  extra?: Partial<MobFrame> | null,
  flip: boolean = pose.left,
): MobFrame {
  const key = `${kind}|${anim}|${f}|${flip ? 1 : 0}|${pose.flash ? 1 : 0}|${pose.look}`;
  let fr = FR.get(key);
  if (!fr) fr = FR.set(key, finish(build(), pose.look, pose.flash, flip));
  return extra ? { ...fr, ...extra } : fr;
}

/** Звёздочки над головой оглушённого (кадр f из 4). */
function stars(p: Px, cx: number, cy: number, rx: number, f: number): void {
  for (let i = 0; i < 3; i++) {
    const a = (f / 4) * TAU + (i / 3) * TAU;
    const x = Math.round(cx + Math.cos(a) * rx);
    const y = Math.round(cy + Math.sin(a) * rx * 0.35);
    sparkle(p, x, y, i === 0 ? WHITE : hx('#fff27a'), 1);
  }
}

/** Смерть кристалла: фигура раскалывается, осколки летят в стороны и вниз. */
function shatter(p: Px, k: number, seed: number, bits: RGBA[], cx: number, cy: number): Px {
  if (k <= 0) return p;
  const o = new Px(p.w, p.h);
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      const i = (y * p.w + x) * 4;
      if (!p.data[i + 3]) continue;
      const r = hash(x >> 1, y >> 1, seed);
      if (r < k * 0.45) continue;
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.hypot(dx, dy) || 1;
      const push = k * (2 + r * 4);
      const tx = Math.round(x + (dx / d) * push);
      const ty = Math.round(y + (dy / d) * push * 0.6 + k * k * 4 * r);
      if (tx < 0 || ty < 0 || tx >= o.w || ty >= o.h) continue;
      const j = (ty * o.w + tx) * 4;
      const c: RGBA = r < k * 0.6 ? bits[Math.floor(r * 97) % bits.length] : [p.data[i], p.data[i + 1], p.data[i + 2], 255];
      o.data[j] = c[0];
      o.data[j + 1] = c[1];
      o.data[j + 2] = c[2];
      o.data[j + 3] = Math.round(255 * (1 - k * 0.5));
    }
  return o;
}

/** Номер кадра смерти по времени режима (0…3). */
const deathK = (pose: MobPose) => (pose.mode === 'dying' ? Math.min(3, Math.floor(pose.t / 0.16)) : 0);

/** Номер направления 0…n−1 по углу. */
const dirBucket = (a: number, n: number) => ((Math.round((a / TAU) * n) % n) + n) % n;

/** Глаз-бусина с бликом. */
function eyeDot(p: Px, x: number, y: number, c: RGBA = INK, big = false): void {
  p.set(x, y, c);
  if (big) {
    p.set(x + 1, y, c);
    p.set(x, y + 1, c);
    p.set(x + 1, y + 1, c);
  }
  p.set(x, y, big ? alpha(WHITE, 0.9) : c);
  if (!big) p.set(x, y - 1, alpha(WHITE, 0.0));
}

/** Шип-кристалл от точки (x, y) по углу a, длина L, ширина основания w. */
function spike(p: Px, x: number, y: number, a: number, L: number, w: number, t: Tones, tip: RGBA = WHITE): void {
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const tx = x + ux * L;
  const ty = y + uy * L;
  const lx = x - uy * w * 0.5;
  const ly = y + ux * w * 0.5;
  const rx = x + uy * w * 0.5;
  const ry = y - ux * w * 0.5;
  // Две грани: светлая к свету, тёмная от него.
  const lite = -uy * LX + ux * LY;
  poly(p, [[lx, ly], [tx, ty], [x, y]], tone(t, 0.5 - lite * 0.4));
  poly(p, [[x, y], [tx, ty], [rx, ry]], tone(t, 0.5 + lite * 0.4));
  p.set(tx, ty, tip);
}

// --- Кристальный ёж -----------------------------------------------------------

const URCH_FUR = tn('#2a1e3c', '#46345e', '#665088', '#9480b4');
const URCH_SKIN = tn('#5a3a50', '#8a5a70', '#b88496', '#e8bcc8');

/**
 * Ёж: тельце, мордочка вправо, на спине кристальные иглы.
 * `ball` 0…1 — свернулся, `bristle` 0…1 — иглы дыбом, `roll` — угол качения.
 */
function urchinBody(o: {
  step: number;
  ball: number;
  bristle: number;
  roll: number;
  glowK: number;
  dizzy: number;
  dk: number;
}): Built {
  const p = new Px(34, 30);
  const cx = 16;
  const cy = 19 - o.ball * 2;
  const rx = 7.5 - o.ball * 1.5;
  const ry = 5.2 + o.ball * 0.8;
  if (o.ball < 0.9) {
    // Лапки.
    const s = o.step;
    for (const [lx, ph] of [[cx - 4, 0], [cx - 1, 2], [cx + 2, 1], [cx + 5, 3]] as [number, number][]) {
      const up = (s + ph) % 4 < 2 ? 1 : 0;
      p.rect(lx, cy + 3, lx + 1, cy + 5 - up, URCH_SKIN[1]);
    }
  }
  // Иглы сзади (под телом): дальний ряд.
  const n = o.ball > 0.5 ? 16 : 11;
  const spikes: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    let a: number;
    if (o.ball > 0.5) a = (i / n) * TAU + o.roll;
    else a = PI * (0.62 + (i / (n - 1)) * 1.02 - o.ball * 0.4);
    const L = (5 + (i % 3) * 1.5) * (0.75 + o.bristle * 0.45);
    spikes.push([a, L, i]);
  }
  for (const [a, L, i] of spikes)
    if (Math.sin(a) < -0.2 || o.ball > 0.5)
      spike(p, cx + Math.cos(a) * rx * 0.7, cy + Math.sin(a) * ry * 0.7, a, L, 3, i % 4 === 0 ? VIOLET : CRYST);
  // Тело.
  shadeEll(p, cx, cy, rx, ry, URCH_FUR, 0.05);
  if (o.ball < 0.6) {
    // Мордочка: светлая, нос, глаз.
    const fx = cx + rx - 1;
    shadeEll(p, fx, cy + 1, 3.2 * (1 - o.ball), 2.6 * (1 - o.ball), URCH_SKIN, 0.1);
    p.set(fx + 3 - o.ball * 2, cy + 1, INK);
    if (o.dizzy) {
      // Глаза крестиком.
      p.set(fx - 1, cy - 2, INK);
      p.set(fx + 1, cy, INK);
      p.set(fx + 1, cy - 2, INK);
      p.set(fx - 1, cy, INK);
    } else {
      p.rect(fx - 1, cy - 2, fx, cy - 1, INK);
      p.set(fx - 1, cy - 2, WHITE);
    }
  }
  // Ближние иглы поверх спины.
  for (const [a, L, i] of spikes)
    if (o.ball <= 0.5 && Math.sin(a) >= -0.2 && Math.cos(a) < 0.3)
      spike(p, cx + Math.cos(a) * rx * 0.6, cy + Math.sin(a) * ry * 0.5, a, L * 0.8, 3, i % 3 === 0 ? VIOLET : CRYST);
  for (const [a, L] of spikes.slice(0, 7))
    if (o.ball <= 0.5) spike(p, cx - 2 + Math.cos(a) * 2, cy - 2 + Math.sin(a) * 2, a, L * 0.7, 2.5, CRYST);
  if (o.glowK > 0) glow(p, cx - 2, cy - 4, 10, TEAL_GLOW, 0.35 * o.glowK);
  if (o.dizzy) stars(p, cx + 2, cy - 10, 6, o.dizzy - 1);
  let out = p;
  if (o.dk) out = shatter(p, o.dk / 3, 1901, [CRYST[2], CRYST[3], VIOLET[2], WHITE], cx, cy);
  return { p: out, ax: cx, ay: 25, eye: o.ball < 0.6 && !o.dk ? [cx + rx - 2, cy - 2] : null, lit: true };
}

registerMobPainter('f15_urchin', (m: Mob, pose: MobPose) => {
  const dk = deathK(pose);
  if (dk) return frameOf('urchin', pose, 'die', dk, () => urchinBody({ step: 0, ball: 0, bristle: 1, roll: 0, glowK: 0, dizzy: 0, dk }));
  switch (pose.mode) {
    case 'f15_curl': {
      const k = Math.min(4, Math.floor((pose.t / URCHIN.curl) * 5));
      return frameOf('urchin', pose, 'curl', k, () => urchinBody({ step: 0, ball: k / 4, bristle: 0.5, roll: 0, glowK: k / 4, dizzy: 0, dk: 0 }), {
        still: true,
        sy: 1 - k * 0.03,
      });
    }
    case 'f15_roll': {
      const f = Math.floor(pose.now * 16) % 8;
      const flip = Math.cos(m.dir) < 0;
      return frameOf('urchin', pose, 'roll', f, () => urchinBody({ step: 0, ball: 1, bristle: 0.7, roll: (f / 8) * TAU * 0.5, glowK: 0.6, dizzy: 0, dk: 0 }), {
        ghost: { every: 0.05, life: 0.18, tint: '108,240,255', alpha: 0.45 },
        still: true,
      }, flip);
    }
    case 'f15_dizzy': {
      const f = Math.floor(pose.now * 6) % 4;
      return frameOf('urchin', pose, 'dizzy', f, () => urchinBody({ step: 0, ball: 0.3, bristle: 0.2, roll: 0, glowK: 0, dizzy: f + 1, dk: 0 }), { still: true });
    }
    case 'f15_open': {
      const k = Math.min(3, Math.floor((pose.t / URCHIN.open) * 4));
      return frameOf('urchin', pose, 'open', k, () => urchinBody({ step: 0, ball: 0, bristle: 0.6 + k * 0.15, roll: 0, glowK: 0.3 + k * 0.25, dizzy: 0, dk: 0 }), {
        still: true,
        sx: 1 + k * 0.03,
      });
    }
    case 'windup': {
      const k = Math.min(2, Math.floor((pose.t / 0.6) * 3));
      return frameOf('urchin', pose, 'wind', k, () => urchinBody({ step: 0, ball: 0.15, bristle: 0.9, roll: 0, glowK: 0.4, dizzy: 0, dk: 0 }), {
        dx: -k * 0.6,
        still: true,
      });
    }
    default: {
      const run = pose.anim === 'run';
      const f = run ? pose.frame % 4 : 0;
      return frameOf('urchin', pose, run ? 'run' : 'idle', f, () => urchinBody({ step: f, ball: 0, bristle: run ? 0.45 : 0.35, roll: 0, glowK: 0, dizzy: 0, dk: 0 }), run ? { dy: f % 2 ? -0.5 : 0 } : null);
    }
  }
});


// --- Метеорит ------------------------------------------------------------------

/**
 * Живой метеорит: гранёная глыба, трещины тлеют. `heat` 0…1 — накал
 * трещин, `dir` — куда летит (для шлейфа), `trail` — длина огненного хвоста.
 */
function meteorBody(o: { heat: number; f: number; dir: number; trail: number; dizzy: number; dk: number; crouch: number }): Built {
  const W = 52;
  const p = new Px(W, 44);
  const cx = 26;
  const cy = 26 + o.crouch;
  const ux = Math.cos(o.dir);
  const uy = Math.sin(o.dir);
  // Хвост пламени — против хода.
  if (o.trail > 0) {
    for (let i = 0; i < 26; i++) {
      const k = i / 26;
      const d = 6 + k * 16 * o.trail;
      const wob = Math.sin(o.f * 1.7 + i * 0.9) * k * 2;
      const x = cx - ux * d - uy * wob;
      const y = cy - uy * d * 0.8 + ux * wob;
      const r = (1 - k) * 6 + 1;
      const c = k < 0.25 ? hx('#fff4c0') : k < 0.55 ? hx('#ffb040') : hx('#c84a20');
      glow(p, x, y, r, c, 0.75 * (1 - k));
    }
  }
  glow(p, cx, cy, 14, hx('#ff9a30'), 0.12 + o.heat * 0.25);
  // Глыба: восьмиугольник с выщербинами, грани по свету.
  const pts: [number, number][] = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU + 0.3;
    const r = 9.5 + hash(i, 3, 1910) * 2.5;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.85]);
  }
  poly(p, pts, (x, y) => {
    const v = voronoi(x * 1.6, y * 1.6, 6, 1911);
    const l = -(v.ox * LX + v.oy * LY) * 1.1 + (cx - x) * 0.025 + (cy - y) * 0.04 + 0.3;
    return v.d2 - v.d1 < 0.1 ? mixc(METEOR[0], hx('#ff7a20'), o.heat * 0.9) : tone(METEOR, l);
  });
  // Трещины.
  const hot = mixc(hx('#c04010'), hx('#fff0a0'), o.heat);
  const cracks: [number, number, number, number][] = [
    [cx - 6, cy - 2, cx - 1, cy + 1],
    [cx - 1, cy + 1, cx + 4, cy - 4],
    [cx - 1, cy + 1, cx + 1, cy + 6],
    [cx + 4, cy - 4, cx + 7, cy - 2],
  ];
  for (const [a, b, c2, d] of cracks) stroke(p, a, b, c2, d, hot);
  // Глаза-угли — в сторону хода.
  if (!o.dk) {
    const ex = cx + 4;
    const ey = cy - 2;
    if (o.dizzy) {
      p.set(ex - 1, ey - 1, INK);
      p.set(ex + 1, ey + 1, INK);
      p.set(ex + 1, ey - 1, INK);
      p.set(ex - 1, ey + 1, INK);
    } else {
      p.rect(ex - 1, ey - 1, ex, ey, hx('#fff0a0'));
      p.rect(ex + 3, ey - 1, ex + 4, ey, hx('#fff0a0'));
      p.set(ex - 1, ey - 2, alpha(INK, 0.8));
      p.set(ex + 4, ey - 2, alpha(INK, 0.8));
    }
  }
  if (o.dizzy) stars(p, cx, cy - 13, 8, o.dizzy - 1);
  let out = p;
  if (o.dk) out = shatter(p, o.dk / 3, 1912, [METEOR[1], METEOR[2], hx('#ffb040'), hx('#fff0a0')], cx, cy);
  return { p: out, ax: cx, ay: 36, eye: o.dk || o.dizzy ? null : [cx + 4, cy - 2], lit: true };
}

registerMobPainter('f15_meteor', (m: Mob, pose: MobPose) => {
  const dk = deathK(pose);
  if (dk) return frameOf('meteor', pose, 'die', dk, () => meteorBody({ heat: 0.4, f: 0, dir: 0, trail: 0, dizzy: 0, dk, crouch: 0 }));
  switch (pose.mode) {
    case 'aim': {
      const k = Math.min(3, Math.floor((pose.t / METEOR_K.aim) * 4));
      const f = Math.floor(pose.now * 12) % 2;
      return frameOf('meteor', pose, 'aim', k * 2 + f, () => meteorBody({ heat: 0.4 + k * 0.2, f, dir: 0, trail: 0, dizzy: 0, dk: 0, crouch: k * 0.6 }), {
        still: true,
        dx: f ? 0.5 : -0.5,
      });
    }
    case 'f15_charge': {
      const b = dirBucket(Math.atan2(m.vy, m.vx), 16);
      const f = Math.floor(pose.now * 14) % 3;
      return frameOf('meteor', pose, 'charge', b * 3 + f, () => meteorBody({ heat: 1, f, dir: (b / 16) * TAU, trail: 1, dizzy: 0, dk: 0, crouch: 0 }), {
        still: true,
        ghost: { every: 0.04, life: 0.2, tint: '255,150,60', alpha: 0.5 },
      }, false);
    }
    case 'f15_dizzy': {
      const f = Math.floor(pose.now * 6) % 4;
      return frameOf('meteor', pose, 'dizzy', f, () => meteorBody({ heat: 0.15, f: 0, dir: 0, trail: 0, dizzy: f + 1, dk: 0, crouch: 1 }), { still: true });
    }
    default: {
      const run = pose.anim === 'run' || pose.anim === 'wind';
      const f = Math.floor(pose.now * 5) % 4;
      return frameOf('meteor', pose, 'idle', f, () => meteorBody({ heat: 0.35 + 0.1 * Math.sin((f / 4) * TAU), f, dir: 0, trail: 0, dizzy: 0, dk: 0, crouch: 0 }), run ? { rot: Math.sin(pose.now * 8) * 0.08 } : null);
    }
  }
});

// --- Комета -------------------------------------------------------------------

/** Комета: ледяное ядро с мордочкой и хвост света против хода. */
function cometBody(o: { dir: number; tail: number; f: number; aim: number; dk: number }): Built {
  const p = new Px(48, 40);
  const cx = 24;
  const cy = 22;
  const ux = Math.cos(o.dir);
  const uy = Math.sin(o.dir);
  // Хвост: два языка — бирюзовый (газ) и белый (пыль), чуть врозь.
  for (const [off, col] of [[0.18, hx('#7ae8ff')], [-0.12, hx('#e8f4ff')]] as [number, RGBA][]) {
    const a = o.dir + PI + off;
    for (let i = 0; i < 22; i++) {
      const k = i / 22;
      const d = 3 + k * 18 * o.tail;
      const wob = Math.sin(o.f * 1.3 + i * 0.7) * k * 1.4;
      const x = cx + Math.cos(a) * d - Math.sin(a) * wob;
      const y = cy + Math.sin(a) * d * 0.85 + Math.cos(a) * wob;
      glow(p, x, y, (1 - k) * 4 + 0.8, col, 0.55 * (1 - k));
    }
  }
  // Ядро.
  glow(p, cx, cy, 8 + o.aim * 3, TEAL_GLOW, 0.4 + o.aim * 0.3);
  shadeEll(p, cx, cy, 5, 4.6, tn('#4a8ab0', '#8ad0f0', '#d0f4ff', '#ffffff'), 0.2);
  // Ледяные гребни по ядру.
  for (let i = 0; i < 5; i++) {
    const a = o.dir + PI * 0.6 + i * 0.5;
    spike(p, cx + Math.cos(a) * 3.5, cy + Math.sin(a) * 3.2, a, 3.5, 2.2, CRYST);
  }
  // Мордочка — по ходу.
  if (!o.dk) {
    const ex = cx + ux * 2.2;
    const ey = cy + uy * 1.8 - 1;
    p.set(ex - 1.2, ey, INK);
    p.set(ex + 1.2, ey, INK);
    if (o.aim > 0.5) {
      p.set(ex - 1.2, ey - 1, INK);
      p.set(ex + 1.2, ey - 1, INK);
    }
  }
  let out = p;
  if (o.dk) out = shatter(p, o.dk / 3, 1920, [WHITE, CRYST[3], TEAL[2]], cx, cy);
  return { p: out, ax: cx, ay: 30, eye: o.dk ? null : [cx + Math.round(ux * 2), cy - 1], lit: true };
}

registerMobPainter('f15_comet', (m: Mob, pose: MobPose) => {
  const dk = deathK(pose);
  const sp = Math.hypot(m.vx, m.vy);
  const ang = sp > 1 ? Math.atan2(m.vy, m.vx) : m.dir;
  const b = dirBucket(ang, 16);
  if (dk) return frameOf('comet', pose, 'die', dk * 16 + b, () => cometBody({ dir: (b / 16) * TAU, tail: 0.3, f: 0, aim: 0, dk }), null, false);
  const f = Math.floor(pose.now * 10) % 4;
  if (pose.mode === 'aim') {
    const k = Math.min(2, Math.floor((pose.t / COMET.aim) * 3));
    return frameOf('comet', pose, 'aim', (b * 3 + k) * 4 + f, () => cometBody({ dir: (b / 16) * TAU, tail: 0.35 - k * 0.1, f, aim: 0.4 + k * 0.3, dk: 0 }), { still: true }, false);
  }
  if (pose.mode === 'f15_dash')
    return frameOf('comet', pose, 'dash', b * 4 + f, () => cometBody({ dir: (b / 16) * TAU, tail: 1.2, f, aim: 1, dk: 0 }), {
      still: true,
      ghost: { every: 0.03, life: 0.22, tint: '140,240,255', alpha: 0.55 },
    }, false);
  const tail = Math.min(1, 0.45 + sp * 0.08);
  return frameOf('comet', pose, 'fly', b * 4 + f, () => cometBody({ dir: (b / 16) * TAU, tail, f, aim: 0, dk: 0 }), null, false);
});

// --- Гравитон -----------------------------------------------------------------

const GRAV_T = tn('#120a20', '#24163c', '#3a2660', '#5a428a');
const GRAV_PLATE = tn('#1a1c34', '#2e3458', '#4a5484', '#7a88bc');

/**
 * Гравитон: тяжёлый страж из тёмной материи. Спереди — щит-плита (удар в лоб
 * гасится), сзади открыто ядро. Вокруг — линза: кольцо искривлённого света.
 * `arms` 0…1 — кулаки вверх (замах), `slam` — удар вниз.
 */
function gravBody(o: { step: number; arms: number; slam: number; f: number; dk: number }): Built {
  const p = new Px(56, 56);
  const cx = 26;
  const gy = 50;
  const cy = 34 + o.slam * 2;
  // Кольцо-линза за спиной (задняя половина).
  const ringR = 15 + Math.sin((o.f / 8) * TAU) * 0.6;
  for (let a = PI; a < TAU; a += 0.03) p.set(cx + Math.cos(a) * ringR, cy - 4 + Math.sin(a) * ringR * 0.35, alpha(VIOLET_GLOW, 0.55));
  // Ноги — столбы.
  const s = o.step;
  for (const [lx, ph] of [[cx - 6, 0], [cx + 5, 2]] as [number, number][]) {
    const up = (s + ph) % 4 < 2 ? 1 : 0;
    limb(p, lx, cy + 6, lx, gy - 1 - up, 3.6, 3.2, GRAV_T);
    p.ell(lx, gy - 1 - up, 4, 1.6, GRAV_T[0]);
  }
  // Задняя рука.
  const ay = cy - 6;
  const hb = o.arms > 0 ? ay - 14 * o.arms + o.slam * 22 : cy + 6;
  limb(p, cx - 9, ay, cx - 10 + o.arms * 4, hb, 3, 3.4, GRAV_T, -0.1);
  shadeEll(p, cx - 10 + o.arms * 4, hb, 4, 3.6, GRAV_T, -0.05);
  // Корпус: глыба шире кверху.
  poly(p, [[cx - 11, cy - 12], [cx + 11, cy - 12], [cx + 8, cy + 8], [cx - 8, cy + 8]], (x, y) => {
    const v = voronoi(x * 1.3, y * 1.3, 7, 1930);
    const l = -(v.ox * LX + v.oy * LY) * 0.9 + (cx - x) * 0.03 + 0.3;
    return v.d2 - v.d1 < 0.09 ? hx('#7a56d8') : tone(GRAV_T, l);
  });
  // Ядро на спине (видно сзади: слева) — горит фиолетом.
  glow(p, cx - 9, cy - 3, 6, VIOLET_GLOW, 0.7);
  shadeEll(p, cx - 9, cy - 3, 2.6, 3.2, VIOLET, 0.4);
  p.set(cx - 10, cy - 5, WHITE);
  // Щит-плита спереди (справа).
  poly(p, [[cx + 4, cy - 14], [cx + 14, cy - 10], [cx + 13, cy + 7], [cx + 4, cy + 10]], (x, y) => tone(GRAV_PLATE, (cx + 10 - x) * 0.04 + (cy - y) * 0.035 + 0.35));
  stroke(p, cx + 4, cy - 14, cx + 14, cy - 10, GRAV_PLATE[3]);
  for (const [rx, ry] of [[cx + 7, cy - 9], [cx + 11, cy - 7], [cx + 7, cy + 5], [cx + 11, cy + 4]]) p.set(rx, ry, BRASS[3]);
  // Руна тяжести на щите.
  for (let a = 0; a < TAU; a += 0.5) p.set(cx + 9 + Math.cos(a) * 2.6, cy - 2 + Math.sin(a) * 3.4, alpha(VIOLET_GLOW, 0.9));
  p.set(cx + 9, cy - 2, WHITE);
  // Голова: низкий шлем, щель-глаз.
  shadeEll(p, cx + 2, cy - 15, 5, 4, GRAV_T, 0.05);
  p.rect(cx + 3, cy - 16, cx + 6, cy - 15, hx('#d0b0ff'));
  // Передняя рука.
  const hf = o.arms > 0 ? ay - 16 * o.arms + o.slam * 24 : cy + 7;
  const fx = cx + 12 + o.arms * -2 + o.slam * 3;
  limb(p, cx + 9, ay, fx, hf, 3.2, 3.6, GRAV_T, 0.05);
  shadeEll(p, fx, hf, 4.6, 4.2, GRAV_T, 0.1);
  if (o.arms > 0.3) glow(p, fx, hf, 6, VIOLET_GLOW, 0.4 * o.arms);
  // Передняя половина кольца.
  for (let a = 0; a < PI; a += 0.03) p.set(cx + Math.cos(a) * ringR, cy - 4 + Math.sin(a) * ringR * 0.35, alpha(hx('#e0d0ff'), 0.7));
  let out = p;
  if (o.dk) out = shatter(p, o.dk / 3, 1931, [GRAV_T[2], VIOLET[2], VIOLET_GLOW, GRAV_PLATE[2]], cx, cy);
  return { p: out, ax: cx, ay: gy, eye: o.dk ? null : [cx + 5, cy - 16], lit: true };
}

registerMobPainter('f15_graviton', (_m: Mob, pose: MobPose) => {
  const dk = deathK(pose);
  if (dk) return frameOf('grav', pose, 'die', dk, () => gravBody({ step: 0, arms: 0, slam: 0, f: 0, dk }));
  const f = Math.floor(pose.now * 6) % 8;
  if (pose.mode === 'windup') {
    // Замах 1,15 с: кулаки поднимаются, последние 0,15 с — удар вниз.
    const T = GRAVITON.punchAt;
    const k = Math.min(1, pose.t / (T - 0.15));
    const slam = pose.t > T - 0.15 ? Math.min(1, (pose.t - (T - 0.15)) / 0.12) : 0;
    const kb = Math.min(5, Math.floor(k * 6));
    const sb = Math.min(2, Math.floor(slam * 3));
    return frameOf('grav', pose, 'wind', kb * 3 + sb, () => gravBody({ step: 0, arms: slam ? 1 - slam * 0.2 : kb / 5, slam, f: 0, dk: 0 }), {
      still: true,
      sy: slam ? 0.94 : 1 + kb * 0.01,
    });
  }
  if (pose.mode === 'recover') return frameOf('grav', pose, 'rec', 0, () => gravBody({ step: 0, arms: 0.8, slam: 1, f: 0, dk: 0 }), { still: true });
  const run = pose.anim === 'run';
  const st = run ? pose.frame % 4 : 0;
  return frameOf('grav', pose, run ? 'run' : 'idle', st * 8 + f, () => gravBody({ step: st, arms: 0, slam: 0, f, dk: 0 }), run ? { dy: st % 2 ? 0.6 : 0 } : null);
});

// --- Звездочёт ----------------------------------------------------------------

const ROBE = tn('#0c0c2a', '#18184a', '#262a70', '#3a44a0');
const SKIN = tn('#6a4a5a', '#9a7080', '#c8a0a8', '#f0d0d0');

/**
 * Звездочёт: мантия в звёздах, капюшон, посох с астролябией. Вокруг —
 * камни-спутники (сколько осталось). `cast` 0…1 — посох вверх (колодец)
 * или вперёд (залп), `kind` 1 — колодец, 2 — залп.
 */
function astroBody(o: { step: number; stones: number; f: number; cast: number; kind: number; dk: number }): Built {
  const p = new Px(40, 44);
  const cx = 18;
  const gy = 39;
  const orbit = (front: boolean) => {
    for (let i = 0; i < o.stones; i++) {
      const a = (o.f / 16) * TAU + (i * TAU) / 3;
      const z = Math.sin(a);
      if (z >= 0 !== front) continue;
      const x = cx + Math.cos(a) * 12;
      const y = 22 + z * 4 - (o.cast && o.kind === 1 ? o.cast * 6 : 0);
      glow(p, x, y, 3.5, GOLDK, o.cast ? 0.6 : 0.35);
      shadeEll(p, x, y, 1.8, 1.6, i === 1 ? VIOLET : METEOR, 0.2);
      p.set(x - 0.5, y - 1, hx('#ffe8a0'));
    }
  };
  orbit(false);
  // Полы мантии: колокол, шаг качает край.
  const sw = o.step % 2 ? 1 : 0;
  poly(p, [[cx - 4, 16], [cx + 4, 16], [cx + 8 + sw, gy], [cx - 8 - sw, gy]], (x, y) => {
    const fold = Math.sin((x - cx) * 1.1 + y * 0.1);
    return tone(ROBE, (cx - x) * 0.05 + 0.35 + fold * 0.15);
  });
  // Звёзды на мантии (мерцают по кадру).
  for (let i = 0; i < 7; i++) {
    const x = cx - 6 + Math.round(hash(i, 1, 1940) * 12);
    const y = 20 + Math.round(hash(i, 2, 1940) * 17);
    if (Math.abs(x - cx) > 3 + (y - 16) * 0.2) continue;
    p.set(x, y, (i + o.f) % 5 === 0 ? WHITE : hx('#c8c0ff'));
  }
  // Пояс — латунь.
  p.rect(cx - 4, 24, cx + 4, 24, BRASS[2]);
  // Капюшон и лицо.
  shadeEll(p, cx, 12, 5, 5.5, ROBE, 0.1);
  p.ell(cx + 2, 13, 2.6, 3, SKIN[1]);
  p.ell(cx + 2.5, 12.5, 1.8, 2, SKIN[2]);
  p.set(cx + 3, 12, INK);
  // Борода-звёздная пыль.
  for (let y = 15; y < 19; y++) p.set(cx + 2 + (y % 2), y, alpha(hx('#d8d4f0'), 0.9));
  // Острый кончик капюшона.
  poly(p, [[cx - 5, 10], [cx - 1, 6], [cx - 9, 4]], ROBE[2]);
  // Рука и посох.
  let sx0 = cx + 7;
  let sy0 = 38;
  let sx1 = cx + 9;
  let sy1 = 8;
  if (o.kind === 1) {
    sx1 = cx + 6 - o.cast * 2;
    sy1 = 8 - o.cast * 6;
    sx0 = cx + 6;
    sy0 = 36 - o.cast * 6;
  } else if (o.kind === 2) {
    sx0 = cx + 2;
    sy0 = 26;
    sx1 = cx + 9 + o.cast * 10;
    sy1 = 20 - o.cast * 4;
  }
  stroke(p, sx0, sy0, sx1, sy1, hx('#5a3a20'));
  stroke(p, sx0 + 0.6, sy0, sx1 + 0.6, sy1, hx('#8a6034'));
  // Рука держит посох.
  const hxp = sx0 + (sx1 - sx0) * 0.55;
  const hyp = sy0 + (sy1 - sy0) * 0.55;
  limb(p, cx + 2, 20, hxp, hyp, 1.8, 1.4, ROBE, 0.1);
  p.ell(hxp, hyp, 1.4, 1.4, SKIN[2]);
  // Астролябия на конце.
  const lit = 0.35 + o.cast * 0.6;
  glow(p, sx1, sy1, 5 + o.cast * 4, o.kind === 2 ? GOLDK : TEAL_GLOW, lit);
  for (let a = 0; a < TAU; a += 0.35) p.set(sx1 + Math.cos(a) * 2.6, sy1 + Math.sin(a) * 2.6, BRASS[3]);
  stroke(p, sx1 - 2.6, sy1, sx1 + 2.6, sy1, BRASS[2]);
  sparkle(p, sx1, sy1, WHITE, o.cast > 0.5 ? 2 : 1);
  orbit(true);
  let out = p;
  if (o.dk) out = shatter(p, o.dk / 3, 1941, [ROBE[2], hx('#c8c0ff'), GOLDK, WHITE], cx, 24);
  return { p: out, ax: cx, ay: gy, eye: o.dk ? null : [cx + 3, 12], lit: true };
}

registerMobPainter('f15_astro', (m: Mob, pose: MobPose) => {
  const dk = deathK(pose);
  const stones = Math.max(0, Math.min(3, m.data.stones ?? 3));
  if (dk) return frameOf('astro', pose, 'die', dk, () => astroBody({ step: 0, stones: 0, f: 0, cast: 0, kind: 0, dk }));
  const f = Math.floor(pose.now * 8) % 16;
  if (pose.mode === 'f15_cast_well' || pose.mode === 'f15_cast_bolt') {
    const well = pose.mode === 'f15_cast_well';
    const T = well ? 0.9 : 0.75;
    const k = Math.min(3, Math.floor((pose.t / T) * 4));
    return frameOf('astro', pose, well ? 'cw' : 'cb', (k * 4 + stones) * 16 + f, () => astroBody({ step: 0, stones, f, cast: (k + 1) / 4, kind: well ? 1 : 2, dk: 0 }), { still: true });
  }
  const run = pose.anim === 'run';
  const st = run ? pose.frame % 4 : 0;
  return frameOf('astro', pose, run ? 'run' : 'idle', (st * 4 + stones) * 16 + f, () => astroBody({ step: st, stones, f, cast: 0, kind: 0, dk: 0 }), run ? { dy: st % 2 ? -0.5 : 0 } : null);
});

// --- Созвездие ----------------------------------------------------------------

/**
 * Созвездие: яркая звезда-узел и три звёздочки на нитях — фигура меняется по
 * кадру. `rise` 0…1 — проявляется из карты, `pulse` 0…1 — набирает вспышку.
 */
function constelBody(o: { f: number; rise: number; pulse: number; dk: number }): Built {
  const p = new Px(36, 34);
  const cx = 18;
  const cy = 16;
  const k = o.rise;
  const sat: [number, number][] = [];
  for (let i = 0; i < 3; i++) {
    const a = (o.f / 12) * TAU * 0.3 + (i * TAU) / 3 + i;
    const r = (8 + Math.sin((o.f / 12) * TAU + i) * 1.5) * (0.4 + k * 0.6);
    sat.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.75]);
  }
  for (const [x, y] of sat) stroke(p, cx, cy, x, y, alpha(hx('#a8c8ff'), 0.45 * k));
  stroke(p, sat[0][0], sat[0][1], sat[1][0], sat[1][1], alpha(hx('#a8c8ff'), 0.25 * k));
  for (const [x, y] of sat) {
    glow(p, x, y, 2.6, hx('#c8d8ff'), 0.6 * k);
    sparkle(p, x, y, alpha(WHITE, k), 1);
  }
  const R = 6 + o.pulse * 4;
  glow(p, cx, cy, R + 3, hx('#9ab8ff'), (0.45 + o.pulse * 0.4) * k);
  glow(p, cx, cy, 3.5 + o.pulse * 2, WHITE, k);
  // Лучи звезды: длинные по осям, короче по диагоналям.
  const L = (5 + o.pulse * 4) * k;
  for (let i = 1; i <= L; i++) {
    const c = alpha(WHITE, (1 - i / (L + 1)) * k);
    p.set(cx + i, cy, c);
    p.set(cx - i, cy, c);
    p.set(cx, cy + i, c);
    p.set(cx, cy - i, c);
    if (i < L * 0.5) {
      p.set(cx + i, cy + i, c);
      p.set(cx - i, cy - i, c);
      p.set(cx + i, cy - i, c);
      p.set(cx - i, cy + i, c);
    }
  }
  if (o.pulse > 0.6) for (let a = 0; a < TAU; a += 0.2) p.set(cx + Math.cos(a) * R * 1.3, cy + Math.sin(a) * R, alpha(WHITE, 0.6));
  let out = p;
  if (o.dk) out = shatter(p, o.dk / 3, 1950, [WHITE, hx('#a8c8ff')], cx, cy);
  return { p: out, ax: cx, ay: 26, eye: null, lit: true };
}

registerMobPainter('f15_constel', (_m: Mob, pose: MobPose) => {
  const dk = deathK(pose);
  if (dk) return frameOf('constel', pose, 'die', dk, () => constelBody({ f: 0, rise: 1, pulse: 0, dk }));
  const f = Math.floor(pose.now * 6) % 12;
  if (pose.mode === 'f15_rise') {
    const k = Math.min(4, Math.floor((pose.t / 1.2) * 5));
    return frameOf('constel', pose, 'rise', k * 12 + f, () => constelBody({ f, rise: 0.2 + k * 0.2, pulse: 0, dk: 0 }), { lift: 1 + k * 1.5, still: true });
  }
  if (pose.mode === 'windup') {
    const k = Math.min(3, Math.floor((pose.t / 0.6) * 4));
    return frameOf('constel', pose, 'wind', k * 12 + f, () => constelBody({ f, rise: 1, pulse: (k + 1) / 4, dk: 0 }), { still: true });
  }
  return frameOf('constel', pose, 'fly', f, () => constelBody({ f, rise: 1, pulse: 0, dk: 0 }));
});

// --- Пожиратель света -----------------------------------------------------------

const VOID_T = tn('#04030a', '#0c0818', '#181030', '#2a1c50');

/**
 * Пожиратель света: чернильный скат пустоты, край светится фиолетом, глаза —
 * две холодные звезды. `suck` 0…1 — тянет свет лампы (рот раскрыт, искры
 * летят внутрь), `wind` 0…1 — надувается холодом перед ударом.
 */
function devBody(o: { f: number; suck: number; wind: number; dk: number }): Built {
  const p = new Px(52, 40);
  const cx = 26;
  const cy = 18;
  const flap = Math.sin((o.f / 8) * TAU);
  const span = 17 + o.wind * 2;
  // Крылья: края волной.
  const wing = (side: number) => {
    const pts: [number, number][] = [[cx, cy - 5]];
    for (let i = 1; i <= 6; i++) {
      const k = i / 6;
      pts.push([cx + side * span * k, cy - 3 - flap * 5 * k + Math.sin(k * PI) * -2]);
    }
    for (let i = 6; i >= 0; i--) {
      const k = i / 6;
      pts.push([cx + side * span * k * 0.92, cy + 4 - flap * 4 * k + Math.sin(k * 3 + o.f) * 1.2]);
    }
    poly(p, pts, (x, y) => tone(VOID_T, (cy - y) * 0.05 + 0.25 - Math.abs(x - cx) * 0.012));
    // Светящаяся кайма.
    for (let i = 1; i < pts.length - 1; i++) if (i <= 6) p.set(pts[i][0], pts[i][1], alpha(VIOLET_GLOW, 0.85));
  };
  wing(-1);
  wing(1);
  // Хвост-нить.
  for (let i = 0; i < 12; i++) {
    const x = cx - 2 - i * 0.6 + Math.sin(o.f * 0.8 + i * 0.6) * 1.5;
    p.set(x, cy + 6 + i, alpha(VIOLET[2], 0.9 - i * 0.06));
  }
  // Тело.
  shadeEll(p, cx, cy, 7 + o.wind * 1.5, 6 + o.wind, VOID_T, 0.05);
  if (o.wind > 0) glow(p, cx, cy, 6 + o.wind * 3, hx('#9ad0ff'), 0.45 * o.wind);
  // Глаза — две холодные звезды.
  sparkle(p, cx + 1, cy - 2, hx('#c8f0ff'), 1);
  sparkle(p, cx + 5, cy - 2, hx('#c8f0ff'), 1);
  // Рот: при поглощении — воронка света.
  if (o.suck > 0) {
    p.ell(cx + 3, cy + 3, 2 + o.suck * 1.5, 1.4 + o.suck, INK);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + o.f * 0.5;
      const d = 4 + ((o.f * 2 + i * 3) % 9);
      p.set(cx + 3 + Math.cos(a) * d, cy + 3 + Math.sin(a) * d * 0.7, alpha(hx('#bff8ff'), 1 - d / 13));
    }
  } else p.rect(cx + 2, cy + 3, cx + 4, cy + 3, alpha(VIOLET[1], 0.8));
  let out = p;
  if (o.dk) out = shatter(p, o.dk / 3, 1960, [VOID_T[2], VIOLET[2], VIOLET_GLOW], cx, cy);
  return { p: out, ax: cx, ay: 30, eye: o.dk ? null : [cx + 3, cy - 2], lit: true };
}

registerMobPainter('f15_devourer', (_m: Mob, pose: MobPose) => {
  const dk = deathK(pose);
  if (dk) return frameOf('dev', pose, 'die', dk, () => devBody({ f: 0, suck: 0, wind: 0, dk }));
  const f = Math.floor(pose.now * 8) % 8;
  if (pose.mode === 'f15_snuff') {
    const k = Math.min(2, Math.floor(pose.t * 3));
    return frameOf('dev', pose, 'snuff', k * 8 + f, () => devBody({ f, suck: (k + 1) / 3, wind: 0, dk: 0 }), { still: true });
  }
  if (pose.mode === 'windup') {
    const k = Math.min(3, Math.floor((pose.t / 0.7) * 4));
    return frameOf('dev', pose, 'wind', k * 8 + f, () => devBody({ f, suck: 0, wind: (k + 1) / 4, dk: 0 }), { still: true });
  }
  return frameOf('dev', pose, 'fly', f, () => devBody({ f, suck: 0, wind: 0, dk: 0 }), { lift: 8 });
});

// --- Эхо: тени прошлых этажей ------------------------------------------------------

/** Чей рисовальщик даёт тень каждому мотиву (в порядке `MOTIFS`). */
const ECHO_SRC = ['f1_rat', 'f2_shroom', 'f6_salamander', 'f7_phantom', 'f11_harpy', 'f14_soldier'];
const SPECTRAL: RGBA[] = [hx('#140a38'), hx('#3a2a90'), hx('#6a7ae0'), hx('#9ae8ff'), hx('#ffffff')];
const ECHO_TINT = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();

/** Перекрасить кадр в призрачную палитру: яркость → индиго…бирюза…белое. */
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
  for (let i = 0; i < d.data.length; i += 4) {
    if (!d.data[i + 3]) continue;
    const l = (d.data[i] * 0.3 + d.data[i + 1] * 0.55 + d.data[i + 2] * 0.15) / 255;
    const col = ramp(SPECTRAL, Math.min(1, l * 1.25 + 0.08));
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
function echoFallback(o: { f: number; motif: number; dk: number }): Built {
  const p = new Px(28, 30);
  const cx = 14;
  glow(p, cx, 16, 11, hx('#9ae8ff'), 0.35);
  shadeEll(p, cx, 16, 7, 8, tn('#1a1048', '#3a3aa0', '#6a8ae0', '#c8f4ff'), 0.1);
  for (let i = 0; i < 4; i++) p.set(cx - 5 + i * 3, 24 + ((o.f + i) % 2), alpha(hx('#9ae8ff'), 0.7));
  motifGlyph(p, cx, 15, o.motif, WHITE);
  let out = p;
  if (o.dk) out = shatter(p, o.dk / 3, 1970, SPECTRAL, cx, 16);
  return { p: out, ax: cx, ay: 26, eye: null, lit: true };
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
  const motif = ((m.data.motif ?? 0) % 6 + 6) % 6;
  const src = MOB_PAINTERS.get(ECHO_SRC[motif]);
  const born = pose.mode === 'f15_born' ? Math.min(1, pose.t / 0.7) : 1;
  const blink = pose.mode === 'f15_blink' && (m.data.ghost ?? 0) > 0;
  const extra: Partial<MobFrame> = {
    alpha: blink ? 0.25 : 0.35 + born * 0.55,
    ghost: { every: 0.08, life: 0.3, tint: '140,200,255', alpha: 0.3 },
    lit: null,
    linger: undefined,
  };
  if (src) {
    try {
      const mode = ECHO_MODE[pose.mode] ?? pose.mode;
      const anim = mode === 'windup' ? 'wind' : pose.anim;
      const fr = src(m, { ...pose, mode, anim, look: pose.look === 'elite' ? 'elite' : 'normal' });
      if (fr && fr.img) {
        return {
          ...fr,
          img: spectral(fr.img),
          eye: fr.eye ?? null,
          ...extra,
          sy: (fr.sy ?? 1) * (0.4 + born * 0.6),
          lit: null,
          ghost: extra.ghost,
          linger: undefined,
        };
      }
    } catch {
      // Чужой рисовальщик упал на нашем мобе — рисуем своё.
    }
  }
  const dk = deathK(pose);
  const f = Math.floor(pose.now * 6) % 4;
  return frameOf('echo', pose, dk ? 'die' : 'fly', motif * 8 + (dk || f), () => echoFallback({ f, motif, dk }), { ...extra, sy: 0.4 + born * 0.6 });
});

// --- Луна -------------------------------------------------------------------------

const MOON_T = tn('#3a3850', '#6a6880', '#a8a4b8', '#eceaf4');

/**
 * Луна: шарик в кратерах, тень фазы ползёт по кругу; в кратерах — мордочка.
 * `phase` 0…15, `aim` — щурится и светлеет, `dive` — сжата в комок.
 */
function moonBody(o: { phase: number; aim: number; dive: number; dk: number }): Built {
  const p = new Px(28, 30);
  const cx = 14;
  const cy = 13;
  const R = 6.5;
  glow(p, cx, cy, R + 5, hx('#d8d4ff'), 0.3 + o.aim * 0.35);
  const ph = (o.phase / 16) * TAU;
  // Терминатор: тень с той стороны, куда «смотрит» фаза.
  const sx = Math.cos(ph);
  for (let y = -R; y <= R; y++)
    for (let x = -R; x <= R; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const d = Math.hypot(px, py) / R;
      if (d > 1) continue;
      const nz = Math.sqrt(1 - d * d);
      const nx = px / R;
      const ny = py / R;
      let l = nx * LX + ny * LY + nz * LZ + 0.15;
      // Кратеры.
      const cr = voronoi(px + 20, py + 20, 3.5, 1980);
      if (cr.id < 0.4 && cr.d1 < 0.35) l += cr.d1 > 0.26 ? 0.15 : -0.25;
      // Тень фазы.
      const shade = nx * sx * 1.2 + nz * 0.15 * Math.sin(ph);
      if (shade < -0.25) l -= 0.55;
      p.set(cx + x, cy + y, tone(MOON_T, l + o.aim * 0.2));
    }
  // Мордочка.
  if (!o.dk) {
    if (o.aim > 0) {
      p.rect(cx - 2, cy - 1, cx - 1, cy - 1, INK);
      p.rect(cx + 2, cy - 1, cx + 3, cy - 1, INK);
    } else {
      p.set(cx - 2, cy - 1, INK);
      p.set(cx + 2, cy - 1, INK);
    }
    p.set(cx, cy + 2, alpha(INK, 0.6));
    p.set(cx - 3, cy + 1, alpha(hx('#c08aa0'), 0.6));
    p.set(cx + 3, cy + 1, alpha(hx('#c08aa0'), 0.6));
  }
  let out = p;
  if (o.dk) out = shatter(p, o.dk / 3, 1981, [MOON_T[2], MOON_T[3], WHITE], cx, cy);
  return { p: out, ax: cx, ay: 25, eye: o.dk ? null : [cx + 2, cy - 1], lit: false };
}

registerMobPainter('f15_moon', (m: Mob, pose: MobPose) => {
  const dk = deathK(pose);
  if (dk) return frameOf('moon', pose, 'die', dk, () => moonBody({ phase: 0, aim: 0, dive: 0, dk }));
  const phase = Math.floor(pose.now * 2 + m.id) % 16;
  if (pose.mode === 'aim') {
    const f = Math.floor(pose.now * 16) % 2;
    return frameOf('moon', pose, 'aim', phase * 2 + f, () => moonBody({ phase, aim: 1, dive: 0, dk: 0 }), { still: true, dx: f ? 0.6 : -0.6 });
  }
  if (pose.mode === 'f15_dive')
    return frameOf('moon', pose, 'dive', phase, () => moonBody({ phase, aim: 1, dive: 1, dk: 0 }), {
      still: true,
      lift: 3,
      ghost: { every: 0.03, life: 0.2, tint: '220,215,255', alpha: 0.55 },
    });
  return frameOf('moon', pose, 'fly', phase, () => moonBody({ phase, aim: 0, dive: 0, dk: 0 }), { lift: 9 });
});

// --- Сверхновая ---------------------------------------------------------------------

const NOVA_T = tn('#b0501a', '#f08a28', '#ffd060', '#fff8d8');

/**
 * Сверхновая: шар плазмы с короной языков и ликом в огне. `g` 0…1 — набор:
 * сжимается и белеет, корона втягивается, по краю бегут лучи.
 */
function novaBody(o: { f: number; g: number; step: number; dk: number }): Built {
  const p = new Px(64, 64);
  const cx = 32;
  const cy = 32;
  const R = 11 - o.g * 2.5;
  glow(p, cx, cy, R + 14 + o.g * 6, hx('#ffb040'), 0.35 + o.g * 0.35);
  // Корона: языки по кругу, длина пульсирует.
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * TAU + o.f * 0.12;
    const L = (5 + 3 * Math.sin(o.f * 0.9 + i * 1.7)) * (1 - o.g * 0.7);
    for (let k = 0; k < L; k++) {
      const r = R + k;
      const w = (1 - k / L) * 2.2;
      const bend = Math.sin(o.f * 0.6 + i) * k * 0.08;
      const x = cx + Math.cos(a + bend) * r;
      const y = cy + Math.sin(a + bend) * r;
      p.ell(x, y, w, w, k / L < 0.4 ? NOVA_T[2] : alpha(NOVA_T[1], 0.8));
    }
  }
  // Ядро — шар с гранулами плазмы.
  p.ell(cx, cy, R, R, (x, y) => {
    const dx = (x + 0.5 - cx) / R;
    const dy = (y + 0.5 - cy) / R;
    const d = Math.hypot(dx, dy);
    const gran = vnoise(x * 3 + o.f * 2, y * 3, 3, 1990);
    const l = 1 - d * 0.6 + (gran - 0.5) * 0.35 + o.g * 0.4;
    return tone(NOVA_T, l);
  });
  // Лик: прищуренные глаза-щели и рот, при наборе — раскрыт.
  if (!o.dk) {
    const ey = cy - 2;
    p.rect(cx - 5, ey, cx - 2, ey, NOVA_T[0]);
    p.rect(cx + 3, ey, cx + 6, ey, NOVA_T[0]);
    p.set(cx - 2, ey - 1, NOVA_T[0]);
    p.set(cx + 3, ey - 1, NOVA_T[0]);
    if (o.g > 0.3) p.ell(cx + 0.5, cy + 4, 2 + o.g * 1.5, 1 + o.g * 1.5, WHITE);
    else p.rect(cx - 1, cy + 4, cx + 2, cy + 4, NOVA_T[0]);
  }
  if (o.g > 0.4)
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + o.f * 0.3;
      for (let k = 0; k < 10 * o.g; k++) p.set(cx + Math.cos(a) * (R + 4 + k), cy + Math.sin(a) * (R + 4 + k), alpha(WHITE, 0.8 - k * 0.07));
    }
  let out = p;
  if (o.dk) out = shatter(p, o.dk / 3, 1991, [NOVA_T[2], NOVA_T[3], WHITE, NOVA_T[1]], cx, cy);
  return { p: out, ax: cx, ay: 48 - o.step, eye: null, lit: true };
}

registerMobPainter('f15_nova', (_m: Mob, pose: MobPose) => {
  const dk = deathK(pose);
  if (dk) return frameOf('nova', pose, 'die', dk, () => novaBody({ f: 0, g: 1, step: 0, dk }), { shadow: 0 });
  const f = Math.floor(pose.now * 8) % 16;
  if (pose.mode === 'f15_gather') {
    const k = Math.min(4, Math.floor((pose.t / NOVA.gather) * 5));
    return frameOf('nova', pose, 'gather', k * 16 + f, () => novaBody({ f, g: (k + 1) / 5, step: 0, dk: 0 }), {
      still: true,
      sx: 1 - k * 0.03,
      sy: 1 - k * 0.03,
    });
  }
  const step = pose.anim === 'run' ? (pose.frame % 2) * 1 : 0;
  return frameOf('nova', pose, 'idle', f * 2 + step, () => novaBody({ f, g: 0, step, dk: 0 }), { shadow: 9 });
});

// --- Золотой скарабей (редкий бегун) ----------------------------------------------------

/** Скарабей: золотой панцирь со звёздным узором; удирая, раскрывает крылья. */
function bugBody(o: { f: number; dk: number }): Built {
  const p = new Px(30, 26);
  const cx = 14;
  const cy = 15;
  // Лапки.
  for (let i = 0; i < 3; i++) {
    const lx = cx - 3 + i * 3;
    const up = (o.f + i) % 2;
    stroke(p, lx, cy + 2, lx - 1 + up * 2, cy + 6, GOLD[0]);
  }
  // Крылья: прозрачные, машут.
  const flap = o.f % 2;
  for (const side of [-1, 1]) {
    const tipY = cy - 7 - flap * 3;
    poly(p, [[cx - 1, cy - 3], [cx - 8 * side * 0.4 - 6, tipY], [cx - 2, cy + 1]], alpha(hx('#e8f8ff'), 0.45));
  }
  // Панцирь.
  shadeEll(p, cx, cy, 6.5, 4.8, GOLD, 0.15);
  stroke(p, cx - 6, cy, cx + 5, cy, GOLD[0]);
  // Звёздный узор.
  sparkle(p, cx - 2, cy - 2, WHITE, 1);
  p.set(cx + 2, cy - 1, GOLD[3]);
  p.set(cx - 4, cy + 2, GOLD[3]);
  // Голова и рожки.
  shadeEll(p, cx + 7, cy, 2.4, 2.2, tn('#3a2a10', '#6a4c14', '#a07a20', '#e0b848'), 0.1);
  stroke(p, cx + 8, cy - 2, cx + 11, cy - 5, GOLD[2]);
  p.set(cx + 8, cy - 1, INK);
  glow(p, cx, cy, 9, GOLDK, 0.3);
  let out = p;
  if (o.dk) out = shatter(p, o.dk / 3, 1995, [GOLD[2], GOLD[3], WHITE], cx, cy);
  return { p: out, ax: cx, ay: 21, eye: o.dk ? null : [cx + 8, cy - 1], lit: true };
}

registerMobPainter('f15_goldbug', (_m: Mob, pose: MobPose) => {
  const dk = deathK(pose);
  if (dk) return frameOf('bug', pose, 'die', dk, () => bugBody({ f: 0, dk }));
  const f = Math.floor(pose.now * 18) % 4;
  return frameOf('bug', pose, 'run', f, () => bugBody({ f, dk: 0 }), { dy: f % 2 ? -0.5 : 0 });
});

// --- Прогрев кадров ------------------------------------------------------------------

/** Кадры по позам: рендер дорисует их по 3 мс за кадр, пока такой моб в мире. */
function warm(kind: string, poses: [string, number, () => Built][]): () => Iterator<unknown> {
  return function* () {
    for (const [anim, f, build] of poses) {
      for (const left of [false, true]) {
        const key = `${kind}|${anim}|${f}|${left ? 1 : 0}|0|normal`;
        if (!FR.get(key)) FR.set(key, finish(build(), 'normal', false, left));
        yield 0;
      }
    }
  };
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

registerMobWarm(
  'f15_urchin',
  warm('urchin', [
    ...range(4).map((f): [string, number, () => Built] => ['run', f, () => urchinBody({ step: f, ball: 0, bristle: 0.45, roll: 0, glowK: 0, dizzy: 0, dk: 0 })]),
    ...range(8).map((f): [string, number, () => Built] => ['roll', f, () => urchinBody({ step: 0, ball: 1, bristle: 0.7, roll: (f / 8) * TAU * 0.5, glowK: 0.6, dizzy: 0, dk: 0 })]),
    ...range(5).map((k): [string, number, () => Built] => ['curl', k, () => urchinBody({ step: 0, ball: k / 4, bristle: 0.5, roll: 0, glowK: k / 4, dizzy: 0, dk: 0 })]),
  ]),
);
registerMobWarm(
  'f15_graviton',
  warm('grav', range(8).map((f): [string, number, () => Built] => ['idle', f, () => gravBody({ step: 0, arms: 0, slam: 0, f, dk: 0 })])),
);
registerMobWarm(
  'f15_nova',
  warm('nova', range(16).map((f): [string, number, () => Built] => ['idle', f * 2, () => novaBody({ f, g: 0, step: 0, dk: 0 })])),
);
registerMobWarm(
  'f15_astro',
  warm('astro', range(16).map((f): [string, number, () => Built] => ['idle', 3 * 16 + f, () => astroBody({ step: 0, stones: 3, f, cast: 0, kind: 0, dk: 0 })])),
);

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

/**
 * Колодец: тихо — пунктир границы и редкая пыль; предупреждает — граница
 * мигает, шевроны бегут к ядру; тянет — спираль частиц течёт внутрь
 * (толкает — наружу), ядро ожога горит белым с красной каймой.
 */
registerZonePainter('f15_well', (g, z, px, py, _s, time) => {
  const w = zoneOf<Well>(z);
  if (!w) return true;
  const { c, hot } = wellColors(w);
  const R = w.r * TS;
  const s = w.state;
  const dir = w.mode < 0 ? -1 : 1;
  g.save();
  // Граница.
  const pulse = s === 1 ? 0.5 + 0.5 * Math.sin(time * 14) : 0;
  g.strokeStyle = `rgba(${c},${s === 0 ? 0.16 : s === 1 ? 0.35 + pulse * 0.45 : 0.55})`;
  g.lineWidth = 1;
  g.setLineDash(s === 0 ? [2, 6] : [5, 3]);
  g.lineDashOffset = -time * 8 * dir;
  g.beginPath();
  g.ellipse(px, py, R, R, 0, 0, TAU);
  g.stroke();
  g.setLineDash([]);
  if (s === 2) {
    // Засветка поля.
    const gr = g.createRadialGradient(px, py, 0, px, py, R);
    gr.addColorStop(0, `rgba(${c},0.22)`);
    gr.addColorStop(0.6, `rgba(${c},0.07)`);
    gr.addColorStop(1, `rgba(${c},0)`);
    g.fillStyle = gr;
    g.beginPath();
    g.arc(px, py, R, 0, TAU);
    g.fill();
  }
  // Частицы: тянет — внутрь по спирали; предупреждает — шевроны; тихо — пыль.
  const n = Math.round((s === 2 ? 46 : s === 1 ? 10 : 8) * Math.max(0.7, w.r / 5));
  for (let i = 0; i < n; i++) {
    const h0 = hash(i, w.id, 2001);
    const speed = s === 2 ? 0.55 * w.k : 0.12;
    let u = (time * speed + h0) % 1;
    if (dir < 0) u = 1 - u;
    const rr = R * (1 - u) + w.burn * TS * u;
    const a = h0 * TAU + (1 - u) * 2.6 * dir;
    const x = px + Math.cos(a) * rr;
    const y = py + Math.sin(a) * rr;
    if (s === 1) {
      // Шеврон к ядру (от ядра — если толкает).
      const ux = -Math.cos(a) * dir;
      const uy = -Math.sin(a) * dir;
      g.strokeStyle = `rgba(${c},${0.5 + pulse * 0.4})`;
      g.beginPath();
      g.moveTo(x - ux * 2 - uy * 2, y - uy * 2 + ux * 2);
      g.lineTo(x, y);
      g.lineTo(x - ux * 2 + uy * 2, y - uy * 2 - ux * 2);
      g.stroke();
    } else {
      g.fillStyle = `rgba(${s === 2 && u > 0.7 ? hot : c},${(s === 2 ? 0.35 + u * 0.6 : 0.25) * (1 - Math.abs(u - 0.5) * 0.6)})`;
      const sz = s === 2 && h0 > 0.7 ? 2 : 1;
      g.fillRect(Math.round(x), Math.round(y), sz, sz);
      if (s === 2 && h0 < 0.3) {
        // Хвостик частицы — по ходу спирали.
        const a2 = a - 0.18 * dir;
        const r2 = rr + 3 * dir;
        g.fillRect(Math.round(px + Math.cos(a2) * r2), Math.round(py + Math.sin(a2) * r2), 1, 1);
      }
    }
  }
  // Ядро ожога: белое пламя, красная кайма (здесь жжёт).
  if (w.burn > 0 && s === 2) {
    const B = w.burn * TS;
    const gr = g.createRadialGradient(px, py, 0, px, py, B);
    gr.addColorStop(0, `rgba(${hot},0.75)`);
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
  sil: HTMLCanvasElement;
  glowC: HTMLCanvasElement;
  C: number;
}

const ISLANDS = new Map<string, IslandArt>();

/** Остров кольца: сектор-кольцо вокруг угла 0, холст с центром кольца в середине. */
function islandArt(r: Ring): IslandArt {
  const key = `${r.name}|${r.r0}|${r.r1}|${r.half}`;
  const hit = ISLANDS.get(key);
  if (hit) return hit;
  const R1 = r.r1 * TS;
  const R0 = r.r0 * TS;
  const C = Math.ceil(R1) + 2;
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
      // Края острова неровные — шум по углу и радиусу.
      const wob = (vnoise(a * 60, d, 4, 2010) - 0.5) * 3;
      const inR = d >= R0 + 0.5 + wob * 0.6 && d < R1 - 0.5 + wob;
      const inA = Math.abs(a) * d <= half * d - 1 + wob;
      if (!inR || !inA) {
        // Ореол левитации — чуть шире острова.
        if (d >= R0 - 3 && d < R1 + 3 && Math.abs(a) * d <= half * d + 3) glowP.set(x, y, alpha(TEAL_GLOW, 0.22));
        continue;
      }
      glowP.set(x, y, alpha(TEAL_GLOW, 0.3));
      sil.set(x, y, hx('#ffffff'));
      // Край — светлая кромка, внутри — реголит с кратерами.
      const edge = Math.min(d - R0, R1 - d, (half - Math.abs(a)) * d);
      const n = fbm(x, y, 9, 2011);
      const v = voronoi(x, y, 7, 2012);
      let l = (n - 0.5) * 0.8 + 0.42;
      if (v.id < 0.3 && v.d1 < 0.32) l += v.d1 > 0.24 ? 0.18 : -0.3;
      let col = tone(tn('#241e34', '#363048', '#4c4562', '#6c6488'), l);
      if (edge < 1.5) col = hx('#8a84a8');
      else if (edge < 2.5) col = mixc(col, hx('#6a6488'), 0.5);
      if (hash(x, y, 2013) < 0.006) col = CRYST[3];
      top.set(x, y, col);
    }
  // Маячки: латунные кольца на оси острова, по два.
  for (const k of [0.3, 0.7]) {
    const rr = R0 + (R1 - R0) * k;
    const x = C + rr;
    const y = C;
    top.ell(x, y, 1.6, 1.6, BRASS[2]);
    top.set(x, y, BRASS[3]);
  }
  const out: IslandArt = { top: top.canvas(), sil: sil.canvas(), glowC: glowP.canvas(), C };
  // Тёмный силуэт для толщи острова.
  const g2 = out.sil.getContext('2d');
  if (g2) {
    g2.globalCompositeOperation = 'source-in';
    g2.fillStyle = '#17121f';
    g2.fillRect(0, 0, out.sil.width, out.sil.height);
  }
  ISLANDS.set(key, out);
  return out;
}

/** Кольцо орбиты: острова плавно едут по кругу; парад — золото по краю. */
registerZonePainter('f15_ring', (g, z, px, py, _s, time) => {
  const r = zoneOf<Ring>(z);
  if (!r) return true;
  const art = islandArt(r);
  const C = art.C;
  g.save();
  const prev = g.imageSmoothingEnabled;
  g.imageSmoothingEnabled = false;
  for (let k = 0; k < r.n; k++) {
    const ang = PI / 2 + (k * TAU) / r.n + r.vis;
    const bob = Math.sin(time * 1.3 + k * 2) * 0.6;
    // Ореол снизу, толща (камень уходит вниз), затем верх.
    const draw = (img: HTMLCanvasElement, dy: number, a = 1) => {
      g.save();
      g.globalAlpha = a;
      g.translate(px, py + dy + bob);
      g.rotate(ang);
      g.drawImage(img, -C, -C);
      g.restore();
    };
    draw(art.glowC, 7, 0.6 + 0.2 * Math.sin(time * 2 + k));
    for (let dy = 5; dy >= 1; dy--) draw(art.sil, dy, 1);
    draw(art.top, 0);
    if (r.parade) {
      g.save();
      g.translate(px, py + bob);
      g.rotate(ang);
      g.strokeStyle = `rgba(255,214,110,${0.5 + 0.3 * Math.sin(time * 6)})`;
      g.beginPath();
      g.arc(0, 0, r.r1 * TS - 1, -r.half, r.half);
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

/** Тяжесть после удара гравитона: вдавленный круг, кольца сжимаются, трещины. */
registerZonePainter('f15_heavy', (g, z, px, py, _s, time) => {
  const zz = z as Zone;
  const fade = Math.min(1, (zz.life - zz.t) / 0.6, zz.t / 0.15);
  const R = z.r * TS;
  g.save();
  const gr = g.createRadialGradient(px, py, 0, px, py, R);
  gr.addColorStop(0, `rgba(30,10,50,${0.45 * fade})`);
  gr.addColorStop(0.8, `rgba(60,20,90,${0.3 * fade})`);
  gr.addColorStop(1, 'rgba(60,20,90,0)');
  g.fillStyle = gr;
  g.beginPath();
  g.ellipse(px, py, R, R * 0.8, 0, 0, TAU);
  g.fill();
  for (let i = 0; i < 3; i++) {
    const u = 1 - ((time * 0.7 + i / 3) % 1);
    g.strokeStyle = `rgba(184,144,255,${0.45 * fade * (1 - u * 0.5)})`;
    g.beginPath();
    g.ellipse(px, py, R * u, R * u * 0.8, 0, 0, TAU);
    g.stroke();
  }
  // Трещины.
  g.strokeStyle = `rgba(10,4,20,${0.7 * fade})`;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + hash(i, z.id, 2040);
    g.beginPath();
    g.moveTo(px + Math.cos(a) * 3, py + Math.sin(a) * 2.4);
    g.lineTo(px + Math.cos(a + 0.2) * R * 0.5, py + Math.sin(a + 0.2) * R * 0.4);
    g.lineTo(px + Math.cos(a - 0.1) * R * 0.85, py + Math.sin(a - 0.1) * R * 0.68);
    g.stroke();
  }
  g.restore();
  return true;
});

/** Шторм: тяжесть на весь зал — фиолетовая дымка, сверху давят полосы. */
registerZonePainter('f15_heavyall', (g, z, px, py, _s, time) => {
  const zz = z as Zone;
  const fade = Math.min(1, (zz.life - zz.t) / 0.6, zz.t / 0.4);
  const R = z.r * TS;
  g.save();
  g.fillStyle = `rgba(50,16,80,${0.22 * fade})`;
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.fill();
  g.fillStyle = `rgba(200,160,255,${0.35 * fade})`;
  for (let i = 0; i < 60; i++) {
    const x = px + (hash(i, 1, 2050) - 0.5) * R * 1.8;
    const y = py - R + ((hash(i, 2, 2050) * R * 2 + time * 60) % (R * 2));
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
    g.strokeStyle = heavy ? `rgba(184,120,255,${(1 - u) * 0.6})` : `rgba(160,230,255,${(1 - u) * 0.6})`;
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
  if (!st || !sim || st.dark <= 0.01) return true;
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
  g.ellipse(px, py, R, R * 0.8, 0, 0, TAU);
  g.fill();
  g.strokeStyle = `rgba(255,230,160,${0.4 + k * 0.5})`;
  g.lineWidth = 1;
  g.beginPath();
  g.ellipse(px, py, R, R * 0.8, 0, 0, TAU);
  g.stroke();
  g.fillStyle = `rgba(255,190,90,${0.35 + k * 0.3})`;
  g.beginPath();
  g.ellipse(px, py, R * k, R * k * 0.8, 0, 0, TAU);
  g.fill();
  // Звезда в небе: из-за верхнего левого края к центру.
  const d = (1 - k) * 90;
  const sx = px - d * 0.55;
  const sy = py - d;
  for (let i = 0; i < 10; i++) {
    g.fillStyle = `rgba(255,240,200,${0.6 - i * 0.055})`;
    g.fillRect(Math.round(sx - i * 2.2), Math.round(sy - i * 4), 2, 2);
  }
  const gr = g.createRadialGradient(sx, sy, 0, sx, sy, 7);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.5, 'rgba(255,220,140,0.6)');
  gr.addColorStop(1, 'rgba(255,220,140,0)');
  g.fillStyle = gr;
  g.beginPath();
  g.arc(sx, sy, 7, 0, TAU);
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
    g.fillRect(Math.round(px + Math.cos(a) * d), Math.round(py + Math.sin(a) * d * 0.75 - Math.sin(k * PI) * 5), 1, 1);
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

/** Нить созвездия: свет бежит от звезды к звезде, вспыхивает ударом. */
registerZonePainter('f15_lash', (g, z, px, py, _s, time) => {
  const s = z as Strike;
  const k = Math.min(1, s.t / Math.max(0.01, s.warn));
  const L = z.r * TS;
  const a = s.ang ?? 0;
  const W = (s.w ?? 0.3) * TS;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  g.save();
  // Полоса удара (тусклая) — где опасно.
  g.strokeStyle = `rgba(255,110,90,${0.12 + k * 0.2})`;
  g.lineWidth = W * 2;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(px, py);
  g.lineTo(px + ux * L, py + uy * L);
  g.stroke();
  // Нить света — наливается к концу.
  g.strokeStyle = `rgba(200,220,255,${0.5 + 0.4 * k})`;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(px, py);
  g.lineTo(px + ux * L * k, py + uy * L * k);
  g.stroke();
  const fx = px + ux * L * k;
  const fy = py + uy * L * k;
  g.fillStyle = `rgba(255,255,255,${0.6 + 0.4 * Math.sin(time * 30)})`;
  g.fillRect(Math.round(fx) - 1, Math.round(fy), 3, 1);
  g.fillRect(Math.round(fx), Math.round(fy) - 1, 1, 3);
  g.restore();
  return true;
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
    g.fillRect(Math.round(px + Math.cos(a) * d), Math.round(py + Math.sin(a) * d * 0.8 - Math.sin(time * 2 + i) * 2), 1, 1);
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
  g.strokeStyle = 'rgba(30,20,50,0.6)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(ax, ay + 1);
  g.quadraticCurveTo((ax + bx) / 2, (ay + by) / 2 + 6 * (1 - k), bx, by + 1);
  g.stroke();
  g.strokeStyle = `rgba(150,240,255,${0.75 + 0.2 * Math.sin(time * 20)})`;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(ax, ay);
  g.quadraticCurveTo((ax + bx) / 2, (ay + by) / 2 + 6 * (1 - k), bx, by);
  g.stroke();
  // Крюк-кристалл на конце.
  g.fillStyle = 'rgba(230,255,255,0.95)';
  g.fillRect(Math.round(bx) - 1, Math.round(by) - 1, 3, 3);
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
    for (let i = 1; i <= 4; i++) p.set(9 - ux * (3 + i * 1.5), 9 - uy * (3 + i * 1.5), alpha(TEAL_GLOW, 0.55 - i * 0.12));
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
    for (let i = 1; i <= 6; i++) glow(p, 13 - ux * i * 1.8, 13 - uy * i * 1.8, 3 - i * 0.35, GOLDK, 0.5 - i * 0.07);
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
      g.fillRect(Math.round(px + Math.cos(a) * (3 + k * 9)), Math.round(py + Math.sin(a) * (3 + k * 9)), 1, 1);
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
  poly(p, [[1, 7], [2, 3], [5, 1], [8, 2], [9, 6], [7, 9], [3, 9]], (x, y) => tone(METEOR, (5 - x) * 0.08 + (5 - y) * 0.1 + 0.35));
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
  poly(p, [[2, 3], [4, 1], [6, 1], [8, 3], [8, 7], [6, 9], [4, 9], [2, 7]], (x, y) => mixc(VIOLET[3], VIOLET[1], (x + y) / 16));
  p.set(4, 3, WHITE);
  p.set(5, 5, hx('#fff0ff'));
  p.set(6, 6, alpha(WHITE, 0.6));
  p.outline(INK);
  return p;
});

registerItemArt('f15_honey', () => {
  const p = new Px(10, 10);
  // Кристальный мёд: соты-шестигранник, светится бирюзой.
  poly(p, [[2, 3], [5, 1], [8, 3], [8, 7], [5, 9], [2, 7]], (x, y) => tone(TEAL, (5 - x) * 0.1 + (5 - y) * 0.1 + 0.55));
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
