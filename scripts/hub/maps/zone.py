"""Особая шахта изнутри (v2.80) — the sealed special shaft that opens after the first prestige.

12 × 14 tiles: grey concrete panels, a dark concrete floor. The north half is the shaft: a
concrete collar in the floor with a heavy grate over the pit, chains crossed over it and
padlocked, violet light pulsing up through the bars and leaking along cracks that run out across
the floor; crystals of the prestige ores (rhodonite pink, charoite violet, alexandrite green
turning raspberry, demantoid green) grow out of the walls, the floor and the collar itself. Over
it: the ОСОБАЯ ЗОНА sign with a red beacon, ВХОД ВОСПРЕЩЁН, warning triangles, a chart of the
zone's ores. Across the middle runs the checkpoint (КПП): a chain-link fence with barbed wire,
the barrier arm raised over the passage, the guard (Охранник) at his little desk with the log
book, and his booth with a lit window and a smoking stovepipe. The south half is the waiting
side: a searchlight on a tripod aimed at the shaft, a bench, a notice board, crates of samples,
sandbags, and the guard's dog asleep on a mat.

Lessons from the critique rounds (keep them when you touch this room):
  * The wall between the two corner crystal clusters is only 111 px. ВХОД ВОСПРЕЩЁН didn't fit
    next to the zone sign and was half covered by it; it hangs on the fence now, which is where
    such plates hang anyway, and it makes the fence read as a restricted line.
  * Text on a round sign is clipped by the circle («СТО»). The post carries the «кирпич»
    no-entry sign instead: a red disc with a white bar reads without a single letter.
  * Ё in 3×5 is noise; the plate says ВОСПРЕЩЕН (as Russian signs often do).
  * The pit's glow was a small puddle at the bottom and read as a purple floor. It is a
    gradient up the whole pit plus a hot core and sparks, so every gap in the grate glows;
    the bars are dark against it.
  * The cracks first read as violet lightning: every run the same weight. Now they are two
    pixels wide where they leave the collar and one further out, the light fading along them,
    and there are fewer of them.
  * NA's dog is a tiny side-view blob that reads as a seal. The shepherd is drawn here: pricked
    ears, black muzzle and saddle on tan, paws stretched forward, the tail thumps.
  * A searchlight drawn as a white disc is a crystal ball: it has a steel drum in a yoke, the
    lens set toward the shaft, and a faint wedge of its beam on the floor.
  * A crystal cluster placed just behind the fence stood on the barbed wire (it sorts behind the
    fence, the fence covered its foot). Keep crystals clear of tall things in front of them.
  * The barrier arm raised over the passage must stop short of the shaft's hazard edge, or it
    reads as lying across the pit.
  * Hanging lamps go over open floor, never over a sign (the ПРАВИЛА header got covered).
  * The guard's player tile is 1.65 tiles south of his feet across the desk, like the smith's.
"""
from __future__ import annotations

import math

from art_industry import (GEMS, bulb_wall, HAZ_K, HAZ_Y, HAZ_Y2, COLD, WARM, chain_line, concrete_floor, crystal,
                          footprints, grit, hazard, lamp_enamel, padlock, paper_sheet, plate, refloor, stain,
                          txt)
from kit import INK, P, chain_hanging, crate, ink, shell, texture
from lib import T, Img, Map, camp, grid, kenney, outline, rng, tiles

W, H = 12, 14
PIT_X = 96                     # px, centre of the shaft
VIOLET = ['#120a1c', '#2a1a3e', '#452a66', '#6b3fa0', '#9a6be0', '#c9a6ff', '#efe2ff']
GLOW = [0.55, 0.8, 1.0, 0.75]  # pulse of the violet light by frame
DARK_CONCRETE = ['#34353a', '#3e3f45', '#48494f', '#53545a', '#626369']


