"""Shared art for the four shop interiors — tower, kennel, store, kiosk (v2.80).

Drawn in the same hand as `kit.py` (NA contour #141b1b, three to five tones, light from the upper
left, flat fills), but kept apart from it: kit.py belongs to whoever merges the square. If a piece
here turns out to be wanted by other rooms (candles, bottles, shelf units, posters, the straw
decal), it can move into kit.py as is — nothing here reaches into a map.

Conventions:
  * a function returns an `Img` (or a list of frames of one size for an animation);
  * `seed` picks the variant, the same seed gives the same picture;
  * accents that glow (flames, runes, neon) are painted AFTER `ink()`, so the contour does not
    swallow the light.
"""
from __future__ import annotations

import math

from kit import INK, P, ink, text
from lib import Img, grid, outline, ramp, rng

# ------------------------------------------------------------------------------ small light
WAX = ['#8f8266', '#c9bb98', '#e9dfc4', '#fbf4e2']      # candle wax, dark → light


def flame(frame: int, size: int = 1) -> Img:
    """A candle flame, 3 × 5 (size 1) or 5 × 8 (size 2): four frames of lean and height, a white
    core, orange skin. No contour — a flame is a light, not an object."""
    o, y, w = P['fire'][2], P['fire'][3], P['fire'][5]
    small = [
        ['.o.', '.y.', 'oyo', 'ywy', '.y.'],
        ['o..', '.y.', 'oyo', 'ywy', '.y.'],
        ['...', '.o.', 'oyo', 'ywy', '.y.'],
        ['..o', '.y.', 'oyo', 'ywy', '.y.'],
    ]
    big = [
        ['..o..', '..y..', '.oy..', '.yyo.', 'oywyo', 'ywwwy', '.ywy.', '..y..'],
        ['.o...', '.y...', '.oy..', '.yyo.', 'oywyo', 'ywwwy', '.ywy.', '..y..'],
        ['.....', '..o..', '..y..', '.oyo.', 'oywyo', 'ywwwy', '.ywy.', '..y..'],
        ['...o.', '...y.', '..yo.', '.oyy.', 'oywyo', 'ywwwy', '.ywy.', '..y..'],
    ]
    g = (small if size == 1 else big)[frame % 4]
    return grid(g, {'o': o, 'y': y, 'w': w})


