"""Шахта изнутри (v2.80) — the hoist house over the shaft, where the player goes DOWN into the mine.

12 × 14 tiles: red brick walls with a band of green oil paint, a concrete floor with a track
drawn into it. The cage (клеть) is set into the north wall: I-beam posts and header in hazard
paint, the dark shaft behind, ropes going up through the header into the roof, a scissor gate
half open with an ore cart standing inside. The track runs out of the cage down the middle to a
buffer stop, two carts on it. The foreman (Бригадир) stands at the hoist desk in the north-east
under the floor board — 26 letters A–Z that light up as floors are opened, the current one
blinking. The lamp room fills the west: the charging rack of cap lamps with red/green charge
lights under the time clock and the safety poster, the lockers and their bench, a crate of
explosives. The east: drinking water, pit props, a cable drum, a barrel of tools, the fire board
and the coat stand by the door.

Lessons from the critique rounds (keep them when you touch this room):
  * The west wall has 55 px between the cap and the cage — the clock and the poster are sized to
    it (21 + 31). A wider poster ran under the cage frame and read «ТЕХНИ».
  * The kit font's Д reads as А at 3 px («ЗАРЯАКА»); `art_industry.txt` has wider Д/И/Ж/Ш/Ю.
  * A solid painted slab with yellow squares read as a vending machine. The charging rack is an
    open frame: dark back, round headlamps on black batteries, the charge light on the shelf lip.
    It stands against the north wall — a tall thing in the middle of a side wall leaves a
    walkable pocket behind it where the hero disappears.
  * A grey cylinder is a bin until it has a tap, a mug and a ВОДА plate.
  * A cable drum reads as a barrel until its flanges stand taller than the cable roll.
  * Two jackets on one hook are a lump; the coat stand shows its pole between them.
  * Inside the cage the parked cart must be lit (rust body, a bulb over it), otherwise the cage
    is a dark box; the scissor gate needs its lit bars and the handle bar to read as a gate.
  * Hanging lamps go over open floor, never over a tall object's label.
  * Solids are half-tile aligned: 4.25 snaps outward to 4.0 and eats the tile in front.
  * The resident's player tile is 1.65 tiles south of his feet across his counter, as in the
    forge; the desk first stood half a tile lower and put the player 2.15 away.
  * A bucket and an ore spill beside the track left only half-tile gaps on both sides of it.
    The east side of the track (x 6.5–8) stays empty from the door to the cage: that is the lane.
  * kit's concrete floor has large blotches that read as camouflage and glare next to the red
    wall; `art_industry.concrete_floor` is one calm tone with slab joints, painted over the shell.
  * kit's grey ore_pile read as trash bags; the spill is iron ore in its own colours.
  * Small animations don't animate big sprites: the red signal lamp is a 3 × 3 blinker on the
    post, the cage stays one frame.
"""
from __future__ import annotations

from art_industry import (COLD, concrete_floor, refloor, HAZ_K, HAZ_Y, HAZ_Y2, PAINT_BLUE, PAINT_GREEN, WARM, buffer_stop, cart,
                          footprints, grit, hazard, helmet, jacket, lamp_enamel, lattice, pebble, puddle,
                          ore_heap, rails_v, stain, txt)
from kit import INK, P, barrel, crate, ink, sack, shell, texture
from lib import T, Img, Map, outline, rng

W, H = 12, 14
CAGE_X = 96                    # px, centre of the cage and of the track
CW = 48                        # cage frame width


