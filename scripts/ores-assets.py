#!/usr/bin/env python3
"""Руды и блоки этажей шахты (v2.66) — из готовых наборов, не рисованные.

Руда в камне — Kenney «Voxel Pack» (CC0): камень-основа и восемь видов
вкраплений (уголь, железо, бурое железо, серебро, золото, алмаз, рубин,
изумруд). Для 31 породы вкрапления переносятся на другую основу и
перекрашиваются в цвет руды с сохранением светотени — формы остаются
Kenney. Блок этажа — гранёная кристальная стена из тайлов Dungeon Crawl Stone
Soup (CC0), тоже перекрашенная в цвет руды: цельный куб против вкраплений в
камне, как алмазный блок и алмазная руда в Майнкрафте.

Пути к клонам — KENNEY (github.com/shorepine/kenney) и DCSS
(github.com/crawl/tiles). Выход — public/ui/ores/r{порода}-{вариант}.png
(4 варианта) и b{порода}.png, 64×64. PREVIEW=путь — лист всех пород.
"""

import colorsys
import os
import sys

from PIL import Image

KENNEY = os.environ.get('KENNEY', '')
DCSS = os.environ.get('DCSS', '')
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'ui', 'ores')
SIZE = 64

T = os.path.join(KENNEY, '2d', 'Voxel Pack', 'Tiles')
TX = os.path.join(KENNEY, '2d', 'Voxel Expansion Pack')
W = os.path.join(DCSS, 'releases', 'Nov-2015', 'dngn', 'wall')


def load(path):
    return Image.open(path).convert('RGBA')


def hexrgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


# Основы (пустая порода). Ключ — имя, значение — (файл, оттенок или None).
def host(name):
    files = {
        'dirt': os.path.join(T, 'dirt.png'),
        'sand': os.path.join(T, 'sand.png'),
        'greysand': os.path.join(T, 'greysand.png'),
        'gravel': os.path.join(T, 'gravel_stone.png'),
        'stone': os.path.join(T, 'stone.png'),
        'greystone': os.path.join(T, 'greystone.png'),
        'redstone': os.path.join(T, 'redstone.png'),
        'dark': os.path.join(TX, 'tile_stoneDark.png'),
        'lava': os.path.join(T, 'lava.png'),
        'redsand': os.path.join(T, 'redsand.png'),
    }
    im = load(files[name])
    # Тайлы расширения набора мельче основных — приводим к 128.
    return im if im.size == (128, 128) else im.resize((128, 128), Image.NEAREST)


def tint(im, rgb, amount):
    """Сдвинуть основу к цвету: обсидиан из тёмного камня и т. п."""
    tr, tg, tb = rgb
    px = im.load()
    out = im.copy()
    po = out.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            l = (r * 0.3 + g * 0.59 + b * 0.11) / 255
            nr = r * (1 - amount) + tr * l * 1.6 * amount
            ng = g * (1 - amount) + tg * l * 1.6 * amount
            nb = b * (1 - amount) + tb * l * 1.6 * amount
            po[x, y] = (min(255, int(nr)), min(255, int(ng)), min(255, int(nb)), a)
    return out


# Вкрапления: файл руды и основа, на которой она нарисована.
PATTERNS = {
    'coal': ('stone_coal', 'stone'),
    'iron': ('stone_iron', 'stone'),
    'brown': ('stone_browniron', 'stone'),
    'silver': ('stone_silver', 'stone'),
    'gold': ('stone_gold', 'stone'),
    'diamond': ('stone_diamond', 'stone'),
    'ruby': ('greystone_ruby', 'greystone'),
    'emerald': ('redstone_emerald', 'redstone'),
}


def chunk_layer(pattern, alt):
    """Разность руды и её основы: вкрапления (цвет) и их тени (затемнение)."""
    ore_name, base_name = PATTERNS[pattern]
    ore = load(os.path.join(T, ore_name + ('_alt' if alt else '') + '.png'))
    base = host(base_name)
    op, bp = ore.load(), base.load()
    chunk = {}
    shade = {}
    for y in range(ore.height):
        for x in range(ore.width):
            o = op[x, y][:3]
            b = bp[x, y][:3]
            d = sum(abs(o[i] - b[i]) for i in range(3))
            if d < 18:
                continue
            ho, so, vo = colorsys.rgb_to_hsv(*(c / 255 for c in o))
            hb, sb, vb = colorsys.rgb_to_hsv(*(c / 255 for c in b))
            dh = min(abs(ho - hb), 1 - abs(ho - hb))
            # Тень — тот же цвет основы, только темнее.
            if dh < 0.06 and abs(so - sb) < 0.12 and vo < vb:
                shade[(x, y)] = vo / max(0.01, vb)
            else:
                chunk[(x, y)] = (ho, so, vo)
    return chunk, shade


