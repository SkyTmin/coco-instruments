#!/usr/bin/env python3
"""
Картинки живности шахты и риск-игры (v2.64) → public/ui/cards, public/ui/critters.

Источники (CC0, подробно — public/ui/CREDITS.txt):
  KENNEY      — папка 2d клона github.com/shorepine/kenney
                (Kenney «Playing Cards Pack»)
  SUPERPOWERS — клон github.com/sparklinlabs/superpowers-asset-packs
                (Pixel-boy, prehistoric-platformer/monsters/bat-1.png, bat-2.png)
Сорока нарисована здесь же, по пикселям (FR ниже).

Что получается:
  cards/deck.png   — 14×4 карт 42×60: ряды пики, червы, бубны, трефы;
                     столбцы 2…10, В, Д, К, Т и рубашка (своя, в цветах лагеря).
  critters/bat.png — 2 ряда (бурая, синяя) × 5 кадров 51×57:
                     взмах 1, 2, 3, удар, оглушена.
  critters/magpie.png — 3 кадра 32×16: крылья вверх, планирует, вниз.

Запуск: KENNEY=… SUPERPOWERS=… python3 scripts/critters-assets.py
Нужен Pillow.
"""

import os

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'ui')
KENNEY = os.environ.get('KENNEY', '')
SUPER = os.environ.get('SUPERPOWERS', '')

# ---- Колода -----------------------------------------------------------------

SUITS = ['spades', 'hearts', 'diamonds', 'clubs']
RANKS = ['02', '03', '04', '05', '06', '07', '08', '09', '10', 'J', 'Q', 'K', 'A']
BOX = (11, 2, 53, 62)  # карта внутри холста 64×64
CW, CH = BOX[2] - BOX[0], BOX[3] - BOX[1]

FILL = (199, 215, 236)
LINE = (255, 255, 255)
CRIMSON = (142, 31, 46)
CRIMSON_D = (104, 20, 34)
GOLD = (227, 184, 90)
GOLD_D = (160, 112, 40)


def card(name):
    p = os.path.join(KENNEY, 'Playing Cards Pack', 'Cards (large)', f'card_{name}.png')
    return Image.open(p).convert('RGBA').crop(BOX)


def back():
    """Рубашка: малиновое поле с сеткой, золотая рамка и ромб в центре."""
    im = card('back')
    px = im.load()
    for y in range(CH):
        for x in range(CW):
            r, g, b, a = px[x, y]
            if not a:
                continue
            if (r, g, b) == FILL:
                lattice = (x + y) % 6 == 0 or (x - y) % 6 == 0
                px[x, y] = (CRIMSON_D if lattice else CRIMSON) + (255,)
            elif (r, g, b) == LINE:
                px[x, y] = GOLD + (255,)
    # Ромб-медальон.
    cx, cy = CW // 2, CH // 2
    for y in range(CH):
        for x in range(CW):
            d = abs(x - cx + 0.5) + abs(y - cy + 0.5)
            if d <= 9.5:
                px[x, y] = (GOLD_D if d > 8 else GOLD if d > 5 else CRIMSON_D) + (255,)
            if 2.2 < d <= 3.2:
                px[x, y] = GOLD + (255,)
    return im


def deck():
    sheet = Image.new('RGBA', (CW * 14, CH * 4), (0, 0, 0, 0))
    b = back()
    for row, s in enumerate(SUITS):
        for col, r in enumerate(RANKS):
            sheet.paste(card(f'{s}_{r}'), (col * CW, row * CH))
        sheet.paste(b, (13 * CW, row * CH))
    os.makedirs(os.path.join(OUT, 'cards'), exist_ok=True)
    sheet.save(os.path.join(OUT, 'cards', 'deck.png'), optimize=True)


# ---- Летучая мышь ------------------------------------------------------------

BW, BH = 51, 57
# Кадры листа 7×2: взмах — r0c0, r0c1, r0c2; удар — r0c6; оглушена — r1c6.
BAT_FRAMES = [(0, 0), (0, 1), (0, 2), (0, 6), (1, 6)]


