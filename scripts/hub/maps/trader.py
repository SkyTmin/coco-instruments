"""Торговец изнутри (v2.80) — the black-market dealer's shed.

11 × 13 tiles, grey weathered boards, packed-earth floor with rugs thrown over it. The dealer
(Барыга) in his top hat stands behind a trestle table of stolen goods; a kerosene lantern hangs
beside him, his strongbox with a money bag sits at his elbow, and over his head the price board
carries the hot lot's red «%» sticker. Around the walls the contraband: a heap of crates under a
tarp, stencilled crates, a crate of bottles, jerrycans of fuel, a samovar steaming, a gramophone,
a valve radio, a bicycle, rolled carpets, sacks, a stolen painting; on the wall a carpet, a ring
of keys, a cuckoo clock and tobacco drying on a string.

Lessons from the critique rounds (keep them):
  * gold must dominate a pocket watch — a white face bigger than the case reads as an eyeball;
  * canvas over crates has to keep the crates' CORNERS: a rounded tarp read as a grassy hill;
  * rolled carpets stood on end read as book spines — lie them down, spiral ends to the viewer;
  * grey (woodgrey) crates under furniture read as stone plinths — plain wood under goods;
  * a hanging lamp must hang over open floor: over a box it looks like it stands on the box;
  * a % in a chalk ring read as a compass — the hot lot gets a shop's starburst sticker;
  * wall items must not overlap: a board hung over the tobacco string hid it.
"""
from __future__ import annotations

import math

from art_town import BRASS, CHROME, OLIVE, box3, bottle, litter, oriental_rug
from kit import INK, P, barrel, crate, ink, shell
from lib import T, Img, Map, grid, outline, rng

W, H = 11, 13

CLOTH = ['#2e1216', '#4a1a20', '#6a262a', '#8a3638', '#a8504a']
WALNUT_DARK = ['#261612', '#3e2418', '#5a3622', '#7a4c30', '#9a6644']


# ------------------------------------------------------------------------------------ art
def goods_table() -> Img:
    """A trestle table under a burgundy cloth with the loot laid out: bottles, pocket watches,
    a string of pearls, an open casket of gold, a brass balance. 54 × 30; feet at the bottom.
    The middle stays low — the dealer stands behind it."""
    w, h = 54, 30
    out = Img.new(w, h)
    wd = P['wood']
    ty = 14                                   # the table top's back edge
    for x in (4, w - 7):                      # trestle legs under the cloth
        out.rect_(x, h - 7, 3, 7, wd[1]); out.rect_(x, h - 7, 1, 7, wd[2])
    out.rect_(6, h - 3, w - 12, 1, wd[0])
    out.rect_(0, ty, w, 7, CLOTH[3]); out.rect_(0, ty, w, 1, CLOTH[4])
    for x in range(3, w - 2, 9):
        out.rect_(x, ty + 2, 5, 1, CLOTH[2])
    out.rect_(0, ty + 7, w, h - ty - 11, CLOTH[2])
    for x in range(2, w - 2, 7):              # the drape's folds, lit on the left
        out.rect_(x, ty + 7, 2, h - ty - 11, CLOTH[3])
        out.rect_(x + 4, ty + 8, 1, h - ty - 12, CLOTH[1])
    out.rect_(0, ty + 7, w, 1, CLOTH[1])
    out.rect_(0, h - 5, w, 1, BRASS[2])       # hem with gold tassels
    for x in range(1, w - 1, 3):
        out.rect_(x, h - 4, 1, 2, BRASS[3])
    out = ink(out)
    for x, c, lab, hh in ((2, '#3f6a3a', '#d8cfb0', 12), (8, '#6a3a1e', '#c24a3a', 11), (14, '#8fa8ac', None, 10)):
        out.paste_(bottle(c, hh, lab, cork=P['wood'][3]), x, ty + 4 - hh)
    # pocket watches lying flat: gold case, small cream face, the bow, a chain snaking off
    for cx, cy in ((22, ty + 4), (28, ty + 5)):
        wt = Img.new(6, 5)
        wt.ellipse_(3, 2.5, 3, 2.5, BRASS[2])
        wt.ellipse_(2.6, 2.2, 2.2, 1.7, BRASS[4])
        wt.ellipse_(3, 2.6, 1.4, 1.1, '#e6dcc0')
        wt.px_(3, 2, INK)
        out.paste_(outline(wt, INK), cx - 4, cy - 4)
        out.px_(cx - 1, cy - 5, BRASS[3])
        for k in range(4):
            out.px_(cx + 3 + k, cy - 1 + (k % 2), BRASS[3] if k % 2 else BRASS[1])
    for k in range(10):                        # a string of pearls in a loop
        a = k / 9 * math.pi * 1.6
        out.px_(int(32 + 3 * math.cos(a)), int(ty + 4 + 1.6 * math.sin(a)), '#f4f0e6' if k % 2 else '#c8c4b8')
    # the open casket: lid up behind with its red lining, the box brimming with gold
    cb = Img.new(11, 10)
    cb.rect_(0, 0, 11, 4, P['wood'][2]); cb.rect_(1, 1, 9, 3, '#a83a44'); cb.rect_(1, 1, 9, 1, '#c85a5a')
    cb.rect_(0, 4, 11, 6, P['wood'][1]); cb.rect_(0, 6, 11, 1, BRASS[2])
    cb.rect_(1, 4, 9, 2, BRASS[3]); cb.px_(2, 4, BRASS[4]); cb.px_(5, 4, BRASS[4]); cb.px_(8, 5, '#e05050')
    cb.px_(4, 5, '#6ad0e0'); cb.px_(5, 8, BRASS[3])
    out.paste_(ink(cb), 35, ty - 4)
    # the balance: post, beam, two pans on cords, one down with a weight in it
    sc = Img.new(13, 15)
    sc.rect_(6, 2, 1, 11, BRASS[2]); sc.rect_(5, 12, 3, 1, BRASS[1]); sc.rect_(3, 13, 7, 2, BRASS[2])
    sc.rect_(3, 13, 7, 1, BRASS[3])
    sc.line_(1, 4, 11, 2, BRASS[3]); sc.px_(6, 1, BRASS[4])
    sc.line_(1, 4, 0, 9, BRASS[1]); sc.line_(1, 4, 3, 9, BRASS[1])
    sc.line_(11, 2, 10, 7, BRASS[1]); sc.line_(11, 2, 12, 7, BRASS[1])
    sc.rect_(0, 9, 4, 1, BRASS[3]); sc.rect_(0, 10, 4, 1, BRASS[1])
    sc.rect_(9, 7, 4, 1, BRASS[3]); sc.rect_(9, 8, 4, 1, BRASS[1])
    sc.rect_(1, 8, 2, 1, '#6c727a')
    out.paste_(outline(sc, INK), 42, ty - 10)
    return out


