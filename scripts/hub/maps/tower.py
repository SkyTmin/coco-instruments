"""Башня Чародея (v2.80) — the enchanter's den inside the camp's old water tower.

12 × 14 tiles. Stone walls, violet-grey stone flags. The mage stands behind a lectern with an open
glowing book, north of the middle of the room; the door is straight south of him, and the lane to
him crosses a violet rune circle painted on the floor, candles at its sides. West: two crammed
bookcases, a herb drying rack, the cauldron over a log fire, an ingredients table, a potion rack,
a sleeping cat on a cushion, a chest of spellbooks and a celestial globe. East: a spiral stair
winding up into the tank, the rune altar (the runes are sold here too), an amethyst druse, the
crystal ball, a scroll rack and a dusty cheval mirror. The water tower still shows: an iron riser
pipe comes down the wall to a valve and drips into a bucket.

Lessons from the review rounds (each: render ×4 day/night/solid, critique, fix):
  1. A lectern 30 px tall hid the mage to the eyes: a counter in front of a resident must start
     at his feet line (top ≥ feet y), as the forge's anvil does — so the lectern is 22 px and
     its top sits on the mage's feet row.
  2. The ornate cream floor (na-tan) was so loud that nothing stood off it and the room read
     as a bathroom. The violet-grey stone flags ('slab') make the violet circle the brightest
     thing on the floor, which it has to be.
  3. The spiral stair: a black "ceiling hole" ellipse stuck out of the room, and a rail running
     more than one full turn crossed itself into a scribble. Now: under one turn (9 treads),
     rail and balusters only on the front half, risers drawn where they face us (right half),
     the post stops at the top of the wall, the dark opening is painted on the wall face, and
     the treads fade into shadow as they climb.
  4. Herb bunches as solid widening triangles read as fir trees; the gaps between splayed
     stems and a ragged fringe of heads are what make a bunch.
  5. Scroll ends smaller than 4 × 4 read as an egg tray or as rows of «A»; a cream ring round a
     brown core reads as rolled paper. Two scrolls lying on top show the length.
  6. A black cat on a dark floor is a stone: smoke-grey coat, ears standing clear of the body,
     a LIGHT closed-eye line, the tail as its own curve. And never park it behind furniture
     whose base sorts after it (it vanished under the ingredients table) — it sleeps on the
     rug's end now.
  7. Sconces on the baseboard read as candles on the floor: wall lights go mid-wall.
  8. The star chart pinned on a crowded wall was invisible; on an easel on the floor it is one
     of the first things you see.
  9. Banners must not overlap the window — keep a pixel of wall between wall things.
"""
from __future__ import annotations

import math

import numpy as np

from art_shops import (WAX, books_flat, bookcase, bottle, candelabra, candle, candle_cluster, cat_asleep,
                       dust_decal, flame, sconce, shelf_unit, skull)
from kit import INK, P, bucket, ink, paper, shell, stool
from lib import T, Img, Map, camp, hue_role, na, outline, ramp, rng, tiles

W, H = 12, 14
V = P['violet']


# ------------------------------------------------------------------------------------ art
RUNES = [  # 3 × 4 staves in the spirit of the elder futhark
    ['#.#', '##.', '#..', '#..'], ['##.', '#.#', '#.#', '#.#'], ['#..', '##.', '##.', '#..'],
    ['##.', '#.#', '##.', '#.#'], ['..#', '.#.', '..#', '...'], ['#.#', '.#.', '#.#', '...'],
    ['#.#', '###', '#.#', '#.#'], ['.#.', '###', '.#.', '.#.'], ['.#.', '#.#', '.#.', '...'],
    ['.#.', '###', '#.#', '.#.'], ['#.#', '###', '.#.', '.#.'], ['.#.', '#.#', '.#.', '#.#'],
]


def rune_circle(frame: int) -> Img:
    """The circle painted on the floor, seen at the room's slant: two rings, a five-point star,
    twelve runes between the rings and a sigil in the middle. 72 × 44. It glows by itself: a soft
    halo, crisp lines; each frame a quarter of the outer ring and every fourth rune flare up —
    the light walks round the circle — and the whole paint breathes a little."""
    w, h = 72, 44
    cx, cy = w / 2, h / 2
    rx1, ry1 = 34, 20.5
    rx2, ry2 = 27, 15.5
    lines = Img.new(w, h)
    hot = Img.new(w, h)
    pulse = [0.0, 0.5, 1.0, 0.5][frame % 4]
    base = V[3] if pulse < 0.9 else '#ab82ea'

    def ring(rx, ry, col, img, a0=0.0, a1=2 * math.pi):
        n = int(rx * 10)
        for i in range(n + 1):
            a = a0 + (a1 - a0) * i / n
            img.px_(int(cx + rx * math.cos(a)), int(cy + ry * math.sin(a)), col)

    ring(rx1, ry1, base, lines)
    ring(rx2, ry2, base, lines)
    pts = [(cx + rx2 * math.cos(-math.pi / 2 + k * 2 * math.pi / 5), cy + ry2 * math.sin(-math.pi / 2 + k * 2 * math.pi / 5))
           for k in range(5)]
    for k in range(5):
        a, b = pts[k], pts[(k + 2) % 5]
        lines.line_(int(a[0]), int(a[1]), int(b[0]), int(b[1]), base)
    ring(5, 3, V[4], lines)
    lines.rect_(int(cx) - 1, int(cy) - 1, 2, 2, '#f4e8ff' if frame % 2 else V[4])
    for k in range(12):
        a = k * 2 * math.pi / 12 + math.pi / 12
        gx = int(cx + (rx1 + rx2) / 2 * math.cos(a)) - 1
        gy = int(cy + (ry1 + ry2) / 2 * math.sin(a)) - 2
        hotk = (k % 4) == frame % 4
        for yy, row in enumerate(RUNES[k]):
            for xx, v in enumerate(row):
                if v == '#':
                    (hot if hotk else lines).px_(gx + xx, gy + yy, '#f4e8ff' if hotk else V[4])
    a0 = frame * math.pi / 2
    ring(rx1, ry1, '#e6d4ff', hot, a0, a0 + math.pi / 2)
    ring(rx2, ry2, V[4], hot, a0 + math.pi, a0 + math.pi * 1.4)
    out = Img.new(w, h)
    m = (lines.a[:, :, 3] > 0) | (hot.a[:, :, 3] > 0)
    halo = np.zeros_like(m)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            halo |= np.roll(np.roll(m, dy, 0), dx, 1)
    ha = Img.new(w, h)
    ha.a[halo] = (0x6b, 0x3f, 0xa0, int(80 + 50 * pulse))
    out.paste_(ha, 0, 0)
    stain = Img.new(w, h)
    stain.ellipse_(cx, cy, rx2 - 1, ry2 - 1, V[1], 0.18 + 0.08 * pulse)
    out.paste_(stain, 0, 0)
    out.paste_(lines, 0, 0)
    out.paste_(hot, 0, 0)
    return out


