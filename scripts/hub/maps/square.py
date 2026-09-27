"""The prison square (v2.80): the camp's yard, 64 × 56 tiles, north up. The art is in
`art_outdoor.py`; this module decides where everything stands.

CONTRACT (the game and the interiors rely on it)
  * every building stands on its footprint from facades.FOOTPRINTS, by the placement rule of
    facades.py (sprite bottom on the footprint's bottom, centred, `over` px each side); its solid is
    the Facade's own or the whole footprint, the door column's bottom tile left free;
  * every ENTERABLE building has a door {to: '<id>', at: 'in', kind: 'enter'} over its doorway
    (the footprint's bottom 0.6 tile) and a spawn '<id>' one tile south of it, facing down;
  * spawn 'kpp' inside the gate facing up, door {to: '@back', kind: 'exit'} in the gate;
  * mark 'board' + door {to: '@board', kind: 'use'} on the slab in front of the orders board;
  * the Facades' lights and effects are carried over, offset by the sprite's position; each
    watchtower gets a searchlight (its first light, else the sprite's top centre);
  * every door is reachable from the gate by a path at least 2 tiles wide — `art_outdoor.reach`
    checks it with a 2 × 2 agent on the collision grid; run it after any move.

LAYOUT — bands, north to south
  0–4    the taiga over the wall, the razor-wire coil on Y-brackets, the ПО-2 wall face
  4–6    the raked forbidden strip, «ЗАПРЕТНАЯ ЗОНА» plates, the warning fence (solid)
  7–13   industry: forge, boiler house (coal), the spoil heap with its belt and track, the MINE
         (the dominant, on the axis x = 33), the special shaft in razor wire, the canteen's yard
  13–16  the north road (asphalt), a lawn verge
  17–32  the parade ground: slabs with the three squads' painted frames, the flag and the tribune
         on the axis, the orders board (@board), the slogan, loudspeakers, benches, fire barrels;
         the asphalt ring round it. West of it the HQ with its flower bed and honour board and the
         sports ground; further west the vegetable garden (scarecrow) and the LIFT. East the kiosk
         and the enchanter's garden: the TOWER in an arc of rune stones, a burned sigil before its
         door, stepping stones from the ring, a still pool.
  32–34  the middle road (gravel), a power line on poles along its west half
  35–40  laundry, store, barrack 2, kennel (+ its straw pen with a husky)
  40–44  the lane: the smoking shelter, a woodpile, the washstand, desire lines across grass
  44–49  trader (between the laundry and barrack 1), barrack 1, club (film poster), garage (lorry)
  49–51  the south road; the gate road crosses it: СТОП line, the raised barrier, the guard dog
  52–56  the strip, the wall's outer face, the KPP in the wall, the gate with its star arch
  Paths: asphalt cross (gate → ring → mine) and ring; a gravel loop (west road, middle road,
  south road, east lane) with pads to every door; trodden desire lines where people cut corners.

LESSONS (critique rounds)
  1. Round 1 — the first layout was a grid of boxes with bare earth between them. Every empty
     block got a job (sports ground, smoking shelter, woodpile, garden, pen) and every building a
     yard of its own; the trader fell out of the 2-wide reach check because south-road lamps stood
     on the road — lamps now stand on the verges, never in a 3-tile corridor.
  2. Objects on the north edge of a band hide behind the next band's roofs (a facade rises ≥ 2
     tiles over its footprint): lamps and signposts belong on the SOUTH edge of a road or on the
     north side of the building they serve. The middle-road lamps and the first signpost were lost
     behind the store's roof; the gate barrier behind the KPP's — it moved to the east post.
  3. NA's floor details are not all ground: its "stones" (FloorDetail 4,0) are orange and its
     twigs read as scratches in the camp palette. Pebbles are drawn (`pebbles`), only the grass
     tufts come from NA. Scatter consults the ground's labels, so nothing sprouts on garden beds —
     beds are soil in the Ground, not paint on top of it.
  4. A small landmark disappears at game scale: the flag was a red dot until it got a 26 × 15
     cloth; the spoil heap had to become a 100 × 62 mountain to hold the industrial corner.
  5. Sprites repeat by NAME: two pictures under one name crash the atlas, and a name built from a
     loop index that does not follow the picture (bush i % 3 vs bush kind) did exactly that.
  6. Sorting: a thing that sits ON another (the cat on the bin, the crow on the scarecrow) needs
     an explicit base below its host's, or the host is painted over it.
"""
from __future__ import annotations

import math

import art_outdoor as A
from art_outdoor import Ground
from facades import ENTERABLE, facade
from kit import barrel, bucket, crate, ore_pile, sack
from lib import T, Img, Map, rng

W, H = 64, 56
AX = 33                                            # the axis: gate → parade ground → flag → mine
FENCE_N, FENCE_S, FENCE_W, FENCE_E = 6, 52, 3, 61  # the inner warning fence (tiles)
LAMP = '#ffd98a'

# footprint top-left of every building (tiles). Bands, north to south: industry (bottoms at 13),
# the north road, the parade ground with its ring (17–32), the middle road, band 3 (bottoms at 40),
# a lane, band 4 (bottoms at 49), the south road, the strip, the wall.
PLACE = {
    'forge': (5, 8), 'boiler': (14, 8), 'mine': (28, 7), 'zone': (41, 8), 'canteen': (51, 8),
    'hq': (13, 17), 'kiosk': (44, 18), 'tower': (53, 20), 'lift': (4, 26),
    'laundry': (4, 36), 'store': (23, 35), 'barrack2': (35, 35), 'kennel': (49, 35),
    'trader': (4, 45), 'barrack1': (14, 44), 'club': (36, 44), 'garage': (50, 44),
    'kpp': (25, 52),
    'tw_nw': (0, 4), 'tw_ne': (61, 4), 'tw_sw': (0, 51), 'tw_se': (61, 51),
}
NAMES = {'mine': 'Шахта', 'zone': 'Особая шахта', 'forge': 'Кузница', 'lift': 'Лифт', 'tower': 'Башня',
         'kennel': 'Питомник', 'trader': 'Торговец', 'store': 'Каптёрка', 'kiosk': 'Ларёк', 'hq': 'Штаб',
         'club': 'Клуб'}