def recolor(hsv, target, mean_v):
    """Перекрасить вкрапление в цвет target, сохранив светотень формы."""
    if target is None:
        return tuple(int(c * 255) for c in colorsys.hsv_to_rgb(*hsv))
    th, ts, tv = colorsys.rgb_to_hsv(*(c / 255 for c in hexrgb(target)))
    _, s, v = hsv
    nv = max(0.0, min(1.0, tv * (v / max(0.01, mean_v))))
    ns = max(0.0, min(1.0, ts * (0.6 + 0.4 * (s / max(0.01, s + 0.2)) * 1.4)))
    return tuple(int(c * 255) for c in colorsys.hsv_to_rgb(th, ns, nv))


def ore_tile(spec, alt):
    base = host(spec['host'])
    if spec.get('tint'):
        base = tint(base, hexrgb(spec['tint'][0]), spec['tint'][1])
    if spec.get('pattern'):
        chunk, shade = chunk_layer(spec['pattern'], alt)
        mean_v = sum(v for (_, _, v) in chunk.values()) / max(1, len(chunk))
        px = base.load()
        for (x, y), k in shade.items():
            r, g, b, a = px[x, y]
            px[x, y] = (int(r * k), int(g * k), int(b * k), a)
        for (x, y), hsv in chunk.items():
            r, g, b = recolor(hsv, spec.get('color'), mean_v)
            px[x, y] = (r, g, b, 255)
    return base.resize((SIZE, SIZE), Image.LANCZOS)


def block_tile(spec):
    """Кристальный куб Dungeon Crawl в цвет руды: светлый исходник красим."""
    src = load(os.path.join(W, 'crystal_wall_' + spec.get('crystal', 'white') + '.png'))
    target = spec.get('block')
    if target:
        th, ts, tv = colorsys.rgb_to_hsv(*(c / 255 for c in hexrgb(target)))
        px = src.load()
        for y in range(src.height):
            for x in range(src.width):
                r, g, b, a = px[x, y]
                if a == 0:
                    continue
                h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
                # Блок обязан светиться ярче руды: подъём яркости и
                # насыщенности, блики исходника остаются белыми.
                nv = max(0.0, min(1.0, v * (0.8 + 0.7 * tv) + 0.1))
                if tv < 0.35:
                    # Тёмный блок (уголь) остаётся тёмным, блестят только грани.
                    nv = max(0.0, min(1.0, v * 0.6 + 0.04))
                ns = ts * (0.25 + 0.75 * min(1.0, (1.15 - v) * 1.4)) if v > 0.85 else ts

                nr, ng, nb = colorsys.hsv_to_rgb(th, ns, nv)
                px[x, y] = (int(nr * 255), int(ng * 255), int(nb * 255), a)
    return src.resize((SIZE, SIZE), Image.NEAREST)


