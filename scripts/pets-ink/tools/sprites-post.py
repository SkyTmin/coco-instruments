#!/usr/bin/env python3
"""sprites-post.py (Coco): cut the transparent drawings from tools/sprites.cjs into game strips.

    python3 tools/sprites-post.py [--px 168] [--pxl 360] [--pet mole] [--out ../../public/ui/pets]

Needs Pillow, numpy and scipy (pip install pillow numpy scipy).

For every pet:
  * the BODY BOX is the union of what idle, walk and sleep cover, made square, feet on its bottom
    edge. The game sizes a pet by this box, so every animation of a pet stands in the same place;
  * every drawing gets a light HALO round its silhouette: the ink is dark, the game's panels are
    dark, and a raven or a spider would melt into them. The halo is traced at the source size
    after an opening that drops thin lines, so the body and legs get a sticker edge but a web,
    a burst ring or speed lines stay thin;
  * every animation is cropped to the union of its own drawings (a jump or flying dirt can leave the
    body box) and laid out as one horizontal strip of equal frames, scaled so the body box is
    --px pixels tall (<anim>.webp). The animations listed in LARGE are cut again at --pxl for the
    pet's card and the hatching scene (<anim>-l.webp);
  * thumb.webp is the first idle drawing in the body box, for lists of many pets.
The manifest src/lib/pet-sprites.ts gives each strip its frame count and its rectangle in body-box
units (0..1 from the box's top-left), so a strip can overflow the box exactly where its drawing does.
"""
import hashlib
import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, '.tmp', 'sprites')
ANIMS = ['idle', 'walk', 'happy', 'work', 'attack', 'sleep']
BODY = ['idle', 'walk', 'sleep']
LARGE = ['idle', 'happy', 'work']


def arg(name, default):
    if name in sys.argv:
        return sys.argv[sys.argv.index(name) + 1]
    return default


PX = int(arg('--px', '168'))
PXL = int(arg('--pxl', '360'))
OUT = os.path.abspath(arg('--out', os.path.join(ROOT, '..', '..', 'public', 'ui', 'pets')))
MANIFEST = os.path.abspath(os.path.join(ROOT, '..', '..', 'src', 'lib', 'pet-sprites.ts'))
ONLY = arg('--pet', None)
QUALITY = int(arg('--q', '82'))
QL = int(arg('--ql', '74'))
# halo: its width in pixels of the small strip, colour and opacity
HALO_PX = float(arg('--halo', '2.4'))
HALO = (255, 246, 228)
HALO_A = 0.94


def union(boxes):
    boxes = [b for b in boxes if b]
    return (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))


def alpha_box(im):
    a = im.split()[3].point(lambda v: 255 if v > 10 else 0)
    return a.getbbox()


def with_halo(im, r):
    """The drawing over a light halo r source pixels wide round its thick parts."""
    a = np.asarray(im.split()[3]) > 40
    # the opening drops everything thinner than about 5 px at the source size
    thick = ndimage.binary_opening(a, structure=np.ones((5, 5), bool))
    if not thick.any():
        return im
    dist = ndimage.distance_transform_edt(~thick)
    h = np.clip(r - dist + 0.5, 0, 1) * HALO_A
    layer = np.zeros(a.shape + (4,), np.uint8)
    layer[..., 0], layer[..., 1], layer[..., 2] = HALO
    layer[..., 3] = (h * 255).astype(np.uint8)
    out = Image.fromarray(layer, 'RGBA')
    out.alpha_composite(im)
    return out


def strip(frames, box, k, path, q=None):
    x0, y0, x1, y1 = box
    w, h = max(1, round((x1 - x0) * k)), max(1, round((y1 - y0) * k))
    img = Image.new('RGBA', (w * len(frames), h), (0, 0, 0, 0))
    for i, im in enumerate(frames):
        img.paste(im.crop((x0, y0, x1, y1)).resize((w, h), Image.LANCZOS), (i * w, 0))
    img.save(path, 'WEBP', quality=q or QUALITY, method=4)
    return os.path.getsize(path)


