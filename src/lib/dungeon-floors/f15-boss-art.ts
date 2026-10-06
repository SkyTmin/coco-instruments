// Этаж 15, район «Ядро» — рисовальщики (v2.88). Хозяин подземелья —
// астральный владыка: плащ-колокол из ночного неба, по которому текут
// туманности и звёзды, кромка — живой космос; вместо головы — светящееся
// ядро-лицо с глазами-звёздами и корона из пяти кристаллов-планет на
// орбитах; руки из звёздного света в широких рукавах. Ног нет — парит.
// Стража района (осколок звезды, хранитель памяти), отголоски прошлых
// боссов созвездиями (их же кадры: тёмно-синее тело, золотой контур,
// звёзды), клетки района (звёздная карта арены с кольцами астролябии и
// созвездиями пяти владык, кратер упавшей звезды, мрамор Зала памяти,
// световая дорожка, кристальный грунт, знаки памяти, клетки «памяти» —
// лава, бездна, зеркала, круги — в кристалле и звёздном свете), предметы
// (звезда, армилляры, колонны, арки, жеоды, лампы, мерцания, шпили,
// реликвии в нишах), иконки вещей.
//
// Палитра: индиго и фиолет ночи, холодный голубой кристалл, звёздное
// золото. Ни плоти, ни крови. Свет сверху-слева, контур тёмно-синий.
// Пиксели 16 на клетку.
//
// Владыка рисуется в два слоя. Тело (`img`) — маленький 3D-рендер точками
// с буфером глубины: колокол плаща, шлейф, рукава; геометрия кадра лежит в
// `frameLRU` по ключу (румб из 32, поза-кадр 24 к/с, раскрытие плаща,
// шлейф, фаза кромки), а цвет ткани (туманность течёт) докрашивается
// каждый кадр по готовым координатам ткани — это дёшево. Свет (`lit`,
// поверх темноты) — ядро, глаза, воротник, планеты короны, ладони, звёзды
// плаща и кромка — собирается каждый кадр из готовых спрайтов.

import { Px } from '../dungeon-art';
import {
  frameLRU,
  MOB_PAINTERS,
  paintSim,
  registerCellPainter,
  registerItemArt,
  registerMobPainter,
  registerMobWarm,
  registerPropPainter,
  registerZonePainter,
} from '../dungeon-paint';
import type { CellCtx, MobFrame, MobPose, Sprite } from '../dungeon-paint';
import type { Mob, Sim, Strike, Zone } from '../dungeon-sim';
import type { WorldObj } from '../dungeon-world';
import { F15_HEART, F15B_GEO, F15B_MARK } from './f15-boss';
import { crownSpot, f15bView, LORD, starOf } from './f15-boss-brains';
import { drawSerpentBody } from './f6-art';

type RGBA = [number, number, number, number];

export const TAU = Math.PI * 2;
export const hx = (h: string, a = 255): RGBA => {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255, a];
};
export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const mixc = (a: RGBA, b: RGBA, k: number): RGBA => {
  const t = clamp01(k);
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
    Math.round(a[3] + (b[3] - a[3]) * t),
  ];
};
/** Тот же цвет с прозрачностью `a` 0…1. */
export const fade = (c: RGBA, a: number): RGBA => [c[0], c[1], c[2], Math.round(clamp01(a) * 255)];

/** Детерминированный шум по трём числам, 0…1. */
export const hash = (a: number, b: number, c = 0) => {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1274126177)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
/** Сглаженный шум 0…1. */
export function vnoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi, seed) * (1 - u) + hash(xi + 1, yi, seed) * u;
  const b = hash(xi, yi + 1, seed) * (1 - u) + hash(xi + 1, yi + 1, seed) * u;
  return a * (1 - v) + b * v;
}
const fbm = (x: number, y: number, seed: number) =>
  vnoise(x, y, seed) * 0.55 + vnoise(x * 2.03, y * 2.03, seed + 7) * 0.3 + vnoise(x * 4.1, y * 4.1, seed + 13) * 0.15;

/** Упорядоченный дизер 4×4: ступени без полос. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const bay = (x: number, y: number) => BAYER[((y & 3) << 2) | (x & 3)];
/** Смесь со ступенями (`steps`) и дизером — пиксельная, без мыла. */
const mixq = (a: RGBA, b: RGBA, k: number, X: number, Y: number, steps = 4): RGBA =>
  mixc(a, b, Math.min(steps, Math.floor(clamp01(k) * steps + bay(X, Y))) / steps);

export const eOut = (t: number) => 1 - (1 - clamp01(t)) * (1 - clamp01(t));
export const eIn = (t: number) => clamp01(t) * clamp01(t);
export const smooth = (t: number) => {
  const u = clamp01(t);
  return u * u * (3 - 2 * u);
};

// ---- Палитра ----------------------------------------------------------------

export const INK = hx('#05040f');
export const WHITE = hx('#ffffff');
/** Ночь: от бездны до освещённой ткани. */
export const NIGHT = ['#05040f', '#0a0920', '#100e30', '#171442', '#201b56', '#2b246c', '#3a3088', '#4c42a4'].map((c) => hx(c));
export const VIO = ['#2a1250', '#46207a', '#6a34a4', '#9a5ad0', '#c890f0', '#ecd4ff'].map((c) => hx(c));
export const MAG = ['#4a1450', '#7a2a86', '#b04ab8'].map((c) => hx(c));
export const TEAL = ['#0c2a40', '#164e6c', '#2a7a9a', '#5ab8d0'].map((c) => hx(c));
export const GOLD = ['#3a2408', '#6e4a14', '#a8761e', '#dcaa3c', '#ffd866', '#fff0b8'].map((c) => hx(c));
export const ICE = ['#0a1a34', '#163a6a', '#2a64a4', '#4c9ad6', '#8cd0f4', '#d0f4ff', '#ffffff'].map((c) => hx(c));
/** Цвета четвертей памяти: лава, бездна, зеркала, круги гидры. */
export const QCOL = ['#ff7a2a', '#38d0d8', '#c8dcff', '#7af08a'].map((c) => hx(c));
const LAVA = ['#2a0a10', '#6a1a18', '#b03a14', '#ee6a1c', '#ffa440', '#ffe08a', '#fff8d8'].map((c) => hx(c));
const SEA = ['#020a14', '#06202e', '#0c3a4c', '#16586c', '#2a8aa0', '#7ae0f0', '#e0ffff'].map((c) => hx(c));
const BOG = ['#081208', '#122a14', '#1e4a22', '#3a7a3a', '#7ae08a', '#d8ffd8'].map((c) => hx(c));

// ---- Где арена в мире ---------------------------------------------------------

interface Geo {
  cx: number;
  cy: number;
  top: number;
}
const geoCache = new WeakMap<object, Geo>();
/** Центр звезды в мире и верх района (кадр рисуется — из вылазки). */
function geo(): Geo {
  const s = paintSim();
  if (!s) return { cx: F15B_GEO.cx, cy: F15B_GEO.cy, top: 0 };
  let g = geoCache.get(s.world);
  if (!g) {
    const [cx, cy] = starOf(s);
    g = { cx, cy, top: Math.round(cy - F15B_GEO.cy) };
    geoCache.set(s.world, g);
  }
  return g;
}

// =============================================================================
// Клетки района.
// =============================================================================

const MK = F15B_MARK;
/** Кольца астролябии, клетки от центра звезды. */
const RINGS = [4.6, 8.4, 12.2];

/** Созвездия пяти владык на полу арены (клетки от центра звезды). */
interface Constel {
  pts: [number, number][];
  lines: [number, number][];
}
const CONSTEL_RAW: { a: number; pts: [number, number][]; lines: [number, number][] }[] = [
  // Корона Короля крыс — на севере.
  {
    a: -90,
    pts: [[-1.4, 0.6], [-1.5, -0.7], [-0.7, 0], [0, -1], [0.7, 0], [1.5, -0.7], [1.4, 0.6]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 0]],
  },
  // Секира Минотавра.
  {
    a: -18,
    pts: [[0, 1.7], [0, -0.5], [0, -1.5], [-1.2, -1.7], [-1.4, -0.5], [1.2, -1.7], [1.4, -0.5]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 1], [2, 5], [5, 6], [6, 1]],
  },
  // Красный змей.
  {
    a: 54,
    pts: [[-1.8, 0.9], [-1.1, 0.2], [-0.3, 0.7], [0.4, 0.1], [0.8, -0.6], [1.5, -0.9], [1.9, -0.3]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6]],
  },
  // Гидра — три головы.
  {
    a: 126,
    pts: [[0, 1.4], [0, 0.2], [-1.3, -0.9], [0, -1.5], [1.3, -0.9], [-0.7, 1.8], [0.7, 1.8]],
    lines: [[0, 1], [1, 2], [1, 3], [1, 4], [0, 5], [0, 6]],
  },
  // Меч Короля демонов.
  {
    a: 198,
    pts: [[0, -1.9], [0, 0.8], [-0.9, 0.6], [0.9, 0.6], [0, 1.6]],
    lines: [[0, 1], [2, 3], [1, 4]],
  },
];
const CONSTEL: Constel[] = CONSTEL_RAW.map((c) => {
  const a = (c.a * Math.PI) / 180;
  const ox = Math.cos(a) * 6.2;
  const oy = Math.sin(a) * 6.2;
  return { pts: c.pts.map(([x, y]) => [x + ox, y + oy] as [number, number]), lines: c.lines };
});

/** Ночное небо пола: туманность и редкие тусклые звёзды. */
function skyAt(X: number, Y: number): RGBA {
  const n = fbm(X / 46, Y / 46, 3);
  let c = mixq(NIGHT[1], NIGHT[3], (n - 0.28) * 1.7, X, Y);
  const m = fbm(X / 30 + 11, Y / 30 - 4, 9);
  if (m > 0.56) c = mixq(c, VIO[1], (m - 0.56) * 2.4 * 0.6, X, Y);
  const t = fbm(X / 36 - 20, Y / 36 + 7, 21);
  if (t > 0.62) c = mixq(c, TEAL[1], (t - 0.62) * 2.6 * 0.5, X, Y);
  const h = hash(X, Y, 5);
  if (h < 0.004) c = mixc(c, ICE[5], 0.3 + hash(X, Y, 6) * 0.45);
  else if (h < 0.0055) c = mixc(c, GOLD[4], 0.35);
  return c;
}

/** Отрезки созвездий, что задевают клетку (для пикселей — только они). */
function constelSegs(wx: number, wy: number, g: Geo): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  const x0 = wx - g.cx - 0.2;
  const y0 = wy - g.cy - 0.2;
  for (const c of CONSTEL)
    for (const [a, b] of c.lines) {
      const [ax, ay] = c.pts[a];
      const [bx, by] = c.pts[b];
      if (Math.max(ax, bx) < x0 || Math.min(ax, bx) > x0 + 1.4 || Math.max(ay, by) < y0 || Math.min(ay, by) > y0 + 1.4) continue;
      out.push([ax, ay, bx, by]);
    }
  return out;
}
function constelStars(wx: number, wy: number, g: Geo): [number, number][] {
  const out: [number, number][] = [];
  for (const c of CONSTEL)
    for (const [x, y] of c.pts) if (Math.abs(x + g.cx - wx - 0.5) < 1 && Math.abs(y + g.cy - wy - 0.5) < 1) out.push([x, y]);
  return out;
}

/** Пол арены: звёздная карта с кольцами астролябии, меридианами, созвездиями. */
function starFloor(p: Px, c: CellCtx, g: Geo): void {
  const segs = constelSegs(c.wx, c.wy, g);
  const stars = constelStars(c.wx, c.wy, g);
  for (let v = 0; v < 16; v++)
    for (let u = 0; u < 16; u++) {
      const X = c.wx * 16 + u;
      const Y = c.wy * 16 + v;
      const dx = (X + 0.5) / 16 - g.cx;
      const dy = (Y + 0.5) / 16 - g.cy;
      const d = Math.hypot(dx, dy);
      const d16 = d * 16;
      const a = Math.atan2(dy, dx);
      let col = skyAt(X, Y);
      // К краю арены пол темнеет.
      if (d > 10.5) col = mixq(col, NIGHT[0], (d - 10.5) / 3, X, Y);
      // Меридианы — пунктир через 30°, между первым и третьим кольцом.
      if (d > RINGS[0] && d < RINGS[2]) {
        const k = Math.round(a / (Math.PI / 6));
        const off = Math.abs(Math.sin(a - (k * Math.PI) / 6)) * d16;
        if (off < 0.55 && (Math.floor(d16) % 3 !== 0)) col = mixc(col, GOLD[2], 0.55);
      }
      // Кольца: золотая нить с гравировкой под ней.
      for (let i = 0; i < 3; i++) {
        const e = d16 - RINGS[i] * 16;
        const lit = Math.cos(a + 2.3) > 0.2;
        if (Math.abs(e) < 0.6) col = lit ? GOLD[4] : GOLD[3];
        else if (e >= 0.6 && e < 1.5) col = mixc(col, INK, 0.45);
        else if (i === 1 && Math.abs(e + 3) < 0.5) col = mixc(col, GOLD[2], 0.7);
        if (i === 2 && e > 0.6 && e < 4.6) {
          // Риски внешнего кольца: каждые 6° короткая, каждые 30° — длинная.
          const deg = ((a * 180) / Math.PI + 360) % 360;
          const k6 = Math.abs(((deg + 3) % 6) - 3) * (Math.PI / 180) * d16;
          const k30 = Math.abs(((deg + 15) % 30) - 15) * (Math.PI / 180) * d16;
          if (k30 < 0.6) col = e < 4.4 ? GOLD[3] : col;
          else if (k6 < 0.5 && e < 2.6) col = mixc(col, GOLD[2], 0.8);
        }
      }
      // Созвездия: тонкий пунктир между звёздами.
      for (const [ax, ay, bx, by] of segs) {
        const lx = bx - ax;
        const ly = by - ay;
        const L2 = lx * lx + ly * ly || 1;
        const t = clamp01(((dx - ax) * lx + (dy - ay) * ly) / L2);
        const ex = (ax + lx * t - dx) * 16;
        const ey = (ay + ly * t - dy) * 16;
        if (ex * ex + ey * ey < 0.36 && (Math.floor(t * Math.sqrt(L2) * 16) & 1) === 0) col = mixc(col, ICE[4], 0.55);
      }
      for (const [sx, sy] of stars) {
        const ex = Math.abs((sx - dx) * 16);
        const ey = Math.abs((sy - dy) * 16);
        if (ex < 1 && ey < 1) col = WHITE;
        else if ((ex < 2 && ey < 0.6) || (ey < 2 && ex < 0.6)) col = mixc(col, ICE[5], 0.85);
        else if (ex < 2.2 && ey < 2.2) col = mixc(col, ICE[3], 0.35);
      }
      p.set(u, v, col);
    }
}

/** Кратер упавшей звезды: опалённая ночь, лучистые трещины золота, осколки. */
function craterFloor(p: Px, c: CellCtx, g: Geo): void {
  for (let v = 0; v < 16; v++)
    for (let u = 0; u < 16; u++) {
      const X = c.wx * 16 + u;
      const Y = c.wy * 16 + v;
      const dx = (X + 0.5) / 16 - g.cx;
      const dy = (Y + 0.5) / 16 - g.cy;
      const d = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      let col = mixq(NIGHT[0], VIO[0], 0.5 - d * 0.12 + vnoise(X / 5, Y / 5, 17) * 0.4, X, Y);
      // Вал кратера.
      if (d > 2.2 && d < 2.75) col = mixq(NIGHT[3], VIO[1], vnoise(X / 3, Y / 3, 18), X, Y);
      if (d > 2.75) col = skyAt(X, Y);
      // Трещины лучами: светят у звезды, гаснут к валу.
      if (d < 2.5) {
        const w = vnoise(d * 3, 4.5, 19) * 0.5 - 0.25;
        for (let i = 0; i < 11; i++) {
          const th = (i * TAU) / 11 + hash(i, 3, 20) * 0.4 + w;
          let da = a - th;
          da -= Math.round(da / TAU) * TAU;
          if (Math.abs(da) * d * 16 < 0.7 && d > 0.25 && d < 0.9 + hash(i, 4, 21) * 1.6) {
            col = d < 0.9 ? GOLD[5] : d < 1.5 ? GOLD[4] : GOLD[3];
            break;
          }
        }
      }
      // Осколки звезды — голубые искры.
      if (d < 2.7 && hash(X >> 1, Y >> 1, 22) < 0.035) col = (X + Y) & 1 ? ICE[4] : ICE[3];
      p.set(u, v, col);
    }
}

/** Знак памяти: круг рун 3×3 клетки, внутри — знак четверти. */
function sigilFloor(p: Px, c: CellCtx, g: Geo): void {
  const k = c.mark - MK.sigLava;
  const col = QCOL[k] ?? WHITE;
  const same = (dx: number, dy: number) => c.markAt(dx, dy) === c.mark;
  const ox = same(-1, 0) && same(1, 0) ? 0 : same(1, 0) ? 1 : -1;
  const oy = same(0, -1) && same(0, 1) ? 0 : same(0, 1) ? 1 : -1;
  const ccx = ox * 16 + 8;
  const ccy = oy * 16 + 8;
  starFloor(p, c, g);
  for (let v = 0; v < 16; v++)
    for (let u = 0; u < 16; u++) {
      const X = c.wx * 16 + u;
      const Y = c.wy * 16 + v;
      const dx = u + 0.5 - ccx;
      const dy = v + 0.5 - ccy;
      const r = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      let o: RGBA | null = null;
      if (r < 20) o = mixc(p.get(u, v), col, 0.1);
      if (Math.abs(r - 20) < 0.8) o = col;
      else if (r > 20.8 && r < 22) o = mixc(p.get(u, v), INK, 0.5);
      else if (Math.abs(r - 13.4) < 0.6) o = mixc(col, WHITE, 0.15);
      else if (r > 15 && r < 18.4) {
        // Руны между кольцами: по сектору 30° свой штрих.
        const s = Math.floor(((a + Math.PI) / TAU) * 12);
        const h = hash(s, k, 23);
        const sa = ((a + Math.PI) / TAU) * 12 - s;
        if ((h < 0.5 && Math.abs(sa - 0.5) < 0.09) || (h >= 0.5 && Math.abs(r - 16.7) < 0.5 && sa > 0.25 && sa < 0.75))
          o = mixc(col, INK, 0.25);
      } else if (r < 10.5) {
        let on = false;
        if (k === 0) on = (dx / 5) ** 2 + ((dy - 2) / 6) ** 2 < 1 || (dy < -1 && Math.abs(dx) < (dy + 10) * 0.45 && dy > -10);
        else if (k === 1) for (const w of [-4, 0, 4]) on = on || (Math.abs(dy - w - Math.sin(dx * 0.7) * 1.4) < 0.75 && Math.abs(dx) < 8);
        else if (k === 2) on = Math.abs(Math.abs(dx) + Math.abs(dy) - 7.5) < 0.8 || Math.abs(dx) + Math.abs(dy) < 2.6;
        else
          on =
            Math.hypot(dx + 5, dy + 3) < 2 ||
            Math.hypot(dx, dy + 6) < 2 ||
            Math.hypot(dx - 5, dy + 3) < 2 ||
            (Math.abs(dx) < 0.8 && dy > -5 && dy < 6) ||
            (Math.abs(dy - 2 + Math.abs(dx) * 0.9) < 0.7 && Math.abs(dx) < 5);
        if (on) o = (X + Y) % 5 === 0 ? mixc(col, WHITE, 0.5) : col;
      }
      if (o) p.set(u, v, o);
    }
}

/** Мрамор Зала памяти: плиты с золотыми швами, через клетку — звезда-инкрустация. */
function hallFloor(p: Px, c: CellCtx): void {
  const inlay = (((c.wx + c.wy) % 4) + 4) % 4 === 0;
  for (let v = 0; v < 16; v++)
    for (let u = 0; u < 16; u++) {
      const X = c.wx * 16 + u;
      const Y = c.wy * 16 + v;
      const n = fbm(X / 10, Y / 24, 31);
      let col = mixq(NIGHT[2], NIGHT[4], n * 1.2 - 0.1, X, Y);
      const vein = Math.sin(X * 0.33 + Y * 0.12 + n * 9);
      if (vein > 0.95) col = mixc(col, VIO[3], 0.45);
      else if (vein > 0.88) col = mixc(col, VIO[2], 0.25);
      if (u === 0 || v === 0) col = mixc(GOLD[1], col, 0.25);
      else if (u === 15 || v === 15) col = mixc(col, INK, 0.45);
      else if (u === 1 || v === 1) col = mixc(col, NIGHT[6], 0.3);
      if (inlay) {
        const du = Math.abs(u - 7.5);
        const dv = Math.abs(v - 7.5);
        if ((du < 0.6 && dv < 5) || (dv < 0.6 && du < 5) || (du + dv < 3.2 && Math.abs(du - dv) < 0.8)) col = du + dv < 1.2 ? GOLD[5] : GOLD[3];
        else if (du + dv < 3.6 && du < 2.6 && dv < 2.6) col = mixc(col, GOLD[1], 0.5);
      }
      p.set(u, v, col);
    }
}