def candle(frame: int, h: int = 6, lit: bool = True, drip: int = 0) -> Img:
    """One wax candle, 5 px wide (3 px of wax in a contour), h px of wax, flame on top.
    drip: 0 none, 1 a run down the left, 2 a run down the right."""
    out = Img.new(5, h + 7)
    top = 5
    out.rect_(0, top, 5, h + 2, INK)
    out.rect_(1, top + 1, 3, h, WAX[2])
    out.rect_(1, top + 1, 1, h, WAX[3])
    out.rect_(3, top + 1, 1, h, WAX[1])
    out.rect_(1, top + 1, 3, 1, WAX[3])
    if drip == 1:
        out.rect_(1, top + 1, 1, max(2, h // 2), '#ffffff')
    elif drip == 2:
        out.rect_(3, top + 1, 1, max(2, h // 2 + 1), WAX[2])
    out.px_(2, top, '#2a2020')                      # the wick
    if lit:
        out.paste_(flame(frame), 1, 0)
    return out


def candle_cluster(frame: int, spec: list[tuple[int, int]], w: int, h: int, puddle: bool = True) -> Img:
    """Several candles standing in their own wax: spec = [(x, height), …] left to right; each
    flickers a frame out of step with its neighbour so the cluster never pulses as one."""
    out = Img.new(w, h)
    if puddle:
        out.ellipse_(w / 2, h - 2.5, w / 2 - 0.5, 2.5, WAX[1])
        out.ellipse_(w / 2 - 0.5, h - 3, w / 2 - 2, 1.6, WAX[2])
    for i, (x, ch) in enumerate(spec):
        c = candle(frame + i * 2 + (i % 2), ch, drip=i % 3)
        out.paste_(c, x, h - c.h - 1)
    return out


def candelabra(frame: int) -> Img:
    """A standing iron candelabrum, 19 × 34: tripod feet, a twisted stem, three cups, three
    candles flickering out of step."""
    out = Img.new(19, 34)
    ir = P['iron']
    # feet
    out.line_(9, 28, 3, 33, ir[1]); out.line_(9, 28, 15, 33, ir[1]); out.rect_(8, 27, 3, 6, ir[2])
    out.rect_(2, 32, 3, 2, ir[2]); out.rect_(14, 32, 3, 2, ir[2])
    # stem with a twist every third pixel
    out.rect_(8, 13, 3, 16, ir[2]); out.rect_(8, 13, 1, 16, ir[3])
    for y in range(14, 28, 3):
        out.px_(10, y, ir[1]); out.px_(9, y + 1, ir[4])
    out.rect_(7, 20, 5, 2, ir[3])                                  # knop
    # the arms: a shallow U, cups at the ends and the middle
    out.rect_(2, 13, 15, 2, ir[2]); out.rect_(2, 13, 15, 1, ir[3])
    out.rect_(1, 11, 4, 3, ir[3]); out.rect_(7, 10, 5, 3, ir[3]); out.rect_(14, 11, 4, 3, ir[3])
    out = ink(out)
    for x, y, hh, k in ((1, 11, 5, 0), (7, 10, 7, 1), (14, 11, 4, 2)):
        c = candle(frame + k * 3, hh, drip=k % 2)
        cx = x + (2 if k != 1 else 2) - 1
        out.paste_(c, cx, y - c.h + 2)
    return out


def sconce(frame: int) -> Img:
    """A wall bracket with a candle, for a wall face (placed as an object so it flickers). 9 × 16."""
    out = Img.new(9, 16)
    ir = P['iron']
    out.rect_(3, 11, 3, 5, ir[2]); out.rect_(3, 11, 1, 5, ir[3])          # back plate
    out.rect_(1, 10, 7, 2, ir[3]); out.rect_(1, 11, 7, 1, ir[1])          # the dish
    out = ink(out)
    c = candle(frame, 4, drip=2)
    out.paste_(c, 2, 11 - c.h + 1)
    return out


# ------------------------------------------------------------------------------ glass and books
def bottle(kind: str, liquid: str, fill: float = 0.7, cork: str | None = None) -> Img:
    """A small glass vessel for shelves: 'flask' (round, 7 × 9), 'tall' (5 × 10), 'cone'
    (conical, 7 × 9), 'jar' (6 × 7, wide mouth), 'vial' (3 × 7). The liquid glows a touch
    (its top pixel is light), the glass has one white glint."""
    lq = ramp(liquid, 4, 0.5)
    glass = '#b9c9cc'
    cork = cork or P['wood'][3]
    if kind == 'flask':
        out = Img.new(7, 9)
        out.ellipse_(3.5, 5.5, 3.5, 3.5, glass)
        lvl = 9 - int(round(6 * fill))
        mask = Img.new(7, 9); mask.ellipse_(3.5, 5.5, 3.5, 3.5, '#ffffff')
        for yy in range(lvl, 9):
            for xx in range(7):
                if mask.a[yy, xx, 3]:
                    out.px_(xx, yy, lq[2] if xx < 4 else lq[1])
        out.rect_(2, 0, 3, 3, glass); out.rect_(2, 0, 3, 1, cork)
        out = ink(out)
        out.rect_(1, lvl, 5, 1, lq[3]) if lvl < 8 else None
        out.px_(2, 4, '#ffffff')
        out.rect_(2, 0, 3, 1, cork)
        return out
    if kind == 'tall':
        out = Img.new(5, 10)
        out.rect_(0, 3, 5, 7, glass); out.rect_(1, 0, 3, 4, glass)
        lvl = 10 - int(round(6 * fill))
        out.rect_(1, lvl, 3, 9 - lvl, lq[2]); out.rect_(3, lvl, 1, 9 - lvl, lq[1])
        out.rect_(1, 0, 3, 1, cork)
        out = ink(out)
        out.rect_(1, lvl, 3, 1, lq[3])
        out.px_(1, 4, '#ffffff')
        out.rect_(1, 0, 3, 1, cork)
        return out
    if kind == 'cone':
        out = Img.new(7, 9)
        out.poly_([(2, 2), (5, 2), (7, 9), (0, 9)], glass)
        out.rect_(2, 0, 3, 3, glass)
        lvl = 9 - int(round(5 * fill))
        for yy in range(lvl, 9):
            half = 1 + (yy - 2) * 2.5 / 7
            out.rect_(int(3.5 - half + 0.5), yy, int(half * 2), 1, lq[2])
        out = ink(out)
        out.rect_(2, lvl, 3, 1, lq[3])
        out.px_(2, 5, '#ffffff')
        out.rect_(2, 0, 3, 1, cork)
        return out
    if kind == 'jar':
        out = Img.new(6, 7)
        out.rect_(0, 1, 6, 6, glass)
        lvl = 7 - int(round(5 * fill))
        out.rect_(1, lvl, 4, 6 - lvl, lq[2]); out.rect_(4, lvl, 1, 6 - lvl, lq[1])
        out = ink(out)
        out.rect_(0, 0, 6, 2, cork); out.rect_(0, 0, 6, 1, ramp(cork, 3, 0.4)[2])
        out.rect_(1, lvl, 4, 1, lq[3]) if lvl < 6 else None
        out.px_(1, 3, '#ffffff')
        return ink_top(out)
    if kind == 'vial':
        out = Img.new(3, 7)
        out.rect_(0, 1, 3, 6, glass)
        out = ink(out)
        out.px_(1, 5, lq[2]); out.px_(1, 4, lq[3]); out.px_(1, 3, lq[3])
        out.px_(1, 0, cork)
        return out
    raise ValueError(kind)


def ink_top(img: Img) -> Img:
    """ink() again, used when a lid was painted over the contour."""
    return ink(img)


BOOK_TONES = ['#8a3a3a', '#3d5a7a', '#4e6b3c', '#7a5a2e', '#5c3f78', '#9a7a3a', '#2f4f55', '#6e2f2f',
              '#556070', '#7d6a50']


def books_row(w: int, h: int, seed: int = 1, tones: list[str] | None = None, lean: bool = True,
              gaps: bool = False) -> Img:
    """A row of book spines filling w px, the tallest h px, standing on the bottom row.
    Spines are 2–3 px with a light left edge, a dark right edge and sometimes a gilt band.
    With lean=True the last book leans on its neighbour; gaps=True leaves a hole or two."""
    r = rng('books', seed, w, h)
    tones = tones or BOOK_TONES
    out = Img.new(w, h)
    x = 0
    while x < w:
        if gaps and r.random() < 0.08 and x > 2:
            x += r.choice([2, 3]); continue
        bw = r.choice([2, 2, 3, 3, 3, 4])
        if x + bw > w:
            bw = w - x
            if bw < 2:
                break
        bh = r.randrange(max(3, h - 3), h + 1)
        c = ramp(r.choice(tones), 4, 0.42)
        y0 = h - bh
        out.rect_(x, y0, bw, bh, c[1])
        out.rect_(x, y0, 1, bh, c[2])
        if bw >= 3:
            out.rect_(x + 1, y0, bw - 2, bh, c[2])
            out.rect_(x, y0, 1, bh, c[3])
        out.rect_(x, y0, bw, 1, c[3])
        if r.random() < 0.45 and bh > 5:                          # a gilt band
            out.rect_(x, y0 + 2, bw, 1, P['gold'][3] if r.random() < 0.6 else c[3])
        out.rect_(x + bw - 1, y0, 1, bh, c[0])                  # dark right edge = the gap line
        x += bw
    if lean and w > 8:
        # knock out the last 3 px and lay a book leaning on the row
        out.rect_(w - 4, 0, 4, h, '#00000000')
        out.a[:, w - 4:, 3] = 0
        c = ramp(r.choice(tones), 4, 0.42)
        for i in range(h - 1):
            xx = w - 4 + (h - 1 - i) * 3 // max(1, h)
            out.rect_(xx, i + 1, 2, 1, c[2]); out.px_(xx + 2, i + 1, c[0])
    return out


def books_flat(n: int, w: int = 7, seed: int = 1) -> Img:
    """A stack of n books lying flat, seen from the front: 2 px slabs, pages showing cream."""
    r = rng('flat', seed, n, w)
    out = Img.new(w + 2, n * 2 + 1)
    for i in range(n):
        y = out.h - 2 - i * 2
        c = ramp(r.choice(BOOK_TONES), 4, 0.42)
        ww = w - r.randrange(0, 3)
        xx = r.randrange(0, w - ww + 2)
        out.rect_(xx, y - 1, ww, 2, c[2]); out.rect_(xx, y - 1, ww, 1, c[3])
        out.rect_(xx + ww - 2, y - 1, 2, 2, P['paper'][2])      # page edges
    return outline(out, INK).crop(1, 0, out.w, out.h + 2)


def skull() -> Img:
    """A small skull for a shelf, 7 × 6, facing us."""
    g = ['.kkkkk.', 'k34443k', 'k4k4k3k', 'k34443k', '.k3k3k.', '..kkk..']
    return grid(g, {'k': INK, '3': '#b9ae96', '4': '#e2d8c0'})


def bookcase(w: int = 32, h: int = 46, shelves: int = 4, seed: int = 1, extras: tuple = ('skull', 'jar'),
             mat: str = 'wood', top_items: bool = True) -> Img:
    """A tall bookcase, crammed: a wooden carcass lit from the left, a dark back, `shelves`
    compartments of spines — some rows with a skull, a jar or a flat stack pushed in among the
    books — and more books stacked on top."""
    r = rng('bookcase', seed, w, h)
    c = P[mat]
    top_h = 4
    base_h = 4
    out = Img.new(w, h)
    body_y = 6 if top_items else 0
    out.rect_(0, body_y, w, h - body_y, c[2])
    out.rect_(0, body_y, w, top_h, c[3]); out.rect_(0, body_y, w, 1, c[4])       # top board, seen from above
    out.rect_(0, body_y + top_h, 2, h - body_y - top_h, c[3])                      # lit left post
    out.rect_(w - 2, body_y + top_h, 2, h - body_y - top_h, c[1])                  # shaded right post
    inner_x, inner_w = 2, w - 4
    y0 = body_y + top_h
    y1 = h - base_h
    out.rect_(0, y1, w, base_h, c[1]); out.rect_(0, y1, w, 1, c[2])               # plinth
    out.rect_(3, y1 + 2, w - 6, 1, c[0])
    comp = (y1 - y0) / shelves
    items = list(extras)
    for s in range(shelves):
        a = int(round(y0 + s * comp)); b = int(round(y0 + (s + 1) * comp))
        ch = b - a - 2                                                            # compartment height
        out.rect_(inner_x, a, inner_w, ch, '#241815')                             # dark back
        out.rect_(inner_x, a, inner_w, 1, '#120c0b')                              # shadow under the shelf
        row = books_row(inner_w, ch - 1, seed * 31 + s, lean=(s % 2 == 0), gaps=True)
        out.paste_(row, inner_x, a + 1)
        # push a thing in among the books
        if items and r.random() < 0.8:
            it = items.pop(0)
            thing = skull() if it == 'skull' else bottle('jar', r.choice(['#6ba34a', '#a8323b', '#6b3fa0']), 0.8) if it == 'jar' \
                else books_flat(2, 6, seed + s) if it == 'flat' else bottle('flask', '#9a6be0', 0.6) if it == 'flask' \
                else candle(0, 3, lit=False) if it == 'candle' else None
            if thing is not None and thing.h <= ch:
                tx = inner_x + r.randrange(2, max(3, inner_w - thing.w - 2))
                out.rect_(tx - 1, a + 1, thing.w + 2, ch - 1, '#241815')
                out.paste_(thing, tx, a + ch - thing.h)
        out.rect_(0, b - 2, w, 2, c[2]); out.rect_(0, b - 2, w, 1, c[3])         # the shelf board
    out = ink(out)
    if top_items:
        st = books_flat(3, 9, seed)
        out.paste_(st, 3, body_y - st.h + 2)
        if r.random() < 0.7:
            st2 = books_flat(2, 6, seed + 7)
            out.paste_(st2, w - st2.w - 3, body_y - st2.h + 2)
    return out


# --------------------------------------------------------------------------------- shelving
def shelf_unit(w: int, h: int, rows: list[list[Img]], mat: str = 'wood', back: str = '#2a1d19',
               top_row: list[Img] | None = None, legs: int = 3, seed: int = 1) -> Img:
    """A standing open shelf: carcass lit from the left, len(rows) shelves, each row's things
    stood on its board left to right with 1 px between (overflow is dropped). top_row stands on
    the top board. For stores, pantries and the potion rack."""
    c = P[mat] if mat in P else ramp(mat, 5, 0.6)
    n = len(rows)
    top_h = 3
    top_extra = max((i.h for i in top_row), default=0) - 1 if top_row else 0
    out = Img.new(w, h)
    by = top_extra
    out.rect_(0, by, w, h - by, c[2])
    out.rect_(0, by, w, top_h, c[3]); out.rect_(0, by, w, 1, c[4])
    out.rect_(0, by + top_h, 2, h - by - top_h, c[3]); out.rect_(w - 2, by + top_h, 2, h - by - top_h, c[1])
    y0 = by + top_h
    y1 = h - legs
    comp = (y1 - y0) / n
    spots = []
    for s in range(n):
        a = int(round(y0 + s * comp)); b = int(round(y0 + (s + 1) * comp))
        out.rect_(2, a, w - 4, b - a - 2, back)
        out.rect_(2, a, w - 4, 1, '#0f0a0a')
        out.rect_(0, b - 2, w, 2, c[2]); out.rect_(0, b - 2, w, 1, c[3])
        spots.append((a, b - 2))
    if legs:
        out.rect_(0, y1, w, legs, '#00000000'); out.a[y1:, :, 3] = 0
        out.rect_(0, y1, 2, legs, c[2]); out.rect_(w - 2, y1, 2, legs, c[1])
    out = ink(out)
    for (a, b), items in zip(spots, rows):
        x = 3
        for it in items:
            if x + it.w > w - 3:
                break
            out.paste_(it, x, b - it.h)
            x += it.w + 1
    if top_row:
        x = 2
        for it in top_row:
            if x + it.w > w - 1:
                break
            out.paste_(it, x, by + 2 - it.h + 1)
            x += it.w + 1
    return out


# ------------------------------------------------------------------------------- wall things
def poster(w: int, h: int, bg: str, art: Img | None = None, title: str = '', title_c: str = '#f2e6c8',
           price: str = '', torn: bool = False, seed: int = 1) -> Img:
    """A paper poster for a wall face: a coloured sheet with a light band, a picture, a title in
    the 3 × 5 font and a price tag; tape or a pin at the top. torn=True curls a corner."""
    c = ramp(bg, 4, 0.4)
    out = Img.new(w, h)
    out.rect_(0, 0, w, h, c[2])
    out.rect_(0, 0, w, 1, c[3])
    out.rect_(0, h - 1, w, 1, c[1])
    if art is not None:
        out.paste_(art, (w - art.w) // 2, 2 if not title else 8)
    if title:
        t = text(title, title_c, None)
        out.paste_(t, (w - t.w) // 2, 2)
    if price:
        t = text(price, '#1a1212', None)
        tag = Img.new(t.w + 4, 7, '#f0d060')
        tag.paste_(t, 2, 1)
        tag = ink(tag)
        out.paste_(tag, w - tag.w - 1, h - tag.h - 1)
    out = ink(out)
    if torn:
        out.poly_([(w - 4, h), (w, h - 4), (w, h)], '#00000000')
        out.a[h - 3:, w - 3:, 3] = 0
        out.px_(w - 3, h - 1, c[3]); out.px_(w - 1, h - 3, c[3]); out.px_(w - 2, h - 2, c[1])
    out.rect_(w // 2 - 1, 0, 3, 1, '#d8d0b0')                          # tape
    return out


def rope_coil(color: str = '#a8905e') -> Img:
    """A coil of rope lying on the floor, 18 × 12: three turns drawn as separate rings with dark
    gaps between them and a twist (light dashes slanting one way) on every turn, the loose end
    trailing off. Filled ellipses in near tones read as a pie — the gaps make it rope."""
    c = ramp(color, 4, 0.45)
    out = Img.new(18, 12)
    cx, cy = 8.5, 6
    for k, (rx, ry) in enumerate(((8.5, 5.5), (6.2, 3.9), (4, 2.4))):
        for i in range(int(rx * 9)):
            a = i * 2 * math.pi / int(rx * 9)
            x, y = cx + rx * math.cos(a), cy + ry * math.sin(a)
            out.px_(int(x), int(y), c[2]); out.px_(int(x), int(y) + 1, c[1])
            if i % 3 == 0:
                out.px_(int(x), int(y), c[3])
    out.ellipse_(cx, cy + 0.5, 2, 1, '#3a2c20')
    out = outline(out, INK)
    for x in range(14, 20):
        out.px_(x, 10 + (x - 14) // 3, c[2])
        out.px_(x, 11 + (x - 14) // 3, INK)
    return out.crop(0, 0, 20, 14)


def ladder(h: int, w: int = 12, mat: str = 'wood') -> Img:
    """A wooden ladder leaning against a wall: two rails, rungs every 5 px."""
    c = P[mat]
    out = Img.new(w, h)
    out.rect_(0, 0, 2, h, c[3]); out.rect_(w - 2, 0, 2, h, c[1])
    for y in range(3, h - 1, 5):
        out.rect_(2, y, w - 4, 2, c[2]); out.rect_(2, y, w - 4, 1, c[3])
    out = ink(out)
    return out


def straw_decal(w: int, h: int, seed: int = 1, density: float = 0.08, tone: str = 'straw') -> Img:
    """Loose straw strewn on a floor: short diagonal stalks in three shades, thicker toward the
    middle of the patch (for m.stamp on the ground)."""
    r = rng('straw', seed, w, h)
    c = P[tone]
    out = Img.new(w, h)
    n = int(w * h * density / 3)
    for _ in range(n):
        x = r.gauss(w / 2, w / 3.2); y = r.gauss(h / 2, h / 3.2)
        if not (0 <= x < w and 0 <= y < h):
            continue
        L = r.randrange(2, 5)
        dx, dy = r.choice([(1, 0), (1, 1), (1, -1), (2, 1), (1, 2)])
        col = c[r.choice([1, 2, 2, 3, 3, 4])]
        for k in range(L):
            out.px_(int(x + dx * k * 0.6), int(y + dy * k * 0.6), col)
    return out


def dust_decal(w: int, h: int, seed: int = 1, color: str = '#000000', alpha: float = 0.18, n: int = 40) -> Img:
    """Soft dirt: small blobs of a colour at low alpha, for wear by doors and under counters."""
    r = rng('dust', seed, w, h)
    out = Img.new(w, h)
    for _ in range(n):
        x, y = r.uniform(0, w), r.uniform(0, h)
        rr = r.uniform(1, 3.5)
        out.ellipse_(x, y, rr, rr * 0.6, color, alpha)
    return out


def shadow(w: int, h: int, alpha: float = 0.3) -> Img:
    """A contact shadow ellipse to stamp on the ground under a free-standing thing."""
    out = Img.new(w, h)
    out.ellipse_(w / 2, h / 2, w / 2, h / 2, '#000000', alpha)
    return out


def hang_lamp(frame: int = 0, cord: int = 18, shade: str = 'tin', bulb: str = '#fff1c2', glow: str | None = None) -> Img:
    """A lamp on a cord (layer='top'): a conical shade and a bulb; glow paints a warm halo under
    the shade (heat lamp: red). frame shifts the halo a pixel — a slow breathing."""
    c = P[shade] if shade in P else ramp(shade, 5, 0.6)
    out = Img.new(13, cord + 9)
    out.rect_(6, 0, 1, cord, '#2a2426')
    y = cord
    out.poly_([(4, y), (9, y), (13, y + 5), (0, y + 5)], c[3])
    out.poly_([(4, y), (6, y), (3, y + 5), (0, y + 5)], c[4])
    out.rect_(0, y + 4, 13, 1, c[1])
    out = ink(out)
    out.rect_(6, 0, 1, cord, '#2a2426')
    if glow:
        out.ellipse_(6.5, y + 6.5, 5 + frame % 2, 2.2, glow, 0.35)
    out.rect_(5, y + 5, 3, 2, bulb)
    out.px_(6, y + 6, '#ffffff')
    return out


# ------------------------------------------------------------------------------------- animals
CAT_COATS = {
    'smoke': ['#23222c', '#3a3a48', '#565869', '#7c7f90', '#a9adbb'],   # grey-blue, reads on dark floors
    'ginger': ['#5a2c16', '#8f4a22', '#c06f35', '#e0985a', '#f4c48c'],
    'white': ['#6b6660', '#9d978c', '#c9c3b6', '#e6e0d2', '#fbf7ee'],
}


def cat_asleep(frame: int, coat: str = 'smoke', cushion: str | None = '#6b3fa0') -> Img:
    """A cat curled asleep, head on its paws, tail wrapped round with a light tip; frame 0/1
    breathes (the back rises a pixel). On a round cushion unless cushion=None. 21 × 15.
    What makes it a cat at this size: two pointed ears standing clear of the body, a closed-eye
    line in a LIGHT colour, and the tail as a separate curve — a dark oval alone is a stone."""
    c = CAT_COATS[coat]
    out = Img.new(20, 14)
    if cushion:
        cu = ramp(cushion, 4, 0.4)
        out.ellipse_(10, 10.5, 9.5, 3.4, cu[1]); out.ellipse_(9.5, 10, 8.5, 2.6, cu[2])
        out.rect_(4, 9, 9, 1, cu[3])
    b = frame % 2
    # the body: a bean, back to the upper right
    out.ellipse_(11.5, 8 - b * 0.5, 6.5, 3.6 + b * 0.4, c[1])
    out.ellipse_(11, 7.3 - b * 0.5, 5.4, 2.6 + b * 0.3, c[2])
    out.rect_(9, 5 - b, 5, 1, c[3])                                              # light along the spine
    # the head, left, resting low
    out.ellipse_(5.5, 8.3, 3.4, 2.8, c[2])
    out.ellipse_(5, 7.8, 2.4, 1.8, c[3])
    out.poly_([(3, 7), (3.5, 3.5), (5.5, 6)], c[2])                             # ears
    out.poly_([(6, 6), (7.5, 3.5), (8.5, 7)], c[2])
    out.px_(4, 5, '#d08a8a'); out.px_(7, 5, '#d08a8a')                           # inner ear
    # the tail round the front, light tip under the chin
    out.line_(16, 10, 11, 11, c[2]); out.line_(11, 11, 6, 11, c[3]); out.px_(5, 11, c[4]); out.px_(4, 10, c[4])
    if coat == 'ginger':
        # tabby stripes over the back and a cream chin: without them a ginger curl is a bread roll
        for x in (10, 13, 16):
            out.line_(x, 5 - b + (x == 16), x - 1, 8 - b, c[1])
        out.px_(4, 6, c[1]); out.px_(6, 6, c[1])
        out.rect_(3, 10, 3, 1, '#f6e6c8')
    out = outline(out, INK)
    out.rect_(4, 9, 2, 1, c[4] if coat != 'white' else c[1])                    # the closed eye, light
    out.px_(6, 10, '#e0a0a0')                                                     # nose
    if cushion:
        out.px_(11, 14, P['gold'][3])                                             # a tassel
    return out
