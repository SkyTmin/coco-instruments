// Pixel UI kit — the painter. Pure TS, no DOM: `scripts/ui-px/bake.ts` draws every piece into
// `public/ui/kit/<name>.png` and writes `src/ui-px/kit.gen.css` (slices measured from the
// pixels). The game never imports this file — only the generated CSS and the PNGs.
// Rules: `.claude/rules/ui-px.md` (materials, ramps, light from the upper left, 1-px ink outline —
// the same look as the pixel pets and props).

import { RARITIES } from '../lib/rarity';

export type RGBA = [number, number, number, number];

export function hex(h: string, a = 255): RGBA {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
}

/** A tiny RGBA canvas. `set` overwrites (no blending): kit pieces are opaque or fully clear. */
export class Pix {
  readonly data: Uint8ClampedArray;
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.data = new Uint8ClampedArray(w * h * 4);
  }
  set(x: number, y: number, c: RGBA | null): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    if (!c) {
      this.data.fill(0, i, i + 4);
      return;
    }
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
    this.data[i + 3] = c[3];
  }
  get(x: number, y: number): RGBA {
    const i = (y * this.w + x) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
  }
  alpha(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.data[(y * this.w + x) * 4 + 3];
  }
  rect(x: number, y: number, w: number, h: number, c: RGBA | null): void {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c);
  }
}

// ---- Palettes: 5 tones dark → light, one ink -------------------------------------------------

export const INK = hex('#120a0e');
const ramp = (...c: string[]): RGBA[] => c.map((s) => hex(s));

// Wave 2 palette (owner 13.10: the dark look was «не особо всё хорошо видно»): light, warm.
// `obsidian` is the INTERIOR ramp — the fill of every frame, wells, slot wells, tooltips — and is
// now light parchment, so text inside is dark ink (`--px-text` in ui-px.css); `stone` is warm
// sandstone (lit stages, pedestal), `wood` honey (window frames). Contrast table:
// `.claude/rules/ui-px.md` → Materials.

export const MAT = {
  stone: ramp('#6b5238', '#a08462', '#c4a985', '#e0cba8', '#f8ecd2'),
  iron: ramp('#1a1e25', '#2a3039', '#404853', '#5e6875', '#8e99a7'),
  wood: ramp('#3a2010', '#6b3f20', '#94592e', '#bd7a3e', '#e3a25c'),
  parch: ramp('#73502c', '#a27b4b', '#caa56e', '#e3c893', '#f5e5bb'),
  obsidian: ramp('#6a4526', '#f0dfba', '#e4cc9c', '#c9a56d', '#fff6e0'),
  gold: ramp('#4a2c06', '#84530e', '#bf8318', '#f0b136', '#ffe189'),
  red: ramp('#3a0a0c', '#6a1714', '#a0261c', '#d2432d', '#ff8466'),
  green: ramp('#0c2a12', '#17451c', '#25692a', '#3e9a3a', '#86d46c'),
  ash: ramp('#26262a', '#36363c', '#4a4a51', '#606068', '#83838c'),
} as const;
export type Material = keyof typeof MAT;

const RIVET = hex('#d3dbe4');
const SHEEN = hex('#9a88c8');

// ---- Shape: a rounded rect mask + BFS depth from the outside ---------------------------------

/** 4-neighbour distance from the outside of a rounded rect (corner radius `r`); −1 = outside. */
function depthMap(w: number, h: number, r: number): Int16Array {
  const d = new Int16Array(w * h).fill(-1);
  const inside = (x: number, y: number) => {
    const cx = x < r ? r - x - 0.5 : x >= w - r ? x - (w - r) + 0.5 : 0;
    const cy = y < r ? r - y - 0.5 : y >= h - r ? y - (h - r) + 0.5 : 0;
    return cx * cx + cy * cy <= r * r + 0.01 || cx === 0 || cy === 0;
  };
  const q: number[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!inside(x, y)) continue;
      const edge =
        x === 0 ||
        y === 0 ||
        x === w - 1 ||
        y === h - 1 ||
        !inside(x - 1, y) ||
        !inside(x + 1, y) ||
        !inside(x, y - 1) ||
        !inside(x, y + 1);
      if (edge) {
        d[y * w + x] = 0;
        q.push(y * w + x);
      }
    }
  for (let k = 0; k < q.length; k++) {
    const i = q[k];
    const x = i % w;
    const y = (i / w) | 0;
    for (const [nx, ny] of [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ]) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (d[j] !== -1 || !inside(nx, ny)) continue;
      d[j] = d[i] + 1;
      q.push(j);
    }
  }
  return d;
}

