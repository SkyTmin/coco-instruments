"""Питомник (v2.80) — the keeper's barn of pets and eggs.

12 × 13 tiles. Whitewashed plank walls, a board floor strewn with straw. The keeper stands
behind her vet table in the middle of the north half, the door straight south of her. Behind
her, on the north wall: the incubation bench with the TWO NESTS under a red heat lamp — the game
draws the player's real eggs there (marks `nest0`, `nest1`, the egg's feet). West: a basket of
eggs, the water trough, the hay pile with a pitchfork and two hens, a ginger cat asleep on its
bed. East: a stack of wire cages (a rabbit, a hedgehog, a chick, an empty one with its door
open), a doghouse with a dog and bowls, a terrarium with a frog. Leashes, posters, a sign.

Eggs for the nests are drawn here and registered for the game ('kennel.egg.moss', '.stone',
'.crystal', '.dragon', 12 × 14, feet on the bottom row) with 'kennel.egg.glow' (16 × 16), the
soft ring behind an egg that is ready to hatch.

How the game draws the eggs: an egg's feet at the mark, sorted with base = mark y. The nest is
two sprites: 'kennel.nest' (straw ring and hollow, base above the egg's) and 'kennel.nestrim'
(the front of the ring, base = egg feet + 2 px), so the rim covers the egg's bottom 3 px and the
egg sits IN the straw. 'kennel.egg.glow' goes behind the egg (base one pixel above it).

Lessons from the review rounds:
  1. Sorting is everything with the nests: the bench's base was south of the eggs, so its top
     face covered them to the middle and hid the nests entirely. The bench sorts first (base =
     its top), then the nest backs, then the eggs, then the rims.
  2. An egg drawn 12 × 14, outlined, then cropped back to 12 × 14 loses its contour at the
     widest row — the shell is drawn 10 × 12 and the contour makes it 12 × 14.
  3. Veins as scattered dots made the dragon egg a ladybird: they are branching lines now.
  4. The keeper vanished twice — behind an egg basket beside her and under the hanging lamp.
     Nothing tall stands next to a resident, and 'top'-layer lamps hang where nobody stands.
  5. A dark oblong on legs is a bench, not a trough: a galvanised oval tub seen from above,
     mostly water. A round sack is a pot: sacks need a flat base and tied ears. A dog face
     with round ears on top is a bear: floppy ears at the sides and a tongue. A cream box with
     bars is a radiator: a carrier needs the domed two-tone plastic and a handle. A red striped
     blanket with a bone on it is a fish on a plate.
  6. The NA straw mat stamped on the floor read as a beige carpet; loose straw in drifts
     (thick under the hay, cages and bench, a few stalks elsewhere) reads as a barn. An even
     scatter over the whole floor read as rain.
  7. A playpen inked post by post became a dark crate: pale pine, posts every 9 px, one outer
     contour, and a front fence low enough that the pets show above it.
  8. The vet table's collision reaches up to y 5, or the player slips behind it through the
     half-tile gap between the table and the cages.
"""
from __future__ import annotations

import math

import numpy as np

from art_shops import bottle, cat_asleep, dust_decal, hang_lamp, poster, straw_decal
from kit import INK, P, bucket, ink, shell, text, window
from lib import T, Img, Map, camp, grid, na, outline, ramp, register, rng

W, H = 12, 13
ST = P['straw']


# ------------------------------------------------------------------------------------ eggs
def _egg_mask(w: int = 12, h: int = 14, lump: float = 0.0, seed: int = 1) -> np.ndarray:
    """An egg: wider low, narrower high. lump>0 roughens the outline (a boulder egg)."""
    m = np.zeros((h, w), bool)
    cx = (w - 1) / 2
    for y in range(h):
        for x in range(w):
            t = (y + 0.5) / h                      # 0 top … 1 bottom
            yy = (y + 0.5 - h * 0.56) / (h * 0.5)
            rx = (w / 2) * (0.78 + 0.22 * max(0, min(1, t * 1.4))) if yy < 0 else w / 2
            nx = (x - cx) / rx
            d = nx * nx + yy * yy
            if lump:
                d += lump * (math.sin(x * 1.7 + seed) + math.cos(y * 1.3 + seed * 2)) * 0.12
            if d <= 1.0:
                m[y, x] = True
    return m


def _egg_base(ramp_: list[str], mask: np.ndarray) -> Img:
    """Shade an egg mask: dark rim right and low, light upper left, a highlight."""
    h, w = mask.shape
    out = Img.new(w, h)
    for y in range(h):
        for x in range(w):
            if not mask[y, x]:
                continue
            lx, ly = (x - w * 0.35) / w, (y - h * 0.32) / h
            k = math.hypot(lx, ly)
            i = 3 if k < 0.18 else 2 if k < 0.42 else 1
            out.px_(x, y, ramp_[i])
    return out


def egg_moss() -> Img:
    """The mossy egg: a warm brown shell under patches of moss, bright tufts on top. 12 × 14
    (a 10 × 12 shell inside its contour — the contour must not be cropped at the egg's widest)."""
    m = _egg_mask(10, 12, 0, 1)
    out = _egg_base(['#3a3020', '#6b5a3a', '#8f7a52', '#b49e70'], m)
    r = rng('moss')
    for _ in range(36):
        x, y = r.randrange(0, 10), r.randrange(2, 12)
        if m[y, x] and r.random() < (0.35 + y / 24):
            out.px_(x, y, r.choice(['#3e5234', '#566d44', '#4a6038']))
    for x, y in ((2, 1), (3, 0), (6, 1), (7, 2), (4, 4), (1, 6), (8, 5)):
        if m[y, x]:
            out.px_(x, y, '#94ab6c')
    out = outline(out, INK)
    out.px_(4, 3, '#dccf9c')
    out.px_(4, 0, '#94ab6c'); out.px_(7, 1, '#728c55')                         # tufts on the contour
    return out


