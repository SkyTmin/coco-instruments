#!/usr/bin/env python3
"""fonts.py (Coco): the heading font of the game UI — subset + self-host + coverage check.

    python3 scripts/ui-px/fonts.py SRC_DIR

Text, labels and numbers use GxRubik (Rubik variable, already self-hosted:
public/ui/fonts/rubik.woff2 + rubik-ext.woff2). Headings use Russo One (OFL, Jovanny Lemonad;
google/fonts `ofl/russoone`): SRC_DIR holds RussoOne-Regular.ttf. «Russo» is a Reserved Font
Name, so the subset (a modified version under the OFL) is renamed «Coco Title». Writes
public/ui/fonts/coco-title.woff2 (Latin, Latin-1, Latin Ext-A — TR/DE/FR/ES/IT — Cyrillic, UI
punctuation) and fails if a glyph any of the seven game languages needs is missing.
Needs fontTools + brotli.
"""
import os
import sys

from fontTools import subset
from fontTools.ttLib import TTFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', '..', 'public', 'ui', 'fonts')
UNICODES = (
    '0020-007E,00A0-00FF,0100-017F,0218-021B,0400-045F,2009,2010-2027,202F,2030-203A,'
    '2116,2190-2193,2212,20AC,20BD'
)
NEED = (
    'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя'
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    'àâæçéèêëîïôœùûüÿÀÂÆÇÉÈÊËÎÏÔŒÙÛÜŸİıĞğŞşÇçÖöÜüßÄäñÑáíóúÁÍÓÚ¿¡ìòÌÒ'
    '.,:;!?«»—–…’“”„\'"()[]+-×=%/·•№'
)
FONTS = {'RussoOne-Regular.ttf': 'coco-title.woff2'}
RENAME = {'RussoOne-Regular.ttf': 'Coco Title'}


def main() -> None:
    src = sys.argv[1]
    os.makedirs(OUT, exist_ok=True)
    for name, out in FONTS.items():
        opts = subset.Options()
        opts.flavor = 'woff2'
        opts.layout_features = ['*']
        opts.name_IDs = ['*']
        opts.notdef_outline = True
        f = subset.load_font(os.path.join(src, name), opts)
        s = subset.Subsetter(opts)
        uni = []
        for part in UNICODES.split(','):
            a, _, b = part.partition('-')
            uni.extend(range(int(a, 16), int(b or a, 16) + 1))
        s.populate(unicodes=uni)
        s.subset(f)
        if name in RENAME:
            # A Reserved Font Name must not stay on a modified version (OFL §3).
            fam = RENAME[name]
            for rec in f['name'].names:
                if rec.nameID in (1, 3, 4, 6, 16, 21):
                    rec.string = fam.replace(' ', '') if rec.nameID in (3, 6) else fam
        path = os.path.join(OUT, out)
        subset.save_font(f, path, opts)
        cmap = TTFont(path).getBestCmap()
        miss = ''.join(c for c in NEED if ord(c) not in cmap)
        print(f'{out}: {os.path.getsize(path)} B, {len(cmap)} glyphs, missing: {miss or "—"}')
        if miss:
            sys.exit(f'{name}: missing {miss}')


if __name__ == '__main__':
    main()