/** Which way a ring pixel faces: light (top/left) or dark (bottom/right). Light from the upper left. */
const lit = (x: number, y: number, w: number, h: number) =>
  Math.min(x, y) <= Math.min(w - 1 - x, h - 1 - y);

/** Along-the-edge coordinate (for periodic edge textures) and the side. */
function sideOf(x: number, y: number, w: number, h: number): ['t' | 'b' | 'l' | 'r', number] {
  const m = Math.min(y, h - 1 - y, x, w - 1 - x);
  if (m === y) return ['t', x];
  if (m === h - 1 - y) return ['b', x];
  if (m === x) return ['l', y];
  return ['r', y];
}

interface Ring {
  /** Colour at depth `d` for a lit/dark side; null — transparent. Past the last layer — the fill. */
  layers: [RGBA | null, RGBA | null][];
  fill: RGBA | null;
}

function ring(p: Pix, r: number, spec: Ring, dy = 0, hh = p.h): Int16Array {
  const d = depthMap(p.w, hh, r);
  for (let y = 0; y < hh; y++)
    for (let x = 0; x < p.w; x++) {
      const k = d[y * p.w + x];
      if (k < 0) continue;
      const L = spec.layers[k];
      p.set(x, y + dy, L ? L[lit(x, y, p.w, hh) ? 0 : 1] : spec.fill);
    }
  return d;
}

// ---- Pieces --------------------------------------------------------------------------------------

export type Slice = [number, number, number, number];
export interface Piece {
  /** File name `public/ui/kit/<name>.png` and CSS class suffix. */
  name: string;
  /** 'frame' — 9-slice for border-image (slice measured by the bake); 'tile' — background tile;
   *  'icon' — white mask (CSS `mask` + currentColor); 'img' — a plain picture. */
  kind: 'frame' | 'tile' | 'icon' | 'img';
  /** Declared slice (top right bottom left, art px). The bake measures it from the pixels and fails
   *  on a mismatch. */
  slice?: Slice;
  /** `repeat` for edges with a periodic texture, `stretch` for uniform edges. */
  repeat?: 'stretch' | 'repeat';
  /** Paint the centre (border-image `fill`). */
  fill?: boolean;
  /** Fixed height (ribbon): only left/right are sliced, every row may differ. */
  fixedH?: boolean;
  draw: () => Pix;
}

/** A frame: ring of layers, optional edge texture, corner ornament. Square, 2N + period. */
function frame(
  N: number,
  period: number,
  r: number,
  spec: Ring,
  deco?: (p: Pix, d: Int16Array) => void,
): Pix {
  const s = 2 * N + period;
  const p = new Pix(s, s);
  const d = ring(p, r, spec);
  deco?.(p, d);
  return p;
}

/** Corner ornament stamped into all four corners, mirrored (so light stays upper-left on the
 *  stamp itself — the stamp is drawn per corner by a callback with mirror flags). */
function corners(
  p: Pix,
  fn: (sx: number, sy: number, mx: boolean, my: boolean) => void,
  inset: number,
) {
  fn(inset, inset, false, false);
  fn(p.w - 1 - inset, inset, true, false);
  fn(inset, p.h - 1 - inset, false, true);
  fn(p.w - 1 - inset, p.h - 1 - inset, true, true);
}

/** A rivet: 2×2 dome, light pixel upper-left, shadow pixel lower-right outside the dome. */
function rivet(p: Pix, x: number, y: number, tone: readonly RGBA[]) {
  p.set(x, y, RIVET);
  p.set(x + 1, y, tone[3]);
  p.set(x, y + 1, tone[3]);
  p.set(x + 1, y + 1, tone[2]);
  p.set(x + 2, y + 1, tone[0]);
  p.set(x + 1, y + 2, tone[0]);
  p.set(x + 2, y + 2, tone[0]);
}

const STONE: Ring = {
  layers: [
    [INK, INK],
    [MAT.stone[4], MAT.stone[1]],
    [MAT.stone[3], MAT.stone[2]],
    [MAT.stone[3], MAT.stone[2]],
    [MAT.stone[2], MAT.stone[1]],
    [MAT.stone[0], MAT.stone[0]],
  ],
  fill: MAT.obsidian[1],
};