# Этажи A…Z и пять престижных. host — пустая порода горизонта, pattern —
# форма вкраплений, color — их цвет (None — родной цвет набора), block —
# цвет цельного блока этажа.
OBSIDIAN = ('#4a2a6a', 0.55)
ROCKS = [
    {'id': 'clay', 'host': 'dirt', 'block': '#c46a3a'},
    {'id': 'sandstone', 'host': 'sand', 'block': '#e8c98a'},
    {'id': 'limestone', 'host': 'greysand', 'tint': ('#f2efe4', 0.5), 'block': '#f2efe6'},
    {'id': 'granite', 'host': 'gravel', 'tint': ('#c89a96', 0.35), 'block': '#c88a8a'},
    {'id': 'coal', 'host': 'stone', 'pattern': 'coal', 'block': '#3a3a40'},
    {'id': 'copper', 'host': 'stone', 'pattern': 'gold', 'color': '#e07a3a', 'block': '#d86a2a'},
    {'id': 'iron', 'host': 'stone', 'pattern': 'brown', 'color': '#b8421e', 'block': '#a84a2a'},
    {'id': 'cobalt', 'host': 'stone', 'pattern': 'iron', 'color': '#2a6aff', 'block': '#2a5aff'},
    {'id': 'turquoise', 'host': 'stone', 'pattern': 'iron', 'block': '#3ad0c0'},
    {'id': 'amber', 'host': 'stone', 'pattern': 'diamond', 'color': '#ffa82a', 'block': '#ff9a1a'},
    {'id': 'quartz', 'host': 'greystone', 'pattern': 'diamond', 'color': '#f4f8ff', 'block': '#eef4ff'},
    {'id': 'silver', 'host': 'greystone', 'pattern': 'silver', 'block': '#9ab8e8'},
    {'id': 'opal', 'host': 'greystone', 'pattern': 'emerald', 'color': '#ffc8e8', 'block': '#f8c8f0'},
    {'id': 'malachite', 'host': 'greystone', 'pattern': 'coal', 'color': '#1ab86a', 'block': '#10a060'},
    {'id': 'gold', 'host': 'greystone', 'pattern': 'gold', 'block': '#ffcc1a'},
    {'id': 'amethyst', 'host': 'greystone', 'pattern': 'diamond', 'color': '#b05aff', 'block': '#a040f0'},
    {'id': 'lapis', 'host': 'dark', 'pattern': 'brown', 'color': '#2a4aff', 'block': '#1a3ae0'},
    {'id': 'jade', 'host': 'dark', 'pattern': 'coal', 'color': '#8ae0a0', 'block': '#7ad09a'},
    {'id': 'garnet', 'host': 'dark', 'pattern': 'gold', 'color': '#c01a3a', 'block': '#a01030'},
    {'id': 'topaz', 'host': 'dark', 'pattern': 'ruby', 'color': '#ff8a1a', 'block': '#ff7a10'},
    {'id': 'sapphire', 'host': 'dark', 'pattern': 'diamond', 'color': '#2a6aff', 'block': '#1a4aff'},
    {'id': 'emerald', 'host': 'dark', 'pattern': 'emerald', 'block': '#1ad060'},
    {'id': 'ruby', 'host': 'dark', 'tint': OBSIDIAN, 'pattern': 'ruby', 'block': '#ff1a3a'},
    {'id': 'diamond', 'host': 'dark', 'tint': OBSIDIAN, 'pattern': 'diamond', 'block': '#9af0ff'},
    {'id': 'meteorite', 'host': 'lava', 'pattern': 'coal', 'color': '#2a2020', 'block': '#ff5a1a'},
    {'id': 'starstone', 'host': 'dark', 'tint': ('#1a1a60', 0.6), 'pattern': 'silver', 'color': '#bff4ff', 'block': '#6a8aff'},
    # Престижные — только в спецзоне.
    {'id': 'rhodonite', 'host': 'greystone', 'pattern': 'ruby', 'color': '#ff7aa0', 'block': '#f06a90'},
    {'id': 'lovchorrite', 'host': 'sand', 'pattern': 'brown', 'color': '#c08a3a', 'block': '#d0a060'},
    {'id': 'charoite', 'host': 'dark', 'tint': OBSIDIAN, 'pattern': 'silver', 'color': '#d08aff', 'block': '#b060f0'},
    {'id': 'demantoid', 'host': 'dark', 'tint': OBSIDIAN, 'pattern': 'emerald', 'color': '#b0ff3a', 'block': '#9af03a'},
    {'id': 'alexandrite', 'host': 'dark', 'tint': OBSIDIAN, 'pattern': 'diamond', 'color': '#1ad0b0', 'block': '#c01a60'},
]


def main():
    if not KENNEY or not DCSS:
        sys.exit('Задайте KENNEY и DCSS — пути к клонам наборов.')
    os.makedirs(OUT, exist_ok=True)
    sheet = None
    preview = os.environ.get('PREVIEW')
    if preview:
        sheet = Image.new('RGBA', (5 * (SIZE + 4), len(ROCKS) * (SIZE + 4)), (30, 30, 30, 255))
    for i, spec in enumerate(ROCKS):
        tiles = []
        for v in range(4):
            t = ore_tile(spec, alt=v % 2 == 1)
            if v >= 2:
                t = t.rotate(180 if v == 2 else 90)
            tiles.append(t)
            t.save(os.path.join(OUT, f'r{i}-{v}.png'), optimize=True)
        b = block_tile(spec)
        b.save(os.path.join(OUT, f'b{i}.png'), optimize=True)
        if sheet:
            for k, t in enumerate(tiles + [b]):
                sheet.paste(t, (k * (SIZE + 4), i * (SIZE + 4)))
    if sheet:
        sheet.save(preview)
    print('руд', len(ROCKS), '→', OUT)


if __name__ == '__main__':
    main()
