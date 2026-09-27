"""Клуб изнутри (v2.80) — the camp's casino.

12 × 14 tiles, a dark room lit by its own neon: wine-red damask walls over a walnut dado, dark
basket-weave parquet under a patterned casino carpet. The croupier (Крупье) deals behind a
kidney-shaped blackjack table of green felt — the chip rack, cards, the shoe — under a
green-shaded lamp; behind him the cashier's credenza with chip trays and the cash box. On the
north wall the «КЛУБ» sign in pink tubes inside a cyan frame flickers, the bar's mirrored
shelves hold bottles under a cyan cocktail-glass neon, and red velvet curtains frame the little
stage with its microphone, the upright piano, footlights and a mirror ball. A bank of slot
machines blinks and spins its reels (a gold one by the door), a jukebox rolls its colours, a
roulette wheel turns, dice lie on a felt table, a velvet rope keeps the stage.

Lessons from the critique rounds (keep them):
  * a neon sign flickers ONE letter now and then (a dead tube), not every frame — 12 frames at
    6 fps with a drop-out on two of them; constant flicker reads as a broken screen;
  * the kit's orange staggered plank floor beside a red carpet reads as brick paving — a dark
    parquet stamped over it, with the shell's contact shadows and the door mat restored;
  * a mirror ball at floor height reads as a lollipop: it hangs high, in front of the curtains;
  * a tilted mic boom beside a piano reads as a desk lamp: the singer's mic is a straight pole;
  * a lamp over the dealer must hang just above his head — higher it floats over empty floor,
    lower it covers his face; and nothing stands in the cluster behind him (a lone brass
    ashtray there read as a stray rope stanchion);
  * a wide sprite on the last column must end before the east cap (the piano ran into it).
"""
from __future__ import annotations

import math

from art_town import (BRASS, CHROME, FELT, LACQUER, NEON_CYAN, NEON_PINK, VELVET, box3, bottle, glass_cup,
                      halo, litter, potted, stool_round, tube_text)
from kit import INK, ink, shell
from lib import T, Img, Map, grid, outline, ramp, rng

W, H = 12, 14

WAL = ['#241612', '#3a2218', '#553222', '#744630', '#94603e']
DAMASK = ['#240c14', '#34121e', '#461a28', '#5a2434', '#6e3040']
CARPET = ['#2a0c14', '#44121e', '#5e1a28', '#7a2634', '#96384a']