def lectern(frame: int) -> Img:
    """A carved oak lectern with an open book whose lines glow violet; frame moves the glow
    down the page (someone is reading it). 24 × 22 — its top meets the reader's waist, so the
    mage behind it stays whole."""
    w, h = 24, 22
    out = Img.new(w, h)
    wd = P['wood']
    out.rect_(5, 18, 14, 4, wd[1]); out.rect_(5, 18, 14, 1, wd[3]); out.rect_(5, 18, 3, 4, wd[2])
    out.rect_(9, 9, 6, 10, wd[2]); out.rect_(9, 9, 2, 10, wd[3]); out.rect_(14, 9, 1, 10, wd[1])
    out.rect_(8, 13, 8, 2, wd[3]); out.rect_(8, 14, 8, 1, wd[1])                 # a carved ring
    out.poly_([(1, 1), (23, 1), (24, 9), (0, 9)], wd[1])
    out.rect_(1, 1, 22, 6, wd[3])
    out.rect_(0, 7, 24, 3, wd[1]); out.rect_(0, 7, 24, 1, wd[2])
    out = ink(out)
    pg = P['paper']
    out.rect_(2, 0, 10, 7, pg[3]); out.rect_(12, 0, 10, 7, pg[2])
    out.rect_(2, 6, 20, 1, pg[1])
    out.rect_(11, 0, 2, 7, '#6b3a2c')
    out.rect_(1, 0, 1, 7, '#5a2f3a'); out.rect_(22, 0, 1, 7, '#5a2f3a')
    for i, y in enumerate(range(1, 6, 2)):
        out.rect_(3, y, 7 - (i % 2), 1, V[4] if i == frame % 3 else V[2])
        out.rect_(13, y, 7 - ((i + 1) % 2) * 2, 1, V[4] if i == (frame + 1) % 3 else V[2])
    out.px_(18, 2, '#f4e8ff' if frame % 2 else V[4])
    out.rect_(15, 7, 1, 4, P['red'][2])                                          # the ribbon
    return out


def cauldron(frame: int) -> Img:
    """A black iron cauldron on three legs over a small log fire; the brew is poison green and
    bubbles swell and pop in turn. 26 × 26."""
    w, h = 26, 26
    out = Img.new(w, h)
    ir = P['iron']
    out.rect_(4, 21, 18, 3, P['wood'][1]); out.rect_(4, 21, 18, 1, P['wood'][3])
    out.rect_(7, 23, 13, 2, P['wood'][2])
    out.line_(3, 24, 8, 21, P['wood'][0])
    out.rect_(5, 17, 2, 6, ir[1]); out.rect_(19, 17, 2, 6, ir[0]); out.rect_(12, 19, 2, 5, ir[1])
    out.ellipse_(13, 13, 11.5, 8, ir[1])
    out.ellipse_(11.5, 12, 9, 6.5, ir[2])
    out.ellipse_(9, 11, 4, 3, ir[3])
    out.ellipse_(13, 7, 12, 4, ir[2])
    out = ink(out)
    out.ellipse_(13, 7, 10.5, 3, '#1c2a1a')
    out.ellipse_(13, 7.6, 9.5, 2.4, '#4e9a3a')
    out.ellipse_(12, 7.2, 7, 1.5, '#7fd05a')
    out.rect_(3, 5, 20, 1, ir[3]); out.px_(2, 6, ir[3]); out.px_(23, 6, ir[3])
    for k, (bx, by) in enumerate(((8, 7), (15, 8), (18, 6))):
        st = (frame + k * 2) % 4
        if st == 0:
            out.px_(bx, by, '#c8f59a')
        elif st == 1:
            out.rect_(bx, by - 1, 2, 2, '#9be66b'); out.px_(bx, by - 1, '#e8ffd0')
        elif st == 2:
            out.rect_(bx - 1, by - 2, 3, 3, '#7fd05a'); out.px_(bx - 1, by - 2, '#e8ffd0'); out.px_(bx, by - 1, '#4e9a3a')
        else:
            out.px_(bx - 1, by - 3, '#c8f59a'); out.px_(bx + 2, by - 2, '#c8f59a')
    for i, x in enumerate((8, 12, 17)):
        out.paste_(flame(frame + i, 1), x, 17)
    out.rect_(6, 21, 14, 1, P['fire'][2])
    return out


def crystal_ball(frame: int) -> Img:
    """A crystal ball on a brass claw on a little round table. The mist inside turns; the glint
    stays. 16 × 24."""
    w, h = 16, 24
    out = Img.new(w, h)
    wd, g = P['wood'], P['gold']
    out.ellipse_(8, 15, 7.5, 3, wd[3]); out.rect_(0, 15, 16, 2, wd[2])
    out.rect_(6, 17, 4, 5, wd[2]); out.rect_(6, 17, 1, 5, wd[3])
    out.rect_(3, 21, 10, 3, wd[1]); out.rect_(3, 21, 10, 1, wd[2])
    out.rect_(5, 12, 6, 3, g[2]); out.rect_(5, 12, 6, 1, g[3]); out.px_(4, 11, g[2]); out.px_(11, 11, g[2])
    out.ellipse_(8, 6.5, 6, 6, '#3b2a5e')
    out = ink(out)
    for k in range(10):
        a = frame * math.pi / 2 + k * 0.62
        r = 1.2 + k * 0.38
        out.px_(int(8 + r * math.cos(a)), int(6.5 + r * math.sin(a) * 0.9), V[4] if k < 6 else V[3])
    out.px_(8, 6, '#ecdcff')
    out.rect_(5, 3, 2, 1, '#ffffff'); out.px_(5, 4, '#e0d4ff')
    out.px_(4, 9, '#8a6fc0')
    return out