/** Световая дорожка Зала: полированная плита, золотые кромки, огни посередине. */
function runwayFloor(p: Px, c: CellCtx): void {
  const lEdge = c.markAt(-1, 0) !== MK.runway;
  const rEdge = c.markAt(1, 0) !== MK.runway;
  const mid = c.markAt(-1, 0) === MK.runway && c.markAt(1, 0) === MK.runway;
  for (let v = 0; v < 16; v++)
    for (let u = 0; u < 16; u++) {
      const X = c.wx * 16 + u;
      const Y = c.wy * 16 + v;
      let col = mixq(NIGHT[4], NIGHT[5], 0.35 + Math.sin(Y * 0.4 + X * 0.05) * 0.25 + vnoise(X / 6, Y / 6, 33) * 0.3, X, Y);
      if (v === 15) col = mixc(col, INK, 0.35);
      if (lEdge && u < 2) col = u === 0 ? GOLD[3] : GOLD[1];
      if (rEdge && u > 13) col = u === 15 ? GOLD[2] : GOLD[1];
      if (mid) {
        const dv = ((Y % 8) + 8) % 8;
        const du = Math.abs(u - 7.5);
        if (dv < 2 && du < 1.2) col = GOLD[5];
        else if (dv < 3 && du < 2.3) col = mixc(col, GOLD[4], 0.45);
      }
      p.set(u, v, col);
    }
}

/** Кристальный грунт нижних ходов; `dust` — со звёздной пылью. */
function groundFloor(p: Px, c: CellCtx, dust: boolean): void {
  for (let v = 0; v < 16; v++)
    for (let u = 0; u < 16; u++) {
      const X = c.wx * 16 + u;
      const Y = c.wy * 16 + v;
      const n = fbm(X / 12, Y / 12, 41);
      let col = mixq(NIGHT[1], NIGHT[3], n * 1.4 - 0.2, X, Y);
      // Камешки.
      const pb = vnoise(X / 2.5, Y / 2.5, 42);
      if (pb > 0.8) col = mixc(col, NIGHT[5], 0.6);
      else if (pb > 0.74) col = mixc(col, INK, 0.3);
      // Ростки кристалла: треугольник 3 пикселя.
      const bx = X >> 3;
      const by = Y >> 3;
      if (hash(bx, by, 43) < 0.1) {
        const sx = (bx << 3) + 2 + Math.floor(hash(bx, by, 44) * 4);
        const sy = (by << 3) + 3 + Math.floor(hash(bx, by, 45) * 3);
        const ddx = X - sx;
        const ddy = Y - sy;
        if (ddy >= -2 && ddy <= 0 && Math.abs(ddx) <= ddy + 2) col = ddy === -2 ? ICE[5] : ddx < 0 ? ICE[4] : ICE[2];
        else if (ddy === 1 && Math.abs(ddx) <= 2) col = mixc(col, INK, 0.5);
      }
      if (dust) {
        if (vnoise(X / 7, Y / 7, 46) > 0.45) col = mixq(col, VIO[1], 0.4, X, Y);
        const h = hash(X, Y, 47);
        if (h < 0.03) col = h < 0.012 ? GOLD[4] : ICE[5];
      }
      p.set(u, v, col);
    }
}

/** Клетки памяти: прошлые этажи — в кристалле и звёздном свете. */
function memoryFloor(p: Px, c: CellCtx, g: Geo): void {
  const mk = c.mark;
  const same = (dx: number, dy: number) => c.markAt(dx, dy) === mk;
  for (let v = 0; v < 16; v++)
    for (let u = 0; u < 16; u++) {
      const X = c.wx * 16 + u;
      const Y = c.wy * 16 + v;
      let col: RGBA;
      const edge = (u === 0 && !same(-1, 0)) || (u === 15 && !same(1, 0)) || (v === 0 && !same(0, -1)) || (v === 15 && !same(0, 1));
      if (mk === MK.lava) {
        // Звёздная лава: жилы ярче, корка — тёмный кристалл.
        const n = fbm(X / 7, Y / 7, 51);
        const dd = Math.abs(n - 0.5);
        col = dd < 0.04 ? LAVA[6] : dd < 0.08 ? LAVA[5] : dd < 0.13 ? LAVA[4] : mixq(LAVA[2], LAVA[3], vnoise(X / 3, Y / 3, 52), X, Y);
        if (vnoise(X / 5, Y / 5, 53) > 0.72) col = mixq(VIO[0], NIGHT[2], vnoise(X / 2, Y / 2, 54), X, Y);
        if (hash(X, Y, 55) < 0.006) col = WHITE;
        if (edge) col = mixc(LAVA[1], INK, 0.3);
      } else if (mk === MK.crust) {
        const n = vnoise(X / 4, Y / 4, 56);
        col = mixq(NIGHT[1], VIO[0], n, X, Y);
        if (Math.abs(n - 0.5) < 0.03) col = LAVA[4];
        else if (Math.abs(n - 0.5) < 0.06) col = LAVA[2];
      } else if (mk === MK.abyss) {
        // Бездна: тёмная вода, в ней отражаются звёзды.
        const n = vnoise(X / 5, Y / 5, 57);
        const band = Math.sin(X * 0.3 + Y * 0.12 + n * 7);
        col = band > 0.9 ? SEA[4] : band > 0.6 ? SEA[3] : mixq(SEA[0], SEA[2], n, X, Y);
        const h = hash(X, Y, 58);
        if (h < 0.006) col = SEA[6];
        else if (h < 0.012) col = ICE[4];
        if (edge) col = SEA[5];
      } else if (mk === MK.shallow) {
        col = mixq(skyAt(X, Y), SEA[3], 0.55, X, Y);
        if (Math.sin(X * 0.3 + Y * 0.1 + vnoise(X / 5, Y / 5, 57) * 7) > 0.8) col = mixc(col, SEA[5], 0.5);
      } else if (mk === MK.mirror) {
        // Зеркало-кристалл сверху: ромб со светом сверху-слева.
        const du = u + 0.5 - 8;
        const dv = v + 0.5 - 8;
        const m = Math.abs(du) + Math.abs(dv);
        if (m < 7.2) col = m > 6 ? ICE[1] : du + dv < -3 ? ICE[6] : du + dv < 2 ? ICE[5] : ICE[4];
        else col = mixc(skyAt(X, Y), ICE[2], 0.4);
      } else if (mk === MK.mirrorFloor) {
        col = mixc(skyAt(X, Y), ICE[2], 0.3);
        if ((u + v) % 6 === 0 || (u - v + 32) % 9 === 0) col = mixc(col, ICE[5], 0.45);
      } else if (mk === MK.circleA || mk === MK.circleB) {
        const cc = mk === MK.circleA ? BOG[4] : TEAL[3];
        const du = u + 0.5 - 8;
        const dv = v + 0.5 - 8;
        const d = Math.hypot(du, dv);
        const an = Math.atan2(dv, du);
        col = d < 6.6 ? mixq(BOG[1], NIGHT[2], d / 7, X, Y) : skyAt(X, Y);
        if (Math.abs(d - 6.6) < 0.7) col = cc;
        else if (Math.abs(d - 3.8) < 0.6 && Math.floor(((an + Math.PI) / TAU) * 12) % 2 === 0) col = mixc(cc, WHITE, 0.5);
        else if (d < 1.2) col = WHITE;
      } else if (mk === MK.bog) {
        const n = vnoise(X / 4, Y / 4, 59);
        col = mixq(BOG[0], BOG[2], n, X, Y);
        if (hash(X, Y, 60) < 0.012) col = BOG[4];
      } else {
        // Ожог: звёздный пол, опалённый до пепла, по краю — тлеющее золото.
        const dx = (X + 0.5) / 16 - g.cx;
        const dy = (Y + 0.5) / 16 - g.cy;
        col = mixq(skyAt(X, Y), INK, 0.6, X, Y);
        if (vnoise(X / 3 + dx, Y / 3 + dy, 61) > 0.7) col = GOLD[2];
      }
      p.set(u, v, col);
    }
}

/** Верх стены: тёмная порода с гранями кристалла, кромка к полу — светлая. */
function wallTop(p: Px, c: CellCtx): void {
  const kind = c.mark;
  for (let v = 0; v < 16; v++)
    for (let u = 0; u < 16; u++) {
      const X = c.wx * 16 + u;
      const Y = c.wy * 16 + v;
      const n = vnoise(X / 5, Y / 5, 71);
      let col = n > 0.64 ? hx('#100e2c') : n > 0.4 ? hx('#0b0a22') : NIGHT[0];
      if (kind === MK.wallGold) col = mixc(col, GOLD[0], 0.3);
      if (kind === MK.wallCrystal) {
        const bx = X >> 3;
        const by = Y >> 3;
        const cx = (bx << 3) + 4;
        const cy = (by << 3) + 4;
        const m = Math.abs(X - cx) + Math.abs(Y - cy) * 0.7;
        if (hash(bx, by, 72) < 0.6 && m < 3) col = m < 1.2 ? ICE[5] : X < cx ? ICE[3] : ICE[2];
      }
      if ((v === 0 && c.open(0, -1)) || (u === 0 && c.open(-1, 0)) || (u === 15 && c.open(1, 0))) col = kind === MK.wallGold ? GOLD[2] : VIO[1];
      p.set(u, v, col);
    }
}

/** Лицо стены (над полом): кромка сверху, ниже — грань по виду стены. */
function wallFace(p: Px, c: CellCtx): void {
  const kind = c.mark;
  const gold = kind === MK.wallGold || kind === MK.niche;
  for (let v = 0; v < 16; v++)
    for (let u = 0; u < 16; u++) {
      const X = c.wx * 16 + u;
      const Y = c.wy * 16 + v;
      let col: RGBA;
      if (v < 3) {
        col = v === 0 ? (gold ? GOLD[3] : VIO[2]) : gold ? GOLD[1] : NIGHT[3];
        if (v === 2) col = mixc(col, INK, 0.5);
      } else if (gold) {
        // Зал: тёмный мрамор в золотой рамке, звезда-инкрустация.
        const inner = u > 1 && u < 14 && v > 4 && v < 14;
        col = mixq(NIGHT[3], NIGHT[5], fbm(X / 6, Y / 12, 81), X, Y);
        if (!inner) col = u < 2 || v < 5 ? GOLD[2] : GOLD[1];
        else if (u === 2 || v === 5) col = mixc(col, INK, 0.4);
        const du = Math.abs(u - 7.5);
        const dv = Math.abs(v - 9.5);
        if (inner && ((du < 0.6 && dv < 3) || (dv < 0.6 && du < 3))) col = du + dv < 1 ? GOLD[5] : GOLD[3];
        if (kind === MK.niche) {
          // Ниша: арка в золотой раме, внутри — тёмная глубина.
          const ax = (u + 0.5 - 8) / 5.5;
          const ay = (v + 0.5 - 8.5) / 5;
          const inArch = (v >= 8.5 && Math.abs(ax) < 1) || ax * ax + ay * ay < 1;
          const rim = Math.abs(u + 0.5 - 8) < 6.5 && v > 2 && !inArch && (v >= 8.5 ? Math.abs(ax) < 1.2 : ax * ax + ay * ay < 1.45);
          if (inArch) col = mixq(INK, VIO[0], 0.2 + (v - 3) / 26, X, Y);
          else if (rim) col = u + v < 15 ? GOLD[4] : GOLD[2];
        }
      } else {
        // Кристальная грань: столбцы граней, свет на левом ребре, тень у пола.
        const sh = Math.floor(vnoise(0, Y / 9, 82) * 5);
        const fx = Math.floor((X + sh) / 5);
        const t0 = 2 + Math.floor(hash(fx, c.wy, 83) * 3);
        col = NIGHT[kind === 0 ? t0 - 1 : t0];
        if (((X + sh) % 5 + 5) % 5 === 0) col = mixc(col, VIO[2], kind === 0 ? 0.25 : 0.5);
        if (v >= 13) col = mixc(col, INK, (v - 12) * 0.18);
        if (kind !== 0 && Math.abs((((X * 0.7 + Y) % 29) + 29) % 29 - 14) < 0.5 && hash(fx, 2, 84) < 0.5) col = ICE[2];
        if (kind === MK.wallCrystal) {
          // Друза: три призмы со светом.
          for (let i = 0; i < 3; i++) {
            const cx = 2 + i * 5 + Math.floor(hash(c.wx, i, 85) * 2);
            const top = 4 + Math.floor(hash(c.wx, i, 86) * 5);
            const hw = 2;
            const dxp = u - cx;
            if (v >= top && Math.abs(dxp) <= hw - (v - top < 2 ? 2 - (v - top) : 0) + 0) {
              col = dxp < 0 ? ICE[4] : dxp === 0 ? ICE[5] : ICE[2];
              if (v === top) col = WHITE;
            }
          }
        }
      }
      p.set(u, v, col);
    }
}

/** Вид пола клетки без метки — по месту в районе. */
function regionMark(c: CellCtx, g: Geo): number {
  const lx = c.wx;
  const ly = c.wy - g.top;
  const H = F15B_GEO.hall;
  if (ly >= H.y0 && ly <= H.y1 && lx >= H.x0 && lx <= H.x1) return lx >= 30 && lx <= 32 ? MK.runway : MK.hall;
  if (ly === F15B_GEO.gateY) return MK.runway;
  if (ly < F15B_GEO.gateY) return MK.star;
  return MK.ground;
}

registerCellPainter(F15_HEART, (c: CellCtx) => {
  const g = geo();
  const p = new Px(16, 16);
  const mk = c.mark;
  // Клетки памяти (на любой плитке: глубина, опасный пол, пол).
  if (mk >= MK.lava && mk <= MK.scorch) {
    memoryFloor(p, c, g);
    return p;
  }
  const wall = !c.open(0, 0);
  if (wall) {
    if (c.tile === 11) return null;
    if (c.open(0, 1)) wallFace(p, c);
    else wallTop(p, c);
    return p;
  }
  // Подъёмник и печать рисует движок.
  if (c.tile === 10) return null;
  const m = mk === 0 ? regionMark(c, g) : mk;
  if (m === MK.star) starFloor(p, c, g);
  else if (m === MK.crater) craterFloor(p, c, g);
  else if (m >= MK.sigLava && m <= MK.sigHydra) sigilFloor(p, c, g);
  else if (m === MK.hall) hallFloor(p, c);
  else if (m === MK.runway) runwayFloor(p, c);
  else groundFloor(p, c, m === MK.dust);
  return p;
});

// =============================================================================
// Предметы района.
// =============================================================================

const sprites = new Map<string, Sprite>();
function spr(key: string, make: () => { p: Px; ax: number; ay: number }): Sprite {
  let s = sprites.get(key);
  if (!s) {
    const m = make();
    s = { img: m.p.canvas(), ax: m.ax, ay: m.ay };
    sprites.set(key, s);
  }
  return s;
}
const flashed = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();
/** Вспышка удара по предмету: тот же спрайт, выбеленный. */
function flashOf(s: Sprite): Sprite {
  let c = flashed.get(s.img);
  if (!c) {
    c = document.createElement('canvas');
    c.width = s.img.width;
    c.height = s.img.height;
    const g = c.getContext('2d');
    if (g) {
      g.drawImage(s.img, 0, 0);
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = 'rgba(255,255,255,0.7)';
      g.fillRect(0, 0, c.width, c.height);
    }
    flashed.set(s.img, c);
  }
  return { img: c, ax: s.ax, ay: s.ay };
}

/** Линия по пикселям с толщиной. */
function stroke(p: Px, x0: number, y0: number, x1: number, y1: number, c: RGBA, w = 1): void {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 1.5));
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    const y = y0 + ((y1 - y0) * i) / n;
    if (w <= 1) p.set(x, y, c);
    else p.ell(x, y, w / 2, w / 2, c);
  }
}
/** Выпуклый многоугольник заливкой по пикселям. */
function poly(p: Px, pts: [number, number][], c: RGBA | ((x: number, y: number) => RGBA)): void {
  let y0 = 1e9;
  let y1 = -1e9;
  for (const [, y] of pts) {
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[(i + 1) % pts.length];
      const yy = y + 0.5;
      if ((ay <= yy && by > yy) || (by <= yy && ay > yy)) xs.push(ax + ((yy - ay) / (by - ay)) * (bx - ax));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2)
      for (let x = Math.round(xs[k]); x < Math.round(xs[k + 1]); x++) p.set(x, y, typeof c === 'function' ? c(x, y) : c);
  }
}
/** Шар со светом сверху-слева по четырём тонам. */
function ball(p: Px, cx: number, cy: number, r: number, t: RGBA[], bias = 0): void {
  p.ell(cx, cy, r, r, (x, y) => {
    const dx = (x + 0.5 - cx) / r;
    const dy = (y + 0.5 - cy) / r;
    const nz = Math.sqrt(Math.max(0, 1 - dx * dx - dy * dy));
    const l = -dx * 0.5 - dy * 0.6 + nz * 0.6 + bias;
    return t[l > 0.85 ? 3 : l > 0.5 ? 2 : l > 0.1 ? 1 : 0];
  });
}
/** Восьмилучевая звезда: длинные лучи — `c0`, короткие — `c1`. */
function star8(p: Px, cx: number, cy: number, R: number, rot: number, c0: RGBA, c1: RGBA, core: RGBA): void {
  for (let i = 0; i < 8; i++) {
    const a = rot + (i * TAU) / 8;
    const L = i % 2 ? R * 0.55 : R;
    const w = i % 2 ? R * 0.16 : R * 0.2;
    const tip: [number, number] = [cx + Math.cos(a) * L, cy + Math.sin(a) * L];
    const l: [number, number] = [cx + Math.cos(a + Math.PI / 2) * w, cy + Math.sin(a + Math.PI / 2) * w];
    const r: [number, number] = [cx - Math.cos(a + Math.PI / 2) * w, cy - Math.sin(a + Math.PI / 2) * w];
    poly(p, [l, tip, r], i % 2 ? c1 : c0);
  }
  p.ell(cx, cy, R * 0.26, R * 0.26, core);
}

/** Звезда: упавшая — кристальная звезда над кратером; в сверхновой — пылает. */
registerPropPainter('f15b_star', (_o, time) => {
  const s = paintSim();
  const v = f15bView(s);
  const won = !!s && (s.beaten || s.boss?.state === 'won');
  const nova = v?.nova;
  const state = won ? 'cold' : nova ? (nova.stage === 'exhale' ? 'dim' : 'blaze') : 'calm';
  const rot = Math.floor(time * (state === 'blaze' ? 10 : 3)) % 12;
  const pulse = Math.floor(time * 2.4) % 4;
  return spr(`star|${state}|${rot}|${pulse}`, () => {
    const W = 56;
    const H = 60;
    const p = new Px(W, H);
    const cx = W / 2;
    const cy = H - 8 - 16;
    const big = state === 'blaze' ? 1.35 : state === 'dim' ? 0.85 : 1;
    const pz = [0, 0.6, 1, 0.6][pulse];
    // Свет на дне кратера.
    p.ell(cx, H - 8, 13 * big, 4, fade(state === 'cold' ? ICE[2] : GOLD[4], 0.18 + pz * 0.06));
    p.ell(cx, H - 8, 7 * big, 2.2, fade(state === 'cold' ? ICE[3] : GOLD[5], 0.3));
    // Ореол.
    p.ell(cx, cy, (15 + pz) * big, (15 + pz) * big, fade(state === 'cold' ? ICE[2] : GOLD[3], 0.12));
    p.ell(cx, cy, (10 + pz) * big, (10 + pz) * big, fade(state === 'cold' ? ICE[3] : GOLD[4], 0.16));
    const a = (rot / 12) * (TAU / 8);
    const R = (12 + pz * 0.8) * big;
    if (state === 'cold') star8(p, cx, cy, R * 0.85, a, ICE[3], ICE[2], ICE[4]);
    else if (state === 'blaze') {
      star8(p, cx, cy, R * 1.15, a + TAU / 16, fade(GOLD[4], 0.5), fade(GOLD[3], 0.4), GOLD[5]);
      star8(p, cx, cy, R, a, WHITE, GOLD[5], WHITE);
    } else {
      star8(p, cx, cy, R, a, ICE[5], GOLD[4], WHITE);
      // Гранёный свет: левые половины лучей светлее.
      star8(p, cx - 0.6, cy - 0.6, R * 0.5, a, WHITE, GOLD[5], WHITE);
    }
    p.outline(fade(INK, 0.6));
    return { p, ax: cx, ay: H };
  });
});