# ------------------------------------------------------------------------------------ helpers
def put(m: Map, name: str, img, x: float, y: float, solid=None, fps: float = 0, layer: str = 'sort',
        phase: float = 0, anchor: str = 'bc', base: float | None = None):
    """Stand a sprite with its bottom-centre (anchor 'bc') or bottom-left ('bl') at tile (x, y).
    solid: (w, h) tiles centred on the foot, ending at y — or an explicit (x0, y0, x1, y1).
    base (tiles) overrides the depth row — a cat on a bin sorts after the bin."""
    frames = img if isinstance(img, list) else [img]
    w, h = frames[0].w, frames[0].h
    px = x * T - (w / 2 if anchor == 'bc' else 0)
    py = y * T - h
    if solid is not None and len(solid) == 2:
        sw, sh = solid
        solid = (x - sw / 2, y - sh, x + sw / 2, y) if anchor == 'bc' else (x, y - sh, x + sw, y)
    return m.put(name, frames, int(round(px)), int(round(py)), solid=solid, fps=fps, layer=layer, phase=phase,
                 base=None if base is None else int(round(base * T)))


def decal(m: Map, img: Img, x: float, y: float, alpha: float = 1.0) -> None:
    """Stamp a flat thing on the ground, centred on tile (x, y)."""
    m.stamp(img, int(round(x * T - img.w / 2)), int(round(y * T - img.h / 2)), alpha)


def lamp(m: Map, x: float, y: float, left: bool = False) -> None:
    img, (bx, by) = A.street_lamp(left)
    o = put(m, 'square.lamp.l' if left else 'square.lamp', img, x, y, solid=(0.5, 0.4))
    m.light(o.x + bx, o.y + by + 2, 64, LAMP, 'lamp', night=True)


def fire(m: Map, x: float, y: float, phase: float = 0) -> None:
    o = put(m, 'square.firebarrel', A.fire_barrel(), x, y, solid=(0.9, 0.5), fps=7, phase=phase)
    m.light(o.x + 9, o.y + 10, 70, '#ff9a4a', 'fire')
    m.emit('embers', o.x + 9, o.y + 8, 0.5)
    m.emit('smoke', o.x + 9, o.y + 2, 0.25)


def beam_of(f, sx: int, sy: int) -> tuple[float, float]:
    """Where a searchlight sits: facades.searchlight(f) (px in the sprite) when the facades module
    has it, else the sprite's top centre."""
    import facades
    fn = getattr(facades, 'searchlight', None)
    p = fn(f) if fn else None
    if p:
        return sx + p[0], sy + p[1]
    return sx + f.img.w / 2, sy + 10


def contact_shadow(m: Map, key: str) -> None:
    """The ground darkens along a building's foot: a band under its south wall and a thinner one
    down its east side (light from the upper left). The facade can't paint below its footprint,
    so the square does."""
    fx, fy = PLACE[key]
    f = facade('watchtower' if key.startswith('tw_') else key)
    x0, y0, x1, y1 = fx * T, fy * T, (fx + f.fw) * T, (fy + f.fh) * T
    g = m.ground
    g.rect_(x0, y1, x1 - x0 + 3, 3, '#000000', 0.26)
    g.rect_(x0 + 2, y1 + 3, x1 - x0 + 1, 2, '#000000', 0.10)
    g.rect_(x1, y0 + 6, 3, y1 - y0 - 6, '#000000', 0.18)


def place(m: Map, key: str, fid: str):
    """Stand a facade on its footprint by the contract in facades.py; returns sprite x, y, facade."""
    fx, fy = PLACE[key]
    f = facade(fid)
    sx = fx * T - f.over
    sy = (fy + f.fh) * T - f.img.h
    m.put(f'square.facade.{fid}', f.frames or [f.img], sx, sy, fps=f.fps)
    if f.solid is None:
        m.block(fx, fy, fx + f.fw, fy + f.fh)
        if fid in ENTERABLE:
            m.free(fx + f.door_x, fy + f.fh - 1, fx + f.door_x + f.door_w, fy + f.fh)
    else:
        for x0, y0, x1, y1 in f.solid:
            m.block(fx + x0, fy + y0, fx + x1, fy + y1)
    for lx, ly, r, c, kind, night in f.lights:
        m.light(sx + lx, sy + ly, r, c, kind, night)
    for kind, ex, ey, rate in f.fx:
        m.emit(kind, sx + ex, sy + ey, rate)
    if fid in ENTERABLE:
        m.door(fx + f.door_x, fy + f.fh - 0.6, f.door_w, 0.6, fid, 'in', kind='enter', label=NAMES[fid])
        m.spawn(fid, fx + f.door_x + f.door_w / 2, fy + f.fh + 0.8, 0)
    return sx, sy, f


def door_of(key: str) -> tuple[float, float]:
    """Centre of a building's door on its bottom edge (tiles)."""
    fx, fy = PLACE[key]
    f = facade('watchtower' if key.startswith('tw_') else key)
    return fx + f.door_x + f.door_w / 2, fy + f.fh