def egg_stone() -> Img:
    """The stone egg: a lumpy grey boulder with a violet amethyst druse bursting from its side."""
    m = _egg_mask(10, 12, 0.9, 3)
    out = _egg_base(P['stone'][:4], m)
    r = rng('stone-egg')
    for _ in range(7):
        x, y = r.randrange(1, 9), r.randrange(2, 11)
        if m[y, x]:
            out.px_(x, y, P['stone'][0])
    druse = ['..ab.', '.acbd', 'acbdb', 'bdcbd', '.bdb.']
    for yy, row in enumerate(druse):
        for xx, v in enumerate(row):
            if v != '.' and m[4 + yy, 5 + xx]:
                out.px_(5 + xx, 4 + yy, {'a': '#c9a6ff', 'b': '#6b3fa0', 'c': '#9a6be0', 'd': '#452a66'}[v])
    out = outline(out, INK)
    out.px_(8, 6, '#f4ecff')
    out.px_(4, 3, P['stone'][4])
    return out


def egg_crystal() -> Img:
    """The crystal egg: cyan glass cut in facets — each facet its own tone, a white glint on the
    brightest, the contour deep blue rather than ink so it glows."""
    m = _egg_mask(10, 12, 0, 2)
    tones = ['#1f5a70', '#2f86a0', '#4fb4c8', '#8ae0ea', '#d8fbff']
    out = Img.new(10, 12)
    for y in range(12):
        for x in range(10):
            if not m[y, x]:
                continue
            a = (x + y) // 4
            b = (x - y + 20) // 4
            f = (a * 3 + b * 5) % 5
            base = [2, 3, 1, 2, 3][f]
            if x < 4 and y < 6:
                base = min(4, base + 1)
            if x > 7 or y > 9:
                base = max(0, base - 1)
            out.px_(x, y, tones[base])
    out = outline(out, '#123848')
    out.px_(4, 3, '#ffffff'); out.px_(5, 4, tones[4]); out.px_(3, 5, tones[4])
    return out


def egg_dragon() -> Img:
    """The dragon egg: dark scales in offset scallop rows, a gold rim round its waist, and red
    veins that glow through the shell as branching LINES — as scattered dots they read as a
    ladybird."""
    m = _egg_mask(10, 12, 0, 4)
    out = Img.new(10, 12)
    sc = ['#1a1016', '#2e1a22', '#4a2a32', '#6a3a40']
    for y in range(12):
        for x in range(10):
            if not m[y, x]:
                continue
            row = y // 3
            xx = (x + (row % 2) * 2) % 4
            yy = y % 3
            c = sc[2] if (xx in (1, 2) and yy == 0) else sc[1]
            if x < 4 and y < 5:
                c = sc[3] if c == sc[2] else sc[2]
            if x > 7:
                c = sc[0] if c == sc[1] else sc[1]
            out.px_(x, y, c)
    veins = [(5, 0), (4, 1), (4, 2), (3, 3), (3, 4), (2, 5), (2, 6), (4, 2), (5, 3), (6, 4), (7, 5), (7, 6),
             (3, 9), (4, 10), (4, 11), (7, 9), (7, 10), (6, 11)]
    for i, (x, y) in enumerate(veins):
        if m[y, x]:
            out.px_(x, y, '#ff8a4a' if i in (3, 9, 13) else '#c8321e')
    for x in range(10):
        if m[7, x]:
            out.px_(x, 7, P['gold'][3] if x < 6 else P['gold'][2])
        if m[8, x]:
            out.px_(x, 8, P['gold'][1])
    out = outline(out, INK)
    out.px_(3, 2, '#8a4a50')
    return out


def egg_glow() -> Img:
    """A soft golden ring for an egg that is ready: 16 × 16, alpha falling off both ways from a
    radius of 6, brightest at the top where the light catches."""
    out = Img.new(16, 16)
    for y in range(16):
        for x in range(16):
            d = math.hypot(x + 0.5 - 8, (y + 0.5 - 8) * 1.1)
            a = max(0.0, 1 - abs(d - 6) / 2.2)
            if a > 0:
                up = 1.15 if y < 8 else 0.85
                out.a[y, x] = (255, 226, 130, int(min(1, a * up) * 200))
    return out


# ------------------------------------------------------------------------------ the nests
NEST_W = 22


def nest_back() -> Img:
    """The back half of a straw nest: a thick ring of twisted straw seen from above and a dark
    hollow; the egg sits over it. 24 × 12."""
    out = Img.new(NEST_W, 11)
    out.ellipse_(11, 5.5, 11, 5.5, ST[1])
    out.ellipse_(11, 5, 10, 4.5, ST[2])
    out.ellipse_(11, 5.8, 6.8, 2.8, '#4a3a22')
    out.ellipse_(11, 6.2, 5.2, 2, '#2e2214')
    r = rng('nestback')
    for _ in range(34):
        a = r.uniform(math.pi * 0.95, 2.05 * math.pi)
        rr = r.uniform(7.5, 10)
        x, y = 11 + rr * math.cos(a), 5.5 + rr * 0.48 * math.sin(a)
        out.line_(int(x), int(y), int(x + r.choice([-2, -1, 1, 2])), int(y + r.choice([-1, 0])), ST[r.choice([3, 4, 2, 3])])
    return outline(out, INK)


def nest_rim() -> Img:
    """The front half of the nest's straw ring — drawn after the egg so the egg sits IN the
    straw, not on it: 3 px of rim across the egg's bottom, stalks poking out at the sides. 24 × 7."""
    w = NEST_W + 2
    rim = Img.new(NEST_W, 12)
    rim.ellipse_(11, 5.5, 11, 5.5, ST[2])
    rim.ellipse_(11, 5, 10, 4.2, ST[3])
    hole = Img.new(NEST_W, 12); hole.ellipse_(11, 5.3, 7.4, 3.4, '#ffffff')
    rim.a[hole.a[:, :, 3] > 0, 3] = 0
    rim.a[:6, :, 3] = 0
    r = rng('nestrim')
    for _ in range(26):
        x, y = r.uniform(1, 21), r.uniform(6.5, 10.5)
        if rim.a[min(11, int(y)), min(21, int(x)), 3]:
            rim.line_(int(x), int(y), int(x + r.choice([-2, 2])), int(y + r.choice([0, 1])), ST[r.choice([1, 2, 4])])
    for x, y in ((0, 6), (21, 6), (1, 8), (20, 8)):
        rim.px_(x, y, ST[4])
    o = outline(rim, INK)
    out = Img.new(w, 7)
    out.paste_(o.crop(0, 6, o.w, 7), 0, 0)
    return out


