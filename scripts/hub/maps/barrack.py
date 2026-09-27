"""Барак 1 изнутри (v2.81) — the living barrack: bunks, the stove, the orderly, YOUR bunk and chest.

The file is `barrack.py`, the map id is `barrack1` (the facade's id — the square's door leads to
it by that name); barrack 2 can come out of the same builder when it opens.

12 × 15 tiles, portrait. Whitewashed walls, a plank floor, a red runner from the door to the
orderly. North wall, west to east: the stove pipe rising from the corner with footcloths drying
by it, a barred window, the day's schedule over the orderly, a caged wall lamp, the clock and the
radio speaker, the mirror and two towels over the washstand. The orderly (Дневальный) stands
behind his тумбочка — the field phone, the duty ledger, tea in a holder, his red armband — facing
the door. North-west the pot-bellied stove (буржуйка) glows behind its grate, a copper kettle on
it, firewood and a coal scuttle by it on the iron sheet. North-east the washstand: three enamel
рукомойники over a tin trough, soap, a drip. West: two double bunks, a guitar leaning on the
first, a тумбочка and a stool. South-west the coat rack: quilted jackets, an ushanka, felt boots
and kirza boots in a row; a rat by it. East: a double bunk and YOUR bunk — a single one, the red
checked blanket, a photo in the headboard, a ginger cat asleep on it — and at its foot YOUR CHEST
with the number plate «1» (the `use` door «Мой сундук» → @bunk). South-east the fire board with
its sand box and a mop in a bucket. The long table with benches in the middle: dominoes
mid-game, mugs, a loaf, the teapot.

Lessons (critique rounds):
  1. Log walls inside over a plank floor are the same stripes twice: the room had no wall. A
     whitewashed wall (plaster, like the kennel) over the planks separates them at once.
  2. A lamp hung over the orderly's head covers his face — the NA face sits low in its frame.
     The lamp moved over the table; over the orderly there is only the wall.
  3. A clothesline on the 'top' layer across a corner full of bunks read as a fence of white
     boxes over everything. The footcloths hang ON the wall by the stove pipe instead.
  4. Tin (`P['tin']`) is green-grey: three tin cans over a trough read as green lamps. The
     рукомойники are white enamel on iron.
  5. Plan the room by columns in pixels: the stove's feet, then the first bunk's top tier, then
     the second bunk — each sprite's top below the one before's feet, or the firewood lands on a
     bunk. Aisles are measured on the quarter grid: 3.25 → 4.4 between the bunks and the table.
  6. A lamp on a long cord over the table crossed the orderly's desk front and hung off it like
     a pendulum (the HQ's lesson again): a short cord, attached over the table itself.
  7. The chest is a `use` door laid OVER the chest, not beside it: a tap anywhere on the chest
     opens it, and the approach side (north, from the aisle) is chosen by the free cells.
"""
from __future__ import annotations

from art_industry import bulb_wall, jacket, paper_sheet, plate, rat
from art_shops import cat_asleep, dust_decal
from art_town import litter, runner
from kit import INK, P, bucket, ink, lamp_hanging, shell, stool, text, window
from lib import T, Img, Map, outline, rng

W, H = 12, 15

# ------------------------------------------------------------------------------------ palettes
IRON = P['iron']
WOOD = P['wood']
GREY = P['woodgrey']
BLANKET = ['#23282e', '#343c45', '#48525c', '#5e6a74', '#7c8892']      # issue blanket, grey-blue
MINE_RED = ['#3e1216', '#6a1c20', '#942a2a', '#b8403a', '#d8685a']     # your blanket
LINEN = ['#8f8a7c', '#b3ad9c', '#d2ccba', '#ece7d8']
FELT = ['#2a2420', '#3e3530', '#554a42', '#6e6258']                    # felt boots
KIRZA = ['#141414', '#1e1e20', '#2c2c30', '#44444a']                   # kirza boots
FIRE_RED = ['#4a1014', '#7a1a1e', '#a82828', '#cc3c34', '#e8645a']
ENAMEL = ['#8a9296', '#b4bcc0', '#d6dcde', '#eef2f2']                  # white enamel, cold
COPPER = ['#3a2a22', '#5a3e2c', '#7e5a3a', '#a87a4e']


