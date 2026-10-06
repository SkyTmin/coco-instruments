"""Этаж 15 «Ядро подземелья» — карта половины «Мир» (v2.88, четвёртый заход).

Мотив — на дне подземелья лежит упавшая звезда. Её свет кристаллизовал
породу, кристаллы рождают монстров и хранят память обо всём, что было
выше. Глагол — ГРАВИТАЦИЯ: колодцы-осколки тянут героя, монстров, снаряды
и добычу; орбиты — острова ходят по кругу вокруг ядра; невесомость и
тяжесть. Палитра — индиго, холодный голубой кристалл, золото звёзд.

Три района снизу вверх (четвёртый, «Сердце» — агента «Сердце», сверху):
  f15       — «Кристальные корни»: Устье жилы (лифт, шахта), Первый осколок
              (колодец учит тяге), Жила, развилка — Друзы (жеоды, кристаллы
              памяти, тайник за трещиной) или Провал осколков (тропа над
              бездной мимо трёх колодцев); зал-событие «Пробуждение осколка»,
              Старый штрек (решётка к лифту), зал-событие «Галерея памяти»,
              Тихий грот, подъём.
  f15gut    — «Обсерватория строителей»: Вестибюль (лифт, шахта, решётка
              служебной лестницы), Колодезная с двумя рычагами, Зал карты
              (страж созвездия) и развилка — Архив карт (тайник) или
              Купольный ход; зал-событие «Звездопад» (большой купол),
              Галерея телескопа со звёздной дверью, зал-событие «Затмение»
              (планетарий), Окулярная (вторая карта), лестница.
  f15veins  — «Пояс орбит»: Причал (лифт, шахта на обломке, решётка),
              Малые орбиты (кромка в обход или верхом на острове), мост,
              зал-событие «Парад планет» (три кольца островов складываются в
              мост), зал-событие «Гравитационный шторм», развилка — Кольцо
              пыли (тайник) или Обломочный мост, Преддверие ядра и стык с
              «Сердцем» ровно в столбцах F15_JOIN (28–35).

Запуск: python3 scripts/dungeon/f15.py [--show] — пишет
src/lib/dungeon-floors/f15-map.ts (руками не править). Зерно постоянное:
повторный запуск даёт тот же файл байт в байт.

Свои буквы (легенда — `AreaSpec.legend` в f15.ts):
  общие:
  .  пол района                    x  кристаллы в полу
  g  крошка породы                 j  светящаяся жила в полу
  r  край кратера колодца          *  ядро колодца (осколок звезды, глубина)
  -  яма кратера (глубина)         d  спящий большой осколок (глубина)
  _  пустота / бездна (глубина)    W  кристальная стена
  Q  кристалл памяти (стена)       i  кристальная лампа (действие: зажечь)
  k  друза                         I  кристальная колонна
  q  сталагмит                     U  жеода (бьётся, звёздные осколки)
  Z  метеорит (тёплый свет)        f  пол невесомости (плывёт пыль)
  y  пол тяжести (вязнет)          &  якорь (действие: зацепиться)
  J  рычаг колодца (действие)      V  телескоп (действие)
  +  маяк (мигает)
  обсерватория:
  h  звёздная карта на полу        z  узел созвездия на карте
  w  латунное кольцо в полу        t  ковровая дорожка
  m  мозаика купола                H  стена обсерватории
  F  звёздное окно (стена, свет)   |  звёздная дверь (телескоп открывает)
  O  колонна                       A  армиллярная сфера
  N  планетарий-оррерий            e  жаровня
  6  глобус                        7  пюпитр с картой
  8  шкаф карт (бьётся, линзы)     9  статуя строителя
  орбиты:
  :  дорожка орбиты (глубина)      0  остров на орбите (пол, едет)
  p  причал                        ;  каменный мост
  ^  парящий обломок (глубина)     (  пылевой вихрь (глубина)
Метки мест (колодцы, кольца, залы-события, кристаллы памяти, посты) — в
F15_SPOTS, на карте их нет.
"""
import math
import os
import random
import sys
from collections import deque

sys.path.insert(0, os.path.dirname(__file__))
from brush import Map, W, check, show, write_floor  # noqa: E402

# Клетки, по которым ходят (для норы, настенного и проверки пути).
FLOORISH = set('.,xgjrifyJV&+kIqUZhzwtmOAN6789|0p;~ETR$a%DCPlu123')
# Только «чистый» пол — на него ставим предметы.
PLAIN = '.xgjhwtmf'

SPOTS = []


def spot(kind, area, *rest):
    SPOTS.append(' '.join([kind, area] + [str(r) for r in rest]))


def paint(m, x0, y0, x1, y1, ch, share=1.0, ok='.'):
    rng = m.rng
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            if 0 <= y < m.h and 0 < x < W - 1 and m.g[y][x] in ok and not m.lock[y][x]:
                if rng.random() < share:
                    m.g[y][x] = ch


def speckle(m, x0, y0, x1, y1, ch, n, ok='.', gap=2):
    """Раскидать `n` клеток `ch` по полу прямоугольника, не ближе `gap`."""
    rng = m.rng
    cells = [(x, y) for y in range(y0, y1 + 1) for x in range(x0, x1 + 1)
             if 0 <= y < m.h and 0 < x < W - 1 and m.g[y][x] in ok and not m.lock[y][x]]
    rng.shuffle(cells)
    placed = []
    for (x, y) in cells:
        if len(placed) >= n:
            break
        if any(abs(x - a) + abs(y - b) < gap for a, b in placed):
            continue
        m.g[y][x] = ch
        placed.append((x, y))
    return placed


