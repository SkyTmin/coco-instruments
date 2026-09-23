// Клетки подземелья на плитках 16x16 DungeonTileset II (0x72, CC0).
// Владелец про прежние: «графика ужасная… ищи пресеты, сделай шедевр».
//
// Устройство взято у набора и расширено под нашу карту. У 0x72 стена —
// это кирпичная ЛИЦЕВАЯ грань высотой в клетку (её видно только у стены,
// под которой пол: камера смотрит с юга) и светлая КРОМКА верха стены —
// полоса в три пикселя с тёмной обводкой, нарезанная на «камни» по 7 px.
// За кромкой — пустота. У набора стены тонкие, а у нас порода — толстые
// массивы, поэтому пустота здесь не прозрачная, а тёмная скала с
// крапинами. Всё, что меняет вид клетки, — её соседи: кромка идёт вдоль
// пола, над лицевой гранью, и загибается на углах. Узор кромки считается
// от МИРОВЫХ координат: камни кромки переходят из клетки в клетку без шва.
//
// Районы различаются лицом стены: в Устье — кирпичная крепь (так и есть в
// главных выработках настоящих шахт), в Откатке — дикая порода, по которой
// через шаг стоят деревянные рамы крепи. Пол — плиты набора в обоих, но
// вариантов с трещинами в Откатке больше.
//
// Пока атлас не пришёл, `x72Ready()` ложно и рисовальщик берёт прежние
// плитки.

import type { AreaId } from './dungeon';
import { hex, Px, TS } from './dungeon-art';
import { X72_FRAMES } from './dungeon-x72-frames';
import type { X72Name } from './dungeon-x72-frames';

type RGBA = [number, number, number, number];

// ---------------------------------------------------------------------------
// Атлас.
// ---------------------------------------------------------------------------

let atlas: ImageData | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

export function loadX72(): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve();
  if (!loading) {
    loading = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const g = c.getContext('2d')!;
        g.drawImage(img, 0, 0);
        atlas = g.getImageData(0, 0, img.width, img.height);
        listeners.forEach((f) => f());
        resolve();
      };
      img.onerror = () => resolve();
      img.src = `${import.meta.env.BASE_URL}dungeon/x72/atlas.png`;
    });
  }
  return loading;
}

export const x72Ready = () => atlas !== null;

export function onX72Ready(f: () => void): () => void {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}

const pxCache = new Map<string, Px>();

/** Кадр атласа как пиксельный холст (копия — его можно дорисовывать). */
export function x72(name: X72Name): Px | null {
  if (!atlas) return null;
  let p = pxCache.get(name);
  if (!p) {
    const [sx, sy, w, h] = X72_FRAMES[name];
    p = new Px(w, h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = ((sy + y) * atlas.width + sx + x) * 4;
        const o = (y * w + x) * 4;
        p.data[o] = atlas.data[i];
        p.data[o + 1] = atlas.data[i + 1];
        p.data[o + 2] = atlas.data[i + 2];
        p.data[o + 3] = atlas.data[i + 3];
      }
    pxCache.set(name, p);
  }
  const copy = new Px(p.w, p.h);
  copy.data.set(p.data);
  return copy;
}

const canvasCache = new Map<string, HTMLCanvasElement>();
function cachedCanvas(key: string, make: () => Px): HTMLCanvasElement {
  let c = canvasCache.get(key);
  if (!c) {
    c = make().canvas();
    canvasCache.set(key, c);
  }
  return c;
}

const pxTiles = new Map<string, Px>();
/**
 * Клетки кешируются пикселями, а не холстами: кусок карты собирается в
 * одном буфере и выводится одной операцией. Холст на каждую клетку (их 256
 * в куске) стоил 15–40 мс на кусок — запинка, когда кусок въезжал в экран.
 */
function cachedPx(key: string, make: () => Px): Px {
  let p = pxTiles.get(key);
  if (!p) {
    p = make();
    pxTiles.set(key, p);
  }
  return p;
}

/** Наложить пиксели `src` на `dst` в точке (ox, oy): прозрачное пропускаем. */
export function blit(dst: Px, src: Px, ox: number, oy: number): void {
  const sd = src.data;
  const dd = dst.data;
  for (let y = 0; y < src.h; y++) {
    const ty = oy + y;
    if (ty < 0 || ty >= dst.h) continue;
    for (let x = 0; x < src.w; x++) {
      const tx = ox + x;
      if (tx < 0 || tx >= dst.w) continue;
      const si = (y * src.w + x) * 4;
      const a = sd[si + 3];
      if (!a) continue;
      const di = (ty * dst.w + tx) * 4;
      if (a === 255 || !dd[di + 3]) {
        dd[di] = sd[si];
        dd[di + 1] = sd[si + 1];
        dd[di + 2] = sd[si + 2];
        dd[di + 3] = a === 255 ? 255 : Math.max(a, dd[di + 3]);
      } else {
        const k = a / 255;
        dd[di] += (sd[si] - dd[di]) * k;
        dd[di + 1] += (sd[si + 1] - dd[di + 1]) * k;
        dd[di + 2] += (sd[si + 2] - dd[di + 2]) * k;
      }
    }
  }
}

