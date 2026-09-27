"""Ларёк (v2.80) — the camp kiosk: consumables over a glass counter.

10 × 11 tiles, the smallest room. Grey board walls, a worn linoleum checker floor. The seller
stands behind a glass-fronted counter (lenses and sweets under the glass) with an old cash
register on it; behind her a neon «ОТКРЫТО» that flickers, shelves of jars and cans to one side
and a drinks fridge full of energy drinks («энергетик») glowing on the other, price posters in
between. On the customers' side: a crate of dynamite with a basket of bombs, a stand of
magnifying lenses, a stack of energy drinks, a crate of bread, and a queue rope on brass posts
that leads you to the counter.

Lessons from the review rounds:
  1. Three 22 px posters and the neon do not fit the four tiles between the shelves and the
     fridge, and a poster hung low spilled off the wall onto the floor behind the seller. Now:
     the neon over her head, the price board (прейскурант) under it with tiny icons and
     prices, and one narrow poster on each side.
  2. In the 3 × 5 font Ч is the glyph of 4 («24 ЧАСА» read «24 4АСА»): the neon says ОТКРЫТО.
     Words on price cards are illegible at 1×; digits are not — tags carry prices only.
  3. A flicker must cut out whole letters: measure glyph columns (3 px + 1 gap) from the text.
  4. The fridge, the neon and the drink stack are the only neon-bright things in the camp —
     the kiosk's identity at night — so each carries its own 'neon'/'glow' light.
  5. Variants of kit furniture get their own names ('kiosk.lamp' for a 20 px cord): the
     registry refuses one name with two pictures when all maps build in one run.
"""
from __future__ import annotations

import math

from art_shops import bottle, dust_decal, poster, shelf_unit
from kit import INK, P, ink, lamp_hanging, paper, shell, text
from lib import T, Img, Map, camp, grid, na, outline, ramp, rng

W, H = 10, 11
NEON = ['#ff5ab4', '#ff9ad2', '#ffe0f0']        # pink neon, dark → hot
LIME = ['#2e5a10', '#5aa018', '#9be030', '#d8ff70']


