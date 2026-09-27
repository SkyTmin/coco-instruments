"""Лифт в подземелье изнутри (v2.80) — the iron pavilion over the lift down to the rat tunnels.

12 × 14 tiles, a tall hall: the north wall is three tiles of riveted iron plates with a barred
window high up. The lift is a freestanding mesh shaft against it — angle-iron posts, a header
with ОСТОРОЖНО, КРЫСЫ!, a scissor door folded open and the cage inside lit by a lantern, a yellow
arrow pointing down on its back wall. Its rope runs up to a pulley under the ceiling beam (top
layer) and across to the winch: a big drum wound with cable, a gear, a green motor. The liftman
(Лифтёр) stands between the winch and his lever stand. The rats are everywhere: a hole at the
foot of the wall with red eyes blinking in it, traps, droppings, a sewer grate, gnawed crates and
a gnawed sack, a trap with a catch in it, a can of poison, the pavilion cat on watch. The trophy
wall: a rat skull on a shield and the КРЫСИНЫЙ КОРОЛЬ poster. Rat meat for the trader waits in
crates by the door with a hand cart; the tally of kills is chalked on a board.

Lessons from the critique rounds (keep them when you touch this room):
  * A different cage from the mine's on purpose: the mine's is set into the wall under I-beams,
    this one is a freestanding mesh shaft with a warning header and an arrow pointing down, and
    the wall is three tiles tall (a pavilion), so both lifts don't read as the same building.
  * The rope rig is top layer, so it must never cross a sign: a pulley hung over the header
    covered «ОСТОРОЖНО», a diagonal rope to the winch crossed «КОРОЛЬ». Now the beam runs along
    the very top of the wall, the rope goes along under it and drops vertically, and the drop
    into the lift is drawn by the shaft itself (behind its header). Sheave A sits over the rope
    inside the shaft (x 65), sheave B over the drum (x 109); the poster starts right of it.
  * A grey cat in a rat room reads as one more rat. The cat is NA's ginger.
  * The whiskers on the poster first crossed under the rat's chin — skull and crossbones. They
    fan out sideways now.
  * A broom head drawn as a straw triangle reads as a bell; it needs a fan of dark twigs and a
    red binding. A heap of drumsticks on the cart was a pink blob; a crate of them reads.
  * Three identical МЯСО crates in a room are repetition, not density.
  * The lantern in the cage hung behind the folded gate and vanished; it hangs on the right.
    It is its own small sprite (the shaft stays one frame), like the mine's signal lamp.
  * At night the liftman's corner had no light of its own: his lantern stands on the lever
    stand.
"""
from __future__ import annotations

import math

from art_industry import (HAZ_K, HAZ_Y, WARM, footprints, grit, hazard, lantern, lattice,
                          paper_sheet, plate, puddle, rat, stain, txt)
from kit import INK, P, barrel, crate, ink, sack, shell, wheelbarrow, window
from lib import T, Img, Map, camp, grid, na, outline, ramp, rng

W, H = 12, 14
FACE = 3
SHAFT_X0 = 38                  # px, left edge of the mesh shaft
IRONWALL = ['#2a2624', '#3b3531', '#4d4640', '#61584f', '#786d61']