def gramophone(frame: int = 0) -> Img:
    """A gramophone on a crate: box, black record with a red label, tone arm, and the big flared
    horn — the one silhouette in the room nobody mistakes. 24 × 34; frames turn the record."""
    w, h = 24, 34
    out = Img.new(w, h)
    out.paste_(crate(18, 14), 3, h - 14)
    bx = Img.new(18, 9)
    bx.rect_(0, 0, 18, 4, WALNUT_DARK[3]); bx.rect_(0, 0, 18, 1, WALNUT_DARK[4])
    bx.rect_(0, 4, 18, 5, WALNUT_DARK[2]); bx.rect_(1, 5, 16, 1, WALNUT_DARK[1]); bx.rect_(1, 7, 16, 1, BRASS[2])
    out.paste_(ink(bx), 3, h - 22)
    ry = h - 21
    out.ellipse_(11, ry + 1, 7, 2, '#1b181c')
    out.ellipse_(11, ry + 1, 2, 0.9, '#b8323a')
    sheen = [(6, ry), (9, ry + 2), (15, ry + 2), (16, ry)][frame % 4]
    out.rect_(sheen[0], sheen[1], 2, 1, '#6a6470')
    out.rect_(21, h - 19, 2, 1, BRASS[3]); out.rect_(22, h - 21, 1, 3, BRASS[2])
    out.line_(17, ry - 1, 14, ry - 5, BRASS[2]); out.line_(18, ry - 1, 15, ry - 5, BRASS[1])
    out.line_(14, ry - 5, 12, ry - 9, BRASS[2]); out.line_(15, ry - 5, 13, ry - 9, BRASS[3])
    cx, cy = 9, 7
    out.ellipse_(cx, cy, 8.5, 7, BRASS[1])
    out.ellipse_(cx - 0.5, cy - 0.5, 7.5, 6, BRASS[3])
    out.ellipse_(cx + 0.5, cy + 0.5, 4.5, 3.6, '#2a1c14')
    out.ellipse_(cx + 1, cy + 1, 2.4, 2, '#140c0a')
    for a in range(0, 360, 60):
        t = math.radians(a)
        out.px_(int(cx + math.cos(t) * 6.4), int(cy + math.sin(t) * 5.2), BRASS[1])
    out.rect_(3, 2, 3, 1, BRASS[4]); out.px_(2, 3, BRASS[4])
    out.poly_([(11, 11), (14, 10), (13, 14), (12, ry - 8)], BRASS[2])
    return outline(out, INK).crop(1, 1, w, h)


def strongbox() -> Img:
    """An iron strongbox: riveted bands, a lit lid, a brass padlock, and a fat money bag sitting
    on the lid. 20 × 24."""
    st = ['#1f2624', '#2f3a36', '#45524c', '#5f6e66', '#7f8e84']
    out = Img.new(20, 24)
    bx = box3(20, 16, 5, st)
    for x in (4, 15):
        bx.rect_(x, 1, 2, 14, st[1]); bx.rect_(x, 1, 1, 4, st[4])
    for x in range(2, 19, 3):
        bx.px_(x, 6, st[4]); bx.px_(x, 13, st[0])
    bx.rect_(9, 5, 2, 3, BRASS[1])
    lock = Img.new(5, 5)
    lock.rect_(0, 1, 5, 4, BRASS[3]); lock.rect_(0, 1, 5, 1, BRASS[4]); lock.px_(2, 3, INK)
    lock.rect_(1, 0, 3, 1, BRASS[2])
    bx.paste_(ink(lock), 8, 7)
    out.paste_(bx, 0, 8)
    # bundles of banknotes on the lid, each with its paper band (NA's MoneyBag went pink under
    # the grade and read as a pig; a purse read as a kettle — flat bundles read as money)
    for i, (x, y) in enumerate(((2, 5), (9, 6), (5, 2))):
        bn = Img.new(8, 5)
        bn.rect_(0, 0, 8, 5, '#6e8a62'); bn.rect_(0, 0, 8, 2, '#9ab488'); bn.rect_(0, 4, 8, 1, '#4e6a46')
        bn.rect_(3, 0, 2, 5, '#e8e0c8'); bn.rect_(3, 0, 2, 1, '#fff8e8')
        bn.rect_(0, 2, 8, 1, '#88a07a')
        out.paste_(ink(bn), x, y)
    return out