# ------------------------------------------------------------------------------------ goods
def can(label: str, h: int = 6) -> Img:
    """A tin can, 5 × h: silver rims, a coloured paper label with a band. 'milk' (сгущёнка: blue
    and white), 'meat' (тушёнка: red-brown), 'fish' (sprats: gold), 'peas' (green)."""
    lab = {'milk': ('#e8e8f0', '#3d6fb0'), 'meat': ('#a8323b', '#e8c870'), 'fish': ('#d8a82a', '#3a4356'),
           'peas': ('#4e9a3a', '#e8e0c0')}[label]
    out = Img.new(5, h)
    out.rect_(0, 0, 5, h, '#9aa2a8'); out.rect_(0, 0, 5, 1, '#d0d8dc')
    out.rect_(0, 1, 5, h - 2, lab[0]); out.rect_(0, h // 2, 5, 1, lab[1])
    out.rect_(0, 1, 1, h - 2, ramp(lab[0], 3, 0.4)[2])
    return ink(out)


def energy_can(k: int = 0) -> Img:
    """An energy drink: a slim tall can in loud lime or cyan with a lightning bolt, a silver top.
    4 × 8 — the only neon-bright goods in the camp."""
    body = [LIME, ['#104a5a', '#1890a8', '#40d8f0', '#b8f8ff']][k % 2]
    out = Img.new(4, 8)
    out.rect_(0, 0, 4, 8, body[1]); out.rect_(0, 1, 4, 6, body[2]); out.rect_(0, 1, 1, 6, body[3])
    out.rect_(0, 0, 4, 1, '#c8d0d4')
    out = ink(out)
    out.px_(2, 2, '#ffffff'); out.px_(1, 4, '#ffffff'); out.px_(2, 3, '#fff8a0')
    return out


def jar_goods(kind: str) -> Img:
    """A preserve jar: 'pickles' (green with cucumbers), 'jam' (red), 'honey' (amber),
    'mushrooms' (brown caps in brine). 6 × 7, a lid on top."""
    col = {'pickles': '#6b9a3a', 'jam': '#a8323b', 'honey': '#d8a02a', 'mushrooms': '#8a6a4a'}[kind]
    j = bottle('jar', col, 0.9, cork='#c8c0a8' if kind != 'jam' else '#d0504f')
    if kind == 'pickles':
        j.px_(2, 3, '#a8d060'); j.px_(3, 5, '#a8d060')
    if kind == 'mushrooms':
        j.px_(2, 4, '#e8d8b0'); j.px_(3, 3, '#e8d8b0')
    return j


def grocery_shelves() -> Img:
    """The kiosk's wall shelves: preserves, cans of condensed milk, stew and sprats, a row of
    lemonade bottles, bread rolls in a paper bag on top. 36 × 48."""
    rows = [
        [jar_goods('pickles'), jar_goods('jam'), jar_goods('honey'), jar_goods('pickles'), jar_goods('mushrooms')],
        [can('milk'), can('milk'), can('meat'), can('meat'), can('fish'), can('peas')],
        [bottle('tall', '#6ab050', 0.85, cork='#c8d0d4'), bottle('tall', '#6ab050', 0.85, cork='#c8d0d4'),
         bottle('tall', '#e8e8e0', 0.9, cork='#3d6fb0'), bottle('tall', '#e8e8e0', 0.9, cork='#3d6fb0'),
         bottle('tall', '#c8702a', 0.8, cork='#c8d0d4'), bottle('tall', '#c8702a', 0.8, cork='#c8d0d4')],
        [can('fish', 4), can('fish', 4), can('meat', 4), can('milk', 4), can('milk', 4), can('peas', 4)],
    ]
    bag = Img.new(10, 8)
    bag.rect_(1, 2, 8, 6, '#c8b088'); bag.rect_(1, 2, 8, 1, '#e0c8a0')
    bag.ellipse_(3, 2, 2, 1.5, '#b07a3a'); bag.ellipse_(6.5, 1.5, 2, 1.5, '#c8904a')
    return shelf_unit(36, 48, rows, mat='woodgrey', back='#20242a', top_row=[ink(bag), can('milk'), can('milk')],
                      legs=2)


def fridge(frame: int) -> Img:
    """A drinks fridge: a cream cabinet with a lit glass door, three shelves of energy drinks in
    lime and cyan, a lightning logo panel on top; frame 0–2 flickers the tube inside. 30 × 46."""
    w, h = 30, 46
    out = Img.new(w, h)
    c = ['#6b6660', '#9d978c', '#c9c3b6', '#e6e0d2']
    out.rect_(0, 0, w, h, c[2]); out.rect_(0, 0, w, 1, c[3]); out.rect_(0, 0, 2, h, c[3]); out.rect_(w - 2, 0, 2, h, c[1])
    out.rect_(0, 0, w, 9, '#2a2e3a')                                                   # the logo panel
    out.rect_(0, h - 4, w, 4, c[1]); out.rect_(3, h - 3, w - 6, 1, '#20242a')           # grille
    lit = [1.0, 0.8, 1.0][frame % 3]
    glass = '#a8e8d8' if lit > 0.9 else '#88c8b8'
    out.rect_(3, 11, w - 6, h - 17, glass)
    out = ink(out)
    for x, y in ((6, 2), (7, 3), (8, 4), (7, 5), (8, 6)):
        out.px_(x, y, LIME[3]); out.px_(x + 1, y, LIME[2])
    out.paste_(text('ЭНЕРГ', '#d8ff70', None), 11, 2)
    # shelves of cans behind the glass
    for s in range(3):
        y = 13 + s * 9
        for i in range(5):
            out.paste_(energy_can((i + s) % 2), 4 + i * 4 + (s % 2), y)
        out.rect_(3, y + 8, w - 6, 1, '#6a8a88')
    # glare and the handle
    out.line_(5, 13, 9, 37, '#e8fff8'); out.line_(6, 13, 10, 37, '#d0f4ec')
    out.rect_(w - 5, 20, 1, 8, c[3]); out.rect_(w - 4, 20, 1, 8, INK)
    return out


def cash_register() -> Img:
    """An old mechanical cash register: a brass-trimmed box, a little display showing a price,
    rows of round keys, the till drawer and a crank on its side. 20 × 17."""
    w, h = 20, 17
    out = Img.new(w, h)
    g, ir = P['gold'], P['iron']
    out.rect_(2, 0, 14, 5, '#3a3f46'); out.rect_(4, 1, 10, 3, '#9ad08a')             # the display
    out.rect_(0, 5, 18, 8, ir[2]); out.rect_(0, 5, 18, 1, ir[4]); out.rect_(0, 5, 2, 8, ir[3])
    out.rect_(0, 13, 18, 4, ir[1]); out.rect_(6, 14, 6, 1, g[3])                      # the drawer
    out.rect_(18, 7, 2, 5, g[2])
    out = ink(out)
    out.paste_(text('40', '#1a3a1a', None), 6, 0)
    for row in range(2):
        for i in range(6):
            x, y = 3 + i * 2 + (row % 2), 7 + row * 3
            out.px_(x, y, ['#e8e0cc', '#d0504f', '#e8e0cc', '#3d6fb0'][(i + row) % 4])
    out.px_(19, 6, g[4])
    return out


def glass_counter() -> Img:
    """The counter: a wooden top, a glass front with two shelves of goods on show — three
    magnifying lenses, sweets in wrappers, matches, a lighter — a price tag on each. 64 × 26."""
    w, h = 64, 26
    out = Img.new(w, h)
    wd = P['woodgrey']
    out.rect_(0, 0, w, 6, wd[3]); out.rect_(0, 0, w, 1, wd[4]); out.rect_(0, 5, w, 1, wd[1])
    out.rect_(0, 6, w, h - 6, '#3a4a50')
    out.rect_(0, h - 3, w, 3, wd[2]); out.rect_(0, h - 3, w, 1, wd[3])
    out.rect_(0, 6, 2, h - 6, wd[2]); out.rect_(w - 2, 6, 2, h - 6, wd[1]); out.rect_(31, 6, 2, h - 9, wd[1])
    out.rect_(2, 15, w - 4, 1, '#8aa8b0')                                              # glass shelf
    out = ink(out)
    # goods behind the glass: lenses on the top shelf, sweets below
    for i in range(3):
        out.paste_(lens(i), 4 + i * 9, 8)
    for i in range(6):
        x = 36 + i * 4
        col = ['#d0504f', '#e8c84a', '#3d6fb0', '#d0504f', '#6ab050', '#e8c84a'][i]
        out.rect_(x, 12, 3, 2, col); out.px_(x - 1, 12, col); out.px_(x + 3, 13, col)
    for i in range(4):
        out.rect_(5 + i * 6, 18, 5, 3, '#c8a060'); out.rect_(5 + i * 6, 18, 5, 1, '#e8c888')     # matchboxes
    out.rect_(40, 18, 3, 4, P['red'][2]); out.rect_(44, 18, 3, 4, '#3d6fb0'); out.rect_(48, 18, 3, 4, '#6ab050')
    for x in (52, 55, 58):
        out.rect_(x, 19, 2, 3, '#e8e0cc')
    # glass: a glare across it
    out.line_(3, 7, 9, 22, '#d8f0f0', 0.5); out.line_(35, 7, 41, 22, '#d8f0f0', 0.4)
    # a jar of lollipops on the top
    out.rect_(54, -3, 6, 7, '#b9c9cc')
    for x, y, cc in ((55, -2, '#d0504f'), (57, -3, '#e8c84a'), (58, -1, '#3d6fb0')):
        out.px_(x, y, cc)
    return out


def lens(k: int = 0) -> Img:
    """A magnifying lens — лупа: a brass ring round pale blue glass with a white glint, a black
    handle down to the right. 8 × 8."""
    out = Img.new(8, 8)
    out.ellipse_(3, 3, 3, 3, P['gold'][2 + (k % 2)])
    out.ellipse_(3, 3, 2, 2, '#a8d0e0')
    out.px_(2, 2, '#ffffff')
    out.line_(5, 5, 7, 7, '#1a1a1a')
    return out


def lens_stand() -> Img:
    """A small display stand of lenses: a tiered wooden rack on legs, lenses of three sizes
    propped up on it, a price card «ЛУПА». 28 × 26."""
    w, h = 28, 26
    out = Img.new(w, h)
    wd = P['wood']
    out.rect_(0, 6, w, 4, wd[3]); out.rect_(0, 6, w, 1, wd[4])
    out.rect_(2, 12, w - 4, 4, wd[2]); out.rect_(2, 12, w - 4, 1, wd[3])
    out.rect_(2, 16, 3, 10, wd[2]); out.rect_(w - 5, 16, 3, 10, wd[1])
    out.rect_(4, 22, w - 8, 2, wd[1])
    out = ink(out)
    big = Img.new(12, 12)
    big.ellipse_(5, 5, 5, 5, P['gold'][2]); big.ellipse_(5, 5, 3.6, 3.6, '#a8d0e0'); big.px_(3, 3, '#ffffff')
    big.px_(4, 3, '#ffffff'); big.rect_(8, 8, 2, 4, '#1a1a1a')
    out.paste_(outline(big, INK), 1, -3)
    out.paste_(lens(1), 15, 0)
    out.paste_(lens(0), 20, 1)
    tag = Img.new(11, 7, '#f0d060')
    tag.paste_(text('20', '#1a1212', None), 3, 1)
    out.paste_(ink(tag), 9, 11)
    return out


def dynamite_crate() -> Img:
    """An open crate of dynamite: red sticks bundled with wire, fuses curling out, the crate's
    side stencilled with a warning stripe; NA's dynamite crate beside it. 26 × 22."""
    w, h = 26, 22
    out = Img.new(w, h)
    wd = P['wood']
    out.rect_(0, 6, w, 16, wd[2]); out.rect_(0, 6, w, 2, wd[3]); out.rect_(0, 6, 2, 16, wd[3])
    for y in (11, 16):
        out.rect_(2, y, w - 4, 1, wd[1])
    for x in range(3, w - 3, 4):                                                    # warning stripes
        out.poly_([(x, 17), (x + 2, 17), (x, 20), (x - 2, 20)], '#e8c030')
    out.rect_(2, 17, w - 4, 3, '#1a1a1a', 0.0)
    out = ink(out)
    for x in range(3, w - 3, 3):
        out.rect_(x, 1, 3, 8, P['red'][2]); out.rect_(x, 1, 1, 8, P['red'][3]); out.rect_(x, 1, 3, 1, '#e8d8b0')
        out.px_(x + 1, 0, '#3a3a3a')
    out.rect_(3, 5, w - 6, 1, '#8a8a80')
    out.line_(10, 0, 12, -3, '#e8d8b0')
    return out


def bomb_basket() -> Img:
    """A wicker basket of round black bombs with short fuses (NA's Bomb, graded). 18 × 16."""
    out = Img.new(18, 16)
    bomb = camp(na('Items/Projectile/Bomb.png'), sat=0.8)
    for x, y in ((0, 0), (6, -1), (3, 2)):
        out.paste_(bomb, x, y)
    ST = P['straw']
    bk = Img.new(18, 8)
    bk.rect_(0, 0, 18, 8, ST[2]); bk.rect_(0, 0, 18, 1, ST[3])
    for x in range(1, 18, 2):
        bk.rect_(x, 1, 1, 7, ST[1])
    bk.rect_(0, 4, 18, 1, ST[3])
    out.paste_(ink(bk), 0, 8)
    return out


def bread_crate() -> Img:
    """A slatted crate of bread: round loaves with scored tops and a long baton. 26 × 18."""
    w, h = 26, 18
    out = Img.new(w, h)
    for x, y in ((5, 5), (12, 4), (19, 5)):
        out.ellipse_(x, y, 4.5, 3, '#a8682a'); out.ellipse_(x - 1, y - 1, 3, 1.8, '#c8883a')
        out.line_(x - 2, y - 1, x + 1, y - 2, '#e8b870')
    out.poly_([(2, 2), (4, 0), (24, 3), (22, 5)], '#b8783a'); out.line_(5, 1, 21, 3, '#d8a050')
    out.rect_(0, 6, w, 12, P['wood'][2]); out.rect_(0, 6, w, 1, P['wood'][3])
    for y in (9, 13):
        out.rect_(0, y, w, 2, '#20181a')
    out.rect_(0, 6, 2, 12, P['wood'][3]); out.rect_(w - 2, 6, 2, 12, P['wood'][1])
    return outline(out, INK)


def drink_stack() -> Img:
    """A shop display of energy drinks: a cardboard tray base and cans stacked in a pyramid, the
    lime ones and the cyan ones in stripes, a star-shaped price tag «40». 26 × 24."""
    w, h = 26, 24
    out = Img.new(w, h)
    tray = Img.new(26, 6)
    tray.rect_(0, 0, 26, 6, '#b08a5a'); tray.rect_(0, 0, 26, 1, '#c8a870'); tray.rect_(2, 2, 22, 2, '#2a2e3a')
    tray.paste_(text('ЭНЕРГ', '#d8ff70', None), 3, 1)
    for row in range(4):
        n = 5 - row
        x0 = (w - n * 5) // 2
        for i in range(n):
            out.paste_(energy_can(row), x0 + i * 5, h - 6 - 8 - row * 5)
    out.paste_(ink(tray), 0, h - 6)
    star = grid(['..k..', '.kyk.', 'kyyyk', '.kyk.', '..k..'], {'k': '#a8323b', 'y': '#ffe060'})
    out.paste_(star, w - 6, 0)
    return out


def queue_post() -> Img:
    """A brass stanchion: a round base, a pole and a ball top with the rope hook. 6 × 20."""
    g = P['gold']
    out = Img.new(6, 20)
    out.ellipse_(3, 18, 3, 1.8, g[1]); out.rect_(2, 3, 2, 15, g[2]); out.rect_(2, 3, 1, 15, g[3])
    out.ellipse_(3, 2, 2, 2, g[3]); out.px_(2, 1, g[4])
    return ink(out)


def queue_rope(length: int) -> Img:
    """The red velvet rope between two posts, sagging in the middle. length × 8."""
    out = Img.new(length, 8)
    for x in range(length):
        t = x / max(1, length - 1)
        y = 1 + 5 * math.sin(t * math.pi)
        out.px_(x, int(y), '#a8323b'); out.px_(x, int(y) + 1, '#6e1e22')
    out.px_(0, 1, P['gold'][3]); out.px_(length - 1, 1, P['gold'][3])
    return out


def trash_bin() -> Img:
    """A tin bin with a wrapper and a can sticking out. 12 × 14."""
    out = Img.new(12, 14)
    c = P['concrete']
    out.rect_(1, 3, 10, 11, c[2]); out.rect_(1, 3, 2, 11, c[3]); out.rect_(9, 3, 2, 11, c[1])
    for x in range(3, 10, 2):
        out.rect_(x, 5, 1, 8, c[1])
    out.ellipse_(6, 3, 5.5, 1.8, c[3]); out.ellipse_(6, 3, 4.3, 1.2, '#2a2626')
    out = ink(out)
    out.rect_(3, 0, 3, 3, '#d0504f'); out.px_(4, 0, '#e8c84a')
    out.paste_(energy_can(0).crop(0, 0, 4, 4), 7, 0)
    return out


def tea_glass() -> Img:
    """A glass of tea in a nickel holder (подстаканник) with a spoon in it — the seller's. 7 × 9."""
    g = ['..s....', '..s....', '.gtttg.', '.gtttg.', '.httth.', '.hhhhhhh', '.hhhhh.h', '.hhhhhh.', '..hhh..']
    out = grid([r.ljust(8, '.') for r in g], {'s': '#c8d0d4', 'g': '#d8e8ec', 't': '#b8601a', 'h': '#8a9aa2'})
    out.px_(2, 4, '#d8e0e4'); out.px_(2, 5, '#c8d0d4')
    return ink(out)


def neon_sign(frame: int) -> Img:
    """«ОТКРЫТО» in pink neon on a dark board: letters as bright tubes with a soft halo, frame 2
    drops the Р out — the flicker every kiosk sign has. 31 × 13. (It was «24 ЧАСА», but in the
    3 × 5 font Ч is the same glyph as 4 and the sign read «24 4АСА».)"""
    w, h = 31, 13
    out = Img.new(w, h)
    out.rect_(0, 0, w, h, '#1c1a24'); out.rect_(0, 0, w, 1, '#34303e')
    out = ink(out)
    tx = text('ОТКРЫТО', NEON[2], None)
    glow = text('ОТКРЫТО', NEON[0], None)
    if frame % 3 == 2:
        tx.a[:, 12:15, 3] = 0                                                    # the Р goes out
        glow.a[:, 12:15, 3] = 0
    x0 = (w - tx.w) // 2
    for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
        out.paste_(glow, x0 + dx, 4 + dy, 0.6)
    out.paste_(tx, x0, 4)
    return out


def mini_icon(kind: str) -> Img:
    """5 × 5 goods icons for the price board."""
    g = {'energy': ['.kkk.', '.kyk.', '.kyk.', '.kyk.', '.kkk.'],
         'lens': ['.kkk.', 'kbbbk', 'kbbbk', '.kkkk', '....k'],
         'bomb': ['...y.', '..k..', '.kkk.', 'kkkkk', '.kkk.'],
         'dyn': ['rrr..', 'rrr..', 'rrr..', 'rrr..', '.y...']}[kind]
    return grid(g, {'k': '#141b1b' if kind == 'bomb' else '#1a2a10', 'y': LIME[2] if kind == 'energy' else '#ffd060',
                    'b': '#a8d0e0', 'r': P['red'][3]})


def price_board() -> Img:
    """The price list (прейскурант) under the neon: a black board, four goods as tiny icons with
    their price in chalk — energy drink 40, lens 20, bomb 25, dynamite 70. 31 × 18."""
    w, h = 31, 18
    out = Img.new(w, h)
    out.rect_(0, 0, w, h, '#23282a'); out.rect_(0, 0, w, 1, '#3a4246')
    out = ink(out)
    items = [('energy', '40'), ('lens', '20'), ('bomb', '25'), ('dyn', '70')]
    for i, (k, pr) in enumerate(items):
        x, y = 2 + (i % 2) * 15, 3 + (i // 2) * 7
        ic = mini_icon(k)
        if k == 'energy':
            ic = grid(['.kkk.', '.kyk.', '.kwk.', '.kyk.', '.kkk.'], {'k': '#1a2a10', 'y': LIME[2], 'w': '#ffffff'})
        out.paste_(ic, x, y)
        out.paste_(text(pr, '#e8e4d8', None), x + 6, y)
    return out


def price_poster(kind: str) -> Img:
    """A narrow price poster between the shelves and the neon: the goods, a price tag. 16 × 26."""
    if kind == 'energy':
        big = Img.new(8, 13)
        big.rect_(0, 0, 8, 13, LIME[1]); big.rect_(1, 1, 6, 11, LIME[2]); big.rect_(1, 1, 2, 11, LIME[3])
        big.rect_(0, 0, 8, 1, '#c8d0d4')
        for x, y in ((4, 2), (3, 4), (5, 5), (4, 6), (3, 8)):
            big.px_(x, y, '#ffffff')
        return poster(16, 26, '#2a2e3a', ink(big), '', '', '40', seed=11)
    if kind == 'lens':
        art = Img.new(14, 14)
        art.ellipse_(6, 6, 5.5, 5.5, P['gold'][3]); art.ellipse_(6, 6, 4, 4, '#a8d0e0'); art.px_(4, 4, '#ffffff')
        art.px_(5, 4, '#ffffff'); art.line_(10, 10, 13, 13, '#1a1a1a'); art.line_(10, 11, 12, 13, '#1a1a1a')
        return poster(16, 26, '#3d6fb0', outline(art, INK).crop(1, 1, 14, 14), '', '', '20', seed=12)
    raise ValueError(kind)


# ------------------------------------------------------------------------------------ map
def build() -> Map:
    m = Map('kiosk', W, H, 'indoor', name='Ларёк', ambient=0.62, music='yard')
    shell(m, 'plankgrey', 'tiles', face=2, door=(4, 2), out_to='square', out_at='kiosk', floor_seed=6)
    g = m.ground
    r = rng('kiosk-floor')

    # --- ground: a worn track to the counter, wrappers and caps, a receipt
    m.stamp(dust_decal(2 * T, 4 * T, 21, '#2a2418', 0.14, 36), 4 * T, 6 * T)
    for _ in range(9):
        x, y = r.randrange(T + 4, 8 * T), r.randrange(6 * T + 8, 10 * T - 4)
        col = r.choice(['#d0504f', '#e8c84a', '#3d6fb0', '#c8d0d4', '#6ab050'])
        g.rect_(x, y, 2, 1, col); g.px_(x, y + 1, '#000000', 0.3)
    m.stamp(paper(5, 7, 41), 6 * T + 2, 9 * T + 6)

    # --- north wall face: the neon over the seller, the price board under it, a narrow poster
    #     on each side
    m.stamp(price_poster('energy'), 3 * T + 1, T + 4)
    m.stamp(price_poster('lens'), 6 * T, T + 4)
    ns = [neon_sign(i) for i in range(3)]
    m.put('kiosk.neon', ns, 5 * T - 15, T + 1, base=3 * T - 1, fps=2)
    m.light(5 * T, T + 8, 40, '#ff5ab4', 'neon')
    m.stamp(price_board(), 5 * T - 15, T + 14)

    # --- behind the counter: grocery shelves (west) and the drinks fridge (east)
    gs = grocery_shelves()
    m.put('kiosk.shelves', gs, 1 * T - 2, 5 * T - 2 - gs.h, solid=(1, 3, 3.1, 4.8))
    fr = [fridge(i) for i in range(3)]
    m.put('kiosk.fridge', fr, 7 * T + 1, 5 * T - 2 - fr[0].h, fps=3, solid=(7, 3, 9, 4.8))
    m.light(8 * T, 4 * T, 34, '#a8f0d8', 'neon')
    m.emit('dust', 5 * T, 8 * T, 0.25)

    # --- the seller behind her glass counter, the register on it
    gc = glass_counter()
    m.put('kiosk.counter', gc, 5 * T - 32, 5 * T + 3, solid=(3, 5.3, 7, 6.6))
    cr = cash_register()
    m.put('kiosk.register', cr, 5 * T + 10, 5 * T - 8, base=6 * T + 12)
    m.npc('seller', 'seller', 5.0, 4.95, face=0, anim='idle', name='Продавщица')
    tg = tea_glass()
    m.put('kiosk.tea', tg, 3 * T + 12, 5 * T - 3, base=6 * T + 12)
    m.emit('steam', 4 * T - 1, 5 * T - 5, 0.3)
    m.marks['seller'] = (5.0, 4.95)
    m.block(3, 4.8, 3.5, 5.3); m.block(6.5, 4.8, 7, 5.3)
    m.put('kiosk.lamp', lamp_hanging(20), 4 * T - 6, 3 * T - 4, layer='top')
    m.light(4 * T - 1, 5 * T + 2, 54, '#ffe0a8', 'lamp')

    # --- customers' side: explosives (west), the queue rope, lenses and drinks (east), bread
    dc = dynamite_crate()
    m.put('kiosk.dynamite', dc, 1 * T + 1, 8 * T - dc.h, solid=(1, 6.9, 2.7, 8))
    bb = bomb_basket()
    m.put('kiosk.bombs', bb, 1 * T + 6, 9 * T + 4 - bb.h, solid=(1.3, 8.5, 2.5, 9.2))
    brc = bread_crate()
    m.put('kiosk.bread', brc, 2 * T + 6, 10 * T - brc.h, solid=(2.4, 9.3, 4, 10))
    qp = queue_post()
    for x in (3.25, 4.0):
        m.put('kiosk.post', qp, int(x * T) - 3, int(7.6 * T) - qp.h + 2, solid=(x - 0.2, 7.3, x + 0.2, 7.7))
    m.put('kiosk.rope', queue_rope(int(0.75 * T) + 1), int(3.25 * T), int(7.6 * T) - 18, base=int(7.6 * T) + 1)
    ls = lens_stand()
    m.put('kiosk.lenses', ls, 7 * T - 2, 8 * T - ls.h, solid=(6.9, 7.3, 8.6, 8))
    ds = drink_stack()
    m.put('kiosk.drinks', ds, 7 * T, 10 * T - ds.h, solid=(7, 9.2, 8.6, 10))
    m.light(7 * T + 13, 9 * T + 6, 22, '#b8ff70', 'glow')
    tb = trash_bin()
    m.put('kiosk.bin', tb, 6 * T + 2, 10 * T - tb.h, solid=(6.1, 9.4, 6.8, 10))
    return m
