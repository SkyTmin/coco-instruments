"""Shared art for the town interiors — Торговец, Штаб, Клуб (v2.80).

The three rooms are drawn in the forge's hand (see maps/forge.py and kit.py): a 1 px ink contour,
three to five tones per material with the light from the upper left, flat fills, chunky details.
This module holds what more than one of them needs — materials the kit doesn't have (brass,
lacquer, velvet, felt, chrome, neon), small props (bottles, a glass, a chair from behind, a bar
stool, potted plants), floor rugs and clutter, the neon tube font and a sign font fix.
Room-specific pieces live in the map modules.

Helpers worth moving into kit.py when the maps are merged (they are generic):
  * `halo(img, color, a)`   — a semi-transparent rim around a sprite (neon tubes, lit glass)
  * `box3(...)`             — a furniture block: lit top, lit left edge, shaded front, ink inside
  * `oriental_rug(...)`     — a knotted rug: fringe, zigzag border, lozenge field, medallion
  * `runner(...)`           — the Soviet red runner with green edge stripes
  * `litter(...)`           — scatter floor clutter into the ground (butt, straw, paper, sawdust,
                              coin, chip, confetti, ash, dust)
  * `tube_text(...)`        — 5 × 7 neon tube lettering with a white-hot core
  * `sign_text(...)`        — kit.text with a readable «Д» (kit.FONT's «Д» reads as «А»)
  * `potted(...)`, `bottle(...)`, `chair_back(...)`, `stool_round(...)`
"""
from __future__ import annotations

import math

import numpy as np

from kit import INK, P, ink
from lib import Img, hexrgb, outline, ramp, rng

# --------------------------------------------------------------------------------- materials
# brass: desaturated so it sits in the camp; the gold ramp in kit is for treasure and accents
BRASS = ['#4f3a1c', '#7a5a2a', '#a07c3a', '#c8a256', '#e8cf8a']
COPPER = ['#4a2418', '#74391f', '#9a5530', '#c07a48', '#dea37a']
LACQUER = ['#141216', '#221e24', '#35303a', '#4d4752', '#6e6674']        # black piano lacquer
WALNUT = ['#2e1a16', '#4a2a20', '#673a28', '#8a5234', '#aa6e48']         # polished office wood
VELVET = ['#3a0e18', '#5c1624', '#842230', '#ab3440', '#cf5a5e']         # club red
FELT = ['#10281c', '#173a28', '#1f5236', '#2d6e48', '#46905e']           # card-table green
OLIVE = ['#262a1e', '#3a4030', '#535b42', '#6f7a58', '#909c76']          # army canvas, jerrycans
CHROME = ['#2a2e36', '#4a5260', '#7c8898', '#b4bfcc', '#eef3f8']
NEON_PINK = ['#7a1450', '#d0288a', '#ff5ec4', '#ffb0e4', '#fff0fa']
NEON_CYAN = ['#0f4a5e', '#1aa0c0', '#4fe8ff', '#b4f6ff', '#f0feff']


def box3(w: int, h: int, top: int, r: list[str], front: list[str] | None = None, lit_left: bool = True) -> Img:
    """A furniture block seen from the front-top: `top` px of lit top face, the front below.
    Light from the upper left: the top's back edge and left edge are the lightest, the front's
    bottom row and right edge the darkest. Contour inside the rectangle (kit.ink)."""
    f = front or r
    out = Img.new(w, h)
    out.rect_(0, 0, w, top, r[3])
    out.rect_(0, 0, w, 1, r[4])
    out.rect_(0, top, w, h - top, f[2])
    out.rect_(0, top, w, 1, f[1])            # the lip's shadow line
    out.rect_(0, h - 2, w, 2, f[1])
    if lit_left:
        out.rect_(1, top + 1, 1, h - top - 3, f[3])
        out.rect_(w - 2, top + 1, 1, h - top - 3, f[1])
    return ink(out)