def cut(pet):
    d = os.path.join(SRC, pet)
    frames = {}
    for a in ANIMS:
        fs = sorted(f for f in os.listdir(d) if f.startswith(a + '-') and f.endswith('.png'))
        frames[a] = [Image.open(os.path.join(d, f)).convert('RGBA') for f in fs]
    bx0, by0, bx1, by1 = union([alpha_box(im) for a in BODY for im in frames[a]])
    side = max(bx1 - bx0, by1 - by0) + 8
    cx = (bx0 + bx1) / 2
    B = (cx - side / 2, by1 + 4 - side, side)  # x, y, side (source px)
    k = PX / side
    r = HALO_PX / k
    pad = int(r) + 3
    frames = {a: [with_halo(im, r) for im in frames[a]] for a in ANIMS if frames[a]}
    boxes = {a: union([alpha_box(im) for im in frames[a]]) for a in frames}
    os.makedirs(os.path.join(OUT, pet), exist_ok=True)
    fps = json.load(open(os.path.join(SRC, 'anims.json')))
    man = {'anims': {}}
    total = {'s': 0, 'l': 0}
    for a in ANIMS:
        if a not in frames:
            continue
        x0, y0, x1, y1 = boxes[a]
        box = (int(x0) - pad, int(y0) - pad, int(x1) + pad, int(y1) + pad)
        total['s'] += strip(frames[a], box, k, os.path.join(OUT, pet, a + '.webp'))
        if a in LARGE:
            total['l'] += strip(frames[a], box, PXL / side, os.path.join(OUT, pet, a + '-l.webp'), QL)
        man['anims'][a] = {
            'n': len(frames[a]),
            'fps': fps[a]['fps'],
            'x': round((box[0] - B[0]) / B[2], 4),
            'y': round((box[1] - B[1]) / B[2], 4),
            'w': round((box[2] - box[0]) / B[2], 4),
            'h': round((box[3] - box[1]) / B[2], 4),
        }
    th = frames['idle'][0].crop((round(B[0]), round(B[1]), round(B[0] + B[2]), round(B[1] + B[2]))).resize((128, 128), Image.LANCZOS)
    f = os.path.join(OUT, pet, 'thumb.webp')
    th.save(f, 'WEBP', quality=QUALITY, method=4)
    total['s'] += os.path.getsize(f)
    print(f'{pet}: {total["s"] / 1024:.0f} KB + large {total["l"] / 1024:.0f} KB')
    return man, total


def main():
    pets = sorted(p for p in os.listdir(SRC) if os.path.isdir(os.path.join(SRC, p)))
    if ONLY:
        pets = [ONLY]
    old = {}
    if os.path.exists(MANIFEST):
        txt = open(MANIFEST, encoding='utf-8').read()
        start = txt.find('= {')
        if start >= 0:
            try:
                old = json.loads(txt[start + 2: txt.rindex('}') + 1])
            except ValueError:
                old = {}
    grand = {'s': 0, 'l': 0}
    for p in pets:
        old[p], t = cut(p)
        grand['s'] += t['s']
        grand['l'] += t['l']
    print(f'total: {grand["s"] / 1024:.0f} KB small + {grand["l"] / 1024:.0f} KB large')
    # the revision of everything under OUT: the game asks ?v=<rev>, so a redrawn pet is not
    # served from the service worker's cache
    h = hashlib.sha1()
    for dp, _, fs in sorted(os.walk(OUT)):
        for f in sorted(fs):
            h.update(f.encode())
            h.update(open(os.path.join(dp, f), 'rb').read())
    rev = h.hexdigest()[:10]
    body = json.dumps(old, ensure_ascii=False, indent=2, sort_keys=True)
    with open(MANIFEST, 'w', encoding='utf-8') as fh:
        fh.write('// Сгенерировано scripts/pets-ink/tools/sprites-post.py — руками не править.\n')
        fh.write('// Полосы кадров питомцев: число рисунков и прямоугольник полосы в долях рамки тела.\n')
        fh.write('// Крупные полосы (`<anim>-l.webp`) — у анимаций из PET_LARGE.\n')
        fh.write('export interface PetStrip {\n  n: number;\n  fps: number;\n  x: number;\n  y: number;\n  w: number;\n  h: number;\n}\n\n')
        fh.write(f'export const PET_LARGE = {json.dumps(LARGE)} as const;\n\n')
        fh.write(f"export const PET_REV = '{rev}';\n\n")
        fh.write('export const PET_SPRITES: Record<string, { anims: Record<string, PetStrip> }> = ')
        fh.write(body)
        fh.write(';\n')


main()
