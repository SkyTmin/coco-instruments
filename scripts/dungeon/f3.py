"""Этаж 3 «Затопленная бездна» — карта (v2.81).

Вертикальная бездна: снизу вверх (в мире — с юга на север) герой уходит
всё глубже. Два района:

  f3rim   «Край Бездны» — вход: причал у лифта, бирюзовый грот с омутом,
          развилка (затопленная галерея на западе, сухие уступы на
          востоке), решётка-ходок к лифту, и Великий обрыв — пропасть с
          узкими мостками, над которой летают пересмешники;
  f3depth «Затопленные уступы» — водопады, Эхо-зал с омутами и засадой,
          вторая шахта, лагерь пропавшей экспедиции, Алый берег у ворот
          арены, арена-озеро Алой пасти и за ней — печать и спуск ниже.

Свои буквы (легенда — `AreaSpec.legend` в `f3.ts`):
  w  вода (глубина)          p  омут: вода, где живёт омутник
  s  мелководье (вязнет)     A  пропасть (глубина)
  H  мостки поперёк          I  мостки вдоль
  k  бирюзовая друза (свет)  q  фиолетовая друза (свет)
  d  друза, которую бьют     g  родник (снимает тягу бездны)
  h  отмель арены (заливает прилив)       r  озеро арены (глубина)
  W  водопад по стене        j  светляки под сводом (свет)
  x  кости экспедиции        U  древний столб

Запуск: `python3 scripts/dungeon/f3.py` (печать карты: `--show`).
Карта постоянная: зерно фиксировано, повторный запуск даёт тот же файл.
"""
import os
import sys
from collections import deque

sys.path.insert(0, os.path.dirname(__file__))
from brush import W, Map, check, show, write_floor  # noqa: E402

FLOORS = set('.,~!=') | set('sHIkqdghjxUCBXnvcPlu$TKE@aR>')
WALKABLE_TILE = set('.,~!=sHIhjxgkqdCBXnvcPluT$KEaR@>U')
# Предметы с телом (сквозь них не пройти): для проверки узких мест.
SOLID_OBJ = set('kqdUCBXnvcPlu$T')


def open_cell(ch):
    return ch in WALKABLE_TILE or ch in 'GDS%'


# ---------------------------------------------------------------------------
# Свои кисти.
# ---------------------------------------------------------------------------


def fill_in(m, shape_test, c, only='.,'):
    """Заменить пол внутри фигуры на букву `c` (стены не трогаем)."""
    for y in range(m.h):
        for x in range(W):
            if m.g[y][x] in only and shape_test(x, y):
                m.g[y][x] = c


def ell_test(cx, cy, rx, ry, rough=0.0, m=None, seed=0):
    import math
    ph = [0.7 * seed, 1.9 * seed, 2.3 * seed]

    def t(x, y):
        dx = (x + 0.5 - cx) / rx
        dy = (y + 0.5 - cy) / ry
        a = math.atan2(dy, dx)
        k = 1 + rough * (0.5 * math.sin(3 * a + ph[0]) + 0.3 * math.sin(5 * a + ph[1])
                         + 0.2 * math.sin(7 * a + ph[2]))
        return dx * dx + dy * dy <= k * k
    return t


