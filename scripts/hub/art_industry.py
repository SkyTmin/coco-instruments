"""Industrial art shared by the three shaft buildings of the square (v2.80):
Шахта (`maps/mine.py`), Особая шахта (`maps/zone.py`) and Лифт в подземелье (`maps/lift.py`).

Same hand as `kit.py` (ink contour, 3–5 shades from `kit.P`, light from the upper left, flat
fills), plus what the three rooms have and the forge does not: rails, ore carts, hazard paint,
cages and grilles, chains and padlocks, crystals, industrial lamps, stencilled signs, and a Latin
3×5 font for the floor letters A–Z (the kit font is Cyrillic only: `kit.text('D')` is blank).

Things that could move to `kit.py` if another room needs them: `txt` + `LATIN` (any Latin sign),
`hazard` (yellow-black paint), `rails_v` (a track on the ground), `cart`, `lamp_enamel` (a cold
industrial lamp), `lantern` (a warm kerosene one), `chain_line`, `padlock`, `crystal`, `plate`
(a stencilled sign), `footprints`, `puddle`, `stain`.
"""
from __future__ import annotations

import math

import numpy as np

from kit import FONT, INK, P, ink
from lib import Img, grid, hexrgb, outline, ramp, rng

# ------------------------------------------------------------------------------------ colours
HAZ_Y = '#dcae3a'      # safety yellow, a touch dusty (it is paint, so it may stay saturated)
HAZ_Y2 = '#f0cf62'     # its lit edge
HAZ_K = '#1f1c1d'      # the black stripe
PAINT_GREEN = ['#233029', '#34473b', '#4b6453', '#648170', '#86a08e']   # Soviet oil paint
PAINT_BLUE = ['#222b35', '#33414f', '#4a5c6d', '#66798a', '#8a9cab']    # lockers, desk
ENAMEL = ['#2f3f37', '#44594c', '#5f7a66', '#dfe3d4', '#f7f8ee']          # lamp shades
COLD = '#cfe0ff'       # cold lamp light
WARM = '#ffd08a'       # warm lamp light

# ------------------------------------------------------------------------------ latin 3×5 font
# Floors are Latin letters A–Z in the game, and `kit.FONT` has only the Cyrillic look-alikes.
# Each glyph is readable on its own, but some (M/N/W) only really read in the A–Z sequence —
# that is where they are used.
LATIN = {
    'A': ['.#.', '#.#', '###', '#.#', '#.#'], 'B': ['##.', '#.#', '##.', '#.#', '##.'],
    'C': ['.##', '#..', '#..', '#..', '.##'], 'D': ['##.', '#.#', '#.#', '#.#', '##.'],
    'E': ['###', '#..', '##.', '#..', '###'], 'F': ['###', '#..', '##.', '#..', '#..'],
    'G': ['.##', '#..', '#.#', '#.#', '.##'], 'H': ['#.#', '#.#', '###', '#.#', '#.#'],
    'I': ['###', '.#.', '.#.', '.#.', '###'], 'J': ['..#', '..#', '..#', '#.#', '.#.'],
    'K': ['#.#', '#.#', '##.', '#.#', '#.#'], 'L': ['#..', '#..', '#..', '#..', '###'],
    'M': ['#.#', '###', '###', '#.#', '#.#'], 'N': ['##.', '#.#', '#.#', '#.#', '#.#'],
    'O': ['.#.', '#.#', '#.#', '#.#', '.#.'], 'P': ['##.', '#.#', '##.', '#..', '#..'],
    'Q': ['.#.', '#.#', '#.#', '##.', '.##'], 'R': ['##.', '#.#', '##.', '#.#', '#.#'],
    'S': ['.##', '#..', '.#.', '..#', '##.'], 'T': ['###', '.#.', '.#.', '.#.', '.#.'],
    'U': ['#.#', '#.#', '#.#', '#.#', '###'], 'V': ['#.#', '#.#', '#.#', '#.#', '.#.'],
    'W': ['#.#', '#.#', '###', '###', '#.#'], 'X': ['#.#', '#.#', '.#.', '#.#', '#.#'],
    'Y': ['#.#', '#.#', '.#.', '.#.', '.#.'], 'Z': ['###', '..#', '.#.', '#..', '###'],
    ',': ['...', '...', '...', '.#.', '#..'], '×': ['...', '#.#', '.#.', '#.#', '...'],
}