# ------------------------------------------------------------------------------------ art
def stove(frame: int) -> Img:
    """The pot-bellied stove (буржуйка): a black iron drum on three legs, the fire door with a
    grate glowing by frame, a sooty copper kettle on the lid, the pipe rising and elbowing into
    the wall. 27 × 63; its feet are the bottom row."""
    w, h = 28, 64
    out = Img.new(w, h)
    ir = IRON
    # the pipe: up from the drum's top, an elbow into the wall at the top
    out.rect_(15, 4, 6, 34, ir[2]); out.rect_(15, 4, 2, 34, ir[3]); out.rect_(20, 4, 1, 34, ir[0])
    for y in (12, 22, 32):
        out.rect_(14, y, 8, 2, ir[1]); out.rect_(14, y, 8, 1, ir[3])            # collars
    out.rect_(15, 0, 10, 6, ir[2]); out.rect_(15, 0, 10, 2, ir[3]); out.rect_(23, 0, 2, 6, ir[1])   # elbow
    out.rect_(16, 16, 3, 2, '#3a2a26', 0.6)                                       # soot streak
    # the drum
    top = 38
    out.ellipse_(12, top + 2, 11, 3, ir[3])                                       # lid (seen from above)
    out.ellipse_(12, top + 2, 8, 2, ir[2])
    out.rect_(1, top + 2, 22, 16, ir[1])
    out.rect_(1, top + 2, 5, 16, ir[2]); out.rect_(3, top + 3, 2, 14, ir[3])      # lit left flank
    out.rect_(20, top + 2, 3, 16, ir[0])
    out.ellipse_(12, top + 18, 11, 3, ir[1])
    for y in (top + 6, top + 14):
        out.rect_(1, y, 22, 1, ir[0])                                              # bands
    # the fire door with its grate
    glow = [P['fire'][2], P['fire'][3], P['fire'][4], P['fire'][3]][frame % 4]
    out.rect_(7, top + 7, 10, 7, '#1a1010')
    for x in range(8, 17, 2):
        out.rect_(x, top + 8, 1, 5, glow)
    out.rect_(8, top + 12, 8, 1, P['fire'][1])
    out.rect_(7, top + 7, 10, 1, ir[3])
    out.px_(18, top + 10, ir[4])                                                   # the latch
    # three legs
    out.rect_(3, top + 20, 2, 5, ir[0]); out.rect_(19, top + 20, 2, 5, ir[0]); out.rect_(11, top + 21, 2, 4, ir[1])
    # the kettle on the lid, a little to the left of the pipe
    k = COPPER
    out.ellipse_(7, top - 2, 5, 3.5, k[1]); out.ellipse_(6.5, top - 2.5, 4, 2.6, k[2])
    out.rect_(1, top - 4, 3, 1, k[1]); out.px_(1, top - 5, k[1])                     # spout
    out.line_(4, top - 5, 7, top - 7, IRON[1]); out.line_(7, top - 7, 10, top - 5, IRON[1])   # handle
    out.px_(5, top - 4, k[3]); out.px_(6, top - 4, k[3])
    out = outline(out, INK)
    return out.crop(1, 1, w, h)


def firewood() -> Img:
    """Split logs stacked by the stove, ends showing: pale rings, dark bark. 20 × 14."""
    out = Img.new(20, 14)
    r = rng('barrack-wood')
    for row, y in enumerate((7, 3, -1)):
        n = 3 - (row == 2)
        for i in range(n):
            x = 1 + i * 6 + row * 3
            out.ellipse_(x + 3, y + 3, 3, 2.8, WOOD[1])
            out.ellipse_(x + 3, y + 3, 2, 1.8, P['straw'][3])
            out.px_(x + 3, y + 3, WOOD[2])
            if r.random() < 0.5:
                out.px_(x + 2, y + 2, P['straw'][4])
    return outline(out, INK)


def scuttle() -> Img:
    """A coal scuttle with a scoop in it. 11 × 10."""
    out = Img.new(11, 10)
    out.poly_([(1, 3), (10, 2), (9, 9), (2, 9)], IRON[2])
    out.poly_([(1, 3), (4, 3), (4, 9), (2, 9)], IRON[3])
    out.ellipse_(5.5, 3, 4.5, 1.6, P['coal'][1])
    for x in (3, 5, 7):
        out.px_(x, 2, P['coal'][3])
    out.line_(6, 3, 9, 0, WOOD[3])
    return ink(out)


def footcloths() -> Img:
    """Footcloths (портянки) and a sock drying on a string by the stove pipe, on the wall face.
    22 × 14."""
    w, h = 22, 14
    out = Img.new(w, h)
    rags = [(1, 9, LINEN), (8, 11, ['#6e6450', '#8f846a', '#aea37e', '#c8bd96']),
            (15, 8, ['#50484a', '#6a6064', '#857a7c', '#a0969a'])]
    for x, ln, c in rags:
        out.rect_(x, 2, 6, ln, c[2]); out.rect_(x, 2, 2, ln, c[3]); out.rect_(x + 5, 2, 1, ln, c[1])
        out.rect_(x, 1 + ln, 6, 1, c[1])
    out = ink(out)
    out.rect_(0, 1, w, 1, '#3a3230')
    for x, _, _ in rags:
        out.px_(x + 1, 1, '#b8a878'); out.px_(x + 4, 1, '#b8a878')
    return out


