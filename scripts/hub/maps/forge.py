"""Кузница изнутри (v2.80) — the reference interior every other room is held to.

12 × 15 tiles, portrait like every interior (a phone shows ~12 tiles across): stone walls, dark
flagstone floor, the brick hearth with its iron hood in the north-west corner, bellows beside it,
the anvil on a stump in the middle with the smith behind it, a quench trough, a grindstone, a rack
of picks by the east wall, a coal heap, a workbench with a vise, crates of ingots. Everything that
glows (hearth, embers, the anvil sparks) is an animation or an effect, not paint.
"""
from __future__ import annotations

from kit import (INK, P, barrel, bucket, chain_hanging, crate, ink, lamp_hanging, ore_pile, paper, sack, scraps,
                 shelf_wall, shell, stool, text, texture, wheelbarrow, window)
from lib import T, Img, Map, camp, na, outline, ramp, rng

W, H = 11, 13


# ------------------------------------------------------------------------------------ art
def hearth(frame: int) -> Img:
    """The forge: brick base with an ash arch, glowing coal bed, flames (frame 0–3), iron hood
    rising into the wall. 48 × 72; its feet are the bottom row."""
    w, h = 48, 72
    out = Img.new(w, h)
    b = P['brick']
    ir = P['iron']
    # the hood: a riveted iron cone from the ceiling down over the coal bed
    top, bot = 0, 34
    out.poly_([(15, top), (33, top), (46, bot), (2, bot)], ir[1])
    out.poly_([(15, top), (21, top), (10, bot), (2, bot)], ir[2])        # lit left slope
    out.poly_([(29, top), (33, top), (46, bot), (40, bot)], ir[0])       # shaded right slope
    for y in range(4, bot, 6):
        for x in range(10, 40, 6):
            if abs(x - 24) < (y + 18) * 0.62:
                out.px_(x + (y // 6) % 2 * 3, y, ir[3])                   # rivets
    out.rect_(2, bot - 3, 44, 3, ir[0])                                  # the hood's rim
    out.rect_(2, bot - 3, 44, 1, ir[3])
    out.poly_([(18, 2), (30, 2), (27, 12), (21, 12)], '#1a1416', 0.55)    # soot down the middle
    # brick base: top rim (seen from above) and the front face
    out.rect_(0, 38, w, 8, b[3])
    out.rect_(0, 38, w, 1, b[4])
    out.rect_(3, 39, 42, 6, '#2a1a16')                                   # the coal bed's pit
    bricks = texture('brick', w, h - 46, 5)
    out.paste_(bricks, 0, 46)
    out.rect_(0, 46, w, 1, b[0])
    # the ash arch at the bottom of the front, dark with a few embers
    out.poly_([(15, h), (15, 60), (18, 56), (24, 54), (30, 56), (33, 60), (33, h)], '#140c0c')
    for x, y in ((19, 67), (24, 69), (28, 66)):
        out.px_(x, y, P['fire'][2])
    # coal bed: lumps, and their glow pulsing by frame
    r = rng('coals')
    glow = [P['fire'][2], P['fire'][3], P['fire'][4], P['fire'][3]][frame % 4]
    for i in range(26):
        x, y = 4 + r.randrange(0, 39), 39 + r.randrange(0, 5)
        c = r.choice([P['coal'][2], P['coal'][3], glow, P['fire'][1], glow])
        out.rect_(x, y, 2, 1, c)
    # flames: three tongues whose heights cycle, each 2–3 px wide, hot core
    tongues = [(12, [9, 12, 8, 11]), (22, [14, 10, 15, 12]), (31, [10, 13, 9, 12]), (38, [6, 8, 5, 7])]
    for i, (x, hs) in enumerate(tongues):
        th = hs[(frame + i) % 4]
        sway = [0, 1, 0, -1][(frame + i) % 4]
        for k in range(th):
            y = 40 - k
            wdt = max(1, 3 - k * 3 // max(1, th))
            xx = x + (sway if k > th // 2 else 0)
            col = P['fire'][2] if k < th * 0.5 else P['fire'][1]
            out.rect_(xx - wdt // 2, y, wdt + 1, 1, col)
            if k < th * 0.45:
                out.px_(xx, y, P['fire'][4])
    out = ink(out)
    return out


def bellows() -> Img:
    """Leather bellows on a wooden cradle, nozzle toward the hearth (left). 20 × 16."""
    g = [
        '....kkkkkkkkkkkk....',
        '...k555555555554k...',
        '..k4444444444443k...',
        'kkk3aaaaaaaaaa3k....',
        'k2kkbbbbbbbbbbbk....',
        'kk.k3aaaaaaaaaa3k...',
        '...kbbbbbbbbbbbbk...',
        '...k444444444443kk..',
        '....k3333333333k.k..',
        '....kk2222222kk..k..',
        '.....k1111111k...k..',
        '....k22kkkkk22k.kk..',
        '....k2k.....k2k.....',
        '....k1k.....k1k.....',
        '....kkk.....kkk.....',
    ]
    w = P['wood']
    pal = {'k': INK, '1': w[0], '2': w[1], '3': w[2], '4': w[3], '5': w[4],
           'a': '#6b4a36', 'b': '#8a6446'}
    from lib import grid
    return grid(g, pal)


def anvil() -> Img:
    """Anvil on an oak stump, horn pointing left, the face polished bright. 24 × 22."""
    from lib import grid
    g = [
        '....kkkkkkkkkkkkkkkkk...',
        '..kk6666666666666666k...',
        '.k66677777777777777766k.',
        'k555566666666666666665k.',
        'kkkk44444444444444444kk.',
        '....kk3333333333333kk...',
        '......kk333333333kk.....',
        '........k2222222k.......',
        '........k2222222k.......',
        '.......k333333333k......',
        '.....kk44444444444kk....',
        '....k222222222222222k...',
        '....kkkkkkkkkkkkkkkkk...',
        '....kwwwwwwwwwwwwwwwk...',
        '...kvvvvvvvvvvvvvvvvvk..',
        '...kuuuuuuuuuuuuuuuuuk..',
        '...kuuutuuuuuuutuuuuuk..',
        '...ktuuuuuuuuuuuuuutuk..',
        '...kuuuuuutuuuuuuuuuuk..',
        '...kuuuuuuuuuuuuutuuuk..',
        '....kttuuuuuuuuuuuttk...',
        '.....kkkkkkkkkkkkkkk....',
    ]
    ir, wd = P['iron'], P['wood']
    pal = {'k': INK, '2': ir[1], '3': ir[2], '4': ir[2], '5': ir[3], '6': ir[4], '7': '#c9d0d6',
           'w': wd[4], 'v': wd[3], 'u': wd[2], 't': wd[1]}
    return grid(g, pal)


def grindstone(frame: int = 0) -> Img:
    """A grinding wheel on an A-frame over a water trough, crank on the right. 22 × 24.
    The wheel is seen nearly edge-on (its axle runs east–west), so it reads as a thick stone disc,
    not a clock face; a light notch on the rim steps round with the frame."""
    out = Img.new(22, 24)
    wd, st = P['wood'], P['stone']
    out.rect_(2, 16, 18, 7, wd[2]); out.rect_(2, 16, 18, 1, wd[3])          # trough
    out.rect_(4, 17, 14, 3, '#34494f'); out.rect_(4, 17, 14, 1, '#5d7f88')
    out.line_(3, 4, 1, 22, wd[1]); out.line_(4, 4, 2, 22, wd[2])             # A-frame legs
    out.line_(18, 4, 20, 22, wd[1]); out.line_(17, 4, 19, 22, wd[0])
    out.ellipse_(11, 10, 5, 8, st[1])                                         # the wheel
    out.ellipse_(10.3, 9.5, 4, 7, st[2])
    out.rect_(9, 3, 2, 14, st[3])
    notch = [3, 6, 10, 14][frame % 4]
    out.rect_(9, notch, 3, 1, st[4])
    out.rect_(4, 9, 14, 2, wd[3])                                             # axle through the frame
    out.rect_(18, 7, 2, 4, wd[1]); out.rect_(19, 6 + frame % 2 * 3, 3, 2, wd[3])   # crank
    return ink(out)


def coal_heap() -> Img:
    """A heap of coal against the wall: lumps with lit tops and blue glints, a shovel in it. 34 × 22."""
    out = Img.new(34, 22)
    r = rng('coalheap')
    c = P['coal']
    lumps = []
    for _ in range(40):
        x = r.gauss(16, 7); y = r.uniform(5, 19)
        if ((x - 16) / 15) ** 2 + ((y - 16) / 11) ** 2 < 1:
            lumps.append((x, y, r.uniform(1.5, 3.2)))
    lumps.sort(key=lambda l: l[1])
    for x, y, rr in lumps:
        out.ellipse_(x, y, rr, rr * 0.8, c[1])
        out.ellipse_(x - 0.5, y - 0.6, rr - 0.8, rr * 0.8 - 0.8, c[2])
        if r.random() < 0.5:
            out.px_(int(x - rr * 0.4), int(y - rr * 0.5), c[3])
        if r.random() < 0.12:
            out.px_(int(x), int(y - 1), '#7a8aa6')
    out = outline(out, INK)
    out.rect_(25, 0, 2, 13, P['wood'][3]); out.rect_(25, 0, 1, 13, P['wood'][4])
    out.rect_(23, 12, 6, 5, P['iron'][3]); out.rect_(23, 12, 6, 1, P['iron'][4])
    return ink(out)


def pick_rack() -> Img:
    """A standing rack against the wall: three picks and a sledge, heads up, in a slotted frame.
    The heads are wide T-shapes in different metals — thin hafts alone read as prison bars. 22 × 34."""
    out = Img.new(22, 34)
    wd, ir = P['wood'], P['iron']
    out.rect_(0, 30, 22, 4, wd[1]); out.rect_(0, 30, 22, 1, wd[3])          # base
    out.rect_(0, 17, 22, 3, wd[2]); out.rect_(0, 17, 22, 1, wd[4])          # slotted rail
    tools = [(3, 'pick', ir[3]), (8, 'pick', P['rust'][3]), (13, 'sledge', ir[2]), (18, 'pick', '#9cc7d4')]
    for x, kind, c in tools:
        out.rect_(x, 6, 2, 25, wd[3]); out.rect_(x, 6, 1, 25, wd[4])
        if kind == 'pick':
            out.poly_([(x - 4, 7), (x - 1, 3), (x + 3, 3), (x + 6, 7), (x + 3, 5), (x - 1, 5)], c)
            out.rect_(x - 1, 3, 4, 1, '#e3e8ea')
        else:
            out.rect_(x - 2, 1, 6, 6, c); out.rect_(x - 2, 1, 6, 1, ir[4])
    return ink(out)


def workbench() -> Img:
    """A heavy bench with a vise, tongs, a file and a pick head on it. 44 × 26."""
    w, h = 44, 26
    out = Img.new(w, h)
    wd, ir = P['wood'], P['iron']
    out.rect_(0, 8, w, 7, wd[3])                   # top
    out.rect_(0, 8, w, 1, wd[4])
    out.rect_(0, 15, w, 3, wd[1])                  # apron
    out.rect_(2, 18, 3, 8, wd[1]); out.rect_(w - 5, 18, 3, 8, wd[0])
    out.rect_(5, 22, w - 10, 2, wd[1])             # stretcher
    for x in range(4, w - 4, 6):
        out.px_(x, 11, wd[2])
    # vise on the right end
    out.rect_(33, 2, 9, 7, ir[2]); out.rect_(33, 2, 9, 1, ir[4]); out.rect_(35, 0, 1, 4, ir[3]); out.rect_(34, 0, 3, 1, ir[3])
    # tongs, file, a pick head
    out.line_(4, 12, 14, 9, ir[1]); out.line_(4, 13, 14, 11, ir[2])
    out.rect_(17, 11, 7, 1, ir[3])
    out.rect_(26, 9, 5, 2, P['rust'][3]); out.px_(25, 10, P['rust'][3]); out.px_(31, 10, P['rust'][3])
    out = ink(out)
    return out


def quench() -> Img:
    """A quench trough of planks full of dark water, a rim of rust where hot iron went in. 26 × 16."""
    out = Img.new(26, 16)
    wd = P['wood']
    out.rect_(0, 0, 26, 16, wd[2])
    out.rect_(0, 0, 26, 2, wd[4])
    out.rect_(2, 2, 22, 7, '#2c4a54')
    out.rect_(2, 2, 22, 1, '#1b2d33')
    out.rect_(5, 4, 7, 1, '#6f9aa6'); out.rect_(15, 6, 5, 1, '#5b8591')
    out.rect_(2, 8, 22, 1, P['rust'][2])
    for x in range(0, 26, 6):
        out.rect_(x, 10, 1, 6, wd[1])
    out.rect_(0, 11, 26, 1, P['iron'][2])
    return ink(out)


def ingots(n: int = 5) -> Img:
    bar = camp(na('Items/Resource/BarIron.png'), sat=0.8)
    out = Img.new(28, 18)
    for i in range(n):
        out.paste_(bar, (i % 3) * 6 + (i // 3) * 3, 6 - (i // 3) * 5)
    return out


def tool_board() -> Img:
    """A plank board with pegs and hanging tools: hammers, tongs, a horseshoe, a file. 58 × 22."""
    w, h = 58, 22
    out = Img.new(w, h)
    wd, ir = P['wood'], P['iron']
    out.rect_(0, 3, w, 16, wd[2])
    for y in (3, 8, 13):
        out.rect_(0, y, w, 1, wd[1])
    out.rect_(0, 3, w, 1, wd[3])
    out = ink(out)
    hammer = camp(na('Items/Tool/Hammer.png'), sat=0.7)
    pick = camp(na('Items/Tool/Pickaxe.png'), sat=0.7)
    shovel = camp(na('Items/Tool/Shovel.png'), sat=0.7)
    out.paste_(hammer, 2, 3)
    out.paste_(pick, 16, 2)
    # tongs (two long jaws)
    out.line_(33, 2, 36, 19, ir[1]); out.line_(35, 2, 36, 19, ir[3])
    # horseshoe
    out.ellipse_(44, 9, 4, 4, ir[3])
    out.ellipse_(44, 10, 2, 3, wd[2])
    out.rect_(42, 12, 5, 3, wd[2])
    out.paste_(shovel.flip(), 44, 3)
    for x in (10, 24, 36, 44, 52):
        out.px_(x, 4, INK)
    return out


def banner_sign() -> Img:
    t = text('КУЗНИЦА', '#f2c46a')
    out = Img.new(t.w + 8, t.h + 6)
    out.rect_(0, 0, out.w, out.h, '#3f2e24')
    out.rect_(0, 0, out.w, 1, '#6a4a36')
    out.paste_(t, 4, 3)
    return ink(out)


# ------------------------------------------------------------------------------------ map
def build() -> Map:
    m = Map('forge', W, H, 'indoor', name='Кузница', ambient=0.6, music='yard')
    shell(m, 'stone', 'na-dark', face=2, door=(4, 2), out_to='square', out_at='forge', floor_seed=3)
    g = m.ground
    r = rng('forge-floor')
    # soot and coal grit around the hearth, fading out; a scorch ring where the sparks land
    for _ in range(220):
        x = int(r.gauss(2.6 * T, 1.8 * T)); y = int(r.gauss(4.8 * T, 1.5 * T))
        if T <= x < (W - 1) * T and 3 * T <= y < (H - 1) * T:
            g.px_(x, y, '#141012', 0.5)
    for _ in range(30):
        g.px_(r.randrange(T, (W - 1) * T), r.randrange(3 * T, (H - 1) * T), P['coal'][2])
    g.ellipse_(6 * T, 7 * T + 6, 20, 8, '#1a1416', 0.35)
    for i, (x, y) in enumerate(((3 * T + 4, 9 * T + 4), (7 * T + 2, 6 * T + 10), (5 * T, 11 * T + 3))):
        m.stamp(scraps(i), x, y)

    # --- north wall face: tool board, a barred window, a shelf of ingots and jars, a chain, orders
    m.stamp(window(20, 18, bars=3), 5 * T - 2, T + 6)
    m.stamp(tool_board(), 6 * T + 6, T + 7)
    m.stamp(chain_hanging(5), 4 * T + 6, T + 2)
    m.stamp(paper(8, 10, 2), 10 * T - 3, T + 6)

    # --- hearth (animated) in the north-west corner, its hood up the wall; bellows beside it
    frames = [hearth(i) for i in range(4)]
    m.put('forge.hearth', frames, 1 * T, 5 * T - frames[0].h, fps=7, solid=(1, 3, 4, 5))
    m.put('forge.bellows', bellows(), 4 * T, 5 * T - 15, solid=(4, 4, 5.2, 5))
    m.light(1 * T + 24, 4 * T + 6, 96, '#ff8a3a', 'forge')
    m.emit('embers', 1 * T + 24, 4 * T - 2, 1.4)
    m.emit('smoke', 1 * T + 24, 2 * T - 4, 0.5)

    # --- the anvil in the middle; the smith stands north of it facing the door and hammers
    m.put('forge.anvil', anvil(), 5 * T - 4, 8 * T - 16, solid=(4.5, 7, 6.5, 8))
    m.npc('smith', 'smith', 5.5, 6.85, face=0, anim='work', name='Кузнец')
    m.emit('sparks', 5 * T + 6, 7 * T - 2, 1.0)
    m.light(5 * T + 6, 7 * T, 34, '#ffb347', 'glow')

    # --- west side: quench trough and a water bucket; coal heap with its shovel; a barrow of ore
    m.put('forge.quench', quench(), 1 * T + 4, 7 * T - 6, solid=(1, 6.5, 3, 7.5))
    m.put('kit.bucket', bucket(True), 3 * T + 3, 7 * T - 2, solid=(3, 6.5, 4, 7.2))
    m.emit('steam', 2 * T + 6, 7 * T - 4, 0.3)
    m.put('forge.coal', coal_heap(), 1 * T - 1, 10 * T - 20, solid=(1, 8.8, 3, 10))
    m.put('kit.barrow', wheelbarrow(ore_pile('rust', None, 3)), 3 * T + 4, 10 * T - 14, solid=(3.2, 9.2, 4.8, 10))

    # --- east side: grindstone, the pick rack against the wall, the workbench with its vise
    gs = [grindstone(i) for i in range(4)]
    m.put('forge.grindstone', gs, 7 * T - 2, 5 * T - 10, fps=4, solid=(6.8, 4.4, 8, 5))
    m.put('forge.rack', pick_rack(), 8 * T + 10, 5 * T - 2, solid=(8.6, 4.6, 10, 6))
    m.put('forge.bench', workbench(), 6 * T + 2, 10 * T - 16, solid=(6, 9, 9, 10))
    m.put('kit.stool', stool(), 7 * T + 3, 10 * T + 3, solid=(7.2, 10.2, 7.9, 10.8))

    # --- south corners: crates of ingots (east), barrels (west)
    m.put('kit.crate', crate(), 9 * T - 1, 11 * T + 1, solid=(8.9, 11.2, 10, 12))
    m.put('forge.ingots', ingots(), 8 * T + 4, 11 * T - 6)
    m.put('kit.crate.dark', crate(dark=True), 9 * T - 1, 10 * T + 3, solid=(8.9, 10.2, 10, 11))
    m.put('kit.barrel', barrel(), 1 * T + 1, 11 * T - 8, solid=(1, 10.5, 1.9, 11.3))
    m.put('kit.barrel.water', barrel(water=True), 2 * T + 1, 11 * T - 1, solid=(2, 11, 2.9, 12))
    m.put('kit.sack', sack('#6f6352'), 1 * T + 1, 11 * T + 4, solid=(1, 11.4, 1.8, 12))

    # --- light: the hanging lamp over the bench (top layer, it hangs over heads), the window
    m.put('kit.lamp', lamp_hanging(), 7 * T + 3, 6 * T - 6, layer='top')
    m.light(7 * T + 8, 8 * T + 2, 58, '#ffd98a', 'lamp')
    m.light(5 * T + 8, 3 * T + 6, 40, '#9fc4d0', 'window')
    m.marks['smith'] = (5.5, 6.85)
    return m