# ------------------------------------------------------------------------------------ ground
def ground(g: Ground) -> None:
    # outside, the raked strip, tired grass along the fence
    g.rect('outside', 0, 0, W, 4)
    g.rect('sand_h', 1, 4, 63, 6.3)
    g.rect('sand_h', 1, 51.7, 63, 55)
    g.rect('sand_v', 1, 4, FENCE_W + 0.2, 52)
    g.rect('sand_v', FENCE_E - 0.2, 4, 63, 52)
    for x0, y0, x1, y1 in ((3.5, 6.3, 60.5, 7.4), (3.4, 6.3, 4.4, 51.8), (59.6, 6.3, 60.6, 51.8),
                           (3.5, 50.7, 60.5, 51.8)):
        g.rect('grass', x0, y0, x1, y1, rough=3)
    # industry: coal dust at the boiler house, wet earth at the mine mouth, ore dust by the heaps
    g.blob('coal', 21.5, 12.6, 3.2, 1.6, rough=3)
    g.blob('coal', 17.5, 13.3, 2.2, 0.8, rough=2)
    g.blob('mud', AX, 13.4, 2.6, 0.9, rough=2)
    # grass islands: the HQ front, the sports ground's frame, the store corner, around barracks
    g.rect('grass', 13.4, 22.2, 22.7, 31.6, rough=3)
    g.rect('earth', 14.3, 25.0, 21.9, 31.0, r=0.6, rough=2)
    g.rect('grass', 3.6, 16.3, 10.8, 24.4, rough=3)
    for yb in (17.8, 19.8, 21.8):                     # the vegetable beds
        g.rect('soil', 4.8, yb, 10.0, yb + 1.3)
    g.rect('grass', 23.4, 40.6, 30.6, 43.8, rough=3)
    g.rect('grass', 35.5, 40.6, 46.2, 43.7, rough=3)
    g.rect('grass', 3.6, 40.3, 10.6, 44.8, rough=3)
    g.rect('grass', 26, 44.3, 30.6, 48.4, rough=3)
    # the enchanter's garden
    g.rect('moss', 47.6, 16.4, 60.6, 31.6, r=2.5, rough=4)
    # the dog pen
    g.rect('straw', 57.4, 35.6, 60.6, 47.0, rough=1.5)
    # roads: asphalt cross and ring, gravel loop and spurs
    g.rect('asphalt', 3.6, 13.6, 60.4, 15.9, rough=1)
    g.rect('asphalt', AX - 2, 13.0, AX + 2, 17.6, rough=1)
    g.rect('asphalt', 23, 17, 43, 32, r=1, rough=1)
    for x0, x1 in ((23.4, AX - 2.2), (AX + 2.2, 42.6)):  # a lawn verge between the road and the ring
        g.rect('grass', x0, 15.95, x1, 17.05, r=0.4, rough=1)
    g.rect('slab', 25, 19, 41, 30)
    g.rect('asphalt', AX - 2, 31, AX + 2, 56, rough=1)
    kx, ky = PLACE['kpp']                    # the checkpoint's apron: the gate road widened under it
    g.rect('asphalt', kx, ky - 0.3, AX - 1.9, H)
    g.rect('gravel', 11, 15.8, 13, 49.2, rough=1.5)
    g.rect('gravel', 3.6, 32, 60.4, 34, rough=1.5)
    g.rect('gravel', 3.6, 49, 50.2, 50.8, rough=1.5)
    g.rect('gravel', 46.6, 33.8, 48.6, 49.4, rough=1.5)
    # spurs to the doors (gravel pads)
    for key in ('forge', 'boiler', 'zone', 'canteen'):
        dx, dy = door_of(key)
        g.rect('gravel', dx - 1.4, dy - 0.2, dx + 1.4, 13.8, rough=1)
    hx, hy = door_of('hq')
    g.rect('gravel', 13, hy - 0.2, 23.2, hy + 1.6, rough=1)
    kx, ky = door_of('kiosk')
    g.rect('gravel', 42.8, ky - 0.2, kx + 1.3, ky + 1.5, rough=1)
    lx, ly = door_of('lift')
    g.rect('gravel', lx - 1.3, ly - 0.2, lx + 1.3, 32.2, rough=1)
    for key in ('store', 'barrack2', 'kennel', 'laundry'):
        dx, dy = door_of(key)
        g.rect('gravel', dx - 1.3, dy - 0.2, dx + 1.3, dy + 1.4, rough=1)
    sx, sy = door_of('store')
    g.rect('gravel', sx, sy + 0.1, AX - 1.8, sy + 1.4, rough=1)
    bx, by = door_of('barrack2')
    g.rect('gravel', AX + 1.8, by + 0.1, bx, by + 1.4, rough=1)
    kx, ky = door_of('kennel')
    g.rect('gravel', 48.2, ky + 0.1, kx, ky + 1.4, rough=1)
    # desire lines: the shortcuts everybody takes, packed dark by boots — across grass and yards
    g.path('trod', [(16, 31.6), (19.5, 34.2), (22.8, 36.8)], 1.1, rough=2)
    g.path('trod', [(22.9, 26.0), (21.4, 27.6)], 0.9, rough=2)
    g.path('trod', [(28, 42.2), (30.8, 44.6)], 1.0, rough=2)
    g.path('trod', [(41, 41.6), (44, 42.6), (46.7, 42.4)], 0.9, rough=2)
    g.path('trod', [(8.5, 40.6), (10, 42.6), (11.2, 43.8)], 0.9, rough=2)
    g.path('trod', [(13.2, 38.2), (16.4, 40.9), (20.6, 41.5), (23.0, 42.8), (26.4, 47.2), (30.9, 48.9)], 1.0, rough=2)
    g.path('trod', [(35.2, 41.3), (36.9, 42.2), (45.9, 42.6)], 0.8, rough=2)
    g.path('trod', [(43.2, 21.9), (44.8, 23.7), (46.2, 26.6)], 0.8, rough=2)
    g.path('trod', [(21.0, 13.8), (27.8, 13.9)], 1.1, rough=2)
    tx, ty = PLACE['tower']                  # the last steps to the enchanter's door, through the sigil
    g.path('trod', [(50.6, 27.3), (54.2, 27.0), (55.5, 26.2), (55.5, ty + 5.0)], 1.3, rough=2)


