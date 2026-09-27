"""The camp's hand: palette, materials, interior shells and common furniture (v2.80).

Everything drawn here is drawn the way Ninja Adventure draws: a 1 px contour in NA's ink
(#141b1b), three to four shades per material with the light from the upper left, flat colour
without dithering noise, and small chunky details (a nail is one pixel, a brick 8×4).

The interiors are seen like every top-down RPG room: the NORTH wall shows its face (two tiles of
brick, plaster or planks, with things hung on it), the other three walls are only their thick
caps, and the room's exit is a gap in the south cap with a mat before it.
"""
from __future__ import annotations

import math

import numpy as np

from lib import (T, Img, Map, camp, grid, hexrgb, kenney, na, noise2, outline, ramp, rng, tiles)

INK = '#141b1b'

# ------------------------------------------------------------------------------------ palette
# Ramps dark → light. Hand-picked for the camp: dusty, a little cold in the shade, warm in the
# light; accents (fire, glow, gems, paint) are saturated and rare.
P = {
    'ink': INK,
    'void': '#0e0a0c',
    'stone': ['#3b3643', '#56505a', '#7a7278', '#9d958f', '#c2b9ad'],
    'concrete': ['#4a4c4d', '#666967', '#8a8c86', '#aaaba2', '#c9c8bd'],
    'wood': ['#3e2a24', '#5c3d2e', '#7d5539', '#9f7249', '#c39a67'],
    'woodgrey': ['#3a3432', '#56504b', '#766e66', '#968c80', '#b6ab9c'],
    'brick': ['#4a2522', '#6e3629', '#8f4a35', '#ae6547', '#c9876a'],
    'plaster': ['#6f6655', '#8e846f', '#aea38a', '#cbc1a6', '#e3dac2'],
    'slate': ['#2f353d', '#454e57', '#5e6972', '#7c878c', '#a1aaaa'],
    'tin': ['#2c3530', '#3e4b42', '#56634d', '#728264', '#93a184'],
    'rust': ['#4a2218', '#6b3222', '#8f4526', '#b4633a', '#cf8a57'],
    'iron': ['#1f2226', '#34383e', '#4d5259', '#6c727a', '#959ba2'],
    'cloth': ['#262c38', '#3a4356', '#556178', '#76839b', '#a2adc0'],
    'coal': ['#141417', '#212126', '#34343b', '#4d4d56'],
    'straw': ['#6e5a2c', '#937a3c', '#b89d52', '#d7bf73', '#eedc9a'],
    'leaf': ['#2c3a26', '#3e5234', '#566d44', '#728c55', '#94ab6c'],
    'dirt': ['#4a3a2c', '#65503b', '#806a4f', '#9c8566', '#b8a282'],
    'fire': ['#8f2a14', '#d4491c', '#ff7a2a', '#ffb347', '#ffe08a', '#fff6d0'],
    'glow': '#ffc86a',
    'violet': ['#2a1a3e', '#452a66', '#6b3fa0', '#9a6be0', '#c9a6ff'],
    'gold': ['#5e4212', '#8f6a1c', '#c2952a', '#e8c14e', '#fbe594'],
    'red': ['#4a1418', '#76222a', '#a8323b', '#d0504f', '#ec8577'],
    'green': ['#1f3322', '#2f4f33', '#437048', '#5e9360', '#8ab884'],
    'paper': ['#8f8672', '#b5ab93', '#d6ccb3', '#eee6d1'],
}


def shade(name: str, i: int) -> str:
    r = P[name]
    return r[max(0, min(len(r) - 1, i))]