/** Кадр атласа холстом, из кеша. */
export function x72Canvas(name: X72Name): HTMLCanvasElement | null {
  if (!atlas) return null;
  return cachedCanvas(`x72:${name}`, () => x72(name)!);
}

// ---------------------------------------------------------------------------
// Палитра набора: пять ступеней камня. Всё, что рисует код, берёт цвета
// отсюда — иначе своё выглядело бы наклейкой на чужом.
// ---------------------------------------------------------------------------

export const P = {
  ink: hex('#222222'),
  stone: hex('#483b3a'),
  stoneLight: hex('#775c55'),
  rim: hex('#aa8d7a'),
  rimLight: hex('#d3bfa9'),
  /** Порода за кромкой: темнее обводки, чтобы кромка читалась. */
  rock: hex('#1b1516'),
  rockLight: hex('#241c1d'),
  rockSpeck: hex('#2e2425'),
  /** Дерево крепи — ступени ящика набора, приглушённые. */
  wood: hex('#6e3a26'),
  woodDark: hex('#472029'),
  woodLight: hex('#9a5a32'),
  /** Железо рельсов и скоб. */
  iron: hex('#8b8f94'),
  ironDark: hex('#4b4e53'),
  ironLight: hex('#c4c8cc'),
  /** Пирит в породе. */
  ore: hex('#d8b24a'),
  oreLight: hex('#fff0a8'),
} as const;

const hash = (a: number, b: number, c = 0) => {
  let h = (a * 374761393 + b * 668265263 + c * 1274126177) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
};

// ---------------------------------------------------------------------------
// Соседи клетки.
// ---------------------------------------------------------------------------

/**
 * Что видно вокруг клетки. `open` — пол и всё проходимое; лицо стены —
 * сплошная клетка, под которой пол.
 */
export interface Around {
  /** Проходимо ли (dx, dy). */
  open: (dx: number, dy: number) => boolean;
}

const isFace = (a: Around, dx: number, dy: number) => !a.open(dx, dy) && a.open(dx, dy + 1);

// ---------------------------------------------------------------------------
// Кромка: полосы в три пикселя с обводкой, «камни» по 7 px от мировой
// координаты.
// ---------------------------------------------------------------------------

/** Вертикальная полоса кромки шириной 5 (обводка, 3 камня, обводка). */
function vStrip(px: Px, x0: number, wy: number): void {
  for (let y = 0; y < TS; y++) {
    const k = (((wy * TS + y) % 7) + 7) % 7;
    if (k === 3) {
      px.rect(x0, y, x0 + 4, y, P.ink);
      continue;
    }
    px.set(x0, y, P.ink);
    px.set(x0 + 4, y, P.ink);
    const c = k === 2 ? P.rimLight : P.rim;
    for (let x = 1; x <= 3; x++) px.set(x0 + x, y, c);
  }
}

/** Горизонтальная полоса: обводка сверху, два ряда камня, светлая кромка. */
function hStrip(px: Px, y0: number, wx: number, lightBottom: boolean): void {
  // y0 — верхняя строка полосы из 4 (или 5 для низа массива) строк.
  for (let x = 0; x < TS; x++) {
    const k = (((wx * TS + x) % 7) + 7) % 7;
    const sep = k === 2;
    if (lightBottom) {
      px.set(x, y0, P.ink);
      px.set(x, y0 + 1, sep ? P.ink : P.rim);
      px.set(x, y0 + 2, sep ? P.ink : P.rim);
      px.set(x, y0 + 3, sep ? P.ink : P.rimLight);
    } else {
      // Кромка у пола сверху: светлое — со стороны пола, обводка — к породе.
      px.set(x, y0, sep ? P.ink : P.rimLight);
      px.set(x, y0 + 1, sep ? P.ink : P.rim);
      px.set(x, y0 + 2, sep ? P.ink : P.rim);
      px.set(x, y0 + 3, P.ink);
    }
  }
}

// ---------------------------------------------------------------------------
// Порода за кромкой.
// ---------------------------------------------------------------------------

