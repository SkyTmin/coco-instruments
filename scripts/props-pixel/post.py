#!/usr/bin/env python3
"""post.py (Coco): pixel props — raw frames from bake.ts → game strips + manifest.

    python3 scripts/props-pixel/post.py --set eggs [--only a,b] [--sheet DIR] [--keys 12] [--no-game]

Normally run by bake.ts (npx vite-node scripts/props-pixel/bake.ts -- --set eggs). Needs Pillow, numpy.

For every strip of the set in scripts/props-pixel/.tmp/<set>/<res>/<name>.rgba (res s — small, l — large):
  * the frames are cropped to the union of the strip's own frames (+1 empty pixel round it, so a
    nearest-neighbour sample at a frame's edge never picks the neighbour frame) and laid out as a
    grid of equal frames (one row while it fits 16000 px — WebP is at most 16383 wide) at the
    NATIVE size: lossless WebP public/ui/px/<set>/<name>.webp (large: <name>-l.webp);
  * src/lib/props-pixel/sprites-<set>.ts gets per strip: n, fps, loop, rev (sha1 of both files —
    the game asks ?v=<rev>), marks, anchors (in % of the box) and the rect of each size in ART
    PIXELS from the top-left corner of that size's box (`s`, `l`), plus `cols`;
  * scripts/props-pixel/<set>.json keeps the same manifest + byte sizes (read back by --only runs).
A full run (no --only) deletes strips of the set that are no longer drawn.
--sheet DIR writes a key-frame sheet per strip and size (≤ 800 px wide: marks + evenly spaced
frames, --keys N of them, default 12; frame number and mark names under each tile).
--no-game writes only the sheets.
"""
import hashlib
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
MAX_W = 16000


def arg(name, default=None):
    if name in sys.argv:
        return sys.argv[sys.argv.index(name) + 1]
    return default


SET = arg('--set')
if not SET:
    raise SystemExit('нужно --set <набор>')
ONLY = arg('--only')
ONLY = ONLY.split(',') if ONLY else None
SHEET = arg('--sheet')
KEYS = int(arg('--keys', '12'))
GAME = '--no-game' not in sys.argv
TMP = os.path.join(HERE, '.tmp', SET)
OUT = os.path.join(ROOT, 'public', 'ui', 'px', SET)
MANIFEST = os.path.join(ROOT, 'src', 'lib', 'props-pixel', f'sprites-{SET}.ts')
JSON = os.path.join(HERE, f'{SET}.json')


def load_meta(res):
    p = os.path.join(TMP, res, 'meta.json')
    return json.load(open(p)) if os.path.exists(p) else None


def load_frames(res, meta, name):
    p = os.path.join(TMP, res, name + '.rgba')
    if not os.path.exists(p):
        return None
    n = meta['strips'][name]['frames']
    return np.fromfile(p, dtype=np.uint8).reshape(n, meta['ch'], meta['cw'], 4)


def bbox(fr):
    a = fr[..., 3].max(axis=0) > 0
    ys, xs = np.nonzero(a)
    if not len(xs):
        return 0, 0, 1, 1
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def save_webp(img, path):
    img.save(path, 'WEBP', lossless=True, quality=100, method=6, exact=True)
    return os.path.getsize(path)


def key_frames(n, marks):
    ks = {0, n - 1, *[i for i in marks.values() if 0 <= i < n]}
    rest = max(0, KEYS - len(ks))
    for j in range(1, rest + 1):
        ks.add(round(j * (n - 1) / (rest + 1)))
    return sorted(ks)


