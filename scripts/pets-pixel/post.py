#!/usr/bin/env python3
"""post.py (Coco): pixel pets — raw frames from bake.ts → game strips.

    python3 scripts/pets-pixel/post.py [--pet phoenix] [--sheet DIR] [--no-game]

Normally run by bake.ts (npx vite-node scripts/pets-pixel/bake.ts). Needs Pillow and numpy.

For every pixel pet in scripts/pets-pixel/.tmp/<id>/:
  * every animation is cropped to the union of its own frames (+1 empty pixel round it, so a
    nearest-neighbour sample at a frame's edge never picks the neighbour frame) and laid out as one
    horizontal strip of equal frames at the NATIVE size: lossless WebP, public/ui/pets/<id>/<anim>.webp;
  * thumb.webp — the first idle frame inside the body box (box × box), for lists;
  * the pet's folder is emptied first: the ink strips of a pet that went pixel do not linger;
  * src/lib/pet-pixel-sprites.ts gets the pet's strips in ART PIXELS relative to the body box's
    top-left corner and the pet's own revision (sha1 of its files): the game asks ?v=<rev>, so a
    redrawn pet is never served from the service worker's cache;
  * scripts/pets-pixel/pets.json lists the pixel pets — the ink pipeline skips them.
--sheet DIR writes a review sheet per animation (frames ×4, dark and light ground, frame numbers).
--no-game writes only the sheets.
"""
import hashlib
import json
import os
import re
import sys

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
TMP = os.path.join(HERE, '.tmp')
OUT = os.path.join(ROOT, 'public', 'ui', 'pets')
MANIFEST = os.path.join(ROOT, 'src', 'lib', 'pet-pixel-sprites.ts')
LIST = os.path.join(HERE, 'pets.json')
ORDER = ['idle', 'walk', 'happy', 'work', 'attack', 'sleep']


def arg(name, default=None):
    if name in sys.argv:
        return sys.argv[sys.argv.index(name) + 1]
    return default


ONLY = arg('--pet')
SHEET = arg('--sheet')
GAME = '--no-game' not in sys.argv


def load(pid):
    d = os.path.join(TMP, pid)
    meta = json.load(open(os.path.join(d, 'meta.json')))
    frames = {}
    for a, m in meta['anims'].items():
        raw = np.fromfile(os.path.join(d, a + '.rgba'), dtype=np.uint8)
        frames[a] = raw.reshape(m['n'], meta['ch'], meta['cw'], 4)
    return meta, frames


def bbox(fr):
    a = fr[..., 3].max(axis=0) > 0
    ys, xs = np.nonzero(a)
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def save_webp(img, path):
    img.save(path, 'WEBP', lossless=True, quality=100, method=6, exact=True)
    return os.path.getsize(path)


def sheet(pid, a, fr, meta, box):
    x0, y0, x1, y1 = box
    k = 4
    n = len(fr)
    cols = 12
    w, h = (x1 - x0) * k, (y1 - y0) * k
    rows = (n + cols - 1) // cols
    img = Image.new('RGB', (cols * (w + 4) * 2 + 8, rows * (h + 16) + 20), (24, 22, 30))
    dr = ImageDraw.Draw(img)
    dr.text((4, 4), f'{pid} {a}: {n} frames @ {meta["anims"][a]["fps"]} fps', fill=(230, 220, 200))
    for i in range(n):
        im = Image.fromarray(fr[i][y0:y1, x0:x1], 'RGBA').resize((w, h), Image.NEAREST)
        r, c = divmod(i, cols)
        for half, bg in ((0, (34, 28, 36)), (1, (226, 206, 168))):
            ox = half * (cols * (w + 4) + 8) + c * (w + 4)
            oy = 20 + r * (h + 16)
            tile = Image.new('RGBA', (w, h), bg + (255,))
            # body box frame
            tile.alpha_composite(im)
            img.paste(tile.convert('RGB'), (ox, oy))
            bx, by = (meta['bx'] - x0) * k, (meta['by'] - y0) * k
            dr.rectangle([ox + bx, oy + by, ox + bx + meta['box'] * k - 1, oy + by + meta['box'] * k - 1],
                         outline=(90, 90, 120))
            dr.text((ox + 2, oy + h + 2), str(i), fill=(200, 190, 170) if not half else (90, 70, 50))
    os.makedirs(SHEET, exist_ok=True)
    img.save(os.path.join(SHEET, f'{pid}-{a}.png'))


