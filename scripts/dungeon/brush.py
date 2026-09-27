"""Кисти карт подземелья (v2.81) — общая библиотека этажей.

Этаж рисует свою карту скриптом `scripts/dungeon/fN.py`:

    import sys, os
    sys.path.insert(0, os.path.dirname(__file__))
    from brush import Map, check, write_floor

    m = Map(120, seed=21)          # высота в рядах, зерно — постоянное
    m.rect(10, 100, 30, 110)       # зал
    m.ell(40, 60, 9, 6)            # пещера с неровным краем
    m.hpath(10, 50, 105)           # ход по горизонтали (ширина 3)
    m.jitter()                     # дрожь стен природных пустот
    m.floor(20, 105, 'E')          # лифт на полу, M/L/b — m.wall_obj, o — m.burrow
    write_floor(2, {'MAP_F2': check(m, 'f2')})

`write_floor(N, {...})` пишет `src/lib/dungeon-floors/fN-map.ts` — руками этот
файл не правят. Карта постоянная: зерно фиксировано, повторный запуск даёт
тот же файл байт в байт. Легенда — в `src/lib/dungeon-maps.ts`, свои буквы
этажа — `AreaSpec.legend` в `fN.ts` (см. `scripts/dungeon/README.md`).
"""
import os
import random
import sys

W = 64


def noise(x, y, s, seed):
    """Сглаженный шум 0…1 по клеткам."""
    import math
    def r(a, b):
        h = (a * 374761393 + b * 668265263 + seed * 1274126177) & 0xFFFFFFFF
        h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
        return ((h ^ (h >> 16)) & 0xFFFF) / 65535
    xi, yi = math.floor(x / s), math.floor(y / s)
    fx, fy = x / s - xi, y / s - yi
    u, v = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    a = r(xi, yi) * (1 - u) + r(xi + 1, yi) * u
    b = r(xi, yi + 1) * (1 - u) + r(xi + 1, yi + 1) * u
    return a * (1 - v) + b * v


