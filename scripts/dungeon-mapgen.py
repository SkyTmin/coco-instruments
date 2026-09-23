"""Кисть карт подземелья: прямоугольники, овалы, ходы, дрожь стен.

Карта — постоянная (зерно фиксировано): одна планировка на все спуски.
Легенда — как в src/lib/dungeon-maps.ts; ',' — пол другого вида
(в Устье — грунт природных пустот, в Откатке — плиты выложенных залов).

    python3 scripts/dungeon-mapgen.py --write   # переписать карты в dungeon-maps.ts
    python3 scripts/dungeon-mapgen.py           # напечатать с номерами строк

После правки — `npx vitest run src/lib/dungeon` (связность, лампы, норы,
баланс ботом) и MAP_VERSION в lib/dungeon.ts, если сдвинулись стены.
"""
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


# ---------------------------------------------------------------------------
# Устье: 170 рядов. Низ — клеть, верх — стык с Откаткой.
# ---------------------------------------------------------------------------


def mouth():
    m = Map(170, 1)
    H = 170
    # Околоствольный двор — выложенный зал вокруг клети.
    m.rect(20, 146, 43, 166, '.')
    m.put(32, 159, 'E')
    # Проход на север — главный штрек, рельсы от клети. В развилку он
    # входит коленом с запада, а не в лоб.
    m.rect(29, 116, 35, 145, '.')
    m.hpath(18, 35, 114, 5, '.')
    m.vpath(20, 104, 116, 5, '.')
    # Нарядная — комната горняков на запад.
    m.hpath(19, 14, 156, 3, '.')
    m.rect(5, 149, 15, 163, '.')
    # Тайник за трещиной в нарядной.
    m.rect(2, 152, 3, 155, '.')
    m.put(4, 153, '%')
    m.put(2, 153, '$')
    # Инструменталка — на восток.
    m.hpath(44, 49, 161, 3, '.')
    m.rect(48, 154, 58, 166, '.')
    # Развилка — большая природная пустота.
    m.ell(32, 99, 17, 10)
    m.rect(22, 94, 42, 104, ',', natural=True)
    # Запад: затопленная выработка.
    m.hpath(6, 16, 98, 4, ',', natural=True)
    m.ell(9, 86, 6, 16)
    # Крысятник — на северо-западе.
    m.ell(14, 56, 10, 13)
    m.ell(22, 46, 7, 7)
    m.vpath(10, 66, 74, 4, ',', natural=True)
    # Север: верхний штрек до стыка — выложен, с рельсами. С развилкой он
    # НЕ сообщается напрямую: наверх — через крысятник или через склад, а
    # прямой путь даёт только ходок за решёткой.
    m.rect(29, 0, 35, 80, '.')
    # Сбойка крысятник ↔ верхний штрек.
    m.hpath(26, 29, 48, 3, ',', natural=True)
    m.hpath(20, 29, 22, 3, '.')
    m.rect(12, 16, 22, 28, '.')
    # Восток: пороховой склад и пиритовая штольня.
    m.hpath(48, 52, 96, 4, ',', natural=True)
    m.vpath(50, 86, 95, 3, ',', natural=True)
    m.rect(44, 62, 55, 86, '.')
    m.hpath(35, 44, 74, 3, '.')
    m.rect(38, 72, 46, 84, '.')
    # Тайник склада — за трещиной.
    m.rect(57, 66, 58, 69, '.')
    m.put(56, 67, '%')
    m.put(57, 68, '$')
    # Вентиляционный ходок: восточный край, от решётки в инструменталке у
    # клети — прямо до зала верхней клети Откатки. Решётка открывается
    # только со стороны ходка: короткий путь надо сперва пройти сверху.
    m.vpath(61, 0, 160, 2, '.')
    m.put(59, 158, 'D')
    m.protect(23, 108, 45, 111)
    m.jitter(0.2, 1)

    # --- Объекты ---
    # Двор: лампы, доска, фонари, ящики.
    m.wall_obj(24, 145, 'L')
    m.wall_obj(40, 145, 'L')
    m.wall_obj(27, 145, 'b')
    m.floor(21, 165, 'l')
    m.floor(42, 165, 'l')
    for x, y in ((21, 147), (22, 147), (42, 147), (21, 160), (41, 164)):
        m.floor(x, y, 'C')
    for x, y in ((43, 150), (20, 152)):
        m.floor(x, y, 'B')
    m.floor(36, 162, 'T')
    # Рельсы от клети на север.
    for y in range(60, 158):
        if m.g[y][32] in '.,':
            m.g[y][32] = '!'
    m.floor(32, 138, 'c')
    m.floor(32, 70, 'c')
    # Главный штрек: стойки крепи, норы, засада.
    for y in (140, 133, 126, 119, 112):
        m.floor(29, y, 'P')
        m.floor(35, y, 'P')
    m.burrow(28, 130)
    m.burrow(36, 123)
    m.burrow(28, 116)
    m.floor(31, 118, 'a')
    # Нарядная.
    m.wall_obj(9, 148, 'L')
    for x, y in ((6, 150), (7, 150), (14, 162), (6, 162)):
        m.floor(x, y, 'C')
    m.floor(13, 150, 'B')
    m.floor(10, 160, 'u')
    m.floor(12, 155, 'T')
    # Инструменталка.
    m.floor(56, 155, 'X')
    m.floor(49, 165, 'C')
    m.floor(57, 165, 'B')
    m.floor(53, 158, 'n')
    m.burrow(53, 153)
    m.floor(50, 155, 'u')
    # Развилка: стойки, стая, гнездо.
    for x, y in ((24, 96), (40, 96), (24, 103), (40, 103)):
        m.floor(x, y, 'P')
    m.floor(28, 100, 'R')
    m.floor(37, 93, 'n')
    m.floor(33, 106, 'l')
    # Затопленная выработка: пруды пятнами по шуму, а не россыпью луж —
    # вода стоит в низинах, между ними сухие гряды.
    for y in range(72, 104):
        for x in range(2, 18):
            if m.g[y][x] == ',' and noise(x, y, 5.0, 11) > 0.55:
                m.g[y][x] = '~'
    m.floor(9, 80, 'R')
    m.floor(8, 92, 'u')
    # Крысятник: гнёзда, стаи, много нор.
    for x, y in ((12, 52), (18, 60), (22, 44), (9, 62)):
        m.floor(x, y, 'n')
    m.floor(15, 56, 'R')
    m.floor(21, 47, 'R')
    m.floor(14, 66, 'a')
    # Сторожка у сбойки: табличка, фонарь.
    m.floor(16, 18, 'T')
    m.floor(13, 27, 'u')
    m.floor(21, 17, 'C')
    m.floor(20, 17, 'B')
    # Склад: ящики, бочки, порох, фонарь, табличка.
    for x, y in ((45, 63), (46, 63), (54, 63), (54, 64), (45, 85), (54, 85)):
        m.floor(x, y, 'C')
    for x, y in ((47, 70), (52, 78), (45, 76)):
        m.floor(x, y, 'B')
    m.floor(50, 70, 'X')
    m.floor(49, 81, 'X')
    m.floor(50, 64, 'T')
    m.floor(53, 74, 'u')
    m.floor(48, 75, 'R')
    # Пиритовая штольня.
    m.wall_obj(42, 71, 'M')
    m.wall_obj(39, 71, 'L')
    m.floor(45, 83, 'C')
    # Верхний штрек: стойки, фонари, засада, стая.
    for y in (76, 66, 56, 44, 34, 24, 14, 6):
        m.floor(29, y, 'P')
        m.floor(35, y, 'P')
    m.floor(34, 60, 'u')
    m.floor(30, 30, 'l')
    m.floor(31, 40, 'a')
    m.floor(33, 10, 'R')
    m.floor(34, 18, 'T')
    return m