# ------------------------------------------------------------------------------------ art
def wallpaper(w: int, h: int) -> Img:
    """Wine-red damask above a walnut dado with a brass rail — stamped over the north wall face."""
    out = Img.new(w, h)
    out.rect_(0, 0, w, h, DAMASK[2])
    motif = ['..#..', '.#.#.', '#.#.#', '.#.#.', '..#..']
    for y in range(-2, h - 10, 8):
        for x in range((y // 8) % 2 * 5, w, 10):
            for yy, row in enumerate(motif):
                for xx, v in enumerate(row):
                    if v == '#':
                        out.px_(x + xx, y + yy, DAMASK[3])
            out.px_(x + 2, y + 2, DAMASK[4])
    dy = h - 11
    out.rect_(0, dy, w, 1, BRASS[3]); out.rect_(0, dy + 1, w, 1, BRASS[1])
    out.rect_(0, dy + 2, w, h - dy - 2, WAL[2])
    for x in range(2, w - 8, 12):
        out.rect_(x, dy + 3, 10, h - dy - 5, WAL[1]); out.rect_(x, dy + 3, 10, 1, WAL[3])
    out.rect_(0, 0, w, 2, DAMASK[0])                                  # shadow under the ceiling
    return out


def neon_sign(frame: int = 0) -> Img:
    """«КЛУБ» in pink tubes inside a cyan tube frame with a spade and a heart at the ends. A dead
    «У» flickers out on frame 7 and the whole pink circuit dips on frame 9 (12 frames at 6 fps):
    a flicker every two seconds is a failing tube; every frame would be a broken screen.
    52 × 21 with its halo."""
    lit = [True, True, True, True]
    pink_on = True
    if frame % 12 == 7:
        lit[2] = False
    if frame % 12 == 9:
        pink_on = False
    w, h = 50, 19
    out = Img.new(w, h)
    # the cyan frame: a rounded rectangle tube
    cy = NEON_CYAN
    for x in range(2, w - 2):
        out.px_(x, 1, cy[3]); out.px_(x, h - 2, cy[3])
    for y in range(2, h - 2):
        out.px_(1, y, cy[3]); out.px_(w - 2, y, cy[3])
    # letters
    x = 12
    for i, ch in enumerate('КЛУБ'):
        g = tube_text(ch, NEON_PINK, lit=lit[i] and pink_on)
        out.paste_(g, x, 6)
        x += g.w + 2
    # suits at the ends, cyan
    out.paste_(tube_text('♠', NEON_CYAN), 4, 6)
    out.paste_(tube_text('♥', NEON_PINK, lit=pink_on), w - 9, 6)
    # the halo: pink round the letters, cyan round the frame
    out = halo(out, NEON_PINK[2] if pink_on else NEON_CYAN[1], 0.32, 1)
    # tube mounts (tiny dark clips) — the sign is glass on the wall, not a lightbox
    for x in (6, w - 6):
        out.px_(x, 0, '#2a2a30'); out.px_(x, h + 1, '#2a2a30')
    return out


def cocktail_neon(frame: int = 0) -> Img:
    """A cyan martini-glass neon over the bar with a pink olive that blinks. 16 × 18."""
    g = [
        '#########',
        '.#.....#.',
        '..#...#..',
        '...#.#...',
        '....#....',
        '....#....',
        '....#....',
        '....#....',
        '..#####..',
    ]
    out = Img.new(14, 14)
    out.paste_(grid(g, {'#': NEON_CYAN[3]}), 2, 2)
    out.line_(8, 0, 6, 4, NEON_CYAN[4])                               # the stick
    if frame % 2 == 0:
        out.rect_(5, 4, 2, 2, NEON_PINK[3]); out.px_(5, 4, NEON_PINK[4])
    else:
        out.rect_(5, 4, 2, 2, NEON_PINK[0])
    return halo(out, NEON_CYAN[2], 0.3, 1)


def bar_shelf() -> Img:
    """The back bar on the wall: a walnut frame round a smoky mirror, two glass shelves of
    bottles in every colour, a row of glasses. 52 × 28."""
    w, h = 52, 28
    out = Img.new(w, h)
    out.rect_(0, 0, w, h, WAL[2]); out.rect_(0, 0, w, 1, WAL[4]); out.rect_(0, 0, 1, h, WAL[3])
    out.rect_(2, 2, w - 4, h - 4, '#3a4448')                          # the mirror
    for k in range(0, w, 14):
        out.line_(4 + k, h - 4, 12 + k, 3, '#56646a')
    for y in (12, 22):
        out.rect_(2, y, w - 4, 1, '#b8c8cc'); out.rect_(2, y + 1, w - 4, 1, WAL[1])
    out = ink(out)
    r = rng('barshelf')
    cols = ['#3f6a3a', '#6a3a1e', '#8fa8ac', '#a83a30', '#c8a040', '#3a4a8a', '#5a2a4a', '#d8d0b0']
    for y in (12, 22):
        x = 4
        while x < w - 8:
            c = r.choice(cols)
            hh = r.choice([7, 8, 9])
            out.paste_(bottle(c, hh, r.choice([None, '#e8e0c8', '#c24a3a']), cork=None), x, y - hh)
            x += 6
    return out


def bar_counter() -> Img:
    """The bar: a polished walnut top, a front of buttoned red leather between brass-studded
    posts, a brass foot rail; on top a brass cash register, an ice bucket with a bottle, two
    cocktail glasses and a bowl. 56 × 28."""
    w, h = 56, 28
    out = Img.new(w, h)
    ty = 8
    out.rect_(0, ty, w, 5, WAL[3]); out.rect_(0, ty, w, 1, WAL[4]); out.rect_(0, ty + 4, w, 1, WAL[1])
    out.rect_(0, ty + 5, w, h - ty - 5, VELVET[2])
    for x in range(0, w, 11):                                         # posts
        out.rect_(x, ty + 5, 3, h - ty - 5, WAL[2]); out.rect_(x, ty + 5, 1, h - ty - 5, WAL[3])
    for x in range(5, w - 3, 11):                                     # buttons in the leather
        for y in (ty + 8, ty + 12):
            out.px_(x + (y // 4) % 2 * 3, y, VELVET[0])
            out.px_(x + (y // 4) % 2 * 3 - 1, y - 1, VELVET[3])
    out.rect_(0, h - 4, w, 1, BRASS[3]); out.rect_(0, h - 3, w, 1, BRASS[1])   # foot rail
    out.rect_(0, h - 1, w, 1, WAL[0])
    out = ink(out)
    # the cash register: an ornate brass box, the drawer, the number flags up
    cr = Img.new(12, 11)
    cr.rect_(0, 4, 12, 7, BRASS[2]); cr.rect_(0, 4, 12, 1, BRASS[4]); cr.rect_(0, 9, 12, 2, BRASS[1])
    cr.rect_(1, 0, 10, 4, BRASS[3]); cr.rect_(2, 1, 8, 2, '#1a1a1a')
    cr.px_(3, 1, '#f2e8c8'); cr.px_(6, 1, '#f2e8c8'); cr.px_(8, 1, '#f2e8c8')
    for x in range(2, 11, 2):
        cr.px_(x, 6, '#f2eee0'); cr.px_(x, 7, '#f2eee0')
    out.paste_(outline(cr, INK), w - 14, ty - 9)
    # the ice bucket with a bottle
    out.rect_(3, ty - 3, 7, 4, CHROME[3]); out.rect_(3, ty - 3, 7, 1, CHROME[4])
    out.paste_(bottle('#2e4a2a', 9, '#e8d890', cork='#e8d890'), 5, ty - 11)
    out.rect_(3, ty - 3, 7, 1, '#eef6f8')
    # two cocktail glasses and a bowl of nuts
    for x in (16, 22):
        out.poly_([(x, ty - 5), (x + 4, ty - 5), (x + 2, ty - 3)], '#b4f0f0'); out.px_(x + 1, ty - 5, '#ff5e9e')
        out.rect_(x + 2, ty - 3, 1, 3, '#dfe8ea'); out.rect_(x + 1, ty, 3, 1, '#dfe8ea')
    out.ellipse_(31, ty, 3, 1.5, '#c8a060'); out.ellipse_(31, ty - 0.5, 2, 0.8, '#e8c080')
    return out


def stage() -> Img:
    """The little stage: a platform of pale boards, a front of red velvet skirting with a gold
    fringe, a row of footlights along the edge, a step on the left. 56 × 36."""
    w, h = 56, 36
    out = Img.new(w, h)
    top = 22                                           # the top face's depth
    boards = ['#5a3a24', '#7a5234', '#9a6c44', '#b88a58', '#d0a470']
    for i, y in enumerate(range(0, top, 4)):
        c = boards[2 + (i % 2)]
        out.rect_(0, y, w, 4, c); out.rect_(0, y, w, 1, boards[4] if i % 2 else boards[3])
        out.rect_(0, y + 3, w, 1, boards[1])
        for x in range((i * 13) % 17, w, 17):
            out.rect_(x, y, 1, 4, boards[1])
    out.rect_(0, top, w, 2, boards[4])                  # the nosing
    out.rect_(0, top + 2, w, h - top - 2, VELVET[2])
    for x in range(1, w, 6):
        out.rect_(x, top + 2, 2, h - top - 5, VELVET[3]); out.rect_(x + 4, top + 2, 1, h - top - 5, VELVET[1])
    for x in range(0, w, 2):
        out.rect_(x, h - 4, 1, 3, BRASS[3] if x % 4 else BRASS[2])
    out.rect_(0, h - 1, w, 1, VELVET[0])
    out = ink(out)
    # footlights: little brass cowls along the nosing with warm bulbs
    for x in range(5, w - 4, 11):
        out.rect_(x, top - 2, 5, 3, BRASS[2]); out.rect_(x, top - 2, 5, 1, BRASS[4])
        out.rect_(x + 1, top - 3, 3, 1, '#fff0b0')
    return out


def curtains() -> Img:
    """Red velvet drapes on the wall behind the stage: a swagged pelmet with gold fringe, drapes
    gathered to the sides by gold ropes, a midnight backdrop painted with stars. 56 × 30."""
    w, h = 56, 30
    out = Img.new(w, h)
    out.rect_(0, 0, w, h, '#141a2e')                                 # the backdrop
    r = rng('stars')
    for _ in range(14):
        out.px_(r.randrange(14, w - 14), r.randrange(8, h - 2), r.choice(['#c8d0f0', '#f2e8b0', '#8890b8']))
    # drapes: left and right, folds lit on their left, pulled in by a tie-back at y 18
    for side in (0, 1):
        for i in range(4):
            x0 = i * 4 if side == 0 else w - 16 + i * 4
            wx = 4
            cx = x0 + (1 if side == 0 else -1) * (i - 1)
            out.rect_(x0, 0, wx, h, VELVET[2])
            out.rect_(x0, 0, 1, h, VELVET[3]); out.rect_(x0 + 3, 0, 1, h, VELVET[1])
        tx = 13 if side == 0 else w - 14
        out.rect_(tx - 1, 17, 3, 3, BRASS[3]); out.px_(tx, 16, BRASS[4])
        # the drape bulges out below the tie-back
        for y in range(20, h):
            k = (y - 20) // 3
            if side == 0:
                out.rect_(14, y, min(k, 3), 1, VELVET[2])
            else:
                out.rect_(w - 14 - min(k, 3), y, min(k, 3), 1, VELVET[2])
    # pelmet with three swags and a gold fringe
    out.rect_(0, 0, w, 4, VELVET[3]); out.rect_(0, 0, w, 1, VELVET[4])
    for i in range(3):
        cx = 9 + i * 19
        out.ellipse_(cx, 3, 10, 4, VELVET[2]); out.ellipse_(cx, 2, 8, 2.4, VELVET[3])
    for x in range(0, w):
        y = 5 + int(2.2 * abs(math.sin((x - 0) / 19 * math.pi)))
        out.px_(x, y, BRASS[3])
        if x % 2 == 0:
            out.px_(x, y + 1, BRASS[2])
    return out


def mic_stand() -> Img:
    """The singer's microphone, centre stage: a straight chrome pole on a round foot, the
    chrome ball of the mic on top with its grille glinting, the cable coiled on the boards.
    10 × 22. (A tilted boom next to the piano read as a desk lamp.)"""
    out = Img.new(10, 22)
    out.ellipse_(5, 20.5, 4, 1.4, CHROME[1]); out.ellipse_(4.6, 20, 2.6, 0.8, CHROME[3])
    out.rect_(5, 6, 1, 14, CHROME[3]); out.rect_(4, 11, 3, 1, CHROME[1])
    out.rect_(4, 4, 3, 2, '#2a2a30')
    out.ellipse_(5.5, 2.5, 2.4, 2.6, CHROME[2]); out.px_(4, 1, '#ffffff'); out.px_(5, 2, CHROME[4])
    out.px_(6, 3, CHROME[1]); out.px_(5, 3, CHROME[1])
    out.line_(5, 16, 2, 19, '#1a1a1a'); out.line_(2, 19, 4, 21, '#1a1a1a'); out.px_(7, 21, '#1a1a1a')
    return outline(out, INK).crop(0, 0, 11, 23)


def cashier() -> Img:
    """The cashier's credenza under the sign: low walnut cabinet with brass pulls, trays of
    chips in their colour rows, a brass cash box with its lid up, a little shaded lamp. 40 × 22."""
    w, h = 40, 22
    out = Img.new(w, h)
    cab = box3(w, 14, 4, WAL)
    for x in (2, 14, 26):
        cab.rect_(x, 6, 11, 6, WAL[2]); cab.rect_(x, 6, 11, 1, WAL[3]); cab.rect_(x + 4, 8, 3, 1, BRASS[3])
    out.paste_(cab, 0, h - 14)
    # chip trays on top: two trays of columns
    for tx in (3, 15):
        out.rect_(tx, h - 16, 10, 3, '#1a1010')
        for i, c in enumerate(('#b83a3a', '#2f5fa8', '#e8e2d0', '#2a2a30', '#3f8a4a')):
            cc = chip(c)
            out.rect_(tx + 1 + i * 2, h - 16, 1, 2, cc[2]); out.px_(tx + 1 + i * 2, h - 16, '#f4efe0')
    # the cash box with the lid up and banknotes inside
    out.rect_(28, h - 18, 9, 5, BRASS[2]); out.rect_(28, h - 18, 9, 1, BRASS[4])
    out.rect_(29, h - 22, 7, 4, BRASS[1]); out.rect_(30, h - 21, 5, 2, '#3a2a14')
    out.rect_(29, h - 17, 7, 2, '#8ab07a'); out.px_(31, h - 17, '#e8e0c8')
    return outline(out, INK).crop(1, 1, w, h)


def piano() -> Img:
    """An upright piano in black lacquer: the lid, the music desk with a sheet on it, the
    keyboard in ivory and ebony, brass candle sconces, the pedals. 24 × 26."""
    w, h = 24, 26
    lq = LACQUER
    out = Img.new(w, h)
    out.rect_(0, 0, w, h, lq[2]); out.rect_(0, 0, w, 2, lq[4]); out.rect_(0, 2, 1, h - 2, lq[3])
    out.rect_(w - 1, 0, 1, h, lq[1])
    out.rect_(3, 4, w - 6, 6, lq[1]); out.rect_(3, 4, w - 6, 1, lq[3])      # the upper panel
    out.rect_(9, 5, 8, 5, '#e8e2d0'); out.rect_(10, 6, 6, 1, '#8a8478'); out.rect_(10, 8, 5, 1, '#8a8478')
    out.rect_(0, 11, w, 4, lq[3]); out.rect_(0, 11, w, 1, lq[4])           # key bed
    out.rect_(1, 13, w - 2, 3, '#f0ead8')
    for x in range(2, w - 2, 2):
        out.px_(x, 15, '#b8b0a0')
    for x in (3, 5, 9, 11, 13, 17, 19, 21):
        out.rect_(x, 13, 1, 2, '#141214')
    out.rect_(2, 16, w - 4, h - 19, lq[2]); out.rect_(4, 18, w - 8, h - 22, lq[1])
    out.rect_(10, h - 3, 1, 2, BRASS[3]); out.rect_(13, h - 3, 1, 2, BRASS[3]); out.rect_(16, h - 3, 1, 2, BRASS[3])
    out = ink(out)
    for x in (1, w - 4):                                                    # sconces with candles
        out.rect_(x, 5, 3, 1, BRASS[3]); out.rect_(x + 1, 2, 1, 3, '#f2eee0'); out.px_(x + 1, 1, '#ffd070')
    return out


def velvet_rope(w: int = 54) -> Img:
    """Brass stanchions with ball tops on round feet, and red velvet rope sagging between them."""
    h = 16
    out = Img.new(w, h)
    posts = [2, w // 2, w - 4]
    for a, b in zip(posts, posts[1:]):
        for x in range(a + 1, b + 1):
            t = (x - a) / (b - a)
            y = 5 + int(round(4 * math.sin(t * math.pi)))
            out.rect_(x, y, 1, 2, VELVET[3]); out.px_(x, y + 1, VELVET[1])
    for x in posts:
        out.ellipse_(x + 0.5, h - 1.5, 3, 1.3, BRASS[1])
        out.rect_(x, 4, 2, h - 5, BRASS[3]); out.rect_(x, 4, 1, h - 5, BRASS[4])
        out.ellipse_(x + 1, 3, 1.6, 1.6, BRASS[3]); out.px_(x, 2, BRASS[4])
    return outline(out, INK).crop(0, 0, w, h + 1)


def chip(c: str) -> list[str]:
    return ramp(c, 3, 0.4)


def card_table() -> Img:
    """The blackjack table: a kidney of green felt with a padded leather rail round the players'
    side, the straight dealer's edge on top with the chip rack (columns of red, blue, white,
    black, green chips), betting circles, cards dealt face-up, the red shoe, a pedestal. 60 × 32."""
    w, h = 60, 32
    out = Img.new(w, h)
    cx = w / 2
    # pedestal and its foot, under the apron
    out.rect_(24, 22, 12, 8, WAL[1]); out.rect_(24, 22, 3, 8, WAL[2])
    out.ellipse_(30, h - 2, 14, 2, WAL[0])
    # the rail (leather) — a half-ellipse under the felt
    out.rect_(0, 0, w, 6, WAL[2])
    out.ellipse_(cx, 5, cx, 17, '#4a2618')
    out.ellipse_(cx, 5, cx - 1, 16, '#6a3a22')
    out.ellipse_(cx, 4, cx - 3, 13.5, '#8a5030')
    # the felt
    out.ellipse_(cx, 4, cx - 5, 11.5, FELT[2])
    out.rect_(5, 0, w - 10, 4, FELT[2])
    out.ellipse_(cx - 2, 2, cx - 10, 6, FELT[3])
    # betting circles along the curve
    for k in range(5):
        a = math.pi * (0.18 + k * 0.16)
        bx = cx - math.cos(a) * (cx - 13)
        by = 4 + math.sin(a) * 8
        out.ellipse_(bx, by, 3, 2, FELT[4]); out.ellipse_(bx, by, 2, 1.1, FELT[2])
    # the dealer's straight edge: walnut lip with the chip rack
    out.rect_(0, 0, w, 3, WAL[3]); out.rect_(0, 0, w, 1, WAL[4])
    out.rect_(19, 1, 22, 5, '#2a1a12')
    for i, c in enumerate(['#b83a3a', '#2f5fa8', '#e8e2d0', '#2a2a30', '#3f8a4a', '#b83a3a', '#2f5fa8']):
        cc = chip(c)
        out.rect_(20 + i * 3, 2, 2, 3, cc[1]); out.px_(20 + i * 3, 2, cc[2])
    # cards dealt in front of two spots, and the shoe
    for x, y, pip in ((17, 11, '#c8323a'), (19, 12, '#1a1a1a'), (37, 11, '#1a1a1a'), (39, 12, '#c8323a')):
        out.rect_(x, y, 3, 4, '#f6f2e8'); out.px_(x + 1, y + 1, pip); out.rect_(x, y + 3, 3, 1, '#c8c4b8')
    out.rect_(46, 3, 6, 4, '#8a2226'); out.rect_(46, 3, 6, 1, '#b83a3a'); out.rect_(51, 4, 1, 3, '#f2eee0')
    # little stacks of chips on the players' spots
    for x, y, c in ((12, 9, '#2f5fa8'), (27, 14, '#b83a3a'), (44, 9, '#2a2a30')):
        cc = chip(c)
        out.rect_(x, y, 3, 3, cc[1]); out.rect_(x, y, 3, 1, cc[2]); out.px_(x + 1, y + 1, '#f4efe0')
    # the apron under the rail, then the ink
    out.ellipse_(cx, 17.5, cx - 6, 2.5, WAL[1])
    return outline(out, INK).crop(1, 1, w, h)


def slot_machine(body: list[str], frame: int = 0, seed: int = 0) -> Img:
    """A one-armed bandit: a rounded topper with a row of bulbs chasing, a marquee with a red 7,
    three reels in a chrome bezel scrolling their symbols (cherry, bell, 7, bar, lemon, gem —
    each reel at its own speed, the payline across), a button deck, the coin tray, and the lever
    with its red ball on the right. 20 × 32; frames animate."""
    w, h = 20, 32
    cw = 16
    out = Img.new(w, h)
    b = body
    # cabinet
    out.rect_(0, 6, cw, h - 6, b[2]); out.rect_(0, 6, 2, h - 6, b[3]); out.rect_(cw - 2, 6, 2, h - 6, b[1])
    out.ellipse_(cw / 2, 6, cw / 2, 5.5, b[2]); out.ellipse_(cw / 2 - 1, 5, cw / 2 - 3, 3.5, b[3])
    out.rect_(0, h - 2, cw, 2, b[0])
    # marquee
    out.rect_(2, 5, cw - 4, 5, '#1a1016'); out.rect_(2, 5, cw - 4, 1, '#3a2a30')
    seven = grid(['###', '..#', '.#.', '.#.'], {'#': '#ff4a3a'})
    out.paste_(seven, 4, 6); out.paste_(seven, 9, 6)
    # reel window
    out.rect_(1, 11, cw - 2, 10, CHROME[2]); out.rect_(1, 11, cw - 2, 1, CHROME[4]); out.rect_(1, 20, cw - 2, 1, CHROME[1])
    syms = [('#c8323a', '#6ab04a'), ('#e8c040', '#a87a20'), ('#e8483a', '#e8483a'), ('#1a1a1a', '#e8e2d0'),
            ('#d8e050', '#a8b030'), ('#5ad0f0', '#2a8ab0')]
    speeds = (1, 2, 3)
    for rix in range(3):
        rx = 2 + rix * 4
        out.rect_(rx, 12, 4, 8, '#f2eee4')
        off = (frame * 2 * speeds[rix] + seed * 5 + rix * 7) % (len(syms) * 5)
        for k in range(len(syms) + 2):
            sy = 12 + k * 5 - off % 5 - 5
            c0, c1 = syms[(k + off // 5 + rix * 2) % len(syms)]
            if 12 <= sy + 1 < 20:
                out.rect_(rx + 1, max(12, sy + 1), 2, 1, c0)
            if 12 <= sy + 2 < 20:
                out.rect_(rx + 1, sy + 2, 2, 1, c1)
        out.rect_(rx + 3, 12, 1, 8, '#b8b4a8')
    out.rect_(1, 16, cw - 2, 1, '#e83a3a')                                # the payline
    # button deck and the belly
    out.rect_(0, 21, cw, 3, b[3]); out.rect_(0, 21, cw, 1, b[4])
    for i, c in enumerate(('#e83a3a', '#f2d04a', '#4ac85a')):
        out.rect_(3 + i * 4, 22, 2, 1, c)
    out.rect_(3, 25, cw - 6, 2, '#1a1014')                                  # the coin tray
    out.px_(5 + frame % 3 * 2, 25, BRASS[4])
    out.rect_(3, 27, cw - 6, 1, CHROME[3])
    out = ink(out)
    # topper bulbs chasing along the dome
    for i in range(5):
        a = math.pi * (0.1 + i * 0.2)
        bx = int(round(cw / 2 - math.cos(a) * (cw / 2 - 1.5)))
        by = int(round(6 - math.sin(a) * 4.2))
        on = (i + frame) % 3 == 0
        out.px_(bx, by, '#fff4b0' if on else '#8a6a30')
    # the lever: a chrome arm from the side with a red ball on top
    out.rect_(cw, 16, 2, 2, CHROME[1])
    pull = [0, 0, 0, 0, 3, 1][frame % 6]
    out.rect_(cw + 1, 7 + pull, 1, 10 - pull, CHROME[3])
    out.ellipse_(cw + 1.5, 6 + pull, 1.8, 1.8, '#d8302e'); out.px_(cw + 1, 5 + pull, '#ff9a8a')
    return out


def jukebox(frame: int = 0) -> Img:
    """A jukebox: a walnut cabinet under an arch of glowing tubes whose colours roll round,
    the window with records standing in it, the selector buttons, the speaker grille, chrome
    trim. 20 × 30; 6 frames roll the colours."""
    w, h = 20, 30
    out = Img.new(w, h)
    out.rect_(0, 8, w, h - 8, WAL[2]); out.rect_(0, 8, 2, h - 8, WAL[3]); out.rect_(w - 2, 8, 2, h - 8, WAL[1])
    out.ellipse_(w / 2, 9, w / 2, 9, WAL[2])
    rain = ['#ff4a6a', '#ff9a3a', '#f2e04a', '#5ae06a', '#4ac8f0', '#b46af0']
    # the arch of tubes: three bands, colour rolls by frame
    for band, (rx, ry) in enumerate(((9.5, 8.5), (8, 7), (6.5, 5.5))):
        for k in range(24):
            a = math.pi * k / 23
            x = int(round(w / 2 - 0.5 - math.cos(a) * rx))
            y = int(round(9 - math.sin(a) * ry))
            out.px_(x, y, rain[(k // 4 + frame + band * 2) % len(rain)])
    out.ellipse_(w / 2, 9.5, 5, 4.5, '#1a1016')
    for i in range(4):                                                      # records in the window
        out.rect_(6 + i * 2, 6, 1, 5, '#2a2a30'); out.px_(6 + i * 2, 8, '#c83a3a')
    out.rect_(2, 14, w - 4, 3, CHROME[3]); out.rect_(2, 14, w - 4, 1, CHROME[4])
    for x in range(3, w - 3, 2):
        out.px_(x, 15, '#f2eee0' if (x + frame) % 4 else '#ffd070')
    out.rect_(3, 18, w - 6, 8, '#3a2a22')
    for y in range(19, 26, 2):
        out.rect_(4, y, w - 8, 1, '#8a6a4a')
    for x in (1, w - 2):
        out.rect_(x, 12, 1, h - 14, rain[(frame + (x > 5) * 3) % 6])
    out.rect_(0, h - 2, w, 2, WAL[0])
    return ink(out)


def roulette(frame: int = 0) -> Img:
    """A roulette wheel on a walnut stand: the bowl's rim, red and black pockets turning round
    by frame, the gold turret in the middle, the white ball. 20 × 18."""
    w, h = 20, 18
    out = Img.new(w, h)
    out.rect_(3, 8, 14, h - 8, WAL[2]); out.rect_(3, 8, 14, 1, WAL[3]); out.rect_(3, 8, 2, h - 8, WAL[3])
    out.rect_(3, h - 2, 14, 2, WAL[0])
    out.ellipse_(10, 6, 10, 5.5, WAL[3]); out.ellipse_(10, 6, 9, 4.6, WAL[1])
    for k in range(16):
        a = (k / 16) * 2 * math.pi + frame * 0.39
        x = 10 + math.cos(a) * 7
        y = 6 + math.sin(a) * 3.4
        out.px_(int(x), int(y), '#c8323a' if k % 2 else '#1a1a1a')
        if k == 0:
            out.px_(int(x), int(y), '#3f8a4a')
    out.ellipse_(10, 6, 3.4, 1.8, BRASS[2]); out.rect_(9, 4, 2, 2, BRASS[4])
    ba = -frame * 0.8
    out.px_(int(10 + math.cos(ba) * 8.2), int(6 + math.sin(ba) * 4), '#ffffff')
    return outline(out, INK)


def mirror_ball(frame: int = 0, cord: int = 14) -> Img:
    """A mirror ball on a chain (top layer): a sphere of little square facets, glints jumping
    from facet to facet by frame. 12 × (cord + 12)."""
    w = 12
    out = Img.new(w, cord + 12)
    out.rect_(6, 0, 1, cord, '#8a8a92')
    b = Img.new(w, 12)
    b.ellipse_(6, 6, 6, 6, '#6a7280')
    for y in range(12):
        for x in range(12):
            if (x - 5.5) ** 2 + (y - 5.5) ** 2 < 30:
                c = ['#8a94a4', '#b4bcc8', '#5a6270', '#d8e0ea'][((x // 2) + (y // 2) * 3 + (x < 6) + (y < 6)) % 4]
                b.px_(x, y, c)
    r = rng('ball', frame)
    for _ in range(3):
        b.px_(r.randrange(2, 10), r.randrange(2, 10), '#ffffff')
    b.px_(3, 3, '#ffffff')
    out.paste_(outline(b, INK).crop(0, 0, 12, 12), 0, cord)
    return out


def pool_lamp(cord: int = 16) -> Img:
    """The green-shaded lamp over the card table (top layer): a long cord, a wide green enamel
    shade, the bright slot of light under its rim. 28 × (cord + 8)."""
    w = 28
    out = Img.new(w, cord + 8)
    out.rect_(13, 0, 2, cord, '#2a2426')
    s = Img.new(w, 7)
    s.poly_([(9, 0), (19, 0), (w, 5), (0, 5)], '#1e5a34')
    s.poly_([(9, 0), (14, 0), (8, 5), (0, 5)], '#3a8a54')
    s.rect_(10, 0, 8, 1, '#6ac084'); s.rect_(0, 5, w, 1, BRASS[2])
    out.paste_(ink(s.crop(0, 0, w, 6)), 0, cord)
    out.rect_(3, cord + 6, w - 6, 1, '#fff0c0')
    return out


def armchair() -> Img:
    """A club armchair in red velvet, facing us: a rounded back, rolled arms, the lit seat
    cushion, stubby walnut feet. 16 × 15."""
    w, h = 16, 15
    out = Img.new(w, h)
    out.rect_(2, 0, w - 4, 8, VELVET[2]); out.ellipse_(w / 2, 1.5, w / 2 - 2, 2, VELVET[3])
    out.rect_(0, 4, 4, 9, VELVET[2]); out.rect_(w - 4, 4, 4, 9, VELVET[1])
    out.ellipse_(2, 4.5, 2, 1.5, VELVET[3]); out.ellipse_(w - 2, 4.5, 2, 1.5, VELVET[2])
    out.rect_(3, 7, w - 6, 4, VELVET[3]); out.rect_(3, 7, w - 6, 1, VELVET[4])
    out.rect_(0, 11, w, 2, VELVET[1])
    out.rect_(1, 13, 2, 2, WAL[1]); out.rect_(w - 3, 13, 2, 2, WAL[1])
    return ink(out)


def cocktail_table() -> Img:
    """A round cocktail table on a pedestal: a candle lamp with a red glass, two glasses. 14 × 17."""
    w, h = 14, 17
    out = Img.new(w, h)
    out.rect_(6, 7, 2, 8, WAL[2]); out.ellipse_(7, 15.5, 4, 1.3, WAL[0])
    out.ellipse_(7, 6, 7, 3, WAL[2]); out.ellipse_(7, 5.5, 6, 2.2, WAL[4])
    out = outline(out, INK).crop(1, 1, w, h)
    out.rect_(5, 1, 3, 4, '#a82838'); out.rect_(5, 1, 1, 4, '#d84a5a'); out.px_(6, 0, '#ffd070')
    out.paste_(glass_cup('#c8a040'), 1, 1)
    out.poly_([(9, 2), (13, 2), (11, 4)], '#b4f0f0'); out.rect_(11, 4, 1, 2, '#dfe8ea')
    return out


def dice_table() -> Img:
    """A little dice table: green felt in a raised walnut rim, two red dice mid-roll, the
    leather cup on its side. 18 × 16."""
    w, h = 18, 16
    out = Img.new(w, h)
    out.rect_(2, 10, 2, 6, WAL[2]); out.rect_(w - 4, 10, 2, 6, WAL[1])
    out.rect_(0, 0, w, 10, WAL[2]); out.rect_(0, 0, w, 1, WAL[4]); out.rect_(0, 8, w, 2, WAL[1])
    out.rect_(2, 2, w - 4, 6, FELT[2]); out.rect_(2, 2, w - 4, 1, FELT[1])
    out = ink(out)
    for x, y, pips in ((5, 3, ((1, 1),)), (9, 4, ((0, 0), (2, 2)))):
        d = Img.new(3, 3, '#d8302e')
        for px, py in pips:
            d.px_(px, py, '#fff4e0')
        out.paste_(d, x, y)
    out.rect_(12, 3, 3, 4, '#5a3020'); out.ellipse_(12, 5, 1, 2, '#2a1810')
    return out


def cig_machine() -> Img:
    """A cigarette machine: a tall red cabinet, a glass front with rows of packs in their
    slots, a row of chrome pull-knobs, a coin slot. 16 × 30."""
    w, h = 16, 30
    rr = ['#3a1014', '#5e1a20', '#8a2a2e', '#b04040', '#d06058']
    out = box3(w, h, 3, rr)
    out.rect_(2, 4, w - 4, 14, '#20262a'); out.rect_(2, 4, w - 4, 1, '#3a4448')
    packs = ['#e8e2d0', '#3a5a8a', '#c83a30', '#e8c040', '#3a7a4a']
    for row in range(3):
        for i in range(3):
            c = packs[(row * 3 + i) % len(packs)]
            out.rect_(3 + i * 4, 5 + row * 4, 3, 3, c); out.px_(3 + i * 4, 5 + row * 4, '#ffffff')
    out.line_(3, 16, 11, 5, '#ffffff', 0.2)
    for i in range(3):
        out.rect_(3 + i * 4, 20, 3, 2, CHROME[3]); out.px_(3 + i * 4, 20, CHROME[4])
    out.rect_(6, 24, 4, 2, '#141214'); out.rect_(7, 24, 2, 1, BRASS[3])
    return out


def sconce(frame: int = 0) -> Img:
    """A brass wall sconce with a pink glass tulip shade, glowing. 8 × 10."""
    out = Img.new(8, 10)
    out.rect_(3, 5, 2, 5, BRASS[2]); out.rect_(2, 9, 4, 1, BRASS[1])
    out.poly_([(0, 0), (8, 0), (6, 5), (2, 5)], '#e87aa8'); out.poly_([(1, 0), (4, 0), (3, 5), (2, 5)], '#ffc0dc')
    out = ink(out)
    out.rect_(2, 1, 4, 2, '#fff0f6')
    return out


def parquet(w: int, h: int) -> Img:
    """Dark walnut basket-weave parquet: 8 px squares of three planks each, turned alternately,
    each plank with a lit top edge. Ground decal for the whole floor. (The kit's plank floor is
    orange and staggered — beside the carpet it read as brick paving.)"""
    out = Img.new(w, h)
    c = ['#1e120e', '#2c1a14', '#3a241a', '#4a2e20', '#5a3a28']
    r = rng('parquet')
    for by in range(0, h, 8):
        for bx in range(0, w, 8):
            vert = ((bx // 8) + (by // 8)) % 2
            for k in range(3):
                tone = r.choice([2, 2, 3, 1])
                if vert:
                    x0 = bx + k * 3 - (1 if k == 2 else 0)
                    pw = 3 if k < 2 else 2
                    out.rect_(x0, by, pw, 8, c[tone]); out.rect_(x0, by, 1, 8, c[min(4, tone + 1)])
                    out.rect_(x0, by + 7, pw, 1, c[0])
                else:
                    y0 = by + k * 3 - (1 if k == 2 else 0)
                    ph = 3 if k < 2 else 2
                    out.rect_(bx, y0, 8, ph, c[tone]); out.rect_(bx, y0, 8, 1, c[min(4, tone + 1)])
                    out.rect_(bx + 7, y0, 1, ph, c[0])
    return out


def casino_carpet(w: int, h: int) -> Img:
    """The casino carpet: a deep red ground, a repeating pattern of gold lozenges and teal
    stars, a darker border — busy on purpose, as casino carpets are. Ground decal."""
    out = Img.new(w, h)
    out.rect_(0, 0, w, h, CARPET[1])
    out.rect_(2, 2, w - 4, h - 4, CARPET[2])
    for y in range(4, h - 4, 12):
        for x in range(4 + (y // 12) % 2 * 8, w - 4, 16):
            out.poly_([(x + 4, y), (x + 8, y + 4), (x + 4, y + 8), (x, y + 4)], BRASS[1])
            out.poly_([(x + 4, y + 1), (x + 7, y + 4), (x + 4, y + 7), (x + 1, y + 4)], CARPET[3])
            out.px_(x + 4, y + 4, BRASS[3])
            sx, sy = x + 12, y + 8
            if sx < w - 4 and sy < h - 4:
                out.px_(sx, sy, '#2a6a6a'); out.px_(sx - 1, sy, '#1e4a4a'); out.px_(sx + 1, sy, '#1e4a4a')
                out.px_(sx, sy - 1, '#1e4a4a'); out.px_(sx, sy + 1, '#1e4a4a')
    for x in range(0, w, 3):
        out.px_(x, 3, BRASS[1]); out.px_(x, h - 4, BRASS[1])
    for y in range(0, h, 3):
        out.px_(3, y, BRASS[1]); out.px_(w - 4, y, BRASS[1])
    return out


# ------------------------------------------------------------------------------------ map
def build() -> Map:
    m = Map('club', W, H, 'indoor', name='Клуб', ambient=0.32, music='yard')
    shell(m, 'brick', 'planks', face=2, door=(5, 2), out_to='square', out_at='club', floor_seed=4)
    g = m.ground
    r = rng('club-floor')
    m.stamp(wallpaper((W - 2) * T, 29), T, T)
    # the dark parquet over the shell's floor: keep the door mat, redraw the contact shadows
    mat = g.crop(5 * T + 1, (H - 2) * T + 3, 2 * T - 2, 12)
    m.stamp(parquet((W - 2) * T, (H - 4) * T), T, 3 * T)
    m.stamp(mat, 5 * T + 1, (H - 2) * T + 3)
    g.rect_(T, 3 * T, (W - 2) * T, 3, '#000000', 0.3); g.rect_(T, 3 * T + 3, (W - 2) * T, 2, '#000000', 0.12)
    g.rect_(T, 3 * T, 3, (H - 4) * T, '#000000', 0.22); g.rect_((W - 1) * T - 3, 3 * T, 3, (H - 4) * T, '#000000', 0.22)

    # --- floor: the casino carpet from the door to the table, chips and confetti dropped
    m.stamp(casino_carpet(8 * T, 7 * T), 2 * T, 5 * T + 8)
    litter(g, r, 'chip', 8, (3 * T, 7 * T, 9 * T, 12 * T))
    litter(g, r, 'confetti', 30, (7 * T, 5 * T, 11 * T, 8 * T))
    litter(g, r, 'butt', 6, (T, 5 * T, 11 * T, 12 * T))

    # --- north wall: the back bar under the cocktail neon, «КЛУБ» over the croupier, the
    #     curtains behind the stage, sconces
    m.stamp(bar_shelf(), T + 1, 2 * T - 2)
    m.put('club.cocktail', [cocktail_neon(i) for i in range(2)], 2 * T + 12, T + 1, base=3 * T, fps=1.2)
    m.light(3 * T + 4, 2 * T, 30, '#4fe8ff', 'neon')
    sign = [neon_sign(i) for i in range(12)]
    m.put('club.neon', sign, 6 * T - sign[0].w // 2, T + 1, base=3 * T, fps=6)
    m.light(6 * T, 2 * T + 8, 72, '#ff5ec4', 'neon')
    m.stamp(curtains(), 7 * T + 8, T + 1)
    m.put('club.sconce', sconce(), 4 * T + 6, T + 12, base=3 * T)
    m.put('club.sconce', sconce(), 7 * T + 2, T + 12, base=3 * T)

    # --- the bar and its stools (north-west)
    m.put('club.bar', bar_counter(), T, 5 * T - 28 + 2, solid=(1, 3.5, 4.5, 4.8))
    m.light(2 * T + 8, 4 * T + 4, 36, '#ffc080', 'lamp')
    st = stool_round(['#3a0e18', '#5c1624', '#842230', '#ab3440', '#cf5a5e'])
    for x in (T + 6, 2 * T + 10, 3 * T + 14):
        m.put('club.stool', st, x, 6 * T - 15, solid=(x / T + 0.1, 5.5, x / T + 0.6, 5.9))

    # --- the stage (north-east): platform, piano, microphone, rope, the mirror ball above
    sg = stage()
    m.put('club.stage', sg, 7 * T + 8, 5 * T + 4 - sg.h, solid=(7.5, 3, 11, 5.2))
    m.put('club.piano', piano(), 11 * T - 25, 3 * T + 16 - 26, base=5 * T + 5)
    m.put('club.mic', mic_stand(), 9 * T - 6, 4 * T + 8 - 23, base=5 * T + 5)
    m.put('club.rope', velvet_rope(54), 7 * T + 8, 6 * T - 16, solid=(7.5, 5.5, 11, 6))
    # the mirror ball hangs high in front of the curtains (at floor height it read as a lollipop)
    m.put('club.ball', [mirror_ball(i, cord=10) for i in range(4)], 8 * T + 2, T + 1, layer='top', fps=4)
    m.light(9 * T + 4, 4 * T + 8, 44, '#ffe0a0', 'lamp')
    m.emit('dust', 9 * T + 4, 4 * T, 0.3)

    # --- the cashier's credenza under the sign, the card table and the croupier, the lamp over him
    m.put('club.cashier', cashier(), 6 * T - 20, 69 - 22, solid=(4.8, 3.6, 7.2, 4.3))
    m.put('club.table', card_table(), 6 * T - 30, 8 * T - 32 - 2, solid=(4.2, 6.6, 7.8, 7.6))
    m.npc('croupier', 'croupier', 6.0, 6.1, face=0, anim='work', name='Крупье')
    m.put('club.lamp', pool_lamp(14), 6 * T - 14, 62, layer='top')
    m.light(6 * T, 7 * T, 52, '#ffe8b0', 'lamp')
    m.emit('smoke', 6 * T + 10, 6 * T + 2, 0.25)

    # --- the bank of slot machines (west) with their glows
    bodies = [(['#3a0c10', '#6a1a1e', '#9a2a2a', '#c84a3a', '#e8806a'], '#ff6a4a'),
              (['#0c1a3a', '#1a3060', '#2a4a8a', '#4a70b8', '#7aa0e0'], '#6ab0ff'),
              (['#0c2a1a', '#1a4a2a', '#2a6a3a', '#4a9a5a', '#80c888'], '#6aff9a')]
    for i, (body, glow) in enumerate(bodies):
        fr = [slot_machine(body, f, seed=i) for f in range(6)]
        x = T + 1 + i * 17
        m.put(f'club.slot{i}', fr, x, 10 * T - 32, fps=8, phase=i * 0.33, solid=(x / T, 9.2, x / T + 1, 10))
        m.light(x + 8, 9 * T, 20, glow, 'glow')
    m.emit('motes', 2 * T + 12, 9 * T - 4, 0.5)

    # --- east: the lounge (two armchairs, a cocktail table), dice, the jukebox, the gold machine
    m.put('club.armchair', armchair(), 8 * T + 2, 8 * T - 15 + 2, solid=(8.1, 7.3, 9, 8))
    m.put('club.cocktail_table', cocktail_table(), 9 * T + 2, 8 * T - 17 + 4, solid=(9.1, 7.5, 9.9, 8.2))
    m.put('club.armchair', armchair(), 10 * T - 2, 8 * T - 15 + 2, solid=(9.9, 7.3, 10.9, 8))
    m.light(9 * T + 8, 7 * T + 6, 16, '#ff8a6a', 'candle')
    m.put('club.roulette', [roulette(i) for i in range(8)], 8 * T, 10 * T - 18, fps=10, solid=(8, 9.4, 9.3, 10))
    m.put('club.dice', dice_table(), T + 8, 8 * T - 16 - 2, solid=(1.5, 7.2, 2.6, 7.9))
    jb = [jukebox(i) for i in range(6)]
    m.put('club.jukebox', jb, 10 * T - 4, 10 * T - 30, fps=5, solid=(9.8, 9.2, 11, 10))
    m.light(10 * T + 6, 9 * T, 26, '#ff9a5a', 'glow')
    gold = ['#3a2a0a', '#6a4a14', '#a07820', '#d0a840', '#f0d880']
    m.put('club.slotgold', [slot_machine(gold, f, seed=7) for f in range(6)], 10 * T - 2, 12 * T - 32 + 2,
          fps=8, phase=0.5, solid=(9.9, 11.3, 10.9, 12))
    m.light(10 * T + 6, 11 * T + 4, 20, '#ffd060', 'glow')

    # --- by the door: palms, the cigarette machine
    m.put('club.cig', cig_machine(), T + 2, 12 * T - 30 + 2, solid=(1.1, 11.3, 2.1, 12))
    m.put('club.palm', potted('palm', BRASS, seed=2), 3 * T + 4, 12 * T - 26 + 2, solid=(3.3, 11.4, 4.3, 12))
    m.put('club.palm2', potted('palm', BRASS, seed=9), 7 * T + 2, 12 * T - 26 + 2, solid=(7.1, 11.4, 8.1, 12))
    m.marks['croupier'] = (6.0, 6.1)
    return m
