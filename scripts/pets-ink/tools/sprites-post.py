#!/usr/bin/env python3
"""sprites-post.py (Coco): cut the transparent drawings from tools/sprites.cjs into game strips.

    python3 tools/sprites-post.py [--px 200] [--pet mole] [--out ../../public/ui/pets]

For every pet:
  * the BODY BOX is the union of what idle, walk and sleep cover, made square, feet on its bottom
    edge. The game sizes a pet by this box, so every animation of a pet stands in the same place;
  * every animation is cropped to the union of its own drawings (a jump or flying dirt can leave the
    body box) and laid out as one horizontal strip of equal frames, scaled so the body box is
    --px pixels tall;
  * thumb.webp is the first idle drawing in the body box, for lists of many pets.
The manifest src/lib/pet-sprites.ts gives each strip its frame count and its rectangle in body-box
units (0..1 from the box's top-left), so a strip can overflow the box exactly where its drawing does.
"""
import json
import os
import sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, '.tmp', 'sprites')
ANIMS = ['idle', 'walk', 'happy', 'work', 'attack', 'sleep']
BODY = ['idle', 'walk', 'sleep']


def arg(name, default):
    if name in sys.argv:
        return sys.argv[sys.argv.index(name) + 1]
    return default


PX = int(arg('--px', '200'))
OUT = os.path.abspath(arg('--out', os.path.join(ROOT, '..', '..', 'public', 'ui', 'pets')))
MANIFEST = os.path.abspath(os.path.join(ROOT, '..', '..', 'src', 'lib', 'pet-sprites.ts'))
ONLY = arg('--pet', None)
QUALITY = int(arg('--q', '84'))


def union(boxes):
    boxes = [b for b in boxes if b]
    return (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))


def alpha_box(im):
    a = im.split()[3].point(lambda v: 255 if v > 10 else 0)
    return a.getbbox()


def cut(pet):
    d = os.path.join(SRC, pet)
    frames = {}
    for a in ANIMS:
        fs = sorted(f for f in os.listdir(d) if f.startswith(a + '-') and f.endswith('.png'))
        frames[a] = [Image.open(os.path.join(d, f)).convert('RGBA') for f in fs]
    boxes = {a: union([alpha_box(im) for im in frames[a]]) for a in ANIMS if frames[a]}
    bx0, by0, bx1, by1 = union([boxes[a] for a in BODY])
    side = max(bx1 - bx0, by1 - by0) + 8
    cx = (bx0 + bx1) / 2
    B = (cx - side / 2, by1 + 4 - side, side)  # x, y, side (source px)
    k = PX / side
    os.makedirs(os.path.join(OUT, pet), exist_ok=True)
    fps = json.load(open(os.path.join(SRC, 'anims.json')))
    man = {'anims': {}}
    total = 0
    for a in ANIMS:
        if not frames[a]:
            continue
        x0, y0, x1, y1 = boxes[a]
        x0, y0 = int(x0) - 2, int(y0) - 2
        x1, y1 = int(x1) + 2, int(y1) + 2
        w, h = max(1, round((x1 - x0) * k)), max(1, round((y1 - y0) * k))
        strip = Image.new('RGBA', (w * len(frames[a]), h), (0, 0, 0, 0))
        for i, im in enumerate(frames[a]):
            fr = im.crop((x0, y0, x1, y1)).resize((w, h), Image.LANCZOS)
            strip.paste(fr, (i * w, 0))
        f = os.path.join(OUT, pet, a + '.webp')
        strip.save(f, 'WEBP', quality=QUALITY, method=6)
        total += os.path.getsize(f)
        man['anims'][a] = {
            'n': len(frames[a]),
            'fps': fps[a]['fps'],
            'x': round((x0 - B[0]) / B[2], 4),
            'y': round((y0 - B[1]) / B[2], 4),
            'w': round((x1 - x0) / B[2], 4),
            'h': round((y1 - y0) / B[2], 4),
        }
    th = frames['idle'][0].crop((round(B[0]), round(B[1]), round(B[0] + B[2]), round(B[1] + B[2]))).resize((128, 128), Image.LANCZOS)
    f = os.path.join(OUT, pet, 'thumb.webp')
    th.save(f, 'WEBP', quality=QUALITY, method=6)
    total += os.path.getsize(f)
    print(f'{pet}: {total / 1024:.0f} KB')
    return man


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
    for p in pets:
        old[p] = cut(p)
    body = json.dumps(old, ensure_ascii=False, indent=2, sort_keys=True)
    with open(MANIFEST, 'w', encoding='utf-8') as fh:
        fh.write('// Сгенерировано scripts/pets-ink/tools/sprites-post.py — руками не править.\n')
        fh.write('// Полосы кадров питомцев: число рисунков и прямоугольник полосы в долях рамки тела.\n')
        fh.write('export interface PetStrip {\n  n: number;\n  fps: number;\n  x: number;\n  y: number;\n  w: number;\n  h: number;\n}\n\n')
        fh.write('export const PET_SPRITES: Record<string, { anims: Record<string, PetStrip> }> = ')
        fh.write(body)
        fh.write(';\n')


main()
