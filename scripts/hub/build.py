"""Build the prison square for the game (v2.80).

    python3 scripts/hub/build.py            # all maps in maps.MAPS
    python3 scripts/hub/build.py --check    # build into .out/ only, print sizes, touch nothing

Writes (all generated, never edit by hand):
  public/hub/maps/<id>.png     the ground picture of each map (floor, walls, flat decals)
  public/hub/atlas.png         every standing sprite; animations as horizontal strips
  public/hub/chars/<id>.png    residents (NA sheets recoloured, 64 × 112)
  public/hub/faces/<id>.png    their portraits for the dialogue window (38 × 38)
  src/lib/hub-maps.ts          maps, collision, objects, residents, doors, lights, effects, HUB_REV

Deterministic: the same sources and scripts give the same bytes and the same HUB_REV.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import re
import os
import sys
from collections import deque

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

import chars  # noqa: E402
import lib  # noqa: E402
import maps  # noqa: E402
from lib import T, Img  # noqa: E402

PUB = os.path.join(lib.ROOT, 'public', 'hub')
TS = os.path.join(lib.ROOT, 'src', 'lib', 'hub-maps.ts')
ATLAS_W = 1024


def png_bytes(img: Img) -> bytes:
    buf = io.BytesIO()
    img.pil().save(buf, format='PNG', optimize=True)
    return buf.getvalue()


def pack(sprites: dict[str, list[Img]]) -> tuple[Img, dict[str, list[int]]]:
    """Shelf-pack every sprite (frames side by side) into one atlas, tallest first.
    One transparent pixel of gutter keeps neighbours from bleeding when the game scales."""
    items = sorted(sprites.items(), key=lambda kv: (-kv[1][0].h, -kv[1][0].w * len(kv[1]), kv[0]))
    x = y = shelf = 0
    rects: dict[str, list[int]] = {}
    for name, frames in items:
        fw, fh = frames[0].w, frames[0].h
        sw = fw * len(frames)
        if sw + 1 > ATLAS_W:
            raise ValueError(f'{name}: strip {sw}px wider than the atlas')
        if x + sw + 1 > ATLAS_W:
            x, y, shelf = 0, y + shelf + 1, 0
        rects[name] = [x, y, fw, fh, len(frames)]
        x += sw + 1
        shelf = max(shelf, fh)
    h = y + shelf
    atlas = Img.new(ATLAS_W, max(1, h))
    for name, frames in sprites.items():
        rx, ry, fw, fh, n = rects[name]
        for i, f in enumerate(frames):
            assert f.w == fw and f.h == fh, f'{name}: frames differ in size'
            atlas.paste_(f, rx + i * fw, ry)
    return atlas, rects


# The hero's body on the square — mirror of HERO_R in src/lib/hub-sim.ts.
HERO_R = 0.3
SEAL_STEP = 32      # lattice points per tile for the reach flood
SEAL_MARGIN = 0.02  # a cell this close to a reachable body stays open


def seal_unreachable(m: lib.Map) -> int:
    """Close every free cell no standing body reachable from a spawn ever touches (v2.114).

    The circle-vs-cells push (walk.ts collideGrid) squeezes the body through a gap a little
    narrower than it is — a diagonal pinch between two pieces of furniture, a 0.5-tile slot —
    in one direction only. Behind such a pinch the hero was trapped for good (the kennel nook
    between the pet carrier and the dog bed). Sealing what an honest body cannot reach removes
    those pockets on every map, present and future, without touching the shared walk code.
    Returns how many cells were closed."""
    sub = lib.SUB
    k = SEAL_STEP // sub
    ch, cw = m.solid.shape
    pad = np.pad(m.solid, 2, constant_values=True)  # outside the map is wall

    def near(a: int, b: int, ox: int, oy: int, r2: float) -> bool:
        # lattice point (a, b) of a cell against the cell (ox, oy) away, in tiles
        dx = max(ox - a / k, 0.0, a / k - (ox + 1)) / sub
        dy = max(oy - b / k, 0.0, b / k - (oy + 1)) / sub
        return dx * dx + dy * dy < r2

    # where the body stands: same test as canStand (r − 1e-6, d² < r² − 1e-9)
    rs = HERO_R - 1e-6
    stand = np.zeros((ch * k, cw * k), bool)
    for b in range(k):
        for a in range(k):
            blocked = np.zeros((ch, cw), bool)
            for oy in range(-2, 3):
                for ox in range(-2, 3):
                    if near(a, b, ox, oy, rs * rs - 1e-9):
                        blocked |= pad[2 + oy:2 + oy + ch, 2 + ox:2 + ox + cw]
            stand[b::k, a::k] = ~blocked
    H, W = stand.shape
    st = bytearray(stand.astype(np.uint8).tobytes())
    seen = bytearray(H * W)
    q: deque[int] = deque()
    for x, y, _face in m.spawns.values():
        # the page places a hero that cannot stand at the nearest spot where it can
        j0, i0 = int(round(y * SEAL_STEP)), int(round(x * SEAL_STEP))
        R = 4 * SEAL_STEP
        win = stand[max(0, j0 - R):j0 + R + 1, max(0, i0 - R):i0 + R + 1]
        jj, ii = np.nonzero(win)
        if not len(jj):
            continue
        jj, ii = jj + max(0, j0 - R), ii + max(0, i0 - R)
        n = int(np.argmin((jj - j0) ** 2 + (ii - i0) ** 2))
        p = int(jj[n]) * W + int(ii[n])
        if not seen[p]:
            seen[p] = 1
            q.append(p)
    # a standing body never touches the map edge, so the neighbours stay in range
    while q:
        p = q.pop()
        for nb in (p + 1, p - 1, p + W, p - W):
            if st[nb] and not seen[nb]:
                seen[nb] = 1
                q.append(nb)
    reach = np.frombuffer(bytes(seen), np.uint8).reshape(H, W).astype(bool)
    rt = HERO_R + SEAL_MARGIN
    touched = np.zeros((ch + 4, cw + 4), bool)
    for b in range(k):
        for a in range(k):
            ra = reach[b::k, a::k]
            if not ra.any():
                continue
            for oy in range(-2, 3):
                for ox in range(-2, 3):
                    if near(a, b, ox, oy, rt * rt):
                        touched[2 + oy:2 + oy + ch, 2 + ox:2 + ox + cw] |= ra
    sealed = ~m.solid & ~touched[2:-2, 2:-2]
    m.solid |= sealed
    return int(sealed.sum())


def solid_b64(m: lib.Map) -> str:
    bits = np.packbits(m.solid.astype(np.uint8).reshape(-1))
    return base64.b64encode(bits.tobytes()).decode()


def map_json(m: lib.Map) -> dict:
    return {
        'id': m.id, 'name': m.name, 'kind': m.kind, 'w': m.w, 'h': m.h,
        'ambient': round(m.ambient, 3), 'music': m.music, 'bg': m.bg,
        'sub': lib.SUB,
        'solid': solid_b64(m),
        'objs': [[o.sprite, o.x, o.y, o.base, 1 if o.layer == 'top' else 0, o.fps, round(o.phase, 3)] for o in m.objs],
        'npcs': [{'id': n.id, 'sheet': n.sheet, 'x': round(n.x, 3), 'y': round(n.y, 3), 'face': n.face,
                  'anim': n.anim, 'name': n.name} for n in m.npcs],
        'doors': [{'x': d.x, 'y': d.y, 'w': d.w, 'h': d.h, 'to': d.to, 'at': d.at, 'kind': d.kind,
                   'label': d.label, 'lock': d.lock} for d in m.doors],
        'lights': [[round(L.x), round(L.y), round(L.r), L.color, L.kind, 1 if L.night else 0] for L in m.lights],
        'fx': [[f.kind, round(f.x), round(f.y), f.rate] for f in m.fx],
        'spawns': {k: [round(v[0], 3), round(v[1], 3), v[2]] for k, v in m.spawns.items()},
        'marks': {k: [round(v[0], 3), round(v[1], 3)] for k, v in m.marks.items()},
        'searchlights': [[round(a), round(b), round(c, 3)] for a, b, c in m.searchlights],
    }


HEADER = '''// Generated by scripts/hub/build.py — do not edit by hand (v2.80, the prison square).
//
// Units: tiles are 16 px. Map w/h, npc/door/spawn positions are in tiles; objects, lights and
// effects in pixels. objs: [sprite, x, y, base, top, fps, phase] — x/y is the sprite's top-left,
// base the pixel row where it stands (depth sorting with actors), top = always drawn over actors.
// solid: bit-packed collision grid of `sub` cells per tile (w*sub × h*sub, row-major, MSB first),
// 1 = blocked. sub = 4 (quarter tiles) since v2.80.1; the engine defaults to 2 if it is missing.
// HUB_SPRITES: name → [x, y, w, h, frames] in /hub/atlas.png; frames lie side by side.
'''


def dumps(obj) -> str:
    """JSON with one short list per line: arrays without nested brackets collapse onto a line,
    so the generated TS stays readable and diffs stay small."""
    s = json.dumps(obj, ensure_ascii=False, indent=1)
    return re.sub(r'\[\s*([^\[\]{}]*?)\s*\]', lambda mm: '[' + re.sub(r'\s*\n\s*', ' ', mm.group(1)) + ']', s)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true')
    a = ap.parse_args()
    built = [maps.load(id) for id in maps.MAPS]
    for m in built:
        n = seal_unreachable(m)
        if n:
            print(f'  {m.id}: sealed {n} unreachable cells')
    # every door must lead somewhere real
    ids = {m.id for m in built}
    for m in built:
        for d in m.doors:
            if d.to.startswith('@'):
                continue  # a game action (@prison, @dungeon, @zone, @board, @back), not a map
            if d.to not in ids:
                print(f'  ! {m.id}: door to {d.to!r} — no such map yet')
            else:
                tgt = next(x for x in built if x.id == d.to)
                if d.at not in tgt.spawns:
                    print(f'  ! {m.id}: door to {d.to}:{d.at} — no such spawn')
    atlas, rects = pack(lib.SPRITES)
    residents = sorted({n.sheet for m in built for n in m.npcs})
    files: dict[str, bytes] = {'atlas.png': png_bytes(atlas)}
    for m in built:
        files[f'maps/{m.id}.png'] = png_bytes(m.ground)
    for r in residents:
        files[f'chars/{r}.png'] = png_bytes(chars.sheet(r))
        files[f'faces/{r}.png'] = png_bytes(chars.face(r))
    data = {m.id: map_json(m) for m in built}
    h = hashlib.sha1()
    for k in sorted(files):
        h.update(k.encode()); h.update(files[k])
    h.update(json.dumps(data, sort_keys=True).encode())
    rev = h.hexdigest()[:10]
    ts = HEADER
    ts += f"\nexport const HUB_REV = '{rev}';\n"
    ts += f'\nexport const HUB_ATLAS = {{ w: {atlas.w}, h: {atlas.h} }} as const;\n'
    ts += '\nexport const HUB_SPRITES: Record<string, readonly [number, number, number, number, number]> = '
    ts += dumps({k: rects[k] for k in sorted(rects)}) + ';\n'
    ts += '\nexport const HUB_RESIDENTS = ' + json.dumps(residents) + ' as const;\n'
    ts += '''
export type HubObjRow = [sprite: string, x: number, y: number, base: number, top: 0 | 1, fps: number, phase: number];
export type HubLightRow = [x: number, y: number, r: number, color: string, kind: string, night: 0 | 1];
export type HubFxRow = [kind: string, x: number, y: number, rate: number];
export interface HubNpcData { id: string; sheet: string; x: number; y: number; face: number; anim: string; name: string }
export interface HubDoorData { x: number; y: number; w: number; h: number; to: string; at: string; kind: string; label: string; lock: string }
export interface HubMapData {
  id: string; name: string; kind: 'indoor' | 'outdoor'; w: number; h: number;
  ambient: number; music: string; bg: string; sub?: number; solid: string;
  objs: HubObjRow[]; npcs: HubNpcData[]; doors: HubDoorData[]; lights: HubLightRow[]; fx: HubFxRow[];
  spawns: Record<string, [number, number, number]>; marks: Record<string, [number, number]>;
  searchlights: [number, number, number][];
}
'''
    ts += '\nexport const HUB_MAPS: Record<string, HubMapData> = ' + dumps(data) + ';\n'
    total = sum(len(b) for b in files.values())
    if a.check:
        out = os.path.join(HERE, '.out', 'build')
    else:
        out = PUB
    for k, b in files.items():
        p = os.path.join(out, k)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, 'wb') as f:
            f.write(b)
    if not a.check:
        # drop files of maps/residents that no longer exist
        for sub in ('maps', 'chars', 'faces'):
            d = os.path.join(PUB, sub)
            if os.path.isdir(d):
                for fn in os.listdir(d):
                    if f'{sub}/{fn}' not in files:
                        os.remove(os.path.join(d, fn))
        with open(TS, 'w') as f:
            f.write(ts)
    print(f'hub {rev}: {len(built)} maps, {len(rects)} sprites, atlas {atlas.w}x{atlas.h}, '
          f'{len(residents)} residents, {total / 1024:.0f} KB')
    for k in sorted(files):
        print(f'  {k:28s} {len(files[k]) / 1024:7.1f} KB')


if __name__ == '__main__':
    main()