def bunk(blanket: list[str], seed: int = 1, extra: str = '') -> Img:
    """A double bunk (нары) along a side wall, head to the wall, seen in 3/4 from the south: the
    lower bed (pillow, blanket turned down over a white sheet), iron posts at the corners, the
    upper bed a tier higher with a ladder at its foot. 38 × 38; the bottom row is the front feet.
    extra: 'boots' — boots under it, 'book' — a book left on the lower bed."""
    w, h = 38, 38
    out = Img.new(w, h)
    r = rng('bunk', seed)
    post = IRON

    def bed(y: int, b: list[str]) -> None:
        out.rect_(1, y + 7, w - 2, 3, post[2]); out.rect_(1, y + 7, w - 2, 1, post[3])  # rails
        out.rect_(2, y, w - 4, 8, LINEN[2]); out.rect_(2, y, w - 4, 1, LINEN[3])
        out.rect_(10, y, w - 12, 8, b[2]); out.rect_(10, y, w - 12, 1, b[3])
        out.rect_(10, y, 2, 8, LINEN[3])                                            # the sheet turned over
        for sx in range(15, w - 3, 7):
            out.rect_(sx, y + 2, 4, 1, b[3] if r.random() < 0.6 else b[1])          # weave stripe
        out.rect_(w - 5, y + 1, 2, 6, b[1])                                          # fold at the foot
        out.rect_(3, y + 1, 6, 6, LINEN[3]); out.rect_(3, y + 5, 6, 1, LINEN[1]); out.px_(8, y + 1, LINEN[2])
        out.rect_(10, y + 7, w - 12, 2, b[1])                                        # blanket over the rail
        out.rect_(10, y + 9, w - 12, 1, b[0])

    lower_y = 21
    bed(3, blanket)
    for x in (1, w - 3):
        out.rect_(x, 3, 2, h - 3, post[1]); out.rect_(x, 3, 1, h - 3, post[3])
        out.rect_(x, 1, 2, 2, post[3])
    for yy in range(15, 30, 4):
        out.rect_(w - 7, yy, 5, 1, post[2])
    out.rect_(w - 7, 13, 1, 20, post[1])
    bed(lower_y, blanket)
    out.rect_(2, lower_y, w - 4, 2, '#000000', 0.28)                                 # the upper's shadow
    for x in (1, w - 3):
        out.rect_(x, h - 3, 2, 3, post[0])
    if extra == 'book':
        out.rect_(20, lower_y + 2, 6, 4, '#7a2a24'); out.rect_(20, lower_y + 2, 6, 1, '#a84a3a')
        out.rect_(21, lower_y + 5, 5, 1, LINEN[3])
    out = ink(out)
    if extra == 'boots':
        for x in (13, 20):
            out.rect_(x, h - 7, 5, 7, FELT[2]); out.rect_(x, h - 7, 5, 1, FELT[3]); out.rect_(x + 3, h - 3, 3, 3, FELT[1])
            out.rect_(x, h - 7, 1, 7, INK); out.rect_(x + 5, h - 7, 1, 4, INK)
    return out


def guitar() -> Img:
    """A six-string guitar leaning, neck up: a light spruce top, dark sound hole. 10 × 26."""
    out = Img.new(10, 26)
    body = ['#6e3a1c', '#9a5a2a', '#c07a3a', '#dca05a']
    out.ellipse_(5, 20, 4.5, 5, body[2]); out.ellipse_(5, 13.5, 3.4, 3.6, body[2])
    out.ellipse_(4.5, 19, 3.2, 3.8, body[3]); out.ellipse_(5, 18, 1.4, 1.4, '#1a1010')
    out.rect_(4, 0, 2, 11, WOOD[1]); out.rect_(3, 0, 4, 3, WOOD[0])
    out.rect_(3, 23, 4, 1, body[0])
    out = outline(out, INK)
    for x in (4, 5):
        out.rect_(x, 3, 1, 19, '#d8d0c0', 0.7)
    return out


def my_bunk(frame: int) -> Img:
    """YOUR bunk: a single iron bed, nothing over it, the red checked blanket, a pillow, a photo
    tucked in the headboard, a ginger cat asleep on the blanket (frame breathes). 38 × 26."""
    w, h = 38, 26
    out = Img.new(w, h)
    y = 9
    out.rect_(1, y + 7, w - 2, 3, IRON[2]); out.rect_(1, y + 7, w - 2, 1, IRON[3])
    out.rect_(2, y, w - 4, 8, LINEN[2]); out.rect_(2, y, w - 4, 1, LINEN[3])
    b = MINE_RED
    out.rect_(11, y, w - 13, 8, b[2]); out.rect_(11, y, w - 13, 1, b[3])
    for cx in range(13, w - 3, 4):                                                   # checks
        out.rect_(cx, y, 1, 8, b[1])
    for cy in (y + 3, y + 6):
        out.rect_(11, cy, w - 13, 1, b[1])
    out.rect_(11, y, 2, 8, LINEN[3])
    out.rect_(3, y + 1, 7, 6, LINEN[3]); out.rect_(3, y + 5, 7, 1, LINEN[1])
    out.rect_(11, y + 7, w - 13, 2, b[1]); out.rect_(11, y + 9, w - 13, 1, b[0])
    # the headboard at the wall end (left), taller, with bars; the low foot rail
    out.rect_(0, 0, 3, h - 2, IRON[1]); out.rect_(0, 0, 1, h - 2, IRON[3])
    for yy in (2, 6):
        out.rect_(0, yy, 3, 1, IRON[3])
    out.rect_(w - 3, y - 3, 3, h - y + 1, IRON[1]); out.rect_(w - 3, y - 3, 1, h - y + 1, IRON[3])
    for x in (0, w - 3):
        out.rect_(x, h - 3, 3, 3, IRON[0])
    # the photo tucked into the headboard
    out.rect_(3, 1, 6, 7, '#e8e0cc'); out.rect_(4, 2, 4, 4, '#6e7880'); out.px_(5, 3, '#c8a888'); out.px_(6, 4, '#8a5a4a')
    out = ink(out)
    out.paste_(cat_asleep(frame, 'ginger', cushion=None), 18, y - 6)
    return out