def bats():
    sheet = Image.new('RGBA', (BW * len(BAT_FRAMES), BH * 2), (0, 0, 0, 0))
    for row, f in enumerate(['bat-1.png', 'bat-2.png']):
        src = Image.open(os.path.join(SUPER, 'prehistoric-platformer', 'monsters', f)).convert('RGBA')
        for k, (r, c) in enumerate(BAT_FRAMES):
            fr = src.crop((c * BW, r * BH, (c + 1) * BW, (r + 1) * BH))
            sheet.paste(fr, (k * BW, row * BH))
    os.makedirs(os.path.join(OUT, 'critters'), exist_ok=True)
    sheet.save(os.path.join(OUT, 'critters', 'bat.png'), optimize=True)


# ---- Сорока ------------------------------------------------------------------

PAL = {
    '.': None,
    'O': (8, 9, 14),
    'K': (24, 26, 34),
    'k': (48, 54, 70),
    'B': (40, 78, 146),
    'b': (84, 132, 204),
    'G': (30, 92, 82),
    'g': (62, 146, 124),
    'W': (246, 246, 240),
    'w': (190, 196, 206),
    'E': (230, 190, 90),
}

MAGPIE = {
    'up': [
        "..........OOOOO.................",
        ".........OKWWWWO................",
        "........OKWWWWWO................",
        ".......OKWWWWWKO................",
        "........OWWWWKBO................",
        ".........OKKBbBO........OOOO....",
        "..........OKBbBBO......OkkkkO...",
        "...........OKBBBBOOOOOOkKKKEkOO.",
        "............OkkBBkkkkkkKKKKKKKKO",
        "OOOO.......OWWWKKKKKKKKKKKKKOOO.",
        "OgGGOOOOOOOWWWWKKKKKKKKKKKKO....",
        ".OGGGGGgggKKKKWWWWWWWKKKKKKO....",
        "..OOOOOGGGKKKKKWWWWWWWKKKKO.....",
        "......OOOOOOOKwwWWWWWwKKOO......",
        "............OOOOOOOOOOOO........",
        "................................",
    ],
    'glide': [
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "........................OOOO....",
        ".......................OkkkkO...",
        "..............OOOOOOOOOkKKKEkOO.",
        "............OOkkkkkkkkKKKKKKKKKO",
        "OOOO.......OWWWWBBbbBBKKKKKKOOO.",
        "OgGGOOOOOOOWWWWWBBBBBBKKKKKKO...",
        ".OGGGGGgggKKKKWWWWWWWKKKKKKO....",
        "..OOOOOGGGKKKKKWWWWWWWKKKKO.....",
        "......OOOOOOOKwwWWWWWwKKOO......",
        "............OOOOOOOOOOOO........",
        "................................",
    ],
    'down': [
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "........................OOOO....",
        ".......................OkkkkO...",
        "..............OOOOOOOOOkKKKEkOO.",
        "............OOkkkkkkkkKKKKKKKKKO",
        "OOOO.......OWWWKKKKKKKKKKKKKOOO.",
        "OgGGOOOOOOOWWWWBBBBKKKKKKKKO....",
        ".OGGGGGgggKKKBBBbbBBWWKKKKKO....",
        "..OOOOOGGGKKBBBbBBWWWKKKKKO.....",
        "......OOOOOKBBBBWWWWwKKOO.......",
        "..........OKBBWWWWOOOO..........",
        ".........OKWWWWWO...............",
    ],
}


def magpie():
    names = ['up', 'glide', 'down']
    w, h = 32, 16
    sheet = Image.new('RGBA', (w * len(names), h), (0, 0, 0, 0))
    for k, n in enumerate(names):
        for y, row in enumerate(MAGPIE[n]):
            assert len(row) == w, (n, y, len(row))
            for x, ch in enumerate(row):
                c = PAL[ch]
                if c:
                    sheet.putpixel((k * w + x, y), c + (255,))
    sheet.save(os.path.join(OUT, 'critters', 'magpie.png'), optimize=True)


if __name__ == '__main__':
    if not KENNEY or not SUPER:
        raise SystemExit('Нужны KENNEY и SUPERPOWERS — см. шапку скрипта')
    deck()
    bats()
    magpie()
    print('ok')