class Map:
    def __init__(self, h, seed, cave=','):
        # Знак дикой породы: в Устье это «другой» пол (',' — грунт), в
        # Откатке — свой ('.' — грунт; ',' там — плиты выложенных залов).
        self.cave = cave
        self.h = h
        self.g = [['#'] * W for _ in range(h)]
        self.rng = random.Random(seed)
        self.natural = [[False] * W for _ in range(h)]
        self.lock = [[False] * W for _ in range(h)]

    def inb(self, x, y):
        return 1 <= x < W - 1 and 0 <= y < self.h

    def get(self, x, y):
        if not (0 <= x < W and 0 <= y < self.h):
            return '#'
        return self.g[y][x]

    def set(self, x, y, c, lock=False):
        if self.inb(x, y):
            self.g[y][x] = c
            if lock:
                self.lock[y][x] = True

    def rect(self, x0, y0, x1, y1, c='.', natural=False):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                if self.inb(x, y):
                    self.g[y][x] = c
                    self.natural[y][x] = natural

    def ell(self, cx, cy, rx, ry, c=None, natural=True, rough=0.22):
        """Пещера: овал, у которого радиус гуляет по нескольким волнам —
        край неровный, а не ступенчатый круг."""
        import math
        c = c or self.cave
        ph = [self.rng.random() * 6.283 for _ in range(4)]
        for y in range(int(cy - ry * 1.4) - 1, int(cy + ry * 1.4) + 2):
            for x in range(int(cx - rx * 1.4) - 1, int(cx + rx * 1.4) + 2):
                dx = (x + 0.5 - cx) / rx
                dy = (y + 0.5 - cy) / ry
                a = math.atan2(dy, dx)
                k = 1 + rough * (0.55 * math.sin(3 * a + ph[0]) + 0.3 * math.sin(5 * a + ph[1])
                                 + 0.2 * math.sin(8 * a + ph[2]) + 0.12 * math.sin(13 * a + ph[3]))
                if dx * dx + dy * dy <= k * k and self.inb(x, y):
                    self.g[y][x] = c
                    self.natural[y][x] = natural

    def hpath(self, x0, x1, y, w=3, c='.', natural=False):
        a, b = min(x0, x1), max(x0, x1)
        self.rect(a, y - w // 2, b, y - w // 2 + w - 1, c, natural)

    def vpath(self, x, y0, y1, w=3, c='.', natural=False):
        a, b = min(y0, y1), max(y0, y1)
        self.rect(x - w // 2, a, x - w // 2 + w - 1, b, c, natural)

    def jitter(self, p=0.3, passes=2):
        """Дрожь стен природных пустот: только вырезаем, связность не рвётся."""
        for _ in range(passes):
            add = []
            for y in range(1, self.h - 1):
                for x in range(2, W - 2):
                    if self.g[y][x] != '#' or self.lock[y][x]:
                        continue
                    nat = [
                        (dx, dy)
                        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))
                        if self.natural[y + dy][x + dx] and self.g[y + dy][x + dx] in ',.~'
                    ]
                    if nat and self.rng.random() < p:
                        add.append((x, y))
            for x, y in add:
                self.g[y][x] = self.cave
                self.natural[y][x] = True

    def protect(self, x0, y0, x1, y1):
        """Породу в прямоугольнике дрожь не трогает — перемычки остаются целыми."""
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                if self.inb(x, y) and self.g[y][x] == '#':
                    self.lock[y][x] = True

    def put(self, x, y, c):
        assert self.inb(x, y), (x, y, c)
        self.g[y][x] = c
        self.lock[y][x] = True

    def wall_obj(self, x, y, c):
        """Лампа, шахта, доска: стена, под ней пол (ищем рядом, если мимо)."""
        def ok(x, y):
            return (self.get(x, y) == '#' and self.get(x, y + 1) in '.,~!'
                    and not self.lock[y][x])
        if ok(x, y):
            self.put(x, y, c)
            return
        for r in (1, 2, 3):
            for dy in (0, -1, 1, -2, 2):
                for dx in range(-r, r + 1):
                    if 0 <= y + dy < self.h - 1 and ok(x + dx, y + dy):
                        print(f'  сдвиг {c} ({x},{y}) -> ({x+dx},{y+dy})', file=sys.stderr)
                        self.put(x + dx, y + dy, c)
                        return
        raise AssertionError(('no wall near', x, y, c))

    def burrow(self, x, y):
        def ok(x, y):
            return (self.get(x, y) == '#' and not self.lock[y][x] and 0 < x < W - 1 and any(
                self.get(x + dx, y + dy) in '.,~!' for dx, dy in ((0, 1), (1, 0), (-1, 0), (0, -1))))
        if ok(x, y):
            self.put(x, y, 'o')
            return
        for r in range(1, 6):
            for dx, dy in ((-r, 0), (r, 0), (0, -r), (0, r)):
                if ok(x + dx, y + dy):
                    print(f'  сдвиг o ({x},{y}) -> ({x+dx},{y+dy})', file=sys.stderr)
                    self.put(x + dx, y + dy, 'o')
                    return
        raise AssertionError(('no burrow spot', x, y))

    def floor(self, x, y, c):
        ok = '.,!=' if c == 'c' else '.,~'
        if self.g[y][x] in ok:
            self.put(x, y, c)
            return
        # Мимо пола — ближайшая свободная клетка рядом, с предупреждением.
        for r in (1, 2):
            for dy in range(-r, r + 1):
                for dx in range(-r, r + 1):
                    if self.get(x + dx, y + dy) in ok and not self.lock[y + dy][x + dx]:
                        print(f'  сдвиг {c} ({x},{y}) -> ({x+dx},{y+dy})', file=sys.stderr)
                        self.put(x + dx, y + dy, c)
                        return
        raise AssertionError(('no floor near', x, y, c))

    def rows(self):
        return [''.join(r) for r in self.g]


def check(m, name):
    """Ряды карты: 64 в ширину, по краям порода."""
    rows = m.rows()
    for r in rows:
        assert len(r) == W and r[0] == '#' and r[-1] == '#', (name, r)
    return rows


def show(rows, tag=''):
    """Напечатать карту с номерами рядов — смотреть глазами."""
    for i, r in enumerate(rows):
        print('%s%3d %s' % (tag, i, r))


def ts(name, rows):
    return f"export const {name}: string[] = [\n" + ''.join(f"  '{r}',\n" for r in rows) + "];\n"


def write_floor(n, maps, note=''):
    """Записать карты этажа в src/lib/dungeon-floors/fN-map.ts."""
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
    path = os.path.join(root, 'src', 'lib', 'dungeon-floors', f'f{n}-map.ts')
    head = (
        f'// Карты этажа {n} — собраны скриптом scripts/dungeon/f{n}.py (кисти brush.py).\n'
        '// Руками не править: запустите скрипт, он перепишет файл.\n'
    )
    if note:
        head += ''.join(f'// {line}\n' for line in note.strip().splitlines())
    with open(path, 'w') as f:
        f.write(head + '\n' + '\n'.join(ts(k, v) for k, v in maps.items()))
    print('записано', os.path.relpath(path, root), file=sys.stderr)