def halo(img: Img, color: str, a: float = 0.35, width: int = 1) -> Img:
    """Grow a semi-transparent rim around the opaque shape — neon tubes, lit glass. The sprite
    grows by `width` px on each side."""
    out = img
    for i in range(width):
        pad = Img.new(out.w + 2, out.h + 2)
        pad.paste_(out, 1, 1)
        mm = pad.a[:, :, 3] > 0
        grow = np.zeros_like(mm)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            grow |= np.roll(np.roll(mm, dy, 0), dx, 1)
        grow &= ~mm
        c = hexrgb(color)
        k = a * (1 - i / max(1, width))
        pad.a[grow] = (c[0], c[1], c[2], int(255 * k))
        out = pad
    return out


# ------------------------------------------------------------------------------ small props
def bottle(glass: str, h: int = 11, label: str | None = None, cork: str | None = None) -> Img:
    """A bottle, 5 px wide: neck, shoulders, body with a vertical highlight, optional label."""
    g = ramp(glass, 4, 0.5)
    out = Img.new(5, h)
    neck = max(3, h // 3)
    out.rect_(1, 0, 3, neck, g[1])
    out.rect_(2, 0, 1, neck, g[2])
    out.rect_(0, neck, 5, h - neck, g[1])
    out.rect_(1, neck, 1, h - neck - 1, g[3])        # highlight
    out.rect_(3, neck, 1, h - neck, g[0])
    if label:
        out.rect_(0, neck + 2, 5, max(2, (h - neck) // 3), label)
    out = ink(out)
    if cork:
        out.px_(2, 0, cork)
    return out


def glass_cup(fill: str | None = None) -> Img:
    """A drinking glass, 4 × 5."""
    out = Img.new(4, 5)
    out.rect_(0, 0, 4, 5, '#b8c8cc')
    out.rect_(1, 1, 2, 3, '#e6f0f0')
    if fill:
        out.rect_(1, 2, 2, 2, fill)
    return ink(out)


def chair_back(r: list[str], seat: list[str] | None = None, w: int = 12, h: int = 17) -> Img:
    """A chair seen from behind (its back to the viewer): a tall backrest with the upholstered
    panel, the seat's edge peeking out on both sides, four legs."""
    out = Img.new(w, h)
    s = seat or r
    out.rect_(1, 7, w - 2, 4, s[2]); out.rect_(1, 7, w - 2, 1, s[3])          # seat edge
    out.rect_(2, 11, 2, h - 11, r[1]); out.rect_(w - 4, 11, 2, h - 11, r[0])  # back legs
    out.rect_(3, 11, 1, h - 12, r[2])
    out.rect_(1, 0, w - 2, 10, r[2])                                          # backrest frame
    out.rect_(1, 0, w - 2, 1, r[4]); out.rect_(1, 0, 1, 10, r[3])
    out.rect_(3, 2, w - 6, 6, s[2]); out.rect_(3, 2, w - 6, 1, s[4]); out.rect_(3, 7, w - 6, 1, s[1])
    return ink(out)


def stool_round(top: list[str], leg: list[str] = CHROME, h: int = 15) -> Img:
    """A bar stool: round padded seat (seen from above-front), a chrome pole, a foot ring, a disc base."""
    out = Img.new(10, h)
    out.ellipse_(5, h - 2, 4.5, 1.6, leg[1])
    out.rect_(4, 5, 2, h - 6, leg[2]); out.rect_(4, 5, 1, h - 6, leg[4])
    out.rect_(2, h - 7, 6, 1, leg[3])
    out.ellipse_(5, 3, 5, 3, top[1])
    out.ellipse_(5, 2.5, 4.5, 2.4, top[3])
    out.rect_(2, 1, 3, 1, top[4])
    return outline(out, INK)


def potted(leaves: str = 'ficus', pot: list[str] | None = None, h: int = 26, seed: int = 1) -> Img:
    """A house plant in a pot. ficus: glossy oval leaves on a stem; palm: arching fronds."""
    r = rng('plant', leaves, h, seed)
    w = 18
    out = Img.new(w, h)
    pr = pot or COPPER
    ph = 8
    lf = P['leaf'] + ['#a8c27a']
    if leaves == 'palm':
        cx, cy = 9, h - ph - 6
        out.rect_(8, cy, 2, ph + 6 - 2, P['wood'][2])
        for ang in (-160, -130, -100, -70, -40, -15, -195):
            a = math.radians(ang)
            for k in range(9):
                t = k / 8
                x = cx + math.cos(a) * 9 * t
                y = cy + math.sin(a) * 8 * t + 7 * t * t
                col = lf[3] if k < 5 else lf[2]
                out.rect_(int(x), int(y), 2, 1, col)
                if k > 1:
                    out.px_(int(x), int(y) + 1, lf[1])
    else:
        # ficus: a trunk and clusters of glossy leaves, lit from the upper left
        out.rect_(8, h - ph - 12, 2, 12, P['wood'][1])
        leaves_xy = []
        for _ in range(26):
            x = r.gauss(9, 3.6); y = r.gauss(h - ph - 13, 4.2)
            leaves_xy.append((x, y))
        leaves_xy.sort(key=lambda p: p[1])
        for x, y in leaves_xy:
            x = max(2, min(w - 3, x)); y = max(1, y)
            dark = x > 10 or y > h - ph - 10
            out.ellipse_(x, y, 2.1, 1.4, lf[1] if dark else lf[2])
            out.px_(int(x) - 1, int(y) - 1, lf[3] if not dark else lf[2])
        out.px_(5, 5, lf[4])
    out = outline(out, INK)
    # the pot (drawn after the outline so it keeps a crisp rim)
    pot_img = Img.new(12, ph)
    pot_img.poly_([(0, 0), (12, 0), (10, ph), (2, ph)], pr[2])
    pot_img.rect_(0, 0, 12, 2, pr[3]); pot_img.rect_(0, 0, 12, 1, pr[4])
    pot_img.rect_(1, 2, 1, ph - 3, pr[3]); pot_img.rect_(8, 2, 2, ph - 2, pr[1])
    pot_img = ink(pot_img)
    out.paste_(pot_img, 3 + 1, out.h - ph)
    return out


# -------------------------------------------------------------------------------- floor decals
def oriental_rug(w: int, h: int, field: list[str], border: list[str], accent: str, seed: int = 1,
                 fringe: str = '#d8ccb0') -> Img:
    """A knotted rug for the floor (a ground decal): fringe on the short ends, a double border
    with a zigzag, a field with a central medallion and corner pieces. Flat, no shading — it lies
    on the floor; the room's light does the rest."""
    out = Img.new(w, h)
    fr = 2
    out.rect_(0, fr, w, h - fr * 2, border[1])
    out.rect_(1, fr + 1, w - 2, h - fr * 2 - 2, border[2])
    # zigzag in the border
    for x in range(2, w - 2):
        y = fr + 2 + (x // 2) % 2
        out.px_(x, y, accent)
        out.px_(x, h - fr - 3 - (x // 2) % 2, accent)
    for y in range(fr + 2, h - fr - 2):
        out.px_(2 + (y // 2) % 2, y, accent)
        out.px_(w - 3 - (y // 2) % 2, y, accent)
    ix, iy, iw, ih = 5, fr + 5, w - 10, h - fr * 2 - 10
    out.rect_(ix - 1, iy - 1, iw + 2, ih + 2, border[0])
    out.rect_(ix, iy, iw, ih, field[2])
    # a lattice of little lozenges in the field
    for y in range(iy + 2, iy + ih - 1, 4):
        for x in range(ix + 2 + (y // 4) % 2 * 2, ix + iw - 1, 4):
            out.px_(x, y, field[1])
    # medallion
    cx, cy = w / 2, h / 2
    rx, ry = min(iw * 0.32, 14), min(ih * 0.36, 9)
    out.poly_([(cx, cy - ry), (cx + rx, cy), (cx, cy + ry), (cx - rx, cy)], border[1])
    out.poly_([(cx, cy - ry + 2), (cx + rx - 3, cy), (cx, cy + ry - 2), (cx - rx + 3, cy)], field[3])
    out.poly_([(cx, cy - ry + 4), (cx + rx - 6, cy), (cx, cy + ry - 4), (cx - rx + 6, cy)], accent)
    out.rect_(int(cx) - 1, int(cy) - 1, 2, 2, border[0])
    # corner pieces
    for (x, y) in ((ix + 1, iy + 1), (ix + iw - 5, iy + 1), (ix + 1, iy + ih - 5), (ix + iw - 5, iy + ih - 5)):
        out.rect_(x, y, 4, 4, border[1]); out.rect_(x + 1, y + 1, 2, 2, accent)
    # fringe
    for x in range(1, w - 1, 2):
        out.rect_(x, 0, 1, fr, fringe)
        out.rect_(x, h - fr, 1, fr, fringe)
    # wear: a few flecks of the field colour worn into the border, a darker walked-on middle
    r = rng('rug', w, h, seed)
    for _ in range(w * h // 90):
        out.px_(r.randrange(3, w - 3), r.randrange(fr + 3, h - fr - 3), field[1])
    return out


def runner(w: int, h: int, main: list[str], stripe: list[str], vertical: bool = True) -> Img:
    """The Soviet office runner (ковровая дорожка): red with two green stripes along each edge."""
    out = Img.new(w, h)
    out.rect_(0, 0, w, h, main[1])
    out.rect_(1, 0, w - 2, h, main[2])
    if vertical:
        for x in (2, w - 4):
            out.rect_(x, 0, 2, h, stripe[2]); out.rect_(x, 0, 1, h, stripe[3])
        for x in (5, w - 6):
            out.rect_(x, 0, 1, h, stripe[1])
        for y in range(3, h, 6):
            out.rect_(8, y, w - 16, 1, main[1])
    return out


def litter(g: Img, r, kind: str, n: int, box: tuple[int, int, int, int], alpha: float = 1.0) -> None:
    """Scatter small floor clutter into the ground picture `g` inside box (px x0, y0, x1, y1).
    kinds: butt (cigarette end), straw, paper, sawdust, coin, chip (casino), confetti, ash."""
    x0, y0, x1, y1 = box
    for _ in range(n):
        x, y = r.randrange(x0, x1), r.randrange(y0, y1)
        if kind == 'butt':
            g.rect_(x, y, 2, 1, '#e6ddc8', alpha); g.px_(x + 2, y, '#c07a48', alpha)
        elif kind == 'straw':
            c = r.choice(P['straw'][1:4])
            if r.random() < 0.5:
                g.rect_(x, y, r.randrange(2, 5), 1, c, alpha)
            else:
                g.line_(x, y, x + r.choice([-2, 2]), y + 1, c, alpha)
        elif kind == 'paper':
            g.rect_(x, y, 3, 2, P['paper'][2], alpha); g.px_(x + 2, y + 1, P['paper'][0], alpha)
        elif kind == 'sawdust':
            g.px_(x, y, r.choice([P['straw'][2], P['wood'][3], P['straw'][3]]), alpha * 0.8)
        elif kind == 'coin':
            g.rect_(x, y, 2, 1, BRASS[3], alpha); g.px_(x, y, BRASS[4], alpha)
        elif kind == 'chip':
            c = r.choice(['#b83a3a', '#2f5fa8', '#e8e2d0', '#2a2a30', '#3f8a4a'])
            g.rect_(x, y, 3, 2, c, alpha); g.px_(x + 1, y, '#f4efe0', alpha * 0.8)
        elif kind == 'confetti':
            g.px_(x, y, r.choice(['#ff5ec4', '#4fe8ff', '#f2d04a', '#7cf09a', '#f4efe0']), alpha)
        elif kind == 'ash':
            g.px_(x, y, '#2a2426', alpha * 0.5)
        elif kind == 'dust':
            g.px_(x, y, '#000000', alpha * 0.18)


# ------------------------------------------------------------------------------ neon lettering
# 5 × 7 tube letters, drawn as the tube's centre line; `tube_text` thickens nothing — a neon tube
# is one bright pixel with a hot core and a halo, the halo does the weight.
TUBE = {
    'К': ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
    'Л': ['..###', '.#..#', '.#..#', '.#..#', '.#..#', '#...#', '#...#'],
    'У': ['#...#', '#...#', '#...#', '.####', '....#', '...#.', '###..'],
    'Б': ['#####', '#....', '#....', '####.', '#...#', '#...#', '####.'],
    'А': ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
    'З': ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
    'И': ['#...#', '#...#', '#..##', '#.#.#', '##..#', '#...#', '#...#'],
    'Н': ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
    'О': ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    '7': ['#####', '....#', '...#.', '..#..', '..#..', '.#...', '.#...'],
    '♥': ['.#.#.', '#####', '#####', '#####', '.###.', '..#..', '.....'],
    '♠': ['..#..', '.###.', '#####', '#####', '#.#.#', '..#..', '.###.'],
    '♦': ['..#..', '.###.', '#####', '#####', '.###.', '..#..', '.....'],
    '♣': ['.###.', '.###.', '#####', '#####', '#.#.#', '..#..', '.###.'],
    ' ': ['.', '.', '.', '.', '.', '.', '.'],
}


def tube_text(s: str, ramp_: list[str], lit: bool = True, gap: int = 2) -> Img:
    """Neon lettering: each stroke pixel is the tube colour with a white-hot core where strokes
    are straight; unlit (a dead or flickering-off letter) is the dark glass tube."""
    w = sum(len(TUBE[c][0]) + gap for c in s) - gap
    out = Img.new(w, 7)
    x = 0
    for ch in s:
        g = TUBE[ch]
        for yy, row in enumerate(g):
            for xx, v in enumerate(row):
                if v == '#':
                    out.px_(x + xx, yy, (ramp_[3] if lit else ramp_[0]))
        x += len(g[0]) + gap
    if lit:
        # the hot core: pixels with a straight run through them turn near-white
        m = out.a[:, :, 3] > 0
        core = m & (np.roll(m, 1, 0) & np.roll(m, -1, 0) | np.roll(m, 1, 1) & np.roll(m, -1, 1))
        c = hexrgb(ramp_[4])
        out.a[core, 0], out.a[core, 1], out.a[core, 2] = c[0], c[1], c[2]
    return out


# Glyphs that read wrong in kit.FONT at 3 × 5 — «Д» there is an «А». These have a descender row
# (6 rows), which a sign has room for. Worth moving into kit.FONT.
GLYPH_FIX = {
    'Д': ['.##', '#.#', '#.#', '#.#', '###', '#.#'],
}


def sign_text(s: str, color: str, shadow: str | None = '#1a1212') -> Img:
    """kit.text with the fixed glyphs above: same 3-wide letters, one extra row for descenders."""
    from kit import FONT
    s = s.upper()
    glyphs = [GLYPH_FIX.get(ch) or (FONT.get(ch, FONT[' ']) + ['.' * len(FONT.get(ch, FONT[' '])[0])]) for ch in s]
    w = sum(len(g[0]) + 1 for g in glyphs) - 1
    out = Img.new(w + (1 if shadow else 0), 6 + (1 if shadow else 0))
    x = 0
    for g in glyphs:
        for yy, row in enumerate(g):
            for xx, v in enumerate(row):
                if v == '#':
                    if shadow:
                        out.px_(x + xx + 1, yy + 1, shadow)
                    out.px_(x + xx, yy, color)
        x += len(g[0]) + 1
    return out