# ----------------------------------------------------------------------------------- perimeter
def perimeter(m: Map) -> None:
    gr = m.ground
    wpx, hpx = W * T, H * T
    # north: the taiga over the wall, the coil on its brackets, the ПО-2 face, its shadow
    gr.paste_(A.taiga(wpx, 44, seed=2), 0, -12)
    face, posts = A.wall_face(wpx, 32, seed=4)
    fy = 4 * T - face.h
    gr.paste_(face, 0, fy)
    br = A.bracket()
    for px in posts:
        gr.paste_(br, px - 2, fy - 7)
    gr.paste_(A.coil(wpx, seed=5), 0, fy - 12)
    gr.rect_(0, 4 * T, wpx, 3, '#000000', 0.3)
    gr.rect_(0, 4 * T + 3, wpx, 2, '#000000', 0.12)
    # floodlights on every third post: they light the strip at night
    for px in posts[1::3]:
        gr.rect_(px, fy + 2, 4, 3, A.STEEL[1])
        gr.rect_(px + 1, fy + 4, 2, 1, '#fff1c2')
        m.light(px + 2, fy + 8, 56, '#e9efff', 'lamp', night=True)
    # west and east: the wall seen from above, coil on it, its shadow on the strip
    for east in (False, True):
        x = wpx - 16 if east else 0
        gr.rect_(x, 4 * T, 16, hpx - 4 * T, A.G['outside'][1])
        wx = x + (3 if east else 6)
        gr.rect_(wx, 2 * T, 7, hpx - 2 * T, A.CON[3])
        gr.rect_(wx, 2 * T, 1, hpx - 2 * T, A.CON[4])
        gr.rect_(wx + 6, 2 * T, 1, hpx - 2 * T, A.CON[1])
        if not east:
            gr.rect_(wx + 7, 4 * T, 3, hpx - 4 * T, '#000000', 0.28)
        gr.paste_(A.coil(hpx - 2 * T, vertical=True, seed=7 + east), wx - 3, 2 * T - 6)
    # south: coil, cap and the outer face — the gate breaks it
    sface, _ = A.wall_face(wpx, 26, seed=9)
    gy = hpx - sface.h
    kx0 = PLACE['kpp'][0] * T                 # the kpp stands in the wall line: no face under it
    for a, b in ((0, kx0), ((AX + 2) * T, wpx)):
        gr.paste_(sface.crop(a, 0, b - a, sface.h), a, gy)
    scoil = A.coil(wpx, seed=11)
    for a, b in ((0, kx0), ((AX + 2) * T, wpx)):
        gr.paste_(scoil.crop(a, 0, b - a, scoil.h), a, gy - 12)
    # a trail of boot prints across the north strip that stops short of the wall — somebody tried
    decal(m, A.footprints(7, 2, -3, seed=3), 45.3, 5.1)
    # the warning fence: north run with plates, west/east runs, south run broken by kpp and gate
    plate = A.warn_sign(['СТОЙ!'])
    for i, x in enumerate(range(FENCE_W * T + 8, (FENCE_E - 2) * T + 8, 32)):
        sign = i % 5 == 2
        seg = A.fence_seg_h(32, plate if sign else None)
        m.put('square.fence_h.sign' if sign else 'square.fence_h', seg, x, FENCE_N * T - seg.h)
    for i, x in enumerate(range(FENCE_W * T + 8, (FENCE_E - 2) * T + 8, 32)):
        if 24 * T <= x + 32 and x <= (AX + 2) * T:
            continue
        sign = i % 6 == 3
        seg = A.fence_seg_h(32, plate if sign else None)
        m.put('square.fence_h.sign' if sign else 'square.fence_h', seg, x, FENCE_S * T - seg.h + 2)
    for fxp in (FENCE_W * T, FENCE_E * T - 3):
        for y in range(FENCE_N * T + 32, FENCE_S * T - 16, 32):
            seg = A.fence_seg_v(32)
            m.put('square.fence_v', seg, fxp, y - seg.h + 2)
    big = A.sign_post(A.warn_sign(['ЗАПРЕТНАЯ', 'ЗОНА']), 8)
    for x in (10.5, 23, 45, 56):
        put(m, 'square.sign_zone', big, x, 5.7)
    for y in (18, 31, 43):
        put(m, 'square.sign_zone', big, 1.9, y)
        put(m, 'square.sign_zone', big, 62.1, y)
    # crows on the wall cap and on fence posts
    crows = A.crow(3)
    for i, (cx, cy) in enumerate(((9.3, 1.15), (17.7, 1.15), (36.2, 1.15), (37.0, 1.15), (52.4, 1.15),
                                  (13.6, 4.95), (47.6, 4.95))):
        put(m, 'square.crow', crows, cx, cy, fps=0.7, phase=i * 0.37)
    # collision: wall + strip + fence
    m.block(0, 0, W, FENCE_N + 0.5)
    m.block(0, 0, FENCE_W + 0.5, H)
    m.block(FENCE_E - 0.5, 0, W, H)
    m.block(0, FENCE_S, AX - 2, H)
    m.block(AX + 2, FENCE_S, W, H)


# ---------------------------------------------------------------------------------------- gate
def gate(m: Map) -> None:
    gx0, gx1 = AX - 2, AX + 2
    pl = A.gate_pillar()
    put(m, 'square.gate_pillar', pl, gx0 - 0.5, H, solid=(1, 2))
    put(m, 'square.gate_pillar', pl, gx1 + 0.5, H, solid=(1, 2))
    beam = A.gate_beam((gx1 - gx0 + 1) * T)
    m.put('square.gate_beam', beam, (gx0 - 0.5) * T, H * T - pl.h + 2, base=H * T, layer='top')
    m.light((gx0 - 0.5) * T, H * T - pl.h + 3, 40, LAMP, 'lamp', night=True)
    m.light((gx1 + 0.5) * T, H * T - pl.h + 3, 40, LAMP, 'lamp', night=True)
    # (the boom barrier is the KPP facade's own: its arm reaches over the gate road from the west)
    # the stop line, the word, yellow-black kerbs at the posts
    m.ground.rect_(gx0 * T + 2, int(50.9 * T), 4 * T - 4, 2, A.PAINT['white'])
    decal(m, A.paint_text('СТОП', A.PAINT['white'], 2, seed=2), AX, 50.1)
    for x in (gx0 * T - 3, gx1 * T):
        for k in range(6):
            m.ground.rect_(x, int(51.3 * T) + k * 3, 3, 3, A.PAINT['yellow'] if k % 2 == 0 else '#1e1e1e')
    # the guard dog on its chain by the kpp, sandbags, a fire for the sentry
    dh = A.doghouse()
    put(m, 'square.doghouse', dh, 27.6, 48.5, solid=(1.5, 0.8))
    m.ground.line_(int(28.3 * T), int(48.3 * T), int(29.6 * T), int(48.4 * T), A.STEEL[3])
    put(m, 'square.dog', A.dog_frames(), 29.7, 48.6, fps=2, solid=(0.7, 0.4))
    put(m, 'square.sandbags', A.sandbags(5, 3), 38.1, 51.3, solid=(2.6, 0.7))
    # the way in: a finger-post where the gate road meets the parade ground
    put(m, 'square.signpost', A.signpost([('ШАХТА', 'up'), ('ЛИФТ', 'left'), ('ПИТОМНИК', 'right')]), AX - 2.7, 32.8,
        solid=(0.4, 0.3))
    fire(m, 25.9, 46.2, 0.2)
    lamp(m, gx0 - 0.9, 47.4, left=True)
    lamp(m, gx1 + 0.9, 42.6)


