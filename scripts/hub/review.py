"""Look at a map the way the game will draw it (v2.80).

    python3 scripts/hub/review.py forge [square …] [--scale 3] [--night] [--solid] [--out DIR]

Draws ground, objects and residents sorted by their feet exactly like hub-render.ts, puts the
dungeon hero at the spawn for scale, and writes <out>/<id>.png (×scale, nearest neighbour).
--night lays the night grade with the map's lights cut out of it (a preview, the game's light
layer is softer); --solid tints the collision cells red. Default out: scripts/hub/.out/review.
"""
from __future__ import annotations

import argparse
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import numpy as np  # noqa: E402

import chars  # noqa: E402
import lib  # noqa: E402
from lib import T, Img  # noqa: E402
import maps  # noqa: E402


def hero() -> Img:
    sh = Img.open(os.path.join(lib.ROOT, 'public', 'dungeon', 'na', 'char3.png'))
    return sh.crop(0, 0, 16, 16)


def render(m: lib.Map, night: bool = False, solid: bool = False, frame: int = 0) -> Img:
    out = m.ground.copy()
    items = []
    for o in m.objs:
        fr = lib.SPRITES[o.sprite][frame % o.frames]
        items.append((o.base if o.layer == 'sort' else 1e9, o.x, o.y, fr))
    for n in m.npcs:
        col = n.face
        row = 4 if (n.anim == 'work' and frame % 2) else 0
        fr = chars.sheet(n.sheet).crop(col * T, row * T, T, T)
        items.append((n.y * T, int(n.x * T - 8), int(n.y * T - 13), fr))
    if 'in' in m.spawns or m.spawns:
        sx, sy, _ = m.spawns.get('in', next(iter(m.spawns.values())))
        items.append((sy * T + 0.02, int(sx * T - 8), int(sy * T - 13), hero()))
    for base, x, y, fr in sorted(items, key=lambda t: t[0]):
        out.paste_(fr, x, y)
    if solid:
        c = T // lib.SUB
        red = Img.new(c, c, '#ff0000')
        for yy, xx in zip(*np.nonzero(m.solid)):
            out.paste_(red, xx * c, yy * c, 0.28)
        for d in m.doors:
            out.rect_(int(d.x * T), int(d.y * T), int(d.w * T), int(d.h * T), '#00ffff', 0.35)
    if night:
        dark = Img.new(out.w, out.h, '#0c1030')
        a = dark.a.astype(np.float32)
        a[:, :, 3] = 255 * (0.78 if m.kind == 'outdoor' else 0.45)
        yy, xx = np.mgrid[0:out.h, 0:out.w]
        glow = np.zeros((out.h, out.w, 3), np.float32)
        for L in m.lights:
            d = np.sqrt((xx - L.x) ** 2 + (yy - L.y) ** 2) / max(L.r, 1)
            k = np.clip(1 - d, 0, 1) ** 1.6
            a[:, :, 3] *= 1 - k * 0.92
            c = np.array(lib.hexrgb(L.color)[:3], np.float32)
            glow += k[:, :, None] * c * 0.35
        dark = Img(np.clip(a, 0, 255).astype(np.uint8))
        out.paste_(dark, 0, 0)
        o = out.a.astype(np.float32)
        o[:, :, :3] = np.clip(o[:, :, :3] + glow, 0, 255)
        out = Img(o.astype(np.uint8))
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('ids', nargs='*')
    ap.add_argument('--scale', type=int, default=3)
    ap.add_argument('--night', action='store_true')
    ap.add_argument('--solid', action='store_true')
    ap.add_argument('--frame', type=int, default=0)
    ap.add_argument('--out', default=os.path.join(HERE, '.out', 'review'))
    a = ap.parse_args()
    ids = a.ids or maps.MAPS
    os.makedirs(a.out, exist_ok=True)
    for id in ids:
        m = maps.load(id)
        img = render(m, solid=a.solid, frame=a.frame)
        img.scale(a.scale).save(os.path.join(a.out, f'{id}.png'))
        if a.night:
            render(m, night=True, frame=a.frame).scale(a.scale).save(os.path.join(a.out, f'{id}-night.png'))
        print(id, '->', os.path.join(a.out, f'{id}.png'), f'{m.w}x{m.h} tiles, {len(m.objs)} objects, {len(m.npcs)} residents')


if __name__ == '__main__':
    main()
