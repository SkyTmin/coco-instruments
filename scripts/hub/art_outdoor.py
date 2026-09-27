"""The camp outdoors (v2.80): ground, perimeter and everything that stands on the square.

`maps/square.py` decides where things are; this module draws them, in the same hand as `kit.py`
(NA's 1 px ink contour, three to five flat shades per material, light from the upper left).

GROUND is painted procedurally, not from NA's autotile blocks: the square needs long straight
kerbs, a raked strip that follows the wall, slabs of the parade ground, gravel ribbons that bend
and trodden shortcuts across grass — the NA blocks only know round blobs. What is kept from NA is
its look: flat fills with a few large tonal patches (value noise thresholded into 2–3 tones, never
per-pixel noise), little blade and dash marks in a darker tone, and a two-pixel darker lip where a
higher material meets a lower one (grass over earth, a kerb over asphalt). Borders wobble on a
2-px lattice, so they step like NA's hand-drawn edges instead of fraying.

    Ground(w, h)                  one label per pixel
      .rect / .path / .blob       paint a material (tiles, perturbed edges)
      .render() -> Img            textures + rims + kerb shadows, deterministic

Materials: earth, trod (desire lines), grass, sand_h/sand_v (raked along the strip), gravel,
asphalt, slab (the parade ground), soil, mud, straw, coal, moss, outside, rails. The higher one
(RANK) draws its lip where it meets a lower one: grass over earth, a slab kerb over asphalt.

THE REST, by section: lettering (`txt` — kit's font with honest widths for Д Ы Ш Щ Ж М Ю И Й Н Ц),
checks (`reach` — a 2-tile agent's BFS to every spawn), perimeter (ПО-2 wall face, razor-wire coil,
Y-brackets, the taiga over the wall, warning fence runs, enamel plates), props of the parade ground
and the gate, industry (track, carts, spoil heaps, belt, coal, bins, pallets, tyres, the lorry),
gardens and life (rune stones, sigil, pool, birch, NA bushes, cabbages, scarecrow, pickets, plank
fence, laundry, sports kit, crows, NA dogs and cat), and ground decals (puddles, manholes, cracks
with weeds, oil, ruts, boot prints, patches, pebbles, tally marks).

LESSONS
  * Flat, not noisy. The first textures thresholded two-octave noise into three tones and read as
    camouflage at game scale; NA ground is one flat tone with a few big soft patches and small
    hand marks (dashes in earth, "ʌʌ" tufts in grass, 2-px pebbles in gravel, rake lines in sand).
  * Diagonals in pixel art are 2:1 staircases or they are mush: the ПО-2 diamonds on a 1.5:1
    slope dissolved into a dotted checker; on x + 2y they are crisp, two pixels per row.
  * A strand, a coil loop, a rope is ONE pixel wide and gets its light from the upper left: the
    concertina reads as a coil only because each loop is lit on its upper-left arc.
  * Letters: at 3 px Д is А and Ы is Ъ3 — the signs are the square's voice, so they get their width.
  * Everything that stands gets `ink` (inside the box) or `outline` (outside, for thin shapes: a
    2-px table leg inked inside disappears). Decals get neither — they are paint on the ground.
  * The warm accents are rationed: the flag, fires, the tribune's cloth, enamel plates and the
    enchanter's violet. Everything else goes through `camp()` or the ramps in G / kit.P.
"""
from __future__ import annotations

import math

import numpy as np

from kit import INK, P, ink
from lib import T, Img, camp, grid, hexrgb, na, outline, ramp, rng, tiles

# ------------------------------------------------------------------------------ vector noise


def _hash(ix: np.ndarray, iy: np.ndarray, seed: int) -> np.ndarray:
    ix = ix.astype(np.int64).astype(np.uint64)
    iy = iy.astype(np.int64).astype(np.uint64)
    v = (ix * np.uint64(374761393) + iy * np.uint64(668265263) + np.uint64(seed * 144269504 & 0xFFFFFFFF)) & np.uint64(0xFFFFFFFF)
    v = ((v ^ (v >> np.uint64(13))) * np.uint64(1274126177)) & np.uint64(0xFFFFFFFF)
    v = v ^ (v >> np.uint64(16))
    return (v & np.uint64(0xFFFF)).astype(np.float32) / 65535.0


def vnoise(x: np.ndarray, y: np.ndarray, seed: int = 0) -> np.ndarray:
    """Smooth value noise 0..1 on arrays (bilinear, smoothstep), lattice step 1."""
    x0, y0 = np.floor(x), np.floor(y)
    fx, fy = x - x0, y - y0
    fx, fy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    a, b = _hash(x0, y0, seed), _hash(x0 + 1, y0, seed)
    c, d = _hash(x0, y0 + 1, seed), _hash(x0 + 1, y0 + 1, seed)
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy


def fbm(x, y, seed=0, oct=2):
    s, amp, tot = 0.0, 1.0, 0.0
    for o in range(oct):
        s = s + vnoise(x * (2 ** o), y * (2 ** o), seed + o * 17) * amp
        tot += amp
        amp *= 0.5
    return s / tot


def cellhash(cx: np.ndarray, cy: np.ndarray, seed: int) -> np.ndarray:
    return _hash(cx, cy, seed)


# ------------------------------------------------------------------------------ palette
def _hex(c: str) -> np.ndarray:
    return np.array(hexrgb(c)[:3], np.float32)


G = {
    # dark → light. Tired northern grass: olive, a little yellow in the light.
    'grass': ['#4d5634', '#626c3f', '#77804b', '#8c9357', '#a3a667'],
    # trodden earth of the yard: dusty grey-brown, warmer in the light
    'earth': ['#4c4034', '#645545', '#7b6953', '#907d63', '#a69375'],
    # raked sand of the forbidden strip
    'sand': ['#8e7a58', '#a48f69', '#b7a27a', '#c8b58c', '#d9c89f'],
    # gravel paths: cold grey with brown
    'gravel': ['#4a4742', '#625e57', '#7a756c', '#948f84', '#b0ab9e'],
    # asphalt, old and patched
    'asphalt': ['#2c2e30', '#383a3c', '#444648', '#515354', '#626463'],
    # the parade ground's concrete slabs
    'slab': ['#55575a', '#6f716f', '#8a8b86', '#9e9f98', '#b5b5ac'],
    # garden beds
    'soil': ['#2b221d', '#3b2f27', '#4c3d32', '#5d4c3e', '#6f5c4b'],
    # wet mud
    'mud': ['#352c26', '#43382f', '#524539', '#615344'],
    # straw in the dog pen
    'straw': ['#6e5a2c', '#8d7639', '#a98f4b', '#c2a962', '#d9c27e'],
    # coal dust around the boiler house
    'coal': ['#1c1b1e', '#28272b', '#353439', '#44434a'],
    # moss and dark earth of the enchanter's garden
    'moss': ['#34402f', '#424f3b', '#515f47', '#627254', '#788866'],
    # outside the wall: the taiga floor, in shade
    'outside': ['#161a17', '#1d231e', '#252c25', '#2f372d'],
}

PAINT = {'white': '#d8d4c4', 'yellow': '#d6ae45', 'red': '#a7343a', 'whiteold': '#b9b5a6'}

# material ids and their height rank (the higher material draws the lip where it meets a lower one)
MATS = ['earth', 'grass', 'sand_h', 'sand_v', 'gravel', 'asphalt', 'slab', 'soil', 'mud', 'straw',
        'coal', 'moss', 'outside', 'rails', 'trod']
MID = {m: i for i, m in enumerate(MATS)}
RANK = {'outside': 0, 'mud': 1, 'soil': 1, 'asphalt': 2, 'rails': 2, 'earth': 3, 'trod': 3, 'coal': 3,
        'gravel': 3, 'straw': 3, 'sand_h': 3, 'sand_v': 3, 'moss': 4, 'grass': 5, 'slab': 6}