# ---------------------------------------------------------------------------------- parade ground
def plac(m: Map) -> None:
    g = m.ground
    white, yellow = A.PAINT['white'], A.PAINT['yellow']
    # the squads' places painted on the slabs: three frames, rank lines inside, a big numeral and
    # «ОТРЯД» under it; a yellow line where the front rank toes up to the tribune
    for sq, cx in enumerate((28.6, 33, 37.4)):
        rx0, rx1, ry0, ry1 = int((cx - 1.9) * T), int((cx + 1.9) * T), int(23.0 * T), int(28.9 * T)
        for a, b, c, d in ((rx0, ry0, rx1 - rx0, 2), (rx0, ry1 - 2, rx1 - rx0, 2), (rx0, ry0, 2, ry1 - ry0),
                           (rx1 - 2, ry0, 2, ry1 - ry0)):
            g.rect_(a, b, c, d, white, 0.8)
        for k in range(3):
            y = int((26.2 + k * 0.85) * T)
            for x in range(rx0 + 5, rx1 - 5, 6):
                g.rect_(x, y, 3, 1, white, 0.55)
        decal(m, A.paint_text(str(sq + 1), white, 3, seed=sq, wear=0.06), cx, 24.25)
        decal(m, A.worn(A.txt('ОТРЯД', white), 0.05, sq), cx, 25.45)
    g.rect_(int(29.9 * T), int(21.9 * T), int(6.2 * T), 2, yellow, 0.9)
    # wear: cracks with weeds, a stain, one puddle
    for i, (cx, cy) in enumerate(((26.3, 20.3), (39.4, 28.6), (31, 29.3), (36.5, 20.2), (27.2, 26.8))):
        decal(m, A.crack_weeds(i + 10, weeds=i % 2 == 0), cx, cy)
    decal(m, A.puddle(26, 9, 4), 38.2, 26.4)
    # flag, tribune, orders board, honour and slogan
    put(m, 'square.flag', A.flag_frames(), AX, 19.35, solid=(1.2, 0.5), fps=5)
    put(m, 'square.podium', A.podium(), AX, 21.3, solid=(3, 1.0))
    m.light(AX * T, 20.6 * T, 84, '#ffe2a8', 'lamp', night=True)     # the tribune is lit at night
    put(m, 'square.board', A.notice_board(), 27, 19.3, solid=(2.2, 0.4))
    m.marks['board'] = (27, 19.3)
    m.door(25.9, 19.3, 2.2, 0.8, '@board', '', kind='use', label='Доска')
    put(m, 'square.slogan', A.slogan(), 38.4, 19.25, solid=(5.2, 0.35))
    # loudspeakers at two corners, benches along the west edge, fires at the corners
    put(m, 'square.speaker', A.loudspeaker(), 41.6, 19.0, solid=(0.5, 0.4))
    put(m, 'square.speaker', A.loudspeaker(), 24.4, 30.4, solid=(0.5, 0.4))
    for y in (25.6, 28.4):
        put(m, 'square.bench', A.bench(), 26.2, y, solid=(1.7, 0.5))
    put(m, 'square.bench', A.bench(), 39.8, 29.7, solid=(1.7, 0.5))
    fire(m, 23.8, 17.9, 0.0)
    fire(m, 42.3, 31.4, 0.5)
    for x, y, left in ((22.7, 17.2, True), (43.3, 17.2, False), (22.7, 32.3, True), (43.3, 32.3, False)):
        lamp(m, x, y, left)
    # manholes and puddles on the ring
    decal(m, A.manhole(), 24.1, 24.2)
    decal(m, A.manhole(), 42.0, 25.0)
    decal(m, A.puddle(20, 8, 7), 34.8, 31.3)
    # crows walk the empty parade ground between roll calls
    crows = A.crow(3)
    for i, (x, y) in enumerate(((29.6, 27.9), (36.3, 22.7), (39.7, 24.2), (26.8, 21.4))):
        put(m, 'square.crow', crows, x, y, fps=0.9, phase=i * 0.41)