def rune_stone(k: int) -> Img:
    """A rune stone as the camp sells them: a slate arch with a carved glyph that glows the colour
    of its tier (grey, cyan, violet, gold). 6 × 7."""
    base = ['#5e6972', '#56505a', '#4a4450', '#5a5360'][k % 4]
    glow = ['#b8c4c8', '#6fe0e0', '#c9a6ff', '#ffd76a'][k % 4]
    c = ramp(base, 4, 0.4)
    out = Img.new(6, 7)
    out.rect_(0, 1, 6, 6, c[2]); out.rect_(1, 0, 4, 1, c[2])
    out.rect_(0, 1, 1, 6, c[3]); out.rect_(1, 0, 3, 1, c[3])
    out = ink(out)
    glyph = [[(2, 2), (2, 3), (2, 4), (3, 3)], [(2, 2), (3, 3), (2, 4), (3, 4)], [(2, 2), (3, 2), (2, 3), (2, 4)],
             [(2, 2), (3, 3), (2, 3), (3, 4)]][k % 4]
    for x, y in glyph:
        out.px_(x, y, glow)
    return out


def rune_altar(frame: int) -> Img:
    """The rune altar: a stone slab on two blocks, a violet runner with gold fringe, the rune
    stones laid out for sale, a skull and a candle stub. 38 × 26."""
    w, h = 38, 26
    out = Img.new(w, h)
    st = P['stone']
    for x in (3, 27):
        out.rect_(x, 12, 8, 14, st[2]); out.rect_(x, 12, 2, 14, st[3]); out.rect_(x + 6, 12, 2, 14, st[1])
    out.rect_(0, 4, w, 8, st[3]); out.rect_(0, 4, w, 1, st[4])
    out.rect_(0, 11, w, 4, st[2]); out.rect_(0, 14, w, 1, st[1])
    out = ink(out)
    out.rect_(12, 4, 14, 8, V[2]); out.rect_(12, 4, 14, 1, V[3])
    out.rect_(13, 11, 12, 9, V[2]); out.rect_(13, 11, 12, 1, V[1]); out.rect_(13, 11, 2, 9, V[3])
    for x in range(13, 25, 2):
        out.px_(x, 20, P['gold'][3]); out.px_(x + 1, 21, P['gold'][2])
    out.rect_(15, 14, 8, 1, P['gold'][2])
    for i, (x, y) in enumerate(((2, 2), (8, 3), (15, 1), (21, 3), (28, 2))):
        out.paste_(rune_stone(i), x, y)
    out.paste_(skull(), 31, 0)
    c = candle(frame, 3, drip=1)
    out.paste_(c, 34, 12 - c.h - 2)
    return out


def star_chart(w: int = 28, h: int = 14) -> Img:
    """A star chart pinned to the wall: navy sheet, a pale border, constellations joined by thin
    lines, a crescent moon."""
    r = rng('starchart', w, h)
    out = Img.new(w, h)
    out.rect_(0, 0, w, h, '#d6ccb3')
    out.rect_(1, 1, w - 2, h - 2, '#1e2a4a')
    out.rect_(1, 1, w - 2, 1, '#2c3b62')
    for i in range(80):
        a = i * 2 * math.pi / 80
        out.px_(int(w / 2 + (w / 2 - 3) * math.cos(a)), int(h / 2 + (h / 2 - 2.5) * math.sin(a)), '#34466e')
    cons = [[(4, 4), (7, 3), (10, 5), (12, 4)], [(15, 9), (18, 7), (21, 9), (19, 11)], [(6, 9), (8, 11), (11, 10)]]
    for c in cons:
        for (a, b), (cc, d) in zip(c, c[1:]):
            out.line_(a, b, cc, d, '#6f86b8')
        for x, y in c:
            out.px_(x, y, '#fff6c8')
    for _ in range(10):
        out.px_(r.randrange(2, w - 2), r.randrange(2, h - 2), '#aab8d8')
    out.ellipse_(w - 6, 4.5, 2.5, 2.5, '#f2e6a0'); out.ellipse_(w - 5, 3.9, 2.2, 2.2, '#1e2a4a')
    out = ink(out)
    out.px_(1, 0, P['red'][3]); out.px_(w - 2, 0, P['red'][3])
    return out


def herb_bunch(kind: int) -> Img:
    """A bunch of herbs hung head down: a straw tie on top, three or four stems splaying out,
    leaves in pairs along each stem and a ragged fringe of heads at the bottom. kind 0 sage,
    1 nettle, 2 lavender, 3 tansy. 9 × 14. A solid widening triangle reads as a fir tree — the
    gaps between the stems are what make it a bunch."""
    tones = [['#2e3d28', '#4a6038', '#6e8a4e', '#98b06c'], ['#1f3322', '#2f4f33', '#437048', '#6a9460'],
             ['#2e2440', '#4d3c6e', '#7a64a8', '#a896d4'], ['#5c4a1e', '#8a7430', '#b89c42', '#dcc46a']][kind % 4]
    head = [None, None, '#c9b6ee', '#f0d860'][kind % 4]
    out = Img.new(11, 15)
    out.rect_(4, 0, 3, 3, P['straw'][3]); out.rect_(4, 2, 3, 1, P['straw'][1])      # the tie
    stems = [(-2.2, 12), (-0.7, 13), (0.8, 13), (2.3, 11)]
    for i, (dx, L) in enumerate(stems):
        for k in range(L):
            x = 5.5 + dx * k / L
            y = 3 + k
            out.px_(int(x), y, tones[0] if k < 3 else tones[1])
            if k > 2 and k % 2 == i % 2:                                       # a leaf pair
                out.px_(int(x) - 1, y, tones[2]); out.px_(int(x) + 1, y, tones[2])
                if k % 4 == 1:
                    out.px_(int(x) - 1, y - 1, tones[3])
        ex, ey = int(5.5 + dx), 3 + L
        out.px_(ex, ey - 1, head or tones[3]); out.px_(ex, ey, head or tones[2])
        if head:
            out.px_(ex - 1, ey - 1, head); out.px_(ex, ey - 2, head)
    out = outline(out, INK)
    return out.crop(0, 1, out.w, out.h)