def cut(pid):
    meta, frames = load(pid)
    B = meta['box']
    bx, by = meta['bx'], meta['by']
    out_dir = os.path.join(OUT, pid)
    man = {'box': B, 'anims': {}}
    sizes = {}
    if GAME:
        os.makedirs(out_dir, exist_ok=True)
        for f in os.listdir(out_dir):
            os.remove(os.path.join(out_dir, f))
    for a in ORDER:
        if a not in frames:
            continue
        fr = frames[a]
        x0, y0, x1, y1 = bbox(fr)
        x0, y0, x1, y1 = x0 - 1, y0 - 1, x1 + 1, y1 + 1
        if x0 < 0 or y0 < 0 or x1 > meta['cw'] or y1 > meta['ch']:
            raise SystemExit(f'{pid}/{a}: рисунок упёрся в край холста {x0, y0, x1, y1}')
        if SHEET:
            sheet(pid, a, fr, meta, (x0, y0, x1, y1))
        if not GAME:
            continue
        w, h = x1 - x0, y1 - y0
        n = len(fr)
        strip = np.zeros((h, w * n, 4), np.uint8)
        for i in range(n):
            strip[:, i * w:(i + 1) * w] = fr[i][y0:y1, x0:x1]
        sizes[a] = save_webp(Image.fromarray(strip, 'RGBA'), os.path.join(out_dir, a + '.webp'))
        man['anims'][a] = {'n': n, 'fps': meta['anims'][a]['fps'], 'x': x0 - bx, 'y': y0 - by, 'w': w, 'h': h}
    if not GAME:
        return None, 0
    idle = frames['idle']
    # Значок — кадр 0 покоя в рамке тела: обрезанный хохолок или крыло на нём
    # мелькнёт, пока грузится полоса. Искры над рамкой — можно, они не в значке.
    ix0, iy0, ix1, iy1 = bbox(idle[:1])
    if ix0 < bx or iy0 < by or ix1 > bx + B or iy1 > by + B:
        print(f'  ! {pid}: кадр 0 покоя вылезает из рамки тела {ix0 - bx, iy0 - by, ix1 - bx, iy1 - by} при {B}')
    th = Image.fromarray(idle[0][by:by + B, bx:bx + B], 'RGBA')
    sizes['thumb'] = save_webp(th, os.path.join(out_dir, 'thumb.webp'))
    h = hashlib.sha1()
    for f in sorted(os.listdir(out_dir)):
        h.update(f.encode())
        h.update(open(os.path.join(out_dir, f), 'rb').read())
    man['rev'] = h.hexdigest()[:10]
    tot = sum(sizes.values())
    print(f'{pid}: ' + ', '.join(f'{k} {v / 1024:.1f}' for k, v in sizes.items()) + f' КБ; всего {tot / 1024:.0f} КБ')
    return man, tot


def read_manifest():
    if not os.path.exists(MANIFEST):
        return {}
    txt = open(MANIFEST, encoding='utf-8').read()
    start = txt.find('= {')
    if start < 0:
        return {}
    # Объект в стиле prettier → JSON: ключи в кавычки, кавычки двойные, без висячих запятых.
    obj = txt[start + 2: txt.rindex('}') + 1].replace("'", '"')
    obj = re.sub(r'([{,]\s*)([A-Za-z_$][\w$]*)\s*:', r'\1"\2":', obj)
    obj = re.sub(r',(\s*[}\]])', r'\1', obj)
    return json.loads(obj)


def main():
    pets = sorted(p for p in os.listdir(TMP) if os.path.isdir(os.path.join(TMP, p)))
    if ONLY:
        pets = [ONLY]
    old = read_manifest()
    for p in pets:
        man, _ = cut(p)
        if man:
            old[p] = man
    if not GAME:
        return
    # Манифест пишется сразу в стиле prettier (одинарные кавычки, ключи без
    # кавычек, запятые в конце, строка на полосу): `prettier --check` зелёный
    # без прогона, а read_manifest читает его обратно.
    rows = []
    for pid in sorted(old):
        m = old[pid]
        rows += [f'  {pid}: {{', f"    box: {m['box']},", f"    rev: '{m['rev']}',", '    anims: {']
        for a in sorted(m['anims'], key=lambda a: ORDER.index(a) if a in ORDER else 99):
            s = m['anims'][a]
            rows.append(f'      {a}: {{ ' + ', '.join(f'{k}: {s[k]}' for k in ('n', 'fps', 'x', 'y', 'w', 'h')) + ' },')
        rows += ['    },', '  },']
    body = '{\n' + '\n'.join(rows) + '\n}'
    with open(MANIFEST, 'w', encoding='utf-8') as fh:
        fh.write('// Сгенерировано scripts/pets-pixel/post.py — руками не править.\n')
        fh.write('// Пиксельные питомцы: полосы кадров в пикселях рисунка от левого верхнего угла рамки\n')
        fh.write('// тела (`box` × `box`), своя метка `rev` в адресе у каждого питомца.\n')
        fh.write('export interface PetPxStrip {\n  n: number;\n  fps: number;\n  x: number;\n  y: number;\n  w: number;\n  h: number;\n}\n\n')
        fh.write('export interface PetPx {\n  box: number;\n  rev: string;\n  anims: Record<string, PetPxStrip>;\n}\n\n')
        fh.write('export const PET_PX: Record<string, PetPx> = ')
        fh.write(body)
        fh.write(';\n')
    with open(LIST, 'w', encoding='utf-8') as fh:
        fh.write(json.dumps(sorted(old.keys())) + '\n')


main()
