#!/usr/bin/env python3
"""props-post.py (Coco): cut the ink chests and eggs from tools/props.cjs into the game's files.

    python3 tools/props-post.py

Reads .tmp/props (1024 px drawings), gives each the same light halo as the pet sprites (the ink is
dark, the game's panels are dark) and writes
  public/ui/chests/{common,rare,epic,legend}-{closed,open}.webp, mystery-closed.webp  512 px
  public/ui/chests/mystery-spin.webp   16 frames of 320 px in a row (frame 0 = mystery-closed)
  public/ui/eggs/{moss,stone,crystal,dragon}.webp                                     512 px
The chest camera is the old 3D render's, so the keyhole stays at 38.5% · 61.7% of the square.
"""
import os

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, '.tmp', 'props')
PUB = os.path.abspath(os.path.join(ROOT, '..', '..', 'public', 'ui'))
HALO = (255, 246, 228)
HALO_A = 0.94


def with_halo(im, r):
    a = np.asarray(im.split()[3]) > 40
    thick = ndimage.binary_opening(a, structure=np.ones((5, 5), bool))
    if not thick.any():
        return im
    dist = ndimage.distance_transform_edt(~thick)
    h = np.clip(r - dist + 0.5, 0, 1) * HALO_A
    layer = np.zeros(a.shape + (4,), np.uint8)
    layer[..., 0], layer[..., 1], layer[..., 2] = HALO
    layer[..., 3] = (h * 255).astype(np.uint8)
    return Image.alpha_composite(Image.fromarray(layer, 'RGBA'), im)


def cut(name, px, r=7):
    im = Image.open(os.path.join(SRC, name + '.png')).convert('RGBA')
    return with_halo(im, r).resize((px, px), Image.LANCZOS)


def main():
    os.makedirs(os.path.join(PUB, 'chests'), exist_ok=True)
    os.makedirs(os.path.join(PUB, 'eggs'), exist_ok=True)
    for tier in ['common', 'rare', 'epic', 'legend']:
        for state in ['closed', 'open']:
            cut(f'{tier}-{state}', 512).save(os.path.join(PUB, 'chests', f'{tier}-{state}.webp'), 'WEBP', quality=86, method=4)
    cut('mystery-closed', 512).save(os.path.join(PUB, 'chests', 'mystery-closed.webp'), 'WEBP', quality=86, method=4)
    FR = 320
    strip = Image.new('RGBA', (FR * 16, FR), (0, 0, 0, 0))
    for f in range(16):
        strip.paste(cut(f'mystery-spin-{f:02d}', FR, 9), (f * FR, 0))
    strip.save(os.path.join(PUB, 'chests', 'mystery-spin.webp'), 'WEBP', quality=84, method=4)
    for kind in ['moss', 'stone', 'crystal', 'dragon']:
        cut(f'eggs/{kind}', 512).save(os.path.join(PUB, 'eggs', f'{kind}.webp'), 'WEBP', quality=86, method=4)
    total = sum(os.path.getsize(os.path.join(PUB, d, f)) for d in ['chests', 'eggs'] for f in os.listdir(os.path.join(PUB, d)))
    print(f'chests and eggs -> {PUB} ({total // 1024} KB)')


if __name__ == '__main__':
    main()