def herb_rack() -> Img:
    """A wooden drying rack — two A-frame ends and a pole — with six bunches hanging from it,
    a basket of cuttings at its foot. 32 × 30."""
    w, h = 32, 30
    out = Img.new(w, h)
    wd = P['wood']
    for x in (2, 28):
        out.line_(x, 4, x - 2, h - 1, wd[2]); out.line_(x + 1, 4, x - 1, h - 1, wd[1])
        out.line_(x, 4, x + 2, h - 1, wd[2]); out.line_(x + 1, 4, x + 3, h - 1, wd[1])
    out.rect_(1, 3, 30, 3, wd[3]); out.rect_(1, 3, 30, 1, wd[4]); out.rect_(1, 5, 30, 1, wd[1])
    out = ink(out)
    for i in range(4):
        b = herb_bunch([2, 0, 3, 1][i])
        out.paste_(b, 1 + i * 7, 4 + (i % 2))
    # a basket at the foot
    bk = Img.new(12, 6)
    bk.rect_(0, 1, 12, 5, P['straw'][2]); bk.rect_(0, 1, 12, 1, P['straw'][3])
    for x in range(1, 12, 2):
        bk.rect_(x, 2, 1, 4, P['straw'][1])
    bk.rect_(2, 0, 3, 1, P['leaf'][3]); bk.rect_(7, 0, 3, 1, P['leaf'][2])
    out.paste_(ink(bk), 10, h - 6)
    return out