def disc(m, cx, cy, r, ch, ok=None, r0=0.0, natural=False):
    """Круг (или кольцо r0…r) клеток по центрам клеток."""
    out = []
    for y in range(int(cy - r) - 1, int(cy + r) + 2):
        for x in range(int(cx - r) - 1, int(cx + r) + 2):
            if not m.inb(x, y):
                continue
            d = math.hypot(x + 0.5 - cx, y + 0.5 - cy)
            if r0 <= d < r:
                if ok is None or m.g[y][x] in ok:
                    m.g[y][x] = ch
                    m.natural[y][x] = natural
                    out.append((x, y))
    return out


def ring_cells(cx, cy, r0, r1):
    """Клетки кольца по возрастанию угла (atan2, y вниз) — как в f15-brains."""
    cells = []
    for y in range(int(cy - r1) - 1, int(cy + r1) + 2):
        for x in range(int(cx - r1) - 1, int(cx + r1) + 2):
            d = math.hypot(x + 0.5 - cx, y + 0.5 - cy)
            if r0 <= d < r1:
                cells.append((math.atan2(y + 0.5 - cy, x + 0.5 - cx), x, y))
    cells.sort()
    return [(x, y, a) for a, x, y in cells]


def wallish(m, x, y):
    return m.get(x, y) in '#WH'


def face(m, x, y, c, below=FLOORISH):
    """Настенное: стена, под ней пол. Мимо — ищем рядом по ряду."""
    for dy in (0, -1, 1):
        for dx in (0, 1, -1, 2, -2, 3, -3):
            xx, yy = x + dx, y + dy
            if wallish(m, xx, yy) and m.get(xx, yy + 1) in below and not m.lock[yy][xx]:
                if dx or dy:
                    print(f'  сдвиг {c} ({x},{y}) -> ({xx},{yy})', file=sys.stderr)
                m.put(xx, yy, c)
                return (xx, yy)
    raise SystemExit(f'НЕТ стены для {c} ({x},{y})')


def hole(m, x, y):
    """Нора в стене, откуда лезут: стена, рядом пол любого вида."""
    def ok(x, y):
        return (wallish(m, x, y) and not m.lock[y][x] and 0 < x < W - 1 and any(
            m.get(x + dx, y + dy) in FLOORISH for dx, dy in ((0, 1), (1, 0), (-1, 0), (0, -1))))
    if ok(x, y):
        m.put(x, y, 'o')
        return
    for r in range(1, 6):
        for dx, dy in ((-r, 0), (r, 0), (0, -r), (0, r)):
            if ok(x + dx, y + dy):
                print(f'  сдвиг o ({x},{y}) -> ({x+dx},{y+dy})', file=sys.stderr)
                m.put(x + dx, y + dy, 'o')
                return
    raise SystemExit(f'НЕТ места для норы ({x},{y})')


def item(m, x, y, c, ok=PLAIN):
    """Предмет на пол: точно в клетку или в ближайшую чистую рядом."""
    for r in range(0, 3):
        for dy in range(-r, r + 1):
            for dx in range(-r, r + 1):
                if max(abs(dx), abs(dy)) != r:
                    continue
                xx, yy = x + dx, y + dy
                if m.get(xx, yy) in ok and not m.lock[yy][xx]:
                    if r:
                        print(f'  сдвиг {c} ({x},{y}) -> ({xx},{yy})', file=sys.stderr)
                    m.put(xx, yy, c)
                    return (xx, yy)
    raise SystemExit(f'НЕТ пола для {c} ({x},{y})')


def well(m, area, x, y, r, burn, period, phase, rim=2.6):
    """Колодец: ядро-осколок в кратере, край кратера вокруг."""
    disc(m, x + 0.5, y + 0.5, rim, 'r', ok=PLAIN + 'r', r0=0.9)
    m.put(x, y, '*')
    spot('well', area, x, y, r, burn, period, phase)


def crystal_walls(m, y0, y1, share, seed_ch='W'):
    """Кристалл в лице стен: стена над полом с долей `share` — кристальная."""
    rng = m.rng
    for y in range(y0, y1 + 1):
        for x in range(1, W - 1):
            if m.g[y][x] == '#' and not m.lock[y][x] and m.get(x, y + 1) in FLOORISH:
                if rng.random() < share:
                    m.g[y][x] = seed_ch


def dress(m, ch, wall_share, open_share, gap=3):
    """Нетвёрдый убор пола (ростки, обломки): гуще у стен, редко посреди.
    Ставится последним и только на чистый пол — пути и метки не меняет."""
    rng = random.Random(9150 + ord(ch))
    near, mid = [], []
    for y in range(1, m.h - 1):
        for x in range(1, W - 1):
            if m.g[y][x] != '.' or m.lock[y][x]:
                continue
            nw = sum(1 for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)) if wallish(m, x + dx, y + dy))
            (near if nw else mid).append((x, y))
    placed = []
    for cells, share in ((near, wall_share), (mid, open_share)):
        rng.shuffle(cells)
        n = int(len(cells) * share)
        k = 0
        for (x, y) in cells:
            if k >= n:
                break
            if any(abs(x - a) + abs(y - b) < gap for a, b in placed):
                continue
            m.g[y][x] = ch
            placed.append((x, y))
            k += 1
    return placed