def lantern(frame: int = 0, cord: int = 20) -> Img:
    """A kerosene storm lantern hanging on a wire (top layer): tin cap, wire guard round a glass
    globe, the flame, the red fuel tank. 11 × (cord + 16); the flame breathes."""
    w = 11
    out = Img.new(w, cord + 16)
    out.rect_(5, 0, 1, cord, '#2a2426')
    tin = ['#3a3a36', '#56564e', '#7a7a6c', '#9c9c88']
    lamp = Img.new(w, 16)
    lamp.rect_(4, 0, 3, 1, tin[2]); lamp.px_(4, 1, tin[2]); lamp.px_(6, 1, tin[2])
    lamp.poly_([(3, 2), (8, 2), (10, 5), (1, 5)], tin[1])
    lamp.rect_(3, 2, 5, 1, tin[3])
    lamp.ellipse_(5.5, 8.5, 3.6, 3.2, '#e8a848')
    lamp.rect_(2, 6, 1, 6, tin[0]); lamp.rect_(8, 6, 1, 6, tin[0])
    lamp.rect_(1, 12, 9, 3, '#7a2a22'); lamp.rect_(1, 12, 9, 1, '#a8423a'); lamp.rect_(1, 14, 9, 1, '#4a1a16')
    lamp = ink(lamp)
    glow = ['#ffd57a', '#ffe39a', '#ffcf6a'][frame % 3]
    fl = [3, 4, 3][frame % 3]
    lamp.ellipse_(5.5, 8.5, 2.6, 2.4, glow)
    lamp.rect_(5, 10 - fl, 1, fl, '#fff6d0')
    lamp.px_(5, 10 - fl - 1, '#ffb347')
    lamp.rect_(2, 7, 1, 4, tin[0]); lamp.rect_(8, 7, 1, 4, tin[0])
    out.paste_(lamp, 0, cord)
    return out


def stencil_crate(mark: str, dark: bool = False, w: int = 16, h: int = 16) -> Img:
    """A crate with a stencilled mark on its front: star, cross, arrows (this way up), or «№7»."""
    out = crate(w, h, dark=dark)
    red, pale = '#9a3a30', '#e0d4b4'
    fx, fy = w // 2, 5 + (h - 5) // 2
    if mark == 'star':
        g = ['..#..', '.###.', '#####', '.#.#.']
        out.paste_(grid(g, {'#': red}), fx - 2, fy - 2)
    elif mark == 'x':
        for k in range(-3, 4):
            out.px_(fx + k, fy + k, red); out.px_(fx + k, fy - k, red)
    elif mark == 'arrows':
        for x in (fx - 3, fx + 2):
            out.rect_(x, fy - 1, 1, 4, pale); out.px_(x - 1, fy, pale); out.px_(x + 1, fy, pale)
    return out


def crate_of_bottles() -> Img:
    """An open crate packed with bottles: rows of necks and caps seen from above. 18 × 17."""
    w, h = 18, 17
    out = Img.new(w, h)
    wd = P['wood']
    out.rect_(0, 6, w, h - 6, wd[2])
    for y in range(8, h, 3):
        out.rect_(1, y, w - 2, 1, wd[1])
    out.rect_(0, 6, w, 1, wd[4])
    out.rect_(1, 7, 2, h - 7, wd[3])
    out = ink(out)
    greens = ['#3f6a3a', '#56864c', '#8fb07a']
    browns = ['#5a2e18', '#7a4424', '#a8683c']
    for row, y in enumerate((1, 4)):
        for i, x in enumerate(range(1, w - 2, 4)):
            g = greens if (i + row) % 3 else browns
            out.rect_(x, y, 3, 4, g[0]); out.rect_(x + 1, y - 1, 1, 5, g[1]); out.px_(x + 1, y - 1, g[2])
            out.px_(x + 1, y - 2 + (i % 2), '#d8cfb0')
    return out


def crate_of_tobacco() -> Img:
    """A crate of makhorka packs: paper bundles tied with string, red or blue labels. 18 × 16."""
    out = crate(18, 16)
    for i, x in enumerate((1, 6, 11)):
        pk = Img.new(6, 6)
        pk.rect_(0, 0, 6, 6, '#c9b28a'); pk.rect_(0, 0, 6, 1, '#e2d0a8')
        pk.rect_(0, 2, 6, 2, '#a83a30' if i != 1 else '#3a5a8a')
        pk.rect_(2, 0, 1, 6, '#6e5a3e')
        out.paste_(ink(pk), x, -1 + (i % 2))
    return out


