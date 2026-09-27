"""Look at the square's facades side by side (v2.80).

    python3 scripts/hub/review_facades.py [ids …] [--scale 3] [--night] [--lines] [--frame N]
                                          [--width 480] [--out DIR]

Every facade stands on a dirt patch the way the square will place it (bottom edge on the
footprint's bottom edge, centred), with the dungeon hero standing in front of its door for scale.
--lines outlines the footprints (cyan) and the door cells (yellow); --night lays the night grade
with the facade's lights cut out (same preview as review.py); --frame picks an animation frame;
--anim writes every frame of animated facades as <id>-f<N>.png. Rows wrap at --width px.
Output: <out>/facades.png (and facades-night.png); default out is scripts/hub/.out/review.
"""
from __future__ import annotations

import argparse
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import numpy as np  # noqa: E402

import facades  # noqa: E402
import lib  # noqa: E402
from kit import floor_tile, text  # noqa: E402
from lib import T, Img  # noqa: E402


NAMES = {'tower': 'БАШНЯ ЧАРОДЕЯ', 'trader': 'ТОРГОВЕЦ', 'zone': 'ОСОБАЯ ЗОНА', 'watchtower': 'ВЫШКА'}


def hero() -> Img:
    sh = Img.open(os.path.join(lib.ROOT, 'public', 'dungeon', 'na', 'char3.png'))
    return sh.crop(0, 0, 16, 16)


def night_grade(img: Img, lights: list[tuple[float, float, float, str, str, bool]]) -> Img:
    dark = Img.new(img.w, img.h, '#0c1030')
    a = dark.a.astype(np.float32)
    a[:, :, 3] = 255 * 0.78
    yy, xx = np.mgrid[0:img.h, 0:img.w]
    glow = np.zeros((img.h, img.w, 3), np.float32)
    for (x, y, r, color, kind, night) in lights:
        d = np.sqrt((xx - x) ** 2 + (yy - y) ** 2) / max(r, 1)
        k = np.clip(1 - d, 0, 1) ** 1.6
        a[:, :, 3] *= 1 - k * 0.92
        c = np.array(lib.hexrgb(color)[:3], np.float32)
        glow += k[:, :, None] * c * 0.35
    out = img.copy()
    out.paste_(Img(np.clip(a, 0, 255).astype(np.uint8)), 0, 0)
    o = out.a.astype(np.float32)
    o[:, :, :3] = np.clip(o[:, :, :3] + glow, 0, 255)
    return Img(o.astype(np.uint8))


def layout(ids: list[str], width: int, frame: int, lines: bool) -> tuple[Img, list]:
    fs = [facades.facade(i) for i in ids]
    gap = 2 * T
    rows, row, x = [], [], gap
    for f in fs:
        w = f.fw * T + 2 * max(f.over, 0)
        if row and x + w + gap > width:
            rows.append(row); row, x = [], gap
        row.append((f, x)); x += w + gap
    rows.append(row)
    heights = [max(f.img.h for f, _ in r) + 3 * T for r in rows]
    W = max(sum(f.fw * T + 2 * f.over + gap for f, _ in r) + gap for r in rows)
    W = (W + T - 1) // T * T
    H = (sum(heights) + T - 1) // T * T
    out = Img.new(W, H)
    for ty in range(H // T):
        for tx in range(W // T):
            out.paste_(floor_tile('dirt', tx, ty, 2), tx * T, ty * T)
    lights = []
    y0 = 0
    hr = hero()
    for r, rh in zip(rows, heights):
        base = y0 + rh - 2 * T                      # footprint bottom row edge, on the tile grid
        base = base // T * T
        for f, x in r:
            fl = (x + f.over) // T * T              # footprint left, on the grid
            fx = fl - f.over
            img = f.frames[frame % len(f.frames)] if f.frames else f.img
            top = base - img.h
            if lines:
                out.rect_(fl, base - f.fh * T, f.fw * T, f.fh * T, '#00ffff', 0.18)
            out.paste_(img, fx, top)
            if lines:
                c = '#00ffff'
                out.rect_(fl, base - f.fh * T, f.fw * T, 1, c); out.rect_(fl, base - 1, f.fw * T, 1, c)
                out.rect_(fl, base - f.fh * T, 1, f.fh * T, c); out.rect_(fl + f.fw * T - 1, base - f.fh * T, 1, f.fh * T, c)
                dx0 = fl + int(f.door_x * T)
                out.rect_(dx0, base - T, int(f.door_w * T), T, '#ffff00', 0.35)
            # the hero in front of the door, facing it (up)
            hx = fl + int((f.door_x + f.door_w / 2) * T) - 8
            out.paste_(hr, hx, base + 2)
            lab = text(NAMES.get(f.id) or facades.FOOTPRINTS[f.id][4] or f.id, '#ffffff')
            out.paste_(lab, fl, base + T + 4)
            for (lx, ly, lr, lc, lk, ln) in f.lights:
                lights.append((fx + lx, top + ly, lr, lc, lk, ln))
        y0 += rh
    return out, lights


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('ids', nargs='*')
    ap.add_argument('--scale', type=int, default=3)
    ap.add_argument('--night', action='store_true')
    ap.add_argument('--lines', action='store_true')
    ap.add_argument('--frame', type=int, default=0)
    ap.add_argument('--anim', action='store_true')
    ap.add_argument('--width', type=int, default=480)
    ap.add_argument('--name', default='facades')
    ap.add_argument('--out', default=os.path.join(HERE, '.out', 'review'))
    a = ap.parse_args()
    ids = a.ids or list(facades.FOOTPRINTS)
    os.makedirs(a.out, exist_ok=True)
    img, lights = layout(ids, a.width, a.frame, a.lines)
    img.scale(a.scale).save(os.path.join(a.out, f'{a.name}.png'))
    print('->', os.path.join(a.out, f'{a.name}.png'), img.w, 'x', img.h)
    if a.night:
        night_grade(img, lights).scale(a.scale).save(os.path.join(a.out, f'{a.name}-night.png'))
    if a.anim:
        for i in ids:
            f = facades.facade(i)
            if f.frames:
                for k in range(len(f.frames)):
                    im, _ = layout([i], a.width, k, False)
                    im.scale(a.scale).save(os.path.join(a.out, f'{i}-f{k}.png'))
                print(i, len(f.frames), 'frames @', f.fps, 'fps')


if __name__ == '__main__':
    main()
