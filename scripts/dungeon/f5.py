"""Этаж 5 «Лабиринт» — карта (v2.81).

Мотив — живой подземный Лабиринт: кладка без конца, коридоры в две-три
клетки, тупики, петли, залы-перекрёстки. Стены «живые»: из прожилок в
кладке выходят монстры. В самой глубине — старая арена-колизей, где ждёт
Минотавр.

Два района снизу вверх:
  f5maze  — «Живой лабиринт»: зал с лифтом, лабиринт 12×26 ячеек, залы
            (мох, провал с мостками, заросли, логово гончих, шахта), тайник
            за треснувшей стеной, служебный ход с решёткой к лифту.
  f5arena — «Колизей»: ещё лабиринт, преддверие арены с табличкой, круглая
            арена с колоннами и воротами, запечатанный обход к лестнице.

Запуск: python3 scripts/dungeon/f5.py [--show] — пишет
src/lib/dungeon-floors/f5-map.ts (руками не править). Зерно постоянное.

Свои буквы (легенда — `AreaSpec.legend` в f5.ts):
  "  трава (кролики прячутся)      g  стена со светящимся мхом
  w  живая стена (из неё выходят)   t  факел на стене
  s  песок арены                    _  провал (глубина)
  ^  плита с шипами (ловушка)       p  горшок (бьётся)
  x  кости авантюриста              |  колонна арены
  /  оружие в песке                 h  стена трибун арены
  k  кости на песке арены
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from brush import Map, W, check, show, write_floor  # noqa: E402

P = 5  # шаг ячейки лабиринта: блок 3×3 и стена 2
X0 = 3


def bx(i):
    return X0 + P * i


class Maze:
    """Лабиринт ячеек 3×3 с проходами шириной 2–3: обход в глубину с
    возвратом, потом петли и залы."""

    def __init__(self, m, y0, cols, rows, skip=()):
        self.m = m
        self.y0 = y0
        self.cols = cols
        self.rows = rows
        self.skip = set(skip)
        self.edges = set()

    def by(self, j):
        return self.y0 + P * j

    def cells(self):
        return [(i, j) for j in range(self.rows) for i in range(self.cols) if (i, j) not in self.skip]

    def carve_cell(self, i, j):
        self.m.rect(bx(i), self.by(j), bx(i) + 2, self.by(j) + 2)

    def carve_edge(self, a, b, narrow=None):
        (i0, j0), (i1, j1) = sorted([a, b])
        self.edges.add((a, b) if a < b else (b, a))
        rng = self.m.rng
        if narrow is None:
            narrow = rng.random() < 0.35
        off = rng.choice([0, 1]) if narrow else 0
        w = 2 if narrow else 3
        if j0 == j1:  # по горизонтали
            x0 = bx(i0) + 3
            y = self.by(j0) + off
            self.m.rect(x0, y, x0 + 1, y + w - 1)
        else:
            y0 = self.by(j0) + 3
            x = bx(i0) + off
            self.m.rect(x, y0, x + w - 1, y0 + 1)

    def generate(self, start):
        rng = self.m.rng
        seen = {start}
        stack = [start]
        self.carve_cell(*start)
        while stack:
            i, j = stack[-1]
            nb = [
                (i + di, j + dj)
                for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1))
                if 0 <= i + di < self.cols
                and 0 <= j + dj < self.rows
                and (i + di, j + dj) not in self.skip
                and (i + di, j + dj) not in seen
            ]
            if not nb:
                stack.pop()
                continue
            # Лабиринт с длинными прямыми: чаще продолжаем в ту же сторону.
            n = rng.choice(nb)
            seen.add(n)
            self.carve_cell(*n)
            self.carve_edge((i, j), n)
            stack.append(n)

    def loops(self, share):
        """Петли: лишние проходы между соседями — путь не единственный."""
        rng = self.m.rng
        for (i, j) in self.cells():
            for n in ((i + 1, j), (i, j + 1)):
                if n in self.skip or n[0] >= self.cols or n[1] >= self.rows:
                    continue
                e = ((i, j), n)
                if e not in self.edges and rng.random() < share:
                    self.carve_edge((i, j), n)

    def hall(self, i0, j0, i1, j1, c='.'):
        self.m.rect(bx(i0), self.by(j0), bx(i1) + 2, self.by(j1) + 2, c)

    def dead_ends(self):
        """Тупики: ячейки с одним проходом — (i, j, x, y) угла блока."""
        out = []
        for (i, j) in self.cells():
            n = sum(1 for e in self.edges if (i, j) in e)
            if n == 1:
                out.append((i, j, bx(i), self.by(j)))
        return out


def faces(m, x0, y0, x1, y1):
    """Клетки стены, под которыми пол: лицо стены видно."""
    out = []
    for y in range(max(0, y0), min(m.h - 1, y1 + 1)):
        for x in range(max(1, x0), min(W - 1, x1 + 1)):
            if m.g[y][x] == '#' and m.g[y + 1][x] in '.,' and not m.lock[y][x]:
                out.append((x, y))
    return out


def sprinkle(m, cells, ch, share, min_gap=0):
    """Раскидать букву по доле клеток, не ближе `min_gap` друг к другу."""
    rng = m.rng
    placed = []
    for (x, y) in cells:
        if rng.random() >= share:
            continue
        if any(abs(x - px) + abs(y - py) < min_gap for px, py in placed):
            continue
        m.put(x, y, ch)
        placed.append((x, y))
    return placed


def floor_cells(m, x0, y0, x1, y1, ok='.'):
    return [(x, y) for y in range(y0, y1 + 1) for x in range(x0, x1 + 1)
            if 0 <= y < m.h and m.g[y][x] in ok and not m.lock[y][x]]


def paint(m, x0, y0, x1, y1, ch, share=1.0, ok='.'):
    rng = m.rng
    for (x, y) in floor_cells(m, x0, y0, x1, y1, ok):
        if rng.random() < share:
            m.g[y][x] = ch


def near_wall(m, x, y):
    return any(m.get(x + dx, y + dy) == '#' for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))


def open_nb(m, x, y):
    return sum(1 for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)) if m.get(x + dx, y + dy) != '#')


# ---------------------------------------------------------------------------
# Район 1 — «Живой лабиринт» (вход, лифт).
# ---------------------------------------------------------------------------

def area_maze():
    H = 152
    m = Map(H, seed=5501, cave=',')
    rng = m.rng
    # Служебный ход вдоль восточной стены (колонка 11, ряды 14…25) — не лабиринт.
    skip = {(11, j) for j in range(14, 26)} | {(0, 19)}
    mz = Maze(m, 3, 12, 26, skip)
    mz.generate((5, 25))
    mz.loops(0.16)

    # Залы-перекрёстки.
    mz.hall(4, 20, 6, 21)      # мшистый перекрёсток у входа
    mz.hall(0, 14, 2, 15)      # зал шахты
    mz.hall(6, 9, 9, 11)       # провал с мостками
    mz.hall(1, 4, 3, 6)        # заросли
    mz.hall(8, 1, 10, 2)       # логово гончих
    mz.hall(4, 13, 5, 14)      # малый перекрёсток
    mz.hall(9, 17, 10, 18)     # обвал, заросший травой

    # Выход наверх, в «Колизей»: столбцы 33…35.
    m.rect(33, 0, 35, 2)

    # --- Зал лифта «Преддверие»: ряды 135…148.
    m.rect(12, 136, 52, 147)
    m.rect(20, 134, 44, 135)
    # Два хода в лабиринт: слева и справа, каждый — развилка.
    m.rect(13, 131, 15, 135)   # к ячейке (2,25)
    m.rect(48, 131, 50, 135)   # к ячейке (9,25)
    # Колонны зала.
    for x in (18, 46):
        for y in (139, 144):
            m.put(x, y, 'P')
    m.floor(31, 141, 'E')
    # Зелень по углам и кости у стен: зал давно брошен.
    paint(m, 12, 136, 15, 138, '"', 0.7)
    paint(m, 49, 145, 52, 147, '"', 0.7)
    paint(m, 12, 145, 13, 147, '"', 0.5)
    for (x, y) in ((24, 147), (40, 136)):
        m.put(x, y, 'x')
    # Указатели у лифта и доска.
    m.put(27, 138, 'T')
    m.wall_obj(36, 135, 'b')
    # Бочки и ящики у стен.
    for (x, y, c) in ((13, 146, 'C'), (14, 146, 'B'), (51, 146, 'C'), (44, 137, 'p'), (21, 137, 'p')):
        m.put(x, y, c)

    # --- Служебный ход: с лабиринта (ячейка 10,14) вниз по восточной стене
    # к залу лифта; решётка открывается только изнутри хода — с востока.
    m.rect(58, mz.by(14), 60, 141)   # вертикаль x 58…60
    m.rect(bx(10) + 3, mz.by(14), 57, mz.by(14) + 2)    # вход с лабиринта
    m.rect(53, 140, 57, 142)
    m.put(53, 140, '#')
    m.put(53, 142, '#')
    m.put(53, 141, 'D')

    # --- Шахта: на северной стене зала шахты.
    hx0, hy0 = bx(0), mz.by(14)
    m.wall_obj(bx(1) + 1, hy0 - 1, 'M')
    m.put(bx(0) + 1, hy0 + 8, 'T')

    # --- Провал: дно зала — пропасть, через неё мостки в две клетки.
    px0, py0, px1, py1 = bx(6), mz.by(9), bx(9) + 2, mz.by(11) + 2
    for y in range(py0 + 2, py1 - 1):
        for x in range(px0 + 2, px1 - 1):
            m.g[y][x] = '_'
    # Мостки: крест из узких полос.
    mid_y = (py0 + py1) // 2
    mid_x = (px0 + px1) // 2
    for x in range(px0, px1 + 1):
        if m.g[mid_y][x] == '_':
            m.g[mid_y][x] = '.'
        if m.g[mid_y + 1][x] == '_':
            m.g[mid_y + 1][x] = '.'
    for y in range(py0, py1 + 1):
        if m.g[y][mid_x] == '_':
            m.g[y][mid_x] = '.'
    # Островок посреди провала: горшок и кости — видно, но добраться можно
    # только по мостку в одну клетку.
    for (x, y) in ((px0 + 4, py0 + 3), (px0 + 5, py0 + 3), (px0 + 4, py0 + 4), (px0 + 5, py0 + 4)):
        m.g[y][x] = '.'
    m.g[py0 + 2][px0 + 4] = '.'
    m.put(px0 + 5, py0 + 3, 'p')
    m.put(px0 + 4, py0 + 4, 'x')

    # --- Логово гончих: спящая стая и кости.
    lx0, ly0 = bx(8), mz.by(1)
    m.put(lx0 + 5, ly0 + 4, 'R')
    m.put(lx0 + 1, ly0 + 7, 'x')
    m.put(lx0 + 10, ly0 + 2, 'x')
    # Вторая стая — в дальнем углу лабиринта.
    m.put(bx(0) + 1, mz.by(9) + 1, 'R')
    m.put(bx(10) + 1, mz.by(22) + 1, 'R')

    # --- Тайник: ячейка (0,19) выпала из лабиринта — в неё ведёт только
    # треснувшая стена из соседней ячейки (1,19).
    sx, sy = bx(0), mz.by(19)
    m.rect(sx, sy, sx + 2, sy + 2)
    m.rect(sx + 3, sy + 1, sx + 3, sy + 1)
    m.put(sx + 4, sy + 1, '%')
    m.put(sx + 1, sy + 1, '$')
    m.put(sx, sy + 2, 'x')
    m.protect(sx - 1, sy - 2, sx + 5, sy + 4)

    # Ловушки: коридоры с плитами-шипами в двух местах.
    spikes = []
    for (i, j) in ((3, 8), (7, 16), (2, 23), (10, 5)):
        x, y = bx(i), mz.by(j)
        for dy in range(3):
            for dx in range(3):
                if m.g[y + dy][x + dx] == '.' and (dx + dy) % 2 == 0:
                    spikes.append((x + dx, y + dy))
    # Засады: со свода падают в узких местах.
    for (i, j) in ((5, 17), (2, 10), (8, 6)):
        m.put(bx(i) + 1, mz.by(j) + 1, 'a')

    # Норы-муравейники: дыры в стене, пол рядом.
    for (x, y) in ((bx(3) + 1, mz.by(18) - 1), (bx(8) + 3, mz.by(13) + 1),
                   (bx(1) + 3, mz.by(2) + 1), (bx(10) + 1, mz.by(9) - 1),
                   (bx(6) + 3, mz.by(3) + 1), (bx(4) + 1, mz.by(24) - 1)):
        m.burrow(x, y)

    # Указатели на перекрёстках.
    m.put(bx(5) + 1, mz.by(20) + 4, 'T')
    m.put(bx(4) + 1, mz.by(13) + 4, 'T')
    m.put(bx(7) + 1, mz.by(2) + 1, 'T')

    # --- Своё: трава, мох, живые стены, факелы, кости, горшки.
    # Заросли: весь зал — трава с тропками.
    zx0, zy0 = bx(1), mz.by(4)
    paint(m, zx0, zy0, bx(3) + 2, mz.by(6) + 2, '"', 0.82)
    paint(m, bx(9), mz.by(17), bx(10) + 2, mz.by(18) + 2, '"', 0.7)
    # Кармашки: тупики, заросшие травой; в других — горшки и кости.
    de = mz.dead_ends()
    rng.shuffle(de)
    secrets = 0
    for k, (i, j, x, y) in enumerate(de):
        kind = k % 4
        if kind in (0, 1):
            paint(m, x, y, x + 2, y + 2, '"', 0.85)
        elif kind == 2:
            m.put(x + 1, y + 1, 'x')
            if secrets < 2 and (i, j) != (5, 25):
                m.put(x + 1, y + 2 if m.g[y + 2][x + 1] == '.' else y, '$')
                secrets += 1
        else:
            for (dx, dy) in ((0, 0), (2, 0), (0, 2)):
                if m.g[y + dy][x + dx] == '.':
                    m.put(x + dx, y + dy, 'p')
    for (x, y) in spikes:
        if m.g[y][x] == '.':
            m.g[y][x] = '^'
    # Мшистый перекрёсток: трава островками.
    paint(m, bx(4), mz.by(20), bx(6) + 2, mz.by(21) + 2, '"', 0.12)

    # Живые стены — лица стен у перекрёстков и в коридорах; мох — вразброс.
    all_faces = faces(m, 1, 3, W - 2, 130)
    rng.shuffle(all_faces)
    living = sprinkle(m, all_faces, 'w', 0.13, min_gap=4)
    rest = faces(m, 1, 3, W - 2, 130)
    rng.shuffle(rest)
    sprinkle(m, rest, 'g', 0.1, min_gap=3)
    # Факелы — в залах.
    for (x0, y0, x1, y1) in ((bx(4), mz.by(20) - 1, bx(6) + 2, mz.by(20)),
                             (bx(0), mz.by(14) - 1, bx(2) + 2, mz.by(14)),
                             (bx(6), mz.by(9) - 1, bx(9) + 2, mz.by(9)),
                             (bx(8), mz.by(1) - 1, bx(10) + 2, mz.by(1)),
                             (12, 134, 52, 135)):
        f = faces(m, x0, y0, x1, y1)
        f.sort()
        for k, (x, y) in enumerate(f):
            if k % 5 == 2:
                m.put(x, y, 't')
    # Живые стены у зала лифта — нет: лифт тихий.
    for y in range(128, H):
        for x in range(W):
            if m.g[y][x] == 'w':
                m.g[y][x] = 'g'
    print(f'  f5maze: живых стен {sum(r.count("w") for r in m.g)}, тупиков {len(de)}',
          file=sys.stderr)
    return m


# ---------------------------------------------------------------------------
# Район 2 — «Колизей» (арена, печать, лестница).
# ---------------------------------------------------------------------------

def area_arena():
    H = 100
    m = Map(H, seed=5507, cave=',')
    rng = m.rng
    # Нижний лабиринт: ряды 60…92, 12×7 ячеек.
    mz = Maze(m, 60, 12, 7)
    mz.generate((6, 6))
    mz.loops(0.2)
    mz.hall(0, 1, 2, 2)        # зал второй шахты
    mz.hall(8, 4, 10, 5)       # логово гончих
    mz.hall(3, 4, 5, 5)        # старая клеть — лифт Колизея (чинится)
    # Вход снизу: столбцы 33…35 — продолжение хода первого района.
    m.rect(33, 93, 35, H - 1)

    # Восточное крыло: лабиринт вокруг колизея, ячейки 9…11 × 0…9 (ряды 5…54).
    east = Maze(m, 5, 12, 10, skip={(i, j) for i in range(9) for j in range(10)})
    east.generate((10, 9))
    east.loops(0.2)
    # Связь восточного крыла с нижним лабиринтом и с преддверием арены.
    m.rect(bx(10), east.by(9) + 3, bx(10) + 2, 60)
    m.rect(44, east.by(9), bx(9) - 1, east.by(9) + 2)

    # --- Колизей: круг радиуса 11 вокруг (34, 30).
    cx, cy, R = 34, 30, 11
    for y in range(cy - R - 1, cy + R + 2):
        for x in range(cx - R - 1, cx + R + 2):
            if (x - cx) ** 2 + (y - cy) ** 2 <= R * R + 2:
                m.set(x, y, 's')
    # Колонны — по кругу радиуса 6: минотавр, врезавшись, рушит их.
    for (dx, dy) in ((-6, -3), (6, -3), (-6, 4), (6, 4)):
        m.put(cx + dx, cy + dy, '|')
    # Кости и оружие в песке — прошлые смельчаки.
    for (dx, dy, c) in ((-3, -7, 'k'), (8, 1, 'k'), (-8, 7, '/'), (3, 8, '/'), (-1, -9, '/'),
                        (9, -5, 'k'), (-9, -2, '/')):
        m.put(cx + dx, cy + dy, c)
    m.put(cx, cy + 3, 'K')
    # Ворота на юге и коридор к преддверию.
    gy = cy + R + 1
    for x in range(cx - 1, cx + 2):
        m.put(x, gy, 'G')
    m.rect(cx - 3, gy + 1, cx + 3, gy + 4)
    # Преддверие арены: табличка логова (не дальше 14 клеток от K).
    m.rect(24, gy + 5, 44, gy + 12)
    m.put(cx - 3, gy + 3, 'T')
    for (x, y, c) in ((25, gy + 12, 'p'), (43, gy + 12, 'p'), (43, gy + 5, 'x'), (26, gy + 5, 'p')):
        m.put(x, y, c)
    # Преддверие — к нижнему лабиринту.
    m.rect(33, gy + 13, 35, 60)

    # --- Обход к лестнице: с запада преддверия, за печатью.
    m.rect(9, gy + 8, 23, gy + 10)            # коридор на запад
    for y in range(gy + 8, gy + 11):
        m.put(21, y, 'S')
    m.rect(8, 6, 10, gy + 10)                 # на север вдоль стены
    m.rect(8, 4, 30, 6)                       # на восток к комнате лестницы
    m.rect(26, 3, 42, 11)                     # комната лестницы
    m.put(34, 7, '>')
    for (x, y, c) in ((27, 10, 'x'), (41, 4, 'p'), (27, 4, 'p'), (41, 10, 'x')):
        m.put(x, y, c)

    # --- Лифт Колизея: в зале старой клети, в стороне от преддверия.
    m.floor(bx(4) + 1, mz.by(4) + 4, 'E')
    m.put(bx(3) + 1, mz.by(4) + 1, 'T')
    for (x, y, c) in ((bx(3), mz.by(5) + 2, 'C'), (bx(5) + 2, mz.by(4), 'B')):
        m.put(x, y, c)

    # --- Шахта второго района.
    m.wall_obj(bx(1) + 1, mz.by(1) - 1, 'M')
    m.put(bx(2) + 2, mz.by(2) + 2, 'T')
    # Логова гончих и засада.
    m.put(bx(9) + 1, mz.by(4) + 3, 'R')
    m.put(bx(10) + 1, east.by(3) + 1, 'R')
    m.put(bx(6) + 1, mz.by(3) + 1, 'a')
    for (x, y) in ((bx(2) + 3, mz.by(4) + 1), (bx(7) + 1, mz.by(0) - 1),
                   (bx(11) + 1, east.by(6) - 1)):
        m.burrow(x, y)

    # Трава в тупиках, горшки, кости.
    de = mz.dead_ends() + east.dead_ends()
    rng.shuffle(de)
    for k, (i, j, x, y) in enumerate(de):
        if m.g[y + 1][x + 1] != '.':
            continue
        # Зал старой клети не захламляем.
        if 3 <= i <= 5 and 4 <= j <= 5:
            continue
        if k % 3 == 0:
            paint(m, x, y, x + 2, y + 2, '"', 0.85)
        elif k % 3 == 1:
            m.put(x + 1, y + 1, 'x')
        else:
            m.put(x + 1, y + 1, 'p')

    # Стены арены — трибуны; факелы по кругу через четыре клетки.
    ring = []
    for y in range(cy - R - 2, cy + R + 3):
        for x in range(cx - R - 2, cx + R + 3):
            if m.g[y][x] != '#':
                continue
            if any(m.get(x + dx, y + dy) in 's|k/KG'
                   for dx, dy in ((0, 1), (1, 0), (-1, 0), (0, -1))):
                ring.append((x, y))
    for (x, y) in ring:
        if m.get(x, y + 1) in 's|k/' and (x - cx) % 4 == 2:
            m.put(x, y, 't')
        else:
            m.put(x, y, 'h')

    all_faces = faces(m, 1, 55, W - 2, 94) + faces(m, 44, 3, W - 2, 55)
    rng.shuffle(all_faces)
    sprinkle(m, all_faces, 'w', 0.16, min_gap=4)
    rest = faces(m, 1, 3, W - 2, 94)
    rng.shuffle(rest)
    sprinkle(m, rest, 'g', 0.1, min_gap=3)
    # Факелы в преддверии и у лестницы.
    for (x0, y0, x1, y1) in ((24, gy + 4, 44, gy + 5), (26, 2, 42, 3)):
        for k, (x, y) in enumerate(sorted(faces(m, x0, y0, x1, y1))):
            if k % 4 == 1:
                m.put(x, y, 't')
    print(f'  f5arena: живых стен {sum(r.count("w") for r in m.g)}', file=sys.stderr)
    return m


if __name__ == '__main__':
    a = area_maze()
    b = area_arena()
    ra = check(a, 'f5maze')
    rb = check(b, 'f5arena')
    if '--show' in sys.argv:
        show(rb, 'B')
        show(ra, 'A')
    write_floor(5, {'MAP_F5_MAZE': ra, 'MAP_F5_ARENA': rb},
                note='Район 1 — «Живой лабиринт» (вход), район 2 — «Колизей» (арена).')
