#!/usr/bin/env python3
"""Кирки кузницы (v2.66) — из готового набора, не рисованные.

Kenney «Voxel Pack» (CC0), `Items/pick_*.png`: у всех кирок набора одна и та
же деревянная рукоять, отличается только головка. Головка серебряной кирки
(самая светлая, три тона светотени) отделяется от рукояти по насыщенности —
дерево оранжевое, серебро почти серое — и перекрашивается в цвет каждой из
17 кирок с сохранением тонов.

KENNEY — путь к клону github.com/shorepine/kenney. Выход —
public/ui/picks/p{номер}.png, 64×64. Цвета — `head` из src/lib/economy.ts.

v2.67.2: у каждой кирки тёмный контур в 2 точки и светлая кромка снаружи.
Без них ржавая (бурая головка, рыжая рукоять) сливалась с глиной этажа A и
с деревом кнопок — владелец: «первая ржавая кирка прям сливается с
блоками». Контур — ПО СИЛУЭТУ, а не рамка: кирка читается на любом фоне.
"""

import colorsys
import os
import re

from PIL import Image, ImageFilter

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
    # С v2.67 таблица — строками P(...), цвет головки — единственная строка
    # вида '#rrggbb' в каждой.
    return re.findall(r"'(#[0-9a-fA-F]{6})'", block)


def lum(c):
    return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255


def outlined(im):
    """Кирка чуть меньше холста, вокруг — тёмный контур и светлая кромка."""
    w, h = im.size
    inner = int(w * 0.8)
    pick = im.resize((inner, inner), Image.LANCZOS)
    off = (w - inner) // 2
    canvas = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    canvas.paste(pick, (off, off), pick)
    alpha = canvas.getchannel('A').point(lambda a: 255 if a > 40 else 0)
    # На холсте 128 точек: 4 точки контура и 2 кромки = 2 и 1 на итоговых 64.
    dark = alpha.filter(ImageFilter.MaxFilter(9))
    rim = alpha.filter(ImageFilter.MaxFilter(13))
    out = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    out.paste(Image.new('RGBA', (w, h), (255, 238, 205, 150)), (0, 0), rim)
    out.paste(Image.new('RGBA', (w, h), (26, 16, 10, 255)), (0, 0), dark)
    out.alpha_composite(canvas)
    return out


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
        outlined(im).resize((SIZE, SIZE), Image.LANCZOS).save(
            os.path.join(OUT, f'p{i}.png'), optimize=True
        )
    print(f'{len(heads())} кирок → {OUT}')


if __name__ == '__main__':
    main()