function paintRock(px: Px, v: number): void {
  px.rect(0, 0, TS - 1, TS - 1, P.rock);
  const wx = v;
  const wy = 911;
  const h = hash(wx, wy, 7);
  // Крупные тёмные пласты и редкие крапины — массив читается как камень,
  // но не спорит с кромкой.
  for (let i = 0; i < 5; i++) {
    const r = hash(wx, wy, 100 + i);
    const x = r % TS;
    const y = (r >>> 8) % TS;
    const len = 2 + ((r >>> 16) % 4);
    for (let k = 0; k < len; k++) px.set(x + k, y, P.rockLight);
  }
  // Одиночные светлые крапины на чёрном читались звёздным небом — в толще
  // только пласты, без точек.
  if (h % 5 === 0) {
    const r = hash(wx, wy, 300);
    const x = r % 12;
    const y = (r >>> 8) % 14;
    px.set(x, y, P.rockSpeck);
    px.set(x + 1, y, P.rockSpeck);
    px.set(x + 2, y + 1, P.rockSpeck);
  }
}

// ---------------------------------------------------------------------------
// Лицо стены.
// ---------------------------------------------------------------------------

const BRICK_FACES: X72Name[] = ['wall_mid', 'wall_mid', 'wall_mid', 'wall_left', 'wall_right'];

/** Кирпичная крепь Устья: кадры набора, изредка — выбоина. */
function brickFace(v: number): Px {
  const h = hash(v, 17, 3);
  let name: X72Name = BRICK_FACES[h % BRICK_FACES.length];
  if (h % 31 === 0) name = 'wall_hole_1';
  else if (h % 37 === 0) name = 'wall_hole_2';
  const px = x72(name)!;
  // У «левого» и «правого» кадров вертикальная обводка по краю — это край
  // кладки, в середине стены она лишняя: заливаем её кирпичом.
  if (name === 'wall_left' || name === 'wall_right') {
    const col = name === 'wall_left' ? 0 : TS - 1;
    const src = name === 'wall_left' ? 1 : TS - 2;
    for (let y = 0; y < TS; y++) {
      const c = px.get(src, y);
      if ((y + 1) % 4 !== 0) px.set(col, y, c);
    }
  }
  return px;
}

/**
 * Дикая порода Откатки: неровные камни в обводке — те же пять ступеней,
 * что у кирпича, но без рядов. Узор — из мировых координат.
 */
function rockFace(wx: number, wy: number): Px {
  const px = new Px(TS, TS);
  px.rect(0, 0, TS - 1, TS - 1, P.stone);
  // Центры камней: сетка 3×3 с дрожью, плюс соседние клетки — чтобы камни
  // на стыке клеток сходились.
  const pts: [number, number, number][] = [];
  for (let cx = -1; cx <= 1; cx++)
    for (let gy = 0; gy < 3; gy++)
      for (let gx = 0; gx < 3; gx++) {
        const r = hash(wx + cx, wy, gx * 3 + gy);
        pts.push([
          cx * TS + gx * 5.5 + 2 + ((r % 100) / 100) * 3,
          gy * 5.5 + 2 + (((r >>> 8) % 100) / 100) * 3,
          r,
        ]);
      }
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      let d1 = 1e9;
      let d2 = 1e9;
      let own = 0;
      for (const [cx, cy, r] of pts) {
        const d = (x - cx) * (x - cx) + (y - cy) * (y - cy) * 1.3;
        if (d < d1) {
          d2 = d1;
          d1 = d;
          own = r;
        } else if (d < d2) d2 = d;
      }
      if (Math.sqrt(d2) - Math.sqrt(d1) < 1.05) {
        px.set(x, y, P.ink);
        continue;
      }
      // Верх камня светлее: свет сверху, как у кирпича набора.
      const top = y > 0 && Math.sqrt(d2) - Math.sqrt(d1) < 2.4 && y < 15;
      const shade = own % 5;
      let c: RGBA = shade === 0 ? P.rockSpeck : P.stone;
      if (top && own % 3 !== 0) c = P.stoneLight;
      px.set(x, y, c);
    }
  // Верхняя строка — светлый край, как первый ряд кирпича.
  for (let x = 0; x < TS; x++) if (px.get(x, 0)[0] !== P.ink[0]) px.set(x, 0, P.stoneLight);
  // Прожилка пирита.
  const h = hash(wx, wy, 9);
  if (h % 9 === 0) {
    const x = 3 + (h % 9);
    const y = 4 + ((h >>> 8) % 8);
    px.set(x, y, P.ore);
    px.set(x + 1, y + 1, P.ore);
    px.set(x + 1, y, P.oreLight);
  }
  return px;
}