# ------------------------------------------------------------------------------------ art
def shaft(frame: int) -> Img:
    """The sealed shaft, 64 × 48; feet = the collar's front edge. A concrete collar (lit back rim,
    hazard paint on the front face), the pit's timbered inner wall, violet light welling up from
    the depth and filling every gap of the grate (pulses by frame, sparks rising), a heavy riveted
    grate, two chains crossed over it from ring bolts in the corners, a big padlock where they
    cross, crystals growing out of two corners."""
    w, h = 64, 48
    out = Img.new(w, h)
    k = GLOW[frame % 4]
    cc = DARK_CONCRETE
    top = 10
    hx0, hy0, hx1, hy1 = 8, top + 5, 56, top + 28
    out.rect_(0, top, w, h - top - 6, cc[3])
    out.rect_(0, top, w, 1, cc[4])
    out.rect_(0, top, 1, h - top - 6, cc[4])
    out.rect_(w - 2, top, 2, h - top - 6, cc[2])
    out.rect_(0, h - 6, w, 6, cc[2]); out.rect_(0, h - 6, w, 1, cc[1])
    out.paste_(hazard(w, 4, 3), 0, h - 5)
    # inner back wall with its timber lining
    out.rect_(hx0, hy0, hx1 - hx0, hy1 - hy0, VIOLET[0])
    out.rect_(hx0, hy0, hx1 - hx0, 6, '#241c2c')
    for x in range(hx0 + 2, hx1, 5):
        out.rect_(x, hy0, 1, 6, '#352a3c')
    # the light from below: a gradient up the pit, a hot core, sparks
    y0 = hy0 + 6
    for y in range(y0, hy1):
        t = (y - y0) / (hy1 - y0)
        c = VIOLET[1] if t < 0.3 else (VIOLET[2] if t < 0.65 else VIOLET[3])
        out.rect_(hx0, y, hx1 - hx0, 1, c)
        out.rect_(hx0, y, hx1 - hx0, 1, VIOLET[4], max(0.0, (t - 0.4) * k * 0.9))
    cx = (hx0 + hx1) / 2
    out.ellipse_(cx, hy1 - 1, 20 * (0.75 + 0.25 * k), 7 * (0.75 + 0.25 * k), VIOLET[4], 0.9)
    out.ellipse_(cx, hy1 - 1, 12 * (0.7 + 0.3 * k), 4.5 * (0.7 + 0.3 * k), VIOLET[5], 0.95)
    out.ellipse_(cx, hy1, 5 * (0.6 + 0.4 * k), 2, VIOLET[6])
    r = rng('shaft-sparks', frame)
    for _ in range(6):
        out.px_(r.randrange(hx0 + 3, hx1 - 3), r.randrange(y0 + 2, hy1 - 3), VIOLET[6])
    out.rect_(hx0, y0, hx1 - hx0, 1, '#0b0610')
    ir = P['iron']
    out.rect_(hx0 - 1, hy0 - 1, hx1 - hx0 + 2, 2, ir[2]); out.rect_(hx0 - 1, hy0 - 1, hx1 - hx0 + 2, 1, ir[3])
    out.rect_(hx0 - 1, hy1 - 1, hx1 - hx0 + 2, 2, ir[2]); out.rect_(hx0 - 1, hy1 - 1, hx1 - hx0 + 2, 1, ir[3])
    for x in range(hx0 + 2, hx1 - 1, 6):
        out.rect_(x, hy0, 2, hy1 - hy0, ir[0]); out.rect_(x, hy0, 1, hy1 - hy0, ir[2])
    for y in (hy0 + 8, hy0 + 17):
        out.rect_(hx0, y, hx1 - hx0, 2, ir[1]); out.rect_(hx0, y, hx1 - hx0, 1, ir[3])
        for x in range(hx0 + 2, hx1 - 1, 6):
            out.px_(x, y, ir[4])
    for (x, y) in ((58, top + 6), (59, top + 7), (59, top + 8), (60, top + 9), (61, top + 10),
                   (5, top + 25), (4, top + 26), (4, top + 27)):
        out.px_(x, y, VIOLET[5] if k > 0.7 else VIOLET[4])
    out = ink(out)
    for rx, ry in ((4, top + 3), (w - 5, top + 3), (4, h - 9), (w - 5, h - 9)):
        out.ellipse_(rx + 0.5, ry + 0.5, 2.5, 2.5, INK)
        out.ellipse_(rx + 0.5, ry + 0.5, 1.6, 1.6, ir[3])
        out.px_(rx, ry, INK)
    chain_line(5, top + 4, w - 6, h - 9, out, sag=2)
    chain_line(w - 6, top + 4, 5, h - 9, out, sag=2)
    out.paste_(padlock(True, 'iron'), int(w / 2 - 4), top + 12)
    out.paste_(padlock(False, 'rust'), 1, h - 13)
    out.paste_(crystal('charoite', [(6, 9, -0.25, 4), (10, 13, 0.05, 5), (14, 7, 0.4, 3)], 20, 18), 0, top - 8)
    out.paste_(crystal('rhodonite', [(5, 6, 0.3, 3), (8, 8, -0.15, 4)], 13, 12), w - 13, top - 4)
    return out


def cracks(frame: int) -> Img:
    """Cracks running out across the floor from the shaft's collar, violet light in them pulsing
    with the shaft: two pixels wide where they leave the collar, one pixel further out, the light
    fading along them. A flat sprite (base = its top: everything stands on it). 176 × 60."""
    w, h = 176, 60
    out = Img.new(w, h)
    k = GLOW[frame % 4]
    r = rng('zone-cracks')
    runs = [(54, 2, -1.0, 0.75, 46), (64, 3, -0.45, 1.0, 36), (116, 2, 1.0, 0.65, 50), (106, 3, 0.35, 1.0, 34),
            (132, 0, 1.0, 0.1, 24)]
    pts_all = []
    for sx, sy, dx, dy, ln in runs:
        x, y = float(sx), float(sy)
        for i in range(ln):
            x += dx + r.uniform(-0.55, 0.55)
            y += dy * 0.8 + r.uniform(-0.3, 0.4)
            if not (0 <= x < w - 1 and 0 <= y < h - 1):
                break
            t = i / ln
            pts_all.append((int(x), int(y), t, t < 0.3))
            if r.random() < 0.05:
                bx, by = x, y
                for j in range(r.randrange(3, 6)):
                    bx += r.choice([-1, 0, 1]); by += r.choice([0, 1])
                    if 0 <= bx < w and 0 <= by < h:
                        pts_all.append((int(bx), int(by), min(1.0, t + 0.25), False))
    for x, y, t, thick in pts_all:
        a = (1 - t) * 0.24 * k
        if a > 0.02:
            out.ellipse_(x + 0.5, y + 0.5, 3, 1.8, VIOLET[3], a)
    for x, y, t, thick in pts_all:
        out.px_(x, y, VIOLET[0])
        if thick:
            out.px_(x + 1, y, VIOLET[0]); out.px_(x, y + 1, '#2a2a30')
    for x, y, t, thick in pts_all:
        if t < 0.7 * k + 0.1 and (x + y) % 3:
            out.px_(x, y, VIOLET[4] if t > 0.3 else VIOLET[5])
    return out