# ---------------------------------------------------------------------------
# Откатка: 240 рядов. Низ стыкуется с верхом Устья.
# ---------------------------------------------------------------------------


def haul():
    m = Map(240, 2, cave='.')
    # Вход снизу — продолжение верхнего штрека Устья; в рудный двор он
    # сворачивает к западному краю.
    m.rect(29, 230, 35, 239, '.')
    m.hpath(11, 35, 230, 5, '.')
    m.vpath(13, 222, 230, 5, '.')
    # Рудный двор — выложенный зал с двумя путями.
    m.rect(10, 180, 54, 221, ',')
    # Откаточные штреки — два параллельных, со сбойками.
    # Западный штрек в рудный двор не выходит: из двора — восточным, сбойкой
    # на запад, и только западным к верхней клети. Петля делает ходок за
    # решёткой настоящим коротким путём.
    m.rect(16, 104, 24, 175, '.')
    m.rect(40, 104, 48, 179, '.')
    for y in (164, 140, 116):
        m.hpath(24, 40, y, 4, '.')
    # Боковые выработки со старыми завалами.
    m.ell(8, 150, 6, 9)
    m.hpath(8, 16, 150, 3, '.', natural=True)
    m.ell(56, 128, 5, 8)
    m.hpath(48, 55, 128, 3, '.', natural=True)
    # Тайник Откатки — за трещиной в боковой выработке.
    m.rect(2, 162, 3, 165, '.')
    m.rect(3, 152, 5, 157, '.', natural=True)
    m.vpath(3, 158, 161, 1, '.')
    m.put(3, 158, '%')
    m.put(3, 163, '$')
    m.protect(1, 158, 7, 167)
    # Околоствольный двор Откатки — зал верхней клети.
    m.rect(18, 62, 46, 100, ',')
    m.put(32, 80, 'E')
    # В зал верхней клети — только западным штреком.
    m.vpath(20, 100, 104, 5, '.')
    # Пиритовая выработка Откатки — на запад от двора.
    m.rect(4, 64, 14, 84, '.')
    m.hpath(14, 18, 74, 3, '.')
    # Вентиляционный ходок: восточный край снизу до двора верхней клети.
    m.vpath(61, 74, 239, 2, '.')
    m.hpath(47, 60, 74, 3, '.')
    # Преддверие логова.
    m.rect(26, 52, 38, 61, '.')
    # Логово короля — замкнутый зал, выход только воротами.
    m.ell(32, 32, 20, 16, '.', natural=False, rough=0.12)
    m.rect(29, 45, 35, 50, '.')
    m.put(31, 51, 'G')
    m.put(32, 51, 'G')
    m.put(33, 51, 'G')
    # Обход логова на запад — к завалу.
    m.vpath(5, 6, 62, 3, '.', natural=True)
    m.hpath(5, 26, 58, 3, '.', natural=True)
    m.rect(3, 0, 9, 5, '.', natural=True)
    m.jitter(0.2, 1)
    # Логово не трогаем дрожью: пересоздадим стены вокруг ворот.
    for x in range(28, 37):
        if x not in (31, 32, 33):
            m.g[51][x] = '#'

    # --- Объекты ---
    # Рудный двор: пути, вагонетки, гнёзда в вагонетках, порох, стаи.
    for y in range(150, 222):
        for x in (24, 40):
            if m.g[y][x] in '.,':
                m.g[y][x] = '!'
    m.floor(24, 205, 'c')
    m.floor(40, 190, 'c')
    m.floor(24, 160, 'c')
    m.floor(40, 165, 'c')
    for x, y in ((14, 184), (50, 214), (30, 196), (46, 184), (18, 214), (36, 204), (26, 186)):
        m.floor(x, y, 'v')
    m.floor(34, 212, 'R')
    m.burrow(9, 202)
    m.burrow(55, 186)
    for x, y in ((12, 181), (52, 181), (12, 220), (52, 220), (33, 183)):
        m.floor(x, y, 'C')
    for x, y in ((11, 200), (53, 200), (31, 219)):
        m.floor(x, y, 'B')
    m.floor(29, 208, 'X')
    m.floor(36, 188, 'X')
    m.floor(18, 196, 'R')
    m.floor(46, 206, 'R')
    m.wall_obj(12, 179, 'L')
    m.wall_obj(32, 179, 'L')
    m.wall_obj(52, 179, 'L')
    m.floor(32, 216, 'T')
    for x, y in ((9, 190), (55, 196), (9, 212), (55, 210)):
        m.burrow(x, y)
    # Штреки: засады, норы, фонари, стойки.
    for y in (172, 156, 148, 132, 124, 108):
        m.floor(16, y, 'P')
        m.floor(24, y, 'P')
        m.floor(40, y + 4, 'P')
        m.floor(48, y + 4, 'P')
    m.floor(20, 170, 'a')
    m.floor(44, 150, 'a')
    m.floor(20, 126, 'u')
    m.floor(44, 112, 'u')
    m.floor(32, 140, 'R')
    m.burrow(15, 136)
    m.burrow(49, 158)
    m.burrow(25, 110)
    # Обязательный путь — восточный штрек, сбойка, западный — самый людный:
    # норы по обеим стенам через 10–12 рядов, стаи на сбойках.
    for y in (170, 146, 122):
        m.burrow(39, y)
        m.burrow(49, y - 12)
    for y in (160, 136, 112):
        m.burrow(15, y)
        m.burrow(25, y - 12)
    m.floor(44, 172, 'R')
    m.floor(32, 164, 'R')
    m.floor(20, 150, 'R')
    m.floor(20, 118, 'R')
    m.floor(44, 128, 'a')
    m.floor(20, 136, 'a')
    m.floor(8, 146, 'R')
    m.floor(6, 154, 'n')
    m.floor(56, 124, 'n')
    m.floor(55, 132, 'X')
    # Двор верхней клети: лампы, табличка, ящики.
    m.wall_obj(22, 61, 'L')
    m.wall_obj(42, 61, 'L')
    m.floor(20, 64, 'C')
    m.floor(44, 64, 'C')
    m.floor(19, 98, 'B')
    m.floor(45, 98, 'C')
    m.floor(27, 86, 'T')
    m.floor(22, 70, 'l')
    m.floor(42, 70, 'l')
    m.burrow(17, 90)
    m.burrow(47, 82)
    # Пиритовая выработка Откатки.
    m.wall_obj(9, 63, 'M')
    m.wall_obj(6, 63, 'L')
    m.floor(13, 83, 'C')
    # Преддверие логова: табличка, фонарь.
    m.floor(28, 58, 'T')
    m.floor(37, 55, 'u')
    # Логово: король, стойки, норы.
    m.floor(32, 30, 'K')
    for x, y in ((22, 24), (42, 24), (22, 40), (42, 40)):
        m.floor(x, y, 'P')
    m.burrow(12, 32)
    m.burrow(52, 32)
    m.burrow(32, 15)
    # Завал на верху обхода — дальше будущие районы.
    for x in range(3, 10):
        m.g[4][x] = 'Y'
    m.floor(6, 7, 'T')
    m.floor(5, 40, 'u')
    return m


