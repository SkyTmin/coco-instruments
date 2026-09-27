"""Facades of the square's buildings (v2.80) — the contract between the square and its buildings.

`facade(id)` returns a `Facade`: the exterior sprite of a building and what the square needs to
place it. The square (maps/square.py) decides WHERE a building stands; this module decides what it
LOOKS like. Sizes below are the contract — the square leaves exactly this footprint free.

Placement rule: the sprite's bottom edge sits on the footprint's bottom edge; the sprite is
centred on the footprint horizontally (it may be wider — eaves, a porch — by `over` px each side);
everything above the footprint (walls, roof, chimney, the headframe) rises up the screen.
Door: `door_x` tiles from the footprint's left edge, `door_w` tiles wide, at its bottom row.

THIS FILE STARTS AS PLACEHOLDERS (plain boxes). The facade artist replaces `_draw_*` with the real
buildings and keeps the contract: FOOTPRINTS, door position, the Facade fields.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from kit import INK, P, ink, text
from lib import T, Img

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