def wall_crystals(kind: str, seed: int, big: bool = True) -> Img:
    """A cluster growing out of the foot of the wall, tall shards leaning outward. 26 × 36."""
    if big:
        shards = [(6, 18, -0.35, 5), (11, 30, -0.08, 7), (16, 22, 0.2, 6), (20, 12, 0.5, 4), (3, 9, -0.6, 3)]
        return crystal(kind, shards, 26, 36, base='#4a4450')
    shards = [(5, 10, -0.3, 4), (9, 15, 0.05, 5), (13, 8, 0.45, 3)]
    return crystal(kind, shards, 18, 20, base='#4a4450')


def floor_crystals(kind: str, seed: int, size: int = 1) -> Img:
    """A cluster pushing up through the floor, with a broken concrete socket. size 0/1/2."""
    if size == 0:
        return crystal(kind, [(4, 6, -0.3, 3), (7, 8, 0.2, 4)], 12, 12, base='#48494f')
    if size == 1:
        return crystal(kind, [(4, 8, -0.4, 4), (8, 12, 0.0, 5), (12, 7, 0.45, 3)], 17, 17, base='#48494f')
    return crystal(kind, [(5, 12, -0.4, 5), (10, 18, -0.05, 6), (15, 14, 0.3, 5), (19, 8, 0.6, 3)], 24, 24,
                   base='#48494f')


def zone_sign() -> Img:
    """«ОСОБАЯ ЗОНА»: white on red, two lines, a riveted plate. 31 × 17."""
    return plate(['ОСОБАЯ', 'ЗОНА'], '#f4ecd6', '#a8323b', pad=2)


def beacon(frame: int) -> Img:
    """A red revolving beacon on a wall bracket: the bright side of the lens turns by frame. 11 × 10."""
    out = Img.new(11, 10)
    ir = P['iron']
    out.rect_(1, 7, 9, 3, ir[2]); out.rect_(1, 7, 9, 1, ir[3])
    out.ellipse_(5.5, 5, 4, 4.5, '#7a1c1c')
    out = ink(out)
    lit = [(2, 3), (4, 2), (6, 2), (8, 3)][frame % 4]
    out.rect_(3, 2, 5, 5, '#a8282a')
    out.rect_(lit[0], lit[1], 2, 4, '#ff6a50'); out.px_(lit[0], lit[1], '#ffd0c0')
    return out


def triangle_sign() -> Img:
    """A yellow warning triangle with a black border and '!'. 13 × 12."""
    g = [
        '......k......',
        '.....kyk.....',
        '.....kyk.....',
        '....kykyk....',
        '....kykyk....',
        '...kyykyyk...',
        '...kyykyyk...',
        '..kyyyyyyyk..',
        '..kyyykyyyk..',
        '.kyyyyyyyyyk.',
        'kyyyyyyyyyyyk',
        'kkkkkkkkkkkkk',
    ]
    return grid(g, {'k': INK, 'y': HAZ_Y})