/** Армиллярная сфера: золотые кольца вокруг кристального шара на опоре. */
registerPropPainter('f15b_armillary', (o, time) => {
  const s = paintSim();
  const fast = (s?.boss?.phase ?? 0) === 2 && s?.boss?.state === 'fight';
  const n = Math.floor(time * (fast ? 14 : 4) + (o.x * 7 + o.y * 3)) % 24;
  return spr(`arm|${n}`, () => {
    const W = 24;
    const H = 38;
    const p = new Px(W, H);
    const cx = 12;
    const cy = 13;
    // Опора: ступень, стойка, чаша.
    p.rect(6, H - 3, 17, H - 1, GOLD[1]);
    p.rect(7, H - 4, 16, H - 4, GOLD[3]);
    p.rect(10, 22, 13, H - 5, GOLD[2]);
    p.rect(10, 22, 10, H - 5, GOLD[4]);
    p.rect(13, 22, 13, H - 5, GOLD[1]);
    p.rect(8, 21, 15, 22, GOLD[3]);
    const th = (n / 24) * TAU;
    const ringPts = (k: number, front: boolean) => {
      const out: [number, number][] = [];
      for (let i = 0; i < 96; i++) {
        const t = (i / 96) * TAU;
        // Кольцо k: экватор, меридиан (вращается), эклиптика (наклон, вращается).
        let x = Math.cos(t) * 9;
        let y = 0;
        let z = Math.sin(t) * 9;
        if (k === 1) {
          y = z;
          z = 0;
          const xr = x * Math.cos(th);
          z = x * Math.sin(th);
          x = xr;
        } else if (k === 2) {
          const tilt = 0.45;
          y = z * Math.sin(tilt);
          z = z * Math.cos(tilt);
          const xr = x * Math.cos(-th * 0.7) - z * Math.sin(-th * 0.7);
          z = x * Math.sin(-th * 0.7) + z * Math.cos(-th * 0.7);
          x = xr;
        }
        if (z >= 0 === front) out.push([cx + x, cy - y + z * 0.35]);
      }
      return out;
    };
    for (let k = 0; k < 3; k++) for (const [x, y] of ringPts(k, false)) p.set(x, y, GOLD[1]);
    ball(p, cx, cy, 4, [ICE[1], ICE[2], ICE[4], ICE[6]]);
    for (let k = 0; k < 3; k++) for (const [x, y] of ringPts(k, true)) p.set(x, y, k === 0 ? GOLD[4] : GOLD[3]);
    p.outline(fade(INK, 0.85));
    return { p, ax: cx, ay: H };
  });
});

/** Колонна Зала: тёмный мрамор, золотые пояса, кристалл на капители. */
registerPropPainter('f15b_column', (o, time) => {
  const glow = Math.floor(time * 1.5 + o.x) % 3;
  return spr(`col|${glow}`, () => {
    const W = 16;
    const H = 46;
    const p = new Px(W, H);
    p.rect(1, H - 4, 14, H - 1, GOLD[1]);
    p.rect(2, H - 5, 13, H - 5, GOLD[3]);
    for (let y = 9; y < H - 5; y++)
      for (let x = 4; x <= 11; x++) {
        const l = x === 4 ? 3 : x < 7 ? 2 : x < 10 ? 1 : 0;
        let c = NIGHT[3 + l];
        if (Math.sin(y * 0.5 + x * 1.3 + vnoise(x / 2, y / 6, 91) * 4) > 0.93) c = VIO[2];
        p.set(x, y, c);
      }
    for (const y of [16, 27, H - 8]) p.rect(4, y, 11, y + 1, y === 16 ? GOLD[3] : GOLD[2]);
    p.rect(2, 6, 13, 9, GOLD[2]);
    p.rect(2, 6, 13, 6, GOLD[4]);
    p.rect(3, 9, 12, 9, GOLD[1]);
    // Кристалл.
    poly(p, [[8, 0], [10.5, 3], [8, 6.5], [5.5, 3]], (x) => (x < 8 ? ICE[4 + (glow === 1 ? 1 : 0)] : ICE[3]));
    p.outline(fade(INK, 0.85));
    return { p, ax: 8, ay: H };
  });
});

/** Арка: кристальная стойка; левая из пары рисует и пролёт с золотым замком. */
const archPartner = new WeakMap<WorldObj, number>();
function partnerOf(o: WorldObj): number {
  const hit = archPartner.get(o);
  if (hit !== undefined) return hit;
  const s = paintSim();
  let d = 0;
  if (s) {
    const q = s.world.objs.find((x) => x.ref === 'f15b_arch' && x.y === o.y && x.x > o.x && x.x - o.x <= 10);
    if (q) d = q.x - o.x;
  }
  archPartner.set(o, d);
  return d;
}
registerPropPainter('f15b_arch', (o) => {
  const span = partnerOf(o);
  return spr(`arch|${span}`, () => {
    const W = 12 + span * 16;
    const H = 52;
    const p = new Px(W, H);
    const pillar = (x0: number) => {
      for (let y = 14; y < H - 2; y++)
        for (let x = x0; x < x0 + 8; x++) {
          const l = x - x0;
          p.set(x, y, l < 2 ? ICE[4] : l < 4 ? ICE[3] : l < 6 ? ICE[2] : ICE[1]);
        }
      p.rect(x0 - 1, H - 3, x0 + 8, H - 1, NIGHT[4]);
      poly(p, [[x0, 14], [x0 + 4, 8], [x0 + 8, 14]], (x) => (x < x0 + 4 ? ICE[5] : ICE[3]));
    };
    pillar(2);
    if (span > 0) {
      pillar(2 + span * 16);
      const x0 = 6;
      const x1 = 6 + span * 16;
      const mid = (x0 + x1) / 2;
      for (let x = x0; x <= x1; x++) {
        const t = (x - mid) / ((x1 - x0) / 2);
        const y = 10 - (1 - t * t) * 9;
        for (let k = 0; k < 3; k++) p.set(x, y + k, k === 0 ? ICE[5] : k === 1 ? ICE[3] : ICE[1]);
      }
      star8(p, mid, 3, 4, 0, GOLD[4], GOLD[3], WHITE);
    }
    p.outline(fade(INK, 0.85));
    return { p, ax: 6, ay: H };
  });
});

/** Жеода: тёмный камень, расколотый — внутри фиолетовые кристаллы. */
registerPropPainter('f15b_geode', (_o, _t, alive, flash) => {
  if (!alive) return null;
  const s = spr('geode', () => {
    const p = new Px(18, 15);
    ball(p, 9, 8.5, 7, [NIGHT[2], NIGHT[3], NIGHT[5], NIGHT[6]]);
    p.ell(9.5, 8, 4.2, 3.2, VIO[0]);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      const x = 9.5 + Math.cos(a) * 2.4;
      const y = 8 + Math.sin(a) * 1.8;
      poly(p, [[x - 1, y + 1], [9.5 + Math.cos(a) * 0.6, 8 + Math.sin(a) * 0.5], [x + 1, y - 1]], i < 3 ? VIO[4] : VIO[2]);
    }
    p.set(8, 7, WHITE);
    p.set(11, 9, VIO[5]);
    p.outline(INK);
    return { p, ax: 9, ay: 15 };
  });
  return flash ? flashOf(s) : s;
});

/** Лампа: золотая чаша на треноге, в ней — звёздный огонь. */
registerPropPainter('f15b_lamp', (o, time) => {
  const f = Math.floor(time * 8 + o.x * 3) % 6;
  return spr(`lamp|${f}`, () => {
    const p = new Px(14, 26);
    stroke(p, 4, 25, 6, 15, GOLD[1]);
    stroke(p, 10, 25, 8, 15, GOLD[1]);
    stroke(p, 7, 25, 7, 15, GOLD[2]);
    p.rect(3, 13, 11, 14, GOLD[3]);
    p.rect(4, 15, 10, 15, GOLD[1]);
    const h = [7, 8, 9, 8, 7, 6][f];
    const sw = [0, 1, 0, -1, 0, 1][f];
    poly(p, [[3.5, 13], [7 + sw, 13 - h - 2], [10.5, 13]], VIO[3]);
    poly(p, [[4.5, 13], [7 + sw * 0.5, 13 - h], [9.5, 13]], GOLD[4]);
    poly(p, [[5.5, 13], [7, 13 - h * 0.6], [8.5, 13]], WHITE);
    p.outline(fade(INK, 0.8));
    return { p, ax: 7, ay: 26 };
  });
});

/** Мерцание пола: четырёхлучевая звёздочка то разгорается, то гаснет. */
registerPropPainter('f15b_twinkle', (o, time) => {
  const ph = (time / 2.6 + hash(o.x, o.y, 93)) % 1;
  const k = ph < 0.5 ? Math.sin(ph * TAU) : 0;
  const n = Math.round(k * 4);
  return spr(`tw|${n}`, () => {
    const p = new Px(11, 11);
    if (n > 0) {
      for (let i = 1; i <= n; i++) {
        const c = i === n ? ICE[3] : i > 2 ? ICE[5] : WHITE;
        p.set(5 + i, 5, c);
        p.set(5 - i, 5, c);
        p.set(5, 5 + i, c);
        p.set(5, 5 - i, c);
      }
      if (n > 2) for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) p.set(5 + dx, 5 + dy, fade(GOLD[4], 0.7));
      p.set(5, 5, WHITE);
    } else p.set(5, 5, fade(ICE[3], 0.5));
    return { p, ax: 5, ay: 13 };
  });
});

/** Шпиль: друза из трёх голубых кристаллов. */
registerPropPainter('f15b_spire', (o) => {
  const v = Math.floor(hash(o.x, o.y, 94) * 3);
  return spr(`spire|${v}`, () => {
    const p = new Px(18, 32);
    const prism = (x: number, h: number, w: number) => {
      const top = 31 - h;
      poly(p, [[x - w, 31], [x - w, top + w], [x, top], [x + w, top + w], [x + w, 31]], (px, py) =>
        px < x - w * 0.35 ? ICE[4] : px < x + 0.5 ? (py < top + w + 2 ? ICE[6] : ICE[3]) : ICE[2],
      );
    };
    prism(5, 14 + v * 2, 2.4);
    prism(13, 12 + (2 - v) * 2, 2.2);
    prism(9, 24 + v, 3);
    p.outline(fade(INK, 0.85));
    return { p, ax: 9, ay: 32 };
  });
});

/** Реликвии пяти владык в нишах Зала; шестая ниша — его. */
const RELICS: Record<string, (p: Px) => void> = {
  // Корона Короля крыс на фиолетовой подушке.
  crown: (p) => {
    p.ell(8, 13, 5, 1.6, VIO[2]);
    p.rect(4, 9, 12, 11, GOLD[3]);
    p.rect(4, 11, 12, 11, GOLD[1]);
    for (const x of [4, 8, 12]) poly(p, [[x - 1.5, 9.5], [x, 5], [x + 1.5, 9.5]], x < 8 ? GOLD[4] : GOLD[3]);
    p.set(8, 10, hx('#e0405a'));
    p.set(5, 10, ICE[4]);
    p.set(11, 10, ICE[4]);
  },
  // Секира Минотавра стоит торчком.
  axe: (p) => {
    stroke(p, 8, 14, 8, 2, GOLD[1]);
    poly(p, [[8, 3], [3, 1.5], [2.5, 7.5], [8, 6]], (x) => (x < 5 ? ICE[4] : ICE[3]));
    poly(p, [[8, 3], [13, 1.5], [13.5, 7.5], [8, 6]], (x) => (x > 11 ? ICE[2] : ICE[3]));
    p.set(8, 4, GOLD[4]);
  },
  // Чешуя Красного змея — щиток с гребнями.
  skull: (p) => {
    poly(p, [[8, 2], [13, 7], [8, 14], [3, 7]], (x, y) => (x + y < 14 ? hx('#ee6a3a') : hx('#a83a2a')));
    for (let i = 0; i < 3; i++) stroke(p, 5 + i * 1.5, 6 + i * 2, 11 - i * 1.5, 6 + i * 2, hx('#ffb070'));
    p.set(7, 4, GOLD[5]);
  },
  // Гидра: три шеи из нефрита.
  hydra: (p) => {
    p.ell(8, 13, 4, 1.6, BOG[2]);
    for (const [x, y] of [[4, 5], [8, 3], [12, 5]] as [number, number][]) {
      stroke(p, 8, 12, x, y + 1, BOG[3], 2);
      p.ell(x, y, 1.6, 1.3, BOG[4]);
      p.set(x - 0.5, y - 0.5, BOG[5]);
    }
  },
  // Меч Короля демонов остриём в подставке.
  sword: (p) => {
    p.rect(5, 12, 11, 14, NIGHT[5]);
    stroke(p, 8, 12, 8, 4, VIO[3], 2);
    stroke(p, 7.5, 11, 7.5, 5, VIO[5]);
    p.rect(5, 3, 11, 3, GOLD[3]);
    p.rect(7, 0, 9, 2, GOLD[2]);
    p.set(8, 7, hx('#ff5aa0'));
  },
};
for (const k of ['crown', 'axe', 'skull', 'hydra', 'sword', 'empty'])
  registerPropPainter(`f15b_relic_${k}`, (_o, time) => {
    const s = paintSim();
    const won = !!s && (s.beaten || s.boss?.state === 'won');
    const glow = Math.floor(time * 2) % 4;
    const key = `relic|${k}|${k === 'empty' ? (won ? 1 : 0) : 0}|${glow}`;
    return spr(key, () => {
      const p = new Px(16, 17);
      const gl = [0.18, 0.26, 0.32, 0.26][glow];
      // Свет в глубине ниши и пьедестал.
      p.ell(8, 9, 6, 6, fade(k === 'empty' ? (won ? GOLD[4] : ICE[3]) : VIO[3], gl));
      p.rect(4, 15, 12, 16, GOLD[2]);
      p.rect(4, 15, 12, 15, GOLD[4]);
      const draw = RELICS[k];
      if (draw) draw(p);
      else if (won) {
        // Сердце звезды на своём месте.
        star8(p, 8, 8, 6, Math.PI / 8, GOLD[5], GOLD[3], WHITE);
      } else {
        // Пусто: тонкий холодный круг ожидания.
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * TAU;
          if ((i + glow) % 4 !== 0) p.set(8 + Math.cos(a) * 4, 9 + Math.sin(a) * 4, ICE[4]);
        }
      }
      p.outline(fade(INK, 0.7));
      return { p, ax: 8, ay: 17 };
    });
  });

// =============================================================================
// Хозяин подземелья: поза по режиму мозга (ключевые кадры, 24 к/с).
// =============================================================================

const LW = 104;
const LH = 112;
const LAX = 52;
const LAY = 106;
/** Ракурс: горизонтальные круги тела сжаты вдвое (камера ~27° над землёй). */
const KF = 0.5;
const VY = 0.894;
const VZ = 0.447;
/** Высоты в кадре над землёй (без парения): кромка, плечи, ядро. */
const HEM = 8;
const SHO = 44;
const CORE = 59;
/** Обычное парение и плечо (половина ширины плеч). */
const HOVER = 5;
const SH_R = 10.5;
const ARM = 13;
const DIRS = 32;

/** Жест кисти: 0 — спрятана в плаще, 1 — свободна, 2 — ладонь, 3 — кулак, 4 — указ, 5 — когти. */
type Gest = 0 | 1 | 2 | 3 | 4 | 5;
/** Кисть: вперёд, вправо, вверх (пиксели тела), жест. */
type HK = [number, number, number, Gest];
type Num = 'flare' | 'open' | 'lean' | 'hover' | 'eyes' | 'core' | 'gl' | 'gr' | 'ball';
const NUMS: Num[] = ['flare', 'open', 'lean', 'hover', 'eyes', 'core', 'gl', 'gr', 'ball'];
const NDEF: Record<Num, number> = { flare: 0, open: 0, lean: 0, hover: 0, eyes: 1, core: 1, gl: 0, gr: 0, ball: 0 };
type Ease = 'in' | 'out' | 'io' | 'lin';
const EASE: Record<Ease, (t: number) => number> = { in: eIn, out: eOut, io: smooth, lin: clamp01 };

interface KFi extends Partial<Record<Num, number>> {
  t: number;
  L?: HK;
  R?: HK;
  /** Как идёт отрезок, что КОНЧАЕТСЯ этим ключом. */
  e?: Ease;
}
interface KFull extends Record<Num, number> {
  t: number;
  L: HK;
  R: HK;
  e: Ease;
}

const REST_L: HK = [6, -18, 31, 1];
const REST_R: HK = [6, 18, 31, 1];
const HID_L: HK = [6, -5, 26, 0];
const HID_R: HK = [6, 5, 26, 0];
const GLIDE_L: HK = [-4, -17, 33, 1];
const GLIDE_R: HK = [-4, 17, 33, 1];

function track(list: KFi[]): KFull[] {
  const out: KFull[] = [];
  let prev: KFull = { t: 0, L: REST_L, R: REST_R, e: 'io', ...NDEF };
  for (const k of list) {
    const f: KFull = { ...prev, t: k.t, L: k.L ?? prev.L, R: k.R ?? prev.R, e: k.e ?? 'io' };
    for (const n of NUMS) if (k[n] !== undefined) f[n] = k[n] as number;
    out.push(f);
    prev = f;
  }
  return out;
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const lerpH = (a: HK, b: HK, k: number): HK => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k), k < 0.5 ? a[3] : b[3]];

/** Поза дорожки в момент `t` (после последнего ключа — последний). */
function sample(tr: KFull[], t: number): KFull {
  if (t <= tr[0].t) return tr[0];
  for (let i = 0; i + 1 < tr.length; i++) {
    const a = tr[i];
    const b = tr[i + 1];
    if (t >= b.t) continue;
    const k = EASE[b.e]((t - a.t) / Math.max(1e-6, b.t - a.t));
    const o: KFull = { t, L: lerpH(a.L, b.L, k), R: lerpH(a.R, b.R, k), e: 'lin', ...NDEF };
    for (const n of NUMS) o[n] = lerp(a[n], b[n], k);
    return o;
  }
  return tr[tr.length - 1];
}
/** Смесь двух поз. */
function blend(a: KFull, b: KFull, k: number): KFull {
  const o: KFull = { t: a.t, L: lerpH(a.L, b.L, k), R: lerpH(a.R, b.R, k), e: 'lin', ...NDEF };
  for (const n of NUMS) o[n] = lerp(a[n], b[n], k);
  return o;
}

const L_ = LORD;