# Cyrillic letters the kit font draws ambiguously at 3 px: Д read as А («ЗАРЯАКА»), И as Н,
# Ж as Х, Ш/Щ/Ю as solid blocks. Wider glyphs here; everything else comes from kit.FONT.
CYR_FIX = {
    'Д': ['.###', '.#.#', '.#.#', '####', '#..#'],
    'И': ['#..#', '#..#', '#.##', '##.#', '#..#'],
    'Й': ['#..#', '#..#', '#.##', '##.#', '#..#'],
    'Ж': ['#.#.#', '#.#.#', '.###.', '#.#.#', '#.#.#'],
    'Ш': ['#.#.#', '#.#.#', '#.#.#', '#.#.#', '#####'],
    'Щ': ['#.#.#', '#.#.#', '#.#.#', '#####', '....#'],
    'Ю': ['#.##.', '#.#.#', '###.#', '#.#.#', '#.##.'],
    'Ы': ['#..#', '#..#', '##.#', '#.##', '##.#'],
    'М': ['#...#', '##.##', '#.#.#', '#...#', '#...#'],
}


def glyph(ch: str) -> list[str]:
    if ch in LATIN:
        return LATIN[ch]
    if ch.upper() in CYR_FIX:
        return CYR_FIX[ch.upper()]
    return FONT.get(ch.upper(), FONT[' '])


def txt(s: str, color: str, shadow: str | None = None, gap: int = 1) -> Img:
    """A line of 3×5 capitals: Latin letters from LATIN, Cyrillic and digits from kit.FONT."""
    gl = [glyph(ch) for ch in s]
    w = sum(len(g[0]) + gap for g in gl) - gap
    out = Img.new(max(1, w + (1 if shadow else 0)), 5 + (1 if shadow else 0))
    x = 0
    for g in gl:
        for yy, row in enumerate(g):
            for xx, v in enumerate(row):
                if v == '#':
                    if shadow:
                        out.px_(x + xx + 1, yy + 1, shadow)
                    out.px_(x + xx, yy, color)
        x += len(g[0]) + gap
    return out