/**
 * Рама крепи на лице: стойка у края и верхняк поперёк. Рама — на две
 * клетки: левая клетка несёт левую стойку, правая — правую.
 */
function timberOnFace(px: Px, left: boolean, right: boolean): void {
  const post = (x0: number) => {
    px.rect(x0, 1, x0 + 2, TS - 1, P.wood);
    px.rect(x0, 1, x0, TS - 1, P.woodDark);
    px.rect(x0 + 2, 1, x0 + 2, TS - 1, P.woodLight);
    for (let y = 3; y < TS; y += 5) px.set(x0 + 1, y, P.woodDark);
    px.set(x0 - 1, TS - 1, P.ink);
    px.set(x0 + 3, TS - 1, P.ink);
  };
  if (left) post(1);
  if (right) post(TS - 4);
  // Верхняк — поперёк всей клетки.
  px.rect(0, 0, TS - 1, 3, P.wood);
  px.rect(0, 0, TS - 1, 0, P.woodLight);
  px.rect(0, 3, TS - 1, 3, P.woodDark);
  px.rect(0, 4, TS - 1, 4, P.ink);
  for (let x = 2; x < TS; x += 6) px.set(x, 1, P.woodDark);
}

// ---------------------------------------------------------------------------
// Клетка стены.
// ---------------------------------------------------------------------------

export type WallLook = 'brick' | 'rock';

export const wallLookOf = (area: AreaId): WallLook => (area === 'mouth' ? 'brick' : 'rock');

/**
 * Сплошная клетка целиком: лицо, кромки, углы, порода. `timber` — через
 * какой шаг ставить раму крепи (0 — не ставить).
 */
export function wallCell(a: Around, look: WallLook, wx: number, wy: number): Px | null {
  if (!atlas) return null;
  const oL = a.open(-1, 0);
  const oR = a.open(1, 0);
  const oU = a.open(0, -1);
  const oD = a.open(0, 1);
  const fL = !oL && isFace(a, -1, 0);
  const fR = !oR && isFace(a, 1, 0);
  const fD = !oD && isFace(a, 0, 1);
  const fDL = isFace(a, -1, 1);
  const fDR = isFace(a, 1, 1);
  const oUL = a.open(-1, -1);
  const oUR = a.open(1, -1);
  // Рама крепи: у Откатки — через три клетки, на две клетки лица (рама
  // не встаёт на обрубок стены).
  const frameL = look === 'rock' && oD && wx % 4 === 0 && isFace(a, 1, 0);
  const frameR = look === 'rock' && oD && wx % 4 === 1 && isFace(a, -1, 0);
  const timber = frameL || frameR;
  // Узор клетки — вариант из 64; скальное лицо сшивается с соседями и
  // зависит от точных координат, его не кешируем (кусок карты и так
  // рисуется один раз).
  const v = hash(wx, wy, 3) % 64;
  const bits = [oL, oR, oU, oD, fL, fR, fD, fDL, fDR, oUL, oUR, frameL, frameR]
    .map((b) => (b ? 1 : 0))
    .join('');
  const make = () => {
    let px: Px;
    if (oD) {
      // Лицо стены.
      px = look === 'brick' ? brickFace(v) : rockFace(wx, wy);
      if (timber) timberOnFace(px, frameL, frameR);
      // Торец стены, выходящий в пол слева или справа.
      if (oL) vStrip(px, 0, wy);
      if (oR) vStrip(px, TS - 5, wy);
      // Край кладки у соседа-породы: тёмная черта.
      if (!oL && !fL) for (let y = 0; y < TS; y++) px.set(0, y, P.ink);
      if (!oR && !fR) for (let y = 0; y < TS; y++) px.set(TS - 1, y, P.ink);
      return px;
    }
    px = new Px(TS, TS);
    paintRock(px, v);
    // Кромка над лицом стены снизу.
    if (fD) {
      hStrip(px, TS - 4, wx, true);
      if (!fDL && !a.open(-1, 1)) px.rect(0, TS - 3, 0, TS - 1, P.ink);
      if (!fDR && !a.open(1, 1)) px.rect(TS - 1, TS - 3, TS - 1, TS - 1, P.ink);
    }
    // Кромка у пола сверху (стена к нам спиной — видно только верх).
    if (oU) hStrip(px, 0, wx, false);
    // Кромки вдоль пола сбоку — и вдоль лица соседа: стена сбоку поднимается
    // до кромки над лицом.
    if (oL || fL) vStrip(px, 0, wy);
    if (oR || fR) vStrip(px, TS - 5, wy);
    // Угол: боковая полоса встречает кромку над лицом соседа снизу.
    if (!fD && fDL && !oL && !a.open(0, 1)) {
      px.rect(0, TS - 4, 4, TS - 4, P.ink);
      for (let y = TS - 3; y < TS; y++) {
        px.set(0, y, P.ink);
        px.rect(1, y, 3, y, y === TS - 1 ? P.rimLight : P.rim);
        px.set(4, y, P.ink);
      }
    }
    if (!fD && fDR && !oR && !a.open(0, 1)) {
      px.rect(TS - 5, TS - 4, TS - 1, TS - 4, P.ink);
      for (let y = TS - 3; y < TS; y++) {
        px.set(TS - 5, y, P.ink);
        px.rect(TS - 4, y, TS - 2, y, y === TS - 1 ? P.rimLight : P.rim);
        px.set(TS - 1, y, P.ink);
      }
    }
    // Внешние углы: пол только по диагонали сверху — стык двух кромок.
    if (oUL && !oU && !oL) {
      px.rect(0, 0, 4, 3, P.rim);
      px.rect(0, 0, 4, 0, P.rimLight);
      px.rect(0, 3, 4, 3, P.ink);
      px.rect(4, 0, 4, 3, P.ink);
    }
    if (oUR && !oU && !oR) {
      px.rect(TS - 5, 0, TS - 1, 3, P.rim);
      px.rect(TS - 5, 0, TS - 1, 0, P.rimLight);
      px.rect(TS - 5, 3, TS - 1, 3, P.ink);
      px.rect(TS - 5, 0, TS - 5, 3, P.ink);
    }
    return px;
  };
  if (oD && look === 'rock') return make();
  return cachedPx(`w:${look}:${wx % 7}:${wy % 7}:${v}:${bits}`, make);
}