function stoneDeco(p: Pix, d: Int16Array) {
  // Block seams every 10 px along the edges: a dark line with a lit pixel on its left/top.
  const N = 6;
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      const k = d[y * p.w + x];
      if (k < 1 || k > 4) continue;
      const [side, a] = sideOf(x, y, p.w, p.h);
      const inCorner = (x < N || x >= p.w - N) && (y < N || y >= p.h - N);
      if (inCorner) continue;
      const along = a - N;
      if (along === 4) p.set(x, y, MAT.stone[0]);
      else if (along === 5 && k > 1 && k < 4)
        p.set(x, y, side === 't' || side === 'l' ? MAT.stone[4] : MAT.stone[3]);
      else if ((along * 7 + k * 3) % 11 === 0 && k > 1 && k < 4) p.set(x, y, MAT.stone[1]);
    }
  // Cornerstones: a seam closing the corner square, one chipped pixel.
  for (let i = 1; i < N - 1; i++) {
    p.set(N - 1, i, MAT.stone[0]);
    p.set(i, N - 1, MAT.stone[0]);
    p.set(p.w - N, i, MAT.stone[0]);
    p.set(p.w - 1 - i, N - 1, MAT.stone[0]);
    p.set(N - 1, p.h - 1 - i, MAT.stone[0]);
    p.set(i, p.h - N, MAT.stone[0]);
    p.set(p.w - N, p.h - 1 - i, MAT.stone[0]);
    p.set(p.w - 1 - i, p.h - N, MAT.stone[0]);
  }
  p.set(2, 2, MAT.stone[4]);
  p.set(p.w - 3, 2, MAT.stone[3]);
}

const IRON: Ring = {
  layers: [
    [INK, INK],
    [MAT.iron[4], MAT.iron[1]],
    [MAT.iron[3], MAT.iron[2]],
    [MAT.iron[2], MAT.iron[2]],
    [MAT.iron[1], MAT.iron[1]],
    [INK, INK],
  ],
  fill: MAT.obsidian[1],
};

const WOOD: Ring = {
  layers: [
    [INK, INK],
    [MAT.wood[4], MAT.wood[1]],
    [MAT.wood[3], MAT.wood[2]],
    [MAT.wood[2], MAT.wood[2]],
    [MAT.wood[3], MAT.wood[1]],
    [MAT.wood[2], MAT.wood[1]],
    [MAT.wood[1], MAT.wood[0]],
    [INK, INK],
  ],
  fill: MAT.obsidian[1],
};

function woodDeco(p: Pix, d: Int16Array) {
  const N = 8;
  // Grain: streaks along the edge, period 12 (edges tile with `repeat`).
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      const k = d[y * p.w + x];
      if (k < 2 || k > 6) continue;
      const [, a] = sideOf(x, y, p.w, p.h);
      const along = (((a - N) % 12) + 12) % 12;
      const t = (along * 5 + k * 7) % 12;
      if (t === 0 || (t === 6 && k === 4)) p.set(x, y, MAT.wood[1]);
      else if (t === 3 && k < 5) p.set(x, y, MAT.wood[4]);
    }
  // Iron brackets: an L of iron in each corner with a rivet.
  corners(
    p,
    (sx, sy, mx, my) => {
      const X = (i: number) => (mx ? sx - i : sx + i);
      const Y = (j: number) => (my ? sy - j : sy + j);
      for (let i = 0; i < 7; i++)
        for (let j = 0; j < 7; j++) {
          if (i > 3 && j > 3) continue;
          if (i > 3 && j > 2) continue;
          if (j > 3 && i > 2) continue;
          const edge =
            i === 0 || j === 0 || i === 6 || j === 6 || (i === 3 && j > 3) || (j === 3 && i > 3);
          p.set(
            X(i),
            Y(j),
            edge ? INK : (mx ? i > 1 : i < 2) || (my ? j > 1 : j < 2) ? MAT.iron[3] : MAT.iron[2],
          );
        }
      const rx = mx ? sx - 3 : sx + 1;
      const ry = my ? sy - 3 : sy + 1;
      rivet(p, rx, ry, MAT.iron);
    },
    0,
  );
}

const PARCH: Ring = {
  layers: [
    [MAT.parch[0], MAT.parch[0]],
    [MAT.parch[4], MAT.parch[1]],
    [MAT.parch[3], MAT.parch[2]],
  ],
  fill: MAT.parch[3],
};

const OBSIDIAN: Ring = {
  layers: [
    [INK, INK],
    [MAT.obsidian[4], MAT.obsidian[2]],
    [MAT.obsidian[3], MAT.obsidian[1]],
    [MAT.obsidian[1], MAT.obsidian[1]],
    [MAT.obsidian[0], MAT.obsidian[0]],
  ],
  fill: MAT.obsidian[1],
};

