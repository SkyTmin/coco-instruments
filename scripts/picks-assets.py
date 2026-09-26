#!/usr/bin/env python3
"""Кирки кузницы (v2.66) — из готового набора, не рисованные.

Kenney «Voxel Pack» (CC0), `Items/pick_*.png`: у всех кирок набора одна и та
же деревянная рукоять, отличается только головка. Головка серебряной кирки
(самая светлая, три тона светотени) отделяется от рукояти по насыщенности —
дерево оранжевое, серебро почти серое — и перекрашивается в цвет каждой из
17 кирок с сохранением тонов.

KENNEY — путь к клону github.com/shorepine/kenney. Выход —
public/ui/picks/p{номер}.png, 64×64. Цвета — `head` из src/lib/economy.ts.
"""

import colorsys
import os
import re

from PIL import Image

KENNEY = os.environ.get('KENNEY', '')
ITEMS = os.path.join(KENNEY, '2d', 'Voxel Pack', 'Items')
ROOT = os.path.join(os.path.dirname(__file__), '..')
OUT = os.path.join(ROOT, 'public', 'ui', 'picks')
SIZE = 64


def hexrgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def heads():
    """Цвета головок — прямо из economy.ts, чтобы не разъехались."""
    src = open(os.path.join(ROOT, 'src', 'lib', 'economy.ts'), encoding='utf-8').read()
    block = src[src.index('export const PICKS'):src.index('];', src.index('export const PICKS'))]
    return re.findall(r"head: '(#[0-9a-fA-F]{6})'", block)


def lum(c):
    return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255


def main():
    silver = Image.open(os.path.join(ITEMS, 'pick_silver.png')).convert('RGBA')
    w, h = silver.size
    sp = silver.load()

    def is_head(c):
        if c[3] == 0:
            return False
        return colorsys.rgb_to_hsv(*(v / 255 for v in c[:3]))[1] < 0.3

    mask = [[is_head(sp[x, y]) for y in range(h)] for x in range(w)]
    ls = [lum(sp[x, y]) for x in range(w) for y in range(h) if mask[x][y]]
    ref = sorted(ls)[len(ls) // 2]
    os.makedirs(OUT, exist_ok=True)
    for i, hexc in enumerate(heads()):
        target = hexrgb(hexc)
        im = silver.copy()
        px = im.load()
        for x in range(w):
            for y in range(h):
                if not mask[x][y]:
                    continue
                f = lum(sp[x, y]) / ref
                if f <= 1:
                    c = tuple(int(t * (0.35 + 0.65 * f)) for t in target)
                else:
                    k = min(1, (f - 1) * 2.2)
                    c = tuple(int(t + (255 - t) * k) for t in target)
                px[x, y] = c + (sp[x, y][3],)
        im.resize((SIZE, SIZE), Image.LANCZOS).save(os.path.join(OUT, f'p{i}.png'), optimize=True)
    print(f'{len(heads())} кирок → {OUT}')


if __name__ == '__main__':
    main()