// ---------------------------------------------------------------------------
// Пол.
// ---------------------------------------------------------------------------

/** Какой пол у района: плиты (выложенное) или грунт (дикая выработка). */
export type FloorLook = 'slab' | 'ground';
export const floorLookOf = (area: AreaId): FloorLook => (area === 'mouth' ? 'slab' : 'ground');

/** Сглаженный шум по мировым пикселям — пятна грунта без швов. */
// Узлы решётки шума — считаются один раз на весь мир: кусок карты рисует
// 65 тысяч пикселей грунта, и хеш на каждый узел каждого пикселя стоил
// 15–40 мс на кусок — запинка при входе в новый кусок.
const lattice = new Map<string, Float32Array>();
const LAT_W = 512;
function latticeOf(s: number, seed: number): Float32Array {
  const key = `${s}:${seed}`;
  let a = lattice.get(key);
  if (!a) {
    a = new Float32Array(LAT_W * LAT_W).fill(-1);
    lattice.set(key, a);
  }
  return a;
}

function vnoise(x: number, y: number, s: number, seed: number): number {
  const xi = Math.floor(x / s);
  const yi = Math.floor(y / s);
  const fx = x / s - xi;
  const fy = y / s - yi;
  const lat = latticeOf(s, seed);
  const r = (a: number, b: number) => {
    // Мир — десятки узлов в ширину и сотни в высоту: решётка 512×512 с
    // заворотом вмещает его без повторов на глаз.
    const i = ((b & (LAT_W - 1)) * LAT_W + (a & (LAT_W - 1))) | 0;
    let v = lat[i];
    if (v < 0) {
      v = (hash(a, b, seed) % 1000) / 1000;
      lat[i] = v;
    }
    return v;
  };
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = r(xi, yi) * (1 - u) + r(xi + 1, yi) * u;
  const b = r(xi, yi + 1) * (1 - u) + r(xi + 1, yi + 1) * u;
  return a * (1 - v) + b * v;
}

const GROUND_DARK = hex('#3a2f2e');
const GROUND_MID = hex('#52433f');

/**
 * Грунт выработки: утоптанная порода пятнами, щебень, редкие трещины. Без
 * сетки — плитка на сотне клеток зала читалась клетчатой простынёй.
 */