function obsidianDeco(p: Pix) {
  // Violet glints in the corners: a 2×2 gem with a sheen pixel.
  corners(
    p,
    (sx, sy, mx, my) => {
      const x = mx ? sx - 3 : sx + 2;
      const y = my ? sy - 3 : sy + 2;
      p.set(x, y, SHEEN);
      p.set(x + 1, y, MAT.obsidian[4]);
      p.set(x, y + 1, MAT.obsidian[4]);
      p.set(x + 1, y + 1, MAT.obsidian[3]);
    },
    0,
  );
}

/** Inner panel (sunken): dark well with a 1-px light lip at the bottom/right — light from upper left. */
const WELL: Ring = {
  layers: [
    [INK, INK],
    [MAT.obsidian[0], MAT.obsidian[3]],
  ],
  fill: MAT.obsidian[2],
};

/** Buttons: lit bevel top/left, dark bevel bottom/right, a 2-px dark lip under the body (its
 *  thickness). Pressed: the body sits 2 px lower and the lip is gone — the content moves with it. */
function button(tone: readonly RGBA[], state: 'n' | 'h' | 'p'): Pix {
  const w = 12;
  const h = 14;
  const p = new Pix(w, h);
  const t: readonly RGBA[] =
    state === 'h'
      ? [tone[1], tone[2], tone[3], tone[4], RIVET]
      : state === 'p'
        ? [tone[0], tone[1], tone[2], tone[2], tone[3]]
        : tone;
  const lip = state === 'p' ? 0 : 2;
  const top = state === 'p' ? 2 : 0;
  const bh = h - lip - top;
  const d = depthMap(w, bh, 2);
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < w; x++) {
      const k = d[y * w + x];
      if (k < 0) continue;
      const L = lit(x, y, w, bh);
      const c = k === 0 ? INK : k === 1 ? (L ? t[4] : t[1]) : k === 2 && !L ? t[2] : t[3];
      p.set(x, y + top, c);
    }
  if (lip) {
    // The slab's dark side under the body, rounded like the body, ink below.
    for (let x = 1; x < w - 1; x++) p.set(x, bh, x === 1 || x === w - 2 ? INK : t[0]);
    for (let x = 2; x < w - 2; x++) p.set(x, bh + 1, INK);
  }
  return p;
}

/** Item cell: ink outline, rarity frame, inner shadow, dark well. Higher rarity → brighter corners. */
function slot(r: number): Pix {
  const R = RARITIES[r];
  const c = hex(R.color);
  const l = hex(R.light);
  const dk = hex(R.dark);
  const p = new Pix(10, 10);
  ring(p, 1, {
    layers: [
      [INK, INK],
      [c, c],
      [dk, dk],
      [INK, MAT.obsidian[1]],
    ],
    fill: MAT.obsidian[1],
  });
  // Top-left light on the rarity frame, darker bottom-right: same light as everything else.
  for (let i = 2; i < 8; i++) {
    p.set(i, 1, l);
    p.set(1, i, l);
  }
  if (r >= 3) {
    // Corner studs in the light tone.
    for (const [x, y] of [
      [1, 1],
      [8, 1],
      [1, 8],
      [8, 8],
    ])
      p.set(x, y, l);
  }
  return p;
}

/** Selection / focus ring: bright corner brackets + a thin line, transparent inside. Drawn OUTSIDE
 *  the element (border-image-outset), so it never covers the content. */
function focusRing(tone: RGBA, line: RGBA): Pix {
  const p = new Pix(11, 11);
  for (let i = 0; i < 11; i++)
    for (let j = 0; j < 11; j++) {
      const edge = i === 0 || j === 0 || i === 10 || j === 10;
      const inner = i === 1 || j === 1 || i === 9 || j === 9;
      if (!edge && !inner) continue;
      const corner = (i < 4 || i > 6) && (j < 4 || j > 6);
      if (edge) p.set(i, j, corner ? INK : null);
      if (inner) p.set(i, j, corner ? tone : line);
    }
  // Brackets two pixels thick in the corners.
  for (const [x, y] of [
    [2, 2],
    [8, 2],
    [2, 8],
    [8, 8],
  ]) {
    p.set(x, y, tone);
  }
  for (const [x, y] of [
    [0, 0],
    [10, 0],
    [0, 10],
    [10, 10],
  ])
    p.set(x, y, null);
  return p;
}