def bedside_mat() -> Img:
    """A knitted rag mat by your bunk with a pair of felt slippers on it (flat, on the ground).
    20 × 10."""
    out = Img.new(20, 10)
    rows = ['#6a3a3a', '#4a5a6a', '#8a7a4a', '#5a4a6a']
    out.ellipse_(10, 5, 10, 5, rows[0])
    for i, c in enumerate(rows):
        out.ellipse_(10, 5, 9 - i * 2, 4 - i, c)
    out = outline(out, INK).crop(1, 1, 20, 10)
    for x in (5, 11):
        out.rect_(x, 3, 3, 5, FELT[3]); out.rect_(x, 3, 3, 1, LINEN[2]); out.px_(x + 1, 7, FELT[1])
    return out


def chest(frame: int) -> Img:
    """YOUR chest at the foot of your bunk: oak planks, iron corner bands, a brass padlock, the
    painted number plate «1» — the only chest in the room. frame walks a glint over the lid.
    20 × 17."""
    w, h = 20, 17
    out = Img.new(w, h)
    wd = ['#3e2618', '#5e3a22', '#7e5230', '#a06c40', '#c08c58']
    out.rect_(0, 0, w, 6, wd[3]); out.rect_(0, 0, w, 1, wd[4]); out.rect_(0, 5, w, 1, wd[1])   # lid
    out.rect_(1, 1, w - 2, 1, wd[4])
    out.rect_(0, 6, w, 11, wd[2]); out.rect_(0, 6, 2, 11, wd[3]); out.rect_(w - 2, 6, 2, 11, wd[1])
    for y in (9, 13):
        out.rect_(0, y, w, 1, wd[1])
    for x in (0, w - 3):                                                                  # corner bands
        out.rect_(x, 0, 3, h, IRON[2]); out.rect_(x, 0, 1, h, IRON[3])
        for yy in (2, 8, 14):
            out.px_(x + 1, yy, IRON[4])
    out.rect_(0, 5, w, 1, IRON[1])
    # the hasp and padlock
    out.rect_(8, 4, 4, 4, IRON[3]); out.rect_(9, 7, 2, 1, IRON[0])
    out.rect_(7, 8, 6, 5, P['gold'][2]); out.rect_(7, 8, 6, 1, P['gold'][3]); out.px_(9, 10, INK); out.px_(9, 11, INK)
    out.rect_(8, 6, 1, 2, IRON[3]); out.rect_(11, 6, 1, 2, IRON[3])
    # the painted plate «1» on the lid
    out.rect_(3, 1, 4, 3, '#e8e2cf'); out.rect_(5, 1, 1, 3, '#7a1a1e')
    out = ink(out)
    gx = [-4, 4, 12, 30][frame % 4]
    if 0 <= gx < w - 2:
        out.px_(gx, 1, '#fff6d0'); out.px_(gx + 1, 1, '#fff6d0'); out.px_(gx + 1, 2, '#ffe8a0')
    return out


def nightstand(photo: bool = False) -> Img:
    """A plywood тумбочка: top, a drawer, a door; a mug and a book on top (or a framed photo).
    14 × 17."""
    out = Img.new(14, 17)
    out.rect_(0, 3, 14, 4, GREY[3]); out.rect_(0, 3, 14, 1, GREY[4])
    out.rect_(0, 7, 14, 10, GREY[2]); out.rect_(0, 7, 2, 10, GREY[3]); out.rect_(12, 7, 2, 10, GREY[1])
    out.rect_(1, 7, 12, 3, GREY[1]); out.rect_(6, 8, 2, 1, IRON[3])                      # drawer
    out.rect_(9, 12, 1, 2, IRON[3])                                                        # the door knob
    if photo:
        out.rect_(3, 0, 5, 5, WOOD[2]); out.rect_(4, 1, 3, 3, '#8a9aa0')
    else:
        out.rect_(2, 1, 4, 3, '#e0dcd0'); out.rect_(3, 0, 2, 1, '#7a6a5a')                # mug
        out.rect_(8, 2, 5, 2, '#3a5a3a'); out.rect_(8, 2, 5, 1, '#5a7a5a')                # book
    return ink(out)