# --------------------------------------------------------------------------------- the industry
def industry(m: Map) -> None:
    g = m.ground
    mx, my = PLACE['mine']
    # the spoil heap — a waste-rock mountain between the boiler house and the headframe, glinting
    # with ore — the belt that tops it up, and the track in front of it with a cart and a buffer
    put(m, 'square.heap.big', A.spoil_heap(100, 62, 'stone', ('#c9483a', '#6fb0d8', '#e8c14e', '#9a6be0'), seed=2),
        24.2, 11.9, solid=(21.6, 9.6, 27.0, 11.9))
    put(m, 'square.heap.rust', A.spoil_heap(40, 24, 'rust', ('#e8c14e',), seed=5), 39.6, 11.9, solid=(1.8, 0.6))
    cv = put(m, 'square.conveyor', A.conveyor(), 28.0 - 54 / 32, 12.1, fps=6, solid=(27.2, 11.5, 28.0, 12.1))
    m.emit('dust', cv.x + 6, cv.y + 8, 0.6)                    # rock dust where the belt tips
    for i, (x, y) in enumerate(((23.0, 9.3), (25.3, 8.4))):     # crows on the heap, picking
        put(m, 'square.crow', A.crow(3), x, y, fps=0.8, phase=0.6 + i * 0.3, base=12.0)
    g.paste_(A.rails(7 * T + 8), 21 * T, int(12.25 * T))
    g.paste_(A.rails(3 * T + 4), 38 * T - 2, int(12.25 * T))
    put(m, 'square.buffer', A.buffer_stop(), 21.35, 13.2, solid=(0.8, 0.4))
    put(m, 'square.cart', A.ore_cart('stone'), 24.4, 13.1, solid=(1.2, 0.5))
    put(m, 'square.cart.rust', A.ore_cart('rust'), 40.2, 13.1, solid=(1.2, 0.5))
    for i, (cx, cy) in enumerate(((22.9, 13.5), (29.4, 13.4), (37.3, 13.5))):
        decal(m, ore_pile('stone', None, i), cx, cy)
    # the boiler house's coal, spilt across its yard
    put(m, 'square.coal', A.coal_pile(), 19.3, 13.35, solid=(2.4, 0.8))
    # the forge's yard: a water barrel, scrap, a pile of old wheel rims
    put(m, 'kit.barrel.water', barrel(water=True), 12.6, 12.9, solid=(0.8, 0.5))
    put(m, 'kit.barrel', barrel(), 4.4, 12.8, solid=(0.8, 0.5))
    decal(m, A.scraps_pile(), 11.2, 13.3)
    # the special shaft: coils around its flanks, «ВХОД ПО ПРОПУСКАМ»
    zx, zy = PLACE['zone']
    for yy in (9, 11):
        put(m, 'square.coil_v', A.coil(2 * T + 4, vertical=True, seed=20), zx + 6.4, yy + 2.1, solid=(0.7, 2))
    pas = A.sign_post(A.warn_sign(['ВХОД ПО', 'ПРОПУСКАМ']), 10)
    put(m, 'square.sign_pass', pas, zx - 0.3, 13.4, solid=(0.4, 0.3))
    # the canteen's back yard: bins with a cat on one, crates, a cauldron
    put(m, 'square.bin', A.trash_bin(True), 48.3, 13.0, solid=(1.4, 0.7))
    put(m, 'square.bin.shut', A.trash_bin(False), 49.9, 12.8, solid=(1.4, 0.7))
    put(m, 'kit.sack.potato', sack('#8a7a58'), 47.6, 12.2, solid=(0.6, 0.4))
    put(m, 'kit.sack.potato', sack('#8a7a58'), 47.9, 12.9, solid=(0.6, 0.4))
    # weeds along the fence between the buildings, a signpost at the west crossing
    for i, (x, y) in enumerate(((13.3, 7.9), (39.5, 7.8), (48.5, 7.7), (27.7, 7.6), (20.7, 7.9))):
        k = (i * 5 + 2) % 6
        put(m, f'square.bush.{k}', A.bush(k), x, y, solid=(0.8, 0.3))
    put(m, 'square.signpost.w', A.signpost([('КУЗНИЦА', 'left'), ('ШАХТА', 'right'), ('ЛИФТ', 'up')]), 10.5, 16.6,
        solid=(0.4, 0.3))
    # the roads' wear: patched holes and cracks
    for i, (x, y, w, h) in enumerate(((16.2, 14.9, 22, 9), (43.5, 14.2, 16, 12), (33.8, 41.8, 18, 10),
                                      (23.9, 29.4, 12, 16), (32.2, 16.2, 14, 8))):
        decal(m, A.road_patch(w, h, i), x, y)
    for i, (x, y) in enumerate(((8.5, 15.2), (29.1, 14.2), (41.6, 15.3), (55.8, 14.7), (32.6, 36.2),
                                (34.2, 46.0), (24.0, 21.6), (42.2, 29.6))):
        decal(m, A.crack_weeds(30 + i, weeds=i % 3 != 0), x, y)
    # somebody counts the days on a panel of the north wall
    decal(m, A.tally(22), 57.6, 3.3)
    put(m, 'square.cat', A.cat_frames(), 49.9, 11.75, fps=1.5, base=12.85)
    put(m, 'kit.crate', crate(), 50.6, 13.3, solid=(0.9, 0.5))
    # north road: manholes, a puddle, lamps between the buildings
    decal(m, A.manhole(), 19.0, 14.8)
    decal(m, A.manhole(), 46.8, 14.6)
    decal(m, A.puddle(24, 9, 2), 26.0, 15.1)
    decal(m, A.oil_stain(3), 36.8, 14.9)
    for x in (13.1, 38.9, 48.2):
        lamp(m, x, 13.5)