class Ground:
    """A ground picture painted material by material. Coordinates of shapes are in TILES."""

    def __init__(self, w_tiles: int, h_tiles: int, base: str = 'earth', seed: int = 1):
        self.W, self.H = w_tiles * T, h_tiles * T
        self.lab = np.full((self.H, self.W), MID[base], np.int16)
        self.seed = seed
        self.n = 0

    # ---- shapes: each takes a signed distance d (px, <0 inside) over a bbox and a wobble
    def _apply(self, mat: str, x0: float, y0: float, x1: float, y1: float, dist, rough: float,
               scale: float, keep: tuple[str, ...] | None) -> None:
        self.n += 1
        pad = int(rough) + 3
        X0, Y0 = max(0, int(x0 * T) - pad), max(0, int(y0 * T) - pad)
        X1, Y1 = min(self.W, int(math.ceil(x1 * T)) + pad), min(self.H, int(math.ceil(y1 * T)) + pad)
        if X1 <= X0 or Y1 <= Y0:
            return
        yy, xx = np.mgrid[Y0:Y1, X0:X1].astype(np.float32)
        d = dist(xx + 0.5, yy + 0.5)
        if rough > 0:
            # wobble on a 2-px lattice: the border steps like a hand-drawn edge
            qx, qy = np.floor(xx / 2) * 2, np.floor(yy / 2) * 2
            nz = fbm(qx / scale, qy / scale, self.seed * 31 + self.n, 2)
            d = d + (nz - 0.5) * 2 * rough
        m = d < 0
        if keep is not None:
            cur = self.lab[Y0:Y1, X0:X1]
            ok = np.zeros_like(m)
            for k in keep:
                ok |= cur == MID[k]
            m &= ok
        self.lab[Y0:Y1, X0:X1][m] = MID[mat]

    def rect(self, mat, x0, y0, x1, y1, r=0.0, rough=0.0, scale=7.0, keep=None):
        """Rounded rectangle [x0, x1) × [y0, y1) in tiles, corner radius r tiles, wobble rough px."""
        R = r * T
        ax0, ay0, ax1, ay1 = x0 * T, y0 * T, x1 * T, y1 * T

        def dist(x, y):
            cx, cy = (ax0 + ax1) / 2, (ay0 + ay1) / 2
            hx, hy = (ax1 - ax0) / 2 - R, (ay1 - ay0) / 2 - R
            qx, qy = np.abs(x - cx) - hx, np.abs(y - cy) - hy
            out = np.sqrt(np.maximum(qx, 0) ** 2 + np.maximum(qy, 0) ** 2)
            return out + np.minimum(np.maximum(qx, qy), 0) - R
        self._apply(mat, x0, y0, x1, y1, dist, rough, scale, keep)

    def blob(self, mat, cx, cy, rx, ry, rough=3.0, scale=6.0, keep=None):
        def dist(x, y):
            k = np.sqrt(((x - cx * T) / (rx * T)) ** 2 + ((y - cy * T) / (ry * T)) ** 2)
            return (k - 1) * min(rx, ry) * T
        self._apply(mat, cx - rx, cy - ry, cx + rx, cy + ry, dist, rough, scale, keep)

    def path(self, mat, pts, width, rough=0.0, scale=7.0, keep=None):
        """A ribbon along a polyline (tiles), width in tiles, round joints."""
        pts = [(x * T, y * T) for x, y in pts]
        hw = width * T / 2
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]

        def dist(x, y):
            best = np.full(x.shape, 1e9, np.float32)
            for (ax, ay), (bx, by) in zip(pts, pts[1:]):
                dx, dy = bx - ax, by - ay
                L2 = dx * dx + dy * dy or 1e-6
                t = np.clip(((x - ax) * dx + (y - ay) * dy) / L2, 0, 1)
                best = np.minimum(best, np.hypot(x - ax - t * dx, y - ay - t * dy))
            return best - hw
        self._apply(mat, (min(xs) - hw) / T, (min(ys) - hw) / T, (max(xs) + hw) / T, (max(ys) + hw) / T,
                    dist, rough, scale, keep)

    def mask(self, mat: str) -> np.ndarray:
        return self.lab == MID[mat]

    # ---- render
    def render(self) -> Img:
        H, W = self.H, self.W
        yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
        out = np.zeros((H, W, 3), np.float32)
        lab = self.lab
        for name in MATS:
            m = lab == MID[name]
            if not m.any():
                continue
            tex = _TEX[name](xx, yy, self.seed)
            out[m] = tex[m]
        self._rims(out, lab)
        a = np.concatenate([np.clip(out + 0.5, 0, 255), np.full((H, W, 1), 255, np.float32)], 2)
        return Img(a.astype(np.uint8))

    def _rims(self, out: np.ndarray, lab: np.ndarray) -> None:
        rank = np.zeros(len(MATS), np.int16)
        for k, v in RANK.items():
            rank[MID[k]] = v
        R = rank[lab]
        H, W = lab.shape

        def nb(a, dy, dx, fill):
            o = np.full_like(a, fill)
            ys = slice(max(0, dy), H + min(0, dy))
            yd = slice(max(0, -dy), H + min(0, -dy))
            xs = slice(max(0, dx), W + min(0, dx))
            xd = slice(max(0, -dx), W + min(0, -dx))
            o[yd, xd] = a[ys, xs]
            return o
        # distance (in px, 1..2) from a lower neighbour, 4-connected
        lower1 = np.zeros((H, W), bool)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            lower1 |= nb(R, dy, dx, 99) < R
        lower2 = np.zeros((H, W), bool)
        for dy, dx in ((2, 0), (-2, 0), (0, 2), (0, -2), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            lower2 |= nb(R, dy, dx, 99) < R
        lower2 &= ~lower1
        for name, (c1, c2, shadow) in _RIM.items():
            m = lab == MID[name]
            if c1:
                out[m & lower1] = _hex(c1)
            if c2:
                out[m & lower2] = _hex(c2)
        # kerb shadow: a lower pixel whose north or west neighbour is a higher slab/grass
        for name, (c1, c2, shadow) in _RIM.items():
            if not shadow:
                continue
            hi = lab == MID[name]
            cast = (nb(hi, -1, 0, False) | nb(hi, 0, -1, False)) & (R < RANK[name]) & ~hi
            out[cast] = out[cast] * shadow


# rim colours per material: (outer 1 px, next 1 px, shadow factor on the lower side)
_RIM = {
    'grass': (G['grass'][1], G['grass'][1], 0.0),
    'moss': (G['moss'][1], None, 0.0),
    'slab': (G['slab'][0], G['slab'][4], 0.8),
    'gravel': (G['gravel'][1], None, 0.0),
    'earth': (G['earth'][1], None, 0.0),
    'sand_h': (G['sand'][1], None, 0.0),
    'sand_v': (G['sand'][1], None, 0.0),
    'straw': (G['straw'][1], None, 0.0),
    'coal': (None, None, 0.0),
    'asphalt': (G['asphalt'][1], None, 0.0),
}


# ------------------------------------------------------------------------------ textures
def _tones(ramp_: list[str], idx: np.ndarray) -> np.ndarray:
    pal = np.stack([_hex(c) for c in ramp_])
    return pal[np.clip(idx, 0, len(ramp_) - 1)]


def _patches(xx, yy, seed, scale, lo, hi, base, ramp_):
    n = fbm(np.floor(xx / 2) * 2 / scale, np.floor(yy / 2) * 2 / scale, seed, 2)
    idx = np.full(xx.shape, base, np.int16)
    idx[n < lo] = base - 1
    idx[n > hi] = base + 1
    return idx


def _tex_earth(xx, yy, seed):
    g = G['earth']
    idx = _patches(xx, yy, seed + 1, 30, 0.16, 0.80, 2, g)
    # NA dashes: short darker strokes in rows — earth trodden by boots
    row = np.floor(yy / 3)
    cell = np.floor((xx + row * 7) / 8)
    h = cellhash(cell, row, seed + 5)
    x_in = (xx + row * 7) % 8
    ln = 2 + np.floor(h * 4)
    dash = (h < 0.34) & (x_in < ln) & (yy % 3 == 1)
    idx = np.where(dash, np.maximum(idx - 1, 0), idx)
    # a lighter pebble here and there: two pixels, lit top
    h2 = cellhash(np.floor(xx / 7), np.floor(yy / 7), seed + 9)
    peb = (h2 < 0.10) & (xx % 7 == 3) & (yy % 7 == 4)
    peb2 = (h2 < 0.10) & (xx % 7 == 4) & (yy % 7 == 4)
    idx = np.where(peb | peb2, np.minimum(idx + 2, 4), idx)
    under = (h2 < 0.10) & ((xx % 7 == 3) | (xx % 7 == 4)) & (yy % 7 == 5)
    idx = np.where(under, np.maximum(idx - 1, 0), idx)
    return _tones(g, idx)


# NA grass tufts, drawn in the darker tone (# dark, + light tip) — one per 10 × 9 cell at most
_BLADES = [
    ['.#...#.', '#.#.#.#'],
    ['..#..', '.#.#.', '#...#'],
    ['#..#', '.##.'],
    ['.+.', '#.#'],
    ['#.#.#', '.#.#.'],
    ['..+..', '.#.#.', '#.#.#'],
]


def _tex_grass(xx, yy, seed):
    g = G['grass']
    idx = _patches(xx, yy, seed + 2, 26, 0.18, 0.82, 2, g)
    CW, CH = 10, 9
    cx, cy = np.floor(xx / CW), np.floor((yy + (np.floor(xx / CW) % 2) * 4) / CH)
    h = cellhash(cx, cy, seed + 21)
    ox = (cellhash(cx, cy, seed + 22) * 4).astype(np.int16)
    oy = (cellhash(cx, cy, seed + 23) * 5).astype(np.int16)
    lx = (xx % CW).astype(np.int16) - ox
    ly = ((yy + (np.floor(xx / CW) % 2) * 4) % CH).astype(np.int16) - oy
    dark = np.zeros(xx.shape, bool)
    lite = np.zeros(xx.shape, bool)
    kind = (h * 9).astype(np.int16)
    for k, pat in enumerate(_BLADES):
        for py, row in enumerate(pat):
            for px, ch in enumerate(row):
                if ch == '#':
                    dark |= (kind == k) & (lx == px) & (ly == py)
                elif ch == '+':
                    lite |= (kind == k) & (lx == px) & (ly == py)
    idx = np.where(dark, np.maximum(idx - 1, 0), idx)
    idx = np.where(lite, np.minimum(idx + 1, 4), idx)
    return _tones(g, idx)


def _tex_sand(horizontal: bool):
    def f(xx, yy, seed):
        g = G['sand']
        idx = np.full(xx.shape, 2, np.int16)
        a, b = (yy, xx) if horizontal else (xx, yy)
        wob = np.round(np.sin(b / 23.0 + a / 40.0) * 0.6)
        rake = ((a + wob) % 3 == 0)
        idx = np.where(rake, 1, idx)
        crest = ((a + wob) % 3 == 1) & (cellhash(np.floor(b / 5), np.floor(a / 3), seed + 13) < 0.25)
        idx = np.where(crest, 3, idx)
        return _tones(g, idx)
    return f


def _tex_gravel(xx, yy, seed):
    g = G['gravel']
    idx = np.full(xx.shape, 2, np.int16)
    # pebbles on a jittered 4 × 4 lattice: 2–3 px, lit top-left, dark underside
    CW = 4
    row = np.floor(yy / CW)
    sx = xx + (row % 2) * 2
    cx = np.floor(sx / CW)
    h = cellhash(cx, row, seed + 31)
    lx, ly = (sx % CW).astype(np.int16), (yy % CW).astype(np.int16)
    has = h < 0.62
    wide = cellhash(cx, row, seed + 32) < 0.5
    body = has & (ly == 1) & ((lx == 1) | (wide & (lx == 2)))
    top = has & (ly == 0) & (lx == 1)
    under = has & (ly == 2) & ((lx == 1) | (wide & (lx == 2)))
    lightstone = cellhash(cx, row, seed + 33) < 0.35
    idx = np.where(body, np.where(lightstone, 3, 2), idx)
    idx = np.where(top, np.where(lightstone, 4, 3), idx)
    idx = np.where(under, 1, idx)
    return _tones(g, idx)


def _tex_asphalt(xx, yy, seed):
    g = G['asphalt']
    idx = _patches(xx, yy, seed + 5, 34, 0.12, 0.84, 2, g)
    cx, cy = np.floor(xx / 5), np.floor(yy / 5)
    h = cellhash(cx, cy, seed + 41)
    speck = (h < 0.22) & (xx % 5 == 2) & (yy % 5 == 2)
    idx = np.where(speck, np.minimum(idx + 1, 4), idx)
    dim = (h > 0.9) & (xx % 5 == 1) & (yy % 5 == 3)
    idx = np.where(dim, np.maximum(idx - 1, 0), idx)
    return _tones(g, idx)


def _tex_slab(xx, yy, seed):
    g = G['slab']
    S = 32
    sx, sy = np.floor(xx / S), np.floor(yy / S)
    h = cellhash(sx, sy, seed + 51)
    idx = np.where(h < 0.25, 2, 3).astype(np.int16)
    lx, ly = xx % S, yy % S
    # a few pores in the concrete
    hp = cellhash(np.floor(xx / 6), np.floor(yy / 6), seed + 53)
    idx = np.where((hp < 0.12) & (xx % 6 == 3) & (yy % 6 == 2), idx - 1, idx)
    idx = np.where((ly == 0) | (lx == 0), 0, idx)
    idx = np.where(((ly == 1) & (lx > 0)) | ((lx == 1) & (ly > 0)), 4, idx)
    idx = np.where((ly == S - 1) & (lx > 0), 1, idx)
    idx = np.where((lx == S - 1) & (ly > 0), 1, idx)
    return _tones(g, idx)


def _tex_soil(xx, yy, seed):
    g = G['soil']
    idx = np.full(xx.shape, 2, np.int16)
    k = yy % 5
    idx = np.where(k == 0, 3, idx)
    idx = np.where(k == 1, 4, idx)
    idx = np.where(k == 4, 1, idx)
    h = cellhash(np.floor(xx / 4), np.floor(yy / 5), seed + 61)
    idx = np.where((h < 0.2) & (k == 2), 1, idx)
    return _tones(g, idx)


def _tex_mud(xx, yy, seed):
    g = G['mud']
    idx = _patches(xx, yy, seed + 7, 10, 0.3, 0.8, 1, g)
    return _tones(g, idx)


def _tex_straw(xx, yy, seed):
    g = G['straw']
    idx = _patches(xx, yy, seed + 8, 16, 0.2, 0.82, 2, g)
    cx, cy = np.floor(xx / 4), np.floor(yy / 3)
    h = cellhash(cx, cy, seed + 71)
    lx, ly = xx % 4, yy % 3
    stroke = (h < 0.6) & (ly == 1) & (lx < 3)
    idx = np.where(stroke & (h < 0.3), np.minimum(idx + 1, 4), idx)
    idx = np.where(stroke & (h >= 0.3), np.maximum(idx - 1, 0), idx)
    return _tones(g, idx)


def _tex_coal(xx, yy, seed):
    g = G['coal']
    idx = _patches(xx, yy, seed + 9, 8, 0.3, 0.7, 2, g)
    return _tones(g, idx)


def _tex_moss(xx, yy, seed):
    g = G['moss']
    idx = _patches(xx, yy, seed + 10, 16, 0.25, 0.78, 2, g)
    cx, cy = np.floor(xx / 6), np.floor(yy / 6)
    h = cellhash(cx, cy, seed + 81)
    dot = (h < 0.3) & (xx % 6 == 2) & (yy % 6 == 3)
    idx = np.where(dot, 4, idx)
    return _tones(g, idx)


def _tex_outside(xx, yy, seed):
    g = G['outside']
    idx = _patches(xx, yy, seed + 11, 10, 0.3, 0.7, 1, g)
    return _tones(g, idx)


def _tex_rails(xx, yy, seed):
    return _tex_gravel(xx, yy, seed + 100) * 0.82


def _tex_trod(xx, yy, seed):
    """Desire lines: earth packed hard by boots — a shade darker, the dashes denser and longer."""
    g = G['earth']
    idx = np.full(xx.shape, 1, np.int16)
    row = np.floor(yy / 3)
    cell = np.floor((xx + row * 5) / 7)
    h = cellhash(cell, row, seed + 15)
    x_in = (xx + row * 5) % 7
    dash = (h < 0.5) & (x_in < 2 + np.floor(h * 8)) & (yy % 3 == 1)
    idx = np.where(dash, 0, idx)
    lite = (h > 0.92) & (x_in < 2) & (yy % 3 == 2)
    idx = np.where(lite, 2, idx)
    return _tones(g, idx)


_TEX = {
    'earth': _tex_earth, 'grass': _tex_grass, 'sand_h': _tex_sand(True), 'sand_v': _tex_sand(False),
    'gravel': _tex_gravel, 'asphalt': _tex_asphalt, 'slab': _tex_slab, 'soil': _tex_soil, 'mud': _tex_mud,
    'straw': _tex_straw, 'coal': _tex_coal, 'moss': _tex_moss, 'outside': _tex_outside, 'rails': _tex_rails,
    'trod': _tex_trod,
}


# ================================================================================ lettering
# kit.FONT is 3 px wide for every letter, and at that width Д reads as А, Ы as Ъ3, Ш and Ж as
# blots. Outdoors the signs are the square's voice (СТОЙ!, ДОСКА ПОЧЁТА, the slogan), so these
# letters get their honest widths here. (Worth moving into kit.FONT.)
_WIDE = {
    'Д': ['.###', '.#.#', '.#.#', '####', '#..#'],
    'Ы': ['#..#', '#..#', '##.#', '#.##', '##.#'],
    'Ш': ['#.#.#', '#.#.#', '#.#.#', '#.#.#', '#####'],
    'Щ': ['#.#.#', '#.#.#', '#.#.#', '#####', '....#'],
    'Ж': ['#.#.#', '#.#.#', '.###.', '#.#.#', '#.#.#'],
    'М': ['#...#', '##.##', '#.#.#', '#...#', '#...#'],
    'Ю': ['#..#.', '#.#.#', '###.#', '#.#.#', '#..#.'],
    'И': ['#..#', '#..#', '#.##', '##.#', '#..#'],
    'Й': ['.##.', '#..#', '#..#', '#.##', '##.#', '#..#'],   # 6 rows: the breve sits above
    'Н': ['#..#', '#..#', '####', '#..#', '#..#'],
    'Ц': ['#.#.', '#.#.', '#.#.', '####', '...#'],
}


def txt(s: str, color: str, shadow: str | None = None) -> Img:
    """Like kit.text, with the wide letters above. A 6-row glyph (Й) carries its mark one row
    above the cap line, so a line with Й is one pixel taller."""
    from kit import FONT
    s = s.upper()
    glyphs = [_WIDE.get(ch) or FONT.get(ch, FONT[' ']) for ch in s]
    top = 1 if any(len(g) == 6 for g in glyphs) else 0
    w = sum(len(g[0]) + 1 for g in glyphs) - 1
    out = Img.new(w + (1 if shadow else 0), 5 + top + (1 if shadow else 0))
    x = 0
    for g in glyphs:
        y0 = top - (len(g) - 5)
        for yy, row in enumerate(g):
            for xx, v in enumerate(row):
                if v == '#':
                    if shadow:
                        out.px_(x + xx + 1, y0 + yy + 1, shadow)
                    out.px_(x + xx, y0 + yy, color)
        x += len(g[0]) + 1
    return out


# ================================================================================ checks
def reach(m, start: tuple[float, float], width: float = 2.0) -> dict[str, bool]:
    """Can an agent `width` tiles wide walk from start to every spawn of the map? BFS on the
    collision grid (lib.SUB cells per tile); the agent is a width × width box. Returns spawn id →
    reachable. (A shared helper worth moving to lib.py: every outdoor map wants this check.)"""
    from collections import deque
    from lib import SUB
    k = int(round(width * SUB))
    free = ~m.solid
    Hh, Ww = free.shape
    cs = np.zeros((Hh + 1, Ww + 1), np.int32)
    cs[1:, 1:] = np.cumsum(np.cumsum(free, 0), 1)
    ok = np.zeros((Hh, Ww), bool)
    ok[:Hh - k + 1, :Ww - k + 1] = (cs[k:, k:] - cs[:-k, k:] - cs[k:, :-k] + cs[:-k, :-k]) == k * k

    def cells_for(px, py):
        cx, cy = int(px * SUB), int(py * SUB)
        return [(y, x) for y in range(cy - k + 1, cy + 1) for x in range(cx - k + 1, cx + 1)
                if 0 <= y < Hh and 0 <= x < Ww and ok[y, x]]
    seen = np.zeros((Hh, Ww), bool)
    q = deque(cells_for(*start))
    for c in q:
        seen[c] = True
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < Hh and 0 <= nx < Ww and ok[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                q.append((ny, nx))
    return {sid: any(seen[c] for c in cells_for(sx, sy)) for sid, (sx, sy, _) in m.spawns.items()}


# ================================================================================ perimeter
STEEL = ['#1f2327', '#343a40', '#525a61', '#7f888f', '#b9c1c6']
CON = P['concrete']


def _ring(out: Img, cx: float, cy: float, rx: float, ry: float, pick) -> None:
    """A 1-px ellipse outline; pick(angle_deg) → colour or None (hidden arc)."""
    for y in range(int(cy - ry - 2), int(cy + ry + 3)):
        for x in range(int(cx - rx - 2), int(cx + rx + 3)):
            dx, dy = (x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry
            k = math.sqrt(dx * dx + dy * dy)
            if abs(k - 1) * min(rx, ry) < 0.55:
                a = math.degrees(math.atan2(dy, dx)) % 360
                c = pick(a)
                if c:
                    out.px_(x, y, c)


def coil(length: int, vertical: bool = False, seed: int = 1) -> Img:
    """Razor-wire concertina: a run of overlapping loops. Loops lit on the upper-left arc and dark
    on the lower-right, a barb (1 px) sticking out here and there, a soft shadow under the run."""
    r = rng('coil', length, vertical, seed)
    D = 11
    out = Img.new(length, D + 2) if not vertical else Img.new(D + 2, length)
    step = 5
    n = length // step + 3
    for i in range(n):
        c0 = -5 + i * step + r.uniform(-0.4, 0.4)
        cx, cy = (c0, 5.5) if not vertical else (5.5, c0)

        def pick(a):
            if 190 < a < 290:
                return STEEL[4]
            if 150 < a <= 190 or 290 <= a < 330:
                return STEEL[3]
            if 20 < a < 110:
                return STEEL[1]
            return STEEL[2]
        _ring(out, cx, cy, 5.2, 5.0, pick)
        for _ in range(2):
            a = r.uniform(0, 2 * math.pi)
            out.px_(int(cx + math.cos(a) * 6.6), int(cy + math.sin(a) * 6.4), STEEL[0])
    sh = out.silhouette('#000000').opacity(0.35)
    res = Img.new(out.w + 1, out.h + 1)
    res.paste_(sh, 1, 1)
    res.paste_(out, 0, 0)
    return res


def _rhombus(face: Img, x0: int, y0: int, w: int, h: int) -> None:
    """ПО-2 relief: raised diamonds 16 × 10 — the fence every Soviet yard knows. Each diamond is a
    flat face with a lit upper-left and upper-right edge and a dark lower pair (light from above)."""
    c = CON
    for y in range(h):
        for x in range(w):
            a = (x + 2 * y) % 16          # 2:1 staircases: clean pixel diagonals, 2 px per row
            b = (x - 2 * y + 4) % 16
            col = None
            if a in (0, 1):
                col = c[4]
            elif b in (14, 15):
                col = c[3]
            elif a in (14, 15) or b in (0, 1):
                col = c[1]
            if col:
                face.px_(x0 + x, y0 + y, col)


def wall_face(w: int, face_h: int = 32, seed: int = 1, panel: int = 60) -> tuple[Img, list[int]]:
    """The camp fence seen from the front: ПО-2 concrete panels with the diamond relief between
    protruding posts, a lit cap on top, rust streaks from the brackets, damp and dirt at the foot.
    Returns the picture (cap + face) and the x of every post (for brackets, lamps, crows)."""
    r = rng('wallface', w, seed)
    c = CON
    cap = 3
    out = Img.new(w, face_h + cap)
    out.rect_(0, cap, w, face_h, c[2])
    posts = []
    x = -r.randrange(0, panel // 2)
    while x < w:
        posts.append(x)
        x += panel + 4
    for i, px in enumerate(posts):
        x0, pw = px + 4, panel
        _rhombus(out, x0 + 2, cap + 3, pw - 4, face_h - 7)
        out.rect_(x0, cap, pw, 1, c[4])
        out.rect_(x0, cap + 1, pw, 1, c[3])
        out.rect_(x0, cap + face_h - 3, pw, 1, c[1])
        out.rect_(x0, cap + 1, 1, face_h - 3, c[3])
        out.rect_(x0 + pw - 1, cap + 1, 1, face_h - 3, c[1])
        if r.random() < 0.3:                       # stencilled panel number
            out.paste_(txt(str(r.randrange(10, 99)), '#6b6d68', None), x0 + 3, cap + 4)
    for px in posts:
        out.rect_(px, 0, 4, face_h + cap, c[2])
        out.rect_(px, 0, 1, face_h + cap, c[4])
        out.rect_(px + 1, 0, 1, face_h + cap, c[3])
        out.rect_(px + 3, 0, 1, face_h + cap, c[1])
    out.rect_(0, 0, w, 1, c[1])
    out.rect_(0, 1, w, 1, c[4])
    out.rect_(0, 2, w, 1, c[3])
    for px in posts:
        for k in range(r.randrange(1, 3)):
            out.rect_(px + r.choice([-2, 5, 6, -3]), cap, 1, r.randrange(6, 16), P['rust'][2], 0.45)
    for x in range(w):
        dh = 2 + int(2 * math.sin(x / 7.0 + seed) + r.random() * 1.2)
        out.rect_(x, cap + face_h - dh, 1, dh, '#3b3a33', 0.35)
    return out, posts


def bracket() -> Img:
    """The Y-bracket on a post top that carries the coil: two steel arms, 9 × 8."""
    g = ['#.......#', '.#.....#.', '..#...#..', '...#.#...', '....#....', '....#....', '....#....',
         '....#....']
    return grid(g, {'#': STEEL[2]})


def taiga(w: int, h: int, seed: int = 1) -> Img:
    """The forest beyond the wall: a row of NA spruces, dimmed and cooled with distance, so only
    their crowns show over the fence (the fence covers their feet)."""
    r = rng('taiga', w, seed)
    nat = na('Backgrounds/Tilesets/TilesetNature.png')
    pines = [camp(tiles(nat, 0, 2, 2, 3), sat=0.45), camp(tiles(nat, 2, 2, 2, 3), sat=0.45)]
    pines = [p.mul(0.52).tint('#1e3036', 0.28) for p in pines]
    out = Img.new(w, h)
    x = -20
    while x < w + 10:
        p = r.choice(pines)
        if r.random() < 0.5:
            p = p.flip()
        out.paste_(p, x, h - p.h + r.randrange(-2, 10))
        x += r.randrange(14, 22)
    return out


def fence_seg_h(length: int = 32, sign: Img | None = None, seed: int = 1) -> Img:
    """The inner warning fence along the strip, running east–west: a weathered post at each end
    and three strands of barbed wire sagging between. 17 px tall, posts 3 px wide."""
    h = 17
    wd = P['woodgrey']
    out = Img.new(length + 3, h)
    for k, hh in enumerate((4, 8, 12)):
        for x in range(2, length + 1):
            t = (x - 2) / max(1, length - 2)
            y = h - 1 - hh + int(round(math.sin(math.pi * t) * 1.3))
            out.px_(x, y, STEEL[2])
            if x % 5 == (k * 2 + 1) % 5:
                out.px_(x, y - 1, STEEL[3])
                out.px_(x, y + 1, STEEL[1])
    for px in (0, length):
        out.rect_(px, 1, 3, h - 1, wd[2])
        out.rect_(px, 1, 1, h - 1, wd[3])
        out.rect_(px + 2, 1, 1, h - 1, wd[1])
        out.rect_(px, 0, 3, 1, wd[4])
        out.rect_(px, h - 1, 3, 1, wd[0])
    if sign is not None:
        out.paste_(sign, (length - sign.w) // 2 + 1, 2)
    return out


def fence_seg_v(length: int = 32) -> Img:
    """The warning fence running north–south: posts one above the other, the strands seen end-on
    as one wire from post top to post top. The post stands at the bottom of the picture."""
    wd = P['woodgrey']
    h = length + 16
    out = Img.new(4, h)
    for y in range(3, h - 14):
        out.px_(1, y, STEEL[2])
        if y % 5 == 2:
            out.px_(0, y, STEEL[3])
            out.px_(2, y, STEEL[1])
    py = h - 16
    out.rect_(0, py, 3, 16, wd[2])
    out.rect_(0, py, 1, 16, wd[3])
    out.rect_(2, py, 1, 16, wd[1])
    out.rect_(0, py, 3, 1, wd[4])
    return out


def warn_sign(lines: list[str], w: int | None = None) -> Img:
    """A white enamel plate with a red rim and red stencil text (СТОЙ! / ЗАПРЕТНАЯ ЗОНА)."""
    ts = [txt(s, PAINT['red'], None) for s in lines]
    w = w or max(t.w for t in ts) + 6
    h = sum(t.h + 1 for t in ts) + 5
    out = Img.new(w, h)
    out.rect_(0, 0, w, h, PAINT['red'])
    out.rect_(1, 1, w - 2, h - 2, '#e6e1d0')
    out.rect_(1, h - 2, w - 2, 1, '#bdb7a4')
    y = 3
    for t in ts:
        out.paste_(t, (w - t.w) // 2, y)
        y += t.h + 1
    return ink(out)


def sign_post(sign: Img, pole: int = 10) -> Img:
    """A plate on a steel pipe (for the strip, the gate, the zone)."""
    out = Img.new(max(sign.w, 3), sign.h + pole)
    cx = out.w // 2
    out.rect_(cx - 1, sign.h - 1, 2, pole + 1, STEEL[2])
    out.rect_(cx - 1, sign.h - 1, 1, pole + 1, STEEL[3])
    out.paste_(sign, (out.w - sign.w) // 2, 0)
    return out


# ================================================================================ props
WD, WG, IR, RU, RED, GOLD = P['wood'], P['woodgrey'], P['iron'], P['rust'], P['red'], P['gold']
FIRE = P['fire']


def _shadow(w: int, h: int, alpha: float = 0.32) -> Img:
    """A soft oval contact shadow (stamped on the ground under a standing thing)."""
    out = Img.new(w, h)
    out.ellipse_(w / 2, h / 2, w / 2, h / 2, '#000000', alpha)
    out.ellipse_(w / 2, h / 2, w / 2 - 2, h / 2 - 1, '#000000', alpha * 0.6)
    return out


def worn(img: Img, k: float, seed: int) -> Img:
    """Knock out a share of pixels in clumps: paint worn by boots and weather."""
    r = rng('worn', seed)
    a = img.a.copy()
    hh, ww = a.shape[:2]
    for y in range(hh):
        for x in range(ww):
            if a[y, x, 3] and r.random() < k * (0.5 + 0.9 * math.sin(x * 0.7 + y * 1.3 + seed) ** 2):
                a[y, x, 3] = 0
    return Img(a)


def paint_text(s: str, color: str, scale: int = 2, seed: int = 1, wear: float = 0.12) -> Img:
    """Letters painted on asphalt or concrete: the 3 × 5 font ×2, worn in places."""
    t = txt(s, color, None).scale(scale)
    return worn(t, wear, seed)


def flag_frames(n: int = 4) -> list[Img]:
    """The flagpole of the parade ground: a stepped concrete plinth, a tall steel pole with a
    gilded ball, and a red flag waving in four frames — the one saturated landmark of the square,
    visible from anywhere on the plac."""
    Hh, Ww = 100, 42
    frames = []
    for f in range(n):
        out = Img.new(Ww, Hh)
        # plinth: two concrete steps
        out.rect_(2, Hh - 7, 22, 7, CON[2]); out.rect_(2, Hh - 7, 22, 2, CON[4]); out.rect_(2, Hh - 2, 22, 2, CON[1])
        out.rect_(6, Hh - 12, 14, 5, CON[2]); out.rect_(6, Hh - 12, 14, 2, CON[4]); out.rect_(6, Hh - 8, 14, 1, CON[1])
        out = ink(out)
        # pole
        px = 12
        out.rect_(px, 4, 2, Hh - 16, STEEL[3]); out.rect_(px, 4, 1, Hh - 16, STEEL[4])
        out.rect_(px - 1, 4, 1, Hh - 16, INK); out.rect_(px + 2, 4, 1, Hh - 16, INK)
        out.rect_(px - 1, 1, 4, 3, GOLD[3]); out.rect_(px, 1, 2, 1, GOLD[4]); out.px_(px - 1, 3, GOLD[1])
        # flag: 26 × 15, each column bobs on a wave that grows away from the pole
        cloth = Img.new(28, 22)
        for col in range(26):
            amp = min(2.8, col / 5)
            ph = col * 0.42 - f * (2 * math.pi / n)
            dy = int(round(math.sin(ph) * amp))
            slope = math.cos(ph)
            c = RED[3] if slope > 0.35 else (RED[2] if slope > -0.35 else RED[1])
            top = 3 + dy
            ln = 15 - (1 if col > 22 and (col + f) % 2 else 0)
            cloth.rect_(col, top, 1, ln, c)
            if slope > 0.7:
                cloth.px_(col, top + 1, RED[4])
                cloth.px_(col, top + 2, RED[4])
        cloth = outline(cloth, INK)
        out.paste_(cloth, px + 1, 3)
        out.rect_(px + 2, 5, 1, 17, '#e8dcc0', 0.6)          # hoist rope
        frames.append(out)
    return frames


def podium() -> Img:
    """The tribune the camp chief speaks from: plank deck, a red cloth front with gold braid,
    steps up the middle. 48 × 24."""
    w, h = 48, 24
    out = Img.new(w, h)
    out.rect_(0, 0, w, 8, WD[3])
    for x in range(0, w, 6):
        out.rect_(x, 0, 1, 8, WD[2])
    out.rect_(0, 0, w, 1, WD[4])
    out.rect_(0, 8, w, h - 8, RED[2])
    for x in range(3, w, 7):                                     # folds of the cloth
        out.rect_(x, 9, 1, h - 10, RED[1])
        out.rect_(x + 1, 9, 1, h - 10, RED[3])
    out.rect_(0, 8, w, 2, GOLD[3]); out.rect_(0, 9, w, 1, GOLD[2])
    for x in range(1, w, 3):
        out.px_(x, 10, GOLD[3])
    # steps in the middle
    sx = w // 2 - 7
    for i, (yy, hh) in enumerate(((12, 4), (16, 4), (20, 4))):
        out.rect_(sx - i, yy, 14 + 2 * i, hh, WD[3 - (i % 2)])
        out.rect_(sx - i, yy, 14 + 2 * i, 1, WD[4])
    # a star on the cloth left and right
    for cx in (9, w - 10):
        for dx, dy in ((0, -2), (-1, -1), (0, -1), (1, -1), (-2, 0), (-1, 0), (0, 0), (1, 0), (2, 0), (-1, 1), (1, 1)):
            out.px_(cx + dx, 15 + dy, GOLD[3])
    return ink(out)


def notice_board() -> Img:
    """«ПРИКАЗЫ»: the orders board on two posts under a tin visor, papers pinned in rows. 38 × 36."""
    w, h = 38, 36
    out = Img.new(w, h)
    out.rect_(4, 18, 3, h - 18, WD[2]); out.rect_(4, 18, 1, h - 18, WD[3])
    out.rect_(w - 7, 18, 3, h - 18, WD[1])
    out.rect_(1, 5, w - 2, 22, WD[1])
    out.rect_(3, 7, w - 6, 18, '#3d4a3c')
    out.rect_(3, 7, w - 6, 1, '#55644f')
    t = txt('ПРИКАЗЫ', PAINT['white'], None)
    out.rect_(3, 7, w - 6, 7, '#2c3a2e')
    out.paste_(t, (w - t.w) // 2, 8)
    r = rng('board')
    for i, (x, y) in enumerate(((5, 15), (12, 16), (19, 15), (26, 16), (8, 20), (22, 20))):
        pw, ph = r.choice([(6, 7), (5, 6), (7, 6)])
        out.rect_(x, y, pw, ph, P['paper'][3 if i % 3 else 2])
        out.rect_(x, y + ph - 1, pw, 1, P['paper'][1])
        for ly in range(y + 2, y + ph - 1, 2):
            out.rect_(x + 1, ly, pw - 2, 1, P['paper'][0])
        out.px_(x + pw // 2, y, RED[3])
    out.rect_(0, 2, w, 4, P['tin'][2]); out.rect_(0, 2, w, 1, P['tin'][4]); out.rect_(0, 5, w, 1, P['tin'][0])
    return ink(out)


def honor_board() -> Img:
    """«ДОСКА ПОЧЁТА»: a red panel with a white title and two rows of small portraits in frames
    on a pair of legs — the outside of the Штаб. 54 × 40."""
    w, h = 54, 40
    out = Img.new(w, h)
    out.rect_(6, 26, 3, h - 26, IR[2]); out.rect_(w - 9, 26, 3, h - 26, IR[1])
    out.rect_(0, 0, w, 28, RED[1])
    out.rect_(1, 1, w - 2, 26, RED[2])
    out.rect_(1, 1, w - 2, 1, RED[3])
    t = txt('ДОСКА ПОЧЁТА', GOLD[4], None)
    out.paste_(t, (w - t.w) // 2, 3)
    r = rng('honor')
    skins = ['#c9a27e', '#b98f6c', '#d2ae8a']
    for row in range(2):
        for i in range(6):
            x, y = 3 + i * 8, 10 + row * 9
            out.rect_(x, y, 7, 8, '#d8d0bc')
            out.rect_(x + 1, y + 1, 5, 6, '#6f7a80')
            s = r.choice(skins)
            out.rect_(x + 2, y + 2, 3, 3, s)
            out.rect_(x + 2, y + 2, 3, 1, r.choice(['#3a2e26', '#5c4a3a', '#2a2a2a', '#8a7a6a']))
            out.rect_(x + 1, y + 5, 5, 2, '#2e3440')
    return ink(out)


def slogan() -> Img:
    """The slogan every Soviet camp had over its yard: «НА СВОБОДУ — С ЧИСТОЙ СОВЕСТЬЮ!»
    Red cloth on a plank billboard, two legs. 86 × 36."""
    w, h = 86, 36
    out = Img.new(w, h)
    out.rect_(8, 20, 3, h - 20, WD[2]); out.rect_(8, 20, 1, h - 20, WD[3])
    out.rect_(w - 11, 20, 3, h - 20, WD[1])
    out.rect_(0, 0, w, 22, WD[1])
    out.rect_(2, 2, w - 4, 18, RED[2])
    out.rect_(2, 2, w - 4, 1, RED[3])
    out.rect_(2, 19, w - 4, 1, RED[1])
    for x in range(10, w - 6, 13):
        out.rect_(x, 3, 1, 16, RED[1], 0.5)
    t1 = txt('НА СВОБОДУ -', PAINT['white'], None)
    t2 = txt('С ЧИСТОЙ СОВЕСТЬЮ!', PAINT['white'], None)
    out.paste_(t1, (w - t1.w) // 2, 4)
    out.paste_(t2, (w - t2.w) // 2, 12)
    return ink(out)


def bench(flip: bool = False) -> Img:
    """A yard bench seen from the front: backrest of two slats, seat of three, cast-iron legs.
    28 × 14."""
    g = [
        '.kkkkkkkkkkkkkkkkkkkkkkkkkk.',
        '.k444444444444444444444444k.',
        '.k222222222222222222222222k.',
        '.kkkkkkkkkkkkkkkkkkkkkkkkkk.',
        '.k33333333333333333333333k..',
        '.kk.kk..............kk.kk...',
        'kkkkkkkkkkkkkkkkkkkkkkkkkkkk',
        'k55555555555555555555555555k',
        'k33333333333333333333333333k',
        'k22222222222222222222222222k',
        'kkkkkkkkkkkkkkkkkkkkkkkkkkkk',
        '.kik...................kik..',
        '.kik...................kik..',
        '.kkk...................kkk..',
    ]
    pal = {'k': INK, '2': WD[1], '3': WD[2], '4': WD[3], '5': WD[4], 'i': IR[2]}
    img = grid(g, pal)
    return img.flip() if flip else img


def street_lamp(left: bool = False) -> tuple[Img, tuple[int, int]]:
    """A camp street lamp: a tapered concrete pole, a bent steel arm and a tin shade over a bulb.
    Returns the picture and the bulb's position in it (for the night light)."""
    w, h = 20, 54
    out = Img.new(w, h)
    # pole: 4 px at the foot, 3 at the top
    for y in range(10, h):
        pw = 3 if y < 30 else 4
        out.rect_(4, y, pw, 1, CON[2])
        out.px_(4, y, CON[4])
        out.px_(3 + pw, y, CON[1])
    out.rect_(3, h - 3, 6, 3, CON[1]); out.rect_(3, h - 3, 6, 1, CON[3])
    # arm: up from the pole top and over to the right
    out.rect_(5, 6, 1, 5, STEEL[2])
    out.line_(5, 6, 8, 3, STEEL[2])
    out.rect_(8, 3, 6, 1, STEEL[2])
    out.rect_(8, 2, 6, 1, STEEL[3])
    # shade and bulb
    out.poly_([(12, 4), (18, 4), (20, 8), (10, 8)], P['tin'][3])
    out.rect_(12, 4, 6, 1, P['tin'][4])
    out.rect_(10, 7, 10, 1, P['tin'][1])
    out = outline(out.crop(0, 0, w, h), INK).crop(1, 1, w, h)
    out.rect_(13, 8, 4, 2, '#fff1c2')
    out.px_(14, 10, '#ffe08a')
    bulb = (15, 9)
    if left:
        out = out.flip()
        bulb = (w - 1 - bulb[0], bulb[1])
    return out, bulb


def loudspeaker() -> Img:
    """A pole with two horn loudspeakers — reveille, roll call and the news. 22 × 50."""
    w, h = 22, 50
    out = Img.new(w, h)
    out.rect_(10, 8, 2, h - 8, STEEL[2]); out.rect_(10, 8, 1, h - 8, STEEL[3])
    out.rect_(8, h - 2, 6, 2, STEEL[1])
    for flip in (False, True):
        horn = Img.new(10, 9)
        horn.poly_([(0, 3), (3, 3), (9, 0), (9, 8), (3, 5), (0, 5)], '#6f7b6a')
        horn.poly_([(3, 3), (9, 0), (9, 2), (3, 4)], '#93a08c')
        horn.rect_(8, 1, 1, 7, '#3e483c')
        horn = outline(horn, INK)
        if flip:
            horn = horn.flip()
            out.paste_(horn, 0, 2)
        else:
            out.paste_(horn, w - horn.w, 2)
    out.rect_(9, 4, 4, 5, STEEL[1])
    return out


def fire_barrel(n: int = 4) -> list[Img]:
    """A rusty oil drum with holes punched in its side, a fire burning in it (4 frames): the
    holes glow, the tongues climb and sway, a spark jumps. 18 × 30."""
    frames = []
    r = rng('firebarrel')
    sparks = [(r.randrange(4, 14), r.randrange(0, 6)) for _ in range(n)]
    for f in range(n):
        out = Img.new(18, 30)
        body = Img.new(14, 16)
        for x in range(14):
            col = RU[3] if x < 3 else (RU[2] if x < 9 else RU[1])
            body.rect_(x, 1, 1, 15, col)
        for y in (4, 11):
            body.rect_(0, y, 14, 1, RU[0])
            body.rect_(0, y - 1, 14, 1, RU[3])
        body.ellipse_(7, 1.5, 7, 1.8, RU[0])
        glow = [FIRE[3], FIRE[4], FIRE[3], FIRE[2]][f % 4]
        for hx, hy in ((3, 7), (7, 8), (10, 6), (5, 13), (9, 13)):
            body.px_(hx, hy, glow)
        body = ink(body)
        out.paste_(body, 2, 14)
        # fire above the rim
        tongues = [(5, [7, 9, 6, 8]), (9, [10, 7, 11, 8]), (12, [6, 8, 5, 7])]
        for i, (x, hs) in enumerate(tongues):
            th = hs[(f + i) % 4]
            sway = [0, 1, 0, -1][(f + i) % 4]
            for k in range(th):
                y = 15 - k
                wd = max(1, 3 - k * 3 // max(1, th))
                xx = x + (sway if k > th // 2 else 0)
                col = FIRE[2] if k < th * 0.55 else FIRE[1]
                out.rect_(xx - wd // 2, y, wd + 1, 1, col)
                if k < th * 0.4:
                    out.px_(xx, y, FIRE[4])
        sx, sy = sparks[f]
        out.px_(sx, sy + 1, FIRE[4])
        frames.append(out)
    return frames


def gate_pillar(lamp: bool = True) -> Img:
    """A brick gate pillar with a concrete cap and a round lamp on top. 16 × 50."""
    w, h = 16, 50
    out = Img.new(w, h)
    b = P['brick']
    body = Img.new(14, 38)
    for row in range(0, 38, 4):
        off = (row // 4 % 2) * 4
        for x in range(-off, 14, 8):
            body.rect_(x, row, 7, 3, b[2 if (x + row) % 3 else 3])
            body.rect_(x, row, 7, 1, b[3])
    body.rect_(0, 0, 14, 38, '#000000', 0.0)
    body.rect_(11, 0, 3, 38, '#000000', 0.25)
    out.paste_(body, 1, h - 38)
    out.rect_(0, h - 41, 16, 4, CON[3]); out.rect_(0, h - 41, 16, 1, CON[4]); out.rect_(0, h - 38, 16, 1, CON[1])
    out = ink(out)
    if lamp:
        out.rect_(7, h - 45, 2, 4, STEEL[1])
        out.ellipse_(8, h - 47, 3, 3, INK)
        out.ellipse_(8, h - 47, 2.2, 2.2, '#ffe9b0')
        out.px_(7, h - 48, '#ffffff')
    return out


def gate_beam(span: int) -> Img:
    """The steel truss over the gate with a red star in a white disc at its middle. span px."""
    h = 16
    out = Img.new(span, h)
    out.rect_(0, 5, span, 2, STEEL[2]); out.rect_(0, 5, span, 1, STEEL[3])
    out.rect_(0, 12, span, 2, STEEL[2]); out.rect_(0, 12, span, 1, STEEL[3])
    for x in range(0, span - 4, 8):
        out.line_(x, 7, x + 4, 11, STEEL[1])
        out.line_(x + 4, 11, x + 8, 7, STEEL[1])
    out = outline(out, INK).crop(1, 0, span, h)
    cx = span // 2
    out.ellipse_(cx, 8, 7, 7, INK)
    out.ellipse_(cx, 8, 6, 6, '#e6e1d0')
    star = ['..#..', '..#..', '#####', '.###.', '.#.#.']
    for yy, row in enumerate(star):
        for xx, ch in enumerate(row):
            if ch == '#':
                out.px_(cx - 2 + xx, 6 + yy, RED[3])
    return out


def barrier(up: bool = True) -> Img:
    """The boom barrier (шлагбаум): a striped post with a counterweight and the red-and-white
    pole raised. Pivot at the picture's lower left. 40 × 44."""
    w, h = 40, 44
    out = Img.new(w, h)
    # post
    post = Img.new(7, 16)
    for y in range(16):
        post.rect_(0, y, 7, 1, RED[2] if (y // 4) % 2 == 0 else '#e6e1d0')
    post.rect_(5, 0, 2, 16, '#000000', 0.25)
    out.paste_(ink(post), 2, h - 16)
    # pole: from the pivot up-right at ~62°
    px, py = 6, h - 13
    L = 34
    ang = math.radians(62 if up else 2)
    for i in range(L):
        x = px + math.cos(ang) * i
        y = py - math.sin(ang) * i
        c = RED[3] if (i // 5) % 2 == 0 else '#efe9d6'
        out.rect_(int(round(x)), int(round(y)), 2, 2, c)
    out = outline(out, INK)
    # counterweight behind the pivot
    cw = Img.new(6, 5, IR[2]); cw.rect_(0, 0, 6, 1, IR[3])
    out.paste_(ink(cw), 1, py + 1 - 3)
    return out.crop(1, 1, w, h)


def sandbags(w_bags: int = 4, rows: int = 2) -> Img:
    """A wall of sandbags, staggered courses, khaki cloth with a tied end. 7 px per bag."""
    bw, bh = 9, 6
    w = w_bags * (bw - 1) + bw // 2 + 2
    h = rows * (bh - 2) + 3
    out = Img.new(w, h)
    cloth = ramp('#8a7d5a', 4, 0.4)
    for row in range(rows):
        y = h - bh - row * (bh - 2)
        off = (row % 2) * (bw // 2)
        for i in range(w_bags - (row % 2)):
            x = off + i * (bw - 1)
            bag = Img.new(bw, bh)
            bag.ellipse_(bw / 2, bh / 2, bw / 2, bh / 2, cloth[1])
            bag.ellipse_(bw / 2 - 0.5, bh / 2 - 0.7, bw / 2 - 1.2, bh / 2 - 1.3, cloth[2])
            bag.rect_(2, 1, bw - 5, 1, cloth[3])
            bag.px_(bw - 2, bh // 2, cloth[0])
            out.paste_(outline(bag, INK), x - 1, y - 1)
    return out


def doghouse(name: str = 'ГРОМ') -> Img:
    """A plank dog kennel: pitched roof of tar paper, grey boards, a small arched doorway, the
    dog's name («ГРОМ» at the gate) painted on a board over it. 26 × 26."""
    w, h = 26, 26
    out = Img.new(w, h)
    for i, x in enumerate(range(2, w - 2, 4)):
        c = WG[3] if i == 0 else (WG[2] if i < 4 else WG[1])
        out.rect_(x, 11, 4, h - 11, c)
        out.rect_(x + 3, 11, 1, h - 11, WG[0])
    out.rect_(9, 18, 8, h - 18, '#141012')
    out.rect_(10, 17, 6, 1, '#141012')
    out.poly_([(0, 12), (13, 1), (26, 12)], '#4f4a45')
    out.poly_([(0, 12), (13, 1), (13, 12)], '#625c55')
    for y in (5, 8):
        out.line_(13 - y * 12 // 11, y, 13 + y * 12 // 11, y, '#3d3935')
    out.rect_(0, 11, w, 2, '#3a3531')
    out = ink(out)
    plate = txt(name, '#2a1d18', None)
    pl = Img.new(plate.w + 4, plate.h + 3, '#cbb98f')
    pl.rect_(0, pl.h - 1, pl.w, 1, '#a08c62')
    pl.paste_(plate, 2, 1)
    out.paste_(ink(pl), (w - pl.w) // 2, 13)
    return out


def dog_frames(husky: bool = False) -> list[Img]:
    """The gate's guard dog: NA's dog recoloured into a black-and-tan shepherd (or, for the pet
    kennel's pen, a grey-and-white husky from NA's second dog)."""
    if husky:
        sh = na('Actor/Animals/Dog2/SpriteSheet.png')
        return [camp(sh.crop(i * 16, 0, 16, 16).remap({'#d3a2c0': '#7d7f86', '#f2eaf1': '#e4e2dc',
                                                          '#a5608b': '#4e5058'}), sat=0.8) for i in range(2)]
    sh = na('Actor/Animals/Dog/SpriteSheet.png')
    out = []
    for i in range(2):
        f = sh.crop(i * 16, 0, 16, 16)
        f = f.remap({'#d14b34': '#3b3432', '#ef914f': '#a77c4c', '#8f3e56': '#241f1f'})
        out.append(camp(f, sat=0.8))
    return out


# ================================================================================ industry
def rails(length: int, vertical: bool = False) -> Img:
    """Narrow-gauge mine track as a ground decal: dark sleepers every 5 px, two steel rails with
    a lit top pixel. 13 px across."""
    out = Img.new(length, 13) if not vertical else Img.new(13, length)
    for i in range(0, length, 5):
        if not vertical:
            out.rect_(i, 0, 3, 13, WD[1]); out.rect_(i, 0, 3, 1, WD[2]); out.rect_(i + 2, 0, 1, 13, WD[0])
        else:
            out.rect_(0, i, 13, 3, WD[1]); out.rect_(0, i, 13, 1, WD[2]); out.rect_(0, i + 2, 13, 1, WD[0])
    for k in (2, 9):
        if not vertical:
            out.rect_(0, k, length, 2, STEEL[2]); out.rect_(0, k, length, 1, STEEL[4]); out.rect_(0, k + 2, length, 1, '#000000', 0.35)
        else:
            out.rect_(k, 0, 2, length, STEEL[2]); out.rect_(k, 0, 1, length, STEEL[4]); out.rect_(k + 2, 0, 1, length, '#000000', 0.35)
    return out


def rails_curve(r: int = 24, quadrant: int = 0) -> Img:
    """A quarter turn of the track (radius r px to the centreline). quadrant 0: from the west edge
    turning south; 1: west→north; 2: east→south; 3: east→north (by flips)."""
    S = r + 8
    out = Img.new(S, S)
    cx, cy = 0, S  # centre at the picture's lower-left: arc from the top edge to the right edge
    for i in range(0, 90, 7):
        t = math.radians(i + 3)
        for d in range(-6, 7):
            x, y = cx + math.cos(t) * (r + d), cy - math.sin(t) * (r + d)
            out.px_(int(x), int(y), WD[1])
    for off, col in ((-4, STEEL[3]), (4, STEEL[3])):
        for i in range(0, 900):
            t = math.radians(i / 10)
            x, y = cx + math.cos(t) * (r + off), cy - math.sin(t) * (r + off)
            out.px_(int(x), int(y), col)
    out = out.flip() if quadrant in (2, 3) else out
    return out.flipv() if quadrant in (1, 3) else out


def ore_cart(load: str = 'rust', front: bool = False) -> Img:
    """A mine cart (вагонетка) with a heap of ore: seen side-on on an east–west track (20 × 17),
    or head-on on a north–south one (14 × 18)."""
    w = 14 if front else 20
    out = Img.new(w, 18)
    body = Img.new(w, 10)
    body.poly_([(0, 0), (w, 0), (w - 2, 9), (2, 9)], RU[2])
    body.poly_([(0, 0), (w, 0), (w - 1, 3), (1, 3)], RU[3])
    body.rect_(0, 0, w, 1, RU[4])
    for x in range(3, w - 2, 4):
        body.px_(x, 5, RU[1]); body.px_(x, 7, RU[1])
    body.rect_(w - 4, 1, 3, 8, '#000000', 0.18)
    out.paste_(ink(body), 0, 5)
    heap = Img.new(w - 2, 7)
    r = rng('cart', load, front)
    c = P[load] if load in P else P['stone']
    for _ in range(9):
        x, y, rr = r.uniform(2, w - 4), r.uniform(3, 6), r.uniform(1.6, 2.8)
        heap.ellipse_(x, y, rr, rr * 0.8, c[1])
        heap.ellipse_(x - 0.5, y - 0.6, rr - 0.8, rr * 0.8 - 0.7, c[2])
    for _ in range(2):
        heap.px_(r.randrange(2, w - 4), r.randrange(2, 5), c[4])
    out.paste_(outline(heap, INK).crop(1, 1, w - 2, 7), 1, 0)
    for wx in ((3, w - 6) if not front else (2, w - 5)):
        out.ellipse_(wx + 1.5, 15.5, 2.5, 2.5, INK)
        out.ellipse_(wx + 1.5, 15.5, 1.3, 1.3, IR[3])
    return out


def spoil_heap(w: int = 56, h: int = 34, tone: str = 'stone', gems: tuple[str, ...] = (), seed: int = 1) -> Img:
    """A spoil heap of broken rock tipped from the carts: a lumpy cone, lit from the upper left,
    the lower-right flank in shadow, glints of ore in it. Rough-edged at the foot."""
    r = rng('heap', w, h, tone, seed)
    out = Img.new(w, h)
    c = list(P[tone])
    while len(c) < 5:
        c.append(ramp(c[-1], 3, 0.3)[2])
    lumps = []
    for _ in range(int(w * h / 9)):
        x = r.uniform(3, w - 3)
        top = h - (h - 6) * max(0, 1 - abs(x - w * 0.47) / (w * 0.5)) ** 0.9
        y = r.uniform(top, h - 2)
        lumps.append((x, y, r.uniform(1.8, 3.6)))
    lumps.sort(key=lambda l: l[1])
    for x, y, rr in lumps:
        side = (x - w * 0.47) / (w * 0.5)
        sh = 0 if side < -0.25 else (1 if side < 0.35 else 2)
        base = [2, 1, 1][sh] if y < h * 0.8 else 1
        out.ellipse_(x, y, rr, rr * 0.75, c[max(0, base - 1)])
        out.ellipse_(x - 0.6, y - 0.7, rr - 0.9, rr * 0.75 - 0.8, c[base + (1 if sh == 0 else 0)])
        if sh == 0 and r.random() < 0.4:
            out.px_(int(x - rr / 2), int(y - rr / 2), c[4])
    for g in gems:
        for _ in range(4):
            x = r.uniform(w * 0.2, w * 0.8)
            top = h - (h - 6) * max(0, 1 - abs(x - w * 0.47) / (w * 0.5))
            y = r.uniform(top + 2, h - 3)
            out.px_(int(x), int(y), g)
            out.px_(int(x) + 1, int(y), '#ffffff')
    return outline(out, INK)


def conveyor(n: int = 4) -> list[Img]:
    """An inclined belt on two trestles lifting ore to the top of a heap; the lumps on it move one
    step a frame. 54 × 38, rising to the left."""
    frames = []
    w, h = 54, 38
    for f in range(n):
        out = Img.new(w, h)
        # trestles
        for (x0, y0, hh) in ((12, 10, 26), (40, 23, 14)):
            out.line_(x0 - 3, y0 + hh, x0, y0, IR[2]); out.line_(x0 + 3, y0 + hh, x0, y0, IR[1])
            out.rect_(x0 - 2, y0 + hh // 2, 5, 1, IR[2])
        # belt: from (52, 30) up to (4, 6)
        for i in range(0, 50):
            x = 52 - i
            y = 30 - i * 24 / 48
            out.rect_(int(x), int(y), 1, 4, '#2a2826')
            out.px_(int(x), int(y), '#4a4642')
            if (i + f * 2) % 6 == 0:
                out.px_(int(x), int(y) + 3, IR[3])
        out.rect_(50, 28, 4, 6, IR[2]); out.rect_(2, 4, 5, 6, IR[2])
        for k in range(8):
            i = (k * 6 + f * 2) % 48
            x, y = 52 - i, 30 - i * 24 / 48
            out.ellipse_(x, y - 1, 1.8, 1.4, P['stone'][2] if k % 3 else RU[3])
        frames.append(outline(out, INK))
    return frames


def coal_pile(w: int = 44, h: int = 26) -> Img:
    """The boiler house's coal: a black heap with blue glints and a shovel stuck in it."""
    out = spoil_heap(w, h, 'coal', ('#7a8aa6',), seed=3)
    out.rect_(w - 14, 1, 2, 14, WD[3]); out.rect_(w - 14, 1, 1, 14, WD[4])
    out.rect_(w - 16, 13, 6, 5, IR[3]); out.rect_(w - 16, 13, 6, 1, IR[4])
    return out


def trash_bin(open_: bool = True) -> Img:
    """A yard garbage container: tin box on castors, dented, rust at the seams, the lid propped
    up with rubbish showing. 24 × 22."""
    w, h = 24, 22
    out = Img.new(w, h)
    t = P['tin']
    out.rect_(1, 6, w - 2, h - 9, t[2])
    out.rect_(1, 6, 3, h - 9, t[3])
    out.rect_(w - 5, 6, 4, h - 9, t[1])
    for x in range(6, w - 5, 5):
        out.rect_(x, 8, 1, h - 12, t[1])
    out.rect_(1, 6, w - 2, 2, t[4])
    out.rect_(3, h - 6, 4, 3, RU[2], 0.8)
    out.rect_(w - 9, 10, 3, 2, RU[3], 0.7)
    if open_:
        out.rect_(2, 3, w - 4, 4, '#3a352e')
        for x, c in ((4, P['paper'][3]), (8, '#6e8a5a'), (13, P['paper'][2]), (17, '#8a5a3a')):
            out.rect_(x, 3, 3, 2, c)
        out.poly_([(0, 4), (w, 1), (w, 3), (0, 6)], t[3])
    else:
        out.rect_(0, 3, w, 4, t[3]); out.rect_(0, 3, w, 1, t[4])
    out = ink(out)
    for x in (3, w - 6):
        out.rect_(x, h - 3, 3, 3, INK)
    return out


def pallets(n: int = 3) -> Img:
    """A stack of wooden pallets, grey from rain. 24 × (4n + 4)."""
    w = 24
    out = Img.new(w, 4 * n + 4)
    for i in range(n):
        y = (n - 1 - i) * 4 + 4
        out.rect_(0, y, w, 1, WG[3])
        out.rect_(0, y + 1, w, 3, WG[1])
        for x in (1, 11, 20):
            out.rect_(x, y + 1, 3, 3, WG[2])
    out.rect_(0, 0, w, 4, WG[3])
    for x in range(0, w, 5):
        out.rect_(x, 0, 4, 4, WG[3]); out.rect_(x, 0, 4, 1, WG[4]); out.rect_(x + 4, 0, 1, 4, WG[1])
    return ink(out)


def tyres(n: int = 3) -> Img:
    """A stack of old tyres. 16 × (4n + 6)."""
    w = 16
    out = Img.new(w, 4 * n + 6)
    for i in range(n):
        y = (n - 1 - i) * 4 + 5
        out.ellipse_(8, y + 1, 8, 3.5, '#1d1d20')
        out.rect_(0, y, 16, 3, '#2a2a2e')
        out.rect_(1, y, 14, 1, '#3c3c42')
    out.ellipse_(8, 5, 8, 4, '#2a2a2e')
    out.ellipse_(8, 5, 4, 1.8, '#0f0f11')
    out.rect_(3, 2, 5, 1, '#46464c')
    return outline(out, INK)


def jerrycan(color: str = '#5e6b3e') -> Img:
    """A steel jerrycan, 8 × 11."""
    r = ramp(color, 4, 0.45)
    out = Img.new(8, 11)
    out.rect_(0, 2, 8, 9, r[1]); out.rect_(0, 2, 2, 9, r[2]); out.rect_(0, 2, 8, 1, r[3])
    out.line_(2, 4, 6, 9, r[0]); out.line_(6, 4, 2, 9, r[0])
    out.rect_(1, 0, 3, 2, r[1]); out.rect_(5, 0, 2, 3, IR[2])
    return ink(out)


def truck() -> Img:
    """The camp's old lorry, nose to the viewer: faded army-green cab, a round-eyed grille, a
    canvas-covered bed behind. Seen from the front and above, 38 × 60."""
    w, h = 38, 60
    out = Img.new(w, h)
    g = ramp('#5d6a48', 5, 0.5)
    tarp = ramp('#6d6a4e', 5, 0.45)
    # canvas bed: a ribbed tarp hooped over the bed, seen from above
    out.rect_(3, 0, w - 6, 30, tarp[2])
    for y in range(3, 30, 6):
        out.rect_(3, y, w - 6, 1, tarp[1])
        out.rect_(3, y + 1, w - 6, 1, tarp[3])
    out.rect_(3, 0, 3, 30, tarp[3]); out.rect_(w - 6, 0, 3, 30, tarp[1])
    out.rect_(2, 28, w - 4, 3, WD[1])
    # cab roof and windscreen
    out.rect_(5, 30, w - 10, 9, g[2]); out.rect_(5, 30, w - 10, 2, g[3]); out.rect_(6, 31, 6, 1, g[4])
    out.rect_(5, 39, w - 10, 7, '#26323a')
    out.rect_(7, 40, 6, 1, '#6d8a96'); out.line_(8, 44, 12, 40, '#4f6874')
    out.rect_(w // 2, 39, 1, 7, g[1])
    # bonnet sloping down to the grille
    out.poly_([(7, 46), (w - 7, 46), (w - 5, 52), (5, 52)], g[2])
    out.rect_(7, 46, w - 14, 1, g[3])
    # fenders and wheels
    for x in (1, w - 7):
        out.rect_(x, 44, 6, 12, g[1]); out.rect_(x, 44, 6, 1, g[3])
        out.rect_(x + 1, 55, 4, 5, '#1b1b1d')
    # grille, headlights, bumper
    out.rect_(9, 52, w - 18, 5, '#2e3326')
    for x in range(10, w - 9, 2):
        out.rect_(x, 52, 1, 5, '#48503c')
    for x in (5, w - 9):
        out.ellipse_(x + 2, 54, 2.5, 2.5, '#d9d2a8'); out.px_(x + 1, 53, '#ffffff')
    out.rect_(3, 57, w - 6, 3, IR[3]); out.rect_(3, 57, w - 6, 1, IR[4])
    out.rect_(14, 58, 10, 2, '#e8e4d2'); out.rect_(15, 58, 8, 1, '#232323')   # number plate
    return ink(out)


# ================================================================================ gardens, life
RUNES = {  # elder futhark, as strokes on a 5 × 9 grid (x0, y0, x1, y1)
    'fehu': [(1, 0, 1, 8), (1, 2, 4, 0), (1, 4, 4, 2)],
    'uruz': [(1, 8, 1, 0), (1, 0, 4, 3), (4, 3, 4, 8)],
    'raido': [(1, 0, 1, 8), (1, 0, 4, 2), (4, 2, 1, 4), (1, 4, 4, 8)],
    'sowilo': [(4, 0, 1, 3), (1, 3, 4, 5), (4, 5, 1, 8)],
    'gebo': [(0, 1, 4, 7), (4, 1, 0, 7)],
    'jera': [(2, 0, 0, 2), (0, 2, 2, 4), (2, 4, 4, 6), (4, 6, 2, 8)],
}


def menhir(rune: str, n: int = 2, h: int = 26, seed: int = 1) -> list[Img]:
    """A standing stone of the enchanter's garden with a rune cut into it; the cut glows violet and
    breathes (n frames). Moss at its foot, lichen on its crown. 14 × h."""
    r = rng('menhir', rune, seed)
    w = 14
    st = ['#2f2c38', '#46424f', '#5f5a68', '#7b7584', '#9c96a2']
    base = Img.new(w, h)
    # silhouette: a slab narrowing and rounding to the top, a little lean
    lean = r.choice([-1, 0, 1])
    for y in range(h):
        t = y / h
        half = 5.5 - (1 - t) ** 2 * 2.2
        cx = 7 + lean * (1 - t)
        x0, x1 = int(round(cx - half)), int(round(cx + half))
        if y < 2:
            x0 += 2 - y; x1 -= 2 - y
        base.rect_(x0, y, x1 - x0, 1, st[2])
        base.rect_(x0, y, 2, 1, st[3])
        base.rect_(x1 - 2, y, 2, 1, st[1])
        if y < 3:
            base.rect_(x0, y, x1 - x0, 1, st[3])
    for _ in range(5):
        base.px_(r.randrange(4, 10), r.randrange(4, h - 4), st[1])
    base.ellipse_(r.randrange(4, 9), 3, 2, 1.2, '#7c8a5e')           # lichen
    base = ink(base)
    base.rect_(1, h - 3, w - 2, 2, '#4b5e40')                           # moss at the foot
    base.px_(2, h - 4, '#627a4c'); base.px_(w - 4, h - 4, '#627a4c')
    frames = []
    for f in range(n):
        out = base.copy()
        glow = P['violet'][4] if f % 2 == 0 else P['violet'][3]
        halo = P['violet'][2]
        for x0, y0, x1, y1 in RUNES[rune]:
            out.line_(4 + x0 + 1, 7 + y0 + 1, 4 + x1 + 1, 7 + y1 + 1, halo, 0.7)
            out.line_(4 + x0, 7 + y0, 4 + x1, 7 + y1, glow)
        frames.append(out)
    return frames


def stepping_stone(seed: int = 1) -> Img:
    """A flat stone set into moss or earth (ground decal), 11 × 7."""
    r = rng('step', seed)
    w, h = r.choice([(11, 7), (10, 6), (12, 7)])
    out = Img.new(w, h)
    out.ellipse_(w / 2, h / 2 + 0.5, w / 2, h / 2, '#3a3740')
    out.ellipse_(w / 2 - 0.3, h / 2, w / 2 - 0.8, h / 2 - 0.8, '#8a8690')
    out.ellipse_(w / 2 - 1, h / 2 - 0.8, w / 2 - 2.5, h / 2 - 2, '#a39fa8')
    return out


def mushrooms(seed: int = 1) -> Img:
    """A clump of pale toadstools, 9 × 7."""
    g = ['..ww.....', '.wrrw....', 'wrrrrw.ww', '..ll.wrrw', '..ll..ll.', '..ll..ll.']
    return outline(grid(g, {'w': '#e8dcc8', 'r': '#9a4a52', 'l': '#d8ccb4'}), INK)


def dead_tree() -> Img:
    """A dead tree in the enchanter's garden: NA's bare tree, cold-graded. 32 × 48."""
    nat = na('Backgrounds/Tilesets/TilesetNature.png')
    t = camp(tiles(nat, 0, 5, 2, 3), sat=0.4).tint('#3a3446', 0.25)
    return t


def na_prop(col: int, row: int, cw: int = 1, ch: int = 1, sat: float = 0.55, sheet: str = 'TilesetNature') -> Img:
    """Any NA tileset piece, through the camp grade, trimmed to its pixels."""
    t = camp(tiles(na(f'Backgrounds/Tilesets/{sheet}.png'), col, row, cw, ch), sat=sat)
    img, _, _ = t.trim()
    return img


def birch(seed: int = 1) -> Img:
    """A thin northern birch: a white trunk with black dashes, a small airy crown of pale leaf
    clusters. 30 × 52."""
    r = rng('birch', seed)
    w, h = 30, 52
    out = Img.new(w, h)
    lv = ['#3f5230', '#566d3e', '#708a4d', '#8ea562', '#a9bb7a']
    # trunk
    tx = 14
    for y in range(18, h):
        wd = 3 if y > 30 else 2
        out.rect_(tx, y, wd, 1, '#dcd6c6')
        out.px_(tx + wd - 1, y, '#a8a193')
        if r.random() < 0.28:
            out.rect_(tx + r.randrange(0, wd), y, r.choice([1, 2]), 1, '#2a2622')
    out.line_(tx, 26, tx - 6, 18, '#cfc8b8'); out.line_(tx + 2, 22, tx + 8, 15, '#cfc8b8')
    # crown: clusters
    for _ in range(26):
        cx, cy = r.gauss(15, 6), r.gauss(15, 6)
        if not (2 < cx < 28 and 2 < cy < 32):
            continue
        rr = r.uniform(2.4, 4.2)
        out.ellipse_(cx, cy, rr, rr * 0.85, lv[1])
        out.ellipse_(cx - 0.6, cy - 0.7, rr - 1, rr * 0.85 - 1, lv[2] if cx > 14 else lv[3])
        if cx < 15 and r.random() < 0.5:
            out.px_(int(cx - 1), int(cy - 1), lv[4])
    out = outline(out, INK)
    return out


def bush(kind: int = 0) -> Img:
    """NA bushes, graded: 0–5 the round and leafy ones from TilesetNature row 10."""
    col = [0, 1, 2, 3, 6, 7][kind % 6]
    return na_prop(col, 10, sat=0.5)


def cabbage(seed: int = 1) -> Img:
    """A cabbage: a pale round head in dark spread leaves. 10 × 8."""
    g = [
        '..kkkkkk..',
        '.k3344332k',
        'k334554433',
        'k245555442',
        'k234554432',
        '.k2334432k',
        '..k12221k.',
        '...kkkk...',
    ]
    pal = {'k': INK, '1': '#304028', '2': '#44583a', '3': '#5d7a4c', '4': '#8aa66e', '5': '#b5c796'}
    img = grid(g, pal)
    return img.flip() if seed % 2 else img


def greens(seed: int = 1) -> Img:
    """A row plant (onion, beet tops): three spiky leaves, 7 × 7."""
    g = ['..g.g..', '.g.gg.g', '.gg.g.g', '..ggg..', '..gdg..', '...d...', '..kkk..']
    img = grid(g, {'g': '#6f8a4e', 'd': '#8a4a52', 'k': '#2b221d'})
    return img.flip() if seed % 2 else img


def scarecrow(n: int = 2) -> list[Img]:
    """The garden's scarecrow: a camp quilted jacket on a cross of sticks, an ushanka with one
    flap up, straw hands, a sack face with stitched eyes; the jacket's hem flaps (n frames).
    22 × 36."""
    frames = []
    cl = P['cloth']
    for f in range(n):
        out = Img.new(22, 36)
        out.rect_(10, 12, 2, 24, WD[2]); out.rect_(10, 12, 1, 24, WD[3])        # pole
        out.rect_(1, 14, 20, 2, WD[2]); out.rect_(1, 14, 20, 1, WD[3])          # cross-bar
        # jacket (ватник): quilted rows
        out.rect_(5, 13, 12, 12, cl[1])
        out.rect_(5, 13, 3, 12, cl[2])
        for y in range(15, 25, 3):
            out.rect_(5, y, 12, 1, cl[0])
        out.rect_(10, 13, 1, 12, cl[0])
        out.rect_(1, 13, 5, 4, cl[1]); out.rect_(16, 13, 5, 4, cl[1])          # sleeves
        out.rect_(12, 17, 3, 3, '#e6e1d0'); out.rect_(12, 18, 3, 1, '#2a2622')  # the number patch
        hem = [0, 1][f % 2]
        out.rect_(5, 25, 12, 1 + hem, cl[1])
        # straw hands
        for x in (0, 21):
            out.px_(x, 14, P['straw'][3]); out.px_(x, 15, P['straw'][2]); out.px_(x, 16, P['straw'][3])
        # head: a stuffed sack with stitched-cross eyes and a stitched mouth, straw at the neck
        out.ellipse_(11, 9, 4.5, 4, '#b8a47c'); out.ellipse_(10.5, 8.5, 3.5, 3, '#cdb98f')
        for ex in (8, 12):
            out.px_(ex, 8, INK); out.px_(ex + 1, 9, INK); out.px_(ex + 1, 8, '#00000000'); out.px_(ex, 9, INK)
            out.px_(ex + 1, 8, INK)
        for mx in range(9, 14, 2):
            out.px_(mx, 11, '#5a4630')
        out.px_(8, 13, P['straw'][3]); out.px_(14, 13, P['straw'][3]); out.px_(11, 13, P['straw'][2])
        # ushanka
        out.rect_(6, 3, 11, 4, '#5a4a3c'); out.rect_(6, 3, 11, 1, '#76624f')
        out.rect_(7, 2, 9, 1, '#4a3c30')
        out.rect_(5, 6 - f % 2, 2, 4, '#5a4a3c')                                 # the flap flutters
        out.rect_(16, 3, 2, 3, '#5a4a3c')
        frames.append(outline(out, INK).crop(1, 0, 22, 36))
    return frames


def picket(length: int = 32, vertical: bool = False) -> Img:
    """A low picket fence of grey slats (garden, pen). East–west: 11 px tall slats every 3 px on
    two rails. North–south: the slats seen from above as a dotted line."""
    if not vertical:
        out = Img.new(length, 12)
        out.rect_(0, 4, length, 1, WG[1]); out.rect_(0, 8, length, 1, WG[1])
        for x in range(0, length, 3):
            out.rect_(x, 1, 2, 11, WG[2]); out.px_(x, 1, WG[3]); out.rect_(x, 0, 1, 1, WG[3])
            out.px_(x + 1, 11, WG[0])
        return outline(out, INK).crop(1, 0, length, 13)
    out = Img.new(4, length + 10)
    out.rect_(1, 0, 2, length + 10, WG[1])
    for y in range(0, length, 3):
        out.rect_(0, y, 4, 2, WG[2]); out.rect_(0, y, 4, 1, WG[3])
    return ink(out)


def plank_fence(length: int = 32, vertical: bool = False) -> Img:
    """A solid plank fence for the dog pen, head-high to a dog: 14 px, grey boards."""
    if not vertical:
        out = Img.new(length, 15)
        for x in range(0, length, 4):
            c = WG[2] if (x // 4) % 3 else WG[3]
            out.rect_(x, 1, 4, 14, c)
            out.rect_(x + 3, 1, 1, 14, WG[1])
            out.px_(x + 1, 0, c)
        out.rect_(0, 4, length, 1, WG[1]); out.rect_(0, 11, length, 1, WG[1])
        return ink(out)
    out = Img.new(5, length + 12)
    out.rect_(0, 0, 5, length + 12, WG[2])
    out.rect_(0, 0, 1, length + 12, WG[3])
    out.rect_(4, 0, 1, length + 12, WG[1])
    for y in range(0, length + 12, 6):
        out.rect_(0, y, 5, 1, WG[1])
    return ink(out)


def trough() -> Img:
    """A water trough of planks, 22 × 11."""
    out = Img.new(22, 11)
    out.rect_(0, 0, 22, 11, WD[2]); out.rect_(0, 0, 22, 2, WD[4])
    out.rect_(2, 2, 18, 4, '#3f5a66'); out.rect_(4, 3, 6, 1, '#7fa2ad')
    out.rect_(0, 7, 22, 1, IR[2])
    return ink(out)


def laundry(n: int = 2, length: int = 76) -> list[Img]:
    """A drying line between two T-posts with the camp's washing: black robes with white number
    patches, trousers, a towel and a pair of socks; they sway (n frames). length × 34."""
    h = 34
    items = ['robe', 'trousers', 'robe', 'towel', 'socks', 'robe', 'trousers']
    frames = []
    cl = ['#1d2026', '#2b2f38', '#3b404b', '#50566' + '3']
    for f in range(n):
        out = Img.new(length, h)
        for px in (1, length - 4):
            out.rect_(px, 4, 3, h - 4, WG[2]); out.rect_(px, 4, 1, h - 4, WG[3])
            out.rect_(px - 3, 4, 9, 2, WG[2]); out.rect_(px - 3, 4, 9, 1, WG[3])
        for x in range(4, length - 4):
            t = (x - 4) / (length - 8)
            out.px_(x, 6 + int(round(math.sin(math.pi * t) * 3)), '#cfc8b4')
        x = 7
        for i, it in enumerate(items):
            t = (x - 4) / (length - 8)
            y = 6 + int(round(math.sin(math.pi * t) * 3)) + 1
            sw = [0, 1][(f + i) % 2]
            if it == 'robe':
                g = Img.new(10, 13)
                g.rect_(0, 0, 10, 4, cl[2]); g.rect_(2, 4, 6, 9, cl[1]); g.rect_(2, 4, 2, 9, cl[2])
                g.rect_(5, 5, 3, 2, '#e6e1d0'); g.rect_(5, 6, 3, 1, '#3a3a3a')
                if sw:
                    g.rect_(2, 12, 6, 1, '#00000000')
                    g = g.crop(-1, 0, 10, 13) if False else g
                out.paste_(outline(g, INK).crop(0, 0, 11, 14), x - 1 + sw, y)
                x += 11
            elif it == 'trousers':
                g = Img.new(7, 13)
                g.rect_(0, 0, 7, 3, cl[2]); g.rect_(0, 3, 3, 10, cl[1]); g.rect_(4, 3, 3, 10, cl[1])
                g.rect_(0, 3, 1, 10, cl[2])
                out.paste_(outline(g, INK), x - 1 + sw, y)
                x += 9
            elif it == 'towel':
                g = Img.new(8, 11, '#b7ad96'); g.rect_(0, 8, 8, 1, '#8a3a3a'); g.rect_(0, 0, 8, 1, '#d6cdb6')
                out.paste_(outline(g, INK), x - 1 + sw, y)
                x += 10
            else:
                for k in range(2):
                    g = Img.new(3, 7, '#5a5a5a'); g.rect_(0, 5, 3, 2, '#8a8a8a')
                    out.paste_(outline(g, INK), x + k * 5 - 1 + sw, y)
                x += 11
        frames.append(out)
    return frames


def pullup_bar() -> Img:
    """Турник: two steel posts painted a faded blue and a bar between them. 30 × 34."""
    w, h = 30, 34
    out = Img.new(w, h)
    bl = ramp('#46607a', 4, 0.4)
    for x in (2, w - 5):
        out.rect_(x, 2, 3, h - 2, bl[1]); out.rect_(x, 2, 1, h - 2, bl[2])
    out.rect_(0, 3, w, 2, STEEL[3]); out.rect_(0, 3, w, 1, STEEL[4])
    out.rect_(1, h - 2, 6, 2, CON[1]); out.rect_(w - 7, h - 2, 6, 2, CON[1])
    return ink(out)


def parallel_bars() -> Img:
    """Брусья: two rails on four posts, seen from the front-top. 32 × 22."""
    w, h = 32, 22
    out = Img.new(w, h)
    bl = ramp('#46607a', 4, 0.4)
    for x in (2, w - 5):
        out.rect_(x, 5, 2, h - 5, bl[1]); out.rect_(x + 1, 1, 2, h - 6, bl[2])
    out.rect_(0, 1, w, 2, STEEL[3]); out.rect_(0, 1, w, 1, STEEL[4])
    out.rect_(0, 5, w, 2, STEEL[2]); out.rect_(0, 5, w, 1, STEEL[3])
    return ink(out)


def bench_press() -> Img:
    """A homemade weight bench: a plank on trestles, a rack and a barbell with iron plates. 32 × 20."""
    w, h = 32, 20
    out = Img.new(w, h)
    out.rect_(8, 9, 16, 4, WD[3]); out.rect_(8, 9, 16, 1, WD[4]); out.rect_(8, 12, 16, 1, WD[1])
    out.rect_(9, 13, 2, 7, IR[2]); out.rect_(21, 13, 2, 7, IR[1])
    out.rect_(4, 4, 2, 16, IR[2]); out.rect_(26, 4, 2, 16, IR[1])
    out.rect_(0, 4, w, 2, STEEL[3]); out.rect_(0, 4, w, 1, STEEL[4])
    for x in (0, 2, 27, 29):
        out.rect_(x, 0, 3, 10, '#232326'); out.rect_(x, 0, 1, 10, '#3c3c42')
    return ink(out)


def tyre_arch() -> Img:
    """A tyre dug in upright to half its height — a row of them makes the sports ground's edge
    and its hop drill. 14 × 9."""
    out = Img.new(14, 9)
    out.ellipse_(7, 9, 7, 8.5, '#1d1d20')
    out.ellipse_(7, 9, 4, 5, '#00000000')
    a = out.a
    yy, xx = np.mgrid[0:9, 0:14]
    hole = ((xx + 0.5 - 7) / 4) ** 2 + ((yy + 0.5 - 9) / 5) ** 2 <= 1
    a[hole] = 0
    out = Img(a)
    out.rect_(3, 1, 3, 1, '#48484e'); out.px_(2, 2, '#48484e')
    return outline(out, INK).crop(1, 1, 14, 9)


def punching_bag(n: int = 2) -> list[Img]:
    """A punching bag of tarpaulin hanging from a pipe frame; it swings a little (n frames). 22 × 36."""
    frames = []
    for f in range(n):
        out = Img.new(22, 36)
        out.rect_(2, 2, 2, 34, STEEL[2]); out.rect_(18, 2, 2, 34, STEEL[1])
        out.rect_(1, 1, 20, 2, STEEL[3])
        sx = [0, 1][f % 2]
        out.line_(11, 3, 11 + sx, 8, '#8a8a80')
        bag = Img.new(8, 17)
        bag.rect_(0, 1, 8, 15, '#5e4a36'); bag.rect_(0, 1, 2, 15, '#7a6248'); bag.rect_(6, 1, 2, 15, '#46362a')
        bag.rect_(0, 4, 8, 1, '#3a2e24'); bag.rect_(0, 12, 8, 1, '#3a2e24')
        bag.ellipse_(4, 1, 4, 1.5, '#7a6248')
        out.paste_(ink(bag), 7 + sx, 8)
        frames.append(ink(out.crop(0, 0, 22, 36)) if False else outline(out, INK).crop(1, 1, 22, 36))
    return frames


def crow(n: int = 3) -> list[Img]:
    """A hooded crow (серая ворона) on the wall: grey body, black head, wings and tail; it looks
    about and pecks (n frames). 10 × 9."""
    base = [
        '..kk......',
        '.kbbk.....',
        'ykbwbk....',
        '.kbbbggk..',
        '..kgggggk.',
        '..kggggbbk',
        '...kgggbbk',
        '....kkkbk.',
        '....l..l..',
    ]
    peck = [
        '..........',
        '..........',
        '...kk.....',
        '..kbbkggk.',
        '.kbwbgggkk',
        'ykbbggggbk',
        '..kkgggbbk',
        '....kkkbk.',
        '....l..l..',
    ]
    turn = [
        '...kk.....',
        '..kbbk....',
        '..kbwbky..',
        '..kbbbgk..',
        '..kgggggk.',
        '..kggggbbk',
        '...kgggbbk',
        '....kkkbk.',
        '....l..l..',
    ]
    pal = {'k': INK, 'b': '#26262c', 'w': '#d8d0bc', 'g': '#8a8a90', 'y': '#3a3a40', 'l': '#2a2a2e'}
    poses = [base, turn, base, peck][:max(n, 1)] if n > 3 else [base, turn, peck][:n]
    return [grid(p, pal) for p in poses]


def puddle(w: int = 22, h: int = 9, seed: int = 1) -> Img:
    """A puddle (ground decal): dark water reflecting a grey sky, a pale streak of light, a rim of
    wet mud."""
    r = rng('puddle', w, h, seed)
    out = Img.new(w + 4, h + 3)
    for _ in range(4):
        cx, cy = w / 2 + r.uniform(-w / 5, w / 5), h / 2 + 1.5 + r.uniform(-1, 1)
        out.ellipse_(cx + 2, cy, w / 2 - abs(cx - w / 2) + 1, h / 2, '#3a3029', 0.9)
    for _ in range(4):
        cx, cy = w / 2 + r.uniform(-w / 6, w / 6), h / 2 + 1 + r.uniform(-0.6, 0.6)
        out.ellipse_(cx + 2, cy, w / 2 - abs(cx - w / 2) - 0.5, h / 2 - 1, '#47606c')
    out.ellipse_(w / 2 + 2, h / 2 + 2, w / 2 - 3, h / 2 - 2.2, '#3c515c')
    out.rect_(int(w * 0.3), int(h / 2), int(w * 0.35), 1, '#8fa9b3')
    out.rect_(int(w * 0.55), int(h / 2) + 2, 3, 1, '#7a96a0')
    return out


def manhole() -> Img:
    """A cast-iron manhole cover in the asphalt (ground decal), 14 × 10."""
    out = Img.new(14, 10)
    out.ellipse_(7, 5, 7, 5, '#1c1d1f')
    out.ellipse_(7, 4.6, 6, 4.2, IR[2])
    out.ellipse_(7, 4.6, 4.5, 3, IR[1])
    for x in range(3, 12, 2):
        out.rect_(x, 2, 1, 6, IR[3])
    out.ellipse_(7, 4.6, 1.6, 1.2, IR[3])
    out.rect_(3, 1, 5, 1, IR[4])
    return out


def crack_weeds(seed: int = 1, weeds: bool = True) -> Img:
    """A crack in concrete or asphalt with a tuft of weed in it (ground decal), ~22 × 12."""
    r = rng('crack', seed)
    out = Img.new(24, 13)
    x, y = r.randrange(1, 5), r.randrange(4, 9)
    pts = []
    for _ in range(9):
        pts.append((x, y))
        out.px_(x, y, '#1e1f22')
        if r.random() < 0.3:
            out.px_(x, y + 1, '#1e1f22')
        x += r.choice([2, 2, 3])
        y += r.choice([-1, 0, 0, 1])
        y = max(1, min(11, y))
        if x > 22:
            break
    for bx, by in pts[2:7:2]:
        out.px_(bx + 1, by - 1, '#1e1f22')
    if weeds:
        wx, wy = pts[len(pts) // 2]
        for dx, dy in ((0, -1), (-1, -2), (1, -2), (0, -3), (2, -1), (-2, -1)):
            out.px_(wx + dx, wy + dy, '#5d7a3e' if dy < -1 else '#44592f')
    return out


def oil_stain(seed: int = 1) -> Img:
    """An oil stain on asphalt or earth (ground decal): a dark irregular blot with a sheen."""
    r = rng('oil', seed)
    out = Img.new(20, 12)
    for _ in range(5):
        out.ellipse_(10 + r.uniform(-4, 4), 6 + r.uniform(-2, 2), r.uniform(3, 6), r.uniform(2, 3.5), '#141414', 0.45)
    out.px_(8, 5, '#4a5a66'); out.px_(9, 5, '#5a4a66')
    return out


def footprints(n: int = 6, dx: int = 3, dy: int = -5, seed: int = 1) -> Img:
    """A trail of boot prints across raked sand (ground decal)."""
    w, h = abs(dx) * n + 8, abs(dy) * n + 8
    out = Img.new(w, h)
    x, y = (4 if dx > 0 else w - 5), (h - 5 if dy < 0 else 4)
    for i in range(n):
        side = 2 if i % 2 else -2
        px, py = x + (side if abs(dy) >= abs(dx) else 0), y + (side if abs(dx) > abs(dy) else 0)
        out.rect_(px, py, 2, 3, '#77623f', 0.9)
        out.px_(px, py + 3, '#77623f', 0.7)
        out.px_(px + 1, py - 1, '#d9c89f')
        x += dx
        y += dy
    return out


def na_detail(col: int, row: int, sat: float = 0.5) -> Img:
    """A small NA floor detail (tuft, pebbles, bone, flower) from TilesetFloorDetail, graded."""
    t = camp(tiles(na('Backgrounds/Tilesets/TilesetFloorDetail.png'), col, row), sat=sat)
    img, _, _ = t.trim()
    return img


def cat_frames() -> list[Img]:
    """The canteen's cat on the rubbish bin: NA's cat, a grey tabby."""
    sh = na('Actor/Animals/Cat/SpriteSheet.png')
    cols, _ = sh.colors()
    tab = {c: t for c, t in zip(cols[1:], ['#8a8680', '#b3aea4', '#5e5a55', '#d6d0c4'])}
    return [camp(sh.crop(i * 16, 0, 16, 16).remap(tab), sat=0.8) for i in range(2)]


def scraps_pile() -> Img:
    """Scrap by the forge (ground decal): bent bars, a wheel rim, offcuts. 26 × 14."""
    r = rng('scrappile')
    out = Img.new(26, 14)
    out.ellipse_(8, 8, 6, 4, IR[1]); out.ellipse_(8, 8, 3.5, 2, '#00000000')
    a = out.a
    yy, xx = np.mgrid[0:14, 0:26]
    a[((xx + 0.5 - 8) / 3.5) ** 2 + ((yy + 0.5 - 8) / 2.2) ** 2 <= 1] = 0
    out = Img(a)
    out.rect_(4, 5, 5, 1, IR[3])
    for _ in range(7):
        x, y = r.randrange(12, 24), r.randrange(3, 12)
        out.line_(x, y, x + r.randrange(-4, 5), y + r.randrange(-2, 3), r.choice([IR[2], RU[2], IR[3]]))
    return outline(out, INK)


def flowerbed() -> Img:
    """The HQ's flower bed (ground decal): a ring of half-buried tyres painted white and red,
    earth and a few tired asters inside. 34 × 22."""
    w, h = 34, 22
    out = Img.new(w, h)
    out.ellipse_(w / 2, h / 2, w / 2 - 2, h / 2 - 2, G['soil'][2])
    out.ellipse_(w / 2, h / 2 - 1, w / 2 - 4, h / 2 - 4, G['soil'][3])
    for i in range(12):
        a = i / 12 * 2 * math.pi
        x, y = w / 2 + math.cos(a) * (w / 2 - 3), h / 2 + math.sin(a) * (h / 2 - 3)
        c = '#e6e1d0' if i % 2 == 0 else RED[2]
        out.ellipse_(x, y, 2.6, 2.0, INK)
        out.ellipse_(x, y - 0.3, 1.8, 1.3, c)
    r = rng('asters')
    for _ in range(9):
        x, y = r.uniform(9, w - 9), r.uniform(6, h - 7)
        out.px_(int(x), int(y) + 1, '#4f6a3a')
        out.px_(int(x), int(y), r.choice(['#b0708a', '#c9b24a', '#a58ac2', '#d8d0bc']))
    return out


def washstand() -> Img:
    """An outdoor washstand: a long tin trough on legs with a row of hanging push-tap washers.
    38 × 20."""
    w, h = 38, 20
    out = Img.new(w, h)
    t = P['tin']
    out.rect_(2, 12, 2, 8, IR[2]); out.rect_(w - 4, 12, 2, 8, IR[1])
    out.rect_(0, 2, w, 2, IR[2]); out.rect_(0, 2, w, 1, IR[3])
    for i, x in enumerate(range(3, w - 4, 8)):
        out.rect_(x, 4, 5, 6, t[3]); out.rect_(x, 4, 2, 6, t[4]); out.rect_(x + 4, 4, 1, 6, t[1])
        out.rect_(x + 2, 10, 1, 2, IR[3])
    out.rect_(0, 11, w, 3, t[2]); out.rect_(0, 11, w, 1, t[4]); out.rect_(1, 12, w - 2, 1, '#3f5a66')
    return ink(out)


def film_poster() -> Img:
    """The club's film poster on a board: a painted hero against a red sky, «КИНО» on top,
    «СЕГОДНЯ» at the foot. 26 × 38."""
    w, h = 26, 38
    out = Img.new(w, h)
    out.rect_(4, 26, 2, h - 26, WD[2]); out.rect_(w - 6, 26, 2, h - 26, WD[1])
    out.rect_(0, 0, w, 28, WD[1])
    out.rect_(2, 2, w - 4, 24, '#d9c79e')
    out.rect_(3, 8, w - 6, 13, '#a8413a')
    out.rect_(3, 15, w - 6, 6, '#6e2a2a')
    out.ellipse_(w / 2 + 3, 11, 3, 3, '#e8c14e')
    out.rect_(10, 12, 4, 9, '#2a2230'); out.rect_(10, 10, 4, 3, '#c9a27e'); out.rect_(9, 9, 6, 2, '#2a2230')
    t = txt('КИНО', RED[2], None)
    out.paste_(t, (w - t.w) // 2, 3)
    t2 = txt('СЕГОДНЯ', '#2a2230', None)
    out.paste_(t2, (w - t2.w) // 2, 21)
    return ink(out)


def pebbles(seed: int = 1, tone: str = 'gravel') -> Img:
    """A few grey pebbles (ground decal), 9 × 6: lit tops, a dark underside, NA-chunky."""
    r = rng('pebbles', seed, tone)
    g = G[tone]
    out = Img.new(10, 7)
    for _ in range(r.randrange(2, 4)):
        x, y = r.randrange(0, 7), r.randrange(1, 5)
        w = r.choice([2, 3])
        out.rect_(x, y, w, 2, g[2])
        out.rect_(x, y, w - 1, 1, g[4])
        out.rect_(x, y + 2, w, 1, g[0])
    return out


def sigil(r_px: int = 26, seed: int = 1) -> Img:
    """A rune circle burned into the moss before the enchanter's door (ground decal): two violet
    rings with runes between them, faint — it glows at night with the stones."""
    S = r_px * 2 + 4
    out = Img.new(S, int(S * 0.6))
    cx, cy = S / 2, out.h / 2
    k = 0.58
    for rr, a in ((r_px, 0.85), (r_px - 7, 0.6)):
        for i in range(720):
            t = math.radians(i / 2)
            out.px_(int(cx + math.cos(t) * rr), int(cy + math.sin(t) * rr * k), P['violet'][3], a)
    names = list(RUNES)
    for i in range(8):
        t = math.radians(i * 45 + 22)
        x, y = cx + math.cos(t) * (r_px - 3.5), cy + math.sin(t) * (r_px - 3.5) * k
        strokes = RUNES[names[i % len(names)]]
        for x0, y0, x1, y1 in strokes:
            out.line_(int(x - 1 + x0 * 0.5), int(y - 2 + y0 * 0.5), int(x - 1 + x1 * 0.5), int(y - 2 + y1 * 0.5),
                      P['violet'][4], 0.8)
    return out


def smoking_shelter() -> Img:
    """The yard's smoking shelter (курилка): a lean-to of corrugated tin on four posts, a bench
    under it, a tin can of butts. 52 × 40."""
    w, h = 52, 40
    out = Img.new(w, h)
    t = P['tin']
    # posts
    for x in (3, w - 6):
        out.rect_(x, 12, 3, h - 12, WD[2]); out.rect_(x, 12, 1, h - 12, WD[3])
    # bench under the roof
    b = bench()
    out.paste_(b, (w - b.w) // 2, h - b.h)
    # roof: corrugated tin sloping to the front, seen from above
    roof = Img.new(w, 15)
    for x in range(w):
        roof.rect_(x, 0, 1, 15, t[[3, 2, 1, 2][x % 4]])
    roof.rect_(0, 13, w, 2, t[0])
    roof.rect_(0, 0, w, 1, t[4])
    for x in (7, 20, 33, 44):
        roof.rect_(x, 2, 3, 3, RU[2], 0.7)
    out.paste_(ink(roof), 0, 0)
    out.rect_(3, 15, w - 6, 2, '#000000', 0.35)
    can = Img.new(5, 6, t[3]); can.rect_(0, 0, 5, 1, t[4]); can.rect_(1, 1, 3, 1, '#2a2622')
    out.paste_(ink(can), w - 12, h - 6)
    return out


def firewood(w: int = 40) -> Img:
    """A woodpile (поленница) of split logs, end grain to the viewer, under a strip of roofing
    felt. w × 22."""
    r = rng('firewood', w)
    h = 22
    out = Img.new(w, h)
    for row in range(4):
        y = h - 5 - row * 4
        x = (row % 2) * 2
        while x < w - 3:
            d = r.choice([4, 4, 5])
            out.ellipse_(x + d / 2, y + 2, d / 2, 2.2, WD[1])
            out.ellipse_(x + d / 2 - 0.3, y + 1.7, d / 2 - 1, 1.3, r.choice(['#c9a978', '#b8956a', '#d6bb8c']))
            out.px_(int(x + d / 2), y + 2, WD[2])
            x += d
    out.rect_(0, 0, w, 4, '#3a3632'); out.rect_(0, 0, w, 1, '#56514b')
    return ink(out)


def buffer_stop() -> Img:
    """The end of the track: a timber buffer on two iron legs, a red stripe. 14 × 12."""
    out = Img.new(14, 12)
    out.rect_(1, 3, 12, 5, WD[2]); out.rect_(1, 3, 12, 1, WD[4]); out.rect_(1, 5, 12, 1, RED[2])
    out.rect_(2, 8, 2, 4, IR[2]); out.rect_(10, 8, 2, 4, IR[1])
    return ink(out)


def tyre_tracks(length: int, vertical: bool = False, seed: int = 1) -> Img:
    """Two ruts of tyre tread across earth (ground decal): dashed darker lines, 20 px apart."""
    r = rng('tracks', length, seed)
    out = Img.new(length, 24) if not vertical else Img.new(24, length)
    for off in (2, 20):
        for i in range(0, length, 3):
            if r.random() < 0.8:
                if not vertical:
                    out.rect_(i, off, 2, 2, '#3a3029', 0.55)
                else:
                    out.rect_(off, i, 2, 2, '#3a3029', 0.55)
    return out


def banner_small(lines: list[str], bg: str = '#a7343a', fg: str = '#e6e1d0', legs: int = 10) -> Img:
    """A small painted slogan board on two legs (sports ground, garden)."""
    ts = [txt(s, fg, None) for s in lines]
    w = max(t.w for t in ts) + 8
    bh = sum(t.h + 2 for t in ts) + 4
    out = Img.new(w, bh + legs)
    out.rect_(3, bh - 1, 2, legs + 1, WD[2]); out.rect_(w - 5, bh - 1, 2, legs + 1, WD[1])
    board = Img.new(w, bh, bg)
    board.rect_(0, 0, w, 1, ramp(bg, 4, 0.4)[3])
    y = 3
    for t in ts:
        board.paste_(t, (w - t.w) // 2, y)
        y += t.h + 2
    out.paste_(ink(board), 0, 0)
    return out


def pond(w: int = 44, h: int = 20, seed: int = 1) -> Img:
    """A still pool in the moss (ground decal): dark water, a stone lip, lily pads, a glint."""
    r = rng('pond', w, h, seed)
    out = Img.new(w, h)
    out.ellipse_(w / 2, h / 2, w / 2, h / 2, '#3a3740')
    out.ellipse_(w / 2, h / 2 + 0.5, w / 2 - 2, h / 2 - 2, '#243338')
    out.ellipse_(w / 2 - 1, h / 2 + 1, w / 2 - 5, h / 2 - 4, '#2c4046')
    out.rect_(int(w * 0.25), int(h * 0.4), int(w * 0.3), 1, '#6d8f98')
    for _ in range(3):
        x, y = r.uniform(w * 0.3, w * 0.75), r.uniform(h * 0.4, h * 0.7)
        out.ellipse_(x, y, 2.4, 1.5, '#4f6a3a'); out.px_(int(x), int(y) - 1, '#6f8a4e')
    for i in range(10):
        t = i / 10 * 2 * math.pi
        out.ellipse_(w / 2 + math.cos(t) * (w / 2 - 1.5), h / 2 + math.sin(t) * (h / 2 - 1.2), 2, 1.2, '#7b7584')
    return out


def power_pole() -> tuple[Img, list[tuple[int, int]]]:
    """A wooden power pole with a crossarm and three glass insulators. Returns the picture
    (12 × 52) and the insulator points the wires hang from."""
    w, h = 14, 52
    out = Img.new(w, h)
    out.rect_(6, 4, 3, h - 4, WD[1]); out.rect_(6, 4, 1, h - 4, WD[2])
    out.rect_(5, h - 3, 5, 3, WD[0])
    out.rect_(0, 7, w, 2, WD[1]); out.rect_(0, 7, w, 1, WD[2])
    out.line_(7, 14, 2, 9, WD[1])
    out = ink(out)
    pts = []
    for x in (1, 7, 12):
        out.rect_(x - 1, 4, 2, 3, '#9fc0c4'); out.px_(x - 1, 4, '#e2f1f2')
        pts.append((x, 5))
    return out, pts


def wires(span: int, drop: int, sag: float = 4.0) -> Img:
    """Three sagging wires between two poles span px apart (the right pole drop px lower), for the
    top layer. Drawn relative to the left pole's insulator row."""
    h = int(abs(drop) + sag + 6)
    out = Img.new(span + 1, h)
    y0 = 0 if drop >= 0 else -drop
    for k, (dx, dy) in enumerate(((0, 0), (6, 0), (11, 0))):
        for x in range(span + 1):
            t = x / span
            y = y0 + dy + drop * t + sag * math.sin(math.pi * t) * (1 + 0.15 * k)
            out.px_(x, int(round(y)), '#1c1f22', 0.9)
    return out


def signpost(boards: list[tuple[str, str]]) -> Img:
    """A wooden finger-post at a crossing: stacked boards with arrow tips (left/right) or an arrow
    painted up — «ШАХТА», «ЛИФТ», «ПИТОМНИК»… Boards cream with dark stencil letters."""
    ts = [(txt(s, '#2a2220', None), d) for s, d in boards]
    bw = max(t.w for t, _ in ts) + 12
    w = bw + 6
    bh = 9
    h = len(ts) * (bh + 1) + 22
    out = Img.new(w, h)
    cx = w // 2
    out.rect_(cx - 1, 2, 3, h - 2, WD[1]); out.rect_(cx - 1, 2, 1, h - 2, WD[2])
    for i, (t, d) in enumerate(ts):
        y = 2 + i * (bh + 1)
        b = Img.new(w, bh)
        if d == 'left':
            b.poly_([(0, bh / 2), (5, 0), (w - 3, 0), (w - 3, bh), (5, bh)], '#cdbb92')
            tx = 6 + (bw - 6 - t.w) // 2
        elif d == 'right':
            b.poly_([(3, 0), (w - 5, 0), (w, bh / 2), (w - 5, bh), (3, bh)], '#cdbb92')
            tx = 4 + (bw - 6 - t.w) // 2
        else:
            b.rect_(3, 0, w - 6, bh, '#cdbb92')
            for k, (ax, ay) in enumerate(((0, 2), (-1, 3), (1, 3), (0, 3), (0, 4), (0, 5), (0, 6))):
                b.px_(7 + ax, ay, RED[2])
            tx = 10 + (bw - 12 - t.w) // 2
        b.rect_(3, 0, w - 6, 1, '#e3d5b0')
        b.paste_(t, tx, 2)
        out.paste_(ink(b), 0, y)
    return out


def road_patch(w: int, h: int, seed: int = 1) -> Img:
    """A patched hole in asphalt (ground decal): a darker, fresher rectangle with a raised seam."""
    out = Img.new(w, h)
    out.rect_(0, 0, w, h, G['asphalt'][1])
    out.rect_(0, 0, w, 1, G['asphalt'][3])
    out.rect_(0, 0, 1, h, G['asphalt'][3])
    out.rect_(0, h - 1, w, 1, G['asphalt'][0])
    r = rng('patch', w, h, seed)
    for _ in range(w * h // 30):
        out.px_(r.randrange(1, w - 1), r.randrange(1, h - 1), G['asphalt'][2])
    return out


def tally(n: int = 17) -> Img:
    """Days scratched on the wall in fives (ground decal for the wall face)."""
    out = Img.new(n // 5 * 7 + 6, 7)
    x = 0
    for i in range(n):
        if i % 5 == 4:
            out.line_(x - 5, 5, x, 1, '#4f514d')
            x += 3
        else:
            out.rect_(x, 1, 1, 5, '#4f514d')
            x += 1 if i % 5 != 3 else 1
            x += 1
    return out


# (end of module)
