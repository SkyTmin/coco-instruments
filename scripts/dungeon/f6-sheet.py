"""Этаж 6 — лист чужих спрайтов в палитре подземелья (v2.81).

Берёт монстров Ninja Adventure Asset Pack (Pixel-boy, CC0) из клона
`github.com/sparklinlabs/superpowers-asset-packs` (каталог
`ninja-adventure/monsters`) и перекрашивает их по РОЛЯМ цветов в палитру
этажа — огонь, пепел, раскалённый хитин. Листы 64×64: столбцы — вниз,
вверх, влево, вправо; строки — кадры шага. Кладёт в один лист
`public/dungeon/f6/f6-sheet.png` (слева направо: огненный дух, пепельный
летун, жук-огнёвка) — рисовальщик этажа режет его на кадры и дорисовывает
позы (раздувание, пике, свечение брюшка).

Запуск: NA=<путь к ninja-adventure/monsters> python3 scripts/dungeon/f6-sheet.py
Повторный запуск даёт тот же файл.
"""
import os
import sys

from PIL import Image

SRC = os.environ.get('NA', '')
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
OUT = os.path.join(ROOT, 'public', 'dungeon', 'f6', 'f6-sheet.png')

# Перекраска по ролям: исходный цвет → цвет этажа.
RECOLOR = {
    # Огненный дух (Flam, №2): ядро белее, край — в тон лавы, контур тёплый.
    '2': {
        '#020202': '#2a0c06',
        '#ed2727': '#c8301a',
        '#fd6a37': '#ff7a24',
        '#fe965c': '#ffc04a',
        '#fcdbb1': '#fff6c8',
    },
    # Пепельный летун (№9): тело — пепел, маховые — тлеющие угли.
    '9': {
        '#020202': '#141010',
        '#ed2727': '#5e5650',
        '#e2a92d': '#ff7428',
        '#fcdbb1': '#b4aca0',
    },
    # Жук-огнёвка (№15): панцирь — обугленный хитин, кромки тлеют
    # (рисовальщик разжигает их перед укусом), жвала и когти раскалены.
    '15': {
        '#020202': '#140a08',
        '#ed2727': '#7a2a16',
        '#ab1f32': '#2e1c18',
        '#7a113f': '#1a100e',
        '#d9631c': '#3e2620',
        '#e2a92d': '#ff8a30',
        '#ffffff': '#ffd050',
    },
}
ORDER = ['2', '9', '15']


def hexrgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def main():
    if not SRC:
        sys.exit('NA=<путь к ninja-adventure/monsters>')
    sheet = Image.new('RGBA', (64 * len(ORDER), 64), (0, 0, 0, 0))
    for k, name in enumerate(ORDER):
        im = Image.open(os.path.join(SRC, f'{name}.png')).convert('RGBA')
        table = {hexrgb(a): hexrgb(b) for a, b in RECOLOR[name].items()}
        px = im.load()
        for y in range(im.height):
            for x in range(im.width):
                r, g, b, a = px[x, y]
                if a == 0:
                    continue
                if (r, g, b) not in table:
                    raise SystemExit(f'{name}.png: цвет вне таблицы #{r:02x}{g:02x}{b:02x}')
                px[x, y] = table[(r, g, b)] + (a,)
        sheet.alpha_composite(im, (64 * k, 0))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    sheet.save(OUT, optimize=True)
    print('записано', os.path.relpath(OUT, ROOT))


if __name__ == '__main__':
    main()