# ------------------------------------------------------------------------------------- the west
def west(m: Map) -> None:
    # the vegetable garden: picket fence, beds of cabbage and greens, the scarecrow
    gy0, gy1 = 17, 23.7
    beds = (17.8, 19.8, 21.8)
    # (the beds are soil in the ground picture — see ground())
    cab, gre = [A.cabbage(i) for i in range(2)], [A.greens(i) for i in range(2)]
    for row, yb in enumerate(beds):
        for i in range(7):
            x = 5.2 + i * 0.72
            img = cab[i % 2] if row != 1 else gre[i % 2]
            decal(m, img, x, yb + 0.65)
    put(m, 'square.scarecrow', A.scarecrow(), 7.6, 21.1, solid=(0.5, 0.3), fps=1.2)
    put(m, 'square.crow.perch', A.crow(3)[:2], 8.15, 19.8, fps=0.5, base=21.2)
    put(m, 'kit.bucket', bucket(True), 9.8, 23.2, solid=(0.6, 0.4))
    pk = A.picket(32)
    for x in range(4, 10, 2):
        m.put('square.picket', pk, x * T, int(gy0 * T) - pk.h + 2)
        m.block(x, gy0 - 0.3, x + 2, gy0)
    for x in (4, 6, 8):
        m.put('square.picket', pk, x * T, int(gy1 * T) - pk.h + 2)
        m.block(x, gy1 - 0.3, x + 2, gy1)
    pv = A.picket(32, vertical=True)
    for y in (17, 21.7):
        m.put('square.picket_v', pv, int(10.4 * T), int(y * T))
        m.block(10.3, y, 10.7, y + 2)
    # the lift: crates of gear and a cable drum by its door
    lx, ly = PLACE['lift']
    put(m, 'kit.crate.dark', crate(dark=True), 3.95 + 0.5, ly + 5.4, solid=(0.9, 0.5))
    put(m, 'square.pallets', A.pallets(3), lx + 8.3, ly + 5.0, solid=(1.5, 0.6))
    # the sports ground: pull-up bar, parallel bars, weights, a bag; tyres dug in along the edge
    put(m, 'square.pullup', A.pullup_bar(), 15.8, 27.5, solid=(1.8, 0.3))
    put(m, 'square.bars', A.parallel_bars(), 19.3, 27.4, solid=(2, 0.4))
    put(m, 'square.press', A.bench_press(), 16.2, 30.3, solid=(2, 0.5))
    put(m, 'square.bag', A.punching_bag(), 20.4, 30.4, solid=(1.3, 0.3), fps=1.5)
    ty = A.tyre_arch()
    for i in range(6):
        put(m, 'square.tyre', ty, 14.8 + i * 0.95, 31.5, solid=(0.8, 0.3))
    put(m, 'square.banner.sport', A.banner_small(['В ЗДОРОВОМ ТЕЛЕ -', 'ЗДОРОВЫЙ ДУХ!'], '#3f5a78'), 17.6, 25.5,
        solid=(3.6, 0.3))
    put(m, 'square.bench', A.bench(), 21.0, 29.0, solid=(1.7, 0.5))
    # the yard between the west road and the store: the smoking shelter, a woodpile, its fire
    put(m, 'square.shelter', A.smoking_shelter(), 18.2, 40.4, solid=(16.4, 39.6, 20.0, 40.4))
    put(m, 'square.smoke_sign', A.sign_post(A.warn_sign(['МЕСТО', 'ДЛЯ КУРЕНИЯ']), 8), 22.0, 40.2, solid=(0.4, 0.3))
    put(m, 'square.firewood', A.firewood(44), 15.7, 36.9, solid=(2.8, 0.6))
    fire(m, 14.6, 40.3, 0.35)
    stump = A.na_prop(4, 8, sat=0.35).tint('#5e5040', 0.3)
    for x, y in ((13.9, 41.2), (15.4, 41.3)):
        put(m, 'square.stump', stump, x, y, solid=(0.6, 0.3))
    # a power line along the middle road: poles on its south verge, wires over everybody's heads
    pole, ins = A.power_pole()
    xs = [5.2, 10.4, 17.2, 22.3]
    objs = [put(m, 'square.pole', pole, x, 34.75, solid=(0.4, 0.3)) for x in xs]
    for a, b in zip(objs, objs[1:]):
        span = b.x - a.x
        wimg = A.wires(span, 0, 4.5)
        m.put(f'square.wires.{span}', wimg, a.x + ins[0][0], a.y + ins[0][1], base=a.base, layer='top')
    # the laundry: lines of robes, a tub, a basket
    fr = A.laundry(2, 88)
    put(m, 'square.laundry', fr, 4.0, 42.6, fps=1.3, anchor='bl', solid=(4.0, 42.3, 4.3, 42.6))
    m.block(9.3, 42.3, 9.6, 42.6)
    put(m, 'kit.bucket', bucket(True), 10.2, 41.1, solid=(0.6, 0.4))
    put(m, 'kit.sack.pale', sack('#8b8574'), 3.95 + 0.4, 43.8, solid=(0.6, 0.4))
    # the trader's corner: crates and a barrel
    put(m, 'kit.crate', crate(), 10.4, 47.3, solid=(0.9, 0.5))
    put(m, 'kit.crate.dark', crate(dark=True), 10.5, 48.4, solid=(0.9, 0.5))
    put(m, 'kit.barrel', barrel(), 3.95 + 0.45, 49.8, solid=(0.8, 0.5))
    # the HQ: honour board, a flower bed rimmed with painted tyres, a bench
    put(m, 'square.honor', A.honor_board(), 21.3, 24.6, solid=(3.2, 0.3))
    decal(m, A.flowerbed(), 14.9, 23.3)
    put(m, 'square.bench', A.bench(), 14.6, 26.2, solid=(1.7, 0.5))
    # birches: a few survived the building of the camp
    put(m, 'square.birch', A.birch(1), 12.0, 16.9, solid=(0.4, 0.3))
    put(m, 'square.birch.2', A.birch(2), 4.6, 34.9, solid=(0.4, 0.3))
    for x, y in ((13.6, 34.8), (13.6, 25.8)):
        lamp(m, x, y, left=True)
    lamp(m, 10.6, 44.4, left=True)


# ------------------------------------------------------------------------------------- the east
def east(m: Map) -> None:
    # the enchanter's garden: a ring of rune stones round the water tower, stepping stones in
    tx, ty = PLACE['tower']
    f = facade('tower')
    dx, dy = tx + f.door_x + f.door_w / 2, ty + f.fh
    # the rune circle burned into the moss before the door, stepping stones leading to it
    decal(m, A.sigil(30), dx, dy + 1.5)
    for i in range(11):
        t = i / 10
        x = 43.5 + t * (dx - 2.2 - 43.5)
        y = 27.0 + math.sin(t * math.pi) * 0.45
        decal(m, A.stepping_stone(i), x, y)
    # the standing stones: an arc round the tower's sides and front corners, the approach open
    runes = ['fehu', 'uruz', 'raido', 'sowilo', 'gebo', 'jera', 'fehu', 'raido']
    spots = [(tx - 1.6, ty + 5.9), (tx - 2.1, ty + 3.2), (tx - 1.7, ty + 0.6), (tx + f.fw + 1.7, ty + 0.6),
             (tx + f.fw + 1.6, ty + 3.2), (tx + f.fw + 1.3, ty + 5.9), (dx - 2.6, dy + 3.4), (dx + 2.6, dy + 3.4)]
    for k, (x, y) in enumerate(spots):
        rn = runes[k % len(runes)]
        o = put(m, f'square.menhir.{k}', A.menhir(rn, seed=k, h=26 if k < 6 else 20), x, y, solid=(0.7, 0.35),
                fps=0.8, phase=k * 0.3)
        m.light(o.x + 7, o.y + 10, 22, '#b388ff', 'magic')
    m.light(dx * T, (dy + 1.5) * T, 40, '#9a6be0', 'magic')
    m.emit('motes', dx * T, (dy + 1.2) * T, 1.2)
    m.emit('motes', (tx - 1.5) * T, (ty + 3) * T, 0.5)
    # the rest of the garden: a still pool, a dead tree, bushes, toadstools, a birch
    decal(m, A.pond(46, 20, 2), 50.4, 29.2)
    m.block(49.2, 28.8, 51.8, 29.9)
    put(m, 'square.deadtree', A.dead_tree(), 59.2, 19.2, solid=(0.8, 0.5))
    for i, (x, y) in enumerate(((52.8, 30.9), (58.8, 30.4), (49.0, 24.2), (59.7, 27.6), (48.6, 18.4))):
        k = (i * 2 + 1) % 6
        put(m, f'square.bush.{k}', A.bush(k), x, y, solid=(0.8, 0.4))
    for i, (x, y) in enumerate(((52.0, 28.3), (57.9, 28.9), (50.2, 20.6), (56.8, 18.9))):
        decal(m, A.mushrooms(i), x, y)
    put(m, 'square.birch.3', A.birch(3), 47.2, 31.1, solid=(0.4, 0.3))
    # the pet kennel's pen: plank fence, straw, a dog house, a trough, a dog asleep
    px0, py0, px1, py1 = 57.4, 35.6, 60.6, 47.0
    pf = A.plank_fence(32)
    for x in (px0, px0 + 2):
        m.put('square.plank', pf, int(x * T), int(py0 * T) - pf.h + 2)
        m.put('square.plank', pf, int(x * T), int(py1 * T) - pf.h + 2)
    pv = A.plank_fence(32, vertical=True)
    for y in range(int(py0), int(py1) - 1, 2):
        m.put('square.plank_v', pv, int(px0 * T) - 2, y * T)
    m.block(px0 - 0.2, py0 - 0.4, px1, py0)
    m.block(px0 - 0.2, py1 - 0.4, px1, py1)
    m.block(px0 - 0.2, py0, px0 + 0.3, py1)
    put(m, 'square.doghouse.bim', A.doghouse('БИМ'), 59.2, 39.8, solid=(1.5, 0.8))
    put(m, 'square.trough', A.trough(), 59.0, 44.2, solid=(1.3, 0.5))
    put(m, 'square.dog2', A.dog_frames(True), 58.7, 42.0, fps=1.5)
    decal(m, A.na_detail(14, 0), 58.2, 45.4)
    # the garage: the lorry half out of it, oil, tyres, jerrycans
    gx, gy = PLACE['garage']
    put(m, 'square.truck', A.truck(), gx + 3.0, 51.1, solid=(2.2, 1.8))
    decal(m, A.oil_stain(1), gx + 3.0, 51.3)
    decal(m, A.tyre_tracks(3 * T, vertical=True, seed=2), gx + 3.0, 49.4)
    decal(m, A.oil_stain(2), gx + 5.4, 49.6)
    put(m, 'square.tyres', A.tyres(3), gx + 6.4, 49.9, solid=(1, 0.5))
    put(m, 'square.jerry', A.jerrycan(), gx - 0.3, 49.8, solid=(0.5, 0.3))
    put(m, 'square.jerry.red', A.jerrycan('#8a3a2e'), gx + 0.3, 50.0, solid=(0.5, 0.3))
    # the club: a film poster on its side
    cx_, cy_ = PLACE['club']
    put(m, 'square.poster', A.film_poster(), cx_ + 9.9, 48.9, solid=(1.6, 0.3))
    # the kiosk: crates by the counter
    kx, ky = PLACE['kiosk']
    put(m, 'kit.crate', crate(), kx - 0.5, ky + 2.9, solid=(0.9, 0.5))
    lamp(m, 48.6, 33.5)
    lamp(m, 46.3, 43.7, left=True)