def check(m, name):
    rows = m.rows()
    for r in rows:
        assert len(r) == W and r[0] == '#' and r[-1] == '#', (name, r)
    return rows


mo = check(mouth(), 'mouth')
ha = check(haul(), 'haul')
shared = sum(1 for x in range(W) if mo[0][x] != '#' and ha[-1][x] != '#')
print('shared seam columns', shared, file=sys.stderr)
mo[-1] = '#' * W


def ts(name, rows):
    return f"export const {name}: string[] = [\n" + ''.join(f"  '{r}',\n" for r in rows) + "];\n"


if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else None
    if out == '--write':
        import os
        path = os.path.join(os.path.dirname(__file__), '..', 'src', 'lib', 'dungeon-maps.ts')
        src = open(path).read()
        head = src[: src.index('export const MAP_HAUL')]
        with open(path, 'w') as f:
            f.write(head + ts('MAP_HAUL', ha) + '\n' + ts('MAP_MOUTH', mo))
    elif out:
        with open(out, 'w') as f:
            f.write(ts('MAP_HAUL', ha))
            f.write('\n')
            f.write(ts('MAP_MOUTH', mo))
    else:
        for i, r in enumerate(ha):
            print('H%3d %s' % (i, r))
        for i, r in enumerate(mo):
            print('M%3d %s' % (i, r))
