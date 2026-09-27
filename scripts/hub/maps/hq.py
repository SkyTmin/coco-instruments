"""Штаб изнутри (v2.80) — the camp HQ, the chief's office.

12 × 14 tiles, a Soviet office: whitewashed walls over a green-painted dado, worn linoleum in a
checker, a red runner from the door to the chief's desk. The chief (Начальник) stands behind a
big walnut desk under green baize — the green-glass lamp, the typewriter, the black phone, papers,
the stamp, a glass of tea in its holder. Behind his shoulder the red banner on its staff, over
it the portrait of the camp's first chief. On the north wall the Доска почёта (achievements:
portraits and stars), the «НАВЫКИ» poster (the skill tree) and the camp map; the clock ticks.
Along the walls the safe, a filing cabinet with a fan turning on it, the glass cabinet of finds
(cups, a medal, a gem, ore, the gold key), a bookcase of red volumes, a chess game left
mid-way, a leather sofa, a carafe on its table, a globe, ficuses, a coat rack, muddy boot
prints up the runner. The chief, his desk, the runner and the door all stand on x = 7.

Lessons from the critique rounds (keep them):
  * the north row is planned WITH the wall: whatever stands on the first floor row must be
    shorter than (its base − the wall's bottom edge), or it covers the wall art; tall cabinets
    go where the wall is blank or along the side walls (the first draft's banner hid half of
    «ДОСКА ПОЧЁТА» and the board ran under the portrait — sum the widths before placing);
  * a resident behind a desk: NA characters are chibi — the face sits low in the 16 px frame,
    so the desk's top edge must be at his feet, and nothing taller than a sheet of paper may
    stand in the desk's middle (the typewriter and a tea glass hid the chief completely);
  * a round wooden foot of a flag staff peeking over a desk reads as a brown blob — a small
    dark iron cross-foot reads as a stand;
  * kit's 3 × 5 «Д» is an «А» («АОСКА ПОЧЕТА») — `art_town.sign_text` draws it with a descender;
  * a coat hung square on the pole with the cap on top is a headless soldier — hang it lopsided
    from one hook, the cap on another;
  * NA's graded GoldCup/SilverCup turn into orange-and-white blobs on a dark shelf — own cups
    with handles and a stepped foot; a bust at 16 px reads as a vase (replaced by chess);
  * a ceiling lamp's cord must not cross the desk front (it read as a pendulum off the desk) —
    hang it mid-room with a short cord.
"""
from __future__ import annotations

import math

from art_town import BRASS, CHROME, box3, chair_back, glass_cup, litter, potted, runner, sign_text
from kit import INK, P, ink, shell, text
from lib import T, Img, Map, camp, grid, na, outline, ramp, rng

W, H = 12, 14

WAL = ['#2e1a16', '#4a2a20', '#673a28', '#8a5234', '#aa6e48']            # desk walnut
BAIZE = ['#1a3424', '#244a32', '#306040', '#3e7650', '#5a9068']
DADO = ['#2e4a42', '#3a5a50', '#4a6e62', '#5e8476', '#789c8c']           # green-painted lower wall
RED = ['#4a1014', '#7a1a1e', '#a82828', '#cc3c34', '#e8645a']
OFFICE_STEEL = ['#2a302c', '#3c4640', '#56625a', '#74827a', '#98a49a']   # olive-grey metal furniture