/** Tabs: raised plaque; `on` is taller, lighter and has no bottom edge (it joins the panel). */
function tab(on: boolean): Pix {
  const tone = on ? MAT.wood : MAT.iron;
  const p = new Pix(12, 12);
  const d = depthMap(12, on ? 13 : 12, 2);
  for (let y = 0; y < 12; y++)
    for (let x = 0; x < 12; x++) {
      const k = d[y * 12 + x];
      if (k < 0) continue;
      const L = lit(x, y, 12, on ? 13 : 12);
      p.set(x, y, k === 0 ? INK : k === 1 ? (L ? tone[4] : tone[1]) : on ? tone[3] : tone[2]);
    }
  return p;
}

/** Progress bar trough: ink outline, dark inset with a lit bottom lip. */
function trough(): Pix {
  const p = new Pix(8, 8);
  ring(p, 1, {
    layers: [
      [INK, INK],
      [MAT.obsidian[0], MAT.obsidian[3]],
    ],
    fill: MAT.obsidian[0],
  });
  return p;
}

/** Badge: small red pill with a lit top. */
function badge(tone: readonly RGBA[]): Pix {
  const p = new Pix(8, 8);
  ring(p, 2, {
    layers: [
      [INK, INK],
      [tone[4], tone[2]],
    ],
    fill: tone[3],
  });
  return p;
}

/** Keycap for key hints: light keycap with a darker lip. */
function keycap(): Pix {
  return button(MAT.parch, 'n');
}

/** Ribbon (heading plate): fixed 12 px tall, tails left and right, middle columns uniform. */
function ribbon(): Pix {
  const w = 22;
  const h = 12;
  const p = new Pix(w, h);
  const t = MAT.red;
  for (let x = 0; x < w; x++)
    for (let y = 0; y < h; y++) {
      const tail = x < 5 || x >= w - 5;
      const tx = x < 5 ? x : w - 1 - x; // 0..4 from the outer tip
      if (tail) {
        // Swallow-tail: the notch cuts in from the tip at mid height.
        const notch = Math.abs(y - (h - 1) / 2) < 2.5 - tx * 0.9 + 0.5 && tx < 3;
        if (y < 2 || y > h - 1 || notch) continue;
        const edge = y === 2 || y === h - 1 || tx === 0;
        p.set(x, y, edge ? INK : y < 5 ? t[2] : t[1]);
        if (!edge && tx === 4) p.set(x, y, t[0]);
        continue;
      }
      if (y === 0 || y === h - 3) p.set(x, y, INK);
      else if (y === 1) p.set(x, y, t[4]);
      else if (y < h - 3) p.set(x, y, y < 5 ? t[3] : t[2]);
      else if (y === h - 2) p.set(x, y, t[0]);
      else p.set(x, y, INK);
    }
  // The tails sit lower than the plate: shadow pixel where they meet.
  return p;
}

/** Seamless stone floor tile for stages (32×32): flagstones, seams, a few pebbles. */
function stoneTile(): Pix {
  const p = new Pix(32, 32);
  const base = [MAT.stone[1], MAT.stone[2]];
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      // Two rows of flagstones, offset by half (running bond), 16×16.
      const row = (y / 16) | 0;
      const ox = (x + (row ? 8 : 0)) % 32;
      const bx = ox % 16;
      const by = y % 16;
      let c = base[(((ox / 16) | 0) + row) % 2];
      if (by === 15 || bx === 15) c = MAT.stone[0];
      else if (by === 0 || bx === 0) c = MAT.stone[3];
      else if (((x * 13 + y * 7) ^ (x * y)) % 29 === 0) c = MAT.stone[0];
      p.set(x, y, c);
    }
  return p;
}

/** Pedestal under the showcased pet: a stone disc seen from above at the pets' camera tilt. */
function pedestal(): Pix {
  const w = 56;
  const h = 18;
  const p = new Pix(w, h);
  const cx = (w - 1) / 2;
  const top = 7; // ellipse half-height of the top face
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const nx = (x - cx) / (w / 2);
      const ty = (y - top) / top;
      const inTop = nx * nx + ty * ty <= 1;
      const sy = (y - (top + 4)) / top;
      const inSide = nx * nx + sy * sy <= 1 && y >= top;
      if (!inTop && !inSide) continue;
      let c: RGBA;
      if (inTop) {
        const lv = -nx * 0.6 - ty * 0.8; // light from the upper left
        c =
          lv > 0.55
            ? MAT.stone[4]
            : lv > 0.1
              ? MAT.stone[3]
              : lv > -0.4
                ? MAT.stone[2]
                : MAT.stone[1];
      } else c = nx < -0.5 ? MAT.stone[1] : MAT.stone[0];
      p.set(x, y, c);
    }
  // Ink outline round the silhouette.
  const a = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = p.alpha(x, y) ? 1 : 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!a[y * w + x]) continue;
      const out = [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ].some(([i, j]) => i < 0 || j < 0 || i >= w || j >= h || !a[j * w + i]);
      if (out) p.set(x, y, INK);
    }
  // Rim of the top face: seam between top and side.
  for (let x = 0; x < w; x++) {
    const nx = (x - cx) / (w / 2);
    if (Math.abs(nx) >= 0.97) continue;
    const y = Math.round(top + top * Math.sqrt(1 - nx * nx));
    if (p.alpha(x, y)) p.set(x, y, MAT.stone[0]);
  }
  return p;
}