def incubator_bench() -> Img:
    """The incubation bench: a low plank table with a straw mat on top, a thermometer at the side
    and a warm cloth hanging over the front. The nests sit on it. 56 × 22."""
    w, h = 56, 22
    out = Img.new(w, h)
    wd = P['wood']
    out.rect_(0, 4, w, 8, wd[3]); out.rect_(0, 4, w, 1, wd[4]); out.rect_(0, 11, w, 3, wd[1])
    for x in range(2, w - 2, 9):
        out.px_(x, 7, wd[2])
    out.rect_(2, 14, 4, 8, wd[2]); out.rect_(w - 6, 14, 4, 8, wd[1]); out.rect_(26, 14, 4, 8, wd[1])
    out.rect_(4, 18, w - 8, 2, wd[1])
    # the cloth over the front
    cl = ramp('#a8323b', 4, 0.45)
    out.rect_(8, 11, 40, 5, cl[2]); out.rect_(8, 11, 40, 1, cl[3])
    for x in range(8, 48, 4):
        out.rect_(x, 12, 2, 4, cl[1])
    out = ink(out)
    # straw mat on the top face
    for x in range(1, w - 1):
        out.px_(x, 5 + (x * 7 % 3 == 0), ST[3] if x % 3 else ST[2])
    return out


def thermometer() -> Img:
    """A wall thermometer on a wooden plate: the red column up in the warm. 7 × 18."""
    out = Img.new(7, 18)
    out.rect_(0, 0, 7, 18, P['wood'][3]); out.rect_(0, 0, 7, 1, P['wood'][4])
    out.rect_(3, 2, 1, 12, '#e8e8e0')
    out.rect_(3, 5, 1, 9, P['red'][3])
    out.ellipse_(3.5, 15, 1.8, 1.8, P['red'][3])
    for y in range(3, 14, 2):
        out.px_(5, y, INK)
    return ink(out)


# ----------------------------------------------------------------------------------- furniture
def vet_table() -> Img:
    """The keeper's table: steel top on a wooden frame, a white towel, a first-aid tin, a
    brown bottle, a comb and a stethoscope coiled on the towel. 40 × 22."""
    w, h = 40, 22
    out = Img.new(w, h)
    ir, wd = P['iron'], P['wood']
    out.rect_(0, 0, w, 9, ir[3]); out.rect_(0, 0, w, 1, ir[4]); out.rect_(0, 8, w, 3, ir[2]); out.rect_(0, 10, w, 1, ir[1])
    out.rect_(2, 11, 3, 11, wd[2]); out.rect_(w - 5, 11, 3, 11, wd[1])
    out.rect_(5, 16, w - 10, 2, wd[1]); out.rect_(5, 16, w - 10, 1, wd[2])
    out = ink(out)
    # towel
    out.rect_(12, 1, 16, 7, '#e8e4d8'); out.rect_(12, 1, 16, 1, '#ffffff'); out.rect_(12, 6, 16, 1, '#c0bcae')
    out.rect_(12, 3, 16, 1, '#7aa8c8')
    # stethoscope on the towel
    for i in range(14):
        a = i * 2 * math.pi / 14
        out.px_(int(20 + 4 * math.cos(a)), int(4 + 2 * math.sin(a)), '#2a2a30')
    out.rect_(24, 4, 3, 2, ir[4]); out.px_(25, 4, '#ffffff')
    # first aid tin (NA medipack)
    mk = camp(na('Items/Potion/Medipack.png'), sat=0.8)
    out.paste_(mk, 1, -2)
    # a brown bottle and a comb
    b = bottle('tall', '#8a5a2a', 0.8, cork='#e8e4d8')
    out.paste_(b, 31, -2)
    out.rect_(35, 5, 4, 1, P['red'][2]); out.px_(35, 6, P['red'][1]); out.px_(37, 6, P['red'][1])
    return out