def tarp_heap() -> Img:
    """Contraband under a tarp: crates stacked two high on the left, a single one on the right,
    under a khaki canvas that keeps their boxy shape — straight tops, sharp corners, folds hanging
    off the front — lashed with rope. A crate foot and a sack peek out at the hem. 42 × 30."""
    w, h = 42, 30
    out = Img.new(w, h)
    tp = ['#2e2a20', '#48422e', '#645c3e', '#827852', '#a0966c']
    out.poly_([(1, h - 1), (1, 5), (3, 3), (19, 3), (21, 5), (21, 12), (23, 11), (39, 11), (41, 13),
               (41, h - 1)], tp[2])
    out.poly_([(2, 5), (3, 4), (19, 4), (20, 5), (20, 9), (2, 9)], tp[3])
    out.poly_([(22, 13), (23, 12), (39, 12), (40, 13), (40, 16), (22, 16)], tp[3])
    out.rect_(4, 4, 12, 1, tp[4]); out.rect_(25, 12, 10, 1, tp[4])
    for x in (5, 11, 16):
        out.rect_(x, 10, 1, h - 12, tp[1]); out.rect_(x - 1, 10, 1, h - 13, tp[3])
    for x in (27, 34):
        out.rect_(x, 17, 1, h - 19, tp[1]); out.rect_(x - 1, 17, 1, h - 20, tp[3])
    out.rect_(19, 5, 2, h - 6, tp[1])
    out.rect_(1, 9, 20, 1, tp[1]); out.rect_(21, 16, 20, 1, tp[1])
    out.poly_([(15, 4), (19, 4), (19, 9)], tp[4]); out.line_(15, 4, 19, 9, tp[1])
    for x, top in ((8, 3), (30, 11)):
        out.rect_(x, top, 1, h - top - 1, '#c8b484'); out.rect_(x + 1, top, 1, h - top - 1, '#7a6a48')
    out.rect_(1, 20, 40, 1, '#c8b484'); out.rect_(1, 21, 40, 1, '#7a6a48')
    out.rect_(7, 19, 4, 3, '#a8946a'); out.rect_(29, 19, 4, 3, '#a8946a')
    out.rect_(3, h - 4, 7, 3, P['wood'][2]); out.rect_(3, h - 4, 7, 1, P['wood'][3])
    out.ellipse_(37, h - 3, 3.5, 2.2, '#8a7a5a'); out.ellipse_(36, h - 3.5, 2, 1.2, '#a8987a')
    return outline(out, INK)


def wall_carpet() -> Img:
    """The carpet on the wall — every Soviet room has one, the dealer's is the best. 38 × 28."""
    field = ['#3e1418', '#5e1e22', '#7e2a2c', '#a03c3a', '#c05a4c']
    border = ['#141c2e', '#1e2a44', '#2e3e5e', '#4a5a7a', '#6a7a96']
    rug = oriental_rug(36, 26, field, border, '#c9a45a', seed=7, fringe='#cfc2a4')
    out = Img.new(38, 28)
    out.paste_(rug, 1, 1)
    out.rect_(0, 1, 38, 2, P['wood'][2]); out.rect_(0, 1, 38, 1, P['wood'][3])
    out.px_(0, 1, INK); out.px_(37, 1, INK)
    return out