# ------------------------------------------------------------------------------------ art
def cage() -> Img:
    """The shaft in the north wall with the cage waiting at the landing. 48 × 72; the bottom row
    is the landing's floor line. Header and posts are riveted I-beams with hazard paint, the shaft
    behind is dark with timber guides, three ropes drop from the header onto the cage's hanger;
    the cage has a mesh back, a bulb, the track running in and a loaded cart parked inside, and a
    scissor gate folded half open. The signal lamps on the posts: green (cage at the landing)
    steady here, the red one is `signal_red`, a separate 3 × 3 blinker."""
    w, h = CW, 72
    out = Img.new(w, h)
    ir, wd = P['iron'], P['wood']
    # the shaft: dark, a little lighter high up
    for y in range(10, h):
        k = (y - 10) / (h - 10)
        out.rect_(5, y, w - 10, 1, '#1b1b24' if k < 0.2 else ('#141419' if k < 0.55 else '#0d0c11'))
    for gx in (6, 39):                                                    # timber guides
        out.rect_(gx, 10, 3, h - 10, wd[1]); out.rect_(gx, 10, 1, h - 10, wd[2])
        for y in range(14, h, 8):
            out.px_(gx + 1, y, ir[3])
    for cx, ex in ((20, 23), (24, 24), (28, 25)):                         # ropes
        out.line_(cx, 11, ex, 33, ir[3])
        out.line_(cx + 1, 11, ex + 1, 33, ir[0])
    x0, x1 = 10, 38
    out.poly_([(18, 38), (30, 38), (25, 32), (23, 32)], ir[2])           # hanger
    out.rect_(22, 30, 4, 3, ir[3]); out.rect_(23, 31, 2, 1, INK)
    out.rect_(x0, 38, x1 - x0, 6, ir[3]); out.rect_(x0, 38, x1 - x0, 1, ir[4])       # roof
    for x in range(x0 + 2, x1 - 1, 4):
        out.px_(x, 41, ir[1])
    out.rect_(x0, 43, x1 - x0, 1, ir[1])
    # inside: lit mesh back, bulb, floor with the rails
    out.rect_(x0 + 2, 44, x1 - x0 - 4, 26, '#2e2b35')
    for y in range(47, 64, 3):
        out.rect_(x0 + 2, y, x1 - x0 - 4, 1, '#403c4a')
    for x in range(x0 + 3, x1 - 2, 3):
        out.rect_(x, 46, 1, 18, '#403c4a')
    out.rect_(x0 + 2, 44, x1 - x0 - 4, 2, '#4a4555')
    out.rect_(22, 46, 4, 2, '#fff6d8'); out.px_(23, 48, '#ffe6a0'); out.px_(24, 48, '#ffe6a0')
    out.rect_(x0 + 2, 63, x1 - x0 - 4, 7, ir[1]); out.rect_(x0 + 2, 63, x1 - x0 - 4, 1, ir[2])
    for rx in (w // 2 - 7, w // 2 + 5):
        out.rect_(rx, 63, 1, 7, ir[4]); out.rect_(rx + 1, 63, 1, 7, ir[2])
    c = cart('rust', 'iron', seed=7)
    out.paste_(c, 14, 50)
    # cage posts and the lintel over the gate
    out.rect_(x0, 44, 2, 26, ir[3]); out.rect_(x0, 44, 1, 26, ir[4])
    out.rect_(x1 - 2, 44, 2, 26, ir[1])
    out.rect_(x0, 44, x1 - x0, 2, ir[2]); out.rect_(x0, 44, x1 - x0, 1, ir[3])
    # scissor gate folded half open to the left, its handle bar with a red grip
    out.paste_(lattice(12, 22, 0.0, ir[3], ir[4]), x0 + 2, 46)
    out.rect_(x0 + 14, 46, 2, 22, ir[3]); out.rect_(x0 + 14, 46, 1, 22, ir[4])
    out.rect_(x0 + 16, 55, 1, 3, '#c9463a')
    # sill
    out.rect_(x0 - 2, 68, x1 - x0 + 4, 4, ir[2]); out.rect_(x0 - 2, 68, x1 - x0 + 4, 1, ir[4])
    # header I-beam with the КЛЕТЬ plate between hazard paint
    out.rect_(0, 0, w, 12, ir[2])
    out.rect_(0, 0, w, 2, ir[3]); out.rect_(0, 0, w, 1, ir[4])
    out.rect_(0, 10, w, 2, ir[1])
    out.paste_(hazard(w, 6, 3), 0, 3)
    out.rect_(0, 3, w, 1, HAZ_Y2)
    sign = txt('КЛЕТЬ', '#f2ecd8')
    sx = (w - sign.w - 4) // 2
    out.rect_(sx, 2, sign.w + 4, 9, '#2f3a33'); out.rect_(sx, 2, sign.w + 4, 1, '#51625a')
    out.paste_(sign, sx + 2, 4)
    for x in range(2, w, 6):
        out.px_(x, 1, ir[4]); out.px_(x, 10, ir[3])
    # posts: riveted, hazard paint from the knee down
    for px0, lit in ((0, True), (w - 5, False)):
        out.rect_(px0, 10, 5, h - 10, ir[2])
        out.rect_(px0 + (1 if lit else 3), 10, 1, h - 10, ir[3] if lit else ir[1])
        out.rect_(px0, 10, 1, h - 10, ir[4] if lit else ir[2])
        for y in range(14, h - 18, 5):
            out.px_(px0 + 2, y, ir[4] if lit else ir[3])
        out.paste_(hazard(5, 18, 3, phase=1), px0, h - 20)
        out.rect_(px0, h - 2, 5, 2, ir[1])
    out = ink(out)
    # signal lamps on the posts: red (stop) left, green (go) right
    out.rect_(1, 13, 3, 3, INK)
    out.rect_(w - 4, 13, 3, 3, INK); out.rect_(w - 3, 14, 1, 1, '#5fe07a')
    return out


def signal_red(frame: int) -> Img:
    """The red signal lamp on the cage's left post, blinking. 3 × 3."""
    out = Img.new(3, 3, INK)
    out.px_(1, 1, '#ff5040' if frame % 2 == 0 else '#5a1c18')
    return out


def ropes_top() -> Img:
    """The three hoist ropes above the header, running up through the roof (top layer)."""
    out = Img.new(10, 10)
    ir = P['iron']
    for x in (1, 4, 7):
        out.rect_(x, 0, 1, 10, ir[3]); out.rect_(x + 1, 0, 1, 10, ir[0])
    out.rect_(0, 0, 10, 2, '#000000', 0.5)
    return out


def lamp_rack(frame: int) -> Img:
    """The charging rack: an open painted frame under a ЗАРЯДКА plate, two shelves of cap lamps —
    a round headlamp on its black battery — and on the shelf lip each slot's charge light: green
    done, red charging (blinking by frame); two slots are empty, their lamps are down the mine.
    42 × 34."""
    w, h = 42, 34
    out = Img.new(w, h)
    pg = PAINT_GREEN
    ir = P['iron']
    out.rect_(3, 8, w - 6, 22, '#151b18')                                 # dark back you see through
    out.rect_(0, 0, w, 8, pg[3]); out.rect_(0, 0, w, 1, pg[4]); out.rect_(0, 7, w, 1, pg[1])
    lab = txt('ЗАРЯДКА', '#eee6c8')
    out.rect_((w - lab.w) // 2 - 2, 1, lab.w + 4, 6, '#26302b')
    out.paste_(lab, (w - lab.w) // 2, 1)
    out.rect_(0, 0, 3, h, pg[3]); out.rect_(0, 0, 1, h, pg[4])
    out.rect_(w - 3, 0, 3, h, pg[2]); out.rect_(w - 1, 0, 1, h, pg[1])
    empty = {(0, 3), (1, 1)}
    red = {(0, 1), (1, 4), (1, 2)}
    for row in range(2):
        y = 8 + row * 11
        for s in range(5):
            x = 4 + s * 7
            if (row, s) not in empty:
                lit = (row * 5 + s) % 4 != 0
                out.ellipse_(x + 3, y + 2.5, 2.6, 2.6, ir[2])
                out.px_(x + 1, y + 1, ir[4]); out.px_(x + 2, y, ir[4])
                out.rect_(x + 2, y + 1, 3, 3, '#fff1b8' if lit else '#8f8a70')
                out.px_(x + 2, y + 1, '#ffffff' if lit else '#aaa48a')
                out.rect_(x + 1, y + 5, 5, 4, '#26292e'); out.rect_(x + 1, y + 5, 5, 1, '#4a4f57')
                out.rect_(x + 1, y + 7, 5, 1, HAZ_Y)
            else:
                out.rect_(x + 3, y + 3, 1, 5, '#0b0c0d')                  # the plug hanging loose
                out.rect_(x + 2, y + 7, 3, 2, ir[2])
            out.rect_(x - 1, y + 9, 8, 2, ir[2]); out.rect_(x - 1, y + 9, 8, 1, ir[3])
            if (row, s) in red:
                on = (frame + row + s) % 2 == 0
                led = '#ff4d3d' if on else '#6a2622'
            elif (row, s) in empty:
                led = '#3a3f3c'
            else:
                led = '#6cff7a'
            out.px_(x + 3, y + 10, led)
    out.rect_(0, h - 4, w, 4, pg[2]); out.rect_(0, h - 4, w, 1, pg[3])
    out.rect_(3, h - 1, 4, 1, pg[0]); out.rect_(w - 7, h - 1, 4, 1, pg[0])
    return ink(out)


def lockers() -> Img:
    """Three painted steel lockers: vent slits, number plates, handles; the middle door ajar with a
    sleeve in the dark, a hard hat and a lunch box on top. 38 × 40."""
    w, h = 38, 40
    out = Img.new(w, h)
    pb = PAINT_BLUE
    top = 6
    out.rect_(0, top, w, 4, pb[3]); out.rect_(0, top, w, 1, pb[4])
    for i in range(3):
        x = i * 12 + 1
        if i == 1:
            out.rect_(x, top + 4, 12, h - top - 6, '#15171c')
            out.rect_(x + 1, top + 5, 5, 16, '#4a5160'); out.rect_(x + 1, top + 5, 5, 1, '#6a7282')
            for yy in range(top + 8, top + 21, 3):
                out.rect_(x + 1, yy, 5, 1, '#353b47')
            out.rect_(x + 6, top + 4, 7, h - top - 6, pb[3]); out.rect_(x + 6, top + 4, 1, h - top - 6, pb[4])
            for yy in (top + 7, top + 9, top + 11):
                out.rect_(x + 8, yy, 4, 1, pb[1])
            out.rect_(x + 7, top + 17, 1, 3, P['iron'][4])
        else:
            out.rect_(x, top + 4, 11, h - top - 6, pb[2])
            out.rect_(x, top + 4, 1, h - top - 6, pb[3])
            out.rect_(x + 10, top + 4, 1, h - top - 6, pb[1])
            for yy in (top + 7, top + 9, top + 11):
                out.rect_(x + 3, yy, 6, 1, pb[0])
            out.rect_(x + 4, top + 14, 3, 2, '#e8e2c8'); out.px_(x + 5, top + 14, '#555555')
            out.rect_(x + 8, top + 17, 1, 3, P['iron'][4]); out.px_(x + 8, top + 20, P['iron'][1])
        out.rect_(x, h - 3, 11, 1, pb[1])
    out.rect_(0, h - 2, w, 2, pb[0])
    for x in (12, 24):
        out.rect_(x, top + 4, 1, h - top - 4, pb[0])
    out = ink(out.crop(0, top, w, h - top))
    full = Img.new(w, h)
    full.paste_(out, 0, top)
    full.paste_(helmet('#d8a632'), 3, 1)
    lb = Img.new(9, 6)
    lb.rect_(0, 1, 9, 5, '#8f4526'); lb.rect_(0, 1, 9, 1, '#b4633a'); lb.rect_(3, 0, 3, 1, P['iron'][2])
    full.paste_(ink(lb), 26, 2)
    return full


def bench() -> Img:
    """A changing bench with a thermos and a folded newspaper on it. 34 × 13."""
    out = Img.new(34, 13)
    wd = P['wood']
    out.rect_(0, 4, 34, 4, wd[3]); out.rect_(0, 4, 34, 1, wd[4])
    out.rect_(0, 8, 34, 1, wd[1])
    out.rect_(3, 9, 3, 4, wd[2]); out.rect_(28, 9, 3, 4, wd[1])
    out.rect_(6, 11, 22, 1, wd[1])
    out = ink(out)
    th = Img.new(4, 8)
    th.rect_(0, 2, 4, 6, '#a8323b'); th.rect_(0, 2, 1, 6, '#d0504f'); th.rect_(0, 0, 4, 2, P['iron'][3])
    out.paste_(ink(th), 5, 0)
    np_ = Img.new(9, 4)
    np_.rect_(0, 0, 9, 4, P['paper'][2]); np_.rect_(1, 1, 5, 1, P['paper'][0]); np_.rect_(1, 2, 3, 1, '#a8323b')
    out.paste_(ink(np_), 19, 3)
    return out


def hoist_desk() -> Img:
    """The hoist driver's desk: a green desk lamp, a row of buttons, the depth dial, two levers
    with red knobs, a black telephone; cabinet doors and vents in front. 44 × 30."""
    w, h = 44, 30
    out = Img.new(w, h)
    pg = PAINT_GREEN
    ir = P['iron']
    top = 11
    out.rect_(0, top, w, 9, pg[3]); out.rect_(0, top, w, 1, pg[4])
    out.rect_(0, top + 9, w, h - top - 9, pg[2])
    out.rect_(0, top + 9, w, 1, pg[1])
    for dx in (2, 23):
        out.rect_(dx, top + 11, 19, h - top - 14, pg[2])
        out.rect_(dx, top + 11, 19, 1, pg[3]); out.rect_(dx + 18, top + 11, 1, h - top - 14, pg[1])
        out.rect_(dx + 16, top + 14, 1, 3, ir[4])
    for vx in range(5, 15, 2):
        out.rect_(vx, h - 7, 1, 3, pg[0])
    out.rect_(0, h - 2, w, 2, pg[0])
    for i, c in enumerate(('#d0504f', '#5fb070', '#e8c14e', '#23262a')):
        out.rect_(10 + i * 3, top + 5, 2, 2, c)
        out.px_(10 + i * 3, top + 5, '#ffffff' if i < 3 else '#555555')
    out.ellipse_(26.5, top + 3.5, 4.5, 4.5, ir[1])
    out.ellipse_(26.5, top + 3.5, 3.5, 3.5, '#ece6d2')
    out.px_(29, top + 2, '#c9463a'); out.px_(29, top + 3, '#c9463a')
    out.line_(26, top + 4, 24, top + 1, INK)
    for lx, ly in ((33, 2), (36, 4)):
        out.rect_(lx, top + 5, 3, 2, INK)
        out.rect_(lx + 1, ly + 2, 1, top + 5 - ly - 2, ir[4])
        out.rect_(lx, ly, 3, 3, '#c9463a'); out.px_(lx, ly, '#f08a7a')
    out.rect_(39, top + 2, 5, 4, '#23262a'); out.rect_(39, top + 2, 5, 1, '#40444a')
    out.rect_(38, top, 7, 2, '#1b1d20'); out.px_(38, top + 2, '#1b1d20'); out.px_(43, top + 2, '#1b1d20')
    out = ink(out)
    lamp = Img.new(10, 13)
    lamp.rect_(4, 4, 1, 8, ir[1])
    lamp.rect_(1, 11, 7, 2, ir[2])
    lamp.poly_([(2, 0), (8, 0), (10, 5), (0, 5)], '#3f6b4f')
    lamp.poly_([(2, 0), (4, 0), (2, 5), (0, 5)], '#5a8a6a')
    lamp = ink(lamp)
    lamp.rect_(3, 5, 4, 1, '#fff2c0')
    out.paste_(lamp, 1, 0)
    return out


def floor_board(frame: int) -> Img:
    """The floor board over the desk: 26 letters A–Z behind black glass; opened floors glow amber,
    the current one blinks red, the rest are dark. 41 × 26."""
    w, h = 41, 26
    out = Img.new(w, h)
    out.rect_(0, 0, w, h, P['wood'][2]); out.rect_(0, 0, w, 1, P['wood'][4])
    out.rect_(0, h - 1, w, 1, P['wood'][0])
    out.rect_(2, 2, w - 4, h - 4, '#0f1311')
    out.rect_(2, 2, w - 4, 1, '#232a26')
    out = ink(out)
    cur = 7
    for i in range(26):
        col, row = i % 9, i // 9
        if i < cur:
            c = '#ffc85a'
        elif i == cur:
            c = '#ff5a3a' if frame % 2 == 0 else '#6a2a20'
        else:
            c = '#39413c'
        out.paste_(txt(chr(ord('A') + i), c), 3 + col * 4, 3 + row * 7)
    return out


def time_clock() -> Img:
    """The time clock (табельные часы) with its punch-card rack: slots of cards, two with coloured
    heads; a grey case with a round dial, a card half in the slot, a red lever. 22 × 22."""
    w, h = 22, 22
    out = Img.new(w, h)
    rk = Img.new(9, 21)
    rk.rect_(0, 0, 9, 21, P['wood'][2]); rk.rect_(0, 0, 9, 1, P['wood'][4])
    for i in range(6):
        y = 2 + i * 3
        rk.rect_(1, y + 2, 7, 1, P['wood'][0])
        rk.rect_(2, y, 5, 2, P['paper'][3])
        if i in (1, 4):
            rk.rect_(2, y, 5, 1, '#b8413a' if i == 1 else '#4a6ea8')
    out.paste_(ink(rk), 0, 1)
    ck = Img.new(13, 21)
    ir = P['iron']
    ck.rect_(0, 0, 13, 21, ir[3]); ck.rect_(0, 0, 13, 1, ir[4]); ck.rect_(12, 1, 1, 20, ir[2])
    ck.ellipse_(6.5, 6.5, 5.5, 5.5, ir[1])
    ck.ellipse_(6.5, 6.5, 4.5, 4.5, '#ece6d2')
    ck.px_(6, 2, INK); ck.px_(10, 6, INK); ck.px_(6, 10, INK); ck.px_(2, 6, INK)
    ck.line_(6, 6, 6, 3, INK); ck.line_(6, 6, 9, 7, INK)
    ck.rect_(2, 14, 9, 2, '#1b1d20')
    ck.rect_(4, 12, 5, 3, P['paper'][3])
    ck.rect_(2, 17, 9, 2, ir[2])
    out.paste_(ink(ck), 9, 0)
    out.rect_(20, 12, 2, 2, '#c9463a')
    return out


def safety_poster() -> Img:
    """«ТЕХНИКА БЕЗОПАСНОСТИ»: a red band, two lines of text, a hard-hat pictogram, pinned. 31 × 25."""
    w, h = 31, 25
    out = Img.new(w, h)
    pa = P['paper']
    out.rect_(0, 0, w, h, pa[2]); out.rect_(0, h - 1, w, 1, pa[0]); out.rect_(w - 1, 0, 1, h, pa[1])
    out.rect_(1, 1, w - 2, 7, '#a8323b'); out.rect_(1, 1, w - 2, 1, '#d0504f')
    t1 = txt('ТЕХНИКА', '#f4ecd6')
    out.paste_(t1, (w - t1.w) // 2, 2)
    out.paste_(txt('БЕЗОПАС', '#2a2226'), 2, 10)
    out.paste_(txt('НОСТИ', '#2a2226'), 2, 17)
    hat = Img.new(6, 5)
    hat.ellipse_(3, 3.5, 3, 3, '#d8a632'); hat.rect_(0, 3, 6, 2, '#b88a22'); hat.rect_(2, 1, 2, 2, '#fff6c8')
    out.paste_(outline(hat, INK), 23, 16)
    out = ink(out)
    out.px_(1, 1, '#c9463a'); out.px_(w - 2, 1, '#c9463a')
    return out


def dynamite_crate() -> Img:
    """A crate of explosives: red sticks with fuses standing out of it, a yellow ВВ plate and a
    hazard band on the front. 18 × 21."""
    w, h = 18, 21
    out = Img.new(w, h)
    wd = P['wood']
    for x, t in ((3, 1), (6, 0), (9, 2), (12, 1)):
        out.rect_(x, 3 + t, 3, 8, '#a8323b'); out.rect_(x, 3 + t, 1, 8, '#d0504f'); out.rect_(x + 2, 3 + t, 1, 8, '#76222a')
        out.rect_(x, 3 + t, 3, 1, '#ec8577')
    out = ink(out)
    for x, t, fx in ((4, 1, -1), (7, 0, 1), (10, 2, 0), (13, 1, 1)):
        out.line_(x, 3 + t, x + fx, t, '#2a2226')
    cr = Img.new(w, 12)
    cr.rect_(0, 0, w, 12, wd[2]); cr.rect_(0, 0, w, 2, wd[3]); cr.rect_(0, 0, w, 1, wd[4])
    cr.rect_(0, 5, w, 1, wd[1]); cr.rect_(0, 9, w, 1, wd[1])
    cr.paste_(hazard(w, 2, 2), 0, 10)
    cr.rect_(5, 3, 8, 6, HAZ_Y); cr.rect_(5, 3, 8, 1, HAZ_Y2)
    cr.paste_(txt('ВВ', HAZ_K), 6, 4)
    out.paste_(ink(cr), 0, 9)
    return out


def timber_stack() -> Img:
    """Pit props (крепь): round log ends stacked 3-2-1, each with rings and bark, the logs'
    lengths running back behind them. 26 × 21."""
    w, h = 26, 21
    out = Img.new(w, h)
    wd = P['wood']
    ends = [(4.5, 16.5), (12.5, 16.5), (20.5, 16.5), (8.5, 10), (16.5, 10), (12.5, 3.8)]
    for cx, cy in ends:
        out.rect_(int(cx - 3), int(cy - 6), 7, 4, wd[2])
        out.rect_(int(cx - 3), int(cy - 6), 7, 1, wd[3])
    out = outline(out, INK).crop(1, 1, w, h)
    for cx, cy in ends:
        out.ellipse_(cx, cy, 4.2, 4.2, INK)
        out.ellipse_(cx, cy, 3.4, 3.4, wd[1])
        out.ellipse_(cx - 0.3, cy - 0.3, 2.6, 2.6, '#c9a36e')
        out.ellipse_(cx - 0.3, cy - 0.3, 1.5, 1.5, '#a9844f')
        out.px_(int(cx), int(cy), wd[1])
    return out


def cable_drum() -> Img:
    """A wooden cable drum on its side: two plank flanges standing taller than the black cable
    wound between them, the loose end trailing down. 24 × 22."""
    w, h = 24, 22
    out = Img.new(w, h)
    wd = P['wood']
    out.rect_(5, 5, 14, 13, '#26262c')
    for y in range(5, 18, 2):
        out.rect_(5, y, 14, 1, '#3c3c45')
        out.px_(6 + (y * 5) % 12, y, '#62626e')
    out.rect_(5, 5, 14, 1, '#55555f')
    out.rect_(12, 17, 2, 5, '#26262c')                                      # the loose end
    for fx, lit in ((1, True), (19, False)):
        out.ellipse_(fx + 2, 11, 2.6, 10.4, wd[2] if lit else wd[1])
        out.rect_(fx + (1 if lit else 2), 2, 1, 18, wd[3] if lit else wd[2])
        out.rect_(fx + 1, 10, 2, 2, wd[0])
    out = ink(out)
    return out


def tool_barrel() -> Img:
    """A barrel of tools, handles up: a shovel's D-grip, a pick head, a crowbar. 18 × 30."""
    out = Img.new(18, 30)
    wd, ir = P['wood'], P['iron']
    out.rect_(4, 4, 2, 14, wd[3]); out.rect_(4, 4, 1, 14, wd[4])          # shovel shaft
    out.rect_(2, 1, 6, 1, wd[3]); out.rect_(2, 1, 1, 4, wd[3]); out.rect_(7, 1, 1, 4, wd[2])   # D-grip
    out.rect_(9, 6, 2, 12, wd[3]); out.rect_(9, 6, 1, 12, wd[4])          # pick haft
    out.poly_([(4, 7), (8, 3), (13, 3), (17, 7), (13, 5), (8, 5)], ir[3])
    out.rect_(8, 3, 5, 1, ir[4])
    out.rect_(14, 2, 1, 16, ir[2]); out.rect_(14, 2, 2, 1, ir[3]); out.rect_(14, 1, 1, 2, '#b8413a')   # crowbar
    out = ink(out)
    out.paste_(barrel(), 2, 12)
    return out


def fire_board() -> Img:
    """The fire board (пожарный щит): a red panel on two legs with a conical bucket, an axe and a
    hook, a box of sand at its foot. 26 × 32."""
    w, h = 26, 32
    out = Img.new(w, h)
    rd = P['red']
    ir, wd = P['iron'], P['wood']
    out.rect_(3, 20, 3, 10, wd[1]); out.rect_(20, 20, 3, 10, wd[0])
    out.rect_(0, 0, w, 22, rd[2]); out.rect_(0, 0, w, 1, rd[3]); out.rect_(0, 21, w, 1, rd[1])
    out.rect_(1, 1, w - 2, 1, '#e6e0d2')
    out.poly_([(2, 4), (11, 4), (6.5, 13)], rd[3]); out.poly_([(2, 4), (5, 4), (6, 12)], rd[4])
    out.rect_(2, 4, 10, 1, '#e6e0d2')
    out.rect_(15, 3, 2, 14, wd[3]); out.rect_(15, 3, 1, 14, wd[4])
    out.poly_([(17, 4), (22, 3), (22, 9), (17, 8)], ir[3]); out.rect_(21, 3, 1, 7, ir[4])
    out.rect_(1, 17, 22, 1, wd[3]); out.rect_(1, 18, 22, 1, wd[1])
    out.rect_(22, 14, 2, 1, ir[4]); out.rect_(23, 14, 1, 4, ir[3])
    out = ink(out)
    sb = Img.new(14, 8)
    sb.rect_(0, 0, 14, 8, rd[2]); sb.rect_(0, 0, 14, 1, rd[3])
    sb.rect_(1, 1, 12, 2, '#c9ad76')
    out.paste_(ink(sb), 6, 24)
    return out


def coat_stand() -> Img:
    """A coat stand by the door: a pole on a cross foot, a quilted jacket on the left hook, a hard
    hat on the right one and another on top. 22 × 34."""
    w, h = 22, 34
    out = Img.new(w, h)
    wd = P['wood']
    out.rect_(10, 3, 2, 29, wd[3]); out.rect_(10, 3, 1, 29, wd[4])
    out.rect_(4, 31, 14, 2, wd[2]); out.rect_(4, 31, 14, 1, wd[3])
    out.rect_(6, 6, 3, 1, wd[2]); out.rect_(13, 9, 3, 1, wd[2])            # hooks
    out = ink(out)
    out.paste_(jacket('#4a5160'), 0, 7)
    out.paste_(helmet('#c8743a'), 12, 10)
    out.paste_(helmet('#d8a632'), 6, 0)
    return out


def water_tank() -> Img:
    """A drinking water tank (бачок) on a stool: a galvanised cylinder with a white enamel ВОДА
    plate between two bands, a brass tap, an aluminium mug hanging on a chain. 20 × 28."""
    w, h = 20, 28
    out = Img.new(w, h)
    ir, wd = P['iron'], P['wood']
    out.rect_(1, 19, 18, 3, wd[3]); out.rect_(1, 19, 18, 1, wd[4])
    out.rect_(2, 22, 2, 6, wd[2]); out.rect_(16, 22, 2, 6, wd[1])
    out.rect_(2, 3, 16, 16, ir[3])
    out.rect_(2, 3, 4, 16, ir[4]); out.rect_(14, 3, 4, 16, ir[2])
    out.ellipse_(10, 3, 8, 2.5, ir[4]); out.rect_(8, 0, 4, 2, ir[2])
    for y in (5, 17):
        out.rect_(2, y, 16, 1, ir[1])
    out = ink(out)
    lab = txt('ВОДА', '#2c4f86')
    out.rect_(1, 8, lab.w + 2, 7, '#f0eee4'); out.rect_(1, 14, lab.w + 2, 1, '#b8b6aa')
    out.rect_(1, 8, lab.w + 2, 1, INK); out.rect_(1, 15, lab.w + 2, 1, INK)
    out.paste_(lab, 2, 9)
    out.rect_(9, 17, 2, 2, '#b8943a'); out.px_(9, 19, '#b8943a'); out.px_(10, 20, '#8fb3bd')
    mug = Img.new(5, 4)
    mug.rect_(0, 0, 4, 4, '#b8bcc0'); mug.rect_(0, 0, 1, 4, '#e0e4e6'); mug.px_(4, 1, '#b8bcc0')
    out.paste_(ink(mug), 13, 22)
    out.line_(16, 17, 15, 22, ir[2])
    return out


def knife_switch() -> Img:
    """A knife switch box (рубильник) with its conduit going up and a signal bell above it: grey
    case, a red-handled lever thrown down, a lightning plate. 10 × 30."""
    w, h = 10, 30
    out = Img.new(w, h)
    ir = P['iron']
    out.rect_(4, 0, 2, 12, ir[2]); out.rect_(4, 0, 1, 12, ir[3])                # conduit
    out.ellipse_(5, 7, 4, 3.5, '#a8323b'); out.ellipse_(4.3, 6.3, 2.5, 2, '#d0504f')   # bell dome
    out.rect_(4, 10, 2, 2, ir[1])
    out.rect_(0, 13, 10, 15, ir[3]); out.rect_(0, 13, 10, 1, ir[4]); out.rect_(9, 14, 1, 14, ir[2])
    out.rect_(2, 15, 6, 4, HAZ_Y); out.line_(5, 15, 4, 17, HAZ_K); out.line_(4, 17, 5, 18, HAZ_K)
    out.rect_(4, 20, 2, 2, ir[1])
    out.rect_(4, 21, 1, 5, ir[4]); out.rect_(3, 25, 3, 2, '#c9463a')              # lever, thrown down
    out = ink(out)
    out.px_(4, 5, '#ffd0c8')
    return out


def ore_spill() -> Img:
    """Iron ore spilled where the carts are loaded: rusty lumps with a few bright specks. 24 × 12."""
    heap = ore_heap(24, 12, 'iron', seed=9)
    return outline(heap, INK).crop(1, 1, 24, 12)


def wall_texture(w: int, h: int) -> Img:
    """The hoist house wall: red brick above, a band of green oil paint below with a dark stripe,
    the way every Soviet service room was painted."""
    out = texture('brick', w, h, 21)
    band = 13
    pg = PAINT_GREEN
    out.rect_(0, h - band, w, band, pg[2])
    r = rng('minewall')
    for _ in range(w // 3):
        out.px_(r.randrange(0, w), h - band + r.randrange(1, band), pg[1])
    out.rect_(0, h - band, w, 1, pg[4])
    out.rect_(0, h - band + 1, w, 1, pg[0])
    return out


# ------------------------------------------------------------------------------------ map
def build() -> Map:
    m = Map('mine', W, H, 'indoor', name='Шахта', ambient=0.55, music='mine')
    shell(m, 'brick', 'concrete', face=2, door=(5, 2), out_to='square', out_at='mine', floor_seed=5)
    g = m.ground
    m.stamp(wall_texture((W - 2) * T, 2 * T - 3), T, T)
    g.rect_(T, T, (W - 2) * T, 2, '#000000', 0.35)
    refloor(m, lambda g_, a, b, c, d: concrete_floor(g_, a, b, c, d, seed=5))
    # the concrete is dusty and darker toward the walls
    fy0, fy1 = 3 * T + 5, (H - 1) * T
    for k in range(6):
        a = 0.05 * (6 - k)
        g.rect_(T + 3 + k * 2, fy0, 2, fy1 - fy0, '#141214', a)
        g.rect_((W - 1) * T - 5 - k * 2, fy0, 2, fy1 - fy0, '#141214', a)

    # --- the floor: steel landing with its hazard edge, the track, oil, ore crumbs, water, boots
    y_land = 5 * T
    g.rect_(CAGE_X - 24, y_land, 48, 10, P['iron'][2])
    for yy in range(y_land + 1, y_land + 10, 3):
        for xx in range(CAGE_X - 23, CAGE_X + 24, 3):
            g.px_(xx + (yy // 3) % 2, yy, P['iron'][3])
    g.paste_(hazard(48, 3, 3), CAGE_X - 24, y_land + 10)
    g.rect_(CAGE_X - 24, y_land + 13, 48, 1, INK)
    g.rect_(CAGE_X - 24, y_land, 48, 1, INK)
    rails_v(g, CAGE_X, y_land, 10 * T + 6, rust=0.08, seed=2)
    stain(g, CAGE_X, 7 * T + 8, 12, 5, '#1b1614', 0.35)
    stain(g, CAGE_X, 9 * T + 8, 10, 4, '#1b1614', 0.25, seed=2)
    grit(g, CAGE_X - 20, 6 * T, CAGE_X + 20, 10 * T, ['#5a4440', '#7d5f55', '#b56a4a', '#34343b'], 70, 3,
         cluster=(CAGE_X, 8 * T, 10, 26))
    puddle(g, CAGE_X - 17, 6 * T + 4, 5, 2)
    puddle(g, CAGE_X + 19, 5 * T + 15, 3, 1.5, 2)
    footprints(g, [(CAGE_X - 11, 6 * T + 10), (CAGE_X - 15, 9 * T), (CAGE_X - 9, 12 * T + 6)], seed=4)
    footprints(g, [(CAGE_X + 13, 6 * T + 4), (8 * T + 8, 6 * T + 8), (9 * T, 6 * T + 4)], seed=5, alpha=0.24)
    stain(g, 2 * T + 8, 9 * T + 8, 18, 10, '#141214', 0.18)
    for i, (x, y) in enumerate(((4 * T + 3, 11 * T + 4), (7 * T + 12, 10 * T + 2), (4 * T + 10, 7 * T + 12),
                                (8 * T + 4, 11 * T + 12), (6 * T + 14, 12 * T + 2))):
        m.stamp(pebble(['#3a2e2e', '#5a4440', '#7d5f55', '#9c7b6b'], i, 3 + i % 2), x, y)
    grit(g, T, 3 * T, (W - 1) * T, (H - 1) * T, ['#5f605c', '#4d4e4b', '#6d5a4c'], 90, 9)

    # --- north wall: time clock and safety poster, the cage, the floor board over the desk
    m.stamp(time_clock(), T + 1, T + 5)
    m.stamp(safety_poster(), 2 * T + 8, T + 3)
    m.put('mine.cage', cage(), CAGE_X - CW // 2, y_land - 72, solid=(4.5, 3, 7.5, 5))
    m.put('mine.signal', [signal_red(i) for i in range(2)], CAGE_X - CW // 2 + 1, y_land - 72 + 13,
          base=y_land + 1, fps=1.2)
    m.put('mine.ropes', ropes_top(), CAGE_X - 5, T - 10 - 8, layer='top')
    m.door(5, 5, 2, 0.9, '@prison', '', kind='use', label='Спуститься')
    m.emit('drip', CAGE_X + 8, 2 * T + 4, 0.6)
    m.emit('dust', CAGE_X, 5 * T + 6, 0.5)
    m.light(CAGE_X, 3 * T + 12, 30, '#fff0c8', 'glow')
    m.put('mine.board', [floor_board(i) for i in range(2)], 9 * T - 20, T + 3, base=3 * T - 1, fps=1.6)
    m.light(9 * T, 2 * T, 30, '#ffc85a', 'neon')
    m.stamp(knife_switch(), 10 * T + 6, T + 1)

    # --- the foreman at the hoist desk (north-east), warm light from the desk lamp
    m.npc('foreman', 'foreman', 9.0, 3.85, face=0, anim='idle', name='Бригадир')
    m.put('mine.desk', hoist_desk(), 9 * T - 22, 5 * T - 30, solid=(8, 4, 10.5, 5))
    m.light(9 * T - 16, 3 * T + 8, 44, WARM, 'lamp')

    # --- west: the lamp room — charging rack under the clock, lockers and bench, explosives
    m.put('mine.lamps', [lamp_rack(i) for i in range(4)], T + 1, 5 * T - 34, fps=2.5, solid=(1, 3, 3.5, 5))
    m.light(2 * T + 6, 4 * T, 28, '#9dffb0', 'glow')
    m.put('mine.lockers', lockers(), T + 1, 8 * T + 8 - 40, solid=(1, 6.5, 3.5, 8.5))
    m.put('mine.bench', bench(), T + 3, 9 * T + 12 - 13, solid=(1, 9, 3.5, 9.75))
    m.put('kit.crate.dark', crate(dark=True), T + 1, 10 * T + 12, solid=(1, 10.5, 2, 11.75))
    m.put('kit.crate', crate(), 2 * T + 1, 11 * T + 2, solid=(2, 11, 3, 12))
    m.put('mine.tnt', dynamite_crate(), T + 1, 13 * T - 21, solid=(1, 12, 2.25, 13))
    m.put('kit.sack', sack('#6f6352'), 2 * T + 5, 12 * T + 3, solid=(2.5, 12.25, 3.25, 13))
    # ore spilled where the carts are tipped, west of the buffer (the east side of the track is
    # the lane from the door to the cage and the desk: nothing stands in x 6.5–8)
    m.put('mine.spill', ore_spill(), 4 * T + 2, 10 * T + 7, solid=(4.5, 10.5, 5.5, 11.25))

    # --- the track: a loaded cart waiting, an empty one by the buffer stop
    m.put('mine.cart', cart('rust', 'iron', seed=3), CAGE_X - 10, 7 * T + 12 - 19, solid=(5.5, 6.75, 6.5, 7.75))
    m.put('mine.cart.empty', cart('iron', None, seed=4), CAGE_X - 10, 9 * T + 12 - 19, solid=(5.5, 8.75, 6.5, 9.75))
    m.put('mine.buffer', buffer_stop(), CAGE_X - 11, 10 * T + 12 - 16, solid=(5.5, 10, 6.5, 10.75))

    # --- east: water, pit props, a cable drum, the tool barrel, the fire board, the coat stand
    m.put('mine.water', water_tank(), 10 * T - 4, 6 * T + 12 - 28, solid=(10, 6, 11, 6.75))
    m.put('mine.props', timber_stack(), 9 * T + 6, 8 * T + 6 - 21, solid=(9.5, 7.25, 11, 8.5))
    m.put('mine.drum', cable_drum(), 8 * T + 2, 10 * T - 22, solid=(8, 9, 9.5, 10))
    m.put('mine.tools', tool_barrel(), 9 * T + 14, 10 * T + 14 - 30, solid=(10, 9.5, 11, 10.75))
    m.put('mine.fire', fire_board(), 9 * T + 6, 13 * T - 32, solid=(9.5, 12, 11, 13))
    m.put('mine.coats', coat_stand(), 8 * T - 5, 13 * T - 34, solid=(7.5, 12.25, 8.5, 13))

    # --- cold enamel lamps under the roof (top layer) and their light
    lamp = lamp_enamel(cord=20)
    for lx, ly in ((4 * T + 4, 6 * T + 8), (8 * T + 8, 8 * T), (3 * T + 8, 11 * T)):
        m.put('mine.lamp', lamp, lx - 6, ly - lamp.h, layer='top')
        m.light(lx, ly + 2, 62, COLD, 'lamp')
    m.marks['foreman'] = (9.0, 3.85)
    return m
