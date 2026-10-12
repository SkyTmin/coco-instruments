#!/usr/bin/env python3
"""fonts.py (Coco): pixel fonts of the game UI — subset + self-host + coverage check.

    python3 scripts/ui-px/fonts.py SRC_DIR

SRC_DIR holds the original OFL fonts from Google Fonts (google/fonts repo, `ofl/tiny5`,
`ofl/pressstart2p`): Tiny5.ttf (body, 8-px em, caps 5 px) and PressStart2P.ttf (headings and
tiny digits, 8-px em). Writes public/ui/fonts/{tiny5,pressstart2p}.woff2 (Latin, Latin-1,
Latin Ext-A — TR/DE/FR/ES/IT — Cyrillic, UI punctuation) and fails if a glyph any of the seven
game languages needs is missing. Needs fontTools + brotli.
"""
import os
import sys

from fontTools import subset
from fontTools.ttLib import TTFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', '..', 'public', 'ui', 'fonts')
UNICODES = (
    '0020-007E,00A0-00FF,0100-017F,0218-021B,0400-045F,2010-2027,2030-203A,'
    '2116,2190-2193,2212,20BD,2605,2665'
)
NEED = (
    'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя'
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    'àâæçéèêëîïôœùûüÿÀÂÆÇÉÈÊËÎÏÔŒÙÛÜŸİıĞğŞşÇçÖöÜüßÄäñÑáíóúÁÍÓÚ¿¡ìòÌÒ'
    '.,:;!?«»—–…’“”„\'"()[]+-×=%/·•'
)
FONTS = {'Tiny5.ttf': 'tiny5.woff2', 'PressStart2P.ttf': 'coco-head.woff2'}
RENAME = {'PressStart2P.ttf': 'Coco Head'}


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
            # «Press Start 2P» is a Reserved Font Name: a subset (a modified version under the OFL)
            # must not carry it.
            fam = RENAME[name]
            for rec in f['name'].names:
                if rec.nameID in (1, 3, 4, 6, 16, 21):
                    rec.string = fam.replace(' ', '') if rec.nameID in (3, 6) else fam
        path = os.path.join(OUT, out)
        subset.save_font(f, path, opts)
        cmap = TTFont(path).getBestCmap()
        miss = ''.join(c for c in NEED if ord(c) not in cmap)
        # Press Start 2P is headings + digits only: a missing accent falls back to Tiny5 in the stack.
        print(f'{out}: {os.path.getsize(path)} B, {len(cmap)} glyphs, missing: {miss or "—"}')
        if miss and name == 'Tiny5.ttf':
            sys.exit(f'{name}: missing {miss}')


if __name__ == '__main__':
    main()