function groundPx(wx: number, wy: number): Px {
  const px = new Px(TS, TS);
  const d = px.data;
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const X = wx * TS + x;
      const Y = wy * TS + y;
      const n = vnoise(X, Y, 11, 1) * 0.65 + vnoise(X, Y, 4, 2) * 0.35;
      const c = n < 0.36 ? GROUND_DARK : n > 0.66 ? GROUND_MID : P.stone;
      // Прямо в пиксели: `set` с округлением и смешиванием здесь лишний.
      const i = (y * TS + x) * 4;
      d[i] = c[0];
      d[i + 1] = c[1];
      d[i + 2] = c[2];
      d[i + 3] = 255;
    }
  // Щебень: камешек — светлая макушка и тень под ним.
  const h = hash(wx, wy, 5);
  const stones = h % 4;
  for (let i = 0; i < stones; i++) {
    const r = hash(wx, wy, 60 + i);
    const x = 1 + (r % 13);
    const y = 1 + ((r >>> 8) % 13);
    const big = (r >>> 16) % 3 === 0;
    px.set(x, y, P.stoneLight);
    if (big) {
      px.set(x + 1, y, P.stoneLight);
      px.set(x, y + 1, P.stone);
      px.set(x + 1, y + 1, P.stone);
      px.set(x, y + 2, P.ink);
      px.set(x + 1, y + 2, P.ink);
    } else px.set(x, y + 1, P.ink);
  }
  // Трещина — ломаная тёмная черта.
  if (h % 9 === 0) {
    let x = 2 + ((h >>> 4) % 10);
    let y = 2 + ((h >>> 8) % 6);
    for (let i = 0; i < 7; i++) {
      px.set(x, y, P.ink);
      const r = hash(wx, wy, 80 + i) % 3;
      x += r === 0 ? -1 : r === 1 ? 1 : 0;
      y += 1;
    }
  }
  return px;
}

/** Плиты Устья: чистые — основа, со сколами — редко, выбоины — совсем редко. */
function slabPx(h: number): Px {
  const r = h % 100;
  const light = ['floor_2', 'floor_3', 'floor_5'] as const;
  const heavy = ['floor_4', 'floor_6', 'floor_7', 'floor_8'] as const;
  const name: X72Name = r < 84 ? 'floor_1' : r < 96 ? light[(h >>> 8) % 3] : heavy[(h >>> 8) % 4];
  return x72(name)!;
}

/**
 * Клетка пола. `wallN/W/E` — сплошное сверху и сбоку: тень у подножия.
 * `look` — плиты или грунт (по умолчанию — как у района).
 */
export function floorCell(
  area: AreaId,
  wx: number,
  wy: number,
  wallN: boolean,
  wallW: boolean,
  wallE: boolean,
  look: FloorLook = floorLookOf(area),
  bare = false,
): Px | null {
  if (!atlas) return null;
  const h = hash(wx, wy, 1);
  if (look === 'ground') {
    // Грунт сшит шумом с соседями — не кешируется, как и скальное лицо.
    const px = groundPx(wx, wy);
    if (!bare) groundLitter(px, wx, wy);
    shadeFloor(px, wallN, wallW, wallE);
    return px;
  }
  // Весь рисунок плиты — из номера варианта: одинаковый ключ кеша обязан
  // давать одинаковую картинку, иначе вид зависел бы от порядка обхода.
  const vv = h % 512;
  const key = `f:${vv}:${wallN ? 1 : 0}${wallW ? 1 : 0}${wallE ? 1 : 0}`;
  return cachedPx(key, () => {
    const hv = hash(vv, 41, 2);
    const px = slabPx(hv);
    // Мелочь поверх плиты: камешки, крошка.
    const bits = (hv >>> 20) % 11;
    if (bits === 1 || bits === 2) {
      const x = 3 + (hv % 9);
      const y = 4 + ((hv >>> 4) % 8);
      px.set(x, y, P.stoneLight);
      px.set(x + 1, y, P.stoneLight);
      px.set(x, y + 1, P.ink);
      px.set(x + 1, y + 1, P.ink);
    }
    if (bits === 3) {
      for (let i = 0; i < 4; i++) {
        const r = hash(vv, 43, 50 + i);
        px.set(2 + (r % 12), 2 + ((r >>> 8) % 12), P.stoneLight);
      }
    }
    shadeFloor(px, wallN, wallW, wallE);
    return px;
  });
}

/** Тень у подножия стены — как `edge_down` набора, но мягче. */
const BONE = hex('#cdbfa6');
const BONE_DARK = hex('#8d7f6c');

/** Кости: рисунком, а не линией — у линии не читаются шишки на концах. */
const BONES = [
  ['X.....X', 'XXXXXXX', 'X.....X'],
  ['XX....', 'XXX...', '..X...', '...X..', '...XXX', '....XX'],
  ['....XX', '...XXX', '...X..', '..X...', 'XXX...', 'XX....'],
];

