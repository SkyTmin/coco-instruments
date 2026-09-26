#!/usr/bin/env python3
"""scenes.py (Coco): write one scene file per pet animation, matching src/timeline.js.
Each file is one line: FILM.pets.scene('<pet>', '<anim>'). Run after adding a pet to PETS."""
import os, re
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
tl = open(os.path.join(ROOT, 'src', 'timeline.js')).read()
pets = re.findall(r"'([a-z]+)'", re.search(r'const PETS = \[(.*?)\]', tl, re.S).group(1))
anims = re.findall(r"\['([a-z]+)', \d+, \d+\]", tl)
d = os.path.join(ROOT, 'src', 'scenes')
for f in os.listdir(d):
    os.remove(os.path.join(d, f))
n = 1
for p in pets:
    for a in anims:
        name = f'{n:03d}-{p}-{a}.js'
        with open(os.path.join(d, name), 'w') as fh:
            fh.write(f"// {name} : {p}, {a} loop (drawn by src/pets/).\nFILM.pets.scene('{p}', '{a}');\n")
        n += 1
print(f'{n - 1} scene files for {len(pets)} pets')