// ---- Icons: 9×9 white masks (CSS `mask`, colour = currentColor) -------------------------------

const ICONS: Record<string, string[]> = {
  x: [
    '.........',
    '.##...##.',
    '.###.###.',
    '..#####..',
    '...###...',
    '..#####..',
    '.###.###.',
    '.##...##.',
    '.........',
  ],
  plus: [
    '.........',
    '...###...',
    '...###...',
    '.#######.',
    '.#######.',
    '.#######.',
    '...###...',
    '...###...',
    '.........',
  ],
  check: [
    '.........',
    '.......##',
    '......###',
    '.##..###.',
    '.#####...',
    '..###....',
    '...#.....',
    '.........',
    '.........',
  ],
  lock: [
    '...###...',
    '..#...#..',
    '..#...#..',
    '.#######.',
    '.###.###.',
    '.###.###.',
    '.#######.',
    '.#######.',
    '.........',
  ],
  left: [
    '.........',
    '....##...',
    '...##....',
    '..##.....',
    '.##......',
    '..##.....',
    '...##....',
    '....##...',
    '.........',
  ],
  right: [
    '.........',
    '...##....',
    '....##...',
    '.....##..',
    '......##.',
    '.....##..',
    '....##...',
    '...##....',
    '.........',
  ],
  up: [
    '.........',
    '.........',
    '....#....',
    '...###...',
    '..##.##..',
    '.##...##.',
    '.........',
    '.........',
    '.........',
  ],
  down: [
    '.........',
    '.........',
    '.##...##.',
    '..##.##..',
    '...###...',
    '....#....',
    '.........',
    '.........',
    '.........',
  ],
  star: [
    '....#....',
    '....#....',
    '...###...',
    '#########',
    '.#######.',
    '..#####..',
    '..##.##..',
    '.##...##.',
    '.#.....#.',
  ],
  heart: [
    '.........',
    '.##...##.',
    '####.####',
    '#########',
    '#########',
    '.#######.',
    '..#####..',
    '...###...',
    '....#....',
  ],
  paw: [
    '.#.....#.',
    '###...###',
    '.#.#.#.#.',
    '...#.#...',
    '..#####..',
    '.#######.',
    '.#######.',
    '..##.##..',
    '.........',
  ],
  sort: [
    '..#......',
    '.###.....',
    '#.#.#....',
    '..#......',
    '..#..###.',
    '..#......',
    '..#..##..',
    '.....#...',
    '.........',
  ],
  filter: [
    '#########',
    '.#######.',
    '..#####..',
    '...###...',
    '...###...',
    '...###...',
    '...###...',
    '...##....',
    '...#.....',
  ],
  play: [
    '.........',
    '.##......',
    '.####....',
    '.######..',
    '.#######.',
    '.######..',
    '.####....',
    '.##......',
    '.........',
  ],
  info: [
    '...###...',
    '...###...',
    '.........',
    '..####...',
    '...###...',
    '...###...',
    '...###...',
    '..#####..',
    '.........',
  ],
  sword: [
    '.......##',
    '......###',
    '.....###.',
    '#...###..',
    '##.###...',
    '.####....',
    '..##.....',
    '.#.##....',
    '#...#....',
  ],
  bolt: [
    '....###..',
    '...###...',
    '..###....',
    '.#######.',
    '....###..',
    '...###...',
    '..###....',
    '.###.....',
    '.#.......',
  ],
  zzz: [
    '.........',
    '..#####..',
    '.....#...',
    '....#....',
    '...#.....',
    '..#####..',
    '.........',
    '.........',
    '.........',
  ],
  pause: [
    '.........',
    '.###.###.',
    '.###.###.',
    '.###.###.',
    '.###.###.',
    '.###.###.',
    '.###.###.',
    '.###.###.',
    '.........',
  ],
  paws: [
    '.....#.#.',
    '....#...#',
    '.....###.',
    '.....###.',
    '.........',
    '.#.#.....',
    '#...#....',
    '.###.....',
    '.###.....',
  ],
  claw: [
    '...#.....',
    '#..#..#..',
    '##.##.##.',
    '.#..#..#.',
    '.#..#..#.',
    '.##.##.##',
    '..#..#..#',
    '..#..#..#',
    '.....#...',
  ],
  moon: [
    '...#.####',
    '.###...#.',
    '.##...#..',
    '###..####',
    '###......',
    '####.....',
    '.####....',
    '.#######.',
    '...###...',
  ],
  coin: [
    '..#####..',
    '.#######.',
    '###...###',
    '##..#..##',
    '##..#..##',
    '##..#..##',
    '###...###',
    '.#######.',
    '..#####..',
  ],
  token: [
    '...###...',
    '.#######.',
    '####.####',
    '###...###',
    '##.....##',
    '###...###',
    '####.####',
    '.#######.',
    '...###...',
  ],
  gem: [
    '.........',
    '..#####..',
    '.##.#.##.',
    '#########',
    '.#######.',
    '..#####..',
    '...###...',
    '....#....',
    '.........',
  ],
  clock: [
    '..#####..',
    '.##...##.',
    '##..#..##',
    '#...#...#',
    '#...###.#',
    '#.......#',
    '##.....##',
    '.##...##.',
    '..#####..',
  ],
  key: [
    '.........',
    '.........',
    '.###.....',
    '#...#....',
    '#...#####',
    '#...#.#.#',
    '.###..#.#',
    '.........',
    '.........',
  ],
  egg: [
    '...###...',
    '..#####..',
    '.#######.',
    '.#######.',
    '#########',
    '#########',
    '#########',
    '.#######.',
    '..#####..',
  ],
};