function drawBone(px: Px, pic: string[], ox: number, oy: number): void {
  const at = (x: number, y: number) => pic[y]?.[x] === 'X';
  for (let y = 0; y < pic.length; y++)
    for (let x = 0; x < pic[y].length; x++) {
      if (!at(x, y)) continue;
      px.set(ox + x, oy + y, BONE);
      if (!at(x, y + 1)) px.set(ox + x, oy + y + 1, BONE_DARK);
    }
}

/**
 * Мелочь на грунте: кости, череп, щепа крепи, самородок пирита, ржавый
 * костыль. Одна клетка из ~40 и только на голом грунте — пятно на каждом
 * шагу перестаёт быть находкой и становится узором.
 */
function groundLitter(px: Px, wx: number, wy: number): void {
  const r = hash(wx, wy, 71);
  if (r % 40 !== 0) return;
  const kind = (r >>> 8) % 10;
  const ox = 3 + ((r >>> 12) % 7);
  const oy = 4 + ((r >>> 16) % 6);
  if (kind < 3) {
    // Две кости вразброс.
    drawBone(px, BONES[kind], ox - 2, oy - 2);
    drawBone(px, BONES[(kind + 1) % 3], ox + 1, oy + 2);
  } else if (kind < 4) {
    const skull = x72('skull');
    if (skull) blit(px, skull, 0, 0);
  } else if (kind < 7) {
    // Щепа от крепи.
    for (let i = 0; i < 3; i++) {
      const q = hash(wx, wy, 80 + i);
      const x = 2 + (q % 11);
      const y = 3 + ((q >>> 4) % 10);
      const n = 2 + ((q >>> 8) % 3);
      for (let k = 0; k < n; k++) {
        px.set(x + k, y + (q & 1 ? 0 : k >> 1), P.woodLight);
        px.set(x + k, y + 1 + (q & 1 ? 0 : k >> 1), P.woodDark);
      }
    }
  } else if (kind < 9) {
    // Самородок пирита.
    px.set(ox, oy, P.oreLight);
    px.set(ox + 1, oy, P.ore);
    px.set(ox - 1, oy + 1, P.ore);
    px.set(ox, oy + 1, P.ore);
    px.set(ox + 1, oy + 1, P.ore);
    px.set(ox + 2, oy + 1, P.stone);
    for (let x = -1; x <= 2; x++) px.set(ox + x, oy + 2, P.ink);
  } else {
    // Ржавый костыль от рельса.
    for (let k = 0; k < 5; k++) {
      px.set(ox + k, oy + (k >> 2), P.ironDark);
      px.set(ox + k, oy - 1 + (k >> 2), k === 0 ? P.ironLight : P.wood);
    }
    px.set(ox - 1, oy - 2, P.ironDark);
    px.set(ox - 1, oy - 1, P.ironDark);
    px.set(ox - 1, oy, P.ironDark);
  }
}

function shadeFloor(px: Px, wallN: boolean, wallW: boolean, wallE: boolean): void {
  if (wallN) {
    for (let x = 0; x < TS; x++) {
      px.set(x, 0, [0, 0, 0, 150]);
      px.set(x, 1, [0, 0, 0, 100]);
      px.set(x, 2, [0, 0, 0, 55]);
      px.set(x, 3, [0, 0, 0, 25]);
    }
  }
  if (wallW) for (let y = 0; y < TS; y++) px.set(0, y, [0, 0, 0, 70]);
  if (wallE) for (let y = 0; y < TS; y++) px.set(TS - 1, y, [0, 0, 0, 70]);
}

/**
 * Кромка над лицом стены, если стена в одну клетку толщиной и над ней пол:
 * полоса ложится на пол сверху.
 */
export function rimOverFloor(wx: number): Px | null {
  if (!atlas) return null;
  return cachedPx(`rimf:${wx % 7}`, () => {
    const px = new Px(TS, TS);
    hStrip(px, TS - 4, wx, true);
    return px;
  });
}

// ---------------------------------------------------------------------------
// Вода. Лужи были одинаковыми овалами на клетку и читались пуговицами на
// полу; теперь лужа — одно пятно на сколько угодно клеток: край
// скруглён, у берега мокрая тёмная полоса и светлая черта уреза.
// ---------------------------------------------------------------------------

const WATER = hex('#1b2830');
const WATER_MID = hex('#22333d');
const WATER_EDGE = hex('#5d7d8c');
const WATER_GLINT = hex('#9cc3d3');
const WET = hex('#2c2322');

