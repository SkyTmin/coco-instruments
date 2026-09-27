"""Facades of the square's buildings (v2.80) — the contract between the square and its buildings.

`facade(id)` returns a `Facade`: the exterior sprite of a building and what the square needs to
place it. The square (maps/square.py) decides WHERE a building stands; this module decides what it
LOOKS like. Sizes below are the contract — the square leaves exactly this footprint free.

Placement rule: the sprite's bottom edge sits on the footprint's bottom edge; the sprite is
centred on the footprint horizontally (it may be wider — eaves, a porch — by `over` px each side);
everything above the footprint (walls, roof, chimney, the headframe) rises up the screen.
Door: `door_x` tiles from the footprint's left edge, `door_w` tiles wide, at its bottom row.

The drawing tools (materials, roofs, openings, fittings) live in `art_facades.py`; each building
is a `_draw_<id>()` here that composes them. Look at them with `review_facades.py` (all of them on
a dirt patch, the hero at every door, `--night`, `--lines`, `--anim`).

For the square: animated facades carry `frames` + `fps` (mine: the sheave turns, the beacon
blinks; hq: the flag waves; club: the neon stutters, the bulbs chase). `searchlight(f)` gives the
lamp the square hangs its beam on (watchtower, kpp). Lights with night=True are windows and door
lamps; night=False ones glow always (the forge's fire, the zone's violet, the club's neon).

Geometry (see art_facades): the front wall is H px tall from the footprint's bottom; the roof
covers the footprint shifted up by H, so the sprite is D + H (+ chimneys, towers) tall and nothing
of the footprint shows through. Props "by the door" stand ON the wall line — the sprite may not
reach below the footprint, so nothing can stand in front of it.

Lessons (three rounds on every building, ×3–×4 sheets, day and night):
  * The final contour goes OUTSIDE the silhouette (`art_facades.contour`). kit.ink turns every
    pixel that touches transparency into ink: the sheave's spokes, the headframe's bracing, cables,
    ladder rungs, the tower's railing all went solid black and the wheel stopped reading as a wheel.
  * kit.text (3×5) can't carry a facade sign: Ш, Ц, И are too close — ШАХТА read ЧАХТА, КУЗНИЦА
    read КУЗНИЧА. Signs use the 5×7 `sign_text`; the 3×5 font only for short labels (БАРАК 1).
    Letters on a LIGHT board get no drop shadow, or they turn into outlines (ПРАЧЕЧНАЯ was mush).
  * Tar paper with battens over a whole long roof reads as prison bars; wavy asbestos slate
    (шифер) is the Soviet barrack roof and reads at once. Big roofs are the price of the 3/4 view
    (D = 80 px of roof over a 36 px wall), so they need things ON them: dormers, stove pipes, a
    ladder, painted numbers, moss, soot, monitors, skylights, a cupola, weathervanes.
  * A hip roof whose ridge sits below its back eave on screen must draw the back slope, or its
    side triangles stick up as "ears" (hq, canteen, kpp all had them).
  * Flat roofs are anonymous grey boxes; puddles drawn dark read as holes. Give them felt strips,
    patches, a drain, and a load (the zone's chained hatch and crystals, the garage's tarp heap).
  * Anything "inside the door" must not be vertical bars: a lattice read as a jail cell (mine,
    lift). The mine shows rails running into a lit hall, the lift an open car with its gate folded.
  * Draw order on landmarks: the sheave's axle post was painted over the wheel and hid its hub.
  * A thing painted over a thing: the ШТАБ board under the balcony slab lost its top row (ШТНБ),
    the lamp covered the board of honour, the sign covered a barrack window — check signs last.
  * Bars must be LIGHT steel on the dark glass, or "barred windows" are just dark windows.
  * Two front-gable buildings in a row look alike: the forge is a plain gable in stone and slate
    with a brick chimney, the kennel a gambrel barn in red boards with a cupola and a hay door.
  * Tyres drawn as dark ellipses read as holes; a tyre needs its tread band and a see-through hole.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import art_facades as A
from art_facades import GLOW, WARM, Cv, R
from kit import INK, P, barrel, bucket, crate, ink, sack, text
from lib import T, Img, rng

# id → (footprint w, footprint h, door x, door w, sign text). Enterable buildings first.
FOOTPRINTS: dict[str, tuple[int, int, float, float, str]] = {
    'mine': (10, 6, 4, 2, 'ШАХТА'),        # headframe + hoist house over the shaft
    'zone': (6, 5, 2, 2, 'ОСОБАЯ'),        # sealed shaft, chains, violet glow
    'forge': (7, 5, 3, 2, 'КУЗНИЦА'),
    'lift': (7, 5, 2.5, 2, 'ЛИФТ'),        # iron pavilion with the lift cage down to the dungeon
    'tower': (5, 5, 1.5, 2, ''),           # the enchanter's old water tower
    'kennel': (8, 5, 3, 2, 'ПИТОМНИК'),
    'trader': (6, 4, 2, 2, ''),            # tarp-roofed shed between barracks
    'store': (7, 5, 2.5, 2, 'КАПТЁРКА'),
    'kiosk': (4, 3, 1, 2, 'ЛАРЁК'),
    'hq': (9, 5, 3.5, 2, 'ШТАБ'),
    'club': (9, 5, 3.5, 2, 'КЛУБ'),
    # not enterable in v2.80 (doors shut, residents come in v2.81)
    'barrack1': (11, 5, 5, 1, 'БАРАК 1'),
    'barrack2': (11, 5, 5, 1, 'БАРАК 2'),
    'canteen': (9, 5, 4, 1, 'СТОЛОВАЯ'),
    'boiler': (6, 5, 2, 1, 'КОТЕЛЬНАЯ'),
    'laundry': (6, 4, 2.5, 1, 'ПРАЧЕЧНАЯ'),
    'garage': (7, 5, 1, 4, 'ГАРАЖ'),
    'kpp': (6, 4, 2, 2, 'КПП'),            # the gate house; the gate itself is the square's
    'watchtower': (3, 3, 1, 1, ''),        # four corners, searchlight on top
}

ENTERABLE = ('mine', 'zone', 'forge', 'lift', 'tower', 'kennel', 'trader', 'store', 'kiosk', 'hq', 'club')


@dataclass
class Facade:
    id: str
    img: Img                 # the sprite; bottom edge = footprint bottom edge
    fw: int                  # footprint, tiles
    fh: int
    door_x: float            # tiles from footprint's left
    door_w: float
    over: int = 0            # px the sprite sticks out on each side of the footprint
    frames: list[Img] | None = None   # animated facade (the headframe wheel, neon) — same size as img
    fps: float = 0
    # relative to the sprite's top-left, px
    lights: list[tuple[float, float, float, str, str, bool]] = field(default_factory=list)  # x, y, r, color, kind, night
    fx: list[tuple[str, float, float, float]] = field(default_factory=list)                   # kind, x, y, rate
    solid: list[tuple[float, float, float, float]] | None = None   # tile rects relative to the footprint; default = whole footprint minus the door


def searchlight(f: Facade) -> tuple[float, float] | None:
    """Where the square hangs a searchlight beam on this facade (px from the sprite's top-left)."""
    for x, y, r, col, kind, night in f.lights:
        if col == SEARCH:
            return x, y
    return None


SEARCH = '#fff3c0'


def facade(id: str) -> Facade:
    fw, fh, dx, dw, sign = FOOTPRINTS[id]
    draw = globals().get(f'_draw_{id}')
    if draw:
        return draw()
    return _placeholder(id, fw, fh, dx, dw, sign)


def _placeholder(id: str, fw: int, fh: int, dx: float, dw: float, sign: str) -> Facade:
    wall_h = fh * T + 2 * T
    img = Img.new(fw * T, wall_h)
    img.rect_(0, 0, fw * T, 2 * T, P['slate'][2])
    img.rect_(0, 2 * T, fw * T, fh * T, P['plaster'][2])
    if id in ENTERABLE or id == 'kpp':
        img.rect_(int(dx * T), wall_h - 2 * T, int(dw * T), 2 * T, '#1a1212')
    if sign:
        t = text(sign, '#f2c46a')
        img.paste_(t, (fw * T - t.w) // 2, 2 * T + 4)
    return Facade(id, ink(img), fw, fh, dx, dw)


# ------------------------------------------------------------------------------ assembly
def _cv(id: str, over: int = 0) -> Cv:
    fw, fh, *_ = FOOTPRINTS[id]
    return Cv(fw, fh, over)


def _finish(id: str, cv: Cv | list[Cv], fps: float = 0, solid=None, outline_: bool = True) -> Facade:
    """Ink the silhouette, trim the empty sky, shift lights and effects by the trim."""
    cvs = cv if isinstance(cv, list) else [cv]
    imgs = [A.contour(c.img) if outline_ else c.img for c in cvs]
    imgs, top = A.trim_top(imgs)
    c0 = cvs[0]
    fw, fh, dx, dw, _ = FOOTPRINTS[id]
    lights = [(x, y - top, r, col, kind, night) for x, y, r, col, kind, night in c0.lights]
    fx = [(k, x, y - top, rate) for k, x, y, rate in c0.fx]
    frames = imgs if len(imgs) > 1 else None
    return Facade(id, imgs[0], fw, fh, dx, dw, c0.over, frames, fps, lights, fx, solid)


def _door(cv: Cv, id: str) -> tuple[int, int]:
    _, _, dx, dw, _ = FOOTPRINTS[id]
    return cv.door_px(dx, dw)


def _win_light(cv: Cv, x: int, y: int, w: int, h: int, color: str = WARM, r: float | None = None) -> None:
    cv.light(x + w / 2, y + h / 2, r or max(w, h) * 1.25, color, 'window', True)


# ------------------------------------------------------------------------------- forge
def _draw_forge() -> Facade:
    """Stone smithy under a slate front gable: the wide door open on the fire inside, a brick
    chimney smoking on the left slope, anvil and water barrel either side of the door."""
    from maps.forge import anvil
    cv = _cv('forge', over=4)
    img, L, B = cv.img, cv.L, cv.B
    H = 40
    A.front_wall(cv, 'stone', H, seed=3, plinth=4, plinth_mat='concrete')
    roof = A.roof_ns(cv, 'slate', H, rise=30, gable='plankgrey', seed=2)
    ax, ay = int(roof['cx']), roof['apex']
    from lib import grid
    kon = grid(['..kk..', '.k43k.', 'k4k3k.', '.k.43k', '...k3k', '...k3k', '..k33k', '.k333k'],
               {'k': INK, '3': P['wood'][2], '4': P['wood'][4]})
    img.paste_(kon, ax - 3, ay - 6)
    # chimney out of the left slope, towering over the ridge
    chx, chw = L + 12, 14
    bl = int(A.slope_y(roof, chx, cv.D * 0.42))
    A.soot_trail(img, chx + 2, bl + 1, -0.6, 22, 4)
    A.moss(img, L, roof['top'] + 20, cv.R, roof['eave'] - 4, seed=2, n=16)
    for (sx, sy) in ((L + 70, roof['top'] + 40), (L + 30, roof['top'] + 66)):   # replaced slates
        img.rect_(sx, sy, 4, 3, P['slate'][3]); img.rect_(sx, sy, 4, 1, P['slate'][4])
    A.roof_stack(img, chx, chw, roof['top'] - 16, bl, int(bl - (chw - 1) * roof['k']), seed=4)
    wv = A.weathervane('arrow')
    img.paste_(wv, int(roof['cx']) - 5, roof['top'] - wv.h + 2)
    # door: open wide on the fire
    dx, dw = _door(cv, 'forge')
    d = A.doorway(dw, 30, glow='#ffb347', inside='hearth', frame='wood')
    A.lintel(img, dx, B - 30, dw, 'brick')
    img.paste_(d, dx, B - 30)
    # horseshoe over the door, the sign on the gable
    img.paste_(A.horseshoe(), dx + dw // 2 - 4, B - 39)
    s = A.board('КУЗНИЦА', bg='#3f2e24')
    img.paste_(s, int(roof['cx'] - s.w / 2), roof['eave'] - 17)
    # window left of the door, warm from the hearth
    wx, wy = L + 8, B - 35
    img.paste_(A.window(16, 18, 'wood', bars=2), wx, wy)
    _win_light(cv, wx, wy, 16, 18)
    # props: anvil on its stump, water barrel, a bucket
    img.paste_(anvil(), L + 25, B - 22)
    img.paste_(barrel(water=True), dx + dw + 3, B - 18)
    img.paste_(bucket(True), dx + dw + 18, B - 10)
    bars = Img.new(8, 20)
    for i, x in enumerate((0, 3, 5)):
        bars.line_(x + 1, 19, x + 3, 0, [R['steel'][3], P['rust'][3], R['steel'][2]][i])
    img.paste_(A.outline(bars, INK), cv.R - 9, B - 21)
    lamp, (bx, by) = A.wall_lamp('iron')
    img.paste_(lamp, dx + dw + 1, B - 38)
    cv.light(dx + dw + 1 + bx, B - 38 + by, 34, WARM, 'lamp', True)
    cv.light(dx + dw / 2, B - 12, 58, '#ff8a3a', 'forge', False)
    cv.emit('smoke', chx + chw // 2, roof['top'] - 18, 0.8)
    cv.emit('embers', chx + chw // 2, roof['top'] - 17, 0.5)
    return _finish('forge', cv)


# ----------------------------------------------------------------------------- barracks
def _barrack(id: str, n: int) -> Facade:
    """A long barrack: barred windows, a plank door under a canopy, a louvered dormer, stove pipes,
    firewood and a bench along the wall. Barrack 1 is logs under wavy asbestos slate; barrack 2 is
    faded green weatherboard under galvanised tin with two dormers and a brick stove chimney."""
    cv = _cv(id, over=5)
    img, L, R_, B = cv.img, cv.L, cv.R, cv.B
    H = 36
    logs = n == 1
    if logs:
        A.front_wall(cv, 'logs', H, seed=n, plinth=5)
        for x in (L, R_):
            A.log_ends(img, x, B - H, B - 5)
    else:
        A.front_wall(cv, 'siding', H, seed=n, tone='sidegreen', plinth=5)
        for x in (L, R_ - 3):                              # corner boards
            img.rect_(x, B - H, 3, H - 5, R['white'][2]); img.rect_(x, B - H, 1, H - 5, R['white'][4])
    kind = 'shifer' if logs else 'galv'
    roof = A.roof_ew(cv, kind, H, seed=n)
    dx, dw = _door(cv, id)
    if logs:
        A.dormer(img, dx + dw // 2, roof['eave'] - 20, 22, 9, kind, 10, seed=n)
        for k, x in enumerate((L + 40, R_ - 44)):          # stove pipes, a ladder up to one
            sp = A.stovepipe(22)
            yb = roof['ridge'] + 12
            img.paste_(sp, x, yb - sp.h)
            cv.emit('smoke', x + 6, yb - sp.h, 0.35)
        img.paste_(A.roof_ladder(roof['eave'] - roof['ridge'] - 14), R_ - 60, roof['ridge'] + 12)
    else:
        for x in (L + 40, R_ - 40):
            A.dormer(img, x, roof['eave'] - 18, 20, 8, kind, 9, seed=n + x, vent='window')
        chx = dx + dw // 2 - 6
        A.roof_stack(img, chx, 12, roof['ridge'] - 14, roof['ridge'] + 8, roof['ridge'] + 8, seed=n)
        cv.emit('smoke', chx + 6, roof['ridge'] - 16, 0.5)
    # the barrack's number painted big on the roof, weathered (seen from the towers)
    num = A.sign_text(str(n), '#e9e4d6', None).scale(3)
    nx, ny = L + 18 if logs else R_ - 62, roof['ridge'] + 16
    mask = num.a[:, :, 3] > 0
    r_ = rng('num', n)
    for yy, xx in zip(*mask.nonzero()):
        if r_.random() < 0.82:
            img.px_(nx + xx, ny + yy, '#e2ddcf', 0.85)
    # door under its canopy
    d = A.plank_door(dw + 2, 27, tone='woodgrey' if logs else 'wood')
    img.paste_(d, dx - 1, B - 27)
    cn = A.canopy(dw + 12, 6, 'galv' if logs else 'tinred', seed=n)
    img.paste_(cn, dx - 6, B - 36)
    frame = 'wood' if logs else 'white'
    for wx in (L + 8, L + 30, R_ - 52, R_ - 26):
        wy = B - 30
        img.paste_(A.window(14, 16, frame, bars=2, seed=wx), wx, wy)
        _win_light(cv, wx, wy, 14, 16)
    s = A.board(f'БАРАК {n}', bg='#2c3a4a' if logs else '#6e2a26', fg='#e8e2cf', pad=1, small=True)
    img.paste_(s, dx - 3 - s.w, B - 27)
    # along the wall: a bench by the door, firewood at the end, a bucket
    img.paste_(A.bench(20), dx + dw + 4, B - 8)
    img.paste_(A.firewood(30, 17, n), R_ - 44 if logs else L + 6, B - 17)
    img.paste_(bucket(True), dx + dw + 26 if logs else dx - 30, B - 10)
    lamp, (bx, by) = A.wall_lamp()
    img.paste_(lamp, dx + dw + 3, B - 35)
    cv.light(dx + dw + 3 + bx, B - 35 + by, 40, WARM, 'lamp', True)
    return _finish(id, cv)


def _draw_barrack1() -> Facade:
    return _barrack('barrack1', 1)


def _draw_barrack2() -> Facade:
    return _barrack('barrack2', 2)


# --------------------------------------------------------------------------------- mine
def ore_wagon(load: str = 'rust') -> Img:
    """A mine tub on its wheels, heaped with ore, 26 × 20."""
    from kit import ore_pile
    st = R['steel']
    out = Img.new(26, 20)
    out.paste_(ore_pile(load, None, 5).crop(0, 2, 26, 10), 0, 0)
    out.poly_([(1, 7), (25, 7), (23, 16), (3, 16)], st[2])
    out.rect_(1, 7, 24, 2, st[3]); out.rect_(1, 7, 24, 1, st[4])
    for x in (4, 12, 20):
        out.rect_(x, 9, 1, 6, st[1])
    out.rect_(3, 14, 20, 1, st[1])
    out.rect_(5, 12, 4, 2, P['rust'][2], 0.8)
    for x in (6, 19):
        out.ellipse_(x, 17, 2.6, 2.6, INK); out.ellipse_(x, 17, 1.5, 1.5, st[3])
    return A.outline(out, INK).crop(1, 1, 26, 20)


def _mine_frame(frame: int) -> Cv:
    cv = _cv('mine', over=4)
    img, L, R_, B, D = cv.img, cv.L, cv.R, cv.B, cv.D
    xa, xb = L + 48, L + 112                      # the tall shaft house between two annexes
    Hc, Hs = 62, 40
    # annexes: the winding-engine house (flat roof, left), the lamp room (slate gable, right)
    A.front_wall(cv, 'brick', Hs, seed=5, x0=L, x1=xa, plinth=5)
    A.front_wall(cv, 'brick', Hs, seed=6, x0=xb, x1=R_, plinth=5)
    left = A.roof_flat(cv, Hs, x0=L, x1=xa, parapet=4, mat='brick', seed=5, surface='felt')
    right = A.roof_ew(cv, 'shifer', Hs, x0=xb, x1=R_, seed=7, ov=2)
    sp = A.stovepipe(20)
    img.paste_(sp, R_ - 18, right['ridge'] + 10 - sp.h)
    cv.emit('smoke', R_ - 12, right['ridge'] + 10 - sp.h, 0.4)
    # a vent box on the engine house roof, steaming
    sx0, sy0, sx1, sy1 = left['surface']
    img.rect_(sx0 + 8, sy0 + 14, 12, 8, R['galv'][2]); img.rect_(sx0 + 8, sy0 + 14, 12, 2, R['galv'][4])
    for x in range(sx0 + 9, sx0 + 19, 2):
        img.rect_(x, sy0 + 17, 1, 4, R['galv'][0])
    cv.emit('steam', sx0 + 14, sy0 + 12, 0.5)
    A.monitor(img, sx0 + 6, sx1 - 4, sy1 - 16, 6, 10, 'galv', seed=15, glass=True)
    for k, (x0, x1) in enumerate(((L, xa), (xb, R_))):
        for wx in (x0 + 7, x1 - 21):
            img.paste_(A.window(14, 18, 'white', bars=0, seed=k), wx, B - 32)
            _win_light(cv, wx, B - 32, 14, 18)
    # the shaft house
    A.front_wall(cv, 'brick', Hc, seed=8, x0=xa, x1=xb, plinth=6)
    for x in (xa, xb - 5):                         # brick pilasters at its corners
        img.paste_(A.wall('brick', 5, Hc - 6, 21).mul(1.1), x, B - Hc)
        img.rect_(x + 4, B - Hc, 1, Hc - 6, '#000000', 0.3)
    roof = A.roof_ns(cv, 'tinred', Hc, rise=20, gable='brick', x0=xa, x1=xb, seed=9, ov=3)
    rw = A.round_window(12, 'brick')
    img.paste_(rw, int(roof['cx']) - 7, roof['eave'] - 17)
    # headframe: two legs out of the roof, cross-braced, a crown with the sheave on top
    hx = int(roof['cx'])
    top = roof['top'] - 58
    bl = A.slope_y(roof, hx - 17, D * 0.5)
    br = A.slope_y(roof, hx + 17, D * 0.5)
    # the inclined back leg toward the engine house, and the ropes that run to its drum
    foot = (L + 20, sy0 + 20)
    wr = 15
    wx, wy = hx + 2, top - wr + 2
    A.cable(img, wx - wr + 1, wy + 1, foot[0] + 10, foot[1] - 2)
    A.cable(img, wx - wr + 2, wy + 4, foot[0] + 14, foot[1] + 1)
    A.truss(img, hx - 10, top + 6, *foot, depth=7)
    img.rect_(foot[0] - 5, foot[1] - 1, 10, 3, R['steel'][1]); img.rect_(foot[0] - 5, foot[1] - 1, 10, 1, R['steel'][3])
    A.girder(img, hx - 18, bl, hx - 10, top + 2, w=4)
    A.girder(img, hx + 18, br, hx + 10, top + 2, w=4, lit=False)
    levels = [top + 10 + i * 14 for i in range(8) if top + 10 + i * 14 < min(bl, br) - 4]
    for i, y in enumerate(levels):
        t = (y - top) / (min(bl, br) - top)
        half = 10 + 8 * t
        A.girder(img, hx - half, y, hx + half, y, w=2)
        if i + 1 < len(levels):
            y2 = levels[i + 1]
            t2 = (y2 - top) / (min(bl, br) - top)
            h2 = 10 + 8 * t2
            img.line_(int(hx - half), y, int(hx + h2), y2, R['steel'][1])
            img.line_(int(hx + half), y, int(hx - h2), y2, R['steel'][1])
    # the rope down the shaft (right of the wheel)
    A.cable(img, wx + wr - 1, wy + 1, wx + wr - 1, (bl + br) / 2 + 2)
    # crown: platform, railing, the wheel, a beacon mast
    st = R['steel']
    img.rect_(hx - 16, top - 1, 33, 5, st[2]); img.rect_(hx - 16, top - 1, 33, 1, st[4])
    img.rect_(hx - 16, top + 3, 33, 1, st[0])
    img.rect_(hx - 17, top - 8, 1, 8, st[3]); img.rect_(hx + 17, top - 8, 1, 8, st[2])
    img.rect_(hx - 17, top - 8, 35, 1, st[3]); img.rect_(hx - 17, top - 4, 35, 1, st[1])
    # the wheel's A-frame bearings stand behind it, the wheel in front
    img.line_(wx - 9, top - 1, wx, wy, st[1]); img.line_(wx - 8, top - 1, wx + 1, wy, st[2])
    img.line_(wx + 9, top - 1, wx, wy, st[1]); img.line_(wx + 8, top - 1, wx - 1, wy, st[0])
    wheel = A.sheave(wr, frame, 4)
    img.paste_(wheel, wx - wheel.w // 2, wy - wheel.h // 2)
    img.rect_(hx + 14, top - 16, 2, 16, st[2])
    beacon = '#ff4a3a' if frame in (0, 1) else '#6b2020'
    img.rect_(hx + 13, top - 19, 4, 3, beacon); img.px_(hx + 13, top - 19, '#ffd0c0' if frame in (0, 1) else beacon)
    img.rect_(hx + 12, top - 20, 6, 1, INK); img.rect_(hx + 12, top - 16, 6, 1, INK)
    cv.light(hx + 15, top - 18, 26, '#ff5040', 'lamp', True)
    # the entrance: rails run out of the lit hall across the threshold
    dx, dw = _door(cv, 'mine')
    d = A.doorway(dw, 38, glow=WARM, inside='mine', frame='iron', step=False)
    img.paste_(d, dx, B - 38)
    for y in range(B - 14, B):
        k = (B - y) / 14
        l = int(dx + 10 - 4 * k)
        r = int(dx + dw - 12 + 4 * k)
        if (B - y) % 3 == 0:
            img.rect_(l - 2, y, r - l + 6, 1, P['woodgrey'][1] if k < 0.9 else P['woodgrey'][0])
        img.rect_(l, y, 2, 1, st[3]); img.rect_(r, y, 2, 1, st[3])
    img.rect_(dx - 2, B - 41, dw + 4, 4, st[2]); img.rect_(dx - 2, B - 41, dw + 4, 1, st[4])  # I-beam lintel
    img.rect_(dx - 2, B - 38, dw + 4, 1, INK)
    board = A.board('ШАХТА', bg='#8a2a2a', fg='#f3ead2', pad=3, frame='#c9a063')
    img.paste_(board, hx - board.w // 2, B - 58)
    lamp, (lbx, lby) = A.wall_lamp()
    img.paste_(lamp, dx + dw + 2, B - 44)
    cv.light(dx + dw + 2 + lbx, B - 44 + lby, 44, WARM, 'lamp', True)
    cv.light(dx + dw / 2, B - 16, 40, WARM, 'glow', False)
    for wxx in (xa + 7, xb - 17):                  # tall arched windows of the shaft house
        img.paste_(A.window(10, 24, 'white', kind='grid', seed=3), wxx, B - 50)
        _win_light(cv, wxx, B - 50, 10, 24)
    # at the foot: an ore tub on a rail stub, an ore heap, a hazard board
    img.paste_(A.rail_track(22, 6).rot90(1), xb + 6, B - 6)
    img.paste_(ore_wagon(), xb + 4, B - 21)
    from kit import ore_pile
    img.paste_(ore_pile('stone', 'gold', 2), L + 16, B - 15)
    img.paste_(A.poster(9, 12, 4, 'star'), xa - 11, B - 36)
    return cv


def _draw_mine() -> Facade:
    return _finish('mine', [_mine_frame(f) for f in range(4)], fps=8)


# ------------------------------------------------------------------------- special zone
VIOLET = '#9a6be0'


def _draw_zone() -> Facade:
    """A sealed concrete shaft house: riveted steel doors under crossed chains and a padlock,
    violet light leaking from the seams and the cracks, crystals pushing out at the foot, barbed
    wire on the parapet, a chained hatch on the roof."""
    cv = _cv('zone', over=3)
    img, L, R_, B = cv.img, cv.L, cv.R, cv.B
    H = 50
    A.front_wall(cv, 'panel', H, seed=11, plinth=6, plinth_mat='concrete')
    roof = A.roof_flat(cv, H, parapet=5, mat='panel', seed=11, surface='felt')
    sx0, sy0, sx1, sy1 = roof['surface']
    # the sealed hatch: a concrete collar, a steel lid, chains, light at the rim
    hx, hy = (sx0 + sx1) // 2, (sy0 + sy1) // 2 + 2
    A.ellipse_top(img, hx, hy + 3, 17, 9, P['concrete'][1])
    img.rect_(hx - 17, hy - 1, 35, 5, P['concrete'][2])
    A.ellipse_top(img, hx, hy - 1, 17, 9, P['concrete'][3], P['concrete'][4])
    img.ellipse_(hx, hy - 1, 13.5, 6.8, '#c9a6ff')
    A.ellipse_top(img, hx, hy - 2, 12, 6, '#3a4640', '#5c6b63')
    for a in range(0, 360, 45):
        img.px_(int(hx + 9 * math.cos(math.radians(a))), int(hy - 2 + 4.5 * math.sin(math.radians(a))), '#7c8b82')
    img.paste_(A.chains_x(26, 12), hx - 13, hy - 8)
    cv.emit('motes', hx, hy - 4, 0.7)
    cv.light(hx, hy - 2, 30, VIOLET, 'magic', False)
    for (x, y, n, sd) in ((sx0 + 8, sy0 + 10, 10, 5), (sx1 - 20, sy1 - 18, 9, 6)):
        A.glow_crack(img, x, y, n, sd, down=False)
    img.paste_(A.crystal(9, seed=4), hx + 16, hy - 6)
    img.paste_(A.crystal(7, seed=5), hx - 26, hy - 2)
    # a mushroom vent
    img.rect_(sx1 - 12, sy0 + 8, 4, 10, R['galv'][2]); img.rect_(sx1 - 12, sy0 + 8, 1, 10, R['galv'][4])
    img.ellipse_(sx1 - 10, sy0 + 7, 5, 2.5, R['galv'][3])
    # barbed wire on the parapet, front and back
    bw = A.barbed_wire(cv.W - 4)
    img.paste_(bw, L + 2, roof['top'] - 3)
    img.paste_(bw, L + 2, roof['near'] - 10)
    # the door: steel, sealed, light at the seams
    dx, dw = _door(cv, 'zone')
    img.rect_(dx - 3, B - 38, dw + 6, 38, P['concrete'][3]); img.rect_(dx - 3, B - 38, dw + 6, 1, P['concrete'][4])
    img.paste_(A.steel_door(dw, 34, glow='violet'), dx, B - 34)
    img.paste_(A.chains_x(dw + 2, 22), dx - 1, B - 30)
    cv.light(dx + dw / 2, B - 6, 52, VIOLET, 'magic', False)
    cl = Img.new(7, 6)
    cl.rect_(0, 0, 7, 1, R['steel'][1]); cl.rect_(1, 1, 5, 4, '#ff4a3a'); cl.px_(2, 2, '#ffd0c0')
    for x in (1, 3, 5):
        cl.rect_(x, 1, 1, 4, R['steel'][2])
    img.paste_(A.outline(cl, INK), dx + dw + 3, B - 44)
    cv.light(dx + dw + 7, B - 40, 24, '#ff4a3a', 'lamp', True)
    cv.emit('motes', dx + dw / 2, B - 8, 1.0)
    # hazard stripes on the jambs, the sign above
    img.paste_(A.hazard(3, 34), dx - 3, B - 34)
    img.paste_(A.hazard(3, 34), dx + dw, B - 34)
    sg = A.board('ОСОБАЯ ЗОНА', bg='#d8b12e', fg='#1e1d1a', pad=2)
    img.paste_(sg, cv.cx - sg.w // 2, B - 50)
    # cracks leaking light, crystals at the foot
    for x, y, n, s in ((L + 12, B - 44, 14, 1), (L + 22, B - 24, 9, 2), (R_ - 14, B - 40, 16, 3), (R_ - 24, B - 18, 8, 4)):
        A.glow_crack(img, x, y, n, s)
    img.paste_(A.crystal(12, seed=1), L + 6, B - 12)
    img.paste_(A.crystal(9, seed=2), R_ - 16, B - 9)
    img.paste_(A.crystal(7, seed=3), dx - 12, B - 7)
    for x in (L + 13, R_ - 13):
        cv.light(x, B - 30, 22, VIOLET, 'magic', False)
    # a small window, bricked up but for a slit
    img.rect_(L + 6, B - 40, 14, 5, P['concrete'][1]); img.rect_(L + 8, B - 38, 10, 1, '#c9a6ff')
    img.rect_(R_ - 20, B - 40, 14, 5, P['concrete'][1]); img.rect_(R_ - 18, B - 38, 10, 1, '#c9a6ff')
    return _finish('zone', cv)


# ---------------------------------------------------------------------------------- lift
def _draw_lift() -> Facade:
    """An iron pavilion over the lift down to the dungeon: steel columns, corrugated infill, a
    lattice lift tower with its machine room and warning lamp, a lattice gate open on the lit car,
    ЛИФТ in amber, and a rat on a warning sign."""
    cv = _cv('lift', over=4)
    img, L, R_, B, D = cv.img, cv.L, cv.R, cv.B, cv.D
    H = 42
    st = R['steel']
    A.front_wall(cv, 'corr', H, seed=13, tone='galv', plinth=5, plinth_mat='concrete')
    dx, dw = _door(cv, 'lift')
    for x in (L, dx - 5, dx + dw + 1, R_ - 4):                # I-beam columns
        img.rect_(x, B - H, 4, H, st[2]); img.rect_(x, B - H, 1, H, st[4]); img.rect_(x + 3, B - H, 1, H, st[0])
        for y in range(B - H + 3, B - 4, 6):
            img.px_(x + 1, y, st[3])
    img.rect_(L, B - H, cv.W, 3, st[2]); img.rect_(L, B - H, cv.W, 1, st[4])
    roof = A.roof_hip(cv, 'galv', H, rise=D // 2 - 10, seed=13)
    for x in (L + 18, R_ - 30):                              # roof lights
        img.rect_(x, roof['eave'] - 22, 12, 9, R['steel'][1])
        img.rect_(x + 1, roof['eave'] - 21, 10, 7, R['glass'][2])
        img.rect_(x + 1, roof['eave'] - 21, 10, 1, R['glass'][4]); img.px_(x + 8, roof['eave'] - 19, R['glass'][4])
        img.rect_(x, roof['eave'] - 23, 12, 1, INK); img.rect_(x, roof['eave'] - 13, 12, 1, INK)
    # the lift tower out of the roof
    tx = cv.cx
    base = roof['ridge'] + 10
    ttop = roof['top'] - 44
    for x in (tx - 12, tx + 9):
        A.girder(img, x + 1.5, base, x + 1.5, ttop + 12, w=3, lit=x < tx)
    for y in range(ttop + 16, base, 10):
        A.girder(img, tx - 11, y, tx + 11, y, w=2)
        img.line_(tx - 10, y, tx + 10, min(base, y + 10), st[1])
        img.line_(tx + 10, y, tx - 10, min(base, y + 10), st[1])
    A.cable(img, tx, ttop + 12, tx, base)
    # machine room on top
    mr = A.wall('corr', 30, 14, 14, 'galv')
    img.paste_(mr, tx - 15, ttop)
    img.rect_(tx - 16, ttop - 3, 32, 3, st[2]); img.rect_(tx - 16, ttop - 3, 32, 1, st[4])
    img.rect_(tx - 6, ttop + 3, 10, 6, R['glass'][1]); img.px_(tx + 2, ttop + 4, R['glass'][3])
    img.rect_(tx - 16, ttop - 3, 1, 17, INK); img.rect_(tx + 15, ttop - 3, 1, 17, INK)
    img.rect_(tx - 16, ttop + 14, 32, 1, INK); img.rect_(tx - 16, ttop - 4, 32, 1, INK)
    img.rect_(tx + 8, ttop - 9, 2, 6, st[2])
    img.rect_(tx + 7, ttop - 12, 4, 3, '#ffb347'); img.px_(tx + 7, ttop - 12, '#fff0c0')
    cv.light(tx + 9, ttop - 11, 24, '#ffb347', 'lamp', True)
    cv.light(tx - 1, ttop + 6, 16, WARM, 'window', True)
    # the gate
    g = A.scissor_gate(dw, 32)
    img.paste_(g, dx, B - 32)
    img.rect_(dx - 1, B - 34, dw + 2, 2, st[3]); img.rect_(dx - 1, B - 34, dw + 2, 1, st[4])
    img.rect_(dx - 1, B - 35, dw + 2, 1, INK)
    cv.light(dx + dw / 2, B - 16, 40, WARM, 'lamp', False)
    sg = A.board('ЛИФТ', bg='#1e1d1a', fg='#ffb347', pad=2, frame='#6b5617')
    img.paste_(sg, dx + dw // 2 - sg.w // 2, B - 42 - 5)
    img.paste_(A.rat_sign(), R_ - 25, B - 36)
    img.paste_(A.board('КРЫСЫ', bg='#e0b32e', fg='#1e1d1a', pad=1), R_ - 34, B - 19)
    # at the foot: a fire bucket, a crate of lamps, a sign of danger stripes on the plinth
    img.paste_(crate(dark=True), L + 8, B - 16)
    img.paste_(bucket(False), L + 26, B - 10)
    img.paste_(A.hazard(dw, 3), dx, B - 3)
    lamp, (bx, by) = A.wall_lamp()
    img.paste_(lamp, dx - 16, B - 40)
    cv.light(dx - 16 + bx, B - 40 + by, 36, WARM, 'lamp', True)
    return _finish('lift', cv)


# --------------------------------------------------------------------------------- tower
RUNES = ['|/|', '<', '|>', 'X', '^|', 'Y']


def _rune(img: Img, x: int, y: int, k: int, color: str) -> None:
    """A rune painted on the tank, 3 × 6 strokes."""
    shapes = [
        [(1, 0, 1, 5), (1, 1, 3, 0), (1, 3, 3, 2)],     # feoh-like
        [(0, 0, 0, 5), (0, 0, 2, 2), (2, 2, 2, 5)],     # ur
        [(1, 0, 1, 5), (0, 1, 2, 3), (2, 1, 0, 3)],     # gyfu over a staff
        [(0, 0, 2, 5), (2, 0, 0, 5)],                   # gebo
        [(1, 0, 1, 5), (1, 0, 3, 2)],                   # laguz
        [(1, 2, 1, 5), (0, 0, 1, 2), (2, 0, 1, 2)],     # algiz
    ][k % 6]
    for x0, y0, x1, y1 in shapes:
        img.line_(x + x0, y + y0, x + x1, y + y1, color)


def _draw_tower() -> Facade:
    """The old water tower the enchanter lives in: a round brick shaft on a stone plinth, the
    wooden tank on top painted with glowing runes, a conical roof with a crooked smoking
    stovepipe, violet-lit portholes up the stair, an arched door at the head of the steps."""
    cv = _cv('tower', over=8)
    img, L, R_, B, D = cv.img, cv.L, cv.R, cv.B, cv.D
    cx = cv.cx
    st = P['stone']
    base = B - 26
    # a round stone foot the shaft stands on
    A.cylinder(img, cx, base - 10, base + 2, 29, 30, 'stone', ry=7, seed=21)
    A.ellipse_top(img, cx, base - 10, 29, 7, st[3], st[4])
    # the shaft
    r0 = 23
    top = base - 98
    A.cylinder(img, cx, top, base, r0, r0 + 1, 'brick', ry=6, seed=23)
    # the corbel ring under the tank and a gallery around it
    A.cylinder(img, cx, top - 6, top + 2, r0 + 5, r0 + 3, 'brickgrey', ry=7, seed=24)
    # the tank
    rt = 36
    ttop = top - 40
    A.cylinder(img, cx, ttop, top - 4, rt, rt, 'tank', ry=9, seed=25)
    for i, a in enumerate(range(-50, 60, 22)):               # runes round the front of the tank
        x = cx + int(math.sin(math.radians(a)) * (rt - 6)) - 1
        y = ttop + 12 + int(9 * math.cos(math.radians(a)) * 0.8)
        _rune(img, x, y, i, '#c9a6ff' if i % 2 else '#fbe594')
        img.px_(x + 1, y - 1, '#9a6be0')
    cv.light(cx, ttop + 16, 30, '#c9a6ff', 'magic', True)     # the runes glow after dark
    # gallery railing round the tank's foot
    for a in range(-80, 81, 16):
        x = cx + int(math.sin(math.radians(a)) * (rt + 3))
        y = top + 1 + int(10 * math.cos(math.radians(a)))
        img.rect_(x, y - 7, 1, 8, P['iron'][3] if a < 0 else P['iron'][2])
    for dy in (0, -6):
        for a in range(-86, 87, 2):
            x = cx + int(math.sin(math.radians(a)) * (rt + 3))
            y = top + 1 + dy + int(10 * math.cos(math.radians(a)))
            img.px_(x, y - 1, P['iron'][3] if a < 0 else P['iron'][1])
    # conical roof, a finial, the crooked stovepipe
    A.cone(img, cx, ttop, rt + 3, 10, 30, 'shingle', seed=26)
    img.rect_(cx, ttop - 36, 1, 7, '#e8c14e'); img.px_(cx, ttop - 37, '#fbe594')
    img.ellipse_(cx + 0.5, ttop - 33, 1.6, 1.6, '#c9a6ff')
    sp = A.stovepipe(22, bend=4)
    img.paste_(sp, cx + 12, ttop - 14 - sp.h + 6)
    cv.emit('smoke', cx + 21, ttop - 14 - sp.h + 6, 0.6)
    cv.emit('motes', cx + 21, ttop - 14 - sp.h + 6, 0.6)
    cv.emit('motes', cx, ttop - 20, 0.4)
    # portholes up the stair
    for (ox, oy) in ((-10, base - 30), (9, base - 55), (-6, base - 80)):
        w = A.round_window(9, 'brick', '#9a6be0')
        img.paste_(w, cx + ox - 5, oy - 5)
        cv.light(cx + ox, oy, 22, VIOLET, 'magic', True)
    # the door: an arched plank door in a stone portal at the head of the steps
    dx, dw = _door(cv, 'tower')
    pw = 22
    px0 = cx - pw // 2
    portal = A.wall('stone', pw + 6, 30, 27)
    img.paste_(portal, px0 - 3, base - 28)
    img.rect_(px0 - 3, base - 28, pw + 6, 1, st[4])
    d = A.plank_door(pw, 24, tone='wood', ajar=0.3, glow='#c9a6ff', step=False)
    for x in range(pw):                                      # arch the top
        k = abs(x - (pw - 1) / 2) / ((pw - 1) / 2)
        cut = int(round((1 - math.sqrt(max(0, 1 - k * k))) * 6))
        d.a[:cut, x] = 0
    img.paste_(ink(d), px0, base - 24)
    for i in range(4):                                      # steps down to the square
        y = base + i * 5 - 1
        w_ = dw - 4 + i * 2
        img.rect_(cx - w_ // 2, y, w_, 5, st[2]); img.rect_(cx - w_ // 2, y, w_, 1, st[4])
        img.rect_(cx - w_ // 2, y + 4, w_, 1, INK)
        img.rect_(cx - w_ // 2 - 1, y, 1, 5, INK); img.rect_(cx + w_ // 2, y, 1, 5, INK)
    img.rect_(cx - (dw + 2) // 2, B - 3, dw + 2, 3, st[2]); img.rect_(cx - (dw + 2) // 2, B - 3, dw + 2, 1, st[4])
    ln = A.lantern()
    img.paste_(ln, px0 + pw + 3, base - 26)
    cv.light(px0 + pw + 6, base - 20, 34, '#c9a6ff', 'magic', True)
    cv.light(cx, base - 6, 30, '#c9a6ff', 'magic', False)
    # in the corners: herbs in pots, a crystal ball on a stone post, a broom against the wall
    for i, x in enumerate((L - 2, L + 9)):
        pot = Img.new(10, 12)
        pot.poly_([(1, 6), (9, 6), (8, 11), (2, 11)], P['brick'][2]); pot.rect_(1, 6, 8, 1, P['brick'][4])
        for k in range(6):
            pot.px_(2 + k, 5 - (k * 7 + i) % 4, P['leaf'][2 + k % 2]); pot.px_(3 + k % 4, 3 - k % 3, P['leaf'][3])
        pot.px_(5, 1 + i, '#c9a6ff')
        img.paste_(A.outline(pot, INK), x, B - 12 - i * 3)
    ball = Img.new(10, 16)
    ball.rect_(2, 8, 6, 8, st[2]); ball.rect_(2, 8, 2, 8, st[3]); ball.rect_(1, 7, 8, 2, st[4])
    ball.ellipse_(5, 4, 4, 4, '#6b3fa0'); ball.ellipse_(4.5, 3.5, 2.6, 2.6, '#9a6be0'); ball.px_(3, 2, '#ffffff')
    img.paste_(A.outline(ball, INK), R_ - 12, B - 17)
    cv.light(R_ - 7, B - 13, 18, '#9a6be0', 'magic', True)
    broom = Img.new(6, 22)
    broom.rect_(2, 0, 1, 14, P['wood'][3])
    broom.poly_([(0, 22), (1, 13), (4, 13), (6, 22)], P['straw'][2]); broom.rect_(1, 13, 4, 1, '#6b3fa0')
    img.paste_(A.outline(broom, INK), R_ - 22, B - 24)
    return _finish('tower', cv)


# -------------------------------------------------------------------------------- kennel
def _draw_kennel() -> Facade:
    """A barn-red plank barn under a gambrel shingle roof: a hay door and hoist beam in the gable,
    the big door slid aside on the heat lamp's glow, cages and a dog house along the wall."""
    cv = _cv('kennel', over=4)
    img, L, R_, B = cv.img, cv.L, cv.R, cv.B
    H = 36
    red = 'barn'
    A.R['barn'] = ['#3c1d19', '#5a2a22', '#7a3a2c', '#95513a', '#b0704f']
    A.front_wall(cv, 'siding', H, seed=31, tone='barn', plinth=4)
    for x in range(L + 2, R_, 5):                             # vertical battens over the boards
        img.rect_(x, B - H, 1, H - 4, A.R['barn'][1])
    roof = A.roof_gable(cv, 'shingle', H, [(0, 0), (0.17, 26), (0.5, 40), (0.83, 26), (1, 0)],
                        gable='siding', gable_tone='barn', seed=32)
    A.moss(img, L, roof['top'] + 10, R_, roof['apex'] + 2, seed=3, n=22)
    cup = A.cupola(16, 10)
    cxr = int(roof['cx'])
    cy_ = roof['top'] + 22
    img.paste_(cup, cxr - cup.w // 2, cy_ - cup.h)
    wv = A.weathervane('dog')
    img.paste_(wv, cxr - 5, cy_ - cup.h - wv.h + 2)
    # the hay door and hoist beam
    hx = int(roof['cx'])
    hy = roof['apex'] + 12
    img.rect_(hx - 8, hy, 16, 14, A.R['barn'][1])
    for x in range(hx - 7, hx + 8, 3):
        img.rect_(x, hy + 1, 1, 12, A.R['barn'][3])
    img.line_(hx - 7, hy + 13, hx + 7, hy + 1, A.R['barn'][4])
    img.rect_(hx - 9, hy - 1, 18, 1, INK); img.rect_(hx - 9, hy + 14, 18, 1, INK)
    img.rect_(hx - 9, hy - 1, 1, 16, INK); img.rect_(hx + 8, hy - 1, 1, 16, INK)
    img.rect_(hx - 2, hy - 6, 4, 4, P['wood'][2]); img.rect_(hx - 2, hy - 6, 4, 1, P['wood'][4])
    img.rect_(hx, hy - 2, 1, 12, '#b8a07a')
    img.rect_(hx - 1, hy + 9, 3, 2, R['steel'][3])
    # the barn door: slid aside to the left on its rail, the doorway warm with the heat lamp
    dx, dw = _door(cv, 'kennel')
    img.rect_(dx - dw // 2 - 4, B - 33, dw + dw // 2 + 8, 2, R['steel'][2])
    img.rect_(dx - dw // 2 - 4, B - 33, dw + dw // 2 + 8, 1, R['steel'][4])
    img.paste_(A.doorway(dw, 30, glow='#ff8a4a', inside='heat', frame='wood'), dx, B - 30)
    leaf = A.plank_door(dw // 2 + 4, 29, tone='barn', step=False)
    img.paste_(leaf, dx - dw // 2 - 3, B - 29)
    cv.light(dx + dw / 2, B - 16, 46, '#ff7a4a', 'glow', False)
    sg = A.board('ПИТОМНИК', bg='#e9dcc0', fg='#5a2a22', pad=2)
    paw = Img.new(7, 7)
    for (px_, py_) in ((1, 1), (3, 0), (5, 1)):
        paw.rect_(px_, py_, 1, 2, '#5a2a22')
    paw.rect_(2, 3, 3, 3, '#5a2a22'); paw.px_(1, 4, '#5a2a22'); paw.px_(5, 4, '#5a2a22')
    sgw = Img.new(sg.w + 9, sg.h)
    sgw.rect_(0, 0, 11, sg.h, '#e9dcc0'); sgw.paste_(paw, 2, 3)
    sgw.paste_(sg, 9, 0)
    img.paste_(ink(sgw), int(roof['cx']) - sgw.w // 2, roof['eave'] - 2)
    # windows: a small one each side, red with the lamp inside
    for wx in (L + 8, R_ - 22):
        img.paste_(A.window(14, 12, 'wood', bars=0, seed=wx, curtain='#a8323b'), wx, B - 30)
        cv.light(wx + 7, B - 24, 20, '#ff8a5a', 'window', True)
    # cages, a dog house, straw
    img.paste_(A.cage(20, 16, 1, 'pup'), L + 4, B - 16)
    img.paste_(A.cage(18, 14, 2), L + 24, B - 14)
    img.paste_(A.dog_house(20, 17), R_ - 24, B - 17)
    img.paste_(A.straw_bale(16, 10), dx + dw + 2, B - 10)
    bowl = Img.new(8, 4); bowl.ellipse_(4, 2, 4, 2, R['steel'][3]); bowl.rect_(2, 1, 4, 1, '#6b4f2a')
    img.paste_(A.outline(bowl, INK), R_ - 34, B - 5)
    ln = A.lantern()
    img.paste_(ln, dx + dw + 3, B - 30)
    cv.light(dx + dw + 6, B - 24, 30, WARM, 'lamp', True)
    return _finish('kennel', cv)


# -------------------------------------------------------------------------------- trader
def _draw_trader() -> Facade:
    """A black-market shed patched together from planks and tin, a tarp roof roped down and held
    by old tyres, a striped awning, goods in the lit doorway, crates and sacks, a lantern, and the
    hand-painted «%»."""
    cv = _cv('trader', over=6)
    img, L, R_, B = cv.img, cv.L, cv.R, cv.B
    H = 34
    W = cv.W
    img.paste_(A.wall('corr', 34, H, 41, 'tin'), L, B - H)
    img.paste_(A.wall('plankgrey', 30, H, 42), L + 32, B - H)
    img.paste_(A.wall('planks', 32, H, 43), L + 62, B - H)
    img.paste_(A.wall('corr', 14, 14, 44, 'tinred'), L + 76, B - H + 6)
    img.rect_(L, B - 4, W, 4, P['woodgrey'][1]); img.rect_(L, B - 4, W, 1, P['woodgrey'][3])
    img.rect_(R_ - 3, B - H, 3, H, '#000000', 0.22)
    roof = A.roof_ew(cv, 'canvas', H, rise=cv.D // 2, seed=45, ov=5)
    # ropes over the tarp and tyres weighing it down
    for x in (L + 8, L + 46, R_ - 10):
        img.line_(x, roof['ridge'], x + 4, roof['eave'], '#b8a07a')
        img.line_(x + 1, roof['ridge'], x + 5, roof['eave'], '#6b5a40')
    for (x, y) in ((L + 18, roof['ridge'] + 12), (R_ - 30, roof['ridge'] + 22), (L + 56, roof['ridge'] + 5)):
        img.paste_(A.tyre(16), x, y)
    img.paste_(A.wall('corr', 20, 12, 46, 'tinred'), R_ - 40, roof['ridge'] + 4)
    # awning over the door, a lantern hanging from it
    dx, dw = _door(cv, 'trader')
    img.paste_(A.doorway(dw, 26, glow=WARM, inside='shelves', frame='wood'), dx, B - 26)
    cur = Img.new(9, 22)
    for x in range(9):
        cur.rect_(x, 0, 1, 22 - (x * 2) // 3, ['#7a2a26', '#a8323b', '#8f2c2c'][x % 3])
    img.paste_(ink(cur), dx + 2, B - 24)
    aw = A.awning(dw + 18, 8, '#8f4a2e', '#d9c7a2')
    img.paste_(aw, dx - 9, B - 36)
    ln = A.lantern()
    img.paste_(ln, dx - 8, B - 30)
    cv.light(dx - 5, B - 24, 40, WARM, 'lamp', True)
    cv.light(dx + dw / 2, B - 12, 30, WARM, 'glow', False)
    # the hand-painted % on a pale plank, a chalkboard of prices
    from lib import grid
    pc = grid(['.###.....##.', '##.##...##..', '##.##..##...', '.###..##....', '.....##.....', '....##..###.',
               '...##..##.##', '..##...##.##', '.##.....###.'], {'#': '#b8322e'})
    pl = Img.new(pc.w + 6, pc.h + 6)
    pl.rect_(0, 1, pl.w, pl.h - 1, '#d9c7a2'); pl.rect_(0, 1, pl.w, 1, '#eee2c4')
    pl.rect_(0, pl.h - 2, pl.w, 1, '#a8906a')
    pl.paste_(pc, 3, 3)
    pl.px_(pl.w - 3, 5, '#b8322e'); pl.px_(pl.w - 3, 6, '#b8322e')          # a paint drip
    pl.a[0, :] = 0
    img.paste_(ink(pl), dx + dw + 3, B - 33)
    ch = Img.new(14, 12, '#2a332c')
    for y in range(2, 10, 2):
        ch.rect_(2, y, 5 + (y * 3) % 6, 1, '#c9c8bd')
        ch.rect_(10, y, 2, 1, '#e8c14e')
    img.paste_(ink(ch), R_ - 15, B - 31)
    # goods outside
    img.paste_(crate(), L + 2, B - 16)
    img.paste_(crate(14, 13, dark=True), L + 4, B - 29)
    img.paste_(sack('#8a7a5a'), L + 18, B - 12)
    img.paste_(barrel(), R_ - 16, B - 18)
    img.paste_(sack('#6f6352'), R_ - 28, B - 12)
    return _finish('trader', cv)


# ---------------------------------------------------------------------------------- store
def _draw_store() -> Facade:
    """The storehouse: a red-brick warehouse under tar-paper, a cross gable over the door with a
    loft hatch and a hoist beam, a roll-up shutter half raised on the shelves, crates and a pallet
    of sacks along the wall."""
    cv = _cv('store', over=3)
    img, L, R_, B = cv.img, cv.L, cv.R, cv.B
    H = 44
    A.front_wall(cv, 'brick', H, seed=51, plinth=5, plinth_mat='concrete')
    roof = A.roof_ew(cv, 'tar', H, seed=51)
    dx, dw = _door(cv, 'store')
    # the cross gable over the door, shallower than the main roof
    g = A.roof_gable(cv, 'tar', H, [(0, 0), (0.5, 20), (1, 0)], gable='brick', seed=52,
                     x0=dx - 6, x1=dx + dw + 6, D=cv.D // 2, ov=3)
    gx = int(g['cx'])
    # loft hatch and hoist beam in the gable
    img.rect_(gx - 5, g['eave'] - 16, 10, 12, P['wood'][1])
    for x in range(gx - 4, gx + 5, 3):
        img.rect_(x, g['eave'] - 15, 1, 10, P['wood'][3])
    img.rect_(gx - 6, g['eave'] - 17, 12, 1, INK); img.rect_(gx - 6, g['eave'] - 4, 12, 1, INK)
    img.rect_(gx - 6, g['eave'] - 17, 1, 13, INK); img.rect_(gx + 5, g['eave'] - 17, 1, 13, INK)
    st = R['steel']
    img.rect_(gx - 2, g['apex'] + 2, 4, 5, P['wood'][2]); img.rect_(gx - 2, g['apex'] + 2, 4, 1, P['wood'][4])
    img.rect_(gx - 1, g['apex'] + 7, 3, 2, st[3])
    img.rect_(gx, g['apex'] + 9, 1, 12, '#2a2426')
    img.rect_(gx - 1, g['apex'] + 21, 3, 2, st[3]); img.px_(gx + 1, g['apex'] + 23, st[3])
    img.rect_(dx - 1, B - 36, dw + 2, 36, P['brick'][0])
    img.paste_(A.rollup(dw + 2, 34, 23, seed=5), dx - 1, B - 34)
    cv.light(dx + dw / 2, B - 10, 40, WARM, 'glow', False)
    sg = A.board('КАПТЁРКА', bg='#2e3a2c', fg='#e8e2cf', pad=2)
    img.paste_(sg, dx + dw // 2 - sg.w // 2, B - H + 1)
    for wx in (L + 8, R_ - 22):
        img.paste_(A.window(14, 12, 'iron', bars=3, seed=wx), wx, B - 36)
        A.lintel(img, wx, B - 36, 14)
        _win_light(cv, wx, B - 36, 14, 12)
    # crates in a pyramid, a pallet of sacks, a downpipe
    img.paste_(crate(), L + 4, B - 16)
    img.paste_(crate(), L + 20, B - 16)
    img.paste_(crate(dark=True), L + 12, B - 30)
    img.paste_(A.pallet_stack(22, 1), R_ - 30, B - 5)
    for i, x in enumerate((R_ - 29, R_ - 19)):
        img.paste_(sack(['#a79a78', '#8f8468'][i]), x, B - 16)
    img.paste_(sack('#9a8e70'), R_ - 25, B - 23)
    img.paste_(A.downpipe(H - 2), R_ - 6, B - H + 1)
    lamp, (lbx, lby) = A.wall_lamp()
    img.paste_(lamp, dx - 14, B - 38)
    cv.light(dx - 14 + lbx, B - 38 + lby, 36, WARM, 'lamp', True)
    return _finish('store', cv)


# ---------------------------------------------------------------------------------- kiosk
def _draw_kiosk() -> Facade:
    """A little tin kiosk: display windows full of bottles and tins, the door open on the lit
    counter, a striped awning, posters on its sides, a light box saying ЛАРЁК on the roof."""
    cv = _cv('kiosk', over=5)
    img, L, R_, B = cv.img, cv.L, cv.R, cv.B
    H = 40
    A.front_wall(cv, 'corr', H, seed=61, tone='sideblue', plinth=4, plinth_mat='concrete')
    roof = A.roof_flat(cv, H, parapet=3, mat='corr', seed=61, surface='felt', tone='sideblue')
    dx, dw = _door(cv, 'kiosk')
    img.paste_(A.doorway(dw, 28, glow=WARM, inside='shelves', frame='white'), dx, B - 28)
    cv.light(dx + dw / 2, B - 12, 34, WARM, 'glow', False)
    # display windows with goods
    rr = rng('kiosk')
    for wx in (L + 2, R_ - 15):
        img.rect_(wx, B - 30, 13, 20, R['white'][3])
        img.rect_(wx + 1, B - 29, 11, 18, R['glass'][1])
        for row in range(3):
            y = B - 27 + row * 6
            img.rect_(wx + 1, y + 4, 11, 1, R['white'][2])
            for x in range(wx + 2, wx + 12, 2):
                c = rr.choice(['#5e9360', '#8a5a2a', '#c9c8bd', '#a8323b', '#e8c14e', '#3d5f8c'])
                img.rect_(x, y + 1, 1, 3, c); img.px_(x, y, R['glass'][3])
        img.rect_(wx + 9, B - 29, 1, 18, R['glass'][3])
        img.rect_(wx, B - 31, 13, 1, INK); img.rect_(wx, B - 10, 13, 1, INK)
        img.rect_(wx, B - 30, 1, 20, INK); img.rect_(wx + 12, B - 30, 1, 20, INK)
        img.rect_(wx - 1, B - 10, 15, 2, R['white'][4])
    # the serving hatch: the left pane swung up, a ledge with a saucer of change
    hx0 = L + 3
    img.rect_(hx0, B - 25, 11, 9, '#2a201d')
    img.rect_(hx0 + 1, B - 24, 9, 6, '#6b4f2a'); img.rect_(hx0 + 1, B - 24, 9, 1, '#9a7a48')
    img.rect_(hx0 + 3, B - 22, 2, 3, '#c9c8bd'); img.rect_(hx0 + 6, B - 23, 2, 4, '#5e9360')
    img.rect_(hx0 - 1, B - 16, 13, 2, R['white'][4]); img.rect_(hx0 - 1, B - 14, 13, 1, INK)
    img.ellipse_(hx0 + 8, B - 17, 2, 1, '#e8c14e')
    img.rect_(hx0 - 1, B - 27, 13, 2, R['glass'][2]); img.rect_(hx0 - 1, B - 28, 13, 1, INK)
    cv.light(hx0 + 5, B - 20, 18, WARM, 'window', True)
    # the awning over the whole front
    aw = A.awning(cv.W + 8, 9, '#b8322e', '#e9e2d0')
    img.paste_(aw, L - 4, B - H - 3)
    # the light box on the roof
    sx0, sy0, sx1, sy1 = roof['surface']
    t = A.sign_text('ЛАРЁК', '#fff4c8', '#8a2a2a')
    box = Img.new(t.w + 8, t.h + 6)
    box.rect_(0, 0, box.w, box.h, '#c8433a'); box.rect_(0, 0, box.w, 1, '#ec8577')
    box.paste_(t, 4, 3)
    box = ink(box)
    bx = cv.cx - box.w // 2
    by = sy1 - box.h - 4
    for x in (bx + 4, bx + box.w - 6):
        img.rect_(x, by + box.h - 1, 2, 6, R['steel'][1])
    img.paste_(box, bx, by)
    cv.light(cv.cx, by + box.h // 2, 30, '#ff8a6a', 'neon', True)
    # posters on the sides of the door
    img.paste_(A.poster(8, 11, 7, 'figure'), dx - 1 - 8, B - 40 + 6)
    img.paste_(A.poster(8, 11, 8, 'text'), dx + dw + 1, B - 40 + 6)
    img.paste_(A.milk_can(), R_ - 10, B - 13)
    return _finish('kiosk', cv)


# ------------------------------------------------------------------------------------ hq
def _hq_frame(frame: int) -> Cv:
    cv = _cv('hq', over=4)
    img, L, R_, B = cv.img, cv.L, cv.R, cv.B
    H = 70
    A.front_wall(cv, 'plaster', H, seed=71, tone='ochre', plinth=8)
    wt = R['white']
    # floor band and top cornice in white, pilasters
    for y, h in ((B - 38, 3), (B - H, 4)):
        img.rect_(L, y, cv.W, h, wt[3]); img.rect_(L, y, cv.W, 1, wt[4]); img.rect_(L, y + h, cv.W, 1, '#000000', 0.3)
    for x in (L, R_ - 5):
        img.rect_(x, B - H, 5, H - 8, wt[3]); img.rect_(x, B - H, 1, H - 8, wt[4]); img.rect_(x + 4, B - H, 1, H - 8, wt[1])
    roof = A.roof_hip(cv, 'tin', H, seed=72)
    for chx in (roof['rl'] + 6, roof['rr'] - 18):
        A.roof_stack(img, chx, 10, roof['ridge'] - 12, roof['ridge'] + 6, roof['ridge'] + 6, seed=chx)
    # the flag on the ridge
    fl = A.flag(frame, pole=34)
    img.paste_(fl, cv.cx - 1, roof['ridge'] - 32)
    dx, dw = _door(cv, 'hq')
    # portico: pilasters and a pediment round the door
    for x in (dx - 5, dx + dw + 1):
        img.rect_(x, B - 34, 4, 34, wt[3]); img.rect_(x, B - 34, 1, 34, wt[4]); img.rect_(x + 3, B - 34, 1, 34, wt[1])
        img.rect_(x - 1, B - 35, 6, 2, wt[4])
    d = A.plank_door(dw, 30, tone='wood', ajar=0.4, glow=WARM, brace=False, window_=True)
    img.paste_(d, dx, B - 30)
    cv.light(dx + dw * 0.25, B - 10, 34, WARM, 'glow', False)
    sg = A.board('ШТАБ', bg='#8a2a2a', fg='#f2c46a', pad=2, frame='#c9a063')
    img.paste_(sg, dx + dw // 2 - sg.w // 2, B - 43)
    # balcony over the portico, the door onto it
    bx0, bx1 = dx - 6, dx + dw + 6
    img.paste_(A.plank_door(16, 24, tone='wood', brace=False, window_=True, step=False), dx + dw // 2 - 8, B - 66)
    img.rect_(bx0, B - 47, bx1 - bx0, 3, wt[3]); img.rect_(bx0, B - 47, bx1 - bx0, 1, wt[4])
    img.rect_(bx0, B - 44, bx1 - bx0, 1, INK)
    for x in range(bx0 + 1, bx1 - 1, 3):
        img.rect_(x, B - 55, 1, 8, wt[2])
    img.rect_(bx0, B - 56, bx1 - bx0, 2, wt[4]); img.rect_(bx0, B - 54, bx1 - bx0, 1, wt[1])
    # windows: ground floor barred, first floor with curtains
    for wx in (L + 10, R_ - 50, R_ - 26):
        img.paste_(A.window(14, 20, 'white', bars=2, seed=wx), wx, B - 33)
        _win_light(cv, wx, B - 33, 14, 20)
    for wx in (L + 10, L + 34, R_ - 50, R_ - 26):
        img.paste_(A.window(14, 20, 'white', curtain='#a8323b' if wx % 2 else '#d9cfb6', seed=wx + 1), wx, B - 66)
        _win_light(cv, wx, B - 66, 14, 20)
    cv.light(cv.cx, B - 56, 18, WARM, 'window', True)
    # board of honour, lamps by the door, the loudspeaker on the corner
    img.paste_(A.honour_board(24, 24), L + 28, B - 33)
    lamp, (lbx, lby) = A.wall_lamp()
    img.paste_(lamp, dx + dw + 6, B - 36)
    cv.light(dx + dw + 6 + lbx, B - 36 + lby, 36, WARM, 'lamp', True)
    img.paste_(A.loudspeaker(), R_ - 14, B - 68)
    return cv


def _draw_hq() -> Facade:
    """Two storeys of ochre plaster with white pilasters and cornices under a green hip roof, the
    red flag on the ridge (waving), a portico with its balcony, ШТАБ over the door, the board of
    honour beside it, a loudspeaker on the corner."""
    return _finish('hq', [_hq_frame(f) for f in range(4)], fps=6)


# ---------------------------------------------------------------------------------- club
CLUB = ['#241018', '#3a1a26', '#552636', '#733648', '#8f4a5c']


def _club_frame(frame: int) -> Cv:
    cv = _cv('club', over=3)
    img, L, R_, B = cv.img, cv.L, cv.R, cv.B
    A.R['club'] = CLUB
    H = 36
    A.front_wall(cv, 'siding', H, seed=81, tone='club', plinth=5)
    roof = A.roof_ew(cv, 'shifer', H, seed=82)
    # the false front: a stepped board facade rising well over the eave, painted night-dark
    fx0, fx1 = L + 12, R_ - 12
    top = B - H - 46
    cx = cv.cx
    shape = [(fx0, B - H + 2), (fx0, top + 16), (fx0 + 14, top + 16), (fx0 + 14, top + 8),
             (cx - 22, top + 8), (cx - 22, top), (cx + 22, top), (cx + 22, top + 8),
             (fx1 - 14, top + 8), (fx1 - 14, top + 16), (fx1, top + 16), (fx1, B - H + 2)]
    board_ = Img.new(fx1 - fx0, B - H - top + 2, '#221219')
    for x in range(0, board_.w, 6):
        board_.rect_(x, 0, 1, board_.h, '#170b10'); board_.rect_(x + 1, 0, 1, board_.h, '#2e1822')
    m = A.fill_poly(img, shape, board_, fx0, top)
    img.rect_(fx0 + 1, B - H - 2, fx1 - fx0 - 2, 3, '#000000', 0.35)
    A.edge(img, m, INK)
    inner = [(x + (3 if x < cx else -3), y + 3) for x, y in shape[1:-1]]
    for (xa, ya), (xb, yb) in zip(inner, inner[1:]):
        img.line_(xa, ya, xb, yb, '#8a6a3a')
    # marquee bulbs along the trim, chasing (2 × 2 each)
    k = 0
    for (xa, ya), (xb, yb) in zip(inner, inner[1:]):
        n = max(1, int(max(abs(xb - xa), abs(yb - ya)) / 5))
        for i in range(n):
            x = int(xa + (xb - xa) * i / n); y = int(ya + (yb - ya) * i / n)
            on = (k + frame) % 2 == 0
            img.rect_(x - 1, y - 1, 2, 2, '#fff1b0' if on else '#5a4a2a')
            if on:
                img.px_(x - 1, y - 1, '#ffffff')
            k += 1
    # КЛУБ in big pink neon, one letter stutters; suits flanking it, one lit white in turn
    ty = top + 12
    x = cx - 23
    for i, ch in enumerate('КЛУБ'):
        on = not (frame == 2 and i == 1)
        g = A.neon(ch, 'neonpink', on, k=2)
        img.paste_(g, x - 2, ty - 2)
        x += 12
    cv.light(cx, ty + 7, 64, '#ff3d8b', 'neon', False)
    suits = ['spade', 'heart', 'diamond', 'club']
    for i, (sx, sy) in enumerate(((fx0 + 5, top + 21), (fx0 + 15, top + 29), (fx1 - 22, top + 29), (fx1 - 12, top + 21))):
        red = suits[i] in ('heart', 'diamond')
        col = '#ffffff' if i == frame else ('#ff5a6a' if red else '#8af2fb')
        sg = A.suit(suits[i], col)
        img.paste_(A.outline(sg.silhouette('#a81e5e' if red else '#157585'), '#a81e5e' if red else '#157585').opacity(0.85), sx - 1, sy - 1)
        img.paste_(sg, sx, sy)
    cv.light(fx0 + 12, top + 28, 26, '#27d3e6', 'neon', False)
    cv.light(fx1 - 12, top + 28, 26, '#ff5a6a', 'neon', False)
    # the door: double doors with portholes, a warm spill
    dx, dw = _door(cv, 'club')
    img.paste_(A.doorway(dw, 28, glow=WARM, frame='wood'), dx, B - 28)
    for lx in (dx + 2, dx + dw // 2 + 4):
        leaf = A.plank_door(dw // 2 - 6, 24, tone='club', brace=False, step=False)
        img.paste_(leaf, lx, B - 27)
    for cxp in (dx + 9, dx + dw - 9):
        img.ellipse_(cxp, B - 20, 3, 3, INK); img.ellipse_(cxp, B - 20, 2, 2, '#f4c86a'); img.px_(cxp - 1, B - 21, '#fff6d0')
    cv.light(dx + dw / 2, B - 16, 34, WARM, 'glow', True)
    for i, px in enumerate((dx - 14, dx + dw + 3)):
        img.paste_(A.poster(11, 15, 90 + i, 'figure' if i else 'star'), px, B - 31)
    for wx in (L + 4, R_ - 16):
        img.paste_(A.window(12, 16, 'wood', curtain='#a8323b', seed=wx), wx, B - 30)
        _win_light(cv, wx, B - 30, 12, 16)
    return cv


def _draw_club() -> Facade:
    """A barrack turned club: a dark stepped false front over the eave with marquee bulbs, КЛУБ in
    pink neon that stutters, card suits lit in turn, double doors with warm portholes, posters."""
    return _finish('club', [_club_frame(f) for f in range(4)], fps=4)


# ------------------------------------------------------------------------------- canteen
def _draw_canteen() -> Facade:
    """The canteen: whitewashed walls under a red tin hip roof with СТОЛОВАЯ in letters on it, a
    tall kitchen flue smoking, big curtained windows, milk cans and a potato crate by the door,
    the cat on the bin."""
    cv = _cv('canteen', over=4)
    img, L, R_, B = cv.img, cv.L, cv.R, cv.B
    H = 38
    A.front_wall(cv, 'plaster', H, seed=91, tone='white', plinth=6)
    roof = A.roof_hip(cv, 'tinred', H, seed=92)
    # kitchen flue at the back right
    sp = A.stovepipe(36)
    img.paste_(sp, R_ - 36, roof['top'] + 18 - sp.h + 14)
    cv.emit('smoke', R_ - 30, roof['top'] + 18 - sp.h + 14, 0.9)
    # letters on the roof, on a frame
    t = A.sign_text('СТОЛОВАЯ', '#f3ead2', '#4a1418')
    bw = t.w + 6
    bx = cv.cx - bw // 2
    by = roof['eave'] - 26
    for x in (bx + 3, bx + bw - 5):
        img.rect_(x, by + 9, 2, 12, R['steel'][1])
    img.rect_(bx, by + 8, bw, 2, R['steel'][2])
    img.paste_(t, bx + 3, by)
    dx, dw = _door(cv, 'canteen')
    img.paste_(A.plank_door(dw + 2, 26, tone='wood', window_=True), dx - 1, B - 26)
    img.paste_(A.canopy(dw + 12, 6, 'tinred', seed=9), dx - 6, B - 34)
    for wx in (L + 8, L + 34, R_ - 50, R_ - 24):
        img.paste_(A.window(16, 20, 'white', curtain='#c9d0c0', seed=wx), wx, B - 32)
        _win_light(cv, wx, B - 32, 16, 20)
    img.paste_(A.milk_can(), dx - 12, B - 13)
    img.paste_(A.milk_can(), dx - 21, B - 13)
    pc = crate(16, 12)
    for i in range(6):
        pc.px_(3 + i * 2, 2 + i % 2, '#8a6a3a'); pc.px_(4 + i * 2, 3, '#a5824a')
    img.paste_(pc, dx + dw + 4, B - 12)
    bin_ = Img.new(10, 13)
    bin_.rect_(0, 2, 10, 11, R['galv'][2]); bin_.rect_(0, 2, 3, 11, R['galv'][3]); bin_.rect_(0, 1, 10, 2, R['galv'][4])
    img.paste_(A.outline(bin_, INK), R_ - 28, B - 14)
    from lib import grid
    cat = grid(['.k...k.', '.kkkkk.', 'kkwkwkk', '.kkkkk.', '..kkkkk', '.kkkkkk'], {'k': '#2a2426', 'w': '#e8c14e'})
    img.paste_(cat, R_ - 27, B - 20)
    img.paste_(A.bench(18), L + 22, B - 8)
    lamp, (lbx, lby) = A.wall_lamp()
    img.paste_(lamp, dx + dw + 3, B - 36)
    cv.light(dx + dw + 3 + lbx, B - 36 + lby, 36, WARM, 'lamp', True)
    return _finish('canteen', cv)


# -------------------------------------------------------------------------------- boiler
def _draw_boiler() -> Facade:
    """The boiler house: a brick shed with furnace-lit windows, a coal heap and a lagged heat main
    out of its wall — and behind it the camp's second landmark, a tall tapering brick stack with
    iron bands, a ladder and a lightning rod, smoking."""
    cv = _cv('boiler', over=6)
    img, L, R_, B = cv.img, cv.L, cv.R, cv.B
    H = 42
    A.front_wall(cv, 'brick', H, seed=101, plinth=5, plinth_mat='concrete')
    # the stack stands behind the house; the roof hides its foot
    scx = R_ - 22
    stop = B - H - cv.D - 118
    A.cylinder(img, scx, stop, B - H - 20, 7, 12, 'brick', ry=2, seed=102)
    st = R['steel']
    for y in range(stop + 6, B - H - 20, 16):
        t = (y - stop) / (B - H - 20 - stop)
        r = 7 + 5 * t
        img.rect_(int(scx - r), y, int(2 * r), 2, st[1]); img.rect_(int(scx - r), y, int(r), 1, st[3])
    for y in range(stop + 4, B - H - 20, 4):                  # the ladder up its left side
        t = (y - stop) / (B - H - 20 - stop)
        r = 7 + 5 * t
        img.rect_(int(scx - r + 2), y, 3, 1, st[3])
    img.rect_(int(scx - 6), stop - 1, 13, 3, P['concrete'][3]); img.rect_(int(scx - 6), stop - 1, 13, 1, P['concrete'][4])
    img.rect_(int(scx - 4), stop, 9, 1, '#0c0a0a')
    for y in range(stop + 2, stop + 10):
        img.rect_(int(scx - 6), y, 13, 1, '#141012', 0.5 * (1 - (y - stop - 2) / 8))
    img.rect_(int(scx + 3), stop - 12, 1, 11, st[3]); img.px_(int(scx + 3), stop - 13, '#e8c14e')
    cv.emit('smoke', scx, stop - 2, 1.4)
    cv.light(scx + 3, stop - 12, 14, '#ff4a3a', 'lamp', True)
    roof = A.roof_ew(cv, 'galv', H, rise=18, seed=103)
    A.monitor(img, L + 14, R_ - 40, roof['ridge'] + 14, 8, 14, 'galv', seed=104)
    cv.emit('steam', L + 30, roof['ridge'] - 2, 0.4)
    dx, dw = _door(cv, 'boiler')
    img.paste_(A.steel_door(dw + 4, 27, tone='steel'), dx - 2, B - 27)
    lamp, (lbx, lby) = A.wall_lamp()
    img.paste_(lamp, dx - 14, B - 30)
    cv.light(dx - 14 + lbx, B - 30 + lby, 34, WARM, 'lamp', True)
    sg = A.board('КОТЕЛЬНАЯ', bg='#2a2a2e', fg='#e8e2cf', pad=2)
    img.paste_(sg, L + 6, B - H + 1)
    for wx in (dx + dw + 6, dx + dw + 21):
        w = A.window(12, 18, 'iron', kind='grid', seed=wx)
        img.paste_(w, wx, B - 28)
        img.rect_(wx + 2, B - 26, 8, 14, '#ff8a3a', 0.35)
        cv.light(wx + 6, B - 19, 22, '#ff9a4a', 'window', True)
    from maps.forge import coal_heap
    img.paste_(coal_heap(), L - 2, B - 22)
    # the lagged heat main leaving through the wall
    pipe = Img.new(14, 24)
    pipe.rect_(0, 0, 14, 7, '#c9c3b2'); pipe.rect_(0, 0, 14, 2, '#e6e0cf')
    pipe.rect_(7, 0, 7, 24, '#c9c3b2'); pipe.rect_(7, 0, 2, 24, '#e6e0cf'); pipe.rect_(12, 0, 2, 24, '#9a9483')
    for y in (4, 12, 20):
        pipe.rect_(7, y, 7, 1, R['galv'][1])
    pipe.rect_(3, 0, 1, 7, R['galv'][1])
    img.paste_(A.outline(pipe, INK).crop(1, 1, 14, 24), R_ - 13, B - 24)
    return _finish('boiler', cv)


# ------------------------------------------------------------------------------- laundry
def _draw_laundry() -> Facade:
    """The laundry: blue weatherboard, a slate roof with a steaming vent, a window fogged from
    inside, washing hung out along the wall, a tub and a washboard by the door."""
    cv = _cv('laundry', over=4)
    img, L, R_, B = cv.img, cv.L, cv.R, cv.B
    H = 40
    A.front_wall(cv, 'siding', H, seed=111, tone='sideblue', plinth=5)
    for x in (L, R_ - 3):
        img.rect_(x, B - H, 3, H - 5, R['white'][2]); img.rect_(x, B - H, 1, H - 5, R['white'][4])
    roof = A.roof_ew(cv, 'shifer', H, seed=112)
    for x in (L + 22, R_ - 26):
        sp = A.stovepipe(18)
        img.paste_(sp, x, roof['ridge'] + 12 - sp.h)
        cv.emit('steam', x + 6, roof['ridge'] + 12 - sp.h, 1.0)
    dx, dw = _door(cv, 'laundry')
    img.paste_(A.plank_door(dw + 2, 24, tone='sideblue', window_=True), dx - 1, B - 24)
    sg = A.board('ПРАЧЕЧНАЯ', bg='#e9e2d0', fg='#2c3a4a', pad=1)
    img.paste_(sg, dx + dw // 2 - sg.w // 2, B - H + 1)
    w = A.window(14, 16, 'white', seed=3)
    w.rect_(2, 2, 10, 12, '#c9d3d6', 0.75)
    for (x, y) in ((4, 6), (8, 9), (6, 11), (10, 5)):
        w.px_(x, y, '#e9f0f0')
    img.paste_(w, R_ - 22, B - 28)
    cv.light(R_ - 15, B - 20, 20, WARM, 'window', True)
    cv.emit('steam', dx + dw / 2, B - 26, 0.4)
    lamp, (lbx, lby) = A.wall_lamp()
    img.paste_(lamp, dx + dw + 2, B - 30)
    cv.light(dx + dw + 2 + lbx, B - 30 + lby, 32, WARM, 'lamp', True)
    img.paste_(A.laundry_line(34, 2), L + 4, B - 27)
    for x in (L + 4, L + 37):
        img.rect_(x, B - 28, 1, 3, R['steel'][2])
    tub = Img.new(20, 9)
    tub.poly_([(0, 1), (20, 1), (18, 9), (2, 9)], R['galv'][2]); tub.rect_(0, 1, 20, 2, R['galv'][4])
    tub.rect_(2, 2, 16, 1, '#b8c8cc')
    img.paste_(A.outline(tub, INK), dx + dw + 3, B - 10)
    wb = Img.new(7, 14)
    wb.rect_(0, 0, 7, 14, P['wood'][3])
    for y in range(3, 12, 2):
        wb.rect_(1, y, 5, 1, R['galv'][3])
    img.paste_(A.outline(wb, INK), R_ - 12, B - 16)
    return _finish('laundry', cv)


# -------------------------------------------------------------------------------- garage
def _draw_garage() -> Facade:
    """The garage: precast concrete under a flat roof, big green swing gates with a wicket and
    ГАРАЖ painted on, tyres and fuel drums at the side."""
    cv = _cv('garage', over=3)
    img, L, R_, B = cv.img, cv.L, cv.R, cv.B
    H = 44
    A.front_wall(cv, 'panel', H, seed=121, plinth=4, plinth_mat='concrete')
    roof = A.roof_flat(cv, H, parapet=4, mat='panel', seed=121, surface='felt')
    sx0, sy0, sx1, sy1 = roof['surface']
    img.paste_(A.tyre_stack(2), sx1 - 26, sy0 + 20)
    # a heap under a roped tarp, and a few planks thrown up there
    heap = Img.new(34, 16)
    heap.ellipse_(17, 10, 17, 7, R['khaki'][1]); heap.ellipse_(15, 8, 14, 6, R['khaki'][2])
    heap.ellipse_(12, 6, 8, 4, R['khaki'][3])
    for x in (8, 18, 27):
        heap.line_(x, 2, x + 2, 15, '#b8a07a')
    heap.rect_(1, 13, 32, 1, R['khaki'][0])
    img.paste_(A.outline(heap, INK), sx0 + 26, sy0 + 26)
    for i, y in enumerate((sy1 - 12, sy1 - 9)):
        img.rect_(sx0 + 6 + i * 3, y, 30, 2, P['woodgrey'][3]); img.rect_(sx0 + 6 + i * 3, y + 2, 30, 1, INK)
    img.rect_(sx0 + 12, sy0 + 10, 4, 12, R['galv'][2]); img.rect_(sx0 + 12, sy0 + 10, 1, 12, R['galv'][4])
    img.ellipse_(sx0 + 14, sy0 + 9, 4, 2, R['galv'][3])
    dx, dw = _door(cv, 'garage')
    img.rect_(dx - 2, B - 40, dw + 4, 40, P['concrete'][1])
    img.paste_(A.rollup(dw, 38, 0, seed=12, tone='sidegreen', stencil='ГАРАЖ'), dx, B - 38)
    lamp, (lbx, lby) = A.wall_lamp()
    img.paste_(lamp, dx + dw // 2 - 6, B - 44)
    cv.light(dx + dw // 2 - 6 + lbx, B - 44 + lby, 44, WARM, 'lamp', True)
    img.paste_(A.window(14, 12, 'iron', bars=2, seed=4), R_ - 22, B - 34)
    _win_light(cv, R_ - 22, B - 34, 14, 12)
    img.paste_(A.fuel_drum(), R_ - 16, B - 16)
    img.paste_(A.fuel_drum('#8f4526'), R_ - 29, B - 16)
    img.paste_(A.tyre_stack(3), L - 2, B - 19)
    return _finish('garage', cv)


# ----------------------------------------------------------------------------------- kpp
def _draw_kpp() -> Facade:
    """The gate house: a whitewashed booth under a green hip roof with a guard window, КПП over
    the glazed door, a searchlight on the roof, and the striped boom down across the way."""
    cv = _cv('kpp', over=14)
    img, L, R_, B = cv.img, cv.L, cv.R, cv.B
    H = 40
    bx1 = L + 64
    A.front_wall(cv, 'plaster', H, seed=131, tone='white', plinth=6, x1=bx1)
    img.rect_(L, B - 12, bx1 - L, 4, '#8f2c2c'); img.rect_(L, B - 12, bx1 - L, 1, '#b54a3e')
    roof = A.roof_hip(cv, 'tin', H, seed=132, x1=bx1)
    dx, dw = _door(cv, 'kpp')
    img.paste_(A.doorway(dw, 28, glow=WARM, frame='white'), dx, B - 28)
    for lx in (dx + 2, dx + dw // 2):
        leaf = A.plank_door(dw // 2 - 2, 25, tone='sidegreen', brace=False, window_=True, step=False)
        img.paste_(leaf, lx, B - 28 + 3)
    sg = A.board('КПП', bg='#8a2a2a', fg='#f3ead2', pad=2)
    img.paste_(sg, dx + dw // 2 - sg.w // 2, B - H + 1)
    w = A.window(24, 18, 'white', bars=3, seed=5)
    img.paste_(w, L + 4, B - 32)
    img.rect_(L + 9, B - 26, 4, 5, '#2a2426')                # the guard behind the glass
    img.rect_(L + 9, B - 28, 4, 2, '#3d5a3a')
    _win_light(cv, L + 4, B - 32, 24, 18)
    # searchlight on the roof, boom on the right
    sl = A.searchlight()
    img.paste_(sl, L + 40, roof['ridge'] - 8)
    cv.light(L + 50, roof['ridge'] - 2, 26, SEARCH, 'lamp', True)
    arm_x = bx1 + 2
    img.paste_(A.barrier_arm(R_ + cv.over - arm_x - 7), arm_x, B - 16)
    stop = Img.new(11, 20)
    stop.rect_(5, 9, 1, 11, R['steel'][2])
    stop.ellipse_(5.5, 5, 5.5, 5, INK); stop.ellipse_(5.5, 5, 4.5, 4, '#c8433a')
    stop.rect_(3, 4, 5, 2, '#f3ead2')
    img.paste_(stop, R_ - 6, B - 36)
    lamp, (lbx, lby) = A.wall_lamp()
    img.paste_(lamp, dx + dw - 2, B - 36)
    cv.light(dx + dw - 2 + lbx, B - 36 + lby, 40, WARM, 'lamp', True)
    return _finish('kpp', cv)


# ---------------------------------------------------------------------------- watchtower
def _draw_watchtower() -> Facade:
    """A guard tower on four braced timber stilts, a ladder up the front, a plank cabin with a
    window band under a hipped tin roof, the searchlight on top (the square adds its beam)."""
    cv = _cv('watchtower', over=8)
    img, L, R_, B = cv.img, cv.L, cv.R, cv.B
    wd = P['woodgrey']
    FH = 74
    D = cv.D
    # back stilts (higher on screen, inset a little), then the front ones
    for x in (L + 6, R_ - 10):
        img.rect_(x, B - D - FH, 4, FH + 4, wd[1]); img.rect_(x, B - D - FH, 1, FH + 4, wd[2])
    for y in (B - D - 30, B - D + 8):
        img.rect_(L + 6, y, cv.W - 12, 3, wd[1])
    for x in (L + 1, R_ - 6):
        img.rect_(x, B - FH, 5, FH, wd[2]); img.rect_(x, B - FH, 1, FH, wd[4]); img.rect_(x + 4, B - FH, 1, FH, wd[0])
        img.rect_(x - 1, B - 3, 7, 3, P['concrete'][2]); img.rect_(x - 1, B - 3, 7, 1, P['concrete'][4])
    for y0, y1 in ((B - 6, B - 38), (B - 38, B - 68)):
        img.line_(L + 5, y0, R_ - 6, y1, wd[3]); img.line_(L + 5, y0 + 1, R_ - 6, y1 + 1, wd[1])
        img.line_(R_ - 6, y0, L + 5, y1, wd[3]); img.line_(R_ - 6, y0 + 1, L + 5, y1 + 1, wd[1])
    for y in (B - 38, B - 68):
        img.rect_(L + 1, y, cv.W - 2, 3, wd[3]); img.rect_(L + 1, y, cv.W - 2, 1, wd[4]); img.rect_(L + 1, y + 3, cv.W - 2, 1, INK)
    # ladder up the front
    lx = L + 18
    img.rect_(lx, B - FH, 2, FH, wd[3]); img.rect_(lx + 10, B - FH, 2, FH, wd[2])
    for y in range(B - FH + 3, B, 5):
        img.rect_(lx + 2, y, 8, 1, wd[4]); img.rect_(lx + 2, y + 1, 8, 1, INK)
    img.rect_(lx - 1, B - FH, 1, FH, INK); img.rect_(lx + 12, B - FH, 1, FH, INK)
    # the floor slab and the cabin
    c0, c1 = L - 4, R_ + 4
    img.rect_(c0 - 1, B - FH - 3, c1 - c0 + 2, 4, wd[3]); img.rect_(c0 - 1, B - FH - 3, c1 - c0 + 2, 1, wd[4])
    img.rect_(c0 - 1, B - FH + 1, c1 - c0 + 2, 1, INK)
    CH = 24
    img.paste_(A.wall('plankgrey', c1 - c0, CH, 141), c0, B - FH - 3 - CH)
    img.rect_(c0 + 3, B - FH - CH + 2, c1 - c0 - 6, 9, R['glass'][1])
    for x in range(c0 + 3, c1 - 3, 9):
        img.rect_(x, B - FH - CH + 2, 1, 9, wd[3])
    img.rect_(c0 + 3, B - FH - CH + 2, c1 - c0 - 6, 1, R['glass'][0])
    img.px_(c1 - 8, B - FH - CH + 3, R['glass'][4])
    img.rect_(c0 + 15, B - FH - CH + 5, 4, 6, '#2a2426'); img.rect_(c0 + 15, B - FH - CH + 4, 4, 2, '#3d5a3a')
    img.rect_(c0 + 2, B - FH - CH + 11, c1 - c0 - 4, 2, wd[4])
    cv.light((c0 + c1) / 2, B - FH - CH + 7, 20, WARM, 'window', True)
    # roof: a hipped tin cap over the cabin (the cabin sits D deep on the stilts)
    H = FH + 3 + CH
    roof = A.roof_hip(cv, 'galv', H, rise=D // 2 - 2, seed=142, x0=c0, x1=c1, ov=3)
    sl = A.searchlight()
    img.paste_(sl, cv.cx - 7, roof['ridge'] - 9)
    cv.light(cv.cx + 3, roof['ridge'] - 3, 28, SEARCH, 'lamp', True)
    return _finish('watchtower', cv)