def duty_desk() -> Img:
    """The orderly's тумбочка by the wall — wider than a bedside one: the duty ledger open, the
    field phone, a glass of tea in its holder, the red armband on the corner. Nothing taller than
    a pencil in the middle — the orderly's face is low in his frame. 34 × 17."""
    w, h = 34, 17
    out = Img.new(w, h)
    out.rect_(0, 0, w, 5, GREY[3]); out.rect_(0, 0, w, 1, GREY[4]); out.rect_(0, 4, w, 1, GREY[1])
    out.rect_(0, 5, w, h - 5, GREY[2]); out.rect_(0, 5, 2, h - 5, GREY[3]); out.rect_(w - 2, 5, 2, h - 5, GREY[1])
    for x in (2, 12, 22):
        out.rect_(x, 6, 9, 4, GREY[1]); out.rect_(x + 4, 7, 2, 1, IRON[3])               # three drawers
    out.rect_(0, h - 2, w, 2, GREY[1])
    out.rect_(10, 1, 12, 3, LINEN[3]); out.rect_(16, 1, 1, 3, LINEN[1])                   # the ledger
    for x in (11, 17):
        out.rect_(x, 2, 4, 1, '#6a6a7a')
    out.rect_(2, 1, 6, 3, '#1c1c20'); out.rect_(2, 1, 6, 1, '#3c3c44'); out.rect_(3, 0, 4, 1, '#2c2c32')   # phone
    out.rect_(25, 1, 3, 3, '#a8662a'); out.rect_(25, 3, 3, 1, P['gold'][2]); out.px_(28, 2, P['gold'][2])  # tea
    out.rect_(29, 2, 4, 2, FIRE_RED[3]); out.rect_(29, 2, 4, 1, FIRE_RED[4])             # armband
    return ink(out)


def washstand(frame: int) -> Img:
    """The washstand: three enamel рукомойники (push-rod taps) on a board, a tin trough on iron
    legs under them, soap, a towel over the end, a drop falling from the middle tap. 44 × 26."""
    w, h = 44, 26
    out = Img.new(w, h)
    en = ENAMEL
    out.rect_(0, 0, w, 6, WOOD[2]); out.rect_(0, 0, w, 1, WOOD[3])
    for x in (5, 19, 33):
        out.rect_(x, 1, 7, 7, en[2]); out.rect_(x, 1, 2, 7, en[3]); out.rect_(x + 6, 1, 1, 7, en[0])
        out.rect_(x, 0, 7, 2, en[1]); out.rect_(x + 2, 0, 3, 1, en[3])
        out.rect_(x + 3, 8, 1, 2, IRON[2]); out.px_(x + 3, 10, IRON[3])
    out.rect_(0, 11, w, 7, IRON[3]); out.rect_(0, 11, w, 1, IRON[4]); out.rect_(1, 12, w - 2, 3, '#3e5a64')
    out.rect_(1, 12, w - 2, 1, '#2a3e46'); out.rect_(6, 13, 9, 1, '#6f9aa6')
    out.rect_(0, 16, w, 2, IRON[2])
    for x in (2, w - 4):
        out.rect_(x, 18, 2, 8, IRON[1])
    out.rect_(14, 10, 4, 2, '#e8d8a0'); out.rect_(13, 11, 6, 1, IRON[4])                  # soap
    out.rect_(w - 6, 10, 5, 12, LINEN[3]); out.rect_(w - 6, 18, 5, 1, FIRE_RED[2]); out.rect_(w - 2, 10, 1, 12, LINEN[1])
    out = ink(out)
    dy = [0, 1, 2, -1][frame % 4]
    if dy >= 0:
        out.px_(22, 11 + dy, '#9fd0e0')
    return out


def table() -> Img:
    """The long plank table: dominoes laid out mid-game, three tin mugs, a loaf and a knife, the
    enamel teapot. 46 × 20."""
    w, h = 46, 20
    out = Img.new(w, h)
    out.rect_(0, 0, w, 11, WOOD[3]); out.rect_(0, 0, w, 1, WOOD[4])
    for y in (3, 7):
        out.rect_(0, y, w, 1, WOOD[2])
    out.rect_(0, 11, w, 3, WOOD[1])
    for x in (2, w - 5):
        out.rect_(x, 14, 3, 6, WOOD[1]); out.rect_(x, 14, 1, 6, WOOD[2])
    for x, y, v in ((8, 4, 0), (12, 4, 0), (16, 4, 1), (16, 7, 1), (19, 7, 0)):         # dominoes
        if v:
            out.rect_(x, y, 2, 3, '#f0ead8'); out.px_(x, y + 1, INK)
        else:
            out.rect_(x, y, 3, 2, '#f0ead8'); out.px_(x + 1, y, INK)
    for x, y in ((4, 2), (28, 1), (33, 7)):                                               # mugs
        out.rect_(x, y, 3, 3, IRON[3]); out.rect_(x, y, 3, 1, IRON[4]); out.px_(x + 3, y + 1, IRON[2])
    out.ellipse_(39, 3.5, 4, 2.2, '#8a5a2a'); out.ellipse_(38.5, 3, 3, 1.4, '#b07a3a')    # a loaf
    out.line_(34, 2, 37, 1, '#c8ccd0')
    out.ellipse_(25, 6, 3, 2.5, '#e8ecf0'); out.rect_(22, 7, 6, 1, '#4a6aa0'); out.px_(21, 5, '#e8ecf0')   # teapot
    return ink(out)


def bench(w: int = 44) -> Img:
    out = Img.new(w, 7)
    out.rect_(0, 0, w, 3, WOOD[3]); out.rect_(0, 0, w, 1, WOOD[4]); out.rect_(0, 3, w, 1, WOOD[1])
    for x in (2, w - 4):
        out.rect_(x, 4, 2, 3, WOOD[1])
    return ink(out)