def ore_chart() -> Img:
    """A chart of the zone's ores: ПОРОДЫ over five samples in the prestige colours. 33 × 21."""
    w, h = 33, 21
    out = Img.new(w, h)
    out.rect_(0, 0, w, h, P['paper'][2]); out.rect_(0, 0, w, 1, P['paper'][3]); out.rect_(0, h - 1, w, 1, P['paper'][0])
    t = txt('ПОРОДЫ', '#2a2226')
    out.paste_(t, (w - t.w) // 2, 2)
    out.rect_(2, 8, w - 4, 1, P['paper'][1])
    for i, kind in enumerate(('rhodonite', 'lovchorrite', 'charoite', 'demantoid', 'alexandrite')):
        c = GEMS[kind]
        x = 2 + i * 6
        out.rect_(x, 10, 5, 5, c[1]); out.rect_(x, 10, 3, 3, c[3]); out.px_(x, 10, c[4])
        if kind == 'alexandrite':
            out.rect_(x + 2, 12, 3, 3, c[2])
        for j in range(i + 1):
            out.px_(x + j % 5, 17, '#2a2226')
    return ink(out)


def fence() -> Img:
    """A chain-link fence panel with barbed wire on top — posts, rails, diamond mesh you can see
    through, a coil of wire with barbs — and a ВХОД ВОСПРЕЩЁН plate wired to it. 56 × 34; feet =
    bottom row."""
    w, h = 56, 34
    out = Img.new(w, h)
    ir = P['iron']
    top = 8
    for y in range(top + 2, h - 2):
        for x in range(1, w - 1):
            if (x + y) % 5 == 0 or (x - y) % 5 == 0:
                out.px_(x, y, '#8d949b', 0.85)
    out.rect_(0, top + 1, w, 1, ir[3]); out.rect_(0, top + 2, w, 1, ir[1])
    out.rect_(0, h - 3, w, 1, ir[3]); out.rect_(0, h - 2, w, 1, ir[1])
    for x in (0, 18, 36, 53):
        out.rect_(x, top - 3, 3, h - top + 3, ir[2]); out.rect_(x, top - 3, 1, h - top + 3, ir[4])
        out.rect_(x - 1, top - 4, 5, 2, ir[1])
    out = outline(out, INK).crop(1, 1, w, h)
    for i in range(0, w - 2, 4):
        cx = i + 2
        out.ellipse_(cx + 0.5, top - 3.5, 2.5, 2.5, ir[3])
        out.ellipse_(cx + 0.5, top - 3.5, 1.5, 1.5, '#00000000')
    for i in range(0, w - 2, 4):
        out.px_(i + 2, top - 7, ir[4]); out.px_(i + 4, top - 1, ir[4])
    sign = plate(['ВХОД', 'ВОСПРЕЩЕН'], HAZ_K, HAZ_Y, pad=1)
    sx, sy = (w - sign.w) // 2, top + 6
    out.line_(sx + 3, top + 2, sx + 3, sy, ir[4]); out.line_(sx + sign.w - 4, top + 2, sx + sign.w - 4, sy, ir[4])
    out.paste_(sign, sx, sy)
    return out


def barrier(frame: int = 0) -> Img:
    """The barrier (шлагбаум) raised: a post with its pivot box and a lamp, the red-white arm up
    and leaning over the passage with a red disc at its tip, the counterweight down behind.
    30 × 52; feet = post foot."""
    w, h = 30, 52
    out = Img.new(w, h)
    ir = P['iron']
    px, py = 22, 40
    ang = math.radians(106)
    L = 35
    for i in range(L):
        x = px + math.cos(ang) * i
        y = py - math.sin(ang) * i
        c = '#c23b36' if (i // 6) % 2 == 0 else '#ece6d8'
        out.rect_(int(round(x)) - 1, int(round(y)), 4, 1, c)
        out.px_(int(round(x)) - 1, int(round(y)), '#ff8a7a' if c == '#c23b36' else '#ffffff')
        out.px_(int(round(x)) + 2, int(round(y)), '#7a1c1c' if c == '#c23b36' else '#a8a298')
    tip_x, tip_y = int(px + math.cos(ang) * L), int(py - math.sin(ang) * L)
    out.ellipse_(tip_x + 0.5, tip_y + 1, 3.5, 3.5, '#c23b36'); out.ellipse_(tip_x, tip_y + 0.5, 1.6, 1.6, '#f0ece0')
    out.line_(px, py, px + 5, py + 4, ir[1])
    out.rect_(px + 3, py + 3, 5, 5, ir[1]); out.rect_(px + 3, py + 3, 5, 1, ir[3])
    out.rect_(px - 3, py - 3, 8, 7, ir[3]); out.rect_(px - 3, py - 3, 8, 1, ir[4])
    out.rect_(px - 1, py + 4, 4, h - py - 4, ir[2]); out.rect_(px - 1, py + 4, 1, h - py - 4, ir[4])
    out.rect_(px - 3, h - 2, 9, 2, ir[1])
    out = ink(out)
    out.rect_(px, py - 1, 2, 2, '#ffd06a' if frame % 2 == 0 else '#6a4a1a')
    return out


def guard_desk() -> Img:
    """The guard's little desk with the open log book (two ruled pages, a pencil), a rubber stamp
    and a mug of tea. 30 × 22."""
    w, h = 30, 22
    out = Img.new(w, h)
    wd = P['wood']
    top = 6
    out.rect_(0, top, w, 7, wd[3]); out.rect_(0, top, w, 1, wd[4])
    out.rect_(0, top + 7, w, 3, wd[1])
    out.rect_(1, top + 10, 3, h - top - 10, wd[2]); out.rect_(w - 4, top + 10, 3, h - top - 10, wd[1])
    out.rect_(4, h - 4, w - 8, 1, wd[1])
    out = ink(out)
    # the log book, open: two pages, a spine, ruled lines, a red ribbon
    bk = Img.new(16, 9)
    bk.rect_(0, 0, 16, 9, '#4a2a22')
    bk.rect_(1, 1, 7, 7, P['paper'][3]); bk.rect_(8, 1, 7, 7, P['paper'][2])
    for y in (2, 4, 6):
        bk.rect_(2, y, 5, 1, P['paper'][0]); bk.rect_(9, y, 4 + y % 3, 1, P['paper'][0])
    bk.rect_(7, 0, 2, 9, '#2a1a16'); bk.rect_(8, 7, 1, 3, '#b8413a')
    out.paste_(ink(bk), 3, top - 3)
    out.line_(20, top - 1, 23, top + 3, '#d8a632'); out.px_(23, top + 3, INK)             # pencil
    mug = Img.new(5, 5)
    mug.rect_(0, 0, 4, 5, '#b8bcc0'); mug.rect_(0, 0, 1, 5, '#e0e4e6'); mug.px_(4, 2, '#b8bcc0'); mug.rect_(1, 0, 2, 1, '#6b3a26')
    out.paste_(ink(mug), 24, top - 2)
    return out


def booth(frame: int = 0) -> Img:
    """The guard booth (будка КПП): a tin roof with a stovepipe, plank walls painted grey-green,
    a lit window with a kettle and a lamp inside, the КПП plate, a door with its step. 42 × 54."""
    w, h = 42, 54
    out = Img.new(w, h)
    wd, ir = P['woodgrey'], P['iron']
    pg = ['#2c3a33', '#3e5046', '#556b5e', '#6f8577', '#8ea293']
    roof_y = 10
    wall_y = 20
    # walls: vertical planks
    out.rect_(1, wall_y, w - 2, h - wall_y - 2, pg[2])
    for x in range(1, w - 1, 5):
        out.rect_(x, wall_y, 1, h - wall_y - 2, pg[1])
        out.rect_(x + 1, wall_y, 1, h - wall_y - 2, pg[3])
    out.rect_(1, wall_y, 4, h - wall_y - 2, pg[3])
    # window: frame, warm glass, a lamp and a kettle silhouetted inside
    wx0, wy0, ww, wh = 5, wall_y + 9, 20, 14
    out.rect_(wx0 - 1, wy0 - 1, ww + 2, wh + 2, wd[1])
    out.rect_(wx0, wy0, ww, wh, '#e8b85a')
    out.rect_(wx0, wy0, ww, 3, '#ffd98a')
    out.rect_(wx0 + 3, wy0 + 8, 6, 5, '#3a2a22'); out.rect_(wx0 + 4, wy0 + 6, 4, 2, '#3a2a22'); out.rect_(wx0 + 9, wy0 + 9, 2, 1, '#3a2a22')   # kettle
    out.rect_(wx0 + 14, wy0 + 3, 3, 3, '#fff2c0'); out.rect_(wx0 + 15, wy0 + 6, 1, 7, '#3a2a22')                                          # lamp
    out.rect_(wx0 + ww // 2, wy0, 1, wh, wd[1])
    out.rect_(wx0, wy0 + wh // 2, ww, 1, wd[1])
    out.rect_(wx0 - 2, wy0 + wh + 1, ww + 4, 2, pg[4])
    # door on the right with a handle, a step
    dx0 = 28
    out.rect_(dx0, wall_y + 6, 11, h - wall_y - 8, pg[1]); out.rect_(dx0 + 1, wall_y + 7, 9, h - wall_y - 10, pg[2])
    out.rect_(dx0 + 1, wall_y + 7, 9, 1, pg[3])
    out.rect_(dx0 + 8, wall_y + 18, 1, 3, ir[4])
    out.rect_(dx0 - 1, h - 3, 13, 3, DARK_CONCRETE[3]); out.rect_(dx0 - 1, h - 3, 13, 1, DARK_CONCRETE[4])
    # КПП plate over the window
    kpp = plate(['КПП'], '#f4ecd6', '#34558a', pad=1)
    out.rect_(0, h - 2, w, 2, pg[0])
    # roof: corrugated tin seen from above, eaves overhang
    for x in range(0, w):
        out.rect_(x, roof_y, 1, wall_y - roof_y, P['tin'][[3, 2, 1, 2][x % 4]])
    out.rect_(0, wall_y - 2, w, 2, P['tin'][0])
    out.rect_(0, roof_y, w, 1, P['tin'][4])
    r = rng('booth-rust')
    for _ in range(8):
        out.rect_(r.randrange(0, w - 3), r.randrange(roof_y + 1, wall_y - 3), r.randrange(2, 4), 2, P['rust'][r.randrange(1, 4)], 0.8)
    # stovepipe with a cap
    out.rect_(8, 0, 4, roof_y + 2, ir[1]); out.rect_(8, 0, 1, roof_y + 2, ir[3])
    out.rect_(6, 0, 8, 2, ir[2])
    out = ink(out)
    out.paste_(kpp, wx0 + (ww - kpp.w) // 2, wall_y + 1)
    return out


def searchlight() -> Img:
    """A searchlight on a tripod: a steel drum held in a yoke, its lens facing up and to the right
    toward the shaft — a bright disc in a rim; three splayed legs. 22 × 32."""
    w, h = 22, 32
    out = Img.new(w, h)
    ir = P['iron']
    out.line_(11, 20, 3, 31, ir[2]); out.line_(12, 20, 4, 31, ir[1])
    out.line_(11, 20, 19, 31, ir[1]); out.line_(12, 20, 20, 31, ir[0])
    out.line_(11, 20, 11, 29, ir[2])
    out.rect_(8, 18, 7, 3, ir[2]); out.rect_(8, 18, 7, 1, ir[3])
    out.rect_(3, 7, 2, 12, ir[2]); out.rect_(17, 7, 2, 12, ir[1]); out.rect_(3, 17, 16, 2, ir[2])  # yoke
    out.ellipse_(10.5, 10, 7.5, 7, ir[1])                                                            # drum
    out.ellipse_(9.8, 9.3, 6.6, 6.2, ir[2])
    out.rect_(3, 9, 2, 3, ir[4]); out.rect_(17, 9, 2, 3, ir[3])                                    # pivots
    out = ink(out)
    out.ellipse_(12, 8, 5.4, 4.8, ir[4])                                                             # rim
    out.ellipse_(12, 8, 4.4, 3.9, '#cfdcff')
    out.ellipse_(11.4, 7.4, 3.2, 2.7, '#f2f5ff')
    out.rect_(10, 5, 2, 2, '#ffffff')
    out.line_(6, 14, 9, 14, ir[0])
    return out


def notice_board() -> Img:
    """A notice board on two legs, ПРАВИЛА on its header, three pinned sheets. 32 × 32."""
    w, h = 32, 32
    out = Img.new(w, h)
    wd = P['wood']
    out.rect_(4, 20, 3, 12, wd[1]); out.rect_(25, 20, 3, 12, wd[0])
    out.rect_(0, 0, w, 22, wd[2]); out.rect_(0, 0, w, 1, wd[4]); out.rect_(0, 21, w, 1, wd[0])
    out.rect_(2, 8, w - 4, 12, '#6e5a44')
    out = ink(out)
    t = txt('ПРАВИЛА', '#f0e6c8')
    out.paste_(t, (w - t.w) // 2, 2)
    out.paste_(paper_sheet(8, 10, 1), 4, 9)
    out.paste_(paper_sheet(7, 9, 2, pin='#34558a'), 13, 10)
    out.paste_(paper_sheet(8, 8, 3), 21, 9)
    return out


def sample_crates() -> Img:
    """Two crates of samples, the top one open with prestige crystals showing, a yellow tag. 20 × 30."""
    out = Img.new(20, 30)
    out.paste_(crate(18, 14), 1, 16)
    out.paste_(crate(16, 13, dark=True), 2, 7)
    out.paste_(crystal('alexandrite', [(4, 6, -0.3, 3), (7, 8, 0.1, 4)], 11, 10), 3, 0)
    out.paste_(crystal('demantoid', [(3, 5, 0.3, 3)], 8, 8), 11, 3)
    out.rect_(6, 21, 6, 4, HAZ_Y); out.rect_(6, 21, 6, 1, HAZ_Y2); out.rect_(7, 23, 4, 1, HAZ_K)
    out.rect_(5, 21, 1, 4, INK); out.rect_(12, 21, 1, 4, INK); out.rect_(6, 20, 6, 1, INK); out.rect_(6, 25, 6, 1, INK)
    return out


def dog(frame: int) -> Img:
    """The guard's shepherd lying on its mat, sphinx-like: head up with two pricked ears, black
    muzzle, a black saddle on a tan body, front paws stretched forward, the tail on the floor —
    it thumps by frame. 27 × 14."""
    w, h = 27, 14
    out = Img.new(w, h)
    tan, tan2, dark, black = '#b08a58', '#8a6a42', '#5a4430', '#241e1c'
    out.ellipse_(15, 9, 8.5, 3.8, tan2)                        # body
    out.ellipse_(14.5, 8.4, 7.5, 3.0, tan)
    out.ellipse_(15.5, 7.2, 6.5, 2.4, black)                   # saddle
    out.ellipse_(20.5, 9.3, 3.6, 3.2, tan2)                    # haunch
    out.ellipse_(20, 8.8, 2.8, 2.4, tan)
    out.rect_(2, 11, 10, 2, tan)                               # front paws, stretched
    out.rect_(2, 11, 10, 1, '#c9a877')
    out.ellipse_(7, 6, 3.6, 3.4, tan)                          # head
    out.rect_(1, 6, 5, 3, tan)                                 # snout
    out.rect_(1, 7, 4, 2, dark)                                # black muzzle
    out.poly_([(4.5, 4), (5.5, 0.5), (7, 3.5)], black)         # ears
    out.poly_([(7.5, 3.5), (9, 0.5), (10, 4)], black)
    out.px_(5, 2, tan2); out.px_(8, 2, tan2)
    tail = [(24, 10), (25, 11), (26, 12)] if frame % 2 == 0 else [(24, 10), (25, 10), (26, 10)]
    for x, y in tail:
        out.px_(x, y, black); out.px_(x - 1, y, dark)
    out = outline(out, INK).crop(1, 1, w, h)
    out.px_(5, 5, INK)                                         # eye
    out.px_(0, 6, INK)                                         # nose
    if frame % 2:
        out.px_(6, 4, '#e8c8a0')                               # an ear flicks
    return out


def mat() -> Img:
    out = Img.new(28, 10)
    out.rect_(0, 0, 28, 10, '#5a4a3a')
    for y in range(1, 9, 2):
        out.rect_(1, y, 26, 1, '#6e5c48')
    out.rect_(0, 0, 28, 1, '#7a6a56')
    return ink(out)


def stop_post() -> Img:
    """The no-entry road sign («кирпич»: a red disc with a white bar) on a striped post. 16 × 30."""
    w, h = 16, 30
    out = Img.new(w, h)
    ir = P['iron']
    out.rect_(7, 14, 2, 15, ir[3]); out.rect_(7, 14, 1, 15, ir[4])
    for y in range(16, 28, 4):
        out.rect_(7, y, 2, 2, '#1f1c1d')
    out.rect_(5, h - 2, 6, 2, ir[1])
    out.ellipse_(8, 7.5, 7.5, 7.5, '#a8323b')
    out.ellipse_(7.6, 7.1, 6.3, 6.3, '#d0504f')
    out.rect_(2, 6, 12, 3, '#f4f0e6')
    out.rect_(2, 8, 12, 1, '#c8c2b4')
    return ink(out)


def bench() -> Img:
    out = Img.new(32, 12)
    wd = P['woodgrey']
    out.rect_(0, 3, 32, 4, wd[3]); out.rect_(0, 3, 32, 1, wd[4])
    out.rect_(0, 7, 32, 1, wd[1])
    out.rect_(3, 8, 3, 4, wd[2]); out.rect_(26, 8, 3, 4, wd[1])
    out = ink(out)
    cap = Img.new(9, 4)
    cap.rect_(0, 1, 9, 3, '#3e4a38'); cap.rect_(2, 0, 5, 2, '#4f5c47'); cap.rect_(0, 3, 9, 1, '#2c3527')
    out.paste_(ink(cap), 18, 0)
    return out


def barricade() -> Img:
    """Kenney's red-white road barricade, graded into the camp and outlined."""
    u = kenney('rpg-urban-pack/Tilemap/tilemap_packed.png', 16)
    b = tiles(u, 6, 8)
    return outline(camp(b, sat=0.7), INK)


def wall_texture(w: int, h: int) -> Img:
    """Concrete panels, damp and cracked, violet light seeping out of the cracks near the floor."""
    out = texture('concrete', w, h, 13)
    r = rng('zone-wall')
    for _ in range(5):
        x = r.randrange(0, w)
        out.rect_(x, 0, r.randrange(3, 6), r.randrange(h // 2, h), '#2e3035', 0.25)
    for sx in (w // 2 - 30, w // 2 + 26, 20, w - 24):
        x, y = sx, h - 1
        for i in range(r.randrange(8, 16)):
            out.px_(x, y, VIOLET[0])
            if i < 6:
                out.px_(x + 1, y, VIOLET[3], 0.7)
            x += r.choice([-1, 0, 1]); y -= 1
    return out


def sandbags() -> Img:
    """A low wall of sandbags: four bags below, three on top, each a lumpy pillow with a tied
    corner and a seam. 32 × 16."""
    w, h = 32, 16
    out = Img.new(w, h)
    c = ['#5e5238', '#7c6c4a', '#9c8a60', '#b8a67a']
    for row, (y, xs) in enumerate(((10, (4, 12, 20, 28)), (5, (8, 16, 24)))):
        for x in xs:
            out.ellipse_(x, y, 4.4, 3.4, c[1])
            out.ellipse_(x - 0.6, y - 0.6, 3.6, 2.6, c[2])
            out.px_(x - 2, y - 2, c[3]); out.px_(x - 1, y - 2, c[3])
            out.rect_(x - 3, y + 1, 6, 1, c[0])
            out.px_(x + 3, y - 2, c[0])
    return outline(out, INK).crop(1, 1, w, h)


# ------------------------------------------------------------------------------------ map
def build() -> Map:
    m = Map('zone', W, H, 'indoor', name='Особая шахта', ambient=0.45, music='depths')
    shell(m, 'concrete', 'concrete', face=2, door=(5, 2), out_to='square', out_at='zone', floor_seed=9)
    refloor(m, lambda g_, a, b, c, d: concrete_floor(g_, a, b, c, d, seed=9, tone=DARK_CONCRETE))
    g = m.ground
    m.stamp(wall_texture((W - 2) * T, 2 * T - 3), T, T)
    g.rect_(T, T, (W - 2) * T, 2, '#000000', 0.35)
    g.rect_(T, 2 * T + 13, (W - 2) * T, 3, '#1c1d22')                      # a concrete skirting

    # --- floor: shards and dust, the guard's path, a cable from the booth to the searchlight
    grit(g, T, 3 * T, (W - 1) * T, 8 * T, [VIOLET[3], VIOLET[4], GEMS['rhodonite'][3], GEMS['demantoid'][3]], 40, 3,
         cluster=(PIT_X, 6 * T, 50, 22))
    grit(g, T, 3 * T, (W - 1) * T, (H - 1) * T, ['#2e2f33', '#5a5b61'], 120, 4)
    stain(g, PIT_X, 7 * T, 40, 12, VIOLET[1], 0.25)
    footprints(g, [(PIT_X - 8, 12 * T + 8), (PIT_X - 12, 9 * T + 4), (PIT_X - 10, 6 * T + 12)], seed=7, alpha=0.26)
    footprints(g, [(8 * T - 2, 9 * T + 8), (9 * T + 8, 9 * T + 12)], seed=8, alpha=0.2)
    # where the searchlight's beam falls: a faint wedge from its lens up to the shaft
    g.poly_([(2 * T + 8, 9 * T + 2), (2 * T + 14, 9 * T + 6), (PIT_X + 6, 6 * T + 6), (PIT_X - 30, 5 * T + 14)], '#e6ecff', 0.13)
    g.poly_([(2 * T + 9, 9 * T + 3), (2 * T + 12, 9 * T + 5), (PIT_X - 4, 6 * T + 4), (PIT_X - 20, 5 * T + 15)], '#f4f7ff', 0.1)
    for x in range(3 * T, 9 * T + 4):                                      # searchlight cable
        y = 10 * T + 5 + int(2 * math.sin(x / 9))
        g.px_(x, y, '#141416'); g.px_(x, y - 1, '#3a3b40', 0.6)

    # --- north wall: crystals from the corners, ВХОД ВОСПРЕЩЁН, the zone sign and its beacon,
    # a warning triangle, the ore chart
    m.stamp(bulb_wall(True), 3 * T - 6, T + 4)
    m.stamp(chain_hanging(5), 3 * T + 10, T + 3)
    m.stamp(triangle_sign(), 4 * T - 2, T + 15)
    m.stamp(zone_sign(), PIT_X - 15, T + 11)
    m.put('zone.beacon', [beacon(i) for i in range(4)], PIT_X - 5, T + 1, base=3 * T - 2, fps=6)
    m.light(PIT_X, T + 6, 26, '#ff4a3a', 'neon')
    m.stamp(ore_chart(), 7 * T + 8, T + 8)
    m.light(3 * T - 1, T + 12, 30, '#fff4cf', 'lamp')
    m.put('zone.wallcr.l', wall_crystals('charoite', 1), T - 2, 3 * T + 6 - 36, solid=(1, 3, 2.5, 3.5))
    m.put('zone.wallcr.r', wall_crystals('rhodonite', 2).flip(), (W - 1) * T - 25, 3 * T + 6 - 36, solid=(9.5, 3, 11, 3.5))
    m.light(2 * T, 2 * T + 8, 40, GEMS['charoite'][3], 'magic')
    m.light((W - 2) * T, 2 * T + 8, 40, GEMS['rhodonite'][3], 'magic')

    # --- the shaft (animated glow), its cracks, crystals around it
    m.put('zone.cracks', [cracks(i) for i in range(4)], T - 8 + 0, 6 * T - 4, base=6 * T - 4, fps=3)
    m.put('zone.shaft', [shaft(i) for i in range(4)], PIT_X - 32, 6 * T - 48, fps=3, solid=(4, 3.5, 8, 6))
    m.door(4.5, 6, 3, 0.9, '@zone', '', kind='use', label='Войти', lock='zone')
    m.light(PIT_X, 4 * T + 12, 80, '#9a6be0', 'magic')
    m.emit('motes', PIT_X, 4 * T + 8, 1.4)
    m.emit('motes', 2 * T, 3 * T, 0.4)
    m.emit('motes', (W - 2) * T, 3 * T, 0.4)
    for name, kind, x, y, size, sol in (
            ('zone.cr.a', 'alexandrite', 2 * T + 4, 5 * T + 10, 2, (2.25, 5, 3.75, 5.75)),
            ('zone.cr.d', 'demantoid', 9 * T - 2, 5 * T + 12, 1, (8.5, 5.25, 9.5, 5.75)),
            ('zone.cr.c', 'charoite', 3 * T + 6, 4 * T - 2, 0, (3.25, 3.5, 4, 4)),
            ('zone.cr.r', 'rhodonite', 8 * T + 6, 4 * T + 2, 0, (8.25, 3.75, 9, 4.25)),
            ('zone.cr.l', 'lovchorrite', 10 * T - 1, 5 * T + 6, 1, (10, 4.75, 11, 5.25))):
        im = floor_crystals(kind, 1, size)
        m.put(name, im, x, y - im.h, solid=sol)
        m.light(x + im.w // 2, y - im.h // 2, 22 + 8 * size, GEMS[kind][3], 'magic')

    # --- the checkpoint: fence with barbed wire, the raised barrier over the passage, the guard
    # at his desk with the log book, his booth with a lit window and a smoking pipe
    m.put('zone.fence', fence(), T, 8 * T + 8 - 34, solid=(1, 8, 4.5, 8.5))
    m.put('zone.barrier', [barrier(i) for i in range(2)], 7 * T - 23, 8 * T + 8 - 52, fps=1.5, solid=(6.5, 8, 7, 8.5))
    m.npc('guard', 'guard', 7.85, 7.85, face=0, anim='idle', name='Охранник')
    m.put('zone.desk', guard_desk(), 7 * T + 2, 9 * T - 22, solid=(7, 8, 9, 9))
    m.put('zone.booth', booth(), 9 * T + 4, 9 * T - 54, solid=(9, 6.5, 11, 9))
    m.light(9 * T + 20, 7 * T + 4, 36, WARM, 'window')
    m.emit('smoke', 9 * T + 14, 5 * T + 12, 0.5)

    # --- the waiting side: searchlight, bench, notice board, crates of samples, the dog
    m.put('zone.searchlight', searchlight(), 2 * T - 4, 10 * T + 8 - 32, solid=(1.5, 9.75, 2.75, 10.5))
    m.light(2 * T + 7, 9 * T + 4, 48, '#e6ecff', 'lamp')
    m.put('zone.stop', stop_post(), 4 * T - 2, 9 * T + 12 - 30, solid=(4, 9.25, 4.5, 9.75))
    m.put('zone.bench', bench(), T + 2, 12 * T - 12, solid=(1, 11.25, 3, 12))
    m.put('zone.board', notice_board(), 3 * T + 2, 13 * T - 32, solid=(3.25, 12.25, 5, 13))
    m.put('zone.samples', sample_crates(), T + 1, 13 * T - 30, solid=(1, 12.25, 2.25, 13))
    m.put('zone.mat', mat(), 9 * T + 2, 10 * T + 4, base=10 * T + 4)
    m.put('zone.dog', [dog(i) for i in range(2)], 9 * T + 2, 10 * T + 13 - 14, fps=1.2, solid=(9.25, 10, 10.75, 10.75))
    m.put('zone.barricade', barricade(), 9 * T + 12, 12 * T + 14 - 18, solid=(9.75, 12.25, 11, 13))
    m.put('kit.crate.dark', crate(dark=True), 8 * T + 10, 12 * T + 6, solid=(8.5, 12.25, 9.5, 13))
    m.put('zone.sandbags', sandbags(), 7 * T + 8, 11 * T + 12 - 16, solid=(7.5, 11, 9.5, 11.75))

    lamp = lamp_enamel(cord=20)
    for lx, ly in ((5 * T, 8 * T - 4), (5 * T + 10, 11 * T + 2), (8 * T + 4, 12 * T + 6)):
        m.put('zone.lamp', lamp, lx - 6, ly - lamp.h, layer='top')
        m.light(lx, ly + 2, 56, COLD, 'lamp')
    m.marks['guard'] = (7.85, 7.85)
    return m