def rim(m, inner, c, around='w'):
    """Кайма: клетки пола `inner`, соседние с `around`, — буквой `c`."""
    add = []
    for y in range(1, m.h - 1):
        for x in range(1, W - 1):
            if m.g[y][x] not in inner:
                continue
            if any(m.g[y + dy][x + dx] in around
                   for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                add.append((x, y))
    for x, y in add:
        m.g[y][x] = c


def scatter(m, c, n, box, rng, need='.,', clear=1, avoid=''):
    """Разбросать `n` предметов по полу в прямоугольнике, не впритык."""
    x0, y0, x1, y1 = box
    placed = 0
    tries = 0
    while placed < n and tries < 4000:
        tries += 1
        x = rng.randint(x0, x1)
        y = rng.randint(y0, y1)
        if not (0 < x < W - 1 and 0 <= y < m.h):
            continue
        if m.g[y][x] not in need or m.lock[y][x]:
            continue
        ok = True
        for dy in range(-clear, clear + 1):
            for dx in range(-clear, clear + 1):
                ch = m.get(x + dx, y + dy)
                if ch in 'kqdgxUCBEMKGTS>' or ch in avoid:
                    ok = False
        if not ok:
            continue
        m.put(x, y, c)
        placed += 1
    return placed


def burrow(m, x, y):
    """Нора: стена, рядом пол (в том числе мелководье). Ищем ближайшее место."""
    def ok(x, y):
        return (m.get(x, y) == '#' and not m.lock[y][x] and 0 < x < W - 1 and any(
            m.get(x + dx, y + dy) in '.,s' for dx, dy in ((0, 1), (1, 0), (-1, 0), (0, -1))))
    for r in range(0, 7):
        for dx, dy in ((0, 0), (-r, 0), (r, 0), (0, -r), (0, r), (-r, -r), (r, r), (-r, r), (r, -r)):
            if ok(x + dx, y + dy):
                m.put(x + dx, y + dy, 'o')
                return
    raise AssertionError(('нет места под нору', x, y))


def along_wall(m, c, n, box, rng, side='any'):
    """Предмет у стены (кристалл растёт из стены, а не посреди прохода)."""
    x0, y0, x1, y1 = box
    placed = 0
    tries = 0
    while placed < n and tries < 4000:
        tries += 1
        x = rng.randint(x0, x1)
        y = rng.randint(y0, y1)
        if m.get(x, y) not in '.,' or m.lock[y][x]:
            continue
        walls = [(dx, dy) for dx, dy in ((1, 0), (-1, 0), (0, -1), (0, 1))
                 if m.get(x + dx, y + dy) == '#']
        if not walls or len(walls) > 2:
            continue
        if side == 'north' and (0, -1) not in walls:
            continue
        # Не запирать проход: по обе стороны вдоль стены — пол.
        free = sum(1 for dx, dy in ((1, 0), (-1, 0), (0, -1), (0, 1))
                   if m.get(x + dx, y + dy) in '.,sh')
        if free < 2:
            continue
        bad = False
        for dy in range(-2, 3):
            for dx in range(-2, 3):
                if m.get(x + dx, y + dy) in 'kqdgUEMKGTS>xo':
                    bad = True
        if bad:
            continue
        m.put(x, y, c)
        placed += 1
    return placed


# ---------------------------------------------------------------------------
# Район 1: «Край Бездны» (вход).
# ---------------------------------------------------------------------------

RIM_H = 112


def build_rim():
    m = Map(RIM_H, seed=3301, cave='.')
    rng = m.rng

    # Причал у лифта (низ района): широкая пещера.
    m.ell(32, 100, 15, 7.5)
    m.rect(24, 96, 40, 104, '.', natural=False)
    # Штрек первой шахты — на запад от причала.
    m.hpath(8, 20, 99, w=3)
    m.ell(10, 97, 4, 4)
    # Решётка-ходок на восток: узкий ход к восточным уступам.
    m.hpath(46, 60, 101, w=2)
    m.vpath(60, 60, 101, w=2)

    # Проход с причала на север — в Бирюзовый грот.
    m.vpath(31, 80, 94, w=4, natural=True)

    # Бирюзовый грот: большая пещера с омутом на западе.
    m.ell(32, 72, 19, 10)
    m.ell(20, 70, 8, 6)
    m.ell(46, 74, 8, 6)
    # Тайник за трещиной — тупик под западным краем грота.
    m.vpath(14, 80, 86, w=1)
    m.ell(10, 87, 4, 2.6)

    # Развилка: запад — затопленная галерея, восток — сухие уступы.
    # Запад: галерея от грота вверх, вдоль неё канал.
    m.rect(8, 34, 16, 66, '.', natural=True)
    m.ell(12, 48, 6, 7)
    # Восток: уступы — ступени-залы, соединённые узкими ходами.
    m.ell(52, 60, 7, 5)
    m.vpath(52, 44, 56, w=3, natural=True)
    m.ell(50, 42, 8, 4.5)
    m.vpath(48, 32, 40, w=3, natural=True)
    m.ell(54, 34, 5, 3)

    # Южная кромка Великого обрыва: площадка, где сходятся оба пути.
    m.rect(8, 29, 56, 33, '.', natural=True)
    # Пропасть с мостками — рисуем полом, потом заливаем пропастью.
    m.rect(10, 7, 54, 28, '.', natural=True)
    # Северная кромка и выход наверх (стык с районом 2 — ряд 0).
    m.rect(22, 2, 42, 7, '.', natural=True)
    m.vpath(31, 0, 3, w=6)
    m.jitter(0.28, 2)

    # Пропасть: от западной стены до восточного карниза, края неровные.
    fill_in(m, lambda x, y: x <= 49 and 9 <= y <= 25, 'A')
    fill_in(m, ell_test(30, 17.5, 22, 10.5, 0.14, seed=3), 'A')
    # Мостки: вертикальные посередине (узко — два в ширину).
    for y in range(6, 30):
        for x in (31, 32):
            if m.g[y][x] == 'A':
                m.g[y][x] = 'I'
    # Восточный карниз вокруг пропасти — длинный обход по краю, в две
    # клетки: над ним кружат пересмешники, и отступать некуда.
    for y in range(9, 26):
        for x in range(50, 58):
            if m.g[y][x] in '.,':
                m.g[y][x] = 'A' if x < 51 or x > 52 else '.'
    # Островок-скала посреди пропасти у мостков — отдых перед прыжком.
    for y in (16, 17, 18):
        for x in (29, 30, 33, 34):
            if m.g[y][x] == 'A':
                m.g[y][x] = '.'

    # Омут в гроте: вода, вокруг мелководье; дальше канал галереи.
    fill_in(m, ell_test(19, 70, 5.5, 3.6, 0.2, seed=5), 'w')
    fill_in(m, lambda x, y: 10 <= x <= 12 and 36 <= y <= 64, 'w')
    fill_in(m, ell_test(12, 48, 3.2, 4.5, 0.2, seed=7), 'w')
    rim(m, '.,', 's', 'w')
    # Мелководье пошире вдоль канала: по галерее идут по щиколотку в воде.
    fill_in(m, lambda x, y: 8 <= x <= 14 and 36 <= y <= 64, 's')
    # Омуты — дом омутников.
    for x, y in ((19, 70), (11, 44), (11, 58)):
        m.g[y][x] = 'p'
        m.lock[y][x] = True

    # --- Предметы. ---
    m.floor(32, 101, 'E')
    # Родник у лифта: здесь тяга бездны сходит быстрее всего.
    m.floor(26, 99, 'g')
    # Первая шахта: над штреком на западе.
    m.wall_obj(9, 93, 'M')
    m.wall_obj(28, 92, 'L')
    m.wall_obj(37, 92, 'L')
    m.floor(22, 103, 'l')
    m.floor(43, 97, 'l')
    m.floor(38, 103, 'C')
    m.floor(39, 104, 'B')
    m.floor(25, 104, 'C')
    # Решётка ходка: открывается с востока (изнутри ходка).
    m.put(46, 101, 'D')
    m.put(46, 100, '#')

    # Грот: друзы, светляки, родник.
    along_wall(m, 'k', 7, (14, 62, 50, 82), rng)
    along_wall(m, 'q', 3, (26, 62, 50, 82), rng)
    scatter(m, 'd', 3, (24, 66, 46, 80), rng, clear=2)
    m.floor(40, 70, 'j')
    m.floor(28, 64, 'j')
    m.floor(44, 79, 'g')
    # Треснувшая стена к тайнику: в самом верху хода, под полом грота.
    y = 79
    while m.g[y][14] not in '.,s':
        y -= 1
    m.put(14, y + 1, '%')
    m.put(13, y + 1, '#')
    m.put(15, y + 1, '#')
    for yy in range(y + 2, 87):
        m.g[yy][14] = '.'
    m.floor(8, 87, '$')
    m.floor(11, 88, 'x')

    # Галерея: кости, светляки, фонари экспедиции (погашенные).
    m.floor(14, 40, 'x')
    m.floor(9, 60, 'u')
    m.floor(15, 36, 'u')
    m.floor(13, 52, 'j')

    # Уступы: друзы, ящики экспедиции, засада.
    along_wall(m, 'k', 4, (44, 30, 60, 64), rng)
    m.floor(56, 60, 'C')
    m.floor(49, 44, 'u')
    m.floor(50, 58, 'a')
    m.floor(49, 40, 'R')

    # Кромка обрыва: кости тех, кто поднимался слишком быстро.
    m.floor(20, 31, 'x')
    m.floor(44, 32, 'x')
    m.floor(30, 31, 'l')
    m.floor(26, 4, 'u')
    along_wall(m, 'q', 2, (22, 2, 42, 7), rng)
    m.floor(52, 12, 'a')
    m.floor(32, 30, 'g')

    # Норы-расселины: из них лезут твари бездны.
    for x, y in ((24, 94), (41, 95), (16, 64), (47, 67), (30, 62), (38, 82), (8, 40),
                 (15, 56), (57, 58), (45, 42), (59, 34), (12, 30), (50, 30), (24, 3),
                 (40, 3), (46, 36), (6, 50)):
        burrow(m, x, y)
    # Спящие стаи.
    m.floor(36, 66, 'R')
    m.floor(12, 34, 'R')
    return m


# ---------------------------------------------------------------------------
# Район 2: «Затопленные уступы» (арена).
# ---------------------------------------------------------------------------

DEPTH_H = 124


def build_depth():
    m = Map(DEPTH_H, seed=3302, cave='.')
    rng = m.rng
    H = DEPTH_H

    # Низ: вход с Края (стык — нижний ряд), уступы водопадов.
    m.vpath(31, H - 6, H - 1, w=6)
    m.ell(32, H - 12, 14, 6)
    m.ell(18, H - 18, 7, 5)
    m.ell(46, H - 20, 7, 5)

    # Эхо-зал: большой зал с омутами (засада пересмешников).
    m.ell(32, 80, 22, 13)
    m.vpath(32, 88, H - 14, w=4, natural=True)
    # Вторая шахта — в нише на западе Эхо-зала.
    m.ell(9, 78, 4, 5)
    m.hpath(9, 14, 80, w=3)

    # Лагерь пропавшей экспедиции — тупик на востоке.
    m.hpath(44, 58, 72, w=3)
    m.ell(57, 66, 4, 6)

    # От Эхо-зала вверх — два хода к Алому берегу.
    m.vpath(22, 56, 68, w=3, natural=True)
    m.vpath(42, 56, 68, w=3, natural=True)
    # Алый берег — зал перед воротами арены.
    m.ell(32, 53, 16, 5)

    # Арена: чаша с озером. Ворота — в южной стене.
    m.ell(31, 30, 19, 14, rough=0.12)
    m.jitter(0.25, 2)
    # Спуск с уступов к стыку — прямой, без зазубрин дрожи.
    m.vpath(31, H - 16, H - 1, w=4)
    # Стена между ареной и берегом — ровная, с проёмом ворот.
    m.rect(1, 45, 62, 47, '#')
    m.rect(29, 45, 34, 47, '.')

    # Боковой ход к печати: с Алого берега по восточной стене наверх.
    m.vpath(56, 8, 52, w=2)
    m.hpath(47, 56, 52, w=2)
    # Спуск ниже: за печатью пещера с лестницей.
    m.ell(44, 6, 9, 4)
    m.hpath(52, 56, 7, w=2)

    # Озеро арены и отмели вокруг.
    fill_in(m, ell_test(31, 29, 11, 7.5, 0.1, seed=11), 'r')
    rim(m, '.,', 'h', 'r')
    rim(m, '.,', 'h', 'rh')

    # Эхо-зал: два омута и мостки через протоку.
    fill_in(m, ell_test(24, 80, 5, 3.4, 0.22, seed=13), 'w')
    fill_in(m, ell_test(41, 83, 5.5, 3.2, 0.22, seed=17), 'w')
    fill_in(m, lambda x, y: 28 <= x <= 36 and 81 <= y <= 83, 'w')
    for y in (81, 82, 83):
        m.g[y][32] = 'I'
        m.g[y][33] = 'I'
    rim(m, '.,', 's', 'w')
    for x, y in ((24, 80), (41, 83)):
        m.g[y][x] = 'p'
        m.lock[y][x] = True
    # Водопады: с западной стены уступов вода падает в омут внизу.
    fill_in(m, ell_test(18, H - 17, 3.4, 2.4, 0.2, seed=19), 'w')
    rim(m, '.,', 's', 'w')
    m.g[H - 17][18] = 'p'
    m.lock[H - 17][18] = True

    # --- Предметы. ---
    # Водопад на северной стене пещеры уступов: три струи падают в протоку,
    # протока — в омут.
    top = min(y for y in range(H - 26, H) if m.g[y][18] in 'swp')
    y = top
    while m.g[y][18] != '#':
        y -= 1
    for x in (17, 18, 19):
        m.put(x, y, 'W')
        for yy in range(y + 1, top + 1):
            if m.g[yy][x] != 'p':
                m.g[yy][x] = 'w'
    # Стена по бокам струй — целая, чтобы водопад читался одним потоком.
    for x in (16, 20):
        if m.g[y][x] != '#':
            m.g[y][x] = '#'
    m.floor(32, H - 9, 'g')
    m.wall_obj(28, H - 19, 'L')
    along_wall(m, 'k', 4, (18, H - 26, 50, H - 6), rng)
    m.floor(46, H - 20, 'R')

    # Эхо-зал.
    m.wall_obj(6, 74, 'M')
    along_wall(m, 'q', 4, (12, 68, 52, 92), rng)
    along_wall(m, 'k', 4, (12, 68, 52, 92), rng)
    scatter(m, 'd', 3, (14, 70, 50, 90), rng, clear=2)
    m.floor(32, 74, 'a')
    m.floor(46, 76, 'a')
    m.floor(20, 88, 'R')
    m.floor(32, 70, 'j')
    m.floor(14, 84, 'j')
    m.floor(50, 86, 'j')
    m.floor(12, 81, 'u')
    for x, y in ((26, 70), (38, 70), (22, 90)):
        m.floor(x, y, 'U')
    # Трещина в тайник (к северо-западу Эхо-зала).
    m.hpath(4, 11, 64, w=2)
    m.vpath(10, 64, 70, w=2)
    m.put(9, 71, '%')
    m.put(10, 71, '#')
    m.put(9, 72, '.')
    m.floor(5, 64, '$')
    m.floor(7, 63, 'x')

    # Лагерь экспедиции.
    m.floor(56, 63, 'C')
    m.floor(58, 64, 'B')
    m.floor(55, 68, 'C')
    m.floor(58, 69, 'x')
    m.floor(57, 66, 'l')

    # Алый берег и спуск ниже — древние плиты (руины тех, кто спускался
    # раньше): «другой» пол района.
    fill_in(m, ell_test(32, 53, 15, 4.6), ',', only='.')
    fill_in(m, ell_test(44, 6, 8.5, 3.6), ',', only='.')
    # Алый берег: табличка у ворот, фонари, родник перед боем.
    m.floor(27, 51, 'T')
    m.floor(20, 54, 'l')
    m.floor(44, 54, 'l')
    m.floor(36, 55, 'g')
    for x, y in ((24, 50), (40, 50)):
        m.floor(x, y, 'U')
    # Ворота арены.
    for x in range(29, 35):
        for y in range(45, 48):
            m.g[y][x] = '#'
    for x in range(29, 35):
        m.put(x, 46, 'G')
        m.put(x, 45, '.')
        m.put(x, 47, '.')
    # Логово: на южной отмели, у ворот.
    m.put(31, 40, 'K')
    # Кости у кромки озера — тех, кто не успел отойти от воды.
    for x, y in ((15, 25), (46, 31)):
        if m.g[y][x] in '.,':
            m.put(x, y, 'x')

    # Печать и лестница.
    m.put(55, 10, 'S')
    m.put(56, 10, 'S')
    m.floor(41, 6, '>')
    m.floor(36, 6, 'x')
    along_wall(m, 'q', 2, (36, 2, 52, 10), rng)

    # Норы.
    for x, y in ((16, H - 14), (48, H - 12), (40, H - 26), (24, H - 24), (12, 72), (52, 76),
                 (30, 66), (48, 90), (16, 92), (26, 60), (38, 60), (18, 52), (46, 52),
                 (58, 30), (58, 44), (44, 100)):
        burrow(m, x, y)
    return m


# ---------------------------------------------------------------------------
# Проверки (быстрые, до выгрузки; полный договор — в тестах).
# ---------------------------------------------------------------------------


def bfs(rows, start, passable):
    h = len(rows)
    seen = set([start])
    q = deque([start])
    while q:
        x, y = q.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if not (0 <= nx < W and 0 <= ny < h) or (nx, ny) in seen:
                continue
            if not passable(rows[ny][nx]):
                continue
            seen.add((nx, ny))
            q.append((nx, ny))
    return seen


def find(rows, ch):
    return [(x, y) for y, r in enumerate(rows) for x, c in enumerate(r) if c == ch]


def verify(world):
    lift = find(world, 'E')[0]
    sealed = bfs(world, lift, lambda c: open_cell(c) and c != 'S')
    opened = bfs(world, lift, open_cell)
    for ch in 'K>':
        for p in find(world, ch):
            assert p in opened, ('не дойти', ch, p)
    for p in find(world, '>'):
        assert p not in sealed, ('лестница мимо печати', p)
    for p in find(world, 'M'):
        assert (p[0], p[1] + 1) in opened, ('шахта', p)
    # Арена: заливка пола от K без ворот.
    k = find(world, 'K')[0]
    arena = bfs(world, k, lambda c: c in WALKABLE_TILE)
    for p in find(world, 'E') + find(world, '>'):
        assert p not in arena, ('арена открыта', p)
    print('арена клеток', len(arena), file=sys.stderr)
    assert 40 < len(arena) < 1500
    # Все предметы достижимы.
    for y, r in enumerate(world):
        for x, c in enumerate(r):
            if c in 'CBX$Tlu' and (x, y) not in opened:
                raise AssertionError(('предмет в стене', c, x, y))


def main():
    rim_m = build_rim()
    depth_m = build_depth()
    rim_rows = check(rim_m, 'f3rim')
    depth_rows = check(depth_m, 'f3depth')
    # Стык: нижний ряд глубины над верхним рядом края.
    shared = sum(1 for x in range(W) if rim_rows[0][x] != '#' and depth_rows[-1][x] != '#')
    assert shared >= 4, shared
    world = depth_rows + rim_rows
    if '--show' in sys.argv:
        show(depth_rows, 'D')
        show(rim_rows, 'R')
    verify(world)
    write_floor(3, {'MAP_F3_RIM': rim_rows, 'MAP_F3_DEPTH': depth_rows})


if __name__ == '__main__':
    main()
