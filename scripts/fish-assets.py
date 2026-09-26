#!/usr/bin/env python3
"""
Рыбы рыбалки (v2.65) → public/ui/fish/fish.png.

Свободных пиксельных рыб нужного стиля не нашлось (у Kenney «Fish Pack» —
векторные мультяшные, на пиксельном поле они выглядят наклейкой), поэтому
рыбы рисуются здесь: общий силуэт — профиль тела по длине, а у каждого вида
свои пропорции, хвост, плавники, узор и усы. Проверять — листом крупно
(PREVIEW=1 пишет fish_preview.png рядом), а не по одной.

Лист: 40×16 на рыбу, по 8 в ряд, порядок — как FISH в src/lib/fishing.ts;
за рыбами — ракушка, жемчужина, поплавок.

Запуск: python3 scripts/fish-assets.py   (нужен Pillow)
"""

import math
import os

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'ui', 'fish')
W, H = 40, 16


def hexc(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def mix(a, b, k):
    return tuple(int(round(a[i] + (b[i] - a[i]) * k)) for i in range(3))


# Вид: длина и высота тела, где самая высокая точка, хвост, спинной плавник,
# цвета (спина, бок, брюхо, плавники), узор, усы, особенности.
SPECIES = [
    # Пруд
    dict(id='crucian', L=20, Hh=11, peak=0.42, tail='fork', dorsal='long', back='#6d5a1e', side='#c49a2c', belly='#f0d27a', fin='#b0702a', pattern='scales'),
    dict(id='roach', L=20, Hh=8, peak=0.38, tail='fork', dorsal='mid', back='#3d5566', side='#b9c6cf', belly='#eef2f4', fin='#d6503a', pattern='scales', eye='#d6503a'),
    dict(id='perch', L=21, Hh=9, peak=0.4, tail='fork', dorsal='spiny', back='#3f5a26', side='#8fa33a', belly='#e4e2a8', fin='#e0602e', pattern='bars'),
    dict(id='tench', L=21, Hh=9, peak=0.45, tail='round', dorsal='round', back='#2d4a22', side='#5d7a2c', belly='#c8b44a', fin='#3a5a26', pattern='none', eye='#e05030'),
    dict(id='goldfish', L=17, Hh=10, peak=0.45, tail='veil', dorsal='long', back='#d24a14', side='#ff8a1c', belly='#ffd068', fin='#ffb040', pattern='shine'),
    # Река
    dict(id='chub', L=22, Hh=8, peak=0.38, tail='fork', dorsal='mid', back='#34413a', side='#a9b2a8', belly='#e8ece4', fin='#c86038', pattern='scales', head='big'),
    dict(id='ide', L=22, Hh=9, peak=0.4, tail='fork', dorsal='mid', back='#3d4a54', side='#b8b89a', belly='#ecebd8', fin='#d27a44', pattern='scales'),
    dict(id='pike', L=28, Hh=7, peak=0.6, tail='fork', dorsal='rear', back='#2e4a26', side='#6f8a3a', belly='#e6e4c0', fin='#a8763a', pattern='dots_light', head='long'),
    dict(id='zander', L=26, Hh=7, peak=0.45, tail='fork', dorsal='spiny', back='#44504a', side='#98a49a', belly='#e4e8e2', fin='#8a948a', pattern='bars_soft', eye='#e8e8a0'),
    dict(id='catfish', L=28, Hh=8, peak=0.25, tail='round', dorsal='tiny', back='#26282a', side='#4c4e4c', belly='#a8a698', fin='#3a3c3a', pattern='marble', whiskers=2, head='flat'),
    # Озеро
    dict(id='bream', L=20, Hh=12, peak=0.45, tail='fork', dorsal='tall', back='#4a4630', side='#b09a5a', belly='#e4d8a8', fin='#5e5640', pattern='scales'),
    dict(id='carp', L=24, Hh=11, peak=0.42, tail='fork', dorsal='long', back='#5a4318', side='#b78a2a', belly='#ecce86', fin='#a0582a', pattern='bigscales', whiskers=1),
    dict(id='burbot', L=26, Hh=7, peak=0.3, tail='round', dorsal='long2', back='#3c3a22', side='#7a7440', belly='#d0caa0', fin='#5a5632', pattern='marble', whiskers=1, head='flat'),
    dict(id='eel', L=30, Hh=4, peak=0.3, tail='eel', dorsal='eel', back='#2c3420', side='#5c6436', belly='#c8c07a', fin='#4c5430', pattern='none'),
    dict(id='amur', L=26, Hh=9, peak=0.4, tail='fork', dorsal='mid', back='#3c4a34', side='#8c9a6a', belly='#dcdcb8', fin='#6a7450', pattern='bigscales'),
    # Горное озеро
    dict(id='grayling', L=22, Hh=8, peak=0.4, tail='fork', dorsal='flag', back='#3a4454', side='#8c9aac', belly='#dfe4ea', fin='#8a4ab0', pattern='dots_dark'),
    dict(id='trout', L=23, Hh=8, peak=0.42, tail='square', dorsal='mid', back='#4a5a3a', side='#a8b28a', belly='#eee8d4', fin='#8c9070', pattern='trout'),
    dict(id='char', L=23, Hh=8, peak=0.42, tail='fork', dorsal='mid', back='#2e4652', side='#6a8a8e', belly='#f07a3a', fin='#f0703a', pattern='dots_light', fin_edge='#ffffff'),
    dict(id='lenok', L=24, Hh=8, peak=0.42, tail='fork', dorsal='mid', back='#5a4a2a', side='#b89a5a', belly='#ecdcb0', fin='#a07040', pattern='dots_dark'),
    dict(id='taimen', L=30, Hh=8, peak=0.45, tail='fork', dorsal='mid', back='#3e3a30', side='#8a6a4a', belly='#e2c0a0', fin='#b04a2a', pattern='x_dark', head='big'),
    # Море
    dict(id='mackerel', L=24, Hh=7, peak=0.42, tail='fork', dorsal='mid', back='#1e5a6a', side='#9ec0c4', belly='#f2f6f4', fin='#6a8a90', pattern='waves'),
    dict(id='flounder', L=20, Hh=13, peak=0.5, tail='round', dorsal='frill', back='#6a5a3a', side='#8e7a52', belly='#8e7a52', fin='#7a6a44', pattern='orange_dots', flat=True),
    dict(id='cod', L=26, Hh=9, peak=0.38, tail='square', dorsal='three', back='#5a5236', side='#9c9060', belly='#e8e2c4', fin='#7a7048', pattern='speckle', whiskers=1),
    dict(id='halibut', L=28, Hh=12, peak=0.45, tail='square', dorsal='frill', back='#3a3c30', side='#5e6048', belly='#5e6048', fin='#4a4c3a', pattern='speckle', flat=True),
    dict(id='tuna', L=28, Hh=10, peak=0.42, tail='crescent', dorsal='tuna', back='#1c2e5a', side='#8a9ab8', belly='#e8ecf2', fin='#e8c030', pattern='finlets'),
    dict(id='sturgeon', L=30, Hh=6, peak=0.4, tail='shark', dorsal='rear', back='#4a4a44', side='#8a8a7e', belly='#dcd8c8', fin='#6a6a60', pattern='plates', whiskers=2, head='snout'),
]


def profile(t, peak):
    """Полувысота тела по длине (0 — нос, 1 — корень хвоста)."""
    if t < peak:
        k = t / peak
        return 0.28 + 0.72 * math.sin(k * math.pi / 2) ** 0.8
    k = (t - peak) / (1 - peak)
    return 1 - 0.72 * k ** 1.3


def draw_fish(sp):
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    px = im.load()
    back, side, belly, fin = (hexc(sp[k]) for k in ('back', 'side', 'belly', 'fin'))
    L, Hh = sp['L'], sp['Hh']
    # Рыба вместе с хвостом (5 точек) и усами — по центру клетки.
    x0 = 6 + (32 - L) // 2 if sp['tail'] != 'eel' else 4 + (34 - L) // 2
    x1 = x0 + L
    cy = 8 if not sp.get('flat') else 8
    body = set()
    top_of = {}
    bot_of = {}
    for x in range(x0, x1):
        t = (x - x0) / (L - 1)
        h = profile(1 - t, sp['peak']) * Hh / 2  # нос справа
        if sp['tail'] == 'eel':
            h = max(1.2, Hh / 2 * (0.55 + 0.45 * math.sin(min(1, (1 - t) * 3) * math.pi / 2)))
        if sp.get('head') == 'long' and t > 0.82:
            h *= 0.8
        if sp.get('head') == 'snout' and t > 0.88:
            h *= 0.55
        top = cy - h * 1.05
        bot = cy + h * 0.92
        if sp.get('head') == 'flat' and t > 0.7:
            top += 0.6
        top_of[x] = math.ceil(top)
        bot_of[x] = math.floor(bot)
        for y in range(math.ceil(top), math.floor(bot) + 1):
            if 0 <= y < H:
                body.add((x, y))
    # Хвост — слева.
    tx = x0 - 1
    th = max(3, int(Hh * 0.55))
    tail = set()
    kind = sp['tail']
    for i in range(1, 6 if kind != 'eel' else 0):
        x = tx - i + 1
        if x < 0:
            break
        spread = i * (0.9 if kind in ('fork', 'crescent', 'veil') else 0.6) + 1
        if kind == 'veil':
            spread = i * 1.05 + 1.2
        for y in range(int(cy - spread), int(cy + spread) + 1):
            if not (0 <= y < H):
                continue
            d = abs(y - cy)
            if kind in ('fork', 'crescent') and i >= 3 and d < i - 2.2:
                continue
            if kind == 'crescent' and i >= 2 and d < i * 0.9 - 0.5:
                continue
            if kind == 'square' and i > 4:
                continue
            if kind == 'shark' and y < cy - 0.5 and d > i * 1.3:
                continue
            if kind == 'shark' and y > cy and d > i * 0.6:
                continue
            tail.add((x, y))
    if kind == 'eel':
        tail = set()
    # Плавники.
    fins = set()
    dorsal = sp['dorsal']
    span = {
        'long': (0.25, 0.7, 2), 'mid': (0.4, 0.62, 2), 'spiny': (0.3, 0.72, 2), 'round': (0.35, 0.55, 2),
        'rear': (0.12, 0.3, 2), 'tiny': (0.45, 0.52, 1), 'tall': (0.4, 0.55, 3), 'long2': (0.1, 0.55, 1),
        'eel': (0.05, 0.75, 1), 'flag': (0.3, 0.7, 3), 'frill': (0.05, 0.9, 1), 'three': (0.15, 0.7, 2),
        'tuna': (0.35, 0.55, 3),
    }[dorsal]
    for x in range(x0, x1):
        t = 1 - (x - x0) / (L - 1)
        if span[0] <= t <= span[1]:
            hgt = span[2]
            if dorsal == 'spiny' and (x % 2):
                hgt += 1
            if dorsal == 'three' and int((t - 0.15) / 0.18) % 2:
                continue
            if dorsal == 'tall':
                hgt = int(1 + 3 * math.sin((t - span[0]) / (span[1] - span[0]) * math.pi))
            if dorsal == 'flag':
                hgt = int(1 + 3 * (t - span[0]) / (span[1] - span[0]) + 0.5)
            for k in range(1, hgt + 1):
                fins.add((x, top_of[x] - k))
    # Брюшные и анальный: снизу.
    for x in range(x0, x1):
        t = 1 - (x - x0) / (L - 1)
        if 0.18 <= t <= 0.3 or (0.45 <= t <= 0.52 and not sp.get('flat')):
            fins.add((x, bot_of[x] + 1))
        if sp.get('flat') and 0.05 <= t <= 0.9:
            fins.add((x, bot_of[x] + 1))
        if sp['pattern'] == 'finlets' and 0.1 <= t <= 0.3 and x % 2 == 0:
            fins.add((x, top_of[x] - 1))
            fins.add((x, bot_of[x] + 1))

    # Раскраска тела.
    for (x, y) in body:
        tt, bb = top_of[x], bot_of[x]
        k = (y - tt) / max(1, bb - tt)
        if sp.get('flat'):
            c = mix(back, side, min(1, k * 1.4))
        elif k < 0.3:
            c = mix(back, side, k / 0.3 * 0.7)
        elif k < 0.62:
            c = mix(side, mix(side, belly, 0.3), (k - 0.3) / 0.32)
        else:
            c = mix(side, belly, min(1, (k - 0.5) / 0.4))
        t = 1 - (x - x0) / (L - 1)
        pat = sp['pattern']
        if pat == 'scales' and (x + y) % 2 == 0 and 0.25 < k < 0.8:
            c = mix(c, (255, 255, 255), 0.12)
        if pat == 'bigscales' and ((x // 2) + (y // 2)) % 2 == 0 and 0.2 < k < 0.8:
            c = mix(c, back, 0.22)
        if pat == 'bars' and k < 0.75 and int((t - 0.2) / 0.11) % 2 == 0 and 0.2 < t < 0.85:
            c = mix(c, (20, 30, 12), 0.55)
        if pat == 'bars_soft' and k < 0.6 and int((t - 0.2) / 0.1) % 2 == 0 and 0.2 < t < 0.85:
            c = mix(c, back, 0.45)
        if pat == 'dots_light' and 0.15 < k < 0.7 and (x * 7 + y * 13) % 11 == 0:
            c = mix(c, (240, 236, 190), 0.7)
        if pat == 'dots_dark' and 0.1 < k < 0.6 and (x * 5 + y * 11) % 9 == 0:
            c = mix(c, (20, 18, 16), 0.7)
        if pat == 'x_dark' and 0.1 < k < 0.65 and (x * 3 + y * 7) % 8 == 0:
            c = mix(c, (30, 20, 16), 0.75)
        if pat == 'trout':
            if 0.42 < k < 0.58 and 0.15 < t < 0.85:
                c = mix(c, (230, 110, 130), 0.55)
            if k < 0.45 and (x * 5 + y * 3) % 7 == 0:
                c = mix(c, (20, 20, 20), 0.75)
        if pat == 'marble' and ((x * 13 + y * 7) % 5 in (0, 1)) and k < 0.7:
            c = mix(c, back, 0.5)
        if pat == 'speckle' and (x * 11 + y * 5) % 6 == 0 and k < 0.85:
            c = mix(c, (40, 34, 20), 0.5)
        if pat == 'orange_dots' and (x * 7 + y * 5) % 9 == 0:
            c = (226, 118, 40)
        if pat == 'waves' and k < 0.4 and ((x + int(2 * math.sin(y))) % 4 == 0):
            c = mix(c, (10, 30, 40), 0.6)
        if pat == 'plates' and (y == tt + 1 or abs(k - 0.55) < 0.12) and x % 3 == 0:
            c = mix(c, (230, 226, 210), 0.7)
        if pat == 'shine' and k < 0.4 and x % 3 == 0:
            c = mix(c, (255, 240, 180), 0.35)
        if pat == 'finlets' and 0.55 < k < 0.65 and 0.3 < t < 0.85:
            c = mix(c, (190, 200, 220), 0.5)
        px[x, y] = c + (255,)
    for (x, y) in tail | fins:
        if (x, y) in body or not (0 <= x < W and 0 <= y < H):
            continue
        c = fin
        if sp.get('fin_edge') and (x, y) in fins and (x, y + 1) not in fins and (x, y - 1) not in body:
            c = hexc(sp['fin_edge'])
        px[x, y] = c + (255,)
    # Жабры и глаз.
    t_head = 0.16 if sp.get('head') != 'long' else 0.2
    gx = int(x1 - 1 - (L - 1) * t_head)
    for y in range(top_of[gx] + 2, bot_of[gx] - 1):
        if 0 <= y < H and px[gx, y][3]:
            px[gx, y] = mix(px[gx, y][:3], back, 0.55) + (255,)
    ex = int(x1 - 1 - (L - 1) * (0.08 if sp.get('head') != 'long' else 0.07))
    ey = int(round(cy - Hh * (0.18 if not sp.get('flat') else 0.3)))
    if sp.get('head') == 'big':
        ex -= 1
    eye = hexc(sp.get('eye', '#f4f0e0'))
    for (dx, dy) in ((0, 0), (1, 0), (0, 1), (1, 1)):
        if 0 <= ex + dx < W and 0 <= ey + dy < H:
            px[ex + dx, ey + dy] = eye + (255,)
    if 0 <= ex + 1 < W:
        px[ex + 1, ey + 1] = (8, 8, 10, 255)
    if sp.get('flat'):
        px[ex - 2, ey] = eye + (255,)
        px[ex - 2, ey + 1] = (8, 8, 10, 255)
    # Усы.
    for w_ in range(sp.get('whiskers', 0)):
        wy = min(H - 1, cy + 1 + w_)
        for i in range(1, 4 + 2 * w_):
            x = x1 - 2 + i // 2
            y = wy + i // 3
            if 0 <= x < W and 0 <= y < H and not px[x, y][3]:
                px[x, y] = mix(back, (0, 0, 0), 0.3) + (255,)
    # Контур снаружи.
    solid = {(x, y) for x in range(W) for y in range(H) if px[x, y][3]}
    line = mix(back, (0, 0, 0), 0.7) + (255,)
    for (x, y) in list(solid):
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            q = (x + dx, y + dy)
            if 0 <= q[0] < W and 0 <= q[1] < H and q not in solid:
                px[q[0], q[1]] = line
    return im


def draw_mussel():
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.ellipse((12, 3, 28, 13), fill=(38, 44, 64, 255), outline=(10, 12, 20, 255))
    for i, c in enumerate(((70, 86, 120), (58, 70, 100))):
        d.arc((13 + i * 2, 4 + i, 27 - i * 2, 12 - i), 200, 340, fill=c + (255,))
    d.line((14, 9, 26, 9), fill=(20, 24, 36, 255))
    d.point((17, 5), fill=(160, 180, 210, 255))
    return im


def draw_pearl():
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.ellipse((15, 3, 25, 13), fill=(236, 230, 240, 255), outline=(120, 110, 140, 255))
    d.ellipse((17, 5, 20, 8), fill=(255, 255, 255, 255))
    d.point((22, 11), fill=(200, 190, 214, 255))
    return im


def draw_float():
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    px = im.load()
    # Поплавок стоит: антенна, красный верх, белая полоса, тёмный низ.
    rows = [
        '.......O.......',
        '......OrO......',
        '......OrO......',
        '.....OrrrO.....',
        '....OrrrrrO....',
        '....OwwwwwO....',
        '....OwwwwwO....',
        '.....OkkkO.....',
        '......OkO......',
        '.......O.......',
    ]
    pal = {'O': (20, 16, 16), 'r': (228, 52, 40), 'w': (246, 244, 236), 'k': (40, 44, 52)}
    for y, r in enumerate(rows):
        for x, ch in enumerate(r):
            if ch in pal:
                px[x + 12, y + 3] = pal[ch] + (255,)
    return im


def main():
    os.makedirs(OUT, exist_ok=True)
    tiles = [draw_fish(sp) for sp in SPECIES] + [draw_mussel(), draw_pearl(), draw_float()]
    cols = 8
    rows = (len(tiles) + cols - 1) // cols
    sheet = Image.new('RGBA', (W * cols, H * rows), (0, 0, 0, 0))
    for i, t in enumerate(tiles):
        sheet.paste(t, ((i % cols) * W, (i // cols) * H))
    sheet.save(os.path.join(OUT, 'fish.png'), optimize=True)
    if os.environ.get('PREVIEW'):
        sc = 6
        pv = Image.new('RGBA', (cols * (W * sc + 8), rows * (H * sc + 18)), (40, 70, 90, 255))
        d = ImageDraw.Draw(pv)
        names = [sp['id'] for sp in SPECIES] + ['mussel', 'pearl', 'float']
        for i, t in enumerate(tiles):
            x = (i % cols) * (W * sc + 8)
            y = (i // cols) * (H * sc + 18)
            b = t.resize((W * sc, H * sc), Image.NEAREST)
            pv.paste(b, (x, y + 14), b)
            d.text((x + 2, y + 1), names[i], fill=(255, 255, 255, 255))
        pv.save(os.environ['PREVIEW'])
    print(len(tiles), 'рисунков')


if __name__ == '__main__':
    main()