function icon(rows: string[]): Pix {
  const p = new Pix(rows[0].length, rows.length);
  const W = hex('#ffffff');
  rows.forEach((row, y) => [...row].forEach((ch, x) => ch === '#' && p.set(x, y, W)));
  return p;
}

// ---- The kit ------------------------------------------------------------------------------------

export const PIECES: Piece[] = [
  {
    name: 'frame-stone',
    kind: 'frame',
    slice: [6, 6, 6, 6],
    repeat: 'repeat',
    fill: true,
    draw: () => frame(6, 10, 2, STONE, stoneDeco),
  },
  {
    name: 'frame-iron',
    kind: 'frame',
    slice: [6, 6, 6, 6],
    repeat: 'stretch',
    fill: true,
    draw: () =>
      frame(6, 2, 2, IRON, (p) =>
        corners(
          p,
          (sx, sy, mx, my) => rivet(p, mx ? sx - 3 : sx + 1, my ? sy - 3 : sy + 1, MAT.iron),
          1,
        ),
      ),
  },
  {
    name: 'frame-wood',
    kind: 'frame',
    slice: [8, 8, 8, 8],
    repeat: 'repeat',
    fill: true,
    draw: () => frame(8, 12, 2, WOOD, woodDeco),
  },
  {
    name: 'frame-parch',
    kind: 'frame',
    slice: [3, 3, 3, 3],
    repeat: 'stretch',
    fill: true,
    draw: () => frame(3, 2, 1, PARCH),
  },
  {
    name: 'frame-obsidian',
    kind: 'frame',
    slice: [5, 5, 5, 5],
    repeat: 'stretch',
    fill: true,
    draw: () => frame(5, 2, 2, OBSIDIAN, obsidianDeco),
  },
  {
    name: 'frame-well',
    kind: 'frame',
    slice: [2, 2, 2, 2],
    repeat: 'stretch',
    fill: true,
    draw: () => frame(2, 2, 1, WELL),
  },
  ...(['gold', 'iron', 'red', 'green'] as const).flatMap((m) =>
    (['n', 'h', 'p', 'd'] as const).map(
      (s): Piece => ({
        name: `btn-${m}-${s}`,
        kind: 'frame',
        slice: s === 'p' ? [4, 2, 2, 2] : [3, 3, 5, 3],
        repeat: 'stretch',
        fill: true,
        draw: () => button(s === 'd' ? MAT.ash : MAT[m], s === 'd' ? 'n' : s),
      }),
    ),
  ),
  ...RARITIES.map(
    (_, r): Piece => ({
      name: `slot-r${r}`,
      kind: 'frame',
      slice: [4, 3, 3, 4],
      repeat: 'stretch',
      fill: true,
      draw: () => slot(r),
    }),
  ),
  {
    name: 'focus',
    kind: 'frame',
    slice: [4, 4, 4, 4],
    repeat: 'stretch',
    draw: () => focusRing(MAT.gold[4], MAT.gold[3]),
  },
  {
    name: 'select',
    kind: 'frame',
    slice: [4, 4, 4, 4],
    repeat: 'stretch',
    draw: () => focusRing(hex('#ffffff'), MAT.gold[4]),
  },
  {
    name: 'tab-off',
    kind: 'frame',
    slice: [2, 2, 2, 2],
    repeat: 'stretch',
    fill: true,
    draw: () => tab(false),
  },
  {
    name: 'tab-on',
    kind: 'frame',
    slice: [2, 2, 1, 2],
    repeat: 'stretch',
    fill: true,
    draw: () => tab(true),
  },
  {
    name: 'trough',
    kind: 'frame',
    slice: [2, 2, 2, 2],
    repeat: 'stretch',
    fill: true,
    draw: trough,
  },
  {
    name: 'badge',
    kind: 'frame',
    slice: [2, 2, 2, 2],
    repeat: 'stretch',
    fill: true,
    draw: () => badge(MAT.red),
  },
  {
    name: 'badge-gold',
    kind: 'frame',
    slice: [2, 2, 2, 2],
    repeat: 'stretch',
    fill: true,
    draw: () => badge(MAT.gold),
  },
  { name: 'key', kind: 'frame', slice: [3, 3, 5, 3], repeat: 'stretch', fill: true, draw: keycap },
  {
    name: 'ribbon',
    kind: 'frame',
    slice: [0, 5, 0, 5],
    repeat: 'stretch',
    fill: true,
    fixedH: true,
    draw: ribbon,
  },
  { name: 'tile-stone', kind: 'tile', draw: stoneTile },
  { name: 'pedestal', kind: 'img', draw: pedestal },
  ...Object.entries(ICONS).map(
    ([n, rows]): Piece => ({ name: `i-${n}`, kind: 'icon', draw: () => icon(rows) }),
  ),
];

