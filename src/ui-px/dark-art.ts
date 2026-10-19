// Dark pixel kit — art generators (pure, deterministic, no DOM). Every picture is an SVG data URL
// drawn in ART pixels (one rect unit = one art pixel, `shape-rendering: crispEdges`); CSS shows it
// at a whole `--u` per art pixel. Colours come from the palette tokens of `dark.css` (read once by
// `dark.tsx`), so a palette switch is one edit of the token block.
//
// Shapes (owner 19.10, «найди топ и сделай»: Supercell / Habby — square cards, badges, sockets):
// - `chamfer` — a 9-slice frame with STEPPED 45° corners: ink outline, a one-pixel bevel (light on
//   the upper left, shadow lower right), flat fill. Cut 1 well, 2 tile/panel/selected, 3 button,
//   6 the stage octagon. A button has a `lip` (the slab under its face); pressed = the face sits
//   `lip` pixels lower and the lip is gone, in the same box.
// - `ribbon` — the name banner with swallowtail ends (3-slice: left end, stretched middle, right).
// - `socket` — a round enchant socket; `pedestal` — an elliptic pixel plinth; `gem` — an 8×8 ore gem.

export interface FrameInk {
  ink: string;
  hi: string;
  lo: string;
  fill: string;
  /** Colour of the slab under a button face. */
  lip?: string;
}

/** An SVG of `w×h` art pixels as a CSS `url(...)`. */
export function svgUrl(w: number, h: number, body: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}' shape-rendering='crispEdges'>${body}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** A pixel picture as rects, one per horizontal run of one colour (short strings). */
export function pixelRuns(w: number, h: number, at: (x: number, y: number) => string | null): string {
  let out = '';
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      const c = at(x, y);
      let e = x + 1;
      while (e < w && at(e, y) === c) e++;
      if (c) out += `<rect x='${x}' y='${y}' width='${e - x}' height='1' fill='${c}'/>`;
      x = e;
    }
  }
  return out;
}

/** Side of the square drawing of a chamfer frame and its slice (both in art pixels). */
export const chamferSize = (cut: number) => ({ n: 2 * cut + 6, s: cut + 2 });

/**
 * The colour grid of a chamfer frame: `n×(n+lip)` pixels, `null` = transparent. `down` draws the
 * pressed face: the same face `lip` pixels lower, nothing under it.
 */
export function chamferGrid(
  cut: number,
  c: FrameInk,
  lip = 0,
  down = false,
): { w: number; h: number; at: (x: number, y: number) => string | null } {
  const { n } = chamferSize(cut);
  const h = n + lip;
  const dy = down ? lip : 0;
  const face = (x: number, y: number) => {
    const yy = y - dy;
    return (
      x >= 0 &&
      yy >= 0 &&
      x < n &&
      yy < n &&
      Math.min(x, n - 1 - x) + Math.min(yy, n - 1 - yy) >= cut
    );
  };
  // the slab: the face swept down by the lip (a raised button), or just the face (pressed)
  const solid = (x: number, y: number) => {
    if (down || !lip) return face(x, y);
    for (let k = 0; k <= lip; k++) if (face(x, y - k)) return true;
    return false;
  };
  const edgeOf = (f: (x: number, y: number) => boolean, x: number, y: number) =>
    f(x, y) && (!f(x - 1, y) || !f(x + 1, y) || !f(x, y - 1) || !f(x, y + 1));
  const at = (x: number, y: number): string | null => {
    if (!solid(x, y)) return null;
    if (edgeOf(solid, x, y)) return c.ink;
    if (!face(x, y)) return c.lip ?? c.lo;
    if (edgeOf(face, x, y)) return c.ink;
    if (edgeOf(face, x - 1, y) || edgeOf(face, x, y - 1)) return c.hi;
    if (edgeOf(face, x + 1, y) || edgeOf(face, x, y + 1)) return c.lo;
    return c.fill;
  };
  return { w: n, h, at };
}

export function chamfer(cut: number, c: FrameInk, lip = 0, down = false): string {
  const g = chamferGrid(cut, c, lip, down);
  return svgUrl(g.w, g.h, pixelRuns(g.w, g.h, g.at));
}

/** Ribbon geometry (art pixels): end pieces `L` wide, a 2-pixel stretched middle, `H` high. */
export const RIBBON = { L: 14, M: 2, H: 21, body: 17 } as const;

export interface RibbonInk {
  ink: string;
  face: string;
  hi: string;
  lo: string;
  tail: string;
  fold: string;
}