def cage(animal: str, frame: int = 0) -> Img:
    """A wire cage on the floor or on another cage: a wooden base and top, bars, straw inside
    and who lives there. 'rabbit', 'hedgehog', 'chick', 'empty' (door hanging open). 22 × 18."""
    w, h = 22, 18
    out = Img.new(w, h)
    wd, ir = P['wood'], P['iron']
    out.rect_(0, 0, w, 3, wd[3]); out.rect_(0, 0, w, 1, wd[4])                      # top
    out.rect_(1, 3, w - 2, 12, '#2a2220')                                          # inside, dark
    out.rect_(1, 11, w - 2, 4, ST[1])                                               # straw inside
    for x in range(2, w - 2, 2):
        out.px_(x, 11 + (x // 2) % 2, ST[3])
    # the animal, before the bars
    b = frame % 2
    if animal == 'rabbit':
        c = ['#6b6660', '#b8b2a6', '#e6e0d2', '#ffffff']
        out.ellipse_(12, 11 - b * 0.3, 5, 3, c[2]); out.ellipse_(11, 10.5, 3.5, 2, c[3])
        out.ellipse_(7, 9, 2.5, 2.2, c[2])
        out.rect_(6, 4 - b, 1, 5, c[2]); out.rect_(8, 4, 1, 5, c[1])                 # ears
        out.px_(6, 8, INK); out.px_(5, 9, '#e0a0a0'); out.px_(17, 10, c[3])
    elif animal == 'hedgehog':
        out.ellipse_(11, 11, 6, 3.3, '#3a2a20')
        for x in range(6, 17, 2):
            out.px_(x, 8 - (x % 4 == 0), '#6b5040'); out.px_(x + 1, 9, '#8a6a50')
        out.ellipse_(5.5, 11.5, 2, 1.6, '#b89a78'); out.px_(4, 11, INK); out.px_(3, 12, INK)
    elif animal == 'chick':
        out.ellipse_(11, 11 - b * 0.5, 3.5, 3, '#e8c84a'); out.ellipse_(10, 10 - b * 0.5, 2, 1.5, '#f8e070')
        out.px_(9, 10 - b, INK); out.px_(7, 11 - b, '#e07a2a')
        out.ellipse_(16, 12, 2, 1.2, '#d0c0a0')                                     # a feeding dish
    # bars
    for x in range(1, w - 1, 3):
        out.rect_(x, 3, 1, 12, ir[3])
    out.rect_(1, 7, w - 2, 1, ir[2])
    if animal == 'empty':
        out.rect_(4, 3, 10, 12, '#2a2220')                                          # the door is open
        out.rect_(4, 11, 10, 4, ST[1])
        for y in range(4, 14, 3):
            out.rect_(-1 + 0, y, 1, 1, ir[3])
        out.line_(3, 3, 3, 14, ir[1])
    out.rect_(0, 15, w, 3, wd[2]); out.rect_(0, 15, w, 1, wd[3])                     # base
    out = ink(out)
    if animal == 'empty':
        # the open door swung out to the left, bars seen at a slant
        dr = Img.new(6, 12)
        for x in range(0, 6, 2):
            dr.rect_(x, 0, 1, 12, ir[3])
        dr.rect_(0, 0, 6, 1, ir[2]); dr.rect_(0, 11, 6, 1, ir[2])
        out.paste_(dr, 0, 3)
    return out


def cage_stack(frame: int) -> Img:
    """Four cages two by two: rabbit and hedgehog below, a chick and an empty one above.
    A tag on each. 46 × 36."""
    out = Img.new(46, 36)
    out.paste_(cage('empty', frame), 0, 0)
    out.paste_(cage('chick', frame), 23, 0)
    out.paste_(cage('rabbit', frame), 0, 18)
    out.paste_(cage('hedgehog', frame), 23, 18)
    for x, y in ((9, 16), (32, 16), (9, 34), (32, 34)):
        out.rect_(x, y - 1, 4, 2, P['paper'][3])
    return out


def doghouse() -> Img:
    """A plank doghouse with a pitched roof of grey shingles, an arched dark door and a name
    board over it. 32 × 30."""
    w, h = 32, 30
    out = Img.new(w, h)
    wd, sl = P['wood'], P['slate']
    # front wall
    out.rect_(3, 12, 26, 18, wd[2])
    for y in range(13, 30, 3):
        out.rect_(3, y, 26, 1, wd[1])
    out.rect_(3, 12, 2, 18, wd[3])
    # arched door
    out.rect_(11, 19, 10, 11, '#140e0c'); out.ellipse_(16, 19, 5, 4, '#140e0c')
    # the roof: two slopes meeting over the middle, overhanging
    out.poly_([(0, 14), (16, 1), (32, 14), (29, 16), (16, 5), (3, 16)], sl[2])
    out.poly_([(0, 14), (16, 1), (16, 5), (3, 16)], sl[3])
    for i in range(3):
        y = 6 + i * 3
        out.line_(16 - (y - 1), y + 3, 16, y - 1, sl[1]); out.line_(16, y - 1, 16 + (y - 1), y + 3, sl[1])
    out = ink(out)
    # the name board
    out.rect_(12, 10, 8, 4, P['paper'][2]); out.rect_(13, 11, 6, 1, P['wood'][1]); out.rect_(13, 13, 4, 1, P['wood'][1])
    return out


def dog_sitting(frame: int) -> Img:
    """NA's dog (Actor/Animals/Dog), graded; two frames of its sheet as a breathing idle."""
    sh = camp(na('Actor/Animals/Dog/SpriteSheet.png'), sat=0.75)
    return sh.crop((frame % 2) * 16, 0, 16, 16)


def hen(frame: int, kind: str = 'White') -> Img:
    sh = camp(na(f'Actor/Animals/Chicken/SpriteSheet{kind}.png'), sat=0.75)
    return sh.crop((frame % 2) * 16, 0, 16, 16)


def bowl(kind: str) -> Img:
    """A pet bowl, 10 × 6: 'food' (red with brown kibble) or 'water' (blue with water)."""
    base = '#a8323b' if kind == 'food' else '#3d6fb0'
    c = ramp(base, 4, 0.4)
    out = Img.new(10, 6)
    out.ellipse_(5, 3.5, 5, 2.5, c[1]); out.rect_(0, 2, 10, 2, c[2]); out.ellipse_(5, 2, 5, 2, c[3])
    out.ellipse_(5, 2, 3.4, 1.2, '#7a5030' if kind == 'food' else '#6fa8c8')
    if kind == 'food':
        for x in (3, 5, 7):
            out.px_(x, 2, '#a07040')
    else:
        out.px_(4, 2, '#c8e8f0')
    return outline(out, INK)


def trough() -> Img:
    """A galvanised water trough: an oval tin tub on short legs, seen from above so the water
    fills most of it — rippled, with a glint — and a dented rim. Grey metal, so it does not read
    as one more wooden bench among the furniture. 38 × 18."""
    w, h = 38, 18
    out = Img.new(w, h)
    c = P['concrete']
    out.rect_(4, 12, 3, 6, P['iron'][1]); out.rect_(w - 7, 12, 3, 6, P['iron'][1])
    out.ellipse_(19, 9, 19, 7, c[1])
    out.rect_(0, 7, w, 5, c[1])
    out.ellipse_(19, 12, 19, 5, c[1])
    out.ellipse_(19, 7, 19, 6, c[3])
    for x in range(4, w - 4, 6):                                                     # ribs
        out.rect_(x, 9, 1, 7, c[2])
    out = ink(out)
    out.ellipse_(19, 7, 16.5, 4.3, '#2c5664')
    out.ellipse_(18, 6.4, 14, 3.2, '#3f7482')
    for x, y, L in ((9, 5, 5), (22, 7, 6), (14, 8, 4), (27, 5, 3)):
        out.rect_(x, y, L, 1, '#78aab6')
    out.rect_(10, 4, 3, 1, '#d8f0f4')
    out.px_(2, 6, c[4]); out.px_(35, 6, c[2])
    return out


def hay_pile() -> Img:
    """A heap of loose hay against the wall with a pitchfork stuck in it: a tall mound lit on top
    and dark at the foot, stalks in four shades, loose stalks standing out of the silhouette.
    40 × 30."""
    w, h = 40, 30
    out = Img.new(w, h)
    r = rng('hay')
    mound = Img.new(w, h)
    mound.poly_([(1, 29), (4, 20), (9, 12), (15, 7), (22, 6), (29, 9), (34, 15), (38, 22), (39, 29)], ST[1])
    out.paste_(mound, 0, 0)
    inner = Img.new(w, h)
    inner.poly_([(4, 26), (8, 18), (13, 11), (19, 8), (26, 9), (32, 15), (35, 22), (35, 26)], ST[2])
    out.paste_(inner, 0, 0)
    top = Img.new(w, h)
    top.poly_([(8, 18), (13, 11), (19, 8), (25, 9), (21, 14), (13, 18)], ST[3])
    out.paste_(top, 0, 0)
    m = mound.a[:, :, 3] > 0
    for _ in range(220):
        x, y = r.randrange(0, w), r.randrange(0, h)
        if m[y, x]:
            dx = r.choice([-2, -1, 1, 2])
            lit = y < 16 and x < 26
            col = ST[4] if lit and r.random() < 0.5 else ST[r.choice([1, 2, 3] if y < 22 else [0, 1, 2])]
            out.line_(x, y, x + dx, y + 1, col)
    out = outline(out, INK)
    for x, y, dx, dy in ((10, 11, -3, -2), (16, 7, -1, -3), (24, 6, 2, -3), (32, 11, 3, -1), (4, 18, -3, -1)):
        out.line_(x, y, x + dx, y + dy, ST[3])
    wd = P['wood']
    out.line_(31, 0, 27, 14, wd[3]); out.line_(32, 0, 28, 14, wd[1])
    out.rect_(30, 0, 3, 1, INK)
    return out


def egg_basket() -> Img:
    """A wicker basket of ordinary eggs (white and brown) by the nests. 18 × 14."""
    w, h = 18, 14
    out = Img.new(w, h)
    for i, (x, y, c) in enumerate(((4, 6, '#e8dcc8'), (8, 5, '#c8945a'), (12, 6, '#f0e8da'), (6, 3, '#d8a870'), (10, 3, '#efe6d6'))):
        out.ellipse_(x, y, 2.4, 3, c); out.px_(int(x) - 1, int(y) - 1, '#ffffff')
    out.rect_(1, 6, 16, 8, ST[2]); out.rect_(1, 6, 16, 1, ST[3])
    for x in range(2, 16, 2):
        out.rect_(x, 7, 1, 7, ST[1])
    for y in (9, 12):
        out.rect_(1, y, 16, 1, ST[3])
    out = outline(out, INK)
    # the handle arching over
    for i in range(16):
        a = math.pi + i * math.pi / 15
        out.px_(int(9 + 7.5 * math.cos(a)), int(6 + 5.5 * math.sin(a)), P['wood'][2])
    return out


def feed_sack(lying: bool = False) -> Img:
    """A burlap feed sack: a squarish body slumped at the bottom, the neck gathered and tied with
    twine, a fold down the side, a paw stencilled in brown. Round sacks read as pots — a sack
    needs its tied ears and a flat base. 14 × 17 (standing) or 18 × 11 (lying)."""
    b = ['#5c4c34', '#7d6a4a', '#a08a62', '#c4ae84']
    if lying:
        out = Img.new(18, 11)
        out.poly_([(1, 3), (14, 2), (17, 5), (16, 10), (1, 10), (0, 6)], b[1])
        out.poly_([(2, 3), (13, 3), (15, 6), (2, 7)], b[2])
        out.rect_(14, 3, 3, 5, b[2]); out.rect_(15, 4, 2, 1, '#6b3a2c')
        out.line_(4, 5, 11, 4, b[3])
        return outline(out, INK)
    out = Img.new(14, 17)
    out.poly_([(3, 5), (11, 5), (13, 10), (13, 16), (1, 16), (1, 10)], b[1])
    out.poly_([(3, 5), (8, 5), (9, 12), (2, 14), (2, 10)], b[2])
    out.rect_(4, 1, 6, 4, b[2]); out.rect_(3, 0, 3, 2, b[2]); out.rect_(8, 0, 3, 2, b[1])   # gathered neck
    out.rect_(4, 4, 6, 1, '#6b3a2c')                                                      # twine
    out.line_(10, 7, 11, 15, b[0])                                                         # fold
    out.rect_(1, 15, 12, 1, b[0])
    out = outline(out, INK)
    paw = '#5a3020'
    out.rect_(6, 11, 3, 2, paw)
    for x, y in ((5, 9), (7, 8), (9, 9)):
        out.px_(x + 1, y + 1, paw)
    return out


def feed_sacks() -> Img:
    """Two feed sacks standing together and one lying in front, a tin scoop on top. 26 × 20."""
    out = Img.new(26, 20)
    s = feed_sack()
    out.paste_(s, 10, 0)
    out.paste_(s, 0, 1)
    ly = feed_sack(True)
    out.paste_(ly, 6, 8)
    out.rect_(12, 0, 4, 2, P['iron'][3]); out.rect_(16, 0, 3, 1, P['iron'][2])
    return out


def pet_carrier() -> Img:
    """A pet carrier: a grey tray base, a sky-blue domed top with vent slits and a carry handle,
    a wire door on the front with two eyes glinting behind it. A cream box with bars read as a
    radiator — the dome and the two-tone plastic are what make it a carrier. 22 × 18."""
    w, h = 22, 18
    out = Img.new(w, h)
    top = ramp('#5a8ab0', 4, 0.45)
    base = P['concrete']
    out.rect_(7, 0, 8, 2, top[1]); out.rect_(7, 0, 1, 4, top[1]); out.rect_(14, 0, 1, 4, top[1])   # handle
    out.poly_([(0, 10), (2, 5), (6, 3), (16, 3), (20, 5), (22, 10)], top[2])                         # the dome
    out.poly_([(1, 9), (3, 5), (7, 4), (11, 4), (8, 9)], top[3])
    for x in (5, 8, 14, 17):
        out.rect_(x, 6, 1, 3, top[0])                                                              # vents
    out.rect_(0, 10, w, 8, base[2]); out.rect_(0, 10, w, 1, base[4]); out.rect_(0, 16, w, 2, base[1])
    out = ink(out)
    out.rect_(6, 9, 10, 7, '#1a1618')
    for x in range(7, 16, 2):
        out.rect_(x, 9, 1, 7, P['iron'][4])
    out.rect_(6, 12, 10, 1, P['iron'][3])
    out.px_(9, 11, '#e8d060'); out.px_(12, 11, '#e8d060')
    return out


def dog_bed() -> Img:
    """An oval dog bed with a raised navy rim and a crumpled cream plaid blanket in it; a chewed
    bone lies on the floor in front. A red striped blanket with the bone on it read as a fish
    on a plate. 28 × 18."""
    w, h = 28, 18
    out = Img.new(w, h)
    c = ramp('#3d5a7a', 4, 0.45)
    out.ellipse_(14, 8, 14, 7, c[1]); out.ellipse_(14, 7, 13, 6, c[2])
    out.ellipse_(14, 8, 10, 4, c[0])
    bl = ['#8f8266', '#c9bb98', '#e9dfc4']
    out.ellipse_(13, 8, 8.5, 3.6, bl[1])
    out.ellipse_(11, 7.5, 5, 2.2, bl[2])
    for x in range(6, 21, 4):
        out.line_(x, 5, x - 1, 11, '#b07a5a')
    out.rect_(5, 8, 16, 1, '#b07a5a')
    out.line_(16, 6, 19, 10, bl[0])                                                  # a fold
    out = outline(out, INK)
    bone = Img.new(9, 4)
    bone.rect_(2, 1, 5, 2, '#e8e0cc'); bone.rect_(0, 0, 2, 2, '#e8e0cc'); bone.rect_(0, 2, 2, 2, '#c8c0aa')
    bone.rect_(7, 0, 2, 2, '#e8e0cc'); bone.rect_(7, 2, 2, 2, '#c8c0aa')
    out.paste_(outline(bone, INK), 17, h - 6)
    return out


def vaccine_chart() -> Img:
    """A pinned sheet with a grid of ticks — the vaccination chart. 14 × 16."""
    out = Img.new(14, 16)
    out.rect_(0, 0, 14, 16, P['paper'][3]); out.rect_(0, 15, 14, 1, P['paper'][1])
    out.rect_(2, 2, 10, 1, P['red'][2])
    for y in range(5, 14, 3):
        out.rect_(2, y, 10, 1, P['paper'][1])
        for x in (4, 7, 10):
            out.px_(x, y - 1, '#3d6fb0' if (x + y) % 3 else P['green'][3])
    out = ink(out)
    out.px_(7, 0, P['red'][3])
    return out


def terrarium(frame: int) -> Img:
    """A glass terrarium on a small cabinet: moss, a stone, a water dish and NA's frog. 26 × 30."""
    w, h = 26, 30
    out = Img.new(w, h)
    wd = P['wood']
    out.rect_(1, 18, 24, 12, wd[2]); out.rect_(1, 18, 24, 2, wd[3]); out.rect_(3, 22, 9, 6, wd[1]); out.rect_(14, 22, 9, 6, wd[1])
    out.px_(10, 25, P['gold'][3]); out.px_(15, 25, P['gold'][3])
    out.rect_(0, 1, 26, 17, '#1e3230')
    out.rect_(1, 12, 24, 6, '#3e5234'); out.rect_(1, 12, 24, 1, '#566d44')
    out.ellipse_(18, 13, 4, 2, '#56505a'); out.ellipse_(17.5, 12.5, 3, 1.3, '#7a7278')
    out.ellipse_(7, 14, 4, 1.5, '#3f6a78')
    out = ink(out)
    fr = camp(na('Actor/Animals/Frog/SpriteSheet.png'), sat=0.8).crop((frame % 2) * 16, 0, 16, 16)
    fr, fx, fy = fr.trim()
    out.paste_(fr, 12 - fr.w // 2, 16 - fr.h)
    # glass: light frame, glare stripes
    out.rect_(1, 1, 24, 1, '#b9d0cc')
    out.line_(3, 3, 7, 9, '#9fc0bc', 0.6); out.line_(4, 3, 8, 9, '#cfe4e0', 0.5)
    out.rect_(0, 0, 26, 1, INK); out.rect_(0, 0, 1, 18, INK); out.rect_(25, 0, 1, 18, INK)
    return out


def leash_board() -> Img:
    """A peg rail with leashes and collars hanging: loops of red and blue, a collar with a tag,
    a muzzle. For the wall face. 36 × 20."""
    w, h = 36, 20
    out = Img.new(w, h)
    wd = P['wood']
    out.rect_(0, 0, w, 4, wd[3]); out.rect_(0, 0, w, 1, wd[4]); out.rect_(0, 3, w, 1, wd[1])
    out = ink(out)
    for x in (4, 13, 22, 31):
        out.rect_(x, 1, 2, 3, wd[1]); out.px_(x, 1, wd[4])
    # leash 1: red, long loop
    for i in range(20):
        t = i / 19
        out.px_(int(5 + 2 * math.sin(t * math.pi)), 4 + int(t * 14), P['red'][2])
    out.rect_(4, 17, 3, 2, P['iron'][3])
    # leash 2: blue coil
    for i in range(18):
        a = i * 2 * math.pi / 18
        out.px_(int(14 + 3 * math.cos(a)), int(10 + 5 * math.sin(a)), '#3d6fb0')
    out.line_(14, 4, 14, 5, '#3d6fb0')
    # collar with a gold tag
    for i in range(16):
        a = i * 2 * math.pi / 16
        out.px_(int(23 + 3 * math.cos(a)), int(8 + 3 * math.sin(a)), '#6b3a2c')
    out.px_(23, 12, P['gold'][3]); out.px_(23, 13, P['gold'][2])
    # muzzle: a little leather cage
    out.rect_(29, 5, 6, 6, '#5a3a2a'); out.rect_(30, 6, 4, 4, '#2a1a14'); out.rect_(31, 5, 1, 6, '#8a5a3a')
    return out


def paw_poster() -> Img:
    """A poster: a big paw print on green, the camp's pet-care notice. 20 × 20."""
    art = Img.new(14, 11)
    c = '#f2e6c8'
    art.ellipse_(7, 7.5, 4, 3.2, c)
    for x, y in ((2.2, 3.5), (5.2, 1.8), (8.8, 1.8), (11.8, 3.5)):
        art.ellipse_(x, y, 1.6, 1.9, c)
    return poster(20, 20, '#4e6b3c', art, 'ЛАПА', seed=3)


def dog_poster() -> Img:
    """A poster with a dog's head — floppy brown ears hanging at the sides, a black nose, the
    tongue out. Round ears on top made it a bear. 20 × 20."""
    g = ['...kkkkkkkk...', '..kwwwwwwwwk..', '.kbwwwwwwwwbk.', 'kbbwkwwwwkwbbk', 'kbbwwwwwwwwbbk',
         'kbbwwwkkwwwbbk', 'kbbkwwkkwwkbbk', '.kk.kwwwwk.kk.', '.....kwrk.....', '......kk......']
    art = grid(g, {'k': INK, 'b': '#6b4a36', 'w': '#e0d0b0', 'r': '#d0504f'})
    return poster(20, 20, '#3d5a7a', art, 'ПЁС', seed=4)


def sign_kennel() -> Img:
    t = text('ПИТОМНИК', '#f2e6c8')
    out = Img.new(t.w + 8, t.h + 6)
    out.rect_(0, 0, out.w, out.h, '#4e6b3c'); out.rect_(0, 0, out.w, 1, '#6e8a4e')
    out.paste_(t, 4, 3)
    return ink(out)


def paw_prints(n: int, seed: int = 1) -> Img:
    """Muddy paw prints walking in from the door and wandering up the room (a decal)."""
    r = rng('paws', seed)
    out = Img.new(4 * T, 6 * T)
    x, y = 2 * T, 6 * T - 4
    for i in range(n):
        side = -3 if i % 2 else 3
        px, py = int(x + side), int(y)
        out.rect_(px, py, 3, 2, '#3a2a1a', 0.7)
        for dx, dy in ((-1, -2), (1, -3), (3, -2)):
            out.px_(px + dx, py + dy, '#3a2a1a', 0.65)
        y -= 7
        x += r.choice([-2, -1, 0, 1, 2])
    return out


def playpen(frame: int) -> Img:
    """A low wooden playpen with straw inside and two young pets in it — NA's raccoon and white
    pup, both on the camp's roster — behind the front rails. Back and front fences are separate
    layers so the pets stand IN the pen; the rails are pale pine with posts every 9 px and ONE
    outer contour — inked per post, the fence turned into a dark lattice that read as a crate.
    40 × 24."""
    w, h = 40, 24
    out = Img.new(w, h)
    pine = ['#6e5236', '#9a7650', '#c49a68', '#e0bc88']
    out.poly_([(3, 7), (37, 7), (39, 22), (1, 22)], ST[2])
    for k in range(46):
        r = rng('pen', k)
        x, y = r.randrange(3, 37), r.randrange(8, 21)
        out.line_(x, y, x + r.choice([-2, 2]), y + 1, ST[r.choice([1, 3, 4])])
    back = Img.new(w, h)
    for x in (3, 12, 21, 30, 37):
        back.rect_(x, 2, 2, 6, pine[1])
    back.rect_(3, 3, 36, 2, pine[2]); back.rect_(3, 3, 36, 1, pine[3])
    out.paste_(outline(back, INK).crop(1, 1, w, h), 0, 0)
    rc = camp(na('Actor/Animals/Racoon/SpriteSheet.png'), sat=0.75).crop((frame % 2) * 16, 0, 16, 16)
    pup = camp(na('Actor/Animals/Dog2/SpriteSheet.png'), sat=0.75).crop(((frame + 1) % 2) * 16, 0, 16, 16)
    out.paste_(rc, 5, 5)
    out.paste_(pup.flip(), 20, 6)
    fr = Img.new(w, h)
    for x in (1, 10, 19, 28, 37):
        fr.rect_(x, 16, 2, 7, pine[1]); fr.px_(x, 16, pine[3])
    fr.rect_(1, 17, 38, 2, pine[2]); fr.rect_(1, 17, 38, 1, pine[3])
    fr.rect_(1, 20, 38, 2, pine[2]); fr.rect_(1, 20, 38, 1, pine[3])
    fr.line_(1, 17, 3, 3, pine[2]); fr.line_(38, 17, 37, 3, pine[1])
    out.paste_(outline(fr, INK).crop(1, 1, w, h), 0, 0)
    return out


def broom() -> Img:
    """A birch broom leaning on the wall. 10 × 30."""
    out = Img.new(10, 30)
    out.line_(6, 0, 4, 19, P['wood'][3]); out.line_(7, 0, 5, 19, P['wood'][1])
    out.poly_([(2, 18), (7, 18), (10, 30), (0, 30)], ST[1])
    for x in range(1, 10, 2):
        out.line_(4, 19, x, 29, ST[3])
    out.rect_(2, 18, 6, 2, '#6b3a2c')
    return ink(out)


def pet_bed(coat: str, frame: int) -> Img:
    return cat_asleep(frame, coat, cushion='#4e6b3c')


# ------------------------------------------------------------------------------------ map
def build() -> Map:
    m = Map('kennel', W, H, 'indoor', name='Питомник', ambient=0.62, music='yard')
    shell(m, 'plaster', 'planks', face=2, door=(5, 2), out_to='square', out_at='kennel', floor_seed=2)

    # --- the eggs the game places in the nests
    register('kennel.egg.moss', [egg_moss()])
    register('kennel.egg.stone', [egg_stone()])
    register('kennel.egg.crystal', [egg_crystal()])
    register('kennel.egg.dragon', [egg_dragon()])
    register('kennel.egg.glow', [egg_glow()])

    # --- ground: straw in drifts (under the hay, the cages, the bench, the cat), a few loose
    #     stalks elsewhere; muddy paw prints wander in from the door
    m.stamp(straw_decal(4 * T, 3 * T + 8, 1, 0.3), 1 * T, 8 * T + 8)
    m.stamp(straw_decal(3 * T + 12, 2 * T + 8, 2, 0.26), 7 * T + 4, 4 * T)
    m.stamp(straw_decal(4 * T, 2 * T, 3, 0.2), 1 * T, 4 * T)
    m.stamp(straw_decal(3 * T, 2 * T, 6, 0.16), 1 * T, 7 * T)
    m.stamp(straw_decal(3 * T, 2 * T, 7, 0.14), 8 * T, 8 * T)
    m.stamp(straw_decal(10 * T, 8 * T, 4, 0.008), 1 * T, 3 * T)
    m.stamp(paw_prints(9, 2), 4 * T, 6 * T - 4)
    m.stamp(dust_decal(4 * T, 2 * T, 5, '#2a1a10', 0.14, 30), 7 * T, 10 * T)
    bone = Img.new(8, 4)
    bone.rect_(1, 1, 6, 2, '#e8e0cc'); bone.rect_(0, 0, 2, 2, '#e8e0cc'); bone.rect_(0, 2, 2, 2, '#c8c0aa')
    bone.rect_(6, 0, 2, 2, '#e8e0cc'); bone.rect_(6, 2, 2, 2, '#c8c0aa')
    m.stamp(outline(bone, INK), 4 * T + 6, 8 * T + 10)
    ball = Img.new(5, 5); ball.ellipse_(2.5, 2.5, 2.5, 2.5, P['red'][3]); ball.px_(1, 1, '#ffffff')
    m.stamp(outline(ball, INK), 7 * T + 2, 7 * T + 2)

    # --- north wall face: window, the sign over the keeper and two posters under it, the leash
    #     rail over the cages, the vaccination chart
    m.stamp(window(18, 16, bars=0), 1 * T + 4, T + 4)
    m.light(1 * T + 13, 2 * T + 8, 34, '#9fc4d0', 'window')
    m.stamp(sign_kennel(), 6 * T - 20, T + 1)
    m.stamp(paw_poster(), 5 * T + 6, T + 12)
    m.stamp(dog_poster(), 6 * T + 6, T + 12)
    m.stamp(thermometer(), 4 * T + 6, T + 8)
    m.stamp(leash_board(), 7 * T + 12, T + 3)
    m.stamp(vaccine_chart(), 10 * T - 2, T + 5)

    # --- the incubation bench with the two nests under the heat lamp (behind the keeper, west)
    bx, top = 1 * T + 12, 4 * T + 4                     # bench left, y of its top face's middle
    bench = incubator_bench()
    by = top - 8                                         # bench sprite top
    m.put('kennel.bench', bench, bx, by, base=by, solid=(1.7, 3, 5.3, 4.6))
    nb, nr = nest_back(), nest_rim()
    for i, nx in enumerate((bx + 4, bx + 30)):
        ny = top - 9                                     # nest sprite top
        feet_y = ny + 9                                  # the egg sits 3 px into the hollow
        m.put('kennel.nest', nb, nx, ny, base=by + 1)
        m.put('kennel.nestrim', nr, nx - 1, ny + 6, base=feet_y + 2)
        m.marks[f'nest{i}'] = (round((nx + 12) / T, 3), round(feet_y / T, 3))
    lamp = [hang_lamp(k, 30, '#8f2a14', '#ffb07a', '#ff5a2a') for k in range(2)]
    m.put('kennel.heatlamp', lamp, bx + 22, T - 2, fps=1, layer='top')
    m.light(bx + 28, top - 4, 48, '#ff6a3a', 'lamp')
    m.emit('dust', bx + 28, top - 14, 0.35)                       # motes turning in the heat lamp's light

    # --- the keeper behind her vet table
    vt = vet_table()
    m.put('kennel.vettable', vt, 6 * T - 20, 5 * T + 1, solid=(4.9, 5.0, 7.4, 6.4))   # to y 5: nobody slips behind
    m.npc('keeper', 'keeper', 6.0, 4.9, face=0, anim='idle', name='Смотрительница')
    m.marks['keeper'] = (6.0, 4.9)
    import kit
    m.put('kit.lamp', kit.lamp_hanging(), 7 * T + 1, 3 * T - 2, layer='top')
    m.light(7 * T + 6, 5 * T + 6, 50, '#ffd98a', 'lamp')

    # --- east: the cage stack, the doghouse with its dog and bowls, a dog bed, the terrarium
    cs = [cage_stack(k) for k in range(2)]
    m.put('kennel.cages', cs, 8 * T - 2, 5 * T - cs[0].h, fps=1.5, solid=(7.9, 3, 10.8, 5))
    dh = doghouse()
    m.put('kennel.doghouse', dh, 8 * T + 14, 8 * T + 2 - dh.h, solid=(8.9, 6.9, 10.8, 8))
    dg = [dog_sitting(k) for k in range(2)]
    m.put('kennel.dog', dg, 8 * T - 2, 8 * T + 4 - 16, fps=2, solid=(7.9, 7.5, 8.8, 8.2))
    m.put('kennel.bowl.food', bowl('food'), 7 * T + 4, 9 * T - 4)
    m.put('kennel.bowl.water', bowl('water'), 8 * T + 10, 9 * T - 2)
    db = dog_bed()
    m.put('kennel.dogbed', db, 9 * T + 2, 10 * T - db.h + 2, solid=(9.1, 9.3, 10.8, 10.1))
    te = [terrarium(k) for k in range(2)]
    m.put('kennel.terrarium', te, 9 * T + 6, 12 * T + 2 - te[0].h, fps=1, solid=(9.4, 11.3, 11, 12))
    pc = pet_carrier()
    m.put('kennel.carrier', pc, 7 * T + 8, 11 * T + 2 - pc.h, solid=(7.5, 10.4, 8.9, 11.1))
    m.put('kennel.broom', broom(), 8 * T + 4, 12 * T - 30 + 2, solid=(8.3, 11.4, 8.9, 12))
    m.put('kit.bucket', bucket(True), 7 * T + 4, 12 * T - 10, solid=(7.3, 11.4, 7.9, 12))

    # --- west: an egg basket, the trough, the cat on its bed, the hay with its hens, feed sacks
    eb = egg_basket()
    m.put('kennel.eggbasket', eb, 1 * T - 1, 6 * T - 2 - eb.h, solid=(1, 5, 2, 5.6))
    tr = trough()
    m.put('kennel.trough', tr, 2 * T + 4, 7 * T - tr.h + 1, solid=(2.2, 6.2, 4.5, 7))
    pb = [pet_bed('ginger', k) for k in range(2)]
    m.put('kennel.catbed', pb, 1 * T + 2, 8 * T + 10 - pb[0].h, fps=1, solid=(1.1, 7.9, 2.4, 8.6))
    hp = hay_pile()
    m.put('kennel.hay', hp, 1 * T - 2, 11 * T + 2 - hp.h, solid=(1, 9.8, 3.3, 11))
    m.emit('dust', 2 * T + 4, 10 * T - 2, 0.5)                     # hay dust
    pp = [playpen(k) for k in range(2)]
    m.put('kennel.playpen', pp, 2 * T + 9, 9 * T - pp[0].h, fps=2, solid=(2.6, 7.9, 5, 9))
    for i, (x, y, kind) in enumerate(((4.2, 10.4, 'White'), (1.8, 11.9, 'Brown'))):
        hn = [hen(k, kind) for k in range(2)]
        m.put(f'kennel.hen.{kind.lower()}', hn, int(x * T) - 8, int(y * T) - 14, fps=2, phase=0.5 * i,
              solid=(x - 0.3, y - 0.3, x + 0.3, y + 0.1))
    fs = feed_sacks()
    m.put('kennel.sacks', fs, 3 * T, 12 * T + 2 - fs.h, solid=(3, 11.3, 4.6, 12))
    return m