# ------------------------------------------------------------------------------------ art
def iron_wall(w: int, h: int) -> Img:
    """Riveted iron plates in staggered rows, rivets along every seam, rust running down from some
    of them, a darker plinth plate along the floor."""
    c = IRONWALL
    r = rng('ironwall')
    out = Img.new(w, h, c[2])
    pw, ph = 32, 16
    for row in range(0, h // ph + 1):
        off = (row % 2) * (pw // 2)
        y = row * ph
        for col in range(-1, w // pw + 2):
            x = col * pw - off
            base = r.choice([2, 2, 3, 1])
            out.rect_(x, y, pw, ph, c[base])
            out.rect_(x, y, pw, 1, c[min(4, base + 1)])
            out.rect_(x, y + ph - 1, pw, 1, c[0])
            out.rect_(x + pw - 1, y, 1, ph, c[0])
            for rx in range(x + 2, x + pw - 1, 5):
                out.px_(rx, y + 2, c[4]); out.px_(rx, y + 3, c[0])
                out.px_(rx, y + ph - 3, c[4]); out.px_(rx, y + ph - 2, c[0])
            if r.random() < 0.45:
                sx = x + r.randrange(3, pw - 3)
                out.rect_(sx, y + 3, 1, r.randrange(4, ph - 2), P['rust'][r.randrange(1, 4)], 0.7)
    out.rect_(0, h - 10, w, 10, c[1]); out.rect_(0, h - 10, w, 1, c[3])
    for rx in range(2, w, 6):
        out.px_(rx, h - 8, c[3])
    return out


def checker_plate(g: Img, x0: int, y0: int, w: int, h: int) -> None:
    """A steel tread plate on the floor: raised diamonds in alternating directions, a lit edge."""
    ir = P['iron']
    g.rect_(x0, y0, w, h, ir[2])
    for y in range(y0 + 1, y0 + h - 1, 3):
        for x in range(x0 + 1, x0 + w - 1, 4):
            o = ((y - y0) // 3) % 2 * 2
            g.px_(x + o, y, ir[3]); g.px_(x + o + 1, y + 1, ir[1])
    g.rect_(x0, y0, w, 1, ir[4])
    g.rect_(x0, y0 + h - 1, w, 1, INK)
    g.rect_(x0, y0, 1, h, INK); g.rect_(x0 + w - 1, y0, 1, h, INK)
    for x in (x0 + 2, x0 + w - 3):
        for y in (y0 + 2, y0 + h - 3):
            g.px_(x, y, ir[4])


def shaft() -> Img:
    """The lift: a freestanding mesh shaft, 56 × 68, feet = the landing. Angle-iron corner posts
    with rivets, a header plate ОСТОРОЖНО, КРЫСЫ!, a mesh transom with the rope coming down, the
    scissor door folded open, and inside the cage: riveted plates, a lantern, a yellow arrow
    pointing down, a plank floor. The lantern in the cage is its own small animated object
    (`cage_lantern`), so the big shaft sprite stays one frame."""
    w, h = 56, 68
    out = Img.new(w, h)
    ir = P['iron']
    c = IRONWALL
    y_hdr, y_tr, y_op = 0, 17, 29                     # header, transom, door opening
    # the shaft behind everything: dark
    out.rect_(4, y_tr, w - 8, h - y_tr, '#0f0d10')
    # rope from the header down to the cage's hanger
    out.rect_(27, y_tr, 1, y_op - y_tr + 2, ir[3]); out.rect_(28, y_tr, 1, y_op - y_tr + 2, ir[0])
    # transom mesh
    for y in range(y_tr, y_op):
        for x in range(4, w - 4):
            if (x + y) % 4 == 0 or (x - y) % 4 == 0:
                out.px_(x, y, '#7c7a76')
    # the cage: riveted walls, lantern, arrow, plank floor
    cx0, cx1 = 8, w - 8
    out.rect_(cx0, y_op + 1, cx1 - cx0, h - y_op - 5, c[1])
    for x in range(cx0, cx1, 10):
        out.rect_(x, y_op + 1, 1, h - y_op - 8, c[0])
        for y in range(y_op + 3, h - 8, 4):
            out.px_(x + 2, y, c[3])
    out.rect_(cx0, y_op + 1, cx1 - cx0, 3, c[3]); out.rect_(cx0, y_op + 1, cx1 - cx0, 1, c[4])
    ar = [(30, 38), (33, 38), (33, 44), (36, 44), (31.5, 49), (27, 44), (30, 44)]         # arrow ↓
    out.poly_(ar, HAZ_Y)
    out.rect_(cx0, h - 8, cx1 - cx0, 5, P['wood'][2])
    for x in range(cx0, cx1, 5):
        out.rect_(x, h - 8, 1, 5, P['wood'][0])
    out.rect_(cx0, h - 8, cx1 - cx0, 1, P['wood'][3])
    # the scissor door folded to the left, its track
    out.rect_(4, y_op - 1, w - 8, 2, ir[2]); out.rect_(4, y_op - 1, w - 8, 1, ir[3])
    out.paste_(lattice(12, h - y_op - 5, 0.0, ir[2], ir[4]), 5, y_op + 1)
    out.rect_(17, y_op + 1, 2, h - y_op - 5, ir[3]); out.rect_(17, y_op + 1, 1, h - y_op - 5, ir[4])
    # threshold: tread plate with a hazard nose
    out.rect_(2, h - 4, w - 4, 4, ir[2]); out.rect_(2, h - 4, w - 4, 1, ir[3])
    out.paste_(hazard(w - 4, 2, 2), 2, h - 2)
    # header: a heavy plate across the posts, the warning sign on it
    out.rect_(0, y_hdr, w, y_tr, c[2]); out.rect_(0, y_hdr, w, 1, c[4]); out.rect_(0, y_tr - 2, w, 2, c[0])
    # corner posts: angle iron, rivets
    for px0, lit in ((0, True), (w - 5, False)):
        out.rect_(px0, 0, 5, h, ir[2])
        out.rect_(px0 + (0 if lit else 3), 0, 2, h, ir[3] if lit else ir[1])
        for y in range(3, h - 2, 5):
            out.px_(px0 + 2, y, ir[4] if lit else ir[3])
    out = ink(out)
    sign = plate(['ОСТОРОЖНО,', 'КРЫСЫ!'], HAZ_K, HAZ_Y, pad=1)
    out.paste_(sign, (w - sign.w) // 2, 1)
    return out


def rig_top() -> Img:
    """Under the ceiling (top layer): an I-beam along the top of the wall with two sheaves hanging
    from it — A over the lift's rope, B over the winch drum — and the rope running between them
    under the beam; from B it drops to the drum. The drop into the lift is behind the shaft's
    header, drawn by the shaft itself, so nothing here crosses the warning sign. 80 × 40; sheave
    A centre at x 26, B at x 70 (the rope drops from B's centre line)."""
    w, h = 80, 40
    out = Img.new(w, h)
    ir = P['iron']
    out.rect_(0, 0, w, 6, ir[2]); out.rect_(0, 0, w, 1, ir[4]); out.rect_(0, 5, w, 1, ir[0])
    for x in range(3, w, 6):
        out.px_(x, 2, ir[4]); out.px_(x, 3, ir[0])
    for px in (26, 70):
        out.rect_(px - 1, 6, 3, 2, ir[1])
        out.ellipse_(px + 0.5, 11.5, 4.5, 4.5, ir[1])
        out.ellipse_(px + 0.5, 11.5, 3.3, 3.3, ir[3])
        out.ellipse_(px + 0.5, 11.5, 1.2, 1.2, INK)
    out = ink(out)
    out.rect_(26, 7, 44, 1, ir[3])
    out.rect_(26, 12, 1, 5, ir[3]); out.rect_(27, 12, 1, 5, ir[0])
    out.rect_(70, 12, 1, h - 12, ir[3]); out.rect_(71, 12, 1, h - 12, ir[0])
    return out


def winch() -> Img:
    """The winch: a drum wound with cable between flanges on two cast-iron stands, a big gear on
    its end driven by a green motor, a brake lever with a red knob. 50 × 40."""
    w, h = 50, 40
    out = Img.new(w, h)
    ir = P['iron']
    # stands (A-frames)
    for sx in (3, 27):
        out.poly_([(sx, h - 2), (sx + 3, 12), (sx + 5, 12), (sx + 8, h - 2)], ir[1])
        out.poly_([(sx, h - 2), (sx + 3, 12), (sx + 4, 12), (sx + 2, h - 2)], ir[2])
        out.rect_(sx - 1, h - 3, 10, 3, ir[1]); out.rect_(sx - 1, h - 3, 10, 1, ir[2])
    # the drum, wound with cable
    out.rect_(6, 6, 24, 16, '#26262c')
    for y in range(6, 22, 2):
        out.rect_(6, y, 24, 1, '#3e3e47')
        out.px_(7 + (y * 7) % 20, y, '#6a6a76')
    out.rect_(6, 6, 24, 1, '#5a5a66')
    for fx in (4, 30):
        out.rect_(fx, 3, 3, 22, ir[2]); out.rect_(fx, 3, 1, 22, ir[4])
        out.rect_(fx, 13, 3, 2, INK)
    # the big gear on the drum's end, a pinion under it and the motor
    gx, gy = 40, 13
    for i in range(12):
        a = i * math.pi / 6
        out.rect_(int(gx + math.cos(a) * 8) - 1, int(gy + math.sin(a) * 8) - 1, 3, 3, ir[1])
    out.ellipse_(gx + 0.5, gy + 0.5, 7.5, 7.5, ir[2])
    out.ellipse_(gx, gy, 6, 6, ir[3])
    for a in (0.3, 1.9, 3.5, 5.1):
        out.line_(gx, gy, int(gx + math.cos(a) * 5), int(gy + math.sin(a) * 5), ir[1])
    out.ellipse_(gx + 0.5, gy + 0.5, 2, 2, ir[1])
    out.rect_(33, 24, 16, 13, '#3f6b4f'); out.rect_(33, 24, 16, 1, '#6a9a78'); out.rect_(33, 24, 2, 13, '#5a8a6a')
    for fy in range(27, 36, 2):
        out.rect_(36, fy, 11, 1, '#2c4a38')
    out.rect_(33, h - 3, 16, 3, ir[1])
    # brake lever
    out.line_(1, 20, 5, 1, ir[3]); out.line_(2, 20, 6, 1, ir[1])
    out.rect_(4, 0, 4, 3, '#c9463a')
    out = ink(out)
    out.px_(5, 0, '#f08a7a')
    return out


def lever_stand(frame: int = 0) -> Img:
    """The liftman's lever stand: a cast-iron pedestal with three brass-handled levers (one pulled
    back), a round dial, and his lantern standing on the corner (the flame breathes by frame).
    34 × 26."""
    w, h = 34, 26
    out = Img.new(w, h)
    ir = P['iron']
    top = 9
    out.rect_(1, top, 29, 7, ir[3]); out.rect_(1, top, 29, 1, ir[4])
    out.poly_([(3, top + 7), (27, top + 7), (24, h - 3), (6, h - 3)], ir[2])
    out.poly_([(3, top + 7), (8, top + 7), (9, h - 3), (6, h - 3)], ir[3])
    out.rect_(4, h - 3, 22, 3, ir[1]); out.rect_(4, h - 3, 22, 1, ir[2])
    out.rect_(12, top + 9, 6, 5, ir[1]); out.rect_(13, top + 10, 4, 1, '#d8b766')
    for lx, tip in ((5, 0), (11, 3), (17, 1)):
        out.rect_(lx, top + 2, 3, 2, INK)
        out.rect_(lx + 1, tip + 3, 1, top + 2 - tip - 3, ir[4])
        out.rect_(lx, tip, 3, 3, '#b8943a'); out.px_(lx, tip, '#f0d78a')
    out.ellipse_(24.5, top + 3.5, 3.5, 3.5, ir[1]); out.ellipse_(24.5, top + 3.5, 2.5, 2.5, '#ece6d2')
    out.line_(24, top + 3, 25, top + 1, INK)
    out = ink(out)
    out.paste_(lantern(frame, hang=False), 25, 0)
    return out


def crown_poster() -> Img:
    """«КРЫСИНЫЙ КОРОЛЬ»: a wanted poster — a gold crown over a grey rat's head with red eyes, two
    lines of text, torn corner, pinned. 41 × 34."""
    w, h = 41, 34
    out = Img.new(w, h)
    pa = P['paper']
    out.rect_(0, 0, w, h, pa[2]); out.rect_(0, 0, w, 1, pa[3]); out.rect_(0, h - 1, w, 1, pa[0])
    out.rect_(w - 1, 0, 1, h, pa[1])
    # the rat's head: rounded, big ears, pointed snout down, red eyes
    rg = ['#4d4a50', '#6a6670', '#8a8690']
    out.ellipse_(20.5, 15, 7, 6, rg[1]); out.ellipse_(20, 14.5, 5.5, 4.5, rg[2])
    out.ellipse_(13.5, 11, 3, 3, rg[1]); out.ellipse_(27.5, 11, 3, 3, rg[1])
    out.ellipse_(13.5, 11, 1.6, 1.6, '#c98a8a'); out.ellipse_(27.5, 11, 1.6, 1.6, '#c98a8a')
    out.poly_([(16, 17), (25, 17), (20.5, 22)], rg[2])
    out.px_(20, 21, '#2a2226'); out.px_(21, 21, '#2a2226')
    out.px_(17, 14, '#e8302a'); out.px_(23, 14, '#e8302a')
    for y, dx in ((18, 0), (20, 1)):                             # whiskers, fanning out sideways
        out.rect_(10 + dx, y, 5, 1, '#5a5058'); out.rect_(26, y, 5 - dx, 1, '#5a5058')
    # crown
    g = P['gold']
    out.poly_([(14, 9), (14, 3), (17, 6), (20.5, 2), (24, 6), (27, 3), (27, 9)], g[3])
    out.rect_(14, 8, 14, 2, g[2]); out.px_(20, 4, '#e8302a'); out.px_(15, 4, g[4]); out.px_(26, 4, g[4])
    t1 = txt('КРЫСИНЫЙ', '#6e1c1c')
    t2 = txt('КОРОЛЬ', '#2a2226')
    out.paste_(t1, (w - t1.w) // 2, 23)
    out.paste_(t2, (w - t2.w) // 2, 28)
    out = ink(out)
    out.px_(w - 2, 1, pa[1]); out.px_(w - 3, 1, pa[1]); out.px_(w - 2, 2, pa[1])      # torn corner
    out.px_(2, 1, '#c9463a')
    return out


def skull_plaque() -> Img:
    """A trophy: a big rat skull on a dark wooden shield — long snout, two yellow incisors, deep
    eye sockets. 20 × 22."""
    w, h = 20, 22
    out = Img.new(w, h)
    wd = P['wood']
    out.poly_([(1, 1), (19, 1), (19, 13), (10, 21), (1, 13)], wd[1])
    out.poly_([(1, 1), (19, 1), (19, 3), (1, 3)], wd[2])
    out.poly_([(3, 3), (17, 3), (17, 12), (10, 19), (3, 12)], wd[2])
    out = ink(out)
    sk = grid([
        '..kkkkkk..',
        '.kbbbbbbk.',
        'kbbbbbbbbk',
        'kbkkbbkkbk',
        'kbkkbbkkbk',
        '.kbbbbbbk.',
        '..kbbbbk..',
        '..kbkkbk..',
        '...kbbk...',
        '...kyyk...',
        '...kyyk...',
        '....kk....',
    ], {'k': INK, 'b': '#e6dcc4', 'y': '#e2c050'})
    out.paste_(sk, 5, 4)
    return out


def chalk_board() -> Img:
    """The liftman's tally on a blackboard easel: a chalk rat, tally marks in fives, a crossed-out
    crown. 26 × 34."""
    w, h = 26, 34
    out = Img.new(w, h)
    wd = P['wood']
    out.line_(4, 20, 1, h - 1, wd[2]); out.line_(21, 20, 24, h - 1, wd[1]); out.line_(12, 20, 13, h - 2, wd[1])
    out.rect_(0, 0, w, 22, wd[2]); out.rect_(0, 0, w, 1, wd[4])
    out.rect_(2, 2, w - 4, 18, '#233029'); out.rect_(2, 2, w - 4, 1, '#34473b')
    out.rect_(1, 21, w - 2, 2, wd[3])
    out = ink(out)
    ch = '#dfe6dc'
    # a chalk rat
    out.line_(4, 8, 9, 6, ch); out.line_(9, 6, 11, 8, ch); out.line_(4, 8, 10, 9, ch); out.px_(12, 7, ch)
    out.line_(3, 8, 2, 11, ch)
    # tallies: two full fives and three
    for gx in (5, 12):
        for i in range(4):
            out.rect_(gx + i, 12, 1, 5, ch)
        out.line_(gx - 1, 16, gx + 4, 12, ch)
    for i in range(3):
        out.rect_(19 + i * 1, 12, 1, 5, ch)
    # crossed-out crown
    out.poly_([(16, 8), (16, 4), (18, 6), (19.5, 3), (21, 6), (23, 4), (23, 8)], '#00000000')
    for x, y in ((16, 7), (16, 5), (17, 6), (19, 4), (21, 6), (22, 5), (22, 7), (17, 8), (18, 8), (19, 8), (20, 8), (21, 8)):
        out.px_(x, y, ch)
    out.line_(15, 3, 23, 9, '#e8a0a0')
    out.rect_(20, 21, 3, 1, '#f4f4ee')                               # a stick of chalk on the ledge
    return out


def rat_hole(frame: int) -> Img:
    """A hole gnawed at the foot of the iron wall: a ragged dark arch, two red eyes that blink by
    frame (open, open, open, shut). 14 × 10."""
    w, h = 14, 10
    out = Img.new(w, h)
    out.poly_([(0, h), (1, 5), (3, 2), (6, 0), (9, 1), (12, 3), (13, 6), (14, h)], '#070607')
    out.px_(2, 4, P['rust'][2]); out.px_(11, 3, P['rust'][2]); out.px_(12, 5, P['rust'][1])
    if frame % 4 != 3:
        out.px_(5, 5, '#ff3a2a'); out.px_(8, 5, '#ff3a2a')
        if frame % 4 == 1:
            out.px_(5, 4, '#ff9a8a')
    return out


def trap(set_: bool = True) -> Img:
    """A spring rat trap on its board with a wedge of cheese on the pedal. 12 × 7."""
    out = Img.new(12, 7)
    wd, ir = P['wood'], P['iron']
    out.rect_(0, 2, 12, 5, wd[3]); out.rect_(0, 2, 12, 1, wd[4]); out.rect_(0, 6, 12, 1, wd[1])
    out.rect_(1, 3, 10, 1, ir[3]); out.rect_(1, 3, 1, 3, ir[3]); out.rect_(10, 3, 1, 3, ir[3])
    out.rect_(5, 4, 3, 2, ir[2])
    out = ink(out)
    out.poly_([(7, 1), (10, 3), (7, 3)], '#e8c14e'); out.px_(7, 1, '#fbe594'); out.px_(8, 2, '#c2952a')
    return out


def cage_trap() -> Img:
    """A wire cage trap with a caught rat inside, its tail through the bars. 18 × 13."""
    w, h = 18, 13
    out = Img.new(w, h)
    ir = P['iron']
    r_ = rat(0, 1)
    out.paste_(r_, 3, 3)
    for x in range(1, w - 1, 3):
        out.rect_(x, 1, 1, h - 2, ir[3])
    out.rect_(0, 1, w, 1, ir[3]); out.rect_(0, h - 2, w, 1, ir[2]); out.rect_(0, 6, w, 1, ir[2])
    out.rect_(8, 0, 2, 1, ir[3])
    out = outline(out.crop(0, 0, w, h), INK).crop(1, 1, w, h)
    out.line_(0, h - 3, 0, h - 2, '#c98a8a')
    return out


def poison_can() -> Img:
    """A tin of rat poison: a skull label and ЯД on it. 11 × 13."""
    w, h = 11, 13
    out = Img.new(w, h)
    ir = P['iron']
    out.rect_(0, 2, w, h - 2, ir[3]); out.rect_(0, 2, 3, h - 2, ir[4]); out.rect_(w - 3, 2, 3, h - 2, ir[2])
    out.ellipse_(5.5, 2, 5.5, 2, ir[4])
    out.rect_(1, 5, w - 2, 7, '#d8a632')
    out = ink(out)
    sk = grid(['.kkk.', 'kwwwk', 'kwkwk', '.kwk.'], {'k': '#2a1a16', 'w': '#f0e8d0'})
    out.paste_(sk, 3, 6)
    return out


def gnawed_crate(seed: int = 1, dark: bool = False) -> Img:
    """A crate with a hole gnawed through its corner (ragged dark bite, chips) — the rats got in.
    16 × 16."""
    out = crate(16, 16, dark=dark)
    r = rng('gnaw', seed)
    x0, y0 = (10, 9) if seed % 2 else (1, 10)
    bite = [(x0, y0 + 2), (x0 + 1, y0), (x0 + 3, y0 + 1), (x0 + 5, y0), (x0 + 5, y0 + 6), (x0, y0 + 6)]
    out.poly_(bite, '#0b0809')
    for i in range(4):
        out.px_(x0 + r.randrange(0, 5), y0 + r.randrange(0, 2), P['wood'][4])
    return out


def meat_crate(open_: bool = True) -> Img:
    """A crate of rat meat for the trader: drumsticks heaped in it and a МЯСО stencil. 20 × 20."""
    w, h = 20, 20
    out = Img.new(w, h)
    cr = crate(20, 15)
    if open_:
        m = camp(na('Items/Food/Meat.png'), sat=0.8)
        out.paste_(m.crop(0, 0, 15, 12), 1, 0)
        out.paste_(m.flip().crop(0, 0, 15, 12), 6, 1)
    out.paste_(cr, 0, 5)
    st = txt('МЯСО', '#e8dcc4')
    out.rect_(2, 11, st.w + 2, 7, '#5c3d2e')
    out.paste_(st, 3, 12)
    return out


def gnawed_sack() -> Img:
    """A grain sack gnawed open at the bottom, grain spilling out. 16 × 13."""
    s = Img.new(16, 13)
    s.paste_(sack('#a79a78'), 1, 0)
    s.poly_([(3, 10), (5, 8), (7, 10), (6, 12)], '#0b0809')
    for x, y in ((2, 12), (4, 12), (7, 12), (9, 12), (11, 12), (5, 11)):
        s.px_(x, y, '#e2c878')
    return s


def cat(frame: int) -> Img:
    """The pavilion cat on watch: NA's ginger cat sitting up (graded into the camp) — ginger on
    purpose, a grey cat in a rat room reads as one more rat; it blinks on the last frame."""
    sheet = na('Actor/Animals/Cat/SpriteSheet.png')
    c = camp(sheet.crop(0, 0, 16, 16), sat=0.8)
    if frame % 4 == 3:
        b = c.a
        for y in range(3, 8):
            for x in range(6, 15):
                if b[y, x, 3] and int(b[y, x, 0]) + int(b[y, x, 1]) + int(b[y, x, 2]) < 120:
                    left = b[y, x - 1, :3]
                    b[y, x, :3] = left if int(left[0]) > 60 else b[y - 1, x, :3]
    return c


def broom() -> Img:
    """A broom leaning on the crates: a pale birch handle and a fan of dark twigs bound with a red
    cord, wide at the bottom. 10 × 28."""
    w, h = 10, 28
    out = Img.new(w, h)
    wd = P['wood']
    out.line_(7, 0, 5, 17, wd[4]); out.line_(8, 0, 6, 17, wd[2])
    out.poly_([(3, 16), (7, 16), (10, 27), (0, 27)], '#6e5a2c')
    out.poly_([(3, 16), (5, 16), (3, 27), (0, 27)], '#937a3c')
    for x in range(1, 10, 2):
        out.line_(5, 17, x, 27, '#4e3f1e')
    out.rect_(3, 17, 5, 2, '#a8323b')
    return ink(out)


def lantern_crate(frame: int) -> Img:
    """A lit lantern standing on an upturned crate. 16 × 30."""
    out = Img.new(16, 30)
    out.paste_(crate(16, 15, dark=True), 0, 15)
    out.paste_(lantern(frame, hang=False), 4, 1)
    return out


def loaded_barrow() -> Img:
    """The hand cart that takes the meat to the trader: a small crate of drumsticks on it. 26 × 22."""
    m = camp(na('Items/Food/Meat.png'), sat=0.8)
    box = Img.new(16, 14)
    box.paste_(m.crop(0, 0, 15, 12), 1, 0)
    box.paste_(crate(14, 8), 1, 6)
    out = Img.new(26, 22)
    out.paste_(wheelbarrow(), 0, 6)
    out.paste_(box, 5, 0)
    return out


def rat_run(frame: int) -> Img:
    """A rat scurrying along the floor, seen from the side: long body, pink tail curving behind,
    legs a blur that changes by frame. 16 × 7."""
    g0 = [
        '........kk......',
        '...kkkkk22kk....',
        'pkk2333332e2k...',
        '.pk333333332nk..',
        '..kk3k33k3kkk...',
        '...k.k..k.k.....',
        '................',
    ]
    g1 = [
        '........kk......',
        '...kkkkk22kk....',
        '.kk2333332e2k...',
        'pk3333333332nk..',
        'p.kk33k33kkk....',
        '....kk..kk......',
        '................',
    ]
    r = ramp('#6a6268', 4, 0.34)
    pal = {'k': INK, '2': r[1], '3': r[2], 'p': '#c98a8a', 'e': '#ff4a3a', 'n': '#d88a8a'}
    return grid(g0 if frame % 2 == 0 else g1, pal)


# ------------------------------------------------------------------------------------ map
def build() -> Map:
    m = Map('lift', W, H, 'indoor', name='Лифт в подземелье', ambient=0.5, music='dungeon')
    shell(m, 'stone', 'na-dark', face=FACE, door=(5, 2), out_to='square', out_at='lift', floor_seed=4)
    g = m.ground
    wall = iron_wall((W - 2) * T, FACE * T - 3)
    m.stamp(wall, T, T)
    g.rect_(T, T, (W - 2) * T, 2, '#000000', 0.35)
    fy = (1 + FACE) * T                                                   # first floor row (px)

    # --- floor: a tread plate before the lift, a sewer grate, droppings, chips, water, a trail
    checker_plate(g, SHAFT_X0 - 4, fy + 2 * T, 64, 12)
    gx, gy = 7 * T + 4, 8 * T + 6
    g.rect_(gx, gy, 16, 10, INK); g.rect_(gx + 1, gy + 1, 14, 8, '#0b0809')
    for x in range(gx + 2, gx + 15, 3):
        g.rect_(x, gy + 1, 1, 8, P['iron'][3])
    g.rect_(gx + 1, gy + 1, 14, 1, P['iron'][4])
    puddle(g, gx + 8, gy + 14, 6, 2)
    stain(g, 3 * T, 11 * T, 22, 10, '#141012', 0.22)
    r = rng('droppings')
    for cx, cy, n in ((2 * T, 5 * T, 18), (T + 10, 8 * T, 12), (9 * T, 11 * T, 10), (5 * T, 10 * T, 8),
                      (10 * T, 7 * T, 8), (7 * T, 12 * T, 6)):
        for _ in range(n):
            x, y = int(r.gauss(cx, 10)), int(r.gauss(cy, 6))
            if T < x < (W - 1) * T and fy < y < (H - 1) * T:
                g.rect_(x, y, 2, 1, '#1a1210'); g.px_(x, y - 1, '#3a2a22', 0.6)
    grit(g, T, fy, (W - 1) * T, (H - 1) * T, [P['wood'][3], P['wood'][2], P['straw'][2]], 50, 6)
    footprints(g, [(6 * T, 12 * T + 8), (5 * T, 9 * T), (4 * T + 8, fy + 2 * T + 14)], seed=11, alpha=0.24)
    for x, y in ((3 * T, 7 * T + 4), (4 * T + 2, 7 * T + 9), (8 * T + 3, 9 * T + 12)):     # rat tracks
        for k in range(5):
            g.px_(x + k * 3, y + (k % 2), '#1a1210', 0.5)

    # --- north wall: barred window high up, the rat hole under it, the crown poster, the skull
    m.stamp(window(20, 18, bars=4, frame='iron'), T + 2, T + 4)
    m.light(T + 12, 3 * T, 44, '#9fc4d0', 'window')
    m.put('lift.hole', [rat_hole(i) for i in range(4)], T + 6, fy - 10, base=fy - 1, fps=2)
    m.stamp(crown_poster(), 7 * T, T + 1)
    m.stamp(skull_plaque(), 10 * T - 5, T + 4)
    m.stamp(paper_sheet(9, 11, 3), 10 * T - 1, T + 28)

    # --- the lift (use door), the rig under the ceiling, the winch; the liftman at his levers
    m.put('lift.shaft', shaft(), SHAFT_X0, fy + 2 * T - 68, solid=(2.5, 4, 6, 6))
    # the lantern hanging in the cage: drawn just after the shaft (base + 1), right of the gate
    m.put('lift.cagelantern', [lantern(i, hang=True) for i in range(4)], SHAFT_X0 + 38, fy + 2 * T - 68 + 34,
          base=fy + 2 * T + 1, fps=4)
    m.door(3, 6, 2.5, 0.9, '@dungeon', '', kind='use', label='Спуститься', lock='dungeon')
    m.light(SHAFT_X0 + 18, fy + 2 * T - 26, 34, WARM, 'candle')
    m.emit('drip', SHAFT_X0 + 30, fy + 4, 0.5)
    m.put('lift.rig', rig_top(), SHAFT_X0 + 1, T, layer='top')
    m.put('lift.winch', winch(), 6 * T + 2, fy + T + 8 - 40, solid=(6, 4, 9, 5.5))
    m.emit('dust', 7 * T + 4, fy + T, 0.4)
    m.npc('liftman', 'liftman', 7.75, 5.85, face=0, anim='idle', name='Лифтёр')
    m.put('lift.levers', [lever_stand(i) for i in range(4)], 7 * T - 6, 7 * T - 26, fps=5, solid=(7, 6, 9, 7))
    m.light(8 * T + 12, 6 * T + 2, 46, WARM, 'candle')
    m.put('lift.chalk', chalk_board(), 10 * T - 6, 8 * T - 34, solid=(9.75, 7.25, 11, 8))

    # --- rat meat for the trader: crates, one open, the hand cart to take them away
    m.put('lift.meat', meat_crate(True), 9 * T + 12, fy + T + 8 - 20, solid=(9.5, 4.5, 11, 5.5))
    m.put('lift.meat.shut', meat_crate(False), 9 * T + 6, 12 * T + 14 - 20, solid=(9.25, 12, 10.75, 13))
    m.put('lift.barrow', loaded_barrow(), 7 * T + 10, 12 * T + 14 - 22, solid=(7.5, 12.25, 9, 13))
    m.put('kit.crate', crate(), 10 * T - 2, 11 * T + 10 - 16, solid=(9.75, 10.75, 11, 11.75))

    # --- west: traps by the hole, the gnawed sack and crates, a rat caught, poison, the cat
    m.put('lift.trap', trap(), T + 4, fy + 5)
    m.put('lift.trap.2', trap(), 2 * T + 6, 7 * T + 12)
    m.put('lift.sack', gnawed_sack(), T, fy + T + 10 - 13, solid=(1, 5, 2, 5.75))
    m.put('lift.crate.a', gnawed_crate(1), T, 8 * T + 4 - 16, solid=(1, 7.25, 2, 8.25))
    m.put('lift.crate.b', gnawed_crate(2, dark=True), T + 3, 7 * T + 8 - 16)
    m.put('lift.rat', [rat(i, 1) for i in range(2)], 2 * T + 2, 8 * T + 4 - 9, fps=3)
    m.put('lift.broom', broom(), 2 * T + 5, 9 * T + 4 - 28, solid=(2.5, 8.75, 3, 9.25))
    m.put('lift.cagetrap', cage_trap(), T + 2, 10 * T + 12 - 13, solid=(1, 10, 2.25, 10.75))
    m.put('lift.poison', poison_can(), 2 * T + 6, 10 * T + 12 - 13, solid=(2.5, 10.25, 3.25, 10.75))
    m.put('kit.barrel', barrel(), T + 1, 12 * T + 14 - 18, solid=(1, 12, 2, 13))
    m.put('lift.lantern', [lantern_crate(i) for i in range(4)], 2 * T + 6, 13 * T - 30, fps=5,
          solid=(2.5, 12.25, 3.5, 13))
    m.light(3 * T - 2, 12 * T, 40, WARM, 'candle')
    m.put('lift.ratrun', [rat_run(i) for i in range(2)], 6 * T + 2, 10 * T + 2 - 7, fps=8)
    m.put('lift.cat', [cat(i) for i in range(4)], 3 * T + 8, fy + 2 * T + 13 - 16, fps=1.2)

    # --- lanterns hanging from the beam and hooks (top layer), their warm light
    for lx, ly in ((5 * T, 9 * T + 4), (8 * T + 8, 10 * T)):
        frames = [lantern(i) for i in range(4)]
        cord = Img.new(9, 18)
        cord.rect_(4, 0, 1, 18, '#262224')
        hung = []
        for f in frames:
            im = Img.new(9, 33)
            im.paste_(cord, 0, 0)
            im.paste_(f, 0, 18)
            hung.append(im)
        m.put('lift.lantern.hang', hung, lx - 4, ly - 33, layer='top', fps=5)
        m.light(lx, ly - 6, 60, WARM, 'lamp')
    m.marks['liftman'] = (7.75, 5.85)
    return m