const same = (a: RGBA, b: RGBA) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];

/** Is `slice` safe to stretch: the centre is one colour (or, for `fixedH` pieces of a fixed
 *  height, every centre row is one colour), and for `stretch` pieces every edge band is uniform
 *  along its length. A slice that cuts into the kant fails here — the kant would smear into the
 *  middle (game-ui.md: «срез равен канту картинки»). */
export function sliceSafe(p: Pix, s: Slice, repeat: 'stretch' | 'repeat', fixedH = false): boolean {
  const [t, r, b, l] = s;
  if (l + r >= p.w || (!fixedH && t + b >= p.h)) return false;
  const x0 = l;
  const x1 = p.w - r;
  const y0 = t;
  const y1 = p.h - b;
  const c0 = p.get(x0, y0);
  for (let y = y0; y < y1; y++) {
    const row = p.get(x0, y);
    for (let x = x0; x < x1; x++) if (!same(p.get(x, y), fixedH ? row : c0)) return false;
  }
  if (repeat === 'repeat') return true;
  for (let y = 0; y < p.h; y++) {
    if (y >= y0 && y < y1) continue;
    for (let x = x0; x < x1; x++) if (!same(p.get(x, y), p.get(x0, y))) return false;
  }
  if (fixedH) return true;
  for (let x = 0; x < p.w; x++) {
    if (x >= x0 && x < x1) continue;
    for (let y = y0; y < y1; y++) if (!same(p.get(x, y), p.get(x, y0))) return false;
  }
  return true;
}

/** The smallest safe slice, side by side, starting from zero — what the pixels say. */
export function measureSlice(p: Pix, repeat: 'stretch' | 'repeat', fixedH = false): Slice {
  const s: Slice = [0, 0, 0, 0];
  // Grow all four sides together until safe, then shrink each side while it stays safe.
  const lim = Math.min(p.w, p.h);
  let k = 0;
  const at = (k: number): Slice => [fixedH ? 0 : k, k, fixedH ? 0 : k, k];
  while (k < lim && !sliceSafe(p, at(k), repeat, fixedH)) k++;
  s.splice(0, 4, ...at(k));
  for (let side = 0; side < 4; side++) {
    while (s[side] > 0) {
      const t = [...s] as Slice;
      t[side]--;
      if (!sliceSafe(p, t, repeat, fixedH)) break;
      s[side]--;
    }
  }
  return s;
}