def coat_rack() -> Img:
    """A peg board on two posts by the door: three quilted jackets, an ushanka, felt boots and
    kirza boots in a row under them. 40 × 30."""
    w, h = 40, 30
    out = Img.new(w, h)
    out.rect_(1, 2, 2, h - 2, WOOD[1]); out.rect_(w - 3, 2, 2, h - 2, WOOD[1])
    out.rect_(0, 2, w, 3, WOOD[3]); out.rect_(0, 2, w, 1, WOOD[4])
    out = ink(out)
    for x, col in ((3, '#4a5160'), (13, '#3e463a'), (23, '#50484a')):
        out.paste_(jacket(col), x, 4)
    u = Img.new(8, 6)
    u.rect_(0, 1, 8, 4, '#4a3a2c'); u.rect_(1, 0, 6, 2, '#6a5642'); u.rect_(0, 4, 2, 2, '#3a2c20'); u.rect_(6, 4, 2, 2, '#3a2c20')
    out.paste_(ink(u), 32, 5)
    for i, x in enumerate((3, 9, 17, 23, 31)):
        c = FELT if i % 2 == 0 else KIRZA
        b = Img.new(6, 8)
        b.rect_(0, 0, 4, 8, c[2]); b.rect_(0, 0, 4, 1, c[3]); b.rect_(2, 5, 4, 3, c[1])
        out.paste_(ink(b), x, h - 8)
    return out