def lancet_window(w: int = 9, h: int = 22) -> Img:
    """A tall arched window deep in the stone: night glass with two stars, a stone sill. The tower
    is always a little night inside."""
    out = Img.new(w, h)
    st = P['stone']
    out.rect_(0, 3, w, h - 3, st[1]); out.ellipse_(w / 2, 4, w / 2, 4, st[1])
    gw = w - 4
    out.rect_(2, 5, gw, h - 8, '#2a3c66'); out.ellipse_(w / 2, 5.5, gw / 2, 3, '#2a3c66')
    out.rect_(2, 5, gw, 3, '#3a5288')
    out.px_(3, 8, '#fff6c8'); out.px_(w - 3, 12, '#c8d4f0')
    out.rect_(w // 2, 3, 1, h - 6, st[0])
    out.rect_(0, h - 3, w, 3, st[3]); out.rect_(0, h - 3, w, 1, st[4])
    return ink(out)


def banner() -> Img:
    """NA's hanging banner with a star (TilesetHouse 27,20–21) pushed to the tower's violet. 16 × 32."""
    b = tiles(na('Backgrounds/Tilesets/TilesetHouse.png'), 27, 20, 1, 2)
    b = hue_role(b, 280, 345, 268, 1.25, 0.92)
    return camp(b, sat=0.85)


def spiral_stair() -> Img:
    """A spiral stair winding up into the tank, seen at the room's slant: wedge treads round an
    iron post, rising counter-clockwise on screen (up the right side, over the back). Each tread is
    a plank slab with a lit top, its riser face shows where it faces us (the right half), its
    thick outer edge where it passes in front; a rail with balusters runs along the front. The
    higher a tread, the deeper in shadow — the top ones go into the dark of the tank.
    48 × 72; feet on the bottom row."""
    w, h = 48, 72
    out = Img.new(w, h)
    wd, ir = P['wood'], P['iron']
    cx, gy = 24, 62
    R, r0 = 21, 3
    sq = 0.5
    rise = 6
    step = math.radians(36)
    a0 = math.radians(110)
    n = 9                            # under one full turn: the rail never crosses itself
    dark = np.array([12, 9, 18], np.float32)
    from lib import hexrgb

    def fk(z: float) -> float:
        return min(0.78, max(0.0, (z - 30) / 26))

    def fade(col: str, z: float) -> str:
        k = fk(z)
        c = np.array(hexrgb(col)[:3], np.float32) * (1 - k) + dark * k
        return '#%02x%02x%02x' % tuple(int(v) for v in c)

    treads = [(k, a0 - k * step, k * rise) for k in range(n)]

    def P2(rad, a, z):
        return cx + rad * math.cos(a), gy + rad * math.sin(a) * sq - z

    def draw_tread(k, a, z):
        th = 3
        # the riser: the vertical face under the leading edge, seen where it faces the viewer
        if math.cos(a) > 0.05 and k > 0:
            quad = [P2(r0, a, z), P2(R, a, z), P2(R, a, z - rise), P2(r0, a, z - rise)]
            out.poly_(quad, fade(wd[1], z))
            (x0, y0), (x1, y1) = P2(r0, a, z - rise / 2), P2(R, a, z - rise / 2)
            out.line_(int(x0), int(y0), int(x1), int(y1), fade(wd[0], z))
        # the thick outer edge where the tread passes in front
        arc = [P2(R, a - step * i / 8, z) for i in range(9)]
        for (x0, y0), (x1, y1) in zip(arc, arc[1:]):
            out.poly_([(x0, y0), (x1, y1), (x1, y1 + th), (x0, y0 + th)], fade(wd[0], z))
        top = [P2(R, a - step * i / 6, z) for i in range(7)] + [P2(r0, a - step + step * i / 6, z) for i in range(7)]
        lit = math.cos(a - step / 2) < 0.3
        out.poly_(top, fade(wd[3] if lit else wd[2], z))
        (x0, y0), (x1, y1) = P2(r0, a, z), P2(R, a, z)
        out.line_(int(x0), int(y0), int(x1), int(y1), fade(wd[4], z))
        (mx0, my0), (mx1, my1) = P2(r0 + 2, a - step / 2, z), P2(R - 1, a - step / 2, z)
        out.line_(int(mx0), int(my0), int(mx1), int(my1), fade(wd[2] if lit else wd[1], z))
        # a nail head at each end of the plank joint
        out.px_(int(mx1), int(my1), fade(ir[3], z))

    back = [t for t in treads if math.sin(t[1] - step / 2) < 0]
    front = [t for t in treads if math.sin(t[1] - step / 2) >= 0]
    for t in back:
        draw_tread(*t)
    top_z = min((n - 1) * rise + 12, gy - 8)            # the post stops at the top of the wall, not on the cap
    for y in range(int(gy - top_z), gy + 2):
        z = gy - y
        out.rect_(cx - 2, y, 5, 1, fade(ir[2], z))
        out.px_(cx - 2, y, fade(ir[3], z)); out.px_(cx + 2, y, fade(ir[1], z))
    out.rect_(cx - 3, int(gy - top_z) - 2, 7, 3, fade(ir[3], top_z))                      # the post's cap
    for t in front:
        draw_tread(*t)
    rail = []
    for k, a, z in treads:
        front_k = math.sin(a - step / 2) > -0.25
        for i in range(4):
            aa = a - step * i / 4
            x, y = P2(R - 1, aa, z)
            rail.append((x, y - 11, z, front_k))
        x, y = P2(R - 1, a - step / 2, z)
        if front_k:
            out.line_(int(x), int(y), int(x), int(y) - 11, fade(ir[1], z))
    for (x0, y0, z0, f0), (x1, y1, z1, f1) in zip(rail, rail[1:]):
        if f0 and f1:
            out.line_(int(x0), int(y0), int(x1), int(y1), fade(ir[3], z0))
            out.line_(int(x0), int(y0) + 1, int(x1), int(y1) + 1, fade(ir[0], z0))
    out = ink(out)
    for y in range(h):
        k = fk(gy - y)
        if k > 0:
            row = out.a[y, :, :3].astype(np.float32)
            out.a[y, :, :3] = (row * (1 - k) + dark * k).astype(np.uint8)
    return out


def riser_pipe(h: int = 30) -> Img:
    """The water tower's riser: a rusty iron pipe coming down the wall from the ceiling, a flange,
    a red valve wheel, an elbow turning out over the floor where it drips. 14 × h."""
    out = Img.new(14, h)
    rs, ir = P['rust'], P['iron']
    out.rect_(4, 0, 5, h - 4, rs[2]); out.rect_(4, 0, 1, h - 4, rs[3]); out.rect_(8, 0, 1, h - 4, rs[1])
    out.rect_(4, h - 6, 5, 4, rs[2]); out.rect_(4, h - 3, 7, 3, rs[2]); out.rect_(4, h - 3, 7, 1, rs[3])  # elbow out
    out.rect_(3, 6, 7, 2, ir[2]); out.rect_(3, 6, 7, 1, ir[3])                    # flange
    out = ink(out)
    # the valve wheel
    for i in range(28):
        a = i * 2 * math.pi / 28
        out.px_(int(6.5 + 4.5 * math.cos(a)), int(15.5 + 4.5 * math.sin(a)), P['red'][2])
    out.rect_(6, 12, 1, 8, P['red'][1]); out.rect_(3, 15, 8, 1, P['red'][1])
    out.rect_(5, 14, 3, 3, ir[3])
    out.px_(3, 12, P['red'][3]); out.px_(4, 11, P['red'][3])
    out.px_(11, h - 1, '#8fc0d0')                                                # the drop
    return out


def globe() -> Img:
    """A celestial globe on a turned stand: a dark blue sphere with gold stars inside a brass
    meridian ring. 16 × 26."""
    w, h = 16, 26
    out = Img.new(w, h)
    wd, g = P['wood'], P['gold']
    out.rect_(3, 22, 10, 4, wd[1]); out.rect_(3, 22, 10, 1, wd[3])
    out.rect_(7, 14, 3, 9, wd[2]); out.rect_(7, 14, 1, 9, wd[3])
    out.ellipse_(8, 8, 7, 7, g[2])
    out.ellipse_(8, 8, 5.6, 5.6, '#243258')
    out.ellipse_(6.5, 6.5, 3, 3, '#324478')
    out = ink(out)
    for x, y in ((6, 5), (9, 7), (5, 9), (10, 10), (8, 4), (7, 11)):
        out.px_(x, y, g[4])
    out.line_(4, 10, 11, 5, '#6f86b8')
    out.rect_(4, 14, 8, 1, g[3])
    return out


def druse(frame: int) -> Img:
    """An amethyst druse on the floor: a dark geode rind, crystals as separate hexagonal points
    fanning out of it — each with a lit left face, a dark right face and an ink edge, so they
    read as stones and not as a violet puddle; one tip flashes per frame. 20 × 18."""
    out = Img.new(20, 18)
    st = P['stone']
    out.ellipse_(10, 14, 9.5, 3.8, st[0]); out.ellipse_(10, 13.4, 8.5, 2.8, st[1])
    crystals = [(4, 14, 7, -1), (8, 14, 11, 0), (12, 14, 13, 0), (16, 14, 8, 1), (10, 15, 6, 0)]
    for x, y, hh, lean in crystals:
        tip = (x + lean * 2, y - hh)
        body = [(x - 2, y), (x - 2 + lean, y - hh + 3), tip, (x + 2 + lean, y - hh + 3), (x + 2, y)]
        piece = Img.new(20, 18)
        piece.poly_(body, V[1])
        piece.poly_([(x - 2, y), (x - 2 + lean, y - hh + 3), tip, (x + lean * 0.5, y)], V[3])
        piece.line_(int(x - 1 + lean), int(y - hh + 3), int(tip[0]), int(tip[1]) + 1, V[4])
        out.paste_(ink(piece), 0, 0)
    for i, (x, y, hh, lean) in enumerate(crystals):
        if i == frame % len(crystals):
            out.px_(x + lean * 2, y - hh + 1, '#ffffff'); out.px_(x + lean * 2 - 1, y - hh + 2, '#ecdcff')
    return out


def easel_chart() -> Img:
    """A star chart on a wooden easel: three legs, a ledge, the navy sheet with its
    constellations, a stick of chalk on the ledge. 26 × 34."""
    w, h = 26, 34
    out = Img.new(w, h)
    wd = P['wood']
    out.line_(6, 0, 1, h - 1, wd[2]); out.line_(7, 0, 2, h - 1, wd[1])
    out.line_(19, 0, 24, h - 1, wd[1]); out.line_(18, 0, 23, h - 1, wd[2])
    out.line_(13, 4, 13, h - 3, wd[0])
    out = ink(out)
    ch = star_chart(24, 18)
    out.paste_(ch, 1, 2)
    out.rect_(1, 20, 24, 3, wd[3]); out.rect_(1, 20, 24, 1, wd[4])
    out.rect_(1, 22, 24, 1, INK)
    out.rect_(16, 19, 4, 1, '#eeeeee')
    return out


def hourglass_stool() -> Img:
    """A stool with a big hourglass on it and a book under the hourglass. 14 × 26."""
    out = Img.new(14, 26)
    s = stool()
    out.paste_(s, 2, 16)
    hg = camp(na('Items/Object/Hourglass.png'), sat=0.8)
    hg, _, _ = hg.trim()
    bk = books_flat(1, 10, 3)
    out.paste_(bk, 1, 16 - bk.h + 2)
    out.paste_(hg, (14 - hg.w) // 2, 16 - bk.h + 3 - hg.h)
    return out


def stair_opening() -> Img:
    """The dark of the tank above, seen at the top of the wall where the stair goes through the
    ceiling: a ragged-edged opening with a riveted iron lip. For the wall face. 44 × 22."""
    w, h = 40, 22
    out = Img.new(w, h)
    out.ellipse_(w / 2, 4, w / 2, 16, '#0c0910')
    out.a[:2, :, 3] = 0
    for x in range(2, w - 2, 5):
        out.px_(x, int(4 + 15.4 * math.sqrt(max(0, 1 - ((x - w / 2) / (w / 2)) ** 2))), P['iron'][3])
    return out


def ingredients_table(frame: int) -> Img:
    """A small table by the cauldron: a mortar and pestle, a jar of eyes, a bundle of roots, a
    candle. 30 × 22."""
    w, h = 30, 22
    out = Img.new(w, h)
    wd, st = P['wood'], P['stone']
    out.rect_(0, 9, w, 5, wd[3]); out.rect_(0, 9, w, 1, wd[4]); out.rect_(0, 14, w, 2, wd[1])
    out.rect_(2, 16, 3, 6, wd[2]); out.rect_(w - 5, 16, 3, 6, wd[1])
    out = ink(out)
    # mortar and pestle
    m = Img.new(9, 7)
    m.ellipse_(4.5, 4, 4.5, 3, st[2]); m.ellipse_(4.5, 2.2, 3.5, 1.2, '#2a2428'); m.rect_(1, 5, 7, 2, st[1])
    m.line_(5, 2, 8, -1, wd[3])
    out.paste_(ink(m), 2, 4)
    # a jar of eyes
    j = bottle('jar', '#9ab0a0', 0.9)
    out.paste_(j, 12, 4)
    out.px_(13, 7, '#ffffff'); out.px_(15, 8, '#ffffff'); out.px_(14, 7, '#1a1a1a')
    # roots
    out.line_(19, 10, 24, 8, '#8a6a4a'); out.line_(19, 11, 24, 10, '#6a4a3a'); out.px_(25, 8, '#8a6a4a')
    c = candle(frame, 4, drip=2)
    out.paste_(c, 25, 10 - c.h + 1)
    return out


def scroll_rack() -> Img:
    """Pigeonholes for scrolls: a 3 × 3 cabinet, each hole holding two rolled parchments seen end
    on — a 4 × 4 cream ring round a brown core, which is what a rolled sheet looks like; smaller
    than that it read as an egg tray or a row of letters A. Two scrolls lie on top. 30 × 32."""
    w, h = 30, 32
    out = Img.new(w, h)
    wd, pg = P['wood'], P['paper']
    top = 4
    out.rect_(0, top, w, h - top, wd[2]); out.rect_(0, top, w, 3, wd[3]); out.rect_(0, top, w, 1, wd[4])
    out.rect_(0, top + 3, 2, h - top - 3, wd[3]); out.rect_(w - 2, top + 3, 2, h - top - 3, wd[1])
    out.rect_(0, h - 2, w, 2, wd[1])
    for j in range(3):
        for i in range(3):
            x, y = 2 + i * 9, top + 4 + j * 8
            out.rect_(x, y, 8, 6, '#241815')
            out.rect_(x - 1, y + 6, 10, 2, wd[3]); out.rect_(x - 1, y + 7, 10, 1, wd[1])
    out = ink(out)
    r = rng('scrolls')
    end = ['.aa.', 'abca', 'abcb', '.bb.']
    for j in range(3):
        for i in range(3):
            x, y = 2 + i * 9, top + 4 + j * 8
            for s in range(r.choice([1, 2, 2, 2])):
                sx, sy = x + s * 4, y + 2
                tie = r.random() < 0.3
                for yy, row in enumerate(end):
                    for xx, v in enumerate(row):
                        if v != '.':
                            out.px_(sx + xx, sy + yy, {'a': pg[3], 'b': pg[1], 'c': '#6a5040'}[v])
                if tie:
                    out.px_(sx, sy + 2, P['red'][2]); out.px_(sx + 3, sy + 1, P['red'][2])
    for k, (x, y) in enumerate(((3, 0), (15, 1))):
        L = 12 if k == 0 else 10
        out.rect_(x, y, L, 4, pg[2]); out.rect_(x, y, L, 1, pg[3]); out.rect_(x, y + 3, L, 1, pg[1])
        out.rect_(x + L // 2, y, 1, 4, P['red'][2])
        out.px_(x - 1, y + 1, pg[1]); out.px_(x - 1, y + 2, pg[1]); out.px_(x + L, y + 1, pg[1]); out.px_(x + L, y + 2, pg[0])
    return out


def mirror() -> Img:
    """A dusty cheval mirror: an oval gilt frame on a stand, the glass clouded with dust except a
    wiped streak that catches a violet glint. 18 × 34."""
    w, h = 18, 34
    out = Img.new(w, h)
    g, wd = P['gold'], P['wood']
    out.rect_(1, 10, 2, 22, wd[2]); out.rect_(15, 10, 2, 22, wd[1])
    out.rect_(0, 31, 5, 3, wd[2]); out.rect_(13, 31, 5, 3, wd[1])
    out.rect_(2, 27, 14, 2, wd[2])
    out.ellipse_(9, 13, 7.5, 12, g[1])
    out.ellipse_(8.5, 12.5, 6.5, 11, g[2])
    out.ellipse_(9, 13, 5.5, 10, '#6f7c86')
    out = ink(out)
    glass = Img.new(w, h); glass.ellipse_(9, 13, 5.5, 10, '#ffffff')
    r = rng('dust-mirror')
    for yy in range(h):
        for xx in range(w):
            if glass.a[yy, xx, 3]:
                c = '#7f8c95' if (xx + yy) % 5 else '#8f9aa0'
                if r.random() < 0.25:
                    c = '#9aa2a4'
                out.px_(xx, yy, c)
    for k in range(9):
        out.px_(6 + k // 2, 6 + k, '#b8c8d4'); out.px_(7 + k // 2, 6 + k, '#a4b4c4')
    out.px_(7, 7, '#f0e6ff'); out.px_(8, 8, '#d8c4ff')
    out.px_(9, 1, g[4]); out.px_(8, 1, g[3])
    return out


def floor_books() -> Img:
    """Books left on the floor: a stack and an open one. 22 × 12."""
    out = Img.new(22, 12)
    st = books_flat(4, 8, 5)
    out.paste_(st, 0, 12 - st.h)
    ob = Img.new(11, 6)
    ob.rect_(0, 0, 11, 6, '#5a2f3a'); ob.rect_(1, 0, 4, 5, P['paper'][3]); ob.rect_(6, 0, 4, 5, P['paper'][2])
    ob.rect_(2, 1, 3, 1, P['paper'][0]); ob.rect_(2, 3, 2, 1, P['paper'][0]); ob.rect_(7, 2, 2, 1, P['paper'][0])
    out.paste_(ink(ob), 11, 5)
    return out


def spell_chest() -> Img:
    """NA's little treasure chest (closed), graded, with spellbooks stacked on its lid. 16 × 20."""
    ch = camp(na('Items/Treasure/LittleTreasureChest.png').crop(0, 0, 16, 16), sat=0.7)
    ch, _, _ = ch.trim()
    out = Img.new(16, 20)
    out.paste_(ch, (16 - ch.w) // 2, 20 - ch.h)
    bk = books_flat(2, 8, 11)
    out.paste_(bk, 2, 20 - ch.h - bk.h + 3)
    return out


def bookcase_na() -> Img:
    """NA's 2 × 2 bookcase (TilesetElement 8,7), its orange wood pulled to the camp's oak and more
    books pushed in on top. 32 × 38."""
    b = tiles(na('Backgrounds/Tilesets/TilesetElement.png'), 8, 7, 2, 2)
    b = hue_role(b, 10, 45, 22, 0.75, 0.82)
    b = camp(b, sat=0.8)
    out = Img.new(32, 38)
    out.paste_(b, 0, 6)
    st = books_flat(3, 9, 21)
    out.paste_(st, 3, 6 - st.h + 3)
    out.paste_(skull(), 22, 2)
    return out


def rug_violet(w: int, h: int) -> Img:
    """A worn violet rug with a gold border and a line of stars. For the ground."""
    out = Img.new(w, h)
    out.rect_(0, 0, w, h, P['gold'][1])
    out.rect_(1, 1, w - 2, h - 2, V[1])
    out.rect_(3, 3, w - 6, h - 6, V[2])
    out.rect_(4, 4, w - 8, h - 8, V[1])
    for x in range(8, w - 6, 10):
        out.px_(x, h // 2, P['gold'][3]); out.px_(x - 1, h // 2, P['gold'][2]); out.px_(x + 1, h // 2, P['gold'][2])
        out.px_(x, h // 2 - 1, P['gold'][2]); out.px_(x, h // 2 + 1, P['gold'][2])
    for x in range(1, w - 1, 3):
        out.px_(x, 0, P['gold'][3]); out.px_(x, h - 1, P['gold'][3])
    return ink(out)


# ------------------------------------------------------------------------------------ map
def build() -> Map:
    m = Map('tower', W, H, 'indoor', name='Башня Чародея', ambient=0.5, music='yard')
    shell(m, 'stone', 'slab', face=2, door=(5, 2), out_to='square', out_at='tower', floor_seed=5)
    g = m.ground
    r = rng('tower-floor')

    # --- ground: the rug under the lectern, wax and chalk, dust, loose pages
    m.stamp(rug_violet(5 * T, 2 * T + 4), 3 * T + 8, 4 * T + 8)
    for _ in range(30):
        x, y = r.randrange(T, (W - 1) * T), r.randrange(4 * T, (H - 1) * T)
        g.px_(x, y, WAX[2] if r.random() < 0.5 else '#d8d0e0', 0.8)
    for _ in range(14):                                                           # chalk scribbles
        x, y = r.randrange(2 * T, 10 * T), r.randrange(7 * T, 12 * T)
        g.line_(x, y, x + r.randrange(-3, 4), y + r.randrange(-2, 3), '#c8c0d4', 0.35)
    m.stamp(dust_decal(3 * T, 2 * T, 3, '#120a18', 0.18, 34), 1 * T, 10 * T + 8)
    m.stamp(dust_decal(3 * T, 2 * T, 4, '#120a18', 0.16, 34), 8 * T, 10 * T + 8)
    g.ellipse_(2 * T + 3, 8 * T - 2, 20, 7, '#101a0c', 0.3)                          # soot by the cauldron
    for i, (x, y) in enumerate(((5 * T - 8, 7 * T + 6), (9 * T + 6, 10 * T + 12), (3 * T + 6, 12 * T + 4))):
        m.stamp(paper(7, 8, 20 + i), x, y)

    # --- north wall face: a banner, the lancet window behind the mage, a sconce, the riser pipe
    #     with its valve and herbs hung on it, the opening the stair climbs into
    m.stamp(stair_opening(), 8 * T + 8, T)
    m.stamp(banner(), 5 * T - 2, T)
    m.stamp(lancet_window(), 6 * T - 4, T + 4)
    m.stamp(riser_pipe(30), 7 * T + 4, T + 1)
    m.stamp(herb_bunch(2), 7 * T - 5, T + 3)
    m.stamp(herb_bunch(1), 7 * T + 13, T + 5)
    m.put('tower.sconce', [sconce(i) for i in range(4)], 6 * T + 7, T + 12, base=3 * T, fps=6)
    m.light(6 * T, 2 * T + 4, 36, '#8aa4e0', 'window')
    m.light(6 * T + 11, 2 * T, 24, '#ffb35a', 'candle')
    m.put('kit.bucket', bucket(True), 7 * T + 13, 4 * T - 13, solid=(7.8, 3, 8.4, 3.8))
    m.emit('drip', 8 * T - 1, 3 * T - 1, 0.4)

    # --- the two bookcases in the north-west
    m.put('tower.bookcase', bookcase(32, 48, 4, 3, extras=('skull', 'jar', 'flat', 'flask')), 1 * T, 4 * T - 48,
          solid=(1, 3, 3, 4))
    bn = bookcase_na()
    m.put('tower.bookcase2', bn, 3 * T, 4 * T - bn.h, solid=(3, 3, 5, 4))

    # --- the spiral stair in the north-east corner, into the dark of the tank
    st = spiral_stair()
    m.put('tower.stair', st, 8 * T + 4, 5 * T + 2 - st.h, solid=(8.3, 3, 11, 5))

    # --- the lectern and the mage behind it
    lec = [lectern(i) for i in range(4)]
    m.put('tower.lectern', lec, 6 * T - 12, 5 * T, fps=3, solid=(5.5, 5.5, 6.5, 6.4))
    m.npc('mage', 'mage', 6.0, 4.9, face=0, anim='idle', name='Чародей')
    m.marks['mage'] = (6.0, 4.9)
    m.light(6 * T, 5 * T + 4, 34, '#b48cff', 'magic')
    ct = [cat_asleep(i, 'smoke') for i in range(2)]
    m.put('tower.cat', ct, 7 * T - 3, 6 * T + 3 - ct[0].h, fps=1, solid=(7, 5.6, 8.2, 6.2))   # on the rug's end

    # --- the rune circle on the floor, candles at its sides
    rc = [rune_circle(i) for i in range(4)]
    m.put('tower.circle', rc, 6 * T - 36, 9 * T + 8 - 22, base=8 * T, fps=4)
    m.light(6 * T, 9 * T + 8, 64, '#9a6be0', 'magic')
    m.emit('motes', 6 * T, 9 * T + 6, 1.2)
    for i, (x, y) in enumerate(((3.55, 9.6), (8.45, 9.6), (4.6, 10.85), (7.4, 10.85))):
        spec = [(0, 5), (4, 8), (8, 4)] if i < 2 else [(0, 7), (4, 4)]
        cw = 13 if i < 2 else 9
        cl = [candle_cluster(k, spec, cw, 18) for k in range(4)]
        m.put(f'tower.candles{0 if i < 2 else 1}', cl, int(x * T) - cw // 2, int(y * T) - cl[0].h + 3, fps=6,
              phase=i * 0.3, solid=(x - 0.3, y - 0.3, x + 0.3, y + 0.1))
        m.light(x * T, y * T - 8, 26, '#ffb35a', 'candle')

    # --- west: herb rack, cauldron, ingredients table, hourglass, potion rack, chest and globe
    hr = herb_rack()
    m.put('tower.herbrack', hr, 1 * T, 6 * T - hr.h + 1, solid=(1, 5.3, 3, 6))
    cd = [cauldron(i) for i in range(4)]
    m.put('tower.cauldron', cd, 1 * T + 4, 8 * T - cd[0].h, fps=5, solid=(1.2, 7.2, 2.9, 8))
    m.emit('steam', 2 * T + 1, 7 * T - 2, 0.8)
    m.light(2 * T + 1, 7 * T + 8, 40, '#7fd05a', 'fire')
    it = [ingredients_table(i) for i in range(4)]
    m.put('tower.ingredients', it, 3 * T - 4, 7 * T + 2 - it[0].h, fps=6, phase=0.2, solid=(2.8, 6.4, 4.6, 7))
    hs = hourglass_stool()
    m.put('tower.hourglass', hs, 3 * T + 2, 9 * T - 2 - hs.h, solid=(3.1, 8.3, 3.9, 8.9))
    pr = potion_rack()
    m.put('tower.potions', pr, 1 * T, 10 * T + 4 - pr.h, solid=(1, 9.3, 2.7, 10.2))
    ch = spell_chest()
    m.put('tower.chest', ch, 1 * T + 1, 12 * T + 2 - ch.h, solid=(1, 11.4, 2, 12))
    m.put('tower.floorbooks', floor_books(), 2 * T + 3, 12 * T - 3)
    gl = globe()
    m.put('tower.globe', gl, 2 * T + 6, 11 * T - gl.h, solid=(2.4, 10.4, 3.3, 11))

    # --- east: rune altar, star chart on its easel, crystal ball, druse, scroll rack, mirror
    ra = [rune_altar(i) for i in range(4)]
    m.put('tower.altar', ra, 8 * T + 6, 7 * T + 4 - ra[0].h, fps=6, solid=(8.3, 6.4, 10.7, 7.3))
    m.light(9 * T + 8, 6 * T + 10, 28, '#c9a6ff', 'glow')
    ea = easel_chart()
    m.put('tower.easel', ea, 7 * T - 1, 8 * T + 4 - ea.h, solid=(7, 7.6, 8.5, 8.25))
    cb = [crystal_ball(i) for i in range(4)]
    m.put('tower.ball', cb, 9 * T + 4, 9 * T + 8 - cb[0].h, fps=3, solid=(9.2, 8.8, 10.2, 9.5))
    m.light(9 * T + 12, 8 * T + 12, 24, '#b48cff', 'glow')
    dr = [druse(i) for i in range(5)]
    m.put('tower.druse', dr, 9 * T + 6, 11 * T - dr[0].h, fps=3, solid=(9.4, 10.5, 10.6, 11))
    m.light(10 * T, 10 * T + 8, 20, '#b48cff', 'glow')
    sr = scroll_rack()
    m.put('tower.scrolls', sr, 8 * T, 12 * T + 2 - sr.h, solid=(8, 11.3, 9.9, 12))
    mi = mirror()
    m.put('tower.mirror', mi, 10 * T - 2, 12 * T + 2 - mi.h, solid=(9.9, 11.4, 11, 12))

    # --- a candelabrum on each side of the door
    for i, x in enumerate((4.35, 7.65)):
        cb2 = [candelabra(k) for k in range(4)]
        m.put('tower.candelabra', cb2, int(x * T) - 9, 12 * T + 6 - cb2[0].h, fps=6, phase=0.5 * i,
              solid=(x - 0.3, 11.8, x + 0.3, 12.4))
        m.light(x * T, 11 * T - 2, 40, '#ffb35a', 'candle')
    return m


def potion_rack() -> Img:
    """A narrow rack of potions and ingredients: three shelves of flasks, jars and vials in all
    the colours of the trade, a skull and a jar on top. 26 × 38."""
    r = rng('potions')
    cols = ['#a8323b', '#4e9a3a', '#3d6fb0', '#9a6be0', '#d0a040', '#40b0a0', '#c05080']
    kinds = ['flask', 'tall', 'cone', 'jar', 'vial']
    rows = []
    for s in range(3):
        row = []
        for i in range(6):
            k = kinds[(s * 2 + i) % 5]
            row.append(bottle(k, cols[(s * 3 + i * 2) % len(cols)], r.uniform(0.4, 0.95)))
        rows.append(row)
    return shelf_unit(26, 38, rows, top_row=[skull(), bottle('jar', '#6ba34a', 0.8)], legs=3)