# ------------------------------------------------------------------------------ paint & plates
def hazard(w: int, h: int, step: int = 3, phase: int = 0, a: str = HAZ_Y, b: str = HAZ_K) -> Img:
    """Yellow-black diagonal stripes (the shaft's edge, posts, barriers)."""
    yy, xx = np.mgrid[0:h, 0:w]
    sel = ((xx + yy + phase) // step) % 2 == 0
    out = Img.new(w, h)
    ca, cb = np.array(hexrgb(a), np.uint8), np.array(hexrgb(b), np.uint8)
    out.a[sel] = ca
    out.a[~sel] = cb
    return out


def plate(lines: list[str], fg: str, bg: str, pad: int = 2, border: str | None = None,
          screws: bool = True) -> Img:
    """A painted metal sign: lines of text centred, lit top edge, ink contour, screw dots."""
    ims = [txt(s, fg) for s in lines]
    w = max(i.w for i in ims) + pad * 2 + 2
    h = sum(i.h for i in ims) + (len(ims) - 1) + pad * 2 + 2
    out = Img.new(w, h)
    r = ramp(bg, 4, 0.34)
    out.rect_(0, 0, w, h, bg)
    out.rect_(1, 1, w - 2, 1, r[3])
    out.rect_(1, h - 2, w - 2, 1, r[1])
    if border:
        out.rect_(1, 1, w - 2, h - 2, border)
        out.rect_(2, 2, w - 4, h - 4, bg)
    y = pad + 1
    for im in ims:
        out.paste_(im, (w - im.w) // 2, y)
        y += im.h + 1
    out = ink(out)
    if screws and w >= 12:
        for sx in (2, w - 3):
            out.px_(sx, 2, r[0])
    return out


def paper_sheet(w: int, h: int, seed: int = 1, lines: bool = True, pin: str = '#a8323b') -> Img:
    r = rng('sheet', w, h, seed)
    out = Img.new(w, h)
    out.rect_(0, 0, w, h, P['paper'][2])
    out.rect_(0, 0, w, 1, P['paper'][3])
    out.rect_(w - 1, 1, 1, h - 1, P['paper'][1])
    if lines:
        for y in range(2, h - 1, 2):
            out.rect_(1, y, r.randrange(max(2, w // 3), w - 1), 1, P['paper'][0])
    out = ink(out)
    out.px_(w // 2, 0, pin)
    return out


# ------------------------------------------------------------------------------ ground decals
CONCRETE = ['#474945', '#555753', '#62645f', '#6e706a', '#7d7f78']


def concrete_floor(g: Img, x0: int, y0: int, x1: int, y1: int, seed: int = 1,
                   tone: list[str] | None = None, slab: int = 48) -> None:
    """Poured concrete, calmer than kit's: one base tone with soft wide patches, sparse grit, and
    expansion joints every `slab` px (a dark line with a lit lip below it)."""
    from lib import noise2
    c = tone or CONCRETE
    w, h = x1 - x0, y1 - y0
    yy, xx = np.mgrid[0:h, 0:w]
    n = np.vectorize(lambda a, b: noise2(a / 23.0, b / 17.0, seed))(xx + x0, yy + y0)
    f = np.vectorize(lambda a, b: noise2(a / 5.0, b / 5.0, seed + 11))(xx + x0, yy + y0)
    idx = np.where(n < 0.32, 1, np.where(n > 0.7, 3, 2))
    idx = np.where((f > 0.82) & (idx < 3), idx + 1, idx)
    idx = np.where((f < 0.12) & (idx > 0), idx - 1, idx)
    pal = np.array([hexrgb(v) for v in c], np.uint8)
    g.a[y0:y1, x0:x1] = pal[idx]
    r = rng('concrete', x0, y0, seed)
    for _ in range(w * h // 60):
        g.px_(x0 + r.randrange(w), y0 + r.randrange(h), c[r.choice([0, 0, 4])])
    for x in range(x0 + slab - (x0 % slab), x1, slab):
        g.rect_(x, y0, 1, h, c[0]); g.rect_(x + 1, y0, 1, h, c[4], 0.6)
    for y in range(y0 + slab - (y0 % slab), y1, slab):
        g.rect_(x0, y, w, 1, c[0]); g.rect_(x0, y + 1, w, 1, c[4], 0.6)
    for _ in range(max(1, w * h // 9000)):                                  # a hairline crack
        x, y = x0 + r.randrange(w), y0 + r.randrange(h)
        for k in range(r.randrange(5, 12)):
            g.px_(x, y, c[0])
            x += r.choice([1, 1, 0, -1]); y += r.choice([1, 0])


def refloor(m, painter, face: int = 2) -> None:
    """Repaint the floor of a room `kit.shell` already built (for floors the kit has no tile for),
    then put back what shell() had drawn on it: the wall's contact shadow, the occlusion along the
    side caps and the door mat. painter(g, x0, y0, x1, y1) paints the floor rectangle in px."""
    from lib import T
    g = m.ground
    w, h = m.w, m.h
    x0, y0, x1, y1 = T, (1 + face) * T, (w - 1) * T, (h - 1) * T
    painter(g, x0, y0, x1, y1)
    g.rect_(x0, y0, x1 - x0, 3, '#000000', 0.28)
    g.rect_(x0, y0 + 3, x1 - x0, 2, '#000000', 0.12)
    g.rect_(T, y0, 3, y1 - y0, '#000000', 0.22)
    g.rect_(x1 - 3, y0, 3, y1 - y0, '#000000', 0.22)
    ex = [d for d in m.doors if d.kind == 'exit']
    if ex:
        dx, dw = int(ex[0].x), int(ex[0].w)
        mat = Img.new(dw * T - 6, 10)
        mat.rect_(0, 0, mat.w, mat.h, '#5c3a2c')
        for y in range(1, mat.h - 1, 2):
            mat.rect_(1, y, mat.w - 2, 1, '#7a4f38')
        g.paste_(outline(mat, INK), dx * T + 2, (h - 2) * T + 4)


def rails_v(g: Img, cx: int, y0: int, y1: int, gauge: int = 12, tie_step: int = 6,
            wood: list[str] | None = None, rust: float = 0.0, seed: int = 1) -> None:
    """A north-south track painted on the ground: sleepers across, two steel rails with a lit top
    and a shadow on the east side. cx is the track centre in px."""
    wd = wood or P['wood']
    ir = P['iron']
    r = rng('rails', cx, y0, seed)
    hw = gauge // 2 + 4
    for y in range(y0 + 1, y1 - 1, tie_step):
        g.rect_(cx - hw, y + 3, hw * 2, 1, '#000000', 0.3)            # shadow under the sleeper
        g.rect_(cx - hw, y, hw * 2, 3, wd[1])
        g.rect_(cx - hw, y, hw * 2, 1, wd[2])
        g.px_(cx - hw + r.randrange(1, 4), y + 1, wd[0])
        g.px_(cx - hw, y, INK); g.px_(cx + hw - 1, y + 2, INK)
    for rx in (cx - gauge // 2 - 1, cx + gauge // 2 - 1):
        g.rect_(rx + 2, y0, 1, y1 - y0, '#000000', 0.35)                 # rail shadow
        g.rect_(rx, y0, 1, y1 - y0, ir[4])
        g.rect_(rx + 1, y0, 1, y1 - y0, ir[2])
        if rust:
            for y in range(y0, y1):
                if r.random() < rust:
                    g.px_(rx + 1, y, P['rust'][2])


def footprints(g: Img, pts: list[tuple[float, float]], color: str = '#2a2119', alpha: float = 0.32,
               step: int = 7, seed: int = 1) -> None:
    """Muddy boot prints along a polyline of px points (left, right, left…)."""
    r = rng('steps', seed)
    k = 0
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        L = max(1.0, math.hypot(x1 - x0, y1 - y0))
        n = int(L // step)
        nx, ny = -(y1 - y0) / L, (x1 - x0) / L
        for i in range(n):
            t = i / max(1, n)
            side = 1 if k % 2 else -1
            x = x0 + (x1 - x0) * t + nx * 2 * side
            y = y0 + (y1 - y0) * t + ny * 2 * side
            g.rect_(int(x), int(y), 2, 3, color, alpha * r.uniform(0.7, 1.0))
            g.px_(int(x), int(y) + 4, color, alpha * 0.8)
            k += 1


def puddle(g: Img, cx: int, cy: int, rx: float, ry: float, seed: int = 1) -> None:
    g.ellipse_(cx, cy, rx + 1, ry + 0.6, '#11161a', 0.25)
    g.ellipse_(cx, cy, rx, ry, '#2b3d45', 0.75)
    g.ellipse_(cx - 1, cy - 0.5, rx * 0.6, ry * 0.5, '#3e5963', 0.7)
    g.rect_(int(cx - rx * 0.5), int(cy - ry * 0.4), max(2, int(rx * 0.5)), 1, '#8fb3bd', 0.8)


def stain(g: Img, cx: int, cy: int, rx: float, ry: float, color: str = '#141214', alpha: float = 0.3,
          seed: int = 1) -> None:
    """An irregular stain (oil, soot, dust) built of a few blobs."""
    r = rng('stain', cx, cy, seed)
    for _ in range(5):
        g.ellipse_(cx + r.uniform(-rx * 0.4, rx * 0.4), cy + r.uniform(-ry * 0.4, ry * 0.4),
                   rx * r.uniform(0.4, 0.8), ry * r.uniform(0.4, 0.8), color, alpha * 0.5)


def grit(g: Img, x0: int, y0: int, x1: int, y1: int, colors: list[str], n: int, seed: int = 1,
         cluster: tuple[float, float, float, float] | None = None) -> None:
    """Scatter single-pixel grit (ore crumbs, coal, sawdust). cluster=(cx, cy, sx, sy) gaussian."""
    r = rng('grit', x0, y0, seed)
    for _ in range(n):
        if cluster:
            x, y = int(r.gauss(cluster[0], cluster[2])), int(r.gauss(cluster[1], cluster[3]))
        else:
            x, y = r.randrange(x0, x1), r.randrange(y0, y1)
        if x0 <= x < x1 and y0 <= y < y1:
            c = r.choice(colors)
            g.px_(x, y, c)
            if r.random() < 0.3:
                g.px_(x + 1, y, c)


def pebble(tone: list[str], seed: int = 1, size: int = 4) -> Img:
    """A single lump of rock for the floor (flat, sits on the ground)."""
    r = rng('pebble', seed, size)
    w = size + 2
    out = Img.new(w, size + 1)
    out.ellipse_(w / 2, size / 2 + 0.5, w / 2 - 0.5, size / 2, tone[1])
    out.ellipse_(w / 2 - 0.6, size / 2, w / 2 - 1.5, size / 2 - 1, tone[2])
    out.px_(1 + r.randrange(0, 2), 1, tone[3])
    return outline(out, INK)


# --------------------------------------------------------------------------------- carts & ore
ORE = {
    # name: (rock ramp, speck colours)
    'iron': (['#3a2e2e', '#5a4440', '#7d5f55', '#9c7b6b'], ['#b56a4a', '#d99a6a']),
    'coal': (P['coal'], ['#7a8aa6']),
    'copper': (['#33363a', '#4f5458', '#6d7478', '#8c9498'], ['#5fb08a', '#8fe0b0']),
    'gold': (['#3d3730', '#5b5247', '#7c7163', '#9d917f'], ['#e8c14e', '#fbe594']),
    'grey': (['#3b3643', '#56505a', '#7a7278', '#9d958f'], ['#c2b9ad']),
}


def ore_heap(w: int, h: int, kind: str = 'iron', seed: int = 1) -> Img:
    """A mound of lumps that fits w × h (no contour: callers ink it with the thing it sits in)."""
    rock, specks = ORE[kind]
    r = rng('heap', w, h, kind, seed)
    out = Img.new(w, h)
    lumps = []
    for _ in range(w * h // 5):
        x = r.uniform(1.5, w - 1.5)
        top = h * (0.25 + 0.75 * ((x - w / 2) / (w / 2)) ** 2)     # a dome: high in the middle
        y = r.uniform(top, h - 1)
        lumps.append((x, y, r.uniform(1.3, 2.4)))
    lumps.sort(key=lambda l: l[1])
    for x, y, rr in lumps:
        out.ellipse_(x, y, rr, rr * 0.85, rock[1])
        out.ellipse_(x - 0.4, y - 0.5, rr - 0.7, rr * 0.85 - 0.7, rock[2])
        if r.random() < 0.45:
            out.px_(int(x - rr * 0.4), int(y - rr * 0.5), rock[3])
        if r.random() < 0.28:
            out.px_(int(x), int(y), r.choice(specks))
    return out


def cart(body: str = 'rust', load: str | None = 'iron', seed: int = 1, tilt: bool = False) -> Img:
    """A mine tub (вагонетка) seen from the front-top: a rim you look into, a tapering riveted
    body, a coupling hook, two wheels showing at the bottom corners. 20 × 19 (load on top)."""
    w, h = 20, 19
    out = Img.new(w, h)
    c = P[body]
    ir = P['iron']
    y0 = 4                                                     # rim row
    if load:
        heap = ore_heap(16, 7, load, seed)
        out.paste_(heap, 2, 0)
    else:
        out.rect_(2, y0 + 1, 16, 2, '#161214')                # empty: you see the dark inside
    # body: trapezoid, lit left third, shaded right third
    out.poly_([(1, y0 + 2), (19, y0 + 2), (17, 15), (3, 15)], c[2])
    out.poly_([(1, y0 + 2), (6, y0 + 2), (6, 15), (3, 15)], c[3])
    out.poly_([(14, y0 + 2), (19, y0 + 2), (17, 15), (14, 15)], c[1])
    # rim: the thick top edge seen from above
    out.rect_(0, y0, w, 2, c[3])
    out.rect_(0, y0, w, 1, c[4])
    if load:
        out.paste_(heap.crop(0, 5, 16, 2), 2, y0 - 1)          # lumps spill over the rim a bit
    # vertical ribs with rivets, a band
    for x in (5, 10, 14):
        out.rect_(x, y0 + 3, 1, 9, c[1])
        out.px_(x, y0 + 3, c[4])
    out.rect_(2, 11, 16, 1, ir[1])
    out.rect_(2, 12, 16, 1, c[1])
    # chassis, coupling hook, wheels
    out.rect_(3, 15, 14, 2, ir[1])
    out.rect_(3, 15, 14, 1, ir[2])
    out.rect_(9, 16, 2, 2, ir[2])
    for wx in (4.5, 15.5):
        out.ellipse_(wx, 16.5, 2.6, 2.6, ir[0])
        out.ellipse_(wx - 0.3, 16.2, 1.4, 1.4, ir[2])
        out.px_(int(wx), 16, ir[4])
    return ink(out)


def buffer_stop() -> Img:
    """The end of the track: two timber posts, a cross beam painted in hazard stripes, a bumper
    block. 22 × 16."""
    out = Img.new(22, 16)
    wd = P['wood']
    out.rect_(3, 1, 4, 14, wd[2]); out.rect_(3, 1, 1, 14, wd[3])
    out.rect_(15, 1, 4, 14, wd[1]); out.rect_(15, 1, 1, 14, wd[2])
    out.rect_(0, 3, 22, 6, wd[2])
    out.paste_(hazard(22, 4, 3), 0, 4)
    out.rect_(0, 3, 22, 1, HAZ_Y2)
    out.rect_(0, 8, 22, 1, wd[0])
    out.rect_(8, 9, 6, 5, P['iron'][2]); out.rect_(8, 9, 6, 1, P['iron'][4])     # bumper
    return ink(out)


# ------------------------------------------------------------------------------------- lamps
def lamp_enamel(cord: int = 18, frame: int = 0) -> Img:
    """A Soviet industrial lamp on a cord: green enamel cone (white inside), a caged bulb.
    For the 'top' layer. 13 × (cord + 11)."""
    w = 13
    out = Img.new(w, cord + 11)
    e = ENAMEL
    out.rect_(6, 0, 1, cord + 1, '#262224')
    y = cord
    out.poly_([(4, y), (9, y), (13, y + 5), (0, y + 5)], e[1])
    out.poly_([(4, y), (6, y), (3, y + 5), (0, y + 5)], e[2])
    out.rect_(4, y, 5, 1, e[2])
    out.rect_(0, y + 4, 13, 1, e[3])                               # white enamel rim
    out = ink(out.crop(0, 0, w, y + 6)).crop(0, 0, w, cord + 11)
    out.rect_(6, 0, 1, cord, '#262224')
    # the bulb in its wire guard
    bulb = '#f4f7ff' if frame % 2 == 0 else '#e6eeff'
    out.rect_(4, y + 6, 5, 3, bulb)
    out.rect_(5, y + 9, 3, 1, bulb)
    out.rect_(4, y + 6, 1, 3, '#3a3a40'); out.rect_(8, y + 6, 1, 3, '#3a3a40')
    out.rect_(6, y + 6, 1, 4, '#5a5a62')
    out.px_(5, y + 7, '#ffffff')
    return out


def lantern(frame: int = 0, hang: bool = True) -> Img:
    """A kerosene lantern (летучая мышь): wire handle, glass with a flame, tin top and base.
    9 × 15; the flame breathes by frame."""
    out = Img.new(9, 15)
    t = P['rust'] if not hang else P['iron']
    out.ellipse_(4.5, 2.5, 3.5, 2.5, '#00000000')
    out.line_(1, 4, 2, 1, t[1]); out.line_(7, 4, 6, 1, t[1]); out.rect_(3, 0, 3, 1, t[1])   # handle
    out.rect_(1, 4, 7, 2, t[3]); out.rect_(1, 4, 7, 1, t[4])                                   # top
    out.rect_(1, 6, 7, 5, '#d8b766')                                                           # glass
    fl = [('#ffe7a3', '#ff9a3c', 3), ('#fff1c4', '#ffb04a', 4), ('#ffe7a3', '#ff9a3c', 3), ('#fff8dc', '#ffc766', 4)][frame % 4]
    out.rect_(3, 6, 3, 5, '#f0c86a')
    out.rect_(4, 10 - fl[2], 1, fl[2], fl[1]); out.px_(4, 9, fl[0])
    out.rect_(1, 6, 1, 5, t[1]); out.rect_(7, 6, 1, 5, t[1])                                   # wires
    out.rect_(0, 11, 9, 3, t[2]); out.rect_(0, 11, 9, 1, t[3])                                 # base
    return ink(out)


def bulb_wall(on: bool = True) -> Img:
    """A caged wall lamp on a bracket (for wall faces). 9 × 10."""
    out = Img.new(9, 10)
    out.rect_(3, 0, 3, 2, P['iron'][2])
    out.rect_(1, 2, 7, 7, '#fff4cf' if on else '#8a8a80')
    out.rect_(1, 2, 7, 1, P['iron'][3])
    for x in (1, 4, 7):
        out.rect_(x, 3, 1, 6, P['iron'][1])
    out.rect_(1, 6, 7, 1, P['iron'][1])
    out.rect_(2, 8, 5, 2, P['iron'][2])
    return ink(out)


# ------------------------------------------------------------------------------ chains & locks
def chain_line(x0: int, y0: int, x1: int, y1: int, img: Img, sag: float = 0.0, big: bool = True) -> None:
    """Draw a heavy chain between two points onto img: alternating flat and edge-on links along
    a (slightly sagging) line, each link with a lit upper edge and an ink rim."""
    ir = P['iron']
    L = max(1.0, math.hypot(x1 - x0, y1 - y0))
    step = 3 if big else 2
    n = int(L // step)
    for i in range(n + 1):
        t = i / max(1, n)
        x = x0 + (x1 - x0) * t
        y = y0 + (y1 - y0) * t + sag * 4 * t * (1 - t)
        xi, yi = int(round(x)), int(round(y))
        if i % 2 == 0:
            if big:
                img.rect_(xi - 1, yi - 1, 3, 3, INK)
                img.rect_(xi - 1, yi - 1, 2, 1, ir[4])
                img.px_(xi + 1, yi, ir[2]); img.px_(xi, yi + 1, ir[2]); img.px_(xi - 1, yi, ir[3])
                img.px_(xi, yi, INK)
            else:
                img.rect_(xi - 1, yi - 1, 2, 2, ir[3]); img.px_(xi, yi, ir[1])
        else:
            img.rect_(xi - 1, yi, 3, 1, ir[3] if big else ir[2])
            img.px_(xi - 1, yi - 1, INK) if big else None


def padlock(big: bool = True, color: str = 'iron') -> Img:
    """A padlock: shackle arc, body with a keyhole. Big 9 × 11, small 6 × 8."""
    c = P[color]
    if big:
        g = [
            '..kkkkk..',
            '.k43334k.',
            'k4k...k3k',
            'k3k...k2k',
            'kkkkkkkkk',
            'k5444443k',
            'k4433333k',
            'k433kk32k',
            'k433kk32k',
            'k33332221',
            'kkkkkkkkk',
        ]
    else:
        g = [
            '.kkkk.',
            'k4..3k',
            'k3..2k',
            'kkkkkk',
            'k44k3k',
            'k43k2k',
            'k3332k',
            'kkkkkk',
        ]
    pal = {'k': INK, '1': c[0], '2': c[1], '3': c[2], '4': c[3], '5': c[4]}
    return grid(g, pal)


# ------------------------------------------------------------------------------------ crystals
GEMS = {
    # prestige ores of the special shaft: dark → light, plus a glow colour
    'rhodonite': ['#4a1a2c', '#8a3052', '#c65482', '#ec8fb4', '#ffd3e6'],
    'charoite': ['#2a1640', '#51287a', '#8045b8', '#b27ee6', '#e6ccff'],
    'demantoid': ['#123a1c', '#1f6b31', '#3aa150', '#7ad986', '#d2ffd6'],
    'alexandrite': ['#1b3a2e', '#2f7058', '#c0447a', '#e87aa6', '#e9ffe9'],   # green body, raspberry tips
    'lovchorrite': ['#4a3d12', '#8a7424', '#c9aa3d', '#ecd67a', '#fff4c6'],
    'amethyst': ['#2a1a3e', '#452a66', '#6b3fa0', '#9a6be0', '#e2d0ff'],
}


def crystal(kind: str, shards: list[tuple[float, float, float, float]], w: int, h: int,
            base: str | None = None) -> Img:
    """A crystal cluster: each shard (x_foot, len, lean, width) is a pointed prism with a lit
    left facet and a shaded right one, a bright tip and an ink contour. Drawn bottom-up, back
    shards first. `base` paints a rock socket at the foot."""
    c = GEMS[kind]
    out = Img.new(w, h)
    for i, (fx, ln, lean, sw) in enumerate(shards):
        by = h - 2
        tx, ty = fx + lean * ln, by - ln
        hw = sw / 2
        left = [(fx - hw, by), (fx, by + 1), (tx, ty), (tx - hw * 0.9 + lean * 1.5, ty + ln * 0.25)]
        right = [(fx, by + 1), (fx + hw, by), (tx + hw * 0.9 + lean * 1.5, ty + ln * 0.25), (tx, ty)]
        body = c[1] if kind != 'alexandrite' else (c[1] if i % 2 else c[0])
        out.poly_([(fx - hw, by), (fx + hw, by), (tx + hw * 0.9 + lean * 1.5, ty + ln * 0.25), (tx, ty), (tx - hw * 0.9 + lean * 1.5, ty + ln * 0.25)], body)
        out.poly_(left, c[3] if kind != 'alexandrite' else c[1 if i % 2 else 2])
        out.poly_(right, c[2] if kind != 'alexandrite' else c[0])
        # the tip: the last quarter lights up (alexandrite turns raspberry toward the tip)
        tip = c[4] if kind != 'alexandrite' else c[3]
        out.line_(int(round(tx)), int(round(ty)), int(round(tx - lean * 2)), int(round(ty + max(2, ln * 0.28))), tip)
        if kind == 'alexandrite':
            out.poly_([(tx, ty), (tx - hw * 0.8 + lean * 1.5, ty + ln * 0.3), (tx + hw * 0.8 + lean * 1.5, ty + ln * 0.3)], c[2])
            out.px_(int(round(tx)), int(round(ty)) + 1, c[4])
    if base:
        br = ramp(base, 4, 0.36)
        out.ellipse_(w / 2, h - 2, w / 2 - 1, 2.2, br[1])
        out.ellipse_(w / 2 - 1, h - 2.5, w / 2 - 3, 1.5, br[2])
    return outline(out.crop(0, 0, w, h), INK).crop(1, 1, w, h)


# ------------------------------------------------------------------------------------ grilles
def lattice(w: int, h: int, open_: float, bar: str, bar_lit: str, dark: str | None = None) -> Img:
    """A scissor gate (раздвижная решётка): vertical bars with X-crossing straps between them.
    open_ 0..1 folds it to the left: the bars bunch up and the X's get steep."""
    out = Img.new(w, h)
    if dark:
        out.rect_(0, 0, w, h, dark)
    span = max(3, int(w * (1 - open_)))
    n = max(2, span // 5)
    xs = [int(round(i * (span - 1) / n)) for i in range(n + 1)]
    for a, b in zip(xs, xs[1:]):
        # X straps: from top-left to bottom-right and back, in three diamonds down the height
        seg = h / 3
        for k in range(3):
            y0, y1 = int(k * seg), int((k + 1) * seg)
            out.line_(a, y0, b, y1, bar)
            out.line_(b, y0, a, y1, bar)
    for x in xs:
        out.rect_(x, 0, 1, h, bar_lit)
    out.rect_(0, 0, span, 1, bar_lit)
    out.rect_(0, h - 1, span, 1, bar)
    return out


# ------------------------------------------------------------------------------ small things
def helmet(color: str = '#d8a632', lamp: bool = True) -> Img:
    """A miner's hard hat seen from the front: dome, brim, a headlamp on the front. 9 × 6."""
    r = ramp(color, 4, 0.4)
    g = [
        '..kkkkk..',
        '.k43332k.',
        'k4433322k',
        'k433l322k',
        'kkkkkkkkk',
        'k1111111k',
    ]
    pal = {'k': INK, '1': r[0], '2': r[1], '3': r[2], '4': r[3], 'l': '#fff6c8' if lamp else r[2]}
    out = grid(g, pal)
    return out


def jacket(color: str = '#4a5160') -> Img:
    """A quilted jacket (ватник) hanging from a hook by its collar: stitched rows. 12 × 16."""
    r = ramp(color, 4, 0.36)
    out = Img.new(12, 16)
    out.poly_([(4, 0), (8, 0), (11, 3), (12, 14), (0, 14), (1, 3)], r[2])
    out.poly_([(4, 0), (6, 0), (5, 14), (0, 14), (1, 3)], r[3])
    out.rect_(9, 4, 3, 10, r[1])
    for y in range(4, 14, 3):
        out.rect_(1, y, 10, 1, r[1])
    out.rect_(5, 2, 2, 12, r[0])                   # the front edge
    out.rect_(4, 0, 4, 2, r[0])                    # collar
    out.rect_(0, 14, 12, 2, r[2]); out.rect_(0, 15, 12, 1, r[1])
    return ink(out)


def rat(frame: int = 0, look: int = 1, color: str = '#6a6268') -> Img:
    """A grey rat sitting up, seen from the front-side: body, pink ears and tail, a bright eye.
    12 × 9; frame 1 twitches the nose and tail."""
    r = ramp(color, 4, 0.34)
    g = [
        '..........kk',
        '.......kk.kpk',
        'kk....k33kk3k',
        'kpk..k334443k',
        '.kpkk33334e3k',
        '..kk33333333nk',
        '...k2233333kk.',
        '...k22222222k.',
        '....kkkkkkkk..',
    ]
    if frame % 2:
        g = [
            '..........kk.',
            '.......kk.kpk',
            '.k....k33kk3k',
            'kpk..k334443k',
            'kpkkk33334e3k',
            '.kk.k3333333nk',
            '...k2233333kk.',
            '...k22222222k.',
            '....kkkkkkkk..',
        ]
    pal = {'k': INK, '2': r[1], '3': r[2], '4': r[3], 'p': '#c98a8a', 'e': '#ff4a3a', 'n': '#d88a8a'}
    out = grid(g, pal)
    return out if look > 0 else out.flip()