/** Клетка воды поверх пола. `water(dx, dy)` — вода ли у соседа. */
export function waterCell(
  water: (dx: number, dy: number) => boolean,
  wx: number,
  wy: number,
): Px | null {
  if (!atlas) return null;
  const n = [
    water(0, -1),
    water(1, 0),
    water(0, 1),
    water(-1, 0),
    water(1, -1),
    water(1, 1),
    water(-1, 1),
    water(-1, -1),
  ];
  const v = hash(wx, wy, 13) % 8;
  const key = `water:${v}:${n.map((b) => (b ? 1 : 0)).join('')}`;
  return cachedPx(key, () => {
    const px = new Px(TS, TS);
    const [up, right, down, left, ur, dr, dl, ul] = n;
    // Насколько пиксель внутри пятна: 0 — берег, 1 — глубина.
    const inside = (x: number, y: number) => {
      let d = 99;
      if (!up) d = Math.min(d, y);
      if (!down) d = Math.min(d, TS - 1 - y);
      if (!left) d = Math.min(d, x);
      if (!right) d = Math.min(d, TS - 1 - x);
      // Углы: выпуклые — скругляем, вогнутые (сосед по диагонали сухой) —
      // маленький мыс.
      const corner = (cx: number, cy: number, a: boolean, b: boolean, diag: boolean) => {
        const dd = Math.hypot(x - cx, y - cy);
        if (!a && !b) d = Math.min(d, dd - 3.5);
        else if (a && b && !diag) d = Math.min(d, dd + 1.2);
      };
      corner(0, 0, up, left, ul);
      corner(TS - 1, 0, up, right, ur);
      corner(0, TS - 1, down, left, dl);
      corner(TS - 1, TS - 1, down, right, dr);
      return d;
    };
    for (let y = 0; y < TS; y++)
      for (let x = 0; x < TS; x++) {
        const d = inside(x, y);
        if (d < 0) continue;
        if (d < 1.2) px.set(x, y, WET);
        else if (d < 2.2) px.set(x, y, WATER_EDGE);
        else px.set(x, y, d < 4 ? WATER_MID : WATER);
      }
    // Верхний берег бросает тень на воду — вода ниже пола.
    if (!up)
      for (let x = 0; x < TS; x++) {
        const y = 2;
        if (inside(x, y) >= 2) px.set(x, y, WATER);
      }
    // Блики свода — редкие горизонтальные чёрточки.
    const r = hash(v, 7, 1);
    for (let i = 0; i < (v < 3 ? 1 : 0); i++) {
      const gx = 3 + ((r >>> (i * 8)) % 9);
      const gy = 5 + ((r >>> (i * 8 + 4)) % 7);
      if (inside(gx, gy) > 3 && inside(gx + 2, gy) > 3) {
        px.set(gx, gy, WATER_GLINT);
        px.set(gx + 1, gy, WATER_GLINT);
        px.set(gx + 2, gy, WATER_EDGE);
      }
    }
    return px;
  });
}

// ---------------------------------------------------------------------------
// Рельсы: шпалы тёмного дерева в обводке и две нитки с бликом.
// ---------------------------------------------------------------------------

export function railCell(axis: 'v' | 'h', wx: number, wy: number): Px | null {
  if (!atlas) return null;
  const v = hash(wx, wy, 17) % 4;
  return cachedPx(`rail:${axis}:${v}`, () => {
    const px = new Px(TS, TS);
    // Шпалы — через 4 px, со сдвигом по варианту, чтобы ряд не был линейкой.
    for (let k = 0; k < 4; k++) {
      const a = k * 4 + 1;
      const skew = (hash(v, k, 3) % 3) - 1;
      for (let s = 1 + skew; s < 15 + skew; s++) {
        const edge = s === 1 + skew || s === 14 + skew;
        const c = edge ? P.woodDark : P.wood;
        if (axis === 'v') {
          px.set(s, a, c);
          px.set(s, a + 1, P.woodDark);
          px.set(s, a + 2, [0, 0, 0, 90]);
        } else {
          px.set(a, s, c);
          px.set(a + 1, s, P.woodDark);
          px.set(a + 2, s, [0, 0, 0, 90]);
        }
      }
    }
    for (const rail of [4, 11]) {
      for (let s = 0; s < TS; s++) {
        if (axis === 'v') {
          px.set(rail - 1, s, P.ink);
          px.set(rail, s, P.ironDark);
          px.set(rail + 1, s, s % 6 === 0 ? P.ironLight : P.iron);
          px.set(rail + 2, s, [0, 0, 0, 110]);
        } else {
          px.set(s, rail - 1, s % 6 === 0 ? P.ironLight : P.iron);
          px.set(s, rail, P.ironDark);
          px.set(s, rail + 1, P.ink);
          px.set(s, rail + 2, [0, 0, 0, 110]);
        }
      }
    }
    return px;
  });
}