const T_PALM = track([
  { t: 0, L: REST_L, R: REST_R },
  { t: 0.55, L: [10, -10, 34, 1], R: [-3, 9, 60, 2], lean: -0.06, gr: 0.6, eyes: 1.3, flare: 0.1, hover: 2, e: 'out' },
  { t: 0.78, R: [-5, 9, 63, 2], gr: 1, eyes: 1.8, lean: -0.09, hover: 3 },
  { t: L_.palmWarn, R: [15, 5, 17, 2], hover: 0, e: 'in' },
]);
const T_PALM_R = track([
  { t: 0, L: [8, -12, 30, 1], R: [15, 5, 17, 2], lean: 0.14, gr: 1, eyes: 1.6, flare: -0.35, core: 1.5 },
  { t: 0.3, R: [15, 6, 19, 2], gr: 0.5, lean: 0.1, flare: -0.15, e: 'out' },
  { t: 0.75, R: [14, 8, 26, 1], gr: 0, lean: 0.03, eyes: 1.1, flare: 0, core: 1.3 },
  { t: L_.palmOpen, L: REST_L, R: REST_R, lean: 0, eyes: 1, core: 1 },
]);
const T_SWEEP = track([
  { t: 0, L: REST_L, R: REST_R },
  { t: 0.5, L: [9, -8, 36, 1], R: [-6, 24, 50, 2], lean: -0.05, gr: 0.7, eyes: 1.4, e: 'out' },
  { t: 0.64, R: [-8, 25, 52, 2], gr: 1, eyes: 1.8 },
  { t: L_.sweepWarn, R: [10, 24, 44, 2], e: 'in' },
]);
const T_SWEEP_R = track([
  { t: 0, L: [9, -8, 36, 1], R: [22, 0, 32, 2], lean: 0.1, gr: 1, flare: -0.25, eyes: 1.6 },
  { t: 0.08, R: [12, -20, 30, 2], lean: 0.08, e: 'out' },
  { t: 0.35, R: [4, -14, 28, 1], gr: 0.2, flare: 0 },
  { t: 0.75, L: REST_L, R: REST_R, lean: 0, gr: 0, eyes: 1 },
]);
const RW = L_.repelWarn;
const RS = L_.repelStep;
const T_REPEL = track([
  { t: 0, L: REST_L, R: REST_R },
  { t: RW - 0.35, L: [10, -3, 40, 2], R: [10, 3, 40, 2], flare: -0.45, ball: 0.7, gl: 0.6, gr: 0.6, eyes: 1.5, e: 'out' },
  { t: RW - 0.05, L: [11, -2.5, 41, 2], R: [11, 2.5, 41, 2], ball: 1, gl: 1, gr: 1, eyes: 1.9, hover: 2 },
  { t: RW, L: [5, -30, 42, 2], R: [5, 30, 42, 2], flare: 0.85, ball: 0, eyes: 2, hover: 0, e: 'lin' },
  { t: RW + RS - 0.05, L: [5, -22, 38, 2], R: [5, 22, 38, 2], flare: 0.7, e: 'out' },
  { t: RW + RS, L: [5, -24, 39, 2], R: [5, 24, 39, 2], flare: 0.95, e: 'lin' },
  { t: RW + 2 * RS - 0.05, L: [5, -22, 38, 2], R: [5, 22, 38, 2], flare: 0.75, e: 'out' },
  { t: RW + 2 * RS, L: [5, -24, 39, 2], R: [5, 24, 39, 2], flare: 1, e: 'lin' },
  { t: RW + 0.65, gl: 0.6, gr: 0.6 },
]);
const T_REPEL_R = track([
  { t: 0, L: [5, -24, 39, 2], R: [5, 24, 39, 2], flare: 1, gl: 0.6, gr: 0.6, eyes: 1.6 },
  { t: 0.5, L: REST_L, R: REST_R, flare: 0, gl: 0, gr: 0, eyes: 1 },
]);
const T_WELL = track([
  { t: 0, L: REST_L, R: REST_R },
  { t: 0.55, L: [7, -11, 34, 1], R: [6, 7, 61, 3], gr: 0.7, eyes: 1.5, lean: -0.05, hover: 2, e: 'out' },
  { t: L_.wellWarn - 0.06, R: [7, 7, 63, 3], gr: 1, eyes: 1.9, hover: 3 },
  { t: L_.wellWarn, R: [14, 4, 16, 3], hover: 0, e: 'in' },
]);
const T_WELL_R = track([
  { t: 0, L: [7, -11, 34, 1], R: [14, 4, 16, 3], gr: 1, eyes: 1.9, lean: 0.1, flare: -0.3 },
  { t: 0.3, R: [13, 5, 19, 3], gr: 0.7, lean: 0.06, e: 'out' },
  { t: 0.55, L: REST_L, R: REST_R, gr: 0, eyes: 1, lean: 0, flare: 0 },
]);
const T_ORBIT = track([
  { t: 0, L: REST_L, R: REST_R },
  { t: 0.42, L: [6, -9, 32, 1], R: [0, 10, 76, 2], gr: 0.8, eyes: 1.6, hover: 2, e: 'out' },
  { t: 0.62, R: [-3, 9, 78, 2], gr: 1, eyes: 1.9 },
  { t: L_.orbitWarn, R: [17, 6, 54, 2], e: 'in' },
]);
const T_ORBIT_R = track([
  { t: 0, L: [6, -9, 32, 1], R: [23, 4, 36, 2], gr: 1, lean: 0.1, hover: 0, eyes: 1.7 },
  { t: 0.25, R: [18, 3, 30, 1], gr: 0.3, lean: 0.06, e: 'out' },
  { t: 0.6, L: REST_L, R: REST_R, gr: 0, lean: 0, eyes: 1 },
]);
const MW = L_.meteorWarn;
const T_METEOR = track([
  { t: 0, L: REST_L, R: REST_R },
  { t: MW - 0.3, L: [2, -12, 78, 2], R: [2, 12, 78, 2], gl: 0.8, gr: 0.8, eyes: 2, core: 1.6, hover: 4, flare: 0.3, e: 'out' },
  { t: MW, L: [0, -13, 80, 2], R: [0, 13, 80, 2], gl: 1, gr: 1 },
  { t: MW + 0.1, L: [10, -17, 38, 3], R: [10, 17, 38, 3], hover: 0, flare: 0.6, e: 'in' },
  { t: MW + 0.3, L: [8, -17, 32, 2], R: [8, 17, 32, 2], gl: 0.5, gr: 0.5, flare: 0.3, e: 'out' },
]);
const T_METEOR_R = track([
  { t: 0, L: [8, -17, 32, 2], R: [8, 17, 32, 2], gl: 0.5, gr: 0.5, flare: 0.3, eyes: 1.6, core: 1.3 },
  { t: 0.5, L: REST_L, R: REST_R, gl: 0, gr: 0, flare: 0, eyes: 1, core: 1 },
]);
const T_CONDUCT = track([
  { t: 0, L: REST_L, R: REST_R },
  { t: 0.4, L: [4, -12, 54, 2], R: [17, 7, 47, 4], gl: 0.5, gr: 0.8, eyes: 1.5, e: 'out' },
  { t: 0.65, R: [18, 11, 54, 4] },
  { t: 0.82, R: [16, 3, 56, 4] },
  { t: 0.9, R: [21, 3, 36, 4], gr: 1, eyes: 2, e: 'in' },
  { t: 1.2, R: [19, 5, 40, 4], e: 'out' },
  { t: L_.conduct, L: [5, -11, 40, 1], R: [14, 8, 38, 4], gr: 0.4, eyes: 1.2 },
]);
const T_CONDUCT_R = track([
  { t: 0, L: [5, -11, 40, 1], R: [14, 8, 38, 4], gr: 0.4, eyes: 1.2 },
  { t: 0.4, L: REST_L, R: REST_R, gr: 0, eyes: 1 },
]);
const HIDDEN: Omit<KFi, 't'> = { L: HID_L, R: HID_R, flare: -1, eyes: 1.7, core: 0.5, open: 0, gl: 0, gr: 0, hover: 0, lean: 0 };
const T_HIDDEN = track([{ t: 0, ...HIDDEN }]);
const DW = L_.darkWarn;
const T_CLAW = track([
  { t: 0, ...HIDDEN },
  { t: 0.3, R: [-2, 14, 50, 5], flare: -0.5, hover: 3, eyes: 2, gr: 0.6, e: 'out' },
  { t: DW - 0.1, R: [-5, 16, 55, 5], gr: 1 },
  { t: DW, R: [19, -6, 30, 5], lean: 0.12, hover: 0, flare: -0.3, e: 'in' },
  { t: DW + 0.25, R: [13, -14, 27, 5], lean: 0.06, gr: 0.4, e: 'out' },
]);
const T_STARFALL = track([
  { t: 0, ...HIDDEN },
  { t: 0.3, R: [2, 8, 74, 4], flare: -0.5, hover: 3, eyes: 2, gr: 0.7, e: 'out' },
  { t: DW - 0.1, R: [0, 8, 80, 4], gr: 1 },
  { t: DW, R: [21, 4, 32, 4], hover: 0, lean: 0.08, e: 'in' },
  { t: DW + 0.25, R: [18, 5, 30, 4], gr: 0.4, e: 'out' },
]);
/** Из удара во тьме — обратно под плащ. */
const T_CLAW_BACK = track([{ t: 0, R: [13, -14, 27, 5], L: HID_L, flare: -0.3, eyes: 1.8, core: 0.5, gr: 0.4 }, { t: 0.3, ...HIDDEN }]);
const T_STAR_BACK = track([{ t: 0, R: [18, 5, 30, 4], L: HID_L, flare: -0.5, eyes: 1.8, core: 0.5, gr: 0.4 }, { t: 0.3, ...HIDDEN }]);
const CO = L_.cloakOpen;
const T_OPEN = track([
  { t: 0, ...HIDDEN },
  { t: 0.2, L: [2, -24, 47, 2], R: [2, 24, 47, 2], flare: 1, open: 1, core: 2, eyes: 1.3, gl: 0.8, gr: 0.8, hover: 3, e: 'out' },
  { t: 1.2, L: [3, -23, 45, 2], R: [3, 23, 45, 2], flare: 0.9, open: 0.95, core: 1.8, hover: 2 },
  { t: CO - 0.3, L: [2, -24, 47, 2], R: [2, 24, 47, 2], flare: 1, open: 1, core: 2, hover: 3 },
  { t: CO, ...HIDDEN, e: 'in' },
]);
const T_WRAP = track([
  { t: 0, L: REST_L, R: REST_R },
  { t: 0.7, L: [9, 6, 40, 2], R: [9, -6, 41, 2], flare: -0.6, eyes: 1.5 },
  { t: 1.4, L: [8, 5, 42, 2], R: [8, -5, 43, 2], flare: -0.9, eyes: 1.8, core: 0.7 },
  { t: L_.wrap, ...HIDDEN, e: 'in' },
]);
const T_GATHER = track([
  { t: 0, L: REST_L, R: REST_R },
  { t: 1.2, L: [13, -4.5, 42, 2], R: [13, 4.5, 42, 2], ball: 1, gl: 0.7, gr: 0.7, flare: -0.35, eyes: 1.6 },
  { t: 1.5, L: [12, -3.5, 42, 2], R: [12, 3.5, 42, 2], ball: 1.2, eyes: 1.9 },
  { t: 1.6, L: [10, -3, 42, 3], R: [10, 3, 42, 3], ball: 0, flare: 0.5, eyes: 2, core: 1.8, e: 'lin' },
  { t: L_.gather, L: REST_L, R: REST_R, flare: 0, eyes: 1, core: 1, gl: 0, gr: 0 },
]);
const T_MEMORY = track([
  { t: 0, L: REST_L, R: REST_R },
  { t: 0.8, L: [4, -16, 66, 2], R: [4, 16, 66, 2], flare: 0.5, gl: 0.8, gr: 0.8, eyes: 1.8, core: 1.6, hover: 4 },
  { t: 2.0, L: [3, -17, 68, 2], R: [3, 17, 68, 2] },
  { t: L_.memory, L: REST_L, R: REST_R, flare: 0, gl: 0, gr: 0, eyes: 1, core: 1, hover: 0 },
]);
const SLEEP: Omit<KFi, 't'> = { L: HID_L, R: HID_R, flare: -1, eyes: 0, core: 0.25, hover: -2, open: 0 };
const T_SLEEP = track([{ t: 0, ...SLEEP }]);
const T_STIR = track([
  { t: 0, ...SLEEP },
  { t: 0.4, flare: -0.75, eyes: 0, core: 0.4, hover: -1, e: 'out' },
  { t: 0.5, flare: -0.2, eyes: 0.7, core: 1, hover: 1, e: 'in' },
  { t: 0.9, ...SLEEP },
]);
const T_WAKE = track([
  { t: 0, ...SLEEP },
  { t: 0.8, eyes: 0, core: 0.4 },
  { t: 1.0, eyes: 1.4, core: 1.2, e: 'out' },
  { t: 1.5, L: [7, -9, 30, 1], R: [7, 9, 30, 1], flare: -0.5, hover: 2 },
  { t: 1.7, L: [3, -25, 52, 2], R: [3, 25, 52, 2], flare: 1, open: 0.6, eyes: 2, core: 2, gl: 1, gr: 1, hover: 6, e: 'in' },
  { t: 2.0, L: [3, -26, 54, 2], R: [3, 26, 54, 2], flare: 1, hover: 7, e: 'out' },
  { t: 2.8, L: [5, -20, 44, 2], R: [5, 20, 44, 2], flare: 0.4, open: 0.2, core: 1.4, eyes: 1.4, gl: 0.4, gr: 0.4, hover: 3 },
  { t: L_.wake, L: REST_L, R: REST_R, flare: 0, open: 0, core: 1, eyes: 1, gl: 0, gr: 0, hover: 0 },
]);
const NV = L_.nova;
const T_NOVA = track([
  { t: 0, L: GLIDE_L, R: GLIDE_R, lean: 0.1, flare: -0.3 },
  { t: NV - 1.4, lean: 0.06 },
  { t: NV - 0.8, L: [6, -12, 40, 2], R: [6, 12, 40, 2], lean: 0, flare: -0.5, ball: 0.8, gl: 0.8, gr: 0.8, eyes: 1.8, core: 1.6 },
  { t: NV - 0.6, L: [1, -27, 52, 2], R: [1, 27, 52, 2], flare: 1, open: 1, core: 2, eyes: 2, ball: 0, gl: 1, gr: 1, hover: 4, e: 'in' },
  { t: NV, L: [1, -26, 50, 2], R: [1, 26, 50, 2], hover: 3, e: 'out' },
]);
const BLAZE: Omit<KFi, 't'> = { L: [1, -26, 50, 2], R: [1, 26, 50, 2], flare: 1, open: 1, core: 2, eyes: 2, gl: 1, gr: 1, hover: 3, lean: 0 };
const T_BEAMS = track([
  { t: 0, ...BLAZE },
  { t: 1, L: [1, -25, 48, 2], R: [1, 25, 48, 2], hover: 2 },
  { t: 2, ...BLAZE },
]);
const PW = L_.pulseWarn;
const PS = L_.pulseStep;
const T_PULSE = track([
  { t: 0, ...BLAZE },
  { t: PW - 0.35, L: [0, -14, 78, 2], R: [0, 14, 78, 2], core: 2.4, hover: 6, e: 'out' },
  { t: PW, L: [2, -27, 50, 2], R: [2, 27, 50, 2], hover: 3, e: 'in' },
  { t: PW + PS - 0.06, L: [2, -25, 52, 2], R: [2, 25, 52, 2] },
  { t: PW + PS, L: [2, -27, 50, 2], R: [2, 27, 50, 2], e: 'in' },
  { t: PW + 2 * PS - 0.06, L: [2, -25, 52, 2], R: [2, 25, 52, 2] },
  { t: PW + 2 * PS, L: [2, -28, 50, 2], R: [2, 28, 50, 2], e: 'in' },
]);
const EX = L_.exhale;
const T_EXHALE = track([
  { t: 0, L: [2, -28, 50, 2], R: [2, 28, 50, 2], flare: 1, open: 1, core: 2, eyes: 2, gl: 1, gr: 1, hover: 3 },
  { t: 0.6, L: [5, -15, 26, 1], R: [5, 15, 26, 1], flare: 0.15, open: 0.35, core: 0.5, eyes: 0.8, gl: 0, gr: 0, hover: -1 },
  { t: EX - 0.5, L: [5, -14, 25, 1], R: [5, 14, 25, 1], core: 0.6 },
  { t: EX, ...BLAZE },
]);
const DIE = 2.6;
const T_DIE = track([
  { t: 0, L: [4, -22, 50, 2], R: [4, 22, 50, 2], flare: 1, open: 0.8, core: 2, eyes: 2, gl: 1, gr: 1, hover: 4, lean: -0.08 },
  { t: 0.35, L: [2, -24, 58, 2], R: [2, 24, 58, 2], hover: 7, lean: -0.12, e: 'out' },
  { t: 1.4, L: [4, -18, 54, 2], R: [4, 18, 54, 2], flare: 0.6, open: 0.4, hover: 8, gl: 0.6, gr: 0.6 },
  { t: 2.0, L: [6, -10, 52, 0], R: [6, 10, 52, 0], core: 2.4, eyes: 2, gl: 0, gr: 0, hover: 9 },
  { t: DIE, core: 3, hover: 10 },
]);
const T_IDLE = track([{ t: 0, L: REST_L, R: REST_R }]);
const T_GLIDE = track([{ t: 0, L: GLIDE_L, R: GLIDE_R, lean: 0.12, flare: -0.3 }]);

/** Отдых после приёма `act` — его дорожка. */
const RECOVER: Record<number, KFull[]> = {
  1: T_PALM_R,
  2: T_SWEEP_R,
  3: T_REPEL_R,
  4: T_WELL_R,
  5: T_ORBIT_R,
  6: T_METEOR_R,
  7: T_CONDUCT_R,
};
const MODE_TRACK: Record<string, KFull[]> = {
  f15l_palm: T_PALM,
  f15l_sweep: T_SWEEP,
  f15l_repel: T_REPEL,
  f15l_well: T_WELL,
  f15l_orbit: T_ORBIT,
  f15l_meteor: T_METEOR,
  f15l_conduct: T_CONDUCT,
  f15l_open: T_OPEN,
  f15l_wrap: T_WRAP,
  f15l_gather: T_GATHER,
  f15l_memory: T_MEMORY,
  f15l_stir: T_STIR,
  f15l_wake: T_WAKE,
  f15l_nova: T_NOVA,
};

/** Поза владыки этого кадра: ключ геометрии и все числа. */
interface LPose extends KFull {
  key: string;
  train: number;
  sway: number;
  alpha: number;
  dissolve: number;
  shrink: number;
  /** Звёзды и кромка во тьме затмения тусклее. */
  dim: number;
  tint: number;
  ph: number;
}

const fr24 = (t: number) => Math.max(0, Math.floor(t * 24));

function lordPose(m: Mob, pose: MobPose, now: number): LPose {
  const s = paintSim();
  const v = f15bView(s);
  const T = pose.mode === 'dying' ? pose.t : m.t;
  const ph = Math.floor(now * 5) % 10;
  const sp = Math.hypot(m.vx, m.vy);
  const spQ = Math.round(clamp01(sp / 3.1) * 2) / 2;
  let key = '';
  let k: KFull;
  let alpha = 1;
  let dissolve = 0;
  let shrink = 0;
  let dim = 1;
  let tint = -1;
  const mode = pose.mode;
  const at = (tr: KFull[], name: string, t: number, cap = 1e9) => {
    const f = Math.min(fr24(t), cap);
    key = `${name}${f}`;
    return sample(tr, f / 24);
  };
  if (mode === 'dying') {
    k = at(T_DIE, 'die', T);
    dissolve = clamp01((T - 0.35) / 1.4);
    shrink = clamp01((T - 1.9) / 0.6);
  } else if (mode === 'f15l_sleep') {
    k = T_SLEEP[0];
    key = 'sleep';
    alpha = 0.4 + 0.08 * Math.sin(now * 1.6);
  } else if (mode === 'f15l_stir') {
    k = at(T_STIR, 'stir', T);
    alpha = 0.5 + 0.2 * Math.sin(clamp01(T / 0.9) * Math.PI);
  } else if (mode === 'f15l_wake') {
    k = at(T_WAKE, 'wake', T);
    alpha = 0.45 + 0.55 * smooth(T / 1.7);
  } else if (mode === 'f15l_dstrike') {
    k = m.data.kind ? at(T_STARFALL, 'sf', T, fr24(DW + 0.25)) : at(T_CLAW, 'cl', T, fr24(DW + 0.25));
    dim = 0.45;
  } else if (mode === 'f15l_dark') {
    const act = m.data.act ?? 0;
    if (act === 8 && T < 0.3) k = m.data.kind ? at(T_STAR_BACK, 'sb', T) : at(T_CLAW_BACK, 'cb', T);
    else {
      k = T_HIDDEN[0];
      key = 'hid';
    }
    dim = 0.35;
  } else if (mode === 'f15l_core') {
    const nv = v?.nova;
    const t = s && nv ? s.time - nv.at : 0;
    if (nv?.stage === 'pulse') k = at(T_PULSE, 'pu', t, fr24(PW + 2 * PS + 0.3));
    else if (nv?.stage === 'exhale') k = at(T_EXHALE, 'ex', t, fr24(EX));
    else {
      // Лучи: дыхание по кругу 2 с, 12 кадров.
      const f = Math.floor(now * 6) % 12;
      key = `bm${f}`;
      k = sample(T_BEAMS, f / 6);
    }
  } else if (MODE_TRACK[mode]) {
    const tr = MODE_TRACK[mode];
    k = at(tr, mode.slice(5, 9), T, fr24(tr[tr.length - 1].t + 0.05));
    if (mode === 'f15l_memory') tint = Math.floor(now * 4) % 4;
    if (mode === 'f15l_wrap' || mode === 'f15l_open') dim = mode === 'f15l_open' ? 1 : 0.6;
  } else if (mode === 'recover' && RECOVER[m.data.act ?? 0]) {
    const tr = RECOVER[m.data.act ?? 0];
    k = at(tr, `r${m.data.act}`, T, fr24(tr[tr.length - 1].t + 0.05));
  } else {
    // Погоня: покой дышит, на ходу — плащ тянется назад.
    const b = ph;
    const sb = Math.sin((b / 10) * TAU);
    const idle = { ...T_IDLE[0], L: [6, -18, 31 + sb, 1] as HK, R: [6, 18, 31 - sb, 1] as HK, flare: 0.04 * sb };
    k = blend(idle, T_GLIDE[0], spQ);
    key = `ch${spQ}|${b}`;
  }
  // Затмение: плащ запахнут, тьма — звёзды на нём еле видны.
  if (v && v.dark > 0.5 && mode !== 'f15l_open') dim = Math.min(dim, 0.45);
  const turnV = m.data.turnV ?? 0;
  const sway = Math.round(Math.max(-1, Math.min(1, -turnV / 3.2)) * 2) / 2;
  return {
    ...k,
    key,
    train: mode === 'f15l_sleep' || mode === 'f15l_core' ? 0 : spQ,
    sway,
    alpha,
    dissolve,
    shrink,
    dim,
    tint,
    ph,
  };
}

// =============================================================================
// Хозяин подземелья: геометрия кадра (точки с буфером глубины).
// =============================================================================

/** Радиус колокола на высоте `z` при раскрытии `fl` (−1 запахнут … 1 распахнут). */
function bellR(z: number, fl: number): number {
  const rh = 20 + fl * 6;
  const rs = 10.5 + Math.max(0, fl) * 1.5;
  const pw = 1.6 - fl * 0.45;
  return rs + (rh - rs) * Math.pow(clamp01((SHO - z) / (SHO - HEM)), pw);
}
/** Половина распаха спереди, рад. */
function openHalf(z: number, fl: number, open: number): number {
  const tz = clamp01((z - HEM) / (SHO - HEM));
  return (0.09 + 0.3 * (1 - tz)) * (1 - 0.85 * Math.max(0, -fl)) + open * (0.8 + 0.6 * (1 - tz));
}
/** Высота кромки под углом ψ (мир) — живая волна. */
function hemZ(psi: number, ph: number, fl: number): number {
  const p = (ph / 10) * TAU;
  const k = fl < -0.5 ? 0.5 : 1;
  return HEM + k * (1.5 * Math.sin(3 * psi + p) + 0.9 * Math.sin(5 * psi - 2 * p));
}

interface HandOut {
  x: number;
  y: number;
  ang: number;
  g: Gest;
  vis: boolean;
  side: number;
  depth: number;
}
interface LGeo {
  /** Неизменные пиксели: номер и цвет (RGBA в одном числе). */
  sIdx: Uint16Array;
  sCol: Uint32Array;
  /** Ткань: номер пикселя, угол (0…255), высота ×2, свет (0…255, старший бит — колокол). */
  cIdx: Uint16Array;
  cU: Uint8Array;
  cV: Uint8Array;
  cS: Uint8Array;
  hands: HandOut[];
}

