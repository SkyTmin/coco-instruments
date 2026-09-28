"""Этаж 7 «Зеркальный лабиринт» — карта (v2.81, второй заход).

Мотив — подземелье с зеркальными двойниками: брошенный зеркальный дворец
под землёй. Зеркала на стенах, стеклянные колонны, осколки на полу,
холодный свет, лабиринт с обманками: часть «проходов» — отражения (стена,
которая выглядит проходом), часть стен — наоборот, отражение, сквозь
которое можно пройти; пустые рамы, из которых выходят тени; зеркала-
переходы парами одного цвета.

Три района снизу вверх:
  f7        — «Галерея отражений»: вестибюль с лифтом, Длинная галерея,
              крылья (Зал портретов и Будуар), Зал большого зеркала
              (событие: разбей зеркало — за ним тайник, из осколков лезут
              отражения), Северный коридор рам, кладовая с шахтой,
              служебный ход вдоль восточной стены с решёткой к вестибюлю.
  f7crystal — «Хрустальный лабиринт»: лабиринт хрустальных стен с
              ложными проходами и зеркалами-переходами, пропасть со
              стеклянными мостками, поля осколков, нити паутины, Зал призм
              (событие: хрусталь запирает выходы, пока не разбиты призмы),
              шахта, притвор к третьему району, тайник за иллюзорным
              зеркалом, служебный ход с решёткой.
  f7hall    — «Зал Двойника»: коридор отражений (событие: отражение
              отстаёт и выходит из зеркала), преддверие, зеркальная арена
              Отражения героя, запечатанный ход к лестнице.

Запуск: python3 scripts/dungeon/f7.py [--show] — пишет
src/lib/dungeon-floors/f7-map.ts (руками не править). Зерно постоянное.

Свои буквы (легенда — `AreaSpec.legend` в f7.ts, у каждого района своя):
  m  зеркало на стене           g  зеркало с бликом (живой предмет)
  f  ложный проход (зеркало)    k  треснувшее зеркало
  ?  иллюзия: пол, нарисованный зеркалом (сквозь неё проходят)
  &  стена за большим зеркалом (событие её открывает)
  w  хрустальная стена          A  зеркало арены (бьётся в последней фазе)
  :  мраморная шахматка         r  ковровая дорожка
  ;  стеклянный пол             +  мозаика арены
  q  паркет ёлочкой             s  полированный чёрный камень
  x  шестигранное стекло        U  стеклянный мосток над пропастью
  F  сырой пол пещеры с ростками хрусталя
  J  дощатый пол мастерской
  *  осколки на полу (режут)    _  пропасть с отражениями (глубина)
  ^  шов хрусталя (Зал призм закрывает им выходы)
  I  стеклянная колонна         i  канделябр с холодным огнём
  j  бюст на постаменте         V  стеклянная ваза (бьётся)
  h  друза хрусталя             H  ящик зеркальных стёкол (бьётся)
  t  туалетный столик           d  портьера на стене
  N  кокон бабочек              W  узел стеклянной нити (паутина)
  z  застывший в стекле         e  мольберт под покрывалом
  p  призма на подставке        y  куча осколков
  Z  хрустальная люстра         O  пустая рама (засада тени, бьётся)
  Q  большое зеркало (бьётся — событие)
  1…4  зеркала-переходы: пара одной цифры (цвет) переносит друг в друга;
  5…8  знак пары на полу перед рамой (1 → 5, …, 4 → 8): стоят на нём
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from brush import Map, W, check, show, write_floor  # noqa: E402

FLOORISH = '.,:;r+*~?^qsxUFJ5678'


def faces(m, x0, y0, x1, y1, ok=FLOORISH):
    """Клетки стены, под которыми пол: лицо стены видно."""
    out = []
    for y in range(max(0, y0), min(m.h - 1, y1 + 1)):
        for x in range(max(1, x0), min(W - 1, x1 + 1)):
            if m.g[y][x] == '#' and m.g[y + 1][x] in ok and not m.lock[y][x]:
                out.append((x, y))
    return out


def floor_cells(m, x0, y0, x1, y1, ok='.'):
    return [(x, y) for y in range(y0, y1 + 1) for x in range(x0, x1 + 1)
            if 0 <= y < m.h and 0 <= x < W and m.g[y][x] in ok and not m.lock[y][x]]


def paint(m, x0, y0, x1, y1, ch, share=1.0, ok='.'):
    rng = m.rng
    for (x, y) in floor_cells(m, x0, y0, x1, y1, ok):
        if rng.random() < share:
            m.g[y][x] = ch


def repaint(m, x0, y0, x1, y1, frm, to):
    """Сменить пол в прямоугольнике (без случайности — карта не сдвигается)."""
    for y in range(max(0, y0), min(m.h, y1 + 1)):
        for x in range(max(0, x0), min(W, x1 + 1)):
            if m.g[y][x] in frm:
                m.g[y][x] = to


def sprinkle(m, cells, ch, share, min_gap=0):
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


def mirrors(m, x0, y0, x1, y1, share=0.85, glint=0.35, gap_every=0):
    """Зеркала на лицах стен в прямоугольнике: часть — с бликом."""
    rng = m.rng
    out = []
    for (x, y) in faces(m, x0, y0, x1, y1):
        if gap_every and x % gap_every == 0:
            continue
        if rng.random() < share:
            m.put(x, y, 'g' if rng.random() < glint else 'm')
            out.append((x, y))
    return out


def wall_obj(m, x, y, c):
    """Лампа, шахта, доска: стена, под ней пол (свои полы этажа тоже)."""
    def ok(x, y):
        return m.get(x, y) == '#' and m.get(x, y + 1) in FLOORISH and not m.lock[y][x]
    if ok(x, y):
        m.put(x, y, c)
        return
    for r in (1, 2, 3):
        for dy in (0, -1, 1):
            for dx in range(-r, r + 1):
                if ok(x + dx, y + dy):
                    print(f'  сдвиг {c} ({x},{y}) -> ({x+dx},{y+dy})', file=sys.stderr)
                    m.put(x + dx, y + dy, c)
                    return
    raise AssertionError(('no wall near', x, y, c))


def portal(m, x, y, n):
    """Рама-переход пары n и знак на полу перед ней (клеткой ниже)."""
    assert m.g[y + 1][x] in FLOORISH, ('перед рамой нет пола', x, y, n)
    m.put(x, y, str(n))
    m.put(x, y + 1, str(n + 4))


def near(m, x, y, chars):
    return any(m.get(x + dx, y + dy) in chars for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))


def bfs(rows, sx, sy, passable):
    h = len(rows)
    seen = set([(sx, sy)])
    q = [(sx, sy)]
    while q:
        x, y = q.pop()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < W and 0 <= ny < h and (nx, ny) not in seen and passable(rows[ny][nx]):
                seen.add((nx, ny))
                q.append((nx, ny))
    return seen


# ---------------------------------------------------------------------------
# Район 1 — «Галерея отражений» (вход, лифт). 112 рядов.
# ---------------------------------------------------------------------------

def area_gallery():
    H = 112
    m = Map(H, seed=7701, cave=',')

    # --- Выход наверх, в Хрустальный лабиринт: столбцы 30…33.
    m.rect(30, 0, 33, 8)

    # --- Северный коридор рам: зал с востока на запад, пустые рамы у стены.
    m.rect(6, 8, 56, 14)
    m.rect(26, 5, 37, 8)          # ниша под выходом наверх
    # Альков с зеркалом-переходом на восточном конце.
    m.rect(52, 15, 56, 18)
    # Ход к служебному коридору вдоль восточной стены.
    m.rect(57, 10, 62, 12)

    # --- Тайник за большим зеркалом (открывается событием).
    m.rect(27, 20, 37, 27, ':')
    m.put(32, 21, '$')
    m.put(28, 26, 'z')
    m.put(36, 22, 'y')
    m.put(29, 21, 'y')
    m.put(35, 26, 'V')
    # Перемычка за зеркалом: две клетки стены, которые откроет событие.
    for y in (28, 29, 30):
        for x in range(30, 35):
            m.put(x, y, '&')

    # --- Зал большого зеркала: овал с неровной кладкой.
    cx, cy = 32, 39
    for y in range(30, 49):
        for x in range(17, 48):
            dx = (x + 0.5 - cx) / 14.5
            dy = (y + 0.5 - cy) / 8.6
            if dx * dx + dy * dy <= 1 and m.g[y][x] == '#':
                m.g[y][x] = ':'
    # Прямая северная стена у зеркала: зеркало стоит на полу у стены.
    m.rect(26, 31, 38, 32, ':')
    m.put(32, 31, 'Q')
    # Колонны по кругу и канделябры.
    for (x, y) in ((22, 36), (42, 36), (22, 43), (42, 43), (27, 46), (37, 46)):
        m.put(x, y, 'I')
    for (x, y) in ((26, 32), (38, 32)):
        m.put(x, y, 'i')
    m.put(32, 44, 'Z')
    for (x, y) in ((19, 40), (45, 39)):
        m.put(x, y, 'j')

    # --- Западный путь: из зала на запад и на север к коридору рам.
    m.rect(8, 38, 18, 40)
    m.rect(8, 14, 10, 40)
    # Тупик с ложным проходом: от западного пути на запад.
    m.rect(2, 24, 7, 26)
    # Восточный путь: из зала на восток и на север.
    m.rect(46, 37, 54, 39)
    m.rect(52, 18, 54, 39)
    # Ответвление-тупик на запад с треснувшей стеной и тайником: каморка
    # стекольщика между залом и восточным путём.
    m.rect(46, 23, 51, 25)
    m.put(45, 24, '%')
    m.rect(40, 21, 44, 26, ':')
    m.put(41, 22, '$')
    m.put(43, 25, 'y')
    m.put(40, 26, 'z')
    m.protect(39, 19, 46, 28)

    # --- Крылья: Зал портретов (запад) и Будуар (восток).
    m.rect(3, 53, 26, 69, ':')
    m.rect(37, 53, 60, 69, ':')
    # Из крыльев — наверх, в зал большого зеркала.
    m.rect(20, 45, 22, 53, ':')
    m.rect(42, 45, 44, 53, ':')
    # Ниша между крыльями — за треснувшей стеной из Зала портретов.
    m.rect(29, 58, 34, 64, ':')
    m.put(27, 61, '%')
    m.put(28, 61, ':')
    m.put(31, 60, '$')
    m.put(33, 63, 'z')
    m.protect(26, 55, 36, 67)
    # Портреты: пустые рамы у северной стены Зала портретов.
    for x in (5, 9, 13, 17):
        m.put(x, 53, 'O')
    for (x, y) in ((6, 60), (11, 64), (16, 60), (23, 57)):
        m.put(x, y, 'e')
    for (x, y) in ((4, 68), (25, 68)):
        m.put(x, y, 'i')
    m.put(20, 63, 'j')
    m.put(8, 67, 'H')
    # Будуар: столики, коконы бабочек, люстра, зеркало-переход.
    for (x, y) in ((39, 54), (47, 54), (55, 54)):
        m.put(x, y, 't')
    for (x, y) in ((41, 60), (52, 63), (58, 58)):
        m.put(x, y, 'N')
    m.put(48, 61, 'Z')
    portal(m, 58, 66, 1)
    for (x, y) in ((38, 68), (59, 54)):
        m.put(x, y, 'i')
    m.put(44, 66, 'V')
    m.put(45, 66, 'V')

    # --- Длинная галерея: с востока на запад, зеркальная стена на севере.
    m.rect(3, 75, 60, 87, ':')
    paint(m, 3, 80, 60, 82, 'r', 1.0, ok=':')
    # Из галереи — в крылья.
    m.rect(12, 70, 14, 75, ':')
    m.rect(50, 70, 52, 75, ':')
    # Колонны двумя рядами и канделябры между ними.
    for x in range(8, 58, 7):
        m.put(x, 77, 'I')
        m.put(x, 85, 'I')
    for x in (11, 32, 53):
        m.put(x, 76, 'i')
    for (x, y) in ((4, 76), (59, 76), (4, 86), (59, 86)):
        m.put(x, y, 'j')
    m.put(25, 86, 'V')
    m.put(40, 86, 'V')
    m.put(31, 78, 'Z')

    # --- Вестибюль с лифтом.
    m.rect(16, 94, 45, 107, ':')
    m.rect(20, 88, 22, 94, ':')
    m.rect(41, 88, 43, 94, ':')
    paint(m, 30, 94, 32, 107, 'r', 1.0, ok=':')
    m.put(31, 102, 'E')
    m.put(26, 97, 'T')
    m.put(35, 97, 'T')
    for (x, y) in ((17, 95), (44, 95), (17, 106), (44, 106)):
        m.put(x, y, 'i')
    for (x, y) in ((22, 95), (39, 95)):
        m.put(x, y, 'j')
    for (x, y) in ((17, 101), (44, 101)):
        m.put(x, y, 'I')
    m.put(19, 106, 'V')
    m.put(42, 106, 'H')

    # --- Кладовая стекольщика: восточнее вестибюля, шахта на северной стене.
    m.rect(48, 95, 58, 106, '.')
    m.rect(46, 99, 47, 101, ':')
    for (x, y) in ((49, 105), (50, 105), (57, 105), (57, 96)):
        m.put(x, y, 'H')
    m.put(52, 105, 'e')
    m.put(55, 101, 'y')

    # --- Служебный ход вдоль восточной стены: от коридора рам к кладовой.
    # Решётка открывается только из хода — с востока.
    m.rect(61, 10, 62, 102)
    m.rect(60, 100, 60, 100, '.')
    m.put(59, 100, 'D')
    m.protect(59, 12, 60, 99)

    # Зеркала на лицах стен в залах — со щелями под колонны кладки.
    mirrors(m, 6, 4, 57, 8, share=0.9)
    mirrors(m, 17, 29, 47, 34, share=0.95, glint=0.45)
    mirrors(m, 3, 52, 26, 53, share=0.8)
    mirrors(m, 37, 52, 60, 53, share=0.85)
    mirrors(m, 3, 73, 60, 75, share=0.9, gap_every=7)
    mirrors(m, 16, 92, 45, 94, share=0.7)
    # Ложные проходы: зеркала в концах тупиков — отражают коридор.
    for (x, y) in ((1, 25), (62, 26)):
        if m.get(x, y) == '#':
            m.put(x, y, 'f')
    m.put(48, 22, 'f')       # северная стена ответвления у тайника
    m.put(3, 23, 'f')        # северная стена тупика на западе
    # Обманка в две клетки: зеркало и «ход» за ним.
    for (x, y) in ((48, 21), (3, 22)):
        if m.get(x, y) == '#' and m.get(x, y - 1) == '#':
            m.put(x, y, 'f')
    # Коконы и пустые рамы в коридоре рам.
    for x in (12, 20, 44, 50):
        m.put(x, 9, 'O')
    m.put(38, 13, 'N')
    for (x, y) in ((7, 13), (55, 13)):
        m.put(x, y, 'i')
    # Бюсты вдоль южной стены коридора рам, между ними ваза и мольберт.
    for x in (16, 28, 46):
        m.put(x, 13, 'j')
    m.put(24, 9, 'V')
    m.put(33, 13, 'e')
    # Зеркало-переход «1»: альков у коридора рам ↔ Будуар.
    portal(m, 54, 16, 1)
    m.put(56, 15, 'd')
    # Спящие отражения и засады рам.
    for (x, y) in ((14, 62), (50, 60), (40, 11), (9, 30)):
        m.put(x, y, 'R')
    # Осколки на полу у зала и в тупиках.
    paint(m, 3, 24, 7, 26, '*', 0.5, ok='.,')
    paint(m, 28, 33, 36, 35, '*', 0.25, ok=':')
    # Портьеры на стенах Будуара и зала.
    for (x, y) in faces(m, 37, 52, 60, 53):
        if m.g[y][x] == '#' and x % 5 == 1:
            m.put(x, y, 'd')
    # Доска у лифта.
    wall_obj(m, 36, 93, 'b')
    # Шахта — на северной стене кладовой.
    wall_obj(m, 53, 94, 'M')
    m.put(50, 98, 'T')
    # --- Полы залов: каждый зал узнаётся под ногами.
    repaint(m, 6, 5, 56, 18, '.', 'q')          # коридор рам и альков — паркет
    repaint(m, 27, 20, 37, 27, ':', 's')        # тайник за зеркалом
    repaint(m, 40, 21, 44, 26, ':', 's')        # каморка стекольщика
    repaint(m, 17, 30, 47, 53, ':', 's')        # Зал большого зеркала и ходы из крыльев
    repaint(m, 3, 53, 26, 69, ':', 'q')         # Зал портретов
    repaint(m, 37, 53, 60, 69, ':', 'q')        # Будуар: паркет…
    repaint(m, 40, 56, 57, 67, 'q', 'r')        # …и ковёр во всю середину
    repaint(m, 28, 58, 34, 64, ':', 's')        # ниша между крыльями
    repaint(m, 3, 70, 60, 88, ':', 'q')         # Длинная галерея: паркет, дорожка остаётся
    repaint(m, 48, 95, 58, 106, '.', 'J')       # кладовая стекольщика — доски
    return m


# ---------------------------------------------------------------------------
# Район 2 — «Хрустальный лабиринт». 104 ряда.
# ---------------------------------------------------------------------------

P = 5
X0 = 3


def bx(i):
    return X0 + P * i


class Maze:
    """Лабиринт ячеек 3×3 с проходами шириной 2–3 (как в «Лабиринте», но
    со своими залами и обманками)."""

    def __init__(self, m, y0, cols, rows, skip=(), floor=';'):
        self.m = m
        self.y0 = y0
        self.cols = cols
        self.rows = rows
        self.skip = set(skip)
        self.edges = set()
        self.floor = floor

    def by(self, j):
        return self.y0 + P * j

    def cells(self):
        return [(i, j) for j in range(self.rows) for i in range(self.cols) if (i, j) not in self.skip]

    def carve_cell(self, i, j):
        self.m.rect(bx(i), self.by(j), bx(i) + 2, self.by(j) + 2, self.floor)

    def carve_edge(self, a, b, narrow=None):
        (i0, j0), (i1, j1) = sorted([a, b])
        self.edges.add((a, b) if a < b else (b, a))
        rng = self.m.rng
        if narrow is None:
            narrow = rng.random() < 0.4
        off = rng.choice([0, 1]) if narrow else 0
        w = 2 if narrow else 3
        if j0 == j1:
            x0 = bx(i0) + 3
            y = self.by(j0) + off
            self.m.rect(x0, y, x0 + 1, y + w - 1, self.floor)
        else:
            y0 = self.by(j0) + 3
            x = bx(i0) + off
            self.m.rect(x, y0, x + w - 1, y0 + 1, self.floor)

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
                if 0 <= i + di < self.cols and 0 <= j + dj < self.rows
                and (i + di, j + dj) not in self.skip and (i + di, j + dj) not in seen
            ]
            if not nb:
                stack.pop()
                continue
            n = rng.choice(nb)
            seen.add(n)
            self.carve_cell(*n)
            self.carve_edge((i, j), n)
            stack.append(n)

    def loops(self, share):
        rng = self.m.rng
        for (i, j) in self.cells():
            for n in ((i + 1, j), (i, j + 1)):
                if n in self.skip or n[0] >= self.cols or n[1] >= self.rows:
                    continue
                e = ((i, j), n)
                if e not in self.edges and rng.random() < share:
                    self.carve_edge((i, j), n)

    def degree(self, c):
        return sum(1 for e in self.edges if c in e)

    def dead_ends(self):
        return [(i, j, bx(i), self.by(j)) for (i, j) in self.cells() if self.degree((i, j)) == 1]


def area_crystal():
    H = 104
    m = Map(H, seed=7713, cave=',')
    # Лабиринт 12×13 ячеек: ряды 33…97. Скип — зал призм, пропасть, шахта.
    hall = {(i, j) for i in range(4, 8) for j in range(5, 9)}
    chasm = {(i, j) for i in range(8, 12) for j in range(0, 3)}
    mine = {(i, j) for i in range(0, 3) for j in range(9, 11)}
    mz = Maze(m, 33, 12, 13, skip=hall | chasm | mine)
    mz.generate((6, 12))
    mz.loops(0.14)

    # --- Вход снизу: столбцы 30…33, продолжение выхода Галереи.
    m.rect(30, 98, 33, H - 1, ';')
    m.rect(bx(5), 96, bx(6) + 2, 98, ';')

    # --- Зал призм: шестигранник в середине лабиринта, выходы — швами.
    hx0, hy0, hx1, hy1 = bx(4), mz.by(5), bx(7) + 2, mz.by(8) + 2
    ccx, ccy = (hx0 + hx1) / 2 + 0.5, (hy0 + hy1) / 2 + 0.5
    for y in range(hy0 - 1, hy1 + 2):
        for x in range(hx0 - 1, hx1 + 2):
            dx = abs(x + 0.5 - ccx)
            dy = abs(y + 0.5 - ccy)
            if dx <= 9.5 and dy <= 8.5 and dx + dy * 0.6 <= 12.2:
                m.set(x, y, ';')
    # Четыре входа в зал со всех сторон — у каждого шов хрусталя.
    exits = []
    for (x0, y0, x1, y1) in ((int(ccx) - 1, hy0 - 3, int(ccx) + 1, hy0 - 2),
                             (int(ccx) - 1, hy1 + 2, int(ccx) + 1, hy1 + 3),
                             (hx0 - 3, int(ccy) - 1, hx0 - 2, int(ccy) + 1),
                             (hx1 + 2, int(ccy) - 1, hx1 + 3, int(ccy) + 1)):
        m.rect(x0, y0, x1, y1, '^')
        exits.append((x0, y0, x1, y1))
    # Пятачки за швами — чтобы вход не упирался в стену ячейки.
    m.rect(int(ccx) - 1, hy0 - 5, int(ccx) + 1, hy0 - 4, ';')
    m.rect(int(ccx) - 1, hy1 + 4, int(ccx) + 1, hy1 + 5, ';')
    m.rect(hx0 - 5, int(ccy) - 1, hx0 - 4, int(ccy) + 1, ';')
    m.rect(hx1 + 4, int(ccy) - 1, hx1 + 5, int(ccy) + 1, ';')
    # Внутри: призмы на подставках, друзы, мозаика из стекла.
    for (dx, dy) in ((-6, -4), (6, -4), (-6, 4), (6, 4)):
        m.put(int(ccx) + dx, int(ccy) + dy, 'p')
    for (dx, dy) in ((0, -6), (0, 6), (-8, 0), (8, 0)):
        m.put(int(ccx) + dx, int(ccy) + dy, 'h')
    m.put(int(ccx), int(ccy), 'Z')

    # --- Пропасть со стеклянными мостками (северо-восток лабиринта).
    # Восточный край пропасти — не у служебного хода: столбец 60 — порода.
    px0, py0, px1, py1 = bx(8), mz.by(0), bx(11) + 1, mz.by(2) + 2
    m.rect(px0, py0, px1, py1, '_')
    # Мостки: ряд и столбец стекла через провал, островок с друзой.
    mid_y = (py0 + py1) // 2
    for x in range(px0, px1 + 1):
        m.g[mid_y][x] = ';'
    m.g[mid_y + 1][px0 + 3] = ';'
    for y in range(py0, py1 + 1):
        m.g[y][px0 + 7] = ';'
    for (x, y) in ((px0 + 11, py0 + 2), (px0 + 12, py0 + 2), (px0 + 11, py0 + 3), (px0 + 12, py0 + 3)):
        m.g[y][x] = ';'
    m.g[py0 + 4][px0 + 12] = ';'
    m.g[py0 + 5][px0 + 12] = ';'
    m.put(px0 + 12, py0 + 2, 'h')
    m.put(px0 + 11, py0 + 3, 'y')
    # Конец мостка у восточной стены — ящик стёкол: заглянувший не зря.
    m.put(px1, mid_y, 'H')
    # Входы в пропасть из лабиринта: с запада и снизу.
    m.rect(px0 - 2, mid_y - 1, px0 - 1, mid_y + 1, ';')
    m.rect(px0 + 6, py1 + 1, px0 + 8, py1 + 2, ';')

    # --- Шахта хрустального лабиринта: зал на западе.
    sx0, sy0 = bx(0), mz.by(9)
    m.rect(sx0, sy0, bx(2) + 2, mz.by(10) + 2, '.')
    m.rect(bx(2) + 3, mz.by(10), bx(2) + 4, mz.by(10) + 2, ';')
    wall_obj(m, bx(1) + 1, sy0 - 1, 'M')
    m.put(bx(2) + 1, mz.by(10) + 1, 'T')
    for (x, y) in ((sx0, mz.by(10) + 2), (sx0 + 1, mz.by(10) + 2)):
        m.put(x, y, 'H')

    # --- Притвор: широкий зал к выходу в третий район.
    m.rect(12, 12, 51, 27, ';')
    m.rect(30, 0, 33, 12, ';')
    m.rect(26, 7, 37, 11, ';')
    # Связь притвора с лабиринтом: три хода вниз.
    for x0 in (bx(2), bx(6), bx(9)):
        m.rect(x0, 28, x0 + 2, 33, ';')
    for (x, y) in ((15, 14), (48, 14), (15, 25), (48, 25), (24, 19), (39, 19)):
        m.put(x, y, 'h')
    for (x, y) in ((20, 13), (43, 13)):
        m.put(x, y, 'i')
    m.put(31, 18, 'Z')
    m.put(28, 9, 'T')
    m.put(18, 22, 'I')
    m.put(45, 22, 'I')
    paint(m, 12, 22, 20, 27, '*', 0.4, ok=';')
    m.put(13, 26, 'z')

    # --- Служебный ход вдоль восточной стены: от притвора вниз ко входу.
    m.rect(52, 16, 62, 18, ';')
    m.rect(61, 16, 62, 99, ';')
    m.rect(34, 99, 60, 99, ';')
    m.put(60, 99, 'D')
    m.put(60, 98, '#')
    m.protect(58, 18, 60, 98)

    # --- Тайник за иллюзорным зеркалом: тупик лабиринта на западе.
    # Верхний ряд лабиринта, под притвором: северная стена ячейки — зеркало,
    # сквозь которое проходят; за ним каморка в породе между ходами наверх.
    de = mz.dead_ends()
    de.sort(key=lambda c: (c[2], c[3]))
    secret = None
    for i in (4, 3, 5):
        x, y = bx(i), mz.by(0)
        if m.g[y][x + 1] == ';' and m.g[y - 1][x + 1] == '#':
            secret = (i, 0, x, y)
            break
    if secret:
        _, _, x, y = secret
        m.put(x + 1, y - 1, '?')
        m.rect(x - 1, 29, x + 3, 31, ';')
        m.put(x + 1, 29, '$')
        m.put(x - 1, 31, 'y')
        m.put(x + 3, 29, 'h')
        m.protect(x - 2, 28, x + 4, 32)

    # --- Обманки: ложные проходы в концах тупиков, зеркала на лицах стен.
    rng = m.rng
    fakes = 0
    for (i, j, x, y) in de:
        if secret and (i, j) == secret[:2]:
            continue
        # Лицо стены над тупиком (северная стена ячейки).
        if m.g[y - 1][x + 1] == '#' and fakes < 7 and rng.random() < 0.7:
            m.put(x + 1, y - 1, 'f')
            # Вторая клетка «хода» — только если за ней сплошная порода:
            # иначе обманка упрётся в пропасть или в соседний ход.
            if m.g[y - 2][x + 1] == '#' and m.g[y - 3][x + 1] == '#':
                m.put(x + 1, y - 2, 'f')
            fakes += 1
        elif m.g[y + 2][x + 1] in ';' and rng.random() < 0.6:
            m.put(x + 1, y + 1, '*')
            m.put(x, y + 2, '*') if m.g[y + 2][x] == ';' else None
    print(f'  f7crystal: ложных проходов {fakes}', file=sys.stderr)

    # Хрустальные стены — вся порода лабиринта, лицом к полу.
    for y in range(28, 99):
        for x in range(1, W - 1):
            if m.g[y][x] == '#' and near(m, x, y, ';.*^'):
                m.g[y][x] = 'w'
    # Зеркала — на части лиц хрусталя (и в зале призм — все).
    for y in range(28, 99):
        for x in range(1, W - 1):
            if m.g[y][x] != 'w' or m.g[y + 1][x] not in ';.*^':
                continue
            inhall = abs(x + 0.5 - ccx) <= 11 and abs(y + 0.5 - ccy) <= 10
            if inhall or rng.random() < 0.22:
                m.g[y][x] = 'g' if rng.random() < 0.35 else 'm'
    # Зеркала притвора.
    mirrors(m, 12, 8, 51, 12, share=0.85)
    # Нити паутины: узлы в узких проходах (2 клетки) лабиринта.
    webs = 0
    for y in range(34, 96):
        for x in range(4, 60):
            if m.g[y][x] != ';' or webs >= 9:
                continue
            horiz = m.g[y][x - 1] in 'wmg' and m.g[y][x + 2] in 'wmg' and m.g[y][x + 1] == ';'
            vert = m.g[y - 1][x] in 'wmg' and m.g[y + 2][x] in 'wmg' and m.g[y + 1][x] == ';'
            if (horiz or vert) and rng.random() < 0.05:
                m.put(x, y, 'W')
                webs += 1
    print(f'  f7crystal: узлов паутины {webs}', file=sys.stderr)
    # Друзы, осколки и коконы в тупиках.
    for k, (i, j, x, y) in enumerate(de):
        if secret and (i, j) == secret[:2]:
            continue
        if m.g[y + 1][x + 1] != ';':
            continue
        if k % 3 == 0:
            m.put(x + 1, y + 1, 'h')
        elif k % 3 == 1:
            m.put(x + 1, y + 1, 'y')
        else:
            m.put(x + 1, y + 1, 'N')
    # Зеркала-переходы: «2» — юго-запад ↔ северо-восток, «3» — у шахты ↔ у пропасти.
    portal(m, bx(0) + 1, mz.by(12) + 1, 2)
    portal(m, bx(11) + 1, mz.by(4) + 1, 2)
    portal(m, bx(2) + 1, mz.by(8) + 1, 3)
    portal(m, bx(7) + 1, mz.by(3) + 1, 3)
    # Спящие големы среди друз и засады пауков.
    for (i, j) in ((1, 3), (10, 7), (3, 11), (9, 11)):
        m.put(bx(i) + 1, mz.by(j) + 1, 'R')
    m.put(28, 22, 'R')
    # --- Полы: зал призм — шестигранное стекло, притвор — чёрный камень,
    # мостки — стекло над тьмой, тупики и шахта — сырой пол пещеры.
    repaint(m, hx0 - 1, hy0 - 1, hx1 + 1, hy1 + 1, ';', 'x')
    repaint(m, 12, 0, 51, 27, ';', 's')
    repaint(m, px0, py0, px1, py1, ';', 'U')
    for (x, y) in ((px0 + 11, py0 + 2), (px0 + 12, py0 + 2), (px0 + 11, py0 + 3), (px0 + 12, py0 + 3)):
        if m.g[y][x] == 'U':
            m.g[y][x] = 'F'
    repaint(m, sx0, sy0, bx(2) + 2, mz.by(10) + 2, '.', 'F')
    for (i, j, x, y) in de:
        if secret and (i, j) == secret[:2]:
            continue
        if m.g[y - 1][x + 1] == 'f':
            continue      # ложный проход отражает стеклянный пол — пусть тупик будет таким же
        repaint(m, x, y, x + 2, y + 2, ';', 'F')
    for (i, j) in ((1, 3), (10, 7), (3, 11), (9, 11)):
        repaint(m, bx(i), mz.by(j), bx(i) + 2, mz.by(j) + 2, ';', 'F')
    return m


# ---------------------------------------------------------------------------
# Район 3 — «Зал Двойника». 72 ряда.
# ---------------------------------------------------------------------------

def area_hall():
    H = 72
    m = Map(H, seed=7727, cave=',')
    # --- Вход снизу: столбцы 30…33.
    m.rect(30, 60, 33, H - 1, ':')
    # --- Коридор отражений: с востока на запад, зеркальная стена на севере.
    m.rect(5, 55, 58, 59, ':')
    paint(m, 5, 57, 58, 57, 'r', 1.0, ok=':')
    # Западный поворот наверх — к преддверию.
    m.rect(5, 36, 8, 55, ':')
    # Восточный поворот наверх — к боковому залу и запечатанному ходу.
    m.rect(55, 38, 58, 55, ':')
    # Боковой ход на востоке: ложный проход в тупике и треснувшая стена —
    # за ней каморка с тайником.
    m.rect(50, 43, 54, 45, ':')
    m.put(52, 42, 'f')
    m.put(52, 41, 'f')
    m.put(49, 44, '%')
    m.rect(42, 41, 48, 47, ':')
    m.put(43, 42, '$')
    m.put(47, 46, 'y')
    m.put(42, 47, 'z')
    m.put(45, 41, 'i')
    m.protect(41, 39, 50, 49)
    # --- Преддверие арены.
    m.rect(5, 32, 46, 38, ':')
    m.rect(47, 34, 58, 37, ':')       # связь с восточным поворотом
    m.put(29, 33, 'T')
    for (x, y) in ((12, 33), (22, 33), (40, 33)):
        m.put(x, y, 'i')
    for (x, y) in ((9, 37), (44, 37)):
        m.put(x, y, 'j')
    # --- Арена: восьмиугольник с зеркальными стенами.
    cx, cy = 32, 16
    for y in range(3, 30):
        for x in range(16, 49):
            dx = abs(x + 0.5 - cx)
            dy = abs(y + 0.5 - cy)
            if dx <= 14.5 and dy <= 12.5 and dx + dy <= 21:
                m.set(x, y, '+')
    m.put(cx, cy + 5, 'K')
    for (dx, dy) in ((-8, -6), (8, -6), (-8, 6), (8, 6)):
        m.put(cx + dx, cy + dy, 'I')
    m.put(cx, cy - 2, 'Z')
    # Ворота на юге и короткий ход к преддверию.
    gy = 29
    for x in range(cx - 1, cx + 2):
        m.put(x, gy, 'G')
    m.rect(cx - 1, gy + 1, cx + 1, 31, ':')
    # Стены арены — зеркала.
    for y in range(1, 31):
        for x in range(13, 52):
            if m.g[y][x] == '#' and near(m, x, y, '+IKZ'):
                m.put(x, y, 'A')
    # --- Запечатанный ход к лестнице: с востока преддверия наверх.
    m.rect(55, 6, 58, 33, ':')
    for x in range(55, 59):
        m.put(x, 26, 'S')
    m.rect(52, 3, 61, 10, ':')
    m.put(57, 5, '>')
    for (x, y, c) in ((53, 4, 'y'), (60, 9, 'i'), (53, 9, 'V')):
        m.put(x, y, c)
    # Зеркала коридора отражений и преддверия.
    mirrors(m, 5, 53, 58, 55, share=1.0, glint=0.4)
    mirrors(m, 5, 30, 46, 32, share=0.8)
    # Зеркало-переход «4»: преддверие ↔ начало коридора отражений.
    portal(m, 6, 33, 4)
    portal(m, 34, 57, 4)
    m.put(56, 58, 'O')
    m.put(10, 58, 'O')
    for (x, y) in ((20, 58), (44, 58)):
        m.put(x, y, 'I')
    # --- Полы: коридор, повороты и ход к лестнице — чёрный камень, каморка —
    # паркет, преддверие — мраморная шахматка, арена — мозаика.
    repaint(m, 5, 55, 58, 71, ':', 's')
    repaint(m, 5, 39, 8, 55, ':', 's')
    repaint(m, 50, 38, 58, 55, ':', 's')
    repaint(m, 42, 41, 48, 47, ':', 'q')
    repaint(m, 52, 3, 61, 31, ':', 's')
    return m


def verify(ra, rb, rc):
    """Проверки карты: сквозной путь, печать закрывает лестницу."""
    rows = rc + rb + ra   # мир: сверху самый глубокий район
    top_b = len(rc)
    top_a = len(rc) + len(rb)
    lift = [(x, y) for y, r in enumerate(rows) for x, c in enumerate(r) if c == 'E'][0]
    walk = set(".,:;r+*~?^qsxUFJ5678EIijVhHtNWzepyZOQ$T1234RKGDS%>")

    def passable(c):
        return c in walk or c == 'l'
    seen = bfs(rows, lift[0], lift[1], passable)
    k = [(x, y) for y, r in enumerate(rows) for x, c in enumerate(r) if c == 'K'][0]
    assert k in seen, 'до логова не дойти'
    stairs = [(x, y) for y, r in enumerate(rows) for x, c in enumerate(r) if c == '>'][0]
    assert stairs in seen, 'до лестницы не дойти'
    sealed = bfs(rows, lift[0], lift[1], lambda c: passable(c) and c != 'S')
    assert stairs not in sealed, 'лестница мимо печати'
    for y, r in enumerate(rows):
        for x, c in enumerate(r):
            if c == 'M':
                assert (x, y + 1) in seen, ('шахта', x, y)
    print(f'  стыки: галерея с {top_a}, хрусталь с {top_b}; путь есть', file=sys.stderr)


# ---------------------------------------------------------------------------
# Спрайты (--sprites): голем из тайла DCSS (CC0), перекрашенный в стекло.
# ---------------------------------------------------------------------------

DCSS = 'https://raw.githubusercontent.com/crawl/crawl/master/crawl-ref/source/rltiles/'
GOLEM_SRC = 'mon/nonliving/crystal_guardian'
FW, FH = 40, 40
GLASS = [
    (12, 14, 24),     # 0 контур
    (22, 34, 62),     # 1 сердцевина (густая тень)
    (40, 66, 104),    # 2 тень
    (70, 112, 156),   # 3 основа
    (116, 164, 204),  # 4 свет
    (178, 220, 242),  # 5 блик
    (238, 250, 255),  # 6 искра
]


def fetch(path):
    import urllib.request
    cache = os.path.join(os.path.dirname(__file__), '.f7src')
    os.makedirs(cache, exist_ok=True)
    local = os.path.join(cache, path.replace('/', '__') + '.png')
    if not os.path.exists(local):
        with urllib.request.urlopen(DCSS + path + '.png', timeout=30) as r:
            open(local, 'wb').write(r.read())
    return local


def glassify(im):
    """Постеризовать в палитру стекла этажа: тон по яркости, кант света
    сверху-слева и тень снизу-справа — по краю фигуры."""
    from PIL import Image
    w, h = im.size
    tone = {}
    for y in range(h):
        for x in range(w):
            r, g, b, a = im.getpixel((x, y))
            if a < 128:
                continue
            lum = 0.3 * r + 0.55 * g + 0.15 * b
            tone[(x, y)] = (0 if lum < 12 else 1 if lum < 70 else 2 if lum < 118 else
                            3 if lum < 160 else 4 if lum < 205 else 5 if lum < 240 else 6)
    out = Image.new('RGBA', im.size, (0, 0, 0, 0))

    def solid(x, y):
        return tone.get((x, y), 0) > 0

    for (x, y), k in tone.items():
        if 1 < k < 6 and (not solid(x - 1, y) or not solid(x, y - 1)):
            k += 1
        elif k > 2 and (not solid(x + 1, y) or not solid(x, y + 1)):
            k -= 1
        out.putpixel((x, y), GLASS[k] + (255,))
    return out


def parts_of(im):
    """Разрезать фигуру на части: каждый пиксель — ровно в одной части."""
    from PIL import Image
    names = ['head', 'arm_l', 'arm_r', 'body', 'leg_l', 'leg_r']
    out = {n: Image.new('RGBA', im.size, (0, 0, 0, 0)) for n in names}
    for y in range(im.height):
        for x in range(im.width):
            px = im.getpixel((x, y))
            if px[3] == 0:
                continue
            if y <= 8 and 11 <= x <= 22:
                n = 'head'
            elif x <= 10 and 8 <= y <= 18:
                n = 'arm_l'
            elif x >= 23 and 8 <= y <= 24:
                n = 'arm_r'
            elif y <= 18:
                n = 'body'
            elif x <= 16:
                n = 'leg_l'
            else:
                n = 'leg_r'
            out[n].putpixel((x, y), px)
    return out


def golem_sheet(out_path):
    """Лист голема: покой ×2, шаг ×4, замах, удар, боль — кадры 40×40, ноги внизу."""
    from PIL import Image
    base = glassify(Image.open(fetch(GOLEM_SRC)).convert('RGBA'))
    # Части фигуры (по картинке 32×32): голова, левая рука, правая рука-плита,
    # туловище, левая и правая нога.
    pt = parts_of(base)
    head, arm_l, arm_r, body = pt['head'], pt['arm_l'], pt['arm_r'], pt['body']
    leg_l, leg_r = pt['leg_l'], pt['leg_r']

    def compose(parts):
        fr = Image.new('RGBA', (FW, FH), (0, 0, 0, 0))
        for im, dx, dy in parts:
            fr.alpha_composite(im, (4 + dx, 7 + dy))
        return fr

    frames = []
    # Покой: дыхание — верх на пиксель.
    for up in (0, -1):
        frames.append(compose([(leg_l, 0, 0), (leg_r, 0, 0), (body, 0, up), (head, 0, up),
                               (arm_l, 0, up), (arm_r, 0, up)]))
    # Шаг: ноги по очереди на два пикселя, руки маятником — у махины шаг
    # тяжёлый, и в одну точку его не было видно.
    for k in range(4):
        ll = (0, -2, 0, 1)[k]
        rr = (0, 1, 0, -2)[k]
        bob = (0, -1, 0, -1)[k]
        sw = (0, 2, 0, -2)[k]
        frames.append(compose([(leg_l, 0, ll), (leg_r, 0, rr), (body, 0, bob), (head, 0, bob),
                               (arm_l, 0, bob + sw), (arm_r, 0, bob - sw)]))
    # Замах: обе руки высоко вверх, корпус откинут, голова запрокинута.
    frames.append(compose([(leg_l, -1, 0), (leg_r, 1, 0), (body, 0, -2), (head, 0, -2),
                           (arm_l, -2, -8), (arm_r, 2, -8)]))
    # Удар: руки обрушены вперёд и вниз, корпус присел, ноги расставлены.
    frames.append(compose([(leg_l, -2, 0), (leg_r, 2, 0), (body, 0, 3), (head, 0, 4),
                           (arm_l, 3, 6), (arm_r, -3, 5)]))
    # Боль: откинулся назад.
    frames.append(compose([(leg_l, 0, 0), (leg_r, 0, 0), (body, 2, 0), (head, 3, -1),
                           (arm_l, 3, -2), (arm_r, 2, 2)]))
    sheet = Image.new('RGBA', (FW * len(frames), FH), (0, 0, 0, 0))
    for i, fr in enumerate(frames):
        sheet.alpha_composite(fr, (i * FW, 0))
    sheet.save(out_path)
    print('записано', out_path, sheet.size, file=sys.stderr)


if __name__ == '__main__' and '--sprites' in sys.argv:
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
    outd = os.path.join(root, 'public', 'dungeon', 'f7')
    os.makedirs(outd, exist_ok=True)
    golem_sheet(os.path.join(outd, 'golem.png'))
    sys.exit(0)

if __name__ == '__main__':
    a = area_gallery()
    b = area_crystal()
    c = area_hall()
    ra = check(a, 'f7')
    rb = check(b, 'f7crystal')
    rc = check(c, 'f7hall')
    if '--show' in sys.argv:
        show(rc, 'C')
        show(rb, 'B')
        show(ra, 'A')
    verify(ra, rb, rc)
    write_floor(7, {'MAP_F7_GALLERY': ra, 'MAP_F7_CRYSTAL': rb, 'MAP_F7_HALL': rc},
                note='Район 1 — «Галерея отражений» (вход), 2 — «Хрустальный лабиринт», '
                     '3 — «Зал Двойника» (арена).')