def fire_board() -> Img:
    """The fire board (пожарный щит): red plank with a cone bucket, an axe, a crowbar and a hook;
    the sand box «ПЕСОК» in front. 30 × 34."""
    w, h = 30, 34
    out = Img.new(w, h)
    fr = FIRE_RED
    out.rect_(0, 0, w, 24, fr[2]); out.rect_(0, 0, w, 1, fr[4]); out.rect_(0, 0, 1, 24, fr[3]); out.rect_(w - 1, 0, 1, 24, fr[1])
    out.rect_(3, 26, 2, 8, fr[1]); out.rect_(w - 5, 26, 2, 8, fr[1])
    out.poly_([(3, 4), (10, 4), (7, 15), (6, 15)], fr[4]); out.poly_([(3, 4), (6, 4), (6, 15)], '#f08878')   # bucket
    out.rect_(3, 3, 8, 1, IRON[2])
    out.rect_(15, 3, 2, 17, WOOD[3]); out.poly_([(12, 3), (17, 3), (17, 8), (12, 7)], IRON[3])              # axe
    out.rect_(21, 3, 1, 18, IRON[1]); out.px_(22, 3, IRON[1]); out.px_(23, 4, IRON[1])                     # crowbar
    out.rect_(25, 5, 1, 16, WOOD[2]); out.rect_(25, 3, 3, 2, IRON[2])                                      # hook
    out = ink(out)
    sb = Img.new(22, 11)
    sb.rect_(0, 0, 22, 4, P['straw'][3]); sb.rect_(0, 0, 22, 1, P['straw'][4])
    sb.rect_(0, 4, 22, 7, fr[2]); sb.rect_(0, 4, 22, 1, fr[3])
    t = text('ПЕСОК', '#f2e6c8', None)
    sb.paste_(t, (22 - t.w) // 2, 6)
    out.paste_(ink(sb), 4, h - 11)
    return out


def mop() -> Img:
    """A mop in its tin bucket, the handle leaning to the wall. 12 × 24."""
    out = Img.new(12, 24)
    out.line_(9, 0, 5, 14, WOOD[3]); out.line_(10, 0, 6, 14, WOOD[2])
    out.poly_([(1, 14), (11, 14), (10, 23), (2, 23)], IRON[2]); out.poly_([(1, 14), (4, 14), (4, 23), (2, 23)], IRON[3])
    out.ellipse_(6, 14, 5, 1.6, '#3e5a64')
    out.rect_(3, 12, 6, 3, '#b8ae96')
    return ink(out)


def speaker() -> Img:
    """The radio speaker (репродуктор) on the wall: a dark round cone behind a grille. 11 × 11."""
    out = Img.new(12, 12)
    out.ellipse_(6, 6, 6, 6, '#3a3a36'); out.ellipse_(5.5, 5.5, 4.2, 4.2, '#2a2a28')
    for y in (4, 6, 8):
        out.rect_(3, y, 7, 1, '#56564e')
    out.px_(6, 6, '#77776e')
    return outline(out, INK).crop(1, 1, 12, 12)


def wall_clock() -> Img:
    """A round wall clock, ten past ten. 11 × 11."""
    out = Img.new(12, 12)
    out.ellipse_(6, 6, 6, 6, WOOD[2]); out.ellipse_(6, 6, 4.6, 4.6, '#eee8d8')
    out = outline(out, INK).crop(1, 1, 12, 12)
    out.line_(5, 5, 5, 2, INK); out.line_(5, 5, 8, 6, INK); out.px_(5, 5, P['red'][2])
    return out


def mirror() -> Img:
    out = Img.new(14, 12)
    out.rect_(0, 0, 14, 12, WOOD[1]); out.rect_(1, 1, 12, 10, '#a8c0c8'); out.rect_(1, 1, 12, 3, '#c8dce0')
    out.line_(3, 9, 8, 2, '#dff0f2')
    return ink(out)


def towels() -> Img:
    """Two hooks with towels, white with a red border, for the wall face. 20 × 14."""
    out = Img.new(20, 14)
    out.rect_(0, 0, 20, 2, WOOD[2])
    for i, x in enumerate((2, 11)):
        ln = 10 + i * 2
        out.rect_(x, 2, 6, ln, LINEN[3]); out.rect_(x + 5, 2, 1, ln, LINEN[1]); out.rect_(x, ln, 6, 1, FIRE_RED[2])
    return ink(out)


def schedule() -> Img:
    """«РАСПОРЯДОК ДНЯ» — the day's schedule on a board over a ruled sheet of the hours."""
    p = plate(['РАСПОРЯДОК', 'ДНЯ'], '#f2e6c8', '#2c3a4a', pad=1)
    w = max(p.w, 30)
    out = Img.new(w, 26)
    out.paste_(p, (w - p.w) // 2, 0)
    sheet = paper_sheet(w - 8, 26 - p.h - 1, seed=3)
    out.paste_(sheet, 4, p.h + 1)
    return out


# ------------------------------------------------------------------------------------ map
def build() -> Map:
    m = Map('barrack1', W, H, 'indoor', name='Барак 1', ambient=0.55, music='yard')
    shell(m, 'plaster', 'planks', face=2, door=(5, 2), out_to='square', out_at='barrack1', floor_seed=6)
    g = m.ground
    r = rng('barrack-floor')

    # --- ground: the runner from the door to the orderly, soot round the stove, a damp patch
    # under the washstand, butts and paper by the door
    rn = runner(2 * T - 4, 9 * T, ['#3e1216', '#6a1c20', '#8f2a26', '#aa3c30'],
                ['#1f3322', '#2f4f33', '#437048', '#5e9360'])
    m.stamp(rn, 5 * T + 2, 5 * T + 4)
    m.stamp(dust_decal(3 * T, 3 * T, 21, '#1a1414', 0.22, 70), 1 * T, 3 * T)
    g.ellipse_(9.5 * T, 4.9 * T, 24, 5, '#26343a', 0.3)
    litter(g, r, 'butt', 6, (3 * T, 10 * T, 9 * T, 13 * T))
    litter(g, r, 'paper', 2, (4 * T, 11 * T, 8 * T, 13 * T))
    litter(g, r, 'ash', 30, (1 * T, 4 * T, 4 * T, 6 * T))
    # the iron sheet under the stove (fire rule), riveted
    sheet = Img.new(2 * T + 6, T + 2)
    sheet.rect_(0, 0, sheet.w, sheet.h, IRON[2]); sheet.rect_(1, 1, sheet.w - 2, sheet.h - 2, IRON[3])
    for x in (2, sheet.w - 3):
        for y in (2, sheet.h - 3):
            sheet.px_(x, y, IRON[4])
    m.stamp(ink(sheet), 1 * T - 1, 4 * T + 2)

    # --- north wall face, west to east: the stove pipe (the stove's own), footcloths drying by
    # it, a barred window, the schedule over the orderly, a wall lamp, the clock and the radio
    # speaker, the mirror and two towels over the washstand
    m.stamp(footcloths(), 2 * T + 8, T + 6)
    m.stamp(window(16, 16, bars=3), 4 * T - 4, T + 4)
    m.light(4 * T + 4, 2 * T + 4, 30, '#9fc4d0', 'window')
    sc = schedule()
    m.stamp(sc, 6 * T - sc.w // 2, T + 1)
    m.stamp(bulb_wall(), 7 * T + 4, T + 5)
    m.light(7 * T + 8, T + 12, 26, '#fff1c2', 'lamp')
    m.stamp(wall_clock(), 8 * T - 1, T + 2)
    m.stamp(speaker(), 8 * T - 1, 2 * T + 2)
    m.stamp(mirror(), 9 * T + 3, T + 3)
    m.stamp(towels(), 10 * T + 1, T + 2)

    # --- the stove in the north-west corner, its pipe up the wall; wood and the scuttle by it
    frames = [stove(i) for i in range(4)]
    m.put('barrack1.stove', frames, 1 * T - 2, 5 * T - frames[0].h, fps=6, solid=(1, 3.6, 2.6, 4.95))
    m.light(1 * T + 10, 4 * T + 4, 90, '#ff8a3a', 'fire')
    m.emit('embers', 1 * T + 10, 4 * T - 2, 0.35)
    m.emit('steam', 1 * T + 5, 2 * T + 10, 0.5)
    m.put('barrack1.firewood', firewood(), 2 * T + 12, 5 * T - 14, solid=(2.75, 4.3, 3.95, 4.95))
    m.put('barrack1.scuttle', scuttle(), 4 * T, 5 * T - 10, solid=(4, 4.4, 4.6, 4.95))

    # --- the orderly behind his тумбочка, facing the door; its top edge at his feet
    dd = duty_desk()
    m.put('barrack1.dutydesk', dd, 6 * T - dd.w // 2, int(4.45 * T), solid=(4.95, 4.55, 7.05, 5.5))
    m.npc('orderly', 'orderly', 6.0, 4.35, face=0, anim='idle', name='Дневальный')
    m.marks['orderly'] = (6.0, 4.35)
    m.block(4.95, 3.9, 5.4, 4.6); m.block(6.6, 3.9, 7.05, 4.6)                # close the gaps behind

    # --- the washstand in the north-east, a bucket by its end
    ws = [washstand(i) for i in range(4)]
    m.put('barrack1.washstand', ws, 8 * T + 4, 5 * T - ws[0].h, fps=3, solid=(8.25, 3.6, 11, 4.95))
    m.put('kit.bucket', bucket(True), 7 * T + 8, 5 * T - 10, solid=(7.5, 4.45, 8.15, 4.95))

    # --- west: two double bunks, head to the wall; the guitar leans on the first
    b1 = bunk(BLANKET, seed=1)
    m.put('barrack1.bunk.a', b1, 1 * T - 1, int(7.4 * T) - b1.h, solid=(1, 6.55, 3.25, 7.4))
    b2 = bunk(BLANKET, seed=2, extra='boots')
    m.put('barrack1.bunk.b', b2, 1 * T - 1, int(10.5 * T) - b2.h, solid=(1, 9.65, 3.25, 10.5))
    m.put('barrack1.guitar', guitar(), 3 * T + 2, int(8.1 * T) - 26, solid=(3.25, 7.7, 3.7, 8.1))
    m.put('barrack1.stand.a', nightstand(), 1 * T, int(11.9 * T) - 17, solid=(1, 11.3, 1.9, 11.9))
    m.put('kit.stool', stool(), 2 * T + 4, int(11.9 * T) - 10, solid=(2.3, 11.35, 2.9, 11.9))

    # --- east: a double bunk, then YOUR bunk (single, the red blanket, the cat) with the chest
    b3 = bunk(BLANKET, seed=3, extra='book')
    m.put('barrack1.bunk.c', b3.flip(), 11 * T - 37, int(7.4 * T) - b3.h, solid=(8.7, 6.55, 11, 7.4))
    mb = [my_bunk(i).flip() for i in range(2)]
    m.put('barrack1.mybunk', mb, 11 * T - 37, int(10.6 * T) - mb[0].h, fps=0.8,
          solid=(8.7, 9.8, 11, 10.6))
    m.put('barrack1.stand.b', nightstand(photo=True), 10 * T, int(11.8 * T) - 17, solid=(10, 11.2, 10.9, 11.8))
    m.stamp(bedside_mat(), int(8.75 * T), int(10.62 * T))
    ch = [chest(i) for i in range(12)]
    m.put('barrack1.chest', ch, 7 * T + 7, int(10.55 * T) - ch[0].h, fps=4, solid=(7.45, 9.9, 8.65, 10.55))
    m.light(8 * T, 10 * T, 26, '#ffd76a', 'glow')
    m.emit('motes', 8 * T, 9 * T + 12, 0.3)
    # the chest is a door you use, laid over the chest itself: a tap anywhere on it opens it,
    # and the hero comes up to it from the north, from the aisle by the table
    m.door(7.45, 9.9, 1.2, 0.65, '@bunk', '', kind='use', label='Мой сундук')
    m.marks['chest'] = (8.05, 10.2)

    # --- the middle: the long table with its benches, the lamp over it
    m.put('barrack1.bench.n', bench(), int(4.45 * T), int(6.6 * T), solid=(4.45, 6.6, 7.2, 7.0))
    tb = table()
    m.put('barrack1.table', tb, int(4.4 * T), int(8.1 * T) - tb.h + 6, solid=(4.4, 7.1, 7.25, 8.1))
    m.put('barrack1.bench.s', bench(), int(4.45 * T), int(8.5 * T), solid=(4.45, 8.5, 7.2, 8.9))
    # a short cord over the table — a long one crossed the orderly's desk and read as a pendulum
    m.put('barrack1.hanglamp', lamp_hanging(12), int(5.6 * T), int(6.1 * T), layer='top')
    m.light(int(5.9 * T), int(7.6 * T), 60, '#ffd98a', 'lamp')

    # --- the south: the coat rack by the door (west), the fire board and a mop (east), a rat
    cr = coat_rack()
    m.put('barrack1.coats', cr, 1 * T - 1, 14 * T - cr.h, solid=(1, 13.1, 3.5, 13.7))
    fb = fire_board()
    m.put('barrack1.fireboard', fb, 9 * T + 2, 14 * T - fb.h, solid=(9.1, 13.1, 10.9, 13.8))
    m.put('barrack1.mop', mop(), 8 * T + 2, 14 * T - 24, solid=(8.1, 13.35, 8.8, 13.8))
    rats = [rat(i, look=1) for i in range(4)]
    m.put('barrack1.rat', rats, 3 * T + 12, 14 * T - 2 - rats[0].h, fps=2)
    return m