# ------------------------------------------------------------------------------------ the south
def south(m: Map) -> None:
    sx, sy = PLACE['store']
    put(m, 'square.pallets', A.pallets(3), sx - 0.9, sy + 4.9, solid=(1.5, 0.6))
    put(m, 'kit.crate', crate(), sx + 7.5, sy + 4.4, solid=(0.9, 0.5))
    put(m, 'kit.crate.dark', crate(dark=True), sx + 7.4, sy + 5.4, solid=(0.9, 0.5))
    put(m, 'kit.sack.pale', sack('#8b8574'), sx - 0.6, sy + 3.4, solid=(0.6, 0.4))
    bx, by = PLACE['barrack2']
    put(m, 'square.wash', A.washstand(), bx + 2.2, by + 6.3, solid=(2.2, 0.4))
    put(m, 'square.bench', A.bench(), bx + 8.6, by + 6.4, solid=(1.7, 0.5))
    fire(m, 45.3, 41.4, 0.7)
    for x in (18.6, 30.2, 44.6):
        lamp(m, x, 51.75, left=x < AX)
    # tyre ruts from the gate: the lorry comes in, turns east to its garage
    decal(m, A.tyre_tracks(12 * T, seed=4), 41.5, 49.9)
    decal(m, A.manhole(), 33.6, 38.0)
    decal(m, A.puddle(22, 9, 5), 31.9, 44.6)
    decal(m, A.puddle(18, 7, 6), 21.0, 49.9)
    decal(m, A.puddle(16, 7, 8), 47.6, 37.4)
    decal(m, A.oil_stain(5), 34.2, 47.3)


# ------------------------------------------------------------------------------------- details
def scatter(m: Map) -> None:
    """Tufts, pebbles and flowers on grass and along the fence and walls, deterministic."""
    r = rng('square-scatter')
    lab = m._ground_labels
    import art_outdoor as AO
    tufts = [A.na_detail(i, 2) for i in (0, 1, 2, 3, 4)]
    flowers = [A.na_detail(5, 2), A.na_detail(5, 3)]
    stones = [A.pebbles(i) for i in range(4)] + [A.pebbles(i, 'earth') for i in range(3)]
    grass = AO.MID['grass']
    earth = AO.MID['earth']
    for _ in range(420):
        x, y = r.uniform(3.6, 60.4), r.uniform(6.4, 51.8)
        px, py = int(x * T), int(y * T)
        if m.solid[int(y * 2), int(x * 2)]:
            continue
        L = lab[py, px]
        if L == grass:
            img = r.choice(tufts) if r.random() < 0.93 else r.choice(flowers)
        elif L == earth and r.random() < 0.35:
            img = r.choice(stones) if r.random() < 0.5 else r.choice(tufts)
        else:
            continue
        decal(m, img, x, y)


def build() -> Map:
    m = Map('square', W, H, 'outdoor', name='Площадь', ambient=1.0, music='yard', bg='#6e5a44')
    g = Ground(W, H, 'earth', seed=3)
    ground(g)
    m.ground = g.render()
    m._ground_labels = g.lab
    perimeter(m)
    for key in PLACE:
        contact_shadow(m, key)
    for key in PLACE:
        fid = 'watchtower' if key.startswith('tw_') else key
        sx, sy, f = place(m, key, fid)
        if fid in ('watchtower', 'kpp'):
            bx, by = beam_of(f, sx, sy)
            m.searchlights.append((bx, by, len(m.searchlights) * 0.2))
    gate(m)
    plac(m)
    industry(m)
    west(m)
    east(m)
    south(m)
    scatter(m)
    m.spawn('kpp', AX, 51.2, 1)
    m.door(AX - 2, 55.4, 4, 0.6, '@back', '', kind='exit', label='Выход')
    return m