def sheet(name, res, fr, box, meta, marks):
    x0, y0, x1, y1 = box
    w0, h0 = x1 - x0, y1 - y0
    k = max(1, min(4 if res == 's' else 2, 380 // max(w0, 1)))
    w, h = w0 * k, h0 * k
    ks = key_frames(len(fr), marks)
    cols = max(1, min(len(ks), 796 // (w + 4)))
    rows = (len(ks) + cols - 1) // cols
    img = Image.new('RGB', (cols * (w + 4) + 4, rows * (h + 14) + 18), (22, 20, 28))
    dr = ImageDraw.Draw(img)
    fps = meta['strips'][name]['fps']
    dr.text((4, 3), f'{SET}/{name} [{res}] {len(fr)} fr @ {fps} fps', fill=(230, 220, 200))
    inv = {}
    for m, i in marks.items():
        inv.setdefault(i, []).append(m)
    for j, i in enumerate(ks):
        r, c = divmod(j, cols)
        ox, oy = 4 + c * (w + 4), 18 + r * (h + 14)
        tile = Image.new('RGBA', (w, h), (40, 34, 46, 255))
        im = Image.fromarray(fr[i][y0:y1, x0:x1], 'RGBA').resize((w, h), Image.NEAREST)
        tile.alpha_composite(im)
        img.paste(tile.convert('RGB'), (ox, oy))
        bx, by = (meta['bx'] - x0) * k, (meta['by'] - y0) * k
        dr.rectangle([ox + bx, oy + by, ox + bx + meta['box'] * k - 1, oy + by + meta['box'] * k - 1],
                     outline=(70, 70, 96))
        dr.text((ox + 1, oy + h + 1), f'{i} ' + ','.join(inv.get(i, [])), fill=(200, 190, 170))
    os.makedirs(SHEET, exist_ok=True)
    img.save(os.path.join(SHEET, f'{SET}-{name}-{res}.png'))


def cut(name, metas, man_old):
    """Both sizes of one strip → files + the manifest entry."""
    entry = None
    files = []
    sizes = {}
    for res in ('s', 'l'):
        meta = metas.get(res)
        if not meta:
            continue
        fr = load_frames(res, meta, name)
        if fr is None:
            continue
        d = meta['strips'][name]
        n = d['frames']
        marks = d.get('marks') or {}
        for m, i in marks.items():
            if not 0 <= i < n:
                raise SystemExit(f'{SET}/{name}: метка {m} = {i} вне полосы из {n} кадров')
        x0, y0, x1, y1 = bbox(fr)
        if x0 == 0 or y0 == 0 or x1 == meta['cw'] or y1 == meta['ch']:
            raise SystemExit(f'{SET}/{name}/{res}: рисунок упёрся в край холста {x0, y0, x1, y1}')
        x0, y0, x1, y1 = x0 - 1, y0 - 1, x1 + 1, y1 + 1
        if SHEET:
            sheet(name, res, fr, (x0, y0, x1, y1), meta, marks)
        if entry is None:
            entry = {'n': n, 'fps': d['fps'], 'loop': bool(d['loop'])}
            if marks:
                entry['marks'] = {m: int(i) for m, i in sorted(marks.items(), key=lambda kv: kv[1])}
            if d.get('anchors'):
                entry['anchors'] = {m: [round(p[0] * 100, 1), round(p[1] * 100, 1)]
                                    for m, p in d['anchors'].items()}
        if not GAME:
            continue
        w, h = x1 - x0, y1 - y0
        cols = max(1, min(n, MAX_W // w))
        rows = (n + cols - 1) // cols
        strip = np.zeros((h * rows, w * cols, 4), np.uint8)
        for i in range(n):
            r, c = divmod(i, cols)
            strip[r * h:(r + 1) * h, c * w:(c + 1) * w] = fr[i][y0:y1, x0:x1]
        fn = name + ('-l' if res == 'l' else '') + '.webp'
        sizes[res] = save_webp(Image.fromarray(strip, 'RGBA'), os.path.join(OUT, fn))
        files.append(fn)
        entry[res] = {'x': x0 - meta['bx'], 'y': y0 - meta['by'], 'w': w, 'h': h, 'cols': cols}
    if not GAME or entry is None:
        return None
    hs = hashlib.sha1()
    for fn in files:
        hs.update(fn.encode())
        hs.update(open(os.path.join(OUT, fn), 'rb').read())
    entry['rev'] = hs.hexdigest()[:8]
    entry['bytes'] = sizes
    return entry


def ts_obj(d, ind, lead=0):
    """dict → TS object literal (prettier style: inline if the whole line fits 100, else one key
    per line). `lead` — characters before the object on its line, +1 for the trailing comma."""
    def key(k):
        return k if k.replace('_', 'a').isalnum() and not k[0].isdigit() else f"'{k}'"

    def val(v):
        if isinstance(v, bool):
            return 'true' if v else 'false'
        if isinstance(v, str):
            return f"'{v}'"
        if isinstance(v, (list, tuple)):
            return '[' + ', '.join(val(x) for x in v) + ']'
        if isinstance(v, float) and v.is_integer():
            return str(int(v))
        return str(v)

    flat = all(not isinstance(v, dict) for v in d.values())
    if flat:
        one = '{ ' + ', '.join(f'{key(k)}: {val(v)}' for k, v in d.items()) + ' }'
        if not d:
            one = '{}'
        if lead + len(one) + 1 <= 100:
            return one
    lines = ['{']
    for k, v in d.items():
        pre = f'{ind}  {key(k)}: '
        s = ts_obj(v, ind + '  ', len(pre)) if isinstance(v, dict) else val(v)
        lines.append(f'{ind}  {key(k)}: {s},')
    lines.append(ind + '}')
    return '\n'.join(lines)


def main():
    metas = {r: load_meta(r) for r in ('s', 'l')}
    metas = {r: m for r, m in metas.items() if m}
    if not metas:
        raise SystemExit(f'нет кадров в {TMP}: сначала bake.ts')
    any_meta = metas.get('s') or metas['l']
    order = any_meta['order']
    names = [n for n in order if not ONLY or n in ONLY]
    old = json.load(open(JSON)) if os.path.exists(JSON) and ONLY else {'strips': {}}
    if GAME:
        os.makedirs(OUT, exist_ok=True)
    strips = dict(old.get('strips', {}))
    for name in names:
        e = cut(name, metas, old)
        if e:
            strips[name] = e
    if not GAME:
        return
    # Только живые полосы, в порядке набора.
    strips = {n: strips[n] for n in order if n in strips}
    if not ONLY:
        keep = {n + suf + '.webp' for n in strips for suf in ('', '-l')}
        for f in os.listdir(OUT):
            if f not in keep:
                os.remove(os.path.join(OUT, f))
    man = {'set': SET, 'box': metas['s']['box'] if 's' in metas else metas['l']['box']}
    if 'l' in metas:
        man['large'] = metas['l']['box']
    man['strips'] = strips
    with open(JSON, 'w', encoding='utf-8') as fh:
        json.dump(man, fh, ensure_ascii=False, indent=1)
        fh.write('\n')
    tot = {'s': 0, 'l': 0}
    for n, e in strips.items():
        for r, b in e.get('bytes', {}).items():
            tot[r] += b
        if n in names:
            print(f'  {n}: ' + ', '.join(f'{r} {b / 1024:.1f}' for r, b in e['bytes'].items()) + ' КБ')
    print(f'{SET}: малые {tot["s"] / 1024:.0f} КБ, крупные {tot["l"] / 1024:.0f} КБ, '
          f'всего {(tot["s"] + tot["l"]) / 1024:.0f} КБ')
    body = {k: v for k, v in man.items() if k != 'strips'}
    body['strips'] = {n: {k: v for k, v in e.items() if k != 'bytes'} for n, e in strips.items()}
    with open(MANIFEST, 'w', encoding='utf-8') as fh:
        fh.write('// Сгенерировано scripts/props-pixel/post.py — руками не править.\n')
        fh.write(f'// Набор «{SET}»: полосы в public/ui/px/{SET}/, прямоугольники — в пикселях рисунка от левого\n')
        fh.write('// верхнего угла рамки (`box`), у крупных (`-l`) — в пикселях своей рамки (`large`).\n')
        fh.write("import type { PxManifest } from './types';\n\n")
        fh.write('export const PX: PxManifest = ' + ts_obj(body, '', 99) + ';\n')


main()