const LGEO = frameLRU<LGeo>(380);
/** Плащ без рук: непустые пиксели с глубиной — общий для всех кадров с той же тканью. */
interface Cloak {
  idx: Uint16Array;
  z: Float32Array;
  k: Uint8Array;
  u: Uint8Array;
  v: Uint8Array;
  s: Uint8Array;
  c: Uint32Array;
}
const CLOAK = frameLRU<Cloak>(200);
const pack = (c: RGBA) => ((c[3] << 24) | (c[2] << 16) | (c[1] << 8) | c[0]) >>> 0;

/** Свет: слева-сверху-спереди. */
const LXv = -0.5;
const LYv = 0.45;
const LZv = 0.74;

function buildLord(a: number, p: LPose, cloakKey: string): LGeo {
  const N = LW * LH;
  const zb = new Float32Array(N).fill(-1e9);
  // 0 пусто, 1 ткань (туманность), 2 ткань колокола, 3 неизменный цвет.
  const kind = new Uint8Array(N);
  const tu = new Uint8Array(N);
  const tv = new Uint8Array(N);
  const ts = new Uint8Array(N);
  const col = new Uint32Array(N);
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const fl = p.flare;
  const lean = p.lean;
  const lx = (z: number) => lean * Math.max(0, z - HEM) * 0.6;
  const put = (X: number, Y: number, d: number, k: number, u: number, v: number, s: number, c = 0) => {
    const x = Math.round(X);
    const y = Math.round(Y);
    if (x < 0 || y < 0 || x >= LW || y >= LH) return;
    const i = y * LW + x;
    if (d <= zb[i]) return;
    zb[i] = d;
    kind[i] = k;
    tu[i] = u;
    tv[i] = v;
    ts[i] = s;
    col[i] = c;
  };
  const shadeOf = (nx: number, ny: number, nz: number) => {
    const n = Math.hypot(nx, ny, nz) || 1;
    return clamp01(((nx * LXv + ny * LYv + nz * LZv) / n) * 0.62 + 0.42);
  };
  const uByte = (u: number) => Math.round((((u / TAU) % 1) + 1) * 256) & 255;
  const dz = p.dissolve > 0 ? HEM - 3 + (SHO + 6 - HEM) * p.dissolve : -1e9;
  const cl = CLOAK.get(cloakKey);
  if (cl) {
    for (let j = 0; j < cl.idx.length; j++) {
      const i = cl.idx[j];
      zb[i] = cl.z[j];
      kind[i] = cl.k[j];
      tu[i] = cl.u[j];
      tv[i] = cl.v[j];
      ts[i] = cl.s[j];
      col[i] = cl.c[j];
    }
  } else {
    // --- Колокол плаща.
    for (let z = HEM - 3; z <= SHO; z += 0.5) {
      const R = bellR(z, fl);
      const dR = bellR(z - 0.5, fl) - bellR(z + 0.5, fl);
      const op = openHalf(z, fl, p.open);
      const trim = 1.6 / R;
      const n = Math.ceil((TAU * R) / 0.5);
      const ox = lx(z) * ca;
      const oy = lx(z) * sa;
      for (let i = 0; i < n; i++) {
        const psi = (i / n) * TAU;
        if (z < hemZ(psi, p.ph, fl)) continue;
        const cx = Math.cos(psi);
        const sy = Math.sin(psi);
        const wx = ox + cx * R;
        const wy = oy + sy * R;
        const X = LAX + wx;
        const Y = LAY - z + wy * KF;
        if (z < dz + (hash(Math.round(X), Math.round(Y), 7) - 0.5) * 6) continue;
        let u = psi - a;
        u -= Math.round(u / TAU) * TAU;
        const front = sy * VY + dR * VZ > 0;
        const depth = wy * VY + z * VZ;
        if (front) {
          if (Math.abs(u) < op) continue;
          if (Math.abs(u) < op + trim) {
            const s = shadeOf(cx, sy, dR);
            put(X, Y, depth, 3, 0, 0, 0, pack(s > 0.75 ? GOLD[4] : s > 0.5 ? GOLD[3] : GOLD[2]));
            continue;
          }
          put(X, Y, depth, 2, uByte(u), Math.min(255, Math.round(z * 2)), Math.round(shadeOf(cx, sy, dR) * 255));
        } else {
          // Изнанка: видна в распахе и под кромкой — бездна со светом изнутри.
          const k = clamp01(1 - Math.abs(cx));
          let c = mixc(NIGHT[1], VIO[1], 0.2 + 0.5 * k);
          if (p.open > 0.05) {
            c = mixc(c, VIO[3], k * k * p.open * 0.75);
            if (k > 0.72) c = mixc(c, k > 0.9 ? WHITE : GOLD[5], (k - 0.72) * 3.2 * p.open);
          }
          const hs = hash(Math.round(X), Math.round(Y), 9);
          if (hs < 0.012) c = WHITE;
          else if (hs < 0.05) c = mixc(c, hs < 0.03 ? ICE[5] : GOLD[5], 0.75);
          else if (hs < 0.09) c = mixc(c, MAG[2], 0.35);
          put(X, Y, depth - 0.01, 3, 0, 0, 0, pack(c));
        }
      }
    }
    // Плечи сверху: купол-пелерина.
    {
      const R = bellR(SHO, fl);
      const ox = lx(SHO) * ca;
      const oy = lx(SHO) * sa;
      for (let rr = 0; rr <= R; rr += 0.5) {
        const n = Math.max(6, Math.ceil((TAU * rr) / 0.5));
        const z = SHO + (1 - rr / R) * 2.5;
        for (let i = 0; i < n; i++) {
          const psi = (i / n) * TAU;
          const wx = ox + Math.cos(psi) * rr;
          const wy = oy + Math.sin(psi) * rr;
          let u = psi - a;
          u -= Math.round(u / TAU) * TAU;
          const X = LAX + wx;
          const Y = LAY - z + wy * KF;
          if (p.dissolve > 0.95) continue;
          put(X, Y, wy * VY + z * VZ, 2, uByte(u), Math.round(z * 2), Math.round(shadeOf(Math.cos(psi) * 0.5, Math.sin(psi) * 0.5, 1) * 255));
        }
      }
    }
    // --- Пелерина: короткий колокол поверх плеч, кромка зубцами, кайма золотом.
    if (p.dissolve < 0.9) {
      const top = SHO + 1.5;
      for (let z = SHO - 14; z <= top; z += 0.5) {
        const R = bellR(Math.min(z, SHO), fl) + 2.4 + (top - z) * 0.08;
        const n = Math.ceil((TAU * R) / 0.5);
        const ox = lx(z) * ca;
        const oy = lx(z) * sa;
        for (let i = 0; i < n; i++) {
          const psi = (i / n) * TAU;
          let u = psi - a;
          u -= Math.round(u / TAU) * TAU;
          const zc = SHO - 13 + 2.6 * Math.abs(Math.sin(3.5 * u));
          if (z < zc) continue;
          if (Math.abs(u) < 0.95) continue;
          const cx = Math.cos(psi);
          const sy = Math.sin(psi);
          const wx = ox + cx * R;
          const wy = oy + sy * R;
          const X = LAX + wx;
          const Y = LAY - z + wy * KF;
          if (z < dz + (hash(Math.round(X), Math.round(Y), 7) - 0.5) * 6) continue;
          const front = sy * VY + 0.35 * VZ > 0;
          if (!front) continue;
          const depth = wy * VY + z * VZ + 0.6;
          const s = shadeOf(cx, sy, 0.45);
          if (z < zc + 1.2 || Math.abs(u) < 1.05) {
            put(X, Y, depth, 3, 0, 0, 0, pack(s > 0.72 ? GOLD[5] : s > 0.5 ? GOLD[4] : s > 0.3 ? GOLD[3] : GOLD[2]));
            continue;
          }
          put(X, Y, depth, 2, uByte(u + 1.7), Math.min(255, Math.round(z * 2 + 40)), Math.round(clamp01(s + 0.08) * 255));
        }
      }
    }
    // --- Шлейф: лента от задней кромки, тянется назад и вбок на развороте.
    if (p.train > 0.05 && p.dissolve < 0.2) {
      const Lt = 4 + p.train * 18;
      const R0 = bellR(HEM + 2, fl) * 0.85;
      const bx = -ca;
      const by = -sa;
      const px = -sa;
      const py = ca;
      for (let s = 0; s <= 1; s += 1 / (Lt * 1.6)) {
        const w = (1 - s) * 7 + 1.5;
        const sw = p.sway * s * s * 9;
        const cx0 = bx * (R0 + s * Lt) + px * sw;
        const cy0 = by * (R0 + s * Lt) + py * sw;
        const z = Math.max(1.5, HEM + 1 - s * 7 + Math.sin(s * 9 + p.ph * 0.63) * 0.8);
        for (let q = -1; q <= 1; q += 1 / (w * 1.6)) {
          const wx = cx0 + px * q * w;
          const wy = cy0 + py * q * w;
          const X = LAX + wx;
          const Y = LAY - z + wy * KF;
          put(X, Y, wy * VY + z * VZ, 1, uByte(Math.PI + q * 0.6), Math.min(255, Math.round((z + s * Lt) * 2)), Math.round(clamp01(0.55 - q * 0.25 - s * 0.2) * 255));
        }
      }
    }
    let n = 0;
    for (let i = 0; i < N; i++) if (kind[i]) n++;
    const o: Cloak = { idx: new Uint16Array(n), z: new Float32Array(n), k: new Uint8Array(n), u: new Uint8Array(n), v: new Uint8Array(n), s: new Uint8Array(n), c: new Uint32Array(n) };
    n = 0;
    for (let i = 0; i < N; i++) {
      if (!kind[i]) continue;
      o.idx[n] = i;
      o.z[n] = zb[i];
      o.k[n] = kind[i];
      o.u[n] = tu[i];
      o.v[n] = tv[i];
      o.s[n] = ts[i];
      o.c[n] = col[i];
      n++;
    }
    CLOAK.set(cloakKey, o);
  }
  // --- Рукава: плечо → локоть → запястье (обратная кинематика).
  const P = (f: number, r: number, z: number): [number, number, number] => {
    const ff = f + lx(z);
    const wx = ff * ca - r * sa;
    const wy = ff * sa + r * ca;
    return [LAX + wx, LAY - z + wy * KF, wy * VY + z * VZ];
  };
  const hands: HandOut[] = [];
  for (const side of [-1, 1]) {
    const h = side < 0 ? p.L : p.R;
    if (h[3] === 0 || p.dissolve > 0.7) continue;
    const S: [number, number, number] = [0.5, side * (SH_R - 1.5), SHO - 4.5];
    let H: [number, number, number] = [h[0], h[1], h[2]];
    const dx = H[0] - S[0];
    const dy = H[1] - S[1];
    const dzz = H[2] - S[2];
    let d = Math.hypot(dx, dy, dzz);
    if (d > ARM * 2 - 0.05) {
      const k = (ARM * 2 - 0.05) / d;
      H = [S[0] + dx * k, S[1] + dy * k, S[2] + dzz * k];
      d = ARM * 2 - 0.05;
    }
    const M: [number, number, number] = [(S[0] + H[0]) / 2, (S[1] + H[1]) / 2, (S[2] + H[2]) / 2];
    const hh = Math.sqrt(Math.max(0, ARM * ARM - (d / 2) * (d / 2)));
    // Локоть уходит наружу и вниз, перпендикулярно руке.
    const ax = (H[0] - S[0]) / (d || 1);
    const ay = (H[1] - S[1]) / (d || 1);
    const az = (H[2] - S[2]) / (d || 1);
    let bx = -0.3;
    let by = side;
    let bz = -1;
    const dot = bx * ax + by * ay + bz * az;
    bx -= dot * ax;
    by -= dot * ay;
    bz -= dot * az;
    const bn = Math.hypot(bx, by, bz) || 1;
    const E: [number, number, number] = [M[0] + (bx / bn) * hh, M[1] + (by / bn) * hh, M[2] + (bz / bn) * hh];
    const s2 = P(...S);
    const e2 = P(...E);
    const w2 = P(...H);
    const seg = (A: number[], B: number[], ra: number, rb: number, cuff: boolean) => {
      const x0 = Math.floor(Math.min(A[0] - ra, B[0] - rb)) - 1;
      const x1 = Math.ceil(Math.max(A[0] + ra, B[0] + rb)) + 1;
      const y0 = Math.floor(Math.min(A[1] - ra, B[1] - rb)) - 1;
      const y1 = Math.ceil(Math.max(A[1] + ra, B[1] + rb)) + 1;
      const vx = B[0] - A[0];
      const vy = B[1] - A[1];
      const L2 = vx * vx + vy * vy || 1;
      const Ln = Math.sqrt(L2);
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const t = clamp01(((x + 0.5 - A[0]) * vx + (y + 0.5 - A[1]) * vy) / L2);
          const cx = A[0] + vx * t;
          const cy = A[1] + vy * t;
          const ex = x + 0.5 - cx;
          const ey = y + 0.5 - cy;
          const dd = Math.hypot(ex, ey);
          const r = ra + (rb - ra) * t;
          if (dd > r) continue;
          const bulge = Math.sqrt(Math.max(0, r * r - dd * dd));
          const depth = A[2] + (B[2] - A[2]) * t + bulge * 0.9;
          // Свет по поперечному сдвигу: левый-верхний край светлее.
          const across = (ex * -vy + ey * vx) / Ln / r;
          const s = clamp01(0.5 - across * 0.35 - (ey / r) * 0.25 + bulge / r * 0.2);
          if (dd > r - 0.8) {
            put(x, y, depth - 0.3, 3, 0, 0, 0, pack(INK));
            continue;
          }
          if (cuff && t > 0.86) {
            put(x, y, depth, 3, 0, 0, 0, pack(s > 0.6 ? GOLD[4] : s > 0.35 ? GOLD[3] : GOLD[2]));
            continue;
          }
          put(x, y, depth, 1, (side < 0 ? 40 : 200) + Math.round(t * 30), Math.round(40 + t * 60), Math.round(clamp01(s + 0.14) * 255));
        }
    };
    seg(s2, e2, 2.6, 3.0, false);
    seg(e2, w2, 3.0, 4.4, true);
    const ang = Math.atan2(w2[1] - e2[1], w2[0] - e2[0]);
    const hx0 = w2[0] + Math.cos(ang) * 2.5;
    const hy0 = w2[1] + Math.sin(ang) * 2.5;
    const hi = Math.round(hy0) * LW + Math.round(hx0);
    const vis = hi < 0 || hi >= N || zb[hi] <= w2[2] + 3 || kind[hi] === 3;
    hands.push({ x: hx0, y: hy0, ang, g: h[3], vis, side, depth: w2[2] });
  }
  // --- Контур: тёмно-синий, снаружи фигуры; ткань на правом краю — холодный кант.
  const sIdx: number[] = [];
  const sCol: number[] = [];
  const cIdx: number[] = [];
  const cU: number[] = [];
  const cV: number[] = [];
  const cS: number[] = [];
  const ink = pack(hx('#07061a', 235));
  for (let i = 0; i < N; i++) {
    const k = kind[i];
    const x = i % LW;
    if (!k) {
      const y = (i / LW) | 0;
      if (
        (x > 0 && kind[i - 1]) ||
        (x < LW - 1 && kind[i + 1]) ||
        (y > 0 && kind[i - LW]) ||
        (y < LH - 1 && kind[i + LW])
      ) {
        sIdx.push(i);
        sCol.push(ink);
      }
      continue;
    }
    if (k === 3) {
      sIdx.push(i);
      sCol.push(col[i]);
      continue;
    }
    let s = ts[i];
    if (x < LW - 1 && !kind[i + 1]) s = Math.min(255, s + 70);
    cIdx.push(i);
    cU.push(tu[i]);
    cV.push(tv[i]);
    cS.push((s >> 1) | (k === 2 ? 128 : 0));
  }
  return {
    sIdx: Uint16Array.from(sIdx),
    sCol: Uint32Array.from(sCol),
    cIdx: Uint16Array.from(cIdx),
    cU: Uint8Array.from(cU),
    cV: Uint8Array.from(cV),
    cS: Uint8Array.from(cS),
    hands,
  };
}

// ---- Туманность ткани: бесшовная текстура 64×64 ----------------------------

const NT = 64;
let NEB: Uint8Array | null = null;
/** Шум с периодом `P` клеток решётки по обеим осям. */
function pnoise(x: number, y: number, P: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const m = (n: number) => ((n % P) + P) % P;
  const h = (a: number, b: number) => hash(m(a), m(b), seed);
  const a = h(xi, yi) * (1 - u) + h(xi + 1, yi) * u;
  const b = h(xi, yi + 1) * (1 - u) + h(xi + 1, yi + 1) * u;
  return a * (1 - v) + b * v;
}
/** Плотность (младшие 2 бита — ступень 0…3) и оттенок (старшие — 0…2). */
function nebula(): Uint8Array {
  if (NEB) return NEB;
  const t = new Uint8Array(NT * NT);
  for (let iy = 0; iy < NT; iy++)
    for (let ix = 0; ix < NT; ix++) {
      const x = ix / NT;
      const y = iy / NT;
      const w = pnoise(x * 4, y * 4, 4, 3);
      const w2 = pnoise(x * 4 + 9, y * 4, 4, 4);
      const d = 0.55 * pnoise(x * 4 + w * 1.2, y * 4 + w2 * 1.2, 4, 11) + 0.3 * pnoise(x * 8, y * 8, 8, 12) + 0.15 * pnoise(x * 16, y * 16, 16, 13);
      const dens = clamp01((d - 0.44) * 2.6);
      const hue = pnoise(x * 2, y * 2, 2, 21);
      const ds = Math.min(3, Math.floor(dens * 3.6));
      const hc = hue < 0.45 ? 0 : hue < 0.72 ? 1 : 2;
      t[iy * NT + ix] = ds | (hc << 2);
    }
  NEB = t;
  return t;
}
/** Цвета ткани: свет (6) × плотность (4) × оттенок (3); вторая половина — вспышка. */
let CLOTH: Uint32Array | null = null;
function clothTable(): Uint32Array {
  if (CLOTH) return CLOTH;
  const t = new Uint32Array(6 * 4 * 3 * 2);
  const hues = [VIO[3], MAG[2], TEAL[3]];
  const amt = [0, 0.24, 0.44, 0.66];
  for (let s = 0; s < 6; s++)
    for (let d = 0; d < 4; d++)
      for (let h = 0; h < 3; h++) {
        const c = mixc(NIGHT[1 + s], hues[h], amt[d] * (0.7 + s * 0.08));
        const i = (s * 4 + d) * 3 + h;
        t[i] = pack(c);
        t[72 + i] = pack(mixc(c, WHITE, 0.6));
      }
  CLOTH = t;
  return t;
}

// ---- Холсты кадра: ткань докрашивается каждый кадр ------------------------

interface Slot {
  c: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  id: ImageData;
}
const BODY: Slot[] = [];
const LIT: Slot[] = [];
let bodyI = 0;
let litI = 0;
function slot(pool: Slot[], i: number): Slot {
  if (!pool[i]) {
    const c = document.createElement('canvas');
    c.width = LW;
    c.height = LH;
    const g = c.getContext('2d')!;
    pool[i] = { c, g, id: g.createImageData(LW, LH) };
  }
  return pool[i];
}
const clothMask = new Uint8Array(LW * LH);

/** Тело кадра: неизменное + ткань с туманностью, что течёт вниз. */
function paintBody(geo: LGeo, now: number, flash: boolean, fresh: boolean): HTMLCanvasElement {
  let sl: Slot;
  if (fresh) {
    const c = document.createElement('canvas');
    c.width = LW;
    c.height = LH;
    const g = c.getContext('2d')!;
    sl = { c, g, id: g.createImageData(LW, LH) };
  } else {
    sl = slot(BODY, bodyI);
    bodyI = (bodyI + 1) % 4;
  }
  const d32 = new Uint32Array(sl.id.data.buffer);
  d32.fill(0);
  clothMask.fill(0);
  const neb = nebula();
  const tab = clothTable();
  const fo = flash ? 72 : 0;
  const flow = now * 3.2;
  const swirl = now * 2.2;
  for (let i = 0; i < geo.cIdx.length; i++) {
    const pi = geo.cIdx[i];
    const X = pi % LW;
    const Y = (pi / LW) | 0;
    const sb = geo.cS[i];
    const sh = (sb & 127) / 127;
    if (sb & 128) clothMask[pi] = 1;
    const iu = (((geo.cU[i] >> 2) + Math.floor(swirl)) % NT + NT) % NT;
    const iv = ((Math.floor(geo.cV[i] * 0.45 + flow) % NT) + NT) % NT;
    const n = neb[iv * NT + iu];
    const zz = geo.cV[i] * 0.5;
    const rim = zz < HEM + 5 ? (zz < HEM + 2.5 ? 2 : 1) : 0;
    const si = Math.max(0, Math.min(5, Math.floor(sh * 5.6 + bay(X, Y) - 0.5) + rim));
    const ds = rim ? 3 : Math.max(0, Math.min(3, (n & 3) - (bay(X + 1, Y) < 0.25 ? 1 : 0)));
    d32[pi] = tab[fo + (si * 4 + ds) * 3 + (n >> 2)];
  }
  for (let i = 0; i < geo.sIdx.length; i++) {
    let c = geo.sCol[i];
    if (flash && (c >>> 24) > 200) {
      const r = c & 255;
      const g = (c >> 8) & 255;
      const b = (c >> 16) & 255;
      c = pack([Math.round(r + (255 - r) * 0.6), Math.round(g + (255 - g) * 0.6), Math.round(b + (255 - b) * 0.6), c >>> 24]);
    }
    d32[geo.sIdx[i]] = c;
  }
  sl.g.putImageData(sl.id, 0, 0);
  return sl.c;
}