def verify(areas):
    """Весь пол этажа связан с лифтом входа; вернуть недостижимые клетки."""
    rows = []
    for _, r in reversed(areas):
        pass
    stack = [r for _, r in reversed(areas)]
    rows = [row for part in stack for row in part]
    h = len(rows)
    sx = sy = None
    # Лифт входа — нижний район, последний в склейке.
    base = h - len(areas[0][1])
    for y in range(base, h):
        x = rows[y].find('E')
        if x >= 0:
            sx, sy = x, y
            break
    seen = [[False] * W for _ in range(h)]
    q = deque([(sx, sy)])
    seen[sy][sx] = True
    while q:
        x, y = q.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            xx, yy = x + dx, y + dy
            if 0 <= yy < h and 0 <= xx < W and not seen[yy][xx] and rows[yy][xx] in FLOORISH:
                seen[yy][xx] = True
                q.append((xx, yy))
    lost = [(x, y) for y in range(h) for x in range(W)
            if rows[y][x] in FLOORISH and not seen[y][x]]
    return rows, lost, seen


# ---------------------------------------------------------------------------
# Район 1 — «Кристальные корни» (вход, лифт). Высота 300.
# ---------------------------------------------------------------------------

def area_roots():
    A = 'f15'
    H = 300
    m = Map(H, seed=1501, cave='.')

    # Устье жилы: пещера лифта.
    m.ell(32, 285, 13, 8)
    # Первый осколок.
    m.vpath(32, 256, 280, 4, '.', natural=True)
    m.ell(32, 254, 10, 7)
    # Жила — змейкой вверх.
    m.vpath(29, 236, 248, 3, '.', natural=True)
    m.hpath(29, 37, 236, 3, '.', natural=True)
    m.vpath(37, 222, 236, 3, '.', natural=True)
    m.hpath(31, 37, 222, 3, '.', natural=True)
    m.vpath(32, 212, 223, 3, '.', natural=True)
    # Развилка.
    m.ell(32, 213, 9, 5)
    # Запад — Друзы: три жеоды.
    m.hpath(15, 24, 211, 3, '.', natural=True)
    m.vpath(16, 200, 212, 3, '.', natural=True)
    m.ell(16, 202, 6, 5)
    m.vpath(12, 189, 198, 3, '.', natural=True)
    m.ell(12, 184, 5, 6)
    m.vpath(15, 171, 179, 3, '.', natural=True)
    m.ell(17, 166, 7, 5)
    m.vpath(18, 136, 161, 3, '.', natural=True)
    # Восток — Провал осколков: уступ над бездной.
    m.hpath(40, 46, 211, 3, '.', natural=True)
    m.rect(42, 156, 48, 212, '.', natural=True)
    m.vpath(45, 136, 156, 3, '.', natural=True)
    # Зал «Пробуждение осколка».
    m.ell(32, 136, 15, 10)
    # Ход на север — к Галерее памяти.
    m.vpath(32, 98, 125, 3, '.', natural=True)
    m.hpath(28, 32, 112, 3, '.', natural=True)
    m.vpath(28, 104, 112, 3, '.', natural=True)
    m.hpath(28, 32, 104, 3, '.', natural=True)
    # Тихий грот и подъём.
    m.vpath(32, 46, 66, 3, '.', natural=True)
    m.ell(31, 46, 10, 7)
    m.vpath(31, 14, 38, 3, '.', natural=True)
    m.ell(31, 18, 7, 4)

    # Галерея памяти — выложенный зал с кристальными глыбами.
    GX0, GY0, GX1, GY1 = 9, 68, 55, 96
    m.rect(GX0, GY0, GX1, GY1, '.')
    m.protect(GX0 - 1, GY0 - 1, GX1 + 1, GY1 + 1)

    # Бездна Провала (до дрожи — дрожь её не трогает: не '.').
    for y in range(152, 216):
        for x in range(49, 58):
            m.g[y][x] = '_'
            m.natural[y][x] = False
    # Неровный край бездны.
    for y in range(152, 216):
        for x in (49, 57):
            if m.rng.random() < 0.35:
                m.g[y][x] = '#'

    # Старый штрек: от хода к Галерее вдоль восточной стены вниз к лифту.
    # Восточнее решётки — сплошная порода: пещера лифта не должна обойти её.
    for y in range(276, 297):
        for x in range(47, W - 1):
            m.g[y][x] = '#'
            m.natural[y][x] = False
    m.hpath(33, 61, 116, 2, 'g')
    m.vpath(61, 116, 286, 2, 'g')
    m.hpath(48, 61, 286, 1, 'g')
    m.rect(43, 285, 46, 287, '.')
    m.put(47, 286, 'D')
    m.protect(43, 280, 62, 292)
    m.protect(57, 112, 62, 292)
    for y in range(120, 284, 9):
        m.put(61 if (y // 9) % 2 else 60, y, 'P')

    # Тайник в Друзах: трещина в западной стене средней жеоды.
    m.rect(2, 182, 4, 186, '.')
    m.rect(6, 184, 7, 184, '.')
    m.put(5, 184, '%')
    m.put(3, 184, '$')
    m.protect(1, 180, 6, 188)

    # Стык с Обсерваторией: ряд 0, столбцы 29–34.
    m.rect(29, 0, 34, 14, '.')
    m.protect(1, 0, 62, 3)

    m.jitter(0.3, 2)

    # --- оформление ---
    # Пещера лифта: лифт, шахта, лампы.
    m.floor(32, 288, 'E')
    m.wall_obj(22, 279, 'M')
    item(m, 26, 284, 'k')
    item(m, 39, 289, 'k')
    item(m, 36, 282, 'q')
    item(m, 25, 290, 'q')
    item(m, 30, 281, 'T')
    for x, y in ((27, 278), (37, 278)):
        face(m, x, y, 'L')
    paint(m, 19, 277, 45, 294, 'g', 0.18)
    hole(m, 44, 283)

    # Первый осколок: колодец учит тяге.
    well(m, A, 35, 253, 5.5, 1.5, 7.0, 0.0)
    speckle(m, 23, 248, 41, 261, 'x', 7)
    item(m, 26, 250, 'I')
    item(m, 39, 258, 'k')
    item(m, 25, 258, 'i')
    hole(m, 22, 252)
    hole(m, 42, 251)

    # Жила: светящаяся жила по полу, норы ежей и жуков, засада.
    for y in range(222, 249):
        for x in range(26, 41):
            if m.g[y][x] == '.' and (x + y * 3) % 7 == 0:
                m.g[y][x] = 'j'
    hole(m, 26, 242)
    hole(m, 40, 230)
    hole(m, 33, 225)
    item(m, 30, 240, 'a')
    crystal_walls(m, 220, 250, 0.35)

    # Развилка.
    item(m, 32, 210, 'T')
    item(m, 28, 216, 'q')
    item(m, 37, 215, 'k')

    # Друзы: жеоды, друзы, кристаллы памяти, спящая стая.
    for (cx, cy) in ((16, 202), (12, 184), (17, 166)):
        speckle(m, cx - 6, cy - 6, cx + 6, cy + 6, 'x', 6)
    item(m, 13, 200, 'U')
    item(m, 19, 205, 'U')
    item(m, 9, 188, 'U')
    item(m, 21, 168, 'U')
    item(m, 14, 164, 'k')
    item(m, 20, 199, 'k')
    item(m, 14, 181, 'k')
    item(m, 16, 170, 'R')
    spot('mem', A, *face(m, 16, 196, 'Q'), 'shroom')
    spot('mem', A, *face(m, 18, 160, 'Q'), 'rat')
    hole(m, 9, 168)
    crystal_walls(m, 158, 210, 0.3)

    # Провал осколков: три колодца по очереди на уступе.
    well(m, A, 45, 200, 4.6, 1.5, 6.0, 0.0, rim=2.2)
    well(m, A, 44, 184, 4.6, 1.5, 6.0, 2.0, rim=2.2)
    well(m, A, 45, 168, 4.6, 1.5, 6.0, 4.0, rim=2.2)
    item(m, 43, 192, 'q')
    item(m, 47, 176, 'k')
    hole(m, 41, 196)
    hole(m, 41, 176)
    for y in range(156, 214, 4):
        x = 50 + (y * 7) % 6
        if m.g[y][x] == '_':
            m.g[y][x] = '^'

    # Зал «Пробуждение осколка»: спящий большой осколок в кратере.
    HX, HY = 32, 136
    disc(m, HX + 0.5, HY + 0.5, 2.2, '-')
    m.put(HX, HY, 'd')
    disc(m, HX + 0.5, HY + 0.5, 3.6, 'r', ok='.', r0=2.2)
    for k in range(8):
        a = k * math.pi / 4 + math.pi / 8
        item(m, round(HX + math.cos(a) * 8.5), round(HY + math.sin(a) * 6.5), 'I')
    for k in range(4):
        a = k * math.pi / 2 + math.pi / 4
        item(m, round(HX + math.cos(a) * 12), round(HY + math.sin(a) * 8), 'i')
    for (x, y) in ((18, 130), (46, 130), (24, 127), (40, 127), (17, 140), (47, 141)):
        hole(m, x, y)
    speckle(m, 18, 128, 46, 145, 'x', 10)
    spot('hall', A, HX - 15, HY - 10, HX + 15, HY + 10, 'awaken')
    crystal_walls(m, 124, 148, 0.45)

    # Ход к Галерее.
    item(m, 30, 108, 'q')
    hole(m, 26, 120)

    # Галерея памяти: глыбы кристалла с кристаллами памяти в лице.
    motifs = ['rat', 'shroom', 'lava', 'mirror', 'sky', 'clock']
    k = 0
    for gy in (76, 87):
        for gx in (15, 25, 37, 47):
            for yy in range(gy, gy + 3):
                for xx in range(gx, gx + 3):
                    m.put(xx, yy, 'W')
            m.put(gx + 1, gy + 2, 'Q')
            spot('mem', A, gx + 1, gy + 2, motifs[k % 6])
            k += 1
    for gx in (13, 22, 42, 51):
        m.put(gx, GY0 - 1, 'Q')
        spot('mem', A, gx, GY0 - 1, motifs[k % 6])
        k += 1
    for x in range(GX0, GX1 + 1):
        if m.g[GY0 - 1][x] == '#':
            m.g[GY0 - 1][x] = 'W'
    # Проходы в Галерею снизу и наверх.
    m.rect(31, GY1 + 1, 33, GY1 + 2, '.')
    m.rect(31, GY0 - 3, 33, GY0 - 1, '.')
    paint(m, GX0, GY0, GX1, GY1, 'x', 0.06)
    for x in (12, 20, 32, 44, 52):
        item(m, x, 93, 'k')
    item(m, 31, 82, 'i')
    item(m, 33, 82, 'i')
    spot('hall', A, GX0, GY0, GX1, GY1, 'gallery')

    # Тихий грот: колодец, спящая стая, метеорит.
    well(m, A, 35, 44, 5.0, 1.5, 8.0, 3.0)
    item(m, 25, 48, 'Z')
    item(m, 27, 40, 'R')
    item(m, 38, 50, 'k')
    item(m, 22, 44, 'q')
    hole(m, 22, 40)
    hole(m, 40, 46)
    spot('mem', A, *face(m, 30, 38, 'Q'), 'sky')
    crystal_walls(m, 10, 56, 0.3)
    item(m, 31, 22, 'i')
    item(m, 31, 6, 'T')

    # Ростки кристаллов: у стен гуще, посреди залов редко (не мешают ходу).
    dress(m, '1', 0.16, 0.02)
    return m


# ---------------------------------------------------------------------------
# Район 2 — «Обсерватория строителей». Высота 310.
# ---------------------------------------------------------------------------

def walls_box(m, x0, y0, x1, y1, ch='H'):
    """Стена обсерватории по контуру (только там, где порода)."""
    for x in range(x0, x1 + 1):
        for y in (y0, y1):
            if m.get(x, y) == '#':
                m.g[y][x] = ch
    for y in range(y0, y1 + 1):
        for x in (x0, x1):
            if m.get(x, y) == '#':
                m.g[y][x] = ch


def area_obs():
    A = 'f15gut'
    H = 310
    m = Map(H, seed=1502, cave='.')

    # Вход снизу (стык с Корнями) и Вестибюль.
    m.rect(29, 300, 34, 309, 't')
    m.rect(18, 282, 46, 299, '.')
    # Колодезная.
    m.rect(30, 276, 34, 281, 't')
    m.rect(12, 256, 52, 275, '.')
    # Ход меридиана и Зал карты (развилка).
    m.rect(31, 250, 33, 255, 't')
    m.rect(21, 232, 43, 249, '.')
    # Запад — Архив карт.
    m.rect(9, 238, 20, 240, '.')
    m.rect(4, 206, 18, 240, '.')
    m.rect(9, 196, 11, 205, '.')
    m.rect(9, 194, 20, 196, '.')
    # Восток — Купольный ход: два малых купола.
    m.rect(44, 238, 50, 240, '.')
    m.rect(48, 230, 50, 240, '.')
    disc(m, 50.5, 228.5, 6.2, '.')
    m.rect(49, 214, 51, 222, '.')
    disc(m, 50.5, 208.5, 5.6, '.')
    m.rect(44, 194, 51, 196, '.')
    m.rect(49, 194, 51, 204, '.')
    # Зал «Звездопад» — большой купол.
    SX, SY = 32, 187
    disc(m, SX + 0.5, SY + 0.5, 13.5, '.')
    # Галерея телескопа.
    m.rect(31, 172, 33, 174, 't')
    m.rect(25, 150, 39, 171, '.')
    m.rect(30, 141, 34, 149, 't')
    # Зал «Затмение» — планетарий.
    PX0, PY0, PX1, PY1 = 10, 102, 54, 140
    m.rect(PX0, PY0, PX1, PY1, '.')
    # Окулярная и лестница наверх.
    m.rect(31, 92, 33, 101, 't')
    m.rect(20, 70, 44, 91, '.')
    m.rect(31, 56, 33, 69, 't')
    m.rect(22, 36, 42, 55, '.')
    m.rect(30, 14, 34, 35, 't')
    m.rect(26, 8, 38, 16, '.')
    m.rect(29, 0, 34, 7, 't')

    # Служебная лестница: из планетария вдоль восточной стены вниз к Вестибюлю.
    m.hpath(55, 61, 121, 2, 'g')
    m.vpath(61, 121, 291, 2, 'g')
    m.hpath(48, 61, 291, 1, 'g')
    m.put(47, 291, 'D')
    m.protect(44, 286, 62, 296)
    m.protect(57, 118, 62, 296)
    for y in range(126, 288, 10):
        m.put(61 if (y // 10) % 2 else 60, y, 'P')

    # Тайник Архива: трещина в западной стене.
    m.rect(1, 222, 2, 226, '.')
    m.put(3, 224, '%')
    m.put(1, 224, '$')
    m.protect(1, 219, 3, 229)

    # Стены обсерватории — лицо (H) по контуру всех комнат.
    for y in range(H):
        for x in range(1, W - 1):
            if m.g[y][x] == '#' and any(m.get(x + dx, y + dy) in FLOORISH
                                         for dx in (-1, 0, 1) for dy in (-1, 0, 1)):
                if not m.lock[y][x]:
                    m.g[y][x] = 'H'

    # --- оформление ---
    # Вестибюль.
    m.floor(32, 291, 'E')
    face(m, 22, 281, 'M', below=FLOORISH)
    for (x, y) in ((21, 285), (21, 296), (43, 285), (43, 296)):
        m.put(x, y, 'O')
    m.rect(31, 282, 33, 299, 't')
    m.put(32, 291, 'E')
    item(m, 26, 288, '6')
    item(m, 38, 295, '9')
    item(m, 36, 285, 'T', ok=PLAIN + 't')
    item(m, 24, 297, 'e')
    item(m, 40, 297, 'e')
    hole(m, 18, 290)

    # Колодезная: два колодца, два рычага, балконы звездочётов.
    well(m, A, 24, 265, 7.0, 1.5, 7.0, 0.0, rim=3.0)
    well(m, A, 40, 265, 7.0, 1.5, 7.0, 3.5, rim=3.0)
    item(m, 15, 272, 'J')
    item(m, 49, 272, 'J')
    for (x, y) in ((14, 258), (50, 258), (14, 268), (50, 268)):
        m.put(x, y, 'O')
    item(m, 32, 262, 'A')
    spot('post', A, 16, 258, 'f15_astro')
    spot('post', A, 48, 258, 'f15_astro')
    hole(m, 12, 262)
    hole(m, 52, 266)

    # Зал карты: звёздная карта на полу, на ней страж созвездия.
    disc(m, 32.5, 240.5, 6.5, 'h')
    for (x, y) in ((29, 237), (35, 236), (37, 241), (33, 244), (28, 243), (31, 240)):
        m.put(x, y, 'z')
    spot('chart', A, 32, 240, 6.5)
    for (x, y) in ((22, 233), (42, 233), (22, 248), (42, 248)):
        m.put(x, y, 'O')
    item(m, 24, 246, 'e')
    item(m, 40, 246, 'e')

    # Архив карт: шкафы рядами, пюпитры, глобус.
    for y in range(209, 238, 5):
        for x in (6, 10, 14):
            if (x + y) % 3:
                item(m, x, y, '8')
            else:
                item(m, x, y, '7')
    item(m, 16, 224, '6')
    m.rect(5, 206, 17, 206, 't')
    hole(m, 4, 214)
    hole(m, 18, 231)

    # Купольный ход: малые купола со звёздными окнами.
    for (cx, cy, r) in ((50, 228, 6.2), (50, 208, 5.6)):
        disc(m, cx + 0.5, cy + 0.5, r - 1.2, 'm', ok='.', r0=r - 2.3)
        face(m, cx, cy - int(r) - 1, 'F')
        face(m, cx - 3, cy - int(r) + 0, 'F')
        item(m, cx, cy, 'A' if cy > 220 else '9')
    spot('post', A, 50, 226, 'f15_graviton')
    hole(m, 56, 228)

    # Звездопад: мозаика, латунные кольца, окна по кругу.
    disc(m, SX + 0.5, SY + 0.5, 13.5, 'm', ok='.', r0=0)
    disc(m, SX + 0.5, SY + 0.5, 6.6, 'w', ok='m', r0=5.8)
    disc(m, SX + 0.5, SY + 0.5, 11.6, 'w', ok='m', r0=10.8)
    item(m, SX, SY, 'A', ok='m')
    for x in range(SX - 12, SX + 13, 4):
        try:
            face(m, x, SY - 13, 'F')
        except SystemExit:
            pass
    for k in range(6):
        a = k * math.pi / 3
        item(m, round(SX + math.cos(a) * 9), round(SY + math.sin(a) * 9), 'O', ok='m')
    spot('hall', A, SX - 13, SY - 13, SX + 13, SY + 13, 'starfall')
    for (x, y) in ((19, 181), (45, 181)):
        hole(m, x, y)

    # Галерея телескопа и звёздная дверь.
    for y in range(152, 171, 4):
        m.put(26, y, 'O')
        m.put(38, y, 'O')
    m.rect(31, 150, 33, 171, 't')
    item(m, 28, 156, 'V')
    for x in range(30, 35):
        m.put(x, 146, '|')
    spot('door', A, 30, 146, 34)
    spot('scope', A, 28, 156, 'door')
    item(m, 36, 165, '9')
    face(m, 32, 149, 'F')

    # Планетарий: оррерий, лампы-кристаллы, большой телескоп, колонны.
    m.rect(PX0 + 2, PY0 + 2, PX1 - 2, PY1 - 2, 'm', natural=False)
    disc(m, 32.5, 121.5, 9.5, 'w', ok='m', r0=8.7)
    disc(m, 32.5, 121.5, 4.0, '.', ok='m')
    m.put(32, 121, 'N')
    for k in range(8):
        a = k * math.pi / 4
        item(m, round(32 + math.cos(a) * 14), round(121 + math.sin(a) * 12), 'i', ok='m.')
    for (x, y) in ((14, 106), (50, 106), (14, 136), (50, 136), (14, 121), (50, 121)):
        m.put(x, y, 'O')
    item(m, 27, 104, 'V', ok='m.')
    spot('scope', A, 27, 104, 'sun')
    for x in range(PX0 + 3, PX1 - 2, 5):
        try:
            face(m, x, PY0 - 1, 'F')
        except SystemExit:
            pass
    m.rect(31, PY0, 33, PY1, 't')
    m.put(32, 121, 'N')
    spot('hall', A, PX0, PY0, PX1, PY1, 'eclipse')
    for (x, y) in ((10, 112), (54, 112), (10, 130)):
        hole(m, x, y)

    # Окулярная: вторая звёздная карта.
    disc(m, 32.5, 80.5, 6.0, 'h')
    for (x, y) in ((30, 77), (35, 78), (36, 83), (31, 84), (28, 81)):
        m.put(x, y, 'z')
    spot('chart', A, 32, 80, 6.0)
    for (x, y) in ((21, 71), (43, 71), (21, 90), (43, 90)):
        m.put(x, y, 'O')
    item(m, 24, 87, '7')
    item(m, 40, 87, '8')
    item(m, 40, 74, '6')
    hole(m, 20, 80)
    hole(m, 44, 82)

    # Верхний зал и лестница.
    item(m, 25, 40, 'e')
    item(m, 39, 40, 'e')
    item(m, 32, 45, 'A')
    item(m, 24, 52, '9')
    item(m, 40, 52, '9')
    spot('post', A, 32, 50, 'f15_graviton')
    hole(m, 22, 44)
    hole(m, 42, 46)
    m.put(31, 12, 'T')

    # Обсерватория: опавшие свитки и латунный сор у стен.
    dress(m, '3', 0.1, 0.01)
    return m


# ---------------------------------------------------------------------------
# Район 3 — «Пояс орбит». Высота 300. Почти всё — пустота.
# ---------------------------------------------------------------------------

def orbit(m, area, cx, cy, r0, r1, n, speed, name, width=3.2):
    """Дорожка орбиты с `n` островами. Начальная расстановка — острова на
    севере и юге (для n=2) — мост с юга на север: путь по клеткам есть."""
    lane = ring_cells(cx, cy, r0, r1)
    rm = (r0 + r1) / 2
    half = (width / 2) / rm
    starts = [math.pi / 2 + k * 2 * math.pi / n for k in range(n)]
    for (x, y, a) in lane:
        on = any(abs((a - s + math.pi) % (2 * math.pi) - math.pi) <= half for s in starts)
        m.put(x, y, '0' if on else ':')
    spot('ring', area, cx, cy, r0, r1, n, speed, width, name)


def area_orbit():
    A = 'f15veins'
    H = 300
    m = Map(H, seed=1503, cave='.')
    for y in range(H):
        for x in range(1, W - 1):
            m.g[y][x] = '_'

    def rock(x0, y0, x1, y1):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                if m.inb(x, y):
                    m.g[y][x] = '#'

    # Причал: каменная плита, стык снизу.
    rock(14, 276, 50, 299)
    m.ell(32, 288, 15, 9, '.')
    m.rect(29, 296, 34, 299, '.')
    rock(1, 296, 28, 299)
    rock(35, 296, 62, 299)
    # Утёс с шахтой.
    rock(19, 281, 24, 283)

    # Малые орбиты: ядро, дорожка, зазор с причалами, кромка.
    OX, OY = 32.5, 258.5
    disc(m, OX, OY, 12.3, '.', r0=9.5)
    m.rect(31, 268, 33, 279, '.')
    m.rect(31, 238, 33, 249, '.')
    orbit(m, A, OX, OY, 3.5, 7.5, 2, 0.32, 'small')
    for (x, y, a) in ring_cells(OX, OY, 7.5, 9.5):
        if abs(x - 32) <= 1:
            m.put(x, y, 'p')
    m.put(32, 258, '*')
    spot('well', A, 32, 258, 6.5, 1.2, 9.0, 0.0)

    # Мост к Параду.
    m.rect(31, 210, 33, 238, ';')
    m.rect(26, 224, 36, 228, '.')
    m.rect(36, 226, 44, 226, ';')
    m.rect(42, 221, 47, 231, '.')

    # Зал «Парад планет»: три кольца островов вокруг ядра.
    PX, PY = 32.5, 194.5
    disc(m, PX, PY, 17.5, '.', r0=15.5)
    disc(m, PX, PY, 12.5, '.', r0=10.5)
    disc(m, PX, PY, 7.5, '.', r0=5.5)
    disc(m, PX, PY, 2.5, 'r')
    orbit(m, A, PX, PY, 2.5, 5.5, 2, 0.55, 'p1')
    orbit(m, A, PX, PY, 7.5, 10.5, 2, -0.36, 'p2')
    orbit(m, A, PX, PY, 12.5, 15.5, 2, 0.24, 'p3')
    m.put(32, 194, '*')
    spot('well', A, 32, 194, 4.0, 0.9, 16.0, 0.0)
    spot('hall', A, 14, 176, 51, 213, 'parade')
    for (x, y) in ((32, 211), (32, 177), (32, 206), (32, 182)):
        item(m, x + 2, y, '&', ok='.')
    for k in range(8):
        a = k * math.pi / 4 + math.pi / 8
        item(m, round(PX - 0.5 + math.cos(a) * 16.5), round(PY - 0.5 + math.sin(a) * 16.5), '+', ok='.')

    # Мост к Шторму.
    m.rect(31, 158, 33, 176, ';')
    m.rect(28, 164, 36, 168, '.')

    # Зал «Гравитационный шторм»: скала с ямами пустоты, пятна тяжести и
    # невесомости, ядро посередине.
    rock(6, 102, 58, 160)
    m.ell(32, 131, 24, 26, '.', rough=0.12)
    m.rect(31, 155, 33, 160, '.')
    m.rect(31, 101, 33, 107, '.')
    for (cx, cy, r) in ((18, 118, 3.2), (46, 118, 3.2), (18, 145, 3.0), (46, 145, 3.0)):
        disc(m, cx + 0.5, cy + 0.5, r, '_')
    for (cx, cy, r) in ((24, 128, 3.5), (40, 136, 3.5), (32, 112, 3.0)):
        disc(m, cx + 0.5, cy + 0.5, r, 'f', ok='.')
    for (cx, cy, r) in ((40, 125, 3.0), (24, 140, 3.0), (32, 150, 2.6)):
        disc(m, cx + 0.5, cy + 0.5, r, 'y', ok='.')
    well(m, A, 32, 131, 6.0, 1.5, 9.0, 0.0, rim=2.4)
    spot('hall', A, 9, 106, 55, 157, 'storm')

    # Развилка: запад — Кольцо пыли, восток — Обломочный мост.
    rock(20, 92, 44, 104)
    m.rect(24, 94, 40, 100, '.')
    m.rect(31, 99, 33, 108, '.')
    # Кольцо пыли (невесомость) вокруг вихря.
    m.rect(14, 96, 23, 98, ';')
    VX, VY = 16.5, 80.5
    disc(m, VX, VY, 7.0, 'f', r0=4.0)
    m.rect(15, 87, 17, 95, ';')
    m.rect(15, 58, 17, 73, ';')
    m.put(16, 80, '(')
    spot('vortex', A, 16, 80)
    # Тайник за трещиной у западного края кольца.
    rock(1, 76, 9, 84)
    m.rect(2, 79, 4, 81, '.')
    m.rect(8, 80, 9, 80, 'f')
    m.put(5, 80, '%')
    m.rect(6, 80, 7, 80, 'f')
    m.put(3, 80, '$')
    m.protect(1, 76, 9, 84)
    # Обломочный мост: зигзаг над пустотой.
    m.rect(40, 96, 46, 98, ';')
    m.rect(44, 86, 46, 96, ';')
    m.rect(44, 84, 52, 86, '.')
    m.rect(50, 74, 52, 84, ';')
    m.rect(42, 72, 52, 74, ';')
    m.rect(42, 58, 44, 72, ';')
    # Служебный ход: с Обломочного моста вдоль восточного края к Причалу.
    rock(58, 76, 62, 296)
    m.hpath(53, 61, 85, 1, 'g')
    m.vpath(61, 85, 290, 2, 'g')
    rock(44, 278, 62, 296)
    m.hpath(45, 61, 290, 1, 'g')
    m.rect(40, 289, 43, 291, '.')
    m.put(44, 290, 'D')
    m.protect(40, 278, 62, 296)
    m.protect(56, 76, 62, 296)
    for y in range(95, 286, 11):
        m.put(61 if (y // 11) % 2 else 60, y, 'P')

    # Преддверие ядра: тихий зал и стык с «Сердцем».
    rock(10, 0, 54, 57)
    m.rect(12, 50, 48, 58, '.')
    m.rect(29, 42, 35, 51, '.')
    m.ell(32, 32, 15, 17, '.', rough=0.1)
    m.rect(28, 0, 35, 16, '.')
    for x in range(1, W - 1):
        if not 28 <= x <= 35:
            m.g[0][x] = '#'
    m.protect(1, 0, 62, 1)

    m.jitter(0.25, 1)

    # --- оформление ---
    m.floor(32, 291, 'E')
    m.put(21, 283, 'M')
    item(m, 26, 286, 'Z')
    item(m, 40, 284, 'k')
    item(m, 38, 293, '+')
    item(m, 25, 293, '+')
    item(m, 36, 282, 'T')
    hole(m, 18, 287)
    pass  # hole east dock
    for (x, y) in ((31, 270), (33, 247)):
        item(m, x, y, '&', ok='.')
    spot('dock', A, 32, 268, 'small')
    spot('dock', A, 32, 248, 'small')
    # Кромка: маяки и парящие обломки.
    for k in range(6):
        a = k * math.pi / 3 + math.pi / 6
        item(m, round(OX - 0.5 + math.cos(a) * 10.5), round(OY - 0.5 + math.sin(a) * 10.5), '+', ok='.')
    for (x, y) in ((8, 260), (54, 250), (12, 236), (52, 270), (6, 210), (56, 200),
                   (8, 170), (54, 160), (4, 120), (60, 66), (10, 70), (30, 70),
                   (52, 110), (8, 290), (56, 278), (22, 214), (46, 182), (18, 176)):
        if m.g[y][x] == '_':
            m.g[y][x] = '^'
    spot('post', A, 44, 226, 'f15_graviton')
    spot('post', A, 28, 226, 'f15_moon')
    spot('post', A, 30, 166, 'f15_moon')
    # Шторм.
    speckle(m, 10, 108, 54, 156, 'x', 12)
    for (x, y) in ((16, 112), (48, 112), (14, 136), (50, 128), (22, 152), (42, 152)):
        item(m, x, y, 'I')
    item(m, 26, 120, 'Z')
    item(m, 40, 146, 'Z')
    for (x, y) in ((8, 130), (56, 132), (20, 104), (44, 104), (24, 157), (40, 157)):
        hole(m, x, y)
    # Развилка и Кольцо пыли.
    item(m, 32, 97, 'T')
    item(m, 26, 95, 'q')
    hole(m, 22, 96)
    hole(m, 42, 99)
    # Обломочный мост.
    spot('post', A, 48, 85, 'f15_comet')
    # Преддверие ядра: колонны, маяки, кристаллы.
    for k in range(6):
        a = k * math.pi / 3
        item(m, round(32 + math.cos(a) * 9), round(32 + math.sin(a) * 10), 'I')
    item(m, 22, 56, '+')
    item(m, 42, 56, '+')
    item(m, 18, 30, 'k')
    item(m, 46, 34, 'k')
    item(m, 32, 44, 'i')
    speckle(m, 18, 18, 46, 48, 'x', 10)
    for (x, y) in ((18, 22), (46, 22)):
        hole(m, x, y)
    spot('mem', A, *face(m, 26, 15, 'Q'), 'mirror')
    spot('mem', A, *face(m, 38, 15, 'Q'), 'clock')
    m.put(31, 6, 'T')
    # Осколки метеоритов и ростки — нетвёрдый убор пола.
    dress(m, '2', 0.14, 0.02)
    dress(m, '1', 0.05, 0.0)
    return m


def main():
    SPOTS.clear()
    roots = area_roots()
    obs = area_obs()
    orb = area_orbit()
    r1 = check(roots, 'f15')
    r2 = check(obs, 'f15gut')
    r3 = check(orb, 'f15veins')
    rows, lost, _ = verify([('f15', r1), ('f15gut', r2), ('f15veins', r3)])
    if lost:
        print('  заросло карманов пола:', len(lost), file=sys.stderr)
        h3, h2 = len(r3), len(r2)
        for (x, y) in lost:
            if y < h3:
                fill = '_' if r3[y][x] in '0p;' else '#'
                r3[y] = r3[y][:x] + fill + r3[y][x + 1:]
            elif y < h3 + h2:
                k = y - h3
                r2[k] = r2[k][:x] + '#' + r2[k][x + 1:]
            else:
                k = y - h3 - h2
                r1[k] = r1[k][:x] + '#' + r1[k][x + 1:]
        rows, lost, _ = verify([('f15', r1), ('f15gut', r2), ('f15veins', r3)])
        assert not lost
    top = r3[0]
    assert all((c != '#') == (28 <= x <= 35) for x, c in enumerate(top)), top
    if '--show' in sys.argv:
        show(r3, 'O ')
        show(r2, 'B ')
        show(r1, 'K ')
    if '--write' in sys.argv or '--show' not in sys.argv:
        write_floor(15, {
            'F15_ROOTS_MAP': r1,
            'F15_OBS_MAP': r2,
            'F15_ORBIT_MAP': r3,
            'F15_SPOTS': SPOTS,
        }, note='F15_SPOTS: «вид район …» — колодцы, кольца орбит, залы-события, '
                'кристаллы памяти, посты (местные координаты района).')


if __name__ == '__main__':
    main()