def price_board() -> Img:
    """The dealer's price board: a chalkboard in a plank frame, prices chalked in rows, a chalk
    arrow to the hot lot's red starburst sticker with a fat white «%». 36 × 26."""
    w, h = 36, 26
    out = Img.new(w, h)
    wd = P['wood']
    out.rect_(0, 0, w, h, wd[2]); out.rect_(0, 0, w, 1, wd[4]); out.rect_(0, 0, 1, h, wd[3])
    out.rect_(0, h - 1, w, 1, wd[0])
    out.rect_(2, 2, w - 4, h - 4, '#243029')
    out.rect_(2, 2, w - 4, 1, '#1a221e')
    r = rng('prices')
    for y in (5, 9, 13, 17, 21):
        out.rect_(4, y, r.randrange(4, 8), 1, '#c8ccc0')
        for x in range(12, 16, 2):
            out.px_(x, y, '#7a847a')
        out.rect_(16, y, 2, 1, '#e0e4d8')
    out.rect_(19, 13, 3, 1, '#e0e4d8'); out.px_(21, 12, '#e0e4d8'); out.px_(21, 14, '#e0e4d8')
    out = ink(out)
    st = Img.new(15, 15)
    pts = []
    for k in range(16):
        a = k / 16 * 2 * math.pi
        rad = 7.4 if k % 2 == 0 else 5.4
        pts.append((7.5 + math.cos(a) * rad, 7.5 + math.sin(a) * rad))
    st.poly_(pts, '#d8382e')
    st.ellipse_(7.5, 7.5, 4.8, 4.8, '#ec4c3c')
    st.paste_(grid(['##..#', '##.#.', '..#..', '.#.##', '#..##'], {'#': '#fff4e0'}), 5, 5)
    st.px_(4, 3, '#ff8a70'); st.px_(3, 4, '#ff8a70')
    out.paste_(outline(st, INK), 20, 4)
    out.line_(w // 2, 0, 6, 2, '#8a7a58'); out.line_(w // 2, 0, w - 7, 2, '#8a7a58')
    return out


def cuckoo_clock(frame: int = 0) -> Img:
    """A stolen cuckoo clock: a carved house with a pitched roof, a round face, pine-cone weights
    on chains and a pendulum that swings by frame. 14 × 28."""
    w, h = 14, 28
    out = Img.new(w, h)
    wd = WALNUT_DARK
    out.poly_([(0, 6), (7, 0), (14, 6)], wd[1]); out.poly_([(1, 6), (7, 1), (7, 6)], wd[3])
    out.rect_(2, 6, 10, 10, wd[2]); out.rect_(2, 6, 1, 10, wd[3]); out.rect_(11, 6, 1, 10, wd[1])
    out.rect_(6, 3, 2, 2, '#1a1210')
    out.ellipse_(7, 11, 3.6, 3.6, '#efe6cc')
    out.px_(7, 9, INK); out.px_(7, 10, INK); out.px_(8, 11, INK)
    out = ink(out)
    for x, y in ((4, 22), (10, 20)):
        out.rect_(x, 16, 1, y - 16, '#6a6258')
        out.rect_(x - 1, y, 3, 4, BRASS[2]); out.px_(x - 1, y, BRASS[3]); out.px_(x + 1, y + 3, BRASS[1])
    sw = [-2, -1, 1, 2, 1, -1][frame % 6]
    out.line_(7, 16, 7 + sw, 23, '#8a7a58')
    out.ellipse_(7 + sw, 24, 1.6, 1.6, BRASS[3])
    out.px_(7 + sw - 1, 23, BRASS[4])
    return out


def key_ring() -> Img:
    """A big iron ring of keys on a nail — every lock in the camp. 12 × 16."""
    out = Img.new(10, 14)
    for yy in range(14):
        for xx in range(10):
            d = (xx + 0.5 - 5) ** 2 + (yy + 0.5 - 4.5) ** 2
            if 2.4 ** 2 <= d <= 3.8 ** 2:
                out.px_(xx, yy, P['iron'][3] if yy < 4 else P['iron'][2])
    for x, c, l in ((1, BRASS[3], 9), (4, P['iron'][4], 10), (6, BRASS[2], 8), (8, P['iron'][3], 9)):
        out.rect_(x, 7, 1, l - 3, c); out.rect_(x, 7 + l - 4, 2, 1, c); out.px_(x + 1, 7 + l - 6, c)
    out = outline(out, INK)
    out.px_(6, 0, '#8a8a80')
    return out


def samovar() -> Img:
    """A brass samovar with a china teapot warming on its crown, on an upturned crate. 18 × 30."""
    w, h = 18, 30
    out = Img.new(w, h)
    out.paste_(crate(16, 12), 1, h - 12)
    s = Img.new(14, 19)
    br = BRASS
    s.rect_(3, 16, 8, 3, br[1]); s.rect_(2, 18, 10, 1, br[0])
    s.poly_([(2, 6), (12, 6), (13, 12), (10, 16), (4, 16), (1, 12)], br[2])
    s.poly_([(2, 6), (6, 6), (5, 16), (4, 16), (1, 12)], br[3])
    s.rect_(3, 7, 1, 6, br[4])
    s.rect_(1, 10, 12, 1, br[1])
    s.rect_(0, 8, 1, 3, br[1]); s.rect_(13, 8, 1, 3, br[1])
    s.rect_(6, 12, 3, 1, br[1]); s.rect_(7, 13, 1, 2, br[0])
    s.rect_(5, 4, 4, 2, br[1])
    s.ellipse_(7, 2, 3, 2, '#e8e2d4'); s.rect_(4, 2, 6, 1, '#4a6a9a'); s.rect_(10, 1, 2, 1, '#e8e2d4')
    out.paste_(outline(s, INK), 1, h - 12 - 19 - 1 + 1)
    return out


def jerrycans() -> Img:
    """Two olive jerrycans of fuel with the famous X pressed into their sides. 22 × 16."""
    out = Img.new(22, 16)
    o = OLIVE
    for i, x in enumerate((0, 11)):
        c = Img.new(10, 15)
        c.rect_(0, 3, 10, 12, o[2]); c.rect_(0, 3, 10, 1, o[4]); c.rect_(0, 4, 1, 10, o[3]); c.rect_(9, 4, 1, 11, o[1])
        c.rect_(1, 0, 6, 3, o[1]); c.rect_(2, 1, 4, 1, o[3])
        c.rect_(7, 0, 2, 3, o[2])
        for k in range(7):
            c.px_(1 + k + (k > 3), 6 + k, o[1]); c.px_(8 - k - (k > 3), 6 + k, o[1])
            c.px_(1 + k + (k > 3), 5 + k, o[3])
        out.paste_(ink(c), x, 1 - i)
    return out


def rolled_carpets() -> Img:
    """Three rolled carpets lying across on top of each other, side on: long cylinders with the
    pattern in bands, fringe at the far end, the near end a disc of rings. 32 × 22.
    (Stood on end they read as book spines; ends to the viewer, as cushions.)"""
    w, h = 32, 22
    out = Img.new(w, h)
    rolls = [(1, 14, 28, '#7a2a2c', '#a84a44', '#c9a45a'), (4, 7, 27, '#2e3e5e', '#4a5e82', '#c9a45a'),
             (2, 0, 24, '#6a5a2a', '#9a8440', '#7a2a2c')]
    for x, y, L, c0, c1, band in reversed(rolls):
        rr = Img.new(L + 1, 8)
        rr.rect_(3, 0, L - 3, 8, c0)                                   # the body
        rr.rect_(3, 1, L - 3, 2, c1); rr.rect_(3, 6, L - 3, 2, '#1a1216')
        for bx in range(7, L - 2, 6):
            rr.rect_(bx, 0, 2, 8, band); rr.rect_(bx, 6, 2, 2, '#4a3a20')
        for yy in range(1, 7, 2):
            rr.px_(L, yy, '#d8ccb0')                                   # fringe at the far end
        rr.ellipse_(3, 4, 3, 4, c1)                                    # the near end: rings
        rr.ellipse_(3, 4, 2, 2.8, c0); rr.ellipse_(3, 4, 1, 1.5, c1); rr.px_(3, 4, '#140c0c')
        out.paste_(outline(rr, INK), x, y)
    return out


def dried_fish(n: int = 5) -> Img:
    """Dried fish (вобла) hung by the tails on a twine: forked tail up, body swelling to a blunt
    head, a dark back and a pale belly, the eye. (8n + 2) × 18."""
    w = 8 * n + 2
    out = Img.new(w, 18)
    for x in range(w):
        out.px_(x, 1 + int(1.2 * math.sin(x / w * math.pi)), '#9a8a62')
    out.px_(0, 0, INK); out.px_(w - 1, 0, INK)
    g = [
        '.k...k.',
        '.kbkbk.',
        '..kbk..',
        '..kbk..',
        '.kbbak.',
        '.kbbak.',
        'kbbbaak',
        'kbbbaak',
        'kbbbaak',
        'kbbbaak',
        'kbbbaak',
        '.kbbak.',
        '.kgggk.',
        '.kgegk.',
        '..kgk..',
        '...k...',
    ]
    tones = [('#6a5634', '#b8a070', '#8a7648'), ('#5e4a2e', '#a88e60', '#7e6a42'), ('#72603c', '#c4ae80', '#94804e')]
    for i in range(n):
        b, a, gg = tones[i % 3]
        fish = grid(g, {'k': INK, 'b': b, 'a': a, 'g': gg, 'e': '#e8e0c8'})
        x = 1 + i * 8
        out.paste_(fish, x, 1 + int(1.2 * math.sin((x + 3) / w * math.pi)))
    return out


def tobacco_bale() -> Img:
    """A pressed bale of tobacco leaf: layers of golden-brown leaves, ragged at the edges, bound
    with two bands of twine. 22 × 15."""
    w, h = 22, 15
    out = Img.new(w, h)
    r = rng('bale')
    tones = ['#6a4420', '#8a5a2a', '#a8703a', '#c49048', '#dcae62']
    out.rect_(1, 0, w - 2, 5, tones[3]); out.rect_(1, 0, w - 2, 1, tones[4])   # the top face
    for y in range(5, h):
        c = tones[1] if y % 3 else tones[0]
        out.rect_(0 if y % 2 else 1, y, w - (1 if y % 2 else 2), 1, tones[2] if y % 3 == 1 else c)
    for _ in range(14):                                                       # ragged leaf tips
        x, y = r.choice([0, w - 1]), r.randrange(5, h)
        out.px_(x + (1 if x == 0 else -1) * 0, y, tones[1])
    for x in range(2, w - 2, 3):
        out.px_(x, 2 + x % 2, tones[2])
    for bx in (6, 15):
        out.rect_(bx, 0, 1, h, '#c8b484'); out.rect_(bx + 1, 1, 1, h - 1, '#7a6a48')
    return outline(out, INK)


def open_sack(goods: str = 'coffee', color: str = '#8a7a5a') -> Img:
    """An open burlap sack, its mouth rolled down into a thick rim, the goods heaped inside:
    coffee beans, sugar, tea. 14 × 14. (Tied sacks read as clay vases; an open one with its
    goods showing reads as a sack at once — and says what is being sold.)"""
    from lib import ramp
    c = ramp(color, 4, 0.36)
    fill = {'coffee': ['#2a1a12', '#4a2e1c', '#6a4428'], 'sugar': ['#b8b4a8', '#dcd8cc', '#f4f2ea'],
            'tea': ['#2a3420', '#3e4c2c', '#5a6a3c']}[goods]
    out = Img.new(14, 14)
    out.poly_([(1, 13), (0, 7), (1, 4), (13, 4), (14, 7), (13, 13)], c[1])      # the belly
    out.poly_([(1, 12), (0, 7), (1, 5), (6, 5), (5, 12)], c[2])
    out.rect_(11, 6, 2, 7, c[0])
    out.ellipse_(7, 4, 7, 3.2, c[3])                                          # the rolled rim
    out.ellipse_(7, 4, 5.6, 2.2, c[1])
    out.ellipse_(7, 3.4, 5, 2, fill[1])                                       # the goods, heaped
    out.ellipse_(6, 2.8, 3, 1.2, fill[2])
    r = rng('sack', goods)
    for _ in range(6):
        out.px_(r.randrange(3, 11), r.randrange(2, 5), fill[0])
    out.rect_(4, 8, 6, 1, c[0]); out.rect_(5, 10, 4, 1, c[0])                 # a stencil
    return outline(out, INK)


def gilt_painting() -> Img:
    """A stolen oil painting in a gilt frame, leaning on its stand: a birch landscape at dusk.
    16 × 22."""
    w, h = 16, 22
    out = Img.new(w, h)
    out.line_(3, 20, 5, 12, P['wood'][1]); out.line_(12, 20, 10, 12, P['wood'][1])   # the easel feet
    fr = Img.new(16, 14)
    fr.rect_(0, 0, 16, 14, BRASS[2]); fr.rect_(0, 0, 16, 1, BRASS[4]); fr.rect_(0, 0, 1, 14, BRASS[3])
    fr.rect_(15, 0, 1, 14, BRASS[1]); fr.rect_(0, 13, 16, 1, BRASS[1])
    fr.rect_(2, 2, 12, 10, '#e0a060')
    fr.rect_(2, 2, 12, 4, '#c87850'); fr.rect_(2, 6, 12, 2, '#e8b870')
    fr.rect_(2, 8, 12, 4, '#4a5a3a'); fr.rect_(2, 10, 12, 2, '#3a4a2e')
    for x in (4, 9, 12):
        fr.rect_(x, 3, 1, 8, '#e8e2d4'); fr.px_(x, 5, INK); fr.px_(x, 8, INK)
    fr.px_(10, 3, '#fff0c0')
    out.paste_(ink(fr), 0, 2)
    return out


def bicycle() -> Img:
    """A bicycle leaning on the wall, side on: two spoked wheels, the frame, bars, saddle. 30 × 20."""
    w, h = 30, 20
    out = Img.new(w, h)
    fr = '#3a5a4a'
    for cx in (6, 23):
        for yy in range(h):
            for xx in range(w):
                d = (xx + 0.5 - cx) ** 2 + (yy + 0.5 - 13) ** 2
                if 4.2 ** 2 <= d <= 6.2 ** 2:
                    out.px_(xx, yy, '#1e1c20' if d > 5.2 ** 2 else '#3a3840')
        out.ellipse_(cx, 13, 1.2, 1.2, CHROME[3])
        for k in range(4):
            t = math.radians(k * 45 + 10)
            out.line_(int(cx - math.cos(t) * 4), int(13 - math.sin(t) * 4), int(cx + math.cos(t) * 4),
                      int(13 + math.sin(t) * 4), '#8a9098')
    for (x0, y0, x1, y1) in ((6, 13, 13, 13), (13, 13, 20, 6), (6, 13, 11, 6), (11, 6, 20, 6), (13, 13, 11, 6), (20, 6, 23, 13)):
        out.line_(x0, y0, x1, y1, fr)
    out.rect_(9, 4, 5, 2, '#2a1c16')
    out.line_(20, 6, 21, 3, CHROME[2]); out.rect_(19, 2, 5, 1, CHROME[3])
    out.ellipse_(13, 13, 1.5, 1.5, CHROME[2])
    return outline(out, None)


def radio(frame: int = 0) -> Img:
    """A valve radio on a crate: an arched walnut case, a cloth grille with a carved fret, an
    amber tuning dial that glows and two knobs. 18 × 27."""
    w, h = 18, 27
    out = Img.new(w, h)
    out.paste_(crate(16, 12), 1, h - 12)
    rd = Img.new(14, 15)
    wd = WALNUT_DARK
    rd.rect_(0, 5, 14, 10, wd[2]); rd.ellipse_(7, 6, 7, 6, wd[2])
    rd.ellipse_(6, 5, 5, 4, wd[3]); rd.rect_(0, 5, 1, 9, wd[3]); rd.rect_(13, 5, 1, 10, wd[1])
    rd.ellipse_(7, 7, 4.5, 4.6, '#b8a47a')
    for x in (5, 7, 9):
        rd.rect_(x, 3, 1, 7, wd[1])
    rd.rect_(2, 10, 10, 1, wd[1])
    rd = ink(rd)
    glow = ['#ffb347', '#ffcf6a'][frame % 2]
    rd.rect_(3, 11, 8, 2, glow); rd.px_(5 + frame % 2 * 2, 11, '#7a2a14')
    rd.px_(1, 12, BRASS[3]); rd.px_(12, 12, BRASS[3])
    out.paste_(rd, 2, h - 12 - 15 + 1)
    return out


def boots() -> Img:
    """A pair of felt boots (валенки) side on: tall shafts, the feet turned left, pale soles. 14 × 13."""
    g = [
        '....kkkk.kkkk.',
        '....k33k.k33k.',
        '....k32k.k32k.',
        '....k32k.k32k.',
        '....k32kkk32k.',
        '....k32kk332k.',
        '....k32k3332k.',
        'kkkkk32k3332k.',
        'k3333322k3322k',
        'k2222222k2222k',
        'k2222221k2221k',
        'kssssssskssssk',
        'kkkkkkkkkkkkkk',
    ]
    return grid(g, {'k': INK, '3': '#8e877a', '2': '#6a6458', '1': '#4e4a42', 's': '#c8bca0'})


# ------------------------------------------------------------------------------------ map
def build() -> Map:
    m = Map('trader', W, H, 'indoor', name='Торговец', ambient=0.45, music='yard')
    shell(m, 'plankgrey', 'dirt', face=2, door=(4, 2), out_to='square', out_at='trader', floor_seed=5)
    g = m.ground
    r = rng('trader-floor')

    # --- floor: rugs thrown over the earth, butts, straw and a dropped coin
    rug = oriental_rug(58, 40, ['#3a1418', '#5a1c20', '#7a2a2a', '#9a3e38', '#b85a4a'],
                       ['#1a2238', '#26324e', '#34466a', '#50628a', '#7080a2'], '#c9a45a', seed=2)
    m.stamp(rug, 3 * T + 4, 6 * T + 4)
    small = oriental_rug(28, 18, ['#2a3a2a', '#3a4e36', '#4e6848', '#6a8660', '#88a47a'],
                         ['#4a2a1a', '#6a3e26', '#8a5634', '#aa7048', '#c88e62'], '#d8c090', seed=4)
    m.stamp(small, 6 * T + 12, 9 * T + 4)
    litter(g, r, 'straw', 40, (T, 3 * T, 4 * T, 12 * T))
    litter(g, r, 'straw', 20, (8 * T, 3 * T, 10 * T, 6 * T))
    litter(g, r, 'butt', 9, (3 * T, 5 * T, 8 * T, 11 * T))
    litter(g, r, 'paper', 4, (T, 5 * T, 10 * T, 12 * T))
    litter(g, r, 'coin', 3, (4 * T, 6 * T, 7 * T, 8 * T))

    # --- north wall: the carpet, a ring of keys, the price board right over the dealer, the
    #     cuckoo clock, dried fish on a string over the crates
    m.stamp(wall_carpet(), T + 1, T + 1)
    m.stamp(key_ring(), 3 * T + 9, T + 4)
    m.stamp(price_board(), 4 * T + 3, T + 4)
    m.put('trader.cuckoo', [cuckoo_clock(i) for i in range(6)], 6 * T + 10, T + 1, base=3 * T, fps=4)
    m.stamp(dried_fish(5), 7 * T + 14, T + 1)

    # --- the dealer behind his table, his strongbox at his elbow, the lantern hanging beside him
    m.put('trader.table', goods_table(), 3 * T + 4, 6 * T - 28, solid=(3.5, 5, 7, 6))
    m.npc('trader', 'trader', 5.3, 4.85, face=0, anim='idle', name='Торговец')
    m.put('trader.strongbox', strongbox(), 3 * T + 8, 5 * T - 24 - 2, solid=(3.5, 3.9, 4.7, 4.7))
    m.put('trader.lantern', [lantern(i, cord=12) for i in range(3)], 6 * T + 8, 3 * T, layer='top', fps=5)
    m.light(5 * T + 12, 5 * T + 4, 88, '#ffc86a', 'lamp')
    m.emit('dust', 5 * T + 8, 5 * T, 0.5)

    # --- west: the heap under the tarp, the gramophone, crates, the carpets, sacks, a painting
    m.put('trader.tarp', tarp_heap(), T, 5 * T - 30, solid=(1, 3.5, 3.6, 5))
    m.put('trader.gramophone', [gramophone(i) for i in range(4)], T + 2, 7 * T - 34 + 2, fps=6,
          solid=(1.2, 6, 2.4, 7))
    m.put('trader.crate.star', stencil_crate('star'), T, 9 * T - 16, solid=(1, 8, 2, 9))
    m.put('trader.crate.bottles', crate_of_bottles(), 2 * T + 1, 9 * T - 17, solid=(2, 8, 3.2, 9))
    m.put('trader.crate.x', stencil_crate('x', dark=True), T, 8 * T - 12, base=8 * T - 1)
    m.put('trader.carpets', rolled_carpets(), T, 11 * T - 22, solid=(1, 10.2, 3, 11))
    m.put('trader.bale', tobacco_bale(), 3 * T + 1, 10 * T - 15, solid=(3, 9.4, 4, 10))
    m.put('trader.sack.coffee', open_sack('coffee'), 3 * T - 2, 11 * T + 2, solid=(2.9, 10.6, 3.8, 11.2))
    m.put('trader.sack.sugar', open_sack('sugar', '#7e6e4e'), T + 1, 12 * T - 14, solid=(1.1, 11.4, 2, 12))
    m.put('trader.painting', gilt_painting(), 2 * T - 1, 12 * T - 21, solid=(2, 11.4, 2.9, 12))

    # --- east: crates of tobacco, the samovar steaming, jerrycans, the radio, the bicycle
    m.put('trader.crate.tobacco', crate_of_tobacco(), 8 * T + 2, 4 * T - 16, solid=(8, 3, 9.2, 4))
    m.put('trader.crate.arrows', stencil_crate('arrows'), 9 * T + 2, 4 * T - 16, solid=(9, 3, 10, 4))
    m.put('trader.crate.star.dark', stencil_crate('star', dark=True), 9 * T + 2, 4 * T - 28, base=4 * T - 1)
    sam = samovar()
    m.put('trader.samovar', sam, 8 * T + 6, 6 * T - sam.h, solid=(8.4, 5, 9.6, 6))
    m.emit('steam', 9 * T + 1, 5 * T - 12, 0.35)
    m.put('trader.jerrycans', jerrycans(), 8 * T + 10, 7 * T + 2, solid=(8.5, 6.6, 10, 7.2))
    m.put('trader.radio', [radio(i) for i in range(2)], 9 * T - 2, 9 * T - 26, fps=1.5, solid=(8.9, 8, 10, 9))
    m.light(9 * T + 7, 9 * T - 14, 16, '#ffb347', 'glow')
    m.put('trader.bicycle', bicycle(), 8 * T + 2, 11 * T - 20, solid=(8, 10.4, 10, 11))
    m.put('trader.boots', boots(), 6 * T + 12, 12 * T - 14)
    m.put('kit.barrel', barrel(), 9 * T + 1, 12 * T - 18, solid=(9, 11.2, 10, 12))
    m.marks['trader'] = (5.3, 4.85)
    return m