/** The ribbon's colour grid: a banner face over two swallowtail ends that hang lower. */
export function ribbonGrid(c: RibbonInk): {
  w: number;
  h: number;
  at: (x: number, y: number) => string | null;
} {
  const { L, M, H, body } = RIBBON;
  const w = 2 * L + M;
  const mirror = (x: number) => (x < L + M ? x : w - 1 - x); // the right end mirrors the left
  // banner face: rows 0..body-1, from x = F inwards
  const F = 8;
  const face = (x: number, y: number) => y >= 0 && y < body && mirror(x) >= F && x >= 0 && x < w;
  // tail: rows t0..t1, x 0..F+4 of each end, a V notch (4 deep) cut into the outer end
  const t0 = 4;
  const t1 = H - 1;
  const mid = (t0 + t1) / 2;
  const half = (t1 - t0) / 2;
  const tailIn = (x: number, y: number) => {
    const m = mirror(x);
    if (x < 0 || x >= w || y < t0 || y > t1 || m > F + 4) return false;
    return m >= Math.round(4 * (1 - Math.abs(y - mid) / half));
  };
  const any = (x: number, y: number) => face(x, y) || tailIn(x, y);
  const edge = (f: (x: number, y: number) => boolean, x: number, y: number) =>
    f(x, y) && (!f(x - 1, y) || !f(x + 1, y) || !f(x, y - 1) || !f(x, y + 1));
  const at = (x: number, y: number): string | null => {
    if (face(x, y)) {
      if (edge(face, x, y)) return c.ink;
      if (y === 1) return c.hi;
      if (y === body - 2) return c.lo;
      return c.face;
    }
    if (!tailIn(x, y)) return null;
    if (edge(any, x, y) || edge(tailIn, x, y)) return c.ink;
    // the fold: the part of the tail tucked under the face's lower corner
    if (mirror(x) >= F && y >= body) return c.fold;
    return c.tail;
  };
  return { w, h: H, at };
}

export function ribbon(c: RibbonInk): string {
  const g = ribbonGrid(c);
  return svgUrl(g.w, g.h, pixelRuns(g.w, g.h, g.at));
}

/** A pixel disc of diameter `d`: `f(x, y, q)` colours a pixel at relative radius `q` (0 centre, 1 rim). */
function disc(d: number, f: (x: number, y: number, q: number) => string | null): string {
  const c = (d - 1) / 2;
  return pixelRuns(d, d, (x, y) => {
    const q = Math.hypot(x - c, y - c) / (d / 2);
    return f(x, y, q);
  });
}

export interface SocketInk {
  ink: string;
  hi: string;
  lo: string;
  well: string;
  mark: string;
  /** Filled socket: the gem colour (empty = a «+»). */
  gem?: string;
}

/** A round enchant socket, 20×20: ink rim, bevelled ring (dark on top = sunken), well, + or a gem. */
export function socket(c: SocketInk, d = 20): string {
  const mid = d / 2;
  const a = Math.max(2, Math.round(d / 5)); // the plus arm: 4 on the 20-px socket, 2 on 12
  const plus = (x: number, y: number) =>
    (x >= mid - 1 && x <= mid && y >= mid - a && y < mid + a) ||
    (y >= mid - 1 && y <= mid && x >= mid - a && x < mid + a);
  const gem = c.gem ? gemGrid(c.gem, c.ink) : null;
  const g0 = Math.round(mid - 4);
  return svgUrl(
    d,
    d,
    disc(d, (x, y, q) => {
      if (q > 1) return null;
      if (q > 0.86) return c.ink;
      if (q > 0.72) return y < mid ? c.lo : c.hi;
      if (q > 0.62) return c.ink;
      if (gem) {
        const v = gem(x - g0, y - g0);
        if (v) return v;
        return c.well;
      }
      return plus(x, y) ? c.mark : c.well;
    }),
  );
}

/** An elliptic pixel plinth `w×h` (w odd looks best): ink rim, light top, mid band, dark front. */
export function pedestal(
  w: number,
  c: { ink: string; hi: string; mid: string; lo: string },
  h = Math.max(7, Math.round(w / 6) | 1),
): string {
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  return svgUrl(
    w,
    h,
    pixelRuns(w, h, (x, y) => {
      const q = Math.hypot((x - cx) / (w / 2), (y - cy) / (h / 2));
      if (q > 1) return null;
      if (q > 0.86) return c.ink;
      return y < cy - 1 ? c.hi : y < cy + 2 ? c.mid : c.lo;
    }),
  );
}

const GEM = [
  '..XXXX..',
  '.XhhccX.',
  'XhhcccdX',
  'XhcccddX',
  'XcccdddX',
  '.XcdddX.',
  '..XddX..',
  '...XX...',
];

/** Mix two `#rrggbb` colours, `t` of the second. */
export function mix(a: string, b: string, t: number): string {
  const ch = (s: string, i: number) => parseInt(s.slice(1 + 2 * i, 3 + 2 * i), 16);
  return (
    '#' +
    [0, 1, 2]
      .map((i) =>
        Math.round(ch(a, i) * (1 - t) + ch(b, i) * t)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

function gemGrid(base: string, ink: string): (x: number, y: number) => string | null {
  const C: Record<string, string> = {
    X: ink,
    h: mix(base, '#ffffff', 0.55),
    c: base,
    d: mix(base, '#000000', 0.35),
  };
  return (x, y) => (x >= 0 && y >= 0 && x < 8 && y < 8 ? (C[GEM[y][x]] ?? null) : null);
}

/** An 8×8 cut gem of `base` colour with an ink outline. */
export function gem(base: string, ink: string): string {
  return svgUrl(8, 8, pixelRuns(8, 8, gemGrid(base, ink)));
}