# ------------------------------------------------------------------------------- materials
def texture(kind: str, w: int, h: int, seed: int = 1) -> Img:
    """A wall material filling w × h px. Light from the upper left: every block has a light top
    row, a dark bottom row and a mortar/gap line."""
    r = rng('tex', kind, w, h, seed)
    out = Img.new(w, h)
    if kind == 'brick' or kind == 'brickgrey':
        ramp_ = P['brick'] if kind == 'brick' else P['stone']
        mortar = '#4a3a34' if kind == 'brick' else '#2e2a31'
        out.rect_(0, 0, w, h, mortar)
        bw, bh = 8, 4
        for row in range(-1, h // bh + 1):
            off = (row % 2) * (bw // 2)
            for col in range(-1, w // bw + 2):
                x, y = col * bw - off, row * bh
                k = r.random()
                base = 2 if k < 0.6 else (1 if k < 0.8 else 3)
                out.rect_(x, y, bw - 1, bh - 1, ramp_[base])
                out.rect_(x, y, bw - 1, 1, ramp_[min(4, base + 1)])
                if r.random() < 0.12:
                    out.px_(x + r.randrange(1, bw - 2), y + r.randrange(1, bh - 1), ramp_[max(0, base - 1)])
        return out
    if kind == 'stone':
        out.rect_(0, 0, w, h, P['stone'][0])
        y = 0
        row = 0
        while y < h:
            bh = r.choice([5, 6, 6, 7])
            x = -r.randrange(0, 6)
            while x < w:
                bw = r.choice([7, 8, 9, 10, 11])
                base = r.choice([2, 2, 3, 1, 2])
                c = P['stone']
                out.rect_(x + 1, y + 1, bw - 1, bh - 1, c[base])
                out.rect_(x + 1, y + 1, bw - 1, 1, c[min(4, base + 1)])
                out.rect_(x + 1, y + 1, 1, bh - 1, c[min(4, base + 1)])
                out.rect_(x + 1, y + bh - 1, bw - 1, 1, c[max(0, base - 1)])
                # rounded corners: knock the corner pixels to mortar
                for cx, cy in ((x + 1, y + 1), (x + bw - 1, y + 1), (x + 1, y + bh - 1), (x + bw - 1, y + bh - 1)):
                    out.px_(cx, cy, c[0])
                x += bw
            y += bh
            row += 1
        return out
    if kind in ('planks', 'plankgrey'):
        c = P['wood'] if kind == 'planks' else P['woodgrey']
        pw = 5
        for i, x in enumerate(range(0, w, pw)):
            base = r.choice([2, 2, 3, 1])
            out.rect_(x, 0, pw, h, c[base])
            out.rect_(x, 0, 1, h, c[min(4, base + 1)])
            out.rect_(x + pw - 1, 0, 1, h, c[0])
            # grain and knots
            for _ in range(max(1, h // 10)):
                gy = r.randrange(0, max(1, h - 4))
                out.rect_(x + 2, gy, 1, r.randrange(2, 5), c[max(0, base - 1)])
            for ny in (2, h - 3):
                if 0 <= ny < h:
                    out.px_(x + 2, ny, c[0])
        return out
    if kind == 'logs':
        c = P['wood']
        lh = 6
        for i, y in enumerate(range(0, h, lh)):
            base = r.choice([2, 3, 2, 1])
            out.rect_(0, y, w, lh, c[base])
            out.rect_(0, y, w, 1, c[min(4, base + 1)])
            out.rect_(0, y + lh - 1, w, 1, c[0])
            out.rect_(0, y + lh - 2, w, 1, c[max(0, base - 1)])
        return out
    if kind == 'plaster':
        c = P['plaster']
        out.rect_(0, 0, w, h, c[3])
        # stains from the ceiling, bald patches with brick showing
        for _ in range(max(1, w * h // 900)):
            px, py = r.randrange(0, w), r.randrange(0, h)
            pw, ph = r.randrange(6, 14), r.randrange(4, 8)
            patch = texture('brick', pw, ph, r.randrange(1000))
            m = Img.new(pw, ph)
            m.ellipse_(pw / 2, ph / 2, pw / 2, ph / 2, '#ffffff')
            patch.a[:, :, 3] = m.a[:, :, 3]
            out.paste_(patch, px, py)
            out.ellipse_(px + pw / 2, py + ph / 2, pw / 2 + 0.6, ph / 2 + 0.6, c[1], 0.35)
        for _ in range(max(1, w // 20)):
            x = r.randrange(0, w)
            out.rect_(x, 0, r.randrange(2, 5), r.randrange(h // 3, h), c[2], 0.5)
        for _ in range(max(1, w * h // 700)):
            x, y = r.randrange(0, w), r.randrange(0, h)
            for k in range(r.randrange(3, 7)):
                out.px_(x, y, c[1])
                x += r.choice([-1, 0, 1])
                y += 1
        return out
    if kind == 'concrete':
        c = P['concrete']
        out.rect_(0, 0, w, h, c[2])
        pw, ph = 24, 12
        for x in range(0, w, pw):
            out.rect_(x, 0, 1, h, c[0])
            out.rect_(x + 1, 0, 1, h, c[3])
        for y in range(0, h, ph):
            out.rect_(0, y, w, 1, c[0])
            out.rect_(0, y + 1, w, 1, c[3])
        for _ in range(max(1, w * h // 500)):
            x, y = r.randrange(0, w), r.randrange(0, h)
            out.px_(x, y, c[1])
        for _ in range(max(1, w // 24)):
            x = r.randrange(0, w)
            out.rect_(x, r.randrange(0, h // 2), 1, r.randrange(3, 8), '#6b3a26', 0.6)
        return out
    if kind == 'tin':  # corrugated sheet, vertical ridges
        c = P['tin']
        for x in range(w):
            k = x % 4
            out.rect_(x, 0, 1, h, c[[3, 2, 1, 2][k]])
        for _ in range(max(1, w * h // 400)):
            x, y = r.randrange(0, w), r.randrange(0, h)
            rw = r.randrange(2, 5)
            out.rect_(x, y, rw, r.randrange(2, 4), P['rust'][r.randrange(1, 4)], 0.8)
        return out
    raise ValueError(kind)


# NA interior floors: seamless variants of each pattern (column, row in TilesetInteriorFloor),
# graded into the camp. A room picks among them by hash, so no two neighbours repeat.
NA_FLOORS = {
    'na-dark': [(c, r) for c in (16, 17, 19) for r in (13, 14, 15)],   # dark cobble: forge, lift
    'na-sand': [(c, r) for c in (5, 6, 8) for r in (13, 14, 15)],     # tan cobble: stores, office
    'na-tan': [(c, r) for c in (16, 17, 18) for r in (1, 2)],            # tan ornate: tower
    'na-green': [(c, r) for c in (16, 17, 18) for r in (7, 8)],          # green stone: special shaft
}


def floor_tile(kind: str, tx: int, ty: int, seed: int = 1) -> Img:
    """One 16 px floor tile. Neighbours differ by hash, so a room isn't wallpaper."""
    r = rng('floor', kind, tx, ty, seed)
    if kind in NA_FLOORS:
        c, rr = r.choice(NA_FLOORS[kind])
        return camp(tiles(na('Backgrounds/Tilesets/Interior/TilesetInteriorFloor.png'), c, rr), sat=0.6)
    out = Img.new(T, T)
    if kind == 'slab':  # stone flags, a tile each, irregular joints
        c = P['stone']
        out.rect_(0, 0, T, T, c[0])
        base = r.choice([1, 2, 2, 2, 3])
        out.rect_(1, 1, T - 1, T - 1, c[base])
        out.rect_(1, 1, T - 2, 1, c[min(4, base + 1)])
        out.rect_(1, T - 1, T - 1, 1, c[max(0, base - 1)])
        for _ in range(r.randrange(1, 4)):
            out.px_(r.randrange(2, T - 2), r.randrange(2, T - 2), c[max(0, base - 1)])
        if r.random() < 0.25:  # a crack
            x, y = r.randrange(3, 12), r.randrange(3, 12)
            for k in range(r.randrange(3, 6)):
                out.px_(x, y, c[0])
                x += r.choice([1, 1, 0]); y += r.choice([-1, 1, 0])
        return out
    if kind == 'planks':  # floor boards across the room, staggered ends
        c = P['wood']
        for i in range(4):
            y = i * 4
            base = r.choice([2, 2, 3, 1])
            out.rect_(0, y, T, 4, c[base])
            out.rect_(0, y, T, 1, c[min(4, base + 1)])
            out.rect_(0, y + 3, T, 1, c[0])
            end = (tx * 7 + ty * 3 + i * 5) % 16
            out.rect_(end, y, 1, 4, c[0])
            if r.random() < 0.3:
                out.px_(r.randrange(1, 15), y + 2, c[max(0, base - 1)])
        return out
    if kind == 'dirt':
        c = P['dirt']
        out.rect_(0, 0, T, T, c[2])
        for y in range(T):
            for x in range(T):
                n = noise2((tx * T + x) / 7, (ty * T + y) / 7, seed)
                if n < 0.3:
                    out.px_(x, y, c[1])
                elif n > 0.78:
                    out.px_(x, y, c[3])
        for _ in range(r.randrange(2, 6)):
            out.px_(r.randrange(0, T), r.randrange(0, T), c[0])
        return out
    if kind == 'tiles':  # worn linoleum checker, the Soviet office floor
        a, b = '#8b7f68', '#6f6553'
        for y in range(0, T, 8):
            for x in range(0, T, 8):
                out.rect_(x, y, 8, 8, a if ((x + y) // 8 + tx + ty) % 2 else b)
        for _ in range(r.randrange(0, 3)):
            out.px_(r.randrange(0, T), r.randrange(0, T), '#5a5244')
        return out
    if kind == 'concrete':
        c = P['concrete']
        out.rect_(0, 0, T, T, c[2])
        for y in range(T):
            for x in range(T):
                n = noise2((tx * T + x) / 5, (ty * T + y) / 5, seed + 3)
                if n < 0.22:
                    out.px_(x, y, c[1])
                elif n > 0.85:
                    out.px_(x, y, c[3])
        if tx % 3 == 0:
            out.rect_(0, 0, 1, T, c[1])
        if ty % 3 == 0:
            out.rect_(0, 0, T, 1, c[1])
        return out
    raise ValueError(kind)


# ------------------------------------------------------------------------ interior shells
def cap_color(wall: str) -> list[str]:
    return {
        'brick': ['#1d1516', '#3a2826', '#57403a'],
        'stone': ['#161418', '#2e2a31', '#4a4450'],
        'planks': ['#1a1311', '#35261f', '#54402f'],
        'plaster': ['#1c1917', '#3b3630', '#5d564a'],
        'concrete': ['#171818', '#333533', '#545650'],
        'logs': ['#1a1311', '#35261f', '#54402f'],
    }.get(wall, ['#161418', '#2e2a31', '#4a4450'])


def shell(m: Map, wall: str, floor: str, face: int = 2, door: tuple[int, int] | None = None,
          out_to: str = 'square', out_at: str = '', floor_seed: int = 1) -> None:
    """Room box: floor, north wall face (face tiles tall under a one-tile cap), side and south caps,
    exit gap in the south cap at door = (tile x, width). Collision and the exit door included.
    Spawn 'in' is on the mat, facing up."""
    w, h = m.w, m.h
    # floor
    m.fill_tiles(lambda x, y: floor_tile(floor, x, y, floor_seed), 1, 1 + face, w - 1, h - 1)
    # north wall face
    tex = texture(wall, (w - 2) * T, face * T, floor_seed + 7)
    m.stamp(tex, T, T)
    fx0, fy0, fw, fh = T, T, (w - 2) * T, face * T
    # shadow under the cap, baseboard and the floor's contact shadow
    m.ground.rect_(fx0, fy0, fw, 2, '#000000', 0.35)
    m.ground.rect_(fx0, fy0 + fh - 3, fw, 3, P['wood'][0])
    m.ground.rect_(fx0, fy0 + fh - 3, fw, 1, P['wood'][2])
    m.ground.rect_(fx0, fy0 + fh, fw, 3, '#000000', 0.28)
    m.ground.rect_(fx0, fy0 + fh + 3, fw, 2, '#000000', 0.12)
    # ambient occlusion along the side caps
    m.ground.rect_(T, fy0, 3, (h - 1) * T - fy0, '#000000', 0.22)
    m.ground.rect_((w - 1) * T - 3, fy0, 3, (h - 1) * T - fy0, '#000000', 0.22)
    # caps
    c = cap_color(wall)
    def cap(x, y, cw, ch):
        m.ground.rect_(x, y, cw, ch, c[1])
    cap(0, 0, w * T, T)
    cap(0, 0, T, h * T)
    cap((w - 1) * T, 0, T, h * T)
    dx, dw = door if door else (w // 2 - 1, 2)
    cap(0, (h - 1) * T, dx * T, T)
    cap((dx + dw) * T, (h - 1) * T, (w - dx - dw) * T, T)
    # the cap's lit rim facing the room and its dark outer edge
    g = m.ground
    g.rect_(T - 2, T - 2, (w - 2) * T + 4, 2, c[2])                 # north rim (over the face)
    g.rect_(T - 2, T, 2, (h - 2) * T + 2, c[2])                     # west rim
    g.rect_((w - 1) * T, T, 2, (h - 2) * T + 2, c[0])               # east rim is in shade
    g.rect_(T, (h - 1) * T, dx * T - T, 2, c[2])
    g.rect_((dx + dw) * T, (h - 1) * T, (w - dx - dw - 1) * T, 2, c[2])
    for x0, y0, x1, y1 in ((0, 0, w * T, 1), (0, 0, 1, h * T), (w * T - 1, 0, w * T, h * T), (0, h * T - 1, w * T, h * T)):
        g.rect_(x0, y0, x1 - x0, y1 - y0, INK)
    # the doorway: dark jambs and the mat
    g.rect_(dx * T - 2, (h - 1) * T, 2, T, INK)
    g.rect_((dx + dw) * T, (h - 1) * T, 2, T, INK)
    g.rect_(dx * T, (h - 1) * T, dw * T, T, '#0b0809')
    mat = Img.new(dw * T - 6, 10)
    mat.rect_(0, 0, mat.w, mat.h, '#5c3a2c')
    for y in range(1, mat.h - 1, 2):
        mat.rect_(1, y, mat.w - 2, 1, '#7a4f38')
    mat = outline(mat, INK)
    m.stamp(mat, dx * T + 2, (h - 2) * T + 4)
    # collision
    m.block(0, 0, w, 1 + face)
    m.block(0, 0, 1, h)
    m.block(w - 1, 0, w, h)
    m.block(0, h - 1, dx, h)
    m.block(dx + dw, h - 1, w, h)
    m.door(dx, h - 1 + 0.35, dw, 0.65, out_to, out_at or m.id, kind='exit', label='Выйти')
    m.spawn('in', dx + dw / 2, h - 1.6, 1)


# ---------------------------------------------------------------------------- furniture
def box(w: int, h: int, top: int, mat: str, front_mat: str | None = None, seed: int = 1) -> Img:
    """A block of furniture seen from the front-top: top face `top` px tall, front face below.
    mat names a ramp in P; the top is lit, the front a step darker, contour in ink."""
    c = P[mat]
    fc = P[front_mat] if front_mat else c
    out = Img.new(w, h)
    out.rect_(0, 0, w, top, c[3])
    out.rect_(0, 0, w, 1, c[4])
    out.rect_(0, top, w, h - top, fc[2])
    out.rect_(0, top, w, 1, fc[1])
    out.rect_(0, h - 2, w, 2, fc[1])
    return _ink_edge(out)


def _ink_edge(img: Img) -> Img:
    """Draw the contour INSIDE the picture's rectangle (the outer ring of opaque pixels becomes
    ink), so a w × h block stays w × h — tiles and furniture keep their grid size."""
    a = img.a.copy()
    m = a[:, :, 3] > 0
    edge = np.zeros_like(m)
    edge[:, 0] |= m[:, 0]; edge[:, -1] |= m[:, -1]; edge[0, :] |= m[0, :]; edge[-1, :] |= m[-1, :]
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        sh = np.roll(np.roll(m, dy, 0), dx, 1)
        edge |= m & ~sh
    a[edge, :3] = hexrgb(INK)[:3]
    a[edge, 3] = 255
    return Img(a)


def ink(img: Img) -> Img:
    return _ink_edge(img)


def barrel(kind: str = 'wood', water: bool = False) -> Img:
    """A barrel, 14 × 18: staves, two iron hoops, a lid (or water surface)."""
    c = P['wood'] if kind == 'wood' else P['rust']
    w, h = 14, 18
    out = Img.new(w, h)
    for x in range(w):
        k = abs(x - 5) / 7
        col = c[3] if x < 4 else (c[2] if x < 9 else c[1])
        bulge = 1 if 3 < x < 10 else 0
        out.rect_(x, 3 - bulge, 1, h - 4 + bulge * 2, col)
    for x in range(1, w, 3):
        out.rect_(x, 4, 1, h - 6, c[0], 0.5)
    for y in (6, h - 5):
        out.rect_(0, y, w, 2, P['iron'][2])
        out.rect_(0, y, w, 1, P['iron'][3])
    out.ellipse_(w / 2, 3, w / 2, 3, c[4] if not water else '#3f5a66')
    if water:
        out.rect_(3, 2, 5, 1, '#7fa2ad')
    else:
        out.rect_(2, 2, w - 4, 1, c[3])
    return ink(out)


def crate(w: int = 16, h: int = 16, dark: bool = False) -> Img:
    c = P['woodgrey'] if dark else P['wood']
    out = Img.new(w, h)
    top = 5
    out.rect_(0, 0, w, top, c[3])
    out.rect_(0, top, w, h - top, c[2])
    for y in range(top + 1, h, 3):
        out.rect_(1, y, w - 2, 1, c[1])
    out.rect_(1, top, 2, h - top, c[3])
    out.rect_(w - 3, top, 2, h - top, c[1])
    out.line_(2, h - 2, w - 3, top + 1, c[4])
    out.rect_(0, top, w, 1, c[1])
    return ink(out)


def sack(color: str = '#a79a78') -> Img:
    out = Img.new(12, 12)
    base = color
    r = ramp(base, 4, 0.4)
    out.ellipse_(6, 7.5, 6, 4.5, r[1])
    out.ellipse_(5.5, 7, 5, 4, r[2])
    out.ellipse_(4.5, 6, 3, 2.5, r[3])
    out.rect_(4, 1, 4, 3, r[2])
    out.rect_(4, 3, 4, 1, r[0])
    return outline(out, INK)


def stool() -> Img:
    c = P['wood']
    out = Img.new(10, 10)
    out.rect_(0, 0, 10, 3, c[3])
    out.rect_(0, 3, 10, 1, c[1])
    out.rect_(1, 4, 2, 6, c[2]); out.rect_(7, 4, 2, 6, c[1])
    return ink(out)


def window(w: int = 20, h: int = 16, bars: int = 3, night: bool = False, frame: str = 'wood') -> Img:
    """A barred window for a wall face: frame, sky-lit glass (or warm glass at night), bars, sill."""
    fc = P[frame]
    out = Img.new(w, h)
    out.rect_(0, 0, w, h, fc[1])
    gw, gh = w - 4, h - 5
    glass = '#e8b85a' if night else '#8fb1bf'
    glass2 = '#ffd98a' if night else '#b8d4dc'
    out.rect_(2, 2, gw, gh, glass)
    out.rect_(2, 2, gw, 3, glass2)
    out.line_(3, 2 + gh - 2, 3 + gw // 2, 3, glass2)
    out.rect_(2 + gw // 2, 2, 1, gh, fc[2])
    out.rect_(2, 2 + gh // 2, gw, 1, fc[2])
    for i in range(1, bars + 1):
        x = 2 + (gw * i) // (bars + 1)
        out.rect_(x, 1, 1, gh + 2, P['iron'][0])
    out.rect_(0, h - 3, w, 3, P['concrete'][3])
    out.rect_(0, h - 1, w, 1, P['concrete'][1])
    return ink(out)


def shelf_wall(w: int, items: list[Img] | None = None, seed: int = 1) -> Img:
    """A plank shelf on two brackets with things on it (for a wall face)."""
    c = P['wood']
    out = Img.new(w, 14)
    if items:
        x = 2
        for it in items:
            if x + it.w > w - 2:
                break
            out.paste_(it, x, 9 - it.h + 1)
            x += it.w + 1
    out.rect_(0, 9, w, 3, c[3])
    out.rect_(0, 11, w, 1, c[1])
    out.rect_(2, 12, 2, 2, c[1]); out.rect_(w - 4, 12, 2, 2, c[1])
    return out


def rug(w: int, h: int, main: str, border: str, seed: int = 1) -> Img:
    out = Img.new(w, h)
    out.rect_(0, 0, w, h, border)
    out.rect_(2, 2, w - 4, h - 4, main)
    r = ramp(main, 4, 0.3)
    for y in range(4, h - 4, 3):
        out.rect_(4, y, w - 8, 1, r[1])
    out.rect_(2, 2, w - 4, 1, r[3])
    return ink(out)


def lamp_hanging(cord: int = 22) -> Img:
    """A tin shade on a long cord with a bulb — for the 'top' layer (it hangs over the hero).
    The cord is what reads as 'hanging from the ceiling' from above; without it the lamp floats."""
    out = Img.new(11, cord + 8)
    out.rect_(5, 0, 1, cord, '#2a2426')
    y = cord
    out.poly_([(3, y), (8, y), (11, y + 4), (0, y + 4)], P['tin'][3])
    out.rect_(0, y + 3, 11, 1, P['tin'][1])
    out.rect_(3, y, 5, 1, P['tin'][4])
    out = ink(out.crop(0, 0, 11, cord + 5)).crop(0, 0, 11, cord + 8)
    out.rect_(4, y + 5, 3, 2, '#fff1c2')
    out.rect_(5, 0, 1, cord, '#2a2426')
    return out


def sign_board(text_px: Img, bg: str = '#3f2e24', pad: int = 3) -> Img:
    w, h = text_px.w + pad * 2, text_px.h + pad * 2
    out = Img.new(w, h)
    out.rect_(0, 0, w, h, bg)
    out.rect_(0, 0, w, 1, ramp(bg, 4, 0.4)[3])
    out.paste_(text_px, pad, pad)
    return ink(out)


# ---------------------------------------------------------------------- a tiny pixel font
# 3×5 capitals for signs (Cyrillic + digits), drawn in the sign's colour. Enough for КУЗНИЦА,
# ШТАБ, КЛУБ, ЛАРЁК, ПИТОМНИК, КАПТЁРКА…
FONT = {
    'А': ['.#.', '#.#', '###', '#.#', '#.#'], 'Б': ['###', '#..', '##.', '#.#', '##.'],
    'В': ['##.', '#.#', '##.', '#.#', '##.'], 'Г': ['###', '#..', '#..', '#..', '#..'],
    'Д': ['.##.', '.#.#', '.#.#', '####', '#..#'], 'Е': ['###', '#..', '##.', '#..', '###'],
    'Ё': ['#.#', '###', '##.', '#..', '###'], 'Ж': ['#.#.#', '.###.', '..#..', '.###.', '#.#.#'],
    'З': ['##.', '..#', '.#.', '..#', '##.'], 'И': ['#.#', '#.#', '###', '###', '#.#'],
    'Й': ['#.#', '#.#', '###', '###', '#.#'], 'К': ['#.#', '#.#', '##.', '#.#', '#.#'],
    'Л': ['.##', '#.#', '#.#', '#.#', '#.#'], 'М': ['#...#', '##.##', '#.#.#', '#...#', '#...#'],
    'Н': ['#.#', '#.#', '###', '#.#', '#.#'], 'О': ['.#.', '#.#', '#.#', '#.#', '.#.'],
    'П': ['###', '#.#', '#.#', '#.#', '#.#'], 'Р': ['##.', '#.#', '##.', '#..', '#..'],
    'С': ['.##', '#..', '#..', '#..', '.##'], 'Т': ['###', '.#.', '.#.', '.#.', '.#.'],
    'У': ['#.#', '#.#', '.##', '..#', '##.'], 'Ф': ['.#.', '###', '###', '.#.', '.#.'],
    'Х': ['#.#', '#.#', '.#.', '#.#', '#.#'], 'Ц': ['#.#.', '#.#.', '#.#.', '####', '...#'],
    'Ч': ['#.#', '#.#', '.##', '..#', '..#'], 'Ш': ['#.#.#', '#.#.#', '#.#.#', '#.#.#', '#####'],
    'Щ': ['#.#.#', '#.#.#', '#.#.#', '#####', '....#'], 'Ы': ['#...#', '#...#', '##..#', '#.#.#', '##..#'],
    'Ь': ['#..', '#..', '##.', '#.#', '##.'], 'Э': ['##.', '..#', '.##', '..#', '##.'],
    'Ю': ['#.##.', '#.#.#', '###.#', '#.#.#', '#.##.'], 'Я': ['.##', '#.#', '.##', '#.#', '#.#'],
    '0': ['###', '#.#', '#.#', '#.#', '###'], '1': ['.#.', '##.', '.#.', '.#.', '###'],
    '2': ['##.', '..#', '.#.', '#..', '###'], '3': ['##.', '..#', '.#.', '..#', '##.'],
    '4': ['..#', '.##', '#.#', '###', '..#'], '5': ['###', '#..', '##.', '..#', '##.'],
    '6': ['.##', '#..', '###', '#.#', '###'], '7': ['###', '..#', '.#.', '.#.', '.#.'],
    '8': ['###', '#.#', '###', '#.#', '###'], '9': ['###', '#.#', '###', '..#', '##.'],
    '№': ['#..', '##.', '#.#', '#.#', '#.#'], '-': ['...', '...', '###', '...', '...'],
    '.': ['...', '...', '...', '...', '.#.'], ' ': ['.', '.', '.', '.', '.'],
    '!': ['.#.', '.#.', '.#.', '...', '.#.'], '%': ['#.#', '..#', '.#.', '#..', '#.#'],
}


def text(s: str, color: str, shadow: str | None = '#1a1212') -> Img:
    s = s.upper()
    w = sum(len(FONT.get(ch, FONT[' '])[0]) + 1 for ch in s) - 1
    out = Img.new(w + (1 if shadow else 0), 5 + (1 if shadow else 0))
    x = 0
    for ch in s:
        g = FONT.get(ch, FONT[' '])
        for yy, row in enumerate(g):
            for xx, v in enumerate(row):
                if v == '#':
                    if shadow:
                        out.px_(x + xx + 1, yy + 1, shadow)
                    out.px_(x + xx, yy, color)
        x += len(g[0]) + 1
    return out


# --------------------------------------------------------------------------- small clutter
def scraps(seed: int = 1) -> Img:
    """Metal offcuts and a nail or two lying on the floor (flat, goes on the ground)."""
    r = rng('scraps', seed)
    out = Img.new(14, 8)
    ir = P['iron']
    for _ in range(4):
        x, y = r.randrange(0, 11), r.randrange(0, 6)
        out.rect_(x, y, r.randrange(2, 4), 1, ir[r.randrange(2, 4)])
        out.px_(x, y + 1, ir[0])
    return out


def chain_hanging(n: int = 6) -> Img:
    """A chain hanging from a wall hook, for a wall face."""
    out = Img.new(5, n * 3 + 3)
    out.rect_(1, 0, 3, 2, P['iron'][1])
    for i in range(n):
        y = 2 + i * 3
        if i % 2:
            out.rect_(1, y, 3, 3, P['iron'][2]); out.px_(2, y + 1, '#00000000')
        else:
            out.rect_(2, y, 1, 3, P['iron'][3])
    return out


def paper(w: int = 9, h: int = 11, seed: int = 1) -> Img:
    """A pinned sheet with scribbles (orders, a drawing, a notice)."""
    r = rng('paper', seed)
    out = Img.new(w, h)
    out.rect_(0, 0, w, h, P['paper'][3])
    out.rect_(0, h - 1, w, 1, P['paper'][1])
    for y in range(2, h - 2, 2):
        out.rect_(1, y, r.randrange(3, w - 1), 1, P['paper'][0])
    out.px_(w // 2, 0, P['red'][2])
    return ink(out)


def bucket(water: bool = True) -> Img:
    out = Img.new(10, 10)
    ir = P['iron']
    out.rect_(1, 3, 8, 7, ir[2]); out.rect_(1, 3, 2, 7, ir[3]); out.rect_(7, 3, 2, 7, ir[1])
    out.ellipse_(5, 3, 4, 2, ir[3])
    out.ellipse_(5, 3, 3, 1.2, '#3f5a66' if water else ir[0])
    out.line_(1, 3, 5, 0, ir[1]); out.line_(5, 0, 9, 3, ir[1])
    return ink(out)


def ore_pile(tone: str = 'stone', gems: str | None = None, seed: int = 1) -> Img:
    """A heap of broken ore: rounded lumps, lit tops, a gem glint or two."""
    r = rng('ore', tone, seed)
    out = Img.new(26, 16)
    c = P[tone]
    lumps = [(r.uniform(4, 22), r.uniform(7, 13), r.uniform(2.5, 4.5)) for _ in range(12)]
    lumps.sort(key=lambda l: l[1])
    for x, y, rr in lumps:
        out.ellipse_(x, y, rr, rr * 0.8, c[1])
        out.ellipse_(x - 0.6, y - 0.8, rr - 1, rr * 0.8 - 1, c[2])
        out.px_(int(x - rr / 2), int(y - rr / 2), c[4])
    if gems:
        g = P[gems] if gems in P else [gems] * 5
        for _ in range(3):
            x, y = r.randrange(6, 20), r.randrange(6, 12)
            out.px_(x, y, g[3] if isinstance(g, list) else gems); out.px_(x + 1, y, g[4] if isinstance(g, list) else gems)
    return outline(out, INK)


def wheelbarrow(load: Img | None = None) -> Img:
    out = Img.new(26, 16)
    ir, wd = P['iron'], P['wood']
    out.poly_([(4, 4), (22, 4), (19, 12), (7, 12)], ir[2])
    out.poly_([(4, 4), (22, 4), (21, 6), (5, 6)], ir[3])
    out.ellipse_(21, 12.5, 3, 3, INK); out.ellipse_(21, 12.5, 1.5, 1.5, ir[3])
    out.line_(0, 3, 6, 6, wd[2]); out.line_(0, 5, 6, 8, wd[2])
    out.rect_(8, 12, 2, 4, ir[1]); out.rect_(15, 12, 2, 3, ir[1])
    if load:
        out.paste_(load.crop(0, 0, load.w, 8), 5, -1)
    return ink(out)