# ------------------------------------------------------------------------------------ art
def wall_paint(w: int, h: int) -> Img:
    """The dado: green oil paint up to shoulder height, a dark red-brown stripe on top of it, a
    few chips where the plaster shows. Stamped over the lower wall face."""
    out = Img.new(w, h)
    out.rect_(0, 0, w, h, DADO[2])
    out.rect_(0, 0, w, 1, '#5a2a22'); out.rect_(0, 1, w, 1, '#7a3a2e')     # the stripe
    out.rect_(0, 2, w, 1, DADO[3])
    r = rng('dado')
    for _ in range(w // 14):
        x = r.randrange(0, w - 3)
        out.rect_(x, r.randrange(4, h - 1), r.randrange(2, 4), 1, P['plaster'][3])
    for x in range(0, w, 32):
        out.rect_(x + r.randrange(0, 20), 3, 1, h - 3, DADO[1])            # brush streaks
    return out


def desk() -> Img:
    """The chief's desk: walnut with a green baize top, front panels facing the visitor; on it
    the green-glass lamp, papers and folders, the stamp, a glass of tea in its holder, the
    typewriter (its sheet up) and the black phone. 64 × 38; the middle (x 24–40, where the chief
    stands) holds only flat papers — anything taller there covers his face."""
    w, h = 64, 38
    out = Img.new(w, h)
    ty = 12                                   # the top's back edge
    # top: walnut rim, baize inset
    out.rect_(0, ty, w, 10, WAL[3]); out.rect_(0, ty, w, 1, WAL[4])
    out.rect_(2, ty + 2, w - 4, 6, BAIZE[2]); out.rect_(2, ty + 2, w - 4, 1, BAIZE[1])
    out.rect_(2, ty + 7, w - 4, 1, BAIZE[3])
    # front: two pedestals and the recessed modesty panel between
    fy = ty + 10
    out.rect_(0, fy, w, h - fy, WAL[2])
    out.rect_(0, fy, w, 1, WAL[1])
    out.rect_(15, fy + 1, w - 30, h - fy - 3, WAL[1])                       # the recess
    for x0 in (1, w - 14):
        out.rect_(x0 + 1, fy + 2, 11, h - fy - 5, WAL[3])                    # raised panels
        out.rect_(x0 + 2, fy + 3, 9, h - fy - 7, WAL[2])
        out.rect_(x0 + 1, fy + 2, 11, 1, WAL[4])
    out.rect_(17, fy + 3, w - 34, h - fy - 7, WAL[2]); out.rect_(17, fy + 3, w - 34, 1, WAL[3])
    out.rect_(0, h - 2, w, 2, WAL[0])
    out = ink(out)
    # --- on the top
    # the green lamp: brass foot and stem, a half-cylinder of green glass, light spilling under it
    lamp = Img.new(12, 13)
    lamp.rect_(3, 10, 6, 3, BRASS[2]); lamp.rect_(3, 10, 6, 1, BRASS[4])
    lamp.rect_(5, 5, 1, 5, BRASS[3]); lamp.rect_(6, 5, 1, 5, BRASS[1])
    lamp.ellipse_(6, 4, 6, 3.4, '#1e6a3a')
    lamp.rect_(0, 4, 12, 3, '#1e6a3a')
    lamp.ellipse_(5, 3, 4.6, 2.2, '#3aa05a'); lamp.rect_(2, 2, 4, 1, '#8ae0a0')
    lamp.rect_(1, 6, 10, 1, '#ffeaa8')
    out.paste_(outline(lamp, INK), 1, ty - 12)
    out.rect_(3, ty + 2, 8, 3, '#7ab070')                                   # its pool of light on the baize
    # the typewriter, its sheet standing up — left of the chief
    tw = Img.new(12, 9)
    tw.rect_(3, 0, 6, 4, '#f2eee4'); tw.rect_(4, 1, 4, 1, '#9a948a')
    tw.rect_(0, 3, 12, 2, '#2a2c2e'); tw.rect_(0, 3, 12, 1, '#5a5e62')
    tw.rect_(0, 5, 12, 4, '#3a3e42'); tw.rect_(1, 6, 10, 1, '#c8c4b8'); tw.rect_(2, 7, 8, 1, '#a8a498')
    out.paste_(outline(tw, INK), 12, ty - 3)
    # the middle stays flat: an open folder of papers, the stamp and its pad
    out.rect_(26, ty + 3, 11, 5, '#c8a868'); out.rect_(26, ty + 3, 11, 1, '#e0c488')
    out.rect_(27, ty + 4, 4, 3, '#f2eee0'); out.rect_(32, ty + 4, 4, 3, '#f2eee0')
    out.rect_(28, ty + 5, 2, 1, '#9a948a'); out.rect_(33, ty + 5, 2, 1, '#9a948a')
    out.rect_(39, ty + 5, 4, 2, '#1a1a2a'); out.rect_(40, ty + 3, 2, 3, WAL[1]); out.px_(40, ty + 2, WAL[3])
    # the glass of tea in its holder
    out.rect_(45, ty - 1, 3, 4, '#c87a30'); out.rect_(45, ty - 1, 1, 4, '#e8a860')
    out.rect_(44, ty + 2, 5, 2, CHROME[2]); out.px_(48, ty + 1, CHROME[2])
    # the black phone: cradle, the handset across it, the white dial
    ph = Img.new(8, 6)
    ph.rect_(0, 2, 8, 4, '#1c1c20'); ph.rect_(1, 2, 6, 1, '#3a3a40')
    ph.rect_(0, 0, 8, 2, '#141418'); ph.rect_(1, 0, 6, 1, '#4a4a52')
    ph.ellipse_(4, 4, 1.8, 1.2, '#e8e4d8'); ph.px_(4, 4, INK)
    out.paste_(outline(ph, INK), 50, ty - 1)
    # a pile of folders on the right corner
    for k, c in enumerate(('#c8a868', '#a88a4e', '#d0b070')):
        out.rect_(57 - k % 2, ty + 5 - k * 2, 6, 2, c); out.rect_(57 - k % 2, ty + 5 - k * 2, 6, 1, '#e8d49a')
    return out


def honour_board() -> Img:
    """ДОСКА ПОЧЁТА: a red board in a varnished frame, gold lettering, two rows of little photos
    of the best, a gold star over each of the first row and a big star in the middle. 54 × 30."""
    w, h = 54, 30
    out = Img.new(w, h)
    out.rect_(0, 0, w, h, WAL[2]); out.rect_(0, 0, w, 1, WAL[4]); out.rect_(0, 0, 1, h, WAL[3])
    out.rect_(0, h - 1, w, 1, WAL[0]); out.rect_(w - 1, 0, 1, h, WAL[1])
    out.rect_(2, 2, w - 4, h - 4, RED[2])
    out.rect_(2, 2, w - 4, 1, RED[1])
    out.rect_(2, 10, w - 4, 1, BRASS[2])
    t = sign_text('ДОСКА ПОЧЁТА', BRASS[4], '#5a1010')
    out.paste_(t, (w - t.w) // 2 + 1, 3)
    hair = ['#2a1c14', '#5a3a1c', '#8a8478', '#1a1a1a', '#6a4a2a', '#c8a060', '#2a1c14', '#3a2a20', '#5a3a1c', '#1a1a1a', '#8a8478', '#2a1c14']
    for row in range(2):
        for i in range(6):
            x = 4 + i * 8
            y = 12 + row * 9
            out.rect_(x, y, 6, 7, '#efe8d4')                                 # the photo card
            out.rect_(x + 1, y + 1, 4, 5, '#8a8272')                         # sepia ground
            out.rect_(x + 2, y + 2, 2, 2, SKIN_S[1]); out.px_(x + 2, y + 2, SKIN_S[2])
            out.rect_(x + 1, y + 1, 4, 1, hair[row * 6 + i])
            out.rect_(x + 1, y + 4, 4, 2, '#3a3e4a' if (i + row) % 2 else '#4a4a3a')
            if row == 0 and i % 2 == 0:
                out.px_(x + 5, y - 1, BRASS[4]); out.px_(x + 4, y - 1, BRASS[3])
    # a star in each top corner of the header
    star = grid(['.#.', '###', '#.#'], {'#': BRASS[4]})
    out.paste_(star, 3, 4); out.paste_(star, w - 6, 4)
    return ink(out)


SKIN_S = ['#8a5a44', '#c89070', '#e8b490']


def skills_poster() -> Img:
    """«НАВЫКИ»: a printed poster, red title band, a skill tree — a root node and branches of
    round nodes joined by lines, the learned ones filled gold, the locked ones hollow. 27 × 24."""
    w, h = 25, 24
    out = Img.new(w, h)
    out.rect_(0, 0, w, h, P['paper'][3]); out.rect_(0, h - 1, w, 1, P['paper'][1])
    out.rect_(0, 0, w, 8, RED[2]); out.rect_(0, 7, w, 1, RED[1])
    t = text('НАВЫКИ', '#fff4e0', RED[0])
    out.paste_(t, (w - t.w) // 2 + 1, 1)
    nodes = {'root': (12, 20), 'a': (5, 15), 'b': (12, 14), 'c': (19, 15), 'a2': (4, 10), 'b2': (12, 10),
             'c2': (20, 10)}
    edges = [('root', 'a'), ('root', 'b'), ('root', 'c'), ('a', 'a2'), ('b', 'b2'), ('c', 'c2')]
    for a, b in edges:
        (x0, y0), (x1, y1) = nodes[a], nodes[b]
        out.line_(x0, y0, x1, y1, '#6a5a48')
    learned = {'root', 'a', 'b', 'b2', 'c'}
    for k, (x, y) in nodes.items():
        if k in learned:
            out.ellipse_(x + 0.5, y + 0.5, 2, 2, BRASS[3]); out.px_(x, y, BRASS[4])
        else:
            out.ellipse_(x + 0.5, y + 0.5, 2, 2, '#6a5a48'); out.px_(x, y, P['paper'][3])
    out = ink(out)
    out.px_(1, 0, '#b8b0a0'); out.px_(w - 2, 0, '#b8b0a0')                  # pins
    return out


def camp_map() -> Img:
    """The camp map on the wall: a blueprint-pale sheet in a thin frame, the fence as a red dashed
    square with towers at the corners, barracks as grey blocks, the square in the middle, the pit
    of the mine as a dark ring, pins stuck in. 36 × 24."""
    w, h = 36, 24
    out = Img.new(w, h)
    out.rect_(0, 0, w, h, WAL[1]); out.rect_(1, 1, w - 2, h - 2, '#d8d4bc')
    out.rect_(1, 1, w - 2, 1, '#eeead4')
    # the grid of the sheet
    for x in range(5, w - 1, 6):
        out.rect_(x, 2, 1, h - 3, '#c8c4aa')
    for y in range(5, h - 1, 6):
        out.rect_(2, y, w - 3, 1, '#c8c4aa')
    # fence: dashed red rectangle
    for x in range(4, w - 4):
        if x % 3:
            out.px_(x, 3, RED[2]); out.px_(x, h - 4, RED[2])
    for y in range(3, h - 3):
        if y % 3:
            out.px_(4, y, RED[2]); out.px_(w - 5, y, RED[2])
    for x, y in ((3, 2), (w - 6, 2), (3, h - 5), (w - 6, h - 5)):
        out.rect_(x, y, 3, 3, '#4a4a4a')
    # buildings and the square
    for x, y, bw, bh in ((7, 5, 7, 3), (7, 10, 7, 3), (22, 5, 7, 3), (22, 15, 7, 3), (7, 15, 5, 3)):
        out.rect_(x, y, bw, bh, '#7a7e84'); out.rect_(x, y, bw, 1, '#9aa0a6')
    out.rect_(15, 9, 6, 6, '#e8e2c8')
    out.ellipse_(27.5, 11.5, 2.2, 2.2, '#3a3430'); out.ellipse_(27.5, 11.5, 1.1, 1.1, '#8a7a60')
    out.line_(18, 14, 18, h - 4, '#a89878')
    # pins
    for x, y, c in ((10, 6, '#e8483a'), (26, 11, '#3a6ae8'), (18, 11, '#f2d04a')):
        out.px_(x, y, c); out.px_(x, y - 1, '#ffffff')
    return ink(out)


def portrait() -> Img:
    """The portrait of the camp's first chief: a heavy gilt frame, a dark ground, a stern man in
    a peaked cap and a tunic with a red collar tab. 14 × 18."""
    w, h = 14, 18
    out = Img.new(w, h)
    out.rect_(0, 0, w, h, BRASS[2]); out.rect_(0, 0, w, 1, BRASS[4]); out.rect_(0, 0, 1, h, BRASS[3])
    out.rect_(w - 1, 0, 1, h, BRASS[1]); out.rect_(0, h - 1, w, 1, BRASS[1])
    out.rect_(2, 2, w - 4, h - 4, '#2e2a26')
    # shoulders and tunic
    out.rect_(3, 12, 8, 4, '#4a5040'); out.rect_(3, 12, 8, 1, '#5e6650')
    out.rect_(6, 12, 2, 2, SKIN_S[0]); out.px_(5, 12, RED[3]); out.px_(8, 12, RED[3])
    # face
    out.rect_(5, 7, 4, 5, SKIN_S[1]); out.rect_(5, 7, 1, 5, SKIN_S[2])
    out.px_(5, 9, INK); out.px_(8, 9, INK); out.rect_(6, 10, 2, 1, '#6a4030')           # eyes, moustache
    # cap: crown, band, star, peak
    out.rect_(4, 4, 6, 2, '#3e4636'); out.rect_(4, 6, 6, 1, RED[2]); out.px_(7, 5, BRASS[4])
    out.rect_(4, 7, 6, 1, '#1a1a18')
    return ink(out)


def office_clock(frame: int = 0) -> Img:
    """A round office clock: a steel rim, a white face with the twelve marks, the hour and minute
    hands, and a red second hand that steps round by frame (8 frames at 1 fps). 11 × 11."""
    out = Img.new(11, 11)
    out.ellipse_(5.5, 5.5, 5.5, 5.5, CHROME[1])
    out.ellipse_(5.5, 5.5, 4.4, 4.4, '#f4f2ea')
    for a in range(0, 360, 90):
        t = math.radians(a)
        out.px_(int(5.5 + math.cos(t) * 3.6), int(5.5 + math.sin(t) * 3.6), INK)
    out.line_(5, 5, 5, 2, INK); out.line_(5, 5, 7, 6, INK)
    t = math.radians(frame * 45 - 90)
    out.line_(5, 5, int(round(5 + math.cos(t) * 3.4)), int(round(5 + math.sin(t) * 3.4)), '#d8382e')
    out.px_(5, 5, '#d8382e')
    out.px_(3, 2, '#ffffff')
    return outline(out, INK)


def red_flag() -> Img:
    """The red banner on its staff: a varnished pole with a gilt spearhead, the crimson cloth
    hanging from a crossbar in deep folds, a gold star and a gold fringe, a heavy round foot.
    22 × 46; the staff stands at the right, the cloth falls to its left."""
    w, h = 22, 46
    out = Img.new(w, h)
    # the foot: a small dark iron cross (a round wooden one read as a brown blob over the desk)
    out.rect_(13, h - 3, 9, 2, '#26282c'); out.rect_(15, h - 4, 5, 1, '#3a3e44'); out.px_(13, h - 3, '#4a4e56')
    # the staff
    out.rect_(16, 5, 2, h - 8, WAL[3]); out.rect_(16, 5, 1, h - 8, WAL[4])
    out.poly_([(17, 0), (19, 4), (17, 6), (15, 4)], BRASS[3]); out.px_(16, 2, BRASS[4])
    out.rect_(15, 6, 4, 1, BRASS[2])
    # crossbar and the cloth: folds as vertical bands lit on the left, a slanted hem
    out.rect_(2, 7, 15, 1, BRASS[2])
    cy0 = 8
    out.poly_([(2, cy0), (16, cy0), (16, 33), (9, 36), (2, 34)], RED[2])
    for x in (2, 7, 12):
        out.poly_([(x, cy0), (x + 2, cy0), (x + 2, 34), (x, 34)], RED[3])
        out.rect_(x + 4, cy0, 1, 25, RED[1])
    out.rect_(2, cy0, 14, 1, RED[4])
    # gold star
    st = grid(['..#..', '.###.', '#####', '.###.', '.#.#.'], {'#': BRASS[4]})
    out.paste_(st, 5, 12)
    # fringe along the hem
    for x in range(2, 17):
        y = 34 + (0 if x < 9 else -1) + (1 if 7 < x < 12 else 0)
        out.rect_(x, y, 1, 2 + (x % 2), BRASS[3])
    return outline(out, INK).crop(1, 1, w, h)


def safe() -> Img:
    """A heavy steel safe: rounded body, a lit top, the door with its hinges, a combination dial,
    a spoked handle and a brass maker's plate, on four stubby feet. 22 × 26."""
    w, h = 22, 26
    st = OFFICE_STEEL
    out = Img.new(w, h)
    out.rect_(1, h - 3, 3, 3, st[0]); out.rect_(w - 4, h - 3, 3, 3, st[0])
    body = Img.new(w, h - 2)
    body.rect_(0, 0, w, h - 2, st[2]); body.rect_(0, 0, w, 5, st[3]); body.rect_(0, 0, w, 1, st[4])
    body.rect_(0, 5, w, 1, st[1])
    body.rect_(2, 7, w - 4, h - 11, st[2]); body.rect_(2, 7, w - 4, 1, st[4]); body.rect_(2, 7, 1, h - 11, st[3])
    body.rect_(w - 3, 7, 1, h - 11, st[1]); body.rect_(2, h - 5, w - 4, 1, st[1])
    body.rect_(3, 9, 1, 3, st[0]); body.rect_(3, 16, 1, 3, st[0])                    # hinges
    body.ellipse_(11, 12, 3.4, 3.4, st[1]); body.ellipse_(11, 12, 2.4, 2.4, CHROME[3])  # the dial
    body.px_(11, 10, INK); body.px_(12, 11, CHROME[4])
    body.rect_(15, 11, 3, 1, CHROME[2]); body.rect_(16, 10, 1, 3, CHROME[2])          # the handle
    body.rect_(8, 17, 6, 2, BRASS[3]); body.rect_(8, 17, 6, 1, BRASS[4])
    out.paste_(ink(body), 0, 0)
    return out


def table_fan(frame: int = 0) -> Img:
    """A black table fan in a wire cage, blades turning (4 frames), on a round foot. 11 × 13."""
    out = Img.new(11, 13)
    out.ellipse_(5.5, 11.5, 4, 1.5, '#1c1c20'); out.rect_(5, 8, 1, 4, '#2a2a30')
    out.ellipse_(5.5, 5, 5.5, 5, '#3a3a42')
    out.ellipse_(5.5, 5, 4.5, 4.5, '#5a6068')
    a0 = frame * 30
    for k in range(3):
        t = math.radians(a0 + k * 120)
        for rr in (1, 2, 3, 4):
            out.px_(int(round(5.5 + math.cos(t) * rr - 0.5)), int(round(5 + math.sin(t) * rr - 0.5)), '#c8ccd0' if rr > 1 else '#8a9098')
    out.px_(5, 4, '#1c1c20')
    for x in (1, 3, 8, 10):
        out.px_(x, 5, '#2a2a30')
    return outline(out, INK)


def filing_cabinets() -> Img:
    """Two olive-grey filing cabinets side by side, four drawers each with a pull and a white
    label card, one drawer of the right one pulled out a little. 30 × 28."""
    out = Img.new(30, 28)
    st = OFFICE_STEEL
    for i, x in enumerate((0, 15)):
        c = box3(15, 28, 3, st)
        for k in range(4):
            y = 4 + k * 6
            c.rect_(2, y, 11, 5, st[2]); c.rect_(2, y, 11, 1, st[3]); c.rect_(2, y + 4, 11, 1, st[1])
            c.rect_(6, y + 2, 3, 1, CHROME[3]); c.rect_(5, y + 1, 2, 1, '#eeeade')
        if i == 1:
            c.rect_(2, 10, 11, 5, st[3]); c.rect_(2, 14, 11, 1, INK)
            c.rect_(4, 9, 7, 1, '#e8e2d0')                                  # papers sticking out
        out.paste_(c, x, 0)
    return out


def radiator() -> Img:
    """A cast-iron radiator under the wall: a row of ribbed sections painted cream, pipes. 34 × 12."""
    w, h = 34, 12
    out = Img.new(w, h)
    for i, x in enumerate(range(1, w - 1, 4)):
        out.rect_(x, 1, 3, h - 2, '#b8b09a'); out.rect_(x, 1, 1, h - 2, '#d8d0b8'); out.rect_(x + 2, 1, 1, h - 2, '#8a8270')
        out.rect_(x, 0, 3, 1, '#e0d8c0')
    out.rect_(0, 3, w, 1, '#8a8270'); out.rect_(0, h - 3, w, 1, '#8a8270')
    out.rect_(0, h - 2, 2, 2, '#6a645a'); out.rect_(w - 2, h - 2, 2, 2, '#6a645a')
    return ink(out)


def trophy_cabinet() -> Img:
    """The cabinet of finds: a walnut case with a glass front, three shelves of trophies — gold
    and silver cups, a medal on its ribbon, a red gem, an ore chunk, a pennant. 28 × 38."""
    w, h = 28, 38
    out = Img.new(w, h)
    out.rect_(0, 0, w, h, WAL[2]); out.rect_(0, 0, w, 3, WAL[3]); out.rect_(0, 0, w, 1, WAL[4])
    out.rect_(0, 3, 1, h - 3, WAL[3]); out.rect_(w - 1, 0, 1, h, WAL[1])
    out.rect_(2, 4, w - 4, h - 8, '#2a3a3c')                                # the glass, dark inside
    out.rect_(2, 4, w - 4, 1, '#1a2426')
    for y in (15, 25):
        out.rect_(2, y, w - 4, 1, WAL[3])
    out.rect_(0, h - 4, w, 4, WAL[1]); out.rect_(0, h - 4, w, 1, WAL[3])
    out = ink(out)
    # top shelf: a big gold cup, a medal on its ribbon, a silver cup
    out.paste_(cup(BRASS, 9), 2, 5)
    out.paste_(cup(['#3a3e44', '#5e646c', '#8a929a', '#b8c0c6', '#e8eef0'], 7), 18, 7)
    out.rect_(13, 5, 2, 5, RED[3]); out.rect_(14, 5, 1, 5, RED[1])
    out.ellipse_(14, 12, 2, 2, BRASS[3]); out.px_(13, 11, BRASS[4])
    # middle shelf: a red gem on a brass stand, an ore chunk flecked with gold
    out.poly_([(4, 20), (7, 17), (10, 20), (7, 23)], '#c8323a'); out.poly_([(4, 20), (7, 17), (7, 20)], '#e8585a')
    out.px_(6, 18, '#ffc0c0')
    out.rect_(5, 23, 5, 2, BRASS[2])
    out.ellipse_(18, 22, 5, 3, '#5a524a'); out.ellipse_(17.5, 21.5, 4, 2, '#7a7268')
    out.px_(16, 21, BRASS[4]); out.px_(19, 22, BRASS[4]); out.px_(20, 21, '#6ad0e0')
    # bottom shelf: a pennant on a little staff and the gold key
    out.poly_([(5, 27), (5, 33), (12, 30)], RED[3]); out.rect_(4, 26, 1, 8, WAL[3])
    out.paste_(camp(na('Items/Treasure/GoldKey.png'), sat=0.9), 14, 29)
    out.rect_(13, 4, 1, h - 8, WAL[2])                                      # the doors' meeting stile
    for k in range(2):                                                       # a glint on the glass
        out.line_(20 + k, 5, 25 + k, 12, '#ffffff', 0.25)
    return out


def cup(r: list[str], hgt: int = 9) -> Img:
    """A trophy cup: a wide bowl with two looping handles, a stem, a stepped foot. (hgt + 2) wide."""
    w = hgt + 2
    out = Img.new(w, hgt)
    bh = hgt // 2
    out.poly_([(2, 0), (w - 2, 0), (w - 3, bh), (3, bh)], r[2])
    out.poly_([(2, 0), (5, 0), (4, bh), (3, bh)], r[3])
    out.rect_(2, 0, w - 4, 1, r[4])
    out.px_(0, 1, r[2]); out.px_(0, 2, r[2]); out.px_(1, 3, r[2])                     # handles
    out.px_(w - 1, 1, r[1]); out.px_(w - 1, 2, r[1]); out.px_(w - 2, 3, r[1])
    out.rect_(w // 2 - 1, bh, 2, hgt - bh - 2, r[2])
    out.rect_(3, hgt - 2, w - 6, 2, r[1]); out.rect_(3, hgt - 2, w - 6, 1, r[3])
    return outline(out, INK)


def bookcase() -> Img:
    """A bookcase of collected works: rows of red and maroon volumes with gold bands, one shelf
    of blue, a few leaning. 24 × 34."""
    w, h = 24, 34
    out = Img.new(w, h)
    out.rect_(0, 0, w, h, WAL[2]); out.rect_(0, 0, w, 3, WAL[3]); out.rect_(0, 0, w, 1, WAL[4])
    out.rect_(0, 3, 1, h - 3, WAL[3])
    out.rect_(2, 4, w - 4, h - 7, WAL[0])
    r = rng('books')
    for s, y0 in enumerate((4, 14, 24)):
        x = 2
        while x < w - 3:
            bw = r.choice([2, 2, 3])
            bh = r.choice([8, 9, 9])
            c = ramp(r.choice(['#8a2226', '#7a1e2a', '#9a3026']) if s != 1 else r.choice(['#2a3e6a', '#344a78']), 3, 0.3)
            out.rect_(x, y0 + 9 - bh, bw, bh, c[1]); out.rect_(x, y0 + 9 - bh, 1, bh, c[2])
            out.rect_(x, y0 + 9 - bh + 2, bw, 1, BRASS[3])
            x += bw
        out.rect_(2, y0 + 9, w - 4, 1, WAL[3])
    out.rect_(0, h - 3, w, 3, WAL[1])
    return ink(out)


def sofa() -> Img:
    """A black leather sofa, buttoned back, rolled arms, the seat's lit top. 38 × 20."""
    w, h = 38, 20
    lc = ['#141416', '#222226', '#34343a', '#4c4c54', '#6a6a74']
    out = Img.new(w, h)
    out.rect_(3, 0, w - 6, 10, lc[2]); out.rect_(3, 0, w - 6, 1, lc[4])     # the back
    for x in range(7, w - 6, 6):
        for y in (3, 7):
            out.px_(x + (y // 4) % 2 * 3, y, lc[0])
    out.rect_(3, 9, w - 6, 5, lc[3]); out.rect_(3, 9, w - 6, 1, lc[4])     # the seat
    out.rect_(3 + (w - 6) // 2, 9, 1, 5, lc[1])
    out.rect_(3, 14, w - 6, 3, lc[1])
    for x in (0, w - 5):                                                    # rolled arms
        out.rect_(x, 5, 5, 12, lc[2]); out.ellipse_(x + 2.5, 6, 2.5, 2, lc[3]); out.px_(x + 1, 5, lc[4])
    out.rect_(3, h - 3, 2, 3, WAL[1]); out.rect_(w - 5, h - 3, 2, 3, WAL[1])
    return ink(out)


def carafe_table() -> Img:
    """A little round table with a lace cloth, a glass carafe of water and a tumbler on a tray.
    16 × 22."""
    w, h = 16, 22
    out = Img.new(w, h)
    out.rect_(7, 12, 2, 8, WAL[2]); out.rect_(4, h - 2, 8, 2, WAL[1])
    out.ellipse_(8, 11, 8, 3, '#e8e4d8'); out.ellipse_(8, 10.5, 7, 2.2, '#f6f2e8')
    for x in range(1, 16, 2):
        out.px_(x, 13 + (x % 4 == 1), '#d8d2c0')
    out.ellipse_(8, 10.5, 5, 1.6, CHROME[3])
    out = outline(out, INK).crop(1, 1, w, h)
    cf = Img.new(7, 11)
    cf.rect_(2, 0, 3, 1, '#d8e4e4'); cf.rect_(2, 1, 3, 3, '#a8c0c4')
    cf.ellipse_(3.5, 7, 3.5, 3.6, '#9ab8bc'); cf.ellipse_(3, 7.5, 2.4, 2.4, '#6a98a8')
    cf.rect_(1, 5, 1, 3, '#e8f4f4')
    out.paste_(outline(cf, INK), 2, 0)
    out.paste_(glass_cup('#6a98a8'), 10, 5)
    return out


def globe() -> Img:
    """A globe on a turned stand: blue sea, green-brown land, the brass meridian ring. 14 × 20."""
    out = Img.new(14, 20)
    out.rect_(6, 13, 2, 5, WAL[3]); out.ellipse_(7, 18.5, 4, 1.4, WAL[1])
    out.ellipse_(7, 7, 6, 6, '#2e5a7a'); out.ellipse_(6.4, 6.4, 4.8, 4.8, '#3e76a0')
    for x, y, rx, ry in ((5, 4, 2.4, 1.6), (8.5, 8, 2, 2.6), (4, 9, 1.4, 1.2)):
        out.ellipse_(x, y, rx, ry, '#6a8a52')
    out.px_(4, 3, '#b8dcf0')
    for yy in range(14):
        t = yy / 13 * math.pi
        out.px_(int(7 + 6.6 * math.cos(t + math.pi / 2) * 0.2 + 6.3), int(7 - 6.6 * math.cos(t)), BRASS[3])
    return outline(out, INK)


def extinguisher() -> Img:
    """A red fire extinguisher with its black hose and a brass valve. 8 × 16."""
    out = Img.new(8, 16)
    out.rect_(1, 3, 6, 13, RED[2]); out.rect_(1, 3, 2, 13, RED[3]); out.rect_(6, 3, 1, 13, RED[1])
    out.ellipse_(4, 3, 3, 1.5, RED[3])
    out.rect_(3, 0, 2, 3, BRASS[2]); out.rect_(4, 0, 3, 1, '#1a1a1a')
    out.rect_(7, 1, 1, 8, '#1a1a1a')
    out.rect_(2, 7, 4, 3, '#e8e2d0')
    return ink(out)


def coat_rack() -> Img:
    """A bentwood coat rack: its finial and curled hooks well clear above everything, a
    greatcoat hung by its loop from one hook (narrow at the loop, sagging to one side), the
    peaked cap on another hook, a tripod foot. 18 × 36. (A coat squared on the pole with the cap
    on top read as a headless soldier — a coat on a hook hangs lopsided.)"""
    w, h = 18, 36
    out = Img.new(w, h)
    out.rect_(8, 1, 2, h - 4, WAL[3]); out.rect_(8, 1, 1, h - 4, WAL[4])
    out.ellipse_(9, 1, 1.6, 1.4, WAL[4])                                       # the finial
    out.line_(9, h - 4, 2, h - 1, WAL[2]); out.line_(9, h - 4, 16, h - 1, WAL[2]); out.line_(9, h - 4, 9, h - 1, WAL[1])
    for x0, x1 in ((8, 3), (10, 15)):                                          # curled hooks
        out.line_(x0, 5, x1, 3, WAL[3]); out.px_(x1, 2, WAL[3])
    # the greatcoat on the left hook: the loop, the collar folded over, the body sagging
    gc = ['#2e3428', '#40483a', '#56604c', '#6e7a60']
    out.poly_([(3, 4), (6, 7), (8, 18), (7, 29), (0, 30), (1, 16), (1, 7)], gc[2])
    out.poly_([(3, 4), (4, 7), (3, 29), (0, 30), (1, 16), (1, 7)], gc[3])
    out.line_(5, 9, 5, 28, gc[0])                                              # the front edge
    out.rect_(1, 18, 6, 1, gc[0])
    for y in (11, 15, 22):
        out.px_(6, y, BRASS[3])
    out.rect_(2, 5, 3, 3, gc[1])                                               # collar
    # the cap on the right hook, tipped
    out.rect_(12, 4, 6, 3, '#3e4636'); out.rect_(12, 4, 6, 1, '#56604c'); out.rect_(12, 7, 6, 1, RED[2])
    out.px_(15, 5, BRASS[4]); out.rect_(11, 8, 7, 1, '#1a1a18')
    return outline(out, INK).crop(1, 1, w, h)


def chess_table() -> Img:
    """A chess table with a game left mid-way: a walnut table whose top is the board (a checker
    seen at a slant), white and black men standing on it, the chess clock at the side, a stool
    on each side. 26 × 18. (Replaced a bronze bust: at 16 px a bust reads as a vase.)"""
    w, h = 26, 18
    out = Img.new(w, h)
    for x in (0, w - 6):                                                        # stools
        out.rect_(x, 8, 6, 3, WAL[3]); out.rect_(x, 8, 6, 1, WAL[4])
        out.rect_(x + 1, 11, 1, 6, WAL[2]); out.rect_(x + 4, 11, 1, 6, WAL[1])
    t = Img.new(16, 16)
    t.rect_(0, 0, 16, 9, WAL[2]); t.rect_(0, 0, 16, 1, WAL[4])
    for yy in range(4):
        for xx in range(7):
            t.rect_(1 + xx * 2, 1 + yy * 2, 2, 2, '#e6dcc0' if (xx + yy) % 2 else '#4a2e20')
    t.rect_(0, 9, 16, 3, WAL[1]); t.rect_(2, 12, 2, 4, WAL[2]); t.rect_(12, 12, 2, 4, WAL[1])
    t = ink(t)
    for x, y, c in ((3, 2, '#f4f0e6'), (6, 1, '#f4f0e6'), (9, 4, '#1a1a1a'), (11, 2, '#1a1a1a'), (5, 5, '#f4f0e6'), (12, 5, '#1a1a1a')):
        t.px_(x, y - 1, c); t.px_(x, y, c)
    t.rect_(12, -1, 3, 2, '#6a4a2a')
    out.paste_(t, 5, 2)
    out.rect_(16, 0, 5, 3, WAL[1]); out.px_(17, 1, '#f4f0e6'); out.px_(19, 1, '#f4f0e6')   # the chess clock
    return out


def files_stack() -> Img:
    """A stack of cardboard folders tied with string, dog-eared papers poking out. 14 × 12."""
    out = Img.new(14, 12)
    for k, c in enumerate(('#c8a868', '#b89858', '#d0b070', '#a88a4e')):
        y = 9 - k * 3
        out.rect_(k % 2, y, 13, 3, c); out.rect_(k % 2, y, 13, 1, '#e8d49a')
        out.rect_(2 + k, y + 1, 5, 1, '#f2eee0')
    out.rect_(6, 0, 1, 12, '#8a6a48')
    return ink(out)


def waste_basket() -> Img:
    """A wicker waste basket with crumpled paper on top. 9 × 10."""
    out = Img.new(9, 10)
    out.poly_([(0, 2), (9, 2), (8, 10), (1, 10)], P['straw'][1])
    for y in range(3, 10, 2):
        out.rect_(1, y, 7, 1, P['straw'][2])
    out.ellipse_(4.5, 2, 4.5, 1.6, P['straw'][3])
    out.ellipse_(3, 1, 1.6, 1.2, '#f2eee0'); out.ellipse_(6, 1.5, 1.4, 1, '#e0dccc')
    return outline(out, INK).crop(0, 0, 10, 11)


def ceiling_lamp(cord: int = 26) -> Img:
    """The office ceiling light: a long cord and a milk-glass dome with a brass rim (top layer).
    13 × (cord + 8)."""
    w = 13
    out = Img.new(w, cord + 8)
    out.rect_(6, 0, 1, cord, '#2a2426')
    d = Img.new(w, 12)
    d.ellipse_(6.5, 6, 6.5, 5.5, '#dcdad0'); d.ellipse_(5.5, 4.5, 4, 3, '#fbfaf2')
    dome = d.crop(0, 0, w, 6)                     # the upper half of the ellipse: a dome
    dome.rect_(0, 5, w, 1, BRASS[2]); dome.rect_(5, 0, 3, 1, BRASS[3])
    out.paste_(ink(dome), 0, cord)
    out.rect_(4, cord + 6, 5, 1, '#fff4c8')       # the bulb's glow under the rim
    return out


# ------------------------------------------------------------------------------------ map
def build() -> Map:
    m = Map('hq', W, H, 'indoor', name='Штаб', ambient=0.7, music='yard')
    shell(m, 'plaster', 'tiles', face=2, door=(6, 2), out_to='square', out_at='hq', floor_seed=2)
    g = m.ground
    r = rng('hq-floor')
    # the dado over the lower wall face (above the shell's baseboard at 45–48)
    m.stamp(wall_paint((W - 2) * T, 13), T, 3 * T - 16)

    cx = 7 * T                                # the chief, the desk, the runner and the door line up
    # --- floor: the runner from the door to the desk, scuffs, a dropped paper, a butt
    run = runner(22, 7 * T + 4, RED, BAIZE)
    m.stamp(run, cx - 11, 6 * T - 4)
    litter(g, r, 'dust', 60, (T, 3 * T, (W - 1) * T, (H - 1) * T))
    litter(g, r, 'paper', 3, (2 * T, 6 * T, 10 * T, 12 * T))
    litter(g, r, 'butt', 3, (8 * T, 8 * T, 11 * T, 10 * T))
    # muddy boot prints from the door up the runner to the desk, fading as the mud wears off
    for k, y in enumerate(range(12 * T + 2, 6 * T + 4, -8)):
        x = cx - 5 + (k % 2) * 7 + (1 if k % 4 == 1 else 0)
        a = 0.75 - 0.045 * k
        g.rect_(x, y, 3, 3, '#2a1a10', a); g.px_(x + 1, y - 1, '#2a1a10', a)      # the sole
        g.rect_(x, y + 4, 3, 2, '#2a1a10', a)                                      # the heel
    litter(g, r, 'ash', 12, (8 * T + 8, 10 * T, 11 * T, 11 * T))

    # --- north wall (x 17…175): the poster, the board of honour, the portrait, [the banner
    #     stands in front here], the camp map, the clock
    m.stamp(skills_poster(), T + 1, T + 2)
    m.stamp(honour_board(), 2 * T + 11, T + 1)
    m.stamp(portrait(), 6 * T + 2, T + 2)
    m.stamp(camp_map(), 8 * T + 2, T + 2)
    m.put('hq.clock', [office_clock(i) for i in range(8)], 10 * T + 2, T + 4, base=3 * T, fps=1)

    # --- the chief behind his desk, the banner on its staff behind his shoulder
    m.put('hq.flag', red_flag(), cx - 1, 4 * T + 1 - 45, solid=(7.6, 3.5, 8.3, 4))
    m.put('hq.desk', desk(), cx - 32, 66 - 12, solid=(5, 4.6, 9, 5.75))
    m.npc('chief', 'chief', 7.0, 4.05, face=0, anim='idle', name='Начальник')
    m.emit('steam', cx - 32 + 46, 66 - 4, 0.25)
    m.light(cx - 25, 5 * T - 6, 40, '#c8f0a0', 'lamp')

    # --- north row, only low things under the wall art: radiator, files, a basket; the safe
    #     under the map, a filing cabinet under the clock with the fan on it
    m.put('hq.radiator', radiator(), T + 2, 4 * T - 12, solid=(1, 3.2, 3.2, 3.8))
    m.put('hq.files', files_stack(), 3 * T + 6, 4 * T - 10)
    m.put('hq.basket', waste_basket(), 4 * T + 8, 4 * T + 1)
    m.put('hq.safe', safe(), 8 * T + 4, 5 * T - 26 - 4, solid=(8.3, 3.6, 9.6, 4.6))
    cab = filing_cabinets().crop(0, 0, 15, 28)
    m.put('hq.cabinet', cab, 10 * T - 2, 5 * T - 28 - 4, solid=(9.9, 3.6, 10.9, 4.6))
    m.put('hq.fan', [table_fan(i) for i in range(4)], 10 * T, 5 * T - 32 - 11, base=5 * T - 3, fps=12)

    # --- in front of the desk: two visitors' chairs, backs to us, the runner between them
    vc = chair_back(WAL, BAIZE)
    m.put('hq.chair', vc, 5 * T + 2, 7 * T - 16, solid=(5.1, 6.5, 5.9, 7))
    m.put('hq.chair', vc, 8 * T + 2, 7 * T - 16, solid=(8.1, 6.5, 8.9, 7))

    # --- west wall: the cabinet of finds, the bookcase, the chess table, a ficus, the coat rack
    m.put('hq.trophies', trophy_cabinet(), T + 1, 7 * T - 38 + 2, solid=(1, 6.1, 2.8, 7))
    m.light(2 * T + 2, 6 * T - 4, 22, '#ffe0a0', 'glow')
    m.put('hq.bookcase', bookcase(), T + 2, 9 * T + 4 - 34, solid=(1, 8.2, 2.6, 9.2))
    m.put('hq.chess', chess_table(), 3 * T - 2, 9 * T + 2 - 18, solid=(3, 8.4, 4.5, 9.1))
    m.put('hq.ficus', potted('ficus', seed=3), T - 1, 11 * T - 26 + 4, solid=(1, 10.5, 2, 11.2))
    m.put('hq.coatrack', coat_rack(), 4 * T + 6, 12 * T - 35, solid=(4.5, 11.4, 5.4, 12))
    m.put('hq.files2', files_stack(), 2 * T + 4, 12 * T - 12)

    # --- east wall: a filing cabinet pair, the carafe, the sofa with the globe, a palm, the
    #     extinguisher by the door
    m.put('hq.cabinets', filing_cabinets(), 9 * T + 1, 7 * T - 28, solid=(9, 6.2, 11, 7))
    m.put('hq.carafe', carafe_table(), 10 * T - 2, 9 * T - 22 + 2, solid=(9.8, 8.4, 10.8, 9.1))
    m.put('hq.sofa', sofa(), 8 * T + 8, 11 * T - 20, solid=(8.5, 10.1, 10.9, 11))
    m.put('hq.globe', globe(), 7 * T + 12, 9 * T - 20 + 2, solid=(7.8, 8.4, 8.6, 9.1))
    m.put('hq.ficus2', potted('palm', seed=5), 10 * T - 2, 12 * T - 26 + 2, solid=(9.9, 11.4, 10.9, 12))
    m.put('hq.extinguisher', extinguisher(), 8 * T + 10, 12 * T - 16, solid=(8.6, 11.5, 9.2, 12))

    # --- light: the ceiling lamp over the runner, the green desk lamp (above), the cabinet glow
    m.put('hq.lamp', ceiling_lamp(18), cx - 6, 8 * T - 4, layer='top')
    m.light(cx, 9 * T + 8, 100, '#fff0c8', 'lamp')
    m.emit('dust', cx, 8 * T, 0.3)
    m.marks['chief'] = (7.0, 4.05)
    return m