// ---- Свет владыки: ядро-лицо, воротник, корона, ладони, звёзды плаща -------

const css = (c: RGBA, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${clamp01(a).toFixed(3)})`;
const CORE_R = [8, 6, 4, 2, 1];
const CORE_LRU = frameLRU<HTMLCanvasElement>(220);

/** Ядро-лицо: диск ночи в короне затмения, глаза — две звезды. */
function coreSprite(dir: number, eyes: number, lvl: number, tint: number, rq: number): HTMLCanvasElement {
  const key = `${dir}|${eyes}|${lvl}|${tint}|${rq}`;
  const hit = CORE_LRU.get(key);
  if (hit) return hit;
  const S = 37;
  const C = 18;
  const p = new Px(S, S);
  const Rc = CORE_R[rq];
  const a = (dir * TAU) / DIRS;
  const hot = lvl >= 2;
  const glow = hot ? GOLD : ICE;
  // Корона затмения: мягкое сияние и лучи разной длины.
  p.ell(C - 0.5, C - 0.5, Rc + 3.5, Rc + 3.5, fade(glow[4], 0.1 + lvl * 0.05));
  if (rq <= 2) {
    const nR = 14;
    for (let k = 0; k < nR; k++) {
      const an = (k / nR) * TAU + 0.11 + hash(k, 1, 77) * 0.12;
      const L = (k % 2 ? 2.5 : 5) + lvl * 1.6 + hash(k, 2, 77) * 2.5;
      for (let d = 0; d < L; d += 0.5) {
        const r = Rc + 0.6 + d;
        const al = (1 - d / L) * (0.5 + lvl * 0.13);
        p.set(C - 0.5 + Math.cos(an) * r, C - 0.5 + Math.sin(an) * r, fade(d < 1.5 ? glow[5] : glow[4], al));
      }
    }
  }
  const rim = tint >= 0 ? QCOL[tint] : hot ? GOLD[5] : ICE[5];
  p.ell(C - 0.5, C - 0.5, Rc, Rc, (x, y) => {
    const dx = (x + 0.5 - C + 0.5) / Rc;
    const dy = (y + 0.5 - C + 0.5) / Rc;
    const r = Math.sqrt(dx * dx + dy * dy);
    if (r > 0.84) return -dx * 0.6 - dy * 0.8 > 0.3 ? WHITE : rim;
    if (lvl === 3) return r < 0.4 ? WHITE : r < 0.65 ? GOLD[5] : GOLD[4];
    if (r > 0.7) return hot ? GOLD[2] : ICE[1];
    // Пустота со спиралью галактики.
    const sw = Math.sin(Math.atan2(dy, dx) * 2 - r * 7 + a);
    if (r < 0.22 && lvl >= 1) return hot ? GOLD[3] : NIGHT[6];
    return sw > 0.55 ? NIGHT[4 + lvl] : NIGHT[2 + lvl];
  });
  if (rq <= 1) {
    // Венец через лоб и глаза-звёзды — на лицевой стороне диска.
    for (let k = -12; k <= 12; k++) {
      const az = a + (k / 12) * 1.25;
      if (Math.sin(az) <= 0.05) continue;
      p.set(C + Math.cos(az) * Rc * 0.78 - 0.5, C - Rc * 0.62 + Math.sin(az) * Rc * 0.22 - 0.5, fade(GOLD[4], 0.85));
    }
    for (const o of [-0.42, 0.42]) {
      const az = a + o;
      if (Math.sin(az) < -0.1) continue;
      const ex = Math.round(C + Math.cos(az) * Rc * 0.55 - 0.5);
      const ey = Math.round(C - Rc * 0.08 + Math.sin(az) * Rc * 0.25 - 0.5);
      if (eyes === 0) {
        p.set(ex - 1, ey, fade(ICE[3], 0.7));
        p.set(ex, ey, fade(ICE[4], 0.8));
        p.set(ex + 1, ey, fade(ICE[3], 0.7));
        continue;
      }
      // Звезда глаза: длинный горизонтальный луч, короткий вертикальный.
      const L = eyes + 1;
      const glowC = hot ? GOLD[4] : ICE[4];
      p.set(ex - 1, ey - 1, fade(glowC, 0.35));
      p.set(ex + 1, ey - 1, fade(glowC, 0.35));
      p.set(ex - 1, ey + 1, fade(glowC, 0.35));
      p.set(ex + 1, ey + 1, fade(glowC, 0.35));
      for (let i = 1; i <= L; i++) {
        const c = fade(i === 1 ? (hot ? GOLD[5] : ICE[5]) : glowC, 1 - (i - 1) / (L + 0.5));
        p.set(ex + i, ey, c);
        p.set(ex - i, ey, c);
      }
      p.set(ex, ey - 1, fade(hot ? GOLD[5] : ICE[5], 0.8));
      p.set(ex, ey + 1, fade(hot ? GOLD[5] : ICE[5], 0.8));
      p.set(ex, ey, WHITE);
    }
  }
  return CORE_LRU.set(key, p.canvas());
}

/** Воротник: семь кристальных шипов веером за ядром; задние и передние — раздельно. */
const COLLAR = new Map<number, [HTMLCanvasElement, HTMLCanvasElement]>();
function collarSprites(dir: number): [HTMLCanvasElement, HTMLCanvasElement] {
  const hit = COLLAR.get(dir);
  if (hit) return hit;
  const W = 55;
  const C = 27;
  const back = new Px(W, W);
  const front = new Px(W, W);
  const a = (dir * TAU) / DIRS;
  for (let i = 0; i < 7; i++) {
    const o = -1.65 + (i * 3.3) / 6;
    const an = a + Math.PI + o;
    const len = 9 + (3 - Math.abs(i - 3)) * 2.3;
    const cx = Math.cos(an);
    const cy = Math.sin(an);
    const bz = -6;
    const tz = bz + len * 0.9;
    const bx = C + cx * 6.5;
    const by = C - bz + cy * 6.5 * KF;
    const tx = C + cx * (6.5 + len * 0.5);
    const ty = C - tz + cy * (6.5 + len * 0.5) * KF;
    const vx = tx - bx;
    const vy = ty - by;
    const vn = Math.hypot(vx, vy) || 1;
    const nx = (-vy / vn) * 1.4;
    const ny = (vx / vn) * 1.4;
    const tgt = cy < 0 ? back : front;
    poly(tgt, [[bx + nx, by + ny], [tx, ty], [bx - nx, by - ny]], (x, y) => {
      const t = clamp01(((x - bx) * vx + (y - by) * vy) / (vn * vn));
      const side = (x - bx) * nx + (y - by) * ny > 0;
      return t > 0.7 ? ICE[5] : t > 0.4 ? (side ? GOLD[4] : GOLD[3]) : side ? GOLD[3] : GOLD[2];
    });
  }
  back.outline(fade(INK, 0.7));
  front.outline(fade(INK, 0.7));
  const out: [HTMLCanvasElement, HTMLCanvasElement] = [back.canvas(), front.canvas()];
  COLLAR.set(dir, out);
  return out;
}

/** Пять кристаллов-планет короны. */
const PLANETS: { r: number; t: RGBA[] }[] = [
  { r: 2.6, t: [ICE[1], ICE[3], ICE[4], ICE[6]] },
  { r: 3.0, t: [GOLD[1], GOLD[3], GOLD[4], GOLD[5]] },
  { r: 2.4, t: [VIO[0], VIO[2], VIO[3], VIO[5]] },
  { r: 2.8, t: [TEAL[0], TEAL[2], TEAL[3], ICE[6]] },
  { r: 3.3, t: [NIGHT[5], ICE[4], ICE[5], WHITE] },
];
const PLANET_SPR: HTMLCanvasElement[] = [];
export function planetSprite(i: number): HTMLCanvasElement {
  if (PLANET_SPR[i]) return PLANET_SPR[i];
  const p = new Px(15, 11);
  const pl = PLANETS[i];
  const cx = 7.5;
  const cy = 5.5;
  if (i === 4) for (let k = 0; k < 40; k++) {
    const t = (k / 40) * TAU;
    if (Math.sin(t) < 0) p.set(cx + Math.cos(t) * 6.4, cy + Math.sin(t) * 1.8 - Math.cos(t) * 0.8, GOLD[2]);
  }
  ball(p, cx, cy, pl.r, pl.t);
  // Грань кристалла.
  for (let k = -2; k <= 2; k++) p.set(cx + k * 0.6, cy - pl.r * 0.2 + k * 0.5, fade(pl.t[3], 0.6));
  if (i === 4) for (let k = 0; k < 40; k++) {
    const t = (k / 40) * TAU;
    if (Math.sin(t) >= 0) p.set(cx + Math.cos(t) * 6.4, cy + Math.sin(t) * 1.8 - Math.cos(t) * 0.8, GOLD[4]);
  }
  p.outline(fade(INK, 0.8));
  PLANET_SPR[i] = p.canvas();
  return PLANET_SPR[i];
}

/** Кисть из звёздного света: жест, угол предплечья (16 румбов), сторона. */
const HAND_SPR = new Map<string, HTMLCanvasElement>();
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax;
  const vy = by - ay;
  const t = clamp01(((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy || 1));
  return Math.hypot(ax + vx * t - px, ay + vy * t - py);
}
function handSprite(g: Gest, a16: number, side: number): HTMLCanvasElement {
  const key = `${g}|${a16}|${side}`;
  const hit = HAND_SPR.get(key);
  if (hit) return hit;
  const S = 21;
  const C = 10;
  const p = new Px(S, S);
  const an = (a16 * TAU) / 16;
  const ca = Math.cos(an);
  const sa = Math.sin(an);
  const th = -side;
  const fingers: [number, number, number, number][] = [];
  let palmR = 2.7;
  let palmX = 2;
  if (g === 1) {
    fingers.push([3, -1, 5, -1.4], [3.2, 0, 5.5, 0], [3, 1, 5, 1.3], [1.4, th * 1.8, 2.8, th * 2.6]);
  } else if (g === 2) {
    for (const o of [-0.55, -0.18, 0.18, 0.55]) fingers.push([3, o * 2, 3 + Math.cos(o) * 3.4, o * 2 + Math.sin(o) * 3.4]);
    fingers.push([1.3, th * 1.4, 1.3 + Math.cos(th * 1.25) * 2.6, th * 1.4 + Math.sin(th * 1.25) * 2.6]);
  } else if (g === 3) {
    palmR = 3.1;
  } else if (g === 4) {
    palmR = 2.2;
    fingers.push([2.6, 0, 7, 0]);
  } else if (g === 5) {
    for (const o of [-1.2, -0.4, 0.4, 1.2]) {
      fingers.push([2.8, o, 5, o * 1.5], [5, o * 1.5, 6.6, o * 1.2 + 0.6]);
    }
  }
  for (const f of fingers) for (let q = 0; q < 4; q++) f[q] *= 1.3;
  const tips: [number, number][] = fingers.map((f) => [f[2], f[3]]);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const dx = x + 0.5 - C;
      const dy = y + 0.5 - C;
      const lx = dx * ca + dy * sa;
      const ly = -dx * sa + dy * ca;
      const dp = Math.hypot(lx - palmX, ly) - palmR;
      let df = 9;
      for (const f of fingers) df = Math.min(df, segDist(lx, ly, f[0], f[1], f[2], f[3]) - 0.7);
      const d = Math.min(dp, df);
      if (d > 0) continue;
      let c = d < -0.9 ? WHITE : GOLD[5];
      for (const [tx, ty] of tips) if (Math.hypot(lx - tx, ly - ty) < 0.9) c = g === 5 ? VIO[5] : WHITE;
      if (g === 3 && Math.abs(lx - 3.4) < 0.6 && Math.abs(ly) < 1.8) c = GOLD[4];
      p.set(x, y, c);
    }
  p.outline(fade(ICE[3], 0.9));
  p.outline(fade(ICE[1], 0.45));
  const cv = p.canvas();
  HAND_SPR.set(key, cv);
  return cv;
}

/** Где ядро в кадре (без сдвига кадра): с наклоном и поклоном во сне. */
function corePos(a: number, p: LPose): [number, number] {
  const lean = p.lean * (CORE - HEM) * 0.6;
  const bow = p.eyes < 0.2 && p.core < 0.5 ? 3 : 0;
  const f = lean + bow;
  return [LAX + Math.cos(a) * f, LAY - CORE + bow + Math.sin(a) * f * KF];
}

/** Пять звёзд эха на плаще: (угол от лица, высота). */
const KINDLE: [number, number][] = [
  [-1.15, 34],
  [-0.7, 24],
  [-0.48, 42],
  [0.7, 24],
  [1.15, 34],
];

function paintLit(m: Mob, p: LPose, a: number, dir: number, geo: LGeo, now: number, s: Sim | null, dieT: number): HTMLCanvasElement {
  const v = f15bView(s);
  const sl = slot(LIT, litI);
  litI = (litI + 1) % 4;
  const g = sl.g;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, LW, LH);
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const fl = Math.round(p.flare * 4) / 4;
  const op = Math.round(p.open * 4) / 4;
  const dim = p.dim;
  const lx = (z: number) => p.lean * Math.max(0, z - HEM) * 0.6;
  /** Точка колокола: угол от лица `u`, высота `z` → пиксель и видна ли. */
  const onBell = (u: number, z: number): [number, number, boolean] => {
    const R = bellR(z, fl);
    const dR = bellR(z - 0.5, fl) - bellR(z + 0.5, fl);
    const psi = a + u;
    const cx = Math.cos(psi);
    const sy = Math.sin(psi);
    const X = LAX + lx(z) * ca + cx * R;
    const Y = LAY - z + (lx(z) * sa + sy * R) * KF;
    const vis = sy * VY + dR * VZ > 0.06 && clothMask[Math.round(Y) * LW + Math.round(X)] === 1;
    return [X, Y, vis];
  };
  const ds = p.dissolve;
  // Звёзды плаща текут сверху вниз и уходят в кромку.
  if (ds < 0.9) {
    const span = SHO - HEM - 3;
    for (let i = 0; i < 38; i++) {
      const h1 = hash(i, 1, 501);
      const h2 = hash(i, 2, 501);
      const h3 = hash(i, 3, 501);
      const sp = 2.2 + h2 * 3.6;
      const z = SHO - 2 - (((now * sp + h1 * span * 7) % span) + span) % span;
      let u = h3 * TAU - Math.PI + now * 0.05 * (h2 - 0.5);
      u -= Math.round(u / TAU) * TAU;
      if (Math.abs(u) < openHalf(z, fl, op) + 0.25) continue;
      const [X, Y, vis] = onBell(u, z);
      if (!vis) continue;
      const k = Math.min(1, (z - HEM) / 6, (SHO - z) / 4);
      const tw = 0.55 + 0.45 * Math.sin(now * (2 + h2 * 4) + i * 1.7);
      const al = k * tw * dim;
      if (al <= 0.05) continue;
      const x = Math.round(X - 0.5);
      const y = Math.round(Y - 0.5);
      if (h1 < 0.2) {
        g.fillStyle = css(ICE[5], al * 0.8);
        g.fillRect(x - 1, y, 3, 1);
        g.fillRect(x, y - 1, 1, 3);
        g.fillStyle = css(WHITE, al);
        g.fillRect(x, y, 1, 1);
      } else {
        g.fillStyle = css(h1 < 0.55 ? ICE[4] : h1 < 0.8 ? VIO[4] : GOLD[4], al * 0.85);
        g.fillRect(x, y, 1, 1);
      }
    }
  }
  // Звёзды павших эх: по одной на каждое — горят до конца боя.
  const ph = s?.boss?.phase ?? 0;
  const kindled = !v ? 0 : ph === 0 ? v.echo : 5;
  for (let i = 0; i < kindled && ds < 0.6; i++) {
    const [u, z] = KINDLE[i];
    const [X, Y, vis] = onBell(u, z);
    if (!vis) continue;
    const x = Math.round(X - 0.5);
    const y = Math.round(Y - 0.5);
    const tw = 0.75 + 0.25 * Math.sin(now * 3 + i * 2);
    g.fillStyle = css(GOLD[4], 0.22 * tw);
    g.fillRect(x - 2, y - 2, 5, 5);
    g.fillStyle = css(GOLD[5], 0.9 * tw);
    g.fillRect(x - 2, y, 5, 1);
    g.fillRect(x, y - 2, 1, 5);
    g.fillStyle = css(WHITE, 1);
    g.fillRect(x, y, 1, 1);
  }
  // Кромка — живой космос: огоньки по краю, капли света вниз.
  if (ds < 0.15) {
    const cols = [VIO[3], MAG[2], TEAL[3], GOLD[4]];
    const n = 56;
    for (let k = 0; k < n; k++) {
      const psi = (k / n) * TAU;
      const z = hemZ(psi, p.ph, fl) + 0.5;
      let u = psi - a;
      u -= Math.round(u / TAU) * TAU;
      if (Math.abs(u) < openHalf(z, fl, op)) continue;
      const R = bellR(z, fl);
      const sy = Math.sin(psi);
      if (sy * VY + 0.3 * VZ < 0) continue;
      const X = Math.round(LAX + lx(z) * ca + Math.cos(psi) * R - 0.5);
      const Y = Math.round(LAY - z + (lx(z) * sa + sy * R) * KF - 0.5);
      const c = cols[(k + Math.floor(now * 3)) & 3];
      const fl2 = 0.5 + 0.5 * Math.sin(now * 5 + k * 1.3);
      g.fillStyle = css(c, (0.35 + 0.45 * fl2) * dim);
      g.fillRect(X, Y, 1, 1);
      const hh = hash(k, Math.floor(now * 7), 503);
      if (hh < 0.22) {
        g.fillStyle = css(c, 0.35 * dim);
        g.fillRect(X, Y + 1 + Math.floor(hh * 9), 1, 1);
      }
    }
  }
  // Ядро, воротник, корона.
  const [cx0, cy0] = corePos(a, p);
  const eyesQ = Math.max(0, Math.min(3, Math.round(p.eyes * 1.5)));
  const lvl = Math.max(0, Math.min(3, Math.round(p.core * 1.1)));
  const rq = Math.min(4, Math.floor(p.shrink * 5));
  // Свет между плечами и ядром: голова — пустота со светом.
  if (rq < 4) {
    g.fillStyle = css(lvl >= 2 ? GOLD[4] : ICE[3], 0.18 * Math.min(1, p.core));
    g.fillRect(Math.round(cx0) - 1, Math.round(cy0) + 4, 3, Math.max(0, Math.round(LAY - SHO - 2 - cy0 - 4)));
  }
  const [cb, cf] = collarSprites(dir);
  const collarOn = p.dissolve < 0.95;
  const crownA = (s?.time ?? now) * 1.3;
  const away = (i: number) => !!v && !!v.planets[i] && v.planets[i].stage !== 0;
  const crownK = Math.max(0.35, Math.min(1, p.core)) * (1 - p.shrink);
  const orbR = 19.5 * (1 - p.shrink * 0.85);
  const planet = (front: boolean) => {
    for (let i = 0; i < 5; i++) {
      if (away(i)) continue;
      const an = crownA + (i * TAU) / 5 + p.shrink * 7;
      if (Math.sin(an) >= 0 !== front) continue;
      const img = planetSprite(i);
      g.globalAlpha = crownK;
      g.drawImage(img, Math.round(cx0 + Math.cos(an) * orbR - 7.5), Math.round(cy0 - 1 + Math.sin(an) * 6.2 * (1 - p.shrink * 0.85) - 5.5));
      g.globalAlpha = 1;
    }
  };
  // Орбита короны — тонкий пунктир.
  if (p.shrink < 0.5) {
    g.fillStyle = css(GOLD[3], 0.22 * crownK);
    for (let k = 0; k < 48; k += 2) {
      const t = (k / 48) * TAU + crownA * 0.2;
      g.fillRect(Math.round(cx0 + Math.cos(t) * orbR - 0.5), Math.round(cy0 - 1 + Math.sin(t) * 6.2 - 0.5), 1, 1);
    }
  }
  planet(false);
  if (collarOn) g.drawImage(cb, Math.round(cx0 - 27), Math.round(cy0 - 27));
  const core = coreSprite(dir, eyesQ, lvl, p.tint, rq);
  g.drawImage(core, Math.round(cx0 - 18), Math.round(cy0 - 18));
  if (collarOn) g.drawImage(cf, Math.round(cx0 - 27), Math.round(cy0 - 27));
  planet(true);
  // Удар отбит короной: звон кольцом.
  const pingAge = s && m.data.ping !== undefined ? s.time - m.data.ping : 9;
  if (pingAge >= 0 && pingAge < 0.3) {
    const k = pingAge / 0.3;
    g.strokeStyle = css(k < 0.3 ? WHITE : ICE[4], 1 - k);
    g.lineWidth = 1;
    g.beginPath();
    g.ellipse(cx0, cy0 - 1, orbR + 2 + k * 5, 6 + k * 2, 0, 0, TAU);
    g.stroke();
  }
  // Ладони: свет кисти, шар тяготения между ними.
  for (const h of geo.hands) {
    if (!h.vis) continue;
    const gl = h.side < 0 ? p.gl : p.gr;
    if (gl > 0.05) {
      g.fillStyle = css(h.g === 3 ? VIO[3] : GOLD[4], 0.12 + gl * 0.16);
      g.beginPath();
      g.arc(h.x, h.y, 3 + gl * 3.5, 0, TAU);
      g.fill();
    }
    const a16 = ((Math.round((h.ang / TAU) * 16) % 16) + 16) % 16;
    g.drawImage(handSprite(h.g, a16, h.side), Math.round(h.x - 10), Math.round(h.y - 10));
  }
  if (p.ball > 0.05 && geo.hands.length === 2) {
    const bx = (geo.hands[0].x + geo.hands[1].x) / 2;
    const by = (geo.hands[0].y + geo.hands[1].y) / 2;
    const r = 1.5 + p.ball * 3;
    g.fillStyle = css(VIO[3], 0.25);
    g.beginPath();
    g.arc(bx, by, r + 2.5, 0, TAU);
    g.fill();
    g.fillStyle = css(INK, 0.95);
    g.beginPath();
    g.arc(bx, by, r, 0, TAU);
    g.fill();
    g.fillStyle = css(VIO[5], 0.9);
    for (let k = 0; k < 6; k++) {
      const t = now * 6 + (k * TAU) / 6;
      g.fillRect(Math.round(bx + Math.cos(t) * (r + 0.5) - 0.5), Math.round(by + Math.sin(t) * (r + 0.5) * 0.7 - 0.5), 1, 1);
    }
  }
  // Смерть: плащ осыпается звёздами вверх; в конце ядро вспыхивает точкой.
  if (ds > 0) {
    const T = dieT;
    for (let i = 0; i < 46; i++) {
      const zf = hash(i, 5, 505);
      const z0 = HEM + (SHO - HEM) * zf;
      const t0 = 0.35 + 1.4 * zf;
      const age = T - t0;
      if (age < 0 || age > 1.3) continue;
      const u = hash(i, 6, 505) * TAU - Math.PI;
      const R = bellR(z0, fl);
      const psi = a + u;
      const X = LAX + Math.cos(psi) * R * (1 + age * 0.4);
      const Y = LAY - z0 - age * 22 + Math.sin(psi) * R * KF;
      const al = 1 - age / 1.3;
      g.fillStyle = css(i % 3 === 0 ? GOLD[5] : i % 3 === 1 ? ICE[5] : VIO[4], al);
      g.fillRect(Math.round(X - 0.5), Math.round(Y - 0.5), 1, 1);
      if (i % 5 === 0) {
        g.fillStyle = css(WHITE, al * 0.6);
        g.fillRect(Math.round(X - 1.5), Math.round(Y - 0.5), 3, 1);
      }
    }
    if (T > 2.3) {
      const k = clamp01((T - 2.3) / 0.3);
      g.fillStyle = css(WHITE, 1 - k);
      g.beginPath();
      g.arc(cx0, cy0, 2 + k * 10, 0, TAU);
      g.fill();
    }
  }
  return sl.c;
}

// ---- Кадр владыки ---------------------------------------------------------

function geoKey(dir: number, p: LPose): string {
  return `${dir}|${p.key}|${Math.round(p.flare * 4)}|${Math.round(p.open * 4)}|${p.train}|${p.sway}|${p.ph}|${Math.round(p.dissolve * 20)}`;
}
function lordGeo(dir: number, p: LPose): LGeo {
  const key = geoKey(dir, p);
  const hit = LGEO.get(key);
  if (hit) return hit;
  const q: LPose = {
    ...p,
    flare: Math.round(p.flare * 4) / 4,
    open: Math.round(p.open * 4) / 4,
    dissolve: Math.round(p.dissolve * 20) / 20,
    lean: Math.round(p.lean * 50) / 50,
  };
  const ck = `${dir}|${q.flare}|${q.open}|${q.lean}|${p.train}|${p.sway}|${p.ph}|${q.dissolve}`;
  return LGEO.set(key, buildLord((dir * TAU) / DIRS, q, ck));
}

registerMobPainter('f15boss', (m: Mob, pose: MobPose): MobFrame | null => {
  const s = paintSim();
  const now = pose.now;
  const p = lordPose(m, pose, now);
  const dir = ((Math.round(m.face / (TAU / DIRS)) % DIRS) + DIRS) % DIRS;
  const geo = lordGeo(dir, p);
  const sp = Math.hypot(m.vx, m.vy);
  const ghostOn = pose.mode !== 'dying' && sp > 3.4 && (pose.mode === 'f15l_dark' || pose.mode === 'f15l_nova');
  const img = paintBody(geo, now, pose.flash, ghostOn);
  const lit = paintLit(m, p, (dir * TAU) / DIRS, dir, geo, now, s, pose.mode === 'dying' ? pose.t : 0);
  const asleep = pose.mode === 'f15l_sleep' || pose.mode === 'f15l_stir';
  const bob = asleep ? Math.sin(now * 1.2) * 1 : Math.sin(now * 1.7) * 1.5;
  // Герой за владыкой — тело просвечивает, иначе героя не видно.
  const h = s?.hero;
  const behind = !!h && h.y < m.y - 0.2 && m.y - h.y < 5.2 && Math.abs(h.x - m.x) < 2.2;
  return {
    img,
    ax: LAX,
    ay: LAY,
    eye: null,
    dy: -(HOVER + p.hover) - bob,
    still: true,
    lift: 0,
    shadow: Math.max(8, 15 - p.hover * 0.4),
    lit,
    alpha: p.alpha * (behind ? 0.55 : 1),
    ghost: ghostOn ? { every: 0.06, life: 0.32, tint: '#3a2a8a', alpha: 0.4 } : null,
    linger: DIE,
  };
});

/** Прогрев: покой во все 32 стороны (с юга — первыми), потом ход. */
registerMobWarm('f15boss', function* () {
  const order: number[] = [];
  for (let k = 0; k <= 16; k++) {
    order.push((8 + k) % DIRS);
    if (k && k < 16) order.push((8 - k + DIRS) % DIRS);
  }
  for (const spQ of [0, 1])
    for (const d of order)
      for (let b = 0; b < 10; b++) {
        const sb = Math.sin((b / 10) * TAU);
        const idle = { ...T_IDLE[0], L: [6, -18, 31 + sb, 1] as HK, R: [6, 18, 31 - sb, 1] as HK, flare: 0.04 * sb };
        const k = blend(idle, T_GLIDE[0], spQ);
        const p: LPose = { ...k, key: `ch${spQ}|${b}`, train: spQ, sway: 0, alpha: 1, dissolve: 0, shrink: 0, dim: 1, tint: -1, ph: b };
        lordGeo(d, p);
        yield;
      }
});

// =============================================================================
// Осколок звезды: кристалл-бипирамида, крутится; в прицеле — разгорается и
// ложится остриём на героя; таран — шлейф; о стену — кружится; смерть — звон.
// =============================================================================

const SW = 26;
const SH = 30;
const SAX = 13;
const SAY = 16;
const SHARD_LRU = frameLRU<HTMLCanvasElement>(160);
const SHARD_LIT = frameLRU<HTMLCanvasElement>(40);
const LV = (() => {
  const n = Math.hypot(LXv, LYv, LZv);
  return [LXv / n, LYv / n, LZv / n];
})();

function shardSprite(spin: number, glow: number, scale: number, flash: boolean, crack: number): HTMLCanvasElement {
  const key = `${spin}|${glow}|${scale}|${flash ? 1 : 0}|${crack}`;
  const hit = SHARD_LRU.get(key);
  if (hit) return hit;
  const p = new Px(SW, SH);
  const sc = 0.45 + scale * 0.11;
  const th = (spin / 8) * (TAU / 6);
  const v3: [number, number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const a = th + (i * TAU) / 6;
    const r = (i & 1 ? 4.6 : 5.6) * sc;
    v3.push([Math.cos(a) * r, Math.sin(a) * r, 0]);
  }
  const top: [number, number, number] = [0, 0, 11 * sc];
  const bot: [number, number, number] = [0, 0, -8 * sc];
  const P = (q: [number, number, number]): [number, number] => [SAX + q[0], SAY - q[2] + q[1] * KF];
  const faces: [[number, number, number], [number, number, number], [number, number, number], boolean][] = [];
  for (let i = 0; i < 6; i++) {
    const a = v3[i];
    const b = v3[(i + 1) % 6];
    faces.push([top, a, b, true], [bot, b, a, false]);
  }
  for (const [A, B, C, up] of faces) {
    const ux = B[0] - A[0];
    const uy = B[1] - A[1];
    const uz = B[2] - A[2];
    const vx = C[0] - A[0];
    const vy = C[1] - A[1];
    const vz = C[2] - A[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const nn = Math.hypot(nx, ny, nz) || 1;
    nx /= nn;
    ny /= nn;
    nz /= nn;
    if (ny * VY + nz * VZ <= 0) continue;
    const d = nx * LV[0] + ny * LV[1] + nz * LV[2];
    const l = clamp01(0.35 + d * 0.65);
    const ramp = up ? ICE : [ICE[0], ICE[1], ICE[2], ICE[3], ICE[4], ICE[4], ICE[5]];
    const c = ramp[Math.max(1, Math.min(6, Math.round(l * 5.2 + glow * 0.4)))];
    poly(p, [P(A), P(B), P(C)], c);
  }
  // Сердцевина: горит сильнее в прицеле.
  if (glow > 0) {
    const r = 0.8 + glow * 0.7;
    p.ell(SAX - 0.5, SAY - 1.5, r + 0.6, r + 0.6, fade(GOLD[4], 0.5));
    p.ell(SAX - 0.5, SAY - 1.5, r, r, glow >= 3 ? WHITE : GOLD[5]);
  }
  // Блик ребра.
  const tp = P(top);
  p.set(tp[0] - 1, tp[1] + 3, WHITE);
  p.set(tp[0] - 1, tp[1] + 4, ICE[5]);
  if (crack) {
    stroke(p, SAX - 3, SAY - 6, SAX + 1, SAY - 1, ICE[0]);
    stroke(p, SAX + 1, SAY - 1, SAX - 1, SAY + 4, ICE[0]);
  }
  p.outline(hx('#081028'));
  if (flash) p.tint(WHITE, 0.6);
  return SHARD_LRU.set(key, p.canvas());
}

function shardLit(glow: number, dizzy: number): HTMLCanvasElement {
  const key = `${glow}|${dizzy}`;
  const hit = SHARD_LIT.get(key);
  if (hit) return hit;
  const p = new Px(SW, SH);
  const r = 2 + glow * 1.5;
  p.ell(SAX - 0.5, SAY - 1.5, r + 2, r + 2, fade(ICE[4], 0.12 + glow * 0.05));
  p.ell(SAX - 0.5, SAY - 1.5, r, r, fade(glow >= 2 ? GOLD[4] : ICE[4], 0.25 + glow * 0.1));
  if (dizzy) {
    // Звёздочки вокруг — кружится голова.
    for (let i = 0; i < 3; i++) {
      const a = (dizzy / 8) * TAU + (i * TAU) / 3;
      const x = Math.round(SAX + Math.cos(a) * 9);
      const y = Math.round(SAY - 13 + Math.sin(a) * 2.5);
      p.set(x, y, GOLD[5]);
      p.set(x - 1, y, fade(GOLD[4], 0.7));
      p.set(x + 1, y, fade(GOLD[4], 0.7));
      p.set(x, y - 1, fade(GOLD[4], 0.7));
      p.set(x, y + 1, fade(GOLD[4], 0.7));
    }
  }
  return SHARD_LIT.set(key, p.canvas());
}

/** Смерть осколка: грани разлетаются и гаснут (12 кадров за 0,5 с). */
function shardDie(f: number): HTMLCanvasElement {
  const key = `die${f}`;
  const hit = SHARD_LRU.get(key);
  if (hit) return hit;
  const p = new Px(SW + 14, SH + 10);
  const ox = 7;
  const oy = 5;
  const k = f / 11;
  for (let i = 0; i < 9; i++) {
    const a = hash(i, 1, 611) * TAU;
    const sp = 6 + hash(i, 2, 611) * 9;
    const x = ox + SAX + Math.cos(a) * sp * eOut(k);
    const y = oy + SAY - 2 + Math.sin(a) * sp * eOut(k) * 0.7 + k * k * 6;
    const s = 2.4 * (1 - k * 0.7);
    const rot = a + k * 5;
    const c = k > 0.7 ? fade(ICE[3], 1.5 - k * 1.5) : i % 3 ? ICE[4] : ICE[5];
    poly(p, [
      [x + Math.cos(rot) * s, y + Math.sin(rot) * s],
      [x + Math.cos(rot + 2.3) * s * 0.7, y + Math.sin(rot + 2.3) * s * 0.7],
      [x + Math.cos(rot + 4) * s * 0.8, y + Math.sin(rot + 4) * s * 0.8],
    ], c);
  }
  if (f < 4) p.ell(ox + SAX - 0.5, oy + SAY - 1.5, 3 + f * 2, 3 + f * 2, fade(WHITE, 0.8 - f * 0.2));
  return SHARD_LRU.set(key, p.canvas());
}

registerMobPainter('f15b_shard', (m: Mob, pose: MobPose): MobFrame | null => {
  const now = pose.now;
  const T = pose.t;
  if (pose.mode === 'dying') {
    const f = Math.min(11, Math.floor((T / 0.5) * 12));
    return { img: shardDie(f), ax: SAX + 7, ay: SAY + 5, eye: null, lift: 7, shadow: Math.max(0, 5 - f * 0.5), linger: 0.5 };
  }
  let spinRate = 1.4;
  let glow = 0;
  let scale = 4;
  let rot = 0;
  let sy = 1;
  let dizzy = 0;
  let ghost: MobFrame['ghost'] = null;
  const toward = (m.data.ang ?? m.face) + Math.PI / 2;
  if (pose.mode === 'f15s_eject') {
    spinRate = 5;
    scale = Math.min(4, Math.floor((T / 0.4) * 4));
    glow = 1;
  } else if (pose.mode === 'f15s_aim') {
    spinRate = 2 + T * 10;
    glow = Math.min(3, 1 + Math.floor((T / 0.7) * 3));
    rot = toward * eOut(T / 0.45);
  } else if (pose.mode === 'f15s_ram') {
    spinRate = 9;
    glow = 3;
    rot = toward;
    sy = 1.15;
    ghost = { every: 0.03, life: 0.22, tint: '#8cd0f4', alpha: 0.5 };
  } else if (pose.mode === 'dizzy') {
    spinRate = 0.6;
    rot = Math.sin(now * 9) * 0.5 * (1 - T / 1.2) + toward * Math.max(0, 1 - T / 0.2);
    dizzy = 1 + (Math.floor(now * 12) % 8);
  } else if (pose.mode === 'recover') {
    rot = toward * Math.max(0, 1 - T / 0.3);
    spinRate = 1;
  }
  // Угол поворота — к ближайшему эквиваленту, чтобы не крутило через полкруга.
  rot = Math.atan2(Math.sin(rot), Math.cos(rot));
  const spin = ((Math.floor(now * spinRate * 6 * 8) % 8) + 8) % 8;
  const img = shardSprite(spin, glow, scale, pose.flash, pose.mode === 'dizzy' ? 1 : 0);
  return {
    img,
    ax: SAX,
    ay: SAY,
    eye: null,
    rot,
    sy,
    lift: 7,
    shadow: 5,
    lit: shardLit(glow, dizzy),
    ghost,
    linger: 0.5,
  };
});

// =============================================================================
// Хранитель памяти: мраморный архивариус в балахоне с золотой каймой,
// капюшон с острым концом и звездой вместо лица, посох с кристаллом.
// Тот же приём, что у владыки: стопка дисков с буфером глубины, 16 сторон.
// =============================================================================

const KW = 64;
const KH = 68;
const KAX = 32;
const KAY = 62;
const MARBLE = ['#20243a', '#3c4262', '#646c8c', '#9098b4', '#bcc4d8', '#e4e8f2', '#fbfcff'].map((c) => hx(c));
const STONE_K = ['#1c1c22', '#34343c', '#50505a', '#6e6e78', '#8e8e98', '#b0b0b8', '#d0d0d6'].map((c) => hx(c));
const KEEP_LRU = frameLRU<[HTMLCanvasElement, HTMLCanvasElement]>(260);
const keeperLast = new WeakMap<Mob, number>();
const STAFF_D = hx('#3a2a4a');
const STAFF_S = hx('#22182e');

interface KPose {
  /** Кисть с посохом (вперёд, вправо, вверх) и направление посоха. */
  gx: number;
  gy: number;
  gz: number;
  sdx: number;
  sdy: number;
  sdz: number;
  /** Нижняя и верхняя части посоха от кисти. */
  lo: number;
  hi: number;
  /** Вторая кисть. */
  hx2: number;
  hy2: number;
  hz2: number;
  lean: number;
  bob: number;
  glow: number;
}

const K_IDLE: KPose = { gx: 3, gy: 6, gz: 16, sdx: 0.05, sdy: 0, sdz: 1, lo: 16, hi: 22, hx2: 3, hy2: -4.5, hz2: 15, lean: 0, bob: 0, glow: 0.3 };
const K_RAISE: KPose = { gx: 1, gy: 2, gz: 33, sdx: -0.15, sdy: 0, sdz: 1, lo: 10, hi: 18, hx2: 1.5, hy2: -1, hz2: 30, lean: -1, bob: 0, glow: 1 };
const K_SLAM: KPose = { gx: 7, gy: 1.5, gz: 13, sdx: 0.35, sdy: 0, sdz: -1, lo: 13, hi: 14, hx2: 6, hy2: -1.5, hz2: 15, lean: 3, bob: 0, glow: 1 };
const K_DRAW: KPose = { gx: -1, gy: 4, gz: 19, sdx: 1, sdy: -0.1, sdz: 0.08, lo: 8, hi: 18, hx2: 2, hy2: -3, hz2: 19, lean: -1.5, bob: 0, glow: 0.8 };
const K_THRUST: KPose = { gx: 6, gy: 2.5, gz: 19, sdx: 1, sdy: -0.05, sdz: 0.04, lo: 8, hi: 20, hx2: 5, hy2: -2, hz2: 19, lean: 2.5, bob: 0, glow: 1 };

function kmix(a: KPose, b: KPose, k: number): KPose {
  const o = { ...a };
  for (const n of Object.keys(a) as (keyof KPose)[]) o[n] = a[n] + (b[n] - a[n]) * k;
  return o;
}

/** Поза хранителя по режиму и времени (кадр 24 к/с). */
function keeperPose(mode: string, T: number, last: number, ph: number): KPose {
  if (mode === 'f15k_slam') {
    if (T < 0.75) return kmix(K_IDLE, K_RAISE, smooth(T / 0.75));
    return kmix(K_RAISE, K_SLAM, eIn((T - 0.75) / 0.22));
  }
  if (mode === 'f15k_lance') {
    if (T < 0.72) return kmix(K_IDLE, K_DRAW, smooth(T / 0.6));
    return kmix(K_DRAW, K_THRUST, eOut((T - 0.72) / 0.16));
  }
  if (mode === 'recover') {
    const from = last === 2 ? K_THRUST : last === 1 ? K_SLAM : K_IDLE;
    if (T < 0.35) return from;
    return kmix(from, K_IDLE, smooth((T - 0.35) / 0.6));
  }
  const b = Math.sin((ph / 8) * TAU);
  return { ...K_IDLE, bob: b * 0.6, gz: K_IDLE.gz + b * 0.5, hz2: K_IDLE.hz2 - b * 0.4 };
}

function robeR(z: number): number {
  if (z < 27) return 8.6 - 3.6 * Math.pow(z / 27, 0.85);
  if (z < 30) return 5 - (z - 27) * 0.5;
  return 0;
}
function hoodR(z: number): number {
  if (z < 28.5 || z > 45) return 0;
  if (z < 33) return 4.9 * Math.sqrt(clamp01((z - 28.5) / 4.5));
  return 4.9 * Math.pow(clamp01((45 - z) / 12), 0.7);
}

function buildKeeper(dir: number, kp: KPose, stone: number, crumble: number, flash: boolean, ph: number): [HTMLCanvasElement, HTMLCanvasElement] {
  const a = (dir * TAU) / 16;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const p = new Px(KW, KH);
  const lit = new Px(KW, KH);
  const zb = new Float32Array(KW * KH).fill(-1e9);
  const stoneAt = (z: number) => z < stone * 50;
  const ramp = (z: number) => (stoneAt(z) ? STONE_K : MARBLE);
  const put = (X: number, Y: number, d: number, c: RGBA, z: number) => {
    const x = Math.round(X - 0.5);
    const y = Math.round(Y - 0.5);
    if (x < 0 || y < 0 || x >= KW || y >= KH) return;
    if (crumble > 0 && hash(x, y, 617) < crumble * 1.15 - (z / 50) * 0.3) return;
    const i = y * KW + x;
    if (d < zb[i]) return;
    zb[i] = d;
    p.set(x, y, c);
  };
  // Мир ← локальные (вперёд f, вправо r, вверх z), с наклоном корпуса.
  const toS = (f: number, r: number, z: number): [number, number, number] => {
    const wx = f * ca - r * sa;
    const wy = f * sa + r * ca;
    return [KAX + wx, KAY - z + wy * KF, wy * VY + z * VZ];
  };
  const leanAt = (z: number) => kp.lean * clamp01((z - 6) / 30);
  const bob = kp.bob;
  const shade = (nx: number, ny: number, nz: number) => clamp01(0.42 + (nx * LV[0] + ny * LV[1] + nz * LV[2]) * 0.6);
  // Балахон и накидка: стопка дисков.
  for (let z = 0; z <= 30; z += 0.5) {
    const R = robeR(z) + (z < 2 ? 0.4 * Math.sin(ph * 0.8 + z) : 0);
    const cf = leanAt(z);
    for (let k = 0; k < 64; k++) {
      const psi = (k / 64) * TAU;
      const cx = Math.cos(psi);
      const cy = Math.sin(psi);
      // Точки только по кромке диска — внутренность закроет верхний диск.
      for (const rr of z > 29 ? [R, R * 0.6, R * 0.25] : [R, R - 0.7]) {
        const wx = cf * ca + cx * rr;
        const wy = cf * sa + cy * rr;
        const zz = z + bob;
        const X = KAX + wx;
        const Y = KAY - zz + wy * KF;
        const d = wy * VY + zz * VZ;
        let u = psi - a;
        u -= Math.round(u / TAU) * TAU;
        const rp = ramp(z);
        const l = z > 29 ? shade(cx * 0.4, cy * 0.4, 0.9) : shade(cx, cy, 0.25);
        let c = mixq(rp[1], rp[5], l, Math.round(X), Math.round(Y));
        // Прожилки мрамора.
        if (!stoneAt(z) && vnoise(psi * 3 + z * 0.15, z * 0.35, 619) > 0.78) c = mixc(c, rp[2], 0.6);
        const gold = !stoneAt(z) && (z < 1.5 || (z > 26 && z < 27.5) || (Math.abs(u) < 0.16 && z < 26));
        if (gold) c = l > 0.55 ? GOLD[4] : GOLD[3];
        else if (stoneAt(z) && (z < 1.5 || (z > 26 && z < 27.5))) c = STONE_K[2];
        // Вышитые звёзды по подолу.
        if (!stoneAt(z) && z > 3 && z < 9 && Math.abs(u) > 0.5 && hash(k, Math.floor(z), 621) < 0.05) c = GOLD[5];
        put(X, Y, d, c, z);
      }
    }
  }
  // Капюшон: диски, на лицевой стороне — тёмный проём со звездой.
  for (let z = 28.5; z <= 45; z += 0.5) {
    const R = hoodR(z);
    const back = Math.max(0, z - 37) * 0.35;
    const cf = leanAt(z) - back;
    for (let k = 0; k < 48; k++) {
      const psi = (k / 48) * TAU;
      const cx = Math.cos(psi);
      const cy = Math.sin(psi);
      for (const rr of [R, R * 0.55, 0]) {
        const wx = cf * ca + cx * rr;
        const wy = cf * sa + cy * rr;
        const zz = z + bob;
        const X = KAX + wx;
        const Y = KAY - zz + wy * KF;
        const d = wy * VY + zz * VZ;
        let u = psi - a;
        u -= Math.round(u / TAU) * TAU;
        const rp = ramp(z);
        let c = mixq(rp[1], rp[5], shade(cx * 0.8, cy * 0.8, 0.5 + (z - 34) / 20), Math.round(X), Math.round(Y));
        if (rr > 0 && Math.abs(u) < 0.95 - Math.abs(z - 33.5) * 0.12 && z > 30 && z < 38) c = rr === R ? NIGHT[1] : INK;
        else if (!stoneAt(z) && rr === R && Math.abs(u) < 1.15 && Math.abs(u) > 0.85 && z > 30 && z < 38) c = GOLD[3];
        put(X, Y, d, c, z);
      }
    }
  }
  // Звезда в проёме капюшона (лицо) — и свет её.
  {
    const [X, Y, d] = toS(leanAt(34) + 1.8, 0, 34 + bob);
    const vis = sa > -0.35;
    if (vis && !stoneAt(34)) {
      const x = Math.round(X - 0.5);
      const y = Math.round(Y - 0.5);
      for (const [dx, dy, c] of [[0, 0, WHITE], [1, 0, ICE[5]], [-1, 0, ICE[5]], [0, 1, ICE[4]], [0, -1, ICE[4]]] as [number, number, RGBA][])
        put(x + dx + 0.5, y + dy + 0.5, d + 3, c, 34);
      lit.ell(X - 0.5, Y - 0.5, 3.2, 2.6, fade(ICE[4], 0.35));
      lit.set(x, y, WHITE);
    }
  }
  // Рукава и кисти: капсулы от плеча к кисти.
  const capsule = (f0: number, r0: number, z0: number, f1: number, r1: number, z1: number, rad0: number, rad1: number, hand: boolean) => {
    const n = Math.ceil(Math.hypot(f1 - f0, r1 - r0, z1 - z0) * 2) + 1;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const f = f0 + (f1 - f0) * t;
      const r = r0 + (r1 - r0) * t;
      const z = z0 + (z1 - z0) * t;
      const rad = rad0 + (rad1 - rad0) * t;
      for (let k = 0; k < 14; k++) {
        const ang = (k / 14) * TAU;
        const oz = Math.sin(ang) * rad;
        const oh = Math.cos(ang) * rad;
        const [X, Y, d] = toS(f + oh * 0.5, r + oh * 0.85, z + oz + bob);
        const rp = ramp(z);
        const c = t > 0.82 && !stoneAt(z) ? GOLD[3] : mixq(rp[2], rp[5], shade(Math.cos(ang) * 0.5, 0.3, Math.sin(ang)), Math.round(X), Math.round(Y));
        put(X, Y, d, c, z);
      }
    }
    if (hand) {
      const [X, Y, d] = toS(f1, r1, z1 + bob);
      const c = stoneAt(z1) ? STONE_K[4] : ICE[4];
      put(X, Y, d + 1, c, z1);
      put(X + 1, Y, d + 1, c, z1);
      put(X, Y + 1, d + 1, stoneAt(z1) ? STONE_K[3] : ICE[3], z1);
    }
  };
  const sh = 4.6;
  capsule(leanAt(26), sh, 26, kp.gx, kp.gy, kp.gz, 1.9, 1.4, true);
  capsule(leanAt(26), -sh, 26, kp.hx2, kp.hy2, kp.hz2, 1.9, 1.4, true);
  // Посох: тёмное дерево с золотыми кольцами, на конце — кристалл-звезда.
  const sn = Math.hypot(kp.sdx, kp.sdy, kp.sdz) || 1;
  const dx = kp.sdx / sn;
  const dy = kp.sdy / sn;
  const dz = kp.sdz / sn;
  for (let s = -kp.lo; s <= kp.hi; s += 0.5) {
    const f = kp.gx + dx * s;
    const r = kp.gy + dy * s;
    const z = kp.gz + dz * s;
    if (z < -0.5) continue;
    const [X, Y, d] = toS(f, r, z + bob);
    const ring = Math.abs(((s + 100) % 7) - 3.5) < 0.4;
    const c = stoneAt(z) ? STONE_K[2] : ring ? GOLD[3] : STAFF_D;
    put(X, Y, d + 0.5, c, z);
    put(X + 1, Y, d + 0.4, stoneAt(z) ? STONE_K[1] : STAFF_S, z);
  }
  {
    const s = kp.hi + 2.5;
    const [X, Y, d] = toS(kp.gx + dx * s, kp.gy + dy * s, kp.gz + dz * s + bob);
    const st = stoneAt(kp.gz + dz * s);
    const g = kp.glow;
    const R = 3;
    for (let k = 0; k < 4; k++) {
      const an = (k * TAU) / 4 + (ph / 8) * 0.6;
      const tx = X + Math.cos(an) * R;
      const ty = Y + Math.sin(an) * R * 0.9;
      for (let j = 0; j <= 6; j++) {
        const t = j / 6;
        put(X + (tx - X) * t, Y + (ty - Y) * t, d + 2, st ? STONE_K[4] : t > 0.6 ? ICE[5] : ICE[4], 40);
      }
    }
    put(X, Y, d + 2.5, st ? STONE_K[5] : WHITE, 40);
    if (!st) {
      lit.ell(X - 0.5, Y - 0.5, 4 + g * 3, 4 + g * 3, fade(ICE[4], 0.1 + g * 0.12));
      lit.ell(X - 0.5, Y - 0.5, 1.5 + g, 1.5 + g, fade(ICE[5], 0.35 + g * 0.3));
      lit.set(Math.round(X - 0.5), Math.round(Y - 0.5), WHITE);
    }
  }
  p.outline(hx('#0a0a1c'));
  if (flash) p.tint(WHITE, 0.6);
  return [p.canvas(), lit.canvas()];
}

registerMobPainter('f15b_keeper', (m: Mob, pose: MobPose): MobFrame | null => {
  const now = pose.now;
  const T = pose.t;
  const mode = pose.mode;
  if (mode === 'f15k_slam') keeperLast.set(m, 1);
  else if (mode === 'f15k_lance') keeperLast.set(m, 2);
  else if (mode !== 'recover') keeperLast.set(m, 0);
  const dir = ((Math.round(m.face / (TAU / 16)) % 16) + 16) % 16;
  const sp = Math.hypot(m.vx, m.vy);
  const ph = sp > 0.3 ? Math.floor(now * 8) % 8 : Math.floor(now * 3) % 8;
  let stone = 0;
  let crumble = 0;
  let f = fr24(T);
  let kp: KPose;
  let key: string;
  if (mode === 'sleep') {
    stone = 1;
    kp = K_IDLE;
    key = 'sl';
  } else if (mode === 'dying') {
    stone = clamp01(T / 0.45);
    crumble = clamp01((T - 0.5) / 0.6);
    f = Math.min(fr24(1.1), f);
    kp = keeperPose('recover', 0.4, 0, 0);
    key = `d${f}`;
    stone = Math.round(stone * 10) / 10;
    crumble = Math.round(crumble * 12) / 12;
  } else if (mode === 'f15k_slam' || mode === 'f15k_lance' || mode === 'recover') {
    const last = keeperLast.get(m) ?? 0;
    kp = keeperPose(mode, f / 24, last, 0);
    key = `${mode}${last}|${f}`;
  } else {
    kp = keeperPose('chase', 0, 0, ph);
    key = `c${ph}`;
  }
  const k = `${dir}|${key}|${pose.flash ? 1 : 0}`;
  let fr = KEEP_LRU.get(k);
  if (!fr) fr = KEEP_LRU.set(k, buildKeeper(dir, kp, stone, crumble, pose.flash, ph));
  return {
    img: fr[0],
    ax: KAX,
    ay: KAY,
    eye: null,
    still: true,
    shadow: 8,
    lit: mode === 'sleep' ? undefined : fr[1],
    linger: 1.1,
  };
});

registerMobWarm('f15b_keeper', function* () {
  for (let d = 0; d < 16; d++)
    for (let ph = 0; ph < 8; ph++) {
      const k = `${d}|c${ph}|0`;
      if (!KEEP_LRU.get(k)) KEEP_LRU.set(k, buildKeeper(d, keeperPose('chase', 0, 0, ph), 0, 0, false, ph));
      yield;
    }
});

// =============================================================================
// Эхо павших боссов: их же кадры, переписанные в созвездие — тёмная синь
// по яркости, золотой контур, редкие звёзды внутри; тает по дизеру.
// =============================================================================

const ECHO_SRC: Record<string, string> = {
  f15b_echo_king: 'f1_king',
  f15b_echo_mino: 'f5_minotaur',
  f15b_echo_serpent: 'f6boss',
  f15b_echo_hydra: 'f9_body',
  f15b_echo_head: 'f9_head',
  f15b_echo_demon: 'f10boss',
};
const ECHO_RAMP: RGBA[] = [NIGHT[1], NIGHT[2], NIGHT[3], NIGHT[4], NIGHT[5], VIO[1], VIO[2]];
const echoCache = new WeakMap<HTMLCanvasElement, Map<string, HTMLCanvasElement>>();

function constellate(src: HTMLCanvasElement, fq: number, tw: number): HTMLCanvasElement {
  let mm = echoCache.get(src);
  if (!mm) {
    mm = new Map();
    echoCache.set(src, mm);
  }
  const key = `${fq}|${tw}`;
  const hit = mm.get(key);
  if (hit) return hit;
  const w = src.width;
  const h = src.height;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const g = src.getContext('2d');
  if (!g) return out;
  const d = g.getImageData(0, 0, w, h).data;
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] > 40;
  const o = new ImageData(w, h);
  const od = o.data;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (d[i + 3] <= 40) continue;
      if (fq > 0 && hash(x >> 1, y >> 1, 623) < fq) continue;
      const l = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255;
      let c = ECHO_RAMP[Math.max(0, Math.min(6, Math.floor(l * 7.5)))];
      let al = 230;
      if (!solid(x - 1, y) || !solid(x, y - 1)) c = GOLD[4];
      else if (!solid(x + 1, y) || !solid(x, y + 1)) c = GOLD[2];
      else {
        const hs = hash(x, y, 625 + tw);
        if (hs < 0.012) c = WHITE;
        else if (hs < 0.03) c = ICE[4];
        else if (l > 0.7) c = mixc(c, VIO[3], 0.5);
        al = 215;
      }
      od[i] = c[0];
      od[i + 1] = c[1];
      od[i + 2] = c[2];
      od[i + 3] = al;
    }
  out.getContext('2d')!.putImageData(o, 0, 0);
  mm.set(key, out);
  return out;
}

registerMobPainter('f15b_echo', (m: Mob, pose: MobPose): MobFrame | null => {
  const src = MOB_PAINTERS.get(ECHO_SRC[m.kind] ?? '');
  if (!src) return null;
  const rising = pose.mode === 'f15e_rise';
  const pp: MobPose = rising ? { ...pose, mode: 'chase', anim: 'idle', t: 0 } : pose;
  const fr = src(m, pp);
  if (!fr) return null;
  let fd = 0;
  if (rising) fd = Math.max(0, 1 - pose.t / 1.3);
  if (pose.mode === 'dying') fd = Math.min(1, pose.t / 0.6);
  const fq = Math.round(fd * 6) / 6;
  const tw = Math.floor(pose.now * 3) % 2;
  return {
    img: constellate(fr.img, fq, tw),
    ax: fr.ax,
    ay: fr.ay,
    eye: fr.eye,
    dx: fr.dx,
    dy: fr.dy,
    sx: fr.sx,
    sy: fr.sy,
    rot: fr.rot,
    still: fr.still,
    shadow: fr.shadow,
    lift: fr.lift,
  };
});

/** Тело змея-эха: то же тело 6-го этажа, перекрашенное в созвездие. */
const EB = 208;
let ebufs: HTMLCanvasElement[] | null = null;
function ebuf(): HTMLCanvasElement[] {
  if (!ebufs)
    ebufs = [0, 1, 2].map(() => {
      const c = document.createElement('canvas');
      c.width = EB;
      c.height = EB;
      return c;
    });
  return ebufs;
}

registerZonePainter('f15b_echobody', (g, z, px, py, _S, time) => {
  const s = paintSim();
  const v = f15bView(s);
  const m = s?.mobs.find((x) => x.id === (z as Zone & { mob?: number }).mob);
  if (!v || !m || !s) return true;
  const rising = m.mode === 'f15e_rise';
  const k = rising ? clamp01(m.t / 1.3) : m.mode === 'dying' ? Math.max(0, 1 - m.t / 0.6) : 1;
  if (k <= 0.02 || v.trail.length < 4) return true;
  const [A, B, C] = ebuf();
  const ga = A.getContext('2d');
  const gb = B.getContext('2d');
  const gc = C.getContext('2d');
  if (!ga || !gb || !gc) return true;
  const ox = EB / 2;
  const oy = EB / 2 + 20;
  ga.setTransform(1, 0, 0, 1, 0, 0);
  ga.clearRect(0, 0, EB, EB);
  ga.imageSmoothingEnabled = false;
  drawSerpentBody(
    ga,
    { id: m.id, trail: v.trail, mode: rising ? 'chase' : m.mode, t: m.t, x: m.x, y: m.y, face: m.face, haste: 1, flash: m.flash, die: -1 },
    ox,
    oy,
    16,
    time,
  );
  // Созвездие: цвет — индиго, яркость — своя.
  gb.setTransform(1, 0, 0, 1, 0, 0);
  gb.globalCompositeOperation = 'source-over';
  gb.globalAlpha = 1;
  gb.clearRect(0, 0, EB, EB);
  gb.drawImage(A, 0, 0);
  gb.globalCompositeOperation = 'color';
  gb.fillStyle = '#3a2a8a';
  gb.fillRect(0, 0, EB, EB);
  gb.globalCompositeOperation = 'multiply';
  gb.fillStyle = '#7a70c0';
  gb.fillRect(0, 0, EB, EB);
  gb.globalCompositeOperation = 'destination-in';
  gb.drawImage(A, 0, 0);
  // Звёзды внутри тела.
  gb.globalCompositeOperation = 'source-atop';
  const tw = Math.floor(time * 3) % 2;
  for (let i = 0; i < 90; i++) {
    const x = Math.floor(hash(i, 1, 627 + tw) * EB);
    const y = Math.floor(hash(i, 2, 627 + tw) * EB);
    gb.fillStyle = i % 4 ? 'rgba(140,208,244,0.9)' : '#ffffff';
    gb.fillRect(x, y, 1, 1);
  }
  // Золотой кант сверху-слева.
  gc.setTransform(1, 0, 0, 1, 0, 0);
  gc.globalCompositeOperation = 'source-over';
  gc.clearRect(0, 0, EB, EB);
  gc.drawImage(A, 0, 0);
  gc.globalCompositeOperation = 'destination-out';
  gc.drawImage(A, 1, 1);
  gc.globalCompositeOperation = 'source-in';
  gc.fillStyle = '#ffd866';
  gc.fillRect(0, 0, EB, EB);
  gb.globalCompositeOperation = 'source-over';
  gb.drawImage(C, 0, 0);
  const prevA = g.globalAlpha;
  const prevS = g.imageSmoothingEnabled;
  g.imageSmoothingEnabled = false;
  g.globalAlpha = 0.9 * k;
  g.drawImage(B, Math.round(px - ox), Math.round(py - oy));
  g.globalAlpha = prevA;
  g.imageSmoothingEnabled = prevS;
  return true;
});

// =============================================================================
// Иконки вещей 10×10.
// =============================================================================

registerItemArt('f15b_stardust', () => {
  const p = new Px(10, 10);
  // Горсть звёздной пыли: искры в мешочке из тьмы.
  p.ell(4.5, 6, 3.6, 3, NIGHT[3]);
  p.ell(4.5, 5.6, 2.8, 2.2, NIGHT[5]);
  p.rect(3, 1, 6, 2, GOLD[3]);
  p.set(3, 5, WHITE);
  p.set(6, 6, ICE[5]);
  p.set(5, 7, GOLD[5]);
  p.set(2, 7, ICE[4]);
  p.outline(INK);
  return p;
});

registerItemArt('f15b_echo', () => {
  const p = new Px(10, 10);
  // Осколок эха: индиго-кристалл с золотой гранью и звездой.
  poly(p, [
    [5, 0.5],
    [8.5, 4],
    [6, 9.5],
    [2, 6],
  ], (x, y) => (x + y < 7 ? VIO[2] : x + y < 11 ? NIGHT[5] : NIGHT[3]));
  stroke(p, 5, 1, 2.5, 6, GOLD[4]);
  p.set(5, 4, WHITE);
  p.set(6, 6, ICE[4]);
  p.outline(INK);
  return p;
});

registerItemArt('f15b_orbit', () => {
  const p = new Px(10, 10);
  // Кольцо орбиты с маленькой планетой.
  for (let k = 0; k < 28; k++) {
    const t = (k / 28) * TAU;
    p.set(Math.round(4.5 + Math.cos(t) * 4), Math.round(5 + Math.sin(t) * 2.2), GOLD[3]);
  }
  ball(p, 4.5, 4.5, 2.2, [ICE[1], ICE[3], ICE[4], ICE[6]]);
  p.set(8, 5, GOLD[5]);
  p.outline(INK);
  return p;
});

registerItemArt('f15mat', () => {
  const p = new Px(10, 10);
  // Сердце звезды: кристалл-звезда в золотой оправе.
  star8(p, 4.5, 4.5, 4.4, 0, GOLD[2], GOLD[4], WHITE);
  p.ell(4.5, 4.5, 1.6, 1.6, ICE[5]);
  p.set(4, 4, WHITE);
  p.outline(INK);
  return p;
});
